/**
 * SimIt Autonomous Multi-Agent Orchestrator
 * Conforms to docs/specs/autonomous_agent_architecture.md and docs/specs/agent_loop.md#10
 * 
 * Features:
 * 1. Two-Tier Specialization: Epistemic Architect & Coder sub-agent with explicit token budgets.
 * 2. Unconstrained Creative Deliberation: Free use of declarative libraries without rigid regex archetypes.
 * 3. Micro-Progress Reporting: Strictly 1 line, 3-5 words, zero "Architect:" / "Coder:" prefixes.
 * 4. Multi-Phase Sandbox Verification & Visual Snapshot Capture: Runs init + rAF soak + min/max sweep.
 * 5. True Multimodal Visual Review Loop: Architect inspects real PNG/WebP screenshots (or text-only fallback).
 * 6. Convergence Guardrail & Quality Flags: Explicit QualityFlag tracking across fallbacks.
 */

import { HarvestedContext } from '../types/harvester';
import { IModelProvider, ImageAttachment } from '../types/models';
import { SimulationViewport } from '../providers/prompt-builder';
import { PreFlightTestRequest, PreFlightTestResponse } from '../types/ipc';
import {
  AGENT_TOKEN_BUDGETS,
  CoderPlanSpec,
  ExplanationLegendItem,
  ExplanationTourStep,
  PedagogySpec,
  ReviewFeedback,
  SandboxEvaluationResult,
  SimulationExplanation,
  AgentTrajectoryStep,
  AutonomousLoopResult,
  RevisionContext,
  ReviewMode,
  QualityFlag
} from '../types/agent';
import { RuntimeErrorRecord, VerificationDiagnostic } from '../types/verification';
import { AtifTrajectoryLogger } from '../export/atif-logger';
import { sanitizeCodeFences, extractSimulationTags } from './preflight';
import { parseDataUrl } from '../providers/multimodal';
import {
  buildModuleContractPromptSection,
  computeStageGeometry,
  DEFAULT_HOST_LAYOUT
} from './module-contract';
import { formatDiagnosticsForCoder } from './verification';

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
      directInteractionSpec: { type: 'string', description: 'Direct canvas drag/tap/hover interaction dynamics' },
      pedagogy: {
        type: 'object',
        description: 'Pedagogical blueprint for newcomer comprehension',
        properties: {
          coreInsight: { type: 'string', description: 'The single core takeaway in one plain-English sentence' },
          prerequisites: {
            type: 'array',
            items: { type: 'string' },
            description: '2-3 background concepts a newcomer must recognize'
          },
          misconception: {
            type: 'string',
            description: 'What newcomers typically misunderstand that this simulation visually disproves'
          },
          ahaExperiment: {
            type: 'string',
            description: 'Concrete parameter manipulation ("try this -> notice that") that makes the insight click'
          },
          symbolMap: {
            type: 'array',
            description: 'Mapping of source symbols/variables to visual elements',
            items: {
              type: 'object',
              properties: {
                symbol: { type: 'string' },
                meaning: { type: 'string' },
                color: { type: 'string' }
              },
              required: ['symbol', 'meaning']
            }
          }
        },
        required: ['coreInsight', 'misconception', 'ahaExperiment', 'symbolMap']
      },
      explanation: {
        type: 'object',
        description: 'Host-rendered explanation and live parameter-driven guided tour',
        properties: {
          insight: { type: 'string', description: 'Plain-English core takeaway' },
          legend: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                symbol: { type: 'string' },
                meaning: { type: 'string' },
                color: { type: 'string' }
              },
              required: ['symbol', 'meaning']
            }
          },
          tour: {
            type: 'array',
            description: '2-4 guided tour steps that drive the live simulation via params',
            items: {
              type: 'object',
              properties: {
                caption: { type: 'string' },
                params: { type: 'object' },
                highlight: { type: 'string' },
                tryThis: { type: 'string' },
                noticeThat: { type: 'string' }
              },
              required: ['caption', 'params']
            }
          }
        },
        required: ['insight', 'legend', 'tour']
      }
    },
    required: ['title', 'description', 'visualPlan', 'mathFormulation', 'parametersSpec']
  }
};

/**
 * Builds system prompt for the Epistemic Architect
 */
