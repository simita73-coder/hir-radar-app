// Hír-Radar Mobil – összevonás az asztali adatbázisokkal.
// A szabályok az asztali DB Kezelő v4.1-gyel (db_kezelo_v4_1.py) egyeznek; itt a telefon saját adatbázisába ír
// (helyben), az asztali fájlt ATTACH-csal olvassa, és előtte biztonsági másolat készül.
import { unionTagsMerge } from './tags.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Tiszta szabályfüggvények (az asztali program átirata)
// ═══════════════════════════════════════════════════════════════════════════════
const STATUS_PRIO = { DELETED: 4, READING: 3, MARKED: 2, SEEN: 1, EXPORTED: 0 };
const sprio = s => (Object.prototype.hasOwnProperty.call(STATUS_PRIO, s) ? STATUS_PRIO[s] : 0);
const nz = v => (v == null ? '' : String(v));

export function wsNorm(s) { return nz(s).replace(/\xa0/g, ' ').replace(/\s+/g, ' ').trim(); }

// ── Hír-Radar ──────────────────────────────────────────────────────────────────
export function hrResolveStatus(sa, pa, sb, pb) {
  const prot = (pa || pb) ? 1 : 0;
  let status = sprio(sa) >= sprio(sb) ? sa : sb;
  if (prot && status === 'DELETED') {                 // védett cikk nem maradhat törölve
    const c = [sa, sb].filter(s => s !== 'DELETED');
    status = c.length ? c.reduce((best, s) => (sprio(s) > sprio(best) ? s : best)) : 'SEEN';
  }
  return [status, prot];
}
export function hrPickAddDate(ra, rb, status) {
  // a törölt/exportált cikk dátuma a törlés napja: a státuszt adó oldal(ak) legfrissebb dátuma marad
  if (status === 'DELETED' || status === 'EXPORTED') {
    const c = [ra, rb].filter(r => r.status === status).map(r => r.add_date || '');
    if (c.length) return c.reduce((m, d) => (d > m ? d : m));
  }
  const ne = [ra.add_date || '', rb.add_date || ''].filter(Boolean);
  return ne.length ? ne.reduce((m, d) => (d < m ? d : m)) : '';
}
// ra: a telefon sora (elsődleges), rb: az asztali sor; mindkettő normalizált
export function hrMergeRow(ra, rb, cmap) {
  const [status, prot] = hrResolveStatus(ra.status, ra.protected, rb.status, rb.protected);
  return {
    status, protected: prot,
    add_date: hrPickAddDate(ra, rb, status),
    title: ra.title || rb.title || '',
    source: ra.source || rb.source || '',
    custom_tags: unionTagsMerge(ra.custom_tags, rb.custom_tags, cmap),
  };
}

// ── Bookmarks ──────────────────────────────────────────────────────────────────
const BM_COLS = ['id', 'category', 'title', 'domain', 'url', 'tags', 'custom_tags', 'status', 'add_date', 'protected', 'local_path', 'note', 'is_read', 'pending_delete'];
const BM_TEXT_COLS = ['category', 'title', 'domain', 'tags', 'status', 'add_date'];
const BM_BOOL = ['protected', 'is_read'];
const bmPrio = r => (r.pending_delete ? 3 : (r.is_read ? 2 : 1));

export function bmNorm(o) {
  const r = {};
  for (const c of BM_COLS) {
    if (c === 'id') r.id = o.id;
    else if (BM_BOOL.includes(c)) r[c] = o[c] ? 1 : 0;
    else r[c] = o[c] ? (typeof o[c] === 'string' ? o[c] : String(o[c])) : '';
  }
  return r;
}
export function bmResolveState(a, b) {
  const win = bmPrio(a) >= bmPrio(b) ? a : b;
  const st = { is_read: win.is_read ? 1 : 0, pending_delete: win.pending_delete || '', protected: (a.protected || b.protected) ? 1 : 0 };
  if (st.pending_delete === '') st.pending_delete = a.pending_delete || b.pending_delete || '';
  return st;
}
export function mergeNote(na, nb) {
  na = nz(na); nb = nz(nb);
  if (!nb.trim()) return na;
  if (!na.trim()) return nb;
  if (wsNorm(na) === wsNorm(nb)) return na;           // csak szóköz-eltérés → az elsődleges
  return na.length >= nb.length ? na : nb;
}
// a: az elsődleges oldal sora, b: a másik; mindkettő bmNorm-os
export function bmResolve(a, b, cmap) {
  const rec = { ...a };
  for (const col of [...BM_TEXT_COLS, 'url']) if (!rec[col] && b[col]) rec[col] = b[col];
  rec.custom_tags = unionTagsMerge(a.custom_tags, b.custom_tags, cmap);
  rec.note = mergeNote(a.note, b.note);
  rec.local_path = a.local_path || b.local_path || '';
  Object.assign(rec, bmResolveState(a, b));
  return rec;
}

// ── Triage ─────────────────────────────────────────────────────────────────────
const TRI_PRIO = { menteni: 4, olvasni: 3, torolni: 2, bizonytalan: 1 };
const tprio = d => (d && Object.prototype.hasOwnProperty.call(TRI_PRIO, d) ? TRI_PRIO[d] : 0);
export const TRI_COLS = ['id', 'source', 'article_key', 'title', 'domain', 'date', 'decision', 'reason', 'protected',
  'ai_decision', 'ai_reason', 'ai_score', 'created_at', 'updated_at', 'ai_content'];
const firstVal = v => (v == null || v === '' ? null : v);

