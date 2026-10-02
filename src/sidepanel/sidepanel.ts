/**
 * SimIt Side Panel UI Controller
 * Conforms to docs/specs/architecture.md#side-panel-ui-host and docs/specs/agent_loop.md
 */

import {
  HostToSandboxMessage,
  SandboxToHostMessage,
  SandboxInitSimulationMessage,
  SandboxUpdateParametersMessage,
  EvolutionRequestMessage,
  EvolutionResponseMessage,
  CloudEscalationRequestMessage,
  CloudEscalationResponseMessage
} from '../types/ipc';
import { ParameterDefinition, ParameterState } from '../types/simulation';
import { AtifTrajectory } from '../types/atif';
import { BYOKStorageSettings, ProviderType } from '../types/models';
import { EvolutionChip } from '../types/evolution';
import { RoutingDecision } from '../types/routing';
import {
  loadBYOKSettings,
  saveBYOKSettings,
  createProviderInstance,
  DEFAULT_BYOK_SETTINGS
} from '../providers/resolver';
import { generateStandaloneSimulationHtml } from '../export/standalone-exporter';

// UI State Elements
const stateEmpty = document.getElementById('state-empty') as HTMLElement;
const stateLoading = document.getElementById('state-loading') as HTMLElement;
const stateSimulation = document.getElementById('state-simulation') as HTMLElement;
const stateError = document.getElementById('state-error') as HTMLElement;

const statusPill = document.getElementById('status-pill') as HTMLElement;
const loadingTitle = document.getElementById('loading-stage-title') as HTMLElement;
const loadingDesc = document.getElementById('loading-stage-desc') as HTMLElement;

const simTitle = document.getElementById('sim-title') as HTMLElement;
const simDesc = document.getElementById('sim-desc') as HTMLElement;
const sandboxIframe = document.getElementById('sandbox-iframe') as HTMLIFrameElement;
const controlsList = document.getElementById('controls-list') as HTMLElement;
const btnResetParams = document.getElementById('btn-reset-params') as HTMLButtonElement;

// Phase 3 UI Elements
const versionScrubber = document.getElementById('version-scrubber') as HTMLElement;
const btnCloudEscalate = document.getElementById('btn-cloud-escalate') as HTMLButtonElement;
const cloudEscalateText = document.getElementById('cloud-escalate-text') as HTMLElement;

const evolutionChipsDock = document.getElementById('evolution-chips-dock') as HTMLElement;
const evolutionChipsList = document.getElementById('evolution-chips-list') as HTMLElement;

const refinementDock = document.getElementById('refinement-dock') as HTMLElement;
const refinementInput = document.getElementById('refinement-input') as HTMLInputElement;
const btnRefinementSend = document.getElementById('btn-refinement-send') as HTMLButtonElement;
const refinementStatus = document.getElementById('refinement-status') as HTMLElement;

// Repair Icon
const btnRepair = document.getElementById('btn-repair') as HTMLButtonElement;

// Export Menu Elements
const btnExportToggle = document.getElementById('btn-export-toggle') as HTMLButtonElement;
const exportMenu = document.getElementById('export-menu') as HTMLElement;
const btnExportHtml = document.getElementById('btn-export-html') as HTMLButtonElement;
const btnExportAtif = document.getElementById('btn-export-atif') as HTMLButtonElement;
const btnCopyAtif = document.getElementById('btn-copy-atif') as HTMLButtonElement;

// Settings Modal Elements
const btnSettings = document.getElementById('btn-settings') as HTMLButtonElement;
const modalSettings = document.getElementById('modal-settings') as HTMLElement;
const btnCloseSettings = document.getElementById('btn-close-settings') as HTMLButtonElement;
const providerSelect = document.getElementById('provider-select') as HTMLSelectElement;
const fieldsAnthropic = document.getElementById('fields-anthropic') as HTMLElement;
const fieldsGemini = document.getElementById('fields-gemini') as HTMLElement;
const fieldsOpenai = document.getElementById('fields-openai') as HTMLElement;
const chkFallback = document.getElementById('chk-fallback') as HTMLInputElement;
const btnSaveSettings = document.getElementById('btn-save-settings') as HTMLButtonElement;
const btnTestConnection = document.getElementById('btn-test-connection') as HTMLButtonElement;
const settingsStatusMsg = document.getElementById('settings-status-msg') as HTMLElement;

