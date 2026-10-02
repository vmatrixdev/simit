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
import { assessComplexity, determineRouting } from '../runtime/model-router';
import { extractOrGenerateChips, triageRefinementIntent } from '../runtime/evolution';
import { saveSession, saveVersion, getSession, getVersionsForSession, rollbackToVersion } from '../runtime/session-db';
import { compactContext, formatCompactedUserPrompt } from '../runtime/context-compactor';
import { SessionRecord, SimulationVersion } from '../types/session';
import { EvolutionRequestMessage, EvolutionResponseMessage, CloudEscalationRequestMessage, CloudEscalationResponseMessage } from '../types/ipc';

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

  // Assess complexity and determine routing
  const mathLatexList = (harvestedContext.mathSnippets || []).map((m) => m.latex);
  const complexity = assessComplexity(
    harvestedContext.selection.selectedText,
    mathLatexList,
    classification.archetype as any
  );
  const routingDecision = determineRouting(complexity, settings, isAvailable);

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
    confidence: classification.confidence,
    complexity_score: complexity.score,
    target_tier: routingDecision.targetTier
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

    // Phase 3: Generate evolution chips and save session/v1 to IndexedDB
    const sessionId = `sess_${Date.now()}`;
    const initialParams: Record<string, any> = {};
    for (const p of repairResult.parameters) {
      initialParams[p.id] = (p as any).default ?? 0;
    }

    const evolutionChips = extractOrGenerateChips(
      repairResult.code,
      repairResult.parameters,
      classification.archetype
    );

    const sessionRecord: SessionRecord = {
      id: sessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      title: harvestedContext.selection.documentTitle || 'Simulation',
      url: harvestedContext.selection.sourceUrl || '',
      selectedText: harvestedContext.selection.selectedText,
      mathSnippet: harvestedContext.mathSnippets?.[0]?.latex,
      sectionHeading: harvestedContext.domContext?.nearestHeading || undefined,
      archetype: classification.archetype,
      activeVersionId: 'ver_v1',
      versionsCount: 1
    };

    const v1: SimulationVersion = {
      id: 'ver_v1',
      sessionId,
      versionIndex: 1,
      versionLabel: 'v1',
      code: repairResult.code,
      title: sessionRecord.title,
      description: `Initial synthesis from ${classification.archetype}`,
      parameters: repairResult.parameters,
      parameterState: initialParams,
      trigger: 'initial_synthesis',
      timestamp: Date.now()
    };

    try {
      await saveSession(sessionRecord);
      await saveVersion(v1);
    } catch (dbErr) {
      console.warn('[SimIt SW] IndexedDB save error:', dbErr);
    }

    broadcastToSidePanel({
      type: 'SIMULATION_READY',
      code: repairResult.code,
      parameters: repairResult.parameters,
      atifTrajectory: trajectory,
      sessionId,
      versionIndex: 1,
      versionLabel: 'v1',
      evolutionChips,
      routingDecision
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

// 3. Listen for Messages from Side Panel or Test Harness
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === 'START_SIMULATION_REQUEST') {
    (async () => {
      const tabId = message.tabId || _sender.tab?.id;
      let context: HarvestedContext | undefined = message.harvestedContext;
      if (!context && tabId) {
        try {
          const response: HarvestContextResponse = await chrome.tabs.sendMessage(tabId, {
            type: 'HARVEST_CONTEXT_REQUEST',
            tabId
          } as HarvestContextRequest);
          if (response && response.payload) {
            context = response.payload;
          }
        } catch (e) {
          console.warn('[SimIt SW] Content harvest in START_SIMULATION_REQUEST failed:', e);
        }
      }
      if (context) {
        await orchestrateSimulationGeneration(context);
        sendResponse({ status: 'ok' });
      } else {
        sendResponse({ status: 'error', errorMessage: 'Could not obtain context to simulate.' });
      }
    })().catch((err) => {
      sendResponse({ status: 'error', errorMessage: err.message || String(err) });
    });
    return true;
  }

  if (message && message.type === 'REPAIR_INTERACTIVE_SIM') {
    handleInteractiveRepair(message)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ status: 'error', errorMessage: err.message || String(err) }));
    return true; // async sendResponse
  }

  if (message && message.type === 'EVOLUTION_REQUEST') {
    handleEvolutionRequest(message)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ status: 'error', errorMessage: err.message || String(err) }));
    return true;
  }

  if (message && message.type === 'CLOUD_ESCALATION_REQUEST') {
    handleCloudEscalation(message)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ status: 'error', errorMessage: err.message || String(err) }));
    return true;
  }

  if (message && message.type === 'GET_VERSIONS_REQUEST') {
    getVersionsForSession(message.sessionId)
      .then((versions) => sendResponse({ status: 'ok', versions }))
      .catch((err) => sendResponse({ status: 'error', errorMessage: err.message || String(err) }));
    return true;
  }

  if (message && message.type === 'VERSION_ROLLBACK_REQUEST') {
    rollbackToVersion(message.sessionId, message.targetVersionId)
      .then((version) => sendResponse({ status: 'ok', version }))
      .catch((err) => sendResponse({ status: 'error', errorMessage: err.message || String(err) }));
    return true;
  }
});

