import React, { useState, useRef, useEffect } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import katex from 'katex';

export const InlineMathComponent: React.FC<NodeViewProps> = ({
  node,
  updateAttributes,
  selected,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [latexInput, setLatexInput] = useState(node.attrs.latex || 'E=mc^2');
  const spanRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentLatex = node.attrs.latex || '';

  useEffect(() => {
    if (spanRef.current && currentLatex) {
      try {
        katex.render(currentLatex, spanRef.current, {
          displayMode: false,
          throwOnError: false,
        });
      } catch {
        spanRef.current.textContent = currentLatex;
      }
    }
  }, [currentLatex, isEditing]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    updateAttributes({ latex: latexInput });
    setIsEditing(false);
  };

  return (
    <NodeViewWrapper as="span" className="inline-math-wrapper inline-block mx-0.5 align-middle select-none">
      {isEditing ? (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-cme-primary bg-cme-bg-surface text-xs shadow-sm">
          <span className="text-[10px] text-cme-text-muted font-mono">$</span>
          <input
            ref={inputRef}
            contentEditable={false}
            value={latexInput}
            onChange={(e) => setLatexInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') setIsEditing(false);
            }}
            onBlur={handleSave}
            className="w-24 px-1 text-xs font-mono bg-transparent border-none focus:outline-none text-cme-text-base"
          />
          <span className="text-[10px] text-cme-text-muted font-mono">$</span>
        </span>
      ) : (
        <span
          contentEditable={false}
          onClick={() => setIsEditing(true)}
          className={`inline-math-badge px-1 py-0.5 rounded cursor-pointer transition-colors ${
            selected
              ? 'bg-cme-primary/20 ring-1 ring-cme-primary'
              : 'hover:bg-cme-bg-hover bg-cme-bg-subtle/70'
          }`}
          title="Click to edit inline formula"
        >
          <span ref={spanRef} />
        </span>
      )}
    </NodeViewWrapper>
  );
};

export const InlineMath = Node.create({
  name: 'inlineMath',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      latex: {
        default: 'E=mc^2',
        parseHTML: (element) => element.getAttribute('data-latex') || element.textContent || '',
        renderHTML: (attributes) => ({
          'data-latex': attributes.latex,
          class: 'katex-inline',
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span.katex-inline',
        getAttrs: (element) => ({
          latex: (element as HTMLElement).getAttribute('data-expr') || (element as HTMLElement).textContent,
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(InlineMathComponent);
  },
});
