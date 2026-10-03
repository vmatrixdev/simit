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

const codeTerminalOverlay = document.getElementById('code-terminal-overlay') as HTMLElement;
const btnToggleCodeTerminal = document.getElementById('btn-toggle-code-terminal') as HTMLButtonElement;
const btnCopySimCodeInline = document.getElementById('btn-copy-sim-code-inline') as HTMLButtonElement;
const btnCopyTerminalCode = document.getElementById('btn-copy-terminal-code') as HTMLButtonElement;
const btnCloseTerminal = document.getElementById('btn-close-terminal') as HTMLButtonElement;
const btnCloseTerminalDot = document.getElementById('btn-close-terminal-dot') as HTMLElement;
const terminalCopyText = document.getElementById('terminal-copy-text') as HTMLElement;

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

export const WELCOME_SIMULATION_CODE = `export default {
  title: "SimIt Copilot",
  description: "Interactive visualizer copilot. Highlight formulas, algorithms, or concepts on any page and right-click 'SimIt' — or prompt below.",
  parameters: [
    { id: "particles", label: "Particle Density", type: "slider", min: 20, max: 80, step: 5, default: 45, unit: "nodes" },
    { id: "speed", label: "Oscillation Speed", type: "slider", min: 0.2, max: 2.5, step: 0.1, default: 1.0, unit: "x" },
    { id: "connectDist", label: "Coupling Radius", type: "slider", min: 60, max: 180, step: 10, default: 110, unit: "px" }
  ],
  init(container, params) {
    this.container = container;
    this.params = { ...params };
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width: 100%; height: 100%; display: block; background: radial-gradient(circle at 50% 35%, #0c1427 0%, #050811 100%); cursor: crosshair;';
    container.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = (rect.width || 360) * dpr;
      canvas.height = (rect.height || 480) * dpr;
      this.ctx.resetTransform?.();
      this.ctx.scale(dpr, dpr);
      this.w = rect.width || 360;
      this.h = rect.height || 480;
      this.initNodes();
    };
    this.resize = resize;
    resize();
    this.ro = new ResizeObserver(resize);
    this.ro.observe(container);

    this.mouse = { x: -1000, y: -1000, isDown: false, pulse: 0 };
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
    });
    canvas.addEventListener('pointerdown', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      this.mouse.isDown = true;
      this.mouse.pulse = 1.0;
    });
    window.addEventListener('pointerup', () => { this.mouse.isDown = false; });

    let lastT = performance.now();
    const loop = (t) => {
      const dt = Math.min(0.05, (t - lastT) / 1000);
      lastT = t;
      this.update(dt);
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  },
  initNodes() {
    const count = this.params.particles || 45;
    this.nodes = [];
    for (let i = 0; i < count; i++) {
      this.nodes.push({
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        vx: (Math.random() - 0.5) * 35,
        vy: (Math.random() - 0.5) * 35,
        baseR: 2 + Math.random() * 2.5,
        phase: Math.random() * Math.PI * 2
      });
    }
  },
  update(dt) {
    const spd = this.params.speed || 1.0;
    const count = Math.round(this.params.particles || 45);
    while (this.nodes.length < count) {
      this.nodes.push({
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        vx: (Math.random() - 0.5) * 35,
        vy: (Math.random() - 0.5) * 35,
        baseR: 2 + Math.random() * 2.5,
        phase: Math.random() * Math.PI * 2
      });
    }
    if (this.nodes.length > count) this.nodes.length = count;

    if (this.mouse.pulse > 0) {
      this.mouse.pulse = Math.max(0, this.mouse.pulse - dt * 1.5);
    }

    for (const n of this.nodes) {
      n.phase += dt * 2 * spd;
      n.x += n.vx * dt * spd;
      n.y += n.vy * dt * spd;

      const dx = this.mouse.x - n.x;
      const dy = this.mouse.y - n.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 140 && dist > 1) {
        const force = (140 - dist) / 140;
        const sign = this.mouse.isDown ? -1 : 1;
        n.x += (dx / dist) * force * 50 * dt * sign;
        n.y += (dy / dist) * force * 50 * dt * sign;
      }

      if (n.x < 10) { n.x = 10; n.vx *= -1; }
      if (n.x > this.w - 10) { n.x = this.w - 10; n.vx *= -1; }
      if (n.y < 10) { n.y = 10; n.vy *= -1; }
      if (n.y > this.h - 10) { n.y = this.h - 10; n.vy *= -1; }
    }
  },
  draw() {
    const { ctx, w, h, nodes, mouse, params } = this;
    if (!ctx || !w || !h) return;
    ctx.clearRect(0, 0, w, h);

    const maxDist = params.connectDist || 110;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
        if (d < maxDist) {
          const alpha = (1 - d / maxDist) * 0.45;
          ctx.strokeStyle = \`rgba(56, 189, 248, \${alpha})\`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.stroke();
        }
      }
    }

    for (const n of nodes) {
      const r = n.baseR + Math.sin(n.phase) * 0.8;
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (mouse.pulse > 0) {
      const pulseR = (1 - mouse.pulse) * 90;
      ctx.strokeStyle = \`rgba(245, 158, 11, \${mouse.pulse * 0.7})\`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mouse.x, mouse.y, pulseR, 0, Math.PI * 2);
      ctx.stroke();
    }

    const cx = w / 2;
    const cy = h / 2 - 10;

    ctx.save();
    const boxW = Math.min(290, w - 36);
    const boxH = 130;
    const bx = cx - boxW / 2;
    const by = cy - boxH / 2;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(bx, by, boxW, boxH, 12) : ctx.rect(bx, by, boxW, boxH);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#38bdf8';
    ctx.font = '600 12.5px system-ui, -apple-system, sans-serif';
    ctx.fillText('✦ READY TO SIMULATE', cx, by + 25);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px system-ui, -apple-system, sans-serif';
    ctx.fillText('Highlight text or equation on page', cx, by + 50);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '600 12px system-ui, -apple-system, sans-serif';
    ctx.fillText('➔ Right-click "SimIt"', cx, by + 69);

    ctx.fillStyle = '#64748b';
    ctx.font = '10.5px system-ui, -apple-system, sans-serif';
    ctx.fillText('— or enter a prompt below —', cx, by + 92);

    ctx.fillStyle = '#38bdf8';
    ctx.font = '10px monospace';
    ctx.fillText('Interactive Canvas Active (Drag to perturb)', cx, by + 114);

    ctx.restore();
  },
  update(newParams) {
    this.params = { ...this.params, ...newParams };
  },
  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
  }
};`;

