# SimIt Execution Backlog

**Lifecycle:** Ephemeral Backlog under `docs/backlog/`  
**Master Specifications:** [docs/specs/index.md](file:///Users/waqqasmeraj/.gemini/antigravity/worktrees/simit/improve_simulation_evaluation/docs/specs/index.md)  
**Roadmap Source:** [docs/product/roadmap.md](file:///Users/waqqasmeraj/.gemini/antigravity/worktrees/simit/improve_simulation_evaluation/docs/product/roadmap.md)  

---

## Workstream Decomposition & Dependency Graph

```mermaid
flowchart TD
    subgraph P1["Phase 1: MVP Core, Local Engine & Harness (COMPLETED)"]
        direction TB
        T1["Task 1: Toolchain Scaffolding & Manifest V3"]
        T2["Task 2: Context Harvester & Right-Click 'SimIt' Menu"]
        T3["Task 3: Sandboxed Execution Iframe (sandbox.html)"]
        T4["Task 4: Default Local Prompt API (Gemini Nano)"]
        T5["Task 5: Offscreen Pre-Flight Harness & 1-Shot Self-Repair"]
        T6["Task 6: ATIF Trajectory Logger & Standalone HTML Exporter"]
        T7["Task 7: BYOK Provider Engine & Settings UI"]
        T1 --> T2 --> T4 --> T5 --> T6
        T1 --> T3 --> T5
        T4 --> T7 --> T6
    end

    subgraph P2["Phase 2: Declarative Runtime, Reasoning Decoupling & Archetype Triage (COMPLETED)"]
        direction TB
        T8["Task 8: Declarative Runtime Stack (Tweakpane, functionPlot, Cytoscape)"]
        T9["Task 9: Reasoning Decoupling & Explicit Viewport Injection"]
        T10["Task 10: Archetype Triage & Non-Simulatable Text Fallbacks"]
        T8 --> T9 --> T10
    end

    subgraph P3["Phase 3: Conversational Evolution, Persistent Memory & Multi-Model Routing (COMPLETED)"]
        direction TB
        T11["Task 11: Dual-Track Evolution (Evolution Chips & Refinement Chat)"]
        T12["Task 12: Context Rolling Compactor & IndexedDB Session Version Stack"]
        T13["Task 13: Hybrid Multi-Model Routing & Cloud Escalation"]
        T11 --> T12 --> T13
    end

    P1 ==> P2 ==> P3
```

---

## Phase 5 Execution Checklist (Status: Completed - P0 Robustness & Verification Harness)

### Step 15: Multimodal Image Wire Protocol & Provider Integration
- [x] Implement `src/providers/multimodal.ts` mapping pure `ImageAttachment` arrays to Gemini `inline_data`, Anthropic base64 images, and OpenAI `image_url` payloads conforming to [docs/specs/model_providers.md](file:///Users/waqqasmeraj/.gemini/antigravity/worktrees/simit/improve_simulation_evaluation/docs/specs/model_providers.md).
- [x] Wire image attachments into `GoogleGeminiProvider`, `AnthropicProvider`, and `OpenAICompatibleProvider` conforming to [docs/specs/model_providers.md](file:///Users/waqqasmeraj/.gemini/antigravity/worktrees/simit/improve_simulation_evaluation/docs/specs/model_providers.md).
- [x] Pass `tests/multimodal_mapping.test.ts` unit test suite conforming to [docs/specs/model_providers.md](file:///Users/waqqasmeraj/.gemini/antigravity/worktrees/simit/improve_simulation_evaluation/docs/specs/model_providers.md).

### Step 16: Simulation Module Contract & Stage Geometry
- [x] Implement `src/runtime/module-contract.ts` single-source prompt generator (`buildModuleContractPromptSection`), `computeStageGeometry`, and `dispatchParameterUpdate` conforming to [docs/specs/simulation_module_contract.md](file:///Users/waqqasmeraj/.gemini/antigravity/worktrees/simit/improve_simulation_evaluation/docs/specs/simulation_module_contract.md).
- [x] Integrate single-source contract into `agent-orchestrator.ts` and `prompt-builder.ts` eliminating duplicate Tweakpanes and docking `#pane-dock` as a bottom controls drawer conforming to [docs/specs/simulation_module_contract.md](file:///Users/waqqasmeraj/.gemini/antigravity/worktrees/simit/improve_simulation_evaluation/docs/specs/simulation_module_contract.md).
- [x] Pass `tests/module_contract.test.ts` unit test suite conforming to [docs/specs/simulation_module_contract.md](file:///Users/waqqasmeraj/.gemini/antigravity/worktrees/simit/improve_simulation_evaluation/docs/specs/simulation_module_contract.md).

### Step 17: Pre-Flight Verification Harness & Automated Diagnostics
- [x] Implement pure diagnostic algorithms (`computeRasterStats`, `isBlankRender`, `scanNonFiniteText`, `detectDuplicateControls`, `detectCanvasSizing`, `buildSweepPlan`) and multi-phase `verifySimulationInStage` runner in `src/runtime/verification.ts` conforming to [docs/specs/simulation_verification.md](file:///Users/waqqasmeraj/.gemini/antigravity/worktrees/simit/improve_simulation_evaluation/docs/specs/simulation_verification.md).
- [x] Refactor offscreen harness (`offscreen.html`) and sandbox runtime (`sandbox.ts`) to mount visibly offscreen (`position: fixed; left: -10000px`) at active panel dimensions and soak across rAF frames conforming to [docs/specs/simulation_verification.md](file:///Users/waqqasmeraj/.gemini/antigravity/worktrees/simit/improve_simulation_evaluation/docs/specs/simulation_verification.md).
- [x] Implement IPC protocol handlers for `SANDBOX_VERIFY_SIMULATION` and `SANDBOX_VERIFICATION_REPORT` conforming to [docs/specs/sandbox_ipc.md](file:///Users/waqqasmeraj/.gemini/antigravity/worktrees/simit/improve_simulation_evaluation/docs/specs/sandbox_ipc.md).
- [x] Pass `tests/verification_harness.test.ts` unit test suite conforming to [docs/specs/simulation_verification.md](file:///Users/waqqasmeraj/.gemini/antigravity/worktrees/simit/improve_simulation_evaluation/docs/specs/simulation_verification.md).

### Step 18: Code Patching Revisions & Quality Flags
- [x] Update `executeAutonomousSimulationLoop` in `src/runtime/agent-orchestrator.ts` to feed previous code, full stack traces, and diagnostics back to Coder on revision conforming to [docs/specs/autonomous_agent_architecture.md](file:///Users/waqqasmeraj/.gemini/antigravity/worktrees/simit/improve_simulation_evaluation/docs/specs/autonomous_agent_architecture.md).
- [x] Attach rendered raster frames directly to vision review prompt `images` payload conforming to [docs/specs/autonomous_agent_architecture.md](file:///Users/waqqasmeraj/.gemini/antigravity/worktrees/simit/improve_simulation_evaluation/docs/specs/autonomous_agent_architecture.md).
- [x] Emit explicit `QualityFlag` warnings when fallbacks or parse errors occur conforming to [docs/specs/autonomous_agent_architecture.md](file:///Users/waqqasmeraj/.gemini/antigravity/worktrees/simit/improve_simulation_evaluation/docs/specs/autonomous_agent_architecture.md).

---

## Phase 6 Execution Checklist (Status: Completed - P1 Pedagogical Explanation & Live Guided Tour)

### Step 19: Architect Pedagogy Phase, Source Context Forwarding & Pedagogical Review
- [x] Extend `DELEGATE_TO_CODER_TOOL`, `buildArchitectSystemPrompt`, `normalizeCoderPlan`, `buildCoderUserPrompt`, and `buildArchitectReviewPrompt` in `src/runtime/agent-orchestrator.ts` conforming to [docs/specs/autonomous_agent_architecture.md](file:///Users/waqqasmeraj/.gemini/antigravity/worktrees/simit/improve_simulation_evaluation/docs/specs/autonomous_agent_architecture.md).
- [x] Generate guided exploration chips from `explanation.tour` in `src/runtime/evolution.ts` and `src/background/service-worker.ts` conforming to [docs/specs/autonomous_agent_architecture.md](file:///Users/waqqasmeraj/.gemini/antigravity/worktrees/simit/improve_simulation_evaluation/docs/specs/autonomous_agent_architecture.md).

### Step 20: Module Explanation Contract & Host-Rendered Guided Tour Bar
- [x] Implement `validateSimulationModuleContract` and document `explanation: { insight, legend, tour }` in `src/runtime/module-contract.ts` conforming to [docs/specs/simulation_module_contract.md](file:///Users/waqqasmeraj/.gemini/antigravity/worktrees/simit/improve_simulation_evaluation/docs/specs/simulation_module_contract.md).
- [x] Render `#explanation-dock` and `#tour-bar` in `src/sandbox/sandbox.html`, `src/sandbox/sandbox.css`, `src/sandbox/sandbox.ts`, and `src/export/standalone-exporter.ts` conforming to [docs/specs/simulation_module_contract.md](file:///Users/waqqasmeraj/.gemini/antigravity/worktrees/simit/improve_simulation_evaluation/docs/specs/simulation_module_contract.md).

