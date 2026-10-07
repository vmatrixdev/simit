/**
 * SimIt Side Panel UI Controller
 * Conforms to docs/specs/architecture.md#side-panel-ui-host and docs/specs/agent_loop.md
 */

import {
  HostToSandboxMessage,
  SandboxToHostMessage,
  SandboxInitSimulationMessage,
  SandboxUpdateParametersMessage,
  EvolutionRequestMessage,
  EvolutionResponseMessage,
  CloudEscalationRequestMessage,
  CloudEscalationResponseMessage
} from '../types/ipc';
import { ParameterDefinition, ParameterState } from '../types/simulation';
import { AtifTrajectory } from '../types/atif';
import { BYOKStorageSettings, ProviderType } from '../types/models';
import { EvolutionChip } from '../types/evolution';
import { RoutingDecision } from '../types/routing';
import {
  loadBYOKSettings,
  saveBYOKSettings,
  createProviderInstance,
  DEFAULT_BYOK_SETTINGS
} from '../providers/resolver';
import { generateStandaloneSimulationHtml } from '../export/standalone-exporter';

// UI State Elements
const stateEmpty = document.getElementById('state-empty') as HTMLElement;
const stateLoading = document.getElementById('state-loading') as HTMLElement;
const stateSimulation = document.getElementById('state-simulation') as HTMLElement;
const stateError = document.getElementById('state-error') as HTMLElement;

const statusPill = document.getElementById('status-pill') as HTMLElement;
const loadingTitle = document.getElementById('loading-stage-title') as HTMLElement;
const loadingDesc = document.getElementById('loading-stage-desc') as HTMLElement;

const simTitle = document.getElementById('sim-title') as HTMLElement;
const simDesc = document.getElementById('sim-desc') as HTMLElement;
const sandboxIframe = document.getElementById('sandbox-iframe') as HTMLIFrameElement;
const controlsList = document.getElementById('controls-list') as HTMLElement;
const btnResetParams = document.getElementById('btn-reset-params') as HTMLButtonElement;

// Phase 3 UI Elements
const versionScrubber = document.getElementById('version-scrubber') as HTMLElement;
const btnCloudEscalate = document.getElementById('btn-cloud-escalate') as HTMLButtonElement;
const cloudEscalateText = document.getElementById('cloud-escalate-text') as HTMLElement;

const evolutionChipsDock = document.getElementById('evolution-chips-dock') as HTMLElement;
const evolutionChipsList = document.getElementById('evolution-chips-list') as HTMLElement;

const codeTerminalOverlay = document.getElementById('code-terminal-overlay') as HTMLElement;
const btnToggleCodeTerminal = document.getElementById('btn-toggle-code-terminal') as HTMLButtonElement;
const btnCopySimCodeInline = document.getElementById('btn-copy-sim-code-inline') as HTMLButtonElement;
const btnCopyTerminalCode = document.getElementById('btn-copy-terminal-code') as HTMLButtonElement;
const btnCloseTerminal = document.getElementById('btn-close-terminal') as HTMLButtonElement;
const btnCloseTerminalDot = document.getElementById('btn-close-terminal-dot') as HTMLElement;
const terminalCopyText = document.getElementById('terminal-copy-text') as HTMLElement;

const refinementDock = document.getElementById('refinement-dock') as HTMLElement;
const refinementInput = document.getElementById('refinement-input') as HTMLInputElement;
const btnRefinementSend = document.getElementById('btn-refinement-send') as HTMLButtonElement;
const refinementStatus = document.getElementById('refinement-status') as HTMLElement;

// Repair Icon
const btnRepair = document.getElementById('btn-repair') as HTMLButtonElement;

// Export Menu Elements
const btnExportToggle = document.getElementById('btn-export-toggle') as HTMLButtonElement;
const exportMenu = document.getElementById('export-menu') as HTMLElement;
const btnExportHtml = document.getElementById('btn-export-html') as HTMLButtonElement;
const btnExportAtif = document.getElementById('btn-export-atif') as HTMLButtonElement;
const btnCopyAtif = document.getElementById('btn-copy-atif') as HTMLButtonElement;

// Settings Modal Elements
const btnSettings = document.getElementById('btn-settings') as HTMLButtonElement;
const modalSettings = document.getElementById('modal-settings') as HTMLElement;
const btnCloseSettings = document.getElementById('btn-close-settings') as HTMLButtonElement;
const providerSelect = document.getElementById('provider-select') as HTMLSelectElement;
const fieldsAnthropic = document.getElementById('fields-anthropic') as HTMLElement;
const fieldsGemini = document.getElementById('fields-gemini') as HTMLElement;
const fieldsOpenai = document.getElementById('fields-openai') as HTMLElement;
const chkFallback = document.getElementById('chk-fallback') as HTMLInputElement;
const btnSaveSettings = document.getElementById('btn-save-settings') as HTMLButtonElement;
const btnTestConnection = document.getElementById('btn-test-connection') as HTMLButtonElement;
const settingsStatusMsg = document.getElementById('settings-status-msg') as HTMLElement;

