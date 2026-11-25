/* Hunt Tracker — PWA for whitetail, turkey and bear
   Data lives in localStorage on the device. Every record has id/createdAt/updatedAt
   so a sync backend can be added later without reshaping data. */
'use strict';

/* ---------------- utils ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const now = () => Date.now();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const R2D = 180 / Math.PI, D2R = Math.PI / 180;
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const dir8 = deg => DIRS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];

function haversine(a, b) {
  const R = 6371000, dLat = (b[0] - a[0]) * D2R, dLon = (b[1] - a[1]) * D2R;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * D2R) * Math.cos(b[0] * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function bearing(a, b) {
  const y = Math.sin((b[1] - a[1]) * D2R) * Math.cos(b[0] * D2R);
  const x = Math.cos(a[0] * D2R) * Math.sin(b[0] * D2R) - Math.sin(a[0] * D2R) * Math.cos(b[0] * D2R) * Math.cos((b[1] - a[1]) * D2R);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}
function fmtDist(m) {
  if (m == null || isNaN(m)) return '—';
  if (m < 400) return Math.round(m * 1.09361) + ' yd';
  return (m / 1609.344).toFixed(m < 16093 ? 2 : 1) + ' mi';
}
const fmtTime = d => d ? new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
const fmtDate = d => new Date(d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
function fmtDur(ms) {
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60);
  return h ? `${h}:${String(m % 60).padStart(2, '0')}` : `0:${String(m).padStart(2, '0')}`;
}
function dayKey(d) { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; }
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function overlap(a1, a2, b1, b2) { return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1)); }

let toastT;
function toast(msg, ms = 2200) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), ms);
}
function openSheet(html, onMount) {
  $('#sheet-body').innerHTML = html; $('#sheet-wrap').classList.remove('hidden');
  if (onMount) onMount($('#sheet-body'));
}
function closeSheet() { $('#sheet-wrap').classList.add('hidden'); $('#sheet-body').innerHTML = ''; }
$('#sheet-bg').addEventListener('click', closeSheet);

/* ---------------- store ---------------- */
const KEY = 'ht.v1';
const DEFAULT_SETTINGS = {
  lat: null, lon: null, lastFix: null, layer: 'sat',
  rut1: null, rut2: null, // filled per-year below
  lstart: 30, lend: 30, noonClose: '05-16', species: 'deer'
};
let DB = load();
function load() {
  let d;
  try { d = JSON.parse(localStorage.getItem(KEY)); } catch (e) { d = null; }
  d = d || {};
  d.waypoints ||= []; d.tracks ||= []; d.hunts ||= [];
  d.settings = Object.assign({}, DEFAULT_SETTINGS, d.settings || {});
  d.active ||= null; d.rec ||= null;
  return d;
}
let saveT;
function save(immediate) {
  const doit = () => {
    try { localStorage.setItem(KEY, JSON.stringify(DB)); }
    catch (e) { toast('Storage full — export a backup and delete old trails'); }
  };
  clearTimeout(saveT);
  immediate ? doit() : (saveT = setTimeout(doit, 400));
}
function stamp(o) { o.updatedAt = now(); o.createdAt ||= o.updatedAt; o.id ||= uid(); return o; }
function rutDates(year) {
  const s = DB.settings;
  const y = year || new Date().getFullYear();
  const a = s.rut1 ? s.rut1.slice(5) : '11-05', b = s.rut2 ? s.rut2.slice(5) : '11-20';
  return [new Date(`${y}-${a}T00:00`), new Date(`${y}-${b}T23:59`)];
}

/* ---------------- waypoint types ---------------- */
const WP_TYPES = {
  stand:   { e: '🪜', c: '#ff7a1a', n: 'Tree stand', wind: true },
  blind:   { e: '⛺', c: '#d98a3a', n: 'Ground blind', wind: true },
  cam:     { e: '📷', c: '#5aa9e6', n: 'Trail cam' },
  rub:     { e: '🌳', c: '#a0703c', n: 'Rub' },
  scrape:  { e: '🦌', c: '#c9853a', n: 'Scrape' },
  bed:     { e: '🛏', c: '#8f7ad6', n: 'Bedding' },
  food:    { e: '🌽', c: '#e8c547', n: 'Food plot / feed' },
  water:   { e: '💧', c: '#3aa0c9', n: 'Water' },
  trailx:  { e: '👣', c: '#9aa68f', n: 'Game trail' },
  funnel:  { e: '⏳', c: '#e07b9a', n: 'Funnel / pinch' },
  roost:   { e: '🌲', c: '#3f9a57', n: 'Turkey roost' },
  strut:   { e: '🦃', c: '#b56b2d', n: 'Strut zone' },
  bear:    { e: '🐻', c: '#6b4a32', n: 'Bear sign' },
  harvest: { e: '🏆', c: '#ffd34d', n: 'Harvest' },
  blood:   { e: '🩸', c: '#c0141a', n: 'Blood' },
  park:    { e: '🚙', c: '#7c8a73', n: 'Parking' },
  other:   { e: '📍', c: '#cfd8c6', n: 'Other' }
};

/* ---------------- map ---------------- */
const LAYERS = {
  sat:   { n: 'Satellite', l: () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 21, maxNativeZoom: 19, attribution: 'Esri, Maxar' }) },
  hyb:   { n: 'Satellite + topo lines', l: () => L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}', { maxZoom: 21, maxNativeZoom: 16, attribution: 'USGS' }) },
  topo:  { n: 'USGS Topo', l: () => L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, maxNativeZoom: 16, attribution: 'USGS' }) },
  osm:   { n: 'Street', l: () => L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, maxNativeZoom: 19, attribution: '© OpenStreetMap' }) }
};
const startCenter = DB.settings.lastFix ? [DB.settings.lastFix.lat, DB.settings.lastFix.lon] : [40.341, -76.411];
const map = L.map('map', { zoomControl: false, attributionControl: true, tap: false }).setView(startCenter, DB.settings.lastFix ? 16 : 12);
let baseLayer;
function setLayer(k) {
  if (!LAYERS[k]) k = 'sat';
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = LAYERS[k].l().addTo(map);
  DB.settings.layer = k; save();
}
setLayer(DB.settings.layer);
L.control.scale({ imperial: true, metric: false, position: 'topleft' }).addTo(map);

const wpLayer = L.layerGroup().addTo(map);
const trLayer = L.layerGroup().addTo(map);
const recLayer = L.layerGroup().addTo(map);

/* ---------------- GPS ---------------- */
let fix = null, follow = true, heading = null, meMarker = null, accCircle = null;
function meIcon() {
  return L.divIcon({ className: '', iconSize: [24, 24], iconAnchor: [12, 12],
    html: `<div style="position:relative;width:24px;height:24px">
      <div id="me-cone" style="position:absolute;left:2px;top:-14px;width:20px;height:26px;transform-origin:10px 26px;
        background:linear-gradient(rgba(90,169,230,0),rgba(90,169,230,.55));clip-path:polygon(50% 100%,0 0,100% 0);display:${heading == null ? 'none' : 'block'};
        transform:rotate(${heading || 0}deg)"></div>
      <div class="me-dot" style="position:absolute;left:3px;top:3px"></div></div>` });
}
function startGPS() {
  if (!('geolocation' in navigator)) { $('#hud-gps').textContent = 'No GPS'; return; }
  navigator.geolocation.watchPosition(onFix, err => {
    $('#hud-gps').textContent = err.code === 1 ? 'Location denied' : 'GPS searching…';
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
}
function onFix(p) {
  const c = p.coords;
  fix = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, alt: c.altitude, t: p.timestamp, spd: c.speed };
  const ll = [fix.lat, fix.lon];
  if (!meMarker) {
    meMarker = L.marker(ll, { icon: meIcon(), zIndexOffset: 1000, interactive: false }).addTo(map);
    accCircle = L.circle(ll, { radius: fix.acc, color: '#5aa9e6', weight: 1, fillOpacity: .08, interactive: false }).addTo(map);
    map.setView(ll, Math.max(map.getZoom(), 16));
  } else { meMarker.setLatLng(ll); accCircle.setLatLng(ll).setRadius(fix.acc); }
  if (follow) map.panTo(ll, { animate: true });
  const elev = fix.alt != null ? ` · ${Math.round(fix.alt * 3.28084).toLocaleString()} ft` : '';
  $('#hud-gps').textContent = `±${Math.round(fix.acc * 1.09361)} yd${elev}`;
  if (!DB.settings.lastFix || haversine([DB.settings.lastFix.lat, DB.settings.lastFix.lon], ll) > 200) {
    DB.settings.lastFix = { lat: fix.lat, lon: fix.lon, t: fix.t }; save();
  }
  onTrackFix(fix);
  updateNav();
}
map.on('dragstart', () => { follow = false; $('#btn-locate').classList.remove('on'); });
$('#btn-locate').addEventListener('click', () => {
  follow = true; $('#btn-locate').classList.add('on');
  if (fix) map.setView([fix.lat, fix.lon], Math.max(map.getZoom(), 17)); else toast('Waiting for GPS…');
});
$('#btn-locate').classList.add('on');

/* compass */
let compassOn = false;
function onOrient(e) {
  let h = e.webkitCompassHeading != null ? e.webkitCompassHeading : (e.absolute && e.alpha != null ? 360 - e.alpha : null);
  if (h == null) return;
  heading = h;
  const cone = document.getElementById('me-cone');
  if (cone) { cone.style.display = 'block'; cone.style.transform = `rotate(${h}deg)`; }
  $('#btn-compass').textContent = dir8(h);
  updateNav();
}
$('#btn-compass').addEventListener('click', async () => {
  if (compassOn) { window.removeEventListener('deviceorientation', onOrient); compassOn = false; heading = null;
    $('#btn-compass').classList.remove('on'); $('#btn-compass').textContent = 'N';
    const cone = document.getElementById('me-cone'); if (cone) cone.style.display = 'none'; return; }
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') { toast('Compass permission denied'); return; }
    }
    window.addEventListener('deviceorientation', onOrient); compassOn = true; $('#btn-compass').classList.add('on');
    toast('Compass on — hold phone flat');
  } catch (e) { toast('Compass not available'); }
});

