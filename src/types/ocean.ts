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

export interface GraphEdge {
  source: number;
  target: number;
  weight: number;
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

export interface LayerVisibility {
  currents: boolean;
  sst: boolean;
  plume: boolean;
  trajectories: boolean;
  graph: boolean;
  route: boolean;
  sentinel: boolean;
}

export type HorizonKey = '0' | '24' | '48' | '72';
export type BasemapMode = 'satellite' | 'dark';
