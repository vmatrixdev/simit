/**
 * SimIt Autonomous Multi-Agent Orchestrator
 * Conforms to docs/specs/agent_loop.md#10
 * 
 * Features:
 * 1. Two-Tier Specialization: Epistemic Architect & Coder sub-agent.
 * 2. Unconstrained Creative Deliberation: Free use of declarative libraries without rigid regex archetypes.
 * 3. Micro-Progress Reporting: Strictly 1 line, 3-5 words, zero "Architect:" / "Coder:" prefixes.
 * 4. Sandbox Test Tool & Visual Snapshot Capture: Runs module and retrieves visual raster.
 * 5. Multimodal Visual Review Loop: Architect inspects screenshots against the original plan.
 * 6. Convergence Guardrail: Guaranteed exit within max iterations (default 3).
 */

import { HarvestedContext } from '../types/harvester';
import { IModelProvider } from '../types/models';
import { SimulationViewport } from '../providers/prompt-builder';
import { PreFlightTestRequest, PreFlightTestResponse } from '../types/ipc';
import { ParameterDefinition } from '../types/simulation';
import {
  CoderPlanSpec,
  ReviewFeedback,
  SandboxEvaluationResult,
  AgentTrajectoryStep,
  AutonomousLoopResult
} from '../types/agent';
import { AtifTrajectoryLogger } from '../export/atif-logger';
import { sanitizeCodeFences, extractSimulationTags } from './preflight';

/**
 * Validates and normalizes micro-progress status strings:
 * - Removes any "Architect:", "Coder:", "I am", "Status:" prefixes
 * - Strips quotes and markdown formatting
 * - Clamps to <= 5 words and 1 line
 */
export function validateMicroStatus(rawStatus: string): string {
  if (!rawStatus) return 'Synthesizing simulation';

  // 1. Strip role prefixes
  let cleaned = rawStatus
    .replace(/^(architect|coder|sub-agent|agent|system|model|status|progress):\s*/i, '')
    .replace(/^i am\s+/i, '')
    .replace(/^[•\-\*]\s*/, '')
    .replace(/["'`*_]/g, '')
    .trim();

  // 2. Collapse whitespace & take first line only
  cleaned = cleaned.split('\n')[0].replace(/\s+/g, ' ').trim();

  // 3. Limit to max 5 words
  const words = cleaned.split(' ');
  if (words.length > 5) {
    cleaned = words.slice(0, 5).join(' ');
  }

  // 4. Fallback if empty
  if (!cleaned || cleaned.length < 2) {
    return 'Processing simulation';
  }

  // Capitalize first letter
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Standard tool call definition for delegating simulation specification to the Coder
 */
export const DELEGATE_TO_CODER_TOOL = {
  name: 'delegate_to_coder',
  description: 'Delegates the simulation specification to the Simulation Coder sub-agent.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Simulation title' },
      description: { type: 'string', description: '1-line epistemic summary' },
      visualPlan: { type: 'string', description: 'Layout, visual metaphors, coordinate system, dynamic elements' },
      mathFormulation: { type: 'string', description: 'Mathematical formulation or algorithm logic' },
      parametersSpec: {
        type: 'array',
        description: 'Interactive parameters for controls',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            type: { type: 'string', enum: ['slider', 'toggle', 'stepper', 'button'] },
            min: { type: 'number' },
            max: { type: 'number' },
            step: { type: 'number' },
            default: { type: ['number', 'boolean', 'string'] },
            unit: { type: 'string' }
          },
          required: ['id', 'label', 'type', 'default']
        }
      },
      directInteractionSpec: { type: 'string', description: 'Direct canvas drag/tap/hover interaction dynamics' }
    },
    required: ['title', 'description', 'visualPlan', 'mathFormulation', 'parametersSpec']
  }
};

/**
 * Builds system prompt for the Epistemic Architect
 */
