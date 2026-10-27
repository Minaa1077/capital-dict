#!/usr/bin/env node
/**
 * 自定义域名 / Cloudflare 接入的**验收脚本**（零依赖，Node 18+）
 *
 *   node scripts/verify-domain.mjs <域名或地址>
 *   node scripts/verify-domain.mjs example.com
 *   node scripts/verify-domain.mjs https://example.com/
 *   node scripts/verify-domain.mjs https://minaa1077.github.io/capital-dict/   # 未绑域时的对照
 *
 * 查什么（逐条打勾；有失败项时退出码为 1，可直接接进 CI / pre-push）：
 *   ① DNS：裸域与 www 实际解析到什么（GitHub Pages 的 4 个 A / Cloudflare 代理 IP / CNAME 目标）
 *   ② HTTP：http → https 是否跳转；https 是否 200；响应头 server / cache-control / cf-cache-status
 *   ③ TLS：证书签发者、到期时间、SAN 是否覆盖该域；ALPN 是否 h2（HTTP/2）
 *   ④ 页面：title、canonical、og:url、robots —— 换域后最容易漏的就是 canonical 仍指旧域
 *   ⑤ 子页：marx-pictorial.html / pathflow.html 是否 200 且体积正常（缺一个，对应入口就 404）
 *   ⑥ 兜底：不存在的路径是否返回站内 404 页（而不是 Cloudflare 的 522/523 裸页）
 *
 * 只读，不改任何配置。DNS 用系统解析器（与浏览器同一条路）；
 * 若本机解析器被代理/VPN 拦掉，脚本会把该项标成「跳过」而不是「失败」，并提示换网络重跑。
 */

import { promises as dns } from "node:dns";
import https from "node:https";
import http from "node:http";
import tls from "node:tls";
import { URL } from "node:url";

const raw = process.argv.slice(2).find((a) => !a.startsWith("--")) || "";
if (!raw) {
  console.error("用法：node scripts/verify-domain.mjs <域名或地址>");
  process.exit(2);
}
const BASE = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
if (!BASE.pathname.endsWith("/")) BASE.pathname += "/";
const HOST = BASE.hostname;
const APEX = HOST.replace(/^www\./, "");

const GH_A = ["185.199.108.153", "185.199.109.153", "185.199.110.153", "185.199.111.153"];
const GH_AAAA = ["2606:50c0:8000::153", "2606:50c0:8001::153", "2606:50c0:8002::153", "2606:50c0:8003::153"];
/* Cloudflare 常见出口网段（够判「橙云代理」即可，不求穷举） */
const CF_PREFIX = ["104.", "172.64.", "172.65.", "172.66.", "172.67.", "188.114.", "162.159.",
  "173.245.", "103.21.", "103.22.", "103.31.", "141.101.", "108.162.", "190.93.",
  "197.234.", "198.41.", "131.0.72.", "2606:4700"];

let pass = 0, fail = 0, warn = 0, skip = 0;
const ok = (c, m) => { c ? (pass++, console.log("  ✓ " + m)) : (fail++, console.log("  ✗ " + m)); };
const note = (m) => { warn++, console.log("  ! " + m); };
const skipped = (m) => { skip++, console.log("  – " + m + "（跳过，不计失败）"); };
const isCF = (ip) => CF_PREFIX.some((p) => ip.startsWith(p));

function req(urlStr, { method = "GET", timeout = 30000 } = {}) {
  return new Promise((resolve) => {
    const u = new URL(urlStr);
    const mod = u.protocol === "http:" ? http : https;
    const t0 = Date.now();
    let first = 0;
    const r = mod.request({
      protocol: u.protocol, hostname: u.hostname,
      port: u.port || (u.protocol === "http:" ? 80 : 443),
      path: u.pathname + u.search, method,
      headers: { "user-agent": "capital-dict-domain-check/1.0", "accept-encoding": "identity" },
      servername: u.hostname, timeout,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => { if (!first) first = Date.now() - t0; chunks.push(c); });
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, body, size: body.length,
          ttfb: first || Date.now() - t0, ms: Date.now() - t0 });
      });
    });
    r.on("timeout", () => r.destroy(new Error("timeout")));
    r.on("error", (e) => resolve({ error: e.message, ms: Date.now() - t0 }));
    r.end();
  });
}

/* 证书与 ALPN：单独握手一次，http 响应里拿不到干净结果 */
function tlsProbe(host, timeout = 12000) {
  return new Promise((resolve) => {
    let done = false;
    const s = tls.connect({ host, port: 443, servername: host, ALPNProtocols: ["h2", "http/1.1"], timeout }, () => {
      if (done) return;
      done = true;
      const c = s.getPeerCertificate() || {};
      resolve({ alpn: s.alpnProtocol || "", proto: s.getProtocol() || "",
        subject: (c.subject && (c.subject.CN || c.subject.O)) || "",
        issuer: (c.issuer && (c.issuer.O || c.issuer.CN)) || "",
        validTo: c.valid_to || "", san: c.subjectaltname || "" });
      s.end();
    });
    s.on("timeout", () => { if (!done) { done = true; resolve({ error: "timeout" }); } s.destroy(); });
    s.on("error", (e) => { if (!done) { done = true; resolve({ error: e.message }); } });
  });
}