// Active Session Cache
let activeSessionId: string = '';
let activeVersionIndex: number = 1;
let currentVersions: { id: string; versionIndex: number; versionLabel: string }[] = [];
let currentEvolutionChips: EvolutionChip[] = [];
let activeCode: string = '';
let activeParameters: ParameterDefinition[] = [];
let currentParamsState: ParameterState = {};
let lastRuntimeError: { message: string; stack?: string } | null = null;
let currentAtifTrajectory: AtifTrajectory | null = null;
let currentByokSettings: BYOKStorageSettings = DEFAULT_BYOK_SETTINGS;
let activeRoutingDecision: RoutingDecision | null = null;

function setViewState(view: 'empty' | 'loading' | 'simulation' | 'error') {
  stateEmpty.style.display = view === 'empty' ? 'flex' : 'none';
  stateLoading.style.display = view === 'loading' ? 'flex' : 'none';
  stateSimulation.style.display = view === 'simulation' ? 'flex' : 'none';
  stateError.style.display = view === 'error' ? 'flex' : 'none';
}

function setStatusPill(status: 'Ready' | 'Synthesizing' | 'Verifying' | 'Active' | 'Error' | 'Repairing') {
  statusPill.textContent = status;
  statusPill.className = 'status-pill';
  if (status === 'Ready') statusPill.classList.add('status-ready');
  if (status === 'Synthesizing' || status === 'Repairing' || status === 'Verifying') statusPill.classList.add('status-loading');
  if (status === 'Active') statusPill.classList.add('status-active');
  if (status === 'Error') statusPill.classList.add('status-error');
}

/**
 * Initializes simulation in sandboxed iframe
 */
export function initSimulationInIframe(code: string, initialParams?: ParameterState) {
  activeCode = code;
  btnRepair.style.display = 'none';
  lastRuntimeError = null;

  setViewState('simulation');
  setStatusPill('Active');

  const msg: SandboxInitSimulationMessage = {
    type: 'SANDBOX_INIT_SIMULATION',
    code,
    initialParams
  };

  if (sandboxIframe.contentWindow) {
    sandboxIframe.contentWindow.postMessage(msg, '*');
  }
}

/**
 * Renders parameter controls dock based on parameter schema
 */
export function renderControlsDock(parameters: ParameterDefinition[], initialParams: ParameterState) {
  activeParameters = parameters;
  currentParamsState = { ...initialParams };
  controlsList.innerHTML = '';

  if (!parameters || parameters.length === 0) {
    controlsList.innerHTML = '<div style="font-size: 11px; color: #64748b; text-align: center; padding: 12px 0;">No adjustable parameters for this simulation.</div>';
    return;
  }

  parameters.forEach((param) => {
    const row = document.createElement('div');
    row.className = 'control-row';

    const currentVal = currentParamsState[param.id] !== undefined ? currentParamsState[param.id] : param.default;
    currentParamsState[param.id] = currentVal;

    if (param.type === 'slider' || param.type === 'stepper') {
      row.innerHTML = `
        <div class="control-row-header">
          <span class="control-label">${escapeHtml(param.label)}</span>
          <span class="control-val" id="val-${param.id}">${currentVal} ${param.unit || ''}</span>
        </div>
        <input type="range" id="input-${param.id}" min="${param.min !== undefined ? param.min : 0}" max="${param.max !== undefined ? param.max : 100}" step="${param.step !== undefined ? param.step : 1}" value="${currentVal}" />
      `;
      controlsList.appendChild(row);

      const input = row.querySelector(`#input-${param.id}`) as HTMLInputElement;
      input.addEventListener('input', (e) => {
        const num = parseFloat((e.target as HTMLInputElement).value);
        const val = isNaN(num) ? (e.target as HTMLInputElement).value : num;
        updateParameterValue(param.id, val, param.unit);
      });
    } else if (param.type === 'toggle') {
      row.className = 'control-row toggle-row';
      row.innerHTML = `
        <span class="control-label">${escapeHtml(param.label)}</span>
        <input type="checkbox" id="input-${param.id}" ${currentVal ? 'checked' : ''} />
      `;
      controlsList.appendChild(row);

      const input = row.querySelector(`#input-${param.id}`) as HTMLInputElement;
      input.addEventListener('change', (e) => {
        updateParameterValue(param.id, (e.target as HTMLInputElement).checked);
      });
    } else if (param.type === 'select') {
      row.innerHTML = `
        <div class="control-row-header">
          <span class="control-label">${escapeHtml(param.label)}</span>
        </div>
        <select id="input-${param.id}">
          ${(param.options || []).map((opt) => `<option value="${opt}" ${opt === currentVal ? 'selected' : ''}>${opt}</option>`).join('')}
        </select>
      `;
      controlsList.appendChild(row);

      const select = row.querySelector(`#input-${param.id}`) as HTMLSelectElement;
      select.addEventListener('change', (e) => {
        updateParameterValue(param.id, (e.target as HTMLSelectElement).value);
      });
    }
  });
}