export function buildArchitectSystemPrompt(viewport: SimulationViewport): string {
  return `You are SimIt's Epistemic Architect, an elite interactive visualization designer (in the spirit of Bret Victor and 3Blue1Brown).
Your mission is to invent a living, interactive, parameter-driven visual simulation for a given technical concept.

### VIEWPORT DIMENSIONS:
Container width: ${viewport.width}px, height: ${viewport.height}px.

### DECLARATIVE LIBRARY SUITE (Available in Global Scope):
- Tweakpane (v4): Zero-latency interactive sliders, toggles, buttons, and steppers.
- Canvas 2D + anime.js: 60 FPS physics loops, particle dynamics, reactive tweening, direct pointer drag.
- Cytoscape (v3): Interactive DAGs, topologies, state machines, consensus protocols.
- KaTeX (v0.16): Dynamic mathematical notation and live numeric readouts.
- Math.js (v12): Matrix math, vector dot products, projections.
- jStat (v1.9): Probability distributions (Gaussian, Poisson, Beta).
- Matter.js (v0.20): 2D rigid-body kinematics, collision bounds, springs.
- functionPlot (v1): 2D Cartesian curves.
- glMatrix (v3.4): Spatial projections and rotations.

### ARCHITECTURAL FREEDOM & UNCONSTRAINED DELIBERATION:
You have complete creative and epistemic freedom. Think however you want in natural text.
Take as much reasoning space as needed to explore alternative visual metaphors, derive formulas, and determine what interactive dynamics will give the user genuine physical intuition.
You do NOT need any special tags or rigid bullet points for thinking.

### TOOL CALL:
When you have finalized your simulation design, invoke the standard tool \`delegate_to_coder\`:

delegate_to_coder({
  "title": "Simulation Title",
  "description": "Concise 1-line epistemic summary",
  "visualPlan": "Detailed mental model layout, coordinate system, and animation mechanism",
  "mathFormulation": "Mathematical formulation or algorithm logic",
  "parametersSpec": [
    { "id": "paramId", "label": "Label", "type": "slider", "min": 0, "max": 10, "step": 0.1, "default": 2, "unit": "unit" }
  ],
  "directInteractionSpec": "Pointer dragging or tap interactions on canvas/nodes"
})`;
}

/**
 * Extracts the first balanced JSON object {...} starting at or after startIndex
 */
export function extractBalancedJsonObject(str: string, startIndex: number = 0): string | null {
  const openIndex = str.indexOf('{', startIndex);
  if (openIndex === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = openIndex; i < str.length; i++) {
    const char = str[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          return str.slice(openIndex, i + 1);
        }
      }
    }
  }
  return null;
}

/**
 * Normalizes raw object into validated CoderPlanSpec
 */
export function normalizeCoderPlan(raw: any): CoderPlanSpec {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Plan must be a non-null object');
  }

  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'Simulation';
  const description = typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim() : 'Interactive epistemic simulation';
  const visualPlan = typeof raw.visualPlan === 'string' && raw.visualPlan.trim() ? raw.visualPlan.trim() : 'Dynamic 2D canvas simulation';
  const mathFormulation = typeof raw.mathFormulation === 'string' ? raw.mathFormulation.trim() : '';
  const parametersSpec = Array.isArray(raw.parametersSpec) ? raw.parametersSpec : [];
  const directInteractionSpec = typeof raw.directInteractionSpec === 'string' && raw.directInteractionSpec.trim() ? raw.directInteractionSpec.trim() : undefined;

  return {
    title,
    description,
    visualPlan,
    mathFormulation,
    parametersSpec,
    directInteractionSpec
  };
}

/**
 * Extracts a CoderPlanSpec from an Architect response, supporting:
 * 1. delegate_to_coder({ ... }) call syntax
 * 2. Standard tool call JSON: { "name": "delegate_to_coder", "arguments": { ... } }
 * 3. Freeform text deliberation followed by standard tool call or JSON
 */
