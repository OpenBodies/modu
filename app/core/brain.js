// app/core/brain.js: the brain link: an OpenAI-style call to the model she chose, the connection and card checks.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { store, hostFetch, assemble } = core;

// --- Brain link ----------------------------------------------------------------------------
// The model services she can pick by name. Each is OpenAI-style (POST {endpoint}/chat/completions,
// GET {endpoint}/models) and its address is filled in for her; 自己填 ('own') is any other. Their names and the line on
// where to get a key are the page's words (words.txt model.svc.<id>, model.how.<id>).
const SERVICES = [
  { id:'openrouter', endpoint:'https://openrouter.ai/api/v1' },
  { id:'deepseek', endpoint:'https://api.deepseek.com/v1' },
  { id:'siliconflow', endpoint:'https://api.siliconflow.cn/v1' },
];
// The address as she may type or paste it, made the one the service answers on: a scheme added when it has
// none, a trailing / and a pasted …/chat/completions or …/models taken off, /v1 added to a bare host (as EPhone does),
// and OpenRouter's own site (openrouter.ai, …/v1, …/api, any case) made its API address. Any other path is kept as typed
// (智谱's /api/paas/v4, a proxy's /openai/v1). The page tidies an address only when she types or picks it,
// and saves the tidied form; callModel / listModels use a saved address as it is (a relay that answers at its root stays so).
function normEndpoint(u){
  let s = String(u || '').trim();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = (/^(localhost|127\.|\[::1\])/i.test(s) ? 'http://' : 'https://') + s;
  s = s.replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\/(chat\/completions|completions|models)$/i, '').replace(/\/+$/, '');
  let url; try { url = new URL(s); } catch { return s; }
  const path = url.pathname.replace(/\/+$/, '');
  if (/^(www\.)?openrouter\.ai$/i.test(url.host) && /^(|\/v1|\/api|\/api\/v1)$/i.test(path)) return 'https://openrouter.ai/api/v1';
  return url.origin + (path || '/v1');   // the host as the URL reads it (lower case), the path as typed
}
// which of SERVICES an address is ('own' for any other; '' for none)
function serviceOf(endpoint){
  const e = normEndpoint(endpoint); if (!e) return '';
  const s = SERVICES.find(x => x.endpoint === e);
  return s ? s.id : 'own';
}
// A service's "no" in plain words. An Error with .code (one of model / long / key / denied / credit / policy /
// address / nolist / busy / server / net / thought / filtered / empty / noaddress / other: the page's words are words.txt
// model.err.<code>), .status (the HTTP number, or 0) and .detail (what the service said, whole, for 复制原文; never her key).
// Its message stays a plain Chinese sentence, for a host with no words file and for the developer's line under a chat.
const ERR_TEXT = { model:'模型名可能不对', long:'要发的内容太长，这个模型装不下', key:'API key 不对', denied:'模型服务拒绝了这个请求',
  credit:'模型服务那边没有余额了，或者 key 的额度用完了', policy:'OpenRouter 的隐私设置不让用这个模型', address:'地址不对', nolist:'这个服务没有给出模型列表', busy:'太频繁了，模型服务在限流', server:'模型服务那边出了问题',
  net:'连不上模型服务', thought:'模型只想了没说话', filtered:'模型服务把这次回复拦下了', empty:'模型服务的回复里没有文字',
  noaddress:'还没有设置模型', other:'模型服务回了一个错误' };
