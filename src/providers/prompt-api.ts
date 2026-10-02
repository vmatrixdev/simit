/**
 * Chrome Prompt API Provider (Gemini Nano / Local Gemma)
 * Conforms to docs/specs/model_providers.md and W3C/WICG LanguageModel specifications.
 * Supports both direct execution (Window/Worker) and offscreen document delegation
 * for Chrome extension service workers where window/DOM globals are not directly attached.
 */

import { GenerationPromptPayload, GenerationResponse, IModelProvider, ProviderType } from '../types/models';
import { extractSimulationTags } from '../runtime/preflight';
import { ensureOffscreenDocument } from '../runtime/offscreen-manager';
import { PromptApiCheckResponse, PromptApiGenerateResponse } from '../types/ipc';

export class ChromePromptApiProvider implements IModelProvider {
  readonly type: ProviderType = 'chrome-prompt-api';
  readonly isLocal: boolean = true;
  private modelName: string;
  private temperature: number;

  constructor(modelName: string = 'gemini-nano', temperature: number = 0.2) {
    this.modelName = modelName;
    this.temperature = temperature;
  }

  /**
   * Discovers the Prompt API across W3C LanguageModel, chrome.languageModel, and ai.languageModel
   */
  getPromptApi(): any {
    // 1. self.LanguageModel / globalThis.LanguageModel / window.LanguageModel (W3C draft)
    if (typeof self !== 'undefined' && (self as any).LanguageModel) {
      return (self as any).LanguageModel;
    }
    if (typeof globalThis !== 'undefined' && (globalThis as any).LanguageModel) {
      return (globalThis as any).LanguageModel;
    }
    if (typeof window !== 'undefined' && (window as any).LanguageModel) {
      return (window as any).LanguageModel;
    }

    // 2. chrome.languageModel namespace
    if (typeof chrome !== 'undefined' && (chrome as any).languageModel) {
      return (chrome as any).languageModel;
    }

    // 3. Early window.ai / self.ai / globalThis.ai.languageModel
    if (typeof self !== 'undefined' && (self as any).ai?.languageModel) {
      return (self as any).ai.languageModel;
    }
    if (typeof globalThis !== 'undefined' && (globalThis as any).ai?.languageModel) {
      return (globalThis as any).ai.languageModel;
    }
    if (typeof window !== 'undefined' && (window as any).ai?.languageModel) {
      return (window as any).ai.languageModel;
    }

    return null;
  }

  /**
   * Directly checks if Prompt API is available in the current context
   */
  async isAvailableDirect(): Promise<boolean> {
    const api = this.getPromptApi();
    if (!api) return false;

    try {
      // 1. W3C LanguageModel.availability()
      if (typeof api.availability === 'function') {
        let avail: any;
        try {
          avail = await api.availability({
            expectedInputLanguages: ['en'],
            expectedOutputLanguages: ['en']
          });
        } catch {
          avail = await api.availability();
        }
        return (
          avail === 'readily' ||
          avail === 'available' ||
          avail === 'after-download' ||
          avail === 'downloadable' ||
          avail === 'downloading' ||
          avail === true
        );
      }

      // 2. W3C LanguageModel.available()
      if (typeof api.available === 'function') {
        let avail: any;
        try {
          avail = await api.available({
            expectedInputLanguages: ['en'],
            expectedOutputLanguages: ['en']
          });
        } catch {
          avail = await api.available();
        }
        return (
          avail === 'readily' ||
          avail === 'available' ||
          avail === 'after-download' ||
          avail === 'downloadable' ||
          avail === 'downloading' ||
          avail === true
        );
      }

      // 3. window.ai.languageModel.capabilities()
      if (typeof api.capabilities === 'function') {
        const caps = await api.capabilities();
        const available = caps?.available;
        return (
          available === 'readily' ||
          available === 'available' ||
          available === 'after-download' ||
          available === 'downloadable' ||
          available === 'downloading' ||
          available === true
        );
      }

      return typeof api.create === 'function';
    } catch (err) {
      console.warn('[SimIt Prompt API] isAvailableDirect error:', err);
      return false;
    }
  }

