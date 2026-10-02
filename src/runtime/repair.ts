/**
 * SimIt 1-Shot Self-Repair Loop & Verification Orchestrator
 * Conforms to docs/specs/agent_loop.md#6 and docs/specs/sandbox_ipc.md
 */

import { IModelProvider } from '../types/models';
import { PreFlightTestRequest, PreFlightTestResponse } from '../types/ipc';
import { ParameterDefinition, ParameterState } from '../types/simulation';
import { runPreFlightSmokeTest } from './preflight';
import { buildPreFlightRepairPrompt, buildInteractiveRepairPrompt } from '../providers/prompt-builder';
import { sanitizeCodeFences } from './preflight';

export interface RepairCycleResult {
  success: boolean;
  code: string;
  parameters: ParameterDefinition[];
  repairsNeeded: number;
  initialError?: string;
  finalError?: string;
}

/**
 * Executes the 1-shot pre-flight generation & verification loop
 */
export async function executePreFlightRepairLoop(
  rawGeneratedCode: string,
  modelProvider: IModelProvider,
  testRunner: (req: PreFlightTestRequest) => Promise<PreFlightTestResponse> = runPreFlightSmokeTest
): Promise<RepairCycleResult> {
  let currentCode = sanitizeCodeFences(rawGeneratedCode);
  let repairsNeeded = 0;
  let initialError: string | undefined;

  // 1. First-pass smoke test
  const firstTest = await testRunner({
    type: 'PREFLIGHT_TEST_REQUEST',
    requestId: `preflight-${Date.now()}-pass1`,
    rawCode: currentCode,
    timeoutMs: 100
  });

  if (firstTest.status === 'ok') {
    return {
      success: true,
      code: firstTest.validatedCode,
      parameters: firstTest.parameters,
      repairsNeeded: 0
    };
  }

  // 2. Pre-flight error detected: trigger 1-shot automated self-repair
  initialError = firstTest.errorMessage;
  repairsNeeded = 1;

  try {
    const repairPromptPayload = buildPreFlightRepairPrompt(
      currentCode,
      firstTest.errorMessage,
      firstTest.errorStack
    );

    const modelResponse = await modelProvider.generateSimulation(repairPromptPayload);
    currentCode = sanitizeCodeFences(modelResponse.rawCode);

    // 3. Re-verify repaired code in harness
    const secondTest = await testRunner({
      type: 'PREFLIGHT_TEST_REQUEST',
      requestId: `preflight-${Date.now()}-pass2`,
      rawCode: currentCode,
      timeoutMs: 100
    });

    if (secondTest.status === 'ok') {
      return {
        success: true,
        code: secondTest.validatedCode,
        parameters: secondTest.parameters,
        repairsNeeded: 1,
        initialError
      };
    } else {
      return {
        success: false,
        code: currentCode,
        parameters: [],
        repairsNeeded: 1,
        initialError,
        finalError: secondTest.errorMessage
      };
    }
  } catch (repairErr: any) {
    return {
      success: false,
      code: currentCode,
      parameters: [],
      repairsNeeded: 1,
      initialError,
      finalError: repairErr.message || String(repairErr)
    };
  }
}

/**
 * Executes interactive repair when triggered by user clicking the 🛠️ Repair Icon
 */
export async function executeInteractiveRepair(
  failedCode: string,
  errorMessage: string,
  errorStack: string | undefined,
  currentParams: ParameterState,
  modelProvider: IModelProvider,
  testRunner: (req: PreFlightTestRequest) => Promise<PreFlightTestResponse> = runPreFlightSmokeTest
): Promise<RepairCycleResult> {
  const repairPromptPayload = buildInteractiveRepairPrompt(
    failedCode,
    errorMessage,
    currentParams,
    errorStack
  );

  const modelResponse = await modelProvider.generateSimulation(repairPromptPayload);
  const repairedCode = sanitizeCodeFences(modelResponse.rawCode);

  const verification = await testRunner({
    type: 'PREFLIGHT_TEST_REQUEST',
    requestId: `interactive-repair-${Date.now()}`,
    rawCode: repairedCode,
    timeoutMs: 100
  });

  if (verification.status === 'ok') {
    return {
      success: true,
      code: verification.validatedCode,
      parameters: verification.parameters,
      repairsNeeded: 1
    };
  } else {
    return {
      success: false,
      code: repairedCode,
      parameters: [],
      repairsNeeded: 1,
      initialError: errorMessage,
      finalError: verification.errorMessage
    };
  }
}