/* layers sheet */
$('#btn-layers').addEventListener('click', () => {
  openSheet(`<h3>Map layer</h3><div class="layer-list">${Object.entries(LAYERS).map(([k, v]) =>
    `<button class="btn ${DB.settings.layer === k ? 'org' : ''}" data-k="${k}">${v.n}</button>`).join('')}</div>
    <label class="lbl" style="margin-top:14px"><input type="checkbox" id="lay-tr" ${showTracks ? 'checked' : ''}> Show saved trails</label>`, el => {
    $$('[data-k]', el).forEach(b => b.onclick = () => { setLayer(b.dataset.k); closeSheet(); });
    $('#lay-tr', el).onchange = e => { showTracks = e.target.checked; renderTracks(); };
  });
});

/* long-press to add waypoint */
(function longPress() {
  const el = map.getContainer(); let t, sx, sy;
  el.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { clearTimeout(t); return; }
    const tc = e.touches[0]; sx = tc.clientX; sy = tc.clientY;
    t = setTimeout(() => {
      const r = el.getBoundingClientRect();
      const ll = map.containerPointToLatLng([sx - r.left, sy - r.top]);
      if (navigator.vibrate) navigator.vibrate(30);
      editWaypoint(null, [ll.lat, ll.lng]);
    }, 600);
  }, { passive: true });
  el.addEventListener('touchmove', e => { const tc = e.touches[0]; if (Math.hypot(tc.clientX - sx, tc.clientY - sy) > 10) clearTimeout(t); }, { passive: true });
  el.addEventListener('touchend', () => clearTimeout(t));
  map.on('contextmenu', e => editWaypoint(null, [e.latlng.lat, e.latlng.lng]));
})();

/* ---------------- waypoints ---------------- */
function wpIcon(w) {
  const T = WP_TYPES[w.type] || WP_TYPES.other;
  if (w.type === 'blood') return L.divIcon({ className: '', iconSize: [12, 12], iconAnchor: [6, 6], html: '<div class="blood-dot"></div>' });
  return L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -28],
    html: `<div class="wp-icon" style="background:${T.c}"><span>${T.e}</span></div>` });
}
const wpMarkers = {};
function renderWaypoints() {
  wpLayer.clearLayers();
  for (const k in wpMarkers) delete wpMarkers[k];
  DB.waypoints.forEach(w => {
    const m = L.marker([w.lat, w.lon], { icon: wpIcon(w) }).addTo(wpLayer);
    m.bindPopup(() => wpPopup(w), { autoPan: true });
    m.on('popupopen', ev => {
      const el = ev.popup.getElement();
      $('[data-a=nav]', el).onclick = () => { map.closePopup(); startNav(w); };
      $('[data-a=edit]', el).onclick = () => { map.closePopup(); editWaypoint(w); };
      $('[data-a=hunt]', el) && ($('[data-a=hunt]', el).onclick = () => { map.closePopup(); startHunt(w.id); });
    });
    wpMarkers[w.id] = m;
  });
}
function wpPopup(w) {
  const T = WP_TYPES[w.type] || WP_TYPES.other;
  let d = '';
  if (fix) { const m = haversine([fix.lat, fix.lon], [w.lat, w.lon]); d = `${fmtDist(m)} · ${Math.round(bearing([fix.lat, fix.lon], [w.lat, w.lon]))}° ${dir8(bearing([fix.lat, fix.lon], [w.lat, w.lon]))}`; }
  const winds = w.winds && w.winds.length ? `<div class="fine">Good winds: ${w.winds.join(', ')}</div>` : '';
  return `<b>${T.e} ${esc(w.name || T.n)}</b><div class="fine">${T.n}${d ? ' · ' + d : ''}</div>${winds}
    ${w.notes ? `<div style="margin-top:4px">${esc(w.notes)}</div>` : ''}
    <div class="pop-actions"><button data-a="nav">Go to</button><button data-a="edit">Edit</button>
    ${T.wind ? '<button data-a="hunt">Hunt here</button>' : ''}</div>`;
}
function editWaypoint(w, ll) {
  const isNew = !w;
  w = w ? { ...w } : { type: 'stand', name: '', notes: '', lat: ll[0], lon: ll[1], winds: [] };
  const typeBtns = Object.entries(WP_TYPES).filter(([k]) => k !== 'blood').map(([k, v]) =>
    `<button data-t="${k}" class="${w.type === k ? 'on' : ''}"><span>${v.e}</span>${v.n}</button>`).join('');
  openSheet(`<h3>${isNew ? 'New waypoint' : 'Edit waypoint'}</h3>
    <input class="input" id="wp-name" placeholder="Name (e.g. Ridge stand)" value="${esc(w.name)}">
    <label class="lbl">Type</label><div class="typegrid">${typeBtns}</div>
    <div id="wp-winds-box"><label class="lbl">Good wind directions (wind blowing FROM)</label>
      <div class="chips" id="wp-winds">${DIRS.map(d => `<button data-d="${d}" class="${(w.winds || []).includes(d) ? 'on' : ''}">${d}</button>`).join('')}</div></div>
    <label class="lbl">Notes</label><textarea class="input" id="wp-notes" placeholder="Access route, cam card, sign…">${esc(w.notes)}</textarea>
    <div class="fine">${w.lat.toFixed(6)}, ${w.lon.toFixed(6)}</div>
    <button class="btn org" id="wp-save">Save</button>
    ${isNew ? '' : '<button class="btn red" id="wp-del">Delete</button>'}
    <button class="btn" id="wp-cancel">Cancel</button>`, el => {
    const syncWind = () => $('#wp-winds-box', el).classList.toggle('hidden', !(WP_TYPES[w.type] || {}).wind);
    syncWind();
    $$('[data-t]', el).forEach(b => b.onclick = () => { w.type = b.dataset.t; $$('[data-t]', el).forEach(x => x.classList.toggle('on', x === b)); syncWind(); });
    $$('[data-d]', el).forEach(b => b.onclick = () => { b.classList.toggle('on'); });
    $('#wp-cancel', el).onclick = closeSheet;
    $('#wp-save', el).onclick = () => {
      w.name = $('#wp-name', el).value.trim() || WP_TYPES[w.type].n;
      w.notes = $('#wp-notes', el).value.trim();
      w.winds = WP_TYPES[w.type].wind ? $$('[data-d].on', el).map(b => b.dataset.d) : [];
      stamp(w);
      const i = DB.waypoints.findIndex(x => x.id === w.id);
      i >= 0 ? (DB.waypoints[i] = w) : DB.waypoints.push(w);
      save(true); renderWaypoints(); closeSheet(); toast('Saved');
      if ($('#view-spots').classList.contains('active')) renderSpots();
    };
    const del = $('#wp-del', el);
    if (del) del.onclick = () => { if (!confirm('Delete this waypoint?')) return;
      DB.waypoints = DB.waypoints.filter(x => x.id !== w.id); save(true); renderWaypoints(); closeSheet(); renderSpots(); };
  });
}
$('#btn-mark').addEventListener('click', () => {
  if (!fix) { const c = map.getCenter(); toast('No GPS yet — marking map center'); return editWaypoint(null, [c.lat, c.lng]); }
  editWaypoint(null, [fix.lat, fix.lon]);
});

/* ---------------- navigation ---------------- */
let navTarget = null;
function startNav(w) { navTarget = w; $('#nav-banner').classList.remove('hidden'); $('#nav-name').textContent = w.name; updateNav();
  if (!compassOn) toast('Tip: turn on the compass (N) for a pointing arrow'); }
function updateNav() {
  if (!navTarget) return;
  if (!fix) { $('#nav-dist').textContent = 'Waiting for GPS…'; return; }
  const a = [fix.lat, fix.lon], b = [navTarget.lat, navTarget.lon];
  const d = haversine(a, b), br = bearing(a, b);
  $('#nav-dist').textContent = `${fmtDist(d)} · ${Math.round(br)}° ${dir8(br)}`;
  const rot = heading != null ? br - heading : br;
  $('#nav-arrow').style.transform = `rotate(${rot - 90}deg)`;
}
$('#nav-stop').addEventListener('click', () => { navTarget = null; $('#nav-banner').classList.add('hidden'); });

