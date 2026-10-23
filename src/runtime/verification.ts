/**
 * SimIt Verification Harness — Diagnostic & Execution Functions
 * Conforms to docs/specs/simulation_verification.md
 *
 * Pure diagnostic functions are DOM/array-in, data-out so they run under JSDOM in unit tests.
 * `verifySimulationInStage` composes them into the full multi-phase verification pipeline
 * used by the sandbox runtime (`SANDBOX_VERIFY_SIMULATION`).
 */

import { ParameterDefinition, SimModule, SimulationExplanation, StageGeometry } from '../types/simulation';
import {
  BLANK_RENDER_THRESHOLDS,
  DEFAULT_VERIFICATION_OPTIONS,
  DiagnosticCode,
  DIAGNOSTIC_SEVERITY,
  ElementBox,
  MAX_FRAME_DIMENSION_PX,
  RasterStats,
  RuntimeErrorRecord,
  SweepStep,
  VerificationDiagnostic,
  VerificationFrame,
  VerificationOptions,
  VerificationPhase,
  VerificationReport,
  VerificationViewport
} from '../types/verification';
import { parseDataUrl } from '../providers/multimodal';
import {
  applyStageGeometryToContainer,
  computeStageGeometry,
  DEFAULT_HOST_LAYOUT,
  validateSimulationModuleContract
} from './module-contract';

/**
 * Ordered sweep plan. Always starts with 'defaults'. When sweep=true and at least one
 * slider/stepper exists, appends 'min' (all sliders/steppers at min) and 'max' (all at max).
 * Toggles/selects keep defaults; button/action params are NEVER included in any phase.
 */
export function buildSweepPlan(parameters: ParameterDefinition[], sweep: boolean): SweepStep[] {
  const defaults: Record<string, any> = {};
  const minParams: Record<string, any> = {};
  const maxParams: Record<string, any> = {};
  let hasRangeParams = false;

  for (const p of parameters) {
    if (p.type === 'button' || (p as any).type === 'action') {
      continue;
    }

    if (p.type === 'slider' || p.type === 'stepper') {
      hasRangeParams = true;
      defaults[p.id] = (p as any).default ?? p.min ?? 0;
      minParams[p.id] = p.min ?? 0;
      maxParams[p.id] = p.max ?? 100;
    } else if (p.type === 'toggle') {
      defaults[p.id] = p.default ?? false;
      minParams[p.id] = p.default ?? false;
      maxParams[p.id] = p.default ?? false;
    } else if (p.type === 'select') {
      const firstOption = Array.isArray(p.options) ? p.options[0] : '';
      defaults[p.id] = p.default ?? firstOption ?? '';
      minParams[p.id] = p.default ?? firstOption ?? '';
      maxParams[p.id] = p.default ?? firstOption ?? '';
    }
  }

  const steps: SweepStep[] = [{ phase: 'defaults', params: defaults }];

  if (sweep && hasRangeParams) {
    steps.push({ phase: 'min', params: minParams });
    steps.push({ phase: 'max', params: maxParams });
  }

  return steps;
}

/**
 * Computes RasterStats from RGBA pixel data (ImageData.data layout).
 * Must sample at most ~20k pixels (stride) for performance on large canvases.
 */
export function computeRasterStats(rgba: Uint8ClampedArray, width: number, height: number): RasterStats {
  const totalPixels = width * height;
  if (totalPixels === 0 || rgba.length === 0) {
    return { pixelCount: 0, nonDominantRatio: 0, luminanceVariance: 0 };
  }

  const maxSamples = 20000;
  const stride = Math.max(1, Math.floor(totalPixels / maxSamples));
  const sampledLuminances: number[] = [];
  const colorCounts = new Map<string, number>();

  let sampleCount = 0;
  for (let i = 0; i < totalPixels; i += stride) {
    const idx = i * 4;
    const r = rgba[idx];
    const g = rgba[idx + 1];
    const b = rgba[idx + 2];
    const a = rgba[idx + 3];

    // Quantize color into 16-step bins
    const qr = r >> 4;
    const qg = g >> 4;
    const qb = b >> 4;
    const key = `${qr},${qg},${qb},${a > 128 ? 1 : 0}`;
    colorCounts.set(key, (colorCounts.get(key) || 0) + 1);

    // ITU-R BT.601 luminance normalized 0..1
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    sampledLuminances.push(lum);
    sampleCount++;
  }

  let maxColorCount = 0;
  for (const count of colorCounts.values()) {
    if (count > maxColorCount) maxColorCount = count;
  }
  const dominantRatio = sampleCount > 0 ? maxColorCount / sampleCount : 1;
  const nonDominantRatio = 1 - dominantRatio;

  // Mean & variance of luminance
  let meanLum = 0;
  for (const l of sampledLuminances) meanLum += l;
  meanLum = sampleCount > 0 ? meanLum / sampleCount : 0;

  let lumVar = 0;
  for (const l of sampledLuminances) lumVar += (l - meanLum) ** 2;
  lumVar = sampleCount > 0 ? lumVar / sampleCount : 0;

  return {
    pixelCount: sampleCount,
    nonDominantRatio,
    luminanceVariance: lumVar
  };
}

