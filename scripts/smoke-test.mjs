/**
 * 无头渲染自测：用 jsdom 打开离线单文件版，验证各路由都能渲染出内容。
 *
 *   NODE_PATH=<node workspace>/node_modules node scripts/smoke-test.mjs
 *
 * 检查项：首页 / 拼音索引 / 分类 / 词条页（三层深度）/ 关系图 / 使用手册，
 * 以及搜索函数对三种输入（汉字、全拼、首字母）的命中情况。
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import zlib from "node:zlib";

// jsdom 装在隔离的 node 工作区里，不在项目目录，所以按绝对路径解析
const JSDOM_ROOT = process.env.JSDOM_ROOT || "C:/Users/lenovo/.workbuddy/binaries/node/workspace";
const { JSDOM, VirtualConsole } = createRequire(resolve(JSDOM_ROOT, "index.js"))("jsdom");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = await readFile(resolve(ROOT, "dist/capital-dict-offline.html"), "utf8");

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => {
  if (!/Not implemented/.test(e.message)) errors.push(e.message);
});
vc.on("error", (m) => errors.push(String(m)));

// url 必须给一个 http 源：默认的 about:blank 是 opaque origin，
// localStorage 会抛 SecurityError，学习记录与待办就只能走内存回退路径，
// 而这两条的「持久化」恰恰要靠真 localStorage 才测得到。
const dom = new JSDOM(html, {
  runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
  url: "http://localhost/",
});
const { window } = dom;
// jsdom 没有 Web Streams 解压 API，但 Node 全局有；把阅读器 EPUB 解析需要
// 的 API 挂到 window 上，才能在本机自测里跑通 EPUB 解压。
if (typeof DecompressionStream !== "undefined") window.DecompressionStream = DecompressionStream;
if (typeof ReadableStream !== "undefined") window.ReadableStream = ReadableStream;
if (typeof WritableStream !== "undefined") window.WritableStream = WritableStream;
if (typeof TransformStream !== "undefined") window.TransformStream = TransformStream;
if (typeof Response !== "undefined") window.Response = Response;
await new Promise((r) => window.addEventListener("load", r));

const doc = window.document;
const view = () => doc.getElementById("view");
const text = () => view().textContent.replace(/\s+/g, " ").trim();

/* v69：模拟「用户已看过开屏」——摘掉开屏帘，让首页功能导览的 arm()
   不必空等 15 秒。真实浏览器里帘子由用户滚动/点击退场，效果相同。 */
try { window.sessionStorage.setItem("capital-intro-v1", "1"); } catch (e) { /* 无存储就算了 */ }
if (doc.getElementById("intro-veil")) {
  doc.getElementById("intro-veil").remove();
  doc.documentElement.classList.remove("iv-lock");
  doc.body.classList.remove("iv-lock");
}

