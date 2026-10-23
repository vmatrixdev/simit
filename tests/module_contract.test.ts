import { describe, it, expect, vi } from 'vitest';
import {
  computeStageGeometry,
  buildModuleContractPromptSection,
  dispatchParameterUpdate,
  validateSimulationModuleContract,
  CLAUSE_PROBES
} from '../src/runtime/module-contract';
import { buildCoderSystemPrompt } from '../src/runtime/agent-orchestrator';
import { buildSimulationSystemPrompt } from '../src/providers/prompt-builder';
import { ParameterDefinition } from '../src/types/simulation';

describe('Simulation Module Contract Specification (docs/specs/simulation_module_contract.md)', () => {
  describe('C1: Stage Geometry Derivation', () => {
    it('computes usable stage dimensions accounting for bottom controls drawer, explanation bar, and DPR', () => {
      const geometry = computeStageGeometry({
        viewportWidth: 380,
        viewportHeight: 600,
        controlsDrawerHeight: 44,
        explanationBarHeight: 56,
        viewportPill: { width: 150, height: 30, margin: 10 },
        devicePixelRatio: 2
      });

      expect(geometry.width).toBe(380);
      expect(geometry.height).toBe(500); // 600 - 44 - 56
      expect(geometry.dpr).toBe(2);
      expect(geometry.safeArea.bottom).toBe(50); // 30 + 2*10
    });

    it('reserves 0px drawer height when parameterCount is 0', () => {
      const geometry = computeStageGeometry(
        { viewportWidth: 380, viewportHeight: 500, controlsDrawerHeight: 44 },
        0,
        2
      );
      expect(geometry.width).toBe(380);
      expect(geometry.height).toBe(500);
      expect(geometry.dpr).toBe(2);
    });

    it('clamps DPR strictly between 1 and 3', () => {
      const geoLow = computeStageGeometry({
        viewportWidth: 400,
        viewportHeight: 500,
        controlsDrawerHeight: 0,
        viewportPill: { width: 150, height: 30, margin: 10 },
        devicePixelRatio: 0.5
      });
      expect(geoLow.dpr).toBe(1);

      const geoHigh = computeStageGeometry({
        viewportWidth: 400,
        viewportHeight: 500,
        controlsDrawerHeight: 0,
        viewportPill: { width: 150, height: 30, margin: 10 },
        devicePixelRatio: 4
      });
      expect(geoHigh.dpr).toBe(3);
    });
  });

  describe('C2 & C3: Single-Source Prompt Section & Clause Probes', () => {
    it('contains all mandatory contract clauses, explanation schema, and live parameter-driven tour rule in both Coder and Legacy prompts', () => {
      const geometry = {
        width: 380,
        height: 500,
        dpr: 2,
        safeArea: { top: 0, right: 0, bottom: 50, left: 0 }
      };

      const promptSection = buildModuleContractPromptSection(geometry);
      const lowerPrompt = promptSection.toLowerCase();

      for (const [, probes] of Object.entries(CLAUSE_PROBES)) {
        for (const probe of probes) {
          expect(lowerPrompt).toContain(probe.toLowerCase());
        }
      }

      expect(lowerPrompt).toContain('never create a tweakpane');
      expect(lowerPrompt).toContain('host renders all controls');
      expect(lowerPrompt).toContain('guided tours (`explanation.tour`) must drive the live simulation model via parameter updates (`params` passed to `update(params)`); never hardcode static frames or disconnected slides.');

      // Verify both buildCoderSystemPrompt and buildSimulationSystemPrompt embed the contract & live tour rule
      const coderPrompt = buildCoderSystemPrompt({ width: 380, height: 500 }).toLowerCase();
      const singleShotPrompt = buildSimulationSystemPrompt({ width: 380, height: 500 }).toLowerCase();
      expect(coderPrompt).toContain('never create a tweakpane');
      expect(singleShotPrompt).toContain('never create a tweakpane');
      expect(singleShotPrompt).toContain('guided tours (`explanation.tour`) must drive the live simulation model via parameter updates (`params` passed to `update(params)`); never hardcode static frames or disconnected slides.');
    });
  });

  describe('C4 & C5: Full Parameter State & Transient Button Action Semantics', () => {
    it('delivers the full merged parameter state on every update and cleans up transient button keys', () => {
      const paramDefs: ParameterDefinition[] = [
        { id: 'k', label: 'Stiffness', type: 'slider', min: 1, max: 50, step: 1, default: 10 },
        { id: 'damping', label: 'Damping', type: 'slider', min: 0, max: 5, step: 0.1, default: 0.5 },
        { id: 'pulse', label: 'Apply Impulse', type: 'button' }
      ];

      const receivedPayloads: Record<string, any>[] = [];
      const mockModule = {
        update: vi.fn((params: Record<string, any>) => {
          receivedPayloads.push({ ...params });
        })
      };

      let state: Record<string, any> = { k: 10, damping: 0.5 };

      // C4: Updating a single slider still passes full state { k: 25, damping: 0.5 }
      state = dispatchParameterUpdate(mockModule, state, paramDefs, { k: 25 });
      expect(receivedPayloads[0]).toEqual({ k: 25, damping: 0.5 });
      expect(state).toEqual({ k: 25, damping: 0.5 });

      // C5: Clicking a button passes { k: 25, damping: 0.5, pulse: true } for that call,
      // then removes `pulse` from persistent state so subsequent slider changes do not re-trigger it.
      state = dispatchParameterUpdate(mockModule, state, paramDefs, { pulse: true });
      expect(receivedPayloads[1]).toEqual({ k: 25, damping: 0.5, pulse: true });
      expect(state).toEqual({ k: 25, damping: 0.5 });
      expect('pulse' in state).toBe(false);

      state = dispatchParameterUpdate(mockModule, state, paramDefs, { damping: 1.2 });
      expect(receivedPayloads[2]).toEqual({ k: 25, damping: 1.2 });
      expect('pulse' in receivedPayloads[2]).toBe(false);
    });
  });

  describe('C6: Explanation & Guided Tour Contract Validation (Item 9)', () => {
    it('validates a complete, well-formed explanation object with zero warnings', () => {
      const validModule = {
        title: 'Damped Oscillator',
        description: 'Phase space and decay envelope',
        parameters: [
          { id: 'zeta', label: 'Damping (ζ)', type: 'slider', min: 0, max: 2, step: 0.05, default: 0.2 }
        ],
        explanation: {
          insight: 'At ζ = 1, the oscillator returns to equilibrium fastest without overshooting.',
          legend: [
            { symbol: 'x(t)', meaning: 'Displacement from equilibrium', color: '#38bdf8' },
            { symbol: '±e^{-ζω₀t}', meaning: 'Decay envelope', color: '#f43f5e' }
          ],
          tour: [
            {
              title: 'Underdamped Ringing',
              caption: 'At ζ = 0.15, energy oscillates back and forth inside the decay envelope.',
              params: { zeta: 0.15 },
              highlightSelector: '#osc-canvas'
            },
            {
              title: 'Critical Damping Threshold',
              caption: 'At ζ = 1.0, the mass settles with zero overshoot.',
              params: { zeta: 1.0 }
            }
          ]
        },
        init() {},
        update() {}
      };

      const validation = validateSimulationModuleContract(validModule);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);
      expect(validation.warnings).toEqual([]);
      expect(validation.normalizedExplanation).toBeDefined();
      expect(validation.normalizedExplanation?.insight).toContain('At ζ = 1');
      expect(validation.normalizedExplanation?.legend?.length).toBe(2);
      expect(validation.normalizedExplanation?.tour?.length).toBe(2);
    });

    it('backward compatibility: emits zero warnings when explanation is omitted on legacy modules', () => {
      const legacyModule = {
        title: 'Legacy Sim',
        parameters: [{ id: 'k', label: 'K', type: 'slider', min: 0, max: 10, default: 1 }],
        init() {},
        update() {}
      };

      const validation = validateSimulationModuleContract(legacyModule);
      expect(validation.valid).toBe(true);
      expect(validation.warnings).toEqual([]);
      expect(validation.normalizedExplanation).toBeUndefined();
    });

    it('emits warnings when explanation has missing insight, empty tour, or unknown parameter keys in tour steps', () => {
      const malformedModule = {
        title: 'Malformed Explanation Sim',
        parameters: [{ id: 'zeta', label: 'Damping', type: 'slider', min: 0, max: 2, default: 0.2 }],
        explanation: {
          insight: '',
          legend: [{ symbol: '', meaning: '' }],
          tour: [
            {
              title: 'Bad Step',
              caption: 'Uses non-existent parameter id',
              params: { nonExistentParam: 42 }
            }
          ]
        },
        init() {},
        update() {}
      };

      const validation = validateSimulationModuleContract(malformedModule);
      expect(validation.valid).toBe(true);
      expect(validation.warnings.some((w) => w.includes('explanation.insight'))).toBe(true);
      expect(validation.warnings.some((w) => w.includes('unknown parameter id "nonExistentParam"'))).toBe(true);
    });
  });
});

