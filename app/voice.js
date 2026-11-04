// Modu 声音 (voice in and out): which of the device's voices reads his messages, and his name heard
// right in voice input. Plain script, no build step, nothing fetched:
// it defines window.ModuVoice. Pure functions only; the page passes the device's voices and what was heard.
(function(){
'use strict';

// ---- his voice is a man's by default ----------------------------------------------------------------
// Matched on the voice's name, the only thing browsers say about a voice. Known male and female Chinese and
// English voices on Windows (Microsoft, local and online), macOS / iOS (Apple) and Chrome (Google). A voice
// on neither list is "unknown" (Android's Chrome shows one voice per language, named after the language).
const MALE = /\b(yunxi|yunjian|yunyang|yunxia|yunze|yunfeng|yunhao|yunye|yunjie|yunyi|yunhan|kangkang|zhiwei|yunjhe|danny|wanlung|li-?mu|guy|andrew|brian|christopher|eric|roger|steffan|davis|tony|jason|david|mark|george|ryan|thomas|william|liam|connor|mitchell|prabhat|daniel|alex|fred|aaron|arthur|rishi|tom|gordon|oliver|james|ralph|albert|reed|rocko|eddy|grandpa|male)\b|男/i;
const FEMALE = /\b(xiaoxiao|xiaoyi|xiaochen|xiaohan|xiaomeng|xiaomo|xiaoqiu|xiaorui|xiaoshuang|xiaoxuan|xiaoyan|xiaoyou|xiaozhen|xiaobei|xiaoni|huihui|yaoyao|hanhan|hsiaochen|hsiaoyu|hiugaai|hiumaan|tracy|ting-?ting|mei-?jia|sin-?ji|yu-?shu|lili|lilian|shasha|zira|aria|jenny|michelle|ava|emma|ana|hazel|susan|libby|sonia|maisie|natasha|clara|samantha|karen|moira|tessa|victoria|fiona|allison|kathy|princess|vicki|female)\b|女|google (普通话|國語|粤語|粵語|us english)/i;
const PREFER = { zh: ['yunxi', 'li-?mu', 'kangkang', 'yunjian', 'yunyang', 'yunze', 'zhiwei', 'yunjhe'], en: ['brian', 'andrew', 'guy', 'christopher', 'eric', 'daniel', 'david', 'alex'] };
function gender(v){ const n = String((v && (v.name || v.voiceURI)) || ''); return FEMALE.test(n) ? 'female' : MALE.test(n) ? 'male' : 'unknown'; }
// 'zh' or 'en': what the text is mostly written in (Chinese characters carry it)
function langOf(text){ const t = String(text || ''), han = (t.match(/[一-鿿]/g) || []).length, lat = (t.match(/[A-Za-z]/g) || []).length; return lat > han * 3 && lat > 3 ? 'en' : 'zh'; }
// voices: the device's list (name, lang, voiceURI, localService). opts: { lang: 'zh' | 'en', name: the one
// she picked, if any }. → the voice to use, or null when the device has no voice for this that is not a
// woman's (then nothing is read until she picks one). Her own pick always wins, whoever it is.
function pick(voices, opts = {}){
  const all = Array.from(voices || []).filter(v => v && v.name);
  if (opts.name){ const mine = all.find(v => v.name === opts.name); if (mine) return mine; }
  const lang = opts.lang === 'en' ? 'en' : 'zh';
  const of = all.filter(v => new RegExp('^' + lang, 'i').test(String(v.lang || '')));
  // mainland first for Chinese; natural (online) voices before the older local ones; then the young men's
  // voices people pick for a companion (Yunxi; Brian, the demo's English voice) before the others
  const pref = v => { const i = PREFER[lang].findIndex(p => new RegExp('\\b' + p + '\\b', 'i').test(v.name)); return i < 0 ? 9 : i; };
  const rank = v => (lang === 'zh' && !/^zh[-_]cn/i.test(v.lang) ? 200 : 0) + (/natural|online|neural|enhanced|premium/i.test(v.name) ? 0 : 100) + pref(v);
  const by = list => list.slice().sort((a, b) => rank(a) - rank(b))[0] || null;
  return by(of.filter(v => gender(v) === 'male')) || by(of.filter(v => gender(v) === 'unknown')) || null;
}

// ---- his name, heard right --------------------------------------------------------------------------
// Speech recognition writes a name it does not know as other characters that sound the same (墨渡 → 莫渡,
// 默度). Two steps, nothing sent anywhere:
//  1. the recognizer's own alternatives: if the first guess lacks his name and another guess has it, that one;
//  2. sound-alikes: a run of characters with the same syllables as one of his names (tones ignored) becomes
//     the name. The syllable of a character comes from the browser's own Chinese collation, which sorts by
//     pinyin: SYL below is the first character of each syllable in that order (made once from ICU and
//     pypinyin; about 98% of characters right, the misses are characters with two readings).
// Limits: a mishearing with a different syllable (魔都 for 墨渡: dou, not du) is not caught; a name of one
// character, or a doubled one (宝宝), is only fixed through step 1; where the browser has no Chinese
// collation step 2 is off.
const SYL = '哎ai 安an 肮ang 凹ao 丷ba 挀bai 扳ban 邦bang 勹bao 卑bei 奔ben 伻beng 屄bi 边bian 灬biao 憋bie 汃bin 冫bing 癶bo 峬bu 嚓ca 偲cai 参can 仓cang 撡cao 冊ce 曽ceng 叉cha 芆chai 辿chan 伥chang 抄chao 车che 抻chen 阷cheng 吃chi 充chong 抽chou 出chu 揣chuai 巛chuan 刅chuang 吹chui 旾chun 逴chuo 呲ci 匆cong 凑cou 粗cu 汆cuan 崔cui 邨cun 搓cuo 咑da 呆dai 丹dan 当dang 刀dao 嘚de 灯deng 氐di 敁dian 刁diao 爹die 丁ding 东dong 吺dou 厾du 耑duan 垖dui 吨dun 多duo 妸e 奀en 儿er 发fa 帆fan 匚fang 飞fei 分fen 丰feng 紑fou 夫fu 旮ga 侅gai 甘gan 冈gang 皋gao 戈ge 根gen 刯geng 工gong 勾gou 估gu 瓜gua 乖guai 关guan 光guang 归gui 丨gun 呙guo 咍hai 佄han 夯hang 茠hao 诃he 拫hen 亨heng 叿hong 齁hou 乎hu 花hua 怀huai 欢huan 巟huang 灰hui 昏hun 吙huo 丌ji 加jia 戋jian 江jiang 艽jiao 阶jie 巾jin 坕jing 冂jiong 丩jiu 凥ju 姢juan 噘jue 军jun 咔ka 开kai 刊kan 忼kang 尻kao 匼ke 肎ken 劥keng 空kong 抠kou 扝ku 夸kua 蒯kuai 宽kuan 匡kuang 亏kui 坤kun 扩kuo 垃la 来lai 兰lan 啷lang 捞lao 仂le 勒lei 崚leng 哩li 奁lian 良liang 撩liao 毟lie 拎lin 伶ling 溜liu 龙long 瞜lou 噜lu 驴lv 掠lve 妈ma 埋mai 嫚man 牤mang 猫mao 嚒me 呅mei 椚men 擝meng 咪mi 宀mian 喵miao 乜mie 民min 名ming 摸mo 哞mou 毪mu 拏na 腉nai 囡nan 囔nang 孬nao 疒ne 娞nei 妮ni 拈nian 娘niang 鸟niao 捏nie 宁ning 妞niu 农nong 羺nou 奴nu 女nv 讴ou 妑pa 拍pai 眅pan 乓pang 抛pao 呸pei 喷pen 匉peng 丕pi 囨pian 剽piao 氕pie 姘pin 乒ping 钋po 剖pou 仆pu 七qi 掐qia 千qian 呛qiang 悄qiao 苆qie 亲qin 靑qing 卭qiong 丘qiu 区qu 奍quan 缺que 夋qun 呥ran 穣rang 娆rao 人ren 扔reng 日ri 戎rong 厹rou 邚ru 堧ruan 婑rui 瞤run 捼ruo 仨sa 毢sai 三san 桒sang 掻sao 閪se 杀sha 筛shai 山shan 伤shang 弰shao 奢she 申shen 升sheng 尸shi 収shou 书shu 衰shuai 闩shuan 双shuang 脽shui 吮shun 说shuo 厶si 忪song 凁sou 苏su 狻suan 夊sui 孙sun 唆suo 他ta 囼tai 坍tan 汤tang 夲tao 忑te 熥teng 剔ti 天tian 旫tiao 帖tie 厅ting 囲tong 偷tou 凸tu 湍tuan 推tui 吞tun 乇tuo 屲wa 歪wai 弯wan 尣wang 危wei 昷wen 翁weng 挝wo 乌wu 夕xi 虲xia 仙xian 乡xiang 灱xiao 些xie 心xin 星xing 凶xiong 休xiu 吁xu 吅xuan 削xue 坃xun 丫ya 恹yan 央yang 幺yao 倻ye 一yi 囙yin 应ying 佣yong 优you 込yu 囦yuan 曰yue 晕yun 帀za 災zai 兂zan 匨zang 傮zao 则ze 贼zei 怎zen 増zeng 扎zha 夈zhai 枬zhan 张zhang 佋zhao 蜇zhe 贞zhen 凧zheng 之zhi 中zhong 州zhou 朱zhu 抓zhua 专zhuan 妆zhuang 隹zhui 宒zhun 拙zhuo 乲zi 宗zong 邹zou 租zu 钻zuan 厜zui 尊zun 昨zuo'.split(' ').map(x => [x[0], x.slice(1)]);
let coll = null;
try { coll = new Intl.Collator('zh-Hans-CN-u-co-pinyin'); } catch {}
function syllableRaw(ch){
  if (!coll || !/^[一-鿿]$/.test(ch)) return '';
  let lo = 0, hi = SYL.length - 1, at = -1;
  while (lo <= hi){ const mid = (lo + hi) >> 1; if (coll.compare(SYL[mid][0], ch) <= 0){ at = mid; lo = mid + 1; } else hi = mid - 1; }
  return at < 0 ? '' : SYL[at][1];
}
// the collation works here when a few known characters come out right
const pinyinOK = (() => { try { return syllableRaw('墨') === 'mo' && syllableRaw('莫') === 'mo' && syllableRaw('渡') === 'du' && syllableRaw('一') === 'yi' && syllableRaw('张') === 'zhang'; } catch { return false; } })();
function syllable(ch){ return pinyinOK ? syllableRaw(ch) : ''; }
function sameSound(a, b){
  a = String(a || ''); b = String(b || '');
  if (!pinyinOK || a.length !== b.length || !a) return false;
  for (let i = 0; i < a.length; i++){ if (a[i] === b[i]) continue; const x = syllable(a[i]); if (!x || x !== syllable(b[i])) return false; }
  return true;
}
// his names, from his card: his name, the card's nickname, and 小名 / 昵称 / 外号 / 爱称 written in it
function names(card, name){
  const c = card || {}, out = [name, c.name, c.nickname];
  const text = [c.description, c.personality, c.scenario, c.first_mes].filter(Boolean).join('\n');
  for (const m of text.matchAll(/(?:小名|昵称|外号|爱称|绰号|乳名)\s*(?:是|叫|为|：|:)?\s*[「“"']?([一-鿿]{2,4})/g)) out.push(m[1]);
  return [...new Set(out.map(s => String(s || '').trim()).filter(s => s.length >= 2 && s.length <= 6))];
}
const doubled = n => n.length === 2 && n[0] === n[1];
// text: what was heard; list: his names; alts: the recognizer's other guesses (first = text) → { text, fixed }
function fixHeard(text, list, alts){
  let t = String(text || ''); const ns = (list || []).filter(Boolean).sort((a, b) => b.length - a.length), fixed = [];
  const has = s => ns.some(n => s.includes(n));
  if (!has(t)){ const alt = (alts || []).map(String).find(a => a !== t && has(a) && Math.abs(a.length - t.length) <= 2); if (alt){ fixed.push(alt); t = alt; } }
  for (const n of ns){
    if (doubled(n) || !/^[一-鿿]+$/.test(n)) continue;
    let out = '';
    for (let i = 0; i < t.length;){
      const w = t.slice(i, i + n.length);
      if (w.length === n.length && w !== n && sameSound(w, n)){ out += n; fixed.push(w + '→' + n); i += n.length; }
      else { out += t[i]; i++; }
    }
    t = out;
  }
  return { text: t, fixed };
}

// ---- no voice unless the card has an approved one -------------------------------------------------------
// A bad default voice is worse than no voice. Voice is off by default, and
// a card with no approved voice shows no voice option at all (朗读, 声音, the call's 说话 are hidden). A card (or
// his params) declares one: card.extensions.modu.voice or params.voice = { approved: true, engine ('browser' |
// 'file' | another name), name? (a device voice's name, for 'browser'), lang?, rate?, pitch?, by?, at? }.
// → that declaration (a copy) or null. approved must be exactly true; anything else is no voice.
function approved(card, params){
  const c = card && card.extensions && card.extensions.modu && card.extensions.modu.voice, p = params && params.voice;
  const v = [p, c].find(x => x && typeof x === 'object' && x.approved === true);
  return v ? JSON.parse(JSON.stringify(v)) : null;
}
function offered(card, params){ return !!approved(card, params); }

window.ModuVoice = { version: '0.2', approved, offered, gender, langOf, pick, syllable, sameSound, names, fixHeard, get pinyin(){ return pinyinOK; } };
})();
