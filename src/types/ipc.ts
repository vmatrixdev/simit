/**
 * SimIt Inter-Process Communication (IPC) Protocol Types
 * Defines the message envelope and payload contracts between:
 * 1. Host Tab (Content Script) <-> Background Service Worker
 * 2. Background Service Worker <-> Offscreen Pre-Flight Harness
 * 3. Background Service Worker <-> Side Panel Frame
 * 4. Side Panel Frame <-> Sandboxed Iframe (sandbox.html)
 */

import { HarvestedContext } from './harvester';
import { ParameterDefinition, ParameterState, SimulationExplanation } from './simulation';
import { VerificationOptions, VerificationReport } from './verification';

// ==========================================
// 1. Content Script <-> Service Worker
// ==========================================

export interface HarvestContextRequest {
  type: 'HARVEST_CONTEXT_REQUEST';
  tabId: number;
}

export interface HarvestContextResponse {
  type: 'HARVEST_CONTEXT_RESPONSE';
  payload: HarvestedContext;
}

// ==========================================
// 2. Service Worker <-> Offscreen Document
// ==========================================

export interface PreFlightTestRequest {
  type: 'PREFLIGHT_TEST_REQUEST';
  requestId: string;
  rawCode: string;
  timeoutMs: number;
  captureSnapshot?: boolean;
  /** Verification harness options (docs/specs/simulation_verification.md). When present, the full soak + sweep runs. */
  verification?: VerificationOptions;
}

export interface PreFlightTestSuccessResponse {
  type: 'PREFLIGHT_TEST_RESPONSE';
  requestId: string;
  status: 'ok';
  validatedCode: string;
  parameters: ParameterDefinition[];
  explanation?: SimulationExplanation;
  snapshotUrl?: string;
  /** Full verification report. status 'ok' here means report.status === 'pass'. */
  report?: VerificationReport;
}

export interface PreFlightTestErrorResponse {
  type: 'PREFLIGHT_TEST_RESPONSE';
  requestId: string;
  status: 'error';
  errorMessage: string;
  errorStack?: string;
  snapshotUrl?: string;
  /** Full verification report including error diagnostics and any frames captured before failure. */
  report?: VerificationReport;
}

export type PreFlightTestResponse = PreFlightTestSuccessResponse | PreFlightTestErrorResponse;

// ==========================================
// 3. Side Panel Host <-> Sandboxed Iframe
// ==========================================

export interface SandboxInitSimulationMessage {
  type: 'SANDBOX_INIT_SIMULATION';
  code: string;
  initialParams?: ParameterState;
  explanation?: SimulationExplanation;
  captureSnapshot?: boolean;
}

export interface SandboxUpdateParametersMessage {
  type: 'SANDBOX_UPDATE_PARAMETERS';
  params: ParameterState;
}

export interface SandboxDestroyMessage {
  type: 'SANDBOX_DESTROY';
}

/** Offscreen harness -> sandbox: run the full verification protocol (docs/specs/simulation_verification.md#2). */
export interface SandboxVerifySimulationMessage {
  type: 'SANDBOX_VERIFY_SIMULATION';
  requestId: string;
  code: string;
  options: VerificationOptions;
}

export type HostToSandboxMessage =
  | SandboxInitSimulationMessage
  | SandboxUpdateParametersMessage
  | SandboxDestroyMessage
  | SandboxVerifySimulationMessage;

export interface SandboxSimulationReadyMessage {
  type: 'SANDBOX_SIMULATION_READY';
  title: string;
  description: string;
  parameters: ParameterDefinition[];
  explanation?: SimulationExplanation;
  snapshotUrl?: string;
}

export interface SandboxRuntimeErrorMessage {
  type: 'SANDBOX_RUNTIME_ERROR';
  message: string;
  stack?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  currentParams: ParameterState;
}

export interface SandboxParametersChangedMessage {
  type: 'SANDBOX_PARAMETERS_CHANGED';
  params: ParameterState;
}

/** Sandbox -> offscreen harness: emitted exactly once per SANDBOX_VERIFY_SIMULATION, after all phases or on timeout. */
export interface SandboxVerificationReportMessage {
  type: 'SANDBOX_VERIFICATION_REPORT';
  requestId: string;
  report: VerificationReport;
}

export type SandboxToHostMessage =
  | SandboxSimulationReadyMessage
  | SandboxRuntimeErrorMessage
  | SandboxParametersChangedMessage
  | SandboxVerificationReportMessage;

// ==========================================
// 4. Side Panel Host <-> Service Worker
// ==========================================

export interface SimulationReadyMessage {
  type: 'SIMULATION_READY';
  code: string;
  parameters: ParameterDefinition[];
  explanation?: SimulationExplanation;
  initialParams?: ParameterState;
  atifTrajectory?: any;
  sessionId?: string;
  versionId?: string;
  versionIndex?: number;
  versionLabel?: string;
  evolutionChips?: any[];
  routingDecision?: any;
  qualityFlags?: string[];
  reviewMode?: string;
  diagnostics?: any[];
  isOptimistic?: boolean;
}

export interface InteractiveRepairRequestMessage {
  type: 'REPAIR_INTERACTIVE_SIM';
  code: string;
  errorMessage: string;
  stack?: string;
  currentParams: ParameterState;
  viewport?: { width: number; height: number };
}

export interface InteractiveRepairResponseMessage {
  type: 'REPAIR_INTERACTIVE_SIM_RESPONSE';
  status: 'ok' | 'error';
  repairedCode?: string;
  errorMessage?: string;
}

export interface SidepanelViewportChangedMessage {
  type: 'SIDEPANEL_VIEWPORT_CHANGED';
  viewport: { width: number; height: number };
}

// ==========================================
// 5. Service Worker <-> Offscreen Prompt API
// ==========================================

export interface PromptApiCheckRequest {
  type: 'PROMPT_API_CHECK_REQUEST';
}

export interface PromptApiCheckResponse {
  type: 'PROMPT_API_CHECK_RESPONSE';
  available: boolean;
  status?: string;
}

export interface PromptApiGenerateRequest {
  type: 'PROMPT_API_GENERATE_REQUEST';
  payload: {
    systemPrompt: string;
    userPrompt: string;
    temperature?: number;
  };
}

export interface PromptApiGenerateResponse {
  type: 'PROMPT_API_GENERATE_RESPONSE';
  status: 'ok' | 'error';
  rawCode?: string;
  durationMs?: number;
  errorMessage?: string;
}

// ==========================================
// 6. Conversational Evolution & Escalation (Phase 3)
// ==========================================

export interface EvolutionRequestMessage {
  type: 'EVOLUTION_REQUEST';
  sessionId: string;
  currentCode: string;
  userMessage?: string;
  chipId?: string;
  activeParams: ParameterState;
  viewport?: { width: number; height: number };
}

export interface EvolutionResponseMessage {
  type: 'EVOLUTION_RESPONSE';
  status: 'ok' | 'error';
  intentType: 'parametric_tweak' | 'structural_evolution' | 'reset_state';
  appliedParams?: ParameterState;
  evolvedCode?: string;
  parameters?: ParameterDefinition[];
  suggestedChips?: any[];
  versionId?: string;
  versionIndex?: number;
  versionLabel?: string;
  errorMessage?: string;
}

