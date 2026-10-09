// =====================================================================
//  stems.js — SUNOの一式（Stems ZIP・MIDI ZIP・WAV）を読み込んで、
//             パートごとに同時再生（ミュート・ソロ・音量）する「ステムミキサー」
//  ※ ステップ1：読み込みと再生は、このパソコンの中だけで行います（まだアップロードしません）
// =====================================================================
const JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

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

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const mb = n => (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';

/* ---------- ファイル名から「曲名・BPM・パート」を読み取る ---------- */
// 例： "0 Lead Vocals.wav" → lead ／ "Produce (Bass).mid" → bass ／ "Produce.wav" → mix
export function detectPart(fileName) {
  let base = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').trim();
  const paren = base.match(/\(([^)]+)\)\s*$/);
  let s = (paren ? paren[1] : base).replace(/^[0-9]+[\s._-]+/, '').trim().toLowerCase();
  for (const p of PARTS) if (p.re && p.re.test(s)) return p.key;
  return 'mix';
}
// 例： "Produce Stems (137BPM)" → { title: "Produce", bpm: 137 }
export function detectTitle(name) {
  const base = name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  const bpm = (base.match(/([0-9]{2,3})\s*bpm/i) || [])[1];
  let title = base.replace(/\(\s*[0-9]{2,3}\s*bpm\s*\)/i, '').replace(/\b(stems?|midi)\b/ig, '').replace(/\(([^)]*)\)\s*$/, '').replace(/\s+/g, ' ').trim();
  return { title, bpm: bpm ? +bpm : null };
}

