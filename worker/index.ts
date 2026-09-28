/**
 * 静的アセットの配信に加えて、次の2つを Worker で処理する（wrangler.jsonc の run_worker_first）。
 * - /tiles/{版}/{z}/{x}/{y}.mvt: R2 に置いた base.pmtiles から1枚ずつ返す（版は TILES_VERSION）
 * - /api/answers: 島ごとの正答率の集計（POST で回答を足し、GET ?ids= で1ゲーム分をまとめて読む）
 * - /api/plays: 1プレイごとの得点の記録（POST のみ。集計は wrangler d1 execute で SQL を直接書く）
 */
import { PMTiles, type RangeResponse, type Source } from "pmtiles";
import difficulty from "../config/difficulty.json";
import regions from "../config/regions.json";
import islands from "../public/data/islands.json";
import { TILES_VERSION } from "../src/tiles-version.ts";

const IDS = new Set(islands.map((x) => x.id));
const MODES = new Set([...difficulty.bands, ...regions].map((x) => x.name));

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

/** 送られてきた得点を検証する。1ゲームは最大10問 */
export function parsePlay(
  body: unknown,
): { mode: string; score: number; questions: number } | undefined {
  if (typeof body !== "object" || body === null) return;
  const { mode, score, questions } = body as Record<string, unknown>;
  if (
    typeof mode !== "string" ||
    !MODES.has(mode) ||
    !Number.isInteger(questions) ||
    !Number.isInteger(score) ||
    (questions as number) < 1 ||
    (questions as number) > 10 ||
    (score as number) < 0 ||
    (score as number) > (questions as number)
  )
    return;
  return { mode, score: score as number, questions: questions as number };
}

/** GET の ?ids=a,b,c を検証する。1ゲーム分（10問）より多いもの・実在しない島を含むものは弾く */
export function parseIds(param: string | null): string[] | undefined {
  const ids = param?.split(",") ?? [];
  if (ids.length === 0 || ids.length > 10 || !ids.every((id) => IDS.has(id)))
    return;
  return ids;
}

/**
 * R2 の PMTiles を isolate ごとに1回だけ丸ごと読み、以降はメモリから切り出す。
 * R2 の範囲読み出しは1回ごとに数百 ms かかり、タイル1枚にヘッダ・ディレクトリ・本体と続けて読むと 1 秒近くになっていたため
 */
// ponytail: ファイル全体（約25MB）をメモリに置く。Worker のメモリ上限は 128MB なので、PMTiles が 60MB を超えるようなら範囲読み出し＋Cache API（独自ドメインが必要）に戻す
class R2Source implements Source {
  private file?: Promise<{ data: ArrayBuffer; etag: string }>;
  constructor(
    private bucket: R2Bucket,
    private key: string,
  ) {}
  getKey() {
    return this.key;
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    this.file ??= this.bucket.get(this.key).then(async (obj) => {
      if (!obj) throw new Error(`${this.key} が R2 にありません`);
      return { data: await obj.arrayBuffer(), etag: obj.etag };
    });
    // 読み込みに失敗したら次のリクエストで読み直す
    const { data, etag } = await this.file.catch((e) => {
      this.file = undefined;
      throw e;
    });
    return { data: data.slice(offset, offset + length), etag };
  }
}

let archive: PMTiles | undefined;

const TILE = /^\/tiles\/(?:([0-9a-f]+)\/)?(\d+)\/(\d+)\/(\d+)\.mvt$/;

async function tile(
  env: Env,
  version: string | undefined,
  z: number,
  x: number,
  y: number,
) {
  archive ??= new PMTiles(new R2Source(env.TILES, "base.pmtiles"));
  // getZxy は gzip を解いて返す。転送時の圧縮は Cloudflare に任せる
  const t = await archive.getZxy(z, x, y);
  const headers = {
    "content-type": "application/x-protobuf",
    // 版が一致すれば中身は変わらないので長くキャッシュさせる。
    // 版なし・古い版（デプロイ前に開いたページ）には今のデータを返すが、別の版の中身なのでキャッシュさせない
    "cache-control":
      version === TILES_VERSION
        ? "public, max-age=31536000, immutable"
        : "no-store",
  };
  // 海など、タイルがない場所は 204（MapLibre は空のタイルとして扱い、エラーにしない）
  if (!t) return new Response(null, { status: 204, headers });
  return new Response(t.data, { headers });
}

async function answer(req: Request, env: Env) {
  if (req.method === "GET") {
    // 読むだけなのでレート制限はかけない
    const ids = parseIds(new URL(req.url).searchParams.get("ids"));
    if (!ids) return new Response(null, { status: 400 });
    const { results } = await env.DB.prepare(
      `SELECT id, answers, correct FROM island_stats WHERE id IN (${ids.map(() => "?").join(",")})`,
    )
      .bind(...ids)
      .all<{ id: string; answers: number; correct: number }>();
    // まだ回答がない島は含めない
    return Response.json(results);
  }
  if (req.method !== "POST")
    return new Response(null, { status: 405, headers: { allow: "GET, POST" } });

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

async function play(req: Request, env: Env) {
  if (req.method !== "POST")
    return new Response(null, { status: 405, headers: { allow: "POST" } });
  const ip = req.headers.get("cf-connecting-ip") ?? "";
  if (!(await env.LIMITER.limit({ key: ip })).success)
    return new Response(null, { status: 429 });
  const p = parsePlay(await req.json().catch(() => undefined));
  if (!p) return new Response(null, { status: 400 });
  await env.DB.prepare(
    "INSERT INTO plays (mode, score, questions) VALUES (?, ?, ?)",
  )
    .bind(p.mode, p.score, p.questions)
    .run();
  return new Response(null, { status: 204 });
}

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    const m = pathname.match(TILE);
    if (m) return tile(env, m[1], +m[2], +m[3], +m[4]);
    if (pathname === "/api/answers") return answer(req, env);
    if (pathname === "/api/plays") return play(req, env);
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
