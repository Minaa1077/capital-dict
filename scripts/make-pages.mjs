#!/usr/bin/env node
/**
 * 发布装配：把交付用的单文件产物装成「可托管目录」，供 GitHub Pages / Cloudflare Pages 直接发布。
 *
 *   node scripts/build.mjs --offline                先出 dist/capital-dict-offline.html
 *   node scripts/make-pages.mjs [选项]
 *
 * 选项
 *   --base <url>     站点根地址，如 https://name.github.io/capital/（用于 canonical / og:image / 404 回跳）
 *   --domain <host>  自定义域名，如 ctrans.cn：写入 CNAME，并把 base 设成 https://<host>/
 *   --out <dir>      输出目录，默认 _site
 *
 * 为什么发布的是「单文件产物」而不是 site/ 多文件版：
 *   ① 它与投稿用的离线件**同一份字节**，md5 可直接比对，不存在「线上和交付件不一致」的风险；
 *   ② 单文件没有相对路径，部署在 /repo/ 子路径还是裸域都不会错位；
 *   ③ site/ 里带开发注释，交付件不该带（build.mjs 去注释只作用于离线版）。
 *   代价是没有分资源缓存，首次加载约 3.4 MB（gzip 后约 1 MB），评审场景可接受。
 *
 * 本脚本只做「发布态增补」，不改 dist 产物本身：单文件版由 build.mjs 剥离了 og:image，
 * 且源文件带 noindex —— 放到公网必须补回来并改成 index,follow。
 */

import { readFile, writeFile, mkdir, rm, copyFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
};
const has = (name) => argv.includes("--" + name);

const OUT = path.resolve(ROOT, arg("out", "_site"));
const SRC = path.join(ROOT, "dist", "capital-dict-offline.html");
const OG = path.join(ROOT, "site", "assets", "og-cover.png");