export const WELCOME_SIMULATION_CODE = `export default {
  title: "SimIt: Highlight to Interactive Reality",
  description: "Watch a human reader highlight technical text on a webpage and click SimIt. See the agent loop convert it into a live 60 FPS simulation. Pan & zoom across the journey!",
  parameters: [],
  init(container, params) {
    this.container = container;
    this.params = { speed: 1.0, gamma: 0.37, ...(params || {}) };
    this.viewMode = (params && params.viewMode) || "Auto-Tour";
    this.example = (params && params.example) || "Auto-Cycle All 3";

    // Virtual world coordinates (widescreen canvas)
    this.worldW = 1080;
    this.worldH = 540;

    // Active world width dynamically expands as pages appear (360 -> 720 -> 1080)
    this.getActiveWorldWidth = () => {
      const localT = this.getLocalTime();
      if (localT < 6.4) return 360;
      if (localT < 9.8) return 720;
      return 1080;
    };

    // Camera state
    this.camX = 0;
    this.camTargetX = 0;
    this.camZoom = 1.0;
    this.camTargetZoom = 1.0;
    this.userInteractingTimer = 0;

    // Timeline state
    this.storyTime = 0;
    this.exampleDuration = 14.0;
    this.totalDuration = 42.0;

    // Payoff 1: Duffing oscillator state
    this.payoff = {
      x: 0.6,
      v: 0.0,
      t: 0.0,
      history: []
    };

    // Payoff 2: Sequence diagram state
    this.seqStep = 0;
    this.seqTimer = 0;
    this.seqPlaying = true;

    // Payoff 3: ERD state
    this.erdSelectedTable = null;

    // Flowing energy packets between acts
    this.streamPackets = [];

    // Drag-to-pan state on canvas
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartCamX = 0;

    // Setup Canvas
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position: absolute; inset: 0; width: 100%; height: 100%; display: block; background: #030712; cursor: grab; user-select: none;';
    container.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // Pointer event handlers for direct pan, chapter pills, and interactive payoffs
    canvas.addEventListener('pointerdown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      // Check if user clicked bottom chapter nav pills (fixed screen coordinates)
      const pillY = this.h - 38;
      if (py >= pillY - 6 && py <= pillY + 28) {
        const pillW = Math.min(78, (this.w - 30) / 4);
        const startX = 12;
        for (let i = 0; i < 4; i++) {
          const bx = startX + i * (pillW + 4);
          if (px >= bx && px <= bx + pillW) {
            const modes = ["1. Boring Webpage", "2. Agent Loop", "3. Live Payoff Sim", "Overview (All)"];
            this.viewMode = modes[i];
            this.userInteractingTimer = 6.0;

            const curIdx = this.getCurrentExampleIndex();
            const curLocalT = this.getLocalTime();
            // Fast-forward story if clicking an act that hasn't materialized yet
            if (i === 1 && curLocalT < 6.4) {
              this.storyTime = curIdx * this.exampleDuration + 6.4;
            } else if (i === 2 && curLocalT < 9.8) {
              this.storyTime = curIdx * this.exampleDuration + 9.8;
            } else if (i === 0) {
              this.camTargetX = 0;
            }
            return;
          }
        }
      }

      // World coordinates calculation
      const worldPx = this.camX + px / this.camZoom;
      const worldPy = (py - Math.max(0, (this.h - this.worldH * this.camZoom) / 2)) / this.camZoom;

      // Payoff interaction when live (only if world coordinates are in Act 3: x >= 740 && x <= 1060)
      const currentIdx = this.getCurrentExampleIndex();
      const localT = this.getLocalTime();
      const isLive = localT >= 9.8;

      if (isLive && worldPx >= 740 && worldPx <= 1060 && worldPy >= 40 && worldPy <= 490) {
        // Payoff 1 (Duffing): perturb state
        if (currentIdx === 0 && worldPx >= 755 && worldPx <= 1045 && worldPy >= 100 && worldPy <= 320) {
          const normX = ((worldPx - 900) / 110) * 2.4;
          const normV = -((worldPy - 210) / 95) * 2.5;
          this.payoff.x = Math.max(-2.2, Math.min(2.2, normX));
          this.payoff.v = Math.max(-2.5, Math.min(2.5, normV));
          this.payoff.history = [];
          return;
        }

        // Payoff 2 (Sequence Diagram): step controls
        if (currentIdx === 1) {
          // Prev Step button: 760-825, y: 430-465
          if (worldPx >= 760 && worldPx <= 825 && worldPy >= 430 && worldPy <= 465) {
            this.seqStep = (this.seqStep + 4) % 5;
            this.seqTimer = 0;
            return;
          }
          // Next Step button: 835-900, y: 430-465
          if (worldPx >= 835 && worldPx <= 900 && worldPy >= 430 && worldPy <= 465) {
            this.seqStep = (this.seqStep + 1) % 5;
            this.seqTimer = 0;
            return;
          }
          // Play/Pause button: 910-975, y: 430-465
          if (worldPx >= 910 && worldPx <= 975 && worldPy >= 430 && worldPy <= 465) {
            this.seqPlaying = !this.seqPlaying;
            return;
          }
          // Click on lifeline step lines to jump to that step
          for (let s = 0; s < 5; s++) {
            const stepY = 165 + s * 50;
            if (worldPy >= stepY - 14 && worldPy <= stepY + 14) {
              this.seqStep = s;
              this.seqTimer = 0;
              return;
            }
          }
        }

        // Payoff 3 (ERD): entity table selection
        if (currentIdx === 2) {
          // USERS: 765-895, 115-225
          if (worldPx >= 765 && worldPx <= 895 && worldPy >= 115 && worldPy <= 225) {
            this.erdSelectedTable = this.erdSelectedTable === 'users' ? null : 'users';
            return;
          }
          // ORDERS: 915-1045, 115-225
          if (worldPx >= 915 && worldPx <= 1045 && worldPy >= 115 && worldPy <= 225) {
            this.erdSelectedTable = this.erdSelectedTable === 'orders' ? null : 'orders';
            return;
          }
          // PRODUCTS: 765-895, 265-375
          if (worldPx >= 765 && worldPx <= 895 && worldPy >= 265 && worldPy <= 375) {
            this.erdSelectedTable = this.erdSelectedTable === 'products' ? null : 'products';
            return;
          }
          // ORDER_ITEMS: 915-1045, 265-375
          if (worldPx >= 915 && worldPx <= 1045 && worldPy >= 265 && worldPy <= 375) {
            this.erdSelectedTable = this.erdSelectedTable === 'order_items' ? null : 'order_items';
            return;
          }
        }
      }

      // Otherwise, start drag-to-pan across widescreen canvas
      this.isDragging = true;
      this.dragStartX = px;
      this.dragStartCamX = this.camX;
      this.userInteractingTimer = 5.0;
      canvas.style.cursor = 'grabbing';
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!this.isDragging) return;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const dx = (px - this.dragStartX) / this.camZoom;
      const activeW = this.getActiveWorldWidth();
      const maxCamX = Math.max(0, activeW - this.w / this.camZoom);
      this.camTargetX = Math.max(0, Math.min(maxCamX, this.dragStartCamX - dx));
      this.camX = this.camTargetX;
    });

    const endDrag = (e) => {
      if (!this.isDragging) return;
      this.isDragging = false;
      canvas.style.cursor = 'grab';
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    // Resize handling with DPR scaling
    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.w = rect.width || 360;
      this.h = rect.height || 540;
      canvas.width = this.w * dpr;
      canvas.height = this.h * dpr;
      this.ctx.resetTransform?.();
      this.ctx.scale(dpr, dpr);
    };
    resize();
    this.ro = new ResizeObserver(resize);
    this.ro.observe(container);

    // 60 FPS animation loop
    let lastTime = performance.now();
    const loop = (t) => {
      const dt = Math.min(0.04, (t - lastTime) / 1000);
      lastTime = t;
      this.stepSimulation(dt);
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  },

  getCurrentExampleIndex() {
    if (this.example === "1. Duffing Attractor (Math)") return 0;
    if (this.example === "2. Sequence Diagram (Mermaid)") return 1;
    if (this.example === "3. Relational ERD (Schema)") return 2;
    return Math.floor((this.storyTime % this.totalDuration) / this.exampleDuration);
  },

  getLocalTime() {
    if (this.example !== "Auto-Cycle All 3") {
      return this.storyTime % this.exampleDuration;
    }
    return (this.storyTime % this.totalDuration) % this.exampleDuration;
  },

  stepSimulation(dt) {
    const spd = this.params.speed || 1.0;
    this.storyTime += dt * spd;
    const localT = this.getLocalTime();
    const exIdx = this.getCurrentExampleIndex();

    if (this.userInteractingTimer > 0) {
      this.userInteractingTimer -= dt;
    }

    const activeW = this.getActiveWorldWidth();
    const maxCamX = Math.max(0, activeW - this.w / (this.camZoom || 1.0));

    if (this.viewMode === "Overview (All)") {
      this.camTargetX = 0;
      this.camTargetZoom = Math.min(1.0, (this.w - 16) / activeW);
    } else if (this.viewMode === "1. Boring Webpage") {
      this.camTargetX = 0;
      this.camTargetZoom = 1.0;
    } else if (this.viewMode === "2. Agent Loop") {
      this.camTargetX = Math.min(maxCamX, 360);
      this.camTargetZoom = 1.0;
    } else if (this.viewMode === "3. Live Payoff Sim") {
      this.camTargetX = Math.min(maxCamX, 720);
      this.camTargetZoom = 1.0;
    } else {
      // Auto-Tour mode: smoothly glide camera as story unfolds
      this.camTargetZoom = 1.0;
      if (this.userInteractingTimer <= 0) {
        if (localT < 0.25) {
          // New scenario starts: snap immediately to the fresh paper
          this.camX = 0;
          this.camTargetX = 0;
        } else if (localT < 6.4) {
          this.camTargetX = 0;
        } else if (localT < 9.8) {
          this.camTargetX = Math.min(maxCamX, 360);
        } else {
          this.camTargetX = Math.min(maxCamX, 720);
        }
      }
    }

    // Smooth camera damping
    this.camX += (this.camTargetX - this.camX) * Math.min(1.0, dt * 5.0);
    this.camZoom += (this.camTargetZoom - this.camZoom) * Math.min(1.0, dt * 5.0);

    // Payoff 1 (Duffing Attractor) physics integration
    if (exIdx === 0 && localT >= 9.8) {
      const delta = 0.25;
      const gamma = this.params.gamma !== undefined ? this.params.gamma : 0.37;
      const omega = 1.2;
      const substeps = 4;
      const subDt = (dt * spd) / substeps;

      for (let s = 0; s < substeps; s++) {
        const force = this.payoff.x - Math.pow(this.payoff.x, 3) - delta * this.payoff.v + gamma * Math.cos(omega * this.payoff.t);
        this.payoff.v += force * subDt;
        this.payoff.x += this.payoff.v * subDt;
        this.payoff.t += subDt;
      }

      this.payoff.history.push({ x: this.payoff.x, v: this.payoff.v });
      if (this.payoff.history.length > 260) {
        this.payoff.history.shift();
      }
    }

    // Payoff 2 (Sequence Diagram) auto-advance when playing
    if (exIdx === 1 && localT >= 9.8 && this.seqPlaying) {
      this.seqTimer += dt * spd;
      if (this.seqTimer >= 1.6) {
        this.seqTimer = 0;
        this.seqStep = (this.seqStep + 1) % 5;
      }
    }

    // Stream energy packets across pipeline during and after harvest (starts at 6.4s)
    if (localT >= 6.4 && localT < 10.0 && Math.random() < 0.4 * spd) {
      this.streamPackets.push({
        x: 330,
        y: 275,
        progress: 0,
        speed: (0.45 + Math.random() * 0.35) * spd,
        color: exIdx === 0 ? '#38bdf8' : (exIdx === 1 ? '#a855f7' : '#10b981')
      });
    }

    for (let i = this.streamPackets.length - 1; i >= 0; i--) {
      const p = this.streamPackets[i];
      p.progress += dt * p.speed;
      if (p.progress >= 1.0) {
        this.streamPackets.splice(i, 1);
      }
    }
  },

  draw() {
    const { ctx, w, h } = this;
    if (!ctx || !w || !h) return;

    ctx.clearRect(0, 0, w, h);

    // Deep cosmic dark background
    const bgGrad = ctx.createLinearGradient(0, 0, w, h);
    bgGrad.addColorStop(0, '#040714');
    bgGrad.addColorStop(1, '#02040a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    const currentIdx = this.getCurrentExampleIndex();
    const localT = this.getLocalTime();

    // Subtle dissolve at boundary of scenario loop
    let sceneAlpha = 1.0;
    if (localT > 13.6) {
      sceneAlpha = Math.max(0.1, 1.0 - (localT - 13.6) / 0.4);
    } else if (localT < 0.4) {
      sceneAlpha = Math.min(1.0, 0.1 + (localT / 0.4) * 0.9);
    }

    // Apply Virtual Camera Transform
    ctx.save();
    ctx.globalAlpha = sceneAlpha;
    const offsetY = Math.max(0, (h - this.worldH * this.camZoom) / 2);
    ctx.translate(-this.camX * this.camZoom, offsetY);
    ctx.scale(this.camZoom, this.camZoom);

    // Draw panoramic grid & connecting conduits (only across active pages)
    this.drawPanoramicConduits(ctx, currentIdx, localT);

    // PAGE 1: The Paper / Webpage (ALWAYS rendered for active scenario)
    this.drawAct1BoringWebpage(ctx, currentIdx, localT);

    // PAGE 2: The Agent Loop Pipeline (appears on right at t >= 6.4s, Paper STAYS)
    if (localT >= 6.4) {
      const enterP = Math.min(1.0, (localT - 6.4) / 0.45);
      const easeP = 0.5 - 0.5 * Math.cos(Math.PI * enterP);
      ctx.save();
      ctx.globalAlpha = sceneAlpha * easeP;
      const slideX = (1.0 - easeP) * 35;
      ctx.translate(slideX, 0);
      this.drawAct2AgentLoop(ctx, currentIdx, localT);
      ctx.restore();
    }

    // PAGE 3: The Output Payoff Simulation (appears on right at t >= 9.8s, previous TWO STAY)
    if (localT >= 9.8) {
      const enterP = Math.min(1.0, (localT - 9.8) / 0.45);
      const easeP = 0.5 - 0.5 * Math.cos(Math.PI * enterP);
      ctx.save();
      ctx.globalAlpha = sceneAlpha * easeP;
      const slideX = (1.0 - easeP) * 35;
      ctx.translate(slideX, 0);
      this.drawAct3PayoffSimulation(ctx, currentIdx, localT);
      ctx.restore();
    }

    ctx.restore();

    // Draw Screen-Space HUD (pinned to view for immediate feedback)
    this.drawScreenHUD(ctx, currentIdx);
  },

  drawPanoramicConduits(ctx, exIdx, localT) {
    const activeW = this.getActiveWorldWidth();

    // Subtle background circuit grid only across visible pages
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= activeW; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 20);
      ctx.lineTo(x, this.worldH - 20);
      ctx.stroke();
    }

    // Conduits only appear once Agent appears (localT >= 6.4s)
    if (localT < 6.4) return;

    const conduitColor = exIdx === 0 ? 'rgba(56, 189, 248, 0.25)' : (exIdx === 1 ? 'rgba(168, 85, 247, 0.25)' : 'rgba(16, 185, 129, 0.25)');
    ctx.strokeStyle = conduitColor;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(330, 275);
    ctx.bezierCurveTo(360, 275, 370, 160, 420, 160);
    ctx.lineTo(670, 160);

    // Only connect to Act 3 if Output has appeared (localT >= 9.8s)
    if (localT >= 9.8) {
      ctx.bezierCurveTo(710, 160, 720, 275, 750, 275);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw flowing energy packets along conduit
    this.streamPackets.forEach((p) => {
      const t = p.progress;
      let px, py;
      if (t < 0.2) {
        const lt = t / 0.2;
        px = 330 + (420 - 330) * lt;
        py = 275 + (160 - 275) * lt;
      } else if (t < 0.8 || localT < 9.8) {
        const lt = Math.min(1.0, (t - 0.2) / 0.6);
        px = 420 + (670 - 420) * lt;
        py = 160;
      } else {
        const lt = (t - 0.8) / 0.2;
        px = 670 + (750 - 670) * lt;
        py = 160 + (275 - 160) * lt;
      }

      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    });
  },

  drawAct1BoringWebpage(ctx, exIdx, t) {
    // Browser Window Container
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, 20, 40, 320, 450, 12, true, true);

    // Browser Header & URL bar
    ctx.fillStyle = 'rgba(30, 41, 59, 0.8)';
    this.roundRect(ctx, 20, 40, 320, 42, 12, true, false);

    // macOS Style Dots
    ctx.fillStyle = '#ef4444';
    ctx.beginPath(); ctx.arc(36, 61, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath(); ctx.arc(50, 61, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#10b981';
    ctx.beginPath(); ctx.arc(64, 61, 4.5, 0, Math.PI * 2); ctx.fill();

    // URL bar
    ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
    this.roundRect(ctx, 80, 50, 245, 22, 5, true, false);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px ui-monospace, monospace';

    const urlText = exIdx === 0
      ? '🔒 arxiv.org/abs/2403.01892'
      : (exIdx === 1 ? '🔒 docs.auth-service.dev/oauth2' : '🔒 wiki.internal/schema-v3');
    ctx.fillText(urlText, 90, 65);

    // Paper Area Clip
    ctx.save();
    ctx.beginPath();
    ctx.rect(21, 82, 318, 407);
    ctx.clip();

    // Lazy boring scrolling offset
    const scrollY = Math.sin(t * 0.9) * 14 + Math.min(18, t * 3.2);

    // Paper Background
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(21, 82, 318, 407);
    ctx.translate(0, -scrollY);

    if (exIdx === 0) {
      // Example 1: arXiv Math Paper
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 12.5px -apple-system, sans-serif';
      ctx.fillText('Nonlinear Dynamics in Forced Oscillators', 35, 118);

      ctx.fillStyle = '#64748b';
      ctx.font = 'italic 9.5px -apple-system, sans-serif';
      ctx.fillText('A. Poincare, E. Lorenz • Dept. of Dynamical Systems', 35, 134);

      ctx.fillStyle = '#334155';
      ctx.font = 'bold 10px -apple-system, sans-serif';
      ctx.fillText('Abstract & Governing Differential Equation', 35, 156);

      ctx.fillStyle = '#475569';
      ctx.font = '10px -apple-system, sans-serif';
      ctx.fillText('In classical mechanics, the forced bistable oscillator exhibits', 35, 174);
      ctx.fillText('bifurcations leading to chaotic orbits across dual potential wells:', 35, 190);

      // Dense Equation Block
      ctx.fillStyle = '#e2e8f0';
      this.roundRect(ctx, 35, 215, 290, 48, 6, true, false);

      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 13px "Times New Roman", Times, serif';
      ctx.fillText('ẍ + δ ẋ - x + x³ = γ cos(ω t)', 92, 244);

      ctx.fillStyle = '#475569';
      ctx.font = '10px -apple-system, sans-serif';
      ctx.fillText('where δ represents damping, and γ is external driving force.', 35, 282);
      ctx.fillText('Under critical periodic forcing, orbits form strange attractors.', 35, 298);
    } else if (exIdx === 1) {
      // Example 2: Markdown Spec with Raw Mermaid Sequence Diagram
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 12.5px -apple-system, sans-serif';
      ctx.fillText('OAuth2 Token Exchange Specification', 35, 118);

      ctx.fillStyle = '#64748b';
      ctx.font = 'italic 9.5px -apple-system, sans-serif';
      ctx.fillText('RFC 8693 Core Protocol • Architecture Documentation', 35, 134);

      ctx.fillStyle = '#334155';
      ctx.font = 'bold 10px -apple-system, sans-serif';
      ctx.fillText('Protocol Flow (Mermaid Definition)', 35, 156);

      ctx.fillStyle = '#475569';
      ctx.font = '10px -apple-system, sans-serif';
      ctx.fillText('The handshake exchanges authorization code for signed JWT:', 35, 174);

      // Raw Mermaid Code Block
      ctx.fillStyle = '#1e293b';
      this.roundRect(ctx, 35, 195, 290, 96, 6, true, false);

      ctx.fillStyle = '#38bdf8';
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillText(String.fromCharCode(96, 96, 96) + 'mermaid', 45, 210);
      ctx.fillStyle = '#f8fafc';
      ctx.fillText('sequenceDiagram', 45, 224);
      ctx.fillText('  Client->>AuthService: POST /oauth/token', 45, 238);
      ctx.fillText('  AuthService->>UserDB: Query user & roles', 45, 252);
      ctx.fillText('  UserDB-->>AuthService: UserRecord (hash ok)', 45, 266);
      ctx.fillText('  AuthService->>TokenIssuer: Sign JWT (RS256)', 45, 280);

      ctx.fillStyle = '#475569';
      ctx.font = '10px -apple-system, sans-serif';
      ctx.fillText('Client verifies signature via public JWKS endpoint.', 35, 310);
    } else {
      // Example 3: Database Relational Schema Spec
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 12.5px -apple-system, sans-serif';
      ctx.fillText('E-Commerce Relational Data Model', 35, 118);

      ctx.fillStyle = '#64748b';
      ctx.font = 'italic 9.5px -apple-system, sans-serif';
      ctx.fillText('PostgreSQL Database Schema v3.4 • Engineering Wiki', 35, 134);

      ctx.fillStyle = '#334155';
      ctx.font = 'bold 10px -apple-system, sans-serif';
      ctx.fillText('Core Entity Relationships & Foreign Keys', 35, 156);

      ctx.fillStyle = '#475569';
      ctx.font = '10px -apple-system, sans-serif';
      ctx.fillText('Relational schema enforcing customer orders & inventory:', 35, 174);

      // Plain Schema Code Block
      ctx.fillStyle = '#1e293b';
      this.roundRect(ctx, 35, 195, 290, 96, 6, true, false);

      ctx.fillStyle = '#10b981';
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillText('TABLE users (id PK, email, plan_id FK);', 45, 214);
      ctx.fillText('TABLE orders (id PK, user_id FK, total, status);', 45, 232);
      ctx.fillText('TABLE order_items (id PK, order_id FK, product_id FK);', 45, 250);
      ctx.fillText('TABLE products (id PK, sku, price_cents, stock);', 45, 268);

      ctx.fillStyle = '#475569';
      ctx.font = '10px -apple-system, sans-serif';
      ctx.fillText('Foreign keys maintain strict referential integrity.', 35, 310);
    }

    // Highlighting Effect (t >= 3.6s)
    let highlightProgress = 0;
    if (t >= 3.6) {
      highlightProgress = Math.min(1.0, (t - 3.6) / 1.4);
      const hlColor = exIdx === 0
        ? 'rgba(56, 189, 248, 0.3)'
        : (exIdx === 1 ? 'rgba(168, 85, 247, 0.3)' : 'rgba(16, 185, 129, 0.3)');
      const hlBorder = exIdx === 0 ? '#38bdf8' : (exIdx === 1 ? '#a855f7' : '#10b981');

      ctx.fillStyle = hlColor;
      ctx.strokeStyle = hlBorder;
      ctx.lineWidth = 1;

      const hy = exIdx === 0 ? 222 : 202;
      const hh = exIdx === 0 ? 36 : 80;
      const hw = 265 * highlightProgress;
      this.roundRect(ctx, 45, hy, hw, hh, 4, true, true);

      // Shimmering spark particles on highlight
      if (highlightProgress > 0.3) {
        ctx.fillStyle = hlBorder;
        for (let s = 0; s < 4; s++) {
          const sx = 45 + (hw * (0.2 + s * 0.25)) % hw;
          const sy = hy + 6 + Math.sin(t * 8 + s) * 10;
          ctx.beginPath();
          ctx.arc(sx, sy, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    ctx.restore();

    // Mouse Cursor Movement & Context Menu
    let cursorX = 290;
    let cursorY = 380;
    let isClicking = false;

    const targetSnippetY = exIdx === 0 ? 240 : 230;

    if (t < 2.6) {
      cursorX = 290 + Math.sin(t * 1.5) * 8;
      cursorY = 380 + Math.cos(t * 1.5) * 8;
    } else if (t < 3.6) {
      const p = (t - 2.6) / 1.0;
      const easeP = 0.5 - 0.5 * Math.cos(Math.PI * p);
      cursorX = 290 + (45 - 290) * easeP;
      cursorY = 380 + (targetSnippetY - 380) * easeP;
    } else if (t < 5.0) {
      const p = (t - 3.6) / 1.4;
      cursorX = 45 + 265 * p;
      cursorY = targetSnippetY;
      isClicking = true;
    } else if (t < 5.8) {
      cursorX = 210;
      cursorY = targetSnippetY;
    } else if (t < 6.8) {
      const p = Math.min(1.0, (t - 5.8) / 0.6);
      cursorX = 210 + (235 - 210) * p;
      cursorY = targetSnippetY + (318 - targetSnippetY) * p;
      if (t >= 6.4) isClicking = true;
    } else {
      cursorX = 235;
      cursorY = 318;
    }

    // Chrome Dark-Mode Context Menu (t >= 5.2s && t < 7.0s)
    if (t >= 5.2 && t < 7.0) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 8;
      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.lineWidth = 1;
      this.roundRect(ctx, 160, 240, 160, 94, 8, true, true);
      ctx.shadowBlur = 0;

      ctx.fillStyle = '#94a3b8';
      ctx.font = '11px -apple-system, sans-serif';
      ctx.fillText('📋  Copy Selection', 174, 260);
      ctx.fillText('🔍  Search Web', 174, 280);

      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.beginPath(); ctx.moveTo(165, 292); ctx.lineTo(315, 292); ctx.stroke();

      const hoverSimIt = t >= 5.8;
      if (hoverSimIt) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
        this.roundRect(ctx, 165, 298, 150, 28, 5, true, false);
      }
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 12px -apple-system, sans-serif';
      ctx.fillText('✨  SimIt ✦', 174, 317);

      if (t >= 6.4) {
        const rippleP = (t - 6.4) / 0.4;
        ctx.strokeStyle = \`rgba(56, 189, 248, \${1.0 - rippleP})\`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(235, 318, 18 * rippleP, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Draw realistic OS Mouse Cursor
    this.drawCursor(ctx, cursorX, cursorY, isClicking);

    // Section Badge
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 11px -apple-system, sans-serif';
    ctx.fillText('1. Human Highlight & SimIt Click', 30, 30);
  },

  drawAct2AgentLoop(ctx, exIdx, t) {
    // Station Hubs Container
    ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
    ctx.lineWidth = 1;
    this.roundRect(ctx, 370, 40, 340, 450, 12, true, true);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 11px -apple-system, sans-serif';
    ctx.fillText('2. Autonomous Agent Loop Pipeline', 380, 30);

    // Dynamic Station Data based on active scenario
    const stageConfigs = [
      // Ex 1: Duffing Math
      [
        { num: "A", title: "Context Harvester", icon: "🌾", desc: "Harvests: ẍ + δ ẋ - x + x³ = γ cos(ω t)", badge: "Equation + Context", active: t >= 6.8 },
        { num: "B", title: "Archetype Triage", icon: "🧠", desc: "Detected: Parameter Explorer (Phase Space)", badge: "Confidence 98.4%", active: t >= 7.6 },
        { num: "C", title: "Gemini Nano / Gemma", icon: "⚡", desc: "Synthesizing 60 FPS Runge-Kutta module", badge: "410ms • $0.00", active: t >= 8.5 },
        { num: "D", title: "Offscreen Verification", icon: "🧪", desc: "100ms smoke test in sandboxed iframe", badge: "PASS (38ms) ✓", active: t >= 9.4 }
      ],
      // Ex 2: Sequence Mermaid
      [
        { num: "A", title: "Context Harvester", icon: "🌾", desc: "Harvests raw sequenceDiagram syntax", badge: "Mermaid AST Scope", active: t >= 6.8 },
        { num: "B", title: "Archetype Triage", icon: "🧠", desc: "Detected: Step Scrubber / Sequence Flow", badge: "Confidence 99.1%", active: t >= 7.6 },
        { num: "C", title: "Gemini Nano / Gemma", icon: "⚡", desc: "Synthesizing reactive SVG timeline & lifelines", badge: "430ms • $0.00", active: t >= 8.5 },
        { num: "D", title: "Offscreen Verification", icon: "🧪", desc: "100ms smoke test in sandboxed iframe", badge: "PASS (41ms) ✓", active: t >= 9.4 }
      ],
      // Ex 3: Relational ERD
      [
        { num: "A", title: "Context Harvester", icon: "🌾", desc: "Harvests schema tables, PKs and FKs", badge: "Relational Scope", active: t >= 6.8 },
        { num: "B", title: "Archetype Triage", icon: "🧠", desc: "Detected: Interactive Graph / ERD Diagram", badge: "Confidence 97.8%", active: t >= 7.6 },
        { num: "C", title: "Gemini Nano / Gemma", icon: "⚡", desc: "Synthesizing Cytoscape/force relational graph", badge: "440ms • $0.00", active: t >= 8.5 },
        { num: "D", title: "Offscreen Verification", icon: "🧪", desc: "100ms smoke test in sandboxed iframe", badge: "PASS (35ms) ✓", active: t >= 9.4 }
      ]
    ];

    const stages = stageConfigs[exIdx] || stageConfigs[0];

    stages.forEach((st, i) => {
      const cy = 60 + i * 102;
      const isActive = st.active;

      ctx.fillStyle = isActive ? 'rgba(56, 189, 248, 0.12)' : 'rgba(15, 23, 42, 0.85)';
      ctx.strokeStyle = isActive ? '#38bdf8' : 'rgba(56, 189, 248, 0.15)';
      ctx.lineWidth = isActive ? 1.5 : 1;
      this.roundRect(ctx, 385, cy, 310, 86, 8, true, true);

      // Icon box
      ctx.fillStyle = isActive ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255, 255, 255, 0.05)';
      this.roundRect(ctx, 397, cy + 14, 38, 38, 6, true, false);
      ctx.font = '18px -apple-system';
      ctx.fillText(st.icon, 407, cy + 39);

      // Title & Stage
      ctx.fillStyle = isActive ? '#f8fafc' : '#94a3b8';
      ctx.font = 'bold 12px -apple-system, sans-serif';
      ctx.fillText(\`\${st.num}. \${st.title}\`, 445, cy + 28);

      // Badge
      ctx.fillStyle = isActive ? '#38bdf8' : '#64748b';
      ctx.font = '9.5px ui-monospace, monospace';
      ctx.fillText(st.badge, 445, cy + 45);

      // Description
      ctx.fillStyle = '#64748b';
      ctx.font = '10px -apple-system, sans-serif';
      ctx.fillText(st.desc, 445, cy + 64);

      // Active pulse dot
      if (isActive) {
        ctx.fillStyle = '#38bdf8';
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(678, cy + 26, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    });
  },

  drawAct3PayoffSimulation(ctx, exIdx, t) {
    // Simulated Side Panel Frame
    ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, 740, 40, 320, 450, 12, true, true);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 11px -apple-system, sans-serif';
    ctx.fillText('3. Live Interactive Payoff in SimIt', 750, 30);

    // Materialization shockwave when live triggers at 9.8s
    if (t < 10.5) {
      const shockP = (t - 9.8) / 0.7;
      ctx.strokeStyle = 'rgba(56, 189, 248, ' + (1.0 - shockP) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(750, 275, 280 * shockP, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Render active Payoff Simulation based on current scenario
    if (exIdx === 0) {
      this.drawPayoffDuffing(ctx);
    } else if (exIdx === 1) {
      this.drawPayoffSequence(ctx);
    } else {
      this.drawPayoffERD(ctx);
    }
  },

  drawPayoffDuffing(ctx) {
    // Header
    ctx.fillStyle = 'rgba(30, 41, 59, 0.8)';
    this.roundRect(ctx, 740, 40, 320, 52, 12, true, false);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 12.5px -apple-system, sans-serif';
    ctx.fillText('Duffing Chaotic Attractor', 758, 64);

    ctx.fillStyle = '#38bdf8';
    ctx.font = '9.5px ui-monospace, monospace';
    ctx.fillText('✦ SimIt Generated • 60 FPS • 0ms Reactivity', 758, 80);

    const boxX = 755;
    const boxY = 100;
    const boxW = 290;
    const boxH = 220;

    ctx.fillStyle = '#060a17';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
    this.roundRect(ctx, boxX, boxY, boxW, boxH, 8, true, true);

    const midX = boxX + boxW / 2;
    const midY = boxY + boxH / 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(boxX + 10, midY); ctx.lineTo(boxX + boxW - 10, midY);
    ctx.moveTo(midX, boxY + 10); ctx.lineTo(midX, boxY + boxH - 10);
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillText('x (position)', boxX + boxW - 65, midY - 6);
    ctx.fillText('ẋ (velocity)', midX + 6, boxY + 20);

    // Orbit trail
    const hist = this.payoff.history;
    if (hist.length > 2) {
      ctx.lineWidth = 1.5;
      for (let i = 1; i < hist.length; i++) {
        const p1 = hist[i - 1];
        const p2 = hist[i];
        const alpha = (i / hist.length);
        const sx1 = midX + (p1.x / 2.4) * (boxW / 2 - 20);
        const sy1 = midY - (p1.v / 2.5) * (boxH / 2 - 20);
        const sx2 = midX + (p2.x / 2.4) * (boxW / 2 - 20);
        const sy2 = midY - (p2.v / 2.5) * (boxH / 2 - 20);

        ctx.strokeStyle = i % 2 === 0 ? \`rgba(56, 189, 248, \${alpha * 0.8})\` : \`rgba(244, 63, 94, \${alpha * 0.8})\`;
        ctx.beginPath();
        ctx.moveTo(sx1, sy1);
        ctx.lineTo(sx2, sy2);
        ctx.stroke();
      }
    }

    // Current State Point
    const curPx = midX + (this.payoff.x / 2.4) * (boxW / 2 - 20);
    const curPy = midY - (this.payoff.v / 2.5) * (boxH / 2 - 20);

    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(curPx, curPy, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Potential Well Plot
    const wellBoxY = 330;
    const wellBoxH = 85;
    ctx.fillStyle = 'rgba(6, 10, 23, 0.8)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
    this.roundRect(ctx, boxX, wellBoxY, boxW, wellBoxH, 8, true, true);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '9.5px -apple-system, sans-serif';
    ctx.fillText('Bistable Dual Potential Wells V(x)', boxX + 10, wellBoxY + 16);

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let px = 0; px <= boxW - 20; px += 4) {
      const vx = ((px / (boxW - 20)) - 0.5) * 3.8;
      const vy = 0.25 * Math.pow(vx, 4) - 0.5 * Math.pow(vx, 2);
      const sy = (wellBoxY + wellBoxH - 15) - (vy + 0.3) * 55;
      if (px === 0) ctx.moveTo(boxX + 10 + px, sy);
      else ctx.lineTo(boxX + 10 + px, sy);
    }
    ctx.stroke();

    // Mass Ball
    const massPx = boxX + 10 + ((this.payoff.x / 3.8) + 0.5) * (boxW - 20);
    const massVx = Math.max(-1.8, Math.min(1.8, this.payoff.x));
    const massVy = 0.25 * Math.pow(massVx, 4) - 0.5 * Math.pow(massVx, 2);
    const massPy = (wellBoxY + wellBoxH - 15) - (massVy + 0.3) * 55;

    ctx.fillStyle = '#f43f5e';
    ctx.shadowColor = '#f43f5e';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(massPx, massPy - 5, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Interactive Hint
    ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
    this.roundRect(ctx, boxX, 425, boxW, 50, 6, true, false);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 10px -apple-system, sans-serif';
    ctx.fillText('👆 Click & drag inside phase portrait to perturb state!', boxX + 12, 444);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '9.5px -apple-system, sans-serif';
    ctx.fillText('Adjust Driving Force (γ) in controls to morph chaotic regime.', boxX + 12, 462);
  },

  drawPayoffSequence(ctx) {
    // Header
    ctx.fillStyle = 'rgba(30, 41, 59, 0.8)';
    this.roundRect(ctx, 740, 40, 320, 52, 12, true, false);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 12.5px -apple-system, sans-serif';
    ctx.fillText('Interactive Sequence Flow', 758, 64);

    ctx.fillStyle = '#a855f7';
    ctx.font = '9.5px ui-monospace, monospace';
    ctx.fillText('✦ Step Scrubber • Live Reactive Animation', 758, 80);

    const boxX = 755;
    const boxY = 100;
    const boxW = 290;
    const boxH = 315;

    ctx.fillStyle = '#060a17';
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.25)';
    this.roundRect(ctx, boxX, boxY, boxW, boxH, 8, true, true);

    // 4 Lifelines
    const lifelines = [
      { name: "Client", x: 780, color: "#38bdf8" },
      { name: "AuthSvc", x: 845, color: "#a855f7" },
      { name: "UserDB", x: 910, color: "#10b981" },
      { name: "Token", x: 975, color: "#f59e0b" }
    ];

    lifelines.forEach((ll) => {
      // Header box
      ctx.fillStyle = 'rgba(30, 41, 59, 0.9)';
      ctx.strokeStyle = ll.color;
      ctx.lineWidth = 1;
      this.roundRect(ctx, ll.x - 24, boxY + 10, 48, 22, 4, true, true);

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 9.5px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(ll.name, ll.x, boxY + 25);
      ctx.textAlign = 'start';

      // Vertical lifeline
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(ll.x, boxY + 34);
      ctx.lineTo(ll.x, boxY + boxH - 12);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // 5 Sequence Steps
    const steps = [
      { from: 780, to: 845, y: 155, label: "1. POST /oauth/token", desc: "Credentials exchange" },
      { from: 845, to: 910, y: 205, label: "2. Query user & roles", desc: "SQL hash lookup" },
      { from: 910, to: 845, y: 255, label: "3. UserRecord ok", desc: "200 valid record" },
      { from: 845, to: 975, y: 305, label: "4. Sign JWT (RS256)", desc: "Private key signing" },
      { from: 975, to: 780, y: 355, label: "5. 200 OK { token }", desc: "JWT + refresh returned" }
    ];

    steps.forEach((st, idx) => {
      const isCurrent = this.seqStep === idx;
      ctx.strokeStyle = isCurrent ? '#a855f7' : 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = isCurrent ? 2 : 1;

      // Draw horizontal arrow
      ctx.beginPath();
      ctx.moveTo(st.from, st.y);
      ctx.lineTo(st.to, st.y);
      ctx.stroke();

      // Arrowhead
      const dir = st.to > st.from ? 1 : -1;
      ctx.fillStyle = isCurrent ? '#a855f7' : 'rgba(255, 255, 255, 0.3)';
      ctx.beginPath();
      ctx.moveTo(st.to, st.y);
      ctx.lineTo(st.to - dir * 6, st.y - 3.5);
      ctx.lineTo(st.to - dir * 6, st.y + 3.5);
      ctx.closePath();
      ctx.fill();

      // Step text
      ctx.fillStyle = isCurrent ? '#f8fafc' : '#64748b';
      ctx.font = isCurrent ? 'bold 9.5px -apple-system, sans-serif' : '8.5px -apple-system, sans-serif';
      const labelX = Math.min(st.from, st.to) + Math.abs(st.to - st.from) / 2;
      ctx.textAlign = 'center';
      ctx.fillText(st.label, labelX, st.y - 6);
      ctx.textAlign = 'start';

      // Animated flowing packet along current arrow
      if (isCurrent) {
        const progress = (this.seqTimer % 1.6) / 1.6;
        const curPx = st.from + (st.to - st.from) * progress;

        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#a855f7';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(curPx, st.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    });

    // Step Scrubber Controls Bar (Interactive)
    const ctrlY = 425;
    ctx.fillStyle = 'rgba(30, 41, 59, 0.85)';
    this.roundRect(ctx, boxX, ctrlY, boxW, 50, 6, true, false);

    // Prev Button: 765-825
    ctx.fillStyle = 'rgba(168, 85, 247, 0.2)';
    this.roundRect(ctx, boxX + 8, ctrlY + 12, 60, 26, 4, true, false);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 10px -apple-system, sans-serif';
    ctx.fillText('⏪ Prev', boxX + 18, ctrlY + 28);

    // Next Button: 835-895
    ctx.fillStyle = 'rgba(168, 85, 247, 0.2)';
    this.roundRect(ctx, boxX + 76, ctrlY + 12, 60, 26, 4, true, false);
    ctx.fillStyle = '#f8fafc';
    ctx.fillText('Next ⏩', boxX + 86, ctrlY + 28);

    // Play/Pause Button
    ctx.fillStyle = this.seqPlaying ? 'rgba(16, 185, 129, 0.25)' : 'rgba(244, 63, 94, 0.25)';
    this.roundRect(ctx, boxX + 144, ctrlY + 12, 60, 26, 4, true, false);
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(this.seqPlaying ? '⏸ Pause' : '▶ Play', boxX + 154, ctrlY + 28);

    // Step Status Badge
    ctx.fillStyle = '#a855f7';
    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.fillText(\`Step \${this.seqStep + 1} of 5\`, boxX + 215, ctrlY + 28);
  },

  drawPayoffERD(ctx) {
    // Header
    ctx.fillStyle = 'rgba(30, 41, 59, 0.8)';
    this.roundRect(ctx, 740, 40, 320, 52, 12, true, false);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 12.5px -apple-system, sans-serif';
    ctx.fillText('Interactive Relational ERD', 758, 64);

    ctx.fillStyle = '#10b981';
    ctx.font = '9.5px ui-monospace, monospace';
    ctx.fillText('✦ Relational Graph • Foreign Key Navigation', 758, 80);

    const boxX = 755;
    const boxY = 100;
    const boxW = 290;
    const boxH = 315;

    ctx.fillStyle = '#060a17';
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.25)';
    this.roundRect(ctx, boxX, boxY, boxW, boxH, 8, true, true);

    // 4 Entity Tables
    const tables = [
      { id: 'users', title: 'users', x: 765, y: 115, w: 125, h: 105, color: '#38bdf8', cols: ['🔑 id (UUID)', 'email (text)', 'created_at'] },
      { id: 'orders', title: 'orders', x: 905, y: 115, w: 130, h: 105, color: '#a855f7', cols: ['🔑 id (UUID)', '🔗 user_id (FK)', 'total_cents', 'status'] },
      { id: 'products', title: 'products', x: 765, y: 245, w: 125, h: 105, color: '#10b981', cols: ['🔑 id (UUID)', 'sku (text)', 'price_cents', 'stock'] },
      { id: 'order_items', title: 'order_items', x: 905, y: 245, w: 130, h: 105, color: '#f59e0b', cols: ['🔑 id (UUID)', '🔗 order_id (FK)', '🔗 product_id (FK)', 'quantity'] }
    ];

    // Connectors with 1:N cardinality
    const rels = [
      { fromX: 890, fromY: 155, toX: 905, toY: 155, label: "1:N" },
      { fromX: 970, fromY: 220, toX: 970, toY: 245, label: "1:N" },
      { fromX: 890, fromY: 295, toX: 905, toY: 295, label: "1:N" }
    ];

    rels.forEach((rel) => {
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(rel.fromX, rel.fromY);
      ctx.lineTo(rel.toX, rel.toY);
      ctx.stroke();

      // Cardinality Tag
      ctx.fillStyle = '#10b981';
      ctx.font = '8px ui-monospace, monospace';
      ctx.fillText(rel.label, (rel.fromX + rel.toX) / 2 - 6, (rel.fromY + rel.toY) / 2 - 4);
    });

    // Render Entity Tables
    tables.forEach((tb) => {
      const isSelected = this.erdSelectedTable === tb.id;
      ctx.fillStyle = isSelected ? 'rgba(30, 41, 59, 0.95)' : 'rgba(15, 23, 42, 0.9)';
      ctx.strokeStyle = isSelected ? '#10b981' : 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = isSelected ? 2 : 1;
      this.roundRect(ctx, tb.x, tb.y, tb.w, tb.h, 6, true, true);

      // Table Header
      ctx.fillStyle = tb.color;
      this.roundRect(ctx, tb.x, tb.y, tb.w, 20, 6, true, false);
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 10px ui-monospace, monospace';
      ctx.fillText(tb.title, tb.x + 8, tb.y + 14);

      // Columns
      tb.cols.forEach((col, cIdx) => {
        ctx.fillStyle = col.includes('🔑') ? '#f59e0b' : (col.includes('🔗') ? '#38bdf8' : '#94a3b8');
        ctx.font = '9px ui-monospace, monospace';
        ctx.fillText(col, tb.x + 6, tb.y + 36 + cIdx * 16);
      });
    });

    // Bottom interactive tip
    ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
    this.roundRect(ctx, boxX, 425, boxW, 50, 6, true, false);

    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 10px -apple-system, sans-serif';
    ctx.fillText('👆 Click any table to inspect relations & foreign keys!', boxX + 12, 444);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '9.5px -apple-system, sans-serif';
    const selText = this.erdSelectedTable ? \`Selected: \${this.erdSelectedTable.toUpperCase()} (highlighting relations)\` : 'Click tables to navigate schema graph.';
    ctx.fillText(selText, boxX + 12, 462);
  },

  drawCursor(ctx, x, y, isClicking) {
    ctx.save();
    ctx.translate(x, y);
    if (isClicking) {
      ctx.scale(0.9, 0.9);
    }
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 3;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 18);
    ctx.lineTo(4.5, 14);
    ctx.lineTo(9, 23);
    ctx.lineTo(12, 21.5);
    ctx.lineTo(7.5, 12.5);
    ctx.lineTo(13.5, 12.5);
    ctx.closePath();

    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  },

  drawScreenHUD(ctx, exIdx) {
    const { w, h } = this;

    // Top Guidance Banner (Fixed Screen Coordinates)
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.3)';
    ctx.lineWidth = 1;
    this.roundRect(ctx, 10, 8, w - 20, 24, 6, true, true);
    ctx.shadowBlur = 0;

    const exTitles = ["1/3: Duffing Attractor", "2/3: Mermaid Sequence", "3/3: Relational ERD"];
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 9.5px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(\`✦ Scenario \${exTitles[exIdx]}\`, 18, 24);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px -apple-system, BlinkMacSystemFont, sans-serif';
    const localT = this.getLocalTime();
    let stepHint = '1. Reading Paper';
    if (localT >= 9.8) stepHint = '3. Live Output Active';
    else if (localT >= 6.4) stepHint = '2. Agent Synthesizing...';
    ctx.fillText(stepHint, w > 360 ? 195 : 160, 24);
    ctx.restore();

    // Bottom Chapter Nav Pills (Fixed Screen Coordinates)
    const pillY = h - 38;
    const pillW = Math.min(78, (w - 30) / 4);
    const startX = 12;
    const chapters = [
      { label: "1. Paper", mode: "1. Boring Webpage", unlocked: true },
      { label: "2. Agent", mode: "2. Agent Loop", unlocked: localT >= 6.4 },
      { label: "3. Output", mode: "3. Live Payoff Sim", unlocked: localT >= 9.8 },
      { label: "👁 Overview", mode: "Overview (All)", unlocked: true }
    ];

    chapters.forEach((ch, i) => {
      const bx = startX + i * (pillW + 4);
      const isSelected = this.viewMode === ch.mode;

      if (isSelected) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.5;
      } else if (ch.unlocked) {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
        ctx.lineWidth = 1;
      } else {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.4)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.lineWidth = 1;
      }
      this.roundRect(ctx, bx, pillY, pillW, 24, 5, true, true);

      ctx.fillStyle = isSelected ? '#ffffff' : (ch.unlocked ? '#94a3b8' : '#475569');
      ctx.font = isSelected ? 'bold 9px -apple-system, sans-serif' : '8.5px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(ch.label, bx + pillW / 2, pillY + 16);
      ctx.textAlign = 'start';
    });
  },

  roundRect(ctx, x, y, width, height, radius, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  },

  update(newParams) {
    if (newParams.resetJourney) {
      this.storyTime = 0;
      this.userInteractingTimer = 0;
      this.viewMode = "Auto-Tour";
    }
    if (newParams.example !== undefined) {
      this.example = newParams.example;
      this.storyTime = 0;
      this.userInteractingTimer = 0;
    }
    if (newParams.viewMode !== undefined) {
      this.viewMode = newParams.viewMode;
      this.userInteractingTimer = 6.0;
    }
    this.params = { ...this.params, ...newParams };
  },

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
  }
};`;

