// ======================================================================
//  VH Digital Twin Air Corridor
//  Ferry-pier endpoints · multi-station wind field · crossing-free network
//  with strategic 4D slots · physical routing cost · emergency layer
// ======================================================================

// ---------- 1. Map ----------
const map = L.map('map', { center: [22.2950, 114.1830], zoom: 14, zoomControl: false, attributionControl: false });
L.control.zoom({ position: 'bottomleft' }).addTo(map);
function showTab(t) { document.querySelectorAll('#panel .tab').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); document.querySelectorAll('#panel .pane').forEach(p => p.classList.toggle('on', p.dataset.pane === t)); }
function toggleLegend() {
    const lp = document.getElementById('legendPop'), on = lp.classList.toggle('open');
    document.getElementById('btnLegend').classList.toggle('on', on);
    if (on) lp.style.left = (document.getElementById('panel').getBoundingClientRect().right + 8) + 'px';
}
function togglePanel() { const p = document.getElementById('panel'), c = p.classList.toggle('collapsed'); document.getElementById('btnCollapse').textContent = c ? '›' : '‹';
    const lp = document.getElementById('legendPop'); if (lp.classList.contains('open')) lp.style.left = (p.getBoundingClientRect().right + 8) + 'px'; }
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(map);
function applyZoomClass() { document.getElementById('map').classList.toggle('zoom-far', map.getZoom() < 14); }
map.on('zoomend', applyZoomClass); applyZoomClass();

// ---------- 2. Utilities ----------
function addLog(msg, cls = '') {
    const el = document.getElementById('log');
    const t = new Date().toLocaleTimeString('en-GB');
    el.innerHTML += `<div class="${cls}">[${t}] ${msg}</div>`;
    el.scrollTop = el.scrollHeight;
    const last = document.getElementById('logLast');
    if (last) { last.textContent = msg.replace(/<[^>]+>/g, ''); last.style.color = cls === 'err' ? '#f87171' : cls === 'ok' ? '#4ade80' : '#64748b'; }
}
// Info cards stack on the right; each feature has its own card (key). Closing a card
// also switches its feature off, and the cards below move up.
const CARD_CLOSE = {
    wind:  () => { if (windOn) toggleWind(); },
    hko:   () => { if (hkoOn) toggleHKO(); },
    rfz:   () => { if (nfzOn) toggleNoFlyZones(); },
    route: () => { if (animationId) startAnimation(); },
    'explain-traffic': () => { boardFilter = 'all'; boardFocus = null; boardLayer.clearLayers(); activeDrones.forEach(updateUavLabel); },
};
const CARD_WIDTH = 340;   // every info card has the same width
// Each card shows only the key numbers. Details, method notes and definitions (anything passed as `help`
// or marked class="note") sit behind the "?" button in the card header.
const helpOpen = new Set();
function showInfo(title, body, width = CARD_WIDTH, key = 'main', help = '') {
    width = CARD_WIDTH;
    let c = document.getElementById('card-' + key);
    if (!c) {
        c = document.createElement('div');
        c.className = 'info-card'; c.id = 'card-' + key;
        c.innerHTML = '<button class="close-btn" title="Close">×</button><button class="help-btn" title="Details, method and definitions">?</button><h4></h4><div class="info-body"></div>';
        c.querySelector('.close-btn').onclick = () => { closeCard(key); (CARD_CLOSE[key] || (() => {}))(); };
        c.querySelector('h4').title = 'Click to minimise / expand';
        c.querySelector('h4').onclick = () => c.classList.toggle('min');
        c.querySelector('.help-btn').onclick = () => {
            if (helpOpen.has(key)) helpOpen.delete(key); else helpOpen.add(key);
            c.classList.toggle('help-open', helpOpen.has(key));
        };
        document.getElementById('infoStack').appendChild(c);
    }
    c.style.width = width + 'px';
    c.querySelector('h4').textContent = title;
    const tmp = document.createElement('div'); tmp.innerHTML = body;
    const notes = [...tmp.querySelectorAll('.note')]; notes.forEach(n => n.remove());
    const helpHTML = (help || '') + notes.map(n => n.outerHTML).join('');
    c.querySelector('.info-body').innerHTML = tmp.innerHTML + (helpHTML ? `<div class="info-help">${helpHTML}</div>` : '');
    c.querySelector('.help-btn').style.display = helpHTML ? '' : 'none';
    c.classList.toggle('help-open', helpOpen.has(key));
}
function closeCard(key) { const c = document.getElementById('card-' + key); if (c) c.remove(); }
function toggleBtn(id, state) { const b = document.getElementById(id); if (b) b.classList.toggle('btn-active', state); }
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
function distMetres(p1, p2) {
    const dlat = (p1[0] - p2[0]) * 111320;
    const dlon = (p1[1] - p2[1]) * 111320 * Math.cos(p1[0] * Math.PI / 180);
    return Math.sqrt(dlat * dlat + dlon * dlon);
}
function trackDeg(p1, p2) {
    const dN = (p2[0] - p1[0]) * 111320;
    const dE = (p2[1] - p1[1]) * 111320 * Math.cos(p1[0] * Math.PI / 180);
    return (Math.atan2(dE, dN) * 180 / Math.PI + 360) % 360;
}
const bearingDeg = trackDeg;
const COS0 = Math.cos(22.29 * Math.PI / 180);
const toXY = p => [(p[1] - 114.17) * 111320 * COS0, (p[0] - 22.29) * 110540];
const fromXY = (x, y) => [22.29 + y / 110540, 114.17 + x / (111320 * COS0)];
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;

// ---------- 3. Route endpoints: existing ferry piers ----------
// Coordinates: MFT = centre of the official eSUA control-point polygon; Central Pier 7,
// TST, North Point, Kai Tak from OSM-based gazetteers; Wan Chai & Hung Hom approximate.
const PIERS = {
    'PR-MFT': { name: 'Macau Ferry Terminal (Sheung Wan)', short: 'Macau Ferry', shore: 'HK Island', pos: [22.28907, 114.15241], color: '#22d3ee',
        ferry: ['Hong Kong – Macau cross-boundary high-speed ferries'], patronage: 'Cross-boundary terminal (Shun Tak Centre)',
        note: 'Shun Tak Heliport (VHST) on the same building — shared low-level airspace with manned helicopters.' },
    'PR-CEN': { name: 'Central Pier 7 (Star Ferry)', short: 'Central', shore: 'HK Island', pos: [22.28707, 114.16150], color: '#4ade80',
        ferry: ['Star Ferry (franchised): Central – Tsim Sha Tsui'], patronage: '≈39,000 pax/day (2016)',
        note: 'Busiest cross-harbour ferry link; HKO Central Pier anemometer close by.' },
    'PR-WC': { name: 'Wan Chai Ferry Pier', short: 'Wan Chai', shore: 'HK Island', pos: [22.28290, 114.17680], color: '#fbbf24', approx: true,
        ferry: ['Star Ferry (franchised): Wan Chai – Tsim Sha Tsui'], patronage: '≈15,000 pax/day (2016)',
        note: 'Position approximate (±50 m). Next to HKCEC government helipad.' },
    'PR-NP': { name: 'North Point Ferry Pier', short: 'North Point', shore: 'HK Island', pos: [22.29385, 114.19987], color: '#f472b6',
        ferry: ['North Point – Hung Hom', 'North Point – Kowloon City'], patronage: 'Licensed ferry services (TD)',
        note: 'HKO North Point anemometer about 100 m away.' },
    'PR-TST': { name: 'Tsim Sha Tsui Star Ferry Pier', short: 'Tsim Sha Tsui', shore: 'Kowloon', pos: [22.29354, 114.16799], color: '#a78bfa',
        ferry: ['Star Ferry: Tsim Sha Tsui – Central', 'Star Ferry: Tsim Sha Tsui – Wan Chai'], patronage: '≈54,000 pax/day, both routes (2016)',
        note: 'HKO Star Ferry anemometer on site.' },
    'PR-HH': { name: 'Hung Hom Ferry Pier', short: 'Hung Hom', shore: 'Kowloon', pos: [22.29980, 114.19010], color: '#fb923c', approx: true,
        ferry: ['Hung Hom – Central', 'Hung Hom – North Point'], patronage: 'Licensed ferry services (TD)',
        note: 'Position approximate (±50 m). Star Ferry Hung Hom routes ceased 1 Apr 2011; other operators continue.' },
    'PR-KT': { name: 'Kai Tak Cruise Terminal', short: 'Kai Tak', shore: 'Kowloon', pos: [22.30606, 114.21336], color: '#38bdf8',
        ferry: ['Cruise berths (no regular ferry route)'], patronage: 'Cruise passengers (seasonal)',
        note: 'HKO Kai Tak anemometer on the former runway (exposed to SE, sheltered from N/NE).' },
};

// Reference helipads (NOT route endpoints — manned-helicopter facilities)
const HELIPADS = [
    { name: 'Shun Tak Heliport (VHST)', pos: [22.28920, 114.15260], type: 'Official', desc: 'Shun Tak Centre rooftop · cross-boundary helicopter service · CAD AIP AD3' },
    { name: 'HKCEC Government Helipad', pos: [22.28450, 114.17580], type: 'Official', desc: 'NE corner of HKCEC · GFS priority, shared commercial use' },
    { name: 'Peninsula Hotel Helipad', pos: [22.2951, 114.1723], type: 'Private', desc: 'Hotel tower rooftop · private VIP / sightseeing' },
];

// HKO harbour-front automatic weather stations (anemometer height above mean sea level)
const HKO_STATIONS = [
    { id: 'CP', name: 'Central Pier', match: 'central pier', pos: [22.28889, 114.15583], hAnem: 30 },
    { id: 'SF', name: 'Star Ferry',   match: 'star ferry',   pos: [22.29306, 114.16861], hAnem: 18 },
    { id: 'NP', name: 'North Point',  match: 'north point',  pos: [22.29444, 114.19972], hAnem: 26 },
    { id: 'KT', name: 'Kai Tak',      match: 'kai tak',      pos: [22.30972, 114.21333], hAnem: 16 },
];

