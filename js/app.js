// =====================================================================
//  app.js — ふたりスタジオの画面の動き
// =====================================================================
import { createStore, LS, newId } from './store.js';

const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = s => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const pad = n => String(n).padStart(2, '0');
const dayOf = t => { const d = new Date(t); return pad(d.getMonth() + 1) + '/' + pad(d.getDate()); };
const hmOf = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const whenOf = t => t ? dayOf(t) + ' ' + hmOf(t) : '';
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 2400); }
function copy(text, label) {
  const ng = () => toast('コピーできませんでした。テキストを選択してコピーしてください');
  try { navigator.clipboard.writeText(text).then(() => toast((label || '') + 'コピーしました'), ng); } catch (e) { ng(); }
}

/* ---------- サンプルの曲データ（音源アップロードは次の段階で本番化） ---------- */
const BASE = 228;
const SECTIONS = [['Intro', 0, 12, .35], ['Verse1', 12, 44, .5], ['Pre', 44, 60, .62], ['Chorus', 60, 92, .92], ['Verse2', 92, 124, .52], ['Pre', 124, 140, .64], ['Chorus', 140, 172, .95], ['Bridge', 172, 194, .45], ['Break', 194, 198, .06], ['Last', 198, 222, 1], ['Outro', 222, 228, .3]];
const CANDS = [
  { id: 'c03', no: '#03', dur: 221, seed: 31, style: 'emotional J-pop, female vocal, piano, 128 bpm', lyr: 'v1', how: '原曲アップロード → カバー', when: '10/02 22:14', note: 'イントロ良い／サビが弱い' },
  { id: 'c05', no: '#05', dur: 226, seed: 52, style: 'emotional J-pop, airy female vocal, bright piano, light drums, 128 bpm', lyr: 'v2', how: '原曲アップロード → カバー', when: '10/03 21:40', note: '2番Aメロが軽くて好き' },
  { id: 'c06', no: '#06', dur: 233, seed: 64, style: 'J-rock, female vocal, distorted guitar, 128 bpm', lyr: 'v2', how: '原曲アップロード → カバー', when: '10/03 21:52', note: 'ロック寄りすぎ' },
  { id: 'c07', no: '#07', dur: 228, seed: 77, style: 'emotional J-pop, female vocal, bright piano, driving drums, strings, 128 bpm, F# minor', lyr: 'v2', how: '原曲アップロード → カバー → 延長 ×1', when: '10/04 23:05', note: '採用。サビの入りが最高' },
  { id: 'c08', no: '#08', dur: 228, seed: 88, style: 'emotional J-pop, female vocal, bright piano, driving drums, strings, 128 bpm, F# minor', lyr: 'v2', how: '#07 をリマスター', when: '10/04 23:20', note: '#07より音が硬い' },
  { id: 'c09', no: '#09', dur: 241, seed: 93, style: 'emotional J-pop, female vocal, synth pad, 128 bpm', lyr: 'v2', how: '原曲アップロード → カバー', when: '10/05 20:11', note: 'シンセ案。別の曲で使えそう' }
];
const LYRICS = `[Verse 1]
始発を待つホーム　白い息が溶けていく
言えなかった言葉が　まだポケットの中

[Pre-Chorus]
信号が青に変わる　背中を押すように

[Chorus]
夜明けのプリズム　光を分けて
君の色も　僕の色も　混ざらないまま輝いて

[Verse 2]
画面越しの笑い声　遠いはずなのに近い
同じ空の端っこで　同じ歌を探してた

[Bridge]
（ピアノだけ・ささやくように）

[Final Chorus]
夜明けのプリズム　もう一度だけ
重ねた音が　ほどけないように`;
const PROMPTS = [
  { name: '切ない疾走系（今回の採用設定）', text: 'emotional J-pop, female vocal, bright piano, driving drums, strings, 128 bpm, F# minor' },
  { name: 'しっとりバラード', text: 'piano ballad, soft female vocal, warm strings, 72 bpm, intimate' },
  { name: 'シンセ寄り', text: 'synth pop, airy female vocal, synth pad, four-on-the-floor, 124 bpm' }
];
const STEMS = [['Vocals', '#F2A93B', 'ok'], ['Backing Vocals', '#F2C46B', 'ok'], ['Drums', '#F06B6B', 'ok'], ['Bass', '#5B8DEF', 'ok'], ['Guitar', '#3CC98E', 'ok'], ['Keyboard', '#A78BFA', 'ok'], ['Strings', '#C9A7FA', 'ok'], ['Brass', '#E39B5B', 'wait'], ['Woodwinds', '#7FC9B8', 'wait'], ['Percussion', '#E87A9A', 'ok'], ['Synth', '#6BB8F2', 'ok'], ['FX', '#8B91A1', 'wait']];
const CHECKS = [
  ['音源', [['master', 'マスター音源の書き出し', 'WAV・-14 LUFS 前後'], ['listen', 'スマホ・イヤホン・PCで最終チェック', '']]],
  ['映像', [['mv', 'MV / リリックビデオ', ''], ['thumb', 'サムネイル', '1280×720・2MB以下']]],
  ['YouTube', [['desc', '概要欄（クレジット・歌詞）', '右上のクレジットを貼り付け'], ['ai', '「改変または合成されたコンテンツ」の申告', 'AI生成の音声を使っているため投稿時に設定'], ['sched', '公開日時・プレミア公開の設定', '2026/11/20 20:00']]],
  ['確認', [['terms', 'SUNOの最新の利用規約を確認', '投稿の直前にもう一度'], ['ok', '相方の最終OK', ''], ['split', 'クレジット・収益分配の取り決め', '2人で合意した内容をメモに残す']]]
];
// 2人で共有する制作データの初期値
const DEF_SHARED = {
  cand: { c03: { star: false, st: 'keep' }, c05: { star: true, st: 'keep' }, c06: { star: false, st: 'drop' }, c07: { star: true, st: 'adopt' }, c08: { star: false, st: 'keep' }, c09: { star: true, st: 'keep' } },
  comments: {
    c07: [{ t: 8, by: 'pt', x: 'イントロのピアノ、原曲の雰囲気が残っていて良い' }, { t: 61, by: 'pt', x: 'サビの入りが最高！' }, { t: 96, by: 'me', x: '2番Aメロは #05 の方が軽くて好きかも' }, { t: 195, by: 'pt', x: 'ここのブレイク、原曲のイメージ通り' }],
    c05: [{ t: 94, by: 'me', x: 'この2番の軽さを #07 にも欲しい' }], c06: [{ t: 62, by: 'pt', x: 'ギターが強すぎて歌が埋もれる' }]
  },
  revs: [{ t: 30, by: 'me', x: 'イントロのリバーブを少し短く', done: true }, { t: 72, by: 'me', x: 'サビのボーカルを +1dB 前に', done: false }, { t: 126, by: 'pt', x: 'Pre-Chorusのハモりが大きい？確認お願いします', done: false }, { t: 196, by: 'me', x: 'ラスサビ前のブレイクで一瞬だけ無音に', done: false }],
  checks: { master: false, listen: false, mv: false, thumb: true, desc: false, ai: false, sched: false, terms: false, ok: false, split: true },
  credit: `「夜明けのプリズム」

作詞・作曲：相方
編曲：あなた（with Suno）
Mix / Mastering：相方
イラスト：（未定）

#オリジナル曲 #AI音楽`
};
const SHARED_KEYS = Object.keys(DEF_SHARED);
// ローカルモード用のサンプル（チャット・共有メモ）
const SEED = {
  chat: () => {
    const T = (m, d, h, mi) => new Date(2026, m - 1, d, h, mi).getTime();
    const pt = { uid: 'partner', name: '相方' }, me = { uid: 'local', name: 'あなた' };
    return [
      { id: 's1', ...pt, at: T(10, 4, 22, 58), x: '#07 聴きました！サビの入り最高です', ref: { k: 'cand', id: 'c07', t: 61 } },
      { id: 's2', ...me, at: T(10, 4, 23, 2), x: 'ですよね！これで進めましょう。ステムに分けたら送ります' },
      { id: 's3', ...me, at: T(10, 5, 20, 30), x: '12ステム上げました。Brass と Woodwinds はほぼ音がないので、使わなくて大丈夫です', ref: { k: 'tab', tab: 'fin' } },
      { id: 's4', ...pt, at: T(10, 6, 21, 15), x: 'MIX v2 上げました。ボーカルを少し前に出してます', ref: { k: 'ab', tr: 1, t: 72 } },
      { id: 's5', ...pt, at: T(10, 6, 21, 16), x: 'Pre-Chorusのハモりだけ自信がないので、聴いてもらえますか？', ref: { k: 'ab', tr: 1, t: 126 } }
    ];
  },
  lastRead: new Date(2026, 9, 5, 21, 0).getTime(),
  partnerRead: new Date(2026, 9, 6, 21, 10).getTime(),
  memos: () => [
    { id: newId(), title: '決まったこと', body: '・採用は SUNO #07（10/04）\n・サビ前のブレイクは原曲どおり残す\n・投稿は 11/20（金）20:00 プレミア公開', pinned: true, updatedAt: new Date(2026, 9, 6, 21, 20).getTime(), updatedBy: '相方' },
    { id: newId(), title: '次にやること', body: '・相方：MIX v3（修正指示3件）\n・自分：サムネイルのラフ、概要欄の文章', pinned: false, updatedAt: new Date(2026, 9, 6, 21, 25).getTime(), updatedBy: 'あなた' },
    { id: newId(), title: '次の曲のアイデア', body: '・#09 のシンセ案を別の曲で使う？\n・冬っぽいバラードも1曲やりたい', pinned: false, updatedAt: new Date(2026, 9, 5, 23, 0).getTime(), updatedBy: 'あなた' }
  ]
};