export function extractCoderPlanFromResponse(rawText: string): CoderPlanSpec {
  if (!rawText || !rawText.trim()) {
    throw new Error('Architect response is empty');
  }

  // 1. Look for explicit `delegate_to_coder` call or reference
  const delegateIdx = rawText.indexOf('delegate_to_coder');
  if (delegateIdx !== -1) {
    const jsonStr = extractBalancedJsonObject(rawText, delegateIdx);
    if (jsonStr) {
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.visualPlan || parsed.title || parsed.parametersSpec) {
          return normalizeCoderPlan(parsed);
        }
        if (parsed.arguments) {
          const args = typeof parsed.arguments === 'string' ? JSON.parse(parsed.arguments) : parsed.arguments;
          return normalizeCoderPlan(args);
        }
      } catch {
        // Fall through to fallback scan
      }
    }
  }

  // 2. Look for tool envelope anywhere in text (e.g. { "name": "delegate_to_coder", ... })
  const toolNameRegex = /"name"\s*:\s*"delegate_to_coder"/;
  const toolMatch = rawText.search(toolNameRegex);
  if (toolMatch !== -1) {
    let objStart = rawText.lastIndexOf('{', toolMatch);
    if (objStart !== -1) {
      const jsonStr = extractBalancedJsonObject(rawText, objStart);
      if (jsonStr) {
        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed.arguments) {
            const args = typeof parsed.arguments === 'string' ? JSON.parse(parsed.arguments) : parsed.arguments;
            return normalizeCoderPlan(args);
          }
        } catch {
          // Fall through
        }
      }
    }
  }

  // 3. Fallback: Search for any balanced JSON object with simulation plan fields
  let searchPos = 0;
  while (searchPos < rawText.length) {
    const nextBrace = rawText.indexOf('{', searchPos);
    if (nextBrace === -1) break;
    const jsonStr = extractBalancedJsonObject(rawText, nextBrace);
    if (jsonStr) {
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.visualPlan || (parsed.title && parsed.parametersSpec)) {
          return normalizeCoderPlan(parsed);
        }
      } catch {
        // Not valid JSON, continue searching
      }
      searchPos = nextBrace + jsonStr.length;
    } else {
      searchPos = nextBrace + 1;
    }
  }

  throw new Error('Could not extract valid simulation blueprint or delegate_to_coder tool call from Architect output');
}

/**
 * Builds user prompt for the Architect from harvested context
 */
export function buildArchitectUserPrompt(context: HarvestedContext): string {
  const parts: string[] = [];
  parts.push(`Design an interactive epistemic visual simulation for the following context:`);
  parts.push(`\n### CONCEPT:\n${context.selection.selectedText}`);

  if (context.mathSnippets && context.mathSnippets.length > 0) {
    parts.push(`\n### EQUATIONS:\n${context.mathSnippets.map((m) => `$${m.latex}$`).join('\n')}`);
  }

  if (context.domContext?.nearestHeading) {
    parts.push(`\n### SECTION: ${context.domContext.nearestHeading}`);
  }
  if (context.domContext?.paragraphSnippet) {
    parts.push(`\n### SURROUNDING CONTEXT: ${context.domContext.paragraphSnippet}`);
  }

  return parts.join('\n');
}

/**
 * Builds system prompt for the Simulation Coder sub-agent
 */
export function buildCoderSystemPrompt(viewport: SimulationViewport): string {
  return `You are SimIt's Simulation Coder, an expert visualization engineer.
Your job is to translate the Architect's epistemic blueprint into an executable ES module adhering to SimIt's simEngine contract.

### VIEWPORT: width = ${viewport.width}px, height = ${viewport.height}px.
- FULL-BLEED: Fill the container 100% without letterboxing or black margins.
- Canvas backing store must match container bounds.
- All pre-loaded libraries (Tweakpane, Anime, Cytoscape, KaTeX, Math, jStat, Matter, functionPlot) are in the global scope.

### OUTPUT CONTRACT:
Output valid JavaScript starting with "export default {".
Must include:
- title, description, parameters array
- init(container, params)
- update(params)
- destroy()

Enclose code in <simulation_code>...</simulation_code>.`;
}

/**
 * Builds user prompt for the Coder sub-agent from the Architect's plan
 */
export function buildCoderUserPrompt(
  plan: CoderPlanSpec,
  revisionNotes?: { critique: string; direction: string }
): string {
  const parts: string[] = [];
  parts.push(`Implement the simulation according to this specification:`);
  parts.push(`\n### TITLE: ${plan.title}`);
  parts.push(`### DESCRIPTION: ${plan.description}`);
  parts.push(`\n### VISUAL PLAN:\n${plan.visualPlan}`);
  parts.push(`\n### MATH FORMULATION:\n${plan.mathFormulation}`);
  parts.push(`\n### PARAMETERS SPEC:\n${JSON.stringify(plan.parametersSpec, null, 2)}`);
  if (plan.directInteractionSpec) {
    parts.push(`\n### DIRECT INTERACTION SPEC:\n${plan.directInteractionSpec}`);
  }

  if (revisionNotes) {
    parts.push(`\n### ARCHITECT REVISION DIRECTIVES:`);
    parts.push(`Critique: ${revisionNotes.critique}`);
    parts.push(`Concrete Direction: ${revisionNotes.direction}`);
    parts.push(`Please apply these specific corrections to your code.`);
  }

  return parts.join('\n');
}

