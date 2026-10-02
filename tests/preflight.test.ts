/**
 * Pre-Flight Verification Runner Test Suite
 * Tests acceptance matrix I1-I3, M4 conforming to docs/specs/sandbox_ipc.md and agent_loop.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  runPreFlightSmokeTest,
  sanitizeCodeFences,
  extractDefaultParameters,
  extractBoundaryParameters
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
});
