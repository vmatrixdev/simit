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

### RESTRICTIONS & CSP RULES
- Do NOT use \`fetch\`, \`XMLHttpRequest\`, \`WebSocket\`, or load external CDN scripts.
- Do NOT use \`eval()\` or access \`window.parent\` / \`document.cookie\`.
- Ensure all computations are safe: guard against division by zero, \`NaN\`, and infinite loops.
- All styles must be applied directly via JavaScript or inline CSS within the container.

### OUTPUT FORMAT
Output ONLY valid JavaScript (ES module format) with NO markdown backticks or text preamble.
Your module must export default an object with the following structure:

export default {
  title: "Short Descriptive Title",
  description: "1-sentence summary of the interactive concept.",
  parameters: [
    { id: "tau", label: "Temperature (τ)", type: "slider", min: 0.1, max: 5.0, step: 0.1, default: 1.0 },
    { id: "showVectors", label: "Show Projections", type: "toggle", default: true }
  ],
  init(container, params) {
    // 1. Create Canvas or SVG inside container
    // 2. Initial render using params
  },
  update(params) {
    // Reactively update visual elements based on changed slider/toggle values
  },
  destroy() {
    // Cancel requestAnimationFrame or anime timelines
  }
};`;

/**
 * Builds user prompt from harvested context
 */
export function buildUserPromptFromContext(context: HarvestedContext): string {
  const parts: string[] = [];

  parts.push(`Create an interactive simulation for the following scientific / technical concept:`);
  parts.push(`\n### HIGHLIGHTED CONCEPT / SELECTION:`);
  parts.push(context.selection.selectedText || '(No explicit text highlighted)');

  if (context.mathSnippets && context.mathSnippets.length > 0) {
    parts.push(`\n### RELEVANT MATHEMATICAL EQUATIONS:`);
    for (const math of context.mathSnippets) {
      parts.push(`- LaTeX: $${math.latex}$ (Type: ${math.type})`);
    }
  }

  if (context.domContext) {
    parts.push(`\n### DOCUMENT CONTEXT:`);
    if (context.domContext.nearestHeading) {
      parts.push(`- Section: ${context.domContext.nearestHeading} (${context.domContext.headingLevel || 'Heading'})`);
    }
    if (context.domContext.caption) {
      parts.push(`- Associated Caption: ${context.domContext.caption}`);
    }
    if (context.domContext.paragraphSnippet) {
      parts.push(`- Surrounding Context: ${context.domContext.paragraphSnippet}`);
    }
  }

  parts.push(`\n### REQUIREMENTS:`);
  parts.push(`1. Choose intuitive parameters (e.g. rate, temperature, mass, steps, toggles) that reveal the core dynamics.`);
  parts.push(`2. Render a 60 FPS visual representation using SVG, Canvas, D3, and/or Anime.js.`);
  parts.push(`3. Label key axes, formulas, or parameters using KaTeX.`);
  parts.push(`4. Return ONLY valid ES module JavaScript.`);

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
  const userPrompt = `Your previously generated simulation code failed during sandboxed pre-flight verification.

### FAILED CODE:
\`\`\`javascript
${failedCode}
\`\`\`

### RUNTIME ERROR & STACK TRACE:
${errorMessage}
${errorStack || ''}

### REPAIR DIRECTIVES:
1. Fix the root cause identified in the stack trace.
2. Check for missing variable definitions, unhandled null/undefined DOM nodes, or library API mismatches (ensure valid d3, anime, or katex method signatures).
3. Ensure defensive mathematical checks (guard against division by zero or empty arrays).
4. Return ONLY the repaired executable ES module code with no markdown wrapping.`;

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
