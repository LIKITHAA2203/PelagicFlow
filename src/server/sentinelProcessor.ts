import { fromUrl } from 'geotiff';
import type { SentinelScene } from '../types/ocean.ts';

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

export interface SentinelAnalysisResult {
  scenes: SentinelScene[];
  detections: SentinelDetection[];
  nodeFdiScores: number[];
  cloudFreeWaterRatio: number;
  spectralModel: string;
}

const SENTINEL_STAC_URL = 'https://earth-search.aws.element84.com/v1/search';

// Biermann et al. (2020) linear baseline factor: (833nm - 740nm) / (1610nm - 740nm)
const FDI_WAVELENGTH_FACTOR = (833 - 740) / (1610 - 740);

export async function analyzeSentinel2ForGrid(
  latMin: number,
  latMax: number,
  lonMin: number,
  lonMax: number,
  oceanNodes: Array<{ lat: number; lon: number }>
): Promise<SentinelAnalysisResult> {
  const emptyResult: SentinelAnalysisResult = {
    scenes: [],
    detections: [],
    nodeFdiScores: new Array<number>(oceanNodes.length).fill(0),
    cloudFreeWaterRatio: 0,
    spectralModel: 'Sentinel-2 L2A COG Spectral FDI (B04/B06/B08/B11 + SCL Water Mask)',
  };

  try {
    // Prefer low-cloud scenes first; fallback to latest scenes if none < 45%
    let features: any[] = [];
    const clearResp = await fetch(SENTINEL_STAC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collections: ['sentinel-2-l2a'],
        bbox: [lonMin, latMin, lonMax, latMax],
        query: { 'eo:cloud_cover': { lt: 45 } },
        limit: 10,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (clearResp.ok) {
      const clearData = (await clearResp.json()) as { features?: any[] };
      if (Array.isArray(clearData.features)) features = clearData.features;
    }

    if (features.length === 0) {
      const fallbackResp = await fetch(SENTINEL_STAC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collections: ['sentinel-2-l2a'],
          bbox: [lonMin, latMin, lonMax, latMax],
          limit: 10,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (fallbackResp.ok) {
        const fbData = (await fallbackResp.json()) as { features?: any[] };
        if (Array.isArray(fbData.features)) features = fbData.features;
      }
    }

    const validFeatures = features.filter(
      (f) => f?.geometry?.type === 'Polygon' && Array.isArray(f?.geometry?.coordinates)
    );

    const gridCenterLat = (latMin + latMax) / 2;
    const gridCenterLon = (lonMin + lonMax) / 2;

    // Score scenes by proximity to ocean grid center and low cloud cover
    const rankedFeatures = [...validFeatures].sort((a, b) => {
      const score = (f: any) => {
        const bBox = (f.bbox || [lonMin, latMin, lonMax, latMax]) as [number, number, number, number];
        const cLon = (bBox[0] + bBox[2]) / 2;
        const cLat = (bBox[1] + bBox[3]) / 2;
        const dist = Math.hypot(cLat - gridCenterLat, cLon - gridCenterLon);
        const cloud = Number(f.properties?.['eo:cloud_cover'] ?? 50);
        return cloud * 0.15 + dist;
      };
      return score(a) - score(b);
    });

    const scenes: SentinelScene[] = rankedFeatures.slice(0, 6).map((f) => {
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

    if (rankedFeatures.length === 0) {
      return emptyResult;
    }

    // Sample COG spectral overviews on up to 3 top-ranked scenes
    const scenesToProcess = rankedFeatures.slice(0, 3);

    const detections: SentinelDetection[] = [];
    let totalValidPixels = 0;
    let totalWaterPixels = 0;

    const sampleDim = 24;

    await Promise.all(
      scenesToProcess.map(async (f) => {
        const assets = f.assets || {};
        const redHref = assets.red?.href;
        const re2Href = assets.rededge2?.href;
        const nirHref = assets.nir?.href;
        const swirHref = assets.swir16?.href;
        const sclHref = assets.scl?.href;

        if (!redHref || !re2Href || !nirHref || !swirHref || !sclHref) return;

        try {
          const [t4, t6, t8, t11, tScl] = await Promise.all([
            fromUrl(redHref),
            fromUrl(re2Href),
            fromUrl(nirHref),
            fromUrl(swirHref),
            fromUrl(sclHref),
          ]);

          const [r4, r6, r8, r11, rScl] = await Promise.all([
            t4.readRasters({ width: sampleDim, height: sampleDim }),
            t6.readRasters({ width: sampleDim, height: sampleDim }),
            t8.readRasters({ width: sampleDim, height: sampleDim }),
            t11.readRasters({ width: sampleDim, height: sampleDim }),
            tScl.readRasters({ width: sampleDim, height: sampleDim }),
          ]);

          const b4 = r4[0] as Uint16Array | Float32Array;
          const b6 = r6[0] as Uint16Array | Float32Array;
          const b8 = r8[0] as Uint16Array | Float32Array;
          const b11 = r11[0] as Uint16Array | Float32Array;
          const scl = rScl[0] as Uint8Array | Uint16Array;

          const sBbox = (f.bbox || [lonMin, latMin, lonMax, latMax]) as [number, number, number, number];
          const [sMinLon, sMinLat, sMaxLon, sMaxLat] = sBbox;
          const props = f.properties || {};
          const baselineNum = parseFloat(String(props['s2:processing_baseline'] || '04.00'));
          // Element84 Earth Search v1 pre-corrects the +1000 BOA offset when earthsearch:boa_offset_applied === true
          const offset = props['earthsearch:boa_offset_applied'] === true ? 0 : baselineNum >= 4.0 ? 1000 : 0;
          const mgrsTile = String(props['grid:code'] || 'S2');

          for (let row = 0; row < sampleDim; row++) {
            for (let col = 0; col < sampleDim; col++) {
              const idx = row * sampleDim + col;
              const sclCode = scl[idx];
              if (sclCode === 0) continue; // No-data
              totalValidPixels++;

              // SCL === 6 is Open Water in Sentinel-2 L2A Scene Classification
              if (sclCode !== 6) continue;
              totalWaterPixels++;

              const red = Math.max(0, (b4[idx] - offset) / 10000);
              const re2 = Math.max(0, (b6[idx] - offset) / 10000);
              const nir = Math.max(0, (b8[idx] - offset) / 10000);
              const swir = Math.max(0, (b11[idx] - offset) / 10000);

              // Floating Debris Index (FDI) linear baseline interpolation between RE2 (740nm) and SWIR1 (1610nm)
              const nirPrime = re2 + (swir - re2) * FDI_WAVELENGTH_FACTOR;
              const fdi = nir - nirPrime;
              const ndvi = (nir - red) / (nir + red + 1e-6);

              // Map pixel center to WGS84 coordinates aligned with scene bounding box
              const lat = sMaxLat - ((row + 0.5) / sampleDim) * (sMaxLat - sMinLat);
              const lon = sMinLon + ((col + 0.5) / sampleDim) * (sMaxLon - sMinLon);

              if (lat < latMin || lat > latMax || lon < lonMin || lon > lonMax) continue;

              // Spectral signature of floating polymer debris vs pure water & chlorophyll algae
              if (fdi > 0.0025 && ndvi > -0.22 && ndvi < 0.25) {
                const confidence = Math.min(0.96, Math.max(0.25, fdi * 24.0));
                detections.push({
                  lat: Number(lat.toFixed(4)),
                  lon: Number(lon.toFixed(4)),
                  fdi: Number(fdi.toFixed(4)),
                  ndvi: Number(ndvi.toFixed(3)),
                  confidence: Number(confidence.toFixed(3)),
                  sceneId: String(f.id || ''),
                  mgrsTile,
                  datetime: String(props.datetime || ''),
                });
              }
            }
          }
        } catch {
          // Non-fatal single scene COG timeout
        }
      })
    );

    // Spatially align Sentinel-2 FDI detections onto Ocean Current GNN grid nodes
    const nodeFdiScores = oceanNodes.map((nd) => {
      if (detections.length === 0) return 0;
      let weightedSum = 0;
      let weightTotal = 0;
      for (const det of detections) {
        const dLat = nd.lat - det.lat;
        const dLon = (nd.lon - det.lon) * Math.cos((nd.lat * Math.PI) / 180);
        const distDeg2 = dLat * dLat + dLon * dLon;
        if (distDeg2 > 4.0) continue; // ~220km spatial alignment kernel cutoff
        const w = Math.exp(-distDeg2 / 0.45);
        weightedSum += w * det.confidence;
        weightTotal += w;
      }
      return weightTotal > 1e-6 ? Number(Math.min(1, weightedSum / Math.max(1, weightTotal * 0.65)).toFixed(3)) : 0;
    });

    return {
      scenes,
      detections: detections.slice(0, 120),
      nodeFdiScores,
      cloudFreeWaterRatio:
        totalValidPixels > 0 ? Number((totalWaterPixels / totalValidPixels).toFixed(3)) : 0,
      spectralModel: 'Sentinel-2 L2A COG Spectral FDI (B04/B06/B08/B11 + SCL Water Mask)',
    };
  } catch {
    return emptyResult;
  }
}
