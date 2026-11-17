export interface AccumulationZone {
  id: string;
  name: string;
  basin: string;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  defaultVesselLat: number;
  defaultVesselLon: number;
  description: string;
}

export interface PredictParams {
  regionId: string;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  gridSize: number;
  vesselLat: number;
  vesselLon: number;
  vesselSpeedKnots: number;
  leewayFactor?: number;
  forceRefresh?: boolean;
}

export interface OceanNodeObs {
  nodeId: number;
  row: number;
  col: number;
  lat: number;
  lon: number;
  uSeries: number[];
  vSeries: number[];
  windUSeries: number[];
  windVSeries: number[];
  windSpeedSeries: number[];
  windDirSeries: number[];
  sstSeries: number[];
  waveHSeries: number[];
  waveDirSeries: number[];
}

export interface GraphEdge {
  source: number;
  target: number;
  weight: number;
}

export interface HorizonNodeRecord {
  id: number;
  gridLat: number;
  gridLon: number;
  lat: number;
  lon: number;
  u: number;
  v: number;
  speedMs: number;
  directionDeg: number;
  windSpeedMs: number;
  windDirectionDeg: number;
  sst: number;
  waveHeight: number;
  waveDirection: number;
  convergenceIndex: number;
}

export interface HorizonSnapshot {
  timestamp: string;
  nodes: HorizonNodeRecord[];
  meanSpeedMs: number;
  meanWindMs: number;
  meanSstC: number;
  meanWaveM: number;
  peakConvergence: number;
}

export interface TrajectoryPoint {
  hour: number;
  lat: number;
  lon: number;
}

export interface PlumeTrajectory {
  nodeId: number;
  initialConvergence: number;
  points: TrajectoryPoint[];
}

export interface VesselWaypoint {
  order: number;
  horizonHour: number;
  lat: number;
  lon: number;
  convergenceIndex: number;
  sst: number;
  legDistanceNm: number;
  etaHours: number;
  bearingDeg: number;
}

export interface SentinelScene {
  id: string;
  datetime: string;
  cloudCover: number;
  mgrsTile: string;
  platform: string;
  bbox: [number, number, number, number];
  coordinates: number[][][];
  thumbnailUrl?: string;
}

export interface PredictionResponse {
  meta: {
    engine: string;
    dataSources: string[];
    fetchTimeMs: number;
    cached: boolean;
    nodeCount: number;
    edgeCount: number;
    forecastIssuedUtc: string;
    leewayFactor: number;
    sentinelSceneCount: number;
  };
  graphEdges: GraphEdge[];
  horizons: Record<string, HorizonSnapshot>;
  trajectories: PlumeTrajectory[];
  sentinelScenes: SentinelScene[];
  vesselRoute: {
    origin: { lat: number; lon: number };
    speedKnots: number;
    totalDistanceNm: number;
    totalEtaHours: number;
    meanTargetConvergence: number;
    waypoints: VesselWaypoint[];
  };
}

const EARTH_RADIUS_M = 6_371_000.0;
const KMH_TO_MS = 1.0 / 3.6;
const NM_PER_METER = 1.0 / 1852.0;

const rawMarineEnv = (process.env.OPEN_METEO_MARINE_URL || '').trim();
export const OPEN_METEO_MARINE_URL =
  rawMarineEnv.startsWith('http://') || rawMarineEnv.startsWith('https://')
    ? rawMarineEnv
    : 'https://marine-api.open-meteo.com/v1/marine';
export const OPEN_METEO_WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';
export const SENTINEL_STAC_URL = 'https://earth-search.aws.element84.com/v1/search';

