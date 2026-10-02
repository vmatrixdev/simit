/**
 * SimIt Side Panel UI Controller
 * Conforms to docs/specs/architecture.md#side-panel-ui-host and docs/specs/agent_loop.md
 */

import {
  HostToSandboxMessage,
  SandboxToHostMessage,
  SandboxInitSimulationMessage,
  SandboxUpdateParametersMessage
} from '../types/ipc';
import { ParameterDefinition, ParameterState } from '../types/simulation';
import { AtifTrajectory } from '../types/atif';
import { BYOKStorageSettings, ProviderType } from '../types/models';
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
let activeCode: string = '';
let activeParameters: ParameterDefinition[] = [];
let currentParamsState: ParameterState = {};
let lastRuntimeError: { message: string; stack?: string } | null = null;
let currentAtifTrajectory: AtifTrajectory | null = null;
let currentByokSettings: BYOKStorageSettings = DEFAULT_BYOK_SETTINGS;

function setViewState(view: 'empty' | 'loading' | 'simulation' | 'error') {
  stateEmpty.style.display = view === 'empty' ? 'flex' : 'none';
  stateLoading.style.display = view === 'loading' ? 'flex' : 'none';
  stateSimulation.style.display = view === 'simulation' ? 'flex' : 'none';
  stateError.style.display = view === 'error' ? 'flex' : 'none';
}

function setStatusPill(status: 'Ready' | 'Synthesizing' | 'Active' | 'Error' | 'Repairing') {
  statusPill.textContent = status;
  statusPill.className = 'status-pill';
  if (status === 'Ready') statusPill.classList.add('status-ready');
  if (status === 'Synthesizing' || status === 'Repairing') statusPill.classList.add('status-loading');
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
        setViewState('loading');
        setStatusPill('Synthesizing');
        loadingTitle.textContent = message.title || 'Synthesizing Simulation...';
        loadingDesc.textContent = message.description || 'Ingesting technical context.';
        break;

      case 'SIMULATION_READY':
        if (message.atifTrajectory) {
          currentAtifTrajectory = message.atifTrajectory;
        }
        initSimulationInIframe(message.code, message.initialParams);
        break;

      case 'SIMULATION_ERROR':
        setViewState('error');
        setStatusPill('Error');
        const errTitle = document.getElementById('error-title');
        const errMsg = document.getElementById('error-message');
        if (errTitle) errTitle.textContent = 'Generation Failed';
        if (errMsg) errMsg.textContent = message.errorMessage || 'Unknown error occurred.';
        break;

      case 'SHOW_BYOK_SETUP':
        openSettingsModal();
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
