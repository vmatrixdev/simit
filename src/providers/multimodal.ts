/**
 * SimIt Multimodal Payload Mapping
 * Conforms to docs/specs/model_providers.md#33-multimodal-image-attachments
 *
 * Pure, network-free mappers from the provider-agnostic ImageAttachment contract
 * to each vendor's wire format. Providers MUST use these helpers so mapping is
 * unit-testable without fetch.
 */

import { IModelProvider, ImageAttachment } from '../types/models';

/**
 * Returns true if the given model provider supports multimodal image attachments.
 */
export function isVisionCapableProvider(
  provider?: Pick<IModelProvider, 'supportsVision'> | null
): boolean {
  return Boolean(provider && typeof provider.supportsVision === 'function' && provider.supportsVision());
}

/**
 * Parses a `data:` URL into an ImageAttachment.
 * - Accepts image/png, image/jpeg, image/webp with `;base64,` encoding.
 * - Returns null for SVG (`image/svg+xml`), non-base64, non-image, empty, or malformed input.
 */
export function parseDataUrl(dataUrl: string, label?: string): ImageAttachment | null {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;

  return {
    mimeType: match[1] as 'image/png' | 'image/jpeg' | 'image/webp',
    base64Data: match[3],
    label: label?.trim() ? label.trim() : undefined
  };
}

/**
 * Gemini `contents[0].parts`:
 *   [ { text: userPrompt }, ...images.flatMap(img => [ { text: img.label }?, { inline_data: { mime_type, data } } ]) ]
 * Text first, then each image preceded by its label text part when a label exists.
 */
export function toGeminiParts(userPrompt: string, images: ImageAttachment[] = []): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [{ text: userPrompt }];

  if (images && images.length > 0) {
    for (const img of images) {
      if (img.label) {
        parts.push({ text: img.label });
      }
      parts.push({
        inline_data: {
          mime_type: img.mimeType,
          data: img.base64Data
        }
      });
    }
  }

  return parts;
}

/**
 * Anthropic `messages[0].content` (images BEFORE text, per Anthropic guidance):
 *   [ ...images.flatMap(img => [ { type: 'text', text: img.label }?, { type: 'image', source: { type: 'base64', media_type, data } } ]),
 *     { type: 'text', text: userPrompt } ]
 * When images is empty, returns the plain userPrompt string (preserves current wire format).
 */
export function toAnthropicContent(
  userPrompt: string,
  images: ImageAttachment[] = []
): string | Array<Record<string, unknown>> {
  if (!images || images.length === 0) {
    return userPrompt;
  }

  const content: Array<Record<string, unknown>> = [];
  for (const img of images) {
    if (img.label) {
      content.push({ type: 'text', text: img.label });
    }
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mimeType,
        data: img.base64Data
      }
    });
  }

  content.push({ type: 'text', text: userPrompt });
  return content;
}

/**
 * OpenAI-compatible `messages[1].content`:
 *   [ { type: 'text', text: userPrompt }, ...images.map(img => ({ type: 'image_url', image_url: { url: `data:${mime};base64,${data}` } })) ]
 * When images is empty, returns the plain userPrompt string.
 */
export function toOpenAIContent(
  userPrompt: string,
  images: ImageAttachment[] = []
): string | Array<Record<string, unknown>> {
  if (!images || images.length === 0) {
    return userPrompt;
  }

  const content: Array<Record<string, unknown>> = [{ type: 'text', text: userPrompt }];
  for (const img of images) {
    content.push({
      type: 'image_url',
      image_url: {
        url: `data:${img.mimeType};base64,${img.base64Data}`
      }
    });
  }

  return content;
}
