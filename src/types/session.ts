/**
 * SimIt Session Memory, Version Stack & Context Compactor Types
 * Defines the contract for:
 * 1. Client-side IndexedDB persistence (simit_sessions, simit_versions)
 * 2. Immutable version stack (v1 -> v2 -> v3) with 1-click state rollback
 * 3. Context Rolling Compactor algorithm
 */

import { ParameterDefinition, ParameterState } from './simulation';
import { ConversationalTurn } from './evolution';

export type VersionTrigger =
  | 'initial_synthesis'
  | 'chip_action'
  | 'chat_refinement'
  | 'preflight_repair'
  | 'cloud_escalation';

export interface SimulationVersion {
  id: string; // e.g., 'ver_uuid'
  sessionId: string;
  versionIndex: number; // 1, 2, 3...
  versionLabel: string; // 'v1', 'v2', 'v3'...
  code: string;
  title: string;
  description: string;
  parameters: ParameterDefinition[];
  parameterState: ParameterState;
  trigger: VersionTrigger;
  triggerDetail?: string; // e.g., chip label or chat message
  thinkingTrace?: string;
  timestamp: number;
  parentVersionId?: string;
}

export interface SessionRecord {
  id: string; // e.g., 'sess_uuid'
  createdAt: number;
  updatedAt: number;
  title: string;
  url: string;
  selectedText: string;
  mathSnippet?: string;
  sectionHeading?: string;
  archetype: string;
  activeVersionId: string;
  versionsCount: number;
}

export interface PaperAnchor {
  text: string;
  mathSnippet?: string;
  heading?: string;
  url?: string;
}

export interface ContextCompactorInput {
  paperAnchor: PaperAnchor;
  activeCode: string;
  chatHistory: ConversationalTurn[];
  maxChatTurns?: number; // default: 2
}

export interface CompactedContextPayload {
  paperAnchor: PaperAnchor;
  activeCodeSnapshot: string;
  recentTurns: ConversationalTurn[];
  discardedTurnsCount: number;
  estimatedTokens: number;
}

export interface VersionRollbackRequest {
  sessionId: string;
  targetVersionId: string;
}

export interface VersionRollbackResponse {
  status: 'ok' | 'error';
  version: SimulationVersion;
  errorMessage?: string;
}
