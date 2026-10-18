import { EditorView } from '@codemirror/view';

export const cmeEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '0.9375rem',
    color: 'var(--cme-text-base, #111827)',
    backgroundColor: 'var(--cme-bg-surface, #ffffff)',
    outline: 'none',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'inherit',
    lineHeight: '1.7',
  },
  '.cm-content': {
    minHeight: '100%',
    padding: '1.5rem',
    paddingBottom: '12rem',
    caretColor: 'var(--cme-primary, #3b82f6) !important',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  '.cm-content > *': {
    marginTop: '0 !important',
    marginBottom: '0 !important',
  },
  '.cm-line': {
    padding: '0.125rem 0',
    marginTop: '0 !important',
    marginBottom: '0 !important',
  },

  // Live Preview Typography
  '.cme-live-h1': {
    fontSize: '1.875rem',
    lineHeight: '2.25rem',
    fontWeight: '800',
    color: 'var(--cme-text-base, #111827)',
  },
  '.cme-live-h2': {
    fontSize: '1.5rem',
    lineHeight: '2rem',
    fontWeight: '700',
    color: 'var(--cme-text-base, #111827)',
  },
  '.cme-live-h3': {
    fontSize: '1.25rem',
    lineHeight: '1.75rem',
    fontWeight: '600',
    color: 'var(--cme-text-base, #111827)',
  },
  '.cme-live-h4': {
    fontSize: '1.125rem',
    lineHeight: '1.5rem',
    fontWeight: '600',
    color: 'var(--cme-text-base, #111827)',
  },
  '.cme-live-bold': {
    fontWeight: '700',
    color: 'var(--cme-text-base, #111827)',
  },
  '.cme-live-italic': {
    fontStyle: 'italic',
  },
  '.cme-live-strike': {
    textDecoration: 'line-through',
    opacity: '0.7',
  },
  '.cme-live-code': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    backgroundColor: 'var(--cme-bg-subtle, rgba(0, 0, 0, 0.05))',
    padding: '0.125rem 0.375rem',
    borderRadius: '0.25rem',
    fontSize: '0.875em',
    color: '#ec4899',
    border: '1px solid var(--cme-border-base, rgba(0, 0, 0, 0.1))',
  },
  '.cme-live-hidden': {
    display: 'none !important',
  },
  '.cme-syntax-marker': {
    opacity: '0.35',
    fontFamily: 'ui-monospace, monospace',
    fontSize: '0.9em',
  },
  '.cme-live-blockquote': {
    borderLeft: '4px solid var(--cme-primary, #3b82f6)',
    paddingLeft: '0.75rem',
    fontStyle: 'italic',
    color: 'var(--cme-text-muted, #64748b)',
  },
  '.cme-mono-line, .cme-mono-line *': {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace !important',
  },
  '.cme-mono-line': {
    fontSize: '0.9em',
  },

  // Collaborative Remote Cursors (matching test selectors)
  '.cm-ySelection': {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
  },
  '.cm-ySelectionCaret, .collaboration-cursor__caret': {
    position: 'relative',
    borderLeft: '2px solid #3b82f6',
    borderRight: 'none',
    marginLeft: '-1px',
    marginRight: '-1px',
    boxSizing: 'border-box',
    display: 'inline-block',
    height: '1.2em',
    verticalAlign: 'text-bottom',
  },
  '.cm-ySelectionInfo, .collaboration-cursor__label': {
    position: 'absolute',
    top: '-1.4em',
    left: '-1px',
    fontSize: '10px',
    fontWeight: '600',
    color: '#ffffff',
    backgroundColor: '#3b82f6',
    borderRadius: '3px 3px 3px 0',
    padding: '1px 4px',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    pointerEvents: 'none',
    zIndex: '20',
    opacity: '1 !important',
    visibility: 'visible !important',
  },
});
