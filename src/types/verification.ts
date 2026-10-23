/**
 * SimIt Simulation Verification Harness Domain Contracts
 * Conforms to docs/specs/simulation_verification.md
 *
 * The harness renders a generated SimModule at the REAL side-panel viewport size,
 * soaks it across animation frames, sweeps parameter boundaries, captures raster
 * frames, and emits deterministic diagnostics BEFORE any LLM visual review.
 */

import { ImageAttachment } from './models';
import { ParameterDefinition, ParameterState, SimulationExplanation } from './simulation';

/** Parameter states exercised by the harness, in execution order. */
export type VerificationPhase =
  | 'defaults'
  | 'min'
  | 'max'
  | 'compile'
  | 'evaluate'
  | 'init'
  | 'soak'
  | 'destroy';

export interface VerificationViewport {
  width: number;
  height: number;
}

export interface VerificationOptions {
  /** Real stage size the module will be mounted into (sim-root, after host chrome). */
  viewport?: VerificationViewport;
  /** Wall-clock soak per phase while animation frames are pumped. Default 500ms. */
  soakMs?: number;
  /** Optional frame count alias for soak. */
  soakFrames?: number;
  /** Run min/max boundary phases after defaults. Default true. */
  sweep?: boolean;
  /** Optional alias for sweep. */
  sweepParameters?: boolean;
  /** Capture a raster frame at the end of each phase. Default true. */
  captureFrames?: boolean;
  /** Hard ceiling for the whole verification run. Default 4000ms. */
  timeoutMs?: number;
}

export const DEFAULT_VERIFICATION_OPTIONS: {
  viewport: VerificationViewport;
  soakMs: number;
  sweep: boolean;
  captureFrames: boolean;
  timeoutMs: number;
} = {
  viewport: { width: 380, height: 500 },
  soakMs: 500,
  sweep: true,
  captureFrames: true,
  timeoutMs: 4000
};

/** Longest-side pixel cap for captured frames sent to multimodal reviewers. */
export const MAX_FRAME_DIMENSION_PX = 1024;

export interface SweepStep {
  phase: VerificationPhase;
  params: ParameterState;
}

export interface VerificationFrame {
  phase: VerificationPhase;
  params?: ParameterState;
  /** Always raster (PNG preferred). SVG roots are rasterized before capture. */
  image?: ImageAttachment;
  /** Optional convenience data URL representation (`data:image/png;base64,...`). */
  dataUrl?: string;
  width?: number;
  height?: number;
  /** Number of animation frames delivered to the module before capture. */
  framesPumped?: number;
}

export interface RuntimeErrorRecord {
  phase: VerificationPhase | 'evaluate' | 'init';
  message: string;
  stack?: string;
  lineno?: number;
  colno?: number;
  params?: ParameterState;
}

export type DiagnosticSeverity = 'error' | 'warning';

/**
 * Deterministic, zero-token diagnostic codes.
 * Severity defaults are defined in DIAGNOSTIC_SEVERITY.
 */
export type DiagnosticCode =
  | 'RUNTIME_EXCEPTION'          // Any error thrown during evaluate/init/soak/update
  | 'TIMEOUT'                    // Whole run exceeded timeoutMs (likely infinite loop)
  | 'NO_VISUAL_ROOT'             // No canvas / svg / visible DOM content in #sim-root
  | 'BLANK_RENDER'               // Captured raster is (near-)uniform after soak
  | 'DEFAULT_CANVAS_SIZE'        // A canvas is still 300x150 (backing store never sized)
  | 'CANVAS_SIZE_MISMATCH'       // Primary canvas backing store differs from stage by > 2%
  | 'NON_FINITE_TEXT'            // Visible text contains NaN / Infinity / undefined
  | 'DUPLICATE_CONTROLS'         // Module instantiated its own Tweakpane or <input>/<button> controls
  | 'OUT_OF_BOUNDS'              // A visible element's box extends beyond the stage
  | 'NO_FRAME_PROGRESS'          // Animated module: two captures across soak are pixel-identical while it declares motion (warning only)
  | 'INVALID_EXPLANATION_SCHEMA' // Module explanation object has malformed insight, legend, or tour schema
  | 'CONTRACT_VIOLATION';        // General non-fatal module contract violation warning

export const DIAGNOSTIC_SEVERITY: Record<DiagnosticCode, DiagnosticSeverity> = {
  RUNTIME_EXCEPTION: 'error',
  TIMEOUT: 'error',
  NO_VISUAL_ROOT: 'error',
  BLANK_RENDER: 'error',
  DEFAULT_CANVAS_SIZE: 'error',
  CANVAS_SIZE_MISMATCH: 'warning',
  NON_FINITE_TEXT: 'error',
  DUPLICATE_CONTROLS: 'error',
  OUT_OF_BOUNDS: 'warning',
  NO_FRAME_PROGRESS: 'warning',
  INVALID_EXPLANATION_SCHEMA: 'warning',
  CONTRACT_VIOLATION: 'warning'
};

export interface VerificationDiagnostic {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  phase?: VerificationPhase | 'evaluate' | 'init';
  /** Small machine-readable evidence, e.g. { text: "x = NaN" } or { width: 300, height: 150 }. */
  evidence?: Record<string, any> | any;
}

export interface VerificationReport {
  /** 'fail' iff any diagnostic has severity 'error'. */
  status: 'pass' | 'fail';
  diagnostics: VerificationDiagnostic[];
  runtimeErrors: RuntimeErrorRecord[];
  frames?: VerificationFrame[];
  parameters: ParameterDefinition[];
  explanation?: SimulationExplanation;
  title: string;
  description: string;
  durationMs: number;
}

/** Summary statistics of a raster used by blank-render detection. */
export interface RasterStats {
  pixelCount: number;
  /** Fraction of sampled pixels that differ from the dominant color by > 8/255 on any channel. */
  nonDominantRatio: number;
  /** Mean per-channel luminance variance (0..1 normalized). */
  luminanceVariance: number;
}

/** Thresholds for BLANK_RENDER: blank iff nonDominantRatio < 0.002 OR luminanceVariance < 0.0005. */
export const BLANK_RENDER_THRESHOLDS = {
  minNonDominantRatio: 0.002,
  minLuminanceVariance: 0.0005
} as const;

/** Axis-aligned box in stage coordinates, used for OUT_OF_BOUNDS checks. */
export interface ElementBox {
  descriptor: string; // e.g. "canvas#main", "div.katex"
  left: number;
  top: number;
  width: number;
  height: number;
}