export const ACCUMULATION_ZONES: AccumulationZone[] = [
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
  {
    id: 'bay_of_bengal',
    name: 'Bay of Bengal Accumulation Plume',
    basin: 'North Indian Ocean',
    latMin: 10.0,
    latMax: 20.0,
    lonMin: 82.0,
    lonMax: 92.0,
    defaultVesselLat: 13.5,
    defaultVesselLon: 84.0,
    description:
      'High-flux monsoonal gyre receiving Ganges-Brahmaputra riverine macro-plastic outflow.',
  },
  {
    id: 'north_atlantic',
    name: 'North Atlantic Gyre (Sargasso Sea)',
    basin: 'North Atlantic',
    latMin: 25.0,
    latMax: 35.0,
    lonMin: -65.0,
    lonMax: -50.0,
    defaultVesselLat: 28.0,
    defaultVesselLon: -61.5,
    description:
      'Subtropical gyre convergence cell trapping pelagic microplastics along Gulf Stream eddies.',
  },
  {
    id: 'south_pacific',
    name: 'South Pacific Convergence Zone',
    basin: 'South Pacific Gyre',
    latMin: -32.0,
    latMax: -22.0,
    lonMin: -115.0,
    lonMax: -95.0,
    defaultVesselLat: -29.0,
    defaultVesselLon: -108.0,
    description:
      'Humboldt-fed subtropical convergence corridor west of the Chilean shelf.',
  },
  {
    id: 'mediterranean',
    name: 'Central Mediterranean Plastic Basin',
    basin: 'Mediterranean Sea',
    latMin: 34.0,
    latMax: 39.5,
    lonMin: 11.5,
    lonMax: 21.5,
    defaultVesselLat: 36.2,
    defaultVesselLon: 13.5,
    description:
      'Semi-enclosed Ionian-Sicily channel bottleneck with strong mesoscale eddies.',
  },
];

interface CachedMarineGrid {
  fetchedAt: number;
  timestamps: string[];
  nodes: OceanNodeObs[];
  sentinelScenes: SentinelScene[];
}

const marineCache = new Map<string, CachedMarineGrid>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const phi1 = lat1 * toRad;
  const phi2 = lat2 * toRad;
  const dPhi = (lat2 - lat1) * toRad;
  const dLambda = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(1e-12, 1 - a)));
}

function initialBearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const phi1 = lat1 * toRad;
  const phi2 = lat2 * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Open-Meteo ocean_current_direction is towards-direction (deg clockwise from North). */
function currentToUV(speedKmh: number, towardsDeg: number): [number, number] {
  const speedMs = speedKmh * KMH_TO_MS;
  const rad = (towardsDeg * Math.PI) / 180;
  return [speedMs * Math.sin(rad), speedMs * Math.cos(rad)];
}

/** Open-Meteo wind_direction_10m is meteorological FROM-direction; downwind vector adds 180°. */
function windFromToUV(speedKmh: number, fromDeg: number): [number, number] {
  const speedMs = speedKmh * KMH_TO_MS;
  const rad = (((fromDeg + 180) % 360) * Math.PI) / 180;
  return [speedMs * Math.sin(rad), speedMs * Math.cos(rad)];
}

function uvToDirectionDeg(u: number, v: number): number {
  return ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360;
}

function minmaxNorm(arr: number[]): number[] {
  const lo = Math.min(...arr);
  const hi = Math.max(...arr);
  if (hi - lo < 1e-8) return arr.map(() => 0.5);
  return arr.map((val) => (val - lo) / (hi - lo));
}

function computePhysicalConvergenceIndex(
  nodes: OceanNodeObs[],
  leewayFactor: number
): number[] {
  const n = nodes.length;
  if (n === 0) return [];
  const convergence = new Array<number>(n).fill(0);
  const sstGrad = new Array<number>(n).fill(0);

  const effU = nodes.map((nd) => nd.uSeries[0] + leewayFactor * nd.windUSeries[0]);
  const effV = nodes.map((nd) => nd.vSeries[0] + leewayFactor * nd.windVSeries[0]);

  for (let i = 0; i < n; i++) {
    let duDxAcc = 0;
    let dvDyAcc = 0;
    let dsstAcc = 0;
    let wAcc = 0;

    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const dist = haversineMeters(nodes[i].lat, nodes[i].lon, nodes[j].lat, nodes[j].lon);
      if (dist > 450_000 || dist < 1) continue;

      const dx = (nodes[j].lon - nodes[i].lon) * 111_320 * Math.cos((nodes[i].lat * Math.PI) / 180);
      const dy = (nodes[j].lat - nodes[i].lat) * 110_540;
      const w = 1 / Math.pow(dist / 100_000 + 0.5, 2);

      if (Math.abs(dx) > 1000) {
        duDxAcc += w * ((effU[j] - effU[i]) / dx);
      }
      if (Math.abs(dy) > 1000) {
        dvDyAcc += w * ((effV[j] - effV[i]) / dy);
      }
      dsstAcc += w * (Math.abs(nodes[j].sstSeries[0] - nodes[i].sstSeries[0]) / (dist / 100_000));
      wAcc += w;
    }

    if (wAcc > 0) {
      const div = (duDxAcc + dvDyAcc) / wAcc;
      convergence[i] = -div * 1e6;
      sstGrad[i] = dsstAcc / wAcc;
    }
  }

  const stagnation = nodes.map((_, i) => {
    const spd = Math.hypot(effU[i], effV[i]);
    return 1 / (1 + spd * 2.2);
  });

  const convNorm = minmaxNorm(convergence);
  const sstNorm = minmaxNorm(sstGrad);
  const stagNorm = minmaxNorm(stagnation);

  return nodes.map((_, i) => {
    const score = 0.55 * convNorm[i] + 0.25 * sstNorm[i] + 0.2 * stagNorm[i];
    return Math.min(0.98, Math.max(0.05, 0.08 + 0.88 * score));
  });
}

