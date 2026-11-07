// app/core/api.js: window.ModuCore: the public face of the core; the only thing a page or an app ever sees.
// One of the core's files, loaded in the order of app/core/index.json; app/core.js is all of them joined
// (python -I app/core/join.py). Makes window.ModuCore, then closes the core's private namespace.
(function(core){
'use strict';
const { NEUTRAL_DEFAULTS, MODU_DEFAULTS, setDefaults, getDefaults, listeners, store, msgDate, now, setClock,
  phoneRoot, canPickFolder, EMOTIONS, splitBubbles, dropFinalStop, splitParts, photoTags, tidyCJK, parseReply,
  splitEmotion, parseMemoryFile, readMemory, addMemory, editMemory, pinMemory, deleteMemory, readPngTexts,
  normaliseCard, readCardFile, parseChat, chooseCaiChat, stageImport, buildStoreFiles, saveImport, loadStaged,
  setPronouns, loadFromDir, loadDemo, greetingFor, appendToChat, setAvatar, pronouns, loadContacts, current,
  openContact, canOpenWithoutAsking, removeContact, firstRun, firstCompanion, addBesideCard, presetSwitch, records, lifeTypes, myRecords, myStoreInfo, myStoreFiles,
  restoreMyStore, herProfile, loadHerProfile, setHerProfile, userName, herPronouns, refreshLife, logEvent, eventList, noticeRules, chatCardKind, addChatCard, sessionList, beginSession,
  holdSession, endSession, turn, shareWith, knownList, personaState, bridge, bridgeConnect,
  publish, setPhase, PRESENCE, setDayPlan, presence, updatePresence, wakeAt, setPresence, setBodyModel, bodyModel, chatLanguage,
  modelTuning, contextBlocks, setContextBlock, resetContextBlocks, buildContext, chatSignals, assemble, callModel,
  testConnection, checkCardArrived, listModels, normEndpoint, serviceOf, MODEL_SERVICES, memoryJob, deriveMemory, importMemory, dayMemory, calendarDays, awayTold, send, togetherSince, localModelAddress,
  DEFAULT_SETTINGS, loadSettings, saveSettings, CORE_VERSION, setEnv, param, params, state, jobs, bell, day, memorySource,
  prompt, prompts, layers, regex, chapters, calibrate, exportCard, answerPronoun, unusedParts, guessPronoun, parsePreset, presetLayer,
  moduDefaults, loreSelect, currentState, lunarDate, solarTerm, ticker, reach, sideCall, calls, sideSettings, useSettings, loadReach, saveReach, paused, lead } = core;

// window.ModuCore in a page; the global of a worker or a Node realm
globalThis.ModuCore = {
  get version(){ return CORE_VERSION; },
  EMOTIONS, store, on(f){ listeners.add(f); return () => listeners.delete(f); },
  // import + store
  readPngTexts, normaliseCard, readCardFile, parseChat, stageImport, chooseCaiChat, buildStoreFiles, saveImport, loadStaged,
  newCard: core.newCard,   // 搬家 → 新建一个 (a V2 card from what she typed, as a .json File)
  loadFromDir, loadDemo, appendToChat, phoneRoot, canPickFolder,
  // contacts
  get contacts(){ return core.contacts; }, get currentId(){ return core.currentId; }, set ephemeral(v){ core.ephemeral = v; },
  // what came beside the card in its folder, parsed (preset, regex, contacts); read only (查手机's contacts)
  get folderData(){ return core.folderData ? core.clone(core.folderData) : null; },
  // settles once the open companion's card folder (and its regex vetting) is read after 'loaded' (设置 redraws then)
  get cardsRead(){ return core.cardsRead; },
  // settle once his params.json (paramsRead) and Modu's default layers (defaultsRead) are read after each 'loaded'
  get paramsRead(){ return core.paramsRead; }, get defaultsRead(){ return core.defaultsRead; },
  loadContacts, openContact, removeContact, canOpenWithoutAsking, current, setAvatar, setPronouns, msgDate,
  // first run; the default companion once she moves her own in
  firstRun, greetingFor, firstCompanion,
  get firstRunError(){ return core.firstRunError || ''; },   // why the last firstRun failed ('' when it did not)
  get firstRunDetail(){ return core.firstRunDetail || ''; },   // that failure as the line to copy (saveFailure)
  // can this browser keep anything, and the one line to copy for a failed save (any error)
  storageCheck: core.storageCheck, saveFailure: core.saveFailure,
  get contactsUnread(){ return core.isUnread(); },   // her list could not be read: "nobody here" would be wrong
  // records (store 0.2): one folder per record type
  records,
  // her phone: her own store beside his folders, the same record API; and how he may know
  // a thing of hers (a knowledge path; the `known` block)
  myRecords, get myStore(){ return myStoreInfo(); }, myStoreFiles, restoreMyStore, shareWith, knownList,
  // memory
  readMemory, parseMemoryFile, deriveMemory, memoryJob, addMemory, editMemory, deleteMemory, pinMemory,
  // the memory job for a chat brought with 搬家 (queued by saveImport / loadStaged), and the one
  // way days away are counted (calendar days)
  importMemory, calendarDays,
  // the chat of a day that is over becomes memory by itself, one call a day at most
  dayMemory,
  // was a day inside a time away she had told him about (a trip)? → her line, or ''
  awayTold,
  // persona + brain
  pronouns, assemble, buildContext, chatSignals, contextBlocks, setContextBlock, resetContextBlocks, modelTuning, personaState, refreshLife,
  // the life block's record types: an app declares its own with lifeTypes.add; the core names none
  lifeTypes,
  // the event log: every app writes what happened through one call; the `events` block reads it
  logEvent, eventList,
  // one turn of his inside an app, app sessions and the neutral chat cards
  turn, beginSession, holdSession, endSession, get sessions(){ return sessionList(); }, addChatCard, chatCardKind,
  // notice rules: the seam where a page decides whether an entry reaches his prompt (none by default)
  noticeRules,
  get lastContext(){ return core.lastContext; }, splitEmotion, parseReply, splitBubbles, splitParts, photoTags, dropFinalStop, chatLanguage, tidyCJK, callModel, testConnection, send, togetherSince,
  // body seam
  publish, setPhase, bridgeConnect, bridge, presence, setPresence, PRESENCE, now, setClock, setDayPlan, setBodyModel, bodyModel,
  // look at presence again now (after a send, a reply, a fresh day copy), not only on the clock beat; when he is next up
  updatePresence, wakeAt,
  // settings
  DEFAULT_SETTINGS, loadSettings, saveSettings, localModelAddress,
  // the host: fetch, clock, storage, prefs, … passed in by a host with no browser
  setEnv,
  // the card-arrived check behind 测试连接
  checkCardArrived,
  // the services she can pick by name (frozen), the address as the service answers it, which service an
  // address is, the service's own model list
  get modelServices(){ return MODEL_SERVICES.map(s => Object.freeze(Object.assign({}, s))); }, normEndpoint, serviceOf, listModels,
  // product defaults (neutral in the core; Modu's page sets MODU_DEFAULTS)
  NEUTRAL_DEFAULTS, MODU_DEFAULTS, setDefaults, getDefaults,
  // his params and a card's own state; jobs and the bell; his day; the memory
  // source; side-call prompts in text files; the layer list
  param, params, state, jobs, bell, day, memorySource, prompt, prompts, layers,
  // cards and layers: regex (prompt and display side, guarded), Modu's defaults, a preset read
  // as text blocks, the 世界书 timing set, calibration into params.json, chapters, the card back out, what is never run
  // here, his pronoun read from the card, the facts' current state
  regex, moduDefaults, parsePreset, presetLayer, loreSelect, calibrate, chapters, exportCard, unusedParts, guessPronoun, answerPronoun,
  currentState, calendar: { lunar: lunarDate, term: solarTerm },
  // files she adds later beside his card; a switch for a block of a preset she added herself
  addBesideCard, presetSwitch,
  // her own name, picture and pronoun (profile/me in her store), the name his prompt uses for her, her pronoun
  herProfile, loadHerProfile, setHerProfile, userName, herPronouns,
  // the one clock, 主动, her 他找你 settings and 暂停, the side model and the one counted door
  // for every side call (his day's sketch and posts, memory's age-out and tidy, the decider) that 暂停 closes
  clock: ticker, reach, sideCall, calls, sideSettings, useSettings, loadReach, saveReach, paused, lead,
};
delete globalThis[Symbol.for('modu.core')];   // the core's files are all loaded: nothing outside them reaches its insides
})(globalThis[Symbol.for('modu.core')]);
