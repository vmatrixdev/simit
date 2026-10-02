/**
 * SimIt Content Script
 * Listens for HARVEST_CONTEXT_REQUEST from background service worker
 * and dispatches HARVEST_CONTEXT_RESPONSE with HarvestedContext payload.
 */

import { harvestFromCurrentDocument } from './harvester';
import { HarvestContextRequest, HarvestContextResponse } from '../types/ipc';

// Listen for incoming messages from background orchestrator
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message: HarvestContextRequest, _sender, sendResponse) => {
    if (message && message.type === 'HARVEST_CONTEXT_REQUEST') {
      try {
        const payload = harvestFromCurrentDocument(
          window.location.href,
          document.title,
          document.documentElement.lang || navigator.language
        );

        const response: HarvestContextResponse = {
          type: 'HARVEST_CONTEXT_RESPONSE',
          payload
        };

        sendResponse(response);
      } catch (err: any) {
        console.error('[SimIt ContentScript] Error harvesting context:', err);
        // Fallback response with minimal selection
        const fallback = harvestFromCurrentDocument(window.location.href, document.title);
        sendResponse({
          type: 'HARVEST_CONTEXT_RESPONSE',
          payload: fallback
        });
      }
      return true; // Keep channel open for async response
    }
  });
}