function updateParameterValue(id: string, val: any, unit?: string) {
  currentParamsState[id] = val;
  const valElem = document.getElementById(`val-${id}`);
  if (valElem) {
    valElem.textContent = `${val} ${unit || ''}`;
  }

  const updateMsg: SandboxUpdateParametersMessage = {
    type: 'SANDBOX_UPDATE_PARAMETERS',
    params: { [id]: val }
  };

  if (sandboxIframe.contentWindow) {
    sandboxIframe.contentWindow.postMessage(updateMsg, '*');
  }
}

// Reset parameters button
btnResetParams?.addEventListener('click', () => {
  const defaultParams: ParameterState = {};
  activeParameters.forEach((p) => {
    if (p.default !== undefined) {
      defaultParams[p.id] = p.default;
    }
  });
  renderControlsDock(activeParameters, defaultParams);
  if (sandboxIframe.contentWindow) {
    sandboxIframe.contentWindow.postMessage({
      type: 'SANDBOX_UPDATE_PARAMETERS',
      params: defaultParams
    } as SandboxUpdateParametersMessage, '*');
  }
});

// Auto-appearing Repair Icon click handler
btnRepair?.addEventListener('click', () => {
  if (!lastRuntimeError) return;

  setStatusPill('Repairing');
  btnRepair.style.display = 'none';

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({
      type: 'REPAIR_INTERACTIVE_SIM',
      code: activeCode,
      errorMessage: lastRuntimeError.message,
      stack: lastRuntimeError.stack,
      currentParams: currentParamsState
    }, (response) => {
      if (response && response.status === 'ok' && response.repairedCode) {
        initSimulationInIframe(response.repairedCode, currentParamsState);
      } else {
        setStatusPill('Error');
        alert(`Interactive repair failed: ${response?.errorMessage || 'Unknown error'}`);
      }
    });
  }
});

// Listen for postMessage from Sandboxed iframe
window.addEventListener('message', (event) => {
  const data = event.data as SandboxToHostMessage;
  if (!data || !data.type) return;

  if (data.type === 'SANDBOX_SIMULATION_READY') {
    simTitle.textContent = data.title;
    simDesc.textContent = data.description;
    renderControlsDock(data.parameters, currentParamsState);
  } else if (data.type === 'SANDBOX_RUNTIME_ERROR') {
    lastRuntimeError = {
      message: data.message,
      stack: data.stack
    };
    if (data.currentParams) {
      currentParamsState = { ...currentParamsState, ...data.currentParams };
    }
    // Reveal auto-appearing Repair Icon
    btnRepair.style.display = 'inline-flex';
  }
});

