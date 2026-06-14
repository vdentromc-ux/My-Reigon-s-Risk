// My Region's Risk — script.js
// APIs: Nominatim (geocoding), USGS (earthquakes), NASA EONET (fires/floods/etc), NWS (alerts)

// Live family sync uses Y.js + WebRTC — no account or setup needed.

function pctColor(pct) {
  const hue = Math.round(pct * 1.2); // 0 → red (hsl 0), 100 → yellow-green (hsl 120)
  return `hsl(${hue}, 78%, 50%)`;
}

function setBar(el, pct) {
  if (!el) return;
  el.style.width = pct + '%';
  el.style.backgroundColor = pctColor(pct);
}

// ── Theme ─────────────────────────────────────────────────────────────────────
(function () {
  if (localStorage.getItem('mrr_theme') === 'light') {
    document.documentElement.classList.add('light');
    document.addEventListener('DOMContentLoaded', () => {
      document.getElementById('themeToggle').textContent = '🌙 Dark';
    });
  }
})();

function toggleTheme() {
  const isLight = document.documentElement.classList.toggle('light');
  localStorage.setItem('mrr_theme', isLight ? 'light' : 'dark');
  document.getElementById('themeToggle').textContent = isLight ? '🌙 Dark' : '☀️ Light';
}

const RADIUS_KM = 400;
const YEARS_BACK = 5;   // fetch window — never changes
const R_EARTH = 6371;

// ── State ────────────────────────────────────────────────────────────────────
let map = null;
let markerLayer = null;
let allEvents = [];
let sliderYears = [];
let playInterval = null;
let currentLocation = null;
let currentRisks = [];
let families = JSON.parse(localStorage.getItem('mrr_families') || '[]');
let analysisYears = 5;
let cachedYears = 5;
let analysisLabel = '5-yr';
let storedEarthquakes = [], storedNaturalEvents = [], storedAlerts = [];

// ── Utilities ─────────────────────────────────────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const r = x => x * Math.PI / 180;
  const dLat = r(lat2 - lat1), dLon = r(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLon/2)**2;
  return R_EARTH * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

let currentState = 'empty';

function showState(which) {
  currentState = which;
  ['emptyState','loadingState','errorState','mainContent','shareRow','checklistPage'].forEach(id => {
    document.getElementById(id)?.classList.add('hidden');
  });
  const backBtn = document.getElementById('backBtn');
  const checklistBtn = document.getElementById('checklistBtn');
  if (which === 'main') {
    document.getElementById('mainContent').classList.remove('hidden');
    document.getElementById('shareRow').classList.remove('hidden');
    backBtn.textContent = '← Back to Menu';
    backBtn.classList.remove('hidden');
    checklistBtn.classList.remove('hidden');
  } else if (which === 'checklist') {
    document.getElementById('checklistPage').classList.remove('hidden');
    backBtn.textContent = '← Results';
    backBtn.classList.remove('hidden');
    checklistBtn.classList.add('hidden');
  } else {
    document.getElementById(which + 'State').classList.remove('hidden');
    backBtn.classList.add('hidden');
    checklistBtn.classList.add('hidden');
  }
}

function fadeOutThen(ids, callback) {
  const els = ids.map(id => document.getElementById(id)).filter(el => el && !el.classList.contains('hidden'));
  let pending = els.length;
  if (!pending) { callback(); return; }
  els.forEach(el => {
    el.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    el.addEventListener('transitionend', function h() {
      el.removeEventListener('transitionend', h);
      el.style.transition = '';
      el.style.opacity = '';
      el.style.transform = '';
      if (--pending === 0) callback();
    });
  });
}

function enterPage(id, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

function showChecklistPage() {
  fadeOutThen(['mainContent', 'shareRow'], () => {
    showState('checklist');
    enterPage('checklistPage', 'page-enter-right');
  });
}

function backToMenu() {
  if (currentState === 'checklist') {
    fadeOutThen(['checklistPage'], () => {
      showState('main');
      enterPage('mainContent', 'page-enter-left');
    });
    return;
  }
  const fadeTargets = ['mainContent', 'shareRow'].map(id => document.getElementById(id)).filter(el => !el.classList.contains('hidden'));
  let pending = fadeTargets.length;

  function finish() {
    showState('empty');
    document.getElementById('locationPill').classList.add('hidden');
    document.getElementById('cityInput').value = '';
    const empty = document.getElementById('emptyState');
    const search = document.querySelector('.search-section');
    empty.classList.add('fade-in');
    search.classList.add('fade-in');
    empty.addEventListener('animationend', () => empty.classList.remove('fade-in'), { once: true });
    search.addEventListener('animationend', () => search.classList.remove('fade-in'), { once: true });
  }

  if (!pending) { finish(); return; }

  fadeTargets.forEach(el => {
    el.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    el.addEventListener('transitionend', function handler() {
      el.removeEventListener('transitionend', handler);
      el.style.transition = '';
      el.style.opacity = '';
      el.style.transform = '';
      if (--pending === 0) finish();
    });
  });
}

function showError(title, msg) {
  document.getElementById('errTitle').textContent = title;
  document.getElementById('errMsg').textContent = msg;
  showState('error');
}

// ── Geocoding (Nominatim) ─────────────────────────────────────────────────────
async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  const data = await res.json();
  if (!data.length) throw new Error('Location not found — try a different city name.');
  const r = data[0];
  return { lat: parseFloat(r.lat), lon: parseFloat(r.lon), name: r.display_name.split(',').slice(0, 3).join(', ') };
}

async function reverseGeocode(lat, lon) {
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
  const d = await res.json();
  return d.address?.city || d.address?.town || d.address?.county || 'Your Location';
}

