import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildSweepPlan,
  computeRasterStats,
  isBlankRender,
  scanNonFiniteText,
  detectDuplicateControls,
  detectCanvasSizing,
  detectOutOfBounds,
  assembleVerificationReport,
  formatDiagnosticsForCoder,
  verifySimulationInStage
} from '../src/runtime/verification';
import { ParameterDefinition } from '../src/types/simulation';

describe('Simulation Verification Harness Specification (docs/specs/simulation_verification.md)', () => {
  describe('V1: Offscreen Stage Non-Zero Geometry', () => {
    it('sizes container to non-zero stage dimensions before calling module.init', async () => {
      const simRoot = document.createElement('div');
      const code = `
        export default {
          title: 'Stage Size Probe',
          description: 'Reads container.clientWidth and stage dimensions',
          parameters: [
            { id: 'k', label: 'K', type: 'slider', min: 1, max: 10, step: 1, default: 5 }
          ],
          init(container, params, stage) {
            const canvas = document.createElement('canvas');
            canvas.width = container.clientWidth * (stage ? stage.dpr : 1);
            canvas.height = container.clientHeight * (stage ? stage.dpr : 1);
            container.appendChild(canvas);
          },
          update() {},
          destroy() {}
        };
      `;

      const report = await verifySimulationInStage(simRoot, code, {
        viewport: { width: 380, height: 500 },
        soakMs: 32,
        sweep: false,
        captureFrames: false
      });

      const canvas = simRoot.querySelector('canvas');
      expect(canvas).not.toBeNull();
      // 500 - 44 (controls drawer) = 456
      expect(canvas?.width).toBe(380);
      expect(canvas?.height).toBe(456);
      expect(report.status).toBe('pass');
      expect(report.diagnostics.some(d => d.code === 'CANVAS_SIZE_MISMATCH')).toBe(false);
    });
  });

  describe('V2: Multi-Frame rAF Soak & Async Exception Trapping', () => {
    it('traps exceptions thrown inside the 3rd requestAnimationFrame callback with phase=soak', async () => {
      const simRoot = document.createElement('div');
      const code = `
        export default {
          title: 'Delayed rAF Crash',
          description: 'Throws on 3rd animation frame',
          parameters: [],
          init(container, params, stage) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            svg.appendChild(circle);
            container.appendChild(svg);
            this.frame = 0;
            const tick = () => {
              this.frame++;
              if (this.frame === 3) {
                throw new Error('Explosion on frame 3');
              }
              this.raf = requestAnimationFrame(tick);
            };
            this.raf = requestAnimationFrame(tick);
          },
          update() {},
          destroy() {
            if (this.raf) cancelAnimationFrame(this.raf);
          }
        };
      `;

      const report = await verifySimulationInStage(simRoot, code, {
        soakMs: 120,
        sweep: false,
        captureFrames: false
      });

      expect(report.status).toBe('fail');
      expect(report.runtimeErrors.length).toBe(1);
      expect(report.runtimeErrors[0].phase).toBe('soak');
      expect(report.runtimeErrors[0].message).toContain('Explosion on frame 3');
      expect(report.diagnostics.some(d => d.code === 'RUNTIME_EXCEPTION' && d.phase === 'soak')).toBe(true);
    });
  });

  describe('V3: Blank Render Detection', () => {
    it('detects uniform single-color canvases as blank renders', () => {
      // 100x100 dark blue canvas (#090d16 -> R:9, G:13, B:22, A:255)
      const uniformRgba = new Uint8ClampedArray(100 * 100 * 4);
      for (let i = 0; i < uniformRgba.length; i += 4) {
        uniformRgba[i] = 9;
        uniformRgba[i + 1] = 13;
        uniformRgba[i + 2] = 22;
        uniformRgba[i + 3] = 255;
      }

      const stats = computeRasterStats(uniformRgba, 100, 100);
      expect(isBlankRender(stats)).toBe(true);
    });

    it('identifies non-uniform rendered graphics as valid active renders', () => {
      const activeRgba = new Uint8ClampedArray(100 * 100 * 4);
      for (let i = 0; i < activeRgba.length; i += 4) {
        // Draw diagonal gradient
        activeRgba[i] = (i / 4) % 255;
        activeRgba[i + 1] = 100;
        activeRgba[i + 2] = 200;
        activeRgba[i + 3] = 255;
      }

      const stats = computeRasterStats(activeRgba, 100, 100);
      expect(isBlankRender(stats)).toBe(false);
    });

    it('flags empty stage containers as BLANK_RENDER during verifySimulationInStage', async () => {
      const simRoot = document.createElement('div');
      const code = `
        export default {
          title: 'Empty Sim',
          description: 'Appends nothing to container',
          parameters: [],
          init() {},
          update() {}
        };
      `;

      const report = await verifySimulationInStage(simRoot, code, {
        soakMs: 16,
        sweep: false,
        captureFrames: false
      });

      expect(report.status).toBe('fail');
      expect(report.diagnostics.some(d => d.code === 'BLANK_RENDER')).toBe(true);
    });
  });

  describe('V4: Non-Finite Value Audit Across Parameter Sweep', () => {
    it('flags NaN and Infinity in rendered DOM text', () => {
      const container = document.createElement('div');
      container.innerHTML = `
        <div class="readout">Current Velocity: NaN m/s</div>
        <div class="energy">Total Energy: 142.5 J</div>
        <div class="limit">Damping: Infinity</div>
      `;

      const flagged = scanNonFiniteText(container);
      expect(flagged.length).toBe(2);
      expect(flagged[0]).toContain('NaN');
      expect(flagged[1]).toContain('Infinity');
    });

    it('detects NaN rendered during the min parameter sweep phase', async () => {
      const simRoot = document.createElement('div');
      const code = `
        export default {
          title: 'Zero Division at Min',
          description: 'Divides by mass which has min: 0',
          parameters: [
            { id: 'mass', label: 'Mass', type: 'slider', min: 0, max: 10, step: 1, default: 2 }
          ],
          init(container, params) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            svg.appendChild(circle);
            container.appendChild(svg);
            this.readout = document.createElement('div');
            container.appendChild(this.readout);
            this.update(params);
          },
          update(params) {
            const accel = 10 / params.mass; // Infinity when mass = 0, or 0/0 -> NaN
            const ratio = (params.mass - params.mass) / params.mass;
            this.readout.textContent = 'Ratio: ' + ratio + ', Accel: ' + accel;
          }
        };
      `;

      const report = await verifySimulationInStage(simRoot, code, {
        soakMs: 16,
        sweep: true,
        captureFrames: false
      });

      expect(report.status).toBe('fail');
      expect(report.diagnostics.some(d => d.code === 'NON_FINITE_TEXT' && d.phase === 'min')).toBe(true);
    });
  });

  describe('V5 & V6: Canvas Sizing, Out-of-Bounds & Duplicate Control Intercept', () => {
    it('flags default 300x150 uninitialized canvas backing stores', () => {
      const diagnostics = detectCanvasSizing(
        [{ width: 300, height: 150 }],
        { width: 380, height: 500 },
        1
      );
      expect(diagnostics.some(d => d.code === 'DEFAULT_CANVAS_SIZE')).toBe(true);
    });

    it('flags elements extending >4px outside the stage bounds', () => {
      const diagnostics = detectOutOfBounds(
        [{ descriptor: 'div#legend', left: 320, top: 10, width: 120, height: 40 }],
        { width: 380, height: 456 }
      );
      expect(diagnostics.some(d => d.code === 'OUT_OF_BOUNDS')).toBe(true);
    });

    it('flags unauthorized manual Tweakpane instances and HTML inputs inside the simulation stage', () => {
      const stage = document.createElement('div');
      const paneEl = document.createElement('div');
      paneEl.className = 'tp-rotv'; // Tweakpane root container class
      stage.appendChild(paneEl);

      const count = detectDuplicateControls(stage);
      expect(count).toBe(1);
    });
  });

  describe('V7: Sweep Plan Formulation', () => {
    it('formulates defaults, min, and max phases for sliders and steppers and excludes buttons', () => {
      const params: ParameterDefinition[] = [
        { id: 'rate', label: 'Rate', type: 'slider', min: 0.1, max: 2.0, step: 0.1, default: 1.0 },
        { id: 'active', label: 'Active', type: 'toggle', default: true },
        { id: 'reset', label: 'Reset', type: 'button' }
      ];

      const plan = buildSweepPlan(params, true);
      expect(plan.length).toBe(3);
      expect(plan[0].phase).toBe('defaults');
      expect(plan[0].params).toEqual({ rate: 1.0, active: true });

      expect(plan[1].phase).toBe('min');
      expect(plan[1].params).toEqual({ rate: 0.1, active: true });

      expect(plan[2].phase).toBe('max');
      expect(plan[2].params).toEqual({ rate: 2.0, active: true });
    });

    it('captures 3 VerificationFrames (defaults, min, max) with PNG image attachments when captureFrames=true', async () => {
      const simRoot = document.createElement('div');
      const code = `
        export default {
          title: "Sweep Frame Sim",
          description: "Renders 3 sweep phases",
          parameters: [
            { id: "freq", label: "Frequency", type: "slider", min: 1, max: 10, step: 1, default: 5 }
          ],
          init(container, params, stage) {
            const c = document.createElement('canvas');
            c.width = stage.width;
            c.height = stage.height;
            container.appendChild(c);
          },
          update(params) {}
        };
      `;

      const report = await verifySimulationInStage(simRoot, code, {
        soakMs: 16,
        sweep: true,
        captureFrames: true
      });

      expect(report.status).toBe('pass');
      const frames = report.frames || [];
      expect(frames.length).toBe(3);
      expect(frames.map(f => f.phase)).toEqual(['defaults', 'min', 'max']);
      expect(frames[0].params).toEqual({ freq: 5 });
      expect(frames[1].params).toEqual({ freq: 1 });
      expect(frames[2].params).toEqual({ freq: 10 });
      for (const frame of frames) {
        expect(frame.image?.mimeType).toBe('image/png');
        expect(frame.image?.base64Data.length).toBeGreaterThan(0);
        expect(frame.dataUrl).toContain('data:image/png;base64,');
      }
    });
  });

  describe('Additional Diagnostics: NO_VISUAL_ROOT, TIMEOUT, NO_FRAME_PROGRESS, Multi-Canvas & WebGL', () => {
    let simRoot: HTMLElement;
    beforeEach(() => {
      simRoot = document.createElement('div');
      document.body.innerHTML = '';
      document.body.appendChild(simRoot);
    });

    it('emits NO_VISUAL_ROOT and BLANK_RENDER when nothing is mounted in #sim-root', async () => {
      const code = `
        export default {
          title: "No Visual Root",
          parameters: [],
          init() {},
          update() {}
        };
      `;
      const report = await verifySimulationInStage(simRoot, code, {
        soakMs: 16,
        sweep: false,
        captureFrames: false
      });

      expect(report.status).toBe('fail');
      expect(report.diagnostics.some(d => d.code === 'NO_VISUAL_ROOT')).toBe(true);
      expect(report.diagnostics.some(d => d.code === 'BLANK_RENDER')).toBe(true);
    });

    it('emits TIMEOUT diagnostic when simulation execution exceeds timeoutMs', async () => {
      const code = `
        export default {
          title: "Slow Sim",
          parameters: [],
          async init(container, params, stage) {
            const c = document.createElement('canvas');
            c.width = stage.width;
            c.height = stage.height;
            container.appendChild(c);
            await new Promise(r => setTimeout(r, 40));
          },
          update() {}
        };
      `;
      const report = await verifySimulationInStage(simRoot, code, {
        soakMs: 16,
        sweep: false,
        captureFrames: false,
        timeoutMs: 10
      });

      expect(report.status).toBe('fail');
      expect(report.diagnostics.some(d => d.code === 'TIMEOUT')).toBe(true);
    });

    it('does not false-positive BLANK_RENDER on multi-canvas stacks where layer 0 is blank and layer 2 has graph content', async () => {
      const code = `
        export default {
          title: "Multi-Canvas Cytoscape Stack",
          parameters: [],
          init(container, params, stage) {
            for (let idx = 0; idx < 3; idx++) {
              const c = document.createElement('canvas');
              c.width = stage.width;
              c.height = stage.height;
              const isGraphLayer = idx === 2;
              c.getContext = () => ({
                getImageData: () => {
                  const data = new Uint8ClampedArray(stage.width * stage.height * 4);
                  for (let i = 0; i < stage.width * stage.height; i++) {
                    const p = i * 4;
                    if (isGraphLayer && i % 5 === 0) {
                      data[p] = 56; data[p+1] = 189; data[p+2] = 248; data[p+3] = 255;
                    } else {
                      data[p] = 9; data[p+1] = 13; data[p+2] = 22; data[p+3] = 255;
                    }
                  }
                  return { data };
                }
              });
              container.appendChild(c);
            }
          },
          update() {}
        };
      `;

      const report = await verifySimulationInStage(simRoot, code, {
        soakMs: 16,
        sweep: false,
        captureFrames: false
      });

      expect(report.diagnostics.some(d => d.code === 'BLANK_RENDER')).toBe(false);
      expect(report.status).toBe('pass');
    });

    it('emits NO_FRAME_PROGRESS warning when an animation loop pumps frames without changing canvas pixels', async () => {
      const code = `
        export default {
          title: "Static rAF Loop",
          parameters: [],
          init(container, params, stage) {
            const c = document.createElement('canvas');
            c.width = stage.width;
            c.height = stage.height;
            c.getContext = () => ({
              getImageData: () => {
                const data = new Uint8ClampedArray(stage.width * stage.height * 4);
                for (let i = 0; i < stage.width * stage.height; i++) {
                  const p = i * 4;
                  if (i % 4 === 0) {
                    data[p] = 244; data[p+1] = 63; data[p+2] = 94; data[p+3] = 255;
                  } else {
                    data[p] = 9; data[p+1] = 13; data[p+2] = 22; data[p+3] = 255;
                  }
                }
                return { data };
              }
            });
            container.appendChild(c);
            const tick = () => {
              this.raf = requestAnimationFrame(tick);
            };
            this.raf = requestAnimationFrame(tick);
          },
          update() {},
          destroy() {
            if (this.raf) cancelAnimationFrame(this.raf);
          }
        };
      `;

      const report = await verifySimulationInStage(simRoot, code, {
        soakMs: 64,
        sweep: false,
        captureFrames: false
      });

      expect(report.diagnostics.some(d => d.code === 'NO_FRAME_PROGRESS' && d.severity === 'warning')).toBe(true);
      expect(report.status).toBe('pass');
    });

    it('forces preserveDrawingBuffer: true when WebGL context is requested and traps async init rejections', async () => {
      let capturedAttrs: any = null;
      const origGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type: string, attrs?: any): any {
        if (type === 'webgl') {
          capturedAttrs = attrs;
        }
        return null;
      };

      try {
        const code = `
          export default {
            title: "WebGL Async Error",
            parameters: [],
            async init(container, params, stage) {
              const c = document.createElement('canvas');
              c.width = stage.width;
              c.height = stage.height;
              container.appendChild(c);
              c.getContext('webgl', { antialias: true });
              throw new Error('Async shader compilation failed');
            },
            update() {}
          };
        `;

        const report = await verifySimulationInStage(simRoot, code, {
          soakMs: 16,
          sweep: false,
          captureFrames: false
        });

        expect(capturedAttrs).toEqual({ antialias: true, preserveDrawingBuffer: true });
        expect(report.status).toBe('fail');
        expect(report.runtimeErrors.some(e => e.phase === 'init' && e.message.includes('Async shader compilation failed'))).toBe(true);
      } finally {
        HTMLCanvasElement.prototype.getContext = origGetContext;
      }
    });
  });

  describe('Report Assembly & Diagnostic Formatting', () => {
    it('sets report.status to fail if any diagnostic has error severity', () => {
      const report = assembleVerificationReport({
        diagnostics: [
          { code: 'BLANK_RENDER', severity: 'error', message: 'Canvas is completely blank' }
        ],
        runtimeErrors: [],
        frames: [],
        parameters: [],
        title: 'Broken Sim',
        description: 'Fails verification',
        durationMs: 120
      });

      expect(report.status).toBe('fail');
      const formatted = formatDiagnosticsForCoder(report);
      expect(formatted).toContain('[ERROR BLANK_RENDER]');
    });

    it('extracts valid explanation onto VerificationReport and emits INVALID_EXPLANATION_SCHEMA warnings when tour references undeclared parameter', async () => {
      const code = `
        export default {
          title: "Explained Sim",
          description: "Has explanation with one valid and one invalid tour param",
          parameters: [
            { id: "zeta", label: "Damping", type: "slider", min: 0, max: 2, step: 0.1, default: 0.2 }
          ],
          explanation: {
            insight: "Critical damping returns to zero fastest without overshoot.",
            legend: [
              { symbol: "x(t)", meaning: "Displacement curve", color: "#38bdf8" }
            ],
            tour: [
              { caption: "Step 1: Underdamped", params: { zeta: 0.2 } },
              { caption: "Step 2: Bogus param", params: { bogusParam: 99 } }
            ]
          },
          init(container, params) {
            container.innerHTML = '<div style="padding:16px;color:#f8fafc;">Displacement: ' + params.zeta + '</div>';
          },
          update(params) {
            container.innerHTML = '<div style="padding:16px;color:#f8fafc;">Displacement: ' + params.zeta + '</div>';
          }
        };
      `;

      const simRoot = document.createElement('div');
      document.body.appendChild(simRoot);
      try {
        const report = await verifySimulationInStage(simRoot, code, {
          soakMs: 16,
          sweep: false,
          captureFrames: false
        });

        expect(report.status).toBe('pass');
        expect(report.explanation).toBeDefined();
        expect(report.explanation?.insight).toContain('Critical damping');
        expect(report.diagnostics.some(d => d.code === 'INVALID_EXPLANATION_SCHEMA' && d.severity === 'warning')).toBe(true);
      } finally {
        simRoot.remove();
      }
    });
  });
});

