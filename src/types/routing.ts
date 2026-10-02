/**
 * SimIt Hybrid Multi-Model Routing & Cloud Escalation Types
 * Defines the contract for:
 * 1. Two-tier model topology (local Gemini Nano vs frontier BYOK cloud)
 * 2. Algorithmic complexity assessment
 * 3. Autonomous routing decisions and 1-click cloud escalation
 */

import { ProviderType } from './models';
import { ArchetypeType } from './archetype';

export type ModelTier = 'tier1_local' | 'tier2_cloud';

export type ComplexityLevel = 'low' | 'medium' | 'high';

export interface ComplexityIndicators {
  /** Count of mathematical symbols, equations, and LaTeX delimiters */
  mathDensity: number;
  /** Estimated state count for discrete automata or algorithmic branches */
  stateCount: number;
  /** Character length of harvested snippet */
  snippetLength: number;
  /** Whether prompt implies complex 3D perspective, matrix algebra, or ODE/PDE systems */
  requiresHighOrderMath: boolean;
  /** Whether the concept requires multi-stage animation sequencing */
  requiresMultiStageTimeline: boolean;
}

export interface ComplexityAssessment {
  score: number; // 0.0 (trivial) to 1.0 (extreme)
  level: ComplexityLevel;
  archetype: ArchetypeType;
  indicators: ComplexityIndicators;
  rationale: string;
}

export interface RoutingDecision {
  targetTier: ModelTier;
  selectedProvider: ProviderType;
  selectedModel: string;
  reason: string;
  canEscalateToCloud: boolean;
  cloudProviderAvailable: boolean;
  escalationBadgeText?: string; // e.g. "⚡ Escalate to Claude 3.5 Sonnet"
}

export interface CloudEscalationRequest {
  sessionId: string;
  currentVersionId: string;
  selectedText: string;
  mathSnippet?: string;
  currentCode: string;
  complexity: ComplexityAssessment;
  targetProvider?: ProviderType;
  targetModel?: string;
}

export interface CloudEscalationResponse {
  status: 'ok' | 'error';
  escalatedVersionId?: string;
  code?: string;
  thinkingTrace?: string;
  provider: ProviderType;
  modelName: string;
  durationMs: number;
  errorMessage?: string;
}