function buildSpatialOceanGraph(
  nodes: OceanNodeObs[],
  leewayFactor: number
): { edges: GraphEdge[]; adj: Map<number, GraphEdge[]> } {
  const lookup = new Map<string, number>();
  nodes.forEach((nd, idx) => {
    lookup.set(`${nd.row}:${nd.col}`, idx);
  });

  const neighbors: [number, number][] = [
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [0, -1],
    [0, 1],
    [1, -1],
    [1, 0],
    [1, 1],
  ];

  const edges: GraphEdge[] = [];
  const adj = new Map<number, GraphEdge[]>();

  nodes.forEach((nd, idx) => {
    const uI = nd.uSeries[0] + leewayFactor * nd.windUSeries[0];
    const vI = nd.vSeries[0] + leewayFactor * nd.windVSeries[0];
    const spdI = Math.hypot(uI, vI);

    for (const [dr, dc] of neighbors) {
      const nbrIdx = lookup.get(`${nd.row + dr}:${nd.col + dc}`);
      if (nbrIdx === undefined) continue;
      const nbr = nodes[nbrIdx];
      const distKm = haversineMeters(nd.lat, nd.lon, nbr.lat, nbr.lon) / 1000;
      const dx = (nbr.lon - nd.lon) * Math.cos((nd.lat * Math.PI) / 180);
      const dy = nbr.lat - nd.lat;
      const vecLen = Math.max(1e-8, Math.hypot(dx, dy));
      const cosAlign = spdI > 1e-4 ? (uI * dx + vI * dy) / (Math.max(1e-6, spdI) * vecLen) : 0;
      const flowFactor = 0.55 + 0.45 * Math.max(0, cosAlign);
      const weight = Number((flowFactor / Math.max(0.5, distKm / 100)).toFixed(4));

      const edge = { source: idx, target: nbrIdx, weight };
      edges.push(edge);
      if (!adj.has(nbrIdx)) adj.set(nbrIdx, []);
      adj.get(nbrIdx)!.push(edge);
    }
  });

  return { edges, adj };
}

