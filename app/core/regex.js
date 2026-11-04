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
