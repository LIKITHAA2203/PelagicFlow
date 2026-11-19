import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Code2,
  Crosshair,
  Download,
  Map as MapIcon,
  Pause,
  Play,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import { FeedbackPanel } from './components/FeedbackPanel';
import { FleetPanel } from './components/FleetPanel';
import { ForecastChart } from './components/ForecastChart';
import { OceanMap, type MapPickMode } from './components/OceanMap';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PWAInstallButton } from './components/PWAInstallButton';
import { PyGCodeModal } from './components/PyGCodeModal';
import type {
  AccumulationZone,
  BasemapMode,
  HorizonKey,
  LayerVisibility,
  PredictionResponse,
  VesselClassId,
} from './types/ocean';

const HORIZONS: HorizonKey[] = ['0', '24', '48', '72'];

const DEFAULT_ZONES: AccumulationZone[] = [
  {
    id: 'gpgp',
    name: 'Great Pacific Garbage Patch',
    basin: 'North Pacific Subtropical Gyre',
    latMin: 30.0,
    latMax: 40.0,
    lonMin: -155.0,
    lonMax: -135.0,
    defaultVesselLat: 33.2,
    defaultVesselLon: -149.5,
    description:
      'Primary North Pacific convergence zone bounded by the Kuroshio and California currents.',
  },
];