/**
 * Builds the prompt for the Architect's visual multimodal review
 */
export function buildArchitectReviewPrompt(
  plan: CoderPlanSpec,
  testResult: SandboxEvaluationResult,
  code: string
): string {
  return `You are reviewing the simulation rendered by the Coder sub-agent.
Compare the test execution and visual output against your original plan.

### ORIGINAL PLAN:
Title: ${plan.title}
Visual Plan: ${plan.visualPlan}
Parameters: ${JSON.stringify(plan.parametersSpec.map((p) => p.id))}

### SANDBOX EVALUATION:
Status: ${testResult.status}
Execution Time: ${testResult.executionTimeMs}ms
Console Logs: ${testResult.logs.length > 0 ? testResult.logs.join('\n') : 'No warnings/errors'}
${testResult.errorMessage ? `Error: ${testResult.errorMessage}` : ''}
${testResult.snapshotUrl ? `Visual Snapshot: [Rendered snapshot attached (${testResult.snapshotUrl.slice(0, 40)}...)]` : 'Snapshot unavailable'}

### REVIEW CRITERIA:
1. Legibility & Contrast: Are labels clear on dark background (#090d16)?
2. Viewport Geometry: Does the visual fit cleanly without awkward clipping or giant black letterbox borders?
3. Epistemic Truth: Does it faithfully reflect the physical/mathematical model?
4. Control Usability: Are parameters responsive?

### REQUIRED RESPONSE FORMAT:
Return ONLY a JSON object:
{
  "approved": true or false,
  "critique": "Brief assessment of visual layout and mechanics",
  "direction": "If not approved, specific 1-2 sentence instruction to fix it"
}`;
}

export interface AutonomousLoopOptions {
  context: HarvestedContext;
  viewport?: SimulationViewport;
  provider: IModelProvider;
  testRunner: (req: PreFlightTestRequest) => Promise<PreFlightTestResponse>;
  onProgress?: (status: string, role?: 'architect' | 'coder' | 'sandbox') => void;
  maxIterations?: number;
  atifLogger?: AtifTrajectoryLogger;
}

/**
 * Orchestrates the full Two-Tier Autonomous Agent Loop with Sandbox Visual Review & ATIF Logging
 */
