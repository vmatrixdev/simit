/**
 * SimIt Simulation Module Contract — Single Source of Truth for Coder-Facing Rules
 * Conforms to docs/specs/simulation_module_contract.md
 *
 * Both the autonomous Coder prompt (agent-orchestrator.ts) and the legacy single-shot
 * prompt (prompt-builder.ts) MUST embed buildModuleContractPromptSection() verbatim,
 * so runtime behavior and prompt instructions can never drift apart again.
 */

import {
  ExplanationLegendItem,
  ExplanationTourStep,
  HostLayoutMetrics,
  ParameterDefinition,
  ParameterState,
  SimModule,
  SimulationExplanation,
  StageGeometry
} from '../types/simulation';
import { VerificationDiagnostic } from '../types/verification';

/** Host chrome defaults (CSS px). The controls drawer sits BELOW the stage, never over it. */
export const DEFAULT_HOST_LAYOUT: HostLayoutMetrics & {
  viewportPill: { width: number; height: number; margin: number };
} = {
  viewportWidth: 380,
  viewportHeight: 500,
  controlsDrawerHeight: 44,
  viewportPill: { width: 150, height: 30, margin: 10 },
  devicePixelRatio: 1
};

/** Shared visual tokens injected into the prompt and used by the harness contrast checks. */
export const STAGE_THEME = {
  background: '#090d16',
  foreground: '#f8fafc',
  muted: '#94a3b8',
  accents: ['#38bdf8', '#10b981', '#f59e0b', '#f472b6', '#a78bfa'],
  minFontPx: 11
} as const;

/**
 * Stable identifiers for every clause the prompt section MUST contain.
 * Tests assert each clause marker is present via CLAUSE_PROBES.
 */
export type ModuleContractClause =
  | 'export_shape'          // export default { title, description, parameters, explanation, init, update, destroy }
  | 'host_owned_controls'   // never create Tweakpane panes or HTML inputs/buttons; declare `parameters` instead
  | 'parameter_types'       // slider | toggle | stepper | select | button with required fields
  | 'update_semantics'      // update() gets FULL state; button ids are true for exactly one call
  | 'stage_geometry'        // use init's `stage` arg; size canvas to stage * dpr; ctx.scale(dpr, dpr)
  | 'safe_area'             // keep labels/readouts out of stage.safeArea insets
  | 'resize'                // handle ResizeObserver on container; redraw on size change
  | 'animation_lifecycle'   // rAF loop started in init, cancelled in destroy; first frame drawn synchronously in init
  | 'theme'                 // background/foreground/accents, min font size
  | 'no_zoom_params'        // host provides zoom/pan; never declare zoom/pan parameters
  | 'csp'                   // no fetch/XHR/WebSocket/eval/window.parent
  | 'defensive_math'        // guard NaN/Infinity/division by zero; never render non-finite numbers
  | 'worked_example';       // one complete minimal module that satisfies every clause above

/**
 * Lowercase substrings that MUST appear in the generated section for each clause.
 * The unit tests use these probes; implementers may phrase freely around them.
 */
export const CLAUSE_PROBES: Record<ModuleContractClause, string[]> = {
  export_shape: ['export default {', 'init(container, params, stage)', 'update(params)', 'destroy()'],
  host_owned_controls: ['host renders all controls', 'never create a tweakpane'],
  parameter_types: ["'slider'", "'toggle'", "'stepper'", "'select'", "'button'"],
  update_semantics: ['full parameter state', 'exactly one update'],
  stage_geometry: ['stage.width', 'stage.height', 'stage.dpr'],
  safe_area: ['stage.safearea'],
  resize: ['resizeobserver'],
  animation_lifecycle: ['requestanimationframe', 'cancelanimationframe', 'draw the first frame synchronously'],
  theme: ['#090d16', '#f8fafc', '11px'],
  no_zoom_params: ['zoom'],
  csp: ['fetch', 'eval'],
  defensive_math: ['nan'],
  worked_example: ['<simulation_code>', '</simulation_code>']
};

export interface ModuleContractValidationResult {
  valid: boolean;
  isValid: boolean;
  diagnostics: VerificationDiagnostic[];
  warnings: string[];
  errors: string[];
  normalizedExplanation?: SimulationExplanation;
}

/**
 * Validates a SimModule against the Simulation Module Contract, including the optional
 * `explanation` schema (`insight`, `legend`, `tour` with declared parameter ID validation).
 * Legacy modules that omit `explanation` pass without warning diagnostics.
 */