let progressHideTimeout: any = null;

/**
 * Updates the smooth morphing pipeline status capsule beneath the chat box
 */
export function setMorphingProgress(
  step: 1 | 2 | 3 | 4,
  title: string,
  detail: string = '',
  stageName: 'think' | 'code' | 'test' | 'load' | 'ready' | 'error' = 'think',
  autoHideMs?: number
) {
  if (progressHideTimeout) {
    clearTimeout(progressHideTimeout);
    progressHideTimeout = null;
  }

  const capsule = document.getElementById('status-pipeline-capsule');
  const stageText = document.getElementById('pipeline-stage-text');
  const stageDetail = document.getElementById('pipeline-stage-detail');

  if (refinementStatus) {
    refinementStatus.style.display = 'block';
  }

  if (capsule) {
    capsule.setAttribute('data-stage', stageName);
  }

  if (stageText) {
    stageText.textContent = title;
    stageText.classList.remove('morph-in');
    void stageText.offsetWidth; // Force reflow for smooth re-trigger
    stageText.classList.add('morph-in');
  }

  if (stageDetail) {
    stageDetail.textContent = detail;
    stageDetail.classList.remove('morph-in');
    void stageDetail.offsetWidth;
    stageDetail.classList.add('morph-in');
  }

  // Update step dots (1: Think, 2: Code, 3: Test, 4: Mount/Ready)
  for (let s = 1; s <= 4; s++) {
    const dot = document.getElementById(`step-dot-${s}`);
    const conn = document.getElementById(`step-conn-${s}`);

    if (dot) {
      dot.className = 'step-dot';
      if (stageName === 'ready') {
        dot.classList.add('completed');
        if (s === 4) dot.classList.add('active');
      } else if (s < step) {
        dot.classList.add('completed');
      } else if (s === step) {
        dot.classList.add('active');
      }
    }

    if (conn) {
      conn.className = 'step-connector';
      if (s < step || stageName === 'ready') {
        conn.classList.add('active');
      }
    }
  }

  if (autoHideMs && autoHideMs > 0) {
    progressHideTimeout = setTimeout(() => {
      if (refinementStatus && stageName === 'ready') {
        refinementStatus.style.display = 'none';
      }
    }, autoHideMs);
  }
}

