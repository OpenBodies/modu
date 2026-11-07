// His own life: what he did while she was not looking.
//
// He has a day of his own. Each day has a plan worked out from his name and the date (so the same day
// always looks the same): when he wakes and sleeps, maybe a busy stretch, 0 to 3 朋友圈 posts at times
// of his own, and a diary entry in the evening. Whenever the phone opens, or time passes while it is
// open, wake() looks at what in that plan has already happened since he arrived and has not been written
// yet, and writes it, dated when it happened (never in the future). Her own posts and comments are
// saved by the 朋友圈 app at once; react() gives him a reaction for later (minutes to hours, sometimes
// only a 赞, sometimes nothing), and wake() delivers it once its time has passed.
//
// Bounded: at most the last WINDOW_DAYS days are filled, and one wake makes at most BUDGET model calls
// (the rest follow a little later). Times all come from ModuCore.now(), so ?at= moves his day too.
// He never messages her in chat from here (that is 主动, app/core/reach.js).
//
// It knows no app: core and life never know each app. What he does goes to the apps that say, when they
// register (their `life` entry), that they keep it: "he posted" to every app that takes 'post', "he wrote his
// diary" to every app that takes 'journal'. Each app owns its own records and their shape (朋友圈:
// app/apps/moments/README.md, 日记: app/apps/diary/README.md); adding an app for his life never touches this
// file. The only record it writes itself: 'life', id 'state': { since, skipped:[ids] }, plus its own
// bookkeeping (sketch tries, skeletonThrough, agedThrough, absence).
//
// His day record, day/<date>.json through the core's day: one sketch a day written ahead and shown slot by
// slot, her part (no call), his status for setDayPlan, the evening entry, the 3-day "his last days" block, the
// age-out batch to the memory source, the capped catch-up after a gap (one call), 暂停, and his timed things
// booked as jobs on the core's scheduler.
(function(){
'use strict';
const M = window.ModuCore;
if (!M) return;
const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const WINDOW_DAYS = 3, BUDGET = 2, GRACE = 10 * MIN, HERE_AFTER_ARRIVAL = 30 * MIN;
const pad = n => String(n).padStart(2, '0');
const iso = d => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dayStart = day => new Date(day + 'T00:00').getTime();
const hhmm = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const plain = t => String(t || '').replace(/\s+/g, ' ').trim();
const WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// --- his day: a seeded plan -------------------------------------------------------------------
function seed(str){ let h = 2166136261; for (let i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rand(str){ let a = seed(str); return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const who = () => M.store.name || '';
// The skeleton comes from his params (params.json, written by the calibration from his card, or by hand):
// clock.weekday / clock.weekend { wake, sleep } ('HH:MM'; a sleep at or before the wake falls on the next day, so a night
// worker sleeps by day), clock.jitter_min, work.blocks [{ from, to, place, label, busy }] on work days (busy: the share of
// the block he cannot really talk), work.days_off_per_week (the last days of the week: 1 = Sunday, 2 = Saturday and Sunday)
const minutes = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s == null ? '' : s).trim()); return m ? (+m[1]) * 60 + (+m[2]) : NaN; };
function dayOff(day){
  const n = Math.max(0, Math.min(7, Math.round(Number(knob('work.days_off_per_week', 2))))), wd = new Date(day + 'T12:00').getDay();
  return (7 - wd) % 7 < n;   // Sunday 0, Saturday 1, Friday 2, …
}
// a place's name from his params' places (a block says place: 'work'), else the word as it is
function placeName(id){ if (ownWork()) return ''; const p = [].concat(knob('places', []) || []).find(x => x && (x.id === id || x.name === id)); return p ? String(p.name || p.id) : String(id || ''); }
// most people bring their own cards, so Modu's 上班 decides little: when his work stretches are Modu's
// defaults (no params beside his card and no calibration that worked), they keep his rhythm (busy hours, slower replies) but
// name no job and no place: "上班 at 工作的地方" made a novelist's card talk about 收工 at noon. What he does in those
// hours is his card's to say.
const ownWork = () => { try { return !!(M.params && M.params.source && M.params.source('work.blocks') === 'default'); } catch { return false; } };
const workWord = w => ownWork() ? 'busy with your own things' : w.label && w.label !== '在忙' ? w.label : String(knob('work.kind', '') || 'work');
// → { day, wake, sleep, busy:[[from, to]], work:[{ from, to, place, label, share }], off, posts:[{ id, at }], diary } (ms).
// Same name + day + params → same plan.
function plan(day, name){
  const r = rand(`${name == null ? who() : name}|${day}`), base = dayStart(day), off = dayOff(day);
  const ck = knob(off ? 'clock.weekend' : 'clock.weekday', null) || {}, jit = Math.max(0, Math.min(120, Number(knob('clock.jitter_min', 30)) || 0));
  let wm = minutes(ck.wake), sm = minutes(ck.sleep);
  if (!isFinite(wm)) wm = off ? 540 : 460;
  if (!isFinite(sm)) sm = off ? 1480 : 1430;
  if (sm <= wm) sm += 1440;                                                // after midnight, or (a night worker) the next morning
  const j = () => Math.round((r() - 0.5) * jit) * MIN;
  const wake = base + wm * MIN + j(), sleep = Math.max(wake + 4 * HOUR, base + sm * MIN + j());
  // his work stretches on a work day; a block that starts before he wakes, for one who sleeps past midnight, is that night's
  const busy = [], work = [];
  if (!off) for (const b of [].concat(knob('work.blocks', []) || [])){
    let f = minutes(b && b.from), z = minutes(b && b.to); if (!isFinite(f) || !isFinite(z)) continue;
    if (z <= f) z += 1440;
    if (f < wm && sm > 1440){ f += 1440; z += 1440; }
    const share = Math.max(0, Math.min(1, b.busy == null ? 0.7 : Number(b.busy) || 0)), a = base + f * MIN, e = base + z * MIN;
    work.push({ from: a, to: e, place: placeName(b.place), label: String(b.label || ''), share });
    // busy for about `share` of it, in half hours (a free moment now and then)
    for (let s = a; s < e; s += 30 * MIN) if (r() < share){ const end = Math.min(e, s + 30 * MIN), last = busy[busy.length - 1]; if (last && last[1] === s) last[1] = end; else busy.push([s, end]); }
  }
  const x = r(), n = x < 0.25 ? 0 : x < 0.7 ? 1 : x < 0.95 ? 2 : 3;     // some days none, at most 3
  const from = wake + 40 * MIN, span = Math.max(0, sleep - 90 * MIN - from), times = [];
  for (let k = 0; k < n; k++){ const t = from + Math.round(r() * span / MIN) * MIN; if (times.every(o => Math.abs(o - t) >= 90 * MIN)) times.push(t); }
  times.sort((a, b) => a - b);
  const diary = sleep - 15 * MIN - Math.round(r() * 40) * MIN;            // in the evening, before bed
  return { day, wake, sleep, busy, work, off, posts: times.map((at, k) => ({ id: `p${day.replace(/-/g, '')}${k}`, at })), diary };
}
// What he is doing at time t by his own day: 'asleep' | 'busy' | 'here'.
function doing(t){
  const today = plan(iso(t)), yesterday = plan(iso(t - DAY));
  if (t < today.wake && t >= yesterday.sleep) return 'asleep';
  if (t >= today.sleep) return 'asleep';
  if (today.busy.some(([a, b]) => t >= a && t < b)) return 'busy';
  return 'here';
}
// The next time at or after t when he would see something and answer: not asleep, not busy.
function free(t){
  for (let i = 0; i < 4; i++){
    const d = doing(t);
    if (d === 'here') return t;
    if (d === 'busy'){ const b = plan(iso(t)).busy.find(([a, z]) => t >= a && t < z); t = b[1] + (5 + Math.floor(Math.random() * 25)) * MIN; continue; }
    const today = plan(iso(t)), w = t < today.wake ? today.wake : plan(iso(t + DAY)).wake;
    t = w + (10 + Math.floor(Math.random() * 50)) * MIN;
  }
  return t;
}

// --- state: when he arrived, which slots were let go ---------------------------------------------
let stateCache = null, stateFor = '';
async function state(){
  const key = who();
  let st = null; try { st = await M.records.get('life', 'state'); } catch {}
  if (!st || !st.since){ st = await M.records.put('life', { id: 'state', since: M.now().getTime(), skipped: [] }, { app: 'life' }); }
  stateCache = st; stateFor = key; return st;
}
async function saveState(st){ stateCache = await M.records.put('life', st, { app: 'life' }); }

// --- where his life goes: the apps that keep it ----------------------------------------------------
// An app passes life: { takes:[kinds], offers?:[{ kind, words }], kept(kind), did(deed), mine?(kind), today?(day, upTo),
// remember?(o), answers?:{ get, plan, list, give } } to ModuApps.register. The kinds are his own doings, an open
// list: his own plan makes two, and an app may offer more ({ kind, words }: 'visit', '去书店'),
// which his day may then hold (a slot of that kind); every app that takes a kind keeps it when he does it.
const OWN = Object.freeze([{ kind: 'post', words: '发一条动态' }, { kind: 'journal', words: '写日记' }]);   // a short update for anyone; his diary about his day
const KIND = /^[a-z][a-z0-9-]{0,31}$/;
// → [{ kind, words, app }]: his own two first, then what each app offers, in index.json order (one per kind)
function offers(){
  const out = OWN.map(o => Object.assign({ app: '' }, o)), seen = new Set(out.map(o => o.kind));
  for (const o of outlets()) for (const x of [].concat(o.offers || [])){
    if (!x || !KIND.test(String(x.kind || '')) || seen.has(x.kind)) continue;
    seen.add(x.kind); out.push({ kind: x.kind, words: String(x.words || x.kind), app: o.app });
  }
  return out;
}
// → every kind he may do: the offered ones, then any an app takes without offering
function kinds(){ const k = offers().map(o => o.kind); for (const o of outlets()) for (const t of [].concat(o.takes || [])) if (KIND.test(String(t)) && !k.includes(t)) k.push(t); return k; }
const appsReady = () => { try { return Promise.resolve(window.ModuApps && window.ModuApps.ready).catch(() => {}); } catch { return Promise.resolve(); } };
function outlets(kind){
  let list = []; try { list = window.ModuApps ? window.ModuApps.list() : []; } catch {}
  return list.filter(a => a && a.life && typeof a.life === 'object').map(a => Object.assign({ app: a.id }, a.life))
    .filter(o => !kind || (Array.isArray(o.takes) && o.takes.includes(kind)));
}
// the outlets in the order of his kinds (posts before the diary), then the rest
function ordered(){
  const ks = kinds(), rank = o => { const r = ks.findIndex(k => (o.takes || []).includes(k)); return r < 0 ? ks.length : r; };
  return outlets().map((o, i) => [o, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(x => x[0]);
}
const tryAsk = async (f, dflt) => { try { const v = await f(); return v == null ? dflt : v; } catch { return dflt; } };
// the deeds of a kind that any app already keeps (so he never does one twice)
async function keptOf(kind){
  const s = new Set();
  for (const o of outlets(kind)) if (typeof o.kept === 'function') for (const id of await tryAsk(() => o.kept(kind), [])) s.add(id);
  return s;
}
// his own deeds of a kind, as the apps keep them: [{ id, at, text }] (one per id)
async function mineOf(kind){
  const seen = new Map();
  for (const o of outlets(kind)) if (typeof o.mine === 'function') for (const x of await tryAsk(() => o.mine(kind), [])) if (x && !seen.has(x.id)) seen.set(x.id, x);
  return [...seen.values()];
}
// "he did it": every app that takes this kind keeps it, in its own shape
async function did(deed){ for (const o of outlets(deed.kind)) if (typeof o.did === 'function') await o.did(Object.assign({}, deed)); }
// what passed between them in the apps that day, for his diary: [{ where, lines }]
async function storyOf(day, upTo){
  const out = [];
  for (const o of ordered()) if (typeof o.today === 'function'){ const s = await tryAsk(() => o.today(day, upTo), null); if (s && Array.isArray(s.lines) && s.lines.length) out.push(Object.assign({ app: o.app }, s)); }
  return out;
}

// --- writing, through the core only ---------------------------------------------------------------
const POST_RULE = `Now step out of the chat. You are posting one short update to your own 朋友圈 (WeChat Moments), the way you really would at this moment of your own day: something you did or saw, a thought, a small thing you noticed, in your own voice and the language you two chat in. You are posting it for anyone who follows you, not writing to her, and not about your chat with her. It must be about something new: not the same topic, place, object or feeling as any of your recent posts listed below. 15 to 80 characters (or words), plain text, no hashtags, no quotation marks, no *actions*.`;
// (His diary is asked with app/prompts/evening.txt and his day with sketch.txt. His comment or reply
// under a post is asked by the app that keeps the thread, 朋友圈, through answers.give.)

async function persona(){ return M.assemble({ window: 2, emotion: true, bubbles: false }).filter(m => m.role === 'system').map(m => m.content).join('\n\n'); }
// her own name (聊天设置) in his day's prompts, else her chat's, else 她
const herName = () => { const u = M.userName ? M.userName() : M.store.meta && M.store.meta.user_name; return u && u !== 'You' ? u : '她'; };
function chatBefore(t, n, day){
  return (M.store.msgs || []).filter(m => { const d = M.msgDate(m); return d && d.getTime() <= t && (!day || iso(d) === day); })
    .slice(-n).map(m => `${m.is_user ? herName() : who()}: ${plain(m.mes)}`).join('\n');
}
function clock(t){ const d = new Date(t); return `It is ${WEEK[d.getDay()]} ${iso(d)}, ${hhmm(d)}, by your own clock.`; }
// 暂停 (the switch in 设置 → 他找你): while it is on, no side call at all. The core's paused() reads it;
// a core without it: her settings (pause, or reach.pause) or the knob reach.pause; absent = off.
function paused(){
  if (dayLead() === 'off') return true;   // lead.day 'off': his life makes no call and writes nothing
  try { if (can('paused') && M.paused()) return true; } catch {}
  try { const s = M.loadSettings() || {}; if (s.pause === true || (s.reach && s.reach.pause === true)) return true; } catch {}
  return knob('reach.pause', false) === true;
}
// who leads his day (core lead(), settings.lead.day), and whether a record's slots are another planner's
const dayLead = () => { try { return can('lead') ? M.lead('day') : 'modu'; } catch { return 'modu'; } };
const otherPlanner = r => !!r && Array.isArray(r.slots) && r.slots.length > 0 && (r.from ? !['sketch', 'skeleton'].includes(r.from) : !!r.writer && r.writer !== 'life');
const isPaused = e => !!e && (e.code === 'paused' || String(e.message) === 'paused');
// every call of his life goes through the core's one counted door, sideCall(name, messages, { chat?, max }):
// the side model for the sketch, the chat model for words in his own voice (posts, his diary, his answers).
// A core without it: the model directly.
async function call(text, o = {}){
  if (paused()){ const e = new Error('paused'); e.code = 'paused'; throw e; }
  calls++;
  const msgs = [{ role: 'system', content: await persona() }, { role: 'user', content: text }], max = o.max || 500;
  if (can('sideCall')) return M.sideCall(o.name || 'life', msgs, { chat: !o.side, max });
  return M.callModel(M.loadSettings(), msgs, { max_tokens: max });
}
function said(raw){
  const r = M.splitEmotion(raw), text = M.tidyCJK(String(r.text || '').replace(/\*[^*]+\*/g, '').replace(/^["“「]|["”」]$/g, '').trim());
  if (!text) throw new Error('empty');
  return { text, mood: r.emotion || 'neutral' };
}
async function ask(rule, context, name){ return said(await call(`${rule}\n\n${context}`, { name: typeof name === 'string' ? name : 'reaction' })); }
// How alike two short texts are: shared character pairs (0..1). He never posts what he just posted.
function grams(s){ s = plain(s).replace(/[\s，。！？、,.!?~…]/g, ''); const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; }
function alike(a, b){ const A = grams(a), B = grams(b); if (!A.size || !B.size) return plain(a) === plain(b) ? 1 : 0; let n = 0; A.forEach(x => { if (B.has(x)) n++; }); return n / Math.min(A.size, B.size); }
const TOO_ALIKE = 0.5;

async function doPost(job, st){
  const mine = (await mineOf('post')).filter(p => p.at < job.at).sort((a, b) => b.at - a.at).slice(0, 5);
  const so = slotsText(await seen(job.day, job.at));
  const ctx = `${clock(job.at)}\n\nWhat you did today so far:\n${so || '(an ordinary day)'}\n\nYour recent posts (do not repeat any of them):\n${mine.length ? mine.map(p => `- ${iso(p.at)} ${hhmm(p.at)}: ${p.text}`).join('\n') : '(none yet)'}\n\nWhat you two said lately (for you, not to quote):\n${chatBefore(job.at, 20) || '(nothing yet)'}`;
  let r = await ask(POST_RULE, ctx, 'post');
  if (mine.some(p => alike(p.text, r.text) >= TOO_ALIKE)){
    r = await ask(POST_RULE, ctx + `\n\nYou were about to post "${r.text}", which is too close to a recent post. Post about something else from your day.`, 'post');
    if (mine.some(p => alike(p.text, r.text) >= TOO_ALIKE)){ st.skipped = (st.skipped || []).concat(job.id).slice(-60); await saveState(st); return; }
  }
  if (!same()) return;
  await did({ kind: 'post', id: job.id, day: job.day, at: job.at, text: r.text, mood: r.mood, from: 'life' });
}
// his evening (today's, while the page is open or soon after): app/prompts/evening.txt, from the day record's passed
// slots, her part and that day's chat; kept by the apps that take 'journal' (日记) and as the day record's entry
async function doDiary(job){
  const today = (await mineOf('post')).filter(p => iso(p.at) === job.day && p.at <= job.at).sort((a, b) => a.at - b.at);
  const rec = await M.day.get(job.day), talk = chatBefore(job.at, 80, job.day);
  const back = cameBack(job.day);   // the day she came back after days away: the entry notices it
  const her = (back ? `${herName()} came back today, after ${back} days without a word from her.\n` : '') + herText(rec, job.at) + (talk ? `\n\nWhat you two said in chat today:\n${talk.slice(-12000)}` : '\n\n(you two did not chat today)');
  const d = new Date(job.at), pr = M.pronouns ? M.pronouns() : { zh: '他', en: 'he/him' };
  const text = await M.prompt('evening', { char: who(), user: herName(), pronoun: pr.zh, pronoun_en: String(pr.en || '').split('/')[0], date: job.day, weekday: WEEK[d.getDay()],
    slots: slotsText(await seen(job.day, job.at)) || '(an ordinary day)', her_part: her.trim(), posts: today.length ? today.map(p => `- ${hhmm(p.at)}: ${p.text}`).join('\n') : '(nothing)',
    voice: String(knob('diary.voice', '') || ''), hints: hintsText(rec), lang: lang() });
  if (!text) throw new Error('no evening prompt');
  const r = said(await call(text, { name: 'evening' }));
  if (!same()) return;
  await did({ kind: 'journal', id: job.day, day: job.day, at: job.at, text: r.text, mood: r.mood, from: 'life' });
  await writeDay(job.day, x => { x.entry = r.text; });
}
// his planned answer to her (react), delivered by the app that keeps the thread; it gets his words through help.ask
async function doReact(job){
  const o = outlets().find(x => x.app === job.app);
  if (!o || !o.answers || typeof o.answers.give !== 'function') return;
  await o.answers.give(job.post, { at: job.at, what: job.what }, { ask, clock, still: same });
}

// the newer core members (day, jobs, the memory source, prompts, params): a host's own core that does not forward
// them gets the simpler life (posts and diary by plan only): they are looked at with `in`, never read when missing
const can = k => { try { return k in M && M[k] != null; } catch { return false; } };
const v05 = () => ['day', 'jobs', 'memorySource', 'prompt'].every(can);
function knob(n, f){ try { return can('param') ? M.param(n, f) : f; } catch { return f; } }

// --- his day record: sketch, her part, status, the window, the age-out -----------------------------------
// One record a day, day/<YYYY-MM-DD>.json, through the core's day (first writer wins). The sketch is written
// ahead and every read for her or his prompt goes through day.visible, so a slot never shows before its time.
// Catch-up on reopen is capped: at most ONE call, the sketch call, covering the last ≤ 3
// days of the window, with the evening entries and posts those days missed folded into it; older days get a
// skeleton one-liner with no call; the days leaving the window go to the memory source as one batch.
const SKETCH_TRIES = 3, SKETCH_BACKOFF = 10 * MIN, GAP_DAYS = 60;
const lang = () => { const l = M.chatLanguage ? M.chatLanguage(M.store.msgs || []) : ''; return l === 'en' ? 'English' : l === 'other' ? 'the language this chat is written in' : 'Chinese'; };
const slotsText = (slots, point) => (slots || []).map(s => `- ${hhmm(s.at)}${s.until ? '–' + hhmm(s.until) : ''} ${s.where ? s.where + ': ' : ''}${point && inChat(s) ? `what you told her in chat${s.said_at ? ` at ${hhmm(s.said_at)}` : ''} (it is in the chat above)` : `${s.doing}${s.why ? ` (${s.why})` : ''}${s.said ? ' (as you told her in chat)' : ''}`}`).join('\n');
// the echo loop: a slot set from his own chat line (heard, promised) while that line is still in the chat the model
// reads is not quoted back to him: his chat prompt points at it, today and the days before (point;
// the sketch and the evening, which read no chat window, keep his words). Quoted in "Right now" and in his day, his line was in one prompt
// two or three times, and he said it again in each reply (a model repeats what its context repeats). Once the line has left
// the chat window his words come back, as before. Other systems keep the same rule: memory carries what has left the
// context (SillyTavern's summary and its vectors' kept-back last messages), never a second copy of what is still in it.
const chatWindow = () => { try { return Math.max(1, Number(M.loadSettings().window) || 40); } catch { return 40; } };
function inChat(s){
  if (!s || !s.said) return false;   // an older slot has no said_at: its words are looked for in his messages
  const msgs = M.store.msgs || [], n = chatWindow();
  for (let i = msgs.length - 1, k = 0; i >= 0 && k < n; i--){ const m = msgs[i]; if (m.is_system) continue; k++; const d = M.msgDate(m); if (!m.is_user && (s.said_at ? d && Math.abs(d.getTime() - s.said_at) < 2000 : plain(m.mes).includes(s.said.slice(0, 16)))) return true; }
  return false;
}
const hintsText = rec => ((rec && rec.hints) || []).map(h => `- ${h.line}`).join('\n');
const herText = (rec, upTo) => ((rec && rec.her) || []).filter(h => !upTo || h.at <= upTo).map(h => `- ${hhmm(h.at)} ${h.line}`).join('\n');
// the slots of a day as they may be seen at t (never one that has not begun)
async function seen(day, t){ if (!can('day')) return []; const r = await M.day.get(day); return r ? M.day.visible(r, t).slots : []; }
// the frame in words: wake (and, for one who sleeps by day, since when), his work stretches (or the old busy ones), sleep
function skeletonText(p){
  const base = dayStart(p.day), prev = plan(iso(base - 12 * HOUR)).sleep, later = t => t >= base + DAY ? (new Date(t).getHours() < 12 && t >= base + DAY + 4 * HOUR ? ' the next morning' : ' (after midnight)') : '';
  const work = (p.work || []).map(w => `${ownWork() ? workWord(w) : w.label && w.label !== '在忙' ? w.label : 'work'} ${hhmm(w.from)}–${hhmm(w.to)}${later(w.to)}${w.place ? ' at ' + w.place : ''} (busy about ${Math.round(w.share * 10) * 10}% of it)`);
  return [`wake ${hhmm(p.wake)}${prev > base + 4 * HOUR ? ` (asleep by day, since ${hhmm(prev)})` : ''}`]
    .concat(work.length ? work : p.busy.map(([a, b]) => `busy ${hhmm(a)}–${hhmm(b)}`), p.off ? ['a day off'] : [], [`sleep ${hhmm(p.sleep)}${later(p.sleep)}`]).join(', ');
}
// what is still ahead of him today, by his skeleton (his plans: never a sketched slot that has not begun): → words or ''
function aheadText(t){
  const p = plan(iso(t)), out = [];
  for (const w of p.work || []) if (w.to > t) out.push(`${workWord(w)} ${w.from > t ? hhmm(w.from) : 'until'}${w.from > t ? '–' : ' '}${hhmm(w.to)}${w.place ? ' at ' + w.place : ''}`);
  if (p.wake > t) out.unshift(`get up around ${hhmm(p.wake)}`);
  if (p.sleep > t) out.push(`bed around ${hhmm(p.sleep)}`);
  return out.join('; ');
}
// change one day's record: read, change, commit as the next revision; a lost race reads again once
async function writeDay(day, change){
  for (let i = 0; i < 2; i++){
    const old = await M.day.get(day), rec = old ? Object.assign({}, old) : { day, slots: [], her: [], entry: '', from: 'skeleton', line: skeletonText(plan(day)) };
    if (old && !old.from && old.writer && old.writer !== 'life') rec.from = String(old.writer);   // another planner's day (an outside agent's): say whose
    rec.rev = (old ? Number(old.rev) || 0 : 0) + 1;
    if (change(rec) === false) return old;
    const r = await M.day.put(rec, { writer: 'life' });
    if (r.ok){ cacheDay(r.record); return r.record; }
  }
  return null;
}
// "HH:MM" on a day → ms; a time well before the one before it is after midnight
function timeOn(day, s, after){ const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); if (!m) return NaN; let t = dayStart(day) + (+m[1]) * HOUR + (+m[2]) * MIN; if (after && t < after - 6 * HOUR) t += DAY; return t; }
// a sketch's slots for one day → the record's slots (sorted, filled, at most 12), or null when fewer than 3 hold
function readSlots(day, list){
  const ks = new Set(kinds()), p = plan(day), out = [];
  let last = 0;
  for (const s of [].concat(list || [])){
    if (!s || typeof s !== 'object') continue;
    let at = timeOn(day, s.at, last); if (!isFinite(at) || at < dayStart(day) || at > Math.max(dayStart(day) + DAY + 4 * HOUR, p.sleep)) continue;
    // a slot while his skeleton has him asleep (an hour's leeway) contradicts his card: left out
    if ((at < p.wake - HOUR || at >= p.sleep) && s.busy !== 'asleep') continue;
    const doing = plain(s.doing).slice(0, 40); if (!doing) continue;
    // one in that hour before his wake begins at his wake (he is asleep until then, by every label)
    if (at < p.wake && s.busy !== 'asleep' && !SLEEPS.test(doing)){ at = p.wake; if (out.some(x => x.at === at)) continue; }
    out.push({ at, until: timeOn(day, s.until, at), where: plain(s.where).slice(0, 20), doing, why: plain(s.why).slice(0, 60), busy: s.busy === true || s.busy === 'busy', kind: ks.has(s.kind) && s.kind !== 'journal' ? s.kind : '', mood: plain(s.mood).slice(0, 12) });
    last = at;
  }
  out.sort((a, b) => a.at - b.at);
  const slots = out.filter((s, i) => !i || s.at !== out[i - 1].at).slice(0, 12);
  slots.forEach((s, i) => { const next = slots[i + 1] ? slots[i + 1].at : Math.max(p.sleep, s.at + 30 * MIN); if (!(s.until > s.at) || s.until > next) s.until = next; });
  return slots.length >= 3 ? slots : null;
}
function readSketch(raw, days){
  const t = String(raw == null ? '' : raw).replace(/<think>[\s\S]*?<\/think>/gi, ''), m = t.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j; try { j = JSON.parse(m[0]); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const list = Array.isArray(j.days) ? j.days : [{ date: days[0], slots: j.slots, entry: j.entry, posts: j.posts }];
  const out = {};
  for (const d of list) if (d && days.includes(String(d.date || ''))) out[d.date] = { slots: readSlots(d.date, d.slots), entry: plain(d.entry), posts: [].concat(d.posts || []).map(plain).filter(Boolean) };
  return Object.keys(out).length ? out : null;
}
// what is asked of the catch-up: the window days (since he arrived) without a sketch; and, folded in, every evening
// entry and post of the window that has passed and is not kept yet (for a day before today, never asked again after)
// a day already planned: his own sketch, or a day another writer put with slots (their own agent; `from` names
// it once life has written to the record): life never sketches over it, and fills her part, the evening and the window as usual
const planned = r => !!r && (r.from === 'sketch' || (Array.isArray(r.slots) && r.slots.length > 0 && (r.from ? r.from !== 'skeleton' : !!r.writer && r.writer !== 'life')));
async function catchUpWork(t, st){
  const sinceDay = iso(st.since), today = iso(t), work = [];
  const have = await keptOf('post'), wrote = await keptOf('journal'), skipped = new Set(st.skipped || []);
  for (let k = WINDOW_DAYS - 1; k >= 0; k--){
    const day = iso(t - k * DAY); if (day < sinceDay) continue;
    const rec = await M.day.get(day), p = plan(day), w = { day, plan: p, rec, sketch: !planned(rec) && dayLead() === 'modu', entry: false, posts: [] };
    if (day !== today || w.sketch){
      if (p.diary <= t && p.diary > st.since && !wrote.has(day) && !(rec && rec.caught)) w.entry = true;
      w.posts = p.posts.filter(x => x.at <= t && x.at > st.since + GRACE && !have.has(x.id) && !skipped.has(x.id));
    }
    if (w.sketch || (day !== today && (w.entry || w.posts.length))) work.push(w);
  }
  // a diary for every day she was away: the days before the window, back to day.catchup_entry_days (default 7),
  // get their evening entry in the same one call, from the skeleton line (no slots asked); never asked again
  const back = Math.max(WINDOW_DAYS, Math.min(14, Number(knob('day.catchup_entry_days', 7)) || 7)), older = [];
  for (let k = back - 1; k >= WINDOW_DAYS; k--){
    const day = iso(t - k * DAY); if (day < sinceDay) continue;
    const rec = await M.day.get(day), p = plan(day);
    if (p.diary <= t && p.diary > st.since && !wrote.has(day) && !(rec && rec.caught)) older.push({ day, plan: p, rec, sketch: false, entry: true, posts: [], old: true });
  }
  return work.concat(older);   // the days to plan first, so an answer cut short loses the old entries, not his days
}
// the days she wrote to him (her own messages, by day) and, for a day, how many days she had been away before it (0: none)
function cameBack(day){ const hd = herDays(), i = hd.indexOf(day); if (i < 1) return 0; const n = Math.round((dayStart(day) - dayStart(hd[i - 1])) / DAY); return n >= 2 ? n : 0; }
// a line about her for a day of his diary: she came back that day after days away, or she did not write that day
function herNote(day, today){
  const n = cameBack(day); if (n) return `${herName()} came back that day, after ${n} days without a word from her (the entry notices her return)`;
  const hd = herDays(); if (!(hd.length && day > hd[0] && day !== today && !hd.includes(day))) return '';
  // a day of a trip she told him about is a day she was away, not a day she did not come to him
  return M.awayTold && M.awayTold(day) ? `${herName()} was away on the trip she had told you about, so she did not write that day` : `${herName()} did not write to you that day`;
}
// what is true of his life, for the sketch: where he lives and his work (his params, from his card), the card's fixed
// facts and where things stand now (the core's currentState: a fact he has said wins), and his last diary entries (same names)
async function settingText(first){
  const out = [], places = [].concat(knob('places', []) || []).filter(x => x && x.name);
  const home = places.filter(x => x.kind === 'home').map(x => x.name); if (home.length) out.push(`- You live at: ${home.join(', ')}`);
  const wk = String(knob('work.kind', '') || ''), blocks = [].concat(knob('work.blocks', []) || []).filter(b => b && b.from && b.to);
  if ((wk || blocks.length) && !ownWork()) out.push(`- Your work: ${[wk, blocks.map(b => `${b.from}–${b.to}${b.place ? ' at ' + placeName(b.place) : ''}`).join(', ')].filter(Boolean).join(', ')} (${Number(knob('work.days_off_per_week', 2)) || 0} days off a week)`);
  let cs = null; try { cs = can('currentState') ? M.currentState() : null; } catch {}
  if (cs){ for (const f of cs.fixed || []) out.push(`- ${f}`); for (const n of cs.now || []) out.push(`- ${n.key}: ${n.value}${n.from === 'said' ? ' (as you said it)' : ''}`); }
  const entries = [];
  for (let k = 3; k >= 1; k--){ const d = iso(dayStart(first) + 12 * HOUR - k * DAY), r = await M.day.get(d); if (r && r.entry) entries.push(`- ${d}: ${plain(r.entry).slice(0, 240)}`); }
  if (entries.length) out.push(`Your diary on the days before (the same people, names and things stay as you wrote them):\n${entries.join('\n')}`);
  return out.join('\n');
}
// the chat between two times, his and her lines, newest last
function chatBetween(from, to, n){
  return (M.store.msgs || []).filter(m => { const d = M.msgDate(m); return d && d.getTime() >= from && d.getTime() <= to && !m.is_system && (!M.chatCardKind || !M.chatCardKind(m)); })
    .slice(-n).map(m => `${hhmm(M.msgDate(m))} ${m.is_user ? herName() : who()}: ${plain(m.mes)}`).join('\n');
}
// the one catch-up call (or today's sketch): → true when something was written
async function catchUp(t, st){
  if (paused()) return false;
  const today = iso(t), work = await catchUpWork(t, st);
  if (!work.length) return false;
  const sk = st.sketch && st.sketch.day === today ? st.sketch : { day: today, tries: 0, next: 0 };
  if (sk.tries >= SKETCH_TRIES || t < sk.next) return false;
  const days = work.map(w => w.day), first = days.slice().sort()[0], firstPlan = (work.find(w => w.sketch) || work[0]).day;
  // the avoid list: the three days before the first one to plan, as they were seen
  const avoid = [];
  for (let k = 1; k <= 3; k++){ const d = iso(dayStart(firstPlan) + 12 * HOUR - k * DAY), r = await M.day.get(d); if (r && r.slots.length) avoid.push(`${d}:\n${slotsText(M.day.visible(r, t).slots)}`); }
  const hints = [];
  for (const w of work) if (w.sketch){ let h = []; try { h = can('state') ? M.state.undertow(w.day) : []; } catch {} w.hints = h.map(x => ({ key: x.key, line: x.line })); w.hints.forEach(x => hints.push(`- ${w.day}: ${x.line}`)); }
  const her = [];
  for (const w of work){ const r = await M.day.get(w.day), l = herText(r); if (l) her.push(`${w.day}:\n${l}`); const talk = chatBefore(Math.min(t, dayStart(w.day) + DAY), 20, w.day); if (w.entry && talk) her.push(`${w.day}, in chat:\n${talk.slice(-3000)}`); }
  const places = [].concat(knob('places', []) || []).filter(x => x && !(ownWork() && x.kind === 'work')).map(x => x && (x.name || x.id)).filter(Boolean).map(x => `- ${x}`)
    .concat(offers().filter(o => o.kind !== 'post' && o.kind !== 'journal').map(o => `- ${o.words} [${o.kind}]`));
  const extra = work.map(w => [w.entry ? 'entry' + (herNote(w.day, today) ? ` (${herNote(w.day, today)})` : '') : '', w.posts.length ? `posts at ${w.posts.map(x => hhmm(x.at)).join(', ')}` : ''].filter(Boolean).join('; ')).map((x, i) => x ? `- ${days[i]}: ${x}` : '').filter(Boolean);
  const pr = M.pronouns ? M.pronouns() : { zh: '他', en: 'he/him' }, d0 = new Date(dayStart(today) + 12 * HOUR);
  const frame = w => w.sketch ? skeletonText(w.plan) : w.old ? `(passed while ${herName()} was away: ${(w.rec && w.rec.line) || skeletonText(w.plan)}; no slots, only the entry, two or three sentences)` : '(already planned)';
  const text = await M.prompt('sketch', { char: who(), user: herName(), pronoun: pr.zh, pronoun_en: String(pr.en || '').split('/')[0],
    date: days.join(', '), weekday: days.length > 1 ? days.map(d => WEEK[new Date(d + 'T12:00').getDay()]).join(', ') : WEEK[d0.getDay()],
    skeleton: work.map(w => `${w.day}: ${frame(w)}`).join('\n'), places: places.join('\n') || '(home, work, the streets nearby)',
    setting: (await settingText(first)) || '(nothing beyond your card)', said: chatBetween(dayStart(first) - 12 * HOUR, t, 30).slice(-3000) || '(nothing)',
    avoid: avoid.join('\n\n') || '(nothing yet)', hints: hints.join('\n') || '(none)', her_part: her.join('\n\n') || '(nothing)', extra: extra.join('\n') || '(nothing)', lang: lang() });
  let got = null;
  const fail = async () => { sk.tries++; sk.next = t + SKETCH_BACKOFF * Math.pow(3, sk.tries - 1); st.sketch = sk; await saveState(st); };   // back off; the skeleton and yesterday's record are kept as they are
  // the answer's room grows with what is asked (a day to plan, an entry, a post), so 3 days, 7 away
  // entries and the posts are never cut off; an answer cut off anyway (JSON begun, never closed) is a failure under the
  // back-off and is not asked again today (no retries past the ≤ 4 calls of a return)
  const max = Math.min(8000, 600 + work.reduce((n, w) => n + (w.sketch ? 900 : 0) + (w.entry ? (w.old ? 200 : 450) : 0) + 90 * w.posts.length, 0));
  let cut = false;
  try { if (!text) throw new Error('no sketch prompt'); const raw = String(await call(text, { side: true, max, name: 'sketch' }) || ''); got = readSketch(raw, days);
    if (!got){ cut = raw.includes('{') && !/\}\s*$/.test(raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()); throw new Error(cut ? 'sketch cut off' : 'unreadable sketch'); } }
  catch(e){
    if (isPaused(e)) return false;
    if (cut) sk.tries = SKETCH_TRIES - 1;
    await fail(); return false;
  }
  if (!same()) return false;
  // a partial answer (a day it left out, or fewer than 3 usable slots) is a failed try for the sketch: what it did bring
  // (entries, posts, the days it planned) is kept, the rest waits for the back-off; never asked again on the next wake
  const partial = work.some(w => w.sketch && !(got[w.day] && got[w.day].slots));
  if (partial) await fail(); else st.sketch = { day: today, tries: 0, next: 0, done: true };
  let wrote = false;
  for (const w of work){
    const g = got[w.day] || { slots: null, entry: '', posts: [] };
    const r = await writeDay(w.day, x => {
      if (w.sketch && g.slots){ x.slots = g.slots; x.from = 'sketch'; x.hints = w.hints || []; delete x.line; }
      if (w.entry){ if (g.entry) x.entry = g.entry; if (w.day !== today) x.caught = true; }
    });
    if (r) wrote = true;
    if (w.entry && g.entry) await did({ kind: 'journal', id: w.day, day: w.day, at: w.plan.diary, text: g.entry, mood: 'neutral', from: 'life' });
    for (let i = 0; i < w.posts.length; i++){
      if (g.posts[i]) await did({ kind: 'post', id: w.posts[i].id, day: w.day, at: w.posts[i].at, text: g.posts[i], mood: 'neutral', from: 'life' });
      else if (w.day !== today) st.skipped = (st.skipped || []).concat(w.posts[i].id).slice(-60);
    }
  }
  await saveState(st);
  return wrote;
}
// days before the window since he arrived (a long gap): a skeleton one-liner each, no call; marked aged (they go
// to the memory source with the batch below, as they are)
async function skeletons(t, st){
  const from = Math.max(dayStart(iso(st.since)), dayStart(iso(t)) - (GAP_DAYS + WINDOW_DAYS) * DAY), to = dayStart(iso(t)) - WINDOW_DAYS * DAY;
  if (st.skeletonThrough && st.skeletonThrough >= iso(to)) return;
  for (let d = Math.max(from, st.skeletonThrough ? dayStart(st.skeletonThrough) + DAY : from); d <= to; d += DAY){
    const day = iso(d + 2 * HOUR); if (!(await M.day.get(day))) await writeDay(day, () => {});
  }
  st.skeletonThrough = iso(to); await saveState(st);   // (once a day: the early return above)
}
// her part: a line for each thing that passed between them that day, with no call. Each app's today(day) hook,
// the event log (what apps log, quiet entries left out), and the chat itself (how much, and when)
async function herPart(day, upTo, log){
  const out = [];
  const msgs = (M.store.msgs || []).filter(m => { const d = M.msgDate(m); return d && !m.is_system && iso(d) === day && d.getTime() <= upTo && (!M.chatCardKind || !M.chatCardKind(m)); });
  if (msgs.length){
    const a = M.msgDate(msgs[0]).getTime(), z = M.msgDate(msgs[msgs.length - 1]).getTime(), first = msgs.find(m => m.is_user);
    out.push({ at: a, app: 'chat', what: 'chat', line: `你们聊了${msgs.length}句（${hhmm(a)}–${hhmm(z)}）` + (first ? `，她说起「${plain(first.mes).replace(/\*[^*]*\*/g, '').slice(0, 24)}」` : '') });
  }
  for (const s of await storyOf(day, upTo)) for (const l of s.lines){ const o = typeof l === 'string' ? { line: l } : l; if (o && o.line) out.push({ at: Number(o.at) || 0, app: s.app, what: '', line: `${s.where}：${plain(o.line)}` }); }
  let ev = log || []; if (!log) try { ev = M.eventList ? await M.eventList({ days: WINDOW_DAYS + 1 }) : []; } catch {}
  for (const e of ev) if (e && e.line && !e.quiet && iso(e.at) === day && e.at <= upTo) out.push({ at: e.at, app: e.app, what: String(e.what || ''), line: e.line });
  // an invite of his that went unanswered (the core's reach says so when it ends: event reach { op: 'invite', state:
  // 'ignored' }, noted in life's own state); it dims his mood a little. Read from life's note, never by loading reach.
  for (const i of (stateCache && stateCache.ignored) || []) if (i && i.at && iso(i.at) === day && i.at <= upTo)
    out.push({ at: i.at, app: 'reach', what: 'invite-ignored', line: '你约了她，她没有回' });
  return out.sort((a, b) => a.at - b.at).slice(-40);
}
async function writeHer(t, st){
  const sinceDay = iso(st.since);
  let log = []; try { log = M.eventList ? await M.eventList({ days: WINDOW_DAYS + 1 }) : []; } catch {}   // read once for the window
  for (let k = WINDOW_DAYS - 1; k >= 0; k--){
    const day = iso(t - k * DAY); if (day < sinceDay) continue;
    const her = await herPart(day, t, log), old = await M.day.get(day);
    if (!her.length && !old) continue;
    if (old && JSON.stringify(old.her) === JSON.stringify(her.map(h => M.day.shape({ her: [h] }).her[0]))) continue;
    await writeDay(day, x => { x.her = her; });
  }
}
// the days leaving the window → the memory source, ONE batch per reopen (the memory engine turns them into 1–4 items):
// tell({ kind: 'day', day, record, days: [{ day, record }] }), the newest as day/record. The full record stays.
async function ageOut(t, st){
  const edge = iso(t - WINDOW_DAYS * DAY), batch = [];
  const from = st.agedThrough ? dayStart(st.agedThrough) + DAY : Math.max(dayStart(iso(st.since)), dayStart(edge) - (GAP_DAYS) * DAY);
  for (let d = from; d <= dayStart(edge); d += DAY){ const day = iso(d + 2 * HOUR), r = await M.day.get(day); if (r && !r.aged) batch.push({ day, record: M.day.visible(r, t) }); }
  if (batch.length){
    const last = batch[batch.length - 1];
    if (!accepts('day')) return;   // nothing would keep them yet: they wait, unmarked, for a memory that does
    if (!(await M.memorySource.tell({ kind: 'day', day: last.day, record: last.record, days: batch }))) return;
    for (const b of batch) await writeDay(b.day, x => { x.aged = t; });
  }
  if (st.agedThrough !== edge){ st.agedThrough = edge; await saveState(st); }
}
// whether the memory source keeps an event of this kind: a source may say so (accepts(kind)); else every source does
// (Modu's own engine queues the days and turns them into items). A day is marked aged only once tell()
// accepted it (returned true); a refused or failed tell leaves it queued for the next wake.
function accepts(kind){
  try { const s = M.memorySource; return typeof s.accepts === 'function' ? !!s.accepts(kind) : true; } catch { return false; }
}
// the days she was with him (her own messages), for the away effect and the absence
const herDays = () => [...new Set((M.store.msgs || []).filter(m => m.is_user).map(m => M.msgDate(m)).filter(Boolean).map(d => iso(d)))].sort();
// an absence of N+ days (param away.after_days, default 3) told to the memory source once, when she is back
async function absence(st){
  const hd = herDays(); if (hd.length < 2) return;
  const a = hd[hd.length - 2], b = hd[hd.length - 1], days = Math.round((dayStart(b) - dayStart(a)) / DAY), key = a + '|' + b;
  if (days < (Number(knob('away.after_days', 3)) || 3) || st.absence === key || !accepts('absence')) return;
  if (await M.memorySource.tell({ kind: 'absence', from: a, to: b, days })){ st.absence = key; await saveState(st); }
}
// a passed slot of a kind an app offered goes to the apps that take that kind: no call
async function deeds(t, st){
  for (let k = WINDOW_DAYS - 1; k >= 0; k--){
    const day = iso(t - k * DAY), r = await M.day.get(day); if (!r) continue;
    for (const [i, s] of M.day.visible(r, t).slots.entries()){
      if (!s.kind || s.kind === 'post' || s.kind === 'journal' || !outlets(s.kind).length) continue;
      const id = `s${day.replace(/-/g, '')}${i}`; if ((await keptOf(s.kind)).has(id)) continue;
      await did({ kind: s.kind, id, day, at: s.at, text: s.doing, where: s.where, why: s.why, from: 'life' });
    }
  }
}
// a reply's [promise: …] tag rewrites his next slot that has not begun: he does what he said
// (a promise that names a time of day today goes to that time's slot, like a plan he said in chat, below)
async function promised(text, said_at){
  const t = M.now().getTime(), day = iso(t), at = timeIn(text, day);
  if (isFinite(at) && at > t) return setSlot(at, text, { said_at, by: BY.test(text) });
  if (await notOurs(day)) return keepSaid(t, text, said_at);
  return writeDay(day, x => {
    const i = x.slots.findIndex(s => s.at > t); if (i < 0) return false;
    x.slots = x.slots.slice(); x.slots[i] = Object.assign({}, x.slots[i], { doing: plain(text).slice(0, 40), why: plain(text).slice(0, 60), kind: '', busy: false });
  });
}
// a plan he states in chat for later today ("中午清蒸", "下午三点去码头", "tonight I'll cook") rewrites
// the slot at that time, so his day record, the window and his diary keep to what he said. No call: the time words are read
// here. A time named for another day (明天, tomorrow), or one already past, is left alone (the sketch and the evening read the chat).
const WHEN = [[/凌晨/, 300], [/早上|早晨|一早|今早|this morning/i, 480], [/上午/, 600], [/中午|午饭|\bnoon\b|\blunch\b/i, 720], [/下午|this afternoon/i, 900],
  [/傍晚/, 1080], [/晚上|今晚|晚饭|tonight|this evening|\bdinner\b/i, 1170], [/半夜|深夜|夜里/, 1380]];
const NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
// → ms on `day` for the time of day the words name, or NaN
function timeIn(text, day){
  const s = String(text || '');
  if (/明天|明早|明晚|后天|昨天|昨晚|tomorrow|yesterday/i.test(s)) return NaN;
  const band = WHEN.find(([re]) => re.test(s));
  let m = /(\d{1,2})[:：](\d{2})/.exec(s), mins = NaN;
  if (m) mins = (+m[1]) * 60 + (+m[2]);
  else if ((m = /(\d{1,2}|十[一二]?|[一二两三四五六七八九十])\s*点\s*(半)?/.exec(s))){ let h = /\d/.test(m[1]) ? +m[1] : NUM[m[1]]; if (band && band[1] >= 720 && h < 12) h += 12; mins = h * 60 + (m[2] ? 30 : 0); }
  else if ((m = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(s))) mins = ((+m[1]) % 12 + (/pm/i.test(m[3]) ? 12 : 0)) * 60 + (+m[2] || 0);
  else if (band) mins = band[1];
  return isFinite(mins) && mins < 1440 ? dayStart(day) + mins * MIN : NaN;
}
// the slot at `at` becomes what he said (split off when it falls well inside a longer slot; a new one when none is there)
// a day another planner made stays theirs. What he says goes beside it, in life/said-<day>.json ({ lines: [{ at,
// line, said_at }] }), never into their slots: their record, its writer and its rev are left alone, and their agent can read
// the file and decide. The same when their agent leads his days (lead.day 'theirs'), written yet or not.
const notOurs = async day => dayLead() !== 'modu' || otherPlanner(await M.day.get(day));
async function keepSaid(at, words, said_at){
  const day = iso(at), id = `said-${day}`; let r = null; try { r = await M.records.get('life', id); } catch {}
  const lines = ((r && r.lines) || []).concat({ at, line: plain(words).slice(0, 80), said_at: said_at || M.now().getTime() });
  await M.records.put('life', Object.assign({}, r, { id, lines }), { app: 'life' });
  saidOn[day] = lines; return lines;
}
// o.said_at: when his message was sent (the prompt points at it while it is in the chat); o.by: the time is a deadline
// (之前, before), so the stretch runs from his message until then and ends there, never on into the hours after
async function setSlot(at, words, o = {}){
  if (await notOurs(iso(at))) return keepSaid(at, words, o.said_at);
  const said = plain(words).slice(0, 80), doing = said.slice(0, 40), end = at;
  if (o.by && o.said_at && o.said_at < at) at = o.said_at;
  return writeDay(iso(at), x => {
    x.slots = x.slots.slice();
    const mine = Object.assign({ at, where: '', doing, why: '', busy: false, kind: '', said }, o.said_at ? { said_at: o.said_at } : {});
    const i = x.slots.findIndex(s => s.at <= at && (!s.until || at < s.until));
    if (i >= 0){
      const s = x.slots[i];
      if (at - s.at >= 30 * MIN){ x.slots[i] = Object.assign({}, s, { until: at }); x.slots.splice(i + 1, 0, Object.assign({}, s, mine)); }
      else x.slots[i] = Object.assign({}, s, mine, { at: s.at });
      // a deadline ends his stretch there, never later (his next plan still begins when it begins): what the slot held
      // before carries on after it
      if (o.by && (s.until || 0) > end + 15 * MIN){ const k = x.slots.findIndex(y => y.said === said); if (k >= 0){ x.slots[k] = Object.assign({}, x.slots[k], { until: end }); x.slots.splice(k + 1, 0, Object.assign({}, s, { at: end })); } }
    } else {
      const j = x.slots.findIndex(s => s.at > at);
      x.slots.splice(j < 0 ? x.slots.length : j, 0, Object.assign({ until: j < 0 ? at + HOUR : x.slots[j].at, mood: '' }, mine));
    }
  });
}
// what is not a plan: a greeting (下午好, 晚上好, good morning), the past (中午吃了面, 刚才, already;
// unless a plan word says it is still ahead: 要, 会, 打算, 待会, I'll), and a time with nothing to do in it (两点)
// a deadline: 之前 / 以前, or English before / by <a time> ("by the river" is a place, not a deadline)
const BY = /之前|以前|\bbefore\b|\bby\s+(\d|noon|midnight|tonight|then|the time)/i;
const GREET = /(早上|早晨|上午|中午|下午|晚上|午)好|早安|晚安|good (morning|afternoon|evening|night)/i;
const PAST = /(吃|做|去|买|看|睡|洗|喝|到|回|完|忙)了|过了|刚才|刚刚|已经|\b(had|did|was|went|ate|finished)\b/i;
const AHEAD = /要|会|打算|准备|待会|一会|等下|等会|约了|\b(will|going to|gonna|plan)\b|i'll/i;
const TIMEWORDS = /凌晨|早上|早晨|一早|今早|上午|中午|下午|傍晚|晚上|今晚|半夜|深夜|夜里|\d{1,2}[:：]\d{2}|(\d{1,2}|十[一二]?|[一二两三四五六七八九十])\s*点\s*半?|\b\d{1,2}(:\d{2})?\s*(am|pm)\b|tonight|this (morning|afternoon|evening)|noon|\bat\b/gi;
function isPlan(l){
  if (GREET.test(l)) return false;
  if (PAST.test(l) && !AHEAD.test(l)) return false;
  return l.replace(TIMEWORDS, '').replace(/[\s，。！？、,.!?…~吧呀啊呢哦嗯]/g, '').length >= 1;
}
// his reply in the chat (an ordinary one, never a message of his from the scheduler), written just now: each line that names
// a time later today and is a plan (isPlan) sets that slot (at most two a message)
async function heard(msg){
  const t = M.now().getTime(), today = iso(t), d = M.msgDate(msg);
  if (msg.extra && msg.extra.modu_reach) return 0;                                           // 主动, a catch-up, a kept promise
  if (!d || Math.abs(t - d.getTime()) > 10 * MIN || iso(d.getTime()) !== today) return 0;   // dated at another time (inside a time away)
  let n = 0;
  for (const line of String(msg.mes || '').replace(/\*[^*\n]*\*/g, '').split(/\n+/)){
    const l = plain(line.replace(/\[[^\]]*\]/g, '')); if (!l || n >= 2 || !isPlan(l)) continue;
    const at = timeIn(l, today); if (!isFinite(at) || at < t - 15 * MIN) continue;
    await setSlot(at, l, { said_at: d.getTime(), by: BY.test(l) }); n++;
  }
  return n;
}

// --- the window, for his prompt and his status (kept in step with the records) ---------------------------------
let days = {}, daysFor = '', daysAt = '', saidOn = {};
function cacheDay(r){ if (r && r.day && daysFor === who()) days[r.day] = r; }
async function readDays(){
  if (!who() || !can('day')) { days = {}; return; }
  const t = M.now().getTime(), key = who(), next = {};
  const said = {};
  for (let k = 0; k < WINDOW_DAYS; k++){ const d = iso(t - k * DAY), r = await M.day.get(d); if (r) next[d] = r; let s = null; try { s = await M.records.get('life', `said-${d}`); } catch {} if (s && s.lines) said[d] = s.lines; }
  if (key === who()){ days = next; daysFor = key; daysAt = iso(t); saidOn = said; }
}
// the copy follows the date: once the day turns (the clock's beat, or her message), it is read again
function daysFresh(){ if (who() && can('day') && (daysFor !== who() || daysAt !== iso(M.now().getTime()))) return readDays().then(() => M.updatePresence && M.updatePresence()).catch(() => {}); return null; }
// mood words from his params' moods; a long chat today lifts it, an ignored invite dims it a little; an away mood
// (params away) wins while it is strong
function moodNow(t, slot){
  const today = iso(t), rec = days[today];
  // through the core's awayNow (params away, else bond.away, else a declared key's), as the prompt reads it
  let aw = null; try { aw = can('state') && (M.state.awayNow ? M.state.awayNow(t) : M.state.away(knob('away', null), herDays(), today)); } catch {}
  if (aw && aw.strength >= 0.34) return aw.mood;
  let m = slot && slot.mood || '';
  // today's messages counted from the end (a chat keeps the order they came in), never the whole chat on every
  // look at his status (a 20 000-message import would make every message slow)
  const msgs = M.store.msgs || [];
  let n = 0;
  for (let i = msgs.length - 1; i >= 0; i--){ const d = M.msgDate(msgs[i]); if (!d) continue; const day = iso(d); if (day < today) break; if (day === today && d.getTime() <= t) n++; }
  if (n >= (Number(knob('day.long_chat', 20)) || 20)) m = String(knob('mood.lift_word', 'content'));
  if (rec && rec.her.some(h => h.at <= t && /ignor|expire/.test(h.what))) m = String(knob('mood.dim_word', 'tired'));
  return m;
}
// his status at t. Presence (asleep / busy / here) is his skeleton's alone (doing(t): his params, the same whether today's
// record is sketched yet or not), so the lock screen, the chat header and his reply pace never disagree. The slot he is in
// gives where and what only, and only one that agrees with it: asleep only a sleep slot (午睡, 补觉); awake never a sleep
// slot; free never a busy one; busy may be at anything awake (seen in a spare moment).
// The sketch's slots begin at his wake, not before (readSlots), so the record never shows him up while every label says asleep.
const SLEEPS = /^(在)?(睡觉|睡着|午睡|小睡|补觉|睡懒觉|睡回笼觉|打盹)|^(sleep|nap|asleep)/i;
function status(t){
  if (!who()) return null;
  t = +t;
  // the slot he is in: today's record, else last night's (a night worker at 02:00 is still in yesterday's day)
  const presence = doing(t), slotIn = r => r ? M.day.slotAt(M.day.visible(r, t), t) : null, s0 = slotIn(days[iso(t)]) || slotIn(days[iso(t - DAY)]);
  const sleeps = !!s0 && SLEEPS.test(s0.doing), slot = s0 && (presence === 'asleep' ? sleeps : !sleeps && !(s0.busy && presence === 'here')) ? s0 : null;
  return { presence, where: slot ? slot.where : '', busy: presence === 'busy', what: slot ? slot.doing : '', inChat: inChat(slot), since: slot ? slot.at : null, mood: moodNow(t, slot) };
}
// when he last got up (by his skeleton): today's wake, or yesterday's for one still up after midnight
function lastWake(t){ const p = plan(iso(t)); return p.wake <= t ? p.wake : plan(iso(t - DAY)).wake; }
// the moment a prompt is for: ctx.opts.at when a message of his is dated before now (a catch-up, a job run late), so
// his day is told as of then (no slot that had not begun); else now
const atOf = ctx => { const n = M.now().getTime(), a = Number(ctx && ctx.opts && ctx.opts.at); return a && a < n ? a : n; };
// "your day today", its own block near the "now" block (priority 71, so a long chat never pushes it out):
// what he has done since he got up (slots that have begun only, from today's record and last night's), her part today,
// tonight's diary once written, what is still ahead by his skeleton (his plans, never a sketched slot ahead), today's hints
function todayText(t){
  if (daysFor !== who() || !who()) return '';
  const today = iso(t), up = lastWake(t), slots = [];
  for (const d of [iso(t - DAY), today]){ const r = days[d]; if (r) slots.push(...M.day.visible(r, t).slots.filter(s => s.at >= up - HOUR && s.at <= t)); }
  const rec = days[today], v = rec ? M.day.visible(rec, t) : null, asleep = (status(t) || {}).presence === 'asleep', ahead = aheadText(t), parts = [];
  parts.push(slotsText(slots, true) || (up <= t && !asleep ? `- ${hhmm(up)} got up; nothing much yet` : ''));
  if (v && herText(v, t)) parts.push(`With her today:\n${herText(v, t)}`);
  // what he said beside another planner's day, once it has left the chat (while it is in the chat, the chat says it)
  const told = (saidOn[today] || []).filter(l => !inChat({ said: l.line, said_at: l.said_at }));
  if (told.length) parts.push(`You told her in chat:\n${told.map(l => `- ${hhmm(l.at)} ${l.line}`).join('\n')}`);
  if (v && v.entry && plan(today).diary <= t) parts.push(`Your diary tonight: ${v.entry}`);
  if (ahead) parts.push(`Still ahead today, as you planned it (it has not happened yet: never tell it as done): ${ahead}.`);
  const h = rec ? hintsText(rec) : '', body = parts.filter(Boolean);
  if (!body.length && !h) return '';
  const head = `Your day today (${today}, now ${hhmm(t)}${asleep ? ', you are asleep' : `; you got up at ${hhmm(up)}`}). You lived it; she knows only what you told her. When she asks what you are doing or have done today, answer from this:`;
  return (body.length ? `${head}\n${body.join('\n')}` : '') +
    (h ? `${body.length ? '\n\n' : ''}Known to you, never said (it may colour your mood and choices today; never say it, quote it or hint at it in words):\n${h}` : '');
}
// "his last days": the two days before today, as seen now (never a slot ahead), her part, his entries
function olderText(t){
  if (daysFor !== who()) return '';
  const out = [];
  for (let k = WINDOW_DAYS - 1; k >= 1; k--){
    const day = iso(t - k * DAY), r = days[day]; if (!r) continue;
    const v = M.day.visible(r, t), head = k === 1 ? `Yesterday (${day})` : day;
    const parts = [slotsText(v.slots, true) || (r.line ? `- ${r.line}` : ''), herText(v, t) ? `With her:\n${herText(v, t)}` : '', v.entry && !inLately(v.entry) ? `Your diary that night: ${v.entry}` : ''].filter(Boolean);
    if (parts.length) out.push(`${head}:\n${parts.join('\n')}`);
  }
  return out.length ? `Your own last days (you lived them; she knows only what you told her or did with her):\n${out.join('\n\n')}` : '';
}
// the whole window, as ModuLife.days(t) gives it: today, then the days before
// his diary came twice in one prompt (here and in the life block, where his diary app tells it); once is enough
function inLately(entry){ const k = plain(entry).slice(0, 24); return !!k && plain(lately).includes(k); }
function daysText(t){ return [todayText(t), olderText(t)].filter(Boolean).join('\n\n'); }

// --- his timed things, booked as jobs: the core's scheduler rings them; each runs as a wake ----------------------
async function book(kind, at, key, payload){
  const id = `life-${kind}-${key}`.slice(0, 64);
  try { if (await M.jobs.get(id)) return; await M.jobs.add({ id, kind, at, owner: 'life', payload: payload || null }); } catch(e){ console.error(e); }
}
async function bookDay(t){
  const today = iso(t), p = plan(today), tomorrow = iso(t + DAY);
  await book('wake', plan(tomorrow).wake, tomorrow);
  for (const x of p.posts) if (x.at > t) await book('post', x.at, x.id);
  if (p.diary > t) await book('evening', p.diary, today);
}
// the scheduler's way in: a due job of owner 'life' runs as one wake (it finds what is due by itself)
async function run(job){ await wake({ job: true }); return true; }
// "wake again in a moment" (after a load, or when one wake's budget ran out): a job on the one clock; a core without
// jobs.handle uses a timer
function later(ms){
  const t = M.now().getTime();
  if (hasScheduler()) return book('more', t + ms, String(t));
  clearTimeout(again); again = setTimeout(() => wake(), ms);
}


// --- what is due ------------------------------------------------------------------------------
async function due(t){
  // catch-up is capped: only today's posts and evening are single calls here; a day before
  // today is caught up in the one sketch call (catchUp), never one call per post or per evening
  const st = await state(), from = Math.max(st.since + GRACE, dayStart(iso(t)));
  const skipped = new Set(st.skipped || []);
  const have = await keptOf('post'), wrote = await keptOf('journal');
  const jobs = [];
  for (let d = dayStart(iso(from)) - DAY; d <= t; d += DAY){
    const p = plan(iso(d + 2 * HOUR));
    for (const x of p.posts) if (x.at > from && x.at <= t && !have.has(x.id) && !skipped.has(x.id)) jobs.push({ kind: 'post', id: x.id, at: x.at, day: p.day });
    if (p.diary > from && p.diary <= t && !wrote.has(p.day) && v05()) jobs.push({ kind: 'journal', id: p.day, at: p.diary, day: p.day });
  }
  for (const o of outlets()) if (o.answers && typeof o.answers.list === 'function')
    for (const r of await tryAsk(() => o.answers.list(), [])){ const l = (r.later || [])[0]; if (l && l.at <= t) jobs.push({ kind: 'react', app: o.app, post: r.id, at: l.at, what: l.what }); }
  jobs.sort((a, b) => a.at - b.at);
  return { jobs, st };
}

// --- waking up ----------------------------------------------------------------------------------
let running = null, calls = 0, budget = BUDGET, failUntil = 0, again = null, owner = '';
const same = () => owner === (M.currentId || '') + '|' + who();
// → Promise<{ wrote, left }>. opts.force: ignore a back-off after a failed model call.
function wake(opts = {}){
  if (running) return running;
  running = (async () => {
    let wrote = 0, left = 0;
    try {
      if (!who() || (!opts.force && Date.now() < failUntil)) return { wrote, left };
      owner = (M.currentId || '') + '|' + who(); calls = 0; budget = opts.budget || BUDGET;
      await appsReady();
      const t = M.now().getTime();
      // his day first: older days as skeletons, her part, the one catch-up call, the age-out batch,
      // an absence, the offered doings that passed; then today's single things below
      // one tab writes his day (the clock's leader): another open tab only reads it. A job (run by the leader's clock) and a
      // forced wake (a host or a test asking outright) count as leading
      const lead = !!(opts.force || opts.job) || !(can('clock') && M.clock.leader === false);
      if (v05() && lead) try {
        const st0 = await state();
        await skeletons(t, st0); await writeHer(t, st0);
        if (await catchUp(t, st0)) wrote++;
        await ageOut(t, st0); await absence(st0); await deeds(t, st0);
      } catch(e){ console.error(e); }
      if (v05()) await readDays();
      const { jobs, st } = await due(t);
      let i = 0;
      for (; i < jobs.length; i++){
        if (!same()) break;
        const j = jobs[i];
        if (j.kind !== 'react' || j.what !== 'like'){ if (calls >= budget || paused() || !lead) break; }
        try {
          if (j.kind === 'post') await doPost(j, st);
          else if (j.kind === 'journal') await doDiary(j);
          else await doReact(j);
          wrote++;
        } catch(e){ if (!isPaused(e)) failUntil = Date.now() + 5 * MIN; left = jobs.length - i; return { wrote, left }; }
      }
      left = jobs.length - i;
      if (paused() || !lead) left = 0;   // 暂停, or another tab leads: nothing is asked here; no retry loop
      if (!left && same() && v05()){ for (const j of await M.jobs.due(t)) if (j.owner === 'life') await M.jobs.done(j.id, 'life'); await bookDay(t); }
    } finally {
      running = null;
      refreshLately();
    }
    return { wrote, left };
  })().then(r => { if (r.left && Date.now() >= failUntil) later(8000); return r; });
  return running;
}

// She posted (her own record, already saved) or commented: he will see it later, on his own time.
// what: 'post' (her post) | 'comment' (her comment under his post). → Promise<record>
// Her post gets a comment 75 % of the time, only a 赞 20 %, nothing 5 %; her comment gets a reply 80 %.
const odds = { post: { comment: 0.75, like: 0.2 }, comment: { reply: 0.8 } };
// once he has answered her in the chat he is on his phone, so a post or comment of hers he has not
// answered yet is one he has seen: his planned answer comes SEEN_SOON minutes later, not hours later.
const SEEN_SOON = [2, 8];   // minutes
// The apps that keep things he answers later, through answers: get(id) → { at, later, answered, record } | null,
// plan(id, later) → record, list() → [{ id, at, later }], give(id, item, help). The plan [{ at, what }] is his;
// where it is kept is the app's.
const answering = () => outlets().filter(o => o.answers && typeof o.answers.get === 'function' && typeof o.answers.plan === 'function');
async function seenInChat(){
  if (!who()) return 0;
  await appsReady();
  const t = M.now().getTime(); let n = 0;
  for (const o of answering()){
    let posts = [];
    try { posts = (await o.answers.list()) || []; } catch { continue; }
    for (const p of posts){
      const later = p.later || [];
      if (!later.length || !(p.at <= t) || t - p.at > DAY) continue;
      const soon = t + (SEEN_SOON[0] + Math.floor(Math.random() * (SEEN_SOON[1] - SEEN_SOON[0] + 1))) * MIN;
      const last = later[later.length - 1].at; if (last <= soon) continue;
      const shift = last - soon;   // every step moves by the same amount, so a 赞 still comes before the comment
      const fresh = await o.answers.get(p.id);
      if (JSON.stringify((fresh ? fresh.later : later) || []) !== JSON.stringify(later)) continue;
      const moved = later.map(l => ({ at: Math.max(t + MIN, l.at - shift), what: l.what }));
      await o.answers.plan(p.id, moved);
      await book('react', moved[0].at, `${String(p.id).replace(/[^A-Za-z0-9_-]/g, '')}-${moved[0].at}`);
      n++;
    }
  }
  return n;
}
// id: the app's own id for her post (or for his post she commented under); app (optional): the app
// that keeps it, else the first app that knows the id.
async function react(id, what, app){
  await appsReady();
  for (const o of answering()){
    if (app && o.app !== app) continue;
    const cur = await o.answers.get(id); if (!cur) continue;
    const rec = cur.record;
    if ((cur.later || []).length) return rec;            // he will answer everything at once
    if ((cur.answered || 0) >= 3) return rec;             // a thread does not go on forever
    const p = odds[what] || {}, x = Math.random();
    let act = null;
    if (what === 'post') act = x < p.comment ? 'comment' : x < (p.comment + (p.like || 0)) ? 'like' : null;
    else act = x < p.reply ? 'reply' : null;
    if (!act) return rec;
    const t = M.now().getTime(), lo = Math.log(5 * MIN), hi = Math.log(3 * HOUR);
    const at = free(t + Math.round(Math.exp(lo + Math.random() * (hi - lo))));
    const later = [{ at, what: act }];
    if (act === 'comment' && Math.random() < 0.5) later.unshift({ at: at - MIN, what: 'like' });
    const rec2 = await o.answers.plan(id, later);
    await book('react', later[0].at, `${String(id).replace(/[^A-Za-z0-9_-]/g, '')}-${later[0].at}`);
    return rec2;
  }
  return null;
}

// --- what he knows of his own life (a context block, so he can say what he posted) ---------------
let lately = '';
async function refreshLately(){
  if (!who()) { lately = ''; return; }
  try {
    const t = M.now().getTime(), since = t - WINDOW_DAYS * DAY;
    const when = at => { const d = iso(at), today = iso(t), y = iso(t - DAY); return `${d === today ? 'today' : d === y ? 'yesterday' : d} ${hhmm(at)}`; };
    // each app that keeps his life tells it in its own lines (remember): his posts first, then his diary
    const lines = [];
    for (const o of ordered()) if (typeof o.remember === 'function') for (const l of await tryAsk(() => o.remember({ now: t, since, when }), [])) if (l) lines.push(String(l));
    lately = lines.length ? `What you did lately on your own phone, in your own words (you remember it; she may have seen your posts):\n${lines.join('\n')}` : '';
  } catch { lately = ''; }
  addBlock();
}
function addBlock(){
  try { if (!M.contextBlocks().some(b => b.id === 'life')) M.setContextBlock('life', { after: 'memory', priority: 45, budget: 1200, build: () => lately }); } catch {}
  // his last days: the 3-day window, as seen at the time the prompt is built
  try { if (!M.contextBlocks().some(b => b.id === 'days')) M.setContextBlock('days', { after: 'memory', priority: 46, budget: 1800, build: ctx => olderText(atOf(ctx)) }); } catch {}
  // his day today, right after the "now" block and kept before the history is cut (priority 71 > now's 70)
  try { if (!M.contextBlocks().some(b => b.id === 'today')) M.setContextBlock('today', { after: 'now', priority: 71, budget: 1500, build: ctx => todayText(atOf(ctx)).slice(0, ctx && ctx.budget != null ? ctx.budget : 1500) }); } catch {}
}

// --- presence over his day (core: setDayPlan) ----------------------------------------------------
// a status object { presence, where, busy, what, since, mood } read from his day record
function dayPlan(d){
  if (!who()) return null;
  const t = d.getTime(), s = status(t);
  // he just arrived and she is looking; not the default companion a fresh install put here (store.seeded)
  if (stateCache && stateFor === who() && !M.store.seeded && t - stateCache.since < HERE_AFTER_ARRIVAL && t >= stateCache.since) return Object.assign(s, { presence: 'here', busy: false });
  return s;
}
if (M.setDayPlan) M.setDayPlan(dayPlan);

M.on(ev => {
  if (ev === 'loaded'){ stateCache = null; lately = ''; days = {}; daysFor = ''; addBlock(); hookScheduler(); state().then(readDays).then(() => M.setDayPlan && M.setDayPlan(dayPlan)).then(() => M.paramsRead).then(() => later(1500)).catch(() => {}); }
  if (ev === 'records') { clearTimeout(refreshLately.t); refreshLately.t = setTimeout(() => { refreshLately(); readDays().then(() => M.updatePresence && M.updatePresence()).catch(() => {}); }, 300); }
});
// an invite of his she let go (the core's reach, at the end of his day): noted in life's own state, then in her part
async function noteIgnored(d){
  const st = await state(), t = M.now().getTime();
  if ((st.ignored || []).some(x => x.id === d.invite)) return;
  st.ignored = (st.ignored || []).concat({ id: String(d.invite || ''), at: t }).slice(-20); await saveState(st);
  if (v05()){ await writeHer(t, st); await readDays(); if (M.updatePresence) M.updatePresence(); }
}
M.on((ev, d) => { if (ev === 'reach' && d && d.op === 'invite' && d.state === 'ignored' && who()) noteIgnored(d).catch(e => console.error(e)); });
// her message, or the clock's beat: once the day turns, the window is read again
M.on((ev, d) => { if (ev === 'message' && d && d.is_user) daysFresh(); });
try { if (can('clock') && typeof M.clock.on === 'function') M.clock.on(() => { daysFresh(); }); } catch {}
// his reply's [promise: …]: the next slot of his day becomes what he said

M.on((ev, d) => { if (ev === 'message' && d && d.is_user === false && d.extra && Array.isArray(d.extra.modu_promises) && d.extra.modu_promises.length) promised(d.extra.modu_promises[0], M.msgDate(d) && M.msgDate(d).getTime()).catch(() => {}); });
// a plan he states in chat, with a time later today: that slot becomes it (a reply with a promise tag is the promise's)
M.on((ev, d) => { if (ev === 'message' && d && d.is_user === false && d.mes && v05() && !(d.extra && (d.extra.modu_reach || (Array.isArray(d.extra.modu_promises) && d.extra.modu_promises.length)))) heard(d).catch(() => {}); });
// his reply in the chat: he has seen what is waiting for him on 朋友圈
M.on((ev, d) => { if (ev === 'message' && d && d.is_user === false && d.mes) seenInChat().catch(() => {}); });
// the one clock: life's jobs (his wake, posts, evening, answers) are run by the core's scheduler on the clock's beat
// through run(); life keeps no timer. A core without jobs.handle (someone else's): a 30 s tick.
const hasScheduler = () => can('jobs') && !!M.jobs && typeof M.jobs.handle === 'function';
function hookScheduler(){ if (hasScheduler() && !hookScheduler.done){ hookScheduler.done = true; try { M.jobs.handle('life', run); } catch(e){ console.error(e); } } }
hookScheduler();
if (!hasScheduler()) setInterval(() => wake(), 30000);

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });

window.ModuLife = { version: '0.4', get KINDS(){ return kinds(); }, kinds, offers, plan, doing, wake, react, odds, seenInChat, SEEN_SOON, lately: () => lately, WINDOW_DAYS, BUDGET,
  // his status now, the window block's text, a life job run by the scheduler, her part of a day, 暂停
  status: t => status(t == null ? M.now().getTime() : +t), days: t => daysText(t == null ? M.now().getTime() : +t), run, herPart, paused, readSketch,
  // the time of day a plan of his names (→ ms on the day, or NaN), and what is still ahead today by his skeleton
  timeIn, isPlan, ahead: t => aheadText(t == null ? M.now().getTime() : +t) };
})();
