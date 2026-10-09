// =====================================================================
//  stems.js — SUNOの一式（Stems ZIP・MIDI ZIP・WAV）を読み込んで、
//             パートごとに同時再生（ミュート・ソロ・音量）する「ステムミキサー」
//   ・ロリポップへのアップロード（api/upload.php）と、保存した曲の読み込み（api/file.php）
//   ・ミックスの状態の自動保存、バランス案、今のバランスでのWAV書き出し
// =====================================================================
const JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
const API = 'api/';
const CHUNK = 4 * 1048576;          // アップロードは4MBずつ
const AUDIO_CACHE = 'futari-audio-v1';

// パートの種類（ファイル名から自動で振り分け）
export const PARTS = [
  { key: 'mix', label: '曲全体（ミックス）', color: '#E7E9EF' },
  { key: 'lead', label: 'Lead Vocals', color: '#F2A93B', re: /lead\s*vocals?|^vocals?$|^vox$|^voice$/ },
  { key: 'back', label: 'Backing Vocals', color: '#F2C46B', re: /backing\s*vocals?|back\s*vocals?|harmony|chorus\s*vocals?|bgv/ },
  { key: 'drums', label: 'Drums', color: '#F06B6B', re: /drums?/ },
  { key: 'bass', label: 'Bass', color: '#5B8DEF', re: /bass/ },
  { key: 'guitar', label: 'Guitar', color: '#3CC98E', re: /guitars?|gtr/ },
  { key: 'keys', label: 'Keyboard', color: '#A78BFA', re: /keyboards?|keys|piano/ },
  { key: 'perc', label: 'Percussion', color: '#E87A9A', re: /percussion|perc/ },
  { key: 'synth', label: 'Synth', color: '#6BB8F2', re: /synth|pad/ },
  { key: 'strings', label: 'Strings', color: '#C9A7FA', re: /strings?|violin|cello/ },
  { key: 'brass', label: 'Brass', color: '#E39B5B', re: /brass|trumpet|horn/ },
  { key: 'wind', label: 'Woodwinds', color: '#7FC9B8', re: /woodwinds?|flute|sax/ },
  { key: 'fx', label: 'FX', color: '#B8BCC8', re: /^fx$|effects?|sfx/ },
  { key: 'other', label: 'Other', color: '#8B91A1', re: /^other$|others/ },
  { key: 'inst', label: 'Instrumental', color: '#9AA3B5', re: /instrumental|^inst$|karaoke/ }
];
const partOf = k => PARTS.find(p => p.key === k) || PARTS[PARTS.length - 1];
const AUDIO_EXT = /\.(wav|wave|mp3|m4a|aac|flac|ogg|aif|aiff)$/i;
const MIDI_EXT = /\.(mid|midi)$/i;
const ZIP_EXT = /\.zip$/i;
const WAV_EXT = /\.(wav|wave)$/i;

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const mb = n => (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
const rid = (n = 12) => { const a = 'abcdefghijklmnopqrstuvwxyz0123456789'; let s = ''; const r = crypto.getRandomValues(new Uint8Array(n)); r.forEach(x => s += a[x % 36]); return s; };
const extOf = name => (name.match(/\.([A-Za-z0-9]{2,5})$/) || [, 'bin'])[1].toLowerCase();
const day = t => { const d = new Date(t || Date.now()); return `${d.getMonth() + 1}/${d.getDate()}`; };

/* ---------- ファイル名から「曲名・BPM・パート」を読み取る ---------- */
// 例： "0 Lead Vocals.wav" → lead ／ "Produce (Bass).mid" → bass ／ "Produce.wav" → mix
export function detectPart(fileName) {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').trim();
  const paren = base.match(/\(([^)]+)\)\s*$/);
  const s = (paren ? paren[1] : base).replace(/^[0-9]+[\s._-]+/, '').trim().toLowerCase();
  for (const p of PARTS) if (p.re && p.re.test(s)) return p.key;
  return 'mix';
}
// 例： "Produce Stems (137BPM)" → { title: "Produce", bpm: 137 }
export function detectTitle(name) {
  const base = name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  const bpm = (base.match(/([0-9]{2,3})\s*bpm/i) || [])[1];
  const title = base.replace(/\(\s*[0-9]{2,3}\s*bpm\s*\)/i, '').replace(/\b(stems?|midi)\b/ig, '').replace(/\(([^)]*)\)\s*$/, '').replace(/\s+/g, ' ').trim();
  return { title, bpm: bpm ? +bpm : null };
}

