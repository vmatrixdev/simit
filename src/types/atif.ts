/**
 * SimIt ATIF (Agent Trajectory Interchange Format) Domain Types
 * Defines the contract for recording, exporting, and benchmarking agent runs.
 */

import { HarvestedContext } from './harvester';
import { ParameterState } from './simulation';
import { ProviderType } from './models';

export type AtifStage =
  | 'CONTEXT_HARVEST'
  | 'ARCHETYPE_TRIAGE'
  | 'PROMPT_COMPOSE'
  | 'MODEL_INFERENCE'
  | 'PREFLIGHT_VERIFY'
  | 'AUTO_REPAIR'
  | 'RENDER'
  | 'RUNTIME_INTERACTION'
  | 'INTERACTIVE_REPAIR';

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
}

export interface AtifOutcome {
  success: boolean;
  first_pass_success: boolean;
  repairs_needed: number;
  total_duration_ms: number;
  final_code_hash?: string;
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
