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
The following libraries are available in the global scope inside the sandbox:
1. \`Tweakpane\` (v4.x): Use for parameter controls. You define parameters in the exported object's \`parameters\` array; SimIt automatically wires Tweakpane with zero-latency updates.
2. \`functionPlot\` (v1.x): Global \`functionPlot\`. Use for 2D Cartesian curves: functionPlot({ target: container, width: ${defaultWidth}, height: ${defaultHeight - 80}, data: [...] }).
3. \`cytoscape\` (v3.x): Global \`cytoscape\`. Use for DAGs, trees, and state machine graphs: cytoscape({ container, elements: [...], layout: { name: 'breadthfirst' } }).
4. \`anime\` (v3.x): Global \`anime\`. Use for timelines, tweens, and smooth state transitions.
5. \`katex\` (v0.16.x): Global \`katex\`. Use \`katex.render(formula, domElement)\` for rendering LaTeX equations.
6. \`d3\` (v7.x): Global \`d3\`. Use for geometric projections, axes, and scales.
7. HTML5 Canvas 2D: Native canvas element created and appended to container.

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
