/* ═══════════════════════════════════════════
   script.js · Dashboard Logístico Última Milla
   ═══════════════════════════════════════════ */

const GEOJSON_PATH  = 'rutas_optimizadas.geojson';
const POLYGONS_PATH = 'polígonos.geojson';

// ── PALETA ────────────────────────────────────────────────────────────────────
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

function getColor(nRuta) { return PALETTE[(nRuta - 1) % PALETTE.length]; }

// ── ESTADO GLOBAL ─────────────────────────────────────────────────────────────
let allFeatures    = [];
let allPolygons    = [];
let polygonByNRuta = {};
let totalRoutes    = 0;
let markerLayer    = null;
let polylineLayer  = null;
let polygonLayer   = null;
let map            = null;
let currentRouteId = null;   // ruta activa para descarga

// ── CAMPOS A EXPORTAR ─────────────────────────────────────────────────────────
// Ajusta estos nombres exactos a los que tenga tu GeoJSON
const EXPORT_FIELDS = [
  { key: 'ORDEN_VISITA', label: 'Orden de visita' },
  { key: 'nom_estab',    label: 'Nombre / Razón social' },
  { key: 'municipio',    label: 'Municipio' },
  { key: 'telefono',     label: 'Teléfono' },
];
// Coordenadas se agregan siempre desde la geometría

// ── MAPA ──────────────────────────────────────────────────────────────────────
function initMap() {
  map = L.map('map', { center: [16.86, -99.88], zoom: 12, zoomControl: false });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd', maxZoom: 19,
  }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
}

// ── CARGA DE DATOS ────────────────────────────────────────────────────────────
async function loadGeoJSON() {
  setBadge('Cargando datos…', 'all', true);
  try {
    const [resRutas, resPoly] = await Promise.allSettled([
      fetch(GEOJSON_PATH),
      fetch(POLYGONS_PATH),
    ]);

    if (resRutas.status === 'rejected' || !resRutas.value.ok)
      throw new Error('No se pudo cargar ' + GEOJSON_PATH);

    const dataRutas = await resRutas.value.json();
    allFeatures = dataRutas.features.filter(f => f.geometry && f.geometry.coordinates && f.properties);
    if (allFeatures.length === 0) throw new Error('El GeoJSON no contiene features válidas.');

    if (resPoly.status === 'fulfilled' && resPoly.value.ok) {
      const dataPoly = await resPoly.value.json();
      allPolygons = dataPoly.features.filter(f => f.geometry && f.properties);
      allPolygons.forEach(f => { polygonByNRuta[f.properties.N_RUTA] = f; });
    }

    const rutasUnicas = [...new Set(allFeatures.map(f => f.properties.ID_RUTA))]
      .sort((a, b) => parseInt(a.replace(/\D/g,'')) - parseInt(b.replace(/\D/g,'')));

    totalRoutes = rutasUnicas.length;
    const sel = document.getElementById('route-select');
    rutasUnicas.forEach(ruta => {
      const opt = document.createElement('option');
      opt.value = ruta; opt.textContent = ruta;
      sel.appendChild(opt);
    });

    updateKPI('kpi-val-total',    totalRoutes);
    updateKPI('kpi-val-unidades', allFeatures.length);
    updateKPI('kpi-val-area',     '—');
    document.getElementById('kpi-fill-unidades').style.width = '100%';

    renderAll();
    setBadge(allFeatures.length + ' unidades · ' + totalRoutes + ' rutas', 'all', false);

  } catch (err) {
    console.error(err);
    setBadge('Error: ' + err.message, 'all', false);
    document.getElementById('route-panel').innerHTML =
      '<p style="color:var(--danger);font-size:12px;line-height:1.7;">&#9888; No se pudo cargar el GeoJSON.<br>Usa Live Server y verifica que los archivos estén en la misma carpeta.</p>';
  }
}

// ── RENDER TODOS ──────────────────────────────────────────────────────────────
function renderAll() {
  clearLayers();
  currentRouteId = null;

  const markers = [];
  allFeatures.forEach(feat => {
    const [lng, lat] = feat.geometry.coordinates;
    const { ID_RUTA, N_RUTA, ORDEN_VISITA } = feat.properties;
    const color = getColor(N_RUTA);
    const marker = L.circleMarker([lat, lng], {
      radius: 4, fillColor: color,
      color: 'rgba(0,0,0,0.3)', weight: 0.5, fillOpacity: 0.75,
    });
    marker.bindPopup(buildPopup(ID_RUTA, ORDEN_VISITA, color));
    markers.push(marker);
  });

  markerLayer = L.layerGroup(markers).addTo(map);
  const coords = allFeatures.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0]]);
  if (coords.length) map.fitBounds(coords, { padding: [30, 30] });

  updateKPI('kpi-val-ruta',     'Todas');
  updateKPI('kpi-val-unidades', allFeatures.length);
  updateKPI('kpi-val-area',     '—');
  document.getElementById('kpi-fill-unidades').style.width = '100%';
  document.getElementById('route-panel').innerHTML =
    '<p class="route-panel-empty">Selecciona una ruta para ver el detalle del recorrido.</p>';
}

