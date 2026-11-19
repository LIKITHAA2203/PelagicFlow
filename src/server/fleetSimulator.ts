import type { HorizonSnapshot, VesselWaypoint } from '../types/ocean.ts';

export type VesselClassId = 'solar_catamaran' | 'autonomous_sweeper' | 'heavy_collector';

export interface FleetSimConfig {
  fleetSize: number;
  vesselClass: VesselClassId;
  horizonHours: number;
  originLat: number;
  originLon: number;
}

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
  config: FleetSimConfig;
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

interface VesselSpec {
  label: string;
  cruiseKnots: number;
  sweepWidthM: number;
  basePowerKw: number;
  solarOffsetKw: number;
  hourlyCostUsd: number;
  energyCostPerKwhUsd: number;
  baseCaptureEfficiency: number;
}

const VESSEL_SPECS: Record<VesselClassId, VesselSpec> = {
  solar_catamaran: {
    label: 'Solar-Hybrid Catamaran',
    cruiseKnots: 8.0,
    sweepWidthM: 18,
    basePowerKw: 26,
    solarOffsetKw: 9,
    hourlyCostUsd: 115,
    energyCostPerKwhUsd: 0.18,
    baseCaptureEfficiency: 0.82,
  },
  autonomous_sweeper: {
    label: 'Autonomous Ocean Sweeper',
    cruiseKnots: 11.0,
    sweepWidthM: 28,
    basePowerKw: 62,
    solarOffsetKw: 6,
    hourlyCostUsd: 195,
    energyCostPerKwhUsd: 0.24,
    baseCaptureEfficiency: 0.88,
  },
  heavy_collector: {
    label: 'Gyre High-Capacity Collector',
    cruiseKnots: 14.0,
    sweepWidthM: 45,
    basePowerKw: 132,
    solarOffsetKw: 0,
    hourlyCostUsd: 360,
    energyCostPerKwhUsd: 0.28,
    baseCaptureEfficiency: 0.91,
  },
};

const EARTH_RADIUS_M = 6_371_000;
const NM_PER_M = 1 / 1852;
const MS_TO_KNOTS = 1.94384;

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const p1 = lat1 * r;
  const p2 = lat2 * r;
  const dp = (lat2 - lat1) * r;
  const dl = (lon2 - lon1) * r;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(1e-12, 1 - a)));
}

function interpolateLocalOcean(
  lat: number,
  lon: number,
  snapshot: HorizonSnapshot
): { u: number; v: number; waveHeight: number; convergenceIndex: number } {
  let uAcc = 0;
  let vAcc = 0;
  let whAcc = 0;
  let cAcc = 0;
  let wAcc = 0;

  for (const nd of snapshot.nodes) {
    const dLat = lat - nd.lat;
    const dLon = (lon - nd.lon) * Math.cos((lat * Math.PI) / 180);
    const w = 1 / (dLat * dLat + dLon * dLon + 0.08);
    uAcc += w * nd.u;
    vAcc += w * nd.v;
    whAcc += w * nd.waveHeight;
    cAcc += w * nd.convergenceIndex;
    wAcc += w;
  }
  return wAcc > 0
    ? { u: uAcc / wAcc, v: vAcc / wAcc, waveHeight: whAcc / wAcc, convergenceIndex: cAcc / wAcc }
    : { u: 0, v: 0, waveHeight: 1.0, convergenceIndex: 0.3 };
}

