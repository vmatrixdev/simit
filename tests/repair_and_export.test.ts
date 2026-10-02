/**
 * Repair Loop, ATIF Logger & Standalone Exporter Test Suite
 * Conforms to docs/specs/agent_loop.md#6, docs/specs/atif_specification.md, and docs/specs/sandbox_ipc.md
 */

import { describe, it, expect, vi } from 'vitest';
import { executePreFlightRepairLoop, executeInteractiveRepair } from '../src/runtime/repair';
import { AtifTrajectoryLogger } from '../src/export/atif-logger';
import { generateStandaloneSimulationHtml } from '../src/export/standalone-exporter';
import { IModelProvider } from '../src/types/models';
import { PreFlightTestRequest, PreFlightTestResponse } from '../src/types/ipc';

describe('Repair Loop & ATIF Export Specifications', () => {
  // 1-Shot Self-Repair Loop Verification
  it('pre-flight repair loop passes immediately if first test succeeds (0 repairs)', async () => {
    const mockModel: IModelProvider = {
      type: 'chrome-prompt-api',
      isLocal: true,
      isAvailable: async () => true,
      generateSimulation: vi.fn()
    };

    const mockRunner = vi.fn().mockResolvedValue({
      type: 'PREFLIGHT_TEST_RESPONSE',
      requestId: '1',
      status: 'ok',
      validatedCode: 'valid code',
      parameters: [{ id: 'a', label: 'A', type: 'slider', default: 1, min: 0, max: 2, step: 1 }]
    } as PreFlightTestResponse);

    const result = await executePreFlightRepairLoop('initial code', mockModel, mockRunner);

    expect(result.success).toBe(true);
    expect(result.repairsNeeded).toBe(0);
    expect(mockModel.generateSimulation).not.toHaveBeenCalled();
  });

  it('pre-flight repair loop automatically triggers 1-shot repair if first pass fails and succeeds on 2nd pass', async () => {
    const mockModel: IModelProvider = {
      type: 'chrome-prompt-api',
      isLocal: true,
      isAvailable: async () => true,
      generateSimulation: vi.fn().mockResolvedValue({
        rawCode: 'repaired code',
        provider: 'chrome-prompt-api',
        modelName: 'gemini-nano',
        durationMs: 120
      })
    };

    // First test fails, second test passes
    const mockRunner = vi.fn()
      .mockResolvedValueOnce({
        type: 'PREFLIGHT_TEST_RESPONSE',
        requestId: 'pass1',
        status: 'error',
        errorMessage: 'TypeError: undefined variable',
        errorStack: 'at line 5'
      } as PreFlightTestResponse)
      .mockResolvedValueOnce({
        type: 'PREFLIGHT_TEST_RESPONSE',
        requestId: 'pass2',
        status: 'ok',
        validatedCode: 'repaired code',
        parameters: [{ id: 'k', label: 'K', type: 'toggle', default: true }]
      } as PreFlightTestResponse);

    const result = await executePreFlightRepairLoop('broken code', mockModel, mockRunner);

    expect(result.success).toBe(true);
    expect(result.repairsNeeded).toBe(1);
    expect(result.initialError).toContain('TypeError: undefined variable');
    expect(result.code).toBe('repaired code');
    expect(mockModel.generateSimulation).toHaveBeenCalledTimes(1);
  });

  it('interactive repair executes and verifies repaired code against current parameters', async () => {
    const mockModel: IModelProvider = {
      type: 'chrome-prompt-api',
      isLocal: true,
      isAvailable: async () => true,
      generateSimulation: vi.fn().mockResolvedValue({
        rawCode: 'fixed interactive code',
        provider: 'chrome-prompt-api',
        modelName: 'gemini-nano',
        durationMs: 80
      })
    };

    const mockRunner = vi.fn().mockResolvedValue({
      type: 'PREFLIGHT_TEST_RESPONSE',
      requestId: 'test-1',
      status: 'ok',
      validatedCode: 'fixed interactive code',
      parameters: []
    } as PreFlightTestResponse);

    const result = await executeInteractiveRepair(
      'failing code',
      'Division by zero',
      'at line 15',
      { tau: 0.0 },
      mockModel,
      mockRunner
    );

    expect(result.success).toBe(true);
    expect(result.code).toBe('fixed interactive code');
    expect(mockModel.generateSimulation).toHaveBeenCalled();
  });

  // ATIF Trajectory Logger Verification
  it('ATIF logger conforms to ATIF v1 schema and logs complete trajectory', () => {
    const mockContext = {
      harvestId: 'h-100',
      timestamp: '2026-10-02T19:30:00.000Z',
      selection: {
        selectedText: 'Softmax Attention',
        characterCount: 17,
        sourceUrl: 'https://arxiv.org',
        documentTitle: 'Attention Paper'
      },
      mathSnippets: [],
      domContext: {
        nearestHeading: '3.1 Attention',
        headingLevel: 'H2',
        caption: null,
        paragraphSnippet: 'Attention mechanisms...'
      }
    };

    const logger = new AtifTrajectoryLogger(
      mockContext,
      'chrome-prompt-api',
      'gemini-nano',
      true,
      0.2
    );

    logger.recordStep('PROMPT_COMPOSE', { prompt_len: 120 }, { hash: 'abc' });
    logger.recordStep('MODEL_INFERENCE', { chars: 50 }, { raw_code: 'export default {}' }, 450);
    logger.recordStep('PREFLIGHT_VERIFY', {}, {}, 80, { init_executed: true }, 'PASS');
    logger.recordStep('RENDER', {}, {}, 20);

    const trajectory = logger.complete(true, 'export default {}');

    expect(trajectory.$schema).toBe('https://simit.dev/schemas/atif-v1.json');
    expect(trajectory.version).toBe('1.0.0');
    expect(trajectory.agent.name).toBe('SimIt');
    expect(trajectory.model_config.model_name).toBe('gemini-nano');
    expect(trajectory.trajectory.length).toBe(5); // 1 harvest + 4 recorded
    expect(trajectory.outcome.success).toBe(true);
    expect(trajectory.outcome.first_pass_success).toBe(true);
    expect(trajectory.outcome.repairs_needed).toBe(0);
    expect(trajectory.outcome.final_code_hash).toBeDefined();

    const json = logger.toJSON();
    expect(JSON.parse(json)).toEqual(trajectory);
  });

  // Standalone Exporter Verification
  it('standalone exporter generates valid self-contained HTML document with inlined parameters and runtime', () => {
    const html = generateStandaloneSimulationHtml({
      title: 'Attention Visualization',
      description: 'Interactive attention weights explorer',
      parameters: [
        { id: 'tau', label: 'Temperature', type: 'slider', min: 0.1, max: 5.0, step: 0.1, default: 1.0 },
        { id: 'mode', label: 'Color Mode', type: 'toggle', default: true }
      ],
      initialParams: { tau: 1.5, mode: true },
      code: `export default {
        title: "Attention",
        parameters: [],
        init(container, params) {},
        update(params) {}
      };`
    });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>Attention Visualization - SimIt Interactive Simulation</title>');
    expect(html).toContain('Interactive attention weights explorer');
    expect(html).toContain('window.__simModule =');
    expect(html).toContain('id="sim-root"');
    expect(html).toContain('id="input-tau"');
    expect(html).toContain('id="input-mode"');
  });
});