export default function App() {
  const [zones, setZones] = useState<AccumulationZone[]>(DEFAULT_ZONES);
  const [selectedZoneId, setSelectedZoneId] = useState<string>('gpgp');

  const [latMin, setLatMin] = useState<string>('30');
  const [latMax, setLatMax] = useState<string>('40');
  const [lonMin, setLonMin] = useState<string>('-155');
  const [lonMax, setLonMax] = useState<string>('-135');
  const [gridSize, setGridSize] = useState<number>(6);
  const [leewayPct, setLeewayPct] = useState<string>('2.0');

  const [vesselLat, setVesselLat] = useState<string>('33.2');
  const [vesselLon, setVesselLon] = useState<string>('-149.5');
  const [vesselSpeedKnots, setVesselSpeedKnots] = useState<string>('10');

  const [fleetSize, setFleetSize] = useState<number>(2);
  const [vesselClass, setVesselClass] = useState<VesselClassId>('autonomous_sweeper');
  const [simLoading, setSimLoading] = useState<boolean>(false);

  const [pickMode, setPickMode] = useState<MapPickMode>('none');
  const [feedbackPickedCoords, setFeedbackPickedCoords] = useState<{
    lat: number;
    lon: number;
    predictedIndex?: number;
  } | null>(null);

  const [activeHorizon, setActiveHorizon] = useState<HorizonKey>('24');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [basemap, setBasemap] = useState<BasemapMode>('satellite');
  const [bottomTab, setBottomTab] = useState<
    'waypoints' | 'fleet' | 'chart' | 'feedback' | 'provenance'
  >('waypoints');
  const [mobilePane, setMobilePane] = useState<'map' | 'controls' | 'data'>('map');
  const [selectedWaypointOrder, setSelectedWaypointOrder] = useState<number | null>(null);
  const [codeModalOpen, setCodeModalOpen] = useState<boolean>(false);

  const [layers, setLayers] = useState<LayerVisibility>({
    currents: true,
    sst: true,
    plume: true,
    trajectories: true,
    graph: true,
    route: true,
    sentinel: true,
    detections: true,
    fleet: true,
  });

  const [apiHealth, setApiHealth] = useState<{
    state: 'connecting' | 'online' | 'error';
    label: string;
  }>({ state: 'connecting', label: 'Connecting Open-Meteo' });

  const [prediction, setPrediction] = useState<PredictionResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const runForecast = useCallback(
    async (
      override?: Partial<{
        zoneId: string;
        latMin: number;
        latMax: number;
        lonMin: number;
        lonMax: number;
        gridSize: number;
        vesselLat: number;
        vesselLon: number;
        vesselSpeedKnots: number;
        leewayFactor: number;
        fleetSize: number;
        vesselClass: VesselClassId;
        forceRefresh: boolean;
      }>
    ) => {
      const parsedLeeway = parseFloat(leewayPct);
      const payload = {
        regionId: override?.zoneId ?? selectedZoneId,
        latMin: override?.latMin ?? parseFloat(latMin),
        latMax: override?.latMax ?? parseFloat(latMax),
        lonMin: override?.lonMin ?? parseFloat(lonMin),
        lonMax: override?.lonMax ?? parseFloat(lonMax),
        gridSize: override?.gridSize ?? gridSize,
        vesselLat: override?.vesselLat ?? parseFloat(vesselLat),
        vesselLon: override?.vesselLon ?? parseFloat(vesselLon),
        vesselSpeedKnots: override?.vesselSpeedKnots ?? parseFloat(vesselSpeedKnots),
        leewayFactor:
          override?.leewayFactor ?? (Number.isFinite(parsedLeeway) ? parsedLeeway / 100 : 0.02),
        fleetSize: override?.fleetSize ?? fleetSize,
        vesselClass: override?.vesselClass ?? vesselClass,
        forceRefresh: override?.forceRefresh ?? false,
      };

      if (
        !Number.isFinite(payload.latMin) ||
        !Number.isFinite(payload.latMax) ||
        !Number.isFinite(payload.lonMin) ||
        !Number.isFinite(payload.lonMax) ||
        payload.latMax <= payload.latMin ||
        payload.lonMax <= payload.lonMin
      ) {
        setErrorMsg('Lat Max must exceed Lat Min and Lon Max must exceed Lon Min.');
        return;
      }

      setLoading(true);
      setErrorMsg(null);
      setSelectedWaypointOrder(null);

      try {
        const res = await fetch('/api/predict', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || data.detail || `Server returned ${res.status}`);
        }
        setPrediction(data as PredictionResponse);
        setApiHealth({
          state: 'online',
          label: `Open-Meteo Live · ${data.meta.fetchTimeMs} ms`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Telemetry ingestion failed';
        setErrorMsg(msg);
        setApiHealth({ state: 'error', label: 'Upstream API Error' });
      } finally {
        setLoading(false);
      }
    },
    [
      selectedZoneId,
      latMin,
      latMax,
      lonMin,
      lonMax,
      gridSize,
      vesselLat,
      vesselLon,
      vesselSpeedKnots,
      leewayPct,
      fleetSize,
      vesselClass,
    ]
  );

  useEffect(() => {
    let active = true;

    fetch('/api/health')
      .then((r) => r.json())
      .then((h) => {
        if (!active) return;
        if (h.status === 'online') {
          setApiHealth({
            state: 'online',
            label: `Open-Meteo Live · ${h.latencyMs ?? '—'} ms`,
          });
        } else {
          setApiHealth({ state: 'error', label: h.openMeteoStatus || 'Degraded' });
        }
      })
      .catch(() => {
        if (active) setApiHealth({ state: 'error', label: 'API Unreachable' });
      });

    fetch('/api/regions')
      .then((r) => r.json())
      .then((d) => {
        if (!active || !Array.isArray(d.regions) || d.regions.length === 0) return;
        setZones(d.regions);
        const initial: AccumulationZone = d.regions[0];
        setSelectedZoneId(initial.id);
        setLatMin(String(initial.latMin));
        setLatMax(String(initial.latMax));
        setLonMin(String(initial.lonMin));
        setLonMax(String(initial.lonMax));
        setVesselLat(String(initial.defaultVesselLat));
        setVesselLon(String(initial.defaultVesselLon));
        runForecast({
          zoneId: initial.id,
          latMin: initial.latMin,
          latMax: initial.latMax,
          lonMin: initial.lonMin,
          lonMax: initial.lonMax,
          vesselLat: initial.defaultVesselLat,
          vesselLon: initial.defaultVesselLon,
        });
      })
      .catch(() => {
        if (active) runForecast();
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isPlaying) return;
    const id = window.setInterval(() => {
      setActiveHorizon((prev) => {
        const idx = HORIZONS.indexOf(prev);
        return HORIZONS[(idx + 1) % HORIZONS.length];
      });
    }, 1500);
    return () => window.clearInterval(id);
  }, [isPlaying]);

  const handleZoneChange = (zoneId: string) => {
    setSelectedZoneId(zoneId);
    if (zoneId === 'custom') return;
    const z = zones.find((item) => item.id === zoneId);
    if (!z) return;
    setLatMin(String(z.latMin));
    setLatMax(String(z.latMax));
    setLonMin(String(z.lonMin));
    setLonMax(String(z.lonMax));
    setVesselLat(String(z.defaultVesselLat));
    setVesselLon(String(z.defaultVesselLon));
    runForecast({
      zoneId: z.id,
      latMin: z.latMin,
      latMax: z.latMax,
      lonMin: z.lonMin,
      lonMax: z.lonMax,
      vesselLat: z.defaultVesselLat,
      vesselLon: z.defaultVesselLon,
    });
  };

  const handleMapPickCoordinate = useCallback(
    (lat: number, lon: number, nearestPredicted?: number) => {
      if (pickMode === 'vessel') {
        setVesselLat(String(lat));
        setVesselLon(String(lon));
        setPickMode('none');
        runForecast({ vesselLat: lat, vesselLon: lon });
      } else if (pickMode === 'feedback') {
        setFeedbackPickedCoords({ lat, lon, predictedIndex: nearestPredicted });
        setPickMode('none');
        setBottomTab('feedback');
        setMobilePane('data');
      }
    },
    [pickMode, runForecast]
  );

  const handleRunFleetSimOnly = async (nextSize?: number, nextClass?: VesselClassId) => {
    if (!prediction) return;
    setSimLoading(true);
    try {
      const res = await fetch('/api/simulate-fleet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fleetSize: nextSize ?? fleetSize,
          vesselClass: nextClass ?? vesselClass,
          horizonHours: 72,
          originLat: parseFloat(vesselLat),
          originLon: parseFloat(vesselLon),
          horizons: prediction.horizons,
          waypoints: prediction.vesselRoute.waypoints,
        }),
      });
      if (res.ok) {
        const sim = await res.json();
        setPrediction((prev) => (prev ? { ...prev, fleetSimulation: sim } : prev));
      }
    } finally {
      setSimLoading(false);
    }
  };

  const handleExportGeoJSON = () => {
    if (!prediction) return;
    const snap = prediction.horizons[activeHorizon];
    const features = [
      ...snap.nodes.map((n) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [n.lon, n.lat] },
        properties: {
          kind: 'ocean_gnn_node',
          horizonHours: Number(activeHorizon),
          uCurrentMs: n.u,
          vCurrentMs: n.v,
          speedMs: n.speedMs,
          windSpeedMs: n.windSpeedMs,
          sstC: n.sst,
          waveHeightM: n.waveHeight,
          convergenceIndex: n.convergenceIndex,
          s2FdiScore: n.s2FdiScore,
        },
      })),
      ...prediction.sentinelDetections.map((det) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [det.lon, det.lat] },
        properties: {
          kind: 'sentinel2_fdi_detection',
          fdi: det.fdi,
          ndvi: det.ndvi,
          confidence: det.confidence,
          mgrsTile: det.mgrsTile,
        },
      })),
      ...prediction.trajectories.map((tr) => ({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: tr.points.map((p) => [p.lon, p.lat]),
        },
        properties: {
          kind: 'rk4_drift_trajectory',
          nodeId: tr.nodeId,
          initialConvergence: tr.initialConvergence,
        },
      })),
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [prediction.vesselRoute.origin.lon, prediction.vesselRoute.origin.lat],
            ...prediction.vesselRoute.waypoints.map((w) => [w.lon, w.lat]),
          ],
        },
        properties: {
          kind: 'cleanup_vessel_route',
          totalDistanceNm: prediction.vesselRoute.totalDistanceNm,
          totalEtaHours: prediction.vesselRoute.totalEtaHours,
          meanTargetConvergence: prediction.vesselRoute.meanTargetConvergence,
        },
      },
    ];

    const blob = new Blob(
      [JSON.stringify({ type: 'FeatureCollection', features }, null, 2)],
      { type: 'application/geo+json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pelagicflow_${selectedZoneId}_t${activeHorizon}h.geojson`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeSnapshot = prediction?.horizons[activeHorizon] ?? null;
  const currentZone = zones.find((z) => z.id === selectedZoneId);

  const numericBounds = useMemo(
    () => ({
      latMin: Number.isFinite(parseFloat(latMin)) ? parseFloat(latMin) : 30,
      latMax: Number.isFinite(parseFloat(latMax)) ? parseFloat(latMax) : 40,
      lonMin: Number.isFinite(parseFloat(lonMin)) ? parseFloat(lonMin) : -155,
      lonMax: Number.isFinite(parseFloat(lonMax)) ? parseFloat(lonMax) : -135,
    }),
    [latMin, latMax, lonMin, lonMax]
  );

  const toggleLayer = (key: keyof LayerVisibility) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="h-[100dvh] flex flex-col bg-[#070B12] text-slate-100 overflow-hidden">
      {/* Top Telemetry Ribbon */}
      <header className="h-12 shrink-0 px-3 sm:px-4 lg:px-5 border-b border-slate-800 bg-[#0B111C] flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-base font-semibold tracking-tight text-slate-100 whitespace-nowrap shrink-0">
            PelagicFlow
          </span>
          <span className="hidden sm:inline text-slate-600" aria-hidden="true">
            ·
          </span>
          <span className="hidden sm:inline text-xs text-slate-400 truncate">
            {currentZone ? currentZone.basin : 'Custom Ocean Sector'}
          </span>
          {prediction?.meta.forecastIssuedUtc && (
            <>
              <span className="hidden md:inline text-slate-600" aria-hidden="true">
                ·
              </span>
              <span className="hidden md:inline text-xs font-mono text-slate-400 whitespace-nowrap">
                UTC {prediction.meta.forecastIssuedUtc.replace('T', ' ')} · v{prediction.meta.modelVersion}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <span
            className={`hidden md:inline-flex items-center gap-1.5 text-xs font-mono whitespace-nowrap ${
              apiHealth.state === 'online'
                ? 'text-emerald-400'
                : apiHealth.state === 'error'
                ? 'text-rose-400'
                : 'text-amber-400'
            }`}
          >
            <span aria-hidden="true">
              {apiHealth.state === 'online' ? '●' : apiHealth.state === 'error' ? '✖' : '▲'}
            </span>
            <span>{apiHealth.label}</span>
          </span>

          <div className="hidden sm:flex items-center p-0.5 bg-[#070B12] border border-slate-800 rounded">
            <button
              type="button"
              onClick={() => setBasemap('satellite')}
              className={`px-2.5 py-1 text-xs rounded-sm transition-colors whitespace-nowrap ${
                basemap === 'satellite'
                  ? 'bg-slate-800 text-slate-100 font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Satellite
            </button>
            <button
              type="button"
              onClick={() => setBasemap('dark')}
              className={`px-2.5 py-1 text-xs rounded-sm transition-colors whitespace-nowrap ${
                basemap === 'dark'
                  ? 'bg-slate-800 text-slate-100 font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Dark Chart
            </button>
          </div>

          <PWAInstallButton />

          <button
            type="button"
            onClick={() => setCodeModalOpen(true)}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-slate-700 bg-[#0E1522] text-slate-200 hover:border-cyan-500/60 transition-colors whitespace-nowrap shrink-0"
          >
            <Code2 className="w-3.5 h-3.5 text-cyan-400" />
            <span>PyG Backend</span>
          </button>

          <button
            type="button"
            onClick={handleExportGeoJSON}
            disabled={!prediction}
            aria-label="Export GeoJSON"
            className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 min-h-[36px] text-xs font-medium rounded bg-cyan-500 text-[#041218] hover:bg-cyan-400 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export GeoJSON</span>
            <span className="sm:hidden">GeoJSON</span>
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row pb-14 lg:pb-0">
        {/* Left Control & Parameter Column */}
        <aside
          className={`${
            mobilePane === 'controls' ? 'flex' : 'hidden'
          } lg:flex w-full lg:w-[348px] flex-1 lg:flex-none shrink-0 bg-[#0E1522] border-b lg:border-b-0 lg:border-r border-slate-800 p-4 overflow-y-auto flex-col gap-4`}
        >
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="zone-select" className="text-xs font-medium text-slate-300">
                Accumulation Zone
              </label>
              <span className="text-[11px] font-mono text-slate-500">
                {prediction ? `${prediction.meta.nodeCount}N / ${prediction.meta.edgeCount}E` : '—'}
              </span>
            </div>
            <select
              id="zone-select"
              value={selectedZoneId}
              onChange={(e) => handleZoneChange(e.target.value)}
              className="w-full min-h-[42px] px-3 py-2 text-xs bg-[#070B12] border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-cyan-500"
            >
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
              <option value="custom">Custom Bounding Box</option>
            </select>
            {currentZone && (
              <p className="text-[11px] leading-relaxed text-slate-400">
                {currentZone.description}
              </p>
            )}
          </section>

          <hr className="border-slate-800/80" />

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-300">Bounding Coordinates</span>
              <span className="text-[11px] font-mono text-slate-500">WGS84 (°)</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="lat-min" className="block text-[11px] text-slate-400 mb-1">
                  Lat Min
                </label>
                <input
                  id="lat-min"
                  type="number"
                  step="0.5"
                  value={latMin}
                  onChange={(e) => {
                    setSelectedZoneId('custom');
                    setLatMin(e.target.value);
                  }}
                  className="w-full min-h-[38px] px-2.5 py-1.5 text-xs font-mono bg-[#070B12] border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label htmlFor="lat-max" className="block text-[11px] text-slate-400 mb-1">
                  Lat Max
                </label>
                <input
                  id="lat-max"
                  type="number"
                  step="0.5"
                  value={latMax}
                  onChange={(e) => {
                    setSelectedZoneId('custom');
                    setLatMax(e.target.value);
                  }}
                  className="w-full min-h-[38px] px-2.5 py-1.5 text-xs font-mono bg-[#070B12] border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label htmlFor="lon-min" className="block text-[11px] text-slate-400 mb-1">
                  Lon Min
                </label>
                <input
                  id="lon-min"
                  type="number"
                  step="0.5"
                  value={lonMin}
                  onChange={(e) => {
                    setSelectedZoneId('custom');
                    setLonMin(e.target.value);
                  }}
                  className="w-full min-h-[38px] px-2.5 py-1.5 text-xs font-mono bg-[#070B12] border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label htmlFor="lon-max" className="block text-[11px] text-slate-400 mb-1">
                  Lon Max
                </label>
                <input
                  id="lon-max"
                  type="number"
                  step="0.5"
                  value={lonMax}
                  onChange={(e) => {
                    setSelectedZoneId('custom');
                    setLonMax(e.target.value);
                  }}
                  className="w-full min-h-[38px] px-2.5 py-1.5 text-xs font-mono bg-[#070B12] border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-slate-400">Graph Grid Density</span>
              <div className="flex items-center gap-1 bg-[#070B12] border border-slate-800 rounded p-0.5">
                {[5, 6, 7].map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setGridSize(sz)}
                    className={`px-2.5 py-1 text-[11px] font-mono rounded-sm transition-colors ${
                      gridSize === sz
                        ? 'bg-slate-800 text-cyan-300 font-medium'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {sz}×{sz}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <hr className="border-slate-800/80" />

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-300">Drift Forecast Horizon</span>
              <button
                type="button"
                onClick={() => setIsPlaying((p) => !p)}
                className="inline-flex items-center gap-1 text-[11px] font-mono text-cyan-400 hover:text-cyan-300 py-1"
              >
                {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                <span>{isPlaying ? 'Pause' : 'Animate'}</span>
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1 p-1 bg-[#070B12] border border-slate-800 rounded">
              {HORIZONS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => {
                    setIsPlaying(false);
                    setActiveHorizon(h);
                  }}
                  className={`min-h-[36px] py-1.5 text-xs font-mono rounded-sm transition-colors ${
                    activeHorizon === h
                      ? 'bg-cyan-500 text-[#041218] font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  t+{h}h
                </button>
              ))}
            </div>
          </section>

          <hr className="border-slate-800/80" />

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-300">Geospatial Layers</span>
              <button
                type="button"
                onClick={() => setBasemap((b) => (b === 'satellite' ? 'dark' : 'satellite'))}
                className="sm:hidden text-[11px] font-mono text-cyan-400"
              >
                Map: {basemap === 'satellite' ? 'Satellite' : 'Dark'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              {(
                [
                  ['currents', 'Currents (u/v)'],
                  ['sst', 'Sea Temp (SST)'],
                  ['plume', 'Convergence'],
                  ['trajectories', 'RK4 Drift Paths'],
                  ['graph', 'GNN Graph'],
                  ['route', 'Vessel Route'],
                  ['sentinel', 'S2 Swaths'],
                  ['detections', 'S2 FDI Plumes'],
                  ['fleet', 'Fleet Tracks'],
                ] as Array<[keyof LayerVisibility, string]>
              ).map(([key, label]) => {
                const active = layers[key];
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleLayer(key)}
                    className={`min-h-[36px] px-2.5 py-1 rounded border text-left text-[11px] transition-colors flex items-center justify-between ${
                      active
                        ? 'bg-[#070B12] border-cyan-500/50 text-slate-100'
                        : 'bg-[#070B12]/40 border-slate-800 text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    <span className="truncate">{label}</span>
                    <span
                      className={`font-mono text-[10px] ${
                        active ? 'text-cyan-400' : 'text-slate-600'
                      }`}
                    >
                      {active ? 'ON' : 'OFF'}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <hr className="border-slate-800/80" />

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-300">Vessel &amp; Wind Leeway</span>
              <button
                type="button"
                onClick={() => {
                  setPickMode((m) => (m === 'vessel' ? 'none' : 'vessel'));
                  setMobilePane('map');
                }}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] border transition-colors ${
                  pickMode === 'vessel'
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                    : 'border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                <Crosshair className="w-3 h-3" />
                <span>{pickMode === 'vessel' ? 'Cancel Pick' : 'Pick on Map'}</span>
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="v-lat" className="block text-[11px] text-slate-400 mb-1">
                  Vessel Lat
                </label>
                <input
                  id="v-lat"
                  type="number"
                  step="0.1"
                  value={vesselLat}
                  onChange={(e) => setVesselLat(e.target.value)}
                  className="w-full min-h-[38px] px-2 py-1.5 text-xs font-mono bg-[#070B12] border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label htmlFor="v-lon" className="block text-[11px] text-slate-400 mb-1">
                  Vessel Lon
                </label>
                <input
                  id="v-lon"
                  type="number"
                  step="0.1"
                  value={vesselLon}
                  onChange={(e) => setVesselLon(e.target.value)}
                  className="w-full min-h-[38px] px-2 py-1.5 text-xs font-mono bg-[#070B12] border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label htmlFor="v-spd" className="block text-[11px] text-slate-400 mb-1">
                  Speed (kn)
                </label>
                <input
                  id="v-spd"
                  type="number"
                  min="2"
                  max="30"
                  step="1"
                  value={vesselSpeedKnots}
                  onChange={(e) => setVesselSpeedKnots(e.target.value)}
                  className="w-full min-h-[38px] px-2 py-1.5 text-xs font-mono bg-[#070B12] border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label htmlFor="v-leeway" className="block text-[11px] text-slate-400 mb-1">
                  Wind Leeway (%)
                </label>
                <input
                  id="v-leeway"
                  type="number"
                  min="0"
                  max="6"
                  step="0.5"
                  value={leewayPct}
                  onChange={(e) => setLeewayPct(e.target.value)}
                  className="w-full min-h-[38px] px-2 py-1.5 text-xs font-mono bg-[#070B12] border border-slate-800 rounded text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>
          </section>

          {errorMsg && (
            <div className="p-2.5 rounded border border-rose-500/40 bg-rose-950/30 text-xs text-rose-300">
              {errorMsg}
            </div>
          )}

          <div className="mt-auto pt-2 flex flex-col gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                runForecast({ forceRefresh: true });
                setMobilePane('map');
              }}
              className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold rounded bg-cyan-500 text-[#041218] hover:bg-cyan-400 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>{loading ? 'Ingesting Telemetry...' : 'Run GNN Forecast'}</span>
            </button>
            <button
              type="button"
              onClick={() => setCodeModalOpen(true)}
              className="sm:hidden w-full min-h-[40px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-slate-700 bg-[#070B12] text-slate-200"
            >
              <Code2 className="w-3.5 h-3.5 text-cyan-400" />
              <span>View Python PyG Codebase</span>
            </button>
          </div>
        </aside>

        {/* Right Map Viewport + Bottom Telemetry Tray */}
        <main
          className={`${
            mobilePane !== 'controls' ? 'flex' : 'hidden'
          } lg:flex flex-1 min-w-0 min-h-0 flex-col`}
        >
          <div
            className={`${
              mobilePane === 'map' ? 'flex' : 'hidden'
            } lg:flex flex-1 min-h-0 flex-col relative`}
          >
            <div className="lg:hidden absolute top-3 left-3 z-[500] flex items-center gap-1 bg-[#070B12]/90 border border-slate-800 rounded p-1">
              {HORIZONS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => {
                    setIsPlaying(false);
                    setActiveHorizon(h);
                  }}
                  className={`px-2.5 py-1.5 min-h-[34px] text-[11px] font-mono rounded-sm transition-colors ${
                    activeHorizon === h
                      ? 'bg-cyan-500 text-[#041218] font-semibold'
                      : 'text-slate-300'
                  }`}
                >
                  {h}h
                </button>
              ))}
            </div>

            <OceanMap
              prediction={prediction}
              activeHorizon={activeHorizon}
              layers={layers}
              basemap={basemap}
              bounds={numericBounds}
              pickMode={pickMode}
              loading={loading}
              selectedWaypointOrder={selectedWaypointOrder}
              onPickCoordinate={handleMapPickCoordinate}
              onSelectWaypoint={(order) => setSelectedWaypointOrder(order)}
              onSyncNow={() => runForecast({ forceRefresh: true })}
            />
          </div>

          <section
            className={`${
              mobilePane === 'data' ? 'flex flex-1' : 'hidden'
            } lg:flex lg:flex-none shrink-0 lg:h-[268px] bg-[#0B111C] border-t border-slate-800 flex-col min-h-0`}
          >
            <div className="px-4 py-2 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
                <div>
                  <span className="text-slate-500 mr-1.5">Current</span>
                  <span className="text-cyan-300 font-semibold">
                    {activeSnapshot ? `${activeSnapshot.meanSpeedMs.toFixed(3)} m/s` : '—'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 mr-1.5">Wind</span>
                  <span className="text-slate-200 font-semibold">
                    {activeSnapshot ? `${activeSnapshot.meanWindMs.toFixed(1)} m/s` : '—'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 mr-1.5">SST</span>
                  <span className="text-slate-100 font-semibold">
                    {activeSnapshot ? `${activeSnapshot.meanSstC.toFixed(2)} °C` : '—'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 mr-1.5">S2 FDI</span>
                  <span className="text-rose-300 font-semibold">
                    {prediction ? `${prediction.meta.sentinelDetectionCount} zones` : '—'}
                  </span>
                </div>
                <div className="hidden xl:block">
                  <span className="text-slate-500 mr-1.5">Fleet Capture</span>
                  <span className="text-emerald-300 font-semibold">
                    {prediction
                      ? `${prediction.fleetSimulation.summary.cleanupSuccessRatePct}% (${prediction.fleetSimulation.summary.totalCapturedKg} kg)`
                      : '—'}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1 p-0.5 bg-[#070B12] border border-slate-800 rounded">
                {(
                  [
                    ['waypoints', 'Waypoints'],
                    ['fleet', 'Fleet Sim'],
                    ['chart', '72h Flow'],
                    ['feedback', 'Feedback & Tune'],
                    ['provenance', 'Provenance'],
                  ] as const
                ).map(([tabKey, label]) => (
                  <button
                    key={tabKey}
                    type="button"
                    onClick={() => setBottomTab(tabKey)}
                    className={`px-2.5 py-1 text-xs rounded-sm transition-colors whitespace-nowrap ${
                      bottomTab === tabKey
                        ? 'bg-slate-800 text-slate-100 font-medium'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto px-4 py-2.5">
              {!prediction ? (
                <div className="h-full flex items-center justify-center text-xs font-mono text-slate-400 py-8">
                  {loading
                    ? 'Ingesting Open-Meteo currents, 10m winds, Sentinel-2 L2A COG spectral bands & running fleet sim...'
                    : 'No telemetry loaded. Click Run GNN Forecast.'}
                </div>
              ) : bottomTab === 'waypoints' ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs font-mono">
                    <thead>
                      <tr className="border-b border-slate-800 text-[11px] text-slate-400 uppercase tracking-wider">
                        <th className="py-1.5 pr-4 font-medium">Waypoint</th>
                        <th className="py-1.5 pr-4 font-medium">Window</th>
                        <th className="py-1.5 pr-4 font-medium">Latitude</th>
                        <th className="py-1.5 pr-4 font-medium">Longitude</th>
                        <th className="py-1.5 pr-4 font-medium">Convergence</th>
                        <th className="py-1.5 pr-4 font-medium">Leg / Brg</th>
                        <th className="py-1.5 font-medium">ETA</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {prediction.vesselRoute.waypoints.map((wp) => {
                        const isSelected = selectedWaypointOrder === wp.order;
                        return (
                          <tr
                            key={wp.order}
                            onClick={() => {
                              setSelectedWaypointOrder(wp.order);
                              setMobilePane('map');
                            }}
                            className={`cursor-pointer transition-colors ${
                              isSelected ? 'bg-cyan-500/10' : 'hover:bg-slate-800/40'
                            }`}
                          >
                            <td className="py-2 pr-4 font-semibold text-amber-300">
                              WP #{wp.order}
                            </td>
                            <td className="py-2 pr-4 text-slate-300">t+{wp.horizonHour}h</td>
                            <td className="py-2 pr-4 text-slate-200">{wp.lat.toFixed(4)}°</td>
                            <td className="py-2 pr-4 text-slate-200">{wp.lon.toFixed(4)}°</td>
                            <td className="py-2 pr-4 text-amber-300">
                              {(wp.convergenceIndex * 100).toFixed(1)}%
                            </td>
                            <td className="py-2 pr-4 text-cyan-300">
                              {wp.legDistanceNm} nm · {wp.bearingDeg}°
                            </td>
                            <td className="py-2 text-slate-100">{wp.etaHours} hrs</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : bottomTab === 'fleet' ? (
                <FleetPanel
                  simulation={prediction.fleetSimulation}
                  fleetSize={fleetSize}
                  vesselClass={vesselClass}
                  loading={simLoading}
                  onChangeFleetSize={(sz) => {
                    setFleetSize(sz);
                    handleRunFleetSimOnly(sz, vesselClass);
                  }}
                  onChangeVesselClass={(vc) => {
                    setVesselClass(vc);
                    handleRunFleetSimOnly(fleetSize, vc);
                  }}
                  onRunSimulation={() => handleRunFleetSimOnly()}
                />
              ) : bottomTab === 'chart' ? (
                <ForecastChart
                  prediction={prediction}
                  activeHorizon={activeHorizon}
                  onSelectHorizon={(h) => {
                    setIsPlaying(false);
                    setActiveHorizon(h);
                  }}
                />
              ) : bottomTab === 'feedback' ? (
                <FeedbackPanel
                  regionId={selectedZoneId}
                  pickedCoords={feedbackPickedCoords}
                  pickActive={pickMode === 'feedback'}
                  onTogglePickMode={() => {
                    setPickMode((m) => (m === 'feedback' ? 'none' : 'feedback'));
                    if (pickMode !== 'feedback') setMobilePane('map');
                  }}
                  onModelFineTuned={() => runForecast({ forceRefresh: false })}
                />
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs leading-relaxed">
                  <div className="border border-slate-800 bg-[#070B12] rounded p-3 space-y-1.5">
                    <div className="font-mono text-[11px] text-cyan-300 uppercase">
                      Live Multi-Sensor Ingestion
                    </div>
                    <ul className="text-slate-300 space-y-1">
                      <li>· Currents, SST &amp; Waves: Open-Meteo Marine (Mercator)</li>
                      <li>· 10m Wind Leeway ({(prediction.meta.leewayFactor * 100).toFixed(1)}%): Open-Meteo Forecast</li>
                      <li>· Sentinel-2 L2A COG Bands (B04/B06/B08/B11/SCL): {prediction.meta.sentinelSceneCount} swaths, {prediction.meta.sentinelDetectionCount} FDI zones</li>
                    </ul>
                  </div>
                  <div className="border border-slate-800 bg-[#070B12] rounded p-3 space-y-1.5">
                    <div className="font-mono text-[11px] text-amber-300 uppercase">
                      GNN Fusion &amp; Fleet Physics
                    </div>
                    <ul className="text-slate-300 space-y-1">
                      <li>· Model Version: v{prediction.meta.modelVersion} ({prediction.meta.routingStrategy} routing)</li>
                      <li>· Cloud-free water sampled: {(prediction.meta.cloudFreeWaterRatio * 100).toFixed(1)}%</li>
                      <li>· 72h Fleet Capture: {prediction.fleetSimulation.summary.totalCapturedKg} kg · ${prediction.fleetSimulation.summary.totalOperationalCostUsd.toLocaleString()}</li>
                    </ul>
                  </div>
                  <div className="border border-slate-800 bg-[#070B12] rounded p-3 space-y-1.5">
                    <div className="font-mono text-[11px] text-slate-300 uppercase">
                      Calibration &amp; Feedback Loop
                    </div>
                    <p className="text-slate-400">
                      Sentinel-2 spectral FDI detections are spatially aligned onto ocean current graph nodes. Field observations logged in Feedback &amp; Tune update GNN fusion weights and routing penalties both on demand and on the 5-minute periodic loop.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>
        </main>
      </div>

      {/* Mobile Fixed Thumb-Zone Bottom Tab Bar */}
      <nav
        aria-label="Mobile Navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-[900] h-14 bg-[#0B111C]/95 backdrop-blur-md border-t border-slate-800 grid grid-cols-3 items-center"
      >
        <button
          type="button"
          onClick={() => setMobilePane('map')}
          className={`h-full min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
            mobilePane === 'map' ? 'text-cyan-400' : 'text-slate-400'
          }`}
        >
          <MapIcon className="w-5 h-5" />
          <span>Map</span>
        </button>
        <button
          type="button"
          onClick={() => setMobilePane('controls')}
          className={`h-full min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
            mobilePane === 'controls' ? 'text-cyan-400' : 'text-slate-400'
          }`}
        >
          <SlidersHorizontal className="w-5 h-5" />
          <span>Controls</span>
        </button>
        <button
          type="button"
          onClick={() => setMobilePane('data')}
          className={`h-full min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
            mobilePane === 'data' ? 'text-cyan-400' : 'text-slate-400'
          }`}
        >
          <Activity className="w-5 h-5" />
          <span>Telemetry</span>
        </button>
      </nav>

      <OfflineIndicator />
      <PyGCodeModal open={codeModalOpen} onClose={() => setCodeModalOpen(false)} />
    </div>
  );
}
