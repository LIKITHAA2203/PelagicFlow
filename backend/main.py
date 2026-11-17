"""
FastAPI Backend for Satellite-to-Sea AI Plastic Plume Predictor & Ocean Cleanup Router.
Ingests real-time ocean currents, SST, and wave vectors from Open-Meteo Marine API,
runs PyTorch Geometric (OceanPlasticSpatiotemporalGNN) + RK4 drift integration,
and computes optimal autonomous cleanup vessel interception coordinates.
"""

from __future__ import annotations

import math
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
import numpy as np
import torch
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from gnn_model import (
    NM_PER_METER,
    OceanNodeObs,
    OceanPlasticSpatiotemporalGNN,
    build_spatial_ocean_graph,
    compute_physical_convergence_concentration,
    haversine_meters,
    rk4_integrate_trajectory,
    velocity_to_uv,
)

load_dotenv()

_raw_marine_url = os.getenv("OPEN_METEO_MARINE_URL", "").strip()
OPEN_METEO_MARINE_URL = (
    _raw_marine_url
    if _raw_marine_url.startswith(("http://", "https://"))
    else "https://marine-api.open-meteo.com/v1/marine"
)

app = FastAPI(
    title="PelagicFlow GNN Ocean Cleanup API",
    version="1.0.0",
    description="Real-time Open-Meteo Marine ingestion + PyTorch Geometric plastic plume drift & cleanup router",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Instantiate PyTorch Geometric model in evaluation mode
torch.manual_seed(42)
GNN_MODEL = OceanPlasticSpatiotemporalGNN(in_channels=5, hidden_dim=64)
GNN_MODEL.eval()

ACCUMULATION_ZONES: List[Dict[str, Any]] = [
    {
        "id": "gpgp",
        "name": "Great Pacific Garbage Patch",
        "basin": "North Pacific Subtropical Gyre",
        "latMin": 30.0,
        "latMax": 40.0,
        "lonMin": -155.0,
        "lonMax": -135.0,
        "defaultVesselLat": 33.2,
        "defaultVesselLon": -149.5,
    },
    {
        "id": "bay_of_bengal",
        "name": "Bay of Bengal Accumulation Plume",
        "basin": "North Indian Ocean",
        "latMin": 10.0,
        "latMax": 20.0,
        "lonMin": 82.0,
        "lonMax": 92.0,
        "defaultVesselLat": 13.5,
        "defaultVesselLon": 84.0,
    },
    {
        "id": "north_atlantic",
        "name": "North Atlantic Gyre (Sargasso Sea)",
        "basin": "North Atlantic",
        "latMin": 25.0,
        "latMax": 35.0,
        "lonMin": -65.0,
        "lonMax": -50.0,
        "defaultVesselLat": 28.0,
        "defaultVesselLon": -61.5,
    },
    {
        "id": "south_pacific",
        "name": "South Pacific Convergence Zone",
        "basin": "South Pacific Gyre",
        "latMin": -32.0,
        "latMax": -22.0,
        "lonMin": -115.0,
        "lonMax": -95.0,
        "defaultVesselLat": -29.0,
        "defaultVesselLon": -108.0,
    },
    {
        "id": "mediterranean",
        "name": "Central Mediterranean Plastic Basin",
        "basin": "Mediterranean Sea",
        "latMin": 34.0,
        "latMax": 39.5,
        "lonMin": 11.5,
        "lonMax": 21.5,
        "defaultVesselLat": 36.2,
        "defaultVesselLon": 13.5,
    },
]


class PredictRequest(BaseModel):
    regionId: str = "gpgp"
    latMin: float = Field(30.0, ge=-75.0, le=75.0)
    latMax: float = Field(40.0, ge=-75.0, le=75.0)
    lonMin: float = Field(-155.0, ge=-180.0, le=180.0)
    lonMax: float = Field(-135.0, ge=-180.0, le=180.0)
    gridSize: int = Field(6, ge=4, le=8)
    vesselLat: float = 33.2
    vesselLon: float = -149.5
    vesselSpeedKnots: float = Field(10.0, ge=2.0, le=30.0)


@app.get("/api/health")
async def health_check() -> Dict[str, Any]:
    t0 = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                OPEN_METEO_MARINE_URL,
                params={
                    "latitude": 35.0,
                    "longitude": -145.0,
                    "current": "ocean_current_velocity,sea_surface_temperature",
                },
            )
            resp.raise_for_status()
        latency_ms = round((time.perf_counter() - t0) * 1000.0, 1)
        return {
            "status": "online",
            "engine": "pytorch_geometric",
            "openMeteoStatus": "connected",
            "latencyMs": latency_ms,
            "torchVersion": torch.__version__,
        }
    except Exception as exc:
        return {
            "status": "degraded",
            "engine": "pytorch_geometric",
            "openMeteoStatus": f"error: {exc}",
            "latencyMs": None,
        }


