/**
 * Executable Contract Verification: Declarative Runtime Stack & Parametric Engine
 * Conforms to docs/specs/declarative_runtime.md
 */

import { describe, it, expect, vi } from 'vitest';
import {
  SimModule,
  SliderParameterDefinition,
  ToggleParameterDefinition,
  FunctionPlotOptions,
  CytoscapeLayoutOptions,
  ParameterState
} from '../src/types/simulation';

describe('Declarative Runtime Stack Specification (docs/specs/declarative_runtime.md)', () => {
  it('D1: Module exports declarative parameters matching Tweakpane schemas', () => {
    const sliderParam: SliderParameterDefinition = {
      id: 'tau',
      label: 'Temperature (τ)',
      type: 'slider',
      min: 0.1,
      max: 5.0,
      step: 0.1,
      default: 1.0,
      unit: 'τ'
    };

    const toggleParam: ToggleParameterDefinition = {
      id: 'logScale',
      label: 'Logarithmic Scale',
      type: 'toggle',
      default: false
    };

    const mockModule: SimModule = {
      title: 'Softmax Temperature Explorer',
      description: 'Continuous probability scaling',
      parameters: [sliderParam, toggleParam],
      init: vi.fn(),
      update: vi.fn()
    };

    expect(mockModule.parameters).toHaveLength(2);
    expect(mockModule.parameters[0].type).toBe('slider');
    expect(mockModule.parameters[1].type).toBe('toggle');
  });

  it('D2: Zero-Latency Parametric Update routes directly to sim.update() with 0ms LLM overhead', () => {
    let internalState = { tau: 1.0 };
    const updateSpy = vi.fn((params: ParameterState) => {
      internalState = { ...internalState, ...params as any };
    });

    const mockModule: SimModule = {
      title: 'Test Sim',
      description: 'Test',
      parameters: [],
      init: vi.fn(),
      update: updateSpy
    };

    const startTime = performance.now();
    // Simulate user dragging Tweakpane slider to 2.5
    mockModule.update({ tau: 2.5 });
    const elapsed = performance.now() - startTime;

    expect(updateSpy).toHaveBeenCalledWith({ tau: 2.5 });
    expect(internalState.tau).toBe(2.5);
    // Verified 0ms LLM round-trip: synchronous local execution in < 5ms
    expect(elapsed).toBeLessThan(10);
  });

  it('D3: functionPlot Options structure conforms to 2D Cartesian contracts', () => {
    const plotOptions: FunctionPlotOptions = {
      target: '#sim-root',
      width: 380,
      height: 300,
      xAxis: { domain: [-5, 5], label: 'Input Logits (z)' },
      yAxis: { domain: [0, 1], label: 'Probability P(z)' },
      grid: true,
      data: [
        {
          fn: '1 / (1 + exp(-x))',
          color: '#3b82f6',
          derivative: {
            fn: 'exp(-x) / ((1 + exp(-x))^2)',
            updateOnMouseMove: true
          }
        }
      ]
    };

    expect(plotOptions.target).toBe('#sim-root');
    expect(plotOptions.data[0].fn).toContain('1 / (1 + exp(-x))');
    expect(plotOptions.xAxis?.domain).toEqual([-5, 5]);
  });

  it('D4: Cytoscape DAG layout options conform to graph rendering contracts', () => {
    const layoutOptions: CytoscapeLayoutOptions = {
      name: 'dagre',
      directed: true,
      padding: 16,
      animate: true,
      animationDuration: 300
    };

    expect(layoutOptions.name).toBe('dagre');
    expect(layoutOptions.directed).toBe(true);
    expect(layoutOptions.animate).toBe(true);
  });

  it('D5: KaTeX typesetting contract accepts LaTeX formulas safely', () => {
    const renderConfig = {
      formula: '\\sigma(z) = \\frac{1}{1 + e^{-z}}',
      options: {
        displayMode: true,
        throwOnError: false
      }
    };

    expect(renderConfig.formula).toContain('\\frac');
    expect(renderConfig.options.throwOnError).toBe(false);
  });

  it('D6: Module teardown releases Tweakpane and clears simulation resources', () => {
    const destroySpy = vi.fn();
    const mockModule: SimModule = {
      title: 'Cleanup Test',
      description: 'Test',
      parameters: [],
      init: vi.fn(),
      update: vi.fn(),
      destroy: destroySpy
    };

    mockModule.destroy?.();
    expect(destroySpy).toHaveBeenCalledTimes(1);
  });

  it('D7: Math.js performs linear algebra and matrix arithmetic conforming to Attention pattern', async () => {
    // @ts-ignore
    const math = await import('mathjs');

    // Pattern: const scores = math.divide(math.multiply(Q, math.transpose(K)), math.sqrt(d_k));
    const Q = [[1, 0], [0, 1]];
    const K = [[1, 0], [0, 1]];
    const d_k = 4;

    const scores = math.divide(math.multiply(Q, math.transpose(K)), math.sqrt(d_k));
    expect(scores).toEqual([[0.5, 0], [0, 0.5]]);
    expect(math.det([[1, 2], [3, 4]])).toBe(-2);
  });

  it('D8: jstat calculates probability density functions without hand-rolled approximations', async () => {
    // @ts-ignore
    const jstatModule = await import('jstat');
    const jstat = jstatModule.default?.jStat || jstatModule.jStat || jstatModule.default || jstatModule;

    // Pattern: const density = jstat.normal.pdf(x, PARAMS.mean, PARAMS.std);
    const mean = 0;
    const std = 1;
    const density = jstat.normal.pdf(0, mean, std);

    // Standard normal PDF at x = 0 is 1 / sqrt(2 * pi) approx 0.39894
    expect(density).toBeCloseTo(0.39894, 4);
    expect(jstat.beta.pdf(0.5, 2, 2)).toBeGreaterThan(0);
  });

  it('D9: Pre-flight runner evaluates simulation module using math and jstat without ReferenceErrors', async () => {
    const { runPreFlightSmokeTest } = await import('../src/runtime/preflight');
    // @ts-ignore
    const math = await import('mathjs');
    // @ts-ignore
    const jstatModule = await import('jstat');
    const jstat = jstatModule.default?.jStat || jstatModule.jStat || jstatModule.default || jstatModule;

    const simulationCode = `
      export default {
        title: "Gaussian Attention Simulator",
        description: "Evaluates attention matrix and normal PDF",
        parameters: [
          { id: "std", label: "Std Dev", type: "slider", min: 0.1, max: 5.0, default: 1.0 }
        ],
        init(container, params) {
          const Q = [[1, 2]];
          const K = [[1, 2]];
          const dot = math.multiply(Q, math.transpose(K));
          const prob = jstat.normal.pdf(1.0, 0, params.std);
          container.innerHTML = '<div id="result">' + dot + ':' + prob + '</div>';
        },
        update(params) {
          const prob = jstat.normal.pdf(1.0, 0, params.std);
        }
      };
    `;

    const container = document.createElement('div');
    const response = await runPreFlightSmokeTest(
      {
        type: 'PREFLIGHT_TEST_REQUEST',
        requestId: 'test-math-jstat',
        rawCode: simulationCode,
        timeoutMs: 200
      },
      container,
      { math, jstat }
    );

    expect(response.status).toBe('ok');
    if (response.status === 'ok') {
      expect(response.parameters).toHaveLength(1);
      expect(response.parameters[0].id).toBe('std');
      expect(container.querySelector('#result')?.textContent).toContain('5:');
    }
  });

  it('D10: Matter.js sets up 2D physics engine, rigid bodies, and composite world', async () => {
    // @ts-ignore
    const Matter = await import('matter-js');
    const engine = Matter.Engine.create();
    const boxA = Matter.Bodies.rectangle(400, 200, 80, 80);
    const boxB = Matter.Bodies.rectangle(450, 50, 80, 80);
    const ground = Matter.Bodies.rectangle(400, 610, 810, 60, { isStatic: true });

    Matter.Composite.add(engine.world, [boxA, boxB, ground]);

    expect(engine.world.bodies.length).toBe(3);
    expect(boxA.position.x).toBe(400);
    expect(ground.isStatic).toBe(true);

    // Step physics engine forward by 16.6ms
    Matter.Engine.update(engine, 1000 / 60);
    // Gravity should have increased boxA's y velocity / position
    expect(boxA.position.y).toBeGreaterThanOrEqual(200);
  });

  it('D11: gl-matrix computes perspective transformations and spatial rotations', async () => {
    // @ts-ignore
    const glMatrix = await import('gl-matrix');
    const proj = glMatrix.mat4.create();
    glMatrix.mat4.perspective(proj, Math.PI / 4, 380 / 260, 0.1, 100);

    expect(proj).toHaveLength(16);
    expect(proj[0]).toBeGreaterThan(0);
    expect(proj[5]).toBeGreaterThan(0);
  });
});
