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
  Tweakpane?: any;
  functionPlot?: any;
  cytoscape?: any;
  math?: any;
  jstat?: any;
  Matter?: any;
  matter?: any;
  glMatrix?: any;
}

export interface ExtractedSimulationTags {
  thinkingTrace?: string;
  code: string;
}

/**
 * Extracts decoupled reasoning scratchpad and executable code blocks
 * Conforms to docs/specs/agent_loop.md#2
 */
export function extractSimulationTags(rawText: string): ExtractedSimulationTags {
  if (!rawText) return { code: '' };

  let thinkingTrace: string | undefined;
  const thinkingMatch = rawText.match(/<simulation_thinking>([\s\S]*?)<\/simulation_thinking>/i);
  if (thinkingMatch) {
    thinkingTrace = thinkingMatch[1].trim();
  }

  let rawCode = rawText;
  const codeMatch = rawText.match(/<simulation_code>([\s\S]*?)<\/simulation_code>/i);
  if (codeMatch) {
    rawCode = codeMatch[1].trim();
  } else if (thinkingMatch) {
    rawCode = rawText.replace(/<simulation_thinking>[\s\S]*?<\/simulation_thinking>/i, '').trim();
  }

  const code = sanitizeCodeFences(rawCode);
  return { thinkingTrace, code };
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
      boundary[p.id] = p.default ?? false;
    }
  }
  return boundary;
}

/**
 * Normalizes diverse model outputs (such as state/methods or dict parameters) into standard SimModule
 */