// ---------- 5. Official RFZ (advisory only) ----------
const RFZ_EN = {
    '港澳客輪碼頭管制站': 'Hong Kong-Macau Ferry Terminal Control Point',
    '中區軍用碼頭': 'Central Military Dock',
    '中國客運碼頭管制站': 'China Ferry Terminal Control Point',
    '啟德郵輪碼頭管制站': 'Kai Tak Cruise Terminal Control Point',
    '海運碼頭': 'Ocean Terminal',
    '港口管制 (中區政府碼頭)': 'Port Control (Central Government Pier)',
    '招商局碼頭 / 維多利亞港（低空經濟監管沙盒）': 'China Merchants Wharf / Victoria Harbour (LAE Regulatory Sandbox)',
    '維多利亞港': 'Victoria Harbour',
    '東面檢疫及入境船隻碇泊處': 'Eastern Quarantine and Immigration Anchorage',
    '水警海港區總部': 'Marine Police Harbour Division HQ',
    '政府總部建築群及立法會綜合大樓': 'Central Government Complex & LegCo',
    '中環軍營': 'Central Barracks',
    '灣仔政府大樓 (區域法院和家事法庭)': 'Wan Chai Tower (District & Family Courts)',
    '香港警察總部; 灣仔區總部暨灣仔警署': 'Police Headquarters / Wan Chai Division',
    '香港海關船隊基地 - 政府船塢': 'Customs Fleet Base – Government Dockyard',
};
const rfzEN = n => RFZ_EN[n] || 'Official RFZ (see eSUA map)';
const VH_RFZ_NAME = '維多利亞港';
const RFZ_ALL = ESUA_RFZ.features.map(f => {
    const ring = f.geometry.coordinates[0].map(c => [c[1], c[0]]);
    const lats = ring.map(p => p[0]), lons = ring.map(p => p[1]);
    return { name: f.properties.name, by: f.properties.description2, ring,
             bbox: [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)] };
});
const RFZ_POLYS = RFZ_ALL.filter(p => p.name !== VH_RFZ_NAME);
const VH_POLY = RFZ_ALL.find(p => p.name === VH_RFZ_NAME);
function pointInRing(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [yi, xi] = ring[i], [yj, xj] = ring[j];
        if (((yi > pt[0]) !== (yj > pt[0])) && (pt[1] < (xj - xi) * (pt[0] - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
}
function inPoly(pt, p) {
    return pt[0] >= p.bbox[0] && pt[0] <= p.bbox[2] && pt[1] >= p.bbox[1] && pt[1] <= p.bbox[3] && pointInRing(pt, p.ring);
}
function segsCross(a, b, c, d) {
    const o = (p, q, r) => Math.sign((q[1] - p[1]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[1] - p[1]));
    return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
function segmentHitsPoly(p1, p2, poly) {
    const [a0, b0, a1, b1] = poly.bbox;
    if (Math.max(p1[0], p2[0]) < a0 || Math.min(p1[0], p2[0]) > a1 || Math.max(p1[1], p2[1]) < b0 || Math.min(p1[1], p2[1]) > b1) return false;
    if (pointInRing(p1, poly.ring) || pointInRing(p2, poly.ring)) return true;
    for (let i = 0, j = poly.ring.length - 1; i < poly.ring.length; j = i++) if (segsCross(p1, p2, poly.ring[j], poly.ring[i])) return true;
    return false;
}
// ---------- 4. Waypoint graph ----------
const WP = {};
Object.entries(PIERS).forEach(([id, p]) => WP[id] = p.pos);
// Access / holding fixes (AC-*) — computed by rule, not hand-placed:
//  direction = shoreline normal (tangent from the neighbouring piers on the same shore), toward the opposite shore
//  distance  = smallest d ≥ R_HOLD + MIN_SEPARATION (a UAV orbiting the fix stays ≥ 80 m from pier operations)
//              such that the fix is outside every named RFZ and ≥ 2·R_HOLD from every other fix,
//              capped at 40 % of the channel width so cross-harbour links keep their length
const MIN_SEPARATION = 80, WARN_SEPARATION = 150;
const R_HOLD = 90;
const D_MIN = R_HOLD + MIN_SEPARATION;
const AC_SPACING = 2 * R_HOLD;
const SHORES = { 'HK Island': ['PR-MFT', 'PR-CEN', 'PR-WC', 'PR-NP'], 'Kowloon': ['PR-TST', 'PR-HH', 'PR-KT'] };
const AC_INFO = {};
function rayHitPolyline(p, dir, pts) {
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
        const [x3, y3] = pts[i], [x4, y4] = pts[i + 1];
        const den = dir[0] * (y4 - y3) - dir[1] * (x4 - x3);
        if (Math.abs(den) < 1e-9) continue;
        const t = ((x3 - p[0]) * (y4 - y3) - (y3 - p[1]) * (x4 - x3)) / den;
        const u = ((x3 - p[0]) * dir[1] - (y3 - p[1]) * dir[0]) / den;
        if (t > 0 && u >= 0 && u <= 1) best = Math.min(best, t);
    }
    return best;
}
(function computeAccessFixes() {
    const placed = [];
    Object.entries(SHORES).forEach(([shore, ids]) => {
        const other = SHORES[shore === 'HK Island' ? 'Kowloon' : 'HK Island'].map(id => toXY(PIERS[id].pos));
        const oc = [mean(other.map(q => q[0])), mean(other.map(q => q[1]))];
        ids.forEach((id, k) => {
            const p = toXY(PIERS[id].pos);
            const a = toXY(PIERS[ids.at(Math.max(0, k - 1))].pos), b = toXY(PIERS[ids.at(Math.min(ids.length - 1, k + 1))].pos);
            const tl = Math.hypot(b[0] - a[0], b[1] - a[1]);
            let nx = -(b[1] - a[1]) / tl, ny = (b[0] - a[0]) / tl;
            if ((oc[0] - p[0]) * nx + (oc[1] - p[1]) * ny < 0) { nx = -nx; ny = -ny; }
            let width = rayHitPolyline(p, [nx, ny], other);
            const widthSrc = isFinite(width) ? 'along normal' : 'nearest opposite pier';
            if (!isFinite(width)) width = Math.min(...other.map(q => Math.hypot(q[0] - p[0], q[1] - p[1])));
            const cap = 0.4 * width;
            const at = d => [p[0] + nx * d, p[1] + ny * d];
            const inRFZ = q => RFZ_POLYS.filter(pl => inPoly(fromXY(q[0], q[1]), pl)).map(pl => pl.name);
            const spaced = q => placed.every(o => Math.hypot(o[0] - q[0], o[1] - q[1]) >= AC_SPACING);
            let d = D_MIN, flag = '';
            while (d <= cap && (inRFZ(at(d)).length || !spaced(at(d)))) d += 10;
            if (d > cap) { d = D_MIN; flag = 'constraints not all met within cap — kept at D_MIN'; }
            const q = at(d); placed.push(q);
            const acId = 'AC-' + id.slice(3);
            WP[acId] = fromXY(q[0], q[1]);
            AC_INFO[acId] = { pier: id, d, bearing: (Math.atan2(nx, ny) * 180 / Math.PI + 360) % 360, width, widthSrc, cap,
                              rfz: inRFZ(q), flag };
        });
    });
})();
const BASE_EDGES = [
    ['PR-MFT','AC-MFT',false], ['PR-CEN','AC-CEN',false], ['PR-WC','AC-WC',false], ['PR-NP','AC-NP',false],
    ['PR-TST','AC-TST',false], ['PR-HH','AC-HH',false],   ['PR-KT','AC-KT',false],
    ['AC-MFT','AC-CEN',false,'local'], ['AC-CEN','AC-WC',false,'local'], ['AC-WC','AC-NP',false,'local'],
    ['AC-TST','AC-HH',false,'local'],  ['AC-HH','AC-KT',false,'local'],
    ['AC-CEN','AC-TST',false,'ferry:Star Ferry Central – Tsim Sha Tsui'],
    ['AC-WC','AC-TST',false,'ferry:Star Ferry Wan Chai – Tsim Sha Tsui'],
    // Central – Hung Hom removed after the network check: it created the only crossing and shortened
    // 12 pier pairs by only ~15 m each (mean detour 1.113 → 1.114 without it)
    ['AC-NP','AC-HH',false,'ferry:North Point – Hung Hom ferry'],
    ['AC-WC','AC-HH',false,'ferry:former Wan Chai – Hung Hom ferry route (ceased 2011)'],
    ['AC-NP','AC-KT',false,'cross:Direct North Point – Kai Tak crossing (no ferry route)'],
    // Macau Ferry – Tsim Sha Tsui: no ferry route, but adds no crossing and removes Macau Ferry's single-link cut
    ['AC-MFT','AC-TST',false,'cross:Direct Macau Ferry – Tsim Sha Tsui crossing (no ferry route)'],
];

// Any geometric crossing becomes an explicit junction node (XJ-n).
// Straight-through only: a UAV may not turn at a crossing junction.
const CROSSINGS = [];
const THROUGH = {};
function segIntersect(a, b, c, d) {
    const [x1, y1] = toXY(a), [x2, y2] = toXY(b), [x3, y3] = toXY(c), [x4, y4] = toXY(d);
    const den = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
    if (Math.abs(den) < 1e-9) return null;
    const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / den;
    const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / den;
    if (t <= 0.02 || t >= 0.98 || u <= 0.02 || u >= 0.98) return null;
    const dot = (x2 - x1) * (x4 - x3) + (y2 - y1) * (y4 - y3);
    let ang = Math.atan2(Math.abs(den), dot) * 180 / Math.PI; ang = Math.min(ang, 180 - ang);
    return { t, u, x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1), angle: ang };
}
const GRAPH_EDGES = (function splitCrossings() {
    const splits = {};
    for (let i = 0; i < BASE_EDGES.length; i++) for (let j = i + 1; j < BASE_EDGES.length; j++) {
        const [a, b] = BASE_EDGES[i], [c, d] = BASE_EDGES[j];
        if (new Set([a, b, c, d]).size < 4) continue;
        const r = segIntersect(WP[a], WP[b], WP[c], WP[d]);
        if (!r) continue;
        const id = `XJ-${CROSSINGS.length + 1}`;
        WP[id] = fromXY(r.x, r.y);
        CROSSINGS.push({ id, pos: WP[id], e1: BASE_EDGES[i], e2: BASE_EDGES[j], angle: r.angle });
        (splits[i] = splits[i] || []).push({ t: r.t, id });
        (splits[j] = splits[j] || []).push({ t: r.u, id });
    }
    const out = [];
    BASE_EDGES.forEach((e, i) => {
        if (!splits[i]) { out.push(e); return; }
        const pts = [e[0], ...splits[i].sort((p, q) => p.t - q.t).map(s => s.id), e[1]];
        for (let k = 0; k < pts.length - 1; k++) out.push([pts[k], pts[k + 1], e[2], e[3]]);
        for (let k = 1; k < pts.length - 1; k++) {
            THROUGH[pts[k]] = THROUGH[pts[k]] || {};
            THROUGH[pts[k]][pts[k - 1]] = pts[k + 1];
            THROUGH[pts[k]][pts[k + 1]] = pts[k - 1];
        }
    });
    return out;
})();
const ADJ = {};
GRAPH_EDGES.forEach(([a, b, oneWay]) => {
    (ADJ[a] = ADJ[a] || []).push(b);
    if (!oneWay) (ADJ[b] = ADJ[b] || []).push(a);
});
const DEGREE = {};
Object.keys(ADJ).forEach(n => DEGREE[n] = ADJ[n].length);
const edgeKey = (a, b) => a < b ? `${a}|${b}` : `${b}|${a}`;
const dirKey = (a, b) => `${a}>${b}`;
const isJunction = n => !n.startsWith('PR-');

const NODE_RFZ = {};
Object.keys(WP).forEach(n => NODE_RFZ[n] = RFZ_POLYS.filter(p => inPoly(WP[n], p)).map(p => p.name));
const NODE_IN_VH = {};
Object.keys(WP).forEach(n => NODE_IN_VH[n] = VH_POLY ? inPoly(WP[n], VH_POLY) : false);
const EDGE_RFZ = {};
GRAPH_EDGES.forEach(([a, b]) => EDGE_RFZ[edgeKey(a, b)] = RFZ_POLYS.filter(p => segmentHitsPoly(WP[a], WP[b], p)).map(p => p.name));
const rfzCrossings = (u, v) => EDGE_RFZ[edgeKey(u, v)] || [];

// ---------- 6. Wind field from HKO harbour stations ----------
// V(z) = V_obs · (z / h_anem)^α   (power law, α fitted live from the model profile)
// Leg wind = inverse-distance-weighted vector mean of the stations at the leg's level,
// then × building-wake factor K. Gust factor decays with height.
const UAV = {
    mass: 15, v_air: 15, v_climb: 3, v_descent: 2, rotorArea: 0.985, FM: 0.70, CdA: 0.10,
    battery_Wh: 950, reserve: 0.20, maxWind: 12, maxGust: 20,
};
// Three-layer corridor: two normal layers split by track (ICAO semicircular rule) + one reserved emergency layer
const LEVEL_ALT = { 1: 90, 2: 110, 3: 60 };
const LEVEL_E = 3;
const LEVEL_NAME = { 1: 'A · 90 m', 2: 'B · 110 m', 3: 'E · 60 m (emergency)' };
const SEP_ROUTING = 80;
const VERTICAL_SEPARATION = 15;       // m — 3D tactical / strategic vertical buffer
const VERTICAL_GATE_RADIUS = 100;     // m — protected cylinder for layer changes
const EMG_ENTRY_MAX_DELAY = 60;       // s — maximum gate wait before entering layer E
const EMG_RESERVE = 0.10;
const EMG_RETRY_S = 5;                // s — re-check interval when no diversion is feasible yet             // emergency landing may use battery down to 10% SOC
const HKO_CSV = 'https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_10min_wind.csv';

let windModel = { loaded: false, source: 'none', alpha: 0.16, alphaSrc: 'default', temp: 25, stations: [], loo: null, updated: '', maxV: 0 };

const TALL_BUILDINGS = [
    { lat: 22.3033, lon: 114.1605, h: 484 }, { lat: 22.2855, lon: 114.1580, h: 415 },
    { lat: 22.2795, lon: 114.1710, h: 374 }, { lat: 22.2810, lon: 114.1590, h: 367 },
    { lat: 22.2835, lon: 114.1545, h: 350 }, { lat: 22.2800, lon: 114.1600, h: 283 },
];
function wakeK(lat, lon, windFrom) {
    let effect = 0;
    const windTo = (windFrom + 180) % 360;
    for (const b of TALL_BUILDINGS) {
        const dist = distMetres([lat, lon], [b.lat, b.lon]);
        const range = b.h * 4;
        if (dist <= 0 || dist >= range) continue;
        let diff = Math.abs(bearingDeg([b.lat, b.lon], [lat, lon]) - windTo);
        if (diff > 180) diff = 360 - diff;
        const prox = 1 - dist / range;
        if (diff < 30) effect -= 0.4 * prox;
        else if (diff > 60 && diff < 120) effect += 0.25 * prox;
    }
    return clamp(1 + effect, 0.6, 1.3);
}
function stationAt(st, z) {
    const a = windModel.alpha;
    const V = st.V * Math.pow(z / st.h, a);
    const G = st.V > 0.5 ? Math.max(1, st.gust / st.V) : 1.4;
    const Gz = 1 + (G - 1) * Math.pow(st.h / z, a);
    return { V, gust: V * Gz };
}
function windField(lat, lon, z, exclude = null) {
    const sts = windModel.stations.filter(s => s !== exclude);
    if (!windModel.loaded || !sts.length) return { speed: 0, dir: 0, gust: 0 };
    let su = 0, sv = 0, sg = 0, sw = 0;
    sts.forEach(st => {
        const d = Math.max(50, distMetres([lat, lon], st.pos));
        const w = 1 / (d * d);
        const { V, gust } = stationAt(st, z);
        const r = st.dir * Math.PI / 180;
        su += w * V * Math.sin(r); sv += w * V * Math.cos(r); sg += w * gust; sw += w;
    });
    const u = su / sw, v = sv / sw;
    return { speed: Math.hypot(u, v), dir: (Math.atan2(u, v) * 180 / Math.PI + 360) % 360, gust: sg / sw };
}
function legWind(p1, p2, z) {
    const mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
    const f = windField(mid[0], mid[1], z);
    const K = windModel.loaded ? wakeK(mid[0], mid[1], f.dir) : 1;
    return { w: f.speed * K, dir: f.dir, gust: f.gust * K, K };
}
function levelOfTrack(p1, p2) { return trackDeg(p1, p2) < 180 ? 1 : 2; }
function groundSpeed(p1, p2, lvl) {
    const z = LEVEL_ALT[lvl || levelOfTrack(p1, p2)];
    const lw = legWind(p1, p2, z);
    const track = bearingDeg(p1, p2);
    const rel = (((lw.dir + 180) % 360) - track) * Math.PI / 180;
    const wAlong = lw.w * Math.cos(rel), wCross = lw.w * Math.sin(rel);
    if (Math.abs(wCross) >= UAV.v_air) return { vg: 0, w: lw.w, wAlong, wCross, gust: lw.gust, z, feasible: false };
    const vg = Math.sqrt(UAV.v_air ** 2 - wCross ** 2) + wAlong;
    return { vg, w: lw.w, wAlong, wCross, gust: lw.gust, z, feasible: vg > 1 };
}
const COMPASS = { n: 0, nne: 22.5, ne: 45, ene: 67.5, e: 90, ese: 112.5, se: 135, sse: 157.5, s: 180, ssw: 202.5, sw: 225, wsw: 247.5, w: 270, wnw: 292.5, nw: 315, nnw: 337.5,
    north: 0, northnortheast: 22.5, northeast: 45, eastnortheast: 67.5, east: 90, eastsoutheast: 112.5, southeast: 135, southsoutheast: 157.5,
    south: 180, southsouthwest: 202.5, southwest: 225, westsouthwest: 247.5, west: 270, westnorthwest: 292.5, northwest: 315, northnorthwest: 337.5 };
function parseHKO(txt, fallbackDir) {
    const out = [];
    txt.split(/\r?\n/).slice(1).forEach(line => {
        const c = line.split(',').map(x => x.trim().replace(/^"|"$/g, ''));
        if (c.length < 5) return;
        const st = HKO_STATIONS.find(s => c[1].toLowerCase().includes(s.match));
        if (!st) return;
        const key = c[2].toLowerCase().replace(/[\s-]/g, '');
        const V = c[3] === '' ? 0 : parseFloat(c[3]) / 3.6, G = parseFloat(c[4]) / 3.6;
        if (key === 'calm') { out.push({ ...st, h: st.hAnem, V: 0, gust: isFinite(G) ? G : 0, dir: fallbackDir, time: c[0] }); return; }
        if (!isFinite(V)) return;
        const dir = key in COMPASS ? COMPASS[key] : fallbackDir;
        out.push({ ...st, h: st.hAnem, V, gust: isFinite(G) ? G : V * 1.4, dir, time: c[0] });
    });
    return out;
}
function computeLOO() {
    if (windModel.stations.length < 3) return null;
    const errs = windModel.stations.map(st => {
        const pred = windField(st.pos[0], st.pos[1], st.h, st).speed;
        return { id: st.id, obs: st.V, pred, err: pred - st.V };
    });
    return { rows: errs, rmse: Math.sqrt(mean(errs.map(e => e.err ** 2))), bias: mean(errs.map(e => e.err)) };
}
// Built-in snapshot for offline presentations: illustrative autumn easterly (NOT live data).
const SNAPSHOT = {
    label: 'Offline snapshot — illustrative autumn easterly (not live data)',
    alpha: 0.16, temp: 26.0,
    wind: { CP: [5.0, 8.1, 90], SF: [3.9, 6.9, 90], NP: [5.8, 9.4, 67.5], KT: [6.4, 10.0, 90] },   // mean m/s, gust m/s, from°
    weather: [['Central Pier', 26.4, 78], ['Star Ferry', 26.1, 79], ['North Point', 25.9, 80], ['Kai Tak', 25.7, 81]],
};
let dataMode = 'live';
function setDataMode(m) {
    dataMode = m;
    addLog(m === 'snapshot' ? 'Data source: offline snapshot (illustrative, not live)' : 'Data source: live feeds', m === 'snapshot' ? 'err' : 'ok');
    loadWind(false);
    if (hkoOn) fetchHKOWeather();
}
function snapshotStations() {
    return HKO_STATIONS.map(s => { const [V, gust, dir] = SNAPSHOT.wind[s.id]; return { ...s, h: s.hAnem, V, gust, dir, time: 'snapshot' }; });
}
const timed = (ms = 8000) => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? { signal: AbortSignal.timeout(ms) } : {};
function fmtHKOTime(t) { return /^\d{12}$/.test(t || '') ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)} ${t.slice(8, 10)}:${t.slice(10, 12)} HKT` : (t || ''); }
function pickHKOFile() { document.getElementById('hkoFile').click(); }
function loadHKOFile(input) {
    const f = input.files && input.files[0]; if (!f) return;
    f.text().then(txt => {
        const sts = parseHKO(txt, 90);
        input.value = '';
        if (sts.length < 2) { addLog(`HKO CSV: only ${sts.length} of the 4 harbour stations found — is this latest_10min_wind.csv?`, 'err'); return; }
        windModel.manualHKO = { sts, time: fmtHKOTime(sts[0].time) };
        if (dataMode !== 'live') dataMode = 'live';
        windModel.source = `HKO 10-min observations (loaded CSV file, ${sts.length} stations)`; windModel.updated = windModel.manualHKO.time;
        windModel.hkoStatus = 'ok (CSV file)';
        finishWind(sts, false);
        if (!windOn) toggleWind();
    });
}
async function loadWind(silent = false) {
    let modelDir = 90;
    if (dataMode === 'snapshot') {
        windModel.alpha = SNAPSHOT.alpha; windModel.alphaSrc = 'snapshot value'; windModel.temp = SNAPSHOT.temp;
        windModel.source = SNAPSHOT.label; windModel.updated = 'snapshot';
        return finishWind(snapshotStations(), silent);
    }
    try {
        const url = 'https://api.open-meteo.com/v1/forecast?latitude=22.29&longitude=114.17' +
            '&hourly=wind_speed_10m,wind_speed_80m,wind_speed_120m,wind_direction_80m,temperature_2m' +
            '&wind_speed_unit=ms&forecast_days=1&timezone=Asia%2FHong_Kong';
        const d = await (await fetch(url, timed())).json();
        const h = new Date().getHours();
        const v10 = d.hourly.wind_speed_10m[h], v80 = d.hourly.wind_speed_80m[h], v120 = d.hourly.wind_speed_120m[h];
        windModel.profile = { v10, v80, v120 };
        if (v10 > 0.3 && v80 > 0.3) {
            windModel.alpha = clamp(Math.log(v80 / v10) / Math.log(8), 0.08, 0.40);
            windModel.alphaSrc = `fitted: ln(V80/V10)/ln 8 from model profile (${v10}/${v80} m/s)`;
        }
        windModel.temp = d.hourly.temperature_2m[h] ?? 25;
        modelDir = d.hourly.wind_direction_80m[h] ?? 90;
    } catch (e) { windModel.alphaSrc = 'default 0.16 (profile unavailable)'; }

    let sts = [];
    try {
        const r = await fetch(HKO_CSV, timed());
        if (!r.ok) throw new Error('HTTP ' + r.status);
        sts = parseHKO(await r.text(), modelDir);
        if (sts.length >= 2) { windModel.source = `HKO 10-min observations (${sts.length} harbour stations)`; windModel.updated = fmtHKOTime(sts[0].time); windModel.hkoStatus = 'ok'; }
        else windModel.hkoStatus = `file read, but only ${sts.length} of the 4 harbour stations found`;
    } catch (e) {
        sts = [];
        windModel.hkoStatus = (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'no answer within 8 s'
            : (e instanceof TypeError) ? 'blocked by the browser (cross-origin rule) or no network' : e.message;
    }
    if (sts.length < 2 && windModel.manualHKO) {
        sts = windModel.manualHKO.sts;
        windModel.source = `HKO 10-min observations (loaded CSV file, ${sts.length} stations)`; windModel.updated = windModel.manualHKO.time;
    }
    if (sts.length < 2) {
        try {
            const lat = HKO_STATIONS.map(s => s.pos[0]).join(','), lon = HKO_STATIONS.map(s => s.pos[1]).join(',');
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
                '&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=ms&timezone=Asia%2FHong_Kong';
            const arr = await (await fetch(url, timed())).json();
            const list = Array.isArray(arr) ? arr : [arr];
            sts = HKO_STATIONS.map((s, i) => ({ ...s, h: 10, V: list[i].current.wind_speed_10m, gust: list[i].current.wind_gusts_10m,
                                                 dir: list[i].current.wind_direction_10m, time: list[i].current.time }));
            windModel.source = 'Open-Meteo forecast model (fallback — not HKO observations)';
            windModel.updated = sts[0].time;
        } catch (e) { sts = []; }
    }
    if (!sts.length) {
        // Both live feeds failed (e.g. no internet at a presentation): fall back to the built-in snapshot
        sts = snapshotStations();
        windModel.source = 'Offline snapshot (fallback — live feeds not reachable; illustrative, not live)';
        windModel.updated = 'snapshot';
        if (windModel.alphaSrc.startsWith('default')) { windModel.alpha = SNAPSHOT.alpha; windModel.temp = SNAPSHOT.temp; }
    }
    return finishWind(sts, silent);
}
function finishWind(sts, silent) {
    windModel.stations = sts;
    windModel.loaded = sts.length > 0;
    windModel.maxV = sts.length ? Math.max(...sts.map(s => stationAt(s, 110).V)) * 1.3 : 0;
    windModel.loo = computeLOO();
    if (!silent) addLog(windModel.loaded ? `Wind: ${windModel.source}, α=${windModel.alpha.toFixed(3)}` : 'No wind data — still air assumed',
                        windModel.loaded ? 'ok' : 'err');
    if (windOn) renderWind();
}

// ---------- 7. Physical cost and A* ----------
function powerModel(z = 100) {
    const T = windModel.temp - 0.0065 * z;
    const rho = 1.225 * 288.15 / (T + 273.15);
    const Wt = UAV.mass * 9.81;
    const P_ind = Math.pow(Wt, 1.5) / Math.sqrt(2 * rho * UAV.rotorArea) / UAV.FM;
    const P_par = 0.5 * rho * UAV.CdA * UAV.v_air ** 3;
    return { rho, T, P_hover: P_ind, P_cruise: P_ind + P_par, P_climb: P_ind + Wt * UAV.v_climb };
}
function edgeCost(u, v, counts = {}, lvl) {
    const p1 = WP[u], p2 = WP[v];
    const d = distMetres(p1, p2);
    const gs = groundSpeed(p1, p2, lvl);
    const base = { d, rfz: rfzCrossings(u, v), z: gs.z, w: gs.w, gust: gs.gust, wAlong: gs.wAlong, wCross: gs.wCross };
    if (gs.gust > UAV.maxGust) return { ...base, cost: Infinity, reason: 'gust limit' };
    if (gs.w > UAV.maxWind) return { ...base, cost: Infinity, reason: 'wind limit' };
    if (!gs.feasible) return { ...base, cost: Infinity, reason: 'crosswind > airspeed' };
    const tFlight = d / gs.vg;
    const n = counts[dirKey(u, v)] || 0;
    const mu = UAV.v_air / SEP_ROUTING;
    const lambda = n / tFlight;
    if (lambda >= mu) return { ...base, cost: Infinity, reason: 'capacity' };
    const wq = lambda > 0 ? lambda / (mu * (mu - lambda)) : 0;
    return { ...base, cost: tFlight + wq, tFlight, wq, n, vg: gs.vg };
}
function nextNodes(prev, node) {
    if (THROUGH[node] && prev && THROUGH[node][prev]) return [THROUGH[node][prev]];
    return (ADJ[node] || []).filter(n => n !== prev);
}
function aStar(start, goal, counts = {}, costFn = edgeCost, lvl) {
    const vMax = UAV.v_air + windModel.maxV;
    const hFn = n => distMetres(WP[n], WP[goal]) / vMax;
    const s0 = '>' + start;
    const g = { [s0]: 0 }, came = {}, st = { [s0]: ['', start] };
    const open = new Set([s0]), closed = new Set();
    while (open.size) {
        let cur = null, best = Infinity;
        open.forEach(k => { const f = g[k] + hFn(st[k][1]); if (f < best) { best = f; cur = k; } });
        const [p, n] = st[cur];
        if (n === goal) {
            const path = [n]; let k = cur;
            while (came[k]) { k = came[k]; path.unshift(st[k][1]); }
            const m = routeMetrics(path, counts, lvl); if (m) m.objective = g[cur]; return m;
        }
        open.delete(cur); closed.add(cur);
        for (const nb of nextNodes(p, n)) {
            const k2 = n + '>' + nb;
            if (closed.has(k2)) continue;
            const ec = costFn(n, nb, counts);
            if (!isFinite(ec.cost)) continue;
            const tg = g[cur] + ec.cost;
            if (tg < (g[k2] ?? Infinity)) { g[k2] = tg; came[k2] = cur; st[k2] = [n, nb]; open.add(k2); }
        }
    }
    return null;
}
function routeMetrics(path, counts = {}, lvl) {
    let d = 0, tFlight = 0, tQueue = 0;
    const legs = [];
    for (let i = 0; i < path.length - 1; i++) {
        const ec = edgeCost(path[i], path[i + 1], counts, lvl);
        if (!isFinite(ec.cost)) return null;
        d += ec.d; tFlight += ec.tFlight; tQueue += ec.wq;
        legs.push({ from: path[i], to: path[i + 1], ...ec });
    }
    const pm = powerModel(100);
    const z0 = legs[0].z, z1 = legs[legs.length - 1].z;
    const tClimb = z0 / UAV.v_climb, tDesc = z1 / UAV.v_descent;
    const E_Wh = (pm.P_cruise * (tFlight + tQueue) + pm.P_climb * tClimb + pm.P_hover * tDesc) / 3600;
    return {
        path, legs, d, tFlight, tQueue, tClimb, tDesc, rfzHit: [...new Set(legs.flatMap(l => l.rfz))],
        tTotal: tFlight + tQueue + tClimb + tDesc, E_Wh, batteryPct: E_Wh / UAV.battery_Wh * 100,
        feasibleBattery: E_Wh <= UAV.battery_Wh * (1 - UAV.reserve), pm,
    };
}
function edgePhysicsHTML(a, b) {
    const cnt = currentEdgeCounts();
    const f = edgeCost(a, b, cnt), r = edgeCost(b, a, cnt);
    const fmt = (e, lbl) => isFinite(e.cost)
        ? `${lbl} @${e.z} m: w=${e.w.toFixed(1)} m/s, v<sub>g</sub>=${e.vg.toFixed(1)} m/s, t=${e.tFlight.toFixed(1)} s${e.wq ? `, W<sub>q</sub>=${e.wq.toFixed(1)} s` : ''}`
        : `${lbl}: blocked (${e.reason})`;
    const z = rfzCrossings(a, b);
    const e = edgeCost(a, b, {}, LEVEL_E);
    return `${fmt(f, a + '→' + b)}<br>${fmt(r, b + '→' + a)}<br><span style="color:#fca5a5">${fmt(e, 'Emergency layer')}</span><br>` +
        (z.length ? `<span style="color:#fca5a5">Crosses RFZ: ${z.map(rfzEN).join(', ')} (advisory)</span><br>` : '') +
        `<i style="font-size:10px">${windModel.loaded ? windModel.source : 'No wind data (still air)'}</i>`;
}

// ---------- 8. Layers ----------
const vertiportLayer = L.layerGroup(), nfzLayer = L.layerGroup(), waypointLayer = L.layerGroup(),
      droneLayer = L.layerGroup(), windLayer = L.layerGroup(), corridorLayer = L.layerGroup();
let vertiportOn = false, nfzOn = false, waypointOn = false, droneOn = false, windOn = false, corridorOn = false;

// Leaflet is a 2D map, so the two directional cruise layers are drawn with a small lateral
// offset. The offset is only a visual encoding; the model itself uses true z = 60/90/110 m.
function offsetSegment(a, b, metres) {
    const dN = (b[0] - a[0]) * 111320, dE = (b[1] - a[1]) * 111320 * COS0;
    const len = Math.max(1, Math.hypot(dN, dE)), nN = -dE / len, nE = dN / len;
    const dLat = nN * metres / 111320, dLon = nE * metres / (111320 * COS0);
    return [[a[0] + dLat, a[1] + dLon], [b[0] + dLat, b[1] + dLon]];
}
function corridorArrow(a, b, color, label) {
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], rot = bearingDeg(a, b);
    return L.marker(mid, { interactive: false, icon: L.divIcon({ className: 'drone-icon',
        html: `<div title="${label}" style="color:${color};font-size:14px;transform:rotate(${rot}deg);text-shadow:0 0 5px #020617">↑</div>`,
        iconSize: [14, 14], iconAnchor: [7, 7] }) });
}
// ---------- View switch: 2D map | 3D map ----------
function setView(mode) {
    if (mode === '3d') mode = 'map3d';
    if (mode !== 'map3d' && M3.on) close3dMap();
    if (mode === 'map3d' && !M3.on) open3dMap();
    syncViewSwitch();
}
function syncViewSwitch() {
    const mm = M3.on;
    document.getElementById('vsMap').classList.toggle('on', mm);
    document.getElementById('vs2d').classList.toggle('on', !mm);
    toggleBtn('btnCorridor', mm);
}

// ---------- Real 3D map: MapLibre (satellite + 3D buildings) with deck.gl corridor layers at true altitude ----------
const M3 = { map: null, overlay: null, on: false, ex: 1, raf: null, staticLayers: [] };
const rgb = (hex, a = 255) => { const h = hex.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), a]; };
const m3pos = (ll, z) => [ll[1], ll[0], z * M3.ex];
function m3Static() {
    const links = [], eLinks = [], cols = [], fixes = [];
    GRAPH_EDGES.forEach(([u, v]) => {
        [[u, v], [v, u]].forEach(([a, b]) => { const lvl = levelOfTrack(WP[a], WP[b]);
            links.push({ path: [m3pos(WP[a], LEVEL_ALT[lvl]), m3pos(WP[b], LEVEL_ALT[lvl])], color: rgb(lvl === 1 ? '#22d3ee' : '#a78bfa', 230), name: `${a} → ${b} · layer ${lvl === 1 ? 'A 90' : 'B 110'} m` }); });
        eLinks.push({ path: [m3pos(WP[u], LEVEL_ALT[LEVEL_E]), m3pos(WP[v], LEVEL_ALT[LEVEL_E])], name: `${u} ↔ ${v} · layer E 60 m (emergency)` });
    });
    Object.keys(WP).forEach(id => {
        if (id.startsWith('AC-')) { cols.push({ path: [m3pos(WP[id], LEVEL_ALT[LEVEL_E]), m3pos(WP[id], LEVEL_ALT[2])], color: rgb('#fcd34d', 200) });
            [1, 2].forEach(l => fixes.push({ pos: m3pos(WP[id], LEVEL_ALT[l]), name: id })); }
    });
    const piers = Object.entries(PIERS).map(([id, p]) => ({ pos: m3pos(p.pos, 0), name: p.short }));
    piers.forEach(p => cols.push({ path: [p.pos, [p.pos[0], p.pos[1], LEVEL_ALT[2] * M3.ex]], color: rgb('#e2e8f0', 150) }));
    return [
        new deck.PathLayer({ id: 'm3-e', data: eLinks, getPath: d => d.path, getColor: rgb('#ef4444', 170), getWidth: 6, widthUnits: 'meters', widthMinPixels: 1.5, pickable: true }),
        new deck.PathLayer({ id: 'm3-ab', data: links, getPath: d => d.path, getColor: d => d.color, getWidth: 10, widthUnits: 'meters', widthMinPixels: 2, pickable: true }),
        new deck.PathLayer({ id: 'm3-cols', data: cols, getPath: d => d.path, getColor: d => d.color, getWidth: 3, widthUnits: 'meters', widthMinPixels: 1 }),
        new deck.ScatterplotLayer({ id: 'm3-fix', data: fixes, getPosition: d => d.pos, getFillColor: rgb('#fcd34d'), getRadius: 16, radiusUnits: 'meters', radiusMinPixels: 3, billboard: true, pickable: true }),
        new deck.ScatterplotLayer({ id: 'm3-pier', data: piers, getPosition: d => d.pos, getFillColor: rgb('#2dd4bf'), getLineColor: [255, 255, 255, 255], stroked: true, lineWidthMinPixels: 1.5, getRadius: 45, radiusUnits: 'meters', radiusMinPixels: 5, pickable: true }),
        new deck.TextLayer({ id: 'm3-pier-lbl', data: piers, getPosition: d => [d.pos[0], d.pos[1], 0], getText: d => d.name, getSize: 13, getColor: rgb('#5eead4'), getPixelOffset: [0, 16],
            fontWeight: 700, background: true, getBackgroundColor: [2, 6, 23, 170], backgroundPadding: [4, 2], characterSet: 'auto' }),
    ];
}
function m3Uavs() {
    const data = activeDrones.map(d => { const pos = (d.state === 'landing' || d.state === 'landed') ? d.coords[d.coords.length - 1] : (d.state === 'ground' ? d.coords[0] : dronePos(d));
        return { id: d.id, pos: m3pos(pos, droneAltitude(d)), ground: [pos[1], pos[0], 0], color: rgb(PHASE_COL[uavPhase(d).tag] || '#ffffff'), focus: boardFocus === d.id, phase: uavPhase(d).phase }; });
    return [
        new deck.LineLayer({ id: 'm3-uav-drop', data: data.filter(d => d.pos[2] > 1), getSourcePosition: d => d.ground, getTargetPosition: d => d.pos, getColor: [226, 232, 240, 90], getWidth: 1 }),
        new deck.ScatterplotLayer({ id: 'm3-uav', data, getPosition: d => d.pos, getFillColor: d => d.color, getLineColor: d => d.focus ? [250, 204, 21, 255] : [11, 17, 32, 255], stroked: true, lineWidthMinPixels: 1.5,
            getRadius: d => d.focus ? 40 : 24, radiusUnits: 'meters', radiusMinPixels: 5, billboard: true, pickable: true, updateTriggers: { getRadius: boardFocus, getLineColor: boardFocus } }),
    ];
}
function build3dMap() {
    const map = new maplibregl.Map({
        container: 'm3Canvas', attributionControl: { compact: true },
        style: { version: 8, sources: { sat: { type: 'raster', tileSize: 256, attribution: 'Imagery © Esri',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'] } },
            layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0b1120' } }, { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-brightness-max': 0.8 } }] },
        center: [114.183, 22.297], zoom: 13.4, pitch: 58, bearing: -18, maxPitch: 80,
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.on('load', () => {
        // 3D buildings from OpenFreeMap (OpenMapTiles schema); skipped quietly if not reachable
        try {
            map.addSource('omt', { type: 'vector', url: 'https://tiles.openfreemap.org/planet' });
            map.addLayer({ id: 'bld', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 12.5,
                paint: { 'fill-extrusion-color': '#94a3b8', 'fill-extrusion-opacity': 0.55,
                    'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 12], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0] } });
        } catch (e) { addLog('3D buildings not available: ' + e.message, 'err'); }
        const pts = Object.values(WP); const lons = pts.map(p => p[1]), lats = pts.map(p => p[0]);
        // frame the harbour from the south-west, tilted
        map.jumpTo({ center: [(Math.min(...lons) + Math.max(...lons)) / 2 - 0.003, (Math.min(...lats) + Math.max(...lats)) / 2 - 0.004], zoom: 13.45, pitch: 60, bearing: -12 });
    });
    let warned = false;
    map.on('error', e => { if (!warned) { warned = true; addLog('3D map: some imagery or building tiles could not be loaded (internet needed) — corridors are still drawn', 'err'); } });
    M3.staticLayers = m3Static();
    M3.overlay = new deck.MapboxOverlay({ interleaved: true, layers: M3.staticLayers,
        getTooltip: ({ object }) => object && (object.id ? `${object.id} · ${object.phase}` : object.name) });
    map.addControl(M3.overlay);
    M3.map = map;
}
function loop3dMap() {
    if (!M3.on) return;
    M3.raf = requestAnimationFrame(loop3dMap);
    const now = performance.now(); if (now - (M3.last || 0) < 50) return; M3.last = now;   // ~20 fps is enough for the UAV layer
    M3.overlay.setProps({ layers: [...M3.staticLayers, ...m3Uavs()] });
}
function open3dMap() {
    if (typeof maplibregl === 'undefined' || typeof deck === 'undefined') { addLog('3D map libraries not available', 'err'); return false; }
    document.getElementById('m3View').classList.add('open');
    try { if (!M3.map) build3dMap(); else M3.map.resize(); }
    catch (e) { document.getElementById('m3View').classList.remove('open'); addLog('3D map not available in this browser (WebGL): ' + e.message, 'err'); return false; }
    M3.on = true; loop3dMap();
    addLog('3D map: corridors at true altitude over satellite imagery and 3D buildings (internet needed for imagery / buildings)', 'ok');
    return true;
}
function close3dMap() { M3.on = false; cancelAnimationFrame(M3.raf); document.getElementById('m3View').classList.remove('open'); }
function set3dMapExag(x) {
    M3.ex = x; document.getElementById('m3x1').classList.toggle('on', x === 1); document.getElementById('m3x3').classList.toggle('on', x === 3); document.getElementById('m3x10').classList.toggle('on', x === 10);
    M3.staticLayers = m3Static(); if (M3.overlay) M3.overlay.setProps({ layers: [...M3.staticLayers, ...m3Uavs()] });
}
function siteLabel(pos, html, color, below) {
    return L.marker(pos, { interactive: false, icon: L.divIcon({ className: 'drone-icon',
        html: `<div class="map-label lbl-site" style="color:${color}">${html}</div>`, iconSize: [200, 16], iconAnchor: [100, below ? -10 : 24] }) });
}
function pierPopup(id) {
    const p = PIERS[id];
    const nearest = HKO_STATIONS.map(s => ({ s, d: distMetres(s.pos, p.pos) })).sort((a, b) => a.d - b.d)[0];
    const rfz = NODE_RFZ[id];
    return `<b>${p.name}</b><br>${p.shore} · route endpoint<br>` +
        `<b>Ferry services:</b> ${p.ferry.join('; ')}<br><b>Patronage:</b> ${p.patronage}<br>` +
        `<b>Nearest HKO anemometer:</b> ${nearest.s.name} (${nearest.d.toFixed(0)} m)<br>` +
        `<b>Network degree:</b> ${DEGREE['AC-' + id.slice(3)] - 1} links from its access node<br>` +
        `<b>Official RFZ at site:</b> ${rfz.length ? rfz.map(rfzEN).join('; ') : 'none besides the Victoria Harbour RFZ'}<br>` +
        `<i style="font-size:10px">${p.note}</i>`;
}
function toggleVertiports() {
    vertiportOn = !vertiportOn; toggleBtn('btnVertiport', vertiportOn);
    if (!vertiportOn) { map.removeLayer(vertiportLayer); vertiportLayer.clearLayers(); return; }
    // A helipad within 80 m of a pier is on the same building (Shun Tak Heliport sits on the roof of the
    // Macau Ferry Terminal): draw it as an orange ring around the pier with one combined label.
    const coLoc = {};
    HELIPADS.forEach(h => { const id = Object.keys(PIERS).find(k => distMetres(PIERS[k].pos, h.pos) < 80); if (id) coLoc[id] = h; });
    Object.keys(PIERS).forEach((id, i) => {
        const p = PIERS[id], h = coLoc[id];
        const popup = h ? pierPopup(id) + `<hr style="border-color:#334155"><b>${h.name}</b> — same building (rooftop), ${distMetres(p.pos, h.pos).toFixed(0)} m from the pier point<br>${h.type} helipad · reference only, not a UAV endpoint<br>${h.desc}` : pierPopup(id);
        if (h) vertiportLayer.addLayer(L.circleMarker(p.pos, { radius: 14, color: '#f97316', weight: 3, fill: false }).bindPopup(popup));
        vertiportLayer.addLayer(L.circleMarker(p.pos, { radius: 9, fillColor: '#2dd4bf', fillOpacity: 0.9, color: '#fff', weight: 2 }).bindPopup(popup));
        // label on the land side, away from the access fix over the water
        const fixNorth = WP['AC-' + id.slice(3)][0] > p.pos[0];
        vertiportLayer.addLayer(siteLabel(p.pos, h ? `${p.short} + heliport (VHST)` : `${p.short}`, h ? '#fdba74' : '#2dd4bf', fixNorth));
    });
    HELIPADS.filter(h => !Object.values(coLoc).includes(h)).forEach((h, i) => {
        const c = h.type === 'Official' ? '#f97316' : '#fb923c';
        vertiportLayer.addLayer(L.circleMarker(h.pos, { radius: 6, fillColor: c, fillOpacity: 0.9, color: '#fff', weight: 2 })
            .bindPopup(`<b>${h.name}</b><br>${h.type} helipad — reference only, not a UAV endpoint<br>${h.desc}`));
        // helipad names to the right of the dot, so they do not cover nearby pier markers
        vertiportLayer.addLayer(L.marker(h.pos, { interactive: false, icon: L.divIcon({ className: 'drone-icon',
            html: `<div class="map-label lbl-site" style="color:${c};text-align:left;white-space:nowrap">${h.name.replace(' Helipad', ' (helipad)')}</div>`, iconSize: [200, 16], iconAnchor: [-10, 8] }) }));
    });
    vertiportLayer.addTo(map);
    addLog(`${Object.keys(PIERS).length} ferry piers (endpoints) + ${HELIPADS.length} helipads (reference)`, 'ok');
}
function toggleNoFlyZones() {
    nfzOn = !nfzOn; toggleBtn('btnNFZ', nfzOn);
    if (!nfzOn) { map.removeLayer(nfzLayer); nfzLayer.clearLayers(); closeCard('rfz'); return; }
    const gj = L.geoJSON(ESUA_RFZ, {
        renderer: L.canvas({ padding: 0.5 }),
        style: f => ({ color: f.properties.stroke, weight: f.properties['stroke-width'], opacity: f.properties['stroke-opacity'] ?? 1,
                       fillColor: f.properties.fill, fillOpacity: f.properties['fill-opacity'] }),
        onEachFeature: (f, layer) => layer.bindPopup(`<b>${rfzEN(f.properties.name)}</b><br>Effective: ${f.properties.description}<br>` +
            `Vertices: ${f.geometry.coordinates[0].length}<br><i style="font-size:10px">Cap 448G RFZ · eSUA Map Version ${ESUA_RFZ.version}</i><br><span style="font-size:10px;color:#fbbf24">Reference only — the study assumes no restrictions; real operations need CAD approval.</span>`),
    });
    nfzLayer.addLayer(gj); nfzLayer.addTo(map);
    showInfo('Restricted flying zones', `<span class="badge warn">Reference only</span><br>These zones are the real Cap 448G restricted flying zones from the CAD eSUA map, shown for reference only. This study assumes the corridor operates without these restrictions; any real operation would need CAD approval.`, CARD_WIDTH, 'rfz');
    addLog(`${ESUA_RFZ.features.length} official RFZ polygons loaded 1:1 (eSUA ${ESUA_RFZ.version})`, 'ok');
}
function toggleWaypoints() {
    waypointOn = !waypointOn; toggleBtn('btnWaypoint', waypointOn);
    if (!waypointOn) { map.removeLayer(waypointLayer); waypointLayer.clearLayers(); return; }
    GRAPH_EDGES.forEach(([a, b, , tag]) => {
        const zones = rfzCrossings(a, b);
        const isFerry = tag && (tag.startsWith('ferry:') || tag.startsWith('cross:')), isLocal = tag === 'local';
        let color = isFerry ? '#4ade80' : isLocal ? '#2dd4bf' : '#fcd34d';
        const desc = isFerry ? 'Cross-harbour link — ' + tag.slice(tag.indexOf(':') + 1) : isLocal ? 'Coastal link' : 'Pier spur';
        waypointLayer.addLayer(L.polyline([WP[a], WP[b]], { color, weight: 3, opacity: 0.6 })
            .bindPopup(() => `<b>${a} ↔ ${b}</b><br>${desc} · ${distMetres(WP[a], WP[b]).toFixed(0)} m<br>${edgePhysicsHTML(a, b)}` +
                (zones.length ? `<br><span style="color:#fbbf24">Passes through: ${zones.map(rfzEN).join(', ')} — real operation would need CAD permission.</span>` : '')));
    });
    Object.entries(WP).forEach(([id, pos]) => {
        const kind = id.slice(0, 2);
        const st = kind === 'PR' ? { c: '#2dd4bf', r: 7, l: 'Ferry pier (endpoint)' } : kind === 'XJ' ? { c: '#f43f5e', r: 7, l: 'Crossing junction (straight-through, slot-controlled)' }
                 : { c: '#fcd34d', r: 5, l: `Access / holding fix · degree ${DEGREE[id]}<br>${AC_INFO[id] ? `${AC_INFO[id].d.toFixed(0)} m from pier on bearing ${AC_INFO[id].bearing.toFixed(0)}° · holding orbit r = ${R_HOLD} m` : ''}` };
        const mk = kind === 'XJ'
            ? L.marker(pos, { icon: L.divIcon({ className: 'drone-icon', html: '<div style="width:12px;height:12px;background:#f43f5e;border:2px solid #fff;transform:rotate(45deg)"></div>', iconSize: [12, 12], iconAnchor: [6, 6] }) })
            : L.circleMarker(pos, { radius: st.r, fillColor: st.c, fillOpacity: 0.9, color: '#fff', weight: 1 });
        mk.bindPopup(`<b>${id}</b><br>${st.l}${isJunction(id) ? '<br>4D slot: one UAV per ' + MIN_SEPARATION + ' m / v<sub>g</sub> + 1 s' : ''}`);
        waypointLayer.addLayer(mk);
        // Pier nodes are already named by the pier layer; only fixes / junctions get a code label
        if (kind !== 'PR') waypointLayer.addLayer(L.marker(pos, { interactive: false, icon: L.divIcon({ className: 'drone-icon',
            html: `<div class="map-label lbl-node" style="color:${st.c}">${id}</div>`, iconSize: [60, 12],
            // fix code on the water side, away from its pier
            iconAnchor: [30, (WP['PR-' + id.slice(3)] && WP['PR-' + id.slice(3)][0] > pos[0]) ? -6 : 18] }) }));
    });
    waypointLayer.addTo(map);
    addLog(`Network: ${Object.keys(WP).length} nodes, ${GRAPH_EDGES.length} links, ${CROSSINGS.length} crossing junction(s)`, 'ok');
}

// ---------- 9. Traffic simulation (sim clock, strategic 4D slots + tactical) ----------
const SIM_SPEED = 8;          // simulated seconds per real second
const UNLOAD_S = 30;          // s on the pad after touchdown
const APPROACH_F = 0.5;       // speed factor on the final pier spur
let simTime = 0, lastFrame = null, trafficInterval = null, trafficAnimId = null;
let droneIdCounter = 0;
const activeDrones = [];
const stats = { completed: 0, los: 0, holds: 0, holdTime: 0, delays: [], emg: 0, emgTimes: [], done: [], losLog: [] };
const activeConflicts = new Set();
const strategicOn = true;   // strategic 4D deconfliction is always on in the live simulation
const RES = { nodes: {}, pads: {}, trajs: [], verticals: [] };
const padStatus = {};
Object.keys(PIERS).forEach(id => padStatus[id] = { occupiedBy: null, priority: null });

// Research scope: every normal logistics mission must cross Victoria Harbour.
// Same-shore links remain in the graph as feeder / resilience links, but never form an OD demand pair.
const isCrossHarbourOD = (a, b) => !!PIERS[a] && !!PIERS[b] && PIERS[a].shore !== PIERS[b].shore;
const odRoutes = [];
Object.keys(PIERS).forEach(a => Object.keys(PIERS).forEach(b => {
    if (isCrossHarbourOD(a, b)) odRoutes.push({ from: a, to: b, name: `${PIERS[a].short}→${PIERS[b].short}` });
}));
const OD_COUNT = odRoutes.length;       // 4 HK Island × 3 Kowloon × 2 directions = 24

(function initPierSelectors() {
    const from = document.getElementById('routeFrom'), to = document.getElementById('routeTo');
    ['HK Island', 'Kowloon'].forEach(g => [from, to].forEach(sel => {
        const og = document.createElement('optgroup'); og.label = g;
        Object.entries(PIERS).filter(([, p]) => p.shore === g).forEach(([id, p]) => {
            const o = document.createElement('option'); o.value = id; o.textContent = p.short; og.appendChild(o);
        });
        sel.appendChild(og);
    }));
    [from, to].forEach((sel, i) => {
        const o = document.createElement('option'); o.value = 'ALL'; o.textContent = i === 0 ? 'All origins' : 'All destinations';
        sel.insertBefore(o, sel.firstChild);
        sel.addEventListener('change', () => {
            syncODSelectors(sel.id === 'routeFrom' ? 'from' : 'to');
            if (droneOn) addLog(`Traffic now limited to: ${odLabel()} (applies to new departures)`, 'inf');
        });
    });
    from.value = 'ALL'; to.value = 'ALL';
})();
function syncODSelectors(changed) {
    const from = document.getElementById('routeFrom'), to = document.getElementById('routeTo');
    [...from.options, ...to.options].forEach(o => o.disabled = false);
    if (changed === 'from' && from.value !== 'ALL') {
        [...to.options].forEach(o => { if (o.value !== 'ALL') o.disabled = PIERS[o.value].shore === PIERS[from.value].shore; });
        if (to.value !== 'ALL' && !isCrossHarbourOD(from.value, to.value)) to.value = 'ALL';
    } else if (changed === 'to' && to.value !== 'ALL') {
        [...from.options].forEach(o => { if (o.value !== 'ALL') o.disabled = PIERS[o.value].shore === PIERS[to.value].shore; });
        if (from.value !== 'ALL' && !isCrossHarbourOD(from.value, to.value)) from.value = 'ALL';
    } else if (from.value !== 'ALL') {
        [...to.options].forEach(o => { if (o.value !== 'ALL') o.disabled = PIERS[o.value].shore === PIERS[from.value].shore; });
    } else if (to.value !== 'ALL') {
        [...from.options].forEach(o => { if (o.value !== 'ALL') o.disabled = PIERS[o.value].shore === PIERS[to.value].shore; });
    }
}
// Origin / destination filter shared by the traffic simulation and the route planner
function odSelection() { return [document.getElementById('routeFrom').value, document.getElementById('routeTo').value]; }
function odLabel() {
    const [f, t] = odSelection();
    if (f === 'ALL' && t === 'ALL') return `All ${OD_COUNT} cross-harbour OD pairs`;
    return `${f === 'ALL' ? 'Opposite-shore origins' : PIERS[f].short} → ${t === 'ALL' ? 'Opposite-shore destinations' : PIERS[t].short}`;
}
function odCandidates() {
    const [f, t] = odSelection();
    return odRoutes.filter(od => (f === 'ALL' || od.from === f) && (t === 'ALL' || od.to === t));
}

// Planned timeline of a flight (used by the strategic layer)
const slotHalf = vg => MIN_SEPARATION / Math.max(vg, 3) + 1;
// How departures share the pier's single pad with arrivals:
//  'vertical' — the climb column (take-off → top of climb + 10 s) may not overlap another UAV's landing descent at that pier
//  'climb'    — the climb may not overlap any booked pad window (approach + descent + unloading) at that pier
//  'full'     — as 'climb', but held until the departing UAV reaches its access fix
//  'none'     — departures ignored (thesis draft v1)
let DEP_PAD_MODE = 'vertical';
function timeline(plan, tDep) {
    let t = tDep + plan.tClimb;
    const nodes = [], segs = [];
    plan.legs.forEach((l, i) => {
        const last = i === plan.legs.length - 1;
        const v = last ? l.vg * APPROACH_F : l.vg;
        if (i > 0 && isJunction(l.from)) nodes.push({ n: l.from, t, h: slotHalf(Math.min(v, plan.legs[i - 1].vg)) });
        const dur = l.d / v;
        const lvl = levelOfTrack(WP[l.from], WP[l.to]);
        segs.push({ t0: t, t1: t + dur, a: toXY(WP[l.from]), b: toXY(WP[l.to]), lvl, z0: LEVEL_ALT[lvl], z1: LEVEL_ALT[lvl] });
        t += dur;
    });
    const tFix = segs[segs.length - 1].t0;   // arrival at the access fix = start of final approach
    // the origin pad is also booked for the departure: from take-off until the UAV reaches its access fix
    return { nodes, segs, c0: segs[0].t0, c1: t, padArr: tFix, tPier: t, padFree: t + plan.tDesc + UNLOAD_S,
             origin: DEP_PAD_MODE === 'none' ? null : plan.path[0], dep0: tDep, dep1: DEP_PAD_MODE === 'full' ? segs[0].t1 : tDep + plan.tClimb + 10,
             desc0: t - 10, desc1: t + plan.tDesc };
}
function posAt(tl, t) {
    const s = tl.segs.find(g => t >= g.t0 && t <= g.t1) || tl.segs[tl.segs.length - 1];
    const q = clamp((t - s.t0) / Math.max(1e-6, s.t1 - s.t0), 0, 1);
    return { x: s.a[0] + (s.b[0] - s.a[0]) * q, y: s.a[1] + (s.b[1] - s.a[1]) * q,
             z: (s.z0 ?? LEVEL_ALT[s.lvl]) + ((s.z1 ?? LEVEL_ALT[s.lvl]) - (s.z0 ?? LEVEL_ALT[s.lvl])) * q, lvl: s.lvl };
}
const PROBE_BUFFER = 100;   // m — strategic buffer (> 80 m tactical minimum)
function trajConflict(A, B) {
    const t0 = Math.max(A.c0, B.c0), t1 = Math.min(A.c1, B.c1);
    for (let t = t0; t <= t1; t += 1) {
        const a = posAt(A, t), b = posAt(B, t);
        if (Math.abs(a.z - b.z) < VERTICAL_SEPARATION && Math.hypot(a.x - b.x, a.y - b.y) < PROBE_BUFFER) return true;
    }
    return false;
}
function trajectoryHitsVerticalGate(tl, gate) {
    const t0 = Math.max(tl.c0, gate.t0), t1 = Math.min(tl.c1, gate.t1);
    if (t0 > t1) return false;
    for (let t = t0; t <= t1; t += 1) {
        const p = posAt(tl, t);
        if (Math.hypot(p.x - gate.x, p.y - gate.y) < VERTICAL_GATE_RADIUS) return true;
    }
    return false;
}
function verticalClash(tl, dest, res, ignoreUid) {
    // departure climb vs landing descents at the origin; this landing descent vs climbs at the destination
    const V = res.vert || {};
    const d = tl.origin && (V[tl.origin] || []).find(r => r.uid !== ignoreUid && r.kind === 'desc' && tl.dep0 < r.t1 && r.t0 < tl.dep1);
    if (d) return { r: d, at: tl.origin, mine: 'take-off' };
    const a = tl.desc0 !== undefined && (V[dest] || []).find(r => r.uid !== ignoreUid && r.kind === 'climb' && tl.desc0 < r.t1 && r.t0 < tl.desc1);
    if (a) return { r: a, at: dest, mine: 'landing' };
    return null;
}
function padClash(tl, res, ignoreUid) {
    if (DEP_PAD_MODE === 'none' || DEP_PAD_MODE === 'vertical' || !tl.origin) return null;
    return (res.pads[tl.origin] || []).find(r => r.uid !== ignoreUid && tl.dep0 < r.t1 && r.t0 < tl.dep1) || null;
}
function hasConflict(tl, dest, res, ignoreUid = null) {
    for (const x of tl.nodes) if ((res.nodes[x.n] || []).some(r => r.uid !== ignoreUid && Math.abs(r.t - x.t) < Math.max(r.h, x.h))) return true;
    if ((res.pads[dest] || []).some(r => r.uid !== ignoreUid && tl.padArr < r.t1 && r.t0 < tl.padFree)) return true;
    if (padClash(tl, res, ignoreUid)) return true;
    if (DEP_PAD_MODE === 'vertical' && verticalClash(tl, dest, res, ignoreUid)) return true;
    if ((res.trajs || []).some(r => r.uid !== ignoreUid && r.c1 > tl.c0 && r.c0 < tl.c1 && trajConflict(r, tl))) return true;
    return (res.verticals || []).some(g => g.uid !== ignoreUid && trajectoryHitsVerticalGate(tl, g));
}
function reserve(tl, dest, uid, res) {
    tl.nodes.forEach(x => (res.nodes[x.n] = res.nodes[x.n] || []).push({ t: x.t, h: x.h, uid }));
    (res.pads[dest] = res.pads[dest] || []).push({ t0: tl.padArr, t1: tl.padFree, uid });
    if (tl.origin && DEP_PAD_MODE !== 'vertical') (res.pads[tl.origin] = res.pads[tl.origin] || []).push({ t0: tl.dep0, t1: tl.dep1, uid, dep: true });
    if (DEP_PAD_MODE === 'vertical' && tl.origin) {
        res.vert = res.vert || {};
        (res.vert[tl.origin] = res.vert[tl.origin] || []).push({ t0: tl.dep0, t1: tl.dep1, uid, kind: 'climb' });
        (res.vert[dest] = res.vert[dest] || []).push({ t0: tl.desc0, t1: tl.desc1, uid, kind: 'desc' });
    }
    tl.uid = uid; (res.trajs = res.trajs || []).push(tl);
}
// Which booking blocks a candidate timeline (used to explain ground delays)
function conflictReason(tl, dest, res, ignoreUid = null) {
    for (const x of tl.nodes) {
        const r = (res.nodes[x.n] || []).find(r => r.uid !== ignoreUid && Math.abs(r.t - x.t) < Math.max(r.h, x.h));
        if (r) return { kind: 'junction', text: `junction ${x.n} already booked by ${r.uid}` };
    }
    const p = (res.pads[dest] || []).find(r => r.uid !== ignoreUid && tl.padArr < r.t1 && r.t0 < tl.padFree);
    if (p) return { kind: 'pad', text: `landing pad at ${PIERS[dest] ? PIERS[dest].short : dest} booked by ${p.uid}` };
    const o = padClash(tl, res, ignoreUid);
    if (o) return { kind: 'pad', text: `own pad at ${PIERS[tl.origin] ? PIERS[tl.origin].short : tl.origin} in use by ${o.uid} (${o.dep ? 'departing' : 'arriving'})` };
    const v = DEP_PAD_MODE === 'vertical' && verticalClash(tl, dest, res, ignoreUid);
    if (v) return { kind: 'pad', text: v.mine === 'take-off' ? `${v.r.uid} is landing at ${PIERS[v.at].short} — take-off waits for the descent` : `${v.r.uid} is taking off from ${PIERS[v.at].short} during this landing` };
    const t = (res.trajs || []).find(r => r.uid !== ignoreUid && r.c1 > tl.c0 && r.c0 < tl.c1 && trajConflict(r, tl));
    if (t) return { kind: 'trajectory', text: `4D trajectory would pass within 100 m / 15 m of ${t.uid}` };
    const g = (res.verticals || []).find(g => g.uid !== ignoreUid && trajectoryHitsVerticalGate(tl, g));
    if (g) return { kind: 'gate', text: `crosses the protected descent cylinder of ${g.uid}` };
    return null;
}
function scheduleDeparture(plan, tReq, res, maxDelay = 900) {
    const dest = plan.path[plan.path.length - 1];
    let first = null, last = null;
    for (let dly = 0; dly <= maxDelay; dly += 1) {
        const tl = timeline(plan, tReq + dly);
        const why = conflictReason(tl, dest, res);
        if (!why) return { delay: dly, tl, why: last, first };
        if (!first) first = why;
        last = why;
    }
    return null;
}
function purgeRes(res, tNow) {
    Object.keys(res.nodes).forEach(n => res.nodes[n] = res.nodes[n].filter(r => r.t > tNow - 30));
    Object.keys(res.pads).forEach(n => res.pads[n] = res.pads[n].filter(r => r.t1 > tNow - 5));
    res.trajs = (res.trajs || []).filter(r => r.c1 > tNow);
    res.verticals = (res.verticals || []).filter(r => r.t1 > tNow);
    Object.keys(res.vert || {}).forEach(n => res.vert[n] = res.vert[n].filter(r => r.t1 > tNow - 5));
}

function currentEdgeCounts() {
    const c = {};
    activeDrones.forEach(d => {
        if ((d.state !== 'flying' && d.state !== 'approaching') || d.emg) return;
        const i = segIndex(d);
        const k = dirKey(d.pathIds[i], d.pathIds[i + 1]);
        c[k] = (c[k] || 0) + 1;
    });
    return c;
}
function segIndex(d) {
    let i = 0;
    while (i < d.cum.length - 2 && d.cum[i + 1] <= d.s) i++;
    return i;
}
function dronePos(d) {
    const i = segIndex(d);
    const len = d.cum[i + 1] - d.cum[i];
    const f = len > 0 ? clamp((d.s - d.cum[i]) / len, 0, 1) : 1;
    const a = d.coords[i], b = d.coords[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}
function droneLevel(d) {
    if (d.emg && d.state !== 'emergency_gate' && d.state !== 'emergency_descent') return LEVEL_E;
    if (d.emg?.originalLevel) return d.emg.originalLevel;
    const i = segIndex(d); return levelOfTrack(d.coords[i], d.coords[i + 1]);
}
function droneAltitude(d) {
    if (d.state === 'ground' || d.state === 'landed') return 0;
    if (d.state === 'climb') return LEVEL_ALT[droneLevel(d)] * clamp(d.timer / Math.max(d.plan.tClimb, 1), 0, 1);
    if (d.state === 'emergency_gate') return d.emg.originalAlt;
    if (d.state === 'emergency_descent') {
        const q = clamp(d.timer / Math.max(d.emg.transitionS, 1), 0, 1);
        return d.emg.originalAlt + (LEVEL_ALT[LEVEL_E] - d.emg.originalAlt) * q;
    }
    if (d.state === 'landing') {
        const z0 = d.emg ? LEVEL_ALT[LEVEL_E] : LEVEL_ALT[droneLevel(d)];
        return z0 * (1 - clamp(d.timer / Math.max(d.plan.tDesc, 1), 0, 1));
    }
    return d.emg ? LEVEL_ALT[LEVEL_E] : LEVEL_ALT[droneLevel(d)];
}
const ICONS = {
    ground:  '<div class="drone-dot" style="animation:none;background:#64748b;box-shadow:none"></div>',
    climb:   '<div class="drone-dot" style="background:#e2e8f0"></div>',
    L1:      '<div class="drone-dot"></div>',
    L2:      '<div class="drone-dot purple"></div>',
    slow:    '<div class="drone-dot amber"></div>',
    holding: '<div class="drone-dot pink"></div>',
    landing: '<div class="drone-dot" style="animation:none;opacity:0.8;border:2px solid #fff"></div>',
    landed:  '<div class="drone-dot" style="animation:none;background:#94a3b8;box-shadow:none"></div>',
    emg:     '<div class="drone-dot" style="background:#ef4444;box-shadow:0 0 10px #ef4444,0 0 22px rgba(239,68,68,0.5)"></div>',
    transition: '<div class="drone-dot amber" style="border:2px solid #ef4444;box-shadow:0 0 12px #ef4444,0 0 26px rgba(251,191,36,0.6)"></div>',
};
function setIcon(d, key) {
    if (d.iconKey === key) return;
    d.iconKey = key;
    d.marker.setIcon(L.divIcon({ className: 'drone-icon', html: ICONS[key], iconSize: [12, 12], iconAnchor: [6, 6] }));
}

function spawnDrone() {
    const cands = odCandidates();
    if (!cands.length) { addLog('No valid cross-harbour OD pair for the current filter', 'err'); return false; }
    const od = cands[Math.floor(Math.random() * cands.length)];
    const plan = aStar(od.from, od.to, currentEdgeCounts());
    if (!plan || !plan.feasibleBattery) { addLog(`${od.name}: no feasible route (wind / capacity / battery)`, 'err'); return false; }
    const id = `UAV-${String(++droneIdCounter).padStart(3, '0')}`;
    let tDep = simTime, delay = 0, delayWhy = null;
    if (strategicOn) {
        purgeRes(RES, simTime);
        const s = scheduleDeparture(plan, simTime, RES);
        if (!s) { addLog(`${id} ${od.name}: no slot within 15 min`, 'err'); return false; }
        delay = s.delay; tDep = simTime + delay; reserve(s.tl, od.to, id, RES);
        delayWhy = s.why;
    }
    stats.delays.push(delay);
    const coords = plan.path.map(n => WP[n]);
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + distMetres(coords[i - 1], coords[i]));
    const marker = L.marker(coords[0]).bindPopup('');
    const label = L.marker(coords[0], { interactive: false, icon: L.divIcon({ className: 'drone-icon',
        html: `<div class="map-label lbl-uav" style="color:#e2e8f0">${id}</div>`, iconSize: [50, 12], iconAnchor: [25, -6] }) });
    droneLayer.addLayer(marker); droneLayer.addLayer(label);
    const d = { id, od: od.name, dest: od.to, plan, pathIds: plan.path, coords, cum, s: 0, tDep, delay, delayWhy, tReq: simTime,
                state: 'ground', timer: 0, speedFactor: 1, conflictWith: null, marker, label, iconKey: null, popupTick: 0,
                energyWh: 0, health: { motor: 1, c2: 1, c2LossS: 0, detectedGust: 0 } };
    setIcon(d, 'ground');
    activeDrones.push(d);
    addLog(`${id} ${od.name}: ${(plan.tTotal / 60).toFixed(1)} min, ${plan.E_Wh.toFixed(0)} Wh` +
           (strategicOn ? `, slot delay ${delay} s${delayWhy ? ` (${delayWhy.text})` : ''}` : ''), 'inf');
    return true;
}

function updateDrones(ts) {
    if (lastFrame === null) lastFrame = ts;
    const dt = Math.min(0.1, (ts - lastFrame) / 1000) * SIM_SPEED;
    lastFrame = ts; simTime += dt;

    // Tactical layer: true 3D separation. Horizontal proximity alone is not a conflict;
    // both the horizontal and vertical buffers must be infringed.
    const now = new Set();
    activeDrones.forEach(a => { a.speedFactor = 1; a.conflictWith = null; });
    const airborneStates = new Set(['flying', 'approaching', 'holding', 'emergency_gate', 'emergency_descent', 'landing']);
    const airborne = activeDrones.filter(d => airborneStates.has(d.state));
    airborne.forEach(a => {
        const pa = (a.state === 'landing') ? a.coords[a.coords.length - 1] : dronePos(a), za = droneAltitude(a);
        const i = segIndex(a), canYield = a.state === 'flying' || a.state === 'approaching';
        const hdg = canYield ? trackDeg(a.coords[i], a.coords[i + 1]) * Math.PI / 180 : 0;
        airborne.forEach(b => {
            if (a === b) return;
            const pb = (b.state === 'landing') ? b.coords[b.coords.length - 1] : dronePos(b);
            const dist = distMetres(pa, pb), dz = Math.abs(za - droneAltitude(b));
            if (dist >= WARN_SEPARATION || dz >= VERTICAL_SEPARATION) return;
            if (dist < MIN_SEPARATION) {
                const key = a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id;
                const firstSeen = !activeConflicts.has(key) && !now.has(key);
                now.add(key);
                if (firstSeen) { stats.los++; stats.losLog.push({ t: simTime, a: a.id, b: b.id, d: dist, dz, odA: a.od, odB: b.od, phA: uavPhase(a).phase, phB: uavPhase(b).phase }); }
            }
            if (!canYield) return;
            const dN = (pb[0] - pa[0]) * 111320, dE = (pb[1] - pa[1]) * 111320 * COS0;
            if (dN * Math.cos(hdg) + dE * Math.sin(hdg) <= 0) return;
            a.speedFactor = Math.min(a.speedFactor, dist < MIN_SEPARATION ? 0.15 : 0.3 + 0.7 * (dist - MIN_SEPARATION) / (WARN_SEPARATION - MIN_SEPARATION));
            a.conflictWith = b.id;
        });
    });
    activeConflicts.clear(); now.forEach(k => activeConflicts.add(k));

    // Threshold monitor. Manual scenarios alter these measured variables; the same
    // rules can also react to battery depletion or live wind during the simulation.
    activeDrones.filter(d => d.state === 'flying' && !d.emg).forEach(d => evaluateEmergencyTrigger(d));

    for (let k = activeDrones.length - 1; k >= 0; k--) {
        const d = activeDrones[k];
        const dest = d.coords[d.coords.length - 1];
        const pad = padStatus[d.dest];
        switch (d.state) {
            case 'ground':
                if (simTime >= d.tDep) { d.state = 'climb'; d.timer = 0; setIcon(d, 'climb'); }
                break;
            case 'climb':
                d.timer += dt;
                d.energyWh += powerModel(droneAltitude(d)).P_climb * dt / 3600;
                if (d.timer >= d.plan.tClimb) d.state = 'flying';
                break;
            case 'emergency_gate':
                d.timer += dt;
                d.energyWh += powerModel(d.emg.originalAlt).P_hover * dt / 3600;
                setIcon(d, 'transition');
                if (d.timer >= d.emg.gateDelay) { d.state = 'emergency_descent'; d.timer = 0; }
                break;
            case 'emergency_descent':
                d.timer += dt;
                d.energyWh += powerModel(droneAltitude(d)).P_hover * dt / 3600;
                setIcon(d, 'transition');
                if (d.timer >= d.emg.transitionS) {
                    d.state = 'flying'; d.timer = 0;
                    addLog(`${d.id} entered layer E at 60 m; emergency 4D reservation active`, 'err');
                }
                break;
            case 'flying':
            case 'approaching': {
                const i = segIndex(d);
                const last = i === d.coords.length - 2;
                // Arriving at the access fix: cleared for final approach only if the pad is free
                if (last && d.state === 'flying') {
                    if ((pad.occupiedBy && pad.occupiedBy !== d.id) || (pad.priority && pad.priority !== d.id)) {
                        d.state = 'holding'; d.timer = 0; stats.holds++; setIcon(d, 'holding');
                        addLog(`${d.id} holding at ${d.pathIds[d.pathIds.length - 2]} (pad ${PIERS[d.dest].short} busy)`, 'inf');
                        break;
                    }
                    pad.occupiedBy = d.id; d.state = 'approaching';
                }
                const gs = groundSpeed(d.coords[i], d.coords[i + 1], d.emg ? LEVEL_E : undefined);
                d.s += (gs.feasible ? gs.vg : 3) * (last ? APPROACH_F : 1) * d.speedFactor * dt;
                d.energyWh += powerModel(droneAltitude(d)).P_cruise * dt / 3600;
                d.health.detectedGust = Math.max(d.health.detectedGust || 0, gs.gust || 0);
                setIcon(d, d.emg ? 'emg' : d.speedFactor < 0.5 ? 'slow' : droneLevel(d) === 1 ? 'L1' : 'L2');
                if (d.s >= d.cum[d.cum.length - 1]) {
                    d.s = d.cum[d.cum.length - 1];
                    d.state = 'landing'; d.timer = 0; setIcon(d, 'landing');
                }
                break;
            }
            case 'holding': {
                d.timer += dt; stats.holdTime += dt;
                d.energyWh += powerModel(droneAltitude(d)).P_hover * dt / 3600;
                const fix = d.coords[d.coords.length - 2];
                const ang = simTime * (UAV.v_air / R_HOLD) * 0.5;
                const p = [fix[0] + Math.sin(ang) * R_HOLD / 110540, fix[1] + Math.cos(ang) * R_HOLD / (111320 * COS0)];
                d.marker.setLatLng(p); d.label.setLatLng(p);
                if (!pad.occupiedBy && (!pad.priority || pad.priority === d.id)) { pad.occupiedBy = d.id; d.state = 'approaching'; d.s = d.cum[d.cum.length - 2]; setIcon(d, d.emg ? 'emg' : 'L1'); }
                continue;
            }
            case 'landing':
                d.timer += dt;
                d.energyWh += powerModel(droneAltitude(d)).P_hover * dt / 3600;
                if (d.timer >= d.plan.tDesc) {
                    d.state = 'landed'; d.timer = 0; setIcon(d, 'landed');
                    if (d.emg) {
                        const tr = simTime - d.emg.t0; stats.emgTimes.push(tr);
                        if (pad.priority === d.id) pad.priority = null;
                        if (d.emgLine) { droneLayer.removeLayer(d.emgLine); d.emgLine = null; }
                        addLog(`${d.id} emergency landing at ${PIERS[d.dest].short} — ${(tr / 60).toFixed(1)} min after the event`, 'ok');
                    }
                }
                break;
            case 'landed':
                d.timer += dt;
                if (d.timer >= UNLOAD_S) {
                    pad.occupiedBy = null;
                    droneLayer.removeLayer(d.marker); droneLayer.removeLayer(d.label);
                    activeDrones.splice(k, 1); stats.completed++;
                    stats.done.push({ id: d.id, od: d.od, dest: d.dest, trip: simTime - (d.tReq ?? d.tDep), delay: d.delay, emg: !!d.emg, wh: d.energyWh });
                    continue;
                }
                break;
        }
        const pos = (d.state === 'landing' || d.state === 'landed') ? dest : dronePos(d);
        d.marker.setLatLng(pos); d.label.setLatLng(pos);
        if (++d.popupTick % 20 === 0 && d.marker.isPopupOpen()) {
            d.marker.setPopupContent(`<b>${d.id}</b> · ${d.od}<br>State: ${d.state}<br>` +
                (d.emg ? `<span style="color:#f87171">${d.emg.type} — diverting to ${PIERS[d.dest].short}</span><br>` : '') +
                `Altitude: ${droneAltitude(d).toFixed(0)} m · SOC ${Math.max(0, 100 * (1 - d.energyWh / UAV.battery_Wh)).toFixed(0)}%<br>` +
                (d.state === 'flying' || d.state === 'approaching' ? `Level: ${LEVEL_NAME[droneLevel(d)]} · speed ${(d.speedFactor * 100).toFixed(0)}%<br>` : '') +
                (d.delay ? `Strategic ground delay: ${d.delay} s<br>` : '') + `Path: ${d.pathIds.join(' → ')}`);
        }
    }
    updateTrafficStats();
    trafficAnimId = requestAnimationFrame(updateDrones);
}
const hudTraffic = document.getElementById('hudTraffic');
function updateTrafficStats() {
    const s = { ground: 0, climb: 0, flying: 0, approaching: 0, holding: 0, emergency_gate: 0, emergency_descent: 0, landing: 0, landed: 0 };
    activeDrones.forEach(d => s[d.state]++);
    hudTraffic.style.display = 'block';
    const F = (key, html) => `<span class="hf" ${BOARD_KEYS.includes(key) ? `data-k="${key}"` : ''} title="${HUD_TIPS[key]}${BOARD_KEYS.includes(key) ? ' — click to list these UAVs' : ''}">${html}</span>`, SEP = '<span class="sep">|</span>';
    activeDrones.forEach(updateUavLabel);
    const hudHTML =
        F('time', `T+${(simTime / 60).toFixed(1)} min ×${SIM_SPEED}`) + SEP +
        F('waiting', `wait <b>${s.ground}</b>`) + SEP +
        F('airborne', `air <b>${s.climb + s.flying + s.approaching + s.emergency_gate + s.emergency_descent}</b>`) + SEP +
        F('holding', `hold <b>${s.holding}</b>`) + SEP + F('delivered', `done <b>${stats.completed}</b>`) + SEP +
        F('los', `LoS <b>${stats.los}</b>`) + SEP + F('delay', `delay <b>${mean(stats.delays).toFixed(0)}</b> s`) +
        (stats.emg ? SEP + F('emg', `EMG <b>${stats.emg}</b>`) : '') +
        '<span class="hud-more" title="Open the flight board">?</span>';
    if (hudHTML !== hudTraffic.innerHTML) hudTraffic.innerHTML = hudHTML;   // rebuild only when a value changes
    if (document.getElementById('card-explain-traffic') && performance.now() - (updateTrafficStats.lastExplain || 0) > 1000) {
        updateTrafficStats.lastExplain = performance.now(); showTrafficExplain();
    }
    if (document.getElementById('card-fleet') && performance.now() - (updateTrafficStats.lastFleet || 0) > 1000) {
        updateTrafficStats.lastFleet = performance.now(); showFleetLive();
    }
}
const batBar = pct => `<span class="bat"><i style="width:${Math.max(0, Math.min(100, pct)).toFixed(0)}%;background:${pct <= 25 ? '#ef4444' : pct <= 50 ? '#fbbf24' : '#4ade80'}"></i></span>${pct.toFixed(0)} %`;
function showFleetLive() {
    const soc = d => 100 * (1 - d.energyWh / UAV.battery_Wh);
    const air = activeDrones.filter(d => ['climb', 'flying', 'approaching', 'emergency_gate', 'emergency_descent'].includes(d.state));
    const usedActive = activeDrones.reduce((a, d) => a + d.energyWh, 0), usedDone = stats.done.reduce((a, r) => a + (r.wh || 0), 0);
    const low = activeDrones.filter(d => soc(d) <= 25).length;
    const pierRows = Object.entries(PIERS).map(([id, p]) => {
        const here = activeDrones.filter(d => d.state === 'ground' && d.pathIds[0] === id).map(d => d.id);
        const pad = activeDrones.filter(d => d.dest === id && ['landing', 'landed'].includes(d.state)).map(d => d.id);
        const inbound = activeDrones.filter(d => d.dest === id && ['climb', 'flying', 'approaching', 'holding', 'emergency_gate', 'emergency_descent'].includes(d.state)).map(d => d.id);
        const occ = padStatus[id].occupiedBy || padStatus[id].priority;
        const sh = a => a.map(x => x.replace('UAV-', '')).join(', ');
        return `<tr><td>${p.short}</td><td>${sh(here) || '—'}</td><td>${sh(pad) || '—'}</td><td>${sh(inbound) || '—'}</td><td>${occ ? occ.replace('UAV-', '') : 'free'}</td></tr>`;
    }).join('');
    const uavRows = activeDrones.slice().sort((a, b) => soc(a) - soc(b)).map(d => { const ph = uavPhase(d);
        return `<tr class="row" onclick="focusUAV('${d.id}')" title="${ph.phase} · ${d.energyWh.toFixed(0)} Wh used"><td>${d.id} <span class="ph" style="background:${PHASE_COL[ph.tag]}">${ph.tag === 'wait' ? 'wait' : ph.tag}</span></td><td style="white-space:nowrap">${d.pathIds[0].slice(3)} → ${d.dest.slice(3)}</td><td style="white-space:nowrap">${batBar(soc(d))}</td></tr>`; }).join('');
    showInfo('Fleet status (live)', `
        <div class="kpi"><span>UAVs in the system</span><b>${activeDrones.length} &nbsp;<span class="muted">${air.length} airborne</span></b>
        <span>Delivered</span><b>${stats.completed}</b>
        <span>Energy used so far</span><b>${((usedActive + usedDone) / 1000).toFixed(2)} kWh</b>
        <span>Mean per delivery</span><b>${stats.done.length ? (usedDone / stats.done.length).toFixed(0) + ' Wh' : '—'}</b>
        <span>Battery ≤ 25 %</span><b style="color:${low ? '#f87171' : '#e2e8f0'}">${low}</b></div>
        <table class="tbl board"><tr><th>Pier</th><th>Waiting</th><th>On pad</th><th>Inbound</th><th>Pad used by</th></tr>${pierRows}</table>
        <table class="tbl board"><tr><th>UAV · phase</th><th>Route</th><th>Batt.</th></tr>${uavRows || '<tr><td colspan="3">No UAV in the system</td></tr>'}</table>`,
        CARD_WIDTH, 'fleet', `Battery = 100 % at take-off minus the energy used so far (950 Wh pack). Below 25 % a UAV triggers the low-battery emergency. Waiting = on the pier before take-off; On pad = landing or unloading; Inbound = flying to this pier. Click a UAV row to highlight it on the map.<br><span class="muted">In the live twin each order is flown by a newly dispatched UAV; the fixed-fleet case (UAVs that stay, recharge and are repositioned) is in the left panel › Fleet.</span>`);
}
function resetTraffic() {
    activeDrones.length = 0; droneLayer.clearLayers();
    Object.values(padStatus).forEach(p => { p.occupiedBy = null; p.priority = null; });
    RES.nodes = {}; RES.pads = {}; RES.trajs = []; RES.verticals = []; RES.vert = {};
    Object.assign(stats, { completed: 0, los: 0, holds: 0, holdTime: 0, delays: [], emg: 0, emgTimes: [], done: [], losLog: [] });
    boardFocus = null; if (typeof boardLayer !== 'undefined') boardLayer.clearLayers();
    activeConflicts.clear(); simTime = 0; lastFrame = null; droneIdCounter = 0;
}
function toggleDrones() {
    droneOn = !droneOn; toggleBtn('btnDrone', droneOn);
    document.getElementById('btnDrone').textContent = droneOn ? '■ Stop traffic' : '▶ Start traffic';
    if (droneOn) {
        resetTraffic();
        for (let i = 0; i < 3; i++) spawnDrone();
        // dispatcher: at most 3 UAVs waiting on the ground for a slot, 14 in the system
        trafficInterval = setInterval(() => { if (activeDrones.length < 14 && activeDrones.filter(d => d.state === 'ground').length < 3) spawnDrone(); }, 2500);
        trafficAnimId = requestAnimationFrame(updateDrones);
        droneLayer.addTo(map);
        showFleetLive();
        addLog('Traffic started — strategic 4D deconfliction and tactical separation active', 'ok');
    } else {
        clearInterval(trafficInterval); trafficInterval = null;
        cancelAnimationFrame(trafficAnimId); trafficAnimId = null;
        resetTraffic(); map.removeLayer(droneLayer); hudTraffic.style.display = 'none'; closeCard('fleet');
        addLog('Traffic simulation stopped', 'inf');
    }
}


// ---------- 9b. Emergency layer (E · 60 m, reserved) ----------
// The E layer is not a teleport. A protected vertical cylinder is booked first, then the
// E-layer trajectory, junction slots and landing window are committed as one transaction.
const LEVEL_E_DESC = LEVEL_ALT[LEVEL_E] / UAV.v_descent;      // 30 s from E layer to the pad
const EMG_TYPE = {
    battery: 'Battery SOC critical', motor: 'Motor degradation',
    c2: 'C2 link loss', gust: 'Severe wind / gust'
};
function releaseReservations(uid, res = RES) {
    Object.keys(res.nodes).forEach(n => res.nodes[n] = res.nodes[n].filter(r => r.uid !== uid));
    Object.keys(res.pads).forEach(n => res.pads[n] = res.pads[n].filter(r => r.uid !== uid));
    res.trajs = (res.trajs || []).filter(r => r.uid !== uid);
    res.verticals = (res.verticals || []).filter(r => r.uid !== uid);
    Object.keys(res.vert || {}).forEach(n => res.vert[n] = res.vert[n].filter(r => r.uid !== uid));
}
function verticalGateConflict(pos, t0, t1, res, ignoreUid = null) {
    const p = toXY(pos);
    if ((res.verticals || []).some(r => r.uid !== ignoreUid && t0 < r.t1 && r.t0 < t1 && Math.hypot(p[0] - r.x, p[1] - r.y) < 2 * VERTICAL_GATE_RADIUS)) return true;
    // A vertical transition conflicts with any booked horizontal trajectory that enters the cylinder.
    return (res.trajs || []).some(tl => {
        if (tl.uid === ignoreUid || tl.c1 < t0 || tl.c0 > t1) return false;
        for (let t = Math.max(t0, tl.c0); t <= Math.min(t1, tl.c1); t += 1) {
            const q = posAt(tl, t);
            if (Math.hypot(p[0] - q.x, p[1] - q.y) < VERTICAL_GATE_RADIUS) return true;
        }
        return false;
    });
}
function emergencyTimeline(coords, pathIds, tEntry) {
    let t = tEntry; const nodes = [], segs = [];
    for (let i = 0; i < coords.length - 1; i++) {
        const last = i === coords.length - 2, gs = groundSpeed(coords[i], coords[i + 1], LEVEL_E);
        const v = Math.max(3, gs.vg) * (last ? APPROACH_F : 1), dur = distMetres(coords[i], coords[i + 1]) / v;
        if (i > 0 && isJunction(pathIds[i])) nodes.push({ n: pathIds[i], t, h: slotHalf(v) });
        segs.push({ t0: t, t1: t + dur, a: toXY(coords[i]), b: toXY(coords[i + 1]), lvl: LEVEL_E,
                    z0: LEVEL_ALT[LEVEL_E], z1: LEVEL_ALT[LEVEL_E] });
        t += dur;
    }
    const tFix = segs[segs.length - 1].t0;
    return { nodes, segs, c0: tEntry, c1: t, padArr: tFix, tPier: t, padFree: t + LEVEL_E_DESC + UNLOAD_S };
}
function routeLinkPenalty(path) {
    // Coverage proxy: distance from each route node to the nearest pier-based access point.
    return Math.max(...path.map(n => Math.min(...Object.values(PIERS).map(p => distMetres(WP[n], p.pos))))) / 1000;
}
function emergencyOptions(d) {
    const i = segIndex(d), pos = dronePos(d), nextNode = d.pathIds[i + 1];
    const originalAlt = droneAltitude(d), transitionS = Math.max(1, (originalAlt - LEVEL_ALT[LEVEL_E]) / UAV.v_descent);
    const pm = powerModel(LEVEL_ALT[LEVEL_E]), options = [];
    const why = d.emgWhy = { route: 0, energy: 0, slot: 0, pad: 0 };
    Object.keys(PIERS).forEach(pid => {
        const plan = aStar(nextNode, pid, {}, (u, v) => edgeCost(u, v, {}, LEVEL_E), LEVEL_E);
        if (!plan) { why.route++; return; }
        const pathIds = ['EVENT', ...plan.path], coords = [pos, ...plan.path.map(n => WP[n])];
        const first = distMetres(pos, WP[nextNode]) / Math.max(3, groundSpeed(pos, WP[nextNode], LEVEL_E).vg);
        const flightS = first + plan.tFlight + (plan.legs.at(-1)?.tFlight || 0) * (1 / APPROACH_F - 1);
        const energyNeed = (pm.P_hover * (transitionS + LEVEL_E_DESC) + pm.P_cruise * flightS) / 3600;
        const available = UAV.battery_Wh - d.energyWh - UAV.battery_Wh * EMG_RESERVE;
        if (energyNeed > available) { why.energy++; return; }
        let gateDelay = null, tl = null;
        for (let wait = 0; wait <= EMG_ENTRY_MAX_DELAY; wait++) {
            const t0 = simTime + wait, tEntry = t0 + transitionS;
            const candidate = emergencyTimeline(coords, pathIds, tEntry);
            if (!verticalGateConflict(pos, t0, tEntry, RES, d.id) && !hasConflict(candidate, pid, RES, d.id)) {
                gateDelay = wait; tl = candidate; break;
            }
        }
        if (gateDelay === null) { why.slot++; return; }
        const padBusy = !!padStatus[pid].occupiedBy || (!!padStatus[pid].priority && padStatus[pid].priority !== d.id);
        if (padBusy) { why.pad++; return; }
        const rfzPenalty = plan.rfzHit.length * 60;          // advisory regulatory exposure proxy [s]
        const linkPenalty = routeLinkPenalty(plan.path) * 12; // C2 coverage proxy [s]
        const eta = gateDelay + transitionS + flightS + LEVEL_E_DESC;
        options.push({ pid, plan, pathIds, coords, tl, gateDelay, transitionS, energyNeed, eta,
                       rfzPenalty, linkPenalty, score: eta + rfzPenalty + linkPenalty });
    });
    return options.sort((a, b) => a.score - b.score);
}
function evaluateEmergencyTrigger(d, force = false) {
    if (!d || d.emg || d.state !== 'flying') return false;
    if (!force && d.emgRetryAt && simTime < d.emgRetryAt) return false;
    const soc = 1 - d.energyWh / UAV.battery_Wh;
    let type = null;
    if (soc <= 0.25) type = EMG_TYPE.battery;
    else if (d.health.motor < 0.65) type = EMG_TYPE.motor;
    else if (d.health.c2LossS >= 10) type = EMG_TYPE.c2;
    else if (d.health.detectedGust > UAV.maxGust) type = EMG_TYPE.gust;
    if (!type && !force) return false;
    return activateEmergency(d, type || 'Operator-declared emergency');
}
function activateEmergency(d, type) {
    const options = emergencyOptions(d), best = options[0];
    if (!best) {
        d.emgRetryAt = simTime + EMG_RETRY_S;
        if (!d.emgFailLogged) {
            const w = d.emgWhy || {}, parts = [];
            if (w.pad) parts.push(`${w.pad} pad(s) occupied`); if (w.slot) parts.push(`${w.slot} without a free gate / 4D slot within ${EMG_ENTRY_MAX_DELAY} s`);
            if (w.energy) parts.push(`${w.energy} out of energy range`); if (w.route) parts.push(`${w.route} unreachable in layer E`);
            addLog(`${d.id} ${type}: no E-layer diversion yet (${parts.join(', ')}). Continuing on its planned route and retrying every ${EMG_RETRY_S} s.`, 'err');
            d.emgFailLogged = true;
        }
        return false;
    }
    const originalDest = d.dest, originalLevel = droneLevel(d), originalAlt = droneAltitude(d);
    // Atomic commit: release old bookings only after a complete replacement has been found.
    releaseReservations(d.id, RES);
    reserve(best.tl, best.pid, d.id, RES);
    const vp = toXY(best.coords[0]);
    RES.verticals.push({ x: vp[0], y: vp[1], t0: simTime + best.gateDelay,
                         t1: simTime + best.gateDelay + best.transitionS, uid: d.id });
    d.emg = { type, t0: simTime, from: originalDest, originalLevel, originalAlt,
              gateDelay: best.gateDelay, transitionS: best.transitionS, decision: best };
    d.dest = best.pid; d.pathIds = best.pathIds; d.coords = best.coords;
    d.cum = [0]; for (let k = 1; k < d.coords.length; k++) d.cum.push(d.cum[k - 1] + distMetres(d.coords[k - 1], d.coords[k]));
    d.s = 0; d.timer = 0; d.state = best.gateDelay > 0 ? 'emergency_gate' : 'emergency_descent';
    d.plan = { ...best.plan, tDesc: LEVEL_E_DESC };
    padStatus[best.pid].priority = d.id;
    stats.emg++; setIcon(d, 'transition');
    d.emgLine = L.polyline(d.coords, { color: '#ef4444', weight: 3, dashArray: '4 6', opacity: 0.9 }).addTo(droneLayer);
    const rows = options.slice(0, 5).map((o, j) => `<tr${j === 0 ? ' style="color:#fca5a5"' : ''}><td>${PIERS[o.pid].short}</td><td>${(o.eta / 60).toFixed(2)}</td><td>${o.gateDelay}</td><td>${o.energyNeed.toFixed(0)}</td><td>${o.rfzPenalty.toFixed(0)}</td><td>${o.score.toFixed(0)}</td></tr>`).join('');
    showInfo(`Emergency · ${d.id}`, `
        <div class="kpi"><span>Trigger</span><b>${type}</b><span>Diverts to</span><b>${PIERS[best.pid].short}</b>
        <span>Touchdown in</span><b>${(best.eta / 60).toFixed(1)} min</b><span>Gate wait</span><b>${best.gateDelay} s</b></div>
        <table class="tbl"><tr><th>Candidate pier</th><th>ETA min</th><th>Score</th></tr>${options.slice(0, 5).map((o, j) => `<tr${j === 0 ? ' style="color:#fca5a5"' : ''}><td>${PIERS[o.pid].short}</td><td>${(o.eta / 60).toFixed(2)}</td><td>${o.score.toFixed(0)}</td></tr>`).join('')}</table>`,
        CARD_WIDTH, 'emg-decision', `
        <b>Sequence:</b> ${LEVEL_NAME[originalLevel]} → vertical gate → E · 60 m → ${PIERS[best.pid].short}<br>
        <b>Protected descent:</b> wait ${best.gateDelay} s + descend ${best.transitionS.toFixed(0)} s inside a ${VERTICAL_GATE_RADIUS} m cylinder<br>
        <table class="tbl"><tr><th>Candidate</th><th>ETA min</th><th>Gate s</th><th>Energy Wh</th><th>RFZ penalty</th><th>Score</th></tr>${rows}</table>
        Score = touchdown ETA + RFZ exposure proxy + C2 coverage proxy, subject to wind, 10 % battery reserve, vertical-gate, 4D trajectory, node-slot and landing-window constraints. Definitions: Help › Emergency thresholds.`);
    addLog(`${d.id} ${type}: ${originalAlt.toFixed(0)}→60 m, E-route reserved to ${PIERS[best.pid].short}, ETA ${(best.eta / 60).toFixed(1)} min`, 'err');
    return true;
}
function triggerEmergency() {
    if (!droneOn) { addLog('Start the traffic simulation first', 'err'); return; }
    const cands = activeDrones.filter(d => d.state === 'flying' && !d.emg && segIndex(d) < d.coords.length - 2);
    if (!cands.length) { addLog('No cruising UAV available for an emergency', 'err'); return; }
    const scenario = document.getElementById('emgScenario').value;
    const apply = d => {
        if (scenario === 'battery') d.energyWh = Math.max(d.energyWh, UAV.battery_Wh * 0.76);
        if (scenario === 'motor') d.health.motor = 0.55;
        if (scenario === 'c2') { d.health.c2 = 0.1; d.health.c2LossS = 12; }
        if (scenario === 'gust') d.health.detectedGust = UAV.maxGust + 2;
    };
    // Try cruising UAVs in random order; the first one with a feasible diversion receives the event.
    const order = cands.map(d => [Math.random(), d]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    for (const d of order) {
        const saved = { e: d.energyWh, h: { ...d.health } };
        apply(d);
        if (emergencyOptions(d).length) { d.emgFailLogged = false; evaluateEmergencyTrigger(d, true); return; }
        d.energyWh = saved.e; d.health = saved.h;
    }
    addLog(`No cruising UAV can divert right now (all candidate pads busy or no free gate slot) — try again in a few seconds`, 'err');
}

// Static response-test helper (does not mutate the live reservation table).
function emergencyDivert(fromPos, nextNode, prevNode, legLen) {
    let best = null;
    Object.keys(PIERS).forEach(pid => {
        const plan = aStar(nextNode, pid, {}, (u, v) => edgeCost(u, v, {}, LEVEL_E), LEVEL_E);
        if (!plan) return;
        const gs = groundSpeed(fromPos, WP[nextNode], LEVEL_E);
        const t = legLen / Math.max(gs.vg, 3) + (plan.tFlight || 0) + LEVEL_E_DESC;
        if (!best || t < best.t) best = { pid, plan, t };
    });
    return best;
}

// Offline response test: an emergency at the midpoint of every cruise leg of all 24 directional cross-harbour OD routes
function emergencyResponseTest() {
    const rows = [];
    odRoutes.forEach(od => {
        const plan = aStar(od.from, od.to, {});
        if (!plan) return;
        plan.legs.forEach((l, i) => {
            if (i === 0 || i === plan.legs.length - 1) return;           // pier spurs excluded
            const mid = [(WP[l.from][0] + WP[l.to][0]) / 2, (WP[l.from][1] + WP[l.to][1]) / 2];
            const half = l.d / 2;
            const best = emergencyDivert(mid, l.to, l.from, half);
            if (!best) return;
            const rest = plan.legs.slice(i + 1);
            const tCont = half / l.vg + rest.reduce((a, r, k) => a + r.d / (k === rest.length - 1 ? r.vg * APPROACH_F : r.vg), 0) + plan.tDesc;
            const tE = best.t + (best.plan.legs ? best.plan.legs.at(-1).d / Math.max(best.plan.legs.at(-1).vg, 3) * (1 / APPROACH_F - 1) : 0);
            rows.push({ od: od.name, leg: `${l.from}→${l.to}`, tE, tCont, pier: best.pid, orig: od.to });
        });
    });
    return rows;
}
function showLayerModel() { openGuide('layers'); }
function showEmergency() {
    const rows = emergencyResponseTest();
    const tE = rows.map(r => r.tE), tC = rows.map(r => r.tCont);
    const diverted = rows.filter(r => r.pier !== r.orig).length;
    const worst = rows.slice().sort((a, b) => b.tE - a.tE).slice(0, 5);
    const e = edgeCost('AC-CEN', 'AC-TST', {}, LEVEL_E), a = edgeCost('AC-CEN', 'AC-TST', {});
    showInfo('Emergency response test', `
        <table class="tbl"><tr><th>Event → touchdown</th><th>Mean</th><th>Max</th></tr>
        <tr><td>Divert via layer E</td><td><b>${(mean(tE) / 60).toFixed(2)} min</b></td><td>${(Math.max(...tE) / 60).toFixed(2)} min</td></tr>
        <tr><td>Continue to destination</td><td>${(mean(tC) / 60).toFixed(2)} min</td><td>${(Math.max(...tC) / 60).toFixed(2)} min</td></tr></table>
        <div class="kpi"><span>Events</span><b>${rows.length}</b><span>Diverted to another pier</span><b>${diverted} (${(diverted / rows.length * 100).toFixed(0)} %)</b></div>`,
        CARD_WIDTH, 'main', `
        <b>Test design</b> — one emergency at the midpoint of every cruise leg of all ${OD_COUNT} directional cross-harbour routes (${rows.length} events, current wind).<br>
        Slowest cases: ${worst.map(r => `${r.od} on ${r.leg} → ${PIERS[r.pier].short} ${(r.tE / 60).toFixed(1)} min`).join('; ')}<br>
        Wind on layer E (Central → TST): ${isFinite(e.cost) ? e.w.toFixed(1) : '—'} m/s vs ${isFinite(a.cost) ? a.w.toFixed(1) : '—'} m/s at ${a.z} m.<br><br>
        <b>Layer E rules</b><br>
        1 · Never used by normal planning; admission requires a battery, motor, C2 or gust threshold event.<br>
        2 · A ${VERTICAL_GATE_RADIUS} m protected cylinder and time slot control descent from A/B to E.<br>
        3 · Candidate piers are screened for wind, 10 % emergency battery reserve, 4D trajectory, merge-node and landing-window feasibility.<br>
        4 · The lowest score (touchdown ETA + RFZ exposure + C2-coverage proxies) wins; that pier gets landing priority.<br>
        5 · Old bookings are released only after the complete replacement reservation has succeeded (atomic commit).`);
}

// ---------- 10. Single-route planning & animation ----------
let animationId = null, animPath = null, animMarker = null, animLabels = [];
function startAnimation() {
    if (animationId) {
        cancelAnimationFrame(animationId); animationId = null;
        [animPath, animMarker, ...animLabels].forEach(l => l && map.removeLayer(l)); animLabels = [];
        toggleBtn('btnAnimate', false); closeCard('route'); return;
    }
    const [fromId, toId] = odSelection();
    if (fromId === 'ALL' || toId === 'ALL') { addLog('Select a specific origin and destination pier to plan a route', 'err'); return; }
    if (!isCrossHarbourOD(fromId, toId)) { addLog('Normal routes must connect Hong Kong Island and Kowloon; choose an opposite-shore destination', 'err'); return; }
    const plan = aStar(fromId, toId, currentEdgeCounts());
    if (!plan) { addLog('No feasible route (wind / capacity)', 'err'); return; }
    toggleBtn('btnAnimate', true);
    const color = PIERS[fromId].color, name = `${PIERS[fromId].short} → ${PIERS[toId].short}`;
    const why = explainRoute(fromId, toId, plan);
    addLog(`A* ${name}: ${plan.path.join(' → ')}`, 'inf');
    const rows = plan.legs.map(l => `<tr><td>${l.from}→${l.to}</td><td>${l.z}</td><td>${l.d.toFixed(0)}</td>` +
        `<td style="color:${l.wAlong < 0 ? '#f87171' : '#4ade80'}">${l.wAlong >= 0 ? '+' : ''}${l.wAlong.toFixed(1)}</td>` +
        `<td>${l.vg.toFixed(1)}</td><td>${l.tFlight.toFixed(0)}</td></tr>`).join('');
    showInfo(`Route ${name}`, `
        <div class="kpi"><span>Path</span><b>${plan.path.filter(n => n.startsWith('AC-')).map(n => n.slice(3)).join(' → ')}</b>
        <span>Distance</span><b>${(plan.d / 1000).toFixed(2)} km</b>
        <span>Flight time</span><b>${(plan.tTotal / 60).toFixed(1)} min</b>
        <span>Energy used</span><b>${plan.E_Wh.toFixed(0)} Wh · ${plan.batteryPct.toFixed(0)} % of battery</b></div>
        <span class="muted">${why.summary}</span>`, CARD_WIDTH, 'route', `
        ${why.html.replace(/^<br>/, '')}<br><b>Legs</b>
        <table class="tbl"><tr><th>Leg</th><th>z [m]</th><th>d [m]</th><th>w∥</th><th>v<sub>g</sub></th><th>t [s]</th></tr>${rows}</table>
        Cruise ${plan.tFlight.toFixed(0)} s · queue ${plan.tQueue.toFixed(1)} s · climb ${plan.tClimb.toFixed(0)} s · descent ${plan.tDesc.toFixed(0)} s<br>
        ρ = ${plan.pm.rho.toFixed(3)} kg/m³ · P<sub>cruise</sub> ${plan.pm.P_cruise.toFixed(0)} W · ${plan.feasibleBattery ? 'within 80 % usable battery' : 'exceeds 80 % usable battery'}<br>
        ${plan.rfzHit.length ? `Crosses RFZ (advisory): ${plan.rfzHit.map(rfzEN).join(', ')}` : 'Clear of named RFZs (inside Victoria Harbour RFZ)'}
        <span class="muted">Cost = d/v<sub>g</sub> + W<sub>q</sub> [s]; wind per leg at its semicircular level from the station field.</span>`);
    const route = plan.path.map(n => WP[n]);
    animPath = L.polyline(route, { color, weight: 4, opacity: 0.75, dashArray: '8 5' }).addTo(map);
    // straight line for comparison (not a corridor)
    animLabels.push(L.polyline([PIERS[fromId].pos, PIERS[toId].pos], { color: '#e2e8f0', weight: 2, opacity: 0.7, dashArray: '2 8' })
        .bindTooltip(`Straight line ${why.straight.toFixed(0)} m — not a corridor`, { sticky: true }).addTo(map));
    plan.path.forEach((n, i) => animLabels.push(L.marker(WP[n], { icon: L.divIcon({ className: 'drone-icon',
        html: `<div class="wp-badge" style="border-color:${color};color:${color}">${i + 1}</div>`, iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(map)));
    animMarker = null;
    animationId = -1;   // route shown (static); no moving preview marker
}

// ---------- 11. Analysis: site data ----------
function showSiteEvidence() {
    const rows = Object.entries(PIERS).map(([id, p]) => {
        const nearest = HKO_STATIONS.map(s => ({ s, d: distMetres(s.pos, p.pos) })).sort((a, b) => a.d - b.d)[0];
        const c1 = !p.ferry[0].startsWith('Cruise'), c2 = nearest.d <= 1500;
        const deg = DEGREE['AC-' + id.slice(3)] - 1;
        const rfz = NODE_RFZ[id];
        return `<tr><td><b>${p.short}</b>${p.approx ? '*' : ''}</td><td>${p.ferry.join('; ')}</td><td>${p.patronage}</td>` +
               `<td>${nearest.s.id} · ${nearest.d.toFixed(0)} m</td><td>${deg}</td><td>${rfz.length ? rfz.map(rfzEN).join('; ') : '—'}</td></tr>`;
    }).join('');
    showInfo('Site Data', `
        <table class="tbl"><tr><th>Pier</th><th>Ferry services</th><th>Patronage</th><th>Nearest HKO anemometer</th><th>Links</th><th>Named RFZ at site</th></tr>${rows}</table>
        <b>Access / holding fixes</b>
        <table class="tbl"><tr><th>Fix</th><th>Bearing</th><th>d [m]</th><th>Channel [m]</th><th>Cap [m]</th><th>Note</th></tr>${Object.entries(AC_INFO).map(([k, a]) =>
            `<tr><td>${k}</td><td>${a.bearing.toFixed(0)}°</td><td>${a.d.toFixed(0)}</td><td>${a.width.toFixed(0)}${a.widthSrc === 'along normal' ? '' : '*'}</td><td>${a.cap.toFixed(0)}</td><td>${a.flag || (a.rfz.length ? 'inside ' + a.rfz.map(rfzEN).join('; ') : 'ok')}</td></tr>`).join('')}</table>
        <p class="note">Fix placement: shoreline normal from neighbouring piers; d = smallest ≥ ${D_MIN} m outside named RFZs and ≥ ${AC_SPACING} m from other fixes, capped at 40 % of channel width (* = distance to nearest opposite pier). Links = connections from the pier's access fix. Pier positions marked * are approximate (±50 m).</p>`);
    if (!vertiportOn) toggleVertiports();
}

