// 查手机 (peek), a page-2 app: his phone, opened for one person (scope 'contact'), READ-ONLY.
// His lock screen, then his home screen (laid out like hers, on her own wallpaper) with the apps that are his,
// drawn with the phone's own UI: his 微信 (his real chat with her, from his side), 朋友圈, 日记, 钱包, 一起听,
// 购物, 外卖, 信箱 from his folder's records; 备忘录 (what he remembers about her, his day so far), 联系人 and 搜索.
// Her-only things never show (形象, 设置, 记忆, 搬家, her 日历 / 清单, her store). Each app opens lazily.
// Read-only by construction: his apps read through roCore(), which has list / get and nothing that writes.
// The only things 查手机 writes are its own `peek` snapshot, his `phonebook`, and quiet `peeked` events.
// What nothing real fills (his notes, searches, songs, chats with other people in his world, each with a
// 心声 line) is generated once by the model from his persona and memory (his usual prompt, buildContext).
// The guard (never invent facts about her): the model must mark anything about her with about_her and quote
// where it knows it from (source). The app checks that quote word for word against his memories and the
// chat. Anything about her with no quote, or whose quote is not there, is left out, whether or not the model
// marked it; that includes anything that names her, 她, 你 or her name. What is left out is counted, never shown.
// The filler is kept as the record type `peek` (one snapshot per generation), so it stays the same until she
// asks for another. The screen says nothing about how it is made: that is said once, in 设置 → 关于.
// His 联系人: none until she says yes; then one call (app/prompts/contacts.txt) writes them from his card and
// she picks who stays. A card folder that brings its own contacts is used as it is, with no call. Kept as the
// record type `phonebook` (id 'list') in his folder, never in the card.
(function(){
'use strict';
const TYPE = 'peek', ID = 'peek', BOOK = 'phonebook';
const M = () => window.ModuCore;
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
// her name in his prompts is the one she gave in 聊天设置 (ModuCore.userName); what is stored keeps her chat's own
const userName = () => M().userName ? M().userName() : ((M().store.meta && M().store.meta.user_name) || 'You');
const SECTIONS = ['notes', 'searches', 'songs', 'chats'];
// the chat's language ('en' | 'other' | '' for Chinese), from the core; '' when it cannot say
const chatLang = core => { try { return core.chatLanguage ? core.chatLanguage(core.store.msgs || []) : ''; } catch { return ''; } };
// whether a line of his records is in the chat's language: in a Chinese chat a line with no Chinese in it
// (his day's outline, written for his own prompt in English: "wake 07:00, work 09:00–18:00…") is not shown
// One Chinese place name is not enough ("wake 07:46, work 09:30–12:00 at 工作的地方 …" stays hidden). A line is Chinese when it has Chinese in it and at most a couple
// of English words beside (two, or one for every two Chinese characters): 和 Alex 去 KTV stays, the outline does not
const inChatLang = (text, lang) => {
  if (lang === 'en' || lang === 'other') return true;
  const s = String(text || ''), han = (s.match(/[一-鿿]/g) || []).length;
  return han > 0 && (s.match(/[A-Za-z]{2,}/g) || []).length <= Math.max(2, han / 2);
};

// What he is asked (not shown to her; in code like the core's own rules).
// The people on his phone come from his own story: friends and colleagues, few or no women (at most one,
// work only), family only when his card names them; no exes. `family` = the family words his card itself
// uses (familyIn), so the model is told exactly which relatives exist. lang = the chat's language
// (core.chatLanguage: 'en' | 'other' | ''), so his notes are in it.
const ASK = (name, family, today, lang) => `（小手机的「查手机」试玩）现在要生成${name}自己手机里的内容：备忘录、搜索记录、歌单、和别人的聊天。要像${name}这个人真的会有的，生活化，具体。
规则，必须遵守：
1. 关于她（用户）的任何内容，只能来自你的记忆或你们聊天里明确出现过的事。每一条和她有关的内容都要写 "about_her": true，并在 "source" 里原样引用记忆或聊天里的那句话（一字不差）。
2. 没有依据的关于她的事一律不要写：不要编她的过去、她的朋友、她的秘密、她做过的事。
3. 不要编和别人暧昧、出轨之类的内容，不要前任。
4. 手机里的人只能来自${name}自己的设定：设定里写到的人，或者他生活里会有的男性朋友、同事、同学。${family.length ? `家人只能是设定里写到的：${family.join('、')}，别的家人一个都不要写。` : `设定里没有写家人，所以一个家人都不要写（爸妈、兄弟姐妹、亲戚都不要），备忘录和搜索里也不要提。`}女性联系人尽量不要，最多一个，只能是工作上的联系人，只聊工作。每个聊天写清楚 "gender"（"male" 或 "female"）、"family"（true 或 false）、"work"（true 或 false）。
5. 每条可以带一句 "inner"（${name}的心声，10 到 30 个字）。
6. 今天是${today}。备忘录里有具体哪天要做的事，"when" 写那天的日期（YYYY-MM-DD）；没有日子的写 ""。
7. ${lang === 'en' ? '你们聊天用的是英文，所以所有内容（text、last、inner）都用英文写。' : lang === 'other' ? '所有内容（text、last、inner）都用你们聊天用的那种语言写。' : '所有内容（text、last、inner）都用中文写，不要夹英文。'}
只输出一个 JSON，不要别的文字：
{"notes":[{"text":"…","when":"","inner":"…"}],"searches":[{"text":"…"}],"songs":[{"text":"歌名 - 歌手"}],"chats":[{"with":"…","gender":"male","family":false,"work":true,"last":"…","inner":"…"}]}
每类 3 到 5 条。`;

// ---- the people on his phone ----
// Family words, longest first. A lone 哥 / 姐 / 弟 / 妹 counts only as the whole name or after 我 / 他 / 她
// (林姐, 王小姐, 哥们, 师兄, 学姐 are colleagues, friends, school).
const FAMILY = /妈妈|爸爸|母亲|父亲|老妈|老爸|爷爷|奶奶|外公|外婆|姥姥|姥爷|哥哥|姐姐|弟弟|妹妹|舅舅|舅妈|姨妈|姑姑|姑妈|叔叔|婶婶|伯伯|伯父|伯母|表哥|表姐|表弟|表妹|堂哥|堂姐|堂弟|堂妹|侄子|侄女|外甥|儿子|女儿|老婆|妻子|丈夫|老公|岳父|岳母|公公|婆婆|亲戚|家人|爸|妈|(?:^|(?<=[我他她]))(?:哥|姐|弟|妹)(?![们儿子妹])|舅|婶|嫂/g;
const EX = /前任|前女友|前男友|初恋|暧昧/;
// A woman, from the name she is saved under (when the model did not say): 女士, 小姐, 阿姨, 姐, 妹, 太太…
const WOMAN = /女士|小姐|阿姨|太太|夫人|姑娘|嫂|姐|妹|女/;
function cardText(){
  const c = M().store.card || {}, book = c.character_book && (Array.isArray(c.character_book.entries) ? c.character_book.entries : Object.values(c.character_book.entries || {}));
  return [c.description, c.personality, c.scenario, c.first_mes, c.mes_example, c.system_prompt].concat((book || []).map(e => e && e.content)).filter(Boolean).join('\n');
}
// the family words his card itself uses (so those relatives may appear)
function familyIn(text){ return [...new Set(String(text || '').match(FAMILY) || [])]; }
// → why an item is left out ('family', 'ex', 'woman'), or '' when it may stay. womenSoFar: women kept already.
function people(item, card, womenSoFar){
  const all = [item.with, item.text, item.last].filter(Boolean).join(' ');
  const named = item.with && item.with.length >= 2 && card.includes(item.with);   // someone from his own story
  if (!named){
    // him calling her 老婆 / 老公 is about her (the guard below decides), not a relative
    const fam = (all.match(FAMILY) || []).filter(w => !(item.about_her && /^(老婆|老公)$/.test(w)));
    if (fam.some(w => !card.includes(w)) || item.family === true && !familyIn(card).length) return 'family';
    if (EX.test(all) && !EX.test(card)) return 'ex';
  }
  if (item.with !== undefined && item.with !== '' && !named && (item.gender === 'female' || (item.gender !== 'male' && WOMAN.test(item.with)))){
    if (item.work !== true || womenSoFar >= 1) return 'woman';
  }
  return '';
}

// ---- the guard: never invent facts about her ----
const norm = s => String(s || '').toLowerCase().replace(/[\s，。！？、：；“”‘’"'（）()【】\[\]…·,.!?:;~～—-]/g, '');
function factsText(){
  const core = M();
  return norm((core.store.memory || []).map(m => m.text || m.body || '').join('\n') + '\n' + (core.store.msgs || []).map(m => m.mes || '').join('\n'));
}
function mentionsHer(text){
  // her chosen name and her chat's own name both count
  const names = [userName(), M().store.meta && M().store.meta.user_name].filter(u => u && u !== 'You' && u.length >= 2);
  return /她|你|老婆|宝宝|宝贝/.test(text) || names.some(u => String(text).includes(u));
}
// → the item if it may stay, or null. An item about her stays only with a quote found in his memory or the chat.
function guard(item, facts){
  const text = [item.text, item.last, item.inner].filter(Boolean).join(' ');
  if (!item.about_her && !mentionsHer(text)) return item;
  const src = norm(item.source);
  return src.length >= 4 && facts.includes(src) ? item : null;
}
function readPhone(raw){
  let t = String(raw == null ? '' : raw).replace(/<think>[\s\S]*?<\/think>/gi, '');
  const m = t.match(/\{[\s\S]*\}/); if (!m) return null;
  let j; try { j = JSON.parse(m[0]); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const facts = factsText(), card = cardText(), phone = {}; let dropped = 0, kept = 0, others = 0, women = 0;
  for (const k of SECTIONS){
    const list = Array.isArray(j[k]) ? j[k] : [];
    phone[k] = [];
    for (const it of list.slice(0, 8)){
      if (!it || typeof it !== 'object') continue;
      const item = { text: String(it.text || '').slice(0, 120), with: String(it.with || '').slice(0, 20), last: String(it.last || '').slice(0, 120), inner: String(it.inner || '').slice(0, 60), about_her: !!it.about_her, source: String(it.source || '').slice(0, 120) };
      if (k === 'notes' && /^\d{4}-\d{2}-\d{2}$/.test(String(it.when || ''))) item.when = String(it.when);   // the day a note is for
      if (k === 'chats') Object.assign(item, { gender: it.gender === 'female' || it.gender === 'male' ? it.gender : '', family: it.family === true, work: it.work === true });
      if (!item.text && !item.last) continue;
      if (!guard(item, facts)) { dropped++; continue; }
      const why = people(k === 'chats' ? item : { text: item.text, about_her: item.about_her }, card, women);
      if (why) { others++; continue; }
      if (k === 'chats' && !(item.with.length >= 2 && card.includes(item.with)) && (item.gender === 'female' || (item.gender !== 'male' && WOMAN.test(item.with)))) women++;
      phone[k].push(item); kept++;
    }
  }
  return kept ? { phone, dropped, others } : null;
}

async function generate(ctx){
  const core = M(), settings = core.loadSettings();
  core.setPhase('thinking');
  let raw;
  try {
    const built = await core.buildContext({ settings });   // the core names her (userName)
    const asked = built.messages.concat([{ role:'system', content: ASK(core.store.name, familyIn(cardText()), isoOf(core.now()), chatLang(core)) }]);
    const heard = core.calls && core.calls.note ? core.calls.note('peek', asked, { settings }) : (x => x);   // counted for the cost meter
    // a call that never answers ends (else 查手机 stays on its wait line for ever)
    raw = heard(await Promise.race([core.callModel(settings, asked, { max_tokens: 1500 }), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), TIMEOUT))]));
  } catch(e){ ctx.toast(ctx.T('app.peek.toast.fail')); return null; }
  finally { core.setPhase('idle'); }
  const r = readPhone(raw);
  if (!r) { ctx.toast(ctx.T('app.peek.toast.fail')); return null; }
  return core.records.put(TYPE, { phone: r.phone, dropped: r.dropped, others: r.others, trial: true }, { app: ID });
}
async function latest(){ const l = await M().records.list(TYPE); return l.length ? l[l.length - 1] : null; }
// One look at a time, kept outside the screen: leaving 查手机 and coming back finds it still unlocking
// (and the same one, never a second model call); it ends for the companion it was started for.
// missed: whether the last look did not open, so 再看看 can say so where she looks (a toast alone is easy to miss)
let job = null, missed = false;
const TIMEOUT = 90000;
function start(ctx){
  if (job) return job.p;
  const who = M().currentId;
  missed = false;
  const p = generate(ctx).then(r => { missed = !r; return r; }, e => { missed = true; throw e; }).finally(() => { if (job && job.p === p) job = null; });
  job = { p, who };
  return p;
}
const running = () => !!(job && job.who === M().currentId);

// ---- his phone: read-only, from his folder ----
// roCore(core): what his apps may read, and nothing that writes: no put or remove, no chat, no event log, no
// model, no her store. 查手机's own views read only through it; an app's his.view gets it as ctx.core.
function roCore(core){
  const r = core.records;
  return Object.freeze({
    readOnly: true, owner: 'him',
    get store(){ return core.store; },
    get currentId(){ return core.currentId; },
    now: () => core.now ? core.now() : new Date(),
    msgDate: m => core.msgDate ? core.msgDate(m) : null,
    splitParts: (t, o) => core.splitParts ? core.splitParts(t, o) : [{ kind:'say', text: String(t || '') }],
    pronouns: () => core.pronouns ? core.pronouns() : { zh:'他' },
    records: Object.freeze({ list: t => r.list(t), get: (t, id) => r.get(t, id), types: () => r.types() }),
    eventList: o => core.eventList ? core.eventList(o) : Promise.resolve([]),
    on: f => core.on(f),
    // his status now, and his day record as it may be seen (slots that have begun only)
    status: () => core.personaState ? core.personaState() : null,
    day: Object.freeze({ get: d => 'day' in core ? core.day.get(d) : Promise.resolve(null), visible: (r, t) => core.day.visible(r, t) }),
    lang: () => chatLang(core),
  });
}
// his status in a line: what he is doing and where, or asleep; busy said when he is
function statusLine(ro, T){
  const s = ro.status && ro.status(); if (!s || !s.name) return '';
  if (s.presence === 'asleep') return T('app.peek.status.asleep');
  const l = [s.what, s.where].filter(Boolean).join(' · ');
  return s.busy || s.presence === 'busy' ? (l ? `${l} · ${T('app.peek.status.busy')}` : T('app.peek.status.busy')) : l;
}
// today's slots of his day that have begun, as his own notes: [{ t: 'HH:MM', text }]; back = 1: yesterday's.
// A day kept only in outline (a day of hers away, no slots) gives its one line.
async function todayNotes(ro, back = 0){
  const now = ro.now(), t = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, now.getHours(), now.getMinutes());
  const d = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`, r = await ro.day.get(d);
  if (!r) return [];
  const lang = ro.lang ? ro.lang() : '';
  const slots = ro.day.visible(r, +now).slots.map(s => ({ t: hm(new Date(s.at)), text: [s.where, s.doing].filter(Boolean).join(' ') })).filter(s => inChatLang(s.text, lang));
  // the outline only when it is in the chat's language (life writes it in English, for his prompt)
  return slots.length || !r.line || !inChatLang(r.line, lang) || (!back && now.getHours() < 6) ? slots : [{ t: '', text: String(r.line) }];
}
// when his day has nothing to show yet (the day she comes back, before it is written), 今天 still has a line:
// what he is doing now (his status), never empty
function nowNote(ro){
  const s = ro.status ? ro.status() : null; if (!s || s.presence === 'asleep') return [];
  const text = [s.where, s.what].filter(Boolean).join(' '); return text && inChatLang(text, ro.lang ? ro.lang() : '') ? [{ t: hm(ro.now()), text }] : [];
}

// ---- his contacts: none until she says yes; she picks who stays ----
// card folder's own (store.cardFolder.contacts with a list) → as it is; else the record; else nothing (the ask)
const GENDER = { m: 'm', f: 'f', x: 'x', male: 'm', female: 'f', '男': 'm', '女': 'f' };
const genderOf = g => GENDER[String(g || '').trim().toLowerCase()] || 'x';
// a list the model wrote: trimmed to the fields it was asked for
function readPeople(list){
  return [].concat(list || []).filter(p => p && typeof p === 'object' && String(p.name || '').trim()).slice(0, 20)
    .map(p => ({ name: String(p.name).trim().slice(0, 20), gender: genderOf(p.gender), relation: String(p.relation || '').slice(0, 30), line: String(p.line || p.last || '').slice(0, 120) }));
}
// a card folder's own contacts.json (the core's parsed copy, folderData.contacts: { contacts: [...] }, { people }, or a
// list): used as it is: every person and every field kept (recent_calls_seeds …); only `gender` is read as m / f / x.
// A person's shown name is `name`, else `label` (a card set may call it that), and who they are is
// `relation`, else `who`.
const shownName = p => String(p.name || p.label || '').trim();
function ownPeople(core){
  const d = 'folderData' in core && core.folderData ? core.folderData.contacts : null;
  const list = Array.isArray(d) ? d : d && (Array.isArray(d.contacts) ? d.contacts : Array.isArray(d.people) ? d.people : null);
  return (list || []).filter(p => p && typeof p === 'object' && shownName(p)).map(p => Object.assign({}, p, { name: shownName(p), gender: genderOf(p.gender), relation: String(p.relation || p.who || '') }));
}
async function contactsNow(core){
  const own = ownPeople(core);
  if (own.length) return { from: 'card-folder', people: own };
  try { return await core.records.get(BOOK, 'list'); } catch { return null; }
}

// The contacts calls still on their way, one per companion (who → p: the people, or throws). After the give-up,
// 再试一次 waits for this same call again instead of paying for a second one; it is cleared once it has answered (or failed).
const inflight = new Map();
async function makeContacts(core){
  const who = core.currentId || '';
  if (!inflight.has(who)){
    const pr = core.pronouns ? core.pronouns() : { zh: '他', en: 'he/him' }, l = core.chatLanguage ? core.chatLanguage(core.store.msgs || []) : '';
    const text = await core.prompt('contacts', { char: core.store.name || '', pronoun: pr.zh, pronoun_en: String(pr.en || '').split('/')[0], card_digest: cardText().slice(0, 6000), count: 8, lang: l === 'en' ? 'English' : 'Chinese' });
    if (!text) throw new Error('no contacts prompt');
    if (!inflight.has(who)){
      // through the core's one counted door (side model, refused while 暂停 is on); a core without it: the model directly.
      // A model that thinks first may spend a small answer budget all on thinking and send back no text, or a list
      // cut off mid-way. So: room for the thinking (CONTACTS_MAX; only what is used is paid for), an end after
      // CONTACTS_WAIT, the people of a list cut off kept when there are enough, and every failure says why (failWhy).
      const msgs = [{ role: 'user', content: text }];
      const p = Promise.resolve().then(() => 'sideCall' in core ? core.sideCall('contacts', msgs, { max: CONTACTS_MAX }) : core.callModel(core.loadSettings(), msgs, { max_tokens: CONTACTS_MAX })).then(readContacts);
      inflight.set(who, p);
      p.then(() => {}, () => {}).then(() => { if (inflight.get(who) === p) inflight.delete(who); });
    }
  }
  let timer = 0;
  const late = new Promise((_, no) => { timer = setTimeout(() => { const e = new Error('timeout'); e.code = 'timeout'; no(e); }, CONTACTS_WAIT); });
  try { return await Promise.race([inflight.get(who), late]); }
  finally { clearTimeout(timer); }
}
// an answer → the people (two at least), or an error that says what was wrong with it (code: empty, cut, unreadable)
function readContacts(answer){
  const raw = String(answer == null ? '' : answer).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!raw){ const e = new Error('empty'); e.code = 'empty'; throw e; }
  const people = readPeople(contactsIn(raw));
  if (people.length < 2){ const e = new Error('no contacts'); e.code = raw.includes('{') ? 'cut' : 'unreadable'; throw e; }
  return people;
}
// whether a contacts call for him is still on its way (after the give-up: 再试一次 waits for it)
const contactsBusy = core => inflight.has(core.currentId || '');
const CONTACTS_MAX = 4000, CONTACTS_WAIT = 120000;
// the contacts of an answer: the whole JSON when it parses, else each complete {…} with a name (an answer cut off)
function contactsIn(raw){
  const m = raw.match(/\{[\s\S]*\}/);
  if (m){ try { const j = JSON.parse(m[0]); if (j && Array.isArray(j.contacts)) return j.contacts; if (Array.isArray(j)) return j; } catch {} }
  const out = [];
  for (const o of raw.match(/\{[^{}]*\}/g) || []){ try { const p = JSON.parse(o); if (p && p.name) out.push(p); } catch {} }
  return out;
}
// why it did not work, in her words: 暂停, no answer in time, thought but wrote nothing, cut off, or the model service's own words
function failWhy(e, T){
  const code = e && e.code;
  if (code === 'paused') return T('peek.contacts.why.paused', { name: M().store.name || '' });
  if (code === 'timeout') return T('peek.contacts.why.timeout');
  if (code === 'empty' || /没有文字|只想了/.test(String((e && e.message) || ''))) return T('peek.contacts.why.empty');
  if (code === 'cut') return T('peek.contacts.why.cut');
  if (code === 'unreadable') return T('peek.contacts.why.unreadable');
  const msg = String((e && e.message) || '');
  // the core's own errors are already in her words (连不上模型服务, 模型服务回了 401…, 还没有设置模型)
  return /[一-鿿]/.test(msg) ? T('peek.contacts.why.model', { why: msg.slice(0, 80) }) : T('peek.contacts.why.unreadable');
}
async function keepContacts(core, people){
  const old = await core.records.get(BOOK, 'list').catch(() => null);
  return (await core.records.commit(BOOK, { id: 'list', people: readPeople(people), from: 'model', rev: (old ? Number(old.rev) || 0 : 0) + 1, at: (core.now ? core.now() : new Date()).getTime() }, { writer: ID, app: ID })).record;
}
// what the call may cost at most: his card and the ask going in, and the most the answer may use
const costK = () => Math.max(1, Math.round((Math.min(cardText().length, 6000) + 1500 + CONTACTS_MAX) / 1000));
// failed: '' or why the last ask did not work (said plainly, where she looks, not in small grey under the ask)
let pc = { who: '', pending: null, working: false, failed: '' };
async function contactsView(ro, T){
  const core = M(), name = ro.store.name || '';
  if (pc.who !== (core.currentId || '')) pc = { who: core.currentId || '', pending: null, working: false, failed: '' };
  // something moves while it writes (the same running light as the look), and it always ends
  if (pc.working) return `<div class="a-peek-wait a-peek-pcwait" role="status" aria-live="polite"><b>${esc(T('peek.contacts.working'))}</b><div class="a-peek-run"><i></i></div></div>`;
  if (pc.failed && !pc.pending){
    const book = await contactsNow(core), had = book && Array.isArray(book.people) && book.people.length;
    if (!had) return `<div class="group a-peek-ask a-peek-failed" role="alert"><div class="opt"><span><b>${esc(T('peek.contacts.failed'))}</b><small>${esc(pc.failed)}</small></span></div></div><button class="btn2" data-pc="yes">${esc(T('peek.contacts.retry'))}</button>`;
  }
  if (pc.pending) return `<div class="gtitle">${esc(T('peek.contacts.pick'))}</div><div class="group">${pc.pending.map((p, i) => `<label class="opt a-peek-person"><input type="checkbox" data-pc-pick="${i}" checked><span><b>${esc(p.name)}</b>${p.gender !== 'x' ? ` <small>${esc(T('app.peek.g.' + p.gender))}</small>` : ''}<small>${esc([p.relation, p.line].filter(Boolean).join(' · '))}</small></span></label>`).join('')}</div><button class="btn2" data-pc="keep">${esc(T('peek.contacts.keep', { n: pc.pending.length }))}</button>`;
  const book = await contactsNow(core), people = book && Array.isArray(book.people) ? book.people : [];
  if (people.length) return `<div class="group">${people.map(p => `<div class="opt a-peek-person"><span><b>${esc(p.name)}</b>${p.gender !== 'x' ? ` <small>${esc(T('app.peek.g.' + p.gender))}</small>` : ''}<small>${esc([p.relation, p.line].filter(Boolean).join(' · '))}</small></span></div>`).join('')}</div>` +
    (pc.failed ? `<div class="foot a-peek-failed" role="alert">${esc(T('peek.contacts.failed'))} ${esc(pc.failed)}</div>` : '') +
    (book.from === 'card-folder' ? '' : `<button class="btn2" data-pc="yes">${esc(T('peek.contacts.again'))}</button>`);
  return `<div class="group a-peek-ask"><div class="opt"><span><b>${esc(T('peek.contacts.ask', { name }))}</b><small>${esc(T('peek.contacts.ask.sub', { name }))}</small><small>${esc(T('peek.contacts.cost', { k: costK() }))}</small></span></div></div>` +
    `<button class="btn2" data-pc="yes">${esc(T('peek.contacts.yes'))}</button>`;
}
const pad = n => String(n).padStart(2, '0');
const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// A note of his is for a day: the day the model gave ("when"), else read from its words on the day the
// notes were written (今天 / 今晚 / 晚上九点 / 21:00 → that day, 明天 +1, 后天 +2); a note with no day (买猫粮) has none.
// A note whose day has passed is crossed out for two days, then gone; today's and later ones stay as they are.
// (a bare 一点 is "a little": 少喝一点、早一点睡; it is a time only after 凌晨 / 中午 / 下午 …)
const TIMED = /今天|今晚|今早|今夜|(?:凌晨|早上|上午|中午|下午|傍晚|晚上|夜里)\s*[0-9一二三四五六七八九十两]{1,3}\s*点|(?:\d{1,2}|十[一二]?|[两三四五六七八九])\s*点(?!儿)|\d{1,2}[:：]\d{2}/;
function noteDay(it, made){
  if (it && /^\d{4}-\d{2}-\d{2}$/.test(String(it.when || ''))) return it.when;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(made || '')), text = String((it && it.text) || ''); if (!m) return '';
  const plus = /后天/.test(text) ? 2 : /明天|明早|明晚/.test(text) ? 1 : TIMED.test(text) ? 0 : -1;
  return plus < 0 ? '' : isoOf(new Date(+m[1], m[2] - 1, +m[3] + plus));
}
// A note he has since said he did: a line of his written after the notes were made shares at least half of
// the note's word pairs (快递 of 取快递) and says it is done (收了, 弄完, 搞定, 已经 …; never 还没 / 待会 / 打算 …).
// → the time he said it, or 0
const DONE_SAID = /了|完|好啦|搞定|弄好|已经|\b(?:done|finished)\b/i, NOT_YET = /还没|还得|待会|一会儿|等会|打算|准备|记得|别忘/;
const notePairs = t => { const s = new Set(); for (const run of String(t || '').match(/[一-鿿]{2,}/g) || []) for (let i = 0; i + 2 <= run.length; i++){ const g = run.slice(i, i + 2); if (!/[的了是我你他她要去把给和]/.test(g)) s.add(g); } return s; };
function saidDone(it, lines){
  const want = notePairs(it && it.text); if (!want.size) return 0;
  for (const l of lines || []){
    const t = String(l.text || ''); if (!DONE_SAID.test(t) || NOT_YET.test(t)) continue;
    let n = 0; for (const g of want) if (t.includes(g)) n++;
    if (n && n * 2 >= want.size) return Number(l.at) || 1;
  }
  return 0;
}
// his lines in the chat after `since` (ms), one per line of a message: what saidDone reads
function hisLinesSince(msgs, since){
  const out = [];
  for (const m of msgs || []) if (m && !m.is_user && m.mes && (Number(m.send_date) || 0) >= since) for (const l of String(m.mes).split('\n')) if (l.trim()) out.push({ at: Number(m.send_date) || 0, text: l.trim() });
  return out;
}
// → the notes to show: [{ ...note, done }], the ones still ahead first; a passed one stays crossed out for KEEP_DONE days,
// and so does one he said he did (`said`, his lines since the notes were made), counted from when he said it
const KEEP_DONE = 2;
function notesNow(list, made, now, said){
  const today = isoOf(now), gone = isoOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - KEEP_DONE)), on = [], done = [];
  for (const it of list || []){
    const d = noteDay(it, made), at = saidDone(it, said);
    if (at){ if (isoOf(new Date(at)) >= gone) done.push(Object.assign({}, it, { done: true })); continue; }
    if (!d || d >= today) on.push(it); else if (d >= gone) done.push(Object.assign({}, it, { done: true }));
  }
  return on.concat(done);
}
// His memory is written to her ("你…"); on his phone it is his own note about her, so 你 reads 她
// (and in a line she wrote herself, 我 is her and 你 is him). 我们 / 咱们 / 你们 stay as they are. English lines stay as they are.
function aboutHer(m){
  const t = String(m.text || m.body || '').trim();
  if (!/[一-鿿]/.test(t)) return t;
  const KEEP = ['迷你', '我们', '咱们', '你们'];
  const keep = s => KEEP.reduce((x, w, i) => x.split(w).join(String.fromCharCode(1 + i) + '\u0005'), s);
  const back = s => KEEP.reduce((x, w, i) => x.split(String.fromCharCode(1 + i) + '\u0005').join(w), s);
  if (m.voice === 'hers') return back(keep(t).replace(/我/g, '\u0006').replace(/你/g, '我').replace(/\u0006/g, '她'));
  return back(keep(t).replace(/你/g, '她'));
}
const she = () => { const u = userName(); return u && u !== 'You' ? u : '她'; };
const plain = t => String(t || '').replace(/\*([^*]+)\*/g, '').replace(/\s+/g, ' ').trim() || String(t || '');
const yuan = c => (Math.round(Number(c) || 0) / 100).toFixed(2);
const icon = id => `<svg class="ic"><use href="#${esc(id)}"/></svg>`;
function when(T, at, now){
  const d = new Date(at), n = new Date(now); if (!at || isNaN(d)) return '';
  if (d.toDateString() === n.toDateString()) return hm(d);
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return T('app.peek.yesterday.at', { t: hm(d) });   // its own key (app.peek.yesterday is the 备忘录 heading 昨天)
  return T('app.peek.md', { m: d.getMonth() + 1, d: d.getDate(), t: hm(d) });
}

// The apps on his phone, in this order. One with `app` shows only when that app is ready and keeps things in
// his folder (writes.records): her-only apps (日历, 清单: her store only) never show, nor do the page's own
// screens (形象, 设置, 记忆, 搬家). `his: false` on register keeps an app off; `his.view` lets it draw itself.
const HIS = [
  { id:'wechat', icon:'i-chat', title:'app.peek.wechat' }, { id:'contacts', icon:'i-peek-people', title:'app.peek.contacts' },
  // no 相册: his folder holds only pictures she sent him (hers), so it would show her pictures as his; it comes
  // back when there is image making for his own
  { id:'moments', app:'moments' }, { id:'diary', app:'diary' }, { id:'wallet', app:'wallet' },
  { id:'music', app:'music' }, { id:'shop', app:'shop' }, { id:'food', app:'food' }, { id:'mail', app:'mail' },
  { id:'notes', icon:'i-pen', title:'app.peek.notes' }, { id:'searches', icon:'i-peek-search', title:'app.peek.searches' },
];
function hisApps(){
  const R = window.ModuApps, out = [];
  const onHis = a => !!(a && a.status === 'ready' && a.id !== ID && a.his !== false && a.writes && a.writes.records.length);
  for (const h of HIS){
    if (!h.app) { out.push(h); continue; }
    const a = R.get(h.app);
    if (onHis(a) && (VIEW[h.id] || (a.his && typeof a.his.view === 'function'))) out.push({ id: h.id, app: a.id, icon: a.icon, title: a.title });
  }
  // any other app of his that draws its own read-only screen, before 备忘录 and 搜索
  for (const a of R.list()) if (onHis(a) && a.his && typeof a.his.view === 'function' && !out.some(x => x.app === a.id || x.id === a.id))
    out.splice(out.length - 2, 0, { id: a.id, app: a.id, icon: a.icon, title: a.title });
  return out;
}

// ---- what each of his apps shows: real records first (his folder, his chat, his memory) ----
// an app with nothing yet says so in its own plain words (app.peek.empty.<id>), else the common line
const empty = (T, id) => { const k = 'app.peek.empty.' + id, own = id && T(k) !== k ? T(k) : T('app.peek.empty'); return `<div class="empty">${esc(own)}</div>`; };
const item = (text, inner, T, k, done) => `<div class="opt a-peek-item${done ? ' a-peek-done' : ''}"><span>${k === 'chats' ? `<b>${esc(text.with)}</b>${esc(text.last)}` : esc(text)}${inner ? `<small class="a-peek-inner">${esc(T('app.peek.inner', { inner }))}</small>` : ''}</span></div>`;
// something moves at once and keeps moving until the filler is there: the lock breathes, a light runs.
// Inside one of his apps his phone is already open, so the wait line says it is looking, not unlocking.
const WAIT = T => `<div class="a-peek-wait" role="status" aria-live="polite"><b>${esc(T('app.peek.looking'))}</b><div class="a-peek-run"><i></i></div></div>`;
// the made-up part of one section (his notes, his searches with nobody's records behind them), and 再看看
function filler(k, p, busy, T, now, said){
  if (busy) return WAIT(T);
  // only lines in the chat's language, as on his home screen's 备忘录 widget
  const lang = chatLang(M());
  let list = ((p && p.phone && p.phone[k]) || []).filter(it => inChatLang(k === 'chats' ? it.last : it.text, lang));
  if (k === 'notes' && now) list = notesNow(list, p && p.date, now, said);   // his notes for a day that has passed, or that he said he did
  return (list.length ? `<div class="group">${list.map(it => item(it.text, it.inner, T, k, it.done)).join('')}</div>` : '') +
    (missed ? `<div class="foot a-peek-missed">${esc(T('app.peek.toast.fail'))}</div>` : '') + `<button class="btn2" id="pGo">${esc(T('app.peek.again'))}</button>`;
}
const VIEW = {
  // his 微信: she is the contact. Her chat is the real one; the others only if the filler was made already
  async wechat(ro, T){
    const msgs = ro.store.msgs || [], last = [...msgs].reverse().find(m => m && m.mes && !m.is_system), now = +ro.now();
    const p = await latest(), others = (p && p.phone && Array.isArray(p.phone.chats)) ? p.phone.chats : [];
    const at = last && ro.msgDate(last);
    return `<div class="a-peek-clist"><button class="citem a-peek-her" data-his-chat="her"><div class="av"></div><div class="cmid"><b>${esc(she())}</b><small>${esc(last ? plain(last.mes) : '')}</small></div><small class="t">${esc(at ? when(T, +at, now) : '')}</small></button>` +
      others.map((c, i) => `<button class="citem a-peek-item" data-his-chat="${i}"><div class="av"></div><div class="cmid"><b>${esc(c.with)}</b><small>${esc(c.last)}</small></div></button>`).join('') + '</div>';
  },
  async moments(ro, T){
    const now = +ro.now(), name = ro.store.name || '';
    const list = ((await ro.records.list('moments')) || []).filter(p => p && p.text && (p.at || 0) <= now).sort((a, b) => (b.at || 0) - (a.at || 0));
    if (!list.length) return '';
    return list.map(p => {
      const his = p.by !== 'her', likes = his ? (p.liked ? [she()] : []) : (p.heLiked ? [name] : []);
      const cs = (p.comments || []).filter(c => c && c.text && (c.at || 0) <= now);
      return `<article class="group a-peek-post"><b>${esc(his ? name : she())}</b><p>${esc(p.text)}</p><small class="a-peek-when">${esc(when(T, p.at, now))}</small>` +
        (likes.length ? `<div class="a-peek-likes">♡ ${esc(likes.join('，'))}</div>` : '') +
        cs.map(c => `<div class="a-peek-c"><b>${esc(c.by === 'her' ? she() : name)}</b>：${esc(c.text)}</div>`).join('') + '</article>';
    }).join('');
  },
  async diary(ro, T){
    const t = ro.now(), today = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
    const list = ((await ro.records.list('diary')) || []).filter(e => e && e.text && String(e.date) <= today && (!e.at || e.at <= +t)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return list.map(e => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.date) || [];
      return `<article class="group a-peek-entry"><div class="a-peek-date">${esc(m[0] ? T('app.peek.day', { m: Number(m[2]), d: Number(m[3]) }) : '')}</div><p>${esc(e.text)}</p></article>`; }).join('');
  },
  // his 钱包: what passed between them, from his side (her 红包 and 转账 to him come in; his gifts to her go out)
  async wallet(ro, T){
    const now = +ro.now(), rows = [];
    const all = (await ro.records.list('wallet')) || [];
    // his own wallet is the entries marked side 'him'; older entries between them (her 红包 to him, her gifts) still show
    const his = all.filter(e => e && e.side === 'him');
    if (his.length){
      for (const e of his){
        if (!(Number(e.amount) > 0) || !e.dir) continue;
        const k = 'app.peek.wallet.kind.' + e.kind;
        // something he bought himself on his day (外卖 / 购物, kind 'own'): the app's name, the thing below
        const what = e.kind === 'own' && e.app ? T('app.' + e.app) : T(k, { she: she() }) !== k ? T(k, { she: she() }) : (e.note || T('app.peek.wallet.title'));
        const line = e.by === 'her' && e.dir === 'in' ? T('app.peek.wallet.from', { she: she(), what }) : what;
        rows.push({ at: e.at, line, amt: (e.dir === 'in' ? '+' : '-') + yuan(e.amount), st: '', note: e.note && e.note !== what ? e.note : '' });
      }
    }
    for (const e of all){
      if (!e || e.side || !(Number(e.amount) > 0)) continue;
      const st = T('app.peek.wallet.state.' + e.state) !== 'app.peek.wallet.state.' + e.state ? T('app.peek.wallet.state.' + e.state) : '';
      if ((e.kind === 'redpacket' || e.kind === 'transfer') && e.dir === 'out')
        rows.push({ at: e.at, line: T('app.peek.wallet.from', { she: she(), what: T('app.peek.wallet.' + e.kind) }), amt: '+' + yuan(e.amount), st, note: e.note });
      else if (e.kind === 'gift' && e.dir === 'in')
        rows.push({ at: e.at, line: T('app.peek.wallet.gift', { she: she(), item: e.note || '' }), amt: '-' + yuan(e.amount), st, note: '' });
    }
    if (!rows.length) return '';
    rows.sort((a, b) => (b.at || 0) - (a.at || 0));
    return `<div class="gtitle">${esc(T('app.peek.wallet.title'))}</div><div class="group">${rows.map(r => `<div class="opt a-peek-money"><span>${esc(r.line)}<small>${esc([when(T, r.at, now), r.note, r.st].filter(Boolean).join(' · '))}</small></span><span class="val">${esc(r.amt)}</span></div>`).join('')}</div>`;
  },
  // his 一起听: the songs they really played; the made-up 歌单 only when there are none
  async music(ro, T){
    const now = +ro.now(), list = ((await ro.records.list('music')) || []).filter(s => s && s.title).sort((a, b) => (b.at || 0) - (a.at || 0));
    if (list.length) return `<div class="gtitle">${esc(T('app.peek.music.together', { she: she() }))}</div><div class="group">${list.map(s => `<div class="opt"><span>${esc(s.title)}</span><span class="val">${esc(when(T, s.at, now))}</span></div>`).join('')}</div>`;
    const p = await latest(), songs = (p && p.phone && p.phone.songs) || [];
    return songs.length ? `<div class="gtitle">${esc(T('app.peek.songs'))}</div><div class="group">${songs.map(it => item(it.text, it.inner, T)).join('')}</div>` : '';
  },
  shop: (ro, T) => orders('shop', ro, T),
  food: (ro, T) => orders('food', ro, T),
  async mail(ro, T){
    const now = +ro.now();
    const list = ((await ro.records.list('letter')) || []).filter(r => r && r.text && (r.from !== 'him' || now >= (r.due || 0))).sort((a, b) => (b.at || 0) - (a.at || 0));
    // each letter has its key, so a letter she opened is opened again when the list is drawn anew
    return list.map(r => `<details class="group a-peek-letter" data-key="${esc(r.id || r.at)}"><summary><b>${esc(T(r.from === 'him' ? 'app.peek.mail.to' : 'app.peek.mail.from', { she: she() }))}</b><small>${esc(when(T, r.at, now))}</small></summary><p>${esc(r.text)}</p></details>`).join('');
  },
  // his 备忘录: what he keeps about her (his memory, the real part), then his own errands (the filler)
  async notes(ro, T, o){
    // what he keeps about her; not the note of how long she was away (it never heads his 备忘录)
    // only lines in the chat's language (an English note in a Chinese chat is left out)
    const mem = (ro.store.memory || []).filter(m => m && m.kind !== 'absence').map(aboutHer).filter(t => t && inChatLang(t, ro.lang ? ro.lang() : '')).slice(-8).reverse();
    // before his first slot of today (e.g. 02:46), yesterday's day is what his notes hold
    let today = await todayNotes(ro).catch(() => []), title = 'app.peek.today';
    if (!today.length && ro.now().getHours() >= 6) today = nowNote(ro);   // her return day has a 今天 too
    if (!today.length) { today = await todayNotes(ro, 1).catch(() => []); title = 'app.peek.yesterday'; }
    return (mem.length ? `<div class="gtitle">${esc(T('app.peek.about', { she: she() }))}</div><div class="group">${mem.map(t => `<div class="opt a-peek-mem"><span>${esc(t)}</span></div>`).join('')}</div>` : '') +
      (today.length ? `<div class="gtitle">${esc(T(title))}</div><div class="group">${today.map(n => `<div class="opt a-peek-day"><span>${esc(n.text)}</span><span class="val">${esc(n.t)}</span></div>`).join('')}</div>` : '') +
      filler('notes', o.p, o.busy, T, ro.now(), o.p ? hisLinesSince(ro.store.msgs, Number(o.p.at) || 0) : []);
  },
  contacts: (ro, T) => contactsView(ro, T),
  // until the made-up searches are there, what he looked up for his own day (its slots so far, as
  // search words: where and what), so the screen is never empty while his day has begun
  async searches(ro, T, o){
    const has = o.p && o.p.phone && (o.p.phone.searches || []).length;
    let day = has ? [] : await todayNotes(ro).catch(() => []);
    if (!has && !day.length) day = await todayNotes(ro, 1).catch(() => []);
    const seen = new Set(), own = day.reverse().map(n => n.text).filter(x => x && !seen.has(x) && seen.add(x)).slice(0, 6);
    return (own.length ? `<div class="group">${own.map(x => `<div class="opt a-peek-day"><span>${esc(x)}</span></div>`).join('')}</div>` : '') + filler('searches', o.p, o.busy, T);
  },
};
// his 购物 / 外卖: what he bought himself on his own day (kind 'own', from the apps' life hook), the things she
// gave him, and what he sent her
async function orders(type, ro, T){
  const now = +ro.now(), list = ((await ro.records.list(type)) || []).filter(o => o && o.name && o.kind !== 'likes').sort((a, b) => (b.arrivedAt || b.at || 0) - (a.arrivedAt || a.at || 0));
  // a gift of hers that arrived is his thing (kind 'thing'); older orders (no kind) as they were
  const at = o => o.arrivedAt || o.at;
  const got = list.filter(o => o.kind === 'thing' ? o.from !== 'him' : !o.kind && o.for === 'him' && o.from !== 'him'), sent = list.filter(o => !o.kind && o.from === 'him');
  const sec = (k, l) => l.length ? `<div class="gtitle">${esc(T(k, { she: she() }))}</div><div class="group">${l.map(o => `<div class="opt"><span>${esc(o.name)}<small>${esc(when(T, at(o), now))}</small></span><span class="val">¥${esc(yuan(o.price))}</span></div>`).join('')}</div>` : '';
  // only what was really bought: not one he was short for, nor one whose payment has not gone through ('paying')
  const own = list.filter(o => o.kind === 'own' && (o.at || 0) <= now && (!o.state || o.state === 'paid' || o.state === 'nowallet'));
  return sec('app.peek.' + type + '.own', own) + sec('app.peek.shop.got', got) + sec('app.peek.shop.sent', sent);
}
// one chat in his 微信: 'her' (the real one, he is 'me' on the right) or the n-th made-up chat
async function chatView(k, ro, T){
  if (k !== 'her'){
    const p = await latest(), c = p && p.phone && (p.phone.chats || [])[Number(k)];
    if (!c) return { title: '', html: '' };
    return { title: c.with, html: `<div class="b ta">${esc(c.last)}</div>` + (c.inner ? `<small class="a-peek-inner a-peek-chatinner">${esc(T('app.peek.inner', { inner: c.inner }))}</small>` : '') };
  }
  const now = +ro.now(), name = ro.store.name || '', pro = (ro.pronouns() || {}).zh || '';
  let out = '', lastAt = 0;
  for (const m of (ro.store.msgs || []).slice(-300)){
    if (!m || !m.mes) continue;
    const d = ro.msgDate(m), at = d ? +d : 0;
    if (at && (!lastAt || at - lastAt > 5 * 60000)) out += `<div class="stamp">${esc(when(T, at, now))}</div>`;
    if (at) lastAt = at;
    if (m.is_system) { out += `<div class="sysline">${esc(m.mes)}</div>`; continue; }
    // hers: the contact, on the left (her *actions* quieter, as in her chat); his: what he typed, on the right
    if (m.is_user) { out += `<div class="b ta">${esc(m.mes).replace(/\*([^*]+)\*/g, '<span class="act">$1</span>')}</div>`; continue; }
    for (const part of ro.splitParts(m.mes, { name, pronoun: pro, actions: false })) if (part.text) out += `<div class="b me">${esc(part.text)}</div>`;
  }
  return { title: she(), html: out };
}

// He may notice she looked, rarely, depending on his mood. Each time she opens 查手机, and each of his apps in
// it, one `peeked` entry goes into the event log as quiet: it is kept, and left out of his prompt; detail.app
// says what she looked at ('lock' for his phone itself, then 'wechat', 'diary', …). Whether and when he
// notices it is decided through ModuCore.noticeRules.add('peeked', rule), the core's seam for exactly this.
function peeked(app, title){
  const c = M(); if (!c.logEvent) return null;
  const line = app === 'lock' ? '她打开查手机，看了你的手机' : `她在查手机里看了你的${title || app}`;
  return c.logEvent({ app: ID, title: '查手机', who: 'her', what: 'peeked', quiet: true, line, detail: { app } }).catch(e => console.error(e));
}

// where she is on his phone, kept for this visit: leaving 查手机 and coming back finds the same place;
// another person, or a new visit, starts at his lock screen
let where = { who: '', view: 'lock' };
// where his apps go on his home screen: the dock, then four beside his day on page 1; the rest on page 2
const DOCK = ['wechat', 'contacts', 'notes', 'searches'], FRONT = ['moments', 'diary', 'wallet', 'music'];

ModuApps.register({
  id: 'peek', version: '0.4',
 icon: 'i-peek', title: 'app.peek', status: 'ready', css: true, records: [TYPE],
  icons: { 'i-peek-search': '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>', 'i-peek-people': '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-4 3.2-6 6.5-6s6 2 6.5 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2 .7 3.3 2.6 3.5 6"/>' },
  // opened for one person, from his chat's ··· too; what it writes, held to it by static_check
  scope: 'contact', surface: 'screen',
  contactActions: [{ id: 'peek', title: 'app.peek.open' }],
  writes: { records: ['peek', 'phonebook'], events: { peeked: '她看了他的手机' }, chat: 'none' },
  mount(el, ctx){
    const T = ctx.T, ro = roCore(M());
    let alive = true, seq = 0, unview = null, tried = false;
    let view = where.who && where.who === M().currentId ? where.view : 'lock';
    const set = v => { view = v; where = { who: M().currentId || '', view: v }; };
    const chip = () => (ctx.withChip ? ctx.withChip() : '');
    const back = icon('i-back');
    // his lock and home screens are on her own wallpaper (the phone's .wp layer, whatever she chose in 美化),
    // never his picture: the screen itself goes see-through there (a-peek-bare); his apps keep the phone's own page colour
    // (and the phone's status bar takes the wallpaper's colours there, as on her own lock and home screens: data-on-wall)
    const phone = document.getElementById('phone');
    const bare = on => { el.classList.toggle('a-peek-bare', on); if (phone) phone.toggleAttribute('data-on-wall', on); };
    // what an app's own his.view gets: the read-only core, no her store, no session, no chat
    const hisCtx = () => Object.freeze({ T, core: ro, readOnly: true, owner: 'him', contact: ctx.contact || null, mine: null, toast: ctx.toast, back: () => { set('home'); draw(); } });
    const week = d => String(T('app.peek.week')).split(',')[d.getDay()] || '';
    const herLast = () => { const last = [...(ro.store.msgs || [])].reverse().find(m => m && m.is_user && m.mes); return { last, at: last && ro.msgDate(last) }; };
    function lock(){
      const d = ro.now(), w = week(d), { last, at } = herLast();
      return `<div class="pad-top"></div><div class="bar a-peek-onwall"><button class="back" data-go="home" aria-label="back">${back}</button>${chip()}</div>
        <div class="lk a-peek-lk" data-his-open role="button" tabindex="0">
          <div class="lk-date">${esc(T('app.peek.lock.date', { m: d.getMonth() + 1, d: d.getDate(), w }))}</div><div class="lk-time a-peek-live">${hm(d)}</div>
          ${statusLine(ro, T) ? `<div class="lk-date a-peek-status">${esc(statusLine(ro, T))}</div>` : ''}
          ${last ? `<div class="lk-note a-peek-note"><div class="av sm a-peek-me" aria-hidden="true">${esc([...she()][0] || '')}</div><div class="lk-body"><div class="lk-top"><b>${esc(she())}</b><small class="a-peek-live" data-at="${at ? +at : ''}">${esc(at ? when(T, +at, +d) : '')}</small></div><p>${esc(plain(last.mes))}</p></div></div>` : ''}
          <div class="lk-hint">${esc(T('lock.hint'))}</div><div class="lk-bar"></div>
        </div>`;
    }
    // his home screen, laid out like hers (s-home): page 1 is widgets that show his real things and four apps
    // beside his day, page 2 the rest of his apps, and a dock. Widgets: the clock with what he is doing now and where (the
    // one status); her, with her last message to him (opens his 微信 with her); his day so far (only slots that have begun,
    // day.visible: never one ahead); his 备忘录 (his notes, what he keeps about her). Nothing of hers (形象, 美化, 搬家 …).
    const tile = h => `<button class="app" data-his="${esc(h.id)}"><i>${icon(h.icon)}</i><span>${esc(T(h.title))}</span></button>`;
    function places(apps){
      const dock = DOCK.map(id => apps.find(a => a.id === id)).filter(Boolean), rest = apps.filter(a => !DOCK.includes(a.id));
      const front = FRONT.map(id => rest.find(a => a.id === id)).filter(Boolean);
      for (const a of rest) if (front.length < 4 && !front.includes(a)) front.push(a);
      return { dock, front, more: rest.filter(a => !front.includes(a)) };
    }
    async function home(){
      const d = ro.now(), s = ro.status ? ro.status() : null, lang = ro.lang ? ro.lang() : '', h24 = d.getHours();
      const asleep = !!(s && s.presence === 'asleep'), doing = s && !asleep && inChatLang(s.what, lang) ? s.what : '', at = s && !asleep && inChatLang(s.where, lang) ? s.where : '';
      const greet = asleep ? T('app.peek.status.asleep') : doing || T(h24 < 5 ? 'greet.night' : h24 < 11 ? 'greet.morning' : h24 < 13 ? 'greet.noon' : h24 < 18 ? 'greet.afternoon' : h24 < 23 ? 'greet.evening' : 'greet.night');
      const right = at || (s && (s.busy || s.presence === 'busy') ? T('app.peek.status.busy') : '');
      const { last, at: lastAt } = herLast(), p = await latest().catch(() => null);
      // his day so far, newest first (two lines), else what he is doing now
      let day = await todayNotes(ro).catch(() => []); if (!day.length) day = nowNote(ro);
      day = day.slice(-2).reverse();
      // his 备忘录: his own notes still ahead (the filler, when there is one), then what he keeps about her
      const notes = (p && p.phone ? notesNow(p.phone.notes, p.date, d, hisLinesSince(ro.store.msgs, Number(p.at) || 0)).filter(n => !n.done).map(n => n.text) : [])
        .concat((ro.store.memory || []).filter(m => m && m.kind !== 'absence').map(aboutHer).filter(t => t && inChatLang(t, lang)).slice(-3).reverse())
        .filter(t => inChatLang(t, lang)).slice(0, 3);
      const { dock, front, more } = places(hisApps());
      const big = `<div class="w big a-peek-big"><div><div class="greet">${esc(greet)}</div><div class="clock a-peek-clock a-peek-live">${hm(d)}</div><div class="sub">${esc(T('app.peek.lock.date', { m: d.getMonth() + 1, d: d.getDate(), w: week(d) }))}</div></div>` +
        `<div class="wx">${icon(asleep || h24 < 6 || h24 >= 18 ? 'i-moon' : 'i-sun')}<span>${esc(right)}</span></div></div>`;
      const her = `<button class="w him glass wide a-peek-herw" data-his-chat="her"><div class="av a-peek-me" aria-hidden="true">${esc([...she()][0] || '')}</div><div class="hbody"><div class="htop"><b>${esc(she())}</b><small class="t a-peek-live" data-at="${lastAt ? +lastAt : ''}">${esc(lastAt ? when(T, +lastAt, +d) : '')}</small></div><small>${esc(last ? plain(last.mes) : T('app.peek.w.her.none'))}</small></div></button>`;
      const cal = `<div class="w cal glass a-peek-day" data-his-to="notes" role="button" tabindex="0"><div class="wd">${esc(T('app.peek.w.today', { w: week(d) }))}</div><div class="dd">${d.getDate()}</div>` +
        (day.length ? day.map(n => `<div class="ev"><span><small>${esc(n.t)}</small><b>${esc(n.text)}</b></span></div>`).join('') : `<span class="empty">${esc(T('app.peek.w.day.none'))}</span>`) +
        (day.length > 1 ? '' : `<div class="wk">${[0, 1, 2, 3, 4, 5, 6].map(i => { const x = new Date(d); x.setDate(d.getDate() - d.getDay() + i); return `<i class="${i === d.getDay() ? 'on' : ''}">${x.getDate()}</i>`; }).join('')}</div>`) + '</div>';
      const memo = `<div class="w todo glass wide a-peek-memo" data-his-to="notes" role="button" tabindex="0"><div class="wt">${esc(T('app.peek.notes'))}</div>` +
        (notes.length ? notes.map(t => `<div class="ti"><i class="a-peek-dot"></i><span>${esc(t)}</span></div>`).join('') : `<span class="empty">${esc(T('app.peek.w.notes.none'))}</span>`) + '</div>';
      return `<div class="pad-top"></div><div class="bar a-peek-onwall"><button class="back" data-go="home" aria-label="back">${back}</button><div class="title">${esc(T('app.peek.phone', { name: ro.store.name || '' }))}</div>${chip()}</div>
        <div class="wall a-peek-home"><div class="pages a-peek-pages">
          <div class="page">${big}${her}<div class="wrow wmix">${cal}<div class="grid g2">${front.map(tile).join('')}</div></div>${memo}</div>
          ${more.length ? `<div class="page p2"><div class="grid">${more.map(tile).join('')}</div></div>` : ''}
        </div>
        ${more.length ? `<div class="dots a-peek-dots"><button class="on" data-his-page="0" aria-label="1"></button><button data-his-page="1" aria-label="2"></button></div>` : ''}
        <div class="dock">${dock.map(h => `<button class="app" data-his="${esc(h.id)}" aria-label="${esc(T(h.title))}"><i>${icon(h.icon)}</i></button>`).join('')}</div></div>`;
    }
    // his home screen's two pages: the dots follow a swipe, a tap on a dot turns the page
    function pages(){
      const pg = el.querySelector('.a-peek-pages'), dots = el.querySelector('.a-peek-dots'); if (!pg || !dots) return;
      pg.addEventListener('scroll', () => { swiped = Date.now(); const i = Math.round(pg.scrollLeft / (pg.clientWidth || 1)); dots.querySelectorAll('button').forEach((b, j) => b.classList.toggle('on', i === j)); }, { passive: true });
    }
    // what one of his apps shows (not a his.view app): → html ('' when it has nothing)
    async function content(h, chat, n){
      if (chat) { const c = await chatView(chat[1], ro, T); if (n === seq && el.querySelector('.bar .title')) el.querySelector('.bar .title').textContent = c.title; return c.html; }
      // 备忘录 and 搜索: the filler is made once, the first time one of them opens with none (one model call)
      let busy = running(), p = busy ? null : await latest();
      if (!p && !busy && !tried && (h.id === 'notes' || h.id === 'searches')) { tried = true; start(ctx); busy = true; }
      return VIEW[h.id](ro, T, { p, busy });
    }
    // his lock and home screens stay true while open (a slot that begins, his status, her new message): on each
    // beat of the one clock and when a record changes, they are made again and put in place only if they changed,
    // keeping the page she swiped to and how far down it she is. The clock and the time of her message are set in
    // place on each beat (a-peek-live), so they are left out of the comparison: the rebuild swaps only on a real
    // change, and never while she is swiping between the pages
    let shown = '', again = 0, swiped = 0;
    const still = html => String(html).replace(/(<[^>]*\ba-peek-live\b[^>]*>)[^<]*/g, '$1');
    async function restate(){
      if (view !== 'lock' && view !== 'home') return;
      const n = seq, v = view, html = v === 'home' ? await home() : lock();
      if (n !== seq || v !== view || !alive || still(html) === still(shown)) return;
      if (Date.now() - swiped < 600) { soon(); return; }
      const pg = el.querySelector('.a-peek-pages'), left = pg ? pg.scrollLeft : 0, tops = [...el.querySelectorAll('.a-peek-pages > .page')].map(x => x.scrollTop);
      el.innerHTML = shown = html;
      if (v === 'home'){
        pages();
        const pg2 = el.querySelector('.a-peek-pages'); if (pg2) pg2.scrollLeft = left;
        el.querySelectorAll('.a-peek-pages > .page').forEach((x, i) => { x.scrollTop = tops[i] || 0; });
        const dots = el.querySelector('.a-peek-dots'), i = pg2 ? Math.round(pg2.scrollLeft / (pg2.clientWidth || 1)) : 0;
        if (dots) dots.querySelectorAll('button').forEach((b, j) => b.classList.toggle('on', i === j));
      }
    }
    const soon = () => { clearTimeout(again); again = setTimeout(() => restate().catch(e => console.error(e)), 150); };
    async function draw(){
      const n = ++seq;
      if (unview) { try { unview(); } catch(e){ console.error(e); } unview = null; }
      bare(view === 'lock' || view === 'home');
      if (view === 'lock') { el.innerHTML = shown = lock(); return; }
      if (view === 'home') { const html = await home(); if (n === seq && alive) { el.innerHTML = html; shown = html; pages(); } return; }
      const chat = /^chat:(.+)$/.exec(view);
      const h = chat ? HIS[0] : hisApps().find(x => x.id === view);
      if (!h) { set('home'); return draw(); }
      el.innerHTML = `<div class="pad-top"></div><div class="bar"><button class="back" data-his-back="${chat ? 'wechat' : 'home'}" aria-label="back">${back}</button><div class="title">${esc(chat ? '' : T(h.title))}</div></div>` +
        `<div class="${chat ? 'chat a-peek-chat' : 'list a-peek-body'}" data-his-app="${esc(h.id)}"></div>`;
      const body = el.querySelector('[data-his-app]'), a = h.app && window.ModuApps.get(h.app);
      // an app that draws its own read-only screen for his phone (his.view)
      if (!chat && a && a.his && typeof a.his.view === 'function'){
        try { const u = a.his.view(body, hisCtx()); if (typeof u === 'function') unview = u; } catch(e){ console.error(`app ${a.id}:`, e); body.innerHTML = empty(T, h.id); }
        return;
      }
      let html = '';
      try { html = await content(h, chat, n); } catch(e){ console.error(e); }
      if (n !== seq || !alive) return;
      body.innerHTML = html || empty(T, h.id); body.dataset.drawn = body.innerHTML;
      if (chat) body.scrollTop = 1e9;
    }
    // a record changed while she reads one of his apps (his day, his status, a job: they change all the time):
    // the app's list is read again and put in place only if it changed, keeping what she opened (a letter), what she ticked
    // (联系人) and where she scrolled to, so an open letter does not close by itself.
    async function refresh(){
      const body = el.querySelector('[data-his-app]');
      if (!body || body.dataset.hisApp !== view || unview || el.querySelector('.a-peek-wait')) return draw();
      const h = hisApps().find(x => x.id === view); if (!h) return draw();
      const n = seq; let html = '';
      try { html = await content(h, null, n); } catch(e){ console.error(e); return; }
      if (n !== seq || !alive) return;
      html = html || empty(T, h.id);
      const keep = document.createElement('div'); keep.innerHTML = html;
      if (keep.innerHTML === body.dataset.drawn) return;
      const open = new Set([...body.querySelectorAll('details[open][data-key]')].map(x => x.dataset.key));
      const off = new Set([...body.querySelectorAll('[data-pc-pick]')].filter(x => !x.checked).map(x => x.dataset.pcPick)), top = body.scrollTop;
      body.innerHTML = html; body.dataset.drawn = body.innerHTML;
      for (const x of body.querySelectorAll('details[data-key]')) if (open.has(x.dataset.key)) x.open = true;
      for (const x of body.querySelectorAll('[data-pc-pick]')) if (off.has(x.dataset.pcPick)) x.checked = false;
      body.scrollTop = top;
    }
    function open(v, title){ set(v); peeked(v.startsWith('chat:') ? 'wechat' : v, title); draw().catch(e => console.error(e)); }
    el.onclick = e => {
      if (e.target.closest('[data-his-open]')) { set('home'); draw(); return; }
      const h = e.target.closest('[data-his], [data-his-to]'); if (h) { const id = h.dataset.his || h.dataset.hisTo, x = hisApps().find(a => a.id === id); if (x) open(id, T(x.title)); return; }
      const c = e.target.closest('[data-his-chat]'); if (c) { open('chat:' + c.dataset.hisChat, T('app.peek.wechat')); return; }
      const b = e.target.closest('[data-his-back]'); if (b) { set(b.dataset.hisBack); draw(); return; }
      const pgb = e.target.closest('[data-his-page]'), pg = el.querySelector('.a-peek-pages');
      if (pgb && pg) { pg.scrollTo({ left: Number(pgb.dataset.hisPage) * pg.clientWidth, behavior: 'smooth' }); return; }
      if (e.target.closest('#pGo')) { start(ctx); draw(); }
      // 联系人: yes (write them, or another set), keep the ones she ticked
      const pcb = e.target.closest('[data-pc]');
      if (pcb && pcb.dataset.pc === 'yes' && !pc.working){
        pc.working = true; pc.failed = ''; draw();
        const mine = pc;   // a switch of companion while it writes starts him afresh; this answer is not his
        makeContacts(M()).then(list => { mine.pending = list; }, e => {
          mine.failed = failWhy(e, T) || T('peek.contacts.why.unreadable'); if (e && e.code !== 'paused' && e.code !== 'timeout') console.error('contacts:', e);
          // given up on, but the call still runs: when it does answer, its people are there to pick (no second call)
          const still = inflight.get(mine.who);
          if (e && e.code === 'timeout' && still) still.then(list => { if (!mine.working && !mine.pending){ mine.pending = list; mine.failed = ''; if (alive && view === 'contacts') draw(); } }, () => {});
        }).finally(() => { mine.working = false; if (alive && view === 'contacts') draw(); });
      }
      if (pcb && pcb.dataset.pc === 'keep' && pc.pending){
        const keep = pc.pending.filter((p, i) => { const c = el.querySelector(`[data-pc-pick="${i}"]`); return !c || c.checked; });
        pc.pending = null; keepContacts(M(), keep).catch(e => console.error(e)).finally(() => { if (alive) draw(); });
      }
    };
    // the widgets that are not buttons (his day, his 备忘录) open with Enter or Space too
    el.onkeydown = e => { const w = (e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('[data-his-to], [data-his-open]'); if (w) { e.preventDefault(); w.click(); } };
    peeked('lock');
    draw().catch(e => console.error(e));
    // another person: his lock screen; a record changed (the filler arrived): the app she is in, read again in place
    const off = M().on((ev, data) => {
      if (!alive) return;
      if (ev === 'loaded') { set('lock'); draw(); }
      else if (ev === 'records' && !(data && (data.type === 'log' || data.owner === 'her')) && (view === 'lock' || view === 'home')) soon();
      else if (ev === 'records' && !(data && (data.type === 'log' || data.owner === 'her')) && !view.startsWith('chat:')) refresh().catch(e => console.error(e));
    });
    // the time on his lock and home screens moves with the one clock; on each beat they are also made again (restate)
    const offClock = M().clock && typeof M().clock.on === 'function' ? M().clock.on(() => { if (alive) { for (const x of el.querySelectorAll('.a-peek-clock, .a-peek-lk .lk-time')) x.textContent = hm(ro.now()); for (const x of el.querySelectorAll('.a-peek-live[data-at]')) if (x.dataset.at) x.textContent = when(T, Number(x.dataset.at), +ro.now()); soon(); } }) : null;
    const watch = setInterval(() => { if (alive && !running() && el.querySelector('.a-peek-wait:not(.a-peek-pcwait)')) draw(); }, 250);
    return () => { alive = false; seq++; off(); if (typeof offClock === 'function') offClock(); clearTimeout(again); bare(false); clearInterval(watch); el.onclick = null; el.onkeydown = null; if (unview) { try { unview(); } catch {} unview = null; } };
  },
  api: { generate, start, running, latest, readPhone, guard, mentionsHer, people, familyIn, roCore, hisApps: () => hisApps().map(h => h.id),
    statusLine, todayNotes, nowNote, saidDone, hisLinesSince, contactsNow, makeContacts, keepContacts, readPeople, noteDay, notesNow, aboutHer },
});
})();