export interface VersionItem {
  id: string;
  versionIndex: number;
  versionLabel: string;
  code: string;
  parameters: ParameterDefinition[];
  parameterState: ParameterState;
}

// Active Session Cache
let activeSessionId: string = '';
let activeVersionIndex: number = 1;
let currentVersions: VersionItem[] = [];
let currentEvolutionChips: EvolutionChip[] = [];
let activeCode: string = '';
let activeParameters: ParameterDefinition[] = [];
let currentParamsState: ParameterState = {};
let lastRuntimeError: { message: string; stack?: string } | null = null;
let currentAtifTrajectory: AtifTrajectory | null = null;
let currentByokSettings: BYOKStorageSettings = DEFAULT_BYOK_SETTINGS;
let activeRoutingDecision: RoutingDecision | null = null;

function setViewState(view: 'empty' | 'loading' | 'simulation' | 'error') {
  stateEmpty.style.display = view === 'empty' ? 'flex' : 'none';
  stateLoading.style.display = view === 'loading' ? 'flex' : 'none';
  stateSimulation.style.display = view === 'simulation' ? 'flex' : 'none';
  stateError.style.display = view === 'error' ? 'flex' : 'none';
}

function setStatusPill(status: 'Ready' | 'Synthesizing' | 'Verifying' | 'Active' | 'Error' | 'Repairing') {
  statusPill.textContent = status;
  statusPill.className = 'status-pill';
  if (status === 'Ready') statusPill.classList.add('status-ready');
  if (status === 'Synthesizing' || status === 'Repairing' || status === 'Verifying') statusPill.classList.add('status-loading');
  if (status === 'Active') statusPill.classList.add('status-active');
  if (status === 'Error') statusPill.classList.add('status-error');
}