let domain = arg("domain", "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
let base = (arg("base", "") || process.env.PAGES_BASE || "").trim();
if (domain && !base) base = "https://" + domain + "/";
if (!base) base = "https://example.github.io/capital-dict/";
if (!/^https?:\/\//i.test(base)) base = "https://" + base;
if (!base.endsWith("/")) base += "/";
const baseUrl = base;

function fail(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

if (!existsSync(SRC)) fail("缺少 dist/capital-dict-offline.html，请先跑 node scripts/build.mjs --offline");
if (!existsSync(OG)) fail("缺少 site/assets/og-cover.png（社交分享封面）");

const html = await readFile(SRC, "utf8");
if (html.length < 1_000_000) fail("产物异常偏小（" + (html.length / 1024).toFixed(1) + " KB），请重建");

/* ── 1. 发布态 head 增补 ─────────────────────────────────────────── */
let out = html;

const ROBOTS = '<meta name="robots" content="noindex, nofollow">';
if (!out.includes(ROBOTS)) fail("未找到 noindex 声明，产物结构与预期不符");
out = out.replace(ROBOTS, '<meta name="robots" content="index,follow">');

const TW = '<meta name="twitter:card" content="summary_large_image">';
if (!out.includes(TW)) fail("未找到 twitter:card 声明，产物结构与预期不符");
const extra = [
  TW,
  '<link rel="canonical" href="' + baseUrl + '">',
  '<meta property="og:url" content="' + baseUrl + '">',
  '<meta property="og:site_name" content="《资本论》学习平台">',
  '<meta property="og:locale" content="zh_CN">',
  '<meta property="og:image" content="' + baseUrl + 'og-cover.png">',
  '<meta property="og:image:alt" content="《资本论》学习平台：词条 · 原典 · 争鸣 · 工具">',
  '<meta name="twitter:image" content="' + baseUrl + 'og-cover.png">',
].join("\n");
out = out.replace(TW, extra);

/* ── 2. 目录装配 ─────────────────────────────────────────────────── */
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

await writeFile(path.join(OUT, "index.html"), out, "utf8");
await copyFile(OG, path.join(OUT, "og-cover.png"));

/* 404：本站是 hash 路由，正常不会产生深链接 404；这里只兜「手输错路径」。
   带 hash 的访问直接回首页并把 hash 原样带回去（如 /#/c/phil）。 */
const notFound = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,follow">
<title>页面不存在 · 《资本论》学习平台</title>
<style>
  :root { color-scheme: light dark; }
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 1.2rem; padding: 2rem; box-sizing: border-box;
    background: #3d0608; color: #f6ecd6;
    font-family: "Noto Serif SC", "Songti SC", "SimSun", serif; text-align: center;
  }
  .no { font-size: clamp(3rem, 12vw, 6rem); letter-spacing: .1em; color: #c1a877; margin: 0; line-height: 1; }
  .t { font-size: clamp(1.05rem, 3.4vw, 1.4rem); letter-spacing: .14em; margin: 0; }
  .d { font-size: .85rem; letter-spacing: .08em; color: rgba(246,236,214,.62); margin: 0; line-height: 1.9; }
  a.go {
    margin-top: .6rem; padding: .7rem 1.6rem; border: 1px solid rgba(193,168,119,.55);
    color: #c1a877; text-decoration: none; letter-spacing: .18em; font-size: .85rem;
    transition: background-color .25s, color .25s;
  }
  a.go:hover { background: #c1a877; color: #3d0608; }
</style>
</head>
<body>
  <p class="no">404</p>
  <p class="t">这一页不在书里</p>
  <p class="d">地址可能输错，或该页面已经改名。<br>回到首页继续读。</p>
  <a class="go" href="${baseUrl}">回到首页</a>
<script>
(function () {
  /* 深链接被静态托管当作 404 时，把 hash 原样带回首页，用户不会丢上下文 */
  if (location.hash && location.hash.length > 1) {
    location.replace(${JSON.stringify(baseUrl)} + location.hash);
  }
})();
</script>
</body>
</html>
`;
await writeFile(path.join(OUT, "404.html"), notFound, "utf8");

await writeFile(
  path.join(OUT, "robots.txt"),
  "User-agent: *\nAllow: /\n\nSitemap: " + baseUrl + "sitemap.xml\n",
  "utf8"
);
await writeFile(
  path.join(OUT, "sitemap.xml"),
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    "  <url><loc>" + baseUrl + "</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>\n" +
    "</urlset>\n",
  "utf8"
);
/* .nojekyll：跳过 Jekyll（否则下划线开头的文件会被忽略、构建更慢） */
await writeFile(path.join(OUT, ".nojekyll"), "", "utf8");
if (domain) await writeFile(path.join(OUT, "CNAME"), domain + "\n", "utf8");

/* ── 3. 报告 ─────────────────────────────────────────────────────── */
const md5 = (buf) => createHash("md5").update(buf).digest("hex");
const idx = await readFile(path.join(OUT, "index.html"));
const srcBuf = await readFile(SRC);
const kb = (n) => (n / 1024).toFixed(1) + " KB";

console.log("发布目录：" + path.relative(ROOT, OUT));
console.log("  站点根地址  " + baseUrl + (baseUrl.includes("example.github.io") ? "   ⚠ 占位地址，请用 --base 覆盖" : ""));
console.log("  index.html  " + kb(idx.length) + "   md5 " + md5(idx) + (md5(idx) === md5(srcBuf) ? "（与 dist 一致）" : "（已增补 head，内容不同属正常）"));
console.log("  404.html    " + kb((await stat(path.join(OUT, "404.html"))).size));
console.log("  og-cover    " + kb((await stat(path.join(OUT, "og-cover.png"))).size));
console.log("  附：robots.txt / sitemap.xml / .nojekyll" + (domain ? " / CNAME(" + domain + ")" : ""));
console.log("");
console.log("下一步：");
console.log("  · 本地预览  npx serve " + path.relative(ROOT, OUT) + "   （或 python -m http.server -d " + path.relative(ROOT, OUT) + " 8080）");
console.log("  · 推送后由 .github/workflows/pages.yml 自动构建发布；详见 DEPLOY-PAGES.md");