export function validateSimulationModuleContract(
  mod: any,
  parameterDefsOverride?: ParameterDefinition[]
): ModuleContractValidationResult {
  const diagnostics: VerificationDiagnostic[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  let normalizedExplanation: SimulationExplanation | undefined;

  const emitWarning = (message: string, evidence?: Record<string, any>) => {
    warnings.push(message);
    diagnostics.push({
      code: 'INVALID_EXPLANATION_SCHEMA',
      severity: 'warning',
      phase: 'defaults',
      message,
      evidence
    });
  };

  if (!mod || typeof mod !== 'object') {
    errors.push('Simulation module must be a non-null object.');
    return { valid: false, isValid: false, diagnostics, warnings, errors };
  }

  if (typeof mod.init !== 'function') {
    errors.push("Simulation module is missing required 'init(container, params, stage)' method.");
  }
  if (typeof mod.update !== 'function') {
    errors.push("Simulation module is missing required 'update(params)' method.");
  }

  if (mod.explanation !== undefined) {
    const exp = mod.explanation;
    if (!exp || typeof exp !== 'object' || Array.isArray(exp)) {
      emitWarning('Module explanation must be a non-null object with { insight, legend?, tour? }.');
    } else {
      const normalizedLegend: ExplanationLegendItem[] = [];
      const normalizedTour: ExplanationTourStep[] = [];

      if (typeof exp.insight !== 'string' || !exp.insight.trim()) {
        emitWarning('explanation.insight must be a non-empty string summarizing the core insight.');
      }

      if (exp.legend !== undefined) {
        if (!Array.isArray(exp.legend)) {
          emitWarning('explanation.legend must be an array of { symbol, meaning, color? }.');
        } else {
          exp.legend.forEach((item: any, idx: number) => {
            const sym =
              typeof item?.symbol === 'string' && item.symbol.trim()
                ? item.symbol.trim()
                : typeof item?.elementId === 'string' && item.elementId.trim()
                  ? item.elementId.trim()
                  : '';
            const meaning = typeof item?.meaning === 'string' ? item.meaning.trim() : '';
            if (!item || typeof item !== 'object' || !sym || !meaning) {
              emitWarning(
                `explanation.legend[${idx}] must contain non-empty string 'symbol' (or 'elementId') and 'meaning'.`,
                { index: idx, item }
              );
            } else {
              normalizedLegend.push({
                symbol: sym,
                meaning,
                ...(typeof item.elementId === 'string' && item.elementId.trim()
                  ? { elementId: item.elementId.trim() }
                  : {}),
                ...(typeof item.color === 'string' && item.color.trim() ? { color: item.color.trim() } : {})
              });
            }
          });
        }
      }

      const paramList: ParameterDefinition[] = Array.isArray(parameterDefsOverride)
        ? parameterDefsOverride
        : Array.isArray(mod.parameters)
          ? mod.parameters
          : [];
      const declaredParamIds = new Set(
        paramList.filter(p => p && typeof p.id === 'string').map(p => p.id)
      );

      if (exp.tour !== undefined) {
        if (!Array.isArray(exp.tour)) {
          emitWarning('explanation.tour must be an array of guided tour step objects.');
        } else {
          exp.tour.forEach((step: any, idx: number) => {
            const caption = typeof step?.caption === 'string' ? step.caption.trim() : '';
            if (!step || typeof step !== 'object' || !caption) {
              emitWarning(
                `explanation.tour[${idx}] must contain a non-empty 'caption' string.`,
                { index: idx, step }
              );
              return;
            }
            const normalizedParams: ParameterState = {};
            if (step.params !== undefined) {
              if (!step.params || typeof step.params !== 'object' || Array.isArray(step.params)) {
                emitWarning(
                  `explanation.tour[${idx}].params must be a key-value parameter state object.`,
                  { index: idx, params: step.params }
                );
              } else {
                for (const key of Object.keys(step.params)) {
                  if (!declaredParamIds.has(key)) {
                    emitWarning(
                      `explanation.tour[${idx}].params references unknown parameter id "${key}".`,
                      { index: idx, undeclaredParamId: key, declaredIds: Array.from(declaredParamIds) }
                    );
                  } else {
                    normalizedParams[key] = step.params[key];
                  }
                }
              }
            }
            normalizedTour.push({
              ...(typeof step.title === 'string' && step.title.trim() ? { title: step.title.trim() } : {}),
              caption,
              params: normalizedParams,
              ...(typeof step.highlight === 'string' && step.highlight.trim()
                ? { highlight: step.highlight.trim() }
                : typeof step.highlightSelector === 'string' && step.highlightSelector.trim()
                  ? { highlight: step.highlightSelector.trim(), highlightSelector: step.highlightSelector.trim() }
                  : {}),
              ...(typeof step.tryThis === 'string' && step.tryThis.trim() ? { tryThis: step.tryThis.trim() } : {}),
              ...(typeof step.noticeThat === 'string' && step.noticeThat.trim()
                ? { noticeThat: step.noticeThat.trim() }
                : {})
            });
          });
        }
      }

      if (typeof exp.insight === 'string' && exp.insight.trim()) {
        normalizedExplanation = {
          insight: exp.insight.trim(),
          legend: normalizedLegend,
          tour: normalizedTour
        };
      }
    }
  }

  const valid = errors.length === 0;
  return { valid, isValid: valid, diagnostics, warnings, errors, normalizedExplanation };
}

/**
 * Derives StageGeometry from host layout metrics.
 * Supports both:
 * 1. `computeStageGeometry(metrics)` (where `metrics.devicePixelRatio` & `metrics.controlsDrawerHeight` are used directly)
 * 2. `computeStageGeometry(metrics, parameterCount, dpr)` (where `controlsDrawerHeight` is 0 when `parameterCount === 0`)
 */
export function computeStageGeometry(
  metrics: Partial<HostLayoutMetrics> = DEFAULT_HOST_LAYOUT,
  parameterCount?: number,
  dprOverride?: number
): StageGeometry {
  const viewportWidth = Math.max(200, Math.round(metrics.viewportWidth ?? DEFAULT_HOST_LAYOUT.viewportWidth));
  const viewportHeight = Math.max(200, Math.round(metrics.viewportHeight ?? DEFAULT_HOST_LAYOUT.viewportHeight));
  const rawDrawerHeight = metrics.controlsDrawerHeight ?? DEFAULT_HOST_LAYOUT.controlsDrawerHeight;
  const drawerHeight = parameterCount === 0 ? 0 : Math.max(0, Math.round(rawDrawerHeight));
  const explanationHeight = Math.max(0, Math.round(metrics.explanationBarHeight ?? 0));

  const height = Math.max(200, viewportHeight - drawerHeight - explanationHeight);
  const rawDpr = dprOverride ?? metrics.devicePixelRatio ?? 1;
  const dpr = Math.max(1, Math.min(3, Math.round((Number.isFinite(rawDpr) && rawDpr > 0 ? rawDpr : 1) * 100) / 100));

  const pill = metrics.viewportPill ?? DEFAULT_HOST_LAYOUT.viewportPill;
  const bottomInset = (pill?.height || 0) + 2 * (pill?.margin || 0);

  return {
    width: viewportWidth,
    height,
    dpr,
    safeArea: {
      top: 0,
      right: 0,
      bottom: bottomInset,
      left: 0
    }
  };
}

/**
 * Ensures `simRoot` exposes non-zero geometry matching `stage` even in headless/JSDOM
 * environments where layout engines do not compute `clientWidth` / `clientHeight`.
 */
export function applyStageGeometryToContainer(simRoot: HTMLElement, stage: StageGeometry): void {
  simRoot.style.width = `${stage.width}px`;
  simRoot.style.height = `${stage.height}px`;

  if (simRoot.clientWidth === 0) {
    Object.defineProperty(simRoot, 'clientWidth', {
      configurable: true,
      get: () => stage.width
    });
  }
  if (simRoot.clientHeight === 0) {
    Object.defineProperty(simRoot, 'clientHeight', {
      configurable: true,
      get: () => stage.height
    });
  }
  if (simRoot.offsetWidth === 0) {
    Object.defineProperty(simRoot, 'offsetWidth', {
      configurable: true,
      get: () => stage.width
    });
  }
  if (simRoot.offsetHeight === 0) {
    Object.defineProperty(simRoot, 'offsetHeight', {
      configurable: true,
      get: () => stage.height
    });
  }
}

/**
 * Builds the initial persistent parameter state from parameter definitions, excluding
 * transient button/action parameters.
 */
export function buildInitialParameterState(
  parameterDefs: ParameterDefinition[] = [],
  overrides: ParameterState = {}
): ParameterState {
  const state: ParameterState = {};
  for (const p of parameterDefs) {
    if (!p || typeof p.id !== 'string') continue;
    if (p.type === 'button' || (p as any).type === 'action') continue;
    const rawP = p as any;
    if (rawP.default !== undefined) {
      state[p.id] = rawP.default;
    } else if (p.type === 'slider' || p.type === 'stepper') {
      state[p.id] = p.min ?? 0;
    } else if (p.type === 'toggle') {
      state[p.id] = false;
    } else if (p.type === 'select') {
      state[p.id] = Array.isArray(p.options) && p.options.length > 0 ? p.options[0] : '';
    }
  }
  for (const [key, val] of Object.entries(overrides)) {
    const def = parameterDefs.find(p => p?.id === key);
    if (def && (def.type === 'button' || (def as any).type === 'action')) continue;
    state[key] = val;
  }
  return state;
}

/**
 * Dispatches a parameter update to a SimModule while enforcing C4 (full parameter state)
 * and C5 (button action transient `{ ...currentParams, [btnId]: true }` for one call, then deleted).
 */
export function dispatchParameterUpdate(
  simModule: Pick<SimModule, 'update'>,
  currentParams: ParameterState,
  parameterDefs: ParameterDefinition[] = [],
  delta: ParameterState = {}
): ParameterState {
  const buttonIds = new Set(
    parameterDefs
      .filter(p => p && (p.type === 'button' || (p as any).type === 'action'))
      .map(p => p.id)
  );

  const callPayload: ParameterState = { ...currentParams, ...delta };
  if (typeof simModule.update === 'function') {
    simModule.update(callPayload);
  }

  const nextPersistentState: ParameterState = { ...callPayload };
  for (const key of Object.keys(delta)) {
    if (buttonIds.has(key)) {
      delete nextPersistentState[key];
    }
  }
  for (const btnId of buttonIds) {
    delete nextPersistentState[btnId];
  }

  return nextPersistentState;
}

export const mergeAndDispatchUpdate = dispatchParameterUpdate;

/**
 * Renders the complete Coder-facing module contract as a markdown prompt section,
 * parameterized by the concrete stage geometry. Satisfies every CLAUSE_PROBES entry.
 */
export function buildModuleContractPromptSection(stage: StageGeometry = computeStageGeometry()): string {
  return `### SIMULATION MODULE CONTRACT & STAGE GEOMETRY
You are writing an executable ES module adhering to SimIt's simEngine lifecycle.

1. HOST RENDERS ALL CONTROLS:
- NEVER create a Tweakpane instance (never call new Tweakpane or new Pane)!
- The host renders all controls externally from your exported 'parameters' definition.
- Never write manual HTML <input>, <select>, <button>, or controls inside #sim-root.

2. PARAMETER DEFINITIONS:
Declare interactive controls in the 'parameters' array using supported types:
- 'slider': continuous numeric range ({ id, label, type: 'slider', min, max, step, default, unit? })
- 'toggle': boolean switch ({ id, label, type: 'toggle', default: boolean })
- 'stepper': discrete integers ({ id, label, type: 'stepper', min, max, step, default })
- 'select': dropdown choices ({ id, label, type: 'select', options: ['A', 'B'], default: 'A' })
- 'button': action triggers ({ id, label, type: 'button' })

3. UPDATE SEMANTICS:
- update(params) always receives the FULL parameter state on every turn.
- Button clicks dispatch { ...currentParams, [buttonId]: true } for exactly one update turn, after which the transient button key is removed.

4. STAGE GEOMETRY & FULL-BLEED SIZING:
- The host passes 'stage' into init(container, params, stage).
- CSS stage dimensions: stage.width = ${stage.width}px, stage.height = ${stage.height}px, stage.dpr = ${stage.dpr}.
- Canvas Backing Store:
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width: 100%; height: 100%; display: block;';
  container.appendChild(canvas);
  canvas.width = Math.round(stage.width * stage.dpr);
  canvas.height = Math.round(stage.height * stage.dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(stage.dpr, stage.dpr);
- SAFE AREA INSETS:
  The host displays a floating navigation pill in the bottom-left corner (stage.safeArea.bottom = ${stage.safeArea.bottom}px). Keep critical readouts, labels, and legends above stage.safeArea.
- RESIZE OBSERVER:
  Attach a ResizeObserver on container to resize canvas and redraw when the container geometry changes.

5. ANIMATION LIFECYCLE:
- Loop via requestAnimationFrame:
  Draw the first frame synchronously during init() so initial snapshots are never blank!
  Store animId and call cancelAnimationFrame in destroy().

6. THEME & TYPOGRAPHY:
- Background: ${STAGE_THEME.background}
- Primary text & curves: ${STAGE_THEME.foreground}, accents (#38bdf8, #10b981)
- Minimum font size: ${STAGE_THEME.minFontPx}px. All labels must be clearly readable on dark background.

7. NO ZOOM PARAMETERS:
- The host provides universal hardware-accelerated zoom and pan controls. Never declare zoom or pan parameters in 'parameters'!

8. CSP & DEFENSIVE MATH:
- STRICT CSP: No fetch, XMLHttpRequest, WebSocket, eval(), or window.parent access.
- Defensively guard against division by zero, NaN, and Infinity (use Number.isFinite). Never render NaN to the screen.

9. EXPLANATION & GUIDED TOUR CONTRACT (explanation: { insight, legend, tour }):
- Export an 'explanation' object alongside 'title', 'description', 'parameters', 'init', 'update', 'destroy':
  explanation: {
    insight: "One-sentence core insight the learner should walk away with",
    misconception: "Optional common misconception this simulation disabuses",
    legend: [
      { elementId: "osc-canvas", symbol: "x(t)", meaning: "Displacement trajectory over time", color: "#38bdf8" }
    ],
    tour: [
      { caption: "Step 1: Underdamped oscillation rings with slow decay.", params: { freq: 2.0 }, highlight: "osc-canvas", tryThis: "Increase Frequency", noticeThat: "Oscillation period shortens" }
    ]
  }
- Guided tours (\`explanation.tour\`) must drive the live simulation model via parameter updates (\`params\` passed to \`update(params)\`); never hardcode static frames or disconnected slides.
- Every key in each tour step's \`params\` MUST match a declared parameter \`id\` in \`parameters\`.

10. OUTPUT FORMAT & WORKED EXAMPLE:
Output valid JavaScript starting with "export default {":
<simulation_code>
export default {
  title: "Harmonic Motion",
  description: "Real-time dynamic oscillation model.",
  parameters: [
    { id: "freq", label: "Frequency", type: "slider", min: 0.5, max: 5.0, step: 0.1, default: 2.0, unit: "Hz" },
    { id: "active", label: "Simulate", type: "toggle", default: true }
  ],
  explanation: {
    insight: "Doubling the frequency doubles the oscillation rate without changing amplitude.",
    legend: [
      { elementId: "osc-canvas", symbol: "f", meaning: "Oscillation frequency (Hz)", color: "#38bdf8" }
    ],
    tour: [
      { caption: "Baseline oscillation at f = 2.0 Hz.", params: { freq: 2.0 }, highlight: "osc-canvas" },
      { caption: "High-frequency regime at f = 4.5 Hz.", params: { freq: 4.5 }, highlight: "osc-canvas" }
    ]
  },
  init(container, params, stage) {
    this.container = container;
    this.params = { ...params };
    const canvas = document.createElement('canvas');
    canvas.id = 'osc-canvas';
    canvas.style.cssText = 'width: 100%; height: 100%; display: block;';
    container.appendChild(canvas);
    canvas.width = Math.round(stage.width * stage.dpr);
    canvas.height = Math.round(stage.height * stage.dpr);
    this.ctx = canvas.getContext('2d');
    this.ctx.scale(stage.dpr, stage.dpr);

    this.t = 0;
    // Draw the first frame synchronously
    this.draw();

    const loop = () => {
      if (this.params.active) {
        this.t += 0.016;
        this.draw();
      }
      this.animId = requestAnimationFrame(loop);
    };
    this.animId = requestAnimationFrame(loop);
  },
  draw() {
    const { ctx } = this;
    ctx.fillStyle = '${STAGE_THEME.background}';
    ctx.fillRect(0, 0, ${stage.width}, ${stage.height});
    ctx.fillStyle = '${STAGE_THEME.foreground}';
    ctx.font = '12px -apple-system, sans-serif';
    ctx.fillText('Oscillation', 20, 30);
  },
  update(params) {
    this.params = { ...this.params, ...params };
    this.draw();
  },
  destroy() {
    if (this.animId) cancelAnimationFrame(this.animId);
  }
};
</simulation_code>`;
}