// ---------- 12. Wind field ----------
const hudWind = document.getElementById('hudWind');
function toggleWind() {
    windOn = !windOn; toggleBtn('btnWind', windOn);
    if (windOn) { windLayer.addTo(map); loadWind(); }
    else { windLayer.clearLayers(); map.removeLayer(windLayer); hudWind.style.display = 'none'; closeCard('wind'); }
}
function renderWind() {
    windLayer.clearLayers();
    if (!windModel.loaded) { showInfo('Wind field', '<span class="badge warn">No wind data</span><br>Routing assumes still air.', 250, 'wind'); return; }
    windModel.stations.forEach(st => {
        const a90 = stationAt(st, 90), a110 = stationAt(st, 110);
        const html = `<div style="transform:rotate(${(st.dir + 180) % 360}deg);color:#facc15;font-size:20px;line-height:1">↑</div>`;
        windLayer.addLayer(L.marker(st.pos, { icon: L.divIcon({ className: 'drone-icon', html, iconSize: [20, 20], iconAnchor: [10, 10] }) })
            .bindPopup(`<b>HKO ${st.name} (${st.id})</b><br>Anemometer ${st.h} m above sea level · obs ${st.V.toFixed(1)} m/s from ${st.dir.toFixed(0)}° · gust ${st.gust.toFixed(1)} m/s<br>` +
                       `→ 90 m: ${a90.V.toFixed(1)} m/s (gust ${a90.gust.toFixed(1)})<br>→ 110 m: ${a110.V.toFixed(1)} m/s (gust ${a110.gust.toFixed(1)})`));
        windLayer.addLayer(L.marker(st.pos, { interactive: false, icon: L.divIcon({ className: 'drone-icon',
            html: `<div class="map-label lbl-site" style="color:#facc15">${st.id} ${st.V.toFixed(1)} m/s</div>`, iconSize: [90, 14], iconAnchor: [45, -12] }) }));
    });
    // Leg-midpoint wind at each leg's level
    const legs = [];
    GRAPH_EDGES.forEach(([a, b]) => [[a, b], [b, a]].forEach(([u, v]) => {
        const g = groundSpeed(WP[u], WP[v]);
        legs.push({ u, v, ...g });
    }));
    const cross = legs.filter(l => !l.u.startsWith('PR') && !l.v.startsWith('PR'));
    cross.filter((l, i) => i % 2 === 0).forEach(l => {
        const mid = [(WP[l.u][0] + WP[l.v][0]) / 2, (WP[l.u][1] + WP[l.v][1]) / 2];
        windLayer.addLayer(L.circleMarker(mid, { radius: 3 + l.w / 2, color: '#facc15', weight: 1, fillOpacity: 0.25 })
            .bindPopup(`<b>${l.u} ↔ ${l.v}</b><br>${edgePhysicsHTML(l.u, l.v)}`));
    });
    const st = windModel.stations;
    const v90 = cross.filter(l => l.z === 90).map(l => l.w), v110 = cross.filter(l => l.z === 110).map(l => l.w);
    const v60 = cross.map(l => groundSpeed(WP[l.u], WP[l.v], LEVEL_E).w);
    const loo = windModel.loo;
    const rows = st.map(s => `<tr><td>${s.id}</td><td>${s.h}</td><td>${s.V.toFixed(1)}</td><td>${s.dir.toFixed(0)}°</td><td>${s.gust.toFixed(1)}</td>` +
        `<td>${stationAt(s, 60).V.toFixed(1)}</td><td>${stationAt(s, 90).V.toFixed(1)}</td><td>${stationAt(s, 110).V.toFixed(1)}</td>` +
        `<td>${loo ? loo.rows.find(r => r.id === s.id).pred.toFixed(1) : '—'}</td></tr>`).join('');
    const T60 = windModel.temp - 0.0065 * 58, T90 = windModel.temp - 0.0065 * 88, T110 = windModel.temp - 0.0065 * 108;
    windModel.card = { rows, v60, v90, v110, T60, T90, T110, loo };
    windCard();
    hudWind.style.display = 'block';
    const WF = (key, html) => `<span class="hf" title="${HUD_TIPS[key]}">${html}</span>`, WS = '<span class="sep">|</span>';
    hudWind.innerHTML = WF('wsrc', `wind: ${windKind().short}`) +
        WS + WF('w60', `60 m <b>${Math.min(...v60).toFixed(1)}–${Math.max(...v60).toFixed(1)}</b> m/s`) +
        WS + WF('w90', `90 m <b>${Math.min(...v90).toFixed(1)}–${Math.max(...v90).toFixed(1)}</b> m/s`) +
        WS + WF('w110', `110 m <b>${Math.min(...v110).toFixed(1)}–${Math.max(...v110).toFixed(1)}</b> m/s`) +
        '<span class="hud-more" title="Open the wind card with details">?</span>';
    windModel.hud = { v60, v90, v110, T60, T90, T110 };
    if (document.getElementById('card-explain-wind')) showWindExplain();
}

