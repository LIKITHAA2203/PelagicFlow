import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ACCUMULATION_ZONES,
  OPEN_METEO_MARINE_URL,
  runRealMarinePrediction,
  type PredictParams,
} from './src/server/oceanEngine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const FASTAPI_URL = (process.env.FASTAPI_URL || '').trim().replace(/\/$/, '');

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

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
        engine: 'spatial-gnn-rk4-node',
        openMeteoStatus: 'connected',
        latencyMs,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return res.status(502).json({
        status: 'degraded',
        engine: 'spatial-gnn-rk4-node',
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
        // Fallback to direct real Open-Meteo pipeline
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
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PelagicFlow server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