// Listen for chrome.runtime messages from background service worker
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
    if (!message || !message.type) return;

    switch (message.type) {
      case 'SIMULATION_LOADING':
        // Only switch to loading view if simulation is not already actively displayed
        if (stateSimulation.style.display !== 'flex') {
          setViewState('loading');
          setStatusPill('Synthesizing');
        }
        loadingTitle.textContent = message.title || 'Synthesizing Simulation...';
        loadingDesc.textContent = message.description || 'Ingesting technical context.';

        const liveStreamBox = document.getElementById('live-stream-box');
        const liveStreamCode = document.getElementById('live-stream-code');
        if (message.codePreview !== undefined) {
          activeCode = message.codePreview;
          if (liveStreamBox) {
            liveStreamBox.style.display = message.codePreview.length > 0 ? 'block' : 'none';
          }
          if (liveStreamCode) {
            liveStreamCode.textContent = message.codePreview;
            liveStreamCode.scrollTop = liveStreamCode.scrollHeight;
          }
        }
        break;

      case 'SIMULATION_READY':
        if (message.atifTrajectory) {
          currentAtifTrajectory = message.atifTrajectory;
        }
        activeCode = message.code;
        const simCodePreview = document.getElementById('sim-code-preview');
        if (simCodePreview) {
          simCodePreview.textContent = activeCode;
        }
        initSimulationInIframe(message.code, message.initialParams);

        if (message.parameters) {
          activeParameters = message.parameters;
        }

        // Phase 3: Session & Version tracking
        if (message.sessionId) {
          activeSessionId = message.sessionId;
        }
        if (message.versionIndex) {
          activeVersionIndex = message.versionIndex;
          if (!currentVersions.some((v) => v.versionIndex === message.versionIndex)) {
            currentVersions.push({
              id: `ver_v${message.versionIndex}`,
              versionIndex: message.versionIndex,
              versionLabel: message.versionLabel || `v${message.versionIndex}`
            });
          }
          renderVersionScrubber();
        }

        // Phase 3: Pre-computed Evolution Chips
        if (message.evolutionChips && message.evolutionChips.length > 0) {
          currentEvolutionChips = message.evolutionChips;
          renderEvolutionChips(currentEvolutionChips);
        }

        // Phase 3: Cloud Escalation Badge
        if (message.routingDecision) {
          activeRoutingDecision = message.routingDecision;
          renderCloudEscalation(message.routingDecision);
        }

        const simVerifyingBanner = document.getElementById('sim-verifying-banner');
        if (message.isOptimistic) {
          setStatusPill('Verifying');
          if (simVerifyingBanner) {
            simVerifyingBanner.style.display = 'block';
            simVerifyingBanner.textContent = '⚡ Running pre-flight safety verification in background...';
            simVerifyingBanner.style.color = '#38bdf8';
          }
        } else {
          setStatusPill('Active');
          if (simVerifyingBanner) {
            simVerifyingBanner.style.display = 'none';
          }
        }
        break;

      case 'SIMULATION_ERROR':
        if (message.atifTrajectory) {
          currentAtifTrajectory = message.atifTrajectory;
        }
        if (message.rawCode) {
          activeCode = message.rawCode;
        }

        const verifyingBanner = document.getElementById('sim-verifying-banner');
        if (stateSimulation.style.display === 'flex' && activeCode) {
          // Keep active simulation on screen; notify user via status banner
          setStatusPill('Error');
          if (verifyingBanner) {
            verifyingBanner.style.display = 'block';
            verifyingBanner.textContent = `⚠️ Pre-flight note: ${message.errorMessage || 'Pre-flight check failed'}`;
            verifyingBanner.style.color = '#f59e0b';
          }
        } else {
          setViewState('error');
          setStatusPill('Error');
          const errTitle = document.getElementById('error-title');
          const errMsg = document.getElementById('error-message');
          if (errTitle) errTitle.textContent = 'Generation Failed';
          if (errMsg) errMsg.textContent = message.errorMessage || 'Unknown error occurred.';

          const errorCodeContainer = document.getElementById('error-code-container');
          const errorCodePreview = document.getElementById('error-code-preview');
          if (activeCode) {
            if (errorCodeContainer) errorCodeContainer.style.display = 'block';
            if (errorCodePreview) errorCodePreview.textContent = activeCode;
          } else {
            if (errorCodeContainer) errorCodeContainer.style.display = 'none';
          }
        }
        break;

      case 'SHOW_BYOK_SETUP':
        openSettingsModal();
        if (message.reason) {
          settingsStatusMsg.style.display = 'block';
          settingsStatusMsg.textContent = message.reason;
          settingsStatusMsg.style.color = '#f59e0b';
        }
        break;
    }
  });
}

// Export Dropdown
btnExportToggle?.addEventListener('click', (e) => {
  e.stopPropagation();
  exportMenu.style.display = exportMenu.style.display === 'none' ? 'flex' : 'none';
});

document.addEventListener('click', () => {
  if (exportMenu) exportMenu.style.display = 'none';
});

// Export 1: Standalone HTML
btnExportHtml?.addEventListener('click', () => {
  if (!activeCode) {
    alert('No active simulation to export.');
    return;
  }

  const html = generateStandaloneSimulationHtml({
    title: simTitle.textContent || 'Simulation',
    description: simDesc.textContent || '',
    parameters: activeParameters,
    initialParams: currentParamsState,
    code: activeCode
  });

  downloadFile('sim-export.html', 'text/html', html);
});

// Export 2: ATIF JSON
btnExportAtif?.addEventListener('click', () => {
  if (!currentAtifTrajectory) {
    alert('No ATIF trajectory recorded for current session.');
    return;
  }
  const jsonStr = JSON.stringify(currentAtifTrajectory, null, 2);
  downloadFile(`${currentAtifTrajectory.session_id || 'session'}.atif.json`, 'application/json', jsonStr);
});

// Error Card: Download ATIF Button
document.getElementById('btn-error-download-atif')?.addEventListener('click', () => {
  if (!currentAtifTrajectory) {
    alert('No ATIF trajectory recorded for current session.');
    return;
  }
  const jsonStr = JSON.stringify(currentAtifTrajectory, null, 2);
  downloadFile(`${currentAtifTrajectory.session_id || 'session'}.atif.json`, 'application/json', jsonStr);
});

