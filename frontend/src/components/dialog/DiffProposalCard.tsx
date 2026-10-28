import React, { useState } from 'react';
import { GitCommit, Check, Copy, FileText, ArrowRight } from 'lucide-react';
import { DiffProposal } from '../../types/dialog';

interface DiffProposalCardProps {
  proposal: DiffProposal;
  onApply?: (diff: string) => void;
}

export const DiffProposalCard: React.FC<DiffProposalCardProps> = ({ proposal, onApply }) => {
  const [copied, setCopied] = useState(false);
  const [applied, setApplied] = useState(proposal.applied || false);

  const handleCopy = () => {
    if (typeof navigator !== 'undefined') {
      navigator.clipboard.writeText(proposal.diff);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleApply = () => {
    if (onApply) {
      onApply(proposal.diff);
      setApplied(true);
    }
  };

  // Split diff lines for syntax-highlighted presentation
  const lines = proposal.diff.split('\n');

  return (
    <div className="rounded-lg border border-cme-border-base bg-cme-bg-base overflow-hidden my-2 shadow-sm text-xs">
      {/* Card Header */}
      <div className="px-3 py-2 bg-cme-bg-subtle border-b border-cme-border-base flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-semibold text-cme-text-base">
          <GitCommit className="w-3.5 h-3.5 text-cme-primary" />
          <span>Proposed Diff</span>
          {proposal.document_id && (
            <span className="flex items-center gap-1 text-[11px] font-normal text-cme-text-muted ml-1">
              <FileText className="w-3 h-3" />
              <span>Target Document</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-[11px] text-cme-text-muted hover:text-cme-text-base transition-colors"
            title="Copy Raw Diff"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>

      {/* Diff Code View */}
      <div className="p-2.5 font-mono text-[11px] overflow-x-auto max-h-56 bg-zinc-950/80 text-zinc-100 divide-y divide-zinc-900/50 leading-relaxed">
        {lines.map((line, idx) => {
          let lineClass = 'text-zinc-300';
          if (line.startsWith('+') && !line.startsWith('+++')) {
            lineClass = 'bg-emerald-950/40 text-emerald-300 font-medium px-1 rounded-sm';
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            lineClass = 'bg-rose-950/40 text-rose-300 font-medium px-1 rounded-sm';
          } else if (line.startsWith('@@')) {
            lineClass = 'text-sky-400 font-semibold';
          }
          return (
            <div key={idx} className={`whitespace-pre ${lineClass}`}>
              {line || ' '}
            </div>
          );
        })}
      </div>

      {/* Card Footer Actions */}
      <div className="px-3 py-2 bg-cme-bg-subtle border-t border-cme-border-base flex items-center justify-between">
        <span className="text-[11px] text-cme-text-muted">
          {applied ? '✓ Applied to editor canvas' : 'Review diff changes carefully before applying'}
        </span>
        <button
          onClick={handleApply}
          disabled={applied}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all ${
            applied
              ? 'bg-emerald-600 text-white cursor-default'
              : 'bg-cme-primary text-white hover:opacity-90 active:scale-95 shadow-sm'
          }`}
          data-testid="apply-diff-btn"
        >
          {applied ? (
            <>
              <Check className="w-3.5 h-3.5" />
              <span>Applied</span>
            </>
          ) : (
            <>
              <span>Apply to Document</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </>
          )}
        </button>
      </div>
    </div>
  );
};
