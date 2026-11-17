const map = L.map("map", { zoomControl: true }).setView([35, -145], 5);

L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics" }
).addTo(map);

const overlayLayer = L.layerGroup().addTo(map);
let latestForecast = null;
let activeHorizon = "0";
let regions = [];

async function init() {
  const healthRes = await fetch("/api/health");
  const health = await healthRes.json();
  document.getElementById("api-status").textContent =
    health.status === "online"
      ? `Open-Meteo Marine Live · ${health.latencyMs} ms`
      : `Status: ${health.openMeteoStatus}`;

  const regRes = await fetch("/api/regions");
  const regData = await regRes.json();
  regions = regData.regions;

  const select = document.getElementById("region-select");
  regions.forEach((r) => {
    const opt = document.createElement("option");
    opt.value = r.id;
    opt.textContent = r.name;
    select.appendChild(opt);
  });

  select.addEventListener("change", () => {
    const r = regions.find((x) => x.id === select.value);
    if (!r) return;
    document.getElementById("lat-min").value = r.latMin;
    document.getElementById("lat-max").value = r.latMax;
    document.getElementById("lon-min").value = r.lonMin;
    document.getElementById("lon-max").value = r.lonMax;
    runPrediction(r);
  });

  document.querySelectorAll(".horizon-tabs button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".horizon-tabs button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeHorizon = btn.dataset.h;
      renderHorizon();
    });
  });

  document.getElementById("run-btn").addEventListener("click", () => {
    const r = regions.find((x) => x.id === select.value) || regions[0];
    runPrediction(r);
  });

  runPrediction(regions[0]);
}

async function runPrediction(region) {
  const payload = {
    regionId: region.id,
    latMin: parseFloat(document.getElementById("lat-min").value),
    latMax: parseFloat(document.getElementById("lat-max").value),
    lonMin: parseFloat(document.getElementById("lon-min").value),
    lonMax: parseFloat(document.getElementById("lon-max").value),
    gridSize: 6,
    vesselLat: region.defaultVesselLat,
    vesselLon: region.defaultVesselLon,
    vesselSpeedKnots: 10.0,
  };

  const res = await fetch("/api/predict", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  latestForecast = await res.json();
  map.fitBounds([
    [payload.latMin, payload.lonMin],
    [payload.latMax, payload.lonMax],
  ]);
  renderHorizon();
}

function renderHorizon() {
  if (!latestForecast) return;
  overlayLayer.clearLayers();
  const hData = latestForecast.horizons[activeHorizon];

  hData.nodes.forEach((n) => {
    const radius = 5 + n.concentration * 18;
    const color = n.concentration > 0.65 ? "#F59E0B" : "#06B6D4";
    L.circleMarker([n.lat, n.lon], {
      radius,
      color,
      fillColor: color,
      fillOpacity: 0.35,
      weight: 1.5,
    })
      .bindTooltip(
        `Conc: ${(n.concentration * 100).toFixed(1)}% · SST: ${n.sst}°C · Flow: ${n.speedMs} m/s`
      )
      .addTo(overlayLayer);

    L.polyline(
      [
        [n.lat, n.lon],
        [n.lat + n.v * 1.4, n.lon + n.u * 1.4],
      ],
      { color: "#38BDF8", weight: 1.5, opacity: 0.85 }
    ).addTo(overlayLayer);
  });

  latestForecast.trajectories.forEach((tr) => {
    L.polyline(
      tr.points.map((p) => [p.lat, p.lon]),
      { color: "#F59E0B", weight: 2, opacity: 0.7 }
    ).addTo(overlayLayer);
  });

  const route = latestForecast.vesselRoute;
  const routeCoords = [[route.origin.lat, route.origin.lon], ...route.waypoints.map((w) => [w.lat, w.lon])];
  L.polyline(routeCoords, { color: "#22D3EE", weight: 2.5, dashArray: "6,6" }).addTo(overlayLayer);

  route.waypoints.forEach((wp) => {
    L.circleMarker([wp.lat, wp.lon], {
      radius: 7,
      color: "#F59E0B",
      fillColor: "#070B12",
      fillOpacity: 1,
      weight: 2,
    })
      .bindTooltip(`WP #${wp.order} (t+${wp.horizonHour}h) · ETA ${wp.etaHours}h`)
      .addTo(overlayLayer);
  });

  document.getElementById("telemetry-summary").innerHTML = `
    <div>Mean Current: ${hData.meanSpeedMs} m/s</div>
    <div>Mean SST: ${hData.meanSstC} °C</div>
    <div>Mean Wave Height: ${hData.meanWaveM} m</div>
    <div>Peak Plume Index: ${(hData.peakConcentration * 100).toFixed(1)}%</div>
    <div>Route Total: ${route.totalDistanceNm} nm · ${route.totalEtaHours} hrs</div>
  `;
}

init();