let progressHideTimeout: any = null;

/**
 * Updates the smooth morphing pipeline status capsule beneath the chat box
 */
export function setMorphingProgress(
  step: 1 | 2 | 3 | 4,
  title: string,
  detail: string = '',
  stageName: 'think' | 'code' | 'test' | 'load' | 'ready' | 'error' = 'think',
  autoHideMs?: number
) {
  if (progressHideTimeout) {
    clearTimeout(progressHideTimeout);
    progressHideTimeout = null;
  }

  const capsule = document.getElementById('status-pipeline-capsule');
  const stageText = document.getElementById('pipeline-stage-text');
  const stageDetail = document.getElementById('pipeline-stage-detail');

  if (refinementStatus) {
    refinementStatus.style.display = 'block';
  }

  if (capsule) {
    capsule.setAttribute('data-stage', stageName);
  }

  if (stageText) {
    stageText.textContent = title;
    stageText.classList.remove('morph-in');
    void stageText.offsetWidth; // Force reflow for smooth re-trigger
    stageText.classList.add('morph-in');
  }

  if (stageDetail) {
    stageDetail.textContent = detail;
    stageDetail.classList.remove('morph-in');
    void stageDetail.offsetWidth;
    stageDetail.classList.add('morph-in');
  }

  // Update step dots (1: Think, 2: Code, 3: Test, 4: Mount/Ready)
  for (let s = 1; s <= 4; s++) {
    const dot = document.getElementById(`step-dot-${s}`);
    const conn = document.getElementById(`step-conn-${s}`);

    if (dot) {
      dot.className = 'step-dot';
      if (stageName === 'ready') {
        dot.classList.add('completed');
        if (s === 4) dot.classList.add('active');
      } else if (s < step) {
        dot.classList.add('completed');
      } else if (s === step) {
        dot.classList.add('active');
      }
    }

    if (conn) {
      conn.className = 'step-connector';
      if (s < step || stageName === 'ready') {
        conn.classList.add('active');
      }
    }
  }

  if (autoHideMs && autoHideMs > 0) {
    progressHideTimeout = setTimeout(() => {
      if (refinementStatus && stageName === 'ready') {
        refinementStatus.style.display = 'none';
      }
    }, autoHideMs);
  }
}