/* ---------- 状態 ---------- */
const UI_KEY = 'futari-studio-ui';
const UI = Object.assign({ tab: 'lab', sel: 'c07', filter: 'all', wide: { chat: false, memo: false } }, LS.get(UI_KEY, {}));
UI.memoMode = 'local';   // メモ帳はいつも「自分だけのメモ」から始める（共有は確認してから開く）
const saveUI = () => LS.set(UI_KEY, UI);
const SH = JSON.parse(JSON.stringify(DEF_SHARED));   // 2人で共有する制作データ
let store = null, ME = { uid: 'local', name: 'あなた' }, AUTH = { isOwner: false };
let pendingPatch = {}, patchTimer = 0;
function saveShared(...keys) {
  keys.forEach(k => { pendingPatch[k] = SH[k]; });
  clearTimeout(patchTimer);
  patchTimer = setTimeout(() => {
    const p = pendingPatch; pendingPatch = {};
    if (!store) return;
    Promise.resolve(store.patchState(p)).catch(() => toast('保存できませんでした。通信状況を確認してください'));
  }, 350);
}
// 誰の書き込みか（サンプルの 'me' / 'pt' と、本番の uid の両方に対応）
const isMine = x => x.by === 'me' ? ME.uid === 'local' || AUTH.isOwner : x.by === ME.uid;
const whoName = x => isMine(x) ? 'あなた' : (x.name || '相方');
const whoCls = x => isMine(x) ? 'me' : 'pt';

/* ---------- 波形 ---------- */
function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function fakePeaks(seed, dur, n) {
  const r = rng(seed), out = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * BASE; const s = SECTIONS.find(x => t >= x[1] && t < x[2]) || SECTIONS[SECTIONS.length - 1];
    const beat = .72 + .28 * Math.abs(Math.sin(t * Math.PI * 128 / 60)); const fade = Math.min(1, t / 3, (BASE - t) / 4);
    out.push(Math.max(.02, Math.min(1, s[3] * (.92 + (seed % 5) * .03) * beat * (.7 + r() * .3) * fade)));
  }
  return out;
}
const cache = {};
const peaksOf = (c, n) => cache[c.id + n] || (cache[c.id + n] = fakePeaks(c.seed, c.dur, n));
function drawWave(cv, peaks, prog, marks) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
  const cs = getComputedStyle(cv), on = cs.getPropertyValue('--ac').trim() || '#A78BFA', off = cs.getPropertyValue('--dim').trim() || '#4A505E', fg = cs.getPropertyValue('--fg').trim() || '#E7E9EF';
  const n = peaks.length, bw = w / n, mid = h / 2;
  for (let i = 0; i < n; i++) { const a = peaks[i] * (mid - 3); c.fillStyle = (i + .5) / n <= prog ? on : off; c.fillRect(i * bw, mid - a, Math.max(1, bw - .5), Math.max(1, a * 2)); }
  if (marks) { c.fillStyle = fg; marks.forEach(m => { const x = m * w; c.globalAlpha = .55; c.fillRect(x - .5, 0, 1, h); c.globalAlpha = 1; c.beginPath(); c.arc(x, 5, 3.5, 0, Math.PI * 2); c.fill(); }); }
  if (prog != null && prog > 0) { c.fillStyle = fg; c.fillRect(Math.min(w - 2, prog * w - 1), 0, 2, h); }
}
function sects(el, dur) { const k = dur / BASE; el.innerHTML = SECTIONS.map(s => `<span style="left:${(s[1] * k / dur * 100).toFixed(2)}%;width:${((s[2] - s[1]) * k / dur * 100).toFixed(2)}%" title="${s[0]} ${fmt(s[1] * k)}">${s[0]}</span>`).join(''); }

