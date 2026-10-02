/**
 * SimIt Sandboxed Execution Controller
 * Conforms to docs/specs/sandbox_ipc.md and docs/specs/agent_loop.md#71
 */

import { HostToSandboxMessage, SandboxToHostMessage } from '../types/ipc';
import { ParameterState, SimModule } from '../types/simulation';
import { sanitizeCodeFences, extractDefaultParameters } from '../runtime/preflight';

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

        activeModule = evaluator(window.d3, window.anime, window.katex, window, document);

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
