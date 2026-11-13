import { registerPlugin } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { splitTags, stripWrappers, canonToken, normalizeTags, unionTags } from './tags.js';
import { createMerge } from './merge.js';
import pkg from '../package.json';

// Saját natív plugin (android-extra/HrPlugin.java). A __MOCK_HR__ csak az automatikus tesztekhez van.
const HR = window.__MOCK_HR__ || registerPlugin('HrNative');

// A verziószám egyetlen helyen van: a package.json "version" mezőjében (a build beleteszi a fejlécbe és a címbe).
const VERSION = 'v' + pkg.version.replace(/(\.0)+$/, '');   // 5.2.0 → v5.2, 5.2.1 → v5.2.1
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const errText = e => (e && (e.message || e.errorMessage)) || String(e);

const DEFAULT_PATHS = {
  radar: '/storage/emulated/0/Norbi/Hir-Radar/radar_memory.db',
  triage: '/storage/emulated/0/Norbi/Hir-Radar/triage.db',
  bm: '/storage/emulated/0/Norbi/BM-manager/bookmarks.db',
  mhtml: '/storage/emulated/0/Norbi/BM-manager/MHTML',          // az offline (MHTML) cikkek mappája – nem adatbázis
};
const BM_STATUS = 'ÚJ FOGÁS (Radar)';
const NO_SOURCE = 'Rovaton kívüli (Vegyes)';

$('ver').textContent = VERSION;
document.title = 'Hír-Radar Mobil ' + VERSION;

// ── állapot ─────────────────────────────────────────────────────────────────────
let radarOpen = false, triageOpen = false, triageNote = '';
let allIds = [], idx = 0, cur = null;          // a lista csak sorazonosítókat (rowid) tárol, a cikk külön töltődik
let viewMode = 'all';                          // all | prot | saved | read | del | tri
// rovat-szűrő: kijelölt rovatok (vagy „kivéve” mód) + „csak új” kapcsoló
const flt = { sel: new Set(), excl: false, onlyNew: false };
const fltActive = () => flt.sel.size > 0 || flt.onlyNew;
// 🧠 triage-lista szűrő: döntés (üres = mind), AI-eltérés (all | diff | same | none), csak indoklás nélküliek
const tflt = { dec: new Set(), ai: 'all', noReason: false };
const triFiltActive = () => tflt.dec.size > 0 || tflt.ai !== 'all' || tflt.noReason;
let sortMode = 'random';                       // random | desc | asc
let lastAction = null, searchTimer = null, statsTimer = null;
let renderTok = 0, statsTok = 0, listTok = 0, busy = false;
let pendingShare = null;
let allTagsCache = null, allTagsLoading = null, cmapCache = null, bmOpened = false;
let rowsVisible = true;
const modalStack = [];

// ── tárolás (csak az eszközön) ──────────────────────────────────────────────────
const lsGet = (k, d = '') => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* nincs tárhely */ } };
const lsDel = k => { try { localStorage.removeItem(k); } catch { /* nincs tárhely */ } };
const getPath = which => lsGet('hr_path_' + which, '') || DEFAULT_PATHS[which];

