// app/core/seam.js: the body seam: BroadcastChannel + device bridge, presence, persona state, his 3D body model.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { emit, store, env, msgDate, gapWords, now, kvSet, kvGet, pronouns } = core;

// --- Persona state: one object, read as words by the prompt and as a face by the body seam ---
// v1 is derived, not stored: presence, the mood of his last reply (it lingers for two hours, then fades),
// the gap since they last talked. Published on the seam as {type:"persona", v:1, state} when it changes.
const MOOD_LINGER = 2 * 3600 * 1000;
// His day may say more than a presence word. setDayPlan's fn may return a status object
//   { presence: 'here' | 'asleep' | 'busy' | null, where, busy, what, inChat, since, mood }
// (where: '画室'; busy: true while he cannot really talk; what: what he is doing, in words; since: ms, when it
// began; mood: a word from his params' moods, e.g. 'tired', or an away mood; inChat: true while `what` is his own line,
// still in the chat his prompt reads, so the prompt does not say it twice). The ONE status object stays
// personaState(): these become its where / busy / what / since / moodWord. A plain word still works.
function dayStatus(t){
  if (!dayPlan) return null;
  let d = null; try { d = dayPlan(t); } catch { return null; }
  if (d && typeof d === 'object') return { presence: PRESENCE.includes(d.presence) ? d.presence : null, where: String(d.where || ''), busy: d.busy === true,
    what: String(d.what || d.doing || ''), inChat: d.inChat === true, since: Number(d.since) || null, mood: String(d.mood || '') };
  return PRESENCE.includes(d) ? { presence: d, where: '', busy: d === 'busy', what: '', since: null, mood: '' } : null;
}
function personaState(){
  const last = [...store.msgs].reverse().find(m => !m.is_user && m.extra && m.extra.modu_emotion);
  const lastAny = store.msgs.length ? msgDate(store.msgs[store.msgs.length - 1]) : null;
  const t = now(), ld = last ? msgDate(last) : null;
  const age = ld ? t - ld : Infinity;
  const mood = last && age < MOOD_LINGER ? last.extra.modu_emotion : 'neutral';
  const turn = phase === 'thinking' || phase === 'speaking';
  const st = dayStatus(t), own = st ? st.presence : null;
  // busy = this very turn; the words describe the moment before it (by his own day, when life.js gives one)
  const p = presence(), pw = p === 'busy' && turn ? (PRESENCE.includes(own) ? own : 'here') : p;
  const name = store.name || '', pr = pronouns().en.split('/')[0];
  const doing = p === 'asleep' ? 'asleep' : p === 'busy' ? (turn ? 'replying' : 'busy') : 'free';
  const gap = lastAny ? Math.max(0, t - lastAny) : null;
  const words = !name ? '' :
    `${name} is ${pw === 'asleep' ? 'asleep, or was until she wrote' : pw === 'busy' ? 'busy with his own things, and sees her message in a spare moment' : 'awake and free'}` +
    (mood !== 'neutral' ? `; the ${mood} from earlier has not quite gone (${gapWords(age)})` : '') + '.';
  const where = st ? st.where : '', what = st ? st.what : '', moodWord = st ? st.mood : '';
  const parts = [what && !(st && st.inChat) ? `Right now: ${what}` : '', where ? `at ${where}` : '', moodWord ? `feeling ${moodWord}` : ''].filter(Boolean);
  const more = !name || !parts.length ? '' : ' ' + parts.join(', ') + '.';
  return { v: 1, name, presence: p, doing, mood, moodAt: ld && mood !== 'neutral' ? ld.getTime() : null, lastAt: lastAny ? lastAny.getTime() : null, gapMin: gap == null ? null : Math.round(gap / 60000), pronoun: pr, words: words + more,
    where, busy: st ? (turn ? own === 'busy' : p === 'busy') : p === 'busy' && !turn, what, since: st ? st.since : null, moodWord };   // busy as the one label says
}
let personaSent = '';
function publishPersona(){
  const s = personaState(), key = JSON.stringify([s.name, s.presence, s.doing, s.mood, s.where, s.busy, s.what, s.moodWord]);
  if (key === personaSent) return; personaSent = key;
  publish({ type:'persona', v:1, state: { name: s.name, presence: s.presence, doing: s.doing, mood: s.mood, moodAt: s.moodAt, lastAt: s.lastAt, where: s.where, busy: s.busy, what: s.what, since: s.since, moodWord: s.moodWord } });
  emit('persona', s);
}

