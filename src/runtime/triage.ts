/**
 * SimIt Archetype Triage & Fallback Engine
 * Conforms to docs/specs/archetype_triage.md
 */

import { HarvestedContext } from '../types/harvester';
import {
  ArchetypeClassification,
  ArchetypeTriageResult,
  ConceptDagData,
  SocraticBreakdownData
} from '../types/archetype';
import { SimModule } from '../types/simulation';

/**
 * Classifies harvested technical context into canonical archetypes upfront
 */
export function classifyArchetype(context: HarvestedContext): ArchetypeClassification {
  const text = (context.selection.selectedText || '').toLowerCase();
  const mathCount = context.mathSnippets?.length || 0;
  const paragraph = (context.domContext?.paragraphSnippet || '').toLowerCase();
  const heading = (context.domContext?.nearestHeading || '').toLowerCase();
  const fullCorpus = `${heading} ${text} ${paragraph}`;

  // 1. Math equations with continuous variables -> parameter_explorer
  const hasContinuousFormula =
    mathCount > 0 ||
    /(\b(?:softmax|loss|temperature|tau|gradient|decay|rate|sigma|exp|sigmoid|relu|derivative|integral|sin|cos|oscillator)\b|\\frac|\\sum|\^|[\+\-\*\/]=)/i.test(text);

  // 2. Multi-step algorithms, sorting, loops -> step_scrubber
  const isAlgorithmic =
    /\b(quicksort|mergesort|bubblesort|binary search|dijkstra|bfs|dfs|step \d+|iteration|for each|while loop|pivot|swap)\b/i.test(fullCorpus);

  // 3. State machines, protocols, automata, transitions -> state_machine
  const isStateMachine =
    /\b(state machine|automaton|markov|transition|tcp congestion|handshake|fsm|states:|slow start|fast recovery)\b/i.test(fullCorpus);

  // 4. Hierarchical concepts, architectures, taxonomies -> concept_dag
  const isHierarchical =
    /\b(architecture|consists of|composed of|hierarchy|sublayer|taxonomy|module structure|layers|pipeline|encoder|decoder|feed-forward)\b/i.test(fullCorpus);

  // 5. Historical or biographical or philosophical text -> socratic_breakdown
  const isHistoricalOrStatic =
    /\b(in \d{4}|proposed by|invented by|history of|origin|definition:|the term|philosophy|background)\b/i.test(fullCorpus);

  if (isAlgorithmic) {
    return {
      archetype: 'step_scrubber',
      confidence: 0.95,
      rationale: 'Contains sequential algorithmic steps, loops, or comparative element manipulations.',
      isSimulatable: true
    };
  }

  if (isStateMachine) {
    return {
      archetype: 'state_machine',
      confidence: 0.93,
      rationale: 'Contains discrete finite states, transition conditions, or protocol states.',
      isSimulatable: true
    };
  }

  if (hasContinuousFormula) {
    return {
      archetype: 'parameter_explorer',
      confidence: 0.96,
      rationale: 'Contains mathematical formulas with continuous parameter domains.',
      isSimulatable: true,
      suggestedVariables: extractReferencedVariables(text)
    };
  }

  if (isHierarchical) {
    return {
      archetype: 'concept_dag',
      confidence: 0.91,
      rationale: 'Describes multi-tier architectural hierarchy or taxonomy without continuous dynamics.',
      isSimulatable: false
    };
  }

  if (isHistoricalOrStatic) {
    return {
      archetype: 'socratic_breakdown',
      confidence: 0.94,
      rationale: 'Historical narrative, static taxonomy, or background definition.',
      isSimulatable: false
    };
  }

  // Default fallback for qualitative non-mathematical text
  return {
    archetype: 'concept_dag',
    confidence: 0.85,
    rationale: 'Conceptual text without explicit mathematical formulas; structured into concept map.',
    isSimulatable: false
  };
}

/**
 * Extracts potential variable symbols referenced in snippet
 */
function extractReferencedVariables(text: string): string[] {
  const vars = new Set<string>();
  const matches = text.match(/\b([a-zA-Z]|tau|alpha|beta|gamma|lambda|theta|omega|lr|eps)\b/g);
  if (matches) {
    for (const m of matches) {
      if (!['a', 'i', 'in', 'is', 'to', 'of', 'and', 'the', 'by', 'as', 'for', 'or', 'on'].includes(m.toLowerCase())) {
        vars.add(m);
      }
    }
  }
  return Array.from(vars).slice(0, 5);
}

/**
 * Generates an interactive Cytoscape Concept DAG fallback module adhering to "No Meaningless Motion"
 */
