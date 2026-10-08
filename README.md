# SimIt 🔬

> **Zero-prompt, real-time interactive visual simulations for technical papers, mathematical equations, and algorithms.**

SimIt is a Chrome Extension (Manifest V3) that turns highlighted equations, mathematical models, and algorithms on any web page into fully interactive, reactive visual simulations inside the Chrome Side Panel.

---

## ⚡ Quickstart

Get up and running in under 2 minutes:

### 1. Clone the Repository

**SSH (Recommended):**
```bash
git clone git@github.com:vmatrixdev/simit.git
cd simit
```

**HTTPS:**
```bash
git clone https://github.com/vmatrixdev/simit.git
cd simit
```

### 2. Run Automated Setup

SimIt provides an automated setup script that verifies prerequisites, installs npm dependencies, builds the extension, and runs all test suites:

```bash
npm run setup
```
*(Or run directly via `./scripts/setup.sh`)*

---

## 📦 Manual Installation & Build

If you prefer step-by-step setup:

```bash
# 1. Install dependencies
npm install

# 2. Build the extension bundle (Vite + vendor simulation libraries)
npm run build

# 3. Verify tests
npm test
```

---

## 🧩 Loading SimIt into Google Chrome

Once built, the loadable extension bundle is output to the `dist/` directory.

1. Open **Google Chrome** (or Chromium-based browser).
2. Navigate to:
   ```text
   chrome://extensions
   ```
3. In the top-right corner, switch the **Developer mode** toggle to **ON**.
4. In the top-left corner, click **Load unpacked**.
5. Select the `dist/` directory inside your cloned `simit` repository:
   ```text
   /path/to/simit/dist
   ```
6. The **SimIt - Interactive Visualizer Copilot** extension is now installed!
7. Pin SimIt to your Chrome toolbar for quick access.

---

## 🚀 How to Use

1. Navigate to any technical article, paper, or documentation page (e.g., Wikipedia, ArXiv, Distill).
2. Highlight an equation, algorithm description, or technical concept.
3. **Right-click** the highlighted text and select **"SimIt"**.
4. The Chrome Side Panel opens instantly with:
   - Automated Archetype Deduction (Parameter Explorer, State Machine, Graph Traversal, Phase Portrait, etc.).
   - Pre-flight verified interactive canvas / SVG / KaTeX simulation.
   - Interactive controls (sliders, scrubbers, state toggles) to explore parameters dynamically.

---

## 🧠 Model Configuration (Prompt API & BYOK)

SimIt supports dual execution engines:

### Option A: Zero-Cost Local On-Device AI (Chrome Built-in Prompt API / Gemini Nano)
Requires Chrome 128+ or Chrome Canary:
1. Navigate to `chrome://flags/#optimization-guide-on-device-model` → Set to **Enabled BypassPerfRequirement**.
2. Navigate to `chrome://flags/#prompt-api-for-gemini-nano` → Set to **Enabled**.
3. Relaunch Chrome.
4. Navigate to `chrome://components` and find **Optimization Guide On Device Model**. Click **Check for update** until downloaded.

### Option B: Bring Your Own Key (BYOK)
In the SimIt Side Panel UI:
1. Click the **Settings (⚙)** icon.
2. Select your provider:
   - **Google Gemini Flash** (enter your Gemini API Key)
   - **Anthropic Claude 3.5 Sonnet** (enter your Anthropic API Key)
   - **Local Ollama** (e.g., `http://localhost:11434` with model `gemma2` or `llama3`)

---

## 🛠️ Development & Helper Scripts

SimIt includes helper scripts and commands for productive local development:

| Command | Description |
| :--- | :--- |
| `npm run setup` | Automated environment validation, dependency install, build, and test run (`scripts/setup.sh`). |
| `npm run dev` | Continuous development watch mode with automatic vendor sync and Vite watch (`scripts/dev.sh`). |
| `npm run build` | Full production build of extension into `dist/`. |
| `npm test` | Run Vitest unit & integration test suites. |
| `npm run test:watch` | Run Vitest in interactive watch mode. |
| `npm run test:e2e` | Run Playwright autonomous end-to-end browser test harness with real extension loading. |
| `npm run typecheck` | Run TypeScript type checking without emitting files. |

> **Development Tip:** When developing with `npm run dev`, after modifying files, simply click the **refresh icon (↺)** on the SimIt card in `chrome://extensions` to reload the updated bundle into Chrome.

---

## 📁 Project Architecture

```
simit/
├── dist/                      # Compiled extension bundle (target for "Load unpacked")
├── docs/                      # Architectural specs & documentation
│   ├── specs/                 # Evergreen architectural specifications
│   │   ├── agent_loop.md      # Generation, verification & self-repair loop spec
│   │   ├── architecture.md    # Manifest V3 extension pipeline spec
│   │   ├── atif_specification.md # Archetype schemas & contracts
│   │   └── declarative_runtime.md # Runtime engine & vendor integration
│   └── product/               # Product requirements & roadmap
├── public/                    # Extension static assets & manifest
│   ├── manifest.json          # Chrome Manifest V3 configuration
│   └── icons/                 # Extension toolbar & store icons
├── scripts/                   # Developer helper scripts
│   ├── setup.sh               # One-click environment bootstrap & sanity check
│   └── dev.sh                 # Extension watch mode runner
├── src/                       # TypeScript source code
│   ├── background/            # Manifest V3 Service Worker orchestrator
│   ├── harvester/             # Content script for contextual DOM extraction
│   ├── offscreen/             # Offscreen pre-flight verification sandbox
│   ├── sandbox/               # Isolated iframe runtime with Matter.js, D3, KaTeX, Math.js
│   ├── sidepanel/             # Chrome Side Panel UI host & interactive controllers
│   ├── providers/             # LLM engines (Prompt API, Gemini Flash, Claude, Ollama)
│   └── types/                 # Shared data contracts & archetype interfaces
└── tests/                     # Unit, integration, and Playwright E2E tests
    ├── e2e/                   # Autonomous E2E browser harness
    └── *.test.ts              # Unit and integration test suites
```

---

## 🔒 Security & Sandboxing Note

All dynamically synthesized JavaScript simulations execute within an isolated, unprivileged sandbox iframe (`src/sandbox/sandbox.html`) in accordance with Chrome Manifest V3 Content Security Policy (CSP). The sandbox communicates with the Side Panel exclusively via postMessage RPC contracts.

---

## 📄 License

ISC License. See [LICENSE](LICENSE) for details.