@app.get("/api/regions")
async def get_regions() -> Dict[str, Any]:
    return {"regions": ACCUMULATION_ZONES}


@app.post("/api/predict")
async def predict_plume_and_route(req: PredictRequest) -> Dict[str, Any]:
    if req.latMax <= req.latMin or req.lonMax <= req.lonMin:
        raise HTTPException(status_code=400, detail="Invalid lat/lon bounding box.")

    t_start = time.perf_counter()
    lats = np.linspace(req.latMin, req.latMax, req.gridSize)
    lons = np.linspace(req.lonMin, req.lonMax, req.gridSize)

    grid_coords = []
    for r, lat in enumerate(lats):
        for c, lon in enumerate(lons):
            grid_coords.append((r, c, round(float(lat), 4), round(float(lon), 4)))

    lat_param = ",".join(str(item[2]) for item in grid_coords)
    lon_param = ",".join(str(item[3]) for item in grid_coords)

    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.get(
            OPEN_METEO_MARINE_URL,
            params={
                "latitude": lat_param,
                "longitude": lon_param,
                "hourly": (
                    "ocean_current_velocity,ocean_current_direction,"
                    "sea_surface_temperature,wave_height,wave_direction"
                ),
                "forecast_days": 4,
                "timezone": "UTC",
            },
        )
        if resp.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"Open-Meteo Marine API returned {resp.status_code}: {resp.text[:200]}",
            )
        payload = resp.json()

    if not isinstance(payload, list):
        payload = [payload]

    ocean_nodes: List[OceanNodeObs] = []
    timestamps: List[str] = []

    for idx, item in enumerate(payload):
        hourly = item.get("hourly", {})
        if not timestamps and hourly.get("time"):
            timestamps = hourly["time"]

        vel_arr = hourly.get("ocean_current_velocity", [])
        dir_arr = hourly.get("ocean_current_direction", [])
        sst_arr = hourly.get("sea_surface_temperature", [])
        wh_arr = hourly.get("wave_height", [])
        wd_arr = hourly.get("wave_direction", [])

        # Skip land grid cells where marine data is null
        if not vel_arr or vel_arr[0] is None or sst_arr[0] is None:
            continue

        u_series: List[float] = []
        v_series: List[float] = []
        sst_series: List[float] = []
        wh_series: List[float] = []
        wd_series: List[float] = []

        for h in range(min(96, len(vel_arr))):
            spd = vel_arr[h] if vel_arr[h] is not None else vel_arr[0]
            dr = dir_arr[h] if dir_arr[h] is not None else (dir_arr[0] or 0.0)
            u, v = velocity_to_uv(spd, dr)
            u_series.append(u)
            v_series.append(v)
            sst_series.append(float(sst_arr[h] if sst_arr[h] is not None else sst_arr[0]))
            wh_series.append(float(wh_arr[h] if h < len(wh_arr) and wh_arr[h] is not None else 0.5))
            wd_series.append(float(wd_arr[h] if h < len(wd_arr) and wd_arr[h] is not None else 0.0))

        r, c, lat, lon = grid_coords[idx]
        ocean_nodes.append(
            OceanNodeObs(
                node_id=len(ocean_nodes),
                row=r,
                col=c,
                lat=lat,
                lon=lon,
                u_series=u_series,
                v_series=v_series,
                sst_series=sst_series,
                wave_h_series=wh_series,
                wave_dir_series=wd_series,
            )
        )

    if len(ocean_nodes) < 3:
        raise HTTPException(
            status_code=422,
            detail="Selected bounding box has fewer than 3 open-ocean telemetry nodes. Adjust coordinates seaward.",
        )

    # 1. Compute physical initial plastic convergence concentration from real velocity & SST fields
    conc0 = compute_physical_convergence_concentration(ocean_nodes)

    # 2. Construct PyTorch Geometric spatial graph
    pyg_data, edge_meta = build_spatial_ocean_graph(
        ocean_nodes, conc0, req.gridSize, req.gridSize
    )

    # 3. Extract real Open-Meteo (u, v) forecast frames at +24h, +48h, +72h
    horizon_indices = [24, 48, 72]
    future_uv = torch.tensor(
        [
            [[nd.u_series[min(h, len(nd.u_series) - 1)], nd.v_series[min(h, len(nd.v_series) - 1)]] for nd in ocean_nodes]
            for h in horizon_indices
        ],
        dtype=torch.float32,
    )

    # 4. Run Spatiotemporal GNN (SAGEConv + GCNConv + LSTM) rollout
    with torch.no_grad():
        gnn_preds = GNN_MODEL.forward_rollout(pyg_data, future_uv)

    # 5. Compute RK4 drift trajectories for top plume source nodes
    top_indices = np.argsort(-conc0)[: min(12, len(ocean_nodes))]
    trajectories = []
    for idx in top_indices:
        nd = ocean_nodes[int(idx)]
        pts = rk4_integrate_trajectory(nd.lat, nd.lon, ocean_nodes, total_hours=72, dt_hours=3.0)
        trajectories.append(
            {
                "nodeId": nd.node_id,
                "initialConcentration": round(float(conc0[int(idx)]), 3),
                "points": pts,
            }
        )

    # 6. Assemble horizon snapshots (0h, 24h, 48h, 72h)
    horizons: Dict[str, Any] = {}
    horizon_hours = [0, 24, 48, 72]
    for h_idx, h_val in enumerate(horizon_hours):
        state_tensor = pyg_data.x if h_idx == 0 else gnn_preds[h_idx - 1]
        node_records = []
        for n_i, nd in enumerate(ocean_nodes):
            st = state_tensor[n_i].tolist()
            u_val = nd.u_series[min(h_val, len(nd.u_series) - 1)]
            v_val = nd.v_series[min(h_val, len(nd.v_series) - 1)]
            node_records.append(
                {
                    "id": nd.node_id,
                    "gridLat": nd.lat,
                    "gridLon": nd.lon,
                    "lat": round(float(st[0]), 4),
                    "lon": round(float(st[1]), 4),
                    "u": round(float(u_val), 4),
                    "v": round(float(v_val), 4),
                    "speedMs": round(float(math.hypot(u_val, v_val)), 4),
                    "sst": round(float(nd.sst_series[min(h_val, len(nd.sst_series) - 1)]), 2),
                    "waveHeight": round(float(nd.wave_h_series[min(h_val, len(nd.wave_h_series) - 1)]), 2),
                    "waveDirection": round(float(nd.wave_dir_series[min(h_val, len(nd.wave_dir_series) - 1)]), 1),
                    "concentration": round(float(st[4]), 3),
                }
            )
        horizons[str(h_val)] = {
            "timestamp": timestamps[min(h_val, len(timestamps) - 1)] if timestamps else "",
            "nodes": node_records,
            "meanSpeedMs": round(float(np.mean([n["speedMs"] for n in node_records])), 4),
            "meanSstC": round(float(np.mean([n["sst"] for n in node_records])), 2),
            "meanWaveM": round(float(np.mean([n["waveHeight"] for n in node_records])), 2),
            "peakConcentration": round(float(max(n["concentration"] for n in node_records)), 3),
        }

    # 7. Optimize vessel interception route across predicted 24h -> 48h -> 72h hotspots
    route_waypoints = optimize_vessel_route(
        vessel_lat=req.vesselLat,
        vessel_lon=req.vesselLon,
        speed_knots=req.vesselSpeedKnots,
        horizons=horizons,
    )

    total_distance_nm = sum(wp["legDistanceNm"] for wp in route_waypoints)
    total_eta_hrs = route_waypoints[-1]["etaHours"] if route_waypoints else 0.0
    total_mass_index = round(sum(wp["concentration"] * 12.4 for wp in route_waypoints), 1)

    return {
        "meta": {
            "engine": "PyTorch Geometric (SAGEConv + GCNConv + LSTM) + RK4",
            "dataSource": "Open-Meteo Marine API (Copernicus / Mercator Ocean)",
            "fetchTimeMs": round((time.perf_counter() - t_start) * 1000.0, 1),
            "nodeCount": len(ocean_nodes),
            "edgeCount": len(edge_meta),
            "forecastIssuedUtc": timestamps[0] if timestamps else "",
        },
        "graphEdges": [
            {"source": s, "target": t, "weight": w} for s, t, w in edge_meta[:180]
        ],
        "horizons": horizons,
        "trajectories": trajectories,
        "vesselRoute": {
            "origin": {"lat": req.vesselLat, "lon": req.vesselLon},
            "speedKnots": req.vesselSpeedKnots,
            "totalDistanceNm": round(total_distance_nm, 1),
            "totalEtaHours": round(total_eta_hrs, 1),
            "estimatedYieldTonnes": total_mass_index,
            "waypoints": route_waypoints,
        },
    }


