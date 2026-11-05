/* 生成投稿材料（离线跑，不依赖浏览器）
 *
 *   node scripts/make-submission.mjs
 *
 * 落盘位置：dist/投稿材料/
 *
 * 2026-11-05（v86）起投稿包只保留两部分 —— 作者要求「仅保留创作说明与网站及组件」：
 *   ① 创作说明：AIGC创意作品《资本论》学习平台创作说明.docx / .pdf（同文两种格式）
 *   ② 网站及组件：AIGC创意作品《资本论》学习平台网站及组件.zip
 *      （主站离线版 html ＋ pathflow.html ＋ marx-pictorial.html，平铺、双击即开）
 * 核验台账、逐条透明记录、投稿登记表、材料更新日志已移出投稿包，
 * 旧件在 backup/submission-bak-v86/；投稿登记表按征稿启事在文末链接在线填写。
 *
 * ⚠ v59 变更：站点已删除「创作说明」页与全部导出按钮，本脚本**不截取页面字节**；
 *   文档由 tools/submission/*.py 现生成，本脚本只做存在性校验与打包。
 * 顺序：make-statement.py → make-pdf.py → 本脚本（内部再调 make-site-zip.py）。
 */
import { readFile, mkdir, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const P = (...s) => resolve(ROOT, ...s);
const OUT = P("dist/投稿材料");
const CAT = "AIGC创意作品";
const WORK = "《资本论》学习平台";

/* 两件文档：成品按命名要求在包内，只做存在性校验与体积登记。
   命名＝成果类别＋成果题目＋材料类型。 */
const DOCS = [
  CAT + WORK + "创作说明.docx",
  CAT + WORK + "创作说明.pdf",
];

const made = [];
await mkdir(OUT, { recursive: true });

for (const name of DOCS) {
  try {
    const buf = await readFile(resolve(OUT, name));
    if (buf.length < 4096) {
      console.log("！疑似空件：" + name + "（" + buf.length + " 字节）");
      continue;
    }
    made.push([name + "（沿用既有）", buf]);
  } catch {
    console.log("！缺件：" + name + " —— 先跑 tools/submission/make-statement.py 与 make-pdf.py");
  }
}

/* 第二部分「网站及组件」：由 Python 打包并回读校验（包内字节必须等于 dist 源文件）。 */
const ZIP = CAT + WORK + "网站及组件.zip";
const r = spawnSync("python", ["tools/submission/make-site-zip.py"], {
  cwd: ROOT,
  encoding: "utf8",
});
if (r.status !== 0) {
  console.log("！网站及组件打包失败：\n" + ((r.stdout || "") + (r.stderr || "")).trim());
} else {
  process.stdout.write(r.stdout);
  made.push([ZIP, await readFile(resolve(OUT, ZIP))]);
}

const md5 = (b) => createHash("md5").update(b).digest("hex").slice(0, 12);

/* 旧件清理：v86 起这四类不再进投稿包，若还留在包里会被当成附件发出去；
   另外清 v85 及更早的旧命名件（《资本论学习平台》写法、散放的组件与更新日志副本）。 */
const LEGACY = [
  CAT + WORK + "创作说明（含附表）.docx",
  CAT + WORK + "核验台账.xlsx",
  CAT + WORK + "逐条透明记录.docx",
  CAT + WORK + "投稿登记表.docx",
  CAT + WORK + "材料更新日志.md",
  CAT + WORK + "作品（离线演示材料）.html",
  "pathflow.html",
  "marx-pictorial.html",
  "AIGC创意作品《资本论学习平台》创作说明.docx",
  "AIGC创意作品《资本论学习平台》创作说明.pdf",
  "AIGC创意作品《资本论学习平台》创作说明（含附表）.docx",
  "AIGC创意作品《资本论学习平台》核验台账.xlsx",
  "AIGC创意作品《资本论学习平台》逐条透明记录.docx",
  "AIGC创意作品《资本论学习平台》离线演示材料.html",
  "投稿材料更新日志.md",
];
for (const n of LEGACY) {
  try {
    await unlink(resolve(OUT, n));
    console.log("－ 已清理旧件：" + n);
  } catch { /* 不存在即正常 */ }
}

made.forEach(([n, b]) => {
  console.log("✓ " + n + "  " + (b.length / 1024).toFixed(1) + " KB  md5 " + md5(b));
});

console.log("\n输出目录：" + OUT + "（两部分共 " + made.length + " 件）");
process.exit(0);