export function buildArchitectSystemPrompt(viewport: SimulationViewport): string {
  return `You are SimIt's Epistemic Architect, an elite interactive visualization designer (in the spirit of Bret Victor and 3Blue1Brown).
Your mission is to invent a living, interactive, parameter-driven visual simulation that makes a technical concept immediately comprehensible to a curious newcomer.

### VIEWPORT DIMENSIONS:
Container width: ${viewport.width}px, height: ${viewport.height}px.

### DECLARATIVE LIBRARY SUITE (Available in Global Scope):
- Tweakpane (v4): Automatically mounted by the SimIt Host from your \`parametersSpec\` in a collapsible bottom controls drawer (NEVER instruct the Coder to instantiate \`new Tweakpane.Pane()\` or HTML \`<input>\`/\`<select>\`/\`<button>\` elements inside \`#sim-root\`).
- Canvas 2D + anime.js: 60 FPS physics loops, particle dynamics, reactive tweening, direct pointer drag.
- Cytoscape (v3): Interactive DAGs, topologies, state machines, consensus protocols.
- KaTeX (v0.16): Dynamic mathematical notation and live numeric readouts.
- Math.js (v12): Matrix math, vector dot products, projections.
- jStat (v1.9): Probability distributions (Gaussian, Poisson, Beta).
- Matter.js (v0.20): 2D rigid-body kinematics, collision bounds, springs.
- functionPlot (v1): 2D Cartesian curves.
- glMatrix (v3.4): Spatial projections and rotations.

### PEDAGOGY PHASE (MANDATORY BEFORE VISUAL DESIGN):
Before choosing visual layouts or equations, explicitly deliberate on how a newcomer will *understand* the concept:
1. **Core Insight (\`coreInsight\`)**: Formulate the single core takeaway in one plain-English sentence.
2. **Prerequisites (\`prerequisites\`)**: Identify the 2–3 foundational concepts a newcomer must recognize on screen.
3. **Target Misconception (\`misconception\`)**: State what newcomers typically misunderstand about this topic and how the visual dynamics will disprove it.
4. **Aha Experiment (\`ahaExperiment\`)**: Design a concrete "try this -> notice that" parameter manipulation that makes the core insight click.
5. **Source Symbol Legend (\`symbolMap\` & \`explanation.legend\`)**: Map every key symbol/term from the user's selected text and equations (\`symbol\`, \`meaning\`, \`color\`) to a concrete visual element on screen.
6. **Live Guided Tour (\`explanation.tour\`)**: Design a 2–4 step interactive walkthrough where each step specifies a \`caption\`, concrete \`params\` overrides (matching \`parametersSpec\` IDs), optional \`highlight\` selector, \`tryThis\`, and \`noticeThat\`.
- **CRITICAL GUIDED TOUR RULE**: Guided tours (\`explanation.tour\`) must drive the live simulation model via parameter updates (\`params\` passed to \`update(params)\`); never hardcode static frames or disconnected slides.

### ARCHITECTURAL FREEDOM & UNCONSTRAINED DELIBERATION:
You have complete creative and epistemic freedom. Think however you want in natural text.
Take as much reasoning space as needed to work through the Pedagogy Phase, explore alternative visual metaphors, derive formulas, and determine what interactive dynamics will give the user genuine physical intuition.
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
  "directInteractionSpec": "Pointer dragging or tap interactions on canvas/nodes",
  "pedagogy": {
    "coreInsight": "One-sentence plain-English takeaway.",
    "prerequisites": ["Concept 1", "Concept 2"],
    "misconception": "Common misconception disproved by this visual.",
    "ahaExperiment": "Drag paramId from 2 to 8 and notice the regime transition.",
    "symbolMap": [
      { "symbol": "paramId", "meaning": "Physical meaning on screen", "color": "#38bdf8" }
    ]
  },
  "explanation": {
    "insight": "One-sentence plain-English takeaway.",
    "legend": [
      { "symbol": "paramId", "meaning": "Physical meaning on screen", "color": "#38bdf8" }
    ],
    "tour": [
      {
        "caption": "Step 1: Observe the default baseline behavior.",
        "params": { "paramId": 2 },
        "tryThis": "Watch the steady trajectory.",
        "noticeThat": "The amplitude remains bounded."
      },
      {
        "caption": "Step 2: Increase paramId to trigger the high-gain regime.",
        "params": { "paramId": 8 },
        "tryThis": "Compare the new oscillation speed.",
        "noticeThat": "Higher paramId compresses the wavelength."
      }
    ]
  }
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

function normalizeSymbolLegend(
  rawList: any,
  parametersSpec: any[]
): Array<{ symbol: string; meaning: string; visualElement?: string; color?: string; elementId?: string }> {
  if (Array.isArray(rawList) && rawList.length > 0) {
    const valid = rawList
      .filter((item: any) => item && typeof item === 'object' && typeof item.symbol === 'string' && typeof item.meaning === 'string')
      .map((item: any) => ({
        symbol: String(item.symbol).trim(),
        meaning: String(item.meaning).trim(),
        ...(typeof item.visualElement === 'string' && item.visualElement.trim()
          ? { visualElement: item.visualElement.trim() }
          : {}),
        ...(typeof item.elementId === 'string' && item.elementId.trim()
          ? { elementId: item.elementId.trim() }
          : {}),
        ...(typeof item.color === 'string' && item.color.trim() ? { color: item.color.trim() } : {})
      }))
      .filter((item) => Boolean(item.symbol && item.symbol.length > 0 && item.meaning && item.meaning.length > 0));
    if (valid.length > 0) return valid;
  }

  return parametersSpec
    .filter((p: any) => p && typeof p.id === 'string' && typeof p.label === 'string')
    .slice(0, 4)
    .map((p: any) => ({
      symbol: String(p.id),
      meaning: p.unit ? `${p.label} (${p.unit})` : p.label
    }));
}

function normalizeTourSteps(rawTour: any, parametersSpec: any[], ahaExperiment?: string): ExplanationTourStep[] {
  if (Array.isArray(rawTour) && rawTour.length > 0) {
    const steps = rawTour
      .filter((s: any) => s && typeof s === 'object' && typeof s.caption === 'string' && s.caption.trim().length > 0)
      .map((s: any) => ({
        ...(typeof s.title === 'string' && s.title.trim() ? { title: s.title.trim() } : {}),
        caption: s.caption.trim(),
        params: s.params && typeof s.params === 'object' && !Array.isArray(s.params) ? { ...s.params } : {},
        ...(typeof s.highlight === 'string' && s.highlight.trim()
          ? { highlight: s.highlight.trim() }
          : typeof s.highlightSelector === 'string' && s.highlightSelector.trim()
            ? { highlight: s.highlightSelector.trim(), highlightSelector: s.highlightSelector.trim() }
            : {}),
        ...(typeof s.tryThis === 'string' && s.tryThis.trim() ? { tryThis: s.tryThis.trim() } : {}),
        ...(typeof s.noticeThat === 'string' && s.noticeThat.trim() ? { noticeThat: s.noticeThat.trim() } : {})
      }));
    if (steps.length > 0) return steps;
  }

  const firstSlider = parametersSpec.find((p: any) => p && (p.type === 'slider' || p.type === 'stepper') && typeof p.id === 'string');
  if (firstSlider) {
    const defVal = firstSlider.default ?? firstSlider.min ?? 1;
    const maxVal = firstSlider.max ?? (typeof defVal === 'number' ? defVal * 2 : 2);
    return [
      {
        caption: `Step 1: Observe the baseline state with ${firstSlider.label || firstSlider.id} at ${defVal}.`,
        params: { [firstSlider.id]: defVal }
      },
      {
        caption: ahaExperiment || `Step 2: Increase ${firstSlider.label || firstSlider.id} to ${maxVal} to compare the system response.`,
        params: { [firstSlider.id]: maxVal }
      }
    ];
  }

  return [];
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

  let pedagogy: PedagogySpec | undefined;
  let explanation: SimulationExplanation | undefined;

  const rawPed = raw.pedagogy && typeof raw.pedagogy === 'object' ? raw.pedagogy : undefined;
  const rawExp = raw.explanation && typeof raw.explanation === 'object' ? raw.explanation : undefined;

  if (rawPed || rawExp) {
    const coreInsight =
      (typeof rawPed?.coreInsight === 'string' && rawPed.coreInsight.trim()) ||
      (typeof rawExp?.insight === 'string' && rawExp.insight.trim()) ||
      description;
    const prerequisites = Array.isArray(rawPed?.prerequisites)
      ? rawPed.prerequisites.filter((p: any) => typeof p === 'string' && p.trim().length > 0).map((p: string) => p.trim())
      : [];
    const misconception =
      typeof rawPed?.misconception === 'string' && rawPed.misconception.trim()
        ? rawPed.misconception.trim()
        : 'Static equations hide how coupled variables evolve dynamically.';
    const ahaExperiment =
      typeof rawPed?.ahaExperiment === 'string' && rawPed.ahaExperiment.trim()
        ? rawPed.ahaExperiment.trim()
        : 'Sweep the primary parameter across its boundary values to observe the regime shift.';
    const symbolMap = normalizeSymbolLegend(rawPed?.symbolMap ?? rawExp?.legend, parametersSpec);
    const legend = normalizeSymbolLegend(rawExp?.legend ?? rawPed?.symbolMap, parametersSpec);
    const tour = normalizeTourSteps(rawExp?.tour, parametersSpec, ahaExperiment);

    pedagogy = {
      coreInsight,
      prerequisites,
      misconception,
      ahaExperiment,
      symbolMap
    };

    explanation = {
      insight:
        typeof rawExp?.insight === 'string' && rawExp.insight.trim()
          ? rawExp.insight.trim()
          : coreInsight,
      legend,
      tour
    };
  }

  return {
    title,
    description,
    visualPlan,
    mathFormulation,
    parametersSpec,
    directInteractionSpec,
    ...(pedagogy ? { pedagogy } : {}),
    ...(explanation ? { explanation } : {})
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
    const objStart = rawText.lastIndexOf('{', toolMatch);
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
 * Builds system prompt for the Simulation Coder sub-agent, embedding the authoritative
 * Simulation Module Contract (C1-C7).
 */
export function buildCoderSystemPrompt(viewport: SimulationViewport): string {
  const stage = computeStageGeometry(
    {
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      controlsDrawerHeight: DEFAULT_HOST_LAYOUT.controlsDrawerHeight
    },
    1,
    typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  );

  return `You are SimIt's Simulation Coder, an expert visualization engineer.
Your job is to translate the Architect's epistemic blueprint into an executable ES module adhering to SimIt's simEngine contract.

### VIEWPORT: width = ${viewport.width}px, height = ${viewport.height}px.

${buildModuleContractPromptSection(stage)}`;
}

/**
 * Builds user prompt for the Coder sub-agent from the Architect's plan and optional RevisionContext.
 * Conforms to docs/specs/autonomous_agent_architecture.md#53-the-multimodal-visual-review-prompt--revision-protocol
 */
export function buildCoderUserPrompt(
  plan: CoderPlanSpec,
  revisionNotes?:
    | {
        critique?: string;
        direction?: string;
        previousCode?: string;
        diagnostics?: VerificationDiagnostic[];
        runtimeErrors?: RuntimeErrorRecord[];
      }
    | RevisionContext,
  context?: HarvestedContext
): string {
  const parts: string[] = [];
  parts.push(`Implement the simulation according to this specification:`);
  parts.push(`\n### TITLE: ${plan.title}`);
  parts.push(`### DESCRIPTION: ${plan.description}`);
  if (context?.selection?.selectedText) {
    parts.push(`\n### SOURCE CONCEPT:\n${context.selection.selectedText}`);
  }
  if (context?.mathSnippets && context.mathSnippets.length > 0) {
    parts.push(
      `\n### SOURCE EQUATIONS:\n${context.mathSnippets.map(m => `- ${m.latex}`).join('\n')}`
    );
  }
  if (context?.domContext) {
    const domLines: string[] = [];
    if (context.domContext.nearestHeading) {
      domLines.push(`Section Heading: ${context.domContext.nearestHeading}`);
    }
    if (context.domContext.caption) {
      domLines.push(`Caption: ${context.domContext.caption}`);
    }
    if (context.domContext.paragraphSnippet) {
      domLines.push(`Surrounding Paragraph: ${context.domContext.paragraphSnippet}`);
    }
    if (domLines.length > 0) {
      parts.push(`\n### SOURCE DOM CONTEXT:\n${domLines.join('\n')}`);
    }
  }
  parts.push(`\n### VISUAL PLAN:\n${plan.visualPlan}`);
  parts.push(`\n### MATH FORMULATION:\n${plan.mathFormulation}`);
  parts.push(`\n### PARAMETERS SPEC:\n${JSON.stringify(plan.parametersSpec, null, 2)}`);
  if (plan.directInteractionSpec) {
    parts.push(`\n### DIRECT INTERACTION SPEC:\n${plan.directInteractionSpec}`);
  }
  if (plan.pedagogy) {
    parts.push(`\n### PEDAGOGY & EPISTEMIC GOALS:`);
    parts.push(`- Core Insight: ${plan.pedagogy.coreInsight}`);
    if (plan.pedagogy.prerequisites && plan.pedagogy.prerequisites.length > 0) {
      parts.push(`- Prerequisites: ${plan.pedagogy.prerequisites.join(', ')}`);
    }
    parts.push(`- Target Misconception: ${plan.pedagogy.misconception}`);
    parts.push(`- Aha Experiment: ${plan.pedagogy.ahaExperiment}`);
    if (plan.pedagogy.symbolMap && plan.pedagogy.symbolMap.length > 0) {
      parts.push(
        `- Symbol Map:\n${plan.pedagogy.symbolMap
          .map(
            s =>
              `  * ${s.symbol}: ${s.meaning}${s.visualElement ? ` -> Rendered as: ${s.visualElement}` : ''}${s.color ? ` (${s.color})` : ''}`
          )
          .join('\n')}`
      );
    }
  }
  if (plan.explanation) {
    parts.push(
      `\n### EXPLANATION & GUIDED TOUR BLUEPRINT (export on module as \`explanation\`):\n${JSON.stringify(
        plan.explanation,
        null,
        2
      )}`
    );
  } else {
    parts.push(
      `\n### EXPLANATION & GUIDED TOUR REQUIREMENT:\nExport \`explanation: { insight, legend, tour }\` on the default-exported module so the host UI can render the core takeaway, symbol legend, and a 2-4 step parameter-driven guided tour.`
    );
  }

  if (revisionNotes) {
    if (revisionNotes.previousCode) {
      parts.push(`\n### PREVIOUS SIMULATION CODE (TO BE PATCHED):`);
      parts.push(`<previous_code>\n${revisionNotes.previousCode}\n</previous_code>`);
    }

    const diags = revisionNotes.diagnostics || [];
    const rErrors = revisionNotes.runtimeErrors || [];
    if (diags.length > 0 || rErrors.length > 0) {
      parts.push(`\n### VERIFICATION HARNESS FINDINGS:`);
      parts.push(formatDiagnosticsForCoder({ diagnostics: diags, runtimeErrors: rErrors }));
    }

    const critique =
      'review' in revisionNotes && revisionNotes.review
        ? revisionNotes.review.critique
        : (revisionNotes as any).critique;
    const direction =
      'review' in revisionNotes && revisionNotes.review
        ? revisionNotes.review.direction
        : (revisionNotes as any).direction;

    if (critique || direction) {
      parts.push(`\n### ARCHITECT REVISION DIRECTIVES:`);
      if (critique) parts.push(`Critique: ${critique}`);
      if (direction) parts.push(`Concrete Direction: ${direction}`);
      parts.push(`Please apply these specific corrections to your code.`);
    }
  }

  return parts.join('\n');
}

