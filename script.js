'use strict';
/* =========================================================
   CLIMA · El clima, día a día
   - Búsqueda: OpenWeatherMap Geocoding (respaldo: Open-Meteo)
   - Pronóstico: Open-Meteo (actual, 48 h por hora, 16 días)
   - Calidad del aire: Open-Meteo Air Quality
   - Mapa: Leaflet + RainViewer (radar) + capas OpenWeatherMap
   ========================================================= */

// ---------- Configuración ----------
const OWM_KEY = 'c4381f22c73ec16dc79729cec227af4e';
const API = {
  geo: 'https://api.openweathermap.org/geo/1.0/direct',
  reverse: 'https://api.openweathermap.org/geo/1.0/reverse',
  omGeo: 'https://geocoding-api.open-meteo.com/v1/search',
  forecast: 'https://api.open-meteo.com/v1/forecast',
  air: 'https://air-quality-api.open-meteo.com/v1/air-quality',
  radar: 'https://api.rainviewer.com/public/weather-maps.json',
};
const DEFAULT_PLACE = { name: 'Buenos Aires', admin: 'Ciudad Autónoma de Buenos Aires', country: 'AR', lat: -34.6037, lon: -58.3816 };
const REFRESH_MS = 10 * 60 * 1000;
const HOURS_TODAY = 48;
const COL_W = 60;

const CURRENT_VARS = 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,uv_index,dew_point_2m';
const HOURLY_VARS = 'temperature_2m,relative_humidity_2m,dew_point_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,pressure_msl,cloud_cover,visibility,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,is_day';
const DAILY_VARS = 'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,sunrise,sunset,daylight_duration,sunshine_duration,uv_index_max,precipitation_sum,precipitation_hours,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant';
const AIR_VARS = 'us_aqi,european_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,ozone,sulphur_dioxide,dust,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen';