function runGraphMessagePassingRollout(
  nodes: OceanNodeObs[],
  conc0: number[],
  edges: GraphEdge[],
  leewayFactor: number
): Array<Array<{ lat: number; lon: number; u: number; v: number; concentration: number }>> {
  const n = nodes.length;
  const horizonHours = [24, 48, 72];

  let current = nodes.map((nd, i) => ({
    lat: nd.lat,
    lon: nd.lon,
    u: nd.uSeries[0] + leewayFactor * nd.windUSeries[0],
    v: nd.vSeries[0] + leewayFactor * nd.windVSeries[0],
    concentration: conc0[i],
  }));

  const hidden = nodes.map((_, i) => [current[i].u, current[i].v, conc0[i]]);
  const predictions: Array<Array<{ lat: number; lon: number; u: number; v: number; concentration: number }>> = [];

  for (const hVal of horizonHours) {
    const incomingFlux = new Array<number>(n).fill(0);
    const weightSum = new Array<number>(n).fill(0);
    const neighborU = new Array<number>(n).fill(0);
    const neighborV = new Array<number>(n).fill(0);

    for (const e of edges) {
      incomingFlux[e.target] += current[e.source].concentration * e.weight;
      neighborU[e.target] += current[e.source].u * e.weight;
      neighborV[e.target] += current[e.source].v * e.weight;
      weightSum[e.target] += e.weight;
    }

    const nextStep = nodes.map((nd, i) => {
      const hIdx = Math.min(hVal, nd.uSeries.length - 1);
      const uNext = nd.uSeries[hIdx] + leewayFactor * nd.windUSeries[hIdx];
      const vNext = nd.vSeries[hIdx] + leewayFactor * nd.windVSeries[hIdx];

      const deg = weightSum[i];
      const advectedConc = deg > 1e-6 ? incomingFlux[i] / deg : current[i].concentration;
      const msgU = deg > 1e-6 ? neighborU[i] / deg : current[i].u;
      const msgV = deg > 1e-6 ? neighborV[i] / deg : current[i].v;

      const forgetGate = 0.64;
      const inputGate = 0.36;
      hidden[i][0] = forgetGate * hidden[i][0] + inputGate * (0.7 * uNext + 0.3 * msgU);
      hidden[i][1] = forgetGate * hidden[i][1] + inputGate * (0.7 * vNext + 0.3 * msgV);

      const flowShear = Math.tanh((Math.hypot(msgU, msgV) - Math.hypot(uNext, vNext)) * 1.5) * 0.04;
      const nextConc = Math.min(
        0.99,
        Math.max(0.03, forgetGate * current[i].concentration + inputGate * advectedConc + flowShear)
      );
      hidden[i][2] = nextConc;

      const dtSec = 24 * 3600;
      const uEff = 0.5 * (current[i].u + uNext);
      const vEff = 0.5 * (current[i].v + vNext);
      const cosLat = Math.max(0.15, Math.cos((current[i].lat * Math.PI) / 180));
      const dLat = ((vEff * dtSec) / EARTH_RADIUS_M) * (180 / Math.PI);
      const dLon = ((uEff * dtSec) / (EARTH_RADIUS_M * cosLat)) * (180 / Math.PI);

      return {
        lat: current[i].lat + dLat,
        lon: current[i].lon + dLon,
        u: uNext,
        v: vNext,
        concentration: nextConc,
      };
    });

    predictions.push(nextStep);
    current = nextStep;
  }

  return predictions;
}

function interpolateEffectiveUvAt(
  lat: number,
  lon: number,
  hourIdx: number,
  nodes: OceanNodeObs[],
  leewayFactor: number
): [number, number] {
  const h0 = Math.max(0, Math.min(95, Math.floor(hourIdx)));
  const h1 = Math.max(0, Math.min(95, Math.ceil(hourIdx)));
  const alpha = hourIdx - h0;

  let uAcc = 0;
  let vAcc = 0;
  let wAcc = 0;

  for (const nd of nodes) {
    const dLat = lat - nd.lat;
    const dLon = (lon - nd.lon) * Math.cos((lat * Math.PI) / 180);
    const dist2 = dLat * dLat + dLon * dLon;
    const w = 1 / (dist2 + 0.08);

    const s0 = Math.min(h0, nd.uSeries.length - 1);
    const s1 = Math.min(h1, nd.uSeries.length - 1);

    const uCurr = nd.uSeries[s0] * (1 - alpha) + nd.uSeries[s1] * alpha;
    const vCurr = nd.vSeries[s0] * (1 - alpha) + nd.vSeries[s1] * alpha;

    const uWind = nd.windUSeries[s0] * (1 - alpha) + nd.windUSeries[s1] * alpha;
    const vWind = nd.windVSeries[s0] * (1 - alpha) + nd.windVSeries[s1] * alpha;

    // Wave direction is FROM-direction; Stokes drift propagates towards (waveDir + 180)
    const wh = nd.waveHSeries[s0] * (1 - alpha) + nd.waveHSeries[s1] * alpha;
    const wdTowards = (((nd.waveDirSeries[s0] + 180) % 360) * Math.PI) / 180;
    const stokes = 0.015 * wh;

    uAcc += w * (uCurr + leewayFactor * uWind + stokes * Math.sin(wdTowards));
    vAcc += w * (vCurr + leewayFactor * vWind + stokes * Math.cos(wdTowards));
    wAcc += w;
  }

  return wAcc > 0 ? [uAcc / wAcc, vAcc / wAcc] : [0, 0];
}

