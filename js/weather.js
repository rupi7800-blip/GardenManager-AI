// Meteo e clima locale con Open-Meteo (gratuito, senza chiave).
import { cacheGet, cacheSet } from './db.js';

const WMO = {
  0: ['☀️', 'Sereno'], 1: ['🌤️', 'Poco nuvoloso'], 2: ['⛅', 'Parzialmente nuvoloso'], 3: ['☁️', 'Coperto'],
  45: ['🌫️', 'Nebbia'], 48: ['🌫️', 'Nebbia con brina'], 51: ['🌦️', 'Pioviggine debole'], 53: ['🌦️', 'Pioviggine'], 55: ['🌧️', 'Pioviggine intensa'],
  56: ['🌧️', 'Pioviggine gelata'], 57: ['🌧️', 'Pioviggine gelata'], 61: ['🌦️', 'Pioggia debole'], 63: ['🌧️', 'Pioggia'], 65: ['🌧️', 'Pioggia forte'],
  66: ['🌧️', 'Pioggia gelata'], 67: ['🌧️', 'Pioggia gelata'], 71: ['🌨️', 'Neve debole'], 73: ['🌨️', 'Neve'], 75: ['❄️', 'Neve forte'], 77: ['🌨️', 'Granuli di neve'],
  80: ['🌦️', 'Rovesci'], 81: ['🌧️', 'Rovesci'], 82: ['⛈️', 'Rovesci violenti'], 85: ['🌨️', 'Rovesci di neve'], 86: ['🌨️', 'Rovesci di neve'],
  95: ['⛈️', 'Temporale'], 96: ['⛈️', 'Temporale con grandine'], 99: ['⛈️', 'Temporale con grandine'],
};
export const wmo = (c) => WMO[c] || ['🌡️', '—'];

export async function geocode(name) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=6&language=it&format=json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Servizio di geolocalizzazione non raggiungibile');
  const j = await r.json();
  return (j.results || []).map(x => ({ name: x.name, admin: [x.admin3, x.admin2, x.admin1].filter(Boolean).join(', '), country: x.country, lat: x.latitude, lon: x.longitude, elevation: x.elevation }));
}

export async function getForecast(garden, { force = false } = {}) {
  if (!garden?.lat) return null;
  const key = `wx:${garden.lat.toFixed(2)},${garden.lon.toFixed(2)}`;
  if (!force) { const c = await cacheGet(key, 45 * 60 * 1000); if (c) return c; }
  const p = new URLSearchParams({
    latitude: garden.lat, longitude: garden.lon, timezone: 'auto', past_days: 7, forecast_days: 7,
    current: 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,et0_fao_evapotranspiration,wind_speed_10m_max,wind_gusts_10m_max,relative_humidity_2m_mean',
  });
  try {
    const r = await fetch('https://api.open-meteo.com/v1/forecast?' + p);
    if (!r.ok) throw new Error('meteo ' + r.status);
    const j = await r.json();
    const d = j.daily;
    const days = d.time.map((t, i) => ({ date: t, code: d.weather_code[i], tmax: d.temperature_2m_max[i], tmin: d.temperature_2m_min[i], rain: d.precipitation_sum[i] ?? 0, pop: d.precipitation_probability_max?.[i] ?? null, et0: d.et0_fao_evapotranspiration[i] ?? 0, wind: d.wind_speed_10m_max[i], gust: d.wind_gusts_10m_max?.[i], hum: d.relative_humidity_2m_mean?.[i] }));
    const today = j.current.time.slice(0, 10);
    const out = { fetched: Date.now(), current: j.current, past: days.filter(x => x.date < today), today: days.find(x => x.date === today), next: days.filter(x => x.date >= today) };
    await cacheSet(key, out);
    return out;
  } catch (e) {
    const stale = await cacheGet(key); // dati vecchi meglio di niente (offline)
    if (stale) return { ...stale, stale: true };
    throw e;
  }
}