// ── segédek ─────────────────────────────────────────────────────────────────────
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
let toastTimer;
function toast(msg, ms = 2500) {
  const el = $('toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
const fmt = n => Number(n || 0).toLocaleString('hu-HU');
const pad = n => String(n).padStart(2, '0');
const dirOf = p => String(p).replace(/\/[^/]*$/, '');
function dateStr(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function tsNow(d = new Date()) { return `${dateStr(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
function domainOf(url, fallback = '') { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return fallback; } }

// ── adatbázis-segédek (natív SQLite, névvel azonosított adatbázisok) ───────────
async function q(db, sql, params = []) { return (await HR.query({ db, sql, params })).rows || []; }
async function qVal(db, sql, params = []) { const r = await q(db, sql, params); return r.length ? r[0][0] : null; }
const run = (db, sql, params = []) => HR.run({ db, sql, params });
const parseCsv = s => (s ? s.split(',').map(Number) : []);
const rid = id => Math.trunc(Number(id));            // sorazonosító: egész szám, közvetlenül az SQL-be írható

// opcionális tag_case_map.json (a BM tisztító készíti): a BM-mappában vagy a Hír-Radar mappában
async function getCmap() {
  if (cmapCache) return cmapCache;
  cmapCache = {};
  for (const dir of [dirOf(getPath('bm')), dirOf(getPath('radar'))]) {
    try {
      const r = await HR.readText({ path: dir + '/tag_case_map.json' });
      if (r && r.exists && r.text) {
        const d = JSON.parse(r.text);
        if (d && typeof d === 'object') { cmapCache = Object.fromEntries(Object.entries(d).map(([k, v]) => [String(k), String(v)])); break; }
      }
    } catch { /* nincs vagy hibás: alapszabály */ }
  }
  return cmapCache;
}

// ── séma ────────────────────────────────────────────────────────────────────────
async function ensureRadar() {
  const cols = await q('radar', 'PRAGMA table_info(memory)');
  if (!cols.length) throw new Error('Ebben az adatbázisban nincs „memory" tábla – ez nem a radar_memory.db?');
  const names = cols.map(r => r[1]);
  if (!names.includes('protected')) { try { await HR.exec({ db: 'radar', sql: 'ALTER TABLE memory ADD COLUMN protected INTEGER DEFAULT 0' }); } catch { /* nem végzetes */ } }
  if (!names.includes('custom_tags')) { try { await HR.exec({ db: 'radar', sql: "ALTER TABLE memory ADD COLUMN custom_tags TEXT DEFAULT ''" }); } catch { /* nem végzetes */ } }
  // gyorsító index (egyszeri): a státusz szerinti számlálás és szűrés nagy táblán is gyors marad
  try {
    const ix = await qVal('radar', "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_memory_status'");
    if (!ix) {
      toast('⏳ Gyorsító index készítése (egyszeri, pár másodperc)…', 6000);
      await HR.exec({ db: 'radar', sql: 'CREATE INDEX IF NOT EXISTS idx_memory_status ON memory(status, protected)' });
    }
  } catch { /* az index nem kötelező */ }
}

const TRIAGE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS decisions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     source TEXT NOT NULL, article_key TEXT NOT NULL,
     title TEXT, domain TEXT, date TEXT,
     decision TEXT, reason TEXT, protected INTEGER DEFAULT 0,
     ai_decision TEXT, ai_reason TEXT, ai_score INTEGER,
     created_at TEXT, updated_at TEXT, ai_content TEXT,
     UNIQUE(source, article_key))`,
  'CREATE INDEX IF NOT EXISTS idx_source ON decisions(source)',
  'CREATE INDEX IF NOT EXISTS idx_decision ON decisions(decision)',
  'CREATE INDEX IF NOT EXISTS idx_protected ON decisions(protected)',
];
async function ensureTriage() {
  for (const sql of TRIAGE_SCHEMA) await HR.exec({ db: 'triage', sql });
  const names = (await q('triage', 'PRAGMA table_info(decisions)')).map(r => r[1]);
  if (!names.includes('ai_content')) await HR.exec({ db: 'triage', sql: 'ALTER TABLE decisions ADD COLUMN ai_content TEXT' });
}

// ── engedély + adatbázisok megnyitása ──────────────────────────────────────────
async function refreshPerm() {
  const box = $('perm-box');
  let granted = false;
  try {
    const i = await HR.info();
    granted = !!i.granted;
    box.className = 'box ' + (granted ? 'ok' : 'no');
    box.textContent = granted ? 'Fájlkezelési engedély: megvan ✔' : 'A „Minden fájl kezelése" engedély hiányzik ✘';
  } catch (e) {
    box.className = 'box no';
    box.textContent = 'Az engedély állapota nem kérdezhető le: ' + errText(e);
  }
  $('perm-btn').style.display = granted ? 'none' : '';
  return granted;
}

function setDbLabel(txt) { $('db-lbl').textContent = txt; }

async function openAll(quiet) {
  lastAction = null; allTagsCache = null; allTagsLoading = null; cmapCache = null;
  if (bmOpened) { bmOpened = false; try { await HR.closeDb({ db: 'bm' }); } catch { /* nem végzetes */ } }
  const lines = [];
  if (!(await refreshPerm())) {
    radarOpen = false; triageOpen = false; setDbLabel('Nincs fájlkezelési engedély');
    $('db-status-info').textContent = '';
    if (!quiet) toast('⚠️ Előbb add meg a fájlkezelési engedélyt', 3500);
    allIds = []; cur = null; showEmpty();
    return false;
  }
  let sizeTxt = '';
  try {
    const r = await HR.openDb({ db: 'radar', path: getPath('radar') });
    await ensureRadar();
    radarOpen = true; sizeTxt = `${(r.size / 1048576).toFixed(0)} MB`;
    lines.push(`Hír-Radar: ✔ ${sizeTxt}`);
  } catch (e) {
    radarOpen = false;
    lines.push('Hír-Radar: ✘ ' + errText(e));
    toast('❌ ' + errText(e), 5000);
  }
  try {
    const r = await HR.openDb({ db: 'triage', path: getPath('triage'), create: true });
    await ensureTriage();
    triageOpen = true; triageNote = r.created ? 'új triage.db létrehozva' : '';
    lines.push(`Triage: ✔ ${(r.size / 1048576).toFixed(1)} MB${r.created ? ' (újonnan létrehozva)' : ''}`);
  } catch (e) {
    triageOpen = false; triageNote = errText(e);
    lines.push('Triage: ✘ ' + errText(e));
  }
  $('db-status-info').innerHTML = lines.map(esc).join('<br>');
  if (!radarOpen) {
    setDbLabel('A radar_memory.db nem nyitható meg');
    allIds = []; cur = null; showEmpty();
    return false;
  }
  setDbLabel(`radar_memory.db · ${sizeTxt}${triageOpen ? ' · triage ✔' : ' · triage ✘'}`);
  await loadRecords();
  scheduleStats(0);
  if (!quiet) toast('✅ Adatbázisok megnyitva' + (triageNote && triageOpen ? ' – ' + triageNote : ''));
  return true;
}

// ── modálok + Android vissza gomb ──────────────────────────────────────────────
function showModal(id) {
  if (!modalStack.includes(id)) modalStack.push(id);
  $(id).classList.add('show');
}
function closeModal(id) {
  $(id).classList.remove('show');
  const i = modalStack.indexOf(id); if (i >= 0) modalStack.splice(i, 1);
}
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(b.dataset.close)));
document.querySelectorAll('.modal-overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o) closeModal(o.id); }));

let lastBack = 0;
function handleBack() {
  if (modalStack.length) { closeModal(modalStack[modalStack.length - 1]); return; }
  const now = Date.now();
  if (now - lastBack < 2000) { try { CapApp.exitApp(); } catch { /* böngészőben nincs */ } return; }
  lastBack = now; toast('Nyomd meg még egyszer a kilépéshez', 2000);
}
window.__hrBack = handleBack;                 // a teszteléshez
try { CapApp.addListener('backButton', handleBack); } catch { /* böngészőben nincs Vissza gomb */ }

// ── billentyűzet: a mezők ne kerüljenek a billentyűzet mögé ────────────────────
// (ha az Android nem kicsinyíti a nézetet, a visualViewport mégis jelzi a billentyűzet magasságát)
function fitKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  document.documentElement.style.setProperty('--kb', kb > 80 ? kb + 'px' : '0px');
  if (kb > 80 && document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) {
    setTimeout(() => { try { document.activeElement.scrollIntoView({ block: 'nearest' }); } catch { /* nem végzetes */ } }, 60);
  }
}
if (window.visualViewport) { window.visualViewport.addEventListener('resize', fitKeyboard); window.visualViewport.addEventListener('scroll', fitKeyboard); }
window.__hrFitKeyboard = fitKeyboard;

// ── sorok elrejtése ────────────────────────────────────────────────────────────
function applyRows() {
  $('nav-row').style.display = rowsVisible ? '' : 'none';
  $('mode-row').style.display = rowsVisible ? '' : 'none';
  $('toggle-rows-btn').textContent = rowsVisible ? '▲' : '▼';
}
$('toggle-rows-btn').onclick = () => { rowsVisible = !rowsVisible; applyRows(); lsSet('hr_rows_visible', rowsVisible ? '1' : '0'); };

// ── témaváltó ───────────────────────────────────────────────────────────────────
$('theme-btn').onclick = () => {
  const light = document.body.classList.toggle('light');
  $('theme-btn').textContent = light ? '☀️' : '🌙';
  lsSet('hr_theme', light ? 'light' : 'dark');
};

// ── színek ──────────────────────────────────────────────────────────────────────
const COLOR_DEFAULTS = { navIcon: '#9aa0b8', tagChip: '#9aa0b8', domainChip: '#4a9eff', dateChip: '#6b7289', titleColor: '#e8eaf0', urlColor: '#9aa0b8', statsColor: '#9aa0b8' };
const COLOR_INPUT_MAP = { nav: 'navIcon', tag: 'tagChip', domain: 'domainChip', date: 'dateChip', title: 'titleColor', url: 'urlColor', stats: 'statsColor' };
const CSS_VARS = { navIcon: '--nav-icon-color', tagChip: '--tag-chip-color', domainChip: '--domain-chip-color', dateChip: '--date-chip-color', titleColor: '--title-color', urlColor: '--url-color', statsColor: '--stats-color' };
function getStoredColors() {
  try { return Object.assign({}, COLOR_DEFAULTS, JSON.parse(lsGet('hr_colors', '{}'))); }
  catch { return { ...COLOR_DEFAULTS }; }
}
function applyColors(c) {
  const r = document.documentElement.style;
  Object.entries(CSS_VARS).forEach(([k, v]) => r.setProperty(v, c[k] || COLOR_DEFAULTS[k]));
}
const HEX = /^#[0-9a-fA-F]{6}$/;
Object.keys(COLOR_INPUT_MAP).forEach(k => {
  $('col-' + k).addEventListener('input', () => { const v = $('col-' + k).value.trim(); if (HEX.test(v)) $('prev-' + k).style.background = v; });
});

// ── beállítások ────────────────────────────────────────────────────────────────
const DEL_COND = "status = 'DELETED' AND (protected IS NULL OR protected != 1)";
// védett és egyben törlésre jelölt (🗑) cikk nem létezhet; a javítás 🟢 újra állítja (a védelem marad)
const PROT_DEL_COND = "status = 'DELETED' AND protected = 1";
async function refreshFixCount() {
  const btn = $('fix-prot-btn');
  if (!radarOpen) { btn.textContent = '🔧 Javítás'; btn.disabled = true; return; }
  try {
    const n = await qVal('radar', `SELECT COUNT(*) FROM memory WHERE ${PROT_DEL_COND}`);
    btn.disabled = !n;
    btn.textContent = n ? `🔧 Javítás (${fmt(n)} cikk)` : '✔ Nincs ilyen cikk';
  } catch { btn.disabled = true; }
}
$('fix-prot-btn').onclick = async () => {
  if (!radarOpen) { toast('⚠️ Nincs megnyitott adatbázis'); return; }
  try {
    const n = await qVal('radar', `SELECT COUNT(*) FROM memory WHERE ${PROT_DEL_COND}`);
    if (!n) { toast('Nincs védett és törlésre jelölt cikk'); return; }
    if (!confirm(`${fmt(n)} cikk védett és egyben törlésre jelölt.\n\nA javítás 🟢 újra állítja őket (a védelem marad). A triage-döntésükhöz nem nyúl.`)) return;
    const r = await run('radar', `UPDATE memory SET status = 'SEEN' WHERE ${PROT_DEL_COND}`);
    lastAction = null;
    toast(`🔧 Javítva: ${fmt(r.changes)} cikk`, 3500);
    await loadRecords(); scheduleStats(0); refreshFixCount(); refreshDeletableCount();
  } catch (e) { toast('❌ ' + errText(e), 4000); }
};
// 🧠 hiányzó triage-sorok pótlása: a 💙 / 📖 cikkekhez (az asztali Hír-Radarban eldöntöttekhez), amelyeknek nincs triage-sora.
// A 🗑 kimarad: az exportált cikk is 🗑, abból nem derül ki a döntés. A meglévő triage-sorokhoz és a radarhoz nem nyúl.
async function triFillList() {
  if (!radarOpen || !triageOpen) return null;
  const have = new Set((await q('triage', "SELECT article_key FROM decisions WHERE source = 'hr'")).map(r => r[0]));
  const rows = await q('radar', "SELECT url, source, title, add_date, status, protected FROM memory WHERE status IN ('MARKED', 'READING')");
  return rows.filter(r => r[0] && !have.has(r[0]));
}
async function refreshTriFillCount() {
  const btn = $('fill-tri-btn');
  try {
    const list = await triFillList();
    if (list === null) { btn.textContent = '🧠 Pótlás'; btn.disabled = true; return; }
    btn.disabled = !list.length;
    btn.textContent = list.length ? `🧠 Pótlás (${fmt(list.length)} cikk)` : '✔ Nincs hiányzó triage-sor';
  } catch { btn.disabled = true; }
}
$('fill-tri-btn').onclick = async () => {
  try {
    const list = await triFillList();
    if (list === null) { toast('⚠️ A radar és a triage adatbázis is legyen megnyitva'); return; }
    if (!list.length) { toast('Nincs hiányzó triage-sor'); return; }
    const nm = list.filter(r => r[4] === 'MARKED').length, nr = list.length - nm;
    if (!confirm(`${fmt(list.length)} cikkhez nincs triage-sor (💙 ${fmt(nm)} · 📖 ${fmt(nr)}).\n\nLétrehozom őket indoklás nélkül (menteni / olvasni döntéssel). A meglévő triage-sorokhoz és a radarhoz nem nyúlok. Mehet?`)) return;
    const now = tsNow();
    const ops = list.map(r => ({
      sql: "INSERT INTO decisions (source, article_key, title, domain, date, decision, reason, protected, created_at, updated_at) VALUES ('hr', ?, ?, ?, ?, ?, '', ?, ?, ?)",
      params: [r[0], r[2] || '', r[1] || '', String(r[3] || '').slice(0, 10), r[4] === 'MARKED' ? 'menteni' : 'olvasni', r[5] ? 1 : 0, now, now],
    }));
    for (let i = 0; i < ops.length; i += 500) await HR.batch({ db: 'triage', ops: ops.slice(i, i + 500) });
    lastAction = null;
    toast(`🧠 Pótolva: ${fmt(list.length)} triage-sor`, 3500);
    scheduleStats(0); refreshTriFillCount();
    if (viewMode === 'tri') await loadRecords();
  } catch (e) { toast('❌ ' + errText(e), 4000); }
};
async function refreshDeletableCount() {
  refreshFixCount();
  refreshTriFillCount();
  const btn = $('del-all-btn');
  if (!radarOpen) { btn.textContent = '🗑 Összes törölni jelölt cikk törlése'; btn.disabled = true; return; }
  try {
    const n = await qVal('radar', `SELECT COUNT(*) FROM memory WHERE ${DEL_COND}`);
    btn.textContent = `🗑 Összes törölni jelölt cikk törlése (${fmt(n)})`; btn.disabled = !n;
  } catch { btn.textContent = '🗑 Összes törölni jelölt cikk törlése'; btn.disabled = false; }
}
async function showSettings() {
  $('path-radar').value = getPath('radar'); $('path-triage').value = getPath('triage'); $('path-bm').value = getPath('bm');
  const c = getStoredColors();
  Object.entries(COLOR_INPUT_MAP).forEach(([k, key]) => { $('col-' + k).value = c[key]; $('prev-' + k).style.background = c[key]; });
  $('btn-lock-sec').value = btnLockMs / 1000;
  $('mhtml-result').style.display = 'none';
  showModal('settings-modal-overlay');
  await refreshPerm();
  await refreshDeletableCount();
  refreshMhtmlSummary();
}
$('btn-colors').onclick = showSettings;
$('color-apply-btn').onclick = () => {
  const c = {};
  Object.entries(COLOR_INPUT_MAP).forEach(([k, key]) => { const v = $('col-' + k).value.trim(); c[key] = HEX.test(v) ? v : COLOR_DEFAULTS[key]; });
  lsSet('hr_colors', JSON.stringify(c)); applyColors(c); toast('🎨 Színek mentve!');
};
$('color-reset-btn').onclick = () => {
  lsDel('hr_colors'); applyColors(COLOR_DEFAULTS);
  Object.entries(COLOR_INPUT_MAP).forEach(([k, key]) => { $('col-' + k).value = COLOR_DEFAULTS[key]; $('prev-' + k).style.background = COLOR_DEFAULTS[key]; });
  toast('↩ Alapértelmezett színek visszaállítva');
};
$('perm-btn').onclick = async () => {
  try { await HR.openSettings(); toast('Kapcsold be az engedélyt, majd lépj vissza ide.', 4000); }
  catch (e) { toast('A beállítások nem nyithatók meg: ' + errText(e), 4000); }
};
$('paths-default-btn').onclick = () => { $('path-radar').value = DEFAULT_PATHS.radar; $('path-triage').value = DEFAULT_PATHS.triage; $('path-bm').value = DEFAULT_PATHS.bm; };
$('paths-save-btn').onclick = async () => {
  for (const w of ['radar', 'triage', 'bm']) {
    const v = $('path-' + w).value.trim().replace(/\/+$/, '');
    if (v && v !== DEFAULT_PATHS[w]) lsSet('hr_path_' + w, v); else lsDel('hr_path_' + w);
  }
  if (await openAll(false)) closeModal('settings-modal-overlay');
};
document.addEventListener('visibilitychange', () => { if (!document.hidden && $('settings-modal-overlay').classList.contains('show')) refreshPerm(); });

$('del-all-btn').onclick = async () => {
  if (!radarOpen) { toast('⚠️ Nincs megnyitott adatbázis'); return; }
  try {
    const n = await qVal('radar', `SELECT COUNT(*) FROM memory WHERE ${DEL_COND}`);
    if (!n) { toast('Nincs törölni jelölt cikk'); return; }
    if (!confirm(`Véglegesen törlöd mind a ${fmt(n)} törölni jelölt cikket a radar_memory.db-ből?\n\nEz nem vonható vissza.`)) return;
    const r = await run('radar', `DELETE FROM memory WHERE ${DEL_COND}`);
    lastAction = null;
    toast(`🗑 Véglegesen törölve: ${fmt(r.changes)} cikk`, 3500);
    await loadRecords(); scheduleStats(0); refreshDeletableCount();
  } catch (e) { toast('❌ ' + errText(e), 4000); }
};

// ── lista: csak sorazonosítók ──────────────────────────────────────────────────
const MODE_SQL = {
  all: "status IN ('SEEN','READING','MARKED')",
  prot: "status != 'EXPORTED' AND protected = 1",
  saved: "status = 'MARKED'",
  read: "status = 'READING'",
  del: "status = 'DELETED'",
};
const FIELD_COL = { title: 'title', source: 'source', date: 'add_date', url: 'url' };
const TRI_FIELD_COL = { title: 'title', source: 'domain', date: 'date', url: 'article_key' };
function searchFields() {
  const f = ['title', 'source', 'date', 'url'].filter(k => $('chk-' + k).checked);
  return f.length ? f : ['title', 'source', 'date', 'url'];
}
function baseWhere(withMode = true) {
  const where = [], params = [];
  if (withMode) where.push(MODE_SQL[viewMode]);
  if (flt.sel.size) {
    const list = [...flt.sel];
    const ph = list.map(() => '?').join(',');
    where.push(`COALESCE(source, '') ${flt.excl ? 'NOT IN' : 'IN'} (${ph})`);
    params.push(...list);
  }
  if (flt.onlyNew && viewMode === 'all') where.push("status = 'SEEN'");     // csak a ✨ listában: az el nem döntött cikkek
  return { where, params };
}

// 🧠 triage-lista: a triage.db `decisions` sorai (source = 'hr'). draft: a szűrőablak vázlata (élő darabszámhoz)
function triWhere(draft, noRovat) {
  const t = draft || tflt;
  const where = ["source = 'hr'"], params = [];
  if (t.dec.size) { const l = [...t.dec]; where.push(`decision IN (${l.map(() => '?').join(',')})`); params.push(...l); }
  else where.push("COALESCE(decision, '') <> ''");
  if (t.noReason) where.push("TRIM(COALESCE(reason, '')) = ''");
  if (t.ai === 'diff') where.push("COALESCE(ai_decision, '') <> '' AND ai_decision <> decision");
  else if (t.ai === 'same') where.push("COALESCE(ai_decision, '') <> '' AND ai_decision = decision");
  else if (t.ai === 'none') where.push("COALESCE(ai_decision, '') = ''");
  if (!noRovat && flt.sel.size) {
    const list = [...flt.sel];
    where.push(`COALESCE(domain, '') ${flt.excl ? 'NOT IN' : 'IN'} (${list.map(() => '?').join(',')})`);
    params.push(...list);
  }
  return { where, params };
}

async function loadRecords(focusId) {
  const tri = viewMode === 'tri';
  if (tri ? !triageOpen : !radarOpen) { allIds = []; idx = 0; cur = null; showEmpty(); return; }
  const tok = ++listTok;
  $('stat-pos').textContent = '⏳';
  const { where, params } = tri ? triWhere() : baseWhere();
  const db = tri ? 'triage' : 'radar', idCol = tri ? 'id' : 'rowid', table = tri ? 'decisions' : 'memory', dateCol = tri ? 'date' : 'add_date';
  const order = sortMode === 'asc' ? `ORDER BY ${dateCol} ASC` : sortMode === 'desc' ? `ORDER BY ${dateCol} DESC` : '';
  const shuffle = sortMode === 'random';
  const text = $('search-input').value.trim();
  let res;
  try {
    if (text.length >= 3) {
      const cols = searchFields().map(f => (tri ? TRI_FIELD_COL : FIELD_COL)[f]);
      res = await HR.searchIds({
        db, sql: `SELECT ${idCol}, ${cols.join(', ')} FROM ${table} WHERE ${where.join(' AND ')} ${order}`,
        params, needle: text, word: $('chk-word').checked, shuffle,
      });
    } else {
      res = await HR.queryIds({ db, sql: `SELECT ${idCol} FROM ${table} WHERE ${where.join(' AND ')} ${order}`, params, shuffle });
    }
  } catch (e) { if (tok === listTok) { allIds = []; toast('❌ ' + errText(e), 4000); } res = null; }
  if (tok !== listTok) return;                       // közben újabb kérés indult
  allIds = res ? parseCsv(res.csv) : [];
  idx = 0;
  if (focusId != null) { const p = allIds.indexOf(Number(focusId)); if (p >= 0) idx = p; }
  await renderCard();
}

async function getTri(url) {
  if (!triageOpen) return null;
  try {
    const rows = await q('triage', "SELECT decision, reason, protected, ai_decision, ai_reason, ai_score FROM decisions WHERE source = 'hr' AND article_key = ?", [url]);
    if (!rows.length) return null;
    const r = rows[0];
    return { decision: r[0], reason: r[1] || '', protected: r[2], ai_decision: r[3], ai_reason: r[4], ai_score: r[5] };
  } catch { return null; }
}
// triage-lista mód: a kártya a triage.db sorából épül (a végleg törölt cikkek is látszanak)
async function getTriRecord(id) {
  const rows = await q('triage', `SELECT id, article_key, title, domain, date, decision, reason, protected, ai_decision, ai_reason, ai_score FROM decisions WHERE id = ${rid(id)}`);
  if (!rows.length) return null;
  const r = rows[0];
  const rec = { kind: 'tri', id: r[0], url: r[1] || '', title: r[2] || '', source: r[3] || '', date: r[4] || '', status: '', prot: r[7] ? 1 : 0, tags: '',
    tri: { decision: r[5], reason: r[6] || '', protected: r[7], ai_decision: r[8], ai_reason: r[9], ai_score: r[10] }, radarStatus: null };
  if (radarOpen && rec.url) {
    try { const sr = await q('radar', 'SELECT status FROM memory WHERE url = ?', [rec.url]); rec.radarStatus = sr.length ? (sr[0][0] || 'SEEN') : ''; } catch { /* nem végzetes */ }
  }
  return rec;
}
async function getRecord(id) {
  if (viewMode === 'tri') return getTriRecord(id);
  const rows = await q('radar', `SELECT rowid, url, source, title, status, add_date, protected, custom_tags FROM memory WHERE rowid = ${rid(id)}`);
  if (!rows.length) return null;
  const r = rows[0];
  const rec = { id: r[0], url: r[1] || '', source: r[2] || '', title: r[3] || '', status: r[4] || 'SEEN', date: r[5] || '', prot: r[6] ? 1 : 0, tags: r[7] || '', tri: null };
  rec.tri = await getTri(rec.url);
  return rec;
}

// ── statisztika (indexről, egyetlen lekérdezés) ────────────────────────────────
function scheduleStats(ms = 500) { clearTimeout(statsTimer); statsTimer = setTimeout(refreshStats, ms); }
// a gombok alatti számok: a hosszú (7+ karakteres, pl. „123 456”) kisebb betűvel, hogy hat gombnál is elférjen
function fitModeNums() {
  document.querySelectorAll('#mode-row .mn').forEach(e => e.classList.toggle('long', e.textContent.length >= 7));
}
async function refreshStats() {
  if (!radarOpen) return;
  const tok = ++statsTok;
  try {
    const rows = await q('radar', "SELECT status, COUNT(*), SUM(CASE WHEN protected = 1 THEN 1 ELSE 0 END) FROM memory GROUP BY status");
    let total = 0, prot = 0; const by = {};
    for (const [st, n, p] of rows) { if (st === 'EXPORTED') continue; total += n; prot += (p || 0); by[st] = n; }
    let tri = null;
    if (triageOpen) { try { tri = await qVal('triage', "SELECT COUNT(*) FROM decisions WHERE source = 'hr' AND COALESCE(decision, '') <> ''"); } catch { /* nem kritikus */ } }
    if (tok !== statsTok) return;
    $('stat-total').textContent = fmt(total); $('stat-seen').textContent = fmt(by.SEEN || 0);
    $('stat-marked').textContent = fmt(by.MARKED || 0); $('stat-read').textContent = fmt(by.READING || 0);
    $('stat-del').textContent = fmt(by.DELETED || 0); $('stat-prot').textContent = fmt(prot);
    $('stat-tri').textContent = tri == null ? '–' : fmt(tri);
    $('exp-count').textContent = fmt((by.MARKED || 0) + (by.READING || 0));
    fitModeNums();
  } catch { /* a statisztika nem kritikus */ }
}

// ── megjelenítés ────────────────────────────────────────────────────────────────
const EMPTY_MSGS = {
  all: 'Nincs találat.', prot: 'Nincs védett cikk.', saved: 'A 💙 „Menteni" lista üres.',
  read: 'Az 📖 „Olvasni" lista üres.', del: 'A 🗑 „Törölni" lista üres.',
  tri: 'Nincs triage-döntés ezzel a szűrővel.',
};
const DEC_LABEL = { menteni: '💙 menteni', olvasni: '📖 olvasni', torolni: '🗑 törölni', bizonytalan: '❓ bizonytalan' };

function showEmpty() {
  $('card-content').style.display = 'none'; $('empty-state').style.display = 'flex';
  $('empty-msg').innerHTML = radarOpen
    ? esc(EMPTY_MSGS[viewMode] || 'Nincs találat.') + (viewMode === 'tri' && triFiltActive() ? '<br><br>🧠 Szűrő aktív – a 🧠 gombbal módosítható.' : '') + (fltActive() ? '<br><br>📁 Rovat-szűrő aktív – a 📁 gombbal kapcsolható ki.' : '')
    : 'Nincs adatbázis megnyitva.<br><br>Koppints a ⚙️ gombra az útvonalakhoz és az engedélyhez.';
  $('stat-pos').textContent = '–';
  $('reason-input').value = '';
  ['act-prot', 'act-read', 'act-save', 'act-del'].forEach(i => $(i).classList.remove('on'));
}

async function renderCard() {
  const tok = ++renderTok;
  const total = allIds.length;
  if (!total) { cur = null; showEmpty(); return; }
  idx = clamp(idx, 0, total - 1);
  $('stat-pos').textContent = `${idx + 1}/${fmt(total)}`;
  let rec = null;
  try { rec = await getRecord(allIds[idx]); } catch (e) { toast('❌ ' + errText(e), 4000); }
  if (tok !== renderTok) return;                      // közben újabb kérés indult
  if (!rec) {                                         // időközben kikerült az adatbázisból
    allIds.splice(idx, 1); await renderCard(); return;
  }
  cur = rec; paintCard(rec);
  $('card-area').scrollTop = 0;
}

function paintCard(r) {
  refreshOpenBtn(r);
  $('card-content').style.display = 'block'; $('empty-state').style.display = 'none';
  $('card-domain').textContent = (r.source || '–').toUpperCase();
  $('card-date').textContent = r.date || '–';

  let si = '';
  if (r.prot) si += '🔒';
  if (r.status === 'READING') si += (si ? ' ' : '') + '📖';
  if (r.status === 'MARKED') si += (si ? ' ' : '') + '💙';
  if (r.status === 'DELETED') si += (si ? ' ' : '') + '🗑';
  $('card-status-icons').textContent = si;

  const tagsEl = $('card-tags');
  const tl = String(r.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  if (tl.length) { tagsEl.innerHTML = tl.map(t => `<span class="tag-chip">${esc(t)}</span>`).join(''); tagsEl.style.display = 'flex'; }
  else { tagsEl.innerHTML = ''; tagsEl.style.display = 'none'; }

  $('card-title').textContent = r.title || '(nincs cím)';
  $('card-url').textContent = r.url ? (r.url.length > 140 ? r.url.slice(0, 140) + '…' : r.url) : '';

  const tri = r.tri; let th = '';
  if (tri && tri.decision) th += `<div class="tri-box">🧠 Triage-döntés: <b>${esc(DEC_LABEL[tri.decision] || tri.decision)}</b></div>`;
  if (r.kind === 'tri' && r.radarStatus != null) {
    const RL = { SEEN: '🟢 új (még el nem döntött)', MARKED: '💙 menteni', READING: '📖 olvasni', DELETED: '🗑 törlésre jelölt', EXPORTED: 'exportált' };
    th += `<div class="tri-box">📰 Hír-Radar: <b>${r.radarStatus === '' ? 'nincs a radar_memory.db-ben (törölve / exportálva)' : esc(RL[r.radarStatus] || r.radarStatus)}</b></div>`;
  }
  if (tri && tri.ai_decision) {
    th += `<div class="tri-box ai">🤖 AI: <b>${esc(DEC_LABEL[tri.ai_decision] || tri.ai_decision)}</b>${tri.ai_score != null ? ` (${esc(tri.ai_score)}%)` : ''}${tri.ai_reason ? '\n' + esc(tri.ai_reason) : ''}</div>`;
  }
  $('card-tri').innerHTML = th;

  $('reason-input').value = tri ? tri.reason : '';
  $('act-prot').classList.toggle('on', !!r.prot);
  $('act-read').classList.toggle('on', r.status === 'READING');
  $('act-save').classList.toggle('on', r.status === 'MARKED');
  $('act-del').classList.toggle('on', r.status === 'DELETED');
}

// ── navigáció ───────────────────────────────────────────────────────────────────
function reasonUnsaved() {
  const v = $('reason-input').value.trim();
  return !!v && v !== ((cur && cur.tri && cur.tri.reason) || '').trim();
}
function warnReason() { if (reasonUnsaved()) toast('💬 Az indoklás nem mentődött (nem döntöttél)', 2500); }
function goPrev() { if (!allIds.length) return; warnReason(); idx = (idx - 1 + allIds.length) % allIds.length; return renderCard(); }
function goNext() { if (!allIds.length) return; warnReason(); idx = (idx + 1) % allIds.length; return renderCard(); }
let txStart = 0, tyStart = 0;
const cardArea = $('card-area');
cardArea.addEventListener('touchstart', e => { txStart = e.touches[0].clientX; tyStart = e.touches[0].clientY; }, { passive: true });
cardArea.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - txStart, dy = e.changedTouches[0].clientY - tyStart;
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) { dx < 0 ? goNext() : goPrev(); }
}, { passive: true });
window.__hrNav = { goPrev, goNext };           // a teszteléshez

