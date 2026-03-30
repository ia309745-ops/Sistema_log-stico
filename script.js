/* ═══════════════════════════════════════════
   script.js · Dashboard Logístico Última Milla
   ═══════════════════════════════════════════ */

// ── RUTA DEL ARCHIVO ─────────────────────────────────────────────────────────
// Coloca el GeoJSON en la misma carpeta que index.html.
// Si usas Live Server en VS Code, la ruta relativa funciona directamente.
const GEOJSON_PATH = 'rutas_optimizadas.geojson';

// ── PALETA DE COLORES POR RUTA ────────────────────────────────────────────────
const PALETTE = [
  '#00e5a0','#ff6b6b','#ffd93d','#6bceff','#c77dff',
  '#ff9f43','#48dbfb','#ff6348','#1dd1a1','#f368e0',
  '#ee5a24','#009432','#0652dd','#833471','#ffc312',
  '#c4e538','#12cbc4','#fd9644','#e84393','#d980fa',
  '#9980fa','#58b19f','#fa983a','#eb2f06','#1289a7',
  '#6f1e51','#b8e994','#78e08f','#e55039','#f5cba7',
  '#82e0aa','#85c1e9','#f1948a','#bb8fce','#a9cce3',
  '#f9e79f','#a3e4d7','#f0b27a','#d7bde2','#abebc6',
  '#fad7a0','#a9cce3','#fdedec','#d5f5e3','#fef9e7',
  '#eaf2ff','#f4ecf7','#e8f8f5','#fdfefe','#f2f3f4',
  '#00b09b','#96c93d','#f7971e','#ffd200','#21d4fd',
  '#b721ff','#ff0844','#ffb199','#0093e9','#80d0c7',
  '#08aeea','#2af598','#fe8c00','#f83600','#4776e6',
  '#8e54e9','#00c6ff','#f0f','#43e97b','#38f9d7',
  '#fa709a','#fee140','#30cfd0','#667eea','#764ba2',
];

function getColor(nRuta) {
  return PALETTE[(nRuta - 1) % PALETTE.length];
}

// ── ESTADO GLOBAL ─────────────────────────────────────────────────────────────
let allFeatures   = [];
let totalRoutes   = 0;
let markerLayer   = null;
let polylineLayer = null;
let map           = null;

// ── INICIALIZAR MAPA ──────────────────────────────────────────────────────────
function initMap() {
  map = L.map('map', {
    center: [16.86, -99.88],
    zoom: 12,
    zoomControl: false,
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  // Zoom control arriba-derecha
  L.control.zoom({ position: 'bottomright' }).addTo(map);
}

// ── CARGAR GEOJSON ────────────────────────────────────────────────────────────
async function loadGeoJSON() {
  setBadge('Cargando datos…', 'all', true);

  try {
    const res = await fetch(GEOJSON_PATH);
    if (!res.ok) throw new Error(`HTTP ${res.status}: No se pudo cargar ${GEOJSON_PATH}`);
    const data = await res.json();

    allFeatures = data.features.filter(f =>
      f.geometry && f.geometry.coordinates && f.properties
    );

    if (allFeatures.length === 0) throw new Error('El GeoJSON no contiene features válidas.');

    // Rutas únicas ordenadas
    const rutasUnicas = [...new Set(allFeatures.map(f => f.properties.ID_RUTA))]
      .sort((a, b) => {
        const na = parseInt(a.replace(/\D/g, ''));
        const nb = parseInt(b.replace(/\D/g, ''));
        return na - nb;
      });

    totalRoutes = rutasUnicas.length;

    // Llenar dropdown
    const sel = document.getElementById('route-select');
    rutasUnicas.forEach(ruta => {
      const opt = document.createElement('option');
      opt.value = ruta;
      opt.textContent = ruta;
      sel.appendChild(opt);
    });

    // KPIs iniciales
    updateKPI('kpi-val-total', totalRoutes);
    updateKPI('kpi-val-unidades', allFeatures.length);
    document.getElementById('kpi-fill-unidades').style.width = '100%';

    // Dibujar todo
    renderAll();
    setBadge(`${allFeatures.length} unidades · ${totalRoutes} rutas`, 'all', false);

  } catch (err) {
    console.error(err);
    setBadge(`Error: ${err.message}`, 'all', false);
    document.getElementById('route-panel').innerHTML =
      `<p style="color:var(--danger);font-size:12px;line-height:1.7;">
        ⚠ No se pudo cargar el archivo GeoJSON.<br>
        Asegúrate de que <code>rutas_optimizadas.geojson</code> esté en la misma
        carpeta que <code>index.html</code> y de usar un servidor local
        (Live Server, http-server, etc.).
      </p>`;
  }
}

// ── RENDERIZAR TODOS LOS PUNTOS ───────────────────────────────────────────────
function renderAll() {
  clearLayers();

  const markers = [];

  allFeatures.forEach(feat => {
    const [lng, lat] = feat.geometry.coordinates;
    const { ID_RUTA, N_RUTA, ORDEN_VISITA } = feat.properties;
    const color = getColor(N_RUTA);

    const marker = L.circleMarker([lat, lng], {
      radius: 4,
      fillColor: color,
      color: 'rgba(0,0,0,0.3)',
      weight: 0.5,
      fillOpacity: 0.75,
    });

    marker.bindPopup(buildPopup(ID_RUTA, ORDEN_VISITA, color));
    markers.push(marker);
  });

  markerLayer = L.layerGroup(markers).addTo(map);

  // Fit bounds
  const coords = allFeatures.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0]]);
  if (coords.length) map.fitBounds(coords, { padding: [30, 30] });

  // KPI
  updateKPI('kpi-val-ruta', 'Todas');
  updateKPI('kpi-val-unidades', allFeatures.length);
  document.getElementById('kpi-fill-unidades').style.width = '100%';

  // Panel
  document.getElementById('route-panel').innerHTML =
    `<p class="route-panel-empty">Selecciona una ruta para ver el detalle del recorrido.</p>`;
}