// ── USGS Earthquakes ─────────────────────────────────────────────────────────
async function fetchUSGS(lat, lon, years = YEARS_BACK) {
  const end = new Date().toISOString().split('T')[0];
  const start = new Date(Date.now() - years * 365.25 * 86400000).toISOString().split('T')[0];
  const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${start}&endtime=${end}` +
    `&latitude=${lat}&longitude=${lon}&maxradiuskm=${RADIUS_KM}&minmagnitude=2.5&orderby=time&limit=500`;
  const res = await fetch(url);
  const data = await res.json();
  return (data.features || []).map(f => ({
    type: 'earthquake',
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    title: f.properties.title,
    mag: f.properties.mag,
    depth: f.geometry.coordinates[2],
    date: new Date(f.properties.time),
    year: new Date(f.properties.time).getFullYear(),
    url: f.properties.url,
  }));
}

// ── NASA EONET Natural Events ─────────────────────────────────────────────────
async function fetchEONET(lat, lon, years = YEARS_BACK) {
  const days = Math.round(years * 365);
  const url = `https://eonet.gsfc.nasa.gov/api/v3/events?status=all&days=${days}&limit=500`;
  const res = await fetch(url);
  const data = await res.json();
  const events = [];

  for (const ev of (data.events || [])) {
    let evLat = null, evLon = null;
    for (const g of (ev.geometry || [])) {
      if (g.type === 'Point') {
        [evLon, evLat] = g.coordinates;
        break;
      } else if (g.type === 'Polygon' && g.coordinates?.[0]?.length) {
        const pts = g.coordinates[0];
        evLon = pts.reduce((s, p) => s + p[0], 0) / pts.length;
        evLat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
        break;
      }
    }
    if (evLat === null || evLon === null) continue;
    if (haversineKm(lat, lon, evLat, evLon) > RADIUS_KM) continue;

    const catId = ev.categories?.[0]?.id || '';
    const typeMap = { wildfires: 'wildfire', floods: 'flood', volcanoes: 'volcano', severeStorms: 'storm', drought: 'drought' };
    const evType = typeMap[catId];
    if (!evType) continue;

    const dateStr = ev.geometry?.[0]?.date || ev.closed || null;
    const date = dateStr ? new Date(dateStr) : null;
    events.push({ type: evType, lat: evLat, lon: evLon, title: ev.title, date, year: date?.getFullYear() || null });
  }
  return events;
}

