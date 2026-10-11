import React, { useEffect, useState } from 'react';
import { AlignLeft, Hash } from 'lucide-react';

export interface OutlineItem {
  id: string;
  text: string;
  level: number;
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return slug || 'heading';
}

export function extractHeadingsFromMarkdown(markdown: string): OutlineItem[] {
  if (!markdown) return [];
  const lines = markdown.split('\n');
  const headings: OutlineItem[] = [];
  const slugCounts: Record<string, number> = {};

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const rawText = match[2].trim().replace(/[*_`]/g, '');
      const baseSlug = slugify(rawText);
      const count = slugCounts[baseSlug] || 0;
      slugCounts[baseSlug] = count + 1;
      const id = count === 0 ? baseSlug : `${baseSlug}-${count}`;

      headings.push({ id, text: rawText, level });
    }
  }

  return headings;
}

interface DocumentOutlineProps {
  headings?: OutlineItem[];
  markdown?: string;
  className?: string;
  onSelectHeading?: (id: string) => void;
}

export const DocumentOutline: React.FC<DocumentOutlineProps> = ({
  headings: propHeadings,
  markdown,
  className = '',
  onSelectHeading,
}) => {
  const [headings, setHeadings] = useState<OutlineItem[]>([]);
  const [activeId, setActiveId] = useState<string>('');

  // Compute headings from props, markdown, or DOM
  useEffect(() => {
    if (propHeadings && propHeadings.length > 0) {
      setHeadings(propHeadings);
      return;
    }

    if (markdown) {
      const parsed = extractHeadingsFromMarkdown(markdown);
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
  }, [propHeadings, markdown]);

  const isClickScrolling = React.useRef(false);

  // Scroll-Spy: detect which heading is currently in viewport
  useEffect(() => {
    if (headings.length === 0) return;

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
  }, [headings]);

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