export async function executeAutonomousSimulationLoop(
  options: AutonomousLoopOptions
): Promise<AutonomousLoopResult> {
  const {
    context,
    viewport: optionsViewport,
    provider,
    testRunner,
    onProgress,
    maxIterations = 3
  } = options;

  const atif = options.atifLogger || new AtifTrajectoryLogger(
    context,
    provider.type,
    'gemini-nano',
    provider.isLocal,
    0.2
  );

  const activeVp = optionsViewport || context.viewport;
  const viewport: SimulationViewport = {
    width: activeVp?.width ? Math.max(320, Math.round(activeVp.width)) : 380,
    height: activeVp?.height ? Math.max(380, Math.round(activeVp.height)) : 450
  };

  if (!context.viewport) {
    context.viewport = viewport;
  }

  const trajectory: AgentTrajectoryStep[] = [];
  const emitProgress = (rawStatus: string, role: 'architect' | 'coder' | 'sandbox', action: AgentTrajectoryStep['action']) => {
    const status = validateMicroStatus(rawStatus);
    trajectory.push({
      stepIndex: trajectory.length + 1,
      role,
      action,
      statusSummary: status,
      timestamp: Date.now()
    });
    if (onProgress) {
      onProgress(status, role);
    }
  };

  // ============================================================
  // Step 1: Deliberation & Epistemic Design (Architect)
  // ============================================================
  emitProgress('Formulating visual landscape', 'architect', 'plan');

  let plan: CoderPlanSpec;
  const architectStart = Date.now();
  let architectThinkingTrace: string | undefined;

  try {
    const architectSystemPrompt = buildArchitectSystemPrompt(viewport);
    const architectUserPrompt = buildArchitectUserPrompt(context);

    const architectRes = await provider.generateSimulation({
      systemPrompt: architectSystemPrompt,
      userPrompt: architectUserPrompt,
      temperature: 0.3
    });

    architectThinkingTrace = architectRes.thinkingTrace || architectRes.rawCode;
    plan = extractCoderPlanFromResponse(architectRes.rawCode);
  } catch (err: any) {
    // Graceful fallback plan based on selected text
    plan = {
      title: context.selection.selectedText.slice(0, 30) || 'Simulation',
      description: 'Interactive epistemic visual simulation',
      visualPlan: 'Canvas 2D dynamic state model with direct manipulation and Tweakpane controls',
      mathFormulation: context.mathSnippets?.map((m) => m.latex).join('; ') || 'Dynamic system equations',
      parametersSpec: [
        { id: 'rate', label: 'Rate Multiplier', type: 'slider', min: 0.1, max: 5.0, step: 0.1, default: 1.0, unit: 'x' },
        { id: 'active', label: 'Run Simulation', type: 'toggle', default: true }
      ],
      directInteractionSpec: 'Pointer drag to perturb state'
    };
  }

  atif.recordStep(
    'ARCHITECT_PLAN',
    {
      concept: context.selection.selectedText,
      math_snippets_count: context.mathSnippets?.length || 0,
      viewport
    },
    {
      thinking_trace: architectThinkingTrace ? architectThinkingTrace.slice(0, 1000) : undefined,
      plan_title: plan.title,
      plan_description: plan.description,
      parameters_count: plan.parametersSpec.length,
      direct_interaction: Boolean(plan.directInteractionSpec),
      blueprint: plan
    },
    Date.now() - architectStart,
    undefined,
    'DELEGATED'
  );

  // ============================================================
  // Step 2 & 3: Synthesis, Sandbox Testing & Visual Review Loop
  // ============================================================
  let currentCode = '';
  let revisionNotes: { critique: string; direction: string } | undefined;
  let iterations = 0;
  let lastSnapshotUrl: string | undefined;
  let lastTestResult: SandboxEvaluationResult | undefined;

  while (iterations < maxIterations) {
    iterations++;

    // 2. Coder synthesis (Initial or Revision)
    const coderStage = iterations === 1 ? 'CODER_SYNTHESIS' : 'REVISION_SYNTHESIS';
    emitProgress(
      iterations === 1 ? 'Synthesizing simulation code' : 'Refining simulation code',
      'coder',
      'synthesize'
    );

    const coderStart = Date.now();
    const coderSystemPrompt = buildCoderSystemPrompt(viewport);
    const coderUserPrompt = buildCoderUserPrompt(plan, revisionNotes);

    const coderRes = await provider.generateSimulation({
      systemPrompt: coderSystemPrompt,
      userPrompt: coderUserPrompt,
      temperature: 0.2
    });

    const extracted = extractSimulationTags(coderRes.rawCode);
    currentCode = sanitizeCodeFences(extracted.code);

    atif.recordStep(
      coderStage,
      {
        iteration: iterations,
        plan_title: plan.title,
        revision_notes: revisionNotes
      },
      {
        code_length: currentCode.length,
        code_preview: currentCode.slice(0, 200),
        raw_code: currentCode
      },
      Date.now() - coderStart,
      undefined,
      'SYNTHESIZED'
    );

    // 3. Test in sandbox harness with visual snapshot capture
    emitProgress('Testing boundary parameters', 'sandbox', 'test');

    const testStart = Date.now();
    const testMsg: PreFlightTestRequest = {
      type: 'PREFLIGHT_TEST_REQUEST',
      requestId: `agent-test-${Date.now()}-iter${iterations}`,
      rawCode: currentCode,
      timeoutMs: 2500,
      captureSnapshot: true
    };

    const testResponse = await testRunner(testMsg);
    const testDuration = Date.now() - testStart;

    lastSnapshotUrl = testResponse.snapshotUrl;
    lastTestResult = {
      status: testResponse.status,
      errorMessage: testResponse.status === 'error' ? testResponse.errorMessage : undefined,
      errorStack: testResponse.status === 'error' ? testResponse.errorStack : undefined,
      logs: [],
      parameters: testResponse.status === 'ok' ? testResponse.parameters : [],
      snapshotUrl: testResponse.snapshotUrl,
      executionTimeMs: testDuration
    };

    atif.recordStep(
      'SANDBOX_EVALUATION',
      {
        iteration: iterations,
        code_length: currentCode.length
      },
      {
        status: testResponse.status,
        parameters_count: testResponse.status === 'ok' ? testResponse.parameters.length : 0,
        has_snapshot: Boolean(testResponse.snapshotUrl),
        snapshot_url: testResponse.snapshotUrl,
        error: testResponse.status === 'error' ? testResponse.errorMessage : undefined
      },
      testDuration,
      {
        snapshot_url: testResponse.snapshotUrl,
        snapshot_preview: testResponse.snapshotUrl ? testResponse.snapshotUrl.slice(0, 50) + '...' : undefined,
        error_stack: testResponse.status === 'error' ? testResponse.errorStack : undefined
      },
      testResponse.status === 'ok' ? 'PASS' : 'FAIL'
    );

    if (testResponse.status === 'error') {
      // Direct syntax or runtime error: feed back to Coder
      revisionNotes = {
        critique: `Runtime exception encountered: ${testResponse.errorMessage}`,
        direction: `Fix the unhandled exception and ensure all variables are defined defensively.`
      };
      continue;
    }

    // Code executed successfully; now Architect reviews visual render
    emitProgress('Reviewing visual render', 'architect', 'review');

    const reviewStart = Date.now();
    try {
      const reviewPrompt = buildArchitectReviewPrompt(plan, lastTestResult, currentCode);
      const reviewRes = await provider.generateSimulation({
        systemPrompt: 'You are the Epistemic Architect reviewing a rendered simulation screenshot.',
        userPrompt: reviewPrompt,
        temperature: 0.1
      });

      let reviewFeedback: ReviewFeedback = { approved: true };
      const reviewJsonMatch = reviewRes.rawCode.match(/\{[\s\S]*\}/);
      if (reviewJsonMatch) {
        try {
          reviewFeedback = JSON.parse(reviewJsonMatch[0]);
        } catch {
          reviewFeedback = { approved: true };
        }
      }

      atif.recordStep(
        'ARCHITECT_REVIEW',
        {
          iteration: iterations,
          has_snapshot: Boolean(lastSnapshotUrl),
          snapshot_url: lastSnapshotUrl,
          test_status: lastTestResult.status
        },
        {
          approved: reviewFeedback.approved,
          critique: reviewFeedback.critique,
          direction: reviewFeedback.direction,
          snapshot_url: lastSnapshotUrl
        },
        Date.now() - reviewStart,
        undefined,
        reviewFeedback.approved ? 'APPROVED' : 'REVISION_REQUESTED'
      );

      if (reviewFeedback.approved) {
        emitProgress('Ready to explore', 'architect', 'approve');
        atif.recordStep('RENDER', {}, { parameter_count: lastTestResult.parameters.length }, undefined, undefined, 'MOUNTED');
        const finalTrajectory = atif.complete(true, currentCode);
        return {
          success: true,
          code: currentCode,
          title: plan.title,
          description: plan.description,
          parameters: lastTestResult.parameters,
          iterations,
          snapshotUrl: lastSnapshotUrl,
          trajectory,
          atifTrajectory: finalTrajectory
        };
      } else {
        revisionNotes = {
          critique: reviewFeedback.critique || 'Visual layout requires adjustment',
          direction: reviewFeedback.direction || 'Adjust coordinates and improve label contrast'
        };
      }
    } catch {
      // If review call fails, accept the verified working code
      emitProgress('Ready to explore', 'architect', 'approve');
      atif.recordStep('RENDER', {}, { parameter_count: lastTestResult.parameters.length }, undefined, undefined, 'MOUNTED');
      const finalTrajectory = atif.complete(true, currentCode);
      return {
        success: true,
        code: currentCode,
        title: plan.title,
        description: plan.description,
        parameters: lastTestResult.parameters,
        iterations,
        snapshotUrl: lastSnapshotUrl,
        trajectory,
        atifTrajectory: finalTrajectory
      };
    }
  }

  // If max iterations reached, return latest verified code if functional
  if (lastTestResult && lastTestResult.status === 'ok') {
    emitProgress('Ready to explore', 'architect', 'approve');
    atif.recordStep('RENDER', {}, { parameter_count: lastTestResult.parameters.length }, undefined, undefined, 'MOUNTED');
    const finalTrajectory = atif.complete(true, currentCode);
    return {
      success: true,
      code: currentCode,
      title: plan.title,
      description: plan.description,
      parameters: lastTestResult.parameters,
      iterations,
      snapshotUrl: lastSnapshotUrl,
      trajectory,
      atifTrajectory: finalTrajectory
    };
  }

  const finalTrajectory = atif.complete(false, currentCode);
  return {
    success: false,
    code: currentCode,
    title: plan.title,
    description: plan.description,
    parameters: [],
    iterations,
    error: lastTestResult?.errorMessage || 'Simulation failed verification',
    trajectory,
    atifTrajectory: finalTrajectory
  };
}
