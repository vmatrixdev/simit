/**
 * Google Gemini Cloud Provider (gemini-2.5-flash / gemini-2.0-flash / gemini-1.5-pro)
 * Conforms to docs/specs/model_providers.md
 */

import { GenerationPromptPayload, GenerationResponse, IModelProvider, ProviderType } from '../types/models';
import { extractSimulationTags } from '../runtime/preflight';

export class GoogleGeminiProvider implements IModelProvider {
  readonly type: ProviderType = 'google-gemini';
  readonly isLocal: boolean = false;
  private apiKey: string;
  private modelName: string;
  private temperature: number;
  private enableThinking: boolean;

  constructor(
    apiKey: string = '',
    modelName: string = 'gemini-2.0-flash',
    temperature: number = 0.2,
    enableThinking: boolean = false
  ) {
    this.apiKey = apiKey;
    this.modelName = modelName;
    this.temperature = temperature;
    this.enableThinking = enableThinking;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  isThinkingSupported(): boolean {
    return true;
  }

  async generateSimulation(payload: GenerationPromptPayload): Promise<GenerationResponse> {
    if (!this.apiKey) {
      throw new Error('Google Gemini API key is not configured.');
    }

    const startTime = Date.now();
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`;
    const shouldUseThinking = payload.enableThinking ?? this.enableThinking;

    const generationConfig: Record<string, any> = {
      temperature: payload.temperature ?? this.temperature,
      maxOutputTokens: payload.maxTokens || 4096
    };

    if (shouldUseThinking) {
      generationConfig.thinking_config = {
        thinking_budget: 2048
      };
    }

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
      generationConfig
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
    const parts = data.candidates?.[0]?.content?.parts || [];

    let nativeThinking: string | undefined;
    let textOutput = '';

    for (const part of parts) {
      if (part.thought && typeof part.text === 'string') {
        nativeThinking = (nativeThinking ? nativeThinking + '\n' : '') + part.text;
      } else if (typeof part.text === 'string') {
        textOutput += part.text;
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
        promptTokens: data.usageMetadata?.promptTokenCount,
        completionTokens: data.usageMetadata?.candidatesTokenCount,
        totalTokens: data.usageMetadata?.totalTokenCount
      }
    };
  }
}
