/**
 * SimIt Background Service Worker & Orchestrator
 * Conforms to docs/specs/architecture.md and Manifest V3 lifecycle constraints
 */

import { HarvestContextRequest, HarvestContextResponse } from '../types/ipc';
import { HarvestedContext } from '../types/harvester';
import { resolveActiveProvider, loadBYOKSettings } from '../providers/resolver';
import {
  buildUserPromptFromContext,
  buildSimulationSystemPrompt,
  SimulationViewport,
  SIMULATION_SYSTEM_PROMPT
} from '../providers/prompt-builder';
import { executePreFlightRepairLoop, executeInteractiveRepair } from '../runtime/repair';
import { AtifTrajectoryLogger } from '../export/atif-logger';
import { runPreFlightSmokeTest, sanitizeCodeFences, extractSimulationTags } from '../runtime/preflight';
import { classifyArchetype } from '../runtime/triage';

import { PreFlightTestRequest, PreFlightTestResponse } from '../types/ipc';
import { ensureOffscreenDocument } from '../runtime/offscreen-manager';

const CONTEXT_MENU_ID = 'simit-selection';


/**
 * Dispatches test request to offscreen document or returns diagnostic error
 */
async function dispatchPreflightToOffscreen(request: PreFlightTestRequest): Promise<PreFlightTestResponse> {
  if (typeof chrome !== 'undefined' && chrome.offscreen) {
    try {
      await ensureOffscreenDocument();
      return await new Promise<PreFlightTestResponse>((resolve) => {
        chrome.runtime.sendMessage(request, (response: PreFlightTestResponse) => {
          if (chrome.runtime.lastError) {
            console.warn('[SimIt SW] Preflight message error:', chrome.runtime.lastError.message);
          }
          if (response && response.type === 'PREFLIGHT_TEST_RESPONSE') {
            resolve(response);
          } else {
            resolve({
              type: 'PREFLIGHT_TEST_RESPONSE',
              requestId: request.requestId,
              status: 'error',
              errorMessage: `Offscreen harness error: ${chrome.runtime.lastError?.message || 'No response from offscreen document.'}`
            });
          }
        });
      });
    } catch (err: any) {
      console.warn('[SimIt SW] Offscreen document error:', err);
      return {
        type: 'PREFLIGHT_TEST_RESPONSE',
        requestId: request.requestId,
        status: 'error',
        errorMessage: `Offscreen document error: ${err.message || String(err)}`
      };
    }
  }
  return runPreFlightSmokeTest(request);
}

// 1. Setup Context Menu & Side Panel behavior on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'SimIt',
    contexts: ['selection']
  });

  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
      console.warn('[SimIt SW] Error setting panel behavior:', err);
    });
  }
});

// 2. Handle Right-Click "SimIt" Menu Click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !tab?.id) return;

  const tabId = tab.id;

  // Open the Chrome Side Panel immediately
  try {
    await chrome.sidePanel.open({ tabId });
  } catch (err) {
    console.warn('[SimIt SW] Could not open side panel directly:', err);
  }

  // Notify Side Panel that synthesis is starting
  broadcastToSidePanel({
    type: 'SIMULATION_LOADING',
    title: 'Harvesting Context...',
    description: 'Extracting equations, technical definitions, and headings from tab.'
  });

  // Request harvested context from Content Script
  let harvestedContext: HarvestedContext;
  try {
    const response: HarvestContextResponse = await chrome.tabs.sendMessage(tabId, {
      type: 'HARVEST_CONTEXT_REQUEST',
      tabId
    } as HarvestContextRequest);

    if (response && response.payload) {
      harvestedContext = response.payload;
    } else {
      throw new Error('Empty harvest response received from content script.');
    }
  } catch (err) {
    console.warn('[SimIt SW] Content script harvest failed; creating minimal fallback context:', err);
    harvestedContext = {
      harvestId: `harvest-${Date.now()}`,
      timestamp: new Date().toISOString(),
      selection: {
        selectedText: info.selectionText || '',
        characterCount: (info.selectionText || '').length,
        sourceUrl: tab.url || '',
        documentTitle: tab.title || ''
      },
      mathSnippets: [],
      domContext: {
        nearestHeading: null,
        headingLevel: null,
        caption: null,
        paragraphSnippet: info.selectionText || ''
      }
    };
  }

  // Orchestrate model resolution and generation
  await orchestrateSimulationGeneration(harvestedContext);
});

/**
 * Orchestrates prompt composition, model inference, and 1-shot pre-flight repair
 */
