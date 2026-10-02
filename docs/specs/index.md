# Technical Specifications Master Index

This document serves as the single source of truth and registry for all living technical specifications in **SimIt**. Specs are evergreen architectural assets defining data contracts, domain models, and verifiable acceptance criteria.

---

## 1. Specification Registry

| Specification | Domain / Subsystem | Status | Key Contracts & Responsibilities |
| :--- | :--- | :--- | :--- |
| [System Architecture](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/architecture.md) | MV3 Extension Core | Approved | Manifest V3 topology, service worker lifecycle, permissions, and security boundaries. |
| [Context Harvester](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/context_harvester.md) | Content Script / DOM | Approved | Text selection extraction, KaTeX/MathJax/MathML detection, heading hierarchy, and truncation budget. |
| [Sandboxed Runtime & IPC](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/sandbox_ipc.md) | Sandboxed Execution & IPC | Approved | Offscreen pre-flight harness, `sandbox.html` isolation, `postMessage` protocol, and timeout guards. |
| [Model Providers & BYOK](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/model_providers.md) | Model Orchestration | Approved | On-device Gemini Nano (Prompt API), BYOK cloud providers (Claude, Gemini, Ollama), settings storage. |
| [Agent Loop & Self-Repair](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/agent_loop.md) | Code Generation & Repair | Approved | Autonomous generation loop, system prompt contract, 1-shot pre-flight repair, and interactive repair icon. |
| [ATIF & Simulation Export](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/specs/atif_specification.md) | Telemetry & Export | Approved | Standalone HTML exporter, Agent Trajectory Interchange Format (`.atif.json`) schema and logging. |

---

## 2. Shared Domain Models

Domain types are centrally defined and strongly typed in TypeScript under [`src/types/`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/):
- [`src/types/harvester.ts`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/harvester.ts): Context harvesting, math annotations, DOM hierarchy.
- [`src/types/models.ts`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/models.ts): Provider abstraction, Chrome Prompt API capabilities, BYOK settings schema.
- [`src/types/ipc.ts`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/ipc.ts): IPC message envelopes between background, offscreen, and sandbox.
- [`src/types/simulation.ts`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/simulation.ts): `simEngine` module lifecycle and dynamic parameter schemas.
- [`src/types/atif.ts`](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/src/types/atif.ts): ATIF trajectory steps, metadata, and benchmarking schema.

---

## 3. Phased Execution Backlog

For active sprint tasks and execution slicing, see the ephemeral task tracking backlog:
- [docs/backlog/tasks.md](file:///Users/waqqasmeraj/Developer/vmatrixdev/simit/docs/backlog/tasks.md)