function windKind() {
    const src = windModel.source || '';
    if (src.startsWith('HKO')) return { cls: 'ok', label: 'HKO observed', short: 'HKO observed' };
    if (src.startsWith('Offline')) return { cls: 'warn', label: 'Offline snapshot — illustrative, not live', short: 'snapshot' };
    return { cls: 'warn', label: 'Model estimate — not HKO observations', short: 'model (not HKO)' };
}
function windCard() {
    const k = windModel.card; if (!k) return;
    const r = a => `${Math.min(...a).toFixed(1)}–${Math.max(...a).toFixed(1)} m/s`, wk = windKind();
    const isHKO = wk.cls === 'ok', isSnap = (windModel.source || '').startsWith('Offline');
    const main = `<span class="badge ${wk.cls}">${wk.label}</span><br>
        <span class="muted">${windModel.updated && windModel.updated !== 'snapshot' ? 'Updated ' + windModel.updated.replace(/(\d)T(\d)/, '$1 $2') : ''}</span>
        <table class="tbl"><tr><th>Layer</th><th>Leg wind</th><th>Air temp</th></tr>
        <tr><td>A · 90 m</td><td>${r(k.v90)}</td><td>${k.T90.toFixed(1)} °C</td></tr>
        <tr><td>B · 110 m</td><td>${r(k.v110)}</td><td>${k.T110.toFixed(1)} °C</td></tr>
        <tr><td>E · 60 m</td><td>${r(k.v60)}</td><td>${k.T60.toFixed(1)} °C</td></tr></table>
        ${!isHKO && !isSnap ? `<span class="muted">HKO feed: ${windModel.hkoStatus || 'not read'} · <a href="#" style="color:#93c5fd" onclick="pickHKOFile();return false">load HKO CSV file…</a></span>` : ''}
        ${dataMode === 'snapshot' ? `<span class="muted">Fixed snapshot in use · <a href="#" style="color:#93c5fd" onclick="setDataMode('live');return false">back to live data</a></span>` : ''}`;
    const loo = k.loo;
    const help = `<b>How these wind speeds are obtained</b><br>
        1 · <b>Source.</b> ${isHKO ? 'Measured 10-minute mean wind and gust from four Hong Kong Observatory harbour anemometers (Central Pier, Star Ferry, North Point, Kai Tak).'
            : isSnap ? 'Built-in snapshot (illustrative autumn easterly) — not a measurement.'
            : 'The HKO file could not be read (' + (windModel.hkoStatus || 'not read') + '), so the Open-Meteo forecast model is used at the four HKO station sites. These are model values, not HKO measurements; the four sites fall in the same model grid cell, so all four show the same number.'}<br>
        2 · <b>To flight height.</b> Each station value is scaled from anemometer height h to 60 / 90 / 110 m with V(z) = V·(z/h)<sup>α</sup>; α = ${windModel.alpha.toFixed(3)} (${windModel.alphaSrc}).<br>
        3 · <b>Along each corridor link.</b> The four stations are combined at the link midpoint by inverse-distance weighting of the wind vector, then multiplied by a building-wake factor K (0.6–1.3).<br>
        4 · <b>Used by routing.</b> Leg wind sets ground speed, flight time and energy; legs above ${UAV.maxWind} m/s mean or ${UAV.maxGust} m/s gust are closed.
        <table class="tbl"><tr><th>Stn</th><th>h [m]</th><th>V obs</th><th>Dir</th><th>Gust</th><th>V60</th><th>V90</th><th>V110</th><th>LOO</th></tr>${k.rows}</table>
        ${isHKO && loo ? `Leave-one-out check: RMSE ${loo.rmse.toFixed(2)} m/s, bias ${loo.bias >= 0 ? '+' : ''}${loo.bias.toFixed(2)} m/s<br>` : 'Leave-one-out check: not applicable (no independent station values)<br>'}
        Temperature ${windModel.temp.toFixed(1)} °C at 2 m, reduced with the ISA lapse rate (−6.5 °C/km).<br>
        <span class="muted">HKO data: <a href="${HKO_CSV}" target="_blank" style="color:#93c5fd">latest_10min_wind.csv</a> (updated every 10 min). If your browser blocks direct reading, download it and use "load HKO CSV file".</span><br>
        <span class="muted">${dataMode === 'snapshot' ? '<a href="#" style="color:#93c5fd" onclick="setDataMode(\'live\');return false">Back to live data</a>' : '<a href="#" style="color:#93c5fd" onclick="setDataMode(\'snapshot\');return false">Use the fixed snapshot</a> — the same wind every time, for a reproducible demo (used for Table 9.2b of the thesis).'}</span>`;
    showInfo('Wind field', main, CARD_WIDTH, 'wind', help);
}

