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
// The same read when the answer matters: a file that is not there is null; one that is there and would not read throws.
// readText cannot tell them apart, and a card that failed to read must never look like a companion with no card.
async function readKept(dir, n){
  try { return await (await (await dir.getFileHandle(n)).getFile()).text(); }
  catch(e){ if (e && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')) return null; throw e; }
}

// --- This browser's own storage (IndexedDB) ----------------------------------------------
// One connection, kept (one per get / put costs thousands of opens for a big import); opened again when the
// browser closes it (another tab upgrading, Safari dropping it after the tab was in the background). A transaction
// that aborts (storage full: the put succeeds, then the commit aborts) rejects; it never hangs. steady(), below, tries
// such a call again on a fresh connection.
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
// keys that start with prefix (callers still check, so a host's keys(table) that lists all of them is fine);
// reopen() drops the connection, so the next call makes a fresh one (asked for before a call is tried again).
const idbStorage = { kind:'indexeddb',
  get: (t, k) => tx(t, 'readonly', s => s.get(k)),
  put: (t, k, v) => tx(t, 'readwrite', s => { s.put(v, k); }),
  putMany: (t, entries) => tx(t, 'readwrite', s => { for (const [k, v] of entries) s.put(v, k); }),
  del: (t, keys) => tx(t, 'readwrite', s => { for (const k of keys) s.delete(k); }),
  keys: (t, pre) => tx(t, 'readonly', s => s.getAllKeys(pre ? IDBKeyRange.bound(pre, pre + '\uffff') : undefined)),
  reopen: () => { const was = dbOpen; dbOpen = null; return was ? was.then(db => db.close(), () => {}) : undefined; } };
function memoryStorage(){
  const T = new Map(), m = t => { if (!T.has(t)) T.set(t, new Map()); return T.get(t); };
  return { kind:'memory', get: async (t, k) => m(t).get(k), put: async (t, k, v) => { m(t).set(k, v); },
           putMany: async (t, entries) => { for (const [k, v] of entries) m(t).set(k, v); },
           del: async (t, keys) => { for (const k of keys) m(t).delete(k); }, keys: async t => [...m(t).keys()].sort() };
}
// A call the browser cut off goes again by itself, on a fresh connection (AGAIN: the waits before the 2nd and 3rd try).
// Safe to repeat: every call sets keys to values or reads them, so nothing is doubled even when the commit had landed
// and was still reported lost. A full phone is not tried again: that cannot help. err.tries says how many were made.
const CUT_OFF = ['AbortError', 'UnknownError', 'InvalidStateError', 'TransactionInactiveError'];
const isFull = e => !!e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''));
const AGAIN = [80, 400];
const REPEATABLE = new Set(['get', 'put', 'putMany', 'del', 'keys']);
const pause = ms => new Promise(r => setTimeout(r, ms));
async function again(s, f, args){
  for (let i = 0; ; i++){
    try { return await f.apply(s, args); }
    catch(e){
      if (i >= AGAIN.length || isFull(e) || !e || !CUT_OFF.includes(e.name)){ try { e.tries = i + 1; } catch {} throw e; }
      console.warn('storage cut off, trying again:', e.name);
      if (s.reopen){ try { await s.reopen(); } catch {} }
      await pause(AGAIN[i]);
    }
  }
}
const steadied = new WeakMap();
function steady(s){
  if (!steadied.has(s)) steadied.set(s, new Proxy(s, { get: (t, k) => REPEATABLE.has(k) && typeof t[k] === 'function' ? (...a) => again(t, t[k], a) : t[k] }));
  return steadied.get(s);
}
let ownStorage = null;
// indexedDB can be missing, null (some in-app browsers) or throw when touched (storage blocked): each is memory, and
// storageCheck says so
function hasIdb(){ try { return !!globalThis.indexedDB; } catch { return false; } }
function storage(){ return steady(env.storage || (ownStorage = ownStorage || (hasIdb() ? idbStorage : memoryStorage()))); }
const kvSet = (k, v) => storage().put('kv', k, v);
// A write the browser refused, in plain words (err.code says which, for a page with its own words). step says how far
// it got: 'write', 'read-back', 'list', 'read', 'fetch' (STEP_WORDS); saveFailure(err) makes the line she can copy.
function storageError(e, step){
  if (!e) return e;
  const mark = x => { if (step && !x.step){ try { x.step = step; } catch {} } return x; };
  if (e.code === 'storage-full' || e.code === 'storage-lost' || e.code === 'storage-read') return mark(e);
  const full = isFull(e), lost = !full && CUT_OFF.includes(e.name);
  if (!full && !lost) return mark(e);
  const out = new Error(full ? '手机的存储空间不够了，没有存上。清理一些空间后再试一次' : '没有存上（这次保存被打断了），请再试一次');
  out.code = full ? 'storage-full' : 'storage-lost'; out.cause = e;
  return mark(out);
}
// What is there and would not read (never "no such companion"): her files stay, and the words say to try again
function readError(e){
  if (!e || e.code === 'storage-read') return e;
  return Object.assign(new Error('这次读不出来（手机的存储没有回应），资料还在，请再试一次'), { code: 'storage-read', cause: e, step: 'read' });
}
// One line for a tester to copy, in place of a guess: the step, the file and its size, the error the browser really gave,
// how many tries, this browser and its storage. Nothing of hers: no card, no chat, no name. The err may be any error.
const STEP_WORDS = { write:'写入', 'read-back':'写完读回', list:'写联系人名单', read:'读取', fetch:'取默认角色', open:'打开' };
function saveFailure(e){
  if (!e) return '';
  let r = e; for (let i = 0; i < 5 && r.cause; i++) r = r.cause;
  const find = k => { let x = e; for (let i = 0; i < 6 && x; i++, x = x.cause) if (x[k] != null) return x[k]; return null; };
  const step = find('step'), file = find('file'), size = find('size'), tries = find('tries');
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const browser = (ua.match(/(?:EdgA?|HuaweiBrowser|HBPC|Quark|UCBrowser|MiuiBrowser|VivoBrowser|HeyTapBrowser|SamsungBrowser|Firefox|CriOS|Chrome|Version)\/[\d.]+/g) || []).slice(-1)[0] || '';
  return ['出错记录', STEP_WORDS[step] || step, file && (file + (size != null ? ' ' + (size / 1048576).toFixed(1) + 'MB' : '')), r.name || 'Error', r.message && String(r.message).slice(0, 80),
    tries > 1 && `试了${tries}次`, browser.replace(/\.\d+\.\d+$/, ''), storage().kind].filter(Boolean).join(' · ');
}
// Can this browser keep anything? Tries a small write and a picture-sized one (Chromium keeps a value over 64 KB as a file
// of its own beside its database, a different path), then takes them away.
// → { ok, kind, why, small, big }: small and big are 'ok', the error's name or 'no-answer'; why is 'no-indexeddb'
// (memory: gone when the page closes), 'writes' or 'big-writes'. Never throws. { wait } in ms is how long an answer may take.
const CHECK_KEY = '.modu-check', CHECK_SIZE = 256 * 1024;
async function storageCheck(o = {}){
  const s = storage(), kind = s.kind || 'host';
  if (kind === 'memory' && !env.storage) return { ok: false, kind, why: 'no-indexeddb', small: 'ok', big: 'ok' };
  const wait = Number(o.wait) || 6000;
  const attempt = async (t, v) => {
    let timer = null;
    const late = new Promise(r => { timer = setTimeout(() => r('no-answer'), wait); });
    const done = (async () => { await s.put(t, CHECK_KEY, v); await s.get(t, CHECK_KEY); await s.del(t, [CHECK_KEY]); return 'ok'; })().catch(e => (e && e.name) || 'Error');
    const r = await Promise.race([done, late]); clearTimeout(timer); return r;
  };
  const small = await attempt('kv', 1);
  const big = small === 'ok' ? await attempt('vfs', { kind:'file', data: new ArrayBuffer(CHECK_SIZE) }) : small;
  return { ok: small === 'ok' && big === 'ok', kind, why: small !== 'ok' ? 'writes' : big !== 'ok' ? 'big-writes' : '', small, big };
}
const kvGet = k => storage().get('kv', k);

