/**
 * SimIt Model Providers & BYOK Domain Types
 * Defines the contract for Local Prompt API (Gemini Nano) and BYOK providers
 * (Anthropic Claude, Google Gemini Cloud, OpenAI-compatible / Ollama).
 */

export type ProviderType = 
  | 'chrome-prompt-api' // On-device Gemini Nano / Local Gemma
  | 'anthropic'          // Anthropic Claude (e.g., claude-3-5-sonnet)
  | 'google-gemini'      // Google Gemini Cloud (e.g., gemini-2.5-flash, gemini-1.5-pro)
  | 'openai-compatible'; // Ollama, vLLM, OpenAI, or custom self-hosted endpoints

export interface ChromePromptApiCapabilities {
  available: 'readily' | 'after-download' | 'no';
  defaultTemperature?: number;
  defaultTopK?: number;
  maxTokens?: number;
}

export interface ProviderCredentials {
  apiKey?: string;
  baseUrl?: string;
  organizationId?: string;
}

export interface ModelProviderConfig {
  id: string;
  type: ProviderType;
  modelName: string;
  isLocal: boolean;
  temperature: number;
  maxOutputTokens?: number;
  credentials?: ProviderCredentials;
}

export interface BYOKStorageSettings {
  /** Active provider selected by user */
  activeProviderType: ProviderType;
  /** Custom configurations per provider */
  providers: {
    'chrome-prompt-api': {
      modelName: string;
      temperature: number;
    };
    'anthropic': {
      apiKey: string;
      modelName: string;
      baseUrl?: string;
      temperature: number;
    };
    'google-gemini': {
      apiKey: string;
      modelName: string;
      temperature: number;
    };
    'openai-compatible': {
      apiKey?: string;
      baseUrl: string;
      modelName: string;
      temperature: number;
    };
  };
  /** Whether to fallback to BYOK automatically if Gemini Nano is unavailable */
  fallbackToBYOKOnNanoUnavailable: boolean;
}

export interface GenerationPromptPayload {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface GenerationResponse {
  rawCode: string;
  provider: ProviderType;
  modelName: string;
  durationMs: number;
  tokenCount?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface IModelProvider {
  readonly type: ProviderType;
  readonly isLocal: boolean;
  isAvailable(): Promise<boolean>;
  generateSimulation(payload: GenerationPromptPayload): Promise<GenerationResponse>;
}