// ---------- 13. Batch conflict evaluation (headless, reproducible) ----------
// ======================================================================
//  Fixed-fleet model (headless): UAVs based at piers, recharge, empty repositioning
// ======================================================================
function openFleet() { document.getElementById('fleetOverlay').classList.add('open'); }
function closeFleet() { document.getElementById('fleetOverlay').classList.remove('open'); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeFleet(); });
function fleetParams() {
    const v = id => parseFloat(document.getElementById(id).value);
    return { n: Math.max(1, Math.round(v('flN'))), bat: v('flBat'), chg: v('flChg'), rate: v('flRate'), dur: v('flDur'), seed: Math.round(v('flSeed')), strat: document.getElementById('flStrat').value, tgt: Math.max(0, Math.round(v('flTgt'))) };
}
function fleetSim(P) {
    const rng = mulberry32(P.seed), piers = Object.keys(PIERS), RESERVE = 0.2, dt = 5, T = P.dur * 60;
    const plans = {}; piers.forEach(a => piers.forEach(b => { if (a !== b) plans[a + '>' + b] = aStar(a, b, {}); }));
    const res = { nodes: {}, pads: {}, trajs: [], verticals: [], vert: {} };
    const uavs = []; piers.forEach(p => { for (let k = 0; k < P.n; k++) uavs.push({ id: `F${String(uavs.length + 1).padStart(2, '0')}`, home: p, at: p, wh: P.bat, state: 'idle', tFree: 0, trips: 0, empty: 0, used: 0, tFly: 0, tChg: 0, tIdle: 0, charges: 0, wasCharging: false }); });
    const orders = [], queue = {}; piers.forEach(p => queue[p] = []);
    let tNext = 0, oid = 0, repos = 0, homes = 0; const series = [], snaps = [];
    const ods = odRoutes.map(o => [o.from, o.to]);
    const maxE = {}; piers.forEach(a => maxE[a] = Math.max(...piers.filter(b => b !== a && plans[a + '>' + b]).map(b => plans[a + '>' + b].E_Wh)));
    const nextArrival = () => -Math.log(1 - rng()) / (P.rate / 60);
    tNext = nextArrival();
    const launch = (u, from, to, t, order) => {
        const plan = plans[from + '>' + to]; if (!plan) return false;
        const s = scheduleDeparture(plan, t, res, 600); if (!s) return false;
        reserve(s.tl, to, u.id + '#' + (u.trips + u.empty), res);
        u.state = 'booked'; u.tDep = t + s.delay; u.tFree = s.tl.padFree; u.to = to; u.planE = plan.E_Wh; u.order = order;
        if (order) { order.tDep = u.tDep; order.uav = u.id; u.trips++; } else { u.empty++; repos++; if (to === u.home && order === null && u.goingHome) homes++; } u.goingHome = false;
        return true;
    };
    for (let t = 0; t <= T; t += dt) {
        while (tNext <= t && tNext <= T) { const [a, b] = ods[Math.floor(rng() * ods.length)]; const o = { id: ++oid, from: a, to: b, tCreate: tNext }; orders.push(o); queue[a].push(o); tNext += nextArrival(); }
        // UAV state updates
        uavs.forEach(u => {
            u.chgNow = false;
            if (u.state === 'booked' && t >= u.tDep) { u.state = 'flying'; u.wh -= u.planE; u.used += u.planE; }
            if (u.state === 'flying' && t >= u.tFree) { u.state = 'idle'; u.at = u.to; }
            if (u.state === 'flying') u.tFly += dt;
            else if (u.wh < P.bat - 1e-6) { const add = Math.min(P.bat - u.wh, P.chg * 1000 * dt / 3600); u.wh += add; u.chgNow = true; u.tChg += dt; if (!u.wasCharging) { u.charges++; u.wasCharging = true; } }
            else { u.tIdle += dt; u.wasCharging = false; }
            if (u.state === 'flying') u.wasCharging = false;
        });
        // assign waiting orders to UAVs at their origin pier
        piers.forEach(p => {
            while (queue[p].length) {
                const o = queue[p][0], need = plans[o.from + '>' + o.to].E_Wh + RESERVE * P.bat;
                const u = uavs.filter(x => x.state === 'idle' && x.at === p && x.wh >= need).sort((a, b) => b.wh - a.wh)[0];
                if (!u || !launch(u, o.from, o.to, t, o)) break;
                queue[p].shift();
            }
        });
        // empty repositioning to piers with waiting orders and no usable UAV on the way
        if (P.strat === 'reactive') piers.forEach(p => {
            if (!queue[p].length) return;
            const inbound = uavs.filter(x => (x.state === 'booked' || x.state === 'flying') && x.to === p).length;
            const usableHere = uavs.filter(x => x.state === 'idle' && x.at === p).length;
            if (inbound + usableHere >= queue[p].length) return;
            const donors = piers.filter(q => q !== p).map(q => ({ q, spare: uavs.filter(x => x.state === 'idle' && x.at === q).length - queue[q].length }))
                .filter(d => d.spare > 0).sort((a, b) => plans[a.q + '>' + p].tTotal - plans[b.q + '>' + p].tTotal);
            for (const d of donors) {
                const need = plans[d.q + '>' + p].E_Wh + RESERVE * P.bat;
                const u = uavs.filter(x => x.state === 'idle' && x.at === d.q && x.wh >= need).sort((a, b) => b.wh - a.wh)[0];
                if (u && launch(u, d.q, p, t, null)) break;
            }
        });
        if (P.strat === 'proactive') {
            const ready = q => uavs.filter(x => x.state === 'idle' && x.at === q && x.wh >= maxE[q] + RESERVE * P.bat);
            const inb = q => uavs.filter(x => (x.state === 'booked' || x.state === 'flying') && x.to === q).length;
            const supply = q => ready(q).length + inb(q) - queue[q].length;            // ready + on the way − orders waiting
            const spare = q => ready(q).length - queue[q].length - P.tgt;              // what q can give away and still meet its own target
            // (1) top up piers below target from the nearest pier above target
            piers.map(q => ({ q, gap: P.tgt - supply(q) })).filter(d => d.gap > 0).sort((a, b) => b.gap - a.gap).forEach(({ q, gap }) => {
                for (let k = 0; k < gap; k++) {
                    const donor = piers.filter(d => d !== q && spare(d) > 0).sort((a, b) => plans[a + '>' + q].tTotal - plans[b + '>' + q].tTotal)[0];
                    if (!donor) break;
                    const need = plans[donor + '>' + q].E_Wh + RESERVE * P.bat;
                    const u = ready(donor).filter(x => x.wh >= need).sort((a, b) => b.wh - a.wh)[0];
                    if (!u || !launch(u, donor, q, t, null)) break;
                }
            });
            // (3) surplus UAVs go back to their home pier when home is short of its base allotment
            piers.forEach(q => {
                if (queue[q].length) return;
                const here = uavs.filter(x => x.state === 'idle' && x.at === q);
                if (here.length <= P.n) return;
                const u = here.filter(x => x.home !== q && x.wh >= plans[q + '>' + x.home].E_Wh + RESERVE * P.bat
                    && uavs.filter(y => (y.state === 'idle' && y.at === x.home) || ((y.state === 'booked' || y.state === 'flying') && y.to === x.home)).length < P.n)
                    .sort((a, b) => b.wh - a.wh)[0];
                if (u) { u.goingHome = true; launch(u, q, u.home, t, null); }
            });
        }
        if (t % 60 === 0) snaps.push({ q: piers.map(p => queue[p].length), u: uavs.map(u => ({ at: u.at, to: u.to, st: u.state, wh: u.wh, chg: !!u.chgNow, ord: !!u.order })) });
        if (t % 60 === 0) series.push({ t: t / 60, waiting: piers.reduce((a, p) => a + queue[p].length, 0), idle: uavs.filter(x => x.state === 'idle').length, air: uavs.filter(x => x.state === 'flying').length,
            soc: 100 * uavs.reduce((a, x) => a + x.wh, 0) / (uavs.length * P.bat) });
    }
    const served = orders.filter(o => o.tDep !== undefined && o.tDep <= T), waits = served.map(o => o.tDep - o.tCreate).sort((a, b) => a - b);
    const byPier = piers.map(p => { const os = orders.filter(o => o.from === p), sv = os.filter(o => o.tDep !== undefined && o.tDep <= T), w = sv.map(o => o.tDep - o.tCreate);
        return { p, orders: os.length, served: sv.length, wait: mean(w), maxQ: Math.max(0, ...series.map(() => 0)), end: uavs.filter(u => u.at === p && u.state !== 'flying').length, queueEnd: queue[p].length }; });
    const totalUsed = uavs.reduce((a, u) => a + u.used, 0);
    return { P, uavs, orders, served, waits, series, snaps, repos, homes, byPier, totalUsed,
        meanWait: mean(waits), p95: waits.length ? waits[Math.floor(waits.length * 0.95)] : 0, util: mean(uavs.map(u => u.tFly / (T + 1))) };
}
const FL = { r: null, play: null };
function fleetPierView(min) {
    const r = FL.r; if (!r) return; const P = r.P, piers = Object.keys(PIERS);
    min = Math.max(0, Math.min(r.snaps.length - 1, Math.round(min))); const S = r.snaps[min];
    document.getElementById('flMin').textContent = min;
    const ids = r.uavs.map(u => u.id);
    const row = (u, i) => {
        const pct = 100 * u.wh / P.bat;
        const st = u.st === 'booked' ? `<span style="color:#fbbf24">booked → ${PIERS[u.to].short}</span>` : u.chg ? `<span style="color:#4ade80">⚡ ${P.chg} kW</span>` : '<span class="muted">full</span>';
        return `<tr><td>${ids[i]}</td><td style="white-space:nowrap">${batBar(pct)}</td><td>${u.wh.toFixed(0)} / ${P.bat} Wh</td><td>${st}</td></tr>`; };
    const cards = piers.map((p, k) => {
        const here = S.u.map((u, i) => [u, i]).filter(([u]) => u.st !== 'flying' && u.at === p);
        return `<div class="fl-pier"><div class="fl-ph"><b>${PIERS[p].short}</b> <span>${PIERS[p].name || ''}</span><span class="fl-q${S.q[k] ? ' on' : ''}">${S.q[k]} order${S.q[k] === 1 ? '' : 's'} waiting</span></div>
            <table class="tbl"><tr><th>UAV</th><th>Battery</th><th>Remaining / capacity</th><th>Charging</th></tr>${here.map(([u, i]) => row(u, i)).join('') || '<tr><td colspan="4" class="muted">no UAV parked</td></tr>'}</table></div>`; }).join('');
    const air = S.u.map((u, i) => [u, i]).filter(([u]) => u.st === 'flying');
    const airTxt = air.length ? air.map(([u, i]) => `<span class="fl-air">${ids[i]} ${PIERS[u.at].short} → ${PIERS[u.to].short}${u.ord ? '' : ' (empty)'} · ${(100 * u.wh / P.bat).toFixed(0)} %</span>`).join('') : '<span class="muted">none</span>';
    document.getElementById('flPiers').innerHTML = `<div class="fl-airrow"><b>In the air (${air.length})</b> ${airTxt}</div><div class="fl-piers">${cards}</div>`;
}
function fleetPlay() {
    const sl = document.getElementById('flSlider'), b = document.getElementById('flPlayBtn');
    if (FL.play) { clearInterval(FL.play); FL.play = null; b.textContent = '▶ Play'; return; }
    if (+sl.value >= +sl.max) sl.value = 0;
    b.textContent = '❚❚ Pause';
    FL.play = setInterval(() => { sl.value = +sl.value + 1; fleetPierView(+sl.value); if (+sl.value >= +sl.max) fleetPlay(); }, 180);
}
function fleetChart(series) {
    const W = 560, H = 170, x0 = 34, y0 = 12, w = W - x0 - 10, h = H - y0 - 24;
    const tMax = Math.max(1, series[series.length - 1].t), vMax = Math.max(4, ...series.map(s => Math.max(s.waiting, s.idle, s.air)));
    const X = t => x0 + t / tMax * w, Y = v => y0 + h - v / vMax * h, Ys = v => y0 + h - v / 100 * h;
    const line = (k, c, f = Y) => `<polyline fill="none" stroke="${c}" stroke-width="1.8" points="${series.map(s => X(s.t).toFixed(1) + ',' + f(s[k]).toFixed(1)).join(' ')}"/>`;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(q => `<text x="${X(q * tMax)}" y="${H - 6}" fill="#64748b" font-size="10" text-anchor="middle">${Math.round(q * tMax)}</text>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;background:rgba(2,6,23,0.4);border-radius:8px">
        <line x1="${x0}" y1="${y0 + h}" x2="${x0 + w}" y2="${y0 + h}" stroke="#334155"/><text x="${x0 - 6}" y="${y0 + 8}" fill="#64748b" font-size="10" text-anchor="end">${vMax}</text><text x="${x0 - 6}" y="${y0 + h}" fill="#64748b" font-size="10" text-anchor="end">0</text>
        ${ticks}${line('waiting', '#f87171')}${line('idle', '#4ade80')}${line('air', '#60a5fa')}${line('soc', '#fbbf24', Ys)}</svg>
        <div class="muted"><span style="color:#f87171">■</span> orders waiting &nbsp; <span style="color:#4ade80">■</span> UAVs idle / charging on a pier &nbsp; <span style="color:#60a5fa">■</span> UAVs flying &nbsp; <span style="color:#fbbf24">■</span> mean fleet charge (0–100 %) &nbsp; · x = minutes</div>`;
}
function runFleet() {
    const out = document.getElementById('flOut'); out.innerHTML = '<p class="muted">Running…</p>';
    setTimeout(() => {
        const P = fleetParams(), r = fleetSim(P), T = P.dur;
        const k = (v, l) => `<div class="fl-kpi"><b>${v}</b><span>${l}</span></div>`;
        const pierRows = r.byPier.map(b => `<tr><td>${PIERS[b.p].short}</td><td>${b.orders}</td><td>${b.served}</td><td>${b.queueEnd}</td><td>${isFinite(b.wait) ? (b.wait / 60).toFixed(1) : '—'}</td><td>${b.end}</td></tr>`).join('');
        const uavRows = r.uavs.map(u => `<tr><td>${u.id}</td><td>${PIERS[u.home].short}</td><td>${PIERS[u.at].short}${u.state === 'flying' ? ' (flying)' : ''}</td><td>${u.trips}</td><td>${u.empty}</td><td>${(u.used / 1000).toFixed(2)}</td><td>${batBar(100 * u.wh / P.bat)}</td><td>${(100 * u.tFly / (T * 60)).toFixed(0)} %</td><td>${(100 * u.tChg / (T * 60)).toFixed(0)} %</td></tr>`).join('');
        FL.r = r; if (FL.play) { clearInterval(FL.play); FL.play = null; }
        out.innerHTML = `<h4 style="margin-top:0">Piers at minute <span id="flMin">${T}</span> <span class="muted">· which UAV is parked where, its remaining charge, battery capacity and charging power</span></h4>
          <div class="fl-time"><button class="btn" id="flPlayBtn" onclick="fleetPlay()">▶ Play</button><input id="flSlider" type="range" min="0" max="${r.snaps.length - 1}" value="${r.snaps.length - 1}" oninput="fleetPierView(this.value)"><span class="muted">0 – ${T} min</span></div>
          <div id="flPiers"></div>
          <h4>Summary</h4><div class="fl-kpis">
            ${k(`${r.served.length} / ${r.orders.length}`, 'orders served / created')}
            ${k(`${(r.meanWait / 60).toFixed(1)} min`, 'mean wait (order → take-off)')}
            ${k(`${(r.p95 / 60).toFixed(1)} min`, '95th-percentile wait')}
            ${k(`${(100 * r.util).toFixed(0)} %`, 'fleet time in the air')}
            ${k(r.repos, P.strat === 'proactive' ? `empty flights · ${r.homes} back home` : 'empty repositioning flights')}
            ${k(`${(r.totalUsed / 1000).toFixed(1)} kWh`, `energy used · ${r.served.length ? (r.totalUsed / r.served.length).toFixed(0) : '—'} Wh per order`)}
            ${k(`${r.uavs.length}`, `UAVs (${P.n} per pier × 7)`)}
          </div>
          <h4>Over time</h4>${fleetChart(r.series)}
          <h4>By pier</h4><table class="tbl"><tr><th>Pier</th><th>Orders</th><th>Served</th><th>Still waiting</th><th>Mean wait min</th><th>UAVs here at end</th></tr>${pierRows}</table>
          <h4>By UAV</h4><table class="tbl"><tr><th>UAV</th><th>Home</th><th>Now at</th><th>Deliveries</th><th>Empty flights</th><th>kWh used</th><th>Charge at end</th><th>Flying</th><th>Charging</th></tr>${uavRows}</table>
          <p class="muted">${P.n} UAVs per pier · rebalancing ${P.strat}${P.strat === 'proactive' ? ' (target ' + P.tgt + ' ready / pier)' : ''} · ${P.rate} orders/min over the 24 cross-harbour pairs · ${T} min · battery ${P.bat} Wh, charging ${P.chg} kW · seed ${P.seed} · current wind field · 4D booking and take-off column rule as in the live twin.</p>`;
        fleetPierView(r.snaps.length - 1);
        addLog(`Fleet model: ${r.served.length}/${r.orders.length} orders served, mean wait ${(r.meanWait / 60).toFixed(1)} min`, 'ok');
    }, 30);
}
function runFleetSweep() {
    if (FL.play) { clearInterval(FL.play); FL.play = null; }
    const out = document.getElementById('flOut'); out.innerHTML = '<p class="muted">Running 5 fleet sizes…</p>';
    setTimeout(() => {
        const base = fleetParams(), rows = [], S = ['none', 'reactive', 'proactive'];
        for (let n = 1; n <= 5; n++) {
            const rr = S.map(st => fleetSim({ ...base, n, strat: st }));
            const best = Math.max(...rr.map(r => r.served.length));
            rows.push(`<tr${n === base.n ? ' style="background:rgba(59,130,246,0.12)"' : ''}><td>${n}</td><td>${n * 7}</td>${rr.map(r => { const pc = 100 * r.served.length / Math.max(1, r.orders.length);
                return `<td class="fl-sw"${r.served.length === best ? ' style="color:#4ade80"' : ''}>${pc.toFixed(0)} %</td><td>${(r.meanWait / 60).toFixed(1)}</td><td>${r.repos}</td>`; }).join('')}</tr>`);
        }
        out.innerHTML = `<h4>Fleet-size sweep · three rebalancing strategies</h4><table class="tbl"><tr><th rowspan="2">UAVs / pier</th><th rowspan="2">Fleet</th><th colspan="3">None</th><th colspan="3">Reactive</th><th colspan="3">Proactive (target ${base.tgt})</th></tr>
            <tr>${S.map(() => '<th class="fl-sw">Served</th><th>Wait min</th><th>Empty</th>').join('')}</tr>${rows.join('')}</table>
            <p class="muted">Served = orders that took off within ${base.dur} min (green = best of the three). Wait = mean time from order to take-off, including the 4D slot delay. Empty = repositioning flights without cargo — the price paid for the shorter wait. ${base.rate} orders/min · battery ${base.bat} Wh · charging ${base.chg} kW · seed ${base.seed}.</p>`;
        addLog('Fleet-size sweep complete', 'ok');
    }, 30);
}

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function batchRun(ratePerMin, strategic, N = 300, seed = 2026) {
    const rnd = mulberry32(seed), res = { nodes: {}, pads: {}, trajs: [], verticals: [] }, cache = {}, flights = [];
    let t = 0;
    for (let k = 0; k < N; k++) {
        t += -Math.log(1 - rnd()) / (ratePerMin / 60);
        const od = odRoutes[Math.floor(rnd() * odRoutes.length)];
        const key = od.from + od.to;
        if (!(key in cache)) cache[key] = aStar(od.from, od.to, {});
        const plan = cache[key];
        if (!plan) continue;
        let delay = 0, tl;
        if (strategic) { const s = scheduleDeparture(plan, t, res, 3600); if (!s) continue; delay = s.delay; tl = s.tl; reserve(tl, od.to, k, res); }
        else tl = timeline(plan, t);
        flights.push({ plan, tReq: t, tDep: t + delay, delay, tl, dest: od.to });
    }
    // Pads: FIFO, one slot per pier
    let holdEvents = 0, holdTotal = 0;
    const byPad = {};
    flights.forEach(f => (byPad[f.dest] = byPad[f.dest] || []).push(f));
    Object.values(byPad).forEach(arr => {
        arr.sort((a, b) => a.tl.padArr - b.tl.padArr);
        let free = -1e9;
        arr.forEach(f => {
            const start = Math.max(f.tl.padArr, free);
            f.hold = start - f.tl.padArr;
            if (f.hold > 0.5) { holdEvents++; holdTotal += f.hold; }
            free = start + (f.tl.padFree - f.tl.padArr);
        });
    });
    // Cruise trajectories → loss-of-separation (same level, < 80 m), sampled at 1 s
    const xy = {}; Object.keys(WP).forEach(n => xy[n] = toXY(WP[n]));
    // cruise legs only: the final approach (fix → pier) is governed by the pad rule
    flights.forEach(f => { f.segs = f.tl.segs.slice(0, -1); f.c0 = f.tl.c0; f.c1 = f.tl.padArr; });
    flights.sort((a, b) => a.c0 - b.c0);
    const pairs = new Set();
    const tEnd = Math.max(...flights.map(f => f.c1));
    let ptr = 0; const active = [];
    for (let ts = flights[0].c0; ts <= tEnd; ts += 1) {
        while (ptr < flights.length && flights[ptr].c0 <= ts) active.push(flights[ptr++]);
        for (let i = active.length - 1; i >= 0; i--) if (active[i].c1 < ts) active.splice(i, 1);
        const pos = active.map(f => {
            const s = f.segs.find(g => ts >= g.t0 && ts <= g.t1) || f.segs[f.segs.length - 1];
            const q = (ts - s.t0) / Math.max(1e-6, s.t1 - s.t0);
            return { f, x: s.a[0] + (s.b[0] - s.a[0]) * q, y: s.a[1] + (s.b[1] - s.a[1]) * q,
                     z: (s.z0 ?? LEVEL_ALT[s.lvl]) + ((s.z1 ?? LEVEL_ALT[s.lvl]) - (s.z0 ?? LEVEL_ALT[s.lvl])) * q, lvl: s.lvl };
        });
        for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
            if (Math.abs(pos[i].z - pos[j].z) < VERTICAL_SEPARATION && Math.hypot(pos[i].x - pos[j].x, pos[i].y - pos[j].y) < MIN_SEPARATION)
                pairs.add(flights.indexOf(pos[i].f) + '|' + flights.indexOf(pos[j].f));
        }
    }
    const delays = flights.map(f => f.delay);
    return {
        n: flights.length, los: pairs.size, losPer100: pairs.size / flights.length * 100,
        meanDelay: mean(delays), p95Delay: delays.slice().sort((a, b) => a - b)[Math.floor(delays.length * 0.95)] || 0,
        holdEvents, meanHold: holdTotal / flights.length,
        meanTrip: mean(flights.map(f => f.tl.tPier - f.tReq + f.hold + f.plan.tDesc)),
    };
}
function showCrossings() {
    const cr = CROSSINGS.map(c => `<tr><td>${c.id}</td><td>${c.e1[0]}–${c.e1[1]}</td><td>${c.e2[0]}–${c.e2[1]}</td><td>${c.angle.toFixed(0)}°</td></tr>`).join('');
    const merges = Object.keys(DEGREE).filter(n => n.startsWith('AC') && DEGREE[n] >= 3).map(n => `${n} (${DEGREE[n]})`).join(', ');
    showInfo('Network & Conflicts', `
        ${CROSSINGS.length ? `<table class="tbl"><tr><th>Junction</th><th>Link 1</th><th>Link 2</th><th>Angle</th></tr>${cr}</table>`
          : '<b>Geometric crossings: 0</b><br>'}
        <div class="note">Merge nodes (degree ≥ 3): ${merges}</div>
        <b>Network alternatives</b> (computed live over the ${OD_COUNT} cross-harbour OD pairs, shortest path by distance)
        <table class="tbl"><tr><th>Network</th><th>Links</th><th>Crossings</th><th>Mean detour</th><th>Max detour</th><th>Single-link cuts</th></tr>
        ${networkAlternatives().map(r => `<tr><td>${r.name}</td><td>${r.links}</td><td>${r.cross}</td><td>${isFinite(r.mean) ? r.mean.toFixed(3) : '—'}</td><td>${isFinite(r.max) ? r.max.toFixed(2) : '—'}</td><td>${r.cuts}</td></tr>`).join('')}</table>
        <p class="note">Detour = shortest corridor path (pier → access fix → … → access fix → pier) / straight pier-to-pier distance. Single-link cut = a corridor link whose loss disconnects at least one OD pair.</p>
        <div class="note"><b>Deconfliction rules</b><br>
        1 · Semicircular levels: track 000–179° at 90 m, 180–359° at 110 m.<br>
        2 · Any crossing in the network becomes a straight-through junction node (none at present).<br>
        3 · Strategic 4D deconfliction: before take-off each flight books its junction times (±(80 m / v<sub>g</sub> + 1 s)), its landing-pad window, and its whole 4D trajectory is probed against booked ones (100 m horizontal / ${VERTICAL_SEPARATION} m vertical buffer); if anything clashes, it waits on the ground.<br>
        4 · Tactical 3D rule: horizontal &lt; 150 m and vertical &lt; ${VERTICAL_SEPARATION} m → trailing UAV slows; horizontal &lt; 80 m and vertical &lt; ${VERTICAL_SEPARATION} m is counted as loss of separation (LoS).<br><br>
        </div>`);
    if (!waypointOn) toggleWaypoints();
}
function networkStats(corr) {
    const edges = [...Object.keys(PIERS).map(id => [id, 'AC-' + id.slice(3)]), ...corr];
    let cross = 0;
    for (let i = 0; i < corr.length; i++) for (let j = i + 1; j < corr.length; j++) {
        const [a, b] = corr[i], [c, d] = corr[j];
        if (new Set([a, b, c, d]).size === 4 && segIntersect(WP[a], WP[b], WP[c], WP[d])) cross++;
    }
    const shortest = (es, from, to) => {
        const adj = {}; es.forEach(([a, b]) => { const w = distMetres(WP[a], WP[b]); (adj[a] = adj[a] || []).push([b, w]); (adj[b] = adj[b] || []).push([a, w]); });
        const dist = { [from]: 0 }, done = new Set();
        while (true) {
            let u = null; Object.keys(dist).forEach(k => { if (!done.has(k) && (u === null || dist[k] < dist[u])) u = k; });
            if (u === null) return Infinity; if (u === to) return dist[u]; done.add(u);
            (adj[u] || []).forEach(([v, w]) => { if (dist[u] + w < (dist[v] ?? Infinity)) dist[v] = dist[u] + w; });
        }
    };
    const det = odRoutes.map(od => shortest(edges, od.from, od.to) / distMetres(WP[od.from], WP[od.to]));
    const cuts = corr.filter(l => { const rest = edges.filter(e => e !== l); return odRoutes.some(od => !isFinite(shortest(rest, od.from, od.to))); }).length;
    return { links: corr.length, cross, mean: mean(det), max: Math.max(...det), cuts };
}
function networkAlternatives() {
    const cur = BASE_EDGES.filter(e => e[0].startsWith('AC-') && e[1].startsWith('AC-')).map(e => [e[0], e[1]]);
    const isNPKT = e => [e[0], e[1]].sort().join() === 'AC-KT,AC-NP';
    const acs = Object.keys(PIERS).map(id => 'AC-' + id.slice(3)), full = [];
    acs.forEach((a, i) => acs.slice(i + 1).forEach(b => full.push([a, b])));
    return [
        ['<b>Adopted network</b>', cur],
        ['Adopted − Macau Ferry–TST (draft v1)', cur.filter(e => [e[0], e[1]].sort().join() !== 'AC-MFT,AC-TST')],
        ['Adopted + Central–Hung Hom', [...cur, ['AC-CEN', 'AC-HH']]],
        ['Adopted − North Point–Kai Tak', cur.filter(e => !isNPKT(e))],
        ['Complete graph between access fixes', full],
    ].map(([name, corr]) => ({ name, ...networkStats(corr) }));
}
function showBatch() {
    showInfo('Batch evaluation', `<p class="note">300 Poisson flights per demand level over the ${OD_COUNT} cross-harbour OD pairs, seed 2026, current wind field, with strategic 4D slots OFF and ON. Takes a few seconds.</p>
        <button class="btn" style="justify-content:center" onclick="runBatch()">Run again</button><div id="batchOut"></div>`, CARD_WIDTH, 'main');
    runBatch();
}
function runBatch() {
    const out = document.getElementById('batchOut');
    out.innerHTML = '<p class="note">Running…</p>';
    setTimeout(() => {
        const rows = [];
        [2, 4, 6].forEach(r => {
            const a = batchRun(r, false), b = batchRun(r, true);
            rows.push(`<tr><td rowspan="2">${r}/min</td><td>OFF</td><td>${a.los}</td><td>${a.losPer100.toFixed(1)}</td><td>${a.holdEvents}</td><td>${a.meanHold.toFixed(1)}</td><td>${a.meanDelay.toFixed(1)}</td><td>${(a.meanTrip / 60).toFixed(2)}</td></tr>`);
            rows.push(`<tr><td>ON</td><td>${b.los}</td><td>${b.losPer100.toFixed(1)}</td><td>${b.holdEvents}</td><td>${b.meanHold.toFixed(1)}</td><td>${b.meanDelay.toFixed(1)}</td><td>${(b.meanTrip / 60).toFixed(2)}</td></tr>`);
        });
        window.lastBatch = rows;
        out.innerHTML = `<table class="tbl"><tr><th>Demand</th><th>4D slots</th><th>LoS pairs</th><th>/100 flt</th><th>Pad holds</th><th>Hold s/flt</th><th>Ground delay s</th><th>Trip min</th></tr>${rows.join('')}</table>
            <p class="note">Poisson demand over ${OD_COUNT} directional cross-harbour OD pairs only, seed 2026, current wind field. LoS = horizontal &lt; 80 m and vertical &lt; ${VERTICAL_SEPARATION} m before tactical resolution; holding = FIFO wait at a busy pad.</p>`;
        addLog('Batch conflict evaluation complete', 'ok');
    }, 30);
}