let isSandboxReady = false;
let pendingInitMessage: SandboxInitSimulationMessage | null = null;

/**
 * Initializes simulation in sandboxed iframe
 */
export function initSimulationInIframe(code: string, initialParams?: ParameterState) {
  activeCode = code;
  btnRepair.style.display = 'none';
  lastRuntimeError = null;

  setViewState('simulation');
  if (code === WELCOME_SIMULATION_CODE) {
    setStatusPill('Ready');
  } else {
    setStatusPill('Active');
  }

  const msg: SandboxInitSimulationMessage = {
    type: 'SANDBOX_INIT_SIMULATION',
    code,
    initialParams
  };

  if (!isSandboxReady) {
    pendingInitMessage = msg;
    if (sandboxIframe && sandboxIframe.contentWindow) {
      try {
        sandboxIframe.contentWindow.postMessage(msg, '*');
      } catch {}
    }
    return;
  }

  if (sandboxIframe && sandboxIframe.contentWindow) {
    sandboxIframe.contentWindow.postMessage(msg, '*');
  }
}

/**
 * Renders parameter controls dock based on parameter schema
 */
export function renderControlsDock(parameters: ParameterDefinition[], initialParams: ParameterState) {
  activeParameters = parameters;
  currentParamsState = { ...initialParams };
  controlsList.innerHTML = '';

  const dock = document.getElementById('controls-dock');
  if (activeCode === WELCOME_SIMULATION_CODE || !parameters || parameters.length === 0) {
    if (dock) dock.style.display = 'none';
    controlsList.innerHTML = '';
    return;
  }
  if (dock) dock.style.display = '';

  parameters.forEach((param) => {
    const row = document.createElement('div');
    row.className = 'control-row';

    const currentVal = currentParamsState[param.id] !== undefined ? currentParamsState[param.id] : (param.default ?? false);
    currentParamsState[param.id] = currentVal;

    if (param.type === 'slider' || param.type === 'stepper') {
      const minVal = param.min !== undefined ? param.min : 0;
      const maxVal = param.max !== undefined ? param.max : 100;
      const stepVal = param.step !== undefined ? param.step : 1;

      row.innerHTML = `
        <div class="control-row-header">
          <span class="control-label">${escapeHtml(param.label)}</span>
          <span class="control-val" id="val-${param.id}">${currentVal} ${param.unit || ''}</span>
        </div>
        <input type="range" id="input-${param.id}" min="${minVal}" max="${maxVal}" step="${stepVal}" value="${currentVal}" />
        <div class="control-bounds-row">
          <span class="bound-tag bound-min" id="min-${param.id}" title="Click to edit min bound">${minVal}</span>
          <span class="bound-tag bound-max" id="max-${param.id}" title="Click to edit max bound">${maxVal}</span>
        </div>
      `;
      controlsList.appendChild(row);

      const input = row.querySelector(`#input-${param.id}`) as HTMLInputElement;
      input.addEventListener('input', (e) => {
        const num = parseFloat((e.target as HTMLInputElement).value);
        const val = isNaN(num) ? (e.target as HTMLInputElement).value : num;
        updateParameterValue(param.id, val, param.unit);
      });

      const attachBoundEditor = (tagId: string, isMin: boolean) => {
        const tag = row.querySelector(`#${tagId}`) as HTMLElement;
        if (!tag) return;
        tag.addEventListener('click', () => {
          if (tag.querySelector('input')) return;
          const currentBound = isMin ? input.min : input.max;
          const editInput = document.createElement('input');
          editInput.type = 'number';
          editInput.className = 'bound-edit-input';
          editInput.step = 'any';
          editInput.value = currentBound;
          tag.textContent = '';
          tag.appendChild(editInput);
          editInput.focus();
          editInput.select();

          let isCancelled = false;
          const commit = () => {
            if (isCancelled) return;
            const val = parseFloat(editInput.value);
            if (!isNaN(val)) {
              if (isMin && val < parseFloat(input.max)) {
                input.min = String(val);
                param.min = val;
                tag.textContent = String(val);
                return;
              } else if (!isMin && val > parseFloat(input.min)) {
                input.max = String(val);
                param.max = val;
                tag.textContent = String(val);
                return;
              }
            }
            tag.textContent = currentBound;
          };

          editInput.addEventListener('blur', commit);
          editInput.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') editInput.blur();
            if (ev.key === 'Escape') {
              isCancelled = true;
              tag.textContent = currentBound;
            }
          });
        });
      };

      attachBoundEditor(`min-${param.id}`, true);
      attachBoundEditor(`max-${param.id}`, false);
    } else if (param.type === 'toggle') {
      row.className = 'control-row toggle-row';
      row.innerHTML = `
        <span class="control-label">${escapeHtml(param.label)}</span>
        <input type="checkbox" id="input-${param.id}" ${currentVal ? 'checked' : ''} />
      `;
      controlsList.appendChild(row);

      const input = row.querySelector(`#input-${param.id}`) as HTMLInputElement;
      input.addEventListener('change', (e) => {
        updateParameterValue(param.id, (e.target as HTMLInputElement).checked);
      });
    } else if (param.type === 'select') {
      row.innerHTML = `
        <div class="control-row-header">
          <span class="control-label">${escapeHtml(param.label)}</span>
        </div>
        <select id="input-${param.id}">
          ${(param.options || []).map((opt) => `<option value="${opt}" ${opt === currentVal ? 'selected' : ''}>${opt}</option>`).join('')}
        </select>
      `;
      controlsList.appendChild(row);

      const select = row.querySelector(`#input-${param.id}`) as HTMLSelectElement;
      select.addEventListener('change', (e) => {
        updateParameterValue(param.id, (e.target as HTMLSelectElement).value);
      });
    } else if (param.type === 'button' || (param as any).type === 'action') {
      row.className = 'control-row button-row';
      row.innerHTML = `
        <button class="btn-control-action" id="btn-param-${param.id}" type="button">
          ${escapeHtml(param.label || param.id)}
        </button>
      `;
      controlsList.appendChild(row);

      const btn = row.querySelector(`#btn-param-${param.id}`) as HTMLButtonElement;
      btn.addEventListener('click', () => {
        const updateMsg: SandboxUpdateParametersMessage = {
          type: 'SANDBOX_UPDATE_PARAMETERS',
          params: { [param.id]: true }
        };
        if (sandboxIframe.contentWindow) {
          sandboxIframe.contentWindow.postMessage(updateMsg, '*');
        }
      });
    }
  });
}

