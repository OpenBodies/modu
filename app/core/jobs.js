// app/core/jobs.js: jobs: everything that should happen later (a kept promise, an order arriving, his post), booked through the core; and the bell, how a due job reaches her.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, clone, now, records, RECORD_TYPE } = core;

// A job is a record in his folder, job/<id>.json, so it survives a reload, a backup and another host:
//   { v, id, kind, at (ms: when it is due), expire? (ms: after it, it is dropped, never run late), force? (true:
//     due even in her quiet hours / over the day's cap; the scheduler decides what that means), owner (an app's
//     id, or 'core' / 'life'), payload (the owner's own JSON), state: 'pending' | 'done' | 'dropped', writer, rev }
// Apps book jobs only here (never their own timers for his life), and say the kinds they book when they register
// (`jobs: { kinds: [...] }`); the core never reads a payload and never knows an app.
// Running them: each owner says once how its jobs are done
// (handle(owner, fn)), and run(t) (called by the one clock, app/core/clock.js; never a timer here) takes the due
// jobs soonest first, drops the expired ones, and runs each through its owner exactly once.
const JOB_TYPE = 'job', STATES = ['pending', 'done', 'dropped'];
const OWNER = /^(?:core|life|[a-z][a-z0-9-]{0,31})$/;
function checkJob(j){
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('任务必须是一个对象');
  if (!RECORD_TYPE.test(String(j.kind || ''))) throw new Error(`任务种类「${j.kind}」无法使用`);
  if (!OWNER.test(String(j.owner || ''))) throw new Error(`任务的主人「${j.owner}」无法使用`);
  if (!isFinite(Number(j.at))) throw new Error('任务需要一个时间');
}
// A job with the id of one already booked is never booked again: the stored one comes back unchanged (a done or
// dropped job is never revived, so a job runs once whoever books or runs it). Writes go through records.commit.
async function add(job){
  checkJob(job);
  if (job.id){ const had = await get(job.id); if (had) return had; }
  const t = now().getTime(), j = { v: 1, kind: String(job.kind), at: Number(job.at), owner: String(job.owner), payload: job.payload == null ? null : clone(job.payload),
    state: 'pending', writer: String(job.writer || job.owner), rev: 1, made: t };
  if (job.id) j.id = String(job.id);
  if (job.expire != null && isFinite(Number(job.expire))) j.expire = Number(job.expire);
  if (job.force === true) j.force = true;
  const w = await records.commit(JOB_TYPE, j, { writer: j.writer, app: 'job' });
  if (!w.ok) return w.record;   // another writer booked the same id first
  emit('job', { op: 'add', job: w.record });
  return w.record;
}
async function get(id){ try { return await records.get(JOB_TYPE, String(id)); } catch { return null; } }
async function mark(id, state, writer, why){
  const j = await get(id); if (!j) return null;
  if (j.state !== 'pending') return j;   // a job ends once: the first writer wins
  const w = await records.commit(JOB_TYPE, Object.assign({}, j, { state, rev: (Number(j.rev) || 0) + 1, ended: now().getTime() }, why ? { why: String(why).slice(0, 40) } : {}), { writer: String(writer || j.writer), app: 'job' });
  if (!w.ok) return w.record;            // someone ended it in between: theirs stands
  emit('job', { op: state === 'done' ? 'done' : 'drop', job: w.record });
  return w.record;
}
// a pending job moved to a later time (its owner said "not yet": her quiet hours, he is asleep); `at` only grows
async function move(id, at, writer){
  const j = await get(id); if (!j || j.state !== 'pending' || !isFinite(Number(at))) return j;
  const w = await records.commit(JOB_TYPE, Object.assign({}, j, { at: Math.max(Number(at), j.at), rev: (Number(j.rev) || 0) + 1 }), { writer: String(writer || j.owner), app: 'job' });
  if (w.ok) emit('job', { op: 'move', job: w.record });
  return w.record;
}
// → job[] by `at` (soonest first); o: { owner?, kind?, state? }
async function list(o = {}){
  let all = []; try { all = await records.list(JOB_TYPE); } catch { all = []; }
  return all.filter(j => (!o.owner || j.owner === o.owner) && (!o.kind || j.kind === o.kind) && (!o.state || j.state === o.state));
}
// → the pending jobs whose time has come (at ≤ t) and not past their expire, soonest first. A read: it changes nothing.
async function due(t){
  const ms = t == null ? now().getTime() : +t;
  return (await list({ state: 'pending' })).filter(j => j.at <= ms && !(j.expire != null && j.expire < ms));
}

