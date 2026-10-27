#!/usr/bin/env node
/**
 * 构建脚本（零依赖，Node 18+）
 *
 *   node scripts/build.mjs              生成 site/data/terms.js
 *   node scripts/build.mjs --offline    额外生成 dist/capital-dict-offline.html（单文件离线版）
 *
 * 数据唯一来源：data/terms.json
 * 产物：
 *   site/data/terms.js             —— 站点运行时读取（用 <script> 注入，避免 file:// 下 fetch 被 CORS 拦截）
 *   dist/capital-dict-offline.html —— 把 CSS / 数据 / 脚本全部内联，双击即开，无需服务器
 */

/* ═══ 发布前去注释 ═══
   交付件是给读者看的成品，不该带着开发笔记（版本号、踩坑记录、内部参数）。
   源码里的注释保持原样，只在构建时剥离；剥离后先做语法校验，不通过就退回原文。 */

function stripCssComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

function stripHtmlComments(src) {
  /* 只剥标签层的注释；<script> / <style> 内部原样保留 ——
     那里的注释属于各自的语言，由 stripJsComments / stripCssComments 处理。 */
  let out = "";
  let i = 0;
  const n = src.length;
  const lower = src.toLowerCase();
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) { out += src.slice(i); break; }
    out += src.slice(i, lt);
    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt + 4);
      if (end < 0) break;                 /* 没有收口就到此为止，不硬删 */
      i = end + 3;
      continue;
    }
    const tag = /^<(script|style)\b[^>]*>/i.exec(src.slice(lt, lt + 200));
    if (tag) {
      const close = lower.indexOf("</" + tag[1].toLowerCase(), lt);
      const stop = close < 0 ? n : src.indexOf(">", close) + 1;
      out += src.slice(lt, stop);
      i = stop;
      continue;
    }
    out += "<";
    i = lt + 1;
  }
  return out;
}

function stripJsComments(src) {
  /* 逐字符扫描：字符串、模板串（含 ${} 里的表达式）、正则字面量里的 // 与 /* 都不算注释。
     ⚠ 正则字面量必须单独认：`/['"]/` 里的引号若被当成字符串开头，
     扫描器会滑进字符串状态，后半段注释就全漏掉了（实测漏 2 处）。
     正则的判定用「前一个有效字符」：出现在 ( , = : [ ! & | ? { } ; + - * % ~ ^ < >
     之后或语句开头，才是正则；否则是除号。 */
  let i = 0;
  let out = "";
  const n = src.length;
  const REGEX_PREV = "(,=:[!&|?{};+-*%~^<>";
  const KEYWORDS = /(?:^|[^\w$])(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)$/;

  function scanCode(stopAtBrace) {
    let depth = 0;
    let prevSig = "";        /* 上一个有效字符（跳过空白），用来判正则 */
    let recent = "";         /* 最近一小段代码，用来识别 return / typeof 之类 */
    while (i < n) {
      const c = src[i];
      if (c === "/" && src[i + 1] === "/") {
        i += 2;
        while (i < n && src[i] !== "\n") i++;
        continue;
      }
      if (c === "/" && src[i + 1] === "*") {
        i += 2;
        while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
        i += 2;
        continue;
      }
      if (c === '"' || c === "'") {
        const q = c;
        out += c; i++;
        while (i < n) {
          const d = src[i];
          out += d;
          if (d === "\\") { out += src[i + 1] || ""; i += 2; continue; }
          i++;
          if (d === q) break;
        }
        prevSig = "x"; recent = "x";
        continue;
      }
      if (c === "`") { out += c; i++; scanTemplate(); prevSig = "x"; recent = "x"; continue; }
      if (c === "/" && (prevSig === "" || REGEX_PREV.indexOf(prevSig) >= 0 || KEYWORDS.test(recent))) {
        out += c; i++;
        let inClass = false;
        while (i < n) {
          const d = src[i];
          out += d;
          if (d === "\\") { out += src[i + 1] || ""; i += 2; continue; }
          i++;
          if (d === "\n") break;              /* 正则不跨行：判错了就当场退出 */
          if (d === "[") inClass = true;
          else if (d === "]") inClass = false;
          else if (d === "/" && !inClass) break;
        }
        prevSig = "x"; recent = "x";
        continue;
      }
      if (stopAtBrace) {
        if (c === "{") depth++;
        else if (c === "}") {
          if (depth === 0) { out += c; i++; return; }
          depth--;
        }
      }
      out += c;
      if (!/\s/.test(c)) { prevSig = c; recent = (recent + c).slice(-12); }
      i++;
    }
  }

  function scanTemplate() {
    while (i < n) {
      const c = src[i];
      if (c === "\\") { out += c + (src[i + 1] || ""); i += 2; continue; }
      if (c === "`") { out += c; i++; return; }
      if (c === "$" && src[i + 1] === "{") { out += "${"; i += 2; scanCode(true); continue; }
      out += c; i++;
    }
  }

  scanCode(false);
  return out;
}


