/**
 * 地理院の標高タイル（PNG）を、MapLibre が読める terrarium 形式に画素ごと書き換える。
 * 地理院形式は x = R·2^16 + G·2^8 + B を 24bit の2の補数として 0.01m 単位で読み、
 * (128, 0, 0) は無効値（海など）。MapLibre の custom エンコーディングは一次式なので、
 * 無効値と負の標高を扱えず、ここで変換する。無効値は 0m とする
 * https://maps.gsi.go.jp/development/demtile.html
 */
export function gsiToTerrarium(px: Uint8ClampedArray): void {
  for (let i = 0; i < px.length; i += 4) {
    const x = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    const h = x === 0x800000 ? 0 : (x < 0x800000 ? x : x - 0x1000000) / 100;
    // terrarium: h = R·256 + G + B/256 - 32768
    const v = h + 32768;
    px[i] = v >> 8;
    px[i + 1] = v & 0xff;
    px[i + 2] = Math.round((v % 1) * 256);
    px[i + 3] = 255;
  }
}
