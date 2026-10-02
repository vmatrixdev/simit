/**
 * Model Providers Test Suite
 * Tests acceptance matrix M1-M5 conforming to docs/specs/model_providers.md
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChromePromptApiProvider } from '../src/providers/prompt-api';
import { AnthropicProvider } from '../src/providers/anthropic';
import { GoogleGeminiProvider } from '../src/providers/gemini';
import { OpenAICompatibleProvider } from '../src/providers/openai-compatible';
import { resolveActiveProvider, DEFAULT_BYOK_SETTINGS } from '../src/providers/resolver';
import { buildUserPromptFromContext, buildPreFlightRepairPrompt, buildInteractiveRepairPrompt, buildSimulationSystemPrompt } from '../src/providers/prompt-builder';
import { HarvestedContext } from '../src/types/harvester';

describe('Model Providers Specification Verification (docs/specs/model_providers.md)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // M1: Gemini Nano Available
  it('M1: Chrome Prompt API creates session, prompts, and sanitizes code output', async () => {
    const mockPrompt = vi.fn().mockResolvedValue(`\`\`\`javascript
export default {
  title: "Nano Sim",
  description: "Built via prompt API",
  parameters: [],
  init() {},
  update() {}
};
\`\`\``);

    const mockDestroy = vi.fn();

    // Mock global ai.languageModel
    (globalThis as any).ai = {
      languageModel: {
        capabilities: vi.fn().mockResolvedValue({ available: 'readily' }),
        create: vi.fn().mockResolvedValue({
          prompt: mockPrompt,
          destroy: mockDestroy
        })
      }
    };

    const provider = new ChromePromptApiProvider();
    expect(await provider.isAvailable()).toBe(true);

    const res = await provider.generateSimulation({
      systemPrompt: 'System instruction',
      userPrompt: 'Create sim for gravity'
    });

    expect(res.provider).toBe('chrome-prompt-api');
    expect(res.rawCode).toContain('export default {');
    expect(res.rawCode).not.toContain('```');
    expect(mockPrompt).toHaveBeenCalledWith('Create sim for gravity');
    expect(mockDestroy).toHaveBeenCalled();

    delete (globalThis as any).ai;
  });

  // M2: Nano Missing, BYOK Configured
  it('M2: falls back to configured BYOK provider (Anthropic) when Gemini Nano is unavailable', async () => {
    // ai is not present on globalThis
    delete (globalThis as any).ai;

    const customSettings = {
      ...DEFAULT_BYOK_SETTINGS,
      activeProviderType: 'chrome-prompt-api' as const,
      fallbackToBYOKOnNanoUnavailable: true,
      providers: {
        ...DEFAULT_BYOK_SETTINGS.providers,
        anthropic: {
          apiKey: 'sk-ant-test-key-12345',
          modelName: 'claude-3-5-sonnet-20241022',
          temperature: 0.2
        }
      }
    };

    const resolved = await resolveActiveProvider(customSettings);
    expect(resolved.provider.type).toBe('anthropic');
    expect(resolved.reason).toContain('falling back to configured BYOK provider anthropic');
  });

  // M3: Nano Missing, No BYOK Key
  it('M3: identifies when no keys are available and setup is needed', async () => {
    delete (globalThis as any).ai;

    const noKeysSettings = {
      ...DEFAULT_BYOK_SETTINGS,
      activeProviderType: 'chrome-prompt-api' as const,
      fallbackToBYOKOnNanoUnavailable: true,
      providers: {
        ...DEFAULT_BYOK_SETTINGS.providers,
        anthropic: { apiKey: '', modelName: 'claude-3-5-sonnet-20241022', temperature: 0.2 },
        'google-gemini': { apiKey: '', modelName: 'gemini-2.5-flash', temperature: 0.2 },
        'openai-compatible': { apiKey: '', baseUrl: 'http://localhost:11434/v1', modelName: 'deepseek-r1:8b', temperature: 0.2 }
      }
    };

    // Mock fetch failing on localhost:11434
    global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    const resolved = await resolveActiveProvider(noKeysSettings);
    expect(resolved.provider.type).toBe('chrome-prompt-api');
    expect(resolved.reason).toContain('setup may be required');
  });

  // Anthropic Provider fetch test
  it('Anthropic provider formats messages payload and returns stripped code', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        content: [{ text: 'export default { title: "Claude Sim", parameters: [], init() {}, update() {} };' }],
        usage: { input_tokens: 150, output_tokens: 250 }
      })
    } as any);

    const provider = new AnthropicProvider('sk-ant-test', 'claude-3-5-sonnet-20241022');
    const res = await provider.generateSimulation({
      systemPrompt: 'Sys',
      userPrompt: 'User prompt'
    });

    expect(res.provider).toBe('anthropic');
    expect(res.rawCode).toContain('export default { title: "Claude Sim"');
    expect(res.tokenCount?.promptTokens).toBe(150);
  });

  // Google Gemini Provider fetch test
  it('Google Gemini provider calls generativelanguage API and handles response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        candidates: [{
          content: { parts: [{ text: 'export default { title: "Gemini Sim", parameters: [], init() {}, update() {} };' }] }
        }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 200, totalTokenCount: 300 }
      })
    } as any);

    const provider = new GoogleGeminiProvider('AIzaSyTestKey', 'gemini-2.5-flash');
    const res = await provider.generateSimulation({
      systemPrompt: 'Sys prompt',
      userPrompt: 'Generate simulation'
    });

    expect(res.provider).toBe('google-gemini');
    expect(res.rawCode).toContain('export default { title: "Gemini Sim"');
    expect(res.tokenCount?.totalTokens).toBe(300);
  });

  // M5: Custom Ollama / OpenAI-compatible endpoint
  it('M5: OpenAICompatibleProvider formats /v1/chat/completions payload with custom baseUrl', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        choices: [{
          message: { content: 'export default { title: "Ollama Sim", parameters: [], init() {}, update() {} };' }
        }],
        usage: { prompt_tokens: 80, completion_tokens: 180, total_tokens: 260 }
      })
    });
    global.fetch = mockFetch;

    const provider = new OpenAICompatibleProvider('http://localhost:11434/v1', 'deepseek-r1:8b');
    const res = await provider.generateSimulation({
      systemPrompt: 'Sys',
      userPrompt: 'User prompt'
    });

    expect(res.provider).toBe('openai-compatible');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:11434/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' })
      })
    );
  });

  // Prompt Builder Verification
  it('buildUserPromptFromContext formats math equations, headings, and captions into user prompt', () => {
    const mockContext: HarvestedContext = {
      harvestId: 'h-1',
      timestamp: '2026-10-02T12:00:00Z',
      selection: {
        selectedText: 'Softmax attention over keys and queries',
        characterCount: 40,
        sourceUrl: 'https://arxiv.org/abs/1706.03762',
        documentTitle: 'Attention Paper'
      },
      mathSnippets: [
        { type: 'latex-display', latex: 'Attention(Q,K,V) = \\text{softmax}(QK^T / \\sqrt{d_k})V', raw: '$$...$$' }
      ],
      domContext: {
        nearestHeading: '3.2 Scaled Dot-Product Attention',
        headingLevel: 'H2',
        caption: 'Figure 1: Dot-Product Attention architecture',
        paragraphSnippet: 'We compute matrix multiplication of queries and keys...'
      }
    };

    const prompt = buildUserPromptFromContext(mockContext);
    expect(prompt).toContain('Softmax attention over keys and queries');
    expect(prompt).toContain('Attention(Q,K,V)');
    expect(prompt).toContain('3.2 Scaled Dot-Product Attention');
    expect(prompt).toContain('Figure 1: Dot-Product Attention architecture');
  });

  it('buildPreFlightRepairPrompt and buildInteractiveRepairPrompt produce proper repair instructions', () => {
    const preflight = buildPreFlightRepairPrompt('code;', 'TypeError: cannot read property of null', 'at line 10');
    expect(preflight.userPrompt).toContain('FAILED CODE:');
    expect(preflight.userPrompt).toContain('cannot read property of null');
    expect(preflight.userPrompt).toContain('at line 10');

    const interactive = buildInteractiveRepairPrompt('code;', 'Division by zero', { tau: 0.0 });
    expect(interactive.userPrompt).toContain('"tau": 0');
    expect(interactive.userPrompt).toContain('Division by zero');
  });

  it('buildSimulationSystemPrompt and buildUserPromptFromContext dynamically inject measured viewport bounds', () => {
    const customViewport = { width: 520, height: 640 };
    const systemPrompt = buildSimulationSystemPrompt(customViewport);
    expect(systemPrompt).toContain('width = 520px, height = 640px');
    expect(systemPrompt).toContain('canvas.width = container.clientWidth || 520');
    expect(systemPrompt).toContain('canvas.height = container.clientHeight || 640');

    const mockContext: HarvestedContext = {
      harvestId: 'h-dyn',
      timestamp: '2026-10-02T12:00:00Z',
      selection: {
        selectedText: 'Euler integration',
        characterCount: 17,
        sourceUrl: 'https://example.org',
        documentTitle: 'Numerical Methods'
      },
      mathSnippets: [],
      domContext: {
        nearestHeading: null,
        headingLevel: null,
        caption: null,
        paragraphSnippet: ''
      }
    };

    const userPrompt = buildUserPromptFromContext(mockContext, customViewport);
    expect(userPrompt).toContain('DYNAMIC VIEWPORT BOUNDS');
    expect(userPrompt).toContain('width = 520px, height = 640px');
  });
});
