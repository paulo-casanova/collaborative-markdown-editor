/**
 * Utilities for parsing image dimensions and alt text for Markdown and Obsidian embeds.
 * Supports:
 * - Native size by default (no constraints)
 * - Explicit width in pixels: "300", "300px", "alt|300", "alt|300px"
 * - Width and height: "300x200", "300px x 200px", "alt|300x200"
 * - Explicit height only: "x200", "alt|x200"
 * - Percentage width: "50%", "alt|50%"
 * - Obsidian embed multi-pipe ordering: "target|Diagram|500" or "target|500|Diagram"
 * - Target URL size extension: "img.png =300x200" or "img.png =50%"
 */

import React from 'react';

export interface ParsedImageInfo {
  altText: string;
  width?: string;
  height?: string;
}

export interface ImageElementStyles {
  linkStyle: React.CSSProperties;
  imgStyle: React.CSSProperties;
}

/**
 * Parses a dimension string into width and height CSS values.
 * Returns null if the string is not a valid dimension specification.
 */
export function parseDimensionString(str: string): { width?: string; height?: string } | null {
  const trimmed = str.trim();
  if (!trimmed) return null;

  // 1. Width x Height (e.g. "300x200", "300px x 200px", "50%x50%", "300x200px")
  const wxhMatch = trimmed.match(/^(\d+(?:\.\d+)?(?:px|%)?)\s*[xX]\s*(\d+(?:\.\d+)?(?:px|%)?)$/);
  if (wxhMatch) {
    let w = wxhMatch[1];
    let h = wxhMatch[2];
    if (/^\d+(?:\.\d+)?$/.test(w)) w += 'px';
    if (/^\d+(?:\.\d+)?$/.test(h)) h += 'px';
    return { width: w, height: h };
  }

  // 2. Height only (e.g. "x200", "x200px", "X300")
  const hOnlyMatch = trimmed.match(/^[xX]\s*(\d+(?:\.\d+)?)(px|%)?$/);
  if (hOnlyMatch) {
    const unit = hOnlyMatch[2] || 'px';
    return { height: `${hOnlyMatch[1]}${unit}` };
  }

  // 3. Width only (e.g. "300", "300px", "50%", "75.5%")
  const wOnlyMatch = trimmed.match(/^(\d+(?:\.\d+)?)(px|%)?$/);
  if (wOnlyMatch) {
    const unit = wOnlyMatch[2] || 'px';
    return { width: `${wOnlyMatch[1]}${unit}` };
  }

  return null;
}

/**
 * Extracts dimensions and alt text from the raw alt attribute and/or target URL.
 */
export function parseImageDimensionAndAlt(rawAlt?: string, rawSrc?: string): ParsedImageInfo {
  let altText = '';
  let width: string | undefined;
  let height: string | undefined;

  // 1. Check rawSrc for optional =WxH or =W (e.g., "img.png =300x200")
  if (rawSrc) {
    const srcParts = rawSrc.trim().split(/\s+/);
    for (let i = 1; i < srcParts.length; i++) {
      const part = srcParts[i];
      if (part.startsWith('=')) {
        const dim = parseDimensionString(part.slice(1));
        if (dim) {
          if (dim.width) width = dim.width;
          if (dim.height) height = dim.height;
        }
      }
    }
  }

  // 2. Parse rawAlt
  const trimmedAlt = (rawAlt || '').trim();
  if (trimmedAlt) {
    if (trimmedAlt.includes('|')) {
      const parts = trimmedAlt.split('|').map((p) => p.trim());
      const nonDimParts: string[] = [];

      for (const part of parts) {
        if (!part) continue;
        const dim = parseDimensionString(part);
        if (dim) {
          if (dim.width) width = dim.width;
          if (dim.height) height = dim.height;
        } else {
          nonDimParts.push(part);
        }
      }

      altText = nonDimParts.join(' | ');
    } else {
      const dim = parseDimensionString(trimmedAlt);
      if (dim) {
        if (dim.width) width = dim.width;
        if (dim.height) height = dim.height;
        altText = '';
      } else {
        altText = trimmedAlt;
      }
    }
  }

  return { altText, width, height };
}

/**
 * Computes React inline styles for the enclosing link and image element.
 * By default (no width/height), images display at their native size bounded by container max-width.
 */
export function getImageStyles(parsed: ParsedImageInfo): ImageElementStyles {
  const linkStyle: React.CSSProperties = {
    maxWidth: '100%',
  };
  const imgStyle: React.CSSProperties = {
    maxWidth: '100%',
    height: parsed.height || 'auto',
  };

  if (parsed.width) {
    if (parsed.width.endsWith('%')) {
      linkStyle.width = parsed.width;
      imgStyle.width = '100%';
    } else {
      imgStyle.width = parsed.width;
    }
  }

  if (parsed.height) {
    imgStyle.objectFit = 'contain';
  }

  return { linkStyle, imgStyle };
}
