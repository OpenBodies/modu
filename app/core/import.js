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

// 搬家 → 新建一个. A companion from what she typed: his name, one line about him, an optional greeting and a few
// lines of personality, made into a V2 card ({ spec: 'chara_card_v2', data }) as a .json File. The page stages it with
// stageImport like any card she picks, so it is saved the same way a PNG card is (card.json, manifest, memory). Nothing here
// adds to what she typed. → File; throws { code: 'no-name' } with no name.
function newCard(o = {}){
  const t = k => String((o && o[k]) || '').replace(/\r\n?/g, '\n').trim();
  const name = t('name').replace(/\s+/g, ' ').slice(0, 60);
  if (!name) throw failure('no-name', '', '没有名字');
  const card = { spec: 'chara_card_v2', spec_version: '2.0', data: {
    name, description: t('description'), personality: t('personality'), scenario: '', first_mes: t('first_mes'), mes_example: '',
    creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], tags: [], creator: '',
    character_version: '', extensions: {} } };
  return new File([JSON.stringify(card, null, 2)], name.replace(/[\\/:*?"<>|]+/g, '_') + '.json', { type: 'application/json' });
}

Object.assign(core, { readPngTexts, normaliseCard, readCardFile, parseChat, chooseCaiChat, stageImport, answerPronoun, newCard });
})(globalThis[Symbol.for('modu.core')]);