async function handleEvolutionRequest(message: EvolutionRequestMessage): Promise<EvolutionResponseMessage> {
  const session = await getSession(message.sessionId);
  if (!session) {
    return {
      type: 'EVOLUTION_RESPONSE',
      status: 'error',
      intentType: 'structural_evolution',
      errorMessage: 'Active session not found.'
    };
  }

  const versions = await getVersionsForSession(message.sessionId);
  const currentVersion = versions.find((v) => v.id === session.activeVersionId) || versions[versions.length - 1];
  const paramDefs = currentVersion?.parameters || [];

  // Intent Triage: Check if parametric or structural
  const userInput = message.userMessage || '';
  const analysis = triageRefinementIntent(userInput, message.activeParams, paramDefs);

  if (analysis.intentType === 'parametric_tweak') {
    return {
      type: 'EVOLUTION_RESPONSE',
      status: 'ok',
      intentType: 'parametric_tweak',
      appliedParams: analysis.parameterUpdates
    };
  }

  if (analysis.intentType === 'reset_state') {
    const defaultParams: Record<string, any> = {};
    for (const p of paramDefs) {
      defaultParams[p.id] = (p as any).default;
    }
    return {
      type: 'EVOLUTION_RESPONSE',
      status: 'ok',
      intentType: 'reset_state',
      appliedParams: defaultParams
    };
  }

  // Structural Evolution via LLM
  const settings = await loadBYOKSettings();
  const { provider } = await resolveActiveProvider(settings);

  // Compact context (4-tier sliding window < 2500 tokens)
  const compacted = compactContext({
    paperAnchor: {
      text: session.selectedText,
      mathSnippet: session.mathSnippet,
      heading: session.sectionHeading,
      url: session.url
    },
    activeCode: message.currentCode,
    chatHistory: [{ role: 'user', content: userInput, timestamp: Date.now() }],
    maxChatTurns: 2
  });

  const prompt = formatCompactedUserPrompt(compacted, userInput);
  const viewport: SimulationViewport = { width: 380, height: 450 };
  const systemPrompt = buildSimulationSystemPrompt(viewport);

  const generationRes = await provider.generateSimulation({
    systemPrompt,
    userPrompt: prompt,
    temperature: settings.providers[provider.type]?.temperature || 0.2
  });

  const repairResult = await executePreFlightRepairLoop(
    generationRes.rawCode,
    provider,
    dispatchPreflightToOffscreen
  );

  if (!repairResult.success) {
    return {
      type: 'EVOLUTION_RESPONSE',
      status: 'error',
      intentType: 'structural_evolution',
      errorMessage: repairResult.finalError || 'Pre-flight verification failed for refinement.'
    };
  }

  const nextIndex = (currentVersion?.versionIndex || versions.length) + 1;
  const newVersionId = `ver_v${nextIndex}_${Date.now()}`;
  const newVersion: SimulationVersion = {
    id: newVersionId,
    sessionId: message.sessionId,
    versionIndex: nextIndex,
    versionLabel: `v${nextIndex}`,
    code: repairResult.code,
    title: session.title,
    description: userInput,
    parameters: repairResult.parameters,
    parameterState: message.activeParams,
    trigger: message.chipId ? 'chip_action' : 'chat_refinement',
    triggerDetail: userInput,
    timestamp: Date.now(),
    parentVersionId: currentVersion?.id
  };

  await saveVersion(newVersion);
  session.activeVersionId = newVersionId;
  session.versionsCount = nextIndex;
  session.updatedAt = Date.now();
  await saveSession(session);

  const updatedChips = extractOrGenerateChips(repairResult.code, repairResult.parameters, session.archetype);

  return {
    type: 'EVOLUTION_RESPONSE',
    status: 'ok',
    intentType: 'structural_evolution',
    evolvedCode: repairResult.code,
    parameters: repairResult.parameters,
    suggestedChips: updatedChips
  };
}

async function handleCloudEscalation(message: CloudEscalationRequestMessage): Promise<CloudEscalationResponseMessage> {
  const settings = await loadBYOKSettings();
  const candidateProvider = settings.activeProviderType !== 'chrome-prompt-api'
    ? settings.activeProviderType
    : (settings.providers.anthropic.apiKey ? 'anthropic' : (settings.providers['google-gemini'].apiKey ? 'google-gemini' : 'openai-compatible'));

  const { provider } = await resolveActiveProvider({
    ...settings,
    activeProviderType: candidateProvider
  });

  const isAvail = await provider.isAvailable();
  if (!isAvail) {
    return {
      type: 'CLOUD_ESCALATION_RESPONSE',
      status: 'error',
      errorMessage: `Cloud provider (${candidateProvider}) is not configured with a valid API key. Please check Settings.`
    };
  }

  const prompt = `Advance this simulation into a high-fidelity, comprehensive mathematical model.\nSelected Excerpt:\n"""\n${message.selectedText}\n"""\nFormula: ${message.mathSnippet || 'N/A'}\nBase Code:\n<simulation_code>\n${message.currentCode}\n</simulation_code>\nSynthesize an advanced version with smooth dynamics, explicit scales, and full parameter explorations.`;
  const viewport: SimulationViewport = { width: 380, height: 450 };
  const systemPrompt = buildSimulationSystemPrompt(viewport);

  const res = await provider.generateSimulation({
    systemPrompt,
    userPrompt: prompt,
    temperature: 0.2
  });

  const repairResult = await executePreFlightRepairLoop(
    res.rawCode,
    provider,
    dispatchPreflightToOffscreen
  );

  if (!repairResult.success) {
    return {
      type: 'CLOUD_ESCALATION_RESPONSE',
      status: 'error',
      errorMessage: repairResult.finalError || 'Cloud pre-flight failed.'
    };
  }

  return {
    type: 'CLOUD_ESCALATION_RESPONSE',
    status: 'ok',
    evolvedCode: repairResult.code,
    parameters: repairResult.parameters,
    provider: candidateProvider,
    modelName: settings.providers[candidateProvider]?.modelName || candidateProvider
  };
}

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

