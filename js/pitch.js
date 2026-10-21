// =====================================================================
//  pitch.js — WAVの「選んだ範囲だけ」音の高さ（キー）を変える
//   ・長さ／テンポは変えずに、半音単位で上げ下げする（WSOLA で引き伸ばし → 元の長さに戻す）
//   ・範囲の前後は短いクロスフェードで元の音となめらかにつなぐ
//   ・元のWAVと同じ形式（16bit / 24bit / 32bit float など）で書き戻す
// =====================================================================

const MARGIN_SEC = 0.15;   // 範囲の前後に余分に処理する長さ（つなぎ目をきれいにするため）
const FADE_SEC = 0.03;     // つなぎ目のクロスフェード

const yieldUI = () => new Promise(r => setTimeout(r, 0));

/* ---------- WAVの読み書き ---------- */
function reader(w) {
  if (w.format === 3) return w.bits === 64 ? (dv, o) => dv.getFloat64(o, true) : (dv, o) => dv.getFloat32(o, true);
  if (w.bits === 16) return (dv, o) => dv.getInt16(o, true) / 32768;
  if (w.bits === 24) return (dv, o) => { let v = dv.getUint8(o) | dv.getUint8(o + 1) << 8 | dv.getUint8(o + 2) << 16; if (v & 0x800000) v -= 0x1000000; return v / 8388608; };
  if (w.bits === 32) return (dv, o) => dv.getInt32(o, true) / 2147483648;
  if (w.bits === 8) return (dv, o) => (dv.getUint8(o) - 128) / 128;
  return null;
}
function writer(w) {
  const c = v => (v > 1 ? 1 : v < -1 ? -1 : v);
  if (w.format === 3) return w.bits === 64 ? (dv, o, v) => dv.setFloat64(o, v, true) : (dv, o, v) => dv.setFloat32(o, v, true);
  if (w.bits === 16) return (dv, o, v) => { v = c(v); dv.setInt16(o, v < 0 ? Math.round(v * 32768) : Math.round(v * 32767), true); };
  if (w.bits === 24) return (dv, o, v) => { v = c(v); let x = v < 0 ? Math.round(v * 8388608) : Math.round(v * 8388607); if (x < 0) x += 0x1000000; dv.setUint8(o, x & 255); dv.setUint8(o + 1, (x >> 8) & 255); dv.setUint8(o + 2, (x >> 16) & 255); };
  if (w.bits === 32) return (dv, o, v) => { v = c(v); dv.setInt32(o, v < 0 ? Math.round(v * 2147483648) : Math.round(v * 2147483647), true); };
  if (w.bits === 8) return (dv, o, v) => { v = c(v); dv.setUint8(o, Math.round(v * 127 + 128)); };
  return null;
}