export function triageResolve(ra, rb) {
  const res = { ...ra };
  const pa = tprio(ra.decision), pb = tprio(rb.decision);
  const rea = nz(ra.reason), reb = nz(rb.reason);
  if (pb > pa) { res.decision = rb.decision; res.reason = reb || rea; }
  else if (pa > pb) { res.reason = rea || reb; }
  else if (wsNorm(rea) === wsNorm(reb)) res.reason = rea || reb;
  else res.reason = rea.length >= reb.length ? rea : reb;

  // AI-eredmény egyben a nyerő oldalról (magasabb AI-döntés; egyenlőnél amelyiknek van ai_content-je)
  const rank = r => [tprio(r.ai_decision), nz(r.ai_content).trim() ? 1 : 0];
  const [ka, kb] = [rank(ra), rank(rb)];
  const aWins = ka[0] > kb[0] || (ka[0] === kb[0] && ka[1] >= kb[1]);
  const [win, lose] = aWins ? [ra, rb] : [rb, ra];
  res.ai_decision = win.ai_decision;
  res.ai_reason = firstVal(win.ai_reason);
  res.ai_score = win.ai_score;
  res.ai_content = firstVal(win.ai_content);
  if ((win.ai_decision ?? null) === (lose.ai_decision ?? null)) {
    for (const col of ['ai_reason', 'ai_score', 'ai_content']) if (res[col] == null || res[col] === '') res[col] = firstVal(lose[col]);
  }
  for (const col of ['title', 'domain', 'date']) if (!res[col]) res[col] = rb[col];
  res.protected = (ra.protected || rb.protected) ? 1 : 0;
  const ca = [ra.created_at, rb.created_at].filter(Boolean);
  res.created_at = ca.length ? ca.reduce((m, d) => (d < m ? d : m)) : null;
  const ua = [ra.updated_at, rb.updated_at].filter(Boolean);
  res.updated_at = ua.length ? ua.reduce((m, d) => (d > m ? d : m)) : null;
  return res;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Összevonás az adatbázisokban (SQL + kis JS)
// ═══════════════════════════════════════════════════════════════════════════════
const ATT = 'dsk';                                    // az asztali fájl ATTACH-neve
const CHUNK = 1500;

export function createMerge(env) {
  const { $, HR, q, qVal, run, toast, fmt, esc, errText, showModal, getPath, lsSet, lsDel, dirOf, pad, defaultDir } = env;
  const DB = {
    radar:  { file: 'radar_memory.db', icon: '📰', name: 'Hír-Radar', phone: () => getPath('radar') },
    bm:     { file: 'bookmarks.db',    icon: '🔖', name: 'Bookmarks', phone: () => getPath('bm') },
    triage: { file: 'triage.db',       icon: '🧠', name: 'Triage',    phone: () => getPath('triage') },
  };
  const KEYS = Object.keys(DB);
  const st = { dir: '', previewKey: null, running: false, cmap: {}, cmapPath: null };

  const colInfo = async (handle, schema, table) => (await q(handle, `PRAGMA ${schema}.table_info(${table})`));
  const colNames = async (handle, schema, table) => (await colInfo(handle, schema, table)).map(r => r[1]);
  const hasTable = async (handle, schema, name) => (await qVal(handle, `SELECT COUNT(*) FROM ${schema}.sqlite_master WHERE type = 'table' AND name = ?`, [name])) > 0;

  async function withAttached(handle, path, fn) {
    try { await HR.exec({ db: handle, sql: `DETACH DATABASE ${ATT}` }); } catch { /* nincs csatolva – rendben */ }
    await HR.exec({ db: handle, sql: `ATTACH DATABASE '${path.replace(/'/g, "''")}' AS ${ATT}` });
    try { return await fn(); }
    finally { try { await HR.exec({ db: handle, sql: `DETACH DATABASE ${ATT}` }); } catch { /* nem végzetes */ } }
  }
  async function inTx(handle, fn) {
    await HR.exec({ db: handle, sql: 'BEGIN' });
    let r;
    try { r = await fn(); await HR.exec({ db: handle, sql: 'COMMIT' }); }
    catch (e) { try { await HR.exec({ db: handle, sql: 'ROLLBACK' }); } catch { /* nem végzetes */ } throw e; }
    return r;
  }
  const batchAll = async (handle, ops) => { for (let i = 0; i < ops.length; i += 1000) await HR.batch({ db: handle, ops: ops.slice(i, i + 1000) }); };

  async function findCmap() {
    for (const dir of [st.dir, dirOf(getPath('bm')), dirOf(getPath('radar'))]) {
      try {
        const r = await HR.readText({ path: dir + '/tag_case_map.json' });
        if (r && r.exists && r.text) {
          const d = JSON.parse(r.text);
          if (d && typeof d === 'object' && !Array.isArray(d)) return { cmap: Object.fromEntries(Object.entries(d).map(([k, v]) => [String(k), String(v)])), path: dir + '/tag_case_map.json' };
        }
      } catch { /* hibás vagy nincs: a következő mappa */ }
    }
    return { cmap: {}, path: null };
  }
  const cmapLine = () => st.cmapPath ? `Címke-szótár: ${st.cmapPath} (${fmt(Object.keys(st.cmap).length)} szó)` : 'Címke-szótár: nincs (tag_case_map.json) – a meglévő címkék kis/nagybetűjét nem módosítja, csak a hiányzókat fűzi hozzá';

  // ── Hír-Radar ────────────────────────────────────────────────────────────────
  async function radarCtx() {
    const dc = await colNames('radar', ATT, 'memory');
    if (!dc.length) throw new Error('Az asztali fájlban nincs „memory" tábla – ez nem a radar_memory.db?');
    if (!dc.includes('url')) throw new Error('Az asztali memory táblában nincs url oszlop');
    const X = {
      source: dc.includes('source') ? 'x.source' : "''", title: dc.includes('title') ? 'x.title' : "''",
      status: dc.includes('status') ? 'x.status' : "'SEEN'", add_date: dc.includes('add_date') ? 'x.add_date' : "''",
      protected: dc.includes('protected') ? 'x.protected' : '0', tags: dc.includes('custom_tags') ? 'x.custom_tags' : "''",
    };
    const differs = `COALESCE(NULLIF(m.status, ''), 'SEEN') <> COALESCE(NULLIF(${X.status}, ''), 'SEEN')
      OR (COALESCE(m.protected, 0) <> 0) <> (COALESCE(${X.protected}, 0) <> 0)
      OR COALESCE(m.add_date, '') <> COALESCE(${X.add_date}, '')
      OR COALESCE(m.custom_tags, '') <> COALESCE(${X.tags}, '')
      OR (COALESCE(m.title, '') = '' AND COALESCE(${X.title}, '') <> '')
      OR (COALESCE(m.source, '') = '' AND COALESCE(${X.source}, '') <> '')`;
    const conflict = `COALESCE(NULLIF(m.status, ''), 'SEEN') <> COALESCE(NULLIF(${X.status}, ''), 'SEEN')
      OR (COALESCE(m.protected, 0) <> 0) <> (COALESCE(${X.protected}, 0) <> 0)`;
    const hasFlD = await hasTable('radar', ATT, 'fetch_log');
    return { X, differs, conflict, hasFlD };
  }
  const FL_GROUP = s => `SELECT timestamp, feed_name, count, COUNT(*) AS n FROM ${s}.fetch_log GROUP BY timestamp, feed_name, count`;
  const FL_MISSING = `FROM (${FL_GROUP(ATT)}) b LEFT JOIN (${FL_GROUP('main')}) a
      ON a.timestamp IS b.timestamp AND a.feed_name IS b.feed_name AND a.count IS b.count
      WHERE b.n > COALESCE(a.n, 0)`;

  async function radarPreview() {
    const c = await radarCtx();
    const nA = await qVal('radar', 'SELECT COUNT(*) FROM main.memory');
    const nB = await qVal('radar', `SELECT COUNT(*) FROM ${ATT}.memory`);
    const onlyB = await qVal('radar', `SELECT COUNT(*) FROM ${ATT}.memory x WHERE NOT EXISTS (SELECT 1 FROM main.memory m WHERE m.url = x.url)`);
    const both = nB - onlyB;
    const diff = await qVal('radar', `SELECT COUNT(*) FROM main.memory m CROSS JOIN ${ATT}.memory x ON x.url = m.url WHERE ${c.differs}`);
    const conf = await qVal('radar', `SELECT COUNT(*) FROM main.memory m CROSS JOIN ${ATT}.memory x ON x.url = m.url WHERE ${c.conflict}`);
    let fl = '';
    if (c.hasFlD) {
      const flA = (await hasTable('radar', 'main', 'fetch_log')) ? await qVal('radar', 'SELECT COUNT(*) FROM main.fetch_log') : 0;
      const flB = await qVal('radar', `SELECT COUNT(*) FROM ${ATT}.fetch_log`);
      const flNew = (await hasTable('radar', 'main', 'fetch_log'))
        ? await qVal('radar', `SELECT COALESCE(SUM(b.n - COALESCE(a.n, 0)), 0) ${FL_MISSING}`) : flB;
      fl = `Letöltési napló: telefon ${fmt(flA)} · asztali ${fmt(flB)} → <b>+${fmt(flNew)}</b> sor`;
    }
    return [`Telefon: <b>${fmt(nA)}</b> cikk · asztali: <b>${fmt(nB)}</b> cikk`,
      `Csak az asztalin: <b>${fmt(onlyB)}</b> (bekerül) · csak a telefonon: <b>${fmt(nA - both)}</b> · közös: <b>${fmt(both)}</b>`,
      `Eltérő közös cikk: <b>${fmt(diff)}</b> (ebből státusz/védelem eltér: <b>${fmt(conf)}</b> – a szabály dönt)`, fl].filter(Boolean);
  }

  async function radarRun(log) {
    const c = await radarCtx();
    const { X } = c;
    const res = { inserted: 0, updated: 0, statusChanged: 0, tagsChanged: 0, fl: 0 };
    return inTx('radar', async () => {
      // 1) csak az asztalin lévő cikkek
      const n0 = await qVal('radar', 'SELECT COUNT(*) FROM main.memory');
      await run('radar', `INSERT INTO main.memory (url, source, title, status, add_date, protected, custom_tags)
        SELECT x.url, COALESCE(${X.source}, ''), COALESCE(${X.title}, ''), COALESCE(NULLIF(${X.status}, ''), 'SEEN'), COALESCE(${X.add_date}, ''),
               CASE WHEN COALESCE(${X.protected}, 0) <> 0 THEN 1 ELSE 0 END, COALESCE(${X.tags}, '')
        FROM ${ATT}.memory x WHERE NOT EXISTS (SELECT 1 FROM main.memory m WHERE m.url = x.url)`);
      res.inserted = (await qVal('radar', 'SELECT COUNT(*) FROM main.memory')) - n0;
      log(`  új cikk az asztaliról: ${fmt(res.inserted)}`);

      // 2) a közös, eltérő cikkek: szabály szerinti összevonás
      let last = -1, seen = 0;
      for (;;) {
        const rows = await q('radar', `SELECT m.rowid, m.source, m.title, m.status, m.add_date, m.protected, m.custom_tags,
            ${X.source}, ${X.title}, ${X.status}, ${X.add_date}, ${X.protected}, ${X.tags}
          FROM main.memory m CROSS JOIN ${ATT}.memory x ON x.url = m.url
          WHERE m.rowid > ${Math.trunc(last)} AND (${c.differs}) ORDER BY m.rowid LIMIT ${CHUNK}`);
        if (!rows.length) break;
        const ops = [];
        for (const r of rows) {
          const ra = { source: nz(r[1]), title: nz(r[2]), status: nz(r[3]) || 'SEEN', add_date: nz(r[4]), protected: r[5] ? 1 : 0, custom_tags: nz(r[6]) };
          const rb = { source: nz(r[7]), title: nz(r[8]), status: nz(r[9]) || 'SEEN', add_date: nz(r[10]), protected: r[11] ? 1 : 0, custom_tags: nz(r[12]) };
          const m = hrMergeRow(ra, rb, st.cmap);
          const sets = [], params = [];
          if (m.status !== nz(r[3])) { sets.push('status = ?'); params.push(m.status); res.statusChanged++; }
          if (m.protected !== (r[5] ? 1 : 0)) { sets.push('protected = ?'); params.push(m.protected); }
          if (m.add_date !== nz(r[4])) { sets.push('add_date = ?'); params.push(m.add_date); }
          if (m.title !== nz(r[2])) { sets.push('title = ?'); params.push(m.title); }
          if (m.source !== nz(r[1])) { sets.push('source = ?'); params.push(m.source); }
          if (m.custom_tags !== nz(r[6])) { sets.push('custom_tags = ?'); params.push(m.custom_tags); res.tagsChanged++; }
          if (sets.length) { params.push(r[0]); ops.push({ sql: `UPDATE main.memory SET ${sets.join(', ')} WHERE rowid = ?`, params }); }
        }
        if (ops.length) { await batchAll('radar', ops); res.updated += ops.length; }
        last = rows[rows.length - 1][0]; seen += rows.length;
        log(`  közös, eltérő cikk átnézve: ${fmt(seen)}`, 1);
        if (rows.length < CHUNK) break;
      }
      log(`  közös cikk frissítve: ${fmt(res.updated)} (státusz: ${fmt(res.statusChanged)}, címke: ${fmt(res.tagsChanged)})`, 2);

      // 3) letöltési napló: kulcsonként a nagyobb példányszám marad
      if (c.hasFlD) {
        await HR.exec({ db: 'radar', sql: 'CREATE TABLE IF NOT EXISTS main.fetch_log (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, feed_name TEXT, count INTEGER)' });
        for (let i = 0; i < 60; i++) {
          const f0 = await qVal('radar', 'SELECT COUNT(*) FROM main.fetch_log');
          await run('radar', `INSERT INTO main.fetch_log (timestamp, feed_name, count) SELECT b.timestamp, b.feed_name, b.count ${FL_MISSING}`);
          const added = (await qVal('radar', 'SELECT COUNT(*) FROM main.fetch_log')) - f0;
          res.fl += added;
          if (!added) break;
        }
        log(`  letöltési napló: +${fmt(res.fl)} sor`);
      }
      return res;
    });
  }

  // ── Bookmarks ────────────────────────────────────────────────────────────────
  async function bmCtx() {
    const mi = await colInfo('bm', 'main', 'bookmarks');
    const dc = await colNames('bm', ATT, 'bookmarks');
    if (!mi.length) throw new Error('A telefon bookmarks.db-jében nincs „bookmarks" tábla');
    if (!dc.length) throw new Error('Az asztali fájlban nincs „bookmarks" tábla – ez nem a bookmarks.db?');
    if (!dc.includes('url')) throw new Error('Az asztali bookmarks táblában nincs url oszlop');
    const mc = mi.map(r => r[1]);
    const cmp = BM_COLS.filter(c => c !== 'id' && c !== 'url' && mc.includes(c) && dc.includes(c));     // összehasonlítható oszlopok
    const dsel = c => (dc.includes(c) ? `x.${c}` : 'NULL');
    // az új sorok beszúrásához: a telefon oszlopai; ismeretlen, kötelező oszlop: az asztali értéke vagy üres
    const tgt = [], expr = {};
    for (const [, name, type, notnull, dflt, pk] of mi) {
      if (pk || name === 'id') continue;
      if (BM_COLS.includes(name)) {
        tgt.push(name);
        expr[name] = BM_BOOL.includes(name)
          ? (dc.includes(name) ? `CASE WHEN COALESCE(x.${name}, 0) <> 0 THEN 1 ELSE 0 END` : '0')
          : (dc.includes(name) ? `COALESCE(x.${name}, '')` : "''");
      } else if (notnull && dflt == null) {
        tgt.push(name);
        expr[name] = dc.includes(name) ? `x.${name}` : (/INT|REAL|NUM|FLOA|DOUB|BOOL/i.test(type || '') ? '0' : "''");
      }
    }
    const textDiff = cmp.filter(c => !BM_BOOL.includes(c)).map(c => `COALESCE(m.${c}, '') <> COALESCE(${dsel(c)}, '')`);
    const boolDiff = cmp.filter(c => BM_BOOL.includes(c)).map(c => `(COALESCE(m.${c}, 0) <> 0) <> (COALESCE(${dsel(c)}, 0) <> 0)`);
    const differs = [...textDiff, ...boolDiff].join(' OR ') || '0';
    const conflict = ['is_read', 'pending_delete', 'protected'].filter(c => cmp.includes(c))
      .map(c => `(COALESCE(m.${c}, 0) <> 0) <> (COALESCE(${dsel(c)}, 0) <> 0)`).join(' OR ') || '0';
    const descDiff = cmp.filter(c => BM_TEXT_COLS.includes(c)).map(c => `COALESCE(m.${c}, '') <> COALESCE(${dsel(c)}, '')`).join(' OR ') || '0';
    const hasDlD = await hasTable('bm', ATT, 'deleted_log');
    return { mc, dc, cmp, dsel, tgt, expr, differs, conflict, descDiff, hasDlD };
  }
  async function prepDups() {
    await HR.exec({ db: 'bm', sql: 'CREATE INDEX IF NOT EXISTS idx_url ON bookmarks(url)' });
    await HR.exec({ db: 'bm', sql: 'CREATE TEMP TABLE IF NOT EXISTS _dups (url TEXT PRIMARY KEY)' });
    await HR.exec({ db: 'bm', sql: 'DELETE FROM temp._dups' });
    const rows = await q('bm', `SELECT url FROM main.bookmarks WHERE COALESCE(url, '') <> '' GROUP BY url HAVING COUNT(*) > 1
      UNION SELECT url FROM ${ATT}.bookmarks WHERE COALESCE(url, '') <> '' GROUP BY url HAVING COUNT(*) > 1`);
    const urls = rows.map(r => r[0]);
    await batchAll('bm', urls.map(u => ({ sql: 'INSERT OR IGNORE INTO temp._dups (url) VALUES (?)', params: [u] })));
    return urls;
  }
  const dropDups = async () => { try { await HR.exec({ db: 'bm', sql: 'DROP TABLE IF EXISTS temp._dups' }); } catch { /* nem végzetes */ } };
  const NOT_DUP = 'NOT EXISTS (SELECT 1 FROM temp._dups dd WHERE dd.url = x.url)';
  const BM_ONLY_B = `COALESCE(x.url, '') <> '' AND ${NOT_DUP} AND NOT EXISTS (SELECT 1 FROM main.bookmarks m WHERE m.url = x.url)`;

  async function bmPreview() {
    const c = await bmCtx();
    const dups = await prepDups();
    try {
      const nA = await qVal('bm', 'SELECT COUNT(*) FROM main.bookmarks');
      const nB = await qVal('bm', `SELECT COUNT(*) FROM ${ATT}.bookmarks`);
      const onlyB = await qVal('bm', `SELECT COUNT(*) FROM ${ATT}.bookmarks x WHERE ${BM_ONLY_B}`);
      const coll = await qVal('bm', `SELECT COUNT(*) FROM ${ATT}.bookmarks x WHERE ${BM_ONLY_B} AND EXISTS (SELECT 1 FROM main.bookmarks m2 WHERE m2.id = x.id)`);
      const both = await qVal('bm', `SELECT COUNT(*) FROM main.bookmarks m CROSS JOIN ${ATT}.bookmarks x ON x.url = m.url WHERE COALESCE(m.url, '') <> '' AND NOT EXISTS (SELECT 1 FROM temp._dups dd WHERE dd.url = m.url)`);
      const diff = await qVal('bm', `SELECT COUNT(*) FROM main.bookmarks m CROSS JOIN ${ATT}.bookmarks x ON x.url = m.url WHERE COALESCE(m.url, '') <> '' AND NOT EXISTS (SELECT 1 FROM temp._dups dd WHERE dd.url = m.url) AND (${c.differs})`);
      const conf = await qVal('bm', `SELECT COUNT(*) FROM main.bookmarks m CROSS JOIN ${ATT}.bookmarks x ON x.url = m.url WHERE COALESCE(m.url, '') <> '' AND NOT EXISTS (SELECT 1 FROM temp._dups dd WHERE dd.url = m.url) AND (${c.conflict})`);
      const desc = await qVal('bm', `SELECT COUNT(*) FROM main.bookmarks m CROSS JOIN ${ATT}.bookmarks x ON x.url = m.url WHERE COALESCE(m.url, '') <> '' AND NOT EXISTS (SELECT 1 FROM temp._dups dd WHERE dd.url = m.url) AND (${c.descDiff})`);
      const noUrl = await qVal('bm', `SELECT COUNT(*) FROM ${ATT}.bookmarks x WHERE COALESCE(x.url, '') = ''`);
      let dl = '';
      if (c.hasDlD) {
        const dA = (await hasTable('bm', 'main', 'deleted_log')) ? await qVal('bm', 'SELECT COUNT(*) FROM main.deleted_log') : 0;
        const dB = await qVal('bm', `SELECT COUNT(*) FROM ${ATT}.deleted_log`);
        const dNew = (await hasTable('bm', 'main', 'deleted_log'))
          ? await qVal('bm', `SELECT COUNT(*) FROM ${ATT}.deleted_log x WHERE NOT EXISTS (SELECT 1 FROM main.deleted_log m WHERE m.url = x.url)`) : dB;
        dl = `deleted_log: telefon ${fmt(dA)} · asztali ${fmt(dB)} → <b>+${fmt(dNew)}</b> új URL`;
      }
      return [`Telefon: <b>${fmt(nA)}</b> könyvjelző · asztali: <b>${fmt(nB)}</b>`,
        `Párosítás URL alapján. Csak az asztalin: <b>${fmt(onlyB)}</b> (bekerül${coll ? `, ebből ${fmt(coll)} új azonosítót kap` : ''}) · közös: <b>${fmt(both)}</b>`,
        `Eltérő közös sor: <b>${fmt(diff)}</b> (ebből olvasott/törlésre vár/védett eltér: <b>${fmt(conf)}</b> – a szabály dönt)`,
        `Leíró mezőben (cím, kategória, tags, státusz, dátum) eltérő közös sor: <b>${fmt(desc)}</b> – ezeknél a fent választott oldal értéke marad`,
        dups.length ? `Többször szereplő URL: <b>${fmt(dups.length)}</b> (soronként párosítva, egyik sem vész el)` : '',
        noUrl ? `⚠️ URL nélküli asztali sor: ${fmt(noUrl)} – kimarad` : '', dl].filter(Boolean);
    } finally { await dropDups(); }
  }

  async function bmRun(log, prim) {
    const c = await bmCtx();
    const res = { inserted: 0, updated: 0, stateChanged: 0, tagsChanged: 0, renumbered: 0, dl: 0, dupPairs: 0 };
    const upd = BM_COLS.filter(k => k !== 'id' && k !== 'url' && c.mc.includes(k));
    const rowOf = (arr, cols) => { const o = {}; cols.forEach((k, i) => { o[k] = arr[i]; }); return o; };
    const insCols = c.tgt, insSql = withId => `INSERT INTO main.bookmarks (${withId ? 'id, ' : ''}${insCols.join(', ')}) SELECT ${withId ? 'x.id, ' : ''}${insCols.map(k => c.expr[k]).join(', ')} FROM ${ATT}.bookmarks x`;
    const dups = await prepDups();
    try {
      return await inTx('bm', async () => {
        const [A, B] = prim === 'desk' ? ['d', 'm'] : ['m', 'd'];            // elsődleges oldal
        const resolveRows = (mRaw, dRaw, cols) => {
          const mRec = bmNorm(rowOf(mRaw, cols)), dRec = bmNorm(rowOf(dRaw, cols));
          const rec = A === 'm' ? bmResolve(mRec, dRec, st.cmap) : bmResolve(dRec, mRec, st.cmap);
          return { mRec, rec };
        };
        const diffOps = (id, mRec, rec) => {
          const sets = [], params = [];
          for (const k of upd) {
            if (rec[k] !== mRec[k]) {
              sets.push(`${k} = ?`); params.push(rec[k]);
              if (k === 'custom_tags') res.tagsChanged++;
              if (k === 'is_read' || k === 'pending_delete' || k === 'protected') res.stateChanged++;
            }
          }
          if (!sets.length) return null;
          params.push(id);
          return { sql: `UPDATE main.bookmarks SET ${sets.join(', ')} WHERE id = ?`, params };
        };

        // 1) többször szereplő URL-ek: n-edik sor az n-edikkel
        const cols = ['id', ...upd];
        for (let i = 0; i < dups.length; i += 300) {
          const part = dups.slice(i, i + 300), ph = part.map(() => '?').join(',');
          const mRows = await q('bm', `SELECT m.url, m.id, ${upd.map(k => 'm.' + k).join(', ')} FROM main.bookmarks m WHERE m.url IN (${ph}) ORDER BY m.url, m.id`, part);
          const dRows = await q('bm', `SELECT x.url, x.id, ${upd.map(k => c.dsel(k)).join(', ')} FROM ${ATT}.bookmarks x WHERE x.url IN (${ph}) ORDER BY x.url, x.id`, part);
          const gm = new Map(), gd = new Map();
          for (const r of mRows) { if (!gm.has(r[0])) gm.set(r[0], []); gm.get(r[0]).push(r.slice(1)); }
          for (const r of dRows) { if (!gd.has(r[0])) gd.set(r[0], []); gd.get(r[0]).push(r.slice(1)); }
          const ops = [];
          for (const [url, drs] of gd) {
            const mrs = gm.get(url) || [];
            for (let j = 0; j < drs.length; j++) {
              if (j < mrs.length) {
                const { mRec, rec } = resolveRows(mrs[j], drs[j], cols);
                res.dupPairs++;
                const op = diffOps(mrs[j][0], mRec, rec); if (op) ops.push(op);
              } else {                                                     // az asztalon több példány van, mint a telefonon
                const free = !(await qVal('bm', 'SELECT 1 FROM main.bookmarks WHERE id = ?', [drs[j][0]]));
                await run('bm', `${insSql(free)} WHERE x.id = ${Math.trunc(Number(drs[j][0]))}`);
                res.inserted++; if (!free) res.renumbered++;
              }
            }
          }
          if (ops.length) { await batchAll('bm', ops); res.updated += ops.length; }
        }

        // 2) a közös (egyszer szereplő) URL-ek, ahol van eltérés
        let last = -1, seen = 0;
        for (;;) {
          const rows = await q('bm', `SELECT m.id, ${upd.map(k => 'm.' + k).join(', ')}, ${upd.map(k => c.dsel(k)).join(', ')}
            FROM main.bookmarks m CROSS JOIN ${ATT}.bookmarks x ON x.url = m.url
            WHERE m.id > ${Math.trunc(last)} AND COALESCE(m.url, '') <> '' AND NOT EXISTS (SELECT 1 FROM temp._dups dd WHERE dd.url = m.url) AND (${c.differs})
            ORDER BY m.id LIMIT ${CHUNK}`);
          if (!rows.length) break;
          const ops = [], n = upd.length;
          for (const r of rows) {
            const { mRec, rec } = resolveRows(r.slice(0, 1 + n), [r[0], ...r.slice(1 + n)], cols);
            const op = diffOps(r[0], mRec, rec); if (op) ops.push(op);
          }
          if (ops.length) { await batchAll('bm', ops); res.updated += ops.length; }
          last = rows[rows.length - 1][0]; seen += rows.length;
          log(`  közös, eltérő könyvjelző átnézve: ${fmt(seen)}`, 1);
          if (rows.length < CHUNK) break;
        }
        log(`  közös sor frissítve: ${fmt(res.updated)} (állapot: ${fmt(res.stateChanged)}, címke: ${fmt(res.tagsChanged)})`, 2);

        // 3) csak az asztalon lévő sorok: szabad azonosítóval, ütközésnél új azonosítót kap
        const n0 = await qVal('bm', 'SELECT COUNT(*) FROM main.bookmarks');
        await run('bm', `${insSql(true)} WHERE ${BM_ONLY_B} AND NOT EXISTS (SELECT 1 FROM main.bookmarks m2 WHERE m2.id = x.id)`);
        const n1 = await qVal('bm', 'SELECT COUNT(*) FROM main.bookmarks');
        await run('bm', `${insSql(false)} WHERE ${BM_ONLY_B} ORDER BY x.id`);
        const n2 = await qVal('bm', 'SELECT COUNT(*) FROM main.bookmarks');
        res.inserted += n2 - n0; res.renumbered += n2 - n1;
        log(`  új könyvjelző az asztaliról: ${fmt(res.inserted)}${res.renumbered ? ` (új azonosítót kapott: ${fmt(res.renumbered)})` : ''}`);

        // 4) deleted_log: egyesítés, a későbbi dátum marad
        if (c.hasDlD) {
          await HR.exec({ db: 'bm', sql: 'CREATE TABLE IF NOT EXISTS main.deleted_log (url TEXT PRIMARY KEY, deleted_at TEXT)' });
          const d0 = await qVal('bm', 'SELECT COUNT(*) FROM main.deleted_log');
          await run('bm', `INSERT INTO main.deleted_log (url, deleted_at) SELECT x.url, x.deleted_at FROM ${ATT}.deleted_log x
            WHERE NOT EXISTS (SELECT 1 FROM main.deleted_log m WHERE m.url = x.url)`);
          const d1 = await qVal('bm', 'SELECT COUNT(*) FROM main.deleted_log');
          await run('bm', `UPDATE main.deleted_log SET deleted_at = (SELECT x.deleted_at FROM ${ATT}.deleted_log x WHERE x.url = deleted_log.url)
            WHERE EXISTS (SELECT 1 FROM ${ATT}.deleted_log x WHERE x.url = deleted_log.url AND COALESCE(x.deleted_at, '') > COALESCE(deleted_log.deleted_at, ''))`);
          res.dl = d1 - d0;
          log(`  deleted_log: +${fmt(res.dl)} URL`);
        }
        return res;
      });
    } finally { await dropDups(); }
  }

  // ── Triage ───────────────────────────────────────────────────────────────────
  async function triReadAll(schema) {
    const cols = await colNames('triage', schema, 'decisions');
    if (!cols.length) throw new Error(schema === 'main' ? 'A telefon triage.db-jében nincs „decisions" tábla' : 'Az asztali fájlban nincs „decisions" tábla – ez nem a triage.db?');
    const sel = TRI_COLS.map(k => (cols.includes(k) ? k : 'NULL')).join(', ');
    const rows = await q('triage', `SELECT ${sel} FROM ${schema}.decisions ORDER BY id`);
    const map = new Map();
    for (const r of rows) {
      const o = {}; TRI_COLS.forEach((k, i) => { o[k] = r[i]; });
      o.protected = o.protected ? 1 : 0;
      map.set(`${o.source}|${o.article_key}`, o);
    }
    return map;
  }
  const triEq = (a, b) => ((a == null || a === '') && (b == null || b === '')) || (a != null && b != null && String(a) === String(b));
  const TRI_UPD = TRI_COLS.filter(k => !['id', 'source', 'article_key'].includes(k));
  async function triPlan() {
    const [mm, dd] = [await triReadAll('main'), await triReadAll(ATT)];
    const updates = [], inserts = [];
    let conflicts = 0, both = 0;
    const used = new Set([...mm.values()].map(r => r.id));
    for (const [key, m] of mm) {
      const d = dd.get(key); if (!d) continue;
      both++;
      if (m.decision && d.decision && m.decision !== d.decision) conflicts++;
      const res = triageResolve(m, d);
      const sets = [], params = [];
      for (const k of TRI_UPD) if (!triEq(res[k], m[k])) { sets.push(`${k} = ?`); params.push(res[k] == null ? null : res[k]); }
      if (sets.length) { params.push(m.id); updates.push({ sql: `UPDATE main.decisions SET ${sets.join(', ')} WHERE id = ?`, params }); }
    }
    const withId = [], noId = [];
    for (const [key, d] of dd) {
      if (mm.has(key)) continue;
      if (d.id != null && !used.has(d.id)) { used.add(d.id); withId.push(d); } else noId.push(d);
    }
    const ins = (r, id) => ({
      sql: `INSERT INTO main.decisions (${id ? 'id, ' : ''}${TRI_COLS.filter(k => k !== 'id').join(', ')}) VALUES (${id ? '?, ' : ''}${TRI_COLS.filter(k => k !== 'id').map(() => '?').join(', ')})`,
      params: [...(id ? [r.id] : []), ...TRI_COLS.filter(k => k !== 'id').map(k => (r[k] == null ? null : r[k]))],
    });
    for (const r of withId) inserts.push(ins(r, true));
    for (const r of noId) inserts.push(ins(r, false));
    return { nA: mm.size, nB: dd.size, both, onlyB: withId.length + noId.length, renumbered: noId.length, updates, inserts, conflicts };
  }
  async function triPreview() {
    const p = await triPlan();
    return [`Telefon: <b>${fmt(p.nA)}</b> döntés-sor · asztali: <b>${fmt(p.nB)}</b>`,
      `Csak az asztalin: <b>${fmt(p.onlyB)}</b> (bekerül) · közös: <b>${fmt(p.both)}</b>`,
      `Frissítendő közös sor: <b>${fmt(p.updates.length)}</b> (eltérő döntés: <b>${fmt(p.conflicts)}</b> – a menteni > olvasni > törölni > bizonytalan sorrend dönt)`];
  }
  async function triRun(log) {
    const p = await triPlan();
    return inTx('triage', async () => {
      await batchAll('triage', p.updates);
      await batchAll('triage', p.inserts);
      log(`  frissítve: ${fmt(p.updates.length)} · új: ${fmt(p.inserts.length)}${p.renumbered ? ` (új azonosítót kapott: ${fmt(p.renumbered)})` : ''}`);
      return { updated: p.updates.length, inserted: p.inserts.length };
    });
  }

  // ── felület ──────────────────────────────────────────────────────────────────
  const selected = () => KEYS.filter(k => $('mg-' + k).checked && !$('mg-' + k).disabled);
  const prim = () => ($('mg-prim-phone').checked ? 'phone' : 'desk');
  const keyNow = () => JSON.stringify([st.dir, selected(), prim()]);
  const refreshButtons = () => {
    $('merge-scan-btn').disabled = st.running;
    $('merge-preview-btn').disabled = st.running || !selected().length;
    $('merge-run-btn').disabled = st.running || !selected().length || st.previewKey !== keyNow();
  };
  const invalidate = () => { st.previewKey = null; $('merge-preview').style.display = 'none'; refreshButtons(); };

  async function scan() {
    const dir = $('merge-dir').value.trim().replace(/\/+$/, '');
    if (!dir) { toast('⚠️ Add meg a mappát'); return; }
    if (dir !== defaultDir) lsSet('hr_path_merge', dir); else lsDel('hr_path_merge');
    st.dir = dir; invalidate();
    $('merge-result').style.display = 'none';
    for (const k of KEYS) {
      const cb = $('mg-' + k), stEl = $('mgst-' + k), row = $('mgrow-' + k);
      let ok = false, txt = '';
      try {
        const path = `${dir}/${DB[k].file}`, phone = DB[k].phone();
        const info = await HR.checkPath({ path });
        if (!(info.exists && info.isFile)) txt = '✘ nincs ilyen fájl a mappában';
        else if (path === phone) txt = '✘ ez a telefon saját fájlja (válassz másik mappát)';
        else if (k === 'radar' && !env.isRadarOpen()) txt = '✘ a telefon radar_memory.db-je nincs megnyitva';
        else if (k === 'triage' && !env.isTriageOpen()) txt = '✘ a telefon triage.db-je nincs megnyitva';
        else if (k === 'bm' && !(await HR.checkPath({ path: phone })).isFile) txt = '✘ a telefon bookmarks.db-je nem található: ' + phone;
        else { ok = true; txt = `✔ megtalálva · ${(info.size / 1048576).toFixed(info.size > 10485760 ? 0 : 1)} MB`; }
      } catch (e) { txt = '✘ ' + errText(e); }
      cb.disabled = !ok; cb.checked = ok; row.classList.toggle('off', !ok); stEl.textContent = txt;
    }
    refreshButtons();
  }

  async function preview() {
    const box = $('merge-preview');
    box.style.display = ''; box.innerHTML = 'Számolás…'; st.running = true; refreshButtons();
    const out = [];
    try {
      const fc = await findCmap(); st.cmap = fc.cmap; st.cmapPath = fc.path;
      for (const k of selected()) {
        out.push(`<b>${DB[k].icon} ${esc(DB[k].name)}</b>`);
        try {
          const path = `${st.dir}/${DB[k].file}`;
          if (k === 'bm') await env.ensureBm();
          const lines = await withAttached(k, path, () => (k === 'radar' ? radarPreview() : k === 'bm' ? bmPreview() : triPreview()));
          out.push(...lines.map(l => '&nbsp;&nbsp;' + l));
        } catch (e) { out.push('&nbsp;&nbsp;❌ ' + esc(errText(e))); }
        box.innerHTML = out.join('<br>') + '<br>…';
      }
      out.push(`<span style="color:var(--txt3)">${esc(cmapLine())}</span>`);
      box.innerHTML = out.join('<br>');
      st.previewKey = keyNow();
    } finally { st.running = false; refreshButtons(); }
  }

  async function backup(k) {
    const src = DB[k].phone(), dir = `${st.dir}/mentes`, base = DB[k].file.replace(/\.db$/, '');
    const t = new Date();
    const stamp = `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}_${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}`;
    const dst = `${dir}/${base}_elotte_${stamp}.db`;
    await HR.copyFile({ src, dst });
    try {                                                  // csak a legutóbbi 2 másolat marad
      const l = await HR.listFiles({ dir });
      const re = new RegExp(`^${base}_elotte_\\d{8}_\\d{6}\\.db$`);
      const names = (l.files || []).filter(n => re.test(n)).sort().reverse();
      for (const n of names.slice(2)) await HR.deleteFile({ path: `${dir}/${n}` });
    } catch { /* a takarítás nem kritikus */ }
    return dst;
  }

  async function runAll() {
    const keys = selected();
    if (!keys.length || st.previewKey !== keyNow()) { toast('Előbb nézd meg az előnézetet'); return; }
    const box = $('merge-result'), logEl = $('merge-log');
    const lines = []; let lastProg = false;
    const log = (t, mode = 0) => {                       // 0: új sor · 1: folyamatjelző (felülírja az előzőt) · 2: összegző sor (leváltja a jelzőt)
      if (mode && lastProg) lines[lines.length - 1] = t; else lines.push(t);
      lastProg = mode === 1; logEl.textContent = lines.join('\n');
    };
    box.className = 'box'; box.style.display = ''; logEl.textContent = '';
    st.running = true; refreshButtons();
    let fails = 0;
    try {
      const fc = await findCmap(); st.cmap = fc.cmap; st.cmapPath = fc.path;
      for (const k of keys) {
        log(`${DB[k].icon} ${DB[k].name}`);
        try {
          log('  biztonsági másolat készül…', 1);
          const dst = await backup(k);
          log(`  mentés: ${dst.replace(/^.*\//, '')}`, 2);
          if (k === 'bm') await env.ensureBm();
          await withAttached(k, `${st.dir}/${DB[k].file}`, () => (k === 'radar' ? radarRun(log) : k === 'bm' ? bmRun(log, prim()) : triRun(log)));
          log('  ✔ kész');
        } catch (e) { fails++; log('  ❌ ' + errText(e) + ' – ennél az adatbázisnál semmi nem változott'); }
      }
      box.className = 'box ' + (fails ? 'no' : 'ok');
      log(fails ? `\n⚠️ ${fails} adatbázisnál hiba volt (lásd fent).` : '\n✅ Az összevonás kész.');
      toast(fails ? '⚠️ Az összevonás hibával végzett' : '✅ Összevonás kész', 3500);
    } finally {
      st.running = false; st.previewKey = null; refreshButtons();
      try { await env.onDone(); } catch { /* nem végzetes */ }
    }
  }

  $('merge-scan-btn').onclick = scan;
  $('merge-preview-btn').onclick = () => preview().catch(e => { $('merge-preview').innerHTML = '❌ ' + esc(errText(e)); st.running = false; refreshButtons(); });
  $('merge-run-btn').onclick = () => runAll().catch(e => { toast('❌ ' + errText(e), 4000); st.running = false; refreshButtons(); });
  KEYS.forEach(k => $('mg-' + k).addEventListener('change', invalidate));
  $('mg-prim-desk').addEventListener('change', invalidate);
  $('mg-prim-phone').addEventListener('change', invalidate);
  $('merge-dir').addEventListener('input', invalidate);

  return {
    async open() {
      $('merge-dir').value = env.mergeDir();
      $('merge-result').style.display = 'none';
      showModal('merge-modal-overlay');
      await scan();
    },
  };
}
