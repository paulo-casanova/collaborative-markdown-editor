import React, { useEffect, useState } from 'react';
import { AlignLeft, Hash } from 'lucide-react';
import {
  matchesHeadingTarget,
  stripHeadingNumberPrefix,
} from '../../utils/linkValidator';
import { useUIStore } from '../../stores/uiStore';

export interface OutlineItem {
  id: string;
  text: string;
  level: number;
  lineNumber?: number;
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return slug || 'heading';
}

export function extractHeadingsFromMarkdown(
  markdown: string,
  numberHeaders: boolean = false
): OutlineItem[] {
  if (!markdown) return [];
  const lines = markdown.split('\n');
  const headings: OutlineItem[] = [];
  const slugCounts: Record<string, number> = {};
  const counters = [0, 0, 0, 0, 0, 0];
  let inCodeFence = false;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (/^\s*```/.test(line)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const rawText = match[2].trim().replace(/[*_`]/g, '');
      const strippedText = stripHeadingNumberPrefix(rawText) || rawText;
      const baseSlug = slugify(strippedText);
      const count = slugCounts[baseSlug] || 0;
      slugCounts[baseSlug] = count + 1;
      const id = count === 0 ? baseSlug : `${baseSlug}-${count}`;

      counters[level - 1] += 1;
      for (let k = level; k < 6; k++) {
        counters[k] = 0;
      }
      let startIdx = 0;
      while (startIdx < level - 1 && counters[startIdx] === 0) {
        startIdx++;
      }
      const numParts: number[] = [];
      for (let k = startIdx; k < level; k++) {
        numParts.push(counters[k] || 1);
      }
      const numberPrefix =
        numParts.length === 1 ? `${numParts[0]}.` : `${numParts.join('.')}.`;

      const displayText = numberHeaders
        ? `${numberPrefix} ${strippedText}`
        : rawText;

      headings.push({
        id,
        text: displayText,
        level,
        lineNumber: idx + 1,
      });
    }
  }

  return headings;
}

export function findHeadingPosition(
  doc: { lines: number; line: (n: number) => { from: number; to: number; text: string } },
  targetHeading: string
): { from: number; to: number } | null {
  if (!doc || !targetHeading) return null;
  const rawTarget = targetHeading.replace(/^#+\s*/, '').trim();
  const cleanTarget = rawTarget.replace(/[*_`]/g, '').trim().toLowerCase();
  const targetSlug = slugify(cleanTarget);
  const slugCounts: Record<string, number> = {};

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const match = line.text.match(/^(#{1,6})\s+(.*)$/);
    if (match) {
      const rawText = match[2].trim();
      const strippedText = stripHeadingNumberPrefix(rawText.replace(/[*_`]/g, '').trim()).toLowerCase();
      const baseSlug = slugify(strippedText || rawText);
      const count = slugCounts[baseSlug] || 0;
      slugCounts[baseSlug] = count + 1;
      const fullSlug = count === 0 ? baseSlug : `${baseSlug}-${count}`;

      if (
        matchesHeadingTarget(rawText, rawTarget) ||
        strippedText === cleanTarget ||
        rawText.toLowerCase() === cleanTarget ||
        baseSlug === targetSlug ||
        fullSlug === targetSlug ||
        fullSlug === cleanTarget ||
        baseSlug === cleanTarget
      ) {
        return { from: line.from, to: line.to };
      }
    }
  }
  return null;
}

interface DocumentOutlineProps {
  headings?: OutlineItem[];
  markdown?: string;
  className?: string;
  onSelectHeading?: (id: string) => void;
  activeHeadingId?: string;
  cursorLine?: number;
}

