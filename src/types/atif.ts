/**
 * SimIt ATIF (Agent Trajectory Interchange Format) Domain Types
 * Defines the contract for recording, exporting, and benchmarking agent runs.
 */

import { HarvestedContext } from './harvester';
import { ParameterState } from './simulation';
import { ProviderType } from './models';
import { QualityFlag, ReviewMode } from './agent';
import { VerificationDiagnostic } from './verification';

export type AtifStage =
  | 'CONTEXT_HARVEST'
  | 'ARCHETYPE_TRIAGE'
  | 'PROMPT_COMPOSE'
  | 'MODEL_INFERENCE'
  | 'PREFLIGHT_VERIFY'
  | 'AUTO_REPAIR'
  | 'RENDER'
  | 'RUNTIME_INTERACTION'
  | 'INTERACTIVE_REPAIR'
  | 'ARCHITECT_PLAN'
  | 'CODER_SYNTHESIS'
  | 'SANDBOX_EVALUATION'
  | 'ARCHITECT_REVIEW'
  | 'REVISION_SYNTHESIS';

export interface AtifAgentMetadata {
  name: string;
  version: string;
  environment: {
    platform: string;
    browser: string;
    os: string;
  };
}

export interface AtifModelConfig {
  provider: ProviderType;
  model_name: string;
  is_local: boolean;
  temperature: number;
  base_url: string | null;
  /** True when the active model supports native vision inputs */
  vision_supported?: boolean;
}

export interface AtifStep {
  step_index: number;
  stage: AtifStage;
  timestamp: string;
  duration_ms?: number;
  test_type?: string;
  status?: string;
  input?: Record<string, any>;
  output?: Record<string, any>;
  details?: Record<string, any>;
  initial_params?: ParameterState;
  snapshot_url?: string;
  /** Multi-frame visual snapshots captured across phases (defaults, min, max) */
  captured_frames_count?: number;
  /** Deterministic zero-token verification diagnostics */
  diagnostics?: VerificationDiagnostic[];
  /** Mode used for visual review: 'multimodal' vs 'text-only' */
  review_mode?: ReviewMode;
}

export interface AtifOutcome {
  success: boolean;
  first_pass_success: boolean;
  repairs_needed: number;
  total_duration_ms: number;
  final_code_hash?: string;
  final_code?: string;
  /** Explicit degradation or fallback quality signals */
  quality_flags?: QualityFlag[];
  /** Final verification diagnostic count */
  diagnostics_count?: number;
}

export interface AtifTrajectory {
  $schema: string;
  version: string;
  session_id: string;
  timestamp_start: string;
  timestamp_end: string;
  agent: AtifAgentMetadata;
  model_config: AtifModelConfig;
  harvested_context: HarvestedContext;
  trajectory: AtifStep[];
  outcome: AtifOutcome;
}
