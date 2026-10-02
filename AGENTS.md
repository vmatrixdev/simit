# AGENTS.md - SimIt Project Guidelines

## 1. Project Overview & Architecture

**SimIt** (Paper/Doc Interactive Visualizer Copilot) is a Chrome Extension (Manifest V3) that converts complex technical text, mathematical equations, and algorithms from web pages, research papers, or documentation into **zero-prompt, real-time, interactive visual simulations**.

### Core User Flow & Architecture
1. **Host Page Interaction**: User highlights text, an equation, or an algorithm on any tab, right-clicks, and selects the **"SimIt"** context menu option.
2. **Context Harvester**: A Content Script harvests the selected snippet alongside surrounding DOM context, headings, and captions, dispatching it to the background Service Worker.
3. **Orchestrator & Model Engine**:
   - The Service Worker triggers `chrome.sidePanel.open()` to immediately present the Side Panel interface.
   - **Default Engine**: Uses on-device **Gemini Nano / local Gemma** via Chrome's built-in `ai.languageModel` (Prompt API) for zero-cost generation during development and execution.
   - **BYOK Engine**: Fallback / configurable BYOK provider for frontier models (Claude 3.5 Sonnet, Gemini Flash, Ollama, custom URLs).
4. **Archetype Deduction & Code Synthesis**: Converts context into self-contained HTML/CSS/JS simulation modules matching predefined visualization archetypes (e.g., Parameter Explorers, Step Scrubbers, Interactive Graph/Traversals, State Machine Inspectors).
5. **Offscreen Pre-Flight Verification Harness**:
   - Code is evaluated in an isolated sandbox iframe inside an offscreen document.
   - Run-time errors trigger a 1-shot self-repair loop feeding the error stack back into the model engine.
6. **Side Panel UI Host**: Evaluated modules are rendered inside the Chrome Side Panel with interactive controls (sliders, step scrubbers, state toggles) for instant exploration.

---

## 2. Directory Structure

```
simit/
├── .agents/                    # Agent skills, customizations, and workflows
│   └── skills/                 # Repository skills
│       ├── artifact-graduation/ # Skill for graduating scratch tools into permanent specs
│       └── spec-authoring/      # Skill for contract-first spec writing & harness design
├── .gitignore                  # Git ignore rules
├── AGENTS.md                   # Repository guidelines and operational specifications (this file)
└── docs/                       # Project documentation & living specifications
    ├── backlog/                # Ephemeral execution tasks & feature checklists
    ├── product/                # Product requirements & business vision
    │   ├── prd.md              # Product Requirements Document
    │   └── roadmap.md          # High-level product roadmap
    └── specs/                  # Permanent technical specifications & contracts
        ├── agent_loop.md       # Generation, verification, & self-repair loop spec
        ├── architecture.md     # Chrome Manifest V3 system architecture specification
        └── atif_specification.md # Autonomous Archetype Deduction & Spec Harness
```

---

## 3. Documentation System (`docs/`)

Project documentation is structured into three dedicated directories with strict lifecycle semantics:

- **Product (`docs/product/`)**: Contains Product Requirements Documents (`prd.md`), roadmaps (`roadmap.md`), and high-level product definitions.
  > **Rule for `roadmap.md`:** Keep `roadmap.md` strictly high-level with concise ~2-line functional descriptions of milestones. No execution phases, granular task lists, or checkboxes belong here.
- **Specifications (`docs/specs/`)**: **Long-Lived Architectural Truth**. Contains permanent technical specifications, extension architecture (`architecture.md`), execution loops (`agent_loop.md`), and archetype schemas (`atif_specification.md`). Specs are evergreen documents that outlive individual engineering tasks; when a feature evolves, its spec must be updated in place.
- **Backlog (`docs/backlog/`)**: **Ephemeral Execution Units**. Contains actionable engineering tasks (`tasks.md`), feature checklists, and execution status. Tasks are transient and may be archived or deleted once delivered.
  > **Crucial Rule for Backlog Tasks:** Tasks in `docs/backlog/` must **NEVER duplicate** architectural contracts or schemas. Instead, tasks must simply **REFER** to the living specifications under `docs/specs/` (e.g., `- [ ] Implement Side Panel bridge as specified in docs/specs/architecture.md#side-panel-ui`).

---

## 4. Agent Workflows & Installed Skills

This repository includes specialized agent skills under `.agents/skills/`:

1. **`spec-authoring`**:
   - Use when creating or refining technical specs under `docs/specs/`.
   - Enforces contract-first design, verifiable outputs, test harness integration, and clear interfaces before writing implementation code.
2. **`artifact-graduation`**:
   - Use when evaluating scratch scripts, diagnostic routines, or temporary prototypes built during development.
   - Outlines criteria and procedures for graduating valuable artifacts into permanent codebase assets or documentation specs.

---

## 5. Development & Engineering Guardrails

- **Manifest V3 Compliance**: Ensure background logic strictly adheres to Service Worker lifecycle constraints (stateless event listeners, no persistent global window state, async message passing).
- **Security & Sandboxing**: All dynamic code execution (simulation evaluation) MUST occur within isolated offscreen document sandboxes to comply with Chrome Extension Security Policy (CSP).
- **Zero-Prompt Friction**: Maintain the zero-prompt UX paradigm—users select text and click "SimIt"; the engine autonomously deduces archetypes, bounds, and UI controls without requiring prompt engineering from the user.
- **Git Hygiene**: Keep commits focused and descriptive. Update living documentation (`docs/specs/`) alongside any architectural or code changes.
