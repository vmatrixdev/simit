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
import { EvolutionRequestMessage, EvolutionResponseMessage } from '../types/ipc';
import { executeAutonomousSimulationLoop } from '../runtime/agent-orchestrator';

const CONTEXT_MENU_ID = 'simit-selection';

let lastKnownSidepanelViewport: SimulationViewport | null = null;

/**
 * Resolves the active measured simulation viewport, prioritizing explicit context measurement,
 * then cached sidepanel state, then persistent chrome.storage, and finally minimum fallback.
 */
export async function resolveActiveViewport(contextViewport?: { width: number; height: number }): Promise<SimulationViewport> {
  if (contextViewport && contextViewport.width > 0 && contextViewport.height > 0) {
    const vp: SimulationViewport = {
      width: Math.max(320, Math.round(contextViewport.width)),
      height: Math.max(380, Math.round(contextViewport.height))
    };
    lastKnownSidepanelViewport = vp;
    return vp;
  }

  if (lastKnownSidepanelViewport) {
    return lastKnownSidepanelViewport;
  }

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const res = await chrome.storage.local.get('simit_sidepanel_viewport');
      if (res && res.simit_sidepanel_viewport && (res.simit_sidepanel_viewport as any).width > 0) {
        lastKnownSidepanelViewport = {
          width: Math.max(320, Math.round((res.simit_sidepanel_viewport as any).width)),
          height: Math.max(380, Math.round((res.simit_sidepanel_viewport as any).height))
        };
        return lastKnownSidepanelViewport;
      }
    }
  } catch (err) {
    console.warn('[SimIt SW] Failed to read stored sidepanel viewport:', err);
  }

  return { width: 380, height: 450 };
}


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

export interface ActiveGenerationStatus {
  active: boolean;
  step: 1 | 2 | 3 | 4;
  title: string;
  detail: string;
  stageName: 'think' | 'code' | 'test' | 'load' | 'ready' | 'error';
  timestamp: number;
}

let activeGenerationStatus: ActiveGenerationStatus = {
  active: false,
  step: 1,
  title: 'Ready',
  detail: 'Awaiting input or text selection',
  stageName: 'ready',
  timestamp: Date.now()
};

export function updateGenerationProgress(
  step: 1 | 2 | 3 | 4,
  title: string,
  detail: string,
  stageName: 'think' | 'code' | 'test' | 'load' | 'ready' | 'error'
) {
  activeGenerationStatus = {
    active: stageName !== 'ready' && stageName !== 'error',
    step,
    title,
    detail,
    stageName,
    timestamp: Date.now()
  };
  broadcastToSidePanel({
    type: 'GENERATION_PROGRESS',
    payload: activeGenerationStatus
  });
}

// 1. Setup Context Menu & Side Panel behavior on install
if (typeof chrome !== 'undefined' && chrome.runtime?.onInstalled) {
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
}

// 2. Handle Right-Click "SimIt" Menu Click
if (typeof chrome !== 'undefined' && chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !tab?.id) return;

  const tabId = tab.id;

  // Immediately record generation start so side panel picks it up even if it was closed
  updateGenerationProgress(
    1,
    'Harvesting Context & Math...',
    'Extracting technical equations, definitions, and surrounding DOM',
    'think'
  );

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
}


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

  updateGenerationProgress(
    2,
    'Synthesizing Simulation Code...',
    `Synthesizing ${classification.archetype.replace(/_/g, ' ')} via ${provider.type}`,
    'code'
  );

  broadcastToSidePanel({
    type: 'SIMULATION_LOADING',
    title: 'Formulating Visual Landscape...',
    description: `Synthesizing ${classification.archetype.replace(/_/g, ' ')} via ${provider.type}.`
  });

  const viewport = await resolveActiveViewport(harvestedContext.viewport);
  harvestedContext.viewport = viewport;

  const loopResult = await executeAutonomousSimulationLoop({
    context: harvestedContext,
    viewport,
    provider,
    testRunner: dispatchPreflightToOffscreen,
    atifLogger,
    onProgress: (status, role) => {
      const step = role === 'sandbox' ? 3 : role === 'coder' ? 2 : 1;
      const stageName = role === 'sandbox' ? 'test' : role === 'coder' ? 'code' : 'think';
      updateGenerationProgress(step, status, `Two-Tier Agent Loop • ${status}`, stageName);
    },
    maxIterations: 3
  });

  if (loopResult.success) {
    updateGenerationProgress(
      4,
      'Simulation Ready!',
      'Interactive runtime active • Full controls mounted',
      'ready'
    );

    const sessionId = `sess_${Date.now()}`;
    const initialParams: Record<string, any> = {};
    for (const p of loopResult.parameters) {
      initialParams[p.id] = (p as any).default ?? 0;
    }

    const evolutionChips = extractOrGenerateChips(
      loopResult.code,
      loopResult.parameters,
      classification.archetype
    );

    const sessionRecord: SessionRecord = {
      id: sessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      title: loopResult.title || harvestedContext.selection.documentTitle || 'Simulation',
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
      code: loopResult.code,
      title: sessionRecord.title,
      description: loopResult.description || `Initial synthesis from ${classification.archetype}`,
      parameters: loopResult.parameters,
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
      code: loopResult.code,
      parameters: loopResult.parameters,
      atifTrajectory: loopResult.atifTrajectory,
      sessionId,
      versionIndex: 1,
      versionLabel: 'v1',
      evolutionChips,
      routingDecision
    });
  } else {
    updateGenerationProgress(
      3,
      'Generation Error',
      loopResult.error || 'Verification failed',
      'error'
    );
    broadcastToSidePanel({
      type: 'SIMULATION_ERROR',
      errorMessage: `Multi-agent verification failed: ${loopResult.error || 'Unknown runtime error'}`,
      atifTrajectory: loopResult.atifTrajectory,
      rawCode: loopResult.code
    });
  }
}