/** True iff stats fall below BLANK_RENDER_THRESHOLDS. */
export function isBlankRender(stats: RasterStats): boolean {
  if (stats.pixelCount === 0) return true;
  return (
    stats.nonDominantRatio < BLANK_RENDER_THRESHOLDS.minNonDominantRatio ||
    stats.luminanceVariance < BLANK_RENDER_THRESHOLDS.minLuminanceVariance
  );
}

const NON_FINITE_TOKEN_REGEX = /(?:^|[^A-Za-z0-9_])(NaN|-?Infinity|undefined)(?=$|[^A-Za-z0-9_])/;

/**
 * Returns visible text snippets (trimmed, <= 60 chars each) under root that contain the
 * standalone tokens NaN, Infinity, -Infinity, or undefined. Ignores <script>/<style>.
 */
export function scanNonFiniteText(root: ParentNode, extraTexts: string[] = []): string[] {
  const snippets: string[] = [];

  if (typeof document !== 'undefined' && root) {
    const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_ACCEPT;
        const tag = parent.tagName.toLowerCase();
        if (tag === 'script' || tag === 'style') {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let currentNode = walker.nextNode();
    while (currentNode) {
      const text = currentNode.nodeValue || '';
      if (NON_FINITE_TOKEN_REGEX.test(text)) {
        const trimmed = text.replace(/\s+/g, ' ').trim().slice(0, 60);
        if (trimmed && !snippets.includes(trimmed)) {
          snippets.push(trimmed);
        }
      }
      currentNode = walker.nextNode();
    }
  }

  for (const raw of extraTexts) {
    const text = String(raw ?? '');
    if (NON_FINITE_TOKEN_REGEX.test(text)) {
      const trimmed = text.replace(/\s+/g, ' ').trim().slice(0, 60);
      if (trimmed && !snippets.includes(trimmed)) {
        snippets.push(trimmed);
      }
    }
  }

  return snippets;
}

/**
 * Counts module-created control surfaces inside the stage root:
 * Tweakpane roots (`.tp-rotv`, `.tp-dfwv`) plus <input>, <select>, <button> elements.
 * The host controls drawer lives OUTSIDE the stage root and is never counted.
 */
export function detectDuplicateControls(stageRoot: ParentNode): number {
  if (!stageRoot) return 0;
  let count = 0;
  if ('querySelectorAll' in stageRoot) {
    const panes = stageRoot.querySelectorAll('.tp-rotv, .tp-dfwv');
    const inputs = stageRoot.querySelectorAll('input, select, button');
    count = panes.length + inputs.length;
  }
  return count;
}

/**
 * Canvas sizing checks against the stage:
 * - DEFAULT_CANVAS_SIZE for any canvas with backing store exactly 300x150.
 * - CANVAS_SIZE_MISMATCH when the LARGEST canvas backing store differs from
 *   (viewport.width * dpr, viewport.height * dpr) by more than 2% on either axis.
 */
export function detectCanvasSizing(
  canvases: Array<{ width: number; height: number }>,
  viewport: VerificationViewport,
  dpr: number
): VerificationDiagnostic[] {
  const diagnostics: VerificationDiagnostic[] = [];
  if (!canvases || canvases.length === 0) return diagnostics;

  for (const cv of canvases) {
    if (cv.width === 300 && cv.height === 150) {
      diagnostics.push(
        makeDiagnostic(
          'DEFAULT_CANVAS_SIZE',
          'Canvas backing store is 300x150; canvas dimensions were never initialized.',
          { phase: 'defaults', evidence: { width: cv.width, height: cv.height } }
        )
      );
    }
  }

  // Check largest canvas against stage
  let largest = canvases[0];
  let maxArea = largest.width * largest.height;
  for (const cv of canvases) {
    const area = cv.width * cv.height;
    if (area > maxArea) {
      maxArea = area;
      largest = cv;
    }
  }

  const expectedWidth = Math.round(viewport.width * dpr);
  const expectedHeight = Math.round(viewport.height * dpr);
  const diffW = Math.abs(largest.width - expectedWidth) / (expectedWidth || 1);
  const diffH = Math.abs(largest.height - expectedHeight) / (expectedHeight || 1);

  if (diffW > 0.02 || diffH > 0.02) {
    diagnostics.push(
      makeDiagnostic(
        'CANVAS_SIZE_MISMATCH',
        `Primary canvas (${largest.width}x${largest.height}) deviates by >2% from stage bounds (${expectedWidth}x${expectedHeight}).`,
        { phase: 'defaults', evidence: { actual: largest, expected: { width: expectedWidth, height: expectedHeight } } }
      )
    );
  }

  return diagnostics;
}

/** Alias for detectCanvasSizing matching simulation_verification.md spec naming. */
export const inspectCanvasSizing = detectCanvasSizing;

/**
 * OUT_OF_BOUNDS for each box extending more than 4px beyond [0, viewport.width] x [0, viewport.height].
 * Zero-area boxes are ignored.
 */
export function detectOutOfBounds(
  boxes: ElementBox[],
  viewport: VerificationViewport,
  phase: VerificationPhase = 'defaults'
): VerificationDiagnostic[] {
  const diagnostics: VerificationDiagnostic[] = [];

  for (const box of boxes) {
    if (box.width <= 0 || box.height <= 0) continue;

    const right = box.left + box.width;
    const bottom = box.top + box.height;
    const tolerance = 4;

    const isOut =
      box.left < -tolerance ||
      box.top < -tolerance ||
      right > viewport.width + tolerance ||
      bottom > viewport.height + tolerance;

    if (isOut) {
      diagnostics.push(
        makeDiagnostic(
          'OUT_OF_BOUNDS',
          `Element ${box.descriptor} bounds extend beyond the stage container.`,
          { phase, evidence: { box, viewport } }
        )
      );
    }
  }

  return diagnostics;
}

/** Creates a diagnostic with severity taken from DIAGNOSTIC_SEVERITY. */
export function makeDiagnostic(
  code: DiagnosticCode,
  message: string,
  extra?: Pick<VerificationDiagnostic, 'phase' | 'evidence'>
): VerificationDiagnostic {
  return {
    code,
    severity: DIAGNOSTIC_SEVERITY[code],
    message,
    phase: extra?.phase,
    evidence: extra?.evidence
  };
}

/**
 * Assembles the final report. status = 'fail' iff any diagnostic severity is 'error'.
 * Every RuntimeErrorRecord MUST also appear as a RUNTIME_EXCEPTION diagnostic (deduplicated by message+phase).
 */
export function assembleVerificationReport(input: {
  diagnostics: VerificationDiagnostic[];
  runtimeErrors: RuntimeErrorRecord[];
  frames: VerificationFrame[];
  parameters: ParameterDefinition[];
  explanation?: SimulationExplanation;
  title: string;
  description: string;
  durationMs: number;
}): VerificationReport {
  const diagnostics = [...input.diagnostics];

  // Map runtime errors into RUNTIME_EXCEPTION diagnostics
  for (const err of input.runtimeErrors) {
    const exists = diagnostics.some(
      d => d.code === 'RUNTIME_EXCEPTION' && d.message === err.message && d.phase === err.phase
    );
    if (!exists) {
      diagnostics.push(
        makeDiagnostic('RUNTIME_EXCEPTION', err.message, {
          phase: err.phase as any,
          evidence: { stack: err.stack, lineno: err.lineno, colno: err.colno, params: err.params }
        })
      );
    }
  }

  const hasErrors = diagnostics.some(d => d.severity === 'error');

  return {
    status: hasErrors ? 'fail' : 'pass',
    diagnostics,
    runtimeErrors: input.runtimeErrors,
    frames: input.frames,
    parameters: input.parameters,
    ...(input.explanation ? { explanation: input.explanation } : {}),
    title: input.title,
    description: input.description,
    durationMs: input.durationMs
  };
}

/**
 * Renders diagnostics + runtime errors into a compact, model-facing block for the Coder:
 * one line per diagnostic `[SEVERITY CODE @phase] message`, followed by each runtime error's
 * message, `line:col`, params JSON, and the first 8 stack lines. Errors are listed before warnings.
 */
export function formatDiagnosticsForCoder(report: Pick<VerificationReport, 'diagnostics' | 'runtimeErrors'>): string {
  const parts: string[] = [];

  const errors = report.diagnostics.filter(d => d.severity === 'error');
  const warnings = report.diagnostics.filter(d => d.severity === 'warning');
  const sorted = [...errors, ...warnings];

  for (const d of sorted) {
    const phaseStr = d.phase ? ` @${d.phase}` : '';
    parts.push(`[${d.severity.toUpperCase()} ${d.code}${phaseStr}] ${d.message}`);
  }

  if (report.runtimeErrors && report.runtimeErrors.length > 0) {
    parts.push('\n### RUNTIME EXCEPTION TRACES:');
    for (const re of report.runtimeErrors) {
      const loc = re.lineno ? ` line ${re.lineno}:${re.colno || 0}` : '';
      parts.push(`- Exception during ${re.phase}${loc}: ${re.message}`);
      if (re.params && Object.keys(re.params).length > 0) {
        parts.push(`  Parameters state: ${JSON.stringify(re.params)}`);
      }
      if (re.stack) {
        const stackLines = re.stack.split('\n').slice(0, 8).join('\n  ');
        parts.push(`  Stack:\n  ${stackLines}`);
      }
    }
  }

  return parts.join('\n');
}

export { applyStageGeometryToContainer };

const HEADLESS_FALLBACK_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function stripMarkdownFences(rawCode: string): string {
  let clean = rawCode.trim();
  const fenceMatch = clean.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```\s*$/);
  if (fenceMatch) {
    clean = fenceMatch[1].trim();
  }
  return clean;
}

function extractLineColFromStack(stack?: string): { lineno?: number; colno?: number } {
  if (!stack) return {};
  const match = stack.match(/<anonymous>:(\d+):(\d+)/) || stack.match(/:(\d+):(\d+)\)?$/m);
  if (!match) return {};
  return {
    lineno: parseInt(match[1], 10),
    colno: parseInt(match[2], 10)
  };
}

function recordException(
  runtimeErrors: RuntimeErrorRecord[],
  phase: VerificationPhase,
  err: any,
  params?: Record<string, any>
): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  const { lineno, colno } = extractLineColFromStack(stack);
  runtimeErrors.push({
    phase,
    message,
    stack,
    lineno,
    colno,
    params: params ? { ...params } : undefined
  });
}

function collectElementBoxes(simRoot: HTMLElement, stage: StageGeometry): ElementBox[] {
  const rootRect = simRoot.getBoundingClientRect?.() || { left: 0, top: 0, width: stage.width, height: stage.height };
  const baseLeft = rootRect.left || 0;
  const baseTop = rootRect.top || 0;

  const elements = Array.from(simRoot.querySelectorAll('canvas, svg, .tp-rotv, .tp-dfwv, table, form'));
  for (const child of Array.from(simRoot.children)) {
    if (!elements.includes(child)) {
      elements.push(child);
    }
  }

  const boxes: ElementBox[] = [];
  for (const el of elements) {
    const rect = (el as HTMLElement).getBoundingClientRect?.();
    if (!rect) continue;
    const width = rect.width;
    const height = rect.height;
    if (width <= 0 || height <= 0) continue;

    const idPart = el.id ? `#${el.id}` : '';
    const classPart =
      typeof el.className === 'string' && el.className.trim()
        ? `.${el.className.trim().split(/\s+/)[0]}`
        : '';
    boxes.push({
      descriptor: `${el.tagName.toLowerCase()}${idPart}${classPart}`,
      left: rect.left - baseLeft,
      top: rect.top - baseTop,
      width,
      height
    });
  }
  return boxes;
}

