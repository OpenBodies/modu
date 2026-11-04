// app/core/local.js: what this device keeps for the core: a small key-value store and the in-browser folder (phone storage).
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { env } = core;

// A file in any folder handle (a real folder, the in-browser folder, a host's own): write it, read it.
async function writeFile(dir, path, content){
  const parts = path.split('/'); let d = dir;
  for (const p of parts.slice(0,-1)) d = await d.getDirectoryHandle(p, { create:true });
  const fh = await d.getFileHandle(parts[parts.length - 1], { create:true });
  const w = await fh.createWritable(); await w.write(content); await w.close();
}
async function readText(dir, n){ try { return await (await (await dir.getFileHandle(n)).getFile()).text(); } catch { return null; } }
async function readBlob(dir, n){ try { return await (await dir.getFileHandle(n)).getFile(); } catch { return null; } }

// --- This browser's own storage (IndexedDB) ----------------------------------------------
// One connection, kept (one per get / put costs thousands of opens for a big import); opened again when the
// browser closes it (another tab upgrading, Safari dropping it after the tab was in the background). A transaction
// that aborts (storage full: the put succeeds, then the commit aborts) rejects; it never hangs.
let dbOpen = null;
function idb(){
  return dbOpen = dbOpen || new Promise((res, rej) => {
    const r = indexedDB.open('modu', 2);
    r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv'); if (!db.objectStoreNames.contains('vfs')) db.createObjectStore('vfs'); };
    r.onsuccess = () => { const db = r.result; db.onclose = () => { dbOpen = null; }; db.onversionchange = () => { dbOpen = null; db.close(); }; res(db); };
    r.onerror = () => { dbOpen = null; rej(r.error); };
  });
}
function tx(name, mode, fn, again){ return idb().then(db => new Promise((res, rej) => {
  let t; try { t = db.transaction(name, mode); }
  catch(e){ dbOpen = null; try { db.close(); } catch {} return again ? rej(e) : tx(name, mode, fn, true).then(res, rej); }
  let out; try { out = fn(t.objectStore(name)); } catch(e){ try { t.abort(); } catch {} return rej(e); }
  t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
  t.onerror = e => rej((e && e.target && e.target.error) || t.error);
  t.onabort = () => rej(t.error || new DOMException('the write was cut off', 'AbortError'));
})); }
// The device's storage is one small interface, so a host with no IndexedDB can pass its own
// (setEnv({ storage })): get / put / del / keys on a table ('kv' or 'vfs'), each a Promise. The default is
// IndexedDB when the runtime has it, else memory (kept for as long as the core runs). Optional:
// putMany(table, [[key, value], …]) writes them all or none (one transaction); keys(table, prefix) may list only the
// keys that start with prefix (callers still check, so a host's keys(table) that lists all of them is fine).
const idbStorage = { kind:'indexeddb',
  get: (t, k) => tx(t, 'readonly', s => s.get(k)),
  put: (t, k, v) => tx(t, 'readwrite', s => { s.put(v, k); }),
  putMany: (t, entries) => tx(t, 'readwrite', s => { for (const [k, v] of entries) s.put(v, k); }),
  del: (t, keys) => tx(t, 'readwrite', s => { for (const k of keys) s.delete(k); }),
  keys: (t, pre) => tx(t, 'readonly', s => s.getAllKeys(pre ? IDBKeyRange.bound(pre, pre + '\uffff') : undefined)) };
function memoryStorage(){
  const T = new Map(), m = t => { if (!T.has(t)) T.set(t, new Map()); return T.get(t); };
  return { kind:'memory', get: async (t, k) => m(t).get(k), put: async (t, k, v) => { m(t).set(k, v); },
           putMany: async (t, entries) => { for (const [k, v] of entries) m(t).set(k, v); },
           del: async (t, keys) => { for (const k of keys) m(t).delete(k); }, keys: async t => [...m(t).keys()].sort() };
}
let ownStorage = null;
function storage(){ return env.storage || (ownStorage = ownStorage || (typeof indexedDB !== 'undefined' ? idbStorage : memoryStorage())); }
const kvSet = (k, v) => storage().put('kv', k, v);
// A write the browser refused, in plain words (err.code says which, for a page with its own words)
function storageError(e){
  if (!e || e.code === 'storage-full' || e.code === 'storage-lost') return e;
  const full = e.name === 'QuotaExceededError' || /quota/i.test(e.message || '');
  const lost = !full && ['AbortError', 'UnknownError', 'InvalidStateError', 'TransactionInactiveError'].includes(e.name);
  if (!full && !lost) return e;
  const out = new Error(full ? '手机的存储空间不够了，没有存上。清理一些空间后再试一次' : '没有存上（这次保存被打断了），请再试一次');
  out.code = full ? 'storage-full' : 'storage-lost'; out.cause = e;
  return out;
}
const kvGet = k => storage().get('kv', k);

