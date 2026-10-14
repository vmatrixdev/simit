# Chrome Web Store Publishing Guide for SimIt

This guide provides instructions, copy-paste assets, and reviewer justifications for publishing **SimIt** to the Chrome Web Store.

---

## 1. Prerequisites (One-Time Setup)

1. **Google Account with 2FA**:
   - Ensure 2-Step Verification (2FA) is turned on for your Google Account.
2. **Developer Dashboard**:
   - Visit the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
3. **Registration Fee**:
   - Pay the one-time $5 developer registration fee via Google Pay.
   - Accept the Developer Agreement.

---

## 2. Packaging the Extension

SimIt includes an automated script that compiles production assets and generates a clean ZIP archive with `manifest.json` at the root:

```bash
npm run package
```

- **Output File**: `simit-extension.zip` in the project root directory.
- **Verification**: `simit-extension.zip` contains `manifest.json`, `service-worker.js`, `content-script.js`, `assets/`, `icons/`, and `src/`.

---

## 3. Store Listing Information

When creating or editing the item in the Developer Console, populate the following fields:

### Basic Metadata

| Field | Value |
| :--- | :--- |
| **Name** | `SimIt - Interactive Visualizer Copilot` |
| **Summary** *(<= 132 characters)* | `Zero-prompt, real-time interactive visual simulations for technical papers, equations, and algorithms.` |
| **Category** | `Productivity` *(Alternative: `Developer Tools` or `Education`)* |
| **Primary Language** | `English` |

### Detailed Description (Markdown / Plain Text)

```text
SimIt transforms complex technical text, mathematical equations, and algorithms from web pages, research papers, and documentation into zero-prompt, real-time, interactive visual simulations.

KEY FEATURES:
• Zero-Prompt Friction: Simply highlight an equation, algorithm, or concept on any webpage, right-click, and select "SimIt".
• Autonomous Archetype Deduction: Automatically identifies whether the snippet represents a Parameter Explorer, Step Scrubber, Interactive Graph/Traversal, or State Machine.
• Declarative Interactive Visuals: Renders interactive sliders, phase diagrams, state graphs, and dynamic animations in an ergonomic Side Panel.
• Multimodal Visual Review & Self-Repair: Automatically tests and validates generated simulations in a sandboxed runtime before displaying them.
• 100% Local Intelligence: Uses Chrome's built-in on-device AI (Gemini Nano via Prompt API) for instant, zero-cost, private generation.
• Bring-Your-Own-Key (BYOK): Supports optional cloud model routing (Claude 3.5 Sonnet, Gemini Flash, OpenAI, or local Ollama) for advanced mathematical proofs.
• Export Anywhere: Export standalone, single-file HTML simulations or ATIF benchmark trajectories with a single click.

PRIVACY & SECURITY:
• All default processing runs locally on your machine via Chrome built-in AI.
• Sandboxed execution iframe prevents unsafe script evaluation.
• No analytics tracking, telemetry, or data collection.
```

---

## 4. Visual & Graphic Assets

Prepare and upload the following graphic assets in the **Store Listing** section:

1. **Extension Icon**:
   - Location: `public/icons/icon128.png` (128×128 PNG).
2. **Screenshots** *(At least 1 required, up to 5)*:
   - **Resolution**: `1280x800` or `640x400` PNG or JPEG.
   - Recommended content: Split view showing a research paper on the left (e.g. arXiv) and SimIt's Side Panel on the right with an active interactive simulation and parameter controls.
3. **Small Promotional Tile** *(Required)*:
   - **Resolution**: `440x280` PNG or JPEG.
   - Banner displaying the SimIt logo, branding, and tag line.
4. **Marquee Promotional Tile** *(Optional, recommended for featured store placement)*:
   - **Resolution**: `1400x560` PNG or JPEG.

---

## 5. Privacy & Permissions Declarations

In the **Privacy** tab of the developer dashboard, supply the following answers to pass Google review without delays:

### Single Purpose Description
> *"SimIt provides a side-panel interactive visual simulation tool that converts highlighted technical text, mathematical equations, or algorithms into real-time interactive diagrams and parameter explorers."*

### Permission Justifications

| Permission | Reviewer Justification |
| :--- | :--- |
| **`sidePanel`** | Needed to render the interactive simulation, sliders, and controls side-by-side with the active reading tab without obstructing host page content. |
| **`contextMenus`** | Needed to provide the right-click "SimIt" menu option when the user highlights text or equations on a webpage. |
| **`activeTab`** | Needed to access the user's current selection and trigger simulation generation when the user clicks the context menu option. |
| **`scripting`** | Needed to extract DOM mathematical annotations (KaTeX, MathJax, MathML) and surrounding headings from the active tab upon explicit user invocation. |
| **`offscreen`** | Needed to run an isolated pre-flight testing harness to verify that synthesized simulation code runs cleanly without errors before showing it to the user. |
| **`storage`** | Needed to save user settings, history sessions, and optional BYOK API keys locally in the browser. |
| **`<all_urls>` (Host Permission)** | Users read technical papers and documentation across arbitrary domains (e.g., arXiv, Wikipedia, GitHub, documentation sites). The content script only runs context extraction when triggered by user selection. |

### Data Usage & Privacy Policy
- **Data Collection**: Check *"I do not collect or transmit user data."*
  - Context: All default AI generations run 100% locally on-device using Chrome's built-in Prompt API (`ai.languageModel`). Any user-configured BYOK models communicate directly from the client to the provider.
- **Privacy Policy URL**:
  ```
  https://github.com/vmatrixdev/simit/blob/main/PRIVACY.md
  ```

---

## 6. Review & Release Lifecycle

1. Click **"Save draft"** to persist your inputs.
2. Click **"Submit for Review"**.
3. Typical review turnaround: **24 to 72 hours**.
4. Once approved, the extension will be live and installable from the Chrome Web Store.
