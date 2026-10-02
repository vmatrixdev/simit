/**
 * SimIt Offscreen Document Lifecycle Manager
 * Ensures the offscreen document is active and listening for DOM smoke tests and Prompt API calls.
 */

const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';

/**
 * Pings the offscreen document until it responds with PONG or times out
 */
async function waitForOffscreenReady(maxWaitMs = 3000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const pong = await new Promise<boolean>((resolve) => {
        chrome.runtime.sendMessage({ type: 'PING' }, (res) => {
          if (chrome.runtime.lastError || !res) {
            resolve(false);
          } else {
            resolve(res.status === 'PONG');
          }
        });
      });
      if (pong) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 60));
  }
  return false;
}

export async function ensureOffscreenDocument(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.offscreen) return;

  try {
    const existing = await chrome.offscreen.hasDocument?.();
    if (!existing) {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: ['DOM_PARSER' as any],
        justification: 'SimIt pre-flight headless simulation smoke test and Prompt API harness'
      });
    }

    // Ensure document is actively listening
    await waitForOffscreenReady(2500);
  } catch (err: any) {
    if (!err?.message?.includes('Only a single offscreen document may be created')) {
      console.warn('[SimIt Offscreen] Error ensuring offscreen document:', err);
    }
  }
}