// ── rendezés: ⬇/⬆ dátum + véletlen ─────────────────────────────────────────────
function paintSortButtons() {
  const b = $('btn-sort');
  b.textContent = sortMode === 'asc' ? '⬆' : '⬇';
  b.title = sortMode === 'asc' ? 'Dátum szerint: a legrégebbi elöl' : 'Dátum szerint: a legújabb elöl';
  b.className = 'nb' + (sortMode === 'random' ? '' : ' on');
  $('btn-shuffle').className = 'nb' + (sortMode === 'random' ? ' on' : '');
}
$('btn-sort').onclick = () => {
  sortMode = sortMode === 'desc' ? 'asc' : 'desc';          // az első nyomás a legújabbal kezd
  lsSet('hr_sort', sortMode); paintSortButtons(); loadRecords();
  toast(sortMode === 'desc' ? '⬇ Dátum szerint: a legújabb elöl' : '⬆ Dátum szerint: a legrégebbi elöl');
};
$('btn-shuffle').onclick = () => { sortMode = 'random'; lsSet('hr_sort', sortMode); paintSortButtons(); loadRecords(); toast('🔀 Összekeverve!'); };

// ── módok ───────────────────────────────────────────────────────────────────────
const modeBtnMap = { tri: 'btn-mode-tri', prot: 'btn-mode-prot', saved: 'btn-mode-saved', read: 'btn-mode-read', del: 'btn-mode-del', all: 'btn-mode-all' };
const modeCls = { tri: 'on-green', prot: 'on-purple', saved: 'on', read: 'on-amber', del: 'on-red', all: 'on' };
function paintTriMode() {
  const on = viewMode === 'tri';
  document.body.classList.toggle('tri-mode', on);
  $('btn-mode-tri').classList.toggle('filt', on && triFiltActive());
  $('reason-label').textContent = on ? '💬 Indoklás (a döntés nem változik)' : '💬 Miért? (opcionális)';
  $('reason-input').placeholder = on ? '✍️ Írd le, miért ez a helyes döntés…' : '✍️ Írj indoklást, majd nyomj döntés gombot…';
}
function setMode(mode, focusId) {
  if ((mode === 'tri') !== (viewMode === 'tri')) lastAction = null;       // a visszavonás nem léphet át a két lista között
  viewMode = mode;
  Object.keys(modeBtnMap).forEach(m => { const b = $(modeBtnMap[m]); b.className = 'nb mb'; if (m === mode) b.classList.add(modeCls[m]); });
  paintTriMode();
  idx = 0; scheduleStats(300); return loadRecords(focusId);
}
Object.entries(modeBtnMap).forEach(([m, id]) => { if (m !== 'tri') $(id).onclick = () => setMode(m); });

