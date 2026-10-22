/* docx 导出器的独立校验（不进自测主流程，改动导出逻辑时才跑）
 *
 *   node scripts/check-docx.mjs
 *
 * 做法：在 jsdom 里加载站点、调 window.CAPITAL_IO.docxBuild 生成字节，
 * 落到 tmp/check-docx.docx，再交给 python-docx 读回来——
 * 「Word 能不能打开、样式对不对」不能靠肉眼，要真的解析一遍。
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

// jsdom 装在隔离的 node 工作区里，不在项目目录，所以按绝对路径解析
const JSDOM_ROOT = process.env.JSDOM_ROOT || "C:/Users/lenovo/.workbuddy/binaries/node/workspace";
const { JSDOM } = createRequire(resolve(JSDOM_ROOT, "index.js"))("jsdom");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const P = (...s) => resolve(ROOT, ...s);

const PY = process.env.CAPITAL_PY ||
  "C:/Users/lenovo/.workbuddy/binaries/python/envs/default/Scripts/python.exe";

const html = await readFile(P("dist/capital-dict-offline.html"), "utf8");
const dom = new JSDOM(html, { url: "http://localhost/", runScripts: "dangerously",
  pretendToBeVisual: true });
const win = dom.window;
await new Promise((r) => win.addEventListener("load", r));

const IO = win.CAPITAL_IO;
if (!IO || !IO.docxBuild) {
  console.error("✗ 站点未暴露 CAPITAL_IO.docxBuild（先 node scripts/build.mjs --offline）");
  process.exit(1);
}

const blocks = [
  { t: "title", text: "《资本论》学习平台" },
  { t: "sub", text: "创作说明（AIGC创意作品）" },
  { t: "sub", text: "作者：某某　学校：某某大学" },
  { t: "h2", text: "一、作品主题" },
  { t: "p", text: "把《资本论》的术语门槛降下来。作品面向没有政治经济学基础的高校青年，共 300 条词条。" },
  { t: "quote", text: "资本主义生产方式占统治地位的社会的财富，表现为“庞大的商品堆积”。",
    fn: "《资本论》第一卷，人民出版社 2004 年版，第 47 页。" },
  { t: "p", text: "五行之外\n第二行\n第三行" },
  { t: "p", text: "引文之后的正文，脚注挂在上一段的引文上，这一段没有脚注。" },
  { t: "quote", text: "商品的价值形式只是劳动产品的价值关系的表现形式。",
    fn: "《资本论》第一卷，人民出版社 2004 年版，第 76 页。" },
  { t: "table", rows: [["项目", "数量"], ["词条总数", "300"], ["引文已核", "273"]], widths: [5000, 3600] },
  { t: "small", text: "注：本表由程序生成。" },
  { t: "pagebreak" },
  { t: "h2", text: "附录" },
  { t: "ref", text: "[1] 马克思：《资本论》第一卷，人民出版社 2004 年版，第 47 页。" }
];

const u8 = IO.docxBuild(blocks);
await writeFile(P("tmp/check-docx.docx"), Buffer.from(u8));
console.log(`✓ 生成 tmp/check-docx.docx（${u8.length} 字节）`);

const py = `
import sys
from docx import Document
from docx.shared import Pt
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
d = Document(sys.argv[1])
sec = d.sections[0]
print("段落数：", len(d.paragraphs), "| 表格数：", len(d.tables))
print("页面：%.1f x %.1f mm | 页边距 上/下/左/右：%.2f/%.2f/%.2f/%.2f cm" % (
    sec.page_width.mm, sec.page_height.mm,
    sec.top_margin.cm, sec.bottom_margin.cm, sec.left_margin.cm, sec.right_margin.cm))

def eff(p):
    """段落实际生效的字号/字体/粗体：先看直接格式，再看段落样式继承链。"""
    r = p.runs[0]
    st, sizes, fonts, bolds = p.style, [], [], []
    while st is not None:
        if st.font.size: sizes.append(st.font.size.pt)
        if st.font.bold is not None: bolds.append(st.font.bold)
        el = st.element.rPr
        if el is not None and el.rFonts is not None and el.rFonts.get(W + "eastAsia"):
            fonts.append(el.rFonts.get(W + "eastAsia"))
        st = st.base_style
    sz = r.font.size.pt if r.font.size else (sizes[0] if sizes else None)
    fn = (r._element.rPr.rFonts.get(W + "eastAsia")
          if r._element.rPr is not None and r._element.rPr.rFonts is not None else None) or (fonts[0] if fonts else None)
    bd = r.font.bold if r.font.bold is not None else (bolds[0] if bolds else False)
    return p.style.name, sz, fn, bd

ps = [p for p in d.paragraphs if p.text.strip()]
for key, tag in (("《资本论》学习平台", "主标题"), ("把《资本论》的术语门槛", "正文"),
                 ("资本主义生产方式占统治", "引文块"), ("注：本表由程序生成", "小字"),
                 ("[1] 马克思", "参考文献")):
    hit = [p for p in ps if p.text.startswith(key)]
    if not hit:
        print("!! 缺段落", tag); continue
    p = hit[0]
    st, sz, fn, bd = eff(p)
    pf = p.paragraph_format
    print("%s：样式=%s 字号=%spt 中文字体=%s 加粗=%s 对齐=%s 首行缩进=%s 行距=%s" % (
        tag, st, sz, fn, bd, p.alignment, pf.first_line_indent, pf.line_spacing))
print("换行段：", repr([p.text for p in ps if p.text.startswith("五行")][0]))
print("表格首行：", [c.text for c in d.tables[0].rows[0].cells])
print("表格末行：", [c.text for c in d.tables[0].rows[-1].cells])

# 脚注：真脚注部件在不在、注文对不对、正文有没有引用它
import zipfile
z = zipfile.ZipFile(sys.argv[1])
names = z.namelist()
print("部件：", sorted(names))
fn_xml = z.read("word/footnotes.xml").decode("utf8") if "word/footnotes.xml" in names else ""
doc_xml = z.read("word/document.xml").decode("utf8")
import re
refs = re.findall(r'<w:footnoteReference w:id="(\\d+)"', doc_xml)
ids = re.findall(r'<w:footnote w:id="(\\d+)"', fn_xml)
print("正文脚注引用：", refs, "| 脚注部件里的条：", ids)
print("每页重编：", "numRestart" in doc_xml and 'w:val="eachPage"' in doc_xml,
      "| ①编号：", "decimalEnclosedCircle" in doc_xml)
print("脚注样式：", [s for s in ("FootnoteReference", "FootnoteText") if s in z.read("word/styles.xml").decode("utf8")])
try:
    print("python-docx 读脚注：", [f.text for f in d.footnotes])
except Exception as e:
    print("python-docx 不提供脚注对象（%s），以上为 XML 层核对" % type(e).__name__)
`;
await writeFile(P("tmp/check-docx.py"), py, "utf8");
if (process.env.NO_PY) {
  console.log("（NO_PY：跳过 python-docx 回读，已写出 tmp/check-docx.py）");
  process.exit(0);
}
const out = (() => {
  try {
    return execFileSync(PY, [P("tmp/check-docx.py"), P("tmp/check-docx.docx")], {
      encoding: "utf8"
    });
  } catch (e) {
    /* 沙箱里 Node 直接 spawn 解释器可能被拒（EBUSY）。
       这时不要假装通过：把命令原样打出来，让人手跑一次。 */
    console.log("（无法从 Node 直接调用 python： " + (e.code || e.message) + "）");
    console.log("请手动执行：\n  " + PY + " " + P("tmp/check-docx.py") + " " + P("tmp/check-docx.docx"));
    process.exit(0);
  }
})();
console.log(out.trim());
process.exit(0);
