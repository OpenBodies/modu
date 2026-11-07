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
const CAL_MAX = 6000;   // the answer's room: the whole params file in Chinese, with room for a model that thinks first
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
  // an answer cut off by a smaller room (2500; a long card needs ~4000 characters of JSON, and a model that thinks
  // first spends some of it there) is asked once more with the room it needs: a record without max is from before that
  const cutOff = last && last.why === 'unusable' && (Number(last.max) || 2500) < CAL_MAX;
  if (!o.force && last && last.hash === hash && last.model === String(s.model || '') && !cutOff) return { ran: false, ok: false, why: 'tried' };
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
  const tried = async why => { if (await blocked()) return; try { await recs.commit('calibration', { id: 'last', hash, model: String(s.model || ''), why, max: CAL_MAX, at: now().getTime() }, { writer: 'calibration', app: 'calibration' }); } catch {} };
  const asked = [{ role: 'system', content: text || cardDigest(card) }, { role: 'user', content: cardDigest(card) }];
  calibratedHashes.add(hash); core.calibrations++;
  let raw; try { raw = await core.sideCall('calibrate', asked, { chat: true, settings: s, max: CAL_MAX }); }
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
// a said fact that is a moment (core.MOMENT, memory.js) ends with its day, as state with an end does elsewhere (a plan or a
// place that is over is closed, never left standing)
const passed = r => core.MOMENT.test(String(r.value || '')) && core.isoDay(new Date(Number(r.said_at || r.at) || 0)) < core.isoDay(now());
function currentState(){
  const f = cardFacts(), all = core.factsNow.key === cardKey() ? core.factsNow.said : {}, said = {};
  for (const k of Object.keys(all)) if (!passed(all[k])) said[k] = all[k];
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
