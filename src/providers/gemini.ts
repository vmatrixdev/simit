/**
 * Google Gemini Cloud Provider (gemini-2.5-flash / gemini-1.5-pro)
 * Conforms to docs/specs/model_providers.md
 */

import { GenerationPromptPayload, GenerationResponse, IModelProvider, ProviderType } from '../types/models';
import { sanitizeCodeFences } from '../runtime/preflight';

export class GoogleGeminiProvider implements IModelProvider {
  readonly type: ProviderType = 'google-gemini';
  readonly isLocal: boolean = false;
  private apiKey: string;
  private modelName: string;
  private temperature: number;

  constructor(
    apiKey: string = '',
    modelName: string = 'gemini-2.5-flash',
    temperature: number = 0.2
  ) {
    this.apiKey = apiKey;
    this.modelName = modelName;
    this.temperature = temperature;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async generateSimulation(payload: GenerationPromptPayload): Promise<GenerationResponse> {
    if (!this.apiKey) {
      throw new Error('Google Gemini API key is not configured.');
    }

    const startTime = Date.now();
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`;

    const body = {
      system_instruction: {
        parts: [{ text: payload.systemPrompt }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: payload.userPrompt }]
        }
      ],
      generationConfig: {
        temperature: payload.temperature ?? this.temperature,
        maxOutputTokens: payload.maxTokens || 4096
      }
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google Gemini API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const durationMs = Date.now() - startTime;
    const textOutput = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleanCode = sanitizeCodeFences(textOutput);

    return {
      rawCode: cleanCode,
      provider: this.type,
      modelName: this.modelName,
      durationMs,
      tokenCount: {
        promptTokens: data.usageMetadata?.promptTokenCount,
        completionTokens: data.usageMetadata?.candidatesTokenCount,
        totalTokens: data.usageMetadata?.totalTokenCount
      }
    };
  }
}
