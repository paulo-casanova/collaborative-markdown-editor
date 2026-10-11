import React, { useState, useRef, useEffect } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import katex from 'katex';
import { Sigma, Edit3, Eye, Copy, Check } from 'lucide-react';

export const MathBlockComponent: React.FC<NodeViewProps> = ({
  node,
  updateAttributes,
  selected,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [latexInput, setLatexInput] = useState(node.attrs.latex || 'f(x) = \\int_{-\\infty}^\\infty \\hat{f}(\\xi)\\,e^{2 \\pi i \\xi x}\\,d\\xi');
  const [renderError, setRenderError] = useState<string | null>(null);
  const mathRef = useRef<HTMLDivElement>(null);

  const currentLatex = node.attrs.latex || '';

  // Render KaTeX HTML
  useEffect(() => {
    if (mathRef.current && currentLatex) {
      try {
        katex.render(currentLatex, mathRef.current, {
          displayMode: true,
          throwOnError: true,
        });
        setRenderError(null);
      } catch (err: any) {
        setRenderError(err.message || 'KaTeX render error');
      }
    }
  }, [currentLatex]);

  const handleSave = () => {
    updateAttributes({ latex: latexInput });
    setIsEditing(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(currentLatex);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <NodeViewWrapper className={`math-block-node my-4 rounded-xl border transition-all ${
      selected ? 'border-cme-primary ring-2 ring-cme-primary/20' : 'border-cme-border-base'
    } bg-cme-bg-surface overflow-hidden shadow-sm`}>
      {/* Top Header */}
      <div className="flex items-center justify-between px-3.5 py-1.5 border-b border-cme-border-base bg-cme-bg-subtle text-xs select-none">
        <div className="flex items-center gap-2">
          <Sigma className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
          <span className="font-semibold text-[11px] text-cme-text-muted">KaTeX Math Formula</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            contentEditable={false}
            onClick={() => setIsEditing(!isEditing)}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover transition-colors"
          >
            {isEditing ? <Eye className="w-3 h-3" /> : <Edit3 className="w-3 h-3" />}
            <span>{isEditing ? 'Preview' : 'Edit LaTeX'}</span>
          </button>

          <button
            contentEditable={false}
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover transition-colors"
            title="Copy LaTeX formula"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Editing View */}
      {isEditing ? (
        <div className="p-4 space-y-3 bg-cme-bg-subtle/50">
          <textarea
            contentEditable={false}
            value={latexInput}
            onChange={(e) => setLatexInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                handleSave();
              }
            }}
            placeholder="Type LaTeX math (e.g. E = mc^2)"
            rows={3}
            className="w-full p-2.5 font-mono text-xs bg-cme-bg-base border border-cme-border-base rounded-lg focus:outline-none focus:border-cme-primary text-cme-text-base resize-y"
          />
          <div className="flex justify-between items-center text-[11px]">
            <span className="text-cme-text-subtle">Press Ctrl+Enter to save</span>
            <div className="flex gap-2">
              <button
                contentEditable={false}
                onClick={() => setIsEditing(false)}
                className="px-2.5 py-1 text-cme-text-muted hover:text-cme-text-base rounded"
              >
                Cancel
              </button>
              <button
                contentEditable={false}
                onClick={handleSave}
                className="px-3 py-1 bg-cme-primary text-white font-medium rounded hover:bg-cme-primary-hover transition-colors"
              >
                Apply Math
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Math Display View */
        <div
          contentEditable={false}
          onDoubleClick={() => setIsEditing(true)}
          className="p-6 overflow-x-auto text-center cursor-pointer hover:bg-cme-bg-hover/20 transition-colors"
          title="Double-click to edit LaTeX formula"
        >
          {renderError ? (
            <div className="text-rose-500 font-mono text-xs p-2 bg-rose-500/10 rounded-lg">
              Error rendering formula: {renderError}
            </div>
          ) : (
            <div ref={mathRef} className="katex-display-container my-1" />
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
};

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      latex: {
        default: 'f(x) = \\int_{-\\infty}^\\infty \\hat{f}(\\xi)\\,e^{2 \\pi i \\xi x}\\,d\\xi',
        parseHTML: (element) => element.getAttribute('data-latex') || element.textContent || '',
        renderHTML: (attributes) => ({
          'data-latex': attributes.latex,
          class: 'katex-display-block',
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div.katex-display-block',
      },
      {
        tag: 'div.katex-display',
        getAttrs: (element) => ({
          latex: (element as HTMLElement).getAttribute('data-expr') || (element as HTMLElement).textContent,
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathBlockComponent);
  },
});
