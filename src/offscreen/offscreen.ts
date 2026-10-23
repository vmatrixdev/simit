/**
 * SimIt Offscreen Harness Script
 * Conforms to docs/specs/sandbox_ipc.md and docs/specs/agent_loop.md#6
 * Provides:
 * 1. Headless sandboxed iframe pre-flight smoke test execution (CSP 'unsafe-eval' compliant).
 * 2. Window-context Prompt API (LanguageModel / Gemini Nano) execution proxy.
 */

import {
  PreFlightTestRequest,
  PreFlightTestResponse,
  PromptApiCheckResponse,
  PromptApiGenerateResponse
} from '../types/ipc';
import { ChromePromptApiProvider } from '../providers/prompt-api';
import {
  assembleVerificationReport,
  formatDiagnosticsForCoder,
  makeDiagnostic
} from '../runtime/verification';

const promptProvider = new ChromePromptApiProvider();

let isSandboxReady = false;
window.addEventListener('message', (event) => {
  if (event.data?.type === 'SANDBOX_READY') {
    isSandboxReady = true;
  }
});

/**
 * Ensures the sandboxed evaluation iframe is loaded and ready
 */
function ensureSandboxFrameReady(): Promise<void> {
  if (isSandboxReady) return Promise.resolve();
  const frame = document.getElementById('sandbox-frame') as HTMLIFrameElement;
  if (!frame) return Promise.resolve();

  return new Promise((resolve) => {
    const onReady = (event: MessageEvent) => {
      if (event.data?.type === 'SANDBOX_READY') {
        window.removeEventListener('message', onReady);
        isSandboxReady = true;
        resolve();
      }
    };
    window.addEventListener('message', onReady);
    frame.addEventListener('load', () => {
      setTimeout(resolve, 100);
    });
    setTimeout(resolve, 800);
  });
}

/**
 * Executes simulation pre-flight smoke test or full verification inside the sandboxed iframe (sandbox.html),
 * which is granted 'unsafe-eval' in manifest.json CSP.
 */