// --- Phone storage: a folder kept inside this browser --------------------------------------------
// Phones have no folder picker (that is desktop Chrome / Edge only), so there the companion's folder
// lives in the browser's own storage, with the same files and the same interface as a real folder:
// the rest of the core cannot tell the difference. Lost if she clears the browser's site data.
class VFile {
  constructor(path, name){ this.kind = 'file'; this.path = path; this.name = name; }
  async getFile(){ const v = await storage().get('vfs', this.path); if (!v || v.kind !== 'file') throw new DOMException('not found', 'NotFoundError'); return new File([v.data], this.name); }
  async createWritable(){
    const parts = [], path = this.path;
    return { write: async d => { parts.push(d instanceof Blob ? await d.arrayBuffer() : d); },
             close: async () => { const data = await new Blob(parts).arrayBuffer(); await storage().put('vfs', path, { kind:'file', data }); } };
  }
}
class VDir {
  constructor(path){ this.kind = 'directory'; this.path = path; this.name = path.split('/').pop(); }
  async _get(n, kind, create){
    const p = this.path + '/' + n, v = await storage().get('vfs', p);
    if (v && v.kind !== kind) throw new DOMException('wrong kind', 'TypeMismatchError');
    if (!v && !create) throw new DOMException('not found', 'NotFoundError');
    if (!v) await storage().put('vfs', p, kind === 'file' ? { kind, data:new ArrayBuffer(0) } : { kind });
    return p;
  }
  async getFileHandle(n, o = {}){ return new VFile(await this._get(n, 'file', o.create), n); }
  async getDirectoryHandle(n, o = {}){ return new VDir(await this._get(n, 'directory', o.create)); }
  async *entries(){
    const pre = this.path + '/', keys = await storage().keys('vfs', pre);
    for (const k of keys) if (k.startsWith(pre) && !k.slice(pre.length).includes('/')) {
      const v = await storage().get('vfs', k), n = k.slice(pre.length);
      yield [n, v.kind === 'directory' ? new VDir(k) : new VFile(k, n)];
    }
  }
  async removeEntry(n){ const p = this.path + '/' + n, keys = await storage().keys('vfs', p); await storage().del('vfs', keys.filter(k => k === p || k.startsWith(p + '/'))); }
  // A whole new folder <name> inside this one, every file in ONE write, so it is all there or not there at all
  // (a closed tab, a full phone). files: { 'path/in/folder': text | ArrayBuffer | Uint8Array | Blob }. → the new VDir,
  // or null when the storage cannot write many at once (a host's own without putMany; the caller writes one by one).
  async writeFolder(name, files){
    const s = storage(); if (!s.putMany) return null;
    const top = this.path + '/' + name, out = new Map([[top, { kind:'directory' }]]);
    for (const [p, c] of Object.entries(files)){
      const parts = p.split('/');
      for (let i = 1; i < parts.length; i++) out.set(top + '/' + parts.slice(0, i).join('/'), { kind:'directory' });
      out.set(top + '/' + p, { kind:'file', data: await new Blob([c]).arrayBuffer() });
    }
    await s.putMany('vfs', [...out]);
    return new VDir(top);
  }
  async queryPermission(){ return 'granted'; }
  async requestPermission(){ return 'granted'; }
}
const phoneRoot = () => new VDir('modu');
const canPickFolder = () => !!globalThis.showDirectoryPicker;

Object.assign(core, { writeFile, readText, readBlob, storage, kvSet, kvGet, storageError, VDir, phoneRoot, canPickFolder });
})(globalThis[Symbol.for('modu.core')]);