// ── RENDERIZAR RUTA ESPECÍFICA ────────────────────────────────────────────────
function renderRoute(idRuta) {
  clearLayers();

  const features = allFeatures.filter(f => f.properties.ID_RUTA === idRuta);
  if (features.length === 0) return;

  // Ordenar por ORDEN_VISITA
  const sorted = [...features].sort((a, b) =>
    a.properties.ORDEN_VISITA - b.properties.ORDEN_VISITA
  );

  const nRuta  = sorted[0].properties.N_RUTA;
  const color  = getColor(nRuta);
  const coords = sorted.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0]]);

  // Polyline de recorrido
  polylineLayer = L.polyline(coords, {
    color: color,
    weight: 2.5,
    opacity: 0.7,
    dashArray: '6,4',
  }).addTo(map);

  // Marcadores
  const markers = [];

  sorted.forEach((feat, idx) => {
    const [lng, lat] = feat.geometry.coordinates;
    const { ID_RUTA, ORDEN_VISITA } = feat.properties;
    const isFirst = idx === 0;
    const isLast  = idx === sorted.length - 1;

    let radius      = 5;
    let fillColor   = color;
    let borderColor = 'rgba(0,0,0,0.4)';
    let borderWeight = 1;

    if (isFirst) { fillColor = '#ffb703'; radius = 8; borderColor = '#fff'; borderWeight = 2; }
    if (isLast)  { fillColor = '#ff4d6d'; radius = 8; borderColor = '#fff'; borderWeight = 2; }

    const marker = L.circleMarker([lat, lng], {
      radius,
      fillColor,
      color: borderColor,
      weight: borderWeight,
      fillOpacity: 0.95,
    });

    marker.bindPopup(buildPopup(ID_RUTA, ORDEN_VISITA, fillColor));
    markers.push(marker);
  });

  markerLayer = L.layerGroup(markers).addTo(map);
  map.fitBounds(coords, { padding: [50, 50] });

  // KPI
  updateKPI('kpi-val-ruta', idRuta);
  updateKPI('kpi-val-unidades', features.length);
  const pct = Math.round((features.length / allFeatures.length) * 100);
  document.getElementById('kpi-fill-unidades').style.width = pct + '%';

  setBadge(`${idRuta} · ${features.length} paradas`, 'single', false);

  // Panel lateral de detalle
  renderRoutePanel(sorted, color);
}

// ── PANEL DE DETALLE DE RUTA ──────────────────────────────────────────────────
function renderRoutePanel(sorted, color) {
  const panel = document.getElementById('route-panel');
  const total = sorted.length;
  const idRuta = sorted[0].properties.ID_RUTA;

  const stopsHTML = sorted.map((f, idx) => {
    const [lng, lat] = f.geometry.coordinates;
    const isFirst = idx === 0;
    const isLast  = idx === total - 1;
    const dotClass = isFirst ? 'first' : isLast ? 'last' : '';
    return `
      <div class="stop-item">
        <span class="stop-num">#${f.properties.ORDEN_VISITA}</span>
        <span class="stop-dot ${dotClass}"></span>
        <span class="stop-coords">${lat.toFixed(5)}, ${lng.toFixed(5)}</span>
      </div>`;
  }).join('');

  panel.innerHTML = `
    <div class="route-detail">
      <div class="route-detail-title" style="color:${color}">◈ ${idRuta}</div>
      <div class="route-stat">
        <span class="route-stat-label">Total paradas</span>
        <span class="route-stat-value">${total}</span>
      </div>
      <div class="route-stat">
        <span class="route-stat-label">Inicio</span>
        <span class="route-stat-value" style="color:#ffb703">● Parada #1</span>
      </div>
      <div class="route-stat">
        <span class="route-stat-label">Fin</span>
        <span class="route-stat-value" style="color:#ff4d6d">● Parada #${total}</span>
      </div>
      <div class="route-stops">
        <span class="route-stops-label">Secuencia de visitas</span>
        <div class="stops-list">${stopsHTML}</div>
      </div>
    </div>`;
}

// ── POPUP HTML ────────────────────────────────────────────────────────────────
function buildPopup(idRuta, ordenVisita, color) {
  return `
    <div class="popup-inner">
      <div class="popup-ruta" style="color:${color}">◈ ${idRuta}</div>
      <div class="popup-parada">Parada #: <span>${ordenVisita}</span></div>
    </div>`;
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function clearLayers() {
  if (markerLayer)   { map.removeLayer(markerLayer);   markerLayer   = null; }
  if (polylineLayer) { map.removeLayer(polylineLayer); polylineLayer = null; }
}

function updateKPI(elId, value) {
  const el = document.getElementById(elId);
  if (el) el.textContent = value;
}

function setBadge(text, dotClass, loading) {
  const badge   = document.getElementById('map-badge');
  const dot     = badge.querySelector('.badge-dot');
  const textEl  = document.getElementById('badge-text');
  dot.className = `badge-dot ${dotClass}`;
  textEl.textContent = text;
  badge.classList.toggle('loading', loading);
}

// ── EVENT: DROPDOWN ───────────────────────────────────────────────────────────
document.getElementById('route-select').addEventListener('change', function () {
  const val = this.value;
  if (val === 'all') {
    renderAll();
    setBadge(`${allFeatures.length} unidades · ${totalRoutes} rutas`, 'all', false);
  } else {
    renderRoute(val);
  }
});

// ── ARRANQUE ──────────────────────────────────────────────────────────────────
initMap();
loadGeoJSON();
