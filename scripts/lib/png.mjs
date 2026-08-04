/*
 * 最小限の PNG 読み取り。
 *
 * アイコンの検査（透明を含むか／maskable のセーフゾーン外に中身が無いか）は
 * 画素を数えないと分からない。そのためだけに画像ライブラリを足すと
 * 依存が増えて Chromebook 向けの軽さという方針と噛み合わないので、
 * Node 標準の zlib だけで読む。
 *
 * 対応するのは PNG のうち色タイプ 2(RGB) / 3(パレット) / 6(RGBA) / 0(グレー) の
 * ビット深度8のもの。GIGA のアイコンはすべてこの範囲に収まる。
 */
import { inflateSync } from 'node:zlib';

export function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG ではない');

  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let palette = null;
  let transparency = null;
  const idat = [];

  while (pos < buffer.length) {
    const len = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + len);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('インターレース PNG には対応していない');
    } else if (type === 'PLTE') {
      palette = Buffer.from(data);
    } else if (type === 'tRNS') {
      transparency = Buffer.from(data);
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`色タイプ ${colorType} には対応していない`);

  // パレット PNG は色数を落とすとビット深度も 1/2/4 に下がる。
  // アイコンを軽くすると普通にこうなるので、ここに対応していないと
  // 「検査が例外で落ちる」＝ 何も見ていないのと同じになる。
  if (depth !== 8 && !(depth < 8 && (colorType === 0 || colorType === 3))) {
    throw new Error(`ビット深度 ${depth} / 色タイプ ${colorType} には対応していない`);
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = depth === 8
    ? width * channels
    : Math.ceil((width * channels * depth) / 8);
  const out = Buffer.alloc(height * stride);

  // PNG は行ごとに5種類のフィルタで差分符号化されている。順に戻す。
  // ビット深度が 8 未満のとき、フィルタは「1バイト単位」で戻す
  const bpp = depth === 8 ? channels : 1;

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 0xff;
    }
  }

  // ビット深度が 8 未満なら、1バイトに詰まっている複数画素をほどく
  let samples = out;
  if (depth < 8) {
    samples = Buffer.alloc(width * height);
    const perByte = 8 / depth;
    const mask = (1 << depth) - 1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byte = out[y * stride + Math.floor(x / perByte)];
        const shift = 8 - depth * ((x % perByte) + 1);
        samples[y * width + x] = (byte >> shift) & mask;
      }
    }
  }

  // どの色タイプでも RGBA に揃えて返す
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    let r; let g; let bl; let al = 255;
    if (colorType === 3) {
      const idx = samples[i];
      r = palette[idx * 3];
      g = palette[idx * 3 + 1];
      bl = palette[idx * 3 + 2];
      if (transparency && idx < transparency.length) al = transparency[idx];
    } else if (colorType === 0) {
      // 深度が 8 未満のグレーは、最大値が 255 になるよう伸ばす
      r = g = bl = depth === 8 ? samples[i] : Math.round((samples[i] * 255) / ((1 << depth) - 1));
    } else if (colorType === 4) {
      r = g = bl = out[i * 2];
      al = out[i * 2 + 1];
    } else if (colorType === 2) {
      r = out[i * 3]; g = out[i * 3 + 1]; bl = out[i * 3 + 2];
    } else {
      r = out[i * 4]; g = out[i * 4 + 1]; bl = out[i * 4 + 2]; al = out[i * 4 + 3];
    }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = bl; rgba[i * 4 + 3] = al;
  }

  return { width, height, rgba };
}

/** 透明（完全不透明でない）画素の数 */
export function countTransparentPixels(png) {
  let n = 0;
  for (let i = 0; i < png.width * png.height; i++) {
    if (png.rgba[i * 4 + 3] < 255) n++;
  }
  return n;
}

/*
 * maskable のセーフゾーン外に「絵の中身」が何％あるかを測る（§3-7）。
 *
 * アイコン自身の下地と、欠けては困る中身を色で区別する。
 * 下地は切り抜かれてよいので、一緒に数えると実態より深刻に見える。
 * 下地の色は四隅から取る。
 */
export function maskableOutsideSafeZone(png) {
  const { width: w, height: h, rgba } = png;
  const at = (x, y) => {
    const i = (y * w + x) * 4;
    return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
  };
  const corners = [at(2, 2), at(w - 3, 2), at(2, h - 3), at(w - 3, h - 3)];
  const base = [0, 1, 2].map((k) => corners.reduce((s, c) => s + c[k], 0) / 4);

  const cx = w / 2;
  const cy = h / 2;
  const r = w * 0.4; // 中央80%の円
  let outside = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = at(x, y);
      if (p[3] < 16) continue;
      const d = Math.hypot(p[0] - base[0], p[1] - base[1], p[2] - base[2]);
      if (d < 40) continue; // 下地とみなす
      if (Math.hypot(x - cx, y - cy) > r) outside++;
    }
  }
  return { outside, total: w * h, percent: (outside / (w * h)) * 100 };
}
