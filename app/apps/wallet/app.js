// 钱包 (wallet), a page-2 app with chat cards. Play money only: nothing here
// touches real money, a real shop, or anything outside the page.
// - HER wallet is one, on her phone (her store, myRecords), whoever is open: the record type `wallet` there.
//   Each companion's older 零钱 (the `wallet` entries in his folder with no `side`) joins it once, as one ledger line
//   (从和X的钱包转入), the first time the wallet is read with him open; nothing in his folder is deleted.
// - HIS wallet is his, in his folder: `wallet` entries there marked `side: 'him'` (his start, his 工资, the
//   红包 she gave him, what his 亲属卡 paid for her). Older entries (no `side`) are hers and stay as they were.
// - Money on a schedule: 工资 monthly, 零花钱 weekly, 零钱通 with a small monthly yield, 账单 by month.
// - 亲属卡: she gives him one, or asks him for one (he decides, one turn), with a monthly limit; both wallets show it.
// - 发红包 / 转账 from this screen end on a 发送成功 page (去聊天看看), not a jump to the chat; the card still
//   goes into the chat (chat: 'cards'), and from the chat's ＋ she stays in the chat.
// - 模拟炒股: a toy, clearly marked: made-up companies, 游戏币 that never mix with 零钱, random-walk prices.
// Other apps (购物, 外卖) pay through `api` (README.md).
(function(){
'use strict';
const TYPE = 'wallet', APP = 'wallet';
const PLAN = 'wallet-plan';     // her income plan (her phone), one record: 'plan'
const CARD = 'wallet-card';     // 亲属卡 (her phone): 'to-<key>' she gave him, 'from-<key>' he gave her
const PLAY = 'wallet-play';     // 模拟炒股 (her phone): 'account' plus one record per trade
const START = 200000;           // ¥2000.00 of play money, her first entry when her wallet is empty
const RED_MAX = 20000;          // a 红包 holds at most ¥200.00
const PLAY_START = 1000000;     // 10,000.00 游戏币 (whole hundredths, like fen), never 零钱
const M = () => window.ModuCore;
const mine = () => M().myRecords;
const yuan = c => (Math.round(c) / 100).toFixed(2);
const money = c => '¥' + yuan(c).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const coins = c => yuan(c).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const userName = () => (M().store.meta && M().store.meta.user_name) || 'You';
const hisName = () => M().store.name || '';
const nowD = () => (M().now ? M().now() : new Date());
const nowMs = () => nowD().getTime();   // every time in 钱包 from the one clock
const pad = n => String(n).padStart(2, '0');
const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ym = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const parseDay = s => { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const dayOf = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const amt = e => Math.max(0, Math.round(Number(e && e.amount) || 0));
function hash(s){ let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); }
function err(msg, code){ const e = new Error(msg); e.code = code; return e; }
// one line into the phone's event log, so in chat he knows what happened here; never fatal
const KIND_ZH = { redpacket:'红包', transfer:'转账' };
function log(who, what, line, detail){ const c = M(); return c.logEvent ? c.logEvent({ app:APP, title:'钱包', who, what, line, detail }).catch(e => console.error(e)) : null; }

// What an entry does to its owner's balance (hers on her phone, his in his folder). dir 'in' adds once it is
// the owner's (done / accepted); dir 'out' takes away unless it came back (returned / refunded); anything
// else (a note, his copy of a gift she bought) is 0.
function effect(e){
  const a = amt(e);
  if (e.dir === 'in') return ['done', 'accepted'].includes(e.state) ? a : 0;
  if (e.dir === 'out') return ['returned', 'refunded'].includes(e.state) ? 0 : -a;
  return 0;
}
// pots: 'cash' (零钱, the default), 'savings' (零钱通), 'card' (paid by his 亲属卡: not her money)
const potOf = e => e.pot || 'cash';
const cashOf = list => list.reduce((s, e) => s + (potOf(e) === 'cash' ? effect(e) : 0), 0);
function savingsOf(list){
  return list.reduce((s, e) => {
    if (e.kind === 'save') return s - effect(e);      // out of 零钱, into 零钱通
    if (e.kind === 'unsave') return s - effect(e);    // into 零钱, out of 零钱通
    return s + (potOf(e) === 'savings' ? effect(e) : 0);
  }, 0);
}

// ---- moving the older per-companion 零钱 into her one wallet, once per companion ----
// His folder keeps every old entry; a marker `wallet/moved.json` (side 'him', kind 'moved') says it was
// moved and to which line. Her line's id comes from his folder's own data, so a second run, a reload, or a
// backup restored on either side never adds it twice.
const moving = new Map();
function migrate(){
  const core = M(), name = hisName();
  if (!name || !core.records) return Promise.resolve(null);
  if (moving.has(name)) return moving.get(name);
  const p = (async () => {
    const his = await core.records.list(TYPE);
    if (his.some(e => e.id === 'moved' && e.kind === 'moved')) return null;
    const old = his.filter(e => !e.side);
    if (!old.length) return null;
    const amount = Math.max(0, old.reduce((s, e) => s + (potOf(e) === 'cash' ? effect(e) : 0), 0));
    const first = old.reduce((a, b) => ((a.at || 0) <= (b.at || 0) ? a : b));
    const id = 'moved-' + hash(name + '|' + first.id + '|' + (first.at || 0));
    let line = await mine().get(TYPE, id);
    if (!line) line = await mine().put(TYPE, { id, kind:'moved', dir:'in', amount, state:'done', app:APP, from:name, contact: core.currentId || '', entries: old.length }, { app:APP });
    await core.records.put(TYPE, { id:'moved', side:'him', kind:'moved', amount, line:id, entries: old.map(e => e.id), app:APP }, { app:APP });
    return line;
  })().finally(() => moving.delete(name));
  moving.set(name, p);
  return p;
}

// ---- money on a schedule: 工资 monthly, 零花钱 weekly, 零钱通's yield on the 1st ----
// Her plan starts the day it is made (nothing is paid backwards); each day after it is looked at when the
// wallet is next read, and each payment has its own id (salary-2026-11, weekly-2026-11-02, interest-2026-10),
// so reading twice never pays twice.
const DEFAULT_PLAN = { salary:{ on:true, amount:500000, day:1 }, weekly:{ on:true, amount:20000, weekday:1 }, savings:{ rate:0.02 } };
const clone = o => JSON.parse(JSON.stringify(o));
async function getPlan(){
  let p = await mine().get(PLAN, 'plan');
  if (!p){ const today = isoDay(nowD()); p = await mine().put(PLAN, Object.assign({ id:'plan', since:today, last:today }, clone(DEFAULT_PLAN)), { app:APP }); }
  return p;
}
async function setPlan(change = {}){
  const p = await getPlan();
  for (const k of ['salary', 'weekly', 'savings']) if (change[k]) p[k] = Object.assign({}, p[k], change[k]);
  p.salary.amount = Math.max(0, Math.round(Number(p.salary.amount) || 0)); p.salary.day = Math.min(31, Math.max(1, Math.round(Number(p.salary.day) || 1)));
  p.weekly.amount = Math.max(0, Math.round(Number(p.weekly.amount) || 0)); p.weekly.weekday = Math.min(6, Math.max(0, Math.round(Number(p.weekly.weekday) || 0)));
  return mine().put(PLAN, p, { app:APP });
}
async function once(id, rec){ if (await mine().get(TYPE, id)) return null; return mine().put(TYPE, Object.assign({ id, app:APP }, rec), { app:APP }); }
const daysIn = d => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
async function schedule(){
  const p = await getPlan(), today = dayOf(nowD());
  const d = parseDay(p.last) || today; d.setDate(d.getDate() + 1);
  for (let n = 0; d <= today && n < 400; d.setDate(d.getDate() + 1), n++){
    const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9).getTime();
    if (d.getDate() === 1){
      const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      const a = Math.round(savingsOf(await mine().list(TYPE)) * (Number(p.savings && p.savings.rate) || 0) / 12);
      if (a > 0) await once('interest-' + ym(prev), { kind:'interest', pot:'savings', dir:'in', amount:a, state:'done', at, month: ym(prev) });
    }
    if (p.salary.on && p.salary.amount > 0 && d.getDate() === Math.min(p.salary.day, daysIn(d))) await once('salary-' + ym(d), { kind:'salary', dir:'in', amount:p.salary.amount, state:'done', at });
    if (p.weekly.on && p.weekly.amount > 0 && d.getDay() === p.weekly.weekday) await once('weekly-' + isoDay(d), { kind:'weekly', dir:'in', amount:p.weekly.amount, state:'done', at });
  }
  if (today > (parseDay(p.last) || today)) await mine().put(PLAN, Object.assign(p, { last: isoDay(today) }), { app:APP });
}

// Her ledger is ready to read: his old 零钱 moved in, the first ¥2,000 when there is nothing, the schedule run.
let prepping = null;
function prep(){
  if (!prepping) prepping = (async () => {
    try { await migrate(); } catch(e){ console.error('wallet move:', e); }
    if (!(await mine().list(TYPE)).length) await mine().put(TYPE, { id:'start', kind:'start', dir:'in', amount:START, state:'done', app:APP }, { app:APP });
    try { await schedule(); } catch(e){ console.error('wallet schedule:', e); }
  })().finally(() => { prepping = null; });
  return prepping;
}
async function ledger(){ await prep(); return mine().list(TYPE); }
async function balance(){ return cashOf(await ledger()); }
async function savings(){ return savingsOf(await ledger()); }
// an entry by id: hers first, then his folder (his copy, or an older entry a card in his chat points at)
async function entry(id){
  if (!id) return null;
  const e = await mine().get(TYPE, id); if (e) return e;
  return hisName() ? M().records.get(TYPE, id) : null;
}

// ---- his own wallet, in his folder ----
// The hook: what he starts with and earns, by his persona's job. Today one plain default for everyone.
const hooks = { hisIncome: () => ({ start: 300000, salary: 800000, day: 1 }) };
let hisPrepping = null;
function hisPrep(){
  if (!hisName()) return Promise.resolve();
  if (!hisPrepping) hisPrepping = (async () => {
    const R = M().records;
    let p = await R.get(TYPE, 'his-plan');
    if (!p){
      const inc = Object.assign({ start: 0, salary: 0, day: 1 }, hooks.hisIncome(M().store) || {}), today = isoDay(nowD());
      p = await R.put(TYPE, { id:'his-plan', side:'him', kind:'plan', salary: Math.round(inc.salary) || 0, day: inc.day || 1, job: inc.job || '', since: today, last: today, app:APP }, { app:APP });
      if (!(await R.get(TYPE, 'his-start'))) await R.put(TYPE, { id:'his-start', side:'him', kind:'start', dir:'in', amount: Math.round(inc.start) || 0, state:'done', app:APP }, { app:APP });
    }
    const today = dayOf(nowD()), d = parseDay(p.last) || today; d.setDate(d.getDate() + 1);
    for (let n = 0; d <= today && n < 400; d.setDate(d.getDate() + 1), n++){
      if (p.salary > 0 && d.getDate() === Math.min(p.day, daysIn(d))){
        const id = 'his-salary-' + ym(d);
        if (!(await R.get(TYPE, id))) await R.put(TYPE, { id, side:'him', kind:'salary', dir:'in', amount:p.salary, state:'done', at: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9).getTime(), app:APP }, { app:APP });
      }
    }
    if (today > (parseDay(p.last) || today)) await R.put(TYPE, Object.assign(p, { last: isoDay(today) }), { app:APP });
  })().catch(e => console.error('his wallet:', e)).finally(() => { hisPrepping = null; });
  return hisPrepping;
}
async function hisLedger(){ if (!hisName()) return []; await hisPrep(); return (await M().records.list(TYPE)).filter(e => e.side === 'him'); }
async function hisBalance(){ return cashOf(await hisLedger()); }
// his copy of an entry of hers that concerns him (same id): the 红包 coming to him, a gift she bought him
async function mirror(e, over){
  if (!hisName()) return null;
  try { return await M().records.put(TYPE, Object.assign({ id:e.id, side:'him', kind:e.kind, amount:e.amount, note:e.note || '', state:e.state, app:e.app || APP, ref:e.ref || '', by:'her' }, over), { app:APP }); }
  catch(x){ console.error(x); return null; }
}

