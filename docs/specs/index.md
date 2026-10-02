# Technical Specifications Master Index

This document serves as the single source of truth and registry for all living technical specifications in **SimIt**. Specs are evergreen architectural assets defining data contracts, domain models, and verifiable acceptance criteria.

---

## 1. Specification Registry

| Specification | Domain / Subsystem | Status | Key Contracts & Responsibilities |
| :--- | :--- | :--- | :--- |
| [System Architecture](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/architecture.md) | MV3 Extension Core | Approved | Manifest V3 topology, epistemic software positioning, declarative runtime stack, context menu trigger, context rolling compactor, and $0 infrastructure. |
| [Context Harvester](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/context_harvester.md) | Content Script / DOM | Approved | Selective bounded scope (no full page dumps), KaTeX/MathJax/MathML extraction, zero DOM mutation, and viewport dimension capture. |
| [Sandboxed Runtime & IPC](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/sandbox_ipc.md) | Sandboxed Execution & IPC | Approved | Offscreen headless pre-flight smoke test, `sandbox.html` isolation, declarative runtime bundle (Tweakpane v4, functionPlot v1, Cytoscape v3, Anime v3, D3 v7, KaTeX v0.16), and zero-latency parameter updates. |
| [Model Providers & BYOK](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/model_providers.md) | Model Orchestration | Approved | On-device Gemini Nano (Prompt API), BYOK cloud providers (Claude 3.5 Sonnet, Gemini Flash, Ollama), native hidden thinking support, and tag decoupling. |
| [Declarative Runtime Stack](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/declarative_runtime.md) | Sandboxed Runtime & Declarative Libraries | Approved | Standardized declarative stack (Tweakpane v4, functionPlot v1, Cytoscape v3, Anime v3, KaTeX v0.16, D3 v7), zero-latency parametric updates (0ms LLM overhead), and lifecycle cleanup. |
| [Archetype Triage & Fallback Modalities](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/archetype_triage.md) | Archetype Deduction & Triage | Approved | Upfront viability classification (5 canonical archetypes), "No Meaningless Motion" invariant, Cytoscape Concept DAGs, and interactive Socratic Breakdown chips. |
| [Agent Loop & Self-Repair](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/agent_loop.md) | Code Generation & Repair | Approved | Autonomous generation loop, decoupled reasoning tags (`<simulation_thinking>` / `<simulation_code>`), explicit viewport injection, context rolling compactor, and dual-track evolution. |
| [ATIF & Simulation Export](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/atif_specification.md) | Telemetry & Export | Approved | Standalone HTML exporter with inlined declarative libraries, and Agent Trajectory Interchange Format (`.atif.json`) schema with reasoning traces and archetype triage. |

---

## 2. Shared Domain Models

Domain types are centrally defined and strongly typed in TypeScript under [`src/types/`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/):
- [`src/types/harvester.ts`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/harvester.ts): Context harvesting, math annotations, DOM hierarchy, and viewport dimensions.
- [`src/types/models.ts`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/models.ts): Provider abstraction, Chrome Prompt API capabilities, BYOK settings schema, and thinking modes.
- [`src/types/ipc.ts`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/ipc.ts): IPC message envelopes between background, offscreen, and sandbox.
- [`src/types/simulation.ts`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/simulation.ts): `simEngine` module lifecycle, declarative runtime contracts, and dynamic parameter schemas.
- [`src/types/archetype.ts`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/archetype.ts): Archetype classification, Concept DAG schemas, Socratic breakdown models, and triage prompts.
- [`src/types/atif.ts`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/atif.ts): ATIF trajectory steps, metadata, thinking traces, and benchmarking schema.

---

## 3. Phased Execution Backlog

For active sprint tasks and execution slicing, see the ephemeral task tracking backlog:
- [docs/backlog/tasks.md](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/backlog/tasks.md)

