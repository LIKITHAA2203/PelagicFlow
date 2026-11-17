import { useEffect, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';

interface BackendFile {
  name: string;
  lang: string;
  content: string;
}

interface PyGCodeModalProps {
  open: boolean;
  onClose: () => void;
}

export function PyGCodeModal({ open, onClose }: PyGCodeModalProps) {
  const [files, setFiles] = useState<BackendFile[]>([]);
  const [activeFile, setActiveFile] = useState<string>('gnn_model.py');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || files.length > 0) return;
    fetch('/api/backend-files')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.files)) {
          setFiles(data.files);
        }
      })
      .catch(() => {});
  }, [open, files.length]);

  if (!open) return null;

  const current = files.find((f) => f.name === activeFile) || files[0];

  const handleCopy = async () => {
    if (!current) return;
    await navigator.clipboard.writeText(current.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div
      className="fixed inset-0 z-[1200] bg-black/75 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Python FastAPI and PyTorch Geometric Source Code"
    >
      <div className="w-full max-w-5xl h-[82vh] bg-[#0E1522] border border-slate-800 rounded-lg flex flex-col overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              Python FastAPI &amp; PyTorch Geometric Codebase
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Complete backend implementation with SAGEConv, GCNConv, LSTM rollout, RK4 drift, and Open-Meteo Marine ingestion.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-slate-700 bg-[#070B12] text-slate-200 hover:border-cyan-500/60 transition-colors whitespace-nowrap"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-cyan-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy File'}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close code inspector"
              className="p-1.5 rounded border border-slate-700 text-slate-400 hover:text-slate-100 hover:border-slate-500 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          <div className="w-full md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-slate-800 bg-[#070B12] p-2 flex md:flex-col gap-1 overflow-x-auto">
            {files.map((f) => (
              <button
                key={f.name}
                type="button"
                onClick={() => setActiveFile(f.name)}
                className={`text-left px-3 py-2 rounded text-xs font-mono whitespace-nowrap transition-colors ${
                  current?.name === f.name
                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent'
                }`}
              >
                backend/{f.name}
              </button>
            ))}
          </div>

          <pre className="flex-1 min-h-0 overflow-auto p-4 text-xs font-mono leading-relaxed text-slate-200 bg-[#060910]">
            <code>{current ? current.content : 'Loading backend source files...'}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
