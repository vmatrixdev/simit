/**
 * Chrome Prompt API Provider (Gemini Nano / Local Gemma)
 * Conforms to docs/specs/model_providers.md
 */

import { GenerationPromptPayload, GenerationResponse, IModelProvider, ProviderType } from '../types/models';
import { sanitizeCodeFences } from '../runtime/preflight';

export class ChromePromptApiProvider implements IModelProvider {
  readonly type: ProviderType = 'chrome-prompt-api';
  readonly isLocal: boolean = true;
  private modelName: string;
  private temperature: number;

  constructor(modelName: string = 'gemini-nano', temperature: number = 0.2) {
    this.modelName = modelName;
    this.temperature = temperature;
  }

  private getPromptApi(): any {
    if (typeof window !== 'undefined' && (window as any).ai?.languageModel) {
      return (window as any).ai.languageModel;
    }
    if (typeof globalThis !== 'undefined' && (globalThis as any).ai?.languageModel) {
      return (globalThis as any).ai.languageModel;
    }
    return null;
  }

  async isAvailable(): Promise<boolean> {
    const api = this.getPromptApi();
    if (!api) return false;
    try {
      const caps = await api.capabilities();
      return caps && (caps.available === 'readily' || caps.available === 'after-download');
    } catch {
      return false;
    }
  }

  async generateSimulation(payload: GenerationPromptPayload): Promise<GenerationResponse> {
    const api = this.getPromptApi();
    if (!api) {
      throw new Error('Chrome Prompt API (ai.languageModel) is not available in this environment.');
    }

    const startTime = Date.now();
    const session = await api.create({
      systemPrompt: payload.systemPrompt,
      temperature: payload.temperature ?? this.temperature
    });

    try {
      const rawResult = await session.prompt(payload.userPrompt);
      const durationMs = Date.now() - startTime;
      const cleanCode = sanitizeCodeFences(rawResult);

      return {
        rawCode: cleanCode,
        provider: this.type,
        modelName: this.modelName,
        durationMs
      };
    } finally {
      if (typeof session.destroy === 'function') {
        session.destroy();
      }
    }
  }
}