// Clima locale: statistiche su 10 anni di dati ERA5 (archivio Open-Meteo)
export async function getClimate(garden) {
  if (!garden?.lat) return null;
  const key = `clima:${garden.lat.toFixed(2)},${garden.lon.toFixed(2)}`;
  const c = await cacheGet(key, 180 * 86400000);
  if (c) return c;
  const end = new Date(); end.setDate(0); // fine mese scorso
  const endY = end.getFullYear() - 0;
  const start = `${endY - 10}-01-01`;
  const p = new URLSearchParams({ latitude: garden.lat, longitude: garden.lon, start_date: start, end_date: `${endY - 1}-12-31`, daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum', timezone: 'auto' });
  const r = await fetch('https://archive-api.open-meteo.com/v1/archive?' + p);
  if (!r.ok) throw new Error('Archivio climatico non raggiungibile');
  const j = await r.json();
  const out = summarizeClimate(j.daily);
  await cacheSet(key, out);
  return out;
}

export function summarizeClimate(d) {
  const m = Array.from({ length: 12 }, () => ({ tmax: 0, tmin: 0, rain: 0, n: 0, frost: 0 }));
  const years = {};
  d.time.forEach((t, i) => {
    const y = +t.slice(0, 4), mo = +t.slice(5, 7) - 1;
    const tmax = d.temperature_2m_max[i], tmin = d.temperature_2m_min[i], rain = d.precipitation_sum[i] || 0;
    if (tmax == null || tmin == null) return;
    const s = m[mo]; s.tmax += tmax; s.tmin += tmin; s.rain += rain; s.n++; if (tmin <= 0) s.frost++;
    const Y = years[y] = years[y] || { min: 99, max: -99, rain: 0, lastFrost: null, firstFrost: null };
    Y.min = Math.min(Y.min, tmin); Y.max = Math.max(Y.max, tmax); Y.rain += rain;
    if (tmin <= 0) { if (mo < 6) Y.lastFrost = t.slice(5); else if (!Y.firstFrost) Y.firstFrost = t.slice(5); }
  });
  const nYears = Object.keys(years).length || 1;
  const monthly = m.map((s, i) => ({
    month: i + 1, tmax: +(s.tmax / s.n).toFixed(1), tmin: +(s.tmin / s.n).toFixed(1),
    rain: Math.round(s.rain / nYears), frostDays: +(s.frost / nYears).toFixed(1),
  }));
  const ys = Object.values(years);
  const absMin = ys.reduce((a, y) => a + y.min, 0) / ys.length;
  const absMax = ys.reduce((a, y) => a + y.max, 0) / ys.length;
  const median = (arr) => { const a = arr.filter(Boolean).sort(); return a.length ? a[Math.floor(a.length / 2)] : null; };
  const zone = usdaZone(absMin);
  const dryMonths = monthly.filter(x => x.rain < 2 * ((x.tmax + x.tmin) / 2)).map(x => x.month); // indice di Bagnouls-Gaussen
  const frostMonths = monthly.filter(x => x.frostDays >= 1).map(x => x.month);
  return {
    years: nYears, monthly, absMinAvg: +absMin.toFixed(1), absMaxAvg: +absMax.toFixed(1),
    annualRain: Math.round(ys.reduce((a, y) => a + y.rain, 0) / ys.length), zone,
    lastFrost: median(ys.map(y => y.lastFrost)), firstFrost: median(ys.map(y => y.firstFrost)),
    dryMonths, frostMonths, type: climateType(monthly, absMin),
  };
}
export function usdaZone(minC) {
  const f = minC * 9 / 5 + 32;
  const z = Math.floor((f + 60) / 10) + 1;
  const half = ((f + 60) % 10) >= 5 ? 'b' : 'a';
  return `${Math.max(1, Math.min(13, z))}${half}`;
}
function climateType(monthly, absMin) {
  const jul = monthly[6], jan = monthly[0];
  const summerRain = monthly[5].rain + monthly[6].rain + monthly[7].rain;
  if (absMin > -4 && summerRain < 90) return 'Mediterraneo';
  if (jan.tmin < -4 || absMin < -15) return 'Continentale freddo / montano';
  if (jul.tmax > 29) return 'Temperato caldo (subcontinentale)';
  return 'Temperato';
}
// Spostamento del calendario rispetto al riferimento (zona 8, pianura Centro-Nord)
export function calendarShift(climate) {
  if (!climate) return 0;
  if (climate.absMinAvg < -13) return 1; // primavere più tardive
  if (climate.absMinAvg > -3.5) return -1; // primavere anticipate (costa, Sud)
  return 0;
}

// Allerte meteo dalle previsioni
const dLabel = (iso) => new Date(iso + 'T12:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
export function weatherAlerts(fc, plants = [], speciesMap = {}) {
  if (!fc) return [];
  const alerts = [];
  const next = fc.next.slice(0, 4);
  const frost = next.filter(d => d.tmin <= 0);
  if (frost.length) {
    const minT = Math.min(...frost.map(d => d.tmin));
    const sensitive = plants.filter(p => { const s = speciesMap[p.speciesId]; return s && s.tMin != null && s.tMin > minT - 2; });
    alerts.push({ key: 'gelo-' + frost[0].date, level: minT <= -4 ? 'danger' : 'warn', icon: '❄️', title: `Rischio gelata: minima ${minT.toFixed(1)} °C, ${dLabel(frost[0].date)}`,
      text: sensitive.length ? `Proteggi o ricovera: ${sensitive.map(p => p.name).slice(0, 6).join(', ')}. Copri con tessuto non tessuto, sospendi le irrigazioni serali.` : 'Proteggi vasi e piante giovani; evita irrigazioni serali.' });
  }
  const heat = next.filter(d => d.tmax >= 34);
  if (heat.length >= 2) alerts.push({ key: 'caldo-' + heat[0].date, level: 'warn', icon: '🔥', title: `Ondata di calore: massime fino a ${Math.max(...heat.map(d => d.tmax)).toFixed(0)} °C`, text: 'Irriga all\'alba, ombreggia vasi e ortaggi, rimanda trapianti e potature, controlla il ragnetto rosso.' });
  const storm = next.find(d => [95, 96, 99].includes(d.code) || (d.gust || 0) >= 60);
  if (storm) alerts.push({ key: 'temporale-' + storm.date, level: 'warn', icon: '⛈️', title: `Temporali o raffiche forti — ${dLabel(storm.date)}`, text: 'Lega rampicanti e piante alte ai tutori, metti al riparo i vasi leggeri, controlla dopo l\'evento rami spezzati e danni da grandine.' });
  const heavy = next.find(d => d.rain >= 30);
  if (heavy) alerts.push({ key: 'pioggia-' + heavy.date, level: 'info', icon: '🌧️', title: `Pioggia abbondante prevista: ${heavy.rain.toFixed(0)} mm — ${dLabel(heavy.date)}`, text: 'Sospendi le irrigazioni; dopo l\'evento controlla ristagni e malattie fungine (peronospora, ticchiolatura).' });
  return alerts;
}