// Export 3: Copy ATIF
btnCopyAtif?.addEventListener('click', () => {
  if (!currentAtifTrajectory) {
    alert('No ATIF trajectory recorded for current session.');
    return;
  }
  navigator.clipboard.writeText(JSON.stringify(currentAtifTrajectory, null, 2))
    .then(() => alert('ATIF trajectory copied to clipboard!'))
    .catch((err) => console.error('Copy failed:', err));
});

// Copy Generated Code (from Export menu)
document.getElementById('btn-copy-code')?.addEventListener('click', () => {
  if (!activeCode) {
    alert('No active simulation code to copy.');
    return;
  }
  navigator.clipboard.writeText(activeCode)
    .then(() => alert('Simulation code copied to clipboard!'))
    .catch((err) => console.error('Copy failed:', err));
});

// Copy Code from Error Box
document.getElementById('btn-copy-error-code')?.addEventListener('click', () => {
  if (!activeCode) return;
  navigator.clipboard.writeText(activeCode)
    .then(() => alert('Generated code copied to clipboard!'))
    .catch((err) => console.error('Copy failed:', err));
});

// Copy Code from Simulation View Details Accordion
document.getElementById('btn-copy-sim-code')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!activeCode) return;
  navigator.clipboard.writeText(activeCode)
    .then(() => alert('Simulation code copied to clipboard!'))
    .catch((err) => console.error('Copy failed:', err));
});

// Retry Generation Button
document.getElementById('btn-retry')?.addEventListener('click', () => {
  setViewState('empty');
  setStatusPill('Ready');
});

// Run Simulation Now (from live stream loading box)
document.getElementById('btn-skip-to-sim')?.addEventListener('click', () => {
  if (!activeCode) {
    alert('No simulation code generated yet.');
    return;
  }
  initSimulationInIframe(activeCode);
});

// Copy Code from Live Stream Box
document.getElementById('btn-copy-live-code')?.addEventListener('click', () => {
  if (!activeCode) return;
  navigator.clipboard.writeText(activeCode)
    .then(() => alert('Generated code copied to clipboard!'))
    .catch((err) => console.error('Copy failed:', err));
});

// Run Simulation Anyway (from error card)
document.getElementById('btn-force-run-sim')?.addEventListener('click', () => {
  if (!activeCode) {
    alert('No simulation code available.');
    return;
  }
  initSimulationInIframe(activeCode);
});

