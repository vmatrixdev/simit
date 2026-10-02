/**
 * SimIt Conversational Evolution & Dual-Track Refinement Engine
 * Conforms to docs/specs/conversational_evolution.md
 * Handles:
 * 1. Pre-computed evolution chips generation (max 4 visible)
 * 2. Intent triage: Zero-latency parametric updates vs structural LLM code generation
 */

import {
  EvolutionChip,
  RefinementAnalysis,
  RefinementIntentType
} from '../types/evolution';
import { ParameterDefinition, ParameterState } from '../types/simulation';

const MAX_VISIBLE_CHIPS = 4;

/**
 * Extracts evolution chips from thinking trace or generates intelligent archetype fallbacks.
 * Clamps visible chips to top 4 highest-confidence entries.
 */
export function extractOrGenerateChips(
  code: string,
  parameters: ParameterDefinition[] = [],
  archetype: string = 'parameter_explorer'
): EvolutionChip[] {
  const chips: EvolutionChip[] = [];

  // 1. Generate parameter preset chips from existing parameters
  for (const param of parameters) {
    if (chips.length >= MAX_VISIBLE_CHIPS) break;

    if (param.type === 'slider') {
      const maxVal = param.max;
      const minVal = param.min;
      // High-value preset chip
      chips.push({
        id: `chip-${param.id}-high`,
        label: `🔥 Max ${param.label || param.id} (${maxVal})`,
        actionType: 'parameter_preset',
        targetParamId: param.id,
        presetValue: maxVal,
        rationale: `Explore extreme boundary at max ${param.id}`
      });

      if (chips.length < MAX_VISIBLE_CHIPS) {
        // Low-value / baseline preset chip
        chips.push({
          id: `chip-${param.id}-min`,
          label: `❄️ Min ${param.label || param.id} (${minVal})`,
          actionType: 'parameter_preset',
          targetParamId: param.id,
          presetValue: minVal,
          rationale: `Explore zero/minimum baseline for ${param.id}`
        });
      }
    } else if (param.type === 'toggle') {
      chips.push({
        id: `chip-${param.id}-toggle`,
        label: `🔄 Toggle ${param.label || param.id}`,
        actionType: 'parameter_preset',
        targetParamId: param.id,
        presetValue: !param.default,
        rationale: `Invert toggle state for ${param.id}`
      });
    }
  }

  // 2. Archetype-specific structural evolution chips
  if (chips.length < MAX_VISIBLE_CHIPS) {
    if (archetype === 'parameter_explorer') {
      chips.push({
        id: 'chip-add-derivative',
        label: '📈 Plot 1st Derivative',
        actionType: 'structural_refinement',
        refinementPrompt: 'Add a secondary curve showing the first derivative f\'(x) or rate of change.',
        rationale: 'Deepens analytical understanding by visualising sensitivity and gradient'
      });
    } else if (archetype === 'step_scrubber') {
      chips.push({
        id: 'chip-auto-playback',
        label: '▶️ Auto-Play Step Timeline',
        actionType: 'structural_refinement',
        refinementPrompt: 'Add an automated playback loop with configurable stepping speed.',
        rationale: 'Enables continuous viewing without manual step scrubbing'
      });
    } else if (archetype === 'state_machine' || archetype === 'concept_dag') {
      chips.push({
        id: 'chip-highlight-path',
        label: '🎯 Highlight Critical Path',
        actionType: 'structural_refinement',
        refinementPrompt: 'Highlight the critical path / primary transition state in vibrant emerald.',
        rationale: 'Directs focus to core state sequence'
      });
    }
  }

  // 3. Fallback generic view mode chip if needed
  if (chips.length < MAX_VISIBLE_CHIPS) {
    chips.push({
      id: 'chip-reset-defaults',
      label: '🔄 Reset to Defaults',
      actionType: 'view_mode',
      rationale: 'Restore initial parameter state'
    });
  }

  return chips.slice(0, MAX_VISIBLE_CHIPS);
}

/**
 * Triages natural language user input or chip actions to determine if they can be
 * serviced immediately with 0ms LLM overhead (parametric tweak) or require code synthesis.
 */
export function triageRefinementIntent(
  userInput: string,
  activeParams: ParameterState,
  parameterDefs: ParameterDefinition[] = []
): RefinementAnalysis {
  const normalized = userInput.trim().toLowerCase();

  // 1. Check for Reset Intent
  if (
    normalized === 'reset' ||
    normalized === 'reset params' ||
    normalized === 'reset to defaults' ||
    normalized === 'default'
  ) {
    return {
      intentType: 'reset_state',
      confidence: 1.0,
      rationale: 'User explicitly requested parameter state reset.'
    };
  }

  // 2. Check for Parametric Tweak against known parameters
  const paramNames = Object.keys(activeParams);
  for (const paramName of paramNames) {
    const lowerParam = paramName.toLowerCase();
    // Patterns: "set tau to 2.5", "tau = 4", "tau: 3", "change speed to 1.5", "set tau 3.5"
    const regex = new RegExp(`(?:set\\s+|change\\s+)?${lowerParam}\\s*(?:to|=|:)?\\s*(-?\\d+(?:\\.\\d+)?)`, 'i');
    const match = normalized.match(regex);
    if (match) {
      const numVal = parseFloat(match[1]);
      if (!isNaN(numVal)) {
        return {
          intentType: 'parametric_tweak',
          parameterUpdates: { [paramName]: numVal },
          confidence: 0.95,
          rationale: `Matched direct assignment to existing parameter "${paramName}" = ${numVal}. Zero-latency update applied.`
        };
      }
    }

    // Toggle patterns: "toggle grid", "turn on grid", "turn off showLabels", "show grid"
    const toggleRegex = new RegExp(`(?:toggle|turn on|turn off|enable|disable)\\s+${lowerParam}`, 'i');
    if (toggleRegex.test(normalized)) {
      const currentVal = !!activeParams[paramName];
      const newVal = normalized.includes('turn off') || normalized.includes('disable') ? false : !currentVal;
      return {
        intentType: 'parametric_tweak',
        parameterUpdates: { [paramName]: newVal },
        confidence: 0.92,
        rationale: `Matched toggle command for parameter "${paramName}".`
      };
    }
  }

  // 3. Fallback to Structural Evolution requiring LLM synthesis
  return {
    intentType: 'structural_evolution',
    structuralPrompt: userInput,
    confidence: 0.90,
    rationale: 'User request involves code modifications, new visual elements, or algorithm adjustments.'
  };
}
