# Privacy Policy for SimIt

*Last updated: October 14, 2026*

**SimIt** ("we", "our", or "the extension") is an open-source Chrome Extension designed to transform technical text, mathematical equations, and algorithms into interactive visual simulations. We believe strongly in user privacy, on-device intelligence, and data sovereignty.

---

## 1. Information Collection & Usage

SimIt operates under a strict **zero-collection policy**:
- **No Personal Data Collection**: We do not collect, log, transmit, or monetize any personally identifiable information (PII), browsing history, or user identity.
- **No Analytics / Tracking Telemetry**: The extension contains no tracking scripts, third-party analytics pixels, or remote monitoring software.

---

## 2. On-Page Context & Processing

When you select text, equations, or algorithms and click **"SimIt"**:
- The extension extracts the selected text and immediate DOM context (such as section titles and mathematical annotations like LaTeX/MathML) solely to deduce the simulation archetype.
- This text is processed **ephemerally in browser memory** and is never dispatched to any centralized SimIt server.

---

## 3. AI Inference & Model Providers

1. **Default Local Engine (Chrome Prompt API / Gemini Nano)**:
   - By default, simulation code generation runs **100% locally on your machine** via Chrome's built-in on-device AI.
   - No prompts or harvested text leave your computer.
2. **Bring-Your-Own-Key (BYOK) Providers**:
   - If you choose to configure a BYOK cloud model (e.g., Anthropic Claude, OpenAI, Google Gemini, or custom local endpoints like Ollama), requests are sent directly from your browser to your specified endpoint.
   - SimIt does not operate intermediary proxies or store your API keys outside your local browser storage.

---

## 4. Local Storage & Sandboxed Execution

- **Storage**: Your configured preferences, API keys, and session history are stored exclusively on your device using `chrome.storage.local` and IndexedDB (`simit_db`).
- **Sandboxed Execution**: Generated simulations are evaluated within a restricted, sandboxed iframe conforming to Chrome Extension Manifest V3 security standards, isolating execution from the rest of your browser.

---

## 5. Contact & Source Code

SimIt is open-source software. You can inspect the complete source code or raise questions on GitHub:
- **Repository**: [https://github.com/vmatrixdev/simit](https://github.com/vmatrixdev/simit)
