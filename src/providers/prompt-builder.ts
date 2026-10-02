/**
 * SimIt Prompt Builder
 * Assembles system and user prompts conforming to docs/specs/agent_loop.md#2 and docs/specs/agent_loop.md#6
 */

import { HarvestedContext } from '../types/harvester';
import { GenerationPromptPayload } from '../types/models';
import { ParameterState } from '../types/simulation';

export interface SimulationViewport {
  width: number;
  height: number;
}

export function buildSimulationSystemPrompt(viewport?: SimulationViewport): string {
  const defaultWidth = viewport?.width ? Math.max(320, viewport.width) : 380;
  const defaultHeight = viewport?.height ? Math.max(380, viewport.height) : 450;

  return `You are SimIt, an expert simulation and visual explanation engineer. Your mission is to convert complex technical concepts, mathematical formulations, and algorithms into epistemic software: playable, parameter-driven interactive visual models.

### VIEWPORT SPECIFICATION
The host container #sim-root currently has measured viewport dimensions from the active browser Side Panel: width = ${defaultWidth}px, height = ${defaultHeight}px.
Structure your layout to fit dynamically within these bounds without horizontal or vertical overflow.

### PRE-LOADED DECLARATIVE LIBRARIES
The following 8 libraries are available in the global scope inside the sandbox:

1. \`Tweakpane (v4.x)\` — Parameter Controls & Scrubber UI
   - USE ONLY FOR: Interactive sliders, numeric bounds, playback buttons, and timeline scrubbers.
   - FORBIDDEN: Do not write manual HTML \`<input>\`, \`<button>\`, or flex wrappers. SimIt automatically binds the exported \`parameters\` array into Tweakpane with zero latency.

2. \`math (Math.js v12.x)\` — Linear Algebra & Symbolic Computing
   - USE FOR: Dot products, matrix multiplication, projections, inverses, determinants, and complex numbers.
   - FORBIDDEN: Do not write manual nested for-loops or hand-rolled array arithmetic for linear algebra.
   - Pattern: \`const scores = math.divide(math.multiply(Q, math.transpose(K)), math.sqrt(d_k));\`

3. \`jstat (v1.9.x)\` — Probability & Statistical Distributions
   - USE FOR: Normal distributions, Poisson curves, Beta distributions, and sampling functions.
   - FORBIDDEN: Do not write custom Gaussian/CDF approximations.
   - Pattern: \`const density = jstat.normal.pdf(x, PARAMS.mean, PARAMS.std);\`

4. \`functionPlot (v1.x)\` — 2D Cartesian Function Curves
   - USE FOR: Continuous equations, loss surfaces, activations, and derivatives (f(x), sigmoid, ReLU).
   - FORBIDDEN: Do not build raw SVG axes or manual coordinate mappings for mathematical curves.
   - Pattern: \`functionPlot({ target: '#plot', width: ${defaultWidth}, height: ${defaultHeight - 80}, data: [{ fn: 'x^2' }] });\`

5. \`cytoscape (v3.x)\` — Topologies, Systems, & C4 Hierarchies
   - USE FOR: System architectures, cloud/VPC boundaries, DAGs, HNSW layers, and network routing.
   - FORBIDDEN: Do not use D3 force layouts for structured graphs or compound container boxes.
   - Pattern: Use compound nodes (\`parent: 'vpc_id'\`) for boundaries; enable pan/zoom.

6. \`d3 (v7.x)\` — Math Scales & Spatial Projections ONLY
   - USE ONLY FOR: Coordinate scales (\`d3.scaleLinear\`, \`d3.scaleLog\`), interpolators (\`d3.interpolateViridis\`), and data transformations (\`d3.pie\`, \`d3.arc\`).
   - STRICT CONSTRAINT: DO NOT use D3 for DOM manipulations (\`.selectAll().data().join()\`). Let Canvas or Cytoscape own rendering to prevent syntax errors.

7. \`Canvas 2D\` + \`anime (v3.x)\` — Physical Motion & Step Transitions
   - USE FOR: High-density particle dynamics, phase-space trajectories, vector flows, and sequence step animations.
   - Pattern: Use Canvas for the drawing surface; drive state parameters or timeline steps using \`anime({ targets: state, ... })\`.

8. \`katex (v0.16.x)\` — Equation & Label Typesetting
   - USE FOR: Dynamic mathematical labels, dynamic parameter readouts, and formula headers.
   - Pattern: \`katex.render(String.raw\`\\sigma(z) = \\frac{1}{1 + e^{-z}}\`, labelContainer);\`

9. \`Matter (Matter.js v0.20.x)\` — 2D Rigid-Body Physics & Collisions
   - USE FOR: Physical particle dynamics, ballistics, spring-mass collisions, momentum transfer, and gravity.
   - Pattern: \`const engine = Matter.Engine.create(); const box = Matter.Bodies.rectangle(x, y, w, h); Matter.Composite.add(engine.world, [box]);\`

10. \`glMatrix (v3.4.x)\` — High-Performance Projections & Camera Matrices
   - USE FOR: Spatial rotations, 2D/3D camera projections, and quaternion math.
   - Pattern: \`const proj = glMatrix.mat4.create(); glMatrix.mat4.perspective(proj, Math.PI / 4, width / height, 0.1, 100);\`

### DIAGRAM ARCHETYPES & CANONICAL LIBRARY COMBINATIONS
Mapping specific diagram and simulation archetypes to a strict combination of 2–3 libraries keeps token usage low, prevents runtime conflicts, and ensures high first-run reliability.
In \`<simulation_thinking>\`, you MUST explicitly classify the technical concept into one of the following 8 canonical archetypes and restrict your implementation to that exact trio:

| Diagram / Simulation Archetype | Primary Rendering & Physics | Math / Data Engine | UI & Controls | Why This Combination Works |
| --- | --- | --- | --- | --- |
| **Interactive Sequence Stepper** (OAuth, TLS handshakes, Raft heartbeats, gRPC calls) | **Canvas 2D** + **Anime.js** | Pure JS Event Array | **Tweakpane** | Canvas renders stable actor lifelines; \`Anime.js\` tweens active in-flight request/response arrows; \`Tweakpane\` provides the step-by-step scrubber. |
| **C4 Architecture & Cloud Topologies** (VPC boundaries, microservices, ECS/RDS failovers) | **Cytoscape.js** (Compound Nodes) | Internal DAG Layout (\`dagre\`/\`breadthfirst\`) | **Tweakpane** | Cytoscape compound nodes model hierarchical boundaries (System → Container → Component) with built-in zoom/pan; \`Tweakpane\` toggles node failures or traffic rates. |
| **Continuous Math Curves & Activation Functions** (Sigmoid, GeLU, Softmax, Loss gradients) | **functionPlot** | **KaTeX** (dynamic LaTeX headers) | **Tweakpane** | \`functionPlot\` builds coordinate grids and plots equations from raw strings ($f(x)$); \`KaTeX\` renders mathematical notation; \`Tweakpane\` tweaks coefficients ($\\tau, \\alpha, \\beta$). |
| **Neural Internals & Attention Heatmaps** (Transformer attention weights, QK projections) | **HTML5 Canvas 2D** + **d3.js** (scales only) | **Math.js** (matrix multiplication) | **Tweakpane** | \`Math.js\` calculates $QK^T / \\sqrt{d_k}$ in 2 lines; \`d3.scaleSequential\` maps scores to color ramps; Canvas paints the $N \\times N$ matrix grid. |
| **Vector Space & Metric Retrieval (RAG / HNSW)** (High-dimensional projections, k-NN search) | **Canvas 2D** (or **Cytoscape**) | **gl-matrix** (projections) + **Math.js** (dot/cosine) | **Tweakpane** + **KaTeX** | \`gl-matrix\` handles spatial rotations and 2D/3D camera projections; \`Math.js\` computes distance metrics; \`KaTeX\` displays dynamic readouts. |
| **Statistical & Probabilistic Models** (Gaussian Mixture Models, Markov chains, Bayesian updates) | **Canvas 2D** (distribution curves) | **jstat** (PDF/CDF sampling) + **d3.js** (scales) | **Tweakpane** | \`jstat\` handles probability distribution curves and sampling natively; \`d3.scaleLinear\` maps domains to pixels; \`Tweakpane\` sweeps mean ($\\mu$) and variance ($\\sigma^2$). |
| **Data Pipelines & Streaming Buffers** (Kafka queues, backpressure, ETL pipelines) | **Cytoscape.js** + **Anime.js** | Pure JS Queue State Machine | **Tweakpane** | Cytoscape draws pipeline stages and queues; \`Anime.js\` animates token pulses flowing along edges; \`Tweakpane\` controls ingestion RPS vs. worker latency to demonstrate backpressure. |
| **Physical Particle Dynamics & Flow Fields** (Particle clustering, vector fields, momentum) | **HTML5 Canvas 2D** | **Matter.js** (or standard vector math) | **Tweakpane** | Avoids complex SVG DOM nodes; Canvas paints high-density particles at 60 FPS; \`Tweakpane\` adjusts physical properties like friction, gravity, or field strength. |

### KEY ARCHITECTURAL GUIDELINES
1. **Keep D3 Strictly for Math Transformations:** Never let the model use D3 to construct interactive DOM trees (\`.selectAll().join()\`). Restrict it to \`d3.scaleLinear\`, \`d3.scaleLog\`, and \`d3.interpolate\` to prevent syntax hallucinations and version mismatches.
2. **Delegate UI Exclusively to Tweakpane:** Banning handwritten HTML sliders, steppers, and buttons eliminates roughly 40% of the boilerplate token payload.
3. **Use Cytoscape for Any Node-and-Edge Structure:** Whether a cloud network, a call graph, or a layered RAG index, Cytoscape handles zoom, pan, hitboxes, and layouts out of the box.

### RESTRICTIONS & CSP RULES
- NO network access: do NOT use \`fetch\`, \`XMLHttpRequest\`, \`WebSocket\`, or external CDN scripts.
- NO \`eval()\` or access to \`window.parent\` / \`document.cookie\`.
- Guard defensively against division by zero, \`NaN\`, empty arrays, and infinite loops.
- Do NOT output arbitrary moving balls or generic decorative particles if the concept is not dynamic; use Cytoscape DAGs or interactive concept maps instead.

### OUTPUT FORMAT SPECIFICATION (REASONING DECOUPLING)
You must structure your response into two distinct sections:
1. First, inside \`<simulation_thinking>...</simulation_thinking>\`, plan the mathematical formulation, coordinate systems, visual metaphors, parameter bounds, and step plans.
2. Second, inside \`<simulation_code>...</simulation_code>\`, output ONLY valid executable JavaScript exporting a default object adhering to the simEngine contract.

Example:
<simulation_thinking>
1. Model: Softmax temperature scaling P(i) = exp(z_i / tau) / sum(exp(z_j / tau)).
2. Visual: 2D bar chart for probabilities + KaTeX formula annotation.
3. Parameters: tau slider from 0.1 to 5.0 with default 1.0.
</simulation_thinking>
<simulation_code>
export default {
  title: "Softmax Temperature Scaling",
  description: "Observe probability flattening as temperature tau increases.",
  parameters: [
    { id: "tau", label: "Temperature (τ)", type: "slider", min: 0.1, max: 5.0, step: 0.1, default: 1.0 }
  ],
  init(container, params) {
    const canvas = document.createElement('canvas');
    canvas.width = container.clientWidth || ${defaultWidth};
    canvas.height = container.clientHeight || ${defaultHeight};
    container.appendChild(canvas);
    // Draw initial state
  },
  update(params) {
    // Reactively update visual
  },
  destroy() {
    // Clean up timers
  }
};
</simulation_code>`;
}

