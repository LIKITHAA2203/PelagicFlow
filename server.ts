import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  addUserFeedback,
  loadFeedbackRecords,
  loadModelWeights,
  runModelFineTuning,
  type FeedbackType,
  type RoutingStrategy,
} from './src/server/feedbackEngine.ts';
import {
  simulateAutonomousFleet,
  type VesselClassId,
} from './src/server/fleetSimulator.ts';
import {
  ACCUMULATION_ZONES,
  OPEN_METEO_MARINE_URL,
  runRealMarinePrediction,
  type PredictParams,
} from './src/server/oceanEngine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const portArgIdx = process.argv.indexOf('--port');
const cliPort = portArgIdx !== -1 ? Number(process.argv[portArgIdx + 1]) : NaN;
const PORT = Number.isFinite(cliPort)
  ? cliPort
  : Number(process.env.DEFAULT_APP_PORT || process.env.PORT || 3000);
const FASTAPI_URL = (process.env.FASTAPI_URL || '').trim().replace(/\/$/, '');

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Periodic background fine-tuning loop (runs every 5 minutes if new feedback exists)
  const fineTuneTimer = setInterval(() => {
    try {
      const res = runModelFineTuning(false);
      if (res.trained) {
        console.log(
          `[PelagicFlow] Periodic GNN fine-tuning v${res.weights.version}: MSE ${res.mseBefore} -> ${res.mseAfter}`
        );
      }
    } catch {
      // Non-fatal periodic trainer guard
    }
  }, 5 * 60 * 1000);
  fineTuneTimer.unref();

  app.get('/api/health', async (_req, res) => {
    const t0 = performance.now();
    if (FASTAPI_URL) {
      try {
        const up = await fetch(`${FASTAPI_URL}/api/health`, { signal: AbortSignal.timeout(4000) });
        if (up.ok) {
          const data = await up.json();
          return res.json({ ...data, gateway: 'express->fastapi' });
        }
      } catch {
        // Fallback to direct Open-Meteo Marine health probe
      }
    }

    try {
      const probe = await fetch(
        `${OPEN_METEO_MARINE_URL}?latitude=35.0&longitude=-145.0&current=ocean_current_velocity,sea_surface_temperature`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!probe.ok) {
        throw new Error(`HTTP ${probe.status}`);
      }
      const latencyMs = Number((performance.now() - t0).toFixed(1));
      return res.json({
        status: 'online',
        engine: 'spatial-gnn-rk4-sentinel2',
        openMeteoStatus: 'connected',
        latencyMs,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return res.status(502).json({
        status: 'degraded',
        engine: 'spatial-gnn-rk4-sentinel2',
        openMeteoStatus: msg,
        latencyMs: null,
      });
    }
  });

  app.get('/api/regions', (_req, res) => {
    res.json({ regions: ACCUMULATION_ZONES });
  });

  app.post('/api/predict', async (req, res) => {
    const body = req.body as Partial<PredictParams>;
    const latMin = Number(body.latMin);
    const latMax = Number(body.latMax);
    const lonMin = Number(body.lonMin);
    const lonMax = Number(body.lonMax);

    if (
      !Number.isFinite(latMin) ||
      !Number.isFinite(latMax) ||
      !Number.isFinite(lonMin) ||
      !Number.isFinite(lonMax) ||
      latMax <= latMin ||
      lonMax <= lonMin
    ) {
      return res.status(400).json({ error: 'Invalid latitude/longitude bounding box.' });
    }

    const params: PredictParams = {
      regionId: String(body.regionId || 'custom'),
      latMin,
      latMax,
      lonMin,
      lonMax,
      gridSize: Number(body.gridSize || 6),
      vesselLat: Number.isFinite(Number(body.vesselLat)) ? Number(body.vesselLat) : (latMin + latMax) / 2,
      vesselLon: Number.isFinite(Number(body.vesselLon)) ? Number(body.vesselLon) : (lonMin + lonMax) / 2,
      vesselSpeedKnots: Number(body.vesselSpeedKnots || 10),
      leewayFactor: Number.isFinite(Number(body.leewayFactor)) ? Number(body.leewayFactor) : 0.02,
      fleetSize: Number.isFinite(Number(body.fleetSize)) ? Number(body.fleetSize) : 2,
      vesselClass: (body.vesselClass as VesselClassId) || 'autonomous_sweeper',
      forceRefresh: Boolean(body.forceRefresh),
    };

    if (FASTAPI_URL) {
      try {
        const up = await fetch(`${FASTAPI_URL}/api/predict`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
          signal: AbortSignal.timeout(20_000),
        });
        if (up.ok) {
          const data = await up.json();
          return res.json(data);
        }
      } catch {
        // Fallback to direct real Open-Meteo + Sentinel-2 pipeline
      }
    }

    try {
      const prediction = await runRealMarinePrediction(params);
      return res.json(prediction);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Prediction pipeline error';
      return res.status(502).json({ error: msg });
    }
  });

  app.get('/api/feedback', (_req, res) => {
    res.json({
      feedback: loadFeedbackRecords(),
      weights: loadModelWeights(),
    });
  });

  app.post('/api/feedback', (req, res) => {
    const b = req.body || {};
    const lat = Number(b.lat);
    const lon = Number(b.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ error: 'Valid latitude and longitude are required.' });
    }

    const record = addUserFeedback({
      regionId: String(b.regionId || 'gpgp'),
      feedbackType: (b.feedbackType as FeedbackType) || 'density_discrepancy',
      lat,
      lon,
      predictedIndex: Number.isFinite(Number(b.predictedIndex)) ? Number(b.predictedIndex) : 0.5,
      observedIndex: Number.isFinite(Number(b.observedIndex)) ? Number(b.observedIndex) : 0.5,
      preferredRoutingStrategy: (b.preferredRoutingStrategy as RoutingStrategy) || 'balanced',
      notes: String(b.notes || ''),
    });

    res.json({
      record,
      feedbackCount: loadFeedbackRecords().length,
      weights: loadModelWeights(),
    });
  });

  app.post('/api/model/finetune', (req, res) => {
    const force = Boolean(req.body?.force ?? true);
    const result = runModelFineTuning(force);
    res.json(result);
  });

  app.post('/api/simulate-fleet', (req, res) => {
    const b = req.body || {};
    if (!b.horizons || !Array.isArray(b.waypoints)) {
      return res.status(400).json({ error: 'Horizons and waypoints are required for fleet simulation.' });
    }
    const sim = simulateAutonomousFleet(
      {
        fleetSize: Number(b.fleetSize || 2),
        vesselClass: (b.vesselClass as VesselClassId) || 'autonomous_sweeper',
        horizonHours: Number(b.horizonHours || 72),
        originLat: Number(b.originLat || 0),
        originLon: Number(b.originLon || 0),
      },
      b.horizons,
      b.waypoints
    );
    res.json(sim);
  });

  app.get('/api/backend-files', (_req, res) => {
    const backendDir = path.join(__dirname, 'backend');
    const files = [
      { key: 'gnn_model.py', rel: 'gnn_model.py', lang: 'python' },
      { key: 'main.py', rel: 'main.py', lang: 'python' },
      { key: 'requirements.txt', rel: 'requirements.txt', lang: 'text' },
      { key: 'static/index.html', rel: 'static/index.html', lang: 'html' },
      { key: 'static/app.js', rel: 'static/app.js', lang: 'javascript' },
      { key: 'README.md', rel: 'README.md', lang: 'markdown' },
    ];
    const result = files.map((f) => {
      const fullPath = path.join(backendDir, f.rel);
      const content = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf-8') : '';
      return { name: f.key, lang: f.lang, content };
    });
    res.json({ files: result });
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    app.get('/@vite/client', (_req, res) => {
      res.type('application/javascript').send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  } else {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url) { return url; }
export class ErrorOverlay {}
`);
    });

    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PelagicFlow server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
