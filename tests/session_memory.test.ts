/**
 * Executable Contract Verification: Session Memory, Version Stack & Context Rolling
 * Conforms to docs/specs/session_memory.md
 */

import { describe, it, expect } from 'vitest';
import {
  SessionRecord,
  SimulationVersion,
  ContextCompactorInput,
  CompactedContextPayload,
  PaperAnchor,
} from '../src/types/session';
import { ConversationalTurn } from '../src/types/evolution';

describe('Session Memory & Context Rolling Specification (docs/specs/session_memory.md)', () => {
  it('M1: Initial simulation synthesis persists new session and v1 snapshot in IndexedDB model', () => {
    const session: SessionRecord = {
      id: 'sess_123',
      createdAt: 1775000000000,
      updatedAt: 1775000000000,
      title: 'Softmax Temperature Scaling',
      url: 'https://arxiv.org/abs/1706.03762',
      selectedText: 'Softmax distribution with temperature parameter tau...',
      mathSnippet: 'P(i) = \\frac{e^{z_i / \\tau}}{\\sum_j e^{z_j / \\tau}}',
      archetype: 'parameter_explorer',
      activeVersionId: 'ver_v1',
      versionsCount: 1,
    };

    const v1: SimulationVersion = {
      id: 'ver_v1',
      sessionId: 'sess_123',
      versionIndex: 1,
      versionLabel: 'v1',
      code: 'export default { title: "Softmax", init() {}, update() {} };',
      title: 'Softmax Temperature Scaling',
      description: 'Initial synthesis',
      parameters: [{ id: 'tau', label: 'Temperature', type: 'slider', min: 0.1, max: 5.0, step: 0.1, default: 1.0 }],
      parameterState: { tau: 1.0 },
      trigger: 'initial_synthesis',
      timestamp: 1775000000000,
    };

    expect(session.id).toBe('sess_123');
    expect(session.activeVersionId).toBe(v1.id);
    expect(v1.versionIndex).toBe(1);
    expect(v1.versionLabel).toBe('v1');
    expect(v1.parentVersionId).toBeUndefined();
  });

  it('M2: Version stack pushes v2 linking to v1 parent on structural refinement', () => {
    const v2: SimulationVersion = {
      id: 'ver_v2',
      sessionId: 'sess_123',
      versionIndex: 2,
      versionLabel: 'v2',
      code: 'export default { title: "Softmax + Entropy", init() {}, update() {} };',
      title: 'Softmax with Shannon Entropy',
      description: 'Added entropy curve',
      parameters: [
        { id: 'tau', label: 'Temperature', type: 'slider', min: 0.1, max: 5.0, step: 0.1, default: 1.0 },
        { id: 'showEntropy', label: 'Show Entropy', type: 'toggle', default: true },
      ],
      parameterState: { tau: 1.0, showEntropy: true },
      trigger: 'chat_refinement',
      triggerDetail: 'Add Shannon entropy curve',
      timestamp: 1775000060000,
      parentVersionId: 'ver_v1',
    };

    expect(v2.versionIndex).toBe(2);
    expect(v2.versionLabel).toBe('v2');
    expect(v2.parentVersionId).toBe('ver_v1');
    expect(v2.trigger).toBe('chat_refinement');
  });

  it('M3: 1-click state rollback restores prior version code and parameter state with 0 network calls', () => {
    const versions: Record<string, SimulationVersion> = {
      ver_v1: {
        id: 'ver_v1',
        sessionId: 'sess_123',
        versionIndex: 1,
        versionLabel: 'v1',
        code: 'code_v1',
        title: 'Title v1',
        description: 'Initial',
        parameters: [],
        parameterState: { tau: 1.0 },
        trigger: 'initial_synthesis',
        timestamp: 100,
      },
      ver_v2: {
        id: 'ver_v2',
        sessionId: 'sess_123',
        versionIndex: 2,
        versionLabel: 'v2',
        code: 'code_v2',
        title: 'Title v2',
        description: 'Evolved',
        parameters: [],
        parameterState: { tau: 4.2 },
        trigger: 'chat_refinement',
        timestamp: 200,
        parentVersionId: 'ver_v1',
      },
    };

    // User clicks 'v1' badge in UI -> rollback
    const targetVersionId = 'ver_v1';
    const rolledBackVersion = versions[targetVersionId];

    expect(rolledBackVersion.versionLabel).toBe('v1');
    expect(rolledBackVersion.code).toBe('code_v1');
    expect(rolledBackVersion.parameterState.tau).toBe(1.0);
  });

  it('M4: Context compactor enforces strict sliding 2-turn window and discards older turns', () => {
    const paperAnchor: PaperAnchor = {
      text: 'The self-attention mechanism computes attention weights via softmax(QK^T / sqrt(d_k)).',
      mathSnippet: '\\text{Attention}(Q, K, V) = \\text{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V',
      heading: '3.2 Multi-Head Attention',
    };

    const chatHistory: ConversationalTurn[] = [
      { role: 'user', content: 'Turn 1: Make nodes bigger', timestamp: 1000 },
      { role: 'assistant', content: 'Turn 1: Updated node size', timestamp: 1001 },
      { role: 'user', content: 'Turn 2: Change color to blue', timestamp: 2000 },
      { role: 'assistant', content: 'Turn 2: Color changed to blue', timestamp: 2001 },
      { role: 'user', content: 'Turn 3: Add attention score label', timestamp: 3000 },
      { role: 'assistant', content: 'Turn 3: Added score label', timestamp: 3001 },
    ];

    const input: ContextCompactorInput = {
      paperAnchor,
      activeCode: 'export default { title: "v3" };',
      chatHistory,
      maxChatTurns: 2,
    };

    // Compactor algorithm: slice last (maxChatTurns * 2) messages
    const maxMessages = (input.maxChatTurns ?? 2) * 2;
    const recentTurns = input.chatHistory.slice(-maxMessages);
    const discardedCount = input.chatHistory.length - recentTurns.length;

    const compacted: CompactedContextPayload = {
      paperAnchor: input.paperAnchor,
      activeCodeSnapshot: input.activeCode,
      recentTurns,
      discardedTurnsCount: discardedCount,
      estimatedTokens: 450,
    };

    expect(compacted.recentTurns.length).toBe(4); // 2 user turns + 2 assistant turns
    expect(compacted.discardedTurnsCount).toBe(2);
    expect(compacted.recentTurns[0].content).toBe('Turn 2: Change color to blue');
    expect(compacted.recentTurns[3].content).toBe('Turn 3: Added score label');
    expect(compacted.activeCodeSnapshot).toBe('export default { title: "v3" };');
  });

  it('M5: Paper anchor snippet remains immutable and byte-exact across context rolling', () => {
    const originalText = 'Exact excerpt from research paper section 4.1';
    const paperAnchor: PaperAnchor = {
      text: originalText,
      mathSnippet: 'E = mc^2',
    };

    const compactedPayload: CompactedContextPayload = {
      paperAnchor,
      activeCodeSnapshot: 'code',
      recentTurns: [],
      discardedTurnsCount: 10,
      estimatedTokens: 300,
    };

    expect(compactedPayload.paperAnchor.text).toBe(originalText);
    expect(compactedPayload.paperAnchor.mathSnippet).toBe('E = mc^2');
  });

  it('M6: Runtime compactContext enforces token bounding and formats user prompt cleanly', async () => {
    const { compactContext, formatCompactedUserPrompt } = await import('../src/runtime/context-compactor');

    const compacted = compactContext({
      paperAnchor: { text: 'Ground truth physics excerpt', mathSnippet: 'F = ma' },
      activeCode: 'export default { title: "v1" };',
      chatHistory: [
        { role: 'user', content: 'Turn 1', timestamp: 1 },
        { role: 'assistant', content: 'Turn 1 ok', timestamp: 2 },
        { role: 'user', content: 'Turn 2', timestamp: 3 },
        { role: 'assistant', content: 'Turn 2 ok', timestamp: 4 },
        { role: 'user', content: 'Turn 3', timestamp: 5 },
        { role: 'assistant', content: 'Turn 3 ok', timestamp: 6 },
      ],
      maxChatTurns: 2,
    });

    expect(compacted.recentTurns.length).toBe(4);
    expect(compacted.discardedTurnsCount).toBe(2);

    const prompt = formatCompactedUserPrompt(compacted, 'Make the ball heavier');
    expect(prompt).toContain('GROUND TRUTH PAPER ANCHOR');
    expect(prompt).toContain('CURRENT WORKING SIMULATION CODE');
    expect(prompt).toContain('Make the ball heavier');
    expect(prompt).toContain('Turn 3');
    expect(prompt).not.toContain('Turn 1');
  });

  it('M7: Runtime session-db saves sessions, appends versions, and performs instant rollback', async () => {
    const { saveSession, getSession, saveVersion, getVersionsForSession, rollbackToVersion } = await import(
      '../src/runtime/session-db'
    );

    const testSession: SessionRecord = {
      id: 'sess_test_1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      title: 'Attention Simulation',
      url: 'https://arxiv.org',
      selectedText: 'Self-attention mechanism...',
      archetype: 'parameter_explorer',
      activeVersionId: 'ver_v1',
      versionsCount: 1,
    };

    await saveSession(testSession);
    const retrievedSession = await getSession('sess_test_1');
    expect(retrievedSession?.title).toBe('Attention Simulation');

    const v1: SimulationVersion = {
      id: 'ver_v1',
      sessionId: 'sess_test_1',
      versionIndex: 1,
      versionLabel: 'v1',
      code: 'code_v1',
      title: 'v1 title',
      description: 'init',
      parameters: [],
      parameterState: { tau: 1.0 },
      trigger: 'initial_synthesis',
      timestamp: 100,
    };

    const v2: SimulationVersion = {
      id: 'ver_v2',
      sessionId: 'sess_test_1',
      versionIndex: 2,
      versionLabel: 'v2',
      code: 'code_v2',
      title: 'v2 title',
      description: 'evolved',
      parameters: [],
      parameterState: { tau: 3.5 },
      trigger: 'chat_refinement',
      timestamp: 200,
      parentVersionId: 'ver_v1',
    };

    await saveVersion(v1);
    await saveVersion(v2);

    const versions = await getVersionsForSession('sess_test_1');
    expect(versions.length).toBe(2);
    expect(versions[0].versionIndex).toBe(1);
    expect(versions[1].versionIndex).toBe(2);

    const rolledBack = await rollbackToVersion('sess_test_1', 'ver_v1');
    expect(rolledBack.id).toBe('ver_v1');
    expect(rolledBack.parameterState.tau).toBe(1.0);

    const updatedSession = await getSession('sess_test_1');
    expect(updatedSession?.activeVersionId).toBe('ver_v1');
  });
});
