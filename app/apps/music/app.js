// 一起听 (music), a contact-scoped session app with a home widget and a chat card.
// A room for her and one companion: she picks song files (and .lrc lyrics) from her own
// device; they play in this page (one Audio element in no screen, so the song goes on while she moves around);
// he comments inside the room through the app session (ctx.session: s.turn, never into the chat), a few times a
// song: when it starts, at one lyric line, and when she talks to him there. He hears what a page can honestly
// give: title, artist and album from the file's tags, and the lyric line playing now if she added an .lrc.
// A real player: a queue, 列表循环 / 单曲循环 / 随机播放, prev and next, ♥ for her and ♥ for him.
// Whose is what: the songs she listened to (听过的, with her ♥ and her lyrics) are hers,
// on her phone (ctx.mine, type `music`); his ♥ makes his 歌单 (type `songlist`, his folder). The files are never
// copied anywhere: only their names, tags and lyrics are kept.
// Leaving the room ends the session with one neutral grey line in the chat (一起听了3首歌，23分钟).
(function(){
'use strict';
const ID = 'music', MINE = 'music', HIS = 'songlist', OLD = 'music';
const M = () => window.ModuCore;
// time from the core's one clock (ModuCore.now), so ?at= and a test's clock move it too
const nowMs = () => { const c = M(); return c && c.now ? c.now().getTime() : Date.now(); };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const userName = () => (M().store.meta && M().store.meta.user_name) || 'You';
const mmss = n => { n = Math.max(0, Math.round(Number(n) || 0)); return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0'); };
const base = name => String(name || '').replace(/\.[A-Za-z0-9]{1,5}$/, '');
// The pickers say no type at all (no accept), as 导入 (#importFile) does: an iPhone greys out a
// file in 文件 whose type it cannot match to an accept list, and a song saved to 我的iPhone often comes with no type it
// knows. So any file can be picked, and this code sorts what came: a song is an audio type or a known song name; a .lrc
// or .txt is lyrics; anything else gets one plain line and is left out.
const SONG_NAME = /\.(mp3|m4a|m4b|aac|wav|aiff?|caf|flac|ogg|opus)$/i;
const isSong = f => /^audio\//.test(f.type || '') || SONG_NAME.test(f.name || '');
const isLrc = f => /\.(lrc|txt)$/i.test(f.name || '') || /^text\//.test(f.type || '');
// her phone's records: ctx.mine (the core's myRecords), kept from the last ctx the page gave
let herStore = null;
const mine = () => herStore || M().myRecords;
const keep = ctx => { if (ctx && ctx.mine) herStore = ctx.mine; return ctx; };

// ---------------------------------------------------------------------------------------------------------
// Tags (pure): ID3v2.2/2.3/2.4 and ID3v1 (mp3), Vorbis comments (FLAC); the file name as a fallback.
// Many Chinese files keep GBK bytes in a tag marked latin-1: those are read as UTF-8 or GBK when they decode cleanly.
function decodeBytes(b, enc){
  b = b instanceof Uint8Array ? b : new Uint8Array(b);
  const strip = s => s.replace(/\u0000+$/, '').split('\u0000').map(x => x.trim()).filter(Boolean).join(' / ');
  try {
    if (enc === 1){
      if (b[0] === 0xFE && b[1] === 0xFF) return strip(new TextDecoder('utf-16be').decode(b.subarray(2)));
      if (b[0] === 0xFF && b[1] === 0xFE) return strip(new TextDecoder('utf-16le').decode(b.subarray(2)));
      return strip(new TextDecoder('utf-16le').decode(b));
    }
    if (enc === 2) return strip(new TextDecoder('utf-16be').decode(b));
    if (enc === 3) return strip(new TextDecoder('utf-8').decode(b));
  } catch { return ''; }
  if (b.every(x => x < 0x80)) return strip(String.fromCharCode(...b));
  for (const label of ['utf-8', 'gbk']){ try { return strip(new TextDecoder(label, { fatal:true }).decode(b)); } catch {} }
  return strip(new TextDecoder('latin1').decode(b));
}
// where a text of encoding `enc` that starts at i ends (its terminator), and the index after it
function textEnd(b, i, enc){
  if (enc === 1 || enc === 2){ for (let j = i; j + 1 < b.length; j += 2) if (!b[j] && !b[j + 1]) return [j, j + 2]; return [b.length, b.length]; }
  for (let j = i; j < b.length; j++) if (!b[j]) return [j, j + 1];
  return [b.length, b.length];
}
const syncsafe = (b, i) => (b[i] & 0x7f) << 21 | (b[i + 1] & 0x7f) << 14 | (b[i + 2] & 0x7f) << 7 | (b[i + 3] & 0x7f);
// bytes (an ID3v2 tag from its 'ID3' header) → { title, artist, album, lyrics, cover: { mime, bytes } } (each optional)
function readID3(buf){
  let b = new Uint8Array(buf); const out = {};
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return out;
  const ver = b[3], flags = b[5], size = syncsafe(b, 6);
  b = b.subarray(10, Math.min(b.length, 10 + size));
  if (flags & 0x80 && ver < 4){ const u = []; for (let i = 0; i < b.length; i++){ u.push(b[i]); if (b[i] === 0xFF && b[i + 1] === 0) i++; } b = new Uint8Array(u); }
  let p = 0;
  if (flags & 0x40 && ver >= 3) p = ver === 3 ? 4 + ((b[0] << 24 | b[1] << 16 | b[2] << 8 | b[3]) >>> 0) : syncsafe(b, 0);
  const idLen = ver === 2 ? 3 : 4, headLen = ver === 2 ? 6 : 10;
  const NAMES = { TIT2:'title', TT2:'title', TPE1:'artist', TP1:'artist', TALB:'album', TAL:'album' };
  while (p + headLen <= b.length){
    const id = String.fromCharCode(...b.subarray(p, p + idLen));
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    const len = ver === 2 ? (b[p + 3] << 16 | b[p + 4] << 8 | b[p + 5]) : ver === 4 ? syncsafe(b, p + 4) : ((b[p + 4] << 24 | b[p + 5] << 16 | b[p + 6] << 8 | b[p + 7]) >>> 0);
    const f = b.subarray(p + headLen, p + headLen + len); p += headLen + len;
    if (!len || !f.length) continue;
    const enc = f[0];
    if (NAMES[id] && !out[NAMES[id]]) { const v = decodeBytes(f.subarray(1), enc); if (v) out[NAMES[id]] = v; }
    else if ((id === 'USLT' || id === 'ULT') && !out.lyrics){ const [, after] = textEnd(f, 4, enc); out.lyrics = decodeBytes(f.subarray(after), enc); }
    else if ((id === 'APIC' || id === 'PIC') && !out.cover){
      let i = 1, mime;
      if (id === 'PIC'){ const fmt = String.fromCharCode(...f.subarray(1, 4)).toLowerCase(); mime = fmt === 'png' ? 'image/png' : 'image/jpeg'; i = 4; }
      else { const [e, after] = textEnd(f, 1, 0); mime = String.fromCharCode(...f.subarray(1, e)) || 'image/jpeg'; i = after; if (!/\//.test(mime)) mime = 'image/' + mime.toLowerCase().replace('jpg', 'jpeg'); }
      const [, after] = textEnd(f, i + 1, enc);
      if (after < f.length) out.cover = { mime, bytes: f.slice(after) };
    }
  }
  return out;
}
// the last 128 bytes of an mp3 → { title, artist, album } (ID3v1), or {}
function readID3v1(buf){
  const b = new Uint8Array(buf); if (b.length < 128) return {};
  const t = b.subarray(b.length - 128); if (t[0] !== 0x54 || t[1] !== 0x41 || t[2] !== 0x47) return {};
  const field = (i, n) => { const s = t.subarray(i, i + n); const e = s.indexOf(0); return decodeBytes(e < 0 ? s : s.subarray(0, e), 0).trim(); };
  const out = {}, title = field(3, 30), artist = field(33, 30), album = field(63, 30);
  if (title) out.title = title; if (artist) out.artist = artist; if (album) out.album = album;
  return out;
}
// bytes of a FLAC file from its start → { title, artist, album, lyrics, cover }
function readFLAC(buf){
  const b = new Uint8Array(buf), out = {};
  if (String.fromCharCode(...b.subarray(0, 4)) !== 'fLaC') return out;
  const le = i => (b[i] | b[i + 1] << 8 | b[i + 2] << 16 | b[i + 3] << 24) >>> 0, be = i => (b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]) >>> 0;
  let p = 4;
  for (let guard = 0; p + 4 <= b.length && guard < 64; guard++){
    const last = b[p] & 0x80, type = b[p] & 0x7f, len = b[p + 1] << 16 | b[p + 2] << 8 | b[p + 3], s = p + 4;
    if (type === 4 && s + 8 <= b.length){
      let i = s + 4 + le(s); const n = le(i); i += 4;
      for (let k = 0; k < n && i + 4 <= s + len; k++){
        const l = le(i), kv = new TextDecoder('utf-8').decode(b.subarray(i + 4, i + 4 + l)); i += 4 + l;
        const eq = kv.indexOf('='); if (eq < 1) continue;
        const key = kv.slice(0, eq).toUpperCase(), v = kv.slice(eq + 1).trim(), name = { TITLE:'title', ARTIST:'artist', ALBUM:'album', LYRICS:'lyrics', UNSYNCEDLYRICS:'lyrics' }[key];
        if (name && v && !out[name]) out[name] = v;
      }
    } else if (type === 6 && !out.cover && s + 32 <= b.length){
      let i = s + 4; const ml = be(i); const mime = String.fromCharCode(...b.subarray(i + 4, i + 4 + ml)); i += 4 + ml;
      i += 4 + be(i); i += 16; const dl = be(i);
      if (i + 4 + dl <= b.length) out.cover = { mime: mime || 'image/jpeg', bytes: b.slice(i + 4, i + 4 + dl) };
    }
    p = s + len; if (last) break;
  }
  return out;
}
// "陈绮贞 - 晚风.mp3" → { title:'晚风', artist:'陈绮贞' }; "晚风_demo.wav" → { title:'晚风 demo' }
function fromName(name){
  const s = base(name).replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(s);
  return m ? { title: m[2].trim(), artist: m[1].trim() } : { title: s || '—' };
}
// File → Promise<{ title, artist?, album?, lyrics?, cover? }>: its tags, else its name
async function readTags(file){
  const got = {};
  try {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) Object.assign(got, readID3(await file.slice(0, Math.min(10 + syncsafe(head, 6), 8 << 20)).arrayBuffer()));
    else if (String.fromCharCode(...head.subarray(0, 4)) === 'fLaC') Object.assign(got, readFLAC(await file.slice(0, 8 << 20).arrayBuffer()));
    if (!got.title && (file.size || 0) > 128){ const v1 = readID3v1(await file.slice(file.size - 128).arrayBuffer()); for (const k in v1) if (!got[k]) got[k] = v1[k]; }
  } catch(e){ console.error(e); }
  const named = fromName(file.name);
  for (const k of ['title', 'artist', 'album']) if (got[k]) got[k] = clip(got[k], 60);
  return Object.assign({}, named, got.title ? { title: got.title } : {}, got.artist ? { artist: got.artist } : {}, got.album ? { album: got.album } : {}, got.lyrics ? { lyrics: got.lyrics } : {}, got.cover ? { cover: got.cover } : {});
}

// ---------------------------------------------------------------------------------------------------------
// Lyrics (pure): .lrc, time-stamped lines. [mm:ss.xx] (several on one line), [ti:] [ar:] [al:] [offset:ms].
function parseLRC(text){
  const out = { lines: [], ti:'', ar:'', al:'', offset: 0 };
  const rows = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  const timed = [];
  for (const raw of rows){
    let rest = raw.trim(), m; const stamps = [];
    while ((m = /^\[([^\]]*)\]/.exec(rest))){
      const tag = m[1].trim(); rest = rest.slice(m[0].length);
      const tm = /^(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?$/.exec(tag);
      if (tm) stamps.push(Number(tm[1]) * 60 + Number(tm[2]) + (tm[3] ? Number('0.' + tm[3]) : 0));
      else { const mt = /^(ti|ar|al|offset)\s*:(.*)$/i.exec(tag); if (mt){ const k = mt[1].toLowerCase(); if (k === 'offset') out.offset = Number(mt[2]) || 0; else out[k] = mt[2].trim(); } }
    }
    for (const t of stamps) timed.push({ t, text: rest.trim() });
  }
  out.lines = timed.map(l => ({ t: Math.max(0, Math.round((l.t - out.offset / 1000) * 100) / 100), text: clip(l.text, 80) })).sort((a, b) => a.t - b.t).slice(0, 600);
  return out;
}
const hasLyrics = lrc => !!(lrc && lrc.lines.filter(l => l.text).length >= 2);
// → the index of the line sung at `sec` (the last one that has started), or -1 before the first
function lineAt(lines, sec){ let k = -1; for (let i = 0; i < (lines || []).length; i++){ if (lines[i].t <= sec) k = i; else break; } return k; }
// → the one line he may comment on: the chorus (the line sung most often, from its first time, if that is not
// the song's first line), else the line nearest the middle of the song; -1 when there is none
function pickLine(lines){
  const sung = (lines || []).map((l, i) => ({ i, k: l.text.replace(/[\s，。,.!！?？~～…]+/g, ''), t: l.t })).filter(x => x.k.length >= 2);
  if (sung.length < 2) return -1;
  const count = new Map(); for (const x of sung) count.set(x.k, (count.get(x.k) || 0) + 1);
  let best = null;
  for (const x of sung){ const n = count.get(x.k); if (n >= 2 && x.i !== sung[0].i && (!best || n > count.get(best.k))) best = x; }
  if (best) return sung.find(x => x.k === best.k && x.i !== sung[0].i).i;
  const mid = sung[sung.length - 1].t / 2;
  return sung.reduce((a, x) => Math.abs(x.t - mid) < Math.abs(a.t - mid) ? x : a).i;
}

// ---------------------------------------------------------------------------------------------------------
// The player: one Audio element in no screen, a queue, a play mode.
const player = new Audio();
player.preload = 'auto';
const MODES = ['all', 'one', 'shuffle'];   // 列表循环, 单曲循环, 随机播放
let queue = [];         // [{ key, id (her record), title, artist, album, file, size, type, url, cover, lrc, lrcText, herLiked, hisLiked }]
let now = -1;           // the index in the queue playing (or paused) now
let mode = 'all';
let refused = '';       // why the browser would not play (it wants her tap first), for the screen and tests
let withId = '', withName = '';   // the companion she listened with (the last room's)
let room = null;        // the open room: { s, ctx, n, ms, tick, strip, chain, pending, prev, said }
const listeners = new Set();
const changed = () => { for (const f of listeners) { try { f(); } catch(e){ console.error(e); } } };
const song = () => queue[now] || null;
function playing(){ const s = song(); return !!(s && !player.paused && !player.ended); }
['play', 'pause', 'loadedmetadata', 'timeupdate'].forEach(ev => player.addEventListener(ev, changed));
player.addEventListener('play', () => hold());
player.addEventListener('pause', () => { if (!player.ended) hold(); });
player.addEventListener('timeupdate', () => { counting(); lyricMoment(); });
player.addEventListener('ended', () => { const s = song(), loops = mode === 'one' || queue.length === 1; if (room && s && !loops) room.prev = s.title; next(true).catch(e => console.error(e)); });

async function playNow(){ refused = ''; try { await player.play(); } catch(e){ refused = e.name || 'refused'; } changed(); }
// start queue[i] from its beginning; `loop`: the same song again (单曲循环, or a queue of one): no new count, no new comment
async function start(i, opts = {}){
  const s = queue[i]; if (!s) return null;
  const again = i === now && opts.loop;
  now = i;
  if (!again && room) room.n++;
  if (player.src !== s.url) player.src = s.url; else player.currentTime = 0;
  await playNow();
  if (!again){
    s.said = { lyric:false };
    await heard(s);
    log('play', room ? `她在一起听里放了${about(s)}，你们一起听（第${room.n}首）` : `她接着放了你们刚才一起听的歌${about(s)}`, { id: s.id });
    hold();
    if (room) comment('start', s);
  } else hold();
  changed();
  return s;
}
async function next(auto){
  if (!queue.length) return null;
  if (auto && mode === 'one') return start(now, { loop:true });
  let i = now + 1;
  if (mode === 'shuffle' && queue.length > 1){ do { i = Math.floor(Math.random() * queue.length); } while (i === now); }
  i = ((i % queue.length) + queue.length) % queue.length;
  return start(i, { loop: i === now });
}
async function prev(){
  if (!queue.length) return null;
  if (player.currentTime > 3 || queue.length === 1){ player.currentTime = 0; changed(); return song(); }
  return start((now - 1 + queue.length) % queue.length);
}
async function toggle(){
  if (!song()) return false;
  if (player.paused) await playNow(); else player.pause();
  changed();
  return playing();
}
function setMode(m){ mode = MODES.includes(m) ? m : MODES[(MODES.indexOf(mode) + 1) % MODES.length]; changed(); return mode; }
function jump(i){ return i >= 0 && i < queue.length ? start(i) : null; }
function drop(i){
  if (i < 0 || i >= queue.length) return;
  const [s] = queue.splice(i, 1);
  if (i === now){ player.pause(); player.removeAttribute('src'); now = -1; if (queue.length) start(Math.min(i, queue.length - 1)); else hold(); }
  else if (i < now) now--;
  if (s && s.url) URL.revokeObjectURL(s.url); if (s && s.cover) URL.revokeObjectURL(s.cover);
  changed();
}

// ---- her songs (her phone, ctx.mine `music`): one record per song she listened to ----
async function herRecordOf(file, size){
  const all = await mine().list(MINE);
  return all.filter(r => r.file === file && (r.size || 0) === (size || 0)).sort((a, b) => (b.last || b.at || 0) - (a.last || a.at || 0))[0] || null;
}
async function heard(s){
  const was = s.id ? await mine().get(MINE, s.id) : null;
  const rec = await mine().put(MINE, Object.assign({}, was || {}, { id: s.id || undefined, title: s.title, artist: s.artist || '', album: s.album || '', file: s.file, size: s.size || 0, type: s.type || '',
    plays: ((was && was.plays) || 0) + 1, last: nowMs(), liked: !!s.herLiked }, s.lrcText ? { lrc: s.lrcText } : {}), { app: ID });
  s.id = rec.id;
  return rec;
}
// She picks files: songs (audio) and lyrics (.lrc, matched to a song by name). Nothing plays yet: the first
// new song plays now (her tap is the gesture that allows sound); with a song already playing they queue after.
async function choose(files){
  files = [].concat(files && files.length !== undefined && !(files instanceof Blob) ? [...files] : files || []).filter(Boolean);
  const lrcs = files.filter(isLrc), songs = files.filter(f => !isLrc(f) && isSong(f));
  if (!songs.length){ if (lrcs.length && song()) return addLyrics(lrcs[0]); return null; }
  const lyricOf = new Map(); for (const f of lrcs){ try { lyricOf.set(base(f.name), await f.text()); } catch {} }
  const added = [];
  for (const f of songs){
    const tags = await readTags(f), was = await herRecordOf(f.name, f.size || 0);
    let lrcText = lyricOf.get(base(f.name)) || '';
    if (!lrcText && tags.lyrics && hasLyrics(parseLRC(tags.lyrics))) lrcText = tags.lyrics;
    if (!lrcText && was && was.lrc) lrcText = was.lrc;
    lrcText = String(lrcText).slice(0, 40000);
    const s = { key: f.name + ':' + (f.size || 0), id: was ? was.id : '', title: tags.title, artist: tags.artist || '', album: tags.album || '', file: f.name, size: f.size || 0, type: f.type || '',
      url: URL.createObjectURL(f), cover: tags.cover ? URL.createObjectURL(new Blob([tags.cover.bytes], { type: tags.cover.mime })) : '',
      lrcText, lrc: lrcText ? parseLRC(lrcText) : null, herLiked: !!(was && was.liked), hisLiked: await hisHas(tags.title, tags.artist || '') };
    queue.push(s); added.push(s);
  }
  if (!playing()) await start(queue.indexOf(added[0]));
  changed();
  return added;
}
// lyrics for the song playing (or one file the page gives): kept with her record, so next time they are there
async function addLyrics(file, i = now){
  const s = queue[i]; if (!s || !file) return null;
  let text = ''; try { text = typeof file === 'string' ? file : await file.text(); } catch { return null; }
  const lrc = parseLRC(text); if (!hasLyrics(lrc)) return null;
  s.lrcText = text.slice(0, 40000); s.lrc = lrc; s.said = s.said || { lyric:false };
  if (s.id){ const r = await mine().get(MINE, s.id); if (r) await mine().put(MINE, Object.assign(r, { lrc: s.lrcText }), { app: ID }); }
  changed();
  return lrc;
}
// her ♥ (on her phone); in the room, he sees her do it
async function like(on){
  const s = song(); if (!s) return false;
  s.herLiked = on === undefined ? !s.herLiked : !!on;
  if (s.id){ const r = await mine().get(MINE, s.id); if (r) await mine().put(MINE, Object.assign(r, { liked: s.herLiked }), { app: ID }); }
  if (s.herLiked && room) log('like', `她给${about(s)}点了♥`, { id: s.id, by:'her' }, 'her');
  changed();
  return s.herLiked;
}

// ---- his 歌单 (his folder, `songlist`): the songs he ♥ ----
async function hisHas(title, artist){ try { return (await M().records.list(HIS)).some(r => r.title === title && (r.artist || '') === (artist || '')); } catch { return false; } }
async function hisLike(s){
  if (!s || s.hisLiked) return null;
  s.hisLiked = true;
  if (await hisHas(s.title, s.artist)) { changed(); return null; }
  const rec = await M().records.put(HIS, { title: s.title, artist: s.artist || '', album: s.album || '', with: userName() }, { app: ID });
  log('like', `你喜欢${about(s)}，放进了你的歌单`, { id: rec.id, by:'him' }, 'him');
  changed();
  return rec;
}

// Older files kept her songs in his folder (`music`): they are hers, so they move to her phone (same ids, so the old
// chat cards still draw), read back first, then leave his folder. Once per companion per visit.
const moved = new Set();
async function moveOld(){
  const who = M().currentId || M().store.name; if (!who || moved.has(who)) return 0; moved.add(who);
  let n = 0;
  for (const r of await M().records.list(OLD)){
    try {
      if (!(await mine().get(MINE, r.id))) await mine().put(MINE, Object.assign({}, r, { last: r.at, plays: 1, liked: false }), { app: ID });
      if (await mine().get(MINE, r.id)) { await M().records.remove(OLD, r.id); n++; }
    } catch(e){ console.error(e); }
  }
  return n;
}

// ---------------------------------------------------------------------------------------------------------
// What he knows. In the room: the session's hold line (the activity block). After she leaves the room
// with the song still on: the `music` block, only for the one she listened with, only while it plays.
function about(s){ if (!s) return ''; const t = `《${s.title}》`; return s.artist ? `${s.artist}的${t}` : t; }
let lastHold = null;
function hold(){
  if (!room || !room.s.open) return;
  const s = song();
  const line = !s ? '你们在一起听的房间里，她还没有放歌'
    : playing() ? `你们正在一起听${about(s)}，第${Math.max(1, room.n)}首` : `你们在一起听的房间里，${about(s)}暂停着，第${Math.max(1, room.n)}首`;
  if (line === lastHold) return;
  lastHold = line;
  room.s.hold(line).catch(e => console.error(e));
}
const AFTER = t => `（小手机里正在发生的事）你们刚才在一起听里听歌，她还在放《${t}》。可以自然地提到，也可以不提。`;
function addBlock(){
  try { M().setContextBlock('music', { after:'now', priority: 45, budget: 200, build: () => (!room && playing() && withId && (M().currentId || '') === withId) ? AFTER(song().title) : '' }); }
  catch(e){ console.error(e); }
}
// how long they listened in the room (only while it plays)
function counting(){
  if (!room) return;
  const t = performance.now();
  if (playing() && room.tick) room.ms += Math.min(2000, Math.max(0, t - room.tick));
  room.tick = playing() ? t : 0;
}

// ---- his words in the room (s.turn: never into the chat) ----
const IN_ROOM = '（小手机里的一起听：你们在一起听歌，这是一起听的房间里，不是在聊天里）';
const LIKE = s => s.hisLiked ? '这首已经在你的歌单里了。' : '如果你真心喜欢这首歌，想放进你自己的歌单，最后单独一行写 [喜欢: 是]；不喜欢就不用写。';
function where(s){
  const at = player.currentTime || 0, dur = isFinite(player.duration) ? player.duration : 0;
  let w = `现在放的是${about(s)}${s.album ? `（专辑《${s.album}》）` : ''}，放到 ${mmss(at)}${dur ? ' / ' + mmss(dur) : ''}`;
  if (hasLyrics(s.lrc)){ const k = lineAt(s.lrc.lines, at), l = s.lrc.lines[k]; if (l && l.text) w += `，正唱到「${l.text}」`; }
  return w + '。';
}
const TOLD = {
  start: (s, prevTitle) => `${IN_ROOM}${prevTitle ? `上一首《${prevTitle}》刚放完。` : ''}现在开始放${about(s)}${s.album ? `（专辑《${s.album}》）` : ''}，是你们这次在这里听的第${room.n}首。` +
    (hasLyrics(s.lrc) ? `开头几句歌词：「${s.lrc.lines.filter(l => l.text).slice(0, 3).map(l => l.text).join(' / ')}」。` : '') +
    `像坐在她旁边一起听歌时那样随口说一句，不超过三十个字；没什么想说的也可以不说。${LIKE(s)}`,
  lyric: (s, k) => { const ls = s.lrc.lines, l = ls[k], n = ls.slice(k + 1).find(x => x.text);
    return `${IN_ROOM}${about(s)}唱到了这一句：「${l.text}」${n ? `，下一句是「${n.text}」` : ''}。如果这句让你想到什么，随口说一句，不超过三十个字；也可以不说。${LIKE(s)}`; },
  her: (s, text) => `${IN_ROOM}她在一起听的房间里对你说：「${text}」。${s ? where(s) : '还没有放歌。'}像一起听歌时那样回她，一两句，不超过五十个字。${s ? LIKE(s) : ''}`,
};
function spoken(r){
  if (!r || r.noReply) return '';
  const core = M(), t = core.tidyCJK(String(r.text || '').replace(/\*[^*\n]+\*/g, '').replace(/\s*\n+\s*/g, ' ').trim());
  return core.dropFinalStop ? core.dropFinalStop(t) : t;
}
const likes = r => { const v = r && r.tags && r.tags['喜欢']; return !!v && !/不|否|no/i.test(v); };
function strip(who, text){ if (!room || !text) return; room.strip.push({ who, text, at: nowMs() }); if (room.strip.length > 40) room.strip.shift(); changed(); }
// one turn of his, one at a time; a comment of his own is skipped while another turn is still waiting
function ask(told, s, own){
  const r = room; if (!r) return Promise.resolve(null);
  if (own && r.pending) return Promise.resolve(null);
  r.pending++; changed();
  const job = r.chain.then(async () => {
    if (!r.s.open) return null;
    let got = null;
    try { got = await r.s.turn(told(), { max: 300, tags: ['喜欢'] }); }
    catch(e){ if (!own && r.ctx) r.ctx.toast(r.ctx.T('app.music.toast.noanswer')); return null; }
    const said = spoken(got);
    if (r === room && said) strip('him', said);
    if (s && likes(got)) await hisLike(s);
    return said;
  }).finally(() => { r.pending--; if (r === room) changed(); });
  r.chain = job.catch(() => null);
  return job;
}
function comment(kind, s){
  if (!room || !s) return null;
  const prevTitle = room.prev; room.prev = '';
  return ask(() => TOLD.start(s, prevTitle), s, true);
}
function lyricMoment(){
  const s = song();
  if (!room || !s || !playing() || !hasLyrics(s.lrc) || (s.said && s.said.lyric)) return;
  if (s.pick == null) s.pick = pickLine(s.lrc.lines);
  if (s.pick < 0 || lineAt(s.lrc.lines, player.currentTime || 0) !== s.pick) return;
  s.said = Object.assign({}, s.said, { lyric:true });
  const k = s.pick;
  ask(() => TOLD.lyric(s, k), s, true);
}
// her words in the room: they stay in the room, he answers there; both go into the event log so he remembers
async function say(text){
  text = clip(text, 200); if (!text || !room) return null;
  strip('her', text);
  const s = song();
  const said = await ask(() => TOLD.her(s, text), s, false);
  log('say', `在一起听里，她对你说「${clip(text, 60)}」` + (said ? `，你说「${clip(said, 60)}」` : ''), s ? { id: s.id } : undefined);
  return said;
}

// one line into the phone's event log: in the room through the session (its id on the entry), else straight
function log(what, line, detail, who){
  const e = { app: ID, title:'一起听', who: who || 'both', what, line, detail };
  if (room && room.s.open) return room.s.log(e).catch(err => console.error(err));
  if (!withId || (M().currentId || '') !== withId) return null;   // not with him now: what she plays alone is hers
  return M().logEvent(e).catch(err => console.error(err));
}

function state(){
  const s = song(), at = player.currentTime || 0, k = s && hasLyrics(s.lrc) ? lineAt(s.lrc.lines, at) : -1;
  return { title: s ? s.title : '', artist: s ? s.artist : '', album: s ? s.album : '', file: s ? s.file : '', playing: playing(), at, dur: isFinite(player.duration) ? player.duration : 0, refused,
    mode, index: now, length: queue.length, line: k >= 0 ? s.lrc.lines[k].text : '', lyrics: !!(s && hasLyrics(s.lrc)), herLiked: !!(s && s.herLiked), hisLiked: !!(s && s.hisLiked),
    with: withId, room: room ? { id: room.s.id, n: room.n, ms: room.ms, pending: room.pending, strip: room.strip.map(x => ({ who: x.who, text: x.text })) } : null };
}

// ---- the chat's ＋: she shares the song playing; she is in the chat already ----
async function share(ctx){
  const s = song(); if (!s) return null;
  if (!s.id) await heard(s);
  await M().appendToChat({ name: userName(), is_user:true, is_name:true, send_date: nowMs(), mes: ctx.T('app.music.chat', { title: s.title }), extra:{ modu_card:{ app: ID, type: MINE, id: s.id } } }, { announce:true });
  const core = M();
  try {
    // a message in the chat: his answer is a chat message too: the core's turn, then into the chat as his
    const r = core.parseReply((await core.turn(`（小手机里发生的事）她在聊天里把正在放的歌${about(s)}分享给你，想和你一起听。像平时发消息一样回她一两句。`, { max: 300 })).raw);
    const said = core.tidyCJK(r.text || '');
    if (said && !r.noReply){
      const his = { name: core.store.name, is_user:false, is_name:true, send_date: nowMs(), mes: said, extra:{ modu_emotion: r.emotion, modu_emotion_from: r.labelled ? 'model' : 'none' } };
      if (r.inner) his.extra.modu_inner = core.tidyCJK(r.inner);
      await core.appendToChat(his, { announce:true });
    }
  } catch(e){ ctx.toast(ctx.T('app.music.toast.noanswer')); }
}

// ---- the chat card: her song card; older cards point at records now on her phone (same ids) ----
async function card(msg, ctx){
  keep(ctx);
  const c = msg.extra && msg.extra.modu_card; if (!c || !c.id) return null;
  let r = null; try { r = (await mine().get(MINE, c.id)) || (await M().records.get(OLD, c.id)); } catch {}
  if (!r) return null;
  return { icon:'i-music', title: r.title, sub: r.artist || ctx.T('app.music.card.sub'), foot: ctx.T('app.music.label') };
}

// ---- the home widget ----
function widget(ctx){
  keep(ctx);
  const s = state();
  if (!song()) return { title: ctx.T('app.music.widget.none'), sub: ctx.T('app.music.widget.pick'), playing:false, at:0, dur:0 };
  return { title: s.title, sub: s.playing ? ctx.T('app.music.widget.on', { name: withName || M().store.name }) : ctx.T('app.music.widget.off'), playing: s.playing, pauseIcon:'i-music-pause', at: s.at, dur: s.dur };
}
async function widgetTap(what, ctx){
  keep(ctx);
  if (!song()) { ctx.go('app:music'); return; }
  if (what === 'play') return toggle();
  if (what === 'prev') return prev();
  if (what === 'next') return next(false);
}

// ---------------------------------------------------------------------------------------------------------
// The room (the screen)
const MODE_ICON = { all:'i-music-loop', one:'i-music-one', shuffle:'i-music-shuffle' };
function draw(el, ctx){
  const T = ctx.T, s = state(), cur = song(), name = withName || M().store.name;
  el.querySelector('.a-music-title').textContent = cur ? s.title : T('app.music.none');
  el.querySelector('.a-music-sub').textContent = cur ? [s.artist, s.album].filter(Boolean).join(' · ') : T('app.music.lead', { name });
  const mins = room ? Math.floor(room.ms / 60000) : 0;
  el.querySelector('.a-music-with').textContent = mins ? T('app.music.room.with.min', { name, m: mins }) : T('app.music.room.with', { name });
  const disc = el.querySelector('.a-music-disc');
  disc.classList.toggle('a-music-spin', s.playing);
  disc.style.backgroundImage = cur && cur.cover ? `url("${cur.cover}")` : '';
  disc.classList.toggle('a-music-has-cover', !!(cur && cur.cover));
  // the words: the line sung now, with the one before and the one after
  const ly = el.querySelector('.a-music-lyric');
  if (cur && hasLyrics(cur.lrc)){
    const k = lineAt(cur.lrc.lines, s.at), at = i => (cur.lrc.lines[i] || {}).text || '';
    ly.innerHTML = `<span>${esc(at(k - 1))}</span><b>${esc(k >= 0 ? at(k) : '')}</b><span>${esc(at(k + 1))}</span>`;
    ly.hidden = false;
  } else { ly.innerHTML = ''; ly.hidden = true; }
  el.querySelector('#mPlay use').setAttribute('href', s.playing ? '#i-music-pause' : '#i-play');
  for (const id of ['#mPlay', '#mPrev', '#mNext', '#mLike', '#mLrc']) el.querySelector(id).disabled = !cur;
  const m = el.querySelector('#mMode'); m.querySelector('use').setAttribute('href', '#' + MODE_ICON[mode]); m.setAttribute('aria-label', T('app.music.mode.' + mode)); m.title = T('app.music.mode.' + mode);
  const lk = el.querySelector('#mLike'); lk.classList.toggle('on', s.herLiked); lk.setAttribute('aria-pressed', String(s.herLiked));
  const his = el.querySelector('.a-music-his'); his.hidden = !s.hisLiked; his.textContent = T('app.music.his.like', { name });
  const bar = el.querySelector('#mBar'); bar.max = Math.max(1, Math.round(s.dur)); if (!bar.matches(':active')) bar.value = Math.round(s.at);
  el.querySelector('#mAt').textContent = mmss(s.at); el.querySelector('#mDur').textContent = mmss(s.dur);
  // the room's own strip: his words and hers, never in the chat
  const st = el.querySelector('#mStrip'), lines = room ? room.strip : [];
  const sig = lines.length + ':' + (room && room.pending) + ':' + (lines.length ? lines[lines.length - 1].at : 0);
  if (st.dataset.sig !== sig){
    st.dataset.sig = sig;
    st.innerHTML = (lines.length ? lines.map(x => `<div class="a-music-line ${x.who}"><small>${esc(x.who === 'him' ? name : T('app.music.me'))}</small><p>${esc(x.text)}</p></div>`).join('') : `<p class="a-music-empty">${esc(T('app.music.room.empty', { name }))}</p>`)
      + (room && room.pending ? `<div class="a-music-line him a-music-wait"><small>${esc(name)}</small><p>…</p></div>` : '');
    st.scrollTop = 1e9;
  }
  const q = el.querySelector('#mQueue'), qsig = queue.map(x => x.key).join('|') + '#' + now + '#' + queue.map(x => +x.herLiked + '' + +x.hisLiked).join('');
  if (q.dataset.sig !== qsig){
    q.dataset.sig = qsig;
    q.innerHTML = queue.length ? queue.map((x, i) => `<div class="opt a-music-q${i === now ? ' now' : ''}" data-qi="${i}"><span class="a-music-qt">${esc(x.title)}${x.artist ? `<small> · ${esc(x.artist)}</small>` : ''}</span><span class="val">${x.herLiked ? '♥' : ''}${x.hisLiked ? `<em>${esc(T('app.music.his.short'))}</em>` : ''}<button class="a-music-drop" data-qx="${i}" aria-label="${esc(T('app.music.queue.drop'))}">×</button></span></div>`).join('')
      : `<div class="opt"><span class="a-music-empty">${esc(T('app.music.queue.none'))}</span></div>`;
  }
}
async function drawHistory(el, ctx){
  const all = (await mine().list(MINE)).sort((a, b) => (b.last || b.at || 0) - (a.last || a.at || 0)), seen = new Set(), list = [];
  for (const r of all){ const k = r.file + ':' + (r.size || 0); if (seen.has(k)) continue; seen.add(k); list.push(r); if (list.length >= 20) break; }
  el.querySelector('#mHist').innerHTML = list.length ? list.map(r => `<div class="opt"><span class="a-music-qt">${esc(r.title)}${r.artist ? `<small> · ${esc(r.artist)}</small>` : ''}</span><span class="val">${r.liked ? '♥ ' : ''}${esc(r.date || '')}</span></div>`).join('') : `<div class="opt"><span class="a-music-empty">${esc(ctx.T('app.music.history.none'))}</span></div>`;
}
async function drawHis(el, ctx){
  let list = []; try { list = (await M().records.list(HIS)).reverse().slice(0, 30); } catch {}
  el.querySelector('#mHis').innerHTML = list.length ? list.map(r => `<div class="opt"><span class="a-music-qt">${esc(r.title)}${r.artist ? `<small> · ${esc(r.artist)}</small>` : ''}</span><span class="val">${esc(r.date || '')}</span></div>`).join('') : `<div class="opt"><span class="a-music-empty">${esc(ctx.T('app.music.his.none', { name: withName || M().store.name }))}</span></div>`;
}

function endRoom(r, T){
  if (!r) return;
  counting();
  if (room === r) room = null;
  lastHold = null;
  if (!r.n) { r.s.end(); return; }
  const min = Math.round(r.ms / 60000), time = min >= 1 ? T('app.music.card.min', { m: min }) : T('app.music.card.lessmin');
  // the log line (with the session's id), so in the chat afterwards he knows; and one neutral line in the chat.
  // Both now, in the unmount: the page ends the session right after it.
  r.s.log({ who:'both', what:'room', line: `你们在一起听里听了${r.n}首歌，${time}`, detail: { n: r.n, ms: Math.round(r.ms) } }).catch(e => console.error(e));
  r.s.end({ card: { line: T('app.music.card.end', { n: r.n, time }), type: 'room' } });
}

ModuApps.register({
  id: 'music', version: '0.2', icon: 'i-music', title: 'app.music', status: 'ready', css: true,
  scope: 'contact', surface: 'session',
  records: [HIS], myRecords: [MINE],
  // what it writes, held to it by static_check. `music` in his folder: only to
  // move older songs out of it, to her phone.
  writes: { records: ['songlist', 'music'], mine: ['music'], events: { play: '一起听歌', like: '♥ 一首歌', say: '在一起听里说话', room: '一起听了多久' }, chat: 'cards' },
  contactActions: [{ id: 'listen', title: 'app.music.with' }],
  invite: { kind: 'music', words: 'invite.music' },   // he may ask her to this (see app/core/reach.js)
  icons: {
    'i-music-pause': '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
    'i-music-heart': '<path d="M12 19.5s-7-4.3-7-9.6A3.9 3.9 0 0 1 12 7.6a3.9 3.9 0 0 1 7 2.3c0 5.3-7 9.6-7 9.6z"/>',
    'i-music-loop': '<path d="M5 11V9.5A2.5 2.5 0 0 1 7.5 7H18l-2.5-2.5M19 13v1.5a2.5 2.5 0 0 1-2.5 2.5H6l2.5 2.5"/>',
    'i-music-one': '<path d="M5 11V9.5A2.5 2.5 0 0 1 7.5 7H18l-2.5-2.5M19 13v1.5a2.5 2.5 0 0 1-2.5 2.5H6l2.5 2.5"/><path d="M11.2 10.6l1.3-.8v4.6"/>',
    'i-music-shuffle': '<path d="M4 7.5h2.5c4.5 0 6.5 9 11 9H20M4 16.5h2.5c1.4 0 2.5-.9 3.4-2.1M13.6 9.6c.9-1.2 2-2.1 3.4-2.1H20M18 5l2.5 2.5L18 10M18 14l2.5 2.5L18 19"/>',
    'i-music-lyric': '<path d="M5 7h14M5 12h10M5 17h7"/>',
  },
  mount(el, ctx){
    keep(ctx);
    const T = ctx.T;
    withId = (ctx.contact && ctx.contact.id) || M().currentId || ''; withName = (ctx.contact && ctx.contact.name) || M().store.name;
    const s = ctx.session.begin({ title: T('app.music') });
    const r = room = { s, ctx, n: playing() ? 1 : 0, ms: 0, tick: 0, strip: [], chain: Promise.resolve(), pending: 0, prev: '' };
    lastHold = null; hold();
    // his ♥ is his: the queue may come from a room with someone else
    for (const q of queue) hisHas(q.title, q.artist).then(v => { if (q.hisLiked !== v) { q.hisLiked = v; changed(); } });
    el.innerHTML = `<div class="pad-top"></div><div class="bar"><button class="back" data-go="home" aria-label="back"><svg class="ic"><use href="#i-back"/></svg></button><div class="title">${esc(T('app.music'))}</div></div>
      <div class="list a-music-body">
        <div class="group a-music-now"><div class="a-music-disc"></div><small class="a-music-with"></small><b class="a-music-title"></b><small class="a-music-sub"></small>
          <div class="a-music-lyric" hidden></div>
          <input type="range" id="mBar" min="0" max="1" value="0" step="1" aria-label="${esc(T('app.music.seek'))}"><div class="a-music-tt"><span id="mAt"></span><span id="mDur"></span></div>
          <div class="a-music-ctl">
            <button id="mMode"><svg class="ic"><use href="#i-music-loop"/></svg></button>
            <button id="mPrev" aria-label="${esc(T('app.music.prev'))}"><svg class="ic"><use href="#i-prev"/></svg></button>
            <button id="mPlay" class="a-music-play"><svg class="ic"><use href="#i-play"/></svg></button>
            <button id="mNext" aria-label="${esc(T('app.music.next'))}"><svg class="ic"><use href="#i-next"/></svg></button>
            <button id="mLike" class="a-music-heart" aria-label="${esc(T('app.music.like'))}" aria-pressed="false"><svg class="ic"><use href="#i-music-heart"/></svg></button></div>
          <small class="a-music-his" hidden></small>
          <input type="file" id="mFile" multiple class="a-music-file"><input type="file" id="mLrcFile" class="a-music-file"></div>
        <div class="a-music-two"><button class="btn" id="mPick2">${esc(T('app.music.pick'))}</button><button class="a-music-lrcbtn" id="mLrc"><svg class="ic"><use href="#i-music-lyric"/></svg>${esc(T('app.music.lyrics.add'))}</button></div>
        <div class="gtitle">${esc(T('app.music.room'))}</div>
        <div class="group a-music-room"><div class="a-music-strip" id="mStrip"></div>
          <div class="a-music-say"><input id="mSay" maxlength="200" enterkeyhint="send" placeholder="${esc(T('app.music.say.placeholder', { name: withName }))}"><button id="mSend">${esc(T('app.music.say'))}</button></div></div>
        <div class="gtitle">${esc(T('app.music.queue'))}</div><div class="group" id="mQueue"></div>
        <div class="gtitle">${esc(T('app.music.history'))}</div><div class="group" id="mHist"></div>
        <div class="gtitle">${esc(T('app.music.his', { name: withName }))}</div><div class="group" id="mHis"></div>
        <div class="foot">${esc(T('app.music.foot', { name: withName }))}</div></div>`;
    const $ = q => el.querySelector(q);
    const file = $('#mFile'), lrcFile = $('#mLrcFile');
    $('#mPick2').onclick = () => file.click();
    $('#mLrc').onclick = () => lrcFile.click();
    file.onchange = async () => { const fs = file.files ? [...file.files] : []; file.value = ''; if (!fs.length) return;
      // a file that is not a song is said in the same line as what plays (one toast, so neither hides the other)
      const odd = fs.filter(f => !isLrc(f) && !isSong(f)), oddLine = odd.length ? T('app.music.toast.notsong', { file: odd[0].name || '' }) : '';
      const was = queue.length, got = await choose(fs);
      const line = got && got.length ? (was && got[0] !== song() ? T('app.music.toast.queued', { n: got.length }) : T('app.music.toast.playing', { title: song().title })) : '';
      if (line || oddLine) ctx.toast([line, oddLine].filter(Boolean).join('；')); };
    lrcFile.onchange = async () => { const f = lrcFile.files && lrcFile.files[0]; lrcFile.value = ''; if (f) ctx.toast(T(isLrc(f) && (await addLyrics(f)) ? 'app.music.toast.lyrics' : 'app.music.toast.nolyrics')); };   // only .lrc / .txt is read
    $('#mPlay').onclick = () => toggle();
    $('#mPrev').onclick = () => prev();
    $('#mNext').onclick = () => next(false);
    $('#mMode').onclick = () => { ctx.toast(T('app.music.mode.' + setMode())); };
    $('#mLike').onclick = () => like();
    $('#mBar').oninput = e => { if (song()) player.currentTime = Number(e.target.value) || 0; };
    const send = () => { const i = $('#mSay'), t = i.value.trim(); if (!t) { i.focus(); return; } i.value = ''; say(t); };
    $('#mSend').onclick = send;
    $('#mSay').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send(); } };
    $('#mQueue').onclick = e => { const x = e.target.closest('[data-qx]'); if (x) { e.stopPropagation(); drop(Number(x.dataset.qx)); return; } const q = e.target.closest('[data-qi]'); if (q) jump(Number(q.dataset.qi)); };
    const redraw = () => draw(el, ctx);
    listeners.add(redraw); redraw();
    const lists = () => { drawHistory(el, ctx).catch(e => console.error(e)); drawHis(el, ctx).catch(e => console.error(e)); };
    moveOld().catch(e => console.error(e)).then(lists);
    const off = M().on((ev, d) => { if (ev === 'records' && (d.type === MINE || d.type === HIS)) lists(); });
    // leaving the room: the song keeps playing; the session ends with one neutral line
    return () => { listeners.delete(redraw); off(); endRoom(r, T); };
  },
  card, widget, widgetTap,
  // the chat's ＋: share the song that is playing; no song yet: open the room to pick one
  chatActions: [{ id:'share', icon:'i-music', title:'app.music.label' }],
  chatAction(id, ctx){ keep(ctx); if (id !== 'share') return; if (song()) return share(ctx); ctx.go('app:music'); },
  api: { choose, addLyrics, toggle, next, prev, jump, drop, setMode, like, say, state, share, playing, mute(on){ player.muted = !!on; return player.muted; },
    readTags, readID3, readID3v1, readFLAC, fromName, parseLRC, lineAt, pickLine, moveOld },
});
addBlock();
})();
