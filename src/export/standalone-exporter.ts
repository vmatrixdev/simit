/**
 * SimIt Standalone Simulation Exporter
 * Conforms to docs/specs/atif_specification.md#31
 * 
 * Generates an offline, self-contained single .html file that runs
 * in any modern web browser without internet access or Chrome extension APIs.
 */

import { ParameterDefinition, ParameterState } from '../types/simulation';

export interface StandaloneExportOptions {
  title: string;
  description: string;
  parameters: ParameterDefinition[];
  initialParams?: ParameterState;
  code: string;
  d3Source?: string;
  animeSource?: string;
  katexSource?: string;
  katexCssSource?: string;
}

export function generateStandaloneSimulationHtml(options: StandaloneExportOptions): string {
  const {
    title,
    description,
    parameters,
    initialParams = {},
    code,
    d3Source = '',
    animeSource = '',
    katexSource = '',
    katexCssSource = ''
  } = options;

  // Transform "export default" to executable return statement
  let moduleCode = code;
  if (moduleCode.includes('export default')) {
    moduleCode = moduleCode.replace(/export\s+default\s+/, 'window.__simModule = ');
  } else {
    moduleCode = `window.__simModule = ${moduleCode};`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - SimIt Interactive Simulation</title>
  <style>
    ${katexCssSource}
    
    :root {
      --bg: #090d16;
      --card-bg: rgba(22, 27, 46, 0.85);
      --border: rgba(99, 102, 241, 0.25);
      --accent: #6366f1;
      --accent-glow: rgba(99, 102, 241, 0.4);
      --text: #f8fafc;
      --text-muted: #94a3b8;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 24px 16px;
    }

    .container {
      width: 100%;
      max-width: 600px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    header {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 20px;
      backdrop-filter: blur(12px);
    }

    .badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #818cf8;
      background: rgba(99, 102, 241, 0.15);
      padding: 3px 8px;
      border-radius: 4px;
      margin-bottom: 6px;
    }

    h1 {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 6px;
      color: #ffffff;
    }

    p.description {
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.5;
    }

    #sim-container {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      min-height: 340px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      position: relative;
    }

    #sim-root {
      width: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
    }

    #sim-root canvas, #sim-root svg {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
    }

    .controls-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 20px;
    }

    .controls-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 12px;
    }

    .control-row {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 14px;
    }

    .control-row:last-child {
      margin-bottom: 0;
    }

    .control-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 13px;
    }

    .control-label {
      font-weight: 500;
      color: #e2e8f0;
    }

    .control-val {
      font-family: monospace;
      color: #a5b4fc;
      font-size: 12px;
    }

    input[type="range"] {
      width: 100%;
      accent-color: var(--accent);
      cursor: pointer;
    }

    .toggle-row {
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
    }

    input[type="checkbox"] {
      accent-color: var(--accent);
      cursor: pointer;
      width: 16px;
      height: 16px;
    }

    select {
      background: #1e293b;
      border: 1px solid var(--border);
      color: #fff;
      padding: 6px 10px;
      border-radius: 6px;
      outline: none;
      font-size: 13px;
    }

    footer {
      text-align: center;
      font-size: 11px;
      color: #64748b;
      margin-top: 8px;
    }
  </style>

  ${d3Source ? `<script>${d3Source}</script>` : '<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>'}
  ${animeSource ? `<script>${animeSource}</script>` : '<script src="https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.1/anime.min.js"></script>'}
  ${katexSource ? `<script>${katexSource}</script>` : '<script src="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.js"></script>'}
</head>
<body>
  <div class="container">
    <header>
      <div class="badge">SimIt Standalone Simulation</div>
      <h1>${escapeHtml(title)}</h1>
      <p class="description">${escapeHtml(description)}</p>
    </header>

    <div id="sim-container">
      <div id="sim-root"></div>
    </div>

    <div class="controls-card" id="controls-card"${parameters.length === 0 ? ' style="display:none"' : ''}>
      <div class="controls-title">Interactive Parameters</div>
      <div id="controls-list">
${parameters.map(p => {
  const currentVal = initialParams[p.id] !== undefined ? initialParams[p.id] : p.default;
  if (p.type === 'slider' || p.type === 'stepper') {
    return `        <div class="control-row">
          <div class="control-header">
            <span class="control-label">${escapeHtml(p.label)}</span>
            <span class="control-val" id="val-${p.id}">${currentVal} ${p.unit || ''}</span>
          </div>
          <input type="range" id="input-${p.id}" min="${p.min !== undefined ? p.min : 0}" max="${p.max !== undefined ? p.max : 100}" step="${p.step !== undefined ? p.step : 1}" value="${currentVal}" />
        </div>`;
  } else if (p.type === 'toggle') {
    return `        <div class="control-row toggle-row">
          <span class="control-label">${escapeHtml(p.label)}</span>
          <input type="checkbox" id="input-${p.id}" ${currentVal ? 'checked' : ''} />
        </div>`;
  } else if (p.type === 'select') {
    return `        <div class="control-row">
          <div class="control-header">
            <span class="control-label">${escapeHtml(p.label)}</span>
          </div>
          <select id="input-${p.id}">
            ${(p.options || []).map(opt => `<option value="${opt}" ${opt === currentVal ? 'selected' : ''}>${opt}</option>`).join('')}
          </select>
        </div>`;
  }
  return '';
}).join('\n')}
      </div>
    </div>

    <footer>Generated with SimIt - Standalone Simulation Export</footer>
  </div>

  <script>
    ${moduleCode}

    (function() {
      const parameters = ${JSON.stringify(parameters)};
      const currentParams = ${JSON.stringify(initialParams)};
      
      // Initialize defaults
      parameters.forEach(p => {
        if (currentParams[p.id] === undefined && p.default !== undefined) {
          currentParams[p.id] = p.default;
        }
      });

      const container = document.getElementById('sim-root');

      function updateParam(id, val) {
        currentParams[id] = val;
        const valElem = document.getElementById('val-' + id);
        if (valElem) valElem.textContent = val;
        if (window.__simModule && typeof window.__simModule.update === 'function') {
          window.__simModule.update(currentParams);
        }
      }

      // Bind events to pre-rendered controls
      parameters.forEach(p => {
        const input = document.getElementById('input-' + p.id);
        if (!input) return;
        if (p.type === 'slider' || p.type === 'stepper') {
          input.addEventListener('input', (e) => {
            const num = parseFloat(e.target.value);
            updateParam(p.id, isNaN(num) ? e.target.value : num);
          });
        } else if (p.type === 'toggle') {
          input.addEventListener('change', (e) => {
            updateParam(p.id, e.target.checked);
          });
        } else if (p.type === 'select') {
          input.addEventListener('change', (e) => {
            updateParam(p.id, e.target.value);
          });
        }
      });

      // Initialize simulation module
      if (window.__simModule && typeof window.__simModule.init === 'function') {
        window.__simModule.init(container, currentParams);
      }
    })();
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
