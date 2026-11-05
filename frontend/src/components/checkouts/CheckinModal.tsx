import React, { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, X, AlertCircle, CheckCircle, FolderOpen } from 'lucide-react';
import { checkinDocument } from '../../api/checkouts';
import {
  isFileSystemAccessSupported,
  readFileFromStoredDirectory,
} from '../../utils/localCheckoutStorage';

interface CheckinModalProps {
  isOpen: boolean;
  onClose: () => void;
  path: string;
  filename: string;
  onSuccess?: () => void;
}

export const CheckinModal: React.FC<CheckinModalProps> = ({
  isOpen,
  onClose,
  path,
  filename,
  onSuccess,
}) => {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [summary, setSummary] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hasLocalDirFile, setHasLocalDirFile] = useState<boolean>(false);
  const [loadingLocal, setLoadingLocal] = useState<boolean>(false);

  // Check if file is available in the local stored directory
  useEffect(() => {
    if (!isOpen) {
      setSelectedFile(null);
      setSummary('');
      setErrorMsg(null);
      setHasLocalDirFile(false);
      return;
    }

    if (isFileSystemAccessSupported()) {
      void readFileFromStoredDirectory(filename).then((f) => {
        if (f) {
          setHasLocalDirFile(true);
        }
      });
    }
  }, [isOpen, filename]);

  const loadFromLocalDir = async () => {
    setLoadingLocal(true);
    setErrorMsg(null);
    try {
      const file = await readFileFromStoredDirectory(filename);
      if (file) {
        setSelectedFile(file);
      } else {
        setErrorMsg('File not found in configured local directory');
      }
    } catch (e: any) {
      setErrorMsg(e?.message || 'Could not access local file');
    } finally {
      setLoadingLocal(false);
    }
  };

  const checkinMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error('Please select a file to check in');
      return checkinDocument(path, selectedFile, summary.trim());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-tree'] });
      queryClient.invalidateQueries({ queryKey: ['directory-details'] });
      queryClient.invalidateQueries({ queryKey: ['my-checkouts'] });
      queryClient.invalidateQueries({ queryKey: ['checkout-status', path] });
      queryClient.invalidateQueries({ queryKey: ['checkout-history', path] });
      onSuccess?.();
      onClose();
    },
    onError: (err: any) => {
      setErrorMsg(err?.message || 'Check-in failed');
    },
  });

  if (!isOpen) return null;

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      data-testid="checkin-modal"
    >
      <div className="w-full max-w-md rounded-2xl border border-cme-border-base bg-cme-bg-surface p-6 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-cme-border-base">
          <div>
            <h3 className="font-semibold text-sm text-cme-text-base">Check In Document</h3>
            <p className="text-xs text-cme-text-muted truncate max-w-xs">{path}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-cme-bg-hover text-cme-text-muted hover:text-cme-text-base"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {errorMsg && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">{errorMsg}</span>
          </div>
        )}

        {/* Load from Local Directory Shortcut if available */}
        {hasLocalDirFile && !selectedFile && (
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs">
            <span className="text-blue-600 dark:text-blue-400">
              Found &ldquo;{filename}&rdquo; in local checkout folder
            </span>
            <button
              onClick={loadFromLocalDir}
              disabled={loadingLocal}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>Load Local</span>
            </button>
          </div>
        )}

        {/* File Dropzone */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
            selectedFile
              ? 'border-emerald-500 bg-emerald-500/5'
              : 'border-cme-border-base hover:border-cme-primary bg-cme-bg-subtle/30'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileChange}
            className="hidden"
            data-testid="checkin-file-input"
          />

          {selectedFile ? (
            <div className="flex flex-col items-center gap-2 text-xs">
              <CheckCircle className="w-8 h-8 text-emerald-500" />
              <div className="font-medium text-cme-text-base truncate max-w-xs">
                {selectedFile.name}
              </div>
              <span className="text-cme-text-muted">
                {(selectedFile.size / 1024).toFixed(1)} KB &bull; Click to change
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-xs text-cme-text-muted">
              <Upload className="w-8 h-8 text-cme-text-subtle" />
              <span className="font-medium text-cme-text-base">
                Click or drag &amp; drop updated file
              </span>
              <span>Replaces current active version in CME</span>
            </div>
          )}
        </div>

        {/* Change Summary Input */}
        <div>
          <label className="block text-xs text-cme-text-muted mb-1.5 font-medium">
            Revision Summary (optional)
          </label>
          <input
            type="text"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="e.g. Added section 3.2 review comments"
            className="w-full px-3 py-2 text-xs rounded-lg border border-cme-border-base bg-cme-bg-subtle text-cme-text-base focus:outline-none focus:ring-1 focus:ring-cme-primary"
            data-testid="checkin-summary-input"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-lg border border-cme-border-base hover:bg-cme-bg-hover text-cme-text-base transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!selectedFile || checkinMutation.isPending}
            onClick={() => checkinMutation.mutate()}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-lg bg-cme-primary hover:bg-cme-primary-hover text-white font-medium transition-colors disabled:opacity-50"
            data-testid="checkin-submit-btn"
          >
            {checkinMutation.isPending ? 'Checking In...' : 'Check In'}
          </button>
        </div>
      </div>
    </div>
  );
};
