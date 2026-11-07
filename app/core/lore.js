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
    // a V2 character_book keeps these in `extensions` in snake_case (prevent_recursion, group_override, use_probability),
    // a world-info file on the entry in camelCase. Only camelCase was read, so a traded card's recursion, group and chance
    // settings were silently ignored: an author's "prevent recursion" on every entry still recursed. Both names now
    const snake = k => k.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
    const x = e.extensions || {}, pick = k => [x[k], x[snake(k)], e[k], e[snake(k)]].find(v => v !== undefined);
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
