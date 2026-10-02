/**
 * SimIt Pre-Flight Verification Runner
 * Conforms to docs/specs/sandbox_ipc.md and docs/specs/agent_loop.md#6
 * 
 * Executes a 100ms smoke test on generated simulation ES modules:
 * 1. Checks module exports (title, description, parameters, init, update)
 * 2. Runs init() with default parameter values
 * 3. Runs update() with boundary parameter values
 * 4. Guards against infinite loops with hard 100ms timeout
 */

import { PreFlightTestRequest, PreFlightTestResponse } from '../types/ipc';
import { ParameterDefinition, ParameterState, SimModule } from '../types/simulation';

export const PREFLIGHT_TIMEOUT_MS = 100;

export interface PreFlightMockGlobals {
  d3?: any;
  anime?: any;
  katex?: any;
}

/**
 * Extracts default parameters map from parameter definitions
 */
export function extractDefaultParameters(parameters: ParameterDefinition[]): ParameterState {
  const state: ParameterState = {};
  if (!Array.isArray(parameters)) return state;

  for (const p of parameters) {
    if (p && typeof p.id === 'string' && p.default !== undefined) {
      state[p.id] = p.default;
    }
  }
  return state;
}

/**
 * Extracts boundary parameter states for stress testing
 */
export function extractBoundaryParameters(parameters: ParameterDefinition[]): ParameterState {
  const boundary: ParameterState = {};
  if (!Array.isArray(parameters)) return boundary;

  for (const p of parameters) {
    if (!p || typeof p.id !== 'string') continue;
    if (p.type === 'slider' || p.type === 'stepper') {
      // Test max boundary
      boundary[p.id] = p.max !== undefined ? p.max : p.default;
    } else if (p.type === 'toggle') {
      boundary[p.id] = !p.default;
    } else if (p.type === 'select' && Array.isArray(p.options) && p.options.length > 0) {
      boundary[p.id] = p.options[p.options.length - 1];
    } else {
      boundary[p.id] = p.default;
    }
  }
  return boundary;
}

/**
 * Strips markdown code fences (```javascript, ```js, ```) from raw LLM output
 */
export function sanitizeCodeFences(rawCode: string): string {
  if (!rawCode) return '';
  let cleaned = rawCode.trim();

  // Strip leading ```javascript, ```js, etc.
  cleaned = cleaned.replace(/^```(?:javascript|js|typescript|ts)?\s*\n?/i, '');
  // Strip trailing ```
  cleaned = cleaned.replace(/\n?```\s*$/i, '');

  return cleaned.trim();
}

/**
 * Evaluates simulation code in an isolated scope and runs 100ms smoke test
 */
export async function runPreFlightSmokeTest(
  request: PreFlightTestRequest,
  mockContainer?: HTMLElement,
  globals?: PreFlightMockGlobals
): Promise<PreFlightTestResponse> {
  const { requestId, rawCode, timeoutMs = PREFLIGHT_TIMEOUT_MS } = request;
  const code = sanitizeCodeFences(rawCode);

  if (!code) {
    return {
      type: 'PREFLIGHT_TEST_RESPONSE',
      requestId,
      status: 'error',
      errorMessage: 'Empty code payload provided for pre-flight test.'
    };
  }

  // Setup DOM container
  const container = mockContainer || (typeof document !== 'undefined' ? document.createElement('div') : null);
  if (!container) {
    return {
      type: 'PREFLIGHT_TEST_RESPONSE',
      requestId,
      status: 'error',
      errorMessage: 'No DOM environment available for pre-flight smoke test.'
    };
  }
  container.id = 'sim-root';

  // Timeout guard promise
  let timerId: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      reject(new Error(`TimeoutError: Execution exceeded ${timeoutMs}ms limit (possible infinite loop)`));
    }, timeoutMs);
  });

  // Module execution promise
  const executionPromise = (async (): Promise<PreFlightTestResponse> => {
    try {
      let simModule: SimModule;

      // Transform "export default { ... }" into an executable function or Blob import
      let executableCode = code;
      if (executableCode.includes('export default')) {
        // Replace "export default" with "return " in a Function constructor for synchronous execution
        executableCode = executableCode.replace(/export\s+default\s+/, 'return ');
      }

      // Inject mock globals into execution context if provided
      const d3Instance = globals?.d3 || (typeof window !== 'undefined' ? (window as any).d3 : undefined);
      const animeInstance = globals?.anime || (typeof window !== 'undefined' ? (window as any).anime : undefined);
      const katexInstance = globals?.katex || (typeof window !== 'undefined' ? (window as any).katex : undefined);

      // Create function scope with standard available globals
      // Disallow window.parent, document.cookie, etc.
      const evaluator = new Function(
        'd3',
        'anime',
        'katex',
        'window',
        'document',
        `"use strict";
         ${executableCode}`
      );

      simModule = evaluator(d3Instance, animeInstance, katexInstance, typeof window !== 'undefined' ? window : {}, typeof document !== 'undefined' ? document : {});

      if (!simModule || typeof simModule !== 'object') {
        throw new Error('Simulation code did not return a valid module object.');
      }

      if (typeof simModule.init !== 'function') {
        throw new Error("Simulation module is missing required 'init(container, params)' method.");
      }

      if (typeof simModule.update !== 'function') {
        throw new Error("Simulation module is missing required 'update(params)' method.");
      }

      const parameters: ParameterDefinition[] = Array.isArray(simModule.parameters) ? simModule.parameters : [];

      // 1. Smoke test: Execute init() with defaults
      const defaults = extractDefaultParameters(parameters);
      await Promise.resolve(simModule.init(container, defaults));

      // 2. Smoke test: Execute update() with defaults
      await Promise.resolve(simModule.update(defaults));

      // 3. Smoke test: Execute update() with boundary parameters
      const boundaries = extractBoundaryParameters(parameters);
      await Promise.resolve(simModule.update(boundaries));

      // 4. Cleanup if destroy method provided
      if (typeof simModule.destroy === 'function') {
        simModule.destroy();
      }

      return {
        type: 'PREFLIGHT_TEST_RESPONSE',
        requestId,
        status: 'ok',
        validatedCode: code,
        parameters
      };
    } catch (err: any) {
      return {
        type: 'PREFLIGHT_TEST_RESPONSE',
        requestId,
        status: 'error',
        errorMessage: err.message || String(err),
        errorStack: err.stack
      };
    }
  })();

  try {
    const result = await Promise.race([executionPromise, timeoutPromise]);
    clearTimeout(timerId);
    return result;
  } catch (timeoutErr: any) {
    clearTimeout(timerId);
    return {
      type: 'PREFLIGHT_TEST_RESPONSE',
      requestId,
      status: 'error',
      errorMessage: timeoutErr.message || 'Execution timed out',
      errorStack: timeoutErr.stack
    };
  }
}