function rk4IntegrateTrajectory(
  startLat: number,
  startLon: number,
  nodes: OceanNodeObs[],
  leewayFactor: number,
  totalHours = 72,
  dtHours = 3
): TrajectoryPoint[] {
  let lat = startLat;
  let lon = startLon;
  const dtSec = dtHours * 3600;
  const steps = Math.floor(totalHours / dtHours);
  const points: TrajectoryPoint[] = [{ hour: 0, lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)) }];

  const deriv = (cLat: number, cLon: number, tHr: number): [number, number] => {
    const [u, v] = interpolateEffectiveUvAt(cLat, cLon, tHr, nodes, leewayFactor);
    const cosLat = Math.max(0.15, Math.cos((cLat * Math.PI) / 180));
    return [(v / EARTH_RADIUS_M) * (180 / Math.PI), (u / (EARTH_RADIUS_M * cosLat)) * (180 / Math.PI)];
  };

  for (let step = 0; step < steps; step++) {
    const t = step * dtHours;
    const [k1Lat, k1Lon] = deriv(lat, lon, t);
    const [k2Lat, k2Lon] = deriv(lat + 0.5 * dtSec * k1Lat, lon + 0.5 * dtSec * k1Lon, t + 0.5 * dtHours);
    const [k3Lat, k3Lon] = deriv(lat + 0.5 * dtSec * k2Lat, lon + 0.5 * dtSec * k2Lon, t + 0.5 * dtHours);
    const [k4Lat, k4Lon] = deriv(lat + dtSec * k3Lat, lon + dtSec * k3Lon, t + dtHours);

    lat += (dtSec / 6) * (k1Lat + 2 * k2Lat + 2 * k3Lat + k4Lat);
    lon += (dtSec / 6) * (k1Lon + 2 * k2Lon + 2 * k3Lon + k4Lon);

    const nextHour = (step + 1) * dtHours;
    if ([12, 24, 36, 48, 60, 72].includes(nextHour)) {
      points.push({ hour: nextHour, lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)) });
    }
  }

  return points;
}

function optimizeVesselRoute(
  vesselLat: number,
  vesselLon: number,
  speedKnots: number,
  horizons: Record<string, HorizonSnapshot>
): VesselWaypoint[] {
  const candidates: Array<{
    horizonHour: number;
    nodeId: number;
    lat: number;
    lon: number;
    convergenceIndex: number;
    sst: number;
  }> = [];

  for (const hStr of ['24', '48', '72']) {
    const topNodes = [...horizons[hStr].nodes]
      .sort((a, b) => b.convergenceIndex - a.convergenceIndex)
      .slice(0, 3);
    for (const nd of topNodes) {
      candidates.push({
        horizonHour: Number(hStr),
        nodeId: nd.id,
        lat: nd.lat,
        lon: nd.lon,
        convergenceIndex: nd.convergenceIndex,
        sst: nd.sst,
      });
    }
  }

  const selected: VesselWaypoint[] = [];
  let currLat = vesselLat;
  let currLon = vesselLon;
  let elapsedHrs = 0;
  const used = new Set<string>();

  for (let step = 0; step < Math.min(5, candidates.length); step++) {
    let best: (typeof candidates)[0] | null = null;
    let bestScore = -1;
    let bestDistNm = 0;

    for (const cand of candidates) {
      const key = `${cand.lat.toFixed(2)}:${cand.lon.toFixed(2)}`;
      if (used.has(key)) continue;
      const distNm = haversineMeters(currLat, currLon, cand.lat, cand.lon) * NM_PER_METER;
      const legHrs = distNm / Math.max(1, speedKnots);
      const etaHrs = elapsedHrs + legHrs;
      const horizonPenalty = 1 + Math.abs(etaHrs - cand.horizonHour) / 36;
      const score = (cand.convergenceIndex * 100) / ((1 + legHrs * 0.15) * horizonPenalty);

      if (score > bestScore) {
        bestScore = score;
        best = cand;
        bestDistNm = distNm;
      }
    }

    if (!best) break;
    const legHrs = bestDistNm / Math.max(1, speedKnots);
    const bearingDeg = initialBearingDeg(currLat, currLon, best.lat, best.lon);
    elapsedHrs += legHrs;
    currLat = best.lat;
    currLon = best.lon;
    used.add(`${currLat.toFixed(2)}:${currLon.toFixed(2)}`);

    selected.push({
      order: step + 1,
      horizonHour: best.horizonHour,
      lat: Number(best.lat.toFixed(4)),
      lon: Number(best.lon.toFixed(4)),
      convergenceIndex: best.convergenceIndex,
      sst: best.sst,
      legDistanceNm: Number(bestDistNm.toFixed(1)),
      etaHours: Number(elapsedHrs.toFixed(1)),
      bearingDeg: Number(bearingDeg.toFixed(0)),
    });
  }

  return selected;
}