/* ---------- WAVのヘッダーと波形を、メモリを使いすぎずに読む ---------- */
async function readBytes(blob, off, len) { return new DataView(await blob.slice(off, off + len).arrayBuffer()); }
const str4 = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
async function wavInfo(blob) {
  if (blob.size < 44) return null;
  const h = await readBytes(blob, 0, 12);
  if (str4(h, 0) !== 'RIFF' || str4(h, 8) !== 'WAVE') return null;
  let p = 12, fmt = null, data = null;
  for (let i = 0; i < 64 && p + 8 <= blob.size; i++) {
    const c = await readBytes(blob, p, 8), id = str4(c, 0), size = c.getUint32(4, true);
    if (id === 'fmt ') {
      const f = await readBytes(blob, p + 8, Math.min(size, 40));
      let format = f.getUint16(0, true);
      if (format === 0xFFFE && size >= 26) format = f.getUint16(24, true);   // WAVE_FORMAT_EXTENSIBLE
      fmt = { format, ch: f.getUint16(2, true), sr: f.getUint32(4, true), align: f.getUint16(12, true), bits: f.getUint16(14, true) };
    } else if (id === 'data') { data = { off: p + 8, len: Math.min(size, blob.size - p - 8) }; break; }
    p += 8 + size + (size % 2);
  }
  if (!fmt || !data || !fmt.align) return null;
  return { ...fmt, ...data, frames: Math.floor(data.len / fmt.align) };
}
async function wavPeaks(blob, w, n = 600) {
  const read = (dv, o) => {
    if (w.format === 3) return w.bits === 64 ? dv.getFloat64(o, true) : dv.getFloat32(o, true);
    if (w.bits === 16) return dv.getInt16(o, true) / 32768;
    if (w.bits === 24) { let v = dv.getUint8(o) | dv.getUint8(o + 1) << 8 | dv.getUint8(o + 2) << 16; if (v & 0x800000) v -= 0x1000000; return v / 8388608; }
    if (w.bits === 32) return dv.getInt32(o, true) / 2147483648;
    if (w.bits === 8) return (dv.getUint8(o) - 128) / 128;
    return 0;
  };
  const peaks = new Float32Array(n), perBin = w.frames / n, bps = w.bits / 8;
  const CHUNK_FRAMES = Math.max(1, Math.floor(8 * 1048576 / w.align)), STEP = 6;
  let max = 0, sq = 0, cnt = 0;
  for (let f0 = 0; f0 < w.frames; f0 += CHUNK_FRAMES) {
    const nf = Math.min(CHUNK_FRAMES, w.frames - f0);
    const dv = await readBytes(blob, w.off + f0 * w.align, nf * w.align);
    for (let f = 0; f < nf; f += STEP) {
      let v = 0;
      for (let c = 0; c < w.ch; c++) { const a = Math.abs(read(dv, f * w.align + c * bps)); if (a > v) v = a; }
      const b = Math.min(n - 1, Math.floor((f0 + f) / perBin)); if (v > peaks[b]) peaks[b] = v;
      if (v > max) max = v; sq += v * v; cnt++;
    }
  }
  return { peaks, max, rms: Math.sqrt(sq / Math.max(1, cnt)) };
}
async function decodePeaks(blob, n = 600) {   // WAV以外（MP3など）
  const AC = window.AudioContext || window.webkitAudioContext, ac = new AC();
  try {
    const buf = await ac.decodeAudioData(await blob.arrayBuffer());
    const ch = buf.getChannelData(0), per = ch.length / n, peaks = new Float32Array(n); let max = 0, sq = 0, cnt = 0;
    for (let i = 0; i < ch.length; i += 8) { const v = Math.abs(ch[i]), b = Math.min(n - 1, Math.floor(i / per)); if (v > peaks[b]) peaks[b] = v; if (v > max) max = v; sq += v * v; cnt++; }
    return { peaks, max, rms: Math.sqrt(sq / Math.max(1, cnt)), dur: buf.duration, sr: buf.sampleRate, ch: buf.numberOfChannels };
  } finally { ac.close && ac.close(); }
}

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
      if (!set.title && t.title && MIDI_EXT.test(f.name) === false && /stems|bpm/i.test(seg)) set.title = t.title;
    }
  }
  const audio = files.filter(f => AUDIO_EXT.test(f.name)), midi = files.filter(f => MIDI_EXT.test(f.name));
  if (!set.title) { const m = midi.find(f => /\(.+\)/.test(f.name)); if (m) set.title = m.name.replace(/\s*\(.+$/, ''); }
  let i = 0;
  for (const f of audio) {
    i++; progress(`波形を作っています（${i}/${audio.length}）：${f.name}`);
    const tr = { id: 't' + i + '_' + Math.random().toString(36).slice(2, 6), name: f.name, part: detectPart(f.name), size: f.blob.size, blob: f.blob, url: URL.createObjectURL(f.blob), midi: null };
    const w = /\.(wav|wave)$/i.test(f.name) ? await wavInfo(f.blob) : null;
    if (w) { const pk = await wavPeaks(f.blob, w); Object.assign(tr, pk, { dur: w.frames / w.sr, sr: w.sr, bits: w.bits, ch: w.ch, float: w.format === 3 }); }
    else { try { Object.assign(tr, await decodePeaks(f.blob)); } catch (e) { tr.peaks = new Float32Array(600); tr.max = 0; tr.dur = 0; tr.error = 'この形式は再生できません'; } }
    if (!set.title && tr.part === 'mix') set.title = detectTitle(f.name).title;
    set.tracks.push(tr);
  }
  for (const f of midi) {   // MIDIは同じパートのトラックに添付（MIDIの「Vocals」はリードボーカル扱い）
    const part = detectPart(f.name), m = { name: f.name, blob: f.blob, url: URL.createObjectURL(f.blob), size: f.blob.size };
    const tr = set.tracks.find(t => t.part === part && !t.midi);
    if (tr) tr.midi = m;
    else set.tracks.push({ id: 'm' + Math.random().toString(36).slice(2, 8), name: f.name, part, midiOnly: true, midi: m, peaks: null, dur: 0 });
  }
  const order = k => PARTS.findIndex(p => p.key === k);
  set.tracks.sort((a, b) => order(a.part) - order(b.part) || a.name.localeCompare(b.name, 'ja', { numeric: true }));
  set.dur = Math.max(0, ...set.tracks.map(t => t.dur || 0));
  return set;
}