// ---------- 14. Analysis: routing cost model ----------
const MU = UAV.v_air / SEP_ROUTING;
function weightedCostFn(w) {
    return (u, v, counts) => {
        const ec = edgeCost(u, v, counts);
        if (!isFinite(ec.cost)) return ec;
        const Tb = ec.d / UAV.v_air;
        const Ww = clamp(Math.max(0, -ec.wAlong) / UAV.maxWind, 0, 1);
        const Wg = clamp(ec.gust / UAV.maxGust, 0, 1);
        const Wc = clamp((ec.n / ec.tFlight) / MU, 0, 1);
        const We = clamp(UAV.v_air / ec.vg - 1, 0, 1);
        return { ...ec, cost: Tb * (1 + w[0] * Ww + w[1] * Wg + w[2] * Wc + w[3] * We) };
    };
}
const W_ORIG = [0.40, 0.15, 0.30, 0.15], W_AHP = [0.455, 0.141, 0.263, 0.141];
const SCENARIOS = [
    { name: 'Live wind field', live: true, counts: {} },
    { name: 'Still air', V: 0, dir: 0, gust: 0, counts: {} },
    { name: 'E 6 m/s', V: 6, dir: 90, gust: 9, counts: {} },
    { name: 'S 6 m/s', V: 6, dir: 180, gust: 9, counts: {} },
    { name: 'W 6 m/s + congestion', V: 6, dir: 270, gust: 9,
      counts: { 'AC-CEN>AC-TST': 2, 'AC-TST>AC-CEN': 2, 'AC-WC>AC-TST': 2, 'AC-TST>AC-WC': 2, 'AC-HH>AC-NP': 2 } },
];
function withScenario(sc, fn) {
    if (sc.live) return fn();
    const saved = windModel;
    windModel = { ...saved, loaded: true, alpha: 0.14, stations: HKO_STATIONS.map(s => ({ ...s, h: 10, V: sc.V, dir: sc.dir, gust: sc.gust })) };
    windModel.maxV = Math.max(...windModel.stations.map(s => stationAt(s, 110).V)) * 1.3;
    try { return fn(); } finally { windModel = saved; }
}
function compareCostModels() {
    const methods = [['Physical (used for routing)', null], ['Weighted 0.40/0.15/0.30/0.15', W_ORIG], ['Weighted AHP 0.455/0.141/0.263/0.141', W_AHP]];
    const sens = [];
    for (let i = 0; i < 4; i++) [0.8, 1.2].forEach(f => {
        const w = W_ORIG.slice(); w[i] *= f; const s = w.reduce((a, b) => a + b, 0);
        sens.push([`${['wind', 'gust', 'congestion', 'energy'][i]} ×${f}`, w.map(x => x / s)]);
    });
    const tab = [], sensCount = sens.map(() => 0);
    let pairsTotal = 0;
    SCENARIOS.forEach(sc => withScenario(sc, () => {
        const res = methods.map(() => ({ diff: 0, dt: [], dE: [] }));
        odRoutes.forEach(od => {
            const ref = aStar(od.from, od.to, sc.counts);
            if (!ref) return;
            pairsTotal += sc === SCENARIOS[0] ? 0 : 0;
            const orig = aStar(od.from, od.to, sc.counts, weightedCostFn(W_ORIG));
            methods.forEach(([, w], mi) => {
                const p = w ? aStar(od.from, od.to, sc.counts, weightedCostFn(w)) : ref;
                if (!p) return;
                const m = routeMetrics(p.path, sc.counts);
                if (p.path.join() !== ref.path.join()) res[mi].diff++;
                res[mi].dt.push(m.tTotal - ref.tTotal); res[mi].dE.push(m.E_Wh - ref.E_Wh);
            });
            sens.forEach(([, w], si) => { const p = aStar(od.from, od.to, sc.counts, weightedCostFn(w)); if (p && orig && p.path.join() !== orig.path.join()) sensCount[si]++; });
        });
        methods.forEach(([nm], mi) => tab.push(`<tr><td>${sc.name}</td><td>${nm}</td><td>${res[mi].diff}/${OD_COUNT}</td>` +
            `<td>${mean(res[mi].dt).toFixed(1)}</td><td>${Math.max(0, ...res[mi].dt).toFixed(1)}</td><td>${mean(res[mi].dE).toFixed(2)}</td></tr>`));
    }));
    window.lastCost = { tab, sens: sens.map((s, i) => [s[0], sensCount[i]]) };
    const pm = powerModel(100);
    showInfo('Cost-model comparison', `
        <p class="note">Routing uses the physical cost d/v<sub>g</sub> + W<sub>q</sub> [s]. For comparison, a weighted-sum cost W = T<sub>base</sub>·(1 + w<sub>1</sub>W<sub>wind</sub> + w<sub>2</sub>W<sub>gust</sub> + w<sub>3</sub>W<sub>cong</sub> + w<sub>4</sub>W<sub>energy</sub>)
        is also evaluated (headwind/12, gust/20, utilisation λ/μ, v<sub>air</sub>/v<sub>g</sub> − 1). Routes from each method are scored with the physical model.</p>
        <table class="tbl"><tr><th>Scenario</th><th>Method</th><th>Routes ≠ physical</th><th>Mean extra s</th><th>Max extra s</th><th>Mean extra Wh</th></tr>${tab.join('')}</table>
        <div class="note"><b>Weight sensitivity</b> (each weight ±20 %, renormalised; routes changed, out of ${OD_COUNT * SCENARIOS.length}):
        <table class="tbl"><tr><th>Perturbation</th><th>Routes changed</th></tr>${sens.map((s, i) => `<tr><td>${s[0]}</td><td>${sensCount[i]}</td></tr>`).join('')}</table></div>`);
    addLog('Cost-model comparison complete', 'ok');
}