// --- running them ---------------------------------------------------------------------------------------------
// handle(owner, fn): how this owner's jobs are done. fn(job, { t, late, batch }) may return 'drop' (or { drop: why }),
// { at } (not yet: moved to a later time), 'wait' (left as it is, tried on the next run), or anything else (done).
// A job whose owner has not said yet (an app still loading) waits. A handler that throws is tried again later
// (1, 5, 15, 60 minutes), then dropped as 'failed': never a loop.
const handlers = new Map(), inflight = new Set(), RETRY = [1, 5, 15, 60];
// Before its handler runs, a job is claimed ({ by: this realm, at }) with a rev-checked write, so two pages on one store
// (two tabs) never both run it: the loser of the write, or anyone seeing a fresh claim of another's, skips it. A claim
// older than CLAIM_MS (its page went away mid-run) may be taken over.
const ME = Math.random().toString(36).slice(2, 10), CLAIM_MS = 2 * 60000;
function handle(owner, fn){
  if (!OWNER.test(String(owner || ''))) throw new Error(`任务的主人「${owner}」无法使用`);
  if (typeof fn === 'function') handlers.set(String(owner), fn); else handlers.delete(String(owner));
  return [...handlers.keys()];
}
// run(t?, { cap? }) → { ran: [job], dropped: [{ job, why }], waiting }: one round. The expired ones are dropped
// (why 'expired'); then at most `cap` due jobs (default 20) run, soonest first, each once (a job another run or
// another writer has ended is skipped). `batch` tells a handler what else is due in this round (the scheduler's
// flood cap on catch-up reads it). One round at a time: a second call waits for the first.
let round = null;
function run(t, o = {}){
  if (round) return round;
  round = (async () => {
    const ms = t == null ? now().getTime() : +t, cap = Math.max(1, Number(o.cap) || 20), ran = [], dropped = [];
    const pending = await list({ state: 'pending' });
    for (const j of pending) if (j.expire != null && j.expire < ms){ const r = await mark(j.id, 'dropped', 'core', 'expired'); if (r) dropped.push({ job: r, why: 'expired' }); }
    const due = pending.filter(j => j.at <= ms && !(j.expire != null && j.expire < ms)).sort((a, b) => a.at - b.at || (a.made || 0) - (b.made || 0));
    const batch = due.map(j => clone(j));
    for (const j of due.slice(0, cap)){
      const fn = handlers.get(j.owner);
      if (!fn || inflight.has(j.id)) continue;
      inflight.add(j.id);
      try {
        const fresh = await get(j.id); if (!fresh || fresh.state !== 'pending' || fresh.at > ms) continue;
        const wall = Date.now();
        if (fresh.claimed && fresh.claimed.by !== ME && wall - (Number(fresh.claimed.wall) || 0) < CLAIM_MS) continue;
        const cl = await records.commit(JOB_TYPE, Object.assign({}, fresh, { claimed: { by: ME, at: ms, wall }, rev: (Number(fresh.rev) || 0) + 1 }), { writer: String(fresh.writer || 'core'), app: 'job' });
        if (!cl.ok) continue;   // another page claimed it first
        // two pages may both pass the rev check on a store with no transaction: wait a moment and read the claim back;
        // the claim that stands runs the job
        if (typeof setTimeout === 'function') await new Promise(res => setTimeout(res, 30));
        const back = await get(j.id); if (!back || back.state !== 'pending' || !back.claimed || back.claimed.by !== ME) continue;
        let r;
        try { r = await fn(clone(cl.record), { t: ms, late: Math.max(0, ms - fresh.at), batch }); }
        catch(e){
          console.error(e);
          const now2 = await get(j.id) || cl.record, tries = (Number(now2.tries) || 0) + 1;
          if (tries > RETRY.length){ const d = await mark(j.id, 'dropped', 'core', 'failed'); if (d) dropped.push({ job: d, why: 'failed' }); }
          else { await records.commit(JOB_TYPE, Object.assign({}, now2, { tries, claimed: null, rev: (Number(now2.rev) || 0) + 1 }), { writer: 'core', app: 'job' }); await move(j.id, ms + RETRY[tries - 1] * 60000, 'core'); }
          continue;
        }
        if (r === 'wait'){ const w2 = await get(j.id); if (w2 && w2.state === 'pending') await records.commit(JOB_TYPE, Object.assign({}, w2, { claimed: null, rev: (Number(w2.rev) || 0) + 1 }), { writer: 'core', app: 'job' }); continue; }
        if (r === 'drop' || (r && r.drop)){ const d = await mark(j.id, 'dropped', j.owner, r.drop || 'owner'); if (d) dropped.push({ job: d, why: r.drop || 'owner' }); }
        else if (r && isFinite(Number(r.at)) && Number(r.at) > ms) await move(j.id, Number(r.at), j.owner);
        else { const d = await mark(j.id, 'done', j.owner); if (d) ran.push(d); }
      } finally { inflight.delete(j.id); }
    }
    return { ran, dropped, waiting: Math.max(0, due.length - cap) };
  })().finally(() => { round = null; });
  return round;
}
// the soonest time any pending job is due (or expires), or null: the clock skips rounds until then
async function next(){
  let t = null;
  for (const j of await list({ state: 'pending' })) for (const x of [j.at, j.expire]) if (x != null && isFinite(x) && (t == null || x < t)) t = x;
  return t;
}
// ended jobs older than `days` (default 14) are removed from his folder: they did their work
async function prune(days = 14){
  const before = now().getTime() - days * 864e5; let n = 0;
  for (const j of await list()) if (j.state !== 'pending' && (j.ended || j.at) < before){ try { await records.remove(JOB_TYPE, j.id); n++; } catch {} }
  return n;
}
const jobs = { add, get, list, due, cancel: id => mark(id, 'dropped', 'her'), done: (id, writer) => mark(id, 'done', writer), drop: (id, writer, why) => mark(id, 'dropped', writer, why),
  move, handle, run, next, prune, get owners(){ return [...handlers.keys()]; }, STATES: STATES.slice() };

// --- the bell: how a due job reaches her (a named seam) ------------------------------------------------------
// ring(note) with note = { title, line, app?, job?, at?, tag? }: the core emits `bell` with it, and calls the host's
// ringer when one is set. The page shows it as an in-page notice (a toast; the system notification only if she
// already allowed it, as watch's notify). A native shell can set a ringer that posts a local notification
// while the phone is locked. The bell decides nothing (whether to ring is the scheduler's and her settings').
let ringer = null;
const bell = {
  set(fn){ ringer = typeof fn === 'function' ? fn : null; return !!ringer; },
  async ring(note){
    const n = Object.assign({ at: now().getTime() }, clone(note || {}));
    if (!n.line && !n.title) throw new Error('铃声需要一句话');
    emit('bell', n);
    if (ringer){ try { await ringer(n); } catch(e){ console.error(e); } }
    return n;
  },
  get host(){ return !!ringer; },
};

Object.assign(core, { JOB_TYPE, jobs, bell });
})(globalThis[Symbol.for('modu.core')]);
