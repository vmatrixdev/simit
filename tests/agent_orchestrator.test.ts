import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateMicroStatus,
  buildArchitectSystemPrompt,
  buildArchitectUserPrompt,
  buildCoderSystemPrompt,
  buildCoderUserPrompt,
  buildArchitectReviewPrompt,
  executeAutonomousSimulationLoop,
  DELEGATE_TO_CODER_TOOL,
  extractBalancedJsonObject,
  normalizeCoderPlan,
  extractCoderPlanFromResponse
} from '../src/runtime/agent-orchestrator';
import { HarvestedContext } from '../src/types/harvester';
import { IModelProvider } from '../src/types/models';
import { PreFlightTestRequest, PreFlightTestResponse } from '../src/types/ipc';

describe('Autonomous Multi-Agent Loop Specification (docs/specs/autonomous_agent_architecture.md)', () => {
  const mockContext: HarvestedContext = {
    harvestId: 'harvest-test-123',
    timestamp: new Date().toISOString(),
    selection: {
      selectedText: 'The damped harmonic oscillator describes a mass on a spring with viscous damping m x\'\' + c x\' + k x = 0.',
      characterCount: 96,
      sourceUrl: 'https://example.com/physics',
      documentTitle: 'Damped Harmonic Oscillator'
    },
    mathSnippets: [
      { latex: 'm \\ddot{x} + c \\dot{x} + k x = 0', raw: 'm \\ddot{x} + c \\dot{x} + k x = 0', type: 'latex-display' }
    ],
    domContext: {
      nearestHeading: 'Classical Mechanics',
      headingLevel: 'h2',
      caption: null,
      paragraphSnippet: 'Viscous damping leads to underdamped, critically damped, and overdamped regimes.'
    },
    viewport: {
      width: 400,
      height: 500
    }
  };

  describe('A1 & A2: Micro-Progress Format Guardrails', () => {
    it('strips "Architect:" and "Coder:" prefixes cleanly', () => {
      expect(validateMicroStatus('Architect: Formulating visual landscape')).toBe('Formulating visual landscape');
      expect(validateMicroStatus('Coder: Synthesizing simulation code')).toBe('Synthesizing simulation code');
      expect(validateMicroStatus('Sub-agent: Reviewing visual render')).toBe('Reviewing visual render');
      expect(validateMicroStatus('I am testing boundary parameters')).toBe('Testing boundary parameters');
    });

    it('enforces strictly max 5 words', () => {
      const longStatus = 'Testing boundary parameters for extreme friction and high velocity damping';
      const result = validateMicroStatus(longStatus);
      expect(result.split(' ').length).toBeLessThanOrEqual(5);
      expect(result).toBe('Testing boundary parameters for extreme');
    });

    it('collapses multi-line status into single punchy line', () => {
      const multiline = 'Formulating visual landscape\nSecond line explaining details';
      expect(validateMicroStatus(multiline)).toBe('Formulating visual landscape');
    });

    it('strips markdown syntax and quotes', () => {
      expect(validateMicroStatus('"Reviewing visual render"')).toBe('Reviewing visual render');
      expect(validateMicroStatus('**Testing boundary parameters**')).toBe('Testing boundary parameters');
      expect(validateMicroStatus('*Synthesizing particle physics*')).toBe('Synthesizing particle physics');
    });
  });

  describe('A3: Sandbox Visual Snapshot Capture Contract', () => {
    it('passes captureSnapshot: true in PreFlightTestRequest', async () => {
      let capturedRequest: PreFlightTestRequest | undefined;

      const mockRunner = async (req: PreFlightTestRequest): Promise<PreFlightTestResponse> => {
        capturedRequest = req;
        return {
          type: 'PREFLIGHT_TEST_RESPONSE',
          requestId: req.requestId,
          status: 'ok',
          validatedCode: req.rawCode,
          parameters: [{ id: 'zeta', label: 'Damping', type: 'slider', min: 0, max: 2, step: 0.1, default: 0.5 }],
          snapshotUrl: 'data:image/webp;base64,mockValidRasterDataUri'
        };
      };

      const mockProvider: IModelProvider = {
        type: 'anthropic',
        isLocal: false,
        isAvailable: async () => true,
        generateSimulation: vi.fn()
          .mockResolvedValueOnce({
            rawCode: JSON.stringify({
              title: 'Harmonic Oscillator',
              description: 'Mass on a spring with damping',
              visualPlan: 'Canvas 2D bouncing mass with live scrolling trace',
              mathFormulation: 'm x\'\' + c x\' + k x = 0',
              parametersSpec: [{ id: 'zeta', label: 'Damping', type: 'slider', min: 0, max: 2, default: 0.5 }],
              directInteractionSpec: 'Drag mass to set initial position'
            })
          })
          .mockResolvedValueOnce({
            rawCode: `<simulation_code>
              export default {
                title: "Harmonic Oscillator",
                description: "Mass on a spring with damping",
                parameters: [{ id: "zeta", label: "Damping", type: "slider", min: 0, max: 2, default: 0.5 }],
                init(c, p) {},
                update(p) {}
              };
            </simulation_code>`
          })
          .mockResolvedValueOnce({
            rawCode: JSON.stringify({
              approved: true,
              critique: 'Clean layout, good contrast'
            })
          })
      };

      const result = await executeAutonomousSimulationLoop({
        context: mockContext,
        provider: mockProvider,
        testRunner: mockRunner,
        maxIterations: 2
      });

      expect(capturedRequest?.captureSnapshot).toBe(true);
      expect(result.snapshotUrl).toBe('data:image/webp;base64,mockValidRasterDataUri');
    });
  });

  describe('A4 & A5: Architect Multimodal Review & Revision Loop', () => {
    it('triggers revision when Architect finds visual defect, then approves on second turn', async () => {
      const progressList: string[] = [];

      const mockRunner = async (req: PreFlightTestRequest): Promise<PreFlightTestResponse> => {
        return {
          type: 'PREFLIGHT_TEST_RESPONSE',
          requestId: req.requestId,
          status: 'ok',
          validatedCode: req.rawCode,
          parameters: [{ id: 'zeta', label: 'Damping', type: 'slider', min: 0, max: 2, step: 0.1, default: 0.5 }],
          snapshotUrl: 'data:image/webp;base64,snapshot_v1'
        };
      };

      const mockProvider: IModelProvider = {
        type: 'google-gemini',
        isLocal: false,
        isAvailable: async () => true,
        generateSimulation: vi.fn()
          // Turn 1: Architect planning
          .mockResolvedValueOnce({
            rawCode: JSON.stringify({
              title: 'Oscillator Model',
              description: 'Interactive harmonic motion',
              visualPlan: 'Spring and mass on canvas',
              mathFormulation: 'x(t) = exp(-zeta t)',
              parametersSpec: [{ id: 'zeta', label: 'Damping', type: 'slider', default: 0.5 }]
            })
          })
          // Turn 1: Coder implementation
          .mockResolvedValueOnce({
            rawCode: `<simulation_code>
              export default {
                title: "Oscillator v1",
                description: "Test v1",
                parameters: [{ id: "zeta", label: "Damping", type: "slider", default: 0.5 }],
                init(c, p) {},
                update(p) {}
              };
            </simulation_code>`
          })
          // Turn 1: Architect Review -> REJECTS with specific direction
          .mockResolvedValueOnce({
            rawCode: JSON.stringify({
              approved: false,
              critique: 'The mass is clipping on the top edge at initial displacement',
              direction: 'Offset the anchor down by 50px and increase spring thickness'
            })
          })
          // Turn 2: Coder revision incorporating feedback
          .mockResolvedValueOnce({
            rawCode: `<simulation_code>
              export default {
                title: "Oscillator v2 (Refined)",
                description: "Test v2",
                parameters: [{ id: "zeta", label: "Damping", type: "slider", default: 0.5 }],
                init(c, p) {},
                update(p) {}
              };
            </simulation_code>`
          })
          // Turn 2: Architect Review -> APPROVES
          .mockResolvedValueOnce({
            rawCode: JSON.stringify({
              approved: true,
              critique: 'Offset fixed, high contrast labels, mechanism verified.'
            })
          })
      };

      const result = await executeAutonomousSimulationLoop({
        context: mockContext,
        provider: mockProvider,
        testRunner: mockRunner,
        onProgress: (status) => progressList.push(status),
        maxIterations: 3
      });

      expect(result.success).toBe(true);
      expect(result.iterations).toBe(2);
      expect(result.code).toContain('Oscillator v2 (Refined)');

      // Verify micro-status sequence
      expect(progressList).toContain('Formulating visual landscape');
      expect(progressList).toContain('Synthesizing simulation code');
      expect(progressList).toContain('Testing boundary parameters');
      expect(progressList).toContain('Reviewing visual render');
      expect(progressList).toContain('Refining simulation code');
      expect(progressList).toContain('Ready to explore');

      // Verify zero role prefixes in all progress events
      for (const p of progressList) {
        expect(p).not.toMatch(/^(architect|coder):/i);
      }

      // Verify ATIF trajectory logging for the multi-agent loop
      expect(result.atifTrajectory).toBeDefined();
      const stages = result.atifTrajectory?.trajectory.map((s) => s.stage);
      expect(stages).toContain('ARCHITECT_PLAN');
      expect(stages).toContain('CODER_SYNTHESIS');
      expect(stages).toContain('SANDBOX_EVALUATION');
      expect(stages).toContain('ARCHITECT_REVIEW');
      expect(stages).toContain('REVISION_SYNTHESIS');
      expect(stages).toContain('RENDER');

      // Verify revision feedback was captured in ATIF step
      const reviewStep = result.atifTrajectory?.trajectory.find((s) => s.stage === 'ARCHITECT_REVIEW');
      expect(reviewStep?.output?.approved).toBe(false);
      expect(reviewStep?.output?.critique).toContain('mass is clipping');
      expect(reviewStep?.output?.direction).toContain('Offset the anchor down');

      // Verify outcome counters
      expect(result.atifTrajectory?.outcome.repairs_needed).toBe(1);
      expect(result.atifTrajectory?.outcome.first_pass_success).toBe(false);
      expect(result.atifTrajectory?.outcome.success).toBe(true);
    });
  });

  describe('A6: Autonomous Loop Convergence & Error Recovery', () => {
    it('terminates cleanly at maxIterations without infinite looping', async () => {
      const mockRunner = async (req: PreFlightTestRequest): Promise<PreFlightTestResponse> => {
        return {
          type: 'PREFLIGHT_TEST_RESPONSE',
          requestId: req.requestId,
          status: 'ok',
          validatedCode: req.rawCode,
          parameters: [{ id: 'k', label: 'Spring Constant', type: 'slider', min: 0.1, max: 10, step: 0.1, default: 1 }],
          snapshotUrl: 'data:image/webp;base64,iterSnapshot'
        };
      };

      const mockProvider: IModelProvider = {
        type: 'openai-compatible',
        isLocal: false,
        isAvailable: async () => true,
        generateSimulation: vi.fn()
          // Plan
          .mockResolvedValueOnce({
            rawCode: JSON.stringify({
              title: 'Spring System',
              description: 'Spring dynamics',
              visualPlan: 'Canvas visualization',
              mathFormulation: 'F = -k x',
              parametersSpec: [{ id: 'k', label: 'Spring Constant', type: 'slider', default: 1 }]
            })
          })
          // Turn 1 Code
          .mockResolvedValueOnce({ rawCode: '<simulation_code>export default { init(){}, update(){} };</simulation_code>' })
          // Turn 1 Review -> Reject
          .mockResolvedValueOnce({ rawCode: JSON.stringify({ approved: false, critique: 'Critique 1', direction: 'Fix 1' }) })
          // Turn 2 Code
          .mockResolvedValueOnce({ rawCode: '<simulation_code>export default { init(){}, update(){} };</simulation_code>' })
          // Turn 2 Review -> Reject
          .mockResolvedValueOnce({ rawCode: JSON.stringify({ approved: false, critique: 'Critique 2', direction: 'Fix 2' }) })
      };

      const result = await executeAutonomousSimulationLoop({
        context: mockContext,
        provider: mockProvider,
        testRunner: mockRunner,
        maxIterations: 2 // Max 2 turns
      });

      // Should converge without hanging
      expect(result.iterations).toBe(2);
      expect(result.success).toBe(true); // Returns latest functional code
      expect(result.trajectory.length).toBeGreaterThan(0);
    });

    it('handles runtime exceptions in sandbox by feeding error back to coder', async () => {
      let callCount = 0;
      const mockRunner = async (req: PreFlightTestRequest): Promise<PreFlightTestResponse> => {
        callCount++;
        if (callCount === 1) {
          return {
            type: 'PREFLIGHT_TEST_RESPONSE',
            requestId: req.requestId,
            status: 'error',
            errorMessage: 'TypeError: Cannot read properties of undefined (reading "x")',
            errorStack: 'at init (eval:12:15)'
          };
        }
        return {
          type: 'PREFLIGHT_TEST_RESPONSE',
          requestId: req.requestId,
          status: 'ok',
          validatedCode: req.rawCode,
          parameters: [{ id: 'x', label: 'State', type: 'slider', min: -5, max: 5, step: 0.1, default: 0 }]
        };
      };

      const mockProvider: IModelProvider = {
        type: 'anthropic',
        isLocal: false,
        isAvailable: async () => true,
        generateSimulation: vi.fn()
          // Plan
          .mockResolvedValueOnce({
            rawCode: JSON.stringify({
              title: 'Defensive State Model',
              description: 'Robust error recovery',
              visualPlan: 'Canvas state model',
              mathFormulation: 'x = f(t)',
              parametersSpec: [{ id: 'x', label: 'State', type: 'slider', default: 0 }]
            })
          })
          // Buggy Code v1
          .mockResolvedValueOnce({ rawCode: '<simulation_code>export default { init(){ this.state.x = 1; }, update(){} };</simulation_code>' })
          // Repaired Code v2
          .mockResolvedValueOnce({ rawCode: '<simulation_code>export default { init(){ this.state = { x: 1 }; }, update(){} };</simulation_code>' })
          // Review -> Approve
          .mockResolvedValueOnce({ rawCode: JSON.stringify({ approved: true }) })
      };

      const result = await executeAutonomousSimulationLoop({
        context: mockContext,
        provider: mockProvider,
        testRunner: mockRunner,
        maxIterations: 2
      });

      expect(callCount).toBe(2);
      expect(result.success).toBe(true);
    });
  });

  describe('A7: Architect Unconstrained Deliberation & delegate_to_coder Tool Call', () => {
    it('defines standard tool specification with required parameters', () => {
      expect(DELEGATE_TO_CODER_TOOL.name).toBe('delegate_to_coder');
      expect(DELEGATE_TO_CODER_TOOL.parameters.type).toBe('object');
      expect(DELEGATE_TO_CODER_TOOL.parameters.required).toEqual([
        'title',
        'description',
        'visualPlan',
        'mathFormulation',
        'parametersSpec'
      ]);
    });

    it('extracts plan when Architect writes extensive freeform thoughts and math with braces before calling delegate_to_coder', () => {
      const architectOutput = `
Here is my deep deliberation on this concept:
1. Physical analysis: The oscillator is governed by m \\ddot{x} + c \\dot{x} + k x = 0.
Notice that the discriminant is { \\Delta = c^2 - 4mk }. When \\Delta < 0, we have complex conjugate poles.
2. Mental model: The best visualization is a two-column layout. Left: real-time animated pendulum with anime.js.
Right: dynamic phase portrait plotted with canvas 2D.
3. Parameter strategy: Let the user sweep damping ratio \\zeta from 0 to 2 to see the phase portrait transition from spiral sink to node.

delegate_to_coder({
  "title": "Phase Space Damped Oscillator",
  "description": "Visualizing phase portrait trajectories and exponential decay envelopes",
  "visualPlan": "Left column: physical spring-mass. Right column: (x, v) phase portrait spiral with KaTeX formula readout",
  "mathFormulation": "m x'' + c x' + k x = 0 with characteristic roots lambda = -gamma +- i omega_d",
  "parametersSpec": [
    { "id": "zeta", "label": "Damping Ratio", "type": "slider", "min": 0, "max": 2, "step": 0.05, "default": 0.2, "unit": "zeta" }
  ],
  "directInteractionSpec": "Pointer drag on mass sets initial displacement"
})
`;
      const plan = extractCoderPlanFromResponse(architectOutput);
      expect(plan.title).toBe('Phase Space Damped Oscillator');
      expect(plan.parametersSpec.length).toBe(1);
      expect(plan.parametersSpec[0].id).toBe('zeta');
      expect(plan.directInteractionSpec).toContain('Pointer drag');
    });

    it('extracts plan from standard tool call JSON envelope { name: "delegate_to_coder", arguments: { ... } }', () => {
      const toolCallJson = `
After careful consideration, I formulate the blueprint as follows:
\`\`\`json
{
  "name": "delegate_to_coder",
  "arguments": {
    "title": "Quantum Wavepacket Dispersion",
    "description": "Gaussian wavepacket spreading over time",
    "visualPlan": "1D wave envelope with real and imaginary phase color shading",
    "mathFormulation": "psi(x, t) = (2pi sigma^2)^(-1/4) exp(-x^2 / 4 sigma^2)",
    "parametersSpec": [
      { "id": "sigma", "label": "Initial Width", "type": "slider", "min": 0.5, "max": 5.0, "step": 0.1, "default": 1.0 }
    ]
  }
}
\`\`\`
`;
      const plan = extractCoderPlanFromResponse(toolCallJson);
      expect(plan.title).toBe('Quantum Wavepacket Dispersion');
      expect(plan.visualPlan).toContain('1D wave envelope');
      expect(plan.parametersSpec[0].id).toBe('sigma');
    });

    it('executes full autonomous loop successfully with unconstrained thinking followed by delegate_to_coder', async () => {
      const mockRunner = async (req: PreFlightTestRequest): Promise<PreFlightTestResponse> => {
        return {
          type: 'PREFLIGHT_TEST_RESPONSE',
          requestId: req.requestId,
          status: 'ok',
          validatedCode: req.rawCode,
          parameters: [{ id: 'temperature', label: 'Temperature', type: 'slider', min: 0.1, max: 5.0, step: 0.1, default: 1.0 }],
          snapshotUrl: 'data:image/webp;base64,snapshotFreeform'
        };
      };

      const mockProvider: IModelProvider = {
        type: 'google-gemini',
        isLocal: false,
        isAvailable: async () => true,
        generateSimulation: vi.fn()
          // Architect freeform deliberation + delegate_to_coder
          .mockResolvedValueOnce({
            rawCode: `
I've considered multiple visual options:
Option A: Just a bar chart. (Too boring, lacks epistemic intuition)
Option B: Softmax probability distribution with dynamic temperature slider and interactive logits perturbing.
Let's select Option B.

delegate_to_coder({
  "title": "Softmax Temperature Explorer",
  "description": "Explore probability sharpening vs flattening under temperature scaling",
  "visualPlan": "Interactive bar charts with live KaTeX formula and exponent curve",
  "mathFormulation": "P(i) = exp(z_i / T) / sum(exp(z_j / T))",
  "parametersSpec": [
    { "id": "temperature", "label": "Temperature (T)", "type": "slider", "min": 0.1, "max": 5.0, "step": 0.1, "default": 1.0 }
  ],
  "directInteractionSpec": "Drag bar tops to perturb input logits"
})
`
          })
          // Coder code
          .mockResolvedValueOnce({
            rawCode: `<simulation_code>
              export default {
                title: "Softmax Temperature Explorer",
                description: "Explore probability sharpening",
                parameters: [{ id: "temperature", label: "Temperature (T)", type: "slider", min: 0.1, max: 5.0, default: 1.0 }],
                init(c, p) {},
                update(p) {}
              };
            </simulation_code>`
          })
          // Architect review
          .mockResolvedValueOnce({
            rawCode: JSON.stringify({ approved: true, critique: 'Excellent layout and contrast' })
          })
      };

      const result = await executeAutonomousSimulationLoop({
        context: mockContext,
        provider: mockProvider,
        testRunner: mockRunner
      });

      expect(result.success).toBe(true);
      expect(result.title).toBe('Softmax Temperature Explorer');
      expect(result.iterations).toBe(1);
      expect(result.snapshotUrl).toBe('data:image/webp;base64,snapshotFreeform');
    });
  });

  describe('Dynamic Viewport Space Injection', () => {
    it('propagates custom options.viewport to the Architect and Coder prompts instead of fallback 380x450', async () => {
      const capturedPrompts: { systemPrompt?: string; userPrompt?: string }[] = [];

      const mockRunner = async (req: PreFlightTestRequest): Promise<PreFlightTestResponse> => {
        return {
          type: 'PREFLIGHT_TEST_RESPONSE',
          requestId: req.requestId,
          status: 'ok',
          validatedCode: req.rawCode,
          parameters: [{ id: 'k', label: 'Rate', type: 'slider', min: 0, max: 10, default: 2 }]
        };
      };

      const mockProvider: IModelProvider = {
        type: 'google-gemini',
        isLocal: false,
        isAvailable: async () => true,
        generateSimulation: vi.fn().mockImplementation(async (payload) => {
          capturedPrompts.push(payload);
          if (capturedPrompts.length === 1) {
            // Architect
            return {
              rawCode: `delegate_to_coder({
                "title": "Expanded Stage Model",
                "description": "Adaptive wide-screen simulation",
                "visualPlan": "Wide responsive canvas",
                "mathFormulation": "dx/dt = -k x",
                "parametersSpec": [{ "id": "k", "label": "Rate", "type": "slider", "min": 0, "max": 10, "default": 2 }]
              })`
            };
          } else if (capturedPrompts.length === 2) {
            // Coder
            return {
              rawCode: `<simulation_code>
                export default {
                  title: "Expanded Stage Model",
                  description: "Adaptive wide-screen simulation",
                  parameters: [{ id: "k", label: "Rate", type: "slider", min: 0, max: 10, default: 2 }],
                  init(c, p) {},
                  update(p) {}
                };
              </simulation_code>`
            };
          } else {
            // Review
            return { rawCode: JSON.stringify({ approved: true }) };
          }
        })
      };

      const customViewport = { width: 620, height: 840 };
      const contextWithoutViewport = { ...mockContext, viewport: undefined };

      const result = await executeAutonomousSimulationLoop({
        context: contextWithoutViewport,
        viewport: customViewport,
        provider: mockProvider,
        testRunner: mockRunner
      });

      expect(result.success).toBe(true);
      // Architect call must include enableThinking: true and thinkingBudgetTokens: 4096
      expect((capturedPrompts[0] as any).enableThinking).toBe(true);
      expect((capturedPrompts[0] as any).thinkingBudgetTokens).toBe(4096);
      expect((capturedPrompts[0] as any).maxTokens).toBe(8192);
      // Architect prompt should have width = 620px, height = 840px
      expect(capturedPrompts[0].systemPrompt).toContain('Container width: 620px, height: 840px');
      // Coder prompt should have VIEWPORT: width = 620px, height = 840px and SOURCE CONCEPT
      expect(capturedPrompts[1].systemPrompt).toContain('### VIEWPORT: width = 620px, height = 840px.');
      expect(capturedPrompts[1].userPrompt).toContain('### SOURCE CONCEPT:');
      // Context should also have been updated with the resolved viewport
      expect(contextWithoutViewport.viewport).toEqual(customViewport);
    });
  });

  describe('A7: Multimodal Image Wire Attachment in Vision Review', () => {
    it('attaches raster image frames (from frame.image and frame.dataUrl) to images payload when provider supports vision', async () => {
      let capturedReviewPayload: any = null;
      const sampleBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

      const mockRunner = async (req: PreFlightTestRequest): Promise<PreFlightTestResponse> => {
        return {
          type: 'PREFLIGHT_TEST_RESPONSE',
          requestId: req.requestId,
          status: 'ok',
          validatedCode: req.rawCode,
          parameters: [{ id: 'k', label: 'Rate', type: 'slider', min: 0, max: 10, step: 1, default: 1 }],
          snapshotUrl: `data:image/png;base64,${sampleBase64}`,
          report: {
            status: 'pass',
            diagnostics: [],
            runtimeErrors: [],
            parameters: [{ id: 'k', label: 'Rate', type: 'slider', min: 0, max: 10, step: 1, default: 1 }],
            title: 'Test Sim',
            description: 'Test description',
            durationMs: 120,
            frames: [
              {
                phase: 'defaults',
                width: 380,
                height: 456,
                image: {
                  mimeType: 'image/png',
                  base64Data: sampleBase64,
                  label: 'frame:defaults'
                }
              },
              {
                phase: 'max',
                width: 380,
                height: 456,
                dataUrl: `data:image/png;base64,${sampleBase64}`
              } as any
            ]
          }
        };
      };

      const mockProvider: IModelProvider = {
        type: 'google-gemini',
        isLocal: false,
        isAvailable: async () => true,
        supportsVision: () => true,
        generateSimulation: vi.fn().mockImplementation(async (payload) => {
          if (payload.systemPrompt.includes('Epistemic Architect') && !payload.userPrompt.includes('SUBMITTED SIMULATION CODE')) {
            return {
              rawCode: `delegate_to_coder({
                "title": "Vision Model",
                "description": "Visual test",
                "visualPlan": "Canvas render",
                "mathFormulation": "y = x",
                "parametersSpec": [{ "id": "k", "label": "Rate", "type": "slider", "default": 1 }]
              })`
            };
          } else if (payload.systemPrompt.includes('Simulation Coder')) {
            return {
              rawCode: '<simulation_code>export default { init(){}, update(){} };</simulation_code>'
            };
          } else {
            capturedReviewPayload = payload;
            return { rawCode: JSON.stringify({ approved: true, critique: 'Visual verified' }) };
          }
        })
      };

      const result = await executeAutonomousSimulationLoop({
        context: mockContext,
        provider: mockProvider,
        testRunner: mockRunner
      });

      expect(result.success).toBe(true);
      expect(result.reviewMode).toBe('multimodal');
      expect(capturedReviewPayload).toBeDefined();
      expect(capturedReviewPayload.images).toBeDefined();
      expect(capturedReviewPayload.images.length).toBe(2);
      expect(capturedReviewPayload.images[0].mimeType).toBe('image/png');
      expect(capturedReviewPayload.images[0].label).toBe('Frame: defaults');
      expect(capturedReviewPayload.images[0].base64Data).toBe(sampleBase64);
      expect(capturedReviewPayload.images[1].label).toBe('Frame: max');
    });
  });

  describe('A8: Code Patching Revision Protocol', () => {
    it('supplies previous code and diagnostic findings to Coder on revision turn', async () => {
      let turn2CoderPrompt: string | undefined;
      let turnCount = 0;

      const mockRunner = async (req: PreFlightTestRequest): Promise<PreFlightTestResponse> => {
        turnCount++;
        if (turnCount === 1) {
          return {
            type: 'PREFLIGHT_TEST_RESPONSE',
            requestId: req.requestId,
            status: 'error',
            errorMessage: 'TypeError: undefined is not a function at eval:14:2',
            errorStack: 'TypeError: undefined is not a function\n    at eval:14:2',
            report: {
              status: 'fail',
              diagnostics: [
                {
                  code: 'RUNTIME_EXCEPTION',
                  severity: 'error',
                  message: 'TypeError: undefined is not a function at eval:14:2',
                  phase: 'init',
                  evidence: { stack: 'TypeError at eval:14:2', lineno: 14, colno: 2 }
                }
              ],
              runtimeErrors: [
                {
                  phase: 'init',
                  message: 'TypeError: undefined is not a function at eval:14:2',
                  lineno: 14,
                  colno: 2,
                  stack: 'TypeError: undefined is not a function\n    at eval:14:2'
                }
              ],
              frames: [],
              parameters: [],
              title: 'Crash Sim',
              description: 'Crashes on init',
              durationMs: 50
            }
          };
        }
        return {
          type: 'PREFLIGHT_TEST_RESPONSE',
          requestId: req.requestId,
          status: 'ok',
          validatedCode: req.rawCode,
          parameters: [{ id: 'k', label: 'Rate', type: 'slider', min: 0, max: 10, step: 1, default: 1 }]
        };
      };

      const mockProvider: IModelProvider = {
        type: 'anthropic',
        isLocal: false,
        isAvailable: async () => true,
        generateSimulation: vi.fn().mockImplementation(async (payload) => {
          if (payload.systemPrompt.includes('Epistemic Architect') && !payload.userPrompt.includes('SUBMITTED SIMULATION CODE')) {
            return {
              rawCode: `delegate_to_coder({
                "title": "Patching Model",
                "description": "Needs patch",
                "visualPlan": "Dynamic canvas",
                "mathFormulation": "y = x",
                "parametersSpec": [{ "id": "k", "label": "Rate", "type": "slider", "default": 1 }]
              })`
            };
          } else if (payload.systemPrompt.includes('Simulation Coder')) {
            if (!turn2CoderPrompt && payload.userPrompt.includes('PREVIOUS SIMULATION CODE')) {
              turn2CoderPrompt = payload.userPrompt;
            }
            return {
              rawCode: '<simulation_code>export default { init(){ /* patched */ }, update(){} };</simulation_code>'
            };
          } else {
            return { rawCode: JSON.stringify({ approved: true, critique: 'Patched successfully' }) };
          }
        })
      };

      const result = await executeAutonomousSimulationLoop({
        context: mockContext,
        provider: mockProvider,
        testRunner: mockRunner,
        maxIterations: 2
      });

      expect(result.success).toBe(true);
      expect(result.iterations).toBe(2);
      expect(turn2CoderPrompt).toBeDefined();
      expect(turn2CoderPrompt).toContain('### PREVIOUS SIMULATION CODE (TO BE PATCHED):');
      expect(turn2CoderPrompt).toContain('<previous_code>');
      expect(turn2CoderPrompt).toContain('### VERIFICATION HARNESS FINDINGS:');
      expect(turn2CoderPrompt).toContain('[ERROR RUNTIME_EXCEPTION @init]');
      expect(turn2CoderPrompt).toContain('TypeError: undefined is not a function');
    });
  });

  describe('A9: Loud Degradation Quality Flags', () => {
    it('emits REVIEW_UNPARSEABLE flag and does not silently approve when review response is not JSON', async () => {
      const mockRunner = async (req: PreFlightTestRequest): Promise<PreFlightTestResponse> => {
        return {
          type: 'PREFLIGHT_TEST_RESPONSE',
          requestId: req.requestId,
          status: 'ok',
          validatedCode: req.rawCode,
          parameters: [{ id: 'k', label: 'Rate', type: 'slider', min: 0, max: 10, step: 1, default: 1 }]
        };
      };

      const mockProvider: IModelProvider = {
        type: 'google-gemini',
        isLocal: false,
        isAvailable: async () => true,
        generateSimulation: vi.fn()
          .mockResolvedValueOnce({
            rawCode: `delegate_to_coder({
              "title": "Quality Model",
              "description": "Testing flags",
              "visualPlan": "Canvas",
              "mathFormulation": "y = x",
              "parametersSpec": [{ "id": "k", "label": "Rate", "type": "slider", "default": 1 }]
            })`
          })
          .mockResolvedValueOnce({ rawCode: '<simulation_code>export default { init(){}, update(){} };</simulation_code>' })
          .mockResolvedValueOnce({ rawCode: 'Looks great! Everything fits on the screen and works smoothly.' })
          .mockResolvedValueOnce({ rawCode: '<simulation_code>export default { init(){}, update(){} };</simulation_code>' })
          .mockResolvedValueOnce({ rawCode: JSON.stringify({ approved: true, critique: 'Valid JSON review' }) })
      };

      const result = await executeAutonomousSimulationLoop({
        context: mockContext,
        provider: mockProvider,
        testRunner: mockRunner,
        maxIterations: 2
      });

      expect(result.qualityFlags).toContain('REVIEW_UNPARSEABLE');
      expect(result.iterations).toBe(2);
    });

    it('emits FALLBACK_PLAN flag when Architect deliberation fails', async () => {
      const mockRunner = async (req: PreFlightTestRequest): Promise<PreFlightTestResponse> => {
        return {
          type: 'PREFLIGHT_TEST_RESPONSE',
          requestId: req.requestId,
          status: 'ok',
          validatedCode: req.rawCode,
          parameters: [{ id: 'rate', label: 'Rate', type: 'slider', min: 0.1, max: 5, step: 0.1, default: 1 }]
        };
      };

      const mockProvider: IModelProvider = {
        type: 'google-gemini',
        isLocal: false,
        isAvailable: async () => true,
        generateSimulation: vi.fn()
          .mockRejectedValueOnce(new Error('Quota exceeded'))
          .mockResolvedValueOnce({ rawCode: '<simulation_code>export default { init(){}, update(){} };</simulation_code>' })
          .mockResolvedValueOnce({ rawCode: JSON.stringify({ approved: true }) })
      };

      const result = await executeAutonomousSimulationLoop({
        context: mockContext,
        provider: mockProvider,
        testRunner: mockRunner,
        maxIterations: 1
      });

      expect(result.qualityFlags).toContain('FALLBACK_PLAN');
    });

    it('emits VERIFICATION_WARNINGS flag when diagnostics contain warnings', async () => {
      const mockRunner = async (req: PreFlightTestRequest): Promise<PreFlightTestResponse> => {
        return {
          type: 'PREFLIGHT_TEST_RESPONSE',
          requestId: req.requestId,
          status: 'ok',
          validatedCode: req.rawCode,
          parameters: [{ id: 'k', label: 'Rate', type: 'slider', min: 0, max: 10, step: 1, default: 1 }],
          report: {
            status: 'pass',
            diagnostics: [
              {
                code: 'NON_FINITE_TEXT',
                severity: 'warning',
                message: 'Canvas rendered NaN readout during min sweep phase',
                phase: 'min'
              }
            ],
            runtimeErrors: [],
            frames: [],
            parameters: [{ id: 'k', label: 'Rate', type: 'slider', min: 0, max: 10, step: 1, default: 1 }],
            title: 'Warning Sim',
            description: 'Has warning',
            durationMs: 80
          }
        };
      };

      const mockProvider: IModelProvider = {
        type: 'google-gemini',
        isLocal: false,
        isAvailable: async () => true,
        generateSimulation: vi.fn()
          .mockResolvedValueOnce({
            rawCode: `delegate_to_coder({
              "title": "Warning Model",
              "description": "Has warning",
              "visualPlan": "Canvas",
              "mathFormulation": "y = x",
              "parametersSpec": [{ "id": "k", "label": "Rate", "type": "slider", "default": 1 }]
            })`
          })
          .mockResolvedValueOnce({ rawCode: '<simulation_code>export default { init(){}, update(){} };</simulation_code>' })
          .mockResolvedValueOnce({ rawCode: JSON.stringify({ approved: true }) })
      };

      const result = await executeAutonomousSimulationLoop({
        context: mockContext,
        provider: mockProvider,
        testRunner: mockRunner,
        maxIterations: 1
      });

      expect(result.qualityFlags).toContain('VERIFICATION_WARNINGS');
      expect(result.diagnostics).toBeDefined();
      expect(result.diagnostics?.length).toBe(1);
    });
  });

  describe('A10: Pedagogy Phase in Architect & Explanation Normalization (Items 8, 9, 10)', () => {
    it('instructs Architect to perform Pedagogy Phase before visual design and enforce live parameter-driven tour rule', () => {
      const archSystem = buildArchitectSystemPrompt({ width: 380, height: 500 });
      expect(archSystem).toContain('### PEDAGOGY PHASE (MANDATORY BEFORE VISUAL DESIGN):');
      expect(archSystem).toContain('coreInsight');
      expect(archSystem).toContain('prerequisites');
      expect(archSystem).toContain('misconception');
      expect(archSystem).toContain('ahaExperiment');
      expect(archSystem).toContain('symbolMap');
      expect(archSystem).toContain(
        'Guided tours (`explanation.tour`) must drive the live simulation model via parameter updates (`params` passed to `update(params)`); never hardcode static frames or disconnected slides.'
      );
      expect(DELEGATE_TO_CODER_TOOL.parameters.properties.pedagogy).toBeDefined();
      expect(DELEGATE_TO_CODER_TOOL.parameters.properties.explanation).toBeDefined();
    });

    it('preserves and normalizes pedagogy and explanation in normalizeCoderPlan and synthesizes defaults when explanation is omitted', () => {
      const explicitPlan = normalizeCoderPlan({
        title: 'Damped Oscillator',
        description: 'Mass-spring-damper',
        visualPlan: 'Canvas trace',
        mathFormulation: 'm x\'\' + c x\' + k x = 0',
        parametersSpec: [
          { id: 'zeta', label: 'Damping (ζ)', type: 'slider', min: 0, max: 2, step: 0.05, default: 0.2 }
        ],
        pedagogy: {
          coreInsight: 'Critical damping (ζ=1) achieves fastest equilibrium return without overshoot.',
          prerequisites: ['Hooke\'s Law'],
          misconception: 'More damping always slows settling time.',
          ahaExperiment: 'Sweep ζ from 0.15 to 1.0 and compare envelope decay.',
          symbolMap: [
            { symbol: 'ζ', meaning: 'Damping ratio', visualElement: 'Envelope decay rate (#f43f5e)' }
          ]
        },
        explanation: {
          insight: 'Critical damping (ζ=1) achieves fastest equilibrium return without overshoot.',
          legend: [{ symbol: 'ζ', meaning: 'Damping ratio', color: '#f43f5e' }],
          tour: [
            { title: 'Underdamped', caption: 'Oscillates at ζ=0.15', params: { zeta: 0.15 } },
            { title: 'Critical', caption: 'No overshoot at ζ=1.0', params: { zeta: 1.0 } }
          ]
        }
      });

      expect(explicitPlan.pedagogy?.coreInsight).toContain('Critical damping');
      expect(explicitPlan.pedagogy?.symbolMap?.length).toBe(1);
      expect(explicitPlan.explanation?.insight).toContain('Critical damping');
      expect(explicitPlan.explanation?.legend?.length).toBe(1);
      expect(explicitPlan.explanation?.tour?.length).toBe(2);

      // When explanation is omitted, normalizeCoderPlan synthesizes a valid explanation from pedagogy + parametersSpec
      const synthesizedPlan = normalizeCoderPlan({
        title: 'Wave Dispersion',
        description: 'Packet spreading',
        visualPlan: '1D canvas',
        mathFormulation: 'omega(k) = alpha k^2',
        parametersSpec: [
          { id: 'alpha', label: 'Dispersion (α)', type: 'slider', min: 0.1, max: 4.0, step: 0.1, default: 1.0 }
        ],
        pedagogy: {
          coreInsight: 'Higher dispersion α spreads wavepackets faster over time.',
          prerequisites: ['Fourier superposition'],
          misconception: 'All wave frequencies travel at the same speed.',
          ahaExperiment: 'Increase α to 4.0 to see rapid packet broadening.',
          symbolMap: [{ symbol: 'α', meaning: 'Dispersion coefficient', visualElement: 'Cyan envelope' }]
        }
      });

      expect(synthesizedPlan.explanation).toBeDefined();
      expect(synthesizedPlan.explanation?.insight).toBe('Higher dispersion α spreads wavepackets faster over time.');
      expect(synthesizedPlan.explanation?.legend?.[0].symbol).toBe('α');
      expect(synthesizedPlan.explanation?.tour?.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('A11: Reviewer Pedagogical & Comprehension Criteria (Item 11)', () => {
    it('evaluates Newcomer Element Identifiability, Default Insight Visibility, Source Symbol Consistency, and Live Parameter-Driven Tour', () => {
      const plan = normalizeCoderPlan({
        title: 'Damped Oscillator',
        description: 'Mass-spring-damper',
        visualPlan: 'Canvas trace',
        mathFormulation: 'm x\'\' + c x\' + k x = 0',
        parametersSpec: [
          { id: 'zeta', label: 'Damping (ζ)', type: 'slider', min: 0, max: 2, step: 0.05, default: 0.2 }
        ],
        pedagogy: {
          coreInsight: 'Critical damping (ζ=1) achieves fastest equilibrium return without overshoot.',
          prerequisites: ['Hooke\'s Law'],
          misconception: 'More damping always slows settling time.',
          ahaExperiment: 'Sweep ζ from 0.15 to 1.0 and compare envelope decay.',
          symbolMap: [
            { symbol: 'x(t)', meaning: 'Displacement', visualElement: 'Cyan curve (#38bdf8)' }
          ]
        }
      });

      const reviewPrompt = buildArchitectReviewPrompt(
        plan,
        {
          status: 'ok',
          executionTimeMs: 42,
          logs: [],
          parameters: []
        },
        'export default { title: "Damped Oscillator", explanation: { insight: "...", legend: [], tour: [] }, init(){}, update(){} };'
      );

      expect(reviewPrompt).toContain('### REVIEW CRITERIA:');
      expect(reviewPrompt).toContain('Newcomer Element Identifiability');
      expect(reviewPrompt).toContain('Default Insight Visibility');
      expect(reviewPrompt).toContain('Source Symbol Consistency');
      expect(reviewPrompt).toContain('Live Parameter-Driven Tour');
      expect(reviewPrompt).toContain('Critical damping (ζ=1)');
      expect(reviewPrompt).toContain('x(t): Displacement -> Cyan curve (#38bdf8)');
    });
  });

  describe('A12: Coder Full Source Context, Equations, DOM Context & Pedagogy (Item 12)', () => {
    it('includes full selectedText, extracted equations, DOM context, pedagogy, and explanation blueprint in buildCoderUserPrompt', () => {
      const richContext: HarvestedContext = {
        ...mockContext,
        domContext: {
          nearestHeading: 'Section 4.2: Viscous Damping Regimes',
          headingLevel: 'h2',
          caption: 'Figure 4: Underdamped vs Critically Damped response curves.',
          paragraphSnippet: 'When the damping ratio zeta equals 1, the characteristic equation has a repeated real root.'
        }
      };

      const plan = normalizeCoderPlan({
        title: 'Damped Harmonic Oscillator',
        description: 'Interactive regime explorer',
        visualPlan: 'Dual canvas with spring-mass and x(t) curve',
        mathFormulation: 'm \\ddot{x} + c \\dot{x} + k x = 0',
        parametersSpec: [
          { id: 'zeta', label: 'Damping Ratio (ζ)', type: 'slider', min: 0, max: 2, step: 0.05, default: 0.2 }
        ],
        pedagogy: {
          coreInsight: 'At ζ = 1, critical damping returns the mass to equilibrium fastest without oscillating.',
          prerequisites: ['Second-order linear ODEs'],
          misconception: 'Increasing damping always makes the system return to zero faster.',
          ahaExperiment: 'Compare ζ = 0.2 (ringing) against ζ = 1.0 (critical) and ζ = 1.8 (sluggish).',
          symbolMap: [
            { symbol: 'x(t)', meaning: 'Displacement', visualElement: 'Cyan trace (#38bdf8)' },
            { symbol: '±e^{-ζω₀t}', meaning: 'Decay envelope', visualElement: 'Dashed rose curve (#f43f5e)' }
          ]
        }
      });

      const coderUserPrompt = buildCoderUserPrompt(plan, undefined, richContext);

      // 1. Selected text & equations
      expect(coderUserPrompt).toContain('### SOURCE CONCEPT:');
      expect(coderUserPrompt).toContain(richContext.selection.selectedText);
      expect(coderUserPrompt).toContain('### SOURCE EQUATIONS:');
      expect(coderUserPrompt).toContain('m \\ddot{x} + c \\dot{x} + k x = 0');

      // 2. Surrounding DOM context
      expect(coderUserPrompt).toContain('### SOURCE DOM CONTEXT:');
      expect(coderUserPrompt).toContain('Section 4.2: Viscous Damping Regimes');
      expect(coderUserPrompt).toContain('Figure 4: Underdamped vs Critically Damped response curves.');
      expect(coderUserPrompt).toContain('When the damping ratio zeta equals 1');

      // 3. Architect Pedagogy & Symbol Map
      expect(coderUserPrompt).toContain('### PEDAGOGY & EPISTEMIC GOALS:');
      expect(coderUserPrompt).toContain('At ζ = 1, critical damping returns the mass to equilibrium fastest');
      expect(coderUserPrompt).toContain('Increasing damping always makes the system return to zero faster.');
      expect(coderUserPrompt).toContain('x(t): Displacement -> Rendered as: Cyan trace (#38bdf8)');

      // 4. Required Explanation & Guided Tour Blueprint
      expect(coderUserPrompt).toContain('### EXPLANATION & GUIDED TOUR BLUEPRINT');
      expect(coderUserPrompt).toContain('"insight"');
      expect(coderUserPrompt).toContain('"legend"');
      expect(coderUserPrompt).toContain('"tour"');
    });
  });
});


