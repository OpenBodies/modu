// app/core/layers.js: the layer list: which part of his prompt comes from where (Modu, her card, a card folder, or Modu's default filling in).
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). A name from another core file is `core.name` (or taken at the top).
(function(core){
'use strict';
const { store } = core;

// One prompt, built from layers, top to bottom. A layer the card brings is used; a layer it lacks is filled from
// Modu's own default; base rules and his life, status and memory are always Modu's.
//   [{ layer, source, name }]  layer: 'base' | 'preset' | 'card' | 'lore' | 'life' | 'chat' | 'regex-prompt' | 'regex-display'
//   source: 'modu' (always ours) | 'hers' (inside the card she brought) | 'card-folder' (a file beside the card in
//   the folder she brought: preset.json, a 世界书 .json, regex .json, contacts.json) | 'default' (Modu's, filling in)
// A card folder is imported like any card, with no name checks. What came beside the card is kept on the store as
// store.cardFolder = { preset?: { name }, lore?: [{ name }], regex?: [{ name, placement: 'prompt' | 'display' }],
// contacts?: { name } } (the import fills it; nothing in Modu edits those files). The list only says where each
// layer comes from, from what the store holds; preset.js and regex.js use them.
const LAYERS = ['base', 'preset', 'card', 'lore', 'life', 'chat', 'regex-prompt', 'regex-display'];
function layers(){
  const card = store.card || null, ext = (card && card.extensions) || {}, modu = ext.modu || {}, f = store.cardFolder || {};
  const regex = [].concat(ext.regex_scripts || []), fRegex = [].concat(f.regex || []);
  const regexFor = place => {
    const mine = fRegex.filter(r => (r.placement || 'display') === place);
    if (mine.length) return { source: 'card-folder', name: mine.map(r => r.name || '').filter(Boolean).join(', ') || 'regex' };
    // 酒馆 regex: placement 1 = her input, 2 = his output; promptOnly / markdownOnly say which side it touches
    const ok = regex.filter(r => r && !r.disabled && (place === 'prompt' ? r.promptOnly || !r.markdownOnly : r.markdownOnly || !r.promptOnly));
    return ok.length ? { source: 'hers', name: ok.map(r => r.scriptName || '').filter(Boolean).join(', ') || 'regex' } : { source: 'default', name: 'Modu default' };
  };
  const lore = (card && card.character_book) || (modu.lore && modu.lore.length);
  return [
    { layer: 'base', source: 'modu', name: 'Modu base' },
    f.preset ? { layer: 'preset', source: 'card-folder', name: f.preset.name || 'preset' } : modu.preset ? { layer: 'preset', source: 'hers', name: modu.preset.name || 'preset' } : { layer: 'preset', source: 'default', name: 'Modu default' },
    card ? { layer: 'card', source: 'hers', name: card.name || store.name || '' } : { layer: 'card', source: 'default', name: store.name || '' },
    f.lore && f.lore.length ? { layer: 'lore', source: 'card-folder', name: f.lore.map(b => b.name || '').join(', ') } : lore ? { layer: 'lore', source: 'hers', name: (card.character_book && card.character_book.name) || 'lore' } : { layer: 'lore', source: 'default', name: 'Modu default' },
    { layer: 'life', source: 'modu', name: 'Modu' },
    { layer: 'chat', source: 'modu', name: 'chat.jsonl' },
    Object.assign({ layer: 'regex-prompt' }, regexFor('prompt')),
    Object.assign({ layer: 'regex-display' }, regexFor('display')),
  ];
}

Object.assign(core, { LAYERS, layers });
})(globalThis[Symbol.for('modu.core')]);