function downloadFile(filename: string, mimeType: string, content: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Settings Modal Management
function openSettingsModal() {
  loadBYOKSettings().then((settings) => {
    currentByokSettings = settings;
    providerSelect.value = settings.activeProviderType;
    chkFallback.checked = settings.fallbackToBYOKOnNanoUnavailable;

    (document.getElementById('anthropic-key') as HTMLInputElement).value = settings.providers.anthropic.apiKey || '';
    (document.getElementById('anthropic-model') as HTMLInputElement).value = settings.providers.anthropic.modelName || 'claude-3-5-sonnet-20241022';

    (document.getElementById('gemini-key') as HTMLInputElement).value = settings.providers['google-gemini'].apiKey || '';
    (document.getElementById('gemini-model') as HTMLInputElement).value = settings.providers['google-gemini'].modelName || 'gemini-2.5-flash';

    (document.getElementById('openai-url') as HTMLInputElement).value = settings.providers['openai-compatible'].baseUrl || 'http://localhost:11434/v1';
    (document.getElementById('openai-key') as HTMLInputElement).value = settings.providers['openai-compatible'].apiKey || '';
    (document.getElementById('openai-model') as HTMLInputElement).value = settings.providers['openai-compatible'].modelName || 'deepseek-r1:8b';

    updateProviderFieldVisibility(settings.activeProviderType);
    modalSettings.style.display = 'flex';
  });
}

function updateProviderFieldVisibility(type: ProviderType) {
  fieldsAnthropic.style.display = type === 'anthropic' ? 'block' : 'none';
  fieldsGemini.style.display = type === 'google-gemini' ? 'block' : 'none';
  fieldsOpenai.style.display = type === 'openai-compatible' ? 'block' : 'none';
}

btnSettings?.addEventListener('click', openSettingsModal);
btnCloseSettings?.addEventListener('click', () => { modalSettings.style.display = 'none'; });

providerSelect?.addEventListener('change', () => {
  updateProviderFieldVisibility(providerSelect.value as ProviderType);
});

btnSaveSettings?.addEventListener('click', async () => {
  const updated: BYOKStorageSettings = {
    activeProviderType: providerSelect.value as ProviderType,
    fallbackToBYOKOnNanoUnavailable: chkFallback.checked,
    providers: {
      'chrome-prompt-api': {
        modelName: 'gemini-nano',
        temperature: 0.2
      },
      anthropic: {
        apiKey: (document.getElementById('anthropic-key') as HTMLInputElement).value.trim(),
        modelName: (document.getElementById('anthropic-model') as HTMLInputElement).value.trim() || 'claude-3-5-sonnet-20241022',
        temperature: 0.2
      },
      'google-gemini': {
        apiKey: (document.getElementById('gemini-key') as HTMLInputElement).value.trim(),
        modelName: (document.getElementById('gemini-model') as HTMLInputElement).value.trim() || 'gemini-2.5-flash',
        temperature: 0.2
      },
      'openai-compatible': {
        baseUrl: (document.getElementById('openai-url') as HTMLInputElement).value.trim() || 'http://localhost:11434/v1',
        apiKey: (document.getElementById('openai-key') as HTMLInputElement).value.trim(),
        modelName: (document.getElementById('openai-model') as HTMLInputElement).value.trim() || 'deepseek-r1:8b',
        temperature: 0.2
      }
    }
  };

  await saveBYOKSettings(updated);
  currentByokSettings = updated;
  modalSettings.style.display = 'none';
});

btnTestConnection?.addEventListener('click', async () => {
  settingsStatusMsg.style.display = 'block';
  settingsStatusMsg.textContent = 'Testing connection...';
  settingsStatusMsg.style.color = '#f59e0b';

  const type = providerSelect.value as ProviderType;
  const testSettings: BYOKStorageSettings = {
    activeProviderType: type,
    fallbackToBYOKOnNanoUnavailable: chkFallback.checked,
    providers: {
      ...currentByokSettings.providers,
      anthropic: {
        ...currentByokSettings.providers.anthropic,
        apiKey: (document.getElementById('anthropic-key') as HTMLInputElement).value.trim()
      },
      'google-gemini': {
        ...currentByokSettings.providers['google-gemini'],
        apiKey: (document.getElementById('gemini-key') as HTMLInputElement).value.trim()
      },
      'openai-compatible': {
        ...currentByokSettings.providers['openai-compatible'],
        baseUrl: (document.getElementById('openai-url') as HTMLInputElement).value.trim(),
        apiKey: (document.getElementById('openai-key') as HTMLInputElement).value.trim()
      }
    }
  };

  try {
    const provider = createProviderInstance(type, testSettings);
    const available = await provider.isAvailable();
    if (available) {
      settingsStatusMsg.textContent = `Success: Provider ${type} is reachable and ready!`;
      settingsStatusMsg.style.color = '#10b981';
    } else {
      settingsStatusMsg.textContent = `Provider ${type} is currently not reachable or key is missing.`;
      settingsStatusMsg.style.color = '#ef4444';
    }
  } catch (err: any) {
    settingsStatusMsg.textContent = `Error testing ${type}: ${err.message || String(err)}`;
    settingsStatusMsg.style.color = '#ef4444';
  }
});

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ====================================================
// Phase 3: Version Scrubber, Chips, Chat & Escalation
// ====================================================

/**
 * Renders the version scrubber pills (v1, v2, v3...) with active state and 1-click rollback
 */
function renderVersionScrubber() {
  if (!versionScrubber) return;
  if (currentVersions.length <= 1) {
    versionScrubber.style.display = 'none';
    return;
  }

  versionScrubber.style.display = 'flex';
  versionScrubber.innerHTML = '';

  for (const v of currentVersions) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = `version-pill ${v.versionIndex === activeVersionIndex ? 'active' : ''}`;
    pill.textContent = v.versionLabel;
    pill.title = `Rollback to ${v.versionLabel}`;

    pill.addEventListener('click', () => {
      handleVersionRollback(v.id, v.versionIndex);
    });

    versionScrubber.appendChild(pill);
  }
}

function postToSandbox(msg: HostToSandboxMessage) {
  if (sandboxIframe && sandboxIframe.contentWindow) {
    sandboxIframe.contentWindow.postMessage(msg, '*');
  }
}

/**
 * Handles 1-click state rollback (0 network calls)
 */
async function handleVersionRollback(versionId: string, versionIndex: number) {
  if (versionIndex === activeVersionIndex) return;

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage(
      {
        type: 'VERSION_ROLLBACK_REQUEST',
        sessionId: activeSessionId,
        targetVersionId: versionId
      },
      (res: any) => {
        if (res && res.status === 'ok' && res.version) {
          activeVersionIndex = versionIndex;
          activeCode = res.version.code;
          activeParameters = res.version.parameters || [];
          currentParamsState = res.version.parameterState || {};

          initSimulationInIframe(activeCode, currentParamsState);
          renderControlsDock(activeParameters, currentParamsState);
          renderVersionScrubber();

          const simCodePreview = document.getElementById('sim-code-preview');
          if (simCodePreview) {
            simCodePreview.textContent = activeCode;
          }
        }
      }
    );
  }
}