// ── NWS Active Alerts ─────────────────────────────────────────────────────────
async function fetchNWSAlerts(lat, lon) {
  try {
    const url = `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'MyRegionsRisk/1.0 (github.com/vDentro)' } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.features || []).map(f => ({
      type: 'alert',
      event: f.properties.event,
      headline: f.properties.headline,
      severity: f.properties.severity,
      areas: f.properties.areaDesc,
      sent: new Date(f.properties.sent),
      lat, lon,
    }));
  } catch { return []; }
}

// ── Risk Analysis ─────────────────────────────────────────────────────────────
const RISK_META = {
  earthquake:   { name: 'Earthquake',    icon: '🌋', color: '#4ecdc4' },
  wildfire:     { name: 'Wildfire',       icon: '🔥', color: '#ff6b35' },
  flood:        { name: 'Flood',          icon: '🌊', color: '#6495ed' },
  volcano:      { name: 'Volcano',        icon: '🌋', color: '#ef476f' },
  storm:        { name: 'Severe Storm',   icon: '⛈️', color: '#ffd166' },
  drought:      { name: 'Drought',        icon: '☀️', color: '#f4a261' },
  tornado:      { name: 'Tornado',        icon: '🌪️', color: '#a8dadc' },
  hurricane:    { name: 'Hurricane',      icon: '🌀', color: '#219ebc' },
  winter_storm: { name: 'Winter Storm',   icon: '❄️', color: '#90e0ef' },
  extreme_heat: { name: 'Extreme Heat',   icon: '🌡️', color: '#e76f51' },
  severe_weather:{ name: 'Severe Weather',icon: '⛈️', color: '#ffd166' },
};

function analyzeRisks(earthquakes, naturalEvents, alerts, years = analysisYears) {
  const cutoff = new Date(Date.now() - years * 365.25 * 86400000);
  const recentCutoff = new Date(Date.now() - 365 * 86400000);

  const eqs  = earthquakes.filter(ev => !ev.date || ev.date >= cutoff);
  const natEvs = naturalEvents.filter(ev => !ev.date || ev.date >= cutoff);

  const scores = {};
  const add = (type, w) => scores[type] = (scores[type] || 0) + w;

  eqs.forEach(ev => {
    const mag = ev.mag >= 6 ? 3 : ev.mag >= 5 ? 2 : 1;
    add('earthquake', mag * (ev.date > recentCutoff ? 2 : 1));
  });

  natEvs.forEach(ev => add(ev.type, ev.date && ev.date > recentCutoff ? 2 : 1));

  alerts.forEach(a => {
    const e = (a.event || '').toLowerCase();
    if      (e.includes('fire'))                        add('wildfire', 5);
    else if (e.includes('flood'))                       add('flood', 5);
    else if (e.includes('tornado'))                     add('tornado', 5);
    else if (e.includes('hurricane') || e.includes('tropical')) add('hurricane', 5);
    else if (e.includes('winter') || e.includes('snow') || e.includes('blizzard')) add('winter_storm', 5);
    else if (e.includes('heat'))                        add('extreme_heat', 5);
    else                                                add('severe_weather', 3);
  });

  // Ensure at least a baseline so the list is never empty
  ['earthquake', 'severe_weather', 'wildfire'].forEach(t => { if (!scores[t]) scores[t] = 1; });

  const maxScore = Math.max(...Object.values(scores));
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type, score], i) => ({
      rank: i + 1, type, score,
      pct: Math.round(score / maxScore * 100),
      ...(RISK_META[type] || { name: type, icon: '⚠️', color: '#aaa' }),
    }));
}

// ── Checklist data ────────────────────────────────────────────────────────────
const CHECKLISTS = {
  earthquake: {
    confidence: 'high', reason: 'Based on seismic activity detected in your area',
    items: [
      'Water — 1 gal/person/day for 3+ days','Non-perishable food (3-day supply)',
      'Flashlight + extra batteries','First aid kit with manual',
      'Wrench or pliers to shut off utilities','N95 dust masks',
      'Sturdy shoes for every household member','Emergency contact list (printed)',
      'Copies of documents in a waterproof bag','Know your home\'s gas/water shutoffs',
      'Anchor heavy furniture to walls','Identify safe spots in each room (under sturdy tables)',
    ],
  },
  wildfire: {
    confidence: 'high', reason: 'Wildfire events detected in your region',
    items: [
      'N95 masks for smoke inhalation','72-hr go-bag ready to grab',
      'Important docs in a fireproof container','Portable phone charger + cables',
      '30-day medication supply if possible','Know 2+ evacuation routes from home',
      'Register for local emergency alerts','ABC fire extinguisher (10 lb)',
      'Clear vegetation 30+ ft from structure','Cash in small bills',
      'Pet kit (food, water, vet records, carrier)','Paper map of your area',
    ],
  },
  flood: {
    confidence: 'high', reason: 'Flood events detected near your region',
    items: [
      'Waterproof bag for vital documents','Extra water (flooding contaminates supply)',
      'Sandbags or flood barriers for entry points','Battery/hand-crank weather radio',
      'Know your FEMA flood zone','Elevate electrical panels if flood-prone',
      'Sump pump with battery backup','Rubber boots + waterproof gloves',
      'Check for flood insurance (NFIP)','Waterproof tarp (8×10 ft min)',
      'Utility shutoff emergency contacts','Plastic sheeting + duct tape',
    ],
  },
  volcano: {
    confidence: 'high', reason: 'Volcanic activity detected near your region',
    items: [
      'Goggles to protect eyes from ash','N95+ masks (ash is a serious respiratory hazard)',
      'Long-sleeve clothing + long pants','Know local lava-flow evacuation zones',
      'Sign up for volcanic alert notifications','Plastic sheeting to seal vents from ash',
      '3-day water supply (ash contaminates water)','Dust masks for pets',
      'Extra HVAC air filters',
    ],
  },
  winter_storm: {
    confidence: 'high', reason: 'Winter storm risk or alerts detected',
    items: [
      'Road salt or sand for walkways','Snow shovel + vehicle ice scraper',
      'Warm layers (wool/synthetic — not cotton)','Emergency car kit (blanket, shovel, jumper cables)',
      'Backup heat source (CO-safe)','3-day food + water in case roads close',
      'Extra blankets + sleeping bags','Insulate exposed pipes',
      'Know hypothermia first aid','Check on elderly neighbors',
    ],
  },
  hurricane: {
    confidence: 'high', reason: 'Hurricane risk or alerts detected',
    items: [
      '7-day food + water supply (1 gal/person/day)','Portable power station or generator',
      'Hurricane shutters or plywood for windows','Know your storm surge zone + shelter',
      'Full gas tank before storm season','Trim trees near the structure',
      'NOAA Weather Radio (battery-powered)','Emergency cash',
      'Waterproof document storage','First aid kit + medications',
    ],
  },
  tornado: {
    confidence: 'high', reason: 'Tornado risk or alerts detected',
    items: [
      'Designated shelter room (interior, lowest floor, no windows)',
      'Helmet to protect from debris','Sturdy closed-toe shoes',
      'NOAA Weather Radio or reliable alert app','Practice a household tornado drill',
      'First aid kit','Battery backup for phone',
      'Know tornado watch vs. warning difference',
    ],
  },
  extreme_heat: {
    confidence: 'high', reason: 'Extreme heat alerts active in region',
    items: [
      'Fans, portable AC, or local cooling center locations','Electrolyte drinks / oral rehydration salts',
      'Light-colored loose clothing','Blackout curtains to reduce indoor heat',
      'Recognize heat stroke signs + treatment','Check on elderly + young children regularly',
      'Never leave people or pets in parked vehicles','SPF 30+ sunscreen',
      'Schedule outdoor activities for early morning',
    ],
  },
  storm: {
    confidence: 'med', reason: 'Storm events detected in region',
    items: [
      'Battery-powered weather radio','Surge protectors for electronics',
      '72-hr go-bag','First aid kit',
      '3-day food + water supply','Flashlight + extra batteries',
      'Know local shelter locations','Portable phone charger',
    ],
  },
  drought: {
    confidence: 'med', reason: 'Drought conditions detected in region',
    items: [
      'Water conservation plan (low-flow fixtures)','Rainwater collection system',
      'Drought-resistant landscaping','Know local water restrictions',
      'Large water storage containers','Fire-smart landscaping (drought raises fire risk)',
    ],
  },
  severe_weather: {
    confidence: 'med', reason: 'General severe weather risk for this region',
    items: [
      'Battery-powered weather radio','72-hr emergency go-bag',
      'First aid kit','Backup copies of important documents',
      'Know local emergency shelter locations','3-day food + water supply',
      'Flashlight + batteries','Portable phone charger',
    ],
  },
};

const UNIVERSAL = [
  'First aid kit with printed manual',
  'Copies of ID, insurance, and medical records',
  '72-hr go-bag per household member',
  'Printed emergency contact list',
  'Battery or hand-crank radio',
  'Portable phone charger',
];

// ── Analysis window picker ────────────────────────────────────────────────────
function applyYears(n) {
  const input = document.getElementById('yrInput');
  input.value = n;
  setAnalysisYears(n);
}

function applyDays(days) {
  if (!currentLocation) return;
  analysisYears = days / 365.25;
  analysisLabel = days === 1 ? '1-day' : days === 7 ? '7-day' : '30-day';
  document.querySelectorAll('.yr-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.period-btn').forEach(b =>
    b.classList.toggle('active', +b.dataset.days === days));
  const risks = analyzeRisks(storedEarthquakes, storedNaturalEvents, storedAlerts, analysisYears);
  renderRisks(risks);
  renderChecklist(risks);
}

async function setAnalysisYears(n) {
  n = Math.max(1, Math.min(20, Math.round(n)));
  if (!currentLocation) return;
  analysisYears = n;
  analysisLabel = n + '-yr';

  // Sync input and preset buttons
  document.getElementById('yrInput').value = n;
  document.querySelectorAll('.yr-btn').forEach(b => b.classList.toggle('active', +b.dataset.yr === n));
  document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));

  // Re-fetch if the requested window exceeds what we have cached
  if (n > cachedYears) {
    document.getElementById('risksBody').innerHTML =
      '<div style="font-size:0.83rem;color:var(--text-dim);padding:4px 0">Fetching extended data…</div>';
    const [eqs, natEvs] = await Promise.all([
      fetchUSGS(currentLocation.lat, currentLocation.lon, n),
      fetchEONET(currentLocation.lat, currentLocation.lon, n),
    ]);
    storedEarthquakes = eqs;
    storedNaturalEvents = natEvs;
    allEvents = [...eqs, ...natEvs];
    cachedYears = n;
  }

  setupSlider(n);
  const risks = analyzeRisks(storedEarthquakes, storedNaturalEvents, storedAlerts, n);
  renderRisks(risks);
  renderChecklist(risks);
}

// ── Render: Alerts ─────────────────────────────────────────────────────────────
function renderAlerts(alerts) {
  document.getElementById('statAlerts').textContent = alerts.length;
  const banner = document.getElementById('alertsBanner');
  if (!alerts.length) { banner.classList.add('hidden'); return; }
  banner.classList.remove('hidden');
  document.getElementById('alertsBody').innerHTML = alerts.slice(0, 3).map(a => `
    <div class="alert-entry">
      <div class="alert-headline">${a.event} — ${a.severity}</div>
      <div class="alert-area">${(a.areas || '').split(';')[0]}</div>
    </div>`).join('');
}

// ── Render: Risks ──────────────────────────────────────────────────────────────
function renderRisks(risks) {
  currentRisks = risks;
  document.getElementById('risksBody').innerHTML = risks.map(r => {
    const color = EVENT_COLORS[r.type] || '#8892a4';
    return `
    <div class="risk-item">
      <div class="risk-rank" style="background:${color}22; color:${color}">${r.rank}</div>
      <div class="risk-info">
        <div class="risk-name" style="color:${color}">${r.icon} ${r.name}</div>
        <div class="risk-desc">${r.score} weighted event${r.score !== 1 ? 's' : ''} · ${analysisLabel} window</div>
      </div>
      <div class="risk-bar-wrap">
        <div class="risk-bar" style="width:${r.pct}%; background:${color}"></div>
      </div>
    </div>`;
  }).join('');
}

// ── Render: Checklist ──────────────────────────────────────────────────────────
function ckKey(groupType, idx) {
  return `mrr_ck_${currentLocation?.name}_${groupType}_${idx}`;
}

function renderChecklist(risks) {
  const groups = risks.map(r => ({ ...CHECKLISTS[r.type], icon: r.icon, name: r.name, type: r.type }))
    .filter(g => g.items)
    .concat([{ icon: '🧰', name: 'Universal Essentials', type: 'universal', items: UNIVERSAL, confidence: 'high', reason: 'Applies to every emergency type' }]);

  const confMap = { high: ['conf-high','High confidence'], med: ['conf-med','Medium confidence'], low: ['conf-low','Low confidence'] };

  document.getElementById('checklistGrid').innerHTML = groups.map(g => {
    const [cls, label] = confMap[g.confidence] || ['conf-med','Medium confidence'];
    const checkedCount = g.items.filter((_, i) => localStorage.getItem(ckKey(g.type, i)) === '1').length;
    const initPct = g.items.length ? Math.round(checkedCount / g.items.length * 100) : 0;
    const items = g.items.map((item, i) => {
      const key = ckKey(g.type, i);
      const checked = localStorage.getItem(key) === '1';
      return `<div class="checklist-item">
        <input type="checkbox" class="kit-cb" id="${key}" data-key="${key}" ${checked ? 'checked' : ''} onchange="toggleItem(this)"/>
        <label class="cb-label ${checked ? 'done' : ''}" for="${key}">${item}</label>
      </div>`;
    }).join('');
    return `<div class="checklist-group" data-group="${g.type}">
      <div class="checklist-group-head">${g.icon} ${g.name}<span class="conf-badge ${cls}">${label}</span></div>
      <div class="checklist-reason">${g.reason}</div>
      ${items}
      <div class="ck-group-bar-wrap"><div class="ck-group-bar-fill" style="width:${initPct}%;background-color:${pctColor(initPct)}"></div></div>
      <button class="ck-reset-btn" onclick="resetGroup('${g.type}', ${g.items.length})">↺ Reset</button>
    </div>`;
  }).join('');
  updateChecklistProgress();
}

function updateChecklistProgress() {
  const all = document.querySelectorAll('#checklistGrid .kit-cb');
  const checkedCount = document.querySelectorAll('#checklistGrid .kit-cb:checked').length;
  if (!all.length) return;
  const pct = Math.round(checkedCount / all.length * 100);
  document.getElementById('ckPct').textContent = pct + '%';
  setBar(document.getElementById('ckBar'), pct);
}

function toggleItem(cb) {
  localStorage.setItem(cb.dataset.key, cb.checked ? '1' : '0');
  cb.nextElementSibling.classList.toggle('done', cb.checked);
  if (cb.checked) {
    const item = cb.parentElement;
    item.classList.remove('ck-pop');
    void item.offsetWidth;
    item.classList.add('ck-pop');
    item.addEventListener('animationend', () => item.classList.remove('ck-pop'), { once: true });
  }
  const group = cb.closest('.checklist-group');
  if (group) {
    const cbs = group.querySelectorAll('.kit-cb');
    const pct = Math.round(group.querySelectorAll('.kit-cb:checked').length / cbs.length * 100);
    setBar(group.querySelector('.ck-group-bar-fill'), pct);
  }
  updateChecklistProgress();
  renderTracker();
}

function resetGroup(type, count) {
  for (let i = 0; i < count; i++) localStorage.removeItem(ckKey(type, i));
  const group = document.querySelector(`.checklist-group[data-group="${type}"]`);
  if (!group) return;
  group.querySelectorAll('.kit-cb').forEach(cb => {
    cb.checked = false;
    cb.nextElementSibling.classList.remove('done');
  });
  setBar(group.querySelector('.ck-group-bar-fill'), 0);
  updateChecklistProgress();
}

// ── Map ────────────────────────────────────────────────────────────────────────
const EVENT_COLORS = { earthquake: '#4ecdc4', wildfire: '#ff6b35', flood: '#6495ed', volcano: '#ef476f', storm: '#ffd166', drought: '#f4a261' };
const BADGE_CLASSES = { earthquake: 'b-eq', wildfire: 'b-fire', flood: 'b-flood', volcano: 'b-vol', storm: 'b-storm' };

function initMap(lat, lon) {
  if (map) { map.remove(); map = null; }
  map = L.map('map').setView([lat, lon], 7);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19,
  }).addTo(map);
  L.circleMarker([lat, lon], { radius: 9, fillColor: '#fff', color: '#fff', weight: 2, fillOpacity: 0.9 })
    .addTo(map).bindPopup('<b>Your search location</b>');
}

function renderMapEvents(events) {
  if (markerLayer) { map.removeLayer(markerLayer); }
  markerLayer = L.layerGroup().addTo(map);
  const counts = {};

  for (const ev of events) {
    if (!ev.lat || !ev.lon) continue;
    counts[ev.type] = (counts[ev.type] || 0) + 1;
    const color = EVENT_COLORS[ev.type] || '#aaa';
    const r = ev.type === 'earthquake' ? Math.max(3, (ev.mag || 3) * 2) : 6;
    const dateStr = ev.date ? ev.date.toLocaleDateString() : 'Unknown date';
    const magLine = ev.mag != null ? `<br>Magnitude: <b>${ev.mag.toFixed(1)}</b>` : '';
    L.circleMarker([ev.lat, ev.lon], { radius: r, fillColor: color, color: color, weight: 1, fillOpacity: 0.55 })
      .bindPopup(`<div class="popup-title">${ev.title || ev.type}</div><div class="popup-detail">${dateStr}${magLine}</div>`)
      .addTo(markerLayer);
  }

  document.getElementById('statEq').textContent    = counts.earthquake || 0;
  document.getElementById('statFire').textContent  = counts.wildfire || 0;
  document.getElementById('statFlood').textContent = counts.flood || 0;
  document.getElementById('mapCount').textContent  = `— ${events.length} events`;
  document.getElementById('mapLegend').innerHTML = Object.entries(counts)
    .map(([t, n]) => `<span class="badge ${BADGE_CLASSES[t] || 'b-other'}">${t} (${n})</span>`).join('');
}

// ── Time Slider ────────────────────────────────────────────────────────────────
function windowEvents(years) {
  const cutoff = new Date(Date.now() - years * 365.25 * 86400000);
  return allEvents.filter(ev => !ev.date || ev.date >= cutoff);
}

function setupSlider(years) {
  if (playInterval) { clearInterval(playInterval); playInterval = null; document.getElementById('playBtn').textContent = '▶ Play'; }
  const curYear = new Date().getFullYear();
  sliderYears = Array.from({ length: years }, (_, i) => curYear - years + 1 + i);
  const slider = document.getElementById('timeSlider');
  slider.min = 0;
  slider.max = years;
  slider.value = years;
  document.getElementById('sliderRange').textContent = `${sliderYears[0]} – ${curYear}`;
  document.getElementById('timeDisplay').textContent = 'All Years';
  renderMapEvents(windowEvents(years));

  slider.oninput = () => {
    const idx = parseInt(slider.value);
    const year = idx < years ? sliderYears[idx] : null;
    document.getElementById('timeDisplay').textContent = year ? String(year) : 'All Years';
    const base = windowEvents(years);
    renderMapEvents(year === null ? base : base.filter(e => e.year === year));
  };
}

function togglePlay() {
  const btn = document.getElementById('playBtn');
  const slider = document.getElementById('timeSlider');

  if (playInterval) {
    // Pause — keep slider position
    clearInterval(playInterval); playInterval = null;
    btn.textContent = '▶ Resume'; return;
  }

  // If already at the end ("All Years" position), restart from the beginning
  if (parseInt(slider.value) >= analysisYears) {
    slider.value = 0;
    slider.dispatchEvent(new Event('input'));
  }

  btn.textContent = '⏸ Pause';
  playInterval = setInterval(() => {
    const next = parseInt(slider.value) + 1;
    if (next > analysisYears) {
      clearInterval(playInterval); playInterval = null;
      btn.textContent = '▶ Play'; return;
    }
    slider.value = next;
    slider.dispatchEvent(new Event('input'));
  }, 900);
}

// ── Household Tracker ─────────────────────────────────────────────────────────
const DEFAULT_TASKS = ['Go-bag packed', 'Emergency contacts memorized', 'Evacuation route reviewed', 'Phone + charger ready'];
let openEditorMember = null;

function saveFamilies() { localStorage.setItem('mrr_families', JSON.stringify(families)); }
function memberItemKey(name, label) { return `mrr_mi_${name}::${label}`; }
function getMemberTasks(name) { return JSON.parse(localStorage.getItem('mrr_tasks_' + name) || 'null') || DEFAULT_TASKS.slice(); }
function saveMemberTasks(name, tasks) { localStorage.setItem('mrr_tasks_' + name, JSON.stringify(tasks)); }

function getMemberPct(name) {
  const tasks = getMemberTasks(name);
  if (!tasks.length) return 0;
  const checked = tasks.filter(label => localStorage.getItem(memberItemKey(name, label)) === '1').length;
  return Math.round(checked / tasks.length * 100);
}

function getFamilyPct(fam) {
  if (!fam.members.length) return 0;
  return Math.round(fam.members.reduce((s, m) => s + getMemberPct(m), 0) / fam.members.length);
}

function renderMemberTaskEditor(name, tasks) {
  const safe = name.replace(/'/g, "\\'");
  const taskRows = tasks.length
    ? tasks.map((t, i) => `<div class="task-editor-item">
        <span class="task-editor-label">${t}</span>
        <button class="task-editor-del" onclick="removeMemberTask('${safe}',${i})">×</button>
      </div>`).join('')
    : '<div style="font-size:0.73rem;color:var(--text-dim);padding:2px 4px;">No tasks yet.</div>';
  return `<div class="member-task-editor-panel">
    <div class="task-editor-list">${taskRows}</div>
    <div class="task-add-row" style="margin-top:6px;">
      <input type="text" class="tracker-input member-task-input" data-member="${name}" placeholder="New task…" maxlength="50" style="padding:4px 8px;font-size:0.75rem;" onkeydown="if(event.key==='Enter')addMemberTask('${safe}')"/>
      <button class="btn btn-secondary" style="padding:4px 8px;font-size:0.75rem;" onclick="addMemberTask('${safe}')">+ Add</button>
    </div>
  </div>`;
}

function renderMemberCard(name, famId) {
  const tasks = getMemberTasks(name);
  const pct = getMemberPct(name);
  const safe = name.replace(/'/g, "\\'");
  const safeFam = famId.replace(/'/g, "\\'");
  const isEditing = openEditorMember === name;
  const statusClass = pct === 100 ? 'ready' : pct > 0 ? 'progress' : 'idle';
  const editorHtml = isEditing ? renderMemberTaskEditor(name, tasks) : '';
  const items = tasks.length
    ? tasks.map(label => {
        const ck = localStorage.getItem(memberItemKey(name, label)) === '1';
        const safeLabel = label.replace(/'/g, "\\'");
        return `<label class="member-item">
          <input type="checkbox" ${ck ? 'checked' : ''} onchange="toggleMemberItem('${safe}','${safeLabel}',this)"/>
          ${label}
        </label>`;
      }).join('')
    : '<div style="font-size:0.73rem;color:var(--text-dim);">No tasks — click ✏️ Edit to add.</div>';
  return `<div class="tracker-card" data-member="${name}">
    <div class="tracker-name-row">
      <span class="status-dot ${statusClass}"></span>
      <span>${name}</span>
      <span class="tracker-pct">${pct}%</span>
      <button class="member-edit-tasks${isEditing ? ' active' : ''}" onclick="toggleMemberTaskEditor('${safe}')">✏️ Edit</button>
      <button class="member-remove" onclick="removeMemberFromFamily('${safeFam}','${safe}')">×</button>
    </div>
    ${editorHtml}
    <div class="tracker-bar-bg"><div class="tracker-bar-fill" style="width:${pct}%;background-color:${pctColor(pct)}"></div></div>
    <div class="member-items">${items}</div>
    ${pct === 100 ? '<div class="member-ready-badge">✓ READY</div>' : ''}
  </div>`;
}

function renderTracker() {
  const grid = document.getElementById('trackerGrid');
  if (!families.length) {
    grid.innerHTML = '<div style="font-size:0.8rem;color:var(--text-dim);margin-bottom:4px;">No families yet — add one below.</div>';
    return;
  }
  grid.innerHTML = families.map(fam => {
    const famPct = getFamilyPct(fam);
    const safeFam = fam.id.replace(/'/g, "\\'");
    const memberCards = fam.members.length
      ? fam.members.map(m => renderMemberCard(m, fam.id)).join('')
      : '<div style="font-size:0.78rem;color:var(--text-dim);padding:0 4px;">No members yet.</div>';
    const liveHtml = fam.isLive && fam.code
      ? `<span class="live-badge">● LIVE</span><button class="code-btn" data-code="${fam.code}" onclick="copyFamilyCode('${fam.code}')" title="Click to copy invite code">📋 ${fam.code}</button>`
      : `<button class="go-live-btn" onclick="goLive('${safeFam}')">Go Live</button>`;
    return `<div class="family-section" data-family="${fam.id}">
      <div class="family-header">
        <span class="family-name">👨‍👩‍👧 ${fam.name}</span>
        ${liveHtml}
        <span class="family-pct">${famPct}% ready</span>
        <button class="family-remove" onclick="removeFamily('${safeFam}')">×</button>
      </div>
      <div class="family-bar-bg"><div class="family-bar-fill" style="width:${famPct}%;background-color:${pctColor(famPct)}"></div></div>
      <div class="family-members">${memberCards}</div>
      <div class="family-add-member">
        <input type="text" class="tracker-input family-member-input" data-family="${fam.id}" placeholder="Add member name…" maxlength="30" style="padding:5px 10px;font-size:0.8rem;" onkeydown="if(event.key==='Enter')addMemberToFamily('${safeFam}')"/>
        <button class="btn btn-secondary" style="padding:5px 10px;font-size:0.8rem;" onclick="addMemberToFamily('${safeFam}')">+ Add</button>
      </div>
    </div>`;
  }).join('');
}

function toggleMemberTaskEditor(name) {
  openEditorMember = openEditorMember === name ? null : name;
  renderTracker();
}

function addMemberTask(name) {
  const input = document.querySelector(`.member-task-input[data-member="${name}"]`);
  if (!input) return;
  const label = input.value.trim();
  if (!label) return;
  const tasks = getMemberTasks(name);
  if (tasks.includes(label)) return;
  tasks.push(label);
  saveMemberTasks(name, tasks);
  renderTracker();
}

function removeMemberTask(name, i) {
  const tasks = getMemberTasks(name);
  tasks.splice(i, 1);
  saveMemberTasks(name, tasks);
  renderTracker();
}

function toggleMemberItem(name, label, cb) {
  localStorage.setItem(memberItemKey(name, label), cb.checked ? '1' : '0');
  const pct = getMemberPct(name);
  const card = document.querySelector(`.tracker-card[data-member="${name}"]`);
  if (card) {
    card.querySelector('.tracker-pct').textContent = pct + '%';
    setBar(card.querySelector('.tracker-bar-fill'), pct);
    const dot = card.querySelector('.status-dot');
    if (dot) dot.className = 'status-dot ' + (pct === 100 ? 'ready' : pct > 0 ? 'progress' : 'idle');
    const badge = card.querySelector('.member-ready-badge');
    if (pct === 100 && !badge) {
      const el = document.createElement('div');
      el.className = 'member-ready-badge'; el.textContent = '✓ READY'; card.appendChild(el);
    } else if (pct < 100 && badge) badge.remove();
    const famSection = card.closest('.family-section');
    if (famSection) {
      const fam = families.find(f => f.id === famSection.dataset.family);
      if (fam) {
        const fp = getFamilyPct(fam);
        famSection.querySelector('.family-pct').textContent = fp + '% ready';
        setBar(famSection.querySelector('.family-bar-fill'), fp);
        if (!applyingRemote) pushProgressToYjs(fam, name);
      }
    }
  }
}

function addFamily() {
  const input = document.getElementById('familyInput');
  const name = input.value.trim();
  if (!name) return;
  families.push({ id: 'fam_' + Date.now(), name, members: [] });
  saveFamilies();
  input.value = '';
  renderTracker();
}

function removeFamily(id) {
  const fam = families.find(f => f.id === id);
  if (fam) {
    fam.members.forEach(m => localStorage.removeItem('mrr_tasks_' + m));
    if (fam.code && ydocs[fam.code]) {
      try { ydocs[fam.code].rtc.destroy(); ydocs[fam.code].idb.destroy(); } catch(e) {}
      delete ydocs[fam.code];
    }
  }
  families = families.filter(f => f.id !== id);
  saveFamilies();
  renderTracker();
}

function addMemberToFamily(famId) {
  const input = document.querySelector(`.family-member-input[data-family="${famId}"]`);
  if (!input) return;
  const name = input.value.trim();
  if (!name) return;
  const fam = families.find(f => f.id === famId);
  if (!fam || fam.members.includes(name)) return;
  fam.members.push(name);
  saveFamilies();
  if (!localStorage.getItem('mrr_tasks_' + name)) saveMemberTasks(name, DEFAULT_TASKS.slice());
  input.value = '';
  if (fam.isLive) pushMemberToYjs(fam, name);
  renderTracker();
}

function removeMemberFromFamily(famId, name) {
  const fam = families.find(f => f.id === famId);
  if (!fam) return;
  fam.members = fam.members.filter(m => m !== name);
  saveFamilies();
  localStorage.removeItem('mrr_tasks_' + name);
  if (openEditorMember === name) openEditorMember = null;
  renderTracker();
}

// ── Live Sync (Y.js + WebRTC — zero config, lazy-loaded) ───────────────────────
const ydocs = {};     // code → { doc, rtc, idb }
let applyingRemote = false;
let _yjsLoadPromise = null;

function ensureYjs() {
  if (_yjsLoadPromise) return _yjsLoadPromise;
  // Check if globals are already present (e.g. loaded by prior call)
  if (window.Y && window.yIndexeddb && window.yWebrtc) {
    return (_yjsLoadPromise = Promise.resolve(true));
  }
  _yjsLoadPromise = new Promise((resolve, reject) => {
    const srcs = [
      'https://unpkg.com/yjs@13/dist/yjs.umd.js',
      'https://unpkg.com/y-indexeddb@9/dist/y-indexeddb.umd.js',
      'https://unpkg.com/y-webrtc@10/dist/y-webrtc.umd.js',
    ];
    let done = 0;
    srcs.forEach(src => {
      const s = document.createElement('script');
      s.src = src;
      s.onload  = () => { if (++done === srcs.length) resolve(true); };
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  });
  return _yjsLoadPromise;
}

function generateCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

async function goLive(famId) {
  const fam = families.find(f => f.id === famId);
  if (!fam) return;
  if (!fam.code) { fam.code = generateCode(); fam.isLive = true; saveFamilies(); }
  renderTracker(); // show spinner/badge immediately
  try {
    await ensureYjs();
    startYjsSync(fam);
    renderTracker();
  } catch(e) {
    console.warn('Y.js load failed:', e);
    alert('Could not connect to real-time sync. Check your internet connection.');
  }
}

async function joinFamilyByCode(code) {
  const joinInput = document.getElementById('joinCodeInput');
  code = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (!code) return;
  if (families.some(f => f.code === code)) { alert('You are already in this family.'); return; }
  const id = 'fam_' + Date.now();
  const fam = { id, name: 'Joining…', members: [], isLive: true, code };
  families.push(fam);
  saveFamilies();
  if (joinInput) joinInput.value = '';
  renderTracker();
  try {
    await ensureYjs();
    startYjsSync(fam);
    renderTracker();
  } catch(e) {
    console.warn('Y.js load failed:', e);
    alert('Could not connect to real-time sync. Check your internet connection.');
  }
}

function startYjsSync(fam) {
  if (ydocs[fam.code]) return;
  const room = 'mrr-family-' + fam.code;
  const doc = new Y.Doc();
  const idb = new yIndexeddb.IndexeddbPersistence(room, doc);
  const rtc = new yWebrtc.WebrtcProvider(room, doc, {
    signaling: ['wss://signaling.yjs.dev', 'wss://y-webrtc-signal-eu.fly.dev']
  });
  ydocs[fam.code] = { doc, rtc, idb };

  const yMeta     = doc.getMap('meta');
  const yMembers  = doc.getArray('members');
  const yTasks    = doc.getMap('tasks');
  const yProgress = doc.getMap('progress');

  // Once IndexedDB has loaded local history, push our own state into the doc
  idb.on('synced', () => {
    doc.transact(() => {
      if (!yMeta.get('name')) yMeta.set('name', fam.name);
      fam.members.forEach(name => {
        if (!yMembers.toArray().includes(name)) yMembers.push([name]);
        yTasks.set(name, getMemberTasks(name));
        getMemberTasks(name).forEach(t => {
          const key = name + '::' + t;
          if (!yProgress.has(key))
            yProgress.set(key, localStorage.getItem(memberItemKey(name, t)) === '1');
        });
      });
    }, 'local');
    applyYjsToLocal(fam.id, doc);
  });

  // React to updates from remote peers
  doc.on('update', (_, origin) => {
    if (origin !== 'local') applyYjsToLocal(fam.id, doc);
  });
}

function applyYjsToLocal(famId, doc) {
  applyingRemote = true;
  try {
    const fam = families.find(f => f.id === famId);
    if (!fam) return;
    const yMeta     = doc.getMap('meta');
    const yMembers  = doc.getArray('members');
    const yTasks    = doc.getMap('tasks');
    const yProgress = doc.getMap('progress');
    const remoteName = yMeta.get('name');
    if (remoteName && remoteName !== 'Joining…') fam.name = remoteName;
    yMembers.toArray().forEach(name => {
      if (!fam.members.includes(name)) fam.members.push(name);
    });
    saveFamilies();
    fam.members.forEach(name => {
      const tasks = yTasks.get(name);
      if (tasks) saveMemberTasks(name, tasks);
      getMemberTasks(name).forEach(t => {
        localStorage.setItem(memberItemKey(name, t),
          yProgress.get(name + '::' + t) ? '1' : '0');
      });
    });
    renderTracker();
  } finally { applyingRemote = false; }
}

function pushProgressToYjs(fam, name) {
  if (!fam.isLive || !ydocs[fam.code] || applyingRemote) return;
  const { doc } = ydocs[fam.code];
  doc.transact(() => {
    getMemberTasks(name).forEach(t => {
      doc.getMap('progress').set(name + '::' + t,
        localStorage.getItem(memberItemKey(name, t)) === '1');
    });
  }, 'local');
}

function pushMemberToYjs(fam, name) {
  if (!fam.isLive || !ydocs[fam.code]) return;
  const { doc } = ydocs[fam.code];
  doc.transact(() => {
    const yMembers = doc.getArray('members');
    if (!yMembers.toArray().includes(name)) yMembers.push([name]);
    doc.getMap('tasks').set(name, getMemberTasks(name));
  }, 'local');
}

function copyFamilyCode(code) {
  navigator.clipboard.writeText(code).then(() => {
    const btn = document.querySelector(`.code-btn[data-code="${code}"]`);
    if (btn) { const orig = btn.textContent; btn.textContent = '✓ Copied!'; setTimeout(() => btn.textContent = orig, 1500); }
  });
}

// ── Main load flow ─────────────────────────────────────────────────────────────
async function loadRegion(lat, lon, name) {
  showState('loading');
  currentLocation = { lat, lon, name };

  const pill = document.getElementById('locationPill');
  pill.classList.remove('hidden');
  document.getElementById('pillName').textContent = name;
  document.getElementById('pillCoords').textContent = `${lat.toFixed(3)}, ${lon.toFixed(3)}`;

  try {
    const [earthquakes, naturalEvents, alerts] = await Promise.all([
      fetchUSGS(lat, lon),
      fetchEONET(lat, lon),
      fetchNWSAlerts(lat, lon),
    ]);

    storedEarthquakes = earthquakes;
    storedNaturalEvents = naturalEvents;
    storedAlerts = alerts;
    allEvents = [...earthquakes, ...naturalEvents];

    cachedYears = YEARS_BACK;
    analysisYears = YEARS_BACK;
    analysisLabel = YEARS_BACK + '-yr';

    showState('main');
    initMap(lat, lon);
    setupSlider(YEARS_BACK);

    // Reset picker to default on each new search
    document.getElementById('yrInput').value = YEARS_BACK;
    document.querySelectorAll('.yr-btn').forEach(b => b.classList.toggle('active', +b.dataset.yr === YEARS_BACK));
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('yrControl').dataset.loaded = '1';

    const risks = analyzeRisks(earthquakes, naturalEvents, alerts);
    renderRisks(risks);
    renderAlerts(alerts);
    renderChecklist(risks);
    renderTracker();
  } catch (err) {
    console.error(err);
    showError('Failed to load data', err.message || 'Check your connection and try again.');
  }
}

// ── Autocomplete ──────────────────────────────────────────────────────────────
let acDebounce = null;
let acActiveIdx = -1;
let acResults = [];

function closeSuggestions() {
  document.getElementById('suggestionsDrop').classList.add('hidden');
  acActiveIdx = -1;
}

function highlightItem(idx) {
  const items = document.querySelectorAll('.suggestion-item');
  items.forEach((el, i) => el.classList.toggle('active', i === idx));
  acActiveIdx = idx;
}

function formatSuggestion(r) {
  const parts = r.display_name.split(',').map(s => s.trim());
  const main = parts[0];
  const sub = parts.slice(1, 4).join(', ');
  const typeIcons = { city: '🏙️', town: '🏘️', village: '🏡', county: '🗺️', state: '📍', country: '🌍', suburb: '🏘️', municipality: '🏛️' };
  const icon = typeIcons[r.type] || typeIcons[r.addresstype] || '📍';
  return { main, sub, icon, lat: parseFloat(r.lat), lon: parseFloat(r.lon), fullName: parts.slice(0, 3).join(', ') };
}

async function fetchSuggestions(query) {
  if (query.length < 2) { closeSuggestions(); return; }
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=12&addressdetails=1&featuretype=settlement`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  const data = await res.json();
  acResults = data.map(formatSuggestion);
  renderSuggestions();
}

function renderSuggestions() {
  const drop = document.getElementById('suggestionsDrop');
  if (!acResults.length) { drop.classList.add('hidden'); return; }
  drop.innerHTML = acResults.map((s, i) => `
    <div class="suggestion-item" data-idx="${i}" onmousedown="pickSuggestion(${i})">
      <span class="sug-icon">${s.icon}</span>
      <div>
        <div class="sug-main">${s.main}</div>
        ${s.sub ? `<div class="sug-sub">${s.sub}</div>` : ''}
      </div>
    </div>`).join('');
  drop.classList.remove('hidden');
  acActiveIdx = -1;
}

function pickSuggestion(idx) {
  const s = acResults[idx];
  if (!s) return;
  document.getElementById('cityInput').value = s.main;
  closeSuggestions();
  loadRegion(s.lat, s.lon, s.fullName);
}

// ── Search / Geolocate ─────────────────────────────────────────────────────────
async function handleSearch() {
  const query = document.getElementById('cityInput').value.trim();
  if (!query) return;
  closeSuggestions();
  const btn = document.getElementById('searchBtn');
  btn.disabled = true;
  try {
    const loc = await geocode(query);
    await loadRegion(loc.lat, loc.lon, loc.name);
  } catch (err) {
    showError('Location not found', err.message);
  } finally {
    btn.disabled = false;
  }
}

function handleGeolocate() {
  if (!navigator.geolocation) { showError('Not supported', 'Your browser does not support geolocation.'); return; }
  const btn = document.getElementById('geoBtn');
  btn.disabled = true; btn.textContent = '📍 Locating…';
  navigator.geolocation.getCurrentPosition(
    async pos => {
      try {
        const { latitude: lat, longitude: lon } = pos.coords;
        const name = await reverseGeocode(lat, lon);
        document.getElementById('cityInput').value = name;
        await loadRegion(lat, lon, name);
      } catch (err) { showError('Failed to load data', err.message); }
      finally { btn.disabled = false; btn.textContent = '📍 Use My Location'; }
    },
    () => { btn.disabled = false; btn.textContent = '📍 Use My Location'; showError('Access denied', 'Allow location access or enter a city manually.'); }
  );
}

// ── Share / Save ───────────────────────────────────────────────────────────────
function shareResults() {
  if (!currentLocation) return;
  const url = new URL(window.location.href);
  url.searchParams.set('q', currentLocation.name);
  url.searchParams.set('lat', currentLocation.lat.toFixed(4));
  url.searchParams.set('lon', currentLocation.lon.toFixed(4));
  if (navigator.share) {
    navigator.share({ title: `Risk Report: ${currentLocation.name}`, url: url.toString() });
  } else {
    navigator.clipboard.writeText(url.toString()).then(() => {
      const btn = document.getElementById('shareBtn');
      const orig = btn.textContent;
      btn.textContent = '✓ Link copied!';
      setTimeout(() => btn.textContent = orig, 2200);
    });
  }
}

function saveReport() {
  if (!currentLocation) return;
  const risksText = currentRisks.map(r => `  ${r.rank}. ${r.name} (score: ${r.score})`).join('\n');
  const text = [
    "MY REGION'S RISK REPORT",
    `Generated: ${new Date().toLocaleDateString()}`,
    `Location:  ${currentLocation.name}`,
    '',
    'TOP 3 RISKS',
    risksText,
    '',
    `EVENT COUNTS (${analysisYears}-year window)`,
    `  Earthquakes:   ${document.getElementById('statEq').textContent}`,
    `  Wildfires:     ${document.getElementById('statFire').textContent}`,
    `  Floods:        ${document.getElementById('statFlood').textContent}`,
    `  Active Alerts: ${document.getElementById('statAlerts').textContent}`,
  ].join('\n');

  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })),
    download: `risk-report-${currentLocation.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.txt`,
  });
  a.click();
}

