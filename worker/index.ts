/**
 * 静的アセットの配信と、島ごとの正答率の集計 API（/api/answers）。
 * /api/* 以外は Worker を通らず、アセットとして直接返る（wrangler.jsonc の run_worker_first）
 */
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

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname !== "/api/answers") return env.ASSETS.fetch(req);
    if (req.method !== "POST")
      return new Response(null, { status: 405, headers: { allow: "POST" } });

    const ip = req.headers.get("cf-connecting-ip") ?? "";
    if (!(await env.LIMITER.limit({ key: ip })).success)
      return new Response(null, { status: 429 });

    const answer = parseAnswer(await req.json().catch(() => undefined));
    if (!answer) return new Response(null, { status: 400 });

    // 回答を足して、足した後の値を返す（その回答も含めた正答率になる）
    const row = await env.DB.prepare(
      `INSERT INTO island_stats (id, answers, correct) VALUES (?1, 1, ?2)
       ON CONFLICT (id) DO UPDATE SET
         answers = answers + 1,
         correct = correct + excluded.correct
       RETURNING answers, correct`,
    )
      .bind(answer.id, answer.correct ? 1 : 0)
      .first<{ answers: number; correct: number }>();
    return Response.json(row);
  },
} satisfies ExportedHandler<Env>;