// ======================================================================
//  Guide & definitions module + live explanations
// ======================================================================
const HUD_TIPS = {
    time: 'Simulated time since the traffic simulation started; the clock runs 8× faster than real time',
    route: 'Origin → destination filter used to generate new flights (set with the two selectors)',
    waiting: 'UAVs on a pier waiting for their booked take-off time (strategic 4D slot). Click the status bar for the reason of each wait',
    airborne: 'UAVs in the air: climbing, cruising, on final approach or changing to the emergency layer',
    holding: 'UAVs circling at an access fix because the destination landing pad is still occupied',
    delivered: 'Flights that have landed and finished unloading since the simulation started',
    los: 'Loss of Separation: number of encounters where two airborne UAVs came closer than 80 m horizontally AND 15 m vertically',
    delay: 'Mean ground delay per departure: how long flights waited on the pier for a conflict-free slot',
    emg: 'Emergency events injected or triggered, and mean time from the event to touchdown',
    wsrc: 'HKO observed = measured by the Hong Kong Observatory; model = Open-Meteo forecast (fallback, not HKO); snapshot = built-in illustrative values',
    alpha: 'Wind-shear exponent of the power law V(z) = V_obs·(z/h)^α used to convert anemometer wind to flight altitude',
    w60: 'Lowest–highest leg wind on the emergency layer E (60 m) across all corridor links, after building-wake correction',
    w90: 'Lowest–highest leg wind on layer A (90 m) across the links flown at that layer',
    w110: 'Lowest–highest leg wind on layer B (110 m) across the links flown at that layer',
    temp: 'Air temperature at 60 / 90 / 110 m from the ISA lapse rate (−6.5 °C per km); used for air density and power',
};
const EMG_THRESH = [
    ['Battery SOC ≤ 25%', 'State of charge = remaining battery energy ÷ 950 Wh. At 25% the UAV can no longer guarantee the normal 20% landing reserve after finishing its mission, so it diverts. Emergency landings may use the battery down to 10%.'],
    ['Motor health < 65%', 'Health index of the propulsion system (1 = nominal). Below 0.65 the remaining thrust margin is treated as insufficient for continued cruise.'],
    ['C2 link lost ≥ 10 s', 'Command-and-control (C2) radio link between UAV and operator. A loss of 10 s or longer triggers the contingency procedure.'],
    ['Detected gust > 20 m/s', 'Gust measured or estimated on the current leg exceeds the airframe gust limit of 20 m/s.'],
];
const GUIDE = [
    ['about', 'About this module', () => `
        <h5>What it is</h5>The Guide is the reference module of the Victoria Harbour digital-twin air corridor. All definitions, thresholds and parameters live here; the main screen keeps only controls and live numbers.
        <h5>How to use it</h5>1 · Choose a topic on the left.<br>2 · Cards on the map show only the key numbers. Click <b>?</b> in a card's header for details, method and definitions.<br>3 · Hover over a button or a status-bar field for a one-line definition; click a status bar for its live card.<br>4 · Close with × or Esc.
        <h5>Study scope</h5>Hypothetical study. The restricted flying zones on the map are the real Cap 448G zones, shown for reference only. This study assumes the corridor operates without these restrictions; any real operation would need CAD approval. Normal missions are cross-harbour only (${OD_COUNT} directional Hong Kong Island ↔ Kowloon pier pairs).`],
    ['winddata', 'Where the wind data comes from', () => `
        <h5>Source, in order of preference</h5>
        1 · <b>HKO observations</b> — the Hong Kong Observatory open-data file <i>latest_10min_wind.csv</i> (10-minute mean wind, direction and gust, updated every 10 min). Four harbour stations are used: Central Pier (anemometer 30 m above sea level), Star Ferry (18 m), North Point (26 m), Kai Tak (16 m). The card shows a green "HKO observed" badge.<br>
        2 · <b>Open-Meteo forecast model</b> — used only if the browser cannot read the HKO file (some browsers block cross-site files opened from a local page). These are model values, not measurements, and the badge says so. The four sites fall in the same model grid cell, so they show the same value.<br>
        3 · <b>Offline snapshot</b> — built-in illustrative values when there is no network, or when chosen for a presentation (wind card › ? › "Use the fixed snapshot").
        <h5>Using HKO data when the browser blocks it</h5>Open the HKO link in the wind card's <b>?</b> section to download the CSV, then click "load HKO CSV file" and pick the file. The twin then uses those observations.
        <h5>From anemometer to corridor</h5>Power law V(z) = V·(z/h)<sup>α</sup> to 60 / 90 / 110 m (α fitted from the Open-Meteo 10 m / 80 m profile, default 0.16) → inverse-distance-weighted wind vector at each link midpoint → building-wake factor K ∈ [0.6, 1.3] → ground speed, flight time and energy for routing.`],
    ['controls', 'Panel controls', () => `
        <table class="tbl"><tr><th>Control</th><th>What it does · how to use</th></tr>
        <tr><td>Wind field</td><td>Loads live wind from 4 HKO harbour stations and shows it per layer. Click to show / hide; the card lists station values.</td></tr>
        <tr><td>HKO weather</td><td>Live district temperatures, humidity and warnings. Display only, not used for routing.</td></tr>
        <tr><td>Piers &amp; Helipads</td><td>7 ferry piers (route endpoints) and 3 helipads (reference). Click a pier for its data.</td></tr>
        <tr><td>Restricted Zones</td><td>288 official Cap 448G zones from the CAD eSUA map, drawn 1:1. Click a zone for its name.</td></tr>
        <tr><td>Waypoint Network</td><td>The corridor graph UAVs must follow. Click a link for its wind, ground speed and time.</td></tr>
        <tr><td>3-layer corridor</td><td>Shows the A / B cruise layers by direction and the reserved E layer (see Three-layer corridor).</td></tr>
        <tr><td>Traffic simulation</td><td>Starts / stops live traffic. Flights are generated for the origin → destination filter below.</td></tr>
        <tr><td>Origin → destination</td><td>Filter for new flights and for route planning. "All" = every cross-harbour pair; same-shore choices are disabled.</td></tr>
        <tr><td>Threshold event</td><td>Pick a threshold, then "Inject" applies it to a random cruising UAV; watch its diversion on layer E.</td></tr>
        <tr><td>Plan (A*)</td><td>Plans one route for a specific pier pair, animates it and explains why it is chosen over the straight line and alternatives.</td></tr></table>`],
    ['layers', 'Three-layer corridor', () => `
        <table class="tbl"><tr><th>Layer</th><th>Altitude</th><th>Direction / role</th><th>Admission</th></tr>
        <tr><td style="color:#22d3ee">A</td><td>90 m</td><td>track 000–179°</td><td>normal planned traffic</td></tr>
        <tr><td style="color:#a78bfa">B</td><td>110 m</td><td>track 180–359°</td><td>normal planned traffic</td></tr>
        <tr><td style="color:#f87171">E</td><td>60 m</td><td>both directions, emergency only</td><td>threshold event + 4D reservation</td></tr></table>
        <h5>Why split by direction</h5>ICAO semicircular rule: UAVs flying opposite directions on the same link are automatically 20 m apart vertically.
        <h5>Piers vs access fixes</h5>Piers are vertical take-off / landing sites. Access fixes (AC-…) are over-water merge and holding points 170 m off each pier; the final spur is flown at ${APPROACH_F * 100}% speed.
        <p class="note">On the 2D map the two cruise directions are drawn with a small sideways offset; all calculations use the real altitudes.</p>`],
    ['routing', 'Routing model', () => `
        <h5>Objective</h5>A* minimises total time Σ[d / v<sub>g</sub> + W<sub>q</sub>] over the corridor network: d = link length, v<sub>g</sub> = ground speed from the wind triangle at the link's layer, W<sub>q</sub> = queueing delay (M/M/1) from traffic on the link.
        <h5>Constraints</h5>Mean wind ≤ ${UAV.maxWind} m/s, gust ≤ ${UAV.maxGust} m/s, crosswind below airspeed, link capacity, 20% battery reserve. No U-turns.
        <h5>Why routes are not straight lines</h5>UAVs may only fly the published corridor links (mainly along ferry routes and the coast, plus two direct crossings). A free straight line would cut across other corridors and restricted zones; linking every pier pair directly would create 18 crossings instead of 0. Plan (A*) shows, for the chosen pair, the straight-line distance, the extra distance, which corridors a direct line would cross, and the alternative corridor routes.
        <h5>Strategic 4D deconfliction (always on)</h5>Before take-off each flight books its junction times, landing-pad window and whole 4D trajectory, and its climb may not overlap another UAV's landing descent at the same pier (one pad per pier); if anything clashes it waits on the pier. That wait is the "delay" in the status bar.`],
    ['emergency', 'Emergency thresholds', () => `
        <table class="tbl"><tr><th>Threshold</th><th>Meaning</th></tr>${EMG_THRESH.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table>
        <h5>What happens after a trigger</h5>NORMAL → threshold exceeded → VERTICAL GATE (wait for a free ${VERTICAL_GATE_RADIUS} m descent cylinder) → DESCEND TO E (60 m) → divert along layer E → FINAL APPROACH → LAND. The diversion pier is chosen by the lowest score = touchdown time + restricted-zone exposure + C2-coverage proxy, among piers that are reachable with the remaining battery and conflict-free; it gets landing priority.`],
    ['status', 'Status bar fields', () => `
        <table class="tbl"><tr><th>Field</th><th>Definition</th></tr>
        ${['time', 'route', 'waiting', 'airborne', 'holding', 'delivered', 'los', 'delay', 'emg'].map(k => `<tr><td>${{ time: 'T+ min', route: 'route', waiting: 'waiting', airborne: 'airborne', holding: 'holding', delivered: 'delivered', los: 'LoS', delay: 'delay', emg: 'emergencies' }[k]}</td><td>${HUD_TIPS[k]}.</td></tr>`).join('')}</table>
        <h5>Why do UAVs wait?</h5>Every pier has one landing pad and every junction admits one UAV per ~6 s. A new flight whose trajectory would clash with a booked one is held on the ground until its whole flight is conflict-free; at most 3 UAVs wait at a time. Click the status bar for the reason of each current wait.`],
    ['wind', 'Wind bar fields', () => `
        <table class="tbl"><tr><th>Field</th><th>Definition</th></tr>
        ${[['wind: source', 'wsrc'], ['α', 'alpha'], ['60 m', 'w60'], ['90 m', 'w90'], ['110 m', 'w110'], ['temp', 'temp']].map(r => `<tr><td>${r[0]}</td><td>${HUD_TIPS[r[1]]}.</td></tr>`).join('')}</table>
        <h5>Data source</h5>See "Where the wind data comes from".`],
];
let guideTopic = 'about';
function openGuide(topic) {
    if (topic) guideTopic = topic;
    document.getElementById('guideNav').innerHTML = GUIDE.map(([id, t]) =>
        `<button class="${id === guideTopic ? 'on' : ''}" onclick="openGuide('${id}')">${t}</button>`).join('');
    const sec = GUIDE.find(g => g[0] === guideTopic) || GUIDE[0];
    document.getElementById('guideBody').innerHTML = sec[2]();
    document.getElementById('guideOverlay').classList.add('open');
}
function closeGuide() { document.getElementById('guideOverlay').classList.remove('open'); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeGuide(); });