import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const P = (...s) => resolve(ROOT, ...s);

async function main() {
  const raw = await readFile(P("data/terms.json"), "utf8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error("✗ data/terms.json 不是合法 JSON：", e.message);
    process.exit(1);
  }

  const terms = data.terms || [];
  const ids = new Set(terms.map((t) => t.id));

  const problems = [];

  // --- 分类索引：taxonomies[].cats[] 扁平化 ---
  const taxonomies = (data.meta && data.meta.taxonomies) || [];
  const catIndex = new Map(); // 门类 id -> { ...cat, tax, taxName, field }
  for (const tx of taxonomies) {
    for (const c of tx.cats || []) {
      if (catIndex.has(c.id)) problems.push(`门类 id 重复：${c.id}`);
      catIndex.set(c.id, { ...c, tax: tx.id, taxName: tx.name, field: tx.field });
    }
  }

  // --- 校验：字段完整性 + 关联死链 + 分类合法性 ---
  const seen = new Set();
  for (const t of terms) {
    const where = t.id || "(无 id)";
    if (!t.id) problems.push(`${where}: 缺 id`);
    if (seen.has(t.id)) problems.push(`${where}: id 重复`);
    seen.add(t.id);
    for (const f of ["term", "pinyin", "initials", "oneline", "standard", "contemporary"]) {
      if (!t[f]) problems.push(`${where}: 缺字段 ${f}`);
    }
    // 每个分类维度都必须有值，且必须属于该维度
    for (const tx of taxonomies) {
      const cid = t[tx.field];
      if (!cid) { problems.push(`${where}: 缺分类字段 ${tx.field}（${tx.name}）`); continue; }
      const c = catIndex.get(cid);
      if (!c) problems.push(`${where}: ${tx.field} 指向不存在的门类「${cid}」`);
      else if (c.tax !== tx.id) problems.push(`${where}: ${tx.field} 误用了「${c.taxName}」维度的门类「${cid}」`);
    }
    if ((t.oneline || "").length > 60) problems.push(`${where}: oneline 超过 60 字（${t.oneline.length}）`);
    if (!Array.isArray(t.related) || !t.related.length) problems.push(`${where}: related 为空`);
    for (const r of t.related || []) {
      if (!ids.has(r.id)) problems.push(`${where}: related 指向不存在的词条「${r.id}」`);
    }
  }
  // 「已核对」= 该条所有原典引文都过了核（逐字命中 + 页码已核）
  const allOk = (t) => (t.original || []).length > 0 && (t.original || []).every((o) => o.verify === true);
  const verified = terms.filter((t) => t.verified || allOk(t)).length;
  const pendingQ = terms.filter((t) => (t.original || []).some((o) => o.pending || !o.text)).length;
  const quoted = terms.filter((t) => (t.original || []).some((o) => o.text && !o.pending)).length;
  const cntLoc = (loc) => terms.filter((t) => (t.original || []).some((o) => o.verify && o.loc === loc)).length;
  const yeji = cntLoc("页");          // 图书：核到印刷页
  const banji = cntLoc("版");         // 报纸：核到见报日期
  const tiaoji = cntLoc("条");        // 法律：核到条款
  const juanji = cntLoc("篇");        // 卷首文献：不印页码
  // 学界争鸣栏：以「已写入各方立场」为已补口径，只有议题线索不算
  const cntSt = (t, onlyCited) => (t.scholars || []).reduce((a, g) =>
    a + (g.stances || []).filter((s) => (onlyCited ? s.verified === true : true)).length, 0);
  const schTopic = terms.filter((t) => (t.scholars || []).length > 0).length;
  const schStance = terms.reduce((a, t) => a + cntSt(t), 0);
  const schCited = terms.reduce((a, t) => a + cntSt(t, true), 0);
  const schLead = terms.filter((t) => !(t.scholars || []).length && t.scholars_lead).length;
  const noOrig = terms.filter((t) => !(t.original || []).length).length;

  // --- 1. site/data/terms.js ---
  await mkdir(P("site/data"), { recursive: true });
  /* 发布数据里不带创作说明正文：那是投稿材料，不该随页面一起分发。
     作品名留着——导出文稿要用它做标题。 */
  const pub = { ...data, meta: { ...(data.meta || {}) } };
  if (pub.meta.credit_meta) {
    pub.meta.credit_meta = { work_title: pub.meta.credit_meta.work_title || "" };
  }
  const js = "/* 自动生成，请勿直接编辑。数据源：data/terms.json */\n" +
    "window.CAPITAL_DATA = " + JSON.stringify(pub, null, 2) + ";\n";
  await writeFile(P("site/data/terms.js"), js, "utf8");

  console.log(`✓ site/data/terms.js  （${terms.length} 条词条）`);
  console.log(`  已核对原典页码   ${verified} / ${terms.length}   ← 逐页核对，唯一必须人工完成的部分`);
  console.log(`  原典引文已补录   ${quoted} / ${terms.length}   （图书页级 ${yeji}，报纸版级 ${banji}，法律条款 ${tiaoji}，卷首文献 ${juanji}）`);
  console.log(`  原典引文待补录   ${pendingQ} / ${terms.length}`);
  console.log(`  学界争鸣已补     ${schTopic} / ${terms.length}   （共 ${schStance} 方立场，其中文献已核 ${schCited} 方）`);
  console.log(`  学界争鸣待补     ${terms.length - schTopic} / ${terms.length}   （其中已列出争鸣点线索 ${schLead} 条）`);
  if (noOrig) console.log(`  ⚠ 无原典条目的词条 ${noOrig} / ${terms.length}   ← 应为 0：每条词条都须给出原典指引，哪怕是「待补」`);
  for (const tx of taxonomies) {
    const have = (tx.cats || []).reduce((a, c) => a + terms.filter((t) => t[tx.field] === c.id).length, 0);
    const plan = (tx.cats || []).reduce((a, c) => a + (c.planned || 0), 0);
    console.log(`  ${tx.name}（${have} / ${plan}）`);
    for (const c of tx.cats || []) {
      const n = terms.filter((t) => t[tx.field] === c.id).length;
      console.log(`    ${String(n).padStart(2)} / ${String(c.planned || 0).padStart(2)}  ${c.name}${n === 0 ? "  ← 待补" : ""}`);
    }
  }

  if (problems.length) {
    console.log(`\n⚠ 数据校验发现 ${problems.length} 处问题：`);
    problems.slice(0, 40).forEach((p) => console.log("  · " + p));
    if (problems.length > 40) console.log(`  … 另有 ${problems.length - 40} 处`);
  } else {
    console.log("\n✓ 数据校验通过");
  }

  // --- 2. 离线单文件版 ---
  if (process.argv.includes("--offline")) {
    /* 三个来源都先去注释：交付件不带开发笔记，源码里照旧保留。 */
    const html = stripHtmlComments(await readFile(P("site/index.html"), "utf8"));
    let css = stripCssComments(await readFile(P("site/assets/site.css"), "utf8"));
    const appRaw = await readFile(P("site/assets/app.js"), "utf8");
    let app = stripJsComments(appRaw);
    /* 语法校验：剥完先编译一遍（new Function 只编译不执行），
       不通过就用原文——宁可带着注释，也不能交出一份跑不起来的页面。 */
    try {
      new Function(app);
    } catch (e) {
      console.log("  ⚠ 去注释后语法校验失败，改用原文：" + e.message);
      app = appRaw;
    }

    // 资源内联：相对引用 → base64 data URI。
    //   css —— 样式表里的 url("文件")，要在拼接 out 之前先换掉；
    //   js  —— 脚本里的 "assets/文件" 字符串字面量（书封那三张走这条），
    //          要等 html + js 拼成 out 之后再换。
    // 一律 split/join 或函数式 replacer，免得替换串里的 $ 被当成替换模式。
    const ASSETS = [
      { file: "intro-house.jpg", mime: "image/jpeg", label: "开屏底图与手册配图", in: "both" },
      /* v55 深夜模式页面底图（用户提供）。挂在 html 上由 CSS 的 --dark-bg 取，
         只在 [data-theme="dark"] 下生效；浅色模式根本不引用这个变量。 */
      { file: "dark-bg.jpg", mime: "image/jpeg", label: "深夜模式页面底图", in: "css" },
      { file: "intro-wordmark.svg", mime: "image/svg+xml", label: "开屏镂空词标", in: "css" },
      { file: "intro-wordmark-line.svg", mime: "image/svg+xml", label: "开屏词标金线", in: "css" },
      { file: "vol-1.jpg", mime: "image/jpeg", label: "《资本论》第一卷书封", in: "js" },
      { file: "vol-2.jpg", mime: "image/jpeg", label: "《资本论》第二卷书封", in: "js" },
      { file: "vol-3.jpg", mime: "image/jpeg", label: "《资本论》第三卷书封", in: "js" },
      { file: "cat-phil.jpg", mime: "image/jpeg", label: "门类配图《德意志意识形态》", in: "js" },
      { file: "cat-econ.jpg", mime: "image/jpeg", label: "门类配图《资本论》", in: "js" },
      { file: "cat-soc.jpg", mime: "image/jpeg", label: "门类配图《共产党宣言》", in: "js" },
    ];
    const inline = async (file, mime, label, ref, hits, swap) => {
      const buf = await readFile(P("site/assets/" + file));
      const uri = "data:" + mime + ";base64," + buf.toString("base64");
      console.log("  · " + label + "已内联 " + file + "（" + hits + " 处，" + (buf.length / 1024).toFixed(1) +
        " KB → " + (uri.length / 1024).toFixed(1) + " KB base64）");
      return swap(uri);
    };

    /* in 有三档：css / js / both。both 表示同一个资源被 CSS 的 url("…") 与
       JS 的 "assets/…" 两处同时引用（如 intro-house.jpg：开屏底图 ＋ 使用手册配图），
       两轮循环都要处理它，否则 JS 里那处替换不掉、构建报「仍有外部引用未替换」。 */
    for (const a of ASSETS.filter((x) => x.in === "css" || x.in === "both")) {
      const ref = 'url("' + a.file + '")';
      if (!css.includes(ref)) {
        console.log("  ⚠ CSS 未引用 " + a.file + "，离线版将缺少" + a.label);
        continue;
      }
      // 同一个资源在 CSS 里会出现多次（-webkit- 前缀与标准属性各一份），必须全局替换
      const hits = css.split(ref).length - 1;
      css = await inline(a.file, a.mime, a.label, ref, hits, (uri) => css.split(ref).join('url("' + uri + '")'));
    }

    let out = html
      .replace(/<link rel="stylesheet" href="assets\/site\.css">/,
        () => "<style>\n" + css + "\n</style>")
      .replace(/<script src="data\/terms\.js"><\/script>\s*<script src="assets\/app\.js"><\/script>/,
        () => "<script>\n" + js + "</script>\n<script>\n" + app + "\n</script>")
      .replace(/<title>[^<]*<\/title>/, "<title>《资本论》学习平台</title>")
      // 离线包不引用外部图片：og:image 只对在线分享有意义
      .replace(/<meta property="og:image"[^>]*>\s*/g, "");

    for (const a of ASSETS.filter((x) => x.in === "js" || x.in === "both")) {
      const ref = '"assets/' + a.file + '"';
      if (!out.includes(ref)) {
        console.log("  ⚠ 脚本未引用 assets/" + a.file + "，离线版将缺少" + a.label);
        continue;
      }
      const hits = out.split(ref).length - 1;
      out = await inline(a.file, a.mime, a.label, ref, hits, (uri) => out.split(ref).join(JSON.stringify(uri)));
    }

    const leftovers = ASSETS.filter((a) => out.includes('"' + a.file + '"') ||
      out.includes('"assets/' + a.file + '"')).map((a) => a.file);
    if (out.includes("assets/site.css") || out.includes("assets/app.js") || leftovers.length) {
      console.error("✗ 内联失败：仍有外部引用未替换" + (leftovers.length ? "（" + leftovers.join("、") + "）" : ""));
      process.exit(1);
    }

    await mkdir(P("dist"), { recursive: true });
    await writeFile(P("dist/capital-dict-offline.html"), out, "utf8");
    const kb = (Buffer.byteLength(out, "utf8") / 1024).toFixed(1);
    console.log(`✓ dist/capital-dict-offline.html  （单文件，${kb} KB，双击即开）`);
  }

  console.log("\n完成。");
}

main().catch((e) => { console.error(e); process.exit(1); });
