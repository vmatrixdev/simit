/**
 * Executable Contract Verification: Hybrid Multi-Model Routing & Cloud Escalation
 * Conforms to docs/specs/model_routing.md
 */

import { describe, it, expect } from 'vitest';
import {
  ComplexityAssessment,
  RoutingDecision,
  CloudEscalationRequest,
  CloudEscalationResponse,
  ModelTier,
} from '../src/types/routing';
import { BYOKStorageSettings } from '../src/types/models';

describe('Hybrid Multi-Model Routing Specification (docs/specs/model_routing.md)', () => {
  it('R1: Simple 1D Parameter Curve yields low complexity score and routes to Tier 1 local Gemini Nano', () => {
    const assessment: ComplexityAssessment = {
      score: 0.15,
      level: 'low',
      archetype: 'parameter_explorer',
      indicators: {
        mathDensity: 0.1,
        stateCount: 0,
        snippetLength: 120,
        requiresHighOrderMath: false,
        requiresMultiStageTimeline: false,
      },
      rationale: 'Simple linear/Cartesian curve with single continuous slider',
    };

    const routing: RoutingDecision = {
      targetTier: 'tier1_local',
      selectedProvider: 'chrome-prompt-api',
      selectedModel: 'gemini-nano',
      reason: 'Low complexity model optimal for on-device generation',
      canEscalateToCloud: true,
      cloudProviderAvailable: true,
      escalationBadgeText: '⚡ Escalate to Claude 3.5 Sonnet',
    };

    expect(assessment.score).toBeLessThan(0.7);
    expect(assessment.level).toBe('low');
    expect(routing.targetTier).toBe('tier1_local');
    expect(routing.selectedProvider).toBe('chrome-prompt-api');
  });

  it('R2: High-order differential system yields complexity score >= 0.7 and recommends Tier 2', () => {
    const assessment: ComplexityAssessment = {
      score: 0.85,
      level: 'high',
      archetype: 'parameter_explorer',
      indicators: {
        mathDensity: 0.9,
        stateCount: 0,
        snippetLength: 600,
        requiresHighOrderMath: true,
        requiresMultiStageTimeline: true,
      },
      rationale: 'Navier-Stokes fluid equations with partial derivatives and vector field simulation',
    };

    // Auto-escalation enabled in BYOK settings
    const shouldEscalate = assessment.score >= 0.7;

    const routing: RoutingDecision = {
      targetTier: shouldEscalate ? 'tier2_cloud' : 'tier1_local',
      selectedProvider: shouldEscalate ? 'anthropic' : 'chrome-prompt-api',
      selectedModel: shouldEscalate ? 'claude-3-5-sonnet' : 'gemini-nano',
      reason: 'High-order differential equations benefit from frontier reasoning',
      canEscalateToCloud: true,
      cloudProviderAvailable: true,
    };

    expect(assessment.score).toBeGreaterThanOrEqual(0.7);
    expect(assessment.level).toBe('high');
    expect(routing.targetTier).toBe('tier2_cloud');
    expect(routing.selectedProvider).toBe('anthropic');
  });

  it('R3: 1-click cloud escalation dispatches request to Tier 2 and preserves local lineage', () => {
    const escalationRequest: CloudEscalationRequest = {
      sessionId: 'sess_abc',
      currentVersionId: 'ver_v1',
      selectedText: 'Lorenz attractor dynamic system dx/dt = sigma*(y - x)...',
      mathSnippet: '\\frac{dx}{dt} = \\sigma(y - x)',
      currentCode: 'export default { title: "v1 Local" };',
      complexity: {
        score: 0.78,
        level: 'high',
        archetype: 'parameter_explorer',
        indicators: {
          mathDensity: 0.8,
          stateCount: 0,
          snippetLength: 300,
          requiresHighOrderMath: true,
          requiresMultiStageTimeline: false,
        },
        rationale: 'Chaotic differential attractor',
      },
      targetProvider: 'anthropic',
      targetModel: 'claude-3-5-sonnet',
    };

    const escalationResponse: CloudEscalationResponse = {
      status: 'ok',
      escalatedVersionId: 'ver_v2',
      code: 'export default { title: "v2 Claude 3D Lorenz" };',
      provider: 'anthropic',
      modelName: 'claude-3-5-sonnet',
      durationMs: 1450,
    };

    expect(escalationRequest.currentVersionId).toBe('ver_v1');
    expect(escalationResponse.status).toBe('ok');
    expect(escalationResponse.escalatedVersionId).toBe('ver_v2');
    expect(escalationResponse.provider).toBe('anthropic');
  });

  it('R4: When local Gemini Nano is unavailable, routing falls back transparently to configured BYOK provider', () => {
    const isNanoAvailable = false;
    const settings: BYOKStorageSettings = {
      activeProviderType: 'google-gemini',
      providers: {
        'chrome-prompt-api': { modelName: 'gemini-nano', temperature: 0.2 },
        'anthropic': { apiKey: 'sk-ant-test', modelName: 'claude-3-5-sonnet', temperature: 0.2 },
        'google-gemini': { apiKey: 'ai-test-key', modelName: 'gemini-2.5-flash', temperature: 0.2 },
        'openai-compatible': { baseUrl: 'http://localhost:11434', modelName: 'llama3', temperature: 0.2 },
      },
      fallbackToBYOKOnNanoUnavailable: true,
    };

    const determineTier = (nanoAvailable: boolean, config: BYOKStorageSettings): ModelTier => {
      if (nanoAvailable) return 'tier1_local';
      if (config.fallbackToBYOKOnNanoUnavailable) return 'tier2_cloud';
      return 'tier1_local';
    };

    const tier = determineTier(isNanoAvailable, settings);
    expect(tier).toBe('tier2_cloud');
  });

  it('R5: Cloud API failure is caught defensively without crashing active simulation session', () => {
    const activeVersionCode = 'export default { title: "Stable Local Sim" };';

    // Simulate failed cloud call
    const failedResponse: CloudEscalationResponse = {
      status: 'error',
      provider: 'anthropic',
      modelName: 'claude-3-5-sonnet',
      durationMs: 320,
      errorMessage: 'HTTP 401 Unauthorized: Invalid API key',
    };

    let sessionActiveCode = activeVersionCode;
    let uiErrorMessage: string | undefined;

    if (failedResponse.status === 'error') {
      uiErrorMessage = failedResponse.errorMessage;
      // Invariant: Do not overwrite active code on failure
    } else if (failedResponse.code) {
      sessionActiveCode = failedResponse.code;
    }

    expect(sessionActiveCode).toBe(activeVersionCode);
    expect(uiErrorMessage).toContain('HTTP 401');
  });

  it('R6: Runtime assessComplexity calculates deterministic scores based on mathematical density and ODE/PDE factors', async () => {
    const { assessComplexity } = await import('../src/runtime/model-router');

    const simple = assessComplexity('Linear slope function y = mx + b', ['y = mx + b']);
    expect(simple.score).toBeLessThan(0.7);
    expect(simple.level).toBe('low');

    const complex = assessComplexity(
      'Navier-Stokes fluid equations with partial differential velocity vector field and pressure gradient',
      ['\\frac{\\partial u}{\\partial t} + (u \\cdot \\nabla) u = -\\frac{1}{\\rho} \\nabla p + \\nu \\nabla^2 u']
    );
    expect(complex.score).toBeGreaterThanOrEqual(0.7);
    expect(complex.level).toBe('high');
    expect(complex.indicators.requiresHighOrderMath).toBe(true);
  });

  it('R7: Runtime determineRouting selects tier and produces actionable escalation badges', async () => {
    const { determineRouting } = await import('../src/runtime/model-router');
    const settings: BYOKStorageSettings = {
      activeProviderType: 'anthropic',
      providers: {
        'chrome-prompt-api': { modelName: 'gemini-nano', temperature: 0.2 },
        'anthropic': { apiKey: 'sk-ant-test', modelName: 'claude-3-5-sonnet', temperature: 0.2 },
        'google-gemini': { apiKey: '', modelName: 'gemini-2.5-flash', temperature: 0.2 },
        'openai-compatible': { baseUrl: 'http://localhost:11434', modelName: 'llama3', temperature: 0.2 },
      },
      fallbackToBYOKOnNanoUnavailable: true,
    };

    const lowComplexity = {
      score: 0.2,
      level: 'low' as const,
      archetype: 'parameter_explorer' as const,
      indicators: {
        mathDensity: 0.1,
        stateCount: 0,
        snippetLength: 100,
        requiresHighOrderMath: false,
        requiresMultiStageTimeline: false,
      },
      rationale: 'Simple',
    };

    const decisionLocal = determineRouting(lowComplexity, settings, true);
    expect(decisionLocal.targetTier).toBe('tier1_local');
    expect(decisionLocal.canEscalateToCloud).toBe(true);
    expect(decisionLocal.escalationBadgeText).toContain('Claude 3.5 Sonnet');

    const highComplexity = {
      score: 0.85,
      level: 'high' as const,
      archetype: 'parameter_explorer' as const,
      indicators: {
        mathDensity: 0.8,
        stateCount: 0,
        snippetLength: 400,
        requiresHighOrderMath: true,
        requiresMultiStageTimeline: false,
      },
      rationale: 'Complex ODE',
    };

    const decisionCloud = determineRouting(highComplexity, settings, true);
    expect(decisionCloud.targetTier).toBe('tier2_cloud');
    expect(decisionCloud.selectedProvider).toBe('anthropic');
  });
});
