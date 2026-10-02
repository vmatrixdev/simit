/**
 * SimIt Conversational Evolution & Dual-Track Refinement Types
 * Defines the contract for:
 * 1. Pre-computed evolution chips (parametric presets vs structural evolutions)
 * 2. Natural language refinement chat interactions
 * 3. Parametric vs Structural triage (zero-latency Tweakpane updates vs LLM code generation)
 */

import { ParameterState } from './simulation';

export type EvolutionChipActionType = 
  | 'parameter_preset'      // Direct parameter update (0ms LLM overhead)
  | 'structural_refinement' // Code synthesis via LLM with context compactor
  | 'view_mode';            // UI toggle (e.g., toggle KaTeX equation overlay, reset view)

export interface EvolutionChip {
  id: string;
  label: string;
  actionType: EvolutionChipActionType;
  /** Description or tool-tip explaining what this chip does */
  description?: string;
  /** For parameter presets: specific parameter ID and value to set */
  targetParamId?: string;
  presetValue?: number | boolean | string;
  /** For parameter presets: multi-parameter batch changes */
  parameterUpdates?: ParameterState;
  /** For structural refinement: the prompt fed into the context rolling compactor */
  refinementPrompt?: string;
  /** Archetype or mathematical rationale behind this chip */
  rationale?: string;
}

export type RefinementIntentType = 
  | 'parametric_tweak'      // Matches existing parameters -> update Tweakpane directly
  | 'structural_evolution'  // New logic, formulas, visual elements -> invoke LLM
  | 'reset_state';          // Reset simulation parameters to default

export interface RefinementAnalysis {
  intentType: RefinementIntentType;
  /** Inferred parameter changes if intent is parametric */
  parameterUpdates?: ParameterState;
  /** Formatted prompt if intent is structural */
  structuralPrompt?: string;
  /** Confidence score (0.0 to 1.0) */
  confidence: number;
  /** Explanation of the triage decision */
  rationale: string;
}

export interface ConversationalTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  chipId?: string;
}

export interface EvolutionRequestPayload {
  sessionId: string;
  currentCode: string;
  analysis: RefinementAnalysis;
  userMessage?: string;
  chipId?: string;
}

export interface EvolutionResponsePayload {
  status: 'ok' | 'error';
  intentType: RefinementIntentType;
  /** Populated when parametric tweak applied directly */
  appliedParams?: ParameterState;
  /** Populated when structural refinement synthesizes new code */
  evolvedCode?: string;
  thinkingTrace?: string;
  suggestedChips?: EvolutionChip[];
  errorMessage?: string;
}
