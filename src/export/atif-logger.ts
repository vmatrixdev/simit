/**
 * SimIt ATIF (Agent Trajectory Interchange Format) Logger
 * Conforms to docs/specs/atif_specification.md#2 and src/types/atif.ts
 */

import { AtifOutcome, AtifStage, AtifStep, AtifTrajectory } from '../types/atif';
import { HarvestedContext } from '../types/harvester';
import { ModelProviderConfig, ProviderType } from '../types/models';

export class AtifTrajectoryLogger {
  private trajectory: AtifTrajectory;
  private startTime: number;
  private stepCounter: number = 0;
  private repairsCount: number = 0;

  constructor(
    harvestedContext: HarvestedContext,
    provider: ProviderType = 'chrome-prompt-api',
    modelName: string = 'gemini-nano',
    isLocal: boolean = true,
    temperature: number = 0.2,
    baseUrl: string | null = null
  ) {
    this.startTime = Date.now();
    const sessionId = `simit-traj-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;

    this.trajectory = {
      $schema: 'https://simit.dev/schemas/atif-v1.json',
      version: '1.0.0',
      session_id: sessionId,
      timestamp_start: new Date(this.startTime).toISOString(),
      timestamp_end: new Date(this.startTime).toISOString(),
      agent: {
        name: 'SimIt',
        version: '1.0.0',
        environment: {
          platform: 'chrome-extension-mv3',
          browser: typeof navigator !== 'undefined' ? navigator.userAgent : 'Chrome',
          os: typeof navigator !== 'undefined' ? navigator.platform : 'macOS'
        }
      },
      model_config: {
        provider,
        model_name: modelName,
        is_local: isLocal,
        temperature,
        base_url: baseUrl
      },
      harvested_context: harvestedContext,
      trajectory: [],
      outcome: {
        success: false,
        first_pass_success: false,
        repairs_needed: 0,
        total_duration_ms: 0
      }
    };

    // Log the initial context harvest step
    this.recordStep('CONTEXT_HARVEST', {
      selected_text: harvestedContext.selection.selectedText,
      math_count: harvestedContext.mathSnippets.length
    }, {
      harvest_id: harvestedContext.harvestId
    });
  }

  recordStep(
    stage: AtifStage,
    input?: Record<string, any>,
    output?: Record<string, any>,
    durationMs?: number,
    details?: Record<string, any>,
    status?: string
  ): AtifStep {
    this.stepCounter += 1;
    if (stage === 'AUTO_REPAIR' || stage === 'INTERACTIVE_REPAIR') {
      this.repairsCount += 1;
    }

    const step: AtifStep = {
      step_index: this.stepCounter,
      stage,
      timestamp: new Date().toISOString(),
      duration_ms: durationMs,
      status,
      input,
      output,
      details
    };

    this.trajectory.trajectory.push(step);
    return step;
  }

  complete(success: boolean, finalCode?: string): AtifTrajectory {
    const endTime = Date.now();
    this.trajectory.timestamp_end = new Date(endTime).toISOString();

    const repairs = this.repairsCount;
    const firstPass = success && repairs === 0;

    let finalCodeHash: string | undefined;
    if (finalCode) {
      let hash = 0;
      for (let i = 0; i < finalCode.length; i++) {
        hash = (hash << 5) - hash + finalCode.charCodeAt(i);
        hash |= 0;
      }
      finalCodeHash = `hash:${Math.abs(hash).toString(16)}`;
    }

    this.trajectory.outcome = {
      success,
      first_pass_success: firstPass,
      repairs_needed: repairs,
      total_duration_ms: endTime - this.startTime,
      final_code_hash: finalCodeHash
    };

    return this.trajectory;
  }

  getTrajectory(): AtifTrajectory {
    return this.trajectory;
  }

  toJSON(): string {
    return JSON.stringify(this.trajectory, null, 2);
  }
}
