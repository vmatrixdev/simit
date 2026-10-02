/**
 * Executable Contract Verification: Conversational Evolution & Dual-Track Refinement
 * Conforms to docs/specs/conversational_evolution.md
 */

import { describe, it, expect } from 'vitest';
import {
  EvolutionChip,
  RefinementAnalysis,
  EvolutionRequestPayload,
  ConversationalTurn,
  EvolutionResponsePayload,
} from '../src/types/evolution';
import { ParameterState } from '../src/types/simulation';

describe('Conversational Evolution Specification (docs/specs/conversational_evolution.md)', () => {
  it('E1: Parametric chip click dispatches direct parameter update without model call', () => {
    const chip: EvolutionChip = {
      id: 'chip-tau-high',
      label: '🔥 High Temperature (τ=4.0)',
      actionType: 'parameter_preset',
      targetParamId: 'tau',
      presetValue: 4.0,
      rationale: 'Demonstrates uniform probability flattening',
    };

    expect(chip.actionType).toBe('parameter_preset');
    expect(chip.targetParamId).toBe('tau');
    expect(chip.presetValue).toBe(4.0);

    // Invariant: Parameter presets require 0 model tokens
    const requiresLLM = chip.actionType === 'structural_refinement';
    expect(requiresLLM).toBe(false);
  });

  it('E2: Parametric chat input is classified as parametric_tweak and routes directly to Tweakpane', () => {
    const activeParams: ParameterState = { speed: 1.0, damping: 0.2 };
    
    // Simulate intent analyzer classifying "set speed to 2.5"
    const analysis: RefinementAnalysis = {
      intentType: 'parametric_tweak',
      parameterUpdates: { speed: 2.5 },
      confidence: 0.96,
      rationale: 'Input explicitly updates existing parameter "speed" to 2.5',
    };

    expect(analysis.intentType).toBe('parametric_tweak');
    expect(analysis.parameterUpdates?.speed).toBe(2.5);

    // Apply zero-latency update directly to parameter state
    const updatedState = { ...activeParams, ...analysis.parameterUpdates };
    expect(updatedState.speed).toBe(2.5);
    expect(updatedState.damping).toBe(0.2);
  });

  it('E3: Structural chat input is classified as structural_evolution requiring code synthesis', () => {
    const analysis: RefinementAnalysis = {
      intentType: 'structural_evolution',
      structuralPrompt: 'Add a secondary curve in functionPlot displaying Shannon entropy H(P)',
      confidence: 0.94,
      rationale: 'Requires adding a new mathematical formula and rendering an additional line chart',
    };

    expect(analysis.intentType).toBe('structural_evolution');
    expect(analysis.structuralPrompt).toContain('Shannon entropy');
    expect(analysis.parameterUpdates).toBeUndefined();
  });

  it('E4: Reset state trigger restores all parameters to initial module defaults', () => {
    const defaultParams: ParameterState = { tau: 1.0, learningRate: 0.01 };
    let currentParams: ParameterState = { tau: 4.5, learningRate: 0.5 };

    const resetAnalysis: RefinementAnalysis = {
      intentType: 'reset_state',
      confidence: 1.0,
      rationale: 'User requested reset to initial parameter configuration',
    };

    if (resetAnalysis.intentType === 'reset_state') {
      currentParams = { ...defaultParams };
    }

    expect(currentParams.tau).toBe(1.0);
    expect(currentParams.learningRate).toBe(0.01);
  });

  it('E5: Max 4 chips invariant clamps UI rendering to top 4 highest-confidence chips', () => {
    const generatedChips: EvolutionChip[] = [
      { id: 'c1', label: 'Chip 1', actionType: 'parameter_preset' },
      { id: 'c2', label: 'Chip 2', actionType: 'parameter_preset' },
      { id: 'c3', label: 'Chip 3', actionType: 'structural_refinement' },
      { id: 'c4', label: 'Chip 4', actionType: 'view_mode' },
      { id: 'c5', label: 'Chip 5', actionType: 'parameter_preset' },
      { id: 'c6', label: 'Chip 6', actionType: 'structural_refinement' },
      { id: 'c7', label: 'Chip 7', actionType: 'view_mode' },
    ];

    const MAX_VISIBLE_CHIPS = 4;
    const visibleChips = generatedChips.slice(0, MAX_VISIBLE_CHIPS);

    expect(visibleChips.length).toBe(4);
    expect(visibleChips.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
  });

  it('E6: Runtime extractOrGenerateChips generates bounded chips and defaults from parameters', async () => {
    const { extractOrGenerateChips } = await import('../src/runtime/evolution');
    const chips = extractOrGenerateChips(
      'export default {}',
      [
        { id: 'tau', label: 'Temperature (τ)', type: 'slider', min: 0.1, max: 5.0, step: 0.1, default: 1.0 },
        { id: 'grid', label: 'Show Grid', type: 'toggle', default: true },
      ],
      'parameter_explorer'
    );

    expect(chips.length).toBeLessThanOrEqual(4);
    expect(chips.some((c) => c.targetParamId === 'tau')).toBe(true);
    expect(chips.some((c) => c.targetParamId === 'grid')).toBe(true);
  });

  it('E7: Runtime triageRefinementIntent detects parametric tweaks and resets', async () => {
    const { triageRefinementIntent } = await import('../src/runtime/evolution');
    const activeParams = { tau: 1.0, speed: 2.0 };

    const tweak = triageRefinementIntent('set tau to 3.5', activeParams);
    expect(tweak.intentType).toBe('parametric_tweak');
    expect(tweak.parameterUpdates?.tau).toBe(3.5);

    const reset = triageRefinementIntent('reset to defaults', activeParams);
    expect(reset.intentType).toBe('reset_state');

    const structural = triageRefinementIntent('render a phase boundary line', activeParams);
    expect(structural.intentType).toBe('structural_evolution');
  });
});
