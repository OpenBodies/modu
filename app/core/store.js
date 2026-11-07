// app/core/store.js: the store: the companion currently loaded, his folder (read, written back), the bundled samples.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, store, hostFetch, markUntimely, now, writeFile, readText, readBlob, VDir, readMemory, slug, memoryBody, MEMORY_FORMAT,
  parseChat, stageImport, storageError, readError, readKept, kvGet } = core;

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
    store: STORE_FORMAT, name, imported_from: st.made || st.source === 'Modu' ? 'made in Modu (新建一个)' : st.source === '酒馆' ? 'SillyTavern files' : st.caiApp ? 'c.ai export (c.ai app)' : 'c.ai export (cai tools)',
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
// in the in-browser folder a small companion goes in ONE write (VDir.writeFolder), state 'saved', so a closed tab leaves
// all of him or nothing; a big one goes there in pieces, and in a real folder (and a host's storage that cannot write many
// at once) file by file: it says 'saving' first, then the files, then 'saved'. loadFromDir takes the note away once he is in her contacts. At boot, loadContacts
// gives back a 'saved' folder that never reached her contacts and clears a 'saving' one (recoverSaves, contacts.js);
// in a real folder the next save of that name clears it (freeName), and 打开已有的文件夹 says it was not finished.
const SAVING = '.modu-saving.json';
async function savingNote(dir, read = readText){
  const t = await read(dir, SAVING); if (t === null) return null;
  try { const j = JSON.parse(t); if (j && typeof j === 'object') return j; } catch {}
  return { state:'saving' };   // cut short while it was written: not finished
}
async function writeFolder(root, name, files){
  const note = state => JSON.stringify({ v: 1, writer: 'modu', state, at: now().getTime() });
  let one = null;
  // a save the browser keeps aborting (tried again already) for any reason but a full phone goes again file by file,
  // between the save notes: slower, still put right after a closed tab, and it names the file that would not go in
  try { one = root.writeFolder ? await root.writeFolder(name, Object.assign({ [SAVING]: note('saved') }, files), { saving: { file: SAVING, text: note('saving') } }) : null; }
  catch(e){ if (storageError(e).code === 'storage-full') throw e; console.error('one write refused, file by file:', e); await dropFolder(root, name); }
  if (one) return one;
  const dir = await root.getDirectoryHandle(name, { create:true });
  await writeFile(dir, SAVING, note('saving'));
  for (const [p, c] of Object.entries(files)){
    try { await writeFile(dir, p, c); }
    catch(e){ try { e.file = p; e.size = new Blob([c]).size; } catch {} throw e; }
  }
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
// opts.remove = [{ id }]: companions she said yes to losing (替换's old one), gone once he is safely in. Kept in her kv
// ('removeAfter') BEFORE the save, done after it, and finished at the next start (finishRemovals) when a reload cut in
// between; nothing is removed unless the new companion is in, whole. An entry with ifUnused is a guess, not her yes: it
// removes nobody, so no caller can take a companion away quietly through a save.
async function saveImport(st, root, opts = {}){
  const remove = ((opts && opts.remove) || []).filter(x => x && x.id && !x.ifUnused).map(x => ({ id: String(x.id) }));
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
    catch(e){ await dropFolder(root, name); throw storageError(e, 'write'); }
    stayed = !was || !wasName || (core.currentId === was && store.name === wasName);   // nobody was open: he opens
    // what we just wrote cannot be read back (another tab's start removed it, on a phone with no Web Locks):
    // the save was cut off, said as that (never "no companion in this folder"), and what is left of it goes
    try { if (stayed) await loadFromDir(dir); else await listOnly(dir, st); }
    catch(e){ await dropFolder(root, name); throw storageError(Object.assign(new DOMException('the folder was taken away while it was saved', 'AbortError'), { cause: e }), 'read-back'); }
    return dir;
  });
  // her own companion in the in-browser folder: ask the browser to keep it (Safari's 7 days, Android's clean-up)
  if (dir instanceof VDir && core.storage().kind === 'memory') emit('storage', { persisted: false, where: 'memory' });
  else if (dir instanceof VDir && !st.seeded && !st.sample) keepStorage().then(persisted => emit('storage', { persisted }), () => {});
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
// Everything is read and checked first; the open companion is left as he was until then. A file that is there and would
// not read stops it (err.code 'storage-read'): he never opens as a name with no card, answering as a bare model.
async function loadFromDir(dir){
  let note, cardJ, chatRaw, man;
  try { note = await savingNote(dir, readKept); cardJ = await readKept(dir, 'card.json'); chatRaw = await readKept(dir, 'chat.jsonl'); man = await readKept(dir, 'manifest.json'); }
  catch(e){ throw readError(e); }
  if (note && note.state !== 'saved') throw Object.assign(new Error('这个文件夹没有搬完（上次被打断了），请重新搬家'), { code: 'unfinished' });
  // an empty chat.jsonl counts as no file
  const chatT = chatRaw && chatRaw.trim() ? chatRaw : null;
  if (!cardJ && !chatT) throw Object.assign(new Error('这个文件夹里没有角色'), { code: 'no-companion' });
  let cj = null;
  if (cardJ){ try { cj = JSON.parse(cardJ); } catch {} if (!cj || typeof cj !== 'object') throw Object.assign(new Error('这个文件夹里的角色卡坏了，打不开'), { code: 'broken-card' }); }
  let c; try { c = chatT ? parseChat(chatT) : { meta:{}, msgs:[] }; } catch { throw Object.assign(new Error('这个文件夹里的聊天记录坏了，打不开'), { code: 'broken-chat' }); }
  let mj = null; try { mj = JSON.parse(man); } catch {}
  // his manifest says a card was saved and it is not here: a chat with nobody behind it. Refused, his chat left as it is
  if (!cardJ && mj && Array.isArray(mj.files) && mj.files.includes('card.json')) throw Object.assign(new Error('角色卡不见了，打不开。聊天记录还在，可以从备份恢复，或者重新导入角色卡'), { code: 'card-missing' });
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
  store.source = mj && /SillyTavern/i.test(mj.imported_from) ? '酒馆' : mj && /made in Modu/.test(mj.imported_from) ? 'Modu' : 'c.ai';   // 'Modu': made in 新建一个
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