// Live explanation of the traffic status bar
// ---------- Flight board: every number in the status bar, traced to individual UAVs ----------
const BOARD_KEYS = ['waiting', 'airborne', 'holding', 'delivered', 'los', 'delay', 'emg'];
let boardFilter = 'all', boardFocus = null;
const boardLayer = L.layerGroup();
const PHASE_COL = { wait: '#64748b', climb: '#93c5fd', A: '#22d3ee', B: '#a78bfa', E: '#ef4444', appr: '#4ade80', hold: '#f472b6', land: '#4ade80', unload: '#94a3b8', emg: '#ef4444' };
function uavPhase(d) {
    const short = PIERS[d.dest].short;
    let lvl = 1; try { lvl = droneLevel(d); } catch (e) {}
    const lay = { 1: 'A · 90 m', 2: 'B · 110 m', 3: 'E · 60 m' }[lvl] || '';
    const i = d.cum ? segIndex(d) : 0, next = d.pathIds[i + 1] || '', pct = d.cum ? Math.round(100 * d.s / d.cum[d.cum.length - 1]) : 0;
    switch (d.state) {
        case 'ground': return { tag: 'wait', phase: 'Waiting', detail: `leaves in ${Math.max(0, d.tDep - simTime).toFixed(0)} s — ${d.delayWhy ? d.delayWhy.text : 'slot free'}` };
        case 'climb': return { tag: 'climb', phase: 'Climbing', detail: `to layer ${lay}` };
        case 'flying': return d.emg ? { tag: 'E', phase: 'Emergency', detail: `layer E → ${short} · ${d.emg.type}` }
                                    : { tag: lvl === 1 ? 'A' : 'B', phase: 'Cruise', detail: `layer ${lay} · next ${next} · ${pct} % of route` };
        case 'approaching': return { tag: 'appr', phase: 'Approach', detail: `final spur to ${short} pad` };
        case 'holding': { const p = padStatus[d.dest], by = p.occupiedBy || p.priority;
            return { tag: 'hold', phase: 'Holding', detail: `at ${d.pathIds[d.pathIds.length - 2]} — ${short} pad ${by ? 'used by ' + by : 'clearing'}` }; }
        case 'emergency_gate': return { tag: 'emg', phase: 'Emergency', detail: `waiting for the vertical gate · ${d.emg.type}` };
        case 'emergency_descent': return { tag: 'emg', phase: 'Emergency', detail: `descending to layer E → ${short}` };
        case 'landing': return { tag: 'land', phase: 'Landing', detail: `vertical descent onto ${short} pad` };
        case 'landed': return { tag: 'unload', phase: 'Unloading', detail: `${Math.min(d.timer, UNLOAD_S).toFixed(0)} / ${UNLOAD_S} s at ${short}` };
    }
    return { tag: 'wait', phase: d.state, detail: '' };
}
function updateUavLabel(d) {
    const ph = uavPhase(d), key = ph.tag;
    if (d.labelTag === key && d.labelFocus === (boardFocus === d.id)) return;
    d.labelTag = key; d.labelFocus = boardFocus === d.id;
    const txt = { wait: 'wait', climb: 'climb', A: 'A', B: 'B', E: 'E', appr: 'appr', hold: 'hold', land: 'land', unload: 'unload', emg: 'EMG' }[key];
    d.label.setIcon(L.divIcon({ className: 'drone-icon', iconSize: [90, 12], iconAnchor: [45, -6],
        html: `<div class="map-label lbl-uav" style="color:${d.labelFocus ? '#facc15' : '#e2e8f0'};white-space:nowrap">${d.id} <span class="ph" style="background:${PHASE_COL[key]}">${txt}</span></div>` }));
}
function boardMatch(d, f) {
    const air = ['climb', 'flying', 'approaching', 'emergency_gate', 'emergency_descent'];
    if (f === 'waiting') return d.state === 'ground';
    if (f === 'airborne') return air.includes(d.state);
    if (f === 'holding') return d.state === 'holding';
    if (f === 'emg') return !!d.emg;
    return true;
}
function setBoardFilter(f) { boardFilter = f; showTrafficExplain(); }
function focusUAV(id) {
    boardFocus = boardFocus === id ? null : id;
    const d = activeDrones.find(x => x.id === id);
    if (d && boardFocus) { map.panTo(d.marker.getLatLng()); }
    activeDrones.forEach(updateUavLabel);
    showTrafficExplain();
}
function drawBoardHighlights(list) {
    boardLayer.clearLayers();
    if (!droneOn) return;
    list.forEach(d => boardLayer.addLayer(L.circleMarker(d.marker.getLatLng(), { radius: 13, color: d.id === boardFocus ? '#facc15' : '#60a5fa', weight: 2, fill: false, interactive: false })));
    const f = activeDrones.find(x => x.id === boardFocus);
    if (f) boardLayer.addLayer(L.polyline(f.coords, { color: '#facc15', weight: 4, opacity: 0.8, interactive: false }));
    if (!map.hasLayer(boardLayer)) boardLayer.addTo(map);
}
function showTrafficExplain() {
    const f = boardFilter;
    const air = activeDrones.filter(d => boardMatch(d, 'airborne'));
    const lv = { 1: 0, 2: 0, 3: 0 }; air.forEach(d => { try { lv[droneLevel(d)]++; } catch (e) {} });
    const n = k => k === 'all' ? activeDrones.length : k === 'delivered' ? stats.completed : k === 'los' ? stats.los : k === 'delay' ? `${mean(stats.delays).toFixed(0)} s` : activeDrones.filter(d => boardMatch(d, k)).length;
    const chipNames = [['all', 'All'], ['waiting', 'Waiting'], ['airborne', 'Airborne'], ['holding', 'Holding'], ['delivered', 'Delivered'], ['los', 'LoS'], ['delay', 'Delay']];
    if (stats.emg) chipNames.push(['emg', 'Emergency']);
    const chips = `<div class="chips">${chipNames.map(([k, t]) => `<button class="chip${k === f ? ' on' : ''}" onclick="setBoardFilter('${k}')">${t} ${n(k)}</button>`).join('')}</div>`;
    let table = '', hl = [], foot = '';
    if (f === 'delivered') {
        const rows = stats.done.slice(-12).reverse();
        table = rows.length ? `<table class="tbl board"><tr><th>UAV</th><th>Route</th><th>Trip</th><th>Ground delay</th></tr>${rows.map(r =>
            `<tr><td>${r.id}</td><td>${r.od}${r.emg ? ' <span style="color:#f87171">(emergency → ' + PIERS[r.dest].short + ')</span>' : ''}</td><td>${(r.trip / 60).toFixed(1)} min</td><td>${r.delay} s</td></tr>`).join('')}</table>` : '<span class="muted">No flight has landed and unloaded yet.</span>';
        if (stats.done.length > 12) foot = `<span class="muted">Last 12 of ${stats.done.length}.</span>`;
    } else if (f === 'los') {
        table = stats.losLog.length ? `<table class="tbl board"><tr><th>T+</th><th>Pair</th><th>Distance</th><th>Phases</th></tr>${stats.losLog.slice(-12).reverse().map(r =>
            `<tr><td>${(r.t / 60).toFixed(1)} min</td><td>${r.a} (${r.odA})<br>${r.b} (${r.odB})</td><td>${r.d.toFixed(0)} m / ${r.dz.toFixed(0)} m</td><td>${r.phA} / ${r.phB}</td></tr>`).join('')}</table>`
            : '<span class="muted">No loss of separation so far — the 4D bookings kept every pair of UAVs at least 80 m / 15 m apart.</span>';
    } else {
        let list = activeDrones.filter(d => boardMatch(d, f === 'delay' ? 'all' : f));
        if (f === 'delay') list = list.slice().sort((a, b) => b.delay - a.delay);
        hl = list;
        table = list.length ? `<table class="tbl board"><tr><th>UAV</th><th>Route</th><th>Phase</th><th>Delay</th></tr>${list.map(d => { const ph = uavPhase(d);
            return `<tr class="row${d.id === boardFocus ? ' focus' : ''}" onclick="focusUAV('${d.id}')"><td>${d.id}</td><td>${d.od}</td><td><span class="ph" style="background:${PHASE_COL[ph.tag]}">${ph.phase}</span><br><span class="muted">${ph.detail}</span></td><td>${d.delay} s</td></tr>`; }).join('')}</table>`
            : `<span class="muted">No UAV in this group right now.</span>`;
        if (f === 'delay') foot = `<span class="muted">Status-bar delay = mean of all ${stats.delays.length} departures so far (${mean(stats.delays).toFixed(0)} s), including flights that have already landed.</span>`;
    }
    drawBoardHighlights(hl);
    showInfo('Flight board', `${chips}${table}${foot}`, CARD_WIDTH, 'explain-traffic', `
        <b>How to read it</b> — each row is one UAV. Click a row to highlight that UAV and its route on the map (click again to clear); blue rings mark the UAVs in the selected group. Click any number in the bottom status bar to open this board filtered to that number. Map labels show each UAV's phase: <b>wait</b> · <b>climb</b> · <b>A</b>/<b>B</b> cruise layer · <b>appr</b> · <b>hold</b> · <b>land</b> · <b>unload</b> · <b>EMG</b>.<br><br>
        <b>Airborne</b> by layer: A ${lv[1]} · B ${lv[2]} · E ${lv[3]}.<br>
        <b>Waiting</b> — ${HUD_TIPS.waiting.split('. Click')[0]}.<br>
        <b>Holding</b> — ${HUD_TIPS.holding}.<br>
        <b>Loss of separation (LoS)</b> — ${HUD_TIPS.los}.<br>
        <b>Ground delay</b> — booked take-off time minus request time. Long delays usually mean the destination pad is the bottleneck: one landing takes about 100–110 s (approach + descent + 30 s unloading).<br>
        <span class="muted">Updates every second. All definitions: Help › Status bar fields.</span>`);
}
function showWindExplain() {
    if (!windOn) { toggleWind(); return; }
    helpOpen.add('wind'); windCard();
}
// pointerdown: the status bar refreshes several times a second, so read the field at press time
document.getElementById('hudTraffic').addEventListener('pointerdown', e => { const f = e.target.closest('[data-k]'); boardFilter = f ? f.dataset.k : 'all'; showTrafficExplain(); });
document.getElementById('hudWind').addEventListener('click', showWindExplain);

// Why the planner chose this route instead of the straight line or another corridor route
function corridorPaths(from, to, maxNodes = 9) {
    const out = [];
    (function dfs(path) {
        const n = path[path.length - 1];
        if (n === to) { out.push(path.slice()); return; }
        if (path.length >= maxNodes) return;
        for (const nb of nextNodes(path.length > 1 ? path[path.length - 2] : '', n)) {
            if (path.includes(nb)) continue;
            if (nb.startsWith('PR-') && nb !== to) continue;     // never pass through another pier
            path.push(nb); dfs(path); path.pop();
        }
    })([from]);
    return out;
}
function explainRoute(fromId, toId, plan) {
    const A = PIERS[fromId].pos, B = PIERS[toId].pos, straight = distMetres(A, B);
    const extra = plan.d - straight;
    const acA = 'AC-' + fromId.slice(3), acB = 'AC-' + toId.slice(3);
    const directLink = (ADJ[acA] || []).includes(acB);
    const crossed = GRAPH_EDGES.filter(([u, v]) => ![u, v].some(n => [fromId, toId, acA, acB].includes(n)) && segIntersect(A, B, WP[u], WP[v]))
        .map(([u, v]) => `${u.replace('AC-', '')}–${v.replace('AC-', '')}`);
    const rfz = RFZ_POLYS.filter(p => segmentHitsPoly(A, B, p)).map(p => rfzEN(p.name));
    const counts = currentEdgeCounts();
    const alts = corridorPaths(fromId, toId).map(p => ({ p, m: routeMetrics(p, counts) })).filter(x => x.m)
        .sort((a, b) => a.m.tTotal - b.m.tTotal);
    const chosen = plan.path.join('>');
    const short = p => p.slice(1, -1).map(n => n.replace('AC-', '')).join(' → ');
    const rows = alts.slice(0, 4).map(x => `<tr${x.p.join('>') === chosen ? ' style="color:#4ade80"' : ''}><td>${short(x.p)}</td><td>${(x.m.d / 1000).toFixed(2)}</td><td>${(x.m.tTotal / 60).toFixed(2)}</td><td>${x.p.join('>') === chosen ? 'chosen' : '+' + (x.m.tTotal - alts[0].m.tTotal).toFixed(0) + ' s'}</td></tr>`).join('');
    // split the extra distance: (a) going out to / coming in from the access fixes, (b) following corridor links between the fixes
    const spurs = distMetres(A, WP[acA]) + distMetres(WP[acB], B), fixStraight = distMetres(WP[acA], WP[acB]);
    const accessExtra = Math.max(0, spurs + fixStraight - straight), corridorExtra = Math.max(0, plan.d - spurs - fixStraight);
    const sec = m => (m / UAV.v_air).toFixed(0);
    const html = `<br><b>Why not a straight line?</b> Straight line ${straight.toFixed(0)} m · route ${plan.d.toFixed(0)} m (+${extra.toFixed(0)} m, +${(extra / straight * 100).toFixed(0)} %)
        <table class="tbl"><tr><th>Part of the extra distance</th><th>m</th><th>≈ s</th></tr>
        <tr><td>① Out to / in from the access fixes</td><td>${accessExtra.toFixed(0)}</td><td>${sec(accessExtra)}</td></tr>
        <tr><td>② Following corridor links between fixes</td><td>${corridorExtra.toFixed(0)}</td><td>${sec(corridorExtra)}</td></tr></table>
        ① Every UAV climbs above its pier and flies ~${(spurs / 2).toFixed(0)} m to an access fix over the water before cruising, and does the same in reverse at the destination. Cruising traffic therefore never passes over a landing pad, and a UAV can hold at the fix (≥ 80 m from the pad) if the pad is busy.<br>
        ② ${directLink ? `${acA} and ${acB} are directly linked, so between the fixes the route is almost straight.`
            : `There is no direct corridor between ${acA} and ${acB}: corridors mainly follow ferry routes and the coastline, so the route goes via ${plan.path.filter(n => n.startsWith('AC-')).slice(1, -1).map(n => n.slice(3)).join(', ') || 'the network'} (fix-to-fix straight ${fixStraight.toFixed(0)} m vs ${(plan.d - spurs).toFixed(0)} m flown).`}
        ${crossed.length ? `A straight line would also cross ${crossed.length} corridor link${crossed.length > 1 ? 's' : ''} (${crossed.join(', ')}), creating conflict points the network avoids.` : ''}
        ${rfz.length ? `It would also pass through: ${rfz.join(', ')}.` : ''}<br>
        <b>Alternatives</b> — A* picks the fastest of the ${alts.length} corridor routes under the current wind and traffic:
        <table class="tbl"><tr><th>Via</th><th>km</th><th>min</th><th></th></tr>${rows}</table>`;
    const summary = `+${extra.toFixed(0)} m vs straight line: ${accessExtra.toFixed(0)} m for entering / leaving via the access fixes, ${corridorExtra.toFixed(0)} m for following corridor links · fastest of ${alts.length} routes`;
    return { html, straight, summary };
}

// ---------- Analysis mode (hidden by default) ----------
let analysisOn = false;
function toggleAnalysis() {
    analysisOn = !analysisOn;
    toggleBtn('btnAnalysis', analysisOn);
    document.getElementById('analysisGroup').style.display = analysisOn ? 'block' : 'none';
    document.getElementById('btnAnalysis').querySelector('.txt').textContent = `Analysis mode: ${analysisOn ? 'ON' : 'OFF'}`;
}

// ---------- 15. HKO weather (live) ----------
let weatherTimer = null, hkoOn = false;
function toggleHKO() {
    hkoOn = !hkoOn; toggleBtn('btnHKO', hkoOn);
    if (hkoOn) fetchHKOWeather();
    else { clearInterval(weatherTimer); weatherTimer = null; closeCard('hko'); }
}
// Fetch with timeout; an empty body (HKO sends one when there is nothing to report) is returned as {}.
async function fetchJSON(url, ms = 10000) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
    try {
        const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const txt = (await r.text()).trim();
        return txt ? JSON.parse(txt) : {};
    } catch (e) { throw new Error(e.name === 'AbortError' ? 'timeout' : e.message); }
    finally { clearTimeout(timer); }
}
const HKO_API = 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?lang=en&dataType=';
function snapshotWeatherHTML(note) {
    return `<b>Updated:</b> snapshot<br><br><b>Temperature / humidity</b><div class="wx-grid">` +
        SNAPSHOT.weather.map(([n, t, h]) => `<span>${n}</span><span>${t} °C · ${h}%</span>`).join('') + `</div><br><span style="color:#fbbf24">${note}</span>`;
}
async function fetchHKOWeather() {
    if (dataMode === 'snapshot') {
        if (hkoOn) showInfo('HKO Real-time Weather', snapshotWeatherHTML('Offline snapshot — illustrative values, not live data.'), 250, 'hko');
        clearInterval(weatherTimer); weatherTimer = null; return;
    }
    const [rw, rr] = await Promise.allSettled([fetchJSON(HKO_API + 'rhrread'), fetchJSON(HKO_API + 'warningInfo')]);
    let html = '', src = '';
    const w = rw.status === 'fulfilled' ? rw.value : null;
    if (w && w.temperature?.data?.length) {
        src = 'HKO Open Data API (rhrread)';
        html += `<b>Updated:</b> ${(w.updateTime || '').replace('T', ' ').slice(0, 16)}<br><br><b>Temperature</b>`;
        html += '<div class="wx-grid">' + w.temperature.data.slice(0, 12).map(s => `<span>${s.place}</span><span>${s.value} °C</span>`).join('') + '</div>';
        if (w.humidity?.data?.length) html += `<br><b>Humidity</b> ${w.humidity.data.map(s => s.value + '%').join(', ')}<br>`;
        if (rr.status === 'fulfilled') {
            const det = rr.value.details || [];
            html += det.length ? `<br><b>Warnings:</b> ${det.map(x => x.warningStatementCode || x.subtype || '').join(', ')}` : '<br>No active warnings';
        } else html += '<br><span style="color:#94a3b8">Warning feed unavailable</span>';
    } else {
        // Fallback: Open-Meteo current temperature / humidity at the four harbour station sites
        const why = rw.status === 'rejected' ? rw.reason.message : 'no temperature data';
        addLog('HKO weather API failed (' + why + ') — using Open-Meteo', 'err');
        try {
            const lat = HKO_STATIONS.map(s => s.pos[0]).join(','), lon = HKO_STATIONS.map(s => s.pos[1]).join(',');
            const arr = await fetchJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m&timezone=Asia%2FHong_Kong`);
            const list = Array.isArray(arr) ? arr : [arr];
            src = `Open-Meteo model (fallback — HKO API not reachable: ${why})`;
            html += `<b>Updated:</b> ${(list[0].current?.time || '').replace('T', ' ')}<br><br><b>Temperature / humidity</b>`;
            html += '<div class="wx-grid">' + HKO_STATIONS.map((s, i) => `<span>${s.name}</span><span>${list[i].current.temperature_2m} °C · ${list[i].current.relative_humidity_2m}%</span>`).join('') + '</div>';
            html += '<br><span style="color:#94a3b8">Warnings: not available from fallback source</span>';
        } catch (e2) {
            src = '';
            html = snapshotWeatherHTML(`Live feeds not reachable (HKO: ${why}; Open-Meteo: ${e2.message}) — showing the offline snapshot, not live data.`);
            addLog('Open-Meteo weather failed: ' + e2.message, 'err');
        }
    }
    if (hkoOn) showInfo('HKO Real-time Weather', html + `<p class="note">${src ? src + ' · ' : ''}refresh 60 s</p>`, 250, 'hko');
    clearInterval(weatherTimer); if (hkoOn) weatherTimer = setInterval(fetchHKOWeather, 60000);
}

// ---------- 16. Start-up ----------
loadWind(false);
setInterval(() => loadWind(true), 600000);
// open with the corridor visible: piers and network on by default
toggleVertiports(); toggleWaypoints();
// Landmark names are only for orientation: shown from zoom 16 so they never sit on pier / helipad labels.
const landmarkLayer = L.layerGroup();
[['ICC', [22.3033, 114.1605]], ['IFC', [22.2852, 114.1566]], ['HKCEC', [22.2830, 114.1738]], ['Clock Tower', [22.2945, 114.1690]]].forEach(([n, p]) =>
    landmarkLayer.addLayer(L.marker(p, { interactive: false, icon: L.divIcon({ className: 'drone-icon', html: `<div style="color:rgba(255,255,255,0.55);font-size:9px;white-space:nowrap">${n}</div>`, iconSize: [80, 12], iconAnchor: [40, 6] }) })));
const syncLandmarks = () => { if (map.getZoom() >= 16) landmarkLayer.addTo(map); else map.removeLayer(landmarkLayer); };
map.on('zoomend', syncLandmarks); syncLandmarks();
addLog(`Network ready: ${Object.keys(PIERS).length} piers, ${CROSSINGS.length} crossing junction(s), ${GRAPH_EDGES.length} links`, 'ok');
