/**
 * SimIt Context Harvester
 * Conforms to docs/specs/context_harvester.md
 */

import { HarvestedContext, MathSnippet, SelectionMetadata, SurroundingDOMContext } from '../types/harvester';

export const MAX_PAYLOAD_CHAR_BUDGET = 2000;

/**
 * Normalizes and extracts LaTeX from raw LaTeX delimiters ($...$, $$...$$, \(...\), \[...\])
 */
export function extractRawLatexDelimiters(text: string): MathSnippet[] {
  const snippets: MathSnippet[] = [];
  if (!text) return snippets;

  // Display math $$...$$
  const displayRegex = /\$\$([\s\S]+?)\$\$/g;
  let match: RegExpExecArray | null;
  while ((match = displayRegex.exec(text)) !== null) {
    snippets.push({
      type: 'latex-display',
      latex: match[1].trim(),
      raw: match[0]
    });
  }

  // Display math \[...\]
  const bracketDisplayRegex = /\\\[([\s\S]+?)\\\]/g;
  while ((match = bracketDisplayRegex.exec(text)) !== null) {
    snippets.push({
      type: 'latex-display',
      latex: match[1].trim(),
      raw: match[0]
    });
  }

  // Inline math \(...\)
  const parenInlineRegex = /\\\(([\s\S]+?)\\\)/g;
  while ((match = parenInlineRegex.exec(text)) !== null) {
    snippets.push({
      type: 'latex-inline',
      latex: match[1].trim(),
      raw: match[0]
    });
  }

  // Inline math $...$ (avoiding matching $$)
  // Look for $ not preceded or followed by another $
  const inlineRegex = /(^|[^\$])\$([^\$]+?)\$(?!\$)/g;
  while ((match = inlineRegex.exec(text)) !== null) {
    snippets.push({
      type: 'latex-inline',
      latex: match[2].trim(),
      raw: `$${match[2]}$`
    });
  }

  return snippets;
}

/**
 * Extracts math from KaTeX, MathJax, and MathML elements in or adjacent to container
 */
export function extractDOMMathSnippets(root: Node): MathSnippet[] {
  const snippets: MathSnippet[] = [];
  if (!(root instanceof Element || root instanceof Document || (root.parentElement instanceof Element))) {
    return snippets;
  }

  const container: Element = root instanceof Element ? root : (root.parentElement || document.body);

  // 1. KaTeX inspection: .katex annotation[encoding="application/x-tex"]
  const katexAnnotations = container.querySelectorAll('.katex annotation[encoding="application/x-tex"], .katex-mathml annotation[encoding="application/x-tex"]');
  katexAnnotations.forEach((annot) => {
    const tex = annot.textContent?.trim();
    if (tex) {
      snippets.push({
        type: 'katex-html',
        latex: tex,
        raw: annot.closest('.katex')?.outerHTML || tex
      });
    }
  });

  // 2. MathJax v3 inspection: mjx-container[jax="CHTML"] or with data-latex
  const mathjaxElements = container.querySelectorAll('mjx-container, .mjx-chtml');
  mathjaxElements.forEach((mjx) => {
    const dataLatex = mjx.getAttribute('data-latex') || mjx.getAttribute('alt');
    if (dataLatex) {
      snippets.push({
        type: 'mathjax',
        latex: dataLatex.trim(),
        raw: mjx.outerHTML
      });
    } else {
      const annot = mjx.querySelector('annotation');
      if (annot && annot.textContent) {
        snippets.push({
          type: 'mathjax',
          latex: annot.textContent.trim(),
          raw: mjx.outerHTML
        });
      }
    }
  });

  // 3. Native MathML: math > semantics > annotation[encoding*="tex"] or fallback to outerHTML
  const mathmlElements = container.querySelectorAll('math');
  mathmlElements.forEach((math) => {
    // If inside katex, already handled
    if (math.closest('.katex')) return;

    const annot = math.querySelector('semantics > annotation[encoding*="tex"]');
    if (annot && annot.textContent) {
      snippets.push({
        type: 'mathml',
        latex: annot.textContent.trim(),
        raw: math.outerHTML
      });
    } else {
      snippets.push({
        type: 'mathml',
        latex: math.textContent?.trim() || '',
        raw: math.outerHTML
      });
    }
  });

  return snippets;
}

/**
 * Traverses DOM tree upwards to find nearest preceding heading (h1-h4) and figure captions
 */
export function extractSurroundingDOMContext(startNode: Node | null): SurroundingDOMContext {
  let nearestHeading: string | null = null;
  let headingLevel: string | null = null;
  let caption: string | null = null;
  let paragraphSnippet = '';

  if (!startNode) {
    return { nearestHeading, headingLevel, caption, paragraphSnippet };
  }

  const element = startNode instanceof Element ? startNode : startNode.parentElement;
  if (!element) {
    return { nearestHeading, headingLevel, caption, paragraphSnippet };
  }

  // Find nearest paragraph snippet
  const p = element.closest('p, article, section, blockquote, div');
  if (p) {
    paragraphSnippet = p.textContent?.trim().replace(/\s+/g, ' ') || '';
  }

  // Find nearest figure caption
  const figure = element.closest('figure');
  if (figure) {
    const figcaption = figure.querySelector('figcaption');
    if (figcaption) {
      caption = figcaption.textContent?.trim().replace(/\s+/g, ' ') || null;
    }
  }

  // Traverse backwards or upwards to locate the nearest preceding heading (h1, h2, h3, h4)
  let curr: Element | null = element;
  while (curr && !nearestHeading) {
    // Check previous siblings
    let sib = curr.previousElementSibling;
    while (sib) {
      const match = sib.matches('h1, h2, h3, h4') ? sib : sib.querySelector('h1, h2, h3, h4');
      if (match) {
        nearestHeading = match.textContent?.trim().replace(/\s+/g, ' ') || null;
        headingLevel = match.tagName.toUpperCase();
        break;
      }
      sib = sib.previousElementSibling;
    }

    if (!nearestHeading) {
      curr = curr.parentElement;
      if (curr && curr.matches('h1, h2, h3, h4')) {
        nearestHeading = curr.textContent?.trim().replace(/\s+/g, ' ') || null;
        headingLevel = curr.tagName.toUpperCase();
        break;
      }
    }
  }

  return {
    nearestHeading,
    headingLevel,
    caption,
    paragraphSnippet
  };
}