  /**
   * Checks availability in current context or probes offscreen Window document
   */
  async isAvailable(): Promise<boolean> {
    // 1. Check local execution context
    if (await this.isAvailableDirect()) {
      return true;
    }

    // 2. If not found locally (e.g. running in Service Worker), check offscreen Window document
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage && chrome.offscreen) {
      try {
        await ensureOffscreenDocument();
        return await new Promise<boolean>((resolve) => {
          chrome.runtime.sendMessage(
            { type: 'PROMPT_API_CHECK_REQUEST' },
            (res: PromptApiCheckResponse) => {
              if (chrome.runtime.lastError || !res) {
                resolve(false);
              } else {
                resolve(!!res.available);
              }
            }
          );
        });
      } catch (err) {
        console.warn('[SimIt Prompt API] Offscreen check probe error:', err);
        return false;
      }
    }

    return false;
  }

  /**
   * Directly invokes the Prompt API in a context where it is exposed
   */
  async generateDirect(payload: GenerationPromptPayload): Promise<GenerationResponse> {
    const api = this.getPromptApi();
    if (!api) {
      throw new Error(
        'Chrome Prompt API (LanguageModel / ai.languageModel) is not available in this context.'
      );
    }

    const startTime = Date.now();
    let session: any;

    let defaultTopK = 3;
    try {
      if (typeof api.capabilities === 'function') {
        const caps = await api.capabilities();
        if (caps && typeof caps.defaultTopK === 'number') {
          defaultTopK = caps.defaultTopK;
        }
      } else if (typeof api.params === 'function') {
        const params = await api.params();
        if (params && typeof params.defaultTopK === 'number') {
          defaultTopK = params.defaultTopK;
        }
      }
    } catch {}

    const targetTemp = payload.temperature ?? this.temperature;

    const monitorProgress = (m: any) => {
      if (m && typeof m.addEventListener === 'function') {
        m.addEventListener('downloadprogress', (e: any) => {
          // If total is 0 or loaded equals total, model is already cached/downloaded
          if (!e.total || e.loaded >= e.total) {
            if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
              chrome.runtime.sendMessage({
                type: 'SIMULATION_LOADING',
                title: 'Model Ready',
                description: 'Gemini Nano loaded. Initializing session...'
              }).catch(() => {});
            }
            return;
          }

          const pct = Math.round((e.loaded / e.total) * 100);
          const mbLoaded = (e.loaded / (1024 * 1024)).toFixed(1);
          const mbTotal = (e.total / (1024 * 1024)).toFixed(1);
          console.log(`[SimIt Prompt API] Download progress: ${mbLoaded}MB / ${mbTotal}MB (${pct}%)`);
          if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({
              type: 'SIMULATION_LOADING',
              title: `Downloading Gemini Nano (${pct}%)...`,
              description: `Downloading ${mbLoaded} MB of ${mbTotal} MB. This initial download happens once.`
            }).catch(() => {});
          }
        });
      }
    };

    // Attempt 1: With languages, systemPrompt, monitor, and both topK & temperature
    try {
      session = await api.create({
        expectedInputLanguages: ['en'],
        expectedOutputLanguages: ['en'],
        systemPrompt: payload.systemPrompt,
        temperature: targetTemp,
        topK: defaultTopK,
        monitor: monitorProgress
      });
    } catch {
      // Attempt 2: Omit topK and temperature (neither of them), with languages
      try {
        session = await api.create({
          expectedInputLanguages: ['en'],
          expectedOutputLanguages: ['en'],
          systemPrompt: payload.systemPrompt,
          monitor: monitorProgress
        });
      } catch {
        // Attempt 3: Minimal options for legacy signatures
        session = await api.create({
          systemPrompt: payload.systemPrompt
        });
      }
    }

    // Immediately notify UI that model session is created and synthesis is starting
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'SIMULATION_LOADING',
        title: 'Generating Simulation Code...',
        description: 'Gemini Nano is synthesizing the visual module on-device...',
        codePreview: ''
      }).catch(() => {});
    }

    try {
      console.log('[SimIt Prompt API] Session created. Generating prompt...');
      let rawResult = '';
      let lastBroadcastTime = 0;
      let lastBroadcastLength = 0;

      const broadcastChars = (len: number, currentText: string, force: boolean = false) => {
        const now = Date.now();
        if (!force && now - lastBroadcastTime < 60 && len - lastBroadcastLength < 20) {
          return; // Throttle IPC messages
        }
        lastBroadcastTime = now;
        lastBroadcastLength = len;
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({
            type: 'SIMULATION_LOADING',
            title: 'Generating Simulation Code...',
            description: `Synthesizing visual logic (${len} characters generated)...`,
            codePreview: currentText
          }).catch(() => {});
        }
      };

      if (typeof session.promptStreaming === 'function') {
        try {
          const stream = session.promptStreaming(payload.userPrompt);

          const appendChunk = (chunk: any) => {
            if (typeof chunk !== 'string' || chunk.length === 0) return;

            if (rawResult.length === 0) {
              rawResult = chunk;
            } else if (chunk.length > rawResult.length && chunk.startsWith(rawResult)) {
              // Cumulative snapshot mode
              rawResult = chunk;
            } else {
              // Delta token mode
              rawResult += chunk;
            }

            broadcastChars(rawResult.length, rawResult);
          };

          if (stream && typeof (stream as any)[Symbol.asyncIterator] === 'function') {
            for await (const chunk of stream) {
              appendChunk(chunk);
            }
          } else if (stream && typeof (stream as any).getReader === 'function') {
            const reader = (stream as any).getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              appendChunk(value);
            }
          } else {
            rawResult = await session.prompt(payload.userPrompt);
          }
          // Force final broadcast with full raw stream
          broadcastChars(rawResult.length, rawResult, true);
        } catch (streamErr) {
          console.warn('[SimIt Prompt API] Streaming reader error, falling back to prompt():', streamErr);
          rawResult = await session.prompt(payload.userPrompt);
          broadcastChars(rawResult.length, rawResult, true);
        }
      } else {
        rawResult = await session.prompt(payload.userPrompt);
        broadcastChars(rawResult.length, rawResult, true);
      }

      const durationMs = Date.now() - startTime;
      console.log(`[SimIt Prompt API] Generation completed in ${durationMs}ms`);
      const parsed = extractSimulationTags(rawResult);

      return {
        rawCode: parsed.code,
        thinkingTrace: parsed.thinkingTrace,
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

  /**
   * Executes simulation generation, delegating to offscreen document if necessary
   */
  async generateSimulation(payload: GenerationPromptPayload): Promise<GenerationResponse> {
    // 1. If API exists directly in this context, generate directly
    if (this.getPromptApi()) {
      return this.generateDirect(payload);
    }

    // 2. Otherwise delegate to offscreen document (Window context)
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage && chrome.offscreen) {
      console.log('[SimIt Prompt API] Delegating generation to offscreen document harness...');
      await ensureOffscreenDocument();

      return await new Promise<GenerationResponse>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Prompt API generation timed out after 180 seconds.'));
        }, 180000);

        chrome.runtime.sendMessage(
          {
            type: 'PROMPT_API_GENERATE_REQUEST',
            payload: {
              systemPrompt: payload.systemPrompt,
              userPrompt: payload.userPrompt,
              temperature: payload.temperature ?? this.temperature
            }
          },
          (res: PromptApiGenerateResponse) => {
            clearTimeout(timeoutId);
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (!res || res.status === 'error') {
              reject(new Error(res?.errorMessage || 'Offscreen Prompt API generation failed.'));
            } else if (res.rawCode) {
              resolve({
                rawCode: res.rawCode,
                provider: this.type,
                modelName: this.modelName,
                durationMs: res.durationMs || 0
              });
            } else {
              reject(new Error('Invalid response received from offscreen Prompt API.'));
            }
          }
        );
      });
    }

    throw new Error(
      'Chrome Prompt API (LanguageModel / ai.languageModel) is not available in this environment. ' +
      'Please enable chrome://flags/#prompt-api-for-gemini-nano or configure a BYOK provider in Settings.'
    );
  }
}