/** Alias for buildCoderUserPrompt matching autonomous_agent_architecture.md spec naming. */
export const buildCoderRevisionPrompt = buildCoderUserPrompt;

/**
 * Builds the prompt for the Architect's visual multimodal review.
 * Conforms to docs/specs/autonomous_agent_architecture.md#53-the-multimodal-visual-review-prompt
 */
export function buildArchitectReviewPrompt(
  plan: CoderPlanSpec,
  testResult: SandboxEvaluationResult,
  code: string
): string {
  const diagnostics = testResult.diagnostics || testResult.report?.diagnostics || [];
  const runtimeErrors =
    testResult.runtimeErrors ||
    (testResult.errorMessage
      ? [{ phase: 'init' as const, message: testResult.errorMessage, stack: testResult.errorStack }]
      : []);

  return `You are reviewing the simulation rendered by the Coder sub-agent.
Compare the test execution, diagnostics, and visual snapshot output against your original plan and previous code.

### ORIGINAL PLAN:
Title: ${plan.title}
Visual Plan: ${plan.visualPlan}
Parameters: ${JSON.stringify(plan.parametersSpec.map((p) => p.id))}
${plan.pedagogy ? `Core Insight: ${plan.pedagogy.coreInsight}\nTarget Misconception: ${plan.pedagogy.misconception}\nAha Experiment: ${plan.pedagogy.ahaExperiment}${plan.pedagogy.symbolMap && plan.pedagogy.symbolMap.length > 0 ? `\nSymbol Map: ${plan.pedagogy.symbolMap.map(s => `${s.symbol}: ${s.meaning}${s.visualElement ? ` -> ${s.visualElement}` : ''}`).join('; ')}` : ''}` : ''}

### VERIFICATION DIAGNOSTICS & LOGS:
Status: ${testResult.status}
Execution Time: ${testResult.executionTimeMs}ms
Diagnostics: ${JSON.stringify(diagnostics)}
Runtime Errors: ${runtimeErrors.length > 0 ? JSON.stringify(runtimeErrors) : 'None'}

### SUBMITTED SIMULATION CODE:
\`\`\`javascript
${code}
\`\`\`

### REVIEW CRITERIA:
1. Legibility & Contrast: Are visual labels clear on dark background (#090d16)?
2. Viewport Geometry: Does the visual fit cleanly inside the designated stage without awkward clipping or giant black letterbox borders?
3. Epistemic Truth: Does it faithfully reflect the physical/mathematical model?
4. Control Usability: Are parameters responsive across boundary values?
5. Newcomer Element Identifiability: Can a newcomer identify every visual element on screen via clear on-canvas labels or \`explanation.legend\`?
6. Default Insight Visibility: Does the default parameter state immediately demonstrate the core insight (\`pedagogy.coreInsight\` / \`explanation.insight\`) rather than a static or degenerate state?
7. Source Symbol Consistency: Do the symbols and variable names on screen and in \`explanation.legend\` match the source equations and text?
8. Live Parameter-Driven Tour: Does \`explanation.tour\` drive the live simulation model via real parameter updates (\`params\` passed to \`update(params)\`) rather than hardcoded static frames or disconnected slides?

### REQUIRED RESPONSE FORMAT:
Return ONLY a JSON object:
{
  "approved": true or false,
  "critique": "Brief assessment of visual layout, pedagogical clarity, and mechanics",
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
 * Extracts ImageAttachments from a VerificationReport's frames or fallback snapshotUrl.
 * Supports both `frame.image: ImageAttachment` (canonical) and legacy `frame.dataUrl: string`.
 */
function extractImageAttachments(
  reportFrames?: any[],
  fallbackSnapshotUrl?: string
): ImageAttachment[] {
  const images: ImageAttachment[] = [];
  if (reportFrames && reportFrames.length > 0) {
    for (const frame of reportFrames) {
      if (frame?.image && frame.image.base64Data && frame.image.mimeType) {
        images.push({
          mimeType: frame.image.mimeType,
          base64Data: frame.image.base64Data,
          label: frame.image.label && !frame.image.label.startsWith('frame:')
            ? frame.image.label
            : `Frame: ${frame.phase}`
        });
      } else if (typeof frame?.dataUrl === 'string') {
        const parsed = parseDataUrl(frame.dataUrl, `Frame: ${frame.phase}`);
        if (parsed) images.push(parsed);
      } else if (frame?.base64Data && frame?.mimeType) {
        images.push(frame as ImageAttachment);
      }
    }
  }
  if (images.length === 0 && fallbackSnapshotUrl) {
    const parsed = parseDataUrl(fallbackSnapshotUrl, 'Simulation Snapshot');
    if (parsed) images.push(parsed);
  }
  return images;
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

  const visionSupported = typeof provider.supportsVision === 'function' ? provider.supportsVision() : false;
  const atif = options.atifLogger || new AtifTrajectoryLogger(
    context,
    provider.type,
    'gemini-nano',
    provider.isLocal,
    0.2,
    null,
    visionSupported
  );

  const qualityFlags: QualityFlag[] = [];
  const addQualityFlag = (flag: QualityFlag) => {
    if (!qualityFlags.includes(flag)) {
      qualityFlags.push(flag);
    }
  };
  let activeReviewMode: ReviewMode = 'text-only';

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
      temperature: AGENT_TOKEN_BUDGETS.architect.temperature,
      maxTokens: AGENT_TOKEN_BUDGETS.architect.maxTokens,
      enableThinking: AGENT_TOKEN_BUDGETS.architect.enableThinking,
      thinkingBudgetTokens: AGENT_TOKEN_BUDGETS.architect.thinkingBudgetTokens
    });

    architectThinkingTrace = architectRes.thinkingTrace || architectRes.rawCode;
    plan = extractCoderPlanFromResponse(architectRes.rawCode);
  } catch (err: any) {
    addQualityFlag('FALLBACK_PLAN');
    // Graceful fallback plan based on selected text
    plan = {
      title: context.selection.selectedText.slice(0, 30) || 'Simulation',
      description: 'Interactive epistemic visual simulation',
      visualPlan: 'Canvas 2D dynamic state model with direct manipulation and host-rendered controls',
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
  let revisionContext: RevisionContext | undefined;
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
    const coderUserPrompt = buildCoderUserPrompt(plan, revisionContext, context);
    const coderImages =
      visionSupported && revisionContext?.frames
        ? extractImageAttachments(revisionContext.frames as any[])
        : [];

    const coderRes = await provider.generateSimulation({
      systemPrompt: coderSystemPrompt,
      userPrompt: coderUserPrompt,
      temperature: AGENT_TOKEN_BUDGETS.coder.temperature,
      maxTokens: AGENT_TOKEN_BUDGETS.coder.maxTokens,
      images: coderImages.length > 0 ? coderImages : undefined
    });

    const extracted = extractSimulationTags(coderRes.rawCode);
    currentCode = sanitizeCodeFences(extracted.code);

    atif.recordStep(
      coderStage,
      {
        iteration: iterations,
        plan_title: plan.title,
        revision_notes: revisionContext?.review
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

    // 3. Test in sandbox harness with multi-phase verification and visual snapshot capture
    emitProgress('Testing boundary parameters', 'sandbox', 'test');

    const testStart = Date.now();
    const testMsg: PreFlightTestRequest = {
      type: 'PREFLIGHT_TEST_REQUEST',
      requestId: `agent-test-${Date.now()}-iter${iterations}`,
      rawCode: currentCode,
      timeoutMs: 2500,
      captureSnapshot: true,
      verification: {
        viewport: { width: viewport.width, height: viewport.height },
        soakMs: 500,
        sweep: true,
        captureFrames: true,
        timeoutMs: 2500
      }
    };

    const testResponse = await testRunner(testMsg);
    const testDuration = Date.now() - testStart;

    const report = testResponse.report;
    const diagnostics = report?.diagnostics || [];
    const runtimeErrors: RuntimeErrorRecord[] =
      report?.runtimeErrors ||
      (testResponse.status === 'error' && testResponse.errorMessage
        ? [{ phase: 'init', message: testResponse.errorMessage, stack: testResponse.errorStack }]
        : []);

    const firstFrameImg = report?.frames?.[0]?.image;
    const firstFrameDataUrl =
      (report?.frames?.[0] as any)?.dataUrl ||
      (firstFrameImg ? `data:${firstFrameImg.mimeType};base64,${firstFrameImg.base64Data}` : undefined);

    lastSnapshotUrl = (testResponse.status === 'ok' ? testResponse.snapshotUrl : undefined) || firstFrameDataUrl;
    const isEvalFailure = testResponse.status === 'error' || report?.status === 'fail';
    const evalErrorMsg =
      testResponse.status === 'error'
        ? testResponse.errorMessage
        : isEvalFailure && report
          ? formatDiagnosticsForCoder(report)
          : undefined;
    const evalErrorStack =
      testResponse.status === 'error'
        ? testResponse.errorStack
        : report?.runtimeErrors?.[0]?.stack;
    const evalParams = testResponse.status === 'ok' ? testResponse.parameters : (report?.parameters || []);
    const evalExplanation =
      (testResponse.status === 'ok' ? testResponse.explanation : undefined) ||
      report?.explanation ||
      plan.explanation;

    lastTestResult = {
      status: isEvalFailure ? 'error' : 'ok',
      errorMessage: isEvalFailure ? evalErrorMsg : undefined,
      errorStack: isEvalFailure ? evalErrorStack : undefined,
      logs: [],
      parameters: !isEvalFailure ? evalParams : [],
      ...(evalExplanation ? { explanation: evalExplanation } : {}),
      snapshotUrl: lastSnapshotUrl,
      executionTimeMs: testDuration,
      report,
      diagnostics,
      runtimeErrors
    };

    atif.recordStep(
      'SANDBOX_EVALUATION',
      {
        iteration: iterations,
        code_length: currentCode.length
      },
      {
        status: lastTestResult.status,
        parameters_count: !isEvalFailure ? evalParams.length : 0,
        has_snapshot: Boolean(lastSnapshotUrl),
        snapshot_url: lastSnapshotUrl,
        error: isEvalFailure ? evalErrorMsg : undefined,
        diagnostics,
        captured_frames_count: report?.frames?.length || (lastSnapshotUrl ? 1 : 0)
      },
      testDuration,
      {
        snapshot_url: lastSnapshotUrl,
        snapshot_preview: lastSnapshotUrl ? lastSnapshotUrl.slice(0, 50) + '...' : undefined,
        error_stack: isEvalFailure ? evalErrorStack : undefined,
        vision_supported: visionSupported,
        captured_frames_count: report?.frames?.length || (lastSnapshotUrl ? 1 : 0),
        diagnostics
      },
      !isEvalFailure ? 'PASS' : 'FAIL'
    );

    if (isEvalFailure) {
      // Direct syntax, runtime, or harness verification error: feed back to Coder with previous code and diagnostics
      const hasRuntimeException = runtimeErrors.length > 0;
      revisionContext = {
        iteration: iterations,
        previousCode: currentCode,
        diagnostics,
        runtimeErrors,
        review: {
          critique: hasRuntimeException
            ? `Runtime exception encountered: ${evalErrorMsg}`
            : `Verification harness failed: ${evalErrorMsg}`,
          direction: hasRuntimeException
            ? 'Fix the unhandled exception and ensure all variables are defined defensively.'
            : 'Resolve all reported verification diagnostics while preserving the existing module structure.'
        },
        frames: report?.frames
      };
      continue;
    }

    // 4. Code passed verification; determine review mode and attach multimodal images if supported
    let iterationReviewMode: ReviewMode = 'text-only';
    const images = visionSupported ? extractImageAttachments(report?.frames, lastSnapshotUrl) : [];

    if (images.length > 0) {
      iterationReviewMode = 'multimodal';
    } else {
      iterationReviewMode = 'text-only';
      addQualityFlag('TEXT_ONLY_REVIEW');
    }
    activeReviewMode = iterationReviewMode;

    emitProgress('Reviewing visual render', 'architect', 'review');

    const reviewStart = Date.now();
    let reviewFeedback: ReviewFeedback = { approved: true };

    try {
      const reviewPrompt = buildArchitectReviewPrompt(plan, lastTestResult, currentCode);
      const reviewRes = await provider.generateSimulation({
        systemPrompt: 'You are the Epistemic Architect reviewing a rendered simulation screenshot.',
        userPrompt: reviewPrompt,
        temperature: AGENT_TOKEN_BUDGETS.review.temperature,
        maxTokens: AGENT_TOKEN_BUDGETS.review.maxTokens,
        images: images.length > 0 ? images : undefined
      });

      const balancedJson = extractBalancedJsonObject(reviewRes.rawCode);
      let parsed: any = null;
      if (balancedJson) {
        try {
          parsed = JSON.parse(balancedJson);
        } catch {
          parsed = null;
        }
      }

      if (parsed && typeof parsed.approved === 'boolean') {
        reviewFeedback = parsed;
      } else {
        addQualityFlag('REVIEW_UNPARSEABLE');
        reviewFeedback = {
          approved: false,
          critique: 'Review critique response was unparseable JSON',
          direction: 'Maintain current layout and ensure syntax complies with contract'
        };
      }
    } catch {
      addQualityFlag('REVIEW_UNAVAILABLE');
      // If review call throws an exception, accept the verified working code and flag REVIEW_UNAVAILABLE
      if (diagnostics.some(d => d.severity === 'warning')) {
        addQualityFlag('VERIFICATION_WARNINGS');
      }
      emitProgress('Ready to explore', 'architect', 'approve');
      atif.recordStep('RENDER', {}, { parameter_count: lastTestResult.parameters.length }, undefined, undefined, 'MOUNTED');
      const finalTrajectory = atif.complete(true, currentCode, {
        qualityFlags: [...qualityFlags],
        diagnosticsCount: diagnostics.length
      });
      return {
        success: true,
        code: currentCode,
        title: plan.title,
        description: plan.description,
        parameters: lastTestResult.parameters,
        ...(lastTestResult.explanation ? { explanation: lastTestResult.explanation } : {}),
        ...(plan.pedagogy ? { pedagogy: plan.pedagogy } : {}),
        iterations,
        snapshotUrl: lastSnapshotUrl,
        trajectory,
        atifTrajectory: finalTrajectory,
        qualityFlags: [...qualityFlags],
        reviewMode: activeReviewMode,
        diagnostics
      };
    }

    atif.recordStep(
      'ARCHITECT_REVIEW',
      {
        iteration: iterations,
        has_snapshot: Boolean(lastSnapshotUrl),
        snapshot_url: lastSnapshotUrl,
        test_status: lastTestResult.status,
        review_mode: iterationReviewMode
      },
      {
        approved: reviewFeedback.approved,
        critique: reviewFeedback.critique,
        direction: reviewFeedback.direction,
        snapshot_url: lastSnapshotUrl,
        review_mode: iterationReviewMode
      },
      Date.now() - reviewStart,
      {
        vision_supported: visionSupported,
        captured_frames_count: images.length,
        review_mode: iterationReviewMode as any,
        diagnostics
      },
      reviewFeedback.approved ? 'APPROVED' : 'REVISION_REQUESTED'
    );

    if (reviewFeedback.approved) {
      if (diagnostics.some(d => d.severity === 'warning')) {
        addQualityFlag('VERIFICATION_WARNINGS');
      }
      emitProgress('Ready to explore', 'architect', 'approve');
      atif.recordStep('RENDER', {}, { parameter_count: lastTestResult.parameters.length }, undefined, undefined, 'MOUNTED');
      const finalTrajectory = atif.complete(true, currentCode, {
        qualityFlags: [...qualityFlags],
        diagnosticsCount: diagnostics.length
      });
      return {
        success: true,
        code: currentCode,
        title: plan.title,
        description: plan.description,
        parameters: lastTestResult.parameters,
        ...(lastTestResult.explanation ? { explanation: lastTestResult.explanation } : {}),
        ...(plan.pedagogy ? { pedagogy: plan.pedagogy } : {}),
        iterations,
        snapshotUrl: lastSnapshotUrl,
        trajectory,
        atifTrajectory: finalTrajectory,
        qualityFlags: [...qualityFlags],
        reviewMode: activeReviewMode,
        diagnostics
      };
    } else {
      revisionContext = {
        iteration: iterations,
        previousCode: currentCode,
        diagnostics,
        runtimeErrors,
        review: {
          critique: reviewFeedback.critique || 'Visual layout requires adjustment',
          direction: reviewFeedback.direction || 'Adjust coordinates and improve label contrast'
        },
        frames: report?.frames
      };
    }
  }

  // If max iterations reached, return latest verified code if functional
  if (lastTestResult && lastTestResult.status === 'ok') {
    addQualityFlag('MAX_ITERATIONS_UNAPPROVED');
    const finalDiags = lastTestResult.diagnostics || [];
    if (finalDiags.some(d => d.severity === 'warning')) {
      addQualityFlag('VERIFICATION_WARNINGS');
    }
    emitProgress('Ready to explore', 'architect', 'approve');
    atif.recordStep('RENDER', {}, { parameter_count: lastTestResult.parameters.length }, undefined, undefined, 'MOUNTED');
    const finalTrajectory = atif.complete(true, currentCode, {
      qualityFlags: [...qualityFlags],
      diagnosticsCount: finalDiags.length
    });
    return {
      success: true,
      code: currentCode,
      title: plan.title,
      description: plan.description,
      parameters: lastTestResult.parameters,
      ...(lastTestResult.explanation ? { explanation: lastTestResult.explanation } : {}),
      ...(plan.pedagogy ? { pedagogy: plan.pedagogy } : {}),
      iterations,
      snapshotUrl: lastSnapshotUrl,
      trajectory,
      atifTrajectory: finalTrajectory,
      qualityFlags: [...qualityFlags],
      reviewMode: activeReviewMode,
      diagnostics: finalDiags
    };
  }

  const finalDiags = lastTestResult?.diagnostics || [];
  const finalTrajectory = atif.complete(false, currentCode, {
    qualityFlags: [...qualityFlags],
    diagnosticsCount: finalDiags.length
  });
  return {
    success: false,
    code: currentCode,
    title: plan.title,
    description: plan.description,
    parameters: [],
    ...(plan.explanation ? { explanation: plan.explanation } : {}),
    ...(plan.pedagogy ? { pedagogy: plan.pedagogy } : {}),
    iterations,
    error: lastTestResult?.errorMessage || 'Simulation failed verification',
    trajectory,
    atifTrajectory: finalTrajectory,
    qualityFlags: [...qualityFlags],
    reviewMode: activeReviewMode,
    diagnostics: finalDiags
  };
}