def optimize_vessel_route(
    vessel_lat: float,
    vessel_lon: float,
    speed_knots: float,
    horizons: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """
    Greedy yield-to-distance interception planner across 24h, 48h, and 72h GNN plume hotspots.
    """
    candidates: List[Dict[str, Any]] = []
    for h_str in ("24", "48", "72"):
        nodes = sorted(
            horizons[h_str]["nodes"], key=lambda n: n["concentration"], reverse=True
        )[:3]
        for n in nodes:
            candidates.append(
                {
                    "horizonHour": int(h_str),
                    "nodeId": n["id"],
                    "lat": n["lat"],
                    "lon": n["lon"],
                    "concentration": n["concentration"],
                    "sst": n["sst"],
                    "speedMs": n["speedMs"],
                }
            )

    selected: List[Dict[str, Any]] = []
    curr_lat, curr_lon = vessel_lat, vessel_lon
    elapsed_hrs = 0.0
    used_coords = set()

    for step in range(min(5, len(candidates))):
        best = None
        best_score = -1.0
        best_dist_nm = 0.0
        for cand in candidates:
            key = (round(cand["lat"], 2), round(cand["lon"], 2))
            if key in used_coords:
                continue
            dist_nm = haversine_meters(curr_lat, curr_lon, cand["lat"], cand["lon"]) * NM_PER_METER
            leg_hrs = dist_nm / max(1.0, speed_knots)
            eta_hrs = elapsed_hrs + leg_hrs
            # Time-window alignment bonus when ETA matches the predicted plume horizon
            horizon_penalty = 1.0 + abs(eta_hrs - cand["horizonHour"]) / 36.0
            score = (cand["concentration"] * 100.0) / ((1.0 + leg_hrs * 0.15) * horizon_penalty)
            if score > best_score:
                best_score = score
                best = cand
                best_dist_nm = dist_nm

        if best is None:
            break

        leg_hrs = best_dist_nm / max(1.0, speed_knots)
        elapsed_hrs += leg_hrs
        curr_lat, curr_lon = best["lat"], best["lon"]
        used_coords.add((round(curr_lat, 2), round(curr_lon, 2)))
        selected.append(
            {
                "order": step + 1,
                "horizonHour": best["horizonHour"],
                "lat": round(best["lat"], 4),
                "lon": round(best["lon"], 4),
                "concentration": best["concentration"],
                "sst": best["sst"],
                "legDistanceNm": round(best_dist_nm, 1),
                "etaHours": round(elapsed_hrs, 1),
            }
        )

    return selected


STATIC_DIR = Path(__file__).parent / "static"
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
async def serve_standalone_index() -> Any:
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return {"message": "PelagicFlow FastAPI GNN Backend Running. POST /api/predict"}