// 3. Listen for Messages from Side Panel or Test Harness
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === 'GET_ACTIVE_GENERATION_STATE') {
    sendResponse({ status: 'ok', payload: activeGenerationStatus });
    return true;
  }

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

  if (message && message.type === 'SIDEPANEL_VIEWPORT_CHANGED') {
    if (message.viewport && message.viewport.width > 0 && message.viewport.height > 0) {
      lastKnownSidepanelViewport = {
        width: Math.max(320, Math.round(message.viewport.width)),
        height: Math.max(380, Math.round(message.viewport.height))
      };
    }
    sendResponse({ status: 'ok' });
    return false;
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
}


async function handleEvolutionRequest(message: EvolutionRequestMessage): Promise<EvolutionResponseMessage> {
  const userInput = message.userMessage || '';
  const activeViewport = await resolveActiveViewport(message.viewport);

  const session = await getSession(message.sessionId);
  if (!session) {
    if (userInput.trim()) {
      updateGenerationProgress(
        1,
        'Analyzing Prompt Intent...',
        `Formulating simulation archetype for "${userInput.slice(0, 35)}..."`,
        'think'
      );
      const harvestedContext: HarvestedContext = {
        harvestId: `prompt-${Date.now()}`,
        timestamp: new Date().toISOString(),
        selection: {
          selectedText: userInput,
          characterCount: userInput.length,
          sourceUrl: '',
          documentTitle: userInput.slice(0, 30)
        },
        mathSnippets: [],
        domContext: {
          nearestHeading: userInput,
          headingLevel: 'H1',
          caption: null,
          paragraphSnippet: userInput
        },
        viewport: activeViewport
      };
      await orchestrateSimulationGeneration(harvestedContext);
      return {
        type: 'EVOLUTION_RESPONSE',
        status: 'ok',
        intentType: 'structural_evolution'
      };
    }

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

  updateGenerationProgress(
    1,
    'Analyzing Refinement Intent...',
    'Determining parametric tweak vs structural evolution',
    'think'
  );

  // Intent Triage: Check if parametric or structural
  const analysis = triageRefinementIntent(userInput, message.activeParams, paramDefs);

  if (analysis.intentType === 'parametric_tweak') {
    updateGenerationProgress(
      4,
      'Parameter Updated (0ms overhead)',
      'Direct parameter patch applied to simulation',
      'ready'
    );
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
    updateGenerationProgress(
      4,
      'Parameters Reset',
      'Restored initial module default parameters',
      'ready'
    );
    return {
      type: 'EVOLUTION_RESPONSE',
      status: 'ok',
      intentType: 'reset_state',
      appliedParams: defaultParams
    };
  }

  // Structural Evolution via LLM
  updateGenerationProgress(
    2,
    'Synthesizing Evolved Simulation...',
    'Prompting model with compacted session context',
    'code'
  );

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
  const systemPrompt = buildSimulationSystemPrompt(activeViewport);

  const generationRes = await provider.generateSimulation({
    systemPrompt,
    userPrompt: prompt,
    temperature: settings.providers[provider.type]?.temperature || 0.2
  });

  updateGenerationProgress(
    3,
    'Sandbox Pre-Flight Verification...',
    'Testing updated simulation in isolated offscreen sandbox',
    'test'
  );

  const repairResult = await executePreFlightRepairLoop(
    generationRes.rawCode,
    provider,
    dispatchPreflightToOffscreen,
    activeViewport
  );

  if (!repairResult.success) {
    updateGenerationProgress(
      3,
      'Refinement Verification Failed',
      repairResult.finalError || 'Runtime error in refinement',
      'error'
    );
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

  updateGenerationProgress(
    4,
    `✨ Evolved to v${nextIndex} successfully!`,
    `Version ${nextIndex} active • Saved in session memory`,
    'ready'
  );

  const updatedChips = extractOrGenerateChips(repairResult.code, repairResult.parameters, session.archetype);

  return {
    type: 'EVOLUTION_RESPONSE',
    status: 'ok',
    intentType: 'structural_evolution',
    evolvedCode: repairResult.code,
    parameters: repairResult.parameters,
    suggestedChips: updatedChips,
    versionId: newVersionId,
    versionIndex: nextIndex,
    versionLabel: `v${nextIndex}`
  };
}

async function handleInteractiveRepair(message: any) {
  const settings = await loadBYOKSettings();
  const { provider } = await resolveActiveProvider(settings);
  const activeViewport = await resolveActiveViewport(message.viewport);

  const result = await executeInteractiveRepair(
    message.code,
    message.errorMessage,
    message.stack,
    message.currentParams || {},
    provider,
    dispatchPreflightToOffscreen,
    activeViewport
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