// ---- the API other apps use (README.md). Amounts are whole fen (cents), numbers. ----
// pay: money out of her 零钱 now (an order); { by: 'card' } pays with the 亲属卡 he gave her instead.
// receive: money in, waiting until she accepts (a gift from him).
async function pay({ amount, note = '', app = APP, kind = 'order', ref = '', state = 'paid', to = '', by = '', who = 'her', at = 0, id = '' } = {}){
  if (by === 'card') return payByCard({ amount, note, app, kind, ref, to });
  amount = Math.round(Number(amount));
  if (!(amount > 0)) throw new Error('amount');
  // { who: 'him' }: he pays from HIS wallet (购物's 找他代付); her 零钱 is untouched
  if (who === 'him'){
    if (!hisName()) throw new Error('no companion');
    if (amount > await hisBalance()) throw err('他的零钱不够', 'short');
    // `at`, when it happened (a thing he bought on his own day is paid when life hands it over, maybe later);
    // `id`, a fixed one from that slot, so a second write of the same payment (a reload, two tabs) replaces it, never pays twice
    return M().records.put(TYPE, Object.assign({ side:'him', kind, dir:'out', amount, note, state, app, ref, to, by:'him' }, Number(at) > 0 ? { at: Number(at) } : {}, id ? { id: String(id) } : {}), { app:APP });
  }
  if (amount > await balance()) throw err('零钱不够', 'short');
  const forHim = !!to && to === hisName();
  const e = await mine().put(TYPE, { kind, dir:'out', amount, note, state, app, ref, to, contact: forHim ? (M().currentId || '') : '' }, { app:APP });
  if (forHim) await mirror(e, { dir: KIND_ZH[kind] ? 'in' : '' });
  return e;
}
async function receive({ amount, note = '', app = APP, kind = 'gift', ref = '', state = 'sent', from = '' } = {}){
  amount = Math.round(Number(amount));
  if (!(amount > 0)) throw new Error('amount');
  const byHim = !!from && from === hisName();
  const e = await mine().put(TYPE, { kind, dir:'in', amount, note, state, app, ref, from, contact: byHim ? (M().currentId || '') : '' }, { app:APP });
  if (byHim) await mirror(e, { dir:'out', by:'him' });
  return e;
}
// Changes the state on her entry and on his copy (same id). An older entry in his folder that was
// moved and now comes back (a 红包 he returns late) gives her the money back as its own line.
async function setState(id, state){
  const t = nowMs();
  let e = await mine().get(TYPE, id);
  if (e) e = await mine().put(TYPE, Object.assign(e, { state, changedAt:t }), { app:APP });
  const h = hisName() ? await M().records.get(TYPE, id) : null;
  if (h){
    const before = effect(h), h2 = await M().records.put(TYPE, Object.assign(h, { state, changedAt:t }), { app:APP });
    if (!h2.side && !e){
      const mv = await M().records.get(TYPE, 'moved'), diff = effect(h2) - before;
      if (mv && diff > 0 && (mv.entries || []).includes(id))
        await mine().put(TYPE, { id:'back-' + id, kind:'moved', dir:'in', amount:diff, state:'done', app:APP, from: hisName(), ref:id }, { app:APP });
      e = h2;
    }
  }
  return e;
}
// 零钱 ↔ 零钱通
async function save(amount){
  amount = Math.round(Number(amount)); if (!(amount > 0)) throw new Error('amount');
  if (amount > await balance()) throw err('零钱不够', 'short');
  return mine().put(TYPE, { kind:'save', dir:'out', amount, state:'done', app:APP }, { app:APP });
}
async function unsave(amount){
  amount = Math.round(Number(amount)); if (!(amount > 0)) throw new Error('amount');
  if (amount > await savings()) throw err('零钱通不够', 'short');
  return mine().put(TYPE, { kind:'unsave', dir:'in', amount, state:'done', app:APP }, { app:APP });
}
// 账单: one month of her ledger by kind → { month, in, out, rows: [{ cat, in, out, n }] }
function cat(e){ return potOf(e) === 'card' ? 'card' : ['shop', 'food'].includes(e.app) ? e.app : e.kind === 'kin' ? 'kin' : e.kind || 'other'; }
async function bill(month){
  const list = (await ledger()).filter(e => ym(new Date(e.at || 0)) === month && !['save', 'unsave'].includes(e.kind));
  const by = new Map(); let tin = 0, tout = 0;
  for (const e of list){
    const fx = potOf(e) === 'card' ? -(effect(e) ? amt(e) : 0) : potOf(e) === 'cash' ? effect(e) : 0;
    const r = by.get(cat(e)) || { cat: cat(e), in:0, out:0, n:0 }; r.n++;
    if (fx > 0) { r.in += fx; tin += fx; } else if (fx < 0) { r.out -= fx; tout -= fx; }
    by.set(r.cat, r);
  }
  return { month, in: tin, out: tout, rows: [...by.values()].sort((a, b) => (b.in + b.out) - (a.in + a.out)) };
}

