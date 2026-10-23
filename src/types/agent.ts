/**
 * SimIt Autonomous Multi-Agent Loop Domain Contracts
 * Conforms to docs/specs/autonomous_agent_architecture.md and docs/specs/agent_loop.md#10
 */

import {
  ParameterDefinition,
  PedagogySpec,
  SimulationExplanation,
  ExplanationLegendItem,
  ExplanationTourStep
} from './simulation';
import { AtifTrajectory } from './atif';
import { ImageAttachment } from './models';
import { RuntimeErrorRecord, VerificationDiagnostic, VerificationFrame, VerificationReport } from './verification';

export type { PedagogySpec, SimulationExplanation, ExplanationLegendItem, ExplanationTourStep };

/**
 * Punchy 3-5 word micro status payload emitted to the UI
 * Strictly 1 line, no prefixes like "Architect:", "Coder:", or "I am"
 */
export interface ReportProgressPayload {
  status: string;
}

/**
 * Visual raster snapshot captured from the sandbox harness
 */
export interface VisualSnapshot {
  snapshotUrl?: string; // data:image/webp;base64,... or SVG data URI
  width?: number;
  height?: number;
  capturedAt: number;
}

/**
 * Epistemic blueprint formulated by the Architect and delegated to the Coder sub-agent
 */
export interface CoderPlanSpec {
  title: string;
  description: string;
  visualPlan: string;
  mathFormulation: string;
  parametersSpec: ParameterDefinition[];
  directInteractionSpec?: string;
  pedagogy?: PedagogySpec;
  explanation?: SimulationExplanation;
}

/**
 * Sandbox execution and evaluation outcome
 */
export interface SandboxEvaluationResult {
  status: 'ok' | 'error';
  errorMessage?: string;
  errorStack?: string;
  logs: string[];
  parameters: ParameterDefinition[];
  explanation?: SimulationExplanation;
  snapshotUrl?: string;
  executionTimeMs: number;
  report?: VerificationReport;
  diagnostics?: VerificationDiagnostic[];
  runtimeErrors?: RuntimeErrorRecord[];
  frames?: ImageAttachment[];
}

/**
 * Architect review critique and approval decision
 */
export interface ReviewFeedback {
  approved: boolean;
  critique?: string;
  direction?: string;
  finalCode?: string;
}

/**
 * How the Architect review was performed.
 * - 'multimodal' / 'vision': captured frames were attached as images.
 * - 'text-only' / 'code_only': provider lacks vision or no frames were captured; visual criteria are NOT asserted.
 */
export type ReviewMode = 'multimodal' | 'text-only' | 'vision' | 'code_only';

/**
 * Everything the Coder needs to PATCH its previous module rather than regenerate from scratch.
 * Conforms to docs/specs/autonomous_agent_architecture.md#4-revision-protocol
 */
export interface RevisionContext {
  /** 1-based iteration that produced previousCode. */
  iteration?: number;
  previousCode?: string;
  /** Deterministic harness findings (errors and warnings). */
  diagnostics?: VerificationDiagnostic[];
  /** Runtime exceptions with stack, line/col and the parameter state that triggered them. */
  runtimeErrors?: RuntimeErrorRecord[];
  /** Present when the Architect review or harness rejected a build. */
  review?: { critique: string; direction: string };
  critique?: string;
  direction?: string;
  errorStack?: string;
  /** Frames from the rejected build (attached as images when the provider supports vision). */
  frames?: Array<VerificationFrame | ImageAttachment>;
}

/**
 * Loud, user-visible signals that the result is degraded. Never silently swallowed.
 */
export type QualityFlag =
  | 'FALLBACK_PLAN'              // Architect failed; fallback plan used
  | 'REVIEW_UNAVAILABLE'         // Review call threw
  | 'REVIEW_UNPARSEABLE'         // Review output not parseable as ReviewFeedback
  | 'UNVERIFIED_REVIEW'          // Alias for unparseable/unavailable review
  | 'TEXT_ONLY_REVIEW'           // Review performed without images
  | 'MAX_ITERATIONS_UNAPPROVED'  // Returned best passing build without Architect approval
  | 'VERIFICATION_WARNINGS';     // Final build has warning-severity diagnostics

export interface AgentRoleBudget {
  maxTokens: number;
  temperature: number;
  enableThinking?: boolean;
  thinkingBudgetTokens?: number;
}

/** Per-role generation budgets passed on every provider call. */
export const AGENT_TOKEN_BUDGETS: Record<'architect' | 'coder' | 'review', AgentRoleBudget> = {
  architect: { maxTokens: 8192, temperature: 0.3, enableThinking: true, thinkingBudgetTokens: 4096 },
  coder: { maxTokens: 16384, temperature: 0.2 },
  review: { maxTokens: 1024, temperature: 0.1 }
};

/**
 * Trajectory step recorded during multi-agent iteration
 */
export interface AgentTrajectoryStep {
  stepIndex: number;
  role: 'architect' | 'coder' | 'sandbox';
  action: 'plan' | 'synthesize' | 'test' | 'review' | 'approve';
  statusSummary: string; // 3-5 words
  details?: any;
  snapshotUrl?: string;
  timestamp: number;
}

/**
 * Final result from the autonomous simulation orchestrator
 */
export interface AutonomousLoopResult {
  success: boolean;
  code: string;
  title: string;
  description: string;
  parameters: ParameterDefinition[];
  explanation?: SimulationExplanation;
  pedagogy?: PedagogySpec;
  iterations: number;
  snapshotUrl?: string;
  trajectory: AgentTrajectoryStep[];
  atifTrajectory?: AtifTrajectory;
  error?: string;
  /** MUST always be present (empty array when clean). Optional in type only for legacy callers. */
  qualityFlags?: QualityFlag[];
  /** Review mode of the final accepted iteration. */
  reviewMode?: ReviewMode;
  /** Diagnostics of the final returned build. */
  diagnostics?: VerificationDiagnostic[];
}