/* ---------------- track recording ---------------- */
let wakeLock = null, recLine = null, recTimer = null;
async function lockScreen() {
  try { if ('wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); } } catch (e) { /* ignore */ }
}
document.addEventListener('visibilitychange', () => { if (DB.rec && document.visibilityState === 'visible') lockScreen(); });
function startRec(kind) {
  if (DB.rec) return;
  DB.rec = stamp({ kind, name: kind === 'blood' ? 'Blood trail' : 'Trail', start: now(), points: [], marks: [], dist: 0 });
  if (fix && fix.acc <= 50) DB.rec.points.push([fix.lat, fix.lon, now()]);
  save(true); lockScreen(); showRec();
  if (kind === 'blood') dropBlood('First blood');
  toast(kind === 'blood' ? 'Blood trail started — tap 🩸 to mark each spot' : 'Recording trail — keep the screen on');
}
function showRec() {
  const r = DB.rec; if (!r) return;
  $('#rec-banner').classList.remove('hidden');
  $('#rec-label').textContent = r.kind === 'blood' ? 'Blood trail' : 'Recording';
  $('#btn-track').classList.toggle('on', r.kind === 'trail');
  $('#btn-track').textContent = r.kind === 'trail' ? '■ Stop' : '● Track';
  $('#btn-blood').classList.toggle('on', r.kind === 'blood');
  $('#btn-blood').textContent = r.kind === 'blood' ? '🩸 Drop' : '🩸 Blood';
  recLayer.clearLayers();
  recLine = L.polyline(r.points.map(p => [p[0], p[1]]), { color: r.kind === 'blood' ? '#e0503a' : '#ff7a1a', weight: 4 }).addTo(recLayer);
  r.marks.forEach(m => L.marker([m[0], m[1]], { icon: wpIcon({ type: 'blood' }) }).bindPopup(`${esc(m[3] || 'Blood')}<br>${fmtTime(m[2])}`).addTo(recLayer));
  clearInterval(recTimer); recTimer = setInterval(updRecStats, 1000); updRecStats();
}
function updRecStats() {
  const r = DB.rec; if (!r) return;
  $('#rec-stats').innerHTML = `${fmtDist(r.dist)} · ${fmtDur(now() - r.start)} <button class="btn-sm" id="rec-stop" style="margin-left:6px">Stop</button>`;
  $('#rec-stop').onclick = stopRec;
}
function onTrackFix(f) {
  const r = DB.rec; if (!r || f.acc > 35) return;
  const last = r.points[r.points.length - 1], ll = [f.lat, f.lon];
  const d = last ? haversine([last[0], last[1]], ll) : Infinity;
  if (!last || d >= 4) {
    if (last) r.dist += d;
    r.points.push([+f.lat.toFixed(6), +f.lon.toFixed(6), f.t]);
    if (recLine) recLine.addLatLng(ll);
    save();
  }
}
function dropBlood(note) {
  const r = DB.rec;
  if (!fix) { toast('No GPS fix yet'); return; }
  const m = [fix.lat, fix.lon, now(), note || `Blood #${r.marks.length + 1}`];
  r.marks.push(m); save(true);
  L.marker([m[0], m[1]], { icon: wpIcon({ type: 'blood' }) }).bindPopup(`${esc(m[3])}<br>${fmtTime(m[2])}`).addTo(recLayer);
  if (navigator.vibrate) navigator.vibrate(20);
  toast(`🩸 ${m[3]} marked`);
}
function stopRec() {
  const r = DB.rec; if (!r) return;
  clearInterval(recTimer);
  r.end = now();
  const name = prompt('Name this trail', r.kind === 'blood' ? `Blood trail ${fmtDate(r.start)}` : `Trail ${fmtDate(r.start)}`);
  r.name = name || r.name;
  if (r.points.length > 1 || r.marks.length) DB.tracks.push(stamp(r));
  DB.rec = null; save(true);
  recLayer.clearLayers(); $('#rec-banner').classList.add('hidden');
  $('#btn-track').classList.remove('on'); $('#btn-track').textContent = '● Track';
  $('#btn-blood').classList.remove('on'); $('#btn-blood').textContent = '🩸 Blood';
  try { wakeLock && wakeLock.release(); } catch (e) { }
  wakeLock = null; renderTracks(); toast('Trail saved');
}
$('#btn-track').addEventListener('click', () => {
  if (DB.rec && DB.rec.kind === 'trail') return stopRec();
  if (DB.rec) return toast('Stop the blood trail first');
  startRec('trail');
});
$('#btn-blood').addEventListener('click', () => {
  if (DB.rec && DB.rec.kind === 'blood') return dropBlood();
  if (DB.rec) return toast('Stop the current trail first');
  startRec('blood');
});

let showTracks = true;
function renderTracks() {
  trLayer.clearLayers();
  if (!showTracks) return;
  DB.tracks.forEach(t => {
    if (t.points.length > 1) L.polyline(t.points.map(p => [p[0], p[1]]), { color: t.kind === 'blood' ? '#e0503a' : '#e8c547', weight: 3, opacity: .8, dashArray: t.kind === 'blood' ? '4 6' : null })
      .bindPopup(`<b>${esc(t.name)}</b><div class="fine">${fmtDate(t.start)} · ${fmtDist(t.dist)} · ${fmtDur((t.end || t.start) - t.start)}</div>`).addTo(trLayer);
    (t.marks || []).forEach(m => L.marker([m[0], m[1]], { icon: wpIcon({ type: 'blood' }) }).bindPopup(`${esc(m[3])}<br>${fmtTime(m[2])}`).addTo(trLayer));
  });
}

/* ---------------- astronomy ---------------- */
function fcLoc() {
  const s = DB.settings;
  if (s.lat != null && s.lon != null && s.lat !== '' && !isNaN(s.lat)) return { lat: +s.lat, lon: +s.lon, src: 'Saved location' };
  if (fix) return { lat: fix.lat, lon: fix.lon, src: 'Current GPS' };
  if (s.lastFix) return { lat: s.lastFix.lat, lon: s.lastFix.lon, src: 'Last GPS fix' };
  return { lat: 40.341, lon: -76.411, src: 'Lebanon, PA (default)' };
}
function isSpringTurkey(d) {
  const m = d.getMonth();
  if (m !== 3 && m !== 4) return false;
  const [mm, dd] = (DB.settings.noonClose || '05-16').split('-').map(Number);
  return (m + 1 < mm) || (m + 1 === mm && d.getDate() <= dd);
}
function legalHours(date, lat, lon, sp) {
  const t = SunCalc.getTimes(new Date(startOfDay(date).getTime() + 12 * 3600e3), lat, lon);
  const start = new Date(t.sunrise.getTime() - DB.settings.lstart * 60000);
  let end = new Date(t.sunset.getTime() + DB.settings.lend * 60000), note = '';
  if (sp === 'turkey' && isSpringTurkey(date)) { end = new Date(startOfDay(date).getTime() + 12 * 3600e3); note = 'Spring gobbler — ends at noon'; }
  return { start, end, sunrise: t.sunrise, sunset: t.sunset, note };
}
function solunar(date, lat, lon) {
  const d0 = startOfDay(date).getTime(), step = 10 * 60000;
  const alts = [];
  for (let t = d0 - step; t <= d0 + 86400e3 + step; t += step) alts.push([t, SunCalc.getMoonPosition(new Date(t), lat, lon).altitude]);
  const majors = [];
  for (let i = 1; i < alts.length - 1; i++) {
    const [t, a] = alts[i];
    if (t < d0 || t >= d0 + 86400e3) continue;
    if (a > alts[i - 1][1] && a >= alts[i + 1][1]) majors.push({ t, kind: 'Overhead' });
    if (a < alts[i - 1][1] && a <= alts[i + 1][1]) majors.push({ t, kind: 'Underfoot' });
  }
  const mt = SunCalc.getMoonTimes(new Date(d0), lat, lon);
  const minors = [];
  if (mt.rise) minors.push({ t: mt.rise.getTime(), kind: 'Moonrise' });
  if (mt.set) minors.push({ t: mt.set.getTime(), kind: 'Moonset' });
  const ill = SunCalc.getMoonIllumination(new Date(d0 + 12 * 3600e3));
  return {
    majors: majors.map(m => ({ ...m, s: m.t - 3600e3, e: m.t + 3600e3 })),
    minors: minors.map(m => ({ ...m, s: m.t - 1800e3, e: m.t + 1800e3 })),
    rise: mt.rise, set: mt.set, phase: ill.phase, frac: ill.fraction
  };
}
function phaseName(p) {
  if (p < 0.03 || p > 0.97) return 'New Moon';
  if (p < 0.22) return 'Waxing Crescent';
  if (p < 0.28) return 'First Quarter';
  if (p < 0.47) return 'Waxing Gibbous';
  if (p < 0.53) return 'Full Moon';
  if (p < 0.72) return 'Waning Gibbous';
  if (p < 0.78) return 'Last Quarter';
  return 'Waning Crescent';
}
function phaseBucket(p) { return (p < 0.1 || p > 0.9) ? 'New' : (p > 0.4 && p < 0.6) ? 'Full' : p < 0.5 ? 'Waxing' : 'Waning'; }
function moonSVG(p, size = 58) {
  const r = 26, cx = 30, cy = 30, k = Math.cos(2 * Math.PI * p), rx = Math.abs(k) * r;
  const waxing = p < 0.5, crescent = k > 0;
  let d;
  if (waxing) d = `M${cx} ${cy - r} A${r} ${r} 0 0 1 ${cx} ${cy + r} A${rx} ${r} 0 0 ${crescent ? 0 : 1} ${cx} ${cy - r}Z`;
  else d = `M${cx} ${cy - r} A${r} ${r} 0 0 0 ${cx} ${cy + r} A${rx} ${r} 0 0 ${crescent ? 1 : 0} ${cx} ${cy - r}Z`;
  return `<svg class="moon" width="${size}" height="${size}" viewBox="0 0 60 60"><circle cx="30" cy="30" r="26" fill="#2a3125"/>
    <path d="${d}" fill="#f1ecd2"/><circle cx="30" cy="30" r="26" fill="none" stroke="#3d4836"/></svg>`;
}

/* ---------------- weather (Open-Meteo, no key) ---------------- */
const WXKEY = 'ht.wx';
async function getWeather(lat, lon, force) {
  const k = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  let c; try { c = JSON.parse(localStorage.getItem(WXKEY)); } catch (e) { }
  if (!force && c && c.k === k && now() - c.at < 30 * 60000) return c.data;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&hourly=temperature_2m,precipitation,precipitation_probability,snowfall,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,cloud_cover` +
    `&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,cloud_cover,precipitation` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&past_days=1&forecast_days=8`;
  try {
    const r = await fetch(url); if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    localStorage.setItem(WXKEY, JSON.stringify({ k, at: now(), data }));
    return data;
  } catch (e) {
    if (c && c.data) { toast('Offline — using cached weather'); return c.data; }
    return null;
  }
}
function wxHours(wx) {
  if (!wx || !wx.hourly) return [];
  const h = wx.hourly;
  return h.time.map((t, i) => ({
    t: new Date(t).getTime(), temp: h.temperature_2m[i], pr: h.precipitation[i], pp: h.precipitation_probability?.[i],
    snow: h.snowfall?.[i] || 0, ws: h.wind_speed_10m[i], wd: h.wind_direction_10m[i], wg: h.wind_gusts_10m?.[i],
    p: h.pressure_msl[i], cc: h.cloud_cover[i]
  }));
}
function slice(hours, s, e) { return hours.filter(h => h.t >= s && h.t < e); }
function avg(a, f) { const v = a.map(f).filter(x => x != null && !isNaN(x)); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; }
function meanDir(a) {
  if (!a.length) return null;
  let x = 0, y = 0; a.forEach(h => { x += Math.cos(h.wd * D2R) * (h.ws || 1); y += Math.sin(h.wd * D2R) * (h.ws || 1); });
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

/* ---------------- scoring ---------------- */
function analyzeDay(date, loc, hours, sp) {
  const lh = legalHours(date, loc.lat, loc.lon, sp);
  const sol = solunar(date, loc.lat, loc.lon);
  const d0 = startOfDay(date).getTime();
  const H = 3600e3;
  const dawn = [lh.start.getTime(), lh.sunrise.getTime() + 2.5 * H];
  const dusk = [lh.sunset.getTime() - 2.5 * H, lh.end.getTime()];
  const day = slice(hours, lh.start.getTime(), lh.end.getTime());
  const am = slice(hours, dawn[0] - H, dawn[1]), pm = slice(hours, dusk[0], dusk[1] + H);
  const prev = slice(hours, d0 - 86400e3, d0);
  const reasons = [];
  const add = (v, t) => { if (v) reasons.push({ v, t }); return v; };
  let s = 50;
  const hasWx = day.length > 0;
  const maxT = hasWx ? Math.max(...day.map(h => h.temp)) : null;
  const minT = hasWx ? Math.min(...slice(hours, d0, d0 + 86400e3).map(h => h.temp)) : null;
  const prevMax = prev.length ? Math.max(...prev.map(h => h.temp)) : null;
  const p6 = hours.find(h => h.t >= d0 + 6 * H), p6prev = hours.find(h => h.t >= d0 - 18 * H);
  const pTrend = p6 && p6prev ? p6.p - p6prev.p : null;
  const pAbs = p6 ? p6.p : null;
  const amWind = avg(am, h => h.ws), pmWind = avg(pm, h => h.ws);
  const amDir = meanDir(am), pmDir = meanDir(pm);
  const dayRain = day.reduce((a, h) => a + (h.pr || 0), 0);
  const amRain = am.reduce((a, h) => a + (h.pr || 0), 0), pmRain = pm.reduce((a, h) => a + (h.pr || 0), 0);
  const snow = slice(hours, d0 - 12 * H, d0 + 12 * H).reduce((a, h) => a + (h.snow || 0), 0);
  const amCloud = avg(am, h => h.cc);
  const front = prevMax != null && maxT != null && prevMax - maxT >= 8;

  // solunar overlap with prime windows
  const ov = (w, list) => list.some(p => overlap(w[0], w[1], p.s, p.e) > 20 * 60000);
  const majAm = ov(dawn, sol.majors), majPm = ov(dusk, sol.majors), minAm = ov(dawn, sol.minors), minPm = ov(dusk, sol.minors);
  const bigMoon = sol.frac < 0.08 || sol.frac > 0.92;
  const m = date.getMonth();

  if (sp === 'deer') {
    const [r1, r2] = rutDates(date.getFullYear());
    const t = date.getTime();
    if (t >= r1 && t <= r2) s += add(15, 'Rut peak — bucks cruising all day');
    else if (t >= r1 - 12 * 86400e3 && t < r1) s += add(8, 'Pre-rut — scrapes and seeking');
    else if (t > r2 && t <= r2 + 14 * 86400e3) s += add(4, 'Post-rut / lockdown ending');
    else if (m === 11 && date.getDate() >= 5 && date.getDate() <= 20) s += add(4, 'Second rut window');
    if (maxT != null) {
      if (maxT >= 68) s += add(-12, `Warm (${Math.round(maxT)}°F) — daylight movement suppressed`);
      else if (maxT >= 58 && m >= 9) s += add(-5, `Above-normal warmth (${Math.round(maxT)}°F)`);
      else if (maxT <= 42) s += add(6, `Cold (${Math.round(maxT)}°F high) — more feeding`);
      if ((m === 11 || m === 0) && maxT <= 32) s += add(5, 'Late-season cold — food sources key');
    }
    if (front) s += add(10, `Post-front temp drop (${Math.round(prevMax - maxT)}°F)`);
    if (pTrend != null) {
      if (pTrend >= 3) s += add(8, 'Rising barometer');
      else if (pTrend <= -4) s += add(3, 'Falling barometer — feeding ahead of front');
      else if (pAbs > 1020) s += add(4, 'High, stable pressure');
    }
    s += windScore(amWind, pmWind, add, [4, 12, 18]);
    s += rainScore(dayRain, amRain, pmRain, add);
    if (snow > 0.2) s += add(5, 'Fresh snow — great tracking');
  } else if (sp === 'turkey') {
    if (m === 3 || m === 4) s += add(10, 'Spring — breeding and gobbling');
    else if (m === 9 || m === 10) s += add(3, 'Fall flock season — scout and scatter');
    else s += add(-15, 'Out of typical turkey seasons');
    if (amWind != null) {
      if (amWind <= 6) s += add(12, `Calm dawn (${Math.round(amWind)} mph) — gobbles carry`);
      else if (amWind <= 12) s += add(2, 'Light dawn wind');
      else s += add(-12, `Windy dawn (${Math.round(amWind)} mph) — birds go quiet, hit open fields`);
    }
    if (amRain > 0.05) s += add(-12, 'Rain at fly-down');
    else if (prev.reduce((a, h) => a + h.pr, 0) > 0.2) s += add(6, 'Clearing after rain — birds hit fields');
    if (amCloud != null && amCloud < 40) s += add(5, 'Clear sunrise');
    if (pTrend != null) { if (pTrend >= 2) s += add(5, 'Rising barometer'); else if (pTrend <= -4) s += add(-4, 'Falling barometer'); }
    if (front) s += add(-4, 'Sharp cold front — gobbling may drop');
  } else if (sp === 'bear') {
    if (m === 10 || m === 11 || m === 9) s += add(6, 'Fall pre-den feeding');
    if (maxT != null) {
      if (maxT <= 40) s += add(5, 'Cool temps — bears active by day');
      else if (maxT >= 62) s += add(-6, 'Warm — bears move at night');
    }
    if (snow > 0.2) s += add(10, 'Fresh snow — track and drive');
    if (pTrend != null) { if (pTrend >= 3) s += add(5, 'Rising barometer'); else if (pTrend <= -4) s += add(3, 'Moving ahead of front'); }
    s += windScore(amWind, pmWind, add, [5, 12, 18]);
    s += rainScore(dayRain, amRain, pmRain, add);
  }
  // solunar
  let sv = 0;
  if (majAm) sv += 8; if (majPm) sv += 8; if (!majAm && minAm) sv += 4; if (!majPm && minPm) sv += 4;
  sv = Math.min(sv, sp === 'turkey' ? 8 : 14);
  if (sp === 'turkey') sv = (majAm ? 8 : minAm ? 4 : 0);
  if (sv) s += add(sv, `Solunar ${[majAm || majPm ? 'major' : 'minor']} lines up with ${sp === 'turkey' ? 'morning' : [majAm || minAm ? 'dawn' : '', majPm || minPm ? 'dusk' : ''].filter(Boolean).join(' & ')}`);
  if (bigMoon) s += add(4, sol.frac > 0.9 ? 'Full moon — strong solunar; midday sits pay off' : 'New moon — strong solunar, dark nights');

  // windows
  const windows = [];
  const tag = w => ov(w, sol.majors) ? 'MAJOR' : ov(w, sol.minors) ? 'minor' : '';
  if (sp === 'turkey') {
    windows.push({ n: 'Fly-down / gobbling', s: lh.start, e: new Date(lh.sunrise.getTime() + 2 * H), tag: tag([lh.start.getTime(), lh.sunrise.getTime() + 2 * H]) });
    if (m === 3 || m === 4) windows.push({ n: 'Late-morning lonely toms', s: new Date(d0 + 9.5 * H), e: new Date(Math.min(d0 + 12 * H, lh.end.getTime())), tag: tag([d0 + 9.5 * H, d0 + 12 * H]) });
    if (!isSpringTurkey(date)) windows.push({ n: 'Evening — roost them', s: new Date(lh.sunset.getTime() - 2 * H), e: lh.end, tag: tag(dusk) });
  } else {
    windows.push({ n: 'Morning', s: lh.start, e: new Date(dawn[1]), tag: tag(dawn), dir: amDir, ws: amWind });
    const t = date.getTime(), [r1, r2] = rutDates(date.getFullYear());
    if ((sp === 'deer' && t >= r1 - 5 * 86400e3 && t <= r2) || sp === 'bear' || bigMoon) {
      const ms = [d0 + 10.5 * H, d0 + 14 * H];
      windows.push({ n: sp === 'bear' ? 'Midday (drives/pressure)' : 'Midday sit', s: new Date(ms[0]), e: new Date(ms[1]), tag: tag(ms) });
    }
    windows.push({ n: 'Evening', s: new Date(dusk[0]), e: lh.end, tag: tag(dusk), dir: pmDir, ws: pmWind });
  }
  sol.majors.concat(sol.minors).forEach(p => {
    if (p.e > lh.start.getTime() && p.s < lh.end.getTime() && !windows.some(w => overlap(w.s.getTime(), w.e.getTime(), p.s, p.e) > 0))
      windows.push({ n: `Solunar ${p.kind}`, s: new Date(Math.max(p.s, lh.start)), e: new Date(Math.min(p.e, lh.end)), tag: p.kind === 'Moonrise' || p.kind === 'Moonset' ? 'minor' : 'MAJOR' });
  });
  windows.sort((a, b) => a.s - b.s);

  return { date, lh, sol, score: clamp(Math.round(s), 5, 98), reasons: reasons.sort((a, b) => Math.abs(b.v) - Math.abs(a.v)),
    windows, hasWx, maxT, minT, amWind, pmWind, amDir, pmDir, dayRain, pTrend, snow };
}
function windScore(am, pm, add, [calm, ok, high]) {
  const w = avg([am, pm].filter(x => x != null).map(v => ({ v })), x => x.v);
  if (w == null) return 0;
  if (w <= calm) return add(2, `Calm (${Math.round(w)} mph) — watch for swirling thermals`);
  if (w <= ok) return add(5, `Steady light wind (${Math.round(w)} mph)`);
  if (w <= high) return add(-5, `Breezy (${Math.round(w)} mph)`);
  return add(-12, `High wind (${Math.round(w)} mph) — deer bed tight`);
}
function rainScore(day, am, pm, add) {
  if (day > 0.35) return add(-10, `Heavy rain (${day.toFixed(2)}")`);
  if (am > 0.05 && pm < 0.02) return add(6, 'Rain clearing by evening — post-rain movement');
  if (day > 0.05) return add(-3, 'Light rain');
  return 0;
}
const scoreColor = s => s >= 75 ? '#7fc25a' : s >= 60 ? '#b5d24a' : s >= 45 ? '#e8c547' : s >= 30 ? '#ff9a4d' : '#e0503a';
const scoreWord = s => s >= 80 ? 'Excellent' : s >= 65 ? 'Good' : s >= 50 ? 'Fair' : s >= 35 ? 'Slow' : 'Poor';

/* ---------------- forecast view ---------------- */
let species = DB.settings.species || 'deer';
$$('#species-seg button').forEach(b => {
  b.classList.toggle('on', b.dataset.sp === species);
  b.onclick = () => { species = b.dataset.sp; DB.settings.species = species; save(); $$('#species-seg button').forEach(x => x.classList.toggle('on', x === b)); renderForecast(); };
});
let lastWx = null;
async function renderForecast(force) {
  const loc = fcLoc();
  $('#fc-loc').textContent = `${loc.src} · ${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}`;
  $('#now-card').innerHTML = '<div class="fine">Loading weather…</div>';
  const wx = await getWeather(loc.lat, loc.lon, force); lastWx = wx;
  const hours = wxHours(wx);
  renderNow(loc, wx);
  const out = [];
  const t0 = startOfDay(now());
  for (let i = 0; i < 7; i++) {
    const d = new Date(t0.getTime() + i * 86400e3 + 12 * 3600e3); d.setHours(0, 0, 0, 0);
    out.push(analyzeDay(d, loc, hours, species));
  }
  const best = out.reduce((a, b) => b.score > a.score ? b : a, out[0]);
  $('#days').innerHTML = out.map((a, i) => dayCard(a, i, a === best)).join('');
  $$('.day-head').forEach(h => h.onclick = () => h.parentElement.classList.toggle('open'));
  const first = $('.day'); if (first) first.classList.add('open');
}
function renderNow(loc, wx) {
  const d = new Date(), sol = solunar(d, loc.lat, loc.lon), lh = legalHours(d, loc.lat, loc.lon, species);
  const c = wx && wx.current;
  const t = now();
  const inLegal = t >= lh.start && t <= lh.end;
  const nextP = sol.majors.concat(sol.minors).concat(solunar(new Date(t + 86400e3), loc.lat, loc.lon).majors)
    .filter(p => p.e > t).sort((a, b) => a.s - b.s)[0];
  const active = nextP && nextP.s <= t;
  let legalTxt;
  if (inLegal) legalTxt = `Legal until ${fmtTime(lh.end)}`;
  else if (t < lh.start) legalTxt = `Legal at ${fmtTime(lh.start)}`;
  else { const tm = legalHours(new Date(t + 86400e3), loc.lat, loc.lon, species); legalTxt = `Legal tomorrow ${fmtTime(tm.start)}`; }
  $('#now-card').innerHTML = `
    <div class="now-top">${moonSVG(sol.phase)}
      <div><div class="big">${phaseName(sol.phase)}</div>
      <div class="fine">${Math.round(sol.frac * 100)}% illuminated · Rise ${fmtTime(sol.rise)} · Set ${fmtTime(sol.set)}</div>
      <div style="margin-top:4px;color:${inLegal ? 'var(--grn)' : 'var(--mut)'};font-weight:600">${legalTxt}</div>
      ${lh.note ? `<div class="fine">${lh.note}</div>` : ''}</div></div>
    <div class="kv">
      <div><small>Sunrise</small><b>${fmtTime(lh.sunrise)}</b></div>
      <div><small>Sunset</small><b>${fmtTime(lh.sunset)}</b></div>
      <div><small>${active ? 'Solunar now' : 'Next solunar'}</small><b>${nextP ? (active ? 'until ' + fmtTime(nextP.e) : fmtTime(nextP.s)) : '—'}</b></div>
      <div><small>Temp</small><b>${c ? Math.round(c.temperature_2m) + '°F' : '—'}</b></div>
      <div><small>Wind from</small><b>${c ? `<span class="windarrow" style="transform:rotate(${c.wind_direction_10m + 180}deg)">↑</span> ${dir8(c.wind_direction_10m)} ${Math.round(c.wind_speed_10m)}` : '—'}</b></div>
      <div><small>Pressure</small><b>${c ? (c.pressure_msl * 0.02953).toFixed(2) + '"' : '—'}</b></div>
    </div>
    ${wx ? '' : '<p class="fine">Weather unavailable — scores use moon and season only.</p>'}
    <button class="btn" id="fc-refresh">Refresh</button>`;
  $('#fc-refresh').onclick = () => renderForecast(true);
}
function dayCard(a, i, isBest) {
  const d0 = startOfDay(a.date).getTime(), span = 86400e3, pct = t => clamp((t - d0) / span * 100, 0, 100);
  const lhS = pct(a.lh.start), lhE = pct(a.lh.end);
  const tl = `<div class="timeline">
      <div class="seg-dark" style="left:0;width:${lhS}%"></div><div class="seg-dark" style="left:${lhE}%;right:0"></div>
      <div class="seg-legal" style="left:${lhS}%;width:${lhE - lhS}%"></div>
      ${a.sol.majors.map(p => `<div class="maj" style="left:${pct(p.s)}%;width:${pct(p.e) - pct(p.s)}%"></div>`).join('')}
      ${a.sol.minors.map(p => `<div class="min" style="left:${pct(p.s)}%;width:${pct(p.e) - pct(p.s)}%"></div>`).join('')}
    </div><div class="tl-axis"><span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>12a</span></div>
    <div class="fine">Green = legal hours · <span style="color:var(--org)">■</span> major (2 hr) · <span style="color:var(--org2)">■</span> minor (1 hr)</div>`;
  const wins = a.windows.map(w => `<div class="win"><div><b>${w.n}</b><div class="fine">${fmtTime(w.s)} – ${fmtTime(w.e)}${w.dir != null ? ` · wind ${dir8(w.dir)} ${Math.round(w.ws)} mph` : ''}</div></div>
    ${w.tag ? `<span class="tag" style="${w.tag === 'minor' ? 'background:var(--org2)' : ''}">${w.tag}</span>` : ''}</div>`).join('');
  const stands = standAdvice(a);
  const wxLine = a.hasWx ? `${Math.round(a.minT)}° / ${Math.round(a.maxT)}°F${a.dayRain > 0.02 ? ` · ${a.dayRain.toFixed(2)}" rain` : ''}${a.amDir != null ? ` · AM ${dir8(a.amDir)} ${Math.round(a.amWind)} mph` : ''}` : 'No weather data';
  return `<div class="day">
    <div class="day-head"><div class="score" style="background:${scoreColor(a.score)}">${a.score}</div>
      <div class="t"><b>${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : fmtDate(a.date)} · ${scoreWord(a.score)}${isBest ? ' ⭐' : ''}</b>
      <small>${phaseName(a.sol.phase)} · ${wxLine}</small></div><span class="chev">›</span></div>
    <div class="day-body">${tl}
      <div class="windows">${wins}</div>
      ${stands}
      <ul class="reasons">${a.reasons.map(r => `<li class="${r.v > 0 ? 'p' : 'n'}">${r.v > 0 ? '▲' : '▼'} ${esc(r.t)}</li>`).join('')}</ul>
      <div class="fine" style="margin-top:6px">Legal ${fmtTime(a.lh.start)} – ${fmtTime(a.lh.end)}${a.lh.note ? ' · ' + a.lh.note : ''}${a.pTrend != null ? ` · Pressure ${a.pTrend >= 0 ? '+' : ''}${a.pTrend.toFixed(1)} mb/24h` : ''}</div>
    </div></div>`;
}
function standAdvice(a) {
  const st = DB.waypoints.filter(w => (WP_TYPES[w.type] || {}).wind);
  if (!st.length) return `<div class="stands fine">Add stands or blinds with good wind directions to get stand picks.</div>`;
  const block = (label, dir) => {
    if (dir == null) return '';
    const d = dir8(dir);
    const good = st.filter(s => (s.winds || []).includes(d)), bad = st.filter(s => s.winds && s.winds.length && !s.winds.includes(d));
    const unk = st.filter(s => !s.winds || !s.winds.length);
    return `<div style="margin-top:6px"><b>${label} (${d} wind):</b><br>${good.map(s => `<span class="stand-chip">✓ ${esc(s.name)}</span>`).join('') || '<span class="fine">No stand fits this wind</span>'}
      ${bad.map(s => `<span class="stand-chip bad">✕ ${esc(s.name)}</span>`).join('')}${unk.length ? `<span class="fine"> · ${unk.length} stand(s) need wind set</span>` : ''}</div>`;
  };
  return `<div class="stands">${block('AM stands', a.amDir)}${species === 'turkey' && isSpringTurkey(a.date) ? '' : block('PM stands', a.pmDir)}</div>`;
}

/* ---------------- hunt log ---------------- */
const OBS = {
  deer: [['buck', '🦌', 'Buck'], ['doe', '🫎', 'Doe'], ['fawn', '🐾', 'Fawn/yearling'], ['shot', '🎯', 'Shot'], ['harvest', '🏆', 'Harvest'], ['note', '📝', 'Note']],
  turkey: [['gobble', '📣', 'Gobble heard'], ['tom', '🦃', 'Tom/Jake'], ['hen', '🐔', 'Hen'], ['shot', '🎯', 'Shot'], ['harvest', '🏆', 'Harvest'], ['note', '📝', 'Note']],
  bear: [['bear', '🐻', 'Bear seen'], ['sign', '🐾', 'Bear sign'], ['deer', '🦌', 'Deer seen'], ['shot', '🎯', 'Shot'], ['harvest', '🏆', 'Harvest'], ['note', '📝', 'Note']]
};
const SIGHT = new Set(['buck', 'doe', 'fawn', 'tom', 'hen', 'bear', 'deer']);
function wxSnapshot() {
  const c = lastWx && lastWx.current;
  return c ? { temp: c.temperature_2m, ws: c.wind_speed_10m, wd: c.wind_direction_10m, p: c.pressure_msl, cc: c.cloud_cover } : null;
}
async function startHunt(standId) {
  if (DB.active) { showView('log'); return toast('A hunt is already running'); }
  const loc = fcLoc();
  if (!lastWx) lastWx = await getWeather(loc.lat, loc.lon);
  const sol = solunar(new Date(), loc.lat, loc.lon);
  DB.active = stamp({ start: now(), species, standId: standId || null, lat: fix ? fix.lat : loc.lat, lon: fix ? fix.lon : loc.lon,
    wx: wxSnapshot(), phase: sol.phase, obs: [] });
  save(true); showView('log'); toast('Hunt started — good luck');
}
function renderLog() {
  const a = DB.active;
  const stands = DB.waypoints.filter(w => (WP_TYPES[w.type] || {}).wind);
  if (!a) {
    $('#active-hunt').innerHTML = `<div class="card"><h3>Start a hunt</h3>
      <p class="fine">Logs time, weather, wind and moon automatically. Tap what you see — it builds your patterns.</p>
      <label class="lbl">Species</label><div class="seg" id="hs-sp">${['deer', 'turkey', 'bear'].map(s => `<button data-s="${s}" class="${species === s ? 'on' : ''}">${{ deer: 'Whitetail', turkey: 'Turkey', bear: 'Bear' }[s]}</button>`).join('')}</div>
      <label class="lbl">Stand / spot</label><select class="input" id="hs-stand"><option value="">— Still hunting / none —</option>
      ${stands.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
      <button class="btn org" id="hs-go">Start hunt</button></div>`;
    $$('#hs-sp button').forEach(b => b.onclick = () => { species = b.dataset.s; DB.settings.species = species; save(); $$('#hs-sp button').forEach(x => x.classList.toggle('on', x === b)); });
    $('#hs-go').onclick = () => startHunt($('#hs-stand').value);
  } else {
    const st = DB.waypoints.find(w => w.id === a.standId);
    const obs = OBS[a.species] || OBS.deer;
    $('#active-hunt').innerHTML = `<div class="card" style="border-color:var(--org)">
      <h3>🟠 Hunting ${st ? '· ' + esc(st.name) : ''}</h3>
      <div class="fine">Started ${fmtTime(a.start)} · <span id="ah-dur">${fmtDur(now() - a.start)}</span>
      ${a.wx ? ` · ${Math.round(a.wx.temp)}°F, ${dir8(a.wx.wd)} ${Math.round(a.wx.ws)} mph` : ''} · ${phaseName(a.phase)}</div>
      <div class="obs-grid">${obs.map(([k, e, n]) => `<button data-o="${k}"><b>${e}</b>${n} <span class="fine">${a.obs.filter(o => o.kind === k).reduce((s, o) => s + (o.n || 1), 0) || ''}</span></button>`).join('')}</div>
      <div class="obs-list">${a.obs.slice().reverse().map(o => `<div>${fmtTime(o.t)} · ${esc(obsLabel(a.species, o.kind))}${o.n > 1 ? ' ×' + o.n : ''}${o.note ? ' — ' + esc(o.note) : ''}</div>`).join('')}</div>
      <button class="btn red" id="ah-end">End hunt</button></div>`;
    $$('[data-o]').forEach(b => b.onclick = () => addObs(b.dataset.o));
    $('#ah-end').onclick = endHunt;
  }
  renderInsights(); renderHuntList();
}
function obsLabel(sp, k) { const o = (OBS[sp] || OBS.deer).concat(OBS.deer, OBS.turkey, OBS.bear).find(x => x[0] === k); return o ? o[2] : k; }
function addObs(kind) {
  const a = DB.active;
  const label = obsLabel(a.species, kind);
  openSheet(`<h3>${label}</h3>
    ${SIGHT.has(kind) ? `<label class="lbl">How many?</label><div class="chips" id="ob-n">${[1, 2, 3, 4, 5, 6].map(n => `<button data-n="${n}" class="${n === 1 ? 'on' : ''}">${n}</button>`).join('')}</div>` : ''}
    <label class="lbl">Note (optional)</label><input class="input" id="ob-note" placeholder="${kind === 'buck' ? '8 pt, came from the north, chasing' : 'Details'}">
    <label class="lbl"><input type="checkbox" id="ob-pin" ${kind === 'harvest' || kind === 'shot' ? 'checked' : ''}> Save a map pin at my location</label>
    <button class="btn org" id="ob-save">Log it</button><button class="btn" id="ob-x">Cancel</button>`, el => {
    let n = 1;
    $$('[data-n]', el).forEach(b => b.onclick = () => { n = +b.dataset.n; $$('[data-n]', el).forEach(x => x.classList.toggle('on', x === b)); });
    $('#ob-x', el).onclick = closeSheet;
    $('#ob-save', el).onclick = () => {
      const note = $('#ob-note', el).value.trim();
      const o = { t: now(), kind, n, note };
      if (fix) { o.lat = fix.lat; o.lon = fix.lon; }
      a.obs.push(o); stamp(a);
      if ($('#ob-pin', el).checked && fix) {
        DB.waypoints.push(stamp({ type: kind === 'harvest' ? 'harvest' : kind === 'sign' ? 'bear' : 'other', name: `${label} ${fmtDate(o.t)}`, notes: note, lat: fix.lat, lon: fix.lon, winds: [] }));
        renderWaypoints();
      }
      if (kind === 'shot') toast('Mark where the animal was standing, then start a Blood trail from the Map', 3500);
      save(true); closeSheet(); renderLog();
    };
  });
}
function endHunt() {
  const a = DB.active; if (!a) return;
  if (!confirm('End this hunt?')) return;
  a.end = now(); a.harvest = a.obs.some(o => o.kind === 'harvest'); stamp(a);
  DB.hunts.unshift(a); DB.active = null; save(true); renderLog(); toast('Hunt saved');
}
function huntSightings(h) { return h.obs.filter(o => SIGHT.has(o.kind)).reduce((s, o) => s + (o.n || 1), 0); }
function renderHuntList() {
  if (!DB.hunts.length) { $('#hunt-list').innerHTML = '<div class="empty">No hunts logged yet.</div>'; return; }
  $('#hunt-list').innerHTML = DB.hunts.map(h => {
    const st = DB.waypoints.find(w => w.id === h.standId);
    const em = { deer: '🦌', turkey: '🦃', bear: '🐻' }[h.species] || '🎯';
    return `<div class="item" data-h="${h.id}"><div class="ic" style="background:${h.harvest ? '#5a4a14' : 'var(--bg2)'}">${h.harvest ? '🏆' : em}</div>
      <div class="t"><b>${fmtDate(h.start)} · ${st ? esc(st.name) : 'No stand'}</b>
      <small>${fmtTime(h.start)}–${fmtTime(h.end)} · ${huntSightings(h)} seen${h.wx ? ` · ${dir8(h.wx.wd)} ${Math.round(h.wx.ws)} mph · ${Math.round(h.wx.temp)}°` : ''}</small></div>
      <div class="r">${fmtDur(h.end - h.start)}</div></div>`;
  }).join('');
  $$('[data-h]').forEach(el => el.onclick = () => huntDetail(DB.hunts.find(h => h.id === el.dataset.h)));
}
function huntDetail(h) {
  const st = DB.waypoints.find(w => w.id === h.standId);
  openSheet(`<h3>${fmtDate(h.start)} ${st ? '· ' + esc(st.name) : ''}</h3>
    <div class="fine">${fmtTime(h.start)} – ${fmtTime(h.end)} · ${phaseName(h.phase)}${h.wx ? ` · ${Math.round(h.wx.temp)}°F · wind ${dir8(h.wx.wd)} ${Math.round(h.wx.ws)} mph · ${(h.wx.p * 0.02953).toFixed(2)}"` : ''}</div>
    <div class="obs-list" style="max-height:none">${h.obs.map(o => `<div>${fmtTime(o.t)} · ${esc(obsLabel(h.species, o.kind))}${o.n > 1 ? ' ×' + o.n : ''}${o.note ? ' — ' + esc(o.note) : ''}</div>`).join('') || '<div>No observations</div>'}</div>
    <button class="btn red" id="hd-del">Delete hunt</button><button class="btn" id="hd-x">Close</button>`, el => {
    $('#hd-x', el).onclick = closeSheet;
    $('#hd-del', el).onclick = () => { if (!confirm('Delete this hunt?')) return; DB.hunts = DB.hunts.filter(x => x.id !== h.id); save(true); closeSheet(); renderLog(); };
  });
}
function renderInsights() {
  const hs = DB.hunts.filter(h => h.end);
  if (hs.length < 1) { $('#insights').innerHTML = '<div class="fine">Log a few hunts and this will show which stands, winds, moon phases and times produce sightings for you.</div>'; return; }
  const hrs = hs.reduce((s, h) => s + (h.end - h.start) / 3600e3, 0), seen = hs.reduce((s, h) => s + huntSightings(h), 0);
  const group = (keyFn) => {
    const g = {};
    hs.forEach(h => { const k = keyFn(h); if (k == null) return; g[k] ||= { hrs: 0, seen: 0, n: 0 }; g[k].hrs += (h.end - h.start) / 3600e3; g[k].seen += huntSightings(h); g[k].n++; });
    return Object.entries(g).map(([k, v]) => ({ k, rate: v.hrs ? v.seen / v.hrs : 0, ...v })).sort((a, b) => b.rate - a.rate);
  };
  const bars = (title, rows) => {
    if (!rows.length) return '';
    const mx = Math.max(...rows.map(r => r.rate), 0.01);
    return `<h3 style="margin-top:12px">${title}</h3>` + rows.slice(0, 6).map(r => `<div class="ins-row"><span>${esc(r.k)}</span><span>${r.rate.toFixed(2)}/hr · ${r.n} hunt${r.n > 1 ? 's' : ''}</span></div><div class="bar"><i style="width:${r.rate / mx * 100}%"></i></div>`).join('');
  };
  const standName = h => { const s = DB.waypoints.find(w => w.id === h.standId); return s ? s.name : 'No stand'; };
  const tod = h => { const hr = new Date(h.start).getHours(); return hr < 10 ? 'Morning' : hr < 14 ? 'Midday' : 'Evening'; };
  $('#insights').innerHTML = `<div class="kv" style="margin-top:0">
      <div><small>Hunts</small><b>${hs.length}</b></div><div><small>Hours</small><b>${hrs.toFixed(1)}</b></div>
      <div><small>Seen / hr</small><b>${(seen / Math.max(hrs, 0.01)).toFixed(2)}</b></div></div>
    ${bars('By stand', group(standName))}
    ${bars('By wind direction', group(h => h.wx ? dir8(h.wx.wd) : null))}
    ${bars('By moon phase', group(h => phaseBucket(h.phase)))}
    ${bars('By time of day', group(tod))}`;
}
setInterval(() => { const el = $('#ah-dur'); if (el && DB.active) el.textContent = fmtDur(now() - DB.active.start); }, 30000);

/* ---------------- spots view ---------------- */
let spotsKind = 'wp';
$$('#spots-seg button').forEach(b => b.onclick = () => { spotsKind = b.dataset.k; $$('#spots-seg button').forEach(x => x.classList.toggle('on', x === b)); renderSpots(); });
$('#spot-filter').addEventListener('input', () => renderSpots());
function renderSpots() {
  const q = $('#spot-filter').value.toLowerCase();
  const here = fix ? [fix.lat, fix.lon] : null;
  if (spotsKind === 'wp') {
    let list = DB.waypoints.filter(w => w.type !== 'blood' && (!q || (w.name + ' ' + (w.notes || '') + ' ' + (WP_TYPES[w.type] || {}).n).toLowerCase().includes(q)));
    if (here) list = list.map(w => ({ w, d: haversine(here, [w.lat, w.lon]) })).sort((a, b) => a.d - b.d); else list = list.map(w => ({ w, d: null }));
    $('#spot-list').innerHTML = list.length ? list.map(({ w, d }) => {
      const T = WP_TYPES[w.type] || WP_TYPES.other;
      return `<div class="item" data-w="${w.id}"><div class="ic" style="background:${T.c}33">${T.e}</div>
        <div class="t"><b>${esc(w.name)}</b><small>${T.n}${w.winds && w.winds.length ? ' · winds ' + w.winds.join('/') : ''}</small></div>
        <div class="r">${d != null ? fmtDist(d) + '<br>' + dir8(bearing(here, [w.lat, w.lon])) : ''}</div></div>`;
    }).join('') : '<div class="empty">No waypoints yet. Tap ＋ Mark on the map, or long-press anywhere on the map.</div>';
    $$('[data-w]').forEach(el => el.onclick = () => { const w = DB.waypoints.find(x => x.id === el.dataset.w); showView('map'); follow = false;
      $('#btn-locate').classList.remove('on'); map.setView([w.lat, w.lon], 18); setTimeout(() => wpMarkers[w.id] && wpMarkers[w.id].openPopup(), 300); });
  } else {
    const list = DB.tracks.filter(t => !q || t.name.toLowerCase().includes(q)).sort((a, b) => b.start - a.start);
    $('#spot-list').innerHTML = list.length ? list.map(t => `<div class="item" data-t="${t.id}"><div class="ic" style="background:var(--bg2)">${t.kind === 'blood' ? '🩸' : '〰️'}</div>
      <div class="t"><b>${esc(t.name)}</b><small>${fmtDate(t.start)} · ${fmtDur((t.end || t.start) - t.start)}${t.marks && t.marks.length ? ` · ${t.marks.length} blood marks` : ''}</small></div>
      <div class="r">${fmtDist(t.dist)}</div></div>`).join('') : '<div class="empty">No trails yet. Tap ● Track on the map to record your walk in.</div>';
    $$('[data-t]', $('#spot-list')).forEach(el => el.onclick = () => trackSheet(DB.tracks.find(x => x.id === el.dataset.t)));
  }
}
function trackSheet(t) {
  openSheet(`<h3>${esc(t.name)}</h3><div class="fine">${fmtDate(t.start)} ${fmtTime(t.start)} · ${fmtDist(t.dist)} · ${t.points.length} points</div>
    <button class="btn org" id="ts-show">Show on map</button>
    <button class="btn" id="ts-follow">Follow back (go to start)</button>
    <button class="btn" id="ts-ren">Rename</button>
    <button class="btn red" id="ts-del">Delete</button>`, el => {
    $('#ts-show', el).onclick = () => { closeSheet(); showView('map'); showTracks = true; renderTracks(); follow = false;
      const pts = t.points.map(p => [p[0], p[1]]).concat((t.marks || []).map(m => [m[0], m[1]]));
      if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.2)); };
    $('#ts-follow', el).onclick = () => { const p = t.points[0] || t.marks[0]; if (!p) return; closeSheet(); showView('map'); startNav({ name: `Start of ${t.name}`, lat: p[0], lon: p[1] }); };
    $('#ts-ren', el).onclick = () => { const n = prompt('Trail name', t.name); if (n) { t.name = n; stamp(t); save(true); closeSheet(); renderSpots(); } };
    $('#ts-del', el).onclick = () => { if (!confirm('Delete this trail?')) return; DB.tracks = DB.tracks.filter(x => x.id !== t.id); save(true); renderTracks(); closeSheet(); renderSpots(); };
  });
}

/* ---------------- settings & data ---------------- */
function loadSettingsForm() {
  const s = DB.settings, y = new Date().getFullYear();
  $('#set-lat').value = s.lat ?? ''; $('#set-lon').value = s.lon ?? '';
  $('#set-rut1').value = s.rut1 || `${y}-11-05`; $('#set-rut2').value = s.rut2 || `${y}-11-20`;
  $('#set-lstart').value = s.lstart; $('#set-lend').value = s.lend; $('#set-noon').value = s.noonClose;
  const bytes = (localStorage.getItem(KEY) || '').length;
  $('#storage-info').textContent = `${DB.waypoints.length} waypoints · ${DB.tracks.length} trails · ${DB.hunts.length} hunts · ${(bytes / 1024).toFixed(0)} KB used`;
}
$('#set-useloc').onclick = () => { if (!fix) return toast('No GPS fix yet'); $('#set-lat').value = fix.lat.toFixed(5); $('#set-lon').value = fix.lon.toFixed(5); };
$('#set-save').onclick = () => {
  const s = DB.settings, lat = parseFloat($('#set-lat').value), lon = parseFloat($('#set-lon').value);
  s.lat = isNaN(lat) ? null : lat; s.lon = isNaN(lon) ? null : lon;
  s.rut1 = $('#set-rut1').value || null; s.rut2 = $('#set-rut2').value || null;
  s.lstart = parseInt($('#set-lstart').value) || 30; s.lend = parseInt($('#set-lend').value) || 30;
  s.noonClose = /^\d\d-\d\d$/.test($('#set-noon').value) ? $('#set-noon').value : '05-16';
  save(true); toast('Settings saved');
};
function download(name, text, type) {
  const blob = new Blob([text], { type }), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
async function shareOrDownload(name, text, type) {
  try {
    const file = new File([text], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  download(name, text, type);
}
$('#exp-json').onclick = () => shareOrDownload(`hunt-tracker-backup-${dayKey(now())}.json`, JSON.stringify({ app: 'hunt-tracker', v: 1, exported: now(), ...DB }, null, 1), 'application/json');
$('#exp-gpx').onclick = () => {
  const x = s => esc(s);
  const wpts = DB.waypoints.map(w => `<wpt lat="${w.lat}" lon="${w.lon}"><time>${new Date(w.createdAt).toISOString()}</time><name>${x(w.name)}</name><desc>${x(w.notes || '')}</desc><type>${x(w.type)}</type></wpt>`).join('\n');
  const trks = DB.tracks.map(t => `<trk><name>${x(t.name)}</name><type>${t.kind}</type><trkseg>${t.points.map(p => `<trkpt lat="${p[0]}" lon="${p[1]}"><time>${new Date(p[2]).toISOString()}</time></trkpt>`).join('')}</trkseg></trk>` +
    (t.marks || []).map(m => `<wpt lat="${m[0]}" lon="${m[1]}"><time>${new Date(m[2]).toISOString()}</time><name>${x(m[3])}</name><type>blood</type></wpt>`).join('')).join('\n');
  shareOrDownload(`hunt-tracker-${dayKey(now())}.gpx`, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Hunt Tracker" xmlns="http://www.topografix.com/GPX/1/1">\n${wpts}\n${trks}\n</gpx>`, 'application/gpx+xml');
};
let importMode = 'json';
$('#imp-json').onclick = () => { importMode = 'json'; $('#file-in').value = ''; $('#file-in').click(); };
$('#imp-gpx').onclick = () => { importMode = 'gpx'; $('#file-in').value = ''; $('#file-in').click(); };
$('#file-in').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const text = await f.text();
  try {
    if (importMode === 'json' || f.name.endsWith('.json')) {
      const d = JSON.parse(text); if (!d.waypoints) throw new Error('Not a Hunt Tracker backup');
      const merge = (a, b) => { const m = new Map(a.map(x => [x.id, x])); b.forEach(x => { const c = m.get(x.id); if (!c || (x.updatedAt || 0) > (c.updatedAt || 0)) m.set(x.id, x); }); return [...m.values()]; };
      DB.waypoints = merge(DB.waypoints, d.waypoints || []); DB.tracks = merge(DB.tracks, d.tracks || []);
      DB.hunts = merge(DB.hunts, d.hunts || []).sort((a, b) => b.start - a.start);
      toast(`Merged backup: ${d.waypoints.length} waypoints, ${(d.tracks || []).length} trails, ${(d.hunts || []).length} hunts`);
    } else {
      const doc = new DOMParser().parseFromString(text, 'application/xml'); let nw = 0, nt = 0;
      $$('wpt', doc).forEach(p => { const type = p.querySelector('type')?.textContent; DB.waypoints.push(stamp({ type: WP_TYPES[type] ? type : 'other', name: p.querySelector('name')?.textContent || 'Imported', notes: p.querySelector('desc')?.textContent || '', lat: +p.getAttribute('lat'), lon: +p.getAttribute('lon'), winds: [] })); nw++; });
      $$('trk', doc).forEach(t => {
        const pts = $$('trkpt', t).map(p => [+p.getAttribute('lat'), +p.getAttribute('lon'), Date.parse(p.querySelector('time')?.textContent) || now()]);
        let dist = 0; for (let i = 1; i < pts.length; i++) dist += haversine(pts[i - 1], pts[i]);
        DB.tracks.push(stamp({ kind: 'trail', name: t.querySelector('name')?.textContent || 'Imported trail', start: pts[0]?.[2] || now(), end: pts[pts.length - 1]?.[2] || now(), points: pts, marks: [], dist })); nt++;
      });
      toast(`Imported ${nw} waypoints, ${nt} trails`);
    }
    save(true); renderWaypoints(); renderTracks(); loadSettingsForm();
  } catch (err) { toast('Import failed: ' + err.message); }
};
$('#wipe').onclick = () => {
  if (!confirm('Erase ALL waypoints, trails and hunts on this phone? Export a backup first.')) return;
  if (!confirm('Really erase everything? This cannot be undone.')) return;
  localStorage.removeItem(KEY); localStorage.removeItem(WXKEY); location.reload();
};

/* ---------------- legal-light HUD ---------------- */
function updLegalHud() {
  const loc = fix ? { lat: fix.lat, lon: fix.lon } : fcLoc();
  const lh = legalHours(new Date(), loc.lat, loc.lon, species), t = now(), el = $('#hud-legal');
  el.classList.remove('legal', 'notlegal');
  if (t >= lh.start && t <= lh.end) {
    const m = Math.round((lh.end - t) / 60000);
    el.textContent = `Legal · ${m > 90 ? 'ends ' + fmtTime(lh.end) : m + ' min left'}`; el.classList.add('legal');
  } else if (t < lh.start) { const m = Math.round((lh.start - t) / 60000); el.textContent = `Legal in ${m > 90 ? fmtTime(lh.start) : m + ' min'}`; el.classList.add('notlegal'); }
  else { el.textContent = 'After legal light'; el.classList.add('notlegal'); }
}
setInterval(updLegalHud, 30000);

/* ---------------- tabs & boot ---------------- */
function showView(v) {
  $$('.view').forEach(x => x.classList.toggle('active', x.id === 'view-' + v));
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  if (v === 'map') setTimeout(() => map.invalidateSize(), 50);
  if (v === 'hunt') renderForecast();
  if (v === 'log') renderLog();
  if (v === 'spots') renderSpots();
  if (v === 'more') loadSettingsForm();
}
$$('#tabs button').forEach(b => b.onclick = () => showView(b.dataset.v));

renderWaypoints(); renderTracks(); updLegalHud();
if (DB.rec) { showRec(); lockScreen(); }
startGPS();
// warm the weather cache so hunt snapshots have data
getWeather(fcLoc().lat, fcLoc().lon).then(w => { lastWx = w; });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