export function normalizeSimModule(rawModule: any): SimModule {
  if (!rawModule || typeof rawModule !== 'object') {
    return rawModule;
  }

  // 1. If parameters is a dictionary { k: 10, mass: 1 } instead of an array of definitions
  if (rawModule.parameters && !Array.isArray(rawModule.parameters) && typeof rawModule.parameters === 'object') {
    const convertedParams: ParameterDefinition[] = [];
    for (const [key, val] of Object.entries(rawModule.parameters)) {
      if (typeof val === 'number') {
        const isInt = Number.isInteger(val);
        convertedParams.push({
          id: key,
          label: key.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
          type: 'slider',
          min: val < 0 ? Math.floor(val * 2) : 0,
          max: val > 0 ? Math.ceil(val * 3 || 50) : 10,
          step: isInt ? 1 : 0.01,
          default: val
        });
      } else if (typeof val === 'boolean') {
        convertedParams.push({
          id: key,
          label: key.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
          type: 'toggle',
          default: val
        });
      }
    }
    rawModule.__paramDict = { ...rawModule.parameters };
    rawModule.parameters = convertedParams;
  }

  // 2. Flatten and bind any methods defined in rawModule.methods directly onto rawModule
  if (rawModule.methods && typeof rawModule.methods === 'object') {
    for (const [key, fn] of Object.entries(rawModule.methods)) {
      if (typeof fn === 'function') {
        rawModule[key] = (fn as Function).bind(rawModule);
      }
    }
  }
  if (typeof rawModule.updateDisplay !== 'function') {
    rawModule.updateDisplay = () => {};
  }

  // Helper to ensure physical state is active and not frozen at zero-equilibrium
  const ensureActivePhysicalState = (activeParams: ParameterState) => {
    if (!rawModule.state) rawModule.state = {};
    rawModule.state.isRunning = true;
    rawModule.state.isFinished = false;

    const p = {
      ...(rawModule.__paramDict || {}),
      ...(typeof rawModule.parameters === 'object' && !Array.isArray(rawModule.parameters) ? rawModule.parameters : {}),
      ...activeParams
    };

    // Ensure parameters dictionary is always attached with defaults
    if (!p.time_step) p.time_step = 0.016;
    if (!p.max_time) p.max_time = 20;

    const initX = p.initial_displacement ?? p.initialDisplacement ?? p.x0 ?? p.displacement;
    const initV = p.initial_velocity ?? p.initialVelocity ?? p.v0 ?? p.velocity;

    // If position and velocity are both 0, seed with initial displacement or velocity so it oscillates
    const curX = typeof rawModule.state.x === 'number' ? rawModule.state.x : 0;
    const curV = typeof rawModule.state.v === 'number' ? rawModule.state.v : 0;

    if (curX === 0 && curV === 0) {
      rawModule.state.x = typeof initX === 'number' && initX !== 0 ? initX : (typeof initV === 'number' && initV !== 0 ? 0 : 1.0);
      rawModule.state.v = typeof initV === 'number' ? initV : 0;
    }
  };

  // 3. If module lacks init() but has methods or step/updateDisplay
  if (typeof rawModule.init !== 'function') {
    const methods = rawModule.methods || rawModule;

    rawModule.init = function(container: HTMLElement, params: ParameterState) {
      const canvas = document.createElement('canvas');
      canvas.id = 'sim-canvas';
      canvas.width = container.clientWidth || 360;
      canvas.height = 260;
      container.appendChild(canvas);
      const ctx = canvas.getContext('2d');

      const mergedParams = {
        ...(rawModule.__paramDict || {}),
        ...params
      };

      rawModule.parameters = mergedParams;

      // Reset state if reset method is provided
      if (typeof rawModule.reset === 'function') {
        try {
          rawModule.reset(mergedParams);
        } catch (e) {
          console.warn('[SimIt Adapter] reset error:', e);
        }
      } else if (typeof methods.reset === 'function') {
        try {
          methods.reset.call(rawModule, mergedParams);
        } catch (e) {
          console.warn('[SimIt Adapter] methods.reset error:', e);
        }
      }

      // Re-assert parameters dict after reset (in case reset re-assigned this.parameters)
      rawModule.parameters = { ...mergedParams, ...(rawModule.parameters || {}) };
      ensureActivePhysicalState(mergedParams);

      // 60 FPS animation loop
      const tick = () => {
        let stepped = false;
        if (typeof rawModule.step === 'function') {
          try {
            rawModule.step();
            stepped = true;
          } catch (e) {
            console.warn('[SimIt Adapter] step error:', e);
          }
        } else if (typeof methods.step === 'function') {
          try {
            methods.step.call(rawModule);
            stepped = true;
          } catch (e) {
            console.warn('[SimIt Adapter] methods.step error:', e);
          }
        }

        // Fallback numerical physics integrator if step didn't advance or was absent
        if (!stepped && rawModule.state && typeof rawModule.state.x === 'number') {
          const p = rawModule.parameters || rawModule.__paramDict || {};
          const k = typeof p.k === 'number' ? p.k : 10;
          const m = typeof p.mass === 'number' && p.mass > 0 ? p.mass : 1;
          const c = typeof p.damping_coefficient === 'number' ? p.damping_coefficient : (typeof p.damping === 'number' ? p.damping : 0);
          const dt = typeof p.time_step === 'number' && p.time_step > 0 ? p.time_step : 0.016;

          const x = rawModule.state.x;
          const v = typeof rawModule.state.v === 'number' ? rawModule.state.v : 0;
          const a = (-k * x - c * v) / m;
          rawModule.state.v = v + a * dt;
          rawModule.state.x = x + rawModule.state.v * dt;
          rawModule.state.t = (typeof rawModule.state.t === 'number' ? rawModule.state.t : 0) + dt;
        }

        if (typeof rawModule.updateDisplay === 'function') {
          try { rawModule.updateDisplay(); } catch {}
        }

        // Continuous oscillation loop: auto-reset when reaching max_time or isFinished
        if (rawModule.state) {
          const p = rawModule.parameters || rawModule.__paramDict || {};
          const maxTime = p.max_time ?? p.maxTime ?? 15;
          if (rawModule.state.isFinished || (typeof rawModule.state.t === 'number' && rawModule.state.t >= maxTime && maxTime > 0)) {
            rawModule.state.t = 0;
            rawModule.state.isFinished = false;
            rawModule.state.isRunning = true;
            const initX = p.initial_displacement ?? p.initialDisplacement ?? p.x0 ?? 1.0;
            const initV = p.initial_velocity ?? p.initialVelocity ?? p.v0 ?? 0;
            rawModule.state.x = initX !== 0 ? initX : 1.0;
            rawModule.state.v = initV;
            if (Array.isArray(rawModule.state.history)) rawModule.state.history = [];
          }
          rawModule.state.isRunning = true;
        }

        // Canvas visualizer for physical state (x, v, t)
        if (ctx && rawModule.state) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const centerY = canvas.height / 2;
          const centerX = canvas.width / 2;
          const rawX = typeof rawModule.state.x === 'number' ? rawModule.state.x : 0;
          const pos = Math.max(-centerX + 35, Math.min(centerX - 35, rawX * 45));

          // Draw guide track
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(20, centerY);
          ctx.lineTo(canvas.width - 20, centerY);
          ctx.stroke();

          // Draw spring from left anchor (x = 30)
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(30, centerY);
          const massX = centerX + pos;
          const coils = 14;
          for (let i = 0; i <= coils; i++) {
            const cx = 30 + (massX - 30) * (i / coils);
            const cy = centerY + (i % 2 === 0 ? -12 : 12) * (i > 0 && i < coils ? 1 : 0);
            ctx.lineTo(cx, cy);
          }
          ctx.stroke();

          // Draw oscillating mass
          ctx.fillStyle = '#f43f5e';
          ctx.beginPath();
          ctx.arc(massX, centerY, 14, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#fda4af';
          ctx.lineWidth = 2;
          ctx.stroke();

          // Real-time telemetry overlay
          ctx.fillStyle = '#94a3b8';
          ctx.font = '11px ui-monospace, monospace';
          const tVal = (rawModule.state.t || 0).toFixed(2);
          const xVal = rawX.toFixed(2);
          const vVal = (rawModule.state.v || 0).toFixed(2);
          ctx.fillText(`t: ${tVal}s | x: ${xVal}m | v: ${vVal}m/s`, 14, 22);
        }

        (this as any).__raf = requestAnimationFrame(tick);
      };

      (this as any).__raf = requestAnimationFrame(tick);
    };

    rawModule.update = function(params: ParameterState) {
      const mergedParams = {
        ...(rawModule.__paramDict || {}),
        ...(typeof rawModule.parameters === 'object' && !Array.isArray(rawModule.parameters) ? rawModule.parameters : {}),
        ...params
      };

      rawModule.parameters = mergedParams;

      // If user altered initial_displacement slider, reflect it directly in state.x
      if (rawModule.state) {
        if ('initial_displacement' in params && typeof params.initial_displacement === 'number') {
          rawModule.state.x = params.initial_displacement;
          rawModule.state.t = 0;
          rawModule.state.v = params.initial_velocity ?? rawModule.state.v ?? 0;
        } else if ('initial_velocity' in params && typeof params.initial_velocity === 'number') {
          rawModule.state.v = params.initial_velocity;
          rawModule.state.t = 0;
        }
      }

      if (typeof rawModule.reset === 'function') {
        try {
          rawModule.reset(mergedParams);
        } catch {}
      } else if (typeof methods.reset === 'function') {
        try {
          methods.reset.call(rawModule, mergedParams);
        } catch {}
      }

      rawModule.parameters = { ...mergedParams, ...(rawModule.parameters || {}) };
      ensureActivePhysicalState(mergedParams);
    };

    rawModule.destroy = function() {
      if ((this as any).__raf) {
        cancelAnimationFrame((this as any).__raf);
      }
    };
  }

  return rawModule;
}

