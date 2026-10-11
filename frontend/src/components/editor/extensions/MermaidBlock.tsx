import React, { useState, useEffect } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import {
  GitGraph,
  Edit3,
  Eye,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Copy,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { renderMermaidSvg } from '../utils/mermaidRenderer';
import { useThemeStore } from '../../../stores/themeStore';

const DEFAULT_MERMAID = `flowchart TD
    Client["Client App (React + TipTap)"] -->|"WebSocket (1-byte opcode)"| Hub["Collab Hub (C++23)"]
    Hub --> Yrs["y-crdt headless"]
    Hub --> POSIX["POSIX Disk (Debounced)"]`;

export const MermaidBlockComponent: React.FC<NodeViewProps> = ({
  node,
  updateAttributes,
  selected,
}) => {
  const { resolvedTheme } = useThemeStore();
  const [isEditing, setIsEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [svgHtml, setSvgHtml] = useState<string>('');
  const [renderError, setRenderError] = useState<string | null>(null);
  const [sourceInput, setSourceInput] = useState(node.attrs.source || DEFAULT_MERMAID);

  const currentSource = node.attrs.source || DEFAULT_MERMAID;
  const isDark = resolvedTheme === 'dark';

  useEffect(() => {
    let active = true;
    renderMermaidSvg(currentSource, isDark)
      .then((svg) => {
        if (active) {
          setSvgHtml(svg);
          setRenderError(null);
        }
      })
      .catch((err: any) => {
        if (active) {
          setRenderError(err.message || 'Syntax error in Mermaid diagram');
        }
      });

    return () => {
      active = false;
    };
  }, [currentSource, isDark]);

  const handleSave = () => {
    updateAttributes({ source: sourceInput });
    setIsEditing(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(currentSource);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <NodeViewWrapper
      className={`mermaid-block-node my-4 rounded-xl border transition-all ${
        selected ? 'border-cme-primary ring-2 ring-cme-primary/20' : 'border-cme-border-base'
      } bg-cme-bg-surface overflow-hidden shadow-sm`}
    >
      {/* Top Header bar with Zoom & Mode controls */}
      <div className="flex items-center justify-between px-3.5 py-1.5 border-b border-cme-border-base bg-cme-bg-subtle text-xs select-none">
        <div className="flex items-center gap-2">
          <GitGraph className="w-3.5 h-3.5 text-sky-500" />
          <span className="font-semibold text-[11px] text-cme-text-muted">Mermaid Diagram</span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Zoom controls (only in preview mode) */}
          {!isEditing && (
            <div className="flex items-center gap-0.5 border-r border-cme-border-base pr-2 mr-1">
              <button
                contentEditable={false}
                onClick={() => setZoom((z) => Math.min(z + 0.15, 2.5))}
                className="p-1 rounded text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover"
                title="Zoom In"
              >
                <ZoomIn className="w-3 h-3" />
              </button>
              <button
                contentEditable={false}
                onClick={() => setZoom((z) => Math.max(z - 0.15, 0.4))}
                className="p-1 rounded text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover"
                title="Zoom Out"
              >
                <ZoomOut className="w-3 h-3" />
              </button>
              <button
                contentEditable={false}
                onClick={() => setZoom(1)}
                className="p-1 rounded text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover font-mono text-[10px]"
                title="Reset Zoom"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
              <span className="text-[10px] text-cme-text-subtle font-mono pl-1">
                {Math.round(zoom * 100)}%
              </span>
            </div>
          )}

          <button
            contentEditable={false}
            onClick={() => setIsEditing(!isEditing)}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover transition-colors"
          >
            {isEditing ? <Eye className="w-3 h-3" /> : <Edit3 className="w-3 h-3" />}
            <span>{isEditing ? 'Preview' : 'Edit Source'}</span>
          </button>

          <button
            contentEditable={false}
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover transition-colors"
            title="Copy diagram source"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Editor view */}
      {isEditing ? (
        <div className="p-4 space-y-3 bg-cme-bg-subtle/50">
          <textarea
            contentEditable={false}
            value={sourceInput}
            onChange={(e) => setSourceInput(e.target.value)}
            placeholder="Type Mermaid diagram definition (e.g. flowchart TD...)"
            rows={6}
            className="w-full p-2.5 font-mono text-xs bg-cme-bg-base border border-cme-border-base rounded-lg focus:outline-none focus:border-cme-primary text-cme-text-base resize-y leading-relaxed"
          />
          <div className="flex justify-between items-center text-[11px]">
            <span className="text-cme-text-subtle">
              Supported: flowcharts, sequence diagrams, state diagrams, ER models
            </span>
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
                Update Diagram
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Diagram Render View */
        <div
          contentEditable={false}
          onDoubleClick={() => setIsEditing(true)}
          className="p-6 overflow-auto text-center cursor-pointer min-h-[160px] flex items-center justify-center bg-cme-bg-surface hover:bg-cme-bg-hover/10 transition-colors"
          title="Double-click to edit Mermaid source code"
        >
          {renderError ? (
            <div className="p-4 text-xs font-mono text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded-xl space-y-2 text-left max-w-lg">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="w-4 h-4" />
                <span>Mermaid Render Error</span>
              </div>
              <p className="text-[11px]">{renderError}</p>
              <button
                onClick={() => setIsEditing(true)}
                className="text-[11px] text-cme-primary underline"
              >
                Click to edit diagram source
              </button>
            </div>
          ) : (
            <div
              className="mermaid-svg-container transition-transform duration-100 ease-out flex justify-center"
              style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
              dangerouslySetInnerHTML={{ __html: svgHtml }}
            />
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
};

export const MermaidBlock = Node.create({
  name: 'mermaidBlock',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      source: {
        default: DEFAULT_MERMAID,
        parseHTML: (element) => element.getAttribute('data-source') || element.textContent || '',
        renderHTML: (attributes) => ({
          'data-source': attributes.source,
          class: 'mermaid',
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div.mermaid',
        getAttrs: (element) => ({
          source: (element as HTMLElement).textContent || (element as HTMLElement).getAttribute('data-source'),
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidBlockComponent);
  },
});