/**
 * Enforces the 2,000 character budget invariant on selectedText and paragraphSnippet.
 * If exceeded, centers around the selection and wraps with `[...]`.
 */
export function sanitizeAndEnforceBudget(
  selectedText: string,
  paragraphSnippet: string,
  maxBudget: number = MAX_PAYLOAD_CHAR_BUDGET
): { selectedText: string; paragraphSnippet: string } {
  const cleanSelected = selectedText.trim().replace(/\r\n/g, '\n');
  let cleanParagraph = paragraphSnippet.trim().replace(/\r\n/g, '\n');

  if (cleanSelected.length >= maxBudget) {
    // Truncate selectedText to maxBudget centered or from start
    const truncated = cleanSelected.slice(0, maxBudget - 10) + ' [...]';
    return {
      selectedText: truncated,
      paragraphSnippet: ''
    };
  }

  const remainingBudget = maxBudget - cleanSelected.length;
  if (cleanParagraph.length > remainingBudget) {
    // If selectedText is inside cleanParagraph, center the window around selectedText
    const selIndex = cleanParagraph.indexOf(cleanSelected);
    if (selIndex !== -1 && remainingBudget > 40) {
      const halfContext = Math.floor((remainingBudget - cleanSelected.length - 20) / 2);
      const start = Math.max(0, selIndex - Math.max(0, halfContext));
      const end = Math.min(cleanParagraph.length, selIndex + cleanSelected.length + Math.max(0, halfContext));
      const prefix = start > 0 ? '[...] ' : '';
      const suffix = end < cleanParagraph.length ? ' [...]' : '';
      cleanParagraph = prefix + cleanParagraph.substring(start, end).trim() + suffix;
    } else {
      cleanParagraph = cleanParagraph.slice(0, Math.max(0, remainingBudget - 10)).trim() + ' [...]';
    }
  }

  return {
    selectedText: cleanSelected,
    paragraphSnippet: cleanParagraph
  };
}

/**
 * Primary Harvester function called by content script
 */
export function harvestFromCurrentDocument(
  sourceUrl: string = typeof window !== 'undefined' ? window.location.href : '',
  documentTitle: string = typeof document !== 'undefined' ? document.title : '',
  language: string = typeof document !== 'undefined' ? (document.documentElement.lang || navigator.language) : 'en'
): HarvestedContext {
  const selection = typeof window !== 'undefined' ? window.getSelection() : null;
  let rawSelectedText = selection ? selection.toString().trim() : '';
  let anchorNode: Node | null = selection ? selection.anchorNode : null;

  // Fallback if empty selection: check activeElement or focused element
  if (!rawSelectedText && typeof document !== 'undefined') {
    const active = document.activeElement;
    if (active && active !== document.body) {
      rawSelectedText = active.textContent?.trim() || '';
      anchorNode = active;
    }
  }

  // 1. Math extraction from raw text delimiters
  const mathFromText = extractRawLatexDelimiters(rawSelectedText);

  // 2. Math extraction from DOM elements
  const mathFromDOM: MathSnippet[] = [];
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    mathFromDOM.push(...extractDOMMathSnippets(container));
    // Also inspect enclosing section/div/figure block for adjacent formulas
    const elem = container instanceof Element ? container : container.parentElement;
    const parentBlock = elem?.closest('div, section, article, figure, main') || elem?.parentElement;
    if (parentBlock && parentBlock !== container) {
      mathFromDOM.push(...extractDOMMathSnippets(parentBlock));
    }
  } else if (anchorNode) {
    mathFromDOM.push(...extractDOMMathSnippets(anchorNode));
    const elem = anchorNode instanceof Element ? anchorNode : anchorNode.parentElement;
    const parentBlock = elem?.closest('div, section, article, figure, main') || elem?.parentElement;
    if (parentBlock && parentBlock !== anchorNode) {
      mathFromDOM.push(...extractDOMMathSnippets(parentBlock));
    }
  }

  // Deduplicate math snippets by normalized latex
  const seenLatex = new Set<string>();
  const mathSnippets: MathSnippet[] = [];
  for (const snippet of [...mathFromText, ...mathFromDOM]) {
    if (!seenLatex.has(snippet.latex)) {
      seenLatex.add(snippet.latex);
      mathSnippets.push(snippet);
    }
  }

  // 3. Surrounding DOM context
  const domContext = extractSurroundingDOMContext(anchorNode);

  // 4. Enforce 2,000 char budget limit
  const sanitized = sanitizeAndEnforceBudget(rawSelectedText, domContext.paragraphSnippet, MAX_PAYLOAD_CHAR_BUDGET);

  domContext.paragraphSnippet = sanitized.paragraphSnippet;

  const metadata: SelectionMetadata = {
    selectedText: sanitized.selectedText,
    characterCount: sanitized.selectedText.length,
    sourceUrl,
    documentTitle,
    language
  };

  return {
    harvestId: `harvest-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    timestamp: new Date().toISOString(),
    selection: metadata,
    mathSnippets,
    domContext
  };
}