/**
 * Renders pre-computed evolution chips (max 4 visible)
 */
function renderEvolutionChips(chips: EvolutionChip[]) {
  if (!evolutionChipsDock || !evolutionChipsList) return;
  if (!chips || chips.length === 0) {
    evolutionChipsDock.style.display = 'none';
    return;
  }

  evolutionChipsDock.style.display = 'block';
  evolutionChipsList.innerHTML = '';

  for (const chip of chips) {
    const chipBtn = document.createElement('button');
    chipBtn.type = 'button';
    chipBtn.className = `chip-btn ${chip.actionType === 'parameter_preset' ? 'param-preset' : 'structural'}`;
    chipBtn.textContent = chip.label;
    if (chip.description || chip.rationale) {
      chipBtn.title = chip.description || chip.rationale || '';
    }

    chipBtn.addEventListener('click', () => {
      handleChipClick(chip);
    });

    evolutionChipsList.appendChild(chipBtn);
  }
}

/**
 * Handles clicks on evolution chips
 */
function handleChipClick(chip: EvolutionChip) {
  if (chip.actionType === 'parameter_preset') {
    // Zero-latency direct parameter update (0ms LLM overhead)
    if (chip.targetParamId && chip.presetValue !== undefined) {
      currentParamsState[chip.targetParamId] = chip.presetValue;
    }
    if (chip.parameterUpdates) {
      Object.assign(currentParamsState, chip.parameterUpdates);
    }

    // Post directly to sandboxed iframe
    postToSandbox({
      type: 'SANDBOX_UPDATE_PARAMETERS',
      params: currentParamsState
    });

    renderControlsDock(activeParameters, currentParamsState);

    if (refinementStatus) {
      refinementStatus.style.display = 'block';
      refinementStatus.style.color = '#10b981';
      refinementStatus.textContent = `⚡ Applied preset: ${chip.label} (0ms LLM overhead)`;
      setTimeout(() => {
        if (refinementStatus) refinementStatus.style.display = 'none';
      }, 3000);
    }
    return;
  }

  if (chip.actionType === 'view_mode') {
    // Reset parameters to defaults
    const defaultParams: ParameterState = {};
    for (const p of activeParameters) {
      defaultParams[p.id] = (p as any).default ?? 0;
    }
    currentParamsState = defaultParams;
    postToSandbox({
      type: 'SANDBOX_UPDATE_PARAMETERS',
      params: currentParamsState
    });
    renderControlsDock(activeParameters, currentParamsState);
    return;
  }

  if (chip.actionType === 'structural_refinement') {
    executeRefinement(chip.refinementPrompt || chip.label, chip.id);
  }
}

/**
 * Executes a conversational refinement (chat or chip) with intent triage
 */
