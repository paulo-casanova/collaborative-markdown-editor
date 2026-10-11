import React, { useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent, NodeViewProps } from '@tiptap/react';
import { Check, Copy, Code2 } from 'lucide-react';

const LANGUAGES = [
  { value: 'plaintext', label: 'Plain Text' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python', label: 'Python' },
  { value: 'cpp', label: 'C++' },
  { value: 'c', label: 'C' },
  { value: 'rust', label: 'Rust' },
  { value: 'go', label: 'Go' },
  { value: 'bash', label: 'Bash / Shell' },
  { value: 'sql', label: 'SQL' },
  { value: 'json', label: 'JSON' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'yaml', label: 'YAML' },
];

export const CodeBlockComponent: React.FC<NodeViewProps> = ({
  node,
  updateAttributes,
}) => {
  const [copied, setCopied] = useState(false);
  const language = node.attrs.language || 'plaintext';

  const handleCopy = () => {
    const text = node.textContent;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <NodeViewWrapper className="code-block-wrapper my-4 rounded-xl border border-cme-border-base bg-cme-bg-subtle overflow-hidden shadow-sm">
      {/* Header bar with Language selector & Copy button */}
      <div className="flex items-center justify-between px-3.5 py-1.5 border-b border-cme-border-base bg-cme-bg-surface/80 text-xs select-none">
        <div className="flex items-center gap-2">
          <Code2 className="w-3.5 h-3.5 text-cme-text-muted" />
          <select
            contentEditable={false}
            value={language}
            onChange={(e) => updateAttributes({ language: e.target.value })}
            className="bg-transparent font-mono text-[11px] text-cme-text-muted hover:text-cme-text-base border-none focus:outline-none cursor-pointer"
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.value} value={lang.value} className="bg-cme-bg-surface text-cme-text-base">
                {lang.label}
              </option>
            ))}
          </select>
        </div>

        <button
          contentEditable={false}
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-cme-text-muted hover:text-cme-text-base hover:bg-cme-bg-hover transition-colors"
          title="Copy code to clipboard"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-500" />
              <span className="text-emerald-500 font-medium">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code Content Container */}
      <pre className="p-4 overflow-x-auto text-xs font-mono leading-relaxed bg-cme-bg-subtle">
        <NodeViewContent className={`language-${language}`} />
      </pre>
    </NodeViewWrapper>
  );
};

export const CodeBlockCustom = Node.create({
  name: 'codeBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,

  addAttributes() {
    return {
      language: {
        default: 'plaintext',
        parseHTML: (element) => {
          const dataLang = element.getAttribute('data-language');
          if (dataLang) return dataLang;
          const match = /language-(\w+)/.exec(element.firstElementChild?.className || element.className || '');
          return match ? match[1] : 'plaintext';
        },
        renderHTML: (attributes) => ({
          'data-language': attributes.language,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'pre',
        preserveWhitespace: 'full',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['pre', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), ['code', {}, 0]];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockComponent);
  },
});