// ---- 亲属卡: a card with a monthly limit, she → him or he → her; both wallets show it ----
// Kept on her phone (`wallet-card`, ids 'to-<key>' / 'from-<key>', key = the contact) and as his copy in his
// folder ('kin-in': the card she gave him; 'kin-out': the one he gave her).
const cardKey = () => M().currentId || hash(hisName());
async function card2(dir){ if (!hisName()) return null; const c = await mine().get(CARD, dir + '-' + cardKey()); return c && c.on ? c : null; }
async function cards(){ return (await mine().list(CARD)).filter(c => c.on); }
async function cardSpent(c, month = ym(nowD())){
  return (await mine().list(TYPE)).filter(e => e.card === c.id && ym(new Date(e.at || 0)) === month).reduce((s, e) => s + (effect(e) ? amt(e) : 0), 0);
}
async function grantCard({ limit } = {}){
  limit = Math.round(Number(limit)); if (!(limit > 0)) throw new Error('amount');
  const name = hisName(); if (!name) throw err('还没有打开角色', 'nobody');
  const c = await mine().put(CARD, { id:'to-' + cardKey(), dir:'to', contact: M().currentId || '', name, limit, on:true, app:APP }, { app:APP });
  await M().records.put(TYPE, { id:'kin-in', side:'him', kind:'kin', from:'her', limit, on:true, app:APP }, { app:APP });
  log('her', 'card-give', `她给你开通了亲属卡，每月额度 ¥${yuan(limit)}`, { limit });
  return c;
}
async function stopCard(dir){
  const c = await mine().get(CARD, dir + '-' + cardKey()); if (!c) return null;
  const done = await mine().put(CARD, Object.assign(c, { on:false, changedAt: nowMs() }), { app:APP });
  const h = await M().records.get(TYPE, dir === 'to' ? 'kin-in' : 'kin-out');
  if (h) await M().records.put(TYPE, Object.assign(h, { on:false }), { app:APP });
  log('her', 'card-stop', dir === 'to' ? '她停用了给你的亲属卡' : '她不再用你给她的亲属卡了', {});
  return done;
}
// She asks him for one: one turn of his (his usual prompt plus one line), his words go into the chat.
// His tag: [亲属卡: 开通 500] (an amount in 元 is the limit) / [亲属卡: 不开]. No tag: he did not open one.
const CARD_TAG = /[\[【(（]\s*亲属卡\s*[:：]\s*(开通|同意|开|好|不开|拒绝|不行|不同意|算了)\s*(?:¥|￥)?\s*(\d+(?:\.\d+)?)?\s*元?\s*[\]】)）]/g;
function readCard(raw){
  let yes = false, found = false, limit = 0;
  const text = String(raw == null ? '' : raw).replace(CARD_TAG, (m, w, n) => { found = true; yes = !/不|拒|算了/.test(w); if (n) limit = Math.round(parseFloat(n) * 100); return ''; });
  return { text: text.replace(/\n{3,}/g, '\n\n').trim(), yes: found && yes, found, limit };
}
const ASK_CARD = (limit, name) => `（小手机里发生的事）她在小手机的钱包里问你，能不能给她开一张亲属卡，每月额度 ¥${yuan(limit)}：她用它买东西时，钱从你的钱包里出。这是小手机里的零钱，不是真钱。按${name}的性格决定开不开、额度给多少，然后像平时发消息一样回她一两句。最后单独一行写 [亲属卡: 开通 金额] 或 [亲属卡: 不开]。`;
async function askCard({ limit } = {}){
  limit = Math.round(Number(limit)); if (!(limit > 0)) throw new Error('amount');
  const name = hisName(); if (!name) throw err('还没有打开角色', 'nobody');
  log('her', 'card-ask', `她问你能不能给她开一张亲属卡，每月 ¥${yuan(limit)}`, { limit });
  const d = readCard(await ask(ASK_CARD(limit, name)));
  let c = null;
  if (d.yes){
    const lim = d.limit > 0 ? d.limit : limit;
    c = await mine().put(CARD, { id:'from-' + cardKey(), dir:'from', contact: M().currentId || '', name, limit: lim, on:true, app:APP }, { app:APP });
    await M().records.put(TYPE, { id:'kin-out', side:'him', kind:'kin', to:'her', limit: lim, on:true, app:APP }, { app:APP });
    log('him', 'card-granted', `你给她开通了亲属卡，每月额度 ¥${yuan(lim)}`, { limit: lim });
  } else log('him', 'card-declined', '你没有给她开亲属卡', {});
  await sayAsHim(d.text);
  return { granted: !!c, card: c, text: d.text };
}
// She pays with the card he gave her: the money comes out of HIS wallet; her 零钱 is untouched.
async function payByCard({ amount, note = '', app = APP, kind = 'order', ref = '', to = '' } = {}){
  amount = Math.round(Number(amount)); if (!(amount > 0)) throw new Error('amount');
  const c = await card2('from'); if (!c) throw err('没有他的亲属卡', 'nocard');
  if ((await cardSpent(c)) + amount > c.limit) throw err('超过本月额度', 'limit');
  if (amount > await hisBalance()) throw err('他的零钱不够', 'short');
  const e = await mine().put(TYPE, { kind, dir:'out', pot:'card', card:c.id, amount, note, state:'paid', app, ref, to, by:'card', from: c.name }, { app:APP });
  await M().records.put(TYPE, { id:e.id, side:'him', kind:'kin-pay', dir:'out', amount, note, state:'paid', app, ref, by:'her', card:'kin-out' }, { app:APP });
  log('her', 'card-pay', `她用你给的亲属卡付了 ¥${yuan(amount)}${note ? `（${note}）` : ''}`, { id:e.id, amount });
  return e;
}
// A seam: he spends on the card she gave him (her 零钱 pays). Nothing calls it yet.
async function spendHerCard({ amount, note = '', app = APP, ref = '' } = {}){
  amount = Math.round(Number(amount)); if (!(amount > 0)) throw new Error('amount');
  const c = await card2('to'); if (!c) throw err('她没有给他开亲属卡', 'nocard');
  if ((await cardSpent(c)) + amount > c.limit) throw err('超过本月额度', 'limit');
  if (amount > await balance()) throw err('零钱不够', 'short');
  const e = await mine().put(TYPE, { kind:'kin', dir:'out', card:c.id, amount, note, state:'paid', app, ref, by:'him', to: c.name }, { app:APP });
  await M().records.put(TYPE, { id:e.id, side:'him', kind:'kin-use', dir:'', amount, note, state:'paid', app, ref, card:'kin-in' }, { app:APP });
  log('him', 'card-used', `你用她给的亲属卡花了 ¥${yuan(amount)}${note ? `（${note}）` : ''}`, { id:e.id, amount });
  return e;
}

