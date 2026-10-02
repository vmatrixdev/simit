/**
 * SimIt Context Harvester Domain Types
 * Defines the contract for content-script selection extraction,
 * DOM inspection, and mathematical formula harvesting.
 */

export interface MathSnippet {
  /** Type of mathematical notation detected */
  type: 'latex-inline' | 'latex-display' | 'mathml' | 'katex-html' | 'mathjax';
  /** Normalized LaTeX representation */
  latex: string;
  /** Raw text or HTML extracted from DOM */
  raw: string;
}

export interface SurroundingDOMContext {
  /** Nearest preceding heading (h1-h4) text */
  nearestHeading: string | null;
  /** Heading DOM tag (e.g., 'H1', 'H2', 'H3') */
  headingLevel: string | null;
  /** Associated figure caption if selection is adjacent to an illustration/canvas */
  caption: string | null;
  /** Surrounding paragraph text (preceding and succeeding lines for semantic framing) */
  paragraphSnippet: string;
}

export interface SelectionMetadata {
  /** Exact text highlighted by user */
  selectedText: string;
  /** Character length of selection */
  characterCount: number;
  /** URL of the active host tab */
  sourceUrl: string;
  /** Title of the active host tab document */
  documentTitle: string;
  /** Detected language of document (from <html lang> or navigator) */
  language?: string;
}

export interface HarvestedViewport {
  width: number;
  height: number;
}

export interface HarvestedContext {
  /** Unique correlation ID for this harvest event */
  harvestId: string;
  /** ISO timestamp when harvested */
  timestamp: string;
  /** Selection metadata and host document details */
  selection: SelectionMetadata;
  /** Mathematical formulas detected within or immediately adjacent to selection */
  mathSnippets: MathSnippet[];
  /** Surrounding document structure and hierarchical context */
  domContext: SurroundingDOMContext;
  /** Measured viewport bounds from host container */
  viewport?: HarvestedViewport;
  /** Upfront deduced archetype triage */
  archetypeTriage?: string;
}
