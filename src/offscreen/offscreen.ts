/**
 * SimIt Offscreen Pre-Flight Harness Script
 * Conforms to docs/specs/sandbox_ipc.md and docs/specs/agent_loop.md#6
 */

import { PreFlightTestRequest, PreFlightTestResponse } from '../types/ipc';
import { runPreFlightSmokeTest } from '../runtime/preflight';

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message: PreFlightTestRequest, _sender, sendResponse) => {
    if (message && message.type === 'PREFLIGHT_TEST_REQUEST') {
      const container = document.getElementById('sim-root') || document.createElement('div');
      container.innerHTML = '';

      runPreFlightSmokeTest(message, container as HTMLElement, {
        d3: (window as any).d3,
        anime: (window as any).anime,
        katex: (window as any).katex
      })
        .then((response: PreFlightTestResponse) => {
          sendResponse(response);
        })
        .catch((err: any) => {
          const errResponse: PreFlightTestResponse = {
            type: 'PREFLIGHT_TEST_RESPONSE',
            requestId: message.requestId,
            status: 'error',
            errorMessage: err.message || String(err),
            errorStack: err.stack
          };
          sendResponse(errResponse);
        });

      return true; // Keep channel open for async response
    }
  });
}