function updateParameterValue(id: string, val: any, unit?: string) {
  currentParamsState[id] = val;
  const valElem = document.getElementById(`val-${id}`);
  if (valElem) {
    valElem.textContent = `${val} ${unit || ''}`;
  }

  const updateMsg: SandboxUpdateParametersMessage = {
    type: 'SANDBOX_UPDATE_PARAMETERS',
    params: { [id]: val }
  };

  if (sandboxIframe.contentWindow) {
    sandboxIframe.contentWindow.postMessage(updateMsg, '*');
  }
}

// Reset parameters button
btnResetParams?.addEventListener('click', () => {
  const defaultParams: ParameterState = {};
  activeParameters.forEach((p) => {
    if (p.default !== undefined) {
      defaultParams[p.id] = p.default;
    }
  });
  renderControlsDock(activeParameters, defaultParams);
  if (sandboxIframe.contentWindow) {
    sandboxIframe.contentWindow.postMessage({
      type: 'SANDBOX_UPDATE_PARAMETERS',
      params: defaultParams
    } as SandboxUpdateParametersMessage, '*');
  }
});

// Auto-appearing Repair Icon click handler
btnRepair?.addEventListener('click', () => {
  if (!lastRuntimeError) return;

  setStatusPill('Repairing');
  btnRepair.style.display = 'none';

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({
      type: 'REPAIR_INTERACTIVE_SIM',
      code: activeCode,
      errorMessage: lastRuntimeError.message,
      stack: lastRuntimeError.stack,
      currentParams: currentParamsState
    }, (response) => {
      if (response && response.status === 'ok' && response.repairedCode) {
        initSimulationInIframe(response.repairedCode, currentParamsState);
      } else {
        setStatusPill('Error');
        alert(`Interactive repair failed: ${response?.errorMessage || 'Unknown error'}`);
      }
    });
  }
});

// Listen for postMessage from Sandboxed iframe
window.addEventListener('message', (event) => {
  const data = event.data as any;
  if (!data || !data.type) return;

  if (data.type === 'SANDBOX_READY') {
    isSandboxReady = true;
    if (pendingInitMessage && sandboxIframe && sandboxIframe.contentWindow) {
      sandboxIframe.contentWindow.postMessage(pendingInitMessage, '*');
      pendingInitMessage = null;
    } else if (!activeCode || activeCode === WELCOME_SIMULATION_CODE) {
      initSimulationInIframe(WELCOME_SIMULATION_CODE);
    }
    return;
  }

  if (data.type === 'SANDBOX_SIMULATION_READY') {
    simTitle.textContent = data.title;
    simDesc.textContent = data.description;
    renderControlsDock(data.parameters, currentParamsState);
    if (activeCode === WELCOME_SIMULATION_CODE) {
      setStatusPill('Ready');
    }
  } else if (data.type === 'SANDBOX_PARAMETERS_CHANGED') {
    if (data.params) {
      currentParamsState = { ...currentParamsState, ...data.params };
    }
  } else if (data.type === 'SANDBOX_RUNTIME_ERROR') {
    lastRuntimeError = {
      message: data.message,
      stack: data.stack
    };
    if (data.currentParams) {
      currentParamsState = { ...currentParamsState, ...data.currentParams };
    }
    // Reveal auto-appearing Repair Icon
    btnRepair.style.display = 'inline-flex';
  }
});

sandboxIframe?.addEventListener('load', () => {
  setTimeout(() => {
    isSandboxReady = true;
    if (pendingInitMessage && sandboxIframe && sandboxIframe.contentWindow) {
      sandboxIframe.contentWindow.postMessage(pendingInitMessage, '*');
      pendingInitMessage = null;
    } else if (!activeCode || activeCode === WELCOME_SIMULATION_CODE) {
      initSimulationInIframe(WELCOME_SIMULATION_CODE);
    }
  }, 60);
});

// Listen for chrome.runtime messages from background service worker
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
    if (!message || !message.type) return;

    switch (message.type) {
      case 'GENERATION_PROGRESS':
        if (message.payload) {
          const { step, title, detail, stageName } = message.payload;
          setMorphingProgress(step, title, detail, stageName, stageName === 'ready' ? 5000 : undefined);
          if (stageName === 'think' || stageName === 'code') setStatusPill('Synthesizing');
          if (stageName === 'test') setStatusPill('Verifying');
          if (stageName === 'load' || stageName === 'ready') setStatusPill('Active');
          if (stageName === 'error') setStatusPill('Error');
        }
        break;

      case 'SIMULATION_LOADING':
        setMorphingProgress(1, message.title || 'Harvesting Context...', message.description || '', 'think');
        setStatusPill('Synthesizing');
        loadingTitle.textContent = message.title || 'Synthesizing Simulation...';
        loadingDesc.textContent = message.description || 'Ingesting technical context.';

        const liveStreamBox = document.getElementById('live-stream-box');
        const liveStreamCode = document.getElementById('live-stream-code');
        if (message.codePreview !== undefined) {
          activeCode = message.codePreview;
          if (liveStreamBox) {
            liveStreamBox.style.display = message.codePreview.length > 0 ? 'block' : 'none';
          }
          if (liveStreamCode) {
            liveStreamCode.textContent = message.codePreview;
            liveStreamCode.scrollTop = liveStreamCode.scrollHeight;
          }
        }
        break;

      case 'SIMULATION_READY':
        if (message.atifTrajectory) {
          currentAtifTrajectory = message.atifTrajectory;
        }
        activeCode = message.code;
        const simCodePreview = document.getElementById('sim-code-preview');
        if (simCodePreview) {
          simCodePreview.textContent = activeCode;
        }
        initSimulationInIframe(message.code, message.initialParams);

        if (message.parameters) {
          activeParameters = message.parameters;
        }

        // Phase 3: Session & Version tracking
        if (message.sessionId) {
          activeSessionId = message.sessionId;
        }
        if (message.versionIndex) {
          activeVersionIndex = message.versionIndex;
          if (message.versionIndex === 1) {
            currentVersions = [];
          }
          if (!currentVersions.some((v) => v.versionIndex === message.versionIndex)) {
            currentVersions.push({
              id: message.versionId || `ver_v${message.versionIndex}`,
              versionIndex: message.versionIndex,
              versionLabel: message.versionLabel || `v${message.versionIndex}`,
              code: message.code || activeCode,
              parameters: message.parameters || activeParameters,
              parameterState: { ...currentParamsState }
            });
          }
          renderVersionScrubber();
        }

        // Phase 3: Cloud Escalation Badge
        if (message.routingDecision) {
          activeRoutingDecision = message.routingDecision;
          renderCloudEscalation(message.routingDecision);
        }

        const simVerifyingBanner = document.getElementById('sim-verifying-banner');
        if (message.isOptimistic) {
          setStatusPill('Verifying');
          setMorphingProgress(3, 'Sandbox Pre-Flight Verification...', 'Testing in isolated offscreen sandbox', 'test');
          if (simVerifyingBanner) {
            simVerifyingBanner.style.display = 'block';
            simVerifyingBanner.textContent = '⚡ Running pre-flight safety verification in background...';
            simVerifyingBanner.style.color = '#38bdf8';
          }
        } else {
          setStatusPill('Active');
          setMorphingProgress(4, 'Simulation Ready!', 'Interactive runtime active • Explorable', 'ready', 5000);
          if (simVerifyingBanner) {
            simVerifyingBanner.style.display = 'none';
          }
        }
        break;

      case 'SIMULATION_ERROR':
        if (message.atifTrajectory) {
          currentAtifTrajectory = message.atifTrajectory;
        }
        if (message.rawCode) {
          activeCode = message.rawCode;
        }

        setMorphingProgress(3, 'Generation Error', message.errorMessage || 'Unable to build simulation', 'error');
        const verifyingBanner = document.getElementById('sim-verifying-banner');
        if (stateSimulation.style.display === 'flex' && activeCode) {
          // Keep active simulation on screen; notify user via status banner
          setStatusPill('Error');
          if (verifyingBanner) {
            verifyingBanner.style.display = 'block';
            verifyingBanner.textContent = `⚠️ Pre-flight note: ${message.errorMessage || 'Pre-flight check failed'}`;
            verifyingBanner.style.color = '#f59e0b';
          }
        } else {
          setViewState('error');
          setStatusPill('Error');
          const errTitle = document.getElementById('error-title');
          const errMsg = document.getElementById('error-message');
          if (errTitle) errTitle.textContent = 'Generation Failed';
          if (errMsg) errMsg.textContent = message.errorMessage || 'Unknown error occurred.';

          const errorCodeContainer = document.getElementById('error-code-container');
          const errorCodePreview = document.getElementById('error-code-preview');
          if (activeCode) {
            if (errorCodeContainer) errorCodeContainer.style.display = 'block';
            if (errorCodePreview) errorCodePreview.textContent = activeCode;
          } else {
            if (errorCodeContainer) errorCodeContainer.style.display = 'none';
          }
        }
        break;

      case 'SHOW_BYOK_SETUP':
        openSettingsModal();
        if (message.reason) {
          settingsStatusMsg.style.display = 'block';
          settingsStatusMsg.textContent = message.reason;
          settingsStatusMsg.style.color = '#f59e0b';
        }
        break;
    }
  });
}

