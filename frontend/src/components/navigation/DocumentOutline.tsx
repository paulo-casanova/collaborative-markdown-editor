import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  AlignLeft,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Heading,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
} from 'lucide-react';
import {
  matchesHeadingTarget,
  stripHeadingNumberPrefix,
  slugifyHeading,
} from '../../utils/linkValidator';
import { useUIStore } from '../../stores/uiStore';

export interface OutlineItem {
  id: string;
  text: string;
  rawText?: string;
  level: number;
  lineNumber?: number;
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[*_`~[\]]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
  let inMathBlock = false;

  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = lines[idx].replace(/\r$/, '');
    if (/^\s*```/.test(rawLine)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    if (/^\s*\$\$/.test(rawLine)) {
      inMathBlock = !inMathBlock;
      continue;
    }
    if (inMathBlock) continue;

    const match = rawLine.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const fullHeading = match[2]
        .replace(/\s+#+\s*$/, '')
        .replace(/\{#[^}]+\}\s*$/, '')
        .replace(/<[^>]+>/g, '')
        .trim();
      const rawText = fullHeading.replace(/[*_`~[\]]/g, '');
      const strippedText = stripHeadingNumberPrefix(rawText) || rawText;
      const strippedFullHeading = stripHeadingNumberPrefix(fullHeading) || fullHeading;
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
      const formattedText = numberHeaders
        ? `${numberPrefix} ${strippedFullHeading}`
        : fullHeading;

      headings.push({
        id,
        text: displayText,
        rawText: fullHeading !== rawText ? formattedText : undefined,
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
  let decoded = targetHeading;
  try {
    decoded = decodeURIComponent(targetHeading);
  } catch {
    // ignore
  }
  const rawTarget = decoded.replace(/^#+\s*/, '').trim();
  const cleanTarget = rawTarget.replace(/[*_`~[\]]/g, '').trim().toLowerCase();
  const targetSlug = slugify(cleanTarget);
  const targetStrippedSlug = slugify(stripHeadingNumberPrefix(cleanTarget) || cleanTarget);
  const slugCounts: Record<string, number> = {};
  let inCodeFence = false;

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const lineText = line.text.replace(/\r$/, '');
    if (/^\s*```/.test(lineText)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    const match = lineText.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (match) {
      const fullHeading = match[2]
        .replace(/\s+#+\s*$/, '')
        .replace(/\{#[^}]+\}\s*$/, '')
        .replace(/<[^>]+>/g, '')
        .trim();
      const rawText = fullHeading;
      const strippedText = stripHeadingNumberPrefix(rawText.replace(/[*_`~[\]]/g, '').trim()).toLowerCase();
      const baseSlug = slugify(strippedText || rawText);
      const rawSlug = slugify(rawText);
      const count = slugCounts[baseSlug] || 0;
      slugCounts[baseSlug] = count + 1;
      const fullSlug = count === 0 ? baseSlug : `${baseSlug}-${count}`;

      if (
        matchesHeadingTarget(rawText, rawTarget) ||
        matchesHeadingTarget(rawText, targetHeading) ||
        strippedText === cleanTarget ||
        rawText.toLowerCase() === cleanTarget ||
        baseSlug === targetSlug ||
        baseSlug === targetStrippedSlug ||
        rawSlug === targetSlug ||
        rawSlug === targetStrippedSlug ||
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

export function findHeadingElement(targetHeading: string): HTMLElement | null {
  if (typeof window === 'undefined' || !targetHeading) return null;
  let decoded = targetHeading;
  try {
    decoded = decodeURIComponent(targetHeading);
  } catch {
    // ignore
  }
  const clean = decoded.replace(/^#+/, '').trim();
  if (!clean) return null;

  const cleanLower = clean.toLowerCase();
  const slug = slugify(clean);
  const strippedSlug = slugify(stripHeadingNumberPrefix(clean) || clean);

  // 1. Direct ID lookups
  const directCandidates = [
    clean,
    cleanLower,
    slug,
    strippedSlug,
    targetHeading.replace(/^#+/, ''),
    slugifyHeading(clean, false),
    slugifyHeading(clean, true),
  ];
  for (const c of directCandidates) {
    if (!c) continue;
    const el = window.document.getElementById(c);
    if (el) return el;
  }

  // 2. Query all heading elements inside article / editor
  const headingElements = Array.from(
    window.document.querySelectorAll(
      'article h1, article h2, article h3, article h4, article h5, article h6, [data-testid="reader-article"] h1, [data-testid="reader-article"] h2, [data-testid="reader-article"] h3, [data-testid="reader-article"] h4, [data-testid="reader-article"] h5, [data-testid="reader-article"] h6, .cm-line[data-heading-level]'
    )
  ) as HTMLElement[];

  for (const el of headingElements) {
    const text = (el.textContent || '').trim();
    if (
      matchesHeadingTarget(text, clean) ||
      matchesHeadingTarget(text, targetHeading) ||
      slugify(text) === slug ||
      slugify(text) === strippedSlug ||
      el.id === slug ||
      el.id === strippedSlug
    ) {
      return el;
    }
  }

  return null;
}

export function renderOutlineFormatted(text: string): React.ReactNode {
  if (!text) return null;

  const parts = text.split(
    /(`[^`]+`|~~[^~\n]+~~|\*\*\*+[^*\n]+\*\*\*+|___+[^_\n]+___+|\*\*[^*\n]+\*\*|(?<![a-zA-Z0-9_])__(?:[^\s_\n]|[^\s_\n][^_\n]*?[^\s_\n])__(?![a-zA-Z0-9_])|\*[^*\n]+\*|(?<![a-zA-Z0-9_])_(?:[^\s_\n]|[^\s_\n][^_\n]*?[^\s_\n])_(?![a-zA-Z0-9_]))/g
  );

  return parts.map((part, idx) => {
    // 1. Inline Code: `...`
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
      return (
        <code
          key={idx}
          className="font-mono text-[0.88em] px-1 py-0.5 rounded bg-cme-bg-subtle text-pink-600 dark:text-pink-400 border border-cme-border-base/50"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    // 2. Bold Italic: ***...*** or ___...___
    if (
      (part.startsWith('***') && part.endsWith('***') && part.length > 6) ||
      (part.startsWith('___') && part.endsWith('___') && part.length > 6)
    ) {
      return (
        <strong key={idx} className="font-bold text-cme-text-base">
          <em className="italic">{renderOutlineFormatted(part.slice(3, -3))}</em>
        </strong>
      );
    }
    // 3. Bold: **...** or __...__
    if (
      (part.startsWith('**') && part.endsWith('**') && part.length > 4) ||
      (part.startsWith('__') && part.endsWith('__') && part.length > 4)
    ) {
      return (
        <strong key={idx} className="font-bold text-cme-text-base">
          {renderOutlineFormatted(part.slice(2, -2))}
        </strong>
      );
    }
    // 4. Italic: *...* or _..._
    if (
      (part.startsWith('*') && part.endsWith('*') && part.length > 2) ||
      (part.startsWith('_') && part.endsWith('_') && part.length > 2)
    ) {
      return (
        <em key={idx} className="italic">
          {renderOutlineFormatted(part.slice(1, -1))}
        </em>
      );
    }
    // 5. Strikethrough: ~~...~~
    if (part.startsWith('~~') && part.endsWith('~~') && part.length > 4) {
      return (
        <del key={idx} className="line-through opacity-70">
          {renderOutlineFormatted(part.slice(2, -2))}
        </del>
      );
    }
    return part;
  });
}

export interface OutlineTreeNode extends OutlineItem {
  children: OutlineTreeNode[];
  parentId?: string;
}

export function buildOutlineTree(items: OutlineItem[]): OutlineTreeNode[] {
  const root: OutlineTreeNode[] = [];
  const stack: { node: OutlineTreeNode; level: number }[] = [];

  for (const item of items) {
    const treeNode: OutlineTreeNode = {
      ...item,
      children: [],
    };

    while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(treeNode);
    } else {
      treeNode.parentId = stack[stack.length - 1].node.id;
      stack[stack.length - 1].node.children.push(treeNode);
    }

    stack.push({ node: treeNode, level: item.level });
  }

  return root;
}

export function countDescendants(node: OutlineTreeNode): number {
  let count = 0;
  for (const child of node.children) {
    count += 1 + countDescendants(child);
  }
  return count;
}

export function getAllParentIds(nodes: OutlineTreeNode[]): string[] {
  const ids: string[] = [];
  function traverse(list: OutlineTreeNode[]) {
    for (const node of list) {
      if (node.children.length > 0) {
        ids.push(node.id);
        traverse(node.children);
      }
    }
  }
  traverse(nodes);
  return ids;
}

export function getAncestorIds(nodeId: string, tree: OutlineTreeNode[]): string[] {
  const ancestors: string[] = [];
  function find(list: OutlineTreeNode[], currentPath: string[]): boolean {
    for (const n of list) {
      if (n.id === nodeId) {
        ancestors.push(...currentPath);
        return true;
      }
      if (n.children.length > 0) {
        if (find(n.children, [...currentPath, n.id])) {
          return true;
        }
      }
    }
    return false;
  }
  find(tree, []);
  return ancestors;
}

export function getHeadingIcon(level: number, isActive: boolean = false): React.ReactElement {
  const baseClasses = `w-3.5 h-3.5 flex-shrink-0 transition-opacity ${
    isActive ? 'opacity-100 text-cme-primary' : 'opacity-70 group-hover:opacity-100'
  }`;

  switch (level) {
    case 1:
      return <Heading1 className={`${baseClasses} ${!isActive ? 'text-indigo-500 dark:text-indigo-400' : ''}`} />;
    case 2:
      return <Heading2 className={`${baseClasses} ${!isActive ? 'text-blue-500 dark:text-blue-400' : ''}`} />;
    case 3:
      return <Heading3 className={`${baseClasses} ${!isActive ? 'text-teal-600 dark:text-teal-400' : ''}`} />;
    case 4:
      return <Heading4 className={`${baseClasses} ${!isActive ? 'text-emerald-600 dark:text-emerald-400' : ''}`} />;
    case 5:
      return <Heading5 className={`${baseClasses} ${!isActive ? 'text-amber-600 dark:text-amber-400' : ''}`} />;
    case 6:
      return <Heading6 className={`${baseClasses} ${!isActive ? 'text-rose-500 dark:text-rose-400' : ''}`} />;
    default:
      return <Heading className={`${baseClasses} ${!isActive ? 'text-cme-text-muted' : ''}`} />;
  }
}

export function getHeadingFontClass(level: number): string {
  switch (level) {
    case 1:
      return 'font-semibold text-xs';
    case 2:
      return 'font-medium text-xs';
    case 3:
      return 'text-xs';
    default:
      return 'text-xs text-cme-text-muted';
  }
}

export interface DocumentOutlineProps {
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
  const [activeId, setActiveId] = useState<string>('');
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());

  // Synchronously compute headings if provided via props or markdown
  const computedHeadings = useMemo(() => {
    if (propHeadings !== undefined) {
      return propHeadings;
    }
    if (markdown !== undefined) {
      return extractHeadingsFromMarkdown(markdown, numberHeaders);
    }
    return [];
  }, [propHeadings, markdown, numberHeaders]);

  const [domHeadings, setDomHeadings] = useState<OutlineItem[]>([]);

  // Fallback: scan DOM for heading elements only if neither propHeadings nor markdown was provided
  useEffect(() => {
    if (propHeadings !== undefined || markdown !== undefined) return;

    const elements = Array.from(
      document.querySelectorAll(
        'article h1, article h2, article h3, article h4, article h5, article h6, .cme-content h1, .cme-content h2, .cme-content h3, .cme-content h4, .cme-content h5, .cme-content h6'
      )
    );
    if (elements.length > 0) {
      const scanned: OutlineItem[] = elements.map((el, idx) => {
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
      setDomHeadings(scanned);
    }
  }, [propHeadings, markdown]);

  const headings =
    propHeadings !== undefined || markdown !== undefined ? computedHeadings : domHeadings;

  const tree = useMemo(() => buildOutlineTree(headings), [headings]);

  // Reset collapse state when switching to a different document
  const prevHeadingSignature = useRef<string>('');
  useEffect(() => {
    if (headings.length === 0) return;
    const currentSignature = headings.map((h) => h.id).slice(0, 3).join('|');
    if (prevHeadingSignature.current && prevHeadingSignature.current !== currentSignature) {
      const hasOverlap = headings.some((h) => prevHeadingSignature.current.includes(h.id));
      if (!hasOverlap) {
        setCollapsedIds(new Set());
      }
    }
    prevHeadingSignature.current = currentSignature;
  }, [headings]);

  const isClickScrolling = useRef(false);

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
        const el = findHeadingElement(item.id);
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

    window.addEventListener('scroll', handleScroll, { passive: true, capture: true });
    const mainEl = document.querySelector('main');
    if (mainEl) {
      mainEl.addEventListener('scroll', handleScroll, { passive: true });
    }

    handleScroll();

    return () => {
      window.removeEventListener('scroll', handleScroll, { capture: true });
      if (mainEl) {
        mainEl.removeEventListener('scroll', handleScroll);
      }
    };
  }, [headings, cursorLine]);

  // Auto-expand ancestors of active item so it is visible in the tree
  useEffect(() => {
    if (activeId && collapsedIds.size > 0) {
      const ancestors = getAncestorIds(activeId, tree);
      if (ancestors.length > 0) {
        let hasCollapsedAncestor = false;
        for (const ancId of ancestors) {
          if (collapsedIds.has(ancId)) {
            hasCollapsedAncestor = true;
            break;
          }
        }
        if (hasCollapsedAncestor) {
          setCollapsedIds((prev) => {
            const next = new Set(prev);
            for (const ancId of ancestors) {
              next.delete(ancId);
            }
            return next;
          });
        }
      }
    }
  }, [activeId, tree, collapsedIds]);

  const handleHeadingClick = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setActiveId(id);
    try {
      window.history.pushState(null, '', '#' + encodeURIComponent(id));
    } catch {
      // ignore
    }
    isClickScrolling.current = true;
    setTimeout(() => {
      isClickScrolling.current = false;
    }, 800);

    if (onSelectHeading) {
      onSelectHeading(id);
    } else {
      const targetEl = findHeadingElement(id);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  const toggleCollapse = (id: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const allParentIds = useMemo(() => getAllParentIds(tree), [tree]);
  const hasCollapsibleNodes = allParentIds.length > 0;
  const isAllCollapsed = hasCollapsibleNodes && allParentIds.every((id) => collapsedIds.has(id));

  const toggleAll = () => {
    if (isAllCollapsed) {
      setCollapsedIds(new Set());
    } else {
      setCollapsedIds(new Set(allParentIds));
    }
  };

  const renderTreeNode = (node: OutlineTreeNode, depth: number) => {
    const isCollapsed = collapsedIds.has(node.id);
    const hasChildren = node.children.length > 0;
    const isActive = activeId === node.id;
    const fontClass = getHeadingFontClass(node.level);
    const descendantCount = isCollapsed ? countDescendants(node) : 0;

    return (
      <React.Fragment key={node.id}>
        <div
          className={`group flex items-center gap-1 py-0.5 pr-1.5 rounded-lg text-left transition-colors ${
            isActive
              ? 'text-cme-primary font-semibold border-l-2 border-cme-primary bg-cme-primary/10'
              : 'hover:bg-cme-bg-hover text-cme-text-muted hover:text-cme-text-base'
          }`}
          style={{ paddingLeft: `${depth * 14 + 4}px` }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => toggleCollapse(node.id, e)}
              className="p-0.5 -ml-0.5 rounded hover:bg-cme-bg-hover text-cme-text-muted hover:text-cme-text-base transition-colors flex-shrink-0"
              title={isCollapsed ? `Expand section "${node.text}"` : `Collapse section "${node.text}"`}
              data-testid={isCollapsed ? `toc-expand-${node.id}` : `toc-collapse-${node.id}`}
              aria-label={isCollapsed ? `Expand section ${node.text}` : `Collapse section ${node.text}`}
            >
              {isCollapsed ? (
                <ChevronRight className="w-3.5 h-3.5 text-cme-text-muted" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-cme-text-muted" />
              )}
            </button>
          ) : (
            <span className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          )}

          <a
            href={`#${node.id}`}
            onClick={(e) => handleHeadingClick(e, node.id)}
            className={`flex items-center gap-1.5 flex-1 min-w-0 py-0.5 pr-1 cursor-pointer truncate ${fontClass} ${
              isActive
                ? 'text-cme-primary font-semibold'
                : 'text-cme-text-muted group-hover:text-cme-text-base'
            }`}
            data-testid={`toc-item-${node.id}`}
            data-active={isActive ? 'true' : 'false'}
            title={node.text}
          >
            {getHeadingIcon(node.level, isActive)}
            <span className="truncate flex-1">{renderOutlineFormatted(node.rawText || node.text)}</span>
            {isCollapsed && descendantCount > 0 && (
              <span
                className="text-[10px] px-1.5 py-0.2 rounded-full bg-cme-bg-subtle text-cme-text-muted font-mono flex-shrink-0 ml-1 border border-cme-border-base"
                title={`${descendantCount} hidden subheadings`}
                data-testid={`toc-badge-${node.id}`}
              >
                +{descendantCount}
              </span>
            )}
          </a>
        </div>

        {!isCollapsed && hasChildren && (
          node.children.map((child) => renderTreeNode(child, depth + 1))
        )}
      </React.Fragment>
    );
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
        <div className="flex items-center gap-1.5">
          {hasCollapsibleNodes && (
            <button
              type="button"
              onClick={toggleAll}
              className="p-1 rounded hover:bg-cme-bg-hover text-cme-text-muted hover:text-cme-text-base transition-colors"
              title={isAllCollapsed ? 'Expand all sections' : 'Collapse all sections'}
              data-testid="toc-toggle-all-btn"
              aria-label={isAllCollapsed ? 'Expand all sections' : 'Collapse all sections'}
            >
              {isAllCollapsed ? (
                <ChevronsUpDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronsDownUp className="w-3.5 h-3.5" />
              )}
            </button>
          )}
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cme-bg-subtle text-cme-text-muted">
            {headings.length}
          </span>
        </div>
      </div>

      <div className="space-y-0.5 max-h-[calc(100vh-14rem)] overflow-y-auto no-scrollbar">
        {tree.map((node) => renderTreeNode(node, 0))}
      </div>
    </nav>
  );
};