// ── RENDER RUTA ───────────────────────────────────────────────────────────────
function renderRoute(idRuta) {
  clearLayers();
  currentRouteId = idRuta;

  const features = allFeatures.filter(f => f.properties.ID_RUTA === idRuta);
  if (features.length === 0) return;

  const sorted = [...features].sort((a, b) => a.properties.ORDEN_VISITA - b.properties.ORDEN_VISITA);
  const nRuta  = sorted[0].properties.N_RUTA;
  const color  = getColor(nRuta);
  const coords = sorted.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0]]);

  // Polígono
  const polyFeat = polygonByNRuta[nRuta] || null;
  let areaHa = null;
  if (polyFeat) {
    areaHa = polyFeat.properties['Area Ha'] || polyFeat.properties['Área Ha'] || null;
    const areaM2 = polyFeat.properties['Area m2'] || polyFeat.properties['Área m2'] || 0;
    polygonLayer = L.geoJSON(polyFeat, {
      style: { color: 'rgba(255,255,255,0.55)', weight: 1.5, fillOpacity: 0, dashArray: '6 4' },
    }).addTo(map);
    polygonLayer.bindPopup(
      '<div class="popup-inner"><div class="popup-ruta" style="color:' + color + '">&#9672; ' + idRuta + ' · Zona</div>' +
      '<div class="popup-parada">Área: <span>' + Number(areaM2).toLocaleString('es-MX', {maximumFractionDigits:0}) + ' m²</span></div>' +
      '<div class="popup-parada">Área: <span>' + areaHa + ' Ha</span></div></div>'
    );
  }

  // Polyline
  polylineLayer = L.polyline(coords, { color, weight: 2.5, opacity: 0.7, dashArray: '6,4' }).addTo(map);

  // Marcadores
  const markers = [];
  sorted.forEach((feat, idx) => {
    const [lng, lat] = feat.geometry.coordinates;
    const { ID_RUTA, ORDEN_VISITA } = feat.properties;
    const isFirst = idx === 0, isLast = idx === sorted.length - 1;
    let radius = 5, fillColor = color, borderColor = 'rgba(0,0,0,0.4)', borderWeight = 1;
    if (isFirst) { fillColor = '#ffb703'; radius = 8; borderColor = '#fff'; borderWeight = 2; }
    if (isLast)  { fillColor = '#ff4d6d'; radius = 8; borderColor = '#fff'; borderWeight = 2; }
    const marker = L.circleMarker([lat, lng], { radius, fillColor, color: borderColor, weight: borderWeight, fillOpacity: 0.95 });
    marker.bindPopup(buildPopup(ID_RUTA, ORDEN_VISITA, fillColor));
    markers.push(marker);
  });

  markerLayer = L.layerGroup(markers).addTo(map);
  map.fitBounds(coords, { padding: [50, 50] });

  updateKPI('kpi-val-ruta',     idRuta);
  updateKPI('kpi-val-unidades', features.length);
  updateKPI('kpi-val-area',     areaHa !== null ? areaHa + ' Ha' : 'N/D');
  const pct = Math.round((features.length / allFeatures.length) * 100);
  document.getElementById('kpi-fill-unidades').style.width = pct + '%';

  setBadge(idRuta + ' · ' + features.length + ' paradas', 'single', false);
  renderRoutePanel(sorted, color, areaHa, polyFeat);
}

// ── PANEL LATERAL ─────────────────────────────────────────────────────────────
function renderRoutePanel(sorted, color, areaHa, polyFeat) {
  const panel  = document.getElementById('route-panel');
  const total  = sorted.length;
  const idRuta = sorted[0].properties.ID_RUTA;

  const areaRow = polyFeat ? `
    <div class="route-stat">
      <span class="route-stat-label">Área Ha</span>
      <span class="route-stat-value">${areaHa || 'N/D'}</span>
    </div>
    <div class="route-stat">
      <span class="route-stat-label">Área m²</span>
      <span class="route-stat-value">${Number(polyFeat.properties['Area m2'] || polyFeat.properties['Área m2'] || 0).toLocaleString('es-MX',{maximumFractionDigits:0})}</span>
    </div>` : '';

  const stopsHTML = sorted.map((f, idx) => {
    const [lng, lat] = f.geometry.coordinates;
    const dotClass = idx === 0 ? 'first' : idx === total - 1 ? 'last' : '';
    return `<div class="stop-item">
      <span class="stop-num">#${f.properties.ORDEN_VISITA}</span>
      <span class="stop-dot ${dotClass}"></span>
      <span class="stop-coords">${lat.toFixed(5)}, ${lng.toFixed(5)}</span>
    </div>`;
  }).join('');

  panel.innerHTML = `
    <div class="route-detail">
      <div class="route-detail-title" style="color:${color}">&#9672; ${idRuta}</div>
      <div class="route-stat">
        <span class="route-stat-label">Total paradas</span>
        <span class="route-stat-value">${total}</span>
      </div>
      <div class="route-stat">
        <span class="route-stat-label">Inicio</span>
        <span class="route-stat-value" style="color:#ffb703">&#9679; Parada #1</span>
      </div>
      <div class="route-stat">
        <span class="route-stat-label">Fin</span>
        <span class="route-stat-value" style="color:#ff4d6d">&#9679; Parada #${total}</span>
      </div>
      ${areaRow}
      <div class="route-stops">
        <span class="route-stops-label">Secuencia de visitas</span>
        <div class="stops-list">${stopsHTML}</div>
      </div>
    </div>
    <div class="download-bar">
      <button class="dl-btn dl-btn-pdf" id="btn-dl-pdf">&#8681; Descargar PDF</button>
      <button class="dl-btn dl-btn-excel" id="btn-dl-excel">&#8681; Descargar Excel / CSV</button>
    </div>`;

  document.getElementById('btn-dl-pdf').addEventListener('click',   () => downloadPDF(sorted, idRuta, color));
  document.getElementById('btn-dl-excel').addEventListener('click', () => downloadExcel(sorted, idRuta));
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function buildRouteRows(sorted) {
  return sorted.map(f => {
    const [lng, lat] = f.geometry.coordinates;
    const p = f.properties;
    return {
      orden:   p.ORDEN_VISITA || '',
      nombre:  p.nom_estab   || p.nombre || p.NOMBRE || p.razon_social || '—',
      municipio: p.municipio || p.MUNICIPIO || '—',
      telefono: p.telefono   || p.TELEFONO || '—',
      lat:     lat.toFixed(6),
      lng:     lng.toFixed(6),
    };
  });
}

// ── DESCARGA PDF ──────────────────────────────────────────────────────────────
function downloadPDF(sorted, idRuta, color) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210, margin = 14;

  // ─ Encabezado ─
  doc.setFillColor(13, 15, 20);
  doc.rect(0, 0, W, 36, 'F');

  // Franja de color de la ruta
  const hex = color.replace('#','');
  const r = parseInt(hex.substring(0,2),16);
  const g = parseInt(hex.substring(2,4),16);
  const b = parseInt(hex.substring(4,6),16);
  doc.setFillColor(r, g, b);
  doc.rect(0, 0, 4, 36, 'F');

  doc.setTextColor(232, 234, 240);
  doc.setFontSize(16);
  doc.setFont('helvetica','bold');
  doc.text('Dashboard Logístico · Última Milla', margin + 4, 13);

  doc.setFontSize(10);
  doc.setFont('helvetica','normal');
  doc.setTextColor(r, g, b);
  doc.text(idRuta + '  ·  ' + sorted.length + ' paradas  ·  Acapulco 2025', margin + 4, 22);

  doc.setTextColor(120, 128, 153);
  doc.text('Generado: ' + new Date().toLocaleString('es-MX'), margin + 4, 30);

  // ─ Tabla ─
  const rows = buildRouteRows(sorted);
  doc.autoTable({
    startY: 42,
    head: [['#', 'Nombre / Razón social', 'Municipio', 'Teléfono', 'Latitud', 'Longitud']],
    body: rows.map(r => [r.orden, r.nombre, r.municipio, r.telefono, r.lat, r.lng]),
    styles: {
      fontSize: 8,
      cellPadding: 2.5,
      overflow: 'linebreak',
      textColor: [50, 55, 70],
    },
    headStyles: {
      fillColor: [13, 15, 20],
      textColor: [0, 229, 160],
      fontStyle: 'bold',
      fontSize: 8,
    },
    alternateRowStyles: { fillColor: [245, 246, 250] },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 60 },
      2: { cellWidth: 28 },
      3: { cellWidth: 25 },
      4: { cellWidth: 28, halign: 'right' },
      5: { cellWidth: 28, halign: 'right' },
    },
    margin: { left: margin, right: margin },
    didDrawPage: (data) => {
      // Pie de página
      doc.setFontSize(7);
      doc.setTextColor(150);
      doc.text(
        'Urb. Ismael Luna · ia309745@gmail.com  |  Pág. ' + data.pageNumber,
        margin, 290
      );
    }
  });

  doc.save(idRuta + '_ruta.pdf');
}