export function buildConceptDagModule(dagData: ConceptDagData): SimModule {
  return {
    title: dagData.title,
    description: dagData.summary,
    parameters: [
      {
        id: 'layout',
        label: 'DAG Layout',
        type: 'select',
        options: ['breadthfirst', 'concentric', 'cose'],
        default: 'breadthfirst'
      }
    ],
    init(container: HTMLElement, params: any) {
      container.innerHTML = `
        <div style="width: 100%; height: 100%; display: flex; flex-direction: column; background: #0b0f19; font-family: sans-serif; position: relative;">
          <div id="cy-root" style="flex: 1; width: 100%; height: 100%;"></div>
          <div id="cy-inspector" style="padding: 10px 14px; background: rgba(15, 23, 42, 0.92); border-top: 1px solid rgba(99, 102, 241, 0.3); font-size: 11px; color: #cbd5e1; max-height: 120px; overflow-y: auto;">
            <strong style="color: #38bdf8;">Interactive Concept DAG:</strong> Tap any node to inspect relationships.
          </div>
        </div>
      `;

      const cyRoot = container.querySelector('#cy-root') as HTMLElement;
      const inspector = container.querySelector('#cy-inspector') as HTMLElement;

      const elements = [
        ...dagData.nodes.map(n => ({
          data: {
            id: n.id,
            label: n.label,
            desc: n.description,
            category: n.category || 'core',
            math: n.mathFormula || ''
          }
        })),
        ...dagData.edges.map(e => ({
          data: {
            id: e.id,
            source: e.source,
            target: e.target,
            label: e.label || e.relationship
          }
        }))
      ];

      const cy = (window as any).cytoscape ? (window as any).cytoscape({
        container: cyRoot,
        elements,
        style: [
          {
            selector: 'node',
            style: {
              'background-color': '#4f46e5',
              'label': 'data(label)',
              'color': '#f8fafc',
              'font-size': '11px',
              'text-valign': 'center',
              'text-halign': 'center',
              'width': 60,
              'height': 30,
              'shape': 'round-rectangle'
            }
          },
          {
            selector: 'edge',
            style: {
              'width': 2,
              'line-color': '#6366f1',
              'target-arrow-color': '#6366f1',
              'target-arrow-shape': 'triangle',
              'curve-style': 'bezier',
              'label': 'data(label)',
              'font-size': '9px',
              'color': '#94a3b8'
            }
          },
          {
            selector: 'node:selected',
            style: {
              'background-color': '#38bdf8',
              'border-width': 2,
              'border-color': '#ffffff'
            }
          }
        ],
        layout: {
          name: params.layout || 'breadthfirst',
          directed: true,
          padding: 16
        }
      }) : null;

      if (cy) {
        (this as any).__cy = cy;
        cy.on('tap', 'node', (evt: any) => {
          const node = evt.target;
          const d = node.data();
          inspector.innerHTML = `
            <div style="font-weight: 600; color: #38bdf8; margin-bottom: 2px;">${d.label} [${d.category}]</div>
            <div>${d.desc}</div>
            ${d.math ? `<div style="margin-top: 4px; color: #a5b4fc;">Formula: ${d.math}</div>` : ''}
          `;
        });
      }
    },
    update(params: any) {
      const cy = (this as any).__cy;
      if (cy && params.layout) {
        cy.layout({ name: params.layout, directed: true, padding: 16, animate: true }).run();
      }
    },
    destroy() {
      const cy = (this as any).__cy;
      if (cy && typeof cy.destroy === 'function') {
        cy.destroy();
      }
    }
  };
}

/**
 * Generates an interactive Socratic Breakdown fallback module adhering to "No Meaningless Motion"
 */
export function buildSocraticBreakdownModule(breakdown: SocraticBreakdownData): SimModule {
  return {
    title: breakdown.title,
    description: breakdown.coreThesis,
    parameters: [],
    init(container: HTMLElement) {
      container.innerHTML = `
        <div style="width: 100%; height: 100%; padding: 14px; background: #090d16; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; overflow-y: auto; box-sizing: border-box;">
          <div style="background: rgba(99, 102, 241, 0.12); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px;">
            <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: #818cf8; margin-bottom: 4px;">Core Epistemic Thesis</div>
            <div style="font-size: 13px; line-height: 1.4;">${breakdown.coreThesis}</div>
          </div>

          <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: #94a3b8; margin-bottom: 8px;">Explore Socratic Inquiries:</div>
          <div id="socratic-chips" style="display: flex; flex-direction: column; gap: 8px;">
            ${breakdown.chips.map(chip => `
              <div class="socratic-card" style="background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 6px; padding: 8px 10px; cursor: pointer; transition: all 0.2s ease;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 12px; font-weight: 500; color: #38bdf8;">${chip.shortLabel}</span>
                  <span style="font-size: 10px; color: #64748b;">▼</span>
                </div>
                <div class="chip-content" style="display: none; margin-top: 6px; font-size: 12px; color: #cbd5e1; border-top: 1px solid rgba(255, 255, 255, 0.06); padding-top: 6px; line-height: 1.4;">
                  <div style="font-style: italic; color: #94a3b8; margin-bottom: 4px;">"${chip.question}"</div>
                  <div>${chip.answer}</div>
                </div>
              </div>
            `).join('')}
          </div>

          ${breakdown.expandRecommendation ? `
            <div style="margin-top: 14px; background: rgba(56, 189, 248, 0.08); border: 1px dashed rgba(56, 189, 248, 0.35); border-radius: 6px; padding: 8px 10px; font-size: 11px; color: #38bdf8;">
              💡 <strong>Expansion Tip:</strong> ${breakdown.expandRecommendation}
            </div>
          ` : ''}
        </div>
      `;

      // Bind toggle interactions
      const cards = container.querySelectorAll('.socratic-card');
      cards.forEach(card => {
        card.addEventListener('click', () => {
          const content = card.querySelector('.chip-content') as HTMLElement;
          const arrow = card.querySelector('span:last-child') as HTMLElement;
          if (content.style.display === 'none' || !content.style.display) {
            content.style.display = 'block';
            arrow.textContent = '▲';
          } else {
            content.style.display = 'none';
            arrow.textContent = '▼';
          }
        });
      });
    },
    update() {},
    destroy() {}
  };
}
