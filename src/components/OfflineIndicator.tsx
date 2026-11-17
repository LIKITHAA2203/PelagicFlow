import { useOnlineStatus } from '../hooks/usePWAInstall';

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-16 lg:bottom-4 left-4 z-[1100] flex items-center gap-2 rounded border border-amber-500/50 bg-[#0E1522] px-3 py-1.5 text-xs font-mono text-amber-300">
      <span aria-hidden="true">▲</span>
      <span>Offline Mode — Using cached telemetry</span>
    </div>
  );
}
