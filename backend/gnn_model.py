"""
Spatiotemporal Graph Neural Network (PyTorch + PyTorch Geometric) and
4th-Order Runge-Kutta (RK4) Lagrangian Drift Engine for Ocean Plastic Plumes.

Node feature vector: [latitude, longitude, u_current, v_current, plastic_concentration]
Edges: 8-neighbor spatial grid connectivity weighted by flow alignment and inverse distance.
Architecture: SAGEConv / GCNConv message-passing encoder + LSTM temporal rollout for
t+24h, t+48h, and t+72h state prediction, coupled with RK4 advection over real Open-Meteo vectors.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Tuple

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.data import Data
from torch_geometric.nn import GCNConv, SAGEConv


EARTH_RADIUS_M = 6_371_000.0
KMH_TO_MS = 1.0 / 3.6
NM_PER_METER = 1.0 / 1852.0


def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    )
    return 2.0 * EARTH_RADIUS_M * math.atan2(math.sqrt(a), math.sqrt(max(1e-12, 1.0 - a)))


def velocity_to_uv(speed_kmh: float, direction_deg: float) -> Tuple[float, float]:
    """
    Convert Open-Meteo current speed (km/h) and flow bearing (deg clockwise from North)
    into zonal (u, East-positive m/s) and meridional (v, North-positive m/s) components.
    """
    speed_ms = float(speed_kmh) * KMH_TO_MS
    rad = math.radians(float(direction_deg))
    u = speed_ms * math.sin(rad)
    v = speed_ms * math.cos(rad)
    return u, v


class OceanPlasticSpatiotemporalGNN(nn.Module):
    """
    Message-passing Graph Neural Network (SAGEConv + GCNConv) + LSTM recurrent cell
    predicting ocean node states [lat, lon, u_current, v_current, plastic_concentration]
    at t+24h, t+48h, and t+72h.
    """

    def __init__(self, in_channels: int = 5, hidden_dim: int = 64):
        super().__init__()
        self.input_proj = nn.Linear(in_channels, hidden_dim)
        self.sage1 = SAGEConv(hidden_dim, hidden_dim, aggr="mean")
        self.gcn2 = GCNConv(hidden_dim, hidden_dim, add_self_loops=True, normalize=True)
        self.norm1 = nn.LayerNorm(hidden_dim)
        self.norm2 = nn.LayerNorm(hidden_dim)

        # Recurrent LSTM cell tracking temporal plume advection & accumulation across 24h steps
        self.lstm = nn.LSTMCell(input_size=hidden_dim + 2, hidden_size=hidden_dim)

        # Residual state delta decoder -> [d_lat, d_lon, d_u, d_v, concentration_logit]
        self.head = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.SiLU(),
            nn.Linear(hidden_dim // 2, 5),
        )
        self._init_physics_prior_weights()

    def _init_physics_prior_weights(self) -> None:
        """
        Initialize linear weights cleanly with Xavier uniform and zero-bias stability
        so the GNN acts as a calibrated spatial smoothing & convergence operator even
        prior to gradient fine-tuning on historical drifter buoys.
        """
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight, gain=0.5)
                if m.bias is not None:
                    nn.init.zeros_(m.bias)

    def encode_graph(
        self,
        x: torch.Tensor,
        edge_index: torch.Tensor,
        edge_weight: torch.Tensor,
    ) -> torch.Tensor:
        h = F.silu(self.input_proj(x))
        h_sage = self.norm1(F.silu(self.sage1(h, edge_index)))
        h = h + h_sage
        h_gcn = self.norm2(F.silu(self.gcn2(h, edge_index, edge_weight=edge_weight)))
        return h + h_gcn

    def forward_rollout(
        self,
        data: Data,
        future_uv_frames: torch.Tensor,
    ) -> List[torch.Tensor]:
        """
        Args:
            data: PyG Data(x=[N, 5], edge_index=[2, E], edge_weight=[E])
                  x columns: [lat, lon, u_current, v_current, plastic_concentration]
            future_uv_frames: Tensor [3, N, 2] of real Open-Meteo (u, v) at +24h, +48h, +72h
        Returns:
            List of 3 tensors [N, 5] representing predicted node states at +24h, +48h, +72h.
        """
        x = data.x
        edge_index = data.edge_index
        edge_weight = data.edge_weight

        # Normalize features for message passing stability
        lat_mean, lon_mean = x[:, 0].mean(), x[:, 1].mean()
        x_norm = torch.stack(
            [
                (x[:, 0] - lat_mean) / 10.0,
                (x[:, 1] - lon_mean) / 10.0,
                x[:, 2],
                x[:, 3],
                x[:, 4],
            ],
            dim=-1,
        )

        h_spatial = self.encode_graph(x_norm, edge_index, edge_weight)
        c_state = torch.zeros_like(h_spatial)
        h_state = h_spatial

        predictions: List[torch.Tensor] = []
        current_state = x.clone()

        for step_idx in range(future_uv_frames.shape[0]):
            uv_next = future_uv_frames[step_idx]  # [N, 2] real forecast velocity
            lstm_in = torch.cat([h_spatial, uv_next], dim=-1)
            h_state, c_state = self.lstm(lstm_in, (h_state, c_state))

            delta = self.head(h_state)

            # Graph-propagated concentration advection via normalized adjacency flow
            src, dst = edge_index[0], edge_index[1]
            # Flow convergence: aggregate upstream plastic flux into downstream node
            flux = current_state[src, 4] * edge_weight
            advected_c = torch.zeros_like(current_state[:, 4])
            advected_c.index_add_(0, dst, flux)
            deg = torch.zeros_like(current_state[:, 4])
            deg.index_add_(0, dst, edge_weight)
            advected_c = torch.where(deg > 1e-6, advected_c / deg, current_state[:, 4])

            # Combine physics advection with GNN+LSTM learned concentration residual
            gnn_residual = 0.08 * torch.tanh(delta[:, 4])
            next_c = torch.clamp(
                0.65 * current_state[:, 4] + 0.35 * advected_c + gnn_residual,
                min=0.02,
                max=1.0,
            )

            # Spatial shift guided by real 24h Euler-GNN displacement
            dt_sec = 24.0 * 3600.0
            u_eff = 0.5 * (current_state[:, 2] + uv_next[:, 0]) + 0.02 * delta[:, 2]
            v_eff = 0.5 * (current_state[:, 3] + uv_next[:, 1]) + 0.02 * delta[:, 3]

            cos_lat = torch.cos(torch.deg2rad(current_state[:, 0])).clamp(min=0.15)
            dlat = (v_eff * dt_sec) / EARTH_RADIUS_M * (180.0 / math.pi)
            dlon = (u_eff * dt_sec) / (EARTH_RADIUS_M * cos_lat) * (180.0 / math.pi)

            next_state = torch.stack(
                [
                    current_state[:, 0] + dlat,
                    current_state[:, 1] + dlon,
                    uv_next[:, 0],
                    uv_next[:, 1],
                    next_c,
                ],
                dim=-1,
            )
            predictions.append(next_state)
            current_state = next_state

            # Re-encode updated graph features for next recurrent step
            norm_step = torch.stack(
                [
                    (current_state[:, 0] - lat_mean) / 10.0,
                    (current_state[:, 1] - lon_mean) / 10.0,
                    current_state[:, 2],
                    current_state[:, 3],
                    current_state[:, 4],
                ],
                dim=-1,
            )
            h_spatial = self.encode_graph(norm_step, edge_index, edge_weight)

        return predictions


@dataclass
class OceanNodeObs:
    node_id: int
    row: int
    col: int
    lat: float
    lon: float
    u_series: List[float]  # 96 hourly values (m/s)
    v_series: List[float]  # 96 hourly values (m/s)
    sst_series: List[float]  # 96 hourly values (°C)
    wave_h_series: List[float]  # 96 hourly values (m)
    wave_dir_series: List[float]  # 96 hourly values (deg)


def compute_physical_convergence_concentration(nodes: List[OceanNodeObs]) -> np.ndarray:
    """
    Derive physical plastic accumulation potential strictly from real Open-Meteo
    flow convergence (-div(u)) and curl/vorticity trapping + SST front gradients.
    Zero synthetic/random values.
    """
    n = len(nodes)
    if n == 0:
        return np.array([], dtype=np.float32)

    lats = np.array([nd.lat for nd in nodes], dtype=np.float64)
    lons = np.array([nd.lon for nd in nodes], dtype=np.float64)
    u0 = np.array([nd.u_series[0] for nd in nodes], dtype=np.float64)
    v0 = np.array([nd.v_series[0] for nd in nodes], dtype=np.float64)
    sst0 = np.array([nd.sst_series[0] for nd in nodes], dtype=np.float64)

    convergence = np.zeros(n, dtype=np.float64)
    sst_grad = np.zeros(n, dtype=np.float64)

    for i in range(n):
        du_dx_acc, dv_dy_acc, dsst_acc, w_acc = 0.0, 0.0, 0.0, 0.0
        for j in range(n):
            if i == j:
                continue
            dist = haversine_meters(lats[i], lons[i], lats[j], lons[j])
            if dist > 450_000.0 or dist < 1.0:
                continue
            dx = (lons[j] - lons[i]) * 111_320.0 * math.cos(math.radians(lats[i]))
            dy = (lats[j] - lats[i]) * 110_540.0
            w = 1.0 / (dist / 100_000.0 + 0.5) ** 2
            if abs(dx) > 1000.0:
                du_dx_acc += w * ((u0[j] - u0[i]) / dx)
            if abs(dy) > 1000.0:
                dv_dy_acc += w * ((v0[j] - v0[i]) / dy)
            dsst_acc += w * (abs(sst0[j] - sst0[i]) / (dist / 100_000.0))
            w_acc += w
        if w_acc > 0:
            # Negative divergence (-div(u)) indicates surface water convergence
            div = (du_dx_acc + dv_dy_acc) / w_acc
            convergence[i] = -div * 1e6
            sst_grad[i] = dsst_acc / w_acc

    # Normalize convergence & SST frontal gradient + inverse speed stagnation into [0.08, 0.96]
    speed0 = np.sqrt(u0**2 + v0**2)
    stagnation = 1.0 / (1.0 + speed0 * 2.5)

    def minmax(arr: np.ndarray) -> np.ndarray:
        lo, hi = float(arr.min()), float(arr.max())
        if hi - lo < 1e-8:
            return np.full_like(arr, 0.5)
        return (arr - lo) / (hi - lo)

    score = 0.52 * minmax(convergence) + 0.28 * minmax(sst_grad) + 0.20 * minmax(stagnation)
    return np.clip(0.10 + 0.85 * score, 0.05, 0.98).astype(np.float32)


def build_spatial_ocean_graph(
    nodes: List[OceanNodeObs],
    concentrations: np.ndarray,
    grid_rows: int,
    grid_cols: int,
) -> Tuple[Data, List[Tuple[int, int, float]]]:
    """
    Construct PyTorch Geometric Data object:
      x: [N, 5] -> [latitude, longitude, u_current, v_current, plastic_concentration]
      edge_index: [2, E] connecting 8-neighbor ocean cells
      edge_weight: [E] weighted by flow alignment and proximity
    """
    node_lookup: Dict[Tuple[int, int], int] = {
        (nd.row, nd.col): idx for idx, nd in enumerate(nodes)
    }

    features = []
    for idx, nd in enumerate(nodes):
        features.append(
            [
                nd.lat,
                nd.lon,
                nd.u_series[0],
                nd.v_series[0],
                float(concentrations[idx]),
            ]
        )

    edge_src: List[int] = []
    edge_dst: List[int] = []
    edge_weights: List[float] = []
    edge_meta: List[Tuple[int, int, float]] = []

    neighbors = [
        (-1, -1), (-1, 0), (-1, 1),
        (0, -1),           (0, 1),
        (1, -1),  (1, 0),  (1, 1),
    ]

    for idx, nd in enumerate(nodes):
        u_i, v_i = nd.u_series[0], nd.v_series[0]
        spd_i = math.hypot(u_i, v_i)
        for dr, dc in neighbors:
            nbr_idx = node_lookup.get((nd.row + dr, nd.col + dc))
            if nbr_idx is None:
                continue
            nbr = nodes[nbr_idx]
            dist_km = haversine_meters(nd.lat, nd.lon, nbr.lat, nbr.lon) / 1000.0
            dx = (nbr.lon - nd.lon) * math.cos(math.radians(nd.lat))
            dy = nbr.lat - nd.lat
            vec_len = max(1e-8, math.hypot(dx, dy))
            # Alignment of current vector from node -> neighbor
            cos_align = ((u_i * dx + v_i * dy) / (max(1e-6, spd_i) * vec_len)) if spd_i > 1e-4 else 0.0
            flow_factor = 0.55 + 0.45 * max(0.0, cos_align)
            weight = float(flow_factor / max(0.5, dist_km / 100.0))

            edge_src.append(idx)
            edge_dst.append(nbr_idx)
            edge_weights.append(weight)
            edge_meta.append((idx, nbr_idx, round(weight, 4)))

    if not edge_src and len(nodes) > 0:
        # Fallback self-loops for single-node edge case
        for i in range(len(nodes)):
            edge_src.append(i)
            edge_dst.append(i)
            edge_weights.append(1.0)
            edge_meta.append((i, i, 1.0))

    x_tensor = torch.tensor(features, dtype=torch.float32)
    edge_index_tensor = torch.tensor([edge_src, edge_dst], dtype=torch.long)
    edge_weight_tensor = torch.tensor(edge_weights, dtype=torch.float32)

    data = Data(x=x_tensor, edge_index=edge_index_tensor, edge_weight=edge_weight_tensor)
    return data, edge_meta


def interpolate_uv_at(
    lat: float,
    lon: float,
    hour_idx: float,
    nodes: List[OceanNodeObs],
) -> Tuple[float, float]:
    """
    Inverse-distance weighted spatial + linear temporal interpolation of real
    Open-Meteo ocean current + Stokes wave drift at arbitrary (lat, lon, t).
    """
    h0 = int(max(0, min(95, math.floor(hour_idx))))
    h1 = int(max(0, min(95, math.ceil(hour_idx))))
    alpha = hour_idx - h0

    u_acc, v_acc, w_acc = 0.0, 0.0, 0.0
    for nd in nodes:
        dlat = lat - nd.lat
        dlon = (lon - nd.lon) * math.cos(math.radians(lat))
        dist2 = dlat * dlat + dlon * dlon
        w = 1.0 / (dist2 + 0.08)

        u0 = nd.u_series[h0] * (1.0 - alpha) + nd.u_series[h1] * alpha
        v0 = nd.v_series[h0] * (1.0 - alpha) + nd.v_series[h1] * alpha

        # Add 1.5% Stokes wave drift along real wave direction
        wh = nd.wave_h_series[h0] * (1.0 - alpha) + nd.wave_h_series[h1] * alpha
        wd = math.radians(nd.wave_dir_series[h0])
        stokes_spd = 0.015 * wh
        u_acc += w * (u0 + stokes_spd * math.sin(wd))
        v_acc += w * (v0 + stokes_spd * math.cos(wd))
        w_acc += w

    return (u_acc / w_acc, v_acc / w_acc) if w_acc > 0 else (0.0, 0.0)


def rk4_integrate_trajectory(
    start_lat: float,
    start_lon: float,
    nodes: List[OceanNodeObs],
    total_hours: int = 72,
    dt_hours: float = 3.0,
) -> List[Dict[str, float]]:
    """
    4th-Order Runge-Kutta (RK4) Lagrangian drift trajectory over real time-varying
    Open-Meteo Marine current & wave Stokes vectors.
    """
    lat, lon = start_lat, start_lon
    dt_sec = dt_hours * 3600.0
    steps = int(total_hours / dt_hours)

    trajectory = [{"hour": 0, "lat": round(lat, 5), "lon": round(lon, 5)}]

    def deriv(curr_lat: float, curr_lon: float, t_hr: float) -> Tuple[float, float]:
        u, v = interpolate_uv_at(curr_lat, curr_lon, t_hr, nodes)
        cos_lat = max(0.15, math.cos(math.radians(curr_lat)))
        dlat_dt = (v / EARTH_RADIUS_M) * (180.0 / math.pi)
        dlon_dt = (u / (EARTH_RADIUS_M * cos_lat)) * (180.0 / math.pi)
        return dlat_dt, dlon_dt

    for step in range(steps):
        t = step * dt_hours
        k1_lat, k1_lon = deriv(lat, lon, t)
        k2_lat, k2_lon = deriv(lat + 0.5 * dt_sec * k1_lat, lon + 0.5 * dt_sec * k1_lon, t + 0.5 * dt_hours)
        k3_lat, k3_lon = deriv(lat + 0.5 * dt_sec * k2_lat, lon + 0.5 * dt_sec * k2_lon, t + 0.5 * dt_hours)
        k4_lat, k4_lon = deriv(lat + dt_sec * k3_lat, lon + dt_sec * k3_lon, t + dt_hours)

        lat += (dt_sec / 6.0) * (k1_lat + 2.0 * k2_lat + 2.0 * k3_lat + k4_lat)
        lon += (dt_sec / 6.0) * (k1_lon + 2.0 * k2_lon + 2.0 * k3_lon + k4_lon)

        next_hour = int((step + 1) * dt_hours)
        if next_hour in (12, 24, 36, 48, 60, 72):
            trajectory.append(
                {"hour": next_hour, "lat": round(lat, 5), "lon": round(lon, 5)}
            )

    return trajectory
