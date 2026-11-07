// app/core/reply.js: his reply: the reply format and its tags, bubbles and action lines, punctuation.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';

const EMOTIONS = ['joy', 'sadness', 'anger', 'surprise', 'relief', 'neutral'];
function splitBubbles(text){
  const lines = String(text || '').split(/\r?\n+/).map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const l of lines){
    if (l.length <= 40) { out.push(l); continue; }
    // a long line: cut after Chinese sentence ends, never inside *actions*
    const parts = l.split(/(\*[^*]+\*)/), pieces = [''];
    for (const part of parts){
      if (/^\*[^*]+\*$/.test(part)) { pieces[pieces.length - 1] += part; continue; }
      const sent = part.split(/(?<=[。！？!?…~～]+[”"」]?)/);
      sent.forEach((x, i) => { if (i && pieces[pieces.length - 1].trim().length > 12) pieces.push(''); pieces[pieces.length - 1] += x; });
    }
    out.push(...pieces.map(x => x.trim()).filter(Boolean));
  }
  // at most six bubbles: the rest joins the last one
  return out.length > 6 ? out.slice(0, 5).concat(out.slice(5).join(' ')) : out;
}
// A chat message drops its final 。 (only a trailing 。; ？！… and everything inside stay). Not for
// letters, diaries or posts: those are written text and keep theirs.
function dropFinalStop(line){ const s = String(line == null ? '' : line), t = s.replace(/。+\s*$/, ''); return t.trim() ? t : s; }
// The same over a whole reply, line by line, leaving action lines (*…*) alone. His chat file keeps what the
// model wrote; the chat shows it without (splitParts), and his past replies reach the prompt without, so the
// history does not teach the 。 back.
function chatStops(text){ return String(text == null ? '' : text).split('\n').map(l => /\*\s*$/.test(l) ? l : dropFinalStop(l)).join('\n'); }
// Some models head his lines with his name, as in a script ("Alex(小明)" on a line of its own, or "小明：…"), most of all when
// the card's name is long, and each one came out as a bubble of its own. → the text with those heads gone: a line that is
// only his name (the card's whole name, or either half of "Alex(小明)"), when more follows, and a name with a colon in
// front of a line. What he says about himself stays. For the screen and his prompt: his chat file keeps what the model wrote.
const squeeze = s => String(s).replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')').toLowerCase();
function nameForms(name){
  const n = String(name || '').trim(), m = n.match(/^(.*?)\s*[(（]\s*(.*?)\s*[)）]\s*$/);
  return [n].concat(m ? [m[1], m[2]] : []).map(squeeze).filter((x, i) => x.length >= 2 || (i === 0 && x));
}
function dropNames(text, name){
  const forms = nameForms(name), t = String(text == null ? '' : text);
  if (!forms.length) return t;
  const lines = t.split('\n'), bare = l => squeeze(l).replace(/^[*【\[「]+|[*】\]」:：]+$/g, '');
  const headed = l => { const s = l.replace(/^[\s*]+/, ''), c = s.search(/[:：]/); return c > 0 && forms.includes(bare(s.slice(0, c))) ? s.slice(c + 1).replace(/^[\s*]+/, '') : null; };
  return lines.map((l, i) => {
    if (forms.includes(bare(l)) && lines.slice(i + 1).some(x => x.trim())) return null;
    const rest = headed(l); return rest ? rest : l;
  }).filter(l => l !== null).join('\n');
}
// His reply as the chat shows it: [{ kind: 'say' | 'act', text }]. 'say' is a bubble (its final 。
// dropped); 'act' is what he does (between asterisks, or （…）/(…) as a whole line; or a first line
// that narrates him in the third person, "他刚收了碗。", when more lines follow), shown as a quiet line
// with no bubble. opts: { name, pronoun ('他'/'她'/'TA'), actions: false → the 'act' parts are left out }.
// Known limit: a first line about someone else that starts with his pronoun and has no 我/你 in it
// ("他又迟到了。" about a colleague, followed by more lines) is read as narration.
function splitParts(text, opts = {}){
  const out = [], name = String(opts.name || ''), pro = String(opts.pronoun || '');
  const bubbles = splitBubbles(dropNames(text, name));
  bubbles.forEach((b, bi) => {
    if (/^[（(][^（）()]+[)）]$/.test(b)) { out.push({ kind:'act', text: b.slice(1, -1).trim() }); return; }
    for (const part of b.split(/(\*[^*]+\*)/)){
      const p = part.trim(); if (!p) continue;
      if (/^\*[^*]+\*$/.test(p)) { const a = p.slice(1, -1).trim(); if (a) out.push({ kind:'act', text: a }); continue; }
      const third = bi === 0 && bubbles.length > 1 && p === b.trim() && !/[我你咱？?！!吗呢吧啊嘛]/.test(p) &&
        ((name && p.startsWith(name)) || (pro && pro !== 'TA' && p.startsWith(pro)));
      out.push(third ? { kind:'act', text: p } : { kind:'say', text: dropFinalStop(p) });
    }
  });
  return opts.actions === false ? out.filter(x => x.kind !== 'act') : out;
}
// A photo he "sends" is a tag in his text ([照片：…], 【图片: …】, 〔照片〕, [photo: …]). A preview (the
// lock screen, the chat list) shows it as `label`; 相册 keeps what each one shows (his words for it). → { text, photos }
const PHOTO = /[\[【〔]\s*(?:照片|图片|相片|photo|picture|image)\s*(?:[:：]\s*([^\]】〕\n]*?))?\s*[\]】〕]/gi;
function photoTags(text, label = '[照片]'){
  const photos = [];
  const t = String(text == null ? '' : text).replace(PHOTO, (m, cap) => { photos.push(String(cap || '').trim()); return label; });
  return { text: t, photos };
}
// Models often write ASCII punctuation inside Chinese ("记得呀,你说…?"); a Chinese chat app shows full-width.
const FW = { ',':'，', '?':'？', '!':'！', ':':'：', ';':'；' };
function tidyCJK(t){ return t.replace(/([一-鿿“”])([,?!:;])(?=\s*[一-鿿“”"*]|\s*$)|([,?!:;])(?=[一-鿿])/g, (m, a, p, q) => a ? a + FW[p] : FW[q]); }
// --- Reply format: what he says, plus optional trailing tags -----------------------------------------
// The reply is plain text (one line per bubble), then, at the very end and in any order, optional tags:
//   [emotion: joy]        his mood, one of EMOTIONS (also 情绪 / mood; a Chinese word such as 开心 maps)
//   [心声: 其实有点想她]     inner voice, shown only if she taps (also inner / os / 内心)
//   [no-reply]            he read it and chose not to answer (also 不回 / 已读不回 / skip / silent)
//   [next: 30]            minutes until he would like to write again (also 下次联系 / next-contact)
//   [promise: 明早叫你起床]  something he said he will do later; a job may be booked for it
//   [state: trust+1 她记得]  a change he proposes to a key his card declares; state.nudge decides
// A promise or state tag is taken wherever it stands (it is never meant to be seen), and one that cannot be
// read (no key, no number, an empty promise) is dropped quietly: never shown, never an error.
// Brackets [] 【】 () （） and : or ： are all taken, any case. Nothing is required: a tag that is
// missing, unknown or malformed is left alone or dropped, and the reply degrades to plain text with mood
// neutral. Never an error. Also taken: a <think>…</think> block (dropped), a whole reply written as JSON
// ({"reply"|"text"|"content"|"message", "emotion", "inner", …}), code fences around it, and a tag cut
// off at the end by the token limit (dropped).
const MOOD_WORDS = { '开心':'joy', '高兴':'joy', '快乐':'joy', '喜悦':'joy', '难过':'sadness', '伤心':'sadness', '悲伤':'sadness', '低落':'sadness',
  '生气':'anger', '愤怒':'anger', '恼火':'anger', '惊讶':'surprise', '吃惊':'surprise', '意外':'surprise', '安心':'relief', '释然':'relief', '放松':'relief',
  '平静':'neutral', '中性':'neutral', '一般':'neutral', 'happy':'joy', 'sad':'sadness', 'angry':'anger', 'surprised':'surprise', 'relieved':'relief', 'calm':'neutral' };
function moodOf(v){ const k = String(v || '').trim().toLowerCase(); if (EMOTIONS.includes(k)) return k; return MOOD_WORDS[k] || MOOD_WORDS[String(v || '').trim()] || ''; }
const TAG_KEYS = [
  ['emotion', /^(?:emotion|情绪|mood|心情)$/i],
  ['inner', /^(?:inner(?:[ _-]?voice)?|心声|内心|os|inner thoughts?)$/i],
  ['noReply', /^(?:no[ _-]?reply|不回|已读不回|skip|silent|silence)$/i],
  ['next', /^(?:next(?:[ _-]?contact)?|下次联系|下次)$/i],
  ['promise', /^(?:promise|承诺|约定|答应)$/i],
  ['state', /^(?:state|状态)$/i],
];
// [state: key+n reason] → { key, delta, why } or null (malformed: dropped). The key is any text a
// card author wrote (信任, trust level), up to the first sign a number follows; state.nudge matches it to the card's own key
function stateTag(v){
  const m = String(v || '').trim().match(/^([^\n]{1,64}?)\s*([+\-−＋－])\s*(\d+(?:\.\d+)?)\s*[,，:：]?\s*([\s\S]*)$/);
  if (!m || !m[1].trim()) return null;
  const n = parseFloat(m[3]); if (!isFinite(n) || !n) return null;
  return { key: m[1].trim(), raw: String(v).trim(), delta: /[\-−－]/.test(m[2]) ? -n : n, why: m[4].trim().slice(0, 120) };
}
function addTag(out, key, v){
  if (key === 'promise'){ const p = String(v || '').trim(); if (p) out.promises.push(p.slice(0, 200)); }
  else if (key === 'state'){ const st = stateTag(v); if (st) out.state.push(st); }
}
// promise and state tags anywhere in the text (also one cut off at the very end); the text closes up around them
const PROMISE_OR_STATE = /[\[【]\s*(promise|承诺|约定|答应|state|状态)\s*[:：]\s*([^\[\]【】\n]*)[\]】]/gi;
const PROMISE_OR_STATE_CUT = /[\[【]\s*(?:promise|承诺|约定|答应|state|状态)\s*[:：][^\[\]【】\n]*$/i;
function takeTags(t, out){
  return t.replace(PROMISE_OR_STATE, (all, k, v) => { addTag(out, tagKey(k), v); return ''; }).replace(PROMISE_OR_STATE_CUT, '')
    .replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
}
const TAG_AT_END = /[\[【(（]\s*([^\[\]【】()（）:：\n]{1,24}?)\s*(?:[:：]\s*([^\[\]【】\n]*?))?\s*[\]】)）]\s*$/;
const TAG_CUT = /\n?\s*[\[【(（]\s*(?:emotion|情绪|mood|心情|inner|心声|内心|os|no[ _-]?reply|不回|next|下次)[^\]】)）\n]*$/i;
function tagKey(k){ for (const [name, re] of TAG_KEYS) if (re.test(k.trim())) return name; return ''; }
function minutesOf(v){
  const t = String(v || '').trim(), n = parseFloat(t.replace(/[^\d.]/g, ''));
  if (!isFinite(n) || n < 0) return null;
  return Math.round(/小时|hour|h\b/i.test(t) ? n * 60 : /天|day|d\b/i.test(t) ? n * 1440 : n);
}
function parseReply(raw){
  const out = { text:'', emotion:'neutral', labelled:false, inner:'', noReply:false, nextContact:null, promises:[], state:[] };
  let t = String(raw == null ? '' : raw).replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^\s*<think>[\s\S]*$/i, '').trim();
  // a whole reply as JSON (some models do this when asked for any structure), fences or not
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i); if (fenced) t = fenced[1].trim();
  if (/^\{[\s\S]*\}$/.test(t)){
    try {
      const j = JSON.parse(t), body = [j.reply, j.text, j.content, j.message, j.say].find(x => typeof x === 'string' || Array.isArray(x));
      if (j && typeof j === 'object' && body !== undefined){
        out.text = Array.isArray(body) ? body.join('\n') : body;
        const mood = moodOf(j.emotion || j.mood || j['情绪']); if (mood){ out.emotion = mood; out.labelled = true; }
        const inner = j.inner || j.inner_voice || j['心声'] || j.os; if (typeof inner === 'string') out.inner = inner.trim();
        out.noReply = j.no_reply === true || j.noReply === true;
        const nx = minutesOf(j.next_contact != null ? j.next_contact : j.next); if (nx != null && (j.next_contact != null || j.next != null)) out.nextContact = nx;
        [].concat(j.promise || j.promises || []).forEach(x => addTag(out, 'promise', x));
        [].concat(j.state || []).forEach(x => addTag(out, 'state', typeof x === 'string' ? x : x && x.key != null ? `${x.key}${Number(x.delta) < 0 ? '-' : '+'}${Math.abs(Number(x.delta))} ${x.why || ''}` : ''));
        out.text = takeTags(out.text, out).trim(); if (out.noReply && out.text) out.noReply = false;
        return out;
      }
    } catch {}
  }
  t = takeTags(t, out).trim();
  t = t.replace(TAG_CUT, (m) => /[\]】)）]/.test(m) ? m : '').trim();
  // peel tags off the end, one at a time; the first one that is not ours stops the peeling
  for (let guard = 0; guard < 8; guard++){
    let m = t.match(TAG_AT_END), key = m && tagKey(m[1]), val = m ? (m[2] || '') : '';
    if (!m || !key){
      // a bare last line "emotion: joy" (no brackets)
      const b = t.match(/(?:^|\n)\s*(emotion|情绪|mood|心声|inner|next)\s*[:：]\s*([^\n]*)\s*$/i);
      if (!b) break; m = b; key = tagKey(b[1]); val = b[2];
      if (key === 'emotion' && !moodOf(val)) break;
    }
    t = t.slice(0, m.index).trim();
    if (key === 'emotion'){ if (!out.labelled){ const mood = moodOf(val); if (mood){ out.emotion = mood; out.labelled = true; } } }
    else if (key === 'inner'){ if (!out.inner) out.inner = val.trim(); }
    else if (key === 'noReply') out.noReply = true;
    else if (key === 'next'){ const n = minutesOf(val); if (n != null && out.nextContact == null) out.nextContact = n; }
    else addTag(out, key, val);
  }
  out.text = t;
  if (out.noReply && out.text) out.noReply = false;   // he said something after all: the words win
  return out;
}
// Split the model's text into what he says and the label he gave. A missing or unknown label → neutral.
// It reads through parseReply, so the other optional tags are cut from the text too.
function splitEmotion(text){ const r = parseReply(text); return { text: r.text, emotion: r.emotion, labelled: r.labelled }; }

Object.assign(core, { EMOTIONS, splitBubbles, dropFinalStop, chatStops, dropNames, splitParts, tidyCJK, parseReply,
  splitEmotion, photoTags });
})(globalThis[Symbol.for('modu.core')]);