/**
 * Downscales and captures canvas (including stacked multi-canvas layers) or SVG element into a VerificationFrame.
 */
async function captureStageFrame(
  simRoot: HTMLElement,
  phase: VerificationPhase,
  stage: StageGeometry,
  params: Record<string, any>,
  framesPumped: number
): Promise<VerificationFrame | null> {
  const canvases = Array.from(simRoot.querySelectorAll('canvas')) as HTMLCanvasElement[];
  if (canvases.length > 0) {
    const primary = canvases[0];
    const srcW = primary.width || stage.width;
    const srcH = primary.height || stage.height;
    const maxDim = Math.max(srcW, srcH, 1);
    const scale = maxDim > MAX_FRAME_DIMENSION_PX ? MAX_FRAME_DIMENSION_PX / maxDim : 1;
    const outW = Math.max(1, Math.round(srcW * scale));
    const outH = Math.max(1, Math.round(srcH * scale));

    try {
      let targetCanvas = primary;
      if ((canvases.length > 1 || scale < 1) && typeof document !== 'undefined') {
        const offscreen = document.createElement('canvas');
        offscreen.width = outW;
        offscreen.height = outH;
        const ctx = offscreen.getContext('2d');
        if (ctx && typeof ctx.drawImage === 'function') {
          let drewAny = false;
          for (const layer of canvases) {
            try {
              ctx.drawImage(layer, 0, 0, outW, outH);
              drewAny = true;
            } catch {
              // Ignore untrusted/uninitialized layer
            }
          }
          if (drewAny) {
            targetCanvas = offscreen;
          }
        }
      }

      if (typeof targetCanvas.toDataURL === 'function') {
        const dataUrl = targetCanvas.toDataURL('image/png');
        const image = parseDataUrl(dataUrl, `frame:${phase}`);
        if (image) {
          return {
            phase,
            width: targetCanvas.width || outW,
            height: targetCanvas.height || outH,
            image,
            params: { ...params },
            dataUrl,
            framesPumped
          };
        }
      }
    } catch {
      // Fall through if canvas is tainted or unsupported in headless environment
    }

    // Headless/JSDOM fallback when canvas exists with non-zero dimensions but toDataURL is unimplemented
    if (srcW > 0 && srcH > 0) {
      const fallbackImage = parseDataUrl(HEADLESS_FALLBACK_PNG_DATA_URL, `frame:${phase}`);
      if (fallbackImage) {
        return {
          phase,
          width: outW,
          height: outH,
          image: fallbackImage,
          params: { ...params },
          dataUrl: HEADLESS_FALLBACK_PNG_DATA_URL,
          framesPumped
        };
      }
    }
  }

  const svg = simRoot.querySelector('svg') as SVGSVGElement | null;
  if (svg && typeof XMLSerializer !== 'undefined' && typeof document !== 'undefined') {
    const scale = Math.min(1, MAX_FRAME_DIMENSION_PX / Math.max(stage.width, stage.height, 1));
    const outW = Math.max(1, Math.round(stage.width * scale));
    const outH = Math.max(1, Math.round(stage.height * scale));
    try {
      const svgString = new XMLSerializer().serializeToString(svg);
      const offscreen = document.createElement('canvas');
      offscreen.width = outW;
      offscreen.height = outH;
      const ctx = offscreen.getContext('2d');
      if (ctx && typeof Image !== 'undefined') {
        const svgBase64 = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(svgString))) : '';
        if (svgBase64) {
          const loaded = await new Promise<boolean>(resolve => {
            const img = new Image();
            const timer = setTimeout(() => resolve(false), 60);
            img.onload = () => {
              clearTimeout(timer);
              try {
                ctx.drawImage(img, 0, 0, outW, outH);
                resolve(true);
              } catch {
                resolve(false);
              }
            };
            img.onerror = () => {
              clearTimeout(timer);
              resolve(false);
            };
            img.src = `data:image/svg+xml;base64,${svgBase64}`;
          });
          if (loaded) {
            const pngUrl = offscreen.toDataURL('image/png');
            const image = parseDataUrl(pngUrl, `frame:${phase}`);
            if (image) {
              return {
                phase,
                width: outW,
                height: outH,
                image,
                params: { ...params },
                dataUrl: pngUrl,
                framesPumped
              };
            }
          }
        }
      }
    } catch {
      // Ignore SVG rasterization errors in headless environment
    }

    const graphicChildren = svg.querySelectorAll(
      'circle, rect, path, line, polyline, polygon, text, ellipse, use, image, foreignObject'
    );
    if (graphicChildren.length > 0) {
      const fallbackImage = parseDataUrl(HEADLESS_FALLBACK_PNG_DATA_URL, `frame:${phase}`);
      if (fallbackImage) {
        return {
          phase,
          width: outW,
          height: outH,
          image: fallbackImage,
          params: { ...params },
          dataUrl: HEADLESS_FALLBACK_PNG_DATA_URL,
          framesPumped
        };
      }
    }
  }

  return null;
}

