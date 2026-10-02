/**
 * SimIt Hybrid Multi-Model Router & Complexity Assessor
 * Conforms to docs/specs/model_routing.md
 * Implements:
 * 1. Algorithmic complexity assessment
 * 2. Two-tier routing decisions (Tier 1 on-device Gemini Nano vs Tier 2 BYOK frontier cloud)
 * 3. 1-click cloud escalation recommendations
 */

import {
  ComplexityAssessment,
  ComplexityIndicators,
  ComplexityLevel,
  RoutingDecision,
  ModelTier
} from '../types/routing';
import { BYOKStorageSettings, ProviderType } from '../types/models';
import { ArchetypeType } from '../types/archetype';

const COMPLEXITY_ESCALATION_THRESHOLD = 0.7;

/**
 * Assesses the technical, mathematical, and spatial complexity of a harvested snippet.
 */
export function assessComplexity(
  text: string,
  mathSnippets: string[] = [],
  archetype: ArchetypeType = 'parameter_explorer'
): ComplexityAssessment {
  const combinedMath = mathSnippets.join(' ');
  const combinedText = `${text} ${combinedMath}`.toLowerCase();

  // 1. Math Density: search for advanced operators (sum, integral, partial derivative, nabla, product)
  const mathOperatorMatches = combinedText.match(/\\sum|\\int|\\partial|\\nabla|\\prod|\\oint|\\sqrt/gi) || [];
  const mathDensity = Math.min(1.0, mathOperatorMatches.length / 3);

  // 2. High-Order Differential / Vector / Matrix calculus
  const differentialKeywords = [
    'differential', 'navier-stokes', 'lorenz', 'attractor', 'pde', 'ode',
    'vector field', 'gradient descent', 'hessian', 'jacobian', 'eigenvalue', 'hamiltonian',
    '\\frac{d', '\\frac{\\partial'
  ];
  const requiresHighOrderMath = differentialKeywords.some((kw) => combinedText.includes(kw));
  const diffFactor = requiresHighOrderMath ? 1.0 : 0.0;

  // 3. Discrete State Count or Multi-stage timeline
  const stateKeywords = ['state', 'transition', 'markov', 'automata', 'stage', 'phase'];
  const stateMatches = combinedText.match(new RegExp(stateKeywords.join('|'), 'gi')) || [];
  const stateCount = stateMatches.length;
  const stateFactor = Math.min(1.0, stateCount / 5);

  // 4. Multi-Stage Timeline / 3D
  const requiresMultiStageTimeline = combinedText.includes('step-by-step') || combinedText.includes('timeline') || combinedText.includes('multi-stage') || combinedText.includes('3d');

  // 5. Snippet Length Budget
  const snippetLength = text.length;
  const lengthFactor = Math.min(1.0, snippetLength / 800);

  // Complexity Heuristic Formula:
  // Score = min(1.0, 0.30 * M_dense + 0.40 * O_diff + 0.15 * S_states + 0.15 * L_length)
  const rawScore = (
    0.30 * mathDensity +
    0.40 * diffFactor +
    0.15 * stateFactor +
    0.15 * lengthFactor
  );
  const score = Math.round(Math.min(1.0, rawScore) * 100) / 100;

  let level: ComplexityLevel = 'low';
  if (score >= 0.7) {
    level = 'high';
  } else if (score >= 0.35) {
    level = 'medium';
  }

  const indicators: ComplexityIndicators = {
    mathDensity,
    stateCount,
    snippetLength,
    requiresHighOrderMath,
    requiresMultiStageTimeline
  };

  let rationale = 'Standard parameter dynamic model suitable for local on-device generation.';
  if (level === 'high') {
    rationale = 'High mathematical or state complexity detected (e.g. differential equations, vector fields, or multi-step logic). Optimal for frontier cloud models.';
  } else if (level === 'medium') {
    rationale = 'Moderate complexity. Capable on Gemini Nano with potential for cloud escalation.';
  }

  return {
    score,
    level,
    archetype,
    indicators,
    rationale
  };
}

/**
 * Determines whether to route to Tier 1 (local) or Tier 2 (cloud),
 * and creates escalation badge text for the UI.
 */
export function determineRouting(
  assessment: ComplexityAssessment,
  settings: BYOKStorageSettings,
  isNanoAvailable: boolean
): RoutingDecision {
  const activeBYOK = settings.activeProviderType;
  const hasCloudConfigured = activeBYOK !== 'chrome-prompt-api' && (
    (activeBYOK === 'anthropic' && !!settings.providers.anthropic.apiKey) ||
    (activeBYOK === 'google-gemini' && !!settings.providers['google-gemini'].apiKey) ||
    (activeBYOK === 'openai-compatible' && !!settings.providers['openai-compatible'].baseUrl)
  );

  const rawModelName = settings.providers[activeBYOK]?.modelName || 'Claude 3.5 Sonnet';
  const displayModelName = rawModelName.toLowerCase().includes('claude')
    ? 'Claude 3.5 Sonnet'
    : (rawModelName.toLowerCase().includes('gemini') ? 'Gemini 2.5 Flash' : rawModelName);

  // If Gemini Nano is unavailable, fallback to BYOK
  if (!isNanoAvailable) {
    return {
      targetTier: 'tier2_cloud',
      selectedProvider: activeBYOK !== 'chrome-prompt-api' ? activeBYOK : 'anthropic',
      selectedModel: displayModelName,
      reason: 'On-device Gemini Nano is unavailable; routed to BYOK provider.',
      canEscalateToCloud: false,
      cloudProviderAvailable: hasCloudConfigured
    };
  }

  // If complexity is high and user is using a BYOK cloud provider by default
  if (assessment.score >= COMPLEXITY_ESCALATION_THRESHOLD && hasCloudConfigured) {
    return {
      targetTier: 'tier2_cloud',
      selectedProvider: activeBYOK,
      selectedModel: displayModelName,
      reason: `Complexity score (${assessment.score}) exceeds threshold (${COMPLEXITY_ESCALATION_THRESHOLD}). Routed to frontier model.`,
      canEscalateToCloud: false,
      cloudProviderAvailable: true
    };
  }

  // Default: Tier 1 On-Device Local
  return {
    targetTier: 'tier1_local',
    selectedProvider: 'chrome-prompt-api',
    selectedModel: 'gemini-nano',
    reason: 'Executed on-device via Chrome Prompt API ($0 cost, local privacy).',
    canEscalateToCloud: hasCloudConfigured || true,
    cloudProviderAvailable: hasCloudConfigured,
    escalationBadgeText: hasCloudConfigured ? `⚡ Escalate to ${displayModelName}` : '⚡ Escalate to Cloud (BYOK)'
  };
}