// ── DESCARGA EXCEL ────────────────────────────────────────────────────────────
function downloadExcel(sorted, idRuta) {
  const rows = buildRouteRows(sorted);

  const wsData = [
    ['Orden de visita', 'Nombre / Razón social', 'Municipio', 'Teléfono', 'Latitud', 'Longitud'],
    ...rows.map(r => [r.orden, r.nombre, r.municipio, r.telefono, r.lat, r.lng])
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Anchos de columna
  ws['!cols'] = [
    { wch: 8 }, { wch: 40 }, { wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 14 }
  ];

  XLSX.utils.book_append_sheet(wb, ws, idRuta);
  XLSX.writeFile(wb, idRuta + '_ruta.xlsx');
}

// ── POPUP ─────────────────────────────────────────────────────────────────────
function buildPopup(idRuta, ordenVisita, color) {
  return '<div class="popup-inner">' +
    '<div class="popup-ruta" style="color:' + color + '">&#9672; ' + idRuta + '</div>' +
    '<div class="popup-parada">Parada #: <span>' + ordenVisita + '</span></div></div>';
}

function clearLayers() {
  if (markerLayer)   { map.removeLayer(markerLayer);   markerLayer   = null; }
  if (polylineLayer) { map.removeLayer(polylineLayer); polylineLayer = null; }
  if (polygonLayer)  { map.removeLayer(polygonLayer);  polygonLayer  = null; }
}

function updateKPI(elId, value) {
  const el = document.getElementById(elId);
  if (el) el.textContent = value;
}

function setBadge(text, dotClass, loading) {
  const badge  = document.getElementById('map-badge');
  const dot    = badge.querySelector('.badge-dot');
  const textEl = document.getElementById('badge-text');
  dot.className      = 'badge-dot ' + dotClass;
  textEl.textContent = text;
  badge.classList.toggle('loading', loading);
}

// ── DROPDOWN ──────────────────────────────────────────────────────────────────
document.getElementById('route-select').addEventListener('change', function() {
  const val = this.value;
  if (val === 'all') {
    renderAll();
    setBadge(allFeatures.length + ' unidades · ' + totalRoutes + ' rutas', 'all', false);
  } else {
    renderRoute(val);
  }
});

// ── MODALES ───────────────────────────────────────────────────────────────────
const backdrop  = document.getElementById('modal-backdrop');
const openBtn   = document.getElementById('open-method');
const closeBtn  = document.getElementById('close-modal');
function openModal()  { backdrop.classList.add('open');    document.body.style.overflow = 'hidden'; }
function closeModal() { backdrop.classList.remove('open'); document.body.style.overflow = ''; }
openBtn.addEventListener('click', openModal);
closeBtn.addEventListener('click', closeModal);
backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });

const calcBackdrop = document.getElementById('calc-backdrop');
const openCalcBtn  = document.getElementById('open-calc');
const closeCalcBtn = document.getElementById('close-calc');
function openCalc()  { calcBackdrop.classList.add('open');    document.body.style.overflow = 'hidden'; }
function closeCalc() { calcBackdrop.classList.remove('open'); document.body.style.overflow = ''; }
openCalcBtn.addEventListener('click',  openCalc);
closeCalcBtn.addEventListener('click', closeCalc);
calcBackdrop.addEventListener('click', e => { if (e.target === calcBackdrop) closeCalc(); });

document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeCalc(); } });

// ── CALCULADORA ───────────────────────────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function calcDistanciaRuta(features) {
  const sorted = [...features].sort((a,b) => a.properties.ORDEN_VISITA - b.properties.ORDEN_VISITA);
  let dist = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const [lng1,lat1] = sorted[i].geometry.coordinates;
    const [lng2,lat2] = sorted[i+1].geometry.coordinates;
    dist += haversine(lat1,lng1,lat2,lng2);
  }
  return dist * 1.35;
}

function getSemaforo(paradas, distKm, areaHa) {
  const d = areaHa > 0 ? paradas / areaHa : 0;
  if (d < 0.05 && distKm > 20) return { clase: 'alert', txt: '&#9888; Revisar' };
  if (d > 2    && distKm < 8)  return { clase: 'moto',  txt: '&#8853; Moto/Bici' };
  if (paradas < 25)            return { clase: 'warn',  txt: '&#9680; Carga baja' };
  return { clase: 'ok', txt: '&#10003; Óptima' };
}