// ── rovat szűrő ─────────────────────────────────────────────────────────────────
// A névre koppintás: csak az a rovat (azonnal). A jelölőnégyzetekkel több rovat is választható → ✔ Alkalmaz.
// „Kivéve”: a kijelölt rovatok kimaradnak. „Csak új”: a ✨ listában csak az el nem döntött (🟢) cikkek.
let rovatRows = [], rovatDraft = new Set(), rovatSortAz = lsGet('hr_rovat_sort') === 'az';
function paintRovatBtn() {
  const b = $('btn-rovat'), n = flt.sel.size;
  b.textContent = '📁' + (n ? n : (flt.onlyNew ? '●' : ''));
  b.className = 'nb' + (!fltActive() ? '' : flt.excl && n ? ' on-amber' : ' on');
  b.title = fltActive() ? 'Rovat-szűrő (aktív)' : 'Rovat-szűrő';
}
function clearRovat() { flt.sel.clear(); flt.excl = false; flt.onlyNew = false; paintRovatBtn(); }
function rovatLabel(src) { return src === '' ? '(nincs rovat)' : src; }
function renderRovatList() {
  const needle = $('rovat-search').value.trim().toLocaleLowerCase('hu');
  const rows = rovatRows.filter(r => !needle || rovatLabel(r.src).toLocaleLowerCase('hu').includes(needle));
  rows.sort(rovatSortAz ? (a, b) => rovatLabel(a.src).localeCompare(rovatLabel(b.src), 'hu') : (a, b) => b.n - a.n);
  const showNew = viewMode === 'all';
  $('rovat-list').innerHTML = rows.length ? rows.map(r =>
    `<div class="rovat-item${rovatDraft.has(r.src) ? ' on' : ''}" data-r="${esc(r.src)}">` +
      `<span class="rv-box"><input type="checkbox" class="rv-chk"${rovatDraft.has(r.src) ? ' checked' : ''}></span>` +
      `<span class="rv-name">${esc(rovatLabel(r.src))}</span>` +
      `<span class="rovat-count">${fmt(r.n)}${showNew ? ` · 🟢${fmt(r.fresh)}` : ''}</span></div>`).join('')
    : '<div class="rovat-item"><span>Nincs ilyen rovat.</span></div>';
  paintRovatSum();
}
function paintRovatSum() {
  const picked = rovatRows.filter(r => rovatDraft.has(r.src));
  const tot = rovatRows.reduce((s, r) => s + r.n, 0), totNew = rovatRows.reduce((s, r) => s + r.fresh, 0);
  const sel = picked.reduce((s, r) => s + r.n, 0), selNew = picked.reduce((s, r) => s + r.fresh, 0);
  const excl = $('rovat-excl').checked, onlyNew = $('rovat-new').checked && viewMode === 'all';
  const n = rovatDraft.size;
  let cnt = n ? (excl ? tot - sel : sel) : tot, cntNew = n ? (excl ? totNew - selNew : selNew) : totNew;
  const shown = onlyNew ? cntNew : cnt;
  $('rovat-sum').textContent = (n ? `${n} rovat ${excl ? 'kivéve' : 'kijelölve'}` : 'Minden rovat') + ` → ${fmt(shown)} cikk` + (viewMode === 'all' && !onlyNew ? ` (ebből új: ${fmt(cntNew)})` : '');
  $('rovat-apply').textContent = n ? `✔ Alkalmaz (${n})` : '✔ Alkalmaz';
  $('rovat-sort-n').className = 'rv-sort' + (rovatSortAz ? '' : ' on');
  $('rovat-sort-az').className = 'rv-sort' + (rovatSortAz ? ' on' : '');
}
$('btn-rovat').onclick = async () => {
  const tri = viewMode === 'tri';
  if (tri ? !triageOpen : !radarOpen) { toast('⚠️ Nincs megnyitott adatbázis'); return; }
  rovatDraft = new Set(flt.sel);
  $('rovat-excl').checked = flt.excl; $('rovat-new').checked = flt.onlyNew;
  $('rovat-new-row').style.display = viewMode === 'all' ? '' : 'none';
  $('rovat-search').value = '';
  $('rovat-list').innerHTML = '<div class="rovat-item"><span>Betöltés…</span></div>';
  $('rovat-sum').textContent = '';
  showModal('rovat-modal-overlay');
  try {
    let rows;
    if (tri) { const w = triWhere(null, true); rows = await q('triage', `SELECT COALESCE(domain, ''), COUNT(*), 0 FROM decisions WHERE ${w.where.join(' AND ')} GROUP BY 1`, w.params); }
    else rows = await q('radar', `SELECT COALESCE(source, ''), COUNT(*), SUM(CASE WHEN status = 'SEEN' THEN 1 ELSE 0 END) FROM memory WHERE ${MODE_SQL[viewMode]} GROUP BY 1`);
    rovatRows = rows.map(([src, n, fresh]) => ({ src: String(src), n: n || 0, fresh: fresh || 0 }));
    renderRovatList();
  } catch (e) { $('rovat-list').innerHTML = `<div class="rovat-item"><span>❌ ${esc(errText(e))}</span></div>`; }
};
async function applyRovat(sel) {
  flt.sel = new Set(sel); flt.excl = $('rovat-excl').checked; flt.onlyNew = $('rovat-new').checked;
  closeModal('rovat-modal-overlay');
  paintRovatBtn();
  await loadRecords();
  if (fltActive()) {
    const names = [...flt.sel].map(rovatLabel);
    const what = names.length === 0 ? '🟢 csak új' : names.length <= 2 ? names.join(', ') : `${names.length} rovat`;
    toast(`📁 ${flt.excl && names.length ? 'Kivéve: ' : ''}${what} – ${fmt(allIds.length)} cikk`, 2500);
  } else toast('📁 Minden rovat', 1800);
}
$('rovat-list').addEventListener('click', e => {
  const it = e.target.closest('.rovat-item'); if (!it || it.dataset.r == null) return;
  const src = it.dataset.r;
  if (e.target.closest('.rv-box')) {                       // jelölőnégyzet: több rovat választása
    if (rovatDraft.has(src)) rovatDraft.delete(src); else rovatDraft.add(src);
    const on = rovatDraft.has(src);
    it.classList.toggle('on', on); it.querySelector('.rv-chk').checked = on;
    paintRovatSum();
  } else applyRovat([src]);                                // név: csak ez a rovat, azonnal
});
$('rovat-search').addEventListener('input', renderRovatList);
$('rovat-excl').addEventListener('change', paintRovatSum);
$('rovat-new').addEventListener('change', paintRovatSum);
$('rovat-sort-n').onclick = () => { rovatSortAz = false; lsSet('hr_rovat_sort', 'n'); renderRovatList(); };
$('rovat-sort-az').onclick = () => { rovatSortAz = true; lsSet('hr_rovat_sort', 'az'); renderRovatList(); };
$('rovat-apply').onclick = () => applyRovat(rovatDraft);
$('rovat-clear').onclick = () => { rovatDraft = new Set(); $('rovat-excl').checked = false; $('rovat-new').checked = false; applyRovat([]); };

