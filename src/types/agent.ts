/**
 * SimIt Autonomous Multi-Agent Loop Domain Contracts
 * Conforms to docs/specs/agent_loop.md#10
 */

import { ParameterDefinition } from './simulation';
import { HarvestedContext } from './harvester';
import { AtifTrajectory } from './atif';

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
  snapshotUrl?: string;
  executionTimeMs: number;
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
  iterations: number;
  snapshotUrl?: string;
  trajectory: AgentTrajectoryStep[];
  atifTrajectory?: AtifTrajectory;
  error?: string;
}