export function simulateAutonomousFleet(
  config: FleetSimConfig,
  horizons: Record<string, HorizonSnapshot>,
  primaryWaypoints: VesselWaypoint[]
): FleetSimulationResult {
  const fleetSize = Math.min(4, Math.max(1, Math.round(config.fleetSize || 2)));
  const totalHours = Math.min(72, Math.max(24, Math.round(config.horizonHours || 72)));
  const spec = VESSEL_SPECS[config.vesselClass] || VESSEL_SPECS.autonomous_sweeper;

  // Build target pool from high-convergence GNN nodes across 24h, 48h, 72h + primary waypoints
  const targetPool: Array<{
    id: number;
    lat: number;
    lon: number;
    convergence: number;
    massKg: number;
  }> = [];

  const seen = new Set<string>();
  primaryWaypoints.forEach((wp) => {
    const k = `${wp.lat.toFixed(1)}:${wp.lon.toFixed(1)}`;
    seen.add(k);
    targetPool.push({
      id: wp.order,
      lat: wp.lat,
      lon: wp.lon,
      convergence: wp.convergenceIndex,
      massKg: wp.convergenceIndex * 1850,
    });
  });

  const extraNodes = [...(horizons['48']?.nodes || [])]
    .sort((a, b) => b.convergenceIndex - a.convergenceIndex)
    .slice(0, 8);
  extraNodes.forEach((nd) => {
    const k = `${nd.lat.toFixed(1)}:${nd.lon.toFixed(1)}`;
    if (seen.has(k) || targetPool.length >= 10) return;
    seen.add(k);
    targetPool.push({
      id: targetPool.length + 1,
      lat: nd.lat,
      lon: nd.lon,
      convergence: nd.convergenceIndex,
      massKg: nd.convergenceIndex * 1450,
    });
  });

  // Partition targets round-robin by spatial sector across the virtual fleet
  const sortedTargets = [...targetPool].sort((a, b) => a.lon - b.lon || a.lat - b.lat);
  const vesselQueues: typeof targetPool[] = Array.from({ length: fleetSize }, () => []);
  sortedTargets.forEach((t, idx) => {
    vesselQueues[idx % fleetSize].push(t);
  });

  const totalPlumeTargetKg = Math.max(
    500,
    targetPool.reduce((s, t) => s + t.massKg, 0)
  );

  // Spread vessel starting positions slightly around origin for realistic multi-vessel launch
  const vessels: SimulatedVesselResult[] = vesselQueues.map((queue, vIdx) => {
    const offsetLat = (vIdx - (fleetSize - 1) / 2) * 0.25;
    const offsetLon = (vIdx % 2 === 0 ? -1 : 1) * vIdx * 0.2;
    let lat = config.originLat + offsetLat;
    let lon = config.originLon + offsetLon;

    let queueIdx = 0;
    let distanceNm = 0;
    let energyUsedKwh = 0;
    let capturedPlasticKg = 0;
    const effSamples: number[] = [];
    const capturedTargets = new Set<number>();

    const track: VesselTrackPoint[] = [
      {
        hour: 0,
        lat: Number(lat.toFixed(4)),
        lon: Number(lon.toFixed(4)),
        speedKnots: spec.cruiseKnots,
        waveHeightM: horizons['0']?.meanWaveM ?? 1.0,
        captureEfficiencyPct: Number((spec.baseCaptureEfficiency * 100).toFixed(1)),
        cumulativeCapturedKg: 0,
        energyUsedKwh: 0,
      },
    ];

    for (let hr = 1; hr <= totalHours; hr++) {
      const snapKey = hr <= 12 ? '0' : hr <= 36 ? '24' : hr <= 60 ? '48' : '72';
      const snap = horizons[snapKey] || horizons['24'] || horizons['0'];
      const local = interpolateLocalOcean(lat, lon, snap);

      // Sea-state added resistance & capture efficiency degradation above 1.0m wave height
      const wavePenalty = Math.max(0, local.waveHeight - 1.0);
      const captureEff = Math.max(
        0.32,
        spec.baseCaptureEfficiency * Math.exp(-0.22 * wavePenalty)
      );
      effSamples.push(captureEff);

      const target = queue[queueIdx];
      let actualGroundSpeedKnots = spec.cruiseKnots;

      if (target) {
        const distM = haversineMeters(lat, lon, target.lat, target.lon);
        const distNm = distM * NM_PER_M;

        // Current velocity component along vessel heading
        const bearingRad = Math.atan2(
          (target.lon - lon) * Math.cos((lat * Math.PI) / 180),
          target.lat - lat
        );
        const currentAlongMs =
          local.u * Math.sin(bearingRad) + local.v * Math.cos(bearingRad);
        actualGroundSpeedKnots = Math.max(
          3.5,
          spec.cruiseKnots + currentAlongMs * MS_TO_KNOTS * 0.75
        );

        const stepNm = Math.min(distNm, actualGroundSpeedKnots);
        const frac = distNm > 1e-4 ? stepNm / distNm : 1;
        lat += (target.lat - lat) * frac;
        lon += (target.lon - lon) * frac;
        distanceNm += stepNm;

        // Harvest ambient corridor debris during transit + main hotspot capture on arrival
        const ambientHarvestKg =
          local.convergenceIndex * (spec.sweepWidthM / 20) * captureEff * 16.5;
        capturedPlasticKg += ambientHarvestKg;

        if (distNm - stepNm <= 12 && !capturedTargets.has(target.id)) {
          capturedTargets.add(target.id);
          capturedPlasticKg += target.massKg * captureEff;
          queueIdx++;
        }
      } else {
        // Patrol sweep along local convergence gradient after completing queue
        actualGroundSpeedKnots = spec.cruiseKnots * 0.65;
        const stepNm = actualGroundSpeedKnots;
        distanceNm += stepNm;
        capturedPlasticKg +=
          local.convergenceIndex * (spec.sweepWidthM / 20) * captureEff * 14.0;
      }

      // Cubic propulsion power law + wave drag - solar offset
      const speedRatio = actualGroundSpeedKnots / spec.cruiseKnots;
      const waveDragFactor = 1 + 0.16 * wavePenalty;
      const netPowerKw = Math.max(
        8,
        spec.basePowerKw * Math.pow(speedRatio, 2.4) * waveDragFactor - spec.solarOffsetKw
      );
      energyUsedKwh += netPowerKw;

      if (hr % 6 === 0 || hr === totalHours) {
        track.push({
          hour: hr,
          lat: Number(lat.toFixed(4)),
          lon: Number(lon.toFixed(4)),
          speedKnots: Number(actualGroundSpeedKnots.toFixed(1)),
          waveHeightM: Number(local.waveHeight.toFixed(2)),
          captureEfficiencyPct: Number((captureEff * 100).toFixed(1)),
          cumulativeCapturedKg: Number(capturedPlasticKg.toFixed(1)),
          energyUsedKwh: Number(energyUsedKwh.toFixed(1)),
        });
      }
    }

    const opCostUsd =
      totalHours * spec.hourlyCostUsd + energyUsedKwh * spec.energyCostPerKwhUsd;
    const meanEff =
      effSamples.length > 0
        ? (effSamples.reduce((s, e) => s + e, 0) / effSamples.length) * 100
        : spec.baseCaptureEfficiency * 100;

    return {
      vesselId: `USV-${vIdx + 1}`,
      name: `Vessel ${vIdx + 1} (${spec.label.split(' ')[0]})`,
      vesselClass: spec.label,
      assignedWaypoints: queue.map((q) => q.id),
      distanceNm: Number(distanceNm.toFixed(1)),
      energyUsedKwh: Number(energyUsedKwh.toFixed(1)),
      operationalCostUsd: Number(opCostUsd.toFixed(0)),
      capturedPlasticKg: Number(capturedPlasticKg.toFixed(1)),
      meanCaptureEfficiencyPct: Number(meanEff.toFixed(1)),
      track,
    };
  });

  const totalCapturedKg = vessels.reduce((s, v) => s + v.capturedPlasticKg, 0);
  const totalDistanceNm = vessels.reduce((s, v) => s + v.distanceNm, 0);
  const totalEnergyKwh = vessels.reduce((s, v) => s + v.energyUsedKwh, 0);
  const totalOperationalCostUsd = vessels.reduce((s, v) => s + v.operationalCostUsd, 0);
  const meanEffPct =
    vessels.reduce((s, v) => s + v.meanCaptureEfficiencyPct, 0) / vessels.length;
  const successRatePct = Math.min(98.5, (totalCapturedKg / totalPlumeTargetKg) * 100);

  return {
    config: { ...config, fleetSize, horizonHours: totalHours },
    summary: {
      cleanupSuccessRatePct: Number(successRatePct.toFixed(1)),
      totalCapturedKg: Number(totalCapturedKg.toFixed(1)),
      totalPlumeTargetKg: Number(totalPlumeTargetKg.toFixed(1)),
      totalDistanceNm: Number(totalDistanceNm.toFixed(1)),
      totalEnergyKwh: Number(totalEnergyKwh.toFixed(1)),
      totalOperationalCostUsd: Number(totalOperationalCostUsd.toFixed(0)),
      costPerKgUsd: Number((totalOperationalCostUsd / Math.max(1, totalCapturedKg)).toFixed(2)),
      meanSeaStateWaveM: horizons['24']?.meanWaveM ?? 1.0,
      meanCollectionEfficiencyPct: Number(meanEffPct.toFixed(1)),
    },
    vessels,
  };
}