// ---- 模拟炒股: a toy. Made-up companies, 游戏币 only, prices a seeded random walk by the hour ----
const STOCKS = [['MEOW', '喵喵罐头', 120], ['CLOUD', '云朵快递', 48], ['MOON', '月亮电池', 260], ['BOBA', '奶茶星球', 35], ['BEAR', '小熊机器人', 88]];
const EPOCH = new Date(2026, 0, 1).getTime(), HOUR = 3600000;
function u32(a){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
const walks = new Map();
// → the price in 游戏币 hundredths at time t (ms); the same t always gives the same price
function price(code, t = nowD().getTime()){
  const s = STOCKS.find(x => x[0] === code); if (!s) return 0;
  const step = Math.max(0, Math.floor((t - EPOCH) / HOUR));
  let w = walks.get(code); if (!w){ w = [s[2] * 100]; walks.set(code, w); }
  const seed = parseInt(hash(code), 36) | 0;
  while (w.length <= step){ const p = w[w.length - 1]; w.push(Math.max(100, Math.round(p * (1 + (u32(seed + w.length * 7919) - 0.5) * 0.03)))); }
  return w[step];
}
async function playAccount(){
  let a = await mine().get(PLAY, 'account');
  if (!a) a = await mine().put(PLAY, { id:'account', kind:'account', coins: PLAY_START, holdings:{}, app:APP }, { app:APP });
  return a;
}
// → { coins, holdings, value, stocks: [{ code, name, price, prev, n }] }
async function play(){
  const a = await playAccount(), t = nowD().getTime();
  const stocks = STOCKS.map(([code, name]) => ({ code, name, price: price(code, t), prev: price(code, t - 24 * HOUR), n: (a.holdings[code] || 0) }));
  return { coins: a.coins, holdings: a.holdings, value: a.coins + stocks.reduce((s, x) => s + x.n * x.price, 0), stocks };
}
// n > 0 buys n shares, n < 0 sells; paid in 游戏币 only
async function trade(code, n){
  n = Math.round(Number(n)); if (!n || !STOCKS.some(s => s[0] === code)) throw new Error('trade');
  const a = await playAccount(), p = price(code), cost = p * n, have = a.holdings[code] || 0;
  if (n > 0 && cost > a.coins) throw err('游戏币不够', 'short');
  if (n < 0 && -n > have) throw err('没有这么多股', 'shares');
  a.coins -= cost; a.holdings = Object.assign({}, a.holdings, { [code]: have + n });
  if (!a.holdings[code]) delete a.holdings[code];
  await mine().put(PLAY, a, { app:APP });
  return mine().put(PLAY, { kind:'trade', code, n, price:p, app:APP }, { app:APP });
}

// ---- she gives him a 红包 or a transfer (the card goes into the chat; she is not moved there) ----
async function give(kind, amount, note, ctx){
  const e = await pay({ amount, note, kind, state:'sent', to: hisName() });
  const T = ctx.T;
  const mes = T('app.wallet.chat.' + kind, { amount: yuan(amount), note: note || T('app.wallet.' + kind + '.note') });
  await M().appendToChat({ name: userName(), is_user:true, is_name:true, send_date: nowMs(), mes, extra:{ modu_card:{ app:APP, type:TYPE, id:e.id } } }, { announce:true });
  await log('her', kind, `她给你${kind === 'transfer' ? '转账' : '发了一个红包'} ¥${yuan(amount)}${note ? `，写着「${note}」` : ''}`, { id: e.id, amount });
  answer(e.id, ctx);   // he answers on his own time; the card follows the record
  return e;
}

// ---- he accepts or returns it ----
// The app's own question, after his usual prompt. His reply is read with the core's reply format once our
// own tag is cut out: [红包: 收下] / [红包: 退回] (also 转账, 领取, 接受, 退还, 拒绝, accept, return).
// No tag: he keeps it.
const ASK = {
  redpacket: (e, name) => `（小手机里发生的事）她刚刚在聊天里给你发了一个红包：¥${yuan(e.amount)}${e.note ? `，上面写着「${e.note}」` : ''}。这是小手机里的零钱，不是真钱。按${name}的性格决定收下还是退回，然后像平时发消息一样回她一两句。最后单独一行写 [红包: 收下] 或 [红包: 退回]。`,
  transfer: (e, name) => `（小手机里发生的事）她刚刚在聊天里给你转账 ¥${yuan(e.amount)}${e.note ? `，备注「${e.note}」` : ''}。这是小手机里的零钱，不是真钱。按${name}的性格决定收下还是退回，然后像平时发消息一样回她一两句。最后单独一行写 [转账: 收下] 或 [转账: 退回]。`,
};
const DECIDE = /[\[【(（]\s*(?:红包|转账|礼物|redpacket|red packet|transfer|gift)?\s*[:：]?\s*(收下|领取|接受|收了|收款|accept(?:ed)?|take|keep|退回|退还|拒绝|不收|return(?:ed)?|decline)\s*[\]】)）]/gi;
function readDecision(raw){
  let take = true, found = false;
  const text = String(raw == null ? '' : raw).replace(DECIDE, (m, w) => { found = true; take = !/退|拒|不收|return|decline/i.test(w); return ''; });
  return { text: text.replace(/\n{3,}/g, '\n\n').trim(), take, found };
}
const asking = new Set();
async function answer(id, ctx){
  if (asking.has(id)) return null;
  const e = await entry(id);
  if (!e || e.state !== 'sent' || e.dir !== 'out' || !ASK[e.kind]) return e;
  asking.add(id);
  let raw;
  try { raw = await ask(ASK[e.kind](e, hisName())); }
  catch(x){ asking.delete(id); if (ctx && ctx.toast) ctx.toast(ctx.T('app.wallet.toast.noanswer')); return e; }
  const d = readDecision(raw);
  const done = await setState(id, d.take ? 'accepted' : 'returned');
  await log('him', e.kind + (d.take ? '-accepted' : '-returned'), `你${d.take ? '收下' : '退回'}了她的${KIND_ZH[e.kind] || '钱'} ¥${yuan(e.amount)}`, { id, amount: e.amount });
  await sayAsHim(d.text);
  asking.delete(id);
  return done;
}

// ---- shared with 购物 and 外卖 (api): one turn of his about something an app did ----
// ask(question): his usual prompt (buildContext) plus one system line, through the core's ModuCore.turn
// → his raw text. Throws when the model fails. sayAsHim(text): that text read with the reply format and put into the
// chat as his message (mood, 心声); → the message, or null when nothing is left to say.
async function ask(question, opts = {}){
  return (await M().turn(question, { max: opts.max_tokens || 400 })).raw;
}
async function sayAsHim(text){
  const core = M(), r = core.parseReply(text), said = core.tidyCJK(r.text || '');
  if (!said || r.noReply) return null;
  const his = { name: core.store.name, is_user:false, is_name:true, send_date: nowMs(), mes: said, extra:{ modu_emotion: r.emotion, modu_emotion_from: r.labelled ? 'model' : 'none' } };
  if (r.inner) his.extra.modu_inner = core.tidyCJK(r.inner);
  await core.appendToChat(his, { announce:true });
  return his;
}

// ---- words for an entry ----
// her side: {name} is the companion it was with (his name kept on the entry, else the one open)
function label(e, T){
  const name = e.to || e.from || hisName();
  if (potOf(e) === 'card') return T('app.wallet.row.cardpay', { name, note: e.note || T('app.wallet.row.other') });
  const k = { start:'start', topup:'topup', salary:'salary', weekly:'weekly', interest:'interest', save:'save', unsave:'unsave', moved:'moved', kin:'kin' }[e.kind];
  if (k) return T('app.wallet.row.' + k, { name });
  if (e.kind === 'redpacket') return T(e.dir === 'in' ? 'app.wallet.row.redpacket.in' : 'app.wallet.row.redpacket', { name });
  if (e.kind === 'transfer') return T(e.dir === 'in' ? 'app.wallet.row.transfer.in' : 'app.wallet.row.transfer', { name });
  return e.note || T('app.wallet.row.other');
}
// his side, in his wallet (she is 她)
function hisLabel(e, T){
  const k = { start:'start', salary:'salary', redpacket:'redpacket', transfer:'transfer', 'kin-pay':'kinpay', 'kin-use':'kinuse', gift:'gift', own:'own' }[e.kind];   // own: something he bought on his own day
  if (k) return T('app.wallet.his.row.' + k, { note: e.note || '' });
  return e.note ? T('app.wallet.his.row.order', { note: e.note }) : T('app.wallet.row.other');
}
function stateWord(e, T){
  if (['start', 'topup'].includes(e.kind) || e.state === 'done' || e.state === 'paid' || !e.state) return '';
  return T('app.wallet.state.' + (e.dir === 'in' ? 'in.' : '') + e.state);
}
const md = at => { const d = new Date(at); return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

// ---- the chat card ----
async function card(msg, ctx){
  const c = msg.extra && msg.extra.modu_card; if (!c || !c.id) return null;
  const e = await entry(c.id); if (!e) return null;
  const T = ctx.T, kind = e.kind === 'transfer' ? 'transfer' : 'redpacket';
  return {
    icon: kind === 'transfer' ? 'i-wallet-transfer' : 'i-wallet-red',
    title: kind === 'transfer' ? money(e.amount) : (e.note || T('app.wallet.redpacket.note')),
    sub: kind === 'transfer' ? (e.note || T('app.wallet.transfer.to', { name: e.to || hisName() })) : T('app.wallet.card.redpacket'),
    foot: stateWord(e, T) || T('app.wallet.card.' + kind),
    done: e.state !== 'sent',
  };
}
async function cardTap(msg, ctx){
  const c = msg.extra && msg.extra.modu_card, e = c && await entry(c.id); if (!e) return;
  const T = ctx.T;
  ctx.sheet(`<h3>${esc(label(e, T))}</h3><p><b style="font-size:26px">${esc(money(e.amount))}</b><br>${esc(e.note || '')}<br>${esc(stateWord(e, T))} · ${esc(md(e.at))}</p>
    ${e.state === 'sent' && e.dir === 'out' ? `<button class="btn" id="wAgain">${esc(T('app.wallet.again'))}</button>` : ''}
    <button class="btn2" data-close>${esc(T('done'))}</button>`, el => {
    const b = el.querySelector('#wAgain'); if (b) b.onclick = () => { ctx.closeSheet(); answer(e.id, ctx); };
  });
}

// ---- the screen ----
const fen = v => Math.round(parseFloat(String(v || '').replace(/[,，]/g, '')) * 100);
function whoRow(){
  const list = M().contacts || [];
  if (list.length < 2) return '';
  // the page's own picker look (.contactpick); the one it goes to is ticked
  return `<div class="opts contactpick a-wallet-who">${list.map(c => `<button type="button" data-who="${esc(c.id)}"><span class="pk"><span class="av xs"${c.avatar ? ` style="background-image:url(&quot;${esc(c.avatar)}&quot;)"` : ''}></span>${esc(c.name || '')}</span><span class="tag"${c.id === M().currentId ? '' : ' hidden'}>✓</span></button>`).join('')}</div>`;
}
// opts.sent(e, kind): what to show after (the wallet screen's 发送成功 page); none from the chat's ＋
function giveSheet(kind, ctx, bal, opts = {}){
  const T = ctx.T, name = hisName();
  ctx.sheet(`<h3>${esc(T('app.wallet.' + kind))}</h3>${opts.pick ? whoRow() : ''}<p id="wLead">${esc(T('app.wallet.' + kind + '.lead', { name }))} ${esc(T('app.wallet.left', { amount: money(bal) }))}</p>
    <input type="text" inputmode="decimal" id="wAmt" placeholder="${esc(T('app.wallet.amount'))}">
    <input type="text" id="wNote" maxlength="30" placeholder="${esc(T('app.wallet.' + kind + '.note'))}">
    <button class="btn" id="wGo">${esc(T('app.wallet.' + kind + '.go'))}</button><button class="btn2" data-close>${esc(T('cancel'))}</button>`, el => {
    let who = M().currentId;
    el.querySelectorAll('[data-who]').forEach(b => b.onclick = () => {
      who = b.dataset.who; el.querySelectorAll('[data-who]').forEach(x => { x.querySelector('.tag').hidden = x !== b; });
      const c = (M().contacts || []).find(x => x.id === who);
      el.querySelector('#wLead').textContent = T('app.wallet.' + kind + '.lead', { name: (c && c.name) || name }) + ' ' + T('app.wallet.left', { amount: money(bal) });
    });
    el.querySelector('#wGo').onclick = async () => {
      const amount = fen(el.querySelector('#wAmt').value);
      if (!(amount > 0)) { ctx.toast(T('app.wallet.toast.amount')); el.querySelector('#wAmt').focus(); return; }
      if (kind === 'redpacket' && amount > RED_MAX) { ctx.toast(T('app.wallet.toast.max', { amount: money(RED_MAX) })); return; }
      const note = el.querySelector('#wNote').value.trim();
      try {
        ctx.closeSheet();
        // only one companion is open at a time, so the one she picked is opened first
        if (who && who !== M().currentId && !(await M().openContact(who))) { ctx.toast(T('app.wallet.toast.fail')); return; }
        const e = await give(kind, amount, note, ctx);
        if (opts.sent) opts.sent(e, kind);
      }
      catch(x){ ctx.toast(x.code === 'short' ? T('app.wallet.toast.short') : T('app.wallet.toast.fail')); }
    };
  });
}
function amountSheet(ctx, { title, lead, go, run, done }){
  const T = ctx.T;
  ctx.sheet(`<h3>${esc(title)}</h3><p>${esc(lead)}</p><input type="text" inputmode="decimal" id="wAmt" placeholder="${esc(T('app.wallet.amount'))}">
    <button class="btn" id="wGo">${esc(go)}</button><button class="btn2" data-close>${esc(T('cancel'))}</button>`, el => {
    el.querySelector('#wGo').onclick = async () => {
      const a = fen(el.querySelector('#wAmt').value);
      if (!(a > 0)) { ctx.toast(T('app.wallet.toast.amount')); return; }
      try { ctx.closeSheet(); await run(a); if (done) ctx.toast(done); }
      catch(x){ ctx.toast(x.code === 'short' ? T('app.wallet.toast.short') : x.code === 'limit' ? T('app.wallet.toast.limit') : T('app.wallet.toast.fail')); }
    };
  });
}
async function planSheet(ctx){
  const T = ctx.T, p = await getPlan();
  ctx.sheet(`<h3>${esc(T('app.wallet.plan'))}</h3><p>${esc(T('app.wallet.plan.lead'))}</p>
    <div class="group a-wallet-plan">
      <label class="opt"><span>${esc(T('app.wallet.plan.salary'))}</span><input type="checkbox" id="wSalOn"${p.salary.on ? ' checked' : ''}></label>
      <label class="opt"><span>${esc(T('app.wallet.amount'))}</span><input type="text" inputmode="decimal" id="wSal" value="${esc(yuan(p.salary.amount))}"></label>
      <label class="opt"><span>${esc(T('app.wallet.plan.day'))}</span><input type="text" inputmode="numeric" id="wSalDay" value="${esc(p.salary.day)}"></label>
      <label class="opt"><span>${esc(T('app.wallet.plan.weekly'))}</span><input type="checkbox" id="wWkOn"${p.weekly.on ? ' checked' : ''}></label>
      <label class="opt"><span>${esc(T('app.wallet.amount'))}</span><input type="text" inputmode="decimal" id="wWk" value="${esc(yuan(p.weekly.amount))}"></label>
      <label class="opt"><span>${esc(T('app.wallet.plan.weekday'))}</span><select id="wWkDay">${WEEKDAYS.map((w, i) => `<option value="${i}"${i === p.weekly.weekday ? ' selected' : ''}>${esc(T('app.wallet.plan.week', { d: w }))}</option>`).join('')}</select></label>
    </div>
    <button class="btn" id="wGo">${esc(T('save'))}</button><button class="btn2" data-close>${esc(T('cancel'))}</button>`, el => {
    el.querySelector('#wGo').onclick = async () => {
      const q = id => el.querySelector('#' + id);
      await setPlan({ salary:{ on: q('wSalOn').checked, amount: fen(q('wSal').value) || 0, day: parseInt(q('wSalDay').value, 10) || 1 },
                      weekly:{ on: q('wWkOn').checked, amount: fen(q('wWk').value) || 0, weekday: parseInt(q('wWkDay').value, 10) || 0 } });
      ctx.closeSheet(); ctx.toast(T('app.wallet.toast.saved'));
    };
  });
}
async function billSheet(ctx, back = 0){
  const T = ctx.T, d = nowD(), m = new Date(d.getFullYear(), d.getMonth() - back, 1), b = await bill(ym(m));
  ctx.sheet(`<h3>${esc(T('app.wallet.bill.title', { y: m.getFullYear(), m: m.getMonth() + 1 }))}</h3>
    <p>${esc(T('app.wallet.bill.in'))} <b>${esc(money(b.in))}</b> · ${esc(T('app.wallet.bill.out'))} <b>${esc(money(b.out))}</b></p>
    <div class="group a-wallet-bill">${b.rows.length ? b.rows.map(r => `<div class="opt"><span>${esc(T('app.wallet.cat.' + r.cat) || r.cat)}</span><span class="val">${r.in ? '+' + esc(yuan(r.in)) : ''}${r.in && r.out ? ' / ' : ''}${r.out ? '-' + esc(yuan(r.out)) : ''}</span></div>`).join('') : `<div class="opt sub">${esc(T('app.wallet.bill.none'))}</div>`}</div>
    <button class="btn2" id="wPrev">${esc(T('app.wallet.bill.prev'))}</button>${back ? `<button class="btn2" id="wNext">${esc(T('app.wallet.bill.next'))}</button>` : ''}<button class="btn2" data-close>${esc(T('done'))}</button>`, el => {
    el.querySelector('#wPrev').onclick = () => billSheet(ctx, back + 1);
    const n = el.querySelector('#wNext'); if (n) n.onclick = () => billSheet(ctx, back - 1);
  });
}
function tradeSheet(ctx, s){
  const T = ctx.T;
  ctx.sheet(`<h3>${esc(s.name)} <small>${esc(s.code)}</small></h3><p>${esc(T('app.wallet.play.price', { p: coins(s.price) }))} · ${esc(T('app.wallet.play.have', { n: s.n }))}<br><small>${esc(T('app.wallet.play.toy'))}</small></p>
    <input type="text" inputmode="numeric" id="wN" placeholder="${esc(T('app.wallet.play.n'))}">
    <button class="btn" id="wBuy">${esc(T('app.wallet.play.buy'))}</button><button class="btn2" id="wSell">${esc(T('app.wallet.play.sell'))}</button><button class="btn2" data-close>${esc(T('cancel'))}</button>`, el => {
    const go = sign => async () => {
      const n = parseInt(el.querySelector('#wN').value, 10);
      if (!(n > 0)) { ctx.toast(T('app.wallet.play.toast.n')); return; }
      try { await trade(s.code, sign * n); ctx.closeSheet(); ctx.toast(T(sign > 0 ? 'app.wallet.play.toast.bought' : 'app.wallet.play.toast.sold', { n, name: s.name })); }
      catch(x){ ctx.toast(T(x.code === 'short' ? 'app.wallet.play.toast.short' : x.code === 'shares' ? 'app.wallet.play.toast.shares' : 'app.wallet.toast.fail')); }
    };
    el.querySelector('#wBuy').onclick = go(1); el.querySelector('#wSell').onclick = go(-1);
  });
}
function row(e, T, fx, text){
  const a = amt(e), sw = stateWord(e, T);
  const shown = e.dir === 'in' || fx > 0 ? (fx ? '+' + yuan(a) : yuan(a)) : (fx ? '-' + yuan(a) : yuan(a));
  return `<button class="opt a-wallet-row" data-id="${esc(e.id)}"><span class="a-wallet-what"><span>${esc(text)}</span><small>${esc(md(e.at))}${sw ? ' · ' + esc(sw) : ''}</small></span><span class="val a-wallet-amt${fx > 0 ? ' a-wallet-in' : ''}${fx ? '' : ' a-wallet-zero'}">${esc(shown)}</span></button>`;
}
const tabs = (st, T) => `<div class="tabs a-wallet-tabs">${[['me', T('app.wallet.tab.me')], ['his', hisName() ? T('app.wallet.tab.his', { name: hisName() }) : ''], ['play', T('app.wallet.tab.play')]].filter(x => x[1]).map(([v, w]) => `<button type="button" data-view="${v}"${st.view === v ? ' class="on"' : ''}>${esc(w)}</button>`).join('')}</div>`;
async function drawMe(T){
  const list = await ledger(), bal = cashOf(list), sv = savingsOf(list), p = await getPlan(), name = hisName();
  const from = name ? await card2('from') : null, to = name ? await card2('to') : null;
  const others = (await cards()).filter(c => !c.id.endsWith('-' + cardKey()));
  const rate = Number(p.savings && p.savings.rate) || 0;
  const rows = list.slice().reverse().map(e => row(e, T, potOf(e) === 'card' ? (effect(e) ? -1 : 0) : potOf(e) === 'cash' ? effect(e) : (e.kind === 'interest' ? effect(e) : 0), label(e, T))).join('');
  const cardRow = async (c, dir, stop) => `<div class="opt a-wallet-card" data-card="${dir}"><span class="a-wallet-what"><span>${esc(T('app.wallet.kin.' + dir, { name: c.name }))}</span><small>${esc(T('app.wallet.kin.used', { used: money(await cardSpent(c)), limit: money(c.limit) }))}</small></span>${stop ? `<button class="val" data-act="kinstop">${esc(T('app.wallet.kin.stop'))}</button>` : ''}</div>`;
  const plan = [p.salary.on && p.salary.amount ? T('app.wallet.plan.line.salary', { d: p.salary.day, amount: money(p.salary.amount) }) : '',
                p.weekly.on && p.weekly.amount ? T('app.wallet.plan.line.weekly', { d: WEEKDAYS[p.weekly.weekday], amount: money(p.weekly.amount) }) : ''].filter(Boolean).join(' · ') || T('app.wallet.plan.none');
  return `
    <div class="group a-wallet-top"><small>${esc(T('app.wallet.balance'))}</small><b id="wBal">${esc(money(bal))}</b>
      <div class="a-wallet-acts"><button data-act="redpacket"><i><svg class="ic"><use href="#i-wallet-red"/></svg></i><span>${esc(T('app.wallet.redpacket'))}</span></button><button data-act="transfer"><i><svg class="ic"><use href="#i-wallet-transfer"/></svg></i><span>${esc(T('app.wallet.transfer'))}</span></button><button data-act="plan"><i><svg class="ic"><use href="#i-plus"/></svg></i><span>${esc(T('app.wallet.plan.short'))}</span></button><button data-act="bill"><i><svg class="ic"><use href="#i-wallet"/></svg></i><span>${esc(T('app.wallet.bill'))}</span></button></div></div>
    <div class="group"><button class="opt" data-act="plan"><span>${esc(T('app.wallet.plan'))}</span><span class="val" id="wPlan">${esc(plan)}</span></button></div>
    <div class="gtitle">${esc(T('app.wallet.save.title'))}</div>
    <div class="group a-wallet-save"><div class="opt"><span class="a-wallet-what"><span id="wSave">${esc(money(sv))}</span><small>${esc(T('app.wallet.save.rate', { r: (rate * 100).toFixed(2), day: money(Math.round(sv * rate / 365)) }))}</small></span><span class="val"><button data-act="save">${esc(T('app.wallet.save.in'))}</button> · <button data-act="unsave">${esc(T('app.wallet.save.out'))}</button></span></div></div>
    <div class="gtitle">${esc(T('app.wallet.kin'))}</div>
    <div class="group" id="wKin">${from ? await cardRow(from, 'from') : ''}${to ? await cardRow(to, 'to', true) : ''}${(await Promise.all(others.map(c => cardRow(c, c.dir)))).join('')}
      ${name && !from ? `<button class="opt" data-act="kinask"><span>${esc(T('app.wallet.kin.ask', { name }))}</span><span class="val">›</span></button>` : ''}
      ${name && !to ? `<button class="opt" data-act="kingive"><span>${esc(T('app.wallet.kin.give', { name }))}</span><span class="val">›</span></button>` : ''}</div>
    <div class="gtitle">${esc(T('app.wallet.ledger'))}</div>
    <div class="group" id="wRows">${rows}</div>
    <div class="foot">${esc(T('app.wallet.foot'))}</div>`;
}
async function drawHis(T){
  const name = hisName(); if (!name) return `<div class="foot">${esc(T('app.wallet.his.none'))}</div>`;
  const list = (await hisLedger()).filter(e => !['moved', 'plan', 'kin'].includes(e.kind));
  const p = await M().records.get(TYPE, 'his-plan'), kinIn = await M().records.get(TYPE, 'kin-in'), kinOut = await M().records.get(TYPE, 'kin-out');
  const rows = list.slice().reverse().map(e => row(e, T, effect(e), hisLabel(e, T))).join('');
  return `
    <div class="group a-wallet-top a-wallet-his"><small>${esc(T('app.wallet.his.balance', { name }))}</small><b id="wHisBal">${esc(money(cashOf(list)))}</b>
      <small>${p && p.salary ? esc(T('app.wallet.his.salary', { d: p.day, amount: money(p.salary) })) : ''}</small></div>
    ${kinIn && kinIn.on || kinOut && kinOut.on ? `<div class="gtitle">${esc(T('app.wallet.kin'))}</div><div class="group" id="wHisKin">${kinOut && kinOut.on ? `<div class="opt"><span>${esc(T('app.wallet.his.kin.out'))}</span><span class="val">${esc(T('app.wallet.his.kin.limit', { limit: money(kinOut.limit) }))}</span></div>` : ''}${kinIn && kinIn.on ? `<div class="opt"><span>${esc(T('app.wallet.his.kin.in'))}</span><span class="val">${esc(T('app.wallet.his.kin.limit', { limit: money(kinIn.limit) }))}</span></div>` : ''}</div>` : ''}
    <div class="gtitle">${esc(T('app.wallet.his.bill'))}</div>
    <div class="group" id="wHisRows">${rows || `<div class="opt sub">${esc(T('app.wallet.bill.none'))}</div>`}</div>
    <div class="foot">${esc(T('app.wallet.his.foot', { name }))}</div>`;
}
async function drawPlay(T){
  const g = await play();
  const rows = g.stocks.map(s => {
    const ch = s.prev ? (s.price - s.prev) / s.prev * 100 : 0;
    return `<button class="opt a-wallet-stock" data-stock="${esc(s.code)}"><span class="a-wallet-what"><span>${esc(s.name)} <small>${esc(s.code)}</small></span><small>${s.n ? esc(T('app.wallet.play.have', { n: s.n })) : ''}</small></span><span class="val a-wallet-amt${ch >= 0 ? ' a-wallet-in' : ''}">${esc(coins(s.price))} · ${ch >= 0 ? '+' : ''}${esc(ch.toFixed(2))}%</span></button>`;
  }).join('');
  return `
    <div class="a-wallet-toy" id="wToy"><b>${esc(T('app.wallet.play.badge'))}</b> ${esc(T('app.wallet.play.toy'))}</div>
    <div class="group a-wallet-top"><small>${esc(T('app.wallet.play.coins'))}</small><b id="wCoins">${esc(coins(g.coins))}</b><small>${esc(T('app.wallet.play.value', { v: coins(g.value) }))}</small></div>
    <div class="gtitle">${esc(T('app.wallet.play.list'))}</div>
    <div class="group" id="wStocks">${rows}</div>
    <div class="foot">${esc(T('app.wallet.play.foot'))}</div>`;
}
function drawSent(T, s){
  const e = s.e, name = e.to || hisName();
  return `<div class="a-wallet-sent" id="wSent"><div class="a-wallet-ok"><svg class="ic"><use href="#i-wallet-ok"/></svg></div>
    <b>${esc(T('app.wallet.sent'))}</b><div class="a-wallet-sentamt">${esc(money(e.amount))}</div>
    <small>${esc(T(s.kind === 'transfer' ? 'app.wallet.sent.transfer' : 'app.wallet.sent.redpacket', { name }))}</small>
    <button class="btn" data-act="tochat">${esc(T('app.wallet.sent.chat'))}</button><button class="btn2" data-act="sentdone">${esc(T('done'))}</button></div>`;
}
async function draw(el, ctx, st){
  const T = ctx.T, body = el.querySelector('.a-wallet-body');
  // only the newest draw writes the screen: a 我的 draw still reading her records (started by give()'s own records events)
  // must not land over 发送成功 after sent() switched the view
  const gen = st.gen = (st.gen || 0) + 1;
  if (st.view === 'his' && !hisName()) st.view = 'me';
  const html = st.view === 'sent' ? drawSent(T, st.sent) : tabs(st, T) + (st.view === 'his' ? await drawHis(T) : st.view === 'play' ? await drawPlay(T) : await drawMe(T));
  if (gen !== st.gen) return;
  body.innerHTML = html;
  const redraw = () => draw(el, ctx, st).catch(e => console.error(e));
  body.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { st.view = b.dataset.view; redraw(); });
  body.querySelectorAll('[data-act]').forEach(b => b.onclick = async ev => {
    ev.stopPropagation();
    const k = b.dataset.act, name = hisName();
    if (k === 'redpacket' || k === 'transfer') return giveSheet(k, ctx, await balance(), { pick:true, sent: (e, kind) => { st.view = 'sent'; st.sent = { e, kind }; redraw(); } });
    if (k === 'tochat') { st.view = 'me'; return ctx.go('chat'); }
    if (k === 'sentdone') { st.view = 'me'; return redraw(); }
    if (k === 'plan') return planSheet(ctx);
    if (k === 'bill') return billSheet(ctx);
    if (k === 'save') return amountSheet(ctx, { title: T('app.wallet.save.in'), lead: T('app.wallet.left', { amount: money(await balance()) }), go: T('app.wallet.save.in'), run: save });
    if (k === 'unsave') return amountSheet(ctx, { title: T('app.wallet.save.out'), lead: T('app.wallet.save.left', { amount: money(await savings()) }), go: T('app.wallet.save.out'), run: unsave });
    if (k === 'kingive') return amountSheet(ctx, { title: T('app.wallet.kin.give', { name }), lead: T('app.wallet.kin.give.lead', { name }), go: T('app.wallet.kin.give.go'), run: a => grantCard({ limit: a }), done: T('app.wallet.toast.kin') });
    if (k === 'kinask') return amountSheet(ctx, { title: T('app.wallet.kin.ask', { name }), lead: T('app.wallet.kin.ask.lead', { name }), go: T('app.wallet.kin.ask.go'), run: async a => { try { const r = await askCard({ limit: a }); ctx.toast(T(r.granted ? 'app.wallet.toast.kin.yes' : 'app.wallet.toast.kin.no', { name })); } catch(x){ if (x.code) throw x; ctx.toast(T('app.wallet.toast.noanswer')); } } });
    if (k === 'kinstop') { await stopCard('to'); return ctx.toast(T('app.wallet.toast.kin.stop')); }
  });
  body.querySelectorAll('[data-stock]').forEach(b => b.onclick = async () => { const s = (await play()).stocks.find(x => x.code === b.dataset.stock); if (s) tradeSheet(ctx, s); });
  body.querySelectorAll('#wRows [data-id]').forEach(b => b.onclick = async () => {
    const e = await mine().get(TYPE, b.dataset.id); if (!e || !ASK[e.kind]) return;
    cardTap({ extra:{ modu_card:{ app:APP, id:e.id } } }, ctx);
  });
}

ModuApps.register({
  id: 'wallet', version: '0.2', icon: 'i-wallet', title: 'app.wallet', status: 'ready', css: true, records: [TYPE],
  // what it writes, held to it by static_check. Her wallet is on her phone (mine);
  // his folder gets his own wallet (side 'him'), his copies of what concerns him, and the one-time move marker.
  writes: { records: ['wallet'], mine: ['wallet', 'wallet-plan', 'wallet-card', 'wallet-play'],
    events: { redpacket: '发红包', transfer: '转账', 'redpacket-accepted': '收下红包', 'redpacket-returned': '退回红包', 'transfer-accepted': '收下转账', 'transfer-returned': '退回转账',
      'card-give': '给他开亲属卡', 'card-ask': '请他开亲属卡', 'card-granted': '他开了亲属卡', 'card-declined': '他没开亲属卡', 'card-stop': '停用亲属卡', 'card-pay': '用他的亲属卡付款', 'card-used': '他用了她的亲属卡' },
    chat: 'cards' },
  icons: {
    'i-wallet-red': '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M5 8.5c2.2 2 4.6 3 7 3s4.8-1 7-3"/><circle cx="12" cy="11.6" r="1.7"/>',
    'i-wallet-transfer': '<path d="M5 9h13l-3.5-3.5"/><path d="M19 15H6l3.5 3.5"/>',
    'i-wallet-ok': '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16.5 9.5"/>',
  },
  mount(el, ctx){
    el.innerHTML = `<div class="pad-top"></div><div class="bar"><button class="back" data-go="home" aria-label="back"><svg class="ic"><use href="#i-back"/></svg></button><div class="title">${esc(ctx.T('app.wallet'))}</div></div><div class="list a-wallet-body"></div>`;
    const st = { view:'me', sent:null };
    let t = null;
    const later = () => { clearTimeout(t); t = setTimeout(() => { if (st.view !== 'sent') draw(el, ctx, st).catch(e => console.error(e)); }, 60); };
    draw(el, ctx, st).catch(e => console.error(e));
    const off = M().on((ev, d) => { if ((ev === 'records' && [TYPE, PLAN, CARD, PLAY].includes(d.type)) || ev === 'loaded') later(); });
    return () => { clearTimeout(t); off(); };
  },
  card, cardTap,
  // the chat's ＋: 发红包 and 转账 from inside the chat, the same sheet as on this screen
  chatActions: [{ id:'redpacket', icon:'i-wallet-red', title:'app.wallet.redpacket' }, { id:'transfer', icon:'i-wallet-transfer', title:'app.wallet.transfer' }],
  async chatAction(id, ctx){ if (id === 'redpacket' || id === 'transfer') giveSheet(id, ctx, await balance()); },
  // for other apps (购物, 外卖) and tests; see README.md.
  api: { balance, ledger, pay, receive, setState, answer, give, effect, readDecision, ask, sayAsHim, money, yuan, START,
    entry, migrate, savings, save, unsave, getPlan, setPlan, schedule, bill,
    hisLedger, hisBalance, hooks,
    cards, grantCard, askCard, readCard, stopCard, payByCard, spendHerCard,
    play, trade, price, STOCKS, PLAY_START },
});
})();