// --- Phone storage: a folder kept inside this browser --------------------------------------------
// Phones have no folder picker (that is desktop Chrome / Edge only), so there the companion's folder
// lives in the browser's own storage, with the same files and the same interface as a real folder:
// the rest of the core cannot tell the difference. Lost if she clears the browser's site data.
const SAVE_PIECE = 1 << 20;
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
  // A whole new folder <name> inside this one, all there or not there at all (a closed tab, a full phone), in ONE write.
  // files: { 'path/in/folder': text | ArrayBuffer | Uint8Array | Blob }. → the new VDir, or null when the storage cannot
  // write many at once (a host's own without putMany; the caller writes one by one).
  // o.saving = { file, text }: a save note. Then a folder over SAVE_PIECE goes in pieces: `text` (state 'saving') first,
  // text before pictures, no piece over SAVE_PIECE but a file alone, and files[file] (state 'saved') alone at the very
  // end. A long transaction is what a backgrounded tab or a big value loses, and a retry then repeats one piece, not all
  // of him. The note keeps it all or nothing: a save cut off between pieces is 'saving', which the next start clears.
  async writeFolder(name, files, o = {}){
    const s = storage(); if (!s.putMany) return null;
    const top = this.path + '/' + name, out = new Map([[top, { kind:'directory' }]]);
    for (const [p, c] of Object.entries(files)){
      const parts = p.split('/');
      for (let i = 1; i < parts.length; i++) out.set(top + '/' + parts.slice(0, i).join('/'), { kind:'directory' });
      out.set(top + '/' + p, { kind:'file', data: await new Blob([c]).arrayBuffer() });
    }
    const size = [...out.values()].reduce((a, v) => a + (v.data ? v.data.byteLength : 0), 0);
    if (!o.saving || size <= SAVE_PIECE){ await s.putMany('vfs', [...out]); return new VDir(top); }
    const noteKey = top + '/' + o.saving.file, last = out.get(noteKey); out.delete(noteKey);
    const first = await new Blob([o.saving.text]).arrayBuffer();
    const all = [...out], dirs = all.filter(e => !e[1].data), rest = all.filter(e => e[1].data).sort((a, b) => a[1].data.byteLength - b[1].data.byteLength);
    await s.putMany('vfs', dirs.concat([[noteKey, { kind:'file', data: first }]]));
    for (let i = 0; i < rest.length;){
      const piece = [rest[i]]; let n = rest[i++][1].data.byteLength;
      while (i < rest.length && n + rest[i][1].data.byteLength <= SAVE_PIECE){ n += rest[i][1].data.byteLength; piece.push(rest[i++]); }
      await s.putMany('vfs', piece);
    }
    await s.putMany('vfs', [[noteKey, last]]);
    return new VDir(top);
  }
  async queryPermission(){ return 'granted'; }
  async requestPermission(){ return 'granted'; }
}
const phoneRoot = () => new VDir('modu');
const canPickFolder = () => !!globalThis.showDirectoryPicker;

Object.assign(core, { writeFile, readText, readBlob, readKept, storage, kvSet, kvGet, storageError, readError, saveFailure, storageCheck, VDir, phoneRoot, canPickFolder });
})(globalThis[Symbol.for('modu.core')]);
