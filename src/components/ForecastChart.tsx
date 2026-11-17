import { useState } from 'react';
import type { HorizonKey, PredictionResponse } from '../types/ocean';

interface ForecastChartProps {
  prediction: PredictionResponse;
  activeHorizon: HorizonKey;
  onSelectHorizon: (h: HorizonKey) => void;
}

const HORIZONS: HorizonKey[] = ['0', '24', '48', '72'];

export function ForecastChart({
  prediction,
  activeHorizon,
  onSelectHorizon,
}: ForecastChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const series = HORIZONS.map((h) => {
    const snap = prediction.horizons[h];
    return {
      horizon: h,
      speedMs: snap?.meanSpeedMs ?? 0,
      windMs: snap?.meanWindMs ?? 0,
      peakConv: (snap?.peakConvergence ?? 0) * 100,
      waveM: snap?.meanWaveM ?? 0,
      sstC: snap?.meanSstC ?? 0,
    };
  });

  const width = 640;
  const height = 148;
  const padL = 44;
  const padR = 44;
  const padT = 16;
  const padB = 26;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const maxSpeed = Math.max(0.4, ...series.map((s) => s.speedMs * 1.25));
  const maxConv = 100;

  const xPos = (idx: number) => padL + (idx / (series.length - 1)) * plotW;
  const ySpeed = (val: number) => padT + plotH - (val / maxSpeed) * plotH;
  const yConv = (val: number) => padT + plotH - (val / maxConv) * plotH;

  const speedPath = series
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i).toFixed(1)} ${ySpeed(pt.speedMs).toFixed(1)}`)
    .join(' ');

  const convPath = series
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i).toFixed(1)} ${yConv(pt.peakConv).toFixed(1)}`)
    .join(' ');

  const focusIdx =
    hoverIdx !== null ? hoverIdx : HORIZONS.indexOf(activeHorizon);
  const focusPt = series[Math.max(0, focusIdx)];

  return (
    <div className="flex flex-col lg:flex-row items-stretch gap-4 h-full">
      <div className="flex-1 min-w-0">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-[142px] overflow-visible select-none"
          role="img"
          aria-label="72-hour ocean flow speed and peak convergence index forecast"
        >
          {[0, 0.5, 1].map((frac) => {
            const y = padT + plotH * (1 - frac);
            return (
              <g key={frac}>
                <line
                  x1={padL}
                  y1={y}
                  x2={width - padR}
                  y2={y}
                  stroke="#1E293B"
                  strokeDasharray="3,3"
                />
                <text
                  x={padL - 8}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-slate-500 text-[10px] font-mono"
                >
                  {(maxSpeed * frac).toFixed(2)}
                </text>
                <text
                  x={width - padR + 8}
                  y={y + 3}
                  textAnchor="start"
                  className="fill-amber-500/80 text-[10px] font-mono"
                >
                  {Math.round(maxConv * frac)}%
                </text>
              </g>
            );
          })}

          <text x={padL} y={10} className="fill-cyan-400 text-[9px] font-mono">
            MEAN CURRENT (m/s)
          </text>
          <text
            x={width - padR}
            y={10}
            textAnchor="end"
            className="fill-amber-400 text-[9px] font-mono"
          >
            PEAK CONVERGENCE (%)
          </text>

          <line
            x1={xPos(focusIdx)}
            y1={padT}
            x2={xPos(focusIdx)}
            y2={padT + plotH}
            stroke="#334155"
            strokeWidth={1}
          />

          <path d={speedPath} fill="none" stroke="#06B6D4" strokeWidth={2} />
          <path d={convPath} fill="none" stroke="#F59E0B" strokeWidth={2} />

          {series.map((pt, i) => {
            const cx = xPos(i);
            const isActive = pt.horizon === activeHorizon;
            return (
              <g
                key={pt.horizon}
                className="cursor-pointer"
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
                onClick={() => onSelectHorizon(pt.horizon)}
              >
                <rect
                  x={cx - 28}
                  y={padT}
                  width={56}
                  height={plotH + padB}
                  fill="transparent"
                />
                <circle
                  cx={cx}
                  cy={ySpeed(pt.speedMs)}
                  r={isActive ? 4.5 : 3.2}
                  fill="#070B12"
                  stroke="#06B6D4"
                  strokeWidth={2}
                />
                <circle
                  cx={cx}
                  cy={yConv(pt.peakConv)}
                  r={isActive ? 4.5 : 3.2}
                  fill="#070B12"
                  stroke="#F59E0B"
                  strokeWidth={2}
                />
                <text
                  x={cx}
                  y={height - 6}
                  textAnchor="middle"
                  className={`text-[11px] font-mono ${
                    isActive ? 'fill-slate-100 font-semibold' : 'fill-slate-400'
                  }`}
                >
                  t+{pt.horizon}h
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="w-full lg:w-[275px] shrink-0 border border-slate-800 bg-[#070B12] rounded p-3 flex flex-col justify-between">
        <div className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
          Horizon Frame · t+{focusPt.horizon}h
        </div>
        <div className="grid grid-cols-2 gap-y-2 gap-x-3 mt-2 text-xs font-mono">
          <div>
            <div className="text-[10px] text-slate-500">Current Speed</div>
            <div className="text-cyan-300 font-semibold">{focusPt.speedMs.toFixed(3)} m/s</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500">Convergence</div>
            <div className="text-amber-300 font-semibold">{focusPt.peakConv.toFixed(1)} %</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500">10m Wind / Wave</div>
            <div className="text-slate-200">
              {focusPt.windMs.toFixed(1)} m/s · {focusPt.waveM.toFixed(2)} m
            </div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500">Mean SST</div>
            <div className="text-slate-200">{focusPt.sstC.toFixed(2)} °C</div>
          </div>
        </div>
      </div>
    </div>
  );
}
