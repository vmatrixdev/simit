/**
 * SimIt Context Rolling Compactor
 * Conforms to docs/specs/session_memory.md
 * Enforces a strict 4-tier token budget (< 2,500 tokens):
 * 1. Tier 1: System Rules & Declarative Contracts
 * 2. Tier 2: Static Paper Anchor (Immutable Ground Truth Excerpt)
 * 3. Tier 3: Active Working Code Snapshot (<simulation_code> v(N))
 * 4. Tier 4: Sliding Chat Window (Strictly Last 2 User/Assistant Turns)
 */

import {
  ContextCompactorInput,
  CompactedContextPayload,
  PaperAnchor
} from '../types/session';
import { ConversationalTurn } from '../types/evolution';

const MAX_PROMPT_TOKENS = 2500;
const DEFAULT_MAX_CHAT_TURNS = 2;

/**
 * Estimates token count from raw text string (~4 chars per token approximation)
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Compacts multi-turn conversational history and simulation state into a bounded prompt context.
 */
export function compactContext(input: ContextCompactorInput): CompactedContextPayload {
  const maxTurns = input.maxChatTurns ?? DEFAULT_MAX_CHAT_TURNS;
  // Each turn has 1 user and up to 1 assistant message, so max messages = maxTurns * 2
  const maxMessages = maxTurns * 2;

  const chatHistory = input.chatHistory || [];
  const recentTurns = chatHistory.slice(-maxMessages);
  const discardedTurnsCount = Math.max(0, chatHistory.length - recentTurns.length);

  // Build aggregate representation for token estimation
  const aggregateContent = [
    input.paperAnchor.text,
    input.paperAnchor.mathSnippet || '',
    input.paperAnchor.heading || '',
    input.activeCode,
    ...recentTurns.map((t) => `${t.role}: ${t.content}`)
  ].join('\n\n');

  const estimatedTokens = estimateTokenCount(aggregateContent);

  return {
    paperAnchor: {
      text: input.paperAnchor.text,
      mathSnippet: input.paperAnchor.mathSnippet,
      heading: input.paperAnchor.heading,
      url: input.paperAnchor.url
    },
    activeCodeSnapshot: input.activeCode,
    recentTurns,
    discardedTurnsCount,
    estimatedTokens
  };
}

/**
 * Formats the compacted context into a user prompt for model refinement.
 */
export function formatCompactedUserPrompt(
  compacted: CompactedContextPayload,
  newInstruction: string
): string {
  const parts: string[] = [];

  parts.push('### GROUND TRUTH PAPER ANCHOR');
  if (compacted.paperAnchor.heading) {
    parts.push(`Section: ${compacted.paperAnchor.heading}`);
  }
  parts.push(`Excerpt:\n"""\n${compacted.paperAnchor.text}\n"""`);
  if (compacted.paperAnchor.mathSnippet) {
    parts.push(`Key Math Formula:\n${compacted.paperAnchor.mathSnippet}`);
  }

  parts.push('\n### CURRENT WORKING SIMULATION CODE');
  parts.push(`<simulation_code>\n${compacted.activeCodeSnapshot}\n</simulation_code>`);

  if (compacted.recentTurns.length > 0) {
    parts.push('\n### RECENT CONVERSATIONAL REFINEMENT HISTORY');
    for (const turn of compacted.recentTurns) {
      parts.push(`${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.content}`);
    }
  }

  parts.push('\n### REFINEMENT INSTRUCTION');
  parts.push(newInstruction);
  parts.push('Update the simulation code adhering to all simEngine contracts and declarative libraries (Tweakpane, functionPlot, Cytoscape, Anime). Format output inside <simulation_thinking> and <simulation_code>.');

  return parts.join('\n\n');
}