async function fetchSentinelScenes(
  latMin: number,
  latMax: number,
  lonMin: number,
  lonMax: number
): Promise<SentinelScene[]> {
  try {
    const resp = await fetch(SENTINEL_STAC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collections: ['sentinel-2-l2a'],
        bbox: [lonMin, latMin, lonMax, latMax],
        limit: 6,
      }),
      signal: AbortSignal.timeout(7000),
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as { features?: any[] };
    const features = Array.isArray(data.features) ? data.features : [];
    return features
      .filter((f) => f?.geometry?.type === 'Polygon' && Array.isArray(f?.geometry?.coordinates))
      .map((f) => {
        const props = f.properties || {};
        const gridCode =
          props['grid:code'] ||
          (props['mgrs:utm_zone']
            ? `${props['mgrs:utm_zone']}${props['mgrs:latitude_band'] || ''}${props['mgrs:grid_square'] || ''}`
            : 'S2');
        return {
          id: String(f.id || ''),
          datetime: String(props.datetime || ''),
          cloudCover: Number((props['eo:cloud_cover'] ?? 0).toFixed(1)),
          mgrsTile: String(gridCode),
          platform: String(props.platform || 'sentinel-2'),
          bbox: (f.bbox || [lonMin, latMin, lonMax, latMax]) as [number, number, number, number],
          coordinates: f.geometry.coordinates as number[][][],
          thumbnailUrl: f.assets?.thumbnail?.href,
        };
      });
  } catch {
    return [];
  }
}

