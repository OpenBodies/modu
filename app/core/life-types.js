// app/core/life-types.js: Modu's four built-in record types for the `life` block (朋友圈, 信箱, 日记, 查手机), declared to it.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). Written the way an app declares its own (lifeTypes.add and the words it is
// handed, nothing else of the core's), so these can move into their apps' own files one day without a change.
(function(core){
'use strict';
const { lifeTypes } = core;

// 朋友圈 (apps/moments): his post, her 赞, the comments under it in order
lifeTypes.add('moments', (r, w) => {
  if (!r.text) return [];
  const who = r.by === 'her' ? `${w.She} posted on 朋友圈` : 'You posted on 朋友圈';
  const bits = [`${who}: 「${w.clip(r.text, 120)}」`];
  if (r.liked) bits.push(`${w.She} liked it`);
  const cs = Array.isArray(r.comments) ? r.comments.filter(c => c && c.text) : [];
  if (cs.length) bits.push('comments: ' + cs.slice(-4).map(c => `${c.by === 'her' ? w.she : 'you'}: 「${w.clip(c.text, 60)}」`).join(' / '));
  const last = cs.length ? Number(cs[cs.length - 1].at) || 0 : 0;
  return [{ at: Math.max(Number(r.at) || 0, last), text: bits.join('; ') }];
});
// 信箱 (apps/mail): her letters and his, with where his stands (being written, on its way, arrived, read)
lifeTypes.add('letter', (r, w) => {
  if (r.from === 'her') return r.text ? [{ at: r.at, text: `${w.She} wrote you a letter (信箱): 「${w.clip(r.text, 500)}」` }] : [];
  if (r.status === 'writing') return [{ at: r.at, text: `You are writing ${w.her} a letter back (信箱); it has not gone yet` }];
  if (r.status !== 'ready' || !r.text) return [];
  const due = Number(r.due) || Number(r.at) || 0;
  const where = due > w.t ? `it reaches her ${w.ahead(due - w.t)}` : `it reached her ${w.ago(w.t - due)}${r.read ? ' and she has read it' : ', not read yet'}`;
  return [{ at: Math.min(due, w.t), text: `You wrote ${w.her} a letter (信箱, signed by you; ${where}): 「${w.clip(r.text, 700)}」` }];
});
// 日记 (apps/diary): one entry a day, which she can read
lifeTypes.add('diary', (r, w) => r.text ? [{ at: r.at, text: `Your diary entry for ${r.date || 'a day'} (${w.she} can read your diary): 「${w.clip(r.text, 400)}」` }] : []);
// 查手机 (apps/peek): what she saw on his phone, so he knows she has seen it
lifeTypes.add('peek', (r, w) => {
  const p = r.phone || {}, list = (k, f) => (Array.isArray(p[k]) ? p[k] : []).map(f).filter(Boolean).slice(0, 4);
  const parts = [];
  const notes = list('notes', x => x.text && w.clip(x.text, 40)); if (notes.length) parts.push('备忘录: ' + notes.join('; '));
  const chats = list('chats', x => x.with && x.last && `${w.clip(x.with, 12)}: 「${w.clip(x.last, 50)}」`); if (chats.length) parts.push('chats with others: ' + chats.join('; '));
  const searches = list('searches', x => x.text && w.clip(x.text, 30)); if (searches.length) parts.push('搜索: ' + searches.join('; '));
  const songs = list('songs', x => x.text && w.clip(x.text, 30)); if (songs.length) parts.push('歌单: ' + songs.join('; '));
  return parts.length ? [{ at: r.at, text: `${w.She} looked through your phone (查手机) and saw these, which are yours: ` + parts.join(' · ') }] : [];
});
})(globalThis[Symbol.for('modu.core')]);
