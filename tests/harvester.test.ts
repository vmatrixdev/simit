/**
 * Context Harvester Test Suite
 * Tests acceptance matrix H1-H5 conforming to docs/specs/context_harvester.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractRawLatexDelimiters,
  extractDOMMathSnippets,
  extractSurroundingDOMContext,
  sanitizeAndEnforceBudget,
  harvestFromCurrentDocument,
  MAX_PAYLOAD_CHAR_BUDGET
} from '../src/harvester/harvester';

describe('Context Harvester Specification Verification', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // H1: Standard LaTeX Selection
  it('H1: extracts standard LaTeX delimiters ($...$, $$...$$, \\(...\\), \\[...\\])', () => {
    const text = 'Given \\(E = mc^2\\) and the energy equation $$H\\psi = E\\psi$$ with \\[a^2 + b^2 = c^2\\] and $x \\in \\mathbb{R}$.';
    const snippets = extractRawLatexDelimiters(text);

    expect(snippets.length).toBe(4);
    expect(snippets.find(s => s.latex === 'E = mc^2' && s.type === 'latex-inline')).toBeDefined();
    expect(snippets.find(s => s.latex === 'H\\psi = E\\psi' && s.type === 'latex-display')).toBeDefined();
    expect(snippets.find(s => s.latex === 'a^2 + b^2 = c^2' && s.type === 'latex-display')).toBeDefined();
    expect(snippets.find(s => s.latex === 'x \\in \\mathbb{R}' && s.type === 'latex-inline')).toBeDefined();
  });

  // H2: KaTeX Rendered Formula
  it('H2: extracts raw TeX from KaTeX .katex annotation[encoding="application/x-tex"]', () => {
    document.body.innerHTML = `
      <div id="paper-root">
        <span class="katex">
          <span class="katex-mathml">
            <math>
              <semantics>
                <annotation encoding="application/x-tex">\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}</annotation>
              </semantics>
            </math>
          </span>
        </span>
      </div>
    `;

    const container = document.getElementById('paper-root')!;
    const snippets = extractDOMMathSnippets(container);

    expect(snippets.length).toBeGreaterThanOrEqual(1);
    const katexSnippet = snippets.find(s => s.type === 'katex-html');
    expect(katexSnippet).toBeDefined();
    expect(katexSnippet?.latex).toBe('\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}');
  });

  // MathJax extraction
  it('extracts math from MathJax v3 container', () => {
    document.body.innerHTML = `
      <div id="container">
        <mjx-container jax="CHTML" data-latex="\\sum_{i=1}^n x_i">
          <span class="mjx-chtml">sum</span>
        </mjx-container>
      </div>
    `;

    const container = document.getElementById('container')!;
    const snippets = extractDOMMathSnippets(container);

    expect(snippets.length).toBe(1);
    expect(snippets[0].type).toBe('mathjax');
    expect(snippets[0].latex).toBe('\\sum_{i=1}^n x_i');
  });

  // H3: Heading Context Extraction
  it('H3: extracts nearest preceding heading (h1-h4) and heading level', () => {
    document.body.innerHTML = `
      <article>
        <h1>Introduction</h1>
        <h2>3. Methodology</h2>
        <h3>3.2.1 Scaled Dot-Product Attention</h3>
        <p id="target-para">The primary equation computes compatibility scores between query and key vectors.</p>
      </article>
    `;

    const targetNode = document.getElementById('target-para')!;
    const context = extractSurroundingDOMContext(targetNode);

    expect(context.nearestHeading).toBe('3.2.1 Scaled Dot-Product Attention');
    expect(context.headingLevel).toBe('H3');
    expect(context.paragraphSnippet).toContain('The primary equation computes');
  });

  // H4: Figcaption Association
  it('H4: associates figcaption when selection is inside figure', () => {
    document.body.innerHTML = `
      <figure id="figure-1">
        <img src="attention.png" alt="Attention diagram" />
        <figcaption id="target-caption">Figure 2: (left) Scaled Dot-Product Attention architecture.</figcaption>
      </figure>
    `;

    const captionNode = document.getElementById('target-caption')!;
    const context = extractSurroundingDOMContext(captionNode);

    expect(context.caption).toBe('Figure 2: (left) Scaled Dot-Product Attention architecture.');
  });

  // H5: Oversized Selection Guard (2,000 char budget limit)
  it('H5: enforces 2,000 character maximum payload budget and truncates centered with [...]', () => {
    const hugeText = 'A'.repeat(3000);
    const hugeParagraph = 'Context '.repeat(500);

    const sanitized = sanitizeAndEnforceBudget(hugeText, hugeParagraph, MAX_PAYLOAD_CHAR_BUDGET);

    const totalLen = sanitized.selectedText.length + sanitized.paragraphSnippet.length;
    expect(totalLen).toBeLessThanOrEqual(MAX_PAYLOAD_CHAR_BUDGET);
    expect(sanitized.selectedText).toContain('[...]');
  });

  it('preserves small selection within paragraph while truncating surrounding paragraph', () => {
    const selected = 'Attention(Q, K, V) = softmax(QK^T / sqrt(d_k))V';
    const longPrefix = 'Pre '.repeat(400);
    const longSuffix = 'Post '.repeat(400);
    const paragraph = `${longPrefix} ${selected} ${longSuffix}`;

    const sanitized = sanitizeAndEnforceBudget(selected, paragraph, MAX_PAYLOAD_CHAR_BUDGET);

    const totalLen = sanitized.selectedText.length + sanitized.paragraphSnippet.length;
    expect(totalLen).toBeLessThanOrEqual(MAX_PAYLOAD_CHAR_BUDGET);
    expect(sanitized.selectedText).toBe(selected);
    expect(sanitized.paragraphSnippet).toContain(selected);
    expect(sanitized.paragraphSnippet).toContain('[...]');
  });

  it('harvestFromCurrentDocument handles fallback gracefully when selection is empty', () => {
    document.body.innerHTML = `
      <main>
        <h2>Test Section</h2>
        <button id="focused-btn">Interactive Algorithm</button>
      </main>
    `;
    const btn = document.getElementById('focused-btn')!;
    btn.focus();

    const harvested = harvestFromCurrentDocument('https://example.org/doc', 'Test Document');

    expect(harvested.selection.documentTitle).toBe('Test Document');
    expect(harvested.selection.sourceUrl).toBe('https://example.org/doc');
    expect(harvested.harvestId).toBeDefined();
    expect(harvested.timestamp).toBeDefined();
  });
});
