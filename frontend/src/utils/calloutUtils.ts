import { Info, Lightbulb, AlertCircle, TriangleAlert, ShieldAlert, type LucideIcon } from 'lucide-react';

export type CalloutType = 'note' | 'tip' | 'important' | 'warning' | 'caution';

export interface CalloutMeta {
  type: CalloutType;
  rawType: string;
  title: string;
  isFoldable?: boolean;
  defaultFolded?: boolean;
}

export const CALLOUT_HEADER_REGEX = /^\[!([a-zA-Z0-9_-]+)\]([+-]?)(?:\s+(.*))?$/;

/**
 * Normalizes any callout/alert identifier (including GitHub Flavored Markdown and Obsidian aliases)
 * to one of the 5 canonical alert themes.
 */
export function normalizeCalloutType(raw: string): CalloutType {
  const norm = raw.trim().toLowerCase();
  switch (norm) {
    case 'tip':
    case 'hint':
    case 'check':
    case 'done':
    case 'success':
      return 'tip';
    case 'important':
    case 'attention':
      return 'important';
    case 'warning':
    case 'warn':
    case 'faq':
    case 'question':
      return 'warning';
    case 'caution':
    case 'danger':
    case 'error':
    case 'failure':
    case 'fail':
    case 'bug':
    case 'missing':
      return 'caution';
    case 'note':
    case 'info':
    case 'seealso':
    case 'todo':
    default:
      return 'note';
  }
}

/**
 * Returns the default human-readable title for a callout type.
 */
export function getCalloutDefaultTitle(type: CalloutType, rawType?: string): string {
  if (rawType) {
    const norm = rawType.trim().toLowerCase();
    if (['note', 'tip', 'important', 'warning', 'caution'].includes(norm)) {
      return norm.charAt(0).toUpperCase() + norm.slice(1);
    }
    // Capitalize custom or alias labels (e.g. Info, Danger, Hint)
    return norm.charAt(0).toUpperCase() + norm.slice(1);
  }
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/**
 * Parses a blockquote's first line to determine if it defines a GFM Alert or Obsidian Callout.
 * E.g. `[!NOTE]`, `[!TIP] Custom Title`, `[!warning]+`, `[!caution]`
 */
export function parseCalloutHeader(firstQuoteLine: string): CalloutMeta | null {
  const trimmed = firstQuoteLine.trim();
  const match = CALLOUT_HEADER_REGEX.exec(trimmed);
  if (!match) return null;

  const rawType = match[1];
  const type = normalizeCalloutType(rawType);
  const foldMarker = match[2];
  const customTitle = match[3]?.trim();
  const title = customTitle && customTitle.length > 0 ? customTitle : getCalloutDefaultTitle(type, rawType);

  return {
    type,
    rawType,
    title,
    isFoldable: foldMarker === '+' || foldMarker === '-',
    defaultFolded: foldMarker === '-',
  };
}

/**
 * Returns raw SVG icon markup for semantic HTML rendering without React runtime dependencies.
 */
export function getCalloutSvgIcon(type: CalloutType): string {
  switch (type) {
    case 'tip':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="cme-callout-icon-svg"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>`;
    case 'important':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="cme-callout-icon-svg"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`;
    case 'warning':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="cme-callout-icon-svg"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>`;
    case 'caution':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="cme-callout-icon-svg"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`;
    case 'note':
    default:
      return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="cme-callout-icon-svg"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`;
  }
}

/**
 * Returns the matching Lucide React icon component for React rendering.
 */
export function getCalloutReactIcon(type: CalloutType): LucideIcon {
  switch (type) {
    case 'tip':
      return Lightbulb;
    case 'important':
      return AlertCircle;
    case 'warning':
      return TriangleAlert;
    case 'caution':
      return ShieldAlert;
    case 'note':
    default:
      return Info;
  }
}