export async function orchestrateSimulationGeneration(harvestedContext: HarvestedContext) {
  const settings = await loadBYOKSettings();
  const { provider, reason } = await resolveActiveProvider(settings);

  // Check if provider is available
  const isAvailable = await provider.isAvailable();
  if (!isAvailable) {
    broadcastToSidePanel({
      type: 'SHOW_BYOK_SETUP',
      reason: provider.isLocal
        ? 'Gemini Nano (Prompt API) is not currently enabled in this browser. Please configure an API key for Claude, Gemini, or Ollama in Settings.'
        : 'API key is missing or invalid for active provider.'
    });
    return;
  }

  // Upfront Archetype Triage conforming to docs/specs/archetype_triage.md
  const classification = classifyArchetype(harvestedContext);
  harvestedContext.archetypeTriage = classification.archetype;

  // Initialize ATIF trajectory tracking
  const atifLogger = new AtifTrajectoryLogger(
    harvestedContext,
    provider.type,
    settings.providers[provider.type]?.modelName || 'gemini-nano',
    provider.isLocal,
    settings.providers[provider.type]?.temperature || 0.2
  );

  atifLogger.recordStep('ARCHETYPE_TRIAGE', {
    selected_text: harvestedContext.selection.selectedText,
    archetype: classification.archetype,
    is_simulatable: classification.isSimulatable,
    confidence: classification.confidence
  });

  broadcastToSidePanel({
    type: 'SIMULATION_LOADING',
    title: 'Generating Simulation Code...',
    description: `Synthesizing ${classification.archetype.replace(/_/g, ' ')} via ${provider.type}.`
  });

  const viewport: SimulationViewport = {
    width: harvestedContext.viewport?.width ? Math.max(320, harvestedContext.viewport.width) : 380,
    height: harvestedContext.viewport?.height ? Math.max(380, harvestedContext.viewport.height) : 450
  };

  const systemPrompt = buildSimulationSystemPrompt(viewport);
  const userPrompt = buildUserPromptFromContext(harvestedContext, viewport);

  atifLogger.recordStep('PROMPT_COMPOSE', {
    system_prompt_length: systemPrompt.length,
    user_prompt_length: userPrompt.length,
    viewport
  });

  let rawGeneratedCode = '';
  try {
    const startTime = Date.now();
    const generationRes = await provider.generateSimulation({
      systemPrompt,
      userPrompt,
      temperature: settings.providers[provider.type]?.temperature || 0.2
    });
    rawGeneratedCode = generationRes.rawCode;
    const cleanInitialCode = sanitizeCodeFences(rawGeneratedCode);

    atifLogger.recordStep(
      'MODEL_INFERENCE',
      { prompt_length: userPrompt.length },
      { code_length: rawGeneratedCode.length, thinking_trace: generationRes.thinkingTrace },
      Date.now() - startTime
    );

    // Optimistically display the generated simulation to the user while offscreen verification is pending
    broadcastToSidePanel({
      type: 'SIMULATION_READY',
      code: cleanInitialCode,
      isOptimistic: true
    });
  } catch (err: any) {
    console.error('[SimIt SW] Model generation error:', err);
    const failedTrajectory = atifLogger.complete(false);
    broadcastToSidePanel({
      type: 'SIMULATION_ERROR',
      errorMessage: `Model generation failed: ${err.message || String(err)}`,
      atifTrajectory: failedTrajectory,
      rawCode: rawGeneratedCode
    });
    return;
  }

  // Execute pre-flight verification with 1-shot self-repair loop
  const repairResult = await executePreFlightRepairLoop(
    rawGeneratedCode,
    provider,
    dispatchPreflightToOffscreen
  );

  if (repairResult.repairsNeeded > 0) {
    atifLogger.recordStep(
      'AUTO_REPAIR',
      { initial_error: repairResult.initialError },
      { code_length: repairResult.code.length, repairs_needed: repairResult.repairsNeeded }
    );
  }

  atifLogger.recordStep(
    'PREFLIGHT_VERIFY',
    { repairs_needed: repairResult.repairsNeeded },
    { success: repairResult.success, error: repairResult.finalError },
    undefined,
    undefined,
    repairResult.success ? 'PASS' : 'FAIL'
  );

  if (repairResult.success) {
    atifLogger.recordStep('RENDER', {}, { parameter_count: repairResult.parameters.length }, undefined, undefined, 'MOUNTED');
    const trajectory = atifLogger.complete(true, repairResult.code);

    broadcastToSidePanel({
      type: 'SIMULATION_READY',
      code: repairResult.code,
      parameters: repairResult.parameters,
      atifTrajectory: trajectory
    });
  } else {
    const failedTrajectory = atifLogger.complete(false, repairResult.code);
    broadcastToSidePanel({
      type: 'SIMULATION_ERROR',
      errorMessage: `Pre-flight verification failed after repair: ${repairResult.finalError || 'Unknown runtime error'}`,
      atifTrajectory: failedTrajectory,
      rawCode: repairResult.code
    });
  }
}

// 3. Listen for Interactive Repair Requests from Side Panel
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === 'REPAIR_INTERACTIVE_SIM') {
    handleInteractiveRepair(message)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ status: 'error', errorMessage: err.message || String(err) }));
    return true; // async sendResponse
  }
});

async function handleInteractiveRepair(message: any) {
  const settings = await loadBYOKSettings();
  const { provider } = await resolveActiveProvider(settings);

  const result = await executeInteractiveRepair(
    message.code,
    message.errorMessage,
    message.stack,
    message.currentParams || {},
    provider,
    dispatchPreflightToOffscreen
  );

  if (result.success) {
    return {
      status: 'ok',
      repairedCode: result.code,
      parameters: result.parameters
    };
  } else {
    return {
      status: 'error',
      errorMessage: result.finalError || 'Interactive repair failed'
    };
  }
}

function broadcastToSidePanel(payload: any) {
  try {
    chrome.runtime.sendMessage(payload).catch(() => {
      // Side panel may not be open yet; ignored
    });
  } catch {
    // Ignored if recipient not listening
  }
}
