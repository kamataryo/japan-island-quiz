import { pmtilesSha256 } from "../public/data/meta.json";

/**
 * タイルの URL（/tiles/{版}/{z}/{x}/{y}.mvt）に入れるデータの版。Worker とクライアントで共有する。
 * データを作り直すと URL が変わるので、ブラウザに古いタイルが残っていても混ざらない
 * （以前は URL に版がなく、国後島を足す前のタイルがキャッシュから出て、ズームによって島が欠けて見えた）
 */
export const TILES_VERSION = pmtilesSha256.slice(0, 12);
