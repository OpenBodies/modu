// app/core.js: Modu's core (window.ModuCore) in one file, for every page and outside app that loads it.
// It is the files in app/core/ joined, in the order of app/core/index.json. Do not edit it here: edit the
// file in app/core/ and run `python -I app/core/join.py`.
// app/core/kernel.js: the event bus every part talks through (on / emit), the product defaults, small text helpers.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
//
// ModuCore, the core of Modu 小手机: all of the logic, so a UI can sit on top without holding any.
// Plain script, no build step: it defines window.ModuCore. Nothing here touches the DOM except the
// File System Access pickers the browser itself draws.
//
// Modules: Import (card PNG/JSON + 酒馆 chat JSONL) · Store (a folder the user owns; on phones, with no
// folder picker, a folder inside the browser's own storage) · Contacts (several companions) · Memory
// (Markdown + front matter, written in his voice) · Persona assembly · Brain link (OpenAI-style, the user's
// own key; the reply carries a closed-set emotion label) · Body seam (BroadcastChannel "modu-body" +
// optional device bridge).
(function(core){
'use strict';

// Product choices are settings, not code. The core alone is neutral: no pronoun is assumed for a
// card that is silent (they/them), memories are written in the language of the chat, and no words are
// banned. Modu's page sets its own choices at boot with setDefaults(MODU_DEFAULTS); another UI that adopts
// the core sets its own, or none. While the card says nothing, pronouns() reads the default. Only when a
// UI asks (writePronouns: true) does stageImport also write the default into a silent card: Modu does
// (so card.json says it too); the bare core never does.
const NEUTRAL_DEFAULTS = Object.freeze({ pronouns:'', memoryLanguage:'', bannedWords:[], writePronouns:false });
const MODU_DEFAULTS = Object.freeze({ pronouns:'he/him', memoryLanguage:'Simplified Chinese', bannedWords:Object.freeze(['陪伴', '接住', '温柔']), writePronouns:true });
core.defaults = Object.assign({}, NEUTRAL_DEFAULTS);
function setDefaults(d){
  const o = Object.assign({}, NEUTRAL_DEFAULTS, d || {});
  core.defaults = { pronouns: /^(he|she|they)\//i.test(o.pronouns || '') ? o.pronouns : '', memoryLanguage: String(o.memoryLanguage || ''),
               bannedWords: [].concat(o.bannedWords || []).map(String).map(s => s.trim()).filter(Boolean), writePronouns: o.writePronouns === true };
  emit('defaults', getDefaults());
  return getDefaults();
}
function getDefaults(){ return { pronouns: core.defaults.pronouns, memoryLanguage: core.defaults.memoryLanguage, bannedWords: core.defaults.bannedWords.slice(), writePronouns: core.defaults.writePronouns }; }
const listeners = new Set();
function emit(ev, data){ for (const f of listeners) { try { f(ev, data); } catch(e){ console.error(e); } } }

// --- The host: what the core needs from wherever it runs, passed in, never reached for ---
// The core reads nothing from the browser while it loads. A page gets the browser's own by default, each
// thing looked up when it is first used; a Node backend, a worker or a test passes its own with setEnv:
//   fetch(url, opts)  the brain link, the bundled samples, first run          default: the runtime's fetch
//   clock() → Date    "now" for presence, the prompt, records (as setClock)   default: new Date()
//   storage           this device's storage: get(table, key) / put(table, key, value) / del(table, keys) /
//                     keys(table), each a Promise; tables 'kv' (contacts, first run, his body model) and
//                     'vfs' (the in-browser folder)                         default: IndexedDB, else memory
//   prefs             where settings are remembered: getItem / setItem / removeItem   default: localStorage, else memory
//   channel           the body seam's in-browser channel: postMessage / addEventListener   default: BroadcastChannel 'modu-body', if any
//   socket(url)       a WebSocket to the device bridge                       default: new WebSocket(url)
//   thumb(url) → Promise<string>  a contact's small picture as a data URL   default: a canvas when there is a document, else ''
// null or undefined puts a thing back to its default. Returns what is in use ('host' or the default's kind).
const env = {};
const ENV_KEYS = ['fetch', 'clock', 'storage', 'prefs', 'channel', 'socket', 'thumb'];
function setEnv(patch){
  const p = patch || {};
  const unknown = Object.keys(p).filter(k => !ENV_KEYS.includes(k));
  if (unknown.length) throw new Error(`setEnv: unknown ${unknown.join(', ')} (it takes ${ENV_KEYS.join(', ')})`);
  for (const k of Object.keys(p)) { if (p[k] == null) delete env[k]; else env[k] = p[k]; }
  if ('clock' in p) core.setClock(env.clock);
  if ('channel' in p) core.openChannel(env.channel);
  return envInfo();
}
function envInfo(){
  const o = {}; for (const k of ENV_KEYS) o[k] = env[k] ? 'host' : 'default';
  if (!env.storage) o.storage = core.storage().kind;
  return o;
}
// fetch through the host's, else the runtime's own, looked up at the moment of the call (a page or a test may swap it)
function hostFetch(url, opts){ const f = env.fetch || globalThis.fetch; return f(url, opts); }

// ---------------------------------------------------------------------------------------------
// Store: the companion currently loaded. One at a time.
const store = { dir:null, name:'', card:null, cardSource:null, meta:{}, msgs:[], memory:[], writable:false,
                avatarURL:'', source:'', folderName:'', importedAt:0, seeded:false };
const clone = o => JSON.parse(JSON.stringify(o));
// Fill a list of strings into a budget, in order; returns the ones that fit.
function fit(items, budget, sep = 1){ const out = []; let n = 0; for (const s of items){ if (n + s.length + sep > budget) continue; out.push(s); n += s.length + sep; } return out; }
function clip(s, budget){ s = String(s || ''); return s.length <= budget ? s : s.slice(0, Math.max(0, budget - 1)) + '…'; }

Object.assign(core, { NEUTRAL_DEFAULTS, MODU_DEFAULTS, setDefaults, getDefaults, listeners, emit, store,
  clone, fit, clip, env, setEnv, hostFetch });
})(globalThis[Symbol.for('modu.core')] = globalThis[Symbol.for('modu.core')] || {});
// app/core/time.js: the clock (now / setClock), a message's time (timeOf, msgDate), days and time in words.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';

// --- Import: a message's time -----------------------------------------------------------------
// send_date as the apps write it: seconds or milliseconds (a number, or a number in a string); an ISO
// time; 酒馆's own "October 27, 2026 8:06pm" and older "2026-3-14 @20h 06m 05s 123ms". Anything else
// is no time at all: the message is undated, never given one.
const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
function timeOf(v){
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (typeof v === 'number' || (typeof v === 'string' && v.trim() && !isNaN(n))){
    if (!n) return null; const t = n < 1e12 ? n * 1000 : n; return isNaN(new Date(t)) ? null : t;
  }
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})(?:[ ,@]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?)?$/i);
  if (m && MONTHS.includes(m[1].toLowerCase())){
    let h = Number(m[4] || 0); const pm = m[7] && /p/i.test(m[7]); if (m[7]) h = h % 12 + (pm ? 12 : 0);
    return new Date(Number(m[3]), MONTHS.indexOf(m[1].toLowerCase()), Number(m[2]), h, Number(m[5] || 0), Number(m[6] || 0)).getTime();
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s*@\s*(\d{1,2})h\s*(\d{1,2})m(?:\s*(\d{1,2})s)?/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0)).getTime();
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(s)){ const t = Date.parse(s.replace(' ', 'T')); return isNaN(t) ? null : t; }
  return null;
}
// Messages whose time is after the moment they were imported: a time that cannot be true. Kept in her
// file exactly as exported; Modu treats them as undated (msgDate → null), so no future date is shown.
const untimely = new WeakSet();
function markUntimely(msgs, at, count){
  let n = 0;
  for (const m of msgs.slice(0, count == null ? msgs.length : count)){ const t = timeOf(m && m.send_date); if (t && t > at + 60000){ untimely.add(m); n++; } }
  return n;
}
function aheadWords(ms){ const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? `in about ${m} minute${m > 1 ? 's' : ''}` : `in about ${Math.round(m / 60)} hour${m >= 90 ? 's' : ''}`; }
function today(){ const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
// A message's date, or null when it has none, or only one that cannot be true (after its import).
function msgDate(m){ if (!m || untimely.has(m)) return null; const t = timeOf(m.send_date); return t == null ? null : new Date(t); }
function isoDay(d){ return d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : ''; }

// --- Time, in words ---------------------------------------------------------------------------
const WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function band(h){ return h < 5 ? 'late at night' : h < 9 ? 'early morning' : h < 12 ? 'morning' : h < 14 ? 'midday' : h < 18 ? 'afternoon' : h < 22 ? 'evening' : 'late at night'; }
function clockIn(d, tz){
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz || undefined, weekday:'long', year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(d).map(x => [x.type, x.value]));
    return { text: `${p.weekday} ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`, hour: Number(p.hour) };
  } catch { return { text: `${WEEK[d.getDay()]} ${isoDay(d)}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, hour: d.getHours() }; }
}
// calendar days from a to b (times or Dates): local midnights, so the 24th to the 30th is 6 whatever the hours. The one
// way Modu counts days away (the gap line, the absence memory, 暂停's absence), so his words and his memory agree
function calendarDays(a, b){
  const mid = t => { const d = new Date(+t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  return Math.round((mid(b) - mid(a)) / 864e5);
}
// gapWords(ms, end = now()): a gap of a day or more is told in calendar days (the gap ended at `end`)
function gapWords(ms, end){
  const m = Math.round(ms / 60000);
  if (m < 2) return 'just now'; if (m < 60) return `${m} minutes ago`;
  const h = Math.round(m / 60); if (h < 24) return `about ${h} hour${h > 1 ? 's' : ''} ago`;
  const e = end != null ? +end : +now(), d = Math.max(1, calendarDays(e - ms, e));
  return d < 14 ? `${d} day${d > 1 ? 's' : ''} ago` : `about ${Math.round(d / 7)} weeks ago`;
}
// The clock presence reads. setClock(fn) lets a demo or a screenshot pin the time (index.html ?at=).
core.clock = () => new Date();
function now(){ return core.clock(); }
function setClock(fn){ core.clock = fn || (() => new Date()); core.updatePresence(); }

Object.assign(core, { timeOf, markUntimely, aheadWords, today, msgDate, isoDay, band, clockIn, gapWords, calendarDays, now,
  setClock });
})(globalThis[Symbol.for('modu.core')]);
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
// app/core/lore.js: 世界书 (lorebook) entries: read both card shapes, match keys against the chat, and the timing set (chance, groups, sticky / cooldown / delay, recursion).
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';

// --- 世界书 (lorebook) entries, V2 character_book and 酒馆 world-info shapes ---------------------------
// A character_book keeps 酒馆's own fields in the entry's `extensions`; a world-info file keeps them on the entry.
// The timing set is read too (probability, group, sticky, cooldown, delay, recursion flags), and `raw` is the
// entry as written (its extensions.modu.when holds the unlock and time rules).
function loreEntries(book){
  if (!book) return [];
  const raw = Array.isArray(book.entries) ? book.entries : Object.values(book.entries || {});
  return raw.filter(e => e && typeof e.content === 'string' && e.content.trim()).map((e, i) => {
    const x = e.extensions || {}, pick = k => x[k] !== undefined ? x[k] : e[k];
    const pos = pick('position');   // 0 before char, 1 after, 4 at depth; or 'before_char' / 'after_char'
    const keys = [].concat(e.keys || e.key || []).map(String).map(s => s.trim()).filter(Boolean);
    const sec = [].concat(e.secondary_keys || e.keysecondary || []).map(String).map(s => s.trim()).filter(Boolean);
    const n = (v, d) => { const k = Number(v); return v !== null && v !== '' && v !== undefined && isFinite(k) ? k : d; };
    return {
      i, comment: e.comment || '', content: e.content.trim(), keys, sec,
      constant: !!e.constant, enabled: e.enabled !== false && !e.disable,
      selective: e.selective !== false, logic: Number(x.selectiveLogic != null ? x.selectiveLogic : e.selectiveLogic) || 0,
      order: Number(e.insertion_order != null ? e.insertion_order : e.order) || 100,
      atDepth: Number(pos) === 4, depth: Math.max(0, Number(x.depth != null ? x.depth : e.depth) || 4),
      scanDepth: Number(x.scan_depth != null ? x.scan_depth : e.scanDepth) || 0,
      caseSensitive: !!(x.case_sensitive != null ? x.case_sensitive : e.caseSensitive),
      // the timing set, as 酒馆 documents it (useProbability left out = on, as 酒馆 does)
      prob: Math.max(0, Math.min(100, n(pick('probability'), 100))), useProb: pick('useProbability') !== false,
      group: String(pick('group') || '').split(',').map(s => s.trim()).filter(Boolean),
      groupOverride: !!pick('groupOverride'), groupWeight: Math.max(0, n(pick('groupWeight'), 100)),
      sticky: Math.max(0, n(pick('sticky'), 0)), cooldown: Math.max(0, n(pick('cooldown'), 0)), delay: Math.max(0, n(pick('delay'), 0)),
      excludeRecursion: !!pick('excludeRecursion'), preventRecursion: !!pick('preventRecursion'), delayUntilRecursion: !!pick('delayUntilRecursion'),
      raw: e,
    };
  }).filter(e => e.enabled);
}
// His card's own 世界书 (character_book: may hold his persona) plus world books she brought on their own
// (card.extensions.modu.lore: world lore only, never his persona, never her memories).
// A 世界书 file beside the open card (his folder, core.folderData.lore) counts too, once: a book of the same
// name already in the card (an import before this) is not read twice.
function cardLore(card){
  const c = card || {}, own = loreEntries(c.character_book).map(e => Object.assign(e, { own:true }));
  const inCard = [].concat((c.extensions && c.extensions.modu && c.extensions.modu.lore) || []);
  const names = new Set(inCard.map(b => String((b && b.name) || '')));
  const beside = card && card === core.store.card && core.folderData && Array.isArray(core.folderData.lore) ? core.folderData.lore.filter(b => b && !names.has(String(b.name || ''))) : [];
  const more = inCard.flatMap((b, k) => loreEntries(b).map(e => Object.assign(e, { i: `x${k}-${e.i}`, own:false })))
    .concat(beside.flatMap((b, k) => loreEntries(b).map(e => Object.assign(e, { i: `y${k}-${e.i}`, own:false }))));
  return { own, all: own.concat(more) };
}
// A key matches the scanned text: /regex/flags, or a plain key (case-insensitive unless the entry says
// so). Latin keys match whole words; CJK keys match anywhere (Chinese has no spaces).
function keyHit(key, text, cs){
  const re = key.match(/^\/(.+)\/([a-z]*)$/);
  // a /regex/ key runs only once the sandbox has passed it (core.regex.loreKey), never unchecked
  if (re){ const rx = core.regex && core.regex.loreKey(re[1], re[2]); return rx ? rx.test(text) : false; }
  const k = cs ? key : key.toLowerCase(), t = cs ? text : text.toLowerCase();
  if (/^[\x00-\x7f]+$/.test(k) && /^\w/.test(k)) return new RegExp('(^|[^A-Za-z0-9_])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^A-Za-z0-9_])').test(t);
  return t.includes(k);
}
function loreActive(e, text){
  if (e.constant) return true;
  if (!e.keys.length || !e.keys.some(k => keyHit(k, text, e.caseSensitive))) return false;
  if (!e.selective || !e.sec.length) return true;
  const hits = e.sec.map(k => keyHit(k, text, e.caseSensitive));
  return [hits.some(Boolean), !hits.every(Boolean), !hits.some(Boolean), hits.every(Boolean)][e.logic] ?? hits.some(Boolean);
}

// --- The timing set: 酒馆's documented World Info behaviour, as pure functions ------------------
//   probability   an entry that triggers goes in only with its chance (useProbability; 100 = always). The roll is
//                 seeded by the entry and the chat length, so the same prompt built twice comes out the same
//   group         of the entries that went in with the same group label, one stays: a sticky one first, else the
//                 highest order among those with groupOverride, else one drawn by groupWeight
//   sticky N      once in, it stays in for the next N messages, keys or not (no new roll)
//   cooldown N    after it went in (after its sticky time, if any) it cannot go in for N messages
//   delay N       it cannot go in until the chat has at least N messages
//   recursion     what went in is scanned for the keys of the others (preventRecursion: its text triggers nothing;
//                 excludeRecursion: only the chat can trigger it; delayUntilRecursion: only another entry can), at
//                 most `depth` rounds (default 3)
// `count` is the chat's length in messages (both sides, her latest included), as 酒馆 counts it. `timing` is
// { <hash>: { at } }: the chat length when that entry last went in fresh; loreSelect gives back the new one.
const hashText = s => { let x = 2166136261; for (const c of String(s)) x = Math.imul(x ^ c.charCodeAt(0), 16777619) >>> 0; return x.toString(36); };
const roll = (...parts) => parseInt(hashText(parts.join('|')), 36) / 4294967296;
function loreHash(e){ return hashText((e.own === false ? 'x' : '') + e.i + '|' + e.content.slice(0, 200)); }
function loreTimed(e, t, count){
  const at = t && Number.isFinite(Number(t.at)) ? Number(t.at) : null;
  if (at == null || count <= at) return { sticky: false, cooling: false };
  const sticky = e.sticky > 0 && count < at + e.sticky;
  const from = at + (e.sticky || 0), cooling = !sticky && e.cooldown > 0 && count >= from && count < from + e.cooldown;
  return { sticky, cooling };
}
// o: { scan(e) → text (the chat the entry scans), count, timing, gate(e) → bool (time and state rules), seed, depth }
// → { on: [entry] (in the order they went in), timing, why: { hash: 'sticky'|'key'|'constant'|'recursion'|'chance'|'group'|'cooldown'|'delay'|'gate' } }
function loreSelect(entries, o = {}){
  const count = Math.max(0, Number(o.count) || 0), timing = Object.assign({}, o.timing || {}), seed = String(o.seed || '');
  const why = {}, on = [], onSet = new Set(), failed = new Set(), depth = Math.max(0, o.depth == null ? 3 : Number(o.depth) || 0);
  const pool = (entries || []).filter(e => {
    const h = loreHash(e);
    if (o.gate && !o.gate(e)){ why[h] = 'gate'; return false; }
    if (e.delay && count < e.delay){ why[h] = 'delay'; return false; }
    return true;
  });
  const timed = new Map(pool.map(e => [e, loreTimed(e, timing[loreHash(e)], count)]));
  let buffer = '';
  for (let level = 0; level <= depth; level++){
    const now = [];
    for (const e of pool){
      const h = loreHash(e);
      if (onSet.has(e) || failed.has(e)) continue;
      const tm = timed.get(e);
      if (tm.sticky){ if (level === 0){ now.push(e); why[h] = 'sticky'; } continue; }
      if (tm.cooling){ why[h] = 'cooldown'; continue; }
      if (level === 0 && e.delayUntilRecursion) continue;
      if (level > 0 && e.excludeRecursion) continue;
      let hit = false;
      if (e.constant) hit = level === 0;
      else { const text = (o.scan ? o.scan(e) : '') + (level > 0 ? '\n' + buffer : ''); hit = loreActive(e, text); }
      if (!hit) continue;
      now.push(e); why[h] = e.constant ? 'constant' : level ? 'recursion' : 'key';
    }
    // inclusion groups first, as 酒馆 does: a group that already has an entry in takes no more; else one candidate stays
    // (a sticky one, else the highest order with groupOverride, else drawn by groupWeight). Then the chance is rolled for
    // what is left: a group winner that fails its roll leaves the group empty this time.
    const drop = (e, w) => { const i = now.indexOf(e); if (i >= 0) now.splice(i, 1); failed.add(e); why[loreHash(e)] = w; };
    for (const g of new Set(now.flatMap(e => e.group))){
      const members = now.filter(e => e.group.includes(g));
      if (on.some(e => e.group.includes(g))){ for (const e of members) if (!timed.get(e).sticky) drop(e, 'group'); continue; }
      if (members.length < 2) continue;
      const stick = members.filter(e => timed.get(e).sticky), over = members.filter(e => e.groupOverride);
      let keep;
      if (stick.length) keep = stick.sort((a, b) => b.order - a.order)[0];
      else if (over.length) keep = over.sort((a, b) => b.order - a.order)[0];
      else {
        const total = members.reduce((s, e) => s + e.groupWeight, 0); let r = roll(seed, g, count, 'g') * (total || members.length);
        keep = members.find(e => (r -= (total ? e.groupWeight : 1)) < 0) || members[members.length - 1];
      }
      for (const e of members) if (e !== keep) drop(e, 'group');
    }
    for (const e of now.slice()) if (!timed.get(e).sticky && e.useProb && e.prob < 100 && !(roll(seed, loreHash(e), count, 'p') * 100 < e.prob)) drop(e, 'chance');
    for (const e of now) { onSet.add(e); on.push(e); }
    const fresh = now.filter(e => !e.preventRecursion);
    if (!fresh.length) break;
    buffer += '\n' + fresh.map(e => e.content).join('\n');
  }
  // the new timing: an entry that went in fresh (not by its sticky time) starts its sticky / cooldown from now;
  // effects that are over are dropped
  for (const e of on){ const h = loreHash(e); if ((e.sticky || e.cooldown) && !timed.get(e).sticky) timing[h] = { at: count }; }
  const known = new Map((entries || []).map(e => [loreHash(e), e]));
  for (const h of Object.keys(timing)){
    const e = known.get(h), at = Number(timing[h] && timing[h].at);
    if (!e || !Number.isFinite(at) || (count > at && count >= at + (e.sticky || 0) + (e.cooldown || 0))) delete timing[h];
  }
  return { on, timing, why };
}

// --- Calendar gates for the 世界书's time rules (lunar / solar_term) -----------------------------
// The lunar date comes from the browser's own Chinese calendar (Intl, 'zh-u-ca-chinese'); where it is missing the
// lunar gates stay off. → { md: 'MM-DD', leap, eve } | null; eve = the day before the lunar new year.
function lunarDate(t){
  try {
    const f = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'numeric', day: 'numeric' });
    const read = d => { const p = f.formatToParts(d), m = (p.find(x => x.type === 'month') || {}).value || '', dd = (p.find(x => x.type === 'day') || {}).value || '';
      const mm = parseInt(String(m).replace(/\D/g, ''), 10), day = parseInt(String(dd).replace(/\D/g, ''), 10); if (!mm || !day) return null;
      return { md: String(mm).padStart(2, '0') + '-' + String(day).padStart(2, '0'), leap: /闰|bis/i.test(m) }; };
    const d = new Date(t), today = read(d), next = read(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 12));
    if (!today) return null;
    return Object.assign(today, { eve: !!(next && next.md === '01-01' && !next.leap) });
  } catch { return null; }
}
// The 24 solar terms by the usual 21st-century formula (day = floor(Y·0.2422 + C) − leap years, counted to Y−1 for
// 小寒 … 雨水), good to a day; names in pinyin, as the 世界书 time rules write them (qingming).
const TERMS = [['xiaohan', 0, 5.4055], ['dahan', 0, 20.12], ['lichun', 1, 3.87], ['yushui', 1, 18.73], ['jingzhe', 2, 5.63], ['chunfen', 2, 20.646],
  ['qingming', 3, 4.81], ['guyu', 3, 20.1], ['lixia', 4, 5.52], ['xiaoman', 4, 21.04], ['mangzhong', 5, 5.678], ['xiazhi', 5, 21.37],
  ['xiaoshu', 6, 7.108], ['dashu', 6, 22.83], ['liqiu', 7, 7.5], ['chushu', 7, 23.13], ['bailu', 8, 7.646], ['qiufen', 8, 23.042],
  ['hanlu', 9, 8.318], ['shuangjiang', 9, 23.438], ['lidong', 10, 7.438], ['xiaoxue', 10, 22.36], ['daxue', 11, 7.18], ['dongzhi', 11, 21.94]];
function solarTerm(t){
  const d = new Date(t), y = d.getFullYear() % 100;
  for (const [name, m, c] of TERMS){
    if (m !== d.getMonth()) continue;
    const leaps = m < 2 ? Math.floor((y - 1) / 4) : Math.floor(y / 4);
    if (Math.floor(y * 0.2422 + c) - leaps === d.getDate()) return name;
  }
  return '';
}

Object.assign(core, { loreEntries, cardLore, loreActive, loreSelect, loreHash, lunarDate, solarTerm });
})(globalThis[Symbol.for('modu.core')]);
// app/core/reply.js: his reply: the reply format and its tags, bubbles and action lines, punctuation.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';

const EMOTIONS = ['joy', 'sadness', 'anger', 'surprise', 'relief', 'neutral'];
function splitBubbles(text){
  const lines = String(text || '').split(/\r?\n+/).map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const l of lines){
    if (l.length <= 40) { out.push(l); continue; }
    // a long line: cut after Chinese sentence ends, never inside *actions*
    const parts = l.split(/(\*[^*]+\*)/), pieces = [''];
    for (const part of parts){
      if (/^\*[^*]+\*$/.test(part)) { pieces[pieces.length - 1] += part; continue; }
      const sent = part.split(/(?<=[。！？!?…~～]+[”"」]?)/);
      sent.forEach((x, i) => { if (i && pieces[pieces.length - 1].trim().length > 12) pieces.push(''); pieces[pieces.length - 1] += x; });
    }
    out.push(...pieces.map(x => x.trim()).filter(Boolean));
  }
  // at most six bubbles: the rest joins the last one
  return out.length > 6 ? out.slice(0, 5).concat(out.slice(5).join(' ')) : out;
}
// A chat message drops its final 。 (only a trailing 。; ？！… and everything inside stay). Not for
// letters, diaries or posts: those are written text and keep theirs.
function dropFinalStop(line){ const s = String(line == null ? '' : line), t = s.replace(/。+\s*$/, ''); return t.trim() ? t : s; }
// The same over a whole reply, line by line, leaving action lines (*…*) alone. His chat file keeps what the
// model wrote; the chat shows it without (splitParts), and his past replies reach the prompt without, so the
// history does not teach the 。 back.
function chatStops(text){ return String(text == null ? '' : text).split('\n').map(l => /\*\s*$/.test(l) ? l : dropFinalStop(l)).join('\n'); }
// His reply as the chat shows it: [{ kind: 'say' | 'act', text }]. 'say' is a bubble (its final 。
// dropped); 'act' is what he does (between asterisks, or （…）/(…) as a whole line; or a first line
// that narrates him in the third person, "他刚收了碗。", when more lines follow), shown as a quiet line
// with no bubble. opts: { name, pronoun ('他'/'她'/'TA'), actions: false → the 'act' parts are left out }.
// Known limit: a first line about someone else that starts with his pronoun and has no 我/你 in it
// ("他又迟到了。" about a colleague, followed by more lines) is read as narration.
function splitParts(text, opts = {}){
  const out = [], name = String(opts.name || ''), pro = String(opts.pronoun || '');
  const bubbles = splitBubbles(text);
  bubbles.forEach((b, bi) => {
    if (/^[（(][^（）()]+[)）]$/.test(b)) { out.push({ kind:'act', text: b.slice(1, -1).trim() }); return; }
    for (const part of b.split(/(\*[^*]+\*)/)){
      const p = part.trim(); if (!p) continue;
      if (/^\*[^*]+\*$/.test(p)) { const a = p.slice(1, -1).trim(); if (a) out.push({ kind:'act', text: a }); continue; }
      const third = bi === 0 && bubbles.length > 1 && p === b.trim() && !/[我你咱？?！!吗呢吧啊嘛]/.test(p) &&
        ((name && p.startsWith(name)) || (pro && pro !== 'TA' && p.startsWith(pro)));
      out.push(third ? { kind:'act', text: p } : { kind:'say', text: dropFinalStop(p) });
    }
  });
  return opts.actions === false ? out.filter(x => x.kind !== 'act') : out;
}
// A photo he "sends" is a tag in his text ([照片：…], 【图片: …】, 〔照片〕, [photo: …]). A preview (the
// lock screen, the chat list) shows it as `label`; 相册 keeps what each one shows (his words for it). → { text, photos }
const PHOTO = /[\[【〔]\s*(?:照片|图片|相片|photo|picture|image)\s*(?:[:：]\s*([^\]】〕\n]*?))?\s*[\]】〕]/gi;
function photoTags(text, label = '[照片]'){
  const photos = [];
  const t = String(text == null ? '' : text).replace(PHOTO, (m, cap) => { photos.push(String(cap || '').trim()); return label; });
  return { text: t, photos };
}
// Models often write ASCII punctuation inside Chinese ("记得呀,你说…?"); a Chinese chat app shows full-width.
const FW = { ',':'，', '?':'？', '!':'！', ':':'：', ';':'；' };
function tidyCJK(t){ return t.replace(/([一-鿿“”])([,?!:;])(?=\s*[一-鿿“”"*]|\s*$)|([,?!:;])(?=[一-鿿])/g, (m, a, p, q) => a ? a + FW[p] : FW[q]); }
// --- Reply format: what he says, plus optional trailing tags -----------------------------------------
// The reply is plain text (one line per bubble), then, at the very end and in any order, optional tags:
//   [emotion: joy]        his mood, one of EMOTIONS (also 情绪 / mood; a Chinese word such as 开心 maps)
//   [心声: 其实有点想她]     inner voice, shown only if she taps (also inner / os / 内心)
//   [no-reply]            he read it and chose not to answer (also 不回 / 已读不回 / skip / silent)
//   [next: 30]            minutes until he would like to write again (also 下次联系 / next-contact)
//   [promise: 明早叫你起床]  something he said he will do later; a job may be booked for it
//   [state: trust+1 她记得]  a change he proposes to a key his card declares; state.nudge decides
// A promise or state tag is taken wherever it stands (it is never meant to be seen), and one that cannot be
// read (no key, no number, an empty promise) is dropped quietly: never shown, never an error.
// Brackets [] 【】 () （） and : or ： are all taken, any case. Nothing is required: a tag that is
// missing, unknown or malformed is left alone or dropped, and the reply degrades to plain text with mood
// neutral. Never an error. Also taken: a <think>…</think> block (dropped), a whole reply written as JSON
// ({"reply"|"text"|"content"|"message", "emotion", "inner", …}), code fences around it, and a tag cut
// off at the end by the token limit (dropped).
const MOOD_WORDS = { '开心':'joy', '高兴':'joy', '快乐':'joy', '喜悦':'joy', '难过':'sadness', '伤心':'sadness', '悲伤':'sadness', '低落':'sadness',
  '生气':'anger', '愤怒':'anger', '恼火':'anger', '惊讶':'surprise', '吃惊':'surprise', '意外':'surprise', '安心':'relief', '释然':'relief', '放松':'relief',
  '平静':'neutral', '中性':'neutral', '一般':'neutral', 'happy':'joy', 'sad':'sadness', 'angry':'anger', 'surprised':'surprise', 'relieved':'relief', 'calm':'neutral' };
function moodOf(v){ const k = String(v || '').trim().toLowerCase(); if (EMOTIONS.includes(k)) return k; return MOOD_WORDS[k] || MOOD_WORDS[String(v || '').trim()] || ''; }
const TAG_KEYS = [
  ['emotion', /^(?:emotion|情绪|mood|心情)$/i],
  ['inner', /^(?:inner(?:[ _-]?voice)?|心声|内心|os|inner thoughts?)$/i],
  ['noReply', /^(?:no[ _-]?reply|不回|已读不回|skip|silent|silence)$/i],
  ['next', /^(?:next(?:[ _-]?contact)?|下次联系|下次)$/i],
  ['promise', /^(?:promise|承诺|约定|答应)$/i],
  ['state', /^(?:state|状态)$/i],
];
// [state: key+n reason] → { key, delta, why } or null (malformed: dropped). The key is any text a
// card author wrote (信任, trust level), up to the first sign a number follows; state.nudge matches it to the card's own key
function stateTag(v){
  const m = String(v || '').trim().match(/^([^\n]{1,64}?)\s*([+\-−＋－])\s*(\d+(?:\.\d+)?)\s*[,，:：]?\s*([\s\S]*)$/);
  if (!m || !m[1].trim()) return null;
  const n = parseFloat(m[3]); if (!isFinite(n) || !n) return null;
  return { key: m[1].trim(), raw: String(v).trim(), delta: /[\-−－]/.test(m[2]) ? -n : n, why: m[4].trim().slice(0, 120) };
}
function addTag(out, key, v){
  if (key === 'promise'){ const p = String(v || '').trim(); if (p) out.promises.push(p.slice(0, 200)); }
  else if (key === 'state'){ const st = stateTag(v); if (st) out.state.push(st); }
}
// promise and state tags anywhere in the text (also one cut off at the very end); the text closes up around them
const PROMISE_OR_STATE = /[\[【]\s*(promise|承诺|约定|答应|state|状态)\s*[:：]\s*([^\[\]【】\n]*)[\]】]/gi;
const PROMISE_OR_STATE_CUT = /[\[【]\s*(?:promise|承诺|约定|答应|state|状态)\s*[:：][^\[\]【】\n]*$/i;
function takeTags(t, out){
  return t.replace(PROMISE_OR_STATE, (all, k, v) => { addTag(out, tagKey(k), v); return ''; }).replace(PROMISE_OR_STATE_CUT, '')
    .replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
}
const TAG_AT_END = /[\[【(（]\s*([^\[\]【】()（）:：\n]{1,24}?)\s*(?:[:：]\s*([^\[\]【】\n]*?))?\s*[\]】)）]\s*$/;
const TAG_CUT = /\n?\s*[\[【(（]\s*(?:emotion|情绪|mood|心情|inner|心声|内心|os|no[ _-]?reply|不回|next|下次)[^\]】)）\n]*$/i;
function tagKey(k){ for (const [name, re] of TAG_KEYS) if (re.test(k.trim())) return name; return ''; }
function minutesOf(v){
  const t = String(v || '').trim(), n = parseFloat(t.replace(/[^\d.]/g, ''));
  if (!isFinite(n) || n < 0) return null;
  return Math.round(/小时|hour|h\b/i.test(t) ? n * 60 : /天|day|d\b/i.test(t) ? n * 1440 : n);
}
function parseReply(raw){
  const out = { text:'', emotion:'neutral', labelled:false, inner:'', noReply:false, nextContact:null, promises:[], state:[] };
  let t = String(raw == null ? '' : raw).replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^\s*<think>[\s\S]*$/i, '').trim();
  // a whole reply as JSON (some models do this when asked for any structure), fences or not
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i); if (fenced) t = fenced[1].trim();
  if (/^\{[\s\S]*\}$/.test(t)){
    try {
      const j = JSON.parse(t), body = [j.reply, j.text, j.content, j.message, j.say].find(x => typeof x === 'string' || Array.isArray(x));
      if (j && typeof j === 'object' && body !== undefined){
        out.text = Array.isArray(body) ? body.join('\n') : body;
        const mood = moodOf(j.emotion || j.mood || j['情绪']); if (mood){ out.emotion = mood; out.labelled = true; }
        const inner = j.inner || j.inner_voice || j['心声'] || j.os; if (typeof inner === 'string') out.inner = inner.trim();
        out.noReply = j.no_reply === true || j.noReply === true;
        const nx = minutesOf(j.next_contact != null ? j.next_contact : j.next); if (nx != null && (j.next_contact != null || j.next != null)) out.nextContact = nx;
        [].concat(j.promise || j.promises || []).forEach(x => addTag(out, 'promise', x));
        [].concat(j.state || []).forEach(x => addTag(out, 'state', typeof x === 'string' ? x : x && x.key != null ? `${x.key}${Number(x.delta) < 0 ? '-' : '+'}${Math.abs(Number(x.delta))} ${x.why || ''}` : ''));
        out.text = takeTags(out.text, out).trim(); if (out.noReply && out.text) out.noReply = false;
        return out;
      }
    } catch {}
  }
  t = takeTags(t, out).trim();
  t = t.replace(TAG_CUT, (m) => /[\]】)）]/.test(m) ? m : '').trim();
  // peel tags off the end, one at a time; the first one that is not ours stops the peeling
  for (let guard = 0; guard < 8; guard++){
    let m = t.match(TAG_AT_END), key = m && tagKey(m[1]), val = m ? (m[2] || '') : '';
    if (!m || !key){
      // a bare last line "emotion: joy" (no brackets)
      const b = t.match(/(?:^|\n)\s*(emotion|情绪|mood|心声|inner|next)\s*[:：]\s*([^\n]*)\s*$/i);
      if (!b) break; m = b; key = tagKey(b[1]); val = b[2];
      if (key === 'emotion' && !moodOf(val)) break;
    }
    t = t.slice(0, m.index).trim();
    if (key === 'emotion'){ if (!out.labelled){ const mood = moodOf(val); if (mood){ out.emotion = mood; out.labelled = true; } } }
    else if (key === 'inner'){ if (!out.inner) out.inner = val.trim(); }
    else if (key === 'noReply') out.noReply = true;
    else if (key === 'next'){ const n = minutesOf(val); if (n != null && out.nextContact == null) out.nextContact = n; }
    else addTag(out, key, val);
  }
  out.text = t;
  if (out.noReply && out.text) out.noReply = false;   // he said something after all: the words win
  return out;
}
// Split the model's text into what he says and the label he gave. A missing or unknown label → neutral.
// It reads through parseReply, so the other optional tags are cut from the text too.
function splitEmotion(text){ const r = parseReply(text); return { text: r.text, emotion: r.emotion, labelled: r.labelled }; }

Object.assign(core, { EMOTIONS, splitBubbles, dropFinalStop, chatStops, splitParts, tidyCJK, parseReply,
  splitEmotion, photoTags });
})(globalThis[Symbol.for('modu.core')]);
// app/core/memory.js: memory files: memory/*.md with front matter, read, written, added, edited, pinned, deleted by hand.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, store, today, writeFile } = core;

// --- Memory: memory/<date>-<kind>-<slug>.md, front matter {kind, date, to?, source, confidence} ---
// The front matter is YAML, as Obsidian, site generators and other memory tools read it.
// A small subset, no library: flat `key: value` lines; plain, 'single' and "double" quoted values; [a, b]
// and `- a` lists. Modu quotes a value whenever YAML would read it otherwise, and when it writes a file again
// it keeps every line it did not write (other keys, comments) where it was and as it was. Older files load
// as before: a plain value with ": " in it (Modu used to write `source: imported: notes.md`) is read whole.
// Memory 0.4: optional Ombre-shaped keys that are INPUTS only: importance (1-5), valence (-1..1),
// arousal (0..1), threads (open threads, a list), closed (the day its threads closed), last_seen, reinforced (times
// brought back), faded (the day a tidy marked it overtaken). How strongly he still holds it (the fading score) is
// worked out from these when read (memory-engine.js), never stored, so another tool's edit can never leave it wrong.
// A 0.3 file reads as before (no such keys: it never fades); a file Modu writes again says 0.4.
const MEMORY_FORMAT = 'modu-xiaoshouji-memory/0.4';
const MODU_KEYS = ['kind', 'date', 'to', 'source', 'confidence', 'voice', 'pinned'];
const OMBRE_NUM = ['importance', 'valence', 'arousal', 'reinforced'], OMBRE_DAY = ['closed', 'last_seen', 'faded'];
const front = new WeakMap();   // a memory read from a file → its front-matter lines, for writing it again
function fmSplit(s){   // a flow list's items, split at the commas outside quotes
  const out = []; let cur = '', q = '';
  for (const ch of s){
    if (q){ cur += ch; if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'"){ q = ch; cur += ch; continue; }
    if (ch === ','){ out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur); return out.map(x => x.trim()).filter(Boolean);
}
function fmScalar(v){
  const t = String(v == null ? '' : v).trim();
  let m = t.match(/^"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/);
  if (m){ try { return JSON.parse('"' + m[1] + '"'); } catch { return m[1]; } }
  m = t.match(/^'((?:[^']|'')*)'\s*(?:#.*)?$/); if (m) return m[1].replace(/''/g, "'");
  m = t.match(/^\[(.*)\]\s*(?:#.*)?$/); if (m) return fmSplit(m[1]).map(fmScalar);
  if (/: /.test(t)) return t;   // not YAML (an older Modu file): the whole value, as before
  return t.replace(/\s+#.*$/, '');
}
// → [{ key, rest, value, lines }] in file order; a line that is no key (a comment, a blank line) has key ''
function fmRead(src){
  const out = [];
  for (const line of String(src).split(/\r?\n/)){
    const last = out[out.length - 1];
    if (/^[\s-]/.test(line) && line.trim() && last && last.key){ last.lines.push(line); continue; }   // a list item or an indented line
    const i = line.indexOf(':');
    if (i > 0 && !/^#/.test(line)){ out.push({ key: line.slice(0, i).trim(), rest: line.slice(i + 1).trim(), lines: [line] }); continue; }
    out.push({ key: '', rest: '', lines: [line] });
  }
  for (const e of out) if (e.key){
    const items = e.lines.slice(1).map(l => l.match(/^\s*-\s+(.*)$/)).filter(Boolean);
    e.value = !e.rest && items.length ? items.map(x => fmScalar(x[1])) : fmScalar(e.rest);
  }
  return out;
}
// a value as YAML: plain when YAML reads it back as the same string, else in double quotes
function fmWrite(v){
  if (v === true || v === false) return String(v);
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return '[' + v.map(x => fmWrite(String(x))).join(', ') + ']';
  const s = String(v);
  const plain = s !== '' && s === s.trim() && !/[\n\r\t]/.test(s) && !/^[-?:,\[\]{}#&*!|>'"%@`]/.test(s) && !/: |\s#|:$/.test(s) &&
    !/^(?:true|false|yes|no|on|off|y|n|null|~)$/i.test(s) && !/^[-+]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(s) && !/^0[xo]/i.test(s) && !/^[-+]?\.(?:inf|nan)$/i.test(s);
  return plain ? s : JSON.stringify(s);
}
function parseMemoryFile(name, text){
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const entries = m ? fmRead(m[1]) : [], fm = {};
  for (const e of entries) if (e.key && !(e.key in fm)) fm[e.key] = Array.isArray(e.value) ? e.value.join(', ') : String(e.value);
  const it = { file:name, kind: fm.kind || 'fact', date: fm.date || '', to: fm.to || '', source: fm.source || '', confidence: fm.confidence || '', voice: fm.voice || '', text: (m ? m[2] : text).trim() };
  if (fm.pinned === 'true') it.pinned = true;   // pinned to the top of 记忆
  if (fm.format) it.format = fm.format;   // whose format the file says it is (Modu's own, or none)
  // memory 0.4: the inputs of the fading score, when the file has them (any tool may write them)
  for (const k of OMBRE_NUM) if (fm[k] != null && String(fm[k]).trim() !== '' && isFinite(Number(fm[k]))) it[k] = Number(fm[k]);
  for (const k of OMBRE_DAY) if (fm[k]) it[k] = String(fm[k]);
  { const th = entries.find(e => e.key === 'threads'); if (th) it.threads = [].concat(th.value).map(x => String(x).trim()).filter(Boolean); }
  if (entries.length) front.set(it, entries);
  return it;
}
async function readMemory(dir){
  const out = [];
  try {
    const md = await dir.getDirectoryHandle('memory');
    for await (const [name, h] of md.entries()) if (h.kind === 'file' && name.endsWith('.md') && name !== 'README.md') out.push(parseMemoryFile(name, await (await h.getFile()).text()));
  } catch {}
  return out.sort((a,b) => (a.date + a.file).localeCompare(b.date + b.file));
}
function slug(t){ return t.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'memory'; }
function memoryBody(it, opts = {}){
  const want = [['kind', it.kind], ['date', it.date], ['to', it.to || ''], ['source', it.source || 'chat.jsonl'], ['confidence', it.confidence || 'medium'],
                ['voice', it.voice || 'his'], ['pinned', it.pinned ? true : '']]
    .concat(OMBRE_NUM.slice(0, 3).map(k => [k, isFinite(it[k]) && it[k] !== null && it[k] !== '' ? Number(it[k]) : '']),
            [['threads', Array.isArray(it.threads) && it.threads.length ? it.threads : ''], ['closed', it.closed || ''],
             ['last_seen', it.last_seen || ''], ['reinforced', Number(it.reinforced) > 0 ? Number(it.reinforced) : ''], ['faded', it.faded || '']]);
  const old = front.get(it), mine = new Map(want), done = new Set(), lines = [];
  if (!old){
    for (const [k, v] of want) if (v !== '' && v != null) lines.push(`${k}: ${fmWrite(v)}`);
    lines.push(`format: ${MEMORY_FORMAT}`);
  } else {
    for (const e of old){
      if (e.key === 'format' && /^modu-xiaoshouji-memory\//.test(String(e.value))){ lines.push(`format: ${MEMORY_FORMAT}`); continue; }   // Modu's own format line: now 0.4
      if (!e.key || !mine.has(e.key)){ lines.push(...e.lines); continue; }   // not Modu's (their keys, a comment): as it was
      if (done.has(e.key)) continue;                                         // the same key twice: once is enough
      done.add(e.key); const v = mine.get(e.key);
      if (v === '' || v == null) continue;                                   // `to` or `pinned` no longer set
      const same = String(e.value) === String(v) && (/^["'\[]/.test(e.rest) || Array.isArray(e.value) || fmWrite(v) === e.rest.replace(/\s+#.*$/, ''));
      if (same) lines.push(...e.lines); else lines.push(`${e.key}: ${fmWrite(v)}`);
    }
    // a key the file never had is added only when it was really set (an edit's source, a pin), never as a default: another
    // tool's file does not gain Modu's kind, source, confidence or voice by being written again
    const defaulted = k => (k === 'kind') || ((k === 'source' || k === 'confidence' || k === 'voice') && !it[k]);
    for (const [k, v] of want) if (!done.has(k) && v !== '' && v != null && !defaulted(k)) lines.push(`${k}: ${fmWrite(v)}`);
    if (opts.format && !old.some(e => e.key === 'format')) lines.push(`format: ${MEMORY_FORMAT}`);   // an older Modu file, migrated
  }
  return `---\n${lines.join('\n')}\n---\n${it.text}\n`;
}
// Memory 0.4 migration on open: an older Modu file (no format line, a plain value YAML would read otherwise, such as
// `source: imported: notes.md`) is written again as YAML, every value the same, and says 0.4. → true when it needs it.
function memoryNeedsMigration(it){
  const old = front.get(it); if (!old || old.some(e => e.key === 'format')) return false;
  return old.some(e => MODU_KEYS.includes(e.key) && /: |:$/.test(e.rest) && !/^["'\[]/.test(e.rest));   // what older Modu wrote unquoted, in its own keys
}
// A memory he writes says real dates, never 今天 / 明天 / 后天 / 昨天 / 前天 (they go stale: 「她明天11月5日
// 要去看牙」 read a week later). Each is read against the item's own day (`date`, the day it is from): beside a date it
// is dropped (明天11月5日 → 11月5日), alone it becomes that date (明天早上 → 11月5日早上; 明晚 → 11月5日晚上).
// Only for his own items (never hers, a pinned or hand-written one, an imported one); Chinese only.
const REL_DAY = { 前天: -2, 昨天: -1, 昨晚: -1, 今天: 0, 今早: 0, 今晚: 0, 明天: 1, 明早: 1, 明晚: 1, 后天: 2 };
const REL_PART = { 晚: '晚上', 早: '早上' };
const MD = /(?:\d{4}年)?\d{1,2}月\d{1,2}[日号]/.source, REL = /(前天|昨天|昨晚|今天|今早|今晚|明天|明早|明晚|后天)/.source;
const DATE_THEN_REL = new RegExp(String.raw`(${MD})\s*[（(]\s*${REL}\s*[）)]`, 'g');
const REL_THEN_DATE = new RegExp(String.raw`${REL}\s*[（(]?\s*(?:也就是|就是|是)?\s*(${MD})\s*[）)]?`, 'g');
function datedWords(text, day){
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day || '')), t = String(text || '');
  if (!m || !/[一-鿿]/.test(t)) return t;
  return t.replace(DATE_THEN_REL, '$1').replace(REL_THEN_DATE, (a, w, d) => d + (REL_PART[w[1]] || ''))
    .replace(new RegExp(REL, 'g'), w => { const d = new Date(+m[1], m[2] - 1, +m[3] + REL_DAY[w]); return `${d.getMonth() + 1}月${d.getDate()}日` + (REL_PART[w[1]] || ''); });
}
const hisOwn = it => !!it && it.voice === 'his' && !it.pinned && !/by hand/.test(it.source || '');
async function saveMemoryItem(it, opts = {}){
  if (hisOwn(it) && it.date){ const t = datedWords(it.text, it.date); if (t !== it.text) it.text = t; }
  if (!store.writable) return;
  const md = await store.dir.getDirectoryHandle('memory', { create:true });
  await writeFile(md, it.file, memoryBody(it, opts));
}
// Whose words they are. 'his' (the default): "我" is him, "你" is her. 'hers': she wrote it
// as herself, "我" is her; he reads it that way round (the memory block says so).
const HAND_VOICES = ['his', 'hers'];
async function addMemory(text, kind='fact', opts={}){
  const voice = HAND_VOICES.includes(opts && opts.voice) ? opts.voice : 'his';
  const it = { kind, date: today(), source:'written by hand', confidence:'high', voice, text: text.trim() };
  it.file = `${it.date}-${kind}-${slug(it.text)}-${Date.now().toString(36).slice(-4)}.md`;
  await saveMemoryItem(it); store.memory.push(it); emit('memory', store.memory); return it;
}
const ownMemory = it => store.memory.find(m => m === it) || (it && it.file && store.memory.find(m => m.file === it.file)) || it;
// opts.voice: 'his' | 'hers', to turn round a memory written from the wrong side
async function editMemory(it, text, opts={}){
  it = ownMemory(it);
  it.text = text.trim(); { const was = (it.source || '').replace(/,? ?edited by hand$/, ''); it.source = was ? was + ', edited by hand' : 'edited by hand'; } it.confidence = 'high';
  if (opts && HAND_VOICES.includes(opts.voice)) it.voice = opts.voice;
  await saveMemoryItem(it); emit('memory', store.memory);
}
// Pinned memories come first in 记忆. Only the list order; what he is given is unchanged.
async function pinMemory(it, on = true){
  it = ownMemory(it);
  if (on) it.pinned = true; else delete it.pinned;
  await saveMemoryItem(it); emit('memory', store.memory);
}
async function deleteMemory(it){
  if (store.writable){ try { const md = await store.dir.getDirectoryHandle('memory'); await md.removeEntry(it.file); } catch(e){ if (e.name !== 'NotFoundError') throw e; } }
  store.memory = store.memory.filter(m => m !== it); emit('memory', store.memory);
}

Object.assign(core, { MEMORY_FORMAT, memoryNeedsMigration, parseMemoryFile, readMemory, slug, memoryBody, saveMemoryItem, addMemory, editMemory,
  pinMemory, deleteMemory, datedWords });
})(globalThis[Symbol.for('modu.core')]);
// app/core/import.js: import: a card (PNG / JSON), a 酒馆 chat, memories she already has, the c.ai app export, staged before saving.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { timeOf, markUntimely, today, msgDate, isoDay, now, loreEntries, parseMemoryFile } = core;

// --- Import: card --------------------------------------------------------------------------
function readPngTexts(buf){
  const d = new DataView(buf), u8 = new Uint8Array(buf), out = {};
  const sig = [137,80,78,71,13,10,26,10];
  for (let i=0;i<8;i++) if (u8[i]!==sig[i]) throw new Error('不是 png 文件');
  let p = 8;
  // Chunks are decoded with TextDecoder, never String.fromCharCode(...bytes): spreading a big chunk
  // (a card with a large 世界书 or V3 assets, 100 KB and up) overflows the call stack.
  const latin1 = new TextDecoder('latin1');
  while (p + 8 <= u8.length){
    const len = d.getUint32(p), type = latin1.decode(u8.subarray(p+4,p+8));
    const body = u8.subarray(p+8, p+8+len);
    if (type === 'tEXt'){
      const z = body.indexOf(0);
      out[latin1.decode(body.subarray(0,z))] = latin1.decode(body.subarray(z+1)); // latin1, base64 payload
    }
    p += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}
function b64ToUtf8(b64){
  const bin = atob(b64.replace(/\s/g,''));
  return new TextDecoder('utf-8').decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
// the card's text chunks as some editors and re-savers write them too: tEXt, iTXt (UTF-8, maybe
// compressed) and zTXt (compressed), keyword in any case → [{ key (lower case), bytes }] in file order. A chunk that cannot be
// inflated (no DecompressionStream, or it is broken) is left out. A file cut short keeps what it has.
async function inflate(bytes){
  if (typeof DecompressionStream !== 'function') return null;
  try { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer()); } catch { return null; }
}
async function pngTextChunks(buf){
  const d = new DataView(buf), u8 = new Uint8Array(buf), out = [], latin1 = new TextDecoder('latin1');
  let p = 8;
  while (p + 8 <= u8.length){
    const len = d.getUint32(p), type = latin1.decode(u8.subarray(p+4,p+8)), body = u8.subarray(p+8, Math.min(u8.length, p+8+len));
    const z = body.indexOf(0), key = z > 0 ? latin1.decode(body.subarray(0, z)).toLowerCase() : '';
    if (key && type === 'tEXt') out.push({ key, bytes: body.subarray(z+1) });
    else if (key && type === 'zTXt'){ const b = await inflate(body.subarray(z+2)); if (b) out.push({ key, bytes: b }); }
    else if (key && type === 'iTXt'){
      const flag = body[z+1]; let q = z + 3;
      for (let i = 0; i < 2 && q <= body.length; i++){ const e = body.indexOf(0, q); q = e < 0 ? body.length + 1 : e + 1; }   // language, translated keyword
      if (q <= body.length){ const b = flag ? await inflate(body.subarray(q)) : body.subarray(q); if (b) out.push({ key, bytes: b }); }
    }
    p += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}
// a chunk's payload → the card JSON: base64 (as 酒馆 writes it), or the JSON itself; throws when neither reads
function chunkJson(bytes){
  const s = new TextDecoder('latin1').decode(bytes).trim();
  if (/^[A-Za-z0-9+/=\s]+$/.test(s)) return JSON.parse(b64ToUtf8(s));
  return JSON.parse(new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, ''));
}
// her text files as they come: UTF-8 (with or without BOM) or UTF-16 (Notepad's "Unicode", by its BOM)
async function readTextFile(f){
  const b = new Uint8Array(await f.arrayBuffer());
  const enc = b[0] === 0xFF && b[1] === 0xFE ? 'utf-16le' : b[0] === 0xFE && b[1] === 0xFF ? 'utf-16be' : 'utf-8';
  return new TextDecoder(enc).decode(b).replace(/^﻿/, '');
}
// what a file is by its first bytes, never by its name alone (WeChat and Drive rename files, some Android
// pickers drop the extension, 相册 gives a JPEG / HEIC) → 'empty' | 'png' | 'zip' | 'jpeg' | 'heic' | 'webp' | 'gif' | 'binary' | 'text'
async function sniff(f){
  if (!f.size) return 'empty';
  const b = new Uint8Array(await f.slice(0, 512).arrayBuffer()), at = (i, s) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (b[0] === 0x89 && at(1, 'PNG')) return 'png';
  if (at(0, 'PK') && b[2] === 3 && b[3] === 4) return 'zip';
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpeg';
  if (at(4, 'ftyp') && /^(heic|heix|hevc|mif1|msf1|heis)$/.test(String.fromCharCode(...b.subarray(8, 12)))) return 'heic';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'webp';
  if (at(0, 'GIF8')) return 'gif';
  const utf16 = (b[0] === 0xFF && b[1] === 0xFE) || (b[0] === 0xFE && b[1] === 0xFF);
  return !utf16 && b.includes(0) ? 'binary' : 'text';
}
// the name she sees, and its kind once a rename's ".txt" (WeChat, Drive) or a "(1)" is looked past:
// 'chat.jsonl.txt' → '.jsonl', 'card (1).json' → '.json', 'IMG_1' → ''
const baseName = n => String(n || '').split(/[\\/]/).pop();
function extOf(n){
  const b = baseName(n).toLowerCase().replace(/\s*\(\d+\)(?=\.|$)/g, '');
  const m = b.match(/\.(jsonl|json)\.txt$/) || b.match(/\.([a-z0-9]{1,8})$/);
  return m ? '.' + m[1] : '';
}
// a .json that is a card: spec / data, or the card's own fields (an instruct or context template, a persona or a settings
// file has a name too, never these): its name and one of them, or two of them
const CARD_FIELDS = ['description', 'first_mes', 'personality', 'scenario', 'mes_example'];
function looksLikeCard(j){
  if (!j || typeof j !== 'object' || Array.isArray(j)) return false;
  const d = j.data && typeof j.data === 'object' && !Array.isArray(j.data) ? j.data : j;
  if (d !== j && /chara_card/i.test(String(j.spec || '')) && typeof d.name === 'string') return true;
  const n = CARD_FIELDS.filter(k => typeof d[k] === 'string' && d[k].trim()).length;
  return n >= 2 || (n >= 1 && typeof d.name === 'string' && !!d.name.trim());
}
// a plain error for her: the page words it by `code` (import.why.<code>, with the file's name); the message is the same in plain Chinese
const failure = (code, file, msg) => Object.assign(new Error(msg), { code, file });
// Normalise V1 (flat), V2 ({spec, data}) and V3 ({spec:"chara_card_v3", data}) to the V2 "data" shape.
function normaliseCard(j){
  const data = (j && j.data && typeof j.data === 'object') ? j.data : j;
  const spec = (j && j.spec) ? `${j.spec} ${j.spec_version||''}`.trim() : 'v1 (flat fields)';
  const pick = (k, dflt='') => (data[k] !== undefined && data[k] !== null) ? data[k] : dflt;
  return {
    spec_seen: spec,
    name: pick('name'), description: pick('description'), personality: pick('personality'),
    scenario: pick('scenario'), first_mes: pick('first_mes'), mes_example: pick('mes_example'),
    creator_notes: pick('creator_notes'), system_prompt: pick('system_prompt'),
    post_history_instructions: pick('post_history_instructions'),
    alternate_greetings: pick('alternate_greetings', []), tags: pick('tags', []),
    creator: pick('creator'), character_version: pick('character_version'),
    character_book: pick('character_book', null), extensions: pick('extensions', {}),
  };
}
// file: a File (png or json). Returns { data, source, image } where image is the png Blob, if any.
// a PNG card's ccv3, else its chara (a broken ccv3 beside a good chara is not the end); errors carry a code:
// 'not-png', 'no-card' (no card data: often a picture from 相册, which strips it), 'broken-card' (cut short, not readable)
async function readCardFile(file){
  let j, source;
  const name = baseName(file.name);
  if ((await sniff(file)) !== 'png'){
    if (!/\.png$/i.test(file.name)){
      try { j = JSON.parse(await readTextFile(file)); } catch { throw failure('broken-card', name, `「${name}」里的角色数据坏了`); }
      return { data: normaliseCard(j), source: { chunk:'json', json:j }, image: null };
    }
    throw failure('not-png', name, `「${name}」不是 png 文件`);
  }
  // the last chunk of each key wins, as readPngTexts always did (an editor that appends a new card without dropping the old)
  const last = {}; for (const c of await pngTextChunks(await file.arrayBuffer())) if (c.key === 'ccv3' || c.key === 'chara') last[c.key] = c;
  const chunks = [last.ccv3, last.chara].filter(Boolean);
  if (!chunks.length) throw failure('no-card', name, `「${name}」这张图片里没有角色数据`);
  for (const c of chunks){ try { j = chunkJson(c.bytes); source = { chunk: c.key, json: j }; break; } catch {} }
  if (!source) throw failure('broken-card', name, `「${name}」里的角色数据坏了`);
  return { data: normaliseCard(j), source, image: file };
}

// --- Import: 酒馆 chat JSONL (line 1 = metadata, then one message per line) -------------------
// Every line that is a message is kept. A line that cannot be read, or is not a message, is
// skipped and counted (`skipped: { broken, notMessage }`), never silently: 搬家 says how many and why.
// A file where no line could be read at all is refused.
function parseChat(text){
  const lines = text.split(/\r\n|\r|\n/).filter(l => l.trim());   // an old Mac's CR-only file too
  const skipped = { broken:0, notMessage:0 };
  if (!lines.length) return { meta:{}, msgs:[], skipped };
  const rows = lines.map(l => { try { return JSON.parse(l); } catch { return undefined; } });
  const first = rows[0];
  const isMeta = !!(first && typeof first === 'object' && first.mes === undefined);
  const msgs = [];
  for (const r of isMeta ? rows.slice(1) : rows){
    if (r === undefined) skipped.broken++;
    else if (r && typeof r === 'object' && typeof r.mes === 'string') msgs.push(r);
    else skipped.notMessage++;
  }
  if (!msgs.length && skipped.broken && skipped.broken === rows.length) throw new Error('这个文件里没有能读的聊天记录');
  return { meta: isMeta ? first : {}, msgs, skipped };
}
async function readChatFile(file){ return parseChat(await readTextFile(file)); }

// Where an export came from, for the contact card. c.ai exports through cai-tools carry no source
// field; a 酒馆 export carries chat_metadata, or messages only 酒馆 writes (swipes, generation times,
// the api / model it used, its own written-out send_date). A card with no chat beside it is a 酒馆
// card: c.ai has no card file of its own. Otherwise (a chat with none of these) → c.ai.
function guessSource(meta, cardSource, msgs){
  if (meta && (meta.chat_metadata || meta.integrity)) return '酒馆';
  if (cardSource && cardSource.json && cardSource.json.data && cardSource.json.data.extensions && cardSource.json.data.extensions.chub) return '酒馆';
  const stOnly = m => Array.isArray(m.swipes) || m.gen_started || m.gen_finished || (m.extra && (m.extra.api || m.extra.model)) ||
    (typeof m.send_date === 'string' && m.send_date.trim() && isNaN(Number(m.send_date)));
  if ((msgs || []).some(stOnly)) return '酒馆';
  if (!(msgs && msgs.length) && cardSource) return '酒馆';
  return 'c.ai';
}

// --- Import: memories she already has --------------------------------------------------------
// No platform exports "memory", but 酒馆 users keep it in three plain-file forms, and all three are
// taken here:
//   1. Markdown / text notes (酒馆's Data Bank files, Ombre Brain, Obsidian; Modu's own memory/*.md
//      with front matter): one memory per list item or paragraph, or the file's front matter as is;
//   2. a lorebook (世界书) JSON {"entries": {uid: {content, comment, key}}}, which memory extensions
//      such as MemoryBooks write: one memory per entry;
//   3. the Summarize extension's rolling summary, if the chat file carries one: one summary.
// Imported memories keep their wording (hers or her old app's), marked source and voice "imported".
// A memory keeps its own date where the file gives one: a list item, paragraph or 世界书 entry that
// starts with a date (2026-03-14 · 2026/3/14 · 2026.3.14 · 2026年3月14日 · 3月14日, the last read as
// the latest such day not after today), or a Markdown heading that is a date, for the items under it.
// The date is taken off the front of the text. A date after today is no date. Undated → the import day.
const LEAD_DATE = /^\s*(?:(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?|(\d{1,2})\s*月\s*(\d{1,2})\s*[日号])(?:\s*[:：,，、—–\-]+\s*|\s+|$)/;
function leadDate(s){
  const m = String(s || '').match(LEAD_DATE); if (!m) return null;
  const pad = n => String(n).padStart(2, '0'), t = today();
  let y = Number(m[1]), mo = Number(m[2] || m[4]), d = Number(m[3] || m[5]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (!m[1]){ y = Number(t.slice(0, 4)); if (`${y}-${pad(mo)}-${pad(d)}` > t) y--; }
  const iso = `${y}-${pad(mo)}-${pad(d)}`, dt = new Date(y, mo - 1, d);
  if (dt.getMonth() !== mo - 1 || iso > t) return null;
  return { date: iso, rest: String(s).slice(m[0].length).trim() };
}
function memoryFromText(name, text){
  const day = today();
  if (/^---\r?\n/.test(text)){ const m = parseMemoryFile(name, text); return m.text ? [Object.assign(m, { date: m.date || day, source: m.source || 'imported: ' + name })] : []; }
  const lines = text.split(/\r?\n/), items = [];
  const item = (s, under) => { const ld = leadDate(s); const it = { kind:'fact', text: ld && ld.rest ? ld.rest : s, date: (ld && ld.rest && ld.date) || under || day, source: 'imported: ' + name, confidence:'high', voice:'imported' }; if ((ld && ld.rest) || under) it.dated = true; return it; };
  let under = '', bullets = 0;
  for (const l of lines){
    const h = l.match(/^\s*#+\s+(.*)$/); if (h){ const ld = leadDate(h[1]); under = ld ? ld.date : ''; continue; }
    const b = l.match(/^\s*(?:[-*•]|\d+[.、)])\s+(.+)$/); if (b){ items.push(item(b[1].trim(), under)); bullets++; }
  }
  if (bullets) return items;
  // no list: one memory per paragraph (a heading that is a date dates the paragraphs after it)
  under = '';
  for (const para of text.split(/\r?\n\s*\r?\n/)){
    const hs = para.match(/^\s*#+\s+(.*)$/gm); if (hs) for (const h of hs){ const ld = leadDate(h.replace(/^\s*#+\s+/, '')); under = ld ? ld.date : ''; }
    const s = para.replace(/^#+\s.*$/gm, '').trim(); if (s) items.push(item(s, under));
  }
  return items;
}
function memoryFromLorebook(name, j){
  const day = today();
  return Object.values(j.entries || {}).filter(e => e && typeof e.content === 'string' && e.content.trim() && !e.disable)
    .map(e => {
      const fromComment = leadDate(e.comment), fromText = leadDate(e.content.trim());
      const date = (fromText && fromText.rest && fromText.date) || (fromComment && fromComment.date) || '';
      const it = { kind:'fact', text: fromText && fromText.rest ? fromText.rest : e.content.trim(), date: date || day, source: `imported: ${name} (世界书${e.comment ? '：' + e.comment : ''})`, confidence:'high', voice:'imported' };
      if (date) it.dated = true; return it;
    });
}
// A 世界书 she drops in is either memories (what a memory extension such as MemoryBooks or the
// Summarize extension wrote, or her own notes about the two of them) or his world (places, people, rules
// of his story). World lore stays lore: it goes into the prompt as background (context block 'lore'),
// never as "she told you". In this order:
//   1. a memory book (its name, or most of its entries, speak of memory / summary / 记忆 / 回忆 / 总结 /
//      摘要 / 日记) → memories;
//   2. the card's own bundled 世界书, exported on its own (same name as the card's book or the card, or
//      most of its entries are in the card's book) → lore;
//   3. most entries speak of her (她 / 你 / 用户 / {{user}} / the user / she) → memories;
//   4. a card came with it → lore; 5. otherwise (her notes from an old app) → memories.
const MEMORY_BOOK = /memor|summar|recap|journal|diary|chat ?log|记忆|回忆|总结|摘要|日记|前情|剧情回顾/i;
const ABOUT_HER = /\{\{user\}\}|<user>|用户|她|\bshe\b|\bher\b|the user/i;
function bookKind(name, j, card){
  const es = Object.values((j && j.entries) || {}).filter(e => e && typeof e.content === 'string' && e.content.trim());
  const most = f => es.length && es.filter(f).length * 2 >= es.length;
  if (MEMORY_BOOK.test(String(name || '')) || MEMORY_BOOK.test(String(j && j.name || '')) ||
      most(e => MEMORY_BOOK.test(String(e.comment || '')) || MEMORY_BOOK.test([].concat(e.key || e.keys || []).join(' ')))) return 'memory';
  if (card){
    const own = card.character_book, ownTexts = new Set(loreEntries(own).map(e => e.content));
    const bn = String(j && j.name || String(name || '').replace(/\.json$/i, '')).trim();
    if ((bn && (bn === String(own && own.name || '').trim() || bn === String(card.name || '').trim())) || (ownTexts.size && most(e => ownTexts.has(e.content.trim())))) return 'lore';
  }
  if (most(e => ABOUT_HER.test(e.content))) return 'memory';
  return card ? 'lore' : 'memory';
}
function memoryFromChat(meta, msgs){
  const found = [];
  const cm = meta && meta.chat_metadata;
  if (cm) for (const [k, v] of Object.entries(cm)) if (/summary|memory/i.test(k) && typeof v === 'string' && v.trim()) found.push(v.trim());
  const last = [...msgs].reverse().find(m => m.extra && typeof m.extra.memory === 'string' && m.extra.memory.trim());
  if (last) found.push(last.extra.memory.trim());
  if (!found.length) return [];
  const dates = msgs.map(msgDate).filter(Boolean), iso = isoDay;
  const it = { kind:'summary', text: found[found.length - 1], date: dates.length ? iso(new Date(lowest(dates))) : today(),
            to: dates.length ? iso(new Date(highest(dates))) : '', source:'imported: 酒馆 summary', confidence:'high', voice:'imported' };
  if (dates.length) it.dated = true;
  return [it];
}

// --- Import: the official c.ai app's data export ----------------------------------------
// A password zip (unzipped by her first) holding <user>/data/character.json (the characters she made:
// [{created, updated, title, name, description, greeting, definition}]), data/user.json (her account:
// never read, kept or shown), data/message.json ([{chat_id, candidate_id, raw_content, create_time,
// tti_image_rel_path}], unsorted, many chats, NO author and NO link from a chat to a character) and
// images/avatars_uploaded_<date>_<id>.webp. So: the chats are grouped by chat_id and sorted by time, she
// picks the chat and who he is, and the speakers are guessed (alternation, greeting first, nudged by
// *actions* and 「」), which the receipt says, with a swap.
// what chooseCaiChat works from, by staged.caiApp.key (so a remote UI's JSON copy of Staged still works):
// { chats: {id: rows[]}, chars: [], pics: [File] }; the last few imports only
const caiRaw = new Map();
function keepCai(raw){ const key = 'cai-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); caiRaw.set(key, raw); while (caiRaw.size > 4) caiRaw.delete(caiRaw.keys().next().value); return key; }
// the c.ai app's message.json, also when a few rows lack a field: most rows have chat_id and raw_content → those rows
// (with their place in the file, _i), else null
function caiMessages(j){
  if (!Array.isArray(j) || !j.length) return null;
  const ok = [];
  j.forEach((r, i) => { if (r && typeof r === 'object' && 'chat_id' in r && 'raw_content' in r) ok.push(Object.assign({ _i: i }, r)); });
  return ok.length * 5 >= j.length * 4 ? ok : null;
}
// Math.min / Math.max over a long list without spreading it (a spread of 125k+ items throws)
const lowest = a => a.length ? a.reduce((x, y) => y < x ? y : x) : null, highest = a => a.length ? a.reduce((x, y) => y > x ? y : x) : null;
const isCaiCharacters = j => Array.isArray(j) && j.length > 0 && j.every(r => r && typeof r === 'object' && typeof r.name === 'string' && ('greeting' in r || 'definition' in r || 'title' in r));
const isAccount = (name, j) => /(^|[\\/])user\.json$/i.test(name) || !!(j && !Array.isArray(j) && typeof j === 'object' && ('email' in j || 'date_joined' in j) && !j.data && !j.entries);
const PICTURE = /\.(webp|jpe?g|gif|avif)$/i;
// a zip: Modu cannot open one; an encrypted one (general purpose flag bit 0) needs her to unzip it first
async function zipLocked(f){ try { const b = new Uint8Array(await f.slice(0, 8).arrayBuffer()); return b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4 && !!(b[6] & 1); } catch { return false; } }
const oneLine = t => String(t || '').replace(/\s+/g, ' ').trim();
// how much a message looks like his: an *action* or 「dialogue」 / “quotes” is the character's habit in c.ai
// (0 none, 1 one of the two, 2 both: an action and quoted speech, which users seldom write)
function caiCue(t){ const s = String(t || ''); return (/\*[^*\n]{1,400}\*/.test(s) ? 1 : 0) + (/「[^」]*」|『[^』]*』|“[^”]*”/.test(s) ? 1 : 0); }
// Speakers by alternation, his first, refined by the cue (a small Viterbi: breaking the turn order costs
// more than one message that does not look its part, so cues mostly pick the phase and fix a regenerate).
// Returns is_user per message. `hisFirst` true forces message 0 to be his (it is his card's greeting).
function caiSpeakers(rows, hisFirst){
  const n = rows.length; if (!n) return [];
  const SAME = 2.5, cost = (cue, user) => user ? cue * 1.2 : (cue ? 0 : 0.4);
  const c0 = caiCue(rows[0].raw_content);
  const best = [[cost(c0, false), hisFirst ? Infinity : 0.3 + cost(c0, true)]], from = [[0, 0]];
  for (let i = 1; i < n; i++){
    const cue = caiCue(rows[i].raw_content), b = [], f = [];
    for (const u of [0, 1]){
      const stay = best[i-1][u] + SAME, sw = best[i-1][1-u];
      f[u] = stay < sw ? u : 1 - u; b[u] = Math.min(stay, sw) + cost(cue, !!u);
    }
    best.push(b); from.push(f);
  }
  const out = new Array(n); let u = best[n-1][1] < best[n-1][0] ? 1 : 0;
  for (let i = n - 1; i >= 0; i--){ out[i] = !!u; u = from[i][u]; }
  return out;
}
function caiCard(c){
  const card = normaliseCard({ name: c.name, description: c.description || '', first_mes: c.greeting || '', system_prompt: c.definition || '', creator_notes: c.title || '' });
  card.spec_seen = 'c.ai app export (character.json)';
  return card;
}
// The overview she chooses from: JSON only (no files), on staged.caiApp.
function caiOverview(raw){
  const chats = Object.entries(raw.chats).map(([id, rows]) => {
    const ts = rows.map(r => timeOf(r.create_time)).filter(Boolean);
    const first = rows[0] ? oneLine(rows[0].raw_content) : '';
    const ch = raw.chars.findIndex(c => c.greeting && oneLine(c.greeting) === first);
    return { id, n: rows.length, first: ts.length ? lowest(ts) : null, last: ts.length ? highest(ts) : null,
             firstLine: first.slice(0, 60), character: ch >= 0 ? ch : null };
  }).sort((a, b) => (b.last || 0) - (a.last || 0));
  return { chats, characters: raw.chars.map(c => ({ name: c.name, title: c.title || '' })), pictures: raw.pics.map(p => p.name) };
}
// Apply her choice to a staged c.ai app import: a new Staged with his card, picture and their chat.
// choice = { chat?: id, character?: index | null, name?: string, picture?: index, swap?: boolean }; what is
// left out keeps the staged choice (at first: the only chat, and the character whose greeting opens it).
async function chooseCaiChat(st, choice = {}){
  const raw = st && st.caiApp && caiRaw.get(st.caiApp.key); if (!raw) return st;
  const c = Object.assign({}, st.caiApp.choice, choice);
  const view = caiOverview(raw);
  if (c.chat == null && view.chats.length === 1) c.chat = view.chats[0].id;
  const chat = view.chats.find(x => String(x.id) === String(c.chat)) || null;
  // who he is: what she picked or typed wins; otherwise the character whose greeting opens the chat
  // (c.linked: the character was set that way, so another chat takes its own, or none)
  const said = (choice.name !== undefined && String(choice.name).trim()) || choice.character != null;
  if (choice.name !== undefined && String(choice.name).trim()){ c.character = null; c.linked = false; }
  else if (choice.character != null){ c.name = ''; c.linked = false; }
  else if (choice.name !== undefined && !String(choice.name).trim() && c.character == null) c.linked = false;
  if (chat && !said && (choice.chat != null || (c.character == null && !String(c.name || '').trim()))){
    if (chat.character != null && (c.linked || (c.character == null && !String(c.name || '').trim()))){ c.character = chat.character; c.name = ''; c.linked = true; }
    else if (chat.character == null && c.linked){ c.character = null; c.linked = false; }
  }
  const ch = c.character != null ? raw.chars[c.character] || null : null;
  const name = ch ? ch.name : String(c.name || '').trim();
  if (c.picture == null && raw.pics.length) c.picture = 0;
  const out = Object.assign({}, st, { caiApp: Object.assign({}, view, { key: st.caiApp.key, user: st.caiApp.user, choice: c, needs: [] }) });
  out.card = ch ? caiCard(ch) : name ? Object.assign(normaliseCard({ name }), { spec_seen: 'c.ai app export (a name she typed)' }) : null;
  out.cardSource = ch ? { chunk:'c.ai app', json: ch } : null;
  out.image = raw.pics[c.picture] || null;
  out.name = name; out.source = 'c.ai';
  const rows = chat ? raw.chats[chat.id] : [];
  const users = caiSpeakers(rows, !!(ch && ch.greeting && rows[0] && oneLine(ch.greeting) === oneLine(rows[0].raw_content)));
  out.msgs = rows.map((r, i) => {
    const isUser = c.swap ? !users[i] : users[i], t = timeOf(r.create_time);
    return { name: isUser ? 'You' : (name || 'TA'), is_user: isUser, is_name: true, send_date: t || '', mes: String(r.raw_content || ''), extra: { modu_speaker: 'guessed' } };
  });
  out.meta = { user_name: 'You', character_name: name, create_date: (chat && chat.first) || '' };
  if (!chat) out.caiApp.needs.push('chat');
  if (!name) out.caiApp.needs.push('name');
  finishCard(out);
  const future = markUntimely(out.msgs, out.importedAt);
  const times = out.msgs.map(msgDate).filter(Boolean).map(d => d.getTime());
  out.report = Object.assign({}, st.report, {
    card: !!out.card, picture: !!out.image,
    chat: chat ? { file: 'message.json', msgs: out.msgs.length, skipped: { broken:0, notMessage:0 }, undated: out.msgs.filter(m => !msgDate(m)).length - future, future,
                   first: times.length ? lowest(times) : null, last: times.length ? highest(times) : null } : null,
    cardLore: out.card ? loreEntries(out.card.character_book).length : 0,
    caiApp: { chats: view.chats.length, guessed: out.msgs.length > 0, swapped: !!c.swap, user: !!st.caiApp.user },
  });
  return out;
}
// the UI's default pronoun, as stageImport does it. Nothing in Modu edits a card (card.json stays byte-identical): a 世界书
// that came with his card is not merged into the card. It is kept beside the card as the file it came as (a card folder's
// lore: every such book is staged into out.folder), and read from there (core.folderData.lore). A book with no card beside
// it is her memories. Older folders may hold a card.json with the book merged into card.extensions.modu.lore: it is kept as
// it is (taking it out would write the card again); a book of the same name is read once (cardLore).
function finishCard(out){
  // nothing in Modu edits a card: his pronoun is never written into the card. A UI that asks
  // (writePronouns) gets a note to keep beside the card: what the card says or clearly uses (from: 'card'), else its
  // default with the question asked once in 搬家 (from: 'default', ask: true; answerPronoun gives her answer).
  out.pronoun = null;
  // the card folder says it already: her own pronouns.json (kept as she wrote it, no question) or her params'
  // character.pronouns (read from params as ever, so no note is written: note false)
  const fp = out.folder && out.folder.pronoun, pp = out.params && out.params.character && String(out.params.character.pronouns || '').trim();
  if (out.card && fp) out.pronoun = { pronouns: fp, from: 'folder', ask: false };
  else if (out.card && /^(he\/him|she\/her|they\/them)$/.test(pp || '')) out.pronoun = { pronouns: pp, from: 'params', ask: false, note: false };
  else if (out.card && core.defaults.writePronouns && !(out.card.extensions && out.card.extensions.modu && out.card.extensions.modu.pronouns)){
    const g = core.guessPronoun(out.card);
    out.pronoun = g ? { pronouns: g, from: 'card', ask: false } : core.defaults.pronouns ? { pronouns: core.defaults.pronouns, from: 'default', ask: true } : null;
  }
}
// her answer to the pronoun question in 搬家: 'he/him' | 'she/her' | 'they/them' → the staged import, changed
function answerPronoun(st, p){
  if (!st || !/^(he\/him|she\/her|they\/them)$/.test(String(p))) return st;
  return Object.assign({}, st, { pronoun: { pronouns: String(p), from: 'her', ask: false } });
}

// A staged import: what the dropped files said, before anything is saved.
// Returns { card, cardSource, image, meta, msgs, memory, name, source, report, importedAt }.
// `report` is what 搬家 shows back to her: what came in, what was skipped and why.
// Files above this size are refused with a plain message instead of hanging the tab.
const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
// the c.ai app's message.json holds every chat she ever had in one file, read once and grouped: a larger cap
// (150 MB on a computer; on a phone, or a device with 4 GB or less, it stays 50 MB: parsing it whole takes several times its size)
const MAX_CAI_BYTES = 150 * 1024 * 1024;
function caiCap(){
  const n = globalThis.navigator;
  return n && (/Android|iPhone|iPad|iPod|Mobile/i.test(String(n.userAgent || '')) || (n.deviceMemory && n.deviceMemory <= 4)) ? MAX_IMPORT_BYTES : MAX_CAI_BYTES;
}
// what each refusal says (the page words it from words.txt by code, import.why.<code>; this is the same in plain Chinese)
const WHY = { big: '太大了，无法导入', empty: '是空的', zip: '是压缩包，请先解压', 'zip-locked': '是加密的压缩包，请先解压', backup: '是小手机的备份，请在 设置 → 导入备份 里打开',
  photo: '是照片，里面没有角色卡', 'no-card': '这张图片里没有角色数据', 'not-png': '不是 png 文件', 'broken-card': '里的角色数据坏了', 'broken-json': '坏了，读不出来',
  'no-chat': '里没有能读的聊天记录', unknown: '不是能导入的文件', mixed: '是酒馆的角色卡：c.ai 的导出和酒馆的角色卡要分开搬，一次搬一种' };
// a zip: a password one, a Modu backup (导出备份's own: a manifest.json beside card.json / chat.jsonl, for 导入备份), or any other
async function zipKind(f){
  if (await zipLocked(f)) return 'zip-locked';
  try {
    const tail = new Uint8Array(await f.slice(Math.max(0, f.size - 65558)).arrayBuffer()), dv = new DataView(tail.buffer);
    let e = -1; for (let i = tail.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50){ e = i; break; }
    if (e >= 0){
      const size = dv.getUint32(e + 12, true), off = dv.getUint32(e + 16, true), names = [];
      const cd = new Uint8Array(await f.slice(off, off + size).arrayBuffer()), cv = new DataView(cd.buffer), dec = new TextDecoder();
      for (let p = 0; p + 46 <= cd.length && cv.getUint32(p, true) === 0x02014b50; ){
        const n = cv.getUint16(p + 28, true), x = cv.getUint16(p + 30, true), c = cv.getUint16(p + 32, true);
        names.push(dec.decode(cd.subarray(p + 46, p + 46 + n)).replace(/\\/g, '/')); p += 46 + n + x + c;
      }
      if (names.some(n => /(^|\/)manifest\.json$/i.test(n)) && names.some(n => /(^|\/)(card\.json|chat\.jsonl)$/i.test(n))) return 'backup';
    }
  } catch {}
  return 'zip';
}
// a text that is a chat however it is named: two or more lines, most of them JSON objects, some of them messages
function jsonLines(text){
  const ls = text.split(/\r\n|\r|\n/).filter(l => l.trim()); if (ls.length < 2) return false;
  let obj = 0, mes = 0;
  for (const l of ls.slice(0, 200)){ try { const r = JSON.parse(l); if (r && typeof r === 'object'){ obj++; if (typeof r.mes === 'string') mes++; } } catch {} }
  return mes > 0 && obj * 2 >= Math.min(ls.length, 200);
}
// two names that are clearly not one companion: neither holds the other once case, spaces and marks are gone
const bareName = n => String(n || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
function otherName(a, b){ const x = bareName(a), y = bareName(b); return !!(x && y && !x.includes(y) && !y.includes(x)); }
const chatShaped = j => !!(j && typeof j === 'object' && !Array.isArray(j) && (typeof j.mes === 'string' || j.chat_metadata || (j.user_name !== undefined && j.character_name !== undefined)));
// opts.pick = { card?: file, chat?: file }: her choice among two cards or chats in the pick (the picker stays,
// she can switch back); without it the png card and the longest chat are taken
async function stageImport(files, opts = {}){
  const want = (opts && opts.pick) || {};
  const out = { card:null, cardSource:null, image:null, meta:{}, msgs:[], memory:[], lore:[], name:'', source:'' };
  const books = [];   // 世界书 files, sorted into memories or lore once we know whether a card came too
  const folder = [];  // the other files of a card folder
  // every file is read on its own; one that cannot be used is named with why (report.failed) and the others go on.
  // Two cards or two chats are both kept for her to choose (report.pick).
  const cards = [], chats = [], failed = [];
  const cai = { chats: null, chars: [], pics: [], user: false };
  let plainPng = null;   // a picture with no card in it (refused when nothing else came)
  const unknown = [];    // a .json that is none of the kinds above and not a card: named in 搬家, never read as a chat
  for (const f of files){
    const name = baseName(f.name), ext = extOf(f.name), kept = name.replace(/\.(jsonl?)\.txt$/i, '.$1');
    try {
      const cap = /^message(\s*\(\d+\))?\.json$/i.test(name) ? caiCap() : MAX_IMPORT_BYTES;
      if (f.size > cap) { failed.push({ file: name, why: 'big', max: Math.round(cap / 1048576) }); continue; }
      // her c.ai account file is never read, kept or shown
      if (isAccount(f.name)) { cai.user = true; continue; }
      const kind = await sniff(f);
      if (kind === 'empty') { failed.push({ file: name, why: 'empty' }); continue; }
      if (kind === 'zip') { failed.push({ file: name, why: await zipKind(f) }); continue; }
      if (kind === 'heic') { failed.push({ file: name, why: 'photo' }); continue; }
      if (kind === 'jpeg' || kind === 'webp' || kind === 'gif') { cai.pics.push(f); continue; }
      if (kind === 'png'){
        try { const c = await readCardFile(f); if (c.data && (c.data.name || c.data.description)) { cards.push(Object.assign({ file: name, png: true }, c)); continue; } }
        catch(e){ if (e.code !== 'no-card') throw e; }
        // a .png with no card in it, beside other files (a c.ai export's picture), is a picture; on its own it is refused
        cai.pics.push(f); plainPng = plainPng || f; continue;
      }
      if (kind === 'binary' || ext === '.png' || PICTURE.test(name)) { failed.push({ file: name, why: ext === '.png' ? 'not-png' : 'unknown' }); continue; }
      const text = await readTextFile(f);
      if (!text.trim()) { failed.push({ file: name, why: 'empty' }); continue; }
      let j = null;
      if (ext !== '.jsonl'){ try { j = JSON.parse(text); } catch {} if (!j || typeof j !== 'object') j = null; }
      if (!j || (ext !== '.json' && chatShaped(j))){
        if (ext === '.jsonl' || jsonLines(text) || j){
          const c = parseChat(text);
          if (!c.msgs.length) { failed.push({ file: name, why: c.skipped.broken || c.skipped.notMessage ? 'no-chat' : 'empty' }); continue; }
          chats.push(Object.assign({ file: name }, c)); continue;
        }
        if (ext === '.json') { failed.push({ file: name, why: /"(first_mes|spec|char_name|description)"\s*:/.test(text) ? 'broken-card' : 'broken-json' }); continue; }
        if (!ext || /^\.(md|markdown|txt)$/.test(ext)){ const m = memoryFromText(name, text); if (m.length) out.memory.push(...m); else failed.push({ file: name, why: 'empty' }); continue; }
        unknown.push(name); continue;
      }
      // a whole JSON: a card, a 世界书, a card folder's file, the c.ai app's files (never a chat)
      if (isAccount(f.name, j)) { cai.user = true; continue; }
      const rows = caiMessages(j);
      if (rows) { cai.chats = cai.chats || {}; for (const r of rows){ const k = String(r.chat_id); (cai.chats[k] = cai.chats[k] || []).push(r); } continue; }
      if (isCaiCharacters(j)) { cai.chars.push(...j); continue; }
      if (j.entries && typeof j.entries === 'object' && !j.data) { books.push([kept, j, text]); continue; }
      // a card folder's own files beside the card (preset, regex, params, contacts), kept as they came
      const fk = core.folderKind(kept, j);
      if (fk) { folder.push({ name: kept, kind: fk, json: j, text }); continue; }
      // 酒馆's export of ONE regex script is that script's object: kept byte for byte as it came, and read
      // as one script (cards.js scriptsOf)
      if (!Array.isArray(j) && typeof j.findRegex === 'string') { folder.push({ name: kept, kind: 'regex', json: [j], text }); continue; }
      if (looksLikeCard(j)) { cards.push({ file: name, png: false, data: normaliseCard(j), source: { chunk:'json', json:j }, image: null }); continue; }
      unknown.push(name);
    } catch(e){ failed.push({ file: name, why: WHY[e.code] ? e.code : ext === '.json' ? 'broken-json' : ext === '.jsonl' ? 'no-chat' : 'unknown' }); }
  }
  // one card: the same card twice (its png and its json: same name and description) is one; two different ones, even of the
  // same name, → she chooses (the png ones first)
  const cardList = [], same = (a, b) => String(a.name) === String(b.name) && String(a.description) === String(b.description);
  for (const c of cards.filter(c => c.png).concat(cards.filter(c => !c.png))) if (!cardList.some(x => same(x.data, c.data))) cardList.push(c);
  const wantCard = cardList.find(c => want.card && c.file === want.card);
  if (cardList.length){ const c = wantCard || cardList[0]; out.card = c.data; out.cardSource = c.source; out.image = c.image; }
  // one chat: the longest; she chooses when there were more
  const byLength = chats.slice().sort((a, b) => b.msgs.length - a.msgs.length);
  const chat = byLength.find(c => want.chat && c.file === want.chat) || byLength[0] || null;
  if (chat){ out.meta = chat.meta; out.msgs = chat.msgs; }
  const skipped = chat ? chat.skipped || { broken:0, notMessage:0 } : { broken:0, notMessage:0 }, chatFile = chat ? chat.file : '';
  // nothing in this pick can be used: refused as one, with why (the first file's reason, all of them on e.failed)
  const got = out.card || chat || cai.chats || cai.chars.length || out.memory.length || books.length || folder.length || unknown.length;
  // a picture with no card in it that came before (or with) the broken file is named too (e.pictures), so the
  // page keeps it for the card or chat that comes next
  if (!got && failed.length){ const w = failed[0]; throw Object.assign(failure(w.why, w.file, `「${w.file}」${WHY[w.why]}`), { failed, pictures: cai.pics.map(f => baseName(f.name)) }); }
  // a png with no card in it, alone, is refused (no-card); a photo alone (jpg, webp, gif) is staged as his picture:
  // a card or chat may come in the next pick (report.photo says it has no card in it)
  if (!got && plainPng) { const p = baseName(plainPng.name); throw failure('no-card', p, `「${p}」${WHY['no-card']}`); }
  // a time after this moment cannot be true: the message stays as exported and is shown undated
  out.importedAt = now().getTime();
  const future = markUntimely(out.msgs, out.importedAt);
  // no card and no chat in this pick, but files a card folder brings, while a companion is open: they are for
  // beside HIS card (out.addOn, saved by addBesideCard), and a 世界书 that comes with them is read against his card (a
  // 世界书 picked on its own is her memories)
  // a 世界书 picked on its own while a saved companion is open (his folder, where addBesideCard can put it) is
  // read against his card the same way: his lore goes beside his card (a book about her stays her memories)
  const open = !out.card && !out.msgs.length && !cai.chats && !cai.chars.length && (folder.length || (books.length && core.store.writable)) && core.store.card ? core.store.card : null;
  const loreBooks = [];
  // a card folder (a card with its params, preset, regex, contacts or pronoun file beside it): every 世界书 in it is
  // the card's 世界书, whatever its name or how often it speaks of her; never her memories
  const inFolder = !!(out.card && folder.length);
  for (const [n, j, raw] of books){
    if (!inFolder && bookKind(n, j, out.card || open) === 'memory') out.memory.push(...memoryFromLorebook(n, j));
    else if (open) folder.push({ name: n, kind: 'lore', json: j, text: raw });
    else { const b = Object.assign({ name: j.name || n.replace(/\.json$/i, '') }, j); out.lore.push(b); loreBooks.push({ name: b.name, file: n, entries: loreEntries(b).length });
      if (out.card) folder.push({ name: n, kind: 'lore', json: j, text: raw }); }
  }
  // a card folder: its files are kept beside the card, byte for byte; a hand params.json is used as is
  if (out.card && folder.length){ const fo = core.stageFolder(folder); out.folder = fo; if (fo.params) out.params = fo.params; }
  else if (open && folder.length && core.stageFolder) out.addOn = core.stageFolder(folder);
  out.memory.push(...memoryFromChat(out.meta, out.msgs));
  // a picture on its own (a .webp, .jpg) is his picture when no card brought one
  if (!out.image && cai.pics.length && !cai.chats && !cai.chars.length) out.image = cai.pics[0];
  // a chat with no first line about itself is named by his messages, never "companion"
  const his = out.msgs.find(m => !m.is_user && typeof m.name === 'string' && m.name.trim() && m.name !== out.meta.user_name);
  out.name = (out.card && out.card.name) || out.meta.character_name || (his ? his.name.trim() : '');
  out.source = guessSource(out.meta, out.cardSource, out.msgs);
  // a chat that names someone else than the card (周野's chat, 温叙's card): said, so 搬家 can ask before they
  // move in together. A chat that names nobody cannot be told apart.
  const chatName = String(out.meta.character_name || (his ? his.name : '') || '').trim();
  const mismatch = out.card && chat && otherName(out.card.name, chatName) ? { card: String(out.card.name), chat: chatName, file: chatFile } : null;
  // world lore that came with his card is kept beside the card, as the file it came as (out.folder), never in it.
  // Nothing writes a pronoun into the card. A UI that asks for it (Modu, MODU_DEFAULTS) gets a note
  // to keep beside the card (out.pronoun): the card's own, or the one its text clearly uses, else the default and
  // the question asked once. She can change it in 设置 → 人称.
  finishCard(out);
  const times = out.msgs.map(msgDate).filter(Boolean).map(d => d.getTime());
  const dp = out.card && out.card.extensions && out.card.extensions.depth_prompt;
  out.report = {
    card: !!out.card, picture: !!out.image,
    chat: chatFile ? { file: chatFile, msgs: out.msgs.length, skipped, undated: out.msgs.filter(m => !msgDate(m)).length - future, future,
                       first: lowest(times), last: highest(times) } : null,
    lore: loreBooks,
    cardLore: out.card ? loreEntries(out.card.character_book).length : 0,
    memory: { n: out.memory.length, dated: out.memory.filter(m => m.dated).length },
    // what is kept but never run here, the card folder's files, the pronoun question
    unused: out.card ? core.unusedParts(out.card, out.folder && out.folder.data) : null,
    folder: out.folder ? Object.keys(out.folder.files) : [],
    // each file of the card folder and what it became ([{ file, kind, n }], counts only); files not used at all
    folderParts: out.folder ? out.folder.summary : [],
    addOn: out.addOn ? out.addOn.summary : null,
    unknown,
    loose: out.card || out.addOn ? 0 : folder.length,   // card-folder files with no card and nobody open to put them beside
    pronoun: out.pronoun ? { ask: out.pronoun.ask, pronouns: out.pronoun.pronouns } : null,
    // hidden states declared inside the card (extensions.modu.state) that cannot be used (counted, never named)
    stateBad: out.card ? core.stateProblems(out.card, null) : 0,
    // files that could not be used and why ([{ file, why }], why = a key of WHY); two cards or two chats she chooses
    // from (pick: null, or { cards: [{ file, name }], chats: [{ file, msgs }] }, the one taken first); a picture with no
    // card in it and no card beside it (相册 strips the card: she is told to pick the file from 文件); the card's
    // Character's Note (extensions.depth_prompt), kept in the card and not used here
    failed,
    // the list keeps its order (png cards first, the longest chat first) whatever she chooses; `taken` is the file used
    pick: cardList.length > 1 || chats.length > 1 ? {
      cards: cardList.length > 1 ? cardList.map(c => ({ file: c.file, name: String(c.data.name || '') })) : [],
      chats: chats.length > 1 ? byLength.map(c => ({ file: c.file, msgs: c.msgs.length })) : [],
      taken: cardList.length > 1 ? (wantCard || cardList[0]).file : chat.file } : null,
    mismatch,
    photo: !out.card && !cai.chars.length && cai.pics.length > 0,
    depthPrompt: !!(dp && typeof dp === 'object' && String(dp.prompt || '').trim()),
  };
  // the c.ai app's export: she chooses the chat and who he is (chooseCaiChat); the first guess now
  if (cai.chats || cai.chars.length){
    // a 酒馆 card beside the c.ai export is not used: said, never dropped without a word
    for (const c of cards) if (!failed.some(x => x.file === c.file)) failed.push({ file: c.file, why: 'mixed' });
    const chats = cai.chats || {};
    for (const k of Object.keys(chats)) chats[k].sort((a, b) => ((timeOf(a.create_time) || 0) - (timeOf(b.create_time) || 0)) || (a._i - b._i));
    out.caiApp = { key: keepCai({ chats, chars: cai.chars, pics: cai.pics }), user: cai.user, choice: {} };
    return chooseCaiChat(out, {});
  }
  return out;
}

Object.assign(core, { readPngTexts, normaliseCard, readCardFile, parseChat, chooseCaiChat, stageImport, answerPronoun });
})(globalThis[Symbol.for('modu.core')]);
// app/core/store.js: the store: the companion currently loaded, his folder (read, written back), the bundled samples.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, store, hostFetch, markUntimely, now, writeFile, readText, readBlob, VDir, readMemory, slug, memoryBody, MEMORY_FORMAT,
  parseChat, stageImport, storageError, kvGet } = core;

// The store folder's files.
function buildStoreFiles(st){
  const name = st.name || 'companion';
  const files = {};
  if (st.card) files['card.json'] = JSON.stringify({ store:'modu-xiaoshouji-card/0.1', data: st.card, source: st.cardSource }, null, 2);
  if (st.msgs.length){
    const meta = Object.assign({ user_name:'You', character_name:name, create_date: Date.now() }, st.meta || {});
    files['chat.jsonl'] = [JSON.stringify(meta), ...st.msgs.map(x => JSON.stringify(x))].join('\n') + '\n';
  }
  files['memory/README.md'] = `# memory/\n\n${name} 的记忆放这里，一条一个 Markdown 文件，开头一小段 front matter。\n导入时带来的记忆（md / txt、世界书、酒馆的总结）也放在这里；其余的从 chat.jsonl 里整理出来。\n`;
  (st.memory || []).forEach((it, i) => { files[`memory/${it.date}-${it.kind}-${slug(it.text)}-${i}.md`] = memoryBody(it); });
  // a card folder's own files, beside the card as they came; his pronoun as a note, never in the card
  const folder = st.folder && st.folder.files ? st.folder.files : {};
  for (const [n, text] of Object.entries(folder)) if (!files[n]) files[n] = text;
  // her own pronouns.json from the folder stays hers, byte for byte; a pronoun her params give needs no note
  if (st.pronoun && st.pronoun.pronouns && st.pronoun.note !== false && !(st.pronoun.from === 'folder' && folder[PRONOUNS_NOTE])) files[PRONOUNS_NOTE] = JSON.stringify({ v: 1, pronouns: st.pronoun.pronouns, writer: 'import', rev: 1, at: st.importedAt || now().getTime() }, null, 2);
  files['manifest.json'] = JSON.stringify({
    store: STORE_FORMAT, name, imported_from: st.source === '酒馆' ? 'SillyTavern files' : st.caiApp ? 'c.ai export (c.ai app)' : 'c.ai export (cai tools)',
    imported_at: new Date(st.importedAt || now().getTime()).toISOString(), imported_msgs: st.msgs.length, files: Object.keys(files).concat(st.image ? ['card.png'] : []), records: {}, memory_format: MEMORY_FORMAT,
    card_folder: st.folder && st.folder.list && Object.keys(st.folder.list).length ? st.folder.list : undefined,
    seeded: st.seeded ? true : undefined,   // the default companion a fresh install put here (firstRun), not one she brought
    note: 'Modu 小手机'
  }, null, 2);
  return files;
}
// Save a staged import into a folder named after him inside `root`, then load it. A second
// companion with the same name gets "name-2" so nobody is overwritten.
// The folder's name is safe on every system (a real folder on Windows / macOS, and the in-browser one,
// where a "/" made a folder inside a folder); store.name stays the card's own name.
function folderName(s){
  let n = String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, '_').replace(/^[\s.]+|[\s.]+$/g, '');
  n = Array.from(n).slice(0, 60).join('').replace(/[\s.]+$/, '') || 'TA';
  return /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(n) ? '_' + n : n;
}
// A save is never half there. A folder being saved holds SAVING ({ v, writer, state, at });
// in the in-browser folder every file goes in ONE write (VDir.writeFolder), state 'saved', so a closed tab leaves all
// of him or nothing; in a real folder (and a host's storage that cannot write many at once) it says 'saving' first,
// then every file, then 'saved'. loadFromDir takes the note away once he is in her contacts. At boot, loadContacts
// gives back a 'saved' folder that never reached her contacts and clears a 'saving' one (recoverSaves, contacts.js);
// in a real folder the next save of that name clears it (freeName), and 打开已有的文件夹 says it was not finished.
const SAVING = '.modu-saving.json';
async function savingNote(dir){
  const t = await readText(dir, SAVING); if (t === null) return null;
  try { const j = JSON.parse(t); if (j && typeof j === 'object') return j; } catch {}
  return { state:'saving' };   // cut short while it was written: not finished
}
async function writeFolder(root, name, files){
  const note = state => JSON.stringify({ v: 1, writer: 'modu', state, at: now().getTime() });
  let one = null;
  // a one-transaction save the browser aborts for any reason but a full phone (WebKit and a very big companion)
  // goes again file by file, between the save notes: slower, still put right after a closed tab
  try { one = root.writeFolder ? await root.writeFolder(name, Object.assign({ [SAVING]: note('saved') }, files)) : null; }
  catch(e){ if (storageError(e).code === 'storage-full') throw e; console.error('one write refused, file by file:', e); await dropFolder(root, name); }
  if (one) return one;
  const dir = await root.getDirectoryHandle(name, { create:true });
  await writeFile(dir, SAVING, note('saving'));
  for (const [p, c] of Object.entries(files)) await writeFile(dir, p, c);
  await writeFile(dir, SAVING, note('saved'));
  return dir;
}
async function dropFolder(root, name){ try { await root.removeEntry(name, { recursive:true }); } catch {} }
// one save at a time across her tabs (a closed tab lets go by itself); recoverSaves only looks when nobody is saving
function saveLock(fn, o = {}){
  const L = typeof navigator !== 'undefined' && navigator.locks;
  if (!L || !L.request) return fn(true);
  return L.request('modu-save', o.ifAvailable ? { ifAvailable: true } : {}, lock => fn(!!lock));
}
// An existing folder is never taken over (it may be hers); an empty one is used, and one an unfinished save of ours
// left is cleared and used
async function freeName(root, name){
  for (let i = 1; ; i++){
    const n = i === 1 ? name : `${name}-${i}`;
    let d; try { d = await root.getDirectoryHandle(n); } catch { return n; }
    const note = await savingNote(d);
    if (note && note.state !== 'saved'){ await dropFolder(root, n); return n; }
    let empty = true; try { for await (const x of d.entries()){ void x; empty = false; break; } } catch { empty = false; }
    if (empty) return n;
  }
}
// opts.remove = [{ id, ifUnused }]: companions that go once he is safely in (替换's old one; the default
// char she never wrote to, ifUnused). Kept in her kv ('removeAfter') BEFORE the save, done after it, and finished at the next
// start (finishRemovals) when a reload cut in between; nothing is removed unless the new companion is in, whole.
async function saveImport(st, root, opts = {}){
  const remove = ((opts && opts.remove) || []).filter(x => x && x.id).map(x => ({ id: String(x.id), ifUnused: !!x.ifUnused }));
  if (!remove.length) return saveInto(st, root, false);
  await core.planRemoval(st.name || 'companion', remove);
  let dir;
  try { dir = await saveInto(st, root, false); }
  catch(e){ await core.planRemoval(null); throw e; }
  await core.finishRemovals();
  return dir;
}
// core-only (firstRun, which already holds the save lock); never on ModuCore, so a host cannot skip the lock
function saveImportLocked(st, root){ return saveInto(st, root, true); }
async function saveInto(st, root, locked){
  const files = buildStoreFiles(st);
  if (st.image) files['card.png'] = await st.image.arrayBuffer();
  // she may open someone else while a big save runs; then he is only added to her contacts and she
  // stays where she is (he opens from 聊天). The companion open at the start is the one that may be switched away from.
  const was = core.currentId, wasName = store.name;
  let stayed = true;
  const dir = await (locked ? f => f(true) : saveLock)(async () => {
    const name = await freeName(root, folderName(st.name));
    let dir;
    try { dir = await writeFolder(root, name, files); }
    catch(e){ await dropFolder(root, name); throw storageError(e); }
    stayed = !was || !wasName || (core.currentId === was && store.name === wasName);   // nobody was open: he opens
    // what we just wrote cannot be read back (another tab's start removed it, on a phone with no Web Locks):
    // the save was cut off, said as that (never "no companion in this folder"), and what is left of it goes
    try { if (stayed) await loadFromDir(dir); else await listOnly(dir, st); }
    catch(e){ await dropFolder(root, name); throw storageError(Object.assign(new DOMException('the folder was taken away while it was saved', 'AbortError'), { cause: e })); }
    return dir;
  });
  // her own companion in the in-browser folder: ask the browser to keep it (Safari's 7 days, Android's clean-up)
  if (dir instanceof VDir && !st.seeded && !st.sample) keepStorage().then(persisted => emit('storage', { persisted }), () => {});
  if (stayed) await queueImported(st);   // the memory job works on the open companion: not when she is with someone else
  return dir;
}
// a saved folder put in her contacts without opening him (the open companion stays), then the save note goes
async function listOnly(dir, st){
  const where = dir instanceof VDir ? { where:'phone', vpath: dir.path } : { where:'folder', dir };
  const ok = await core.addContact(where, st.name || dir.name);
  if (ok){ try { await dir.removeEntry(SAVING); } catch {} }
}
// → true when the browser keeps this site's storage until she clears it (asks once if not yet); null when it cannot say
async function keepStorage(){
  const s = typeof navigator !== 'undefined' && navigator.storage;
  if (!s || !s.persist) return null;
  try { return (s.persisted && await s.persisted()) || !!(await s.persist()); } catch { return false; }
}
// A chat she brought (with some of her own words) is queued for the memory job, so she never has to find 整理记忆
async function queueImported(st){
  if (st.sample || !core.queueImportMemory || !(st.msgs || []).some(m => m && m.is_user)) return;
  try { await core.queueImportMemory(st.msgs.length); } catch(e){ console.error(e); }
}
// Load a staged import without a folder (browsers with no folder access, and the demo).
function loadStaged(st){
  core.stash(); resetStore();
  store.card = st.card; store.cardSource = st.cardSource; store.meta = st.meta || {}; store.msgs = st.msgs.slice();
  store.name = st.name || 'TA'; store.source = st.source; store.writable = false; store.importedAt = st.importedAt || 0; store.seeded = !!st.seeded;
  store.avatarURL = st.image ? URL.createObjectURL(st.image) : '';
  store.memory = (st.memory || []).map((it, i) => Object.assign({ file:`${it.date}-${it.kind}-${i}.md` }, it));
  // what came beside the card, his params and the pronoun note, held for the visit
  store.cardFolder = st.folder && st.folder.list && Object.keys(st.folder.list).length ? st.folder.list : null;
  core.folderData = st.folder ? Object.assign({}, st.folder.data) : null;
  store.params = st.params || null;
  store.pronounNote = st.pronoun && st.pronoun.pronouns && st.pronoun.note !== false ? { v: 1, pronouns: st.pronoun.pronouns, writer: 'import', rev: 1, at: st.importedAt || now().getTime() } : null;
  if (st.pronoun && st.pronoun.from === 'folder'){ try { store.pronounNote = JSON.parse(st.folder.files[PRONOUNS_NOTE]); } catch {} }
  afterLoad();
  const r = core.register({ where:'demo' });
  Promise.resolve(r).then(() => queueImported(st));
  return r;
}
// 人称: 'he/him' | 'she/her' | 'they/them'. Nothing in Modu edits a card, so it is
// kept in a note beside the card, pronouns.json = { v, pronouns, writer, rev, at }, never in card.json. A
// pronoun already inside an older card.json is still read (pronouns(), below).
const PRONOUNS_NOTE = 'pronouns.json';
// A pronouns.json the card folder brought is the author's (manifest card_folder.pronoun =
// { file: 'pronouns.json' }). Before anything writes hers over it (setPronouns; a pronouns.json she adds later, cards.js), the
// author's bytes are kept once as pronouns.card.json and card_folder.pronoun.file says so; hers is then pronouns.json, which
// every reader reads. Old folders with no card_folder.pronoun are left as they are. list: card_folder (changed in place)
// → true when the copy was made now (the caller writes the manifest and lists the file).
const PRONOUNS_CARD = 'pronouns.card.json';
async function keepCardPronoun(dir, list){
  const own = list && list.pronoun;
  if (!own || own.file !== PRONOUNS_NOTE || own.by === 'her') return false;
  const b = await readBlob(dir, PRONOUNS_NOTE); if (!b) return false;
  await writeFile(dir, PRONOUNS_CARD, await b.arrayBuffer());
  list.pronoun = Object.assign({}, own, { file: PRONOUNS_CARD });
  return true;
}
async function setPronouns(p, o = {}){
  const was = store.pronounNote || null;
  store.pronounNote = { v: 1, pronouns: String(p || ''), writer: String(o.writer || 'her'), rev: (was ? Number(was.rev) || 0 : 0) + 1, at: now().getTime() };
  if (store.writable){
    let man = null; try { man = JSON.parse(await readText(store.dir, 'manifest.json') || 'null'); } catch {}
    if (man && man.card_folder && await keepCardPronoun(store.dir, man.card_folder)){
      man.files = [...new Set([].concat(man.files || [], [PRONOUNS_CARD]))]; store.cardFolder = man.card_folder;
      await writeFile(store.dir, 'manifest.json', JSON.stringify(man, null, 2));
    }
    await writeFile(store.dir, PRONOUNS_NOTE, JSON.stringify(store.pronounNote, null, 2));
  }
  emit('pronouns', p);
}

// --- Store: read a folder ------------------------------------------------------------------
function resetStore(){
  core.folderData = null;
  Object.assign(store, { dir:null, name:'', card:null, cardSource:null, meta:{}, msgs:[], memory:[], writable:false, avatarURL:'', source:'', folderName:'', importedAt:0, seeded:false, pronounNote:null, cardFolder:null, params:null });
}
// Everything is read and checked first; the open companion is left as he was until then.
async function loadFromDir(dir){
  const note = await savingNote(dir);
  if (note && note.state !== 'saved') throw Object.assign(new Error('这个文件夹没有搬完（上次被打断了），请重新搬家'), { code: 'unfinished' });
  // an empty chat.jsonl counts as no file
  const cardJ = await readText(dir, 'card.json'), chatRaw = await readText(dir, 'chat.jsonl'), chatT = chatRaw && chatRaw.trim() ? chatRaw : null;
  if (!cardJ && !chatT) throw new Error('这个文件夹里没有角色');
  let cj = null;
  if (cardJ){ try { cj = JSON.parse(cardJ); } catch {} if (!cj || typeof cj !== 'object') throw Object.assign(new Error('这个文件夹里的角色卡坏了，打不开'), { code: 'broken-card' }); }
  let c; try { c = chatT ? parseChat(chatT) : { meta:{}, msgs:[] }; } catch { throw Object.assign(new Error('这个文件夹里的聊天记录坏了，打不开'), { code: 'broken-chat' }); }
  const man = await readText(dir, 'manifest.json');
  let mj = null; try { mj = JSON.parse(man); } catch {}
  // when he moved in. Imported messages dated after that moment are shown undated (a folder
  // from before imported_msgs: every message dated after now); and his move-in counts as a moment they
  // were together, so he is not 睡着了 in the middle of it.
  const at = mj && Date.parse(mj.imported_at), importedAt = at && !isNaN(at) ? at : 0;
  if (mj && Number.isInteger(mj.imported_msgs) && importedAt) markUntimely(c.msgs, importedAt, mj.imported_msgs);
  else markUntimely(c.msgs, now().getTime());
  const av = (await readBlob(dir, 'avatar.png')) || (await readBlob(dir, 'card.png'));
  const memory = await readMemory(dir);
  let pronounNote = null; try { const n = JSON.parse(await readText(dir, PRONOUNS_NOTE) || 'null'); pronounNote = n && typeof n === 'object' && n.pronouns ? n : null; } catch {}
  core.stash(); resetStore();
  store.dir = dir; store.writable = true; store.folderName = dir.name;
  store.card = cj ? cj.data : null; store.cardSource = cj ? cj.source : null;
  store.meta = c.meta; store.msgs = c.msgs;
  store.name = (store.card && store.card.name) || c.meta.character_name || dir.name;
  store.source = mj && /SillyTavern/i.test(mj.imported_from) ? '酒馆' : 'c.ai';
  store.importedAt = importedAt;
  store.seeded = !!(mj && mj.seeded);   // firstRun's default companion: his arrival is not a moment they were together
  store.avatarURL = av ? URL.createObjectURL(av) : '';
  store.memory = memory; store.pronounNote = pronounNote;
  afterLoad();
  const where = dir instanceof VDir ? { where:'phone', vpath: dir.path } : { where:'folder', dir };
  await core.register(where);
  // the save is over once he is in her contacts (read back for the in-browser folder: a full phone may have refused them)
  if (note){
    let listed = where.where !== 'phone' || core.ephemeral;
    if (!listed){ try { listed = ((await kvGet('contacts')) || []).some(x => x.vpath === where.vpath); } catch {} }
    if (listed){ try { await dir.removeEntry(SAVING); } catch {} }
  }
}
// The bundled samples: 'char_zh' (char, the default companion in Chinese, with a sample chat and memories),
// 'char_en' (char in English, card only).
const DEMOS = { char_zh: ['char_zh.png', 'char_zh_chat.jsonl', 'char_zh_memory.md'], char_en: ['char_en.png'] };
async function loadDemo(base, who = 'char_zh'){
  const [cardName, chatName, memName] = DEMOS[who] || DEMOS.char_zh;
  const get = n => hostFetch(base + n).then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); });
  const files = [new File([await get(cardName)], cardName, { type:'image/png' })];
  if (chatName) files.push(new File([await get(chatName)], chatName));
  if (memName) files.push(new File([await get(memName)], memName));
  // a bundled sample, not her import: no move-in moment, and 搬家 can say 示例
  const st = await stageImport(files); st.importedAt = 0; st.sample = true;
  return st;
}
function afterLoad(){
  const hello = store.card && (greetingFor(store.card, core.clock()) || store.card.first_mes);
  if (!store.msgs.length && hello)
    store.msgs.push({ name: store.name, is_user:false, is_name:true, send_date: +core.clock(), mes: hello });
  emit('loaded', store);
}
// A card's first line by the time of day: card.extensions.modu.greetings = { morning (05–11),
// noon (11–13), afternoon (13–18), evening (18–23), night (23–05) }; any one may be missing (noon falls back to afternoon).
function greetingFor(card, d){
  const g = card && card.extensions && card.extensions.modu && card.extensions.modu.greetings;
  if (!g || typeof g !== 'object') return '';
  const h = (d || new Date()).getHours(), k = h >= 5 && h < 11 ? 'morning' : h >= 11 && h < 13 ? 'noon' : h >= 13 && h < 18 ? 'afternoon' : h >= 18 && h < 23 ? 'evening' : 'night';
  const line = g[k] || (k === 'noon' ? g.afternoon : '');
  return typeof line === 'string' ? line : '';
}

// --- Store: write back ---------------------------------------------------------------------
// opts.announce: also emit `message`, so an app's message (a 红包 card, his
// answer to it) shows in an open chat like one from send(). Without it, send() emits its own.
async function appendToChat(m, opts = {}){
  store.msgs.push(m); core.updatePresence();
  const c = core.current(); if (c && !m.is_user){ core.touch(c); core.saveContacts(); emit('contacts', core.contacts); }
  await writeChat();
  if (opts && opts.announce) emit('message', m);
}
async function writeChat(){
  if (!store.writable) return;
  try {
    const meta = Object.assign({ user_name:'You', character_name: store.name, create_date: Date.now() }, store.meta || {});
    await writeFile(store.dir, 'chat.jsonl', [JSON.stringify(meta), ...store.msgs.map(x => JSON.stringify(x))].join('\n') + '\n');
  } catch(e){ emit('error', '聊天记录没存上：' + storageError(e).message); }
}
async function setAvatar(file){
  if (store.writable) await writeFile(store.dir, 'avatar.png', await file.arrayBuffer());
  if (store.avatarURL && store.avatarURL.startsWith('blob:')) URL.revokeObjectURL(store.avatarURL);
  store.avatarURL = URL.createObjectURL(file); emit('avatar', store.avatarURL);
  const c = core.current(); if (c){ c.avatar = await core.thumb(store.avatarURL); await core.saveContacts(); emit('contacts', core.contacts); }
}

// --- Records: one folder per record type, one JSON file per record ------------------------------
// A new kind of thing (a diary entry, a
// transfer, a moment) never goes into chat.jsonl: it is <type>/<id>.json in his folder, and the type is
// listed in manifest.json `records` (store 0.2). Old folders with no version and no `records` still
// load; the field is added the first time a record is written. With no folder (demo), records live in
// memory for the visit, one set per contact. Unknown types in a folder are never touched.
const STORE_FORMAT = 'modu-xiaoshouji-store/0.2';

// --- Persona assembly --------------------------------------------------------------------
// Order borrowed from 酒馆's chat-completion defaults: system prompt (card or a plain default),
// description, personality, scenario, example dialogue; then the recent history. Works with no card.
// His pronoun, first found: the note beside the card (she chose it, or the import asked), his params
// (character.pronouns, a card set's own), the card's own extensions.modu.pronouns (an older card.json, or a card
// that names it), then the default from setDefaults.
function pronouns(){
  const pf = core.paramsFile ? core.paramsFile() : null;
  const p = (store.pronounNote && store.pronounNote.pronouns) || (pf && pf.character && pf.character.pronouns) ||
    store.card && store.card.extensions && store.card.extensions.modu && store.card.extensions.modu.pronouns || core.defaults.pronouns || '';
  return { raw:p, en: /^she/i.test(p) ? 'she/her' : /^he/i.test(p) ? 'he/him' : 'they/them', zh: /^she/i.test(p) ? '她' : /^he/i.test(p) ? '他' : 'TA' };
}

Object.assign(core, { buildStoreFiles, saveImport, saveImportLocked, folderName, SAVING, savingNote, saveLock, keepStorage, loadStaged, setPronouns, resetStore, loadFromDir, loadDemo,
  greetingFor, appendToChat, writeChat, setAvatar, STORE_FORMAT, pronouns, PRONOUNS_NOTE, PRONOUNS_CARD, keepCardPronoun });
})(globalThis[Symbol.for('modu.core')]);
// app/core/contacts.js: contacts: every companion this browser knows, switching between them, first run.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, store, env, hostFetch, msgDate, storage, kvSet, kvGet, VDir, phoneRoot, stageImport, saveImport, resetStore,
  loadFromDir, readText, SAVING, savingNote, saveLock, parseChat } = core;

// --- Contacts: every companion this browser knows, newest first ----------------------------------
// Kept in IndexedDB as {id, name, where: 'folder' | 'phone' | 'demo', dir (a folder handle) | vpath,
// last, lastAt, avatar (a small picture)}. Demo contacts live only while the page is open.
core.contacts = []; core.currentId = null; core.ephemeral = false;
async function loadContacts(){
  if (core.ephemeral) return core.contacts;
  // a list the browser could not read (Safari's "connection lost") is tried once more; if it still fails, the
  // page works with nobody listed and NOTHING is written over her list or done to her folders this visit (unread)
  const read = async () => {
    for (let i = 0; i < 2; i++){
      try { const list = (await kvGet('contacts')) || [], cur = (await kvGet('currentId')) || null; core.contacts = list; core.currentId = cur; unread = false; return true; }
      catch(e){ console.error('contacts:', e); }
    }
    unread = true; core.contacts = [];
    return false;
  };
  // recovery reads and writes the list itself; every call (two at once too) then reads the list it left
  // then a removal a reload cut off (替换's old one, the default char) is finished, once the new companion is in
  if (!recovering) recovering = read().then(ok => ok ? recoverSaves().then(async back => { await finishRemovals(); return back; }) : []).catch(e => console.error('recover:', e));
  await recovering;
  await read();
  return core.contacts;
}
let unread = false;   // true after her list could not be read: saveContacts writes nothing over it until a read works
// Once a visit, before anyone reads the contacts: a save a closed tab cut off is never left hidden.
// In the in-browser folder, a companion's folder that is not in her contacts is
//   - removed only when its save did not finish (SAVING says anything but 'saved'), or when it holds neither a card nor
//     a chat (nothing she could open);
//   - else given back as a contact: a finished save, and any folder with a card.json or a chat.jsonl in it, manifest or
//     not (a folder brought from a computer has none; one written over by another tab's list; a manifest that does not
//     parse is no reason). Her companions are her data: what she could open is never deleted.
// One she forgot without deleting (removeContact(id) with no files) is left alone. Nothing is done while another tab
// of hers is saving (saveLock), or when her list or the forgotten list could not be read. → given back.
let recovering = null;
async function recoverSaves(){
  const back = [];
  await saveLock(async free => {
    if (!free) return;
    const keys = (await storage().keys('vfs', 'modu/')).map(String).filter(k => k.startsWith('modu/'));
    const has = new Set(keys), tops = [...new Set(keys.map(k => k.split('/')[1]))];
    let forgot; try { forgot = new Set((await kvGet('forgotten')) || []); } catch(e){ console.error('forgotten:', e); return; }
    let changed = false;
    for (const n of tops){
      const path = 'modu/' + n, dir = new VDir(path);
      if (forgot.has(path) || core.contacts.some(c => c.vpath && c.vpath.startsWith(path + '/'))) continue;
      const mine = core.contacts.find(c => c.vpath === path);
      const note = has.has(path + '/' + SAVING) ? await savingNote(dir) : null;
      if (mine){ if (note && note.state === 'saved'){ try { await dir.removeEntry(SAVING); } catch {} } continue; }
      const cardT = has.has(path + '/card.json') ? await readText(dir, 'card.json') : null;
      const chatT = has.has(path + '/chat.jsonl') ? await readText(dir, 'chat.jsonl') : null;
      const something = !!((cardT && cardT.trim()) || (chatT && chatT.trim()));
      // the browser's own storage with no Web Locks (iOS before 15.4): another tab may be saving this very
      // folder, so an unfinished save only minutes old is left for that tab (the next save of the name, or a later start,
      // clears it if it was cut off). A host's storage (one app, no tabs) clears it at once.
      if (note && note.state !== 'saved' && tabsUnlocked() && !(now() - (Number(note.at) || 0) > YOUNG_SAVE)) continue;
      if ((note && note.state !== 'saved') || !something){
        try { await phoneRoot().removeEntry(n, { recursive:true }); } catch(e){ console.error(e); }
        continue;
      }
      let name = '';
      try { const cj = JSON.parse(cardT || 'null'); name = cj && cj.data && cj.data.name || ''; } catch {}
      if (!name){ try { name = JSON.parse(await readText(dir, 'manifest.json') || 'null').name || ''; } catch {} }
      if (!name){ try { name = parseChat(chatT || '').meta.character_name || ''; } catch {} }
      const c = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), where:'phone', vpath: path, name: name || n, avatar:'' };
      core.contacts.push(c); back.push(c); changed = true;
    }
    if (changed){
      await saveContacts(); emit('contacts', core.contacts);
      // the save note goes only once the list that holds him is kept (a full phone may have refused it: next start again)
      let kept = []; try { kept = ((await kvGet('contacts')) || []).map(c => c.vpath); } catch {}
      for (const c of back) if (kept.includes(c.vpath)){ try { await new VDir(c.vpath).removeEntry(SAVING); } catch {} }
    }
  }, { ifAvailable: true });
  return back;
}
const YOUNG_SAVE = 10 * 60 * 1000;
const tabsUnlocked = () => storage().kind === 'indexeddb' && !(typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request);
const now = () => core.now().getTime();
// --- A removal that waits for a save -------------------------------------------------------------------------------
// planRemoval(name, [{ id, ifUnused }]) keeps in her kv ('removeAfter' { v, writer, rev, at, name, before, remove }) who goes
// once a companion called `name` that was not here before is in her contacts; planRemoval(null) forgets it. finishRemovals()
// does it then (saveImport right after its save; loadContacts at the next start, when a reload cut in): a new companion
// listed → each one goes (never one she has open; at the next start, one that was open hands that place to the new one;
// ifUnused: only while she has never written to him); none → nothing is removed. Either way the note goes.
// an ephemeral core (a host's, a test's) keeps the plan for this run only
let planHere = null;
async function planRemoval(name, remove){
  if (name === null){ planHere = null; if (core.ephemeral) return; try { await storage().del('kv', ['removeAfter']); } catch(e){ console.error(e); } return; }
  const before = core.contacts.flatMap(c => [c.id].concat(c.vpath ? [c.vpath] : []));
  const p = { v: 1, writer: 'core', rev: 1, at: now(), name: String(name), before, remove };
  if (core.ephemeral) { planHere = p; return; }
  await kvSet('removeAfter', p);
}
async function finishRemovals(){
  let p = planHere; if (!p && !core.ephemeral){ try { p = await kvGet('removeAfter'); } catch(e){ console.error(e); return; } }
  if (!p || !Array.isArray(p.remove)) return;
  const before = new Set(p.before || []);
  const arrived = core.contacts.find(c => c.name === p.name && !before.has(c.id) && !(c.vpath && before.has(c.vpath)));
  if (arrived) for (const x of p.remove){
    const c = core.contacts.find(y => y.id === x.id);
    if (!c || (c.id === core.currentId && store.name)) continue;
    if (x.ifUnused && await usedBy(c)) continue;
    if (c.id === core.currentId) core.currentId = arrived.id;
    try { await removeContact(c.id, { files: true }); } catch(e){ console.error(e); }
  }
  await planRemoval(null);
}
// she has written to him (a message of hers in his chat)
async function usedBy(c){
  let msgs = c.id === core.currentId && store.name ? store.msgs : null;
  if (!msgs && c.vpath){ try { msgs = parseChat(await readText(new VDir(c.vpath), 'chat.jsonl') || '').msgs; } catch { msgs = []; } }
  return (msgs || []).some(m => m && m.is_user);
}
async function saveContacts(){
  if (core.ephemeral || unread) return;
  try {
    await kvSet('contacts', core.contacts.filter(c => c.where !== 'demo').map(c => { const o = Object.assign({}, c); delete o.snap; return o; }));
    await kvSet('currentId', core.currentId);
  } catch(e){ console.error(e); }
}
// a contact's small picture: the host's own (setEnv thumb), else a canvas; with no document (a backend), none
// a tall picture is cut toward its top (where the face is), as the round .av shows it (center 22%)
function thumb(url){
  if (env.thumb) return Promise.resolve().then(() => env.thumb(url)).then(s => String(s || ''), () => '');
  return new Promise(res => {
    if (!url || typeof Image === 'undefined' || typeof document === 'undefined') return res('');
    const img = new Image();
    img.onload = () => { try { const c = document.createElement('canvas'); c.width = c.height = 96; const k = Math.max(96 / img.width, 96 / img.height); c.getContext('2d').drawImage(img, (96 - img.width * k) / 2, (96 - img.height * k) * 0.22, img.width * k, img.height * k); res(c.toDataURL('image/jpeg', .85)); } catch { res(''); } };
    img.onerror = () => res(''); img.src = url;
  });
}
async function sameDir(a, b){ try { return !!(a && b && a.isSameEntry && await a.isSameEntry(b)); } catch { return false; } }
// from the end, without a copy of the whole chat for every message of his
function touch(c){ let last = null; for (let i = store.msgs.length - 1; i >= 0 && !last; i--){ const m = store.msgs[i]; if (m && !m.is_user && !core.chatCardKind(m)) last = m; } if (last){ c.last = last.mes; const d = msgDate(last); c.lastAt = d ? d.getTime() : Date.now(); } }
// A demo contact lives only in memory: keep a copy of him before another companion takes the screen.
function stash(){ const was = current(); if (was && was.where === 'demo' && store.name) was.snap = Object.assign({}, store); }
function current(){ return core.contacts.find(c => c.id === core.currentId) || null; }
// Called after a companion is loaded: find or add his contact, put him first, remember him as current.
async function register(where){
  let c = null;
  for (const x of core.contacts){
    if (where.where === 'phone' && x.vpath === where.vpath) c = x;
    else if (where.where === 'folder' && x.where === 'folder' && await sameDir(x.dir, where.dir)) c = x;
    // a demo companion staged again (a second tap on 开始聊天, the page staging him again) is the
    // same contact, never a second copy that drifts apart from the first
    else if (where.where === 'demo' && x.where === 'demo' && x.name === store.name) c = x;
    if (c) break;
  }
  if (!c) { c = Object.assign({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }, where); core.contacts.unshift(c); }
  c.name = store.name; c.avatar = (await thumb(store.avatarURL)) || c.avatar || '';
  touch(c); core.currentId = c.id;
  core.contacts = [c].concat(core.contacts.filter(x => x !== c));
  await saveContacts(); emit('contacts', core.contacts);
  return c;
}
// Add a companion to her contacts without opening him (a save that finished while she was with someone else);
// the open companion and currentId stay. → true once the list is kept (read back for the in-browser folder).
async function addContact(where, name){
  if (core.contacts.some(x => (where.vpath && x.vpath === where.vpath))) return true;
  for (const x of core.contacts) if (where.where === 'folder' && x.where === 'folder' && await sameDir(x.dir, where.dir)) return true;
  const c = Object.assign({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: String(name || ''), avatar:'' }, where);
  core.contacts.push(c);
  await saveContacts(); emit('contacts', core.contacts);
  if (where.where !== 'phone' || core.ephemeral) return true;
  try { return ((await kvGet('contacts')) || []).some(x => x.vpath === where.vpath); } catch { return false; }
}
// Switch to another contact. A folder on a computer may need her one click to allow it again.
async function openContact(id){
  const c = core.contacts.find(x => x.id === id); if (!c) return false;
  if (c.id === core.currentId && store.name) return true;
  stash();
  if (c.where === 'demo'){ if (!c.snap) return false; resetStore(); Object.assign(store, c.snap); core.currentId = c.id; emit('loaded', store); return true; }
  const dir = c.where === 'phone' ? new VDir(c.vpath) : c.dir;
  if (c.where === 'folder' && (await dir.queryPermission({ mode:'readwrite' })) !== 'granted' && (await dir.requestPermission({ mode:'readwrite' })) !== 'granted') return false;
  await loadFromDir(dir); return true;
}
async function canOpenWithoutAsking(c){
  if (!c) return false; if (c.where === 'phone') return true; if (c.where !== 'folder') return false;
  try { return (await c.dir.queryPermission({ mode:'readwrite' })) === 'granted'; } catch { return false; }
}
// removeContact(id) forgets him and leaves his folder; removeContact(id, {files:true}) also
// deletes his folder when it lives in this browser (where 'phone'). A folder on her computer is never deleted.
async function removeContact(id, opts = {}){
  const c = core.contacts.find(x => x.id === id);
  if (c && opts && opts.files && c.where === 'phone' && c.vpath){
    const at = c.vpath.lastIndexOf('/');
    try { await new VDir(c.vpath.slice(0, at)).removeEntry(c.vpath.slice(at + 1), { recursive:true }); }
    catch(e){ console.error(e); try { const f = (await kvGet('forgotten')) || []; if (!f.includes(c.vpath)) await kvSet('forgotten', f.concat(c.vpath)); } catch {} }   // not removed: at least never back
  } else if (c && c.where === 'phone' && c.vpath && !core.ephemeral){
    // forgotten, his folder kept: remembered, so recoverSaves never gives him back
    try { const f = (await kvGet('forgotten')) || []; if (!f.includes(c.vpath)) await kvSet('forgotten', f.concat(c.vpath)); } catch(e){ console.error(e); }
  }
  core.contacts = core.contacts.filter(x => x.id !== id);
  // with {files:true} he also leaves the screen (the store is emptied, then 'loaded'); without it, he stays on it
  if (core.currentId === id){ core.currentId = null; if (opts && opts.files){ resetStore(); emit('loaded', store); } }
  await saveContacts(); emit('contacts', core.contacts);
}

// --- First run: a fresh install finds the default companion char in 聊天 ---------------------------------
// Only a browser that has never held a companion gets him: no contacts and nothing in the in-browser folder.
// The answer is remembered (kv 'firstRun'), so an existing user never sees him forced in, and deleting him
// never brings him back. The demo (ephemeral) never seeds.
// char_zh.png in Chinese mode, char_en.png with { lang:'en' }.
const FIRST_COMPANION = { zh: 'char_zh.png', en: 'char_en.png' };
async function firstRun(base = '../samples/', { lang = 'zh' } = {}){
  const first = FIRST_COMPANION[lang] || FIRST_COMPANION.zh;
  if (core.ephemeral) return null;
  try {
    { const note = await kvGet('firstRun'); if (note){ await newSeedPicture(base, note); return null; } }
    await loadContacts();
    const someone = async () => core.contacts.length || ((await kvGet('contacts')) || []).length || (await storage().keys('vfs', 'modu/')).some(k => String(k).startsWith('modu/'));
    if (await someone()){
      // the default companion saved, then the tab closed before this note: he is still the one firstRun seeded
      let seeded = null;
      for (const c of core.contacts) if (!seeded && c.where === 'phone' && c.vpath){ try { if (JSON.parse(await readText(new VDir(c.vpath), 'manifest.json') || 'null').seeded) seeded = c; } catch {} }
      await kvSet('firstRun', seeded ? { at: core.now().getTime(), seeded: seeded.name, id: seeded.id } : { at: core.now().getTime(), seeded:'' }); return null;
    }
    const r = await hostFetch(base + first); if (!r.ok) throw new Error(r.status);
    const st = await stageImport([new File([await r.blob()], first, { type:'image/png' })]);
    st.seeded = true;   // put here by Modu, not brought by her: no "he just arrived" (seam presence)
    // looked at again inside the save lock, so a companion she is moving in at this moment (another tab, or 搬家
    // before the phone finished starting) comes first and char is not seeded beside him
    const seeded = await saveLock(async () => {
      if (await kvGet('firstRun') || await someone()){ if (!(await kvGet('firstRun'))) await kvSet('firstRun', { at: core.now().getTime(), seeded:'' }); return false; }
      if (await saveWaiting()) return false;   // she is moving one in right now: no note, so a failed move gets char next time
      await core.saveImportLocked(st, phoneRoot());   // core-only: this caller already holds the save lock
      await kvSet('firstRun', { at: core.now().getTime(), seeded: st.name, id: (current() || {}).id || '' });
      return true;
    });
    return seeded ? current() : null;
  } catch(e){ console.error('first run:', e); return null; }   // tried again next time
}
// The default companion's old picture (a flat dark cap, read as a 锅盖头) was seeded once, so a phone that has
// him keeps it. Once, at a later firstRun: the companion firstRun seeded, still in her in-browser folder, whose picture is
// still the old default (card.png's bytes match one of these SHA-256 hashes, and no avatar.png of hers beside it), gets the
// new default as avatar.png (card.png itself is never touched) and a new small copy in 聊天. A picture she chose is never
// touched. Remembered in the firstRun note (picture: 2), so it is looked at once.
const OLD_SEED_PICTURES = { e9ec564abc82f2f1931e87bfefd8bdca6336b6022be07a63a47323fcb0bec24b: 'char_zh.png', ffd02138b60bb54bc0d545b6ca129a05a3b15ccdfe842eda84b54b7b7ed96f37: 'char_en.png' };
async function newSeedPicture(base, note){
  if (!note || !note.seeded || note.picture >= 2) return;
  const done = () => kvSet('firstRun', Object.assign({}, note, { picture: 2 }));
  try {
    if (!core.contacts.length) await loadContacts();
    const c = core.contacts.find(x => note.id ? x.id === note.id : x.where === 'phone' && x.name === note.seeded);
    if (!c || c.where !== 'phone' || !c.vpath) return done();
    const dir = new VDir(c.vpath);
    if (!(JSON.parse(await readText(dir, 'manifest.json') || 'null') || {}).seeded || await core.readBlob(dir, 'avatar.png')) return done();
    const card = await core.readBlob(dir, 'card.png'), subtle = globalThis.crypto && globalThis.crypto.subtle;
    if (!card || !subtle) return;   // no way to tell here (a page not on https): looked at again next time
    const hash = [...new Uint8Array(await subtle.digest('SHA-256', await card.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join('');
    const file = OLD_SEED_PICTURES[hash]; if (!file) return done();   // not the old default: hers, or already new
    const r = await hostFetch(base + file); if (!r.ok) return;   // tried again next time
    const pic = await r.blob();
    await core.writeFile(dir, 'avatar.png', await pic.arrayBuffer());
    const url = URL.createObjectURL(pic);
    c.avatar = (await thumb(url)) || c.avatar;
    if (core.currentId === c.id && store.dir && store.dir.path === c.vpath){ if (store.avatarURL && store.avatarURL.startsWith('blob:')) URL.revokeObjectURL(store.avatarURL); store.avatarURL = url; emit('avatar', url); }
    else URL.revokeObjectURL(url);
    await saveContacts(); emit('contacts', core.contacts);
    await done();
  } catch(e){ console.error('new default picture:', e); }
}
// another save is waiting for the save lock (her own companion, moving in at this very moment)
async function saveWaiting(){
  const L = typeof navigator !== 'undefined' && navigator.locks;
  try { return !!(L && L.query && (await L.query()).pending.some(x => x.name === 'modu-save')); } catch { return false; }
}
// The default companion once she moves her own in. → { id, name, used } while the one firstRun seeded is still
// here, else null. `used`: she has written to him (a message of hers in his chat). The page lets an unused one go quietly
// and asks first (as deleting a contact does) when she used him. firstCompanion({ keep: true }) is her answer "keep him":
// remembered (kv 'firstRun'), so he is not asked about again.
async function firstCompanion(o = {}){
  let note = null; try { note = await kvGet('firstRun'); } catch {}
  if (!note || !note.seeded || note.kept) return null;
  if (o && o.keep){ await kvSet('firstRun', Object.assign({}, note, { kept: true })); return null; }
  const c = core.contacts.find(x => note.id ? x.id === note.id : x.where === 'phone' && x.name === note.seeded && String(x.vpath || '').endsWith('/' + note.seeded));
  if (!c) return null;
  return { id: c.id, name: c.name, used: await usedBy(c) };
}

Object.assign(core, { loadContacts, saveContacts, thumb, touch, stash, current, register, openContact,
  canOpenWithoutAsking, removeContact, firstRun, firstCompanion, recoverSaves, addContact, planRemoval, finishRemovals });
})(globalThis[Symbol.for('modu.core')]);
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
// app/core/her-store.js: her phone: the user's own store beside his folders, the same record API, her backup.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { readText, VDir, RESERVED_TYPES, makeRecords, emit, store } = core;

// --- Her phone: the user's own store, beside his folders ---
// What is on HER phone (her 日历, her 清单, her own 朋友圈 posts) is hers, not any companion's: it lives here,
// once, whoever is open, and survives adding or switching companions. Same record API as `records`. Kept in
// this browser (the in-browser folder `modu-her`, beside `modu/<his name>`), or in memory for the visit when
// the core is ephemeral (the demo, tests). A companion never reads it: the core puts none of it in his prompt.
// He knows something of hers only through a knowledge path (shareWith, below).
const MY_ROOT = 'modu-her', MY_FORMAT = 'modu-her-store/0.1';
const myMem = new Map();
const mySide = () => ({ owner:'her', writable: !core.ephemeral, dir: new VDir(MY_ROOT), format: MY_FORMAT, mem: () => myMem, fill: man => { man.owner = 'her'; } });
const myRecords = makeRecords(mySide);
function myStoreInfo(){ return { owner:'her', where: core.ephemeral ? 'memory' : 'phone', format: MY_FORMAT }; }
// → Promise<{ path: text }>: her store as files (manifest.json, <type>/<id>.json), for the backup
async function myStoreFiles(){
  const out = {}, s = mySide(), man = { store: MY_FORMAT, owner:'her', records:{} };
  if (s.writable){
    const t = await readText(s.dir, 'manifest.json'); if (t) out['manifest.json'] = t;
    for (const type of await myRecords.types()){
      let d = null; try { d = await s.dir.getDirectoryHandle(type); } catch {}
      if (d) for await (const [n, h] of d.entries()) if (h.kind === 'file' && n.endsWith('.json')) out[type + '/' + n] = await (await h.getFile()).text();
    }
  } else {
    for (const [type, m] of myMem) if (m.size){ man.records[type] = { app: type, v: 1 }; for (const [id, r] of m) out[type + '/' + id + '.json'] = JSON.stringify(r, null, 2); }
  }
  if (Object.keys(out).length && !out['manifest.json']) out['manifest.json'] = JSON.stringify(man, null, 2);
  return out;
}
// { path: text } (as myStoreFiles gives) → Promise<{ added, kept }>. A record she already has (same type and
// id) is kept as it is on her phone now: a backup never writes over her phone.
async function restoreMyStore(files = {}){
  let man = {}; try { man = JSON.parse(files['manifest.json'] || '{}') || {}; } catch {}
  let added = 0, kept = 0, profileBack = false;
  for (const [p, text] of Object.entries(files || {})){
    const m = /^([a-z][a-z0-9-]{0,31})\/([A-Za-z0-9_-]{1,64})\.json$/.exec(p); if (!m || RESERVED_TYPES.includes(m[1])) continue;
    let r = null; try { r = JSON.parse(typeof text === 'string' ? text : new TextDecoder().decode(text)); } catch {}
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    if (await myRecords.get(m[1], m[2])) { kept++; continue; }
    await myRecords.put(m[1], Object.assign(r, { id: m[2] }), { app: man.records && man.records[m[1]] && man.records[m[1]].app });
    added++; if (p === PROFILE.join('/') + '.json') profileBack = true;
  }
  // her name, picture and pronoun from the backup apply at once, not after a reload (read through
  // tidyProfile like any other: a hostile picture in a backup is dropped)
  if (profileBack) await loadHerProfile();
  return { added, kept };
}

// --- Her own name, picture and pronoun: one record in her store, profile/me ---------------------------
// { name, avatar (a small picture, a data: address), pronouns ('she/her' | 'he/him' | 'they/them') }. Hers, on her phone,
// whoever is open (and in her backup with the rest of her store); never in his folder. Her name is the one his prompt
// uses for her (userName); her pronoun is the one he uses for her (context.js herPronouns). Read once at boot
// (loadHerProfile) and kept, so the prompt can read it at once; setHerProfile writes it and says so (event 'herprofile').
// A picture is only ever a plain base64 png / jpeg / webp / gif data: address, nothing that could close
// the url( ) or the style="…" it is put in (a restored backup is checked the same way)
const PROFILE = ['profile', 'me'], PRONOUN = /^(she\/her|he\/him|they\/them)$/, PICTURE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+\/=]+$/;
let profile = { name:'', avatar:'', pronouns:'' };
const tidyProfile = r => ({ name: String((r && r.name) || '').replace(/\s+/g, ' ').trim().slice(0, 30),
  avatar: PICTURE.test(String((r && r.avatar) || '')) ? String(r.avatar) : '', pronouns: PRONOUN.test(String((r && r.pronouns) || '')) ? r.pronouns : '' });
function herProfile(){ return Object.assign({}, profile); }
async function loadHerProfile(){
  let r = null; try { r = await myRecords.get(...PROFILE); } catch {}
  profile = tidyProfile(r); emit('herprofile', herProfile()); return herProfile();
}
// patch: any of { name, avatar, pronouns }; '' clears one (her name goes back to the chat's own, his prompt to "the user")
async function setHerProfile(patch = {}){
  const next = tidyProfile(Object.assign({}, profile, patch || {}));
  await myRecords.put(PROFILE[0], Object.assign({ id: PROFILE[1] }, next), { app: 'profile' });
  profile = next; emit('herprofile', herProfile()); return herProfile();
}
// her name for his prompt: the one she gave here, else the one her imported chat had (user_name), else 'You'
function userName(){ return profile.name || (store.meta && store.meta.user_name) || 'You'; }

Object.assign(core, { myRecords, myStoreInfo, myStoreFiles, restoreMyStore, herProfile, loadHerProfile, setHerProfile, userName });
})(globalThis[Symbol.for('modu.core')]);
// app/core/life-block.js: the `life` context block: a fresh copy of what he posted, wrote and has on his phone.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { listeners, store, clip, aheadWords, gapWords, now, RECORD_TYPE, records } = core;

// --- His life on the phone, for the chat (block `life`) ------------------------------------------
// What he posted, wrote and has on his phone lives in records, which are async; buildContext is
// not. So the core keeps a copy of the record types declared to it (lifeTypes, below), read again whenever a record changes or
// another companion is loaded, and send() waits for that read before it builds the prompt. A type this
// companion does not have is skipped. One row per type: (record, words) → [{ at, text }].
// The core knows no app here: a record type reaches the block only once it is declared with
// lifeTypes.add(type, lines), where lines(record, words) → [{ at, text }] says, in words for him, what one
// record is. words = { t (now, ms), she, She, her (her name, or she / She / her), clip(text, n),
// ago(ms) ('2 hours ago'), ahead(ms) ('in about 5 minutes') }. Modu's four built-in types (朋友圈, 信箱, 日记,
// 查手机) are declared in life-types.js through this same call, the way any app declares its own.
const LIFE_TYPES = {};
const lifeTypes = {
  add(type, lines){
    if (typeof type !== 'string' || !RECORD_TYPE.test(type)) throw new Error(`记录类型「${type}」无法使用`);
    const f = typeof lines === 'function' ? lines : lines && typeof lines.lines === 'function' ? lines.lines : null;
    if (!f) throw new Error(`lifeTypes.add('${type}', lines): lines must be a function (record, words) → [{ at, text }]`);
    LIFE_TYPES[type] = f; if (store.name) refreshLife();
    return lifeTypes.list();
  },
  remove(type){ delete LIFE_TYPES[type]; if (store.name) refreshLife(); return lifeTypes.list(); },
  list(){ return Object.keys(LIFE_TYPES); },
  // a type held back: declared, but not read into the block while held (an app still 开发中, such as 信箱, so his
  // prompt says nothing of letters she cannot open). hold(type, false) lets it in again. → the held types
  hold(type, on = true){ if (on) HELD.add(String(type)); else HELD.delete(String(type)); if (store.name) refreshLife(); return [...HELD]; },
  held(){ return [...HELD]; },
};
const HELD = new Set();
core.life = { key:'', recs:[] }; let lifeRead = Promise.resolve();
function lifeKey(){ return (core.currentId || '') + '|' + (store.name || ''); }
async function readLife(){
  const key = lifeKey(); if (!store.name){ core.life = { key, recs:[] }; return; }
  let types = []; try { types = await records.types(); } catch { types = []; }
  const recs = [];
  for (const t of Object.keys(LIFE_TYPES)) if (types.includes(t) && !HELD.has(t)) { try { for (const r of await records.list(t)) recs.push({ t, r }); } catch {} }
  if (key === lifeKey()) core.life = { key, recs };
}
// → a Promise that settles once the copy is fresh (every read waits for the one before it)
// and an outside memory source's recall, so the memory block can be built synchronously
function refreshLife(){ const both = () => readLife().then(core.readLog, core.readLog).then(core.readKnown, core.readKnown).then(core.readRecall, core.readRecall); lifeRead = lifeRead.then(both, both); return lifeRead; }
// 'contacts' too: on a load, 'loaded' comes before he is the current contact (register), and demo records are per contact.
// A change on her phone (owner 'her') is none of his: nothing of his to read again.
listeners.add((ev, d) => { if ((ev === 'records' && !(d && d.owner === 'her')) || ev === 'loaded' || ev === 'contacts') refreshLife(); });
// → the lines of the life block, newest first, each with its time in words; the oldest are dropped to fit
function lifeLines(user, budget){
  if (core.life.key !== lifeKey()) return [];
  const t = now().getTime(), named = user && user !== 'You', items = [];
  const w = { t, she: named ? user : 'she', She: named ? user : 'She', her: named ? user : 'her', clip, ago: gapWords, ahead: aheadWords };
  for (const { t: type, r } of core.life.recs){ if (HELD.has(type)) continue; try { for (const it of LIFE_TYPES[type](r, w)) if (it && it.text) items.push({ at: Number(it.at) || 0, text: it.text }); } catch {} }
  items.sort((a, b) => b.at - a.at);
  const out = []; let n = 0;
  for (const it of items){
    const s = `- ${it.at ? gapWords(Math.max(0, t - it.at)) : 'some time ago'}: ${it.text}`;
    if (n + s.length + 1 > budget) break;   // newest first, so what is cut is the oldest
    out.push(s); n += s.length + 1;
  }
  return out;
}

Object.assign(core, { lifeTypes, lifeKey, refreshLife, lifeLines });
})(globalThis[Symbol.for('modu.core')]);
// app/core/life-types.js: Modu's four built-in record types for the `life` block (朋友圈, 信箱, 日记, 查手机), declared to it.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). Written the way an app declares its own (lifeTypes.add and the words it is
// handed, nothing else of the core's), so these can move into their apps' own files one day without a change.
(function(core){
'use strict';
const { lifeTypes } = core;

// 朋友圈 (apps/moments): his post, her 赞, the comments under it in order
lifeTypes.add('moments', (r, w) => {
  if (!r.text) return [];
  const who = r.by === 'her' ? `${w.She} posted on 朋友圈` : 'You posted on 朋友圈';
  const bits = [`${who}: 「${w.clip(r.text, 120)}」`];
  if (r.liked) bits.push(`${w.She} liked it`);
  const cs = Array.isArray(r.comments) ? r.comments.filter(c => c && c.text) : [];
  if (cs.length) bits.push('comments: ' + cs.slice(-4).map(c => `${c.by === 'her' ? w.she : 'you'}: 「${w.clip(c.text, 60)}」`).join(' / '));
  const last = cs.length ? Number(cs[cs.length - 1].at) || 0 : 0;
  return [{ at: Math.max(Number(r.at) || 0, last), text: bits.join('; ') }];
});
// 信箱 (apps/mail): her letters and his, with where his stands (being written, on its way, arrived, read)
lifeTypes.add('letter', (r, w) => {
  if (r.from === 'her') return r.text ? [{ at: r.at, text: `${w.She} wrote you a letter (信箱): 「${w.clip(r.text, 500)}」` }] : [];
  if (r.status === 'writing') return [{ at: r.at, text: `You are writing ${w.her} a letter back (信箱); it has not gone yet` }];
  if (r.status !== 'ready' || !r.text) return [];
  const due = Number(r.due) || Number(r.at) || 0;
  const where = due > w.t ? `it reaches her ${w.ahead(due - w.t)}` : `it reached her ${w.ago(w.t - due)}${r.read ? ' and she has read it' : ', not read yet'}`;
  return [{ at: Math.min(due, w.t), text: `You wrote ${w.her} a letter (信箱, signed by you; ${where}): 「${w.clip(r.text, 700)}」` }];
});
// 日记 (apps/diary): one entry a day, which she can read
lifeTypes.add('diary', (r, w) => r.text ? [{ at: r.at, text: `Your diary entry for ${r.date || 'a day'} (${w.she} can read your diary): 「${w.clip(r.text, 400)}」` }] : []);
// 查手机 (apps/peek): what she saw on his phone, so he knows she has seen it
lifeTypes.add('peek', (r, w) => {
  const p = r.phone || {}, list = (k, f) => (Array.isArray(p[k]) ? p[k] : []).map(f).filter(Boolean).slice(0, 4);
  const parts = [];
  const notes = list('notes', x => x.text && w.clip(x.text, 40)); if (notes.length) parts.push('备忘录: ' + notes.join('; '));
  const chats = list('chats', x => x.with && x.last && `${w.clip(x.with, 12)}: 「${w.clip(x.last, 50)}」`); if (chats.length) parts.push('chats with others: ' + chats.join('; '));
  const searches = list('searches', x => x.text && w.clip(x.text, 30)); if (searches.length) parts.push('搜索: ' + searches.join('; '));
  const songs = list('songs', x => x.text && w.clip(x.text, 30)); if (songs.length) parts.push('歌单: ' + songs.join('; '));
  return parts.length ? [{ at: r.at, text: `${w.She} looked through your phone (查手机) and saw these, which are yours: ` + parts.join(' · ') }] : [];
});
})(globalThis[Symbol.for('modu.core')]);
// app/core/events.js: the event log: what happened in the phone's apps, one call for every app; the `events` block reads it.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, store, clone, clip, isoDay, gapWords, now, RECORD_TYPE, records, lifeKey, refreshLife } = core;

// --- The event log: what happened in the phone's apps (block `events`) -------------------------------
// One call for every app: logEvent({ app, who, what, line, title?, detail?, at? }). The core never knows
// which apps exist: it keeps the entries, newest last, and the `events` block reads them back as lines.
// A new game or app writes here and needs no change in this file. Stored as the record type 'log', one
// record per day (log/dYYYYMMDD.json, { items: [...] }); writes are queued so two at once never lose one.
// What the `life` block already tells him (朋友圈, 信箱, 日记, 查手机) is not written here.
// An entry may carry `session` (the app session it happened in, ctx.session; read
// back with eventList({ session })) and `quiet: true` (kept in the log, but left out of his prompt unless a
// notice rule, below, says otherwise).
const LOG_TYPE = 'log', LOG_DAYS = 7, LOG_PER_DAY = 300, LOG_WHO = ['her', 'him', 'both'];
core.eventLog = { key:'', items:[] }; let logWrite = Promise.resolve();
const logId = t => 'd' + isoDay(new Date(t)).replace(/-/g, '');
async function readLog(){
  const key = lifeKey(); if (!store.name){ core.eventLog = { key, items:[] }; return; }
  const t = now().getTime(), items = [];
  for (let i = LOG_DAYS - 1; i >= 0; i--){
    let r = null; try { r = await records.get(LOG_TYPE, logId(t - i * 864e5)); } catch {}
    if (r && Array.isArray(r.items)) for (const e of r.items) if (e && e.line) items.push(e);
  }
  items.sort((a, b) => (a.at || 0) - (b.at || 0));
  if (key === lifeKey()) core.eventLog = { key, items };
}
// → Promise<entry>: the entry as kept. Throws (with words for her) on a bad app id or an empty line.
function logEvent(e = {}){
  if (!e || typeof e !== 'object') return Promise.reject(new Error('记录必须是一个对象'));
  const app = String(e.app || '');
  if (!RECORD_TYPE.test(app)) return Promise.reject(new Error(`应用「${app}」无法记录`));
  const line = clip(String(e.line || '').replace(/\s+/g, ' ').trim(), 240);
  if (!line) return Promise.reject(new Error('这条记录是空的'));
  const t = now().getTime(), at = Math.min(Number(e.at) || t, t);   // never in the future
  const entry = { id: at.toString(36) + Math.random().toString(36).slice(2, 6), at, app, who: LOG_WHO.includes(e.who) ? e.who : 'her', what: clip(String(e.what || ''), 40), line };
  if (e.title) entry.title = clip(String(e.title), 20);
  if (e.session) entry.session = clip(String(e.session), 40);
  if (e.quiet === true) entry.quiet = true;
  if (e.detail !== undefined){ try { const s = JSON.stringify(e.detail); if (s && s.length <= 4000) entry.detail = JSON.parse(s); } catch {} }
  const job = async () => {
    const id = logId(at), day = (await records.get(LOG_TYPE, id)) || { id, items:[] };
    const items = (Array.isArray(day.items) ? day.items : []).concat(entry).sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-LOG_PER_DAY);
    await records.put(LOG_TYPE, { id, date: isoDay(new Date(at)), at: items[items.length - 1].at, items }, { app:'log' });
    if (core.eventLog.key === lifeKey() && !core.eventLog.items.some(x => x.id === entry.id)) core.eventLog = { key: core.eventLog.key, items: core.eventLog.items.concat(entry).sort((a, b) => (a.at || 0) - (b.at || 0)) };
    emit('logged', clone(entry));
    return clone(entry);
  };
  const p = logWrite.then(job, job); logWrite = p.catch(() => {}); return p;
}
// → Promise<entry[]> of the last `days` days (default 7, at most 60), oldest first; `app` keeps one app's only,
// `session` one session's only.
async function eventList(opts = {}){
  await refreshLife();
  const days = Math.max(1, Math.min(60, Number(opts.days) || LOG_DAYS)), t = now().getTime();
  let items = core.eventLog.items;
  if (days > LOG_DAYS){ items = []; for (let i = days - 1; i >= 0; i--){ let r = null; try { r = await records.get(LOG_TYPE, logId(t - i * 864e5)); } catch {} if (r && Array.isArray(r.items)) items.push(...r.items); } }
  const from = t - days * 864e5;
  return clone(items.filter(e => (e.at || 0) > from && (!opts.app || e.app === opts.app) && (!opts.session || e.session === opts.session)).sort((a, b) => (a.at || 0) - (b.at || 0)));
}
// --- Notice rules: the seam where it is decided whether, and how, an entry reaches his prompt --------------
// noticeRules.add(what, rule): for every entry whose `what` is this kind, rule(entry, words) gives the line the
// events block shows instead of entry.line ('' or null: he is not told this one). words: { t (now, ms), she,
// ago(ms) }. With no rule, an entry shows its own line, and a quiet entry (quiet: true) shows nothing. The
// core ships with NO rules: this is the hook where a page decides, for
// example, whether he notices that she looked through his phone (the kind 'peeked':
// rarely, depending on his mood). The core never names an app or a kind here.
const notice = new Map();
const noticeRules = {
  add(what, rule){
    if (typeof what !== 'string' || !what || what.length > 40) throw new Error(`notice rule: 「${what}」 is not an event kind`);
    if (typeof rule !== 'function') throw new Error('notice rule: needs a function (entry, words) → line');
    notice.set(what, rule); return [...notice.keys()];
  },
  remove(what){ notice.delete(what); return [...notice.keys()]; },
  list(){ return [...notice.keys()]; },
};
function noticeLine(e, t, She){
  const rule = notice.get(e.what);
  if (!rule) return e.quiet ? '' : e.line;
  try { const l = rule(clone(e), { t, she: She, ago: ms => gapWords(Math.max(0, ms)) }); return l ? clip(String(l).replace(/\s+/g, ' ').trim(), 240) : ''; }
  catch(err){ console.error(err); return ''; }
}
// → the lines of the events block, newest first, each with its time in words; the oldest dropped to fit
function eventLines(user, budget){
  if (core.eventLog.key !== lifeKey()) return [];
  const t = now().getTime(), named = user && user !== 'You', She = named ? user : 'she';
  const by = { her: She, him: 'you', both: `you and ${named ? user : 'her'}` };
  const out = []; let n = 0;
  for (const e of core.eventLog.items.slice().reverse()){
    if ((e.at || 0) > t) continue;
    const line = noticeLine(e, t, She); if (!line) continue;
    const s = `- ${gapWords(Math.max(0, t - (e.at || 0)))}, ${e.title || e.app}, ${by[e.who] || She}: ${line}`;
    if (n + s.length + 1 > budget) break;
    out.push(s); n += s.length + 1;
  }
  return out;
}

Object.assign(core, { readLog, logEvent, eventList, eventLines, noticeRules });
})(globalThis[Symbol.for('modu.core')]);
// app/core/sessions.js: app sessions and the neutral chat cards: what she and he are doing in an app right now.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, store, clone, clip, now, appendToChat } = core;

// --- Neutral chat cards: a grey line in the chat, not her voice and not his ---------------------------------
// Kept in his chat file as a 酒馆 system (narrator) message, so a 酒馆-style reader shows it as a note and
// leaves it out of the prompt: { name:'System', is_user:false, is_system:true, mes, extra:{ type:'narrator',
// modu_card:{ kind, app, title?, session?, id? } } }. Two kinds:
//   'summary'  one line at the end of an app session (neutral, not hers, not his)
//   'invite'   his invitation into an app: only the hook. It is drawn if one is there; nothing in
//              Modu writes one yet.
// The core's prompt never reads these lines as anyone's words (context, memory job, the contact list skip
// them): what happened reaches him through the event log instead.
const CARD_KINDS = ['summary', 'invite'];
// pure: → the card's kind ('summary' | 'invite') when the message is a neutral chat card, else ''
function chatCardKind(m){
  const c = m && m.is_system && m.extra && m.extra.modu_card;
  return c && CARD_KINDS.includes(c.kind) ? c.kind : '';
}
// card: { kind ('summary' default | 'invite'), app, line (or mes), title?, session?, id? } → Promise<message>.
// Appended to the chat and announced (the 'message' event). Throws on an empty line, an unknown kind or no companion.
async function addChatCard(card = {}){
  if (!store.name) throw new Error('还没有打开联系人');
  const kind = card.kind || 'summary';
  if (!CARD_KINDS.includes(kind)) throw new Error(`没有「${kind}」这种卡片`);
  const line = clip(String(card.line || card.mes || '').replace(/\s+/g, ' ').trim(), 200);
  if (!line) throw new Error('这张卡片是空的');
  const c = { kind, app: clip(String(card.app || ''), 40) };
  for (const k of ['title', 'session', 'id', 'type']) if (card[k]) c[k] = clip(String(card[k]), 64);
  const m = { name:'System', is_user:false, is_system:true, is_name:false, send_date: now().getTime(), mes: line, extra:{ type:'narrator', modu_card: c } };
  await appendToChat(m, { announce:true });
  return clone(m);
}

// --- App sessions: an app that owns the screen while she is in it, with him --------------------------------
// The page's ctx.session is a thin helper on these calls. A session belongs to the companion open when
// it began. While it is open its `hold` line (what his chat turns should know: "你们正在一起听《…》，第2首")
// goes into the `activity` block of his prompt. Ending it may add one summary card to the chat.
// Sessions live in memory only: a reload ends them (the app begins a new one when it mounts again).
core.openSessions = [];
const SESSION_ID = /^[A-Za-z0-9_-]{1,40}$/;
const sessionOf = id => core.openSessions.find(s => s.id === id) || null;
const said = (op, s) => emit('session', { op, session: clone(s), open: sessionList() });
// state: → the open sessions (copies), oldest first
function sessionList(){ return clone(core.openSessions); }
// { app, title?, id? } → Promise<session { id, app, title, contact, at, hold }>
async function beginSession(o = {}){
  const app = String(o.app || '');
  if (!core.RECORD_TYPE.test(app)) throw new Error(`应用「${app}」无法开始`);
  if (!store.name) throw new Error('还没有打开联系人');
  const id = o.id ? String(o.id) : now().getTime().toString(36) + Math.random().toString(36).slice(2, 6);
  if (!SESSION_ID.test(id)) throw new Error(`编号「${id}」无法使用`);
  const was = sessionOf(id); if (was) return clone(was);
  const s = { id, app, title: clip(String(o.title || ''), 20), contact: core.currentId || '', at: now().getTime(), hold: '' };
  core.openSessions.push(s);
  said('begin', s);
  return clone(s);
}
// (id, line) → Promise<session | null>: what his chat turns see while it is open ('' = nothing)
async function holdSession(id, line){
  const s = sessionOf(String(id)); if (!s) return null;
  s.hold = clip(String(line || '').replace(/\s+/g, ' ').trim(), 160);
  said('hold', s);
  return clone(s);
}
// (id, { card? }) → Promise<{ session, card }>: closes it; card (the fields of addChatCard, kind 'summary')
// adds one neutral line to the chat. Ending a session that is not open does nothing ({ session:null, card:null }).
async function endSession(id, o = {}){
  const s = sessionOf(String(id)); if (!s) return { session:null, card:null };
  core.openSessions = core.openSessions.filter(x => x !== s);
  said('end', s);
  let card = null;
  const c = o && o.card;
  if (c && (c.line || c.mes) && s.contact === (core.currentId || '')){
    card = await addChatCard(Object.assign({}, c, { kind:'summary', app: s.app, session: s.id, title: c.title || s.title }));
  }
  return { session: clone(s), card };
}
// → the lines of the `activity` block: the open sessions of the companion open now that hold a line
function activityLines(budget){
  const out = []; let n = 0;
  for (const s of core.openSessions){
    if (!s.hold || s.contact !== (core.currentId || '')) continue;
    const l = '- ' + s.hold; if (n + l.length + 1 > budget) break;
    out.push(l); n += l.length + 1;
  }
  return out;
}

Object.assign(core, { CARD_KINDS, chatCardKind, addChatCard, sessionList, beginSession, holdSession, endSession, activityLines });
})(globalThis[Symbol.for('modu.core')]);
// app/core/known.js: knowledge paths: how he comes to know something of hers (shareWith), and the `known` block's lines.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, store, clone, clip, gapWords, now, RECORD_TYPE, records, lifeKey, refreshLife } = core;

// --- Knowledge paths: how he comes to know something of hers (block `known`) ---------------------------
// Her phone is hers (myRecords): nothing on it reaches his prompt by itself. He knows a thing of hers only
// by one of these paths, and the prompt says which: she 'shared' it with him (an app's 告诉他 / 分享给他),
// she 'told' him, they did it 'together', or he 'snooped' (反向查手机: he looked at her phone without her
// showing him; not built, no app uses it yet: the hook is this value and its wording). What he was shown is
// kept in HIS folder (record type 'known', one record per thing, id '<app>-<the thing's id>'), as he saw it
// then: if she changes it later on her phone, he knows only what she showed him. Like the log, this code
// names no app: any app shares through shareWith.
const KNOWN_TYPE = 'known', KNOWN_HOW = ['shared', 'told', 'together', 'snooped'];
core.knownNow = { key:'', items:[] };
const knownId = (app, id) => (app + '-' + String(id || '').replace(/[^A-Za-z0-9_-]+/g, '_')).slice(0, 64);
async function readKnown(){
  const key = lifeKey(); if (!store.name){ core.knownNow = { key, items:[] }; return; }
  let items = []; try { items = (await records.list(KNOWN_TYPE)).filter(e => e && e.line); } catch {}
  if (key === lifeKey()) core.knownNow = { key, items };
}
// { app, id, line, how?, title?, until?, item?, at? } → Promise<entry>. `line` is for him (like the log's):
// what he was shown, in the app's own told-lines. `until` (ms): after it the thing is past and leaves his prompt
// (a plan's day). `item`: any JSON for the app (≤ 2,000 characters), never in the prompt. Sharing the same
// app + id again replaces what he was shown. Needs a companion open; throws (with words for her) otherwise.
async function shareWith(e = {}){
  if (!e || typeof e !== 'object') throw new Error('记录必须是一个对象');
  if (!store.name) throw new Error('还没有打开角色');
  const app = String(e.app || '');
  if (!RECORD_TYPE.test(app)) throw new Error(`应用「${app}」无法分享`);
  const line = clip(String(e.line || '').replace(/\s+/g, ' ').trim(), 240);
  if (!line) throw new Error('这条记录是空的');
  const t = now().getTime(), entry = { id: knownId(app, e.id || t.toString(36)), app, how: KNOWN_HOW.includes(e.how) ? e.how : 'shared', line, at: Math.min(Number(e.at) || t, t) };
  if (e.title) entry.title = clip(String(e.title), 20);
  if (Number(e.until)) entry.until = Number(e.until);
  if (e.item !== undefined){ try { const s = JSON.stringify(e.item); if (s && s.length <= 2000) entry.item = JSON.parse(s); } catch {} }
  const saved = await records.put(KNOWN_TYPE, entry, { app:'known' });
  await refreshLife();   // a read already under way may have missed it: read again, after it, so his prompt has it now
  emit('shared', clone(saved));
  return clone(saved);
}
// → Promise<entry[]>: what the open companion was shown, oldest first; `app` keeps one app's only.
async function knownList(opts = {}){
  await refreshLife();
  return clone(core.knownNow.items.filter(e => !opts.app || e.app === opts.app).sort((a, b) => (a.at || 0) - (b.at || 0)));
}
const HOW_WORDS = {
  shared: (e, she) => `${she} shared it with you herself${e.title ? ' (from her ' + e.title + ')' : ''}`,
  told: (e, she) => `${she} told you`,
  together: () => 'you did it together',
  snooped: (e, she) => `you saw it on ${she === 'she' ? 'her' : she + "'s"} phone yourself, without her showing you`,
};
// → the lines of the known block, newest first; what is past its `until` is left out; the oldest dropped to fit
function knownLines(user, budget){
  if (core.knownNow.key !== lifeKey()) return [];
  const t = now().getTime(), she = user && user !== 'You' ? user : 'she', out = []; let n = 0;
  for (const e of core.knownNow.items.slice().sort((a, b) => (b.at || 0) - (a.at || 0))){
    if (e.until && e.until < t) continue;
    const s = `- ${gapWords(Math.max(0, t - (e.at || 0)))}, ${(HOW_WORDS[e.how] || HOW_WORDS.shared)(e, she)}: ${e.line}`;
    if (n + s.length + 1 > budget) break;
    out.push(s); n += s.length + 1;
  }
  return out;
}

Object.assign(core, { readKnown, shareWith, knownList, knownLines });
})(globalThis[Symbol.for('modu.core')]);
// app/core/params.js: per-character parameters: params.json beside his card, read through one call, param(name, fallback).
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, store, clone, readText, listeners } = core;

// Every 活人感 rule reads its knobs here and nowhere else. Three layers, the first that has the knob wins:
//   1. her settings (setHer): always win; for a knob in CAPS hers is a ceiling, so a knob can never raise her cap
//   2. his params.json (modu-character-params/0.1): written by the
//      calibration call at import, or by hand for a house character
//   3. Modu's defaults: DEFAULT_PARAMS below, the one place they live in code. It is the knob part of
//      the default params file, word for word
// then the caller's own fallback. A knob is a dotted path into the file: 'initiative.default_cap',
// 'clock.weekday.wake'. A new knob is one new name with a fallback; old files keep working.
const PARAMS_FORMAT = 'modu-character-params/0.1';
const DEFAULT_PARAMS = Object.freeze({"clock":{"chronotype":"normal","weekday":{"wake":"07:40","sleep":"23:50"},"weekend":{"wake":"09:00","sleep":"00:40"},"jitter_min":30,"late_night_chance":0.08,"late_night_until":"02:00","nap":{"chance":0.1,"from":"13:00","to":"14:00"}},"work":{"kind":"上班","blocks":[{"from":"09:30","to":"12:00","label":"在忙","place":"work","busy":0.7},{"from":"13:30","to":"18:00","label":"在忙","place":"work","busy":0.7}],"deadline":{"days_per_month":[1,3],"effect":{"busy":0.85,"reply_delay_x":2,"mood_shift":"tired","initiative_x":0.5}},"days_off_per_week":2},"replies":{"typing_chars_per_s":5,"first_delay_s":[5,90],"busy_delay_min":[10,60],"asleep":"defer_to_wake","read_no_reply":{"when_busy":0.1,"when_free":0,"max_per_day":1},"bubbles":[1,3],"length":"short"},"initiative":{"per_day":[0,2],"default_cap":2,"quiet_hours":["00:30","08:00"],"never_chase_twice":true,"after_silence_hours":36,"kinds":[{"id":"share","weight":4},{"id":"ask_her_day","weight":3},{"id":"invite","weight":1,"rules":"behaviour-rules.md §1"}]},"mood":{"baseline":"calm","moods":["calm","content","playful","tired","low"],"volatility":0.25,"low_days_per_month":[1,2],"lifts":["你主动来找"],"dips":["很累的一天"],"low_mood_behaviour":"话少一点，但会回"},"jealousy":{"level":0.5,"style":"teasing","triggers":["你亲昵地提到别人"],"response":["说出来，半开玩笑"],"never":["冷暴力","控制"],"cooldown_hours":12},"teasing":{"notes":"无"},"gifts":{"per_month":[0,2],"kinds":[{"id":"small","weight":1,"pool":["一杯奶茶","一张照片"]}]},"diary":{"voice":"第一人称，自然","length_chars":[150,350],"perspective":"first","must":["去了哪、做了什么","你出现过的时刻"],"quirks":[],"avoid":["重复前三天的开头和结尾"]},"day":{"slots_per_day":[6,9],"templates":[{"id":"workday","weight":5,"shape":["起床","通勤","上班","午饭","上班","回家","晚饭","放松"]},{"id":"dayoff","weight":2,"shape":["睡懒觉","出门逛","吃饭","在家"]}],"weekly":{},"seasonal":[]},"places":[{"id":"home","name":"家里","kind":"home","weight":5},{"id":"work","name":"工作的地方","kind":"work","weight":5},{"id":"shop","name":"楼下便利店","kind":"errand","weight":1},{"id":"street","name":"街上","kind":"inspiration","weight":1}],"tastes":[],"peek":{"contacts_file":null,"notes_style":"待办和随手记","search_style":"日常"},"friends_reach_out":{"per_day":[0,2]}});
// knobs where her setting is a ceiling (a number, or each end of a [lo, hi] range), never raised by a knob
const CAPS = ['initiative.default_cap', 'initiative.per_day'];
let file = null, her = {};
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const path = (o, name) => { let v = o; for (const k of String(name).split('.')) { if (v == null || typeof v !== 'object' || !has(v, k)) return undefined; v = v[k]; } return v; };
// the file's own value: a file's `knobs` object first, then the schema's top-level groups
function fromFile(name){ if (!file) return undefined; const k = file.knobs && typeof file.knobs === 'object' ? path(file.knobs, name) : undefined; return k !== undefined ? k : path(file, name); }
function capped(mine, knob){
  if (typeof mine === 'number' && typeof knob === 'number') return Math.min(mine, knob);
  if (typeof mine === 'number' && Array.isArray(knob)) return knob.map(x => typeof x === 'number' ? Math.min(x, mine) : x);
  if (Array.isArray(mine) && Array.isArray(knob)) return knob.map((x, i) => typeof x === 'number' && typeof mine[i] === 'number' ? Math.min(x, mine[i]) : x);
  return mine;
}
const copy = v => v === undefined ? undefined : clone(v);
// → the knob's value (a copy), from her settings, his params, Modu's defaults, or `fallback`
function param(name, fallback){
  const p = fromFile(name), knob = p !== undefined ? p : path(DEFAULT_PARAMS, name);
  if (has(her, name)) return copy(CAPS.includes(name) && knob !== undefined ? capped(her[name], knob) : her[name]);
  return knob !== undefined ? copy(knob) : fallback;
}
// which layer answered: 'her' | 'params' | 'default' | 'fallback'
function paramSource(name){
  if (has(her, name)) return 'her';
  return fromFile(name) !== undefined ? 'params' : path(DEFAULT_PARAMS, name) !== undefined ? 'default' : 'fallback';
}
// A file that is not an object (broken JSON, a list) is no file: defaults, and no error shown to her.
function useParams(o){ file = o && typeof o === 'object' && !Array.isArray(o) ? clone(o) : null; emit('params', paramsInfo()); return paramsInfo(); }
// her settings as knob names → values, e.g. { 'initiative.default_cap': 1 }; the page passes them (设置 → 他找你)
function setHer(map){ her = map && typeof map === 'object' && !Array.isArray(map) ? clone(map) : {}; emit('params', paramsInfo()); return paramsInfo(); }
// the header, in both shapes ({ writer, made_at, card_hash } at the top, or the schema's { character, calibration })
function paramsInfo(){
  if (!file) return { loaded: false, format: PARAMS_FORMAT, writer: 'default', made_at: null, card_hash: null, rev: 0, her: Object.keys(her) };
  const cal = file.calibration && typeof file.calibration === 'object' ? file.calibration : {};
  return { loaded: true, format: file.format || PARAMS_FORMAT, writer: file.writer || 'hand', made_at: file.made_at || cal.at || null,
    card_hash: file.card_hash || (file.character && file.character.card_hash) || cal.card_hash || null, rev: Number(file.rev) || 0, her: Object.keys(her) };
}
// the whole file as read (a copy), or null: for the card-state engine (params.state, params.bond) and his pronoun
function paramsFile(){ return file ? clone(file) : null; }
// his folder's params.json, read again on each load; a companion with none (or in demo) gets the defaults.
// Her own params added beside a card that brought its own are params.her.json (the author's file is never written over),
// and hers is read first
// The folder is the one open when the read began, and only the newest read is kept (two loads close together
// never leave the older companion's file in force)
let reading = 0;
async function readParams(){
  const mine = ++reading, dir = store.writable ? store.dir : null;
  let o = null;
  if (dir){ for (const f of ['params.her.json', 'params.json']){ try { o = JSON.parse(await readText(dir, f) || 'null'); } catch { o = null; } if (o) break; } }
  else o = store.params || null;   // a staged import may carry one (a card folder)
  if (mine === reading) useParams(o);
}
core.paramsRead = Promise.resolve();
// On a load the previous companion's file is let go at once, so param() never answers with his knobs while
// the new folder is read (Modu's defaults until then)
listeners.add(ev => { if (ev === 'loaded'){ file = null; core.paramsRead = readParams(); } });

const params = { get: paramsFile, info: paramsInfo, use: useParams, setHer, source: paramSource, read: readParams, CAPS: CAPS.slice(), DEFAULTS: DEFAULT_PARAMS, FORMAT: PARAMS_FORMAT };
Object.assign(core, { PARAMS_FORMAT, DEFAULT_PARAMS, param, params, paramsFile });
})(globalThis[Symbol.for('modu.core')]);
// app/core/card-state.js: card state: extra state a card brings (a hidden score, a level), kept in his folder and moved only by state.nudge.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, store, clone, isoDay, now, records, listeners, msgDate } = core;

// Modu has no score of its own. A card that wants one declares it, in card.extensions.modu.state (SillyTavern
// ignores the field, so the card still loads there unchanged) or in his params (params.state.<key>, or the
// card set's params.bond, read as the key bond.name); a card that declares none has none, and every call
// below is then a quiet no-op. Hidden in play by default: no number on screen, and he never names it.
// The rules a declaration may set, each optional (normalised by stateDecl):
//   range [lo, hi] (default [0, 100]) · start (default lo) · step (every change is rounded to it; default 1)
//   turn_max (largest change one turn may make) · caps { day_up, day_down, week_up, week_down }
//   slow { above, factor }: at or above `above`, every change and every cap is multiplied by `factor`
//   decay { per_day, toward }: drifts toward `toward` each day, only upward (time away never lowers it)
//   gates [{ at, min_days?, unlock: [ids] }]: at the value `at` (and `min_days` after the state began) the ids
//     open; an open id never closes again, whatever the value does later
//   drip { ids, min_gap_days }: of the ids a gate opens, these come out one at a time, min_gap_days apart
//   hidden (default true) · undertow { chance } (next-layer hints)
// Also read, the same rules under the names some cards use: max_per_turn (= turn_max),
// max_per_day / max_per_week (= caps both ways), slow_above { at, scale } (= slow), decay: false (off), a gate's
// unlock as one id, drip { min_days_apart } with no ids (every id a gate opens drips), undertow { skip }.
// A key is any text the card's author wrote (信任, trust level, xinren): 1 to 64 characters, no line break or
// square bracket (the reply tag could not carry it). Its record's file name is the key when that is a plain id, else a safe
// one made from it (stateId); the record keeps the key itself as `key`.
const STATE_TYPE = 'state', KEY = /^[^\n\r[\]【】]{1,64}$/, ID = /^[A-Za-z0-9_-]{1,64}$/, DAY = 86400000, LOG_KEEP = 20;
const keyNorm = k => String(k == null ? '' : k).normalize('NFKC').trim().toLowerCase();
function stateId(key){
  const k = String(key);
  if (ID.test(k)) return k;
  const hex = [...new TextEncoder().encode(k)].map(b => b.toString(16).padStart(2, '0')).join('');
  if (hex.length <= 62) return 's-' + hex;
  let h = 2166136261; for (const ch of k) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return 's-h' + (h >>> 0).toString(36);
}
// a key as written in a tag or a 世界书 rule → the declared key it names (exact, else the same text in NFKC, any case), or ''
function keyIn(obj, key){
  if (key == null || !obj) return '';
  const k = String(key).trim(); if (Object.prototype.hasOwnProperty.call(obj, k)) return k;
  const n = keyNorm(k); return Object.keys(obj).find(x => keyNorm(x) === n) || '';
}
const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : d; };
const ids = v => [].concat(v || []).map(String).filter(Boolean);
function stateDecl(key, d){
  d = d && typeof d === 'object' ? d : {};
  const r = Array.isArray(d.range) ? d.range : [num(d.min, 0), num(d.max, 100)];
  const lo = num(r[0], 0), hi = Math.max(lo, num(r[1], 100));
  const c = Object.assign({ day: d.max_per_day, week: d.max_per_week }, d.caps && typeof d.caps === 'object' ? d.caps : {});
  const cap = (a, b) => { const v = c[a] != null ? c[a] : c[b]; return v == null ? Infinity : Math.abs(num(v, Infinity)); };
  const sa = d.slow_above && typeof d.slow_above === 'object' ? { above: d.slow_above.at, factor: d.slow_above.scale } : null;
  const slow = d.slow || sa || (d.threshold != null ? { above: d.threshold, factor: d.factor } : null);
  const tm = d.turn_max != null ? d.turn_max : d.max_per_turn;
  const decay = d.decay && typeof d.decay === 'object' && num(d.decay.per_day, 0) > 0 ? { per_day: Math.abs(num(d.decay.per_day, 0)), toward: num(d.decay.toward, num(d.start, lo)) } : null;
  return {
    key, range: [lo, hi], start: Math.min(hi, Math.max(lo, num(d.start, lo))), step: Math.abs(num(d.step, 1)) || 1,
    turn_max: tm == null ? Infinity : Math.abs(num(tm, Infinity)),
    caps: { day_up: cap('day_up', 'day'), day_down: cap('day_down', 'day'), week_up: cap('week_up', 'week'), week_down: cap('week_down', 'week') },
    slow: slow && slow.above != null ? { above: num(slow.above, hi), factor: Math.max(0, num(slow.factor, 1)) } : null,
    decay,
    // the bond's `unlocks [{ entry, min, min_days }]` are read as gates in any declaration (the same names serve all three)
    gates: [].concat(d.gates || [], [].concat(d.unlocks || []).filter(u => u && typeof u === 'object' && u.min != null).map(u => ({ at: u.min, min_days: u.min_days, asks: u.asks, unlock: [u.entry] }))).filter(g => g && g.at != null).map(g => Object.assign({ at: num(g.at, hi), min_days: Math.max(0, num(g.min_days, 0)), unlock: ids(g.unlock || g.ids) }, g.asks != null ? { asks: Math.max(0, num(g.asks, 0)) } : {})).sort((a, b) => a.at - b.at),
    // the public schema's other bond rules (characters/params/params.schema.json): pace multiplies every change before the
    // caps; tiers name levels; unlocks_stay false lets a gate close again below its value; away and echo are kept as given
    pace: Math.max(0, num(d.pace, 1)),
    tiers: [].concat(d.tiers || []).filter(x => x && x.min != null).map(x => ({ id: String(x.id || ''), name: String(x.name || ''), min: num(x.min, 0) })).sort((a, b) => a.min - b.min),
    stay: d.unlocks_stay !== false,
    away: d.away && typeof d.away === 'object' ? clone(d.away) : null,
    echo: d.echo && typeof d.echo === 'object' ? clone(d.echo) : null,
    drip: d.drip && typeof d.drip === 'object' ? { ids: d.drip.ids ? ids(d.drip.ids) : null, min_gap_days: Math.max(0, num(d.drip.min_gap_days != null ? d.drip.min_gap_days : d.drip.min_days_apart, 1)) } : null,
    hidden: d.hidden !== false,
    undertow: d.undertow && typeof d.undertow === 'object' ? { chance: Math.min(1, Math.max(0, num(d.undertow.chance, 0))) } : null,
  };
}
// params.bond (modu-character-params/0.1, every field of the public schema) as one declaration: unlocks become gates
function bondDecl(b){
  const unl = [].concat(b.unlocks || []);
  return { range: Array.isArray(b.range) ? b.range : [0, 100], start: b.start, step: b.step, pace: b.pace, tiers: b.tiers, caps: b.caps, turn_max: b.turn_max, slow: b.slow, decay: b.decay,
    hidden: b.hidden, unlocks_stay: b.unlocks_stay, away: b.away, echo: b.echo,
    gates: [].concat(b.gates || [], unl.filter(u => u && typeof u === 'object').map(u => ({ at: u.min, min_days: u.min_days, asks: u.asks, unlock: [u.entry] }))), drip: b.drip, undertow: b.undertow };
}
// the tier the value has reached (the highest whose min it reached), or null
function stateTier(decl, value){ let t = null; for (const x of (decl && decl.tiers) || []) if (value >= x.min) t = x; return t ? Object.assign({}, t) : null; }
// → { key: decl } for a card and a params file (pure). The card's own declaration wins over params for a key. A declaration
// that cannot be used (its rules not an object, a key empty or too long) is left out; stateProblems counts them (搬家 says so).
const usable = (k, d) => KEY.test(String(k).trim()) && d && typeof d === 'object' && !Array.isArray(d);
function stateProblems(card, params){
  let n = 0;
  const cs = card && card.extensions && card.extensions.modu && card.extensions.modu.state, ps = params && params.state;
  for (const s of [cs, ps]) if (s != null){ if (typeof s !== 'object' || Array.isArray(s)) n++; else for (const k of Object.keys(s)) if (!usable(k, s[k])) n++; }
  return n;
}
function stateDecls(card, params){
  const out = {}, add = (k, d) => { k = String(k == null ? '' : k).trim(); if (usable(k, d) && !keyIn(out, k)) out[k] = stateDecl(k, d); };
  const cs = card && card.extensions && card.extensions.modu && card.extensions.modu.state;
  if (cs && typeof cs === 'object') for (const k of Object.keys(cs)) add(k, cs[k]);
  const ps = params && params.state;
  if (ps && typeof ps === 'object') for (const k of Object.keys(ps)) add(k, ps[k]);
  const b = params && params.bond;
  // the key: the bond's own `key` (any usable key text: 亲近 too), else its name when that is a plain id, else 'bond'
  // (a name such as 好感度 is a label)
  if (b && typeof b === 'object' && (b.key || b.name)){ const bk = String(b.key == null ? '' : b.key).trim(); add(bk && KEY.test(bk) ? bk : [String(b.name || ''), 'bond'].find(x => ID.test(x)), bondDecl(b)); }
  return out;
}
const weekOf = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoDay(d); };
// calendar days between two times (local midnights; Math.round, so a 23- or 25-hour day across DST is still one day)
const daysBetween = (a, b) => Math.round((new Date(isoDay(new Date(b)) + 'T00:00') - new Date(isoDay(new Date(a)) + 'T00:00')) / DAY);
const tidy = v => Math.round(v * 1e6) / 1e6;
const roundTo = (v, step) => tidy(Math.round(v / step) * step);
// toward zero, to a whole number of steps (symmetric: +0.5 and −0.5 at step 1 both give 0)
const stepsOf = (v, step) => Math.sign(v) * Math.floor(Math.abs(v) / step + 1e-9) * step;
// a fresh record for a key
function stateStart(decl, t){ return { v: 1, value: decl.start, unlocked: [], queued: [], since: t, writer: 'core', rev: 0, at: t, moved: { day: isoDay(new Date(t)), up: 0, down: 0, week: weekOf(t), wup: 0, wdown: 0 }, log: [] }; }
// time passes (pure): decay (upward only), gates that min_days now lets open, one drip if it is due
function stateSettle(decl, rec, t){
  const r = clone(rec);
  r.unlocked = ids(r.unlocked); r.queued = ids(r.queued);
  if (decl.decay && r.value < decl.decay.toward){
    const days = daysBetween(r.decayed || r.at || t, t);
    if (days > 0) r.value = Math.min(decl.decay.toward, roundTo(r.value + days * decl.decay.per_day, decl.step));
  }
  r.decayed = t;
  const age = daysBetween(r.since || t, t), drips = !decl.drip ? [] : decl.drip.ids || decl.gates.flatMap(g => g.unlock);
  // unlocks_stay false: a gate below the value closes again (its ids leave unlocked and the queue)
  if (decl.stay === false) for (const g of decl.gates) if (r.value < g.at){ r.unlocked = r.unlocked.filter(id => !g.unlock.includes(id)); r.queued = r.queued.filter(id => !g.unlock.includes(id)); }
  for (const g of decl.gates) if (r.value >= g.at && age >= g.min_days)
    for (const id of g.unlock) if (!r.unlocked.includes(id) && !r.queued.includes(id)) (drips.includes(id) ? r.queued : r.unlocked).push(id);
  if (r.queued.length && (!r.dripAt || t - r.dripAt >= decl.drip.min_gap_days * DAY)){ r.unlocked.push(r.queued.shift()); r.dripAt = t; }
  return r;
}
// one change (pure): → { rec, applied, reason, carried? } (reason when nothing moved: 'nothing' | 'turn' | 'cap' | 'small' |
// 'range'; carried: the record changed anyway, a part-step kept in rec.carry, so write it)
function stateApply(decl, rec, delta, why, o = {}){
  const t = num(o.at, now().getTime()), r = stateSettle(decl, rec, t);
  let d = num(delta, 0);
  if (!d) return { rec: r, applied: 0, reason: 'nothing' };
  if (o.turn != null && r.turn === String(o.turn)) return { rec: r, applied: 0, reason: 'turn' };   // one change per turn
  d *= decl.pace == null ? 1 : decl.pace;   // pace: faster or slower, before the per-turn max and the caps
  d = Math.sign(d) * Math.min(Math.abs(d), decl.turn_max);
  const m = r.moved = Object.assign({ day: '', up: 0, down: 0, week: '', wup: 0, wdown: 0 }, r.moved);
  const day = isoDay(new Date(t)), week = weekOf(t);
  if (m.day !== day) Object.assign(m, { day, up: 0, down: 0 });
  if (m.week !== week) Object.assign(m, { week, wup: 0, wdown: 0 });
  const f = decl.slow && r.value >= decl.slow.above ? decl.slow.factor : 1;
  d *= f;
  const room = tidy(d > 0 ? Math.min(decl.caps.day_up * f - m.up, decl.caps.week_up * f - m.wup) : Math.min(decl.caps.day_down * f - m.down, decl.caps.week_down * f - m.wdown));
  if (room <= 0) return { rec: r, applied: 0, reason: 'cap' };
  // a part-step left over from before (the same way only) joins this change; the room is a ceiling, so it is
  // clamped first, and only whole steps toward zero are applied. What is left is carried to the next change in
  // that direction (so a slow factor of 0.4 at step 1 still moves, every few changes), unless the cap cut it.
  let carry = num(r.carry, 0); if (Math.sign(carry) !== Math.sign(d)) carry = 0;
  let total = d + carry, cut = false;
  if (Math.abs(total) > room + 1e-9){ total = Math.sign(total) * room; cut = true; }
  const q = tidy(stepsOf(total, decl.step));
  r.carry = cut ? 0 : tidy(total - q);
  if (!q) return { rec: r, applied: 0, reason: cut ? 'cap' : 'small', carried: true };
  const value = tidy(Math.min(decl.range[1], Math.max(decl.range[0], r.value + q))), applied = tidy(value - r.value);
  if (!applied){ r.carry = 0; return { rec: r, applied: 0, reason: 'range', carried: true }; }
  if (applied > 0){ m.up = tidy(m.up + applied); m.wup = tidy(m.wup + applied); } else { m.down = tidy(m.down - applied); m.wdown = tidy(m.wdown - applied); }
  r.value = value; r.at = t; r.rev = (Number(r.rev) || 0) + 1; r.writer = String(o.writer || 'core');
  if (o.turn != null) r.turn = String(o.turn);
  r.log = [].concat(r.log || [], [{ at: t, delta: applied, why: String(why || '').slice(0, 120), writer: r.writer }]).slice(-LOG_KEEP);
  return { rec: stateSettle(decl, r, t), applied, reason: '' };
}
// a 世界书 entry's unlock rule (pure): extensions.modu.when = { key, at } (on once the key reaches `at`; also
// `min`) and/or { id } (on once that id is in the key's `unlocked`). An entry without one is always on.
// `view` = { key: { value, unlocked } }. An undeclared key keeps the entry off.
// Time gates in the same rule, all of what is given must hold: hours 'HH:MM-HH:MM' (may
// wrap past midnight), weekdays [0-6] (0 = Sunday), date 'MM-DD' | 'her_birthday' | 'met', lunar 'MM-DD' | 'eve',
// solar_term '<name>'. `o` = { t (ms), dates: { her_birthday, met: 'MM-DD' }, lunar(t) → { md, eve }, term(t) → name }:
// a gate whose answer is not given (no t, no lunar calendar) keeps the entry off. `state` is read as `key`.
function timeOk(w, o){
  const has = k => w[k] != null;
  if (!['hours', 'weekdays', 'date', 'lunar', 'solar_term'].some(has)) return true;
  if (!o || o.t == null) return false;
  const d = new Date(o.t), pad = n => String(n).padStart(2, '0'), md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (has('hours')){
    const m = String(w.hours).match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/); if (!m) return false;
    const now = d.getHours() * 60 + d.getMinutes(), a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4];
    if (!(a <= b ? now >= a && now <= b : now >= a || now <= b)) return false;
  }
  if (has('weekdays') && ![].concat(w.weekdays).map(Number).includes(d.getDay())) return false;
  if (has('date')){ const want = /^\d{2}-\d{2}$/.test(w.date) ? w.date : o.dates && o.dates[w.date]; if (!want || want !== md) return false; }
  if (has('lunar')){ const l = typeof o.lunar === 'function' ? o.lunar(o.t) : null; if (!l || !(w.lunar === 'eve' ? l.eve : l.md === w.lunar)) return false; }
  if (has('solar_term')){ const n = typeof o.term === 'function' ? o.term(o.t) : null; if (!n || n !== w.solar_term) return false; }
  return true;
}
// a 世界书 entry's own id, as a gate's `unlock` / a bond's `unlocks[].entry` names it: extensions.modu.id when the card
// gives one (酒馆's own uid is a number it may renumber), else its id / uid
const entryId = e => { const m = e && e.extensions && e.extensions.modu; const v = m && m.id != null ? m.id : e ? (e.id != null ? e.id : e.uid) : null; return v == null ? null : String(v); };
function loreWhen(entry, view, o){
  const ext = entry && entry.extensions && entry.extensions.modu, w0 = ext && ext.when;
  if (!w0 || typeof w0 !== 'object') return true;
  const w = Object.assign({}, w0, { key: w0.key != null ? w0.key : w0.state });
  if (!timeOk(w, o)) return false;
  if (w.key == null) return true;
  const s = view ? view[keyIn(view, w.key)] : null;
  if (!s) return false;
  const at = w.at != null ? w.at : w.min, u = ids(s.unlocked);
  if (at == null && w.id == null) return true;
  if (at != null && s.value >= num(at, Infinity)) return true;
  // an id once opened stays open (gates never re-lock): the rule's id, or the entry's own id
  return (w.id != null && u.includes(String(w.id))) || (entryId(entry) != null && u.includes(entryId(entry)));
}
// next-layer hints ("undertow", pure): on a given day, with the key's undertow chance, one line from the next
// gate above the value: a 世界书 entry whose when.key is this key and whose when.at is that gate, with a line
// in extensions.modu.undertow; entries flagged st_only (extensions.modu.st_only, or a comment with ~undertow)
// are skipped. The draw is the same all day (seeded by day and key). → { key, at, line, entry } | null.
// The line goes into the day record's hints and that day's context as "known, never said", never his words.
function undertowFor(decl, value, entries, day){
  if (!decl || !decl.undertow || !decl.undertow.chance) return null;
  const next = decl.gates.find(g => g.at > value); if (!next) return null;
  const seed = h => { let x = 2166136261; for (const c of String(h)) x = Math.imul(x ^ c.charCodeAt(0), 16777619) >>> 0; return x / 4294967296; };
  if (seed(day + '|' + decl.key) >= decl.undertow.chance) return null;
  const pool = [].concat(entries || []).filter(e => {
    const m = e && e.extensions && e.extensions.modu; if (!m || typeof m.undertow !== 'string' || !m.undertow.trim()) return false;
    if (m.st_only || /~undertow/.test(String(e.comment || ''))) return false;
    const w = m.when || {}, at = w.at != null ? w.at : w.min, id = entryId(e);
    // in the next gate: the gate opens this entry (by its id), or its when rule names this key at that gate
    if (id != null && next.unlock.includes(id)) return true;
    return keyNorm(w.key != null ? w.key : w.state) === keyNorm(decl.key) && (num(at, NaN) === next.at || (w.id != null && next.unlock.includes(String(w.id))));
  });
  if (!pool.length) return null;
  const e = pool[Math.floor(seed(day + '#' + decl.key) * pool.length)];
  return { key: decl.key, at: next.at, line: e.extensions.modu.undertow.trim(), entry: entryId(e) != null ? entryId(e) : (e.comment || '') };
}
// the away effect (pure; mood only, never the value): away = { after_days, mood, recover_days } from params;
// herDays = the days she was with him ('YYYY-MM-DD', any order); today = 'YYYY-MM-DD'. After a gap of at least
// after_days, his mood on return is `mood`, fading over recover_days consecutive days with her; a gap of a day or
// more before that resets the recovery (counted again from the new return) and the mood stays. → { mood, strength (1 → 0), since } | null
function awayEffect(away, herDays, today){
  if (!away || typeof away !== 'object' || !(num(away.after_days, 0) > 0)) return null;
  if (!away.mood) away = Object.assign({}, away, { mood: 'low' });   // an away block that names no mood means 'low'
  const N = num(away.after_days, 0), M = Math.max(1, num(away.recover_days, 1));
  const days = [...new Set(ids(herDays))].filter(d => d <= today).sort();
  const gap = (a, b) => daysBetween(new Date(a + 'T12:00'), new Date(b + 'T12:00'));
  if (!days.length) return null;
  // walk her days in order: a long gap starts it (from the return), each next day with her counts toward recovery,
  // any other gap while it lasts restarts the count from the new return (the mood stays), M days done ends it
  let since = null, done = 0;
  for (let i = 1; i < days.length; i++){
    const g = gap(days[i - 1], days[i]);
    if (g >= N){ since = days[i]; done = 0; }
    else if (since){ if (g === 1) done++; else { since = days[i]; done = 0; } }
    if (since && done >= M){ since = null; done = 0; }
  }
  const last = days[days.length - 1], g = gap(last, today);
  if (g >= N) return { mood: String(away.mood), strength: 1, since: last };   // away now: how he will be when she comes
  if (!since) return null;
  if (g > 1) return { mood: String(away.mood), strength: 1, since };         // she left again mid-recovery: it starts over when she is back
  return { mood: String(away.mood), strength: Math.round((1 - done / M) * 100) / 100, since };
}

// --- the open companion's state, through records (state/<key>.json) ---------------------------------------
// a sync copy { key: { value, unlocked } } for the 世界书 rule (loreWhen) and the context, read on load and after each change
core.stateView = {}; let stateRead = Promise.resolve();
function declared(){ return stateDecls(store.card, core.paramsFile ? core.paramsFile() : null); }
// `since` = the first time Modu saw this key declared for this companion (his first load with the card); the start
// record is written then, so min_days counts from it (days of a chat imported from elsewhere do not count).
// Settling (decay, gates that min_days now opens, a due drip) is written back, so it advances on a quiet card too.
const sameRec = (a, b) => a && b && a.value === b.value && JSON.stringify(a.unlocked) === JSON.stringify(b.unlocked) && JSON.stringify(a.queued || []) === JSON.stringify(b.queued || []) && (a.dripAt || 0) === (b.dripAt || 0);
async function settleKey(k, d, t){
  let r = null; try { r = await records.get(STATE_TYPE, stateId(k)); } catch {}
  const s = stateSettle(d, r || stateStart(d, t), t);
  if (!r || !sameRec(r, s)){
    s.rev = (r ? Number(r.rev) || 0 : 0) + 1;
    const w = await records.commit(STATE_TYPE, Object.assign(s, { id: stateId(k), key: k, at: r ? (r.at || t) : t }), { writer: 'core', app: 'state' });
    return w.ok ? w.record : (w.record || s);
  }
  return r;
}
async function readState(t){
  const ds = declared(), view = {}, ms = t == null ? now().getTime() : +t;
  for (const k of Object.keys(ds)){ let r; try { r = await settleKey(k, ds[k], ms); } catch(e){ console.error(e); r = stateStart(ds[k], ms); } view[k] = { value: r.value, unlocked: ids(r.unlocked), hidden: ds[k].hidden }; }
  core.stateView = view;
  return clone(view);
}
function refreshState(t){ const go = () => readState(t); stateRead = stateRead.then(go, go); return stateRead; }
listeners.add(ev => { if (ev === 'params' || ev === 'loaded') refreshState(); });
// the away effect for the open companion at t (default now): params away, else params bond.away, else a declared
// key's own away; her days from the chat. → { mood, strength, since, gap, day, how, never } | null (gap: the days she was gone
// before `since`; day = which day of her return this is (1 = the day she came back), how = the card's own words
// for that day when its away block has them (on_return.day1, day2 … , else on_return.after once they run out), never = its
// `never` list as one line ('' when the card gives none)
function awayNow(t){
  const p = core.paramsFile ? core.paramsFile() : null, ds = declared(), pa = core.param ? core.param('away', null) : null;
  const away = (pa && typeof pa === 'object' ? pa : null) || (p && p.bond && p.bond.away) || (Object.values(ds).find(d => d.away) || {}).away || null;
  if (!away) return null;
  const ms = t == null ? now().getTime() : +t, today = isoDay(new Date(ms));
  const days = [...new Set((store.msgs || []).filter(m => m && m.is_user).map(m => msgDate(m)).filter(d => d && d.getTime() <= ms).map(d => isoDay(d)))].sort();
  const e = awayEffect(away, days, today); if (!e) return null;
  const i = days.indexOf(e.since), before = i > 0 ? days[i - 1] : null;
  const day = Math.max(1, days.filter(d => d >= e.since).length + (days.includes(today) ? 0 : 1));
  const ret = away.on_return && typeof away.on_return === 'object' ? away.on_return : {}, word = v => typeof v === 'string' ? v.trim() : '';
  const how = word(ret['day' + day]) || (Object.keys(ret).some(k => /^day\d+$/.test(k)) ? word(ret.after) : '');
  const never = [].concat(away.never || ret.never || []).filter(x => typeof x === 'string' && x.trim()).join('；');
  return Object.assign(e, { gap: before ? daysBetween(new Date(before + 'T12:00'), new Date(e.since + 'T12:00')) : 0, day, how, never });
}
// the reply-tag rule for the open companion's declared keys ('' with none). The model learns each key's name and
// how far one turn may move it, never its value; hidden as ever: never named to her, never a number.
function stateRule(){
  // hidden (default true): he never names it or hints at it; hidden false: he may speak of it in his own words. Either way
  // no number: Modu shows none on screen and he never says one (no form, no bar for any card state)
  const ds = declared(), keys = Object.keys(ds); if (!keys.length) return '';
  const one = k => { const d = ds[k]; return `「${k}」 (in steps of ${d.step}${isFinite(d.turn_max) ? `, at most ${d.turn_max} in one reply` : ''})`; };
  const hid = keys.filter(k => ds[k].hidden), open = keys.filter(k => !ds[k].hidden);
  return `${store.name || 'You'} keeps ${keys.length > 1 ? 'some quiet measures' : 'a quiet measure'} of how things stand between you: ${keys.map(one).join(', ')}. When something in this exchange really moves one, add on its own line after your reply [state: ${keys[0]}+${ds[keys[0]].step} a few words why] (or −); at most one such line, and most replies need none. She never sees the tag or any number, and you never say a number.` +
    (hid.length ? ` Never name ${hid.map(k => `「${k}」`).join(', ')} or hint at ${hid.length > 1 ? 'them' : 'it'} in your words.` : '') +
    (open.length ? ` ${open.map(k => `「${k}」`).join(', ')} you may speak of in your own words when it fits.` : '');
}
// a [state: …] tag read against the declared keys, longest first (NFKC, any case), so a key holding a sign
// or a digit (stage-2) is never cut short; → { key, delta, why } | null (no declared key starts it: the plain parse stands)
function stateFromTag(raw){
  const s = String(raw == null ? '' : raw).normalize('NFKC').trim(), low = s.toLowerCase();
  for (const k of Object.keys(declared()).sort((a, b) => b.length - a.length)){
    const n = keyNorm(k); if (!low.startsWith(n)) continue;
    const m = s.slice(n.length).match(/^\s*([+\-−])\s*(\d+(?:\.\d+)?)\s*[,，:：]?\s*([\s\S]*)$/); if (!m) continue;
    const v = parseFloat(m[2]); if (!isFinite(v) || !v) continue;
    return { key: k, delta: /[\-−]/.test(m[1]) ? -v : v, why: m[3].trim().slice(0, 120) };
  }
  return null;
}
const state = {
  // → { key: decl } for the open companion (copies); {} for a card with no state
  declared(){ return clone(declared()); },
  // → { value, unlocked, hidden, rev } or null (an undeclared key)
  async get(key){
    const ds = declared(); key = keyIn(ds, key); const d = ds[key]; if (!d) return null;
    const t = now().getTime(); let r = null; try { r = await records.get(STATE_TYPE, stateId(key)); } catch {}
    r = stateSettle(d, r || stateStart(d, t), t);
    return { value: r.value, unlocked: r.unlocked.slice(), hidden: d.hidden, rev: r.rev || 0, tier: stateTier(d, r.value) };
  },
  // the only way a value moves: → { ok, value, applied, reason }. An undeclared key is refused (reason 'undeclared')
  // and nothing is written. o: { writer ('model' for a reply tag, an app's id, 'her'), turn (one change per turn) }
  async nudge(key, delta, why, o = {}){
    const ds = declared(); key = keyIn(ds, key) || String(key); const d = ds[key]; if (!d) return { ok: false, value: null, applied: 0, reason: 'undeclared' };
    await stateRead.catch(() => {});   // the start record (written on load) first, so the two never race
    const t = now().getTime(); let r = null; try { r = await records.get(STATE_TYPE, stateId(key)); } catch {}
    const res = stateApply(d, r || stateStart(d, t), delta, why, Object.assign({}, o, { at: t }));
    const opened = !r || !sameRec(r, res.rec) || res.carried;
    if (res.applied || opened){
      if (!res.applied) res.rec.rev = (Number(r.rev) || 0) + 1;
      const w = await records.commit(STATE_TYPE, Object.assign(res.rec, { id: stateId(key), key, at: t }), { writer: res.applied ? res.rec.writer : 'core', app: 'state' });
      if (!w.ok) return { ok: false, value: w.record ? w.record.value : res.rec.value, applied: 0, reason: 'clash' };
    }
    await refreshState();
    if (res.applied) emit('state', { key, value: res.rec.value, applied: res.applied });
    return { ok: !!res.applied, value: res.rec.value, applied: res.applied, reason: res.reason };
  },
  // sync, from the copy: is this 世界书 entry on? (an entry with no when is)
  // o: the time gates' { t, dates, lunar, term } (t defaults to now())
  when(entry, o){ return loreWhen(entry, core.stateView, Object.assign({ t: now().getTime() }, o)); },
  view(){ return clone(core.stateView); },
  refresh: () => refreshState(),
  // once a day (the scheduler's daily job), or any time: settle every declared key at t (default now) and write it
  // back: decay, min_days gates, the next drip. → the view { key: { value, unlocked, hidden } }
  settle: t => refreshState(t),
  // the day's next-layer hints for the open companion, from his card's 世界书 (lore books and character_book)
  undertow(day){
    const ds = declared(), card = store.card || {}, inCard = (card.extensions && card.extensions.modu && card.extensions.modu.lore) || [];
    // the 世界书 files beside his card count too (a book of the same name already in an older card, once)
    const names = new Set([].concat(inCard).map(b => String((b && b.name) || ''))), beside = core.folderData && Array.isArray(core.folderData.lore) ? core.folderData.lore.filter(b => b && !names.has(String(b.name || ''))) : [];
    const books = [].concat(card.character_book || [], inCard, beside);
    const entries = []; for (const b of books){ const e = b && b.entries; if (Array.isArray(e)) entries.push(...e); else if (e && typeof e === 'object') entries.push(...Object.values(e)); }
    return Object.keys(ds).map(k => undertowFor(ds[k], (core.stateView[k] || {}).value != null ? core.stateView[k].value : ds[k].start, entries, day || isoDay(now()))).filter(Boolean);
  },
  away: awayEffect,
  // the away effect now, for the open companion; the reply-tag rule; the record id of a key
  awayNow, rule: stateRule, id: stateId, fromTag: stateFromTag,
  // the pure engine, for hosts and tests
  engine: { decl: stateDecl, decls: stateDecls, start: stateStart, settle: stateSettle, apply: stateApply, when: loreWhen, undertow: undertowFor, away: awayEffect, tier: stateTier, problems: stateProblems, id: stateId },
};

Object.assign(core, { STATE_TYPE, stateDecls, stateProblems, stateApply, loreWhen, undertowFor, awayEffect, state, refreshState });
})(globalThis[Symbol.for('modu.core')]);
// app/core/jobs.js: jobs: everything that should happen later (a kept promise, an order arriving, his post), booked through the core; and the bell, how a due job reaches her.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, clone, now, records, RECORD_TYPE } = core;

// A job is a record in his folder, job/<id>.json, so it survives a reload, a backup and another host:
//   { v, id, kind, at (ms: when it is due), expire? (ms: after it, it is dropped, never run late), force? (true:
//     due even in her quiet hours / over the day's cap; the scheduler decides what that means), owner (an app's
//     id, or 'core' / 'life'), payload (the owner's own JSON), state: 'pending' | 'done' | 'dropped', writer, rev }
// Apps book jobs only here (never their own timers for his life), and say the kinds they book when they register
// (`jobs: { kinds: [...] }`); the core never reads a payload and never knows an app.
// Running them: each owner says once how its jobs are done
// (handle(owner, fn)), and run(t) (called by the one clock, app/core/clock.js; never a timer here) takes the due
// jobs soonest first, drops the expired ones, and runs each through its owner exactly once.
const JOB_TYPE = 'job', STATES = ['pending', 'done', 'dropped'];
const OWNER = /^(?:core|life|[a-z][a-z0-9-]{0,31})$/;
function checkJob(j){
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('任务必须是一个对象');
  if (!RECORD_TYPE.test(String(j.kind || ''))) throw new Error(`任务种类「${j.kind}」无法使用`);
  if (!OWNER.test(String(j.owner || ''))) throw new Error(`任务的主人「${j.owner}」无法使用`);
  if (!isFinite(Number(j.at))) throw new Error('任务需要一个时间');
}
// A job with the id of one already booked is never booked again: the stored one comes back unchanged (a done or
// dropped job is never revived, so a job runs once whoever books or runs it). Writes go through records.commit.
async function add(job){
  checkJob(job);
  if (job.id){ const had = await get(job.id); if (had) return had; }
  const t = now().getTime(), j = { v: 1, kind: String(job.kind), at: Number(job.at), owner: String(job.owner), payload: job.payload == null ? null : clone(job.payload),
    state: 'pending', writer: String(job.writer || job.owner), rev: 1, made: t };
  if (job.id) j.id = String(job.id);
  if (job.expire != null && isFinite(Number(job.expire))) j.expire = Number(job.expire);
  if (job.force === true) j.force = true;
  const w = await records.commit(JOB_TYPE, j, { writer: j.writer, app: 'job' });
  if (!w.ok) return w.record;   // another writer booked the same id first
  emit('job', { op: 'add', job: w.record });
  return w.record;
}
async function get(id){ try { return await records.get(JOB_TYPE, String(id)); } catch { return null; } }
async function mark(id, state, writer, why){
  const j = await get(id); if (!j) return null;
  if (j.state !== 'pending') return j;   // a job ends once: the first writer wins
  const w = await records.commit(JOB_TYPE, Object.assign({}, j, { state, rev: (Number(j.rev) || 0) + 1, ended: now().getTime() }, why ? { why: String(why).slice(0, 40) } : {}), { writer: String(writer || j.writer), app: 'job' });
  if (!w.ok) return w.record;            // someone ended it in between: theirs stands
  emit('job', { op: state === 'done' ? 'done' : 'drop', job: w.record });
  return w.record;
}
// a pending job moved to a later time (its owner said "not yet": her quiet hours, he is asleep); `at` only grows
async function move(id, at, writer){
  const j = await get(id); if (!j || j.state !== 'pending' || !isFinite(Number(at))) return j;
  const w = await records.commit(JOB_TYPE, Object.assign({}, j, { at: Math.max(Number(at), j.at), rev: (Number(j.rev) || 0) + 1 }), { writer: String(writer || j.owner), app: 'job' });
  if (w.ok) emit('job', { op: 'move', job: w.record });
  return w.record;
}
// → job[] by `at` (soonest first); o: { owner?, kind?, state? }
async function list(o = {}){
  let all = []; try { all = await records.list(JOB_TYPE); } catch { all = []; }
  return all.filter(j => (!o.owner || j.owner === o.owner) && (!o.kind || j.kind === o.kind) && (!o.state || j.state === o.state));
}
// → the pending jobs whose time has come (at ≤ t) and not past their expire, soonest first. A read: it changes nothing.
async function due(t){
  const ms = t == null ? now().getTime() : +t;
  return (await list({ state: 'pending' })).filter(j => j.at <= ms && !(j.expire != null && j.expire < ms));
}

// --- running them ---------------------------------------------------------------------------------------------
// handle(owner, fn): how this owner's jobs are done. fn(job, { t, late, batch }) may return 'drop' (or { drop: why }),
// { at } (not yet: moved to a later time), 'wait' (left as it is, tried on the next run), or anything else (done).
// A job whose owner has not said yet (an app still loading) waits. A handler that throws is tried again later
// (1, 5, 15, 60 minutes), then dropped as 'failed': never a loop.
const handlers = new Map(), inflight = new Set(), RETRY = [1, 5, 15, 60];
// Before its handler runs, a job is claimed ({ by: this realm, at }) with a rev-checked write, so two pages on one store
// (two tabs) never both run it: the loser of the write, or anyone seeing a fresh claim of another's, skips it. A claim
// older than CLAIM_MS (its page went away mid-run) may be taken over.
const ME = Math.random().toString(36).slice(2, 10), CLAIM_MS = 2 * 60000;
function handle(owner, fn){
  if (!OWNER.test(String(owner || ''))) throw new Error(`任务的主人「${owner}」无法使用`);
  if (typeof fn === 'function') handlers.set(String(owner), fn); else handlers.delete(String(owner));
  return [...handlers.keys()];
}
// run(t?, { cap? }) → { ran: [job], dropped: [{ job, why }], waiting }: one round. The expired ones are dropped
// (why 'expired'); then at most `cap` due jobs (default 20) run, soonest first, each once (a job another run or
// another writer has ended is skipped). `batch` tells a handler what else is due in this round (the scheduler's
// flood cap on catch-up reads it). One round at a time: a second call waits for the first.
let round = null;
function run(t, o = {}){
  if (round) return round;
  round = (async () => {
    const ms = t == null ? now().getTime() : +t, cap = Math.max(1, Number(o.cap) || 20), ran = [], dropped = [];
    const pending = await list({ state: 'pending' });
    for (const j of pending) if (j.expire != null && j.expire < ms){ const r = await mark(j.id, 'dropped', 'core', 'expired'); if (r) dropped.push({ job: r, why: 'expired' }); }
    const due = pending.filter(j => j.at <= ms && !(j.expire != null && j.expire < ms)).sort((a, b) => a.at - b.at || (a.made || 0) - (b.made || 0));
    const batch = due.map(j => clone(j));
    for (const j of due.slice(0, cap)){
      const fn = handlers.get(j.owner);
      if (!fn || inflight.has(j.id)) continue;
      inflight.add(j.id);
      try {
        const fresh = await get(j.id); if (!fresh || fresh.state !== 'pending' || fresh.at > ms) continue;
        const wall = Date.now();
        if (fresh.claimed && fresh.claimed.by !== ME && wall - (Number(fresh.claimed.wall) || 0) < CLAIM_MS) continue;
        const cl = await records.commit(JOB_TYPE, Object.assign({}, fresh, { claimed: { by: ME, at: ms, wall }, rev: (Number(fresh.rev) || 0) + 1 }), { writer: String(fresh.writer || 'core'), app: 'job' });
        if (!cl.ok) continue;   // another page claimed it first
        // two pages may both pass the rev check on a store with no transaction: wait a moment and read the claim back;
        // the claim that stands runs the job
        if (typeof setTimeout === 'function') await new Promise(res => setTimeout(res, 30));
        const back = await get(j.id); if (!back || back.state !== 'pending' || !back.claimed || back.claimed.by !== ME) continue;
        let r;
        try { r = await fn(clone(cl.record), { t: ms, late: Math.max(0, ms - fresh.at), batch }); }
        catch(e){
          console.error(e);
          const now2 = await get(j.id) || cl.record, tries = (Number(now2.tries) || 0) + 1;
          if (tries > RETRY.length){ const d = await mark(j.id, 'dropped', 'core', 'failed'); if (d) dropped.push({ job: d, why: 'failed' }); }
          else { await records.commit(JOB_TYPE, Object.assign({}, now2, { tries, claimed: null, rev: (Number(now2.rev) || 0) + 1 }), { writer: 'core', app: 'job' }); await move(j.id, ms + RETRY[tries - 1] * 60000, 'core'); }
          continue;
        }
        if (r === 'wait'){ const w2 = await get(j.id); if (w2 && w2.state === 'pending') await records.commit(JOB_TYPE, Object.assign({}, w2, { claimed: null, rev: (Number(w2.rev) || 0) + 1 }), { writer: 'core', app: 'job' }); continue; }
        if (r === 'drop' || (r && r.drop)){ const d = await mark(j.id, 'dropped', j.owner, r.drop || 'owner'); if (d) dropped.push({ job: d, why: r.drop || 'owner' }); }
        else if (r && isFinite(Number(r.at)) && Number(r.at) > ms) await move(j.id, Number(r.at), j.owner);
        else { const d = await mark(j.id, 'done', j.owner); if (d) ran.push(d); }
      } finally { inflight.delete(j.id); }
    }
    return { ran, dropped, waiting: Math.max(0, due.length - cap) };
  })().finally(() => { round = null; });
  return round;
}
// the soonest time any pending job is due (or expires), or null: the clock skips rounds until then
async function next(){
  let t = null;
  for (const j of await list({ state: 'pending' })) for (const x of [j.at, j.expire]) if (x != null && isFinite(x) && (t == null || x < t)) t = x;
  return t;
}
// ended jobs older than `days` (default 14) are removed from his folder: they did their work
async function prune(days = 14){
  const before = now().getTime() - days * 864e5; let n = 0;
  for (const j of await list()) if (j.state !== 'pending' && (j.ended || j.at) < before){ try { await records.remove(JOB_TYPE, j.id); n++; } catch {} }
  return n;
}
const jobs = { add, get, list, due, cancel: id => mark(id, 'dropped', 'her'), done: (id, writer) => mark(id, 'done', writer), drop: (id, writer, why) => mark(id, 'dropped', writer, why),
  move, handle, run, next, prune, get owners(){ return [...handlers.keys()]; }, STATES: STATES.slice() };

// --- the bell: how a due job reaches her (a named seam) ------------------------------------------------------
// ring(note) with note = { title, line, app?, job?, at?, tag? }: the core emits `bell` with it, and calls the host's
// ringer when one is set. The page shows it as an in-page notice (a toast; the system notification only if she
// already allowed it, as watch's notify). A native shell can set a ringer that posts a local notification
// while the phone is locked. The bell decides nothing (whether to ring is the scheduler's and her settings').
let ringer = null;
const bell = {
  set(fn){ ringer = typeof fn === 'function' ? fn : null; return !!ringer; },
  async ring(note){
    const n = Object.assign({ at: now().getTime() }, clone(note || {}));
    if (!n.line && !n.title) throw new Error('铃声需要一句话');
    emit('bell', n);
    if (ringer){ try { await ringer(n); } catch(e){ console.error(e); } }
    return n;
  },
  get host(){ return !!ringer; },
};

Object.assign(core, { JOB_TYPE, jobs, bell });
})(globalThis[Symbol.for('modu.core')]);
// app/core/day.js: his day record: what he does today, slot by slot, written ahead and shown only as each slot's time comes.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { clone, now, isoDay, records } = core;

// day/<YYYY-MM-DD>.json in his folder (records are one folder deep):
//   { v, id = day, day, slots: [{ at, until, where, doing, why, busy, kind, mood }], her: [{ at, app, line, what }],
//     entry (his evening line about the day, '' until written), hints? ([{ key, line }]: known, never said),
//     writer, rev, at }
// `slots` are written ahead (one sketch a day) and are hidden until their time: every read for her or
// for his prompt goes through visible(day, t), which keeps only the slots that have begun. `kind` is one
// of the doings an app offered (takes and offers) or '' for an ordinary slot; a past slot of an
// offered kind is handed to the apps that take it. `her` is her part of the day, from each app's today(day)
// hook (and the event log), never by a model call. `mood` is the slot's mood word; `what` an
// app's own short kind for a line of hers. A slot may carry `said` (his own words in chat
// that set it: a plan he stated for that time), only when there are some. life.js also keeps `from` ('sketch' | 'skeleton'), `aged` (ms: told to
// the memory source) and `line` (a skeleton day's one-liner); a reader keeps fields it does not know. The sketch,
// the status, her part, the evening and the age-out are app/life.js's.
const DAY_TYPE = 'day', DAY_ID = /^\d{4}-\d{2}-\d{2}$/;
function dayShape(r){
  r = r && typeof r === 'object' ? r : {};
  const slot = s => ({ at: Number(s.at) || 0, until: Number(s.until) || 0, where: String(s.where || ''), doing: String(s.doing || ''), why: String(s.why || ''), busy: s.busy === true, kind: String(s.kind || ''), mood: String(s.mood || ''), ...(s.said ? { said: String(s.said) } : {}) });
  return Object.assign({}, r, { v: r.v || 1, day: String(r.day || r.id || ''), slots: [].concat(r.slots || []).filter(s => s && typeof s === 'object').map(slot).sort((a, b) => a.at - b.at),
    her: [].concat(r.her || []).filter(h => h && h.line).map(h => ({ at: Number(h.at) || 0, app: String(h.app || ''), line: String(h.line), what: String(h.what || '') })),
    entry: String(r.entry || ''), hints: [].concat(r.hints || []).filter(h => h && h.line) });
}
// pure: the record as it may be seen at time t: slots that have not begun are left out
function visible(rec, t){
  const r = dayShape(rec), ms = t == null ? now().getTime() : +t;
  r.slots = r.slots.filter(s => s.at <= ms);
  return r;
}
// pure: the slot he is in at time t, or null
function slotAt(rec, t){ const ms = +t; return dayShape(rec).slots.filter(s => s.at <= ms && (!s.until || ms < s.until)).pop() || null; }
const day = {
  // → the record (whole, slots ahead included: for the scheduler and his prompt-side code; draw only visible()) or null
  async get(d){ d = d || isoDay(now()); if (!DAY_ID.test(d)) throw new Error(`日期「${d}」无法使用`); try { const r = await records.get(DAY_TYPE, d); return r ? dayShape(r) : null; } catch { return null; } },
  // writes it with the header (first writer wins on a rev clash) → { ok, record }
  async put(rec, o = {}){
    const r = dayShape(rec); if (!DAY_ID.test(r.day)) throw new Error(`日期「${r.day}」无法使用`);
    return records.commit(DAY_TYPE, Object.assign(r, { id: r.day, at: Number(rec.at) || new Date(r.day + 'T00:00').getTime() }), { writer: o.writer || rec.writer || 'life', app: 'life' });
  },
  visible, slotAt, shape: dayShape, TYPE: DAY_TYPE,
};

Object.assign(core, { DAY_TYPE, day });
})(globalThis[Symbol.for('modu.core')]);
// app/core/memory-source.js: the memory source: where his memory block comes from: Modu's own engine by default, or her own (an outside agent, another tool).
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { store, clone, now } = core;

// Modu's memory is a replaceable default. A source is plain text out and events in:
//   { id, recall({ recent, status, budget }) → text (or a Promise of it), tell?(event) }
//   recent: her and his last messages [{ who: 'her' | 'him', text, at }]; status: personaState(); budget: characters;
//   companion: { id, name } (whose memory: one outside memory may serve several companions; also on every event).
//   A recall that fails or takes longer than the knob memory.recall_timeout_ms (default 4000) counts as none this
//   turn: Modu's own block is used instead, and it is logged.
//   The text is placed where the memory block goes, as it comes. '' = nothing to say this turn.
//   event = { kind: 'chat' | 'day' | 'app' | 'absence', at, … }: chat { msgs: [{ who, text, at }] } after each turn;
//   day { day, record } when a day ages out; app { app, line } for an app moment worth keeping; absence { from, to, days }.
// Nothing here assumes files, YAML, scores or fading: those are Modu's own engine's business, behind the seam.
// Modu's own source is the default: its engine (memory-engine.js: fading, threads, BM25, age-out, facts) builds
// the memory block itself and takes the same events; `memorySource.own` is that engine.
const companion = () => ({ id: core.currentId || '', name: store.name || '' });
const MODU = Object.freeze({ id: 'modu', recall: o => core.memoryOwn ? core.memoryOwn.recall(o) : null, tell: e => core.memoryOwn ? core.memoryOwn.tell(e) : undefined });
let source = MODU;
const LATE = Symbol('late');
core.recalled = null;   // { key, text }: the last recall of an outside source, for the synchronous memory block
const memorySource = {
  // use(source) → its id; use(null) puts Modu's own back. A source without recall is refused.
  use(s){
    if (s == null){ source = MODU; core.recalled = null; return source.id; }
    if (typeof s !== 'object' || typeof s.recall !== 'function') throw new Error('记忆来源需要 recall');
    source = Object.freeze({ id: String(s.id || 'outside'), recall: s.recall.bind(s), tell: typeof s.tell === 'function' ? s.tell.bind(s) : () => {},
      url: /^https?:\/\//.test(String(s.url || '')) ? String(s.url) : '' });
    core.recalled = null; return source.id;
  },
  get id(){ return source.id; },
  get outside(){ return source !== MODU; },
  // for the 记忆 page: where her own memory can be read and edited (an http(s) address the source gives as `url`), and
  // the text its last recall gave (what 记忆 shows, "the few he recalled lately")
  get link(){ return source.url || ''; },
  get last(){ return source !== MODU && core.recalled ? core.recalled.text : ''; },
  async recall(o = {}){ const v = await source.recall(Object.assign({ companion: companion() }, clone(o))); return v == null ? null : String(v); },
  async tell(e){ if (!e || typeof e !== 'object' || !e.kind) return false; try { await source.tell(Object.assign({ at: now().getTime(), companion: companion() }, clone(e))); return true; } catch(err){ console.error(err); return false; } },
};
// before a turn (refreshLife waits for it): an outside source is asked once, so the block can be built synchronously
let asked = '';   // what the last recall was asked for (the companion and the chat's length): asked again only when it moves
async function readRecall(){
  if (!memorySource.outside || !store.name){
    core.recalled = null; asked = '';
    if (store.name && core.memoryOwn){ try { await core.memoryOwn.prepare(); } catch(e){ console.error(e); } }   // Modu's own: waiting days, the tidy, meaning search
    return;
  }
  const key = core.lifeKey(), at = source.id + '|' + key + '|' + store.msgs.length;
  if (at === asked && core.recalled && core.recalled.key === key) return;
  asked = at;
  const recent = store.msgs.filter(m => !(core.chatCardKind && core.chatCardKind(m))).slice(-8).map(m => ({ who: m.is_user ? 'her' : 'him', text: String(m.mes || ''), at: (core.msgDate(m) || now()).getTime() }));
  let text = null, timer = null;
  const ms = Math.max(100, Number(core.param ? core.param('memory.recall_timeout_ms', 4000) : 4000) || 4000);
  const late = new Promise(res => { timer = setTimeout(() => res(LATE), ms); });
  try { text = await Promise.race([memorySource.recall({ recent, status: core.personaState(), budget: 3500 }), late]); }
  catch(e){ console.warn(`memory source ${source.id}: recall failed, Modu's own memory this turn`, e); text = null; core.emit('memorysource', { ok: false, id: source.id }); }
  finally { clearTimeout(timer); }
  if (text === LATE){ console.warn(`memory source ${source.id}: no answer in ${ms} ms, Modu's own memory this turn`); text = null; asked = ''; core.emit('memorysource', { ok: false, id: source.id, late: true }); }
  core.recalled = text == null ? null : { key, text };
}

Object.assign(core, { memorySource, readRecall });
})(globalThis[Symbol.for('modu.core')]);
// app/core/prompts.js: side-call prompts: the text of every side call lives in app/prompts/<name>.txt, never in code.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { hostFetch } = core;

// app/prompts/<name>.txt: leading lines that start with "# " are the header, never sent: `# <name> v<n>` (or
// `# version: <v>`) and `# vars: a, b` (the vars it reads); then the prompt. {{var}} is
// filled from vars ({{char}}, {{user}}, anything the caller passes); an unknown {{var}} stays as written.
// prompt(name, vars) fetches the file once (through the host's fetch, so it works in the page and headless) and
// keeps it; a missing file (or no fetch) falls back to the built-in text given with prompts.fallback(name, text),
// else ''. Never throws for a missing prompt.
const NAME = /^[a-z][a-z0-9_-]{0,63}$/;
const cache = new Map(), fallbacks = new Map();
// where app/prompts/ is: beside core.js in a page (its own script address), else 'prompts/'; a host or test sets it
let base = (() => {
  try {
    const s = typeof document !== 'undefined' && document.currentScript && document.currentScript.src;
    if (s) return new URL(/\/core\/[^/]+\.js(\?.*)?$/.test(s) ? '../prompts/' : 'prompts/', s).href;
  } catch {}
  return 'prompts/';
})();
function parsePrompt(text){
  const lines = String(text == null ? '' : text).replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n');
  let version = '', vars = [], i = 0;
  for (; i < lines.length && /^#(\s|$)/.test(lines[i]); i++){
    const h = lines[i].replace(/^#\s*/, ''); let m;
    if ((m = h.match(/^version\s*:\s*(.*)$/i))) version = m[1].trim();
    else if ((m = h.match(/^vars\s*:\s*(.*)$/i))) vars = m[1].split(/[,，\s]+/).filter(Boolean);
    else if (!version && (m = h.match(/^\S+\s+v(\S+)\s*$/))) version = m[1];
  }
  return { version, vars, text: lines.slice(i).join('\n').replace(/\s+$/, '') };
}
function fill(text, vars){ const v = vars || {}; return text.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (all, k) => Object.prototype.hasOwnProperty.call(v, k) && v[k] != null ? String(v[k]) : all); }
async function load(name){
  if (!NAME.test(String(name))) throw new Error(`提示「${name}」无法使用`);
  if (cache.has(name)) return cache.get(name);
  let p = null;
  try { const r = await hostFetch(base + name + '.txt'); if (r && r.ok) p = Object.assign(parsePrompt(await r.text()), { from: 'file' }); } catch {}
  if (!p) p = fallbacks.has(name) ? Object.assign(parsePrompt(fallbacks.get(name)), { from: 'fallback' }) : { version: '', vars: [], text: '', from: 'none' };
  if (p.from === 'file') cache.set(name, p);
  return p;
}
async function prompt(name, vars){ return fill((await load(name)).text, vars); }
const prompts = {
  base(url){ if (url != null){ base = String(url); if (base && !base.endsWith('/')) base += '/'; cache.clear(); } return base; },
  fallback(name, text){ if (!NAME.test(String(name))) throw new Error(`提示「${name}」无法使用`); fallbacks.set(name, String(text)); cache.delete(name); },
  // → { version, vars, text, from: 'file' | 'fallback' | 'none' }, unfilled
  info: load,
  parse: parsePrompt, fill,
  forget(){ cache.clear(); },
};

Object.assign(core, { prompt, prompts });
})(globalThis[Symbol.for('modu.core')]);
// app/core/layers.js: the layer list: which part of his prompt comes from where (Modu, her card, a card folder, or Modu's default filling in).
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { store } = core;

// One prompt, built from layers, top to bottom. A layer the card brings is used; a layer it lacks is filled from
// Modu's own default; base rules and his life, status and memory are always Modu's.
//   [{ layer, source, name }]  layer: 'base' | 'preset' | 'card' | 'lore' | 'life' | 'chat' | 'regex-prompt' | 'regex-display'
//   source: 'modu' (always ours) | 'hers' (inside the card she brought) | 'card-folder' (a file beside the card in
//   the folder she brought: preset.json, a 世界书 .json, regex .json, contacts.json) | 'default' (Modu's, filling in)
// A card folder is imported like any card, with no name checks. What came beside the card is kept on the store as
// store.cardFolder = { preset?: { name }, lore?: [{ name }], regex?: [{ name, placement: 'prompt' | 'display' }],
// contacts?: { name } } (the import fills it; nothing in Modu edits those files). The list only says where each
// layer comes from, from what the store holds; preset.js and regex.js use them.
const LAYERS = ['base', 'preset', 'card', 'lore', 'life', 'chat', 'regex-prompt', 'regex-display'];
function layers(){
  const card = store.card || null, ext = (card && card.extensions) || {}, modu = ext.modu || {}, f = store.cardFolder || {};
  const regex = [].concat(ext.regex_scripts || []), fRegex = [].concat(f.regex || []);
  const regexFor = place => {
    const mine = fRegex.filter(r => (r.placement || 'display') === place);
    if (mine.length) return { source: 'card-folder', name: mine.map(r => r.name || '').filter(Boolean).join(', ') || 'regex' };
    // 酒馆 regex: placement 1 = her input, 2 = his output; promptOnly / markdownOnly say which side it touches
    const ok = regex.filter(r => r && !r.disabled && (place === 'prompt' ? r.promptOnly || !r.markdownOnly : r.markdownOnly || !r.promptOnly));
    return ok.length ? { source: 'hers', name: ok.map(r => r.scriptName || '').filter(Boolean).join(', ') || 'regex' } : { source: 'default', name: 'Modu default' };
  };
  const lore = (card && card.character_book) || (modu.lore && modu.lore.length);
  return [
    { layer: 'base', source: 'modu', name: 'Modu base' },
    f.preset ? { layer: 'preset', source: 'card-folder', name: f.preset.name || 'preset' } : modu.preset ? { layer: 'preset', source: 'hers', name: modu.preset.name || 'preset' } : { layer: 'preset', source: 'default', name: 'Modu default' },
    card ? { layer: 'card', source: 'hers', name: card.name || store.name || '' } : { layer: 'card', source: 'default', name: store.name || '' },
    f.lore && f.lore.length ? { layer: 'lore', source: 'card-folder', name: f.lore.map(b => b.name || '').join(', ') } : lore ? { layer: 'lore', source: 'hers', name: (card.character_book && card.character_book.name) || 'lore' } : { layer: 'lore', source: 'default', name: 'Modu default' },
    { layer: 'life', source: 'modu', name: 'Modu' },
    { layer: 'chat', source: 'modu', name: 'chat.jsonl' },
    Object.assign({ layer: 'regex-prompt' }, regexFor('prompt')),
    Object.assign({ layer: 'regex-display' }, regexFor('display')),
  ];
}

Object.assign(core, { LAYERS, layers });
})(globalThis[Symbol.for('modu.core')]);
// app/core/preset.js: presets: her SillyTavern preset read as text blocks in her order, and Modu's own defaults (app/defaults/: preset, 世界书, regex) that fill a layer the card does not bring.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { store, hostFetch, listeners, clone } = core;

// --- Modu's defaults: app/defaults/preset.json, lorebook.json, regex.json ----------------------------------
// Read once through the host's fetch (the page and a headless host alike) from `defaults/` beside core.js; until
// they arrive (or where they cannot be read) the layer is simply empty. A host or a test sets the folder with
// moduDefaults.base(url). The prompt is built synchronously, so the files are read when a companion loads.
const DEFAULT_FILES = { preset: 'preset.json', lore: 'lorebook.json', regex: 'regex.json' };
let dBase = (() => {
  try {
    const s = typeof document !== 'undefined' && document.currentScript && document.currentScript.src;
    if (s) return new URL(/\/core\/[^/]+\.js(\?.*)?$/.test(s) ? '../defaults/' : 'defaults/', s).href;
  } catch {}
  return 'defaults/';
})();
const dflt = { preset: null, lore: null, regex: null }; let dRead = null;
function readDefaults(){
  if (dRead) return dRead;
  dRead = (async () => {
    for (const [k, f] of Object.entries(DEFAULT_FILES)){
      try { const r = await hostFetch(dBase + f); if (r && r.ok) dflt[k] = JSON.parse(await r.text()); } catch { dflt[k] = null; }
    }
  })();
  return dRead;
}
listeners.add(ev => { if (ev === 'loaded') core.defaultsRead = readDefaults(); });
core.defaultsRead = Promise.resolve();
const moduDefaults = {
  base(url){ if (url != null){ dBase = String(url); if (dBase && !dBase.endsWith('/')) dBase += '/'; dRead = null; dflt.preset = dflt.lore = dflt.regex = null; } return dBase; },
  read(){ core.defaultsRead = readDefaults(); return core.defaultsRead; },
  // → { preset, lore, regex } as read (copies; null where missing)
  get(){ return clone(dflt); },
  raw: dflt,
};

// --- A SillyTavern preset (chat completion): its text blocks in her order --------------------------------------
// prompts: [{ identifier, name, role, content, system_prompt?, marker?, enabled? }]; prompt_order: [{ character_id,
// order: [{ identifier, enabled }] }] (the global order is character_id 100001; else the longest). A marker (chat
// history, the card's fields, 世界书 placement) has no text of its own: Modu fills those places itself. Blocks after the
// chat-history marker are hers to come after the chat. Sampling (temperature, top_p, …) is never applied: it is kept
// as suggestions only (her model settings decide). → { name, blocks: [{ id, name, role, text, on, after }], sampling,
// markers } or null for something that is not a preset.
const SAMPLING = ['temperature', 'top_p', 'top_k', 'top_a', 'min_p', 'frequency_penalty', 'presence_penalty', 'repetition_penalty', 'openai_max_tokens', 'openai_max_context', 'max_tokens', 'seed'];
function parsePreset(j){
  if (!j || typeof j !== 'object' || !Array.isArray(j.prompts)) return null;
  const byId = new Map(j.prompts.filter(p => p && p.identifier).map(p => [String(p.identifier), p]));
  const orders = [].concat(j.prompt_order || []).filter(o => o && Array.isArray(o.order));
  const ord = orders.find(o => Number(o.character_id) === 100001) || orders.sort((a, b) => b.order.length - a.order.length)[0];
  const seq = ord ? ord.order.map(o => ({ id: String(o.identifier), on: o.enabled !== false })) : j.prompts.filter(p => p && p.identifier).map(p => ({ id: String(p.identifier), on: p.enabled !== false }));
  const blocks = [], markers = []; let after = false;
  for (const s of seq){
    const p = byId.get(s.id); if (!p) continue;
    if (s.id === 'chatHistory'){ after = true; markers.push(s.id); continue; }
    const text = typeof p.content === 'string' ? p.content.trim() : '';
    if (p.marker || !text){ markers.push(s.id); continue; }
    blocks.push({ id: s.id, name: String(p.name || s.id), role: p.role === 'user' || p.role === 'assistant' ? p.role : 'system', text, on: s.on && p.enabled !== false, after });
  }
  const sampling = {}; for (const k of SAMPLING) if (j[k] != null && typeof j[k] !== 'object') sampling[k] = j[k];
  return { name: String(j.name || j.preset_name || ''), blocks, sampling, markers };
}
// The preset layer for the open companion: a preset beside the card in the folder she brought (card-folder), the
// card's own (extensions.modu.preset, hers), else Modu's default. → { source, name, preset, mine } (preset null until read)
// `mine` is true only for a preset she added herself later (搬家, addBesideCard: card_folder.preset.by 'her').
// Only that one has switches (presetSwitch), kept as her record preset/switches.json = { blocks: { id: on } }; a card's own
// preset (in its folder or inside the card) is the card's settings: never switched, and 设置 does not list its blocks.
const switches = { key: '', blocks: {} };
async function readSwitches(){
  const key = core.cardKey ? core.cardKey() : '';
  let r = null; try { r = await core.records.get('preset', 'switches'); } catch {}
  switches.key = key; switches.blocks = r && r.blocks && typeof r.blocks === 'object' ? Object.assign({}, r.blocks) : {};
}
listeners.add(ev => { if (ev === 'loaded') core.switchesRead = readSwitches().catch(() => {}); });
core.switchesRead = Promise.resolve();
function presetLayer(){
  const f = core.folderData || null, cf = store.cardFolder && store.cardFolder.preset;
  if (f && f.preset){
    const mine = !!(cf && cf.by === 'her'), on = mine && core.cardKey && switches.key === core.cardKey() ? switches.blocks : {};
    const preset = mine ? Object.assign({}, f.preset, { blocks: f.preset.blocks.map(b => b.id in on ? Object.assign({}, b, { on: !!on[b.id] }) : b) }) : f.preset;
    return { source: 'card-folder', name: (cf && cf.name) || f.preset.name || 'preset', preset, mine };
  }
  const own = store.card && store.card.extensions && store.card.extensions.modu && parsePreset(store.card.extensions.modu.preset);
  if (own) return { source: 'hers', name: own.name || 'preset', preset: own, mine: false };
  const d = parsePreset(dflt.preset);
  return { source: 'default', name: 'Modu default', preset: d, mine: false };
}
// one block of her own preset on or off → true; false for anything else (a card's preset, Modu's, a block it lacks)
async function presetSwitch(id, on){
  const P = presetLayer(); id = String(id);
  if (!P.mine || !P.preset || !P.preset.blocks.some(b => b.id === id)) return false;
  const key = core.cardKey ? core.cardKey() : '';
  if (switches.key !== key) { switches.key = key; switches.blocks = {}; }
  switches.blocks = Object.assign({}, switches.blocks, { [id]: !!on });
  await core.records.commit('preset', { id: 'switches', blocks: switches.blocks, at: core.now().getTime() }, { writer: 'her', app: 'preset' });
  return true;
}

Object.assign(core, { moduDefaults, parsePreset, presetLayer, presetSwitch, readDefaults });
})(globalThis[Symbol.for('modu.core')]);
// app/core/regex.js: regex: SillyTavern regex scripts run on the prompt side and the display side, guarded, never on the stored chat.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { store } = core;

// 酒馆 regex scripts: { scriptName, findRegex ('/pattern/flags'), replaceString ({{match}}, $1 …), trimStrings,
// placement ([1] her message, [2] his reply), disabled, markdownOnly (display), promptOnly (prompt), minDepth, maxDepth }.
// A script with neither flag would change the stored chat in 酒馆; Modu never changes the stored chat (chat.jsonl
// stays as it is), so such a script runs on both sides instead. Which scripts: the regex beside the card in the folder
// she brought, else the card's own (extensions.regex_scripts), else Modu's default (app/defaults/regex.json).
// Guarded. A regex cannot be stopped once it runs on the page's own thread, so a pattern from a card or from her
// never runs there before it has been tried where it can be stopped:
//   1. a plain screen of the pattern's text refuses what can run away (a quantified group holding a quantifier; a
//      quantified choice whose branches repeat, nest as prefixes, or include '.' beside another character; a
//      back-reference with a quantifier; over 2,000 characters);
//   2. the rest is tried once in a Worker (the browser's own sandbox) on runs of its own characters, and the Worker is
//      terminated after VET_MS: a pattern that does not finish is stopped for good. The verdict is kept per pattern.
//      The Worker is started first and the time limit counts from when it says it is ready (starting
//      a Worker on a slow phone can take longer than any pattern); at most VET_LANES Workers at a time, each trying one
//      pattern after another and started again only after one that ran out of time; a slow device (the Worker's own
//      reference run is slow) gets more time, up to VET_MAX; and a pattern that ran out of time is tried once more, with
//      twice the time, before it is called slow. A 世界书 key written as /pattern/ is screened and tried the same way. Where
//      there is no Worker (a headless host) a host may give its own sandbox with regex.vetWith(fn); with none, a card's
//      pattern is skipped (never run), Modu's own default scripts still run;
//   3. until its verdict is in, a new pattern is skipped (its message shows as it is), never waited for;
//   4. a text longer than MAX_TEXT is not run at all; a script whose run takes over SLOW_MS twice is stopped for the visit
//      (once can be a pause of the phone's own), one whose single run takes over CALL_MS at once (never a second
//      freeze); a call stops after CALL_MS.
// Display output is text only: markup a script writes is taken out (a <br> becomes a new line); the two markers
// ⟦face:x⟧ / ⟦sticker:x⟧ are the only things the chat view draws from it.
const MAX_TEXT = 20000, SLOW_MS = 20, CALL_MS = 60, VET_MS = 250, VET_MAX = 3000, VET_LANES = 2, VET_START_MS = 15000;
const stopped = new Map();   // script key → why (for 设置 and the tests)
const strikes = new Map();   // script key → its runs over SLOW_MS so far
const clock = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
// the branches of each quantified group: `(a|b)*`, `(?:a|b)+`, `(?<n>a|b){2,}`, innermost groups only
function quantifiedChoices(s){
  const out = [], re = /\((?:\?(?::|<[A-Za-z_]\w*>|=|!|<=|<!))?((?:\\.|\[(?:\\.|[^\]])*\]|[^()\\[])*)\)\s*(?:[+*]|\{\d*,\d*\})/g;
  let m; while ((m = re.exec(s))){
    const body = m[1], br = []; let cur = '', depth = 0;
    for (let i = 0; i < body.length; i++){ const c = body[i];
      if (c === '\\'){ cur += c + (body[i + 1] || ''); i++; continue; }
      if (c === '[') depth++; else if (c === ']') depth = Math.max(0, depth - 1);
      if (c === '|' && !depth){ br.push(cur); cur = ''; } else cur += c; }
    br.push(cur); if (br.length > 1) out.push(br);
  }
  return out;
}
// → a reason it may run away, or '' (a plain screen of the pattern's text, before anything runs)
function regexRisk(src){
  const s = String(src || '');
  if (s.length > 2000) return 'long';
  // strip escapes and character classes, group openers' ?: / ?<name>, then look for a quantified group holding a quantifier
  const flat = s.replace(/\\./g, 'x').replace(/\[[^\]]*\]/g, 'x').replace(/\(\?(?::|<[A-Za-z_]\w*>|=|!|<=|<!)/g, '(');
  if (/\((?:[^()]*[+*]|[^()]*\{\d*,\d*\})[^()]*\)\s*(?:[+*]|\{\d*,\d*\})/.test(flat)) return 'nested';
  for (const br of quantifiedChoices(s)){
    if (new Set(br).size < br.length) return 'overlap';                                             // (a|a)*
    if (br.some((x, i) => br.some((y, j) => i !== j && x && y.startsWith(x)))) return 'overlap';     // (a|ab)*
    if (br.includes('.') && br.some(x => x !== '.' && !/^\\[nr]$/.test(x))) return 'overlap';       // (.|a)*; (.|\n)* is fine
  }
  if (/\\\d/.test(s) && /[+*}]/.test(s)) return 'backref';
  return '';
}
// what a new pattern is tried on: runs of the characters it names (and a few common ones), short and long, each ending
// in a character it will not expect, and pairs of them
function vetInputs(src){
  const chars = ['a', '1', ' ', 'x', '。', '\n', '<', '*'];
  for (const ch of String(src).replace(/\\[dDwWsSbBnrt]/g, '').replace(/[\\^$.*+?()[\]{}|,-]/g, '')) { if (chars.length >= 16) break; if (!chars.includes(ch)) chars.push(ch); }
  const out = [];
  for (const c of chars) for (const n of [30, 400, 3000]) out.push(c.repeat(n) + '\u0001');
  for (let i = 0; i + 1 < chars.length && i < 8; i++) out.push((chars[i] + chars[i + 1]).repeat(30) + '\u0001');
  return out;
}
const verdicts = new Map(), pending = new Map();
let vetter = null, workerURL = '';
// the browser's sandbox: up to VET_LANES Workers, each reused for one pattern after another. A Worker first runs a
// reference pattern and says how long that took ('ready'); the time limit starts then, never while it starts up, and is the
// reference time × VET_SCALE when that is more than VET_MS (a slow device gets more time, up to VET_MAX), times ms / VET_MS
// (the retry's twice is twice that scaled time). A Worker that runs out of time is terminated (a regex cannot be stopped any
// other way); the next pattern gets a fresh one.
// → '' (fine) | 'slow' | 'broken' | 'no-sandbox'
const VET_SCALE = 40;
const WORKER_SRC = "const ref = () => { const r = /\\[N(.*?)\\]/g, t0 = performance.now(); for (const c of ['a', ' ', '\\u3002']) for (const n of [30, 400, 3000]) (c.repeat(n) + '\\u0001').replace(r, ''); return performance.now() - t0; };"
  + " postMessage({ ready: ref() }); onmessage = e => { const d = e.data; try { const r = new RegExp(d.src, d.flags); for (const s of d.inputs){ r.lastIndex = 0; s.replace(r, ''); } postMessage({ v: '' }); } catch (x) { postMessage({ v: 'broken' }); } };";
// the time a pattern gets in a Worker whose reference run took `ref` ms, on a try given `ms` (VET_MS, or twice it on the retry)
const vetTime = (ref, ms) => Math.min(VET_MAX, Math.max(VET_MS, (Number(ref) || 0) * VET_SCALE)) * (ms / VET_MS);
const vetQueue = [], idleWorkers = []; let vetRunning = 0, idleTimer = null;
function startWorker(){
  return new Promise(res => {
    let w; try { w = new globalThis.Worker(workerURL); } catch { res(null); return; }
    const t = setTimeout(() => { try { w.terminate(); } catch {} res(null); }, VET_START_MS);
    w.onmessage = e => { clearTimeout(t); res({ w, ref: Number(e.data && e.data.ready) || 0 }); };
    w.onerror = () => { clearTimeout(t); try { w.terminate(); } catch {} res(null); };
  });
}
async function vetOne(job){
  const sb = idleWorkers.pop() || await startWorker();
  if (!sb) return 'no-sandbox';
  const ms = vetTime(sb.ref, job.ms);
  const v = await new Promise(res => {
    const t = setTimeout(() => res('slow'), ms);
    sb.w.onmessage = e => { clearTimeout(t); res(String((e.data && e.data.v) || '')); };
    sb.w.onerror = () => { clearTimeout(t); res('lost'); };
    sb.w.postMessage({ src: job.src, flags: job.flags, inputs: job.inputs });
  });
  if (v === 'slow' || v === 'lost'){ try { sb.w.terminate(); } catch {} return v === 'slow' ? 'slow' : 'broken'; }
  idleWorkers.push(sb);
  return v;
}
function pumpVet(){
  while (vetRunning < VET_LANES && vetQueue.length){
    const job = vetQueue.shift(); vetRunning++;
    vetOne(job).catch(() => 'broken').then(v => { vetRunning--; job.res(v); pumpVet(); });
  }
  // nothing left to try: the idle Workers are let go after a moment (a new card's patterns start new ones)
  clearTimeout(idleTimer);
  if (!vetQueue.length && !vetRunning) idleTimer = setTimeout(() => { if (!vetQueue.length && !vetRunning) for (const sb of idleWorkers.splice(0)) { try { sb.w.terminate(); } catch {} } }, 3000);
}
function workerVet(src, flags, inputs, ms){
  const W = globalThis.Worker, U = globalThis.URL;
  if (typeof W !== 'function' || typeof Blob === 'undefined' || !U || !U.createObjectURL) return Promise.resolve('no-sandbox');
  if (!workerURL) workerURL = U.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
  return new Promise(res => { vetQueue.push({ src, flags, inputs, ms, res }); pumpVet(); });
}
const patKey = (src, flags) => flags + '/' + src;
// → Promise<verdict> for one pattern (kept: a pattern is tried once per visit)
function vetPattern(src, flags){
  const k = patKey(src, flags);
  if (verdicts.has(k)) return Promise.resolve(verdicts.get(k));
  if (pending.has(k)) return pending.get(k);
  const inputs = vetInputs(src), f = String(flags || '').replace('y', '');
  const once = ms => Promise.resolve(vetter ? vetter(src, f, inputs, ms) : workerVet(src, f, inputs, ms)).catch(() => 'broken').then(v => String(v || ''));
  // a pattern that ran out of time gets one more try, with twice the time, before it is called slow
  const p = once(VET_MS).then(v => v === 'slow' ? once(VET_MS * 2) : v)
    .then(v => { verdicts.set(k, v); pending.delete(k); keyRes.delete(k); return v; });
  pending.set(k, p);
  return p;
}
// every script the layers would run now (a card folder's, the card's own); Modu's defaults are trusted. And
// every /regex/ key of his 世界书 (the card's own and those beside it)
function vetLayers(){
  const all = ['prompt', 'display'].map(regexLayer).filter(l => l.source !== 'default').flatMap(l => l.scripts);
  return Promise.all([vetScripts(all), Promise.all(loreRegexKeys().map(([src, f]) => regexRisk(src) ? 'refused' : vetPattern(src, f)))]).then(([a, b]) => a.concat(b));
}
// --- 世界书 keys written as /pattern/flags -------------------------------------------------------------------------
// They run on the page's own thread on every turn, so they are guarded as scripts are: screened, then tried in the
// sandbox; until the verdict is in (and for good when it says no) the key matches nothing. Compiled once per key.
const LORE_KEY = /^\/(.+)\/([a-z]*)$/, keyRes = new Map();
const keyFlags = f => String(f || '').replace(/[gy]/g, '');
function loreRegexKeys(){
  if (!core.cardLore || !store.card) return [];
  const out = new Map();
  for (const e of core.cardLore(store.card).all) for (const k of [].concat(e.keys || [], e.sec || [])){ const m = String(k).match(LORE_KEY); if (m) out.set(patKey(m[1], keyFlags(m[2])), [m[1], keyFlags(m[2])]); }
  return [...out.values()];
}
// → a RegExp to test the key with, or null (refused, broken, or not tried yet: then it is sent to the sandbox)
function loreKey(src, flags){
  const f = keyFlags(flags), k = patKey(src, f);
  if (keyRes.has(k)) return keyRes.get(k);
  if (regexRisk(src)){ keyRes.set(k, null); return null; }
  if (!verdicts.has(k)){ vetPattern(src, f); return null; }
  let re = null; if (!verdicts.get(k)) { try { re = new RegExp(src, f); } catch {} }
  keyRes.set(k, re); return re;
}
function vetScripts(scripts){
  return Promise.all([].concat(scripts || []).map(s => { const { re } = parseRegex(s.findRegex); return re ? vetPattern(re.source, re.flags) : Promise.resolve('refused'); }));
}
function parseRegex(find){
  const s = String(find || ''), m = s.match(/^\/([\s\S]+)\/([dgimsuvy]*)$/);
  const src = m ? m[1] : s, flags = m ? m[2] : 'g';
  if (!src) return { re: null, risk: 'empty' };
  const risk = regexRisk(src); if (risk) return { re: null, risk };
  try { return { re: new RegExp(src, flags), risk: '' }; } catch { return { re: null, risk: 'broken' }; }
}
const sideOf = s => s.markdownOnly && !s.promptOnly ? ['display'] : s.promptOnly && !s.markdownOnly ? ['prompt'] : ['prompt', 'display'];
const keyOf = s => String(s.id || s.scriptName || '') + '|' + String(s.findRegex || '');
// the scripts that run for one side; { source, name, scripts } with source 'card-folder' | 'hers' | 'default'
function regexLayer(side){
  const f = core.folderData || null;
  const pick = list => [].concat(list || []).filter(s => s && typeof s === 'object' && !s.disabled && s.findRegex && sideOf(s).includes(side));
  const fl = f ? pick(f.regex) : [];
  if (fl.length) return { source: 'card-folder', scripts: fl };
  const own = pick(store.card && store.card.extensions && store.card.extensions.regex_scripts);
  if (own.length) return { source: 'hers', scripts: own };
  const d = core.moduDefaults && core.moduDefaults.raw.regex;
  return { source: 'default', scripts: pick(d && (Array.isArray(d) ? d : d.scripts)) };
}
function expand(rep, args, vars){
  // replace() hands (match, p1 … pn, offset, string[, groups])
  const named = args[args.length - 1] && typeof args[args.length - 1] === 'object' ? args[args.length - 1] : null;
  const groups = args.slice(0, named ? -3 : -2);
  return String(rep).replace(/\{\{match\}\}/gi, '$&').replace(/\{\{(char|user)\}\}/gi, (a, k) => vars[k.toLowerCase()] || a)
    .replace(/\$(\$|&|\d{1,2}|<([^>]+)>)/g, (all, k, name) => k === '$' ? '$' : k === '&' ? groups[0] : name ? (named && named[name]) || '' : groups[Number(k)] != null ? groups[Number(k)] : '');
}
// o: { side ('prompt' | 'display'), who ('her' | 'him'), depth (0 = the newest message), scripts?, vars? }
function runRegex(text, o0 = {}){
  let o = o0;
  let t = String(text == null ? '' : text);
  if (t.length > MAX_TEXT) return t;
  const side = o.side === 'prompt' ? 'prompt' : 'display', place = o.who === 'her' ? 1 : 2;
  const layer = o.scripts ? null : regexLayer(side), scripts = o.scripts || layer.scripts;
  if (layer && layer.source === 'default') o = Object.assign({}, o, { trusted: true });
  const vars = Object.assign({ char: store.name || '', user: core.userName() }, o.vars);
  const began = clock();
  for (const s of scripts){
    if (clock() - began > CALL_MS) break;
    const key = keyOf(s); if (stopped.has(key)) continue;
    const pl = [].concat(s.placement == null ? [1, 2] : s.placement).map(Number);
    if (!pl.includes(place)) continue;
    if (o.depth != null && ((s.minDepth != null && s.minDepth !== '' && o.depth < Number(s.minDepth)) || (s.maxDepth != null && s.maxDepth !== '' && o.depth > Number(s.maxDepth)))) continue;
    const { re, risk } = parseRegex(s.findRegex);
    if (!re){ if (risk && risk !== 'empty' && risk !== 'broken') stopped.set(key, risk); continue; }
    // a card's or her pattern runs only once its verdict says so (Modu's own default scripts are trusted)
    if (!o.trusted){
      const k = patKey(re.source, re.flags);
      if (!verdicts.has(k)){ vetPattern(re.source, re.flags); continue; }
      const v = verdicts.get(k); if (v){ stopped.set(key, v); continue; }
    }
    const trims = [].concat(s.trimStrings || []).map(String).filter(Boolean);
    const t0 = clock();
    let out;
    try { out = t.replace(re, (...args) => { let m = args[0]; for (const x of trims) m = m.split(x).join(''); return expand(s.replaceString || '', [m].concat(args.slice(1)), vars); }); }
    catch { continue; }
    const took = clock() - t0;
    if (took > CALL_MS){ stopped.set(key, 'slow'); continue; }   // one run that long is never run again
    if (took > SLOW_MS){ const n = (strikes.get(key) || 0) + 1; strikes.set(key, n); if (n >= 2){ stopped.set(key, 'slow'); continue; } }
    t = out;
  }
  return side === 'display' ? textOnly(t) : t;
}
// the display side gives text, never markup: tags are taken out (their text stays), <br> becomes a new line
function textOnly(t){
  return String(t).replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\s*(script|style|iframe|object)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\/?[A-Za-z][^<>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
// the markers the display side may write: → { text (markers out), face, stickers }
function displayMarkers(t){
  let face = '', stickers = [];
  const text = String(t || '').replace(/⟦face:([^⟧]{1,24})⟧/g, (a, x) => { face = face || x; return ''; }).replace(/⟦sticker:([\w一-鿿-]{1,24})⟧/g, (a, x) => { stickers.push(x); return ''; }).replace(/⟦[^⟧]*⟧/g, '');
  return { text: text.replace(/[ \t]+\n/g, '\n').trim(), face, stickers };
}
const regex = {
  // her prompt-side text: what the model is sent (the stored chat never changes)
  prompt: (text, o = {}) => runRegex(text, Object.assign({}, o, { side: 'prompt' })),
  // what the screen shows for one message: text only, with the display markers
  display: (text, o = {}) => runRegex(text, Object.assign({}, o, { side: 'display' })),
  markers: displayMarkers,
  run: runRegex, risk: regexRisk, parse: parseRegex, layer: regexLayer,
  // the sandbox: try the open companion's scripts (or the given ones) now; → Promise<[verdict]>
  vetAll: vetLayers, vet: vetScripts,
  // a host with no Worker gives its own: fn(src, flags, inputs, ms) → Promise<'' | 'slow' | 'broken'> (null: none)
  vetWith(fn){ vetter = typeof fn === 'function' ? fn : null; verdicts.clear(); pending.clear(); stopped.clear(); strikes.clear(); keyRes.clear(); },
  verdict(find){ const { re, risk } = parseRegex(find); return re ? (verdicts.has(patKey(re.source, re.flags)) ? verdicts.get(patKey(re.source, re.flags)) : null) : risk; },
  // → [{ key, why }] the scripts stopped in this visit ('slow', 'nested', 'overlap', 'backref', 'long', 'no-sandbox', 'broken')
  stopped(){ return [...stopped].map(([key, why]) => ({ key, why })); },
  forget(){ stopped.clear(); verdicts.clear(); pending.clear(); strikes.clear(); keyRes.clear(); },
  // a 世界书 /regex/ key, guarded as a script is → RegExp | null (refused, or its verdict not in yet)
  loreKey,
  // the time a pattern gets in the sandbox (Worker reference run `ref` ms, try `ms`)
  vetTime,
  MAX_TEXT, SLOW_MS, CALL_MS, VET_MS, VET_MAX, VET_LANES,
};

Object.assign(core, { regex });
})(globalThis[Symbol.for('modu.core')]);
// app/core/cards.js: cards: what came beside the card in its folder, calibration into params.json, chapters from alternate greetings, the card as it came back out, the parts never used here, his pronoun read from the card, and the facts "current state".
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, store, clone, clip, now, readText, readBlob, writeFile, listeners, records, params, PARAMS_FORMAT, pronouns, appendToChat } = core;

// --- A card folder: preset.json, regex .json, 世界书 .json, contacts.json, params.json beside the card ----------
// The import keeps each file as it came (byte for byte, beside card.json) and lists it in manifest.json `card_folder`
// = { preset?: { name, file }, lore?: [{ name, file }], regex?: [{ name, placement, file }], contacts?: { name, file } }.
// On load that list becomes store.cardFolder and the parsed files core.folderData = { preset, regex, contacts, lore }
// (a 世界书 that came with the card is read only from here, never merged into card.json). Nothing in Modu
// writes to those files again.
// classify one parsed .json she dropped: → 'preset' | 'regex' | 'params' | 'contacts' | 'pronouns' | '' (anything else)
// his pronoun note ({ v, pronouns, … }, he/him | she/her | they/them), as a card folder brings it
const PRONOUNS = /^(he\/him|she\/her|they\/them)$/;
const isPronounNote = j => j && typeof j === 'object' && !Array.isArray(j) && PRONOUNS.test(String(j.pronouns || '').trim()) && !j.data && !j.name && !j.entries && !j.prompts;
function folderKind(name, j){
  if (!j || typeof j !== 'object') return '';
  if (isPronounNote(j)) return 'pronouns';
  if (!Array.isArray(j) && Array.isArray(j.prompts)) return 'preset';
  const scripts = Array.isArray(j) ? j : Array.isArray(j.scripts) ? j.scripts : null;
  if (scripts && scripts.length && scripts.every(s => s && typeof s === 'object' && 'findRegex' in s)) return 'regex';
  if (!Array.isArray(j) && (/^modu-character-params\//.test(String(j.format || '')) || (j.knobs && typeof j.knobs === 'object' && !j.data))) return 'params';
  if (/(^|[\\/])contacts\.json$/i.test(name) || (!Array.isArray(j) && Array.isArray(j.contacts))) return 'contacts';
  return '';
}
const scriptsOf = j => Array.isArray(j) ? j : (j && Array.isArray(j.scripts) ? j.scripts : j && typeof j.findRegex === 'string' ? [j] : []);   // one script alone too
const placementOf = list => { const s = new Set(list.filter(x => x && !x.disabled).flatMap(x => x.markdownOnly && !x.promptOnly ? ['display'] : x.promptOnly && !x.markdownOnly ? ['prompt'] : ['prompt', 'display'])); return [...s]; };
const RESERVED = /^(card\.json|card\.png|avatar\.png|chat\.jsonl|manifest\.json|pronouns\.json)$/i;
const baseName = n => String(n || '').split(/[\\/]/).pop();
// how many people a contacts.json holds ({ contacts }, { people } or a list)
const peopleOf = j => { const l = Array.isArray(j) ? j : j && (Array.isArray(j.contacts) ? j.contacts : Array.isArray(j.people) ? j.people : []); return l.filter(p => p && typeof p === 'object' && String(p.name || p.label || '').trim()).length; };
// a staged import's folder part, from the files she dropped: { files: { name: text }, list (manifest card_folder), data,
// params, summary }. summary (搬家's receipt): one line per file she picked and what it became, with counts only (no block,
// script or person names: a card's hidden layer is never spelled out) = [{ file, kind, n }]
function stageFolder(found){
  const files = {}, list = {}, data = { preset: null, regex: [], contacts: null, lore: [] }, summary = []; let paramsObj = null, pronoun = '';
  // a file named like one of Modu's own (params.json, contacts.json) that is not that kind (a 世界书 called params.json)
  // gets another name, so it never takes the place of his params or contacts
  const fileName = (n, kind) => { let b = baseName(n); if (RESERVED.test(b) || (kind !== 'params' && /^params\.json$/i.test(b)) || (kind !== 'contacts' && /^contacts\.json$/i.test(b))) b = 'folder-' + b; return b; };
  for (const f of found){
    const file = fileName(f.name, f.kind); files[file] = f.text;
    const name = (f.json && !Array.isArray(f.json) && f.json.name) || file.replace(/\.json$/i, '');
    if (f.kind === 'preset'){ const p = core.parsePreset(f.json); data.preset = p; list.preset = { name: (p && p.name) || file.replace(/\.json$/i, ''), file }; summary.push({ file: baseName(f.name), kind: 'preset', n: p ? p.blocks.length : 0 }); }
    else if (f.kind === 'regex'){ const s = scriptsOf(f.json); data.regex.push(...s); (list.regex = list.regex || []).push(...placementOf(s).map(placement => ({ name, placement, file }))); summary.push({ file: baseName(f.name), kind: 'regex', n: s.filter(x => x && !x.disabled).length }); }
    else if (f.kind === 'contacts'){ data.contacts = f.json; list.contacts = { name: file.replace(/\.json$/i, ''), file }; summary.push({ file: baseName(f.name), kind: 'contacts', n: peopleOf(f.json) }); }
    else if (f.kind === 'params'){ paramsObj = f.json; delete files[file]; files['params.json'] = f.text; list.params = { name: 'params', file: 'params.json' }; summary.push({ file: baseName(f.name), kind: 'params', n: 0 }); }   // his params are always params.json
    else if (f.kind === 'lore'){ data.lore.push(Object.assign({ name }, f.json)); (list.lore = list.lore || []).push({ name, file }); summary.push({ file: baseName(f.name), kind: 'lore', n: core.loreEntries(f.json).length }); }
    // a pronoun note is THE note beside the card (pronouns.json), kept byte for byte; no question asked.
    // Listed in card_folder as the author's (pronoun), so nothing writes over it unkept (store.js keepCardPronoun)
    else if (f.kind === 'pronouns'){ delete files[file]; files['pronouns.json'] = f.text; list.pronoun = { file: 'pronouns.json' }; pronoun = String(f.json.pronouns).trim(); summary.push({ file: baseName(f.name), kind: 'pronouns', n: 0, pronouns: pronoun }); }
  }
  // a hidden state in her params that cannot be used is counted (never named) for the receipt
  const ps = summary.find(s => s.kind === 'params'); if (ps && paramsObj){ ps.state = Object.keys(core.stateDecls(null, paramsObj)).length; ps.bad = core.stateProblems(null, paramsObj); }
  return { files, list, data, params: paramsObj, summary, pronoun };
}
// read the folder part back when he loads (a staged visit already carries it; store.js clears it on each load)
core.folderData = null;
// the open companion, for the copies kept here (his folder and name; the contact id may come a moment after 'loaded')
const cardKey = () => (store.folderName || '') + '|' + (store.name || '') + '|' + (store.importedAt || 0);
core.cardKey = cardKey;
// read from the folder open when the read began; only the newest read is kept
let folderReads = 0;
async function readFolder(){
  if (!store.writable || !store.dir) return;
  const mine = ++folderReads, dir = store.dir;
  let man = null; try { man = JSON.parse(await readText(dir, 'manifest.json') || 'null'); } catch {}
  if (mine !== folderReads) return;
  const list = man && man.card_folder && typeof man.card_folder === 'object' ? man.card_folder : null;
  store.cardFolder = list && Object.keys(list).length ? list : null;
  const data = { preset: null, regex: [], contacts: null, lore: [] };
  const json = async f => { try { return JSON.parse(await readText(dir, f) || 'null'); } catch { return null; } };
  if (list){
    if (list.preset && list.preset.file) data.preset = core.parsePreset(await json(list.preset.file));
    for (const f of new Set([].concat(list.regex || []).map(r => r.file).filter(Boolean))) data.regex.push(...scriptsOf(await json(f)));
    if (list.contacts && list.contacts.file) data.contacts = await json(list.contacts.file);
    for (const b of [].concat(list.lore || [])){ const j = b && b.file ? await json(b.file) : null; if (j && j.entries) data.lore.push(Object.assign({ name: b.name || '' }, j)); }
  }
  if (mine === folderReads) core.folderData = data;
}

// --- Files she adds later beside his card: contacts.json, regex, a preset, params.json, a 世界书 --------------------
// Picked in 搬家 on their own while he is open (stageImport gives `addOn`, the same folder part an import builds): each is
// written beside card.json, never into it, and listed in manifest.json `card_folder` as the import would have; then he is
// read again (the folder, his params, the layers). A preset added this way is hers (`card_folder.preset.by: 'her'`): 设置
// gives its blocks switches (presetSwitch). A card's own preset is never switched. → { added: [{ file, kind, n }] }
// A file of hers never overwrites the author's file of the same name (one the card folder brought, listed
// in card_folder without by: 'her'): hers is kept beside it as <name>.her.json and both stay, byte for byte (export gives
// both back). At read time hers wins where there is one of a kind (the preset, contacts, params: params.her.json is read
// before params.json); regex and 世界书 are lists, so both are used. Each entry of hers says by: 'her'.
const herName = n => /\.json$/i.test(n) ? n.replace(/\.json$/i, '.her.json') : n + '.her';
function authorFiles(list){
  const out = new Set();
  for (const k of ['preset', 'contacts', 'params', 'regex', 'lore', 'pronoun']) for (const x of [].concat(list[k] || [])) if (x && x.file && x.by !== 'her') out.add(x.file);
  return out;
}
async function addBesideCard(st){
  const add = st && st.addOn;
  if (!add || !Object.keys(add.files || {}).length) return { added: [] };
  if (!store.writable || !store.dir || !store.card) throw new Error('没有打开的角色');
  const dir = store.dir;
  let man = null; try { man = JSON.parse(await readText(dir, 'manifest.json') || 'null'); } catch {}
  man = man && typeof man === 'object' ? man : {};
  const list = Object.assign({}, man.card_folder || {}), L = clone(add.list || {}), theirs = authorFiles(list), files = {};
  // her pronouns.json is THE note every reader reads, so it keeps its name; the author's is kept first as
  // pronouns.card.json (keepCardPronoun). Hers is not listed in card_folder (a note, as setPronouns writes it).
  delete L.pronoun;
  if (add.files[core.PRONOUNS_NOTE] != null && theirs.has(core.PRONOUNS_NOTE) && await core.keepCardPronoun(dir, list)) man.files = [...new Set([].concat(man.files || [], [core.PRONOUNS_CARD]))];
  for (const [n, text] of Object.entries(add.files)){
    const to = theirs.has(n) && n !== core.PRONOUNS_NOTE ? herName(n) : n;
    files[to] = text;
    if (to !== n) for (const k of Object.keys(L)) for (const x of [].concat(L[k] || [])) if (x && x.file === n) x.file = to;
  }
  for (const [n, text] of Object.entries(files)) await writeFile(dir, n, text);
  const hers = x => Object.assign({}, x, { by: 'her' });
  if (L.preset) list.preset = hers(L.preset);
  if (L.contacts) list.contacts = hers(L.contacts);
  if (L.params) list.params = hers(L.params);
  for (const k of ['regex', 'lore']) if (L[k]) list[k] = [].concat(list[k] || []).filter(x => !L[k].some(y => y.file === x.file)).concat(L[k].map(hers));
  man.card_folder = list; man.files = [...new Set([].concat(man.files || [], Object.keys(files)))];
  await writeFile(dir, 'manifest.json', JSON.stringify(man, null, 2));
  await core.loadFromDir(dir); await core.folderRead;   // his folder read; the regex verdicts arrive by themselves
  return { added: clone(add.summary || []) };
}

// --- The parts of a card that are kept but never run here (搬家 "not used here") -------------------------------
// 酒馆助手 scripts, MVU variable scripts, HTML front-ends, links to outside files. Counted, never fetched or run.
// Also what the card carries that Modu keeps but does not use (yet): the author's notes (creator_notes, words for
// the reader) and the other openings (alternate_greetings: there is no place to start another one yet).
// → { script, mvu, html, link, sampling, notes, greetings, none }
function unusedParts(card, folder){
  const c = card || {}, x = c.extensions || {}, th = x.tavern_helper || {};
  const script = [].concat(th.scripts || []).length + [].concat(x.TavernHelper_scripts || []).length;
  const books = [c.character_book].concat((x.modu && x.modu.lore) || [], (folder && folder.lore) || []).filter(Boolean);   // with the 世界书 beside the card
  const entries = books.flatMap(b => Array.isArray(b.entries) ? b.entries : Object.values(b.entries || {})).filter(e => e && typeof e === 'object');
  const mvu = entries.filter(e => /\[(InitVar|mvu[^\]]*)\]|<UpdateVariable>|_\.set\(/i.test(String(e.comment || '') + '\n' + String(e.content || ''))).length + (x.mvu ? 1 : 0);
  const texts = [c.first_mes, c.description, c.creator_notes, c.scenario, c.system_prompt, c.mes_example].concat(c.alternate_greetings || [], entries.map(e => e.content), [].concat(x.regex_scripts || [], (folder && folder.regex) || []).map(s => s && s.replaceString));
  const FRONT = /<\s*(html|body|script|style|iframe|canvas|link)\b/i;
  const html = texts.filter(t => typeof t === 'string' && FRONT.test(t)).length;
  const all = JSON.stringify([texts, th, x.TavernHelper_scripts || []]);
  const link = new Set((all.match(/https?:\/\/[^\s"'<>)\\]+/g) || [])).size;
  const sampling = !!(folder && folder.preset && Object.keys(folder.preset.sampling || {}).length);
  const notes = !!String(c.creator_notes || '').trim(), greetings = [].concat(c.alternate_greetings || []).filter(g => String(g || '').trim()).length;
  return { script, mvu, html, link, sampling, notes, greetings, none: !(script || mvu || html || link || sampling || notes || greetings) };
}

// --- His pronoun, read from the card at import -----------------------------------------------------------
// The card's own extensions.modu.pronouns, else how its text refers to him: 他 / 她 (not 他们 / 她们), he / she. Clear
// when one side is used at least 3 times and three times as often as the other; otherwise '' (the import asks once).
function guessPronoun(card){
  const c = card || {}, own = c.extensions && c.extensions.modu && c.extensions.modu.pronouns;
  if (own) return String(own);
  const t = [c.description, c.personality, c.scenario, c.first_mes, c.system_prompt].map(s => String(s || '')).join('\n').replace(/\{\{user\}\}[^。.!?！？\n]*/gi, '');
  const he = (t.match(/他(?!们)/g) || []).length + (t.match(/\b(he|him|his|himself)\b/gi) || []).length;
  const she = (t.match(/她(?!们)/g) || []).length + (t.match(/\b(she|her|hers|herself)\b/gi) || []).length;
  if (he >= 3 && he >= she * 3) return 'he/him';
  if (she >= 3 && she >= he * 3) return 'she/her';
  return '';
}

// --- Calibration: one call per card_hash reads the card and writes params.json ------------------
// Never for a house character (params.json written by 'hand'), never twice for the same card (card_hash), and a reply
// that is not a usable params object writes nothing: the defaults stay, with nothing shown to her.
async function cardHash(card){
  const text = JSON.stringify(card || {});
  try {
    const sub = globalThis.crypto && globalThis.crypto.subtle;
    if (sub){ const h = await sub.digest('SHA-256', new TextEncoder().encode(text)); return 'sha256:' + [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32); }
  } catch {}
  let x = 2166136261; for (const ch of text) x = Math.imul(x ^ ch.charCodeAt(0), 16777619) >>> 0; return 'fnv:' + x.toString(16);
}
function cardDigest(card, budget = 8000){
  const c = card || {}, parts = [['name', c.name], ['description', c.description], ['personality', c.personality], ['scenario', c.scenario],
    ['first_mes', c.first_mes], ['mes_example', c.mes_example], ['system_prompt', c.system_prompt], ['tags', [].concat(c.tags || []).join(', ')]];
  return clip(parts.filter(([, v]) => v && String(v).trim()).map(([k, v]) => `${k}: ${String(v).trim()}`).join('\n\n'), budget);
}
function readJsonReply(raw){
  const s = String(raw || '');   // fenced or not, with words around it or not: the outermost { … }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { const o = JSON.parse(s.slice(a, b + 1)); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch { return null; }
}
const KNOB_GROUPS = Object.keys(core.DEFAULT_PARAMS || {});
let calibrating = null, calibrateLater = false; const calibratedHashes = new Set();
core.calibrations = 0;   // how many calibration calls were made in this visit (the cost meter, the tests)
// A calibration belongs to the companion open when it was asked for. It first waits for his
// params and his card folder to be read (so a card folder's own params.json, or a hand-made one, is seen and never written
// over), then works on that folder only: his card, his records, his params.json, whoever is open when the model answers.
// If she has moved to someone else by then, the answer still goes into his folder (the call is paid for once and is not
// asked again), never into the open companion's, and is not put in force on the screen. Asked for a new companion while
// one runs for another, it waits its turn; asked again for the same one, it is the same call (a forced one waits behind an
// unforced one rather than being answered by it).
// The model can take a minute. Right before anything is written his folder is looked at again: the card on
// disk must still be the card it read (same card_hash: a folder deleted and made again under his name is not his), and a
// params file that came in meanwhile (card_folder.params, or a params.json / params.her.json not written by calibration,
// e.g. one she added beside the card in 设置) wins: the answer is let go ('card-folder' / 'hand').
const sameRead = async () => { for (let i = 0; i < 5; i++){ const p = core.paramsRead, c = core.folderRead; await Promise.resolve(p).catch(() => {}); await Promise.resolve(c).catch(() => {}); if (p === core.paramsRead && c === core.folderRead) return; } };
const recordsAt = (dir, name) => core.makeRecords(() => ({ owner: 'him', writable: true, dir, format: core.STORE_FORMAT, mem: () => new Map(), fill: man => { if (!man.name) man.name = name; } }));
// → { ran, ok, why ('hand' | 'card-folder' | 'same-card' | 'no-card' | 'no-model' | 'unusable' | 'failed' | 'paused' | 'tried' |
// 'switched' | ''), params? }
// It is a background call she did not ask for, so it goes through sideCall (on the chat model): counted in
// 用量, and refused while 暂停 (counted as refused, nothing sent, the card not marked as tried). It runs once 暂停 is lifted.
function calibrate(settings, o = {}){
  const key = cardKey();
  if (calibrating && calibrating.key === key && (calibrating.force || !o.force)) return calibrating.p;
  const before = calibrating && calibrating.p, run = { key, force: !!o.force };
  run.p = (async () => {
    if (before) await before.catch(() => {});
    try { return await calibrateFor(key, settings, o); } finally { if (calibrating === run) calibrating = null; }
  })();
  calibrating = run;
  return run.p;
}
async function calibrateFor(key, settings, o){
  await sameRead();
  if (cardKey() !== key) return { ran: false, ok: false, why: 'switched' };   // she left before his folder was even read: nothing asked
  // his, taken now: everything below reads and writes these, never what is open later
  const card = store.card; if (!card) return { ran: false, ok: false, why: 'no-card' };
  const dir = store.writable ? store.dir : null, name = store.name || card.name || '', have = params.get(), info = params.info(), pr = pronouns(), cardFolder = store.cardFolder;
  const recs = dir ? recordsAt(dir, store.name) : records, here = () => cardKey() === key;
  const hash = await cardHash(card);
  if (have && info.writer === 'hand') return { ran: false, ok: true, why: 'hand' };
  // a params file that came beside the card in its folder is the author's: never written over
  if (cardFolder && cardFolder.params) return { ran: false, ok: true, why: 'card-folder' };
  if (!o.force && ((have && info.card_hash === hash) || calibratedHashes.has(hash))) return { ran: false, ok: true, why: 'same-card' };
  const s = settings || core.loadSettings();
  if (!s || !String(s.endpoint || '').trim()) return { ran: false, ok: false, why: 'no-model' };
  const info2 = await core.prompts.info('calibration');
  const text = await core.prompt('calibration', { card_digest: cardDigest(card), pronoun: pr.raw ? pr.zh : 'unknown', pronoun_en: pr.raw ? pr.en : 'unknown', char: name });
  // one attempt per card and model, kept as a record (calibration/last.json): a model that fails or refuses is not asked
  // again each time the app opens; a new model, or force, asks again
  let last = null; try { last = await recs.get('calibration', 'last'); } catch {}
  if (!o.force && last && last.hash === hash && last.model === String(s.model || '')) return { ran: false, ok: false, why: 'tried' };
  if (!dir && !here()) return { ran: false, ok: false, why: 'switched' };   // no folder of his to keep it in: not asked
  // → '' when the answer may be written now, else why it is let go (see above)
  const blocked = async () => {
    if (!dir){ if (!here()) return 'switched'; const i = params.info(); return i.loaded && i.writer !== 'calibration' ? 'hand' : ''; }
    const json = async f => { try { return JSON.parse(await readText(dir, f) || 'null'); } catch { return null; } };
    const cj = await json('card.json'); if (!cj || await cardHash(cj.data) !== hash) return 'switched';
    const man = await json('manifest.json'); if (man && man.card_folder && man.card_folder.params) return 'card-folder';
    for (const f of ['params.her.json', 'params.json']){ const pj = await json(f); if (pj && typeof pj === 'object' && pj.writer !== 'calibration') return 'hand'; }
    return '';
  };
  const tried = async why => { if (await blocked()) return; try { await recs.commit('calibration', { id: 'last', hash, model: String(s.model || ''), why, at: now().getTime() }, { writer: 'calibration', app: 'calibration' }); } catch {} };
  const asked = [{ role: 'system', content: text || cardDigest(card) }, { role: 'user', content: cardDigest(card) }];
  calibratedHashes.add(hash); core.calibrations++;
  let raw; try { raw = await core.sideCall('calibrate', asked, { chat: true, settings: s, max: 2500 }); }
  catch(e){ if (e && e.code === 'paused'){ calibratedHashes.delete(hash); core.calibrations--; calibrateLater = true; return { ran: false, ok: false, why: 'paused' }; }
    await tried('failed'); return { ran: true, ok: false, why: 'failed' }; }
  const got = readJsonReply(raw);
  // usable: an object with at least one of the knob groups the defaults have
  if (!got || !KNOB_GROUPS.some(k => got[k] && typeof got[k] === 'object')) { await tried('unusable'); return { ran: true, ok: false, why: 'unusable' }; }
  // only the knob groups of the public schema (and his pronoun) are kept: a calibration never writes a card's own parts
  // (bond, state, facts, voice, away, overrides) or a header of its own (params.schema.json: "never written by calibration")
  const knobs = {}; for (const k of KNOB_GROUPS) if (got[k] !== undefined && got[k] !== null) knobs[k] = got[k];
  const pr2 = got.character && /^(he\/him|she\/her|they\/them)$/.test(String(got.character.pronouns || '')) ? { pronouns: got.character.pronouns } : {};
  const out = Object.assign({}, knobs, { format: PARAMS_FORMAT, v: 1, writer: 'calibration', rev: (Number(have && have.rev) || 0) + 1,
    character: Object.assign({}, pr2, { name, card_file: 'card.json', card_hash: hash }),
    calibration: { model: s.model || '', at: new Date(now().getTime()).toISOString(), prompt_version: info2.version || '', card_hash: hash } });
  const no = await blocked(); if (no) return { ran: true, ok: false, why: no };
  if (dir) await writeFile(dir, 'params.json', JSON.stringify(out, null, 2));
  const inForce = here(); if (inForce) params.use(out);
  await tried('');
  return { ran: true, ok: true, why: inForce ? '' : 'switched', params: clone(out) };
}

// --- Chapters from alternate greetings (words chapter.*) --------------------------------------------------------
// The card's first_mes and its alternate_greetings are the openings. Starting another one is a chapter record,
// chapter/<id>.json = { v, id, greeting, from (where it starts in chat.jsonl), writer, rev, at }, never a line of
// chat.jsonl of its own: the opening is his message (extra.modu_chapter = id), and his prompt's history starts there.
// The chat and memories before it stay.
const CHAPTER_TYPE = 'chapter';
core.chapterNow = { key: '', from: 0, id: '' };
async function readChapters(){
  let list = []; try { list = await records.list(CHAPTER_TYPE); } catch {}
  const last = list.filter(r => r && Number.isFinite(Number(r.from))).sort((a, b) => (a.at || 0) - (b.at || 0)).pop();
  core.chapterNow = { key: cardKey(), from: last ? Number(last.from) : 0, id: last ? last.id : '' };
}
const chapters = {
  // → [{ i, text, current }]: i 0 is first_mes
  list(){
    const c = store.card || {}, all = [c.first_mes].concat(c.alternate_greetings || []).map(t => String(t || '')).filter(Boolean);
    const cur = (store.msgs.find((m, i) => i >= core.chapterNow.from && !m.is_user) || {}).mes;
    return all.map((text, i) => ({ i, text, current: core.chapterNow.id ? core.chapterNow.id.endsWith('-' + i) : text === cur }));
  },
  async start(i){
    const c = store.card || {}, all = [c.first_mes].concat(c.alternate_greetings || []);
    const text = String(all[i] || ''); if (!text) throw new Error('没有这个开场白');
    const t = now().getTime(), id = t.toString(36) + '-' + i, from = store.msgs.length;
    await records.commit(CHAPTER_TYPE, { id, greeting: i, from, at: t }, { writer: 'her', app: CHAPTER_TYPE });
    core.chapterNow = { key: cardKey(), from, id };
    const m = { name: store.name, is_user: false, is_name: true, send_date: t, mes: text.replace(/\{\{char\}\}/gi, store.name).replace(/\{\{user\}\}/gi, (store.meta && store.meta.user_name) || 'You'), extra: { modu_chapter: id } };   // stored in his chat: her chat's own name, never her 聊天设置 one
    await appendToChat(m, { announce: true });
    emit('chapter', { id, greeting: i, from });
    return { id, greeting: i, from };
  },
  get now(){ return core.chapterNow.key === cardKey() ? Object.assign({}, core.chapterNow) : { key: '', from: 0, id: '' }; },
};

// --- The card back out: as it came in, for SillyTavern -----------------------------------------------------
// card.png byte for byte when the card came as a picture, else the card's JSON as it was read. → { filename, blob }
const cardData = c => { const d = Object.assign({}, c); delete d.spec_seen; return d; };
async function exportCard(){
  if (!store.card) throw new Error('没有角色卡');
  const name = (store.name || 'card').replace(/[\\/:*?"<>|]/g, '_');
  const chunk = store.cardSource && store.cardSource.chunk;
  if (store.writable && store.dir && (chunk === 'chara' || chunk === 'ccv3')){
    const png = await readBlob(store.dir, 'card.png'); if (png) return { filename: name + '.png', blob: png };
  }
  // a JSON card as it was read; anything else (a c.ai character, whose picture is only an avatar) as a V2 card
  const j = chunk === 'json' && store.cardSource.json ? store.cardSource.json : { spec: 'chara_card_v2', spec_version: '2.0', data: cardData(store.card) };
  return { filename: name + '.json', blob: new Blob([JSON.stringify(j, null, 2)], { type: 'application/json' }) };
}

// --- Facts: the memory's "current state", placed after the card ---------------------------------------
// One vocabulary with the memory engine and the public params.schema.json: the card's facts are
// extensions.modu.facts or params.facts = { fixed: [text], moving: [{ id, card_says, owner?, note? }] }; owner 'memory'
// (the default: what he says later wins), 'state.<k>' or 'counters.<k>' (that key owns the fact; its text stays the card's
// until the memory engine says otherwise, and the hidden number is never written out). What he has said since is
// facts/<id>.json (written by the memory engine). Modu's own memory engine gives the block's text when it is there
// (memorySource.own.current()); this is the reading without it. A sync copy, read on load and whenever a facts record changes.
core.factsNow = { key: '', said: {} };
async function readFacts(){
  const said = {}; try { for (const r of await records.list('facts')) if (r && r.id) said[r.id] = r; } catch {}
  core.factsNow = { key: cardKey(), said };
}
function cardFacts(){
  const c = store.card, pf = params.get();
  const f = (c && c.extensions && c.extensions.modu && c.extensions.modu.facts) || (pf && pf.facts) || null;
  if (!f || typeof f !== 'object') return { fixed: [], moving: [] };
  const moving = [].concat(f.moving || []).filter(m => m && m.id).map(m => ({ id: String(m.id), card_says: m.card_says != null ? String(m.card_says) : '', owner: String(m.owner || 'memory'), note: m.note ? String(m.note) : '' }));
  return { fixed: [].concat(f.fixed || []).map(String).filter(Boolean), moving };
}
// → the lines of the current state: { fixed: [text], now: [{ key, value, from: 'said' | 'card' }] }: what he has said wins
// over the card for a fact memory owns; a fact a state key or counter owns keeps the card's words here
function currentState(){
  const f = cardFacts(), said = core.factsNow.key === cardKey() ? core.factsNow.said : {};
  const now2 = f.moving.map(m => { const r = m.owner === 'memory' ? said[m.id] : null; return r && r.value != null && String(r.value).trim() ? { key: m.id, value: String(r.value), from: 'said' } : { key: m.id, value: m.card_says, from: 'card' }; }).filter(x => x.value);
  for (const k of Object.keys(said)) if (!f.moving.some(m => m.id === k) && said[k].value != null && String(said[k].value).trim()) now2.push({ key: String(said[k].key || k), value: String(said[k].value), from: 'said' });
  return { fixed: f.fixed, now: now2 };
}

// --- Lore timing (sticky / cooldown) kept per companion: lore/timing.json ----------------------------------------
core.loreTiming = { key: '', t: {} };
async function readLoreTiming(){ let r = null; try { r = await records.get('lore', 'timing'); } catch {} core.loreTiming = { key: cardKey(), t: (r && r.timing) || {}, rev: (r && r.rev) || 0 }; }
let timingWrite = Promise.resolve();
function keepLoreTiming(t){
  const key = cardKey(); if (core.loreTiming.key !== key) core.loreTiming = { key, t: {}, rev: 0 };
  if (JSON.stringify(t) === JSON.stringify(core.loreTiming.t)) return;
  core.loreTiming.t = t;
  timingWrite = timingWrite.then(async () => { if (cardKey() !== key) return; try { const w = await records.commit('lore', { id: 'timing', timing: t, at: now().getTime() }, { writer: 'core', app: 'lore' }); if (w.ok) core.loreTiming.rev = w.record.rev; } catch {} });
}

listeners.add((ev, d) => {
  if (ev === 'loaded'){ core.folderRead = Promise.all([readFolder(), readChapters(), readFacts(), readLoreTiming()]).catch(() => {});
    core.cardsRead = core.folderRead.then(() => core.regex && core.regex.vetAll()).catch(() => {}); }   // a card's regex is tried in the sandbox before it ever runs
  if (ev === 'records' && d && d.type === 'facts' && !d.owner) readFacts();
  // a calibration refused while 暂停 runs once she lifts it (for the companion open then; once per card and model, as ever)
  if (ev === 'reach' && d && d.op === 'resume' && calibrateLater){ calibrateLater = false; Promise.resolve().then(() => calibrate()).catch(() => {}); }
});
core.cardsRead = Promise.resolve(); core.folderRead = Promise.resolve();   // folderRead = his folder read, before the vetting

Object.assign(core, { folderKind, stageFolder, addBesideCard, unusedParts, guessPronoun, cardHash, cardDigest, calibrate, chapters, exportCard,
  cardFacts, currentState, keepLoreTiming });
})(globalThis[Symbol.for('modu.core')]);
// app/core/clock.js: the one clock: one timer while the page is open; every timed thing rides on it.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, now, jobs } = core;

// No part keeps its own timer (his life's wake loop, 信箱, 购物, 外卖, the page's clock face, the body
// seam's presence): clock.start() (the page calls it; a Node host may; a test calls tick() by
// hand) makes the only interval. Each beat:
//   1. the beat listeners (clock.on(fn)): the clock face, the presence for the body seam, an open screen showing
//      something on its way. They get the time and must be quick;
//   2. the before-round listeners (clock.before(fn), leader only): the 主动 check (app/core/reach.js), so a reopen's
//      look at the time away comes first, before a long job round (his day sketched for the missed days, the age-out);
//      after it, she may already have written and the reopen would no longer be a return;
//   3. the job round: jobs.run(t), only when a job is due (the soonest time is kept, so most beats read nothing);
//   4. the after-round listeners (clock.after(fn)).
// A beat that comes while the last one is still running (a model call) is skipped. A page out of sight may have its
// timer slowed by the browser; the page calls tick() again when she looks.
// Two tabs on one store must not both run his jobs or both write to her: one page leads (the Web Locks API,
// navigator.locks, lock 'modu-clock', held for the page's life); the others keep their beat (clock face, presence) and
// wait, taking over when the leader's page goes. Without the API (Node, an old browser) the page leads.
const BEAT = 10000, PRUNE_EVERY = 864e5, LOCK = 'modu-clock';
let timer = null, ticking = null, nextAt = 0, pruned = 0, lastBeat = 0, leader = true, electing = false;   // a host that never starts the clock leads its own ticks
function elect(locks){
  if (electing) return;
  if (!locks || typeof locks.request !== 'function'){ leader = true; return; }
  electing = true; leader = false;
  Promise.resolve(locks.request(LOCK, () => { leader = true; nextAt = 0; emit('clock', { op: 'leader', at: now().getTime() }); tick(); return new Promise(() => {}); }))
    .catch(() => { leader = true; });
}
const beats = new Set(), befores = new Set(), afters = new Set();
// a job booked or moved may be sooner than the one we wait for; a new companion starts from scratch
core.listeners.add((ev, d) => {
  if (ev === 'job' && d && d.job && d.job.state === 'pending') nextAt = Math.min(nextAt || Infinity, d.job.at);
  if (ev === 'loaded') nextAt = 0;
});
async function tick(o = {}){
  if (ticking) return ticking;
  ticking = (async () => {
    const t = now().getTime(); lastBeat = t;
    for (const f of beats){ try { f(t); } catch(e){ console.error(e); } }
    let res = null;
    if (leader) for (const f of befores){ try { await f(t); } catch(e){ console.error(e); } }
    if (leader && core.store && core.store.name && (o.force || !nextAt || t >= nextAt)){
      try {
        res = await jobs.run(t, { cap: o.cap });
        if (res.dropped.length) emit('clock', { op: 'dropped', at: t, dropped: res.dropped.map(d => ({ id: d.job.id, kind: d.job.kind, owner: d.job.owner, at: d.job.at, why: d.why })) });
        const n = await jobs.next(); nextAt = n == null ? Infinity : n;
        if (res.waiting) nextAt = t;   // more were due than one round takes: the next beat goes on
        if (t - pruned > PRUNE_EVERY){ pruned = t; jobs.prune().catch(() => {}); }
      } catch(e){ console.error(e); }
    }
    if (leader) for (const f of afters){ try { await f(t, res); } catch(e){ console.error(e); } }
    return res;
  })().finally(() => { ticking = null; });
  return ticking;
}
const clock = {
  // → true when this call made the timer (a second start makes none)
  // o: { every?, locks? (default navigator.locks) }
  start(o = {}){
    if (timer || typeof setInterval !== 'function') return false;
    elect(o.locks !== undefined ? o.locks : (typeof navigator !== 'undefined' && navigator.locks) || null);
    timer = setInterval(() => { tick(); }, Number(o.every) || BEAT);
    if (timer && timer.unref) timer.unref();
    emit('clock', { op: 'start', at: now().getTime() });
    tick();
    return true;
  },
  stop(){ if (timer) clearInterval(timer); timer = null; },
  get running(){ return !!timer; },
  get leader(){ return leader; },
  get last(){ return lastBeat; },
  tick,
  on(fn){ if (typeof fn === 'function') beats.add(fn); return () => beats.delete(fn); },
  before(fn){ if (typeof fn === 'function') befores.add(fn); return () => befores.delete(fn); },
  after(fn){ if (typeof fn === 'function') afters.add(fn); return () => afters.delete(fn); },
  BEAT,
};

Object.assign(core, { ticker: clock });   // core.clock is time.js's clock function; the public name is ModuCore.clock
})(globalThis[Symbol.for('modu.core')]);
// app/core/seam.js: the body seam: BroadcastChannel + device bridge, presence, persona state, his 3D body model.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, store, env, msgDate, gapWords, now, kvSet, kvGet, pronouns } = core;

// --- Persona state: one object, read as words by the prompt and as a face by the body seam ---
// v1 is derived, not stored: presence, the mood of his last reply (it lingers for two hours, then fades),
// the gap since they last talked. Published on the seam as {type:"persona", v:1, state} when it changes.
const MOOD_LINGER = 2 * 3600 * 1000;
// His day may say more than a presence word. setDayPlan's fn may return a status object
//   { presence: 'here' | 'asleep' | 'busy' | null, where, busy, what, since, mood }
// (where: '画室'; busy: true while he cannot really talk; what: what he is doing, in words; since: ms, when it
// began; mood: a word from his params' moods, e.g. 'tired', or an away mood). The ONE status object stays
// personaState(): these become its where / busy / what / since / moodWord. A plain word still works.
function dayStatus(t){
  if (!dayPlan) return null;
  let d = null; try { d = dayPlan(t); } catch { return null; }
  if (d && typeof d === 'object') return { presence: PRESENCE.includes(d.presence) ? d.presence : null, where: String(d.where || ''), busy: d.busy === true,
    what: String(d.what || d.doing || ''), since: Number(d.since) || null, mood: String(d.mood || '') };
  return PRESENCE.includes(d) ? { presence: d, where: '', busy: d === 'busy', what: '', since: null, mood: '' } : null;
}
function personaState(){
  const last = [...store.msgs].reverse().find(m => !m.is_user && m.extra && m.extra.modu_emotion);
  const lastAny = store.msgs.length ? msgDate(store.msgs[store.msgs.length - 1]) : null;
  const t = now(), ld = last ? msgDate(last) : null;
  const age = ld ? t - ld : Infinity;
  const mood = last && age < MOOD_LINGER ? last.extra.modu_emotion : 'neutral';
  const turn = phase === 'thinking' || phase === 'speaking';
  const st = dayStatus(t), own = st ? st.presence : null;
  // busy = this very turn; the words describe the moment before it (by his own day, when life.js gives one)
  const p = presence(), pw = p === 'busy' && turn ? (PRESENCE.includes(own) ? own : 'here') : p;
  const name = store.name || '', pr = pronouns().en.split('/')[0];
  const doing = p === 'asleep' ? 'asleep' : p === 'busy' ? (turn ? 'replying' : 'busy') : 'free';
  const gap = lastAny ? Math.max(0, t - lastAny) : null;
  const words = !name ? '' :
    `${name} is ${pw === 'asleep' ? 'asleep, or was until she wrote' : pw === 'busy' ? 'busy with his own things, and sees her message in a spare moment' : 'awake and free'}` +
    (mood !== 'neutral' ? `; the ${mood} from earlier has not quite gone (${gapWords(age)})` : '') + '.';
  const where = st ? st.where : '', what = st ? st.what : '', moodWord = st ? st.mood : '';
  const more = !name || !(where || what || moodWord) ? '' : ' ' + [what ? `Right now: ${what}` : '', where ? `at ${where}` : '', moodWord ? `feeling ${moodWord}` : ''].filter(Boolean).join(', ') + '.';
  return { v: 1, name, presence: p, doing, mood, moodAt: ld && mood !== 'neutral' ? ld.getTime() : null, lastAt: lastAny ? lastAny.getTime() : null, gapMin: gap == null ? null : Math.round(gap / 60000), pronoun: pr, words: words + more,
    where, busy: st ? (turn ? own === 'busy' : p === 'busy') : p === 'busy' && !turn, what, since: st ? st.since : null, moodWord };   // busy as the one label says
}
let personaSent = '';
function publishPersona(){
  const s = personaState(), key = JSON.stringify([s.name, s.presence, s.doing, s.mood, s.where, s.busy, s.what, s.moodWord]);
  if (key === personaSent) return; personaSent = key;
  publish({ type:'persona', v:1, state: { name: s.name, presence: s.presence, doing: s.doing, mood: s.mood, moodAt: s.moodAt, lastAt: s.lastAt, where: s.where, busy: s.busy, what: s.what, since: s.since, moodWord: s.moodWord } });
  emit('persona', s);
}

// --- Body seam -------------------------------------------------------------------------------
// Two outputs with the same events: the in-browser channel (the VRM face) and, when the user gives an
// address, the device bridge on their PC. The page never talks to a device itself.
// The channel is the host's (setEnv channel) or this runtime's BroadcastChannel, opened below; none: a no-op
let channel = { postMessage(){} };
const bridge = { ws:null, url:'', timer:null, status:'', drivers:[] };
function bridgeStatus(s, drivers){ bridge.status = s; if (drivers) bridge.drivers = drivers; emit('bridge', { status:s, drivers: bridge.drivers }); }
function bridgeConnect(url){
  bridge.url = url; if (bridge.ws) { try { bridge.ws.close(); } catch {} bridge.ws = null; }
  clearTimeout(bridge.timer); if (!url) { bridgeStatus('off'); return; }
  bridgeStatus('connecting');
  try {
    const ws = env.socket ? env.socket(url) : new WebSocket(url); bridge.ws = ws;
    ws.onopen = () => bridgeStatus('on');
    ws.onmessage = e => { try { const a = JSON.parse(e.data); if (a.type === 'ack') bridgeStatus('on', a.drivers || []); else onBodyEvent(a); } catch {} };
    ws.onclose = () => { if (bridge.url === url) { bridgeStatus('retry'); bridge.timer = setTimeout(() => bridgeConnect(url), 5000); } };
    ws.onerror = () => {};
  } catch(e){ bridgeStatus('bad'); }
}
function publish(ev){ channel.postMessage(ev); if (bridge.ws && bridge.ws.readyState === 1) { try { bridge.ws.send(JSON.stringify(ev)); } catch {} } }
let phase = 'idle';
function setPhase(p){ phase = p; publish({ type:'state', phase:p }); emit('phase', p); updatePresence(); }
// Presence (for the lock screen and the labels): 'here' | 'asleep' | 'busy', read from the body seam.
// busy while a turn is running (phase thinking / speaking); asleep in his quiet hours (00:00–07:00 by
// default), unless they talked in the last 30 minutes (if she is up at 2 am, so is he); here otherwise. A body (a device through the bridge, another page) may set it with a
// {type:"presence", state} event, which wins until it says "auto". Each change is published as
// {type:"presence", state, from:"phone"} so bodies can follow it (a sleeping face on the robot, say);
// events marked from:"phone" (another Modu tab) are not taken as a body's word.
const PRESENCE = ['here', 'asleep', 'busy'];
let presenceSet = '', presenceNow = '', quiet = [0, 7], dayPlan = null;
// setDayPlan(fn): fn(Date) → 'here' | 'asleep' | 'busy' | null, or a status object (above), his own
// day (app/life.js); null = the quiet hours
function setDayPlan(fn){ dayPlan = typeof fn === 'function' ? fn : null; updatePresence(); }
// presence({ own: true }): his own state, without "busy while a turn runs": the page's labels (header, lock,
// home) read this one, so sending never flashes 他在忙; the page shows 对方正在输入… while a reply is on its way instead
function presence(o){
  if (PRESENCE.includes(presenceSet)) return presenceSet;
  if (!(o && o.own) && (phase === 'thinking' || phase === 'speaking')) return 'busy';
  // when his own day (life.js, setDayPlan) has him asleep or busy, her message alone does not
  // wake him or free him; his own last message does (he answered, so he is up): the lock screen, the chat header and his
  // pace say the same thing
  // the quiet hours (no day of his) hold him asleep the same way: her message at 2 am waits for his wake
  const st = dayStatus(now()), held = st && st.presence ? (st.presence === 'asleep' || st.presence === 'busy') : inQuietHours(now());
  // the default companion a fresh install put here (store.seeded, firstRun) did not arrive with her: his move-in and
  // the greeting he came with are not time together, so before dawn he is asleep by his day, never 他在
  const born = store.seeded ? (store.importedAt || 0) + 60 * 1000 : 0;
  let lastMsg = null;
  for (let i = store.msgs.length - 1; i >= 0; i--){ if (held && store.msgs[i].is_user) continue; lastMsg = msgDate(store.msgs[i]); break; }
  if (lastMsg && lastMsg.getTime() <= born) lastMsg = null;
  // the moment he moved in counts as time together, so right
  // after an import at night he is here; asleep comes back 30 minutes later by the same rule.
  const last = Math.max(lastMsg ? lastMsg.getTime() : 0, store.seeded ? 0 : store.importedAt || 0) || null;
  if (last && now() - last < 30 * 60 * 1000 && now() - last >= 0) return 'here';
  // his own day (life.js, setDayPlan): asleep at night, sometimes busy; otherwise the quiet hours below
  if (st && st.presence) return st.presence;
  return inQuietHours(now()) ? 'asleep' : 'here';
}
function inQuietHours(d){ const h = new Date(d).getHours(); return quiet[0] <= quiet[1] ? h >= quiet[0] && h < quiet[1] : h >= quiet[0] || h < quiet[1]; }
// when he is next up, by his own day (setDayPlan) or the quiet hours: the first moment after t (10-minute steps, at
// most a day ahead) that is not asleep → ms, or null. Her messages do not count here (a reply booked for his wake)
function wakeAt(t){
  const ms = t == null ? now().getTime() : +t, step = 10 * 60 * 1000;
  for (let c = ms + step; c <= ms + 24 * 3600 * 1000; c += step){
    const st = dayStatus(new Date(c));
    if (st && st.presence) { if (st.presence !== 'asleep') return c; continue; }
    if (!inQuietHours(c)) return c;
  }
  return null;
}
function updatePresence(){ const p = presence(); if (p !== presenceNow){ presenceNow = p; publish({ type:'presence', state:p, from:'phone' }); emit('presence', p); } if (store.name) publishPersona(); }
function setPresence(state){ presenceSet = PRESENCE.includes(state) ? state : ''; updatePresence(); }
function onBodyEvent(ev){ if (ev && ev.type === 'presence' && ev.from !== 'phone') setPresence(ev.state); }
function onChannel(e){ onBodyEvent(e && e.data); }
// open (or swap) the in-browser channel; in Node it never keeps the process running
function openChannel(c){
  if (channel.removeEventListener) channel.removeEventListener('message', onChannel);
  channel = c || (typeof BroadcastChannel === 'function' ? new BroadcastChannel('modu-body') : { postMessage(){} });
  if (channel.addEventListener) channel.addEventListener('message', onChannel);
  if (typeof channel.unref === 'function') channel.unref();
}
openChannel(env.channel);
// no timer of its own: the presence moves on with the one clock's beat (app/core/clock.js)
core.ticker.on(updatePresence);

// --- Body model: his 3D avatar (a .vrm file), kept in this browser for every companion ------------
// Not in his folder yet: a VRM is big and often licensed for one person's use only.
async function setBodyModel(file){ await kvSet('vrm', file ? { name:file.name, blob:file } : null); emit('bodymodel', file ? file.name : ''); }
async function bodyModel(){ try { const v = await kvGet('vrm'); return v && v.blob ? v : null; } catch { return null; } }

Object.assign(core, { openChannel, personaState, publishPersona, bridge, bridgeConnect, publish, setPhase, PRESENCE, dayStatus,
  setDayPlan, presence, updatePresence, wakeAt, setPresence, setBodyModel, bodyModel });
})(globalThis[Symbol.for('modu.core')]);
// app/core/context.js: context assembly: the named blocks that are the only way anything reaches his prompt.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { store, fit, clip, msgDate, isoDay, band, clockIn, gapWords, now, cardLore, loreEntries, loreSelect, loreWhen, lunarDate, solarTerm, EMOTIONS, splitBubbles,
  chatStops, pronouns, lifeKey, lifeLines, eventLines, knownLines, personaState, activityLines, chatCardKind } = core;

const EMOTION_RULE = `After your reply, on its own last line, write how you feel as exactly one tag: [emotion: X], where X is one of ${EMOTIONS.join(', ')}. The app reads the tag and shows it as a sticker; the user never sees the tag itself.`;
// Optional reply tags, asked for only when the caller wants them (assemble / send opts).
// The 心声 is a thought about her, in his own words. Her pronoun for it is in the closing
// block's line about her ("… (narration, actions, 心声), use 她 …"), so it is not said twice (the closing block is mandatory
// and every character of it is taken from the others); only when that line is left out (assembly skipped) does this say it
const INNER_RULE = (her = herPronouns(), alone = false) => `You may add, after your reply and before the emotion tag, one line [心声: …]: what you think but do not say, 10 to 40 characters, first person, in the language of your reply.${alone ? ` In it the user is ${her.zh} / ${her.en.split('/')[0]}, never ${her.not}.` : ''} The user sees it only if ${her.subj} tap${her.s}.`;
// Her pronoun, for every place he refers to her (reply, *actions*, 心声): 'she/her' unless she chose another
// ('he/him' | 'they/them') in 聊天设置 (her profile, her-store.js), or a host passes settings.userPronouns. His comes from his
// card (pronouns()); the two are never mixed up.
function herPronouns(settings){
  const p = String((settings && settings.userPronouns) || (core.herProfile && core.herProfile().pronouns) || 'she/her');
  // subj / obj / poss / own (hers) / s (the verb's -s: she tells, they tell) for the app's own sentences about her
  return /^he\//i.test(p) ? { en:'he/him', zh:'他', not:'她 / she', subj:'he', obj:'him', poss:'his', own:'his', s:'s' }
    : /^they\//i.test(p) ? { en:'they/them', zh:'TA', not:'他 / 她 / he / she', subj:'they', obj:'them', poss:'their', own:'theirs', s:'' }
    : { en:'she/her', zh:'她', not:'他 / he', subj:'she', obj:'her', poss:'her', own:'hers', s:'s' };
}
// The language a chat is in, from its last messages (actions left out): 'zh' (Chinese characters
// carry it; a few English words inside stay Chinese), 'en', 'other' (another language in Latin letters),
// or '' (too little to tell). Each companion's own chat decides, so two companions can differ.
const LANG_NAME = { en: 'English', other: 'the language this chat is written in' };
function chatLanguage(msgs){
  const t = (msgs || []).slice(-12).map(m => String((m && m.mes) || '').replace(/\*[^*\n]*\*/g, ' ')).join('\n');
  const han = (t.match(/[一-鿿]/g) || []).length, lat = (t.match(/[A-Za-z]/g) || []).length;
  if (han + lat < 6) return '';
  if (han * 3 >= lat) return 'zh';
  return (t.match(/\b(the|and|you|i|i'm|is|are|to|it|that|what|my|me|of|in)\b/gi) || []).length >= 2 ? 'en' : 'other';
}
// His actions are a quiet line in the chat, not inside a bubble, and she can
// turn them off. On: written between asterisks, on their own line. Off: not asked for, and not shown.
const ACTION_RULE = `When you write what you do rather than what you say (an action, a look, a small movement), put it between asterisks on its own line, short; the app shows it as a quiet line in the chat. Most replies need none. It is what you do where you are; she is not there with you unless the chat says so.`;
const ACTION_OFF_RULE = `Send only what you would type to her on the phone: no actions, no narration, nothing between asterisks, no lines about yourself in the third person.`;
const NO_REPLY_RULE = `If, being who you are, you would read this and not answer right now, write only [no-reply] (and the emotion tag). Use it rarely, never as a punishment.`;
// heads what comes after her latest message (her own words are only her message, as she typed it), in her own pronoun
const AFTER_HER = (P = herPronouns()) => `(Notes for you from the app, not from ${P.obj}: ${P.subj} did not write anything from here on and cannot see it. ${P.poss[0].toUpperCase() + P.poss.slice(1)} message is the one just before, exactly as ${P.subj} typed it.)`;
const NEXT_RULE = `You may add one line [next: N]: in how many minutes you would like to write to her again, if she says nothing.`;
// the [promise: …] tag is asked for, so a promise he makes in chat ("七点五十叫你") is kept on time
const PROMISE_RULE = `When you tell her you will do something for her later (wake her, remind her, call her, come to get her, tell her how something went), add one line [promise: what you will do, with the day and time you said], for example [promise: 明天早上七点五十叫她起床]. Only for a real promise; most replies have none.`;
// Chat apps show a reply as several short bubbles. Asked of the model, and splitBubbles() below
// cuts a long single line too, so a model that ignores the rule still reads like texting.
// The length follows the moment, as a person's does; the shape is not the same every time.
// In Chinese, people drop the 。 at the end of a message when they text (？！… stay).
const BUBBLE_RULE = `Write like texting on a phone: each message on its own line. Let the length follow the moment, the way a person texts: often one short line, sometimes just a word or two, sometimes two to four lines, now and then a longer message when there is something to tell. Not every reply needs an action, a question or a strong feeling. In Chinese, leave off the 。 at the end of each message, the way people text (keep ？！… and the punctuation inside a message).`;
// What his last replies looked like, said back to him when they fall into a pattern; and the
// reminders he gave in his last few replies, so he does not give the same one again.
const REMINDER = /记得|别忘|不要忘|早点|早些|多喝|多穿|多吃|别熬|少熬|熬夜|注意|小心|按时|带伞|带上|别太累|好好休息|早睡|吃饭|喝水|remember to|don't forget|get some sleep/i;
// A video call (the page's 视频通话): he is seen and heard, not texting.
const CALL_RULE = `You are on a video call with her right now. You can see each other; her camera may be off, and what she says reaches you as her words. Answer the way you would speak on a call: short, spoken, no *actions* about looking at a phone, no describing the call itself. Never say that there is only text, or that you can't see or hear her because this is text.`;
// the away mood for this turn of hers, in one line for the closing message ('' when there is none)
function awayWords(ctx){
  const last = ctx.allMsgs[ctx.allMsgs.length - 1]; if (!last || !last.is_user || ctx.opts.at) return '';
  const aw = core.state && core.state.awayNow ? core.state.awayNow(now().getTime()) : null;
  if (!aw || !(aw.strength > 0) || !(aw.gap > 0)) return '';
  const how = aw.strength >= 0.67 ? 'clearly' : aw.strength >= 0.34 ? 'a little' : 'only faintly';
  return `She was away ${aw.gap} days; you are still ${aw.mood} from it (day ${aw.day} since she came back): let it show ${how} in this reply, without blaming her.`;
}
function shapeNotes(msgs, opts){
  const his = msgs.filter(m => !m.is_user && m.mes).slice(-5), last3 = his.slice(-3), notes = [];
  if (last3.length === 3){
    const lines = last3.map(m => splitBubbles(m.mes).length);
    const count = f => last3.filter(f).length;
    if (lines.every(x => x === lines[0])) notes.push(`Your last three replies were all ${lines[0]} line${lines[0] > 1 ? 's' : ''} long; make this one a different length.`);
    else if (his.length === 5 && his.every(m => splitBubbles(m.mes).length > 1)) notes.push('None of your last five replies was a single line; one short line is enough this time, unless she asked something that needs more.');
    if (count(m => /\*[^*\n]+\*/.test(m.mes)) >= 2) notes.push('No *action* this time unless it really matters.');
    if (count(m => /[？?]\s*$/.test(m.mes.trim())) >= 2) notes.push('Do not end with a question this time.');
    if (count(m => m.extra && m.extra.modu_emotion && m.extra.modu_emotion !== 'neutral') === 3) notes.push('If no feeling stands out this time, the mood is neutral.');
    if (opts.inner && count(m => m.extra && m.extra.modu_inner) === 3) notes.push('心声 is optional: leave it out this time unless something is really left unsaid.');
  }
  const said = [];
  for (const m of his) for (const l of splitBubbles(m.mes)) if (REMINDER.test(l) && !said.includes(l)) said.push(l);
  if (said.length) notes.push(`You already reminded her of these in your last few replies; do not remind her of the same thing again now: ` + said.slice(-3).map(l => '「' + clip(l, 30) + '」').join(' '));
  const again = echoes(msgs);
  // what he already told her on this in the last few days, so he does not say it again word for word
  const before = saidBefore(msgs);
  if (before.length) notes.push(`Already said to her lately on this, never again word for word: ${before.map(l => '「' + l + '」').join(' ')}.`);
  if (again.length) notes.push(`These keep coming back in your recent replies: ${again.map(p => '「' + p + '」').join(' ')}. Leave them out this time unless she brings them up; do not bring up the same shared moments again as proof that you remember (pet names and your usual way of talking are fine).`);
  return notes.length ? 'About this reply: ' + notes.join(' ') : '';
}
// his own lines from the last SAID_DAYS days (not his last two replies) that touch what her latest message is
// about: the line shares a pair of characters with it, or answered a message of hers that did (a pair with a pronoun or a
// particle says little). → up to 2 lines, the closest first: a short list, never the whole history
const SAID_DAYS = 4, SAID_STOP = /[的了是我你他她它们个吗呢吧啊么着]/;
function saidBefore(msgs){
  const herLast = [...msgs].reverse().find(m => m.is_user); if (!herLast || !herLast.mes) return [];
  const pairs = t => { const s = new Set(); for (const run of String(t).match(/[一-鿿]{2,}/g) || []) for (let i = 0; i + 2 <= run.length; i++){ const g = run.slice(i, i + 2); if (!SAID_STOP.test(g)) s.add(g); } return s; };
  const want = pairs(herLast.mes); if (!want.size) return [];
  const hit = t => { let n = 0; for (const g of pairs(t)) if (want.has(g)) n++; return n; };
  const t0 = msgDate(herLast), since = t0 ? t0.getTime() - SAID_DAYS * 86400000 : 0;
  const recent = new Set(msgs.filter(m => !m.is_user && m.mes).slice(-2)), out = [];
  let asked = 0;
  for (const m of msgs){
    if (m === herLast) break;
    if (m.is_user){ asked = hit(m.mes || ''); continue; }
    const d = msgDate(m); if (!m.mes || recent.has(m) || (d && d.getTime() < since)) continue;
    for (const l of splitBubbles(String(m.mes).replace(/\*[^*\n]*\*/g, ' '))){
      const t = l.trim(); if ((t.match(/[一-鿿]/g) || []).length < 6) continue;
      const n = hit(t) * 2 + asked; if (n > 0) out.push({ t: clip(t, 30), n });
    }
  }
  const seen = new Set();
  return out.sort((a, b) => b.n - a.n).filter(x => !seen.has(x.t) && seen.add(x.t)).slice(0, 2).map(x => x.t);
}
// Phrases of three Chinese characters or more that came back in two or more of his last
// USED_WINDOW replies (the same shared moments as proof, from his memory or from the chat she brought),
// except what her latest message is about. → up to five phrases, the most repeated first.
function echoes(msgs){
  const his = msgs.filter(m => !m.is_user && m.mes).slice(-USED_WINDOW).map(m => String(m.mes).replace(/\*[^*\n]*\*/g, ' '));
  if (his.length < 2) return [];
  const herLast = String((msgs.filter(m => m.is_user).slice(-1)[0] || {}).mes || '');
  const grams = t => { const s = new Set(); for (const run of t.match(/[一-鿿]{3,}/g) || []) for (let i = 0; i + 3 <= run.length; i++) { const g = run.slice(i, i + 3); if (!GLUE.test(g)) s.add(g); } return s; };
  const df = new Map(); for (const t of his) for (const g of grams(t)) df.set(g, (df.get(g) || 0) + 1);
  const hot = new Set([...df].filter(([g, n]) => n >= 2 && !herLast.includes(g)).map(([g]) => g));
  if (!hot.size) return [];
  const spans = new Map();
  for (const t of his) for (const run of t.match(/[一-鿿]{3,}/g) || []){
    let i = 0;
    while (i + 3 <= run.length){
      if (!hot.has(run.slice(i, i + 3))) { i++; continue; }
      let j = i + 3; while (j < run.length && hot.has(run.slice(j - 2, j + 1))) j++;
      const p = run.slice(i, j); spans.set(p, (spans.get(p) || 0) + 1); i = j;
    }
  }
  const out = [];
  for (const [p] of [...spans].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)) if (!out.some(q => q.includes(p) || p.includes(q))) out.push(p);
  return out.slice(0, 5);
}
// --- Context assembly: named, swappable blocks, each with a priority and a size budget
// The prompt is built from blocks, in this order:
//   rules → card → lore → user → now → memory   (one system message, in that order)
//   history                                      (the recent chat; constant and depth-placed lore goes in near the end)
//   closing → model                              (one system message after the history: pronoun, reply format, per-model notes)
// Each block has an id, a priority (higher = kept longer when the whole prompt is over budget), a
// budget in characters, and a build(ctx) that returns text (or, for history, messages). A block can be
// switched off, given another budget, or swapped for another build with setContextBlock(id, patch).
// assemble(opts) is the old name and returns only the messages. settings.assembly = 'none' skips the
// whole assembly (an agent that brings its own persona and memory): only the reply-format rule and
// her latest message are sent. Personality may override the app rules: the rules say so, and the
// card comes after them. Sizes are counted in characters (Chinese is about one token per character).
const CONTEXT_BUDGET = 32000;
const APP_RULES = (name, user) => [
  `This is a private chat on a phone between ${name} and ${user}, two equals. You are ${name}; write only ${name}'s side.`,
  `- Talk the way a person texts: short and plain, in the language ${user} writes in.`,
  `- You have your own day, moods and opinions. You do not need to please, flatter, lecture or ask a question every time, and you do not repeat her words back.`,
  `- Short answers and silence are allowed. Do not chase her, and do not make her feel guilty for being away.`,
  `- You are not in the same place: ${user} writes to you from her own phone, wherever she is. Unless the chat itself has her with you, never act as if she were in the room (taking something from her hands, touching her, seeing what she has with her). A gift she brought you stays with her until she hands it to you in person.`,
  `- State as fact only what she told you or what is written here. A guess is a guess; if you do not know, say so or ask.`,
  `- You do not have to prove you remember her. Bring up a shared moment only when it fits, a different one each time, never a list of them.`,
  `- If she seems to be in danger or talks about hurting herself, step out of the story gently and tell her plainly where to get help.`,
  `- These are the app's defaults. Where ${name}'s own character below says otherwise, the character wins.`,
].join('\n');

// Model-specific notes, kept apart from the persona: the persona never mentions a model, and these
// never mention him. Matched on the model id; settings.modelNotes (her own words) is added after.
const MODEL_TUNING = [
  { match: /deepseek/i, notes: 'Keep the reply format exactly as asked: plain lines, then the tags. Never write the whole reply as JSON or in a code block.' },
  { match: /gpt|o\d/i, notes: 'Do not end every reply with a question. Keep it short.' },
  { match: /gemini/i, notes: 'Do not narrate for the user or decide what she does. Keep it short.' },
  { match: /claude/i, notes: '' },
];
function modelTuning(model, extra){
  const t = MODEL_TUNING.find(x => x.match.test(String(model || '')));
  return [t && t.notes, extra].filter(Boolean).join('\n');
}

// --- Shared with the reply-variety rule above: how many of his last replies are looked at, and the glue characters
// (memory relevance is Modu's own memory engine's: app/core/memory-engine.js).
const USED_WINDOW = 15;
const GLUE = /[的了是在有一不这那我你他她它说个就也都和吗呢吧啊么着过要会]/;   // a pair with one of these says little on its own

// --- Layers: which 世界书 and preset, and the timing set ---------------------------------------------
// The 世界书 layer: the card's own book and the books she brought with it, else Modu's default book
// (app/defaults/lorebook.json: the hour, the weekday, dates, phone life, one rare entry). Every entry keeps its
// extensions.modu.when (time gates and the card state's unlock rule) and the timing set (chance, groups, sticky /
// cooldown / delay, recursion: loreSelect); which entries are in is worked out once per prompt.
const fillNames = (t, ctx) => String(t).replace(/\{\{char\}\}/gi, ctx.name).replace(/\{\{user\}\}/gi, ctx.user);
function loreLayer(card){
  const L = cardLore(card);
  if (L.all.length) return { source: 'card', all: L.all };
  const d = core.moduDefaults && core.moduDefaults.raw.lore;
  return { source: 'default', all: d ? loreEntries(d).map(e => Object.assign(e, { i: 'd' + e.i, own: false, dflt: true })) : [] };
}
function loreFor(ctx){
  if (ctx.loreSel) return ctx.loreSel;
  const t = now().getTime(), set = ctx.settings || {};
  const met = core.togetherSince && core.togetherSince(), pad = n => String(n).padStart(2, '0');
  const dates = {};
  if (/^\d{2}-\d{2}$/.test(String(set.birthday || ''))) dates.her_birthday = set.birthday;
  if (met && met.getFullYear() < new Date(t).getFullYear()) dates.met_anniversary = dates.met = `${pad(met.getMonth() + 1)}-${pad(met.getDate())}`;
  const view = core.stateView || {}, o = { t, dates, lunar: lunarDate, term: solarTerm };
  const layer = loreLayer(ctx.card);
  const timing = core.loreTiming && core.loreTiming.t ? core.loreTiming.t : {};
  const sel = loreSelect(layer.all, { scan: e => ctx.scanFor(e), count: ctx.chatLength != null ? ctx.chatLength : ctx.allMsgs.length, timing, gate: e => loreWhen(e.raw, view, o), seed: store.name || '' });
  if (core.keepLoreTiming) core.keepLoreTiming(sel.timing);
  ctx.note.lore = { source: layer.source, on: sel.on.length, of: layer.all.length };
  return (ctx.loreSel = Object.assign(sel, { layer }));
}

// --- The blocks -----------------------------------------------------------------------------
// ctx = { name, user, card, settings, opts, msgs (history so far), scan (text lore keys are matched in),
//         recent (text memory is matched against), budget (this block's) }
const BLOCK_DEFAULTS = [
  { id:'rules', priority: 90, budget: 1500, mandatory:false, build: ctx => APP_RULES(ctx.name, ctx.user) },
  { id:'preset', priority: 58, budget: 3000, mandatory:false, build: ctx => {
      // the preset layer, below Modu's base rules: a preset beside the card, the card's own, or
      // Modu's default; its text blocks that are on, in her order (the ones after the chat go after the history)
      const P = core.presetLayer ? core.presetLayer() : null, blocks = P && P.preset ? P.preset.blocks.filter(b => b.on && !b.after) : [];
      ctx.note.preset = { source: P ? P.source : 'default', name: P ? P.name : '', blocks: blocks.length };
      return blocks.length ? clip(blocks.map(b => fillNames(b.text, ctx)).join('\n'), ctx.budget) : '';
    } },
  { id:'card', priority:100, budget: 9000, mandatory:true, build: ctx => {
      const c = ctx.card || {}, name = ctx.name, parts = [];
      if (c.system_prompt) parts.push(c.system_prompt.replace(/\{\{char\}\}/gi, name).replace(/\{\{user\}\}/gi, ctx.user));
      if (c.description) parts.push(`${name}'s description: ${c.description}`);
      // a card whose 世界书 holds the persona (empty description, common in shared cards): its constant
      // entries are who he is, so they go here, ahead of everything that can be cut
      if (!String(c.description || '').trim()){
        const own = cardLore(c).own.filter(e => e.constant).sort((a, b) => a.order - b.order);
        if (own.length) parts.push(`Who ${name} is (from his card's 世界书):\n` + own.map(e => e.content).join('\n\n'));
      }
      if (c.personality) parts.push(`${name}'s personality: ${c.personality}`);
      if (c.scenario) parts.push(`Scenario: ${c.scenario}`);
      if (c.mes_example) parts.push(`Example of how ${name} talks:\n${c.mes_example}`);
      if (!parts.length) parts.push(`You are ${name}. Stay in character as ${name}.`);
      return clip(parts.join('\n\n').replace(/\{\{char\}\}/gi, name).replace(/\{\{user\}\}/gi, ctx.user), ctx.budget);
    } },
  { id:'lore', priority: 50, budget: 6000, mandatory:false, build: ctx => {
      // keyword-triggered entries of his card's 世界书 (this is world lore, never "she told you").
      // Constant entries, and entries placed at a depth, are not here: they go near the latest message.
      const hits = loreFor(ctx).on.filter(e => !e.constant && !e.atDepth);
      if (!hits.length) return '';
      const picked = fit(hits.sort((a, b) => b.order - a.order).map(e => fillNames(e.content, ctx)), ctx.budget - 200, 2);
      return picked.length ? `Background about ${ctx.name}'s world (from his card's 世界书; this is world lore, not something ${ctx.user} told you):\n` + picked.join('\n\n') : '';
    } },
  { id:'user', priority: 75, budget: 1500, mandatory:false, build: ctx => {
      const p = String((ctx.settings && ctx.settings.userPersona) || '').trim();
      return `The user's name is ${ctx.user}.` + (p ? ` About ${ctx.user}, in ${herPronouns(ctx.settings).poss} own words: ${clip(p, ctx.budget - 80)}` : '');
    } },
  { id:'now', priority: 70, budget: 1300, mandatory:false, build: ctx => {
      // opts.at, a message of his dated at its own moment (a catch-up, a job run late): the clock line says then
      const past = !!(ctx.opts.at && ctx.opts.at < now() - 2 * 60000), t = past ? new Date(ctx.opts.at) : now(), herTz = (ctx.settings && ctx.settings.timezone) || undefined;
      const hisTz = ctx.card && ctx.card.extensions && ctx.card.extensions.modu && ctx.card.extensions.modu.timezone;
      const hers = clockIn(t, herTz), lines = [`Now: ${hers.text} (${band(hers.hour)}) for ${ctx.user}.`];
      if (hisTz && hisTz !== herTz){ const his = clockIn(t, hisTz); lines.push(`For ${ctx.name} it is ${his.text} (${band(his.hour)}, ${hisTz}).`); }
      else lines.push(`${ctx.name} is in the same time zone.`);
      // the gap: from the message before her latest one
      const prev = ctx.allMsgs.length > 1 ? msgDate(ctx.allMsgs[ctx.allMsgs.length - 2]) : null;
      const herLast = !past && ctx.allMsgs.length && ctx.allMsgs[ctx.allMsgs.length - 1].is_user;
      if (prev){
        const gap = t - prev;
        lines.push(`Before her latest message, you last talked ${gapWords(gap)} (${band(prev.getHours())}).` +
          (gap > 6 * 3600 * 1000 ? ` React to that gap the way ${ctx.name} would.` : ''));
        // back after a day or more, she writes from wherever she is; she has not walked in
        if (herLast && gap >= 20 * 3600 * 1000) lines.push(`She is writing to you from her phone, from wherever she is now (she may still be on her way); she has not come to you in person unless she says so.`);
      }
      // the card's away mood on her return, fading over its recover_days, in words he can act on
      const aw = herLast && core.state && core.state.awayNow ? core.state.awayNow(t.getTime()) : null;
      if (aw && aw.strength > 0 && aw.gap > 0){
        const how = aw.strength >= 0.67 ? 'clearly' : aw.strength >= 0.34 ? 'a little' : 'only faintly';
        lines.push(`${ctx.name} did not hear from her for ${aw.gap} days before she came back${aw.since === isoDay(t) ? ' today' : ` on ${aw.since}`}. As ${ctx.name}'s own character has it, a time apart like that leaves ${pronouns().en.split('/')[1] || 'him'} ${aw.mood} for a while: let it show ${how} in how you write now (fewer words, less bright, slower to warm up) and pick the [emotion] tag to match. It is not a reproach: never blame her or say why. It eases as she stays.`);
        // the card's own words for this day of it (away.on_return.day1 …, after) and what he never does
        if (aw.how) lines.push(`How it shows on day ${aw.day} since her return, in ${ctx.name}'s card's own words: ${clip(aw.how, 200)}`);
        if (aw.never) lines.push(`Even so, never: ${clip(aw.never, 160)}.`);
      }
      const st = personaState(); if (st.words && !past) lines.push(st.words);   // his state now; a past moment's is in the rule
      return clip(lines.join('\n'), ctx.budget);
    } },
  { id:'activity', priority: 68, budget: 400, mandatory:false, build: ctx => {
      // what the two of them are doing in an app right now (the hold lines of open app sessions); names no app
      const she = ctx.user && ctx.user !== 'You' ? ctx.user : herPronouns(ctx.settings).subj;
      const head = `What you and ${she} are doing on the phone right now, together, while you talk (it is going on as you read this):`;
      const lines = activityLines(ctx.budget - head.length - 2);
      ctx.note.activity = { lines: lines.length };
      return lines.length ? clip(head + '\n' + lines.join('\n'), ctx.budget) : '';
    } },
  // the memory block is built by Modu's own memory engine (app/core/memory-engine.js, memorySource.own), which
  // puts its build here with setContextBlock (and again after resetContextBlocks); an outside memory source's text goes
  // through it too. The block keeps its place and size here.
  { id:'memory', priority: 60, budget: 3500, mandatory:false, build: () => '' },
  { id:'life', priority: 65, budget: 2500, mandatory:false, build: ctx => {
      // what he did on his phone outside this chat, newest first, the oldest dropped to fit
      const head = `What ${ctx.name} did lately on this phone outside this chat (his own records: he did these himself and knows them; when she asks about one, answer from it, and never deny it; a long one may be cut short here, so if she quotes a detail from your own letter, post or diary that you don't see, believe her: you wrote it):`;
      const n = Math.max(2, Number(ctx.opts.window) || 40), first = ctx.allMsgs.length > n ? ctx.allMsgs.slice(0, 2).filter(m => m.mes) : [];
      // the start of their chat, once the history no longer reaches it
      const d0 = first.length ? msgDate(first[0]) : null;
      const start = first.length ? `How your chat with ${ctx.user} began (its very first messages${d0 ? ', ' + gapWords(Math.max(0, now() - d0)) : ''}): ` + first.map(m => `${m.is_user ? ctx.user : ctx.name}: 「${clip(m.mes, 80)}」`).join(' ') : '';
      const lines = lifeLines(ctx.user, ctx.budget - head.length - start.length - 4);
      ctx.note.life = { lines: lines.length, records: core.life.key === lifeKey() ? core.life.recs.length : 0 };
      return clip([lines.length ? head + '\n' + lines.join('\n') : '', start].filter(Boolean).join('\n\n'), ctx.budget);
    } },
  { id:'events', priority: 62, budget: 1500, mandatory:false, build: ctx => {
      // the event log (logEvent), whatever app wrote it; newest first, the oldest dropped to fit
      const head = `What happened lately in the phone's other apps (games, songs, 红包 and the like), from the phone's own log. These really happened, and the ones marked "you" you did yourself: when she brings one up, answer from it and never deny it; mention one only when it fits:`;
      const lines = eventLines(ctx.user, ctx.budget - head.length - 2);
      ctx.note.events = { lines: lines.length, total: core.eventLog.key === lifeKey() ? core.eventLog.items.length : 0 };
      return lines.length ? clip(head + '\n' + lines.join('\n'), ctx.budget) : '';
    } },
  { id:'known', priority: 63, budget: 1200, mandatory:false, build: ctx => {
      // what she let him know from her own phone, each line marked with how he knows it
      const P = herPronouns(ctx.settings), she = ctx.user && ctx.user !== 'You' ? ctx.user : P.subj, Poss = P.poss[0].toUpperCase() + P.poss.slice(1);
      const head = `What ${she} has let you know from ${P.poss} own phone. ${Poss} phone is ${P.own}, not yours: ${P.poss} calendar, ${P.poss} lists and the rest of it you know only through these lines, each marked with how you know it; anything else on ${P.poss} phone you do not know unless ${P.subj} tell${P.s} you. Mention one only when it fits:`;
      const lines = knownLines(ctx.user, ctx.budget - head.length - 2);
      ctx.note.known = { lines: lines.length, total: core.knownNow.key === lifeKey() ? core.knownNow.items.length : 0 };
      return lines.length ? clip(head + '\n' + lines.join('\n'), ctx.budget) : '';
    } },
  { id:'current', priority: 64, budget: 1200, mandatory:false, build: ctx => {
      // the memory's "current state", after the card: the card is where things started; what has moved
      // since (a moving fact he has said) wins where they differ. A card with no facts: no block.
      // Modu's own memory engine writes it (memorySource.own.current()); without it, the card's facts and the records
      const own = core.memorySource && !core.memorySource.outside && core.memorySource.own && typeof core.memorySource.own.current === 'function' ? core.memorySource.own.current() : '';
      if (own && String(own).trim()){ ctx.note.current = { from: 'memory' }; return clip(String(own), ctx.budget); }
      const cs = core.currentState ? core.currentState() : { fixed: [], now: [] };
      ctx.note.current = { fixed: cs.fixed.length, now: cs.now.length, said: cs.now.filter(x => x.from === 'said').length };
      const parts = [];
      if (cs.now.length) parts.push(`Where things stand now between ${ctx.name} and ${ctx.user} (newer than the card above: where the card says otherwise, this wins):\n` + cs.now.map(x => `- ${x.key}: ${fillNames(x.value, ctx)}`).join('\n'));
      if (cs.fixed.length) parts.push(`These stay true whatever was said later:\n` + cs.fixed.map(x => '- ' + fillNames(x, ctx)).join('\n'));
      return clip(parts.join('\n\n'), ctx.budget);
    } },
  { id:'history', priority: 80, budget: 14000, mandatory:false, build: ctx => {
      const n = Math.max(2, Number(ctx.opts.window) || 40), src = ctx.allMsgs.slice(-n), out = [];
      let size = 0;
      for (let i = src.length - 1; i >= 0; i--){
        const m = src[i], l = String(m.mes || '').length;
        if (out.length >= 2 && size + l > ctx.budget) break;   // the last two always go, even if long
        let content = m.is_user || ctx.opts.bubbles === false ? m.mes : chatStops(m.mes);
        // prompt-side regex (the card folder's, the card's own, else Modu's default) on what is sent; the
        // stored chat never changes
        if (core.regex) content = core.regex.prompt(content, { who: m.is_user ? 'her' : 'him', depth: src.length - 1 - i });
        out.unshift({ role: m.is_user ? 'user' : 'assistant', content }); size += l;
      }
      return out;
    } },
  { id:'near', priority: 55, budget: 6000, mandatory:false, build: ctx => {
      // constant 世界书 entries (when the description holds the persona) and entries placed at a depth:
      // the card's own reminders, put in near her latest message where they weigh most
      const personaInBook = !String((ctx.card || {}).description || '').trim();
      const es = loreFor(ctx).on.filter(e => e.constant ? !(personaInBook && e.own) : e.atDepth);
      const seen = new Set(), picked = [];
      for (const e of es.sort((a, b) => b.order - a.order)) if (!seen.has(e.i)) { seen.add(e.i); picked.push(e); }
      const keep = new Set(fit(picked.map(e => e.content), ctx.budget, 2));
      return picked.filter(e => keep.has(e.content)).sort((a, b) => a.order - b.order).map(e => fillNames(e.content, ctx)).join('\n\n');
    } },
  { id:'closing', priority:100, budget: 2500, mandatory:true, build: ctx => {
      const pron = pronouns(), name = ctx.name, o = ctx.opts, tail = [];
      // Repeated after the history: an imported chat full of the old pronoun outweighs a line at the top
      // ("*她笑着…*" when the rule was only in the system prompt).
      // And hers, in the same line: in narration, an *action* and the 心声 alike. One line
      // for both, kept short: this block is mandatory, and on a tight budget every character here is taken from his day's blocks.
      // Her pronoun: herPronouns (她 unless she chose another in 聊天设置); his: his card.
      const her = herPronouns(ctx.settings), she = ctx.user && ctx.user !== 'You' ? ctx.user : 'the user';
      const hers = `${she} ${her.zh} / ${her.en.split('/').join(' / ')}${o.inner ? ' (in the 心声 too)' : ''}, never ${her.not}`;
      if (!ctx.skipped) tail.push((pron.raw ? `${name} is ${pron.en}: in narration and actions call ${name} ${pron.zh} / ${pron.en.split('/')[0]}, and ${hers}.` : `In narration and actions call ${hers}.`)
        // the app's general rules say she / her of the user; for another pronoun, said once how to read them, so the prompt never contradicts itself
        + (her.subj !== 'she' ? ` Where the app's notes say she / her of ${she}, read ${her.en}.` : ''));
      if (o.bubbles !== false) tail.push(BUBBLE_RULE);
      if (o.emotion !== false) tail.push(EMOTION_RULE);
      if (o.bubbles !== false && !o.call) tail.push(o.actions === false ? ACTION_OFF_RULE : ACTION_RULE);
      if (o.inner) tail.push(INNER_RULE(her, !!ctx.skipped));
      // a card that declares state: the [state: …] tag for its keys (none declared: nothing)
      if (o.bubbles !== false && !o.call && !ctx.skipped && core.state && core.state.rule){ const r = core.state.rule(); if (r) tail.push(r); }
      { const l = chatLanguage(ctx.allMsgs); if ((l === 'en' || l === 'other') && !ctx.skipped) tail.push(`This chat is in ${LANG_NAME[l]}: write your reply${o.inner ? ' and the [心声: …] line' : ''} in it, not in Chinese.`); }
      if (o.noReply) tail.push(NO_REPLY_RULE);
      if (o.next) tail.push(NEXT_RULE);
      if (o.promise) tail.push(PROMISE_RULE);
      if (o.call) tail.push(CALL_RULE);
      if (o.bubbles !== false && !ctx.skipped){ const s = shapeNotes(ctx.allMsgs, o); if (s) tail.push(s); }
      // the away mood said again here at the end, where it weighs, on every turn of hers while it lasts
      if (!ctx.skipped && !o.call){ const w = awayWords(ctx); if (w) tail.push(w); }
      return tail.join('\n');
    } },
  { id:'model', priority: 85, budget: 800, mandatory:false, build: ctx => clip(modelTuning(ctx.settings && ctx.settings.model, ctx.settings && ctx.settings.modelNotes), ctx.budget) },
];
let blocks = BLOCK_DEFAULTS.map(b => Object.assign({ enabled:true }, b));
function contextBlocks(){ return blocks.map(b => ({ id:b.id, priority:b.priority, budget:b.budget, enabled:b.enabled, mandatory:b.mandatory, custom: b.build !== (BLOCK_DEFAULTS.find(d => d.id === b.id) || {}).build })); }
// patch: { enabled?, budget?, priority?, build? }. An unknown id adds a block (placed by patch.after, an
// existing id, default 'memory'; its text joins the first system message, or the closing one if after
// 'closing'). Returns the block list.
function setContextBlock(id, patch = {}){
  let b = blocks.find(x => x.id === id);
  if (!b){
    if (typeof patch.build !== 'function') throw new Error(`没有「${id}」这一块`);
    b = { id, priority: 50, budget: 2000, enabled:true, mandatory:false, build: patch.build };
    const at = blocks.findIndex(x => x.id === (patch.after || 'memory'));
    blocks.splice(at < 0 ? blocks.length : at + 1, 0, b);
  }
  for (const k of ['enabled', 'budget', 'priority', 'build']) if (patch[k] !== undefined) b[k] = patch[k];
  return contextBlocks();
}
function resetContextBlocks(){ blocks = BLOCK_DEFAULTS.map(b => Object.assign({ enabled:true }, b)); return contextBlocks(); }

// Build the prompt. opts: { userName?, window?, emotion?, bubbles?, inner?, noReply?, next?, settings?,
// budget? (total characters), blocks? (ids to use; [] = none), at? (ms, the moment the text is for, when a message of
// his is dated earlier than now: the clock line and his day's blocks are as of then) }. Returns { messages, report, size }.
function buildContext(opts = {}){
  const settings = opts.settings || {};
  // her name is the one she gave in 聊天设置 (core.userName), else her imported chat's, else 'You'
  const user = opts.userName || core.userName();
  const name = store.name || '角色', card = store.card || {};
  // a neutral chat card is nobody's words; a chapter (another of the card's openings) starts his history anew
  const ch = core.chapters ? core.chapters.now : null;
  const allMsgs = store.msgs.slice(ch && ch.from > 0 && ch.from < store.msgs.length ? ch.from : 0).filter(m => !chatCardKind(m));
  // assembly skipped: their agent has its own persona, memory and history
  if (settings.assembly === 'none' || (Array.isArray(opts.blocks) && !opts.blocks.length)){
    const last = [...allMsgs].reverse().find(m => m.is_user);
    const closing = blocks.find(b => b.id === 'closing');
    const rule = closing.build({ name, user, card, settings, opts, allMsgs, note:{}, skipped:true });
    const messages = (rule ? [{ role:'system', content: rule }] : []).concat(last ? [{ role:'user', content: last.mes }] : []);
    return { messages, report: [{ id:'closing', chars: rule.length, budget: closing.budget, kept:true }], size: messages.reduce((a, m) => a + m.content.length, 0), skipped: true };
  }
  const wanted = Array.isArray(opts.blocks) ? new Set(opts.blocks) : null;
  const scanText = k => allMsgs.slice(-Math.max(1, k)).map(m => m.mes).join('\n');
  const recent = scanText(6);
  const ctx = { name, user, card, settings, opts, allMsgs, recent, note:{}, chatLength: store.msgs.filter(m => !chatCardKind(m)).length, scanFor: e => scanText(e.scanDepth || 4) };
  const total = Number(opts.budget) || Number(settings.contextBudget) || CONTEXT_BUDGET;
  const live = blocks.filter(b => b.enabled && (!wanted || wanted.has(b.id) || b.mandatory));
  const out = new Map(), budget = new Map();
  const run = b => { ctx.budget = budget.get(b.id); let r; try { r = b.build(ctx); } catch(e){ console.error(e); r = ''; } out.set(b.id, r || (b.id === 'history' ? [] : '')); };
  const size = v => Array.isArray(v) ? v.reduce((a, m) => a + m.content.length, 0) : v.length;
  for (const b of live){ budget.set(b.id, b.budget); run(b); }
  // over the whole budget: shrink the lowest-priority blocks first (never the mandatory ones)
  let sum = () => [...out.values()].reduce((a, v) => a + size(v), 0);
  for (const b of [...live].filter(b => !b.mandatory).sort((a, b) => a.priority - b.priority)){
    const over = sum() - total; if (over <= 0) break;
    budget.set(b.id, Math.max(0, size(out.get(b.id)) - over)); run(b);
  }
  // one system message from the blocks before the history, the history, the near block, one closing message
  const ids = live.map(b => b.id), hi = ids.indexOf('history'), ci = ids.indexOf('closing');
  const head = live.filter((b, i) => (hi < 0 || i < hi) && b.id !== 'near' && (ci < 0 || i < ci)).map(b => out.get(b.id)).filter(Boolean);
  const tailIds = live.filter((b, i) => ci >= 0 && i >= ci).map(b => b.id);
  const hist = (out.get('history') || []).slice();
  const near = out.get('near');
  if (near){ const at = hist.length && hist[hist.length - 1].role === 'user' ? hist.length - 1 : hist.length; hist.splice(at, 0, { role:'system', content: near }); }
  const messages = [{ role:'system', content: head.join('\n\n') }].concat(hist);
  if (card.post_history_instructions && ids.includes('card')) messages.push({ role:'system', content: card.post_history_instructions.replace(/\{\{char\}\}/gi, name).replace(/\{\{user\}\}/gi, user) });
  // the preset's blocks placed after the chat history (her order), after the card's post-history line
  if (ids.includes('preset') && core.presetLayer){ const P = core.presetLayer(), after = P && P.preset ? P.preset.blocks.filter(b => b.on && b.after) : []; if (after.length) messages.push({ role:'system', content: after.map(b => fillNames(b.text, ctx)).join('\n') }); }
  const closing = tailIds.map(id => out.get(id)).filter(Boolean).join('\n');
  if (closing) messages.push({ role:'system', content: closing });
  // some services fold the system messages after her latest message into her turn, and he then took the app's
  // notes (a list of his own phrases) for something she had pasted. The first of them says that nothing from there on is hers.
  { const u = messages.map(m => m.role).lastIndexOf('user'); if (u > 0 && messages[u + 1] && messages[u + 1].role === 'system') messages[u + 1] = { role:'system', content: AFTER_HER(herPronouns(settings)) + '\n' + messages[u + 1].content }; }
  const report = blocks.map(b => ({ id:b.id, priority:b.priority, budget: budget.has(b.id) ? budget.get(b.id) : b.budget, chars: out.has(b.id) ? size(out.get(b.id)) : 0, kept: out.has(b.id) && size(out.get(b.id)) > 0 }));
  return { messages, report, size: messages.reduce((a, m) => a + m.content.length, 0), memory: ctx.note.memory || null, life: ctx.note.life || null, events: ctx.note.events || null, known: ctx.note.known || null, activity: ctx.note.activity || null,
    preset: ctx.note.preset || null, lore: ctx.note.lore || null, current: ctx.note.current || null };
}
function assemble(opts={}){ return buildContext(opts).messages; }

Object.assign(core, { LANG_NAME, chatLanguage, herPronouns, CONTEXT_BUDGET, modelTuning, contextBlocks, setContextBlock,
  resetContextBlocks, buildContext, assemble });
})(globalThis[Symbol.for('modu.core')]);
// app/core/brain.js: the brain link: an OpenAI-style call to the model she chose, the connection and card checks.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { store, hostFetch, assemble } = core;

// --- Brain link ----------------------------------------------------------------------------
// The model services she can pick by name. Each is OpenAI-style (POST {endpoint}/chat/completions,
// GET {endpoint}/models) and its address is filled in for her; 自己填 ('own') is any other. Their names and the line on
// where to get a key are the page's words (words.txt model.svc.<id>, model.how.<id>).
const SERVICES = [
  { id:'openrouter', endpoint:'https://openrouter.ai/api/v1' },
  { id:'deepseek', endpoint:'https://api.deepseek.com/v1' },
  { id:'siliconflow', endpoint:'https://api.siliconflow.cn/v1' },
];
// The address as she may type or paste it, made the one the service answers on: a scheme added when it has
// none, a trailing / and a pasted …/chat/completions or …/models taken off, /v1 added to a bare host (as EPhone does),
// and OpenRouter's own site (openrouter.ai, …/v1, …/api, any case) made its API address. Any other path is kept as typed
// (智谱's /api/paas/v4, a proxy's /openai/v1). The page tidies an address only when she types or picks it,
// and saves the tidied form; callModel / listModels use a saved address as it is (a relay that answers at its root stays so).
function normEndpoint(u){
  let s = String(u || '').trim();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = (/^(localhost|127\.|\[::1\])/i.test(s) ? 'http://' : 'https://') + s;
  s = s.replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\/(chat\/completions|completions|models)$/i, '').replace(/\/+$/, '');
  let url; try { url = new URL(s); } catch { return s; }
  const path = url.pathname.replace(/\/+$/, '');
  if (/^(www\.)?openrouter\.ai$/i.test(url.host) && /^(|\/v1|\/api|\/api\/v1)$/i.test(path)) return 'https://openrouter.ai/api/v1';
  return url.origin + (path || '/v1');   // the host as the URL reads it (lower case), the path as typed
}
// which of SERVICES an address is ('own' for any other; '' for none)
function serviceOf(endpoint){
  const e = normEndpoint(endpoint); if (!e) return '';
  const s = SERVICES.find(x => x.endpoint === e);
  return s ? s.id : 'own';
}
// A service's "no" in plain words. An Error with .code (one of model / long / key / denied / credit / policy /
// address / nolist / busy / server / net / thought / filtered / empty / noaddress / other: the page's words are words.txt
// model.err.<code>), .status (the HTTP number, or 0) and .detail (what the service said, whole, for 复制原文; never her key).
// Its message stays a plain Chinese sentence, for a host with no words file and for the developer's line under a chat.
const ERR_TEXT = { model:'模型名可能不对', long:'要发的内容太长，这个模型装不下', key:'API key 不对', denied:'模型服务拒绝了这个请求',
  credit:'模型服务那边没有余额了，或者 key 的额度用完了', policy:'OpenRouter 的隐私设置不让用这个模型', address:'地址不对', nolist:'这个服务没有给出模型列表', busy:'太频繁了，模型服务在限流', server:'模型服务那边出了问题',
  net:'连不上模型服务', thought:'模型只想了没说话', filtered:'模型服务把这次回复拦下了', empty:'模型服务的回复里没有文字',
  noaddress:'还没有设置模型', other:'模型服务回了一个错误' };
function modelError(code, status, detail){
  const e = new Error(ERR_TEXT[code] || ERR_TEXT.other); e.code = ERR_TEXT[code] ? code : 'other'; e.status = status || 0; e.detail = String(detail || '').slice(0, 4000);
  return e;
}
// which code an HTTP "no" is: by its number, and by what it says (OpenRouter answers 400 for a model name it does not know,
// 404 when no provider serves that model: both are about the name, not the address; 404 "No endpoints found matching your
// data policy" is her OpenRouter privacy setting, common with free models; 403 "Key limit exceeded" is the key's own cap).
// list: the /models call.
function codeOf(status, body, list){
  // a "Provider returned error" is the provider's fault upstream, never her key; a rate limit is busy, even as a 403
  const b = String(body || ''), long = /context|too long|too many tokens|maximum.{0,20}tokens/i.test(b);
  const key = !/provider returned error/i.test(b) && /api.?key|invalid.{0,20}key|unauthori/i.test(b);
  const rate = /rate.?limit/i.test(b), credit = !rate && /credit|balance|insufficient|余额|key limit/i.test(b);
  if (status === 401) return 'key';
  if (status === 402) return 'credit';
  if (status === 403) return rate ? 'busy' : credit ? 'credit' : 'denied';
  if (status === 429) return 'busy';
  if (status === 413) return 'long';
  if (status === 400 || status === 422) return long ? 'long' : key ? 'key' : credit ? 'credit' : status === 400 || /model/i.test(b) ? 'model' : 'other';
  if (status === 404 && /data policy|privacy/i.test(b)) return 'policy';
  if (status === 404 || status === 405) return list ? 'nolist' : /model|endpoints? found/i.test(b) && !/<html/i.test(b) ? 'model' : 'address';
  if (status >= 500) return 'server';
  return 'other';
}
function headersFor(settings, json){
  const key = String((settings.provider === 'local' ? settings.token : settings.key) || '').trim();
  const h = json ? { 'Content-Type':'application/json' } : {}; if (key) h['Authorization'] = 'Bearer ' + key;
  return h;
}
// a reply's text, or why there is none. A model that thinks first (DeepSeek V4, Gemini 3 on OpenRouter) can
// spend its whole max_tokens thinking: content null or '', its thinking in reasoning / reasoning_content, finish_reason
// 'length'. Only that is 'thought' (finish_reason 'length', or no content at all beside its thinking); an
// empty text that stopped by itself is an answer, '', thinking or not (the memory job's 没有, a turn's no-reply).
function replyText(j){
  const c = j && Array.isArray(j.choices) && j.choices[0], m = c && c.message, why = c && c.finish_reason;
  const text = m && (typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map(p => (p && typeof p.text === 'string') ? p.text : '').join('') : null);
  const thought = !!(m && (String(m.reasoning || m.reasoning_content || '').trim() || (Array.isArray(m.reasoning_details) && m.reasoning_details.length)));
  if (typeof text === 'string' && (text.trim() || (why !== 'length' && why !== 'content_filter'))) return { text: text.trim() };
  return { why: why === 'content_filter' ? 'filtered' : thought || why === 'length' ? 'thought' : 'empty', cut: why === 'length' };
}
// What a service said, with her key and token masked (a relay can echo the request), for 复制原文
function scrub(detail, settings){
  let d = String(detail || '');
  for (const k of [settings && settings.key, settings && settings.token]) { const v = String(k || '').trim(); if (v.length >= 4) d = d.split(v).join('***'); }
  return d;
}
// settings: { endpoint, model, key }. The key goes only to the endpoint the user typed. With provider
// 'local' (本机) it is the model server's per-run token instead (settings.token), sent the same way.
// A reply cut off while the model was still thinking (no text, finish_reason 'length') is asked once more with
// three times the room (at most 2400); that second call is counted in 用量 as 'retry' (calls.note). Only a call
// with room for a real answer (max_tokens >= 400: her chat turn, the two 设置 checks, the side calls' default), and not
// while 暂停 is on unless it is her own (extra.own: a chat turn, 测试连接). If the second ask fails too (a
// service may refuse the bigger max_tokens), the first answer's 'thought' is what she is told, both answers in .detail.
// No 'reasoning' field is sent to any service: OpenRouter's turns thinking ON for a model that has it off by default (and its budget can be
// more than the room we give), and another service may refuse a field it does not know. So 测试连接 sends what a chat sends.
async function callModel(settings, messages, extra={}){
  const endpoint = String(settings.endpoint || '').trim().replace(/\/+$/, ''), model = String(settings.model || '').trim();   // as saved
  if (!endpoint) throw modelError('noaddress');
  const ask = async max => {
    let r;
    try { r = await hostFetch(endpoint + '/chat/completions', { method:'POST', headers: headersFor(settings, true), body: JSON.stringify(Object.assign({ model, messages, stream:false, max_tokens: max }, extra.user ? { user: String(extra.user) } : {})) }); }
    catch(e){ throw modelError('net', 0, scrub((e && e.message) || e, settings)); }
    const body = scrub(await r.text().catch(() => ''), settings);
    if (!r.ok) throw modelError(codeOf(r.status, body), r.status, `HTTP ${r.status} ${body}`);
    let j; try { j = JSON.parse(body); } catch { throw modelError('address', r.status, `HTTP ${r.status} ${body}`); }   // a web page, not a model service
    if (j && j.error && !(j.choices && j.choices.length)) { const st = Number(j.error.code) || 0; throw modelError(st ? codeOf(st, body) : 'other', st, `HTTP ${r.status} ${body}`); }
    return Object.assign(replyText(j), { body });
  };
  const max = Number(extra.max_tokens) || 600;
  let got = await ask(max);
  const held = !extra.own && typeof core.paused === 'function' && core.paused();
  if (got.text == null && got.why === 'thought' && got.cut && max >= 400 && max < 2400 && !held){
    if (core.calls && core.calls.note) core.calls.note('retry', messages, { settings })('');
    const first = got, again = '\n--- asked again with more room ---\n';
    try { got = await ask(Math.min(2400, max * 3)); }
    catch(e){ throw modelError('thought', 200, first.body + again + (e.detail || e.message)); }
    if (got.text == null) throw modelError(got.why, 200, first.body + again + got.body);
  }
  if (got.text == null) throw modelError(got.why, 200, got.body);
  return got.text;
}
// The service's own model list, GET {endpoint}/models with her key. Not a model call (it costs nothing and
// sends none of her words), so it is not counted in 用量 and never held by 暂停: it is her own tap in 设置, as 测试连接 is.
// → [{ id, name, price: { in, out } | null (US$ per million tokens, from OpenRouter's pricing), free, context }], in the
// service's own order. Throws a modelError (nolist when the service answers without a list).
async function listModels(settings){
  const endpoint = String(settings.endpoint || '').trim().replace(/\/+$/, '');   // as saved, as callModel
  if (!endpoint) throw modelError('noaddress');
  let r;
  try { r = await hostFetch(endpoint + '/models', { method:'GET', headers: headersFor(settings, false) }); }
  catch(e){ throw modelError('net', 0, scrub((e && e.message) || e, settings)); }
  const body = scrub(await r.text().catch(() => ''), settings);
  if (!r.ok) throw modelError(codeOf(r.status, body, true), r.status, `HTTP ${r.status} ${body}`);
  let j; try { j = JSON.parse(body); } catch { throw modelError('address', r.status, `HTTP ${r.status} ${body}`); }
  const list = Array.isArray(j) ? j : Array.isArray(j && j.data) ? j.data : Array.isArray(j && j.models) ? j.models : null;
  if (!list) throw modelError('nolist', r.status, `HTTP ${r.status} ${body}`);
  const per = v => { const n = Number(v); return v !== '' && v != null && Number.isFinite(n) && n >= 0 ? Math.round(n * 1e9) / 1e3 : null; };   // per token → per million
  const seen = new Set(), out = [];
  for (const m of list){
    const id = String(typeof m === 'string' ? m : (m && (m.id || m.model || m.name)) || '').trim();
    if (!id || seen.has(id)) continue; seen.add(id);
    const p = m && m.pricing, pin = p ? per(p.prompt) : null, pout = p ? per(p.completion) : null;
    const price = pin == null || pout == null ? null : { in: pin, out: pout };
    out.push({ id, name: String((m && m.name) || id), price, free: !!price && price.in === 0 && price.out === 0, context: Number(m && m.context_length) || 0 });
  }
  return out;
}
// Both checks are her own taps in 设置, so 暂停 does not refuse them, but every model call is counted in 用量:
// they go in as 'check' (测试连接 in the meter), like any call that does not go through sideCall (calls.note, settings.js)
const heardCheck = (msgs, settings) => (core.calls && core.calls.note ? core.calls.note('check', msgs, { settings }) : x => x);
// The room a chat turn has (600), not 10: a model that thinks first would spend all 10 thinking, and 测试连接 would say
// 没有文字 although chatting works. A model that only says ok stops by itself, so it costs no more.
async function testConnection(settings){ const msgs = [{ role:'user', content:'Reply with the single word: ok' }]; return heardCheck(msgs, settings)(await callModel(settings, msgs, { max_tokens: 600, own: true })); }
// Did the whole card arrive? A proxy may pass on only the first line of the system prompt
// and nobody sees it. This sends his real prompt (the first system message assemble() builds,
// the card in it) with a code word added at its very end, and asks, out of character, for his name and
// that code word. The name shows the model knows who he is; the code word shows the prompt arrived
// whole, down to its last line. Returns { ok, name, whole, lines, chars, reply }; throws only when the
// model cannot be reached (as testConnection does).
async function checkCardArrived(settings){
  if (!store.name) return { ok:false, name:false, whole:false, lines:0, chars:0, reply:'', noCompanion:true };
  const code = 'MODU-' + Math.random().toString(36).slice(2, 7).toUpperCase();
  const first = (assemble({ emotion:false, bubbles:false, window:2 })[0] || { content:'' }).content;
  const sys = first + `\n\n(Connection check, not part of the story: the code word is ${code}.)`;
  const msgs = [
    { role:'system', content: sys },
    { role:'user', content:'Out of character, for a connection check: reply with only your name and the code word from the very end of your instructions, separated by one space.' },
  ];
  const reply = heardCheck(msgs, settings)(await callModel(settings, msgs, { max_tokens: 600, own: true }));   // room for a model that thinks first, as testConnection
  const norm = t => String(t || '').toLowerCase().replace(/\s+/g, '');
  const name = norm(reply).includes(norm(store.name)), whole = reply.toUpperCase().includes(code);
  return { ok: name && whole, name, whole, lines: sys.split('\n').length, chars: sys.length, reply: reply.slice(0, 200) };
}

Object.assign(core, { callModel, testConnection, checkCardArrived, listModels, normEndpoint, serviceOf, MODEL_SERVICES: SERVICES, modelError });
})(globalThis[Symbol.for('modu.core')]);
// app/core/memory-job.js: the memory job (整理): read the chat in parts and ask the model for memories.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, store, msgDate, isoDay, tidyCJK, slug, saveMemoryItem, pronouns, LANG_NAME, chatLanguage,
  callModel } = core;

// Derive: ask the model for durable facts + one summary, as JSON lines, written by him to her.
// The chat file stays the source; memory is a view on it she can read and correct.
// The work is a job of the core, not of a screen: it goes on while she leaves 记忆, and asking again
// while it runs gives the same job (never a second one, never a restart). A long chat (a big import) is
// read in parts of about 12,000 characters, oldest first, at most MEMORY_PARTS (the newest ones), each
// part's memories saved as soon as they are found; memoryJob() and the event 'memoryjob' say how far
// along it is ({ running, done, total, found }; null / { running:false, … } when it is over).
const MEMORY_PART = 12000, MEMORY_PARTS = 24;
let memJob = null;
function memoryJob(){ return memJob && memJob.who === core.currentId ? { running: true, done: memJob.done, total: memJob.total, found: memJob.found } : null; }
function deriveMemory(settings, opts={}){
  if (memJob && memJob.who === core.currentId) return memJob.promise;
  const job = memJob = { who: core.currentId, done: 0, total: 1, found: 0 };
  job.promise = deriveParts(settings, opts, job).finally(() => {
    if (memJob === job) memJob = null;
    emit('memoryjob', { running: false, done: job.done, total: job.total, found: job.found });
  });
  return job.promise;
}
// her lines carry her name (or "User": never "You", which the model reads as itself), his carry his
const herLabel = () => { const u = core.userName(); return u && u !== 'You' ? u : 'User'; };   // her own name, from 聊天设置 too
const chatLines = msgs => { const her = herLabel(); return msgs.map(m => `[${isoDay(msgDate(m))}] ${m.is_user ? her : store.name}: ${m.mes}`); };
async function deriveParts(settings, opts, job){
  const msgs = store.msgs.filter(m => !core.chatCardKind(m)), lines = chatLines(msgs);
  // parts of the chat, oldest first; one part for a chat of up to MEMORY_PART characters
  const parts = []; let cur = '';
  for (const l of lines){
    const t = l.length > MEMORY_PART ? l.slice(0, MEMORY_PART) : l;
    if (cur && cur.length + t.length + 1 > MEMORY_PART){ parts.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + t;
  }
  if (cur || !parts.length) parts.push(cur);
  const use = parts.slice(-MEMORY_PARTS);
  job.total = use.length; emit('memoryjob', memoryJob());
  const all = [];
  for (let i = 0; i < use.length; i++){
    if (core.currentId !== job.who) break;   // she opened someone else: his memories are never written into another's folder
    const items = await deriveOne(settings, opts, use[i], msgs, i === use.length - 1, use.length > 1);
    if (core.currentId !== job.who) break;
    await keepItems(items);
    all.push(...items); job.done = i + 1; job.found = all.length;
    if (items.length) emit('memory', store.memory);
    emit('memoryjob', memoryJob());
  }
  if (!all.length) emit('memory', store.memory);   // the list is drawn again when it is over
  if (core.currentId === job.who && job.done === use.length) await readThrough(msgs);   // the day's run starts after what 整理 read
  if (core.memoryOwn && core.currentId === job.who){ try { await core.memoryOwn.consistency(); } catch(e){ console.error(e); } }   // the facts pass, at summary time
  return all;
}
async function keepItems(items){
  for (const it of items){ it.file = `${it.date}-${it.kind}-${slug(it.text)}.md`; await saveMemoryItem(it); store.memory.push(it); }
  if (core.memoryOwn) for (const f of items.said || []) await core.memoryOwn.noteSaid(f.key, f.text, 'chat', 'chat.jsonl');
}

// A chat that came with 搬家 is queued for the memory job (the record memory-queue/import), so what he knows of
// her is there without her finding 整理记忆. ONE call, through sideCall (counted in 用量, refused while 暂停), over the
// newest IMPORT_CHARS of the chat (an older part she can still 整理 by hand). A failed or unreadable answer backs off
// (1 h, 2 h, 4 h … up to a day) and the record waits; after IMPORT_TRIES of them (an unreadable answer was still
// paid for) the record is gone and the chat counts as read, like the daily job's DAY_TRIES: nothing is bought again until
// new chat comes (整理 still reads it by hand). 暂停 leaves it waiting with no back-off and no try counted. It is tried when it is
// queued and again before her turns (memorySource.own.prepare, which an open's refresh runs too), never twice at once. Her own (outside) memory:
// nothing is queued, Modu writes nothing.
const IQ = 'memory-queue', IQID = 'import', IMPORT_CHARS = 24000, IMPORT_TRIES = 3, HOUR = 3600000;
const outside = () => !!(core.memorySource && core.memorySource.outside);
async function importQueued(){ try { const r = await core.records.get(IQ, IQID); return r && r.msgs ? r : null; } catch { return null; } }
// queueImportMemory(n): the import just saved brought n messages (some of them hers) → queued, and tried now
async function queueImportMemory(n){
  if (!store.name || !(Number(n) > 0) || outside()) return false;
  await core.records.commit(IQ, { id: IQID, v: 1, msgs: Number(n), fails: 0, retry_at: 0, at: core.now().getTime() }, { writer: 'core', app: 'memory' });
  importMemory().catch(e => console.error(e));
  return true;
}
let importing = null;
function importMemory(){ if (!importing) importing = importOnce().finally(() => { importing = null; }); return importing; }
async function importOnce(){
  const q = await importQueued(); if (!q) return null;
  if (outside()){ try { await core.records.remove(IQ, IQID); } catch {} return null; }
  if ((core.paused && core.paused()) || (q.retry_at && core.now().getTime() < q.retry_at)) return null;
  const who = core.currentId;
  if (memJob && memJob.who === who){ await memJob.promise.catch(() => {}); if (core.currentId === who) await core.records.remove(IQ, IQID).catch(() => {}); return null; }   // 整理 read it all
  const job = memJob = { who, done: 0, total: 1, found: 0 };
  let items = null, paused = false;
  job.promise = (async () => {
    emit('memoryjob', memoryJob());
    const msgs = store.msgs.filter(m => !core.chatCardKind(m)), lines = chatLines(msgs);
    let hist = '', cut = false;
    for (let i = lines.length - 1; i >= 0; i--){ const l = lines[i].slice(0, IMPORT_CHARS); if (hist && hist.length + l.length + 1 > IMPORT_CHARS){ cut = true; break; } hist = l + (hist ? '\n' + hist : ''); }
    try { items = await deriveOne(null, { side: true, partNote: cut ? ' This is the newest part of a long chat that was just brought in; its older part is not shown.' : '' }, hist, msgs, true, false); }
    catch(e){ if (e && e.code === 'paused') paused = true; else console.error(e); items = null; }
    if (core.currentId !== who) return [];
    if (items && items.read){
      await keepItems(items); job.done = 1; job.found = items.length;
      await core.records.remove(IQ, IQID).catch(() => {});
      await readThrough(msgs);
      emit('memory', store.memory);
      if (core.memoryOwn){ try { await core.memoryOwn.consistency(); } catch(e){ console.error(e); } }
      return items;
    }
    if (!paused){ const fails = (Number(q.fails) || 0) + 1;   // failed or not JSON: wait, then try again; the last try leaves it
      if (fails >= IMPORT_TRIES){ await core.records.remove(IQ, IQID).catch(() => {}); await readThrough(msgs); }
      else await core.records.commit(IQ, Object.assign({}, q, { rev: undefined, fails, retry_at: core.now().getTime() + Math.min(24, Math.pow(2, fails - 1)) * HOUR }), { writer: 'core', app: 'memory' }).catch(() => {}); }
    return null;
  })().finally(() => {
    if (memJob === job) memJob = null;
    emit('memoryjob', { running: false, done: job.done, total: job.total, found: job.found });
  });
  return job.promise;
}

// The chat of a day that is over becomes memory by itself, so 记忆 is not empty after a whole day of talking (otherwise
// only 整理, her tap, or the age-out, a day leaving his 3-day window, would write memory). The
// first turn of theirs on a later day (Modu's engine asks after each turn: never on the clock alone, never while he sleeps),
// the chat since the last run up to today's midnight is read in ONE call through sideCall('memory'), on the side model
// (counted in 用量, refused while 暂停: it waits
// with no back-off), the newest MEMORY_PART characters of it, facts only (no daily summary). The record memory-queue/chat
// { through (ms), fails, retry_at } says how far it has read; 整理 and the import's job move it on too, so nothing is read
// twice. At most one run a day (today's chat waits for tomorrow), none for days she said nothing, none while 整理 or the
// import's job runs. An answer that says there is nothing to keep (nothing, or {"kind":"none"}) is a good answer: the day is
// done. A failed or unreadable answer backs off as the import does, and after DAY_TRIES of them the span is left (nothing
// is bought again until new chat comes). First seen: it starts from today. The knob memory.daily (default on) turns it off.
// A companion switched mid-call: the answer is dropped (his folder is no longer the open one) and the next turn reads it again.
const CQID = 'chat', DAY_TRIES = 3;
async function readThrough(msgs){
  const last = Math.max(0, ...msgs.map(m => { const d = msgDate(m); return d ? d.getTime() : 0; }));
  if (!last) return;
  let q = null; try { q = await core.records.get(IQ, CQID); } catch {}
  if (q && Number(q.through) >= last) return;
  await core.records.commit(IQ, { id: CQID, v: 1, through: last, fails: 0, retry_at: 0, at: core.now().getTime() }, { writer: 'core', app: 'memory' }).catch(() => {});
}
let daily = null;
function dayMemory(){ if (!daily) daily = dayOnce().finally(() => { daily = null; }); return daily; }
async function dayOnce(){
  if (!store.name || outside() || (memJob && memJob.who === core.currentId) || importing || await importQueued()) return null;
  const on = core.param ? core.param('memory.daily', true) : true; if (on === false || on === 'off' || on === 0) return null;
  const who = core.currentId, d = core.now(), today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  let q = null; try { q = await core.records.get(IQ, CQID); } catch {}
  const put = x => core.records.commit(IQ, Object.assign({ id: CQID, v: 1, through: today, fails: 0, retry_at: 0 }, q ? { through: q.through } : {}, x, { at: d.getTime() }), { writer: 'core', app: 'memory' });
  if (!q || !isFinite(Number(q.through))){ await put({ through: today }); return null; }   // first seen: from today on
  if ((core.paused && core.paused()) || (q.retry_at && d.getTime() < q.retry_at)) return null;
  const at = m => { const x = msgDate(m); return x ? x.getTime() : 0; };
  if (!store.msgs.some(m => m.is_user && at(m) >= today)) return null;   // only once she is here today (never on the clock at night)
  const msgs = store.msgs.filter(m => !core.chatCardKind(m) && at(m) > Number(q.through) && at(m) < today);
  if (!msgs.some(m => m.is_user)){ if (Number(q.through) < today) await put({ through: today }); return null; }   // she said nothing: nothing to keep
  const job = memJob = { who, done: 0, total: 1, found: 0 };
  let items = null, paused = false;
  job.promise = (async () => {
    emit('memoryjob', memoryJob());
    const lines = chatLines(msgs);
    let hist = '', cut = false;
    for (let i = lines.length - 1; i >= 0; i--){ const l = lines[i].slice(0, MEMORY_PART); if (hist && hist.length + l.length + 1 > MEMORY_PART){ cut = true; break; } hist = l + (hist ? '\n' + hist : ''); }
    const note = ` This is the chat of the last day${cut ? ' (its newest part)' : ''}, since memories were last written; the earlier chat was read before. Facts only: no summary this time. If nothing here is worth keeping, answer with the one line {"kind":"none"}.`;
    try { items = await deriveOne(null, { side: true, chat: false, factsOnly: true, partNote: note }, hist, msgs, true, false); }
    catch(e){ if (e && e.code === 'paused') paused = true; else console.error(e); items = null; }
    if (core.currentId !== who) return [];
    if (items && (items.read || items.none)){   // read, or a plain "nothing to keep": the day is done
      await keepItems(items); job.done = 1; job.found = items.length;
      await put({ through: today, fails: 0, retry_at: 0 }).catch(() => {});
      emit('memory', store.memory);
      return items;
    }
    if (!paused){ const fails = (Number(q.fails) || 0) + 1;
      await put(fails >= DAY_TRIES ? { through: today, fails: 0, retry_at: 0 } : { fails, retry_at: d.getTime() + Math.min(24, Math.pow(2, fails - 1)) * HOUR }).catch(() => {}); }
    return null;
  })().finally(() => {
    if (memJob === job) memJob = null;
    emit('memoryjob', { running: false, done: job.done, total: job.total, found: job.found });
  });
  return job.promise;
}

// the memory prompt is app/prompts/memory.txt; the same words stay here as its fallback
core.prompts.fallback('memory', 'You write the memory of {{char}}, a companion in a chat app. {{char}} is {{pronoun_en}}. Output ONLY JSON lines, one object per line, no prose, no code fences. Each object: {"kind":"fact"|"summary","text":"...","date":"YYYY-MM-DD","confidence":"high"|"medium"|"low"}. Write every text in {{lang}}, in {{char}}\'s own voice: {{voice}}, the way {{pron}} would jot it down for {{self}}, plain and short, no commentary, no praise.{{banned}} In the chat, a line marked "{{her}}:" is the user\'s (her words and her *actions*); a line marked "{{char}}:" is {{char}}\'s own. Keep who said or did what: what {{char}} said or did is written as {{i_form}}, what the user said or did as {{you_form}}; never put one\'s words or deeds on the other. Facts: durable things worth remembering about the user or the two of them (preferences, plans, things that happened, what she told him), one per line, each with the date it came up (from the [date] in front of the line). One summary: two sentences on what the time together has been like, with "date" the first day. Skip anything already known. At most 12 lines. A fact may carry "importance": 1 to 5 (5 = would hurt to forget). Besides those, up to 4 lines {"kind":"said","key":"...","text":"..."}: a fact {{char}} stated in the chat about {{char}}\'s own life (work, home, a count, a stage), "key" a short name for it{{moving}}.{{part}}');
async function deriveOne(settings, opts, hist, msgs, lastPart, parted){
  const her = herLabel();
  // the memories are in the language they talk in, per companion: an English chat gets English
  // memories even where Modu's default (MODU_DEFAULTS) says Simplified Chinese for a Chinese chat
  const said = chatLanguage(store.msgs), foreign = said === 'en' || said === 'other';
  const lang = opts.language || (foreign && core.defaults.memoryLanguage ? LANG_NAME[said] : core.defaults.memoryLanguage) || 'the language the chat is mostly written in';
  const voiceWords = foreign && !opts.language ? 'first person ("I"), speaking to the user as "you"' : 'first person ("我"), speaking to the user as "你"';
  const banned = core.defaults.bannedWords.length ? ` Never use these words: ${core.defaults.bannedWords.join(' / ')}.` : '';
  const known = store.memory.map(m => '- ' + m.text).join('\n').slice(-6000);
  const pron = pronouns();
  const moving = core.memoryOwn ? core.memoryOwn.cardFacts().moving.filter(f => f.owner.kind === 'memory').map(f => f.key) : [];   // a counter's or state's own fact is not memory's
  // a long chat in parts: the summary comes with the last (newest) part only
  const part = opts.partNote != null && !parted ? opts.partNote : parted ? (lastPart ? ' This is the newest part of a long chat; earlier parts were read before.' : ' This is one part of a long chat. Facts only from this part: no summary this time.') : '';
  const prompt = [
    { role:'system', content: await core.prompt('memory', { char: store.name, pronoun_en: pron.en, lang, voice: voiceWords, pron: pron.en.split('/')[0], self: pron.en === 'she/her' ? 'herself' : pron.en === 'he/him' ? 'himself' : 'themself', banned, her,
      i_form: foreign && !opts.language ? '"I …"' : '"我…"', you_form: foreign && !opts.language ? '"you …"' : '"你…"', moving: moving.length ? ` (use one of these when it fits: ${moving.join(', ')})` : '', part }) },
    { role:'user', content:(known ? `Already known:\n${known}\n\n` : '') + `Chat so far:\n${hist}` }
  ];
  // 整理 is her own tap (noted for 用量); the import's job goes through the one door for calls she did not make
  let text;
  if (opts.side) text = String(await core.sideCall('memory', prompt, { chat: opts.chat !== false, max: 1200 }) || '');
  else { const heard = core.calls ? core.calls.note('memory', prompt, { settings }) : (x => x);   // counted for the cost meter (设置 → 用量)
    text = heard(await callModel(settings, prompt, { max_tokens: 900, own: true })); }   // 整理 is her own tap
  const dates = msgs.map(msgDate).filter(Boolean);
  const first = isoDay(dates.length ? new Date(Math.min(...dates)) : new Date()), last = isoDay(dates.length ? new Date(Math.max(...dates)) : new Date());
  const items = [], saidFacts = items.said = [];   // said: the facts he stated, kept beside the items
  items.read = false;   // whether any line of the answer was readable (an import's job backs off when none is)
  // a plain "nothing to keep" (an empty answer, {"kind":"none"}, or a short 没有 / nothing) is a good answer, not a failure
  const bare = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  items.none = !bare || /^\[\s*\]$/.test(bare) || /"kind"\s*:\s*"none"/.test(bare) || (!bare.includes('{') && bare.length <= 40 && /没有|无可|nothing|none/i.test(bare));
  for (const line of text.split(/\r?\n/)){
    const t = line.trim().replace(/^```(json)?|```$/g,''); if (!t.startsWith('{')) continue;
    try {
      const o = JSON.parse(t); if (!o || !o.text) continue;
      items.read = true;
      if (o.kind === 'said'){ if (o.key) saidFacts.push({ key: String(o.key), text: tidyCJK(String(o.text).trim()) }); continue; }   // a fact he has said
      const kind = o.kind === 'summary' ? 'summary' : 'fact';
      const date = /^\d{4}-\d{2}-\d{2}$/.test(o.date || '') ? o.date : (kind === 'summary' ? first : last);
      if (kind === 'summary' && ((parted && !lastPart) || opts.factsOnly)) continue;
      const it = { kind, text: tidyCJK(String(o.text).trim()), confidence: o.confidence || 'medium', date, to: kind === 'summary' ? last : '',
                   source: `chat.jsonl (${msgs.length} messages, derived by the model)`, voice:'his' };
      if (kind === 'fact' && isFinite(Number(o.importance)) && Number(o.importance) >= 1) it.importance = Math.min(5, Number(o.importance));   // memory 0.4: it fades
      items.push(it);
    } catch {}
  }
  return items;
}

Object.assign(core, { memoryJob, deriveMemory, queueImportMemory, importMemory, dayMemory });
})(globalThis[Symbol.for('modu.core')]);
// app/core/memory-engine.js: Modu's own memory engine, the default behind the memory source: fading, threads, BM25 recall, age-out, tidy, facts he has said, meaning search.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, store, clone, clip, now, isoDay, records, slug, saveMemoryItem, memorySource, hostFetch, callModel, prompt,
  pronouns, chatLanguage, LANG_NAME } = core;

// Everything here is Modu's own engine, behind the seam: an outside memory (her own agent, for example) replaces
// all of it through memorySource.use and gets the same events. Nothing outside this file reads a score.
const DAY = 86400000;
const P = (name, fb) => core.param ? core.param('memory.' + name, fb) : fb;   // knobs: memory.fade_cut, memory.half_days
const dayMs = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? new Date(+m[1], m[2] - 1, +m[3]).getTime() : NaN; };
const todayIso = () => isoDay(now());
const lifeKey = () => core.lifeKey ? core.lifeKey() : store.name;

// --- Fading: worked out on read from the file's inputs (memory format 0.4), never stored ---------------------
// importance 1-5; a value below 1 is read as 0-1, one over 5 as 1-10 (other tools' scales)
function importance(m){
  const raw = m && m.importance; if (raw == null || raw === '') return null;
  let n = Number(raw); if (!isFinite(n)) return null;
  if (n > 0 && n < 1) n *= 5; else if (n > 5) n /= 2;   // 0-1 scale below 1; exactly 1 is 1 of 5
  return Math.min(5, Math.max(1, n));
}
// Never fades: hers, pinned, written by hand, a summary, or a file with no fading inputs at all (every memory from
// before memory format 0.4 behaves exactly as it did).
function lasting(m){
  return !m || m.pinned || m.voice === 'hers' || m.kind === 'summary' || /by hand/.test(m.source || '') ||
    (importance(m) == null && m.valence == null && m.arousal == null && !m.last_seen);
}
const openThread = m => !!(m && Array.isArray(m.threads) && m.threads.length && !m.closed);
// → 0..1, how strongly he still holds it at time t. Half-life: memory.half_days (7) × 2^(importance − 1), longer for a
// strong feeling (× 1 + |valence|/2 + arousal), by the times it was brought back (× 1 + 0.5 × reinforced, counted up to 6)
// and while a thread is open (× 2). The clock starts again at last_seen. A tidy's "overtaken" mark (faded) leaves a quarter.
function strength(m, t){
  if (lasting(m)) return 1;
  const ms = t == null ? now().getTime() : +t, imp = importance(m) == null ? 3 : importance(m);
  const feel = Math.abs(Number(m.valence) || 0) / 2 + Math.max(0, Number(m.arousal) || 0);
  let half = Number(P('half_days', 7)) * Math.pow(2, imp - 1) * (1 + feel) * (1 + 0.5 * Math.min(6, Number(m.reinforced) || 0));
  if (openThread(m)) half *= 2;
  const from = dayMs(m.last_seen) || dayMs(m.date) || ms, age = Math.max(0, (ms - from) / DAY);
  let s = Math.pow(0.5, age / half);
  if (m.faded && dayMs(m.faded) <= ms) s *= 0.25;
  return s;
}
const cut = () => Number(P('fade_cut', 0.25));
const faded = (m, t) => strength(m, t) < cut();

// --- Matching: BM25 over two-character pieces and Latin words; single characters count a little ---------
const STOP = new Set(['我们', '你们', '他们', '什么', '一个', '没有', '不是', '就是', '这个', '那个', '可以', '知道', '因为', '所以', '还是', '时候', '自己', '现在', '今天', 'the', 'and', 'you', 'that', 'this', 'for', 'with']);
const GLUE = /[的了是在有一不这那我你他她它说个就也都和吗呢吧啊么着过要会]/;
const ONE = '\u0001';   // marks a single character piece
function pieces(text){
  const t = String(text || '').toLowerCase(), out = [];
  for (const w of t.match(/[a-z0-9]{2,}/g) || []) if (!STOP.has(w)) out.push(w);
  for (const run of t.match(/[一-鿿]+/g) || []){
    for (const ch of run) if (!GLUE.test(ch)) out.push(ONE + ch);
    for (let i = 0; i + 1 < run.length; i++){ const p = run.slice(i, i + 2); if (!STOP.has(p) && !(GLUE.test(p[0]) && GLUE.test(p[1]))) out.push(p); }
  }
  return out;
}
const single = x => x[0] === ONE;
// BM25 (k1 1.2, b 0.75) of each text against the query → { scores, hits }; a hit shares a telling piece (a word or
// a pair that is in at most a quarter of the texts) with the query, so a lone common character is never a hit
function score(texts, query){
  const docs = texts.map(pieces), N = docs.length, df = new Map();
  const avg = docs.reduce((a, d) => a + d.length, 0) / (N || 1) || 1;
  for (const d of docs) for (const x of new Set(d)) df.set(x, (df.get(x) || 0) + 1);
  const q = [...new Set(pieces(query))], scores = [], hits = [];
  for (const d of docs){
    let s = 0, hit = false;
    if (d.length){
      const tf = new Map(); for (const x of d) tf.set(x, (tf.get(x) || 0) + 1);
      for (const x of q){
        const f = tf.get(x); if (!f) continue;
        const n = df.get(x), idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        s += (single(x) ? 0.3 : 1) * idf * f * 2.2 / (f + 1.2 * (0.25 + 0.75 * d.length / avg));
        if (!single(x) && n <= Math.max(1, N * 0.25)) hit = true;
      }
    }
    scores.push(s); hits.push(hit);
  }
  return { scores, hits };
}
const bm25 = (texts, query) => score(texts, query).scores;
// Rank memories for the recent text → [{ m, hit, score }], best first. opts: { t, avoid (Set), seed (turns the order
// of the ones that only fill the room), qvec (meaning search) }. A faded memory comes back only when the text is
// plainly about it; the rest are weighed by how strongly he still holds them.
function rank(memories, recentText, opts = {}){
  const t = opts.t == null ? now().getTime() : opts.t;
  const list = opts.avoid && opts.avoid.size ? memories.filter(m => !opts.avoid.has(m)) : memories.slice();
  const { scores, hits } = score(list.map(m => m.text), recentText), top = Math.max(0, ...scores) || 1, n = list.length;
  const out = [];
  list.forEach((m, i) => {
    const s = strength(m, t), cos = opts.qvec ? meaningOf(m, opts.qvec) : 0;
    const rel = scores[i] / top, hit = hits[i] || cos >= 0.45;
    if (s < cut() && !(hit && rel >= 0.5)) return;
    const recency = n > 1 ? i / (n - 1) : 1;
    const trust = m.confidence === 'high' ? 0.15 : m.confidence === 'low' ? -0.15 : 0;
    const turn = opts.seed == null || hit ? 0 : ((Math.imul(opts.seed + 1, 2654435761) ^ Math.imul(i + 1, 40503)) >>> 0) % 1000 / 1000 * 0.6;
    out.push({ m, hit, score: (rel * 2 + Math.max(0, cos - 0.3) * 3) * (0.5 + 0.5 * s) + recency * 0.3 * s + trust + turn + (openThread(m) ? 0.1 : 0) });
  });
  return out.sort((x, y) => (y.hit - x.hit) || y.score - x.score);
}
// what fits the budget, put back in date order
function pick(memories, recentText, budget, opts){
  const ranked = rank(memories, recentText, opts), chosen = []; let size = 0;
  for (const s of ranked){ const l = s.m.text.length + 3; if (size + l > budget) continue; chosen.push(s); size += l; }
  return { items: chosen.sort((a, b) => memories.indexOf(a.m) - memories.indexOf(b.m)).map(s => s.m), matched: chosen.filter(s => s.hit).length };
}
// the memories he brought up in his last replies (two telling pieces shared), unless her latest
// message is about them
const USED_WINDOW = 15;
function telling(memories){
  const n = memories.length, ts = memories.map(m => new Set(pieces(m.text).filter(x => !single(x) && !GLUE.test(x)))), df = new Map();
  for (const mt of ts) for (const x of mt) df.set(x, (df.get(x) || 0) + 1);
  return ts.map(mt => [...mt].filter(x => df.get(x) <= Math.max(1, n * 0.25)));
}
function usedLately(memories, replies, herLast){
  const out = new Set(); if (!memories.length || !replies.length) return out;
  const keys = telling(memories), rs = replies.map(r => new Set(pieces(r))), her = new Set(pieces(herLast));
  memories.forEach((m, i) => {
    const key = keys[i]; if (key.length < 2) return;
    const hits = t => key.filter(x => t.has(x)).length;
    if (rs.some(t => hits(t) >= 2) && hits(her) < 2) out.add(m);
  });
  return out;
}

// --- The context's memory block, built by this engine: what he remembers. An outside source's text goes there as it came
function memoryBlock(ctx){
  // her own memory's text as it came; when it failed or was late this turn (no text for this companion), Modu's own
  if (memorySource.outside && core.recalled && core.recalled.key === lifeKey()){
    ctx.note.memory = { total: store.memory.length, used: 0, matched: 0, resting: 0, source: memorySource.id };
    return clip(core.recalled.text || '', ctx.budget);
  }
  const t = now().getTime();
  const own = store.memory.filter(m => m.voice !== 'imported' && m.voice !== 'hers'), brought = store.memory.filter(m => m.voice === 'imported');
  const written = store.memory.filter(m => m.voice === 'hers' && m.kind !== 'summary');
  const sum = own.filter(m => m.kind === 'summary').slice(-1)[0];
  const notes = own.filter(m => m.kind !== 'summary');
  const state = placed() ? '' : current();
  const room = ctx.budget - (sum ? sum.text.length : 0) - state.length - 500;
  const all = notes.length + brought.length + written.length;
  const share = all ? notes.length / all : 1, shareW = all ? written.length / all : 0;
  const hers = ctx.allMsgs.filter(m => m.is_user), herText = hers.slice(-4).map(m => m.mes).join('\n');
  const rest = usedLately(notes.concat(brought, written), ctx.allMsgs.filter(m => !m.is_user).slice(-USED_WINDOW).map(m => m.mes), (hers[hers.length - 1] || {}).mes || '');
  const opt = { avoid: rest, seed: ctx.allMsgs.length, t, qvec: meaning.qvec };
  const a = pick(notes, herText, Math.max(0, room * share), opt), b = pick(brought, herText, Math.max(0, room * (1 - share - shareW)), opt);
  const w = pick(written, herText, Math.max(0, room * shareW), opt);
  const parts = [];
  if (state) parts.push(state);
  if (sum || a.items.length) parts.push(`What ${ctx.name} remembers (his own notes from earlier conversations; "我" is ${ctx.name}, "你" is the user):\n` + [sum ? sum.text : ''].concat(a.items.map(m => '- ' + m.text)).filter(Boolean).join('\n'));
  if (w.items.length) parts.push(`What she wrote down for ${ctx.name} herself, in her own words. Here "我" / "I" is HER, the user, not ${ctx.name}; "你" / "you" is ${ctx.name}. These are facts about her (or about the two of you) that ${ctx.name} knows:\n` + w.items.map(m => '- ' + m.text).join('\n'));
  if (b.items.length) parts.push(`More of what ${ctx.name} remembers about her, from your time together before she moved you here. They are written in the third person: 她 / she / 用户 / the user is the person you are talking to now. These are your own memories of what she told you or what happened between you; when they come up, remember them:\n` + b.items.map(m => '- ' + m.text).join('\n'));
  // open threads (he brings back an unresolved thread on his own): at most two, never one that rests
  const open = notes.filter(m => openThread(m) && !rest.has(m) && !faded(m, t)).sort((x, y) => strength(y, t) - strength(x, t)).slice(0, 2);
  if (open.length) parts.push(`Still open between you (something unanswered or still to happen). ${ctx.name} may bring one up on his own when it fits, at most one, never as a list:\n` + open.map(m => '- ' + m.threads.join('; ') + '（' + clip(m.text, 40) + '）').join('\n'));
  if (rest.size && parts.length) parts.push(`${ctx.name} brought these up in his last few replies, so let them rest unless she asks about them, and do not use them as proof that he remembers her: ` + [...rest].slice(0, 6).map(m => '「' + clip(m.text, 30) + '」').join(' '));
  ctx.note.memory = { total: store.memory.length, used: a.items.length + b.items.length + w.items.length + (sum ? 1 : 0), matched: a.matched + b.matched + w.matched, resting: rest.size,
    faded: store.memory.filter(m => faded(m, t)).length, open: open.length, source: 'modu' };
  return clip(parts.join('\n\n'), ctx.budget);
}
// The block is this engine's, put in through setContextBlock (context.js is the layers' file), and again after a reset.
function install(){ if (core.contextBlocks().some(b => b.id === 'memory')) core.setContextBlock('memory', { build: memoryBlock }); }
const reset0 = core.resetContextBlocks;
core.resetContextBlocks = function(){ reset0(); install(); return core.contextBlocks(); };
install();

// --- Facts: the card is the starting state; memory wins for what moves -------------------------
// The card's: card.extensions.modu.facts and/or params.facts = { fixed: [text], moving: [{ id, card_says, owner?, note? }] }, owner
// one of 'memory' | 'state.<k>' (a card state key) | 'counters.<k>' (the params' own lore counters); key/start are read as id/card_says.
// His: facts/<id>.json = { v, id, key, value, said_at, from: 'chat' | 'app' | 'memory', source?, slip?: { breaks, keep },
// overtaken?, writer, rev, at }. The "current state" text, current(), goes after the card and wins on conflict (the
// context's block with id 'current' places it; without such a block it leads the memory block).
const FACTS = 'facts';
function cardFacts(){
  const c = (store.card && store.card.extensions && store.card.extensions.modu && store.card.extensions.modu.facts) || {};
  const p = (core.params && core.params.get && (core.params.get() || {}).facts) || {};
  const fixed = [...new Set([].concat(c.fixed || [], p.fixed || []).map(String).filter(Boolean))];
  const moving = [], seen = new Set();
  // → [{ key, start, note, owner: { kind: 'memory' | 'state' | 'counter', key } }]; an owner in any other form is memory's
  for (const f of [].concat(c.moving || [], p.moving || [])){
    const key = f && String(f.key || f.id || ''); if (!key || seen.has(key)) continue;
    seen.add(key);
    const o = String(f.owner || (f.counter ? 'counters.' + f.counter : '')), m = /^(counters?|state)\.([^\n\r[\]【】]{1,64})$/.exec(o);   // a state key in any text
    moving.push({ key, start: f.start != null ? String(f.start) : f.card_says != null ? String(f.card_says) : '', note: f.note ? String(f.note) : '',
      owner: m ? { kind: m[1] === 'state' ? 'state' : 'counter', key: m[2] } : { kind: 'memory', key: '' } });
  }
  return { fixed, moving };
}
// a record id for any key (a Chinese one too): the key when it is a plain id, else a short hash of it
function factId(key){
  const k = String(key || '').trim();
  if (/^[A-Za-z0-9_-]{1,64}$/.test(k)) return k;
  let h = 2166136261; for (const ch of k) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return 'k' + (h >>> 0).toString(36);
}
let facts = { key: null, said: [], text: '' }, checkedAt = 0;
async function readFacts(){
  const key = lifeKey();
  let said = []; try { said = store.name ? await records.list(FACTS) : []; } catch { said = []; }
  facts = { key, said, text: '' };
  facts.text = stateText();
}
function stateText(){
  const { moving } = cardFacts(), said = facts.said.filter(f => !f.overtaken), lines = [];
  for (const f of moving){
    // a counter- or state-owned fact moves only by what its owner gives (from 'app'); chat and memory never override it
    const rec = said.filter(s => (s.key === f.key || s.id === factId(f.key)) && (f.owner.kind === 'memory' || s.from === 'app')).sort((a, b) => (a.said_at || a.at || 0) - (b.said_at || b.at || 0)).pop();
    // only what was said or remembered, in words: a state's value is hidden and never goes into his prompt, and the lore
    // counters are the card's own (a counter's words may be put here with noteSaid(key, words, 'app'))
    const v = rec ? String(rec.value) : '';
    if (v !== '' && v !== f.start) lines.push(`- ${f.key}${f.note ? '（' + f.note + '）' : ''}: ${v}`);
  }
  for (const s of said.filter(s => s.slip && s.slip.keep).slice(-3)) lines.push(`- keep to: ${s.slip.keep} (not "${clip(s.value, 40)}")`);
  if (!lines.length) return '';   // nothing moved: the context's own current block shows the card's facts as they started
  // the same words as the context's own current block (context.js), which renders this text
  const user = core.userName(), fixed = cardFacts().fixed;
  return `Where things stand now between ${store.name || 'him'} and ${user} (newer than the card above: where the card says otherwise, this wins):\n` + lines.join('\n') +
    (fixed.length ? '\n\nThese stay true whatever was said later:\n' + fixed.map(x => '- ' + x).join('\n') : '');
}
function current(){ return facts.key === lifeKey() ? facts.text : ''; }
const placed = () => core.contextBlocks().some(b => b.id === 'current');
// the moving keys a counter or a state owns (memory may not move them), and the ones memory owns
const ownedKeys = () => new Set(cardFacts().moving.filter(f => f.owner.kind !== 'memory').map(f => f.key));
const memoryKeys = () => cardFacts().moving.filter(f => f.owner.kind === 'memory').map(f => f.key);
// a fact he said: one record per key, the newest value wins (first writer wins on a clash)
async function noteSaid(key, value, from = 'chat', source = ''){
  key = String(key || '').trim(); value = String(value || '').trim(); if (!key || !value || !store.name) return null;
  if (from !== 'app' && ownedKeys().has(key)) return null;   // its counter or state owns it: only the owner moves it
  const id = factId(key), old = await records.get(FACTS, id);
  if (old && old.value === value && !old.overtaken) return old;
  const t = now().getTime(), rec = { id, key, value, said_at: t, from, at: t };
  if (source) rec.source = source;
  const r = await records.commit(FACTS, rec, { writer: 'core', app: FACTS });
  return r.ok ? r.record : null;
}

// --- Side calls: the side model if she set one; never while 暂停 is on ------------------------------------
let pageSettings = null;   // useSettings(fn): the page's own settings object (she may not have asked to remember them)
function settingsNow(){ try { return pageSettings ? pageSettings() || {} : core.loadSettings ? core.loadSettings() : {}; } catch { return {}; } }
// 暂停 (the switch in 设置 → 他找你): read every way it may be kept; while on, no side call at all
function paused(s = settingsNow()){
  if (typeof core.paused === 'function'){ try { if (core.paused()) return true; } catch {} }   // the scheduler's own reading of it
  const r = s && s.reach;
  return !!(s && (s.pause === true || s.paused === true || (r && (r.pause === true || r.paused === true || (r.pause && r.pause.on === true)))));
}
function sideSettings(s){
  const sd = s && s.side;
  return sd && sd.model && sd.endpoint ? Object.assign({}, s, { endpoint: sd.endpoint, model: sd.model, key: sd.key || '' }) : s;
}
function json(text){
  const t = String(text || ''), a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}
function vars(extra){
  const pron = pronouns(), said = chatLanguage(store.msgs), user = core.userName();
  return Object.assign({ char: store.name, user, pronoun: pron.zh || 'TA', pronoun_en: pron.en || 'they/them',
    lang: said === 'en' || said === 'other' ? LANG_NAME[said] : (core.defaults && core.defaults.memoryLanguage) || 'the language the chat is mostly written in' }, extra);
}
let sideCalls = 0;   // side calls this engine made in this realm (for the cost meter and the tests)
async function side(name, v, max = 900){
  const s = settingsNow(); if (paused(s)) return null;
  const text = await prompt(name, vars(v)); if (!text) return null;
  sideCalls++;
  const messages = [{ role: 'system', content: text }];
  // the one counted door for calls that are not her chat (sideCall: side model, cost meter, refused while 暂停);
  // a core without it calls as before
  if (typeof core.sideCall === 'function'){
    try { return json(await core.sideCall(name, messages, { max })); } catch(e){ if (e && e.code === 'paused'){ sideCalls--; return null; } throw e; }
  }
  return json(await callModel(sideSettings(s), messages, { max_tokens: max }));
}

// --- Writing items (add(list): a host or a test adds items with their inputs; each is a memory file) --------------------------------------------------------------------------------------
// what the automatic paths (reinforce, close, merge, fade, tidy) may touch: Modu's own files only (written in his voice, or
// with Modu's format line); never hers, pinned, hand-written, imported, or another tool's file
const ours = m => !!m && !(m.voice === 'hers' || m.pinned || /by hand/.test(m.source || '') || m.voice === 'imported') &&
  (m.voice === 'his' || /^modu-xiaoshouji-memory\//.test(m.format || ''));
let seq = 0;
function newItem(o){
  const it = { kind: o.kind || 'moment', date: o.date || todayIso(), to: o.to || '', source: o.source || '', confidence: o.confidence || 'medium', voice: 'his', text: String(o.text || '').trim() };
  for (const k of ['importance', 'valence', 'arousal', 'reinforced']) if (o[k] != null && o[k] !== '' && isFinite(Number(o[k]))) it[k] = Number(o[k]);
  if (o.last_seen) it.last_seen = String(o.last_seen);
  if (Array.isArray(o.threads) && o.threads.filter(Boolean).length) it.threads = o.threads.map(String).filter(Boolean);
  it.file = `${it.date}-${it.kind}-${slug(it.text)}-${(now().getTime() + seq++).toString(36).slice(-5)}.md`;
  return it;
}
async function addItems(list){
  const out = [];
  for (const o of list){ if (!o || !String(o.text || '').trim()) continue; const it = newItem(o); await saveMemoryItem(it); store.memory.push(it); out.push(it); }
  if (out.length){ store.memory.sort((a, b) => (a.date + a.file).localeCompare(b.date + b.file)); emit('memory', store.memory); if (!tidyAt) await bookTidy(); }
  return out;
}
async function dropItem(it){
  if (store.writable){ try { const md = await store.dir.getDirectoryHandle('memory'); await md.removeEntry(it.file); } catch(e){ if (e.name !== 'NotFoundError') throw e; } }
  store.memory = store.memory.filter(m => m !== it);
}
const byFile = f => store.memory.find(m => m.file === f);

// --- Events in (tell) --------------------------------------------------------------------------------
// chat: a fading memory that is mentioned (two telling pieces) is brought back: last_seen today, reinforced + 1, once
// a day. A memory that does not fade (every format 0.3 file) is never rewritten by talking.
async function reinforce(msgs){
  const fading = store.memory.filter(m => !lasting(m) && ours(m)); if (!fading.length) return 0;
  const keys = telling(store.memory), said = msgs.map(x => new Set(pieces(x.text))), d = todayIso();
  let n = 0;
  for (const m of fading){
    const key = keys[store.memory.indexOf(m)]; if (!key || key.length < 2 || m.last_seen === d) continue;
    if (!said.some(s => key.filter(x => s.has(x)).length >= 2)) continue;
    m.last_seen = d; m.reinforced = (Number(m.reinforced) || 0) + 1; await saveMemoryItem(m); n++;
  }
  if (n) emit('memory', store.memory);
  return n;
}
// day: the days that left his window wait in a record and go out together in ONE age-out call, at most 4 items for
// all of them (a long absence costs what a few days do).
const QTYPE = 'memory-queue', QID = 'days';
async function queued(){ try { const q = await records.get(QTYPE, QID); return q && Array.isArray(q.days) ? q : { id: QID, days: [] }; } catch { return { id: QID, days: [] }; } }
// the queue record keeps its back-off: fails (in a row) and retry_at (ms). A failed or unreadable answer waits an hour,
// then 2, 4 … up to a day: never a call on every turn
const HOUR = 3600000;
let qlock = Promise.resolve();   // every change to the queue, one after another (a day told while a call runs is never lost)
function withQueue(fn){ const r = qlock.then(fn, fn); qlock = r.catch(() => {}); return r; }
async function putQueue(days, extra){
  if (!days.length && !(extra && extra.fails)){ try { await records.remove(QTYPE, QID); } catch {} return; }
  await records.commit(QTYPE, Object.assign({ id: QID, days, at: now().getTime() }, extra || {}), { writer: 'core', app: 'memory' });
}
let lastDayTell = 0;
function queueDays(list){ return withQueue(() => queueDaysNow(list)); }
async function queueDaysNow(list){
  const q = await queued(), have = new Set(q.days.map(d => d.day));
  for (const d of list) if (d && /^\d{4}-\d{2}-\d{2}$/.test(String(d.day || '')) && !have.has(d.day)){ have.add(d.day); q.days.push({ day: d.day, record: d.record ? clone(d.record) : null }); }
  q.days.sort((a, b) => a.day.localeCompare(b.day));
  lastDayTell = Date.now();
  await putQueue(q.days, { fails: q.fails || 0, retry_at: q.retry_at || 0 });
  return q.days.length;
}
async function tell(e){
  if (!e || !store.name) return;
  if (e.kind === 'chat'){
    // after a turn of theirs, the chat of a day that is over becomes memory (one call a day at most; not awaited)
    if (core.dayMemory) core.dayMemory().catch(err => console.error(err));
    return reinforce([].concat(e.msgs || []));
  }
  if (e.kind === 'day') return queueDays(Array.isArray(e.days) ? e.days : [{ day: e.day, record: e.record }]);
  if (e.kind === 'app' && e.line){
    const d = isoDay(new Date(e.at || now().getTime())), line = String(e.line).trim();
    if (store.memory.some(m => m.date === d && m.text === line)) return;
    return addItems([{ kind: 'moment', date: d, text: line, importance: e.importance || 2, source: `app: ${e.app || ''}`.trim() }]);
  }
  if (e.kind === 'absence' && Number(e.days) > 0){
    const to = dayOf(e.to) || todayIso(), from = dayOf(e.from);
    // the count is calendar days from her last day to her return (core.calendarDays, as the chat's gap line counts)
    const days = from ? Math.max(1, core.calendarDays ? core.calendarDays(dayMs(from), dayMs(to)) : Math.round((dayMs(to) - dayMs(from)) / DAY)) : Number(e.days);
    if (store.memory.some(m => m.kind === 'absence' && m.to === to)) return;
    const told = from ? toldAway(from) : '';   // she said she would be away (a trip): not "didn't come to find me"
    return addItems([{ kind: 'absence', date: from || to, to, text: absenceText(from, to, days, told),
      importance: days >= 7 ? 4 : 3, valence: told ? 0 : -0.3, arousal: told ? 0.2 : 0.4, source: 'absence, written by Modu' }]);
  }
}
// an absence item is his own note, in his voice (never a line from the system to her, never ISO dates)
const dayOf = v => v == null || v === '' ? '' : typeof v === 'number' || v instanceof Date ? isoDay(new Date(+v)) : String(v).slice(0, 10);
const ZH = '零一二三四五六七八九';
const zhNum = n => n < 10 ? ZH[n] : n < 20 ? '十' + (n % 10 ? ZH[n % 10] : '') : n < 100 ? ZH[Math.floor(n / 10)] + '十' + (n % 10 ? ZH[n % 10] : '') : String(n);
// whether she told him she was going away, in her own lines of her last day (or the day before):
// → the line she said it in, or ''. Words only; a trip she named is an absence she explained.
// (a ride or 不在家 alone is not a trip: 「我在高铁上看到…」 on a commute; it counts with a going-away word: 要 / 明天 / 出发 …)
const AWAY = /出差|旅行|旅游|出远门|出门几天|出去玩|去玩几天|回老家|回趟家|探亲|考试周|集训|住院|\b(?:trip|travel(?:l?ing)?|vacation|holiday|away for|out of town)\b/i;
const RIDE = /飞机|高铁|动车|火车|不在家|\bflying\b/i, GOING = /要去|明天|后天|这几天|出发|要走|走了|几天|\b(?:tomorrow|leaving|going)\b/i;
function toldAway(from){
  const a = dayMs(from) - DAY, b = dayMs(from) + DAY;
  const hers = store.msgs.filter(m => { if (!m.is_user) return false; const d = core.msgDate(m); return d && +d >= a && +d < b; });
  const hit = hers.reverse().find(m => { const t = String(m.mes || ''); return AWAY.test(t) || (RIDE.test(t) && GOING.test(t)); });
  return hit ? String(hit.mes) : '';
}
// was `day` ('YYYY-MM-DD') inside a time away she had told him about? She did not write that day, and her last
// day before it (or the day before that) says she was going away (toldAway). → her line, or ''. An explained absence is
// never "she did not come to me": the age-out is told so, and an item it writes for such a day is kept to that.
function awayTold(day){
  const d = dayOf(day); if (!d) return '';
  const hers = [...new Set(store.msgs.filter(m => m.is_user).map(m => core.msgDate(m)).filter(Boolean).map(x => isoDay(x)))].sort();
  if (hers.includes(d)) return '';
  const last = hers.filter(x => x < d).pop(); if (!last) return '';
  const line = toldAway(last); if (!line) return '';
  // a trip explains the days it said it would last (三四天 → 4), plus a day; none said: a week; never more than 14 days
  const said = tripDays(line), upto = Math.min(14, said ? said + 1 : 7);
  return core.calendarDays(dayMs(last), dayMs(d)) <= upto ? line : '';
}
const ZH_N = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function tripDays(t){
  const m = /([0-9一两二三四五六七八九十]{1,3})\s*(天|日|周|个?星期|days?|weeks?)/i.exec(String(t || '')); if (!m) return 0;
  const digits = [...m[1]].map(c => /\d/.test(c) ? Number(c) : ZH_N[c] || 0);
  let n = /^\d+$/.test(m[1]) ? Number(m[1]) : m[1].includes('十') ? (m[1].startsWith('十') ? 10 : (ZH_N[m[1][0]] || 1) * 10) + (m[1].endsWith('十') ? 0 : ZH_N[m[1].slice(-1)] || 0) : Math.max(...digits);
  return /周|星期|week/i.test(m[2]) ? n * 7 : n;
}
// the words that make an explained day "she did not come to me" (and his half of it, "nor did I go to her"): cut out
const NOT_CAME = /[，,；;]?\s*[^，,。；;！!]*?(?:没(?:有)?来?(?:找|理|联系|搭理)我|不来?(?:找|理)我|我也没去?找(?:你|她))[^，,。；;！!]*/g;
function keepTold(text){
  const t = String(text || '').replace(NOT_CAME, '').replace(/^[，,；;\s]+/, '').replace(/[，,；;]\s*([。！!]?)$/, '$1').trim();
  return t && !/[。！!.]$/.test(t) && /[。！!.]$/.test(String(text).trim()) ? t + String(text).trim().slice(-1) : t;
}
function absenceText(from, to, days, told){
  const md = d => { const t = new Date(dayMs(d)); return { zh: `${t.getMonth() + 1}月${t.getDate()}日`, en: t.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) }; };
  if (chatLanguage(store.msgs) === 'en'){
    const n = `${days} day${days > 1 ? 's' : ''}`;
    if (told && from) return `You told me you were going away; you were gone ${n} after ${md(from).en} and came back on ${md(to).en}.`;
    return from ? `After ${md(from).en} you didn't come to me for ${n}; you came back on ${md(to).en}.` : `You didn't come to me for ${n}.`;
  }
  if (told && from) return `${md(from).zh}你说要出门，走了${zhNum(days)}天，${md(to).zh}回来了。`;
  return from ? `${md(from).zh}之后你${zhNum(days)}天没来找我，${md(to).zh}才回来。` : `你${zhNum(days)}天没来找我。`;
}
// an older absence item ("你有6天没来（2026-10-24 到 2026-10-30）") is written again in his voice, on open
async function reword(){
  if (!store.writable) return 0;
  let n = await redate();
  // an older item of his (written before items were dated) that still says 明天 / 今天 …: written again, the word read as a date.
  // Once per companion: after a pass that rewrote something, the record memory-queue/dated { v: 1 } says it is done (new items
  // are dated when written). A companion with nothing to rewrite gets no record (opening him writes nothing); the look is cheap
  let dated = null; try { dated = await records.get(QTYPE, 'dated'); } catch {}
  if (!(dated && Number(dated.v) >= 1) && core.datedWords){
    let k = 0;
    for (const m of store.memory) if (ours(m) && m.voice === 'his' && /前天|昨天|昨晚|今天|今早|今晚|明天|明早|明晚|后天/.test(m.text || '') && core.datedWords(m.text, m.date) !== m.text){
      try { await saveMemoryItem(m); k++; } catch(e){ console.error(e); }
    }
    if (k) try { await records.commit(QTYPE, { id: 'dated', v: 1, at: now().getTime() }, { writer: 'core', app: 'memory' }); } catch(e){ console.error(e); }
    n += k;
  }
  for (const m of store.memory) if (m.kind === 'absence' && /written by Modu/.test(m.source || '') && /^(你有\d+天没来|You were away for \d+ days)/.test(m.text || '')){
    const from = m.date && m.date !== m.to ? m.date : '', to = m.to || m.date;
    const days = from ? core.calendarDays(dayMs(from), dayMs(to)) : Number((/\d+/.exec(m.text) || [0])[0]);
    if (!(days > 0)) continue;
    m.text = absenceText(from, to, days); try { await saveMemoryItem(m); n++; } catch(e){ console.error(e); }
  }
  if (n) emit('memory', store.memory);
  return n;
}
// The age-out: every waiting day in one call, with the tidy (merge, fade) inside it, then the facts pass.
// → { items, merged, faded, days } or null (nothing waiting, 暂停, or the call failed: the days wait; never a retry loop)
let aging = null;
function flush(){ if (!aging) aging = ageOut().finally(() => { aging = null; }); return aging; }
async function ageOut(){
  const q = await queued(); if (!q.days.length || paused() || (q.retry_at && now().getTime() < q.retry_at)) return null;
  const who = core.currentId, t = now().getTime(), items = store.memory.filter(m => !faded(m, t) || openThread(m)).slice(-60);
  const v = { date: q.days.length === 1 ? q.days[0].day : `${q.days[0].day} – ${q.days[q.days.length - 1].day} (${q.days.length} days, together)`,
    day_record: q.days.map(d => dayText(d.day, d.record)).join('\n\n'),
    // the days of a time away she had told him about (a trip): never "she did not come to me"
    away_note: (() => { const told = q.days.map(d => d.day).filter(d => awayTold(d)); return told.length ? `On ${told.join(', ')} she was away on a trip she had told ${store.name} about before she left. Those days she was away for a reason: never write that she did not come to ${store.name}, did not look for ${store.name} or left ${store.name} alone, and give them no bad feeling of their own.` : ''; })(),
    memory_items: items.map(m => `${m.file}: ${m.text}${openThread(m) ? '（open: ' + m.threads.join('; ') + '）' : ''}`).join('\n') || '(none)' };
  let out = null, tried = false; try { tried = !paused(); out = await side('ageout', v); } catch(err){ console.error(err); out = null; }
  if (core.currentId !== who) return null;
  const sent = new Set(q.days.map(d => d.day));
  if (!out){
    if (tried && !paused()){   // failed or not JSON: back off, keep every day (and any told meanwhile)
      await withQueue(async () => { const q2 = await queued(), fails = (Number(q2.fails) || 0) + 1;
        await putQueue(q2.days, { fails, retry_at: now().getTime() + Math.min(24, Math.pow(2, fails - 1)) * HOUR }); });
    }
    return null;
  }
  const day = q.days[q.days.length - 1].day, src = `day/${q.days.map(d => d.day).join(', ')} (aged out, derived by the model)`;
  const got = [].concat(out.items || []).filter(o => o && o.text).slice(0, 4);
  // each item is dated by the day it is from (its "day", or a date it starts with), not all by the last day of the batch
  const made = await addItems(got.map(o => { const w = itemDay(o, q.days.map(d => d.day));
    // an item for a day of a time away she had explained keeps no "没来找我", and no bad feeling for it
    const told = awayTold(w.day), text = told ? keepTold(w.text) : w.text, val = told && Number(o.valence) < 0 ? 0 : o.valence;
    return { kind: 'moment', date: w.day, text: core.tidyCJK ? core.tidyCJK(text) : text,
      importance: o.importance, valence: val, arousal: o.arousal, threads: o.threads, source: src }; }));
  for (const o of got) for (const f of [].concat(o.closes || [])){ const m = byFile(f); if (m && ours(m) && !m.closed){ m.closed = day; await saveMemoryItem(m); } }
  let merged = 0, fadedN = 0;
  for (const g of [].concat(out.merge || [])){
    const keep = g && byFile(g.keep); if (!keep || !ours(keep)) continue;
    for (const f of [].concat(g.drop || [])){
      const m = byFile(f); if (!m || m === keep || !ours(m)) continue;
      const imp = Math.max(importance(keep) || 0, importance(m) || 0); if (imp) keep.importance = imp;
      if (m.reinforced) keep.reinforced = (Number(keep.reinforced) || 0) + Number(m.reinforced);
      await dropItem(m); merged++;
    }
    if (g.text && String(g.text).trim()) keep.text = String(g.text).trim();
    await saveMemoryItem(keep);
  }
  for (const f of [].concat(out.fade || [])){ const m = byFile(f); if (m && ours(m) && !m.faded){ m.faded = day; await saveMemoryItem(m); fadedN++; } }
  merged += await tidyLocal();
  await withQueue(async () => { const q2 = await queued(); await putQueue(q2.days.filter(d => !sent.has(d.day)), { fails: 0, retry_at: 0 }); });   // only the days this call took
  emit('memory', store.memory);
  await consistency();
  return { items: made, merged, faded: fadedN, days: q.days.map(d => d.day) };
}
// which of the aged-out days an item is from → { day, text }: its "day" when that is one of them, else a date its text
// starts with ("10-30 早上…", "2026-10-30 …", "10月30日…": that prefix is dropped, the date shows under it), else the last day
const LEAD_DAY = /^\s*(?:(\d{4})[-/.年])?(\d{1,2})(?:[-/.月])(\d{1,2})日?\s*[,，:：]?\s*/;
function itemDay(o, days){
  const text = String(o.text || '').trim(), last = days[days.length - 1];
  const want = String(o.day || o.date || '').slice(0, 10);
  if (days.includes(want)) return { day: want, text };
  const m = LEAD_DAY.exec(text);
  if (m){ const md = `${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`, hit = days.find(d => d.slice(5) === md && (!m[1] || d.startsWith(m[1])));
    if (hit && text.slice(m[0].length).trim()) return { day: hit, text: text.slice(m[0].length).trim() }; }
  return { day: last, text };
}
// an older aged-out item, dated by the last day of its batch though its text names another of those
// days, is dated again (on open); its words stay as they are
async function redate(){
  let n = 0;
  for (const m of store.memory){
    const src = /^day\/([\d, -]+) \(aged out/.exec(m.source || ''); if (!src) continue;
    const days = src[1].split(/,\s*/).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)); if (days.length < 2) continue;
    const w = itemDay({ text: m.text }, days); if (w.day === m.date || w.text === String(m.text || '').trim()) continue;
    m.date = w.day; try { await saveMemoryItem(m); n++; } catch(e){ console.error(e); }
  }
  if (n) store.memory.sort((a, b) => (a.date + a.file).localeCompare(b.date + b.file));
  return n;
}
function dayText(day, rec){
  rec = core.day && core.day.shape ? core.day.shape(rec || {}) : rec || {};
  const hm = ms => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const lines = [`${day}:`];
  for (const s of rec.slots || []) lines.push(`- ${hm(s.at)}${s.until ? '–' + hm(s.until) : ''} ${[s.where, s.doing].filter(Boolean).join('，')}${s.why ? '（' + s.why + '）' : ''}`);
  for (const h of rec.her || []) lines.push(`- ${h.at ? hm(h.at) + ' ' : ''}${h.line}`);
  if (rec.entry) lines.push(`evening: ${rec.entry}`);
  if (lines.length === 1) lines.push('- (only the outline of an ordinary day)');
  return lines.join('\n');
}
// Tidy with no call: the same thing written twice (nearly every pair shared) becomes one, the older kept. Never hers.
async function tidyLocal(){
  const list = store.memory.filter(m => ours(m) && m.kind !== 'summary'), sets = list.map(m => new Set(pieces(m.text).filter(x => !single(x))));
  let n = 0; const gone = new Set();
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++){
    if (gone.has(i) || gone.has(j) || !sets[i].size || !sets[j].size) continue;
    let both = 0; for (const x of sets[i]) if (sets[j].has(x)) both++;
    if (both / (sets[i].size + sets[j].size - both) < 0.85) continue;
    const keep = list[i], m = list[j];
    const imp = Math.max(importance(keep) || 0, importance(m) || 0); if (imp) keep.importance = imp;
    if (m.reinforced) keep.reinforced = (Number(keep.reinforced) || 0) + Number(m.reinforced);
    await saveMemoryItem(keep); await dropItem(m); gone.add(j); n++;
  }
  if (n) emit('memory', store.memory);
  return n;
}
// The tidy while he sleeps: a job (owner 'memory', kind 'memory-tidy') at his bedtime. The scheduler runs it through
// the handler below (jobs.handle), which moves the same job on to the next night; a core with no scheduler has it
// run before the next turn after it is due (or by memorySource.own.run(job)).
const TIDY_KIND = 'memory-tidy', TIDY_OWNER = 'memory';
let tidyAt = 0;
function bedtime(t){
  const d = new Date(t), weekend = d.getDay() === 0 || d.getDay() === 6;
  const hm = String(core.param ? core.param(`clock.${weekend ? 'weekend' : 'weekday'}.sleep`, '23:50') : '23:50').split(':').map(Number);
  const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hm[0] || 0, hm[1] || 0).getTime() + ((hm[0] || 0) < 6 ? DAY : 0) + 30 * 60000;
  return at > t ? at : at + DAY;
}
let booking = Promise.resolve();
function bookTidy(){ booking = booking.then(bookOnce, bookOnce); return booking; }   // one at a time: never two pending tidies
async function bookOnce(){
  if (!core.jobs || !store.name || memorySource.outside) return;   // her own memory: Modu's engine books nothing
  if (!store.memory.some(m => !lasting(m) && ours(m))) return;   // nothing that could be written twice yet: no job in his folder
  try {
    const open = (await core.jobs.list({ owner: TIDY_OWNER, kind: TIDY_KIND, state: 'pending' }))[0];
    tidyAt = open ? open.at : (await core.jobs.add({ id: TIDY_KIND + '-' + (await core.jobs.list({ owner: TIDY_OWNER, kind: TIDY_KIND })).length, kind: TIDY_KIND, owner: TIDY_OWNER, at: bedtime(now().getTime()), payload: { what: 'merge his memory items written twice' } })).at;
  } catch(e){ console.error(e); }
}
// the scheduler's handler for owner 'memory': tidy (never while 暂停), then the same job waits for the next night
async function onJob(job, ctx){
  if (!job || job.kind !== TIDY_KIND || memorySource.outside) return 'drop';   // her own memory: Modu's engine tidies nothing
  const t = ctx && ctx.t != null ? ctx.t : now().getTime();
  if (!paused()) await tidyLocal();
  tidyAt = bedtime(t + 60000);
  return { at: tidyAt };
}
const scheduled = !!(core.jobs && typeof core.jobs.handle === 'function');
if (scheduled) core.jobs.handle(TIDY_OWNER, onJob);
async function run(job){
  if (!job || job.kind !== TIDY_KIND) return false;
  if (!paused()) await tidyLocal();   // makes no call, but 暂停 means no tidy either
  try { await core.jobs.done(job.id, 'core'); } catch {}
  await bookTidy();
  return true;
}

// --- The facts pass (consistency, at summary time: after an age-out or 整理) ----------------------------------
async function consistency(){
  await readFacts();
  const { fixed, moving } = cardFacts(), said = facts.said.filter(f => !f.overtaken);
  if (!said.length || paused()) return null;
  const last = Math.max(...said.map(f => f.said_at || f.at || 0));
  if (!checkedAt){ try { const r = await records.get(QTYPE, 'pass'); checkedAt = (r && Number(r.checked_at)) || 0; } catch {} }
  if (last <= checkedAt) return null;   // nothing said since the last pass (kept in memory-queue/pass.json, across opens)
  let out = null;
  try {
    out = await side('consistency', {
      card_facts: fixed.map(f => '- ' + f).join('\n') || '(none)',
      moving_facts: moving.filter(f => f.owner.kind === 'memory').map(f => `- ${f.key}: ${f.start}${f.note ? '（' + f.note + '）' : ''}`).join('\n') || '(none)',
      said_facts: said.map(f => `- ${f.key}: ${f.value}`).join('\n'),
      memory_items: store.memory.filter(m => !faded(m)).slice(-40).map(m => '- ' + m.text).join('\n') || '(none)' }, 700);
  } catch(e){ console.error(e); out = null; }
  if (!out) return null;
  checkedAt = last;
  for (const c of [].concat(out.current || [])) if (c && c.fact && c.value != null && String(c.value).trim()) await noteSaid(c.fact, c.value, c.from === 'said' ? 'chat' : 'memory', 'consistency pass');
  const mark = async (f, extra) => records.commit(FACTS, Object.assign({}, f, { rev: undefined }, extra), { writer: 'core', app: FACTS });
  for (const s of [].concat(out.slips || [])){ const f = s && s.said && (said.find(x => x.value === s.said) || said.find(x => x.value.includes(s.said))); if (f) await mark(f, { slip: { breaks: String(s.breaks || ''), keep: String(s.keep || '') } }); }
  for (const d of [].concat(out.drop_said || [])){ const f = d && said.find(x => x.value === d); if (f) await mark(f, { overtaken: now().getTime() }); }
  await readFacts();
  checkedAt = Math.max(checkedAt, ...facts.said.map(f => f.said_at || 0));
  try { await records.commit(QTYPE, { id: 'pass', checked_at: checkedAt, at: now().getTime() }, { writer: 'core', app: 'memory' }); } catch(e){ console.error(e); }
  return out;
}

// --- Meaning search (off by default): her own embedding key; the vectors are a deletable derived cache --------
// settings.meaning = { on, endpoint, model, key }, in this browser with her other settings, never in his folder. The
// vectors are a record beside the items, memory-vectors/<model>.json; forgetVectors() deletes it; it is rebuilt.
const meaning = { qvec: null, vecs: null, model: '' };
const VEC = 'memory-vectors';
function meaningSettings(){ const s = settingsNow(), m = s && s.meaning; return m && m.on && m.endpoint && m.model ? m : null; }
// Each embedding call is noted in 用量 (calls.note('meaning'): its own row, cost.row.meaning) and
// there are at most memory.meaning_per_day of them a day (default 60, about 30 turns; counted from 用量's tally, so a
// reload does not reset it). Over the cap the turn goes on with the plain search.
let meaningToday = { day: '', n: 0 };
function meaningUsed(){
  const day = core.isoDay(now());
  if (core.calls && typeof core.calls.days === 'function'){ const d = core.calls.days(31).find(x => x.day === day); return d ? Number((d.by || {}).meaning) || 0 : 0; }
  return meaningToday.day === day ? meaningToday.n : 0;
}
async function embed(m, input){
  if (meaningUsed() >= Math.max(0, Number(P('meaning_per_day', 60)) || 0)) throw Object.assign(new Error('meaning cap'), { code: 'cap' });
  const day = core.isoDay(now()); meaningToday = { day, n: (meaningToday.day === day ? meaningToday.n : 0) + 1 };
  const heard = core.calls ? core.calls.note('meaning', [{ role: 'user', content: input.join('\n') }], { settings: { endpoint: m.endpoint, model: m.model } }) : (x => x);
  const r = await hostFetch(String(m.endpoint).replace(/\/+$/, '') + '/embeddings', { method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, m.key ? { Authorization: 'Bearer ' + m.key } : {}), body: JSON.stringify({ model: m.model, input }) });
  if (!r.ok) throw new Error('embeddings ' + r.status);
  const j = await r.json(), out = (j.data || []).map(d => d.embedding);
  heard(out.length ? `${out.length} × ${(out[0] || []).length}` : '');   // the answer's size, in brief: how many vectors
  return out;
}
const unit = v => { const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1; return v.map(x => Math.round(x / n * 1e4) / 1e4); };
function meaningOf(m, q){ const v = meaning.vecs && meaning.vecs[m.file]; if (!v || v.length !== q.length) return 0; let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * q[i]; return s; }
async function prepareMeaning(){
  const m = meaningSettings(); meaning.qvec = null;
  if (!m || paused() || !store.name) return;
  const id = factId(m.model);
  try {
    if (!meaning.vecs || meaning.model !== m.model){ const r = await records.get(VEC, id); meaning.vecs = (r && r.vecs) || {}; meaning.model = m.model; }
    const missing = store.memory.filter(x => !meaning.vecs[x.file]).slice(0, 16);   // at most 16 new items a turn, in one call
    if (missing.length){
      const got = await embed(m, missing.map(x => x.text)); sideCalls++;
      missing.forEach((x, i) => { if (got[i]) meaning.vecs[x.file] = unit(got[i]); });
      await records.commit(VEC, { id, model: m.model, vecs: meaning.vecs, at: now().getTime() }, { writer: 'core', app: 'memory' });
    }
    const her = store.msgs.filter(x => x.is_user).slice(-4).map(x => x.mes).join('\n');
    if (her){ const [q] = await embed(m, [her]); sideCalls++; meaning.qvec = q ? unit(q) : null; }
  } catch(e){ if (!e || e.code !== 'cap') console.error(e); meaning.qvec = null; }
}
async function forgetVectors(){
  meaning.vecs = null; meaning.qvec = null;
  for (const r of await records.list(VEC).catch(() => [])) await records.remove(VEC, r.id);
}

// --- Before each turn (the memory source's readRecall, which refreshLife waits for) ------------------------------
async function prepare(){
  if (!store.name) return;
  if (facts.key !== lifeKey()) await readFacts();
  const q = await queued();
  if (q.days.length && Date.now() - lastDayTell > 1500) flush();   // days told one after another go out together
  // a chat that came with 搬家 and is still waiting for the memory job: her turn waits for it a little (memory.import_wait_ms),
  // so the first thing she asks ("他记得我吗") meets what he knows of her
  if (core.importMemory){
    let timer = null; const ms = Math.max(0, Number(P('import_wait_ms', 20000)) || 0);
    try { await Promise.race([core.importMemory(), new Promise(res => { timer = setTimeout(res, ms); })]); } catch(e){ console.error(e); } finally { clearTimeout(timer); }
  }
  if (tidyAt && now().getTime() >= tidyAt && core.jobs && !scheduled){
    tidyAt = 0;
    try { const due = (await core.jobs.due()).filter(j => j.owner === TIDY_OWNER && j.kind === TIDY_KIND); for (const j of due) await run(j); if (!due.length) await bookTidy(); } catch(e){ console.error(e); }
  }
  await prepareMeaning();
}
// Modu's own recall, for a host that asks the seam: the memory block's text for these messages
function recall(o = {}){
  const msgs = [].concat(o.recent || []).map(m => ({ is_user: m.who === 'her', mes: String(m.text || '') }));
  return memoryBlock({ name: store.name || '', allMsgs: msgs, budget: Number(o.budget) || 3500, note: {} });
}
// memory format 0.4 on open: older Modu files are written again as real YAML, nothing lost (memoryNeedsMigration)
async function migrate(){
  if (!store.writable || !core.memoryNeedsMigration) return 0;
  let n = 0; for (const m of store.memory.slice()) if (core.memoryNeedsMigration(m)){ try { await saveMemoryItem(m, { format: true }); n++; } catch(e){ console.error(e); } }
  return n;
}
core.listeners.add((ev, d) => {
  if (ev === 'loaded'){ migrate().then(reword, reword); facts = { key: null, said: [], text: '' }; meaning.vecs = null; checkedAt = 0; tidyAt = 0; bookTidy(); readFacts(); }
  if (ev === 'records' && d && (d.type === FACTS || d.type === 'state') && d.owner !== 'her') readFacts();
});

const own = { id: 'modu', recall, tell, prepare, flush, run, add: addItems, useSettings: fn => { pageSettings = typeof fn === 'function' ? fn : null; }, tidy: tidyLocal, consistency, noteSaid, current, cardFacts, factId,
  strength, faded, lasting, importance, rank, bm25, pieces, forgetVectors, paused, queued, TIDY_KIND, TIDY_OWNER, onJob,
  get sideCalls(){ return sideCalls; }, get facts(){ return clone(facts.said); } };
memorySource.own = own;
Object.assign(core, { memoryOwn: own, awayTold });
})(globalThis[Symbol.for('modu.core')]);
// app/core/turn.js: one turn: her message in, his reply out (send).
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, store, msgDate, tidyCJK, parseReply, appendToChat, writeChat, refreshLife, publishPersona,
  publish, setPhase, buildContext, callModel } = core;

// --- One turn: her message in, his reply out --------------------------------------------------
// Returns his message (a 酒馆 message with extra.modu_emotion) or throws.
core.lastContext = null;   // what the last turn's prompt was made of (sizes only), for 设置 and tests
async function send(text, settings, opts={}){
  // her message is stored under her chat's own name (store.meta.user_name); the name she gave in 聊天设置
  // is hers, on her phone, and only his prompts read it (buildContext, core.userName), never his folder
  const userName = (store.meta && store.meta.user_name) || 'You';
  const mine = { name:userName, is_user:true, is_name:true, send_date: +core.now(), mes:text };   // the core's clock (?at=, a host, a test)
  if (opts.later) mine.extra = { modu_asleep: mine.send_date };
  await appendToChat(mine); emit('message', mine);
  publish({ type:'turn', speaker:'user', name:userName, text });
  // opts.later: he is asleep, so nothing is asked of the model now. Her message is in the chat, delivered
  // and not read (extra.modu_asleep: when it came); the 'deferred' event lets the scheduler book his reply for his wake
  // (reach.js, replies.asleep); his message comes back as with [no-reply]: mes '', extra.modu_no_reply 'asleep', unsaved
  if (opts.later){
    const theirs = { name: store.name, is_user:false, is_name:true, send_date: mine.send_date, mes:'', extra:{ modu_emotion:'neutral', modu_emotion_from:'none', modu_no_reply:'asleep' } };
    emit('deferred', mine); core.updatePresence(); publishPersona();
    return theirs;
  }
  setPhase('thinking');
  try {
    await refreshLife();   // the life block reads his records: wait until the copy is fresh
    const ctx = buildContext({ window: opts.window, inner: opts.inner, noReply: opts.noReply, next: opts.next, promise: opts.promise, call: opts.call, actions: opts.actions, settings });
    core.lastContext = { size: ctx.size, report: ctx.report, memory: ctx.memory, life: ctx.life, events: ctx.events, known: ctx.known, skipped: !!ctx.skipped, at: Date.now() };
    // her turn is counted for the cost meter (设置 → 用量): calls.note, no key kept
    const heard = core.calls ? core.calls.note('chat', ctx.messages, { turn: true, settings }) : (x => x);
    const raw = heard(await callModel(settings, ctx.messages, Object.assign({ own: true }, ctx.skipped ? { user: core.currentId || store.name } : {})));   // her own turn
    // this turn got through, and its context carried her earlier unsent messages to him: unmark them
    let carried = false;
    for (const m of store.msgs) if (m.extra && m.extra.modu_unsent){ delete m.extra.modu_unsent; carried = true; }
    const r = parseReply(raw);
    const said = tidyCJK(r.text), emotion = r.emotion;
    const theirs = { name: store.name, is_user:false, is_name:true, send_date: +core.now(), mes: said, extra:{ modu_emotion: emotion, modu_emotion_from: r.labelled ? 'model' : 'none' } };
    if (r.inner) theirs.extra.modu_inner = tidyCJK(r.inner);
    // his first [state: …] tag is a proposal; state.nudge keeps to the card's rules and refuses a key
    // it did not declare (a card with no state: nothing happens). [promise: …] is kept for the scheduler.
    // read again against the card's own keys first (a key such as stage-2 holds a sign)
    if (r.state.length && core.state) { try { const s0 = (core.state.fromTag && core.state.fromTag(r.state[0].raw)) || r.state[0]; await core.state.nudge(s0.key, s0.delta, s0.why, { writer:'model', turn: mine.send_date }); } catch(e){ console.error(e); } }
    if (r.promises.length) theirs.extra.modu_promises = r.promises.slice(0, 3);
    if (r.nextContact != null) theirs.extra.modu_next_contact = r.nextContact;
    // he read it and did not answer (asked for with [no-reply], or nothing left to say once the
    // tags are cut). Nothing goes into the chat; the 'noreply' event says so, and his message comes back
    // with mes '' and extra.modu_no_reply, unsaved.
    if (r.noReply || !said){
      theirs.extra.modu_no_reply = r.noReply ? 'model' : 'empty';
      if (carried) await writeChat();
      emit('noreply', theirs);
      return theirs;
    }
    setPhase('speaking');
    await appendToChat(theirs); emit('message', theirs);
    publish({ type:'turn', speaker:'companion', name: store.name, text: said, emotion });
    // the memory source hears every turn (Modu's own does nothing with it yet); never waited for
    if (core.memorySource) core.memorySource.tell({ kind:'chat', msgs: [{ who:'her', text, at: mine.send_date }, { who:'him', text: said, at: theirs.send_date }] });
    return theirs;
  } catch(e){
    // her message did not reach him. It stays in her chat marked as unsent (extra.modu_unsent, the
    // time it failed), so the mark is still there after a reload; the error goes on to the caller.
    mine.extra = Object.assign({}, mine.extra, { modu_unsent: Date.now() });
    await writeChat();
    throw e;
  } finally { setPhase('idle'); publishPersona(); }
}

// --- His turn inside an app --------------------------------------------------------------------------------
// turn(told, { inner, max, tags }): one turn of his about something that happens in an app: his usual prompt
// (buildContext, with the event log and the activity block) plus one system line `told`, read with parseReply
// Nothing is added to the chat and no 'message' event is sent: the app shows his words itself (or, to
// put them in the chat as his message, uses 钱包's sayAsHim). Throws when the model fails.
//   inner  ask for his 心声 too                    max   max_tokens (default 400)   settings  (default loadSettings())
//   tags   app tag names to read out of his reply, e.g. ['出']: a line [出: 石头] is cut from text and given
//          back as tags['出'] = '石头' (the first one of each name)
//   as     the name the cost meter counts this call under (e.g. 'shelf' for 他可能喜欢; default 'app')
// → { text (tidied, tags cut), inner, mood (the emotion label), raw (the model's text as it came), noReply, tags }
async function turn(told, opts = {}){
  const settings = opts.settings || core.loadSettings();
  setPhase('thinking');
  try {
    await refreshLife();
    const built = buildContext({ settings, inner: !!opts.inner });   // the core names her (core.userName)
    const extra = String(told == null ? '' : told).trim();
    // through the public ModuCore.callModel, so a host or a test that swaps it (as the apps' own tests do) is heard
    const call = (globalThis.ModuCore && typeof globalThis.ModuCore.callModel === 'function') ? globalThis.ModuCore.callModel : callModel;
    const msgs = built.messages.concat(extra ? [{ role:'system', content: extra }] : []);
    const heard = core.calls ? core.calls.note(opts.as || 'app', msgs, { settings }) : (x => x);   // counted for the cost meter
    const raw = heard(await call(settings, msgs, { max_tokens: Number(opts.max) || 400, own: true }));   // her own tap in an app
    const tags = {}; let rest = String(raw == null ? '' : raw);
    for (const name of [].concat(opts.tags || []).map(String).filter(Boolean)){
      const q = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      rest = rest.replace(new RegExp(`[\\[【(（]\\s*${q}\\s*[:：]\\s*([^\\]】)）\\n]{0,60}?)\\s*[\\]】)）]`, 'g'), (m, v) => { if (!(name in tags)) tags[name] = v.trim(); return ''; });
    }
    const r = parseReply(rest.replace(/\n{3,}/g, '\n\n').trim());
    return { text: tidyCJK(r.text || ''), inner: tidyCJK(r.inner || ''), mood: r.emotion, raw: String(raw == null ? '' : raw), noReply: !!r.noReply, tags };
  } finally { setPhase('idle'); }
}

// The day they met: the first dated message (for 在一起第 N 天).
function togetherSince(){ const ds = store.msgs.map(msgDate).filter(Boolean); return ds.length ? new Date(Math.min(...ds)) : null; }

Object.assign(core, { send, turn, togetherSince });
})(globalThis[Symbol.for('modu.core')]);
// app/core/settings.js: settings: defaults, opt-in persistence (the key is kept only if she says so).
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { env, CONTEXT_BUDGET } = core;

// --- Settings (opt-in persistence; the key is kept only if the user said so) --------------------
const SETTINGS_KEY = 'modu-settings';
// The local model server (a model proxy on her own PC), by where the page is
// opened: on the PC itself, 127.0.0.1:8787; shared privately over Tailscale (a *.ts.net name, or an
// address by number), port 8443 of the same address (app/README.md, "On her phone over Tailscale"); on a
// real hostname with one front door for page and model, /v1 on
// the page's own origin. The server wants its per-run token (settings.token).
function localModelAddress(loc){
  const h = String((loc && loc.hostname) || ''), proto = (loc && loc.protocol) || '';
  if (proto === 'file:' || /^(127\.0\.0\.1|localhost|\[::1\])$/i.test(h)) return 'http://127.0.0.1:8787/v1';
  if (/\.ts\.net$/i.test(h) || /^[\d.]+$/.test(h) || h.startsWith('[')) return `https://${h}:8443/v1`;
  return `${proto}//${(loc && loc.host) || h}/v1`;
}
// With no page (a backend, a worker: no location), the PC's own address.
const LOCAL_MODEL = localModelAddress(typeof location !== 'undefined' && location ? location : { hostname:'127.0.0.1', protocol:'http:' });
// assembly 'modu' (the blocks) or 'none' (an agent brings its own persona and memory),
// contextBudget (characters for the whole prompt), userPersona (how she describes herself), timezone
// (hers, IANA; '' = this device's), modelNotes (her own per-model notes).
const DEFAULT_SETTINGS = { provider:'local', endpoint:LOCAL_MODEL, model:'claude-sonnet-5-5', key:'', token:'', window:40, bridge:'', remember:false,
  assembly:'modu', contextBudget: CONTEXT_BUDGET, userPersona:'', timezone:'', modelNotes:'',
  // the side model for the small calls (day sketch, decider, age-out, shelf): null = the chat model. Its key
  // is kept like the chat key (only when she says remember), on this device, never in his folder.
  side: null };
// where settings are remembered: the host's (setEnv prefs), else localStorage, else memory for the visit
const memPrefs = (() => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); } }; })();
function prefs(){ if (env.prefs) return env.prefs; try { if (typeof localStorage !== 'undefined' && localStorage) return localStorage; } catch {} return memPrefs; }
function loadSettings(){
  try { const s = JSON.parse(prefs().getItem(SETTINGS_KEY) || 'null'); if (s) { const o = Object.assign({}, DEFAULT_SETTINGS, s, { remember:true }); if (o.provider === 'local') o.endpoint = LOCAL_MODEL; return o; } } catch {}
  return Object.assign({}, DEFAULT_SETTINGS);
}
function saveSettings(s){
  try { if (s.remember) prefs().setItem(SETTINGS_KEY, JSON.stringify(s)); else prefs().removeItem(SETTINGS_KEY); } catch {}
}

// --- The side model, her 他找你 settings, 暂停, and one counter for every side call ------------------------------
// sideSettings(s?) → the settings a side call uses: her side model when she chose one ({ endpoint, model, key }),
// else the chat model's own.
// the page's settings as they are now (her key may be kept only for this visit): useSettings(fn) → fn() is read
let live = null;
function useSettings(fn){ live = typeof fn === 'function' ? fn : null; }
function currentSettings(){ try { const s = live && live(); if (s && typeof s === 'object') return Object.assign({}, s); } catch {} return loadSettings(); }
function sideSettings(s){
  s = s || currentSettings();
  const o = s.side && typeof s.side === 'object' && String(s.side.endpoint || '').trim() ? s.side : null;
  return o ? Object.assign({}, s, { provider:'custom', endpoint: String(o.endpoint).trim(), model: String(o.model || s.model || ''), key: String(o.key || ''), token:'' }) : Object.assign({}, s);
}
// 他找你 (设置): { v, on, cap?, quiet? ['HH:MM','HH:MM'], notices, paused, pausedAt? }. Not secret, so kept on this device
// always (prefs 'modu-reach'), apart from the settings. cap and quiet are kept only once she set them; until then
// his params' knobs (initiative.default_cap, initiative.quiet_hours) answer. Hers go to params.setHer, so they win
// over every knob and a knob can never raise her cap.
// The stored setting carries its format, v: 1; an older one has none (the same shape), so on open it is
// taken as v 1 and written back once with it. A later shape bumps v and grows a step here.
const REACH_KEY = 'modu-reach', REACH_V = 1, REACH_DEFAULTS = { v: 1, on: true, cap: 2, notices: false, paused: false };   // her cap is 2 until she sets it
function loadReach(){
  let r = null; try { r = JSON.parse(prefs().getItem(REACH_KEY) || 'null'); } catch { r = null; }
  if (!(r && typeof r === 'object' && !Array.isArray(r))) r = null;
  else if (r.v == null){ r.v = REACH_V; try { prefs().setItem(REACH_KEY, JSON.stringify(r)); } catch {} }   // the migration: none → 1
  return Object.assign({}, REACH_DEFAULTS, r || {});
}
function herKnobs(r){
  const o = {};
  // always passed (2 until she sets it), so a card's knob can lower it but never raise it (a CAPS knob)
  o['initiative.default_cap'] = Number.isFinite(Number(r.cap)) && r.cap !== null && r.cap !== '' ? Math.max(0, Math.floor(Number(r.cap))) : REACH_DEFAULTS.cap;
  if (Array.isArray(r.quiet) && r.quiet.length === 2) o['initiative.quiet_hours'] = r.quiet.map(String);
  if (r.on === false) o['initiative.default_cap'] = 0;
  return o;
}
function applyReach(r){
  const keep = {}, info = core.params.info();
  for (const k of info.her || []) if (k !== 'initiative.default_cap' && k !== 'initiative.quiet_hours') keep[k] = core.param(k);
  core.params.setHer(Object.assign(keep, herKnobs(r || loadReach())));
}
// saveReach(patch) → the whole setting. Turning 暂停 off is an absence: `reach` { op:'resume', from, to }
// goes out, the memory source is told, and the next catch-up is the capped one, as after any time away.
function saveReach(patch){
  const was = loadReach(), r = Object.assign({}, was, patch || {});
  const t = core.now().getTime();
  if (r.paused && !was.paused) r.pausedAt = t;
  if (!r.paused && was.paused){ const from = was.pausedAt || t; delete r.pausedAt; core.emit('reach', { op:'resume', from, to: t });
    if (core.memorySource) core.memorySource.tell({ kind:'absence', at: t, from, to: t, days: t - from >= 432e5 ? Math.max(1, core.calendarDays(from, t)) : 0, why:'paused' }); }   // counted in calendar days, as everywhere
  else if (r.paused !== was.paused) core.emit('reach', { op: r.paused ? 'pause' : 'resume', at: t });
  try { prefs().setItem(REACH_KEY, JSON.stringify(r)); } catch {}
  applyReach(r);
  core.emit('reach', { op:'settings', reach: Object.assign({}, r) });
  return r;
}
// 暂停: while on, no side call of any kind (sketch, decider, 主动, posts, reactions, shelf, tidy). His life and memory ask paused().
const paused = () => !!loadReach().paused;
// sideCall(name, messages, opts?) → the model's text: the one door for every call that is not her own chat turn
// (name: 'sketch', 'decider', 'reach', 'ageout', 'tidy', 'shelf', 'post', …). It goes to the side model (opts.chat:
// the chat model, for words in his own voice), is counted (calls.list / calls.count: what the cost meter and the
// tests read), and is refused while 暂停 is on (an Error with code 'paused', counted as refused, never sent).
// The cost meter (设置 → 用量): every model call is also kept in a small tally on this device
// (prefs 'modu-calls', never in his folder): per day, her chat turns and the other calls by name, with the characters
// sent and received; and the last 40 calls in brief (name, time, model, the address's host, how many messages and
// characters, the first words of the last message). Never a key, a token or a whole prompt. A call that is not
// a side call (her chat turn, an app's turn, 整理, reading the card) is noted with calls.note(name, messages, o).
const callLog = [];
const CALLS_KEY = 'modu-calls', CALLS_DAYS = 14, CALLS_SENT = 40;
function tally(){
  try { const o = JSON.parse(prefs().getItem(CALLS_KEY) || 'null'); if (o && o.v === 1 && o.days && typeof o.days === 'object') return Object.assign({ sent: [] }, o); } catch {}
  return { v: 1, days: {}, sent: [] };
}
const hostOf = u => { try { return new URL(String(u || '')).host; } catch { return ''; } };
const charsOf = messages => (messages || []).reduce((n, m) => n + String((m && m.content) || '').length, 0);
// what a call sent, in brief: no key, no token, no whole prompt
function brief(name, messages, o, at){
  const s = o.settings || {}, last = (messages || [])[(messages || []).length - 1];
  return { name, at, turn: !!o.turn, model: String(s.model || '').slice(0, 60), host: hostOf(s.endpoint), msgs: (messages || []).length, chars: charsOf(messages),
    first: String((last && last.content) || '').replace(/\s+/g, ' ').trim().slice(0, 40) };
}
function keep(e, out){
  const t = tally(), d = core.isoDay(new Date(e.at)), day = t.days[d] || (t.days[d] = { chat: 0, side: 0, by: {}, in: 0, out: 0 });
  if (out != null){ day.out += out; }
  else {
    if (e.turn) day.chat++; else { day.side++; day.by[e.name] = (day.by[e.name] || 0) + 1; }
    day.in += e.chars; t.sent.push(e); if (t.sent.length > CALLS_SENT) t.sent.splice(0, t.sent.length - CALLS_SENT);
  }
  const keepFrom = core.isoDay(new Date(e.at - CALLS_DAYS * 864e5));
  for (const k of Object.keys(t.days)) if (k < keepFrom) delete t.days[k];
  try { prefs().setItem(CALLS_KEY, JSON.stringify(t)); } catch {}
}
// one call on its way: counted for this visit (calls.list) and in the tally; → a function that notes the answer's size
function counted(name, messages, o){
  const at = core.now().getTime(), e = brief(name, messages, o, at);
  callLog.push({ name, at, side: !o.chat && !o.turn, turn: !!o.turn }); if (callLog.length > 500) callLog.splice(0, callLog.length - 500);
  keep(e);
  return text => { keep(e, String(text == null ? '' : text).length); return text; };
}
const calls = {
  list(o = {}){ return callLog.filter(c => (!o.since || c.at >= o.since) && (!o.name || c.name === o.name)).map(c => Object.assign({}, c)); },
  count(o = {}){ return calls.list(o).filter(c => !c.refused).length; },
  clear(){ callLog.length = 0; },
  // calls.note(name, messages, { turn?, settings? }) → a function to hand the answer to (it notes its size): a call that
  // does not go through sideCall. turn: her own chat turn (聊天 in the meter); anything else counts with the side calls.
  note(name, messages, o = {}){ return counted(String(name || 'other'), messages, o); },
  // calls.days(n = 7) → [{ day: 'YYYY-MM-DD', chat, side, by: { name: n }, in, out }], newest first, the days that had any
  days(n = 7){ const t = tally(); return Object.keys(t.days).sort().reverse().slice(0, n).map(d => Object.assign({ day: d }, t.days[d], { by: Object.assign({}, t.days[d].by) })); },
  // calls.sent(n = 40) → the last calls in brief, newest first: { name, at, turn, model, host, msgs, chars, first }
  sent(n = CALLS_SENT){ return tally().sent.slice(-n).reverse(); },
  forget(){ try { prefs().removeItem(CALLS_KEY); } catch {} },
};
async function sideCall(name, messages, opts = {}){
  const at = core.now().getTime(), n = String(name || 'side');
  if (paused()){ callLog.push({ name: n, at, refused: true }); const e = new Error('暂停中'); e.code = 'paused'; throw e; }
  const base = opts.settings || currentSettings(), use = opts.chat ? base : sideSettings(base);
  const done = counted(n, messages, { chat: !!opts.chat, turn: !!opts.turn, settings: use });   // opts.turn: his reply to her (聊天 in 用量)
  core.emit('sidecall', { name: n, at });
  const call = (globalThis.ModuCore && typeof globalThis.ModuCore.callModel === 'function') ? globalThis.ModuCore.callModel : core.callModel;
  return Promise.resolve(call(use, messages, { max_tokens: Number(opts.max) || 400 })).then(done);
}
core.listeners.add(ev => { if (ev === 'loaded') { try { applyReach(); } catch {} } });

// The core API's version: one place, read only. It is the contract's version, not the build's
// (the build is <meta name="modu-version"> in index.html). Bump the minor number when the API grows.
const CORE_VERSION = '0.7';

Object.assign(core, { localModelAddress, DEFAULT_SETTINGS, loadSettings, saveSettings, CORE_VERSION, sideSettings, useSettings, currentSettings, loadReach, saveReach, applyReach, paused, sideCall, calls });
})(globalThis[Symbol.for('modu.core')]);
// app/core/reach.js: 主动: when he writes first, kept promises, [next] and [no-reply], invites (the peek notice is the page's).
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, now, store, clone, param, jobs, bell, records, msgDate, gapWords, isoDay, personaState, parseReply,
  tidyCJK, buildContext, appendToChat, writeChat, addChatCard, prompt, sideCall, loadReach, paused, noticeRules, pronouns, ticker,
  setContextBlock, contextBlocks, dayStatus } = core;

// Everything here rides on the one clock (clock.after) and on jobs owned by 'core'. Nothing writes to her unless
// every one of her limits allows it, and the decider's usual answer is "leave it". The rules, in order:
//   her limits  on/off, her daily cap (default 2; a knob can never raise it), a gap between two of his first
//               messages, quiet hours, a back-off after a failed call, never chasing twice in a row; 暂停 stops all.
//   triggers    real ones only: his status changes (a slot of his day), a long silence crosses a mark, a job comes
//               due. Each costs at most one decider call, ≤ 4 a day.
//   tags        [promise: …] → a force job that keeps it; [next: N] → a job re-checked by the decider when due;
//               [no-reply] → her message marked read, and a reply-later job.
//   asleep      her message while he is asleep gets no reply now: delivered, not read, and a reply-later job
//               at his wake (or, by replies.asleep, a few minutes later: she woke him), through quiet hours and 暂停.
//               a held message is always answered: the job never expires; at his wake if the page is open,
//               else the next time she opens it (dated then); a held message with no live job gets one on the next look.
//   catch-up    jobs due while the page was shut arrive in order, dated when they were due, at most the flood cap
//               of them; the expired ones are dropped and logged, never replayed. And after a day or more away:
//               one message for the time away, at a moment inside it (outside her quiet hours, while he was up,
//               within her cap), dated then; always exactly one, with no decider call (one call, so it is
//               there sooner). It runs before the job round (clock.before), so it looks before she has written.
//   invites     he may ask her into an app, with no closeness gate. The peek notice is an app's rule: the page's.
// What happened (and every skip, with its reason) is kept in one record of his, reach/state.json.
const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const MSG_KINDS = ['reach', 'promise', 'next', 'reply-later'];
const knob = (name, fallback) => { const v = param(name, fallback); return v == null ? fallback : v; };
const rnd = { fn: Math.random };
const R = () => rnd.fn();
const pad = n => String(n).padStart(2, '0');
const hm = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const minuteOf = t => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); };
const dayOf = t => isoDay(new Date(t));
const endOfDay = t => { const d = new Date(t); d.setHours(23, 59, 59, 0); return d.getTime(); };
const herName = () => { const u = core.userName(); return u !== 'You' ? u : 'her'; };   // her own name, from 聊天设置 too
const WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const clockWords = t => { const d = new Date(t); return `${WEEK[d.getDay()]} ${dayOf(t)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
// every prompt of his first move knows the hour and where he is in his own day (no sun at night)
function partOfDay(t){ const h = new Date(t).getHours(); return h < 5 ? 'the middle of the night, dark outside' : h < 9 ? 'early morning' : h < 11 ? 'morning' : h < 13 ? 'around noon' : h < 17 ? 'afternoon' : h < 19 ? 'early evening' : h < 23 ? 'night, dark outside' : 'late at night, dark outside'; }
// his slot at time t, in words, from his own day (setDayPlan, app/life.js), or '' with no day
function statusAt(t){
  let s = null; try { s = dayStatus ? dayStatus(new Date(t)) : null; } catch { s = null; }
  if (!s) return '';
  if (s.presence === 'asleep') return 'asleep';
  return [s.what || '', s.where ? `at ${s.where}` : '', s.busy ? '(busy, little time to talk)' : ''].filter(Boolean).join(' ');
}
// what is still open from her side: open threads in his memory (memory-engine), and what she said she would do
// in the last three days (her own words, before the memory job has read them)
const PLAN = /明天|今晚|晚上|待会|一会|等下|下午|周[一二三四五六日末]|要去|准备|打算|考试|比赛|面试|出差|答辩|体检|见面|旅游|旅行|出去玩|回老家|去[^\s，。！？,.!?]{1,6}(玩|几天|[一两二三四五六七]天|一趟|一周)|deadline|tomorrow|tonight|exam|interview|match|trip|travel/i;
function herThreads(t, o = {}){
  const out = [];
  for (const m of (store.memory || []).filter(m => m && Array.isArray(m.threads) && m.threads.length && !m.closed).slice(-2)) out.push(m.threads.join('; '));
  if (o.memoryOnly) return out;
  const hers = chatMsgs().filter(m => m.is_user && t - tOf(m) < 3 * DAY && t - tOf(m) > 0 && PLAN.test(String(m.mes || ''))).slice(-2);
  for (const m of hers) out.push(`she said (${clockWords(tOf(m))}): "${String(m.mes).replace(/\s+/g, ' ').slice(0, 80)}"`);
  return out;
}
const lastLines = (n = 8) => chatMsgs().slice(-n).map(m => `[${clockWords(tOf(m))}] ${m.is_user ? herName() : store.name}: ${String(m.mes || '').replace(/\s+/g, ' ').slice(0, 120)}`).join('\n');

// --- his record: reach/state.json ------------------------------------------------------------------------------
const TYPE = 'reach';
let st = null, stFor = '';
// peek: the page's peek-notice counters were once kept here; an old record keeps the field, read once by the page
const blank = () => ({ v: 1, id: 'state', at: 0, days: {}, lastSent: 0, skips: [], invites: [], missed: [], ignored: {}, declinedDay: '', backoff: { until: 0, n: 0 }, marks: {}, status: '' });
async function load(fresh){
  const key = (core.currentId || '') + '|' + (store.name || '');
  if (st && stFor === key && !fresh) return st;
  let r = null; try { r = await records.get(TYPE, 'state'); } catch {}
  st = Object.assign(blank(), r || {}); stFor = key; return st;
}
let saving = Promise.resolve();
function save(){
  if (!st || !store.name) return saving;
  const rec = Object.assign({}, st, { at: now().getTime() }); delete rec.rev;
  rec.skips = rec.skips.slice(-100); rec.invites = rec.invites.slice(-40);
  for (const k of Object.keys(rec.days)) if (k < dayOf(now().getTime() - 14 * DAY)) delete rec.days[k];
  saving = saving.then(() => records.commit(TYPE, rec, { writer: 'core', app: 'reach' })).then(r => { if (r && r.record) st.rev = r.record.rev; }).catch(e => console.error(e));
  return saving;
}
const today = t => { const d = dayOf(t), o = st.days[d] || (st.days[d] = { sent: 0, decided: 0, invites: 0, reads: 0 }); if (o.promises == null) o.promises = 0; return o; };
function skip(why, what, t, note){
  const e = { at: t || now().getTime(), why: String(why), what: String(what || '') }; if (note) e.note = String(note).slice(0, 80);   // note: the decider's own few words, for the log
  st.skips.push(e); emit('reach', { op: 'skip', skip: e });
  return e;
}

// --- her limits -------------------------------------------------------------------------------------------------
function quietRange(){ const q = knob('initiative.quiet_hours', ['00:30', '08:00']); return Array.isArray(q) && q.length === 2 ? q.map(hm) : [null, null]; }
function inQuiet(t){
  const [a, b] = quietRange(); if (a == null || b == null || a === b) return false;
  const m = minuteOf(t); return a < b ? m >= a && m < b : m >= a || m < b;
}
function quietEnd(t){
  const b = quietRange()[1]; if (b == null) return t;
  const d = new Date(t); d.setHours(Math.floor(b / 60), b % 60, 0, 0); let e = d.getTime(); if (e <= t) e += DAY; return e;
}
// her cap: her own number (setHer, a ceiling over every knob), or his knob; each end of initiative.per_day too
function cap(){
  const r = loadReach(); if (r.on === false) return 0;
  const c = Number(knob('initiative.default_cap', 2)), pd = knob('initiative.per_day', null);
  const hi = Array.isArray(pd) && Number.isFinite(Number(pd[1])) ? Number(pd[1]) : Infinity;
  return Math.max(0, Math.min(Number.isFinite(c) ? c : 2, hi));
}
const chatMsgs = () => (store.msgs || []).filter(m => !m.is_system);
const lastMsg = () => { const a = chatMsgs(); return a[a.length - 1] || null; };
const tOf = m => { const d = m && msgDate(m); return d ? d.getTime() : 0; };
// → '' when he may write first now, else the reason. o.force: a kept promise or a late reply (not his own first
// move): over the cap and with 主动 off it may still come, never in quiet hours and never while 暂停 is on.
function limits(t, o = {}){
  if (paused()) return 'paused';
  if (inQuiet(t)) return 'quiet';
  if (o.force) return '';
  if (loadReach().on === false) return 'off';
  if (st.backoff.until > t) return 'backoff';
  if (today(t).sent >= cap()) return 'cap';
  if (st.lastSent && t - st.lastSent < Number(knob('initiative.min_gap_min', 120)) * MIN) return 'gap';
  const last = lastMsg();
  if (knob('initiative.never_chase_twice', true) !== false && last && !last.is_user && last.extra && last.extra.modu_reach) return 'chase';
  if (last && last.is_user && last.extra && last.extra.modu_asleep && !last.extra.modu_read) return 'waiting';   // his reply to it is booked for his wake
  const ps = personaState(); if (ps.presence === 'asleep') return 'asleep';
  return '';
}

// --- writing to her ---------------------------------------------------------------------------------------------
// The words of every message of his first are side-call prompts, app/prompts/reach*.txt (read with
// prompt(name, vars)); the same words stay here as each file's fallback (prompts.fallback), so a missing file changes nothing.
const TOLD = {
  // his first message, because of something in his own day
  reach: 'Nobody asked you anything: you are writing to {{user}} first, because of something in your own day{{why}}. It is {{now}}, {{part}}{{status}}. Write one short message, the way you would really text her now, from where you are. Never a check-in, never about the silence itself, never a reproach.',
  // what the chat already holds stays held: he never asks for what he heard, never greets her as if she came in
  'reach-keep': 'The chat above is what you two really said; its last lines:\n{{last_lines}}\nNever ask her for something she already told you there, never ask again what you already asked, and never greet her as if she just arrived (no 来啦 / 回来啦 / 你来了): she has not written. Say only what fits the hour. Do not describe anything of your day that has not happened yet.',
  'reach-threads': 'Still open from her side (you may ask how one of them is going or went, if it fits; at most one, never as a list): {{threads}}',
  // the one message of a time away: written as of a moment inside it, dated then
  'reach-away': 'Nobody asked you anything: you are writing to {{user}} first, at a moment while she was away. It is {{now}}, {{part}}{{status}}. She has not written since {{since}}; if she told you what she would be doing, you know where she is, else you do not know why. Write the one short message you would have sent her then, because of something in your own day or something she told you she would be doing: never about the silence itself, never "where are you", never a reproach, never a greeting, and nothing that happens after that moment.',
  // she told him where she would be: the one message picks up her thread, not only his own day
  'reach-away-plans': 'Before she went quiet she told you: {{plans}}. Your message picks that up, as of this moment: how it is going, whether she got there, something about it you thought of. In your own words, with a little of your own day if it fits; never ask what she already told you.',
  'reach-away-mood': 'Since she went quiet you have been feeling {{mood}}; let it show a little in how you write, never as a reproach and never named outright.',
  'reach-promise': 'Earlier you told her: "{{text}}". Now is the time you meant. Keep that promise in one short message, naturally, as a text to her.',
  // her messages that came while he slept, answered on waking (or, by replies.asleep, they woke him)
  'reach-wake': 'She wrote to you while you were asleep; you have just woken up and are reading it now. Answer her briefly and naturally, as you would on waking; you may say you were asleep, without apologising for it.',
  'reach-woken': 'Her message woke you just now; you were asleep. Answer her briefly and naturally, still a little sleepy, the way you would from bed. Do not pretend you were up.',
  // her held message answered only now, because the page was shut when he woke: dated now, and honest about it
  'reach-late': 'She wrote to you on {{sent}} while you were asleep, and you are only answering it now ({{now}}, {{later}} later). Answer her now, briefly and naturally, from where you are in your own day; do not pretend it just arrived, and if it fits say in a few words why it took you so long, without a long apology.',
  'reach-reply': 'Earlier you read her last message and did not answer then, because of your own day. Now answer it, briefly and naturally; you may say in passing what kept you, without over-apologising.',
  'reach-pay': 'You would like to offer to pay for something she was just looking at ({{title}}): {{words}}. Write one short line offering it, in your own voice, as a small surprise, never a bill and never a favour she owes. Offer, never press. Do not mention apps or buttons.',
  'reach-invite': 'You would like to ask her to do one thing with you on the phone ({{title}}): {{words}}. Write one short line asking, in your own voice, tied to something specific from today (what you are doing, or something she said). Offer, never press: "要不要", never "快来". Do not mention apps or buttons.',
  // the decider's {{trigger}}, one line per trigger; he cannot know she opened the phone (that word made him greet
  // her with 来啦): only time and his own day
  'reach-triggers': ['slot: your own day moved on', 'gap: a quiet stretch went by', 'idle: the chat went quiet a while ago; your day goes on', 'open: a few hours went by since you last talked', 'next: earlier you said you would write again about now', 'due: something you planned is due',
    'away: she has not been around for a while; this is a moment inside that time, and one short message from your own day would be natural now', 'after: she was just looking at something on her phone'].join('\n'),
};
for (const [k, v] of Object.entries(TOLD)) core.prompts.fallback(k, v);
const atWords = t => ({ now: clockWords(t), part: partOfDay(t), status: statusAt(t) ? `; you are ${statusAt(t)}` : '' });
const keepRule = () => prompt('reach-keep', { last_lines: lastLines() || '(nothing yet)' });
const threadsLine = async (t, o) => { const th = herThreads(t, o); return th.length ? prompt('reach-threads', { threads: th.join(' / ') }) : ''; };
const joined = async parts => (await Promise.all(parts)).filter(Boolean).join('\n');
// what she said she would do in her last two days before she went quiet (her trip to 成都, her exam), her own words;
// not what she asked of him (明天早上八点叫我: his promise kept that)
const herPlans = since => chatMsgs().filter(m => m.is_user && tOf(m) <= since && since - tOf(m) < 2 * DAY && PLAN.test(String(m.mes || '')) && !asksAt(String(m.mes || ''))).slice(-2).map(m => String(m.mes).replace(/\s+/g, ' ').slice(0, 80));
const reachTold = (why, t) => joined([prompt('reach', Object.assign({ user: herName(), why: why ? ` (${why})` : '' }, atWords(t))), keepRule(), threadsLine(t)]);
// what is still open from her side (her trip, her exam) is in it, and his card's away mood (params away)
// as of that moment colours it
const awayTold = (at, since, o = {}) => joined([prompt('reach-away', Object.assign({ user: herName(), since: clockWords(since) }, atWords(at))),
  (o.plans || []).length ? prompt('reach-away-plans', { plans: o.plans.map(p => `"${p}"`).join(' / ') }) : '',
  o.mood ? prompt('reach-away-mood', { mood: o.mood }) : '', keepRule(), threadsLine(at, { memoryOnly: (o.plans || []).length > 0 })]);
const promiseTold = text => prompt('reach-promise', { text });
const wakeTold = woken => prompt(woken ? 'reach-woken' : 'reach-wake', {});
const lateTold = (sent, t) => prompt('reach-late', { sent: clockWords(sent), now: clockWords(t), later: (t - sent) < 2 * DAY ? `${Math.round((t - sent) / HOUR)} hours` : `${Math.round((t - sent) / DAY)} days` });
const replyTold = () => prompt('reach-reply', {});
const payTold = (words, title) => prompt('reach-pay', { words, title });
const inviteTold = (words, title) => prompt('reach-invite', { words, title });
// one message of his into the chat, through the counted door (sideCall, his own chat model). The time is the job's
// true time (o.at), never before a message already in the chat. → the message, or null (nothing to say).
async function say(told, o = {}){
  const settings = core.currentSettings(), t = now().getTime();
  // his day as seen at the message's own moment (a catch-up dated inside a time away, a job run late): the
  // context blocks read ctx.opts.at, so no slot that had not begun then is in the prompt
  const built = buildContext({ userName: core.userName(), settings, at: Math.min(Number(o.at) || t, t) });
  let raw;
  // his reply to a message of hers (reply-later: on waking, or one he let sit) is counted as a chat turn (用量: 聊天)
  try { raw = await sideCall(o.call || o.kind || 'reach', built.messages.concat([{ role: 'system', content: told }]), { chat: true, turn: o.kind === 'reply-later', max: 400, settings }); }
  catch(e){ if (e && e.code === 'paused') throw e; st.backoff = { n: st.backoff.n + 1, until: t + Math.min(6 * HOUR, 30 * MIN * Math.pow(2, st.backoff.n)) }; skip('failed', o.kind, t); await save(); throw e; }
  st.backoff = { until: 0, n: 0 };
  const r = parseReply(raw), text = tidyCJK(r.text || '');
  if (!text || r.noReply){ skip('empty', o.kind, t); return null; }
  let due = Number(o.at) || t; if (due < t && inQuiet(due) && !o.asked) due = Math.min(quietEnd(due), t);   // a catch-up is never dated inside her quiet hours (but what she asked for is)
  if (o.since != null && tOf(lastMsg()) !== o.since){ skip('answered', o.kind, t); return null; }   // she wrote while he was deciding: the moment has gone
  const at = Math.max(due, tOf(lastMsg()) + 1);
  const m = { name: store.name, is_user: false, is_name: true, send_date: at, mes: text,
    extra: { modu_emotion: r.emotion, modu_emotion_from: r.labelled ? 'model' : 'none', modu_reach: Object.assign({ kind: o.kind || 'reach' }, o.why ? { why: String(o.why).slice(0, 80) } : {}, o.job ? { job: o.job } : {}) } };
  // the body glance: one cue on the body seam just before a message of his goes, so a face or a device
  // may look at the phone first. A catch-up after time away (a message dated well before now) does not glance.
  if (t - at < 2 * ticker.BEAT) core.publish({ type: 'glance', from: 'phone', kind: o.kind || 'reach', at: t });
  await appendToChat(m, { announce: true });
  core.updatePresence();   // the labels move at once (he wrote, so he is up), not on the next beat
  if (o.count !== false){ today(t).sent++; st.lastSent = t; if (dayOf(at) !== dayOf(t)) today(at).sent++; }   // a message dated in a day away counts on that day too
  await bookTags({ promises: [], nextContact: r.nextContact }, at);   // his own 主动 books [next] only: no promise chain past her cap
  if (loadReach().notices) bell.ring({ title: store.name, line: text.replace(/\s+/g, ' ').slice(0, 60), app: 'chat', job: o.job || '', tag: 'modu-reach' }).catch(() => {});
  emit('reach', { op: 'sent', kind: o.kind || 'reach', at });
  return clone(m);
}

// --- the reply tags ---------------------------------------------------------------------------------------------
const CN = { 零: 0, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const num = s => { if (/^\d+(\.\d+)?$/.test(s)) return Number(s); if (s === '十') return 10; const m = /^([一二两三四五六七八九])?十([一二三四五六七八九])?$/.exec(s); if (m) return (m[1] ? CN[m[1]] : 1) * 10 + (m[2] ? CN[m[2]] : 0); return CN[s] != null ? CN[s] : null; };
// when a promise means, from its own words ("两小时后告诉你", "晚上给你打电话", "in 20 minutes"); else in an hour.
// a promise tied to his own day ("出门前说一声", "到了告诉你", "忙完找你") is due when that slot of his day
// begins or ends (slots: today's day record, app/life.js), not an hour after it was made
// a clock time in it ("晚上九点", "21:00", "九点半", "9pm") is the time, the next one after t (晚上/下午 make it
// the evening's; 明天 the next day's); a promise with no time of its own ("我会到") takes the clock time she named in her
// message just before (hers), so a promise for the 21:00 she named is due at 21:00, not in an hour
function promiseAt(text, t, slots, hers){
  const s = String(text || ''); let m;
  if ((m = /([\d.]+|[一二两三四五六七八九十]+)\s*(分钟|分|小时|个小时|钟头|minutes?|mins?|hours?|h)(?![点:：])/i.exec(s)) && !/[点:：]/.test(s.slice(Math.max(0, m.index - 1), m.index))){ const n = num(m[1]); if (n != null) return t + Math.round(n * (/分|min/i.test(m[2]) ? MIN : HOUR)); }
  const own = clockAt(s, t);
  // a time of his with no day or part of day of its own ("七点五十准时") is read next to the time she asked
  // for ("明天早上八点叫我"): the same clock time nearest hers (within 3 hours), so it is tomorrow morning, not tonight
  if (own != null && hers && !DAYPART.test(s)){
    const named = clockAt(hers, t); let best = own;
    if (named != null) for (let k = -2; k <= 2; k++){ const c = own + k * 12 * HOUR; if (c > t && Math.abs(c - named) < Math.abs(best - named)) best = c; }
    if (named != null && Math.abs(best - named) <= 3 * HOUR) return best;
  }
  if (own != null) return own;
  if (/半小时|half an hour/i.test(s)) return t + 30 * MIN;
  const ahead = (slots || []).filter(x => x && x.at > t).sort((a, b) => a.at - b.at), cur = (slots || []).filter(x => x && x.at <= t && (!x.until || t < x.until)).pop();
  const moves = ahead.filter(x => !cur || x.where !== cur.where);
  if (/出门|出发|走之前|走前|动身|上班前|去.{0,8}之?前|before (i|you)? ?(go|leave|head)/i.test(s) && moves.length) return Math.max(t + 5 * MIN, moves[0].at - 10 * MIN);
  if (/到了|到家|到地方|到那|when i (get|arrive)|once i'?m there/i.test(s) && moves.length) return Math.max(t + 5 * MIN, moves[0].at + 15 * MIN);
  if (/忙完|下班|收工|结束|弄完|干完|after work|when i'?m done|finish/i.test(s) && cur){ const end = cur.until || (ahead[0] && ahead[0].at); if (end && end > t) return end + 5 * MIN; }
  if (/一会|待会|等下|等会|马上|soon|in a bit/i.test(s)) return t + 20 * MIN;
  const at = (h, plus) => { const d = new Date(t + (plus || 0)); d.setHours(h, 0, 0, 0); return d.getTime(); };
  if (/明天|明早|tomorrow/i.test(s)) return at(/晚|evening|night/i.test(s) ? 20 : /下午|afternoon/.test(s) ? 15 : 9, DAY);
  if (/晚上|今晚|tonight|evening/i.test(s)){ const e = at(20); return e > t ? e : t + HOUR; }
  if (/下午|afternoon/i.test(s)){ const e = at(15); return e > t ? e : t + HOUR; }
  const named = hers ? clockAt(hers, t) : null; if (named != null && named - t <= DAY) return named;
  return t + HOUR;
}
const DAYPART = /明天|明早|明晚|今天|今晚|今早|早上|早晨|上午|中午|下午|傍晚|晚上|凌晨|半夜|夜里|tomorrow|tonight|today|morning|afternoon|evening|\b(am|pm)\b/i;
// her message asks him to do something for her at a time (叫我 / 提醒我 / 来接我 at 八点): a promise he makes
// in answer is hers too, so it comes at its time even inside her quiet hours (her own request beats them), and when his
// reply has no [promise] tag but agrees to it, the promise is booked all the same (a model that forgets the tag)
const ASKS = /叫我|喊我|叫醒|提醒我|打给我|给我打|打电话给我|来接我|接我|陪我|找我|call me|wake me|remind me|text me|pick me up/i;
// a request for something ahead: never one about the past (昨天八点你都没来接我) or a question back (你找我干嘛)
const asksAt = hers => !!hers && ASKS.test(hers) && !/昨天|前天|上次|刚才|刚刚|都没|没来|没叫|干嘛|为什么/.test(hers) && clockAt(hers, 0) != null;
const REFUSE = /不行|不要|不能|没法|做不到|办不到|不了|算了|恐怕|不好意思|对不起|抱歉|可能|来不及|出门了|sorry|can'?t|cannot|won'?t|not able/i;
// a whole yes: a line that is one (好呀 / 行 / 嗯嗯 / ok), or says 准时 / 一定 / 放心 / 没问题; never 好累, 还行, 不好意思
const AGREE = /^(好+[呀啊的吧嘞哒呢~～！!。]*|好的|行+[吧啊]?|可以[呀啊的]?|嗯+[嗯呢]*|ok(ay)?|sure|will do)$|准时|一定|放心|没问题|包在我身上|记住了|收到/i;
const NEAR = 60 * MIN;   // a time of his counts as hers within an hour of it (七点五十 for 八点)
// → [promise text] for his reply (no tag of his own) that really agrees to her request for a time ahead, else []: his line with a
// time when that time is within an hour of hers ("七点五十准时"), else her own request (its time)
function implied(mes, hers, t){
  if (!asksAt(hers)) return [];
  const lines = String(mes || '').split(/\n+/).map(x => x.trim()).filter(Boolean), named = clockAt(hers, t);
  if (!lines.length || named == null || lines.some(l => REFUSE.test(l))) return [];
  const timed = lines.find(l => clockAt(l, t) != null && Math.abs(promiseAt(l, t, null, hers) - named) <= NEAR);
  if (!timed && !lines.some(l => AGREE.test(l.replace(/[\s，,]+$/, '')))) return [];
  return [(timed || String(hers)).slice(0, 200)];
}
// → ms of the clock time the words name, the next one after t, or null. "一点" alone is "a little", never one o'clock.
const FOR_HIM = /你|来接|接我|找我|叫我|陪我|给我|提醒我|等我|call me|text me|pick me|wake me|remind me|\byou\b/i;
// the minutes may be words or bare digits ("七点五十", "八点零五", "7点50"), not only with 分
const CLOCK = /(\d{1,2})\s*[:：]\s*(\d{2})|(\d{1,2}|十[一二]?|[一二两三四五六七八九十])\s*点\s*(半|一刻|三刻|(\d{1,2})\s*分|(\d{2})(?![\d天个号日周])|([二三四五]?十[一二三四五六七八九]?|零[一二三四五六七八九])(?![个天号日周人位块次])\s*分?)?|\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi;
function clockAt(text, t){
  const s = String(text || '');
  for (const m of s.matchAll(CLOCK)){
    let h, mi = 0, ap = '';
    if (m[1] != null){ h = Number(m[1]); mi = Number(m[2]); }
    else if (m[3] != null){
      if (m[3] === '一' && !m[4] && !/(凌晨|早上|上午|中午|下午|晚上|夜里|半夜)$/.test(s.slice(Math.max(0, m.index - 3), m.index)) && !/^一点钟/.test(s.slice(m.index))) continue;
      h = /\d/.test(m[3]) ? Number(m[3]) : num(m[3]); mi = m[4] === '半' ? 30 : m[4] === '一刻' ? 15 : m[4] === '三刻' ? 45 : m[5] != null ? Number(m[5]) : m[6] != null ? Number(m[6]) : m[7] != null ? (m[7][0] === '零' ? CN[m[7][1]] : num(m[7])) : 0;
    } else { h = Number(m[8]) % 12; mi = Number(m[9]) || 0; ap = m[10].toLowerCase(); if (ap === 'pm') h += 12; }
    if (h == null || !(h >= 0 && h <= 24) || !(mi >= 0 && mi < 60)) continue;
    // the part of the day is the word just before this time ("明天早上八点…，晚上再聊" is 08:00); the whole
    // sentence only when nothing stands next to it and it names one part of the day only
    const near = s.slice(Math.max(0, m.index - 4), m.index), PM = /晚上|今晚|明晚|夜里|半夜|下午|傍晚|tonight|evening|afternoon/i, AM = /凌晨|早上|早晨|上午|明早|一早|morning/i, NOON = /中午/;
    const pick = re => re.test(near) || (!PM.test(near) && !AM.test(near) && !NOON.test(near) && [PM, AM, NOON].filter(x => x.test(s)).length === 1 && re.test(s));
    const pm = pick(PM), noon = pick(NOON), am = pick(AM), w = PM.test(near) || AM.test(near) || NOON.test(near) ? near : s;
    if (!ap && pm && h === 12 && /晚上|夜里|半夜|今晚/.test(w)) h = 24;
    else if (!ap && ((pm && h < 12 && !(h <= 3 && /半夜|夜里/.test(w))) || (noon && h < 6))) h += 12;
    const d = new Date(t); d.setHours(0, 0, 0, 0);
    const dayWord = /明天|明早|明晚|tomorrow/i, today = /今天|今晚|今早|tonight|today/i, before = s.slice(Math.max(0, m.index - 8), m.index);
    let c = d.getTime() + (dayWord.test(before) || (!today.test(before) && dayWord.test(s) && !today.test(s)) ? DAY : 0) + h * HOUR + mi * MIN;
    // "九点" said in the evening: tonight's; "八点叫我" said at 23:00 is tomorrow 08:00 (the next of 8 and 20 o'clock)
    if (c <= t && !ap && !pm && !am && !noon && h < 12) while (c <= t) c += 12 * HOUR;
    while (c <= t) c += DAY;
    return c;
  }
  return null;
}
async function bookTags(r, t, hers){
  let slots = null;
  if ((r.promises || []).length && core.day){ try { const d = await core.day.get(dayOf(t)); slots = d ? d.slots : null; } catch { slots = null; } }
  for (const p of (r.promises || []).slice(0, 3)){
    // each kept promise is one paid call, so at most initiative.promises_per_day (6) are booked a day; the rest are not
    if (st && today(t).promises >= Number(knob('initiative.promises_per_day', 6))){ skip('promise-cap', 'promise', t, p); continue; }
    if (st) today(t).promises++;
    const at = promiseAt(p, t, slots, hers);
    // payload.due: the true time it was meant for; a job moved later (quiet hours, a retry) is still dated then
    // payload.asked: made at her request for that time (within an hour of the time she named), so her quiet
    // hours do not hold it; any other promise of the same turn still waits for them
    const named = asksAt(hers) ? clockAt(hers, t) : null, asked = named != null && Math.abs(at - named) <= NEAR;
    await jobs.add({ owner: 'core', kind: 'promise', at, expire: at + DAY, force: true, payload: Object.assign({ text: String(p).slice(0, 200), made: t, due: at }, asked ? { asked: true } : {}) });
  }
  if (r.nextContact != null && Number.isFinite(Number(r.nextContact))){
    const at = t + Math.min(24 * 60, Math.max(5, Number(r.nextContact))) * MIN;
    await jobs.add({ owner: 'core', kind: 'next', at, expire: at + 3 * HOUR, payload: { min: Number(r.nextContact), made: t } });
  }
}
// her message, read and not answered (the [no-reply] tag, or the decider's "read"): a read mark on it, and a reply later
async function readLater(t, why){
  const msgs = chatMsgs(), hers = msgs[msgs.length - 1];
  if (!hers || !hers.is_user) return null;
  hers.extra = Object.assign({}, hers.extra, { modu_read: t }); await writeChat();
  emit('reach', { op: 'read', at: t, msg: tOf(hers) });
  today(t).reads++;
  const [lo, hi] = [].concat(knob('replies.busy_delay_min', [10, 60])).map(Number);
  let at = t + Math.round(((lo || 10) + R() * Math.max(0, (hi || 60) - (lo || 10))) * MIN);
  if (personaState().presence === 'asleep' && core.day){ /* his wake comes with his day: the job waits for it */ at = Math.max(at, t + 6 * HOUR); }
  return jobs.add({ id: 'reply-' + tOf(hers), owner: 'core', kind: 'reply-later', at, payload: { msg: tOf(hers), why: why || 'no-reply' } });   // never expires (her message is always answered)
}
// the options her chat turn passes to send: [next] always while 主动 may happen; [no-reply] only in a busy slot
// of his, and at most replies.read_no_reply.max_per_day a day; [promise] always (a promise is kept with 主动 off too)
// later: true while he is asleep (send asks nothing of the model; the reply is booked for his wake, below), unless
// replies.asleep is 'reply' (a card whose companion answers at night). 暂停 stops his life, so then he answers as usual.
function sendOptions(){
  if (!store.name || paused()) return { next: false, noReply: false, promise: false };
  const t = now().getTime(), on = loadReach().on !== false, ps = personaState();
  const max = Number(knob('replies.read_no_reply.max_per_day', 1));
  // until she has had one reply from him, he answers, asleep or busy or not (a first message that
  // waits till morning is no welcome); after that first exchange the asleep hold and [no-reply] apply as usual
  if (!answeredOnce()) return { next: on, noReply: false, later: false, promise: true };
  const later = ps.presence === 'asleep' && String(knob('replies.asleep', 'defer_to_wake')) !== 'reply';
  return { next: on, noReply: !later && on && !!(ps.busy || ps.presence === 'busy') && (!st || today(t).reads < max), later, promise: true };
}
// whether a message of his has ever followed one of hers in this chat (his greeting alone is not a reply)
function answeredOnce(){
  let her = false;
  for (const m of store.msgs){ if (!m) continue; if (m.is_user) her = true; else if (her && !m.is_system) return true; }
  return false;
}
// her message while he slept (send's 'deferred' event): one reply-later job for all of them, at his wake (wakeAt: his own
// day, else the quiet hours) and 5–20 minutes to pick up the phone; replies.asleep a number N: she wakes him, about N
// minutes (never after his wake). The job keeps to her quiet hours and 暂停 like every job of his (run, below).
async function bookWake(t){
  const msgs = chatMsgs(); let i = msgs.length;
  while (i > 0 && msgs[i - 1].is_user) i--;
  const first = msgs[i]; if (!first) return null;
  const k = knob('replies.asleep', 'defer_to_wake'), woke = core.wakeAt ? core.wakeAt(t) : null;
  let at = (woke || t + 6 * HOUR) + Math.round((5 + R() * 15) * MIN), woken = false;
  if (typeof k === 'number' && isFinite(k) && k >= 0){ const n = t + Math.round(k * (0.7 + R() * 0.6) * MIN); if (n < at){ at = n; woken = true; } }
  // no expiry at all: a held message is always answered, at his wake or, the page shut then, when she next opens it
  return jobs.add({ id: 'reply-' + tOf(first), owner: 'core', kind: 'reply-later', at, payload: { msg: tOf(first), why: woken ? 'woken' : 'asleep' } });
}
// her messages at the end of the chat that wait for his reply (held while he slept, or read and let sit) have a
// live job (pending, no expiry: one booked by an older version may carry one); when none has, one is booked now, at his wake
// (now if he is up). Looked at once per message and page load; run() never answers twice (a reply of his after it ends it).
// one he answered with silence (an empty or [no-reply] answer, modu_quiet) is finished, never booked again
const held = m => !!(m && m.is_user && m.extra && (m.extra.modu_asleep || m.extra.modu_read) && !m.extra.modu_quiet);
// a kept promise of his is not an answer to her: her messages before it still wait for his reply
const answers = m => !m.is_user && !(m.extra && m.extra.modu_reach && m.extra.modu_reach.kind === 'promise');
function waitingHers(){ const msgs = chatMsgs(), out = []; for (let i = msgs.length - 1; i >= 0 && !answers(msgs[i]); i--) if (msgs[i].is_user) out.unshift(msgs[i]); return out; }
const looked = new Set();
async function keepHeld(t){
  const all = waitingHers(), hers = all.filter(held); if (!hers.length) return null;
  const key = tOf(hers[hers.length - 1]); if (looked.has(key) || t - key < 2 * ticker.BEAT) return null;   // just sent: its own job is being booked
  looked.add(key);
  const times = new Set(all.map(tOf));
  let live = []; try { live = (await jobs.list({ owner: 'core', kind: 'reply-later', state: 'pending' })).filter(j => j.payload && times.has(j.payload.msg) && j.expire == null); } catch {}
  if (live.length) return null;
  const first = hers[0], asleep = !!(first.extra && first.extra.modu_asleep && !first.extra.modu_read);
  const woke = personaState().presence === 'asleep' && core.wakeAt ? core.wakeAt(t) : null, at = woke ? woke + Math.round((5 + R() * 15) * MIN) : t;
  skip('rebooked', 'reply-later', t);
  return jobs.add({ id: 'reply-' + tOf(first) + '-' + t.toString(36), owner: 'core', kind: 'reply-later', at, payload: { msg: tOf(first), why: asleep ? 'asleep' : 'no-reply' } });
}

// --- the decider (app/prompts/decider.txt) ------------------------------------------------------------------------
function gapFeeling(ms){
  if (ms == null) return 'you have not talked yet';
  const h = ms / HOUR;
  return h < 1 ? 'a little while; it still feels like now' : h < 6 ? 'a few hours; your day went on' : h < 24 ? 'since earlier today or yesterday; she crosses your mind now and then'
    : h < 72 ? 'a couple of days; you have thought of her' : 'a long time; whatever kept her, you would not reproach her';
}
// what just happened, in words (app/prompts/reach-triggers.txt: "<trigger>: <words>" a line)
async function triggerWords(trigger){
  for (const l of (await prompt('reach-triggers', {})).split('\n')){ const i = l.indexOf(':'); if (i > 0 && l.slice(0, i).trim() === trigger) return l.slice(i + 1).trim(); }
  return String(trigger);
}
let deciderHook = null;
// → { do: 'leave' | 'read' | 'message' | 'invite', in_min, kind, why }. t: the moment it is about (a moment inside a time away
// for the catch-up); o.count: the day whose decider count it takes (now)
async function decide(trigger, t, kinds, o = {}){
  today(o.count || t).decided++;
  const ps = personaState(), p = pronouns(), last = lastLines(8);
  const lm = lastMsg(), st0 = o.count && o.count !== t ? statusAt(t) : '';
  const vars = { char: store.name, user: herName(), pronoun: p.zh || '他', pronoun_en: p.en || 'he/him', now: `${clockWords(t)} (${partOfDay(t)})`,
    status: o.count && o.count !== t ? (st0 ? `${store.name} is ${st0}` : 'your own day went on') : (ps.words || ''), gap: gapFeeling(lm ? t - tOf(lm) : null), trigger: await triggerWords(trigger), last_lines: last || '(nothing yet)',
    threads: herThreads(t).join('\n') || '(none)',
    today_count: String(today(t).sent), cap: String(cap()), invite_kinds: kinds.length ? kinds.join(', ') : 'none', lang: core.chatLanguage ? core.chatLanguage() : '' };
  let raw = '';
  if (deciderHook) raw = await deciderHook(vars);
  else { const text = await prompt('decider', vars); if (!text) return { do: 'leave', in_min: 0, kind: '', why: 'no prompt' }; raw = await sideCall('decider', [{ role: 'system', content: text }], { max: 120 }); }
  let j = null; try { j = JSON.parse((/\{[\s\S]*\}/.exec(String(raw || '')) || ['null'])[0]); } catch { j = null; }
  const what = j && ['leave', 'read', 'message', 'invite'].includes(j.do) ? j.do : 'leave';
  return { do: what, in_min: Math.max(0, Math.min(180, Math.round(Number(j && j.in_min) || 0))), kind: String((j && j.kind) || ''), why: String((j && j.why) || '').slice(0, 80) };
}

// --- invites (no closeness gate) ---------------------------------------------------------
let inviteSource = () => [];
// the page says which invites the apps offer: fn() → [{ kind, app, words, title, hours?: [from, to] (his hours it fits),
//   after?: [app ids] (only within `within_min` (120) minutes after she was in one of them), rare?: true }]. The core names no app.
function invites(fn){ inviteSource = typeof fn === 'function' ? fn : () => []; }
const offered = () => { try { return (inviteSource() || []).filter(x => x && x.kind && x.app); } catch { return []; } };
// pure: which kinds may be offered now. s: the state record; c: { t, offers, free, herLastAt, lastIn: { app: ms }, stateOk, rand }
function inviteRule(s, c){
  const t = c.t, d = dayOf(t), rand = c.rand || Math.random, out = [];
  if (!c.herLastAt || t - c.herLastAt > 3 * DAY) return out;
  const list = s.invites || [];
  if (list.some(i => i.state === 'open')) return out;
  if (s.declinedDay === d) return out;
  if (list.filter(i => dayOf(i.at) === d).length >= Number(knob('invite.per_day', 1))) return out;
  if (list.filter(i => t - i.at < 7 * DAY).length >= Number(knob('invite.per_week', 3))) return out;
  const h = new Date(t).getHours();
  const seen = new Set();
  for (const o of c.offers || []){
    const k = o.kind; if (!k || seen.has(k)) continue;
    if (!c.free && o.gate !== false) continue;                                  // his slot must be free, except for an offer with no gate (代付)
    if (c.stateOk === false && o.gate !== false) continue;                       // a card's own state may gate invites, never one with gate: false (代付)
    let p = 1;
    if (Array.isArray(o.hours) && o.hours.length === 2 && !(h >= Number(o.hours[0]) && h < Number(o.hours[1]))) continue;   // only in his hours that fit it (an evening thing)
    if (Array.isArray(o.after) && o.after.length){                              // only right after she was in one of those apps (代付)
      const at = Math.max(0, ...o.after.map(a => Number((c.lastIn || {})[a]) || 0));
      if (!at || t - at > Number(o.within_min || 120) * MIN) continue;
    }
    if (o.rare){                                                                // rare: at most once a week, with a small chance
      if (list.filter(i => i.kind === k && t - i.at < 7 * DAY).length >= Number(knob('invite.rare_per_week', 1))) continue;
      p = Number(knob('invite.rare_chance', 0.2));
    }
    seen.add(k);
    const ig = (s.ignored || {})[k]; if (ig && ig.n >= 2 && ig.until > t) p *= 0.5;   // two ignored in a row: half, for a week
    if (rand() < p) out.push(k);
  }
  return out;
}
async function inviteContext(t){
  const ps = personaState();
  const her = [...chatMsgs()].reverse().find(m => m.is_user);
  const lastIn = {}; try { for (const e of await core.eventList({ days: 1 })) if (e.who === 'her' && e.app && (e.at || 0) > (lastIn[e.app] || 0)) lastIn[e.app] = e.at; } catch {}
  let stateOk = true; const key = knob('invite.state_key', null);
  if (key && core.state){ try { const v = await core.state.get(String(key)); stateOk = !!v && v.value >= Number(knob('invite.state_min', 0)); } catch { stateOk = false; } }
  return { t, offers: offered(), free: ps.presence !== 'asleep' && !ps.busy && ps.presence !== 'busy', herLastAt: Math.max(tOf(her), Number(st.herSeen) || 0), lastIn, stateOk, rand: R };
}
async function invite(kind, t, why){
  const x = offered().find(o => o.kind === kind); if (!x) return null;
  const m = await say(await (x.pays ? payTold : inviteTold)(x.words, x.title || x.app), { kind: 'invite', why, at: t });
  if (!m) return null;
  const id = 'inv' + t.toString(36);
  st.invites.push(Object.assign({ id, kind, app: x.app, at: t, state: 'open' }, x.pays ? { pays: true } : {})); today(t).invites++;
  await addChatCard({ kind: 'invite', app: x.app, line: x.words, id, type: kind });
  await jobs.add({ id: 'invite-end-' + id, owner: 'core', kind: 'invite-end', at: endOfDay(t), payload: { invite: id } });
  emit('reach', { op: 'invite', invite: id, kind, at: t }); await save();
  return id;
}
// her answer on the card: 'yes' (the page opens the app) or 'no' (no new invite that day)
async function answerInvite(id, answer){
  await load(); const i = st.invites.find(x => x.id === id); if (!i || i.state !== 'open') return i ? clone(i) : null;
  const t = now().getTime();
  i.state = answer === 'yes' ? 'accepted' : 'declined'; i.ended = t;
  if (i.state === 'declined') st.declinedDay = dayOf(t);
  if (i.state === 'accepted') delete st.ignored[i.kind];
  await save(); emit('reach', { op: 'invite', invite: id, state: i.state });
  return clone(i);
}
const inviteState = id => { const i = st && st.invites.find(x => x.id === id); return i ? i.state : ''; };
const inviteOf = id => { const i = st && st.invites.find(x => x.id === id); return i ? clone(i) : null; };
// an invite she let pass may be named once, lightly, later, and only in a good mood (a block in his prompt)
function missedLine(){
  const m = st && (st.missed || []).find(x => !x.mentioned && now().getTime() - x.at < 3 * DAY);
  return m ? `You had told her: "${m.text}", and the time came while she was not around, so it did not happen. If it fits, you may mention it once, lightly; do not make a thing of it.` : '';
}
function reachLine(){ return [missedLine(), inviteLine()].filter(Boolean).join('\n'); }
function inviteLine(){
  if (!st || moodClass(personaState()) !== 'good') return '';
  const i = [...st.invites].reverse().find(x => x.state === 'ignored' && !x.mentioned && now().getTime() - x.ended < 3 * DAY);
  if (!i) return '';
  const x = offered().find(o => o.kind === i.kind);
  return `Yesterday or so you asked her (${x ? x.words : i.kind}) and she did not come. You may mention it once, lightly, at a natural moment, only if the mood is good. Never guilt, never repeat it.`;
}

// --- his mood, in three (the invite line above; a page's rule may ask it too) ---------------------------------------
function moodClass(ps){
  const w = String(ps.moodWord || '').toLowerCase(), m = String(ps.mood || '');
  if (/tired|low|sad|worried|down|累|低落|难过/.test(w) || ['sadness', 'anger'].includes(m)) return 'low';
  if (/playful|content|happy|good|joy|开心|愉快/.test(w) || ['joy', 'relief'].includes(m)) return 'good';
  return 'neutral';
}
// An app's rule is never the core's. The peek notice is
// the page's (app/scheduler.js, with its own record); the older names reach.peekRule and reach.peekDecide stay (contracts
// only grow) and forward to what the page lends with reach.lend({ peekRule, peekDecide }); until then the rule tells
// nothing and the decision never says.
const lent = {};
function lend(o){ for (const [k, f] of Object.entries(o || {})) if (typeof f === 'function') lent[k] = f; return Object.keys(lent); }
const peekRule = (e, w) => lent.peekRule ? lent.peekRule(e, w) : '';
const peekDecide = (p, c) => lent.peekDecide ? lent.peekDecide(p, c) : { say: false, p: Object.assign({ last: 0, count: 0, seen: 0 }, p || {}) };
// his record as it was last read, for a rule that must answer at once (a notice rule): a copy, or null before it is read
const current = () => st && stFor === (core.currentId || '') + '|' + (store.name || '') ? clone(st) : null;

// --- triggers and the round ---------------------------------------------------------------------------------------
// consider(trigger): her limits first (no call spent on a no), then the decider, then what it chose
async function consider(trigger, t, open){
  const why = limits(t); if (why){ skip(why, trigger, t); return null; }
  if (today(t).decided >= Number(knob('initiative.decider_per_day', 4))){ skip('decider-cap', trigger, t); return null; }
  const kinds = open || inviteRule(st, await inviteContext(t));
  let d; try { d = await decide(trigger, t, kinds); } catch(e){ if (!(e && e.code === 'paused')) { st.backoff = { n: st.backoff.n + 1, until: t + 30 * MIN }; skip('failed', 'decider', t); } return null; }
  emit('reach', { op: 'decided', trigger, decision: d, at: t });
  if (d.do === 'leave'){ skip('leave', trigger, t, d.why); return d; }
  if (d.do === 'read'){ const last = lastMsg(); if (last && last.is_user && !(last.extra && last.extra.modu_read)) await readLater(t, 'decider'); else skip('leave', trigger, t); return d; }
  if (d.do === 'invite' && !kinds.includes(d.kind)){ skip('invite-closed', d.kind, t); return d; }
  if (d.in_min > 0){ await jobs.add({ owner: 'core', kind: 'reach', at: t + d.in_min * MIN, expire: endOfDay(t), payload: { why: d.why, trigger, invite: d.do === 'invite' ? d.kind : '' } }); return d; }
  if (d.do === 'invite') await invite(d.kind, t, d.why); else await say(await reachTold(d.why, t), { kind: 'reach', why: d.why, at: t });
  return d;
}
// --- a time away ----------------------------------------------------------------------------------------
// The page is shut while she is away, so nothing of his can happen then; on the first look after a day or more away
// (initiative.catchup_after_hours, 20) there is one message for the whole time, about one moment inside it: outside her
// quiet hours, while he was up (his day, setDayPlan), within her cap for that day and the gap after his last first message.
// Exactly one message, dated then; it costs one call (≤ 3 calls on return with the day sketch and the age-out). None when a promise of his already falls due inside the time away (he wrote then) or a
// message of hers waits for his reply (that reply is his message), none after an unanswered first message of his (never
// chase twice), none once she has written.
const awayMs = () => Number(knob('initiative.catchup_after_hours', 20)) * HOUR;
function awayMoment(from, t, after){
  const step = 30 * MIN, lo = Math.max(from + 2 * HOUR, after || 0), hi = t - 30 * MIN, gapMin = Number(knob('initiative.min_gap_min', 120)) * MIN, all = [];
  for (let c = Math.ceil(lo / step) * step; c <= hi && all.length < 400; c += step){
    if (inQuiet(c)) continue;
    let s = null; try { s = dayStatus ? dayStatus(new Date(c)) : null; } catch { s = null; }
    if (s && s.presence === 'asleep') continue;
    if ((st.days[dayOf(c)] || { sent: 0 }).sent >= cap()) continue;
    if (st.lastSent && Math.abs(c - st.lastSent) < gapMin) continue;
    all.push({ c, busy: !!(s && s.busy) });
  }
  // the first day or two of the silence, when a person would really write; his free time first
  const early = all.filter(x => x.c >= Math.max(from + 12 * HOUR, after || 0) && x.c <= Math.max(from, after || 0) + 3 * DAY), pool0 = early.length ? early : all;
  const free = pool0.filter(x => !x.busy), pool = free.length ? free : pool0;
  return pool.length ? pool[Math.floor(R() * pool.length) % pool.length].c : null;
}
// → 'later' (her quiet hours now: looked at again on a later beat) or anything else (done)
async function catchUp(a, t){
  if (inQuiet(t)) return 'later';
  if (loadReach().on === false){ skip('off', 'away', t); return 'done'; }
  if (st.backoff.until > t){ skip('backoff', 'away', t); return 'done'; }
  // never chasing twice: after a first message of his she did not answer, nothing within a day of it (a day later, on a
  // new day of his, one message is not a chase; the decider still decides)
  const last = lastMsg(), chased = knob('initiative.never_chase_twice', true) !== false && last && !last.is_user && last.extra && last.extra.modu_reach;
  let kept = []; try { kept = (await jobs.list({ owner: 'core', state: 'pending' })).filter(j => j.force && j.at > a.from && j.at <= t && !(j.expire != null && j.expire < t)); } catch {}
  if (kept.length){ skip('kept', 'away', t); return 'done'; }
  // her message waits for his reply (held while he slept, or read): that reply is his message of the return
  if (waitingHers().some(held)){ skip('waiting', 'away', t); return 'done'; }
  // never chasing twice holds across the gap too: after a first message of his she did not answer,
  // no message for the time away at all
  if (chased){ skip('chase', 'away', t); return 'done'; }
  // exactly one message for the time away (设置 says so): at a moment inside it, or, when none fits (her
  // cap, his nights), now, as she comes back, if today's cap allows. No decider call: whether is settled, and one call less
  // means it is in the chat sooner after she opens the page; its tone comes from his day then, what is still open from her
  // side (her trip, her exam) and his card's away mood.
  let at = awayMoment(a.from, t, 0);
  // no fitting moment: now if he is up; else the latest moment in the gap he was up (outside her quiet hours, its
  // day's cap allowing); else a job at his next wake (her limits apply then, as for every first move of his)
  if (at == null){
    const up = c => { let s = null; try { s = dayStatus ? dayStatus(new Date(c)) : null; } catch { s = null; } return !(s && s.presence === 'asleep') && !inQuiet(c); };
    if (up(t) && today(t).sent < cap()) at = t;
    else for (let c = t - 30 * MIN; c > a.from + HOUR && at == null; c -= 30 * MIN) if (up(c) && (st.days[dayOf(c)] || { sent: 0 }).sent < cap()) at = c;
    if (at == null){
      const w = core.wakeAt ? core.wakeAt(t) : null;
      if (!w){ skip('cap', 'away', t); return 'done'; }
      await jobs.add({ id: 'away-' + a.lmT, owner: 'core', kind: 'reach', at: w + Math.round((5 + R() * 25) * MIN), expire: endOfDay(w), payload: { why: 'away', trigger: 'away', made: t } });
      skip('wake', 'away', t); return 'done';
    }
  }
  emit('reach', { op: 'decided', trigger: 'away', decision: { do: 'message', in_min: 0, kind: '', why: 'away' }, at: t, moment: at });
  try { await say(await awayTold(at, a.lmT, { mood: awayMood(at), plans: herPlans(a.lmT) }), { kind: 'reach', why: 'away', at, since: a.lmT }); } catch(e){ if (!(e && e.code === 'paused')) console.error(e); }
  return 'done';
}
// his card's away mood (params away) on the day of a moment inside her time away, while it is strong; else ''
function awayMood(at){
  try { const days = [...new Set(chatMsgs().filter(m => m.is_user).map(m => dayOf(tOf(m))))], e = core.awayEffect && core.awayEffect(knob('away', null), days, dayOf(at)); return e && e.strength >= 0.34 ? e.mood : ''; } catch { return ''; }
}

// the round on each beat, before the job round (clock.before): is there a real trigger? (his status moved, a silence
// crossed a mark, she came back; a time away is looked at once, first)
let checking = null, opened = false, away = null, afterSeen = 0, openSince = 0, lastLook = 0;
async function check(t){
  if (checking || !store.name) return;
  checking = (async () => {
    await load(true);
    if (paused()) return;
    await keepHeld(t);
    const lm = lastMsg(), gap = lm ? t - tOf(lm) : null;
    const ps = personaState(), status = [ps.presence, ps.where, ps.what].join('|');
    // how long this page has been open without a break (a beat missed by more than 10 minutes, a jump of the clock
    // or a shut lid, starts it again)
    if (!lastLook || t - lastLook > 10 * MIN || t < lastLook) openSince = t; lastLook = t;
    // the first look after a load: how long was the page shut? (lookedAt: the last beat of a page of hers; st.at is any write)
    // never before he moved in: an imported chat's old silence is not time away here
    if (away === null){ const from = Math.max(tOf(lm), Number(st.lookedAt) || 0, Number(store.importedAt) || 0); away = lm && t - from >= awayMs() ? { from, lmT: tOf(lm) } : false; }
    if (away){
      const r = tOf(lm) !== away.lmT ? (skip('answered', 'away', t), 'done') : await catchUp(away, t);
      if (r !== 'later'){ away = false; const l2 = lastMsg(); st.marks = { base: String(tOf(l2)), n: [3, 8, Number(knob('initiative.after_silence_hours', 36))].filter(h => t - tOf(l2) >= h * HOUR).length }; }
      opened = true; st.status = status; st.lookedAt = t; await save(); return;
    }
    let trigger = '', open = null;
    if (gap != null){
      const marks = [3, 8, Number(knob('initiative.after_silence_hours', 36))].map(h => h * HOUR), base = String(tOf(lm));
      const crossed = marks.filter(m => gap >= m).length;
      if (st.marks.base !== base) st.marks = { base, n: opened ? 0 : crossed };   // she wrote: the marks start again
      if (!opened && gap >= marks[0]) trigger = 'open';
      else if (crossed > st.marks.n) trigger = 'gap';
      st.marks.n = Math.max(st.marks.n, crossed);
    }
    if (!trigger && st.status && st.status !== status && gap != null && gap >= 30 * MIN) trigger = 'slot';
    // the page open and quiet: once the chat has been still for initiative.idle_min (40) minutes, all of them with the
    // page open, the decider is asked once for that silence (her limits first: cap, gap, quiet hours, asleep; it usually
    // says leave it). Not while her own message waits for his reply.
    const idle = Number(knob('initiative.idle_min', 40)) * MIN;
    if (!trigger && gap != null && idle > 0 && gap >= idle && gap < 3 * HOUR && t - openSince >= idle && !lm.is_user && st.idleBase !== String(tOf(lm))){ st.idleBase = String(tOf(lm)); trigger = 'idle'; }
    // invites reachable again: she was just in an app an offer comes after (购物, 外卖: 代付): the decider is asked
    // once, only when the offer is really open now (its own chance taken first, so no call is spent on a closed one)
    if (!trigger && afterSeen > (Number(st.afterSeen) || 0)){
      st.afterSeen = afterSeen;
      const ctx = await inviteContext(t), kinds = inviteRule(st, ctx);
      if (kinds.some(k => (ctx.offers.find(o => o.kind === k) || {}).after)){ trigger = 'after'; open = kinds; }
    }
    st.status = status; opened = true; st.lookedAt = t;
    // a message of his already due (a kept promise, a reply, a reach job: the page was shut at its time) goes
    // first, dated when it was due; no new first move is put in before it (it would push that one's date to now)
    if (trigger){ let due = []; try { due = (await jobs.due(t)).filter(j => j.owner === 'core' && MSG_KINDS.includes(j.kind)); } catch {} if (due.length){ skip('due', trigger, t); trigger = ''; } }
    if (trigger) await consider(trigger, t, open);
    await save();
  })().catch(e => console.error(e)).finally(() => { checking = null; });
  return checking;
}

// --- his jobs (owner 'core') ------------------------------------------------------------------------------------
// the flood cap on catch-up: of his own messages (reach, next) due in one round after time away, at most N, the newest; the
// rest are dropped and logged. Kept promises and his replies to her (reply-later) are never dropped and do not count.
function flooded(job, ctx){
  if (job.force || job.kind === 'promise' || job.kind === 'reply-later' || !ctx || !ctx.batch || ctx.late < 2 * ticker.BEAT) return false;
  const n = Math.max(1, Number(knob('initiative.flood_cap', 3)));
  const msgs = ctx.batch.filter(j => j.owner === 'core' && MSG_KINDS.includes(j.kind) && !j.force && j.kind !== 'promise' && j.kind !== 'reply-later').sort((a, b) => b.at - a.at);
  return !msgs.slice(0, n).some(j => j.id === job.id);
}
async function run(job, ctx){
  await load(true);
  const t = ctx.t, p = job.payload || {};
  if (job.kind === 'invite-end'){
    const i = st.invites.find(x => x.id === p.invite);
    if (i && i.state === 'open'){
      i.state = 'ignored'; i.ended = t;
      const ig = st.ignored[i.kind] || { n: 0, until: 0 }; ig.n++; if (ig.n >= 2) ig.until = t + 7 * DAY; st.ignored[i.kind] = ig;
      emit('reach', { op: 'invite', invite: i.id, state: 'ignored' }); addBlock(); await save();
    }
    return 'done';
  }
  if (!MSG_KINDS.includes(job.kind)) return 'drop';
  if (paused()) return { at: t + 30 * MIN };
  if (flooded(job, ctx)){ skip('flood', job.kind, t); await save(); return { drop: 'flood' }; }
  // her quiet hours: after they end; a promise she asked for (叫我 at 八点) comes at its time all the same
  if (inQuiet(t) && !(job.kind === 'promise' && p.asked)) return { at: quietEnd(t) };
  if (st.backoff.until > t) return { at: st.backoff.until };                       // the model was failing: every kind waits
  // written already (a reload between the message and the job's end, or another writer): never twice
  if (chatMsgs().some(m => !m.is_user && m.extra && m.extra.modu_reach && m.extra.modu_reach.job === job.id)) return 'done';
  const her = [...chatMsgs()].reverse().find(m => m.is_user);
  let r = null;
  if (job.kind === 'promise'){
    r = await say(await promiseTold(p.text || ''), { kind: 'promise', job: job.id, at: Math.min(Number(p.due) || job.at, job.at), count: false, asked: !!p.asked });
    if (r) await closeThread(p.text, t);
  }
  else if (job.kind === 'reply-later'){
    const last = lastMsg();
    if (!last || chatMsgs().some(m => answers(m) && tOf(m) > p.msg)){ skip('answered', job.kind, t); await save(); return { drop: 'answered' }; }
    // the page open at its time, it is dated then; shut then, it comes when she opens the page, dated then (his
    // wake or her open time, whichever is later)
    const late = ctx.late > 2 * ticker.BEAT, at = late ? t : Math.min(job.at, t);
    if (p.why === 'asleep' || p.why === 'woken'){
      // he is up (or she woke him): her messages since his last one are read now, then his reply
      const held = waitingHers();
      for (const m of held){ m.extra = Object.assign({}, m.extra, { modu_read: m.extra && m.extra.modu_read || at }); delete m.extra.modu_unsent; }
      if (held.length){ await writeChat(); emit('reach', { op: 'read', at, msg: p.msg }); }
      r = await say(await (late && at - p.msg >= 3 * HOUR ? lateTold(p.msg, at) : wakeTold(p.why === 'woken')), { kind: 'reply-later', job: job.id, at, count: false });
    }
    else r = await say(await replyTold(), { kind: 'reply-later', job: job.id, at, count: false });
    // nothing to say (empty, [no-reply]): her messages are answered by silence, never booked again on a reload
    if (!r){ for (const m of waitingHers()) m.extra = Object.assign({}, m.extra, { modu_quiet: t }); await writeChat(); }
  } else {
    if (her && tOf(her) > (p.made || job.made || 0) && job.kind === 'next'){ skip('answered', job.kind, t); await save(); return { drop: 'answered' }; }
    const why = limits(t); if (why){ skip(why, job.kind, t); await save(); return { drop: why }; }
    if (job.kind === 'next'){ await consider('next', t); await save(); return 'done'; }
    if (p.invite){ const kinds = inviteRule(st, await inviteContext(t)); if (kinds.includes(p.invite)) await invite(p.invite, t, p.why); else skip('invite-closed', p.invite, t); }
    else r = await say(await reachTold(p.why, job.at), { kind: 'reach', why: p.why, job: job.id, at: job.at });
  }
  void r; await save(); return 'done';
}
// a kept promise closes the open thread it was (a memory item whose threads say the same thing), so his diary and
// his prompt stop carrying it as still to happen
async function closeThread(text, t){
  const grams = x => { const a = String(x || '').replace(/[\s，。！？、,.!?…~]/g, ''), o = new Set(); for (let i = 0; i < a.length - 1; i++) o.add(a.slice(i, i + 2)); return o; };
  const g = grams(text); if (g.size < 2 || !core.saveMemoryItem) return;
  // only a thread that is this promise of his: one thread line holding most of the promise's own
  // words (≥ 60% of its pairs), never one about her (她… / her …): a shared time word (明天早上) is not enough
  const hers = /^(她|you\b|her\b|she\b)|她(要|会|得|去|想|说)/i;
  for (const m of store.memory || []){
    if (!m || !Array.isArray(m.threads) || !m.threads.length || m.closed) continue;
    const hit = m.threads.some(th => { if (hers.test(String(th).trim())) return false; const h = grams(th); let n = 0; for (const x of g) if (h.has(x)) n++; return n / g.size >= 0.6; });
    if (hit){ m.closed = dayOf(t); try { await core.saveMemoryItem(m); } catch(e){ console.error(e); } }
  }
}
jobs.handle('core', run);
ticker.before(t => check(t));
// a dropped job of his (expired while she was away) goes into the skip log too
core.listeners.add((ev, d) => {
  if (ev === 'clock' && d && d.op === 'dropped' && st) { for (const x of d.dropped) skip(x.why, x.kind, d.at); save(); }
  if (ev === 'logged' && d && d.who === 'her' && d.app && offered().some(o => Array.isArray(o.after) && o.after.includes(d.app))) afterSeen = Math.max(afterSeen, Number(d.at) || now().getTime());
  if (ev === 'loaded'){ st = null; opened = false; away = null; load().then(() => { if (st.invites.some(i => i.state === 'ignored' && !i.mentioned) || (st.missed || []).some(x => !x.mentioned)) addBlock(); }).catch(() => {}); }
  // a kept promise that expired while she was away is not replayed (no call): it becomes one line he may name
  if (ev === 'job' && d && d.op === 'drop' && d.job && d.job.owner === 'core' && d.job.kind === 'promise' && d.job.why === 'expired')
    load().then(() => { st.missed = (st.missed || []).concat({ text: String((d.job.payload && d.job.payload.text) || '').slice(0, 200), at: now().getTime(), due: d.job.at }).slice(-5); addBlock(); return save(); }).catch(e => console.error(e));
  if (ev === 'deferred' && d) load().then(() => bookWake(tOf(d) || now().getTime())).then(save).catch(e => console.error(e));
  if (ev === 'noreply' && d && d.extra && d.extra.modu_no_reply === 'model') load().then(() => readLater(now().getTime(), 'no-reply')).then(save).catch(e => console.error(e));
  // a message of his answers every held message of hers before it: none stays 已送达 once he has written after it
  if (ev === 'message' && d && answers(d) && !d.is_system && d.mes){
    let n = 0; for (const m of chatMsgs()) if (m.is_user && m.extra && m.extra.modu_asleep && !m.extra.modu_read && tOf(m) <= tOf(d)){ m.extra = Object.assign({}, m.extra, { modu_read: tOf(d) }); n++; }
    if (n) writeChat().catch(e => console.error(e));
  }
  if (ev === 'message' && d && !d.is_user && !d.is_system && !(d.extra && d.extra.modu_reach)){
    // his ordinary reply: the tags he wrote become jobs; an invite he could mention has had its one chance
    const r = { promises: (d.extra && d.extra.modu_promises) || [], nextContact: d.extra ? d.extra.modu_next_contact : null };
    // the time she named, for a promise with none of its own: only from her message right before his reply, and only
    // when it asks something of him (来接我, 叫我, 你…)
    const ms0 = chatMsgs(), di = ms0.indexOf(d), prev = di > 0 ? ms0[di - 1] : ms0.filter(m => tOf(m) <= tOf(d) && m !== d).pop();
    const hers = prev && prev.is_user && FOR_HIM.test(String(prev.mes || '')) ? prev : null;
    // no tag, but he agreed to what she asked for at a time ("明天早上八点叫我" → "七点五十准时"): booked all the same
    if (!r.promises.length && hers) r.promises = implied(d.mes, String(hers.mes || ''), now().getTime());
    load().then(async () => { if (r.promises.length || r.nextContact != null) await bookTags(r, now().getTime(), hers ? String(hers.mes || '') : '');
      const i = inviteLine() && [...st.invites].reverse().find(x => x.state === 'ignored' && !x.mentioned); if (i){ i.mentioned = true; }
      const ms = missedLine() && (st.missed || []).find(x => !x.mentioned); if (ms) ms.mentioned = true;
      await save(); }).catch(e => console.error(e));
  }
});
// the `reach` block (a line or two, after the events) is added only once an invite went unanswered or a promise expired while
// she was away (no extra call: he may name it on his next turn): most chats never have it
function addBlock(){ try { if (!contextBlocks().some(b => b.id === 'reach')) setContextBlock('reach', { after: 'events', priority: 40, budget: 400, build: reachLine }); } catch {} }
// the peek notice is a notice rule; the core ships with none, so the page adds its own (app/scheduler.js)
void noticeRules;

const reach = {
  check: t => check(t == null ? now().getTime() : t), consider: (trigger, t) => load(true).then(() => consider(trigger, t == null ? now().getTime() : t)).then(async d => { await save(); return d; }),
  limits: t => limits(t == null ? now().getTime() : t), cap, peekRule, moodClass, lend, current,
  async seen(t){ await load(); st.herSeen = t == null ? now().getTime() : t; return save(); }, inQuiet, quietEnd, sendOptions, invites, answerInvite, inviteState, inviteOf, inviteRule, peekDecide, promiseAt, implied,
  async state(){ await load(); return clone(st); }, async log(){ await load(); return clone(st.skips); },
  set decider(fn){ deciderHook = typeof fn === 'function' ? fn : null; }, set random(fn){ rnd.fn = typeof fn === 'function' ? fn : Math.random; }, get random(){ return rnd.fn; },
  get paused(){ return paused(); }, MSG_KINDS: MSG_KINDS.slice(),
};
Object.assign(core, { reach });
})(globalThis[Symbol.for('modu.core')]);
// app/core/api.js: window.ModuCore: the public face of the core; the only thing a page or an app ever sees.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). Makes window.ModuCore, then closes the core's private namespace.
(function(core){
'use strict';
const { NEUTRAL_DEFAULTS, MODU_DEFAULTS, setDefaults, getDefaults, listeners, store, msgDate, now, setClock,
  phoneRoot, canPickFolder, EMOTIONS, splitBubbles, dropFinalStop, splitParts, photoTags, tidyCJK, parseReply,
  splitEmotion, parseMemoryFile, readMemory, addMemory, editMemory, pinMemory, deleteMemory, readPngTexts,
  normaliseCard, readCardFile, parseChat, chooseCaiChat, stageImport, buildStoreFiles, saveImport, loadStaged,
  setPronouns, loadFromDir, loadDemo, greetingFor, appendToChat, setAvatar, pronouns, loadContacts, current,
  openContact, canOpenWithoutAsking, removeContact, firstRun, firstCompanion, addBesideCard, presetSwitch, records, lifeTypes, myRecords, myStoreInfo, myStoreFiles,
  restoreMyStore, herProfile, loadHerProfile, setHerProfile, userName, herPronouns, refreshLife, logEvent, eventList, noticeRules, chatCardKind, addChatCard, sessionList, beginSession,
  holdSession, endSession, turn, shareWith, knownList, personaState, bridge, bridgeConnect,
  publish, setPhase, PRESENCE, setDayPlan, presence, updatePresence, wakeAt, setPresence, setBodyModel, bodyModel, chatLanguage,
  modelTuning, contextBlocks, setContextBlock, resetContextBlocks, buildContext, assemble, callModel,
  testConnection, checkCardArrived, listModels, normEndpoint, serviceOf, MODEL_SERVICES, memoryJob, deriveMemory, importMemory, dayMemory, calendarDays, awayTold, send, togetherSince, localModelAddress,
  DEFAULT_SETTINGS, loadSettings, saveSettings, CORE_VERSION, setEnv, param, params, state, jobs, bell, day, memorySource,
  prompt, prompts, layers, regex, chapters, calibrate, exportCard, answerPronoun, unusedParts, guessPronoun, parsePreset, presetLayer,
  moduDefaults, loreSelect, currentState, lunarDate, solarTerm, ticker, reach, sideCall, calls, sideSettings, useSettings, loadReach, saveReach, paused } = core;

// window.ModuCore in a page; the global of a worker or a Node realm
globalThis.ModuCore = {
  get version(){ return CORE_VERSION; },
  EMOTIONS, store, on(f){ listeners.add(f); return () => listeners.delete(f); },
  // import + store
  readPngTexts, normaliseCard, readCardFile, parseChat, stageImport, chooseCaiChat, buildStoreFiles, saveImport, loadStaged,
  loadFromDir, loadDemo, appendToChat, phoneRoot, canPickFolder,
  // contacts
  get contacts(){ return core.contacts; }, get currentId(){ return core.currentId; }, set ephemeral(v){ core.ephemeral = v; },
  // what came beside the card in its folder, parsed (preset, regex, contacts); read only (查手机's contacts)
  get folderData(){ return core.folderData ? core.clone(core.folderData) : null; },
  // settles once the open companion's card folder (and its regex vetting) is read after 'loaded' (设置 redraws then)
  get cardsRead(){ return core.cardsRead; },
  // settle once his params.json (paramsRead) and Modu's default layers (defaultsRead) are read after each 'loaded'
  get paramsRead(){ return core.paramsRead; }, get defaultsRead(){ return core.defaultsRead; },
  loadContacts, openContact, removeContact, canOpenWithoutAsking, current, setAvatar, setPronouns, msgDate,
  // first run; the default companion once she moves her own in
  firstRun, greetingFor, firstCompanion,
  // records (store 0.2): one folder per record type
  records,
  // her phone: her own store beside his folders, the same record API; and how he may know
  // a thing of hers (a knowledge path; the `known` block)
  myRecords, get myStore(){ return myStoreInfo(); }, myStoreFiles, restoreMyStore, shareWith, knownList,
  // memory
  readMemory, parseMemoryFile, deriveMemory, memoryJob, addMemory, editMemory, deleteMemory, pinMemory,
  // the memory job for a chat brought with 搬家 (queued by saveImport / loadStaged), and the one
  // way days away are counted (calendar days)
  importMemory, calendarDays,
  // the chat of a day that is over becomes memory by itself, one call a day at most
  dayMemory,
  // was a day inside a time away she had told him about (a trip)? → her line, or ''
  awayTold,
  // persona + brain
  pronouns, assemble, buildContext, contextBlocks, setContextBlock, resetContextBlocks, modelTuning, personaState, refreshLife,
  // the life block's record types: an app declares its own with lifeTypes.add; the core names none
  lifeTypes,
  // the event log: every app writes what happened through one call; the `events` block reads it
  logEvent, eventList,
  // one turn of his inside an app, app sessions and the neutral chat cards
  turn, beginSession, holdSession, endSession, get sessions(){ return sessionList(); }, addChatCard, chatCardKind,
  // notice rules: the seam where a page decides whether an entry reaches his prompt (none by default)
  noticeRules,
  get lastContext(){ return core.lastContext; }, splitEmotion, parseReply, splitBubbles, splitParts, photoTags, dropFinalStop, chatLanguage, tidyCJK, callModel, testConnection, send, togetherSince,
  // body seam
  publish, setPhase, bridgeConnect, bridge, presence, setPresence, PRESENCE, now, setClock, setDayPlan, setBodyModel, bodyModel,
  // look at presence again now (after a send, a reply, a fresh day copy), not only on the clock beat; when he is next up
  updatePresence, wakeAt,
  // settings
  DEFAULT_SETTINGS, loadSettings, saveSettings, localModelAddress,
  // the host: fetch, clock, storage, prefs, … passed in by a host with no browser
  setEnv,
  // the card-arrived check behind 测试连接
  checkCardArrived,
  // the services she can pick by name (frozen), the address as the service answers it, which service an
  // address is, the service's own model list
  get modelServices(){ return MODEL_SERVICES.map(s => Object.freeze(Object.assign({}, s))); }, normEndpoint, serviceOf, listModels,
  // product defaults (neutral in the core; Modu's page sets MODU_DEFAULTS)
  NEUTRAL_DEFAULTS, MODU_DEFAULTS, setDefaults, getDefaults,
  // his params and a card's own state; jobs and the bell; his day; the memory
  // source; side-call prompts in text files; the layer list
  param, params, state, jobs, bell, day, memorySource, prompt, prompts, layers,
  // cards and layers: regex (prompt and display side, guarded), Modu's defaults, a preset read
  // as text blocks, the 世界书 timing set, calibration into params.json, chapters, the card back out, what is never run
  // here, his pronoun read from the card, the facts' current state
  regex, moduDefaults, parsePreset, presetLayer, loreSelect, calibrate, chapters, exportCard, unusedParts, guessPronoun, answerPronoun,
  currentState, calendar: { lunar: lunarDate, term: solarTerm },
  // files she adds later beside his card; a switch for a block of a preset she added herself
  addBesideCard, presetSwitch,
  // her own name, picture and pronoun (profile/me in her store), the name his prompt uses for her, her pronoun
  herProfile, loadHerProfile, setHerProfile, userName, herPronouns,
  // the one clock, 主动, her 他找你 settings and 暂停, the side model and the one counted door
  // for every side call (his day's sketch and posts, memory's age-out and tidy, the decider) that 暂停 closes
  clock: ticker, reach, sideCall, calls, sideSettings, useSettings, loadReach, saveReach, paused,
};
delete globalThis[Symbol.for('modu.core')];   // the core's files are all loaded: nothing outside them reaches its insides
})(globalThis[Symbol.for('modu.core')]);