function formatTime(h) {
  const hh = Math.floor(h), mm = Math.round((h-hh)*60);
  return hh > 0 ? hh+'h '+mm+'min' : mm+' min';
}

function runCalc() {
  if (allFeatures.length === 0) return;
  const precio         = parseFloat(document.getElementById('c-precio').value)         || 23.5;
  const rendimiento    = parseFloat(document.getElementById('c-rendimiento').value)    || 10;
  const velocidad      = parseFloat(document.getElementById('c-velocidad').value)      || 25;
  const tEntrega       = parseFloat(document.getElementById('c-tiempo-entrega').value) || 8;
  const costoAdicional = parseFloat(document.getElementById('c-adicional').value)      || 0;

  const rutasMap = {};
  allFeatures.forEach(f => {
    const id = f.properties.ID_RUTA;
    if (!rutasMap[id]) rutasMap[id] = [];
    rutasMap[id].push(f);
  });

  const rutas = Object.keys(rutasMap).sort((a,b) => parseInt(a.replace(/\D/g,'')) - parseInt(b.replace(/\D/g,'')));
  let totalDist=0, totalCosto=0, totalTiempo=0, totalParadas=0, totalAreaHa=0, rutasConArea=0;

  const tbody = document.getElementById('calc-tbody');
  tbody.innerHTML = '';

  rutas.forEach(idRuta => {
    const features = rutasMap[idRuta];
    const nRuta    = features[0].properties.N_RUTA;
    const paradas  = features.length;
    const distKm   = calcDistanciaRuta(features);
    const litros   = distKm / rendimiento;
    const costoTotal = litros * precio + costoAdicional;
    const tViajeH  = distKm / velocidad;
    const tEntregaH= (paradas * tEntrega) / 60;
    const tTotalH  = tViajeH + tEntregaH;
    const pf       = polygonByNRuta[nRuta] || null;
    const areaHa   = pf ? (pf.properties['Area Ha'] || pf.properties['Área Ha'] || 0) : 0;
    const densidad = areaHa > 0 ? (paradas/areaHa).toFixed(2) : '—';
    const sem      = getSemaforo(paradas, distKm, areaHa);
    const color    = getColor(nRuta);

    totalDist    += distKm; totalCosto  += costoTotal;
    totalTiempo  += tTotalH; totalParadas += paradas;
    if (areaHa > 0) { totalAreaHa += areaHa; rutasConArea++; }

    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td style="color:'+color+'">'+idRuta+'</td>' +
      '<td class="num">'+paradas+'</td>' +
      '<td class="num">'+distKm.toFixed(1)+'</td>' +
      '<td>'+formatTime(tViajeH)+'</td>' +
      '<td>'+formatTime(tEntregaH)+'</td>' +
      '<td class="num">'+formatTime(tTotalH)+'</td>' +
      '<td>'+litros.toFixed(1)+' L</td>' +
      '<td class="cost">$'+costoTotal.toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})+'</td>' +
      '<td>$'+(costoTotal/paradas).toFixed(2)+'</td>' +
      '<td>'+(typeof densidad==='string'?densidad:densidad+' e/Ha')+'</td>' +
      '<td><span class="semaforo '+sem.clase+'">'+sem.txt+'</span></td>';
    tbody.appendChild(tr);
  });

  const dprom = rutasConArea > 0 ? (totalParadas/totalAreaHa).toFixed(2)+' e/Ha' : '—';
  document.getElementById('s-rutas').textContent    = rutas.length;
  document.getElementById('s-dist').textContent     = totalDist.toFixed(1)+' km';
  document.getElementById('s-tiempo').textContent   = formatTime(totalTiempo);
  document.getElementById('s-costo').textContent    = '$'+totalCosto.toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});
  document.getElementById('s-unitario').textContent = '$'+(totalCosto/totalParadas).toFixed(2);
  document.getElementById('s-densidad').textContent = dprom;
  document.getElementById('calc-summary').style.display    = 'block';
  document.getElementById('calc-table-wrap').style.display = 'block';
}

document.getElementById('calc-run').addEventListener('click', runCalc);

// ── ARRANQUE ──────────────────────────────────────────────────────────────────
initMap();
loadGeoJSON();

// ── ANÁLISIS DE CAPACIDAD DE CARGA ────────────────────────────────────────────

function pctClass(pct) {
  if (pct > 100) return 'alert';
  if (pct >= 85)  return 'warn';
  if (pct < 50)   return 'low';
  return 'ok';
}

function capCell(valor, unidad, pct) {
  const cls = pctClass(pct);
  const barW = Math.min(pct, 100).toFixed(0);
  return `<td>
    <span class="cap-bar-wrap"><span class="cap-bar ${cls}" style="width:${barW}%"></span></span>
    <span class="cap-pct ${cls}">${pct.toFixed(0)}%</span>
  </td>`;
}

function estadoCarga(pcts, viajes) {
  const max = Math.max(...pcts);
  if (max > 100) return '<span class="semaforo alert">&#9888; Sobrecarga</span>';
  if (viajes > 1) return '<span class="semaforo viajes">&#11119; '+viajes+' viajes</span>';
  if (max < 50)  return '<span class="semaforo warn">&#9680; Subutilizado</span>';
  if (max >= 85)  return '<span class="semaforo warn">&#9650; Carga alta</span>';
  return '<span class="semaforo ok">&#10003; Óptimo</span>';
}