export const DocumentOutline: React.FC<DocumentOutlineProps> = ({
  headings: propHeadings,
  markdown,
  className = '',
  onSelectHeading,
  activeHeadingId,
  cursorLine,
}) => {
  const { numberHeaders } = useUIStore();
  const [headings, setHeadings] = useState<OutlineItem[]>([]);
  const [activeId, setActiveId] = useState<string>('');

  // Compute headings from props, markdown, or DOM
  useEffect(() => {
    if (propHeadings !== undefined) {
      setHeadings(propHeadings);
      return;
    }

    if (markdown !== undefined) {
      const parsed = extractHeadingsFromMarkdown(markdown, numberHeaders);
      setHeadings(parsed);
      return;
    }

    // Fallback: scan DOM for heading elements
    const elements = Array.from(document.querySelectorAll('article h1, article h2, article h3, article h4, article h5, article h6, .cme-content h1, .cme-content h2, .cme-content h3, .cme-content h4, .cme-content h5, .cme-content h6'));
    if (elements.length > 0) {
      const domHeadings: OutlineItem[] = elements.map((el, idx) => {
        const level = parseInt(el.tagName.replace('H', ''), 10) || 1;
        const text = el.textContent || `Section ${idx + 1}`;
        if (!el.id) {
          el.id = slugify(text);
        }
        return {
          id: el.id,
          text,
          level,
        };
      });
      setHeadings(domHeadings);
    }
  }, [propHeadings, markdown, numberHeaders]);

  const isClickScrolling = React.useRef(false);

  // Update activeId when explicit activeHeadingId or cursorLine changes in Editor mode
  useEffect(() => {
    if (activeHeadingId) {
      setActiveId(activeHeadingId);
      return;
    }
    if (cursorLine !== undefined && headings.length > 0) {
      let current = headings[0].id;
      for (const item of headings) {
        if (item.lineNumber !== undefined && item.lineNumber <= cursorLine) {
          current = item.id;
        } else if (item.lineNumber !== undefined && item.lineNumber > cursorLine) {
          break;
        }
      }
      setActiveId(current);
    }
  }, [activeHeadingId, cursorLine, headings]);

  // Scroll-Spy: detect which heading is currently in viewport (when not driven by editor cursorLine)
  useEffect(() => {
    if (headings.length === 0 || cursorLine !== undefined) return;

    const handleScroll = () => {
      if (isClickScrolling.current) return;

      let current = headings[0].id;
      for (const item of headings) {
        const el = document.getElementById(item.id);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= 160) {
            current = item.id;
          } else {
            break;
          }
        }
      }

      setActiveId(current);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    // Also listen to main content container if scrollable
    const mainEl = document.querySelector('main');
    if (mainEl) {
      mainEl.addEventListener('scroll', handleScroll, { passive: true });
    }

    handleScroll();

    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (mainEl) {
        mainEl.removeEventListener('scroll', handleScroll);
      }
    };
  }, [headings, cursorLine]);

  const handleHeadingClick = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setActiveId(id);
    isClickScrolling.current = true;
    setTimeout(() => {
      isClickScrolling.current = false;
    }, 800);

    const targetEl = document.getElementById(id);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (onSelectHeading) {
      onSelectHeading(id);
    }
  };

  if (headings.length === 0) {
    return (
      <div
        className={`p-4 text-xs text-cme-text-muted ${className}`}
        data-testid="table-of-contents"
      >
        <div className="flex items-center gap-1.5 font-semibold text-cme-text-base mb-2">
          <AlignLeft className="w-3.5 h-3.5 text-cme-primary" />
          <span>Table of Contents</span>
        </div>
        <p className="italic text-[11px]">No headings in this document.</p>
      </div>
    );
  }

  return (
    <nav
      className={`space-y-3 p-4 select-none ${className}`}
      aria-label="Table of Contents"
      data-testid="table-of-contents"
    >
      <div className="flex items-center justify-between pb-2 border-b border-cme-border-base">
        <div className="flex items-center gap-1.5 font-semibold text-xs text-cme-text-base">
          <AlignLeft className="w-3.5 h-3.5 text-cme-primary" />
          <span>Table of Contents</span>
        </div>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cme-bg-subtle text-cme-text-muted">
          {headings.length}
        </span>
      </div>

      <div className="space-y-1 max-h-[calc(100vh-14rem)] overflow-y-auto no-scrollbar">
        {headings.map((item) => {
          const isActive = activeId === item.id;
          const indentClass =
            item.level === 1
              ? 'pl-1 font-semibold text-xs'
              : item.level === 2
              ? 'pl-4 font-medium text-xs'
              : item.level === 3
              ? 'pl-7 text-xs text-cme-text-muted'
              : item.level === 4
              ? 'pl-10 text-xs text-cme-text-muted'
              : 'pl-12 text-xs text-cme-text-muted';

          return (
            <a
              key={item.id}
              href={`#${item.id}`}
              onClick={(e) => handleHeadingClick(e, item.id)}
              className={`group flex items-center gap-1.5 py-1 px-2 rounded-lg text-left transition-colors cursor-pointer truncate ${indentClass} ${
                isActive
                  ? 'text-cme-primary font-semibold border-l-2 border-cme-primary bg-cme-primary/10'
                  : 'text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover'
              }`}
              data-testid={`toc-item-${item.id}`}
              data-active={isActive ? 'true' : 'false'}
              title={item.text}
            >
              <Hash className={`w-3 h-3 flex-shrink-0 opacity-40 group-hover:opacity-100 ${isActive ? 'text-cme-primary opacity-100' : ''}`} />
              <span className="truncate">{item.text}</span>
            </a>
          );
        })}
      </div>
    </nav>
  );
};