/* =====================================================================
   ミキサー（画面）
===================================================================== */
export function initMixer({ root, toast, onPlay }) {
  let SET = null, pos = 0, playing = false, clock = 0, raf = 0;
  const solo = new Set(), mute = new Set(), vol = {};
  const els = {};   // track.id → <audio>
  const m = { get loaded() { return !!SET; }, toggle: () => playing ? pause() : play(), pause: () => pause(), update: () => draw() };

  root.innerHTML = `
    <div class="ph"><h2>ステムミキサー</h2><span class="note" id="mxSub">SUNOでダウンロードした一式を、パートごとに聴けます</span>
      <span class="r"><button class="btn" id="mxClear" type="button" hidden>読み込みをクリア</button>
      <span class="btn filebtn">ファイルを選ぶ<input type="file" id="mxFiles" multiple accept=".zip,.wav,.wave,.mp3,.m4a,.aac,.flac,.ogg,.aif,.aiff,.mid,.midi" aria-label="SUNOのファイルを選ぶ"></span></span></div>
    <div class="mxdrop" id="mxDrop">
      <div class="mxdrop-in"><b>ここに SUNO の一式をドロップ</b>
        <span>「曲名 Stems (BPM).zip」と「曲名 MIDI.zip」を<b>まとめて</b>ドロップできます。ZIPを展開したフォルダや、WAV・MP3・MIDIのファイルでもOKです。</span>
        <span class="note">※ 今は試し聴き用です。ファイルはこのパソコンの中だけで読み込み、まだアップロードはしません。</span></div>
    </div>
    <div class="mxprog" id="mxProg" hidden></div>
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
      <div class="mxtracks" id="mxTracks"></div>
      <div class="mxfoot"><button class="btn pri" id="mxUpload" type="button" disabled>アップロードして相方さんと共有</button><span class="note">ロリポップへのアップロードは、次のステップで使えるようになります</span></div>
    </div>`;

  const progress = t => { const p = $('#mxProg', root); p.hidden = !t; p.textContent = t || ''; };
  async function load(items) {
    if (!items.length) return;
    pause(); progress('読み込みを準備しています…');
    try {
      const files = await expand(items, progress);
      if (!files.length) { progress(''); toast('読み込めるファイルがありませんでした（ZIP・WAV・MP3・MIDIに対応しています）'); return; }
      const set = await buildSet(files, progress);
      clear(true); SET = set; pos = 0; render();
      const a = set.tracks.filter(t => !t.midiOnly).length, md = set.tracks.filter(t => t.midi).length;
      toast(`読み込みました：音声 ${a}パート${md ? `・MIDI ${md}個` : ''}`);
    } catch (e) { console.error(e); toast('読み込めませんでした：' + (e.message || e)); }
    progress('');
  }
  function clear(keepDrop) {
    pause(); Object.values(els).forEach(a => { a.pause(); a.removeAttribute('src'); }); Object.keys(els).forEach(k => delete els[k]);
    if (SET) SET.tracks.forEach(t => { t.url && URL.revokeObjectURL(t.url); t.midi && URL.revokeObjectURL(t.midi.url); });
    SET = null; solo.clear(); mute.clear(); pos = 0;
    $('#mxBody', root).hidden = true; $('#mxClear', root).hidden = true; $('#mxDrop', root).classList.remove('small');
    if (!keepDrop) $('#mxSub', root).textContent = 'SUNOでダウンロードした一式を、パートごとに聴けます';
  }
  function render() {
    const s = SET; $('#mxBody', root).hidden = false; $('#mxClear', root).hidden = false; $('#mxDrop', root).classList.add('small');
    $('#mxTitle', root).value = s.title || '';
    const a = s.tracks.filter(t => !t.midiOnly), f = a.find(t => t.sr);
    const total = s.tracks.reduce((n, t) => n + (t.size || 0) + (t.midi ? t.midi.size : 0), 0);
    $('#mxMeta', root).innerHTML = [s.bpm ? `<span>${s.bpm} BPM</span>` : '', `<span>${fmt(s.dur)}</span>`, f ? `<span>${(f.sr / 1000).toFixed(1).replace(/\.0$/, '')}kHz${f.bits ? ` / ${f.bits}bit${f.float ? ' float' : ''}` : ''} / ${f.ch === 1 ? 'モノラル' : 'ステレオ'}</span>` : '',
      `<span>音声 ${a.length}パート</span>`, `<span>MIDI ${s.tracks.filter(t => t.midi).length}個</span>`, `<span>合計 ${mb(total)}</span>`].join('');
    const lens = a.map(t => Math.round(t.dur * 10)); const same = lens.every(x => Math.abs(x - lens[0]) <= 1);
    $('#mxSub', root).textContent = a.length > 1 ? (same ? '全パートの長さが揃っています（DAWの1小節目に並べるだけで合います）' : '⚠ パートによって長さが違います') : '';
    $('#mxTracks', root).innerHTML = s.tracks.map(t => {
      const p = partOf(t.part), quiet = !t.midiOnly && t.max < 0.01;
      const opts = PARTS.map(x => `<option value="${x.key}"${x.key === t.part ? ' selected' : ''}>${esc(x.label)}</option>`).join('');
      return `<div class="trk${t.midiOnly ? ' midionly' : ''}${quiet ? ' quiet' : ''}" data-id="${t.id}" style="--tc:${p.color}">
        <div class="tname"><i></i><select data-part aria-label="パートの種類">${opts}</select><small title="${esc(t.name)}">${esc(t.name)}</small></div>
        <div class="tbtns">${t.midiOnly ? '' : `<button type="button" class="ms" data-mute aria-pressed="false" title="ミュート">M</button><button type="button" class="ms" data-solo aria-pressed="false" title="ソロ">S</button><input type="range" min="0" max="1" step="0.01" value="${vol[t.id] ?? 1}" data-vol aria-label="${esc(p.label)}の音量">`}</div>
        <div class="twave">${t.midiOnly ? '<span class="note">MIDIだけ（音声なし）</span>' : '<canvas></canvas>'}</div>
        <div class="tinfo">${t.midiOnly ? '' : `<span>${fmt(t.dur)}</span><span>${mb(t.size)}</span>`}${quiet ? '<span class="pill wait">ほぼ無音</span>' : ''}${t.error ? `<span class="pill wait">${esc(t.error)}</span>` : ''}${t.midi ? `<a class="btn mid" href="${t.midi.url}" download="${esc(t.midi.name)}" title="${esc(t.midi.name)}">MIDI</a>` : ''}</div>
      </div>`;
    }).join('');
    a.forEach(t => {
      if (t.error) return;
      const el = new Audio(); el.preload = 'auto'; el.src = t.url; els[t.id] = el;
      el.addEventListener('ended', () => { if (playing && t === master()) { pause(); pos = 0; draw(); } });
    });
    $('#mxDur', root).textContent = fmt(s.dur); applyVol(); draw();
  }
  const master = () => SET && SET.tracks.find(t => els[t.id]);
  function applyVol() {
    if (!SET) return;
    SET.tracks.forEach(t => {
      const el = els[t.id]; if (!el) return;
      const on = solo.size ? solo.has(t.id) : !mute.has(t.id);
      el.volume = on ? (vol[t.id] ?? 1) : 0;
      const row = root.querySelector(`.trk[data-id="${t.id}"]`); if (!row) return;
      row.classList.toggle('off', !on);
      row.querySelector('[data-mute]').setAttribute('aria-pressed', String(mute.has(t.id)));
      row.querySelector('[data-solo]').setAttribute('aria-pressed', String(solo.has(t.id)));
    });
  }
  function play() {
    if (!SET || playing || !master()) return; onPlay && onPlay();
    if (pos >= SET.dur - 0.05) pos = 0;
    Object.values(els).forEach(el => { try { el.currentTime = pos; } catch (e) {} el.play().catch(() => {}); });
    playing = true; clock = performance.now() - pos * 1000; tick();
  }
  function pause() { if (!playing) return; playing = false; cancelAnimationFrame(raf); Object.values(els).forEach(el => el.pause()); draw(); }
  function seek(t) { pos = Math.max(0, Math.min(SET.dur, t)); Object.values(els).forEach(el => { try { el.currentTime = pos; } catch (e) {} }); clock = performance.now() - pos * 1000; draw(); }
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

  // 操作
  $('#mxPlay', root).addEventListener('click', () => m.toggle());
  $('#mxReset', root).addEventListener('click', () => { solo.clear(); mute.clear(); applyVol(); });
  $('#mxClear', root).addEventListener('click', () => clear());
  $('#mxTitle', root).addEventListener('input', e => { if (SET) SET.title = e.target.value; });
  $('#mxFiles', root).addEventListener('change', e => { load([...e.target.files].map(f => ({ name: f.name, path: f.name, blob: f }))); e.target.value = ''; });
  const tracksEl = $('#mxTracks', root);
  tracksEl.addEventListener('click', e => {
    const row = e.target.closest('.trk'); if (!row || !SET) return; const id = row.dataset.id;
    if (e.target.closest('[data-mute]')) { mute.has(id) ? mute.delete(id) : mute.add(id); applyVol(); }
    else if (e.target.closest('[data-solo]')) { if (e.shiftKey || e.ctrlKey || e.metaKey) { solo.has(id) ? solo.delete(id) : solo.add(id); } else { const only = solo.size === 1 && solo.has(id); solo.clear(); if (!only) solo.add(id); } applyVol(); }
    else if (e.target.tagName === 'CANVAS') { const r = e.target.getBoundingClientRect(); seek((e.clientX - r.left) / r.width * SET.dur); }
  });
  tracksEl.addEventListener('input', e => { const row = e.target.closest('.trk'); if (row && e.target.matches('[data-vol]')) { vol[row.dataset.id] = +e.target.value; applyVol(); } });
  tracksEl.addEventListener('change', e => {
    const row = e.target.closest('.trk'); if (!row || !e.target.matches('[data-part]')) return;
    const t = SET.tracks.find(x => x.id === row.dataset.id); t.part = e.target.value; row.style.setProperty('--tc', partOf(t.part).color); draw();
  });
  // ドラッグ＆ドロップ（パネル全体が受け付け）
  ['dragenter', 'dragover'].forEach(ev => root.addEventListener(ev, e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); root.classList.add('dragover'); } }));
  ['dragleave', 'drop'].forEach(ev => root.addEventListener(ev, e => { if (ev === 'dragleave' && root.contains(e.relatedTarget)) return; root.classList.remove('dragover'); }));
  root.addEventListener('drop', async e => { e.preventDefault(); load(await fromDataTransfer(e.dataTransfer)); });
  window.addEventListener('resize', () => draw());
  return m;
}
