/**
 * SimIt Sandboxed Execution Controller
 * Conforms to docs/specs/declarative_runtime.md and docs/specs/sandbox_ipc.md
 */

import { HostToSandboxMessage, SandboxToHostMessage } from '../types/ipc';
import { ParameterState, SimModule } from '../types/simulation';
import { sanitizeCodeFences, extractDefaultParameters, normalizeSimModule } from '../runtime/preflight';

let activeModule: SimModule | null = null;
let currentParams: ParameterState = {};
let activePane: any = null;

declare global {
  interface Window {
    __currentSimParams?: ParameterState;
    d3?: any;
    anime?: any;
    katex?: any;
    Tweakpane?: any;
    functionPlot?: any;
    cytoscape?: any;
    math?: any;
    jstat?: any;
    Matter?: any;
    matter?: any;
    glMatrix?: any;
    glmatrix?: any;
  }
}

window.__currentSimParams = currentParams;
if (typeof window !== 'undefined') {
  if (!window.jstat && (window as any).jStat) {
    window.jstat = (window as any).jStat;
  }
  if (!window.matter && (window as any).Matter) {
    window.matter = (window as any).Matter;
  }
  if (!window.glmatrix && (window as any).glMatrix) {
    window.glmatrix = (window as any).glMatrix;
  }
}

function cleanupPane() {
  if (activePane) {
    try {
      if (typeof activePane.dispose === 'function') {
        activePane.dispose();
      }
    } catch (e) {
      console.warn('[Sandbox] Error disposing Tweakpane:', e);
    }
    activePane = null;
  }
  const paneDock = document.getElementById('pane-dock');
  if (paneDock) {
    paneDock.innerHTML = '';
  }
}

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
          try {
            activeModule.destroy();
          } catch (e) {
            console.warn('[Sandbox] Error destroying previous module:', e);
          }
        }
        cleanupPane();
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
          'Tweakpane',
          'functionPlot',
          'cytoscape',
          'math',
          'jstat',
          'Matter',
          'matter',
          'glMatrix',
          'window',
          'document',
          `"use strict";
           ${executableCode}`
        );

        const evalResult = evaluator(
          window.d3,
          window.anime,
          window.katex,
          window.Tweakpane,
          window.functionPlot,
          window.cytoscape,
          window.math,
          window.jstat || (window as any).jStat,
          window.Matter || (window as any).matter,
          window.Matter || (window as any).matter,
          window.glMatrix || (window as any).glmatrix,
          window,
          document
        );

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

        // Auto-dock Tweakpane controls inside #pane-dock if parameters exist
        const PaneClass = window.Tweakpane?.Pane || (typeof window.Tweakpane === 'function' ? window.Tweakpane : null);
        if (PaneClass && paramsDef.length > 0) {
          try {
            const paneDock = document.getElementById('pane-dock');
            activePane = new PaneClass({
              container: paneDock || undefined,
              title: 'Controls'
            });

            for (const p of paramsDef) {
              if (p.type === 'slider' || p.type === 'stepper') {
                activePane.addBinding(currentParams, p.id, {
                  min: p.min !== undefined ? p.min : 0,
                  max: p.max !== undefined ? p.max : 100,
                  step: p.step !== undefined ? p.step : 1,
                  label: p.label || p.id
                }).on('change', (ev: any) => {
                  currentParams[p.id] = ev.value;
                  window.__currentSimParams = currentParams;
                  if (activeModule && typeof activeModule.update === 'function') {
                    activeModule.update(currentParams);
                  }
                });
              } else if (p.type === 'toggle') {
                activePane.addBinding(currentParams, p.id, {
                  label: p.label || p.id
                }).on('change', (ev: any) => {
                  currentParams[p.id] = ev.value;
                  window.__currentSimParams = currentParams;
                  if (activeModule && typeof activeModule.update === 'function') {
                    activeModule.update(currentParams);
                  }
                });
              } else if (p.type === 'select') {
                const optionsMap: Record<string, string> = {};
                for (const opt of p.options || []) {
                  optionsMap[opt] = opt;
                }
                activePane.addBinding(currentParams, p.id, {
                  options: optionsMap,
                  label: p.label || p.id
                }).on('change', (ev: any) => {
                  currentParams[p.id] = ev.value;
                  window.__currentSimParams = currentParams;
                  if (activeModule && typeof activeModule.update === 'function') {
                    activeModule.update(currentParams);
                  }
                });
              }
            }
          } catch (tpErr) {
            console.warn('[Sandbox] Tweakpane auto-docking warning:', tpErr);
          }
        }

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
        if (activePane && typeof activePane.refresh === 'function') {
          activePane.refresh();
        }
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
      cleanupPane();
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
