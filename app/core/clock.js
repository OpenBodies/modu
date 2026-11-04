// app/core/clock.js: the one clock: one timer while the page is open; every timed thing rides on it.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, now, jobs } = core;

// No part keeps its own timer (his life's wake loop, 信箱, 购物, 外卖, the page's clock face, the body
// seam's presence): clock.start() (the page calls it; a Node host may; a test calls tick() by
// hand) makes the only interval. Each beat:
//   1. the beat listeners (clock.on(fn)): the clock face, the presence for the body seam, an open screen showing
//      something on its way. They get the time and must be quick;
//   2. the before-round listeners (clock.before(fn), leader only): the 主动 check (app/core/reach.js), so a reopen's
//      look at the time away comes first, before a long job round (his day sketched for the missed days, the age-out);
//      after it, she may already have written and the reopen would no longer be a return;
//   3. the job round: jobs.run(t), only when a job is due (the soonest time is kept, so most beats read nothing);
//   4. the after-round listeners (clock.after(fn)).
// A beat that comes while the last one is still running (a model call) is skipped. A page out of sight may have its
// timer slowed by the browser; the page calls tick() again when she looks.
// Two tabs on one store must not both run his jobs or both write to her: one page leads (the Web Locks API,
// navigator.locks, lock 'modu-clock', held for the page's life); the others keep their beat (clock face, presence) and
// wait, taking over when the leader's page goes. Without the API (Node, an old browser) the page leads.
const BEAT = 10000, PRUNE_EVERY = 864e5, LOCK = 'modu-clock';
let timer = null, ticking = null, nextAt = 0, pruned = 0, lastBeat = 0, leader = true, electing = false;   // a host that never starts the clock leads its own ticks
function elect(locks){
  if (electing) return;
  if (!locks || typeof locks.request !== 'function'){ leader = true; return; }
  electing = true; leader = false;
  Promise.resolve(locks.request(LOCK, () => { leader = true; nextAt = 0; emit('clock', { op: 'leader', at: now().getTime() }); tick(); return new Promise(() => {}); }))
    .catch(() => { leader = true; });
}
const beats = new Set(), befores = new Set(), afters = new Set();
// a job booked or moved may be sooner than the one we wait for; a new companion starts from scratch
core.listeners.add((ev, d) => {
  if (ev === 'job' && d && d.job && d.job.state === 'pending') nextAt = Math.min(nextAt || Infinity, d.job.at);
  if (ev === 'loaded') nextAt = 0;
});
async function tick(o = {}){
  if (ticking) return ticking;
  ticking = (async () => {
    const t = now().getTime(); lastBeat = t;
    for (const f of beats){ try { f(t); } catch(e){ console.error(e); } }
    let res = null;
    if (leader) for (const f of befores){ try { await f(t); } catch(e){ console.error(e); } }
    if (leader && core.store && core.store.name && (o.force || !nextAt || t >= nextAt)){
      try {
        res = await jobs.run(t, { cap: o.cap });
        if (res.dropped.length) emit('clock', { op: 'dropped', at: t, dropped: res.dropped.map(d => ({ id: d.job.id, kind: d.job.kind, owner: d.job.owner, at: d.job.at, why: d.why })) });
        const n = await jobs.next(); nextAt = n == null ? Infinity : n;
        if (res.waiting) nextAt = t;   // more were due than one round takes: the next beat goes on
        if (t - pruned > PRUNE_EVERY){ pruned = t; jobs.prune().catch(() => {}); }
      } catch(e){ console.error(e); }
    }
    if (leader) for (const f of afters){ try { await f(t, res); } catch(e){ console.error(e); } }
    return res;
  })().finally(() => { ticking = null; });
  return ticking;
}
const clock = {
  // → true when this call made the timer (a second start makes none)
  // o: { every?, locks? (default navigator.locks) }
  start(o = {}){
    if (timer || typeof setInterval !== 'function') return false;
    elect(o.locks !== undefined ? o.locks : (typeof navigator !== 'undefined' && navigator.locks) || null);
    timer = setInterval(() => { tick(); }, Number(o.every) || BEAT);
    if (timer && timer.unref) timer.unref();
    emit('clock', { op: 'start', at: now().getTime() });
    tick();
    return true;
  },
  stop(){ if (timer) clearInterval(timer); timer = null; },
  get running(){ return !!timer; },
  get leader(){ return leader; },
  get last(){ return lastBeat; },
  tick,
  on(fn){ if (typeof fn === 'function') beats.add(fn); return () => beats.delete(fn); },
  before(fn){ if (typeof fn === 'function') befores.add(fn); return () => befores.delete(fn); },
  after(fn){ if (typeof fn === 'function') afters.add(fn); return () => afters.delete(fn); },
  BEAT,
};

Object.assign(core, { ticker: clock });   // core.clock is time.js's clock function; the public name is ModuCore.clock
})(globalThis[Symbol.for('modu.core')]);