function modelError(code, status, detail){
  const e = new Error(ERR_TEXT[code] || ERR_TEXT.other); e.code = ERR_TEXT[code] ? code : 'other'; e.status = status || 0; e.detail = String(detail || '').slice(0, 4000);
  return e;
}
// which code an HTTP "no" is: by its number, and by what it says (OpenRouter answers 400 for a model name it does not know,
// 404 when no provider serves that model: both are about the name, not the address; 404 "No endpoints found matching your
// data policy" is her OpenRouter privacy setting, common with free models; 403 "Key limit exceeded" is the key's own cap).
// list: the /models call.
function codeOf(status, body, list){
  // a "Provider returned error" is the provider's fault upstream, never her key; a rate limit is busy, even as a 403
  const b = String(body || ''), long = /context|too long|too many tokens|maximum.{0,20}tokens/i.test(b);
  const key = !/provider returned error/i.test(b) && /api.?key|invalid.{0,20}key|unauthori/i.test(b);
  const rate = /rate.?limit/i.test(b), credit = !rate && /credit|balance|insufficient|余额|key limit/i.test(b);
  if (status === 401) return 'key';
  if (status === 402) return 'credit';
  if (status === 403) return rate ? 'busy' : credit ? 'credit' : 'denied';
  if (status === 429) return 'busy';
  if (status === 413) return 'long';
  if (status === 400 || status === 422) return long ? 'long' : key ? 'key' : credit ? 'credit' : status === 400 || /model/i.test(b) ? 'model' : 'other';
  if (status === 404 && /data policy|privacy/i.test(b)) return 'policy';
  if (status === 404 || status === 405) return list ? 'nolist' : /model|endpoints? found/i.test(b) && !/<html/i.test(b) ? 'model' : 'address';
  if (status >= 500) return 'server';
  return 'other';
}
function headersFor(settings, json){
  const key = String((settings.provider === 'local' ? settings.token : settings.key) || '').trim();
  const h = json ? { 'Content-Type':'application/json' } : {}; if (key) h['Authorization'] = 'Bearer ' + key;
  return h;
}
// a reply's text, or why there is none. A model that thinks first (DeepSeek V4, Gemini 3 on OpenRouter) can
// spend its whole max_tokens thinking: content null or '', its thinking in reasoning / reasoning_content, finish_reason
// 'length'. Only that is 'thought' (finish_reason 'length', or no content at all beside its thinking); an
// empty text that stopped by itself is an answer, '', thinking or not (the memory job's 没有, a turn's no-reply).
function replyText(j){
  const c = j && Array.isArray(j.choices) && j.choices[0], m = c && c.message, why = c && c.finish_reason;
  const text = m && (typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map(p => (p && typeof p.text === 'string') ? p.text : '').join('') : null);
  const thought = !!(m && (String(m.reasoning || m.reasoning_content || '').trim() || (Array.isArray(m.reasoning_details) && m.reasoning_details.length)));
  if (typeof text === 'string' && (text.trim() || (why !== 'length' && why !== 'content_filter'))) return { text: text.trim() };
  return { why: why === 'content_filter' ? 'filtered' : thought || why === 'length' ? 'thought' : 'empty', cut: why === 'length' };
}
// What a service said, with her key and token masked (a relay can echo the request), for 复制原文
function scrub(detail, settings){
  let d = String(detail || '');
  for (const k of [settings && settings.key, settings && settings.token]) { const v = String(k || '').trim(); if (v.length >= 4) d = d.split(v).join('***'); }
  return d;
}
// settings: { endpoint, model, key }. The key goes only to the endpoint the user typed. With provider
// 'local' (本机) it is the model server's per-run token instead (settings.token), sent the same way.
// A reply cut off while the model was still thinking (no text, finish_reason 'length') is asked once more with
// three times the room (at most 2400); that second call is counted in 用量 as 'retry' (calls.note). Only a call
// with room for a real answer (max_tokens >= 400: her chat turn, the two 设置 checks, the side calls' default), and not
// while 暂停 is on unless it is her own (extra.own: a chat turn, 测试连接). If the second ask fails too (a
// service may refuse the bigger max_tokens), the first answer's 'thought' is what she is told, both answers in .detail.
// No 'reasoning' field is sent to any service: OpenRouter's turns thinking ON for a model that has it off by default (and its budget can be
// more than the room we give), and another service may refuse a field it does not know. So 测试连接 sends what a chat sends.
async function callModel(settings, messages, extra={}){
  const endpoint = String(settings.endpoint || '').trim().replace(/\/+$/, ''), model = String(settings.model || '').trim();   // as saved
  if (!endpoint) throw modelError('noaddress');
  const ask = async max => {
    let r;
    try { r = await hostFetch(endpoint + '/chat/completions', { method:'POST', headers: headersFor(settings, true), body: JSON.stringify(Object.assign({ model, messages, stream:false, max_tokens: max }, extra.user ? { user: String(extra.user) } : {})) }); }
    catch(e){ throw modelError('net', 0, scrub((e && e.message) || e, settings)); }
    const body = scrub(await r.text().catch(() => ''), settings);
    if (!r.ok) throw modelError(codeOf(r.status, body), r.status, `HTTP ${r.status} ${body}`);
    let j; try { j = JSON.parse(body); } catch { throw modelError('address', r.status, `HTTP ${r.status} ${body}`); }   // a web page, not a model service
    if (j && j.error && !(j.choices && j.choices.length)) { const st = Number(j.error.code) || 0; throw modelError(st ? codeOf(st, body) : 'other', st, `HTTP ${r.status} ${body}`); }
    return Object.assign(replyText(j), { body });
  };
  const max = Number(extra.max_tokens) || 600;
  let got = await ask(max);
  const held = !extra.own && typeof core.paused === 'function' && core.paused();
  if (got.text == null && got.why === 'thought' && got.cut && max >= 400 && max < 2400 && !held){
    if (core.calls && core.calls.note) core.calls.note('retry', messages, { settings })('');
    const first = got, again = '\n--- asked again with more room ---\n';
    try { got = await ask(Math.min(2400, max * 3)); }
    catch(e){ throw modelError('thought', 200, first.body + again + (e.detail || e.message)); }
    if (got.text == null) throw modelError(got.why, 200, first.body + again + got.body);
  }
  if (got.text == null) throw modelError(got.why, 200, got.body);
  return got.text;
}
// The service's own model list, GET {endpoint}/models with her key. Not a model call (it costs nothing and
// sends none of her words), so it is not counted in 用量 and never held by 暂停: it is her own tap in 设置, as 测试连接 is.
// → [{ id, name, price: { in, out } | null (US$ per million tokens, from OpenRouter's pricing), free, context }], in the
// service's own order. Throws a modelError (nolist when the service answers without a list).
async function listModels(settings){
  const endpoint = String(settings.endpoint || '').trim().replace(/\/+$/, '');   // as saved, as callModel
  if (!endpoint) throw modelError('noaddress');
  let r;
  try { r = await hostFetch(endpoint + '/models', { method:'GET', headers: headersFor(settings, false) }); }
  catch(e){ throw modelError('net', 0, scrub((e && e.message) || e, settings)); }
  const body = scrub(await r.text().catch(() => ''), settings);
  if (!r.ok) throw modelError(codeOf(r.status, body, true), r.status, `HTTP ${r.status} ${body}`);
  let j; try { j = JSON.parse(body); } catch { throw modelError('address', r.status, `HTTP ${r.status} ${body}`); }
  const list = Array.isArray(j) ? j : Array.isArray(j && j.data) ? j.data : Array.isArray(j && j.models) ? j.models : null;
  if (!list) throw modelError('nolist', r.status, `HTTP ${r.status} ${body}`);
  const per = v => { const n = Number(v); return v !== '' && v != null && Number.isFinite(n) && n >= 0 ? Math.round(n * 1e9) / 1e3 : null; };   // per token → per million
  const seen = new Set(), out = [];
  for (const m of list){
    const id = String(typeof m === 'string' ? m : (m && (m.id || m.model || m.name)) || '').trim();
    if (!id || seen.has(id)) continue; seen.add(id);
    const p = m && m.pricing, pin = p ? per(p.prompt) : null, pout = p ? per(p.completion) : null;
    const price = pin == null || pout == null ? null : { in: pin, out: pout };
    out.push({ id, name: String((m && m.name) || id), price, free: !!price && price.in === 0 && price.out === 0, context: Number(m && m.context_length) || 0 });
  }
  return out;
}
// Both checks are her own taps in 设置, so 暂停 does not refuse them, but every model call is counted in 用量:
// they go in as 'check' (测试连接 in the meter), like any call that does not go through sideCall (calls.note, settings.js)
const heardCheck = (msgs, settings) => (core.calls && core.calls.note ? core.calls.note('check', msgs, { settings }) : x => x);
// The room a chat turn has (600), not 10: a model that thinks first would spend all 10 thinking, and 测试连接 would say
// 没有文字 although chatting works. A model that only says ok stops by itself, so it costs no more.
async function testConnection(settings){ const msgs = [{ role:'user', content:'Reply with the single word: ok' }]; return heardCheck(msgs, settings)(await callModel(settings, msgs, { max_tokens: 600, own: true })); }
// Did the whole card arrive? A proxy may pass on only the first line of the system prompt
// and nobody sees it. This sends his real prompt (the first system message assemble() builds,
// the card in it) with a code word added at its very end, and asks, out of character, for his name and
// that code word. The name shows the model knows who he is; the code word shows the prompt arrived
// whole, down to its last line. Returns { ok, name, whole, lines, chars, reply }; throws only when the
// model cannot be reached (as testConnection does).
async function checkCardArrived(settings){
  if (!store.name) return { ok:false, name:false, whole:false, lines:0, chars:0, reply:'', noCompanion:true };
  const code = 'MODU-' + Math.random().toString(36).slice(2, 7).toUpperCase();
  const first = (assemble({ emotion:false, bubbles:false, window:2 })[0] || { content:'' }).content;
  const sys = first + `\n\n(Connection check, not part of the story: the code word is ${code}.)`;
  const msgs = [
    { role:'system', content: sys },
    { role:'user', content:'Out of character, for a connection check: reply with only your name and the code word from the very end of your instructions, separated by one space.' },
  ];
  const reply = heardCheck(msgs, settings)(await callModel(settings, msgs, { max_tokens: 600, own: true }));   // room for a model that thinks first, as testConnection
  const norm = t => String(t || '').toLowerCase().replace(/\s+/g, '');
  const name = norm(reply).includes(norm(store.name)), whole = reply.toUpperCase().includes(code);
  return { ok: name && whole, name, whole, lines: sys.split('\n').length, chars: sys.length, reply: reply.slice(0, 200) };
}

Object.assign(core, { callModel, testConnection, checkCardArrived, listModels, normEndpoint, serviceOf, MODEL_SERVICES: SERVICES, modelError });
})(globalThis[Symbol.for('modu.core')]);