export interface VersionItem {
  id: string;
  versionIndex: number;
  versionLabel: string;
  code: string;
  parameters: ParameterDefinition[];
  parameterState: ParameterState;
}

// Active Session Cache
let activeSessionId: string = '';
let activeVersionIndex: number = 1;
let currentVersions: VersionItem[] = [];
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
      const minVal = param.min !== undefined ? param.min : 0;
      const maxVal = param.max !== undefined ? param.max : 100;
      const stepVal = param.step !== undefined ? param.step : 1;

      row.innerHTML = `
        <div class="control-row-header">
          <span class="control-label">${escapeHtml(param.label)}</span>
          <span class="control-val" id="val-${param.id}">${currentVal} ${param.unit || ''}</span>
        </div>
        <input type="range" id="input-${param.id}" min="${minVal}" max="${maxVal}" step="${stepVal}" value="${currentVal}" />
        <div class="control-bounds-row">
          <span class="bound-tag bound-min" id="min-${param.id}" title="Click to edit min bound">${minVal}</span>
          <span class="bound-tag bound-max" id="max-${param.id}" title="Click to edit max bound">${maxVal}</span>
        </div>
      `;
      controlsList.appendChild(row);

      const input = row.querySelector(`#input-${param.id}`) as HTMLInputElement;
      input.addEventListener('input', (e) => {
        const num = parseFloat((e.target as HTMLInputElement).value);
        const val = isNaN(num) ? (e.target as HTMLInputElement).value : num;
        updateParameterValue(param.id, val, param.unit);
      });

      const attachBoundEditor = (tagId: string, isMin: boolean) => {
        const tag = row.querySelector(`#${tagId}`) as HTMLElement;
        if (!tag) return;
        tag.addEventListener('click', () => {
          if (tag.querySelector('input')) return;
          const currentBound = isMin ? input.min : input.max;
          const editInput = document.createElement('input');
          editInput.type = 'number';
          editInput.className = 'bound-edit-input';
          editInput.step = 'any';
          editInput.value = currentBound;
          tag.textContent = '';
          tag.appendChild(editInput);
          editInput.focus();
          editInput.select();

          let isCancelled = false;
          const commit = () => {
            if (isCancelled) return;
            const val = parseFloat(editInput.value);
            if (!isNaN(val)) {
              if (isMin && val < parseFloat(input.max)) {
                input.min = String(val);
                param.min = val;
                tag.textContent = String(val);
                return;
              } else if (!isMin && val > parseFloat(input.min)) {
                input.max = String(val);
                param.max = val;
                tag.textContent = String(val);
                return;
              }
            }
            tag.textContent = currentBound;
          };

          editInput.addEventListener('blur', commit);
          editInput.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') editInput.blur();
            if (ev.key === 'Escape') {
              isCancelled = true;
              tag.textContent = currentBound;
            }
          });
        });
      };

      attachBoundEditor(`min-${param.id}`, true);
      attachBoundEditor(`max-${param.id}`, false);
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
    } else if (param.type === 'button' || (param as any).type === 'action') {
      row.className = 'control-row button-row';
      row.innerHTML = `
        <button class="btn-control-action" id="btn-param-${param.id}" type="button">
          ${escapeHtml(param.label || param.id)}
        </button>
      `;
      controlsList.appendChild(row);

      const btn = row.querySelector(`#btn-param-${param.id}`) as HTMLButtonElement;
      btn.addEventListener('click', () => {
        const updateMsg: SandboxUpdateParametersMessage = {
          type: 'SANDBOX_UPDATE_PARAMETERS',
          params: { [param.id]: true }
        };
        if (sandboxIframe.contentWindow) {
          sandboxIframe.contentWindow.postMessage(updateMsg, '*');
        }
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
  } else if (data.type === 'SANDBOX_PARAMETERS_CHANGED') {
    if (data.params) {
      currentParamsState = { ...currentParamsState, ...data.params };
    }
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
      case 'GENERATION_PROGRESS':
        if (message.payload) {
          const { step, title, detail, stageName } = message.payload;
          setMorphingProgress(step, title, detail, stageName, stageName === 'ready' ? 5000 : undefined);
          if (stageName === 'think' || stageName === 'code') setStatusPill('Synthesizing');
          if (stageName === 'test') setStatusPill('Verifying');
          if (stageName === 'load' || stageName === 'ready') setStatusPill('Active');
          if (stageName === 'error') setStatusPill('Error');
        }
        break;

      case 'SIMULATION_LOADING':
        setMorphingProgress(1, message.title || 'Harvesting Context...', message.description || '', 'think');
        setStatusPill('Synthesizing');
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
          if (message.versionIndex === 1) {
            currentVersions = [];
          }
          if (!currentVersions.some((v) => v.versionIndex === message.versionIndex)) {
            currentVersions.push({
              id: message.versionId || `ver_v${message.versionIndex}`,
              versionIndex: message.versionIndex,
              versionLabel: message.versionLabel || `v${message.versionIndex}`,
              code: message.code || activeCode,
              parameters: message.parameters || activeParameters,
              parameterState: { ...currentParamsState }
            });
          }
          renderVersionScrubber();
        }

        // Phase 3: Cloud Escalation Badge
        if (message.routingDecision) {
          activeRoutingDecision = message.routingDecision;
          renderCloudEscalation(message.routingDecision);
        }

        const simVerifyingBanner = document.getElementById('sim-verifying-banner');
        if (message.isOptimistic) {
          setStatusPill('Verifying');
          setMorphingProgress(3, 'Sandbox Pre-Flight Verification...', 'Testing in isolated offscreen sandbox', 'test');
          if (simVerifyingBanner) {
            simVerifyingBanner.style.display = 'block';
            simVerifyingBanner.textContent = '⚡ Running pre-flight safety verification in background...';
            simVerifyingBanner.style.color = '#38bdf8';
          }
        } else {
          setStatusPill('Active');
          setMorphingProgress(4, 'Simulation Ready!', 'Interactive runtime active • Explorable', 'ready', 5000);
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

        setMorphingProgress(3, 'Generation Error', message.errorMessage || 'Unable to build simulation', 'error');
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

// Toggle Code Terminal Overlay
btnToggleCodeTerminal?.addEventListener('click', () => {
  if (!codeTerminalOverlay) return;
  const isHidden = codeTerminalOverlay.style.display === 'none';
  codeTerminalOverlay.style.display = isHidden ? 'flex' : 'none';
  btnToggleCodeTerminal.classList.toggle('active', isHidden);
  const simCodePreview = document.getElementById('sim-code-preview');
  if (simCodePreview && isHidden) {
    simCodePreview.textContent = activeCode;
  }
});

const closeTerminal = () => {
  if (codeTerminalOverlay) codeTerminalOverlay.style.display = 'none';
  if (btnToggleCodeTerminal) btnToggleCodeTerminal.classList.remove('active');
};
btnCloseTerminal?.addEventListener('click', closeTerminal);
btnCloseTerminalDot?.addEventListener('click', closeTerminal);

const copyActiveCode = async (btnEl?: HTMLElement, labelEl?: HTMLElement) => {
  if (!activeCode) return;
  try {
    await navigator.clipboard.writeText(activeCode);
    if (labelEl) {
      const orig = labelEl.textContent;
      labelEl.textContent = 'Copied!';
      setTimeout(() => { if (labelEl) labelEl.textContent = orig; }, 2000);
    } else if (btnEl) {
      btnEl.style.color = '#10b981';
      setTimeout(() => { if (btnEl) btnEl.style.color = ''; }, 2000);
    }
  } catch (err) {
    console.error('Copy failed:', err);
  }
};

btnCopySimCodeInline?.addEventListener('click', () => copyActiveCode(btnCopySimCodeInline));
btnCopyTerminalCode?.addEventListener('click', () => copyActiveCode(btnCopyTerminalCode, terminalCopyText));
document.getElementById('btn-copy-sim-code')?.addEventListener('click', (e) => {
  e.stopPropagation();
  copyActiveCode();
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
/**
 * Handles 1-click state rollback (0 network calls)
 */
async function handleVersionRollback(versionId: string, versionIndex: number) {
  if (versionIndex === activeVersionIndex) return;

  // 1. Direct in-memory instant rollback
  const targetVer = currentVersions.find((v) => v.versionIndex === versionIndex || v.id === versionId);
  if (targetVer) {
    activeVersionIndex = targetVer.versionIndex;
    activeCode = targetVer.code;
    activeParameters = targetVer.parameters || [];
    currentParamsState = { ...targetVer.parameterState };

    initSimulationInIframe(activeCode, currentParamsState);
    renderControlsDock(activeParameters, currentParamsState);
    renderVersionScrubber();

    const simCodePreview = document.getElementById('sim-code-preview');
    if (simCodePreview) {
      simCodePreview.textContent = activeCode;
    }
  }

  // 2. Also notify background service worker for session persistence
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage(
      {
        type: 'VERSION_ROLLBACK_REQUEST',
        sessionId: activeSessionId,
        targetVersionId: versionId,
        versionIndex
      },
      (res: any) => {
        if (res && res.status === 'ok' && res.version && !targetVer) {
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
 * Renders pre-computed evolution chips (hidden to maximize simulation space)
 */
function renderEvolutionChips(_chips: EvolutionChip[]) {
  if (evolutionChipsDock) {
    evolutionChipsDock.style.display = 'none';
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

  // Set chat box to readonly and send button to loading
  if (refinementInput) {
    refinementInput.readOnly = true;
  }
  if (btnRefinementSend) {
    btnRefinementSend.disabled = true;
    btnRefinementSend.innerHTML = '<div class="btn-spinner"></div>';
    btnRefinementSend.title = 'Evolving simulation...';
  }

  const resetChatInput = (clearText = false) => {
    if (refinementInput) {
      refinementInput.readOnly = false;
      if (clearText) refinementInput.value = '';
      refinementInput.focus();
    }
    if (btnRefinementSend) {
      btnRefinementSend.disabled = false;
      btnRefinementSend.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
      `;
      btnRefinementSend.title = 'Send prompt or refinement';
    }
  };

  setMorphingProgress(1, 'Analyzing Refinement Intent...', 'Determining parametric tweak vs structural evolution', 'think');

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
      resetChatInput(res && res.status === 'ok');

      if (!res) {
        setMorphingProgress(3, 'Connection Error', 'No response received from background orchestrator.', 'error');
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

          setMorphingProgress(4, 'Parameter Updated (0ms overhead)', 'Direct parameter patch applied to simulation', 'ready', 4000);
          return;
        }

        if (res.intentType === 'reset_state' && res.appliedParams) {
          currentParamsState = res.appliedParams;
          postToSandbox({
            type: 'SANDBOX_UPDATE_PARAMETERS',
            params: currentParamsState
          });
          renderControlsDock(activeParameters, currentParamsState);

          setMorphingProgress(4, 'Parameters Reset', 'Restored initial module default parameters', 'ready', 4000);
          return;
        }

        if (res.intentType === 'structural_evolution' && res.evolvedCode) {
          activeCode = res.evolvedCode;
          if (res.parameters) {
            activeParameters = res.parameters;
          }

          initSimulationInIframe(activeCode, currentParamsState);
          renderControlsDock(activeParameters, currentParamsState);

          activeVersionIndex = res.versionIndex || (activeVersionIndex + 1);
          const newVerId = res.versionId || `ver_v${activeVersionIndex}_${Date.now()}`;
          currentVersions.push({
            id: newVerId,
            versionIndex: activeVersionIndex,
            versionLabel: res.versionLabel || `v${activeVersionIndex}`,
            code: activeCode,
            parameters: [...activeParameters],
            parameterState: { ...currentParamsState }
          });
          renderVersionScrubber();

          const simCodePreview = document.getElementById('sim-code-preview');
          if (simCodePreview) simCodePreview.textContent = activeCode;

          setMorphingProgress(
            4,
            `✨ Evolved to v${activeVersionIndex} successfully!`,
            `Version ${activeVersionIndex} saved to session memory`,
            'ready',
            5000
          );
          return;
        }
      }

      setMorphingProgress(3, 'Refinement Failed', res?.errorMessage || 'Unknown error occurred.', 'error');
    });
  } else {
    resetChatInput(false);
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

  setMorphingProgress(2, 'Escalating to Frontier Cloud Model...', 'Formulating context for deep reasoning tier', 'code');
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

        activeVersionIndex = res.versionIndex || (activeVersionIndex + 1);
        const newVerId = res.versionId || `ver_v${activeVersionIndex}_${Date.now()}`;
        currentVersions.push({
          id: newVerId,
          versionIndex: activeVersionIndex,
          versionLabel: res.versionLabel || `v${activeVersionIndex}`,
          code: activeCode,
          parameters: [...activeParameters],
          parameterState: { ...currentParamsState }
        });
        renderVersionScrubber();

        const simCodePreview = document.getElementById('sim-code-preview');
        if (simCodePreview) simCodePreview.textContent = activeCode;

        setStatusPill('Active');
        setMorphingProgress(
          4,
          `🚀 Frontier model generated v${activeVersionIndex}!`,
          `${res.modelName || res.provider} generation complete`,
          'ready',
          5000
        );
      } else {
        setStatusPill('Active');
        setMorphingProgress(3, 'Cloud Escalation Failed', res?.errorMessage || 'Check API key in Settings', 'error');
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

/**
 * Initializes Side Panel State on Startup
 * Inspects if a background generation is actively running (e.g. triggered via context menu)
 * If not, mounts the interactive living welcome simulation.
 */
function initSidepanelState() {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: 'GET_ACTIVE_GENERATION_STATE' }, (response) => {
      if (response && response.status === 'ok' && response.payload && response.payload.active) {
        const { step, title, detail, stageName } = response.payload;
        setMorphingProgress(step, title, detail, stageName);
        if (stageName === 'think' || stageName === 'code') setStatusPill('Synthesizing');
        if (stageName === 'test') setStatusPill('Verifying');
        return;
      }

      // If no active generation and no custom simulation loaded yet, mount welcome simulation
      if (!activeCode) {
        simTitle.textContent = 'SimIt Copilot';
        simDesc.textContent = 'Zero-prompt interactive simulations. Highlight formulas, algorithms, or concepts on any web page and right-click "SimIt" — or prompt below.';
        initSimulationInIframe(WELCOME_SIMULATION_CODE);
        setStatusPill('Ready');
      }
    });
  } else {
    if (!activeCode) {
      simTitle.textContent = 'SimIt Copilot';
      simDesc.textContent = 'Zero-prompt interactive simulations. Highlight formulas, algorithms, or concepts on any web page and right-click "SimIt" — or prompt below.';
      initSimulationInIframe(WELCOME_SIMULATION_CODE);
      setStatusPill('Ready');
    }
  }
}

// Boot up sidepanel state
initSidepanelState();

