/**
 * Anthropic Claude Provider
 * Conforms to docs/specs/model_providers.md
 */

import { GenerationPromptPayload, GenerationResponse, IModelProvider, ProviderType } from '../types/models';
import { sanitizeCodeFences } from '../runtime/preflight';

export class AnthropicProvider implements IModelProvider {
  readonly type: ProviderType = 'anthropic';
  readonly isLocal: boolean = false;
  private apiKey: string;
  private modelName: string;
  private baseUrl: string;
  private temperature: number;

  constructor(
    apiKey: string = '',
    modelName: string = 'claude-3-5-sonnet-20241022',
    baseUrl: string = 'https://api.anthropic.com/v1',
    temperature: number = 0.2
  ) {
    this.apiKey = apiKey;
    this.modelName = modelName;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.temperature = temperature;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async generateSimulation(payload: GenerationPromptPayload): Promise<GenerationResponse> {
    if (!this.apiKey) {
      throw new Error('Anthropic API key is not configured.');
    }

    const startTime = Date.now();
    const endpoint = `${this.baseUrl}/messages`;

    const body = {
      model: this.modelName,
      max_tokens: payload.maxTokens || 4096,
      temperature: payload.temperature ?? this.temperature,
      system: payload.systemPrompt,
      messages: [
        {
          role: 'user',
          content: payload.userPrompt
        }
      ]
    };

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
    const textOutput = data.content?.[0]?.text || '';
    const cleanCode = sanitizeCodeFences(textOutput);

    return {
      rawCode: cleanCode,
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