function runCargo() {
  if (allFeatures.length === 0) return;

  // Capacidades máximas del vehículo
  const capPeso   = parseFloat(document.getElementById('cap-peso').value)   || 3000;
  const capVol    = parseFloat(document.getElementById('cap-vol').value)    || 12;
  const capPallet = parseFloat(document.getElementById('cap-pallets').value)|| 8;
  const capCajas  = parseFloat(document.getElementById('cap-cajas').value)  || 200;

  // Promedios por parada
  const parPeso   = parseFloat(document.getElementById('par-peso').value)   || 25;
  const parVol    = parseFloat(document.getElementById('par-vol').value)    || 0.05;
  const parPallet = parseFloat(document.getElementById('par-pallets').value)|| 0.1;
  const parCajas  = parseFloat(document.getElementById('par-cajas').value)  || 4;

  // Agrupar features por ID_RUTA
  const rutasMap = {};
  allFeatures.forEach(f => {
    const id = f.properties.ID_RUTA;
    if (!rutasMap[id]) rutasMap[id] = [];
    rutasMap[id].push(f);
  });

  const rutas = Object.keys(rutasMap).sort((a,b) =>
    parseInt(a.replace(/\D/g,'')) - parseInt(b.replace(/\D/g,''))
  );

  let totalPeso = 0, totalVol = 0, totalCajas = 0;
  let rutasSobrecarga = 0, rutasSub = 0;
  let sumaPctPeso = 0;

  const tbody = document.getElementById('cargo-tbody');
  tbody.innerHTML = '';

  rutas.forEach(idRuta => {
    const features = rutasMap[idRuta];
    const nRuta    = features[0].properties.N_RUTA;
    const paradas  = features.length;
    const color    = getColor(nRuta);

    const peso   = paradas * parPeso;
    const vol    = paradas * parVol;
    const pallet = paradas * parPallet;
    const cajas  = paradas * parCajas;

    const pctPeso   = (peso   / capPeso)   * 100;
    const pctVol    = (vol    / capVol)    * 100;
    const pctPallet = (pallet / capPallet) * 100;
    const pctCajas  = (cajas  / capCajas)  * 100;

    // Viajes necesarios (basado en el factor más limitante)
    const factorMax = Math.max(pctPeso, pctVol, pctPallet, pctCajas) / 100;
    const viajes    = Math.ceil(factorMax);

    totalPeso  += peso;
    totalVol   += vol;
    totalCajas += cajas;
    sumaPctPeso += pctPeso;

    const maxPct = Math.max(pctPeso, pctVol, pctPallet, pctCajas);
    if (maxPct > 100) rutasSobrecarga++;
    if (maxPct < 50)  rutasSub++;

    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td style="color:${color}">${idRuta}</td>` +
      `<td class="num">${paradas}</td>` +
      `<td class="num">${peso.toFixed(0)} kg</td>` +
      capCell(peso, 'kg', pctPeso) +
      `<td class="num">${vol.toFixed(2)} m³</td>` +
      capCell(vol, 'm³', pctVol) +
      `<td class="num">${pallet.toFixed(1)}</td>` +
      capCell(pallet, 'p', pctPallet) +
      `<td class="num">${cajas.toFixed(0)}</td>` +
      capCell(cajas, 'c', pctCajas) +
      `<td class="num" style="${viajes > 1 ? 'color:var(--warn);font-weight:700' : ''}">${viajes}</td>` +
      `<td>${estadoCarga([pctPeso,pctVol,pctPallet,pctCajas], viajes)}</td>`;
    tbody.appendChild(tr);
  });

  // Resumen
  const usoProm = rutas.length > 0 ? (sumaPctPeso / rutas.length).toFixed(0) + '%' : '—';
  document.getElementById('cs-viajes').textContent     = rutasSobrecarga;
  document.getElementById('cs-sub').textContent        = rutasSub;
  document.getElementById('cs-peso-total').textContent = totalPeso.toLocaleString('es-MX', {maximumFractionDigits:0}) + ' kg';
  document.getElementById('cs-uso-prom').textContent   = usoProm;
  document.getElementById('cs-vol-total').textContent  = totalVol.toFixed(1) + ' m³';
  document.getElementById('cs-cajas-total').textContent= totalCajas.toLocaleString('es-MX', {maximumFractionDigits:0});

  document.getElementById('cargo-summary').style.display    = 'block';
  document.getElementById('cargo-table-wrap').style.display = 'block';
}

document.getElementById('cargo-run').addEventListener('click', runCargo);

// ══════════════════════════════════════════════════════════════════════════════
// MÓDULO CEDIS — Análisis de distancia desde Centro de Distribución
// ══════════════════════════════════════════════════════════════════════════════

const CEDIS_PATH = 'cedis.geojson';

let cedisData       = null;   // feature del CEDIS
let cedisMarker     = null;   // marcador Leaflet
let cedisLines      = [];     // líneas CEDIS→centroide
let cedisResults    = [];     // resultados calculados [{idRuta,dist,paradas,areaHa,efic}]
let cedisActive     = false;

// ── Calcular centroide de un polígono/multipolígono ───────────────────────────
function calcCentroid(feature) {
  const coords = [];
  const geom = feature.geometry;

  function collectRing(ring) {
    ring.forEach(pt => coords.push(pt));
  }

  if (geom.type === 'Polygon') {
    collectRing(geom.coordinates[0]);
  } else if (geom.type === 'MultiPolygon') {
    geom.coordinates.forEach(poly => collectRing(poly[0]));
  }

  if (coords.length === 0) return null;
  const lng = coords.reduce((s, p) => s + p[0], 0) / coords.length;
  const lat = coords.reduce((s, p) => s + p[1], 0) / coords.length;
  return [lat, lng];
}

// ── Colores por distancia (frío=cercano, caliente=lejano) ─────────────────────
function distColor(pct) {
  if (pct <= 0.25) return '#00e5a0';   // verde  — muy cercano
  if (pct <= 0.50) return '#ffd93d';   // amarillo
  if (pct <= 0.75) return '#ff9f43';   // naranja
  return '#ff4d6d';                     // rojo   — muy lejano
}

// ── Abrir / cerrar panel ──────────────────────────────────────────────────────
function openCedisPanel()  {
  document.getElementById('cedis-panel').classList.add('open');
}
function closeCedisPanel() {
  document.getElementById('cedis-panel').classList.remove('open');
  clearCedisLayers();
  cedisActive = false;
}

function clearCedisLayers() {
  if (cedisMarker) { map.removeLayer(cedisMarker); cedisMarker = null; }
  cedisLines.forEach(l => map.removeLayer(l));
  cedisLines = [];
}

// ── Análisis principal ────────────────────────────────────────────────────────
async function runCedisAnalysis() {
  // Cargar CEDIS si no está cargado
  if (!cedisData) {
    try {
      const res = await fetch(CEDIS_PATH);
      if (!res.ok) throw new Error('No se encontró cedis.geojson');
      const gj = await res.json();
      cedisData = gj.features ? gj.features[0] : gj;
    } catch (err) {
      alert('Error: ' + err.message + '\nVerifica que cedis.geojson esté en la carpeta del proyecto.');
      return;
    }
  }

  // Verificar que tengamos polígonos
  if (allPolygons.length === 0) {
    alert('No se encontraron polígonos de rutas. Asegúrate de que poligonos.geojson esté cargado.');
    return;
  }

  clearCedisLayers();

  // Coordenadas del CEDIS
  const cedisCoords = cedisData.geometry.coordinates;
  const cedisLat    = cedisCoords[1];
  const cedisLng    = cedisCoords[0];
  const cedisNombre = cedisData.properties.nombre ||
                      cedisData.properties.NOMBRE ||
                      cedisData.properties.name   ||
                      'CEDIS Principal';

  // Marcador CEDIS
  const cedisIcon = L.divIcon({
    className: 'cedis-marker-icon',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
  cedisMarker = L.marker([cedisLat, cedisLng], { icon: cedisIcon })
    .addTo(map)
    .bindPopup(`<div class="popup-inner">
      <div class="popup-ruta" style="color:#6bceff">&#8857; ${cedisNombre}</div>
      <div class="popup-parada">Centro de Distribución</div>
      <div class="popup-parada">Lat: <span>${cedisLat.toFixed(5)}</span></div>
      <div class="popup-parada">Lng: <span>${cedisLng.toFixed(5)}</span></div>
    </div>`);

  // Calcular distancia a cada polígono
  cedisResults = [];

  allPolygons.forEach(polyFeat => {
    const nRuta   = polyFeat.properties.N_RUTA;
    const areaHa  = polyFeat.properties['Area Ha'] || polyFeat.properties['Área Ha'] || 0;
    const centroid = calcCentroid(polyFeat);
    if (!centroid) return;

    const [cLat, cLng] = centroid;
    const distKm = haversine(cedisLat, cedisLng, cLat, cLng);

    // Paradas de esta ruta
    const paradas = allFeatures.filter(f => f.properties.N_RUTA === nRuta).length;

    // Eficiencia: paradas por km desde CEDIS (mayor = más eficiente)
    const eficiencia = distKm > 0 ? (paradas / distKm).toFixed(2) : 0;

    // ID_RUTA desde los features
    const idRuta = allFeatures.find(f => f.properties.N_RUTA === nRuta)?.properties.ID_RUTA || 'Ruta_' + nRuta;

    cedisResults.push({ nRuta, idRuta, distKm, paradas, areaHa, eficiencia, centroid });
  });

  // Ordenar por distancia
  cedisResults.sort((a, b) => a.distKm - b.distKm);

  const maxDist = cedisResults[cedisResults.length - 1]?.distKm || 1;
  const maxEfic = Math.max(...cedisResults.map(r => parseFloat(r.eficiencia)));

  // Dibujar líneas CEDIS → centroide
  cedisResults.forEach(r => {
    const pct   = r.distKm / maxDist;
    const color = distColor(pct);
    const weight = Math.max(1, 3 - pct * 2);

    const line = L.polyline(
      [[cedisLat, cedisLng], r.centroid],
      { color, weight, opacity: 0.7, dashArray: '4 3' }
    ).addTo(map);

    line.bindPopup(`<div class="popup-inner">
      <div class="popup-ruta" style="color:${color}">&#9672; ${r.idRuta}</div>
      <div class="popup-parada">Distancia CEDIS: <span>${r.distKm.toFixed(2)} km</span></div>
      <div class="popup-parada">Paradas: <span>${r.paradas}</span></div>
      <div class="popup-parada">Eficiencia: <span>${r.eficiencia} paradas/km</span></div>
    </div>`);

    cedisLines.push(line);
  });

  // Hacer zoom para ver todo
  const allPts = [[cedisLat, cedisLng], ...cedisResults.map(r => r.centroid)];
  map.fitBounds(allPts, { padding: [40, 40] });

  // Actualizar panel
  document.getElementById('cedis-name').textContent = cedisNombre;
  renderCedisSummary(cedisResults, maxDist);
  renderCedisList(cedisResults, maxDist, maxEfic);
  openCedisPanel();
  cedisActive = true;
}

// ── Resumen KPIs ──────────────────────────────────────────────────────────────
function renderCedisSummary(results, maxDist) {
  const distProm = (results.reduce((s,r) => s + r.distKm, 0) / results.length).toFixed(1);
  const cercana  = results[0];
  const lejana   = results[results.length - 1];

  document.getElementById('cedis-summary').innerHTML = `
    <div class="cedis-kpi">
      <span class="cedis-kpi-val">${results.length}</span>
      <span class="cedis-kpi-lbl">Territorios</span>
    </div>
    <div class="cedis-kpi">
      <span class="cedis-kpi-val">${distProm}</span>
      <span class="cedis-kpi-lbl">km promedio</span>
    </div>
    <div class="cedis-kpi">
      <span class="cedis-kpi-val">${lejana.distKm.toFixed(1)}</span>
      <span class="cedis-kpi-lbl">km máx</span>
    </div>`;
}

// ── Lista ranking ─────────────────────────────────────────────────────────────
function renderCedisList(results, maxDist, maxEfic) {
  const list = document.getElementById('cedis-list');
  list.innerHTML = results.map((r, i) => {
    const pct      = r.distKm / maxDist;
    const color    = getColor(r.nRuta);
    const eficPct  = maxEfic > 0 ? (parseFloat(r.eficiencia) / maxEfic * 100).toFixed(0) : 0;
    const rankCls  = i < 3 ? 'top' : '';

    return `<div class="cedis-item" data-nruta="${r.nRuta}" onclick="cedisItemClick(${r.nRuta})">
      <div class="cedis-rank ${rankCls}">#${i+1}</div>
      <div class="cedis-item-info">
        <div class="cedis-item-ruta" style="color:${color}">${r.idRuta}</div>
        <div class="cedis-item-meta">
          ${r.paradas} paradas · ${r.areaHa ? r.areaHa + ' Ha' : 'sin área'}
          · ${r.eficiencia} p/km
        </div>
        <div class="cedis-eff-bar">
          <div class="cedis-eff-fill" style="width:${eficPct}%;background:${distColor(pct)}"></div>
        </div>
      </div>
      <div class="cedis-item-dist">
        <span class="cedis-dist-val" style="color:${distColor(pct)}">${r.distKm.toFixed(1)}</span>
        <span class="cedis-dist-lbl">km</span>
      </div>
    </div>`;
  }).join('');
}

// ── Clic en ítem del ranking → zoom a esa ruta ───────────────────────────────
function cedisItemClick(nRuta) {
  const r = cedisResults.find(x => x.nRuta === nRuta);
  if (!r) return;

  // Resaltar ítem activo
  document.querySelectorAll('.cedis-item').forEach(el => el.classList.remove('active'));
  document.querySelector(`[data-nruta="${nRuta}"]`)?.classList.add('active');

  // Zoom al centroide del polígono
  map.flyTo(r.centroid, 14, { duration: 1 });

  // Seleccionar la ruta en el dropdown
  const sel = document.getElementById('route-select');
  if (sel.value !== r.idRuta) {
    sel.value = r.idRuta;
    renderRoute(r.idRuta);
  }
}

// ── Eventos ───────────────────────────────────────────────────────────────────
document.getElementById('open-cedis').addEventListener('click', runCedisAnalysis);
document.getElementById('close-cedis').addEventListener('click', closeCedisPanel);

// ══════════════════════════════════════════════════════════════════════════════
// MÓDULO SIMULADOR DE AHORROS
// ══════════════════════════════════════════════════════════════════════════════

function fmtMXN(n) {
  return '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtNum(n, dec=1) {
  return Number(n).toLocaleString('es-MX', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtPct(n) { return fmtNum(n, 1) + '%'; }

function runSimulator() {
  // ── Leer parámetros ANTES ─────────────────────────────────────────────────
  const antRutas      = parseFloat(document.getElementById('s-ant-rutas').value)      || 90;
  const antKm         = parseFloat(document.getElementById('s-ant-km').value)         || 45;
  const antEntregas   = parseFloat(document.getElementById('s-ant-entregas').value)   || 35;
  const antHoras      = parseFloat(document.getElementById('s-ant-horas').value)      || 9;
  const antCostoHora  = parseFloat(document.getElementById('s-ant-costo-hora').value) || 85;
  const antRend       = parseFloat(document.getElementById('s-ant-rend').value)       || 9;

  // ── Leer parámetros DESPUÉS ───────────────────────────────────────────────
  const optRutas      = parseFloat(document.getElementById('s-opt-rutas').value)      || 71;
  const optKm         = parseFloat(document.getElementById('s-opt-km').value)         || 28;
  const optEntregas   = parseFloat(document.getElementById('s-opt-entregas').value)   || 50;
  const optHoras      = parseFloat(document.getElementById('s-opt-horas').value)      || 7;
  const optCostoHora  = parseFloat(document.getElementById('s-opt-costo-hora').value) || 85;
  const optRend       = parseFloat(document.getElementById('s-opt-rend').value)       || 10;

  // ── Parámetros globales ───────────────────────────────────────────────────
  const precio    = parseFloat(document.getElementById('s-precio').value)    || 23.50;
  const dias      = parseFloat(document.getElementById('s-dias').value)      || 25;
  const inversion = parseFloat(document.getElementById('s-inversion').value) || 1335000;

  // ── Cálculos diarios ──────────────────────────────────────────────────────
  // Combustible diario
  const antCombDia = (antRutas * antKm / antRend) * precio;
  const optCombDia = (optRutas * optKm / optRend) * precio;

  // Costo mano de obra diario
  const antMODia = antRutas * antHoras * antCostoHora;
  const optMODia = optRutas * optHoras * optCostoHora;

  // Totales diarios
  const antTotalDia = antCombDia + antMODia;
  const optTotalDia = optCombDia + optMODia;
  const ahorroDia   = antTotalDia - optTotalDia;

  // Km totales
  const antKmTotal = antRutas * antKm;
  const optKmTotal = optRutas * optKm;

  // Entregas totales
  const antEntregasDia = antRutas * antEntregas;
  const optEntregasDia = optRutas * optEntregas;

  // Proyecciones
  const ahorroMes = ahorroDia * dias;
  const ahorroAnio = ahorroMes * 12;
  const ahorro5   = ahorroAnio * 5;

  // Recuperación de inversión
  const mesesRecup = inversion > 0 ? Math.ceil(inversion / ahorroMes) : 0;

  // ── Render: KPIs comparativos ─────────────────────────────────────────────
  const compareEl = document.getElementById('sim-compare');
  const comparativas = [
    { label: 'Km totales / día', antes: fmtNum(antKmTotal,0)+' km', despues: fmtNum(optKmTotal,0)+' km', delta: '-'+fmtNum((antKmTotal-optKmTotal)/antKmTotal*100,1)+'%', saving: true },
    { label: 'Entregas / día', antes: fmtNum(antEntregasDia,0), despues: fmtNum(optEntregasDia,0), delta: '+'+fmtNum((optEntregasDia-antEntregasDia)/antEntregasDia*100,1)+'%', saving: true },
    { label: 'Costo combustible / día', antes: fmtMXN(antCombDia), despues: fmtMXN(optCombDia), delta: '-'+fmtNum((antCombDia-optCombDia)/antCombDia*100,1)+'%', saving: true },
    { label: 'Costo total / día', antes: fmtMXN(antTotalDia), despues: fmtMXN(optTotalDia), delta: '-'+fmtNum((antTotalDia-optTotalDia)/antTotalDia*100,1)+'%', saving: true },
  ];

  compareEl.innerHTML = comparativas.map(c => `
    <div class="sim-compare-card ${c.saving ? 'saving' : 'danger'}">
      <span class="sim-compare-label">${c.label}</span>
      <div class="sim-compare-vals">
        <span class="sim-val-before">${c.antes}</span>
        <span class="sim-val-after">${c.despues}</span>
      </div>
      <span class="sim-val-delta">${c.delta}</span>
    </div>`).join('');

  // ── Render: KPIs financieros ──────────────────────────────────────────────
  document.getElementById('sim-kpis').innerHTML = `
    <div class="calc-kpi-box">
      <span class="calc-kpi-val">${fmtMXN(ahorroDia)}</span>
      <span class="calc-kpi-lbl">Ahorro diario</span>
    </div>
    <div class="calc-kpi-box">
      <span class="calc-kpi-val">${fmtMXN(ahorroMes)}</span>
      <span class="calc-kpi-lbl">Ahorro mensual (${dias} días)</span>
    </div>
    <div class="calc-kpi-box accent">
      <span class="calc-kpi-val">${fmtMXN(ahorroAnio)}</span>
      <span class="calc-kpi-lbl">Ahorro anual</span>
    </div>
    <div class="calc-kpi-box">
      <span class="calc-kpi-val">${fmtMXN(ahorro5)}</span>
      <span class="calc-kpi-lbl">Ahorro a 5 años</span>
    </div>
    <div class="calc-kpi-box">
      <span class="calc-kpi-val">${mesesRecup} meses</span>
      <span class="calc-kpi-lbl">Recuperación de inversión</span>
    </div>
    <div class="calc-kpi-box">
      <span class="calc-kpi-val">${fmtPct(ahorro5/inversion*100)}</span>
      <span class="calc-kpi-lbl">ROI a 5 años</span>
    </div>`;

  // ── Render: Tabla proyección mensual/anual ────────────────────────────────
  const tbody = document.getElementById('sim-tbody');
  tbody.innerHTML = '';
  let acumulado = 0;

  // Meses del año 1 (mensual detallado)
  for (let m = 1; m <= 12; m++) {
    acumulado += ahorroMes;
    const pendiente = Math.max(0, inversion - acumulado);
    const roi = ((acumulado - inversion) / inversion * 100);
    const breakeven = acumulado >= inversion;
    const estado = pendiente > 0
      ? `<span class="roi-pill pending">⏳ En recuperación</span>`
      : `<span class="roi-pill ${roi > 50 ? 'positive' : 'breakeven'}">✓ ${fmtPct(roi)} ROI</span>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>Mes ${m} (Año 1)</td>
      <td class="num">${fmtMXN(ahorroMes)}</td>
      <td class="num" style="color:var(--accent);font-weight:700">${fmtMXN(acumulado)}</td>
      <td class="num" style="color:${pendiente > 0 ? 'var(--warn)' : 'var(--accent)'}">${pendiente > 0 ? fmtMXN(pendiente) : '✓ Recuperada'}</td>
      <td class="num">${fmtPct(Math.max(0, roi))}</td>
      <td>${estado}</td>`;
    tbody.appendChild(tr);
  }

  // Años 2–5 (anual)
  for (let y = 2; y <= 5; y++) {
    acumulado += ahorroAnio;
    const pendiente = Math.max(0, inversion - acumulado);
    const roi = ((acumulado - inversion) / inversion * 100);
    const estado = `<span class="roi-pill positive">✓ ${fmtPct(roi)} ROI</span>`;
    const tr = document.createElement('tr');
    tr.style.background = 'rgba(0,229,160,0.04)';
    tr.innerHTML = `
      <td style="font-weight:700;color:var(--accent)">Año ${y}</td>
      <td class="num">${fmtMXN(ahorroAnio)}</td>
      <td class="num" style="color:var(--accent);font-weight:700">${fmtMXN(acumulado)}</td>
      <td class="num" style="color:var(--accent)">✓ Recuperada</td>
      <td class="num">${fmtPct(roi)}</td>
      <td>${estado}</td>`;
    tbody.appendChild(tr);
  }

  // ── Render: Modelo de cobro por ahorro ────────────────────────────────────
  const feeGrid = document.getElementById('sim-fee-grid');
  feeGrid.innerHTML = [5, 10, 15].map(pct => {
    const feeMes  = ahorroMes  * pct / 100;
    const feeAnio = ahorroAnio * pct / 100;
    const fee5    = ahorro5    * pct / 100;
    const clienteAnio = ahorroAnio - feeAnio;
    return `
      <div class="sim-fee-card">
        <div class="sim-fee-pct">${pct}%</div>
        <div class="sim-fee-label">del ahorro generado</div>
        <div class="sim-fee-row">
          <span class="sim-fee-row-label">Cobro mensual</span>
          <span class="sim-fee-row-val highlight">${fmtMXN(feeMes)}</span>
        </div>
        <div class="sim-fee-row">
          <span class="sim-fee-row-label">Cobro anual</span>
          <span class="sim-fee-row-val highlight">${fmtMXN(feeAnio)}</span>
        </div>
        <div class="sim-fee-row">
          <span class="sim-fee-row-label">Cobro a 5 años</span>
          <span class="sim-fee-row-val highlight">${fmtMXN(fee5)}</span>
        </div>
        <div class="sim-fee-row">
          <span class="sim-fee-row-label">Ahorro neto cliente/año</span>
          <span class="sim-fee-row-val">${fmtMXN(clienteAnio)}</span>
        </div>
        <div class="sim-fee-row">
          <span class="sim-fee-row-label">Recuperación inversión</span>
          <span class="sim-fee-row-val">${Math.ceil(inversion / feeAnio * 12)} meses</span>
        </div>
      </div>`;
  }).join('');

  document.getElementById('sim-results').style.display = 'block';
}

// ── Eventos del modal simulador ───────────────────────────────────────────────
const simBackdrop = document.getElementById('sim-backdrop');
const openSimBtn  = document.getElementById('open-sim');
const closeSimBtn = document.getElementById('close-sim');
const simRunBtn   = document.getElementById('sim-run');

function openSim()  { simBackdrop.classList.add('open');    document.body.style.overflow = 'hidden'; }
function closeSim() { simBackdrop.classList.remove('open'); document.body.style.overflow = ''; }

openSimBtn.addEventListener('click',  openSim);
closeSimBtn.addEventListener('click', closeSim);
simRunBtn.addEventListener('click',   runSimulator);
simBackdrop.addEventListener('click', e => { if (e.target === simBackdrop) closeSim(); });