/**
 * Anthropic Claude Provider
 * Conforms to docs/specs/model_providers.md
 */

import { GenerationPromptPayload, GenerationResponse, IModelProvider, ProviderType } from '../types/models';
import { extractSimulationTags } from '../runtime/preflight';

export class AnthropicProvider implements IModelProvider {
  readonly type: ProviderType = 'anthropic';
  readonly isLocal: boolean = false;
  private apiKey: string;
  private modelName: string;
  private baseUrl: string;
  private temperature: number;
  private enableThinking: boolean;
  private thinkingBudgetTokens: number;

  constructor(
    apiKey: string = '',
    modelName: string = 'claude-3-5-sonnet-20241022',
    baseUrl: string = 'https://api.anthropic.com/v1',
    temperature: number = 0.2,
    enableThinking: boolean = false,
    thinkingBudgetTokens: number = 2048
  ) {
    this.apiKey = apiKey;
    this.modelName = modelName;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.temperature = temperature;
    this.enableThinking = enableThinking;
    this.thinkingBudgetTokens = thinkingBudgetTokens;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  isThinkingSupported(): boolean {
    return true;
  }

  async generateSimulation(payload: GenerationPromptPayload): Promise<GenerationResponse> {
    if (!this.apiKey) {
      throw new Error('Anthropic API key is not configured.');
    }

    const startTime = Date.now();
    const endpoint = `${this.baseUrl}/messages`;
    const shouldUseThinking = payload.enableThinking ?? this.enableThinking;

    const body: Record<string, any> = {
      model: this.modelName,
      max_tokens: payload.maxTokens || (shouldUseThinking ? 6000 : 4096),
      system: payload.systemPrompt,
      messages: [
        {
          role: 'user',
          content: payload.userPrompt
        }
      ]
    };

    if (shouldUseThinking) {
      body.thinking = {
        type: 'enabled',
        budget_tokens: payload.thinkingBudgetTokens || this.thinkingBudgetTokens
      };
      // Anthropic requires temperature: 1.0 when thinking is enabled
      body.temperature = 1.0;
    } else {
      body.temperature = payload.temperature ?? this.temperature;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'dangerously-allow-browser': 'true' // In extension service-worker context
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const durationMs = Date.now() - startTime;

    // Extract native thinking block if returned
    let nativeThinking: string | undefined;
    let textOutput = '';

    if (Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === 'thinking' && block.thinking) {
          nativeThinking = block.thinking;
        } else if (typeof block.text === 'string') {
          textOutput += block.text;
        }
      }
    }

    const parsed = extractSimulationTags(textOutput);
    const thinkingTrace = nativeThinking || parsed.thinkingTrace;

    return {
      rawCode: parsed.code,
      thinkingTrace,
      provider: this.type,
      modelName: this.modelName,
      durationMs,
      tokenCount: {
        promptTokens: data.usage?.input_tokens,
        completionTokens: data.usage?.output_tokens,
        totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
      }
    };
  }
}
