import React, { useState } from 'react';
import { Node, mergeAttributes, InputRule } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import { useNavigate } from 'react-router-dom';
import { FileText, ExternalLink, X, Check } from 'lucide-react';

export const WikiLinkComponent: React.FC<NodeViewProps> = ({
  node,
  updateAttributes,
  selected,
}) => {
  const navigate = useNavigate();
  const [showPopup, setShowPopup] = useState(false);
  const [targetInput, setTargetInput] = useState(node.attrs.target || '');
  const [labelInput, setLabelInput] = useState(node.attrs.label || '');

  const target = node.attrs.target || '';
  const label = node.attrs.label || target;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.metaKey || e.ctrlKey) {
      // Direct navigation on Ctrl/Cmd + click
      navigate(`/documents/by-path?path=${encodeURIComponent(target)}`);
    } else {
      setShowPopup(true);
    }
  };

  const handleSave = () => {
    updateAttributes({
      target: targetInput,
      label: labelInput || targetInput,
    });
    setShowPopup(false);
  };

  return (
    <NodeViewWrapper as="span" className="wiki-link-node inline-block align-middle select-none relative my-0.5 mx-0.5">
      <span
        contentEditable={false}
        onClick={handleClick}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md font-mono text-xs cursor-pointer transition-colors border ${
          selected
            ? 'border-cme-primary bg-cme-primary/10 text-cme-primary ring-1 ring-cme-primary'
            : 'border-cme-primary/30 bg-cme-primary/5 text-cme-primary hover:bg-cme-primary/15'
        }`}
        title={`Wiki Link: [[${target}${node.attrs.label ? '|' + node.attrs.label : ''}]] (Ctrl+Click to open)`}
      >
        <FileText className="w-3 h-3 text-cme-primary flex-shrink-0" />
        <span className="font-medium underline decoration-cme-primary/40 underline-offset-2">
          {label}
        </span>
      </span>

      {/* Popover Card */}
      {showPopup && (
        <div
          contentEditable={false}
          className="absolute left-0 bottom-full mb-1.5 w-64 p-3 bg-cme-bg-surface border border-cme-border-base rounded-xl shadow-xl z-50 text-xs space-y-2 animate-in fade-in"
        >
          <div className="flex items-center justify-between pb-1.5 border-b border-cme-border-base">
            <span className="font-semibold text-cme-text-base">Wiki Reference</span>
            <button
              onClick={() => setShowPopup(false)}
              className="p-0.5 text-cme-text-muted hover:text-cme-text-base rounded"
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          <div className="space-y-1.5">
            <div>
              <label className="text-[10px] text-cme-text-subtle font-mono uppercase">Target Path</label>
              <input
                type="text"
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
                placeholder="e.g. guides/intro.md"
                className="w-full px-2 py-1 bg-cme-bg-base border border-cme-border-base rounded font-mono text-[11px] text-cme-text-base focus:outline-none focus:border-cme-primary"
              />
            </div>
            <div>
              <label className="text-[10px] text-cme-text-subtle font-mono uppercase">Display Label (Optional)</label>
              <input
                type="text"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                placeholder="e.g. Introduction Guide"
                className="w-full px-2 py-1 bg-cme-bg-base border border-cme-border-base rounded text-[11px] text-cme-text-base focus:outline-none focus:border-cme-primary"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <button
              onClick={() => {
                setShowPopup(false);
                navigate(`/documents/by-path?path=${encodeURIComponent(target)}`);
              }}
              className="flex items-center gap-1 text-[11px] text-cme-primary hover:underline"
            >
              <ExternalLink className="w-3 h-3" />
              <span>Open File</span>
            </button>

            <button
              onClick={handleSave}
              className="flex items-center gap-1 px-2.5 py-1 bg-cme-primary text-white rounded text-[11px] font-medium hover:bg-cme-primary-hover transition-colors"
            >
              <Check className="w-3 h-3" />
              <span>Save</span>
            </button>
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
};

export const WikiLink = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      target: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-target') || element.getAttribute('href') || '',
        renderHTML: (attributes) => ({
          'data-target': attributes.target,
          class: 'wiki-link',
        }),
      },
      label: {
        default: '',
        parseHTML: (element) => element.textContent || '',
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'a.wiki-link',
        getAttrs: (element) => ({
          target: (element as HTMLElement).getAttribute('data-target') || (element as HTMLElement).getAttribute('href'),
          label: (element as HTMLElement).textContent,
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['a', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(WikiLinkComponent);
  },

  addInputRules() {
    return [
      new InputRule({
        // Match [[target|label]] or [[target]]
        find: /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/,
        handler: ({ state, range, match }) => {
          const target = match[1]?.trim() || '';
          const label = match[2]?.trim() || target;
          const { tr } = state;
          if (target) {
            tr.replaceWith(
              range.from,
              range.to,
              this.type.create({ target, label })
            );
          }
        },
      }),
    ];
  },
});