// ── 🧠 triage-lista: belépés + szűrőablak ──────────────────────────────────────
// A 🧠 gomb a triage.db döntéseit listázza (a végleg törölt cikkek is benne vannak). Itt csak az indoklás szerkeszthető,
// a döntés nem változik. Szűrők: döntés · AI-eltérés · csak indoklás nélküliek (+ a 📁 rovat és a keresés).
const TRI_DECS = ['menteni', 'olvasni', 'torolni', 'bizonytalan'];
let triSumTok = 0;
function readTriDraft() {
  const dec = new Set(TRI_DECS.filter(k => $('tf-dec-' + k).checked));
  const sel = document.querySelector('input[name="tf-ai"]:checked');
  return { dec, ai: sel ? sel.value : 'all', noReason: $('tf-noreason').checked };
}
async function paintTriSum() {
  const tok = ++triSumTok;
  const w = triWhere(readTriDraft());
  try {
    const n = await qVal('triage', `SELECT COUNT(*) FROM decisions WHERE ${w.where.join(' AND ')}`, w.params);
    if (tok === triSumTok) $('tf-sum').textContent = `Ezzel a szűrővel: ${fmt(n)} cikk` + (flt.sel.size ? ' (a 📁 rovat-szűrővel együtt)' : '');
  } catch (e) { if (tok === triSumTok) $('tf-sum').textContent = '❌ ' + errText(e); }
}
function openTriFilter() {
  TRI_DECS.forEach(k => { $('tf-dec-' + k).checked = tflt.dec.has(k); });
  document.querySelectorAll('input[name="tf-ai"]').forEach(r => { r.checked = r.value === tflt.ai; });
  $('tf-noreason').checked = tflt.noReason;
  $('tf-sum').textContent = '…';
  showModal('tri-modal-overlay');
  paintTriSum();
}
document.querySelectorAll('#tri-modal-overlay input').forEach(i => i.addEventListener('change', paintTriSum));
async function applyTriFilter(d) {
  tflt.dec = d.dec; tflt.ai = d.ai; tflt.noReason = d.noReason;
  closeModal('tri-modal-overlay'); paintTriMode();
  await loadRecords();
  toast(triFiltActive() ? `🧠 Szűrő: ${fmt(allIds.length)} cikk` : `🧠 Minden triage-döntés: ${fmt(allIds.length)}`, 2200);
}
$('tf-apply').onclick = () => applyTriFilter(readTriDraft());
$('tf-clear').onclick = () => applyTriFilter({ dec: new Set(), ai: 'all', noReason: false });
$('btn-mode-tri').onclick = () => {
  if (!triageOpen) { toast('⚠️ A triage.db nincs megnyitva'); return; }
  if (viewMode !== 'tri') setMode('tri');                  // a második koppintás (már triage-módban) csak a szűrőt nyitja
  openTriFilter();
};

// ── keresés ─────────────────────────────────────────────────────────────────────
$('search-input').addEventListener('input', () => {
  const q0 = $('search-input').value;
  $('search-clear').style.display = q0 ? 'block' : 'none';
  clearTimeout(searchTimer);
  const t = q0.trim();
  if (t.length === 0 || t.length >= 3) searchTimer = setTimeout(() => loadRecords(), 450);
});
$('search-clear').onclick = () => { $('search-input').value = ''; $('search-clear').style.display = 'none'; loadRecords(); };
function paintSearchBtn() {
  const names = [['chk-title', 'Cím'], ['chk-source', 'Rovat'], ['chk-date', 'Dátum'], ['chk-url', 'URL']];
  const n = names.filter(([id]) => $(id).checked).map(([, t]) => t);
  const label = n.length ? n.join(', ') : 'Mind';
  $('search-fields-btn').textContent = '🔍 ' + (label.length > 14 ? label.slice(0, 14) + '…' : label) + ' ▾';
}
function updateSearchBtn() {
  paintSearchBtn();
  if ($('search-input').value.trim().length >= 3) loadRecords();
}
['chk-title', 'chk-source', 'chk-date', 'chk-url', 'chk-word'].forEach(id => $(id).addEventListener('change', updateSearchBtn));
$('search-fields-btn').onclick = () => showModal('search-modal-overlay');

// ── műveletek: döntés (radar + triage), védelem, visszavonás ───────────────────
const currentRec = () => (cur && allIds[idx] === cur.id ? cur : null);
const DEC_STATUS = { menteni: 'MARKED', olvasni: 'READING', torolni: 'DELETED' };