/* ---------- WAVのヘッダー・波形・PCMを、メモリを使いすぎずに読む ---------- */
async function readBytes(blob, off, len) { return new DataView(await blob.slice(off, off + len).arrayBuffer()); }
const str4 = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
async function wavInfo(blob) {
  if (!blob || blob.size < 44) return null;
  const h = await readBytes(blob, 0, 12);
  if (str4(h, 0) !== 'RIFF' || str4(h, 8) !== 'WAVE') return null;
  let p = 12, fmtc = null, data = null;
  for (let i = 0; i < 64 && p + 8 <= blob.size; i++) {
    const c = await readBytes(blob, p, 8), id = str4(c, 0), size = c.getUint32(4, true);
    if (id === 'fmt ') {
      const f = await readBytes(blob, p + 8, Math.min(size, 40));
      let format = f.getUint16(0, true);
      if (format === 0xFFFE && size >= 26) format = f.getUint16(24, true);   // WAVE_FORMAT_EXTENSIBLE
      fmtc = { format, ch: f.getUint16(2, true), sr: f.getUint32(4, true), align: f.getUint16(12, true), bits: f.getUint16(14, true) };
    } else if (id === 'data') { data = { off: p + 8, len: Math.min(size, blob.size - p - 8) }; break; }
    p += 8 + size + (size % 2);
  }
  if (!fmtc || !data || !fmtc.align) return null;
  return { ...fmtc, ...data, frames: Math.floor(data.len / fmtc.align) };
}
function sampleReader(w) {   // 1サンプルを -1〜1 の数値で読む
  if (w.format === 3) return w.bits === 64 ? (dv, o) => dv.getFloat64(o, true) : (dv, o) => dv.getFloat32(o, true);
  if (w.bits === 16) return (dv, o) => dv.getInt16(o, true) / 32768;
  if (w.bits === 24) return (dv, o) => { let v = dv.getUint8(o) | dv.getUint8(o + 1) << 8 | dv.getUint8(o + 2) << 16; if (v & 0x800000) v -= 0x1000000; return v / 8388608; };
  if (w.bits === 32) return (dv, o) => dv.getInt32(o, true) / 2147483648;
  if (w.bits === 8) return (dv, o) => (dv.getUint8(o) - 128) / 128;
  return () => 0;
}
async function wavPeaks(blob, w, n = 600) {
  const read = sampleReader(w), peaks = new Float32Array(n), perBin = w.frames / n, bps = w.bits / 8;
  const CHUNK_FRAMES = Math.max(1, Math.floor(8 * 1048576 / w.align)), STEP = 6;
  let max = 0;
  for (let f0 = 0; f0 < w.frames; f0 += CHUNK_FRAMES) {
    const nf = Math.min(CHUNK_FRAMES, w.frames - f0);
    const dv = await readBytes(blob, w.off + f0 * w.align, nf * w.align);
    for (let f = 0; f < nf; f += STEP) {
      let v = 0;
      for (let c = 0; c < w.ch; c++) { const a = Math.abs(read(dv, f * w.align + c * bps)); if (a > v) v = a; }
      const b = Math.min(n - 1, Math.floor((f0 + f) / perBin)); if (v > peaks[b]) peaks[b] = v;
      if (v > max) max = v;
    }
  }
  return { peaks, max };
}
async function decodePeaks(blob, n = 600) {   // WAV以外（MP3など）
  const AC = window.AudioContext || window.webkitAudioContext, ac = new AC();
  try {
    const buf = await ac.decodeAudioData(await blob.arrayBuffer());
    const ch = buf.getChannelData(0), per = ch.length / n, peaks = new Float32Array(n); let max = 0;
    for (let i = 0; i < ch.length; i += 8) { const v = Math.abs(ch[i]), b = Math.min(n - 1, Math.floor(i / per)); if (v > peaks[b]) peaks[b] = v; if (v > max) max = v; }
    return { peaks, max, dur: buf.duration, sr: buf.sampleRate, ch: buf.numberOfChannels };
  } finally { ac.close && ac.close(); }
}
// 波形を Firestore に保存するための変換（600個の数値 → 文字列）
const packPeaks = p => { const u = new Uint8Array(p.length); p.forEach((v, i) => u[i] = Math.round(Math.min(1, v) * 255)); let s = ''; u.forEach(b => s += String.fromCharCode(b)); return btoa(s); };
const unpackPeaks = s => { if (!s) return new Float32Array(600); const b = atob(s), f = new Float32Array(b.length); for (let i = 0; i < b.length; i++) f[i] = b.charCodeAt(i) / 255; return f; };