console.log(`\n验收目标：${BASE.href}\n主机：${HOST}（裸域 ${APEX}）`);

/* ── ① DNS ─────────────────────────────────────────────── */
console.log("\n[① DNS 解析]");
async function resolveSet(name) {
  const out = { a4: [], a6: [], cname: [], unavailable: false };
  try {
    const all = await dns.lookup(name, { all: true, verbatim: true });
    for (const r of all) (r.family === 6 ? out.a6 : out.a4).push(r.address);
  } catch (e) {
    if (e.code === "ENOTFOUND" || e.code === "ENODATA") return out;   /* 真的没有记录 */
    out.unavailable = true;
  }
  try { out.cname = await dns.resolveCname(name); } catch (e) { /* 非 CNAME，或本机不支持 CNAME 查询 */ }
  return out;
}
const apexDns = await resolveSet(APEX);
const hostDns = HOST === APEX ? apexDns : await resolveSet(HOST);
const dnsBlocked = apexDns.unavailable || hostDns.unavailable;

if (dnsBlocked) {
  skipped("DNS 查询（本机解析器被代理/VPN 拦截，换手机热点或关代理后重跑）");
} else {
  for (const [label, set] of [["裸域 " + APEX, apexDns], ["主机 " + HOST, hostDns]]) {
    const all = [...set.a4, ...set.a6];
    if (!all.length && !set.cname.length) {
      ok(false, `${label}：无任何解析记录（域名未生效 / NS 未切到 Cloudflare）`);
      continue;
    }
    console.log(`  · ${label}：A=${set.a4.join(", ") || "-"}　AAAA=${set.a6.join(", ") || "-"}　CNAME=${set.cname.join(", ") || "-"}`);
    if (all.some(isCF)) console.log("    → Cloudflare 代理（橙云）");
    else if (set.a4.some((ip) => GH_A.includes(ip)) || set.a6.some((ip) => GH_AAAA.includes(ip)))
      console.log("    → 直指 GitHub Pages（灰云 / 纯 DNS）");
    else note(`${label} 的解析值不在 GitHub 或 Cloudflare 网段内，核对记录是否填错`);
    ok(true, `${label} 有解析`);
  }
  if (hostDns.cname.length) {
    ok(hostDns.cname.every((c) => /\.github\.io$/i.test(c) || !/github\.io/i.test(c)),
      "CNAME 只写 <用户名>.github.io，没有带仓库名/路径（" + hostDns.cname.join(",") + "）");
  } else {
    note("没读到 CNAME（裸域用 A/AAAA 属正常；子域想确认可跑 nslookup -type=CNAME " + HOST + "）");
  }
}

/* ── ② HTTP / 跳转 ─────────────────────────────────────── */
console.log("\n[② HTTP 与跳转]");
const hres = await req("http://" + HOST + BASE.pathname, { method: "HEAD" });
if (hres.error) note("http 请求失败（" + hres.error + "）：只监听 443 时属正常");
else {
  const loc = hres.headers.location || "";
  ok([301, 302, 308].includes(hres.status) && /^https:/.test(loc),
    `http → https 跳转（${hres.status} → ${loc || "无 Location"}）`);
}

const res = await req(BASE.href);
if (res.error) {
  ok(false, "https 请求失败：" + res.error + "（域名未生效 / 证书未签发 / 源站 5xx）");
} else {
  console.log(`  · ${res.status}　${(res.size / 1024).toFixed(0)} KB　首字节 ${res.ttfb}ms　总计 ${res.ms}ms`);
  ok(res.status === 200, "首页返回 200");
  const srv = String(res.headers.server || "");
  console.log(`  · server: ${srv || "-"}　cache-control: ${res.headers["cache-control"] || "-"}　cf-cache-status: ${res.headers["cf-cache-status"] || "-"}`);
  if (/cloudflare/i.test(srv)) console.log("    → 经 Cloudflare 边缘（橙云已生效）");
  else if (/github/i.test(srv)) console.log("    → 直连 GitHub Pages（灰云 / 纯 DNS）");
  if (!res.headers["cf-cache-status"]) note("没有 cf-cache-status：未走 Cloudflare 缓存（灰云，或没建缓存规则）");
}

