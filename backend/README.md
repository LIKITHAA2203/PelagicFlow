# PelagicFlow — Python FastAPI + PyTorch Geometric Backend

## Architecture
- `gnn_model.py`: Implements `OceanPlasticSpatiotemporalGNN` using `torch_geometric.nn.SAGEConv`, `GCNConv`, and `torch.nn.LSTMCell` over spatial ocean grid nodes `[latitude, longitude, u_current, v_current, plastic_concentration]`, plus 4th-order Runge-Kutta (`rk4_integrate_trajectory`) vector-field drift integration.
- `main.py`: FastAPI service ingesting real-time oceanographic telemetry (`ocean_current_velocity`, `ocean_current_direction`, `sea_surface_temperature`, `wave_height`, `wave_direction`) from the **Open-Meteo Marine API** (`https://marine-api.open-meteo.com/v1/marine`) and serving `/api/predict`, `/api/regions`, and `/api/health`.
- `static/index.html` & `static/app.js`: Standalone Leaflet dashboard served directly by FastAPI at `/`.

## Local Setup Instructions

### 1. Create a Python virtual environment
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
```

### 2. Install PyTorch, PyTorch Geometric & FastAPI dependencies
```bash
pip install --upgrade pip
pip install -r requirements.txt
```
*(If installing PyTorch Geometric with CUDA on a GPU machine, install `torch` matching your CUDA toolkit first from https://pytorch.org/get-started/locally/, then `pip install torch-geometric`.)*

### 3. Run the FastAPI Server
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
Visit `http://localhost:8000` for the standalone dashboard, or `http://localhost:8000/docs` for the OpenAPI Swagger docs.

### 4. Connect the Full-Stack UI (Optional)
Set `FASTAPI_URL=http://127.0.0.1:8000` in `.env` so the Node/Express gateway forwards `/api/predict` directly to the local PyTorch Geometric FastAPI server.
