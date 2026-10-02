/**
 * SimIt Sandboxed Execution Controller
 * Conforms to docs/specs/sandbox_ipc.md and docs/specs/agent_loop.md#71
 */

import { HostToSandboxMessage, SandboxToHostMessage } from '../types/ipc';
import { ParameterState, SimModule } from '../types/simulation';
import { sanitizeCodeFences, extractDefaultParameters, normalizeSimModule } from '../runtime/preflight';

let activeModule: SimModule | null = null;
let currentParams: ParameterState = {};

declare global {
  interface Window {
    __currentSimParams?: ParameterState;
    d3?: any;
    anime?: any;
    katex?: any;
  }
}

window.__currentSimParams = currentParams;

// Global error hooks catching unhandled runtime exceptions
window.addEventListener('error', (event) => {
  const errorMsg: SandboxToHostMessage = {
    type: 'SANDBOX_RUNTIME_ERROR',
    message: event.message || 'Script error',
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error ? event.error.stack : undefined,
    currentParams: window.__currentSimParams || {}
  };
  window.parent?.postMessage(errorMsg, '*');
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const errorMsg: SandboxToHostMessage = {
    type: 'SANDBOX_RUNTIME_ERROR',
    message: reason?.message || 'Unhandled Promise Rejection',
    stack: reason?.stack,
    currentParams: window.__currentSimParams || {}
  };
  window.parent?.postMessage(errorMsg, '*');
});

// Message listener from Side Panel host
window.addEventListener('message', (event) => {
  const data = event.data as HostToSandboxMessage;
  if (!data || !data.type) return;

  const simRoot = document.getElementById('sim-root');
  if (!simRoot) return;

  switch (data.type) {
    case 'SANDBOX_INIT_SIMULATION': {
      try {
        if (activeModule && typeof activeModule.destroy === 'function') {
          activeModule.destroy();
        }
        simRoot.innerHTML = '';

        const code = sanitizeCodeFences(data.code);
        let executableCode = code;
        if (executableCode.includes('export default')) {
          executableCode = executableCode.replace(/export\s+default\s+/, 'return ');
        } else if (!executableCode.includes('return ')) {
          const classMatch = executableCode.match(/class\s+([A-Za-z0-9_$]+)/);
          if (classMatch && classMatch[1]) {
            executableCode += `\n; return ${classMatch[1]};`;
          }
        }

        const evaluator = new Function(
          'd3',
          'anime',
          'katex',
          'window',
          'document',
          `"use strict";
           ${executableCode}`
        );

        const evalResult = evaluator(window.d3, window.anime, window.katex, window, document);

        if (typeof evalResult === 'function') {
          const Cls = evalResult as any;
          activeModule = {
            title: Cls.name || 'Simulation',
            description: 'Dynamic visual simulation.',
            parameters: [],
            init(container: HTMLElement, params: any) {
              const canvas = document.createElement('canvas');
              canvas.id = 'sim-canvas';
              canvas.width = container.clientWidth || 360;
              canvas.height = 260;
              container.appendChild(canvas);
              try {
                (this as any).__instance = new Cls(canvas.id, canvas.width, canvas.height);
              } catch {
                (this as any).__instance = new Cls(container, params);
              }
            },
            update(params: any) {
              if ((this as any).__instance?.update) {
                (this as any).__instance.update(0.016, params);
              }
              if ((this as any).__instance?.draw) {
                (this as any).__instance.draw();
              }
            },
            destroy() {
              if ((this as any).__instance?.destroy) {
                (this as any).__instance.destroy();
              }
            }
          };
        } else {
          activeModule = normalizeSimModule(evalResult);
        }

        if (!activeModule || typeof activeModule.init !== 'function') {
          throw new Error('Simulation code did not produce a valid module with init() method.');
        }

        const paramsDef = Array.isArray(activeModule.parameters) ? activeModule.parameters : [];
        const defaults = extractDefaultParameters(paramsDef);
        currentParams = { ...defaults, ...(data.initialParams || {}) };
        window.__currentSimParams = currentParams;

        activeModule.init(simRoot, currentParams);

        // Notify host that simulation is ready
        const readyMsg: SandboxToHostMessage = {
          type: 'SANDBOX_SIMULATION_READY',
          title: activeModule.title || 'Simulation',
          description: activeModule.description || '',
          parameters: paramsDef
        };
        window.parent?.postMessage(readyMsg, '*');
      } catch (err: any) {
        const errorMsg: SandboxToHostMessage = {
          type: 'SANDBOX_RUNTIME_ERROR',
          message: err.message || String(err),
          stack: err.stack,
          currentParams
        };
        window.parent?.postMessage(errorMsg, '*');
      }
      break;
    }

    case 'SANDBOX_UPDATE_PARAMETERS': {
      if (!activeModule || typeof activeModule.update !== 'function') return;
      try {
        currentParams = { ...currentParams, ...(data.params || {}) };
        window.__currentSimParams = currentParams;
        activeModule.update(currentParams);
      } catch (err: any) {
        const errorMsg: SandboxToHostMessage = {
          type: 'SANDBOX_RUNTIME_ERROR',
          message: err.message || String(err),
          stack: err.stack,
          currentParams
        };
        window.parent?.postMessage(errorMsg, '*');
      }
      break;
    }

    case 'SANDBOX_DESTROY': {
      if (activeModule && typeof activeModule.destroy === 'function') {
        try {
          activeModule.destroy();
        } catch (e) {
          console.error('[Sandbox] Error destroying module:', e);
        }
      }
      simRoot.innerHTML = '';
      activeModule = null;
      break;
    }
  }
});

// Signal to host (Side Panel or Offscreen Harness) that sandbox is ready to receive code
window.parent?.postMessage({ type: 'SANDBOX_READY' }, '*');
