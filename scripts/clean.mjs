#!/usr/bin/env node
/* 项目体积清理
 *
 *   node scripts/clean.mjs          清掉临时文件与测试残留（零风险，随时可跑）
 *   node scripts/clean.mjs --deep   连可重装的依赖与可重算的缓存一起清
 *   node scripts/clean.mjs --dry    只列出将删什么、能省多少，不动盘
 *
 * 设计前提：**只删「能重新生成」或「本轮测试才产生」的东西**。
 *   · 构建产物 dist/、数据 data/、源码 site/ pathflow/src pictorial/site 一律不碰；
 *   · 两个母版目录（pictorial/tmp/gen、marx-book/）不碰 —— 见 STORAGE.md 的取舍一节；
 *   · 交付材料 dist/投稿材料/ 不碰（但会提示它与产物是否同步）。
 *
 * 为什么需要它：无头 Edge 的 profile 每个约 500 MB，测试脚本一旦漏清就会堆积
 * （本项目曾累计 66 个 / 17 GB）。与其靠人记着，不如留一条可重复执行的命令。
 */
import { readdir, stat, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const P = (...s) => resolve(ROOT, ...s);

const DEEP = process.argv.includes("--deep");
const DRY = process.argv.includes("--dry");

/* 文档里点名引用的截图，删了会让 PHASE4「证据」一节指向空文件 */
const KEEP = [/^v58-(landing|viewer|dark)\.png$/];

async function sizeOf(p) {
  let s = 0;
  const st = await stat(p).catch(() => null);
  if (!st) return 0;
  if (st.isFile()) return st.size;
  const stack = [p];
  while (stack.length) {
    const d = stack.pop();
    const ents = await readdir(d, { withFileTypes: true }).catch(() => []);
    for (const e of ents) {
      const f = join(d, e.name);
      if (e.isDirectory()) stack.push(f);
      else s += (await stat(f).catch(() => ({ size: 0 }))).size;
    }
  }
  return s;
}

/* ---------- 规则表 ---------- */
const jobs = [];

/* ① 测试残留：每次 run-edge*.sh 可能留下的浏览器 profile。
      浏览器被强杀时目录删不干净，体积 100–500 MB 不等。 */
for (const base of ["tmp", "pictorial/tmp"]) {
  const dir = P(base);
  if (!existsSync(dir)) continue;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory() && /^edgeprof/.test(e.name)) {
      jobs.push({ p: join(dir, e.name), why: "无头浏览器 profile（测试残留）", tier: 0 });
    }
  }
}

/* ② 关系图编辑器套件每次自建的场景目录（8 个副本 × 主文件） */
jobs.push({ p: P("tmp/pfcase-v56"), why: "pathfind 套件的场景夹具（下次运行会重建）", tier: 0 });
jobs.push({ p: P("tmp/.pf hidden"), why: "隐藏目录场景夹具", tier: 0 });

/* ③ 调试截图：只留文档引用过的那三张 */
for (const dir of [P("tmp"), P("pictorial/tmp")]) {
  if (!existsSync(dir)) continue;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (!e.isFile() || !/\.png$/i.test(e.name)) continue;
    if (KEEP.some((re) => re.test(e.name))) continue;
    jobs.push({ p: join(dir, e.name), why: "调试截图", tier: 0 });
  }
}

/* ④ 过期数据备份（data/terms.json 才是权威） */
jobs.push({ p: P("tmp/terms.json.bak-v25"), why: "过期数据快照", tier: 0 });

/* ---------- 深度清理：可重装 / 可重算 ---------- */
if (DEEP) {
  jobs.push({ p: P("pathflow/node_modules"), why: "依赖包（npm ci 可还原）", tier: 1 });
  for (const f of ["cache_cap.pkl", "cache_vol1.pkl", "cache_vol2.pkl", "cache_vol3.pkl", "cache_vol4.pkl"]) {
    jobs.push({ p: P("tools/pdf", f), why: "PDF 取字缓存（重跑脚本即重建）", tier: 1 });
  }
  for (const d of ["zoom", "frames", "gen-de", "de-preview", "de-compare", "plates", "orig-plate"]) {
    jobs.push({ p: P("pictorial/tmp", d), why: "画传中间出图（非成图母版）", tier: 1 });
  }
}

/* ---------- 执行 ---------- */
let total = 0;
let hit = 0;
const rows = [];
for (const j of jobs) {
  if (!existsSync(j.p)) continue;
  const mb = (await sizeOf(j.p)) / 1048576;
  if (mb < 0.001) continue;
  hit++;
  total += mb;
  rows.push([j.tier === 1 ? "P1" : "P0", mb, j.p.replace(ROOT, ".").replace(/\\/g, "/"), j.why]);
}

rows.sort((a, b) => b[1] - a[1]);
if (!rows.length) {
  console.log("✓ 没有可清理的临时文件");
} else {
  console.log((DRY ? "将清理" : "清理") + " " + rows.length + " 项，共 " + total.toFixed(1) + " MB\n");
  for (const [t, mb, p, why] of rows.slice(0, 40)) {
    console.log("  [" + t + "] " + mb.toFixed(1).padStart(7) + " MB  " + p + "  — " + why);
  }
  if (rows.length > 40) console.log("  …… 另有 " + (rows.length - 40) + " 项");
}

if (!DRY && rows.length) {
  for (const j of jobs) {
    if (!existsSync(j.p)) continue;
    await rm(j.p, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 }).catch(() => {});
  }
  console.log("\n✓ 完成。复测：node scripts/clean.mjs --dry");
}

/* ---------- 顺带核对：投稿包与产物是否同步（只读，不改盘） ---------- */
const pack = P("dist/投稿材料/AIGC创意作品《资本论学习平台》离线演示材料.html");
const prod = P("dist/capital-dict-offline.html");
if (existsSync(pack) && existsSync(prod)) {
  const [a, b] = await Promise.all([readFile(pack), readFile(prod)]);
  const same = a.length === b.length && a.equals(b);
  console.log(same
    ? "\n✓ 投稿包内 html 与 dist 主产物一致（" + (b.length / 1024).toFixed(1) + " KB）"
    : "\n! 投稿包内 html 与 dist 主产物不一致 —— 先跑 node scripts/make-submission.mjs");
}

/* ---------- 提示不可删的东西 ---------- */
const masters = [
  ["pictorial/tmp/gen", "画传 21 幅成图的原始出图，postprocess-plates.py 的输入"],
  ["marx-book", "儿童绘本归档；raw/ 是唯一无损母版（v49 起不进交付链）"],
];
const alive = [];
for (const [rel, note] of masters) {
  if (existsSync(P(rel))) alive.push(rel + "  " + ((await sizeOf(P(rel))) / 1048576).toFixed(1) + " MB  — " + note);
}
if (alive.length) {
  console.log("\n保留（母版，删了不可再生）：");
  alive.forEach((s) => console.log("  · " + s));
}
