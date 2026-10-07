/**
 * SimIt Model Provider Resolver & Settings Storage
 * Conforms to docs/specs/model_providers.md
 */

import { BYOKStorageSettings, IModelProvider, ProviderType } from '../types/models';
import { ChromePromptApiProvider } from './prompt-api';
import { AnthropicProvider } from './anthropic';
import { GoogleGeminiProvider } from './gemini';
import { OpenAICompatibleProvider } from './openai-compatible';

export const BYOK_STORAGE_KEY = 'simit_byok_settings';

export const DEFAULT_BYOK_SETTINGS: BYOKStorageSettings = {
  activeProviderType: 'chrome-prompt-api',
  providers: {
    'chrome-prompt-api': {
      modelName: 'gemini-nano',
      temperature: 0.2
    },
    'anthropic': {
      apiKey: '',
      modelName: 'claude-3-5-sonnet-20241022',
      temperature: 0.2
    },
    'google-gemini': {
      apiKey: '',
      modelName: 'gemini-2.5-flash',
      temperature: 0.2
    },
    'openai-compatible': {
      apiKey: '',
      baseUrl: 'http://localhost:11434/v1',
      modelName: 'deepseek-r1:8b',
      temperature: 0.2
    }
  },
  fallbackToBYOKOnNanoUnavailable: true
};

/**
 * Loads BYOK settings from chrome.storage.local
 */
export async function loadBYOKSettings(): Promise<BYOKStorageSettings> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    const data = await chrome.storage.local.get(BYOK_STORAGE_KEY);
    const stored = data ? (data[BYOK_STORAGE_KEY] as Partial<BYOKStorageSettings> | undefined) : undefined;
    if (stored) {
      return {
        ...DEFAULT_BYOK_SETTINGS,
        ...stored,
        providers: {
          ...DEFAULT_BYOK_SETTINGS.providers,
          ...(stored.providers || {})
        }
      };
    }
  }
  return DEFAULT_BYOK_SETTINGS;
}

/**
 * Saves BYOK settings to chrome.storage.local
 */
export async function saveBYOKSettings(settings: BYOKStorageSettings): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set({ [BYOK_STORAGE_KEY]: settings });
  }
}

/**
 * Instantiates provider instance from configuration
 */
export function createProviderInstance(type: ProviderType, settings: BYOKStorageSettings): IModelProvider {
  switch (type) {
    case 'chrome-prompt-api': {
      const cfg = settings.providers['chrome-prompt-api'];
      return new ChromePromptApiProvider(cfg.modelName, cfg.temperature);
    }
    case 'anthropic': {
      const cfg = settings.providers['anthropic'];
      return new AnthropicProvider(cfg.apiKey, cfg.modelName, cfg.baseUrl, cfg.temperature);
    }
    case 'google-gemini': {
      const cfg = settings.providers['google-gemini'];
      return new GoogleGeminiProvider(cfg.apiKey, cfg.modelName, cfg.temperature);
    }
    case 'openai-compatible': {
      const cfg = settings.providers['openai-compatible'];
      return new OpenAICompatibleProvider(cfg.baseUrl, cfg.modelName, cfg.apiKey, cfg.temperature);
    }
    default:
      throw new Error(`Unknown provider type: ${type}`);
  }
}

/**
 * Resolves active model provider with automated fallback to BYOK
 */
export async function resolveActiveProvider(
  customSettings?: BYOKStorageSettings
): Promise<{ provider: IModelProvider; reason: string }> {
  const settings = customSettings || await loadBYOKSettings();
  const primaryProvider = createProviderInstance(settings.activeProviderType, settings);

  // Check if primary is available
  const isPrimaryAvailable = await primaryProvider.isAvailable();
  if (isPrimaryAvailable) {
    return {
      provider: primaryProvider,
      reason: `Primary provider ${settings.activeProviderType} is available.`
    };
  }

  // If primary is chrome-prompt-api and unavailable, check fallback if enabled
  if (settings.activeProviderType === 'chrome-prompt-api' && settings.fallbackToBYOKOnNanoUnavailable) {
    // Try other configured providers in order: anthropic, gemini, openai-compatible
    const candidateTypes: ProviderType[] = ['anthropic', 'google-gemini', 'openai-compatible'];
    for (const candType of candidateTypes) {
      const cand = createProviderInstance(candType, settings);
      if (await cand.isAvailable()) {
        return {
          provider: cand,
          reason: `Gemini Nano unavailable; falling back to configured BYOK provider ${candType}.`
        };
      }
    }
  }

  // Return primary anyway or throw error indicating setup needed
  return {
    provider: primaryProvider,
    reason: `Provider ${settings.activeProviderType} selected (availability check returned false; setup may be required).`
  };
}
