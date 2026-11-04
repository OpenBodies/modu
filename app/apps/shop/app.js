// 购物 (shop), a page-2 app. Play money only: a catalogue Modu wrote itself (names and
// lines in words.txt, the page's own icons), paid from 钱包 through its api (apps/wallet/README.md).
// Buying stays in 购物, nothing jumps to the chat.
// 下单 → an order page with a 物流 timeline; when it arrives, a `delivered` event goes into the event log
// which is how he knows. 找他代付: he decides in one turn of his (the core's turn), his words are shown
// here, and he pays from his own wallet. 他的东西: what she gave him, once it arrived. 他可能喜欢:
// a shelf the model writes from his tastes once a day at most, guarded, his old shelf kept.
// Her orders are hers: the record type `shop` on her phone (ctx.mine, her store). His things
// and his shelf: the record type `shop` in his folder (the core's records), told apart by `kind`.
// 外卖 (apps/food) is the same code with its own CONFIG; the two files differ only in CONFIG and these notes.
(function(){
'use strict';
const MIN = 60000, HOUR = 60 * MIN;
const CONFIG = {
  id: 'shop', place: '购物', icon: 'i-bag',
  // what it writes, held to it by static_check
  writes: { records: ['shop'], mine: ['shop'], events: { delivered: '送到了', 'daifu-paid': '他代付了', 'daifu-declined': '他没有代付', gift: '他送的', 'gift-accepted': '收下礼物' }, chat: 'none' },
  // id, price in fen, icon (the page's own symbols). Names and lines: app.shop.item.<id>(.line) in words.txt
  items: [
    ['scarf', 12900, 'i-shirt'], ['candle', 6800, 'i-moon'], ['vinyl', 15800, 'i-music'], ['beans', 8800, 'i-food'],
    ['bear', 9900, 'i-smile'], ['pen', 21000, 'i-pen'], ['flowers', 6600, 'i-sun'], ['book', 4900, 'i-book'],
  ],
  // 物流: each stage and how long after the order it is reached; the last one is 签收 (delivered), and is
  // only shown once the delivered round has run. Words: app.shop.track.<stage>
  track: [['placed', 0], ['shipped', 2 * HOUR], ['transit', 8 * HOUR], ['out', 20 * HOUR], ['delivered', 24 * HOUR]],
  // 他可能喜欢: how many the guard takes, the price range (fen); app and things fill app/prompts/shelf.txt
  likes: { min: 3, max: 6, low: 500, high: 200000, app: 'a shopping app', things: 'things' },
  // his own doing for his day (offered to app/life.js), and what one costs him (fen); verb / verbEn / vague read the slot's words
  life: { kind: 'shopping', words: '网上买点东西', low: 2900, high: 19900,
    // the doing only where a doing starts (the start, after punctuation, after where he buys), and never the first character of
    // a word (淘宝, 买单): 逛淘宝买书 → 书
    verb: /(?:^|(?<=[：:，,、。；;\s]|网上|在网上|手机上|淘宝上?|京东上?|店里|顺手|又|就|先|去))(?:下单了?|网购了?|入手了?|淘了?|买了?)(?![宝单家])(?:个|件|点|一些|一件|一个|一点|一双|一本|一套|本|双|套)?/,
    verbEn: /^(?:i\s+)?(?:bought|buy|buying|ordered|order|ordering|got|get|picked up|shopped for)\s+(?:some\s+|a\s+|an\s+)?(?:new\s+)?(?:things?\s+|stuff\s+)?(?:online\s+)?/i,
    vague: /^(?:东西|点东西|日用品|网购|购物|淘宝|逛淘宝|逛逛|随便看看|看看|浏览|快递|things?|stuff|something|online|shopping|online shopping|window shopping|browsing|browse|groceries|in|out|some|it)$/i,
    plain: 'an online order' },   // the name outside a Chinese chat when the words give none
  // what he is told (not shown to her; like the core's own rules, kept in code)
  told: {
    pick: list => `（小手机里发生的事）她打开购物，想让你挑一件送她。下面是能买的东西（编号: 名字 价格）：\n${list}\n按你的性格和你对她的了解决定送不送、送哪一件，像平时发消息一样回她一两句。最后单独一行写 [送: 编号]；不想送就写 [送: 不]。`,
    daifu: (name, price) => `（小手机里发生的事）她在购物里看中了「${name}」（¥${price}，小手机里的零钱），想找你代付，用你自己的钱包。按你的性格和你对她的了解决定付不付，像平时发消息一样回她一两句。最后单独一行写 [代付: 付] 或 [代付: 不付]。`,
  },
  // the event log's lines, written for him
  log: {
    deliveredHim: name => `她在购物给你买的「${name}」送到了，现在是你的了`,
    deliveredGift: name => `你在购物送她的「${name}」送到她那儿了`,
    deliveredPaid: name => `你给她代付的「${name}」送到她那儿了`,
    paid: (name, price) => `她在购物找你代付「${name}」¥${price}，你付了`,
    declined: (name, price) => `她在购物找你代付「${name}」¥${price}，你没有付`,
    short: (name, price) => `她在购物找你代付「${name}」¥${price}，你想付，可你的零钱不够`,
    gift: name => `你在购物给她挑了「${name}」送她`,
    accepted: name => `她收下了你在购物送她的「${name}」`,
  },
};
const ID = CONFIG.id, TYPE = CONFIG.id, LIKES = 'likes';
const LAST = CONFIG.track[CONFIG.track.length - 1][1];
const M = () => window.ModuCore;
const mine = () => M().myRecords;      // her phone: her orders
const wallet = () => { const w = window.ModuApps.get('wallet'); return w && w.api; };
// time is the core's one clock (ModuCore.now), so ?at= and a test's clock move deliveries,
// their jobs and the 代付 window together (the jobs already ran on it)
const now = () => { const c = M(); return c && c.now ? c.now().getTime() : Date.now(); };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const yuan = c => (Math.round(c) / 100).toFixed(2);
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return [...s].length > n ? [...s].slice(0, n).join('') + '…' : s; };
const his = () => (M().store && M().store.name) || '';
const userName = () => (M().store.meta && M().store.meta.user_name) || 'You';
// her name in his prompts is the one she gave in 聊天设置 (ModuCore.userName); what is stored keeps her chat's own
const promptName = () => M().userName ? M().userName() : userName();
const newId = () => now().toString(36) + Math.random().toString(36).slice(2, 6);
const item = id => { const it = CONFIG.items.find(x => x[0] === id); return it && { id: it[0], price: it[1], icon: it[2] }; };
const W = k => `app.${ID}.${k}`;
const nameOf = (T, id) => T(W('item.' + id));
const pad = n => String(n).padStart(2, '0');
const md = at => { const d = new Date(at); return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dayOf = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
let watchCtx = null;         // what the page gave watch(): T, notify(text)
let want = '';               // an order to open on the next mount (a tap on an old chat card)
let offered = 0;             // she said 好啊 to his 代付 offer; until this time her next order for herself is his to pay

// Hooks (nothing here sets them): hooks.delivered(order) is called once, after an
// order's delivered event is in the log, e.g. so he may message her first about what arrived.
const hooks = { delivered: null };

// [送: 编号] / [送: 不] (also 礼物, gift; any bracket kind). → { text, pick: id or '' }
const PICK = /[\[【(（]\s*(?:送|礼物|gift|pick)\s*[:：]\s*([A-Za-z0-9_-]+|不|无|none|no)\s*[\]】)）]/gi;
function readPick(raw){
  let pick = '';
  const text = String(raw == null ? '' : raw).replace(PICK, (m, v) => { if (item(v)) pick = v; return ''; });
  return { text: text.replace(/\n{3,}/g, '\n\n').trim(), pick };
}

// one line into the phone's event log, so in chat he knows what happened; never fatal
function log(who, what, line, detail, at){ const c = M(); return c.logEvent ? c.logEvent({ app: ID, title: CONFIG.place, who, what, line, detail, at }).catch(e => console.error(e)) : null; }

// ---- 钱包: who pays. The one place that says how (one wallet
// for her, and each companion his own). Both go through its api.pay, saying whose money it is with `who`;
// 钱包 decides how that reaches her wallet or his. ----
const payAsHer = (w, o) => w.pay({ amount: o.price, note: o.name, app: ID, kind: 'order', ref: o.id, to: o.for === 'him' ? o.toName : '', who: 'her' });
const payAsHim = (w, o) => w.pay({ amount: o.price, note: o.name, app: ID, kind: 'daifu', ref: o.id, to: userName(), who: 'him' });

// ---- the goods: the catalogue and his shelf ----
async function getLikes(){ const r = await M().records.get(TYPE, LIKES); return r && r.kind === 'likes' && Array.isArray(r.items) ? r : null; }
async function good(id, T){
  const it = item(id);
  if (it) return { id, name: nameOf(T, id), line: T(W('item.' + id + '.line')), price: it.price, icon: it.icon, src: 'catalogue' };
  const l = await getLikes(), x = l && l.items.find(g => g.id === id);
  return x ? { id, name: x.name, line: x.line, price: x.price, icon: x.icon || CONFIG.icon, src: 'likes' } : null;
}
const what = g => ({ item: g.id, name: g.name, line: g.line, icon: g.icon, price: g.price, src: g.src });

// ---- 他可能喜欢: one side call a day at most, a strict guard, his old shelf kept ----
// guardLikes(list) → { ok, items: [{ name, line, price (fen) }], why }. Anything off and the whole reply is refused.
// An item says why in `why` (app/prompts/shelf.txt) or `line` (older records); either way it is kept as `line`.
function guardLikes(list){
  const L = CONFIG.likes, no = why => ({ ok: false, items: [], why });
  if (!Array.isArray(list)) return no('not a list');
  if (list.length < L.min || list.length > L.max) return no('count ' + list.length);
  const seen = new Set(), items = [];
  for (const x of list){
    if (!x || typeof x !== 'object' || Array.isArray(x)) return no('not an object');
    if (Object.keys(x).some(k => !['name', 'line', 'why', 'price'].includes(k))) return no('other fields');
    const said = x.why != null ? x.why : x.line;
    const name = typeof x.name === 'string' ? x.name.trim() : '', line = typeof said === 'string' ? said.trim() : '';
    if (!name || [...name].length > 12) return no('name');
    if (!line || [...line].length > 24) return no('line');
    if (/[<>{}\[\]\n\r\\]|https?:|www\./i.test(name + line)) return no('characters');
    const p = x.price, fen = Math.round(p * 100);
    if (typeof p !== 'number' || !Number.isFinite(p) || Math.abs(p * 100 - fen) > 1e-6 || fen < L.low || fen > L.high) return no('price');
    if (seen.has(name)) return no('twice');
    seen.add(name); items.push({ name, line, price: fen });
  }
  return { ok: true, items, why: '' };
}
// readLikes(raw): the model's text → the guard's answer: {"items":[…]} (shelf.txt) or a bare JSON array, among other lines
function readLikes(raw){
  const s = String(raw == null ? '' : raw), o = s.match(/\{[\s\S]*\}/);
  if (o){ try { const j = JSON.parse(o[0]); if (j && Array.isArray(j.items)) return guardLikes(j.items); } catch {} }
  const m = s.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (!m) return { ok: false, items: [], why: 'no JSON' };
  let a; try { a = JSON.parse(m[0]); } catch { return { ok: false, items: [], why: 'bad JSON' }; }
  return guardLikes(a);
}
// fallbackLikes(T): the hand-written list, app.<id>.like.1 … (名字 | 一句 | 价格 in 元), through the same guard
function fallbackLikes(T){
  const out = [];
  for (let i = 1; i <= CONFIG.likes.max; i++){
    const k = W('like.' + i), v = T(k); if (!v || v === k) break;
    const [name, line, price] = String(v).split('|').map(s => s.trim());
    out.push({ name, line, price: Number(price) });
  }
  return guardLikes(out);
}
// What the call is given, and nothing else: never the chat, never his whole persona. His tastes
// (params.tastes: the card's or calibration's lines; with none, the card's short personality field, cut), his day so far
// (the day record's slots that have begun, else his status words), the last one or two things he remembers of her, the
// season and the date.
async function shelfVars(){
  const c = M(), t = now(), d = new Date(t), p = c.pronouns ? c.pronouns() : {}, L = CONFIG.likes;
  let tastes = [].concat((c.param && c.param('tastes', [])) || []).map(x => typeof x === 'string' ? x : (x && (x.line || x.text || x.name)) || '').map(x => String(x).trim()).filter(Boolean);
  if (!tastes.length){ const pe = c.store.card && c.store.card.personality; if (pe) tastes = [clip(pe, 160)]; }
  let today = '';
  try { const r = c.day && await c.day.get(), v = r && c.day.visible(r, t);
    today = v && Array.isArray(v.slots) ? v.slots.map(x => `${pad(new Date(x.at).getHours())}:${pad(new Date(x.at).getMinutes())} ${x.doing || ''}${x.where ? ' (' + x.where + ')' : ''}`.trim()).join('\n') : ''; } catch {}
  if (!today){ const ps = c.personaState ? c.personaState() : null; today = (ps && ps.words) || ''; }
  const mem = (c.store.memory || []).filter(m => m && m.text && ['fact', 'moment'].includes(m.kind || 'fact') && !m.faded)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).slice(-2).map(m => clip(m.text, 80));
  const lang = c.chatLanguage ? c.chatLanguage(c.store.msgs) : '';
  return { char: his(), user: promptName(), pronoun: p.zh || '他', pronoun_en: p.en || 'he/him', app: L.app, things: L.things,
    tastes: tastes.map(x => '- ' + x).join('\n') || '(none written down)', today: today || '(nothing yet)', about_her: mem.join('\n'),
    season: ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'][d.getMonth()],
    date: dayOf(t), low: String(L.low / 100), high: String(L.high / 100), lang: lang === 'en' ? 'English' : 'Chinese' };
}
// the day the shelf was last asked for (an older record has only `made`); due again on a later day
const lastTry = l => (l && (l.tried || (l.made ? dayOf(l.made) : ''))) || '';
const likesDue = l => !l || lastTry(l) !== dayOf(now());
// makeLikes(ctx) → his shelf record. At most one call a day: asked for today already, it is given back as it is. The
// call goes through sideCall('shelf') (counted in 用量, refused while 暂停). A refused call is no try (it is asked again
// once 暂停 is off); a failed call or an answer the guard refuses keeps the shelf he had (yesterday's); only when he has
// none yet does words.txt's list stand in.
let making = null;
async function makeLikes(ctx){
  if (making) return making;
  const T = (ctx && ctx.T) || (k => k);
  making = (async () => {
    const c = M(), old = await getLikes();
    if (!likesDue(old)) return old;
    let g, refused = false;
    try {
      const text = c.prompt && c.sideCall ? await c.prompt('shelf', await shelfVars()) : '';
      g = text ? readLikes(await c.sideCall('shelf', [{ role: 'user', content: text }], { max: 500 })) : { ok: false, items: [], why: 'no prompt' };
    } catch(e){ refused = !!(e && e.code === 'paused'); g = { ok: false, items: [], why: (refused ? 'paused: ' : 'model: ') + String(e && e.message || e).slice(0, 80) }; }
    const tried = refused ? lastTry(old) : dayOf(now());
    if (!g.ok && old) return c.records.put(TYPE, Object.assign({}, old, { why: g.why, tried }), { app: ID });   // yesterday's shelf stays
    let from = 'model';
    if (!g.ok){ const why = g.why; g = fallbackLikes(T); g.why = why; from = 'words'; }
    const made = now();
    const items = g.items.map((x, i) => Object.assign({ id: `like-${made.toString(36)}-${i}`, icon: CONFIG.icon }, x));
    return c.records.put(TYPE, { id: LIKES, kind: 'likes', items, from, why: g.why || '', made, tried }, { app: ID });
  })().finally(() => { making = null; });
  return making;
}

// ---- 物流 ----
// stageOf(order) → the index in CONFIG.track it has reached (-1: not placed). 签收 only once delivered.
function stageOf(o, t = now()){
  if (!o || !o.placedAt) return -1;
  if (o.deliveredAt) return CONFIG.track.length - 1;
  let k = 0; CONFIG.track.forEach(([, ms], i) => { if (t - o.placedAt >= ms) k = i; });
  return Math.min(k, CONFIG.track.length - 2);
}

// ---- she buys: for him or for herself. Paid from her wallet; the order is hers; he hears of it when it arrives ----
async function buy(id, forWhom, ctx){
  const T = ctx.T, g = await good(id, T), w = wallet();
  if (!g) return null;
  if (!w) { ctx.toast(T(W('toast.nowallet'))); return null; }
  const o = Object.assign(what(g), { id: newId(), for: forWhom === 'him' ? 'him' : 'me', from: 'me', pay: 'me', to: M().currentId || '', toName: his(), state: 'paid' });
  // he offered to pay (his 代付 invite, accepted): this one is his
  if (o.for === 'me' && offered > now()){
    o.pay = 'him'; offered = 0;
    let p2; try { p2 = await payAsHim(w, o); } catch(e){ ctx.toast(T(W('toast.fail'))); return null; }
    await log('him', 'daifu-paid', CONFIG.log.paid(o.name, yuan(o.price)), { id: o.id });
    return mine().put(TYPE, Object.assign(o, { placedAt: now(), wallet: p2.id }), { app: ID });
  }
  let paid;
  try { paid = await payAsHer(w, o); }
  catch(e){ ctx.toast(e.code === 'short' ? T('app.wallet.toast.short') : T(W('toast.fail'))); return null; }
  return mine().put(TYPE, Object.assign(o, { placedAt: now(), wallet: paid.id }), { app: ID });
}

// ---- 找他代付: her order, his answer in one turn of his (shown here), his money ----
async function askPay(id, ctx, opts = {}){
  const T = ctx.T, g = await good(id, T);
  if (!g) return null;
  if (!wallet()) { ctx.toast(T(W('toast.nowallet'))); return null; }
  const o = await mine().put(TYPE, Object.assign(what(g), { id: newId(), for: 'me', from: 'me', pay: 'him', to: M().currentId || '', toName: his(), state: 'asking' }), { app: ID });
  if (opts.created) opts.created(o);
  return answerPay(o.id, ctx);
}
const asking = new Set();
async function answerPay(oid, ctx){
  const T = ctx.T, o = await mine().get(TYPE, oid);
  if (!o || o.pay !== 'him' || !['asking', 'noanswer'].includes(o.state) || asking.has(oid)) return o;
  if (o.to !== (M().currentId || '')) return o;      // only he answers, with him open
  asking.add(oid);
  try {
    if (o.state !== 'asking') await mine().put(TYPE, Object.assign({}, o, { state: 'asking' }), { app: ID });
    let r;
    try { r = await M().turn(CONFIG.told.daifu(o.name, yuan(o.price)), { tags: ['代付'], max: 300 }); }
    catch(e){ ctx.toast(T(W('toast.noanswer'))); return await mine().put(TYPE, Object.assign({}, o, { state: 'noanswer' }), { app: ID }); }
    // the tag decides; with none, he pays (as a 红包 with no tag is kept); [no-reply] and no tag: he did not
    const v = r.tags['代付'], yes = v == null ? !r.noReply : !/不|没|拒|no|decline/i.test(v);
    const said = r.text || '', base = Object.assign({}, o, { answer: said, inner: r.inner || '', mood: r.mood || '', answeredAt: now() });
    const words = said ? `；你说「${clip(said, 80)}」` : '';
    if (!yes){
      await log('him', 'daifu-declined', CONFIG.log.declined(o.name, yuan(o.price)) + words, { id: o.id });
      return await mine().put(TYPE, Object.assign(base, { state: 'declined' }), { app: ID });
    }
    let paid;
    try { paid = await payAsHim(wallet(), o); }
    catch(e){
      if (e.code !== 'short') { ctx.toast(T(W('toast.fail'))); return await mine().put(TYPE, Object.assign(base, { state: 'noanswer' }), { app: ID }); }
      await log('him', 'daifu-declined', CONFIG.log.short(o.name, yuan(o.price)) + words, { id: o.id, short: true });
      return await mine().put(TYPE, Object.assign(base, { state: 'declined', why: 'short' }), { app: ID });
    }
    await log('him', 'daifu-paid', CONFIG.log.paid(o.name, yuan(o.price)) + words, { id: o.id });
    return await mine().put(TYPE, Object.assign(base, { state: 'paid', placedAt: now(), wallet: paid.id }), { app: ID });
  } finally { asking.delete(oid); }
}

// ---- 让他挑一件送我: he picks in one turn of his (shown here); his gift costs her nothing ----
// → { said, order (or null when he says no) }, or null when the model failed
async function askPick(ctx){
  const T = ctx.T;
  const list = CONFIG.items.map(([id, p]) => `${id}: ${nameOf(T, id)} ¥${yuan(p)}`).join('\n');
  let r;
  try { r = await M().turn(CONFIG.told.pick(list), { tags: ['送', '礼物'], max: 400 }); }
  catch(e){ ctx.toast(T(W('toast.noanswer'))); return null; }
  const v = r.tags['送'] || r.tags['礼物'] || '', said = r.text || '';
  if (!item(v)) return { said, order: null };
  const g = await good(v, T);
  const o = await mine().put(TYPE, Object.assign(what(g), { id: newId(), for: 'me', from: 'him', pay: 'him', to: M().currentId || '', toName: his(), state: 'paid', placedAt: now(), answer: said, inner: r.inner || '' }), { app: ID });
  await log('him', 'gift', CONFIG.log.gift(g.name) + (said ? `；你说「${clip(said, 80)}」` : ''), { id: o.id });
  return { said, order: o };
}
// she 收下 his gift, once it arrived
async function accept(oid){
  const o = await mine().get(TYPE, oid); if (!o || o.from !== 'him' || o.state !== 'paid' || !o.deliveredAt) return o;
  if (o.to && o.to !== (M().currentId || '')) return o;
  await log('her', 'gift-accepted', CONFIG.log.accepted(o.name), { id: o.id });
  return mine().put(TYPE, Object.assign(o, { state: 'accepted', changedAt: now() }), { app: ID });
}

// ---- the background round: every half minute, when the page is up, and when a record changes ----
// Older files kept her orders in his folder (no `kind`). Her orders are hers: each one moves to her phone once
// (same id, so an old chat card still finds it), a gift she gave him becomes his thing, and the old file goes.
async function migrate(){
  const c = M(), old = (await c.records.list(TYPE)).filter(r => r && !r.kind);
  for (const r of old){
    const at = Number(r.at) || now(), o = Object.assign({}, r, { to: c.currentId || '', toName: his(), placedAt: at, deliveredAt: at });
    o.pay = r.from === 'him' ? 'him' : 'me';
    o.state = r.state === 'accepted' ? 'accepted' : 'paid';
    if (r.for === 'him' && r.from !== 'him'){
      const it = item(r.item) || {};
      await c.records.put(TYPE, { id: 't-' + r.id, kind: 'thing', item: r.item, name: r.name, line: '', icon: it.icon || CONFIG.icon, price: r.price, order: r.id, from: 'her', arrivedAt: at }, { app: ID });
    }
    await mine().put(TYPE, o, { app: ID });
    await c.records.remove(TYPE, r.id);
  }
}
// An order whose time has come is delivered: a gift for him becomes his thing (his folder) and the delivered
// event is logged (then he knows); his gift or a 代付 reaching her is logged too. Anything he is part of waits
// until he is the one open (his folder, his log). Her own order for herself is only marked: it is her phone's.
let round = null;
async function tick(){
  if (round) return round;
  round = (async () => {
    const c = M();
    if (!c || !c.myRecords || !c.records || !c.store || !c.store.name) return;
    try { await migrate(); } catch(e){ console.error(e); }
    let list; try { list = await mine().list(TYPE); } catch { return; }
    if (!Array.isArray(list)) return;
    const t = now(), cur = c.currentId || '';
    for (const o of list){
      if (o.state !== 'paid' || !o.placedAt || o.deliveredAt) continue;
      const withHim = o.for === 'him' || o.pay === 'him' || o.from === 'him';
      if (withHim && o.to !== cur) continue;
      // its arrival is a job in his folder, booked once by id; the one clock runs tick then
      if (t < o.placedAt + LAST){ if (c.jobs) await c.jobs.add({ id: `deliver-${o.id}`, owner: ID, kind: 'deliver', at: o.placedAt + LAST }).catch(() => {}); continue; }
      const due = o.placedAt + LAST;
      if (o.for === 'him'){
        await c.records.put(TYPE, { id: 't-' + o.id, kind: 'thing', item: o.item, name: o.name, line: o.line || '', icon: o.icon || CONFIG.icon, price: o.price, order: o.id, from: 'her', arrivedAt: due }, { app: ID });
        await log('her', 'delivered', CONFIG.log.deliveredHim(o.name), { id: o.id }, due);
      } else if (o.from === 'him') await log('him', 'delivered', CONFIG.log.deliveredGift(o.name), { id: o.id }, due);
      else if (o.pay === 'him') await log('him', 'delivered', CONFIG.log.deliveredPaid(o.name), { id: o.id }, due);
      const d = await mine().put(TYPE, Object.assign({}, o, { deliveredAt: due }), { app: ID });
      if (watchCtx && watchCtx.notify) watchCtx.notify(watchCtx.T(W('arrived'), { item: o.name }), { tag: `modu-${ID}-${o.id}` });
      if (typeof hooks.delivered === 'function') { try { hooks.delivered(d); } catch(e){ console.error(e); } }
    }
  })().catch(e => console.error(e)).finally(() => { round = null; });
  return round;
}
if (M() && M().jobs) M().jobs.handle(ID, () => tick());   // no timer of its own (the one clock, app/core/clock.js)

// ---- words for an order ----
function whoWord(o, T){
  const name = o.toName || his();
  if (o.from === 'him') return T(W('card.fromhim'), { name });
  if (o.pay === 'him') return T(W('for.pay'), { name });
  return o.for === 'him' ? T(W('for.him'), { name }) : T(W('for.me'));
}
function stateWord(o, T){
  if (o.state === 'paid'){
    if (o.from === 'him' && o.deliveredAt) return T(W('state.sent'));
    const k = stageOf(o); return k < 0 ? '' : T(W('track.' + CONFIG.track[k][0]));
  }
  if (o.state === 'declined' && o.why === 'short') return T(W('state.short'));
  return T(W('state.' + o.state));
}

// ---- old chat cards (orders were once put into the chat): still drawn; a tap opens the order here ----
async function find(id){ return (await mine().get(TYPE, id)) || (await M().records.get(TYPE, id)); }
async function card(msg, ctx){
  const c = msg.extra && msg.extra.modu_card; if (!c || !c.id) return null;
  const o = await find(c.id); if (!o || o.kind) return null;
  const T = ctx.T;
  return { icon: o.icon || (item(o.item) || {}).icon || CONFIG.icon, title: o.name, sub: o.from === 'him' ? whoWord(o, T) : '¥' + yuan(o.price),
           foot: T(W('card')) + ' · ' + stateWord(o, T), done: o.state !== 'paid' || !!o.deliveredAt };
}
async function cardTap(msg, ctx){
  const c = msg.extra && msg.extra.modu_card; if (!c || !c.id) return;
  want = c.id; ctx.go('app:' + ID);
}

// ---- the screen ----
async function render(view, ctx){
  const T = ctx.T, name = his();
  if (view.v === 'order'){
    const o = await mine().get(TYPE, view.id);
    if (!o) return { title: T(W('order')), html: `<div class="foot">${esc(T(W('toast.fail')))}</div>` };
    const k = stageOf(o);
    const steps = o.placedAt ? CONFIG.track.map(([s, ms], i) => {
      const on = i <= k, at = i === CONFIG.track.length - 1 ? o.deliveredAt : o.placedAt + ms;
      return `<div class="a-${ID}-step${on ? ' on' : ''}${i === k ? ' now' : ''}" data-stage="${s}"><i></i><span><b>${esc(T(W('track.' + s)))}</b><small>${on && at ? esc(md(at)) : ''}</small></span></div>`;
    }).reverse().join('') : '';
    const reply = o.answer ? `<div class="group a-${ID}-reply"><small>${esc(T(W('reply'), { name: o.toName || name }))}</small><p>${esc(o.answer)}</p></div>` : '';
    return { title: T(W('order')), html: `
      <div class="group a-${ID}-head"><i><svg class="ic"><use href="#${esc(o.icon || CONFIG.icon)}"/></svg></i><span><b>${esc(o.name)}</b><small>${esc(o.line || '')}</small></span><span class="a-${ID}-price">¥${esc(yuan(o.price))}</span></div>
      <div class="foot a-${ID}-who">${esc(whoWord(o, T))} · <span class="a-${ID}-state">${esc(stateWord(o, T))}</span></div>
      ${o.state === 'asking' ? `<div class="foot a-${ID}-wait">${esc(T(W('state.asking')))}…</div>` : ''}
      ${reply}
      ${o.state === 'noanswer' ? `<button class="btn" data-act="again" data-id="${esc(o.id)}">${esc(T(W('again')))}</button>` : ''}
      ${o.from === 'him' && o.state === 'paid' && o.deliveredAt ? `<button class="btn" data-act="accept" data-id="${esc(o.id)}">${esc(T(W('accept')))}</button>` : ''}
      ${o.placedAt && !o.deliveredAt ? `<div class="foot a-${ID}-eta">${esc(T(W('eta'), { time: md(o.placedAt + LAST) }))}</div>` : ''}
      ${steps ? `<div class="group a-${ID}-track">${steps}</div>` : ''}` };
  }
  if (view.v === 'things'){
    const list = (await M().records.list(TYPE)).filter(r => r.kind === 'thing').reverse();
    return { title: T(W('things'), { name }), html: list.length ? `<div class="foot">${esc(T(W('things.sub')))}</div><div class="group">${list.map(r => `<div class="opt a-${ID}-thing"><span><b>${esc(r.name)}</b><small>${esc(r.line || '')}</small></span><span class="val">${esc(T(W('things.at'), { time: md(r.arrivedAt || r.at) }))}</span></div>`).join('')}</div>`
      : `<div class="foot a-${ID}-empty">${esc(T(W('things.empty')))}</div>` };
  }
  if (view.v === 'pick'){
    if (view.wait) return { title: T('app.' + ID), html: `<div class="foot a-${ID}-wait">${esc(T(W('picking'), { name }))}</div>` };
    return { title: T('app.' + ID), html: `${view.said ? `<div class="group a-${ID}-reply"><small>${esc(T(W('reply'), { name }))}</small><p>${esc(view.said)}</p></div>` : ''}
      ${view.order ? `<button class="btn" data-order="${esc(view.order)}">${esc(T(W('picked.view')))}</button>` : `<div class="foot">${esc(T(W('picked.none')))}</div>`}` };
  }
  const w = wallet(), bal = w ? await w.balance() : null;
  const orders = (await mine().list(TYPE)).reverse();   // hers, whoever is open
  const things = (await M().records.list(TYPE)).filter(r => r.kind === 'thing').length;
  const l = await getLikes();
  const tile = (id, nm, line, p, ic) => `<button class="group a-${ID}-item" data-item="${esc(id)}"><i><svg class="ic"><use href="#${esc(ic)}"/></svg></i><b>${esc(nm)}</b><small>${esc(line)}</small><span>¥${esc(yuan(p))}</span></button>`;
  const shelf = making || !l ? `<div class="foot a-${ID}-wait">${esc(T(W('likes.wait')))}</div>`
    : `<div class="a-${ID}-grid a-${ID}-likes" data-from="${esc(l.from)}">${l.items.map(x => tile(x.id, x.name, x.line, x.price, x.icon || CONFIG.icon)).join('')}</div>`;
  return { title: T('app.' + ID), html: `
    <div class="foot a-${ID}-lead">${esc(T(W('lead')))}${bal != null ? ' ' + esc(T('app.wallet.left', { amount: w.money(bal) })) : ''}</div>
    <div class="a-${ID}-shelfbar"><span class="gtitle">${esc(T(W('likes'), { name }))}</span><button class="a-${ID}-again" data-act="likes"${making ? ' disabled' : ''}>${esc(T(W('likes.again')))}</button></div>
    ${shelf}
    <button class="group a-${ID}-pick" data-act="pick"><i><svg class="ic"><use href="#${CONFIG.icon}"/></svg></i><span><b>${esc(T(W('pick'), { name }))}</b><small>${esc(T(W('pick.sub')))}</small></span><span class="a-${ID}-go">›</span></button>
    <button class="group a-${ID}-pick" data-act="things"><i><svg class="ic"><use href="#i-box"/></svg></i><span><b>${esc(T(W('things'), { name }))}</b><small>${esc(T(W('things.sub')))}</small></span><span class="a-${ID}-go">${things || ''} ›</span></button>
    <div class="a-${ID}-grid">${CONFIG.items.map(([id, p, ic]) => tile(id, nameOf(T, id), T(W('item.' + id + '.line')), p, ic)).join('')}</div>
    ${orders.length ? `<div class="gtitle">${esc(T(W('orders')))}</div><div class="group">${orders.map(o => `<button class="opt a-${ID}-row" data-order="${esc(o.id)}"><span>${esc(o.name)}<small>${esc(whoWord(o, T))} · ${esc(stateWord(o, T))}</small></span><span class="val">${o.pay === 'me' ? '-' + esc(yuan(o.price)) : esc(yuan(o.price))}</span></button>`).join('')}</div>` : ''}
    <div class="foot">${esc(T(W('foot')))}</div>` };
}
function itemSheet(id, ctx, show){
  const T = ctx.T, name = his();
  good(id, T).then(g => {
    if (!g) return;
    ctx.sheet(`<h3><svg class="ic"><use href="#${esc(g.icon)}"/></svg>${esc(g.name)}</h3><p>${esc(g.line)}<br><b>¥${esc(yuan(g.price))}</b></p>
      <button class="btn" id="sHim">${esc(T(W('buy.him'), { name }))}</button><button class="btn2" id="sMe">${esc(T(W('buy.me')))}</button><button class="btn2" id="sPay">${esc(T(W('buy.pay'), { name }))}</button><button class="btn2" data-close>${esc(T('cancel'))}</button>`, el => {
      el.querySelector('#sHim').onclick = async () => { ctx.closeSheet(); const o = await buy(id, 'him', ctx); if (o) show({ v: 'order', id: o.id }); };
      el.querySelector('#sMe').onclick = async () => { ctx.closeSheet(); const o = await buy(id, 'me', ctx); if (o) show({ v: 'order', id: o.id }); };
      el.querySelector('#sPay').onclick = () => { ctx.closeSheet(); askPay(id, ctx, { created: o => show({ v: 'order', id: o.id }) }); };
    });
  });
}

// ---- his own day: app/life.js offers / takes ----
// His day sketch may hold a slot of this app's doing (CONFIG.life.words, e.g. 点外卖); once that slot has begun, life hands
// it here (no call of its own: it came with the day sketch that already runs) and it is kept in his folder as a thing he got
// himself (kind 'own': { deed, name, price, at, where, state }), paid from his own wallet. His phone's 购物 / 外卖 / 钱包 show it.
const ownHash = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
// the price: a believable one in CONFIG.life's range (whole yuan), the same every time for the same slot
const ownPrice = id => { const L = CONFIG.life, n = Math.max(1, Math.round((L.high - L.low) / 100)); return L.low + (ownHash(id) % (n + 1)) * 100; };
const ownLang = () => { try { const c = M(); return c.chatLanguage ? c.chatLanguage(c.store.msgs || []) : ''; } catch { return ''; } };
// the thing: the slot's own words without the doing itself (点外卖：猪脚饭 → 猪脚饭, 午饭点了猪脚饭 → 猪脚饭, Ordered takeout: ramen
// → ramen), in the chat's language: in a Chinese chat a name with no Chinese in it (an English slot) is not used; in an
// English chat the English doing-words go and at most four whole words stay. Words too vague to be a thing (取外卖, 东西,
// takeout) → one of the app's own items (its name from words.txt, through the page's T once it is up)
function ownName(d){
  const L = CONFIG.life, en = ['en', 'other'].includes(ownLang());
  let t = String(d.text || '').replace(/\s+/g, ' ').trim();
  if (en){
    t = t.replace(L.verbEn, '').replace(/^[\s:,.;-]+/, '').trim().split(' ').filter(Boolean).slice(0, 4).join(' ').replace(/[\s:,.;-]+$/, '');
    if (t.length >= 2 && !L.vague.test(t)) return t;
  } else {
    t = t.replace(/^(?:外卖|购物|网购)[：:]\s*/, '');
    const m = L.verb.exec(t); if (m) t = t.slice(m.index + m[0].length);
    t = t.replace(/^[：:，,、\s]+/, '').replace(/[。.，,]+$/, '').trim();
    if (/[一-鿿]/.test(t) && !/[A-Za-z]{3,}/.test(t) && !L.vague.test(t)) return [...t].slice(0, 12).join('');
  }
  // outside a Chinese chat the app's own plain word (never a Chinese item); in one, one of its own items
  if (en) return L.plain;
  const it = CONFIG.items[ownHash(d.id) % CONFIG.items.length][0];
  return watchCtx && watchCtx.T ? nameOf(watchCtx.T, it) : CONFIG.place;
}
// The record comes first ('paying'), then the payment under a fixed id from the slot (his-own-<app>-<slot>), then 'paid'
// (or 'short', or 'nowallet'). A reload between the two, or a second tab doing the same slot, writes the same two records
// again (the same ids), so he never pays twice; a record left at 'paying' is not counted as kept, so life hands the slot
// over again and the payment is finished.
const ownStuck = new Set();   // a slot whose payment keeps failing is said once, not on every wake
const LIFE = {
  offers: [{ kind: CONFIG.life.kind, words: CONFIG.life.words }],
  takes: [CONFIG.life.kind],
  name: ownName,   // what a slot's words become (for the tests; life reads only the fields above and below)
  async kept(){ return (await M().records.list(TYPE)).filter(r => r && r.kind === 'own' && r.deed && r.state !== 'paying').map(r => r.deed); },
  async did(d){
    const c = M(), slot = String(d.id).replace(/[^A-Za-z0-9_-]/g, ''), id = 'own-' + slot, wid = `his-own-${ID}-${slot}`;
    const old = await c.records.get(TYPE, id).catch(() => null);
    if (old && old.state !== 'paying') return;
    const name = old ? old.name : ownName(d), price = old ? old.price : ownPrice(d.id), at = old ? old.at : Number(d.at) || now();
    const rec = old || { id, kind: 'own', deed: String(d.id), name, price, icon: CONFIG.icon, where: String(d.where || '').slice(0, 20), day: String(d.day || ''), at, from: 'him', wallet: wid, state: 'paying' };
    if (!old) await c.records.put(TYPE, rec, { app: ID });
    const w = wallet();
    let state = 'nowallet';
    if (w && w.pay){
      if (await c.records.get('wallet', wid).catch(() => null)) state = 'paid';
      else try { await w.pay({ amount: price, note: name, app: ID, kind: 'own', ref: id, who: 'him', at, id: wid }); state = 'paid'; }
      catch(e){ state = await c.records.get('wallet', wid).catch(() => null) ? 'paid' : e.code === 'short' ? 'short' : 'paying'; if (e.code !== 'short' && !ownStuck.has(id)){ ownStuck.add(id); console.error(e); } }
    }
    if (state !== 'paying') await c.records.put(TYPE, Object.assign({}, rec, { state }), { app: ID });
  },
};

ModuApps.register({
  id: 'shop', version: '0.2', icon: CONFIG.icon, title: 'app.' + ID, status: 'ready', css: true, records: [TYPE], myRecords: [TYPE],
  scope: 'contact', surface: 'screen',
  writes: CONFIG.writes,
  life: LIFE,   // his own day
  jobs: { kinds: ['deliver'] },   // an order's arrival is booked through the core
  invite: { kind: 'pay', words: 'invite.pay', after: ['shop', 'food'], within_min: 120, rare: true, gate: false, pays: true },   // 代付, offered by him, rare, only after she shopped (no gate)
  // while it is closed, an order still arrives on time (and she is told)
  watch(ctx){
    watchCtx = ctx;
    let soon = 0; const later = () => { clearTimeout(soon); soon = setTimeout(tick, 50); };
    ctx.core.on((ev, d) => { if (ev === 'loaded' || (ev === 'records' && d && d.owner === 'her' && d.type === TYPE)) later(); });
    tick();
  },
  mount(el, ctx){
    const T = ctx.T;
    if (ctx.action === 'invite-pay'){ offered = now() + 2 * 3600000; ctx.toast(T(W('invite.pays'), { name: his() })); }
    let alive = true, seq = 0, view = want ? { v: 'order', id: want } : { v: 'home' };
    want = '';
    el.innerHTML = `<div class="pad-top"></div><div class="bar"><button class="back" aria-label="back"><svg class="ic"><use href="#i-back"/></svg></button><div class="title">${esc(T('app.' + ID))}</div></div><div class="list a-${ID}-body"></div>`;
    const body = el.querySelector(`.a-${ID}-body`), title = el.querySelector('.bar .title');
    const draw = async () => {
      const n = ++seq, r = await render(view, ctx);
      if (!alive || n !== seq) return;
      title.textContent = r.title; body.innerHTML = r.html; body.dataset.view = view.v;
    };
    const show = v => { view = v; if (ctx.inner) ctx.inner(v.v !== 'home', () => show({ v: 'home' }));   // Android's back leaves an inner view first
    body.scrollTop = 0; draw().catch(e => console.error(e)); };
    el.querySelector('.bar .back').onclick = () => { if (view.v !== 'home') show({ v: 'home' }); else ctx.back(); };   // back to where she came from
    body.onclick = async e => {
      const b = e.target.closest('[data-item], [data-order], [data-act]'); if (!b || !body.contains(b)) return;
      if (b.dataset.item) return itemSheet(b.dataset.item, ctx, show);
      if (b.dataset.order) return show({ v: 'order', id: b.dataset.order });
      const a = b.dataset.act;
      if (a === 'things') return show({ v: 'things' });
      if (a === 'likes') { if (!likesDue(await getLikes())) return ctx.toast(T(W('likes.today'))); const m = makeLikes(ctx); draw(); await m.catch(e => console.error(e)); return draw(); }   // once a day
      if (a === 'again') return answerPay(b.dataset.id, ctx);
      if (a === 'accept') { await accept(b.dataset.id); ctx.toast(T(W('toast.accepted'))); return draw(); }
      if (a === 'pick'){
        show({ v: 'pick', wait: true });
        const r = await askPick(ctx);
        if (!alive) return;
        return r ? show({ v: 'pick', said: r.said, order: r.order ? r.order.id : '' }) : show({ v: 'home' });
      }
    };
    draw().catch(e => console.error(e));
    // the shelf is kept (his record) and written again at most once a day: on the first open of a later day
    getLikes().then(l => { if (likesDue(l) && alive) { const m = makeLikes(ctx); draw(); return m.then(() => alive && draw()); } }).catch(e => console.error(e));
    tick();
    let soon = 0; const later = () => { clearTimeout(soon); soon = setTimeout(() => draw().catch(e => console.error(e)), 30); };
    const off = M().on((ev, d) => { if ((ev === 'records' && (d.type === TYPE || d.type === 'wallet')) || ev === 'loaded') later(); });
    const iv = M().clock ? M().clock.on(() => { if (view.v === 'order') later(); }) : () => {};   // the track moves with the one clock
    return () => { alive = false; off(); iv(); clearTimeout(soon); };
  },
  card, cardTap,
  api: { buy, askPay, answerPay, askPick, accept, readPick, stageOf, check: tick, hooks,
         likes: getLikes, makeLikes, guardLikes, readLikes, fallbackLikes, likesDue, shelfVars,
         track: () => CONFIG.track.map(([stage, after]) => ({ stage, after })),
         items: () => CONFIG.items.map(([id, price, icon]) => ({ id, price, icon })) },
});
})();
