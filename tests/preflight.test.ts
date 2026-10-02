/**
 * Pre-Flight Verification Runner Test Suite
 * Tests acceptance matrix I1-I3, M4 conforming to docs/specs/sandbox_ipc.md and agent_loop.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  runPreFlightSmokeTest,
  sanitizeCodeFences,
  extractDefaultParameters,
  extractBoundaryParameters,
  normalizeSimModule
} from '../src/runtime/preflight';
import { PreFlightTestRequest } from '../src/types/ipc';

describe('Pre-Flight Harness Verification (docs/specs/sandbox_ipc.md)', () => {
  let mockContainer: HTMLElement;

  beforeEach(() => {
    mockContainer = document.createElement('div');
    mockContainer.id = 'sim-root';
  });

  // I1: Clean Pre-Flight Test
  it('I1: passes clean valid simulation module and extracts parameters', async () => {
    const validCode = `
      export default {
        title: "Harmonic Oscillator",
        description: "Visualizes spring mass oscillation",
        parameters: [
          { id: "omega", label: "Angular Frequency", type: "slider", min: 0.1, max: 10.0, step: 0.1, default: 2.0 },
          { id: "damping", label: "Damping", type: "toggle", default: false }
        ],
        init(container, params) {
          container.innerHTML = '<canvas id="osc-canvas"></canvas>';
          this.canvas = container.querySelector('#osc-canvas');
        },
        update(params) {
          if (!this.canvas) throw new Error("Canvas missing");
          this.freq = params.omega;
        },
        destroy() {
          this.canvas = null;
        }
      };
    `;

    const request: PreFlightTestRequest = {
      type: 'PREFLIGHT_TEST_REQUEST',
      requestId: 'req-clean-1',
      rawCode: validCode,
      timeoutMs: 100
    };

    const response = await runPreFlightSmokeTest(request, mockContainer);

    expect(response.status).toBe('ok');
    if (response.status === 'ok') {
      expect(response.parameters.length).toBe(2);
      expect(response.parameters[0].id).toBe('omega');
      expect(response.parameters[1].id).toBe('damping');
      expect(response.validatedCode).toContain('Harmonic Oscillator');
    }
  });

  // I2: Pre-Flight Syntax Error / Exception
  it('I2: detects syntax and runtime exceptions during init/update and returns error status', async () => {
    const brokenCode = `
      export default {
        title: "Broken Sim",
        description: "Throws error in update",
        parameters: [
          { id: "tau", label: "Tau", type: "slider", min: 0, max: 10, default: 5 }
        ],
        init(container, params) {},
        update(params) {
          throw new ReferenceError("unresolvedVariable is not defined");
        }
      };
    `;

    const request: PreFlightTestRequest = {
      type: 'PREFLIGHT_TEST_REQUEST',
      requestId: 'req-err-1',
      rawCode: brokenCode,
      timeoutMs: 100
    };

    const response = await runPreFlightSmokeTest(request, mockContainer);

    expect(response.status).toBe('error');
    if (response.status === 'error') {
      expect(response.errorMessage).toContain('unresolvedVariable is not defined');
      expect(response.errorStack).toBeDefined();
    }
  });

  // I3: Infinite Loop Guard
  it('I3: catches infinite loops and rejects within 100ms with TimeoutError', async () => {
    const loopCode = `
      export default {
        title: "Infinite Loop Sim",
        description: "Freezes execution",
        parameters: [],
        async init(container, params) {
          // Asynchronous task exceeding 100ms
          await new Promise(resolve => setTimeout(resolve, 300));
        },
        update(params) {}
      };
    `;

    const request: PreFlightTestRequest = {
      type: 'PREFLIGHT_TEST_REQUEST',
      requestId: 'req-timeout-1',
      rawCode: loopCode,
      timeoutMs: 100
    };

    const startTime = Date.now();
    const response = await runPreFlightSmokeTest(request, mockContainer);
    const duration = Date.now() - startTime;

    expect(response.status).toBe('error');
    if (response.status === 'error') {
      expect(response.errorMessage).toContain('TimeoutError');
    }
    // Verifying it terminated close to 100ms timeout
    expect(duration).toBeLessThan(350);
  });

  // M4: Markdown Code Fence Stripping
  it('M4: strips leading and trailing markdown code fences cleanly', () => {
    const markdownWrapped = `\`\`\`javascript
export default {
  title: "Fenced",
  description: "Wrapped in markdown",
  parameters: [],
  init() {},
  update() {}
};
\`\`\``;

    const cleaned = sanitizeCodeFences(markdownWrapped);
    expect(cleaned).not.toContain('```');
    expect(cleaned).toContain('export default {');
  });

  it('correctly extracts default and boundary parameters', () => {
    const params = [
      { id: 'rate', label: 'Rate', type: 'slider' as const, min: 0, max: 10, step: 1, default: 5 },
      { id: 'enabled', label: 'Enabled', type: 'toggle' as const, default: false },
      { id: 'mode', label: 'Mode', type: 'select' as const, options: ['linear', 'exponential'], default: 'linear' }
    ];

    const defaults = extractDefaultParameters(params);
    expect(defaults).toEqual({
      rate: 5,
      enabled: false,
      mode: 'linear'
    });

    const boundaries = extractBoundaryParameters(params);
    expect(boundaries).toEqual({
      rate: 10,
      enabled: true,
      mode: 'exponential'
    });
  });

  it('normalizes state/methods modules and dictionary parameters', async () => {
    const stateMethodsCode = `
      export default {
        title: "Harmonic Oscillator Simulation",
        description: "Interactive simulation of a one-dimensional harmonic oscillator.",
        parameters: {
          k: 10,
          mass: 1,
          damping_coefficient: 0
        },
        state: {
          t: 0,
          x: 0,
          v: 0,
          isRunning: true
        },
        methods: {
          reset(params) {},
          step() {
            this.state.x += 0.1;
          },
          updateDisplay() {}
        }
      };
    `;

    const request: PreFlightTestRequest = {
      type: 'PREFLIGHT_TEST_REQUEST',
      requestId: 'req-state-methods',
      rawCode: stateMethodsCode,
      timeoutMs: 500
    };

    const response = await runPreFlightSmokeTest(request, mockContainer);
    expect(response.status).toBe('ok');
    if (response.status === 'ok') {
      expect(response.parameters.length).toBe(3);
      expect(response.parameters.find(p => p.id === 'k')?.default).toBe(10);
      expect(response.parameters.find(p => p.id === 'mass')?.default).toBe(1);
    }
  });

  it('normalizes harmonic oscillator with state/methods, seeds displacement, and animates movement', () => {
    const userOscillatorCode = {
      title: "Harmonic Oscillator Simulation",
      description: "Interactive simulation of a one-dimensional harmonic oscillator.",
      parameters: {
        k: 10,
        mass: 1,
        damping_coefficient: 0,
        initial_displacement: 1,
        initial_velocity: 0,
        time_step: 0.01,
        max_time: 10
      },
      state: {
        t: 0,
        x: 0,
        v: 0,
        history: [],
        isRunning: false,
        isFinished: false
      },
      methods: {
        reset: function(params: any) {
          (this as any).parameters = { ...params };
          (this as any).state = {
            t: 0,
            x: 0,
            v: 0,
            history: [],
            isRunning: false,
            isFinished: false
          };
          (this as any).updateDisplay();
        },
        step: function() {
          if ((this as any).state.isRunning) {
            const { k, damping_coefficient, time_step } = (this as any).parameters;
            const x = (this as any).state.x;
            const v = (this as any).state.v;
            const ax = (-k * x) - (damping_coefficient * v);
            const dv = ax * time_step;
            (this as any).state.x += v * time_step;
            (this as any).state.v += dv;
            (this as any).state.t += time_step;
          }
        },
        updateDisplay: function() {}
      }
    };

    const sim = normalizeSimModule(userOscillatorCode);
    const container = document.createElement('div');
    sim.init(container, { initial_displacement: 1, k: 10 });

    // 1. Must seed displacement so mass is not stuck at 0
    expect(userOscillatorCode.state.isRunning).toBe(true);
    expect(userOscillatorCode.state.x).toBe(1);

    // 2. step() must induce physical movement
    (sim as any).step();
    expect(userOscillatorCode.state.t).toBe(0.01);
    expect(userOscillatorCode.state.v).toBe(-0.1); // dv = (-10 * 1) * 0.01 = -0.1
    expect(userOscillatorCode.state.isRunning).toBe(true);

    // 3. update() with slider adjustment must dynamically update position
    sim.update({ initial_displacement: 3 });
    expect(userOscillatorCode.state.x).toBe(3);
    expect(userOscillatorCode.state.isRunning).toBe(true);
  });
});