/* ---------- プレイヤー ---------- */
const players = [];
function Player(el, getTracks, getMarks, onUpdate) {
  const p = { cur: 0, pos: 0, playing: false, last: 0, match: true }; const cv = $('.wave', el);
  p.tracks = getTracks; p.track = () => p.tracks()[p.cur] || p.tracks()[0];
  p.gain = () => { const ts = p.tracks(), t = p.track(); if (!p.match || ts.length < 2) return 1; const quiet = Math.min(...ts.map(x => x.lufs)); return Math.pow(10, (quiet - t.lufs) / 20); };
  p.update = () => {
    const t = p.track(); drawWave(cv, t.peaks, t.dur ? p.pos / t.dur : 0, (getMarks ? getMarks() : []).map(x => x / t.dur));
    $('.tnow', el).textContent = fmt(p.pos); $('.tdur', el).textContent = fmt(t.dur);
    $('.play', el).textContent = p.playing ? '❚❚' : '▶'; onUpdate && onUpdate(p);
  };
  function loop() {
    if (!p.playing) return; const now = performance.now(), t = p.track();
    if (t.audio) { p.pos = t.audio.currentTime; if (t.audio.ended) p.playing = false; } else { p.pos += (now - p.last) / 1000; if (p.pos >= t.dur) { p.pos = t.dur; p.playing = false; } }
    p.last = now; p.update(); if (p.playing) requestAnimationFrame(loop);
  }
  p.play = () => {
    if (p.playing) return; players.forEach(o => o !== p && o.pause()); const t = p.track(); if (p.pos >= t.dur) p.pos = 0;
    if (t.audio) { t.audio.currentTime = p.pos; t.audio.volume = Math.min(1, p.gain()); t.audio.play().catch(() => {}); }
    p.playing = true; p.last = performance.now(); requestAnimationFrame(loop);
  };
  p.pause = () => { if (!p.playing) return; const t = p.track(); if (t.audio) t.audio.pause(); p.playing = false; p.update(); };
  p.toggle = () => p.playing ? p.pause() : p.play();
  p.seek = s => { const t = p.track(); p.pos = Math.max(0, Math.min(t.dur, s)); if (t.audio) t.audio.currentTime = p.pos; p.update(); };
  p.setTrack = i => {
    if (i === p.cur) return; const was = p.playing, old = p.track(); if (old.audio) old.audio.pause(); p.cur = i; const t = p.track(); p.pos = Math.min(p.pos, t.dur);
    if (was && t.audio) { t.audio.currentTime = p.pos; t.audio.volume = Math.min(1, p.gain()); t.audio.play().catch(() => {}); }
    p.last = performance.now(); p.update();
  };
  p.reset = () => { p.pause(); p.pos = 0; p.update(); };
  cv.addEventListener('click', e => { const r = cv.getBoundingClientRect(); p.seek((e.clientX - r.left) / r.width * p.track().dur); });
  $('.play', el).addEventListener('click', p.toggle);
  players.push(p); return p;
}

/* ---------- タブ（制作工程） ---------- */
function showTab(t) {
  UI.tab = t; saveUI();
  $$('.step').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  $$('.pane').forEach(p => p.hidden = p.id !== 'tab-' + t);
  players.forEach(p => p.pause()); requestAnimationFrame(redrawAll);
}
$$('.step').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

/* ---------- 1 原曲 ---------- */
const DEMOS = [{ f: '夜明けのプリズム_demo_v2_弾き語り.m4a', d: '2:41', when: '10/01', seed: 5, dur: 161 }, { f: '夜明けのプリズム_demo_v1_鼻歌.m4a', d: '1:58', when: '09/27', seed: 9, dur: 118 }];
$('#demoList').innerHTML = DEMOS.map((d, i) => `<li class="file"><span class="fn">${esc(d.f)}</span><span class="who mono">${d.d} ・ ${d.when}</span><canvas data-demo="${i}"></canvas></li>`).join('');
$('#lyrics').innerHTML = esc(LYRICS).replace(/^(\[.*\])$/gm, '<span class="mt">$1</span>');

/* ---------- 2 SUNOラボ ---------- */
const cand = id => CANDS.find(c => c.id === id) || CANDS[0];
const candSt = id => SH.cand[id] || (SH.cand[id] = { star: false, st: 'keep' });
const ST = { adopt: ['採用', 'adopt'], keep: ['候補', 'keep'], drop: ['見送り', 'drop'] };
const lab = Player($('#labPlayer'), () => { const c = cand(UI.sel); return [{ dur: c.dur, peaks: peaksOf(c, 420) }]; }, () => (SH.comments[UI.sel] || []).map(x => x.t));
function renderCands() {
  $$('#filters .chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.f === UI.filter)));
  const list = CANDS.filter(c => UI.filter === 'all' || (UI.filter === 'star' && candSt(c.id).star) || (UI.filter === 'adopt' && candSt(c.id).st === 'adopt'));
  $('#candList').innerHTML = list.length ? list.map(c => {
    const m = candSt(c.id), s = ST[m.st] || ST.keep; const n = (SH.comments[c.id] || []).length;
    return `<li class="cand${m.st === 'drop' ? ' dropped' : ''}" data-id="${c.id}" aria-current="${c.id === UI.sel}" tabindex="0">
      <span class="no">${c.no}</span><canvas data-mini="${c.id}"></canvas>
      <button class="star" data-star="${c.id}" aria-pressed="${m.star}" aria-label="お気に入り">★</button>
      <span class="sub"><span class="pill ${s[1]}">${s[0]}</span> ${esc(c.note)}${n ? ` ・ 💬${n}` : ''}</span></li>`;
  }).join('') : '<li class="note" style="padding:8px">該当する候補はありません</li>';
  requestAnimationFrame(() => $$('canvas[data-mini]').forEach(cv => drawWave(cv, peaksOf(cand(cv.dataset.mini), 90), 0)));
}
function renderLab() {
  const c = cand(UI.sel), m = candSt(c.id), s = ST[m.st] || ST.keep;
  $('#labTitle').textContent = c.no + '　' + fmt(c.dur);
  $('#labPill').innerHTML = `<span class="pill ${s[1]}">${s[0]}</span>`;
  $('#labStar').setAttribute('aria-pressed', String(m.star));
  $('#labAdopt').disabled = m.st === 'adopt'; $('#labAdopt').textContent = m.st === 'adopt' ? '採用済み' : '採用にする';
  $('#labDrop').textContent = m.st === 'drop' ? '候補に戻す' : '見送り';
  sects($('#labSects'), c.dur);
  $('#labLog').innerHTML = `<dt>スタイル</dt><dd><div class="tags">${c.style.split(', ').map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div></dd>
    <dt>歌詞</dt><dd>${c.lyr}（メタタグ付き）</dd><dt>作り方</dt><dd>${esc(c.how)}</dd>
    <dt>モデル</dt><dd class="mono">v5</dd><dt>生成日時</dt><dd class="mono">2026/${c.when}</dd>
    <dt>SUNO</dt><dd class="mono note">suno.com/song/…（サンプル）</dd>`;
  const cs = (SH.comments[c.id] || []).slice().sort((a, b) => a.t - b.t);
  $('#cmCount').textContent = cs.length + '件';
  $('#labComments').innerHTML = cs.length ? cs.map(x => `<li class="cm"><button class="ts" data-seek="${x.t}">${fmt(x.t)}</button><p>${esc(x.x)}</p><span></span><span class="who ${whoCls(x)}">${esc(whoName(x))}</span></li>`).join('') : '<li class="note">まだコメントはありません。再生して気になった位置で書き込めます。</li>';
  lab.update();
}
$('#filters').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b) return; UI.filter = b.dataset.f; saveUI(); renderCands(); });
$('#candList').addEventListener('click', e => {
  const st = e.target.closest('[data-star]'); if (st) { const m = candSt(st.dataset.star); m.star = !m.star; saveShared('cand'); renderCands(); renderLab(); return; }
  const li = e.target.closest('.cand'); if (!li || li.dataset.id === UI.sel) return; UI.sel = li.dataset.id; saveUI(); lab.reset(); renderCands(); renderLab();
});
$('#candList').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList.contains('cand')) e.target.click(); });
$('#labStar').addEventListener('click', () => { const m = candSt(UI.sel); m.star = !m.star; saveShared('cand'); renderCands(); renderLab(); });
$('#labAdopt').addEventListener('click', () => { Object.values(SH.cand).forEach(m => { if (m.st === 'adopt') m.st = 'keep'; }); candSt(UI.sel).st = 'adopt'; saveShared('cand'); renderCands(); renderLab(); toast(cand(UI.sel).no + ' を採用にしました。仕上げルームに渡ります'); });
$('#labDrop').addEventListener('click', () => { const m = candSt(UI.sel); m.st = m.st === 'drop' ? 'keep' : 'drop'; saveShared('cand'); renderCands(); renderLab(); });
$('#copyStyle').addEventListener('click', () => copy(cand(UI.sel).style, 'スタイルを'));
$('#labComments').addEventListener('click', e => { const b = e.target.closest('[data-seek]'); if (b) lab.seek(+b.dataset.seek); });
$('#labAdd').addEventListener('submit', e => {
  e.preventDefault(); const v = $('#labCmt').value.trim(); if (!v) return;
  (SH.comments[UI.sel] = SH.comments[UI.sel] || []).push({ t: Math.round(lab.pos), by: ME.uid, name: ME.name, x: v });
  saveShared('comments'); $('#labCmt').value = ''; renderLab(); renderCands(); toast(fmt(lab.pos) + ' にコメントしました');
});
$('#prompts').innerHTML = PROMPTS.map((m, i) => `<li class="memo"><div><div>${esc(m.name)}</div><code>${esc(m.text)}</code></div><button class="btn" data-prompt="${i}">コピー</button></li>`).join('');
$('#prompts').addEventListener('click', e => { const b = e.target.closest('[data-prompt]'); if (b) copy(PROMPTS[b.dataset.prompt].text, 'スタイルを'); });