function executeSandboxedSmokeTest(testMsg: PreFlightTestRequest): Promise<PreFlightTestResponse> {
  return new Promise<PreFlightTestResponse>((resolve) => {
    const frame = document.getElementById('sandbox-frame') as HTMLIFrameElement;
    if (!frame || !frame.contentWindow) {
      resolve({
        type: 'PREFLIGHT_TEST_RESPONSE',
        requestId: testMsg.requestId,
        status: 'error',
        errorMessage: 'Sandboxed evaluation frame not available in offscreen harness.'
      });
      return;
    }

    if (testMsg.verification?.viewport) {
      frame.style.width = `${testMsg.verification.viewport.width}px`;
      frame.style.height = `${testMsg.verification.viewport.height}px`;
    }

    let timeoutId: any;
    const cleanup = () => {
      clearTimeout(timeoutId);
      window.removeEventListener('message', handleSandboxMessage);
    };

    const handleSandboxMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || !data.type) return;

      if (data.type === 'SANDBOX_VERIFICATION_REPORT') {
        if (data.requestId && data.requestId !== testMsg.requestId) return;
        cleanup();
        const report = data.report;
        const isPass = report.status === 'pass';
        const snapshotUrl = report.frames?.[0]?.image
          ? `data:${report.frames[0].image.mimeType};base64,${report.frames[0].image.base64Data}`
          : undefined;
        if (isPass) {
          resolve({
            type: 'PREFLIGHT_TEST_RESPONSE',
            requestId: testMsg.requestId,
            status: 'ok',
            validatedCode: testMsg.rawCode,
            parameters: report.parameters || [],
            snapshotUrl,
            report
          });
        } else {
          const formattedDiagnostics = formatDiagnosticsForCoder(report);
          resolve({
            type: 'PREFLIGHT_TEST_RESPONSE',
            requestId: testMsg.requestId,
            status: 'error',
            errorMessage:
              formattedDiagnostics ||
              report.diagnostics.map((d: any) => `[${d.code}] ${d.message}`).join('\n') ||
              'Verification failed',
            errorStack: report.runtimeErrors?.[0]?.stack,
            report
          });
        }
      } else if (data.type === 'SANDBOX_SIMULATION_READY') {
        cleanup();
        resolve({
          type: 'PREFLIGHT_TEST_RESPONSE',
          requestId: testMsg.requestId,
          status: 'ok',
          validatedCode: testMsg.rawCode,
          parameters: data.parameters || [],
          snapshotUrl: data.snapshotUrl
        });
      } else if (data.type === 'SANDBOX_RUNTIME_ERROR') {
        if (testMsg.verification) {
          // During SANDBOX_VERIFY_SIMULATION, runtime errors are collected into SANDBOX_VERIFICATION_REPORT
          return;
        }
        cleanup();
        resolve({
          type: 'PREFLIGHT_TEST_RESPONSE',
          requestId: testMsg.requestId,
          status: 'error',
          errorMessage: data.message || 'Simulation runtime error',
          errorStack: data.stack
        });
      }
    };

    window.addEventListener('message', handleSandboxMessage);

    const maxWaitMs = testMsg.verification?.timeoutMs || testMsg.timeoutMs || 4000;
    timeoutId = setTimeout(() => {
      cleanup();
      const timeoutMsg = 'TimeoutError: Sandboxed pre-flight execution exceeded time limit (possible infinite loop).';
      const timeoutReport = testMsg.verification
        ? assembleVerificationReport({
            diagnostics: [
              makeDiagnostic('TIMEOUT', timeoutMsg, {
                phase: 'soak',
                evidence: { timeoutMs: maxWaitMs }
              })
            ],
            runtimeErrors: [],
            frames: [],
            parameters: [],
            title: 'Untitled Simulation',
            description: '',
            durationMs: maxWaitMs
          })
        : undefined;
      resolve({
        type: 'PREFLIGHT_TEST_RESPONSE',
        requestId: testMsg.requestId,
        status: 'error',
        errorMessage: timeoutMsg,
        report: timeoutReport
      });
    }, maxWaitMs);

    if (testMsg.verification) {
      frame.contentWindow.postMessage({
        type: 'SANDBOX_VERIFY_SIMULATION',
        requestId: testMsg.requestId,
        code: testMsg.rawCode,
        options: testMsg.verification
      }, '*');
    } else {
      frame.contentWindow.postMessage({
        type: 'SANDBOX_INIT_SIMULATION',
        code: testMsg.rawCode,
        captureSnapshot: testMsg.captureSnapshot ?? true
      }, '*');
    }
  });
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message: any, _sender, sendResponse) => {
    // 0. Readiness Ping
    if (message && message.type === 'PING') {
      sendResponse({ status: 'PONG' });
      return true;
    }

    // 1. Sandboxed Pre-flight Smoke Test Request
    if (message && message.type === 'PREFLIGHT_TEST_REQUEST') {
      const testMsg = message as PreFlightTestRequest;

      ensureSandboxFrameReady()
        .then(() => executeSandboxedSmokeTest(testMsg))
        .then((response: PreFlightTestResponse) => {
          sendResponse(response);
        })
        .catch((err: any) => {
          sendResponse({
            type: 'PREFLIGHT_TEST_RESPONSE',
            requestId: testMsg.requestId,
            status: 'error',
            errorMessage: err.message || String(err),
            errorStack: err.stack
          });
        });

      return true; // Async channel open
    }

    // 2. Prompt API Availability Check
    if (message && message.type === 'PROMPT_API_CHECK_REQUEST') {
      promptProvider
        .isAvailableDirect()
        .then((available) => {
          const res: PromptApiCheckResponse = {
            type: 'PROMPT_API_CHECK_RESPONSE',
            available
          };
          sendResponse(res);
        })
        .catch(() => {
          sendResponse({ type: 'PROMPT_API_CHECK_RESPONSE', available: false });
        });

      return true; // Async channel open
    }

    // 3. Prompt API Generation Request
    if (message && message.type === 'PROMPT_API_GENERATE_REQUEST') {
      promptProvider
        .generateDirect(message.payload)
        .then((genRes) => {
          const res: PromptApiGenerateResponse = {
            type: 'PROMPT_API_GENERATE_RESPONSE',
            status: 'ok',
            rawCode: genRes.rawCode,
            durationMs: genRes.durationMs
          };
          sendResponse(res);
        })
        .catch((err: any) => {
          const res: PromptApiGenerateResponse = {
            type: 'PROMPT_API_GENERATE_RESPONSE',
            status: 'error',
            errorMessage: err.message || String(err)
          };
          sendResponse(res);
        });

      return true; // Async channel open
    }
  });
}