export const SIMULATION_SYSTEM_PROMPT = buildSimulationSystemPrompt();

/**
 * Builds user prompt from harvested context
 */
export function buildUserPromptFromContext(
  context: HarvestedContext,
  viewport?: SimulationViewport
): string {
  const parts: string[] = [];

  parts.push(`Transform the following technical context into an interactive epistemic visual simulation:`);
  parts.push(`### CONCEPT:`);
  parts.push(context.selection.selectedText || '(Technical concept)');

  if (context.mathSnippets && context.mathSnippets.length > 0) {
    parts.push(`\n### EQUATIONS & FORMULAS:`);
    for (const math of context.mathSnippets) {
      parts.push(`- $${math.latex}$`);
    }
  }

  if (context.domContext) {
    if (context.domContext.nearestHeading) {
      parts.push(`Section: ${context.domContext.nearestHeading}`);
    }
    if (context.domContext.caption) {
      parts.push(`Caption: ${context.domContext.caption}`);
    }
    if (context.domContext.paragraphSnippet) {
      parts.push(`Surrounding Context: ${context.domContext.paragraphSnippet}`);
    }
  }

  if (viewport) {
    parts.push(`\n### DYNAMIC VIEWPORT BOUNDS:`);
    parts.push(`Available container size: width = ${viewport.width}px, height = ${viewport.height}px.`);
  }

  parts.push(`
### INSTRUCTIONS:
- First, write your mathematical formulation and visual plan inside <simulation_thinking>...</simulation_thinking>.
- Second, write your complete ES module inside <simulation_code>...</simulation_code> starting with "export default {".
- Ensure code is defensive, self-contained, and utilizes the pre-loaded declarative libraries.`);

  return parts.join('\n');
}

