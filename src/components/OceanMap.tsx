import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import type {
  BasemapMode,
  HorizonKey,
  LayerVisibility,
  PredictionResponse,
} from '../types/ocean';

interface OceanMapProps {
  prediction: PredictionResponse | null;
  activeHorizon: HorizonKey;
  layers: LayerVisibility;
  basemap: BasemapMode;
  bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number };
  pickVesselMode: boolean;
  selectedWaypointOrder: number | null;
  onPickVessel: (lat: number, lon: number) => void;
  onSelectWaypoint: (order: number) => void;
}

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
  pickVesselMode,
  selectedWaypointOrder,
  onPickVessel,
  onSelectWaypoint,
}: OceanMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const sstLayerRef = useRef<L.LayerGroup | null>(null);
  const sentinelLayerRef = useRef<L.LayerGroup | null>(null);
  const graphLayerRef = useRef<L.LayerGroup | null>(null);
  const plumeLayerRef = useRef<L.LayerGroup | null>(null);
  const trajectoryLayerRef = useRef<L.LayerGroup | null>(null);
  const currentLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const bboxLayerRef = useRef<L.LayerGroup | null>(null);
  const lastBoundsKeyRef = useRef<string>('');

  const [cursorCoords, setCursorCoords] = useState<{ lat: number; lon: number } | null>(null);
  const pickModeRef = useRef(pickVesselMode);
  const onPickVesselRef = useRef(onPickVessel);

  useEffect(() => {
    pickModeRef.current = pickVesselMode;
  }, [pickVesselMode]);

  useEffect(() => {
    onPickVesselRef.current = onPickVessel;
  }, [onPickVessel]);

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
    trajectoryLayerRef.current = L.layerGroup().addTo(map);
    currentLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);

    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      setCursorCoords({ lat: e.latlng.lat, lon: e.latlng.lng });
    });

    map.on('mouseout', () => {
      setCursorCoords(null);
    });

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (pickModeRef.current) {
        onPickVesselRef.current(
          Number(e.latlng.lat.toFixed(3)),
          Number(e.latlng.lng.toFixed(3))
        );
      }
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
        ? 'Tiles &copy; Esri &mdash; Maxar | Ocean: Open-Meteo / Mercator'
        : '&copy; OpenStreetMap &copy; CARTO | Ocean: Open-Meteo / Mercator';

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
    const graphGrp = graphLayerRef.current;
    const plumeGrp = plumeLayerRef.current;
    const trajGrp = trajectoryLayerRef.current;
    const curGrp = currentLayerRef.current;
    const routeGrp = routeLayerRef.current;

    if (!sstGrp || !s2Grp || !graphGrp || !plumeGrp || !trajGrp || !curGrp || !routeGrp) return;

    sstGrp.clearLayers();
    s2Grp.clearLayers();
    graphGrp.clearLayers();
    plumeGrp.clearLayers();
    trajGrp.clearLayers();
    curGrp.clearLayers();
    routeGrp.clearLayers();

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
            fillOpacity: 0.3,
          }
        )
          .bindTooltip(
            `Node #${n.id} · SST ${n.sst.toFixed(1)} °C · Wave ${n.waveHeight.toFixed(2)} m · Wind ${n.windSpeedMs.toFixed(1)} m/s`
          )
          .addTo(sstGrp);
      });
    }

    // 2. Real Sentinel-2 L2A STAC Swath Footprints
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
          fillOpacity: 0.08,
        })
          .bindTooltip(
            `Sentinel-2 L2A (${sc.mgrsTile}) · ${sc.datetime.slice(0, 16)}Z · Cloud ${sc.cloudCover}%`
          )
          .addTo(s2Grp);
      });
    }

    // 3. GNN Spatial Graph Topology Edges
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

    // 4. Convergence / Accumulation Risk Nodes
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
            `Convergence ${(n.convergenceIndex * 100).toFixed(1)}% · Flow ${n.speedMs.toFixed(2)} m/s (${n.directionDeg.toFixed(0)}°) · Wind ${n.windSpeedMs.toFixed(1)} m/s · SST ${n.sst.toFixed(1)}°C`
          )
          .addTo(plumeGrp);
      });
    }

    // 5. RK4 Drift Trajectories (0h -> 72h)
    if (layers.trajectories) {
      const targetHour = Number(activeHorizon);
      prediction.trajectories.forEach((tr) => {
        const visiblePts =
          targetHour === 0
            ? tr.points
            : tr.points.filter((p) => p.hour <= targetHour);
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
            .bindTooltip(`RK4 Drifter #${tr.nodeId} · t+${tip.hour}h (${tip.lat.toFixed(2)}, ${tip.lon.toFixed(2)})`)
            .addTo(trajGrp);
        }
      });
    }

    // 6. Ocean Current Velocity Vectors (u/v)
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

    // 7. Cleanup Vessel Interception Route & Waypoints
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
  }, [prediction, activeHorizon, layers, bounds, selectedWaypointOrder, onSelectWaypoint]);

  return (
    <div className="relative flex-1 min-h-[380px] bg-[#060910]">
      <div
        ref={containerRef}
        className={`w-full h-full ${pickVesselMode ? 'cursor-crosshair' : ''}`}
      />

      {pickVesselMode && (
        <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-[500] bg-[#0E1522]/95 border border-cyan-500/60 px-3 py-1.5 rounded text-xs font-mono text-cyan-300">
          Click anywhere on the ocean map to reposition cleanup vessel origin
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
          <span className="text-slate-400">Convergence</span>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#0EA5E9]" /> Low
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#F59E0B]" /> High
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
