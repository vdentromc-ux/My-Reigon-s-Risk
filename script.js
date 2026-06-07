// My Region's Risk — script.js
// APIs: Nominatim (geocoding), USGS (earthquakes), NASA EONET (fires/floods/etc), NWS (alerts)

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
let members = JSON.parse(localStorage.getItem('mrr_members') || '[]');
let analysisYears = 5;
let cachedYears = 5;
let storedEarthquakes = [], storedNaturalEvents = [], storedAlerts = [];

// ── Utilities ─────────────────────────────────────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const r = x => x * Math.PI / 180;
  const dLat = r(lat2 - lat1), dLon = r(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLon/2)**2;
  return R_EARTH * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function showState(which) {
  ['emptyState','loadingState','errorState','mainContent','shareRow'].forEach(id => {
    document.getElementById(id).classList.add('hidden');
  });
  if (which === 'main') {
    document.getElementById('mainContent').classList.remove('hidden');
    document.getElementById('shareRow').classList.remove('hidden');
  } else {
    document.getElementById(which + 'State').classList.remove('hidden');
  }
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

async function setAnalysisYears(n) {
  n = Math.max(1, Math.min(20, Math.round(n)));
  if (!currentLocation) return;
  analysisYears = n;

  // Sync input and preset buttons
  document.getElementById('yrInput').value = n;
  document.querySelectorAll('.yr-btn').forEach(b => b.classList.toggle('active', +b.dataset.yr === n));

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
  const rankColors = { 1: '#ef476f', 2: '#ffd166', 3: '#4ecdc4' };
  document.getElementById('risksBody').innerHTML = risks.map(r => `
    <div class="risk-item">
      <div class="risk-rank rank-${r.rank}">${r.rank}</div>
      <div class="risk-info">
        <div class="risk-name">${r.icon} ${r.name}</div>
        <div class="risk-desc">${r.score} weighted event${r.score !== 1 ? 's' : ''} · ${analysisYears}-yr window</div>
      </div>
      <div class="risk-bar-wrap">
        <div class="risk-bar" style="width:${r.pct}%; background:${rankColors[r.rank]}"></div>
      </div>
    </div>`).join('');
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
    const items = g.items.map((item, i) => {
      const key = ckKey(g.type, i);
      const checked = localStorage.getItem(key) === '1';
      return `<div class="checklist-item">
        <input type="checkbox" class="kit-cb" id="${key}" data-key="${key}" ${checked ? 'checked' : ''} onchange="toggleItem(this)"/>
        <label class="cb-label ${checked ? 'done' : ''}" for="${key}">${item}</label>
      </div>`;
    }).join('');
    return `<div class="checklist-group">
      <div class="checklist-group-head">${g.icon} ${g.name}<span class="conf-badge ${cls}">${label}</span></div>
      <div class="checklist-reason">${g.reason}</div>
      ${items}
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
  document.getElementById('ckBar').style.width = pct + '%';
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
  updateChecklistProgress();
  renderTracker();
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
const MEMBER_ITEMS = ['Go-bag packed', 'Emergency contacts memorized', 'Evacuation route reviewed', 'Phone + charger ready'];

function memberItemKey(name, i) { return `mrr_mi_${name}_${i}`; }

function getMemberPct(name) {
  const checked = MEMBER_ITEMS.filter((_, i) => localStorage.getItem(memberItemKey(name, i)) === '1').length;
  return Math.round(checked / MEMBER_ITEMS.length * 100);
}

function renderTracker() {
  const grid = document.getElementById('trackerGrid');
  if (!members.length) {
    grid.innerHTML = '<div style="font-size:0.8rem; color:var(--text-dim);">No members added yet.</div>';
    return;
  }
  grid.innerHTML = members.map(name => {
    const pct = getMemberPct(name);
    const items = MEMBER_ITEMS.map((label, i) => {
      const key = memberItemKey(name, i);
      const ck = localStorage.getItem(key) === '1';
      return `<label class="member-item">
        <input type="checkbox" ${ck ? 'checked' : ''} onchange="toggleMemberItem('${name}',${i},this)"/>
        ${label}
      </label>`;
    }).join('');
    return `<div class="tracker-card">
      <div class="tracker-name-row">
        <span>${name}</span>
        <span class="tracker-pct">${pct}%</span>
        <button class="member-remove" onclick="removeMember('${name}')">×</button>
      </div>
      <div class="tracker-bar-bg"><div class="tracker-bar-fill" style="width:${pct}%"></div></div>
      <div class="member-items">${items}</div>
    </div>`;
  }).join('');
}

function toggleMemberItem(name, i, cb) {
  localStorage.setItem(memberItemKey(name, i), cb.checked ? '1' : '0');
  const pct = getMemberPct(name);
  for (const card of document.querySelectorAll('.tracker-card')) {
    if (card.querySelector('.tracker-name-row span')?.textContent === name) {
      card.querySelector('.tracker-pct').textContent = pct + '%';
      card.querySelector('.tracker-bar-fill').style.width = pct + '%';
      break;
    }
  }
}

function addMember() {
  const input = document.getElementById('memberInput');
  const name = input.value.trim();
  if (!name || members.includes(name)) return;
  members.push(name);
  localStorage.setItem('mrr_members', JSON.stringify(members));
  input.value = '';
  renderTracker();
}

function removeMember(name) {
  members = members.filter(m => m !== name);
  localStorage.setItem('mrr_members', JSON.stringify(members));
  renderTracker();
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

    showState('main');
    initMap(lat, lon);
    setupSlider(YEARS_BACK);

    // Reset picker to default on each new search
    document.getElementById('yrInput').value = YEARS_BACK;
    document.querySelectorAll('.yr-btn').forEach(b => b.classList.toggle('active', +b.dataset.yr === YEARS_BACK));
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
  document.getElementById('memberInput').addEventListener('keydown', e => { if (e.key === 'Enter') addMember(); });

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
