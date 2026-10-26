/* 生成投稿材料（离线跑，不依赖浏览器）
 *
 *   node scripts/make-submission.mjs
 *
 * 落盘位置：dist/投稿材料/
 *
 * ⚠ v59 变更：站点已删除「创作说明」页与全部导出按钮（cm-word / cm-word-full /
 *   cm-ledger-word / cm-ledger-xlsx），相应地 viewAbout 也不再装载 credit_meta。
 *   因此本脚本**不再从页面里截取字节**，改为：
 *     ① 五个文档 —— 沿用 `dist/投稿材料/` 里既有的成品（正文由 data/terms.json 冻结，
 *        这些文件的内容不随站点改版变化，无需重生成）；
 *     ② 离线演示 html —— 每次从 dist 重新拷贝（唯一会随代码变化的件）；
 *     ③ 两个独立件：pathflow.html、marx-pictorial.html 必须同目录，否则演示里那两路
 *        只剩降级说明卡。
 *
 * 若将来确实要改「创作说明」正文：生成器已随页面移除，需先从 PHASE3.md/PHASE4.md
 * 记载的 v58 代码状态恢复 cmBind 那一段，或直接改 docx（正文 972 字，六要素结构固定）。
 */
import { readFile, mkdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const P = (...s) => resolve(ROOT, ...s);
const OUT = P("dist/投稿材料");

/* 五个文档：成品已在包内，内容冻结，只做存在性校验与体积登记。
   体积只用于肉眼核对「有没有被空文件顶替」，不当作断言。 */
const DOCS = [
  "AIGC创意作品《资本论学习平台》创作说明.docx",
  "AIGC创意作品《资本论学习平台》创作说明.pdf",
  "AIGC创意作品《资本论学习平台》创作说明（含附表）.docx",
  "AIGC创意作品《资本论学习平台》核验台账.xlsx",
  "AIGC创意作品《资本论学习平台》逐条透明记录.docx",
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
    console.log("！缺件：" + name + " —— 见 PHASE4.md「创作说明」一节，勿静默投稿");
  }
}

/* 离线演示材料：唯一每次都要重拷的件。它与 dist 主产物必须同一份字节。 */
const offline = "AIGC创意作品《资本论学习平台》离线演示材料.html";
let offlineBuf = null;
try {
  offlineBuf = await readFile(P("dist/capital-dict-offline.html"));
  await copyFile(P("dist/capital-dict-offline.html"), resolve(OUT, offline));
  made.push([offline, offlineBuf]);
} catch (e) {
  console.log("！离线演示材料拷贝失败（先跑 node scripts/build.mjs --offline）：" +
    ((e && e.message) || e).toString().split("\n")[0]);
}

/* 概念关系图编辑器是独立件（v39 起），与主文件同目录才会被内嵌。
   投稿包里少这一份，工具台那一件就只剩说明卡 —— 所以必须一并带上。 */
try {
  const buf = await readFile(P("dist/pathflow.html"));
  await copyFile(P("dist/pathflow.html"), resolve(OUT, "pathflow.html"));
  made.push(["pathflow.html（概念关系图编辑器，与主文件同目录）", buf]);
} catch (e) {
  console.log("！pathflow.html 未找到（先跑 pathflow 的 npm run build && node tools/publish.mjs）：" +
    ((e && e.message) || e).toString().split("\n")[0]);
}

/* 《马克思画传》同理，而且是**同一类坑**：首页与导航里的「画传」入口
   是一个 iframe，src 写的是同目录的 marx-pictorial.html。包里不带这一份，
   离线演示里那一路就只能看到「与本站产物不在同一目录」的降级提示。 */
try {
  const buf = await readFile(P("dist/marx-pictorial.html"));
  await copyFile(P("dist/marx-pictorial.html"), resolve(OUT, "marx-pictorial.html"));
  made.push(["marx-pictorial.html（《马克思画传》，与主文件同目录）", buf]);
} catch (e) {
  console.log("！marx-pictorial.html 未找到（先跑 node pictorial/scripts/build-pictorial.mjs）：" +
    ((e && e.message) || e).toString().split("\n")[0]);
}

const md5 = (b) => createHash("md5").update(b).digest("hex").slice(0, 12);

made.forEach(([n, b]) => {
  console.log("✓ " + n + "  " + (b.length / 1024).toFixed(1) + " KB  md5 " + md5(b));
});

/* 投稿前置：包内离线演示 html 必须与 dist 主产物逐字节一致。
   （v50–v58 曾因忘记重跑本脚本，包内 html 落后九个版本。） */
if (offlineBuf) {
  const inPack = await readFile(resolve(OUT, offline));
  const same = createHash("md5").update(inPack).digest("hex") === createHash("md5").update(offlineBuf).digest("hex");
  console.log(same
    ? "\n✓ 投稿包内 html 与 dist 主产物一致（md5 " + md5(inPack) + "）"
    : "\n✗ 投稿包内 html 与 dist 主产物不一致，勿投稿");
}

console.log("\n输出目录：" + OUT);
process.exit(0);