// ── Init ───────────────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  document.getElementById('familyInput').addEventListener('keydown', e => { if (e.key === 'Enter') addFamily(); });
  document.getElementById('joinCodeInput').addEventListener('keydown', e => { if (e.key === 'Enter') joinFamilyByCode(e.target.value); });
  // Reconnect any families that were already live (restores real-time sync on reload)
  const liveFamilies = families.filter(f => f.isLive && f.code);
  if (liveFamilies.length) {
    ensureYjs().then(() => {
      liveFamilies.forEach(startYjsSync);
      renderTracker();
    }).catch(e => console.warn('Y.js reconnect skipped:', e));
  }

  const yrInput = document.getElementById('yrInput');
  const commitYrInput = () => {
    const v = parseInt(yrInput.value);
    if (!isNaN(v)) setAnalysisYears(v);
  };
  yrInput.addEventListener('change', commitYrInput);
  yrInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commitYrInput(); yrInput.blur(); } });

  const cityInput = document.getElementById('cityInput');

  cityInput.addEventListener('input', () => {
    clearTimeout(acDebounce);
    const q = cityInput.value.trim();
    if (!q) { closeSuggestions(); return; }
    acDebounce = setTimeout(() => fetchSuggestions(q), 280);
  });

  cityInput.addEventListener('keydown', e => {
    const items = document.querySelectorAll('.suggestion-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlightItem(Math.min(acActiveIdx + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlightItem(Math.max(acActiveIdx - 1, -1));
    } else if (e.key === 'Enter') {
      if (acActiveIdx >= 0 && acResults[acActiveIdx]) {
        e.preventDefault();
        pickSuggestion(acActiveIdx);
      } else {
        handleSearch();
      }
    } else if (e.key === 'Escape') {
      closeSuggestions();
    }
  });

  cityInput.addEventListener('blur', () => setTimeout(closeSuggestions, 150));

  document.addEventListener('click', e => {
    if (!e.target.closest('.search-input-wrap')) closeSuggestions();
  });

  renderTracker();

  // Auto-load from shared URL
  const p = new URLSearchParams(window.location.search);
  const q = p.get('q'), lat = parseFloat(p.get('lat')), lon = parseFloat(p.get('lon'));
  if (q && !isNaN(lat) && !isNaN(lon)) {
    document.getElementById('cityInput').value = q;
    await loadRegion(lat, lon, q);
  }
});
