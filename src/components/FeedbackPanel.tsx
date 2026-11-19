import { useEffect, useState } from 'react';
import { Crosshair, Sparkles } from 'lucide-react';
import type {
  FeedbackType,
  RoutingStrategy,
  TunableModelWeights,
  UserFeedbackRecord,
} from '../types/ocean';

interface FeedbackPanelProps {
  regionId: string;
  pickedCoords: { lat: number; lon: number; predictedIndex?: number } | null;
  pickActive: boolean;
  onTogglePickMode: () => void;
  onModelFineTuned: () => void;
}

export function FeedbackPanel({
  regionId,
  pickedCoords,
  pickActive,
  onTogglePickMode,
  onModelFineTuned,
}: FeedbackPanelProps) {
  const [feedbackType, setFeedbackType] = useState<FeedbackType>('density_discrepancy');
  const [lat, setLat] = useState<string>('35.0');
  const [lon, setLon] = useState<string>('-145.0');
  const [predictedPct, setPredictedPct] = useState<string>('55');
  const [observedPct, setObservedPct] = useState<string>('72');
  const [strategy, setStrategy] = useState<RoutingStrategy>('balanced');
  const [notes, setNotes] = useState<string>('');

  const [records, setRecords] = useState<UserFeedbackRecord[]>([]);
  const [weights, setWeights] = useState<TunableModelWeights | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [tuning, setTuning] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const loadState = async () => {
    try {
      const res = await fetch('/api/feedback');
      const data = await res.json();
      if (Array.isArray(data.feedback)) setRecords(data.feedback);
      if (data.weights) {
        setWeights(data.weights);
        setStrategy(data.weights.routingStrategy || 'balanced');
      }
    } catch {
      // Ignore transient load errors
    }
  };

  useEffect(() => {
    loadState();
  }, []);

  useEffect(() => {
    if (!pickedCoords) return;
    setLat(String(pickedCoords.lat));
    setLon(String(pickedCoords.lon));
    if (pickedCoords.predictedIndex !== undefined) {
      setPredictedPct(String(Math.round(pickedCoords.predictedIndex * 100)));
    }
  }, [pickedCoords]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          regionId,
          feedbackType,
          lat: parseFloat(lat),
          lon: parseFloat(lon),
          predictedIndex: Math.min(1, Math.max(0, parseFloat(predictedPct) / 100)),
          observedIndex: Math.min(1, Math.max(0, parseFloat(observedPct) / 100)),
          preferredRoutingStrategy: strategy,
          notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save feedback');
      setNotes('');
      setStatusMsg('Observation stored. Click Fine-Tune Model to calibrate GNN & router.');
      await loadState();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Submission error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFineTune = async () => {
    setTuning(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/model/finetune', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      const data = await res.json();
      if (data.weights) setWeights(data.weights);
      if (data.trained) {
        setStatusMsg(
          `Calibrated v${data.weights.version}: MSE ${data.mseBefore} → ${data.mseAfter} (${data.weights.routingStrategy})`
        );
        onModelFineTuned();
      } else {
        setStatusMsg('Submit at least 1 observation first to run fine-tuning.');
      }
      await loadState();
    } catch {
      setStatusMsg('Fine-tuning failed.');
    } finally {
      setTuning(false);
    }
  };

  const pendingCount = records.filter((r) => !r.usedInTraining).length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 text-xs">
      {/* Left: Submit Discrepancy / Routing Feedback */}
      <form
        onSubmit={handleSubmit}
        className="lg:col-span-7 border border-slate-800 bg-[#070B12] rounded p-3 space-y-2.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[11px] text-cyan-300 uppercase">
            Report Observation or Route Adjustment
          </span>
          <button
            type="button"
            onClick={onTogglePickMode}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border transition-colors ${
              pickActive
                ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                : 'border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            <Crosshair className="w-3 h-3" />
            <span>{pickActive ? 'Cancel Pick' : 'Pick on Map'}</span>
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-[10px] text-slate-400 mb-0.5">Type</label>
            <select
              value={feedbackType}
              onChange={(e) => setFeedbackType(e.target.value as FeedbackType)}
              className="w-full px-2 py-1 text-[11px] bg-[#0E1522] border border-slate-800 rounded text-slate-100"
            >
              <option value="density_discrepancy">Density Delta</option>
              <option value="drift_offset">Drift Offset</option>
              <option value="routing_suggestion">Route Policy</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 mb-0.5">Lat</label>
            <input
              type="number"
              step="0.01"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              className="w-full px-2 py-1 text-[11px] font-mono bg-[#0E1522] border border-slate-800 rounded text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 mb-0.5">Lon</label>
            <input
              type="number"
              step="0.01"
              value={lon}
              onChange={(e) => setLon(e.target.value)}
              className="w-full px-2 py-1 text-[11px] font-mono bg-[#0E1522] border border-slate-800 rounded text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 mb-0.5">Pred %</label>
            <input
              type="number"
              min="0"
              max="100"
              value={predictedPct}
              onChange={(e) => setPredictedPct(e.target.value)}
              className="w-full px-2 py-1 text-[11px] font-mono bg-[#0E1522] border border-slate-800 rounded text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 mb-0.5">Observed %</label>
            <input
              type="number"
              min="0"
              max="100"
              value={observedPct}
              onChange={(e) => setObservedPct(e.target.value)}
              className="w-full px-2 py-1 text-[11px] font-mono bg-[#0E1522] border border-slate-800 rounded text-slate-100"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as RoutingStrategy)}
            className="px-2 py-1 text-[11px] bg-[#0E1522] border border-slate-800 rounded text-slate-200"
          >
            <option value="balanced">Route: Balanced Yield &amp; Distance</option>
            <option value="max_yield">Route: Maximize Plume Yield</option>
            <option value="min_energy">Route: Minimize Vessel Energy</option>
            <option value="fastest_intercept">Route: Fastest Intercept ETA</option>
          </select>

          <input
            type="text"
            placeholder="Optional vessel/observer notes (e.g. dense macro-plastic filament observed)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="flex-1 min-w-[160px] px-2.5 py-1 text-[11px] bg-[#0E1522] border border-slate-800 rounded text-slate-100 placeholder:text-slate-600"
          />

          <button
            type="submit"
            disabled={submitting}
            className="px-3 py-1 text-[11px] font-semibold rounded bg-cyan-500 text-[#041218] hover:bg-cyan-400 disabled:opacity-50 whitespace-nowrap"
          >
            {submitting ? 'Saving...' : 'Submit Feedback'}
          </button>
        </div>

        {statusMsg && (
          <div className="text-[11px] font-mono text-emerald-300">{statusMsg}</div>
        )}
      </form>

      {/* Right: GNN Fine-Tuning State & Recent Logs */}
      <div className="lg:col-span-5 border border-slate-800 bg-[#070B12] rounded p-3 flex flex-col justify-between gap-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-mono text-[11px] text-amber-300 uppercase">
              GNN &amp; Router Weights · v{weights?.version ?? 1}
            </div>
            <div className="text-[11px] font-mono text-slate-400">
              {records.length} reports ({pendingCount} pending) · Strategy:{' '}
              <span className="text-slate-200">{weights?.routingStrategy ?? 'balanced'}</span>
            </div>
          </div>

          <button
            type="button"
            disabled={tuning || records.length === 0}
            onClick={handleFineTune}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded border border-amber-500/50 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 disabled:opacity-40 whitespace-nowrap"
          >
            <Sparkles className="w-3 h-3" />
            <span>{tuning ? 'Fine-Tuning...' : 'Fine-Tune GNN'}</span>
          </button>
        </div>

        {weights && (
          <div className="grid grid-cols-3 gap-2 text-[11px] font-mono text-slate-300 border-t border-b border-slate-800/80 py-1.5">
            <div>w_conv: {weights.wConvergence}</div>
            <div>w_fdi: {weights.wSentinelFdi}</div>
            <div>mix: {weights.gnnAdvectionMix}</div>
          </div>
        )}

        <div className="max-h-16 overflow-y-auto space-y-1 text-[11px] font-mono">
          {records.length === 0 ? (
            <div className="text-slate-500">No field feedback logged yet.</div>
          ) : (
            records.slice(0, 4).map((r) => (
              <div key={r.id} className="flex items-center justify-between text-slate-400">
                <span className="truncate">
                  {r.feedbackType} ({r.lat.toFixed(2)}, {r.lon.toFixed(2)}) · Obs{' '}
                  {Math.round(r.observedIndex * 100)}%
                </span>
                <span className={r.usedInTraining ? 'text-emerald-400' : 'text-amber-400'}>
                  {r.usedInTraining ? 'Trained' : 'Queued'}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
