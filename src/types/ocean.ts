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
  s2FdiScore: number;
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

export interface SentinelDetection {
  lat: number;
  lon: number;
  fdi: number;
  ndvi: number;
  confidence: number;
  sceneId: string;
  mgrsTile: string;
  datetime: string;
}

export type FeedbackType = 'density_discrepancy' | 'drift_offset' | 'routing_suggestion';
export type RoutingStrategy = 'balanced' | 'max_yield' | 'min_energy' | 'fastest_intercept';

export interface UserFeedbackRecord {
  id: string;
  createdAt: string;
  regionId: string;
  feedbackType: FeedbackType;
  lat: number;
  lon: number;
  predictedIndex: number;
  observedIndex: number;
  preferredRoutingStrategy: RoutingStrategy;
  notes: string;
  usedInTraining: boolean;
}

export interface TunableModelWeights {
  version: number;
  lastTrainedAt: string | null;
  trainingRuns: number;
  feedbackSamplesTrained: number;
  lastTrainMseBefore: number | null;
  lastTrainMseAfter: number | null;
  wConvergence: number;
  wSstFront: number;
  wStagnation: number;
  wSentinelFdi: number;
  leewayCalibrationScale: number;
  gnnAdvectionMix: number;
  routingStrategy: RoutingStrategy;
  routeYieldWeight: number;
  routeDistancePenalty: number;
  routeHorizonPenaltyWeight: number;
}

export type VesselClassId = 'solar_catamaran' | 'autonomous_sweeper' | 'heavy_collector';

export interface VesselTrackPoint {
  hour: number;
  lat: number;
  lon: number;
  speedKnots: number;
  waveHeightM: number;
  captureEfficiencyPct: number;
  cumulativeCapturedKg: number;
  energyUsedKwh: number;
}

export interface SimulatedVesselResult {
  vesselId: string;
  name: string;
  vesselClass: string;
  assignedWaypoints: number[];
  distanceNm: number;
  energyUsedKwh: number;
  operationalCostUsd: number;
  capturedPlasticKg: number;
  meanCaptureEfficiencyPct: number;
  track: VesselTrackPoint[];
}

export interface FleetSimulationResult {
  config: {
    fleetSize: number;
    vesselClass: VesselClassId;
    horizonHours: number;
    originLat: number;
    originLon: number;
  };
  summary: {
    cleanupSuccessRatePct: number;
    totalCapturedKg: number;
    totalPlumeTargetKg: number;
    totalDistanceNm: number;
    totalEnergyKwh: number;
    totalOperationalCostUsd: number;
    costPerKgUsd: number;
    meanSeaStateWaveM: number;
    meanCollectionEfficiencyPct: number;
  };
  vessels: SimulatedVesselResult[];
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
    ingestedAtUtc: string;
    latestSentinelUtc: string | null;
    leewayFactor: number;
    sentinelSceneCount: number;
    sentinelDetectionCount: number;
    cloudFreeWaterRatio: number;
    modelVersion: number;
    routingStrategy: RoutingStrategy;
  };
  graphEdges: GraphEdge[];
  horizons: Record<string, HorizonSnapshot>;
  trajectories: PlumeTrajectory[];
  sentinelScenes: SentinelScene[];
  sentinelDetections: SentinelDetection[];
  vesselRoute: {
    origin: { lat: number; lon: number };
    speedKnots: number;
    totalDistanceNm: number;
    totalEtaHours: number;
    meanTargetConvergence: number;
    waypoints: VesselWaypoint[];
  };
  fleetSimulation: FleetSimulationResult;
}

export interface LayerVisibility {
  currents: boolean;
  sst: boolean;
  plume: boolean;
  trajectories: boolean;
  graph: boolean;
  route: boolean;
  sentinel: boolean;
  detections: boolean;
  fleet: boolean;
}

export type HorizonKey = '0' | '24' | '48' | '72';
export type BasemapMode = 'satellite' | 'dark';
