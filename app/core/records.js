// app/core/records.js: records: one folder per record type, one JSON file per record, for every app.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, store, clone, isoDay, now, writeFile, readText, STORE_FORMAT } = core;

const RECORD_TYPE = /^[a-z][a-z0-9-]{0,31}$/, RECORD_ID = /^[A-Za-z0-9_-]{1,64}$/;
const RESERVED_TYPES = ['memory'];
const memRecords = new Map();   // contact id → Map(type → Map(id → record)), for stores that are not writable
function checkType(type){
  if (typeof type !== 'string' || !RECORD_TYPE.test(type) || RESERVED_TYPES.includes(type)) throw new Error(`记录类型「${type}」无法使用`);
}
function checkId(id){ if (typeof id !== 'string' || !RECORD_ID.test(id)) throw new Error(`记录编号「${id}」无法使用`); }
// One record API for every store: `side()` says, at the moment of each call, which store
// it is: { owner, writable, dir, mem() (type → Map(id → record), for a store kept in memory), format, fill(man) }.
// His folder (`records`) and her phone (`myRecords`, below) are the same code over a different side.
function makeRecords(side){
  const memType = (s, type) => { const m = s.mem(); if (!m.has(type)) m.set(type, new Map()); return m.get(type); };
  const recDir = async (s, type, create) => { try { return await s.dir.getDirectoryHandle(type, { create:!!create }); } catch { return null; } };
  async function registerRecordType(s, type, app){
    let man = {};
    try { man = JSON.parse(await readText(s.dir, 'manifest.json') || '{}') || {}; } catch { man = {}; }
    if (man.records && man.records[type]) return;
    man.records = Object.assign({}, man.records, { [type]: { app: app || type, v: 1 } });
    man.store = s.format;
    s.fill(man);
    await writeFile(s.dir, 'manifest.json', JSON.stringify(man, null, 2));
  }
  // his store's events are { type, id, op }; her store's carry owner: 'her'
  const said = (s, d) => emit('records', s.owner === 'her' ? Object.assign(d, { owner:'her' }) : d);
  const api = {
    // → record[] sorted by `at` (oldest first). A file that is not valid JSON is skipped, never fatal.
    async list(type){
      checkType(type); const s = side();
      if (!s.writable) return [...memType(s, type).values()].map(clone).sort((a, b) => (a.at || 0) - (b.at || 0));
      const d = await recDir(s, type); if (!d) return [];
      const out = [];
      for await (const [n, h] of d.entries()){
        if (h.kind !== 'file' || !n.endsWith('.json')) continue;
        try { const r = JSON.parse(await (await h.getFile()).text()); if (r && typeof r === 'object') out.push(r); } catch {}
      }
      return out.sort((a, b) => (a.at || 0) - (b.at || 0));
    },
    async get(type, id){
      checkType(type); checkId(id); const s = side();
      if (!s.writable){ const r = memType(s, type).get(id); return r ? clone(r) : null; }
      const d = await recDir(s, type); if (!d) return null;
      try { return JSON.parse(await (await (await d.getFileHandle(id + '.json')).getFile()).text()); } catch { return null; }
    },
    // Fills type, v, id, at and date if missing; writes <type>/<id>.json when writable. opts.app names the
    // app that owns the type (manifest `records`), default the type itself.
    async put(type, rec, opts = {}){
      checkType(type); const s = side();
      if (!rec || typeof rec !== 'object' || Array.isArray(rec)) throw new Error('记录必须是一个对象');
      const at = Number(rec.at) || now().getTime();
      const r = Object.assign({}, clone(rec), { type, v: rec.v || 1, id: rec.id || (at.toString(36) + Math.random().toString(36).slice(2, 6)), at });
      if (!r.date) r.date = isoDay(new Date(at));
      checkId(r.id);
      if (s.writable){
        const d = await recDir(s, type, true);
        await writeFile(d, r.id + '.json', JSON.stringify(r, null, 2));
        await registerRecordType(s, type, opts.app);
      } else memType(s, type).set(r.id, clone(r));
      said(s, { type, id: r.id, op:'put' });
      return r;
    },
    async remove(type, id){
      checkType(type); checkId(id); const s = side();
      if (s.writable){ const d = await recDir(s, type); if (d) { try { await d.removeEntry(id + '.json'); } catch(e){ if (e.name !== 'NotFoundError') throw e; } } }
      else memType(s, type).delete(id);
      said(s, { type, id, op:'remove' });
    },
    // The record header: { v, writer, rev, at } on every new record. commit writes `rec` as the next
    // revision of what is stored: rev = the stored rev + 1 unless given; a rec whose rev is not above the stored
    // one lost a race (two writers read the same rev), so the first writer wins and nothing is written.
    // → { ok, record } (record: what is stored now). opts: { writer (required: 'core', 'life', 'her', an app's id,
    // 'model', 'calibration', 'hand'), app? }.
    async commit(type, rec, opts = {}){
      if (!rec || typeof rec !== 'object' || Array.isArray(rec)) throw new Error('记录必须是一个对象');
      const writer = String(opts.writer || rec.writer || '');
      if (!writer) throw new Error('记录需要写入者 (writer)');
      const old = rec.id ? await api.get(type, String(rec.id)) : null, was = old ? Number(old.rev) || 0 : 0;
      const rev = rec.rev != null ? Number(rec.rev) : was + 1;
      if (!(rev > was)) return { ok: false, record: old };
      return { ok: true, record: await api.put(type, Object.assign({}, rec, { v: rec.v || 1, writer, rev }), opts) };
    },
    // → the record types this store has: those in manifest `records` plus folders holding .json files.
    async types(){
      const s = side();
      if (!s.writable){ const m = s.mem(); return [...m.keys()].filter(t => m.get(t).size).sort(); }
      const out = new Set();
      try { Object.keys(JSON.parse(await readText(s.dir, 'manifest.json') || '{}').records || {}).forEach(t => out.add(t)); } catch {}
      for await (const [n, h] of s.dir.entries()){
        if (h.kind !== 'directory' || !RECORD_TYPE.test(n) || RESERVED_TYPES.includes(n)) continue;
        for await (const [f] of h.entries()) if (f.endsWith('.json')) { out.add(n); break; }
      }
      return [...out].sort();
    },
  };
  return api;
}
// His folder: the companion open now (in memory per contact when he has no folder)
const records = makeRecords(() => ({
  owner:'him', writable: store.writable, dir: store.dir, format: STORE_FORMAT,
  mem: () => { const k = core.currentId || ''; if (!memRecords.has(k)) memRecords.set(k, new Map()); return memRecords.get(k); },
  fill: man => { if (!man.name) man.name = store.name; },
}));

Object.assign(core, { RECORD_TYPE, RESERVED_TYPES, makeRecords, records });
})(globalThis[Symbol.for('modu.core')]);