// --- Body seam -------------------------------------------------------------------------------
// Two outputs with the same events: the in-browser channel (the VRM face) and, when the user gives an
// address, the device bridge on their PC. The page never talks to a device itself.
// The channel is the host's (setEnv channel) or this runtime's BroadcastChannel, opened below; none: a no-op
let channel = { postMessage(){} };
const bridge = { ws:null, url:'', timer:null, status:'', drivers:[] };
function bridgeStatus(s, drivers){ bridge.status = s; if (drivers) bridge.drivers = drivers; emit('bridge', { status:s, drivers: bridge.drivers }); }
function bridgeConnect(url){
  bridge.url = url; if (bridge.ws) { try { bridge.ws.close(); } catch {} bridge.ws = null; }
  clearTimeout(bridge.timer); if (!url) { bridgeStatus('off'); return; }
  bridgeStatus('connecting');
  try {
    const ws = env.socket ? env.socket(url) : new WebSocket(url); bridge.ws = ws;
    ws.onopen = () => bridgeStatus('on');
    ws.onmessage = e => { try { const a = JSON.parse(e.data); if (a.type === 'ack') bridgeStatus('on', a.drivers || []); else onBodyEvent(a); } catch {} };
    ws.onclose = () => { if (bridge.url === url) { bridgeStatus('retry'); bridge.timer = setTimeout(() => bridgeConnect(url), 5000); } };
    ws.onerror = () => {};
  } catch(e){ bridgeStatus('bad'); }
}
function publish(ev){ channel.postMessage(ev); if (bridge.ws && bridge.ws.readyState === 1) { try { bridge.ws.send(JSON.stringify(ev)); } catch {} } }
let phase = 'idle';
function setPhase(p){ phase = p; publish({ type:'state', phase:p }); emit('phase', p); updatePresence(); }
// Presence (for the lock screen and the labels): 'here' | 'asleep' | 'busy', read from the body seam.
// busy while a turn is running (phase thinking / speaking); asleep in his quiet hours (00:00–07:00 by
// default), unless they talked in the last 30 minutes (if she is up at 2 am, so is he); here otherwise. A body (a device through the bridge, another page) may set it with a
// {type:"presence", state} event, which wins until it says "auto". Each change is published as
// {type:"presence", state, from:"phone"} so bodies can follow it (a sleeping face on the robot, say);
// events marked from:"phone" (another Modu tab) are not taken as a body's word.
const PRESENCE = ['here', 'asleep', 'busy'];
let presenceSet = '', presenceNow = '', quiet = [0, 7], dayPlan = null;
// setDayPlan(fn): fn(Date) → 'here' | 'asleep' | 'busy' | null, or a status object (above), his own
// day (app/life.js); null = the quiet hours
function setDayPlan(fn){ dayPlan = typeof fn === 'function' ? fn : null; updatePresence(); }
// presence({ own: true }): his own state, without "busy while a turn runs": the page's labels (header, lock,
// home) read this one, so sending never flashes 他在忙; the page shows 对方正在输入… while a reply is on its way instead
function presence(o){
  if (PRESENCE.includes(presenceSet)) return presenceSet;
  if (!(o && o.own) && (phase === 'thinking' || phase === 'speaking')) return 'busy';
  // when his own day (life.js, setDayPlan) has him asleep or busy, her message alone does not
  // wake him or free him; his own last message does (he answered, so he is up): the lock screen, the chat header and his
  // pace say the same thing
  // the quiet hours (no day of his) hold him asleep the same way: her message at 2 am waits for his wake
  const st = dayStatus(now()), held = st && st.presence ? (st.presence === 'asleep' || st.presence === 'busy') : inQuietHours(now());
  // the default companion a fresh install put here (store.seeded, firstRun) did not arrive with her: his move-in and
  // the greeting he came with are not time together, so before dawn he is asleep by his day, never 他在
  const born = store.seeded ? (store.importedAt || 0) + 60 * 1000 : 0;
  let lastMsg = null;
  for (let i = store.msgs.length - 1; i >= 0; i--){ if (held && store.msgs[i].is_user) continue; lastMsg = msgDate(store.msgs[i]); break; }
  if (lastMsg && lastMsg.getTime() <= born) lastMsg = null;
  // the moment he moved in counts as time together, so right
  // after an import at night he is here; asleep comes back 30 minutes later by the same rule.
  const last = Math.max(lastMsg ? lastMsg.getTime() : 0, store.seeded ? 0 : store.importedAt || 0) || null;
  if (last && now() - last < 30 * 60 * 1000 && now() - last >= 0) return 'here';
  // his own day (life.js, setDayPlan): asleep at night, sometimes busy; otherwise the quiet hours below
  if (st && st.presence) return st.presence;
  return inQuietHours(now()) ? 'asleep' : 'here';
}
function inQuietHours(d){ const h = new Date(d).getHours(); return quiet[0] <= quiet[1] ? h >= quiet[0] && h < quiet[1] : h >= quiet[0] || h < quiet[1]; }
// when he is next up, by his own day (setDayPlan) or the quiet hours: the first moment after t (10-minute steps, at
// most a day ahead) that is not asleep → ms, or null. Her messages do not count here (a reply booked for his wake)
function wakeAt(t){
  const ms = t == null ? now().getTime() : +t, step = 10 * 60 * 1000;
  for (let c = ms + step; c <= ms + 24 * 3600 * 1000; c += step){
    const st = dayStatus(new Date(c));
    if (st && st.presence) { if (st.presence !== 'asleep') return c; continue; }
    if (!inQuietHours(c)) return c;
  }
  return null;
}
function updatePresence(){ const p = presence(); if (p !== presenceNow){ presenceNow = p; publish({ type:'presence', state:p, from:'phone' }); emit('presence', p); } if (store.name) publishPersona(); }
function setPresence(state){ presenceSet = PRESENCE.includes(state) ? state : ''; updatePresence(); }
function onBodyEvent(ev){ if (ev && ev.type === 'presence' && ev.from !== 'phone') setPresence(ev.state); }
function onChannel(e){ onBodyEvent(e && e.data); }
// open (or swap) the in-browser channel; in Node it never keeps the process running
function openChannel(c){
  if (channel.removeEventListener) channel.removeEventListener('message', onChannel);
  channel = c || (typeof BroadcastChannel === 'function' ? new BroadcastChannel('modu-body') : { postMessage(){} });
  if (channel.addEventListener) channel.addEventListener('message', onChannel);
  if (typeof channel.unref === 'function') channel.unref();
}
openChannel(env.channel);
// no timer of its own: the presence moves on with the one clock's beat (app/core/clock.js)
core.ticker.on(updatePresence);

// --- Body model: his 3D avatar (a .vrm file), kept in this browser for every companion ------------
// Not in his folder yet: a VRM is big and often licensed for one person's use only.
async function setBodyModel(file){ await kvSet('vrm', file ? { name:file.name, blob:file } : null); emit('bodymodel', file ? file.name : ''); }
async function bodyModel(){ try { const v = await kvGet('vrm'); return v && v.blob ? v : null; } catch { return null; } }

Object.assign(core, { openChannel, personaState, publishPersona, bridge, bridgeConnect, publish, setPhase, PRESENCE, dayStatus,
  setDayPlan, presence, updatePresence, wakeAt, setPresence, setBodyModel, bodyModel });
})(globalThis[Symbol.for('modu.core')]);
