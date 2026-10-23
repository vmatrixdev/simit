# AGENTS.md - SimIt Project Guidelines

## 1. Project Overview & Architecture

**SimIt** (Paper/Doc Interactive Visualizer Copilot) is a Chrome Extension (Manifest V3) that converts complex technical text, mathematical equations, and algorithms from web pages, research papers, or documentation into **zero-prompt, real-time, interactive visual simulations**.

### Core User Flow & Architecture
1. **Host Page Interaction**: User highlights text, an equation, or an algorithm on any tab, right-clicks, and selects the **"SimIt"** context menu option.
2. **Context Harvester**: A Content Script harvests the selected snippet alongside surrounding DOM context, headings, and captions, and dynamically measures active viewport dimensions.
3. **Orchestrator & Multi-Agent Engine**:
   - The Service Worker triggers `chrome.sidePanel.open()` to immediately present the Side Panel interface.
   - **Epistemic Architect**: Deliberates unconstrained on pedagogy (`coreInsight`, `misconception`, `ahaExperiment`) and formulates a mental model blueprint (`CoderPlanSpec`).
   - **Simulation Coder**: Sub-agent that compiles the blueprint into an executable ES module conforming to the single-source `SimModule` contract (`init`, `update`, `destroy`, `explanation`).
   - **Default Engine**: Uses on-device **Gemini Nano / local Gemma** via Chrome's built-in `ai.languageModel` (Prompt API) for zero-cost generation.
   - **BYOK Engine**: Configurable provider for frontier models (Claude 3.5 Sonnet, Gemini 2.5 Flash, Ollama, custom URLs).
4. **Offscreen Pre-Flight Verification Soak Harness**:
   - Code is mounted visibly offscreen at real Side Panel pixel dimensions.
   - Executes multi-frame rendering soak (~800ms) with pure zero-token diagnostics (`isBlankRender`, `scanNonFiniteText`, `detectDuplicateControls`, raster statistics) and boundary sweeps.
   - Detected flaws feed screenshot rasters, stack traces, and diagnostics back into the Coder for targeted code-patching revisions.
5. **Side Panel UI Host**: Evaluated modules render inside the Chrome Side Panel with host-managed controls drawer (`#pane-dock`), live guided tour bar (`#tour-bar`), and explanation dock (`#explanation-dock`).

---

## 2. Directory Structure

```
simit/
├── .agents/                    # Agent skills, customizations, and workflows
│   ├── rules/git-sandbox.md    # Sandboxed git execution rules
│   └── skills/                 # Repository skills
│       ├── artifact-graduation/ # Skill for graduating scratch tools into permanent specs
│       ├── e2e-simulation-testing/ # Autonomous browser testing & visual diagnostics
│       └── spec-authoring/      # Contract-first spec writing & harness design
├── AGENTS.md                   # Repository guidelines and operational specifications (this file)
├── docs/                       # Project documentation & living specifications
│   ├── backlog/tasks.md        # Ephemeral execution tasks & feature checklists
│   ├── product/                # Product requirements & business vision
│   │   ├── chrome_web_store_publishing.md # Chrome Web Store guide & metadata
│   │   ├── prd.md              # Product Requirements Document
│   │   └── roadmap.md          # High-level product roadmap
│   └── specs/                  # Permanent technical specifications (14 specs + index.md)
│       ├── index.md            # Master specification registry & contract index
│       ├── architecture.md     # System architecture specification
│       ├── autonomous_agent_architecture.md # Two-tier multi-agent loop spec
│       ├── simulation_module_contract.md # Single-source module contract & StageGeometry
│       ├── simulation_verification.md # Offscreen verification soak & diagnostics
│       └── ...                 # Complete domain specifications
├── public/                     # Static extension manifest and icons
├── scripts/                    # Developer tooling (setup.sh, dev.sh)
├── src/                        # Extension source code
│   ├── background/             # Manifest V3 Background Service Worker
│   ├── export/                 # Standalone HTML exporter & ATIF trajectory logger
│   ├── harvester/              # Content script DOM & math equation harvester
│   ├── offscreen/              # Headless offscreen document verification harness
│   ├── providers/              # Gemini Nano, Claude, Gemini Cloud, OpenAI providers
│   ├── runtime/                # Agent orchestrator, verification, triage, session DB
│   ├── sandbox/                # Isolated sandbox iframe & declarative library stack
│   ├── sidepanel/              # Chrome Side Panel UI host
│   └── types/                  # Strongly typed TypeScript domain models
└── tests/                      # Vitest unit/integration test suites & Playwright E2E
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
3. **`e2e-simulation-testing`**:
   - Use to execute autonomous end-to-end browser tests, observe multi-context logs, visually verify simulation screenshots, and diagnose runtime/CSP issues without human relays.

---

## 5. Development & Engineering Guardrails

- **Manifest V3 Compliance**: Ensure background logic strictly adheres to Service Worker lifecycle constraints (stateless event listeners, no persistent global window state, async message passing).
- **Security & Sandboxing**: All dynamic code execution (simulation evaluation) MUST occur within isolated offscreen document sandboxes to comply with Chrome Extension Security Policy (CSP).
- **Git Hygiene & Sandboxed Execution**: Keep commits focused and descriptive. Update living documentation (`docs/specs/`) alongside any architectural or code changes.
  > **CRITICAL Git Execution Invariant:** The host machine includes a custom global gitconfig outside the sandbox (`~/.gitconfig-vmatrixdev`). To avoid `fatal: unable to access ... Operation not permitted` sandbox failures, **ALL `git` commands MUST be run with `GIT_CONFIG_GLOBAL=/dev/null` upfront** (e.g., `GIT_CONFIG_GLOBAL=/dev/null git status`, `GIT_CONFIG_GLOBAL=/dev/null git checkout ...`). Never execute bare `git` commands.

