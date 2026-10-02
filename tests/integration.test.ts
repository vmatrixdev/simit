/**
 * SimIt End-to-End Integration Test Suite
 * Tests full pipeline from Context Harvesting -> Prompting -> 1-Shot Self-Repair
 * -> Sandboxed Parameter Interaction -> Runtime Error Interception -> Standalone Export
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { harvestFromCurrentDocument } from '../src/harvester/harvester';
import { buildUserPromptFromContext, SIMULATION_SYSTEM_PROMPT } from '../src/providers/prompt-builder';
import { executePreFlightRepairLoop, executeInteractiveRepair } from '../src/runtime/repair';
import { runPreFlightSmokeTest } from '../src/runtime/preflight';
import { AtifTrajectoryLogger } from '../src/export/atif-logger';
import { generateStandaloneSimulationHtml } from '../src/export/standalone-exporter';
import { IModelProvider } from '../src/types/models';
import { PreFlightTestRequest, PreFlightTestResponse } from '../src/types/ipc';

describe('SimIt End-to-End Pipeline Integration', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('executes full zero-prompt workflow with KaTeX harvesting, 1-shot repair, and ATIF export', async () => {
    // 1. Host Page DOM Setup
    document.body.innerHTML = `
      <article>
        <h1>Quantum Mechanics</h1>
        <h2>Wave Equations</h2>
        <div id="equation-block">
          <p>The time-dependent wave equation is given by:</p>
          <span class="katex">
            <span class="katex-mathml">
              <math>
                <semantics>
                  <annotation encoding="application/x-tex">i\\hbar\\frac{\\partial}{\\partial t}\\Psi(r,t) = \\hat{H}\\Psi(r,t)</annotation>
                </semantics>
              </math>
            </span>
          </span>
          <p id="selection-p">where Psi represents the complex probability amplitude and H is the Hamiltonian operator.</p>
        </div>
      </article>
    `;

    // 2. Context Harvester
    const targetNode = document.getElementById('selection-p')!;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(targetNode);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const harvested = harvestFromCurrentDocument('https://physics.org/schrodinger', 'Schrodinger Wave Equation');

    expect(harvested.selection.documentTitle).toBe('Schrodinger Wave Equation');
    expect(harvested.selection.selectedText).toContain('probability amplitude');
    expect(harvested.domContext.nearestHeading).toBe('Wave Equations');
    expect(harvested.mathSnippets.length).toBeGreaterThanOrEqual(1);

    // 3. Prompt Composition
    const userPrompt = buildUserPromptFromContext(harvested);
    expect(userPrompt).toContain('probability amplitude');
    expect(userPrompt).toContain('Wave Equations');

    // 4. ATIF Logger initialization
    const logger = new AtifTrajectoryLogger(harvested, 'chrome-prompt-api', 'gemini-nano', true, 0.2);
    logger.recordStep('PROMPT_COMPOSE', { prompt_len: userPrompt.length });

    // 5. Model Generation with 1-shot repair
    // First generation has a typo, second generation fixes it
    const buggyCode = `
      export default {
        title: "Schrodinger Simulation",
        description: "Wave packet propagation",
        parameters: [
          { id: "hbar", label: "Planck Constant", type: "slider", min: 0.1, max: 2.0, step: 0.1, default: 1.0 }
        ],
        init(container, params) {
          container.innerHTML = '<canvas id="wave-canvas"></canvas>';
          this.canvas = container.querySelector('#wave-canvas');
        },
        update(params) {
          // Bug: typo accessing uninitialized variable
          this.energy = nonExistentVariable * params.hbar;
        }
      };
    `;

    const fixedCode = `
      export default {
        title: "Schrodinger Simulation",
        description: "Wave packet propagation",
        parameters: [
          { id: "hbar", label: "Planck Constant", type: "slider", min: 0.1, max: 2.0, step: 0.1, default: 1.0 }
        ],
        init(container, params) {
          container.innerHTML = '<canvas id="wave-canvas"></canvas>';
          this.canvas = container.querySelector('#wave-canvas');
        },
        update(params) {
          this.energy = 1.0 * params.hbar;
        }
      };
    `;

    const mockProvider: IModelProvider = {
      type: 'chrome-prompt-api',
      isLocal: true,
      isAvailable: async () => true,
      generateSimulation: vi.fn().mockResolvedValue({
        rawCode: fixedCode,
        provider: 'chrome-prompt-api',
        modelName: 'gemini-nano',
        durationMs: 300
      })
    };

    // 6. Pre-flight 1-shot self-repair loop
    const repairResult = await executePreFlightRepairLoop(
      buggyCode,
      mockProvider,
      (req) => runPreFlightSmokeTest(req, document.createElement('div'))
    );

    expect(repairResult.success).toBe(true);
    expect(repairResult.repairsNeeded).toBe(1);
    expect(repairResult.initialError).toContain('nonExistentVariable is not defined');
    expect(repairResult.parameters.length).toBe(1);
    expect(repairResult.parameters[0].id).toBe('hbar');

    if (repairResult.repairsNeeded > 0) {
      logger.recordStep('AUTO_REPAIR', { error: repairResult.initialError }, { repaired: true });
    }
    logger.recordStep('PREFLIGHT_VERIFY', { repairs_needed: 1 }, { success: true }, 50, undefined, 'PASS');
    logger.recordStep('RENDER', {}, { params: repairResult.parameters }, 10, undefined, 'MOUNTED');

    const trajectory = logger.complete(true, repairResult.code);
    expect(trajectory.outcome.success).toBe(true);
    expect(trajectory.outcome.repairs_needed).toBe(1);
    expect(trajectory.outcome.first_pass_success).toBe(false);

    // 7. Standalone Export
    const standaloneHtml = generateStandaloneSimulationHtml({
      title: 'Schrodinger Simulation',
      description: 'Wave packet propagation',
      parameters: repairResult.parameters,
      initialParams: { hbar: 1.5 },
      code: repairResult.code
    });

    expect(standaloneHtml).toContain('Schrodinger Simulation');
    expect(standaloneHtml).toContain('id="input-hbar"');
    expect(standaloneHtml).toContain('window.__simModule =');
  });

  it('handles interactive runtime repair when slider boundary triggers zero-division', async () => {
    const activeCode = `
      export default {
        title: "Wave Dispersion",
        description: "Simulates wave speed",
        parameters: [
          { id: "k", label: "Wavenumber", type: "slider", min: 0.0, max: 10.0, step: 0.5, default: 2.0 }
        ],
        init(container, params) {},
        update(params) {
          if (params.k === 0) {
            throw new Error("DivisionByZero: Wavenumber k cannot be zero");
          }
          this.wavelength = (2 * Math.PI) / params.k;
        }
      };
    `;

    const repairedCode = `
      export default {
        title: "Wave Dispersion",
        description: "Simulates wave speed",
        parameters: [
          { id: "k", label: "Wavenumber", type: "slider", min: 0.0, max: 10.0, step: 0.5, default: 2.0 }
        ],
        init(container, params) {},
        update(params) {
          const safeK = params.k === 0 ? 0.0001 : params.k;
          this.wavelength = (2 * Math.PI) / safeK;
        }
      };
    `;

    const mockProvider: IModelProvider = {
      type: 'chrome-prompt-api',
      isLocal: true,
      isAvailable: async () => true,
      generateSimulation: vi.fn().mockResolvedValue({
        rawCode: repairedCode,
        provider: 'chrome-prompt-api',
        modelName: 'gemini-nano',
        durationMs: 150
      })
    };

    const repairResult = await executeInteractiveRepair(
      activeCode,
      'DivisionByZero: Wavenumber k cannot be zero',
      'at update() line 10',
      { k: 0.0 },
      mockProvider,
      (req) => runPreFlightSmokeTest(req, document.createElement('div'))
    );

    expect(repairResult.success).toBe(true);
    expect(repairResult.code).toContain('safeK');
    expect(mockProvider.generateSimulation).toHaveBeenCalled();
  });

  it('Phase 2: Decoupled reasoning tags separates mathematical thinking from executable code', async () => {
    const rawModelOutput = `
<simulation_thinking>
1. Model: Damped harmonic oscillator with equation d2x/dt2 + 2*gamma*dx/dt + omega0^2*x = 0.
2. Coordinates: Dynamic canvas with dimensions 420x500.
3. Parameters: gamma (damping ratio) and omega (frequency).
</simulation_thinking>
<simulation_code>
export default {
  title: "Damped Harmonic Oscillator",
  description: "Phase space exploration",
  parameters: [
    { id: "gamma", label: "Damping (γ)", type: "slider", min: 0.0, max: 2.0, step: 0.1, default: 0.2 },
    { id: "omega", label: "Natural Frequency (ω)", type: "slider", min: 0.5, max: 5.0, step: 0.5, default: 2.0 }
  ],
  init(container, params) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = container.clientWidth || 420;
    this.canvas.height = container.clientHeight || 500;
    container.appendChild(this.canvas);
  },
  update(params) {
    this.decay = Math.exp(-params.gamma);
  },
  destroy() {}
};
</simulation_code>
    `;

    const mockProvider: IModelProvider = {
      type: 'anthropic',
      isLocal: false,
      isAvailable: async () => true,
      generateSimulation: vi.fn().mockResolvedValue({
        rawCode: rawModelOutput,
        provider: 'anthropic',
        modelName: 'claude-3-5-sonnet-20241022',
        durationMs: 800
      })
    };

    const res = await mockProvider.generateSimulation({
      systemPrompt: 'System',
      userPrompt: 'User'
    });

    const parsed = (await import('../src/runtime/preflight')).extractSimulationTags(res.rawCode);
    expect(parsed.thinkingTrace).toContain('Damped harmonic oscillator');
    expect(parsed.code).toContain('export default {');
    expect(parsed.code).not.toContain('<simulation_thinking>');
    expect(parsed.code).not.toContain('<simulation_code>');

    // Validate smoke test passes
    const smokeRes = await runPreFlightSmokeTest({
      type: 'PREFLIGHT_TEST_REQUEST',
      requestId: 'req-tags',
      rawCode: parsed.code,
      timeoutMs: 100
    }, document.createElement('div'));

    expect(smokeRes.status).toBe('ok');
    if (smokeRes.status === 'ok') {
      expect(smokeRes.parameters?.length).toBe(2);
    }
  });

  it('Phase 2: Archetype triage routes qualitative text to Concept DAG without meaningless motion', async () => {
    const { classifyArchetype, buildConceptDagModule } = await import('../src/runtime/triage');

    const qualitativeContext = {
      harvestId: 'h-arch',
      timestamp: new Date().toISOString(),
      selection: {
        selectedText: 'The Transformer model architecture is composed of an Encoder stack and a Decoder stack. The Encoder maps input tokens to representations.',
        characterCount: 130,
        sourceUrl: 'https://arxiv.org/abs/1706.03762',
        documentTitle: 'Attention Is All You Need'
      },
      mathSnippets: [],
      domContext: {
        nearestHeading: 'Model Architecture',
        headingLevel: 'H2',
        caption: null,
        paragraphSnippet: 'The Transformer architecture consists of...'
      }
    };

    const classification = classifyArchetype(qualitativeContext);
    expect(classification.archetype).toBe('concept_dag');
    expect(classification.isSimulatable).toBe(false);

    // Build structured fallback
    const dagModule = buildConceptDagModule({
      title: 'Transformer Architecture',
      summary: 'Hierarchical decomposition of the Transformer',
      nodes: [
        { id: 'transformer', label: 'Transformer', description: 'Overall network' },
        { id: 'encoder', label: 'Encoder', description: 'Input stack' },
        { id: 'decoder', label: 'Decoder', description: 'Output stack' }
      ],
      edges: [
        { id: 'e1', source: 'transformer', target: 'encoder', relationship: 'produces' },
        { id: 'e2', source: 'transformer', target: 'decoder', relationship: 'produces' }
      ]
    });

    expect(dagModule.title).toBe('Transformer Architecture');
    expect(dagModule.parameters[0].id).toBe('layout');

    const container = document.createElement('div');
    dagModule.init(container, { layout: 'breadthfirst' });
    expect(container.innerHTML).toContain('cy-root');
    expect(container.innerHTML).toContain('Interactive Concept DAG');
  });
});