export async function runRealMarinePrediction(params: PredictParams): Promise<PredictionResponse> {
  const t0 = performance.now();
  const gridSize = Math.min(8, Math.max(4, Math.round(params.gridSize || 6)));
  const leewayFactor = Math.min(0.06, Math.max(0, Number(params.leewayFactor ?? 0.02)));
  const cacheKey = `${params.latMin.toFixed(3)}:${params.latMax.toFixed(3)}:${params.lonMin.toFixed(3)}:${params.lonMax.toFixed(3)}:${gridSize}`;

  let oceanNodes: OceanNodeObs[] = [];
  let timestamps: string[] = [];
  let sentinelScenes: SentinelScene[] = [];
  let cachedHit = false;

  const existing = marineCache.get(cacheKey);
  if (!params.forceRefresh && existing && Date.now() - existing.fetchedAt < CACHE_TTL_MS) {
    oceanNodes = existing.nodes;
    timestamps = existing.timestamps;
    sentinelScenes = existing.sentinelScenes;
    cachedHit = true;
  } else {
    const lats: number[] = [];
    const lons: number[] = [];
    const coordsMeta: Array<{ r: number; c: number; lat: number; lon: number }> = [];

    for (let r = 0; r < gridSize; r++) {
      const lat = Number((params.latMin + (r / (gridSize - 1)) * (params.latMax - params.latMin)).toFixed(4));
      for (let c = 0; c < gridSize; c++) {
        const lon = Number((params.lonMin + (c / (gridSize - 1)) * (params.lonMax - params.lonMin)).toFixed(4));
        lats.push(lat);
        lons.push(lon);
        coordsMeta.push({ r, c, lat, lon });
      }
    }

    const marineQuery = new URLSearchParams({
      latitude: lats.join(','),
      longitude: lons.join(','),
      hourly: 'ocean_current_velocity,ocean_current_direction,sea_surface_temperature,wave_height,wave_direction',
      forecast_days: '4',
      timezone: 'UTC',
    });

    const windQuery = new URLSearchParams({
      latitude: lats.join(','),
      longitude: lons.join(','),
      hourly: 'wind_speed_10m,wind_direction_10m',
      forecast_days: '4',
      timezone: 'UTC',
    });

    const [marineRes, windRes, s2Scenes] = await Promise.all([
      fetch(`${OPEN_METEO_MARINE_URL}?${marineQuery.toString()}`, {
        signal: AbortSignal.timeout(20_000),
      }),
      fetch(`${OPEN_METEO_WEATHER_URL}?${windQuery.toString()}`, {
        signal: AbortSignal.timeout(20_000),
      }).catch(() => null),
      fetchSentinelScenes(params.latMin, params.latMax, params.lonMin, params.lonMax),
    ]);

    sentinelScenes = s2Scenes;

    if (!marineRes.ok) {
      const errText = await marineRes.text();
      throw new Error(`Open-Meteo Marine API HTTP ${marineRes.status}: ${errText.slice(0, 180)}`);
    }

    const rawMarine = await marineRes.json();
    const marineItems = Array.isArray(rawMarine) ? rawMarine : [rawMarine];

    let windItems: any[] = [];
    if (windRes && windRes.ok) {
      const rawWind = await windRes.json();
      windItems = Array.isArray(rawWind) ? rawWind : [rawWind];
    }

    marineItems.forEach((item: any, idx: number) => {
      const hourly = item?.hourly;
      if (!hourly) return;
      if (timestamps.length === 0 && Array.isArray(hourly.time)) {
        timestamps = hourly.time;
      }

      const velArr: Array<number | null> = hourly.ocean_current_velocity || [];
      const dirArr: Array<number | null> = hourly.ocean_current_direction || [];
      const sstArr: Array<number | null> = hourly.sea_surface_temperature || [];
      const whArr: Array<number | null> = hourly.wave_height || [];
      const wdArr: Array<number | null> = hourly.wave_direction || [];

      if (velArr.length === 0 || velArr[0] === null || sstArr[0] === null) {
        return; // Land cell
      }

      const windHourly = windItems[idx]?.hourly;
      const wSpdArr: Array<number | null> = windHourly?.wind_speed_10m || [];
      const wDirArr: Array<number | null> = windHourly?.wind_direction_10m || [];

      const uSeries: number[] = [];
      const vSeries: number[] = [];
      const windUSeries: number[] = [];
      const windVSeries: number[] = [];
      const windSpeedSeries: number[] = [];
      const windDirSeries: number[] = [];
      const sstSeries: number[] = [];
      const waveHSeries: number[] = [];
      const waveDirSeries: number[] = [];

      const frameCount = Math.min(96, velArr.length);
      for (let h = 0; h < frameCount; h++) {
        const spd = velArr[h] ?? velArr[0] ?? 0;
        const dir = dirArr[h] ?? dirArr[0] ?? 0;
        const [u, v] = currentToUV(spd, dir);
        uSeries.push(u);
        vSeries.push(v);

        const wspd = wSpdArr[h] ?? wSpdArr[0] ?? 0;
        const wdir = wDirArr[h] ?? wDirArr[0] ?? 0;
        const [wu, wv] = windFromToUV(wspd, wdir);
        windUSeries.push(wu);
        windVSeries.push(wv);
        windSpeedSeries.push(wspd * KMH_TO_MS);
        windDirSeries.push(wdir);

        sstSeries.push(Number(sstArr[h] ?? sstArr[0] ?? 18));
        waveHSeries.push(Number(whArr[h] ?? whArr[0] ?? 0.5));
        waveDirSeries.push(Number(wdArr[h] ?? wdArr[0] ?? 0));
      }

      const meta = coordsMeta[idx];
      oceanNodes.push({
        nodeId: oceanNodes.length,
        row: meta.r,
        col: meta.c,
        lat: meta.lat,
        lon: meta.lon,
        uSeries,
        vSeries,
        windUSeries,
        windVSeries,
        windSpeedSeries,
        windDirSeries,
        sstSeries,
        waveHSeries,
        waveDirSeries,
      });
    });

    if (oceanNodes.length < 3) {
      throw new Error(
        'Selected bounding box contains fewer than 3 open-ocean telemetry nodes. Adjust coordinates seaward.'
      );
    }

    marineCache.set(cacheKey, {
      fetchedAt: Date.now(),
      timestamps,
      nodes: oceanNodes,
      sentinelScenes,
    });
  }

  const conc0 = computePhysicalConvergenceIndex(oceanNodes, leewayFactor);
  const { edges } = buildSpatialOceanGraph(oceanNodes, leewayFactor);
  const rolloutPreds = runGraphMessagePassingRollout(oceanNodes, conc0, edges, leewayFactor);

  const rankedIndices = oceanNodes
    .map((_, idx) => ({ idx, c: conc0[idx] }))
    .sort((a, b) => b.c - a.c)
    .slice(0, Math.min(12, oceanNodes.length));

  const trajectories: PlumeTrajectory[] = rankedIndices.map(({ idx, c }) => ({
    nodeId: oceanNodes[idx].nodeId,
    initialConvergence: Number(c.toFixed(3)),
    points: rk4IntegrateTrajectory(
      oceanNodes[idx].lat,
      oceanNodes[idx].lon,
      oceanNodes,
      leewayFactor,
      72,
      3
    ),
  }));

  const horizons: Record<string, HorizonSnapshot> = {};
  const horizonHours = [0, 24, 48, 72];

  horizonHours.forEach((hVal, hIdx) => {
    const records: HorizonNodeRecord[] = oceanNodes.map((nd, nIdx) => {
      const fIdx = Math.min(hVal, nd.uSeries.length - 1);
      const uVal = nd.uSeries[fIdx];
      const vVal = nd.vSeries[fIdx];
      const predState =
        hIdx === 0
          ? { lat: nd.lat, lon: nd.lon, concentration: conc0[nIdx] }
          : rolloutPreds[hIdx - 1][nIdx];

      return {
        id: nd.nodeId,
        gridLat: nd.lat,
        gridLon: nd.lon,
        lat: Number(predState.lat.toFixed(4)),
        lon: Number(predState.lon.toFixed(4)),
        u: Number(uVal.toFixed(4)),
        v: Number(vVal.toFixed(4)),
        speedMs: Number(Math.hypot(uVal, vVal).toFixed(4)),
        directionDeg: Number(uvToDirectionDeg(uVal, vVal).toFixed(1)),
        windSpeedMs: Number((nd.windSpeedSeries[fIdx] ?? 0).toFixed(2)),
        windDirectionDeg: Number((nd.windDirSeries[fIdx] ?? 0).toFixed(0)),
        sst: Number(nd.sstSeries[fIdx].toFixed(2)),
        waveHeight: Number(nd.waveHSeries[fIdx].toFixed(2)),
        waveDirection: Number(nd.waveDirSeries[fIdx].toFixed(1)),
        convergenceIndex: Number(predState.concentration.toFixed(3)),
      };
    });

    const nCount = records.length;
    horizons[String(hVal)] = {
      timestamp: timestamps[Math.min(hVal, timestamps.length - 1)] || '',
      nodes: records,
      meanSpeedMs: Number((records.reduce((s, r) => s + r.speedMs, 0) / nCount).toFixed(4)),
      meanWindMs: Number((records.reduce((s, r) => s + r.windSpeedMs, 0) / nCount).toFixed(2)),
      meanSstC: Number((records.reduce((s, r) => s + r.sst, 0) / nCount).toFixed(2)),
      meanWaveM: Number((records.reduce((s, r) => s + r.waveHeight, 0) / nCount).toFixed(2)),
      peakConvergence: Number(Math.max(...records.map((r) => r.convergenceIndex)).toFixed(3)),
    };
  });

  const waypoints = optimizeVesselRoute(
    params.vesselLat,
    params.vesselLon,
    params.vesselSpeedKnots,
    horizons
  );

  const totalDistanceNm = Number(waypoints.reduce((s, w) => s + w.legDistanceNm, 0).toFixed(1));
  const totalEtaHours = waypoints.length > 0 ? waypoints[waypoints.length - 1].etaHours : 0;
  const meanTargetConvergence =
    waypoints.length > 0
      ? Number((waypoints.reduce((s, w) => s + w.convergenceIndex, 0) / waypoints.length).toFixed(3))
      : 0;

  return {
    meta: {
      engine: 'Spatial Graph Message-Passing + Recurrent LSTM + RK4 Advection',
      dataSources: [
        'Open-Meteo Marine (Copernicus / Mercator Ocean Currents, SST, Waves)',
        'Open-Meteo Atmosphere (10m Wind Leeway)',
        'Element84 Earth Search STAC (Sentinel-2 L2A Swaths)',
      ],
      fetchTimeMs: Number((performance.now() - t0).toFixed(1)),
      cached: cachedHit,
      nodeCount: oceanNodes.length,
      edgeCount: edges.length,
      forecastIssuedUtc: timestamps[0] || '',
      leewayFactor,
      sentinelSceneCount: sentinelScenes.length,
    },
    graphEdges: edges.slice(0, 180),
    horizons,
    trajectories,
    sentinelScenes,
    vesselRoute: {
      origin: { lat: params.vesselLat, lon: params.vesselLon },
      speedKnots: params.vesselSpeedKnots,
      totalDistanceNm,
      totalEtaHours,
      meanTargetConvergence,
      waypoints,
    },
  };
}
