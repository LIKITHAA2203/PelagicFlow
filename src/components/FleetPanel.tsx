import type { FleetSimulationResult, VesselClassId } from '../types/ocean';

interface FleetPanelProps {
  simulation: FleetSimulationResult;
  fleetSize: number;
  vesselClass: VesselClassId;
  loading: boolean;
  onChangeFleetSize: (size: number) => void;
  onChangeVesselClass: (vc: VesselClassId) => void;
  onRunSimulation: () => void;
}

export function FleetPanel({
  simulation,
  fleetSize,
  vesselClass,
  loading,
  onChangeFleetSize,
  onChangeVesselClass,
  onRunSimulation,
}: FleetPanelProps) {
  const { summary, vessels } = simulation;

  return (
    <div className="space-y-3">
      {/* Fleet Controls & Summary KPIs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            <label htmlFor="fleet-size" className="text-slate-400">
              Fleet
            </label>
            <select
              id="fleet-size"
              value={fleetSize}
              onChange={(e) => onChangeFleetSize(Number(e.target.value))}
              className="px-2 py-1 text-xs font-mono bg-[#070B12] border border-slate-800 rounded text-slate-100"
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} USV{n > 1 ? 's' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <label htmlFor="vessel-class" className="text-slate-400">
              Class
            </label>
            <select
              id="vessel-class"
              value={vesselClass}
              onChange={(e) => onChangeVesselClass(e.target.value as VesselClassId)}
              className="px-2 py-1 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100"
            >
              <option value="solar_catamaran">Solar-Hybrid Catamaran (8 kn)</option>
              <option value="autonomous_sweeper">Autonomous Ocean Sweeper (11 kn)</option>
              <option value="heavy_collector">Gyre High-Capacity Collector (14 kn)</option>
            </select>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={onRunSimulation}
            className="px-3 py-1 text-xs font-medium rounded bg-emerald-500/15 border border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Simulating...' : 'Run 72h Fleet Sim'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
          <div>
            <span className="text-slate-500 mr-1.5">Success</span>
            <strong className="text-emerald-300">{summary.cleanupSuccessRatePct}%</strong>
          </div>
          <div>
            <span className="text-slate-500 mr-1.5">Captured</span>
            <strong className="text-amber-300">{summary.totalCapturedKg} kg</strong>
          </div>
          <div>
            <span className="text-slate-500 mr-1.5">Energy</span>
            <strong className="text-cyan-300">{summary.totalEnergyKwh} kWh</strong>
          </div>
          <div>
            <span className="text-slate-500 mr-1.5">Op Cost</span>
            <strong className="text-slate-100">
              ${summary.totalOperationalCostUsd.toLocaleString()} (${summary.costPerKgUsd}/kg)
            </strong>
          </div>
        </div>
      </div>

      {/* Per-Vessel Telemetry Breakdown */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs font-mono">
          <thead>
            <tr className="border-b border-slate-800 text-[11px] text-slate-400 uppercase tracking-wider">
              <th className="py-1.5 pr-4 font-medium">Vessel</th>
              <th className="py-1.5 pr-4 font-medium">Class</th>
              <th className="py-1.5 pr-4 font-medium">Assigned WPs</th>
              <th className="py-1.5 pr-4 font-medium">Distance</th>
              <th className="py-1.5 pr-4 font-medium">Wave Capture Eff</th>
              <th className="py-1.5 pr-4 font-medium">Captured</th>
              <th className="py-1.5 pr-4 font-medium">Energy</th>
              <th className="py-1.5 font-medium">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {vessels.map((v) => (
              <tr key={v.vesselId} className="hover:bg-slate-800/30">
                <td className="py-1.5 pr-4 font-semibold text-emerald-300">{v.vesselId}</td>
                <td className="py-1.5 pr-4 text-slate-300">{v.vesselClass}</td>
                <td className="py-1.5 pr-4 text-slate-400">
                  {v.assignedWaypoints.length > 0
                    ? v.assignedWaypoints.map((id) => `#${id}`).join(', ')
                    : 'Patrol'}
                </td>
                <td className="py-1.5 pr-4 text-slate-200">{v.distanceNm} nm</td>
                <td className="py-1.5 pr-4 text-cyan-300">{v.meanCaptureEfficiencyPct}%</td>
                <td className="py-1.5 pr-4 text-amber-300">{v.capturedPlasticKg} kg</td>
                <td className="py-1.5 pr-4 text-slate-200">{v.energyUsedKwh} kWh</td>
                <td className="py-1.5 text-slate-100">${v.operationalCostUsd.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
