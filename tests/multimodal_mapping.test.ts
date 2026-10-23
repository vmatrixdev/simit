import { describe, it, expect } from 'vitest';
import {
  parseDataUrl,
  toGeminiParts,
  toAnthropicContent,
  toOpenAIContent
} from '../src/providers/multimodal';
import { ImageAttachment } from '../src/types/models';

describe('Multimodal Image Wire Mapping (docs/specs/model_providers.md#33-multimodal-image-attachments)', () => {
  const samplePngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const samplePngDataUrl = `data:image/png;base64,${samplePngBase64}`;
  const sampleWebpDataUrl = `data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==`;
  const sampleSvgDataUrl = `data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E`;

  describe('parseDataUrl', () => {
    it('parses valid PNG and WebP data URIs cleanly into ImageAttachment', () => {
      const pngAttachment = parseDataUrl(samplePngDataUrl, 'Frame 1');
      expect(pngAttachment).not.toBeNull();
      expect(pngAttachment?.mimeType).toBe('image/png');
      expect(pngAttachment?.base64Data).toBe(samplePngBase64);
      expect(pngAttachment?.label).toBe('Frame 1');

      const webpAttachment = parseDataUrl(sampleWebpDataUrl);
      expect(webpAttachment).not.toBeNull();
      expect(webpAttachment?.mimeType).toBe('image/webp');
    });

    it('rejects SVG and malformed non-base64 URIs', () => {
      expect(parseDataUrl(sampleSvgDataUrl)).toBeNull();
      expect(parseDataUrl('data:text/plain;base64,SGVsbG8=')).toBeNull();
      expect(parseDataUrl('invalid-url')).toBeNull();
      expect(parseDataUrl('')).toBeNull();
    });
  });

  describe('toGeminiParts', () => {
    it('structures prompt text and inline_data parts with optional labels', () => {
      const images: ImageAttachment[] = [
        { mimeType: 'image/png', base64Data: samplePngBase64, label: 'Default state' }
      ];
      const parts = toGeminiParts('Review this simulation render', images);

      expect(parts.length).toBe(3);
      expect(parts[0]).toEqual({ text: 'Review this simulation render' });
      expect(parts[1]).toEqual({ text: 'Default state' });
      expect(parts[2]).toEqual({
        inline_data: {
          mime_type: 'image/png',
          data: samplePngBase64
        }
      });
    });

    it('returns only text part when images array is empty', () => {
      const parts = toGeminiParts('Text only query', []);
      expect(parts).toEqual([{ text: 'Text only query' }]);
    });
  });

  describe('toAnthropicContent', () => {
    it('places images before text blocks per Anthropic guidelines', () => {
      const images: ImageAttachment[] = [
        { mimeType: 'image/png', base64Data: samplePngBase64 }
      ];
      const content = toAnthropicContent('Review this render', images);

      expect(Array.isArray(content)).toBe(true);
      if (Array.isArray(content)) {
        expect(content[0]).toEqual({
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: samplePngBase64
          }
        });
        expect(content[1]).toEqual({ type: 'text', text: 'Review this render' });
      }
    });

    it('returns plain string when no images are provided', () => {
      const content = toAnthropicContent('Plain text prompt', []);
      expect(content).toBe('Plain text prompt');
    });
  });

  describe('toOpenAIContent', () => {
    it('structures text and image_url message contents', () => {
      const images: ImageAttachment[] = [
        { mimeType: 'image/png', base64Data: samplePngBase64 }
      ];
      const content = toOpenAIContent('Review render', images);

      expect(Array.isArray(content)).toBe(true);
      if (Array.isArray(content)) {
        expect(content[0]).toEqual({ type: 'text', text: 'Review render' });
        expect(content[1]).toEqual({
          type: 'image_url',
          image_url: {
            url: `data:image/png;base64,${samplePngBase64}`
          }
        });
      }
    });

    it('returns plain string when no images are provided', () => {
      const content = toOpenAIContent('Plain text', []);
      expect(content).toBe('Plain text');
    });
  });
});
