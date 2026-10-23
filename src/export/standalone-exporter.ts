/**
 * SimIt Standalone Simulation Exporter
 * Conforms to docs/specs/atif_specification.md#31
 * 
 * Generates an offline, self-contained single .html file that runs
 * in any modern web browser without internet access or Chrome extension APIs.
 */

import { ParameterDefinition, ParameterState, SimulationExplanation } from '../types/simulation';

export interface StandaloneExportOptions {
  title: string;
  description: string;
  parameters: ParameterDefinition[];
  initialParams?: ParameterState;
  explanation?: SimulationExplanation;
  code: string;
  d3Source?: string;
  animeSource?: string;
  katexSource?: string;
  katexCssSource?: string;
  tweakpaneSource?: string;
  functionPlotSource?: string;
  cytoscapeSource?: string;
  mathSource?: string;
  jstatSource?: string;
  matterSource?: string;
  glMatrixSource?: string;
}

export function generateStandaloneSimulationHtml(options: StandaloneExportOptions): string {
  const {
    title,
    description,
    parameters,
    initialParams = {},
    explanation,
    code,
    d3Source = '',
    animeSource = '',
    katexSource = '',
    katexCssSource = '',
    tweakpaneSource = '',
    functionPlotSource = '',
    cytoscapeSource = '',
    mathSource = '',
    jstatSource = '',
    matterSource = '',
    glMatrixSource = ''
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

    #sim-root .simit-tour-highlight {
      outline: 2px solid #38bdf8 !important;
      box-shadow: 0 0 12px rgba(56, 189, 248, 0.55) !important;
      border-radius: 4px;
    }

    .explanation-dock {
      background: var(--card-bg);
      border: 1px solid rgba(56, 189, 248, 0.28);
      border-radius: 12px;
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-size: 12px;
    }

    .explanation-header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .explanation-insight {
      font-weight: 600;
      color: #f8fafc;
    }

    .explanation-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .legend-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(30, 41, 59, 0.85);
      border: 1px solid rgba(148, 163, 184, 0.25);
      font-size: 11px;
      color: #cbd5e1;
    }

    .legend-swatch {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      display: inline-block;
    }

    .legend-symbol {
      font-family: monospace;
      font-weight: 700;
      color: #38bdf8;
    }

    .tour-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding-top: 4px;
      border-top: 1px solid rgba(148, 163, 184, 0.15);
    }

    .tour-btn {
      background: rgba(56, 189, 248, 0.15);
      border: 1px solid rgba(56, 189, 248, 0.4);
      color: #38bdf8;
      border-radius: 6px;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }

    .tour-step-indicator {
      font-family: monospace;
      font-size: 11px;
      color: #94a3b8;
      white-space: nowrap;
    }

    .tour-caption-wrap {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
      overflow: hidden;
    }

    .tour-caption {
      color: #e2e8f0;
      line-height: 1.35;
    }

    .tour-hint {
      font-size: 10px;
      line-height: 1.3;
      border-radius: 3px;
      padding: 1px 4px;
      width: fit-content;
      max-width: 100%;
    }

    .tour-try-this {
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.12);
    }

    .tour-notice-that {
      color: #a78bfa;
      background: rgba(167, 139, 250, 0.12);
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
  ${tweakpaneSource ? `<script>${tweakpaneSource}</script>` : '<script src="https://cdn.jsdelivr.net/npm/tweakpane@4"></script>'}
  ${functionPlotSource ? `<script>${functionPlotSource}</script>` : '<script src="https://unpkg.com/function-plot/dist/function-plot.js"></script>'}
  ${cytoscapeSource ? `<script>${cytoscapeSource}</script>` : '<script src="https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.28.1/cytoscape.min.js"></script>'}
  ${mathSource ? `<script>${mathSource}</script>` : '<script src="https://cdnjs.cloudflare.com/ajax/libs/mathjs/12.4.1/math.js"></script>'}
  ${jstatSource ? `<script>${jstatSource}</script>` : '<script src="https://cdn.jsdelivr.net/npm/jstat@1.9.6/dist/jstat.min.js"></script>'}
  ${matterSource ? `<script>${matterSource}</script>` : '<script src="https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.20.0/matter.min.js"></script>'}
  ${glMatrixSource ? `<script>${glMatrixSource}</script>` : '<script src="https://cdnjs.cloudflare.com/ajax/libs/gl-matrix/3.4.3/gl-matrix-min.js"></script>'}
  <script>
    if (typeof window !== 'undefined') {
      if (!window.jstat && window.jStat) window.jstat = window.jStat;
      if (!window.matter && window.Matter) window.matter = window.Matter;
      if (!window.glmatrix && window.glMatrix) window.glmatrix = window.glMatrix;
    }
  </script>
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

    <div id="explanation-dock" class="explanation-dock" style="display:none">
      <div class="explanation-header">
        <span id="explanation-insight" class="explanation-insight"></span>
        <div id="explanation-legend" class="explanation-legend"></div>
      </div>
      <div id="tour-bar" class="tour-bar" style="display:none">
        <button id="btn-tour-prev" class="tour-btn" type="button">‹ Prev</button>
        <span id="tour-step-indicator" class="tour-step-indicator">Step 1 of 1</span>
        <div class="tour-caption-wrap">
          <span id="tour-caption" class="tour-caption"></span>
          <span id="tour-try-this" class="tour-hint tour-try-this" style="display:none"></span>
          <span id="tour-notice-that" class="tour-hint tour-notice-that" style="display:none"></span>
        </div>
        <button id="btn-tour-next" class="tour-btn" type="button">Next ›</button>
      </div>
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
  } else if (p.type === 'button' || (p as any).type === 'action') {
    return `        <div class="control-row">
          <button class="btn-action" id="btn-${p.id}" style="background:rgba(56,189,248,0.15); border:1px solid #38bdf8; color:#38bdf8; border-radius:4px; padding:6px 12px; font-size:11px; font-weight:600; cursor:pointer; width:100%;">${escapeHtml(p.label || p.id)}</button>
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
      const providedExplanation = ${JSON.stringify(explanation || null)};
      
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
        const inputElem = document.getElementById('input-' + id);
        if (inputElem) {
          if (inputElem.type === 'checkbox') inputElem.checked = Boolean(val);
          else inputElem.value = String(val);
        }
        if (window.__simModule && typeof window.__simModule.update === 'function') {
          window.__simModule.update(currentParams);
        }
      }

      // Bind events to pre-rendered controls
      parameters.forEach(p => {
        const input = document.getElementById('input-' + p.id);
        const btn = document.getElementById('btn-' + p.id);
        if (btn && (p.type === 'button' || p.type === 'action')) {
          btn.addEventListener('click', () => {
            if (window.__simModule && typeof window.__simModule.update === 'function') {
              window.__simModule.update({ ...currentParams, [p.id]: true });
            }
          });
          return;
        }
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

      // Initialize simulation module with StageGeometry
      if (window.__simModule && typeof window.__simModule.init === 'function') {
        const rect = container.getBoundingClientRect();
        const stage = {
          width: Math.round(rect.width) || 560,
          height: Math.round(rect.height) || 340,
          dpr: window.devicePixelRatio || 1,
          safeArea: { top: 0, right: 0, bottom: 0, left: 0 }
        };
        window.__simModule.init(container, currentParams, stage);
      }

      // Initialize Guided Tour & Symbol Legend bar if present
      const exp = (window.__simModule && window.__simModule.explanation) || providedExplanation;
      if (exp && typeof exp === 'object') {
        const dock = document.getElementById('explanation-dock');
        const insightEl = document.getElementById('explanation-insight');
        const legendEl = document.getElementById('explanation-legend');
        const tourBar = document.getElementById('tour-bar');
        const indicator = document.getElementById('tour-step-indicator');
        const caption = document.getElementById('tour-caption');
        const btnPrev = document.getElementById('btn-tour-prev');
        const btnNext = document.getElementById('btn-tour-next');

        if (dock) dock.style.display = 'flex';
        if (insightEl && exp.insight) insightEl.textContent = exp.insight;
        if (legendEl && Array.isArray(exp.legend)) {
          exp.legend.forEach(item => {
            if (!item || !item.symbol || !item.meaning) return;
            const badge = document.createElement('span');
            badge.className = 'legend-badge';
            if (item.color) {
              const sw = document.createElement('span');
              sw.className = 'legend-swatch';
              sw.style.backgroundColor = item.color;
              badge.appendChild(sw);
            }
            const sym = document.createElement('span');
            sym.className = 'legend-symbol';
            sym.textContent = item.symbol;
            const txt = document.createElement('span');
            txt.textContent = ': ' + item.meaning;
            badge.appendChild(sym);
            badge.appendChild(txt);
            legendEl.appendChild(badge);
          });
        }
        if (tourBar && Array.isArray(exp.tour) && exp.tour.length > 0) {
          tourBar.style.display = 'flex';
          let stepIdx = 0;
          const applyStep = (idx, applyParams) => {
            const total = exp.tour.length;
            stepIdx = ((idx % total) + total) % total;
            const step = exp.tour[stepIdx];
            if (!step) return;
            if (indicator) indicator.textContent = 'Step ' + (stepIdx + 1) + ' of ' + total;
            if (caption) caption.textContent = step.caption || '';
            const tryThisEl = document.getElementById('tour-try-this');
            const noticeThatEl = document.getElementById('tour-notice-that');
            if (tryThisEl) {
              if (step.tryThis) {
                tryThisEl.textContent = 'Try: ' + step.tryThis;
                tryThisEl.style.display = 'inline-block';
              } else {
                tryThisEl.textContent = '';
                tryThisEl.style.display = 'none';
              }
            }
            if (noticeThatEl) {
              if (step.noticeThat) {
                noticeThatEl.textContent = 'Notice: ' + step.noticeThat;
                noticeThatEl.style.display = 'inline-block';
              } else {
                noticeThatEl.textContent = '';
                noticeThatEl.style.display = 'none';
              }
            }
            if (applyParams && step.params && typeof step.params === 'object') {
              Object.keys(step.params).forEach(k => updateParam(k, step.params[k]));
            }
          };
          applyStep(0, false);
          if (btnPrev) btnPrev.addEventListener('click', () => applyStep(stepIdx - 1, true));
          if (btnNext) btnNext.addEventListener('click', () => applyStep(stepIdx + 1, true));
        }
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