// Export Dropdown
btnExportToggle?.addEventListener('click', (e) => {
  e.stopPropagation();
  exportMenu.style.display = exportMenu.style.display === 'none' ? 'flex' : 'none';
});

document.addEventListener('click', () => {
  if (exportMenu) exportMenu.style.display = 'none';
});

// Export 1: Standalone HTML
btnExportHtml?.addEventListener('click', () => {
  if (!activeCode) {
    alert('No active simulation to export.');
    return;
  }

  const html = generateStandaloneSimulationHtml({
    title: simTitle.textContent || 'Simulation',
    description: simDesc.textContent || '',
    parameters: activeParameters,
    initialParams: currentParamsState,
    code: activeCode
  });

  downloadFile('sim-export.html', 'text/html', html);
});

// Export 2: ATIF JSON
btnExportAtif?.addEventListener('click', () => {
  if (!currentAtifTrajectory) {
    alert('No ATIF trajectory recorded for current session.');
    return;
  }
  const jsonStr = JSON.stringify(currentAtifTrajectory, null, 2);
  downloadFile(`${currentAtifTrajectory.session_id || 'session'}.atif.json`, 'application/json', jsonStr);
});

// Error Card: Download ATIF Button
document.getElementById('btn-error-download-atif')?.addEventListener('click', () => {
  if (!currentAtifTrajectory) {
    alert('No ATIF trajectory recorded for current session.');
    return;
  }
  const jsonStr = JSON.stringify(currentAtifTrajectory, null, 2);
  downloadFile(`${currentAtifTrajectory.session_id || 'session'}.atif.json`, 'application/json', jsonStr);
});

// Export 3: Copy ATIF
btnCopyAtif?.addEventListener('click', () => {
  if (!currentAtifTrajectory) {
    alert('No ATIF trajectory recorded for current session.');
    return;
  }
  navigator.clipboard.writeText(JSON.stringify(currentAtifTrajectory, null, 2))
    .then(() => alert('ATIF trajectory copied to clipboard!'))
    .catch((err) => console.error('Copy failed:', err));
});

// Copy Generated Code (from Export menu)
document.getElementById('btn-copy-code')?.addEventListener('click', () => {
  if (!activeCode) {
    alert('No active simulation code to copy.');
    return;
  }
  navigator.clipboard.writeText(activeCode)
    .then(() => alert('Simulation code copied to clipboard!'))
    .catch((err) => console.error('Copy failed:', err));
});

// Copy Code from Error Box
document.getElementById('btn-copy-error-code')?.addEventListener('click', () => {
  if (!activeCode) return;
  navigator.clipboard.writeText(activeCode)
    .then(() => alert('Generated code copied to clipboard!'))
    .catch((err) => console.error('Copy failed:', err));
});

// Toggle Code Terminal Overlay
btnToggleCodeTerminal?.addEventListener('click', () => {
  if (!codeTerminalOverlay) return;
  const isHidden = codeTerminalOverlay.style.display === 'none';
  codeTerminalOverlay.style.display = isHidden ? 'flex' : 'none';
  btnToggleCodeTerminal.classList.toggle('active', isHidden);
  const simCodePreview = document.getElementById('sim-code-preview');
  if (simCodePreview && isHidden) {
    simCodePreview.textContent = activeCode;
  }
});

const closeTerminal = () => {
  if (codeTerminalOverlay) codeTerminalOverlay.style.display = 'none';
  if (btnToggleCodeTerminal) btnToggleCodeTerminal.classList.remove('active');
};
btnCloseTerminal?.addEventListener('click', closeTerminal);
btnCloseTerminalDot?.addEventListener('click', closeTerminal);

const copyActiveCode = async (btnEl?: HTMLElement, labelEl?: HTMLElement) => {
  if (!activeCode) return;
  try {
    await navigator.clipboard.writeText(activeCode);
    if (labelEl) {
      const orig = labelEl.textContent;
      labelEl.textContent = 'Copied!';
      setTimeout(() => { if (labelEl) labelEl.textContent = orig; }, 2000);
    } else if (btnEl) {
      btnEl.style.color = '#10b981';
      setTimeout(() => { if (btnEl) btnEl.style.color = ''; }, 2000);
    }
  } catch (err) {
    console.error('Copy failed:', err);
  }
};

btnCopySimCodeInline?.addEventListener('click', () => copyActiveCode(btnCopySimCodeInline));
btnCopyTerminalCode?.addEventListener('click', () => copyActiveCode(btnCopyTerminalCode, terminalCopyText));
document.getElementById('btn-copy-sim-code')?.addEventListener('click', (e) => {
  e.stopPropagation();
  copyActiveCode();
});

// Retry Generation Button
document.getElementById('btn-retry')?.addEventListener('click', () => {
  setViewState('empty');
  setStatusPill('Ready');
});

// Run Simulation Now (from live stream loading box)
document.getElementById('btn-skip-to-sim')?.addEventListener('click', () => {
  if (!activeCode) {
    alert('No simulation code generated yet.');
    return;
  }
  initSimulationInIframe(activeCode);
});

// Copy Code from Live Stream Box
document.getElementById('btn-copy-live-code')?.addEventListener('click', () => {
  if (!activeCode) return;
  navigator.clipboard.writeText(activeCode)
    .then(() => alert('Generated code copied to clipboard!'))
    .catch((err) => console.error('Copy failed:', err));
});

// Run Simulation Anyway (from error card)
document.getElementById('btn-force-run-sim')?.addEventListener('click', () => {
  if (!activeCode) {
    alert('No simulation code available.');
    return;
  }
  initSimulationInIframe(activeCode);
});

function downloadFile(filename: string, mimeType: string, content: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Settings Modal Management
function openSettingsModal() {
  loadBYOKSettings().then((settings) => {
    currentByokSettings = settings;
    providerSelect.value = settings.activeProviderType;
    chkFallback.checked = settings.fallbackToBYOKOnNanoUnavailable;

    (document.getElementById('anthropic-key') as HTMLInputElement).value = settings.providers.anthropic.apiKey || '';
    (document.getElementById('anthropic-model') as HTMLInputElement).value = settings.providers.anthropic.modelName || 'claude-3-5-sonnet-20241022';

    (document.getElementById('gemini-key') as HTMLInputElement).value = settings.providers['google-gemini'].apiKey || '';
    (document.getElementById('gemini-model') as HTMLInputElement).value = settings.providers['google-gemini'].modelName || 'gemini-2.5-flash';

    (document.getElementById('openai-url') as HTMLInputElement).value = settings.providers['openai-compatible'].baseUrl || 'http://localhost:11434/v1';
    (document.getElementById('openai-key') as HTMLInputElement).value = settings.providers['openai-compatible'].apiKey || '';
    (document.getElementById('openai-model') as HTMLInputElement).value = settings.providers['openai-compatible'].modelName || 'deepseek-r1:8b';

    updateProviderFieldVisibility(settings.activeProviderType);
    modalSettings.style.display = 'flex';
  });
}

function updateProviderFieldVisibility(type: ProviderType) {
  fieldsAnthropic.style.display = type === 'anthropic' ? 'block' : 'none';
  fieldsGemini.style.display = type === 'google-gemini' ? 'block' : 'none';
  fieldsOpenai.style.display = type === 'openai-compatible' ? 'block' : 'none';
}

btnSettings?.addEventListener('click', openSettingsModal);
btnCloseSettings?.addEventListener('click', () => { modalSettings.style.display = 'none'; });

providerSelect?.addEventListener('change', () => {
  updateProviderFieldVisibility(providerSelect.value as ProviderType);
});

btnSaveSettings?.addEventListener('click', async () => {
  const updated: BYOKStorageSettings = {
    activeProviderType: providerSelect.value as ProviderType,
    fallbackToBYOKOnNanoUnavailable: chkFallback.checked,
    providers: {
      'chrome-prompt-api': {
        modelName: 'gemini-nano',
        temperature: 0.2
      },
      anthropic: {
        apiKey: (document.getElementById('anthropic-key') as HTMLInputElement).value.trim(),
        modelName: (document.getElementById('anthropic-model') as HTMLInputElement).value.trim() || 'claude-3-5-sonnet-20241022',
        temperature: 0.2
      },
      'google-gemini': {
        apiKey: (document.getElementById('gemini-key') as HTMLInputElement).value.trim(),
        modelName: (document.getElementById('gemini-model') as HTMLInputElement).value.trim() || 'gemini-2.5-flash',
        temperature: 0.2
      },
      'openai-compatible': {
        baseUrl: (document.getElementById('openai-url') as HTMLInputElement).value.trim() || 'http://localhost:11434/v1',
        apiKey: (document.getElementById('openai-key') as HTMLInputElement).value.trim(),
        modelName: (document.getElementById('openai-model') as HTMLInputElement).value.trim() || 'deepseek-r1:8b',
        temperature: 0.2
      }
    }
  };

  await saveBYOKSettings(updated);
  currentByokSettings = updated;
  modalSettings.style.display = 'none';
});

btnTestConnection?.addEventListener('click', async () => {
  settingsStatusMsg.style.display = 'block';
  settingsStatusMsg.textContent = 'Testing connection...';
  settingsStatusMsg.style.color = '#f59e0b';

  const type = providerSelect.value as ProviderType;
  const testSettings: BYOKStorageSettings = {
    activeProviderType: type,
    fallbackToBYOKOnNanoUnavailable: chkFallback.checked,
    providers: {
      ...currentByokSettings.providers,
      anthropic: {
        ...currentByokSettings.providers.anthropic,
        apiKey: (document.getElementById('anthropic-key') as HTMLInputElement).value.trim()
      },
      'google-gemini': {
        ...currentByokSettings.providers['google-gemini'],
        apiKey: (document.getElementById('gemini-key') as HTMLInputElement).value.trim()
      },
      'openai-compatible': {
        ...currentByokSettings.providers['openai-compatible'],
        baseUrl: (document.getElementById('openai-url') as HTMLInputElement).value.trim(),
        apiKey: (document.getElementById('openai-key') as HTMLInputElement).value.trim()
      }
    }
  };

  try {
    const provider = createProviderInstance(type, testSettings);
    const available = await provider.isAvailable();
    if (available) {
      settingsStatusMsg.textContent = `Success: Provider ${type} is reachable and ready!`;
      settingsStatusMsg.style.color = '#10b981';
    } else {
      settingsStatusMsg.textContent = `Provider ${type} is currently not reachable or key is missing.`;
      settingsStatusMsg.style.color = '#ef4444';
    }
  } catch (err: any) {
    settingsStatusMsg.textContent = `Error testing ${type}: ${err.message || String(err)}`;
    settingsStatusMsg.style.color = '#ef4444';
  }
});

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ====================================================
// Phase 3: Version Scrubber, Chips, Chat & Escalation
// ====================================================

/**
 * Renders the version scrubber pills (v1, v2, v3...) with active state and 1-click rollback
 */
function renderVersionScrubber() {
  if (!versionScrubber) return;
  if (currentVersions.length <= 1) {
    versionScrubber.style.display = 'none';
    return;
  }

  versionScrubber.style.display = 'flex';
  versionScrubber.innerHTML = '';

  for (const v of currentVersions) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = `version-pill ${v.versionIndex === activeVersionIndex ? 'active' : ''}`;
    pill.textContent = v.versionLabel;
    pill.title = `Rollback to ${v.versionLabel}`;

    pill.addEventListener('click', () => {
      handleVersionRollback(v.id, v.versionIndex);
    });

    versionScrubber.appendChild(pill);
  }
}