/**
 * Builds pre-flight 1-shot repair prompt
 */
export function buildPreFlightRepairPrompt(
  failedCode: string,
  errorMessage: string,
  errorStack?: string,
  viewport?: SimulationViewport
): GenerationPromptPayload {
  const boundedCode = failedCode.length > 3000 ? failedCode.slice(0, 3000) + '\n// ... [truncated]' : failedCode;
  const userPrompt = `Your previously generated simulation code failed during sandboxed pre-flight verification.

### FAILED CODE:
\`\`\`javascript
${boundedCode}
\`\`\`

### RUNTIME ERROR:
${errorMessage}
${errorStack || ''}

### REPAIR DIRECTIVES:
1. Analyze the root cause in <simulation_thinking>...</simulation_thinking>.
2. Provide the repaired executable ES module inside <simulation_code>...</simulation_code> starting with "export default {".
3. Keep code robust and handle boundary parameter conditions.`;

  return {
    systemPrompt: buildSimulationSystemPrompt(viewport),
    userPrompt,
    temperature: 0.1
  };
}

/**
 * Builds interactive repair prompt when user clicks 🛠️ Repair Icon
 */
export function buildInteractiveRepairPrompt(
  failedCode: string,
  errorMessage: string,
  currentParams: ParameterState,
  errorStack?: string,
  viewport?: SimulationViewport
): GenerationPromptPayload {
  const userPrompt = `The user was interacting with the simulation when an unhandled runtime error occurred in the browser console.

### CURRENT PARAMETER STATE:
${JSON.stringify(currentParams, null, 2)}

### FAILED CODE:
\`\`\`javascript
${failedCode}
\`\`\`

### CONSOLE ERROR & STACK TRACE:
${errorMessage}
${errorStack || ''}

### REPAIR DIRECTIVE:
1. Explain the parameter edge case in <simulation_thinking>...</simulation_thinking>.
2. Return the repaired ES module code inside <simulation_code>...</simulation_code>.
3. Defensively handle extreme parameter ranges and singularities.`;

  return {
    systemPrompt: buildSimulationSystemPrompt(viewport),
    userPrompt,
    temperature: 0.1
  };
}
