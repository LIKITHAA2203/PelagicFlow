import { useState } from 'react';
import { Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export function PWAInstallButton() {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] text-xs font-medium rounded border border-cyan-500/50 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 transition-colors whitespace-nowrap shrink-0"
      >
        <Smartphone className="w-3.5 h-3.5" />
        <span>Install App</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/75 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Install PelagicFlow Mobile App"
        >
          <div className="w-full max-w-sm rounded-lg bg-[#0E1522] border border-slate-800 p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">
                  Install PelagicFlow on Mobile / Desktop
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Run PelagicFlow as a standalone full-screen app with offline telemetry cache.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close install instructions"
                className="p-1.5 rounded border border-slate-700 text-slate-400 hover:text-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <ol className="text-xs text-slate-300 space-y-2 list-decimal list-inside">
                <li>
                  Open the shared app URL directly in <strong>Safari</strong> on iPhone or iPad.
                </li>
                <li>
                  Tap the <strong>Share</strong> icon in Safari&apos;s bottom toolbar.
                </li>
                <li>
                  Scroll down and tap <strong>Add to Home Screen</strong>.
                </li>
              </ol>
            ) : (
              <ol className="text-xs text-slate-300 space-y-2 list-decimal list-inside">
                <li>
                  Open the shared app URL directly in <strong>Chrome / Edge</strong> (outside any embedded preview frame).
                </li>
                <li>
                  Tap the browser menu (<strong>⋮</strong>) or address-bar install icon.
                </li>
                <li>
                  Select <strong>Install app</strong> / <strong>Add to Home screen</strong>.
                </li>
              </ol>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full min-h-[44px] rounded bg-cyan-500 text-[#041218] text-xs font-semibold hover:bg-cyan-400 transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
