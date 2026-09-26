/**
 * 静的アセットの配信に加えて、次の2つを Worker で処理する（wrangler.jsonc の run_worker_first）。
 * - /tiles/{z}/{x}/{y}.mvt: R2 に置いた base.pmtiles から1枚ずつ返す
 * - /api/answers: 島ごとの正答率の集計
 */
import { PMTiles, type RangeResponse, type Source } from "pmtiles";
import islands from "../public/data/islands.json";

const IDS = new Set(islands.map((x) => x.id));

/** 送られてきた回答を検証する。実在しない島は集計しない（ゴミ行を増やさないため） */
export function parseAnswer(
  body: unknown,
): { id: string; correct: boolean } | undefined {
  if (typeof body !== "object" || body === null) return;
  const { id, correct } = body as Record<string, unknown>;
  if (typeof id !== "string" || !IDS.has(id) || typeof correct !== "boolean")
    return;
  return { id, correct };
}

/**
 * R2 から PMTiles を範囲指定で読む。
 * ヘッダとディレクトリは PMTiles がこの isolate のメモリにキャッシュするので、R2 を読むのはほぼタイル本体だけになる
 */
class R2Source implements Source {
  constructor(
    private bucket: R2Bucket,
    private key: string,
  ) {}
  getKey() {
    return this.key;
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const obj = await this.bucket.get(this.key, { range: { offset, length } });
    if (!obj) throw new Error(`${this.key} が R2 にありません`);
    return { data: await obj.arrayBuffer(), etag: obj.etag };
  }
}

let archive: PMTiles | undefined;

const TILE = /^\/tiles\/(\d+)\/(\d+)\/(\d+)\.mvt$/;

async function tile(env: Env, z: number, x: number, y: number) {
  archive ??= new PMTiles(new R2Source(env.TILES, "base.pmtiles"));
  // getZxy は gzip を解いて返す。転送時の圧縮は Cloudflare に任せる
  const t = await archive.getZxy(z, x, y);
  const headers = {
    "content-type": "application/x-protobuf",
    // ponytail: URL にデータの版を含めていないので1日で切る。データを作り直した直後は、最大1日古いタイルが混ざりうる
    "cache-control": "public, max-age=86400",
  };
  // 海など、タイルがない場所は 204（MapLibre は空のタイルとして扱い、エラーにしない）
  if (!t) return new Response(null, { status: 204, headers });
  return new Response(t.data, { headers });
}

async function answer(req: Request, env: Env) {
  if (req.method !== "POST")
    return new Response(null, { status: 405, headers: { allow: "POST" } });

  const ip = req.headers.get("cf-connecting-ip") ?? "";
  if (!(await env.LIMITER.limit({ key: ip })).success)
    return new Response(null, { status: 429 });

  const a = parseAnswer(await req.json().catch(() => undefined));
  if (!a) return new Response(null, { status: 400 });

  // 回答を足して、足した後の値を返す（その回答も含めた正答率になる）
  const row = await env.DB.prepare(
    `INSERT INTO island_stats (id, answers, correct) VALUES (?1, 1, ?2)
     ON CONFLICT (id) DO UPDATE SET
       answers = answers + 1,
       correct = correct + excluded.correct
     RETURNING answers, correct`,
  )
    .bind(a.id, a.correct ? 1 : 0)
    .first<{ answers: number; correct: number }>();
  return Response.json(row);
}

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    const m = pathname.match(TILE);
    if (m) return tile(env, +m[1], +m[2], +m[3]);
    if (pathname === "/api/answers") return answer(req, env);
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
