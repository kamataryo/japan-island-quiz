/**
 * pnpm data で作った base.pmtiles を GitHub Release に上げる。タグは YYYY-MM-DD-{sha256 の先頭12桁}。
 * --tag ならタグ名だけを出す（deploy が meta.json に対応する Release を取るのに使う）
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const PMTILES = "public/data/base.pmtiles";
const { generatedAt, pmtilesSha256 } = JSON.parse(
  readFileSync("public/data/meta.json", "utf8"),
);
const tag = `${generatedAt.slice(0, 10)}-${pmtilesSha256.slice(0, 12)}`;

if (process.argv.includes("--tag")) {
  console.log(tag);
} else {
  const sha = createHash("sha256").update(readFileSync(PMTILES)).digest("hex");
  if (sha !== pmtilesSha256)
    throw new Error(`${PMTILES} が meta.json の pmtilesSha256 と違います`);
  execFileSync("gh", ["release", "create", tag, PMTILES, "--title", tag], {
    stdio: "inherit",
  });
}