function executeRefinement(userMessage: string, chipId?: string) {
  if (!userMessage.trim()) return;

  if (refinementStatus) {
    refinementStatus.style.display = 'block';
    refinementStatus.style.color = '#38bdf8';
    refinementStatus.textContent = '⚡ Analyzing refinement intent...';
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    const req: EvolutionRequestMessage = {
      type: 'EVOLUTION_REQUEST',
      sessionId: activeSessionId,
      currentCode: activeCode,
      userMessage,
      chipId,
      activeParams: currentParamsState
    };

    chrome.runtime.sendMessage(req, (res: EvolutionResponseMessage) => {
      if (!res) {
        if (refinementStatus) {
          refinementStatus.style.color = '#ef4444';
          refinementStatus.textContent = 'No response received from background orchestrator.';
        }
        return;
      }

      if (res.status === 'ok') {
        if (res.intentType === 'parametric_tweak' && res.appliedParams) {
          // Zero-latency update: 0ms LLM overhead
          Object.assign(currentParamsState, res.appliedParams);
          postToSandbox({
            type: 'SANDBOX_UPDATE_PARAMETERS',
            params: currentParamsState
          });
          renderControlsDock(activeParameters, currentParamsState);

          if (refinementStatus) {
            refinementStatus.style.color = '#10b981';
            refinementStatus.textContent = '⚡ Applied parameter tweak directly (0ms LLM overhead).';
          }
          if (refinementInput) refinementInput.value = '';
          return;
        }

        if (res.intentType === 'reset_state' && res.appliedParams) {
          currentParamsState = res.appliedParams;
          postToSandbox({
            type: 'SANDBOX_UPDATE_PARAMETERS',
            params: currentParamsState
          });
          renderControlsDock(activeParameters, currentParamsState);

          if (refinementStatus) {
            refinementStatus.style.color = '#10b981';
            refinementStatus.textContent = '🔄 Parameters reset to defaults.';
          }
          if (refinementInput) refinementInput.value = '';
          return;
        }

        if (res.intentType === 'structural_evolution' && res.evolvedCode) {
          activeCode = res.evolvedCode;
          if (res.parameters) {
            activeParameters = res.parameters;
          }

          initSimulationInIframe(activeCode, currentParamsState);
          renderControlsDock(activeParameters, currentParamsState);

          activeVersionIndex++;
          currentVersions.push({
            id: `ver_v${activeVersionIndex}`,
            versionIndex: activeVersionIndex,
            versionLabel: `v${activeVersionIndex}`
          });
          renderVersionScrubber();

          if (res.suggestedChips) {
            currentEvolutionChips = res.suggestedChips;
            renderEvolutionChips(currentEvolutionChips);
          }

          const simCodePreview = document.getElementById('sim-code-preview');
          if (simCodePreview) simCodePreview.textContent = activeCode;

          if (refinementStatus) {
            refinementStatus.style.color = '#10b981';
            refinementStatus.textContent = `✨ Evolved to v${activeVersionIndex} successfully!`;
          }
          if (refinementInput) refinementInput.value = '';
          return;
        }
      }

      if (refinementStatus) {
        refinementStatus.style.color = '#ef4444';
        refinementStatus.textContent = `⚠️ Refinement failed: ${res.errorMessage || 'Unknown error'}`;
      }
    });
  }
}

/**
 * Configures the 1-click cloud escalation button
 */
function renderCloudEscalation(decision: RoutingDecision) {
  if (!btnCloudEscalate) return;

  if (decision.canEscalateToCloud) {
    btnCloudEscalate.style.display = 'inline-flex';
    if (cloudEscalateText) {
      cloudEscalateText.textContent = decision.escalationBadgeText || '⚡ Escalate to Cloud';
    }
  } else {
    btnCloudEscalate.style.display = 'none';
  }
}

/**
 * Handles 1-click cloud escalation click
 */
function handleCloudEscalateClick() {
  if (!activeCode) return;

  if (refinementStatus) {
    refinementStatus.style.display = 'block';
    refinementStatus.style.color = '#f59e0b';
    refinementStatus.textContent = '⚡ Escalating simulation to frontier cloud model...';
  }
  setStatusPill('Synthesizing');

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    const req: CloudEscalationRequestMessage = {
      type: 'CLOUD_ESCALATION_REQUEST',
      sessionId: activeSessionId,
      currentCode: activeCode,
      selectedText: simTitle.textContent || ''
    };

    chrome.runtime.sendMessage(req, (res: CloudEscalationResponseMessage) => {
      if (res && res.status === 'ok' && res.evolvedCode) {
        activeCode = res.evolvedCode;
        if (res.parameters) {
          activeParameters = res.parameters;
        }

        initSimulationInIframe(activeCode, currentParamsState);
        renderControlsDock(activeParameters, currentParamsState);

        activeVersionIndex++;
        currentVersions.push({
          id: `ver_v${activeVersionIndex}`,
          versionIndex: activeVersionIndex,
          versionLabel: `v${activeVersionIndex}`
        });
        renderVersionScrubber();

        const simCodePreview = document.getElementById('sim-code-preview');
        if (simCodePreview) simCodePreview.textContent = activeCode;

        setStatusPill('Active');
        if (refinementStatus) {
          refinementStatus.style.color = '#10b981';
          refinementStatus.textContent = `🚀 Frontier model generated v${activeVersionIndex} (${res.modelName || res.provider})!`;
        }
      } else {
        setStatusPill('Active');
        if (refinementStatus) {
          refinementStatus.style.color = '#ef4444';
          refinementStatus.textContent = `⚠️ Cloud escalation failed: ${res?.errorMessage || 'Check API key in Settings'}`;
        }
      }
    });
  }
}


// Event Listeners for Refinement Chat & Cloud Escalation
btnRefinementSend?.addEventListener('click', () => {
  if (refinementInput) {
    executeRefinement(refinementInput.value);
  }
});

refinementInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    executeRefinement(refinementInput.value);
  }
});

btnCloudEscalate?.addEventListener('click', handleCloudEscalateClick);