/* ---------- 3 仕上げ ---------- */
const AB = [{ name: 'SUNO #07（採用版）', dur: 228, peaks: fakePeaks(77, 228, 420), lufs: -9.2 }, { name: '相方の MIX v2', dur: 228, peaks: fakePeaks(1077, 228, 420).map(v => Math.min(1, v * .86 + .04)), lufs: -11.0 }];
const ab = Player($('#abPlayer'), () => AB, () => SH.revs.filter(r => !r.done).map(r => r.t), p => {
  $$('[data-ab]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.ab === p.cur)));
  $('#abNames').textContent = 'A：' + AB[0].name + '　B：' + AB[1].name;
  const diff = Math.abs(AB[0].lufs - AB[1].lufs), loud = AB[0].lufs > AB[1].lufs ? 'A' : 'B';
  $('#matchBtn').setAttribute('aria-pressed', String(p.match));
  $('#gainNote').textContent = p.match ? `${loud} を -${diff.toFixed(1)} dB して揃えています` : `音量差 ${diff.toFixed(1)} dB（大きい方が良く聴こえやすい）`;
});
sects($('#abSects'), 228);
$$('[data-ab]').forEach(b => b.addEventListener('click', () => ab.setTrack(+b.dataset.ab)));
$('#matchBtn').addEventListener('click', () => { ab.match = !ab.match; const t = ab.track(); if (t.audio) t.audio.volume = Math.min(1, ab.gain()); ab.update(); });
$$('[data-load]').forEach(inp => inp.addEventListener('change', async () => {
  const f = inp.files[0]; if (!f) return; const i = +inp.dataset.load;
  try {
    const AC = window.AudioContext || window.webkitAudioContext; const ac = new AC(); const buf = await ac.decodeAudioData(await f.arrayBuffer());
    const ch = buf.getChannelData(0), n = 420, step = Math.floor(ch.length / n) || 1, pk = []; let sum = 0, cnt = 0;
    for (let k = 0; k < n; k++) { let mx = 0; for (let j = k * step; j < Math.min(ch.length, (k + 1) * step); j += 4) { const v = Math.abs(ch[j]); if (v > mx) mx = v; sum += v * v; cnt++; } pk.push(mx); }
    const top = Math.max(...pk) || 1; const rms = Math.sqrt(sum / Math.max(1, cnt)); ac.close && ac.close();
    const old = AB[i].audio; if (old) { old.pause(); URL.revokeObjectURL(old.src); }
    AB[i] = { name: f.name, dur: buf.duration, peaks: pk.map(v => v / top), lufs: 20 * Math.log10(rms || 1e-6), audio: new Audio(URL.createObjectURL(f)) };
    ab.pause(); ab.pos = 0; ab.update(); toast((i ? 'B' : 'A') + ' に「' + f.name + '」を読み込みました');
  } catch (err) { toast('読み込めませんでした。WAV / MP3 / M4A をお試しください'); }
  inp.value = '';
}));
function renderRevs() {
  const rs = SH.revs.map((r, i) => ({ ...r, i })).sort((a, b) => a.t - b.t); const open = rs.filter(r => !r.done).length;
  $('#revCount').textContent = `未対応 ${open} ／ 全 ${rs.length}`;
  $('#finSub').textContent = `相方のDAW ・ 未対応 ${open}件`;
  $('#revs').innerHTML = rs.map(r => `<li class="rev${r.done ? ' done' : ''}"><input type="checkbox" data-done="${r.i}" ${r.done ? 'checked' : ''} aria-label="対応済み"><button class="ts" data-seek="${r.t}">${fmt(r.t)}</button><p>${esc(r.x)}</p><span class="who ${whoCls(r)}">${esc(whoName(r))}</span></li>`).join('');
  ab.update();
}
$('#revs').addEventListener('click', e => { const b = e.target.closest('[data-seek]'); if (b) ab.seek(+b.dataset.seek); });
$('#revs').addEventListener('change', e => { const c = e.target.closest('[data-done]'); if (!c) return; SH.revs[+c.dataset.done].done = c.checked; saveShared('revs'); renderRevs(); });
$('#revAdd').addEventListener('submit', e => {
  e.preventDefault(); const v = $('#revTxt').value.trim(); if (!v) return;
  SH.revs.push({ t: Math.round(ab.pos), by: ME.uid, name: ME.name, x: v, done: false });
  saveShared('revs'); $('#revTxt').value = ''; renderRevs(); toast(fmt(ab.pos) + ' に修正指示を追加しました');
});
$('#stems').innerHTML = STEMS.map(([n, c, s], i) => `<tr><td><span class="dot" style="background:${c}"></span>${n}</td><td class="mono">夜明けのプリズム_${String(i + 1).padStart(2, '0')}_${n.replace(/ /g, '')}_128bpm.wav</td><td class="mono">3:48</td><td class="mono">48k / 24bit</td><td class="mono">${(62 + (i * 7) % 9).toFixed(0)} MB</td><td>${s === 'ok' ? '<span class="pill ok">受け渡し済</span>' : '<span class="pill wait">音が少ない・確認中</span>'}</td></tr>`).join('');
$('#zipBtn').addEventListener('click', () => toast('ステムのアップロード・ダウンロードは、次の段階で使えるようになります'));

/* ---------- 4 投稿 ---------- */
function renderChecks() {
  $('#checks').innerHTML = CHECKS.map(([g, items]) => `<div><h3>${g}</h3>${items.map(([k, l, s]) => `<label class="ck"><input type="checkbox" data-ck="${k}" ${SH.checks[k] ? 'checked' : ''}><span>${esc(l)}${s ? `<small>${esc(s)}</small>` : ''}</span></label>`).join('')}</div>`).join('');
  updChecks();
}
function updChecks() {
  const all = CHECKS.flatMap(g => g[1]).length, done = CHECKS.flatMap(g => g[1]).filter(([k]) => SH.checks[k]).length;
  $('#ckNum').textContent = done + '/' + all; $('#ckBar').style.width = (done / all * 100) + '%'; $('#pubSub').textContent = `チェック ${done}/${all}`;
}
$('#checks').addEventListener('change', e => { const c = e.target.closest('[data-ck]'); if (!c) return; SH.checks[c.dataset.ck] = c.checked; saveShared('checks'); updChecks(); });
$('#credit').addEventListener('input', e => { SH.credit = e.target.value; saveShared('credit'); });
const days = Math.ceil((new Date(2026, 10, 20, 20, 0) - new Date()) / 864e5);
$('#days').textContent = days > 0 ? days : '公開済み'; $('#dl').textContent = '投稿まで ' + Math.max(0, days) + '日';
$$('[data-copy]').forEach(b => b.addEventListener('click', () => b.dataset.copy === 'lyrics' ? copy(LYRICS, '歌詞を') : copy($('#credit').value, 'クレジットを')));

function renderShared() { renderCands(); renderLab(); renderRevs(); renderChecks(); if (document.activeElement !== $('#credit')) $('#credit').value = SH.credit; }

/* =====================================================================
   パネル（チャット・メモ帳）の開閉
===================================================================== */
const panelOpen = { chat: false, memo: false };
function setPanel(name, open) {
  if (open) Object.keys(panelOpen).forEach(k => { if (k !== name && panelOpen[k]) setPanel(k, false); });
  panelOpen[name] = open;
  $('#' + name).classList.toggle('open', open);
  $('#' + name + 'Btn').setAttribute('aria-expanded', String(open));
  if (name === 'chat' && open) { renderChat(); markRead(); setTimeout(() => $('#chatIn').focus(), 260); }
  if (name === 'memo' && open) { if (UI.memoMode !== 'local') { flushMemo(); UI.memoMode = 'local'; } $('#memoSearch').value = ''; renderMemoList(); renderMemoEditor(true); }
  if (!open) $('#' + name + 'Btn').focus();
}
$('#chatBtn').addEventListener('click', () => setPanel('chat', !panelOpen.chat));
$('#memoBtn').addEventListener('click', () => setPanel('memo', !panelOpen.memo));
$('#chatClose').addEventListener('click', () => setPanel('chat', false));
$('#memoClose').addEventListener('click', () => setPanel('memo', false));
function applyWide() {
  ['chat', 'memo'].forEach(k => {
    const w = !!UI.wide[k], b = $(`[data-wide="${k}"]`); $('#' + k).classList.toggle('wide', w);
    b.textContent = w ? '⤡' : '⤢'; b.setAttribute('aria-label', w ? '元の大きさに戻す' : '画面いっぱいに表示'); b.title = b.getAttribute('aria-label');
  });
  const cb = $('#chatBody'); cb.scrollTop = cb.scrollHeight;
}
$$('[data-wide]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.wide; UI.wide[k] = !UI.wide[k]; saveUI(); applyWide(); }));
applyWide();

/* ---------- チャットの「窓」表示（移動・サイズ変更） ---------- */
const CW_MIN = { w: 320, h: 360 };
const isNarrow = () => window.innerWidth <= 720;
function chatWin() {
  const d = UI.chatWin || {};
  const w = Math.max(CW_MIN.w, Math.min(d.w || 420, window.innerWidth - 16));
  const h = Math.max(CW_MIN.h, Math.min(d.h || 620, window.innerHeight - 16));
  const x = Math.max(8, Math.min(d.x ?? (window.innerWidth - w - 24), window.innerWidth - w - 8));
  const y = Math.max(8, Math.min(d.y ?? 80, window.innerHeight - h - 8));
  return { float: !!d.float, x, y, w, h };
}
function applyChatWin() {
  const c = $('#chat'), g = chatWin(), b = $('#chatFloat');
  c.classList.toggle('float', g.float);
  b.setAttribute('aria-pressed', String(g.float));
  b.setAttribute('aria-label', g.float ? '右側に固定する' : '自由に動かせる窓にする'); b.title = b.getAttribute('aria-label');
  if (g.float) Object.assign(c.style, { left: g.x + 'px', top: g.y + 'px', width: g.w + 'px', height: g.h + 'px' });
  else ['left', 'top', 'width', 'height'].forEach(k => c.style[k] = '');
}
function saveChatWin(p) { UI.chatWin = { ...(UI.chatWin || {}), ...p }; saveUI(); }
$('#chatFloat').addEventListener('click', () => { const g = chatWin(); saveChatWin({ float: !g.float, x: g.x, y: g.y, w: g.w, h: g.h }); applyChatWin(); });
// つかんで動かす（上部のタイトル部分）・右下の角でサイズ変更
const CSS_KEY = { x: 'left', y: 'top', w: 'width', h: 'height' };
function dragOn(handle, onMove) {
  handle.addEventListener('pointerdown', e => {
    if (!$('#chat').classList.contains('float') || isNarrow() || e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault(); const g = chatWin(), sx = e.clientX, sy = e.clientY, c = $('#chat'); let last = null;
    c.classList.add('dragging'); handle.setPointerCapture(e.pointerId);
    const move = ev => { last = onMove(g, ev.clientX - sx, ev.clientY - sy); Object.entries(last).forEach(([k, v]) => { c.style[CSS_KEY[k]] = v + 'px'; }); };
    const up = () => {
      handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up);
      c.classList.remove('dragging'); if (last) { saveChatWin(last); applyChatWin(); }
    };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
  });
}
dragOn($('#chat .chd'), (g, dx, dy) => ({
  x: Math.max(8, Math.min(g.x + dx, window.innerWidth - g.w - 8)),
  y: Math.max(8, Math.min(g.y + dy, window.innerHeight - 60))
}));
dragOn($('#chatRsz'), (g, dx, dy) => ({
  w: Math.max(CW_MIN.w, Math.min(g.w + dx, window.innerWidth - g.x - 8)),
  h: Math.max(CW_MIN.h, Math.min(g.h + dy, window.innerHeight - g.y - 8))
}));
// 窓の上部をダブルクリックすると、元の位置・大きさに戻す
$('#chat .chd').addEventListener('dblclick', e => {
  if (e.target.closest('button') || !$('#chat').classList.contains('float')) return;
  saveChatWin({ x: undefined, y: undefined, w: undefined, h: undefined }); applyChatWin();
});
window.addEventListener('resize', () => { if ($('#chat').classList.contains('float')) applyChatWin(); });
applyChatWin();

/* =====================================================================
   チャット
===================================================================== */
const TABN = { orig: '原曲ボックス', lab: 'SUNOラボ', fin: '仕上げルーム', pub: '投稿準備' };
const TABC = { orig: 'var(--p1)', lab: 'var(--p2)', fin: 'var(--p3)', pub: 'var(--p4)' };
let CHAT = [], READS = { mine: 0, others: 0 }, pendRef = null;
function refInfo(r) {
  if (r.k === 'cand') return { c: TABC.lab, l: `${cand(r.id).no} ▶ ${fmt(r.t)}` };
  if (r.k === 'ab') return { c: TABC.fin, l: `${r.tr ? 'B' : 'A'}：${r.name || (r.tr ? 'MIX v2' : 'SUNO #07')} ▶ ${fmt(r.t)}` };
  return { c: TABC[r.tab] || 'var(--mute)', l: TABN[r.tab] || '' };
}
const refHtml = (r, id) => { const f = refInfo(r); return `<button type="button" class="ref" data-ref="${esc(id)}"><i style="background:${f.c}"></i><span>${esc(f.l)}</span></button>`; };
function renderChat() {
  let last = '', html = '';
  if (!CHAT.length) html = '<div class="empty">まだメッセージはありません。最初のひとことを送ってみましょう。</div>';
  CHAT.forEach(m => {
    const d = dayOf(m.at); if (d !== last) { html += `<div class="day">${d}</div>`; last = d; }
    const mine = m.uid === ME.uid, cls = mine ? 'me' : 'pt', ini = esc((m.name || '?').slice(0, 1));
    const read = mine && READS.others >= m.at ? '<span>既読</span>' : '';
    html += `<div class="msg ${cls}"><span class="av ${cls}" title="${esc(m.name)}">${ini}</span><div class="bub">${mine ? '' : `<div class="nm2">${esc(m.name)}</div>`}${esc(m.x)}${m.ref ? '<br>' + refHtml(m.ref, m.id) : ''}</div><span class="mt2">${read}<span>${hmOf(m.at)}</span></span></div>`;
  });
  const b = $('#chatBody'); const atBottom = b.scrollHeight - b.scrollTop - b.clientHeight < 80;
  b.innerHTML = html; if (atBottom || !renderChat.done) b.scrollTop = b.scrollHeight; renderChat.done = true;
  updBadge();
}
function updBadge() { const un = CHAT.filter(m => m.uid !== ME.uid && m.at > READS.mine).length; $('#badge').hidden = !un; $('#badge').textContent = un > 99 ? '99+' : un; }
function markRead() { if (!store || !CHAT.length) return; const last = CHAT[CHAT.length - 1]; if (last.at > READS.mine) { READS.mine = last.at; updBadge(); Promise.resolve(store.markRead()).catch(() => {}); } }
function renderPend() { const p = $('#pend'); p.hidden = !pendRef; p.innerHTML = pendRef ? `添付：${refHtml(pendRef, '')}<button type="button" class="rm" aria-label="添付を外す">×</button>` : ''; }
function openRef(r) {
  if (r.k === 'cand') { showTab('lab'); if (UI.sel !== r.id) { UI.sel = r.id; saveUI(); renderCands(); renderLab(); } lab.seek(r.t); }
  else if (r.k === 'ab') { showTab('fin'); ab.setTrack(r.tr); ab.seek(r.t); }
  else if (r.tab) showTab(r.tab);
  if (window.innerWidth < 760) setPanel('chat', false);
}
$('#attach').addEventListener('click', () => {
  if (UI.tab === 'lab') pendRef = { k: 'cand', id: UI.sel, t: Math.round(lab.pos) };
  else if (UI.tab === 'fin') pendRef = { k: 'ab', tr: ab.cur, t: Math.round(ab.pos), name: AB[ab.cur].name };
  else pendRef = { k: 'tab', tab: UI.tab };
  renderPend(); $('#chatIn').focus();
});
$('#pend').addEventListener('click', e => { if (e.target.closest('.rm')) { pendRef = null; renderPend(); } });
$('#chatBody').addEventListener('click', e => { const b = e.target.closest('[data-ref]'); if (!b) return; const m = CHAT.find(x => x.id === b.dataset.ref); if (m && m.ref) openRef(m.ref); });
$('#chatIn').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#chatForm').requestSubmit(); } });
$('#chatIn').addEventListener('input', e => { const t = e.target; t.style.height = '44px'; t.style.height = Math.min(160, t.scrollHeight) + 'px'; });
$('#chatForm').addEventListener('submit', async e => {
  e.preventDefault(); const v = $('#chatIn').value.trim(); if (!v && !pendRef) return; if (!store) return;
  const msg = { x: v || '（位置を共有しました）', ref: pendRef || null };
  const t = $('#chatIn'); t.value = ''; t.style.height = '44px'; pendRef = null; renderPend();
  try { await store.sendChat(msg); setTimeout(markRead, 600); }
  catch (err) { t.value = msg.x; toast('送信できませんでした。通信状況を確認してください'); }
});

/* =====================================================================
   メモ帳（共有メモ ／ 自分だけのメモ）— 何個でも追加できる
===================================================================== */
const LOCAL_MEMO_KEY = 'futari-studio-local-memos';
const localMemos = {
  load() {
    let list = LS.get(LOCAL_MEMO_KEY, null);
    if (!list) {   // 以前の「自分だけのメモ」（1枚だけの版）を引き継ぐ
      list = []; const old = LS.get('futari-studio-local-memo', null);
      if (old && old.x) list.push({ id: newId(), title: '自分だけのメモ', body: old.x, pinned: false, updatedAt: Date.now() });
      LS.set(LOCAL_MEMO_KEY, list);
    }
    return list;
  },
  save(list) { return LS.set(LOCAL_MEMO_KEY, list); }
};
let SHARED_MEMOS = [], LOCAL_MEMOS = localMemos.load();
const memoSel = { shared: null, local: null };
let memoDirty = false, memoTimer = 0, delArmed = 0;
const sortM = list => list.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
const curList = () => UI.memoMode === 'shared' ? SHARED_MEMOS : sortM(LOCAL_MEMOS);
const curMemo = () => curList().find(m => m.id === memoSel[UI.memoMode]) || null;
const MNOTE = {
  shared: () => store && store.mode === 'firebase'
    ? '<b>メンバー全員で共有</b>されます。決まったこと・次にやること・アイデアなどをどうぞ。'
    : '<b>共有メモ</b>です。※ 今はローカルモードなので、このブラウザの中にだけ保存されます。',
  local: () => '<b>このパソコンのブラウザだけに保存</b>されます。相方さんには見えません。'
};
function renderMemoList() {
  const mode = UI.memoMode; $('#memo').dataset.m = mode;
  $$('.mtabs [data-m]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.m === mode)));
  $('#mNote').innerHTML = MNOTE[mode]();
  const q = $('#memoSearch').value.trim().toLowerCase();
  const list = curList().filter(m => !q || (m.title + '\n' + m.body).toLowerCase().includes(q));
  $('#memoCountAll').textContent = curList().length + '件';
  $('#memoList').innerHTML = list.length ? list.map(m => {
    const snip = (m.body || '').replace(/\s+/g, ' ').slice(0, 60);
    return `<li><button class="mitem" data-id="${esc(m.id)}" aria-current="${m.id === memoSel[mode]}">
      <span class="mt3">${m.pinned ? '<i class="pin" aria-label="ピン留め">📌</i>' : ''}${esc(m.title || '無題のメモ')}</span>
      <span class="ms">${esc(snip) || '（本文なし）'}</span>
      <span class="mw">${whenOf(m.updatedAt)}${mode === 'shared' && m.updatedBy ? ' ・ ' + esc(m.updatedBy) : ''}</span></button></li>`;
  }).join('') : `<li class="empty">${q ? '見つかりませんでした' : 'まだメモがありません。「＋ 新しいメモ」から作れます。'}</li>`;
  renderMemoEditor();
}
function renderMemoEditor(force) {
  const m = curMemo(), has = !!m;
  $('#memoEmpty').hidden = has; $('#medit').classList.toggle('none', !has);
  $$('#medit .need').forEach(el => el.hidden = !has);
  if (!has) { $('#mbody').dataset.view = 'list'; return; }
  const editing = document.activeElement === $('#memoTx') || document.activeElement === $('#memoTitle');
  if (force || !editing || !memoDirty) {
    if (force || document.activeElement !== $('#memoTitle')) $('#memoTitle').value = m.title || '';
    if (force || document.activeElement !== $('#memoTx')) $('#memoTx').value = m.body || '';
  }
  $('#mBand').innerHTML = UI.memoMode === 'shared'
    ? '👥 共有メモを編集中 <small>メンバー全員に見えます</small>'
    : '🔒 自分だけのメモ <small>このパソコンだけに保存・相方さんには見えません</small>';
  $('#memoPin').setAttribute('aria-pressed', String(!!m.pinned));
  $('#memoWho').textContent = '最終更新：' + whenOf(m.updatedAt) + (UI.memoMode === 'shared' && m.updatedBy ? ' ・ ' + m.updatedBy : '');
  $('#memoCount').textContent = $('#memoTx').value.length + ' 文字';
  disarmDel();
}
function selectMemo(id) {
  flushMemo(); memoSel[UI.memoMode] = id; $('#mbody').dataset.view = 'edit';
  renderMemoList(); renderMemoEditor(true); setTimeout(() => $('#memoTx').focus(), 0);
}
async function newMemo() {
  flushMemo();
  if (UI.memoMode === 'local') {
    const m = { id: newId(), title: '', body: '', pinned: false, updatedAt: Date.now() };
    LOCAL_MEMOS.push(m); localMemos.save(LOCAL_MEMOS); memoSel.local = m.id;
  } else {
    try { memoSel.shared = await store.saveMemo(null, { title: '', body: '' }); }
    catch (e) { toast('メモを作成できませんでした'); return; }
  }
  $('#memoSearch').value = ''; $('#mbody').dataset.view = 'edit'; renderMemoList(); renderMemoEditor(true);
  setTimeout(() => $('#memoTitle').focus(), 0);
}
async function writeMemo(id, data, mode) {
  if (mode === 'local') {
    const m = LOCAL_MEMOS.find(x => x.id === id); if (!m) return true;
    Object.assign(m, data, { updatedAt: Date.now() }); return localMemos.save(LOCAL_MEMOS);
  }
  try { await store.saveMemo(id, data); return true; } catch (e) { return false; }
}
function queueMemoSave() {
  memoDirty = true; $('#memoSaved').textContent = '入力中…'; clearTimeout(memoTimer);
  memoTimer = setTimeout(flushMemo, 700);
}
async function flushMemo() {
  clearTimeout(memoTimer); if (!memoDirty) return; memoDirty = false;
  const mode = UI.memoMode, id = memoSel[mode]; if (!id) return;
  const ok = await writeMemo(id, { title: $('#memoTitle').value, body: $('#memoTx').value }, mode);
  $('#memoSaved').textContent = ok ? '保存しました ' + hmOf(Date.now()) : '保存できませんでした';
  if (mode === 'local') renderMemoList();
}
function disarmDel() { delArmed = 0; const b = $('#memoDel'); b.textContent = '削除'; b.classList.remove('armed'); }
$('#memoDel').addEventListener('click', async () => {
  const b = $('#memoDel');
  if (!delArmed) { delArmed = setTimeout(disarmDel, 4000); b.textContent = 'もう一度押すと削除'; b.classList.add('armed'); return; }
  clearTimeout(delArmed); disarmDel();
  const mode = UI.memoMode, id = memoSel[mode]; memoDirty = false; clearTimeout(memoTimer);
  if (mode === 'local') { LOCAL_MEMOS = LOCAL_MEMOS.filter(m => m.id !== id); localMemos.save(LOCAL_MEMOS); }
  else { try { await store.deleteMemo(id); } catch (e) { toast('削除できませんでした'); return; } }
  memoSel[mode] = null; $('#mbody').dataset.view = 'list'; renderMemoList(); toast('メモを削除しました');
});
$('#memoPin').addEventListener('click', async () => {
  const m = curMemo(); if (!m) return; await flushMemo();
  const ok = await writeMemo(m.id, { pinned: !m.pinned }, UI.memoMode);
  if (!ok) toast('保存できませんでした'); renderMemoList();
});
$('#memoNew').addEventListener('click', newMemo);
$('#memoList').addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (b) selectMemo(b.dataset.id); });
$('#memoSearch').addEventListener('input', renderMemoList);
$('#memoTitle').addEventListener('input', queueMemoSave);
$('#memoTx').addEventListener('input', () => { $('#memoCount').textContent = $('#memoTx').value.length + ' 文字'; queueMemoSave(); });
$('#memoTitle').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $('#memoTx').focus(); } });
$('#memoBack').addEventListener('click', () => { flushMemo(); $('#mbody').dataset.view = 'list'; });
$('#memoCopy').addEventListener('click', () => copy(($('#memoTitle').value ? $('#memoTitle').value + '\n\n' : '') + $('#memoTx').value, 'メモを'));
function switchMemoMode(mode) { flushMemo(); UI.memoMode = mode; $('#memoSearch').value = ''; renderMemoList(); renderMemoEditor(true); }
$$('.mtabs [data-m]').forEach(b => b.addEventListener('click', () => {
  const mode = b.dataset.m; if (mode === UI.memoMode) return;
  if (mode === 'shared') { $('#shareConfirm').hidden = false; setTimeout(() => $('#scCancel').focus(), 0); return; }   // 共有へ切り替える前に確認
  switchMemoMode(mode);
}));
$('#scOk').addEventListener('click', () => { $('#shareConfirm').hidden = true; switchMemoMode('shared'); });
$('#scCancel').addEventListener('click', () => { $('#shareConfirm').hidden = true; $('.mtabs [data-m="local"]').focus(); });
$('#shareConfirm').addEventListener('click', e => { if (e.target.id === 'shareConfirm') $('#scCancel').click(); });
window.addEventListener('beforeunload', () => { if (memoDirty) flushMemo(); });
window.addEventListener('storage', e => { if (e.key === LOCAL_MEMO_KEY) { LOCAL_MEMOS = localMemos.load(); if (panelOpen.memo) renderMemoList(); } });