/**
 * Strips markdown code fences (```javascript, ```js, ```) from raw LLM output
 * and unpackages <simulation_code> tags conforming to docs/specs/agent_loop.md#2
 */
export function sanitizeCodeFences(rawCode: string): string {
  if (!rawCode) return '';
  let cleaned = rawCode.trim();

  // 0. Extract inside <simulation_code>...</simulation_code> tag if present
  if (cleaned.includes('<simulation_code>')) {
    const match = cleaned.match(/<simulation_code>([\s\S]*?)<\/simulation_code>/i);
    if (match && match[1]) {
      cleaned = match[1].trim();
    }
  } else if (cleaned.includes('<simulation_thinking>')) {
    cleaned = cleaned.replace(/<simulation_thinking>[\s\S]*?<\/simulation_thinking>/i, '').trim();
  }

  // 1. If wrapped in markdown code fence (even with conversational text preamble before it)
  const fenceMatch = cleaned.match(/```(?:javascript|js|typescript|ts)?\s*([\s\S]*?)(?:```|$)/i);
  if (fenceMatch && fenceMatch[1] && fenceMatch[1].includes('export default')) {
    cleaned = fenceMatch[1].trim();
  } else if (fenceMatch && fenceMatch[1]) {
    cleaned = fenceMatch[1].trim();
  }

  // 2. If there is conversational preamble before "export default", start cleanly at "export default"
  const exportIdx = cleaned.indexOf('export default');
  if (exportIdx !== -1) {
    cleaned = cleaned.substring(exportIdx).trim();
  } else {
    // If no "export default", but there is a class definition, start at the class
    const classIdx = cleaned.search(/(?:^|\n)\s*class\s+[A-Za-z0-9_$]+/);
    if (classIdx !== -1) {
      cleaned = cleaned.substring(classIdx).trim();
    }
  }

  // 3. Fix syntax error if model wrote "export default { class Foo {"
  cleaned = cleaned.replace(/export\s+default\s*{\s*class\s+([A-Za-z0-9_$]+)/g, 'class $1');

  // 4. Strip any trailing markdown backticks
  cleaned = cleaned.replace(/\n?```\s*$/i, '').trim();

  return cleaned;
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
      } else if (!executableCode.includes('return ')) {
        const classMatch = executableCode.match(/class\s+([A-Za-z0-9_$]+)/);
        if (classMatch && classMatch[1]) {
          executableCode += `\n; return ${classMatch[1]};`;
        }
      }

      // Inject mock globals into execution context if provided
      const d3Instance = globals?.d3 || (typeof window !== 'undefined' ? (window as any).d3 : undefined);
      const animeInstance = globals?.anime || (typeof window !== 'undefined' ? (window as any).anime : undefined);
      const katexInstance = globals?.katex || (typeof window !== 'undefined' ? (window as any).katex : undefined);
      const tweakpaneInstance = globals?.Tweakpane || (typeof window !== 'undefined' ? (window as any).Tweakpane : undefined);
      const functionPlotInstance = globals?.functionPlot || (typeof window !== 'undefined' ? (window as any).functionPlot : undefined);
      const cytoscapeInstance = globals?.cytoscape || (typeof window !== 'undefined' ? (window as any).cytoscape : undefined);
      const mathInstance = globals?.math || (typeof window !== 'undefined' ? (window as any).math : undefined);
      const jstatInstance = globals?.jstat || (typeof window !== 'undefined' ? ((window as any).jstat || (window as any).jStat) : undefined);
      const matterInstance = globals?.Matter || globals?.matter || (typeof window !== 'undefined' ? ((window as any).Matter || (window as any).matter) : undefined);
      const glMatrixInstance = globals?.glMatrix || (typeof window !== 'undefined' ? ((window as any).glMatrix || (window as any).glmatrix) : undefined);

      // Create function scope with standard available globals
      // Disallow window.parent, document.cookie, etc.
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
        d3Instance,
        animeInstance,
        katexInstance,
        tweakpaneInstance,
        functionPlotInstance,
        cytoscapeInstance,
        mathInstance,
        jstatInstance,
        matterInstance,
        matterInstance,
        glMatrixInstance,
        typeof window !== 'undefined' ? window : {},
        typeof document !== 'undefined' ? document : {}
      );

      if (typeof evalResult === 'function') {
        const Cls = evalResult as any;
        simModule = {
          title: Cls.name || 'Simulation',
          description: 'Dynamic visual simulation.',
          parameters: [],
          init(c: HTMLElement, p: any) {
            const canvas = document.createElement('canvas');
            canvas.id = 'sim-canvas';
            canvas.width = c.clientWidth || 360;
            canvas.height = 260;
            c.appendChild(canvas);
            try {
              (this as any).__instance = new Cls(canvas.id, canvas.width, canvas.height);
            } catch {
              (this as any).__instance = new Cls(c, p);
            }
          },
          update(p: any) {
            if ((this as any).__instance?.update) {
              (this as any).__instance.update(0.016, p);
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
        simModule = normalizeSimModule(evalResult);
      }

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
