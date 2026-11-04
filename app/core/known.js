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
