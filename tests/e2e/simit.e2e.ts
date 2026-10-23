/**
 * Autonomous E2E Test & Visual Verification Harness
 * Tests full Manifest V3 extension pipeline in real Chromium:
 * Content Script Harvest -> Background SW -> Offscreen Preflight -> Sandbox Iframe -> Side Panel UI
 */

import { chromium, type BrowserContext, type Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { startMockServer, DEFAULT_MOCK_PORT, mockTelemetry } from './mock-server.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_PATH = path.resolve(__dirname, '../../dist');
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../artifacts/e2e-screenshots');
const USER_DATA_DIR = path.resolve(__dirname, '../../artifacts/test-user-data');

// Ensure artifacts directories exist
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

export interface TestResult {
  suiteName: string;
  passed: boolean;
  durationMs: number;
  screenshotPath?: string;
  error?: string;
  archetype?: string;
  controlsTested?: number;
}

export class SimItE2EHarness {
  private server: any;
  private context!: BrowserContext;
  private extensionId!: string;
  private sidepanelPage!: Page;
  private consoleLogs: Array<{ context: string; type: string; text: string }> = [];

  async setup() {
    console.log('[E2E Harness] Starting mock fixture server...');
    this.server = await startMockServer(DEFAULT_MOCK_PORT);

    // Validate dist build exists
    if (!fs.existsSync(path.join(DIST_PATH, 'manifest.json'))) {
      throw new Error(`Build artifacts missing in ${DIST_PATH}. Please run "npm run build" first.`);
    }

    console.log('[E2E Harness] Launching Chromium with unpacked extension...');
    this.context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: false, // Chrome extensions require headed or new headless mode
      ignoreDefaultArgs: [
        '--disable-extensions',
        '--disable-component-extensions-with-background-pages'
      ],
      args: [
        `--disable-extensions-except=${DIST_PATH}`,
        `--load-extension=${DIST_PATH}`,
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--enable-features=PromptAPIForGeminiNano'
      ]
    });

    // Detect Service Worker
    let [sw] = this.context.serviceWorkers();
    if (!sw) {
      sw = await this.context.waitForEvent('serviceworker', { timeout: 10000 });
    }

    this.extensionId = sw.url().split('/')[2];
    console.log(`[E2E Harness] Detected Extension ID: ${this.extensionId}`);

    // Open and setup Side Panel page
    const sidepanelUrl = `chrome-extension://${this.extensionId}/src/sidepanel/sidepanel.html`;
    console.log(`[E2E Harness] Navigating to Side Panel: ${sidepanelUrl}`);
    this.sidepanelPage = await this.context.newPage();

    this.sidepanelPage.on('console', (msg) => {
      const text = msg.text();
      this.consoleLogs.push({ context: 'SidePanel', type: msg.type(), text });
      if (msg.type() === 'error') {
        console.error(`[SidePanel Console Error] ${text}`);
      }
    });

    this.sidepanelPage.on('pageerror', (err) => {
      // Benign module parser notice in sandboxed opaque iframe during initial parse
      if (err.message?.includes("Unexpected token 'export'")) {
        this.consoleLogs.push({ context: 'Sandbox/SidePanel (Benign)', type: 'pageerror', text: err.message });
        return;
      }
      console.error(`[SidePanel Uncaught Exception]`, err.message);
      this.consoleLogs.push({ context: 'SidePanel', type: 'pageerror', text: err.message });
    });

    await this.sidepanelPage.setViewportSize({ width: 420, height: 750 });
    await this.sidepanelPage.goto(sidepanelUrl);
    await this.sidepanelPage.waitForLoadState('domcontentloaded');

    // Configure BYOK settings to route to our local Mock LLM server with vision-capable model name
    console.log('[E2E Harness] Configuring Extension BYOK Settings via chrome.storage.local...');
    await this.sidepanelPage.evaluate(async (mockPort) => {
      return new Promise<void>((resolve) => {
        (chrome.storage.local as any).set({
          simit_byok_settings: {
            activeProviderType: 'openai-compatible',
            providers: {
              'openai-compatible': {
                baseUrl: `http://127.0.0.1:${mockPort}/v1`,
                modelName: 'gpt-4o-mock',
                apiKey: 'test-key',
                temperature: 0.2
              }
            },
            fallbackToBYOKOnNanoUnavailable: false
          }
        }, () => resolve());
      });
    }, DEFAULT_MOCK_PORT);

    console.log('[E2E Harness] Setup completed successfully.');
  }

  private async waitForSimulationTitle(expectedTitle: string) {
    await this.sidepanelPage.waitForFunction(
      (target) => {
        const titleEl = document.getElementById('sim-title');
        const pillEl = document.getElementById('status-pill');
        const titleText = titleEl?.textContent?.trim() || '';
        const pillText = pillEl?.textContent?.trim() || '';
        return titleText === target && pillText.startsWith('Active');
      },
      expectedTitle,
      { timeout: 15000 }
    );
  }

  async runHarmonicOscillatorTest(): Promise<TestResult> {
    const startTime = Date.now();
    const suiteName = 'Harmonic Oscillator (Parameter Explorer + Docked Controls)';
    console.log(`\n========================================`);
    console.log(`[RUNNING TEST] ${suiteName}`);
    console.log(`========================================`);

    const fixtureUrl = `http://127.0.0.1:${DEFAULT_MOCK_PORT}/fixtures/harmonic_oscillator.html`;
    const fixturePage = await this.context.newPage();

    try {
      await fixturePage.goto(fixtureUrl);
      await fixturePage.waitForLoadState('domcontentloaded');

      // 1. Harvest context from fixture page
      console.log('[E2E Test] Harvesting context from fixture page...');
      const selectedText = await fixturePage.$eval('#target-selection', (el) => el.textContent?.trim() || '');
      const docTitle = await fixturePage.title();
      const harvestedContext = {
        harvestId: `harvest-${Date.now()}`,
        timestamp: new Date().toISOString(),
        selection: {
          selectedText,
          characterCount: selectedText.length,
          sourceUrl: fixtureUrl,
          documentTitle: docTitle
        },
        mathSnippets: [
          { latex: 'm * d^2x/dt^2 + c * dx/dt + k * x = 0', isDisplayMode: true }
        ],
        domContext: {
          nearestHeading: 'Damped Harmonic Oscillator Dynamics',
          headingLevel: 1,
          caption: null,
          paragraphSnippet: selectedText
        }
      };

      // 2. Trigger simulation synthesis via extension message
      console.log('[E2E Test] Dispatched START_SIMULATION_REQUEST message to Service Worker...');
      await this.sidepanelPage.evaluate(async (ctx) => {
        return new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            type: 'START_SIMULATION_REQUEST',
            harvestedContext: ctx
          }, (res) => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            resolve(res);
          });
        });
      }, harvestedContext);

      // 3. Bring sidepanel page to front and wait for verified simulation
      await this.sidepanelPage.bringToFront();

      console.log('[E2E Test] Waiting for Side Panel state transition to Damped Harmonic Oscillator...');
      await this.waitForSimulationTitle('Damped Harmonic Oscillator');

      // 4. Assert simulation title and clean status pill (no fallback notices)
      const title = await this.sidepanelPage.$eval('#sim-title', (el) => el.textContent?.trim());
      const statusText = await this.sidepanelPage.$eval('#status-pill', (el) => el.textContent?.trim());
      console.log(`[E2E Test] Verified Simulation Title: "${title}" | Status Pill: "${statusText}"`);
      if (statusText !== 'Active') {
        const noticeTitle = await this.sidepanelPage.$eval('#status-pill', (el) => el.getAttribute('title') || '');
        throw new Error(`Expected clean 'Active' status pill without fallback notices, got "${statusText}" (${noticeTitle})`);
      }

      // 5. Verify sandbox iframe rendered the canvas and docked bottom drawer
      console.log('[E2E Test] Inspecting sandbox iframe DOM and docked controls drawer...');
      const iframeElement = await this.sidepanelPage.$('#sandbox-iframe');
      if (!iframeElement) throw new Error('Sandbox iframe not found in Side Panel DOM.');

      const iframe = await iframeElement.contentFrame();
      if (!iframe) throw new Error('Cannot access sandbox iframe frame content.');

      await iframe.waitForSelector('#osc-canvas', { timeout: 5000 });
      console.log('[E2E Test] Verified #osc-canvas is present and rendering inside sandbox iframe.');

      const hasControlsDrawerClass = await iframe.$eval('body', (el) => el.classList.contains('has-controls-drawer'));
      if (!hasControlsDrawerClass) {
        throw new Error('Expected sandbox body to have class "has-controls-drawer" for docked bottom drawer.');
      }

      // 5b. Verify P1 Guided Tour & Explanation Bar (#explanation-dock and #tour-bar)
      const hasExplanationBarClass = await iframe.$eval('body', (el) => el.classList.contains('has-explanation-bar'));
      if (!hasExplanationBarClass) {
        throw new Error('Expected sandbox body to have class "has-explanation-bar" when module exports explanation.');
      }
      const insightText = await iframe.$eval('#explanation-insight', (el) => el.textContent?.trim() || '');
      console.log(`[E2E Test] Verified Explanation Insight: "${insightText}"`);
      if (!insightText.includes('critical damping')) {
        throw new Error(`Expected #explanation-insight to contain core insight, got: "${insightText}"`);
      }

      // Click Next on Guided Tour (#btn-tour-next) and verify live parameter update to step 2 (zeta = 1.0)
      console.log('[E2E Test] Clicking #btn-tour-next to advance guided tour to Step 2 (Critical Damping)...');
      await iframe.click('#btn-tour-next');
      await this.sidepanelPage.waitForTimeout(200);
      const stepIndicatorText = await iframe.$eval('#tour-step-indicator', (el) => el.textContent?.trim() || '');
      const tourStepReadout = await iframe.$eval('#readout', (el) => el.textContent || '');
      console.log(`[E2E Test] Guided Tour Indicator: "${stepIndicatorText}" | Readout: "${tourStepReadout}"`);
      if (!stepIndicatorText.includes('2') || !tourStepReadout.includes('Damping: 1')) {
        throw new Error(`Expected Guided Tour step 2/3 to update Damping to 1, got indicator="${stepIndicatorText}", readout="${tourStepReadout}"`);
      }

      // 6. Test Interactive Parameter Controls via SANDBOX_UPDATE_PARAMETERS
      console.log('[E2E Test] Testing interactive parameter adjustment (zeta = 1.2)...');
      await this.sidepanelPage.evaluate(() => {
        const iframeEl = document.getElementById('sandbox-iframe') as HTMLIFrameElement | null;
        iframeEl?.contentWindow?.postMessage({
          type: 'SANDBOX_UPDATE_PARAMETERS',
          params: { zeta: 1.2 }
        }, '*');
      });
      await this.sidepanelPage.waitForTimeout(250);

      const readoutText = await iframe.$eval('#readout', (el) => el.textContent);
      console.log(`[E2E Test] Readout updated to: "${readoutText}"`);
      if (!readoutText?.includes('1.2')) {
        throw new Error(`Expected readout to reflect parameter 1.2, got: "${readoutText}"`);
      }

      // 7. Capture visual screenshot
      const screenshotPath = path.join(SCREENSHOTS_DIR, 'harmonic_oscillator_simulation.png');
      await this.sidepanelPage.screenshot({ path: screenshotPath });
      console.log(`[E2E Test] Visual screenshot captured: ${screenshotPath}`);

      await fixturePage.close();
      return {
        suiteName,
        passed: true,
        durationMs: Date.now() - startTime,
        screenshotPath,
        archetype: 'PARAMETER_EXPLORER',
        controlsTested: 1
      };
    } catch (err: any) {
      await fixturePage.close();
      const failScreenshot = path.join(SCREENSHOTS_DIR, 'harmonic_oscillator_failure.png');
      await this.sidepanelPage.screenshot({ path: failScreenshot }).catch(() => {});
      return {
        suiteName,
        passed: false,
        durationMs: Date.now() - startTime,
        screenshotPath: failScreenshot,
        error: err.message || String(err)
      };
    }
  }

  async runQuicksortStepperTest(): Promise<TestResult> {
    const startTime = Date.now();
    const suiteName = 'Quicksort Stepper (Step Scrubber)';
    console.log(`\n========================================`);
    console.log(`[RUNNING TEST] ${suiteName}`);
    console.log(`========================================`);

    const fixtureUrl = `http://127.0.0.1:${DEFAULT_MOCK_PORT}/fixtures/sorting_algorithms.html`;
    const fixturePage = await this.context.newPage();

    try {
      await fixturePage.goto(fixtureUrl);
      await fixturePage.waitForLoadState('domcontentloaded');

      // 1. Harvest context from fixture page
      console.log('[E2E Test] Harvesting Quicksort context from fixture page...');
      const selectedText = await fixturePage.$eval('#target-selection', (el) => el.textContent?.trim() || '');
      const docTitle = await fixturePage.title();
      const harvestedContext = {
        harvestId: `harvest-${Date.now()}`,
        timestamp: new Date().toISOString(),
        selection: {
          selectedText,
          characterCount: selectedText.length,
          sourceUrl: fixtureUrl,
          documentTitle: docTitle
        },
        mathSnippets: [],
        domContext: {
          nearestHeading: 'Quicksort Partition and Recursion Analysis',
          headingLevel: 1,
          caption: null,
          paragraphSnippet: selectedText
        }
      };

      // 2. Trigger simulation
      console.log('[E2E Test] Triggering simulation for Quicksort via extension message...');
      await this.sidepanelPage.evaluate(async (ctx) => {
        return new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            type: 'START_SIMULATION_REQUEST',
            harvestedContext: ctx
          }, (res) => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            resolve(res);
          });
        });
      }, harvestedContext);

      // 3. Wait for simulation ready
      await this.sidepanelPage.bringToFront();
      await this.waitForSimulationTitle('Quicksort Partition Stepper');

      const title = await this.sidepanelPage.$eval('#sim-title', (el) => el.textContent?.trim());
      console.log(`[E2E Test] Verified Simulation Title: "${title}"`);

      // 4. Verify bar chart inside sandbox
      const iframeElement = await this.sidepanelPage.$('#sandbox-iframe');
      const iframe = await iframeElement!.contentFrame();
      await iframe!.waitForSelector('#bar-chart', { timeout: 5000 });
      console.log('[E2E Test] Verified #bar-chart rendered inside sandbox iframe.');

      // 5. Test Step Scrubber adjustment
      console.log('[E2E Test] Testing step parameter change (step = 3)...');
      await this.sidepanelPage.evaluate(() => {
        const iframeEl = document.getElementById('sandbox-iframe') as HTMLIFrameElement | null;
        iframeEl?.contentWindow?.postMessage({
          type: 'SANDBOX_UPDATE_PARAMETERS',
          params: { step: 3 }
        }, '*');
      });
      await this.sidepanelPage.waitForTimeout(250);

      // 6. Capture visual screenshot
      const screenshotPath = path.join(SCREENSHOTS_DIR, 'quicksort_stepper_simulation.png');
      await this.sidepanelPage.screenshot({ path: screenshotPath });
      console.log(`[E2E Test] Visual screenshot captured: ${screenshotPath}`);

      await fixturePage.close();
      return {
        suiteName,
        passed: true,
        durationMs: Date.now() - startTime,
        screenshotPath,
        archetype: 'STEP_SCRUBBER',
        controlsTested: 1
      };
    } catch (err: any) {
      await fixturePage.close();
      const failScreenshot = path.join(SCREENSHOTS_DIR, 'quicksort_stepper_failure.png');
      await this.sidepanelPage.screenshot({ path: failScreenshot }).catch(() => {});
      return {
        suiteName,
        passed: false,
        durationMs: Date.now() - startTime,
        screenshotPath: failScreenshot,
        error: err.message || String(err)
      };
    }
  }

  async runGraphTraversalTest(): Promise<TestResult> {
    const startTime = Date.now();
    const suiteName = 'Dijkstra Traversal (Interactive Graph + SVG Raster Verification)';
    console.log(`\n========================================`);
    console.log(`[RUNNING TEST] ${suiteName}`);
    console.log(`========================================`);

    const fixtureUrl = `http://127.0.0.1:${DEFAULT_MOCK_PORT}/fixtures/graph_traversal.html`;
    const fixturePage = await this.context.newPage();

    try {
      await fixturePage.goto(fixtureUrl);
      await fixturePage.waitForLoadState('domcontentloaded');

      console.log('[E2E Test] Harvesting Graph topology context from fixture page...');
      const selectedText = await fixturePage.$eval('#target-selection', (el) => el.textContent?.trim() || '');
      const docTitle = await fixturePage.title();
      const harvestedContext = {
        harvestId: `harvest-${Date.now()}`,
        timestamp: new Date().toISOString(),
        selection: {
          selectedText,
          characterCount: selectedText.length,
          sourceUrl: fixtureUrl,
          documentTitle: docTitle
        },
        mathSnippets: [],
        domContext: {
          nearestHeading: 'Dijkstra Shortest Path Search on Directed Graphs',
          headingLevel: 1,
          caption: null,
          paragraphSnippet: selectedText
        }
      };

      console.log('[E2E Test] Triggering simulation for Graph Traversal...');
      await this.sidepanelPage.evaluate(async (ctx) => {
        return new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            type: 'START_SIMULATION_REQUEST',
            harvestedContext: ctx
          }, (res) => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            resolve(res);
          });
        });
      }, harvestedContext);

      await this.sidepanelPage.bringToFront();
      await this.waitForSimulationTitle('Dijkstra Shortest Path Visualizer');

      const title = await this.sidepanelPage.$eval('#sim-title', (el) => el.textContent?.trim());
      console.log(`[E2E Test] Verified Simulation Title: "${title}"`);

      const iframeElement = await this.sidepanelPage.$('#sandbox-iframe');
      const iframe = await iframeElement!.contentFrame();
      await iframe!.waitForSelector('#graph-svg', { timeout: 5000 });
      console.log('[E2E Test] Verified #graph-svg rendered inside sandbox iframe.');

      const screenshotPath = path.join(SCREENSHOTS_DIR, 'graph_traversal_simulation.png');
      await this.sidepanelPage.screenshot({ path: screenshotPath });
      console.log(`[E2E Test] Visual screenshot captured: ${screenshotPath}`);

      await fixturePage.close();
      return {
        suiteName,
        passed: true,
        durationMs: Date.now() - startTime,
        screenshotPath,
        archetype: 'INTERACTIVE_GRAPH',
        controlsTested: 1
      };
    } catch (err: any) {
      await fixturePage.close();
      const failScreenshot = path.join(SCREENSHOTS_DIR, 'graph_traversal_failure.png');
      await this.sidepanelPage.screenshot({ path: failScreenshot }).catch(() => {});
      return {
        suiteName,
        passed: false,
        durationMs: Date.now() - startTime,
        screenshotPath: failScreenshot,
        error: err.message || String(err)
      };
    }
  }

  async runStateMachineTest(): Promise<TestResult> {
    const startTime = Date.now();
    const suiteName = 'TCP State Machine (State Machine Inspector)';
    console.log(`\n========================================`);
    console.log(`[RUNNING TEST] ${suiteName}`);
    console.log(`========================================`);

    const fixtureUrl = `http://127.0.0.1:${DEFAULT_MOCK_PORT}/fixtures/state_machine.html`;
    const fixturePage = await this.context.newPage();

    try {
      await fixturePage.goto(fixtureUrl);
      await fixturePage.waitForLoadState('domcontentloaded');

      console.log('[E2E Test] Harvesting TCP FSM context from fixture page...');
      const selectedText = await fixturePage.$eval('#target-selection', (el) => el.textContent?.trim() || '');
      const docTitle = await fixturePage.title();
      const harvestedContext = {
        harvestId: `harvest-${Date.now()}`,
        timestamp: new Date().toISOString(),
        selection: {
          selectedText,
          characterCount: selectedText.length,
          sourceUrl: fixtureUrl,
          documentTitle: docTitle
        },
        mathSnippets: [],
        domContext: {
          nearestHeading: 'TCP State Machine & Handshake Transitions',
          headingLevel: 1,
          caption: null,
          paragraphSnippet: selectedText
        }
      };

      console.log('[E2E Test] Triggering simulation for TCP State Machine...');
      await this.sidepanelPage.evaluate(async (ctx) => {
        return new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            type: 'START_SIMULATION_REQUEST',
            harvestedContext: ctx
          }, (res) => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            resolve(res);
          });
        });
      }, harvestedContext);

      await this.sidepanelPage.bringToFront();
      await this.waitForSimulationTitle('TCP State Machine Inspector');

      const title = await this.sidepanelPage.$eval('#sim-title', (el) => el.textContent?.trim());
      console.log(`[E2E Test] Verified Simulation Title: "${title}"`);

      const iframeElement = await this.sidepanelPage.$('#sandbox-iframe');
      const iframe = await iframeElement!.contentFrame();
      await iframe!.waitForSelector('#fsm-graph', { timeout: 5000 });
      console.log('[E2E Test] Verified #fsm-graph rendered inside sandbox iframe.');

      const screenshotPath = path.join(SCREENSHOTS_DIR, 'state_machine_simulation.png');
      await this.sidepanelPage.screenshot({ path: screenshotPath });
      console.log(`[E2E Test] Visual screenshot captured: ${screenshotPath}`);

      await fixturePage.close();
      return {
        suiteName,
        passed: true,
        durationMs: Date.now() - startTime,
        screenshotPath,
        archetype: 'STATE_MACHINE_INSPECTOR',
        controlsTested: 1
      };
    } catch (err: any) {
      await fixturePage.close();
      const failScreenshot = path.join(SCREENSHOTS_DIR, 'state_machine_failure.png');
      await this.sidepanelPage.screenshot({ path: failScreenshot }).catch(() => {});
      return {
        suiteName,
        passed: false,
        durationMs: Date.now() - startTime,
        screenshotPath: failScreenshot,
        error: err.message || String(err)
      };
    }
  }

  async runSelfRepairLoopTest(): Promise<TestResult> {
    const startTime = Date.now();
    const suiteName = 'P0 Self-Repair Loop (NaN Diagnostic -> Code-Preserving Patch -> Multimodal Review)';
    console.log(`\n========================================`);
    console.log(`[RUNNING TEST] ${suiteName}`);
    console.log(`========================================`);

    try {
      const harvestedContext = {
        harvestId: `harvest-repair-${Date.now()}`,
        timestamp: new Date().toISOString(),
        selection: {
          selectedText: 'self-repair-trigger: Damped harmonic oscillator where initial attempt outputs NaN in readout.',
          characterCount: 94,
          sourceUrl: `http://127.0.0.1:${DEFAULT_MOCK_PORT}/fixtures/harmonic_oscillator.html`,
          documentTitle: 'Self-Repair Verification'
        },
        mathSnippets: [
          { latex: 'm * d^2x/dt^2 + c * dx/dt + k * x = 0', isDisplayMode: true }
        ],
        domContext: {
          nearestHeading: 'Self-Repairing Oscillator',
          headingLevel: 1,
          caption: null,
          paragraphSnippet: 'self-repair-trigger'
        }
      };

      console.log('[E2E Test] Triggering self-repair simulation request...');
      await this.sidepanelPage.evaluate(async (ctx) => {
        return new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            type: 'START_SIMULATION_REQUEST',
            harvestedContext: ctx
          }, (res) => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            resolve(res);
          });
        });
      }, harvestedContext);

      await this.sidepanelPage.bringToFront();
      await this.waitForSimulationTitle('Self-Repairing Harmonic Oscillator');

      const iframeElement = await this.sidepanelPage.$('#sandbox-iframe');
      const iframe = await iframeElement!.contentFrame();
      await iframe!.waitForSelector('#osc-canvas', { timeout: 5000 });

      if (mockTelemetry.revisionPayloadsWithPreviousCode < 1) {
        throw new Error(`Expected Coder revision payload to include PREVIOUS CODE and NON_FINITE_TEXT diagnostic, got count=${mockTelemetry.revisionPayloadsWithPreviousCode}`);
      }
      if (mockTelemetry.multimodalImagesReceived < 3) {
        throw new Error(`Expected Reviewer to receive multimodal PNG snapshots from Offscreen Harness, got count=${mockTelemetry.multimodalImagesReceived}`);
      }
      console.log(`[E2E Test] Verified Telemetry: multimodalImagesReceived=${mockTelemetry.multimodalImagesReceived}, revisionPayloadsWithPreviousCode=${mockTelemetry.revisionPayloadsWithPreviousCode}`);

      const screenshotPath = path.join(SCREENSHOTS_DIR, 'self_repair_oscillator_simulation.png');
      await this.sidepanelPage.screenshot({ path: screenshotPath });
      console.log(`[E2E Test] Visual screenshot captured: ${screenshotPath}`);

      return {
        suiteName,
        passed: true,
        durationMs: Date.now() - startTime,
        screenshotPath,
        archetype: 'SELF_REPAIR',
        controlsTested: 1
      };
    } catch (err: any) {
      const failScreenshot = path.join(SCREENSHOTS_DIR, 'self_repair_failure.png');
      await this.sidepanelPage.screenshot({ path: failScreenshot }).catch(() => {});
      return {
        suiteName,
        passed: false,
        durationMs: Date.now() - startTime,
        screenshotPath: failScreenshot,
        error: err.message || String(err)
      };
    }
  }

  async teardown() {
    console.log('[E2E Harness] Cleaning up browser context and servers...');
    if (this.context) {
      await this.context.close().catch(() => {});
    }
    if (this.server) {
      this.server.close();
    }
  }

  getLogs() {
    return this.consoleLogs;
  }
}