// Triage-sor beírása/frissítése. Visszatérés: true, ha új sor jött létre.
async function triUpsert(r, decision, reason, prot) {
  const now = tsNow(), date = String(r.date || '').slice(0, 10);
  const u = await run('triage',
    "UPDATE decisions SET title = ?, domain = ?, date = ?, decision = ?, reason = ?, protected = ?, updated_at = ? WHERE source = 'hr' AND article_key = ?",
    [r.title, r.source, date, decision, reason, prot ? 1 : 0, now, r.url]);
  if (u.changes > 0) return false;
  await run('triage',
    "INSERT INTO decisions (source, article_key, title, domain, date, decision, reason, protected, created_at, updated_at) VALUES ('hr', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [r.url, r.title, r.source, date, decision, reason, prot ? 1 : 0, now, now]);
  return true;
}

async function doDecide(decision) {
  const r = currentRec(); if (!r || r.kind === 'tri' || busy) return;
  if (decision === 'torolni' && r.prot) { toast('⚠️ Védett cikk, nem törölhető!'); return; }
  busy = true;
  try {
    const target = DEC_STATUS[decision];
    const off = r.status === target;                         // ugyanaz újra: visszaáll (SEEN / döntés nélkül)
    const newStatus = off ? 'SEEN' : target, newDec = off ? null : decision;
    const reason = $('reason-input').value.trim();
    const snap = { type: 'decide', id: r.id, url: r.url, status: r.status, prot: r.prot, tri: r.tri ? { ...r.tri } : null, triAdded: false };
    await run('radar', 'UPDATE memory SET status = ? WHERE rowid = ?', [newStatus, r.id]);
    let note = '';
    if (triageOpen) {
      try { snap.triAdded = await triUpsert(r, newDec, reason, r.prot); }
      catch (e) { note = ' ⚠️ triage: ' + errText(e); }
    } else note = ' ⚠️ triage.db nincs megnyitva';
    lastAction = snap;
    scheduleStats();
    const labels = { MARKED: '💙 Mentésre jelölve', READING: '📖 Olvasásra jelölve', DELETED: '🗑 Törlésre jelölve', SEEN: '↩ Visszaállítva' };
    toast((labels[newStatus] || '✓') + (reason && newDec ? ' + indoklás' : '') + note, note ? 4000 : 2000);
    if (newDec) { $('reason-input').value = ''; idx = (idx + 1) % Math.max(1, allIds.length); await renderCard(); }   // döntés után tovább
    else await renderCard();
  } catch (e) { toast('❌ ' + errText(e), 4000); }
  finally { busy = false; }
}

async function doProtect() {
  const r = currentRec(); if (!r || r.kind === 'tri' || busy) return;
  if (!r.prot && r.status === 'DELETED') { toast('⚠️ Törlésre jelölt cikk nem védhető – előbb állítsd vissza', 3500); return; }   // védett + 🗑 kizárja egymást
  busy = true;
  try {
    const nv = r.prot ? 0 : 1;
    const snap = { type: 'protect', id: r.id, url: r.url, prot: r.prot, triAdded: false, hadTri: !!r.tri };
    await run('radar', 'UPDATE memory SET protected = ? WHERE rowid = ?', [nv, r.id]);
    let note = '';
    if (triageOpen) {
      try {
        const u = await run('triage', "UPDATE decisions SET protected = ?, updated_at = ? WHERE source = 'hr' AND article_key = ?", [nv, tsNow(), r.url]);
        if (!u.changes) { snap.triAdded = await triUpsert(r, null, '', nv); }
      } catch (e) { note = ' ⚠️ triage: ' + errText(e); }
    } else note = ' ⚠️ triage.db nincs megnyitva';
    lastAction = snap;
    scheduleStats();
    toast((nv ? '🔒 Védelem beállítva' : '🔓 Védelem levéve') + note, note ? 4000 : 2000);
    await renderCard();
  } catch (e) { toast('❌ ' + errText(e), 4000); }
  finally { busy = false; }
}

async function doUndo() {
  if (!lastAction) { toast('Nincs visszavonható művelet'); return; }
  if (busy) return;
  busy = true;
  const a = lastAction;
  try {
    if (a.type === 'decide') {
      await run('radar', 'UPDATE memory SET status = ?, protected = ? WHERE rowid = ?', [a.status, a.prot ? 1 : 0, a.id]);
      if (triageOpen) {
        if (a.tri) await run('triage', "UPDATE decisions SET decision = ?, reason = ?, protected = ?, updated_at = ? WHERE source = 'hr' AND article_key = ?",
          [a.tri.decision, a.tri.reason, a.tri.protected ? 1 : 0, tsNow(), a.url]);
        else if (a.triAdded) await run('triage', "DELETE FROM decisions WHERE source = 'hr' AND article_key = ?", [a.url]);
      }
    } else if (a.type === 'protect') {
      await run('radar', 'UPDATE memory SET protected = ? WHERE rowid = ?', [a.prot ? 1 : 0, a.id]);
      if (triageOpen) {
        if (a.triAdded) await run('triage', "DELETE FROM decisions WHERE source = 'hr' AND article_key = ?", [a.url]);
        else await run('triage', "UPDATE decisions SET protected = ?, updated_at = ? WHERE source = 'hr' AND article_key = ?", [a.prot ? 1 : 0, tsNow(), a.url]);
      }
    } else if (a.type === 'reason') {
      await run('triage', 'UPDATE decisions SET reason = ?, updated_at = ? WHERE id = ?', [a.old, tsNow(), rid(a.id)]);
    }
    lastAction = null; scheduleStats(); toast('↩ Visszavonva');
    // a visszavont cikkhez ugrunk (ha benne van a listában; ha nem, a jelenlegi helyre szúrjuk be)
    let p = allIds.indexOf(a.id);
    if (p < 0) { allIds.splice(idx, 0, a.id); p = idx; }
    idx = p; await renderCard();
  } catch (e) { toast('❌ ' + errText(e), 4000); }
  finally { busy = false; }
}
// 🧠 triage-lista: csak az indoklást menti (a döntés, a védelem és a radar státusza nem változik), utána a következő cikk
async function doSaveReason() {
  const r = currentRec(); if (!r || r.kind !== 'tri' || busy) return;
  busy = true;
  try {
    const reason = $('reason-input').value.trim(), old = r.tri.reason || '';
    if (reason === old.trim()) { toast('Az indoklás nem változott', 1500); idx = (idx + 1) % allIds.length; await renderCard(); return; }
    await run('triage', 'UPDATE decisions SET reason = ?, updated_at = ? WHERE id = ?', [reason, tsNow(), rid(r.id)]);
    lastAction = { type: 'reason', id: r.id, old };
    toast(reason ? '💾 Indoklás mentve' : '💾 Indoklás törölve', 1800);
    if (tflt.noReason && reason) {                          // az „indoklás nélküli” listából kikerül
      allIds.splice(idx, 1);
      if (!allIds.length) { cur = null; showEmpty(); return; }
      if (idx >= allIds.length) idx = 0;
    } else idx = (idx + 1) % allIds.length;
    await renderCard();
  } catch (e) { toast('❌ ' + errText(e), 4000); }
  finally { busy = false; }
}
// Véletlen dupla érintés ellen: ugyanaz a döntés-gomb a tényleges végrehajtás (az új cikk megjelenése) után
// csak btnLockMs elteltével nyomható újra (ennyi idő kell a következő cím elolvasásához). 0 = ki.
const BTN_LOCK_DEFAULT = 2;                                   // másodperc
const parseLock = v => { const t = String(v ?? '').trim().replace(',', '.'); if (t === '') return null; const n = Number(t); return Number.isFinite(n) && n >= 0 && n <= 10 ? Math.round(n * 10) / 10 : null; };
let btnLockMs = (parseLock(lsGet('hr_btn_lock', '')) ?? BTN_LOCK_DEFAULT) * 1000;
const lockAt = {};
function guardBtn(id, fn) {
  const el = $(id);
  el.onclick = async () => {
    if (btnLockMs > 0 && Date.now() - (lockAt[id] ?? -1e9) < btnLockMs) return;   // túl gyors ismétlés: figyelmen kívül marad
    const acts = !busy && !!currentRec();                     // csak a ténylegesen végrehajtott nyomás indítja a tiltást
    try { await fn(); }
    finally {
      if (acts && btnLockMs > 0) {
        lockAt[id] = Date.now(); el.classList.add('cool');
        setTimeout(() => el.classList.remove('cool'), btnLockMs);
      }
    }
  };
}
guardBtn('act-prot', doProtect);
guardBtn('act-read', () => doDecide('olvasni'));
guardBtn('act-save', () => doDecide('menteni'));
guardBtn('act-del', () => doDecide('torolni'));
guardBtn('act-reason-save', doSaveReason);
$('btn-lock-apply').onclick = () => {
  const v = parseLock($('btn-lock-sec').value);
  if (v == null) { toast('⚠️ 0 és 10 közötti számot írj (másodperc)', 3000); $('btn-lock-sec').value = btnLockMs / 1000; return; }
  btnLockMs = v * 1000; lsSet('hr_btn_lock', String(v)); $('btn-lock-sec').value = v;
  toast(v > 0 ? `🛡 Ugyanaz a gomb ${v} mp után nyomható újra` : '🛡 A védelem ki van kapcsolva');
};
$('btn-undo').onclick = doUndo;

// ── MHTML: offline mentett cikkek ─────────────────────────────────────────────
// A fájlnévben a cikk URL-jéből számolt azonosító van (…_idHR<14 hexa>_domain.mhtml), így a Vivaldi MHTML Mentő
// ugyanazt a fájlt adja, a telefon pedig az URL-ből megtalálja – a sorazonosítótól (rowid) függetlenül.
function cyrb53(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
const mhtmlId = url => 'HR' + cyrb53(normalizeUrlFetch(url)).toString(16).padStart(14, '0');
// {azonosító → fájl útvonala} a megadott URL-ekhez; hiba / nincs mappa esetén üres
async function findOffline(urls) {
  const ids = [...new Set(urls.map(mhtmlId))];
  try {
    const r = await HR.findMhtml({ dir: getPath('mhtml'), ids });
    return (r && r.found) || {};
  } catch { return {}; }
}
let openTok = 0;
async function refreshOpenBtn(r) {
  const t = ++openTok, b = $('act-open');
  b.textContent = '🌐'; b.title = 'Megnyitás a böngészőben'; b.classList.remove('offline');
  if (!r || !r.url) return;
  const f = await findOffline([r.url]);
  if (t !== openTok || !f[mhtmlId(r.url)]) return;
  b.textContent = '📄'; b.title = 'Megnyitás offline (MHTML fájl)'; b.classList.add('offline');
}
$('act-open').onclick = async () => {
  const r = currentRec();
  if (!r || !r.url) { toast('⚠️ Nincs webcím'); return; }
  try {
    const path = (await findOffline([r.url]))[mhtmlId(r.url)];
    if (path) {
      try { await HR.openFile({ path }); return; }
      catch (e) { toast('⚠️ Az offline fájl nem nyílt meg (' + errText(e) + ') – megnyitom a böngészőben', 4000); }
    }
    await HR.openUrl({ url: r.url });
  } catch (e) { toast('❌ ' + errText(e), 4000); }
};

// ── 📄 MHTML-lista a Vivaldi MHTML Mentőnek ────────────────────────────────────
// Az „aktuális" cikkek: minden 💙 menteni, 📖 olvasni és 🔒 védett cikk. Sor: azonosító|dátum|cím|webcím
const MHTML_COND = "(status IN ('MARKED','READING') OR protected = 1)";
let mhtmlRows = [], mhtmlHave = {};
function mhtmlWanted() { return $('mhtml-only-missing').checked ? mhtmlRows.filter(r => !mhtmlHave[r.id]) : mhtmlRows; }
function paintMhtmlSummary() {
  const miss = mhtmlRows.filter(r => !mhtmlHave[r.id]).length;
  const n = mhtmlWanted().length;
  $('mhtml-summary').innerHTML = `💙📖🔒 cikk összesen: <b>${fmt(mhtmlRows.length)}</b> · offline már megvan: <b>${fmt(mhtmlRows.length - miss)}</b> · még nincs: <b>${fmt(miss)}</b><br>A listába kerül: <b>${fmt(n)}</b> cikk`;
  $('mhtml-list-btn').disabled = !n;
}
async function refreshMhtmlSummary() {
  $('path-mhtml').value = getPath('mhtml');
  if (!radarOpen) { $('mhtml-summary').textContent = 'Nincs megnyitott adatbázis'; $('mhtml-list-btn').disabled = true; return; }
  $('mhtml-summary').textContent = 'Számolás…';
  try {
    const rows = await q('radar', `SELECT url, title, add_date FROM memory WHERE ${MHTML_COND} ORDER BY add_date`);
    mhtmlRows = rows.map(([url, title, date]) => ({ url, title: title || '', date: date || '', id: mhtmlId(url) }));
    const r = await HR.findMhtml({ dir: getPath('mhtml'), ids: mhtmlRows.map(x => x.id), refresh: true }).catch(() => null);
    mhtmlHave = (r && r.found) || {};
    paintMhtmlSummary();
    if (r && r.exists === false) $('mhtml-summary').innerHTML += '<br>⚠️ Az MHTML mappa nem létezik – minden cikk „még nincs mentve"-nek számít.';
  } catch (e) { $('mhtml-summary').textContent = '❌ ' + errText(e); }
}
$('mhtml-only-missing').onchange = paintMhtmlSummary;
$('mhtml-path-save-btn').onclick = async () => {
  const v = $('path-mhtml').value.trim().replace(/\/+$/, '');
  if (v && v !== DEFAULT_PATHS.mhtml) lsSet('hr_path_mhtml', v); else lsDel('hr_path_mhtml');
  toast('💾 MHTML mappa mentve'); await refreshMhtmlSummary(); refreshOpenBtn(cur);
};
$('mhtml-list-btn').onclick = async () => {
  const rows = mhtmlWanted();
  if (!rows.length) { toast('Nincs mit kiírni'); return; }
  const clean = t => String(t).replace(/[|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  const text = rows.map(r => `${r.id}|${r.date}|${clean(r.title)}|${r.url.trim()}`).join('\n') + '\n';
  const d = new Date();
  const path = `${dirOf(getPath('radar'))}/mhtml_lista_${dateStr(d).replace(/-/g, '')}_${pad(d.getHours())}${pad(d.getMinutes())}.txt`;
  try {
    await HR.writeText({ path, text });
    const box = $('mhtml-result'); box.style.display = '';
    box.innerHTML = `✅ Kiírva: <b>${fmt(rows.length)}</b> cikk<br><span class="mono">${esc(path)}</span><br>Töltsd be a Vivaldi MHTML Mentő bővítményben.`;
    toast(`📄 Lista kiírva (${fmt(rows.length)} cikk)`, 3500);
  } catch (e) { toast('❌ ' + errText(e), 5000); }
};

// ── címkék ──────────────────────────────────────────────────────────────────────
async function ensureBm() {
  if (bmOpened) return;
  await HR.openDb({ db: 'bm', path: getPath('bm') });
  bmOpened = true;
}

let allTagCounts = new Map();                         // kisbetűs alak → [megjelenített alak, darab]
async function loadAllTags() {
  if (allTagsCache) return allTagsCache;
  if (!allTagsLoading) {
    allTagsLoading = (async () => {
      const cnt = new Map();
      const add = rows => { for (const [t] of rows) { if (!t) continue; for (let tag of String(t).split(',')) { tag = tag.trim(); if (!tag) continue; const k = tag.toLowerCase(); const e = cnt.get(k); if (e) e[1]++; else cnt.set(k, [tag, 1]); } } };
      try { await ensureBm(); add(await q('bm', "SELECT custom_tags FROM bookmarks WHERE custom_tags IS NOT NULL AND custom_tags != ''")); }
      catch { bmOpened = false; /* a BM nem érhető el: csak a Hír-Radar saját címkéi */ }
      try { add(await q('radar', "SELECT custom_tags FROM memory WHERE custom_tags IS NOT NULL AND custom_tags != ''")); } catch { /* nem végzetes */ }
      allTagCounts = cnt;
      allTagsCache = [...cnt.values()].map(e => e[0]).sort((a, b) => a.localeCompare(b, 'hu'));
      return allTagsCache;
    })().finally(() => { allTagsLoading = null; });
  }
  return allTagsLoading;
}
// A javaslatok sorrendje: pontos egyezés; egy szavas címkék (előbb „ezzel kezdődik", utána „tartalmazza");
// végül a többszavas címkék (ugyanígy). Egy csoporton belül a gyakoribb van elöl, utána betűrend.
function rankTags(qs) {
  const exact = [], sStart = [], sCont = [], mStart = [], mCont = [];
  for (const [k, e] of allTagCounts) {
    if (k === qs) { exact.push(e); continue; }
    const single = !/\s/.test(k);
    if (k.startsWith(qs)) (single ? sStart : mStart).push(e);
    else if (k.includes(qs)) (single ? sCont : mCont).push(e);
  }
  const cmp = (a, b) => b[1] - a[1] || a[0].toLowerCase().localeCompare(b[0].toLowerCase(), 'hu');
  for (const g of [sStart, sCont, mStart, mCont]) g.sort(cmp);
  return { exact, hits: [...exact, ...sStart, ...sCont, ...mStart, ...mCont] };
}

// javaslatok a „A cikk címkéi" mezőbe gépelve: az utolsó vesszőig tartó szó 3. karakterétől
const SUG_LIMIT = 40;
let sugTok = 0;
const lastFrag = v => v.slice(v.lastIndexOf(',') + 1).trim();
async function updateTagSuggest() {
  const tok = ++sugTok;
  const box = $('tags-suggest'), info = $('tags-suggest-info');
  const frag = lastFrag($('tags-new-input').value);
  if (frag.length < 3) { box.innerHTML = ''; info.style.display = 'none'; return; }
  info.style.display = ''; if (!allTagsCache) info.textContent = 'Címkék betöltése…';
  try { await loadAllTags(); } catch (e) { info.textContent = '❌ ' + errText(e); return; }
  const cmap = await getCmap().catch(() => null);
  if (tok !== sugTok) return;
  const qs = frag.toLowerCase();
  const { exact, hits } = rankTags(qs);
  const have = new Set($('tags-new-input').value.split(',').slice(0, -1).map(t => t.trim().toLowerCase()));
  const list = hits.map(e => e[0]).filter(t => !have.has(t.toLowerCase()));
  const newForm = normalizeTags(frag, cmap);
  const showNew = newForm && !exact.length && !have.has(newForm.toLowerCase());
  box.innerHTML = list.slice(0, SUG_LIMIT).map(t => `<span class="top-tag" data-tag="${esc(t)}">${esc(t)}</span>`).join('') +
    (showNew ? `<span class="top-tag new-tag" data-new="1" data-tag="${esc(newForm)}">➕ új: ${esc(newForm)}</span>` : '');
  info.textContent = list.length
    ? `${fmt(list.length)} javaslat${list.length > SUG_LIMIT ? ` (az első ${SUG_LIMIT} látszik – írj még be karaktert)` : ''} – koppints a beillesztéshez:`
    : (showNew ? 'Nincs ilyen címke – újként felvehető:' : 'Nincs több javaslat.');
}
$('tags-new-input').addEventListener('input', updateTagSuggest);
$('tags-suggest').addEventListener('click', e => {
  const t = e.target.closest('.top-tag'); if (!t) return;
  const inp = $('tags-new-input');
  const parts = inp.value.split(',').map(x => x.trim());
  parts.pop();                                         // az éppen gépelt töredék helyére kerül a választott címke
  if (!parts.some(x => x.toLowerCase() === t.dataset.tag.toLowerCase())) parts.push(t.dataset.tag);
  inp.value = parts.filter(Boolean).join(', ') + ', ';
  $('tags-suggest').innerHTML = ''; $('tags-suggest-info').style.display = 'none'; sugTok++;
  inp.focus();
});

function addTag(tag) {
  const inp = $('tags-new-input');
  const arr = inp.value.trim() ? inp.value.split(',').map(t => t.trim()).filter(Boolean) : [];
  if (!arr.some(x => x.toLowerCase() === tag.toLowerCase())) { arr.push(tag); inp.value = arr.join(', '); }
}
$('btn-tag').onclick = () => {
  const r = currentRec(); if (!r || r.kind === 'tri') { toast('⚠️ Nincs aktuális cikk'); return; }
  $('tags-article-title').textContent = r.title || r.url || '';
  $('tags-new-input').value = r.tags || '';
  $('tag-search').value = ''; $('tag-results').innerHTML = ''; $('tag-results-info').style.display = 'none';
  $('tags-suggest').innerHTML = ''; $('tags-suggest-info').style.display = 'none'; sugTok++;
  showModal('tags-modal-overlay');
  loadAllTags().catch(() => { /* a keresésnél kiderül */ });       // háttérben előre betölti
};
$('tags-save-btn').onclick = async () => {
  const r = currentRec(); if (!r) return;
  try {
    const val = normalizeTags($('tags-new-input').value, await getCmap());
    await run('radar', 'UPDATE memory SET custom_tags = ? WHERE rowid = ?', [val, r.id]);
    r.tags = val; allTagsCache = null;
    closeModal('tags-modal-overlay'); toast(val ? '✅ Címkék mentve' : '✅ Címkék törölve'); paintCard(r);
  } catch (e) { toast('❌ ' + errText(e), 4000); }
};

// ── 📤 Mentés a BM adatbázisba ─────────────────────────────────────────────────
async function exportCounts() {
  const rows = await q('radar', "SELECT status, COUNT(*), SUM(CASE WHEN protected = 1 THEN 1 ELSE 0 END) FROM memory WHERE status IN ('MARKED','READING') GROUP BY status");
  const o = { MARKED: [0, 0], READING: [0, 0] };
  rows.forEach(([s, n, p]) => { o[s] = [n, p || 0]; });
  return o;
}
$('export-btn').onclick = async () => {
  if (!radarOpen) { toast('⚠️ Nincs megnyitott adatbázis'); return; }
  $('exp-result').style.display = 'none';
  $('exp-run-btn').disabled = true;
  $('exp-summary').textContent = 'Számolás…';
  showModal('export-modal-overlay');
  try {
    const c = await exportCounts();
    const n = c.MARKED[0] + c.READING[0];
    $('exp-summary').innerHTML = `💙 Menteni: <b>${fmt(c.MARKED[0])}</b> · 📖 Olvasni: <b>${fmt(c.READING[0])}</b>` +
      (c.MARKED[1] + c.READING[1] ? ` · 🔒 védett: <b>${fmt(c.MARKED[1] + c.READING[1])}</b>` : '') +
      `<br>Cél: <span class="mono">${esc(getPath('bm'))}</span>`;
    $('exp-run-btn').disabled = !n;
    if (!n) $('exp-summary').innerHTML += '<br>Nincs exportálható cikk (💙 vagy 📖 jelölésű).';
  } catch (e) { $('exp-summary').textContent = '❌ ' + errText(e); }
};

function bmInsertOp(bmCols, vals) {
  const names = [], params = [];
  for (const [, name, type, notnull, dflt, pk] of bmCols) {
    if (pk) continue;                                       // az azonosítót az adatbázis adja
    if (name in vals) { names.push(name); params.push(vals[name]); }
    else if (notnull && dflt == null) { names.push(name); params.push(/INT|REAL|NUM|FLOA|DOUB|BOOL/i.test(type || '') ? 0 : ''); }
  }
  return { sql: `INSERT INTO bookmarks (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`, params };
}

$('exp-run-btn').onclick = async () => {
  const updateMode = $('exp-update').checked;
  const btn = $('exp-run-btn'), out = $('exp-result');
  btn.disabled = true; out.style.display = 'none';
  try {
    try { await ensureBm(); } catch (e) { bmOpened = false; throw new Error('A bookmarks.db nem nyitható meg (' + getPath('bm') + '): ' + errText(e)); }
    const bmCols = await q('bm', 'PRAGMA table_info(bookmarks)');
    if (!bmCols.length) throw new Error('A bookmarks.db-ben nincs „bookmarks" tábla');
    const bmNames = bmCols.map(c => c[1]);
    const items = await q('radar', "SELECT rowid, url, source, title, status, add_date, protected, custom_tags FROM memory WHERE status IN ('MARKED','READING')");
    if (!items.length) { toast('Nincs exportálható cikk'); return; }

    // melyik cikk szerepel már a BM-ben
    const existing = new Map();
    for (let i = 0; i < items.length; i += 400) {
      const urls = items.slice(i, i + 400).map(x => x[1]);
      const rows = await q('bm', `SELECT url, id, custom_tags FROM bookmarks WHERE url IN (${urls.map(() => '?').join(',')})`, urls);
      rows.forEach(([u, id, t]) => { if (!existing.has(u)) existing.set(u, { id, tags: t || '' }); });
    }

    const cmap = await getCmap();
    const today = dateStr();
    const ops = []; let ins = 0, upd = 0, skip = 0;
    for (const [, url, source, title, status, addDate, prot, ctags] of items) {
      const isRead = status === 'READING' ? 1 : 0;
      const tags = normalizeTags(ctags || '', cmap);
      const ex = existing.get(url);
      if (ex) {
        const merged = tags ? unionTags(ex.tags, tags) : ex.tags;
        const tagSet = merged !== ex.tags && bmNames.includes('custom_tags');
        const sets = [], params = [];
        if (updateMode) { sets.push('title = ?'); params.push(title || ''); }
        sets.push('protected = MAX(COALESCE(protected, 0), ?)'); params.push(prot ? 1 : 0);
        sets.push('is_read = ?'); params.push(isRead);
        if (updateMode) { sets.push('status = ?'); params.push(BM_STATUS); }
        if (tagSet) { sets.push('custom_tags = ?'); params.push(merged); }
        params.push(url);
        ops.push({ sql: `UPDATE bookmarks SET ${sets.join(', ')} WHERE url = ?`, params });
        if (updateMode) upd++; else skip++;
      } else {
        ops.push(bmInsertOp(bmCols, {
          category: source, title: title || '', domain: domainOf(url, source), url, tags: '', custom_tags: tags,
          status: BM_STATUS, add_date: addDate || today, protected: prot ? 1 : 0, local_path: '', note: '', is_read: isRead, pending_delete: '',
        }));
        ins++;
      }
    }
    for (let i = 0; i < ops.length; i += 1000) await HR.batch({ db: 'bm', ops: ops.slice(i, i + 1000) });

    // exportált cikkek → törölni státusz + mai dátum a Hír-Radarban (mint az asztali programban).
    // A védettség átment a BM-be, ezért itt megszűnik: védett és 🗑 cikk nem létezhet, és a végleges törlés is eltávolíthatja.
    const rops = items.map(x => ({ sql: "UPDATE memory SET status = 'DELETED', protected = 0, add_date = ? WHERE rowid = ?", params: [today, x[0]] }));
    for (let i = 0; i < rops.length; i += 1000) await HR.batch({ db: 'radar', ops: rops.slice(i, i + 1000) });

    lastAction = null; allTagsCache = null;
    out.className = 'box ok'; out.style.display = '';
    out.innerHTML = `✅ Kész!<br>Új cikk a BM-ben: <b>${fmt(ins)}</b><br>Frissítve (már megvolt): <b>${fmt(upd)}</b><br>Már megvolt, védelem/olvasás/címke frissítve: <b>${fmt(skip)}</b><br>Az exportált cikkek a 🗑 „Törölni" listára kerültek.`;
    toast(`📤 ${fmt(ins)} új cikk a BM-ben`, 3500);
    await loadRecords(); scheduleStats(0);
  } catch (e) {
    out.className = 'box no'; out.style.display = ''; out.textContent = '❌ ' + errText(e);
  } finally { btn.disabled = false; }
};

// ── megosztás fogadása (böngésző → Megosztás → Hír-Radar) ──────────────────────
function parseShared(d) {
  const text = String(d.text || '');
  const m = text.match(/https?:\/\/[^\s<>"']+/i);
  if (!m) return null;
  const url = m[0].replace(/[).,;]+$/, '');
  let title = String(d.subject || '').trim();
  if (!title) title = text.replace(m[0], '').replace(/\s+/g, ' ').trim();
  return { url, title };
}

// a rovat kitalálása: ugyanazon domainű meglévő cikk rovata (indexelt URL-tartomány-lekérdezés)
async function guessSource(url) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
  for (const h of [host, 'www.' + host]) {
    for (const proto of ['https', 'http']) {
      try {
        const rows = await q('radar', 'SELECT source FROM memory WHERE url >= ? AND url < ? LIMIT 1', [`${proto}://${h}/`, `${proto}://${h}0`]);
        if (rows.length && rows[0][0]) return rows[0][0];
      } catch { /* nem végzetes */ }
    }
  }
  return '';
}
// ── URL-normalizálás: az asztali Hír-Radar normalize_url_fetch átirata ──────────
// kisbetű, követő paraméterek (utm_… stb.) nélkül, a #töredék marad, #töredék nélkül a záró / levágva
const FETCH_TRACKING_PARAMS = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'utm_reader',
  'fbclid', 'gclid', 'partner', 'ref', 'source', 'mc_cid', 'mc_eid', 'trk', 'wt.mc_id', 'rss_feed']);
function splitUrl(u) {
  u = String(u || '').trim().toLowerCase();
  let frag = '';
  const hi = u.indexOf('#');
  if (hi >= 0) { frag = u.slice(hi); u = u.slice(0, hi); if (frag === '#') frag = ''; }
  let qs = '';
  const qi = u.indexOf('?');
  if (qi >= 0) { qs = u.slice(qi + 1); u = u.slice(0, qi); }
  return { base: u, qs, frag };
}
export function normalizeUrlFetch(url) {
  const { base, qs, frag } = splitUrl(url);
  const kept = qs.split('&').filter(p => {
    if (!p) return false;
    let k = p.split('=')[0];
    try { k = decodeURIComponent(k.replace(/\+/g, ' ')); } catch { /* marad */ }
    return !FETCH_TRACKING_PARAMS.has(k.toLowerCase());
  });
  let r = base + (kept.length ? '?' + kept.join('&') : '') + frag;
  if (!r.includes('#')) r = r.replace(/\/+$/, '');
  return r;
}
const likeEsc = s => s.replace(/[\\%_]/g, c => '\\' + c);
// a normalizált URL-lel egyező sor keresése: SQL-ben az URL elejére szűr, a pontos egyezést JS-ben dönti el
async function findDupIn(db, table, col, extraWhere, url) {
  const key = normalizeUrlFetch(url);
  const pre = splitUrl(url).base.replace(/\/+$/, '');
  if (!pre) return null;
  const rows = await q(db, `SELECT ${col}, title, ${table === 'memory' ? 'status' : 'decision'} FROM ${table}
    WHERE ${extraWhere}lower(${col}) LIKE ? ESCAPE '\\' ORDER BY length(${col}) LIMIT 300`, [likeEsc(pre) + '%']);
  for (const r of rows) if (normalizeUrlFetch(r[0] || '') === key) return { url: r[0], title: r[1] || '', status: r[2] || '' };
  return null;
}
const findDup = url => findDupIn('radar', 'memory', 'url', '', url);
const findTriDup = url => findDupIn('triage', 'decisions', 'article_key', "source = 'hr' AND ", url);

let shareDup = null, shareChecking = false;
const DUP_LABEL = { SEEN: 'új', MARKED: '💙', READING: '📖', DELETED: '🗑', EXPORTED: 'exportált' };
const TRI_LABEL = { menteni: '💙', olvasni: '📖', torolni: '🗑' };
// a megosztott webcím ellenőrzése: csak az kerülhet be, ami még nincs a Hír-Radarban (mint az asztali URL Importnál)
async function checkShareDup() {
  const url = $('share-url').value.trim();
  const box = $('share-dup'), btn = $('share-save-btn');
  box.style.display = 'none'; shareDup = null;
  if (!/^https?:\/\//i.test(url)) { btn.disabled = false; return; }
  shareChecking = true; btn.disabled = true;
  const my = url;
  try {
    const dup = await findDup(url);
    if ($('share-url').value.trim() !== my) return;          // közben átírták – az új ellenőrzés dönt
    shareDup = dup;
    if (dup) {
      box.className = 'box no';
      box.textContent = `⛔ Ez a cikk már szerepel a Hír-Radarban (${DUP_LABEL[dup.status] || dup.status}): ${dup.title.slice(0, 80)}\nNem adom hozzá újra.`;
      box.style.display = '';
    } else if (triageOpen) {
      const t = await findTriDup(url).catch(() => null);
      if ($('share-url').value.trim() !== my) return;
      if (t) {
        box.className = 'box';
        box.textContent = `ℹ️ A Hír-Radarban nincs, de a triage-ban már van döntés róla (${TRI_LABEL[t.status] || t.status}): ${t.title.slice(0, 80)}\nHozzáadhatod, ha mégis kell.`;
        box.style.display = '';
      }
    }
  } catch { /* nem végzetes: az ellenőrzés nélkül is menthető */ }
  finally { if ($('share-url').value.trim() === my) { shareChecking = false; btn.disabled = !!shareDup; } }
}
let shareUrlTimer = null;
$('share-url').addEventListener('input', () => { clearTimeout(shareUrlTimer); shareUrlTimer = setTimeout(checkShareDup, 400); });
async function handleShared(d) {
  if (!d || !d.text) return;
  if (!radarOpen) { pendingShare = d; toast('A megosztott linket az adatbázis megnyitása után adom hozzá', 3500); return; }
  const p = parseShared(d);
  if (!p) { toast('⚠️ A megosztott szövegben nincs webcím', 3500); return; }
  $('share-url').value = p.url; $('share-title').value = p.title; $('share-reason').value = '';
  $('share-source').value = NO_SOURCE; $('share-marked').checked = true; $('share-reading').checked = false; $('share-prot').checked = false;
  $('share-dup').style.display = 'none'; shareDup = null;
  showModal('share-modal-overlay');
  await checkShareDup();
  try {
    const g = await guessSource(p.url);
    if (g && $('share-source').value === NO_SOURCE) $('share-source').value = g;
  } catch { /* nem végzetes */ }
}
$('share-save-btn').onclick = async () => {
  const url = $('share-url').value.trim(); const title = $('share-title').value.trim();
  if (!/^https?:\/\//i.test(url)) { toast('⚠️ Érvénytelen webcím'); return; }
  if (shareChecking) { toast('Ellenőrzés folyamatban…'); return; }
  if (shareDup) { toast('⛔ Ez a cikk már megvan a Hír-Radarban', 3000); return; }
  if (!title) { toast('⚠️ A cím nem lehet üres'); return; }
  if (!radarOpen) { toast('⚠️ Nincs megnyitott adatbázis'); return; }
  const status = $('share-reading').checked ? 'READING' : 'MARKED';
  const decision = status === 'READING' ? 'olvasni' : 'menteni';
  const prot = $('share-prot').checked ? 1 : 0;
  const source = $('share-source').value.trim() || NO_SOURCE;
  const reason = $('share-reason').value.trim();
  const d = new Date(), date = `${dateStr(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  try {
    const again = await findDup(url);                       // végső védelem: meglévő cikket sosem írunk felül
    if (again) { shareDup = again; checkShareDup(); toast('⛔ Ez a cikk már megvan a Hír-Radarban', 3000); return; }
    await run('radar',
      `INSERT INTO memory (url, source, title, status, add_date, protected) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(url) DO NOTHING`,
      [url, source, title, status, date, prot]);
    let note = '';
    if (triageOpen) {
      try { await triUpsert({ url, title, source, date }, decision, reason, prot); }
      catch (e) { note = ' ⚠️ triage: ' + errText(e); }
    }
    const row = await qVal('radar', 'SELECT rowid FROM memory WHERE url = ?', [url]);
    closeModal('share-modal-overlay');
    toast(`✅ Hozzáadva (${status === 'READING' ? '📖' : '💙'})${note}`, 3000);
    lastAction = null; scheduleStats(0);
    clearRovat();
    $('search-input').value = ''; $('search-clear').style.display = 'none';
    await setMode('all', row);
  } catch (e) { toast('❌ ' + errText(e), 5000); }
};
window.__hrShare = handleShared;               // a teszteléshez
window.__hrUtil = { normalizeUrlFetch, mhtmlId };
try { HR.addListener('shared', handleShared); } catch { /* böngészőben nincs */ }

// ── összevonás az asztali adatbázisokkal ───────────────────────────────────────
const DEFAULT_MERGE_DIR = '/storage/emulated/0/Norbi/Osszevonas';
const mergeUi = createMerge({
  $, HR, q, qVal, run, toast, fmt, esc, errText, showModal, getPath, lsGet, lsSet, lsDel, dirOf, pad, ensureBm,
  defaultDir: DEFAULT_MERGE_DIR, mergeDir: () => lsGet('hr_path_merge', '') || DEFAULT_MERGE_DIR,
  isRadarOpen: () => radarOpen, isTriageOpen: () => triageOpen,
  onDone: async () => { allTagsCache = null; allTagsLoading = null; cmapCache = null; lastAction = null; await loadRecords(); scheduleStats(0); refreshDeletableCount(); },
});
$('merge-open-btn').onclick = () => mergeUi.open();

// ── indulás ─────────────────────────────────────────────────────────────────────
(async () => {
  if (lsGet('hr_theme') === 'light') { document.body.classList.add('light'); $('theme-btn').textContent = '☀️'; }
  if (lsGet('hr_rows_visible') === '0') rowsVisible = false;
  const s = lsGet('hr_sort'); if (s === 'desc' || s === 'asc' || s === 'random') sortMode = s;
  applyRows();
  applyColors(getStoredColors());
  paintSortButtons();
  paintRovatBtn();
  paintSearchBtn();
  showEmpty();
  const d = await HR.getShared().catch(() => null);          // a megosztással indított app szövege
  if (d && d.text) pendingShare = d;
  const ok = await openAll(true);
  if (!ok) await showSettings();
  else if (pendingShare) { const sh = pendingShare; pendingShare = null; handleShared(sh); }
})();
