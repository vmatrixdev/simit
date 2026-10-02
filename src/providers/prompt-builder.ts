/**
 * SimIt Prompt Builder
 * Assembles system and user prompts conforming to docs/specs/agent_loop.md#5
 */

import { HarvestedContext } from '../types/harvester';
import { GenerationPromptPayload } from '../types/models';
import { ParameterState } from '../types/simulation';

export const SIMULATION_SYSTEM_PROMPT = `You are SimIt, an expert graphics and simulation engineer. Your task is to transform technical concepts, scientific formulas, and algorithms into self-contained, interactive visual simulations.

### EXECUTION ENVIRONMENT & AVAILABLE TOOLS
Your code runs inside an isolated browser iframe sandbox with NO network access.
The following localized libraries are pre-loaded in the global scope:
1. \`d3\` (v7): Available globally as \`d3\`. Use for geometric projections, axes, scales, and layouts.
2. \`anime\` (v3): Available globally as \`anime\`. Use for timelines, tweens, and smooth animation loops.
3. \`katex\`: Available globally as \`katex\`. Use \`katex.render(formula, domElement)\` for rendering LaTeX equations.
4. Container: You are given an empty DOM element \`<div id="sim-root"></div>\` with dynamic width (300px to 450px).

### RESTRICTIONS & SIZING RULES
- Keep your code compact, modular, and under 200 lines (do NOT generate huge static arrays; calculate coordinates dynamically).
- Do NOT use \`fetch\`, \`XMLHttpRequest\`, \`WebSocket\`, or load external CDN scripts.
- Do NOT use \`eval()\` or access \`window.parent\` / \`document.cookie\`.
- Ensure all computations are safe: guard against division by zero, \`NaN\`, and infinite loops.
- All styles must be applied directly via JavaScript or inline CSS within the container.

### OUTPUT FORMAT
Output ONLY valid JavaScript (ES module format) with NO markdown backticks and NO conversational preamble.
Start your response immediately with: export default {

CRITICAL FORMAT RULES:
- Do NOT write an ES6 class inside the object (no "class Foo {"). The exported default MUST be a plain object literal.
- Do NOT use document.getElementById() or assume DOM elements exist. You MUST dynamically create any canvas or svg and append it to container:
  const canvas = document.createElement('canvas');
  canvas.width = container.clientWidth || 360;
  canvas.height = 260;
  container.appendChild(canvas);
- All logic must live inside init(container, params), update(params), and destroy().

Your module must strictly conform to this structure:

export default {
  title: "Harmonic Oscillator",
  description: "Interactive mass-spring physical simulation.",
  parameters: [
    { id: "k", label: "Spring Constant (k)", type: "slider", min: 1, max: 50, step: 1, default: 10 },
    { id: "m", label: "Mass (m)", type: "slider", min: 0.5, max: 10, step: 0.5, default: 1 }
  ],
  init(container, params) {
    const canvas = document.createElement('canvas');
    canvas.width = container.clientWidth || 360;
    canvas.height = 260;
    container.appendChild(canvas);
    // Draw initial state using params
  },
  update(params) {
    // Reactively update drawing with new parameter values
  },
  destroy() {
    // Cancel any active animation loops
  }
};`;

/**
 * Builds user prompt from harvested context
 */
export function buildUserPromptFromContext(context: HarvestedContext): string {
  const parts: string[] = [];

  parts.push(`Write a self-contained JavaScript interactive simulation module for:`);
  parts.push(`### CONCEPT:`);
  parts.push(context.selection.selectedText || '(Technical concept)');

  if (context.mathSnippets && context.mathSnippets.length > 0) {
    parts.push(`\n### EQUATIONS:`);
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
      parts.push(`Context: ${context.domContext.paragraphSnippet}`);
    }
  }

  parts.push(`
CRITICAL GENERATION INSTRUCTIONS:
- Do NOT write conversational text, introductions, or "Simulation Plans".
- Do NOT write markdown code blocks or backticks.
- Do NOT use "import" statements (libraries d3, anime, katex are global).
- Start your response IMMEDIATELY with the code:
export default {`);

  return parts.join('\n');
}

/**
 * Builds pre-flight 1-shot repair prompt
 */
export function buildPreFlightRepairPrompt(
  failedCode: string,
  errorMessage: string,
  errorStack?: string
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
1. Fix the error. Return ONLY valid ES module JavaScript starting with "export default {" with NO commentary.
2. Keep code concise (under 200 lines).`;

  return {
    systemPrompt: SIMULATION_SYSTEM_PROMPT,
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
  errorStack?: string
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
1. Fix the error that occurred under the specified parameter state.
2. Defensively handle extreme parameter ranges and edge cases.
3. Return ONLY the repaired executable ES module code.`;

  return {
    systemPrompt: SIMULATION_SYSTEM_PROMPT,
    userPrompt,
    temperature: 0.1
  };
}