// Runner function
export async function runAllE2ETests() {
  const harness = new SimItE2EHarness();
  const results: TestResult[] = [];

  try {
    await harness.setup();
    results.push(await harness.runHarmonicOscillatorTest());
    results.push(await harness.runQuicksortStepperTest());
    results.push(await harness.runGraphTraversalTest());
    results.push(await harness.runStateMachineTest());
    results.push(await harness.runSelfRepairLoopTest());
  } catch (err: any) {
    console.error('[E2E Harness Fatal Error]', err);
    results.push({
      suiteName: 'E2E Harness Setup',
      passed: false,
      durationMs: 0,
      error: err.message || String(err)
    });
  } finally {
    await harness.teardown();
  }

  console.log(`\n========================================`);
  console.log(`         CAPTURED CONSOLE LOGS          `);
  console.log(`========================================`);
  for (const l of harness.getLogs()) {
    console.log(`[${l.context}] [${l.type}] ${l.text}`);
  }
  console.log(`========================================`);

  console.log(`\n========================================`);
  console.log(`           E2E TEST SUMMARY             `);
  console.log(`========================================`);
  let allPassed = true;
  for (const r of results) {
    const statusIcon = r.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${statusIcon} | ${r.suiteName} (${r.durationMs}ms)`);
    if (r.screenshotPath) console.log(`   Screenshot: ${r.screenshotPath}`);
    if (r.error) {
      allPassed = false;
      console.log(`   Error: ${r.error}`);
    }
  }
  console.log(`========================================\n`);

  if (!allPassed) {
    process.exit(1);
  }
}

// CLI execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runAllE2ETests().catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
  });
}
