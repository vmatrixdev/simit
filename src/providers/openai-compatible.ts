/**
 * OpenAI-Compatible Provider (Ollama / vLLM / OpenAI / Custom base URL)
 * Conforms to docs/specs/model_providers.md
 */

import { GenerationPromptPayload, GenerationResponse, IModelProvider, ProviderType } from '../types/models';
import { extractSimulationTags } from '../runtime/preflight';

export class OpenAICompatibleProvider implements IModelProvider {
  readonly type: ProviderType = 'openai-compatible';
  readonly isLocal: boolean;
  private apiKey?: string;
  private baseUrl: string;
  private modelName: string;
  private temperature: number;

  constructor(
    baseUrl: string = 'http://localhost:11434/v1',
    modelName: string = 'deepseek-r1:8b',
    apiKey?: string,
    temperature: number = 0.2
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.modelName = modelName;
    this.apiKey = apiKey;
    this.temperature = temperature;
    this.isLocal = this.baseUrl.includes('localhost') || this.baseUrl.includes('127.0.0.1');
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Ping models endpoint or verify endpoint responds
      const res = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generateSimulation(payload: GenerationPromptPayload): Promise<GenerationResponse> {
    const startTime = Date.now();
    const endpoint = `${this.baseUrl}/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const body = {
      model: this.modelName,
      messages: [
        { role: 'system', content: payload.systemPrompt },
        { role: 'user', content: payload.userPrompt }
      ],
      temperature: payload.temperature ?? this.temperature,
      max_tokens: payload.maxTokens || 4096
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI-compatible endpoint error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const durationMs = Date.now() - startTime;
    const textOutput = data.choices?.[0]?.message?.content || '';
    const parsed = extractSimulationTags(textOutput);

    return {
      rawCode: parsed.code,
      thinkingTrace: parsed.thinkingTrace,
      provider: this.type,
      modelName: this.modelName,
      durationMs,
      tokenCount: {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens
      }
    };
  }
}
