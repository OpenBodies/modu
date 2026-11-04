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