/* ---------- WSOLA：音の高さを変えずに長さだけを ratio 倍にする ---------- */
// 各チャンネルで同じ切り出し位置を使う（左右がずれないように、位置はモノラルで決める）
async function wsolaPositions(mono, ratio, sr, onProgress) {
  const N = Math.max(256, Math.round(0.05 * sr) & ~1);   // 1つの切り出しの長さ（約50ms）
  const Hs = N >> 1, Ha = Hs / ratio, tol = Math.round(0.012 * sr);
  const outLen = Math.ceil(mono.length * ratio), count = Math.ceil(outLen / Hs) + 1, maxPos = Math.max(0, mono.length - N);
  const pos = new Int32Array(count);
  let prev = 0;
  for (let k = 1; k < count; k++) {
    const nominal = Math.min(maxPos, Math.round(k * Ha)), target = Math.min(maxPos, prev + Hs);   // target：前の切り出しの「自然な続き」
    let best = nominal, bestScore = -Infinity;
    const lo = Math.max(0, nominal - tol), hi = Math.min(maxPos, nominal + tol);
    for (let d = lo; d <= hi; d += 2) {   // 前の続きと一番よく似ている位置を探す（速さのため間引いて比較）
      let s = 0, e = 1e-9;
      for (let i = 0; i < Hs; i += 4) { const a = mono[d + i]; s += a * mono[target + i]; e += a * a; }
      const score = s / Math.sqrt(e);
      if (score > bestScore) { bestScore = score; best = d; }
    }
    pos[k] = best; prev = best;
    if ((k & 63) === 0) { onProgress && onProgress(k / count * 0.8); await yieldUI(); }
  }
  return { pos, N, Hs, outLen };
}
function wsolaRender(x, plan) {
  const { pos, N, Hs, outLen } = plan, out = new Float32Array(outLen + N), wsum = new Float32Array(outLen + N), win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  for (let k = 0; k < pos.length; k++) {
    const o = k * Hs, p = pos[k];
    for (let i = 0; i < N && p + i < x.length; i++) { out[o + i] += x[p + i] * win[i]; wsum[o + i] += win[i]; }
  }
  for (let i = 0; i < out.length; i++) if (wsum[i] > 1e-3) out[i] /= wsum[i];
  return out;
}
// 長さ len に戻す（ratio 倍の速さで読む → 音が ratio 倍の高さになる）。4点補間
function resample(src, ratio, len) {
  const y = new Float32Array(len), n = src.length;
  const at = i => src[i < 0 ? 0 : i >= n ? n - 1 : i];
  for (let i = 0; i < len; i++) {
    const t = i * ratio, j = Math.floor(t), f = t - j;
    const p0 = at(j - 1), p1 = at(j), p2 = at(j + 1), p3 = at(j + 2);
    y[i] = p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
  }
  return y;
}

/* ---------- 公開する関数 ---------- */
// blob：元のWAV ／ w：wavInfo() の結果 ／ fromSec〜toSec の範囲を semis 半音動かした、新しいWAV（Blob）を返す
export async function pitchShiftRegion(blob, w, fromSec, toSec, semis, onProgress) {
  const rd = reader(w), wr = writer(w);
  if (!rd || !wr) throw new Error('このWAVの形式には対応していません');
  if (!semis) throw new Error('動かす量（半音）を選んでください');
  const sr = w.sr, ch = w.ch, bps = w.bits / 8;
  const a = Math.max(0, Math.floor((fromSec - MARGIN_SEC) * sr)), b = Math.min(w.frames, Math.ceil((toSec + MARGIN_SEC) * sr));
  const len = b - a; if (len < sr * 0.1) throw new Error('範囲が短すぎます（0.1秒以上を選んでください）');

  // 範囲の音を読み出す
  const dv = new DataView(await blob.slice(w.off + a * w.align, w.off + b * w.align).arrayBuffer());
  const chans = Array.from({ length: ch }, () => new Float32Array(len)), mono = new Float32Array(len);
  for (let f = 0; f < len; f++) for (let c = 0; c < ch; c++) { const v = rd(dv, f * w.align + c * bps); chans[c][f] = v; mono[f] += v / ch; }

  // 高さを変える（長さはそのまま）
  const ratio = Math.pow(2, semis / 12);
  const plan = await wsolaPositions(mono, ratio, sr, onProgress);
  const shifted = chans.map(x => resample(wsolaRender(x, plan), ratio, len));
  onProgress && onProgress(0.9);

  // つなぎ目をなめらかにしながら、元の音と入れ替える
  const s = fromSec * sr - a, e = toSec * sr - a, fade = FADE_SEC * sr;
  const gain = f => f < s - fade || f > e + fade ? 0 : f < s ? (f - (s - fade)) / fade : f > e ? 1 - (f - e) / fade : 1;
  const bytes = new Uint8Array(await blob.arrayBuffer());   // 元のファイルを丸ごと複製して、範囲だけ書き換える
  const out = new DataView(bytes.buffer, w.off + a * w.align, len * w.align);
  for (let f = 0; f < len; f++) {
    const g = gain(f); if (g <= 0) continue;
    for (let c = 0; c < ch; c++) wr(out, f * w.align + c * bps, chans[c][f] * (1 - g) + shifted[c][f] * g);
  }
  onProgress && onProgress(1);
  return new Blob([bytes], { type: 'audio/wav' });
}