/* =====================================================================
   ログイン・メンバー管理
===================================================================== */
function showGate(kind, user) {
  const g = $('#gate'); g.hidden = !kind; if (!kind) return;
  const T = {
    loading: ['読み込み中…', '少しお待ちください。', false, false],
    signedOut: ['ログイン', '2人だけの制作スタジオです。Googleアカウントでログインしてください。', true, false],
    notMember: ['このアカウントはまだメンバーではありません', `ログイン中：${user && user.email || ''}\nオーナーに、このメールアドレスを「メンバー管理」に追加してもらってください。`, false, true],
    error: ['接続できませんでした', '通信状況を確認して、ページを再読み込みしてください。Firebaseの設定（firebase-config.js・セキュリティルール）も確認してください。', false, true]
  }[kind];
  $('#gateTitle').textContent = T[0]; $('#gateMsg').textContent = T[1];
  $('#gateLogin').hidden = !T[2]; $('#gateLogout').hidden = !T[3];
}
$('#gateLogin').addEventListener('click', async () => {
  try { await store.signIn(); }
  catch (e) { if (e && e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') toast('ログインできませんでした（' + (e.code || 'エラー') + '）'); }
});
$('#gateLogout').addEventListener('click', () => store.signOut());
$('#logoutBtn').addEventListener('click', () => { $('#userMenu').hidden = true; store.signOut(); });
$('#userBtn').addEventListener('click', e => { e.stopPropagation(); const m = $('#userMenu'); m.hidden = !m.hidden; $('#userBtn').setAttribute('aria-expanded', String(!m.hidden)); });
document.addEventListener('click', e => { if (!e.target.closest('.user')) { $('#userMenu').hidden = true; $('#userBtn').setAttribute('aria-expanded', 'false'); } });

let MEMBERS = { members: [], owner: '' };
function renderMembers() {
  $('#memList').innerHTML = (MEMBERS.members || []).map(em => `<li class="mem"><span>${esc(em)}</span>${em === MEMBERS.owner ? '<span class="pill keep">オーナー</span>' : `<button class="btn" data-rm="${esc(em)}">外す</button>`}</li>`).join('');
}
$('#membersBtn').addEventListener('click', () => { $('#userMenu').hidden = true; renderMembers(); $('#members').hidden = false; setTimeout(() => $('#memEmail').focus(), 0); });
$('#memClose').addEventListener('click', () => { $('#members').hidden = true; });
$('#memAdd').addEventListener('submit', async e => {
  e.preventDefault(); const em = $('#memEmail').value.trim().toLowerCase(); if (!em) return;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { toast('メールアドレスの形式を確認してください'); return; }
  const list = MEMBERS.members || []; if (list.includes(em)) { toast('すでに登録されています'); return; }
  try { await store.setMembers([...list, em]); $('#memEmail').value = ''; toast(em + ' を追加しました'); } catch (err) { toast('追加できませんでした（オーナーだけが変更できます）'); }
});
$('#memList').addEventListener('click', async e => {
  const b = e.target.closest('[data-rm]'); if (!b) return;
  if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'もう一度押すと外す'; return; }
  try { await store.setMembers((MEMBERS.members || []).filter(x => x !== b.dataset.rm)); toast('メンバーから外しました'); } catch (err) { toast('変更できませんでした'); }
});

/* ---------- キーボード ---------- */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!$('#shareConfirm').hidden) { $('#scCancel').click(); return; }
    if (!$('#members').hidden) { $('#members').hidden = true; return; }
    if (panelOpen.chat) setPanel('chat', false); else if (panelOpen.memo) setPanel('memo', false);
    return;
  }
  if (e.target.closest('input,textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const p = UI.tab === 'lab' ? lab : UI.tab === 'fin' ? ab : null;
  if (e.code === 'Space' && p && !e.target.closest('button')) { e.preventDefault(); p.toggle(); }
  else if (UI.tab === 'fin' && (e.key === 'a' || e.key === 'A')) ab.setTrack(0);
  else if (UI.tab === 'fin' && (e.key === 'b' || e.key === 'B')) ab.setTrack(1);
  else if (e.key === 'm' || e.key === 'M') { if (UI.tab === 'lab') { e.preventDefault(); $('#labCmt').focus(); } else if (UI.tab === 'fin') { e.preventDefault(); $('#revTxt').focus(); } }
});

