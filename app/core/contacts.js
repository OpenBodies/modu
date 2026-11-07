// app/core/contacts.js: contacts: every companion this browser knows, switching between them, first run.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, store, env, hostFetch, msgDate, storage, storageError, saveFailure, kvSet, kvGet, VDir, phoneRoot, stageImport, saveImport, resetStore,
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
  // then a removal a reload cut off (替换's old one) is finished, once the new companion is in
  if (!recovering) recovering = read().then(ok => ok ? recoverSaves().then(async back => { await finishRemovals(); return back; }) : []).catch(e => console.error('recover:', e));
  await recovering;
  await read();
  await markMissing();
  return core.contacts;
}
// A contact in the in-browser folder with neither card nor chat there: said on his row (filesMissing, for this visit, never
// saved) and when she taps him. Her list is not changed: a companion leaves only on her own yes.
async function markMissing(){
  if (unread) return;
  let has; try { has = new Set((await storage().keys('vfs', 'modu/')).map(String)); } catch(e){ console.error(e); return; }
  for (const c of core.contacts) if (c.where === 'phone' && c.vpath) c.filesMissing = !has.has(c.vpath + '/card.json') && !has.has(c.vpath + '/chat.jsonl');
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
// planRemoval(name, [{ id }]) keeps in her kv ('removeAfter' { v, writer, rev, at, name, before, remove }) who goes
// once a companion called `name` that was not here before is in her contacts; planRemoval(null) forgets it. finishRemovals()
// does it then (saveImport right after its save; loadContacts at the next start, when a reload cut in): a new companion
// listed → each one goes (never one she has open; at the next start, one that was open hands that place to the new one);
// none → nothing is removed. Either way the note goes. An entry marked ifUnused, which a plan an older build saved may
// still hold, was never her yes: it stays.
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
    if (x.ifUnused) continue;
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
// → false when the list could not be kept. Said once, not at every message; a save it failed for has its folder and
// its note, so the next start gives him back (recoverSaves).
let listRefused = false;
async function saveContacts(){
  if (core.ephemeral || unread) return true;
  try {
    await kvSet('contacts', core.contacts.filter(c => c.where !== 'demo').map(c => { const o = Object.assign({}, c); delete o.snap; delete o.filesMissing; return o; }));
    await kvSet('currentId', core.currentId);
    listRefused = false; return true;
  } catch(e){
    console.error(e);
    if (!listRefused){ listRefused = true; emit('error', '联系人名单没存上，下次打开时会再放回去：' + saveFailure(storageError(e, 'list'))); }
    return false;
  }
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
  try { await loadFromDir(dir); }
  catch(e){
    if (c.where !== 'phone' || (e && e.code) !== 'no-companion') throw e;
    c.filesMissing = true; emit('contacts', core.contacts);
    throw Object.assign(new Error(`${c.name}的资料不在这部手机上了，打不开。有备份的话可以从备份恢复；也可以长按把这一行删掉`), { code: 'files-missing', cause: e });
  }
  return true;
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
// a first run that failed leaves its reason in core.firstRunError ('' when it did not fail) and the line to copy in
// core.firstRunDetail, so the phone can say it instead of opening with nobody and no word why
core.firstRunError = ''; core.firstRunDetail = '';
// somebody she could open in the in-browser folder. A folder with no card and no chat, or one a failed save left (not
// 'saved'), is nobody: counting it wrote the firstRun note and left a phone empty for good
async function someoneInFolder(){
  const keys = (await storage().keys('vfs', 'modu/')).map(String).filter(k => k.startsWith('modu/')), has = new Set(keys);
  for (const n of new Set(keys.map(k => k.split('/')[1]))){
    const path = 'modu/' + n;
    if (!has.has(path + '/card.json') && !has.has(path + '/chat.jsonl')) continue;
    const note = has.has(path + '/' + SAVING) ? await savingNote(new VDir(path)) : null;
    if (!note || note.state === 'saved') return true;
  }
  return false;
}
async function firstRun(base = '../samples/', { lang = 'zh' } = {}){
  const first = FIRST_COMPANION[lang] || FIRST_COMPANION.zh;
  if (core.ephemeral) return null;
  core.firstRunError = ''; core.firstRunDetail = '';
  try {
    { const note = await kvGet('firstRun'); if (note){ await newSeedPicture(base, note); return null; } }
    await loadContacts();
    const someone = async () => core.contacts.length || ((await kvGet('contacts')) || []).length || await someoneInFolder();
    if (await someone()){
      // the default companion saved, then the tab closed before this note: he is still the one firstRun seeded
      let seeded = null;
      for (const c of core.contacts) if (!seeded && c.where === 'phone' && c.vpath){ try { if (JSON.parse(await readText(new VDir(c.vpath), 'manifest.json') || 'null').seeded) seeded = c; } catch {} }
      await kvSet('firstRun', seeded ? { at: core.now().getTime(), seeded: seeded.name, id: seeded.id } : { at: core.now().getTime(), seeded:'' }); return null;
    }
    const r = await hostFetch(base + first); if (!r.ok) throw Object.assign(new Error(r.status), { step: 'fetch', file: first });
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
  } catch(e){ console.error('first run:', e); core.firstRunError = String((e && (e.message || e.name)) || e || '?').slice(0, 200); core.firstRunDetail = saveFailure(e); return null; }   // tried again next time
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
// here, else null. `used`: she has written to him (a message of hers in his chat). The page leaves an unused one in 聊天
// and asks (as deleting a contact does) when she used him. firstCompanion({ keep: true }) is her answer "keep him":
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
  canOpenWithoutAsking, removeContact, firstRun, firstCompanion, recoverSaves, addContact, planRemoval, finishRemovals,
  isUnread: () => unread });
})(globalThis[Symbol.for('modu.core')]);