// ---------- Utilidades ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isNum = v => typeof v === 'number' && !Number.isNaN(v);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
const avg = arr => { const v = arr.filter(isNum); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const maxOf = arr => { const v = arr.filter(isNum); return v.length ? Math.max(...v) : null; };
const minOf = arr => { const v = arr.filter(isNum); return v.length ? Math.min(...v) : null; };
const sumOf = arr => arr.filter(isNum).reduce((a, b) => a + b, 0);

const store = {
  get(k, def) { try { const v = localStorage.getItem('clima.' + k); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem('clima.' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
  clear() { try { Object.keys(localStorage).filter(k => k.startsWith('clima.')).forEach(k => localStorage.removeItem(k)); } catch { /* nada */ } },
};

async function fetchJSON(url, timeout = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error((data && (data.reason || data.message)) || `Error ${r.status}`);
    return data;
  } finally { clearTimeout(t); }
}

let regionNames = null;
try { regionNames = new Intl.DisplayNames(['es'], { type: 'region' }); } catch { /* navegador viejo */ }
const countryName = cc => { if (!cc) return ''; try { return regionNames ? regionNames.of(cc.toUpperCase()) : cc; } catch { return cc; } };
const flag = cc => (cc && cc.length === 2) ? String.fromCodePoint(...[...cc.toUpperCase()].map(c => 127397 + c.charCodeAt(0))) : '🌍';
const placeId = p => `${(+p.lat).toFixed(3)},${(+p.lon).toFixed(3)}`;
const placeSub = p => [p.admin && p.admin !== p.name ? p.admin : '', countryName(p.country)].filter(Boolean).join(', ');

// ---------- Estado ----------
const state = {
  place: null,
  wx: null,
  air: null,
  fetchedAt: 0,
  settings: Object.assign({ temp: 'c', wind: 'kmh', pressure: 'hpa', precip: 'mm', fx: true }, store.get('settings', {})),
  favorites: store.get('favorites', []),
  recents: store.get('recents', []),
  favCurrent: {},
  dayIndex: 0,
  metric: 'temp',
  hourSel: null,
  loadSeq: 0,
};

// ---------- Unidades ----------
const U = {
  temp: c => state.settings.temp === 'f' ? c * 9 / 5 + 32 : c,
  t: c => isNum(c) ? Math.round(U.temp(c)) + '°' : '–',
  tU: c => isNum(c) ? Math.round(U.temp(c)) + (state.settings.temp === 'f' ? ' °F' : ' °C') : '–',
  tDelta: d => Math.round(state.settings.temp === 'f' ? d * 9 / 5 : d),
  tUnit: () => state.settings.temp === 'f' ? '°F' : '°C',
  wind: k => ({ kt: k / 1.852, ms: k / 3.6, mph: k / 1.609344 }[state.settings.wind] ?? k),
  w: k => isNum(k) ? String(Math.round(U.wind(k))) : '–',
  wU: k => isNum(k) ? `${Math.round(U.wind(k))} ${U.wUnit()}` : '–',
  wUnit: () => ({ kmh: 'km/h', kt: 'kt', ms: 'm/s', mph: 'mph' }[state.settings.wind]),
  p: h => !isNum(h) ? '–' : state.settings.pressure === 'mmhg' ? (h * 0.750062).toFixed(0) : state.settings.pressure === 'inhg' ? (h * 0.02953).toFixed(2) : Math.round(h).toString(),
  pUnit: () => ({ hpa: 'hPa', mmhg: 'mmHg', inhg: 'inHg' }[state.settings.pressure]),
  mm: m => !isNum(m) ? '–' : state.settings.precip === 'in' ? (m / 25.4).toFixed(2) : (m < 10 ? (Math.round(m * 10) / 10).toString() : Math.round(m).toString()),
  mmU: m => `${U.mm(m)} ${state.settings.precip === 'in' ? 'in' : 'mm'}`,
  km: m => !isNum(m) ? '–' : m >= 10000 ? `${Math.round(m / 1000)} km` : `${(m / 1000).toFixed(1)} km`,
};

// ---------- Tiempo (hora "de pared" del lugar) ----------
// Open-Meteo devuelve horas locales sin zona ("2026-11-08T18:00"). Las tratamos como UTC
// para que todos los cálculos sean independientes de la zona horaria del navegador.
function wall(s) {
  const [d, tm = '00:00'] = s.split('T');
  const [y, m, da] = d.split('-').map(Number);
  const [hh, mm] = tm.split(':').map(Number);
  return Date.UTC(y, m - 1, da, hh, mm);
}
const nowWall = () => Date.now() + (state.wx ? state.wx.off * 1000 : 0);
const fmtTime = ms => new Date(ms).toISOString().slice(11, 16);
const fmtDate = (ms, opts) => new Date(ms).toLocaleDateString('es-AR', { timeZone: 'UTC', ...opts });
const fmtDur = sec => { const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return h ? `${h} h ${m} min` : `${m} min`; };
function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'recién';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  return `hace ${Math.round(m / 60)} h`;
}
const dayLabel = i => i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : cap(fmtDate(state.wx.days[i].t, { weekday: 'long' }));

// ---------- Códigos del tiempo (WMO) ----------
const WMO = {
  0: ['Despejado', 'clear'], 1: ['Mayormente despejado', 'clear'], 2: ['Parcialmente nublado', 'partly'], 3: ['Nublado', 'cloudy'],
  45: ['Niebla', 'fog'], 48: ['Niebla con escarcha', 'fog'],
  51: ['Llovizna débil', 'drizzle'], 53: ['Llovizna', 'drizzle'], 55: ['Llovizna intensa', 'drizzle'],
  56: ['Llovizna helada', 'drizzle'], 57: ['Llovizna helada intensa', 'drizzle'],
  61: ['Lluvia débil', 'rain'], 63: ['Lluvia', 'rain'], 65: ['Lluvia intensa', 'heavy'],
  66: ['Lluvia helada', 'rain'], 67: ['Lluvia helada intensa', 'heavy'],
  71: ['Nevada débil', 'snow'], 73: ['Nevada', 'snow'], 75: ['Nevada intensa', 'snow'], 77: ['Granos de nieve', 'snow'],
  80: ['Chaparrones aislados', 'showers'], 81: ['Chaparrones', 'showers'], 82: ['Chaparrones violentos', 'heavy'],
  85: ['Chaparrones de nieve', 'snow'], 86: ['Chaparrones de nieve intensos', 'snow'],
  95: ['Tormenta', 'storm'], 96: ['Tormenta con granizo', 'storm'], 99: ['Tormenta fuerte con granizo', 'storm'],
};
const ICONS = {
  clear: ['fa-sun', 'fa-moon'], partly: ['fa-cloud-sun', 'fa-cloud-moon'], cloudy: ['fa-cloud', 'fa-cloud'],
  fog: ['fa-smog', 'fa-smog'], drizzle: ['fa-cloud-sun-rain', 'fa-cloud-moon-rain'], rain: ['fa-cloud-rain', 'fa-cloud-rain'],
  showers: ['fa-cloud-sun-rain', 'fa-cloud-moon-rain'], heavy: ['fa-cloud-showers-heavy', 'fa-cloud-showers-heavy'],
  snow: ['fa-snowflake', 'fa-snowflake'], storm: ['fa-cloud-bolt', 'fa-cloud-bolt'],
};
function wInfo(code, isDay = 1) {
  const [label, kind] = WMO[code] || ['Sin datos', 'cloudy'];
  return { label, kind, icon: ICONS[kind][isDay ? 0 : 1], night: !isDay };
}
function wIcon(code, isDay = 1, extra = '') {
  const w = wInfo(code, isDay);
  return `<i class="fas ${w.icon} wi wi-${w.kind}${w.night ? ' night' : ''} ${extra}" aria-hidden="true"></i>`;
}
const isStorm = c => c >= 95;
const isRainy = c => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;
const isSnowy = c => (c >= 71 && c <= 77) || c === 85 || c === 86;

// ---------- Escalas y textos ----------
const CARD = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
const CARD_LONG = { N: 'el norte', NE: 'el noreste', E: 'el este', SE: 'el sureste', S: 'el sur', SO: 'el suroeste', O: 'el oeste', NO: 'el noroeste' };
const cardinal = deg => isNum(deg) ? CARD[Math.round(deg / 22.5) % 16] : '–';
const cardinalLong = deg => isNum(deg) ? CARD_LONG[['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(deg / 45) % 8]] : '';

function beaufort(kmh) {
  const t = [[1, 'Calma'], [6, 'Ventolina'], [12, 'Brisa muy débil'], [20, 'Brisa débil'], [29, 'Brisa moderada'], [39, 'Brisa fresca'],
    [50, 'Brisa fuerte'], [62, 'Viento fuerte'], [75, 'Temporal'], [89, 'Temporal fuerte'], [103, 'Temporal duro'], [118, 'Temporal muy duro']];
  for (let i = 0; i < t.length; i++) if (kmh < t[i][0]) return { n: i, label: t[i][1] };
  return { n: 12, label: 'Huracán' };
}
function uvLevel(uv) {
  if (!isNum(uv)) return { label: 'Sin datos', color: '#888', tip: '' };
  if (uv < 3) return { label: 'Bajo', color: '#3ddc84', tip: 'No hace falta protección.' };
  if (uv < 6) return { label: 'Moderado', color: '#ffd166', tip: 'Usá protector solar y anteojos.' };
  if (uv < 8) return { label: 'Alto', color: '#ff9a4a', tip: 'Protector FPS 30+, gorra y sombra al mediodía.' };
  if (uv < 11) return { label: 'Muy alto', color: '#ff5a5f', tip: 'Evitá el sol entre las 11 y las 16.' };
  return { label: 'Extremo', color: '#b46cff', tip: 'Riesgo extremo: evitá exponerte al sol.' };
}
function aqiLevel(aqi) {
  if (!isNum(aqi)) return { label: 'Sin datos', color: '#888', tip: '' };
  if (aqi <= 50) return { label: 'Buena', color: '#3ddc84', tip: 'El aire está limpio. Ideal para actividades al aire libre.' };
  if (aqi <= 100) return { label: 'Moderada', color: '#ffd166', tip: 'Aceptable. Las personas muy sensibles podrían notar molestias.' };
  if (aqi <= 150) return { label: 'Mala para grupos sensibles', color: '#ff9a4a', tip: 'Personas con asma, niños y mayores: limitar el esfuerzo al aire libre.' };
  if (aqi <= 200) return { label: 'Mala', color: '#ff5a5f', tip: 'Todos pueden sentir efectos. Reducí la actividad física afuera.' };
  if (aqi <= 300) return { label: 'Muy mala', color: '#b46cff', tip: 'Alerta sanitaria: evitá actividades al aire libre.' };
  return { label: 'Peligrosa', color: '#7a1f3d', tip: 'Emergencia: permanecé en interiores.' };
}
function dewComfort(dp) {
  if (!isNum(dp)) return '';
  if (dp < 10) return 'Aire seco';
  if (dp < 13) return 'Muy agradable';
  if (dp < 16) return 'Agradable';
  if (dp < 18) return 'Algo húmedo';
  if (dp < 21) return 'Húmedo, se siente pesado';
  if (dp < 24) return 'Muy pesado';
  return 'Opresivo';
}
function visLabel(m) {
  if (!isNum(m)) return '';
  if (m >= 20000) return 'Excelente';
  if (m >= 10000) return 'Buena';
  if (m >= 4000) return 'Moderada';
  if (m >= 1000) return 'Reducida';
  return 'Muy reducida (niebla)';
}
function cloudLabel(c) {
  if (!isNum(c)) return '';
  if (c < 10) return 'Cielo limpio';
  if (c < 35) return 'Pocas nubes';
  if (c < 65) return 'Nubes dispersas';
  if (c < 90) return 'Mayormente cubierto';
  return 'Cubierto';
}
function tempColor(c) {
  // -10 °C azul → 40 °C rojo
  const f = clamp((c + 10) / 50, 0, 1);
  const hue = 230 - f * 230;
  return `hsl(${hue.toFixed(0)}, 85%, 62%)`;
}
function moonInfo(ms = Date.now()) {
  const syn = 29.530588853;
  const ref = Date.UTC(2000, 0, 6, 18, 14);
  const age = (((ms - ref) / 86400000) % syn + syn) % syn;
  const illum = (1 - Math.cos(2 * Math.PI * age / syn)) / 2;
  const phases = [[1.84566, 'Luna nueva', '🌑'], [5.53699, 'Luna creciente', '🌒'], [9.22831, 'Cuarto creciente', '🌓'], [12.91963, 'Gibosa creciente', '🌔'],
    [16.61096, 'Luna llena', '🌕'], [20.30228, 'Gibosa menguante', '🌖'], [23.99361, 'Cuarto menguante', '🌗'], [27.68493, 'Luna menguante', '🌘'], [99, 'Luna nueva', '🌑']];
  const [, name, emoji] = phases.find(p => age < p[0]);
  const toFull = (14.765 - age + syn) % syn;
  const toNew = syn - age;
  return { age, illum, name, emoji, toFull, toNew };
}
// Puntaje 0–10 para estar al aire libre
function hourScore(h) {
  let s = 10;
  s -= (h.pop || 0) / 100 * 4;
  s -= Math.min(3, (h.precip || 0) * 2);
  const t = isNum(h.feels) ? h.feels : h.temp;
  if (t < 18) s -= Math.min(4.5, (18 - t) / 3.5);
  if (t > 27) s -= Math.min(4.5, (t - 27) / 2.5);
  if (h.wind > 22) s -= Math.min(2.5, (h.wind - 22) / 10);
  if (h.uv >= 8) s -= 1;
  if (isStorm(h.code)) s -= 4;
  if (!h.isDay) s -= 1;
  return clamp(s, 0, 10);
}
const scoreColor = s => s >= 7.5 ? '#3ddc84' : s >= 5 ? '#ffd166' : s >= 3 ? '#ff9a4a' : '#ff5a5f';
const scoreLabel = s => s >= 8.5 ? 'Excelente' : s >= 7 ? 'Muy bueno' : s >= 5 ? 'Aceptable' : s >= 3 ? 'Regular' : 'Malo';

// ---------- APIs ----------
function normOWM(l) {
  return { name: (l.local_names && l.local_names.es) || l.name, admin: l.state || '', country: l.country || '', lat: l.lat, lon: l.lon };
}
function dedupe(list) {
  const seen = new Set();
  return list.filter(p => { const k = `${p.name}|${p.admin}|${p.country}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
async function searchPlaces(q, limit = 6) {
  try {
    const r = await fetchJSON(`${API.geo}?q=${encodeURIComponent(q)}&limit=${limit}&appid=${OWM_KEY}`, 8000);
    if (Array.isArray(r) && r.length) return dedupe(r.map(normOWM));
  } catch (e) { console.warn('OWM geocoding falló, uso Open-Meteo', e); }
  const r = await fetchJSON(`${API.omGeo}?name=${encodeURIComponent(q.split(',')[0].trim())}&count=${limit}&language=es`, 8000);
  return dedupe((r.results || []).map(l => ({ name: l.name, admin: l.admin1 || '', country: l.country_code || '', lat: l.latitude, lon: l.longitude })));
}
async function reversePlace(lat, lon) {
  try {
    const r = await fetchJSON(`${API.reverse}?lat=${lat}&lon=${lon}&limit=1&appid=${OWM_KEY}`, 8000);
    if (Array.isArray(r) && r.length) return { ...normOWM(r[0]), lat, lon };
  } catch (e) { console.warn('Reverse geocoding falló', e); }
  return { name: `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`, admin: '', country: '', lat, lon };
}
function fetchForecast(p) {
  const url = `${API.forecast}?latitude=${(+p.lat).toFixed(4)}&longitude=${(+p.lon).toFixed(4)}&current=${CURRENT_VARS}&hourly=${HOURLY_VARS}&daily=${DAILY_VARS}&timezone=auto&past_days=1&forecast_days=16`;
  return fetchJSON(url);
}
function fetchAir(p) {
  const url = `${API.air}?latitude=${(+p.lat).toFixed(4)}&longitude=${(+p.lon).toFixed(4)}&current=${AIR_VARS}&hourly=us_aqi,pm2_5&forecast_days=3&timezone=auto`;
  return fetchJSON(url);
}

// ---------- Modelo ----------
function buildModel(raw) {
  const H = raw.hourly, D = raw.daily, C = raw.current;
  const hours = H.time.map((time, i) => ({
    time, t: wall(time),
    temp: H.temperature_2m[i], feels: H.apparent_temperature[i], humidity: H.relative_humidity_2m[i], dew: H.dew_point_2m[i],
    pop: H.precipitation_probability[i], precip: H.precipitation[i], code: H.weather_code[i], pressure: H.pressure_msl[i],
    clouds: H.cloud_cover[i], vis: H.visibility[i], wind: H.wind_speed_10m[i], windDir: H.wind_direction_10m[i],
    gust: H.wind_gusts_10m[i], uv: H.uv_index[i], isDay: H.is_day[i],
  }));
  const allDays = D.time.map((date, i) => ({
    date, t: wall(date), code: D.weather_code[i], max: D.temperature_2m_max[i], min: D.temperature_2m_min[i],
    feelsMax: D.apparent_temperature_max[i], feelsMin: D.apparent_temperature_min[i],
    sunrise: D.sunrise[i] ? wall(D.sunrise[i]) : null, sunset: D.sunset[i] ? wall(D.sunset[i]) : null,
    daylight: D.daylight_duration[i], sunshine: D.sunshine_duration[i], uvMax: D.uv_index_max[i],
    precip: D.precipitation_sum[i], precipHours: D.precipitation_hours[i], pop: D.precipitation_probability_max[i],
    windMax: D.wind_speed_10m_max[i], gustMax: D.wind_gusts_10m_max[i], windDir: D.wind_direction_10m_dominant[i],
  }));
  const todayStr = C.time.slice(0, 10);
  let todayIdx = allDays.findIndex(d => d.date === todayStr);
  if (todayIdx < 0) todayIdx = 0;
  const days = allDays.slice(todayIdx);
  days.forEach(d => {
    d.hours = hours.filter(h => h.time.startsWith(d.date));
    const dayH = d.hours.filter(h => h.isDay);
    d.score = avg((dayH.length ? dayH : d.hours).map(hourScore));
    d.humidity = avg(d.hours.map(h => h.humidity));
  });
  return {
    off: raw.utc_offset_seconds, tz: raw.timezone, tzAbbr: raw.timezone_abbreviation, elevation: raw.elevation,
    current: {
      time: C.time, t: wall(C.time), temp: C.temperature_2m, feels: C.apparent_temperature, humidity: C.relative_humidity_2m,
      dew: C.dew_point_2m, isDay: C.is_day, precip: C.precipitation, code: C.weather_code, clouds: C.cloud_cover,
      pressure: C.pressure_msl, wind: C.wind_speed_10m, windDir: C.wind_direction_10m, gust: C.wind_gusts_10m,
      vis: C.visibility, uv: C.uv_index,
    },
    hours, days, yesterday: todayIdx > 0 ? allDays[todayIdx - 1] : null,
  };
}
function nowIdx() {
  const m = state.wx; const n = nowWall();
  const i = m.hours.findIndex(h => h.t + 3600e3 > n);
  return i < 0 ? m.hours.length - 1 : i;
}
function nextHours(n) { const i = nowIdx(); return state.wx.hours.slice(i, i + n); }
function hoursForView() {
  if (state.dayIndex === 0) return nextHours(HOURS_TODAY);
  return state.wx.days[state.dayIndex].hours;
}

// =========================================================
// CARGA
// =========================================================
async function loadPlace(place, { silent = false, keepDay = false } = {}) {
  const seq = ++state.loadSeq;
  state.lastAttempt = Date.now();
  const sameplace = state.place && placeId(state.place) === placeId(place);
  state.place = place;
  if (!silent) { document.body.classList.add('loading'); if (!state.wx || !sameplace) showSkeleton(); }
  $('#refreshBtn')?.classList.add('busy');
  try {
    const [raw, air] = await Promise.all([fetchForecast(place), fetchAir(place).catch(e => { console.warn('Aire no disponible', e); return null; })]);
    if (seq !== state.loadSeq) return;
    state.wx = buildModel(raw);
    state.air = air;
    state.fetchedAt = Date.now();
    if (!keepDay || !sameplace) { state.dayIndex = 0; state.hourSel = null; }
    renderAll();
    store.set('last', place);
    addRecent(place);
    updateURL();
    if (!silent) updateMapPlace();
  } catch (e) {
    console.error(e);
    if (seq !== state.loadSeq) return;
    if (silent && state.wx) { toast('No se pudo actualizar. Se muestran los últimos datos.'); return; }
    showError(e);
  } finally {
    if (seq === state.loadSeq) { document.body.classList.remove('loading'); $('#refreshBtn')?.classList.remove('busy'); }
  }
}

function showSkeleton() {
  $('#hero').innerHTML = '<div class="skeleton sk-title"></div><div class="skeleton sk-big"></div><div class="skeleton sk-line"></div><div class="skeleton sk-line short"></div>';
}
function showError(e) {
  const offline = !navigator.onLine;
  $('#hero').innerHTML = `
    <div class="error-box">
      <i class="fas ${offline ? 'fa-plug-circle-xmark' : 'fa-triangle-exclamation'}"></i>
      <h2>${offline ? 'Sin conexión' : 'No pudimos cargar el clima'}</h2>
      <p>${esc(offline ? 'Revisá tu conexión a internet e intentá de nuevo.' : (e && e.message) || 'Error desconocido')}</p>
      <button class="btn btn-primary" type="button" id="retryBtn"><i class="fas fa-rotate"></i> Reintentar</button>
    </div>`;
  $('#retryBtn').onclick = () => loadPlace(state.place || DEFAULT_PLACE);
}

// =========================================================
// RENDER
// =========================================================
function renderAll() {
  if (!state.wx) return;
  renderSky();
  renderHero();
  renderInsights();
  renderAlerts();
  renderHourly();
  renderDaily();
  renderDayDetail();
  renderTiles();
  renderAir();
  renderFavorites();
  const c = state.wx.current;
  document.title = `${U.t(c.temp)} ${state.place.name} · ${wInfo(c.code).label} | CLIMA`;
}

// ---------- Cielo y animación ----------
function skyKind(code) {
  const k = wInfo(code).kind;
  if (k === 'clear' || k === 'partly' || k === 'cloudy' || k === 'fog' || k === 'snow' || k === 'storm') return k;
  return 'rain';
}
const SKY_TOP = { clear: ['#1f7fd6', '#070d24'], partly: ['#2f74b5', '#0d1530'], cloudy: ['#4f6479', '#141a23'], rain: ['#2c3e50', '#0b1118'], storm: ['#15121f', '#15121f'], snow: ['#6f8ca8', '#1d2a3b'], fog: ['#6c767f', '#22282e'] };
function renderSky() {
  const c = state.wx.current;
  const kind = skyKind(c.code);
  const dn = c.isDay ? 'day' : 'night';
  $('#sky').className = `sky sky-${kind}-${dn}`;
  $('meta[name="theme-color"]').setAttribute('content', SKY_TOP[kind][c.isDay ? 0 : 1]);
  const k = wInfo(c.code).kind;
  let fx = 'none';
  if (k === 'storm') fx = 'storm';
  else if (k === 'heavy') fx = 'heavy';
  else if (k === 'rain' || k === 'showers') fx = 'rain';
  else if (k === 'drizzle') fx = 'drizzle';
  else if (k === 'snow') fx = 'snow';
  else if (k === 'fog') fx = 'fog';
  else if (!c.isDay && (k === 'clear' || k === 'partly')) fx = k === 'clear' ? 'stars' : 'fewstars';
  FX.set(fx, c.wind || 0);
}

// ---------- Hero ----------
function renderHero() {
  const m = state.wx, c = m.current, p = state.place, today = m.days[0];
  const w = wInfo(c.code, c.isDay);
  const fav = isFavorite(p);
  const i = nowIdx();
  const yest = m.hours[i - 24];
  let vs = '';
  if (yest && isNum(yest.temp) && isNum(c.temp)) {
    const d = c.temp - yest.temp;
    const dd = Math.abs(U.tDelta(d));
    vs = dd < 1
      ? '<i class="fas fa-equals"></i> Igual que ayer a esta hora'
      : `<i class="fas ${d > 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'}"></i> ${dd}° ${d > 0 ? 'más cálido' : 'más fresco'} que ayer a esta hora`;
  }
  $('#hero').innerHTML = `
    <div class="hero-top">
      <div>
        <h1 class="place">${esc(p.name)}</h1>
        <p class="place-sub">${flag(p.country)} ${esc(placeSub(p))}${placeSub(p) ? ' · ' : ''}<i class="far fa-clock"></i> <span id="clock">${fmtTime(nowWall())}</span> <span class="muted">(${esc(m.tzAbbr)})</span></p>
      </div>
      <div class="hero-actions">
        <button id="favBtn" class="icon-btn ${fav ? 'on' : ''}" type="button" title="${fav ? 'Quitar de favoritos' : 'Agregar a favoritos'}" aria-pressed="${fav}" aria-label="Favorito"><i class="${fav ? 'fas' : 'far'} fa-star"></i></button>
        <button id="shareBtn" class="icon-btn" type="button" title="Compartir" aria-label="Compartir"><i class="fas fa-share-nodes"></i></button>
        <button id="refreshBtn" class="icon-btn" type="button" title="Actualizar" aria-label="Actualizar"><i class="fas fa-rotate"></i></button>
      </div>
    </div>
    <div class="hero-main">
      <div class="hero-icon">${wIcon(c.code, c.isDay)}</div>
      <div class="hero-temp">${isNum(c.temp) ? Math.round(U.temp(c.temp)) : '–'}<sup>${U.tUnit()}</sup></div>
      <div>
        <p class="hero-desc">${w.label}</p>
        <p class="hero-meta">Sensación <b>${U.t(c.feels)}</b> · Máx <b>${U.t(today.max)}</b> · Mín <b>${U.t(today.min)}</b></p>
        ${vs ? `<p class="vs-yesterday">${vs}</p>` : ''}
      </div>
    </div>
    <div class="hero-stats">
      <div class="stat"><div class="lbl"><i class="fas fa-droplet"></i> Lluvia hoy</div><div class="val">${isNum(today.pop) ? today.pop + '%' : '–'} <small class="muted">${today.precip > 0 ? U.mmU(today.precip) : ''}</small></div></div>
      <div class="stat"><div class="lbl"><i class="fas fa-wind"></i> Viento</div><div class="val">${U.wU(c.wind)} <small class="muted">${cardinal(c.windDir)}</small></div></div>
      <div class="stat"><div class="lbl"><i class="fas fa-water"></i> Humedad</div><div class="val">${isNum(c.humidity) ? c.humidity + '%' : '–'}</div></div>
      <div class="stat"><div class="lbl"><i class="fas fa-sun"></i> UV</div><div class="val">${isNum(c.uv) ? Math.round(c.uv) : '–'} <small class="muted">${uvLevel(c.uv).label}</small></div></div>
    </div>
    <p class="updated"><span><i class="fas fa-satellite"></i> Actualizado <span id="updatedAgo">${ago(state.fetchedAt)}</span></span><span>${(+p.lat).toFixed(2)}°, ${(+p.lon).toFixed(2)}° · ${Math.round(m.elevation)} m s. n. m.</span></p>
  `;
  $('#favBtn').onclick = toggleFavorite;
  $('#shareBtn').onclick = share;
  $('#refreshBtn').onclick = () => loadPlace(state.place, { silent: true, keepDay: true }).then(() => toast('Datos actualizados'));
}

// ---------- Consejos ----------
function renderInsights() {
  const m = state.wx, c = m.current, today = m.days[0], tomorrow = m.days[1];
  const next24 = nextHours(24), next12 = nextHours(12);
  const items = [];

  // Lluvia
  const rainH = next24.find(h => (h.pop ?? 0) >= 50 || (h.precip ?? 0) >= 0.3);
  if (isRainy(c.code)) items.push({ cls: 'warn', ico: 'fa-umbrella', t: 'Llevá paraguas', d: `Está ${wInfo(c.code).label.toLowerCase()} ahora mismo.` });
  else if (rainH) items.push({ cls: 'warn', ico: 'fa-umbrella', t: 'Llevá paraguas', d: `Lluvia probable desde las ${fmtTime(rainH.t)} (${rainH.pop ?? '–'}%).` });
  else items.push({ cls: 'good', ico: 'fa-umbrella-beach', t: 'Sin lluvia a la vista', d: 'No se esperan lluvias en las próximas 24 horas.' });

  // Ropa
  const ft = isNum(c.feels) ? c.feels : c.temp;
  let cloth;
  if (ft < 0) cloth = 'Abrigo pesado, guantes, gorro y bufanda.';
  else if (ft < 8) cloth = 'Campera de abrigo y algo para el cuello.';
  else if (ft < 14) cloth = 'Buzo o campera liviana.';
  else if (ft < 20) cloth = 'Manga larga o una campera finita.';
  else if (ft < 27) cloth = 'Remera, cómodo y fresco.';
  else cloth = 'Ropa bien fresca, gorra y mucha agua.';
  if ((c.wind ?? 0) > 30 || (c.gust ?? 0) > 50) cloth += ' Sumá un rompeviento.';
  if (isNum(today.max) && isNum(today.min) && today.max - today.min >= 12) cloth += ' Hay mucha amplitud térmica: vestite en capas.';
  items.push({ cls: 'info', ico: 'fa-shirt', t: '¿Qué me pongo?', d: cloth });

  // UV
  const uvHours = today.hours.filter(h => (h.uv ?? 0) >= 3);
  if (uvHours.length) {
    const lvl = uvLevel(today.uvMax);
    items.push({ cls: today.uvMax >= 8 ? 'bad' : 'warn', ico: 'fa-sun', t: `UV ${lvl.label.toLowerCase()} (máx ${Math.round(today.uvMax)})`, d: `Protector solar de ${fmtTime(uvHours[0].t)} a ${fmtTime(uvHours[uvHours.length - 1].t + 3600e3)}.` });
  }

  // Mejor momento para salir
  const daylight = next12.filter(h => h.isDay);
  const pool = daylight.length >= 2 ? daylight : next12;
  if (pool.length) {
    const best = pool.reduce((a, b) => hourScore(b) > hourScore(a) ? b : a);
    const sc = hourScore(best);
    items.push({ cls: sc >= 6 ? 'good' : 'warn', ico: 'fa-person-running', t: `Mejor momento para salir: ${fmtTime(best.t)}`, d: `${scoreLabel(sc)} (${sc.toFixed(1)}/10): ${U.t(best.temp)}, ${wInfo(best.code, best.isDay).label.toLowerCase()}${best.pop ? `, ${best.pop}% lluvia` : ''}.` });
  }

  // Ropa tendida
  const dayHrs = today.hours.filter(h => h.isDay && h.t + 3600e3 > nowWall());
  if (dayHrs.length >= 3) {
    const wet = maxOf(dayHrs.map(h => h.pop ?? 0)) > 30;
    const hum = avg(dayHrs.map(h => h.humidity));
    const good = !wet && hum < 65;
    items.push({ cls: good ? 'good' : 'info', ico: 'fa-jug-detergent', t: good ? 'Buen día para tender la ropa' : 'Mejor no tender la ropa', d: good ? `Humedad media ${Math.round(hum)}% y sin lluvia.` : (wet ? 'Puede llover en las próximas horas.' : `Humedad alta (${Math.round(hum)}%): va a tardar en secar.`) });
  }

  // Hora dorada
  if (today.sunset && today.sunset > nowWall()) {
    items.push({ cls: 'info', ico: 'fa-camera', t: 'Hora dorada', d: `De ${fmtTime(today.sunset - 3600e3)} a ${fmtTime(today.sunset)}, ideal para fotos. Hora azul hasta las ${fmtTime(today.sunset + 30 * 60e3)}.` });
  } else if (tomorrow?.sunrise) {
    items.push({ cls: 'info', ico: 'fa-camera', t: 'Hora dorada de mañana', d: `Amanece a las ${fmtTime(tomorrow.sunrise)}. Luz dorada hasta las ${fmtTime(tomorrow.sunrise + 3600e3)}.` });
  }

  // Mañana
  if (tomorrow && isNum(tomorrow.max) && isNum(today.max)) {
    const d = U.tDelta(tomorrow.max - today.max);
    const txt = Math.abs(d) < 1 ? 'Temperatura similar a hoy' : `${Math.abs(d)}° ${d > 0 ? 'más calor' : 'más fresco'} que hoy`;
    items.push({ cls: 'info', ico: 'fa-calendar-day', t: `Mañana: ${U.t(tomorrow.min)} / ${U.t(tomorrow.max)}`, d: `${txt}. ${wInfo(tomorrow.code).label}${tomorrow.pop >= 30 ? `, ${tomorrow.pop}% de lluvia` : ''}.` });
  }

  const sc = today.score ?? 0;
  $('#insights').innerHTML = `
    <h2 class="card-title"><i class="fas fa-wand-magic-sparkles"></i> Consejos para hoy</h2>
    <div class="score-box">
      <div class="score-ring" style="--v:${(sc * 10).toFixed(0)};--c:${scoreColor(sc)}"><span>${sc.toFixed(1)}</span></div>
      <div><strong>Día para estar afuera: ${scoreLabel(sc)}</strong><p>Puntaje según temperatura, lluvia, viento y UV durante las horas de luz.</p></div>
    </div>
    <div class="insight-list">
      ${items.map(it => `<div class="insight ${it.cls}"><div class="ins-ico"><i class="fas ${it.ico}"></i></div><div><strong>${esc(it.t)}</strong><p>${esc(it.d)}</p></div></div>`).join('')}
    </div>`;
}

// ---------- Alertas ----------
function renderAlerts() {
  const m = state.wx, out = [];
  const n24 = nextHours(24);
  const storm = n24.find(h => isStorm(h.code));
  if (storm) out.push({ sev: 3, ico: 'fa-cloud-bolt', t: 'Tormentas', d: `Posibles tormentas desde las ${fmtTime(storm.t)}${storm.code >= 96 ? ', con riesgo de granizo' : ''}.` });
  const gust = n24.reduce((a, h) => (h.gust ?? 0) > (a?.gust ?? 0) ? h : a, null);
  if (gust && gust.gust >= 60) out.push({ sev: gust.gust >= 80 ? 3 : 2, ico: 'fa-wind', t: 'Ráfagas fuertes', d: `Ráfagas de hasta ${U.wU(gust.gust)} cerca de las ${fmtTime(gust.t)}.` });
  m.days.slice(0, 3).forEach((d, i) => {
    const when = i === 0 ? 'hoy' : i === 1 ? 'mañana' : fmtDate(d.t, { weekday: 'long' });
    if (isNum(d.feelsMax) && d.feelsMax >= 35) out.push({ sev: d.feelsMax >= 40 ? 3 : 2, ico: 'fa-temperature-arrow-up', t: 'Calor extremo', d: `Sensación térmica de hasta ${U.t(d.feelsMax)} ${when}. Hidratate y evitá el sol fuerte.` });
    if (isNum(d.min) && d.min <= 0) out.push({ sev: d.min <= -5 ? 3 : 1, ico: 'fa-snowflake', t: 'Heladas', d: `Mínima de ${U.t(d.min)} ${when}. Protegé plantas y cañerías.` });
    if (isNum(d.precip) && d.precip >= 30) out.push({ sev: d.precip >= 60 ? 3 : 2, ico: 'fa-cloud-showers-water', t: 'Lluvias abundantes', d: `Se esperan ${U.mmU(d.precip)} ${when}.` });
  });
  const fog = nextHours(12).find(h => isNum(h.vis) && h.vis < 1000);
  if (fog) out.push({ sev: 1, ico: 'fa-smog', t: 'Niebla', d: `Visibilidad menor a 1 km cerca de las ${fmtTime(fog.t)}. Precaución al manejar.` });
  if ((m.days[0].uvMax ?? 0) >= 11) out.push({ sev: 2, ico: 'fa-sun', t: 'UV extremo', d: 'Índice UV 11+ hoy. Evitá el sol del mediodía.' });
  const aqi = state.air?.current?.us_aqi;
  if (isNum(aqi) && aqi > 150) out.push({ sev: aqi > 200 ? 3 : 2, ico: 'fa-mask-face', t: 'Mala calidad del aire', d: `ICA ${aqi}: ${aqiLevel(aqi).tip}` });

  // Una sola alerta por tipo (la más severa)
  const byType = {};
  out.forEach(a => { if (!byType[a.t] || byType[a.t].sev < a.sev) byType[a.t] = a; });
  $('#alerts').innerHTML = Object.values(byType).sort((a, b) => b.sev - a.sev)
    .map(a => `<div class="alert sev-${a.sev}" role="alert"><i class="fas ${a.ico}"></i><div><strong>${esc(a.t)}</strong>${esc(a.d)}</div></div>`).join('');
}

// ---------- Por hora (gráfico + columnas) ----------
const METRICS = {
  temp: { series: [{ k: 'temp', color: '#ffd166', area: true }, { k: 'feels', color: 'rgba(255,255,255,.55)', dash: true }], fmt: v => U.t(v), legend: 'Línea: temperatura · punteada: sensación térmica' },
  rain: { series: [{ k: 'pop', color: '#4fc3ff', bar: true }], min: 0, max: 100, fmt: v => v + '%', sub: h => h.precip > 0 ? U.mm(h.precip) : '', legend: 'Barras: probabilidad de lluvia · abajo: milímetros' },
  wind: { series: [{ k: 'wind', color: '#7ee0c3', area: true }, { k: 'gust', color: 'rgba(255,255,255,.55)', dash: true }], min: 0, fmt: v => U.w(v), legend: () => `Línea: viento (${U.wUnit()}) · punteada: ráfagas` },
  humidity: { series: [{ k: 'humidity', color: '#6cc4ff', area: true }], min: 0, max: 100, fmt: v => v + '%', legend: 'Humedad relativa' },
  uv: { series: [{ k: 'uv', bar: true, colorFn: v => uvLevel(v).color }], min: 0, minMax: 8, fmt: v => Math.round(v), legend: 'Índice UV' },
  clouds: { series: [{ k: 'clouds', color: 'rgba(230,236,245,.8)', bar: true }], min: 0, max: 100, fmt: v => v + '%', legend: 'Nubosidad' },
  pressure: { series: [{ k: 'pressure', color: '#c3a6ff', area: true }], fmt: v => U.p(v), legend: () => `Presión (${U.pUnit()})` },
};
function smoothPath(pts) {
  if (!pts.length) return '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}
function chartSVG(hours, metricKey) {
  const M = METRICS[metricKey];
  const W = hours.length * COL_W, Ht = 130, top = 24, bottom = M.sub ? 22 : 10;
  const vals = M.series.flatMap(s => hours.map(h => h[s.k])).filter(isNum);
  let lo = M.min ?? (vals.length ? Math.min(...vals) : 0);
  let hi = M.max ?? (vals.length ? Math.max(...vals) : 1);
  if (M.minMax) hi = Math.max(hi, M.minMax);
  if (M.min == null || M.max == null) { const pad = (hi - lo) * 0.15 || 1; if (M.min == null) lo -= pad; if (M.max == null) hi += pad; }
  const y = v => top + (1 - (v - lo) / (hi - lo || 1)) * (Ht - top - bottom);
  const x = i => i * COL_W + COL_W / 2;
  let svg = `<svg width="${W}" height="${Ht}" viewBox="0 0 ${W} ${Ht}" role="img" aria-label="${esc(typeof M.legend === 'function' ? M.legend() : M.legend)}">
    <defs><linearGradient id="gArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${M.series[0].color || '#fff'}" stop-opacity=".45"/><stop offset="1" stop-color="${M.series[0].color || '#fff'}" stop-opacity="0"/></linearGradient></defs>`;
  [0.25, 0.5, 0.75].forEach(f => { const yy = top + f * (Ht - top - bottom); svg += `<line class="chart-grid" x1="0" x2="${W}" y1="${yy}" y2="${yy}"/>`; });
  // Línea de medianoche
  hours.forEach((h, i) => { if (i > 0 && h.time.endsWith('T00:00')) svg += `<line class="chart-now" x1="${i * COL_W}" x2="${i * COL_W}" y1="0" y2="${Ht}" opacity=".5"/>`; });

  M.series.forEach((s, si) => {
    if (s.bar) {
      hours.forEach((h, i) => {
        const v = h[s.k]; if (!isNum(v)) return;
        const yy = y(v), base = y(lo), bw = COL_W * 0.46;
        const col = s.colorFn ? s.colorFn(v) : s.color;
        svg += `<rect x="${x(i) - bw / 2}" y="${Math.min(yy, base - 2)}" width="${bw}" height="${Math.max(2, base - yy)}" rx="4" fill="${col}" opacity="${v === 0 ? .35 : .85}"/>`;
      });
    } else {
      const pts = hours.map((h, i) => isNum(h[s.k]) ? [x(i), y(h[s.k])] : null).filter(Boolean);
      if (pts.length < 2) return;
      const d = smoothPath(pts);
      if (s.area) svg += `<path d="${d} L${pts[pts.length - 1][0]},${Ht - bottom} L${pts[0][0]},${Ht - bottom} Z" fill="url(#gArea)"/>`;
      svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.dash ? 1.6 : 2.6}" ${s.dash ? 'stroke-dasharray="4 4"' : ''} stroke-linecap="round" stroke-linejoin="round"/>`;
      if (si === 0) hours.forEach((h, i) => { if (isNum(h[s.k])) svg += `<circle cx="${x(i)}" cy="${y(h[s.k])}" r="3" fill="${s.color}" stroke="rgba(10,20,40,.6)" stroke-width="1.5"/>`; });
    }
  });
  // Etiquetas de valor
  const main = M.series[0];
  hours.forEach((h, i) => {
    const v = h[main.k]; if (!isNum(v)) return;
    svg += `<text class="chart-label" x="${x(i)}" y="${Math.max(12, y(v) - 9)}">${esc(M.fmt(v))}</text>`;
    if (M.sub) { const s = M.sub(h); if (s) svg += `<text class="chart-label sub" x="${x(i)}" y="${Ht - 6}">${esc(s)}</text>`; }
  });
  return svg + '</svg>';
}
function renderHourly() {
  const m = state.wx;
  const hours = hoursForView();
  const title = state.dayIndex === 0 ? `Próximas ${hours.length} horas` : `${dayLabel(state.dayIndex)} ${fmtDate(m.days[state.dayIndex].t, { day: 'numeric', month: 'long' })}, hora por hora`;
  $('#hourlyTitle').textContent = title;
  const firstNow = state.dayIndex === 0;
  const sunEvents = m.days.flatMap(d => [d.sunrise && { t: d.sunrise, up: true }, d.sunset && { t: d.sunset, up: false }]).filter(Boolean);

  const cols = hours.map((h, i) => {
    const isNow = firstNow && i === 0;
    const sun = sunEvents.find(e => e.t >= h.t && e.t < h.t + 3600e3);
    const midnight = h.time.endsWith('T00:00') && i > 0;
    const dayName = midnight ? fmtDate(h.t, { weekday: 'short' }) : '';
    return `<button type="button" class="hcol${h.isDay ? '' : ' night-col'}${midnight ? ' day-start' : ''}${state.hourSel === h.time ? ' selected' : ''}" style="width:${COL_W}px" data-time="${h.time}" aria-label="${fmtTime(h.t)}, ${U.t(h.temp)}, ${wInfo(h.code, h.isDay).label}">
      ${dayName ? `<span class="h-day">${esc(dayName)}</span>` : ''}
      <span class="h-time${isNow ? ' now' : ''}">${isNow ? 'Ahora' : fmtTime(h.t)}</span>
      <span class="h-ico">${wIcon(h.code, h.isDay)}</span>
      <span class="h-pop">${(h.pop ?? 0) >= 10 ? `<i class="fas fa-droplet"></i> ${h.pop}%` : ''}</span>
      <span class="h-wind"><i class="fas fa-location-arrow" style="transform:rotate(${((h.windDir ?? 0) + 135) % 360}deg)"></i>${U.w(h.wind)}</span>
      ${sun ? `<span class="h-sun" title="${sun.up ? 'Amanecer' : 'Atardecer'}"><i class="fas ${sun.up ? 'fa-sun' : 'fa-moon'}"></i> ${fmtTime(sun.t)}</span>` : ''}
    </button>`;
  }).join('');
  const M = METRICS[state.metric];
  const scroller = $('#hourlyScroller');
  const keepScroll = scroller.dataset.key === `${placeId(state.place)}|${state.dayIndex}` ? scroller.scrollLeft : 0;
  scroller.innerHTML = `<div class="hourly-track" style="width:${hours.length * COL_W}px">${chartSVG(hours, state.metric)}<div class="hour-cols">${cols}</div></div>`;
  scroller.dataset.key = `${placeId(state.place)}|${state.dayIndex}`;
  scroller.scrollLeft = keepScroll;
  scroller.setAttribute('title', typeof M.legend === 'function' ? M.legend() : M.legend);
  $$('.hcol', scroller).forEach(b => b.onclick = () => {
    state.hourSel = state.hourSel === b.dataset.time ? null : b.dataset.time;
    $$('.hcol', scroller).forEach(x => x.classList.toggle('selected', x.dataset.time === state.hourSel));
    renderHourDetail();
  });
  renderHourDetail();
}
function renderHourDetail() {
  const box = $('#hourDetail');
  const h = state.hourSel && state.wx.hours.find(x => x.time === state.hourSel);
  if (!h) { box.innerHTML = `<p class="hint"><i class="fas fa-hand-pointer"></i> Tocá una hora para ver todos sus datos. ${esc(typeof METRICS[state.metric].legend === 'function' ? METRICS[state.metric].legend() : METRICS[state.metric].legend)}.</p>`; return; }
  const w = wInfo(h.code, h.isDay);
  const row = (ico, lbl, val) => `<div><i class="fas ${ico}"></i>${lbl}<b>${val}</b></div>`;
  box.innerHTML = `<div class="hd-card">
    <div class="hd-head">${wIcon(h.code, h.isDay)}<div><h3>${cap(fmtDate(h.t, { weekday: 'long', day: 'numeric', month: 'short' }))} · ${fmtTime(h.t)}</h3><p>${w.label} · ${U.tU(h.temp)}</p></div></div>
    <div class="hd-grid">
      ${row('fa-temperature-half', 'Sensación', U.t(h.feels))}
      ${row('fa-droplet', 'Prob. lluvia', isNum(h.pop) ? h.pop + '%' : '–')}
      ${row('fa-cloud-rain', 'Precipitación', U.mmU(h.precip))}
      ${row('fa-water', 'Humedad', isNum(h.humidity) ? h.humidity + '%' : '–')}
      ${row('fa-temperature-low', 'Punto de rocío', U.t(h.dew))}
      ${row('fa-wind', 'Viento', `${U.wU(h.wind)} ${cardinal(h.windDir)}`)}
      ${row('fa-wind', 'Ráfagas', U.wU(h.gust))}
      ${row('fa-gauge', 'Presión', `${U.p(h.pressure)} ${U.pUnit()}`)}
      ${row('fa-cloud', 'Nubosidad', isNum(h.clouds) ? h.clouds + '%' : '–')}
      ${row('fa-eye', 'Visibilidad', U.km(h.vis))}
      ${row('fa-sun', 'Índice UV', isNum(h.uv) ? `${h.uv.toFixed(1)} (${uvLevel(h.uv).label})` : '–')}
      ${row('fa-person-running', 'Para salir', `${hourScore(h).toFixed(1)}/10`)}
    </div></div>`;
}

// ---------- 16 días ----------
function renderDaily() {
  const m = state.wx;
  const lo = minOf(m.days.map(d => d.min)), hi = maxOf(m.days.map(d => d.max));
  const span = (hi - lo) || 1;
  const nowT = m.current.temp;
  const rows = m.days.map((d, i) => {
    const left = ((d.min - lo) / span) * 100, width = Math.max(3, ((d.max - d.min) / span) * 100);
    const bar = isNum(d.min) && isNum(d.max)
      ? `<span class="range-bar" style="left:${left}%;width:${width}%;background:linear-gradient(90deg,${tempColor(d.min)},${tempColor(d.max)})"></span>` : '';
    const dot = i === 0 && isNum(nowT) ? `<span class="range-now" style="left:${clamp((nowT - lo) / span * 100, 0, 100)}%" title="Ahora"></span>` : '';
    const split = i === 7 ? `<div class="split">Tendencia extendida (menor precisión)</div>` : '';
    return `${split}<button type="button" class="day-row${i === state.dayIndex ? ' selected' : ''}" data-i="${i}" aria-pressed="${i === state.dayIndex}">
      <span class="d-name">${dayLabel(i)}<small>${fmtDate(d.t, { day: 'numeric', month: 'short' })}</small></span>
      <span class="d-ico">${wIcon(d.code, 1)}</span>
      <span class="d-pop">${(d.pop ?? 0) >= 10 ? `<i class="fas fa-droplet"></i>${d.pop}%` : ''}</span>
      <span class="d-min">${U.t(d.min)}</span>
      <span class="range-track">${bar}${dot}</span>
      <span class="d-max">${U.t(d.max)}</span>
    </button>`;
  }).join('');
  $('#dailyList').innerHTML = rows;
  $$('.day-row').forEach(b => b.onclick = () => selectDay(+b.dataset.i));
}
function selectDay(i, scroll = false) {
  state.dayIndex = i;
  state.hourSel = null;
  $$('.day-row').forEach(b => { const on = +b.dataset.i === i; b.classList.toggle('selected', on); b.setAttribute('aria-pressed', on); });
  renderHourly();
  renderDayDetail();
  if (scroll) $('#hourlySection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function renderDayDetail() {
  const m = state.wx, i = state.dayIndex, d = m.days[i];
  const prev = i === 0 ? m.yesterday : m.days[i - 1];
  const dl = isNum(d.daylight) && prev && isNum(prev.daylight) ? d.daylight - prev.daylight : null;
  const dlTxt = dl == null ? '' : `${dl >= 0 ? '+' : '−'}${Math.floor(Math.abs(dl) / 60)} min ${Math.round(Math.abs(dl) % 60)} s vs. día anterior`;
  const sc = d.score ?? 0;
  const item = (ico, lbl, val, sub = '') => `<div class="dd-item"><div class="lbl"><i class="fas ${ico}"></i> ${lbl}</div><div class="val">${val}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  $('#dayDetail').innerHTML = `
    <div class="dd-head">
      ${wIcon(d.code, 1)}
      <div><h3>${dayLabel(i)}, ${fmtDate(d.t, { day: 'numeric', month: 'long' })}</h3><p>${wInfo(d.code).label}</p></div>
      <div class="dd-temps"><div class="mx">${U.t(d.max)}</div><div class="mn">${U.t(d.min)}</div></div>
    </div>
    <div class="dd-grid">
      ${item('fa-temperature-half', 'Sensación térmica', `${U.t(d.feelsMin)} / ${U.t(d.feelsMax)}`, 'mínima / máxima')}
      ${item('fa-droplet', 'Lluvia', `${isNum(d.pop) ? d.pop + '%' : '–'} · ${U.mmU(d.precip)}`, d.precipHours ? `${Math.round(d.precipHours)} h con lluvia` : 'Sin horas de lluvia')}
      ${item('fa-wind', 'Viento máximo', U.wU(d.windMax), `Ráfagas ${U.wU(d.gustMax)} · desde ${cardinal(d.windDir)}`)}
      ${item('fa-sun', 'Índice UV máx.', isNum(d.uvMax) ? Math.round(d.uvMax) : '–', uvLevel(d.uvMax).label)}
      ${item('fa-sun', 'Amanecer', d.sunrise ? fmtTime(d.sunrise) : '–', `Atardecer ${d.sunset ? fmtTime(d.sunset) : '–'}`)}
      ${item('fa-hourglass-half', 'Horas de luz', isNum(d.daylight) ? fmtDur(d.daylight) : '–', dlTxt)}
      ${item('fa-cloud-sun', 'Horas de sol', isNum(d.sunshine) ? fmtDur(d.sunshine) : '–', isNum(d.sunshine) && d.daylight ? `${Math.round(d.sunshine / d.daylight * 100)}% del día` : '')}
      ${item('fa-water', 'Humedad media', isNum(d.humidity) ? Math.round(d.humidity) + '%' : '–')}
    </div>
    <div class="score-box" style="margin-top:12px;margin-bottom:0">
      <div class="score-ring" style="--v:${(sc * 10).toFixed(0)};--c:${scoreColor(sc)}"><span>${sc.toFixed(1)}</span></div>
      <div><strong>Para estar afuera: ${scoreLabel(sc)}</strong><p>${i >= 7 ? 'Pronóstico extendido: puede cambiar bastante.' : 'Promedio de las horas de luz.'}</p></div>
    </div>
    <div class="dd-actions"><button type="button" class="btn btn-ghost btn-sm" id="seeHours"><i class="fas fa-clock"></i> Ver hora por hora</button></div>`;
  $('#seeHours').onclick = () => $('#hourlySection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- Tiles de detalle ----------
function compassSVG(deg) {
  const ticks = Array.from({ length: 36 }, (_, i) => {
    const a = i * 10 * Math.PI / 180, r1 = i % 9 === 0 ? 33 : 37, r2 = 41;
    return `<line x1="${50 + r1 * Math.sin(a)}" y1="${50 - r1 * Math.cos(a)}" x2="${50 + r2 * Math.sin(a)}" y2="${50 - r2 * Math.cos(a)}" stroke="rgba(255,255,255,${i % 9 === 0 ? .8 : .3})" stroke-width="${i % 9 === 0 ? 2 : 1}"/>`;
  }).join('');
  const rot = isNum(deg) ? (deg + 180) % 360 : 0;
  return `<svg class="compass" width="100" height="100" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="44" fill="rgba(255,255,255,.06)" stroke="rgba(255,255,255,.2)"/>${ticks}
    <text x="50" y="21">N</text><text x="80" y="50">E</text><text x="50" y="80">S</text><text x="20" y="50">O</text>
    <g transform="rotate(${rot} 50 50)"><path d="M50 18 L57 40 L50 35 L43 40 Z" fill="#ffd166"/><line x1="50" y1="35" x2="50" y2="76" stroke="#ffd166" stroke-width="3" stroke-linecap="round"/><circle cx="50" cy="76" r="3.5" fill="#fff"/></g>
  </svg>`;
}
function gaugeSVG(val, lo, hi, color) {
  const f = clamp((val - lo) / (hi - lo), 0, 1);
  const a = Math.PI * (1 - f), cx = 50, cy = 52, r = 40;
  const x = cx + r * Math.cos(a), y = cy - r * Math.sin(a);
  return `<svg class="gauge" width="100" height="62" viewBox="0 0 100 62" aria-hidden="true">
    <path d="M10 52 A40 40 0 0 1 90 52" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="8" stroke-linecap="round"/>
    <path d="M10 52 A40 40 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"/>
    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="#fff"/>
  </svg>`;
}
function sunArcSVG(sunrise, sunset, now) {
  const f = (now - sunrise) / (sunset - sunrise);
  const up = f >= 0 && f <= 1;
  const ff = clamp(f, 0, 1), a = Math.PI * (1 - ff);
  const x = 80 + 66 * Math.cos(a), y = 76 - 66 * Math.sin(a);
  return `<svg class="sun-arc" width="160" height="88" viewBox="0 0 160 88" aria-hidden="true">
    <line x1="4" x2="156" y1="76" y2="76" stroke="rgba(255,255,255,.3)"/>
    <path d="M14 76 A66 66 0 0 1 146 76" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="2" stroke-dasharray="4 5"/>
    ${up ? `<path d="M14 76 A66 66 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="#ffd166" stroke-width="3" stroke-linecap="round"/>
    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="#ffd166" opacity=".3"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="#ffd166"/>` : `<circle cx="${f < 0 ? 14 : 146}" cy="76" r="5" fill="rgba(255,255,255,.6)"/>`}
  </svg>`;
}
function renderTiles() {
  const m = state.wx, c = m.current, today = m.days[0], p = state.place;
  const i = nowIdx();
  const bf = beaufort(c.wind ?? 0);
  const prev3 = m.hours[i - 3];
  const pTrend = prev3 && isNum(prev3.pressure) && isNum(c.pressure) ? c.pressure - prev3.pressure : 0;
  const pTxt = pTrend > 1 ? ['fa-arrow-up', 'Subiendo: tiende a mejorar'] : pTrend < -1 ? ['fa-arrow-down', 'Bajando: posible desmejora'] : ['fa-arrows-left-right', 'Estable'];
  const uv = uvLevel(c.uv);
  const uvH = today.hours.filter(h => (h.uv ?? 0) >= 3);
  const feelsDiff = isNum(c.feels) && isNum(c.temp) ? c.feels - c.temp : 0;
  const feelsTxt = feelsDiff <= -2 ? (c.wind > 15 ? 'El viento hace que se sienta más frío.' : 'Se siente más fresco de lo que marca.')
    : feelsDiff >= 2 ? (c.humidity > 60 ? 'La humedad hace que se sienta más calor.' : 'El sol hace que se sienta más calor.') : 'Similar a la temperatura real.';
  const next24 = nextHours(24);
  const rain24 = sumOf(next24.map(h => h.precip));
  const nextRain = next24.find(h => (h.precip ?? 0) >= 0.1);
  const moon = moonInfo();
  const south = p.lat < 0;
  const nw = nowWall();
  const dl = isNum(today.daylight) && m.yesterday && isNum(m.yesterday.daylight) ? today.daylight - m.yesterday.daylight : null;
  const tomorrow = m.days[1];

  const tiles = [
    `<div class="card tile"><div class="tile-head"><i class="fas fa-wind"></i> Viento</div>
      <div class="tile-row">${compassSVG(c.windDir)}<div>
        <div class="tile-val">${U.w(c.wind)}<small>${U.wUnit()}</small></div>
        <p class="tile-txt">Ráfagas <b>${U.wU(c.gust)}</b></p>
        <p class="tile-txt">Desde ${cardinalLong(c.windDir)} (${isNum(c.windDir) ? Math.round(c.windDir) + '°' : '–'})</p>
      </div></div>
      <p class="tile-txt">Escala Beaufort ${bf.n}: <b>${bf.label}</b></p></div>`,

    `<div class="card tile"><div class="tile-head"><i class="fas fa-temperature-half"></i> Sensación térmica</div>
      <div class="tile-val">${U.t(c.feels)}</div>
      <p class="tile-txt">${feelsTxt}</p>
      <p class="tile-txt">Real <b>${U.tU(c.temp)}</b> · Hoy entre <b>${U.t(today.feelsMin)}</b> y <b>${U.t(today.feelsMax)}</b></p></div>`,

    `<div class="card tile"><div class="tile-head"><i class="fas fa-water"></i> Humedad</div>
      <div class="tile-val">${isNum(c.humidity) ? c.humidity : '–'}<small>%</small></div>
      <div class="meter meter-hum"><span class="mk" style="left:${clamp(c.humidity ?? 0, 0, 100)}%"></span></div>
      <p class="tile-txt">Punto de rocío <b>${U.t(c.dew)}</b> · ${dewComfort(c.dew)}</p></div>`,

    `<div class="card tile"><div class="tile-head"><i class="fas fa-sun"></i> Índice UV</div>
      <div class="tile-val" style="color:${uv.color}">${isNum(c.uv) ? Math.round(c.uv) : '–'}<small>${uv.label}</small></div>
      <div class="meter meter-uv"><span class="mk" style="left:${clamp((c.uv ?? 0) / 11 * 100, 0, 100)}%"></span></div>
      <p class="tile-txt">${uvH.length ? `Protección de <b>${fmtTime(uvH[0].t)}</b> a <b>${fmtTime(uvH[uvH.length - 1].t + 3600e3)}</b>. ` : ''}Máx. hoy <b>${isNum(today.uvMax) ? Math.round(today.uvMax) : '–'}</b>. ${uv.tip}</p></div>`,

    `<div class="card tile"><div class="tile-head"><i class="fas fa-gauge"></i> Presión</div>
      <div class="tile-row">${gaugeSVG(c.pressure ?? 1013, 970, 1050, '#c3a6ff')}<div>
        <div class="tile-val">${U.p(c.pressure)}<small>${U.pUnit()}</small></div>
      </div></div>
      <p class="tile-txt"><i class="fas ${pTxt[0]}"></i> ${pTxt[1]} (${pTrend >= 0 ? '+' : ''}${pTrend.toFixed(1)} hPa en 3 h)</p></div>`,

    `<div class="card tile"><div class="tile-head"><i class="fas fa-eye"></i> Visibilidad</div>
      <div class="tile-val">${U.km(c.vis)}</div>
      <p class="tile-txt">${visLabel(c.vis)}</p>
      <p class="tile-txt"><i class="fas fa-cloud"></i> Nubosidad <b>${isNum(c.clouds) ? c.clouds + '%' : '–'}</b> · ${cloudLabel(c.clouds)}</p></div>`,

    `<div class="card tile"><div class="tile-head"><i class="fas fa-cloud-rain"></i> Precipitación</div>
      <div class="tile-val">${U.mm(rain24)}<small>${state.settings.precip === 'in' ? 'in' : 'mm'}</small></div>
      <p class="tile-txt">Previstos en las próximas 24 h.</p>
      <p class="tile-txt">${nextRain ? `Próxima lluvia: <b>${dayLabelOf(nextRain.t)} ${fmtTime(nextRain.t)}</b>` : 'Sin lluvia prevista en 24 h.'}</p></div>`,

    `<div class="card tile"><div class="tile-head"><i class="fas fa-sun"></i> Sol</div>
      ${today.sunrise && today.sunset ? sunArcSVG(today.sunrise, today.sunset, nw) : ''}
      <p class="tile-txt"><i class="fas fa-arrow-up"></i> Amanecer <b>${today.sunrise ? fmtTime(today.sunrise) : '–'}</b> · <i class="fas fa-arrow-down"></i> Atardecer <b>${today.sunset ? fmtTime(today.sunset) : '–'}</b></p>
      <p class="tile-txt">${isNum(today.daylight) ? `<b>${fmtDur(today.daylight)}</b> de luz` : ''}${dl != null ? ` (${dl >= 0 ? '+' : '−'}${Math.floor(Math.abs(dl) / 60)}:${String(Math.round(Math.abs(dl) % 60)).padStart(2, '0')} vs. ayer)` : ''}${today.sunset && nw < today.sunset && nw > (today.sunrise || 0) ? ` · Quedan ${fmtDur((today.sunset - nw) / 1000)}` : tomorrow?.sunrise && nw >= (today.sunset || 0) ? ` · Amanece en ${fmtDur((tomorrow.sunrise - nw) / 1000)}` : ''}</p></div>`,

    `<div class="card tile"><div class="tile-head"><i class="fas fa-moon"></i> Luna</div>
      <div class="tile-row"><span class="moon-emoji${south ? ' south' : ''}" aria-hidden="true">${moon.emoji}</span><div>
        <div class="tile-val" style="font-size:1.3rem">${moon.name}</div>
        <p class="tile-txt">Iluminada <b>${Math.round(moon.illum * 100)}%</b> · Edad ${moon.age.toFixed(1)} días</p>
      </div></div>
      <p class="tile-txt">Luna llena en <b>${Math.round(moon.toFull)} días</b> · Nueva en <b>${Math.round(moon.toNew)} días</b></p></div>`,

    `<div class="card tile"><div class="tile-head"><i class="fas fa-earth-americas"></i> Ubicación</div>
      <div class="tile-val" style="font-size:1.3rem">${esc(m.tz.replace(/_/g, ' ').split('/').pop())}</div>
      <p class="tile-txt">Zona horaria <b>${esc(m.tzAbbr)}</b> (UTC${m.off >= 0 ? '+' : '−'}${fmtOffset(m.off)})</p>
      <p class="tile-txt">Lat <b>${(+p.lat).toFixed(3)}°</b> · Lon <b>${(+p.lon).toFixed(3)}°</b> · Altura <b>${Math.round(m.elevation)} m</b></p>
      <p class="tile-txt">Tu hora: <b>${new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</b></p></div>`,
  ];
  $('#tiles').innerHTML = tiles.join('');
}
const fmtOffset = s => { const a = Math.abs(s); const h = Math.floor(a / 3600), mm = Math.round((a % 3600) / 60); return mm ? `${h}:${String(mm).padStart(2, '0')}` : `${h}`; };
function dayLabelOf(t) {
  const idx = state.wx.days.findIndex(d => t >= d.t && t < d.t + 86400e3);
  return idx === 0 ? 'hoy' : idx === 1 ? 'mañana' : idx > 1 ? fmtDate(t, { weekday: 'long' }) : '';
}

// ---------- Calidad del aire ----------
const POLLUTANTS = [
  ['pm2_5', 'PM2.5', 'Partículas finas', 15], ['pm10', 'PM10', 'Partículas gruesas', 45], ['ozone', 'O₃', 'Ozono', 100],
  ['nitrogen_dioxide', 'NO₂', 'Dióxido de nitrógeno', 25], ['sulphur_dioxide', 'SO₂', 'Dióxido de azufre', 40], ['carbon_monoxide', 'CO', 'Monóxido de carbono', 4000],
  ['dust', 'Polvo', 'Polvo en suspensión', 50],
];
const POLLEN = [['grass_pollen', 'Gramíneas'], ['birch_pollen', 'Abedul'], ['alder_pollen', 'Aliso'], ['olive_pollen', 'Olivo'], ['mugwort_pollen', 'Artemisa'], ['ragweed_pollen', 'Ambrosía']];
function renderAir() {
  const sec = $('#airSection');
  const a = state.air?.current;
  if (!a || !isNum(a.us_aqi)) {
    sec.innerHTML = `<h2 class="card-title"><i class="fas fa-lungs"></i> Calidad del aire</h2><p class="muted">No hay datos de calidad del aire para esta ubicación.</p>`;
    return;
  }
  const lvl = aqiLevel(a.us_aqi);
  const polls = POLLUTANTS.filter(([k]) => isNum(a[k])).map(([k, sym, name, who]) => {
    const ratio = a[k] / who;
    const col = ratio < 0.5 ? '#3ddc84' : ratio < 1 ? '#ffd166' : ratio < 2 ? '#ff9a4a' : '#ff5a5f';
    return `<div class="pol" title="${name}. Guía OMS: ${who} µg/m³"><div class="lbl"><span>${sym}</span><span>${name}</span></div>
      <div class="val">${a[k] >= 100 ? Math.round(a[k]) : a[k].toFixed(1)} <small>µg/m³</small></div>
      <div class="bar"><span style="width:${clamp(ratio * 50, 2, 100)}%;background:${col}"></span></div></div>`;
  }).join('');
  const pollen = POLLEN.filter(([k]) => isNum(a[k])).map(([k, name]) => {
    const v = a[k], col = v < 10 ? '#3ddc84' : v < 50 ? '#ffd166' : v < 100 ? '#ff9a4a' : '#ff5a5f';
    return `<div class="pol"><div class="lbl"><span>${name}</span></div><div class="val">${Math.round(v)} <small>granos/m³</small></div><div class="bar"><span style="width:${clamp(v, 2, 100)}%;background:${col}"></span></div></div>`;
  }).join('');
  // AQI próximas 24 h
  const H = state.air.hourly;
  let hoursHtml = '';
  if (H && H.time) {
    const n = nowWall();
    const start = H.time.findIndex(t => wall(t) + 3600e3 > n);
    if (start >= 0) {
      const seg = H.time.slice(start, start + 24).map((t, j) => ({ t: wall(t), v: H.us_aqi[start + j] })).filter(x => isNum(x.v));
      const mx = Math.max(100, ...seg.map(x => x.v));
      if (seg.length) hoursHtml = `<h4>ICA próximas 24 horas</h4><div class="aqi-hours">${seg.map(x => `<div style="height:${clamp(x.v / mx * 100, 4, 100)}%;background:${aqiLevel(x.v).color}" title="${fmtTime(x.t)}: ${x.v}"></div>`).join('')}</div>
        <div class="aqi-hours-labels"><span>${fmtTime(seg[0].t)}</span><span>${fmtTime(seg[Math.floor(seg.length / 2)].t)}</span><span>${fmtTime(seg[seg.length - 1].t)}</span></div>`;
    }
  }
  sec.innerHTML = `
    <h2 class="card-title"><i class="fas fa-lungs"></i> Calidad del aire</h2>
    <div class="air-head">
      <div class="aqi-badge" style="background:${lvl.color}"><div><b>${a.us_aqi}</b><small>ICA (EE. UU.)</small></div></div>
      <div><h3>${lvl.label}</h3><p>${lvl.tip}${isNum(a.european_aqi) ? ` · Índice europeo: <b>${a.european_aqi}</b>` : ''}</p></div>
      <div class="air-meter"><div class="meter meter-aqi"><span class="mk" style="left:${clamp(a.us_aqi / 300 * 100, 0, 100)}%"></span></div>
        <div class="meter-labels"><span>0</span><span>50</span><span>100</span><span>150</span><span>200</span><span>300+</span></div></div>
    </div>
    <div class="pollutants">${polls}</div>
    ${pollen ? `<h4>Polen</h4><div class="pollutants">${pollen}</div>` : ''}
    ${hoursHtml}
    <p class="hint">Las barras comparan cada contaminante con la guía de la OMS (la mitad de la barra = límite recomendado).</p>`;
}

// =========================================================
// BÚSQUEDA Y SUGERENCIAS
// =========================================================
const sug = { list: [], active: -1, timer: 0, seq: 0 };
const cityInput = $('#cityInput');
const sugBox = $('#citySuggestions');

function openSug(html) { sugBox.innerHTML = html; sugBox.hidden = !html; cityInput.setAttribute('aria-expanded', String(!!html)); }
function closeSug() { openSug(''); sug.active = -1; }
function sugItem(p, i, ico) {
  return `<li class="sug" role="option" id="sug-${i}" data-i="${i}">${ico ? `<i class="fas ${ico}"></i>` : `<span class="flag">${flag(p.country)}</span>`}<span>${esc(p.name)}<small>${esc(placeSub(p))}</small></span></li>`;
}
function showRecents() {
  sug.list = [{ geo: true }, ...state.recents.slice(0, 6)];
  let html = `<li class="sug" role="option" id="sug-0" data-i="0"><i class="fas fa-location-crosshairs"></i><span>Usar mi ubicación<small>Detectar automáticamente</small></span></li>`;
  if (state.recents.length) html += `<li class="sug-head" role="presentation">Búsquedas recientes</li>` + state.recents.slice(0, 6).map((p, i) => sugItem(p, i + 1, 'fa-clock-rotate-left')).join('');
  openSug(html);
  sug.active = -1;
}
async function suggest(q) {
  const seq = ++sug.seq;
  try {
    const list = await searchPlaces(q, 6);
    if (seq !== sug.seq || cityInput.value.trim() !== q) return;
    sug.list = list;
    sug.active = -1;
    openSug(list.length ? list.map((p, i) => sugItem(p, i)).join('') : `<li class="sug-head" role="presentation">Sin resultados para “${esc(q)}”</li>`);
  } catch (e) { console.warn(e); }
}
function pickSuggestion(i) {
  const p = sug.list[i]; if (!p) return;
  closeSug();
  if (p.geo) { locate(); return; }
  cityInput.value = '';
  cityInput.blur();
  loadPlace(p);
}
function highlight(i) {
  const items = $$('.sug', sugBox);
  if (!items.length) return;
  sug.active = (i + items.length) % items.length;
  items.forEach((el, j) => el.classList.toggle('active', j === sug.active));
  items[sug.active].scrollIntoView({ block: 'nearest' });
  cityInput.setAttribute('aria-activedescendant', items[sug.active].id);
}
async function submitSearch() {
  const q = cityInput.value.trim();
  if (sug.active >= 0) { pickSuggestion(+$$('.sug', sugBox)[sug.active].dataset.i); return; }
  if (!q) { showRecents(); cityInput.focus(); return; }
  closeSug();
  try {
    const [p] = await searchPlaces(q, 1);
    if (!p) { toast(`No encontramos “${q}”. Probá con “Ciudad, País”.`); return; }
    cityInput.value = '';
    cityInput.blur();
    loadPlace(p);
  } catch (e) { toast('Error al buscar. Revisá tu conexión.'); }
}
function bindSearch() {
  cityInput.addEventListener('input', () => {
    const q = cityInput.value.trim();
    clearTimeout(sug.timer);
    if (q.length < 2) { showRecents(); return; }
    sug.timer = setTimeout(() => suggest(q), 260);
  });
  cityInput.addEventListener('focus', () => { if (cityInput.value.trim().length < 2) showRecents(); });
  cityInput.addEventListener('blur', () => setTimeout(closeSug, 150));
  cityInput.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (sugBox.hidden) showRecents(); highlight(sug.active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(sug.active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); submitSearch(); }
    else if (e.key === 'Escape') { closeSug(); cityInput.blur(); }
  });
  sugBox.addEventListener('mousedown', e => {
    const li = e.target.closest('.sug'); if (!li) return;
    e.preventDefault();
    pickSuggestion(+li.dataset.i);
  });
  $('#searchButton').addEventListener('click', submitSearch);
}

// =========================================================
// FAVORITOS / RECIENTES / COMPARTIR
// =========================================================
const slim = p => ({ name: p.name, admin: p.admin || '', country: p.country || '', lat: +(+p.lat).toFixed(4), lon: +(+p.lon).toFixed(4) });
const isFavorite = p => state.favorites.some(f => placeId(f) === placeId(p));
function toggleFavorite() {
  const p = state.place;
  if (isFavorite(p)) {
    state.favorites = state.favorites.filter(f => placeId(f) !== placeId(p));
    toast(`${p.name} se quitó de favoritos`);
  } else {
    if (state.favorites.length >= 12) { toast('Máximo 12 favoritos'); return; }
    state.favorites.push(slim(p));
    toast(`${p.name} se agregó a favoritos ⭐`);
  }
  store.set('favorites', state.favorites);
  renderHero();
  refreshFavTemps();
}
function addRecent(p) {
  state.recents = [slim(p), ...state.recents.filter(r => placeId(r) !== placeId(p))].slice(0, 8);
  store.set('recents', state.recents);
}
function renderFavorites() {
  const bar = $('#favoritesBar');
  if (!state.favorites.length) { bar.innerHTML = ''; bar.hidden = true; return; }
  bar.hidden = false;
  const cur = state.place && placeId(state.place);
  bar.innerHTML = state.favorites.map((f, i) => {
    const c = state.favCurrent[placeId(f)];
    return `<div class="fav-chip${placeId(f) === cur ? ' current' : ''}" role="button" tabindex="0" data-i="${i}" title="${esc(f.name)}, ${esc(placeSub(f))}">
      ${c ? wIcon(c.weather_code, c.is_day) : '<i class="fas fa-star" style="color:var(--accent-2)"></i>'}
      <span>${esc(f.name)}</span>${c ? `<span class="fav-temp">${U.t(c.temperature_2m)}</span>` : ''}
      <button class="fav-x" type="button" data-x="${i}" aria-label="Quitar ${esc(f.name)}"><i class="fas fa-xmark"></i></button></div>`;
  }).join('');
  $$('.fav-chip', bar).forEach(ch => {
    const go = () => loadPlace(state.favorites[+ch.dataset.i]);
    ch.addEventListener('click', e => { if (e.target.closest('.fav-x')) return; go(); });
    ch.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
  $$('.fav-x', bar).forEach(x => x.addEventListener('click', e => {
    e.stopPropagation();
    const f = state.favorites[+x.dataset.x];
    state.favorites.splice(+x.dataset.x, 1);
    store.set('favorites', state.favorites);
    renderFavorites();
    if (state.wx) renderHero();
    toast(`${f.name} se quitó de favoritos`);
  }));
}
async function refreshFavTemps() {
  if (!state.favorites.length) { renderFavorites(); return; }
  try {
    const lats = state.favorites.map(f => f.lat).join(','), lons = state.favorites.map(f => f.lon).join(',');
    const r = await fetchJSON(`${API.forecast}?latitude=${lats}&longitude=${lons}&current=temperature_2m,weather_code,is_day&timezone=auto`);
    const arr = Array.isArray(r) ? r : [r];
    arr.forEach((x, i) => { if (state.favorites[i] && x.current) state.favCurrent[placeId(state.favorites[i])] = x.current; });
  } catch (e) { console.warn('Favoritos sin actualizar', e); }
  renderFavorites();
}
function shareURL() {
  const p = state.place;
  const u = new URL(location.href.split('?')[0].split('#')[0]);
  u.searchParams.set('lat', (+p.lat).toFixed(4));
  u.searchParams.set('lon', (+p.lon).toFixed(4));
  u.searchParams.set('n', p.name);
  if (p.admin) u.searchParams.set('a', p.admin);
  if (p.country) u.searchParams.set('c', p.country);
  return u.toString();
}
function updateURL() { try { history.replaceState(null, '', shareURL()); } catch { /* file:// */ } }
async function share() {
  const c = state.wx.current, p = state.place;
  const text = `${p.name}: ${U.tU(c.temp)}, ${wInfo(c.code).label.toLowerCase()}. Sensación ${U.t(c.feels)}. Máx ${U.t(state.wx.days[0].max)} / Mín ${U.t(state.wx.days[0].min)}.`;
  const url = shareURL();
  if (navigator.share) {
    try { await navigator.share({ title: `Clima en ${p.name}`, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('Copiado al portapapeles 📋'); }
  catch { toast('No se pudo compartir'); }
}

// =========================================================
// GEOLOCALIZACIÓN
// =========================================================
function locate() {
  const btn = $('#geoBtn');
  if (!navigator.geolocation) { toast('Tu navegador no permite geolocalización'); return; }
  btn.classList.add('busy');
  navigator.geolocation.getCurrentPosition(async pos => {
    const { latitude: lat, longitude: lon } = pos.coords;
    const p = await reversePlace(lat, lon);
    btn.classList.remove('busy');
    loadPlace(p);
  }, err => {
    btn.classList.remove('busy');
    toast(err.code === 1 ? 'Permiso de ubicación denegado' : 'No pudimos obtener tu ubicación');
  }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 10 * 60 * 1000 });
}

// =========================================================
// MAPA (Leaflet + RainViewer + OpenWeatherMap)
// =========================================================
const MAP = { map: null, marker: null, overlay: null, layer: 'radar', frames: [], pastLen: 0, host: '', idx: 0, layers: {}, timer: 0, radarAt: 0 };
function initMap() {
  if (MAP.map || !window.L || !state.place) return;
  const p = state.place;
  MAP.map = L.map('map', { worldCopyJump: true, zoomControl: true, attributionControl: true }).setView([p.lat, p.lon], 7);
  const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
  L.tileLayer(`${esri}World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, {
    attribution: 'Mapa &copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, &copy; OpenStreetMap', maxZoom: 16,
  }).addTo(MAP.map);
  // Nombres de lugares por encima de las capas del clima
  MAP.map.createPane('labels');
  MAP.map.getPane('labels').style.zIndex = 650;
  MAP.map.getPane('labels').style.pointerEvents = 'none';
  L.tileLayer(`${esri}World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, { pane: 'labels', maxZoom: 16 }).addTo(MAP.map);
  MAP.marker = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: 'map-pin', iconSize: [18, 18] }), keyboard: false }).addTo(MAP.map);
  MAP.map.on('click', async e => {
    const { lat, lng } = e.latlng;
    const lon = ((lng + 540) % 360) - 180;
    toast('Buscando el clima de ese punto…');
    const place = await reversePlace(+lat.toFixed(4), +lon.toFixed(4));
    loadPlace(place);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  setMapLayer(MAP.layer);
}
function updateMapPlace() {
  if (!MAP.map || !state.place) return;
  const ll = [state.place.lat, state.place.lon];
  MAP.marker.setLatLng(ll);
  MAP.map.setView(ll, Math.max(MAP.map.getZoom(), 6));
}
function clearOverlay() {
  stopRadar();
  if (MAP.overlay) { MAP.map.removeLayer(MAP.overlay); MAP.overlay = null; }
  Object.values(MAP.layers).forEach(l => MAP.map.removeLayer(l));
  MAP.layers = {};
}
async function setMapLayer(name) {
  MAP.layer = name;
  $$('#mapLayers button').forEach(b => b.classList.toggle('active', b.dataset.layer === name));
  if (!MAP.map) return;
  clearOverlay();
  $('#radarControls').hidden = name !== 'radar';
  if (name === 'radar') { await loadRadar(); return; }
  MAP.overlay = L.tileLayer(`https://tile.openweathermap.org/map/${name}/{z}/{x}/{y}.png?appid=${OWM_KEY}`, {
    opacity: 0.85, maxZoom: 18, zIndex: 10, attribution: '&copy; <a href="https://openweathermap.org/">OpenWeatherMap</a>',
  }).addTo(MAP.map);
}
async function loadRadar() {
  try {
    if (!MAP.frames.length || Date.now() - MAP.radarAt > 5 * 60e3) {
      const r = await fetchJSON(API.radar);
      MAP.host = r.host;
      const past = r.radar?.past || [], now = r.radar?.nowcast || [];
      MAP.frames = [...past, ...now];
      MAP.pastLen = past.length;
      MAP.radarAt = Date.now();
    }
    if (!MAP.frames.length) throw new Error('Sin cuadros de radar');
    const s = $('#radarSlider');
    s.max = MAP.frames.length - 1;
    showFrame(MAP.pastLen - 1);
  } catch (e) {
    console.warn(e);
    $('#radarTime').textContent = 'Radar no disponible';
  }
}
function frameLayer(i) {
  const f = MAP.frames[i];
  if (!MAP.layers[f.path]) {
    MAP.layers[f.path] = L.tileLayer(`${MAP.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, {
      opacity: 0, maxNativeZoom: 7, maxZoom: 18, zIndex: 10, attribution: '&copy; <a href="https://www.rainviewer.com/">RainViewer</a>',
    }).addTo(MAP.map);
  }
  return MAP.layers[f.path];
}
function showFrame(i) {
  if (!MAP.frames.length || MAP.layer !== 'radar') return;
  i = (i + MAP.frames.length) % MAP.frames.length;
  const prev = MAP.frames[MAP.idx] && MAP.layers[MAP.frames[MAP.idx].path];
  const cur = frameLayer(i);
  if (prev && prev !== cur) prev.setOpacity(0);
  cur.setOpacity(0.75);
  // precargar el siguiente
  frameLayer((i + 1) % MAP.frames.length);
  MAP.idx = i;
  $('#radarSlider').value = i;
  const t = MAP.frames[i].time * 1000 + (state.wx ? state.wx.off * 1000 : 0);
  $('#radarTime').textContent = `${fmtTime(t)}${i >= MAP.pastLen ? ' (pronóstico)' : i === MAP.pastLen - 1 ? ' (último)' : ''}`;
}
function playRadar() {
  if (MAP.timer) { stopRadar(); return; }
  $('#radarPlay').innerHTML = '<i class="fas fa-pause"></i>';
  $('#radarPlay').setAttribute('aria-label', 'Pausar radar');
  MAP.timer = setInterval(() => showFrame(MAP.idx + 1), 700);
}
function stopRadar() {
  clearInterval(MAP.timer); MAP.timer = 0;
  const b = $('#radarPlay'); b.innerHTML = '<i class="fas fa-play"></i>'; b.setAttribute('aria-label', 'Reproducir radar');
}
function bindMap() {
  $$('#mapLayers button').forEach(b => b.addEventListener('click', () => setMapLayer(b.dataset.layer)));
  $('#radarPlay').addEventListener('click', playRadar);
  $('#radarSlider').addEventListener('input', e => { stopRadar(); showFrame(+e.target.value); });
  const sec = $('#mapSection');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { const go = () => { if (window.L) { initMap(); io.disconnect(); } else setTimeout(go, 300); }; go(); } }, { rootMargin: '300px' });
    io.observe(sec);
  } else window.addEventListener('load', initMap);
}

// =========================================================
// ANIMACIONES DE FONDO (canvas)
// =========================================================
const FX = {
  kind: 'none', parts: [], raf: 0, w: 0, h: 0, wind: 0, ctx: null,
  init() {
    this.c = $('#fx');
    this.ctx = this.c.getContext('2d');
    this.resize();
    let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => this.resize(), 150); });
    document.addEventListener('visibilitychange', () => document.hidden ? this.stop() : this.start());
  },
  enabled() { return state.settings.fx && !matchMedia('(prefers-reduced-motion: reduce)').matches; },
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = innerWidth; this.h = innerHeight;
    this.c.width = this.w * dpr; this.c.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.spawn();
  },
  set(kind, wind) { const changed = kind !== this.kind; this.kind = kind; this.wind = wind; if (changed) this.spawn(); this.start(); },
  spawn() {
    const base = { rain: 120, heavy: 240, drizzle: 70, storm: 220, snow: 110, stars: 140, fewstars: 60, fog: 8 }[this.kind] || 0;
    const n = Math.round(base * clamp((this.w * this.h) / (1400 * 850), 0.35, 1.4));
    this.parts = Array.from({ length: n }, () => this.make(true));
  },
  make(init) {
    const R = Math.random, w = this.w, h = this.h;
    switch (this.kind) {
      case 'rain': case 'heavy': case 'storm': case 'drizzle': {
        const drizzle = this.kind === 'drizzle';
        return { x: R() * w * 1.2 - w * 0.1, y: init ? R() * h : -20 - R() * 100, len: drizzle ? 6 + R() * 6 : 12 + R() * 16, v: drizzle ? 5 + R() * 3 : 11 + R() * 9, a: 0.18 + R() * 0.32 };
      }
      case 'snow': return { x: R() * w, y: init ? R() * h : -10, r: 1 + R() * 2.8, v: 0.4 + R() * 1.1, ph: R() * Math.PI * 2, a: 0.5 + R() * 0.5 };
      case 'stars': case 'fewstars': return { x: R() * w, y: R() * h * 0.75, r: 0.3 + R() * 1.3, ph: R() * Math.PI * 2, sp: 0.008 + R() * 0.03 };
      case 'fog': return { x: R() * w, y: h * 0.2 + R() * h * 0.8, r: 180 + R() * 320, v: 0.1 + R() * 0.25, a: 0.035 + R() * 0.05 };
      default: return {};
    }
  },
  frame() {
    const ctx = this.ctx, w = this.w, h = this.h;
    ctx.clearRect(0, 0, w, h);
    const slant = clamp(this.wind / 60, 0.05, 0.6);
    switch (this.kind) {
      case 'rain': case 'heavy': case 'storm': case 'drizzle':
        ctx.lineCap = 'round';
        ctx.lineWidth = this.kind === 'heavy' || this.kind === 'storm' ? 1.4 : 1;
        for (const p of this.parts) {
          ctx.strokeStyle = `rgba(200,225,255,${p.a})`;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.len * slant, p.y + p.len); ctx.stroke();
          p.y += p.v; p.x -= p.v * slant;
          if (p.y > h + 20) Object.assign(p, this.make(false));
        }
        if (this.kind === 'storm' && Math.random() < 0.0035) { const f = $('#flash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); }
        break;
      case 'snow':
        for (const p of this.parts) {
          p.ph += 0.01; p.y += p.v; p.x += Math.sin(p.ph) * 0.5 + slant * 0.6;
          ctx.fillStyle = `rgba(255,255,255,${p.a})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
          if (p.y > h + 10 || p.x > w + 10) Object.assign(p, this.make(false), { x: Math.random() * w });
        }
        break;
      case 'stars': case 'fewstars':
        for (const p of this.parts) {
          p.ph += p.sp;
          ctx.fillStyle = `rgba(255,255,255,${0.25 + 0.6 * (0.5 + 0.5 * Math.sin(p.ph))})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        }
        break;
      case 'fog':
        for (const p of this.parts) {
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
          g.addColorStop(0, `rgba(235,240,245,${p.a})`); g.addColorStop(1, 'rgba(235,240,245,0)');
          ctx.fillStyle = g; ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
          p.x += p.v; if (p.x - p.r > w) p.x = -p.r;
        }
        break;
    }
  },
  start() {
    if (!this.enabled() || this.kind === 'none' || document.hidden) { this.stop(); this.ctx && this.ctx.clearRect(0, 0, this.w, this.h); return; }
    if (this.raf) return;
    const loop = () => { this.frame(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  },
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; },
};

// =========================================================
// AJUSTES, TOAST, ATAJOS, PWA
// =========================================================
function bindSettings() {
  const dlg = $('#settingsDialog'), form = $('#settingsForm');
  $('#settingsBtn').addEventListener('click', () => {
    ['temp', 'wind', 'pressure', 'precip'].forEach(k => { const r = form.querySelector(`input[name="${k}"][value="${state.settings[k]}"]`); if (r) r.checked = true; });
    form.fx.checked = !!state.settings.fx;
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  });
  form.addEventListener('change', e => {
    const t = e.target;
    state.settings[t.name] = t.type === 'checkbox' ? t.checked : t.value;
    store.set('settings', state.settings);
    if (t.name === 'fx') FX.start();
    renderAll();
  });
  $('#clearDataBtn').addEventListener('click', () => {
    if (!confirm('¿Borrar favoritos, búsquedas recientes y ajustes?')) return;
    store.clear();
    state.favorites = []; state.recents = []; state.favCurrent = {};
    state.settings = { temp: 'c', wind: 'kmh', pressure: 'hpa', precip: 'mm', fx: true };
    dlg.close();
    renderAll();
    renderFavorites();
    toast('Datos borrados');
  });
}
function setUnitTemp(next) {
  state.settings.temp = next;
  store.set('settings', state.settings);
  renderAll();
  toast(`Unidades: ${next === 'f' ? '°F' : '°C'}`);
}
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}
function bindShortcuts() {
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || $('#settingsDialog').open) return;
    const k = e.key.toLowerCase();
    if (e.key === '/') { e.preventDefault(); cityInput.focus(); }
    else if (k === 'u' && state.wx) setUnitTemp(state.settings.temp === 'c' ? 'f' : 'c');
    else if (k === 'r' && state.place) loadPlace(state.place, { silent: true, keepDay: true }).then(() => toast('Datos actualizados'));
    else if (k === 'f' && state.wx) toggleFavorite();
    else if (k === 'l') locate();
  });
}
function bindHourly() {
  $$('#chartTabs button').forEach(b => b.addEventListener('click', () => {
    state.metric = b.dataset.metric;
    $$('#chartTabs button').forEach(x => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-selected', on); });
    if (state.wx) renderHourly();
  }));
  $$('.scroll-btn').forEach(b => b.addEventListener('click', () => {
    const s = $('#hourlyScroller'); s.scrollBy({ left: +b.dataset.scroll * s.clientWidth * 0.8, behavior: 'smooth' });
  }));
  // Rueda vertical → scroll horizontal
  $('#hourlyScroller').addEventListener('wheel', e => {
    const s = e.currentTarget;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && s.scrollWidth > s.clientWidth && !e.shiftKey) {
      const atStart = s.scrollLeft <= 0 && e.deltaY < 0, atEnd = s.scrollLeft + s.clientWidth >= s.scrollWidth - 1 && e.deltaY > 0;
      if (!atStart && !atEnd) { e.preventDefault(); s.scrollLeft += e.deltaY; }
    }
  }, { passive: false });
}
function bindPWA() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./service-worker.js').then(r => r.update()).catch(e => console.warn('SW no registrado', e));
  }
  let deferred;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('#installBtn').hidden = false; });
  $('#installBtn').addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => null);
    deferred = null;
    $('#installBtn').hidden = true;
  });
  window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; toast('¡CLIMA instalada! 🎉'); });
  const net = () => { $('#offlineBanner').hidden = navigator.onLine; };
  window.addEventListener('online', () => { net(); if (state.place) loadPlace(state.place, { silent: true, keepDay: true }); });
  window.addEventListener('offline', net);
  net();
}
function tick() {
  if (!state.wx) return;
  const clock = $('#clock'); if (clock) clock.textContent = fmtTime(nowWall());
  const up = $('#updatedAgo'); if (up) up.textContent = ago(state.fetchedAt);
  if (!document.hidden && navigator.onLine && Date.now() - Math.max(state.fetchedAt, state.lastAttempt || 0) > REFRESH_MS) {
    loadPlace(state.place, { silent: true, keepDay: true });
    refreshFavTemps();
  }
}

// =========================================================
// INICIO
// =========================================================
function initialPlace() {
  const q = new URLSearchParams(location.search);
  const lat = parseFloat(q.get('lat')), lon = parseFloat(q.get('lon'));
  if (isNum(lat) && isNum(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    return { name: q.get('n') || `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`, admin: q.get('a') || '', country: q.get('c') || '', lat, lon };
  }
  const last = store.get('last', null);
  if (last && isNum(last.lat) && isNum(last.lon)) return last;
  return DEFAULT_PLACE;
}
document.addEventListener('DOMContentLoaded', async () => {
  FX.init();
  bindSearch();
  bindHourly();
  bindSettings();
  bindShortcuts();
  bindMap();
  bindPWA();
  $('#geoBtn').addEventListener('click', locate);
  renderFavorites();

  const q = new URLSearchParams(location.search).get('q');
  if (q) {
    try { const [p] = await searchPlaces(q, 1); if (p) { loadPlace(p); } else loadPlace(initialPlace()); }
    catch { loadPlace(initialPlace()); }
  } else loadPlace(initialPlace());

  refreshFavTemps();
  setInterval(tick, 30 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
});