function redrawAll() {
  $$('canvas[data-demo]').forEach(cv => { const d = DEMOS[+cv.dataset.demo]; drawWave(cv, fakePeaks(d.seed, d.dur, 140).map(v => v * .7), 0); });
  $$('canvas[data-mini]').forEach(cv => drawWave(cv, peaksOf(cand(cv.dataset.mini), 90), 0));
  players.forEach(p => p.update());
}
let rz; window.addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(redrawAll); });

/* =====================================================================
   起動
===================================================================== */
renderShared(); showTab(UI.tab || 'lab');
if (document.fonts && document.fonts.ready) document.fonts.ready.then(redrawAll);

let subs = [];
function setMode(mode) {
  const c = $('#modeChip');
  c.className = 'mode ' + (mode === 'firebase' ? 'sync' : 'local');
  c.textContent = mode === 'firebase' ? '同期中' : 'ローカルモード';
  c.title = mode === 'firebase' ? 'メンバー全員とデータを共有しています' : 'Firebase未設定のため、このブラウザの中にだけ保存しています';
}
function start(st) {
  ME = st.user; AUTH = { isOwner: !!st.isOwner };
  $('#userName').textContent = ME.name; $('#userAv').textContent = (ME.name || '?').slice(0, 1);
  $('#userEmail').textContent = ME.email || 'ローカルモード（ログインなし）';
  $('#membersBtn').hidden = !AUTH.isOwner; $('#logoutBtn').hidden = store.mode !== 'firebase';
  subs.forEach(f => { try { f(); } catch (e) {} }); subs = [];
  subs.push(store.onState((data, local) => {
    if (local || !data) { if (!data && store.mode === 'firebase') renderShared(); return; }
    SHARED_KEYS.forEach(k => { if (data[k] !== undefined && pendingPatch[k] === undefined) SH[k] = data[k]; });
    renderShared();
  }));
  subs.push(store.onChat(list => {
    const before = CHAT.length ? CHAT[CHAT.length - 1].id : null; CHAT = list;
    const last = list[list.length - 1];
    if (last && last.id !== before && last.uid !== ME.uid && renderChat.done && !panelOpen.chat) toast((last.name || '相方') + '：' + last.x.slice(0, 30));
    renderChat(); if (panelOpen.chat && document.visibilityState === 'visible') markRead();
  }));
  subs.push(store.onReads(r => { READS = r; renderChat(); }));
  subs.push(store.onMemos(list => {
    SHARED_MEMOS = list;
    if (memoSel.shared && !list.find(m => m.id === memoSel.shared)) memoSel.shared = null;
    if (panelOpen.memo && UI.memoMode === 'shared') renderMemoList();
  }));
  subs.push(store.onMembers(d => {
    MEMBERS = d; renderMembers();
    const others = (d.members || []).filter(x => x !== ME.email).length;
    $('#chatWho').textContent = others ? `メンバー ${others + 1}人` : 'まだあなただけです（メンバー管理から相方さんを追加できます）';
  }));
  if (store.mode === 'local') $('#chatWho').textContent = 'ローカルモード（このブラウザだけ）';
  showGate(null);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && panelOpen.chat) markRead(); });

(async () => {
  try {
    store = await createStore(window.FUTARI_FIREBASE, SEED);
  } catch (e) {
    showGate('error'); console.error(e); return;
  }
  setMode(store.mode);
  store.onAuth(st => {
    if (st.status === 'ready') start(st);
    else {
      subs.forEach(f => { try { f(); } catch (e) {} }); subs = [];
      showGate(st.status, st.user);
      if (st.status === 'error') console.error(st.error);
    }
  });
})();
