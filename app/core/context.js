// app/core/context.js: context assembly: the named blocks that are the only way anything reaches his prompt.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { store, fit, clip, msgDate, isoDay, band, clockIn, gapWords, now, cardLore, loreEntries, loreSelect, loreWhen, lunarDate, solarTerm, EMOTIONS, splitBubbles,
  chatStops, dropNames, pronouns, lifeKey, lifeLines, eventLines, knownLines, personaState, activityLines, chatCardKind } = core;

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
// these notes say what the pattern is, never his lines again. Quoted ("do not
// remind her again: 「…」"), his own words were back in his prompt every turn and the same reminder kept coming (Haiku
// persona runs: the same reminder in 6 of the last 7 replies while it was listed). A model told to leave out a named thing tends to bring
// it up (the "pink elephant" problem, Castricato et al. 2024, arXiv 2402.07896), and the more often a line is in the context,
// the likelier it comes again (Xu et al. 2022). Same rule as the day block: point at it, never quote it back.
// A last line that hands the turn back to her: a question, or advice / an instruction to her (去吧, 别…, 先…, 记得…, 早点…)
const HANDBACK = /[？?]\s*$|^(去吧|快去|先去|你先|你去|你慢慢|慢慢来|先(?![前后])|不要|记得|早点|早些|多(喝|穿|吃|睡|休息)|少(喝|吃|熬)|赶紧|该)|^你.{0,8}(再|先|就|去)|(?<![特区分告识级派])别(?![人的])|别忘|告诉我|跟我说|发我/;
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
const lastLine = m => { const ls = splitBubbles(String(m.mes).replace(/\*[^*\n]*\*/g, ' ')).map(l => l.trim()).filter(Boolean); return ls[ls.length - 1] || ''; };
// what the chat itself shows this turn, for a preset block's `modu_when`. The core only names the signal; the words are the preset's.
// handed_back: one of his last two replies ended on her (a question, advice, a reminder). Modu's default preset does not use it:
// its ending line goes in on every turn. The signal stays for a preset that wants a line only after he has done it.
function chatSignals(msgs){
  const his = (msgs || []).filter(m => !m.is_user && !m.is_system && m.mes).slice(-2);
  return { handed_back: his.some(m => HANDBACK.test(lastLine(m))) };
}
const signalled = (b, ctx) => !b.when || !!chatSignals(ctx.allMsgs)[b.when];
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
  if (said.length) notes.push(`You already reminded her of things in your last few replies (${said.length > 1 ? said.length + ' times' : 'once'}); no reminder or advice this time, not even in other words.`);
  const again = echoes(msgs);
  // what he already told her on this in the last few days, so he does not say it again word for word
  const before = saidBefore(msgs);
  if (before.length) notes.push(`You already told her about this in the last few days (it is in the chat above): add something new, or keep it short; never the same words again.`);
  if (again.length) notes.push(`${again.length > 1 ? 'Some things' : 'One thing'} you said keep${again.length > 1 ? '' : 's'} coming back in your recent replies: this time talk about something else, or about what she just said; do not bring up the same shared moments again as proof that you remember (pet names and your usual way of talking are fine).`);
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
      const P = core.presetLayer ? core.presetLayer() : null, blocks = P && P.preset ? P.preset.blocks.filter(b => b.on && !b.after && signalled(b, ctx)) : [];
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
        let content = m.is_user || ctx.opts.bubbles === false ? m.mes : chatStops(dropNames(m.mes, store.name));   // a head left in his past lines would teach it back
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
  if (ids.includes('preset') && core.presetLayer){ const P = core.presetLayer(), after = P && P.preset ? P.preset.blocks.filter(b => b.on && b.after && signalled(b, ctx)) : []; if (after.length) messages.push({ role:'system', content: after.map(b => fillNames(b.text, ctx)).join('\n') }); }
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

Object.assign(core, { chatSignals, LANG_NAME, chatLanguage, herPronouns, CONTEXT_BUDGET, modelTuning, contextBlocks, setContextBlock,
  resetContextBlocks, buildContext, assemble });
})(globalThis[Symbol.for('modu.core')]);
