import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react';

export interface ReaderFindBarProps {
  isOpen: boolean;
  onClose: () => void;
  containerRef: React.RefObject<HTMLElement | null>;
  contentRootRef: React.RefObject<HTMLElement | null>;
}

export const ReaderFindBar: React.FC<ReaderFindBarProps> = ({
  isOpen,
  onClose,
  containerRef,
  contentRootRef,
}) => {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [matchesCount, setMatchesCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const matchElementsRef = useRef<HTMLElement[]>([]);

  // Clears all temporary mark tags from the content DOM
  const clearAllMarks = useCallback(() => {
    const root = contentRootRef.current;
    if (!root) return;

    const marks = root.querySelectorAll('mark.cme-reader-search-match');
    marks.forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
      parent.normalize();
    });
    matchElementsRef.current = [];
  }, [contentRootRef]);

  // Smoothly scrolls the reader container to center the active match
  const scrollToMatch = useCallback((markEl: HTMLElement) => {
    const container = containerRef.current || document.getElementById('reader-scroll-container');
    if (container && markEl) {
      const elRect = markEl.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const targetTop =
        container.scrollTop + (elRect.top - containerRect.top) - containerRect.height / 2;
      container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
    } else if (markEl) {
      markEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [containerRef]);

  // Performs search and wraps matches in <mark> tags
  const executeSearch = useCallback(() => {
    clearAllMarks();
    const root = contentRootRef.current;
    if (!root || !query.trim()) {
      setMatchesCount(0);
      setActiveIndex(-1);
      return;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName.toUpperCase();
        if (
          tag === 'SCRIPT' ||
          tag === 'STYLE' ||
          tag === 'BUTTON' ||
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          parent.closest('[data-testid="reader-floating-review-menu"]') ||
          parent.closest('.reader-comment-card') ||
          parent.closest('.reader-suggestion-card') ||
          parent.closest('.cme-reader-find-bar')
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const textNodes: Text[] = [];
    let currentNode = walker.nextNode();
    while (currentNode) {
      textNodes.push(currentNode as Text);
      currentNode = walker.nextNode();
    }

    let escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (wholeWord) {
      escaped = `\\b${escaped}\\b`;
    }
    const flags = caseSensitive ? 'g' : 'gi';
    let regex: RegExp;
    try {
      regex = new RegExp(escaped, flags);
    } catch {
      setMatchesCount(0);
      setActiveIndex(-1);
      return;
    }

    const matches: HTMLElement[] = [];

    for (const textNode of textNodes) {
      const text = textNode.nodeValue || '';
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      const matchRanges: { start: number; end: number }[] = [];

      while ((match = regex.exec(text)) !== null) {
        matchRanges.push({ start: match.index, end: match.index + match[0].length });
        if (regex.lastIndex === match.index) {
          regex.lastIndex++;
        }
      }

      if (matchRanges.length === 0) continue;

      // Process ranges backwards so earlier indices remain valid after splitText
      for (let i = matchRanges.length - 1; i >= 0; i--) {
        const { start, end } = matchRanges[i];
        textNode.splitText(end);
        const matchNode = textNode.splitText(start);
        const mark = document.createElement('mark');
        mark.className = 'cme-reader-search-match';
        matchNode.parentNode?.insertBefore(mark, matchNode);
        mark.appendChild(matchNode);
        matches.unshift(mark);
      }
    }

    matchElementsRef.current = matches;
    setMatchesCount(matches.length);

    if (matches.length > 0) {
      matches[0].classList.add('cme-reader-search-match-active');
      scrollToMatch(matches[0]);
      setActiveIndex(0);
    } else {
      setActiveIndex(-1);
    }
  }, [clearAllMarks, contentRootRef, query, caseSensitive, wholeWord, scrollToMatch]);

  const jumpToMatch = useCallback(
    (index: number) => {
      const matches = matchElementsRef.current;
      if (matches.length === 0) return;

      if (activeIndex >= 0 && activeIndex < matches.length) {
        matches[activeIndex]?.classList.remove('cme-reader-search-match-active');
      }

      const wrapped = (index + matches.length) % matches.length;
      matches[wrapped]?.classList.add('cme-reader-search-match-active');
      scrollToMatch(matches[wrapped]);
      setActiveIndex(wrapped);
    },
    [activeIndex, scrollToMatch]
  );

  const handleNext = useCallback(() => {
    if (matchesCount === 0) return;
    jumpToMatch(activeIndex + 1);
  }, [activeIndex, jumpToMatch, matchesCount]);

  const handlePrev = useCallback(() => {
    if (matchesCount === 0) return;
    jumpToMatch(activeIndex - 1);
  }, [activeIndex, jumpToMatch, matchesCount]);

  // Open/Close effect: focus input or clear marks
  useEffect(() => {
    if (isOpen) {
      // If user had text selected, prefill find query
      const selection = window.getSelection()?.toString()?.trim() || '';
      if (selection && !selection.includes('\n') && selection.length <= 60) {
        setQuery(selection);
      }
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    } else {
      clearAllMarks();
      setMatchesCount(0);
      setActiveIndex(-1);
    }
  }, [isOpen, clearAllMarks]);

  // Run search when query, options, or open state changes
  useEffect(() => {
    if (isOpen) {
      executeSearch();
    }
    return () => {
      clearAllMarks();
    };
  }, [isOpen, query, caseSensitive, wholeWord, executeSearch, clearAllMarks]);

  // Global key listener while find bar is open
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'F3') {
        e.preventDefault();
        if (e.shiftKey) {
          handlePrev();
        } else {
          handleNext();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, handleNext, handlePrev]);

  if (!isOpen) return null;

  return (
    <div
      data-testid="reader-find-bar"
      className="cme-reader-find-bar sticky top-12 z-30 ml-auto mr-4 md:mr-8 mb-2 max-w-sm flex items-center gap-1.5 p-1.5 rounded-xl bg-cme-bg-surface/95 border border-cme-border-base shadow-lg backdrop-blur-md text-xs text-cme-text-base animate-in fade-in slide-in-from-top-2 duration-150 select-none"
    >
      <div className="flex items-center gap-1.5 pl-2 flex-1 min-w-0">
        <Search className="w-3.5 h-3.5 text-cme-text-muted flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (e.shiftKey) {
                handlePrev();
              } else {
                handleNext();
              }
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder="Find in document..."
          className="w-full bg-transparent border-none outline-none text-xs text-cme-text-base placeholder:text-cme-text-muted/60"
          data-testid="reader-find-input"
        />
      </div>

      {/* Match count badge */}
      {query.trim() && (
        <span
          data-testid="reader-find-count"
          className="text-[11px] font-mono text-cme-text-muted px-1.5 py-0.5 rounded-md bg-cme-bg-subtle flex-shrink-0"
        >
          {matchesCount > 0 ? `${activeIndex + 1} of ${matchesCount}` : '0 of 0'}
        </span>
      )}

      {/* Prev / Next Buttons */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button
          type="button"
          onClick={handlePrev}
          disabled={matchesCount === 0}
          title="Previous match (Shift+Enter / Shift+F3)"
          data-testid="reader-find-prev-btn"
          className="p-1 rounded-md hover:bg-cme-bg-hover text-cme-text-muted hover:text-cme-text-base disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={handleNext}
          disabled={matchesCount === 0}
          title="Next match (Enter / F3)"
          data-testid="reader-find-next-btn"
          className="p-1 rounded-md hover:bg-cme-bg-hover text-cme-text-muted hover:text-cme-text-base disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Option Toggles: Match Case & Whole Word */}
      <div className="flex items-center gap-0.5 border-l border-cme-border-base pl-1 flex-shrink-0">
        <button
          type="button"
          onClick={() => setCaseSensitive((prev) => !prev)}
          title="Match Case (Aa)"
          data-testid="reader-find-case-btn"
          className={`px-1.5 py-0.5 rounded text-[11px] font-semibold transition-colors ${
            caseSensitive
              ? 'bg-cme-primary text-white'
              : 'text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover'
          }`}
        >
          Aa
        </button>
        <button
          type="button"
          onClick={() => setWholeWord((prev) => !prev)}
          title="Match Whole Word (\b)"
          data-testid="reader-find-word-btn"
          className={`px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold transition-colors ${
            wholeWord
              ? 'bg-cme-primary text-white'
              : 'text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover'
          }`}
        >
          \b
        </button>
      </div>

      {/* Close Button */}
      <button
        type="button"
        onClick={onClose}
        title="Close (Escape)"
        data-testid="reader-find-close-btn"
        className="p-1 rounded-md hover:bg-cme-bg-hover text-cme-text-muted hover:text-cme-text-base transition-colors flex-shrink-0 ml-0.5"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