/* ---------- ZIP・フォルダ・ファイルを、ばらばらのファイル一覧にする ---------- */
let jszipLoading = null;
function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return jszipLoading || (jszipLoading = new Promise((ok, ng) => {
    const s = document.createElement('script'); s.src = JSZIP_URL; s.onload = () => ok(window.JSZip); s.onerror = () => { jszipLoading = null; ng(new Error('ZIPを開く部品を読み込めませんでした')); };
    document.head.appendChild(s);
  }));
}
async function expand(items, progress) {   // items: [{ name, path, blob }]
  const out = [];
  for (const it of items) {
    if (ZIP_EXT.test(it.name)) {
      progress(`ZIPを開いています：${it.name}`);
      const JSZip = await loadJSZip(), zip = await JSZip.loadAsync(it.blob);
      const entries = Object.values(zip.files).filter(e => !e.dir && !/(^|\/)(__MACOSX|\.)/.test(e.name));
      for (const e of entries) {
        const name = e.name.replace(/^.*\//, '');
        if (!AUDIO_EXT.test(name) && !MIDI_EXT.test(name)) continue;
        progress(`取り出しています：${name}`);
        out.push({ name, path: it.name + '/' + e.name, blob: await e.async('blob') });
      }
    } else if (AUDIO_EXT.test(it.name) || MIDI_EXT.test(it.name)) out.push(it);
  }
  return out;
}
async function fromDataTransfer(dt) {   // フォルダごとのドロップにも対応
  const items = [...(dt.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!items.length) return [...dt.files].map(f => ({ name: f.name, path: f.name, blob: f }));
  const out = [];
  const walk = async (entry, path) => {
    if (entry.isFile) { const f = await new Promise((ok, ng) => entry.file(ok, ng)); out.push({ name: f.name, path: path + f.name, blob: f }); }
    else if (entry.isDirectory) {
      const reader = entry.createReader(); let batch;
      do { batch = await new Promise((ok, ng) => reader.readEntries(ok, ng)); for (const e of batch) await walk(e, path + entry.name + '/'); } while (batch.length);
    }
  };
  for (const e of items) await walk(e, '');
  return out;
}

/* ---------- 読み込んだ一式を、パートごとのトラックにまとめる ---------- */
async function buildSet(files, progress) {
  const set = { title: '', bpm: null, tracks: [] };
  for (const f of files) {   // 曲名・BPMは ZIP名 → フォルダ名 → ファイル名 の順に探す
    for (const seg of f.path.split('/').slice(0, -1).concat(f.name)) {
      const t = detectTitle(seg);
      if (!set.bpm && t.bpm) set.bpm = t.bpm;
      if (!set.title && t.title && !MIDI_EXT.test(f.name) && /stems|bpm/i.test(seg)) set.title = t.title;
    }
  }
  const audio = files.filter(f => AUDIO_EXT.test(f.name)), midi = files.filter(f => MIDI_EXT.test(f.name));
  if (!set.title) { const m = midi.find(f => /\(.+\)/.test(f.name)); if (m) set.title = m.name.replace(/\s*\(.+$/, ''); }
  let i = 0;
  for (const f of audio) {
    i++; progress(`波形を作っています（${i}/${audio.length}）：${f.name}`);
    const tr = { id: 't' + i, name: f.name, part: detectPart(f.name), size: f.blob.size, blob: f.blob, midi: null };
    const w = WAV_EXT.test(f.name) ? await wavInfo(f.blob) : null;
    if (w) { Object.assign(tr, await wavPeaks(f.blob, w), { dur: w.frames / w.sr, sr: w.sr, bits: w.bits, ch: w.ch, float: w.format === 3 }); }
    else { try { Object.assign(tr, await decodePeaks(f.blob)); } catch (e) { tr.peaks = new Float32Array(600); tr.max = 0; tr.dur = 0; tr.error = 'この形式は再生できません'; } }
    if (!set.title && tr.part === 'mix') set.title = detectTitle(f.name).title;
    set.tracks.push(tr);
  }
  let j = 0;
  for (const f of midi) {   // MIDIは同じパートのトラックに添付（MIDIの「Vocals」はリードボーカル扱い）
    j++;
    const part = detectPart(f.name), m = { name: f.name, blob: f.blob, size: f.blob.size };
    const tr = set.tracks.find(t => t.part === part && !t.midi);
    if (tr) tr.midi = m;
    else set.tracks.push({ id: 'm' + j, name: f.name, part, midiOnly: true, midi: m, peaks: null, dur: 0 });
  }
  const order = k => PARTS.findIndex(p => p.key === k);
  set.tracks.sort((a, b) => order(a.part) - order(b.part) || a.name.localeCompare(b.name, 'ja', { numeric: true }));
  set.dur = Math.max(0, ...set.tracks.map(t => t.dur || 0));
  return set;
}

/* ---------- サーバー（ロリポップ）とのやり取り ---------- */
async function apiFetch(cloud, path, opt = {}) {
  const token = await cloud.store.getIdToken();
  const res = await fetch(API + path, { ...opt, headers: { ...(opt.headers || {}), 'X-Studio-Token': token } });
  return res;
}
async function apiJson(res) {
  let j = null; try { j = await res.json(); } catch (e) {}
  if (!res.ok || !j || !j.ok) { const err = new Error((j && j.error) || `サーバーとの通信に失敗しました（${res.status}）`); err.status = res.status; err.body = j; throw err; }
  return j;
}
async function uploadFile(cloud, song, key, blob, onBytes) {
  let off = 0, tries = 0;
  while (off < blob.size || (off === 0 && blob.size === 0)) {
    try {
      const res = await apiFetch(cloud, `upload.php?song=${song}&key=${encodeURIComponent(key)}&offset=${off}`,
        { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: blob.slice(off, off + CHUNK) });
      const j = await apiJson(res);
      onBytes(j.size - off); off = j.size; tries = 0;
      if (blob.size === 0) break;
    } catch (e) {
      if (e.status === 409 && e.body && typeof e.body.size === 'number') { onBytes(e.body.size - off); off = e.body.size; continue; }   // 途中から再開
      if (e.status && e.status < 500) throw e;
      if (++tries > 3) throw e;
      await new Promise(r => setTimeout(r, 1500 * tries));   // 通信が切れたら少し待って再送
    }
  }
}
const fileUrl = (song, key) => new URL(API + `file.php?song=${song}&key=${encodeURIComponent(key)}`, location.href).href;
async function cachePut(url, blob) { try { const c = await caches.open(AUDIO_CACHE); await c.put(url, new Response(blob)); } catch (e) {} }
async function cacheGet(url) { try { const c = await caches.open(AUDIO_CACHE); const r = await c.match(url); return r ? await r.blob() : null; } catch (e) { return null; } }
async function cacheDrop(song) { try { const c = await caches.open(AUDIO_CACHE); for (const req of await c.keys()) if (req.url.includes('song=' + song + '&')) await c.delete(req); } catch (e) {} }
async function downloadFile(cloud, song, key, onBytes) {
  const url = fileUrl(song, key);
  const hit = await cacheGet(url); if (hit) { onBytes(hit.size); return hit; }
  const res = await apiFetch(cloud, `file.php?song=${song}&key=${encodeURIComponent(key)}`);
  if (!res.ok) await apiJson(res);
  const reader = res.body.getReader(), parts = [];
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); onBytes(value.length); }
  const blob = new Blob(parts, { type: res.headers.get('Content-Type') || '' });
  cachePut(url, blob);
  return blob;
}

/* ---------- 今のバランスで1本のWAVに書き出す（WAVのパートを少しずつ足し合わせる） ---------- */
async function renderMix(tracks, gainOf, onProgress) {
  const list = [];
  for (const t of tracks) {
    if (!t.blob || !WAV_EXT.test(t.name) || t.error) continue;
    const w = await wavInfo(t.blob); if (!w) continue;
    list.push({ t, w, read: sampleReader(w), g: gainOf(t) });
  }
  if (!list.length) throw new Error('書き出せるWAVのパートがありません');
  const sr = list[0].w.sr;
  if (list.some(x => x.w.sr !== sr)) throw new Error('パートごとにサンプルレートが違うため書き出せません');
  const ch = Math.max(...list.map(x => x.w.ch)), frames = Math.max(...list.map(x => x.w.frames)), active = list.filter(x => x.g > 0);
  const STEP = 65536, out = [];
  const head = new DataView(new ArrayBuffer(44)), dataLen = frames * ch * 2;
  const wr = (o, s) => [...s].forEach((c, i) => head.setUint8(o + i, c.charCodeAt(0)));
  wr(0, 'RIFF'); head.setUint32(4, 36 + dataLen, true); wr(8, 'WAVE'); wr(12, 'fmt '); head.setUint32(16, 16, true); head.setUint16(20, 1, true);
  head.setUint16(22, ch, true); head.setUint32(24, sr, true); head.setUint32(28, sr * ch * 2, true); head.setUint16(32, ch * 2, true); head.setUint16(34, 16, true);
  wr(36, 'data'); head.setUint32(40, dataLen, true); out.push(head.buffer);
  let clipped = 0;
  for (let f0 = 0; f0 < frames; f0 += STEP) {
    const nf = Math.min(STEP, frames - f0), acc = new Float32Array(nf * ch);
    for (const x of active) {
      if (f0 >= x.w.frames) continue;
      const n = Math.min(nf, x.w.frames - f0), dv = await readBytes(x.t.blob, x.w.off + f0 * x.w.align, n * x.w.align), bps = x.w.bits / 8;
      for (let f = 0; f < n; f++) for (let c = 0; c < ch; c++) acc[f * ch + c] += x.read(dv, f * x.w.align + Math.min(c, x.w.ch - 1) * bps) * x.g;
    }
    const pcm = new Int16Array(nf * ch);
    for (let i = 0; i < acc.length; i++) { let v = acc[i]; if (v > 1) { v = 1; clipped++; } else if (v < -1) { v = -1; clipped++; } pcm[i] = v < 0 ? v * 32768 : v * 32767; }
    out.push(pcm.buffer); onProgress((f0 + nf) / frames);
  }
  return { blob: new Blob(out, { type: 'audio/wav' }), clipped };
}

/* =====================================================================
   ミキサー（画面）
===================================================================== */
export function initMixer({ root, toast, onPlay }) {
  let SET = null, pos = 0, playing = false, raf = 0, cloud = null, SONGS = [], busy = false;
  const solo = new Set(), mute = new Set(), vol = {};
  const els = {};   // track.id → <audio>
  const m = {
    get loaded() { return !!SET; }, toggle: () => playing ? pause() : play(), pause: () => pause(), update: () => draw(),
    setCloud(c) { cloud = c; unsub && unsub(); unsub = null; SONGS = []; if (cloud) unsub = cloud.store.onSongs(onSongs); renderSongs(); renderFoot(); }
  };
  let unsub = null;
  function onSongs(list) {
    SONGS = list;
    if (SET && SET.songId && !busy) {   // 開いている曲：相方さんの削除・バランス案の追加を反映（音量などの操作中の状態はそのまま）
      const d = list.find(s => s.id === SET.songId);
      if (!d) { clear(); toast('開いていた曲が削除されました'); }
      else if (!d._local) { SET.presets = d.presets || []; renderPresets(); }
    }
    renderSongs();
  }

  root.innerHTML = `
    <div class="ph"><h2>ステムミキサー</h2><span class="note" id="mxSub">SUNOでダウンロードした一式を、パートごとに聴けます</span>
      <span class="r">
        <select class="mxsongs" id="mxSongs" aria-label="保存した曲を開く" hidden></select>
        <button class="btn" id="mxClear" type="button" hidden>閉じる</button>
        <span class="btn filebtn">ファイルを選ぶ<input type="file" id="mxFiles" multiple accept=".zip,.wav,.wave,.mp3,.m4a,.aac,.flac,.ogg,.aif,.aiff,.mid,.midi" aria-label="SUNOのファイルを選ぶ"></span>
      </span></div>
    <div class="mxdrop" id="mxDrop">
      <div class="mxdrop-in"><b>ここに SUNO の一式をドロップ</b>
        <span>「曲名 Stems (BPM).zip」と「曲名 MIDI.zip」を<b>まとめて</b>ドロップできます。ZIPを展開したフォルダや、WAV・MP3・MIDIのファイルでもOKです。</span>
        <span class="note" id="mxDropNote">読み込んだあと「アップロード」を押すと、相方さんと共有できます。保存した曲は、右上の一覧から開けます。</span></div>
    </div>
    <div class="mxlist" id="mxList" hidden></div>
    <div class="mxprog" id="mxProg" hidden><span id="mxProgText"></span><div class="prog"><i id="mxProgBar" style="width:0"></i></div></div>
    <div id="mxBody" hidden>
      <div class="mxhead">
        <label class="mxtitle">曲名<input id="mxTitle" autocomplete="off"></label>
        <div class="mxmeta" id="mxMeta"></div>
      </div>
      <div class="mxctl">
        <button class="play" id="mxPlay" type="button" aria-label="再生 / 一時停止">▶</button>
        <span class="time"><span id="mxNow">0:00</span> <span class="d">/ <span id="mxDur">0:00</span></span></span>
        <button class="btn" id="mxReset" type="button">ミュート・ソロを解除</button>
        <span class="note">M＝ミュート ／ S＝ソロ ／ 波形をクリックでその位置へ</span>
      </div>
      <div class="mxpreset" id="mxPresetRow" hidden>
        <span class="lbl">バランス案</span>
        <select id="mxPreset" aria-label="バランス案"></select>
        <button class="btn" id="mxPresetDel" type="button" hidden>この案を削除</button>
        <button class="btn" id="mxPresetNew" type="button">＋ 今のバランスを案として保存</button>
        <form class="mxpname" id="mxPresetForm" hidden><input id="mxPresetName" placeholder="例：ボーカル大きめ案" autocomplete="off" aria-label="バランス案の名前"><button class="btn pri" type="submit">保存</button><button class="btn" type="button" id="mxPresetCancel">やめる</button></form>
      </div>
      <div class="mxtracks" id="mxTracks"></div>
      <div class="mxfoot" id="mxFoot"></div>
    </div>`;

  const progress = (t, ratio) => {
    const p = $('#mxProg', root); p.hidden = !t; $('#mxProgText', root).textContent = t || '';
    const bar = $('#mxProgBar', root); bar.parentElement.hidden = ratio == null; bar.style.width = Math.round((ratio || 0) * 100) + '%';
  };

  /* ---------- 読み込み（ドロップ・ファイル選択） ---------- */
  async function load(items) {
    if (!items.length || busy) return;
    pause(); busy = true; progress('読み込みを準備しています…');
    try {
      const files = await expand(items, t => progress(t));
      if (!files.length) { toast('読み込めるファイルがありませんでした（ZIP・WAV・MP3・MIDIに対応しています）'); return; }
      const set = await buildSet(files, t => progress(t));
      clear(true); SET = set; pos = 0; render();
      const a = set.tracks.filter(t => !t.midiOnly).length, md = set.tracks.filter(t => t.midi).length;
      toast(`読み込みました：音声 ${a}パート${md ? `・MIDI ${md}個` : ''}`);
    } catch (e) { console.error(e); toast('読み込めませんでした：' + (e.message || e)); }
    finally { busy = false; progress(''); }
  }
  /* ---------- 保存した曲を開く ---------- */
  async function openSong(id) {
    const doc = SONGS.find(s => s.id === id); if (!doc || busy || !cloud) return;
    pause(); busy = true;
    try {
      const tracks = (doc.tracks || []).map(t => ({ ...t, peaks: t.midiOnly ? null : unpackPeaks(t.peaks), midi: t.midi ? { ...t.midi } : null }));
      const total = tracks.reduce((n, t) => n + (t.key ? t.size : 0) + (t.midi ? t.midi.size : 0), 0); let got = 0;
      const tick = n => { got += n; progress(`曲を読み込んでいます… ${mb(got)} / ${mb(total)}（2回目からはすぐ開けます）`, total ? got / total : 0); };
      progress('曲を読み込んでいます…', 0);
      for (const t of tracks) {
        if (t.key) t.blob = await downloadFile(cloud, doc.id, t.key, tick);
        if (t.midi && t.midi.key) t.midi.blob = await downloadFile(cloud, doc.id, t.midi.key, tick);
      }
      clear(true);
      SET = { songId: doc.id, title: doc.title || '', bpm: doc.bpm || null, dur: doc.dur || Math.max(0, ...tracks.map(t => t.dur || 0)), tracks, presets: doc.presets || [], createdByName: doc.createdByName, createdAt: doc.createdAt };
      applyMixState(doc.mix); pos = 0; render();
      toast(`「${SET.title || '無題の曲'}」を開きました`);
    } catch (e) { console.error(e); toast('曲を開けませんでした：' + (e.message || e)); }
    finally { busy = false; progress(''); renderSongs(); }
  }
  function clear(keep) {
    pause(); Object.values(els).forEach(a => { a.pause(); if (a.src) URL.revokeObjectURL(a.src); a.removeAttribute('src'); }); Object.keys(els).forEach(k => delete els[k]);
    if (SET) SET.tracks.forEach(t => { if (t.midi && t.midi.url) URL.revokeObjectURL(t.midi.url); });
    SET = null; solo.clear(); mute.clear(); Object.keys(vol).forEach(k => delete vol[k]); pos = 0;
    $('#mxBody', root).hidden = true; $('#mxClear', root).hidden = true; $('#mxDrop', root).classList.remove('small');
    if (!keep) { $('#mxSub', root).textContent = 'SUNOでダウンロードした一式を、パートごとに聴けます'; renderSongs(); }
  }
  /* ---------- 画面の組み立て ---------- */
  function render() {
    const s = SET; $('#mxBody', root).hidden = false; $('#mxClear', root).hidden = false; $('#mxDrop', root).classList.add('small');
    $('#mxTitle', root).value = s.title || '';
    const a = s.tracks.filter(t => !t.midiOnly), f = a.find(t => t.sr);
    const total = s.tracks.reduce((n, t) => n + (t.size || 0) + (t.midi ? t.midi.size : 0), 0);
    $('#mxMeta', root).innerHTML = [s.bpm ? `<span>${s.bpm} BPM</span>` : '', `<span>${fmt(s.dur)}</span>`, f ? `<span>${(f.sr / 1000).toFixed(1).replace(/\.0$/, '')}kHz${f.bits ? ` / ${f.bits}bit${f.float ? ' float' : ''}` : ''} / ${f.ch === 1 ? 'モノラル' : 'ステレオ'}</span>` : '',
      `<span>音声 ${a.length}パート</span>`, `<span>MIDI ${s.tracks.filter(t => t.midi).length}個</span>`, `<span>合計 ${mb(total)}</span>`].join('');
    const lens = a.map(t => Math.round(t.dur * 10)); const same = lens.every(x => Math.abs(x - lens[0]) <= 1);
    $('#mxSub', root).textContent = s.songId ? `☁ 保存済みの曲${s.createdByName ? `（${s.createdByName}・${day(s.createdAt)}）` : ''}・ミックスは自動で保存されます`
      : (a.length > 1 ? (same ? '全パートの長さが揃っています（DAWの1小節目に並べるだけで合います）' : '⚠ パートによって長さが違います') : '');
    $('#mxTracks', root).innerHTML = s.tracks.map(t => {
      const p = partOf(t.part), quiet = !t.midiOnly && t.max < 0.01;
      const opts = PARTS.map(x => `<option value="${x.key}"${x.key === t.part ? ' selected' : ''}>${esc(x.label)}</option>`).join('');
      if (t.midi && t.midi.blob && !t.midi.url) t.midi.url = URL.createObjectURL(t.midi.blob);
      return `<div class="trk${t.midiOnly ? ' midionly' : ''}${quiet ? ' quiet' : ''}" data-id="${t.id}" style="--tc:${p.color}">
        <div class="tname"><i></i><select data-part aria-label="パートの種類">${opts}</select><small title="${esc(t.name)}">${esc(t.name)}</small></div>
        <div class="tbtns">${t.midiOnly ? '' : `<button type="button" class="ms" data-mute aria-pressed="false" title="ミュート">M</button><button type="button" class="ms" data-solo aria-pressed="false" title="ソロ">S</button><input type="range" min="0" max="1" step="0.01" value="${vol[t.id] ?? 1}" data-vol aria-label="${esc(p.label)}の音量">`}</div>
        <div class="twave">${t.midiOnly ? '<span class="note">MIDIだけ（音声なし）</span>' : '<canvas></canvas>'}</div>
        <div class="tinfo">${t.midiOnly ? '' : `<span>${fmt(t.dur)}</span><span>${mb(t.size)}</span>`}${quiet ? '<span class="pill wait">ほぼ無音</span>' : ''}${t.error ? `<span class="pill wait">${esc(t.error)}</span>` : ''}${t.blob ? `<a class="btn mid" data-dl="${t.id}" href="#" title="${esc(t.name)} をダウンロード">WAV</a>` : ''}${t.midi && t.midi.url ? `<a class="btn mid" href="${t.midi.url}" download="${esc(t.midi.name)}" title="${esc(t.midi.name)} をダウンロード">MIDI</a>` : ''}</div>
      </div>`;
    }).join('');
    a.forEach(t => {
      if (t.error || !t.blob) return;
      const el = new Audio(); el.preload = 'auto'; el.src = URL.createObjectURL(t.blob); els[t.id] = el;
      el.addEventListener('ended', () => { if (playing && t === master()) { pause(); pos = 0; draw(); } });
    });
    $('#mxDur', root).textContent = fmt(s.dur); applyVol(); renderPresets(); renderFoot(); renderSongs(); draw();
  }
  function renderFoot() {
    const f = $('#mxFoot', root); if (!SET) { f.innerHTML = ''; return; }
    const exp = `<button class="btn" id="mxExport" type="button" title="今の音量・ミュート・ソロのまま、1本のWAVにします">⤓ 今のバランスでWAV書き出し</button>`;
    const zip = `<button class="btn" id="mxZip" type="button" title="WAV・MIDIをまとめてZIPでダウンロード">⤓ 一式をZIPでダウンロード</button>`;
    if (SET.songId) f.innerHTML = `${exp}${zip}<span class="spacer"></span><button class="btn danger" id="mxDelete" type="button">この曲を削除</button>`;
    else if (cloud && SET.pendingSong) f.innerHTML = `<button class="btn pri" id="mxUpload" type="button">☁ 曲の情報を保存し直す</button>${exp}<span class="note warn">⚠ 音源はサーバーに届いています。曲の情報（一覧に出すための情報）の保存だけ失敗しました。<b>このページを閉じずに</b>押してください</span>`;
    else if (cloud) f.innerHTML = `<button class="btn pri" id="mxUpload" type="button">☁ アップロードして相方さんと共有</button>${exp}<span class="note">アップロードすると、次からは「保存した曲」から開けます</span>`;
    else f.innerHTML = `${exp}<span class="note">アップロードは、ログインしているとき（本番モード）に使えます</span>`;
  }
  function renderSongs() {
    const sel = $('#mxSongs', root), list = $('#mxList', root); sel.hidden = !cloud;
    list.hidden = !cloud || !!SET;
    if (cloud && !SET) list.innerHTML = `<div class="mxlh">☁ 保存した曲 <span class="note">${SONGS.length}曲（相方さんと共有）</span></div>` + (SONGS.length
      ? `<div class="mxcards">${SONGS.map(s => {
          const tr = s.tracks || [], parts = tr.filter(t => !t.midiOnly).length, size = tr.reduce((n, t) => n + (t.size || 0) + (t.midi ? t.midi.size || 0 : 0), 0);
          return `<button type="button" class="mxcard" data-open="${esc(s.id)}"${busy ? ' disabled' : ''}><b>${esc(s.title || '無題の曲')}</b><span>${s.bpm ? s.bpm + ' BPM ・ ' : ''}${fmt(s.dur)} ・ ${parts}パート ・ ${mb(size)}</span><small>${esc(s.createdByName || '')} ・ ${day(s.createdAt)} にアップロード</small><i>開く ▶</i></button>`;
        }).join('')}</div>`
      : '<p class="note">まだ保存した曲はありません。SUNOの一式を読み込んで「☁ アップロード」を押すと、ここに並びます。</p>');
    if (!cloud) return;
    sel.innerHTML = `<option value="">${SONGS.length ? `保存した曲を開く（${SONGS.length}曲）` : 'まだ保存した曲はありません'}</option>` +
      SONGS.map(s => `<option value="${esc(s.id)}"${SET && SET.songId === s.id ? ' selected' : ''}>${esc(s.title || '無題の曲')}（${day(s.createdAt)}・${esc(s.createdByName || '')}）</option>`).join('');
    sel.disabled = busy || !SONGS.length;
  }
  function renderPresets() {
    const row = $('#mxPresetRow', root); row.hidden = !(SET && SET.songId);
    if (row.hidden) return;
    const sel = $('#mxPreset', root), cur = sel.value;
    sel.innerHTML = `<option value="">${SET.presets.length ? '案を選んで適用…' : 'まだ案はありません'}</option>` + SET.presets.map(p => `<option value="${esc(p.id)}">${esc(p.name)}（${esc(p.by || '')}）</option>`).join('');
    if (SET.presets.some(p => p.id === cur)) sel.value = cur;
    $('#mxPresetDel', root).hidden = !sel.value;
  }
  const master = () => SET && SET.tracks.find(t => els[t.id]);
  const audible = t => solo.size ? solo.has(t.id) : !mute.has(t.id);
  function applyVol() {
    if (!SET) return;
    SET.tracks.forEach(t => {
      const row = root.querySelector(`.trk[data-id="${t.id}"]`), el = els[t.id], on = audible(t);
      if (el) el.volume = on ? (vol[t.id] ?? 1) : 0;
      if (!row || t.midiOnly) return;
      row.classList.toggle('off', !on);
      row.querySelector('[data-mute]').setAttribute('aria-pressed', String(mute.has(t.id)));
      row.querySelector('[data-solo]').setAttribute('aria-pressed', String(solo.has(t.id)));
      row.querySelector('[data-vol]').value = vol[t.id] ?? 1;
    });
  }
  /* ---------- ミックスの状態（自動保存・バランス案） ---------- */
  const mixState = () => ({ vol: { ...vol }, mute: [...mute], solo: [...solo] });
  function applyMixState(s) {
    solo.clear(); mute.clear(); Object.keys(vol).forEach(k => delete vol[k]);
    if (!s) return;
    Object.entries(s.vol || {}).forEach(([k, v]) => { vol[k] = +v; });
    (s.mute || []).forEach(k => mute.add(k)); (s.solo || []).forEach(k => solo.add(k));
  }
  let saveTimer = 0;
  function changed(what) {   // 保存済みの曲なら、少し待ってから Firestore に保存
    if (!SET || !SET.songId || !cloud) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const p = { mix: mixState() };
      if (what === 'title') p.title = SET.title;
      if (what === 'part') p.tracks = SET.tracks.map(trackDoc);
      cloud.store.updateSong(SET.songId, p).catch(() => toast('ミックスの状態を保存できませんでした'));
    }, 800);
  }
  const trackDoc = t => ({
    id: t.id, key: t.key || null, part: t.part, name: t.name, size: t.size || 0, dur: t.dur || 0, max: t.max || 0, midiOnly: !!t.midiOnly,
    sr: t.sr || null, bits: t.bits || null, ch: t.ch || null, float: !!t.float, peaks: t.peaks ? packPeaks(t.peaks) : null,
    midi: t.midi ? { key: t.midi.key || null, name: t.midi.name, size: t.midi.size } : null
  });
  /* ---------- アップロード ---------- */
  async function upload() {
    if (!SET || SET.songId || !cloud || busy) return;
    pause(); busy = true; renderSongs();
    if (SET.pendingSong) return saveSongInfo(SET.pendingSong);   // 音源は送信済み → 曲の情報だけ保存し直す
    const song = rid(12), files = [];
    SET.tracks.forEach((t, i) => {
      if (t.blob) { t.key = `a${i}.${extOf(t.name)}`; files.push({ blob: t.blob, key: t.key }); }
      if (t.midi && t.midi.blob) { t.midi.key = `m${i}.${extOf(t.midi.name)}`; files.push({ blob: t.midi.blob, key: t.midi.key }); }
    });
    const total = files.reduce((n, f) => n + f.blob.size, 0); let sent = 0;
    try {
      for (const f of files) {
        await uploadFile(cloud, song, f.key, f.blob, n => { sent += n; progress(`アップロードしています… ${mb(sent)} / ${mb(total)}（画面を閉じないでください）`, total ? sent / total : 1); });
        cachePut(fileUrl(song, f.key), f.blob);   // 自分のパソコンでは、次からダウンロードせずに開ける
      }
    } catch (e) {
      console.error(e);
      toast('アップロードできませんでした：' + (e.message || e));
      SET.tracks.forEach(t => { delete t.key; if (t.midi) delete t.midi.key; });
      busy = false; progress(''); renderSongs(); return;
    }
    busy = false;
    await saveSongInfo(song);
  }
  async function saveSongInfo(song) {
    busy = true; progress('曲の情報を保存しています…', 1);
    try {
      SET.title = $('#mxTitle', root).value.trim() || SET.title || '無題の曲';
      SET.presets = [];
      await cloud.store.saveSong(song, { title: SET.title, bpm: SET.bpm || null, dur: SET.dur, tracks: SET.tracks.map(trackDoc), mix: mixState(), presets: [] });
      delete SET.pendingSong;
      SET.songId = song; SET.createdByName = cloud.me && cloud.me.name; SET.createdAt = Date.now();
      toast(`「${SET.title}」をアップロードしました。相方さんも一覧から開けます`);
      render();
    } catch (e) {
      console.error(e);
      SET.pendingSong = song;   // 音源はサーバーに届いている。情報だけ保存し直せるようにする
      toast('音源のアップロードは完了しましたが、曲の情報を保存できませんでした（' + (e.code || e.message || e) + '）。Firestoreのルールを確認して「曲の情報を保存し直す」を押してください');
      renderFoot();
    } finally { busy = false; progress(''); renderSongs(); }
  }
  async function deleteSong() {
    if (!SET || !SET.songId || !cloud) return;
    const id = SET.songId, title = SET.title;
    try {
      await apiJson(await apiFetch(cloud, `delete.php?song=${id}`, { method: 'POST' }));
      await cloud.store.deleteSong(id); cacheDrop(id);
      clear(); toast(`「${title}」を削除しました`);
    } catch (e) { toast('削除できませんでした：' + (e.message || e)); }
  }
  /* ---------- 書き出し ---------- */
  function saveBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); }
  const safeName = s => (s || '無題の曲').replace(/[\\/:*?"<>|]/g, '_');
  async function exportMix() {
    if (!SET || busy) return; pause(); busy = true;
    try {
      progress('今のバランスでWAVを書き出しています…', 0);
      const { blob, clipped } = await renderMix(SET.tracks, t => audible(t) ? (vol[t.id] ?? 1) : 0, r => progress('今のバランスでWAVを書き出しています…', r));
      saveBlob(blob, `${safeName(SET.title)}（ラフミックス）.wav`);
      toast(clipped > 1000 ? '書き出しました（音が大きすぎて割れている箇所があります。全体の音量を少し下げてください）' : '書き出しました');
    } catch (e) { toast('書き出せませんでした：' + (e.message || e)); }
    finally { busy = false; progress(''); }
  }
  async function exportZip() {
    if (!SET || busy) return; busy = true;
    try {
      progress('ZIPを作っています…', 0);
      const JSZip = await loadJSZip(), zip = new JSZip(), dir = safeName(SET.title) + (SET.bpm ? ` (${SET.bpm}BPM)` : '');
      SET.tracks.forEach(t => { if (t.blob) zip.file(`${dir}/Stems/${t.name}`, t.blob); if (t.midi && t.midi.blob) zip.file(`${dir}/MIDI/${t.midi.name}`, t.midi.blob); });
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, m => progress('ZIPを作っています…', m.percent / 100));
      saveBlob(blob, dir + '.zip');
    } catch (e) { toast('ZIPを作れませんでした：' + (e.message || e)); }
    finally { busy = false; progress(''); }
  }
  /* ---------- 再生 ---------- */
  function play() {
    if (!SET || playing || !master()) return; onPlay && onPlay();
    if (pos >= SET.dur - 0.05) pos = 0;
    Object.values(els).forEach(el => { try { el.currentTime = pos; } catch (e) {} el.play().catch(() => {}); });
    playing = true; tick();
  }
  function pause() { if (!playing) return; playing = false; cancelAnimationFrame(raf); Object.values(els).forEach(el => el.pause()); draw(); }
  function seek(t) { pos = Math.max(0, Math.min(SET.dur, t)); Object.values(els).forEach(el => { try { el.currentTime = pos; } catch (e) {} }); draw(); }
  function tick() {   // いちばん上のトラックを基準に、ずれたパートだけ位置を合わせ直す
    if (!playing) return;
    const ref = els[master().id]; pos = ref.currentTime;
    Object.values(els).forEach(el => { if (el !== ref && !el.paused && Math.abs(el.currentTime - pos) > 0.06) { try { el.currentTime = pos; } catch (e) {} } });
    draw(); raf = requestAnimationFrame(tick);
  }
  function draw() {
    if (!SET) return;
    $('#mxNow', root).textContent = fmt(pos); $('#mxPlay', root).textContent = playing ? '❚❚' : '▶';
    SET.tracks.forEach(t => {
      if (!t.peaks) return;
      const cv = root.querySelector(`.trk[data-id="${t.id}"] canvas`); if (!cv) return;
      const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (!w) return;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
      const col = partOf(t.part).color, n = t.peaks.length, bw = w / n, mid = h / 2, prog = SET.dur ? pos / SET.dur : 0;
      const scale = t.max > 0 ? Math.min(1 / t.max, 1 / 0.02) : 1;   // 小さい音のパートも形が見えるように拡大
      for (let i = 0; i < n; i++) { const a = Math.min(1, t.peaks[i] * scale) * (mid - 2); c.globalAlpha = (i + .5) / n <= prog ? 1 : .38; c.fillStyle = col; c.fillRect(i * bw, mid - a, Math.max(1, bw - .4), Math.max(1, a * 2)); }
      c.globalAlpha = 1; c.fillStyle = '#E7E9EF'; if (prog > 0) c.fillRect(Math.min(w - 2, prog * w - 1), 0, 2, h);
    });
  }

  /* ---------- 操作 ---------- */
  $('#mxPlay', root).addEventListener('click', () => m.toggle());
  $('#mxReset', root).addEventListener('click', () => { solo.clear(); mute.clear(); applyVol(); changed('mix'); });
  $('#mxClear', root).addEventListener('click', () => clear());
  $('#mxTitle', root).addEventListener('input', e => { if (SET) { SET.title = e.target.value; changed('title'); } });
  $('#mxFiles', root).addEventListener('change', e => { load([...e.target.files].map(f => ({ name: f.name, path: f.name, blob: f }))); e.target.value = ''; });
  $('#mxList', root).addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) openSong(b.dataset.open); });
  $('#mxSongs', root).addEventListener('change', e => { const v = e.target.value; if (v && (!SET || SET.songId !== v)) openSong(v); });
  const tracksEl = $('#mxTracks', root);
  tracksEl.addEventListener('click', e => {
    const row = e.target.closest('.trk'); if (!row || !SET) return; const id = row.dataset.id;
    const dl = e.target.closest('[data-dl]');
    if (dl) { e.preventDefault(); const t = SET.tracks.find(x => x.id === dl.dataset.dl); if (t && t.blob) saveBlob(t.blob, t.name); return; }
    if (e.target.closest('[data-mute]')) { mute.has(id) ? mute.delete(id) : mute.add(id); applyVol(); changed('mix'); }
    else if (e.target.closest('[data-solo]')) { if (e.shiftKey || e.ctrlKey || e.metaKey) { solo.has(id) ? solo.delete(id) : solo.add(id); } else { const only = solo.size === 1 && solo.has(id); solo.clear(); if (!only) solo.add(id); } applyVol(); changed('mix'); }
    else if (e.target.tagName === 'CANVAS') { const r = e.target.getBoundingClientRect(); seek((e.clientX - r.left) / r.width * SET.dur); }
  });
  tracksEl.addEventListener('input', e => { const row = e.target.closest('.trk'); if (row && e.target.matches('[data-vol]')) { vol[row.dataset.id] = +e.target.value; applyVol(); changed('mix'); } });
  tracksEl.addEventListener('dblclick', e => { const row = e.target.closest('.trk'); if (row && e.target.matches('[data-vol]')) { vol[row.dataset.id] = 1; applyVol(); changed('mix'); } });   // ダブルクリックで元の音量
  tracksEl.addEventListener('change', e => {
    const row = e.target.closest('.trk'); if (!row || !e.target.matches('[data-part]')) return;
    const t = SET.tracks.find(x => x.id === row.dataset.id); t.part = e.target.value; row.style.setProperty('--tc', partOf(t.part).color); draw(); changed('part');
  });
  // 下のボタン（アップロード・書き出し・削除）
  let delArmed = 0;
  $('#mxFoot', root).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'mxUpload') upload();
    else if (b.id === 'mxExport') exportMix();
    else if (b.id === 'mxZip') exportZip();
    else if (b.id === 'mxDelete') {
      if (!delArmed) { b.textContent = 'もう一度押すと、音源ごと完全に削除します'; b.classList.add('armed'); delArmed = setTimeout(() => { delArmed = 0; renderFoot(); }, 4000); return; }
      clearTimeout(delArmed); delArmed = 0; deleteSong();
    }
  });
  // バランス案
  $('#mxPreset', root).addEventListener('change', e => {
    const p = SET && SET.presets.find(x => x.id === e.target.value); $('#mxPresetDel', root).hidden = !p; if (!p) return;
    applyMixState(p); applyVol(); changed('mix'); toast(`「${p.name}」のバランスにしました`);
  });
  $('#mxPresetNew', root).addEventListener('click', () => { $('#mxPresetForm', root).hidden = false; $('#mxPresetNew', root).hidden = true; $('#mxPresetName', root).focus(); });
  $('#mxPresetCancel', root).addEventListener('click', () => { $('#mxPresetForm', root).hidden = true; $('#mxPresetNew', root).hidden = false; });
  $('#mxPresetForm', root).addEventListener('submit', async e => {
    e.preventDefault(); const name = $('#mxPresetName', root).value.trim(); if (!name || !SET || !SET.songId) return;
    const p = { id: rid(8), name, by: (cloud && cloud.me && cloud.me.name) || '', at: Date.now(), ...mixState() };
    SET.presets = [...SET.presets, p];
    try { await cloud.store.updateSong(SET.songId, { presets: SET.presets }); toast(`バランス案「${name}」を保存しました`); }
    catch (err) { toast('保存できませんでした'); }
    $('#mxPresetName', root).value = ''; $('#mxPresetForm', root).hidden = true; $('#mxPresetNew', root).hidden = false;
    renderPresets(); $('#mxPreset', root).value = p.id; $('#mxPresetDel', root).hidden = false;
  });
  $('#mxPresetDel', root).addEventListener('click', async e => {
    const b = e.currentTarget, id = $('#mxPreset', root).value; if (!id) return;
    if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'もう一度押すと削除'; setTimeout(() => { b.classList.remove('armed'); b.textContent = 'この案を削除'; }, 4000); return; }
    b.classList.remove('armed'); b.textContent = 'この案を削除';
    SET.presets = SET.presets.filter(p => p.id !== id);
    try { await cloud.store.updateSong(SET.songId, { presets: SET.presets }); toast('バランス案を削除しました'); } catch (err) { toast('削除できませんでした'); }
    renderPresets();
  });
  // ドラッグ＆ドロップ（パネル全体が受け付け）
  ['dragenter', 'dragover'].forEach(ev => root.addEventListener(ev, e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); root.classList.add('dragover'); } }));
  ['dragleave', 'drop'].forEach(ev => root.addEventListener(ev, e => { if (ev === 'dragleave' && root.contains(e.relatedTarget)) return; root.classList.remove('dragover'); }));
  root.addEventListener('drop', async e => { e.preventDefault(); load(await fromDataTransfer(e.dataTransfer)); });
  window.addEventListener('resize', () => draw());
  window.addEventListener('beforeunload', e => { if (busy || (SET && SET.pendingSong)) { e.preventDefault(); e.returnValue = ''; } });   // アップロード中に閉じそうになったら確認
  return m;
}
