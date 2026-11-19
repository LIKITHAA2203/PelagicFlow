import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Radio, RefreshCw } from 'lucide-react';
import type {
  BasemapMode,
  HorizonKey,
  LayerVisibility,
  PredictionResponse,
} from '../types/ocean';

export type MapPickMode = 'none' | 'vessel' | 'feedback';

interface OceanMapProps {
  prediction: PredictionResponse | null;
  activeHorizon: HorizonKey;
  layers: LayerVisibility;
  basemap: BasemapMode;
  bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number };
  pickMode: MapPickMode;
  loading: boolean;
  selectedWaypointOrder: number | null;
  onPickCoordinate: (lat: number, lon: number, nearestPredicted?: number) => void;
  onSelectWaypoint: (order: number) => void;
  onSyncNow: () => void;
}

function formatDataAge(ageSeconds: number): string {
  const s = Math.max(0, Math.floor(ageSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m < 60) return `${m}m ${String(remS).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${String(remM).padStart(2, '0')}m`;
}

const FLEET_COLORS = ['#34D399', '#A78BFA', '#F472B6', '#38BDF8'];

function sstToColor(sst: number): string {
  const t = Math.max(0, Math.min(1, (sst - 10) / 20));
  if (t < 0.33) {
    const k = t / 0.33;
    const r = Math.round(14 + k * 8);
    const g = Math.round(74 + k * 90);
    const b = Math.round(168 + k * 44);
    return `rgb(${r}, ${g}, ${b})`;
  }
  if (t < 0.66) {
    const k = (t - 0.33) / 0.33;
    const r = Math.round(22 + k * 212);
    const g = Math.round(164 + k * 24);
    const b = Math.round(212 - k * 140);
    return `rgb(${r}, ${g}, ${b})`;
  }
  const k = (t - 0.66) / 0.34;
  const r = Math.round(234 + k * 16);
  const g = Math.round(188 - k * 96);
  const b = Math.round(72 - k * 28);
  return `rgb(${r}, ${g}, ${b})`;
}

function convergenceToColor(c: number): string {
  if (c >= 0.72) return '#F59E0B';
  if (c >= 0.5) return '#FBBF24';
  if (c >= 0.32) return '#22D3EE';
  return '#0EA5E9';
}

export function OceanMap({
  prediction,
  activeHorizon,
  layers,
  basemap,
  bounds,
  pickMode,
  loading,
  selectedWaypointOrder,
  onPickCoordinate,
  onSelectWaypoint,
  onSyncNow,
}: OceanMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const sstLayerRef = useRef<L.LayerGroup | null>(null);
  const sentinelLayerRef = useRef<L.LayerGroup | null>(null);
  const detectionLayerRef = useRef<L.LayerGroup | null>(null);
  const graphLayerRef = useRef<L.LayerGroup | null>(null);
  const plumeLayerRef = useRef<L.LayerGroup | null>(null);
  const trajectoryLayerRef = useRef<L.LayerGroup | null>(null);
  const currentLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const fleetLayerRef = useRef<L.LayerGroup | null>(null);
  const bboxLayerRef = useRef<L.LayerGroup | null>(null);
  const lastBoundsKeyRef = useRef<string>('');

  const [cursorCoords, setCursorCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [ingestBurstKey, setIngestBurstKey] = useState<number>(0);
  const [ingestBurstActive, setIngestBurstActive] = useState<boolean>(false);
  const lastIngestSigRef = useRef<string>('');
  const pickModeRef = useRef<MapPickMode>(pickMode);
  const onPickRef = useRef(onPickCoordinate);
  const predictionRef = useRef(prediction);
  const activeHorizonRef = useRef(activeHorizon);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!prediction) return;
    const sig = `${prediction.meta.ingestedAtUtc}|${prediction.meta.sentinelDetectionCount}|${prediction.meta.modelVersion}`;
    if (sig !== lastIngestSigRef.current) {
      lastIngestSigRef.current = sig;
      setNowMs(Date.now());
      setIngestBurstKey((k) => k + 1);
      setIngestBurstActive(true);
      const timer = window.setTimeout(() => setIngestBurstActive(false), 3200);
      return () => window.clearTimeout(timer);
    }
  }, [prediction]);

  useEffect(() => {
    pickModeRef.current = pickMode;
  }, [pickMode]);

  useEffect(() => {
    onPickRef.current = onPickCoordinate;
  }, [onPickCoordinate]);

  useEffect(() => {
    predictionRef.current = prediction;
    activeHorizonRef.current = activeHorizon;
  }, [prediction, activeHorizon]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [(bounds.latMin + bounds.latMax) / 2, (bounds.lonMin + bounds.lonMax) / 2],
      zoom: 5,
      minZoom: 2,
      maxZoom: 12,
      zoomControl: false,
      worldCopyJump: true,
    });

    L.control.zoom({ position: 'topright' }).addTo(map);

    sstLayerRef.current = L.layerGroup().addTo(map);
    sentinelLayerRef.current = L.layerGroup().addTo(map);
    graphLayerRef.current = L.layerGroup().addTo(map);
    bboxLayerRef.current = L.layerGroup().addTo(map);
    plumeLayerRef.current = L.layerGroup().addTo(map);
    detectionLayerRef.current = L.layerGroup().addTo(map);
    trajectoryLayerRef.current = L.layerGroup().addTo(map);
    currentLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    fleetLayerRef.current = L.layerGroup().addTo(map);

    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      setCursorCoords({ lat: e.latlng.lat, lon: e.latlng.lng });
    });

    map.on('mouseout', () => {
      setCursorCoords(null);
    });

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (pickModeRef.current === 'none') return;
      const lat = Number(e.latlng.lat.toFixed(3));
      const lon = Number(e.latlng.lng.toFixed(3));
      let nearestConv: number | undefined;
      const snap = predictionRef.current?.horizons[activeHorizonRef.current];
      if (snap && snap.nodes.length > 0) {
        let bestD = Infinity;
        for (const n of snap.nodes) {
          const d = (n.lat - lat) ** 2 + (n.lon - lon) ** 2;
          if (d < bestD) {
            bestD = d;
            nearestConv = n.convergenceIndex;
          }
        }
      }
      onPickRef.current(lat, lon, nearestConv);
    });

    mapRef.current = map;

    const ro = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    const tileUrl =
      basemap === 'satellite'
        ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
        : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

    const attribution =
      basemap === 'satellite'
        ? 'Tiles &copy; Esri &mdash; Maxar | Ocean: Open-Meteo &amp; Sentinel-2 L2A'
        : '&copy; OpenStreetMap &copy; CARTO | Ocean: Open-Meteo &amp; Sentinel-2 L2A';

    tileLayerRef.current = L.tileLayer(tileUrl, {
      attribution,
      maxZoom: 18,
    }).addTo(map);
    tileLayerRef.current.bringToBack();
  }, [basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const key = `${bounds.latMin}:${bounds.latMax}:${bounds.lonMin}:${bounds.lonMax}`;
    if (key !== lastBoundsKeyRef.current) {
      lastBoundsKeyRef.current = key;
      map.fitBounds(
        [
          [bounds.latMin - 1.2, bounds.lonMin - 1.2],
          [bounds.latMax + 1.2, bounds.lonMax + 1.2],
        ],
        { animate: true, duration: 0.45 }
      );
    }

    if (bboxLayerRef.current) {
      bboxLayerRef.current.clearLayers();
      L.rectangle(
        [
          [bounds.latMin, bounds.lonMin],
          [bounds.latMax, bounds.lonMax],
        ],
        {
          color: '#334155',
          weight: 1,
          dashArray: '4,4',
          fill: false,
          interactive: false,
        }
      ).addTo(bboxLayerRef.current);
    }
  }, [bounds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !prediction || selectedWaypointOrder === null) return;
    const wp = prediction.vesselRoute.waypoints.find((w) => w.order === selectedWaypointOrder);
    if (wp) {
      map.panTo([wp.lat, wp.lon], { animate: true, duration: 0.35 });
    }
  }, [selectedWaypointOrder, prediction]);

  useEffect(() => {
    const sstGrp = sstLayerRef.current;
    const s2Grp = sentinelLayerRef.current;
    const detGrp = detectionLayerRef.current;
    const graphGrp = graphLayerRef.current;
    const plumeGrp = plumeLayerRef.current;
    const trajGrp = trajectoryLayerRef.current;
    const curGrp = currentLayerRef.current;
    const routeGrp = routeLayerRef.current;
    const fleetGrp = fleetLayerRef.current;

    if (
      !sstGrp ||
      !s2Grp ||
      !detGrp ||
      !graphGrp ||
      !plumeGrp ||
      !trajGrp ||
      !curGrp ||
      !routeGrp ||
      !fleetGrp
    ) {
      return;
    }

    sstGrp.clearLayers();
    s2Grp.clearLayers();
    detGrp.clearLayers();
    graphGrp.clearLayers();
    plumeGrp.clearLayers();
    trajGrp.clearLayers();
    curGrp.clearLayers();
    routeGrp.clearLayers();
    fleetGrp.clearLayers();

    if (!prediction) return;
    const snapshot = prediction.horizons[activeHorizon];
    if (!snapshot) return;

    const nodes = snapshot.nodes;
    const nodeById = new Map(nodes.map((n) => [n.id, n]));

    // 1. SST Thermal Field
    if (layers.sst) {
      const latSpan = Math.max(0.4, (bounds.latMax - bounds.latMin) / 11);
      const lonSpan = Math.max(0.4, (bounds.lonMax - bounds.lonMin) / 11);
      nodes.forEach((n) => {
        const color = sstToColor(n.sst);
        L.rectangle(
          [
            [n.gridLat - latSpan, n.gridLon - lonSpan],
            [n.gridLat + latSpan, n.gridLon + lonSpan],
          ],
          {
            color,
            weight: 0.5,
            opacity: 0.35,
            fillColor: color,
            fillOpacity: 0.28,
          }
        )
          .bindTooltip(
            `Node #${n.id} · SST ${n.sst.toFixed(1)} °C · Wave ${n.waveHeight.toFixed(2)} m · S2 FDI ${(n.s2FdiScore * 100).toFixed(0)}%`
          )
          .addTo(sstGrp);
      });
    }

    // 2. Sentinel-2 L2A STAC Swath Footprints
    if (layers.sentinel && prediction.sentinelScenes.length > 0) {
      prediction.sentinelScenes.forEach((sc) => {
        const ring = sc.coordinates[0];
        if (!ring || ring.length < 3) return;
        const latLngs: [number, number][] = ring.map(([lon, lat]) => [lat, lon]);
        L.polygon(latLngs, {
          color: '#A78BFA',
          weight: 1.2,
          dashArray: '4,3',
          fillColor: '#A78BFA',
          fillOpacity: 0.06,
        })
          .bindTooltip(
            `Sentinel-2 L2A (${sc.mgrsTile}) · ${sc.datetime.slice(0, 16)}Z · Cloud ${sc.cloudCover}%`
          )
          .addTo(s2Grp);
      });
    }

    // 3. Sentinel-2 Spectral FDI Detection Zones
    if (layers.detections && prediction.sentinelDetections?.length > 0) {
      prediction.sentinelDetections.forEach((det) => {
        L.circleMarker([det.lat, det.lon], {
          radius: 4 + det.confidence * 5,
          color: '#FB7185',
          weight: 1.4,
          fillColor: '#F43F5E',
          fillOpacity: 0.55,
        })
          .bindTooltip(
            `S2 Spectral FDI ${det.fdi.toFixed(4)} · NDVI ${det.ndvi.toFixed(2)} · Conf ${(det.confidence * 100).toFixed(0)}% (${det.mgrsTile})`
          )
          .addTo(detGrp);
      });
    }

    // 4. GNN Spatial Graph Topology Edges
    if (layers.graph) {
      prediction.graphEdges.forEach((e) => {
        const src = nodeById.get(e.source);
        const dst = nodeById.get(e.target);
        if (!src || !dst) return;
        L.polyline(
          [
            [src.lat, src.lon],
            [dst.lat, dst.lon],
          ],
          {
            color: '#38BDF8',
            weight: 0.9,
            opacity: Math.min(0.45, 0.14 + e.weight * 0.18),
            interactive: false,
          }
        ).addTo(graphGrp);
      });
    }

    // 5. Convergence / Plume Concentration Nodes
    if (layers.plume) {
      nodes.forEach((n) => {
        const cColor = convergenceToColor(n.convergenceIndex);
        const radius = 5 + n.convergenceIndex * 18;
        L.circleMarker([n.lat, n.lon], {
          radius,
          color: cColor,
          weight: 1.25,
          opacity: 0.85,
          fillColor: cColor,
          fillOpacity: 0.25 + n.convergenceIndex * 0.28,
        })
          .bindTooltip(
            `Convergence ${(n.convergenceIndex * 100).toFixed(1)}% · S2 FDI ${(n.s2FdiScore * 100).toFixed(0)}% · Flow ${n.speedMs.toFixed(2)} m/s · SST ${n.sst.toFixed(1)}°C`
          )
          .addTo(plumeGrp);
      });
    }

    // 6. RK4 Drift Trajectories
    if (layers.trajectories) {
      const targetHour = Number(activeHorizon);
      prediction.trajectories.forEach((tr) => {
        const visiblePts =
          targetHour === 0 ? tr.points : tr.points.filter((p) => p.hour <= targetHour);
        const ptsToDraw = visiblePts.length >= 2 ? visiblePts : tr.points;
        L.polyline(
          ptsToDraw.map((p): [number, number] => [p.lat, p.lon]),
          {
            color: '#F59E0B',
            weight: 1.8,
            opacity: 0.72,
          }
        ).addTo(trajGrp);

        const tip = ptsToDraw[ptsToDraw.length - 1];
        if (tip) {
          L.circleMarker([tip.lat, tip.lon], {
            radius: 3,
            color: '#FBBF24',
            fillColor: '#F59E0B',
            fillOpacity: 0.95,
            weight: 1,
          })
            .bindTooltip(
              `RK4 Drifter #${tr.nodeId} · t+${tip.hour}h (${tip.lat.toFixed(2)}, ${tip.lon.toFixed(2)})`
            )
            .addTo(trajGrp);
        }
      });
    }

    // 7. Ocean Current Velocity Vectors (u/v)
    if (layers.currents) {
      const vectorScale = 2.4;
      nodes.forEach((n) => {
        if (n.speedMs < 0.005) return;
        const endLat = n.lat + n.v * vectorScale;
        const endLon = n.lon + n.u * vectorScale;

        L.polyline(
          [
            [n.lat, n.lon],
            [endLat, endLon],
          ],
          {
            color: '#22D3EE',
            weight: 1.6,
            opacity: 0.9,
          }
        )
          .bindTooltip(
            `Current: ${n.speedMs.toFixed(3)} m/s · u=${n.u.toFixed(3)}, v=${n.v.toFixed(3)} m/s · Wind ${n.windSpeedMs.toFixed(1)} m/s`
          )
          .addTo(curGrp);

        const angle = Math.atan2(endLat - n.lat, endLon - n.lon);
        const headLen = Math.min(0.32, Math.max(0.12, n.speedMs * 0.55));
        const a1 = angle + Math.PI * 0.82;
        const a2 = angle - Math.PI * 0.82;
        L.polygon(
          [
            [endLat, endLon],
            [endLat + Math.sin(a1) * headLen, endLon + Math.cos(a1) * headLen],
            [endLat + Math.sin(a2) * headLen, endLon + Math.cos(a2) * headLen],
          ],
          {
            color: '#22D3EE',
            weight: 1,
            fillColor: '#22D3EE',
            fillOpacity: 0.9,
          }
        ).addTo(curGrp);
      });
    }

    // 8. Primary Vessel Interception Route & Waypoints
    if (layers.route) {
      const { origin, waypoints } = prediction.vesselRoute;
      const pathCoords: [number, number][] = [
        [origin.lat, origin.lon],
        ...waypoints.map((w): [number, number] => [w.lat, w.lon]),
      ];

      L.polyline(pathCoords, {
        color: '#06B6D4',
        weight: 2.5,
        dashArray: '7,6',
        opacity: 0.95,
      }).addTo(routeGrp);

      const vesselIcon = L.divIcon({
        className: '',
        html: `<div style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:4px;background:#070B12;border:2px solid #22D3EE;color:#22D3EE;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;box-shadow:0 4px 12px rgba(0,0,0,0.6);">V</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      L.marker([origin.lat, origin.lon], { icon: vesselIcon })
        .bindTooltip(
          `Cleanup Vessel Origin (${origin.lat.toFixed(2)}°, ${origin.lon.toFixed(2)}°) · ${prediction.vesselRoute.speedKnots} kn`
        )
        .addTo(routeGrp);

      waypoints.forEach((wp) => {
        const isSelected = selectedWaypointOrder === wp.order;
        const wpIcon = L.divIcon({
          className: '',
          html: `<div style="display:flex;align-items:center;justify-content:center;width:${
            isSelected ? 28 : 24
          }px;height:${
            isSelected ? 28 : 24
          }px;border-radius:9999px;background:${
            isSelected ? '#F59E0B' : '#0E1522'
          };border:2px solid #F59E0B;color:${
            isSelected ? '#070B12' : '#FBBF24'
          };font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;box-shadow:0 4px 12px rgba(0,0,0,0.65);">${wp.order}</div>`,
          iconSize: [isSelected ? 28 : 24, isSelected ? 28 : 24],
          iconAnchor: [isSelected ? 14 : 12, isSelected ? 14 : 12],
        });

        const marker = L.marker([wp.lat, wp.lon], { icon: wpIcon });
        marker.on('click', () => onSelectWaypoint(wp.order));
        marker
          .bindPopup(
            `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;line-height:1.6;">
              <div style="font-weight:700;color:#FBBF24;margin-bottom:4px;">INTERCEPT WP #${wp.order} · t+${wp.horizonHour}h</div>
              <div>Coords: ${wp.lat.toFixed(3)}°, ${wp.lon.toFixed(3)}°</div>
              <div>Convergence Index: ${(wp.convergenceIndex * 100).toFixed(1)}%</div>
              <div>Leg Distance: ${wp.legDistanceNm} nm (Brg ${wp.bearingDeg}°)</div>
              <div>ETA: ${wp.etaHours} hrs · SST: ${wp.sst.toFixed(1)} °C</div>
            </div>`
          )
          .addTo(routeGrp);
      });
    }

    // 9. Autonomous Cleanup Fleet Simulation Tracks
    if (layers.fleet && prediction.fleetSimulation?.vessels?.length > 0) {
      const targetHr = Number(activeHorizon);
      prediction.fleetSimulation.vessels.forEach((v, idx) => {
        const col = FLEET_COLORS[idx % FLEET_COLORS.length];
        const pts =
          targetHr === 0 ? v.track : v.track.filter((pt) => pt.hour <= targetHr);
        const drawPts = pts.length >= 2 ? pts : v.track;

        L.polyline(
          drawPts.map((pt): [number, number] => [pt.lat, pt.lon]),
          {
            color: col,
            weight: 2.2,
            opacity: 0.9,
          }
        ).addTo(fleetGrp);

        const pos = drawPts[drawPts.length - 1] || v.track[0];
        if (pos) {
          const usvIcon = L.divIcon({
            className: '',
            html: `<div style="padding:1px 5px;border-radius:3px;background:#070B12;border:1.5px solid ${col};color:${col};font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;white-space:nowrap;">${v.vesselId}</div>`,
            iconSize: [42, 18],
            iconAnchor: [21, 9],
          });
          L.marker([pos.lat, pos.lon], { icon: usvIcon })
            .bindTooltip(
              `${v.vesselId} (${v.vesselClass}) · t+${pos.hour}h · Captured ${pos.cumulativeCapturedKg} kg · Eff ${pos.captureEfficiencyPct}%`
            )
            .addTo(fleetGrp);
        }
      });
    }
  }, [prediction, activeHorizon, layers, bounds, selectedWaypointOrder, onSelectWaypoint]);

  return (
    <div className="relative flex-1 min-h-[380px] bg-[#060910]">
      <div
        ref={containerRef}
        className={`w-full h-full ${pickMode !== 'none' ? 'cursor-crosshair' : ''}`}
      />

      {/* Map Layer Real-Time Data Sync & Age Status Indicator */}
      {(() => {
        const ingestedMs = prediction?.meta.ingestedAtUtc
          ? Date.parse(prediction.meta.ingestedAtUtc)
          : NaN;
        const ageSec = Number.isFinite(ingestedMs) ? Math.max(0, (nowMs - ingestedMs) / 1000) : null;
        const freshness =
          loading
            ? 'ingesting'
            : ingestBurstActive
            ? 'synced'
            : ageSec === null
            ? 'idle'
            : ageSec < 60
            ? 'fresh'
            : ageSec < 300
            ? 'live'
            : 'stale';

        const accentBorder =
          freshness === 'ingesting'
            ? 'border-cyan-400/70'
            : freshness === 'synced'
            ? 'border-emerald-400/80 shadow-[0_0_20px_rgba(52,211,153,0.22)]'
            : freshness === 'stale'
            ? 'border-amber-500/50'
            : 'border-slate-800';

        const statusColor =
          freshness === 'ingesting'
            ? 'text-cyan-300'
            : freshness === 'synced' || freshness === 'fresh'
            ? 'text-emerald-300'
            : freshness === 'stale'
            ? 'text-amber-300'
            : 'text-cyan-300';

        const s2PassLabel = prediction?.meta.latestSentinelUtc
          ? `${prediction.meta.latestSentinelUtc.slice(5, 16).replace('T', ' ')}Z`
          : 'No swath';

        return (
          <div
            className={`pointer-events-none absolute top-14 left-3 lg:top-3 z-[500] bg-[#070B12]/92 backdrop-blur-sm border ${accentBorder} rounded overflow-hidden transition-colors duration-300 max-w-[300px] sm:max-w-[340px]`}
          >
            {(loading || ingestBurstActive) && (
              <div className="h-[2px] w-full bg-slate-800 overflow-hidden">
                <div
                  key={ingestBurstKey}
                  className={`h-full w-1/2 ${
                    loading ? 'bg-cyan-400 animate-sync-sweep' : 'bg-emerald-400 animate-sync-sweep'
                  }`}
                />
              </div>
            )}

            <div className="px-2.5 py-1.5 flex items-center gap-2.5">
              <div className="relative flex items-center justify-center w-5 h-5 shrink-0">
                {ingestBurstActive && !loading && (
                  <span
                    key={`ring-${ingestBurstKey}`}
                    className="absolute inset-0 rounded-full border border-emerald-400 animate-ingest-ring"
                  />
                )}
                {loading ? (
                  <RefreshCw className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
                ) : (
                  <Radio
                    className={`w-3.5 h-3.5 ${
                      ingestBurstActive ? 'text-emerald-400 animate-pulse' : statusColor
                    }`}
                  />
                )}
              </div>

              <div className="min-w-0 flex-1 text-[11px] font-mono leading-tight">
                <div className="flex items-center gap-2">
                  <span className={`font-semibold uppercase tracking-wide ${statusColor}`}>
                    {loading
                      ? 'Ingesting → GNN'
                      : ingestBurstActive
                      ? 'GNN Synced'
                      : freshness === 'stale'
                      ? 'Age Stale'
                      : 'Telemetry Live'}
                  </span>
                  <span className="text-slate-600">·</span>
                  <span className="text-slate-100">
                    AGE {ageSec !== null ? formatDataAge(ageSec) : '—'}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 truncate mt-0.5">
                  {prediction
                    ? `OM+${prediction.meta.nodeCount}N · S2 ${prediction.meta.sentinelDetectionCount} FDI (${s2PassLabel})`
                    : 'Awaiting ocean & Sentinel-2 feed'}
                </div>
              </div>

              <button
                type="button"
                onClick={onSyncNow}
                disabled={loading}
                title="Ingest fresh Open-Meteo & Sentinel-2 data now"
                className="pointer-events-auto shrink-0 px-2 py-1 min-h-[28px] rounded border border-slate-700 bg-[#0E1522] text-[10px] font-mono text-slate-200 hover:border-cyan-500/60 hover:text-cyan-300 disabled:opacity-40 transition-colors"
              >
                {loading ? 'Sync...' : 'Sync'}
              </button>
            </div>
          </div>
        );
      })()}

      {pickMode !== 'none' && (
        <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-[500] bg-[#0E1522]/95 border border-cyan-500/60 px-3 py-1.5 rounded text-xs font-mono text-cyan-300">
          {pickMode === 'vessel'
            ? 'Click ocean map to set cleanup vessel origin'
            : 'Click ocean map to attach feedback coordinates'}
        </div>
      )}

      <div className="pointer-events-none absolute bottom-3 left-3 z-[500] bg-[#070B12]/90 border border-slate-800 px-2.5 py-1.5 rounded text-[11px] font-mono text-slate-300 flex items-center gap-3">
        <span>
          LAT{' '}
          <strong className="text-slate-100">
            {cursorCoords ? `${cursorCoords.lat.toFixed(3)}°` : '—'}
          </strong>
        </span>
        <span className="text-slate-600">/</span>
        <span>
          LON{' '}
          <strong className="text-slate-100">
            {cursorCoords ? `${cursorCoords.lon.toFixed(3)}°` : '—'}
          </strong>
        </span>
      </div>

      <div className="pointer-events-none absolute bottom-3 right-3 z-[500] bg-[#070B12]/90 border border-slate-800 px-3 py-2 rounded text-[11px] font-mono text-slate-300 space-y-1.5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-400">SST (°C)</span>
          <div className="flex items-center gap-1.5">
            <span>10°</span>
            <span
              className="inline-block w-20 h-2 rounded-sm"
              style={{
                background:
                  'linear-gradient(90deg, rgb(14,74,168) 0%, rgb(22,164,212) 35%, rgb(234,188,72) 68%, rgb(250,92,44) 100%)',
              }}
            />
            <span>30°</span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-400">Layers</span>
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#F59E0B]" /> Conv
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#F43F5E]" /> S2 FDI
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#34D399]" /> Fleet
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