/**
 * Full multi-phase verification harness runner.
 * Executes compile -> init -> rAF soak -> parameter sweep (defaults, min, max) -> destroy,
 * running all visual, structural, and numerical diagnostics.
 */
export async function verifySimulationInStage(
  simRoot: HTMLElement,
  codeString: string,
  rawOptions?: Partial<VerificationOptions>,
  globals?: Record<string, any>
): Promise<VerificationReport> {
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const options = {
    ...DEFAULT_VERIFICATION_OPTIONS,
    ...rawOptions,
    viewport: {
      ...DEFAULT_VERIFICATION_OPTIONS.viewport,
      ...(rawOptions?.viewport || {})
    }
  };
  const timeoutMs = options.timeoutMs ?? DEFAULT_VERIFICATION_OPTIONS.timeoutMs;
  const elapsedMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;

  const diagnostics: VerificationDiagnostic[] = [];
  const runtimeErrors: RuntimeErrorRecord[] = [];
  const frames: VerificationFrame[] = [];
  let parameters: ParameterDefinition[] = [];
  let title = 'Untitled Simulation';
  let description = '';

  simRoot.innerHTML = '';

  // 1. Compile phase (with markdown fence sanitization and global injection)
  let simModule!: SimModule;
  try {
    const cleanCode = stripMarkdownFences(codeString).replace(/export\s+default\s+/g, 'return ');
    const win = (typeof window !== 'undefined' ? window : globalThis) as any;
    const injectedGlobals: Record<string, any> = {
      d3: globals?.d3 ?? win.d3,
      anime: globals?.anime ?? win.anime,
      katex: globals?.katex ?? win.katex,
      Tweakpane: globals?.Tweakpane ?? win.Tweakpane,
      functionPlot: globals?.functionPlot ?? win.functionPlot,
      cytoscape: globals?.cytoscape ?? win.cytoscape,
      math: globals?.math ?? win.math,
      jstat: globals?.jstat ?? win.jstat ?? win.jStat,
      Matter: globals?.Matter ?? win.Matter,
      matter: globals?.matter ?? win.Matter ?? win.matter,
      glMatrix: globals?.glMatrix ?? win.glMatrix,
      window: globals?.window ?? (typeof window !== 'undefined' ? window : undefined),
      document: globals?.document ?? (typeof document !== 'undefined' ? document : undefined),
      ...(globals || {})
    };
    const argNames = Object.keys(injectedGlobals);
    const argValues = argNames.map(k => injectedGlobals[k]);
    const factory = new Function(...argNames, cleanCode);
    const rawModule = factory(...argValues);
    if (!rawModule || typeof rawModule !== 'object') {
      throw new Error('Simulation script did not return a valid configuration object.');
    }
    if (typeof rawModule.init !== 'function') {
      throw new Error("Simulation object is missing a valid 'init(container, params, stage)' function.");
    }
    simModule = rawModule as SimModule;
  } catch (err: any) {
    recordException(runtimeErrors, 'compile', err);
    const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return assembleVerificationReport({
      diagnostics,
      runtimeErrors,
      frames,
      parameters,
      title,
      description,
      durationMs: Math.round(endTime - startTime)
    });
  }

  title = simModule.title || title;
  description = simModule.description || description;
  parameters = Array.isArray(simModule.parameters) ? simModule.parameters : [];

  const contractValidation = validateSimulationModuleContract(simModule, parameters);
  if (contractValidation.diagnostics.length > 0) {
    diagnostics.push(...contractValidation.diagnostics);
  }

  // 2. Compute stage geometry & size container BEFORE init (V1)
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const stage = computeStageGeometry(
    {
      viewportWidth: options.viewport.width,
      viewportHeight: options.viewport.height,
      controlsDrawerHeight: DEFAULT_HOST_LAYOUT.controlsDrawerHeight
    },
    parameters.length,
    dpr
  );
  applyStageGeometryToContainer(simRoot, stage);

  const sweepPlan = buildSweepPlan(parameters, options.sweep ?? true);
  const defaultParams = { ...(sweepPlan[0]?.params || {}) };

  // Set up rAF queue interception, WebGL preserveDrawingBuffer wrapper, & canvas draw spy
  const rafQueue = new Map<number, FrameRequestCallback>();
  let nextRafId = 1;
  const origRaf = typeof window !== 'undefined' ? window.requestAnimationFrame : undefined;
  const origCaf = typeof window !== 'undefined' ? window.cancelAnimationFrame : undefined;
  const origGetContext =
    typeof HTMLCanvasElement !== 'undefined' ? HTMLCanvasElement.prototype.getContext : undefined;

  const interceptedCanvasTexts: string[] = [];
  let canvasDrawCalls = 0;
  let ctx2dRequested = false;

  const origFillText =
    typeof CanvasRenderingContext2D !== 'undefined'
      ? CanvasRenderingContext2D.prototype.fillText
      : undefined;
  const origStrokeText =
    typeof CanvasRenderingContext2D !== 'undefined'
      ? CanvasRenderingContext2D.prototype.strokeText
      : undefined;
  const origFillRect =
    typeof CanvasRenderingContext2D !== 'undefined'
      ? CanvasRenderingContext2D.prototype.fillRect
      : undefined;
  const origStrokeRect =
    typeof CanvasRenderingContext2D !== 'undefined'
      ? CanvasRenderingContext2D.prototype.strokeRect
      : undefined;
  const origArc =
    typeof CanvasRenderingContext2D !== 'undefined'
      ? CanvasRenderingContext2D.prototype.arc
      : undefined;
  const origLineTo =
    typeof CanvasRenderingContext2D !== 'undefined'
      ? CanvasRenderingContext2D.prototype.lineTo
      : undefined;
  const origDrawImage =
    typeof CanvasRenderingContext2D !== 'undefined'
      ? CanvasRenderingContext2D.prototype.drawImage
      : undefined;
  const origPutImageData =
    typeof CanvasRenderingContext2D !== 'undefined'
      ? CanvasRenderingContext2D.prototype.putImageData
      : undefined;

  if (typeof window !== 'undefined') {
    window.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
      const id = nextRafId++;
      rafQueue.set(id, cb);
      return id;
    }) as typeof window.requestAnimationFrame;

    window.cancelAnimationFrame = ((id: number): void => {
      rafQueue.delete(id);
    }) as typeof window.cancelAnimationFrame;
  }

  if (typeof HTMLCanvasElement !== 'undefined' && origGetContext) {
    HTMLCanvasElement.prototype.getContext = function (contextId: string, contextAttributes?: any): any {
      if (contextId === '2d') {
        ctx2dRequested = true;
      } else if (contextId === 'webgl' || contextId === 'webgl2' || contextId === 'experimental-webgl') {
        contextAttributes = { ...(contextAttributes || {}), preserveDrawingBuffer: true };
      }
      return origGetContext.call(this, contextId as any, contextAttributes);
    };
  }

  if (typeof CanvasRenderingContext2D !== 'undefined') {
    if (origFillText) {
      CanvasRenderingContext2D.prototype.fillText = function (text: string, x: number, y: number, maxWidth?: number) {
        interceptedCanvasTexts.push(String(text));
        canvasDrawCalls++;
        return origFillText.call(this, text, x, y, maxWidth as any);
      };
    }
    if (origStrokeText) {
      CanvasRenderingContext2D.prototype.strokeText = function (text: string, x: number, y: number, maxWidth?: number) {
        interceptedCanvasTexts.push(String(text));
        canvasDrawCalls++;
        return origStrokeText.call(this, text, x, y, maxWidth as any);
      };
    }
    if (origFillRect) {
      CanvasRenderingContext2D.prototype.fillRect = function (x: number, y: number, w: number, h: number) {
        canvasDrawCalls++;
        return origFillRect.call(this, x, y, w, h);
      };
    }
    if (origStrokeRect) {
      CanvasRenderingContext2D.prototype.strokeRect = function (x: number, y: number, w: number, h: number) {
        canvasDrawCalls++;
        return origStrokeRect.call(this, x, y, w, h);
      };
    }
    if (origArc) {
      CanvasRenderingContext2D.prototype.arc = function (...args: any[]) {
        canvasDrawCalls++;
        return (origArc as any).apply(this, args);
      };
    }
    if (origLineTo) {
      CanvasRenderingContext2D.prototype.lineTo = function (x: number, y: number) {
        canvasDrawCalls++;
        return origLineTo.call(this, x, y);
      };
    }
    if (origDrawImage) {
      CanvasRenderingContext2D.prototype.drawImage = function (...args: any[]) {
        canvasDrawCalls++;
        return (origDrawImage as any).apply(this, args);
      };
    }
    if (origPutImageData) {
      CanvasRenderingContext2D.prototype.putImageData = function (...args: any[]) {
        canvasDrawCalls++;
        return (origPutImageData as any).apply(this, args);
      };
    }
  }

  let timedOut = false;
  const checkTimeout = (phase: VerificationPhase): boolean => {
    if (timedOut) return true;
    if (elapsedMs() > timeoutMs) {
      timedOut = true;
      diagnostics.push(
        makeDiagnostic(
          'TIMEOUT',
          `Verification exceeded timeout budget (${timeoutMs}ms) during ${phase} phase.`,
          { phase, evidence: { timeoutMs, elapsedMs: Math.round(elapsedMs()) } }
        )
      );
      return true;
    }
    return false;
  };

  const pumpRafFrames = async (
    maxFrames: number,
    phase: VerificationPhase,
    activeParams: Record<string, any>
  ): Promise<number> => {
    let pumped = 0;
    for (let frameIdx = 0; frameIdx < maxFrames; frameIdx++) {
      if (checkTimeout(phase)) break;
      if (rafQueue.size === 0) {
        await new Promise(r => setTimeout(r, 0));
        if (rafQueue.size === 0) break;
      }
      const batch = Array.from(rafQueue.entries());
      rafQueue.clear();
      const timestamp = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + frameIdx * 16.67;

      let threwInBatch = false;
      for (const [, cb] of batch) {
        try {
          cb(timestamp);
        } catch (err: any) {
          recordException(runtimeErrors, phase, err, activeParams);
          threwInBatch = true;
          break;
        }
      }
      pumped++;
      if (threwInBatch) {
        break;
      }
    }
    return pumped;
  };

  const sampleCanvasPixelSignature = (canvas: HTMLCanvasElement): Uint8ClampedArray | null => {
    try {
      const ctx = canvas.getContext('2d');
      if (ctx && typeof ctx.getImageData === 'function' && canvas.width > 0 && canvas.height > 0) {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        if (imgData && imgData.data && imgData.data.length > 0) {
          return new Uint8ClampedArray(imgData.data);
        }
      }
    } catch {
      // Ignore cross-origin or WebGL context mismatch
    }
    return null;
  };

  try {
    // 3. Init phase (supports synchronous or async init)
    try {
      await Promise.resolve(simModule.init(simRoot, defaultParams, stage));
    } catch (err: any) {
      recordException(runtimeErrors, 'init', err, defaultParams);
    }
    checkTimeout('init');

    // Capture pre-soak pixel buffer if an animation loop is registered
    const hadRafBeforeSoak = rafQueue.size > 0;
    const initialCanvas = simRoot.querySelector('canvas') as HTMLCanvasElement | null;
    const preSoakPixels = hadRafBeforeSoak && initialCanvas ? sampleCanvasPixelSignature(initialCanvas) : null;

    // 4. Soak phase (pump rAF callbacks up to soakFrames)
    const soakFrames = Math.max(3, Math.min(30, Math.ceil((options.soakMs || 500) / 16)));
    const soakFramesPumped = timedOut ? 0 : await pumpRafFrames(soakFrames, 'soak', defaultParams);

    // Check NO_FRAME_PROGRESS when an animation loop pumped multiple frames on a readable non-blank 2D canvas
    if (!timedOut && hadRafBeforeSoak && soakFramesPumped >= 2 && preSoakPixels && initialCanvas) {
      const postSoakPixels = sampleCanvasPixelSignature(initialCanvas);
      if (postSoakPixels && postSoakPixels.length === preSoakPixels.length) {
        const postStats = computeRasterStats(postSoakPixels, initialCanvas.width, initialCanvas.height);
        if (!isBlankRender(postStats)) {
          let identical = true;
          const stride = Math.max(4, Math.floor(postSoakPixels.length / 4000) * 4);
          for (let i = 0; i < postSoakPixels.length; i += stride) {
            if (
              postSoakPixels[i] !== preSoakPixels[i] ||
              postSoakPixels[i + 1] !== preSoakPixels[i + 1] ||
              postSoakPixels[i + 2] !== preSoakPixels[i + 2] ||
              postSoakPixels[i + 3] !== preSoakPixels[i + 3]
            ) {
              identical = false;
              break;
            }
          }
          if (identical) {
            diagnostics.push(
              makeDiagnostic(
                'NO_FRAME_PROGRESS',
                `Animation loop pumped ${soakFramesPumped} frames without changing any sampled canvas pixels.`,
                { phase: 'soak', evidence: { framesPumped: soakFramesPumped } }
              )
            );
          }
        }
      }
    }

    // 5. Audit & Parameter Sweep phases ('defaults', 'min', 'max')
    for (const step of sweepPlan) {
      if (checkTimeout(step.phase)) break;

      let stepFramesPumped = step.phase === 'defaults' ? soakFramesPumped : 0;
      if (step.phase !== 'defaults') {
        interceptedCanvasTexts.length = 0;
        if (typeof simModule.update === 'function') {
          try {
            await Promise.resolve(simModule.update({ ...step.params }));
          } catch (err: any) {
            recordException(runtimeErrors, step.phase, err, step.params);
          }
          stepFramesPumped = await pumpRafFrames(2, step.phase, step.params);
        }
      }

      // V4: Non-finite text audit across every phase
      const badSnippets = scanNonFiniteText(simRoot, interceptedCanvasTexts);
      if (badSnippets.length > 0) {
        diagnostics.push(
          makeDiagnostic(
            'NON_FINITE_TEXT',
            `Non-finite or undefined values rendered in ${step.phase} phase: ${badSnippets.join('; ')}`,
            { phase: step.phase, evidence: { snippets: badSnippets, params: step.params } }
          )
        );
      }

      // V5 & V6 structural checks on defaults phase
      if (step.phase === 'defaults') {
        const dupControls = detectDuplicateControls(simRoot);
        if (dupControls > 0) {
          diagnostics.push(
            makeDiagnostic(
              'DUPLICATE_CONTROLS',
              `Detected ${dupControls} duplicate control element(s) inside #sim-root; host already renders parameter controls.`,
              { phase: 'defaults', evidence: { count: dupControls } }
            )
          );
        }

        const canvases = Array.from(simRoot.querySelectorAll('canvas'));
        if (canvases.length > 0) {
          const canvasRects = canvases.map(c => ({ width: c.width, height: c.height }));
          diagnostics.push(
            ...detectCanvasSizing(canvasRects, { width: stage.width, height: stage.height }, stage.dpr)
          );
        }
      }

      // V5: Out-of-bounds element check across all sweep phases
      const boxes = collectElementBoxes(simRoot, stage);
      diagnostics.push(...detectOutOfBounds(boxes, { width: stage.width, height: stage.height }, step.phase));

      // V3: Blank render & visual root detection on defaults phase
      if (step.phase === 'defaults') {
        const canvases = Array.from(simRoot.querySelectorAll('canvas'));
        const svgs = Array.from(simRoot.querySelectorAll('svg'));

        if (canvases.length > 0) {
          let evaluatedCount = 0;
          let nonBlankCount = 0;
          let lastStats: RasterStats | undefined;

          for (const canvas of canvases) {
            try {
              const ctx = canvas.getContext('2d');
              if (ctx && typeof ctx.getImageData === 'function' && canvas.width > 0 && canvas.height > 0) {
                const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                if (imgData && imgData.data) {
                  evaluatedCount++;
                  const stats = computeRasterStats(imgData.data, canvas.width, canvas.height);
                  lastStats = stats;
                  if (!isBlankRender(stats)) {
                    nonBlankCount++;
                  }
                }
              }
            } catch {
              // Ignore cross-origin or WebGL getContext('2d') mismatch
            }
          }

          if (evaluatedCount > 0 && nonBlankCount === 0) {
            diagnostics.push(
              makeDiagnostic('BLANK_RENDER', 'Canvas layer(s) produced a uniform or blank render after soak.', {
                phase: 'defaults',
                evidence: lastStats
              })
            );
          } else if (evaluatedCount === 0) {
            const hasNonZeroCanvas = canvases.some(c => c.width > 0 && c.height > 0);
            if (!hasNonZeroCanvas) {
              diagnostics.push(
                makeDiagnostic('BLANK_RENDER', 'Primary canvas has zero width or height.', {
                  phase: 'defaults',
                  evidence: { width: canvases[0].width, height: canvases[0].height }
                })
              );
            }
          }
        } else if (svgs.length > 0) {
          const hasGraphicChildren = svgs.some(
            svg =>
              svg.querySelectorAll(
                'circle, rect, path, line, polyline, polygon, text, ellipse, use, image, foreignObject'
              ).length > 0
          );
          if (!hasGraphicChildren) {
            diagnostics.push(
              makeDiagnostic('BLANK_RENDER', 'SVG element contains no visible graphical child nodes.', {
                phase: 'defaults'
              })
            );
          }
        } else if (simRoot.children.length === 0 && (simRoot.textContent || '').trim().length === 0) {
          diagnostics.push(
            makeDiagnostic('NO_VISUAL_ROOT', 'No <canvas>, <svg>, or visible DOM elements mounted inside #sim-root.', {
              phase: 'defaults'
            }),
            makeDiagnostic('BLANK_RENDER', 'Simulation stage is empty after init and soak.', {
              phase: 'defaults'
            })
          );
        }
      }

      // Frame capture
      if (options.captureFrames) {
        const frame = await captureStageFrame(simRoot, step.phase, stage, step.params, stepFramesPumped);
        if (frame) {
          frames.push(frame);
        }
      }
    }

    // 6. Destroy phase
    if (typeof simModule.destroy === 'function') {
      try {
        await Promise.resolve(simModule.destroy());
      } catch (err: any) {
        recordException(runtimeErrors, 'destroy', err);
      }
    }
  } finally {
    rafQueue.clear();
    if (typeof window !== 'undefined') {
      if (origRaf) window.requestAnimationFrame = origRaf;
      if (origCaf) window.cancelAnimationFrame = origCaf;
    }
    if (typeof HTMLCanvasElement !== 'undefined' && origGetContext) {
      HTMLCanvasElement.prototype.getContext = origGetContext;
    }
    if (typeof CanvasRenderingContext2D !== 'undefined') {
      if (origFillText) CanvasRenderingContext2D.prototype.fillText = origFillText;
      if (origStrokeText) CanvasRenderingContext2D.prototype.strokeText = origStrokeText;
      if (origFillRect) CanvasRenderingContext2D.prototype.fillRect = origFillRect;
      if (origStrokeRect) CanvasRenderingContext2D.prototype.strokeRect = origStrokeRect;
      if (origArc) CanvasRenderingContext2D.prototype.arc = origArc;
      if (origLineTo) CanvasRenderingContext2D.prototype.lineTo = origLineTo;
      if (origDrawImage) CanvasRenderingContext2D.prototype.drawImage = origDrawImage;
      if (origPutImageData) CanvasRenderingContext2D.prototype.putImageData = origPutImageData;
    }
  }

  const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return assembleVerificationReport({
    diagnostics,
    runtimeErrors,
    frames,
    parameters,
    explanation: simModule.explanation,
    title,
    description,
    durationMs: Math.round(endTime - startTime)
  });
}
