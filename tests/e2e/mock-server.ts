/**
 * Local E2E Test Fixture & Mock LLM Server
 * Serves HTML fixtures at /fixtures/* and OpenAI-compatible endpoint at /v1/*
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');

export const DEFAULT_MOCK_PORT = 3556;

export interface MockServerTelemetry {
  architectPlanCalls: number;
  coderCalls: number;
  reviewCalls: number;
  multimodalImagesReceived: number;
  revisionPayloadsWithPreviousCode: number;
}

export const mockTelemetry: MockServerTelemetry = {
  architectPlanCalls: 0,
  coderCalls: 0,
  reviewCalls: 0,
  multimodalImagesReceived: 0,
  revisionPayloadsWithPreviousCode: 0
};

// Pre-synthesized archetype simulations using the P0 (container, params, stage) contract
const SIMULATION_HARMONIC = `
<simulation_code>
export default {
  title: "Damped Harmonic Oscillator",
  description: "Interactive mass-spring-damper parameter explorer",
  parameters: [
    { id: "zeta", label: "Damping Ratio (ζ)", type: "slider", min: 0.0, max: 2.0, step: 0.05, default: 0.2, unit: "ζ" },
    { id: "omega0", label: "Natural Frequency (ω₀)", type: "slider", min: 0.5, max: 5.0, step: 0.1, default: 2.0, unit: "rad/s" },
    { id: "paused", label: "Pause Motion", type: "toggle", default: false }
  ],
  explanation: {
    insight: "At critical damping (ζ = 1), the mass returns to equilibrium in minimum time without oscillating.",
    legend: [
      { symbol: "x(t)", meaning: "Displacement wave trace", color: "#38bdf8" },
      { symbol: "m", meaning: "Oscillating mass bob", color: "#f43f5e" }
    ],
    tour: [
      {
        title: "Underdamped Ringing",
        caption: "At ζ = 0.2, low damping lets the mass oscillate repeatedly across equilibrium.",
        params: { zeta: 0.2, omega0: 2.0 },
        highlightSelector: "#osc-canvas"
      },
      {
        title: "Critical Damping Threshold",
        caption: "At ζ = 1.0, the oscillator settles to rest fastest with zero overshoot.",
        params: { zeta: 1.0, omega0: 2.0 },
        highlightSelector: "#osc-canvas"
      },
      {
        title: "Overdamped Creep",
        caption: "At ζ = 1.8, excess viscous drag slows the return to equilibrium.",
        params: { zeta: 1.8, omega0: 2.0 }
      }
    ]
  },
  init(container, params, stage) {
    const w = (stage && stage.width) || container.clientWidth || 380;
    const h = (stage && stage.height) || container.clientHeight || 280;
    const dpr = (stage && stage.dpr) || window.devicePixelRatio || 1;
    const canvasW = w;
    const canvasH = h;

    container.innerHTML = \`
      <div style="position:relative; width:100%; height:100%; background:#090d16; color:#f8fafc; font-family:sans-serif; overflow:hidden;">
        <canvas id="osc-canvas" width="\${Math.round(canvasW * dpr)}" height="\${Math.round(canvasH * dpr)}" style="width:\${canvasW}px; height:\${canvasH}px; display:block; background:#0f172a;"></canvas>
        <div style="position:absolute; top:8px; left:12px; font-weight:600; font-size:12px; color:#38bdf8; pointer-events:none;">Harmonic Motion Phase Trace</div>
        <div id="readout" style="position:absolute; top:24px; left:12px; font-size:11px; color:#94a3b8; font-family:monospace; pointer-events:none;">Damping: \${params.zeta} | Omega0: \${params.omega0}</div>
      </div>
    \`;
    this.canvas = container.querySelector('#osc-canvas');
    this.readout = container.querySelector('#readout');
    this.ctx = this.canvas.getContext('2d');
    this.dpr = dpr;
    this.logicalW = canvasW;
    this.logicalH = canvasH;
    this.params = { ...params };
    this.t = 0;

    this.renderFrame = () => {
      if (!this.canvas || !this.ctx) return;
      const ctx = this.ctx;
      const cw = this.logicalW;
      const ch = this.logicalH;

      if (!this.params.paused) {
        this.t += 0.08;
      }

      ctx.save();
      ctx.scale(this.dpr, this.dpr);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, cw, ch);

      // Draw equilibrium line
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, ch / 2);
      ctx.lineTo(cw, ch / 2);
      ctx.stroke();

      // Compute position: x(t) = exp(-zeta * omega0 * t) * cos(omega_d * t)
      const zeta = Number(this.params.zeta ?? 0.2);
      const omega0 = Number(this.params.omega0 ?? 2.0);
      const omegaD = omega0 * Math.sqrt(Math.max(0.001, Math.abs(1 - zeta * zeta)));

      // Draw wave trace across canvas
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let px = 20; px < cw - 20; px += 3) {
        const tau = ((px - 20) / (cw - 40)) * 6 + this.t;
        const val = Math.exp(-zeta * omega0 * (tau % 6)) * Math.cos(omegaD * (tau % 6));
        const py = ch / 2 + val * (ch * 0.32);
        if (px === 20) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Draw oscillating mass bob
      const currentX = Math.exp(-zeta * omega0 * (this.t % 6)) * Math.cos(omegaD * (this.t % 6));
      const massY = ch / 2 + currentX * (ch * 0.32);

      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.arc(cw / 2, massY, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.restore();

      this.animId = requestAnimationFrame(this.renderFrame);
    };

    this.animId = requestAnimationFrame(this.renderFrame);
  },
  update(params) {
    this.params = { ...this.params, ...params };
    if (this.readout) {
      this.readout.textContent = \`Damping: \${this.params.zeta} | Omega0: \${this.params.omega0} | Paused: \${this.params.paused}\`;
    }
  },
  destroy() {
    if (this.animId) cancelAnimationFrame(this.animId);
    this.canvas = null;
    this.ctx = null;
  }
};
</simulation_code>
`;

const SIMULATION_BROKEN_NAN = `
<simulation_code>
export default {
  title: "Broken Oscillator With NaN",
  description: "Deliberately renders NaN on first attempt to verify P0 self-repair loop",
  parameters: [
    { id: "zeta", label: "Damping Ratio (ζ)", type: "slider", min: 0.0, max: 2.0, step: 0.05, default: 0.2, unit: "ζ" }
  ],
  init(container, params) {
    container.innerHTML = '<div id="bad-readout">Energy: NaN Joules</div>';
  },
  update() {},
  destroy() {}
};
</simulation_code>
`;

const SIMULATION_SORTING = `
<simulation_code>
export default {
  title: "Quicksort Partition Stepper",
  description: "Step-by-step array partition visualizer",
  parameters: [
    { id: "step", label: "Step Index", type: "stepper", min: 0, max: 5, step: 1, default: 0 },
    { id: "showPivot", label: "Highlight Pivot", type: "toggle", default: true }
  ],
  init(container, params) {
    this.steps = [
      { arr: [38, 27, 43, 3, 9, 82, 10], pivot: 6, desc: "Initial array. Pivot chosen as 10 (index 6)." },
      { arr: [3, 27, 43, 38, 9, 82, 10], pivot: 6, desc: "Found element 3 < 10. Swapped with 38." },
      { arr: [3, 9, 43, 38, 27, 82, 10], pivot: 6, desc: "Found element 9 < 10. Swapped with 27." },
      { arr: [3, 9, 10, 38, 27, 82, 43], pivot: 2, desc: "Placed pivot 10 into its sorted position at index 2." },
      { arr: [3, 9, 10, 27, 38, 82, 43], pivot: 2, desc: "Partitioning right partition [38, 27, 82, 43]." },
      { arr: [3, 9, 10, 27, 38, 43, 82], pivot: -1, desc: "Array fully partitioned and sorted." }
    ];
    this.currentStep = params.step || 0;
    this.container = container;
    this.render();
  },
  render() {
    const data = this.steps[this.currentStep] || this.steps[0];
    this.container.innerHTML = \`
      <div style="display:flex; flex-direction:column; align-items:center; width:100%; height:100%; background:#090d16; color:#f8fafc; font-family:sans-serif; padding:12px; box-sizing:border-box; overflow:hidden;">
        <div style="font-weight:600; font-size:14px; margin-bottom:10px; color:#38bdf8;">Step \${this.currentStep + 1} of \${this.steps.length}</div>
        <div id="bar-chart" style="display:flex; align-items:flex-end; gap:8px; height:150px; margin-bottom:12px;">
          \${data.arr.map((val, idx) => {
            const isPivot = idx === data.pivot;
            const bg = isPivot ? '#f43f5e' : '#38bdf8';
            const h = Math.max(18, val * 1.4);
            return \`
              <div style="display:flex; flex-direction:column; align-items:center; width:32px;">
                <span style="font-size:11px; margin-bottom:4px; color:#cbd5e1;">\${val}</span>
                <div style="width:100%; height:\${h}px; background:\${bg}; border-radius:4px;"></div>
                <span style="font-size:10px; margin-top:4px; color:#64748b;">[\${idx}]</span>
              </div>
            \`;
          }).join('')}
        </div>
        <div style="font-size:12px; color:#94a3b8; text-align:center; background:#1e293b; padding:8px 12px; border-radius:6px; max-width:320px;">
          \${data.desc}
        </div>
      </div>
    \`;
  },
  update(params) {
    if (params.step !== undefined) {
      this.currentStep = Math.min(this.steps.length - 1, Math.max(0, Math.round(params.step)));
      this.render();
    }
  },
  destroy() {
    this.container = null;
  }
};
</simulation_code>
`;

const SIMULATION_GRAPH = `
<simulation_code>
export default {
  title: "Dijkstra Shortest Path Visualizer",
  description: "Interactive graph traversal and node relaxation",
  parameters: [
    { id: "targetNode", label: "Target Node", type: "select", options: ["B", "C", "D", "E"], default: "E" },
    { id: "showRelaxedOnly", label: "Highlight Shortest Path", type: "toggle", default: true }
  ],
  init(container, params) {
    this.container = container;
    this.target = params.targetNode || "E";
    this.highlight = params.showRelaxedOnly ?? true;
    this.render();
  },
  render() {
    this.container.innerHTML = \`
      <div style="display:flex; flex-direction:column; align-items:center; width:100%; height:100%; background:#090d16; color:#f8fafc; font-family:sans-serif; padding:10px; box-sizing:border-box; overflow:hidden;">
        <div style="font-weight:600; font-size:14px; margin-bottom:8px; color:#38bdf8;">Graph Traversal: Source (A) -> Destination (\${this.target})</div>
        <svg id="graph-svg" width="320" height="190" style="background:#0f172a; border-radius:8px; border:1px solid #1e293b;">
          <line x1="60" y1="95" x2="160" y2="40" stroke="\${this.highlight ? '#38bdf8' : '#334155'}" stroke-width="2" />
          <line x1="60" y1="95" x2="160" y2="150" stroke="#334155" stroke-width="2" />
          <line x1="160" y1="40" x2="260" y2="95" stroke="#334155" stroke-width="2" />
          <line x1="160" y1="150" x2="260" y2="95" stroke="\${this.highlight ? '#38bdf8' : '#334155'}" stroke-width="2" />
          <circle cx="60" cy="95" r="18" fill="#6366f1" stroke="#fff" stroke-width="2"/>
          <text x="60" y="100" fill="#fff" font-size="12" font-weight="bold" text-anchor="middle">A</text>
          <circle cx="160" cy="40" r="18" fill="#0284c7" stroke="#fff" stroke-width="1.5"/>
          <text x="160" y="45" fill="#fff" font-size="12" font-weight="bold" text-anchor="middle">B</text>
          <circle cx="160" cy="150" r="18" fill="#0284c7" stroke="#fff" stroke-width="1.5"/>
          <text x="160" y="155" fill="#fff" font-size="12" font-weight="bold" text-anchor="middle">C</text>
          <circle cx="260" cy="95" r="18" fill="#10b981" stroke="#fff" stroke-width="2"/>
          <text x="260" y="100" fill="#fff" font-size="12" font-weight="bold" text-anchor="middle">\${this.target}</text>
        </svg>
        <div id="graph-readout" style="margin-top:8px; font-size:12px; color:#94a3b8;">Shortest Path Distance to \${this.target}: 9</div>
      </div>
    \`;
  },
  update(params) {
    if (params.targetNode !== undefined) this.target = params.targetNode;
    if (params.showRelaxedOnly !== undefined) this.highlight = params.showRelaxedOnly;
    this.render();
  },
  destroy() {
    this.container = null;
  }
};
</simulation_code>
`;

const SIMULATION_STATE_MACHINE = `
<simulation_code>
export default {
  title: "TCP State Machine Inspector",
  description: "Protocol transition and packet handshake explorer",
  parameters: [
    { id: "activeState", label: "Current State", type: "select", options: ["LISTEN", "SYN_SENT", "ESTABLISHED", "FIN_WAIT"], default: "ESTABLISHED" },
    { id: "sendRst", label: "Inject RST Packet", type: "toggle", default: false }
  ],
  init(container, params) {
    this.container = container;
    this.state = params.sendRst ? "CLOSED" : (params.activeState || "ESTABLISHED");
    this.render();
  },
  render() {
    const states = ["LISTEN", "SYN_SENT", "ESTABLISHED", "FIN_WAIT", "CLOSED"];
    this.container.innerHTML = \`
      <div style="display:flex; flex-direction:column; align-items:center; width:100%; height:100%; background:#090d16; color:#f8fafc; font-family:sans-serif; padding:12px; box-sizing:border-box; overflow:hidden;">
        <div style="font-weight:600; font-size:14px; margin-bottom:10px; color:#38bdf8;">TCP Lifecycle State</div>
        <div id="fsm-graph" style="display:flex; flex-direction:column; gap:6px; width:100%; max-width:300px;">
          \${states.map(s => {
            const isActive = s === this.state;
            const bg = isActive ? '#4f46e5' : '#1e293b';
            const border = isActive ? '2px solid #818cf8' : '1px solid #334155';
            return \`
              <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 12px; background:\${bg}; border:\${border}; border-radius:6px; font-family:monospace; font-size:12px;">
                <span>\${s}</span>
                \${isActive ? '<span style="color:#38bdf8; font-size:11px;">[ACTIVE]</span>' : ''}
              </div>
            \`;
          }).join('')}
        </div>
      </div>
    \`;
  },
  update(params) {
    if (params.sendRst) {
      this.state = "CLOSED";
    } else if (params.activeState) {
      this.state = params.activeState;
    }
    this.render();
  },
  destroy() {
    this.container = null;
  }
};
</simulation_code>
`;

function extractPromptTextAndImages(userContent: any): { text: string; imageCount: number } {
  if (typeof userContent === 'string') {
    return { text: userContent, imageCount: 0 };
  }
  if (Array.isArray(userContent)) {
    let text = '';
    let imageCount = 0;
    for (const part of userContent) {
      if (part?.type === 'text' && typeof part.text === 'string') {
        text += part.text + '\n';
      } else if (part?.type === 'image_url' && typeof part.image_url?.url === 'string' && part.image_url.url.startsWith('data:image/png;base64,')) {
        imageCount++;
      }
    }
    return { text, imageCount };
  }
  return { text: '', imageCount: 0 };
}

function getArchitectPlanForPrompt(promptText: string): string {
  const lower = promptText.toLowerCase();
  if (lower.includes('quicksort') || lower.includes('lomuto') || lower.includes('partition')) {
    return `delegate_to_coder(${JSON.stringify({
      title: 'Quicksort Partition Stepper',
      description: 'Step-by-step array partition visualizer',
      visualPlan: 'Render array bars with pivot highlight and step scrubber.',
      mathFormulation: 'Lomuto partition over array indices',
      parametersSpec: [
        { id: 'step', label: 'Step Index', type: 'stepper', min: 0, max: 5, step: 1, default: 0 },
        { id: 'showPivot', label: 'Highlight Pivot', type: 'toggle', default: true }
      ]
    })})`;
  }
  if (lower.includes('dijkstra') || lower.includes('shortest path') || lower.includes('directed graph')) {
    return `delegate_to_coder(${JSON.stringify({
      title: 'Dijkstra Shortest Path Visualizer',
      description: 'Interactive graph traversal and node relaxation',
      visualPlan: 'Render directed weighted graph SVG with active shortest path highlight.',
      mathFormulation: 'd[v] = min(d[v], d[u] + w(u, v))',
      parametersSpec: [
        { id: 'targetNode', label: 'Target Node', type: 'select', options: ['B', 'C', 'D', 'E'], default: 'E' },
        { id: 'showRelaxedOnly', label: 'Highlight Shortest Path', type: 'toggle', default: true }
      ]
    })})`;
  }
  if (lower.includes('tcp') || lower.includes('syn_sent') || lower.includes('handshake') || lower.includes('finite state machine')) {
    return `delegate_to_coder(${JSON.stringify({
      title: 'TCP State Machine Inspector',
      description: 'Protocol transition and packet handshake explorer',
      visualPlan: 'Render TCP state transition nodes with active state badge.',
      mathFormulation: 'FSM transition delta(S, packet) -> S_next',
      parametersSpec: [
        { id: 'activeState', label: 'Current State', type: 'select', options: ['LISTEN', 'SYN_SENT', 'ESTABLISHED', 'FIN_WAIT'], default: 'ESTABLISHED' },
        { id: 'sendRst', label: 'Inject RST Packet', type: 'toggle', default: false }
      ]
    })})`;
  }
  if (lower.includes('self-repair-trigger')) {
    return `delegate_to_coder(${JSON.stringify({
      title: 'Self-Repairing Harmonic Oscillator',
      description: 'Tests P0 deterministic failure detection and code-preserving revision',
      visualPlan: 'Render oscillator canvas after repairing initial NaN defect.',
      mathFormulation: 'm x\'\' + c x\' + k x = 0',
      parametersSpec: [
        { id: 'zeta', label: 'Damping Ratio (ζ)', type: 'slider', min: 0.0, max: 2.0, step: 0.05, default: 0.2, unit: 'ζ' },
        { id: 'omega0', label: 'Natural Frequency (ω₀)', type: 'slider', min: 0.5, max: 5.0, step: 0.1, default: 2.0, unit: 'rad/s' },
        { id: 'paused', label: 'Pause Motion', type: 'toggle', default: false }
      ]
    })})`;
  }
  return `delegate_to_coder(${JSON.stringify({
    title: 'Damped Harmonic Oscillator',
    description: 'Interactive mass-spring-damper parameter explorer',
    visualPlan: 'Render 2D phase trace and damped harmonic bob with parameter sliders.',
    mathFormulation: 'm x\'\' + c x\' + k x = 0',
    parametersSpec: [
      { id: 'zeta', label: 'Damping Ratio (ζ)', type: 'slider', min: 0.0, max: 2.0, step: 0.05, default: 0.2, unit: 'ζ' },
      { id: 'omega0', label: 'Natural Frequency (ω₀)', type: 'slider', min: 0.5, max: 5.0, step: 0.1, default: 2.0, unit: 'rad/s' },
      { id: 'paused', label: 'Pause Motion', type: 'toggle', default: false }
    ]
  })})`;
}

function getMockSimulationForPrompt(promptText: string): string {
  const lower = promptText.toLowerCase();
  // If this is the self-repair scenario, return broken NaN code on Iteration 1 (when PREVIOUS CODE is absent)
  // and return the fixed harmonic oscillator when PREVIOUS CODE + NON_FINITE_TEXT diagnostic is supplied!
  if (lower.includes('self-repairing harmonic oscillator')) {
    if (promptText.includes('<previous_code>') && promptText.includes('NON_FINITE_TEXT')) {
      mockTelemetry.revisionPayloadsWithPreviousCode++;
      return SIMULATION_HARMONIC.replace('Damped Harmonic Oscillator', 'Self-Repairing Harmonic Oscillator');
    }
    return SIMULATION_BROKEN_NAN;
  }
  if (lower.includes('quicksort') || lower.includes('partition stepper')) {
    return SIMULATION_SORTING;
  }
  if (lower.includes('dijkstra') || lower.includes('shortest path')) {
    return SIMULATION_GRAPH;
  }
  if (lower.includes('tcp state machine')) {
    return SIMULATION_STATE_MACHINE;
  }
  return SIMULATION_HARMONIC;
}

export function createMockServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 1. Static Fixture Serving: /fixtures/:filename
    if (url.pathname.startsWith('/fixtures/')) {
      const fileName = path.basename(url.pathname);
      const filePath = path.join(FIXTURES_DIR, fileName);

      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(content);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Fixture Not Found');
      return;
    }

    // 2. Mock OpenAI Models Availability Check: GET /v1/models
    if (url.pathname === '/v1/models' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        data: [{ id: 'gpt-4o-mock', object: 'model' }]
      }));
      return;
    }

    // 2b. Mock Server Telemetry Endpoint: GET /telemetry
    if (url.pathname === '/telemetry' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mockTelemetry));
      return;
    }

    // 3. Mock OpenAI Chat Completions: POST /v1/chat/completions
    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const json = JSON.parse(body || '{}');
          const messages = json.messages || [];
          const systemMessage = String(messages.find((m: any) => m.role === 'system')?.content || '');
          const rawUserContent = messages.find((m: any) => m.role === 'user')?.content;
          const { text: userText, imageCount } = extractPromptTextAndImages(rawUserContent);

          if (imageCount > 0) {
            mockTelemetry.multimodalImagesReceived += imageCount;
          }

          let assistantContent = '';
          if (systemMessage.includes('reviewing a rendered simulation') || userText.includes('Review this simulation build')) {
            mockTelemetry.reviewCalls++;
            assistantContent = JSON.stringify({
              approved: true,
              critique: `Verified render with ${imageCount} multimodal frame(s).`
            });
          } else if (systemMessage.includes('Epistemic Architect')) {
            mockTelemetry.architectPlanCalls++;
            assistantContent = getArchitectPlanForPrompt(userText);
          } else {
            mockTelemetry.coderCalls++;
            assistantContent = getMockSimulationForPrompt(userText);
          }

          const response = {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'gpt-4o-mock',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: assistantContent
                },
                finish_reason: 'stop'
              }
            ]
          };

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'Internal Server Error' }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  return server;
}

export function startMockServer(port: number = DEFAULT_MOCK_PORT): Promise<http.Server> {
  const server = createMockServer();
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`[E2E Mock Server] Running at http://127.0.0.1:${port}`);
      resolve(server);
    });
  });
}

// Allow direct CLI invocation
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startMockServer(DEFAULT_MOCK_PORT);
}
