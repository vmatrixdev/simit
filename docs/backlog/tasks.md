# SimIt Execution Backlog

**Lifecycle:** Ephemeral Backlog under `docs/backlog/`  
**Master Specifications:** [docs/specs/index.md](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/index.md)  
**Roadmap Source:** [docs/product/roadmap.md](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/product/roadmap.md)  

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

    subgraph P4["Phase 4: Two-Tier Autonomous Multi-Agent Loop (COMPLETED)"]
        direction TB
        T14["Task 14: Architect & Coder Sub-Agent Deliberation & Visual Review"]
    end

    subgraph P5["Phase 5: Robustness, Stage Geometry & Verification Soak (COMPLETED)"]
        direction TB
        T15["Task 15: Multimodal Image Wire Protocol & Provider Integration"]
        T16["Task 16: Single-Source Module Contract & Stage Geometry"]
        T17["Task 17: Pre-Flight Verification Harness & Multi-Frame Soak"]
        T18["Task 18: Code Patching Revisions & Quality Flags"]
        T15 --> T16 --> T17 --> T18
    end

    subgraph P6["Phase 6: Pedagogy & Guided Exploration Tour (COMPLETED)"]
        direction TB
        T19["Task 19: Pedagogy Spec & Source Context Forwarding"]
        T20["Task 20: Explanation Contract & Guided Tour Bar"]
        T19 --> T20
    end

    P1 ==> P2 ==> P3 ==> P4 ==> P5 ==> P6
```

---

## Completed Phases Summary

- **Phase 1 (MVP Core & Harness)**: Manifest V3 extension, context harvester, sandboxed iframe, Prompt API, offscreen pre-flight harness, ATIF logger, and BYOK providers. Conforming to [docs/specs/architecture.md](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/architecture.md).
- **Phase 2 (Declarative Runtime & Triage)**: Tweakpane, functionPlot, Cytoscape, Math.js runtime stack, `<simulation_thinking>` decoupling, and upfront archetype triage. Conforming to [docs/specs/declarative_runtime.md](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/declarative_runtime.md) and [docs/specs/archetype_triage.md](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/archetype_triage.md).
- **Phase 3 (Evolution, Session & Routing)**: Evolution chips, refinement chat, IndexedDB session stack, context compactor, and hybrid model routing. Conforming to [docs/specs/conversational_evolution.md](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/conversational_evolution.md), [docs/specs/session_memory.md](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/session_memory.md), and [docs/specs/model_routing.md](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/model_routing.md).
- **Phase 4 (Autonomous Multi-Agent Loop)**: Two-tier Epistemic Architect and Coder sub-agents, unconstrained deliberation, and micro-progress reporting. Conforming to [docs/specs/autonomous_agent_architecture.md](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/autonomous_agent_architecture.md).
- **Phase 5 (Robustness & Verification Soak)**: Multimodal image wire protocol (`src/providers/multimodal.ts`), single-source contract (`src/runtime/module-contract.ts`), `StageGeometry`, pre-flight multi-frame soak verification runner (`src/runtime/verification.ts`), and code-patching revisions. Conforming to [docs/specs/simulation_module_contract.md](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/simulation_module_contract.md) and [docs/specs/simulation_verification.md](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/simulation_verification.md).
- **Phase 6 (Pedagogy & Guided Tour)**: `PedagogySpec` (`coreInsight`, `misconception`, `ahaExperiment`), explanation contract (`insight`, `legend`, `tour`), and host-rendered tour controls (`#tour-bar`). Conforming to [docs/specs/simulation_module_contract.md](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/simulation_module_contract.md) and [docs/specs/autonomous_agent_architecture.md](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/autonomous_agent_architecture.md).

---

## Active Backlog Tasks

- [ ] Chrome Web Store asset finalization and store submission conforming to [docs/product/chrome_web_store_publishing.md](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/product/chrome_web_store_publishing.md).