function postToSandbox(msg: HostToSandboxMessage) {
  if (sandboxIframe && sandboxIframe.contentWindow) {
    sandboxIframe.contentWindow.postMessage(msg, '*');
  }
}

/**
 * Handles 1-click state rollback (0 network calls)
 */
/**
 * Handles 1-click state rollback (0 network calls)
 */
async function handleVersionRollback(versionId: string, versionIndex: number) {
  if (versionIndex === activeVersionIndex) return;

  // 1. Direct in-memory instant rollback
  const targetVer = currentVersions.find((v) => v.versionIndex === versionIndex || v.id === versionId);
  if (targetVer) {
    activeVersionIndex = targetVer.versionIndex;
    activeCode = targetVer.code;
    activeParameters = targetVer.parameters || [];
    currentParamsState = { ...targetVer.parameterState };

    initSimulationInIframe(activeCode, currentParamsState);
    renderControlsDock(activeParameters, currentParamsState);
    renderVersionScrubber();

    const simCodePreview = document.getElementById('sim-code-preview');
    if (simCodePreview) {
      simCodePreview.textContent = activeCode;
    }
  }

  // 2. Also notify background service worker for session persistence
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage(
      {
        type: 'VERSION_ROLLBACK_REQUEST',
        sessionId: activeSessionId,
        targetVersionId: versionId,
        versionIndex
      },
      (res: any) => {
        if (res && res.status === 'ok' && res.version && !targetVer) {
          activeVersionIndex = versionIndex;
          activeCode = res.version.code;
          activeParameters = res.version.parameters || [];
          currentParamsState = res.version.parameterState || {};

          initSimulationInIframe(activeCode, currentParamsState);
          renderControlsDock(activeParameters, currentParamsState);
          renderVersionScrubber();

          const simCodePreview = document.getElementById('sim-code-preview');
          if (simCodePreview) {
            simCodePreview.textContent = activeCode;
          }
        }
      }
    );
  }
}

/**
 * Renders pre-computed evolution chips (hidden to maximize simulation space)
 */
function renderEvolutionChips(_chips: EvolutionChip[]) {
  if (evolutionChipsDock) {
    evolutionChipsDock.style.display = 'none';
  }
}

/**
 * Handles clicks on evolution chips
 */
function handleChipClick(chip: EvolutionChip) {
  if (chip.actionType === 'parameter_preset') {
    // Zero-latency direct parameter update (0ms LLM overhead)
    if (chip.targetParamId && chip.presetValue !== undefined) {
      currentParamsState[chip.targetParamId] = chip.presetValue;
    }
    if (chip.parameterUpdates) {
      Object.assign(currentParamsState, chip.parameterUpdates);
    }

    // Post directly to sandboxed iframe
    postToSandbox({
      type: 'SANDBOX_UPDATE_PARAMETERS',
      params: currentParamsState
    });

    renderControlsDock(activeParameters, currentParamsState);

    if (refinementStatus) {
      refinementStatus.style.display = 'block';
      refinementStatus.style.color = '#10b981';
      refinementStatus.textContent = `⚡ Applied preset: ${chip.label} (0ms LLM overhead)`;
      setTimeout(() => {
        if (refinementStatus) refinementStatus.style.display = 'none';
      }, 3000);
    }
    return;
  }

  if (chip.actionType === 'view_mode') {
    // Reset parameters to defaults
    const defaultParams: ParameterState = {};
    for (const p of activeParameters) {
      defaultParams[p.id] = (p as any).default ?? 0;
    }
    currentParamsState = defaultParams;
    postToSandbox({
      type: 'SANDBOX_UPDATE_PARAMETERS',
      params: currentParamsState
    });
    renderControlsDock(activeParameters, currentParamsState);
    return;
  }

  if (chip.actionType === 'structural_refinement') {
    executeRefinement(chip.refinementPrompt || chip.label, chip.id);
  }
}

/**
 * Executes a conversational refinement (chat or chip) with intent triage
 */
function executeRefinement(userMessage: string, chipId?: string) {
  if (!userMessage.trim()) return;

  // Set chat box to readonly and send button to loading
  if (refinementInput) {
    refinementInput.readOnly = true;
  }
  if (btnRefinementSend) {
    btnRefinementSend.disabled = true;
    btnRefinementSend.innerHTML = '<div class="btn-spinner"></div>';
    btnRefinementSend.title = 'Evolving simulation...';
  }

  const resetChatInput = (clearText = false) => {
    if (refinementInput) {
      refinementInput.readOnly = false;
      if (clearText) refinementInput.value = '';
      refinementInput.focus();
    }
    if (btnRefinementSend) {
      btnRefinementSend.disabled = false;
      btnRefinementSend.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
      `;
      btnRefinementSend.title = 'Send prompt or refinement';
    }
  };

  setMorphingProgress(1, 'Analyzing Refinement Intent...', 'Determining parametric tweak vs structural evolution', 'think');

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    const req: EvolutionRequestMessage = {
      type: 'EVOLUTION_REQUEST',
      sessionId: activeSessionId,
      currentCode: activeCode,
      userMessage,
      chipId,
      activeParams: currentParamsState
    };

    chrome.runtime.sendMessage(req, (res: EvolutionResponseMessage) => {
      resetChatInput(res && res.status === 'ok');

      if (!res) {
        setMorphingProgress(3, 'Connection Error', 'No response received from background orchestrator.', 'error');
        return;
      }

      if (res.status === 'ok') {
        if (res.intentType === 'parametric_tweak' && res.appliedParams) {
          // Zero-latency update: 0ms LLM overhead
          Object.assign(currentParamsState, res.appliedParams);
          postToSandbox({
            type: 'SANDBOX_UPDATE_PARAMETERS',
            params: currentParamsState
          });
          renderControlsDock(activeParameters, currentParamsState);

          setMorphingProgress(4, 'Parameter Updated (0ms overhead)', 'Direct parameter patch applied to simulation', 'ready', 4000);
          return;
        }

        if (res.intentType === 'reset_state' && res.appliedParams) {
          currentParamsState = res.appliedParams;
          postToSandbox({
            type: 'SANDBOX_UPDATE_PARAMETERS',
            params: currentParamsState
          });
          renderControlsDock(activeParameters, currentParamsState);

          setMorphingProgress(4, 'Parameters Reset', 'Restored initial module default parameters', 'ready', 4000);
          return;
        }

        if (res.intentType === 'structural_evolution' && res.evolvedCode) {
          activeCode = res.evolvedCode;
          if (res.parameters) {
            activeParameters = res.parameters;
          }

          initSimulationInIframe(activeCode, currentParamsState);
          renderControlsDock(activeParameters, currentParamsState);

          activeVersionIndex = res.versionIndex || (activeVersionIndex + 1);
          const newVerId = res.versionId || `ver_v${activeVersionIndex}_${Date.now()}`;
          currentVersions.push({
            id: newVerId,
            versionIndex: activeVersionIndex,
            versionLabel: res.versionLabel || `v${activeVersionIndex}`,
            code: activeCode,
            parameters: [...activeParameters],
            parameterState: { ...currentParamsState }
          });
          renderVersionScrubber();

          const simCodePreview = document.getElementById('sim-code-preview');
          if (simCodePreview) simCodePreview.textContent = activeCode;

          setMorphingProgress(
            4,
            `✨ Evolved to v${activeVersionIndex} successfully!`,
            `Version ${activeVersionIndex} saved to session memory`,
            'ready',
            5000
          );
          return;
        }
      }

      setMorphingProgress(3, 'Refinement Failed', res?.errorMessage || 'Unknown error occurred.', 'error');
    });
  } else {
    resetChatInput(false);
  }
}

/**
 * Configures the 1-click cloud escalation button
 */
function renderCloudEscalation(decision: RoutingDecision) {
  if (!btnCloudEscalate) return;

  if (decision.canEscalateToCloud) {
    btnCloudEscalate.style.display = 'inline-flex';
    if (cloudEscalateText) {
      cloudEscalateText.textContent = decision.escalationBadgeText || '⚡ Escalate to Cloud';
    }
  } else {
    btnCloudEscalate.style.display = 'none';
  }
}

/**
 * Handles 1-click cloud escalation click
 */
function handleCloudEscalateClick() {
  if (!activeCode) return;

  setMorphingProgress(2, 'Escalating to Frontier Cloud Model...', 'Formulating context for deep reasoning tier', 'code');
  setStatusPill('Synthesizing');

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    const req: CloudEscalationRequestMessage = {
      type: 'CLOUD_ESCALATION_REQUEST',
      sessionId: activeSessionId,
      currentCode: activeCode,
      selectedText: simTitle.textContent || ''
    };

    chrome.runtime.sendMessage(req, (res: CloudEscalationResponseMessage) => {
      if (res && res.status === 'ok' && res.evolvedCode) {
        activeCode = res.evolvedCode;
        if (res.parameters) {
          activeParameters = res.parameters;
        }

        initSimulationInIframe(activeCode, currentParamsState);
        renderControlsDock(activeParameters, currentParamsState);

        activeVersionIndex = res.versionIndex || (activeVersionIndex + 1);
        const newVerId = res.versionId || `ver_v${activeVersionIndex}_${Date.now()}`;
        currentVersions.push({
          id: newVerId,
          versionIndex: activeVersionIndex,
          versionLabel: res.versionLabel || `v${activeVersionIndex}`,
          code: activeCode,
          parameters: [...activeParameters],
          parameterState: { ...currentParamsState }
        });
        renderVersionScrubber();

        const simCodePreview = document.getElementById('sim-code-preview');
        if (simCodePreview) simCodePreview.textContent = activeCode;

        setStatusPill('Active');
        setMorphingProgress(
          4,
          `🚀 Frontier model generated v${activeVersionIndex}!`,
          `${res.modelName || res.provider} generation complete`,
          'ready',
          5000
        );
      } else {
        setStatusPill('Active');
        setMorphingProgress(3, 'Cloud Escalation Failed', res?.errorMessage || 'Check API key in Settings', 'error');
      }
    });
  }
}

// Event Listeners for Refinement Chat & Cloud Escalation
btnRefinementSend?.addEventListener('click', () => {
  if (refinementInput) {
    executeRefinement(refinementInput.value);
  }
});

refinementInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    executeRefinement(refinementInput.value);
  }
});

btnCloudEscalate?.addEventListener('click', handleCloudEscalateClick);

/**
 * Initializes Side Panel State on Startup
 * Inspects if a background generation is actively running (e.g. triggered via context menu)
 * If not, mounts the interactive living welcome simulation.
 */
function initSidepanelState() {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: 'GET_ACTIVE_GENERATION_STATE' }, (response) => {
      if (response && response.status === 'ok' && response.payload && response.payload.active) {
        const { step, title, detail, stageName } = response.payload;
        setMorphingProgress(step, title, detail, stageName);
        if (stageName === 'think' || stageName === 'code') setStatusPill('Synthesizing');
        if (stageName === 'test') setStatusPill('Verifying');
        return;
      }

      // If no active generation and no custom simulation loaded yet, mount welcome simulation
      if (!activeCode) {
        simTitle.textContent = 'SimIt Copilot';
        simDesc.textContent = 'Zero-prompt interactive simulations. Highlight formulas, algorithms, or concepts on any web page and right-click "SimIt" — or prompt below.';
        initSimulationInIframe(WELCOME_SIMULATION_CODE);
        setStatusPill('Ready');
      }
    });
  } else {
    if (!activeCode) {
      simTitle.textContent = 'SimIt Copilot';
      simDesc.textContent = 'Zero-prompt interactive simulations. Highlight formulas, algorithms, or concepts on any web page and right-click "SimIt" — or prompt below.';
      initSimulationInIframe(WELCOME_SIMULATION_CODE);
      setStatusPill('Ready');
    }
  }
}

// Boot up sidepanel state
initSidepanelState();

