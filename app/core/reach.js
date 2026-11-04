// app/core/reach.js: 主动: when he writes first, kept promises, [next] and [no-reply], invites (the peek notice is the page's).
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, now, store, clone, param, jobs, bell, records, msgDate, gapWords, isoDay, personaState, parseReply,
  tidyCJK, buildContext, appendToChat, writeChat, addChatCard, prompt, sideCall, loadReach, paused, noticeRules, pronouns, ticker,
  setContextBlock, contextBlocks, dayStatus } = core;

// Everything here rides on the one clock (clock.after) and on jobs owned by 'core'. Nothing writes to her unless
// every one of her limits allows it, and the decider's usual answer is "leave it". The rules, in order:
//   her limits  on/off, her daily cap (default 2; a knob can never raise it), a gap between two of his first
//               messages, quiet hours, a back-off after a failed call, never chasing twice in a row; 暂停 stops all.
//   triggers    real ones only: his status changes (a slot of his day), a long silence crosses a mark, a job comes
//               due. Each costs at most one decider call, ≤ 4 a day.
//   tags        [promise: …] → a force job that keeps it; [next: N] → a job re-checked by the decider when due;
//               [no-reply] → her message marked read, and a reply-later job.
//   asleep      her message while he is asleep gets no reply now: delivered, not read, and a reply-later job
//               at his wake (or, by replies.asleep, a few minutes later: she woke him), through quiet hours and 暂停.
//               a held message is always answered: the job never expires; at his wake if the page is open,
//               else the next time she opens it (dated then); a held message with no live job gets one on the next look.
//   catch-up    jobs due while the page was shut arrive in order, dated when they were due, at most the flood cap
//               of them; the expired ones are dropped and logged, never replayed. And after a day or more away:
//               one message for the time away, at a moment inside it (outside her quiet hours, while he was up,
//               within her cap), dated then; always exactly one, with no decider call (one call, so it is
//               there sooner). It runs before the job round (clock.before), so it looks before she has written.
//   invites     he may ask her into an app, with no closeness gate. The peek notice is an app's rule: the page's.
// What happened (and every skip, with its reason) is kept in one record of his, reach/state.json.
const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const MSG_KINDS = ['reach', 'promise', 'next', 'reply-later'];
const knob = (name, fallback) => { const v = param(name, fallback); return v == null ? fallback : v; };
const rnd = { fn: Math.random };
const R = () => rnd.fn();
const pad = n => String(n).padStart(2, '0');
const hm = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const minuteOf = t => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); };
const dayOf = t => isoDay(new Date(t));
const endOfDay = t => { const d = new Date(t); d.setHours(23, 59, 59, 0); return d.getTime(); };
const herName = () => { const u = core.userName(); return u !== 'You' ? u : 'her'; };   // her own name, from 聊天设置 too
const WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const clockWords = t => { const d = new Date(t); return `${WEEK[d.getDay()]} ${dayOf(t)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
// every prompt of his first move knows the hour and where he is in his own day (no sun at night)
function partOfDay(t){ const h = new Date(t).getHours(); return h < 5 ? 'the middle of the night, dark outside' : h < 9 ? 'early morning' : h < 11 ? 'morning' : h < 13 ? 'around noon' : h < 17 ? 'afternoon' : h < 19 ? 'early evening' : h < 23 ? 'night, dark outside' : 'late at night, dark outside'; }
// his slot at time t, in words, from his own day (setDayPlan, app/life.js), or '' with no day
function statusAt(t){
  let s = null; try { s = dayStatus ? dayStatus(new Date(t)) : null; } catch { s = null; }
  if (!s) return '';
  if (s.presence === 'asleep') return 'asleep';
  return [s.what || '', s.where ? `at ${s.where}` : '', s.busy ? '(busy, little time to talk)' : ''].filter(Boolean).join(' ');
}
// what is still open from her side: open threads in his memory (memory-engine), and what she said she would do
// in the last three days (her own words, before the memory job has read them)
const PLAN = /明天|今晚|晚上|待会|一会|等下|下午|周[一二三四五六日末]|要去|准备|打算|考试|比赛|面试|出差|答辩|体检|见面|旅游|旅行|出去玩|回老家|去[^\s，。！？,.!?]{1,6}(玩|几天|[一两二三四五六七]天|一趟|一周)|deadline|tomorrow|tonight|exam|interview|match|trip|travel/i;
function herThreads(t, o = {}){
  const out = [];
  for (const m of (store.memory || []).filter(m => m && Array.isArray(m.threads) && m.threads.length && !m.closed).slice(-2)) out.push(m.threads.join('; '));
  if (o.memoryOnly) return out;
  const hers = chatMsgs().filter(m => m.is_user && t - tOf(m) < 3 * DAY && t - tOf(m) > 0 && PLAN.test(String(m.mes || ''))).slice(-2);
  for (const m of hers) out.push(`she said (${clockWords(tOf(m))}): "${String(m.mes).replace(/\s+/g, ' ').slice(0, 80)}"`);
  return out;
}
const lastLines = (n = 8) => chatMsgs().slice(-n).map(m => `[${clockWords(tOf(m))}] ${m.is_user ? herName() : store.name}: ${String(m.mes || '').replace(/\s+/g, ' ').slice(0, 120)}`).join('\n');

// --- his record: reach/state.json ------------------------------------------------------------------------------
const TYPE = 'reach';
let st = null, stFor = '';
// peek: the page's peek-notice counters were once kept here; an old record keeps the field, read once by the page
const blank = () => ({ v: 1, id: 'state', at: 0, days: {}, lastSent: 0, skips: [], invites: [], missed: [], ignored: {}, declinedDay: '', backoff: { until: 0, n: 0 }, marks: {}, status: '' });
async function load(fresh){
  const key = (core.currentId || '') + '|' + (store.name || '');
  if (st && stFor === key && !fresh) return st;
  let r = null; try { r = await records.get(TYPE, 'state'); } catch {}
  st = Object.assign(blank(), r || {}); stFor = key; return st;
}
let saving = Promise.resolve();
function save(){
  if (!st || !store.name) return saving;
  const rec = Object.assign({}, st, { at: now().getTime() }); delete rec.rev;
  rec.skips = rec.skips.slice(-100); rec.invites = rec.invites.slice(-40);
  for (const k of Object.keys(rec.days)) if (k < dayOf(now().getTime() - 14 * DAY)) delete rec.days[k];
  saving = saving.then(() => records.commit(TYPE, rec, { writer: 'core', app: 'reach' })).then(r => { if (r && r.record) st.rev = r.record.rev; }).catch(e => console.error(e));
  return saving;
}
const today = t => { const d = dayOf(t), o = st.days[d] || (st.days[d] = { sent: 0, decided: 0, invites: 0, reads: 0 }); if (o.promises == null) o.promises = 0; return o; };
function skip(why, what, t, note){
  const e = { at: t || now().getTime(), why: String(why), what: String(what || '') }; if (note) e.note = String(note).slice(0, 80);   // note: the decider's own few words, for the log
  st.skips.push(e); emit('reach', { op: 'skip', skip: e });
  return e;
}

// --- her limits -------------------------------------------------------------------------------------------------
function quietRange(){ const q = knob('initiative.quiet_hours', ['00:30', '08:00']); return Array.isArray(q) && q.length === 2 ? q.map(hm) : [null, null]; }
function inQuiet(t){
  const [a, b] = quietRange(); if (a == null || b == null || a === b) return false;
  const m = minuteOf(t); return a < b ? m >= a && m < b : m >= a || m < b;
}
function quietEnd(t){
  const b = quietRange()[1]; if (b == null) return t;
  const d = new Date(t); d.setHours(Math.floor(b / 60), b % 60, 0, 0); let e = d.getTime(); if (e <= t) e += DAY; return e;
}
// her cap: her own number (setHer, a ceiling over every knob), or his knob; each end of initiative.per_day too
function cap(){
  const r = loadReach(); if (r.on === false) return 0;
  const c = Number(knob('initiative.default_cap', 2)), pd = knob('initiative.per_day', null);
  const hi = Array.isArray(pd) && Number.isFinite(Number(pd[1])) ? Number(pd[1]) : Infinity;
  return Math.max(0, Math.min(Number.isFinite(c) ? c : 2, hi));
}
const chatMsgs = () => (store.msgs || []).filter(m => !m.is_system);
const lastMsg = () => { const a = chatMsgs(); return a[a.length - 1] || null; };
const tOf = m => { const d = m && msgDate(m); return d ? d.getTime() : 0; };
// → '' when he may write first now, else the reason. o.force: a kept promise or a late reply (not his own first
// move): over the cap and with 主动 off it may still come, never in quiet hours and never while 暂停 is on.
function limits(t, o = {}){
  if (paused()) return 'paused';
  if (inQuiet(t)) return 'quiet';
  if (o.force) return '';
  if (loadReach().on === false) return 'off';
  if (st.backoff.until > t) return 'backoff';
  if (today(t).sent >= cap()) return 'cap';
  if (st.lastSent && t - st.lastSent < Number(knob('initiative.min_gap_min', 120)) * MIN) return 'gap';
  const last = lastMsg();
  if (knob('initiative.never_chase_twice', true) !== false && last && !last.is_user && last.extra && last.extra.modu_reach) return 'chase';
  if (last && last.is_user && last.extra && last.extra.modu_asleep && !last.extra.modu_read) return 'waiting';   // his reply to it is booked for his wake
  const ps = personaState(); if (ps.presence === 'asleep') return 'asleep';
  return '';
}

// --- writing to her ---------------------------------------------------------------------------------------------
// The words of every message of his first are side-call prompts, app/prompts/reach*.txt (read with
// prompt(name, vars)); the same words stay here as each file's fallback (prompts.fallback), so a missing file changes nothing.
const TOLD = {
  // his first message, because of something in his own day
  reach: 'Nobody asked you anything: you are writing to {{user}} first, because of something in your own day{{why}}. It is {{now}}, {{part}}{{status}}. Write one short message, the way you would really text her now, from where you are. Never a check-in, never about the silence itself, never a reproach.',
  // what the chat already holds stays held: he never asks for what he heard, never greets her as if she came in
  'reach-keep': 'The chat above is what you two really said; its last lines:\n{{last_lines}}\nNever ask her for something she already told you there, never ask again what you already asked, and never greet her as if she just arrived (no 来啦 / 回来啦 / 你来了): she has not written. Say only what fits the hour. Do not describe anything of your day that has not happened yet.',
  'reach-threads': 'Still open from her side (you may ask how one of them is going or went, if it fits; at most one, never as a list): {{threads}}',
  // the one message of a time away: written as of a moment inside it, dated then
  'reach-away': 'Nobody asked you anything: you are writing to {{user}} first, at a moment while she was away. It is {{now}}, {{part}}{{status}}. She has not written since {{since}}; if she told you what she would be doing, you know where she is, else you do not know why. Write the one short message you would have sent her then, because of something in your own day or something she told you she would be doing: never about the silence itself, never "where are you", never a reproach, never a greeting, and nothing that happens after that moment.',
  // she told him where she would be: the one message picks up her thread, not only his own day
  'reach-away-plans': 'Before she went quiet she told you: {{plans}}. Your message picks that up, as of this moment: how it is going, whether she got there, something about it you thought of. In your own words, with a little of your own day if it fits; never ask what she already told you.',
  'reach-away-mood': 'Since she went quiet you have been feeling {{mood}}; let it show a little in how you write, never as a reproach and never named outright.',
  'reach-promise': 'Earlier you told her: "{{text}}". Now is the time you meant. Keep that promise in one short message, naturally, as a text to her.',
  // her messages that came while he slept, answered on waking (or, by replies.asleep, they woke him)
  'reach-wake': 'She wrote to you while you were asleep; you have just woken up and are reading it now. Answer her briefly and naturally, as you would on waking; you may say you were asleep, without apologising for it.',
  'reach-woken': 'Her message woke you just now; you were asleep. Answer her briefly and naturally, still a little sleepy, the way you would from bed. Do not pretend you were up.',
  // her held message answered only now, because the page was shut when he woke: dated now, and honest about it
  'reach-late': 'She wrote to you on {{sent}} while you were asleep, and you are only answering it now ({{now}}, {{later}} later). Answer her now, briefly and naturally, from where you are in your own day; do not pretend it just arrived, and if it fits say in a few words why it took you so long, without a long apology.',
  'reach-reply': 'Earlier you read her last message and did not answer then, because of your own day. Now answer it, briefly and naturally; you may say in passing what kept you, without over-apologising.',
  'reach-pay': 'You would like to offer to pay for something she was just looking at ({{title}}): {{words}}. Write one short line offering it, in your own voice, as a small surprise, never a bill and never a favour she owes. Offer, never press. Do not mention apps or buttons.',
  'reach-invite': 'You would like to ask her to do one thing with you on the phone ({{title}}): {{words}}. Write one short line asking, in your own voice, tied to something specific from today (what you are doing, or something she said). Offer, never press: "要不要", never "快来". Do not mention apps or buttons.',
  // the decider's {{trigger}}, one line per trigger; he cannot know she opened the phone (that word made him greet
  // her with 来啦): only time and his own day
  'reach-triggers': ['slot: your own day moved on', 'gap: a quiet stretch went by', 'idle: the chat went quiet a while ago; your day goes on', 'open: a few hours went by since you last talked', 'next: earlier you said you would write again about now', 'due: something you planned is due',
    'away: she has not been around for a while; this is a moment inside that time, and one short message from your own day would be natural now', 'after: she was just looking at something on her phone'].join('\n'),
};
for (const [k, v] of Object.entries(TOLD)) core.prompts.fallback(k, v);
const atWords = t => ({ now: clockWords(t), part: partOfDay(t), status: statusAt(t) ? `; you are ${statusAt(t)}` : '' });
const keepRule = () => prompt('reach-keep', { last_lines: lastLines() || '(nothing yet)' });
const threadsLine = async (t, o) => { const th = herThreads(t, o); return th.length ? prompt('reach-threads', { threads: th.join(' / ') }) : ''; };
const joined = async parts => (await Promise.all(parts)).filter(Boolean).join('\n');
// what she said she would do in her last two days before she went quiet (her trip to 成都, her exam), her own words;
// not what she asked of him (明天早上八点叫我: his promise kept that)
const herPlans = since => chatMsgs().filter(m => m.is_user && tOf(m) <= since && since - tOf(m) < 2 * DAY && PLAN.test(String(m.mes || '')) && !asksAt(String(m.mes || ''))).slice(-2).map(m => String(m.mes).replace(/\s+/g, ' ').slice(0, 80));
const reachTold = (why, t) => joined([prompt('reach', Object.assign({ user: herName(), why: why ? ` (${why})` : '' }, atWords(t))), keepRule(), threadsLine(t)]);
// what is still open from her side (her trip, her exam) is in it, and his card's away mood (params away)
// as of that moment colours it
const awayTold = (at, since, o = {}) => joined([prompt('reach-away', Object.assign({ user: herName(), since: clockWords(since) }, atWords(at))),
  (o.plans || []).length ? prompt('reach-away-plans', { plans: o.plans.map(p => `"${p}"`).join(' / ') }) : '',
  o.mood ? prompt('reach-away-mood', { mood: o.mood }) : '', keepRule(), threadsLine(at, { memoryOnly: (o.plans || []).length > 0 })]);
const promiseTold = text => prompt('reach-promise', { text });
const wakeTold = woken => prompt(woken ? 'reach-woken' : 'reach-wake', {});
const lateTold = (sent, t) => prompt('reach-late', { sent: clockWords(sent), now: clockWords(t), later: (t - sent) < 2 * DAY ? `${Math.round((t - sent) / HOUR)} hours` : `${Math.round((t - sent) / DAY)} days` });
const replyTold = () => prompt('reach-reply', {});
const payTold = (words, title) => prompt('reach-pay', { words, title });
const inviteTold = (words, title) => prompt('reach-invite', { words, title });
// one message of his into the chat, through the counted door (sideCall, his own chat model). The time is the job's
// true time (o.at), never before a message already in the chat. → the message, or null (nothing to say).
async function say(told, o = {}){
  const settings = core.currentSettings(), t = now().getTime();
  // his day as seen at the message's own moment (a catch-up dated inside a time away, a job run late): the
  // context blocks read ctx.opts.at, so no slot that had not begun then is in the prompt
  const built = buildContext({ userName: core.userName(), settings, at: Math.min(Number(o.at) || t, t) });
  let raw;
  // his reply to a message of hers (reply-later: on waking, or one he let sit) is counted as a chat turn (用量: 聊天)
  try { raw = await sideCall(o.call || o.kind || 'reach', built.messages.concat([{ role: 'system', content: told }]), { chat: true, turn: o.kind === 'reply-later', max: 400, settings }); }
  catch(e){ if (e && e.code === 'paused') throw e; st.backoff = { n: st.backoff.n + 1, until: t + Math.min(6 * HOUR, 30 * MIN * Math.pow(2, st.backoff.n)) }; skip('failed', o.kind, t); await save(); throw e; }
  st.backoff = { until: 0, n: 0 };
  const r = parseReply(raw), text = tidyCJK(r.text || '');
  if (!text || r.noReply){ skip('empty', o.kind, t); return null; }
  let due = Number(o.at) || t; if (due < t && inQuiet(due) && !o.asked) due = Math.min(quietEnd(due), t);   // a catch-up is never dated inside her quiet hours (but what she asked for is)
  if (o.since != null && tOf(lastMsg()) !== o.since){ skip('answered', o.kind, t); return null; }   // she wrote while he was deciding: the moment has gone
  const at = Math.max(due, tOf(lastMsg()) + 1);
  const m = { name: store.name, is_user: false, is_name: true, send_date: at, mes: text,
    extra: { modu_emotion: r.emotion, modu_emotion_from: r.labelled ? 'model' : 'none', modu_reach: Object.assign({ kind: o.kind || 'reach' }, o.why ? { why: String(o.why).slice(0, 80) } : {}, o.job ? { job: o.job } : {}) } };
  // the body glance: one cue on the body seam just before a message of his goes, so a face or a device
  // may look at the phone first. A catch-up after time away (a message dated well before now) does not glance.
  if (t - at < 2 * ticker.BEAT) core.publish({ type: 'glance', from: 'phone', kind: o.kind || 'reach', at: t });
  await appendToChat(m, { announce: true });
  core.updatePresence();   // the labels move at once (he wrote, so he is up), not on the next beat
  if (o.count !== false){ today(t).sent++; st.lastSent = t; if (dayOf(at) !== dayOf(t)) today(at).sent++; }   // a message dated in a day away counts on that day too
  await bookTags({ promises: [], nextContact: r.nextContact }, at);   // his own 主动 books [next] only: no promise chain past her cap
  if (loadReach().notices) bell.ring({ title: store.name, line: text.replace(/\s+/g, ' ').slice(0, 60), app: 'chat', job: o.job || '', tag: 'modu-reach' }).catch(() => {});
  emit('reach', { op: 'sent', kind: o.kind || 'reach', at });
  return clone(m);
}

// --- the reply tags ---------------------------------------------------------------------------------------------
const CN = { 零: 0, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const num = s => { if (/^\d+(\.\d+)?$/.test(s)) return Number(s); if (s === '十') return 10; const m = /^([一二两三四五六七八九])?十([一二三四五六七八九])?$/.exec(s); if (m) return (m[1] ? CN[m[1]] : 1) * 10 + (m[2] ? CN[m[2]] : 0); return CN[s] != null ? CN[s] : null; };
// when a promise means, from its own words ("两小时后告诉你", "晚上给你打电话", "in 20 minutes"); else in an hour.
// a promise tied to his own day ("出门前说一声", "到了告诉你", "忙完找你") is due when that slot of his day
// begins or ends (slots: today's day record, app/life.js), not an hour after it was made
// a clock time in it ("晚上九点", "21:00", "九点半", "9pm") is the time, the next one after t (晚上/下午 make it
// the evening's; 明天 the next day's); a promise with no time of its own ("我会到") takes the clock time she named in her
// message just before (hers), so a promise for the 21:00 she named is due at 21:00, not in an hour
function promiseAt(text, t, slots, hers){
  const s = String(text || ''); let m;
  if ((m = /([\d.]+|[一二两三四五六七八九十]+)\s*(分钟|分|小时|个小时|钟头|minutes?|mins?|hours?|h)(?![点:：])/i.exec(s)) && !/[点:：]/.test(s.slice(Math.max(0, m.index - 1), m.index))){ const n = num(m[1]); if (n != null) return t + Math.round(n * (/分|min/i.test(m[2]) ? MIN : HOUR)); }
  const own = clockAt(s, t);
  // a time of his with no day or part of day of its own ("七点五十准时") is read next to the time she asked
  // for ("明天早上八点叫我"): the same clock time nearest hers (within 3 hours), so it is tomorrow morning, not tonight
  if (own != null && hers && !DAYPART.test(s)){
    const named = clockAt(hers, t); let best = own;
    if (named != null) for (let k = -2; k <= 2; k++){ const c = own + k * 12 * HOUR; if (c > t && Math.abs(c - named) < Math.abs(best - named)) best = c; }
    if (named != null && Math.abs(best - named) <= 3 * HOUR) return best;
  }
  if (own != null) return own;
  if (/半小时|half an hour/i.test(s)) return t + 30 * MIN;
  const ahead = (slots || []).filter(x => x && x.at > t).sort((a, b) => a.at - b.at), cur = (slots || []).filter(x => x && x.at <= t && (!x.until || t < x.until)).pop();
  const moves = ahead.filter(x => !cur || x.where !== cur.where);
  if (/出门|出发|走之前|走前|动身|上班前|去.{0,8}之?前|before (i|you)? ?(go|leave|head)/i.test(s) && moves.length) return Math.max(t + 5 * MIN, moves[0].at - 10 * MIN);
  if (/到了|到家|到地方|到那|when i (get|arrive)|once i'?m there/i.test(s) && moves.length) return Math.max(t + 5 * MIN, moves[0].at + 15 * MIN);
  if (/忙完|下班|收工|结束|弄完|干完|after work|when i'?m done|finish/i.test(s) && cur){ const end = cur.until || (ahead[0] && ahead[0].at); if (end && end > t) return end + 5 * MIN; }
  if (/一会|待会|等下|等会|马上|soon|in a bit/i.test(s)) return t + 20 * MIN;
  const at = (h, plus) => { const d = new Date(t + (plus || 0)); d.setHours(h, 0, 0, 0); return d.getTime(); };
  if (/明天|明早|tomorrow/i.test(s)) return at(/晚|evening|night/i.test(s) ? 20 : /下午|afternoon/.test(s) ? 15 : 9, DAY);
  if (/晚上|今晚|tonight|evening/i.test(s)){ const e = at(20); return e > t ? e : t + HOUR; }
  if (/下午|afternoon/i.test(s)){ const e = at(15); return e > t ? e : t + HOUR; }
  const named = hers ? clockAt(hers, t) : null; if (named != null && named - t <= DAY) return named;
  return t + HOUR;
}
const DAYPART = /明天|明早|明晚|今天|今晚|今早|早上|早晨|上午|中午|下午|傍晚|晚上|凌晨|半夜|夜里|tomorrow|tonight|today|morning|afternoon|evening|\b(am|pm)\b/i;
// her message asks him to do something for her at a time (叫我 / 提醒我 / 来接我 at 八点): a promise he makes
// in answer is hers too, so it comes at its time even inside her quiet hours (her own request beats them), and when his
// reply has no [promise] tag but agrees to it, the promise is booked all the same (a model that forgets the tag)
const ASKS = /叫我|喊我|叫醒|提醒我|打给我|给我打|打电话给我|来接我|接我|陪我|找我|call me|wake me|remind me|text me|pick me up/i;
// a request for something ahead: never one about the past (昨天八点你都没来接我) or a question back (你找我干嘛)
const asksAt = hers => !!hers && ASKS.test(hers) && !/昨天|前天|上次|刚才|刚刚|都没|没来|没叫|干嘛|为什么/.test(hers) && clockAt(hers, 0) != null;
const REFUSE = /不行|不要|不能|没法|做不到|办不到|不了|算了|恐怕|不好意思|对不起|抱歉|可能|来不及|出门了|sorry|can'?t|cannot|won'?t|not able/i;
// a whole yes: a line that is one (好呀 / 行 / 嗯嗯 / ok), or says 准时 / 一定 / 放心 / 没问题; never 好累, 还行, 不好意思
const AGREE = /^(好+[呀啊的吧嘞哒呢~～！!。]*|好的|行+[吧啊]?|可以[呀啊的]?|嗯+[嗯呢]*|ok(ay)?|sure|will do)$|准时|一定|放心|没问题|包在我身上|记住了|收到/i;
const NEAR = 60 * MIN;   // a time of his counts as hers within an hour of it (七点五十 for 八点)
// → [promise text] for his reply (no tag of his own) that really agrees to her request for a time ahead, else []: his line with a
// time when that time is within an hour of hers ("七点五十准时"), else her own request (its time)
function implied(mes, hers, t){
  if (!asksAt(hers)) return [];
  const lines = String(mes || '').split(/\n+/).map(x => x.trim()).filter(Boolean), named = clockAt(hers, t);
  if (!lines.length || named == null || lines.some(l => REFUSE.test(l))) return [];
  const timed = lines.find(l => clockAt(l, t) != null && Math.abs(promiseAt(l, t, null, hers) - named) <= NEAR);
  if (!timed && !lines.some(l => AGREE.test(l.replace(/[\s，,]+$/, '')))) return [];
  return [(timed || String(hers)).slice(0, 200)];
}
// → ms of the clock time the words name, the next one after t, or null. "一点" alone is "a little", never one o'clock.
const FOR_HIM = /你|来接|接我|找我|叫我|陪我|给我|提醒我|等我|call me|text me|pick me|wake me|remind me|\byou\b/i;
// the minutes may be words or bare digits ("七点五十", "八点零五", "7点50"), not only with 分
const CLOCK = /(\d{1,2})\s*[:：]\s*(\d{2})|(\d{1,2}|十[一二]?|[一二两三四五六七八九十])\s*点\s*(半|一刻|三刻|(\d{1,2})\s*分|(\d{2})(?![\d天个号日周])|([二三四五]?十[一二三四五六七八九]?|零[一二三四五六七八九])(?![个天号日周人位块次])\s*分?)?|\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi;
function clockAt(text, t){
  const s = String(text || '');
  for (const m of s.matchAll(CLOCK)){
    let h, mi = 0, ap = '';
    if (m[1] != null){ h = Number(m[1]); mi = Number(m[2]); }
    else if (m[3] != null){
      if (m[3] === '一' && !m[4] && !/(凌晨|早上|上午|中午|下午|晚上|夜里|半夜)$/.test(s.slice(Math.max(0, m.index - 3), m.index)) && !/^一点钟/.test(s.slice(m.index))) continue;
      h = /\d/.test(m[3]) ? Number(m[3]) : num(m[3]); mi = m[4] === '半' ? 30 : m[4] === '一刻' ? 15 : m[4] === '三刻' ? 45 : m[5] != null ? Number(m[5]) : m[6] != null ? Number(m[6]) : m[7] != null ? (m[7][0] === '零' ? CN[m[7][1]] : num(m[7])) : 0;
    } else { h = Number(m[8]) % 12; mi = Number(m[9]) || 0; ap = m[10].toLowerCase(); if (ap === 'pm') h += 12; }
    if (h == null || !(h >= 0 && h <= 24) || !(mi >= 0 && mi < 60)) continue;
    // the part of the day is the word just before this time ("明天早上八点…，晚上再聊" is 08:00); the whole
    // sentence only when nothing stands next to it and it names one part of the day only
    const near = s.slice(Math.max(0, m.index - 4), m.index), PM = /晚上|今晚|明晚|夜里|半夜|下午|傍晚|tonight|evening|afternoon/i, AM = /凌晨|早上|早晨|上午|明早|一早|morning/i, NOON = /中午/;
    const pick = re => re.test(near) || (!PM.test(near) && !AM.test(near) && !NOON.test(near) && [PM, AM, NOON].filter(x => x.test(s)).length === 1 && re.test(s));
    const pm = pick(PM), noon = pick(NOON), am = pick(AM), w = PM.test(near) || AM.test(near) || NOON.test(near) ? near : s;
    if (!ap && pm && h === 12 && /晚上|夜里|半夜|今晚/.test(w)) h = 24;
    else if (!ap && ((pm && h < 12 && !(h <= 3 && /半夜|夜里/.test(w))) || (noon && h < 6))) h += 12;
    const d = new Date(t); d.setHours(0, 0, 0, 0);
    const dayWord = /明天|明早|明晚|tomorrow/i, today = /今天|今晚|今早|tonight|today/i, before = s.slice(Math.max(0, m.index - 8), m.index);
    let c = d.getTime() + (dayWord.test(before) || (!today.test(before) && dayWord.test(s) && !today.test(s)) ? DAY : 0) + h * HOUR + mi * MIN;
    // "九点" said in the evening: tonight's; "八点叫我" said at 23:00 is tomorrow 08:00 (the next of 8 and 20 o'clock)
    if (c <= t && !ap && !pm && !am && !noon && h < 12) while (c <= t) c += 12 * HOUR;
    while (c <= t) c += DAY;
    return c;
  }
  return null;
}
async function bookTags(r, t, hers){
  let slots = null;
  if ((r.promises || []).length && core.day){ try { const d = await core.day.get(dayOf(t)); slots = d ? d.slots : null; } catch { slots = null; } }
  for (const p of (r.promises || []).slice(0, 3)){
    // each kept promise is one paid call, so at most initiative.promises_per_day (6) are booked a day; the rest are not
    if (st && today(t).promises >= Number(knob('initiative.promises_per_day', 6))){ skip('promise-cap', 'promise', t, p); continue; }
    if (st) today(t).promises++;
    const at = promiseAt(p, t, slots, hers);
    // payload.due: the true time it was meant for; a job moved later (quiet hours, a retry) is still dated then
    // payload.asked: made at her request for that time (within an hour of the time she named), so her quiet
    // hours do not hold it; any other promise of the same turn still waits for them
    const named = asksAt(hers) ? clockAt(hers, t) : null, asked = named != null && Math.abs(at - named) <= NEAR;
    await jobs.add({ owner: 'core', kind: 'promise', at, expire: at + DAY, force: true, payload: Object.assign({ text: String(p).slice(0, 200), made: t, due: at }, asked ? { asked: true } : {}) });
  }
  if (r.nextContact != null && Number.isFinite(Number(r.nextContact))){
    const at = t + Math.min(24 * 60, Math.max(5, Number(r.nextContact))) * MIN;
    await jobs.add({ owner: 'core', kind: 'next', at, expire: at + 3 * HOUR, payload: { min: Number(r.nextContact), made: t } });
  }
}
// her message, read and not answered (the [no-reply] tag, or the decider's "read"): a read mark on it, and a reply later
async function readLater(t, why){
  const msgs = chatMsgs(), hers = msgs[msgs.length - 1];
  if (!hers || !hers.is_user) return null;
  hers.extra = Object.assign({}, hers.extra, { modu_read: t }); await writeChat();
  emit('reach', { op: 'read', at: t, msg: tOf(hers) });
  today(t).reads++;
  const [lo, hi] = [].concat(knob('replies.busy_delay_min', [10, 60])).map(Number);
  let at = t + Math.round(((lo || 10) + R() * Math.max(0, (hi || 60) - (lo || 10))) * MIN);
  if (personaState().presence === 'asleep' && core.day){ /* his wake comes with his day: the job waits for it */ at = Math.max(at, t + 6 * HOUR); }
  return jobs.add({ id: 'reply-' + tOf(hers), owner: 'core', kind: 'reply-later', at, payload: { msg: tOf(hers), why: why || 'no-reply' } });   // never expires (her message is always answered)
}
// the options her chat turn passes to send: [next] always while 主动 may happen; [no-reply] only in a busy slot
// of his, and at most replies.read_no_reply.max_per_day a day; [promise] always (a promise is kept with 主动 off too)
// later: true while he is asleep (send asks nothing of the model; the reply is booked for his wake, below), unless
// replies.asleep is 'reply' (a card whose companion answers at night). 暂停 stops his life, so then he answers as usual.
function sendOptions(){
  if (!store.name || paused()) return { next: false, noReply: false, promise: false };
  const t = now().getTime(), on = loadReach().on !== false, ps = personaState();
  const max = Number(knob('replies.read_no_reply.max_per_day', 1));
  // until she has had one reply from him, he answers, asleep or busy or not (a first message that
  // waits till morning is no welcome); after that first exchange the asleep hold and [no-reply] apply as usual
  if (!answeredOnce()) return { next: on, noReply: false, later: false, promise: true };
  const later = ps.presence === 'asleep' && String(knob('replies.asleep', 'defer_to_wake')) !== 'reply';
  return { next: on, noReply: !later && on && !!(ps.busy || ps.presence === 'busy') && (!st || today(t).reads < max), later, promise: true };
}
// whether a message of his has ever followed one of hers in this chat (his greeting alone is not a reply)
function answeredOnce(){
  let her = false;
  for (const m of store.msgs){ if (!m) continue; if (m.is_user) her = true; else if (her && !m.is_system) return true; }
  return false;
}
// her message while he slept (send's 'deferred' event): one reply-later job for all of them, at his wake (wakeAt: his own
// day, else the quiet hours) and 5–20 minutes to pick up the phone; replies.asleep a number N: she wakes him, about N
// minutes (never after his wake). The job keeps to her quiet hours and 暂停 like every job of his (run, below).
async function bookWake(t){
  const msgs = chatMsgs(); let i = msgs.length;
  while (i > 0 && msgs[i - 1].is_user) i--;
  const first = msgs[i]; if (!first) return null;
  const k = knob('replies.asleep', 'defer_to_wake'), woke = core.wakeAt ? core.wakeAt(t) : null;
  let at = (woke || t + 6 * HOUR) + Math.round((5 + R() * 15) * MIN), woken = false;
  if (typeof k === 'number' && isFinite(k) && k >= 0){ const n = t + Math.round(k * (0.7 + R() * 0.6) * MIN); if (n < at){ at = n; woken = true; } }
  // no expiry at all: a held message is always answered, at his wake or, the page shut then, when she next opens it
  return jobs.add({ id: 'reply-' + tOf(first), owner: 'core', kind: 'reply-later', at, payload: { msg: tOf(first), why: woken ? 'woken' : 'asleep' } });
}
// her messages at the end of the chat that wait for his reply (held while he slept, or read and let sit) have a
// live job (pending, no expiry: one booked by an older version may carry one); when none has, one is booked now, at his wake
// (now if he is up). Looked at once per message and page load; run() never answers twice (a reply of his after it ends it).
// one he answered with silence (an empty or [no-reply] answer, modu_quiet) is finished, never booked again
const held = m => !!(m && m.is_user && m.extra && (m.extra.modu_asleep || m.extra.modu_read) && !m.extra.modu_quiet);
// a kept promise of his is not an answer to her: her messages before it still wait for his reply
const answers = m => !m.is_user && !(m.extra && m.extra.modu_reach && m.extra.modu_reach.kind === 'promise');
function waitingHers(){ const msgs = chatMsgs(), out = []; for (let i = msgs.length - 1; i >= 0 && !answers(msgs[i]); i--) if (msgs[i].is_user) out.unshift(msgs[i]); return out; }
const looked = new Set();
async function keepHeld(t){
  const all = waitingHers(), hers = all.filter(held); if (!hers.length) return null;
  const key = tOf(hers[hers.length - 1]); if (looked.has(key) || t - key < 2 * ticker.BEAT) return null;   // just sent: its own job is being booked
  looked.add(key);
  const times = new Set(all.map(tOf));
  let live = []; try { live = (await jobs.list({ owner: 'core', kind: 'reply-later', state: 'pending' })).filter(j => j.payload && times.has(j.payload.msg) && j.expire == null); } catch {}
  if (live.length) return null;
  const first = hers[0], asleep = !!(first.extra && first.extra.modu_asleep && !first.extra.modu_read);
  const woke = personaState().presence === 'asleep' && core.wakeAt ? core.wakeAt(t) : null, at = woke ? woke + Math.round((5 + R() * 15) * MIN) : t;
  skip('rebooked', 'reply-later', t);
  return jobs.add({ id: 'reply-' + tOf(first) + '-' + t.toString(36), owner: 'core', kind: 'reply-later', at, payload: { msg: tOf(first), why: asleep ? 'asleep' : 'no-reply' } });
}

// --- the decider (app/prompts/decider.txt) ------------------------------------------------------------------------
function gapFeeling(ms){
  if (ms == null) return 'you have not talked yet';
  const h = ms / HOUR;
  return h < 1 ? 'a little while; it still feels like now' : h < 6 ? 'a few hours; your day went on' : h < 24 ? 'since earlier today or yesterday; she crosses your mind now and then'
    : h < 72 ? 'a couple of days; you have thought of her' : 'a long time; whatever kept her, you would not reproach her';
}
// what just happened, in words (app/prompts/reach-triggers.txt: "<trigger>: <words>" a line)
async function triggerWords(trigger){
  for (const l of (await prompt('reach-triggers', {})).split('\n')){ const i = l.indexOf(':'); if (i > 0 && l.slice(0, i).trim() === trigger) return l.slice(i + 1).trim(); }
  return String(trigger);
}
let deciderHook = null;
// → { do: 'leave' | 'read' | 'message' | 'invite', in_min, kind, why }. t: the moment it is about (a moment inside a time away
// for the catch-up); o.count: the day whose decider count it takes (now)
async function decide(trigger, t, kinds, o = {}){
  today(o.count || t).decided++;
  const ps = personaState(), p = pronouns(), last = lastLines(8);
  const lm = lastMsg(), st0 = o.count && o.count !== t ? statusAt(t) : '';
  const vars = { char: store.name, user: herName(), pronoun: p.zh || '他', pronoun_en: p.en || 'he/him', now: `${clockWords(t)} (${partOfDay(t)})`,
    status: o.count && o.count !== t ? (st0 ? `${store.name} is ${st0}` : 'your own day went on') : (ps.words || ''), gap: gapFeeling(lm ? t - tOf(lm) : null), trigger: await triggerWords(trigger), last_lines: last || '(nothing yet)',
    threads: herThreads(t).join('\n') || '(none)',
    today_count: String(today(t).sent), cap: String(cap()), invite_kinds: kinds.length ? kinds.join(', ') : 'none', lang: core.chatLanguage ? core.chatLanguage() : '' };
  let raw = '';
  if (deciderHook) raw = await deciderHook(vars);
  else { const text = await prompt('decider', vars); if (!text) return { do: 'leave', in_min: 0, kind: '', why: 'no prompt' }; raw = await sideCall('decider', [{ role: 'system', content: text }], { max: 120 }); }
  let j = null; try { j = JSON.parse((/\{[\s\S]*\}/.exec(String(raw || '')) || ['null'])[0]); } catch { j = null; }
  const what = j && ['leave', 'read', 'message', 'invite'].includes(j.do) ? j.do : 'leave';
  return { do: what, in_min: Math.max(0, Math.min(180, Math.round(Number(j && j.in_min) || 0))), kind: String((j && j.kind) || ''), why: String((j && j.why) || '').slice(0, 80) };
}

// --- invites (no closeness gate) ---------------------------------------------------------
let inviteSource = () => [];
// the page says which invites the apps offer: fn() → [{ kind, app, words, title, hours?: [from, to] (his hours it fits),
//   after?: [app ids] (only within `within_min` (120) minutes after she was in one of them), rare?: true }]. The core names no app.
function invites(fn){ inviteSource = typeof fn === 'function' ? fn : () => []; }
const offered = () => { try { return (inviteSource() || []).filter(x => x && x.kind && x.app); } catch { return []; } };
// pure: which kinds may be offered now. s: the state record; c: { t, offers, free, herLastAt, lastIn: { app: ms }, stateOk, rand }
function inviteRule(s, c){
  const t = c.t, d = dayOf(t), rand = c.rand || Math.random, out = [];
  if (!c.herLastAt || t - c.herLastAt > 3 * DAY) return out;
  const list = s.invites || [];
  if (list.some(i => i.state === 'open')) return out;
  if (s.declinedDay === d) return out;
  if (list.filter(i => dayOf(i.at) === d).length >= Number(knob('invite.per_day', 1))) return out;
  if (list.filter(i => t - i.at < 7 * DAY).length >= Number(knob('invite.per_week', 3))) return out;
  const h = new Date(t).getHours();
  const seen = new Set();
  for (const o of c.offers || []){
    const k = o.kind; if (!k || seen.has(k)) continue;
    if (!c.free && o.gate !== false) continue;                                  // his slot must be free, except for an offer with no gate (代付)
    if (c.stateOk === false && o.gate !== false) continue;                       // a card's own state may gate invites, never one with gate: false (代付)
    let p = 1;
    if (Array.isArray(o.hours) && o.hours.length === 2 && !(h >= Number(o.hours[0]) && h < Number(o.hours[1]))) continue;   // only in his hours that fit it (an evening thing)
    if (Array.isArray(o.after) && o.after.length){                              // only right after she was in one of those apps (代付)
      const at = Math.max(0, ...o.after.map(a => Number((c.lastIn || {})[a]) || 0));
      if (!at || t - at > Number(o.within_min || 120) * MIN) continue;
    }
    if (o.rare){                                                                // rare: at most once a week, with a small chance
      if (list.filter(i => i.kind === k && t - i.at < 7 * DAY).length >= Number(knob('invite.rare_per_week', 1))) continue;
      p = Number(knob('invite.rare_chance', 0.2));
    }
    seen.add(k);
    const ig = (s.ignored || {})[k]; if (ig && ig.n >= 2 && ig.until > t) p *= 0.5;   // two ignored in a row: half, for a week
    if (rand() < p) out.push(k);
  }
  return out;
}
async function inviteContext(t){
  const ps = personaState();
  const her = [...chatMsgs()].reverse().find(m => m.is_user);
  const lastIn = {}; try { for (const e of await core.eventList({ days: 1 })) if (e.who === 'her' && e.app && (e.at || 0) > (lastIn[e.app] || 0)) lastIn[e.app] = e.at; } catch {}
  let stateOk = true; const key = knob('invite.state_key', null);
  if (key && core.state){ try { const v = await core.state.get(String(key)); stateOk = !!v && v.value >= Number(knob('invite.state_min', 0)); } catch { stateOk = false; } }
  return { t, offers: offered(), free: ps.presence !== 'asleep' && !ps.busy && ps.presence !== 'busy', herLastAt: Math.max(tOf(her), Number(st.herSeen) || 0), lastIn, stateOk, rand: R };
}
async function invite(kind, t, why){
  const x = offered().find(o => o.kind === kind); if (!x) return null;
  const m = await say(await (x.pays ? payTold : inviteTold)(x.words, x.title || x.app), { kind: 'invite', why, at: t });
  if (!m) return null;
  const id = 'inv' + t.toString(36);
  st.invites.push(Object.assign({ id, kind, app: x.app, at: t, state: 'open' }, x.pays ? { pays: true } : {})); today(t).invites++;
  await addChatCard({ kind: 'invite', app: x.app, line: x.words, id, type: kind });
  await jobs.add({ id: 'invite-end-' + id, owner: 'core', kind: 'invite-end', at: endOfDay(t), payload: { invite: id } });
  emit('reach', { op: 'invite', invite: id, kind, at: t }); await save();
  return id;
}
// her answer on the card: 'yes' (the page opens the app) or 'no' (no new invite that day)
async function answerInvite(id, answer){
  await load(); const i = st.invites.find(x => x.id === id); if (!i || i.state !== 'open') return i ? clone(i) : null;
  const t = now().getTime();
  i.state = answer === 'yes' ? 'accepted' : 'declined'; i.ended = t;
  if (i.state === 'declined') st.declinedDay = dayOf(t);
  if (i.state === 'accepted') delete st.ignored[i.kind];
  await save(); emit('reach', { op: 'invite', invite: id, state: i.state });
  return clone(i);
}
const inviteState = id => { const i = st && st.invites.find(x => x.id === id); return i ? i.state : ''; };
const inviteOf = id => { const i = st && st.invites.find(x => x.id === id); return i ? clone(i) : null; };
// an invite she let pass may be named once, lightly, later, and only in a good mood (a block in his prompt)
function missedLine(){
  const m = st && (st.missed || []).find(x => !x.mentioned && now().getTime() - x.at < 3 * DAY);
  return m ? `You had told her: "${m.text}", and the time came while she was not around, so it did not happen. If it fits, you may mention it once, lightly; do not make a thing of it.` : '';
}
function reachLine(){ return [missedLine(), inviteLine()].filter(Boolean).join('\n'); }
function inviteLine(){
  if (!st || moodClass(personaState()) !== 'good') return '';
  const i = [...st.invites].reverse().find(x => x.state === 'ignored' && !x.mentioned && now().getTime() - x.ended < 3 * DAY);
  if (!i) return '';
  const x = offered().find(o => o.kind === i.kind);
  return `Yesterday or so you asked her (${x ? x.words : i.kind}) and she did not come. You may mention it once, lightly, at a natural moment, only if the mood is good. Never guilt, never repeat it.`;
}

// --- his mood, in three (the invite line above; a page's rule may ask it too) ---------------------------------------
function moodClass(ps){
  const w = String(ps.moodWord || '').toLowerCase(), m = String(ps.mood || '');
  if (/tired|low|sad|worried|down|累|低落|难过/.test(w) || ['sadness', 'anger'].includes(m)) return 'low';
  if (/playful|content|happy|good|joy|开心|愉快/.test(w) || ['joy', 'relief'].includes(m)) return 'good';
  return 'neutral';
}
// An app's rule is never the core's. The peek notice is
// the page's (app/scheduler.js, with its own record); the older names reach.peekRule and reach.peekDecide stay (contracts
// only grow) and forward to what the page lends with reach.lend({ peekRule, peekDecide }); until then the rule tells
// nothing and the decision never says.
const lent = {};
function lend(o){ for (const [k, f] of Object.entries(o || {})) if (typeof f === 'function') lent[k] = f; return Object.keys(lent); }
const peekRule = (e, w) => lent.peekRule ? lent.peekRule(e, w) : '';
const peekDecide = (p, c) => lent.peekDecide ? lent.peekDecide(p, c) : { say: false, p: Object.assign({ last: 0, count: 0, seen: 0 }, p || {}) };
// his record as it was last read, for a rule that must answer at once (a notice rule): a copy, or null before it is read
const current = () => st && stFor === (core.currentId || '') + '|' + (store.name || '') ? clone(st) : null;

// --- triggers and the round ---------------------------------------------------------------------------------------
// consider(trigger): her limits first (no call spent on a no), then the decider, then what it chose
async function consider(trigger, t, open){
  const why = limits(t); if (why){ skip(why, trigger, t); return null; }
  if (today(t).decided >= Number(knob('initiative.decider_per_day', 4))){ skip('decider-cap', trigger, t); return null; }
  const kinds = open || inviteRule(st, await inviteContext(t));
  let d; try { d = await decide(trigger, t, kinds); } catch(e){ if (!(e && e.code === 'paused')) { st.backoff = { n: st.backoff.n + 1, until: t + 30 * MIN }; skip('failed', 'decider', t); } return null; }
  emit('reach', { op: 'decided', trigger, decision: d, at: t });
  if (d.do === 'leave'){ skip('leave', trigger, t, d.why); return d; }
  if (d.do === 'read'){ const last = lastMsg(); if (last && last.is_user && !(last.extra && last.extra.modu_read)) await readLater(t, 'decider'); else skip('leave', trigger, t); return d; }
  if (d.do === 'invite' && !kinds.includes(d.kind)){ skip('invite-closed', d.kind, t); return d; }
  if (d.in_min > 0){ await jobs.add({ owner: 'core', kind: 'reach', at: t + d.in_min * MIN, expire: endOfDay(t), payload: { why: d.why, trigger, invite: d.do === 'invite' ? d.kind : '' } }); return d; }
  if (d.do === 'invite') await invite(d.kind, t, d.why); else await say(await reachTold(d.why, t), { kind: 'reach', why: d.why, at: t });
  return d;
}
// --- a time away ----------------------------------------------------------------------------------------
// The page is shut while she is away, so nothing of his can happen then; on the first look after a day or more away
// (initiative.catchup_after_hours, 20) there is one message for the whole time, about one moment inside it: outside her
// quiet hours, while he was up (his day, setDayPlan), within her cap for that day and the gap after his last first message.
// Exactly one message, dated then; it costs one call (≤ 3 calls on return with the day sketch and the age-out). None when a promise of his already falls due inside the time away (he wrote then) or a
// message of hers waits for his reply (that reply is his message), none after an unanswered first message of his (never
// chase twice), none once she has written.
const awayMs = () => Number(knob('initiative.catchup_after_hours', 20)) * HOUR;
function awayMoment(from, t, after){
  const step = 30 * MIN, lo = Math.max(from + 2 * HOUR, after || 0), hi = t - 30 * MIN, gapMin = Number(knob('initiative.min_gap_min', 120)) * MIN, all = [];
  for (let c = Math.ceil(lo / step) * step; c <= hi && all.length < 400; c += step){
    if (inQuiet(c)) continue;
    let s = null; try { s = dayStatus ? dayStatus(new Date(c)) : null; } catch { s = null; }
    if (s && s.presence === 'asleep') continue;
    if ((st.days[dayOf(c)] || { sent: 0 }).sent >= cap()) continue;
    if (st.lastSent && Math.abs(c - st.lastSent) < gapMin) continue;
    all.push({ c, busy: !!(s && s.busy) });
  }
  // the first day or two of the silence, when a person would really write; his free time first
  const early = all.filter(x => x.c >= Math.max(from + 12 * HOUR, after || 0) && x.c <= Math.max(from, after || 0) + 3 * DAY), pool0 = early.length ? early : all;
  const free = pool0.filter(x => !x.busy), pool = free.length ? free : pool0;
  return pool.length ? pool[Math.floor(R() * pool.length) % pool.length].c : null;
}
// → 'later' (her quiet hours now: looked at again on a later beat) or anything else (done)
async function catchUp(a, t){
  if (inQuiet(t)) return 'later';
  if (loadReach().on === false){ skip('off', 'away', t); return 'done'; }
  if (st.backoff.until > t){ skip('backoff', 'away', t); return 'done'; }
  // never chasing twice: after a first message of his she did not answer, nothing within a day of it (a day later, on a
  // new day of his, one message is not a chase; the decider still decides)
  const last = lastMsg(), chased = knob('initiative.never_chase_twice', true) !== false && last && !last.is_user && last.extra && last.extra.modu_reach;
  let kept = []; try { kept = (await jobs.list({ owner: 'core', state: 'pending' })).filter(j => j.force && j.at > a.from && j.at <= t && !(j.expire != null && j.expire < t)); } catch {}
  if (kept.length){ skip('kept', 'away', t); return 'done'; }
  // her message waits for his reply (held while he slept, or read): that reply is his message of the return
  if (waitingHers().some(held)){ skip('waiting', 'away', t); return 'done'; }
  // never chasing twice holds across the gap too: after a first message of his she did not answer,
  // no message for the time away at all
  if (chased){ skip('chase', 'away', t); return 'done'; }
  // exactly one message for the time away (设置 says so): at a moment inside it, or, when none fits (her
  // cap, his nights), now, as she comes back, if today's cap allows. No decider call: whether is settled, and one call less
  // means it is in the chat sooner after she opens the page; its tone comes from his day then, what is still open from her
  // side (her trip, her exam) and his card's away mood.
  let at = awayMoment(a.from, t, 0);
  // no fitting moment: now if he is up; else the latest moment in the gap he was up (outside her quiet hours, its
  // day's cap allowing); else a job at his next wake (her limits apply then, as for every first move of his)
  if (at == null){
    const up = c => { let s = null; try { s = dayStatus ? dayStatus(new Date(c)) : null; } catch { s = null; } return !(s && s.presence === 'asleep') && !inQuiet(c); };
    if (up(t) && today(t).sent < cap()) at = t;
    else for (let c = t - 30 * MIN; c > a.from + HOUR && at == null; c -= 30 * MIN) if (up(c) && (st.days[dayOf(c)] || { sent: 0 }).sent < cap()) at = c;
    if (at == null){
      const w = core.wakeAt ? core.wakeAt(t) : null;
      if (!w){ skip('cap', 'away', t); return 'done'; }
      await jobs.add({ id: 'away-' + a.lmT, owner: 'core', kind: 'reach', at: w + Math.round((5 + R() * 25) * MIN), expire: endOfDay(w), payload: { why: 'away', trigger: 'away', made: t } });
      skip('wake', 'away', t); return 'done';
    }
  }
  emit('reach', { op: 'decided', trigger: 'away', decision: { do: 'message', in_min: 0, kind: '', why: 'away' }, at: t, moment: at });
  try { await say(await awayTold(at, a.lmT, { mood: awayMood(at), plans: herPlans(a.lmT) }), { kind: 'reach', why: 'away', at, since: a.lmT }); } catch(e){ if (!(e && e.code === 'paused')) console.error(e); }
  return 'done';
}
// his card's away mood (params away) on the day of a moment inside her time away, while it is strong; else ''
function awayMood(at){
  try { const days = [...new Set(chatMsgs().filter(m => m.is_user).map(m => dayOf(tOf(m))))], e = core.awayEffect && core.awayEffect(knob('away', null), days, dayOf(at)); return e && e.strength >= 0.34 ? e.mood : ''; } catch { return ''; }
}

// the round on each beat, before the job round (clock.before): is there a real trigger? (his status moved, a silence
// crossed a mark, she came back; a time away is looked at once, first)
let checking = null, opened = false, away = null, afterSeen = 0, openSince = 0, lastLook = 0;
async function check(t){
  if (checking || !store.name) return;
  checking = (async () => {
    await load(true);
    if (paused()) return;
    await keepHeld(t);
    const lm = lastMsg(), gap = lm ? t - tOf(lm) : null;
    const ps = personaState(), status = [ps.presence, ps.where, ps.what].join('|');
    // how long this page has been open without a break (a beat missed by more than 10 minutes, a jump of the clock
    // or a shut lid, starts it again)
    if (!lastLook || t - lastLook > 10 * MIN || t < lastLook) openSince = t; lastLook = t;
    // the first look after a load: how long was the page shut? (lookedAt: the last beat of a page of hers; st.at is any write)
    // never before he moved in: an imported chat's old silence is not time away here
    if (away === null){ const from = Math.max(tOf(lm), Number(st.lookedAt) || 0, Number(store.importedAt) || 0); away = lm && t - from >= awayMs() ? { from, lmT: tOf(lm) } : false; }
    if (away){
      const r = tOf(lm) !== away.lmT ? (skip('answered', 'away', t), 'done') : await catchUp(away, t);
      if (r !== 'later'){ away = false; const l2 = lastMsg(); st.marks = { base: String(tOf(l2)), n: [3, 8, Number(knob('initiative.after_silence_hours', 36))].filter(h => t - tOf(l2) >= h * HOUR).length }; }
      opened = true; st.status = status; st.lookedAt = t; await save(); return;
    }
    let trigger = '', open = null;
    if (gap != null){
      const marks = [3, 8, Number(knob('initiative.after_silence_hours', 36))].map(h => h * HOUR), base = String(tOf(lm));
      const crossed = marks.filter(m => gap >= m).length;
      if (st.marks.base !== base) st.marks = { base, n: opened ? 0 : crossed };   // she wrote: the marks start again
      if (!opened && gap >= marks[0]) trigger = 'open';
      else if (crossed > st.marks.n) trigger = 'gap';
      st.marks.n = Math.max(st.marks.n, crossed);
    }
    if (!trigger && st.status && st.status !== status && gap != null && gap >= 30 * MIN) trigger = 'slot';
    // the page open and quiet: once the chat has been still for initiative.idle_min (40) minutes, all of them with the
    // page open, the decider is asked once for that silence (her limits first: cap, gap, quiet hours, asleep; it usually
    // says leave it). Not while her own message waits for his reply.
    const idle = Number(knob('initiative.idle_min', 40)) * MIN;
    if (!trigger && gap != null && idle > 0 && gap >= idle && gap < 3 * HOUR && t - openSince >= idle && !lm.is_user && st.idleBase !== String(tOf(lm))){ st.idleBase = String(tOf(lm)); trigger = 'idle'; }
    // invites reachable again: she was just in an app an offer comes after (购物, 外卖: 代付): the decider is asked
    // once, only when the offer is really open now (its own chance taken first, so no call is spent on a closed one)
    if (!trigger && afterSeen > (Number(st.afterSeen) || 0)){
      st.afterSeen = afterSeen;
      const ctx = await inviteContext(t), kinds = inviteRule(st, ctx);
      if (kinds.some(k => (ctx.offers.find(o => o.kind === k) || {}).after)){ trigger = 'after'; open = kinds; }
    }
    st.status = status; opened = true; st.lookedAt = t;
    // a message of his already due (a kept promise, a reply, a reach job: the page was shut at its time) goes
    // first, dated when it was due; no new first move is put in before it (it would push that one's date to now)
    if (trigger){ let due = []; try { due = (await jobs.due(t)).filter(j => j.owner === 'core' && MSG_KINDS.includes(j.kind)); } catch {} if (due.length){ skip('due', trigger, t); trigger = ''; } }
    if (trigger) await consider(trigger, t, open);
    await save();
  })().catch(e => console.error(e)).finally(() => { checking = null; });
  return checking;
}

// --- his jobs (owner 'core') ------------------------------------------------------------------------------------
// the flood cap on catch-up: of his own messages (reach, next) due in one round after time away, at most N, the newest; the
// rest are dropped and logged. Kept promises and his replies to her (reply-later) are never dropped and do not count.
function flooded(job, ctx){
  if (job.force || job.kind === 'promise' || job.kind === 'reply-later' || !ctx || !ctx.batch || ctx.late < 2 * ticker.BEAT) return false;
  const n = Math.max(1, Number(knob('initiative.flood_cap', 3)));
  const msgs = ctx.batch.filter(j => j.owner === 'core' && MSG_KINDS.includes(j.kind) && !j.force && j.kind !== 'promise' && j.kind !== 'reply-later').sort((a, b) => b.at - a.at);
  return !msgs.slice(0, n).some(j => j.id === job.id);
}
async function run(job, ctx){
  await load(true);
  const t = ctx.t, p = job.payload || {};
  if (job.kind === 'invite-end'){
    const i = st.invites.find(x => x.id === p.invite);
    if (i && i.state === 'open'){
      i.state = 'ignored'; i.ended = t;
      const ig = st.ignored[i.kind] || { n: 0, until: 0 }; ig.n++; if (ig.n >= 2) ig.until = t + 7 * DAY; st.ignored[i.kind] = ig;
      emit('reach', { op: 'invite', invite: i.id, state: 'ignored' }); addBlock(); await save();
    }
    return 'done';
  }
  if (!MSG_KINDS.includes(job.kind)) return 'drop';
  if (paused()) return { at: t + 30 * MIN };
  if (flooded(job, ctx)){ skip('flood', job.kind, t); await save(); return { drop: 'flood' }; }
  // her quiet hours: after they end; a promise she asked for (叫我 at 八点) comes at its time all the same
  if (inQuiet(t) && !(job.kind === 'promise' && p.asked)) return { at: quietEnd(t) };
  if (st.backoff.until > t) return { at: st.backoff.until };                       // the model was failing: every kind waits
  // written already (a reload between the message and the job's end, or another writer): never twice
  if (chatMsgs().some(m => !m.is_user && m.extra && m.extra.modu_reach && m.extra.modu_reach.job === job.id)) return 'done';
  const her = [...chatMsgs()].reverse().find(m => m.is_user);
  let r = null;
  if (job.kind === 'promise'){
    r = await say(await promiseTold(p.text || ''), { kind: 'promise', job: job.id, at: Math.min(Number(p.due) || job.at, job.at), count: false, asked: !!p.asked });
    if (r) await closeThread(p.text, t);
  }
  else if (job.kind === 'reply-later'){
    const last = lastMsg();
    if (!last || chatMsgs().some(m => answers(m) && tOf(m) > p.msg)){ skip('answered', job.kind, t); await save(); return { drop: 'answered' }; }
    // the page open at its time, it is dated then; shut then, it comes when she opens the page, dated then (his
    // wake or her open time, whichever is later)
    const late = ctx.late > 2 * ticker.BEAT, at = late ? t : Math.min(job.at, t);
    if (p.why === 'asleep' || p.why === 'woken'){
      // he is up (or she woke him): her messages since his last one are read now, then his reply
      const held = waitingHers();
      for (const m of held){ m.extra = Object.assign({}, m.extra, { modu_read: m.extra && m.extra.modu_read || at }); delete m.extra.modu_unsent; }
      if (held.length){ await writeChat(); emit('reach', { op: 'read', at, msg: p.msg }); }
      r = await say(await (late && at - p.msg >= 3 * HOUR ? lateTold(p.msg, at) : wakeTold(p.why === 'woken')), { kind: 'reply-later', job: job.id, at, count: false });
    }
    else r = await say(await replyTold(), { kind: 'reply-later', job: job.id, at, count: false });
    // nothing to say (empty, [no-reply]): her messages are answered by silence, never booked again on a reload
    if (!r){ for (const m of waitingHers()) m.extra = Object.assign({}, m.extra, { modu_quiet: t }); await writeChat(); }
  } else {
    if (her && tOf(her) > (p.made || job.made || 0) && job.kind === 'next'){ skip('answered', job.kind, t); await save(); return { drop: 'answered' }; }
    const why = limits(t); if (why){ skip(why, job.kind, t); await save(); return { drop: why }; }
    if (job.kind === 'next'){ await consider('next', t); await save(); return 'done'; }
    if (p.invite){ const kinds = inviteRule(st, await inviteContext(t)); if (kinds.includes(p.invite)) await invite(p.invite, t, p.why); else skip('invite-closed', p.invite, t); }
    else r = await say(await reachTold(p.why, job.at), { kind: 'reach', why: p.why, job: job.id, at: job.at });
  }
  void r; await save(); return 'done';
}
// a kept promise closes the open thread it was (a memory item whose threads say the same thing), so his diary and
// his prompt stop carrying it as still to happen
async function closeThread(text, t){
  const grams = x => { const a = String(x || '').replace(/[\s，。！？、,.!?…~]/g, ''), o = new Set(); for (let i = 0; i < a.length - 1; i++) o.add(a.slice(i, i + 2)); return o; };
  const g = grams(text); if (g.size < 2 || !core.saveMemoryItem) return;
  // only a thread that is this promise of his: one thread line holding most of the promise's own
  // words (≥ 60% of its pairs), never one about her (她… / her …): a shared time word (明天早上) is not enough
  const hers = /^(她|you\b|her\b|she\b)|她(要|会|得|去|想|说)/i;
  for (const m of store.memory || []){
    if (!m || !Array.isArray(m.threads) || !m.threads.length || m.closed) continue;
    const hit = m.threads.some(th => { if (hers.test(String(th).trim())) return false; const h = grams(th); let n = 0; for (const x of g) if (h.has(x)) n++; return n / g.size >= 0.6; });
    if (hit){ m.closed = dayOf(t); try { await core.saveMemoryItem(m); } catch(e){ console.error(e); } }
  }
}
jobs.handle('core', run);
ticker.before(t => check(t));
// a dropped job of his (expired while she was away) goes into the skip log too
core.listeners.add((ev, d) => {
  if (ev === 'clock' && d && d.op === 'dropped' && st) { for (const x of d.dropped) skip(x.why, x.kind, d.at); save(); }
  if (ev === 'logged' && d && d.who === 'her' && d.app && offered().some(o => Array.isArray(o.after) && o.after.includes(d.app))) afterSeen = Math.max(afterSeen, Number(d.at) || now().getTime());
  if (ev === 'loaded'){ st = null; opened = false; away = null; load().then(() => { if (st.invites.some(i => i.state === 'ignored' && !i.mentioned) || (st.missed || []).some(x => !x.mentioned)) addBlock(); }).catch(() => {}); }
  // a kept promise that expired while she was away is not replayed (no call): it becomes one line he may name
  if (ev === 'job' && d && d.op === 'drop' && d.job && d.job.owner === 'core' && d.job.kind === 'promise' && d.job.why === 'expired')
    load().then(() => { st.missed = (st.missed || []).concat({ text: String((d.job.payload && d.job.payload.text) || '').slice(0, 200), at: now().getTime(), due: d.job.at }).slice(-5); addBlock(); return save(); }).catch(e => console.error(e));
  if (ev === 'deferred' && d) load().then(() => bookWake(tOf(d) || now().getTime())).then(save).catch(e => console.error(e));
  if (ev === 'noreply' && d && d.extra && d.extra.modu_no_reply === 'model') load().then(() => readLater(now().getTime(), 'no-reply')).then(save).catch(e => console.error(e));
  // a message of his answers every held message of hers before it: none stays 已送达 once he has written after it
  if (ev === 'message' && d && answers(d) && !d.is_system && d.mes){
    let n = 0; for (const m of chatMsgs()) if (m.is_user && m.extra && m.extra.modu_asleep && !m.extra.modu_read && tOf(m) <= tOf(d)){ m.extra = Object.assign({}, m.extra, { modu_read: tOf(d) }); n++; }
    if (n) writeChat().catch(e => console.error(e));
  }
  if (ev === 'message' && d && !d.is_user && !d.is_system && !(d.extra && d.extra.modu_reach)){
    // his ordinary reply: the tags he wrote become jobs; an invite he could mention has had its one chance
    const r = { promises: (d.extra && d.extra.modu_promises) || [], nextContact: d.extra ? d.extra.modu_next_contact : null };
    // the time she named, for a promise with none of its own: only from her message right before his reply, and only
    // when it asks something of him (来接我, 叫我, 你…)
    const ms0 = chatMsgs(), di = ms0.indexOf(d), prev = di > 0 ? ms0[di - 1] : ms0.filter(m => tOf(m) <= tOf(d) && m !== d).pop();
    const hers = prev && prev.is_user && FOR_HIM.test(String(prev.mes || '')) ? prev : null;
    // no tag, but he agreed to what she asked for at a time ("明天早上八点叫我" → "七点五十准时"): booked all the same
    if (!r.promises.length && hers) r.promises = implied(d.mes, String(hers.mes || ''), now().getTime());
    load().then(async () => { if (r.promises.length || r.nextContact != null) await bookTags(r, now().getTime(), hers ? String(hers.mes || '') : '');
      const i = inviteLine() && [...st.invites].reverse().find(x => x.state === 'ignored' && !x.mentioned); if (i){ i.mentioned = true; }
      const ms = missedLine() && (st.missed || []).find(x => !x.mentioned); if (ms) ms.mentioned = true;
      await save(); }).catch(e => console.error(e));
  }
});
// the `reach` block (a line or two, after the events) is added only once an invite went unanswered or a promise expired while
// she was away (no extra call: he may name it on his next turn): most chats never have it
function addBlock(){ try { if (!contextBlocks().some(b => b.id === 'reach')) setContextBlock('reach', { after: 'events', priority: 40, budget: 400, build: reachLine }); } catch {} }
// the peek notice is a notice rule; the core ships with none, so the page adds its own (app/scheduler.js)
void noticeRules;

const reach = {
  check: t => check(t == null ? now().getTime() : t), consider: (trigger, t) => load(true).then(() => consider(trigger, t == null ? now().getTime() : t)).then(async d => { await save(); return d; }),
  limits: t => limits(t == null ? now().getTime() : t), cap, peekRule, moodClass, lend, current,
  async seen(t){ await load(); st.herSeen = t == null ? now().getTime() : t; return save(); }, inQuiet, quietEnd, sendOptions, invites, answerInvite, inviteState, inviteOf, inviteRule, peekDecide, promiseAt, implied,
  async state(){ await load(); return clone(st); }, async log(){ await load(); return clone(st.skips); },
  set decider(fn){ deciderHook = typeof fn === 'function' ? fn : null; }, set random(fn){ rnd.fn = typeof fn === 'function' ? fn : Math.random; }, get random(){ return rnd.fn; },
  get paused(){ return paused(); }, MSG_KINDS: MSG_KINDS.slice(),
};
Object.assign(core, { reach });
})(globalThis[Symbol.for('modu.core')]);