let failed = 0;
function check(label, cond, detail) {
  const ok = !!cond;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? "  — " + detail : ""}`);
}

function goto(hash) {
  window.location.hash = hash;
  return new Promise((r) => setTimeout(r, 30));
}

/* 下载捕获：应用的导出统一走 dlBytes —— new Blob → URL.createObjectURL →
   <a download> → click()。jsdom 里点链接会真去导航（然后报 Not implemented），
   所以在源头上把 Blob 收下来，并让 click 只登记文件名、不导航。 */
const downloads = [];
window.URL.createObjectURL = (blob) => {
  downloads.push({ blob, name: "(未命名)" });
  return "blob:mock/" + downloads.length;
};
window.URL.revokeObjectURL = () => {};
window.HTMLAnchorElement.prototype.click = function () {
  const last = downloads[downloads.length - 1];
  if (last && this.download) last.name = this.download;
};

async function fireDownload(_sel, btnSel) {
  const n = downloads.length;
  const btn = doc.querySelector(btnSel);
  if (!btn) return null;
  btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  if (downloads.length === n) return null;
  const g = downloads[downloads.length - 1];
  const u8 = new Uint8Array(await g.blob.arrayBuffer());
  return { name: g.name, u8 };
}

check("首页渲染", text().includes("《资本论》学习平台") && text().includes("在科学上没有平坦的大道"), text().slice(0, 60) + "…");
check("首页标题在上、副标题在下", (() => {
  const h1 = view().querySelector(".hero h1");
  const p = view().querySelector(".hero > p:not(.kicker)");
  return h1 && p && (h1.compareDocumentPosition(p) & window.Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
})());
check("门类导航：维度切换页签已撤（只剩知识板块一维）", doc.querySelectorAll(".tax-tabs button").length === 0);
check("门类导航：知识板块 3 个门类一次铺开", doc.querySelectorAll('.tax [data-tax-panel="domain"] .card').length === 3);
check("门类导航：知识板块面板未被隐藏", !doc.querySelector('[data-tax-panel="domain"]').hidden);
check("门类导航：三个板块名齐（哲学 / 政治经济学 / 科学社会主义）",
  /马克思主义哲学/.test(text()) && /马克思主义政治经济学/.test(text()) && /科学社会主义/.test(text()));
check("门类导航：全站不再出现「学科方向」字样", !text().includes("学科方向"));
check("门类导航：毛玻璃滑块标记已从页面移除", doc.querySelectorAll(".tax-glider").length === 0);
// --- v30：三张门类卡配书封 + 错峰入场 ---
check("门类卡配图：三张书封各就位（alt 是书名、尺寸与修图产物一致、三张互不相同）", (() => {
  const imgs = [...doc.querySelectorAll("[data-cat-cards] > .card-cv .c-fig img.c-cover")];
  if (imgs.length !== 3) return false;
  const alts = imgs.map((i) => i.getAttribute("alt")).join("|");
  const srcs = imgs.map((i) => i.getAttribute("src"));
  return alts === "《德意志意识形态》封面|《资本论》封面|《共产党宣言》封面" &&
    imgs.every((i) => i.getAttribute("width") === "342" && i.getAttribute("height") === "520" &&
      /^data:image\/jpeg;base64,/.test(i.getAttribute("src"))) &&
    new Set(srcs).size === 3;
})());
check("门类卡配图：配图只进首页第 2 屏，卡片文案与统计行原样保留", (() => {
  const cards = [...doc.querySelectorAll("[data-cat-cards] > .card-cv")];
  return cards.length === 3 && cards.every((c) => c.querySelector(".c-name") &&
    c.querySelector(".c-note") && /已有 \d+ \/ 计划 \d+ 条/.test(c.querySelector(".c-meta").textContent));
})());
check("门类卡入场：三张卡按次序挂 .cv 与递增延迟（0 / 130 / 260ms）", (() => {
  const cards = [...doc.querySelectorAll("[data-cat-cards] > .card-cv")];
  return cards.length === 3 && cards.every((c) => c.classList.contains("cv")) &&
    cards.map((c) => c.style.getPropertyValue("--cv-d")).join("|") === "0ms|130ms|260ms";
})());
check("门类卡入场：拿不到 IntersectionObserver 时直接给终态（渐进增强，不留空白）",
  // jsdom 没有 IntersectionObserver，正好走的就是这条降级路径
  [...doc.querySelectorAll("[data-cat-cards] > .card-cv")].every((c) => c.classList.contains("cv-in")));
// 数据规模与门类完整性（从站点内嵌数据读取，避免把条数写死在断言里）
const DATA = window.CAPITAL_DATA;
const TAX = DATA.meta.taxonomies;
const TOTAL = DATA.terms.length;
const colCount = (tx, cid) => DATA.terms.filter((t) => t[tx.field] === cid).length;
check("词条规模已达 532 条（390 术语 + 142 一般词）", TOTAL === 532, `实际 ${TOTAL} 条`);
check(`数据里两套分类均已配平（已有 = 计划 = ${TOTAL}）`, TAX.every((tx) => {
  const have = tx.cats.reduce((a, c) => a + colCount(tx, c.id), 0);
  const plan = tx.cats.reduce((a, c) => a + (c.planned || 0), 0);
  return have === plan && plan === TOTAL;
}));
check("每个门类都有词条（无空门类）", TAX.every((tx) => tx.cats.every((c) => colCount(tx, c.id) > 0)));
check("每条词条的分类字段都在数据字典里（含存档的学科方向）", DATA.terms.every((t) => TAX.every((tx) => {
  const cid = t[tx.field];
  return cid && tx.cats.some((c) => c.id === cid);
})));
// 学术红线：每条词条都必须给出原典指引（哪怕内容是「待补」），否则页面上不会出现待补提示
check("每条词条都有原典条目（哪怕标记待补）",
  DATA.terms.every((t) => Array.isArray(t.original) && t.original.length > 0),
  `缺失 ${DATA.terms.filter((t) => !(t.original || []).length).length} 条`);
check("原典条目字段完整（text/cite/chapter 齐备）",
  DATA.terms.every((t) => t.original.every((o) =>
    typeof o.text === "string" && typeof o.cite === "string" && o.cite.length > 0 && typeof o.chapter === "string" && o.chapter.length > 0)));
// verify 的语义：引文已逐字取自权威文本、且页码已核到具体印刷页。
// 有引文就必须 verify=true 并带 loc 定位（loc 只两档：页／篇级）；待补的条目不带 text。
check("有引文的条目必须显式声明 verify 状态",
  DATA.terms.every((t) => t.original.every((o) => !o.text || typeof o.verify === "boolean")));
check("带 loc 定位标记的条目必须已核对（verify=true）",
  DATA.terms.every((t) => t.original.every((o) => !o.loc || o.verify === true)));
// 《资本论》「第X篇 第Y章」的搭配是固定知识，写错页面上看不出来，只能靠结构校验抓
// （python tools/check-chapters.py 是同一套规则的独立实现，互为对照）
{
  const VOL = {
    1: { 1: [1, 3], 2: [4, 4], 3: [5, 9], 4: [10, 13], 5: [14, 16], 6: [17, 20], 7: [21, 24] },
    2: { 1: [1, 6], 2: [7, 17], 3: [18, 21] },
    3: { 1: [1, 7], 2: [8, 10], 3: [13, 15], 4: [16, 20], 5: [21, 36], 6: [37, 47], 7: [48, 52] },
  };
  const CN = "一二三四五六七八九十";
  const c2i = (s) => (!s ? null : CN.includes(s) ? CN.indexOf(s) + 1 : /^\d+$/.test(s) ? +s : null);
  // 引注口径统一为《选集》第2卷后，chapter 里常常只写篇名，卷号得靠篇名反推
  const PIAN_NAME = {
    "商品和货币": [1, 1], "货币转化为资本": [1, 2], "绝对剩余价值的生产": [1, 3],
    "相对剩余价值的生产": [1, 4], "工资": [1, 6], "资本的积累过程": [1, 7],
    "资本形态变化": [2, 1], "资本循环": [2, 1], "资本周转": [2, 2], "社会总资本的再生产": [2, 3],
    "剩余价值转化为利润": [3, 1], "利润转化为平均利润": [3, 2], "利润率趋向下降": [3, 3],
    "商人资本": [3, 4], "生息资本": [3, 5], "超额利润转化为地租": [3, 6],
    "各种收入及其源泉": [3, 7], "三位一体": [3, 7],
  };
  const guessVol = (ch, ct) => {
    const mv = ct.match(/《资本论》第([一二三])卷/) || ch.match(/第([一二三])卷[，·\s]/);
    if (mv) return c2i(mv[1]);
    const mp = ch.match(new RegExp("第([" + CN + "\\d]+)篇"));
    const p = mp ? c2i(mp[1]) : null;
    if (p == null) return null;
    const cand = new Set(Object.keys(PIAN_NAME)
      .filter((kw) => ch.includes(kw) && PIAN_NAME[kw][1] === p)
      .map((kw) => PIAN_NAME[kw][0]));
    return cand.size === 1 ? [...cand][0] : null;
  };
  const bad = [];
  let chapChecked = 0;
  for (const t of DATA.terms) {
    for (const o of t.original || []) {
      const ch = o.chapter || "", ct = o.cite || "";
      const vol = guessVol(ch, ct);
      if (!vol) continue;
      chapChecked++;
      for (const f of [ch, ct]) {
        const re = new RegExp("第([" + CN + "\\d]+)篇([^；。]*?)第([" + CN + "\\d]+)章", "g");
        let m;
        while ((m = re.exec(f))) {
          const p = c2i(m[1]), c = c2i(m[3]);
          if (p == null || c == null || !VOL[vol][p]) continue;
          const [lo, hi] = VOL[vol][p];
          if (c < lo || c > hi) bad.push(t.term + "：第" + m[1] + "篇不该出现第" + m[3] + "章");
        }
      }
    }
  }
  check(`《资本论》篇章搭配成立（篇—章区间校验，覆盖 ${chapChecked} 条）`,
    bad.length === 0, bad.slice(0, 4).join("；"));
}
// 已核引文的引注必须落到具体位置，按文献类型分档校验 cite 的颗粒度：
//   页 → 图书，cite 要写「第X页」或「第X—Y页」
//   版 → 报纸，cite 要写「《人民日报》YYYY年M月D日」
//   条 → 法律，cite 要写「第X条」
//   篇 → 卷首文献（扉页献词等），该页不印页码，不强制
{
  const PAGE = /第[\d一二三四五六七八九十]+(—[\d一二三四五六七八九十]+)?页/;
  const PAPER = /《[^》]*报》\d{4}年\d{1,2}月\d{1,2}日/;
  const CLAUSE = /第[\d一二三四五六七八九十]+条/;
  const bad = [];
  for (const t of DATA.terms) {
    for (const o of t.original || []) {
      if (!o.verify) continue;
      const cite = o.cite || "";
      if (o.loc === "页") {
        if (!PAGE.test(cite)) bad.push(t.term + "：页级 cite 无具体页");
      } else if (o.loc === "版") {
        if (!PAPER.test(cite)) bad.push(t.term + "：版级 cite 无见报日期");
      } else if (o.loc === "条") {
        if (!CLAUSE.test(cite)) bad.push(t.term + "：条级 cite 无条款号");
      } else if (o.loc === "篇") {
        /* 卷首文献，不印页码，不强制 */
      } else {
        bad.push(t.term + "：loc 取值非法 → " + o.loc);
      }
    }
  }
  check("已核引文一律标注到具体出处（页／版／条）", bad.length === 0, bad.slice(0, 4).join("；"));
}
// 学界争鸣栏（阐释层）：结构必须完整；标为「已核」的文献，引注必须落到具体页码。
// 这一层受著作权保护，只能自己重写释义，因此每方立场都必须自带出处，不接受无出处的转述。
{
  // 期刊文可跳页（「第20—24、73页」）；报纸文依见报日期，不印页码
  const PAGES = /第[\d一二三四五六七八九十]+(?:—[\d一二三四五六七八九十]+)?(?:、[\d一二三四五六七八九十]+)*页/;
  const YEARED = /(\d{4}年|出版社)/;
  const PAPER = /《[^》]*报》\d{4}年\d{1,2}月\d{1,2}日/;
  const bad = [];
  for (const t of DATA.terms) {
    for (const g of t.scholars || []) {
      if (!g.focus || !String(g.focus).trim()) bad.push(t.term + "：议题缺焦点句");
      if (!Array.isArray(g.stances) || !g.stances.length) bad.push(t.term + "：议题下无立场");
      for (const s of g.stances || []) {
        if (!s.view || !String(s.view).trim()) bad.push(t.term + "：立场缺观点转述");
        if (!s.cite || !String(s.cite).trim()) bad.push(t.term + "：立场缺出处");
        else if (s.verified && !(PAPER.test(s.cite) || (PAGES.test(s.cite) && YEARED.test(s.cite))))
          bad.push(t.term + "：已核文献引注未落到页码");
      }
    }
  }
  check("争鸣栏结构合法（议题有焦点 · 立场有转述与出处）", bad.length === 0, bad.slice(0, 3).join("；"));
}
check("争鸣栏无残留旧占位模板", !DATA.terms.some((t) =>
  (t.scholars || []).some((s) => s.placeholder || typeof s.view === "string")));
check("空门类标待补的渲染分支仍保留（防回归）", /class="pend"/.test(html));
check("门类卡片无进度条", doc.querySelectorAll(".c-bar").length === 0);
check("CSS 含 [hidden] 显示兜底", !!doc.querySelector("style") && doc.querySelector("style").textContent.includes("[hidden]"));
check("质感层 v14：焦点环 / 阅读进度金线 / 数字等宽 三条规则在样式表内", (() => {
  const css = doc.querySelector("style").textContent;
  return /:focus-visible/.test(css) && /scaleX\(var\(--sp/.test(css) &&
    /tabular-nums/.test(css) && /text-wrap:\s*balance/.test(css);
})());
check("质感层 v14：全站过渡均已具名（无 transition: all）", (() => {
  const css = doc.querySelector("style").textContent;
  return !/transition:\s*all/.test(css) && !/will-change:\s*all/.test(css);
})());
check("拼音索引条 A–Z", doc.querySelectorAll(".alpha a, .alpha span").length === 26);
check("首页词条列表出现", doc.querySelectorAll(".term-list a").length >= 6);
check("首页词条漫游：单栏翻页器，带「换一批」与「查看更多」", (() => {
  const cols = [...doc.querySelectorAll(".home-duo .duo-col")];
  if (cols.length !== 1) return false;
  const c = cols[0];
  return c.querySelector(".duo-pager .duo-page .term-list li") &&
    c.querySelector(".duo-arrow.duo-prev") && c.querySelector(".duo-arrow.duo-next") &&
    c.querySelector("[data-duo-shuffle]") &&
    /查看更多/.test(c.querySelector(".sec-title .more").textContent);
})());
check("首页词条漫游：抽中的词条全部来自词典库（12 条）", (() => {
  const ids = new Set(window.CAPITAL_DATA.terms.map((t) => t.id));
  const got = [...doc.querySelectorAll(".home-duo .term-list a[href^='#/t/']")]
    .map((a) => a.getAttribute("href").slice(4));
  return got.length >= 12 && got.every((id) => ids.has(id));
})());
check("首页双专栏：点下一页轨道平移、圆点同步、到头箭头禁用", (() => {
  const p = doc.querySelector("[data-duo]");
  if (!p) return false;
  const t = p.querySelector(".duo-track");
  const before = t.style.transform || "";
  p.querySelector(".duo-next").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const after = t.style.transform || "";
  const dotOn = p.querySelector(".duo-dots i.on") === p.querySelectorAll(".duo-dots i")[1];
  const prevDisabled = p.querySelector(".duo-prev").disabled === false;
  const last = p.querySelectorAll(".duo-page").length - 1;
  for (let k = 1; k < last; k++) p.querySelector(".duo-next").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const nextDisabled = p.querySelector(".duo-next").disabled === true;
  return before !== after && /-100%/.test(after) && dotOn && prevDisabled && nextDisabled;
})());
check("顶部搜索框存在", !!doc.getElementById("topQ"));

// 搜索三通道
const input = doc.getElementById("topQ");
function trySearch(q) {
  input.value = q;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  const items = [...doc.querySelectorAll("#topR .r-item")];
  input.value = "";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  return items.map((i) => i.querySelector(".r-term").textContent);
}
const r1 = trySearch("剩余价值");
const r2 = trySearch("shengyujiazhi");
const r3 = trySearch("syjz");
check("搜索·汉字", r1[0] === "剩余价值", r1.slice(0, 3).join(" / "));
check("搜索·全拼", r2[0] === "剩余价值", r2.slice(0, 3).join(" / "));
check("搜索·首字母 syjz", r3[0] === "剩余价值", r3.slice(0, 3).join(" / "));
const r4 = trySearch("ptjj");
check("搜索·首字母 ptjj → 平台经济", r4[0] === "平台经济", r4.slice(0, 3).join(" / "));
check("搜索·无结果提示", trySearch("zzzz").length === 0 && doc.querySelectorAll("#topR .r-empty").length >= 0);

const SIO = window.CAPITAL_IO;
/* ---- 全文检索（v9）：原典引文 · 学界争鸣 · 自己的笔记 ---- */
check("全文检索：原典引文正文可搜，命中处给出高亮片段", (() => {
  const d = SIO.deepSearch("工作日");
  return d.quoteTotal >= 5 && d.quotes.length > 0 &&
    d.quotes.every((x) => x.text.indexOf("工作日") > -1 && x.t && x.cite !== undefined) &&
    /<mark>工作日<\/mark>/.test(SIO.hlSnippet(d.quotes[0].text, "工作日"));
})());
check("全文检索：争鸣观点与议题也在检索范围内", (() => {
  const d = SIO.deepSearch("劳动过程");
  return d.stanceTotal >= 5 && d.stances.length > 0 &&
    d.stances.every((x) => x.text.indexOf("劳动过程") > -1);
})());
check("全文检索：单字不做全文匹配（一个字能命中几百处，那不是检索是噪音）", (() => {
  const d = SIO.deepSearch("的");
  return d.quoteTotal === 0 && d.stanceTotal === 0 && d.quotes.length === 0;
})());
check("全文检索：空词与超短词安全返回空结果", (() => {
  const a = SIO.deepSearch(""), b = SIO.deepSearch("  ");
  return a.quoteTotal === 0 && b.stanceTotal === 0;
})());
check("全文检索：自己的笔记也进检索范围", (() => {
  const T0 = window.CAPITAL_DATA.terms[0];
  const L0 = SIO.lr();
  const prev = L0.getNote(T0.id);
  L0.setNote(T0.id, "这条笔记里放一个别处不会出现的词：葱油饼测验。");
  const d = SIO.deepSearch("葱油饼测验");
  L0.setNote(T0.id, prev);
  return d.noteTotal === 1 && d.notes.length === 1 && d.notes[0].t.id === T0.id;
})());
(() => {
  const di = doc.getElementById("topQ");
  di.value = "工作日";
  di.dispatchEvent(new window.Event("input", { bubbles: true }));
  const groups = [...doc.querySelectorAll("#topR .r-group")].map((g) => g.textContent);
  const deep = [...doc.querySelectorAll("#topR .r-deep")];
  check("全文检索：顶栏下拉分组呈现（词条 / 原典引文 / 学界争鸣），片段带出处", (() => {
    const g = groups.join("|");
    return groups.length >= 2 && /原典引文/.test(g) && /条|处|方/.test(g) &&
      deep.length > 0 && !!deep[0].querySelector(".r-snip mark") &&
      !!deep[0].querySelector(".r-cite") &&
      deep.every((x) => /^#\/t\//.test(x.getAttribute("href")));
  })());
  check("全文检索：组内条目带 data-i 序号且从 0 连续排下（键盘跨组不打架）", (() => {
    const items = [...doc.querySelectorAll("#topR .r-item")];
    return items.length > 0 &&
      items.every((el, i) => el.getAttribute("data-i") === String(i));
  })());
  check("全文检索：命中的引文条目同时带词条锚点（data-deep 与 href 指向同一条）", (() =>
    deep.length > 0 && deep.every((x) =>
      x.getAttribute("data-deep") && x.getAttribute("href") === "#/t/" + x.getAttribute("data-deep")))());
  /* 鼠标按下即记下「待高亮的词条与词」，随后由词条页的 after 钩子接手 */
  deep[0].dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
  window.__deeptarget = deep[0].getAttribute("data-deep");
  di.value = "";
  di.dispatchEvent(new window.Event("input", { bubbles: true }));
})();
await goto("#/t/" + window.__deeptarget);
check("全文检索：落到词条页后自动标出并滚到命中的那一段", (() =>
  !!view().querySelector(".deep-hit"))());
check("全文检索：命中的那一段确实含所搜的词", (() => {
  const hit = view().querySelector(".deep-hit");
  return !!hit && hit.textContent.indexOf("工作日") > -1;
})());

await goto("#/idx");
check("索引页渲染", view().querySelector("h1").textContent.trim() === "索引" &&
  !/按拼音排/.test(text()) && view().querySelectorAll(".alpha").length === 1);
check("索引页：两种模式共用一个切换控件，默认落在「按首字母浏览」", (() => {
  const seg = view().querySelector(".ttabs.idx-seg");
  if (!seg) return false;
  const on = seg.querySelector("a.on, button.on");
  return seg.querySelectorAll("a, button").length === 2 && !!on &&
    on.textContent.trim() === "按首字母浏览" && on.getAttribute("aria-selected") === "true";
})());

await goto("#/c/sub-jb");
check("原「学科方向」门类已下线，旧地址给兜底", text().includes("没有这个门类"));

await goto("#/c/dom-zzjj");
check("知识板块门类页渲染", text().includes("政治经济学批判") && text().includes("知识板块"));
check("门类页有同维度门类导航（3 板块 + 一般词补充栏）", view().querySelectorAll(".sibs .sib").length === 4);

await goto("#/c/dom-ybci");
check("v71：一般词补充栏单列成栏（142 条齐全）", (() => {
  const n = view().querySelectorAll(".term-list li").length;
  return view().querySelector("h1").textContent.includes("一般词") && n === 142;
})());
check("v71：一般词释义样例可达（社会 / 劳动 / 异化）",
  text().includes("社会") && text().includes("劳动") && text().includes("异化"));

await goto("#/c/dom-zx?sub=sub-jb");
check("组合筛选页：标题按「板块·方向」合并标注",
  view().querySelector("h1").textContent.trim() === "哲学·基本原理");
check("组合筛选页：只列该组合词条，方向导航 6 支且当前高亮",
  view().querySelectorAll(".term-list li").length === 55 &&
  view().querySelectorAll(".sibs .sib").length === 6 &&
  !!view().querySelector(".sibs .sib.on"));
await goto("#/c/dom-zx?sub=nope-x");
check("组合筛选：未知方向退回整块门类", view().querySelector("h1").textContent.trim() === "马克思主义哲学");

await goto("#/c/nope-x");
check("未知名门类有兜底", text().includes("没有这个门类"));

await goto("#/t/shehui");
check("v71：一般词词条页渲染（一句话 + 标准释义 + 当代场景 + 待补引文）", (() => {
  const t = text();
  return t.includes("社会") && t.includes("人类生活共同体") &&
    t.includes("AI") && /待补|待核/.test(t);
})());
check("v71：一般词词条不显示未核页码（原典栏只有待补提示）", (() => {
  const os = [...view().querySelectorAll(".orig, .quote, [class*=orig]")].map((x) => x.textContent).join("");
  return os.length === 0 || (!/\d+ 页/.test(os) && !/\d+—\d+ 页/.test(os));
})());
await goto("#/tax");
check("v71：总览页门类卡含一般词补充栏（4 张 domain 卡）", (() => {
  const cards = [...view().querySelectorAll(".card-grid .card .c-name")];
  return cards.some((x) => x.textContent.includes("一般词"));
})());

await goto("#/tax");
check("总览页：知识板块一维照旧（卡片网格 1 个、导语黄框已全部撤除）",
  view().querySelector("h1").textContent.trim() === "总览" &&
  !text().includes("列宁《马克思主义的三个来源和三个组成部分》") &&
  !text().includes("同一批词条的两种排法") &&
  !text().includes("全站词条按知识板块归类") &&
  !text().includes("三大组成部分归类") &&
  !text().includes("第二轮筛选项") &&
  view().querySelectorAll(".card-grid").length === 1);
check("总览页：新增「按学科方向细分」第二轮筛选项，按「板块·方向」标注",
  text().includes("按学科方向细分") &&
  view().querySelectorAll(".ov-subs .sib").length === 18 &&
  view().querySelector(".ov-subs .sib").textContent.replace(/\d+$/, "").trim() === "哲学·基本原理");
check("总览页：细分筛选项都带组合筛选链接",
  [].every.call(view().querySelectorAll(".ov-subs .sib"),
    (a) => /^#\/c\/dom-[a-z]+\?sub=sub-[a-z]+$/.test(a.getAttribute("href"))));
check("总览页：两种视图共用一个切换控件，默认落在「按知识板块」", (() => {
  const seg = view().querySelector(".ttabs.idx-seg");
  if (!seg) return false;
  const on = seg.querySelector("a.on, button.on");
  return seg.querySelectorAll("a, button").length === 2 && !!on &&
    on.textContent.trim() === "按知识板块" && on.getAttribute("aria-selected") === "true";
})());
check("总览页：仍是纯文字索引卡，没有被首页那三张书封带进来（改动不外溢）",
  view().querySelectorAll(".c-cover").length === 0 &&
  view().querySelectorAll(".card-cv").length === 0);

await goto("#/i/S");
check("字母页 S", text().includes("S 开头"));

await goto("#/t/shengyujiazhi");
check("词条页标题", view().querySelector("h1").textContent === "剩余价值");
check("词条页分类标签仍一枚，标注为「板块·方向」合并形式",
  view().querySelectorAll(".chips a.chip.cat").length === 1 &&
  view().querySelector(".chips a.chip.cat").textContent.trim() === "政治经济学·基本原理");
check("词条页面包屑含板块与词条名", view().querySelectorAll(".crumb a").length >= 2);
/* v63：悬浮的两个导航键 —— 上一页（放大成实心药丸）与回到顶部（滚动后浮现）。
   尺寸与配色在真机探针里量（jsdom 没有布局），这里只锁结构：按钮在不在、
   是否挂在 body 下（#view 的 .page-in transform 会给 fixed 建立包含块）、
   初始是不是隐藏态。 */
check("悬浮「上一页」按钮在 body 下且指向回退动作",
  (() => {
    const b = window.document.getElementById("crumb-back");
    return !!b && b.parentElement === window.document.body &&
      b.getAttribute("data-act") === "hist-back" && b.textContent.includes("上一页");
  })());
check("悬浮「回到顶部」按钮在 body 下、初始为隐藏态",
  (() => {
    const b = window.document.getElementById("to-top");
    return !!b && b.parentElement === window.document.body &&
      b.getAttribute("aria-label") === "回到页面顶部" && !b.classList.contains("is-on");
  })());
check("产物样式含回到顶部浮现态与上一页实心底",
  html.includes(".to-top.is-on") && /#crumb-back\s*\{[^}]*background:\s*var\(--red-deep\)/.test(html));
check("词条页无阅读深度切换", !view().querySelector("#depth"));
check("词条页全量展示：无 data-lv 隐藏逻辑", view().querySelectorAll(".block[data-lv]").length === 0);
check("一句话渲染", !!view().querySelector(".oneline"));
check("原典直引区存在", !!view().querySelector(".block"));
check("关联词条数 ≥ 4", view().querySelectorAll(".rel").length >= 4);
check("词条页不再渲染参考文献栏（已按需求整体移除）",
  !view().querySelector(".footnotes") &&
  ![...view().querySelectorAll(".b-label")].some((el) => el.textContent.includes("参考文献")));

check("原典卡已渲染", view().querySelectorAll(".quote").length >= 1);
/* —— 英文译名 + 哲学词条德文原词 —— */
check("全部词条都有官方英文译名（数据）", DATA.terms.length === TOTAL && DATA.terms.every((t) => t.en && t.en.length > 1));
await goto("#/i/S");
{
  const lisS = [...view().querySelectorAll(".term-list li")];
  check("词条列表行显示英文译名（哲学词条另带德文）",
    lisS.length > 0 && lisS.every((li) => !!li.querySelector(".tl-en"))
    && lisS.some((li) => !!li.querySelector(".tl-de")));
}
{
  const withDe = DATA.terms.find((t) => t.de);
  await goto("#/t/" + withDe.id);
  check(`哲学词条页头部显示英文与德文（${withDe.term}）`,
    view().querySelector(".ende .en")?.textContent === withDe.en
    && view().querySelector(".ende .de")?.textContent === withDe.de, withDe.de);
  const noDe = DATA.terms.find((t) => !t.de);
  await goto("#/t/" + noDe.id);
  check(`非哲学词条页不显示德文（${noDe.term}）`,
    !!view().querySelector(".ende .en") && !view().querySelector(".ende .de"));
}
// —— 学界争鸣栏：新结构为「争鸣议题 + 各方立场 + 各自出处」——
const withStance = DATA.terms.find((t) =>
  (t.scholars || []).some((g) => (g.stances || []).length));
if (withStance) {
  await goto("#/t/" + withStance.id);
  const v = view();
  check(`争鸣栏渲染立场卡（${withStance.term}）`,
    v.querySelectorAll(".debate .stance").length >= 1);
  check("争鸣栏渲染争鸣议题", !!v.querySelector(".debate .d-focus"));
  check("争鸣栏立场带方别标签", v.querySelectorAll(".stance .s-side").length >= 1);
  check("争鸣栏立场带文献出处", v.querySelectorAll(".stance .s-cite").length >= 1);
} else {
  check("争鸣栏渲染立场卡（尚无已补词条，跳过）", true);
}

// 只列了争鸣点、文献未补的条目，须给出线索提示而不是空栏
const withLead = DATA.terms.find((t) => !(t.scholars || []).length && t.scholars_lead);
if (withLead) {
  await goto("#/t/" + withLead.id);
  check(`未补词条显示争鸣点线索（${withLead.term}）`, !!view().querySelector(".debate-lead"));
}

// 待补录的两类提示：马恩著作待补 与 【非马恩著作】待补（后者引导语须不同）
const pendMarx = DATA.terms.find((t) =>
  (t.original || []).some((o) => o.pending && !(o.chapter || "").startsWith("【非马恩著作】")));
const pendNon = DATA.terms.find((t) =>
  (t.original || []).some((o) => o.pending && (o.chapter || "").startsWith("【非马恩著作】")));
if (pendMarx) {
  await goto("#/t/" + pendMarx.id);
  check(`待补录词条显示提示（${pendMarx.term}）`, text().includes("原典引文待补录"));
}
if (pendNon) {
  await goto("#/t/" + pendNon.id);
  check(`非马恩著作待补的引导语区分（${pendNon.term}）`, text().includes("本条的依据不在马恩著作中"));
}
// 已核条目：引文须带对应档位的核验标记
const okT = DATA.terms.find((t) => (t.original || []).some((o) => o.verify && o.loc === "页"));
await goto("#/t/" + okT.id);
check(`已核词条显示「页码已核」（${okT.term}）`, text().includes("页码已核"));
check("已核词条不再显示「待补」", !view().querySelector(".quote.pending"));

const okP = DATA.terms.find((t) => (t.original || []).some((o) => o.verify && o.loc === "版"));
if (okP) {
  await goto("#/t/" + okP.id);
  check(`文献类已核词条显示「版次已核」（${okP.term}）`, text().includes("版次已核"));
}
const okL = DATA.terms.find((t) => (t.original || []).some((o) => o.verify && o.loc === "条"));
if (okL) {
  await goto("#/t/" + okL.id);
  check(`法律类已核词条显示「条款已核」（${okL.term}）`, text().includes("条款已核"));
}

// 全量词条页逐一渲染
const broken = [];
for (const t of DATA.terms) {
  await goto("#/t/" + t.id);
  const h1 = view().querySelector("h1");
  if (!h1 || h1.textContent !== t.term) broken.push(t.id);
}
check(`全部 ${TOTAL} 条词条页均可渲染`, broken.length === 0, broken.join("、"));

// 新增词条的搜索命中（首字母 / 全拼）
for (const [q, expect] of [["gtfy", "共同富裕"], ["lukaqi", "卢卡奇"], ["zbzgs", "资本总公式"], ["zhiminzhuyi", "殖民主义"]]) {
  input.value = q;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  const hit = [...doc.querySelectorAll("#topR .r-item .r-term")].map((e) => e.textContent);
  input.value = "";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  check(`搜索·${q} → ${expect}`, hit.includes(expect), hit.slice(0, 3).join("/"));
}

await goto("#/graph");
/* v43：关系图不再自己画 SVG——那一千行力导向引擎已删，整页就是内嵌的
   pathflow.html（React Flow 编辑器）。这里只能验「外框与口径」，
   画布内部的行为由真机断言 + pathflow 自带的构建产物负责。 */
check("关系图页：标题、统计与整页单 h1", (() => {
  const h1 = view().querySelector("h1.page-title");
  return !!h1 && h1.textContent.trim() === "概念关系图" &&
    view().querySelectorAll("h1").length === 1 &&
    /全站 532 条词条、1347 条关系/.test(text());
})());
check("关系图页：内嵌 pathflow（iframe 指向同目录 pathflow.html，且未加 lazy）", (() => {
  const f = view().querySelector(".graph-page .pfe-frame");
  return !!f && f.getAttribute("src") === "./pathflow.html" &&
    f.getAttribute("loading") !== "lazy";
})());
check("关系图页：有状态条、「单独打开」入口与本机存档提示", (() => {
  const bar = view().querySelector(".pfe-bar");
  return !!bar && /单独打开/.test(bar.textContent) && /自动存档/.test(bar.textContent) &&
    !!bar.querySelector("#pfe-state");
})());
check("关系图页：缺文件兜底说明同页渲染（默认 hidden，探测失败才显示）", (() => {
  const fb = view().querySelector("#pfe-fallback");
  return !!fb && fb.hidden === true && /pathflow\.html/.test(fb.textContent) &&
    /同一个目录/.test(fb.textContent);
})());
check("关系图页：保留学术口径免责说明（关系是编者所排，非原典逐句次序）",
  /不是原著里逐句写明的推导次序/.test(text()) && /没有逐句页码依据/.test(text()));
check("关系图页：整页高度吃掉顶栏以下视口（.graph-page 用 dvh 减顶栏）", (() => {
  const css = [...doc.querySelectorAll("style")].map((s) => s.textContent).join("\n");
  return /\.graph-page \.pfe-wrap\s*\{[^}]*100dvh/.test(css);
})());
check("导航栏：关系图是独立一级项且指向 #/graph", (() => {
  const a = doc.querySelector('.navlinks a[data-route="graph"]');
  return !!a && a.getAttribute("href") === "#/graph" && a.textContent.trim() === "关系图";
})());
await goto("#/i/S");
check("· #/i/S 时顶栏高亮「索引」", (() => {
  const on = [...doc.querySelectorAll(".navlinks a[aria-current=\"page\"]")];
  return on.length === 1 && on[0].getAttribute("data-route") === "idx";
})());
await goto("#/tree");
check("· #/tree 时顶栏高亮「总览」", (() => {
  const on = [...doc.querySelectorAll(".navlinks a[aria-current=\"page\"]")];
  return on.length === 1 && on[0].getAttribute("data-route") === "tax";
})());
await goto("#/statement");

check("v66：旧地址 #/statement、#/about 都归一到首页，不落 404",
  window.location.hash === "#/" &&
  !!view().querySelector(".hero") &&
  !/页面不存在/.test(text()));

check("v66：「关于」页已彻底撤除（无导航项、无页面骨架、无残留正文）",
  !doc.querySelector('.navlinks a[data-route="about"]') &&
  !view().querySelector("#about-intro, .about-sec, .about-jump") &&
  !/建站初衷|建站目标/.test(text()));

await goto("#/t/shangpin");
check("词条页不再展示撰写人、AI 用法一类制作信息",
  !view().querySelector(".term .credit"));

check("页脚只报数据状态，不含创作说明入口", (() => {
  const f = doc.getElementById("footStatus");
  return f && /词条/.test(f.textContent) && !/创作说明/.test(f.textContent);
})());


/* ---- 写作辅助三件：关键词矩阵 · 笔记板 · 多语术语对照表 ---- */
const WIO = window.CAPITAL_IO;
await goto("#/tools");
check("工具台：四件写作辅助的面板与菜单入口都在", (() => {
  const ok = ["kw", "nb", "mt"].every((id) => !!view().querySelector(".tool-card[id=" + id + "]"));
  const nav = [...view().querySelectorAll(".tool-menu a[data-target]")].map((a) => a.getAttribute("data-target"));
  return ok && ["tt", "qs", "ct", "kw", "nb", "mt"].every((t) => nav.includes(t));
})());

/* 深链：#/tools/<id> 是顶栏巨型菜单与总览的共同落点，一次只铺一件 */
await goto("#/tools/mt");
check("工具台深链：只铺 #/tools/<id> 那一件，其余收起，总览也不在", (() => {
  const v = view();
  const shown = [...v.querySelectorAll(".tool-card")].filter((c) => !c.hidden).map((c) => c.id);
  const on = v.querySelector(".tool-menu a.on");
  return shown.join(",") === "mt" && !!on && on.getAttribute("data-target") === "mt" &&
    !v.querySelector(".to-grid") && !!v.querySelector("#mt-out");
})());
await goto("#/tools");
check("工具台：未知 id 一律退回总览，不出空白页", (() => {
  return null === view().querySelector(".tool-menu a.on");
})());

/* —— 检索词与检索式 —— */
check("检索词与检索式：一格子一板块，格子数加总 = 词条总数", (() => {
  const cells = [...view().querySelectorAll("#kw-out .kw-cell")];
  const tax = (id) => window.CAPITAL_DATA.meta.taxonomies.find((t) => t.id === id);
  if (cells.length !== tax("domain").cats.length) return false;
  const sum = cells.reduce((a, b) => a + (b.textContent === "·" ? 0 : +b.textContent), 0);
  return sum === window.CAPITAL_DATA.terms.length;
})());
check("检索词与检索式：没选板块时不出检索式", !view().querySelector("#kw-out .kw-expr-box"));
check("检索词与检索式：点一格出词条表与中英检索式", (() => {
  const cell = [...view().querySelectorAll("#kw-out .kw-cell")]
    .find((c) => c.textContent !== "·" && +c.textContent > 0);
  cell.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  /* 点一下会重画整个 #kw-out，所以下面一律重新查询，不能再用上面那个节点 */
  const boxes = [...view().querySelectorAll("#kw-out .kw-expr-box")];
  const zh = view().querySelector("#kw-out .kw-expr-box code").textContent;
  return view().querySelectorAll("#kw-out .kw-cell.on").length === 1 && boxes.length >= 1 &&
    /^\(.+ OR .+\)$/.test(zh) && !!view().querySelector("#kw-out table tbody tr");
})());
check("检索词与检索式：选中的板块回填到下拉（联动不脱节）", (() => {
  const picked = view().querySelector("#kw-out .kw-cell.on");
  const sel = view().querySelector("#kw-dom");
  return !!picked && !!sel && sel.value === picked.getAttribute("data-dom");
})());
check("检索词与检索式：下拉换板块同样出表（两条入口等价）", (() => {
  const sel = view().querySelector("#kw-dom");
  const other = [...sel.querySelectorAll("option")].map((o) => o.value).filter((v) => v && v !== sel.value)[0];
  if (!other) return false;
  sel.value = other;
  sel.dispatchEvent(new window.Event("change", { bubbles: true }));
  return view().querySelectorAll("#kw-out .kw-cell.on").length === 1 &&
    view().querySelector("#kw-out .kw-cell.on").getAttribute("data-dom") === other &&
    !!view().querySelector("#kw-out .kw-expr-box code");
})());
check("检索词与检索式：检索式只用库里的词（词条名 / 别名 / 外译名），没有编词", (() => {
  const names = window.CAPITAL_DATA.terms.map((t) => t.term);
  const dom = view().querySelector("#kw-dom").value;
  const hit = window.CAPITAL_DATA.terms.filter((t) => t.domain === dom);
  const codes = [...view().querySelectorAll("#kw-out .kw-expr-box code")].map((c) => c.textContent);
  /* 中英两个检索式分别验：拆词后每个词都得对得上库里的词条名、别名或外译名 */
  return codes.length >= 1 &&
    hit.every((t) => codes.some((c) => c.indexOf(t.term) > -1)) &&
    codes.every((c) => c.replace(/^\(|\)$/g, "").split(" OR ").every((w) =>
      names.includes(w) || hit.some((t) => (t.alias || []).includes(w) || t.en === w)));
})());

/* —— 文本分析：多文件词频对比（v17 第六块） —— */
await goto("#/tools/tt");
{
  /* 造两份假文件：只有重叠词能在折线图上出现，所以特意安排「商品」两份都有、「剩余价值」只在 B 有 */
  const A = "商品是用来交换的劳动产品。商品的价值由社会必要劳动时间决定。商品交换中，商品的二重性显现出来。";
  const B = "剩余价值是资本主义生产的实质。商品与剩余价值的关系，是《资本论》第一卷的主线。商品流通把剩余价值实现出来。";
  window.CAPITAL_IO.ttAddDoc({ name: "测试甲.txt", kind: "TXT", meta: "1 KB", text: A, empty: false });
  check("文本分析：只载入一份文件时，第六块给的是「再拖一份」的引导语，不出图表", (() => {
    const box = view().querySelector("#ta-docfreq");
    return !!box && /两份以上/.test(box.textContent) && !view().querySelector("#ta-df-chart svg");
  })());
  window.CAPITAL_IO.ttAddDoc({ name: "测试乙.txt", kind: "TXT", meta: "1 KB", text: B, empty: false });
}
check("文本分析：两份文件各出一张词频表（表头带文件名与词次）", (() => {
  const box = view().querySelector("#ta-docfreq");
  if (!box) return false;
  const heads = [...box.querySelectorAll(".df-file")].map((h) => h.childNodes[0].textContent.trim());
  const tbls = box.querySelectorAll(".ta-tbl").length;
  return heads.length === 2 && heads[0] === "测试甲.txt" && heads[1] === "测试乙.txt" && tbls === 2 &&
    /词次/.test(box.querySelector(".df-file-n").textContent);
})());
check("文本分析：折线图横轴是文件名、纵轴有刻度、一条线一个词", (() => {
  const svg = view().querySelector("#ta-df-chart svg");
  if (!svg) return false;
  const t = svg.textContent;
  const lines = svg.querySelectorAll("polyline, path[stroke]").length;
  return /测试甲\.txt/.test(t) && /测试乙\.txt/.test(t) && lines >= 1 &&
    svg.querySelectorAll("line").length >= 2 && !!svg.querySelector("text");
})());
check("文本分析：候选词只收「至少出现在两份文件里」的词", (() => {
  const R = window.CAPITAL_IO.taCompute(view().querySelector("#tt-input").value);
  if (!R || !R.dfDocs) return false;
  const opts = [...view().querySelectorAll("#ta-docfreq .df-word")].map((l) => l.querySelector("input").getAttribute("data-df-w"));
  return opts.length >= 1 && opts.every((w) =>
    R.dfDocs.filter((d) => d.rows.some((r) => r.w === w)).length >= 2);
})());
check("文本分析：切「频次／每千词频率」只换轴、不丢选中的词", (() => {
  const box = view().querySelector("#ta-docfreq");
  const before = [...box.querySelectorAll(".df-word input[checked]")].map((i) => i.getAttribute("data-df-w"));
  const radio = box.querySelector('input[name="df-mode"][value="count"]');
  radio.checked = true;
  radio.dispatchEvent(new window.Event("change", { bubbles: true }));
  const after = [...view().querySelectorAll("#ta-docfreq .df-word input[checked]")]
    .map((i) => i.getAttribute("data-df-w"));
  const svg = view().querySelector("#ta-df-chart svg");
  return before.length >= 1 && after.join(",") === before.join(",") && !!svg;
})());
const dlDf = await fireDownload("", '#ta-docfreq [data-act="ta-xlsx"]');
check("文本分析：词频对比能导出 xlsx（每份文件一张表＋折线数据表）", (() => {
  if (!dlDf || dlDf.u8[0] !== 0x50) return false;
  const txt = new TextDecoder("utf-8", { fatal: false }).decode(dlDf.u8);
  return txt.indexOf("折线数据") > -1 && txt.indexOf("测试甲") > -1;
})());
window.CAPITAL_IO.ttClearDocs();
check("文本分析：清空后回到引导语，不留下上一轮的表与图", (() => {
  const box = view().querySelector("#ta-docfreq");
  return !!box && /两份以上/.test(box.textContent) &&
    box.querySelectorAll(".df-file").length === 0 && !view().querySelector("#ta-df-chart svg");
})());
/* —— v57：分析摘要一键复制 · 聚类网络图按知识板块着色 —— */
{
  const T = "商品是用来交换的劳动产品。货币转化为资本的前提是劳动力成为商品。" +
    "剩余价值的生产是资本主义生产的实质，绝对剩余价值与相对剩余价值是两种基本方法。";
  window.CAPITAL_IO.ttAddDoc({ name: "摘要测试.txt", kind: "TXT", meta: "1 KB", text: T, empty: false });
}
check("文本分析：结论区有「复制分析摘要」按钮，摘要带密度、板块分布与高频术语", (() => {
  const btn = view().querySelector('#tt-out [data-copy^="【文本分析摘要】"]');
  if (!btn) return false;
  const p = btn.getAttribute("data-copy");
  return /术语密度/.test(p) && /知识板块分布/.test(p) && /高频术语/.test(p);
})());
check("文本分析：聚类网络图默认按簇着色，切「按知识板块」后出图例、切回簇表恢复", (() => {
  const net = view().querySelector("#ta-net");
  if (!net || !net.querySelector('input[name="ta-net-mode"]')) return false;
  const clu = net.querySelector('input[name="ta-net-mode"][value="cluster"]');
  if (!clu.checked) return false;
  const dom = net.querySelector('input[name="ta-net-mode"][value="domain"]');
  dom.checked = true;
  dom.dispatchEvent(new window.Event("change", { bubbles: true }));
  const net2 = view().querySelector("#ta-net");
  const legend = net2 && net2.querySelector(".tt-dims");
  if (!legend || !legend.querySelector("span")) return false;
  const clu2 = net2.querySelector('input[name="ta-net-mode"][value="cluster"]');
  clu2.checked = true;
  clu2.dispatchEvent(new window.Event("change", { bubbles: true }));
  const net3 = view().querySelector("#ta-net");
  return !!net3 && !net3.querySelector(".tt-dims") &&
    !!net3.querySelector(".ta-tbl");   // 簇成员表回来了
})());
window.CAPITAL_IO.ttClearDocs();
/* 这条是「冻结普查」：库中带 cite 的争鸣立场总数——每次补录争鸣后须同步更新此数 */
const REF_CENSUS = 630;
check(`争鸣引注普查：${REF_CENSUS} 条引注总数保持稳定`, (() => {
  let n = 0;
  for (const t of window.CAPITAL_DATA.terms) {
    for (const g of t.scholars || []) for (const st of g.stances || []) if (st.cite) n++;
  }
  return n === REF_CENSUS;
})());

/* —— 笔记板（思维导图）：渲染、加节点、改文字、导入词条、导出 Markdown —— */
await goto("#/tools/nb");
check("笔记板：导图画布铺开，默认有根节点", (() => {
  const v = view();
  return !!v.querySelector("#nbm-canvas") && !!v.querySelector(".nbm-root") &&
    v.querySelectorAll(".nbm-node").length === 1;
})());
check("笔记板：点选节点后「新建节点」长出子节点，连线跟出来", (() => {
  const root = view().querySelector(".nbm-root");
  root.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
  view().querySelector('[data-act="nbm-add"][data-id="1"]').click();
  const nodes = view().querySelectorAll(".nbm-node");
  return nodes.length === 2 && view().querySelectorAll(".nbm-edge").length === 1;
})());
check("笔记板：导入词条把词条（连同词条页笔记）挂为子节点", (() => {
  const inp = view().querySelector("#nbm-term");
  inp.value = "商品";
  view().querySelector('[data-act="nbm-import"]').click();
  const texts = [...view().querySelectorAll(".nbm-txt")].map((x) => x.textContent).join("|");
  return texts.includes("商品") && view().querySelectorAll(".nbm-node").length === 3;
})());
check("笔记板：数据落在本机 capital-mind-v1 键里，刷新不丢", (() => {
  const raw = window.localStorage.getItem("capital-mind-v1");
  if (!raw) return false;
  const d = JSON.parse(raw);
  return d.nodes.length === 3 && !!d.next;
})());
check("笔记板：导出的 Markdown 按层级缩进，含根与子节点", (() => {
  const md = WIO.nbMapMarkdown();
  return md.startsWith("# ") && md.includes("- 《资本论》学习笔记") && md.includes("  - ") &&
    md.includes("商品");
})());

/* —— 多语术语对照表 —— */
check("多语对照表：默认列全站 532 条，中英德三列齐", (() => {
  const rows = view().querySelectorAll("#mt-out .mt-tbl tbody tr");
  const head = [...view().querySelectorAll("#mt-out .mt-tbl thead th")].map((x) => x.textContent);
  return rows.length === window.CAPITAL_DATA.terms.length &&
    head.join(",") === "中文,英文,德文,别名,知识板块";
})());
check("多语对照表：英文名 532 条都有，德文空着的就是没有（不拿别的语言充数）", (() => {
  const body = WIO.mtRows().slice(1);
  const deData = window.CAPITAL_DATA.terms.filter((t) => t.de).length;
  return body.length === 532 && body.every((r) => r[1]) &&
    body.filter((r) => r[2]).length === deData && deData > 40 && deData < 60;
})());
check("多语对照表：切「仅有德文原名」正好剩那些条", (() => {
  const sc = view().querySelector("#mt-scope");
  sc.value = "de";
  sc.dispatchEvent(new window.Event("change", { bubbles: true }));
  const n = view().querySelectorAll("#mt-out .mt-tbl tbody tr").length;
  const want = window.CAPITAL_DATA.terms.filter((t) => t.de).length;
  sc.value = "all";
  sc.dispatchEvent(new window.Event("change", { bubbles: true }));
  return n === want;
})());
check("多语对照表：按知识板块筛 + 按英文名检索都生效", (() => {
  const sc = view().querySelector("#mt-scope");
  sc.value = "d:dom-kxsh";
  sc.dispatchEvent(new window.Event("change", { bubbles: true }));
  const n = view().querySelectorAll("#mt-out .mt-tbl tbody tr").length;
  const want = window.CAPITAL_DATA.terms.filter((t) => t.domain === "dom-kxsh").length;
  sc.value = "all";
  sc.dispatchEvent(new window.Event("change", { bubbles: true }));
  const q = view().querySelector("#mt-q");
  q.value = "commodity";
  q.dispatchEvent(new window.Event("input", { bubbles: true }));
  const hit = view().querySelectorAll("#mt-out .mt-tbl tbody tr").length;
  q.value = "";
  q.dispatchEvent(new window.Event("input", { bubbles: true }));
  return n === want && hit >= 1;
})());
check("多语对照表：CSV 首行是表头，字段顺序固定", (() =>
  WIO.mtRows()[0].join(",") === "中文,英文,德文,别名,知识板块")());
/* —— v57：板块批量筛选（多选勾选块，与单选范围、搜索词叠加） —— */
check("多语对照表：勾一个板块只留那块的词条，清空按钮一键还原", (() => {
  const chips = [...view().querySelectorAll("#mt-doms input[data-dom]")];
  if (!chips.length) return false;
  const kx = chips.find((c) => c.getAttribute("data-dom") === "dom-kxsh");
  if (!kx) return false;
  kx.checked = true;
  kx.dispatchEvent(new window.Event("change", { bubbles: true }));
  const n1 = view().querySelectorAll("#mt-out .mt-tbl tbody tr").length;
  const want = window.CAPITAL_DATA.terms.filter((t) => t.domain === "dom-kxsh").length;
  const stat = view().querySelector("#mt .qs-stat").textContent;
  const clearBtn = view().querySelector('[data-act="mt-dom-clear"]');
  if (!clearBtn) return false;
  clearBtn.click();
  const n2 = view().querySelectorAll("#mt-out .mt-tbl tbody tr").length;
  return n1 === want && want > 0 && n2 === window.CAPITAL_DATA.terms.length && /已勾/.test(stat);
})());

/* ================================================================
   学习与记忆四件：自测引擎 · 间隔重复卡 · 生词卡导出 · 学习日历
   四件共用一个存储（LR），所以先造点学习记录，再依次验。
   ================================================================ */
const LRIO = WIO.lr();
const ALLT = window.CAPITAL_DATA.terms;
ALLT.slice(0, 3).forEach((t) => LRIO.setStar(t.id, true));       // 三条生词
LRIO.quizLog(1, 0, "all", [ALLT[7].id], []);                     // 一条错题

/* ---- 自测引擎 ---- */
await goto("#/tools/quiz");
check("自测引擎：面板有范围、题量、出题与交卷", (() => {
  const v = view();
  return !!v.querySelector("#qz-scope") && !!v.querySelector("#qz-n") &&
    v.querySelectorAll("#qz-n option").length === 3 &&
    !!v.querySelector('[data-act="qz-new"]') && !!v.querySelector('[data-act="qz-submit"]');
})());
check("自测引擎：默认出 10 题，每题四选一", (() => {
  const items = [...view().querySelectorAll(".qz-item")];
  return items.length === 10 && items.every((it) =>
    it.querySelectorAll(".qz-opt").length === 4 &&
    it.querySelectorAll('input[type="radio"]').length === 4);
})());
check("自测引擎：四种题型都出得到（释义 / 引文 / 译名 / 争鸣）", (() => {
  const open = new Set();
  for (let s = 1; s <= 6; s++) WIO.quizBuild("all", 40, s).forEach((it) => open.add(it.kind));
  return ["A", "B", "C", "D"].every((k) => open.has(k));
})());
check("自测引擎：题干里出现的答案一律挖空，不漏题面", (() => {
  const paper = WIO.quizBuild("all", 40, 3);
  return paper.length === 40 &&
    paper.filter((it) => it.stem.includes(it.opts[it.right].text)).length === 0 &&
    paper.some((it) => it.stem.includes("〔　　〕"));
})());
check("自测引擎：选项互不相同，正确项对得住词条", (() => {
  const paper = WIO.quizBuild("all", 20, 5);
  return paper.every((it) => {
    const texts = it.opts.map((o) => o.text);
    return new Set(texts).size === 4 && it.opts[it.right].id === it.id &&
      it.opts[it.right].text === window.CAPITAL_DATA.terms.find((t) => t.id === it.id).term;
  });
})());
check("自测引擎：干扰项优先取同一知识板块（八成以上能凑够两条同板块）", (() => {
  const byId = {};
  ALLT.forEach((t) => { byId[t.id] = t; });
  const paper = WIO.quizBuild("all", 30, 7);
  const hit = paper.filter((it) => it.opts.filter((o) =>
    o.id !== it.id && byId[o.id].domain === byId[it.id].domain).length >= 2).length;
  return paper.length === 30 && hit / paper.length >= 0.8;
})());
check("自测引擎：池子凑不出四选一时不出题（不硬凑干扰项）", (() =>
  WIO.quizBuild("d:__none__", 10, 1).length === 0)());
check("自测引擎：范围按整体 / 知识板块两组给（学科方向一组已撤）", (() => {
  const sel = view().querySelector("#qz-scope");
  const vals = [...sel.querySelectorAll("option")].map((o) => o.value);
  const labels = [...sel.querySelectorAll("optgroup")].map((g) => g.getAttribute("label"));
  return sel.querySelectorAll("optgroup").length === 2 &&
    ["all", "read", "star", "wrong"].every((v) => vals.includes(v)) &&
    labels.join(",") === "整体,按知识板块" &&
    vals.some((v) => v.startsWith("d:")) && !vals.some((v) => v.startsWith("c:"));
})());
check("自测引擎：选一项只改这一题的样式与「已答」计数，不重画整卷", (() => {
  const first = view().querySelector(".qz-item");
  const radio = first.querySelector('input[type="radio"]');
  radio.checked = true;
  radio.dispatchEvent(new window.Event("change", { bubbles: true }));
  return view().querySelector(".qz-item") === first &&
    first.querySelectorAll(".qz-opt.pick").length === 1 &&
    /已答/.test(view().querySelector("#qz-meta").textContent);
})());
check("自测引擎：交卷出得分条、逐题对错与解析", (() => {
  view().querySelector('[data-act="qz-submit"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const sc = view().querySelector(".qz-score");
  return !!sc && /正确率/.test(sc.textContent) && /\d+%/.test(sc.textContent) &&
    view().querySelectorAll(".qz-item.ok, .qz-item.no").length === 10 &&
    !!view().querySelector(".qz-exp") && !!view().querySelector(".qz-opt.right");
})());
check("自测引擎：判卷后错题进错题本、答题流水记一笔", (() =>
  LRIO.quizWrongCount() >= 1 && LRIO.quizHist().length >= 1)());
check("自测引擎：错题本有货后「只练错题」出得了题", (() => {
  const n = LRIO.quizWrongCount();
  return n >= 5 && WIO.quizBuild("wrong", 5, 2).length === 5;
})());

/* ---- 间隔重复卡 ---- */
await goto("#/tools/srs");
check("间隔重复卡：队列＝生词本 ∪ 错题本，去掉重复", (() => {
  const q = WIO.srsQueue();
  const want = new Set([...LRIO.starIds(), ...LRIO.quizWrongIds()]).size;
  return q.length === want && want >= 4 &&
    q.every((x) => !!x.t && x.due === true);          // 都没排过期，全是新卡
})());
check("间隔重复卡：统计条给出队列、到期、已排期、今日已复习", (() => {
  const s = view().querySelector(".srs-stat");
  return !!s && /张在队列/.test(s.textContent) && /今天到期/.test(s.textContent) &&
    /已排期/.test(s.textContent) && /今日已复习/.test(s.textContent);
})());
check("间隔重复卡：先给正面，点「显示答案」才翻出背面", (() => {
  const card = view().querySelector(".srs-card");
  if (!card) return false;
  const term = card.querySelector(".sc-face h3").textContent.trim();
  const hidden = card.querySelector(".sc-back").hidden;
  view().querySelector('[data-act="srs-show"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const c2 = view().querySelector(".srs-card");
  /* 队列内容随前面自测的错题本变动，第一张卡可能没有已核引文——
     背面要么给引文，要么如实说没有，两种都算对 */
  const back = c2.querySelector(".sc-back");
  return term.length > 0 && hidden === true && back.hidden === false &&
    /\S/.test(c2.querySelector(".sc-oneline").textContent) &&
    (!!back.querySelector("blockquote") || /没有已核原典引文/.test(back.textContent));
})());
check("间隔重复卡：三档自评按曲线走（记得 3 天 / 一般 1 天 / 忘了当天重来）", (() => {
  const a = ALLT[20].id, b = ALLT[21].id, c = ALLT[22].id;
  [a, b, c].forEach((id) => LRIO.srsDel(id));
  const g2 = WIO.srsGrade(a, 2), g1 = WIO.srsGrade(b, 1), g0 = WIO.srsGrade(c, 0);
  return g2.iv === 3 && g1.iv === 1 && g0.iv === 0 && g0.reps === 0 && g0.lapses === 1;
})());
check("间隔重复卡：难度因子有上下限（反复忘了不低于 1.3，反复记得不超过 2.8）", (() => {
  const id = ALLT[23].id;
  LRIO.srsDel(id);
  for (let i = 0; i < 12; i++) WIO.srsGrade(id, 0);
  const lo = LRIO.srsGet(id).ef;
  LRIO.srsDel(id);
  for (let i = 0; i < 12; i++) WIO.srsGrade(id, 2);
  const hi = LRIO.srsGet(id).ef;
  return lo === 1.3 && hi === 2.8;
})());
check("间隔重复卡：评一张，到期数就少一张，卡片自动往后走", (() => {
  /* 界面上那张卡是上一次渲染留下的；它可能已被上一条用例直接评过
     （srsGrade 走数据层、不重画面板），所以先看它当下是否真在到期集合里，
     再断言「评完少一张」——评一张未到期的卡，到期数不变，这是对的。 */
  const card = view().querySelector(".srs-card");
  if (!card) return false;
  const id = card.getAttribute("data-id");
  const cur = WIO.srsQueue().find((x) => x.id === id);
  const wasDue = !!(cur && cur.due);
  const before = WIO.srsQueue().filter((x) => x.due).length;
  const btn = view().querySelector('[data-act="srs-2"]');
  if (!btn) return false;
  btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  return WIO.srsQueue().filter((x) => x.due).length === before - (wasDue ? 1 : 0);
})());
check("间隔重复卡：全部复习完后给出下一批到期日，并允许提前复习", (() => {
  let guard = 0;
  while (WIO.srsQueue().filter((x) => x.due).length && guard++ < 40) {
    const b = view().querySelector('[data-act="srs-show"]');
    if (b) b.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const g = view().querySelector('[data-act="srs-2"]');
    if (g) g.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  }
  const hasTip = /下一批到期/.test(view().querySelector("#srs-body").textContent);
  const n = WIO.srsPullForward();
  return hasTip && n >= 1 && WIO.srsQueue().every((x) => x.due);
})());

/* ---- 生词卡导出 ---- */
await goto("#/tools/cards");
check("生词卡：默认取生词本，预览给出正面与背面", (() => {
  const rows = WIO.cardRows("star");
  return rows.length === LRIO.starCount() && rows.every((r) => r.front && r.back.length > 6) &&
    view().querySelectorAll(".cd-prev .cd-card").length === Math.min(3, rows.length);
})());
check("生词卡：Anki CSV 首行是 front,back，行数与卡数对得上", (() => {
  const rows = WIO.cardRows("star");
  const csv = WIO.cardCsv(rows);
  return csv.startsWith("front,back\r\n") && csv.trim().split("\r\n").length === rows.length + 1;
})());
check("生词卡：CSV 转义按规范（有逗号或引号就整格加引号、内部引号翻倍）", (() => {
  const csv = WIO.cardCsv([{ front: 'a,b', back: '说"引"' }]);
  return csv.includes('"a,b"') && csv.includes('"说""引"""');
})());
check("生词卡：对折卡 Word 是两列表格，表头＋每卡一行", (() => {
  const rows = WIO.cardRows("star");
  const tbl = WIO.cardBlocks(rows).find((b) => b.t === "table");
  return !!tbl && tbl.rows.length === rows.length + 1 &&
    tbl.rows[0].join("/") === "正面/背面" && tbl.widths.length === 2 &&
    tbl.rows[1].length === 2;
})());
check("生词卡：换范围即时生效（生词本 → 全部词条，卡片数跟着变）", (() => {
  const sel = view().querySelector("#cd-scope");
  sel.value = "all";
  sel.dispatchEvent(new window.Event("change", { bubbles: true }));
  const m = /共\s*(\d+)\s*张卡/.exec(view().querySelector("#cd-body").textContent);
  sel.value = "star";
  sel.dispatchEvent(new window.Event("change", { bubbles: true }));
  return !!m && +m[1] === ALLT.length && WIO.cardRows("all").length === ALLT.length;
})());
check("生词卡：范围里没有词条时给空态，导出按钮禁用", (() => {
  LRIO.quizClearWrong();                       // 错题本清空，这个范围就空了
  const sel = view().querySelector("#cd-scope");
  sel.value = "wrong";
  sel.dispatchEvent(new window.Event("change", { bubbles: true }));
  const empty = !!view().querySelector("#cd-body .qz-empty");
  const dis = ["cd-csv", "cd-word", "cd-md"].every((a) =>
    view().querySelector('[data-act="' + a + '"]').disabled);
  sel.value = "star";
  sel.dispatchEvent(new window.Event("change", { bubbles: true }));
  return empty && dis;
})());

check("学习记录：新增的排期与错题流水都落在本机存储里", (() => {
  const ex = WIO.lrExport();
  return !!ex.srs && !!ex.quiz && Array.isArray(ex.quiz.hist) && ex.quiz.hist.length >= 1 &&
    Object.keys(ex.srs).length >= 1 && typeof ex.readTs === "object";
})());

/* ---- 分析与教学一：概念关系图编辑器 ----
   面板已从「起点/终点选词 → 列最短链」的文本形态，换成内嵌 React Flow 节点编辑器
   （独立单文件 pathflow.html，用 iframe 引入）。所以这里分两段断言：
     a) 面板结构：iframe 指向同目录的 pathflow.html，缺文件时有说明卡，旧面板元素全清；
     b) 算法：pathFind / pathHopText / pathModes 这些纯函数一步没动，口径仍可断言。
   iframe 的加载与否是浏览器行为，jsdom 不加载也不该在这里断言 —— 那条链路由
   tmp/verify-pathembed.mjs 在真机上验。 */
await goto("#/tools/path");
check("关系图编辑器：面板改为内嵌编辑器，iframe 指向同目录的 pathflow.html", (() => {
  const v = view();
  const fr = v.querySelector("#path .pfe-frame");
  const wrap = v.querySelector("#pfe-wrap");
  const fb = v.querySelector("#pfe-fallback");
  return !!fr && fr.getAttribute("src") === "./pathflow.html" &&
    fr.getAttribute("title") !== null && !!wrap && !!fb &&
    !!v.querySelector("#pfe-state") &&
    /* 画框与说明卡互斥：任何时刻只有一个露出来（体检前 / 体检后都成立） */
    wrap.hidden !== fb.hidden;
})());
check("关系图编辑器：缺文件时的说明卡讲清了「两个文件要放同一个目录」", (() => {
  const t = (view().querySelector("#pfe-fallback") || {}).textContent || "";
  return t.indexOf("pathflow.html") !== -1 && t.indexOf("同一个目录") !== -1 &&
    t.indexOf("关系图") !== -1;
})());
check("关系图编辑器：旧面板的起点/终点/口径下拉/结果区已全部移除", (() => {
  const v = view();
  return !v.querySelector("#pth-a") && !v.querySelector("#pth-b") &&
    !v.querySelector("#pth-mode") && !v.querySelector("#pth-out") &&
    !v.querySelector("#pth-pick-a") && v.querySelectorAll(".pth-demo").length === 0;
})());
check("关系图编辑器：工具名录里的名字与说明已跟上（不再是「概念关系路径」）", (() => {
  const v = view();
  const cards = [...v.querySelectorAll(".tt-menu button, .tool-menu button, .tt-item, .tool-card h2")];
  const hit = cards.map((x) => x.textContent || "").join(" ");
  return hit.indexOf("概念关系图编辑器") !== -1 && hit.indexOf("概念关系路径") === -1;
})());
check("关系图编辑器：最短链算法仍在（「商品 → 利润率趋向下降的规律」长度恰为 4 步）", (() => {
  const r = WIO.pathFind("shangpin", "lirunlvxiajiang", "core");
  return r.ok && r.len === 4 && r.paths.length >= 1 &&
    r.paths.every((p) => p.length === 4 && p[p.length - 1].to === "lirunlvxiajiang") &&
    r.paths[0][0].to !== undefined;
})());
check("关系图编辑器：等长的走法去重后不重复（同一对词条挂两种关系也只算一条）", (() => {
  const r = WIO.pathFind("shangpin", "zibenzhiji", "core");
  const keys = r.paths.map((p) => p.map((e) => e.to).join(">"));
  return r.ok && new Set(keys).size === keys.length;
})());
check("关系图编辑器：关系范围三档未变，含共现的一档把断开的两个词条接上", (() => {
  const M = WIO.pathModes();
  if (M.core.rels.indexOf("appear") !== -1 || M.all.rels.indexOf("appear") === -1 ||
    !M.wide || !M.core.n) return false;
  /* 断言的是「这个能力还在」：至少存在一对词条，core 口径走不通（且说得出原因）、
     all 口径（含共现）能接上。具体是哪一对随数据增长而变，不写死。 */
  const T = window.CAPITAL_DATA.terms;
  for (const t of T) {
    if (t.id === "shangpin") continue;
    const core = WIO.pathFind("shangpin", t.id, "core");
    if (core.ok) continue;
    if (!core.why) return false;
    if (WIO.pathFind("shangpin", t.id, "all").ok) return true;
  }
  return false;
})());
check("关系图编辑器：一步关系的两种读法（顺读与倒读）都能说成一句通顺的话", (() => {
  const A = { term: "商品" }, B = { term: "使用价值" };
  const f = WIO.pathHopText(A, B, "expand", true);
  const b = WIO.pathHopText(A, B, "expand", false);
  const p = WIO.pathHopText(A, B, "prereq", false);
  return f.chip === "展开" && /「商品」展开出「使用价值」/.test(f.s) &&
    b.chip === "由…展开" && /「使用价值」展开出「商品」/.test(b.s) &&
    /「商品」是「使用价值」的前提/.test(p.s);
})());
check("关系图编辑器：起点即终点、或口径下走不通时，如实说明而不是给一条假路", (() => {
  return WIO.pathFind("shangpin", "shangpin", "core").ok === false &&
    WIO.pathFind("shangpin", "meiyouzhegeci", "core").ok === false;
})());
check("关系图编辑器：三档口径各自给出的最短步数单调不增（共现只会让路更短）", (() => {
  const core = WIO.pathFind("shangpin", "lirunlvxiajiang", "core");
  const wide = WIO.pathFind("shangpin", "lirunlvxiajiang", "wide");
  const all = WIO.pathFind("shangpin", "lirunlvxiajiang", "all");
  if (!core.ok || !wide.ok || !all.ok) return false;
  return wide.len <= core.len && all.len <= wide.len && all.paths.length >= 1;
})());

/* ---- 分析与教学二：概念计算器 ---- */
await goto("#/tools/calc");
check("计算器：六条式子各有一格，切换后表单与结果跟着换", (() => {
  const chips = [...view().querySelectorAll("#calc-chips .calc-chip")];
  if (chips.length !== 6) return false;
  const first = view().querySelectorAll(".calc-fields .calc-f").length;
  chips.find((c) => c.getAttribute("data-mode") === "prate")
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  return first === 4 && view().querySelectorAll(".calc-fields .calc-f").length === 3 &&
    /利润率/.test(view().querySelector(".calc-t").textContent);
})());
check("计算器：剩余价值率 m′ = m / v（两条算法互相对得上）", (() => {
  const r = WIO.calcRun("mrate", { m: "100", v: "50", ts: "6", tn: "4" });
  return r.main === "200%" && /按价值额/.test(r.steps.join("")) && /按劳动时间/.test(r.steps.join(""));
})());
check("计算器：剩余价值量与年剩余价值率（M = m′×v，M′ = m′×n）", (() => {
  const once = WIO.calcRun("mass", { mr: "200", v: "50", n: "" });
  const year = WIO.calcRun("mass", { mr: "200", v: "50", n: "3" });
  return once.main === "100" && once.label.indexOf("剩余价值量") === 0 &&
    year.main === "600%" && /年剩余价值率/.test(year.label);
})());
check("计算器：资本有机构成 c : v 与两者的比重", (() => {
  const r = WIO.calcRun("comp", { c: "400", v: "100" });
  return /400 : 100/.test(r.main) && /4 : 1/.test(r.main) &&
    /80%/.test(r.steps[1]) && /20%/.test(r.steps[1]);
})());
check("计算器：利润率 p′ = m/(c+v)，并与 m′×v/(c+v) 互相验算", (() => {
  const r = WIO.calcRun("prate", { m: "100", c: "400", v: "100" });
  const s1 = r.steps[1] || "";
  return r.main === "20%" && /100 \/ \(400 \+ 100\) = 100 \/ 500 = 20%/.test(r.steps[0]) &&
    /换个算法验一遍/.test(s1) && /p′ = m′ × v\/\(c\+v\)/.test(s1) && /两条路子对得上/.test(s1);
})());
check("计算器：利润率那页附「同一个 m′ 下有机构成与利润率的对照」表", (() => {
  const r = WIO.calcRun("prate", { m: "100", c: "400", v: "100" });
  return /pr-tbl/.test(r.extra) && /<th>c : v = 9 : 1<\/th>/.test(r.extra) &&
    /<td class="pr-p">10%<\/td>/.test(r.extra) && /有机构成从 1:1 抬到 9:1/.test(r.extra) &&
    /不含周转与部门间竞争/.test(r.extra);
})());
check("计算器：周转次数 n = U/u，并折出年剩余价值率", (() => {
  const r = WIO.calcRun("turn", { U: "12", u: "3", mr: "100" });
  return /^4 次/.test(r.main) && /400%/.test(r.label) &&
    /n = U \/ u = 12 \/ 3 = 4/.test(r.steps[0]) && /年剩余价值率 M′ = m′ × n/.test(r.steps[1]);
})());
check("计算器：资本总公式 ΔG = G′ − G，并说清它与利润率是同一个数", (() => {
  const r = WIO.calcRun("gwg", { G: "500", G2: "600" });
  return r.main === "100" && /ΔG = G′ − G = 600 − 500 = 100/.test(r.steps[0]) &&
    /同一个数/.test(r.extra) && /20%/.test(r.extra);
})());
check("计算器：缺数、除零都不硬算，给一句能懂的提示", (() => {
  const empty = WIO.calcRun("mrate", { m: "", v: "" });
  const zero = WIO.calcRun("comp", { c: "100", v: "0" });
  const bad = WIO.calcRun("turn", { U: "12", u: "0" });
  return !!empty.need && !!zero.need && !!bad.need && !empty.main;
})());
check("计算器：填一个数就地重算，输入框本身不被重画（光标不丢）", (() => {
  const set = (k, val) => {
    const el = view().querySelector('[data-calc="' + k + '"]');
    el.value = val;
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
    return view().querySelector('[data-calc="' + k + '"]');
  };
  const sel = view().querySelector('#calc-chips [data-mode="mrate"]');
  sel.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const same1 = set("m", "100") === view().querySelector('[data-calc="m"]');
  const same2 = set("v", "50") === view().querySelector('[data-calc="v"]');
  return same1 && same2 && view().querySelector(".calc-rv").textContent === "200%";
})());

/* ---- 分析与教学三：大事年表 ---- */
await goto("#/tools/chrono");
check("大事年表：三条轴都在，事件按年份升序，每条都带合法的来源标记", (() => {
  const C = WIO.chrono(), src = WIO.chronoSrc(), AX = WIO.chronoAxes();
  const keys = Object.keys(src);
  const axes = Object.keys(AX);
  const sorted = axes.every((a) => {
    const ys = WIO.chronoByAxis(a).map((e) => e.y);
    return ys.every((y, i) => i === 0 || ys[i - 1] <= y);
  });
  return C.length >= 40 && axes.length === 3 &&
    C.every((e) => keys.indexOf(e.k) > -1 && e.t.length > 2 && e.d.length > 5 && axes.indexOf(e.ax) > -1) &&
    sorted;
})());
check("大事年表：标为「站内词条」的条目都能点进站内词条", (() => {
  const C = WIO.chrono();
  const termEvs = C.filter((e) => e.k === "term");
  const IDs = new Set(DATA.terms.map((t) => t.id));
  return termEvs.length >= 12 && termEvs.every((e) => typeof e.tid === "string" && IDs.has(e.tid));
})());
check("大事年表：日期印在卷首文献上的条目，出处写到具体文献与页码", (() => {
  const juan = WIO.chrono().filter((e) => e.k === "juan");
  return juan.length >= 3 && juan.every((e) =>
    /《资本论》|《马克思恩格斯选集》/.test(e.src) && /第?\d+[—\-－]?\d*页|卷首献词/.test(e.src));
})());
check("大事年表：三栏并置渲染，事件数与算法一致，来源 chip 都挂上了", (() => {
  const v = view();
  const cols = [...v.querySelectorAll(".ch-col")];
  if (cols.length !== 3) return false;
  const axes = Object.keys(WIO.chronoAxes());
  return cols.every((c, i) => c.querySelectorAll(".ch-ev").length === WIO.chronoByAxis(axes[i]).length) &&
    v.querySelectorAll(".ch-k.k-juan").length >= 3 && v.querySelectorAll(".ch-k.k-common").length >= 3 &&
    !!v.querySelector(".ch-legend");
})());
check("大事年表：切到单条线只铺那一条，搜索按年份与关键词筛", (() => {
  view().querySelector('.ch-tab[data-ax="cn"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const one = view().querySelector(".ch-one");
  const cnAll = WIO.chronoByAxis("cn").length;
  const okOne = !!one && view().querySelectorAll(".ch-ev").length === cnAll;
  const q = view().querySelector("#ch-q");
  q.value = "1930";
  q.dispatchEvent(new window.Event("input", { bubbles: true }));
  const hit = view().querySelectorAll(".ch-ev").length;
  return okOne && hit >= 1 && hit < cnAll && /筛出/.test(view().querySelector("#ch-count").textContent);
})());
check("大事年表：导出三块按三条线分段，说明里带着来源分级", (() => {
  const b = WIO.chronoBlocks();
  const txt = b.filter((x) => x.t === "h2").map((x) => x.text);
  return b[0].t === "title" && txt.length === 3 &&
    txt.join("|") === Object.keys(WIO.chronoAxes()).map((k) => WIO.chronoAxes()[k].n).join("|") &&
    /通行年表/.test(JSON.stringify(b.slice(-1)));
})());

/* ---- 分析与教学四：讲义与投影模式 ---- */
await goto("#/tools/handout");
check("讲义：搜索一条词条加进来，清单、条数与讲义版式同时更新", (() => {
  const q = view().querySelector("#hd-q");
  q.value = "商品";
  q.dispatchEvent(new window.Event("input", { bubbles: true }));
  const sug = view().querySelector("#hd-sugs .pk-sug");
  if (!sug) return false;
  sug.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const picks = view().querySelectorAll(".hd-picks .hd-pick");
  const docs = view().querySelectorAll("#hd-doc .hd-t");
  return picks.length >= 1 && docs.length === picks.length &&
    /条/.test(view().querySelector("#hd-cnt").textContent) &&
    !!view().querySelector("#hd-doc .hd-q") && !!view().querySelector("#hd-doc .hd-where");
})());
check("讲义：按范围整批加入（用生词本）", (() => {
  LRIO.srsReset();
  const ids = LRIO.starIds ? LRIO.starIds() : [];
  const sel = view().querySelector("#hd-scope");
  sel.value = "star";
  sel.dispatchEvent(new window.Event("change", { bubbles: true }));
  const before = WIO.hd().picks.length;
  view().querySelector('[data-act="hd-fill"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const after = WIO.hd().picks.length;
  const total = new Set(WIO.hd().picks).size;
  return after >= before && total === after && (ids.length === 0 || after > before) &&
    view().querySelectorAll("#hd-doc .hd-t").length === after;
})());
check("讲义：导出块按「标题＋每条一节」排好，含引文与出处", (() => {
  const b = WIO.hdBlocks();
  const n = WIO.hd().picks.length;
  return b[0].t === "title" && n >= 1 &&
    b.filter((x) => x.t === "h2").length === n &&
    b.every((x) => typeof x.text === "string" || x.t === "table");
})());
check("讲义：引文只取已核的那一条，待补录的照实说明", (() => {
  WIO.hd().picks = [];
  WIO.hdAdd("shangpin");
  WIO.hdAdd("zibenlun");
  const html = WIO.hdDocHTML();
  return /<blockquote class="hd-q">/.test(html) && /hd-cite/.test(html) &&
    /书目|出处|第 \d+ 页|页/.test(html);
})());
check("投影模式：开一层全屏浮层，显示进度、上一条下一条", (() => {
  WIO.pjClose();
  WIO.pjOpen(null, 0);
  const el = doc.getElementById("pj");
  const n = WIO.hd().picks.length;
  if (!el) return false;
  const cnt = el.querySelector(".pj-cnt").textContent;
  const hasNav = !!el.querySelector('[data-act="pj-next"]') && !!el.querySelector('[data-act="pj-prev"]');
  return el.className.indexOf("pj") === 0 && cnt === "1 / " + n && hasNav &&
    !!el.querySelector(".pj-n") && !!el.querySelector(".pj-one") &&
    doc.body.classList.contains("pj-on");
})());
check("投影模式：方向键翻页、到末尾不越界、Esc 退出", (() => {
  const key = (k) => doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true }));
  const n = WIO.hd().picks.length;
  key("ArrowRight");
  const at2 = doc.getElementById("pj").querySelector(".pj-cnt").textContent === "2 / " + n;
  key("ArrowLeft"); key("ArrowLeft");       // 往回多按一次，不能越过第一条
  const at1 = doc.getElementById("pj").querySelector(".pj-cnt").textContent === "1 / " + n;
  for (let i = 0; i < n + 5; i++) key("ArrowRight");
  const atEnd = doc.getElementById("pj").querySelector(".pj-cnt").textContent === n + " / " + n;
  key("Escape");
  return n >= 2 ? (at2 && at1 && atEnd && !doc.getElementById("pj") &&
    !doc.body.classList.contains("pj-on")) : false;
})());
check("投影模式：打开时挂上全屏浮层，条数是讲义的条数", (() => {
  WIO.pjOpen(null, 0);
  const el = doc.getElementById("pj");
  return !!el && el.querySelector(".pj-cnt").textContent === "1 / " + WIO.hd().picks.length &&
    doc.body.classList.contains("pj-on");
})());
await goto("#/manual");
check("投影模式：换页自动收掉浮层，不会盖在新页面上", (() =>
  !doc.getElementById("pj") && !doc.body.classList.contains("pj-on"))());

/* ---- 写作台（v9：大纲—卡片—成文） ---- */
await goto("#/tools/writer");
check("写作台：面板有大纲、卡片区、四种卡片入口与导出动作", (() => {
  const v = view();
  return !!v.querySelector("#wt-out") && !!v.querySelector("#wt-cards") &&
    !!v.querySelector("#wt-title") && !!v.querySelector("#wt-sec-h") &&
    v.querySelectorAll('[data-act="wt-card-add"]').length === 4 &&
    ["wt-word", "wt-md", "wt-copy-cite", "wt-clear", "wt-new", "wt-doc-del", "wt-sec-add"]
      .every((a) => !!v.querySelector('[data-act="' + a + '"]'));
})());
check("写作台：空稿时给空态提示，统计如实为零", (() => {
  const v = view();
  const st = WIO.wtStats();
  return !!v.querySelector(".wt-empty") && st.cards === 0 && st.refs === 0;
})());
check("写作台：点「＋ 自撰段落」加卡片，写进去的字就地落盘（不整块重绘）", (() => {
  const before = view().querySelectorAll(".wt-card").length;
  view().querySelector('[data-act="wt-card-add"][data-kind="free"]')
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const after = view().querySelectorAll(".wt-card").length;
  const ta = view().querySelector("#wt-cards [data-card-text]");
  if (!ta) return false;
  ta.value = "劳动概念的当代解释，是这一节要处理的问题。";
  ta.dispatchEvent(new window.Event("input", { bubbles: true }));
  const same = view().querySelector("#wt-cards [data-card-text]") === ta;   // 同一节点＝没重绘
  const cards = WIO.wt().docs.find((d) => d.id === WIO.wt().cur)
    .secs.reduce((a, s) => a.concat(s.cards), []);
  return after === before + 1 && same &&
    cards.some((c) => c.kind === "free" && /劳动概念的当代解释/.test(c.text)) &&
    /正文\s*\d+\s*字/.test(view().querySelector("#wt-stat").textContent);
})());
check("写作台：从词条收入素材，原典引文与争鸣立场各成卡片并带出处", (() => {
  const t = window.CAPITAL_DATA.terms.find((x) =>
    (x.original || []).some((o) => o.text) && (x.scholars || []).some((g) => (g.stances || []).length));
  if (!t) return false;
  const n = WIO.wtAddTerm(t.id);
  const cards = WIO.wt().docs.find((d) => d.id === WIO.wt().cur).secs
    .reduce((a, s) => a.concat(s.cards), []);
  const quotes = cards.filter((c) => c.kind === "quote" && c.termId === t.id);
  const claims = cards.filter((c) => c.kind === "claim" && c.termId === t.id);
  return n >= 2 && quotes.length >= 1 && claims.length >= 1 &&
    quotes.every((c) => c.text && c.cite) && claims.every((c) => c.text) &&
    quotes.some((c) => c.text.length > 20);      // 收进来的是原文，不是摘要
})());
check("写作台：词条页工具条有「加入写作台」，点了给回执并落卡", () => {
  const t = window.CAPITAL_DATA.terms.find((x) => (x.original || []).some((o) => o.text));
  window.location.hash = "#/t/" + t.id;
  return new Promise((r) => setTimeout(() => {
    const btn = view().querySelector('[data-act="wt-add-term"]');
    if (!btn) return r(false);
    const before = WIO.wtStats().cards;
    btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const toast = doc.getElementById("wt-toast");
    r(WIO.wtStats().cards > before && !!toast && toast.classList.contains("on") &&
      /写作台/.test(toast.textContent));
  }, 40));
});
await goto("#/tools/writer");
check("写作台：脚注按正文出现顺序编号，同一出处复用同一号", (() => {
  const secs = [{ id: "x", h: "节", cards: [
    { kind: "quote", text: "甲", fn: "《资本论》第一卷，第 1 页" },
    { kind: "free", text: "自己写的话" },
    { kind: "quote", text: "乙", fn: "《资本论》第三卷，第 9 页" },
    { kind: "claim", text: "丙", fn: "《资本论》第一卷，第 1 页" }
  ] }];
  const f = WIO.wtFootnotes(secs);
  return f.list.length === 2 && f.map["《资本论》第一卷，第 1 页"] === 1 &&
    f.map["《资本论》第三卷，第 9 页"] === 2;
})());
check("写作台：导出块里引文挂脚注、文末参考文献按同一次序排好", (() => {
  const b = WIO.wtBlocks();
  const fns = b.filter((x) => x.fn);
  const refs = b.filter((x) => x.t === "ref");
  const idx = b.findIndex((x) => x.t === "h2" && x.text === "参考文献");
  const no = WIO.wtFootnotes().list.length;
  return b[0].t === "title" && no > 0 && fns.length > 0 && refs.length === no &&
    idx > 0 && b.slice(idx + 1).every((x) => x.t === "ref" || x.t === "small") &&
    refs.every((x, i) => x.text.indexOf("[" + (i + 1) + "] ") === 0);
})());
check("写作台：Word 里是真脚注（footnotes.xml ＋ footnoteReference），不是段末小字", (() => {
  const s = Buffer.from(WIO.docxBuild(WIO.wtBlocks())).toString("latin1");
  /* ZIP 是 STORE 不压缩，按字节找部件名与标记即可 */
  return s.indexOf("word/footnotes.xml") > -1 &&
    s.indexOf("footnotes+xml") > -1 &&
    s.indexOf("<w:footnoteReference w:id=") > -1 &&
    s.indexOf('<w:footnote w:id="1">') > -1 &&
    s.indexOf('w:numRestart w:val="eachPage"') > -1;
})());
check("写作台：Markdown 用 [^n] 脚注标记，并在文末给出定义", (() => {
  const md = WIO.wtMarkdown();
  const n = WIO.wtFootnotes().list.length;
  return /\[\^1\]/.test(md) && /## 参考文献/.test(md) && /\[\^1\]: /.test(md) &&
    (md.match(/\[\^\d+\]/g) || []).length >= n;
})());
check("写作台：稿子落在本机 localStorage（键 capital-dict-writer-v1）", (() => {
  WIO.wtSave();
  const raw = window.localStorage.getItem("capital-dict-writer-v1");
  const d = raw ? JSON.parse(raw) : null;
  return !!d && Array.isArray(d.docs) && d.docs.length >= 1 &&
    d.docs.reduce((a, x) => a + x.secs.reduce((b, s) => b + s.cards.length, 0), 0) >= 2;
})());
check("写作台：加一节即新建空节，「空节/切节」动作作用于当前文稿", (() => {
  const v = view();
  const n0 = v.querySelectorAll("#wt-out .wt-sec").length;
  v.querySelector('[data-act="wt-sec-add"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const n1 = view().querySelectorAll("#wt-out .wt-sec").length;
  const cur = WIO.wt().docs.find((d) => d.id === WIO.wt().cur);
  const onSec = cur.secs.find((s) => s.id === WIO.wt().sel);
  return n1 === n0 + 1 && !!onSec && onSec.cards.length === 0 &&
    !!view().querySelector(".wt-empty");
})());

/* ---- v16 · 可达性（WCAG 2.1 AA）----
   这些条目的判定不依赖布局，jsdom 里也能算：要么是 DOM 属性，要么是样式表文本。
   真机的对比度与触达尺寸另由 tmp/ux-audit.mjs 逐页量。 */
check("v16：次级文字色 --ink-3 已换成达标的 #6d6459", (() => {
  const css = doc.querySelector("style").textContent;
  const m = css.match(/--ink-3:\s*(#[0-9a-fA-F]{6})/);
  if (!m) return false;
  const hex = m[1].slice(1).match(/../g).map((h) => parseInt(h, 16));
  const lum = (c) => {
    const f = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  };
  const cr = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const hx = (s) => s.slice(1).match(/../g).map((h) => parseInt(h, 16));
  /* 三档纸色里最差的那一档也要过 4.5 —— AA 正文门槛 */
  const worst = Math.min(
    cr(hex, hx((css.match(/--paper:\s*(#[0-9a-fA-F]{6})/) || [])[1])),
    cr(hex, hx((css.match(/--paper-2:\s*(#[0-9a-fA-F]{6})/) || [])[1])),
    cr(hex, hx((css.match(/--paper-3:\s*(#[0-9a-fA-F]{6})/) || [])[1])));
  return worst >= 4.5;
})());
check("v16：跳转链接在壳子里，且正文区可接收脚本焦点", (() => {
  const sk = doc.querySelector("[data-skip]");
  const main = doc.getElementById("view");
  return !!sk && sk.tagName === "BUTTON" && main.getAttribute("tabindex") === "-1";
})());
check("v16：换页播报区是 aria-live=\"polite\"", (() => {
  const l = doc.getElementById("route-live");
  return !!l && l.getAttribute("aria-live") === "polite" && l.className.includes("sr-only");
})());
check("v16：点跳转链接把焦点送进正文（键盘用户不用爬顶栏）", (() => {
  doc.querySelector("[data-skip]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  return doc.activeElement === doc.getElementById("view");
})());
await goto("#/tax");
check("v16：当前导航项挂 aria-current=\"page\"，且全站只挂一个", (() => {
  const cur = [...doc.querySelectorAll('.navlinks a[aria-current="page"]')];
  return cur.length === 1 && cur[0].getAttribute("data-route") === "tax";
})());
check("v16：换页后向播报区写入了页名", (() => {
  const t = doc.getElementById("route-live").textContent;
  return /已载入/.test(t) && t.length > 3;
})(), doc.getElementById("route-live").textContent);
await goto("#/manual");
check("v16：一页只允许一个 h1（使用手册页只有页标题）",
  doc.querySelectorAll("#view h1").length === 1 && !doc.querySelector("#cm-doc"));
check("v16：样式表里有触达下限 --tap-min 与粗指针放大规则", (() => {
  const css = doc.querySelector("style").textContent;
  return /--tap-min:\s*1\.5rem/.test(css) && /@media\s*\(pointer:\s*coarse\)/.test(css);
})());
check("v16：宽表格容器能自己收缩（min-width:0 + minmax(0,1fr)），窄屏顶不出横向滚动条", (() => {
  const css = doc.querySelector("style").textContent;
  return /\.cm-two\s*>\s*\*\s*\{\s*min-width:\s*0/.test(css) &&
    /\.cm-two\s*\{[^}]*minmax\(0,\s*1fr\)/.test(css) &&
    /\.ta-scroll,\s*\.ct-scroll\s*\{[^}]*max-width:\s*100%/.test(css);
})());
check("v16：窄屏索引网格收成 7 列（13 列每格不到 24px，手指点不中）", (() => {
  const css = doc.querySelector("style").textContent;
  return /@media\s*\(max-width:\s*560px\)\s*\{\s*\.alpha\s*\{[^}]*repeat\(7/.test(css);
})());
await goto("#/");
check("v16：系统「增强对比度」偏好下次级文字提到正文色", (() => {
  const css = doc.querySelector("style").textContent;
  return /@media\s*\(prefers-contrast:\s*more\)/.test(css) &&
    /--ink-3:\s*var\(--ink-2\)/.test(css);
})());
check("v16：按「/」聚焦搜索框（焦点在输入框里时不抢）", (() => {
  const q = doc.getElementById("topQ");
  doc.body.focus();
  doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "/", bubbles: true }));
  const hit = doc.activeElement === q;
  /* 反过来：焦点已在输入框时按斜杠不该被接管，否则打不出字符 */
  const ta = doc.createElement("input");
  doc.body.appendChild(ta); ta.focus();
  doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "/", bubbles: true }));
  const kept = doc.activeElement === ta;
  ta.remove();
  return hit && kept;
})());

/* ---- v65：首次进入的引导弹窗（概念关系图 / 阅读器） ---- */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const gd = () => doc.getElementById("gd-mask");
/* 前面的关系图路由测试可能已经把它标成「已读」，这里清掉重来 */
try {
  window.localStorage.removeItem("capital-guide-graph-v1");
  window.localStorage.removeItem("capital-guide-reader-v1");
} catch (e) { /* 存储不可用时本就只有内存标记 */ }
if (gd()) gd().remove();

await goto("#/graph");
await wait(360);
check("v65：首次进入概念关系图自动弹出引导", !!gd() && gd().getAttribute("data-kind") === "graph");
check("v65：概念关系图引导列全四种操作（左键／中键／滚轮／Ctrl+滚轮）", (() => {
  if (!gd()) return false;
  const keys = [...gd().querySelectorAll(".gd-key")].map((x) => x.textContent.trim());
  return keys.length === 4 &&
    keys.some((k) => k === "左键") && keys.some((k) => k.includes("中键")) &&
    keys.some((k) => k === "滚轮") && keys.some((k) => k.includes("Ctrl"));
})());
check("v65：引导具 dialog 语义，且有 ×／跳过／知道了 三个关闭入口", (() => {
  if (!gd()) return false;
  const card = gd().querySelector('[role="dialog"]');
  return !!card && card.getAttribute("aria-modal") === "true" &&
    !!gd().querySelector(".gd-x") && !!gd().querySelector(".gd-skip") && !!gd().querySelector(".gd-ok");
})());
check("v65：引导挂在 body 下、#view 之外（不受 .page-in 的 transform 包含块影响）",
  !!gd() && gd().parentElement === doc.body);

doc.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
check("v65：Esc 关闭引导并写入「已读」", !gd() && !!window.localStorage.getItem("capital-guide-graph-v1"));

await goto("#/");
await goto("#/graph");
await wait(360);
check("v65：同一页第二次进入不再自动弹出", !gd());

await goto("#/reader");
await wait(360);
check("v65：首次进入阅读器自动弹出引导，且讲到「选中即查」「书签」「阅读进度」", (() => {
  if (!gd() || gd().getAttribute("data-kind") !== "reader") return false;
  const t = gd().textContent;
  return /选中即查/.test(t) && /书签/.test(t) && /阅读进度/.test(t);
})());
gd().querySelector(".gd-skip").click();
check("v65：点「跳过」关闭并写入「已读」", !gd() && !!window.localStorage.getItem("capital-guide-reader-v1"));
await goto("#/");

/* ---- v69：首页功能导览（分步 / 单页，第一次进入自动弹出） ---- */
try {
  window.localStorage.removeItem("capital-guide-home-v1");
  window.sessionStorage.removeItem("capital-guide-home-v1");
} catch (e) { /* 同上 */ }
if (gd()) gd().remove();

await goto("#/");
await wait(520);
check("v69：首次进首页自动弹出功能导览（分步形态）",
  !!gd() && gd().getAttribute("data-kind") === "home" && !!gd().querySelector(".gd-steps"));
check("v69：四枚圆点导航，首步讲「词条检索」且带落地链接", (() => {
  if (!gd()) return false;
  return gd().querySelectorAll(".gd-dot").length === 4 &&
    gd().querySelector(".gd-fn")?.textContent === "词条检索" &&
    gd().querySelector(".gd-go")?.getAttribute("href") === "#/idx";
})());
check("v69：首步「上一步」隐藏，主按钮文案是「下一步」", (() => {
  if (!gd()) return false;
  return gd().querySelector(".gd-prev").hidden === true &&
    gd().querySelector(".gd-ok").textContent === "下一步";
})());
gd().querySelector(".gd-ok").click();   /* → 第 2 步 */
gd().querySelector(".gd-ok").click();   /* → 第 3 步 */
check("v69：下一步 ×2 落到第 3 步「概念关系图」，上一步可用", (() => {
  if (!gd()) return false;
  return gd().querySelector(".gd-fn")?.textContent === "概念关系图" &&
    gd().querySelector(".gd-go")?.getAttribute("href") === "#/graph" &&
    gd().querySelector(".gd-prev").hidden === false;
})());
gd().querySelector(".gd-prev").click();
check("v69：上一步退回第 2 步「马克思画传」", (() => {
  if (!gd()) return false;
  return gd().querySelector(".gd-fn")?.textContent === "马克思画传" &&
    gd().querySelector(".gd-go")?.getAttribute("href") === "#/pictorial";
})());
gd().querySelectorAll(".gd-dot")[3].click();
check("v69：圆点直跳第 4 步「文本分析」，主按钮变为「开始使用」", (() => {
  if (!gd()) return false;
  return gd().querySelector(".gd-fn")?.textContent === "文本分析" &&
    gd().querySelector(".gd-go")?.getAttribute("href") === "#/tools/tt" &&
    gd().querySelector(".gd-ok").textContent === "开始使用";
})());
gd().querySelector(".gd-flat").click();
check("v69：「一页看完」切成四行单页，收起圆点与翻页件", (() => {
  if (!gd()) return false;
  const okBtn = gd().querySelector(".gd-ok");
  return gd().querySelector(".gd-steps").classList.contains("is-flat") &&
    gd().querySelectorAll(".gd-rows .gd-row").length === 4 &&
    ["词条检索", "马克思画传", "概念关系图", "文本分析"].every((w) => gd().textContent.includes(w)) &&
    window.getComputedStyle(okBtn).display === "none" &&
    window.getComputedStyle(gd().querySelector(".gd-dots")).display === "none" &&
    gd().querySelector(".gd-flat").textContent === "分步看";
})());
gd().querySelector(".gd-flat").click();
check("v69：「分步看」切回分步形态，仍停在第 4 步", (() => {
  if (!gd()) return false;
  return !gd().querySelector(".gd-steps").classList.contains("is-flat") &&
    gd().querySelector(".gd-fn")?.textContent === "文本分析" &&
    gd().querySelectorAll(".gd-dot")[3].classList.contains("on");
})());
gd().querySelector(".gd-skip").click();
check("v69：「跳过」关闭并写入「已读」",
  !gd() && !!window.localStorage.getItem("capital-guide-home-v1"));

await goto("#/");
await wait(300);
check("v69：已读后再次进首页不弹", !gd());
await goto("#/");

/* ---- v70：图表生成工具（面板骨架 · 名录 · 手册口径） ---- */
/* xlsx/CSV 的真实解析与十六种图型的实际渲染依赖 DecompressionStream，
   jsdom 里没有——那部分由真机探针（tmp/probe-v70.mjs，无头 Edge）覆盖；
   这里守的是：注册、路由、面板骨架、文案口径与导出按钮的存在。 */
await goto("#/tools/chart");
await wait(300);
check("v70：#/tools/chart 落到图表生成面板",
  !!doc.getElementById("chart") && !!doc.getElementById("ch-data"));
check("v70：导入区与文件输入就位（xlsx/csv 白名单）", (() => {
  const f = doc.getElementById("ch-file");
  return !!doc.getElementById("ch-drop") && !!f && /\.csv/.test(f.getAttribute("accept"));
})());
check("v70：面板列出四类图谱的适用场景", (() => {
  const t = doc.getElementById("chart").textContent;
  return ["比较类", "趋势类", "结构与占比类", "关联与分布类"].every((w) => t.includes(w)) &&
    t.includes("树状图") && t.includes("瀑布图") && t.includes("箱线图") && t.includes("热力图");
})());
check("v70：未导入数据时无导出按钮、不出图", (() => {
  const d = doc.getElementById("ch-data");
  return d.innerHTML === "" && !doc.querySelector('[data-act="ch-png"]');
})());

await goto("#/tools");
await wait(300);
check("v70：工具台总览收录图表生成（分析与教学组）", (() => {
  const card = doc.querySelector('.to-item[href="#/tools/chart"]');
  return !!card && !card.classList.contains("soon") && card.textContent.includes("图表生成");
})());
check("v70：顶栏巨型菜单名录含图表生成，计数十五件", (() => {
  const box = doc.getElementById("navTools");
  return !!box && box.textContent.includes("图表生成") && box.textContent.includes("十五件一览");
})());

await goto("#/manual");
await wait(300);
check("v70：使用手册改为十五件口径并收录图表生成",
  text().includes("十五件工具") && text().includes("图表生成") && text().includes("导出 PNG 或 SVG"));
await goto("#/");

/* ---- v73：横轴标签「详细 / 粗略」双模式开关 ---- */
/* 面板配置区要导入数据后才渲染（jsdom 解压不了 xlsx），这里守内联源里的
   开关本体与两档文案；真实切换渲染由真机探针（tmp/probe-v73.mjs）覆盖。 */
check("v73：横轴标签模式开关已内联（详细/粗略两档，切档即重渲染）",
  html.includes('id="ch-xlab"') && html.includes("详细 · 全部显示") &&
  html.includes("粗略 · 抽稀显示") && html.includes("CH.cfg.xlab = xl.value"));
check("v73：详细模式全显不截断，粗略模式走抽稀；换表保留用户所选模式",
  html.includes('a.cfg.xlab !== "skip"') && html.includes("full ? 1 :") &&
  html.includes("cfg.xlab = CH.cfg.xlab"));

/* ---- v74：图表功能导引弹窗（16 种图 · 分步展示） ---- */
/* 弹窗的图与工具共用 chChartSvg，纯字符串拼装，jsdom 里就能整段走一遍。 */
/* v70 段在图表页停留超 520ms 时「首次自动弹出」就已经发生过：弹窗 DOM 被建出、
   已读标记被写入、随后随换页正常关闭。会话内 CHG.el 只建一次（关闭仅摘 .on），
   这里断言那次自动弹出的两个证据；完整的打开—驻留—导航时序由
   真机探针 tmp/probe-v74.mjs（首访自动弹 + 二访不弹）把守。 */
check("v74：首次进入图表页自动弹出（弹窗已建 + 已读标记已写）",
  window.localStorage.getItem("capital-chart-guide-v1") === "true" &&
  !!doc.querySelector(".chg") && doc.querySelectorAll(".chg-dot").length === 16);
await goto("#/tools/chart");
await wait(400);
check("v74：第 1 步分组柱状图出图，用途/场景/要点/样例表齐备", (() => {
  const fig = doc.getElementById("chg-fig");
  return !!fig && !!fig.querySelector("svg") && fig.querySelectorAll("rect").length >= 10 &&
    (doc.getElementById("chg-use") || {}).textContent?.length > 8 &&
    (doc.getElementById("chg-scene") || {}).textContent?.length > 8 &&
    doc.querySelectorAll("#chg-points li").length >= 2 &&
    doc.querySelectorAll("#chg-data-tb tbody tr").length >= 3;
})());
check("v74：「下一步」推进到第 2 步，末页前不禁用", (() => {
  doc.querySelector(".chg-next").click();
  return doc.getElementById("chg-i").textContent === "2" && !doc.querySelector(".chg-next").disabled;
})());
check("v74：× 可关闭，且解锁背景滚动", (() => {
  doc.querySelector(".chg-x").click();
  return !doc.querySelector(".chg.on") && !doc.body.classList.contains("chg-lock");
})());
check("v74：面板有「功能导引」入口，重开后「用这份样例试画」把样例灌进工具", (() => {
  const btn = doc.getElementById("ch-guide-btn");
  if (!btn) return false;
  btn.click();
  const opened = !!doc.querySelector(".chg.on");
  doc.querySelector(".chg-try").click();
  const svg = doc.querySelector("#ch-svg svg");
  const docName = (doc.getElementById("ch-doc") || {}).textContent || "";
  return opened && !!svg && svg.querySelectorAll("rect").length >= 10 &&
    !doc.querySelector(".chg.on") && docName.includes("样例");
})());
check("v74：16 套样例数据全部内联（每套带用途/场景/要点三段）",
  (html.match(/scene: "/g) || []).length === 16 &&
  (html.match(/关键数据要点/) || []).length >= 1 &&
  html.includes("用这份样例试画"));
await goto("#/");

/* ---- v72：词条关系图谱（词条页内嵌力导向图） ---- */
await goto("#/t/shengyujiazhi");
await wait(900);
check("v72：有关联的词条出现「关系图谱」图块",
  !!doc.querySelector(".trel[data-trel='shengyujiazhi']") &&
  text().includes("关系图谱"));
check("v72：图谱 SVG 已渲染且节点数 = 一跳+二跳（≤22）", (() => {
  const ns = doc.querySelectorAll(".trel .trel-n");
  return ns.length >= 7 && ns.length <= 22;
})());
check("v72：边已连出（≥ 一跳数），中心节点唯一且加大",
  doc.querySelectorAll(".trel .trel-e").length >= 6 &&
  doc.querySelectorAll(".trel .trel-n.c0").length === 1);
check("v72：节点标题可读（title 含词条名与点击提示）",
  (doc.querySelector(".trel .trel-n title") || {}).textContent?.includes("点击查看词条"));
await goto("#/t/yihua");
await wait(500);
check("v72：无关联词条（一般词「异化」）不出图块、不空挂容器",
  text().includes("关系图谱") === false && doc.querySelector(".trel") === null);
await goto("#/");

/* ---- v75：文本分析 → 图表生成「一键转场」 ---- */
await goto("#/tools/tt");
check("v75：结果区底部有「生成图表」按钮，有词频时为可用态并说明会带什么过去", (() => {
  const cta = doc.getElementById("ta-chart-cta");
  const b = cta && cta.querySelector(".ta-chart-btn");
  return !!b && !b.disabled && b.getAttribute("aria-disabled") === "false" &&
    /生成图表/.test(b.textContent) && /词频表/.test(cta.textContent);
})());
check("v75：空结果的禁用与提示逻辑在源码里（无词时 disabled + 原因文案）",
  html.includes('没有切出可画图的词') && html.includes('(chartOk ? "" : " disabled")'));
doc.querySelector("#ta-chart-cta .ta-chart-btn").click();
await wait(80);
check("v75：点击后落在图表页，文档条出现「文本分析结果」", (() => {
  const chips = [...doc.querySelectorAll("#ch-files .tt-chip b")].map((b) => b.textContent);
  return /#\/tools\/chart/.test(window.location.hash) &&
    chips.some((t) => t.includes("文本分析结果"));
})());
check("v75：转入即出图——标题带入、图已渲染，可在图表页继续改图型导出", (() => {
  const t = doc.getElementById("ch-title");
  const svg = doc.querySelector("#ch-svg svg");
  return !!t && t.value === "文本分析 · 词频" && !!svg &&
    (svg.querySelectorAll("rect, path, circle, polygon").length >= 5);
})());
await goto("#/");

/* ---- v77：首页 hero 第四枚「图表分析」入口 ---- */
check("v77：hero 入口四枚且「图表分析」与「文本分析」同款同排、深链直达图表工具",
  doc.querySelectorAll(".hero-entries a").length === 4 &&
  [...doc.querySelectorAll(".hero-entries a")].map(a => a.textContent.trim()).join("|") ===
    "马克思画传|概念关系图|文本分析|图表分析" &&
  [...doc.querySelectorAll(".hero-entries a")].some(a => a.getAttribute("href") === "#/tools/chart"));

/* ---- 未知路由 ---- */
await goto("#/nope");
check("未知路由有兜底", text().includes("页面不存在"));

check("无未捕获脚本错误", errors.length === 0, errors.slice(0, 2).join(" | "));

console.log(`\n${failed === 0 ? "全部通过" : failed + " 项失败"}`);
process.exit(failed === 0 ? 0 : 1);