/* ── ③ TLS ─────────────────────────────────────────────── */
console.log("\n[③ TLS 证书与 ALPN]");
const t = await tlsProbe(HOST);
if (t.error) skipped("TLS 握手（" + t.error + "）");
else {
  const to = t.validTo ? new Date(t.validTo) : null;
  const days = to ? Math.round((to - Date.now()) / 86400000) : null;
  console.log(`  · 主体 ${t.subject}　签发者 ${t.issuer}　到期 ${to ? to.toISOString().slice(0, 10) : "-"}（剩 ${days} 天）`);
  console.log(`  · ${t.proto}　ALPN ${t.alpn || "-"}　SAN ${String(t.san).slice(0, 140)}`);
  ok(!!t.subject, "证书有主体名");
  ok(days === null || days > 7, "证书未临近过期（剩 " + days + " 天）");
  /* SAN 形如 "DNS:example.com, DNS:*.example.com"，通配只能跨一级 */
  const sans = String(t.san).split(/,\s*/).map((x) => x.replace(/^DNS:/i, "").trim()).filter(Boolean);
  const covered = (name) => sans.some((p) => {
    if (p === name) return true;
    if (p.startsWith("*.")) return name.split(".").length === p.split(".").length &&
      name.endsWith(p.slice(1));
    return false;
  });
  ok(covered(HOST) || covered(APEX), "SAN 覆盖 " + HOST + "（" + (sans.join(" / ").slice(0, 90)) + "）");
  ok(t.alpn === "h2", "ALPN 协商到 HTTP/2（" + (t.alpn || "无") + "）");
  if (/github/i.test(t.issuer)) console.log("    → GitHub 为自定义域自动签发的 Let's Encrypt 证书（源站侧）");
  if (/cloudflare|google trust/i.test(t.issuer)) console.log("    → Cloudflare 边缘证书（Universal SSL）");
}

/* ── ④ 页面元信息 ──────────────────────────────────────── */
console.log("\n[④ 页面元信息（换域后最容易漏）]");
const html = res.body && res.body.length ? res.body.toString("utf8") : "";
if (!html) skipped("页面元信息（首页没取到内容）");
else {
  const pick = (re) => (html.match(re) || [])[1] || "";
  const title = pick(/<title>([^<]*)<\/title>/i);
  const canon = pick(/<link rel="canonical" href="([^"]*)"/i);
  const ogurl = pick(/<meta property="og:url" content="([^"]*)"/i);
  const ogimg = pick(/<meta property="og:image" content="([^"]*)"/i);
  const robots = pick(/<meta name="robots" content="([^"]*)"/i);
  console.log(`  · title: ${title.slice(0, 48)}`);
  console.log(`  · canonical: ${canon || "-"}`);
  console.log(`  · og:url: ${ogurl || "-"}`);
  console.log(`  · og:image: ${ogimg || "-"}`);
  ok(!!title, "有 <title>");
  ok(canon === BASE.href, `canonical 指向本站（${canon || "缺"}）`);
  ok(!canon || new URL(canon).host === HOST, "canonical 主机名与访问域名一致（否则搜索引擎仍认旧域）");
  ok(/index/.test(robots), "robots 允许收录（" + (robots || "缺") + "）");
  if (ogurl && new URL(ogurl).host !== HOST) note("og:url 仍指向旧域名：" + ogurl);
}

/* ── ⑤ 子页 ────────────────────────────────────────────── */
console.log("\n[⑤ 子页（缺一个，对应入口就 404）]");
for (const [file, minKB] of [["marx-pictorial.html", 3000], ["pathflow.html", 300]]) {
  const r = await req(BASE.href + file, { method: "HEAD" });
  if (r.error) { ok(false, `${file}：${r.error}`); continue; }
  const kb = Number(r.headers["content-length"] || 0) / 1024;
  ok(r.status === 200, `${file} 返回 200（${kb ? kb.toFixed(0) + " KB" : "无 content-length"}）`);
  if (kb && kb < minKB) note(`${file} 体积偏小（${kb.toFixed(0)} KB < ${minKB} KB），可能不是完整子页`);
}

/* ── ⑥ 404 兜底 ────────────────────────────────────────── */
console.log("\n[⑥ 404 兜底]");
const nf = await req(BASE.href + "__no_such_page__");
if (nf.error) skipped("404 探测（" + nf.error + "）");
else {
  ok(nf.status === 404, "不存在的路径返回 404（" + nf.status + "）");
  const body = nf.body ? nf.body.toString("utf8") : "";
  ok(/回到首页|返回首页|href="#\/"/.test(body), "404 页里有回站内的入口（不是 Cloudflare 522/523 裸页）");
  if (nf.status >= 500) console.log("    → 5xx：源站不可达（GitHub 侧域名未验证通过，或 SSL 模式选错）");
}

/* ── 汇总 ──────────────────────────────────────────────── */
console.log(`\n结果：通过 ${pass} / 失败 ${fail}${warn ? " ／ 提示 " + warn : ""}${skip ? " ／ 跳过 " + skip : ""}`);
if (fail) {
  console.log("\n按 ✗ 项对照排查：");
  console.log("  ✗ DNS 无记录            → 注册商 NS 还没改成 Cloudflare 给的两条，或记录未保存");
  console.log("  ✗ canonical 不是本域    → 重跑 make-pages --domain <域> 再发布（CI 已按 base_url 自动带 --domain）");
  console.log("  ✗ 首页 5xx              → Cloudflare SSL 模式不是 Full (strict)，或 GitHub 侧域名未通过验证");
  console.log("  ✗ http 不跳 https       → Cloudflare 打开 Always Use HTTPS；GitHub 侧勾上 Enforce HTTPS");
  console.log("  ✗ 404 页不是站内的      → 404.html 没进发布目录，检查 _site 与工作流");
}
process.exit(fail ? 1 : 0);
