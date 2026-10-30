/* 《资本论》学习平台 · 应用逻辑
   零依赖 · hash 路由 · 支持本地 file:// 直接打开 */

(function () {
  "use strict";

  var DATA = window.CAPITAL_DATA || { meta: {}, terms: [] };
  var META = DATA.meta || {};
  var TERMS = DATA.terms || [];

  /* ════════ 开屏动画驱动（v31 · 词标遮罩放大揭幕） ════════
     三页分页：0 封面（正中花体词标）→ 1 揭幕完成（画面铺满）→ 2 导览（画面轻推）。
     翻页不做交叉淡入：JS 只写 --iv-mz 这一个进度变量，CSS 拿它驱动
     ① 词标遮罩 transform: scale()（放大到撑满视口＝揭开下一页）
     ② 底图虚化 blur（随进度递减，铺满时归零）
     ③ 兜底椭圆的尺寸（把字形之间的空隙补成整片）
     防误触三重门：动画期 busy 锁 + 滚轮静默间隔 220ms 门控 + 8px 抖动阈值。
     首页向上忽略；页 2 向下＝退场进入平台。 */
  (function introVeil() {
    var veil = document.getElementById("intro-veil");
    if (!veil) return;
    var dead = false;
    function kill() {
      if (dead) return;
      dead = true;
      /* html 与 body 都要解锁：视口的滚动容器是 html，只解 body 会留下滚动条 */
      document.documentElement.classList.remove("iv-lock");
      document.body.classList.remove("iv-lock");
      /* 故居门牌注记只在开屏第 3 页出现，帘子一撤就得连类一起撤干净，
         否则它会跟着浮在站内每一个分页上（旧版就是常驻，本轮按需求收敛）。 */
      document.body.classList.remove("iv-cap");
      if (veil.parentNode) veil.parentNode.removeChild(veil);
    }
    var seen = false;
    try { seen = !!window.sessionStorage.getItem("capital-intro-v1"); } catch (e1) {}
    var deep = !!(location.hash && location.hash !== "#" && location.hash !== "#/");
    var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (seen || deep || reduced) { kill(); return; }
    try { window.sessionStorage.setItem("capital-intro-v1", "1"); } catch (e2) {}
    document.documentElement.classList.add("iv-lock");
    document.body.classList.add("iv-lock");

    var pages = veil.querySelectorAll(".iv-page");
    var dots = veil.querySelectorAll(".iv-dots i");
    var hint = veil.querySelector(".iv-hint");
    var LAST = pages.length - 1;
    /* 每一页对应的揭幕进度。判据是「有没有跨过 1」：
       0↔1 跨越揭幕界面 → 走长时长的放大/收缩；1↔2 只在铺满态里推近，走短时长。
       三页各有自己的进度值，所以上翻下翻都能原样复用同一套动画。 */
    var LEVEL = [0, 1, 1.125];
    var cur = 0, mz = LEVEL[0];
    var busy = false, exiting = false;
    var lastWheel = 0, lastNav = 0;
    var rafId = 0;
    var DUR_ZOOM = 1300, DUR_DRIFT = 900;
    var GAP_WHEEL = 220, GAP_NAV = 260, DY_MIN = 8;

    function quint(t) { return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2; }
    function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

    function applyPage() {
      for (var i = 0; i < pages.length; i++) {
        pages[i].classList.toggle("iv-on", i === cur);
        if (dots[i]) dots[i].classList.toggle("iv-on", i === cur);
      }
      /* 故居门牌注记的显示范围：**只有开屏第 3 页**（cur === LAST，索引 2）。
         第 1、2 页与退出开屏后都没有这个类 → CSS 里落到 display:none，
         这两页上等于根本没这个节点：它本就是 position:fixed、不参与布局流，
         display:none 再让它连绘制与命中测试都不参与，所以既不占位也不影响动画。
         判据写「等于末页索引」而不是「大于首页索引」，是因为这条注记锚的是
         **导览页那张构图**（底图已铺满、格言与结语同屏）——前两页都还在揭幕过程里。 */
      document.body.classList.toggle("iv-cap", cur === LAST);
      if (hint) hint.textContent = cur < LAST ? "滚轮向下继续 · 点击任意处跳过" : "向下滚动，进入平台";
    }

    function tweenMz(from, to, dur, done) {
      if (rafId) window.cancelAnimationFrame(rafId);
      var t0 = -1;
      function step(now) {
        if (dead) return;
        if (t0 < 0) t0 = now;
        var k = clamp01((now - t0) / dur);
        mz = from + (to - from) * quint(k);
        veil.style.setProperty("--iv-mz", mz.toFixed(4));
        if (k < 1) { rafId = window.requestAnimationFrame(step); return; }
        rafId = 0; mz = to;
        veil.style.setProperty("--iv-mz", to.toFixed(4));
        done();
      }
      rafId = window.requestAnimationFrame(step);
    }

    function goTo(n) {
      if (busy || n === cur || n < 0 || n > LAST) return;
      busy = true;
      var from = mz, to = LEVEL[n] === undefined ? 1 : LEVEL[n];
      cur = n;
      applyPage();
      function fin() { busy = false; }
      /* 跨过揭幕界面（进/出封面页）才走放大动画，同界面内换页只走轻推 */
      if (Math.abs(to - from) > .5) tweenMz(from, to, DUR_ZOOM, fin);
      else tweenMz(from, to, DUR_DRIFT, fin);
    }

    var SKIP_NOTE = 0;
    function unbind() {
      window.removeEventListener("wheel", onWheel, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onTap, true);
      window.removeEventListener("touchstart", onTs, true);
      window.removeEventListener("touchend", onTe, true);
    }
    function exit() {
      if (exiting) return;
      exiting = true;
      /* 立刻撤注记，别让它在 880ms 的退场淡出里继续压在已露出的站内页面上 */
      document.body.classList.remove("iv-cap");
      unbind();
      if (rafId) window.cancelAnimationFrame(rafId);
      veil.classList.add("iv-exit");
      window.setTimeout(kill, 880);
    }
    /* dir>0 下一页；dir<0 上一页。末页再向下＝进入平台；首页向上＝忽略 */
    function nav(dir) {
      if (busy || exiting) return;
      var now = Date.now();
      if (now - lastNav < GAP_NAV) return;
      lastNav = now;
      if (dir > 0) { if (cur < LAST) goTo(cur + 1); else exit(); }
      else if (cur > 0) goTo(cur - 1);
    }
    function onWheel(e) {
      e.preventDefault();   /* 动画期间拦截底层滚动 */
      var now = Date.now();
      var gap = now - lastWheel;
      lastWheel = now;
      if (busy || gap < GAP_WHEEL) return;        /* 动画中／同一手势的连续滚动：忽略 */
      var dy = e.deltaY;
      if (dy > -DY_MIN && dy < DY_MIN) return;    /* 触控板抖动：忽略 */
      nav(dy > 0 ? 1 : -1);
    }
    function onKey(e) {
      var k = e.key;
      if (k === "Escape") { exit(); return; }
      if (k === "ArrowDown" || k === "PageDown" || k === " " || k === "Enter") { e.preventDefault(); nav(1); }
      else if (k === "ArrowUp" || k === "PageUp") { e.preventDefault(); nav(-1); }
    }
    function onTap() { exit(); }
    var tsY = -1;
    function onTs(e) { tsY = e.touches && e.touches.length ? e.touches[0].clientY : -1; }
    function onTe(e) {
      if (tsY < 0 || !e.changedTouches || !e.changedTouches.length) return;
      var dy = tsY - e.changedTouches[0].clientY;
      tsY = -1;
      if (dy > 60) nav(1);
      else if (dy < -60) nav(-1);
    }
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onTap, { capture: true, passive: true });
    window.addEventListener("touchstart", onTs, { capture: true, passive: true });
    window.addEventListener("touchend", onTe, { capture: true, passive: true });

    /* 初始：页 0 + 封面文案距离瀑布（双 rAF 确保过渡生效） */
    applyPage();
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () { veil.classList.add("iv-play"); });
    });
  })();

  /* 分类：全站只用「知识板块」一个维度
     META.taxonomies = [{ id, name, field, basis, desc, cats:[{id,name,short,color,planned,note}] }]
       · domain 维度 → 词条的 domain 字段 → 知识板块（哲学 / 政治经济学 / 科学社会主义）
     数据里另存着 subject（0305 马克思主义理论二级学科）一维，那是各条的原始归属底账，
     站点一概不再呈现，所以在这里滤掉：凡按 TAXES 渲染的地方——门类导航、词条分类标签、
     关系图着色、统计与导出——都自动只剩板块，不必逐个改。 */
  var TAXES = (META.taxonomies || []).filter(function (tx) { return tx.id === "domain"; });

  /* 标签的拼音首字母（离线由 tools/gen_tag_initials.py 用 pypinyin 算好存进数据；
     站点零依赖，运行时算不了拼音）。标签增删后重跑该脚本即可。 */
  var TAGI = META.tag_initials || {};

  var CATS = {};   // 分类维度扁平化后的索引（站内只有知识板块一支）
  TAXES.forEach(function (tx) {
    (tx.cats || []).forEach(function (c) {
      CATS[c.id] = {
        id: c.id, name: c.name, short: c.short || c.name,
        color: c.color || "#888", planned: c.planned || 0, note: c.note || "",
        tax: tx.id, taxName: tx.name, field: tx.field
      };
    });
  });

  /* 学科方向（subject 维度，0305 马克思主义理论二级学科）：数据里一直存着，
     此前站点一概不呈现。v60 起作为总览页的第二轮筛选项启用：
     每个筛选项按「知识板块·学科方向」合并标注（如「哲学·基本原理」），
     点开进入组合筛选清单；词条侧的分类标注也改成同一形式。 */
  var SUB_TX = null;
  (META.taxonomies || []).forEach(function (tx) { if (tx.id === "subject") SUB_TX = tx; });
  var SUBS = {};
  ((SUB_TX && SUB_TX.cats) || []).forEach(function (c) {
    SUBS[c.id] = { id: c.id, name: c.name, short: c.short || c.name, color: c.color || "#888" };
  });
  function subName(id) { return (SUBS[id] && SUBS[id].name) || id; }
  function subShort(id) { return (SUBS[id] && SUBS[id].short) || subName(id); }
  /* 「板块·方向」合并短标注（如「哲学·基本原理」）；没有方向数据时退回板块短名 */
  function domSubLabel(t) {
    var s = (t && t.category && SUBS[t.category]) ? "·" + subShort(t.category) : "";
    return catShort(t && t.domain) + s;
  }
  /* 知识板块 × 学科方向 的组合清单 */
  function termsInSub(domId, subId) {
    return TERMS.filter(function (t) { return t.domain === domId && t.category === subId; });
  }

  var RELS = {};
  (META.relations || []).forEach(function (r) { RELS[r.id] = r.name; });

  var BY_ID = {};
  TERMS.forEach(function (t) { BY_ID[t.id] = t; });

  /* 核验状态：该条所有原典引文都已逐字命中且页码已核，才算「已核」
     （不依赖手工维护的 t.verified，避免漏标） */
  function allQuotesOk(t) {
    var os = t.original || [];
    return os.length > 0 && os.every(function (o) { return o.verify === true; });
  }
  function isVerified(t) { return !!t.verified || allQuotesOk(t); }

  /* 学界争鸣栏：一条词条 = 若干「争鸣议题」，每个议题下有正反各方立场 */
  function allStances(t) {
    var out = [];
    (t.scholars || []).forEach(function (g) {
      (g.stances || []).forEach(function (s) { out.push(s); });
    });
    return out;
  }
  function stanceCount(t, onlyCited) {
    return allStances(t).filter(function (s) {
      return onlyCited ? s.verified === true : true;
    }).length;
  }
  function hasStance(t) { return stanceCount(t) > 0; }

  /* 全站统计：首页与页脚共用同一组数字，只算一次 */
  var _stats = null;
  function stats() {
    if (_stats) return _stats;
    var withQuote = function (t) {
      return (t.original || []).some(function (o) { return o.text && !o.pending; });
    };
    var noQuote = function (t) {
      return (t.original || []).some(function (o) { return o.pending || !o.text; });
    };
    var atLoc = function (loc) {
      return function (t) {
        return (t.original || []).some(function (o) { return o.verify && o.loc === loc; });
      };
    };
    _stats = {
      total: TERMS.length,
      quoted: TERMS.filter(withQuote).length,
      pending: TERMS.filter(noQuote).length,
      verified: TERMS.filter(isVerified).length,
      locPage: TERMS.filter(atLoc("页")).length,
      locLevel: TERMS.filter(atLoc("篇级")).length,
      locFront: TERMS.filter(atLoc("篇")).length,
      locPaper: TERMS.filter(atLoc("版")).length,
      locLaw: TERMS.filter(atLoc("条")).length,
      /* 学界争鸣栏：以「已写入各方立场」为已补标准，光有议题线索不算 */
      scholar: TERMS.filter(hasStance).length,
      scholarTopic: TERMS.filter(function (t) { return (t.scholars || []).length > 0; }).length,
      scholarStance: TERMS.reduce(function (n, t) { return n + stanceCount(t); }, 0),
      scholarCited: TERMS.reduce(function (n, t) { return n + stanceCount(t, true); }, 0),
      scholarLead: TERMS.filter(function (t) {
        return !hasStance(t) && !!t.scholars_lead;
      }).length
    };
    return _stats;
  }

  /* ---------------- 工具 ---------------- */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* 标题里的书名号换楷体强调（v10）：
     wisprflow 的签名写法是「粗体无衬线 ＋ 斜体强调词组」，
     中文的对等物是「宋体正体 ＋ 楷体重音」——汉字没有斜体，
     标题里的重音位历来交给楷体。这里只包书名号那一段，
     替换一律走函数式写法，替换串里不放任何特殊模式符。 */
  function hlTitle(s) {
    return String(s == null ? "" : s)
      .replace(/《[^》]{1,40}》/g, function (m) {
        return '<span class="hl">' + m + "</span>";
      });
  }

  function norm(s) {
    return String(s || "").toLowerCase().replace(/[\s·・\-_/、，,。.""'']/g, "");
  }

  function catName(id) { return (CATS[id] && CATS[id].name) || id; }
  function catShort(id) { return (CATS[id] && CATS[id].short) || catName(id); }
  /* catColor() 随 v43 的关系图一起撤掉了：门类配色之前只有关系图那个图例在用，
     现在图上的着色由 pathflow 自己按知识板块给（见 pathflow/src/store）。 */

  function taxById(tid) {
    for (var i = 0; i < TAXES.length; i++) if (TAXES[i].id === tid) return TAXES[i];
    return null;
  }

  // 某个分类下的词条
  function termsIn(cid) {
    var c = CATS[cid];
    if (!c) return [];
    return TERMS.filter(function (t) { return t[c.field] === cid; });
  }

  function pySort(a, b) { return a.pinyin.localeCompare(b.pinyin); }

  function byInitial(letter) {
    return TERMS.filter(function (t) {
      return (t.initials || "").charAt(0).toUpperCase() === letter;
    }).sort(function (a, b) { return a.pinyin.localeCompare(b.pinyin); });
  }

  function allLetters() {
    var s = {};
    TERMS.forEach(function (t) {
      var L = (t.initials || "?").charAt(0).toUpperCase();
      s[L] = (s[L] || 0) + 1;
    });
    return s;
  }

  /* ---------------- 标签索引 ----------------
     标签早已写进数据（第一卷／核心范畴／当代议题……），只是一直没有入口。
     /^第[一二三四五六七八九十百\d]+(卷|篇|章|节|版)/ 认定为「原著位置」类，
     以《》开头认定为「经典著作」类，其余归入「主题」。三类分开列，
     因为读者找东西的方式不同：想按书翻的、想按话题找的。 */
  var PLACE_RE = /^第[一二三四五六七八九十百\d]+(卷|篇|章|节|版)/;
  function tagKind(name) {
    if (PLACE_RE.test(name)) return "place";
    if (/^《.+》$/.test(name)) return "work";
    return "topic";
  }
  var _tags = null;
  function tagsIndex() {
    if (_tags) return _tags;
    var m = {};
    TERMS.forEach(function (t) {
      (t.tags || []).forEach(function (g) { (m[g] = m[g] || []).push(t); });
    });
    _tags = Object.keys(m).map(function (k) {
      return { name: k, n: m[k].length, kind: tagKind(k), terms: m[k] };
    }).sort(function (a, b) { return b.n - a.n || a.name.localeCompare(b.name, "zh"); });
    return _tags;
  }
  function tagByName(name) {
    var all = tagsIndex();
    for (var i = 0; i < all.length; i++) if (all[i].name === name) return all[i];
    return null;
  }

  /* ---------------- GB/T 7714—2015 引注转换 ----------------
     页面上写的引注是人文社科通行的「《书名》版本，第X页」格式；
     投稿、课程论文常要求转成 GB/T 7714 的著录格式。这里做保守转换：
     只在「书名能确定责任者 + 出版社能确定出版地」时才输出，
     任何一环解析不了就返回 null——宁可不给按钮，也不给一条错的引注。 */
  var GB_AUTHOR = [
    [/^马克思恩格斯(选集|文集|全集)$/, "马克思, 恩格斯"],
    [/^资本论$/, "马克思"],
    [/^毛泽东选集$/, "毛泽东"],
    [/^列宁专题文集$/, "列宁"],
    [/^邓小平文选$/, "邓小平"]
  ];
  var GB_CITY = { "人民出版社": "北京", "商务印书馆": "北京" };

  function cnNum(s) {
    var map = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10 };
    if (/^\d+$/.test(s)) return s;
    return map[s] ? String(map[s]) : null;
  }

  /* 中文数字 → 整数（支持 合成数词：十三、二十四、四十八……） */
  function cnInt(s) {
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    var map = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
    if (s === "十") return 10;
    var ten = s.indexOf("十");
    if (ten === -1) return map[s] || null;
    var a = s.slice(0, ten), b = s.slice(ten + 1);
    return (a === "" ? 1 : (map[a] || 0)) * 10 + (b === "" ? 0 : (map[b] || 0));
  }

  /* 专著：《书名》[第N卷]，出版社YYYY年版，第X页（可带页码区间）
     报纸：作者：《篇名》（…），《人民日报》YYYY年M月D日 */
  function toGB(cite) {
    var s = String(cite || "").replace(/。\s*$/, "");

    var bk = /^《([^》]+)》(第?[一二三四五六七八九十\d]+卷)?，(?:[^，]*译，)?([\u4e00-\u9fa5]+出版社)(\d{4})年版，第(\d+)(?:[—\-](\d+))?页$/.exec(s);
    if (bk) {
      var title = bk[1], author = null;
      for (var i = 0; i < GB_AUTHOR.length; i++) {
        if (GB_AUTHOR[i][0].test(title)) { author = GB_AUTHOR[i][1]; break; }
      }
      if (!author) return null;
      var city = GB_CITY[bk[3]];
      if (!city) return null;
      var vol = bk[2] ? ": 第" + cnNum(bk[2].replace(/^第/, "").replace(/卷$/, "")) + "卷" : "";
      if (bk[2] && !cnNum(bk[2].replace(/^第/, "").replace(/卷$/, ""))) return null;
      var pages = bk[5] + (bk[6] ? "-" + bk[6] : "");
      return author + ". " + title + vol + "[M]. " + city + ": " + bk[3] + ", " + bk[4] + ": " + pages + ".";
    }

    var np = /^([^：]{2,20})：《([^》]+)》.*?，《人民日报》(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(s);
    if (np) {
      var mm = ("0" + np[4]).slice(-2), dd = ("0" + np[5]).slice(-2);
      return np[1] + ". " + np[2] + "[N]. 人民日报, " + np[3] + "-" + mm + "-" + dd + ".";
    }
    return null;
  }

  /* 复制到剪贴板：优先 Clipboard API，file:// 或被拒时退回 execCommand */
  function copyText(str, btn) {
    var flash = function (ok) {
      if (!btn) return;
      if (btn.__t) clearTimeout(btn.__t);
      if (!btn.__old) btn.__old = btn.textContent;
      btn.textContent = ok ? "已复制" : "复制失败";
      btn.classList.toggle("done", ok);
      btn.__t = setTimeout(function () {
        btn.textContent = btn.__old;
        btn.classList.remove("done");
      }, 1500);
    };
    var legacy = function () {
      var ta = document.createElement("textarea");
      ta.value = str;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(str).then(
        function () { flash(true); },
        function () { flash(legacy()); }
      );
    } else {
      flash(legacy());
    }
  }

  /* ---------------- 日期与时钟 ----------------
     首页的「今日」小组件读的是本机系统时间（new Date()），每秒重算；
     日期、天数、星期全部自己算，不用 toLocaleDateString——
     各浏览器/各系统的中文格式不一致，写死格式才不会在别人电脑上跑歪。 */
  var WK = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  /* 以「年-月-日」为键：打卡按自然日算，不掺时区与时分秒 */
  function dayKey(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function fmtClock(d) {
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
  }

  function fmtDate(d) {
    return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日 " + WK[d.getDay()];
  }

  /* 年内第几天。用 UTC 归一算，避免夏令时那天差一天（国内虽无夏令时，
     但浏览器时区可能被设成别的，算错一天不好解释） */
  function dayOfYear(d) {
    var a = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    var b = Date.UTC(d.getFullYear(), 0, 1);
    return Math.round((a - b) / 86400000) + 1;
  }

  /* ---------------- 法定节假日 ----------------
     数据来自 data/terms.json 的 meta.holidays（由 tools/gen_holidays.py 写入，
     照抄国务院办公厅年度通知）。构造时把「区间 + 调休补班日」展开成两张日期表，
     运行时只做两次查表，不必每次现算。

     表外的年份（通知通常到上一年 11 月才发布）查不到就返回 null，
     悬浮台照旧只显示日期——降级是静默的，不会因为没数据而报错。 */
  var HOL = (function () {
    var src = (META && META.holidays) || null;
    var off = {};    // "YYYY-MM-DD" -> {name, day, total, from, to}
    var work = {};   // "YYYY-MM-DD" -> {name}
    var spans = [];  // 按起始日升序，供「距下一个假期还有几天」用

    function parse(s) {
      var p = s.split("-");
      return new Date(+p[0], +p[1] - 1, +p[2]);
    }

    if (src && src.years) {
      Object.keys(src.years).forEach(function (y) {
        var cfg = src.years[y] || {};
        (cfg.spans || []).forEach(function (sp) {
          var a = parse(sp.from), b = parse(sp.to);
          var total = Math.round((b - a) / 86400000) + 1;
          var cur = new Date(a.getTime()), i = 0;
          while (cur <= b) {
            off[dayKey(cur)] = {
              name: sp.name, day: ++i, total: total, from: sp.from, to: sp.to
            };
            cur.setDate(cur.getDate() + 1);
          }
          spans.push({
            name: sp.name, from: sp.from, to: sp.to, total: total,
            range: (a.getMonth() + 1) + "月" + a.getDate() + "日—" +
                   (b.getMonth() + 1) + "月" + b.getDate() + "日"
          });
        });
        (cfg.work || []).forEach(function (w) { work[w.date] = w.name; });
      });
      spans.sort(function (a, b) { return a.from < b.from ? -1 : a.from > b.from ? 1 : 0; });
      // 调休补班日挂到所属节日上，提示里要写「为 X 调休」
      spans.forEach(function (sp) {
        sp.work = [];
        (src.years[sp.from.slice(0, 4)].work || []).forEach(function (w) {
          if (w.name === sp.name) sp.work.push(w.date);
        });
      });
    }

    return {
      /* 今天是放假、调休上班，还是平常日子。返回带 kind 的对象或 null */
      of: function (d) {
        var k = dayKey(d);
        if (off[k]) {
          var o = off[k];
          return { kind: "off", name: o.name, day: o.day, total: o.total };
        }
        if (work[k]) return { kind: "work", name: work[k] };
        return null;
      },
      /* 下一个假期（严格在今天之后）。今天已在假期中则返回下下个 */
      next: function (d) {
        var today = dayKey(d);
        var t0 = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        for (var i = 0; i < spans.length; i++) {
          if (spans[i].from > today) {
            return {
              name: spans[i].name,
              days: Math.round((parse(spans[i].from) - t0) / 86400000),
              from: parse(spans[i].from)
            };
          }
        }
        return null;
      },
      /* 悬停提示用的一句话：起止、天数、调休补班安排 */
      detail: function (name) {
        for (var i = 0; i < spans.length; i++) {
          if (spans[i].name !== name) continue;
          var s = spans[i];
          var t = s.name + "：" + s.range + "放假，共 " + s.total + " 天";
          if (s.work.length) {
            t += "；" + s.work.map(function (w) {
              var p = w.split("-");
              return (+p[1]) + "月" + (+p[2]) + "日";
            }).join("、") + "上班调休";
          } else {
            t += "（不调休）";
          }
          return t;
        }
        return "";
      },
      /* 全年安排（按起始日升序），供面板里的折叠列表用 */
      all: function () { return spans; }
    };
  })();

  /* ---------------- 学习记录（localStorage） ----------------
     工具性质的关键：让站点记住「学习者状态」——已读、生词本、笔记、上次读到哪。
     只存本机浏览器，不设账号；file:// 下 localStorage 被禁时退化为内存对象
     （本次会话内仍然可用），绝不让主功能因此报错。 */
  var LR = (function () {
    var KEY = "capital-dict-lr-v1";
    var mem = { read: {}, star: {}, notes: {}, days: {}, readTs: {},
                srs: {}, quiz: { hist: [], wrong: {} }, last: null };
    var store = null;
    try {
      var probe = window.localStorage;
      probe.setItem("__lr_probe__", "1");
      probe.removeItem("__lr_probe__");
      store = probe;
    } catch (e) { store = null; }
    var data = (function () {
      if (!store) return mem;
      try {
        var d = JSON.parse(store.getItem(KEY) || "null");
        if (!d || typeof d !== "object") return mem;
        d.read = d.read || {}; d.star = d.star || {}; d.notes = d.notes || {};
        d.days = d.days || {};   // 老数据没有 days 字段，补上
        // 下面几个是「学习与记忆」四件工具上来之后才有的：
        // readTs 给学习日历画进度曲线（老数据只有「读过没有」，没有「哪天读的」，就让它空着）
        d.readTs = d.readTs || {};
        d.srs = d.srs || {};     // 间隔重复卡：每条词条的排期状态
        d.quiz = d.quiz || {};   // 自测：做题流水 + 错题本
        d.quiz.hist = d.quiz.hist || [];
        d.quiz.wrong = d.quiz.wrong || {};
        return d;
      } catch (e) { return mem; }
    })();
    function save() {
      if (!store) return;
      try { store.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 存储满等异常：静默 */ }
    }
    function count(o) { return Object.keys(o).length; }
    function terms(ids) {
      return ids.map(function (id) { return BY_ID[id]; }).filter(Boolean);
    }
    return {
      isRead: function (id) { return !!data.read[id]; },
      setRead: function (id, v) {
        if (v) {
          data.read[id] = 1;
          if (!data.readTs[id]) data.readTs[id] = Date.now();   // 学习日历的进度曲线靠它
        } else { delete data.read[id]; delete data.readTs[id]; }
        save();
      },
      readCount: function () { return count(data.read); },
      readTs: function () { return data.readTs; },
      /* 已读时间序列：按日累计，给学习日历画曲线。取消已读会连时间戳一起删，
         所以曲线只会「回退一条」，不会因为反复标记而虚高。 */
      readByDay: function () {
        var by = {};
        Object.keys(data.readTs).forEach(function (id) {
          var d = new Date(data.readTs[id]);
          var k = dayKey(d);
          by[k] = (by[k] || 0) + 1;
        });
        return by;
      },
      isStar: function (id) { return !!data.star[id]; },
      setStar: function (id, v) { if (v) data.star[id] = 1; else delete data.star[id]; save(); },
      starCount: function () { return count(data.star); },
      starTerms: function () { return terms(Object.keys(data.star)); },
      starIds: function () { return Object.keys(data.star); },
      getNote: function (id) { return data.notes[id] || ""; },
      setNote: function (id, s) { s = (s || "").trim(); if (s) data.notes[id] = s; else delete data.notes[id]; save(); },
      noteCount: function () { return count(data.notes); },
      setLast: function (id) { data.last = id; save(); },
      getLast: function () { return data.last && BY_ID[data.last] ? data.last : null; },
      /* 打卡：记下「今天来过」。首页「今日」组件用它算连续天数 */
      touchDay: function () { var k = dayKey(new Date()); if (!data.days[k]) { data.days[k] = 1; save(); } },
      dayCount: function () { return count(data.days); },
      dayKeys: function () { return Object.keys(data.days).sort(); },
      /* 连续天数：从今天往回数，断一天就停。今天没访问过则为 0 */
      streak: function () {
        var n = 0, d = new Date();
        for (var i = 0; i < 4000; i++) {
          if (!data.days[dayKey(d)]) break;
          n++;
          d.setDate(d.getDate() - 1);
        }
        return n;
      },
      /* —— 自测引擎 —— */
      quizWrong: function () { return data.quiz.wrong; },
      quizWrongIds: function () { return Object.keys(data.quiz.wrong); },
      quizWrongCount: function () { return count(data.quiz.wrong); },
      quizHist: function () { return data.quiz.hist; },
      /* 交一次卷记一笔：题量、对几道、范围、错的都是谁。
         错题本只记「还不会的」：答对一次就从错题本里划掉。 */
      quizLog: function (n, ok, scope, wrongIds, rightIds) {
        data.quiz.hist.push({ ts: Date.now(), n: n, ok: ok, scope: scope });
        if (data.quiz.hist.length > 200) data.quiz.hist = data.quiz.hist.slice(-200);
        (wrongIds || []).forEach(function (id) {
          data.quiz.wrong[id] = (data.quiz.wrong[id] || 0) + 1;
        });
        (rightIds || []).forEach(function (id) { delete data.quiz.wrong[id]; });
        save();
      },
      quizDropWrong: function (id) { delete data.quiz.wrong[id]; save(); },
      quizClearWrong: function () { data.quiz.wrong = {}; save(); },
      /* —— 间隔重复卡：每条词的排期（SM-2 的简化版，三档自评） —— */
      srsGet: function (id) { return data.srs[id] || null; },
      srsAll: function () { return data.srs; },
      srsSet: function (id, o) { data.srs[id] = o; save(); },
      srsDel: function (id) { delete data.srs[id]; save(); },
      srsReset: function () { data.srs = {}; save(); },
      export_: function () { return JSON.parse(JSON.stringify(data)); }
    };
  })();

  /* ---------------- 待办清单（localStorage） ----------------
     和学习记录同一套路：只存本机浏览器，不设账号、不上传。
     待办是「这天要做什么」，和「读到哪」是两回事，所以单独一个 key。 */
  var TODO = (function () {
    var KEY = "capital-dict-todo-v1";
    var mem = { list: [] };
    var store = null;
    try {
      var probe = window.localStorage;
      probe.setItem("__todo_probe__", "1");
      probe.removeItem("__todo_probe__");
      store = probe;
    } catch (e) { store = null; }
    var data = (function () {
      if (!store) return mem;
      try {
        var d = JSON.parse(store.getItem(KEY) || "null");
        if (!d || !Array.isArray(d.list)) return mem;
        return { list: d.list.filter(function (x) { return x && x.id && typeof x.text === "string"; }) };
      } catch (e) { return mem; }
    })();
    function save() {
      if (!store) return;
      try { store.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 存储满：静默 */ }
    }
    function uid() {
      return "td" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }
    return {
      MAX: 50,
      list: function () { return data.list; },
      count: function () { return data.list.length; },
      doneCount: function () {
        return data.list.filter(function (x) { return x.done; }).length;
      },
      add: function (text) {
        text = String(text || "").trim().slice(0, 80);
        if (!text || data.list.length >= 50) return false;
        data.list.push({ id: uid(), text: text, done: false, ts: Date.now() });
        save();
        return true;
      },
      toggle: function (id) {
        data.list.forEach(function (x) { if (x.id === id) x.done = !x.done; });
        save();
      },
      del: function (id) {
        data.list = data.list.filter(function (x) { return x.id !== id; });
        save();
      },
      clearDone: function () {
        data.list = data.list.filter(function (x) { return !x.done; });
        save();
      },
      export_: function () { return JSON.parse(JSON.stringify(data)); }
    };
  })();

  /* ---------------- 搜索 ---------------- */

  function score(t, q) {
    var nq = norm(q);
    if (!nq) return -1;
    var name = norm(t.term);
    var py = norm(t.pinyin);
    var ini = norm(t.initials);
    var aliases = (t.alias || []).map(norm);
    var s = -1;

    if (name === nq || py === nq || ini === nq) s = 100;
    else if (name.indexOf(nq) === 0) s = 80;
    else if (ini === nq || py.indexOf(nq) === 0) s = 70;
    else if (name.indexOf(nq) > -1) s = 55;
    else if (py.indexOf(nq) > -1) s = 45;
    else if (aliases.some(function (a) { return a.indexOf(nq) > -1; })) s = 40;
    else if ((t.tags || []).some(function (g) { return norm(g).indexOf(nq) > -1; })) s = 25;
    else if (norm(t.oneline).indexOf(nq) > -1) s = 15;

    return s;
  }

  function search(q, limit) {
    var out = [];
    TERMS.forEach(function (t) {
      var s = score(t, q);
      if (s > 0) out.push({ t: t, s: s });
    });
    out.sort(function (a, b) {
      if (b.s !== a.s) return b.s - a.s;
      return a.t.pinyin.localeCompare(b.t.pinyin);
    });
    return out.slice(0, limit || 12).map(function (x) { return x.t; });
  }

  function attachSearch(input, box) {
    if (!input || !box) return;
    var active = -1;

    /* v51：候选框的定位与自适应高度。
       问题的根因链（真机量出来的，见 tmp/diag-res*.mjs）：
         #heroR(.results, absolute) → .hero-search → .hero(overflow:hidden)
         → .hp-in → .hp-page(overflow:clip) → .hp-track → .hp(overflow:clip)
         → #view(overflow:clip) → body.iv-lock(overflow:hidden)
       开屏态下这四层裁切把溢出到 .hero 之外的候选行全部切掉：实测 12 条候选有
       283px 落在 .hero 底边之外，页面上只看得到两条，而框内的 max-height:22rem
       滚动条因为内容已被裁而形同虚设。
       这四层 overflow 各自都有用途（开屏分屏动画、hero 金线内框与红星徽章），
       动它们会波及开屏，所以改为**让候选框自己脱离这条裁切链**：
         · 定位用 position:fixed（fixed 元素的包含块是视口，不受任何祖先 overflow 影响）；
         · 每画一次，按「输入框下方剩余空间」与「上方空间」决定向下还是向上展开；
         · max-height 取两侧可用空间的较大者再夹在 [8rem, 22rem] 之间 ——
           放得下多少显示多少，剩下的由框内滚动承担。
       box 的 left/width 直接从输入框的视口坐标算，与原来的 left:0;right:0 等价。 */
    function place() {
      /* v51 修法第二处：把候选框挪到 body 下。
         坑在 #view 上那个 `transform: matrix(1,0,0,1,0,0)` —— 换页动画 `.page-in`
         结束后浏览器**没有**把它清回 none（`animation:…both` 把终态
         `transform:none` 算成了 `matrix(1,0,0,1,0,0)`），于是 #view 成了 fixed 元素的
         包含块，候选框就相对 #view 定位而不是视口。实测手机端框跑到 y=2116，
         而输入框在 y=606 —— 差了一屏半。
         挪到 body 下就脱离了 #view 这层包含块；position:fixed 不受影响（body 无 transform）。
         只在第一次需要时挪，之后原地更新，避免每次输入都动 DOM 造成重排抖动。 */
      if (box.parentNode !== document.body) document.body.appendChild(box);
      var r = input.getBoundingClientRect();
      var below = window.innerHeight - r.bottom - 8;   /* 8px 视口下沿留白 */
      var above = r.top - 8;
      var M = 22 * 16;                                  /* 沿用原来的 22rem 上限 */
      var max = Math.max(below, above);
      if (max > M) max = M;
      if (max < 128) max = 128;                         /* 再窄也留 8rem，别塌成一条缝 */
      var down = below >= above;
      box.style.maxHeight = max + "px";
      box.style.left = Math.round(r.left) + "px";
      box.style.width = Math.round(r.width) + "px";
      /* 向上展开时用 bottom 定位，top 留空；反之亦然 —— 两套都写全，免得
         样式表里那条 top:calc(100% + .35rem) 在其中一侧残留下来。 */
      if (down) {
        box.style.top = Math.round(r.bottom + 5) + "px";
        box.style.bottom = "auto";
        box.classList.remove("up");
      } else {
        box.style.bottom = Math.round(window.innerHeight - r.top + 5) + "px";
        box.style.top = "auto";
        box.classList.add("up");
      }
    }

    function close() {
      box.innerHTML = ""; box.hidden = true; active = -1; box.classList.remove("up");
      /* v51：box 已被 place() 挪到 body 下，所以换页时它**不会**随首页的
         innerHTML 一起被销毁 —— 每离开再回一次首页就多留一个孤儿候选框
         （实测两次往返后 body 下有 3 个 .results，其中两个空且永远不消失）。
         这里把「页面里已无此 id 引用」的旧框清掉。
         ⚠ 判据不能用「不是当前这个 box」—— 顶栏搜索框 #topR 是常驻元素、
         同样在 body 下，会被一并删掉（那样顶栏搜索就废了）。 */
      var olds = document.querySelectorAll("body > .results");
      for (var i = 0; i < olds.length; i++) {
        if (olds[i] === box) continue;
        if (document.getElementById(olds[i].id)) continue;   /* 仍被页面引用 ⇒ 保留 */
        olds[i].innerHTML = ""; olds[i].hidden = true; olds[i].remove();
      }
    }

    /* 结果分四组：词条（名字/拼音/别名）｜原典引文｜学界争鸣｜我的笔记。
       后三组走全文匹配——站内最厚的语料是 273 条原典引文与 578 条争鸣立场，
       只按词条名搜，等于把它们锁在抽屉里。键盘上下键跨组连续走，
       所以每一项仍带 data-i，与原来的单组实现共用一套导航代码。 */
    function paint(q) {
      var terms = search(q);
      var deep = deepSearch(q);
      var html = "", idx = 0;
      var P = function (t, p) { return '<span class="r-term">' + esc(t.term) + "</span>" +
        '<span class="r-py">' + esc(p) + "</span>"; };

      if (terms.length) {
        html += '<div class="r-group">词条<span>' + terms.length + " 条</span></div>";
        html += terms.map(function (t) {
          return '<a class="r-item" data-i="' + idx++ + '" href="#/t/' + esc(t.id) + '">' +
            P(t, t.pinyin) + '<span class="r-cat">' + esc(catShort(t.domain)) + "</span></a>";
        }).join("");
      }
      if (deep.quotes.length) {
        html += '<div class="r-group">原典引文<span>' + deep.quoteTotal + " 处</span></div>";
        html += deep.quotes.map(function (x) {
          return '<a class="r-item r-hit r-deep" data-i="' + idx++ + '" data-deep="' + esc(x.t.id) +
            '" href="#/t/' + esc(x.t.id) + '">' + P(x.t, x.chapter || "原典") +
            '<span class="r-snip">' + hlSnippet(x.text, q) + "</span>" +
            '<span class="r-cite">' + esc(x.cite || "") +
            (x.verify ? "" : "（页码待核）") + "</span></a>";
        }).join("");
      }
      if (deep.stances.length) {
        html += '<div class="r-group">学界争鸣<span>' + deep.stanceTotal + " 方</span></div>";
        html += deep.stances.map(function (x) {
          return '<a class="r-item r-hit r-deep" data-i="' + idx++ + '" data-deep="' + esc(x.t.id) +
            '" href="#/t/' + esc(x.t.id) + '">' + P(x.t, x.side || "争鸣") +
            '<span class="r-snip">' + hlSnippet(x.text, q) + "</span>" +
            '<span class="r-cite">' + esc(x.cite || "") +
            (x.verified ? "" : "（文献待核）") + "</span></a>";
        }).join("");
      }
      if (deep.notes.length) {
        html += '<div class="r-group">我的笔记<span>' + deep.noteTotal + " 条</span></div>";
        html += deep.notes.map(function (x) {
          return '<a class="r-item r-hit r-deep" data-i="' + idx++ + '" data-deep="' + esc(x.t.id) +
            '" href="#/t/' + esc(x.t.id) + '">' + P(x.t, "笔记") +
            '<span class="r-snip">' + hlSnippet(x.text, q) + "</span></a>";
        }).join("");
      }
      if (!html) {
        box.innerHTML = '<div class="r-empty">没有找到。词条名、拼音首字母（如 <code>syjz</code>）、' +
          "原典引文正文、争鸣观点、自己的笔记都在检索范围内；两个汉字以上才做全文匹配。</div>";
        box.hidden = false;
        place();                 /* v51：空提示框同样要跟着输入框定位 */
        active = -1;
        return;
      }
      box.innerHTML = html;
      box.hidden = false;
      place();                   /* v51：每次重画都重新定位（候选条数变了高度也会变） */
      active = -1;
    }

    input.addEventListener("input", function () {
      var q = input.value.trim();
      if (!q) { close(); return; }
      curQ = q;
      paint(q);
    });

    /* 回车/点进去之后要能在词条页里把命中的那一段挑出来，
       所以把「搜的是什么词」记在模块级，等词条页渲染完再用。 */
    box.addEventListener("mousedown", function (e) {
      var it = e.target && e.target.closest ? e.target.closest(".r-deep") : null;
      if (it) DEEP = { q: curQ, id: it.getAttribute("data-deep") || "" };
    });
    input.addEventListener("keydown", function (e) {
      var items = box.querySelectorAll(".r-item");
      if (e.key === "Escape") { close(); input.blur(); return; }
      if (!items.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        active += (e.key === "ArrowDown" ? 1 : -1);
        if (active < 0) active = items.length - 1;
        if (active >= items.length) active = 0;
        items.forEach(function (el) { el.classList.remove("active"); });
        items[active].classList.add("active");
        items[active].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") {
        e.preventDefault();
        var pick = active >= 0 ? items[active] : items[0];
        if (pick) {
          if (pick.classList.contains("r-deep")) {
            DEEP = { q: curQ, id: pick.getAttribute("data-deep") || "" };
          }
          input.value = "";
          close();
          location.hash = pick.getAttribute("href").slice(1);
        }
      }
    });

    input.addEventListener("blur", function () { setTimeout(close, 160); });

    /* v51：滚动、改变窗口大小、改变视口高度（如手机上收起地址栏）时，
       输入框的视口坐标都变了，候选框必须跟着重算，否则会停在原地。 */
    addEventListener("scroll", function () { if (!box.hidden) place(); }, { passive: true });
    addEventListener("resize", function () { if (!box.hidden) place(); });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", function () { if (!box.hidden) place(); });
    }
  }

  /* ---------------- 全文检索 ----------------
     只在词条名/拼音/别名上匹配太薄了：站内的原典引文与争鸣观点才是真正厚的部分。
     语料总量不大（引文 ≈ 4 万字、争鸣 ≈ 4 万字），直接 indexOf 扫一遍足够快，
     不必另建倒排索引——少一份会失效的副本，也多一分诚实：
     检索结果永远等于数据本身。 */
  var curQ = "";                    // 当前搜索词，供「跳到词条页后高亮命中段」用
  var DEEP = { q: "", id: "" };     // 待高亮的词条与词
  var DEEP_CAP = 5;                 // 每组最多列几条（再多也没人看）

  function hlSnippet(text, q, pad) {
    var i = text.indexOf(q);
    if (i < 0) return esc(text.slice(0, 64)) + (text.length > 64 ? "…" : "");
    var p = pad || 22;
    var s = Math.max(0, i - p), e = Math.min(text.length, i + q.length + p);
    return (s ? "…" : "") + esc(text.slice(s, i)) +
      "<mark>" + esc(text.slice(i, i + q.length)) + "</mark>" +
      esc(text.slice(i + q.length, e)) + (e < text.length ? "…" : "");
  }

  /* 全文检索：原典引文、争鸣观点、自己的笔记。单字不做全文匹配——
     一个「的」能命中几百处，那不是检索，是噪音。 */
  function deepSearch(q) {
    var out = { quotes: [], stances: [], notes: [],
                quoteTotal: 0, stanceTotal: 0, noteTotal: 0 };
    var nq = (q || "").trim();
    if (nq.length < 2) return out;

    TERMS.forEach(function (t) {
      (t.original || []).forEach(function (o) {
        /* 只索引页面上真看得到的引文：待补录的条目没有 text，
           搜到了点进去也看不见那句，那种「搜得到看不见」比搜不到更让人犯疑。 */
        if (!o.text || o.pending || o.text.indexOf(nq) < 0) return;
        out.quoteTotal++;
        if (out.quotes.length < DEEP_CAP) {
          out.quotes.push({ t: t, text: o.text, cite: o.cite, chapter: o.chapter, verify: o.verify });
        }
      });
      (t.scholars || []).forEach(function (g) {
        (g.stances || []).forEach(function (s) {
          if (!s.view || s.view.indexOf(nq) < 0) return;
          out.stanceTotal++;
          if (out.stances.length < DEEP_CAP) {
            out.stances.push({ t: t, text: s.view, cite: s.cite, side: s.side,
                               focus: g.focus, verified: s.verified });
          }
        });
      });
      var note = LR.getNote(t.id);
      if (note && note.indexOf(nq) > -1) {
        out.noteTotal++;
        if (out.notes.length < DEEP_CAP) out.notes.push({ t: t, text: note });
      }
    });
    return out;
  }

  /* 落在词条页之后：把命中的那一段挑出来闪一下并滚过去。
     不闪就等于「跳过来了但你还得自己找」，那一步最容易放弃。 */
  function deepFlash() {
    if (!DEEP.q || !DEEP.id) return;
    var q = DEEP.q, id = DEEP.id;
    DEEP = { q: "", id: "" };
    var art = document.querySelector('[data-term="' + id + '"]');
    if (!art) return;
    var hit = null;
    art.querySelectorAll("blockquote, .s-view, .lr-note textarea").forEach(function (el) {
      if (el.textContent.indexOf(q) < 0) return;
      el.classList.add("deep-hit");
      if (!hit) hit = el;
    });
    if (hit && hit.scrollIntoView) {
      setTimeout(function () {
        try { hit.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) { /* 老浏览器不支持参数对象 */ }
      }, 60);
    }
  }

  /* ---------------- 片段 ---------------- */

  // 词条头上的分类标签：一枚「板块·方向」合并标注（如「哲学·基本原理」），可点击跳到组合筛选
  function catChips(t) {
    var tx = TAXES[0];
    if (!tx) return "";
    var cid = t[tx.field];
    if (!cid) return "";
    var hasSub = !!(t.category && SUBS[t.category]);
    var href = "#/c/" + esc(cid) + (hasSub ? "?sub=" + esc(t.category) : "");
    var title = catName(cid) + (hasSub ? " · " + subName(t.category) : "");
    return '<a class="chip cat" href="' + href + '" title="' + esc(title) + '">' +
      esc(domSubLabel(t)) + "</a>";
  }

  function chips(t) {
    var out = [catChips(t)];
    (t.tags || []).forEach(function (g) { out.push('<span class="chip">' + esc(g) + "</span>"); });
    var pend = (t.original || []).filter(function (o) { return o.pending; }).length;
    if (isVerified(t)) out.push('<span class="chip ok">原典已核</span>');
    else if (pend) out.push('<span class="chip warn">原典引文待补</span>');
    else out.push('<span class="chip warn">页码待核</span>');
    return out.join("");
  }

  function termListItem(t) {
    /* 学习状态小标记：已读打点、生词本加星（列表页一眼能看出读过哪些） */
    var mark = "";
    if (LR.isRead(t.id)) mark += '<i class="lr-dot" title="已读"></i>';
    if (LR.isStar(t.id)) mark += '<i class="lr-star" title="在生词本">★</i>';
    return '<li' + (LR.isRead(t.id) ? ' class="read"' : "") + '><a href="#/t/' + esc(t.id) + '">' +
      '<span class="tl-term">' + mark + esc(t.term) + "</span>" +
      (t.en ? '<span class="tl-en" title="官方英文译名">' + esc(t.en) + "</span>" : "") +
      (t.de ? '<span class="tl-de" title="德文原词（MEW）">' + esc(t.de) + "</span>" : "") +
      '<span class="tl-py">' + esc(t.pinyin) + "</span>" +
      '<span class="tl-badge" title="' +
        esc(catName(t.domain) + ((t.category && SUBS[t.category]) ? " · " + subName(t.category) : "")) + '">' +
        esc(domSubLabel(t)) + "</span>" +
      '<span class="tl-one">' + esc(t.oneline) + "</span></a></li>";
  }

  function termList(list) {
    if (!list.length) return '<p class="empty">此处暂无词条。</p>';
    return '<ul class="term-list">' + list.map(termListItem).join("") + "</ul>";
  }

  /* ---------------- 页面 ---------------- */

  /* 门类配图（v30）：三大知识板块各配一张代表著作的书封。
     只给首页第 2 屏「按门类浏览」用——门类总览页是索引视图，保持纯文字。
     图由 tools/covers/make-cat-covers.py 统一修过（透视校正 / 清背景 / 压平纸底 /
     三张同尺寸 342×520），不是随手裁的原图。 */
  var CAT_COVER = {
    "dom-zx": ["assets/cat-phil.jpg", "《德意志意识形态》封面"],
    "dom-zzjj": ["assets/cat-econ.jpg", "《资本论》封面"],
    "dom-kxsh": ["assets/cat-soc.jpg", "《共产党宣言》封面"]
  };

  /* 门类卡片：名称 + 收录说明 + 进度（首页第 2 屏另加一张书封配图） */
  function catCard(c, cover) {
    var have = termsIn(c.id).length;
    var planned = c.planned || 0;
    var cv = cover ? CAT_COVER[c.id] : null;
    return '<a class="card' + (cv ? " card-cv" : "") + '" href="#/c/' + esc(c.id) + '">' +
      '<span class="c-name">' + esc(c.name) + "</span>" +
      (cv ? '<span class="c-fig"><img class="c-cover" src="' + cv[0] + '" alt="' + esc(cv[1]) +
        '" width="342" height="520" decoding="async"></span>' : "") +
      '<span class="c-note">' + esc(c.note || "") + "</span>" +
      '<span class="c-meta">已有 ' + have + " / 计划 " + planned + " 条" +
        (have === 0 ? ' · <b class="pend">待补</b>' : "") + "</span></a>";
  }

  /* 门类导航：把知识板块的门类卡片直接铺开——站点只有这一个分类维度，不需要页签切换 */
  function taxBlock() {
    var tx = TAXES[0] || { id: "domain", name: "知识板块", cats: [] };
    return '<div class="tax"><div class="card-grid" data-cat-cards data-tax-panel="' + esc(tx.id) + '">' +
        (tx.cats || []).map(function (c) { return catCard(c, true); }).join("") +
      "</div></div>";
  }

  /* 门类总览页：知识板块的全部门类一次列出 */
  /* 门类视图的正文（v43 起是「总览」页的第一种视图，页头由总览页统一给）
     v60：板块卡之下补第二轮筛选项——学科方向细分（0305 二级学科），
     每个筛选项按「知识板块·学科方向」合并标注（如「哲学·基本原理」），
     点开即进入该组合的词条清单（#/c/<板块>?sub=<方向>）。 */
  function viewTaxes() {
    /* v67：三段导语黄框（「全站词条按知识板块归类…」「按马克思主义的三大组成部分归类…」
       「同一批词条的第二轮筛选项…」）已按需求撤除——页面直接从板块卡开始，
       taxonomy_basis 与 taxonomies[].desc 两个数据字段随之失去唯一消费点，一并删除。 */
    return TAXES.map(function (tx) {
        var n = (tx.cats || []).reduce(function (a, c) { return a + termsIn(c.id).length; }, 0);
        return '<h2 class="sec-title">' + esc(tx.name) +
            (tx.basis ? "（" + esc(tx.basis) + "）" : "") +
            '<span class="more">' + n + " / " +
            (tx.cats || []).reduce(function (a, c) { return a + (c.planned || 0); }, 0) + " 条</span></h2>" +
          '<div class="card-grid">' + (tx.cats || []).map(function (c) { return catCard(c); }).join("") + "</div>";
      }).join("") +
      '<h2 class="sec-title">按学科方向细分</h2>' +
      '<div class="sibs ov-subs">' +
        ((TAXES[0] && TAXES[0].cats) || []).reduce(function (acc, d) {
          return acc + ((SUB_TX && SUB_TX.cats) || []).map(function (s) {
            var n = termsInSub(d.id, s.id).length;
            return '<a class="sib" href="#/c/' + esc(d.id) + "?sub=" + esc(s.id) + '">' +
              esc(catShort(d.id)) + "·" + esc(subShort(s.id)) + "<em>" + n + "</em></a>";
          }).join("");
        }, "") +
      "</div>";
  }

  /* ---------------- 悬浮学习台（dock）：时钟 + 学习进度 + 待办 ----------------
     首页原来平铺的「今日」两卡与学习台整合成一个悬浮窗：常驻右下角、
     全站可用（它挂在 #view 之外，换页不重建），收起时只是一枚显示时间的小圆标。
     时间与日期直接读系统时间（每秒重算）；待办存本机 localStorage。
     更新都是局部改文字/列表，绝不走 route() 整页重绘——否则输入框每敲一下就失焦。 */

  function todoListHTML() {
    var items = TODO.list();
    if (!items.length) {
      return '<li class="todo-none">还没有待办。写一条今天要读的章节，或者要核对的引文。</li>';
    }
    return items.map(function (x) {
      return '<li data-tid="' + esc(x.id) + '"' + (x.done ? ' class="done"' : "") + ">" +
        '<button class="tk-ck" type="button" data-todo="toggle" aria-label="' +
          (x.done ? "标记为未完成" : "标记为已完成") + '"></button>' +
        '<span class="tk-tx" data-todo="toggle">' + esc(x.text) + "</span>" +
        '<button class="tk-del" type="button" data-todo="del" aria-label="删除这条待办">✕</button>' +
        "</li>";
    }).join("");
  }

  function todoCountHTML() {
    var n = TODO.count(), done = TODO.doneCount();
    if (!n) return "空";
    return "已完成 " + done + " / " + n +
      (done ? ' · <button class="tk-clr" type="button" data-todo="clear">清除已完成</button>' : "");
  }

  function renderTodo() {
    var list = document.getElementById("dk-list");
    if (list) list.innerHTML = todoListHTML();
    var cnt = document.getElementById("dk-cnt");
    if (cnt) cnt.innerHTML = todoCountHTML();
    var badge = document.getElementById("dk-badge");   // 收起时的小圆标：未完成数
    if (badge) {
      var left = TODO.count() - TODO.doneCount();
      badge.textContent = left > 9 ? "9+" : (left > 0 ? left : "");
      badge.hidden = left <= 0;
    }
  }

  /* 学习进度：每次打开面板、每次路由都重算（词条页标已读后要跟上）。
     v55：删掉「生词本」栏目 —— 复习队列另有专门的「间隔重复卡」工具（#/tools/srs，
     队列 = 生词本 ∪ 错题本），在悬浮窗里再挂一份只是重复入口，还让人以为
     数据不一致（截图里"0 条生词本"与工具页的复习队列并存看着割裂）。
     ★ 生词**数据本身没动**（LR.star / LR.starTerms 全部保留）——
       词条页的「＋ 生词本」按钮、列表页的 ★ 标记、间隔重复卡的队列源都还在用；
       这里只去掉悬浮窗里的**展示**。 */
  function renderDockStats() {
    var box = document.getElementById("dk-stats");
    if (!box) return;
    var lastId = LR.getLast();
    box.innerHTML =
      '<div class="dash-stats">' +
        '<span><b>' + LR.readCount() + "</b> / " + TERMS.length + " 已读</span>" +
        '<span><b>' + LR.noteCount() + "</b> 条笔记</span>" +
        (lastId ? '<a class="dash-continue" href="#/t/' + esc(lastId) + '">继续读「' +
          esc(BY_ID[lastId].term) + "」→</a>" : "") +
      "</div>";
  }

  /* 日期行的第二段：年内第几天 + 打卡连续天数。
     今天既不是假期也不是调休日时，再补一句「距下一个假期还有几天」。 */
  function metaText(d) {
    var s = LR.streak();
    var t = d.getFullYear() + " 年第 " + dayOfYear(d) + " 天 · " +
      (s > 1 ? "连续打开 " + s + " 天" : "今日开始记录");
    var h = HOL.of(d);
    if (!h || h.kind === "work") {
      var n = HOL.next(d);
      if (n) t += " · 距" + n.name + "还有 " + n.days + " 天";
    }
    return t;
  }

  /* 节假日徽标。放假 → 红底「国庆节 · 假期第 1 天 / 共 7 天」，
     调休补班 → 灰底「调休上班 · 国庆节」，平常日子整块隐藏。
     日期本身仍是「2026年10月1日 星期四」的原格式，徽标只是旁边另起一枚小签。 */
  function paintHoliday(d) {
    var el = document.getElementById("dk-hol");
    if (!el) return;
    var h = HOL.of(d);
    if (!h) {
      el.hidden = true; el.textContent = ""; el.removeAttribute("title");
      return;
    }
    if (h.kind === "work") {
      el.className = "dk-hol work";
      el.textContent = "调休上班 · " + h.name;
    } else {
      el.className = "dk-hol off";
      el.textContent = h.name + " · 假期第 " + h.day + " 天 / 共 " + h.total + " 天";
    }
    el.title = HOL.detail(h.name);
    el.hidden = false;
  }

  /* 全年假期安排：一行一个节日，写清起止、天数与调休补班。
     正处在的那个节日加 .on，过去的整行淡化，剩下的就是「还有哪些假」。 */
  function renderHolidayList() {
    var ul = document.getElementById("dk-hollist");
    if (!ul) return;
    var list = HOL.all();
    if (!list.length) {
      ul.innerHTML = '<li class="hol-none">这一年还没有收录假期安排——' +
        "国务院办公厅的通知一般在上一年 11 月发布。</li>";
      return;
    }
    var today = dayKey(new Date());
    ul.innerHTML = list.map(function (sp) {
      var cls = "hol-row" +
        (today >= sp.from && today <= sp.to ? " on" : (today > sp.to ? " past" : ""));
      var work = sp.work.length
        ? "调休：" + sp.work.map(function (w) {
            var p = w.split("-");
            return (+p[1]) + "月" + (+p[2]) + "日";
          }).join("、") + " 上班"
        : "不调休";
      return '<li class="' + cls + '"><b>' + esc(sp.name) + "</b>" +
        '<span class="hol-d">' + esc(sp.range) + "</span>" +
        '<span class="hol-t">共 ' + sp.total + " 天</span>" +
        '<span class="hol-w">' + esc(work) + "</span></li>";
    }).join("");
  }

  /* 时钟初值：面板里的三行 + 收起态小圆标上的时分 */
  function paintClock() {
    var d = new Date();
    var t = document.getElementById("dk-time");
    if (t) t.textContent = fmtClock(d);
    var mini = document.getElementById("dk-mini");
    if (mini) mini.textContent = pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    paintHoliday(d);                       // 徽标与秒针无关，但跨天要跟着换
    var k = dayKey(d);
    if (k !== clockDay) {
      clockDay = k;
      LR.touchDay();
      var dd = document.getElementById("dk-date");
      if (dd) dd.textContent = fmtDate(d);
      var mk = document.getElementById("dk-meta");
      if (mk) mk.textContent = metaText(d);
      renderHolidayList();                 // 跨天后「正处在哪个假期」要跟着变
    }
  }

  /* 部分洗牌：从数组里等概率抽 n 条（不重不漏），不改原数组 */
  function randSample(arr, n) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a.slice(0, Math.max(0, Math.min(n, a.length)));
  }

  /* 首页（v23）：三屏整屏分页
     屏 1 门户（hero ＋ 站点数据带）｜屏 2 按门类浏览｜屏 3 拼音索引 ＋ 词条漫游。
     取消纵向连续滚动：三屏在同一个 .hp-track 里纵向排列，靠 transform 平移切换，
     每屏高度 = 视口可用高（JS 写 --hp-h），详见 homePager()。
     「概念关系 / 关于这份数据」两段长文不再铺在首页——它们是数据说明，
     已在 #/graph 里有一份，首页只留一行入口，免得第三屏撑破。 */
  function viewHome() {
    var letters = allLetters();
    var idx = Object.keys(letters).sort();
    var total = TERMS.length;
    /* 词条漫游：每次渲染从全库随机抽 12 条（Fisher–Yates 部分洗牌），
       进首页像开盲盒——两条旧专栏（入门＋当代）合并成一栏。 */
    var pick = randSample(TERMS, 12);

    var hero =
      '<section class="hero">' +
        '<h1>' + hlTitle(esc(META.title || "")) + '</h1>' +
        '<p class="hero-quote">「在科学上没有平坦的大道，只有不畏劳苦沿着陡峭山路攀登的人，才有希望达到光辉的顶点。」</p>' +
        '<p class="hero-src">——马克思：《资本论》第一卷法文版序言（1872 年），人民出版社 2004 年版，第 24 页</p>' +
        '<div class="hero-search">' +
          '<input id="heroQ" type="search" autocomplete="off" placeholder="搜词条、原典引文、争鸣观点：剩余价值 / syjz">' +
          '<div class="results" id="heroR" hidden></div>' +
          '<p class="hint">支持三种输入：汉字、全拼、拼音首字母缩写。</p>' +
        '</div>' +
        /* v52：首页 hero 快捷入口从 6 个精简为 3 个；v66 撤除「关于」页后再减为 2 个；
           v68 按需求补回第三枚「文本分析」（深链 #/tools/tt，直达工具面板）。
           前两枚是「独立交付件」级入口：
             · 马克思画传 → #/pictorial（画册子站）
             · 概念关系图 → #/graph（关系图编辑器子站）
           其余「门类总览 / 三卷目录树 / 词条自测 / 概念计算器」都是**站内功能**，
           顶栏导航与工具台里都有入口（# 是首页，顶栏常驻），首页不必再重复一遍。 */
        '<div class="hero-entries">' +
          '<a href="#/pictorial">马克思画传</a>' +
          '<a href="#/graph">概念关系图</a>' +
          '<a href="#/tools/tt">文本分析</a>' +
        '</div>' +
      '</section>';

    /* 站点数据带：参照思政平台的「网站统计数据」模块，
       数字全部由词条库现算（stats()），不手写。 */
    var band =
      '<div class="stat-band">' +
        '<a class="sb" href="#/idx"><b>' + total + '</b><span>收录词条</span></a>' +
        /* 这两项是数据状态，不再有「关于」页可跳，只作静态读数 */
        '<span class="sb"><b>' + stats().quoted + '</b><span>原典引文已补录</span></span>' +
        '<span class="sb"><b>' + stats().scholarStance + '</b><span>争鸣立场（方）</span></span>' +
        '<a class="sb" href="#/tools"><b>' + TOOL_ON + '</b><span>已上线工具</span></a>' +
      '</div>';

    /* 窄屏把拼音索引抽屉默认收起：26 个字母在窄屏要排成三四行，展开着会把第三屏顶破 */
    var narrow = !!(window.innerWidth && window.innerWidth < 760);
    var idxBlock =
      '<h2 class="sec-title idx-toggle' + (narrow ? " closed" : "") + '" role="button" tabindex="0" ' +
        'aria-expanded="' + (narrow ? "false" : "true") + '" aria-controls="idxDrawer">' +
        '<a href="#/idx">拼音索引 A–Z</a><span class="more">' + idx.length + ' 个首字母</span>' +
        '<span class="idx-chev" aria-hidden="true">▼</span></h2>' +
      '<div class="idx-drawer' + (narrow ? " closed" : "") + '" id="idxDrawer"><div class="idx-drawer-in">' +
      '<div class="alpha">' +
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(function (L) {
          return letters[L] ? '<a href="#/i/' + L + '">' + L + "</a>" : '<span class="dis">' + L + "</span>";
        }).join("") +
      '</div></div></div>';

    /* 词条漫游（单栏）：词条随机抽自全库，翻页器照旧；
       「换一批」就地重抽，不整页刷新。 */
    var roam =
      '<div class="home-duo home-duo-one">' +
        '<section class="duo-col">' +
          '<h2 class="sec-title">词条漫游<span class="more">' +
            '<button type="button" class="duo-shuffle" data-duo-shuffle>换一批 ↻</button>' +
            '<a href="#/idx">查看更多 →</a></span></h2>' +
          '<div id="duoRand">' + duoPager(pick) + "</div>" +
        "</section>" +
      "</div>";

    var rail = ["门户", "按门类浏览", "拼音索引与词条漫游"].map(function (nm, k) {
      return '<button type="button" class="hp-dot' + (k ? "" : " on") + '" data-hp-go="' + k +
        '" aria-label="第 ' + (k + 1) + " 屏：" + nm + '"' +
        (k ? "" : ' aria-current="true"') + "><i aria-hidden=\"true\"></i></button>";
    }).join("");

    return '<div class="hp" data-hp>' +
      '<div class="hp-track">' +

        '<section class="hp-page" data-hp-i="0" aria-label="第 1 屏：平台门户">' +
          '<div class="hp-in hp-in-hero">' + hero + band + "</div>" +
        "</section>" +

        '<section class="hp-page" data-hp-i="1" aria-label="第 2 屏：按门类浏览">' +
          '<div class="hp-in">' +
            '<h2 class="sec-title">按门类浏览<span class="more">共 ' + total + ' 条词条 · 三大知识板块</span></h2>' +
            taxBlock() +
          "</div>" +
        "</section>" +

        '<section class="hp-page" data-hp-i="2" aria-label="第 3 屏：拼音索引与词条漫游">' +
          '<div class="hp-in">' + idxBlock + roam +
            '<p class="hp-nav">' +
              '<a href="#/graph">概念关系图 →</a>' +
            "</p>" +
          "</div>" +
        "</section>" +

      "</div>" +
      '<nav class="hp-rail" aria-label="首页分屏导航">' + rail + "</nav>" +
      '<p class="hp-tip" role="status" aria-live="polite"></p>' +
    "</div>";
  }

  /* 首页分屏驱动：整屏翻页
     —— 滚轮/键盘/触摸 一次手势翻一屏；动画期 busy 锁 + 滚轮静默间隔双重节流；
     首屏向上、末屏向下都不切换（只给一句边界提示）。视觉全交 CSS transform。 */
  var hpCleanup = null;

  function homePager() {
    if (hpCleanup) { hpCleanup(); hpCleanup = null; }
    if (!app) return;
    var host = app.querySelector("[data-hp]");
    if (!host) { document.body.classList.remove("hp-on"); return; }

    var track = host.querySelector(".hp-track");
    var pages = host.querySelectorAll(".hp-page");
    var dots = host.querySelectorAll(".hp-dot");
    var tip = host.querySelector(".hp-tip");
    var LAST = pages.length - 1;
    if (LAST < 1 || !track) return;
    /* 窄屏不接管：一屏装不下三张堆叠门类卡，硬撑只会裁掉内容。
       此时 .hp 退回普通文档流，首页表现为连续滚动（CSS 侧同判）。 */
    if (window.innerWidth <= 700) return;

    var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    var DUR = reduced ? 0 : 720;        /* 与 CSS .hp-track 的过渡时长保持一致 */
    var GAP_WHEEL = 260, DY_MIN = 8, SWIPE_MIN = 56;
    var cur = 0, busy = false, lockT = 0, tipT = 0, resizeT = 0;
    var lastWheel = 0;

    document.body.classList.add("hp-on");
    app.classList.add("hp");   /* 满宽 + 正好一屏由 .main.hp 接管 */

    /* 每屏高度 = 视口高 − 顶线 − 吸顶栏；这样整页永远正好一屏，不出原生滚动条 */
    function fit() {
      var tl = document.querySelector(".topline");
      var tb = document.querySelector(".topbar");
      var top = (tl ? tl.offsetHeight : 0) + (tb ? tb.offsetHeight : 0);
      var h = Math.round(window.innerHeight - top);
      if (!(h > 200)) h = Math.round(window.innerHeight * 0.8);
      document.documentElement.style.setProperty("--hp-h", h + "px");
    }

    /* 切到哪屏就把那屏的入场元素直接放行：分屏模式下没有滚动事件，
       单靠 IntersectionObserver 有被裁掉不触发的风险（父级 overflow:hidden）。 */
    function reveal(pg) {
      if (!pg) return;
      var els = pg.querySelectorAll(".rv");
      for (var i = 0; i < els.length; i++) els[i].classList.add("rv-in");
      /* 门类卡配图的错峰入场也走这里：分屏下没有滚动，观察器不见得来得及 */
      cvKick(pg);
      /* 数据带的数字滚轮同理：切到第一屏的那一刻才开始滚（v35） */
      odKick(pg);
    }

    function paint() {
      track.style.transform = reduced ? "none" : "translate3d(0," + (-cur * 100) + "%,0)";
      for (var i = 0; i < dots.length; i++) {
        dots[i].classList.toggle("on", i === cur);
        if (i === cur) dots[i].setAttribute("aria-current", "true");
        else dots[i].removeAttribute("aria-current");
      }
      reveal(pages[cur]);
    }

    function unlock() { busy = false; }

    function go(n) {
      n = Math.max(0, Math.min(LAST, n | 0));
      if (n === cur) return false;
      busy = true;
      cur = n;
      paint();
      window.clearTimeout(lockT);
      if (DUR) lockT = window.setTimeout(unlock, DUR + 70);
      else unlock();
      return true;
    }

    function edgeHint(dir) {
      if (!tip) return;
      tip.textContent = dir < 0 ? "已在第一屏" : "已在最后一屏";
      tip.classList.add("hp-tip-on");
      window.clearTimeout(tipT);
      tipT = window.setTimeout(function () { tip.classList.remove("hp-tip-on"); }, 1300);
    }

    /* 一次手势 = 一屏；到边界不再切换，只提示 */
    function step(dir) {
      if (busy) return;
      var n = cur + dir;
      if (n < 0 || n > LAST) { edgeHint(dir); return; }
      go(n);
    }

    function onWheel(e) {
      /* 开屏动画还在：滚轮归它调度，这里一概不插手 */
      if (document.body.classList.contains("iv-lock")) return;
      if (e.ctrlKey || e.defaultPrevented) return;   /* 缩放手势 / 翻页器已自行处理 */
      e.preventDefault();
      var now = Date.now();
      var gap = now - lastWheel;
      lastWheel = now;
      if (busy || gap < GAP_WHEEL) return;           /* 动画中 or 同一手势的惯性连发：吞掉 */
      var dy = e.deltaY;
      if (dy > -DY_MIN && dy < DY_MIN) return;       /* 触控板抖动 */
      step(dy > 0 ? 1 : -1);
    }

    function onKey(e) {
      if (document.body.classList.contains("iv-lock")) return;
      var a = document.activeElement;
      var tag = a && a.tagName ? a.tagName : "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (a && a.isContentEditable)) return;
      var k = e.key;
      var hit = false;
      if (k === "ArrowDown" || k === "PageDown") { hit = step(1); }
      else if (k === "ArrowUp" || k === "PageUp") { hit = step(-1); }
      else if (k === "Home") { hit = go(0); }
      else if (k === "End") { hit = go(LAST); }
      else if (k === " " || k === "Spacebar" || k === "Enter") {
        /* 焦点落在按钮/链接上时，空格与回车是「按下它」，不能顺手再翻一屏 */
        if (a && a !== document.body && (tag === "BUTTON" || tag === "A" || a.getAttribute("role") === "button")) return;
        hit = step(k === "Enter" ? -1 : 1);
      } else return;
      if (hit || k === "ArrowDown" || k === "ArrowUp" || k === "PageDown" || k === "PageUp") e.preventDefault();
    }

    var touchY = -1;
    function onDown(e) {
      if (document.body.classList.contains("iv-lock")) { touchY = -1; return; }
      touchY = typeof e.clientY === "number" ? e.clientY : -1;
    }
    function onUp(e) {
      if (touchY < 0) return;
      var dy = touchY - e.clientY;
      touchY = -1;
      if (dy > SWIPE_MIN) step(1);
      else if (dy < -SWIPE_MIN) step(-1);
    }

    function onDot(e) {
      var b = e.target && e.target.closest ? e.target.closest("[data-hp-go]") : null;
      if (!b) return;
      go(+b.getAttribute("data-hp-go"));
    }

    function onResize() {
      window.clearTimeout(resizeT);
      resizeT = window.setTimeout(fit, 120);
    }

    fit();
    paint();
    host.addEventListener("click", onDot);
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("resize", onResize);
    /* 顶栏高度会随换行/字号变，量一次不够，观察它 */
    if (window.ResizeObserver) {
      var ro = new window.ResizeObserver(fit);
      var tl = document.querySelector(".topline"), tb = document.querySelector(".topbar");
      if (tl) ro.observe(tl);
      if (tb) ro.observe(tb);
      hpCleanup = function () {
        try { ro.disconnect(); } catch (e) {}
        detach();
      };
    } else {
      hpCleanup = detach;
    }

    function detach() {
      host.removeEventListener("click", onDot);
      window.removeEventListener("wheel", onWheel, { passive: false });
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, { passive: true });
      window.removeEventListener("pointerup", onUp, { passive: true });
      window.removeEventListener("resize", onResize);
      window.clearTimeout(lockT);
      window.clearTimeout(tipT);
      window.clearTimeout(resizeT);
      document.body.classList.remove("hp-on");
      if (app) app.classList.remove("hp");
    }
  }

  /* 首页双专栏翻页器：词条按 4 条一页切开，横向轨道平移翻页。
     翻页通道三条：两端箭头点击、滚轮（一滚一页）、按住拖拽。
     圆点指示当前页，两端到头时箭头禁用。 */
  function duoPager(list) {
    /* 窄屏 / 矮屏每页少一条：一屏要同时装下拼音索引与这个列表，
       四条会把第三屏顶破（900×600 实测超出 98px） */
    var PER = (window.innerWidth < 760 || window.innerHeight < 660) ? 3 : 4, pages = [];
    for (var i = 0; i < list.length; i += PER) pages.push(list.slice(i, i + PER));
    if (!pages.length) return "";
    return '<div class="duo-pager" data-duo>' +
      '<button type="button" class="duo-arrow duo-prev" data-duo-go="-1" aria-label="上一页">‹</button>' +
      '<div class="duo-win"><div class="duo-track">' +
        pages.map(function (pg) { return '<div class="duo-page">' + termList(pg) + "</div>"; }).join("") +
      "</div></div>" +
      '<button type="button" class="duo-arrow duo-next" data-duo-go="1" aria-label="下一页">›</button>' +
      '<div class="duo-dots">' +
        pages.map(function (_, k) { return "<i" + (k ? "" : ' class="on"') + "></i>"; }).join("") +
      "</div>" +
    "</div>";
  }

  function homeDuoInit() {
    if (!app) return;
    app.querySelectorAll("[data-duo]").forEach(function (pager) {
      var win = pager.querySelector(".duo-win");
      var track = pager.querySelector(".duo-track");
      var dots = pager.querySelectorAll(".duo-dots i");
      var n = track.children.length;
      if (!n) return;
      var i = 0, wheelLock = false;
      function paint() {
        track.style.transform = "translateX(" + (-i * 100) + "%)";
        dots.forEach(function (d, k) { d.classList.toggle("on", k === i); });
        pager.querySelector(".duo-prev").disabled = i === 0;
        pager.querySelector(".duo-next").disabled = i === n - 1;
      }
      function go(d) {
        var j = Math.max(0, Math.min(n - 1, i + d));
        if (j === i) return;
        i = j;
        paint();
      }
      pager.addEventListener("click", function (e) {
        var dot = e.target.closest ? e.target.closest(".duo-dots i") : null;
        if (dot) {
          var k = Array.prototype.indexOf.call(dots, dot);
          if (k > -1 && k !== i) go(k - i);
          return;
        }
        var b = e.target.closest ? e.target.closest("[data-duo-go]") : null;
        if (b) go(+b.getAttribute("data-duo-go"));
      });
      /* 滚轮自由翻页：一滚一页；触控板惯性会连发，340ms 节流 */
      win.addEventListener("wheel", function (e) {
        e.preventDefault();
        if (wheelLock) return;
        wheelLock = true;
        setTimeout(function () { wheelLock = false; }, 340);
        go((e.deltaY || e.deltaX) > 0 ? 1 : -1);
      }, { passive: false });
      /* 拖拽翻页：松手时按位移方向与幅度判定 */
      var sx = null;
      win.addEventListener("pointerdown", function (e) { sx = e.clientX; });
      win.addEventListener("pointerup", function (e) {
        if (sx === null) return;
        var dx = e.clientX - sx;
        sx = null;
        if (Math.abs(dx) > 36) go(dx < 0 ? 1 : -1);
      });
      paint();
    });

    /* 换一批：就地重抽 12 条，只重画翻页器，不整页刷新。
       按钮在 #duoRand 外、视图重建时才会重挂，用 _bound 防重复绑定。 */
    var sh = app.querySelector("[data-duo-shuffle]");
    if (sh && !sh._bound) {
      sh._bound = true;
      sh.addEventListener("click", function () {
        var host = document.getElementById("duoRand");
        if (!host) return;
        host.innerHTML = duoPager(randSample(TERMS, 12));
        homeDuoInit();
        if (window.CAPITAL_IO && window.CAPITAL_IO.rvScan) window.CAPITAL_IO.rvScan();
      });
    }
  }

  /* ================= URL 里的页内状态（v43） =================

     hash 路由把「哪一页」写在路径部分（#/idx），把「页内状态」写在查询部分
     （#/idx?m=alpha&l=J）。这样带状态的链接可以直接分享、刷新可复原，
     而每一页在导航栏里仍然只有一个入口。

     改状态时走 replaceState 而不是直接赋 location.hash：前者是同一文档内的
     地址改写，不触发 hashchange，于是整页路由不必重跑，可以只重画变的那一块
     （滚动位置、键盘焦点都保住）。万一某个环境不给改写历史（老浏览器、
     某些 file:// 策略），退回直接赋 hash —— 只多一次重绘，结果一致。 */

  function parseQuery(s) {
    var q = {};
    String(s || "").replace(/^\?/, "").split("&").forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf("="), k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? "" : kv.slice(i + 1);
      /* 参数里带坏转义（%E4 之类）不能让整页挂掉，解不开就用原串 */
      try { k = decodeURIComponent(k.replace(/\+/g, " ")); } catch (e) { /* 用原串 */ }
      try { v = decodeURIComponent(v.replace(/\+/g, " ")); } catch (e) { /* 用原串 */ }
      q[k] = v;
    });
    return q;
  }

  function buildQuery(obj) {
    var bits = [];
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (v == null || v === "") return;
      bits.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
    });
    return bits.length ? "?" + bits.join("&") : "";
  }

  /* 拆 hash：路径 / 路径片段 / 查询参数 */
  function hashParts() {
    var h = location.hash.replace(/^#/, "") || "/";
    var i = h.indexOf("?");
    var path = i < 0 ? h : h.slice(0, i);
    return { path: path, parts: path.split("/").filter(Boolean),
             q: parseQuery(i < 0 ? "" : h.slice(i + 1)) };
  }

  function setHashQuiet(u) {
    try { history.replaceState(null, "", u); }
    catch (e) { location.hash = u; }
  }

  /* ================= 索引页（v43 · 两页合一） =================

     原先「按标签浏览」(#/tags) 与「首字母索引」(#/idx) 是两个独立页面、两个导航项，
     可它们回答的是同一个问题——「手上只有一点线索，帮我定位到词条」，
     区别只在线索的种类：一串读音，或一个标签。合并成一页、顶部切换之后，
     用户少一层入口，站内也少一份重复的说明文字。

     几个取舍写在这里，免得日后被当成疏漏：
       · 无参数时默认「按首字母浏览」——首页那张「拼音索引 A–Z」卡片与 26 个字母
         都指向 #/idx、#/i/L，默认落在这里，首页才不用改一个字。
       · 状态只认 URL，不读本地存储：同一个链接在任何机器上打开都是同一页。
       · 分段控件与子状态（字母、标签种类）都做成真链接，再挂一层「就地更新」，
         于是中间键新窗打开、右键复制链接、禁用脚本时都照旧可用。 */

  var IDX_KINDS = [["topic", "主题"], ["place", "原著位置"], ["work", "经典著作"]];
  var IDX_ST = null;        // 当前索引页状态；离开该页置 null，避免别处误更新

  function idxState(q) {
    q = q || {};
    var m = q.m === "tag" ? "tag" : "alpha";
    var k = "topic";
    IDX_KINDS.forEach(function (p) { if (p[0] === q.k) k = p[0]; });
    /* 字母只留一个大写 A–Z，防止 #/i/xy 这类手改地址把过滤条件搞乱 */
    var l = String(q.l || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
    return { m: m, k: k, l: l };
  }

  /* 只在 URL 里写当前模式自己的参数：切到标签模式就不留字母，URL 保持短。
     另一模式的子状态留在内存里，同一次会话内切回去还在。 */
  function idxUrl(st) {
    if (st.m === "tag") {
      return "#/idx?m=tag" + (st.k && st.k !== "topic" ? "&k=" + st.k : "");
    }
    return "#/idx?m=alpha" + (st.l ? "&l=" + st.l : "");
  }

  function idxSegInner(st) {
    return [["alpha", "按首字母浏览"], ["tag", "按标签浏览"]].map(function (p) {
      var on = p[0] === st.m;
      var tok = "m=" + p[0] + (p[0] === "tag" ? "&k=" + st.k : (st.l ? "&l=" + st.l : ""));
      return '<a class="ttab' + (on ? " on" : "") + '" id="idx-tab-' + p[0] + '" role="tab" ' +
        'href="' + idxUrl({ m: p[0], k: st.k, l: st.l }) + '" data-idx-go="' + tok + '" ' +
        'aria-selected="' + (on ? "true" : "false") + '" aria-controls="idx-body" ' +
        'tabindex="' + (on ? "0" : "-1") + '">' + p[1] + "</a>";
    }).join("");
  }

  function viewIndexPage(st) {
    IDX_ST = st;
    return '<p class="crumb"><a href="#/">首页</a> / 索引</p>' +
      '<h1 class="page-title">索引</h1>' +
      '<div class="ttabs idx-seg" role="tablist" aria-label="索引的两种找法">' +
        idxSegInner(st) + "</div>" +
      '<p class="sr-only" id="idx-live" role="status" aria-live="polite"></p>' +
      '<div id="idx-body" role="tabpanel" aria-labelledby="idx-tab-' + st.m + '" tabindex="0">' +
        idxBodyHTML(st) + "</div>";
  }

  function idxBodyHTML(st) {
    return st.m === "tag" ? idxTagBody(st) : idxAlphaBody(st);
  }

  /* —— 模式一：按首字母 —— */
  function idxAlphaBody(st) {
    var letters = allLetters();
    var bar = '<div class="alpha" aria-label="按首字母定位">' +
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(function (L) {
        if (!letters[L]) return '<span class="dis" aria-hidden="true">' + L + "</span>";
        var on = L === st.l;
        /* 再点一次已选中的字母 → 回到全部（和标签页那个字母条同一个手感） */
        var tok = on ? "m=alpha" : "m=alpha&l=" + L;
        return '<a href="' + idxUrl(on ? { m: "alpha", k: st.k } : { m: "alpha", k: st.k, l: L }) +
          '" data-idx-go="' + tok + '"' + (on ? ' class="on" aria-current="true"' : "") +
          ">" + L + "</a>";
      }).join("") + "</div>";

    var all = TERMS.slice().sort(function (a, b) { return a.pinyin.localeCompare(b.pinyin); });

    if (!st.l) {
      return bar + termList(all);
    }
    var list = byInitial(st.l);
    return '<p class="note">以 <b>' + esc(st.l) + "</b> 开头的词条共 <b>" + list.length + "</b> 条。" +
      "点上面同一个字母可回到全部。</p>" + bar +
      '<h2 class="sec-title slim">' + esc(st.l) + ' 开头<span class="more">' + list.length +
      " 条</span></h2>" + termList(list);
  }

  /* —— 模式二：按标签 —— */
  function idxTagBody(st) {
    var all = tagsIndex();
    var kinds = { topic: [], place: [], work: [] };
    all.forEach(function (g) { if (kinds[g.kind]) kinds[g.kind].push(g); });

    var kind = kinds[st.k] && kinds[st.k].length !== undefined ? st.k : "topic";
    var cur = kinds[kind] || [];
    var label = { topic: "主题与议题", place: "原著位置（按分册与篇目次序）", work: "经典著作" }[kind];

    var kindTabs = '<div class="ttabs idx-kinds">' +
      IDX_KINDS.map(function (p) {
        var on = p[0] === kind;
        return '<a class="ttab' + (on ? " on" : "") + '" href="' + idxUrl({ m: "tag", k: p[0] }) +
          '" data-idx-go="m=tag&k=' + p[0] + '"' + (on ? ' aria-current="true"' : "") + ">" +
          p[1] + "<em>" + kinds[p[0]].length + "</em></a>";
      }).join("") + "</div>";

    var head = kindTabs +
      '<h2 class="sec-title slim">' + esc(label) +
        '<span class="more" id="tagcloud-count" data-n="' + cur.length + '">' + cur.length +
        " 个标签</span></h2>";

    if (kind === "place") return head + placeView(cur);

    /* 标签云自己的首字母定位条：只列当前组里实际出现的字母（数字打头的排最前）。
       悬停/触摸/点击的行为由 #view 上的委托统一处理（见 tagIdx* 那一段）。 */
    var iniMap = {};
    cur.forEach(function (g) { var c = TAGI[g.name] || "#"; iniMap[c] = (iniMap[c] || 0) + 1; });
    var inis = Object.keys(iniMap).sort(function (a, b) {
      var da = /\d/.test(a), db = /\d/.test(b);
      if (da !== db) return da ? -1 : 1;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    var idxBar = inis.length > 1
      ? '<div class="tag-idx" aria-label="按首字母定位"><span class="ti-label">首字母</span>' +
        inis.map(function (c) {
          return '<button type="button" class="ti" data-in="' + c +
            '" title="以 ' + c + " 开头的标签 " + iniMap[c] + " 个\">" + c + "<em>" + iniMap[c] + "</em></button>";
        }).join("") + "</div>"
      : "";

    return head + idxBar + tagCloud(cur, "tagcloud-main");
  }

  /* 就地更新：改地址 → 重画 #idx-body → 修正选中态。
     fromSeg 表示这次点击发生在分段控件上（它在 #idx-body 之外，重画它才不会丢焦点）。 */
  function idxPaint(st, token, fromSeg) {
    IDX_ST = st;
    setHashQuiet(idxUrl(st));
    var seg = document.querySelector(".idx-seg");
    if (seg) {
      seg.innerHTML = idxSegInner(st);
      if (fromSeg) {
        var f = document.getElementById("idx-tab-" + st.m);
        if (f && f.focus) { try { f.focus(); } catch (e) { /* 忽略 */ } }
      }
    }
    var body = document.getElementById("idx-body");
    if (body) {
      body.innerHTML = idxBodyHTML(st);
      body.setAttribute("aria-labelledby", "idx-tab-" + st.m);
    }
    /* 键盘点字母/标签种类之后，把焦点还到同一枚元素上 —— 否则焦点掉回 body，
       连按方向键就没反应了。 */
    if (token && !fromSeg) {
      var again = document.querySelector('#idx-body [data-idx-go="' + token + '"]');
      if (again && again.focus) { try { again.focus(); } catch (e) { /* 忽略 */ } }
    }
    var live = document.getElementById("idx-live");
    if (live) {
      live.textContent = st.m === "alpha"
        ? "已切换到按首字母浏览" + (st.l ? "，只看 " + st.l + " 开头" : "，列出全部词条")
        : "已切换到按标签浏览，" + ({ topic: "主题与议题", place: "原著位置", work: "经典著作" }[st.k] || "");
    }
  }

  function idxGo(token, fromSeg) {
    if (!IDX_ST) return false;
    var p = parseQuery(token);
    var st = idxState({ m: p.m, k: p.k != null ? p.k : IDX_ST.k,
                        l: p.m === "alpha" ? (p.l != null ? p.l : "") : IDX_ST.l });
    idxPaint(st, token, fromSeg);
    return true;
  }

  /* 门类页：#/c/<板块> 列整块；#/c/<板块>?sub=<方向> 是 v60 的组合筛选，
     标题按「板块·方向」合并标注（如「哲学·基本原理」），只列该组合的词条。
     直接用方向 id 访问旧地址（#/c/sub-jb）仍是兜底页——方向只作为板块的细分存在。 */
  function viewCat(cid, q) {
    var c = CATS[cid];
    if (!c) return '<p class="empty">没有这个门类。<a href="#/">回到首页</a></p>';
    var tx = taxById(c.tax) || { name: "", basis: "", cats: [] };
    var sub = (q && q.sub && SUBS[q.sub]) ? q.sub : null;
    var list = (sub ? termsInSub(cid, sub) : termsIn(cid)).sort(pySort);

    var sibs;
    if (sub) {
      sibs = ((SUB_TX && SUB_TX.cats) || []).map(function (s) {
        var n = termsInSub(cid, s.id).length;
        return '<a class="sib' + (s.id === sub ? " on" : "") + '" href="#/c/' + esc(cid) + "?sub=" + esc(s.id) + '">' +
          esc(catShort(cid)) + "·" + esc(subShort(s.id)) + "<em>" + n + "</em></a>";
      }).join("");
    } else {
      sibs = (tx.cats || []).map(function (s) {
        var n = termsIn(s.id).length;
        return '<a class="sib' + (s.id === cid ? " on" : "") + '" href="#/c/' + esc(s.id) + '">' +
          esc(s.name) + '<em>' + n + "</em></a>";
      }).join("");
    }

    if (!sub) {
      return '<p class="crumb"><a href="#/">首页</a> / ' + esc(tx.name) + " / " + esc(c.name) + "</p>" +
        '<h1 class="page-title">' + esc(c.name) + "</h1>" +
        termList(list) +
        '<h2 class="sec-title">同一维度下的其他门类</h2>' +
        '<div class="sibs">' + sibs + "</div>";
    }
    return '<p class="crumb"><a href="#/">首页</a> / ' + esc(tx.name) + " / " +
        '<a href="#/c/' + esc(cid) + '">' + esc(c.name) + "</a> / " + esc(subName(sub)) + "</p>" +
      '<h1 class="page-title">' + esc(catShort(cid)) + "·" + esc(subShort(sub)) + "</h1>" +
      '<p class="note"><b>知识板块 · 学科方向</b>组合筛选。<br>' +
        "知识板块：" + esc(c.name) + (tx.basis ? "（依据：" + esc(tx.basis) + "）" : "") + "<br>" +
        "学科方向：" + esc(subName(sub)) + "（依据：" + esc((SUB_TX && SUB_TX.basis) || "") + "）</p>" +
      '<p class="note">该组合下共 ' + list.length + " 条。</p>" +
      termList(list) +
      '<h2 class="sec-title">同一板块下的其他学科方向</h2>' +
      '<div class="sibs">' + sibs + "</div>";
  }

  function viewTerm(id) {
    var t = BY_ID[id];
    if (!t) return '<p class="empty">没有找到这个词条。<a href="#/">回到首页</a></p>';
    LR.setLast(t.id);   // 记住「上次读到」，首页学习台用

    var rels = (t.related || []).map(function (r) {
      var o = BY_ID[r.id];
      if (!o) return "";
      return '<a class="rel' + (r.rel === "now" ? " now" : "") + '" href="#/t/' + esc(o.id) + '">' +
        esc(o.term) + '<span class="r-rel">' + esc(RELS[r.rel] || r.rel) + "</span></a>";
    }).join("");

    var originals = (t.original || []).map(function (o) {
      if (o.pending || !o.text) {
        // 「【非马恩著作】」开头的条目不是马恩原典，引导语须区分，免得读者以为它也有《资本论》页码可核
        var chTxt = o.chapter || "—";
        var nonMarx = chTxt.indexOf("【非马恩著作】") === 0;
        if (nonMarx) chTxt = chTxt.replace("【非马恩著作】依据为", "").replace("【非马恩著作】", "");
        return '<div class="quote pending"><p class="q-pending"><b>原典引文待补录。</b>' +
          (nonMarx ? "本条的依据不在马恩著作中，而是：" : "已定位到章节：") + esc(chTxt) + "。<br>" + esc(o.cite || "") + "</p></div>";
      }
      var locChip = "";
      if (o.verify && o.loc === "页") {
        locChip = ' <span class="chip ok" style="margin-left:.4rem" title="引文逐字取自所标版本，页码为该页在书中的印刷页码，已逐页核对">页码已核</span>';
      } else if (o.verify && o.loc === "篇") {
        locChip = ' <span class="chip" style="margin-left:.4rem" title="卷首文献（扉页献词等），书中此页不印页码，已逐字核对原文">卷首文献</span>';
      } else if (o.verify && o.loc === "版") {
        locChip = ' <span class="chip ok" style="margin-left:.4rem" title="引文逐字取自公开发布的权威全文（中国政府网／中国共产党新闻网／新华社通稿），出处为《人民日报》见报日期，照该日期查报即可核对">版次已核</span>';
      } else if (o.verify && o.loc === "条") {
        locChip = ' <span class="chip ok" style="margin-left:.4rem" title="引文逐字取自现行法律条文，照条款号查证即可核对">条款已核</span>';
      } else if (o.verify && o.loc === "篇级") {
        locChip = ' <span class="chip" style="margin-left:.4rem" title="引文逐字取自权威文本；页码是该篇在《文集》中的完整页码范围，具体页次请按《文集》核对">篇级页码</span>';
      }
      var noteHtml = o.note ? '<p class="q-note">' + esc(o.note) + "</p>" : "";
      // 复制内容＝引文原文 + 出处（页面上的引注原样给出，不做二次加工）
      var payload = o.text + "\n——" + (o.cite || "") + (o.chapter ? "\n（" + o.chapter + "）" : "");
      var gb = toGB(o.cite);
      return '<div class="quote"><blockquote>' + esc(o.text) + "</blockquote>" +
        '<p class="q-cite"><span class="q-ch">' + esc(o.chapter || "") + "</span>" + esc(o.cite || "") +
        (o.verify ? locChip : ' <span class="chip warn" style="margin-left:.4rem">页码待核</span>') + "</p>" +
        noteHtml +
        '<div class="q-acts">' +
          '<button type="button" class="tbtn" data-copy="' + esc(payload) + '">复制引文</button>' +
          (gb ? '<button type="button" class="tbtn" data-copy="' + esc(gb) +
                '" title="GB/T 7714—2015 著录格式，请按目标刊物要求核对">复制 GB/T 7714</button>' : "") +
        "</div></div>";
    }).join("") || '<p class="empty">本条暂无原典引文（当代切口类词条的原典依据见「关联词条」）。</p>';

    var nStance = stanceCount(t);
    var scholars = hasStance(t)
      ? (t.scholars || []).map(function (g) {
          var stances = (g.stances || []).map(function (s) {
            var chip = s.verified
              ? ' <span class="chip ok" style="margin-left:.4rem" title="文献的作者、篇名、刊名、年、期、页码已逐项核对公开权威来源">文献已核</span>'
              : ' <span class="chip warn" style="margin-left:.4rem">文献待核</span>';
            return '<div class="stance">' +
              (s.side ? '<p class="s-side">' + esc(s.side) + "</p>" : "") +
              '<p class="s-view">' + esc(s.view) + "</p>" +
              '<p class="s-cite">' + esc(s.cite || "") + chip + "</p>" +
              "</div>";
          }).join("");
          return '<div class="debate">' +
            '<p class="d-focus"><span class="d-tag">争鸣</span>' + esc(g.focus || "") + "</p>" +
            (stances || '<p class="empty">该议题的各方观点待补。</p>') +
            "</div>";
        }).join("")
      : (t.scholars_lead
        ? '<p class="debate-lead"><span class="dl-tag">本条可争之处</span>' + esc(t.scholars_lead) +
          '<br><span class="dl-hint">此处应转述 2—3 篇代表性研究（含不同判断），按「参见 作者：《篇名》，《刊名》年(期)：页码。」标注出处；文献尚未补录。</span></p>'
        : '<p class="empty">本条的学界争鸣尚未补录。</p>');

    var cr = t.credit || {};

    /* 词条级工具条。复制内容都预先算好挂在 data-copy 上，
       点击时只做剪贴板写入，不在事件里再拼字符串。 */
    var allCites = (t.original || []).filter(function (o) { return o.cite; }).map(function (o, i) {
      return (i + 1) + ". " + (o.text ? "「" + o.text + "」" : "【引文待补】") +
        "——" + o.cite + (o.chapter ? "（" + o.chapter + "）" : "");
    }).join("\n\n");
    var gbCites = (t.original || []).map(function (o) { return toGB(o.cite); }).filter(Boolean).join("\n");
    var brief = t.term + "\n" + t.oneline + "\n\n" + t.standard +
      (allCites ? "\n\n原典依据：\n" + allCites : "");
    var lrRead = LR.isRead(t.id), lrStar = LR.isStar(t.id);
    var tools = '<div class="term-tools">' +
      '<button type="button" class="tbtn lr' + (lrRead ? " on" : "") + '" data-lr="read" title="读完一条就标记一下，首页学习台会记进度">' +
        (lrRead ? "✓ 已读" : "标记已读") + "</button>" +
      '<button type="button" class="tbtn lr' + (lrStar ? " on" : "") + '" data-lr="star" title="存进生词本，在首页学习台集中复习">' +
        (lrStar ? "★ 在生词本" : "＋ 生词本") + "</button>" +
      '<button type="button" class="tbtn" data-copy="' + esc(brief) + '">复制词条摘要</button>' +
      '<button type="button" class="tbtn" data-act="wt-add-term" data-id="' + esc(t.id) +
        '" title="把本条的原典引文与争鸣立场收进写作台的当前章节">加入写作台</button>' +
      (allCites ? '<button type="button" class="tbtn" data-copy="' + esc(allCites) + '">复制全部引注</button>' : "") +
      (gbCites ? '<button type="button" class="tbtn" data-copy="' + esc(gbCites) +
        '" title="GB/T 7714—2015 著录格式，请按目标刊物要求核对">复制 GB/T 7714</button>' : "") +
      '<button type="button" class="tbtn" data-act="print">打印本条</button>' +
      '<button type="button" class="tbtn" data-act="link">复制链接</button>' +
      "</div>" +
      '<div class="lr-note"><label for="lr-note-ta">我的笔记<span>只保存在本机浏览器，不会上传</span></label>' +
      '<textarea id="lr-note-ta" data-note="' + esc(t.id) + '" rows="3" placeholder="写下你的理解、疑问，或它与某个当代现象的联系……">' +
        esc(LR.getNote(t.id)) + "</textarea></div>";

    return "" +
      '<p class="crumb"><a href="#/">首页</a> / ' +
        TAXES.map(function (tx) {
          var cid = t[tx.field];
          if (!cid) return "";
          return '<a href="#/c/' + esc(cid) + '" title="' + esc(tx.name) + '">' + esc(catName(cid)) + "</a>";
        }).filter(Boolean).join(" · ") +
        " / " + esc(t.term) + "</p>" +
      '<article class="term" data-term="' + esc(t.id) + '">' +
      '<header class="term-head">' +
        "<h1>" + esc(t.term) + "</h1>" +
        '<div class="py">' + esc(t.pinyin) + " &nbsp;·&nbsp; " + esc(t.initials) + "</div>" +
        (t.en || t.de
          ? '<div class="ende">' +
            (t.en ? '<span class="en" title="官方英文译名">' + esc(t.en) + "</span>" : "") +
            (t.de ? '<span class="de" title="德文原词（MEW）">' + esc(t.de) + "</span>" : "") +
            "</div>"
          : "") +
        '<div class="chips">' + chips(t) + "</div>" +
      "</header>" +
      tools +

      '<div class="block">' +
        '<p class="b-label">AI 的一句话</p>' +
        '<p class="oneline">' + esc(t.oneline) + "</p>" +
      "</div>" +

      '<div class="block">' +
        '<p class="b-label">AI 的当代场景</p>' +
        '<p class="contemp">' + esc(t.contemporary) + "</p>" +
      "</div>" +

      '<div class="block">' +
        '<p class="b-label">标准释义<span class="b-hint">' + esc(t.standard.length) + " 字</span></p>" +
        '<p class="standard-text">' + esc(t.standard) + "</p>" +
      "</div>" +

      '<div class="block">' +
        '<p class="b-label">关联词条</p>' +
        '<div class="rel-wrap">' + (rels || '<span class="empty">暂无</span>') + "</div>" +
      "</div>" +

      '<div class="block">' +
        '<p class="b-label">原典直引<span class="b-hint">可原文引用 · 需标版本页码</span></p>' +
        originals +
      "</div>" +

      '<div class="block">' +
        '<p class="b-label">学界争鸣<span class="b-hint">' +
          (nStance ? nStance + " 方立场 · " : "") + "只能转述 · 脚注写「参见」</span></p>" +
        scholars +
      "</div>" +

      "</article>";
  }

  /* ══════════════════════════════════════════════════════════════════
     马克思画传（#/pictorial）
     画册本身是独立单文件 marx-pictorial.html，与本站产物同目录并列。
     这里给内嵌预览 + 新窗口出口：iframe 走同目录相对路径，file:// 下同源可显示；
     若产物文件被拆开存放，iframe 会失败，届时自动收掉预览框只留出口按钮，
     不至于给用户留一块白框。
     ══════════════════════════════════════════════════════════════════ */
  var PIC_TIMER = null;
  function picUnbind() { if (PIC_TIMER) { clearTimeout(PIC_TIMER); PIC_TIMER = null; } }

  function viewPictorial() {
    return '<div class="pic">' +
      '<h1 class="pic-h1">马克思画传</h1>' +
      '<p class="pic-kicker">A Pictorial Biography &middot; Layered Parallax Edition</p>' +
      '<div class="pic-acts">' +
        '<a class="pic-btn pic-btn-main" href="marx-pictorial.html" target="_blank" rel="noopener">在新窗口打开画册 ↗</a>' +
        '<button class="pic-btn" type="button" data-pic-full>全屏预览</button>' +
        '<span class="pic-state" id="picState" role="status" aria-live="polite">正在载入预览…</span>' +
      '</div>' +
      '<div class="pic-frame" id="picFrameWrap">' +
        '<iframe id="picFrame" src="marx-pictorial.html" title="马克思画传" ' +
          'loading="lazy" referrerpolicy="no-referrer"></iframe>' +
      '</div>' +
      '<p class="pic-fallback" id="picFallback" hidden>预览载入不了，多半是 ' +
        '<code>marx-pictorial.html</code> 与本页不在同一目录。' +
        '画册是独立文件，直接打开它即可，功能不受影响。</p>' +
      '</div>';
  }

  function picBind() {
    var f = document.getElementById("picFrame");
    var state = document.getElementById("picState");
    var fb = document.getElementById("picFallback");
    if (!f) return;
    var settled = false;
    function fail() {
      if (settled) return;
      settled = true;
      picUnbind();
      if (fb) fb.hidden = false;
      if (state) state.textContent = "预览不可用，请用上方按钮打开";
      var w = document.getElementById("picFrameWrap");
      if (w) w.style.display = "none";
    }
    function done() {
      if (settled) return;
      settled = true;
      picUnbind();
      if (state) state.textContent = "预览已就绪 · 滚轮 / 方向键 / 滑动翻页";
    }
    f.addEventListener("load", done);
    f.addEventListener("error", fail);
    PIC_TIMER = setTimeout(fail, 4000);
    var full = document.querySelector("[data-pic-full]");
    if (full) full.addEventListener("click", function () {
      var w = document.getElementById("picFrameWrap");
      if (!w) return;
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen();
      else if (w.requestFullscreen) w.requestFullscreen();
      else if (f.requestFullscreen) f.requestFullscreen();
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     「儿童绘本」入口已撤除（v49）：项目不再使用 marx-book 那套绘本资源，
     统一改用 pictorial 的《马克思画传》。旧地址 #/book 保留为**别名**，
     静默规范化到 #/pictorial —— 站内外的旧链接、读者收藏过的地址都还进得来。
     绘本与画册的正文本来就是同一份（pictorial/pages.json 借用了 marx-book 的
     33 页中英正文，只额外附加美术描述层），所以合并不丢内容。
     ══════════════════════════════════════════════════════════════════ */

  /* ================= 创作说明 · AI 使用透明记录 =================

     投稿要求创作说明含六项：作品主题 / 原典依据 / 创作思路 / 所用人工智能工具 /
     人工修改与核验过程 / 素材来源及授权情况。这六段正文写在数据里
     （meta.credit_meta，由 tools/credit/fill_credit.py 生成，数字从词条库现算），
     页面只负责呈现与导出——改字不必改代码。

     导出走自研的 docxBuild()：排版（A4、二号黑体标题、小四宋体 1.5 倍行距首行缩进
     两字符）直接写进 styles.xml，导出的文件不必再排一遍即可交。 */

  var CM = META.credit_meta || {};
  var CM_SECS = [
    ["theme", "作品主题"], ["basis", "原典依据"], ["approach", "创作思路"],
    ["ai_tools", "所用人工智能工具"], ["human_process", "人工修改与核验过程"],
    ["sources", "素材来源及授权情况"]
  ];
  var CM_CN = ["一", "二", "三", "四", "五", "六"];

  /* 作品信息（作者 / 学校 / 联系方式）：只存本机；导出时写进文稿。
     不写进数据文件，是因为这三项属于投稿时才知道的信息，不该硬编码进词条库。 */
  var CMKEY = "capital-dict-author-v1";
  var CM_INFO = (function () {
    var mem = null;
    function read() {
      try { var r = localStorage.getItem(CMKEY); if (r) return JSON.parse(r) || {}; } catch (e) { /* 隐私模式等，退回内存 */ }
      return mem || {};
    }
    return {
      get: function () {
        var d = { author: CM.author_default || "", org: CM.org_default || "",
          contact: CM.contact_default || "" };
        var o = read();
        Object.keys(d).forEach(function (k) { if (o[k]) d[k] = o[k]; });
        return d;
      },
      set: function (o) { mem = o; try { localStorage.setItem(CMKEY, JSON.stringify(o)); } catch (e) { /* 同上 */ } }
    };
  })();

  function cmAuthorLine() {
    var a = CM_INFO.get(), bits = [];
    if (a.author) bits.push("作者：" + a.author);
    if (a.org) bits.push("学校（院系）：" + a.org);
    if (a.contact) bits.push("联系方式：" + a.contact);
    return bits.join("　");
  }

  /* 页内跳转。不用 <a href="#某锚点"> 的原因：本站是 hash 路由，
     改 hash 等于换页 —— #about-credit 会被当成一个不存在的路由。
     所以跳转一律走脚本，焦点也一并送过去（键盘用户接着 Tab 就在那一段里）。 */
  function jumpTo(id) {
    var t = document.getElementById(id);
    if (!t) return false;
    if (t.getAttribute("tabindex") == null) t.setAttribute("tabindex", "-1");
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    /* scrollIntoView 在一些非浏览器环境（jsdom 之类）里整个不存在，
       连 catch 里的降级调用也会一起炸——所以先探一次，没有就只挪焦点。 */
    if (typeof t.scrollIntoView === "function") {
      try { t.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }); }
      catch (e) { try { t.scrollIntoView(); } catch (e2) { /* 没有也罢 */ } }
    }
    try { t.focus({ preventScroll: true }); } catch (e) { /* 老环境不支持也罢了 */ }
    return true;
  }

  /* ---------------- 标签浏览 ----------------
     标签云的字号按收录条数分档（.tw-1 ~ .tw-5），不写死 px，
     这样加词条、改标签之后不用手调。 */

  function tagCloud(list, domId) {
    if (!list.length) return '<p class="empty">此组暂无标签。</p>';
    var maxN = list[0].n;
    return '<div class="tag-cloud"' + (domId ? ' id="' + domId + '"' : "") + ">" + list.map(function (g) {
      var lv = maxN <= 1 ? 2 : Math.min(5, Math.max(1, Math.round(1 + (g.n / maxN) * 4)));
      return '<a class="tag tw-' + lv + '" data-in="' + (TAGI[g.name] || "#") +
        '" href="#/tg/' + encodeURIComponent(g.name) + '">' +
        esc(g.name) + "<em>" + g.n + "</em></a>";
    }).join("") + "</div>";
  }

  /* 原著位置组的排序键：版序言(0) → 篇(1) → 章(2) → 节(3)，同类按号数升序 */
  function placeSortKey(name) {
    var m = /^第(.+?)(篇|章|节|版序言)$/.exec(name);
    if (!m) return [9, 0];
    var type = { "版序言": 0, "篇": 1, "章": 2, "节": 3 }[m[2]];
    var n = cnInt(m[1]);
    return [type, n == null ? 0 : n];
  }

  /* 原著位置组：分册（第一/二/三卷《资本论》）→ 组内按篇目次序排。
     同名「篇」「章」在不同分册各指其篇（第一卷与第二卷各有「第一篇」），
     所以按卷分组分别列出；标签后的数字 = 在该卷下挂此标签的词条数。 */
  function placeView(all) {
    var vols = ["第一卷", "第二卷", "第三卷"];
    var cnt = {};
    TERMS.forEach(function (t) {
      var tags = t.tags || [];
      tags.forEach(function (p) {
        if (!/^第[一二三四五六七八九十百\d]+(篇|章|节|版序言)$/.test(p)) return;  // 只统计位置标签，主题/著作标签不算
        vols.forEach(function (v) {
          if (tags.indexOf(v) > -1) (cnt[p] = cnt[p] || {})[v] = (cnt[p][v] || 0) + 1;
        });
      });
    });
    var byName = {};
    all.forEach(function (g) { byName[g.name] = g; });

    var secs = vols.map(function (v) {
      var volTag = byName[v];
      var sub = Object.keys(cnt).filter(function (p) { return cnt[p][v]; })
        .sort(function (a, b) {
          var ka = placeSortKey(a), kb = placeSortKey(b);
          return ka[0] - kb[0] || ka[1] - kb[1] || a.localeCompare(b, "zh");
        });
      var cloud = (volTag
        ? '<a class="tag place-vol" data-in="' + (TAGI[v] || "#") + '" href="#/tg/' + encodeURIComponent(v) +
          '" title="整卷通读：挂「' + v + '」标签的全部词条">整卷 <em>' + volTag.n + "</em></a>"
        : "") +
        sub.map(function (p) {
          return '<a class="tag" data-in="' + (TAGI[p] || "#") + '" href="#/tg/' + encodeURIComponent(p) +
            '" title="《资本论》' + v + "·挂「" + p + "」标签的词条\">" + esc(p) + "<em>" + cnt[p][v] + "</em></a>";
        }).join("");
      return '<section class="place-sec"><h3 class="ps-h">《资本论》' + esc(v) +
        (volTag ? '<span class="ps-n">' + volTag.n + " 条词条</span>" : "") + "</h3>" +
        '<div class="tag-cloud">' + cloud + "</div></section>";
    }).join("");

    /* 兜底：不属于任何分册的位置标签（理论上是 0 个，留着防数据变化） */
    var others = all.filter(function (g) { return !/^第[一二三]卷$/.test(g.name) && !cnt[g.name]; });
    if (others.length) {
      secs += '<section class="place-sec"><h3 class="ps-h">其他原著位置</h3>' + tagCloud(others) + "</section>";
    }

    return '<p class="note">同一枚「篇」「章」标签在<strong>不同分册各指其篇</strong>——第一卷与第二卷各有「第一篇」，' +
      '所以按分册分组列出，组内按<strong>序言 → 篇 → 章 → 节</strong>的次序排，与原书目录一致；' +
      '标签后的数字是<strong>在该分册下</strong>挂此标签的词条数，不是该标签的全站总数。</p>' + secs;
  }

  /* ================= 文件解析：把 .docx / .pdf / .txt 变成纯文本 =================

     交付要的是「双击就能离线打开的单文件」，所以不能引第三方库（pdf.js 一家
     的体积就超过整个站）。这里自己写了三样，合计约四百行：

       INFLATE  裸 DEFLATE 解压（RFC 1951）—— ZIP 与 PDF 的 FlateDecode 都要它
       ZIP      只做「按名字取一个条目」的最小实现—— .docx 本身就是一个 ZIP
       PDF      取内容流 + 认 Tj/TJ 算子 + 借 ToUnicode CMap 把字形码映回 Unicode

     PDF 一层是尽力而为：有文字层的读得全，扫描件读不出（会明确提示），
     缺 ToUnicode 的 CID 字体只能读出认得出的部分并给出比例警告。 */

  var INFLATE = (function () {
    /* 长度/距离的基值与附加位数（RFC 1951 §3.2.5） */
    var LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59,
      67, 83, 99, 115, 131, 163, 195, 227, 258];
    var LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3,
      4, 4, 4, 4, 5, 5, 5, 5, 0];
    var DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513,
      769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
    var DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8,
      9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
    var CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
    var MAXOUT = 96 * 1024 * 1024;

    var FIXED_LIT = (function () {
      var a = new Uint8Array(288), i;
      for (i = 0; i < 144; i++) a[i] = 8;
      for (; i < 256; i++) a[i] = 9;
      for (; i < 280; i++) a[i] = 7;
      for (; i < 288; i++) a[i] = 8;
      return a;
    })();
    var FIXED_DIST = (function () {
      var a = new Uint8Array(30), i;
      for (i = 0; i < 30; i++) a[i] = 5;
      return a;
    })();

    function inflateRaw(src) {
      var pos = 0, buf = 0, cnt = 0;
      var out = new Uint8Array(Math.max(4096, src.length * 5)), n = 0;

      /* 位读取：DEFLATE 是「低位在前」，所以先读到的字节占据寄存器的低位，
         后续字节往上续。任何时候保留的位不超过 24 位，不会溢出 32 位整数。
         数据读完就报错——绝不能拿 0 去补位：那会让畸形流一直产出垃圾，
         在别人的电脑上表现为「页面卡住」。 */
      function refill() {
        while (cnt <= 16 && pos < src.length) {
          buf |= src[pos++] << cnt;
          cnt += 8;
        }
      }
      function bits(k) {
        if (!k) return 0;
        refill();
        if (cnt < k) throw new Error("解压失败：数据不完整（流被截断）");
        var v = buf & ((1 << k) - 1);
        buf >>>= k;
        cnt -= k;
        return v;
      }
      function rawByte() {
        if (cnt >= 8) { cnt -= 8; var v = buf & 0xff; buf >>>= 8; return v; }
        if (pos < src.length) return src[pos++];
        throw new Error("解压失败：数据不完整（流被截断）");
      }
      function push(b) {
        if (n >= out.length) {
          var cap = out.length * 2;
          if (cap > MAXOUT) throw new Error("解压后数据过大");
          var a = new Uint8Array(cap);
          a.set(out.subarray(0, n));
          out = a;
        }
        out[n++] = b;
      }
      /* 规范 Huffman：counts[码长] = 该长度的码字数，syms 按码长分组按字典序排 */
      function tree(lengths, count) {
        var counts = new Int32Array(16), offs = new Int32Array(16);
        var i;
        for (i = 0; i < count; i++) counts[lengths[i]]++;
        counts[0] = 0;
        for (i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1];
        var syms = new Int32Array(count);
        for (i = 0; i < count; i++) if (lengths[i]) syms[offs[lengths[i]]++] = i;
        return { counts: counts, syms: syms };
      }
      function decode(t) {
        var sum = 0, cur = 0, len = 0;
        do {
          cur = 2 * cur + bits(1);
          len++;
          if (len > 15) return -1;
          sum += t.counts[len];
          cur -= t.counts[len];
        } while (cur >= 0);
        return t.syms[sum + cur];
      }

      var litT = null, distT = null, litFix = false, final;
      do {
        final = bits(1);
        var type = bits(2);
        if (type === 0) {
          /* 未压缩块：先对齐到字节边界，再读 LEN / NLEN */
          if (cnt % 8) bits(cnt % 8);
          var len0 = rawByte() | (rawByte() << 8);
          rawByte(); rawByte();
          for (var i0 = 0; i0 < len0; i0++) push(rawByte());
        } else if (type === 1 || type === 2) {
          if (type === 1) {
            /* litFix 标记「当前 litT 是固定树」。不能只判 !litT：动态块会把
               litT 覆盖成动态树，紧随其后的固定块若沿用动态树，会一路解出
               乱码直到把流读穿——真机 Word 保存的 docx 正是「动态块 ×2 →
               空存储块(全刷新) → 固定块收尾」的结构，这里栽过。 */
            if (!litFix) { litT = tree(FIXED_LIT, 288); distT = tree(FIXED_DIST, 30); litFix = true; }
          } else {
            litFix = false;   // 动态块马上要重建两棵树，固定树缓存随之失效
            var hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
            var cl = new Uint8Array(19), i;
            for (i = 0; i < hclen; i++) cl[CLORDER[i]] = bits(3);
            var clT = tree(cl, 19);
            var lens = new Uint8Array(hlit + hdist);
            for (i = 0; i < lens.length;) {
              var sy = decode(clT);
              if (sy < 0) throw new Error("解压失败：码长表损坏");
              if (sy < 16) lens[i++] = sy;
              else if (sy === 16) {
                var prev = i ? lens[i - 1] : 0, r16 = 3 + bits(2);
                while (r16-- && i < lens.length) lens[i++] = prev;
              } else if (sy === 17) {
                var r17 = 3 + bits(3);
                while (r17-- && i < lens.length) lens[i++] = 0;
              } else {
                var r18 = 11 + bits(7);
                while (r18-- && i < lens.length) lens[i++] = 0;
              }
            }
            litT = tree(lens.subarray(0, hlit), hlit);
            distT = tree(lens.subarray(hlit), hdist);
          }
          for (;;) {
            var s = decode(litT);
            if (s < 0) throw new Error("解压失败：无效编码");
            if (s < 256) { push(s); continue; }
            if (s === 256) break;
            var li = s - 257;
            if (li > 28) throw new Error("解压失败：长度码越界");
            var l2 = LBASE[li] + bits(LEXT[li]);
            var ds = decode(distT);
            if (ds < 0 || ds > 29) throw new Error("解压失败：距离码越界");
            var dist = DBASE[ds] + bits(DEXT[ds]);
            var from = n - dist;
            if (from < 0) throw new Error("解压失败：距离越界");
            for (var k = 0; k < l2; k++) push(out[from + k]);
          }
        } else {
          throw new Error("解压失败：未知块类型");
        }
      } while (!final);
      return out.subarray(0, n);
    }

    /* PDF 的 FlateDecode 是带 zlib 头的（RFC 1950），ZIP 里是裸流。
       zlib 头首字节的低四位必为 8，而裸 DEFLATE 首字节的低四位只可能是
       0—7（BFINAL + BTYPE），所以这个判别不会误伤裸流。 */
    function inflate(bytes) {
      if (bytes.length > 2 && (bytes[0] & 0x0f) === 8 && ((bytes[0] << 8 | bytes[1]) % 31) === 0) {
        try { return inflateRaw(bytes.subarray(2)); } catch (e) { /* 落到裸流再试 */ }
      }
      return inflateRaw(bytes);
    }

    return { inflate: inflate, inflateRaw: inflateRaw };
  })();

  /* ---- 最小的 ZIP 读取：.docx 就是普通 ZIP（OOXML），中央目录在文件尾部 ---- */

  function rd16(b, i) { return b[i] | (b[i + 1] << 8); }
  function rd32(b, i) { return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0; }

  function zipIndex(b) {
    var i, min = Math.max(0, b.length - 66000);
    for (i = b.length - 22; i >= min; i--) {
      if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) break;
    }
    if (i < min) throw new Error("不是有效的 ZIP 结构（找不到中央目录）");
    var count = rd16(b, i + 10), cd = rd32(b, i + 16);
    var map = {}, p = cd;
    for (var k = 0; k < count && p + 46 <= b.length; k++) {
      if (rd32(b, p) !== 0x02014b50) break;
      var method = rd16(b, p + 10);
      var csize = rd32(b, p + 20), usize = rd32(b, p + 24);
      var nlen = rd16(b, p + 28), elen = rd16(b, p + 30), clen = rd16(b, p + 32);
      var lho = rd32(b, p + 42);
      /* ZIP64：三个尺寸字段为全 1 时，真值在以 0x0001 开头的扩展区里 */
      if (csize === 0xffffffff || usize === 0xffffffff || lho === 0xffffffff) {
        var e = p + 46 + nlen, eEnd = e + elen;
        while (e + 4 <= eEnd) {
          var hid = rd16(b, e), hsz = rd16(b, e + 2), q = e + 4;
          if (hid === 0x0001) {
            if (usize === 0xffffffff) { usize = rd32(b, q); q += 8; }
            if (csize === 0xffffffff) { csize = rd32(b, q); q += 8; }
            if (lho === 0xffffffff) { lho = rd32(b, q); q += 8; }
          }
          e += 4 + hsz;
        }
      }
      var name = "";
      for (var j = 0; j < nlen; j++) name += String.fromCharCode(b[p + 46 + j]);
      map[name] = { method: method, csize: csize, usize: usize, off: lho };
      p += 46 + nlen + elen + clen;
    }
    return map;
  }

  function zipRead(b, e) {
    var p = e.off;
    if (rd32(b, p) !== 0x04034b50) throw new Error("ZIP 条目头损坏");
    var start = p + 30 + rd16(b, p + 26) + rd16(b, p + 28);
    var raw = b.subarray(start, start + e.csize);
    if (e.method === 0) return raw;
    if (e.method === 8) return INFLATE.inflateRaw(raw);
    throw new Error("ZIP 压缩方式不支持（method " + e.method + "）");
  }

  /* ---- docx → 文本：正文在 word/document.xml，按段落/制表/换行还原 ---- */

  function xmlUnescape(s) {
    return s
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCodePoint(+d); })
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  }

  function docxXmlToText(xml) {
    return xmlUnescape(xml
      .replace(/<w:instrText[\s\S]*?<\/w:instrText>/g, "")     // 域代码（页码、交叉引用）
      .replace(/<w:delText[\s\S]*?<\/w:delText>/g, "")         // 修订时删掉的文字
      .replace(/<w:tab\b[^>]*?\/?>/g, "\t")
      .replace(/<w:(br|cr)\b[^>]*?\/?>/g, "\n")
      .replace(/<\/w:tc>/g, "\t")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]*>/g, ""));
  }

  function docxText(buf) {
    var idx = zipIndex(buf);
    var main = idx["word/document.xml"];
    if (!main) {
      throw new Error("这个文件里没有 word/document.xml——可能不是 .docx（有的 .doc 改了后缀），或者文件已损坏");
    }
    var t = docxXmlToText(decodeBytes(zipRead(buf, main)));
    /* 脚注、尾注、页眉也常有正文，有就一并读进来 */
    ["word/footnotes.xml", "word/endnotes.xml"].forEach(function (k) {
      if (!idx[k]) return;
      try { t += "\n" + docxXmlToText(decodeBytes(zipRead(buf, idx[k]))); } catch (e) { /* 读不到就算了 */ }
    });
    return t;
  }

  /* ---- PDF → 文本。尽力而为：能认的认，认不出的计数并如实告知 ---- */

  function latin1(b) {
    var out = [], CH = 8192;
    for (var i = 0; i < b.length; i += CH) {
      out.push(String.fromCharCode.apply(null, b.subarray(i, Math.min(i + CH, b.length))));
    }
    return out.join("");
  }

  /* 找出对象的流数据。长度优先取 /Length：
       直接量（/Length 1234）直接用；间接引用（/Length 11 0 R）去对象 11 里取那个数——
       真实 PDF 里这两种都很常见，取不到才退到找 endstream。
     （踩过的坑：想用负向前瞻一次排除间接引用，结果 `/Length 83 0 R` 被匹配成
      `/Length 8`，整个流被切成 8 个字节——所以这里显式分开处理，不玩花活。） */
  function pdfStream(objs, rec) {
    if (!rec || !rec.raw) return null;
    var d = rec.dict || "";
    if (!/\/Filter/.test(d)) return rec.raw;                    // 没压缩
    if (!/FlateDecode/.test(d)) return null;                     // LZW / DCT / JPX 不处理
    var raw = rec.raw, len = -1;
    var ind = /\/Length\s*(\d+)\s+\d+\s+R/.exec(d);
    if (ind) {
      var lo = objs[+ind[1]];
      if (lo) {
        var n = parseInt(String(lo.dict || "").replace(/[^0-9]/g, ""), 10);
        if (n > 0) len = n;
      }
    } else {
      var dir = /\/Length\s*(\d+)/.exec(d);
      if (dir) len = +dir[1];
    }
    if (len > 0 && len <= raw.length) raw = raw.subarray(0, len);
    try { return INFLATE.inflate(raw); } catch (e) { return null; }
  }

  function shiftUni(s, d) {
    if (!s) return s;
    return s.slice(0, -1) + String.fromCharCode((s.charCodeAt(s.length - 1) + d) & 0xffff);
  }

  /* 解析 ToUnicode CMap：把「字形码 → Unicode」的映射读出来。
     全部用 indexOf 定位段落，不用 `[\s\S]*?` 这种惰性正则——
     一份缺结束标记的畸形 CMap 会让惰性正则退化成平方级扫描，
     在一份正常 PDF 上就要花几十秒（这个坑栽过一次）。
     另设条目上限：坏数据不许把内存吃光。 */
  function parseCMap(s) {
    if (s.length > 4 * 1024 * 1024) s = s.slice(0, 4 * 1024 * 1024);
    var map = {}, cap = 300000, n = 0, p, q;

    function hexUni(h) {
      var r = "";
      for (var i = 0; i + 4 <= h.length; i += 4) r += String.fromCharCode(parseInt(h.substr(i, 4), 16));
      if (h.length === 2) r += String.fromCharCode(parseInt(h, 16));
      return r;
    }

    p = 0;
    while (n < cap && (p = s.indexOf("beginbfchar", p)) > -1) {
      q = s.indexOf("endbfchar", p);
      if (q < 0) q = s.length;
      var body = s.slice(p, q);
      var re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g, m;
      while (n < cap && (m = re.exec(body))) {
        map[parseInt(m[1], 16)] = hexUni(m[2]);
        n++;
      }
      p = q + 9;
    }

    p = 0;
    while (n < cap && (p = s.indexOf("beginbfrange", p)) > -1) {
      q = s.indexOf("endbfrange", p);
      if (q < 0) q = s.length;
      var rb = s.slice(p, q);
      var re2 = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[)/g, m2;
      while (n < cap && (m2 = re2.exec(rb))) {
        var lo = parseInt(m2[1], 16), hi = parseInt(m2[2], 16);
        if (m2[3].charAt(0) === "<") {
          if (hi < lo) continue;
          if (hi - lo > 65535) hi = lo + 65535;
          var dst = hexUni(m2[3].slice(1, -1));
          for (var c = lo; c <= hi && n < cap; c++, n++) map[c] = shiftUni(dst, c - lo);
        } else {
          /* 形式二：目标是一串数组项，按顺序从 lo 起排 */
          var from = m2.index + m2[0].length;
          var close = rb.indexOf("]", from);
          var items = (rb.slice(from, close < 0 ? rb.length : close).match(/<[0-9a-fA-F]*>/g) || []);
          for (var k = 0; k < items.length && n < cap; k++, n++) {
            map[lo + k] = hexUni(items[k].slice(1, -1));
          }
        }
      }
      p = q + 10;
    }
    return map;
  }

  /* 内容流的取词：只需要认得 Tj / TJ / ' / " 四个显示算子，
     外加 Td、TD、T-star、Tm 用来判断换行。其它算子读了就丢。 */
  function pdfContentText(s, fonts, stat) {
    var out = [], ops = [], font = null, size = 12, lead = 0;
    var x = 0, y = 0, lastY = null, i = 0, n = s.length;
    /* 兜底：解析的是别人的文件，宁可少抽几段文字，也绝不能让畸形 PDF
       把浏览器卡死。正常情况下每轮至少吃掉一个字符，这个上限碰不到。 */
    var steps = 0, maxSteps = n * 2 + 10000;

    /* 这两个判据收的是「字符码」不是字符——传错类型的话永远返回假，
       整个内容流会被当成一个算子囫囵吞掉（这个坑栽过一次）。 */
    function isWs(c) { return c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 0; }
    function isDelim(c) {
      return isWs(c) || c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 ||
        c === 123 || c === 125 || c === 47 || c === 37;
    }
    function operand(v) {
      var t = ops[ops.length - 1];
      if (Array.isArray(t)) t.push(v); else ops.push(v);
    }
    function nl() { if (out.length && out[out.length - 1] !== "\n") out.push("\n"); }
    function line(y2) {
      if (lastY !== null && Math.abs(y2 - lastY) > Math.max(2, size * 0.35)) nl();
    }
    function decStr(str) {
      if (font && font.uni) {                    // 双字节码即 Unicode 码点
        var ru = "";
        for (var u2 = 0; u2 + 1 < str.length; u2 += 2) {
          var cu = (str.charCodeAt(u2) << 8) | str.charCodeAt(u2 + 1);
          if (cu) { ru += String.fromCharCode(cu); stat.mapped++; }
        }
        return ru;
      }
      if (!font || !font.map) {
        if (font && font.two) { stat.unmapped += str.length; return ""; }
        var r0 = "";
        for (var i2 = 0; i2 < str.length; i2++) {
          var cc = str.charCodeAt(i2);
          if (cc >= 32 && cc < 127) r0 += str.charAt(i2);
          else if (cc >= 0xa0) r0 += str.charAt(i2);
        }
        stat.plain += r0.length;
        return r0;
      }
      var r = "";
      if (font.two) {
        for (var a = 0; a + 1 < str.length; a += 2) {
          var code = (str.charCodeAt(a) << 8) | str.charCodeAt(a + 1);
          var v = font.map[code];
          if (v === undefined) stat.unmapped++; else { r += v; stat.mapped++; }
        }
      } else {
        for (var j = 0; j < str.length; j++) {
          var c2 = str.charCodeAt(j), v2 = font.map[c2];
          if (v2 !== undefined) { r += v2; stat.mapped++; }
          else if (c2 >= 32 && c2 < 127) { r += str.charAt(j); stat.plain++; }
          else if (c2 >= 0xa0) { r += str.charAt(j); stat.plain++; }
          else stat.unmapped++;
        }
      }
      return r;
    }
    function emit(t) {
      if (!t) return;
      line(y);
      lastY = y;
      out.push(t);
    }

    while (i < n) {
      if (++steps > maxSteps) break;
      var ch = s.charAt(i);
      if (isWs(s.charCodeAt(i))) { i++; continue; }
      if (ch === "%") { while (i < n && s.charAt(i) !== "\n") i++; continue; }

      if (ch === "(") {                                   // 字面串
        var depth = 0, r = "";
        i++;
        while (i < n) {
          var c = s.charAt(i);
          if (c === "\\") {
            var e = s.charAt(i + 1);
            if (e === "n") { r += "\n"; i += 2; }
            else if (e === "r") { r += "\r"; i += 2; }
            else if (e === "t") { r += "\t"; i += 2; }
            else if (e === "b" || e === "f") { i += 2; }
            else if (e === "(" || e === ")" || e === "\\") { r += e; i += 2; }
            else if (e >= "0" && e <= "7") {
              var om = /^[0-7]{1,3}/.exec(s.slice(i + 1));
              r += String.fromCharCode(parseInt(om ? om[0] : "0", 8));
              i += 1 + (om ? om[0].length : 1);
            } else if (e === "\r") { i += s.charAt(i + 2) === "\n" ? 3 : 2; }
            else if (e === "\n") { i += 2; }
            else { r += e; i += 2; }
            continue;
          }
          if (c === "(") { depth++; r += c; i++; continue; }
          if (c === ")") { if (!depth) { i++; break; } depth--; r += c; i++; continue; }
          r += c; i++;
        }
        operand(r);
        continue;
      }

      if (ch === "<") {
        if (s.charAt(i + 1) === "<") {                     // 字典（内容流里少见，整段跳过）
          var dep = 0;
          while (i < n) {
            if (s.charAt(i) === "<" && s.charAt(i + 1) === "<") { dep++; i += 2; }
            else if (s.charAt(i) === ">" && s.charAt(i + 1) === ">") { dep--; i += 2; if (!dep) break; }
            else i++;
          }
          continue;
        }
        var j2 = s.indexOf(">", i);
        if (j2 < 0) j2 = n;
        var h = s.slice(i + 1, j2).replace(/[^0-9a-fA-F]/g, "");
        if (h.length % 2) h += "0";
        var hv = "";
        for (var k3 = 0; k3 < h.length; k3 += 2) hv += String.fromCharCode(parseInt(h.substr(k3, 2), 16));
        operand(hv);
        i = j2 + 1;
        continue;
      }

      if (ch === "[") { ops.push([]); i++; continue; }
      if (ch === "]") { i++; continue; }

      if (ch === "/") {                                    // 名字对象
        var j3 = i + 1, nm = "";
        while (j3 < n && !isDelim(s.charCodeAt(j3))) { nm += s.charAt(j3); j3++; }
        ops.push("/" + nm);
        i = j3;
        continue;
      }

      var c1 = s.charCodeAt(i);
      if (ch === "-" || ch === "+" || ch === "." || (c1 >= 48 && c1 <= 57)) {
        var j4 = i + 1;
        while (j4 < n && !isDelim(s.charCodeAt(j4))) j4++;
        var num = parseFloat(s.slice(i, j4));
        operand(isNaN(num) ? 0 : num);
        i = j4;
        continue;
      }

      var j5 = i;                                          // 算子
      while (j5 < n && !isDelim(s.charCodeAt(j5))) j5++;
      /* 孤立的分隔符（')' '>' '{' '}' 这些我们没专门处理的）会读出一个空算子，
         下标不推进就成了死循环——必须在这里吃掉一个字符。 */
      if (j5 === i) { i++; ops = []; continue; }
      var op = s.slice(i, j5);
      i = j5;

      if (op === "BI") {                                   // 内联图像：跳过二进制段
        var ei = /\sEI[\s]/.exec(s.slice(i));
        i = ei ? i + ei.index + 3 : n;
        ops = [];
        continue;
      }
      if (op === "Tf") {
        var fp = ops[ops.length - 2], fsz = ops[ops.length - 1];
        if (typeof fp === "string" && fp.charAt(0) === "/") font = fonts[fp.slice(1)] || null;
        if (typeof fsz === "number" && fsz > 0) size = fsz;
      } else if (op === "Tj" || op === "TJ" || op === "'" || op === "\"") {
        if (op === "'" || op === "\"") { y -= lead; nl(); }
        var arg = ops[ops.length - 1];
        if (typeof arg === "string") emit(decStr(arg));
        else if (Array.isArray(arg)) {
          var acc = "";
          for (var a2 = 0; a2 < arg.length; a2++) {
            if (typeof arg[a2] === "string") acc += decStr(arg[a2]);
            else if (typeof arg[a2] === "number" && arg[a2] <= -160) acc += " ";
          }
          emit(acc);
        }
      } else if (op === "Tm") {
        var ty = ops[ops.length - 1], tx = ops[ops.length - 2];
        if (typeof ty === "number") y = ty;
        if (typeof tx === "number") x = tx;
      } else if (op === "Td" || op === "TD") {
        var dy = ops[ops.length - 1], dx = ops[ops.length - 2];
        if (typeof dy === "number") { y += dy; if (op === "TD") lead = -dy; }
        if (typeof dx === "number") x += dx;
        nl();
      } else if (op === "T*") {
        y -= lead;
        nl();
      } else if (op === "TL") {
        var lv = ops[ops.length - 1];
        if (typeof lv === "number") lead = lv;
      } else if (op === "Do" && stat.depth < 2) {
        /* 表单 XObject 里也常有正文，往下走一层 */
        var xn = ops[ops.length - 1];
        var xo = typeof xn === "string" && xn.charAt(0) === "/" ? stat.xobjs[xn.slice(1)] : null;
        if (xo) {
          var ds2 = pdfStream(stat.objs, xo);
          if (ds2) {
            var sub = { depth: stat.depth + 1, xobjs: stat.xobjs, objs: stat.objs,
              mapped: 0, plain: 0, unmapped: 0 };
            var inner = pdfContentText(latin1(ds2), fonts, sub);
            stat.mapped += sub.mapped; stat.plain += sub.plain; stat.unmapped += sub.unmapped;
            if (inner) emit(inner);
          }
        }
      }
      ops = [];
    }
    return out.join("");
  }

  function pdfExtract(buf) {
    var src = latin1(buf), objs = {}, order = [], m;
    var re = /(\d+)[ \t\r\n]+(\d+)[ \t\r\n]+obj\b/g;
    var streamRe = /\bstream[ \t]*\r?\n/g;
    while ((m = re.exec(src))) {
      var q = m.index + m[0].length;
      var end = src.indexOf("endobj", q);
      if (end < 0) end = src.length;
      var rec = { num: +m[1], dict: "", raw: null };
      streamRe.lastIndex = q;
      var sm = streamRe.exec(src);
      if (sm && sm.index < end) {
        rec.dict = src.slice(q, sm.index);
        var ds = sm.index + sm[0].length;
        /* 流里可能有 endobj 字样，所以取到 endstream 为止，别被 endobj 截断 */
        var ee = src.indexOf("endstream", ds);
        if (ee < 0 || ee < ds) ee = end;
        rec.raw = buf.subarray(ds, ee);
        end = Math.max(end, ee + 9);
      } else {
        rec.dict = src.slice(q, end);
      }
      if (!objs[rec.num]) order.push(rec.num);
      objs[rec.num] = rec;
      re.lastIndex = end;
    }
    if (!order.length) throw new Error("读不出 PDF 结构（文件可能损坏或加密）");
    if (/\/Encrypt\b/.test(src)) throw new Error("这份 PDF 有加密，请先解除限制再分析");

    /* 对象流：PDF 1.5 之后常见，一批小对象被压在同一个流里 */
    order.slice().forEach(function (num) {
      var r = objs[num];
      if (!r.raw || !/\/Type\s*\/ObjStm/.test(r.dict)) return;
      var d = pdfStream(objs, r);
      if (!d) return;
      var s = latin1(d);
      var n = +((/\/N\s*(\d+)/.exec(r.dict) || [0, 0])[1]);
      var first = +((/\/First\s*(\d+)/.exec(r.dict) || [0, 0])[1]);
      var head = s.slice(0, first).trim().split(/\s+/);
      for (var i = 0; i < n; i++) {
        var num2 = +head[i * 2], off = +head[i * 2 + 1];
        if (!num2 || objs[num2]) continue;
        var a = first + off;
        var b = head[i * 2 + 3] !== undefined ? first + (+head[i * 2 + 3]) : s.length;
        objs[num2] = { num: num2, dict: s.slice(a, b), raw: null };
      }
    });

    function pick(dict, key) {
      var rk = new RegExp("/" + key + "\\s*");
      var mm = rk.exec(dict);
      if (!mm) return "";
      var p = mm.index + mm[0].length;
      if (dict.substr(p, 2) === "<<") {
        var dep = 0, j = p;
        while (j < dict.length) {
          if (dict.substr(j, 2) === "<<") { dep++; j += 2; }
          else if (dict.substr(j, 2) === ">>") { dep--; j += 2; if (!dep) return dict.slice(p, j); }
          else j++;
        }
        return dict.slice(p);
      }
      var rm = /^(\d+)\s+\d+\s+R/.exec(dict.slice(p));
      return rm && objs[+rm[1]] ? objs[+rm[1]].dict : "";
    }

    var fontCache = {};
    var UNIENC = /-(UTF16|UCS2)-/;            // UniGB-UTF16-H / UniJIS-UCS2-V …
    function fontOf(num) {
      if (fontCache[num]) return fontCache[num];
      var r = objs[num], info = { two: false, map: null, uni: false };
      if (r) {
        info.two = /\/Subtype\s*\/Type0/.test(r.dict);
        var tm = /\/ToUnicode\s*(\d+)\s+\d+\s+R/.exec(r.dict);
        if (tm && objs[+tm[1]]) {
          var d2 = pdfStream(objs, objs[+tm[1]]);
          if (d2) info.map = parseCMap(latin1(d2));
        }
        /* Type0 若用的是 Unicode 编码的 CMap（国内期刊 PDF 常这么写），
           双字节码本身就是码点，不需要 ToUnicode——当无映射丢掉就全空了。 */
        if (info.two && !info.map) {
          var em = /\/Encoding\s*(\/[A-Za-z0-9\-]+|\d+\s+\d+\s+R)/.exec(r.dict);
          var encl = em ? em[1] : "";
          if (/^\d/.test(encl)) {
            var er = /^(\d+)/.exec(encl);
            encl = objs[+er[1]] ? objs[+er[1]].dict : "";
          }
          if (UNIENC.test(encl)) info.uni = true;
        }
      }
      fontCache[num] = info;
      return info;
    }

    var pages = [], stat = { mapped: 0, plain: 0, unmapped: 0, depth: 0, xobjs: {}, objs: objs };
    order.forEach(function (num) {
      var r = objs[num];
      if (!r || !/\/Type\s*\/Page(?![\w])/.test(r.dict)) return;
      var res = pick(r.dict, "Resources");
      var fonts = {};
      var fm2 = /\/Font\s*<<([\s\S]*?)>>/.exec(res);
      var xobjs = {};
      var xm = /\/XObject\s*<<([\s\S]*?)>>/.exec(res);
      if (xm) {
        var xr = /\/([^\s\/<>\[\]]+)\s+(\d+)\s+\d+\s+R/g, xmm;
        while ((xmm = xr.exec(xm[1]))) xobjs[xmm[1]] = objs[+xmm[2]];
      }
      if (fm2) {
        var fr = /\/([^\s\/<>\[\]]+)\s+(\d+)\s+\d+\s+R/g, fmm;
        while ((fmm = fr.exec(fm2[1]))) fonts[fmm[1]] = fontOf(+fmm[2]);
      }
      var cm = /\/Contents\s*(\[[\s\S]*?\]|\d+\s+\d+\s+R)/.exec(r.dict);
      if (!cm) return;
      var refs = [], rr = /(\d+)\s+\d+\s+R/g, rrm;
      while ((rrm = rr.exec(cm[1]))) refs.push(+rrm[1]);
      var parts = [];
      refs.forEach(function (k) {
        var d3 = pdfStream(objs, objs[k]);
        if (d3) parts.push(latin1(d3));
      });
      if (!parts.length) return;
      stat.depth = 0;
      stat.xobjs = xobjs;
      var txt = pdfContentText(parts.join("\n"), fonts, stat);
      if (txt) pages.push(txt);
    });

    return {
      text: pages.join("\n\n"),
      pages: pages.length,
      mapped: stat.mapped,
      plain: stat.plain,
      unmapped: stat.unmapped
    };
  }

  /* 抽出来的文字先归一：去掉控制符、压缩空行，再把汉字之间被 PDF 生成器
     塞进来的空格抹掉——否则「剩余价值」会被拆成「剩 余 价 值」，术语识别全废。 */
  function tidyText(t, joinCJK) {
    var r = t
      .replace(/\r\n?/g, "\n")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ");
    if (joinCJK) {
      r = r.replace(/([\u3000-\u30ff\u3400-\u9fff\uff00-\uffef])[ \t]+(?=[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef])/g, "$1");
    }
    return r.replace(/^\s+|\s+$/g, "");
  }

  function decodeBytes(b) {
    var s = "";
    try { s = new TextDecoder("utf-8").decode(b); } catch (e) { s = ""; }
    var bad = (s.match(/\uFFFD/g) || []).length;
    if (bad && bad / Math.max(1, s.length) > 0.002) {
      try {
        var g = new TextDecoder("gbk").decode(b);
        if ((g.match(/\uFFFD/g) || []).length < bad) s = g;
      } catch (e2) { /* 环境不支持 GBK 就保持 UTF-8 的结果 */ }
    }
    return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
  }

  function fileKind(name, b) {
    var ext = (/\.([a-z0-9]+)$/i.exec(name || "") || ["", ""])[1].toLowerCase();
    if (ext === "docx" || ext === "docm") return "docx";
    if (ext === "pdf") return "pdf";
    if (ext === "doc") return "docold";
    if (ext === "zip") return "zip";
    if (ext === "txt" || ext === "md" || ext === "markdown" || ext === "csv" || ext === "text" ||
        ext === "log" || ext === "rtf") return "text";
    /* 后缀不认识就按特征嗅：%PDF 是 PDF，PK 是 ZIP（多数情况就是 docx） */
    if (b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "pdf";
    if (b.length > 3 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03) return "zip";
    return "text";
  }

  function fmtBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }
  function fmtCount(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function readAsBuffer(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(new Uint8Array(fr.result)); };
      fr.onerror = function () { rej(new Error("浏览器读不出这个文件")); };
      try { fr.readAsArrayBuffer(file); } catch (e) { rej(e); }
    });
  }

  /* 把一份文件变成 {text, meta, warn}。所有异常都在这里收口成可读的一句话。 */
  function fileToText(name, buf) {
    var kind = fileKind(name, buf);
    var size = fmtBytes(buf.length);
    if (kind === "docold") {
      throw new Error("旧版 .doc 是二进制格式，浏览器里解不开——请用 Word 另存为 .docx 再传");
    }
    if (kind === "pdf") {
      var r = pdfExtract(buf);
      var t = tidyText(r.text, true);
      var chars = t.replace(/\s/g, "").length;
      var warn = "";
      var rate = r.unmapped / Math.max(1, r.unmapped + r.mapped);
      if (chars < 50) {
        warn = "这份 PDF 几乎没有文字层，多半是扫描件（整页是图片）——需要先做 OCR 才能分析其中的概念。";
      } else if (r.unmapped && rate > 0.25) {
        warn = "约 " + Math.round(rate * 100) + "% 的字形没有 Unicode 映射（字体未带 ToUnicode 表），抽出的文字可能不完整。";
      } else if (r.mapped + r.plain < 50) {
        warn = "没能读到字体映射表，抽出的文字可能不准，建议核对后再用。";
      }
      return { text: t, meta: size + " · " + (r.pages || 0) + " 页 · " + fmtCount(chars) + " 字",
        kind: "PDF", warn: warn, empty: chars < 50 };
    }
    if (kind === "docx" || kind === "zip") {
      var dt = tidyText(docxText(buf), true);
      var dc = dt.replace(/\s/g, "").length;
      if (!dc) throw new Error("这个 .docx 里没有可读的正文（可能损坏，或正文是图片）");
      return { text: dt, meta: size + " · " + fmtCount(dc) + " 字", kind: "Word", warn: "", empty: false };
    }
    var st = tidyText(decodeBytes(buf), false);
    return { text: st, meta: size + " · " + fmtCount(st.replace(/\s/g, "").length) + " 字",
      kind: /\.(csv|json)$/i.test(name) ? "数据" : "文本", warn: "", empty: false };
  }

  /* ---------------- 工具台 ----------------
     一条「读—写—记—讲」的线：这个站除了能查，还应当能干活。
     目前落地的是文本分析（概念识别 / 密度 / 覆盖诊断），
     其余在页面上以规划卡列出（名称 + 用途 + 适用场景），当作路线图。 */

  /* 概念识别用的名称池：词条名与别名按长度降序排。
     长名优先命中，命中过的位置用等长占位符盖住——否则「剩余价值率」
     会被再算一次「剩余价值」；占位符等长是为了不扰动后续匹配的下标。 */
  var NAME_POOL = (function () {
    var pool = [];
    TERMS.forEach(function (t) {
      [t.term].concat(t.alias || []).forEach(function (nm) {
        if (nm && nm.length >= 2) pool.push({ t: t, nm: nm });
      });
    });
    pool.sort(function (a, b) { return b.nm.length - a.nm.length; });
    return pool;
  })();

  /* 概念识别。语义与第一版一致（长名优先，命中处不再重复计数），
     但实现换了：老版每命中一次就 slice 出一个新字符串，整篇论文（十万字以上）
     进来会卡到几秒。现在用——
       ① 双字组位图预筛：先看这个词的头两个字在不在这段文字里，不在就整个跳过，
          这一层把九成以上的词条挡在 indexOf 之前；
       ② 命中位图 used[]：和长词重叠的位置直接判不命中，等价于老版的「盖住」，
          但不产生任何中间字符串。 */
  var BIGRAM_BITS = 1 << 21;
  var BIGRAM_MASK = BIGRAM_BITS - 1;
  var MAX_ANALYZE = 1500000;          // 单次分析的字数上限，超过只取前段并告知

  function analyzeConcepts(text) {
    if (text.length > MAX_ANALYZE) text = text.slice(0, MAX_ANALYZE);
    var n = text.length, hits = {}, used = new Uint8Array(n), i;
    var seen = new Uint8Array(BIGRAM_BITS >> 3);
    for (i = 0; i + 1 < n; i++) {
      var k = ((text.charCodeAt(i) * 1000033) ^ (text.charCodeAt(i + 1) * 31)) & BIGRAM_MASK;
      seen[k >> 3] |= 1 << (k & 7);
    }
    function mayHave(nm) {
      if (nm.length < 2) return n > 0 && text.indexOf(nm) > -1;
      var kk = ((nm.charCodeAt(0) * 1000033) ^ (nm.charCodeAt(1) * 31)) & BIGRAM_MASK;
      return !!(seen[kk >> 3] & (1 << (kk & 7)));
    }
    NAME_POOL.forEach(function (p) {                 // 已按长度降序，长名先占位
      var nm = p.nm, L = nm.length;
      if (!mayHave(nm)) return;
      var at = text.indexOf(nm);
      while (at > -1) {
        var free = true;
        for (var a = at; a < at + L; a++) if (used[a]) { free = false; break; }
        if (free) {
          for (var b = at; b < at + L; b++) used[b] = 1;
          hits[p.t.id] = (hits[p.t.id] || 0) + 1;
        }
        at = text.indexOf(nm, at + 1);
      }
    });
    return Object.keys(hits).map(function (id) {
      return { t: BY_ID[id], n: hits[id] };
    }).sort(function (a, b) {
      return b.n - a.n || (a.t.term < b.t.term ? -1 : a.t.term > b.t.term ? 1 : 0);
    });
  }

  function renderTextTool() {
    var box = document.getElementById("tt-input");
    var out = document.getElementById("tt-out");
    if (!box || !out) return;
    var raw = box.value || "";
    var chars = raw.replace(/\s/g, "").length;
    if (!chars) {
      out.innerHTML = '<p class="tool-hint">把一段文字粘进来，或者直接把文件拖到上面的框里——' +
        "论文段落、读原著时记的笔记、整篇 .docx 稿子、下载的 .pdf 论文都行。" +
        "会标出它命中了站内哪些概念、密度多高、哪些你还没读过。</p>";
      return;
    }
    var hits = analyzeConcepts(raw);
    if (!hits.length) {
      out.innerHTML = '<p class="tool-hint">这段文字没有命中站内 ' + TERMS.length +
        " 条词条中的任何一条。要么它是纯叙述，要么用的是本词典没收的表述——" +
        '可以到<a href="#/tags">标签页</a>换个说法找找。</p>';
      return;
    }

    var times = hits.reduce(function (a, h) { return a + h.n; }, 0);
    var covered = hits.reduce(function (a, h) { return a + h.t.term.length * h.n; }, 0);
    var density = covered / chars * 100;
    var readN = hits.filter(function (h) { return LR.isRead(h.t.id); }).length;

    /* 命中的概念落在哪个知识板块：看这段文字把力气花在哪一支上 */
    var dims = {};
    hits.forEach(function (h) {
      var k = catName(h.t.domain);
      dims[k] = (dims[k] || 0) + h.n;
    });
    var dimList = Object.keys(dims).sort(function (a, b) { return dims[b] - dims[a]; });

    out.innerHTML =
      (ttDocs.length
        ? '<p class="tt-src">分析对象：' + ttDocs.map(function (d) {
            return "<b>" + esc(d.name) + "</b>（" + esc(d.kind) + "，" + esc(d.meta) + "）";
          }).join(" ＋ ") + "</p>"
        : "") +
      (chars > MAX_ANALYZE
        ? '<p class="tool-hint">文稿较长，只分析了前 ' + fmtCount(MAX_ANALYZE) +
          " 字（全篇 " + fmtCount(chars) + " 字），后面的内容请分段看。</p>"
        : "") +
      '<div class="tt-sum">' +
        "<span><b>" + hits.length + "</b> 条术语命中</span>" +
        "<span><b>" + times + "</b> 次出现</span>" +
        "<span>术语占全文 <b>" + density.toFixed(1) + "%</b></span>" +
        "<span>其中 <b>" + readN + "</b> 条已读</span>" +
      "</div>" +
      /* v57：一键复制分析摘要——把上面的结论折成一段纯文本，贴进笔记或论文草稿直接用 */
      '<p class="ta-acts"><button type="button" class="tbtn" data-copy="' + esc(
        "【文本分析摘要】\n有效字数 " + chars + "；命中术语 " + hits.length + " 条，共出现 " + times +
          " 次，术语密度 " + density.toFixed(1) + "%；已读 " + readN + "/" + hits.length + "。\n" +
          "知识板块分布：" + dimList.map(function (k) { return k + " " + dims[k]; }).join(" · ") + "\n" +
          "高频术语：" + (hits.slice(0, 8).map(function (h) { return h.t.term + "×" + h.n; }).join("、") || "—")
      ) + '">复制分析摘要</button></p>' +
      '<table class="ta-tbl tt-tbl"><thead>' +
        "<tr><th>术语</th><th>频次</th><th>知识板块</th><th>状态</th></tr>" +
      "</thead><tbody>" +
        hits.map(function (h) {
          return "<tr>" +
            '<td><a href="#/t/' + esc(h.t.id) + '">' + esc(h.t.term) + "</a></td>" +
            "<td>" + h.n + "</td>" +
            '<td class="tt-dim">' + esc(catName(h.t.domain)) + "</td>" +
            "<td>" + (LR.isRead(h.t.id) ? "✓ 已读" : "未读") + "</td>" +
          "</tr>";
        }).join("") +
      "</tbody></table>" +
      '<p class="tt-dims">词条分布：' + dimList.map(function (k) {
        return "<span>" + esc(k) + " <b>" + dims[k] + "</b></span>";
      }).join("") + "</p>" +
      (readN < hits.length
        ? '<p class="tool-hint">这条路径上还有 ' + (hits.length - readN) +
          " 条术语你没标过已读——它们正是理解这段文字的门槛。</p>"
        : '<p class="tool-hint">命中的术语你都已经读过了。</p>');
  }

  /* ---- 载入文件：读 → 解析 → 追加到输入框 → 立即分析 ----
     文件不出本机：全程 FileReader，没有任何上传。 */

  var ttDocs = [];      // 已载入的文件，留着名字与文字，供「✕」精确摘除
  var ttText = "";      // 输入框正文。存在模块里而不是只在 DOM 里——
                        // 换页（比如点开某个词条看释义再回来）不该把分析对象丢掉。

  function ttGetText() {
    var box = document.getElementById("tt-input");
    return box ? box.value : ttText;
  }
  function ttSetText(v) {
    ttText = v;
    var box = document.getElementById("tt-input");
    if (box) box.value = v;
  }

  function ttMsg(html) {
    var el = document.getElementById("tt-filemsg");
    if (!el) return;
    el.innerHTML = html || "";
    el.hidden = !html;
  }

  function renderTtFiles() {
    var box = document.getElementById("tt-files");
    if (!box) return;
    if (!ttDocs.length) { box.innerHTML = ""; box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = ttDocs.map(function (d, i) {
      return '<span class="tt-chip' + (d.empty ? " bad" : "") + '">' +
        '<b>' + esc(d.name) + "</b>" +
        '<i>' + esc(d.kind) + " · " + esc(d.meta) + "</i>" +
        '<button type="button" data-act="tt-filedel" data-idx="' + i + '" title="移除这个文件">✕</button>' +
      "</span>";
    }).join("");
  }

  function ttAddDoc(rec) {
    ttDocs.push(rec);
    if (rec.text) {
      var cur = ttGetText();
      ttSetText(cur + (cur && !/\n$/.test(cur) ? "\n\n" : "") + rec.text);
    }
    renderTtFiles();
    renderTextTool();
    renderTa();
  }

  var FILE_LIMIT = 96 * 1024 * 1024;      // 解析是同步的，再大浏览器就转不动了
  var FILE_WARN = 16 * 1024 * 1024;       // 超过这个大小先打个招呼

  function ttLoad(files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    ttMsg("正在本机解析 " + list.length + " 个文件……");
    var left = list.length;
    /* 解析是同步的，超大文件会把页面顶住几秒——先说清楚，别让人以为死机了 */
    function done() { if (--left <= 0 && !document.querySelector("#tt-filemsg .warn")) ttMsg(""); }

    list.forEach(function (f) {
      if (f.size > FILE_LIMIT) {
        ttAddDoc({ name: f.name, kind: "文件过大", meta: fmtBytes(f.size), text: "", empty: true });
        ttMsg('<span class="warn">' + esc(f.name) + "：超过 " + fmtBytes(FILE_LIMIT) +
          "，浏览器里解析不动——请先在本地拆成几份再传。</span>");
        done();
        return;
      }
      if (f.size > FILE_WARN) ttMsg("「" + esc(f.name) + "」有 " + fmtBytes(f.size) + "，解析要花上几秒……");
      readAsBuffer(f).then(function (buf) {
        try {
          var r = fileToText(f.name, buf);
          ttAddDoc({ name: f.name, kind: r.kind, meta: r.meta, text: r.text, empty: r.empty });
          if (r.warn) ttMsg('<span class="warn">' + esc(f.name) + "：" + esc(r.warn) + "</span>");
          else ttMsg("");
        } catch (e) {
          ttAddDoc({ name: f.name, kind: "无法读取", meta: fmtBytes(f.size), text: "", empty: true });
          ttMsg('<span class="warn">' + esc(f.name) + "：" + esc((e && e.message) || "解析失败") + "</span>");
        }
        done();
      }, function (e) {
        ttAddDoc({ name: f.name, kind: "无法读取", meta: fmtBytes(f.size), text: "", empty: true });
        ttMsg('<span class="warn">' + esc(f.name) + "：" + esc((e && e.message) || "读取失败") + "</span>");
        done();
      });
    });
  }

  /* 移除一份文件：连它带进来的那段文字一起摘掉。
     文字若已被手工编辑过（找不到原段），只摘标签、不动正文，并说明原因。 */
  function ttDrop(i) {
    var d = ttDocs[i];
    if (!d) return;
    ttDocs.splice(i, 1);
    if (d.text) {
      var cur = ttGetText();
      var at = cur.indexOf(d.text);
      if (at > -1) {
        ttSetText((cur.slice(0, at) + cur.slice(at + d.text.length))
          .replace(/\n{3,}/g, "\n\n").replace(/^\s+|\s+$/g, ""));
      } else {
        ttMsg("「" + esc(d.name) + "」带进来的文字已被编辑过，为避免误删，正文保持原样。");
      }
    }
    renderTtFiles();
    renderTextTool();
    renderTa();
  }

  function ttChoose() {
    var f = document.getElementById("tt-file");
    if (f) f.click();
  }

  /* ================= 文本分析：进阶五件 =================
     分词与词频 · 关联性分析 · 聚类网络图 · 情感分析 · 多文本比对。
     零依赖约束不变：分词是离线词典的最大匹配（与 jieba 精确模式同一思路，
     词典 = 站内术语 + 别名 + 内置常用词表）；xlsx 导出是自写的 STORE 版 ZIP
     ＋最小 OOXML——不联网、不引库。所有结果画成表格，每块可单独导出 xlsx。 */

  /* —— 内置常用词表（双字为主）：学术文本里高频、又不属于术语的词。
     停用词（的、了、与……）匹配到也不进词频表。 —— */
  var TA_STOP = "的 了 和 与 及 或 是 在 于 由 从 被 把 将 向 而 这 那 之 其 也 又 就 不 没 为 以 因为 所以 但是 然而 如果 虽然 因此 于是 并且 而且 只有 只要 无论 即使 既 才 更 很 都 还 再 各 每 些 个 件 种 类 等 中 上 下 里 外 前 后 时 地 得 着 过 者 一 二 三 四 五 六 七 八 九 十";
  var TA_LEX = "社会经济政治历史文化科学技术研究分析方法理论实践思想观点问题概念范畴规律结构系统功能性质本质现象形式内容过程状态条件因素结果影响意义价值意识观念认识知识经验事实真理逻辑推理判断概括抽象具体普遍特殊一般个别整体部分关系联系区别对立统一矛盾运动变化发展产生形成消失存在物质精神自然人工劳动生产消费分配交换流通市场价格成本利润工资资本货币财富商品需要需求供给效率效果效益质量数量速度规模水平程度范围领域层面阶段时期时代现代近代古代传统未来现在过去国家政府民族人民群众阶级工人农民学者作者读者人类世界中国外国国际国内现实理想目标手段途径道路方向原则立场态度方式风格特征特点重点难点热点起点终点历史观方法论世界观实践观日常体力脑力简单复杂必要剩余自由必然自觉异化对象化物化外化内化感性与理性归纳演绎比较分类观察实验调查统计样本变量数据模型假设验证证伪证明论证反驳批判继承扬弃超越反思总结提炼升华转化过渡中介桥梁纽带基础前提依据根据来源出处背景环境语境情境场景场合氛围起点终点";
  var TA_STOPSET = (function () {
    var st = {};
    TA_STOP.split(" ").forEach(function (w) { st[w] = 1; });
    return st;
  })();
  var TA_DICT = (function () {
    var seen = {}, lex = [];
    TA_LEX.match(/.{2}/g).forEach(function (w) { if (!seen[w] && !TA_STOPSET[w]) { seen[w] = 1; lex.push(w); } });
    var d = {};
    function add(w, id) {
      var c = w.charAt(0);
      (d[c] = d[c] || []).push([w, id || ""]);
    }
    NAME_POOL.forEach(function (p) { add(p.nm, p.t.id); });
    lex.forEach(function (w) { add(w, ""); });
    Object.keys(d).forEach(function (c) {
      d[c].sort(function (a, b) { return b[0].length - a[0].length; });
    });
    return d;
  })();

  /* 一遍扫描：词典最长匹配（术语优先、长词优先）。
     返回 freq（词→{n, kind, id}）、termPos（术语出现位置，供关联分析）、unk（未成词字数）。 */
  function taSeg(text) {
    var freq = {}, termPos = [], unk = 0, n = text.length;
    for (var p = 0; p < n;) {
      var ch = text.charAt(p);
      if (/[\s，。、；：！？：“”（）《》〈〉【】——…·\-,.;:!?"'()<>\[\]{}]/.test(ch)) { p++; continue; }
      var cands = TA_DICT[ch], hit = null;
      if (cands) {
        for (var c = 0; c < cands.length; c++) {
          var w = cands[c][0];
          if (p + w.length <= n && text.substr(p, w.length) === w) { hit = cands[c]; break; }
        }
      }
      if (hit) {
        var w0 = hit[0], id = hit[1];
        var rec = freq[w0];
        if (!rec) rec = freq[w0] = { n: 0, kind: id ? "term" : "lex", id: id };
        rec.n++;
        if (id) termPos.push({ id: id, at: p });
        p += w0.length;
      } else { unk++; p++; }
    }
    return { freq: freq, termPos: termPos, unk: unk };
  }

  /* —— 情感词典：通用正面 / 负面词各约百条。只做词面计数，不装作懂语义——
     表里给出命中词，反讽、否定（「不自由」仍数到「自由」）须人工复核。 —— */
  var TA_POS = "发展 提高 完善 增强 促进 推动 改善 好转 繁荣 进步 创新 成功 优越 富裕 丰富 充实 自由 解放 团结 合作 共赢 稳定 安全 幸福 满意 肯定 支持 赞成 拥护 赞扬 光明 积极 主动 勤奋 奋斗 进取 担当 奉献 无私 正义 公平 公正 民主 法治 文明 和谐 健康 活力 生机 强大 巩固 壮大 提升 扩大 深化 优化 良性 可持续 造福 增进 保障 成就 胜利 前进 崛起 振兴 复兴 觉醒 觉悟 自觉 自信 自豪 骄傲 光荣 伟大 正确 科学 合理 有效 有利 有益 宝贵 重要 先进 模范 乐观 信心 希望 梦想 潜力 动力 魄力 能力 实力";
  var TA_NEG = "剥削 压迫 压榨 剥夺 侵占 掠夺 盘剥 榨取 奴役 镇压 专横 独裁 专制 腐败 腐朽 堕落 贪婪 自私 冷漠 麻木 愚昧 落后 贫穷 贫困 匮乏 饥饿 失业 破产 危机 萧条 衰退 崩溃 瓦解 动荡 冲突 战争 暴力 屠杀 灾难 苦难 痛苦 悲惨 凄惨 绝望 悲观 消极 颓废 麻痹 欺骗 谎言 虚伪 伪善 欺压 歧视 不公 冤屈 屈辱 苦役 疲惫 焦虑 恐惧 担忧 忧虑 不满 愤怒 抗议 反抗 敌对 恶化 加剧 严峻 恶劣 残酷 惨重 深重 沉重 束缚 桎梏 枷锁 牺牲代价 悲剧 苦楚 辛酸 血汗";
  var TA_SENTLEX = (function () {
    var pos = {}, neg = {};
    TA_POS.split(" ").forEach(function (w) { if (w.length >= 2) pos[w] = 1; });
    TA_NEG.split(" ").forEach(function (w) { if (w.length >= 2) neg[w] = 1; });
    return { pos: pos, neg: neg };
  })();
  function taCountLex(para, dict) {
    var n = 0, hits = [];
    Object.keys(dict).forEach(function (w) {
      var at = para.indexOf(w), c = 0;
      while (at > -1) { c++; at = para.indexOf(w, at + w.length); }
      if (c) { n += c; hits.push([w, c]); }
    });
    hits.sort(function (a, b) { return b[1] - a[1]; });
    return { n: n, hits: hits };
  }

  /* —— 主计算：一次算齐五件的结果，存进 TA_RES 供渲染与导出 —— */
  var TA_RES = null;

  function taCompute(raw) {
    var text = raw || "";
    if (text.length > MAX_ANALYZE) text = text.slice(0, MAX_ANALYZE);
    var chars = text.replace(/\s/g, "").length;
    if (!chars) return null;

    /* ① 分词 + 词频（术语层长名优先：分词词典本身按长度降序） */
    var seg = taSeg(text);
    var freqRows = Object.keys(seg.freq).map(function (w) {
      var r = seg.freq[w];
      return { w: w, kind: r.kind === "term" ? "术语" : "一般词", n: r.n, id: r.id };
    }).sort(function (a, b) { return b.n - a.n || (a.w < b.w ? -1 : 1); });
    var termsRows = freqRows.filter(function (r) { return !!r.id; });
    var lexN = freqRows.reduce(function (a, r) { return a + (r.id ? 0 : r.n); }, 0);
    var termN = freqRows.reduce(function (a, r) { return a + (r.id ? r.n : 0); }, 0);
    var freqById = {};
    termsRows.forEach(function (r) { freqById[r.id] = r.n; });

    /* ② 关联性分析：句内共现（以。！？；和换行分句） */
    var sentOf = new Int32Array(text.length);
    var sentCount = 0;
    for (var i = 0; i < text.length; i++) {
      sentOf[i] = sentCount;
      if (/[。！？；!?\n]/.test(text.charAt(i))) sentCount++;
    }
    if (text.length && sentOf[text.length - 1] >= sentCount) sentCount++;
    var sentTerms = [];
    seg.termPos.forEach(function (o) {
      var si = sentOf[o.at];
      (sentTerms[si] = sentTerms[si] || {})[o.id] = 1;
    });
    var pair = {}, nA = {};
    for (var s = 0; s < sentTerms.length; s++) {
      var ids = sentTerms[s] ? Object.keys(sentTerms[s]) : [];
      ids.forEach(function (id) { nA[id] = (nA[id] || 0) + 1; });
      for (var a = 0; a < ids.length; a++)
        for (var b = a + 1; b < ids.length; b++) {
          var k1 = ids[a] < ids[b] ? ids[a] + "|" + ids[b] : ids[b] + "|" + ids[a];
          pair[k1] = (pair[k1] || 0) + 1;
        }
    }
    var S = Math.max(1, sentCount);
    var relRows = Object.keys(pair).map(function (k) {
      var ab = k.split("|"), co = pair[k];
      var lift = co * S / Math.max(1, (nA[ab[0]] || 1) * (nA[ab[1]] || 1));
      return { a: BY_ID[ab[0]] ? BY_ID[ab[0]].term : ab[0], b: BY_ID[ab[1]] ? BY_ID[ab[1]].term : ab[1],
        co: co, lift: lift, ida: ab[0], idb: ab[1] };
    }).sort(function (x, y) { return y.co - x.co || y.lift - x.lift; });

    /* ③ 聚类网络图：词频前 24 的术语，共现 ≥2 连边，连通分量着色 */
    var NODE_N = 24;
    var nodes = termsRows.slice(0, NODE_N).map(function (r) { return r.id; });
    var inNet = {}; nodes.forEach(function (id) { inNet[id] = 1; });
    var edges = relRows.filter(function (r) { return inNet[r.ida] && inNet[r.idb] && r.co >= 2; }).slice(0, 60);
    if (edges.length < 3) {
      /* 共现 ≥2 的词对太少（短文本常态）：用共现 ≥1 的补足，图才连得起来 */
      edges = relRows.filter(function (r) { return inNet[r.ida] && inNet[r.idb]; }).slice(0, 40);
    }
    var uf = {};
    nodes.forEach(function (id) { uf[id] = id; });
    function find(x) { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; }
    edges.forEach(function (e) { uf[find(e.ida)] = find(e.idb); });
    var clusters = {};
    nodes.forEach(function (id) {
      var r = find(id);
      (clusters[r] = clusters[r] || []).push(id);
    });
    var cluNo = {}, cluN = 0;
    Object.keys(clusters).sort(function (a, b) { return clusters[b].length - clusters[a].length; })
      .forEach(function (k) { cluNo[k] = ++cluN; });
    /* 布局：圆周初始化 + 斥力弹簧 160 轮（n≤24，O(n²) 无所谓） */
    var P = nodes.map(function (_, i) {
      var ang = i / Math.max(1, nodes.length) * Math.PI * 2;
      return { x: 320 + 130 * Math.cos(ang), y: 185 + 120 * Math.sin(ang) };
    });
    var ED = edges.map(function (e) {
      return { a: nodes.indexOf(e.ida), b: nodes.indexOf(e.idb), co: e.co };
    });
    for (var it = 0; it < 160; it++) {
      var fx = nodes.map(function () { return 0; }), fy = fx.slice();
      for (var m = 0; m < nodes.length; m++)
        for (var q = m + 1; q < nodes.length; q++) {
          var dx = P[m].x - P[q].x, dy = P[m].y - P[q].y;
          var d2 = dx * dx + dy * dy, d = Math.sqrt(d2) || 0.01;
          var f = 2600 / d2;
          fx[m] += dx / d * f; fy[m] += dy / d * f;
          fx[q] -= dx / d * f; fy[q] -= dy / d * f;
        }
      ED.forEach(function (e) {
        var dx = P[e.b].x - P[e.a].x, dy = P[e.b].y - P[e.a].y;
        var d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        var f = (d - 95) * 0.03 * Math.min(3, Math.sqrt(e.co));
        fx[e.a] += dx / d * f; fy[e.a] += dy / d * f;
        fx[e.b] -= dx / d * f; fy[e.b] -= dy / d * f;
      });
      for (var m2 = 0; m2 < nodes.length; m2++) {
        fx[m2] += (320 - P[m2].x) * 0.012; fy[m2] += (185 - P[m2].y) * 0.012;
        P[m2].x = Math.max(45, Math.min(595, P[m2].x + Math.max(-8, Math.min(8, fx[m2]))));
        P[m2].y = Math.max(32, Math.min(338, P[m2].y + Math.max(-8, Math.min(8, fy[m2]))));
      }
    }
    var PALETTE = ["#8f2d2d", "#2d5f8f", "#3d7a45", "#8a6d1f", "#6b3d8f", "#2d7a7a", "#8f4a2d", "#4a5568"];

    /* ④ 情感分析：按自然段计数 */
    var paras = text.split(/\n+/).map(function (x) { return x.trim(); })
      .filter(function (x) { return x.length >= 4; }).slice(0, 200);
    var sentRows = [], posAll = 0, negAll = 0;
    paras.forEach(function (para, i) {
      var p = taCountLex(para, TA_SENTLEX.pos), ng = taCountLex(para, TA_SENTLEX.neg);
      posAll += p.n; negAll += ng.n;
      sentRows.push({
        i: i + 1, head: para.slice(0, 14) + (para.length > 14 ? "…" : ""),
        pos: p.n, neg: ng.n, hitsP: p.hits.slice(0, 4), hitsN: ng.hits.slice(0, 4),
        score: (p.n + ng.n) ? (p.n - ng.n) / (p.n + ng.n) : null
      });
    });

    /* ⑤ 多文本比对：多文件优先，否则把长文按空行拆段 */
    var docs = ttDocs.filter(function (d) { return d.text && !d.empty; })
      .map(function (d) { return { name: d.name, text: d.text }; });
    var byDocs = docs.length >= 2;
    if (!byDocs) {
      docs = paras.filter(function (x) { return x.length >= 80; }).slice(0, 6)
        .map(function (x, i) { return { name: "段落 " + (i + 1), text: x }; });
    }
    var cmpRows = null, simRows = null;
    if (docs.length >= 2) {
      cmpRows = docs.map(function (d) {
        var c = d.text.replace(/\s/g, "").length;
        var sg = taSeg(d.text);
        var tN = 0, top = [];
        Object.keys(sg.freq).forEach(function (w) {
          var r = sg.freq[w];
          if (r.kind !== "term") return;
          tN += r.n;
          top.push([w, r.n]);
        });
        top.sort(function (x, y) { return y[1] - x[1]; });
        var p = taCountLex(d.text, TA_SENTLEX.pos), ng = taCountLex(d.text, TA_SENTLEX.neg);
        return { name: d.name, chars: c, terms: tN, density: c ? tN * 100 / c : 0,
          pos: p.n, neg: ng.n,
          top: top.slice(0, 3).map(function (x) { return x[0] + "×" + x[1]; }).join("、") || "—",
          vec: (function () {
            var v = {};
            Object.keys(sg.freq).forEach(function (w) {
              if (sg.freq[w].kind === "term") v[w] = sg.freq[w].n;
            });
            return v;
          })() };
      });
      simRows = cmpRows.map(function (r1, i1) {
        return cmpRows.map(function (r2, i2) {
          if (i1 === i2) return -1;                       // 对角线，渲染为 —
          var dot = 0, m1 = 0, m2 = 0;
          Object.keys(r1.vec).forEach(function (w) {
            m1 += r1.vec[w] * r1.vec[w];
            if (r2.vec[w]) dot += r1.vec[w] * r2.vec[w];
          });
          Object.keys(r2.vec).forEach(function (w) { m2 += r2.vec[w] * r2.vec[w]; });
          return (m1 && m2) ? dot / Math.sqrt(m1 * m2) : 0;
        });
      });
    }

    /* ⑥ 多文件词频对比：以真实载入的文件为单位各算一遍词频。
       与 ⑤ 不同：⑤ 只看术语，这里看全部词（术语＋一般词），
       供「相同词折线图」与分文件词频表使用。 */
    var dfDocs = null;
    var dfRaw = ttDocs.filter(function (d) { return d.text && !d.empty; });
    if (dfRaw.length >= 2) {
      dfDocs = dfRaw.map(function (d) {
        var sg = taSeg(d.text);
        var rows = Object.keys(sg.freq).map(function (w) {
          var r = sg.freq[w];
          return { w: w, kind: r.kind === "term" ? "术语" : "一般词", n: r.n, id: r.id };
        }).sort(function (a, b) { return b.n - a.n || (a.w < b.w ? -1 : 1); });
        var total = rows.reduce(function (a, r) { return a + r.n; }, 0);
        return { name: d.name, rows: rows, total: total };
      });
    }

    return {
      chars: chars, unk: seg.unk, lexN: lexN, termN: termN, sentCount: sentCount,
      freqRows: freqRows, freqById: freqById, relRows: relRows,
      nodes: nodes, P: P, ED: ED, clusters: clusters, cluNo: cluNo, PALETTE: PALETTE,
      sentRows: sentRows, posAll: posAll, negAll: negAll, byDocs: byDocs,
      cmpRows: cmpRows, simRows: simRows, dfDocs: dfDocs
    };
  }

  /* —— xlsx 导出：STORE 版 ZIP（不压缩，完全合法）＋最小 OOXML，内联字符串。
     Excel / WPS 双击即开；全离线，不引任何库。 —— */
  var TA_CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function taCrc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = TA_CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function xmlEsc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  }
  function taCol(i) {
    return i < 26 ? String.fromCharCode(65 + i)
      : taCol(Math.floor(i / 26) - 1) + String.fromCharCode(65 + i % 26);
  }
  function taSheetXml(rows) {
    var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
    rows.forEach(function (row, ri) {
      xml += '<row r="' + (ri + 1) + '">';
      row.forEach(function (cell, ci) {
        var ref = taCol(ci) + (ri + 1);
        if (typeof cell === "number" && isFinite(cell)) {
          xml += '<c r="' + ref + '"><v>' + cell + "</v></c>";
        } else if (cell == null || cell === "") {
          /* 空单元格不输出 */
        } else {
          xml += '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(cell) + "</t></is></c>";
        }
      });
      xml += "</row>";
    });
    return xml + "</sheetData></worksheet>";
  }
  /* STORE 版 ZIP 打包（不压缩，完全合法）：本地头 + 数据 + 中央目录 + EOCD。
     xlsx 与 docx 都是 ZIP＋OOXML，打包这一段共用。 */
  function zipStore(files) {
    var enc = new TextEncoder();
    var parts = [], off = [], total = 0;
    files.forEach(function (f) {
      off.push(total);
      var nameU8 = enc.encode(f.name), crc = taCrc32(f.u8);
      var h = new Uint8Array(30 + nameU8.length);
      var dv = new DataView(h.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);           // version
      dv.setUint16(6, 0x0800, true);       // 文件名是 UTF-8
      dv.setUint16(8, 0, true);            // STORE
      dv.setUint32(14, crc, true);
      dv.setUint32(18, f.u8.length, true);
      dv.setUint32(22, f.u8.length, true);
      dv.setUint16(26, nameU8.length, true);
      h.set(nameU8, 30);
      parts.push(h, f.u8);
      total += h.length + f.u8.length;
    });
    var cenLen = 0, cenParts = [];
    files.forEach(function (f, i) {
      var nameU8 = enc.encode(f.name), crc = taCrc32(f.u8);
      var h = new Uint8Array(46 + nameU8.length);
      var dv = new DataView(h.buffer);
      dv.setUint32(0, 0x02014b50, true);
      dv.setUint16(4, 20, true); dv.setUint16(6, 20, true);
      dv.setUint16(8, 0x0800, true);
      dv.setUint16(10, 0, true);
      dv.setUint32(16, crc, true);
      dv.setUint32(20, f.u8.length, true);
      dv.setUint32(24, f.u8.length, true);
      dv.setUint16(28, nameU8.length, true);
      dv.setUint32(42, off[i], true);
      h.set(nameU8, 46);
      cenParts.push(h);
      cenLen += h.length;
    });
    var eocd = new Uint8Array(22);
    var dv2 = new DataView(eocd.buffer);
    dv2.setUint32(0, 0x06054b50, true);
    dv2.setUint16(8, files.length, true);
    dv2.setUint16(10, files.length, true);
    dv2.setUint32(12, cenLen, true);
    dv2.setUint32(16, total, true);
    var all = parts.concat(cenParts, [eocd]);
    var outLen = all.reduce(function (a, x) { return a + x.length; }, 0);
    var out = new Uint8Array(outLen), p2 = 0;
    all.forEach(function (x) { out.set(x, p2); p2 += x.length; });
    return out;
  }

  function xlsxBuild(sheets) {
    var enc = new TextEncoder();
    var files = [];
    var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>';
    var wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>';
    var wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    sheets.forEach(function (sh, i) {
      var name = String(sh.name || "Sheet" + (i + 1)).replace(/[\\\/\?\*\[\]:]/g, "_").slice(0, 31) || "Sheet" + (i + 1);
      ct += '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      wb += '<sheet name="' + xmlEsc(name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
      wbRels += '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
      files.push({ name: "xl/worksheets/sheet" + (i + 1) + ".xml", u8: enc.encode(taSheetXml(sh.rows)) });
    });
    ct += "</Types>";
    wb += "</sheets></workbook>";
    wbRels += "</Relationships>";
    files.unshift(
      { name: "[Content_Types].xml", u8: enc.encode(ct) },
      { name: "_rels/.rels", u8: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>") },
      { name: "xl/workbook.xml", u8: enc.encode(wb) },
      { name: "xl/_rels/workbook.xml.rels", u8: enc.encode(wbRels) }
    );
    return zipStore(files);
  }

  /* —— docx 导出：同为 ZIP＋OOXML，排版照投稿要求写死在 styles.xml 里 ——
     A4 纵向、上下 2.54cm／左右 3.17cm；主标题二号黑体加粗居中；
     正文小四宋体、1.5 倍行距、首行缩进两字符（用 firstLineChars=200 让 Word 自算，
     换字号也不会错）；参考文献悬挂缩进。导出后不必再排版，直接可交。 */
  var DOC_FONT = { song: "宋体", hei: "黑体" };

  function docStyles() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr>' +
        '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="' + DOC_FONT.song + '" w:cs="Times New Roman"/>' +
        '<w:sz w:val="24"/><w:szCs w:val="24"/>' +
      '</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>' +
        '<w:spacing w:line="360" w:lineRule="auto"/>' +
        '<w:ind w:firstLineChars="200" w:firstLine="480"/>' +
      '</w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      /* 主标题：二号黑体加粗居中 */
      '<w:style w:type="paragraph" w:styleId="DocTitle"><w:name w:val="DocTitle"/>' +
        '<w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/>' +
        '<w:spacing w:line="360" w:lineRule="auto" w:before="0" w:after="240"/>' +
        '<w:ind w:firstLine="0" w:firstLineChars="0"/></w:pPr>' +
        '<w:rPr><w:rFonts w:ascii="' + DOC_FONT.hei + '" w:hAnsi="' + DOC_FONT.hei +
        '" w:eastAsia="' + DOC_FONT.hei + '"/><w:b/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>' +
      /* 副题 / 作者行：小四宋体居中 */
      '<w:style w:type="paragraph" w:styleId="DocSub"><w:name w:val="DocSub"/>' +
        '<w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/>' +
        '<w:ind w:firstLine="0" w:firstLineChars="0"/></w:pPr></w:style>' +
      /* 一级小标题：小三黑体，不缩进 */
      '<w:style w:type="paragraph" w:styleId="DocH2"><w:name w:val="DocH2"/>' +
        '<w:basedOn w:val="Normal"/><w:pPr>' +
        '<w:spacing w:line="360" w:lineRule="auto" w:before="240" w:after="120"/>' +
        '<w:ind w:firstLine="0" w:firstLineChars="0"/></w:pPr>' +
        '<w:rPr><w:rFonts w:ascii="' + DOC_FONT.hei + '" w:hAnsi="' + DOC_FONT.hei +
        '" w:eastAsia="' + DOC_FONT.hei + '"/><w:b/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>' +
      /* 引文块：小四宋体，左右各缩两字符 */
      '<w:style w:type="paragraph" w:styleId="DocQuote"><w:name w:val="DocQuote"/>' +
        '<w:basedOn w:val="Normal"/><w:pPr>' +
        '<w:ind w:leftChars="200" w:left="480" w:firstLine="0" w:firstLineChars="0"/></w:pPr></w:style>' +
      /* 小字：五号宋体 */
      '<w:style w:type="paragraph" w:styleId="DocSmall"><w:name w:val="DocSmall"/>' +
        '<w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:style>' +
      /* 参考文献条目：悬挂缩进 */
      '<w:style w:type="paragraph" w:styleId="DocRef"><w:name w:val="DocRef"/>' +
        '<w:basedOn w:val="Normal"/><w:pPr>' +
        '<w:ind w:leftChars="200" w:left="480" w:hangingChars="200" w:hanging="480"/></w:pPr></w:style>' +
      /* 表格单元格：不缩进 */
      '<w:style w:type="paragraph" w:styleId="DocCell"><w:name w:val="DocCell"/>' +
        '<w:basedOn w:val="Normal"/><w:pPr>' +
        '<w:spacing w:line="240" w:lineRule="auto" w:before="20" w:after="20"/>' +
        '<w:ind w:firstLine="0" w:firstLineChars="0"/></w:pPr>' +
        '<w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>' +
      /* 表头单元格 */
      '<w:style w:type="paragraph" w:styleId="DocTh"><w:name w:val="DocTh"/>' +
        '<w:basedOn w:val="DocCell"/><w:rPr><w:b/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>' +
      /* 脚注：正文里的角标（上标）与页脚里的注文（五号宋体，不缩进） */
      '<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/>' +
        '<w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/>' +
        '<w:basedOn w:val="Normal"/><w:pPr>' +
        '<w:spacing w:line="240" w:lineRule="auto"/>' +
        '<w:ind w:firstLine="0" w:firstLineChars="0"/></w:pPr>' +
        '<w:rPr><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:style>' +
      '</w:styles>';
  }

  /* 一段。text 里的 \n 折成 <w:br/>；style 取上面定义的名字。
     fnId 给了就在段末挂一个脚注引用——真正的 Word 脚注（word/footnotes.xml），
     不是「小字写在段落下」，所以 Word 里能自动编号、自动排在页脚。 */
  function wPara(text, style, fnId) {
    var runs = String(text == null ? "" : text).split("\n").map(function (ln, i) {
      return (i ? "<w:br/>" : "") +
        '<w:t xml:space="preserve">' + xmlEsc(ln) + "</w:t>";
    }).join("");
    var fn = fnId
      ? '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="' + fnId + '"/></w:r>'
      : "";
    return "<w:p>" + (style ? '<w:pPr><w:pStyle w:val="' + style + '"/></w:pPr>' : "") +
      "<w:r>" + runs + "</w:r>" + fn + "</w:p>";
  }

  /* 脚注部件：前两条是 Word 规定的分隔线（id -1 / 0），正文脚注从 1 起。
     编号方式设为 ①②③ 且每页重编——投稿排版要求里就是这么写的。 */
  function wFootnotes(list) {
    var head = '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr>' +
        '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>' +
      '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr>' +
        '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>';
    return head + list.map(function (text, i) {
      return '<w:footnote w:id="' + (i + 1) + '"><w:p>' +
        '<w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>' +
        '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>' +
        '<w:r><w:t xml:space="preserve"> ' + xmlEsc(text) + "</w:t></w:r></w:p></w:footnote>";
    }).join("") + "</w:footnotes>";
  }

  /* 一张表：首行为表头。widths 是各列宽度（dxa，1/20 磅）；不给就均分 */
  function wTable(rows, widths) {
    if (!rows || !rows.length) return "";
    var n = rows[0].length;
    var totalW = 8600;                       // A4 去页边距后的正文宽度，约 16.5cm
    widths = widths && widths.length === n ? widths
      : rows[0].map(function () { return Math.floor(totalW / n); });
    var borders = '<w:tblBorders>' +
      ["top", "left", "bottom", "right", "insideH", "insideV"].map(function (s) {
        return "<w:" + s + ' w:val="single" w:sz="4" w:space="0" w:color="999999"/>';
      }).join("") + "</w:tblBorders>";
    var xml = '<w:tbl><w:tblPr><w:tblW w:w="' + totalW + '" w:type="dxa"/>' + borders + "</w:tblPr><w:tblGrid>" +
      widths.map(function (w) { return '<w:gridCol w:w="' + w + '"/>'; }).join("") + "</w:tblGrid>";
    rows.forEach(function (row, ri) {
      xml += "<w:tr>" + row.map(function (cell, ci) {
        return "<w:tc><w:tcPr><w:tcW w:w=\"" + widths[ci] + '" w:type="dxa"/></w:tcPr>' +
          wPara(cell, ri === 0 ? "DocTh" : "DocCell") + "</w:tc>";
      }).join("") + "</w:tr>";
    });
    return xml + "</w:tbl>";
  }

  /* blocks: [{t:"title"|"sub"|"h2"|"p"|"quote"|"small"|"ref"|"pagebreak", text, fn?}]
             | {t:"table", rows:[[..]], widths:[..]}
     fn 是挂在该段末尾的脚注文本；按 blocks 里出现的先后自动编号，
     编号即正文里的顺序，导出后不必手动对号。 */
  function docxBuild(blocks) {
    var enc = new TextEncoder();
    var fns = [];
    var body = blocks.map(function (b) {
      if (b.t === "table") return wTable(b.rows, b.widths);
      if (b.t === "pagebreak") return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      var style = { title: "DocTitle", sub: "DocSub", h2: "DocH2", quote: "DocQuote",
        small: "DocSmall", ref: "DocRef" }[b.t] || null;
      var fnId = null;
      if (b.fn) { fns.push(String(b.fn)); fnId = fns.length; }
      return wPara(b.text, style, fnId);
    }).join("");

    var hasFn = fns.length > 0;
    var doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      "<w:body>" + body +
      /* A4 纵向；上下 2.54cm，左右 3.17cm（Word 中文默认版式）
         脚注：①②③编号、每页重编——按投稿排版要求预先设好 */
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1440" w:right="1797" w:bottom="1440" w:left="1797" ' +
      'w:header="851" w:footer="992" w:gutter="0"/>' +
      '<w:footnotePr><w:numFmt w:val="decimalEnclosedCircle"/>' +
      '<w:numRestart w:val="eachPage"/></w:footnotePr>' +
      "</w:sectPr>" +
      "</w:body></w:document>";

    var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      (hasFn ? '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' : "") +
      "</Types>";

    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      (hasFn ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>' : "") +
      "</Relationships>";

    var files = [
      { name: "[Content_Types].xml", u8: enc.encode(ct) },
      { name: "_rels/.rels", u8: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        "</Relationships>") },
      { name: "word/document.xml", u8: enc.encode(doc) },
      { name: "word/styles.xml", u8: enc.encode(docStyles()) },
      { name: "word/_rels/document.xml.rels", u8: enc.encode(rels) }
    ];
    if (hasFn) files.push({ name: "word/footnotes.xml", u8: enc.encode(wFootnotes(fns)) });
    return zipStore(files);
  }

  /* 通用下载：给定字节与 MIME，落成文件 */
  function dlBytes(fname, u8, mime) {
    var blob = new Blob([u8], { type: mime });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }
  function docxDownload(fname, blocks) {
    try {
      dlBytes(fname, docxBuild(blocks),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    } catch (e) {
      window.alert("导出失败：" + ((e && e.message) || e));
    }
  }
  function taDownload(fname, sheets) {
    try {
      dlBytes(fname, xlsxBuild(sheets),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } catch (e) {
      ttMsg('<span class="warn">导出失败：' + esc((e && e.message) || e) + "</span>");
    }
  }

  /* —— 渲染小工具 —— */
  function taTh(arr) { return "<tr>" + arr.map(function (h) { return "<th>" + h + "</th>"; }).join("") + "</tr>"; }
  function taExportBtn(k, label) {
    return '<button type="button" class="tbtn ta-xlsx" data-act="ta-xlsx" data-k="' + k + '">导出 xlsx' + (label ? "（" + label + "）" : "") + "</button>";
  }
  function taPct(n, total) { return total ? (n * 100 / total).toFixed(1) + "%" : "0%"; }
  function taPctN(n, total) { return total ? +(n * 100 / total).toFixed(1) : 0; }

  /* —— 多文件词频对比的状态与画图 ——
     TA_DF 只存勾选的词与纵轴口径；词集本身每次从 TA_RES 现算（文本变了词集就变），
     勾选沿用上次的选择，凑不齐两条时回落到总频次前 8。 */
  var TA_DF = { words: null, mode: "rate" };
  /* v57：聚类网络图的着色口径。"cluster"＝连通分量（老口径），"domain"＝知识板块。
     会话级状态即可——刷新回到默认的按簇着色。 */
  var TA_NET = { by: "cluster" };

  function dfPrep(R) {
    var cand = {}, order = [];
    R.dfDocs.forEach(function (d) {
      d.rows.forEach(function (r) {
        if (!cand[r.w]) { cand[r.w] = { w: r.w, id: r.id, kind: r.kind, n: 0, docs: 0 }; order.push(r.w); }
        var c = cand[r.w];
        c.n += r.n; c.docs++;
      });
    });
    var list = order.map(function (k) { return cand[k]; })
      .filter(function (c) { return c.docs >= 2; })
      .sort(function (a, b) { return b.n - a.n || (a.w < b.w ? -1 : 1); })
      .slice(0, 14);
    TA_DF.words = (TA_DF.words || []).filter(function (w) {
      return list.some(function (c) { return c.w === w; });
    });
    if (TA_DF.words.length < 2) {
      TA_DF.words = list.slice(0, 8).map(function (c) { return c.w; });
    }
    var names = R.dfDocs.map(function (d) { return d.name; });
    var series = list.filter(function (c) { return TA_DF.words.indexOf(c.w) >= 0; })
      .map(function (c, i) {
        return {
          w: c.w, id: c.id, col: R.PALETTE[i % R.PALETTE.length],
          vals: R.dfDocs.map(function (d) {
            var n = 0;
            d.rows.some(function (r) { if (r.w === c.w) { n = r.n; return true; } return false; });
            return TA_DF.mode === "rate" ? (d.total ? +(n * 1000 / d.total).toFixed(2) : 0) : n;
          })
        };
      });
    return { list: list, names: names, series: series };
  }

  /* 折线图：横轴＝文件标题，纵轴＝频率，一条线一个词。全部用内联属性着色，
     不依赖任何 CSS 类——导出 PNG 时（SVG 序列化进 canvas）样式才不会丢。 */
  function dfChartSvg(names, series, mode) {
    var W = 760, H = 400, L = 64, Rp = 26, T = 30, B = 72;
    var iw = W - L - Rp, ih = H - T - B;
    var max = 0;
    series.forEach(function (s) { s.vals.forEach(function (v) { if (v > max) max = v; }); });
    if (!max) max = 1;
    /* 纵轴取「好看」的上界：1/2/2.5/5×10^k 里挑第一个 ≥max 的 */
    var mag = Math.pow(10, Math.floor(Math.log(max) / Math.LN10));
    var nice = 10 * mag;
    [1, 2, 2.5, 5, 10].some(function (m) { if (max <= m * mag) { nice = m * mag; return true; } return false; });
    function X(i) { return names.length > 1 ? L + i * iw / (names.length - 1) : L + iw / 2; }
    function Y(v) { return T + ih - v / nice * ih; }
    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="多文件相同词频折线图" ' +
      'font-family="sans-serif">';
    /* 网格与纵轴刻度 */
    for (var g = 0; g <= 5; g++) {
      var v = nice * g / 5, y = Y(v);
      svg += '<line x1="' + L + '" y1="' + y.toFixed(1) + '" x2="' + (W - Rp) + '" y2="' + y.toFixed(1) +
        '" stroke="#e4dccb" stroke-width="1"/>' +
        '<text x="' + (L - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="#5c5548">' +
        (mode === "rate" ? +v.toFixed(1) : +v.toFixed(0)) + "</text>";
    }
    /* 坐标轴 */
    svg += '<line x1="' + L + '" y1="' + (T + ih) + '" x2="' + (W - Rp) + '" y2="' + (T + ih) +
      '" stroke="#6d6459" stroke-width="1.5"/>' +
      '<line x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + (T + ih) + '" stroke="#6d6459" stroke-width="1.5"/>';
    /* 横轴标签（文件名，长则截断） */
    names.forEach(function (nm, i) {
      var t = nm.length > 12 ? nm.slice(0, 11) + "…" : nm;
      svg += '<text x="' + X(i).toFixed(1) + '" y="' + (T + ih + 18) + '" text-anchor="middle" font-size="11" fill="#3d3830">' +
        esc(t) + "</text>";
    });
    svg += '<text x="' + (L + iw / 2) + '" y="' + (H - 14) + '" text-anchor="middle" font-size="12" fill="#5c5548">文本标题</text>';
    svg += '<text x="18" y="' + (T + ih / 2) + '" text-anchor="middle" font-size="12" fill="#5c5548" transform="rotate(-90 18 ' +
      (T + ih / 2) + ')">' + (mode === "rate" ? "每千词频率" : "频次") + "</text>";
    /* 折线与数据点 */
    series.forEach(function (s) {
      var pts = s.vals.map(function (v, i) { return X(i).toFixed(1) + "," + Y(v).toFixed(1); }).join(" ");
      svg += '<polyline points="' + pts + '" fill="none" stroke="' + s.col + '" stroke-width="2.2" stroke-linejoin="round"/>';
      s.vals.forEach(function (v, i) {
        svg += '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="3.6" fill="' + s.col + '"/>' +
          '<text x="' + X(i).toFixed(1) + '" y="' + (Y(v) - 7).toFixed(1) + '" text-anchor="middle" font-size="9.5" fill="' + s.col + '">' +
          (mode === "rate" ? v : v) + "</text>";
      });
    });
    /* 图例（右上角，竖排） */
    var lx = W - Rp - 118, ly = T + 8;
    svg += '<rect x="' + (lx - 10) + '" y="' + (ly - 12) + '" width="128" height="' + (series.length * 17 + 12) +
      '" rx="6" fill="#fbf7ee" fill-opacity=".92" stroke="#e4dccb"/>';
    series.forEach(function (s, i) {
      svg += '<line x1="' + lx + '" y1="' + (ly + i * 17) + '" x2="' + (lx + 22) + '" y2="' + (ly + i * 17) +
        '" stroke="' + s.col + '" stroke-width="2.4"/>' +
        '<circle cx="' + (lx + 11) + '" cy="' + (ly + i * 17) + '" r="3" fill="' + s.col + '"/>' +
        '<text x="' + (lx + 28) + '" y="' + (ly + i * 17 + 4) + '" font-size="11" fill="#3d3830">' +
        esc(s.w.length > 9 ? s.w.slice(0, 8) + "…" : s.w) + "</text>";
    });
    svg += "</svg>";
    return svg;
  }

  /* 勾选／切轴后只重画图：从 TA_RES 现算序列，替换 #ta-df-chart 内容 */
  function redrawDfChart() {
    var host = document.getElementById("ta-df-chart");
    if (!host || !TA_RES || !TA_RES.dfDocs) return;
    var DF = dfPrep(TA_RES);
    host.innerHTML = dfChartSvg(DF.names, DF.series, TA_DF.mode);
  }

  function renderTa() {
    var box = document.getElementById("ta-out");
    if (!box) return;
    var raw = ttGetText();
    if (!raw.replace(/\s/g, "").length) { box.innerHTML = ""; TA_RES = null; return; }
    var R = taCompute(raw);
    TA_RES = R;
    if (!R) { box.innerHTML = ""; return; }

    /* ① 词频表 */
    var freqHtml = '<div class="ta-sub" id="ta-freq"><h3>分词与词频</h3>' +
      '<p class="tool-hint">离线词典分词（术语＋常用词，长词优先；与 jieba 精确模式同一思路）。' +
      "共切出 <b>" + fmtCount(R.termN + R.lexN) + "</b> 个词（术语 " + fmtCount(R.termN) +
      " · 一般词 " + fmtCount(R.lexN) + "），未成词单字 " + fmtCount(R.unk) + " 个。" +
      "下表列前 60 个词，导出含全表。</p>" +
      '<div class="ta-scroll"><table class="ta-tbl"><thead>' +
      taTh(["排名", "词", "类别", "频次", "占全部词"]) + "</thead><tbody>" +
      R.freqRows.slice(0, 60).map(function (r, i) {
        return "<tr><td>" + (i + 1) + "</td>" +
          "<td>" + (r.id ? '<a href="#/t/' + esc(r.id) + '">' + esc(r.w) + "</a>" : esc(r.w)) + "</td>" +
          "<td>" + r.kind + "</td><td>" + r.n + "</td><td>" + taPct(r.n, R.termN + R.lexN) + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      '<p class="ta-acts">' + taExportBtn("freq", "词频全表") + "</p></div>";

    /* ② 关联性表 */
    var relHtml = '<div class="ta-sub" id="ta-rel"><h3>关联性分析</h3>' +
      '<p class="tool-hint">同一句（以。！？；分句）里同时出现的术语记一次共现；' +
      "<b>提升度</b>＝实际共现 ÷ 两者随机同句的期望——大于 1 说明这两个概念倾向结伴出现，" +
      "正是这段文字论证结构的骨架。</p>" +
      (R.relRows.length
        ? '<div class="ta-scroll"><table class="ta-tbl"><thead>' +
          taTh(["词 A", "词 B", "共现句数", "提升度"]) + "</thead><tbody>" +
          R.relRows.slice(0, 40).map(function (r) {
            return "<tr><td>" + esc(r.a) + "</td><td>" + esc(r.b) + "</td><td>" + r.co +
              "</td><td>" + r.lift.toFixed(2) + "</td></tr>";
          }).join("") + "</tbody></table></div>"
        : '<p class="tool-hint">文本太短或术语太少，凑不出共现词对。</p>') +
      '<p class="ta-acts">' + taExportBtn("rel", "共现全表") + "</p></div>";

    /* ③ 聚类网络图 */
    var netHtml;
    if (R.nodes.length >= 3 && R.ED.length) {
      /* v57：按知识板块着色的口径——节点颜色跟着它所属的板块走（板块按命中次数
         降序分配色号），图例铺在图下面；按簇着色（连通分量）仍是默认。 */
      var domCount = {}, domOf = {};
      R.nodes.forEach(function (id) {
        var t = BY_ID[id];
        if (!t) return;
        domOf[id] = t.domain;
        domCount[t.domain] = (domCount[t.domain] || 0) + 1;
      });
      var domList = Object.keys(domCount).sort(function (a, b) { return domCount[b] - domCount[a]; });
      var domNo = {};
      domList.forEach(function (d, i) { domNo[d] = i; });

      var svg = '<svg viewBox="0 0 640 370" class="ta-net" role="img" aria-label="术语共现网络图">';
      R.ED.forEach(function (e) {
        var a = R.P[e.a], b = R.P[e.b];
        svg += '<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) + '" x2="' + b.x.toFixed(1) +
          '" y2="' + b.y.toFixed(1) + '" stroke="#b9a99a" stroke-width="' +
          Math.min(3, 0.6 + e.co * 0.15).toFixed(2) + '"/>';
      });
      var maxN = R.freqRows.length ? R.freqRows[0].n : 1;
      var colorOf = {};
      Object.keys(R.clusters).forEach(function (k) {
        R.clusters[k].forEach(function (id) { colorOf[id] = (R.cluNo[k] || 1) - 1; });
      });
      R.nodes.forEach(function (id, i) {
        var t = BY_ID[id], p = R.P[i];
        var ci = TA_NET.by === "domain" ? (domNo[domOf[id]] || 0) : (colorOf[id] || 0);
        var col = R.PALETTE[ci % R.PALETTE.length];
        var rad = 5 + 5 * Math.sqrt((R.freqById[id] || 1) / Math.max(1, maxN));
        svg += '<a href="#/t/' + esc(id) + '"><circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) +
          '" r="' + rad.toFixed(1) + '" fill="' + col + '"/>' +
          '<text x="' + p.x.toFixed(1) + '" y="' + (p.y - rad - 3).toFixed(1) +
          '" text-anchor="middle" font-size="10">' + esc(t ? t.term : id) + "</text></a>";
      });
      svg += "</svg>";
      var cluKeys = Object.keys(R.clusters).filter(function (k) { return R.clusters[k].length > 1; });
      netHtml = '<div class="ta-sub" id="ta-net"><h3>聚类网络图</h3>' +
        '<div class="df-bar" role="group" aria-label="着色方式">' +
          '<span class="df-lab">着色：</span>' +
          '<label class="df-opt"><input type="radio" name="ta-net-mode" value="cluster"' +
            (TA_NET.by === "cluster" ? " checked" : "") + ">按簇（连通分量）</label>" +
          '<label class="df-opt"><input type="radio" name="ta-net-mode" value="domain"' +
            (TA_NET.by === "domain" ? " checked" : "") + ">按知识板块</label>" +
        "</div>" +
        '<p class="tool-hint">词频前 ' + R.nodes.length + " 的术语按共现连边（≥2 句）" +
          (TA_NET.by === "domain"
            ? "，颜色是所属知识板块。"
            : "，连通的算一簇、同色。") +
          "点节点可进词条。</p>" + svg +
        (TA_NET.by === "domain"
          ? '<p class="tt-dims">' + domList.map(function (d, i) {
              return '<span style="border-bottom:3px solid ' + R.PALETTE[i % R.PALETTE.length] + '">' +
                esc(catName(d)) + " <b>" + domCount[d] + "</b></span>";
            }).join("") + "</p>"
          : "") +
        (cluKeys.length && TA_NET.by !== "domain"
          ? '<div class="ta-scroll"><table class="ta-tbl"><thead>' +
            taTh(["簇", "成员术语", "规模"]) + "</thead><tbody>" +
            cluKeys.map(function (k) {
              var mem = R.clusters[k].map(function (id) { return BY_ID[id] ? BY_ID[id].term : id; });
              return "<tr><td>簇 " + (R.cluNo[k] || "") + "</td><td>" + esc(mem.join("、")) +
                "</td><td>" + mem.length + "</td></tr>";
            }).join("") + "</tbody></table></div>"
          : "") +
        '<p class="ta-acts"><button type="button" class="tbtn" data-act="ta-png" data-target="ta-net">导出图片（PNG）</button>' +
        taExportBtn("net", "聚类成员") + "</p></div>";
    } else {
      netHtml = '<div class="ta-sub" id="ta-net"><h3>聚类网络图</h3>' +
        '<p class="tool-hint">术语太少或共现不足，画不出网络——多粘一些术语密集的段落试试。</p></div>';
    }

    /* ④ 情感表 */
    var verdict = (R.posAll + R.negAll) === 0 ? "没有命中情感词"
      : R.posAll > R.negAll * 1.2 ? "整体偏积极"
      : R.negAll > R.posAll * 1.2 ? "整体偏消极" : "正负大体均衡";
    var sentHtml = '<div class="ta-sub" id="ta-sent"><h3>情感分析</h3>' +
      '<p class="tool-hint">内置通用情感词典做<b>词面计数</b>——它不懂反讽和否定' +
      "（「不自由」仍会数到「自由」），学术文本务必人工复核。整体：" + R.posAll +
      " 个积极 · " + R.negAll + " 个消极 → <b>" + verdict + "</b>。</p>" +
      (R.sentRows.length
        ? '<div class="ta-scroll"><table class="ta-tbl"><thead>' +
          taTh(["段", "段落开头", "积极词", "消极词", "倾向分", "命中词样例"]) + "</thead><tbody>" +
          R.sentRows.slice(0, 50).map(function (r) {
            var samples = r.hitsP.map(function (h) { return h[0] + "×" + h[1]; })
              .concat(r.hitsN.map(function (h) { return h[0] + "×" + h[1]; })).join("、");
            return "<tr><td>" + r.i + "</td><td>" + esc(r.head) + "</td><td>" + r.pos + "</td><td>" +
              r.neg + "</td><td>" + (r.score == null ? "—" : r.score.toFixed(2)) +
              "</td><td>" + esc(samples || "—") + "</td></tr>";
          }).join("") + "</tbody></table></div>"
        : "<p>文本太短。</p>") +
      '<p class="ta-acts">' + taExportBtn("sent", "段落情感全表") + "</p></div>";

    /* ⑤ 多文本比对 */
    var cmpHtml;
    if (R.cmpRows) {
      var names = R.cmpRows.map(function (r) { return r.name; });
      cmpHtml = '<div class="ta-sub" id="ta-cmp"><h3>多文本比对</h3>' +
        '<p class="tool-hint">' + (R.byDocs
          ? "按上面载入的 " + R.cmpRows.length + " 份文件比对"
          : "没有载入多份文件，暂按空行把文本拆成 " + R.cmpRows.length +
            " 段比对（载入多个文件可按文件比）") + "。</p>" +
        '<div class="ta-scroll"><table class="ta-tbl"><thead>' +
        taTh(["文本", "字数", "术语命中", "密度%", "积极", "消极", "高频术语"]) + "</thead><tbody>" +
        R.cmpRows.map(function (r) {
          return "<tr><td>" + esc(r.name) + "</td><td>" + r.chars + "</td><td>" + r.terms +
            "</td><td>" + r.density.toFixed(1) + "</td><td>" + r.pos + "</td><td>" + r.neg +
            "</td><td>" + esc(r.top) + "</td></tr>";
        }).join("") + "</tbody></table></div>" +
        '<p class="tool-hint" style="margin-top:.5rem">余弦相似度（按术语词频向量）：</p>' +
        '<div class="ta-scroll"><table class="ta-tbl"><thead><tr><th></th>' +
        names.map(function (nm) { return "<th>" + esc(nm) + "</th>"; }).join("") +
        "</tr></thead><tbody>" +
        R.simRows.map(function (row, i) {
          return "<tr><th>" + esc(names[i]) + "</th>" + row.map(function (v) {
            return "<td>" + (v < 0 ? "—" : v.toFixed(2)) + "</td>";
          }).join("") + "</tr>";
        }).join("") + "</tbody></table></div>" +
        '<p class="ta-acts">' + taExportBtn("cmp", "比对与相似度") + "</p></div>";
    } else {
      cmpHtml = '<div class="ta-sub" id="ta-cmp"><h3>多文本比对</h3>' +
        '<p class="tool-hint">载入第二份文件（或粘入多段 80 字以上的文字）后，这里给出' +
        "各文本的字数、术语密度、情感与相似度对照表。</p></div>";
    }

    /* ⑥ 多文件词频对比：分文件词频表＋相同词折线图（横轴文件，纵轴频率，一条线一个词） */
    var dfHtml;
    if (R.dfDocs) {
      var DF = dfPrep(R);
      dfHtml = '<div class="ta-sub" id="ta-docfreq"><h3>多文件词频对比</h3>' +
        '<p class="tool-hint">对上面载入的 ' + R.dfDocs.length + ' 份文件各做一遍分词词频：' +
        "下面先给每份文件的词频表，再把<b>至少在两份文件中出现的相同词</b>画成折线——" +
        "横轴是文本标题，纵轴是频率（可切每千词频率或原始频次），一条线一个词。</p>" +
        '<div class="df-bar">' +
          '<span class="df-lab">纵轴：</span>' +
          '<label class="df-opt"><input type="radio" name="df-mode" value="rate"' + (TA_DF.mode === "rate" ? " checked" : "") + ">每千词频率</label>" +
          '<label class="df-opt"><input type="radio" name="df-mode" value="count"' + (TA_DF.mode === "count" ? " checked" : "") + ">频次</label>" +
        "</div>" +
        '<div class="df-words" role="group" aria-label="选择画折线的词语">' +
          DF.list.map(function (c) {
            var on = TA_DF.words.indexOf(c.w) >= 0;
            return '<label class="df-word"><input type="checkbox" data-df-w="' + esc(c.w) + '"' + (on ? " checked" : "") + ">" +
              '<span style="border-bottom:2px solid ' + R.PALETTE[DF.list.indexOf(c) % R.PALETTE.length] + '">' + esc(c.w) + "</span>×" + c.n + "</label>";
          }).join("") +
        "</div>" +
        '<div id="ta-df-chart">' + dfChartSvg(DF.names, DF.series, TA_DF.mode) + "</div>" +
        '<p class="ta-acts">' +
          '<button type="button" class="tbtn" data-act="ta-png" data-target="ta-df-chart" data-file="词频折线图.png">导出折线图（PNG）</button>' +
          taExportBtn("docfreq", "各文件词频＋折线数据") + "</p>" +
        R.dfDocs.map(function (d) {
          return '<h4 class="df-file">' + esc(d.name) + '<span class="df-file-n">共 ' + fmtCount(d.total) +
            " 词次 · 前 25 词</span></h4>" +
            '<div class="ta-scroll"><table class="ta-tbl"><thead>' +
            taTh(["排名", "词", "类别", "频次", "占本文件"]) + "</thead><tbody>" +
            d.rows.slice(0, 25).map(function (r, j) {
              return "<tr><td>" + (j + 1) + "</td>" +
                "<td>" + (r.id ? '<a href="#/t/' + esc(r.id) + '">' + esc(r.w) + "</a>" : esc(r.w)) + "</td>" +
                "<td>" + r.kind + "</td><td>" + r.n + "</td><td>" + taPct(r.n, d.total) + "</td></tr>";
            }).join("") + "</tbody></table></div>";
        }).join("") +
        "</div>";
    } else {
      dfHtml = '<div class="ta-sub" id="ta-docfreq"><h3>多文件词频对比</h3>' +
        '<p class="tool-hint">把<b>两份以上</b>文件拖到上面的框里，这里会给出每份文件的词频表，' +
        "并把各文件共同出现的词画成折线图（横轴是文本标题，纵轴是频率，一条线一个词），可导出 xlsx 与 PNG。</p></div>";
    }

    box.innerHTML = freqHtml + relHtml + netHtml + sentHtml + cmpHtml + dfHtml;

    /* 词频对比块的勾选／切轴：只重画折线图，不动整块（保住滚动位置与表格） */
    var dfBox = box.querySelector("#ta-docfreq");
    if (dfBox) {
      dfBox.addEventListener("change", function (e) {
        var inp = e.target;
        if (!inp || (!inp.name && !inp.hasAttribute("data-df-w"))) return;
        if (inp.name === "df-mode") {
          TA_DF.mode = inp.value;
        } else if (inp.hasAttribute("data-df-w")) {
          var w = inp.getAttribute("data-df-w");
          var at = TA_DF.words.indexOf(w);
          if (inp.checked && at < 0) TA_DF.words.push(w);
          if (!inp.checked && at >= 0) TA_DF.words.splice(at, 1);
          if (TA_DF.words.length < 1) { inp.checked = true; return; }
        } else { return; }
        redrawDfChart();
      });
    }
    /* v57：聚类网络图的着色切换——整块重算一次（布局是确定性的，图不会跳） */
    var netBox = box.querySelector("#ta-net");
    if (netBox) {
      netBox.addEventListener("change", function (e) {
        var inp = e.target;
        if (!inp || inp.name !== "ta-net-mode") return;
        TA_NET.by = inp.value;
        renderTa();
      });
    }
  }

  /* 把 TA_RES 里对应块的数据整理成 xlsx 工作表 */
  function taSheets(k) {
    var R = TA_RES;
    if (!R) return null;
    if (k === "freq") {
      return [{ name: "词频", rows: [["排名", "词", "类别", "频次", "占全部词%"]].concat(
        R.freqRows.map(function (r, i) {
          return [i + 1, r.w, r.kind, r.n, taPctN(r.n, R.termN + R.lexN)];
        })) }];
    }
    if (k === "rel") {
      return [{ name: "共现", rows: [["词A", "词B", "共现句数", "提升度"]].concat(
        R.relRows.map(function (r) { return [r.a, r.b, r.co, +r.lift.toFixed(3)]; })) }];
    }
    if (k === "net") {
      var rows = [["簇", "成员术语", "规模"]];
      Object.keys(R.clusters).forEach(function (kk) {
        var mem = R.clusters[kk].map(function (id) { return BY_ID[id] ? BY_ID[id].term : id; });
        rows.push(["簇 " + (R.cluNo[kk] || ""), mem.join("、"), mem.length]);
      });
      return [{ name: "聚类", rows: rows }];
    }
    if (k === "sent") {
      return [{ name: "段落情感", rows: [["段", "段落开头", "积极词", "消极词", "倾向分", "命中词"]].concat(
        R.sentRows.map(function (r) {
          return [r.i, r.head, r.pos, r.neg, r.score == null ? "" : +r.score.toFixed(3),
            r.hitsP.concat(r.hitsN).map(function (h) { return h[0] + "×" + h[1]; }).join("、")];
        })) }];
    }
    if (k === "cmp") {
      var s1 = [["文本", "字数", "术语命中", "密度%", "积极", "消极", "高频术语"]].concat(
        R.cmpRows.map(function (r) {
          return [r.name, r.chars, r.terms, +r.density.toFixed(2), r.pos, r.neg, r.top];
        }));
      var names = R.cmpRows.map(function (r) { return r.name; });
      var s2 = [["文本"].concat(names)];
      R.simRows.forEach(function (row, i) {
        s2.push([names[i]].concat(row.map(function (v) { return v < 0 ? "—" : +v.toFixed(3); })));
      });
      return [{ name: "文本概览", rows: s1 }, { name: "相似度矩阵", rows: s2 }];
    }
    if (k === "docfreq") {
      var DF = dfPrep(R);
      var sheets = [];
      /* 每份文件一张词频表（全量，不止前 25） */
      R.dfDocs.forEach(function (d, i) {
        sheets.push({
          name: ("词频-" + d.name).replace(/[\\\/\?\*\[\]:]/g, "_").slice(0, 28) + (i + 1),
          rows: [["排名", "词", "类别", "频次", "占本文件%"]].concat(
            d.rows.map(function (r, j) {
              return [j + 1, r.w, r.kind, r.n, d.total ? +(r.n * 100 / d.total).toFixed(2) : 0];
            }))
        });
      });
      /* 折线数据矩阵：行＝相同词（≥2 份文件），列＝各文件频次，随后每千词频率 */
      var mat = [["词", "类别"].concat(R.dfDocs.map(function (d) { return d.name + "（频次）"; }))
        .concat(R.dfDocs.map(function (d) { return d.name + "（每千词）"; }))];
      DF.list.forEach(function (c) {
        var cnt = R.dfDocs.map(function (d) {
          var n = 0;
          d.rows.some(function (r) { if (r.w === c.w) { n = r.n; return true; } return false; });
          return n;
        });
        var rate = R.dfDocs.map(function (d, i) {
          return d.total ? +(cnt[i] * 1000 / d.total).toFixed(2) : 0;
        });
        mat.push([c.w, c.kind].concat(cnt).concat(rate));
      });
      sheets.push({ name: "折线数据", rows: mat });
      return sheets;
    }
    return null;
  }

  /* ================= 阅读辅助三件 =================
     原典引文检索 · 概念对照表 · 三卷目录树。
     与文本分析同一条约束：零依赖、file:// 可开、状态换页不丢。
     控件骨架在 viewTools() 里是静态的，本段只负责「往输出格里填内容」，
     输入框不重画，打字才不会丢焦点。 */

  /* —— 1) 原典引文检索：在已核引文里检索，一键按体例复制 —— */

  var QS = { q: "", src: "all" };
  var QS_SRC = [
    ["all", "全部来源"],
    ["zbl", "《资本论》单行本口径"],
    ["xj", "《马恩选集》口径"],
    ["mzx", "《毛泽东选集》"],
    ["rmrb", "《人民日报》"],
    ["other", "其他文献"]
  ];
  var QS_CAP = 80;   // 一次最多渲染的卡片数，防几百条糊屏

  var _QI = null;
  function quoteIndex() {
    if (_QI) return _QI;
    _QI = [];
    TERMS.forEach(function (t) {
      (t.original || []).forEach(function (o) {
        if (!o.text) return;   // 待补录的条目没有引文可查
        var cite = o.cite || "";
        var src = /《马克思恩格斯选集》/.test(cite) ? "xj"
          : /《资本论》第[一二三]卷/.test(cite) ? "zbl"
          : /《毛泽东选集》/.test(cite) ? "mzx"
          : /《人民日报》/.test(cite) ? "rmrb" : "other";
        _QI.push({
          term: t.term, id: t.id, text: o.text,
          chapter: o.chapter || "", cite: cite,
          verify: !!o.verify, loc: o.loc || "", src: src
        });
      });
    });
    return _QI;
  }

  function locChip(o) {
    if (!o.verify) return ' <span class="chip warn">页码待核</span>';
    var m = { "页": ["ok", "页码已核"], "版": ["ok", "版次已核"],
      "条": ["ok", "条款已核"], "篇": ["", "卷首文献"] }[o.loc];
    return m ? ' <span class="chip ' + m[0] + '">' + m[1] + "</span>" : "";
  }

  function qsCard(o) {
    var gb = toGB(o.cite);
    var foot = o.text + "\n——" + o.cite + "。" + (o.chapter ? "\n（" + o.chapter + "）" : "");
    /* 词条默认折叠收纳：summary 只留「词条 · 章节 · 核验 chip」一行，
       引文、出处与复制按钮点开才出现——275 条铺开太长，翻找时先看词条名。 */
    return '<details class="qs-item">' +
      '<summary class="qs-src"><a href="#/t/' + esc(o.id) + '">' + esc(o.term) + "</a>" +
        (o.chapter ? '<span class="qs-ch">' + esc(o.chapter) + "</span>" : "") + locChip(o) +
        '<span class="qs-more-hint">展开</span></summary>' +
      '<div class="qs-body">' +
        "<blockquote>" + esc(o.text) + "</blockquote>" +
        '<p class="q-cite">' + esc(o.cite) + "。</p>" +
        '<div class="q-acts">' +
          '<button type="button" class="tbtn" data-copy="' + esc(foot) + '">复制脚注（引文＋出处）</button>' +
          (gb
            ? '<button type="button" class="tbtn" data-copy="' + esc(gb) + '" title="GB/T 7714—2015 著录格式，请按目标刊物要求核对">复制 GB/T 7714</button>'
            : '<span class="qs-nogb" title="这个出处的著录要素不全，保守转换宁可不给，也不给一条错的">无 GB 著录</span>') +
        "</div>" +
      "</div></details>";
  }

  function renderQuotes() {
    var out = document.getElementById("qs-out");
    if (!out) return;
    var kw = QS.q.trim().toLowerCase();
    /* 不填关键词就不列库：默认 0 条，输点什么再查 */
    if (!kw) {
      out.innerHTML = '<p class="qs-stat">命中 <b>0</b> 条（已核 0 · 待核 0）</p>' +
        '<p class="empty">上面输入框里输一个关键词——引文里的字、出处、章节名或词条名都行——再查。</p>';
      return;
    }
    var okN = 0;
    var list = quoteIndex().filter(function (o) {
      if (QS.src !== "all" && o.src !== QS.src) return false;
      if (kw && (o.text + "\n" + o.cite + "\n" + o.chapter + "\n" + o.term).toLowerCase().indexOf(kw) === -1) return false;
      if (o.verify) okN++;
      return true;
    });
    var shown = list.slice(0, QS_CAP);
    var html = '<p class="qs-stat">命中 <b>' + list.length + "</b> 条（已核 " + okN + " · 待核 " + (list.length - okN) + "）";
    if (shown.length) {
      var payload = shown.map(function (o, i) {
        return (i + 1) + ". " + o.text + "\n——" + o.cite + "。" + (o.chapter ? "（" + o.chapter + "）" : "");
      }).join("\n\n");
      html += '　<button type="button" class="tbtn" data-copy="' + esc(payload) + '">复制这 ' + shown.length + " 条（编号列表）</button>";
    }
    html += "</p>" + shown.map(qsCard).join("");
    if (list.length > QS_CAP) html += '<p class="qs-more">还有 ' + (list.length - QS_CAP) + " 条没有列出——把关键词或来源再收窄一点。</p>";
    else if (!list.length) html += '<p class="empty">没有命中的引文。换个词，或放宽「仅显示已核」。</p>';
    out.innerHTML = html;
  }

  function bindQuoteTool() {
    var q = document.getElementById("qs-q");
    if (q) {
      q.value = QS.q;
      q.addEventListener("input", function () { QS.q = q.value; renderQuotes(); });
    }
    var s = document.getElementById("qs-src");
    if (s) {
      s.value = QS.src;
      s.addEventListener("change", function () { QS.src = s.value; renderQuotes(); });
    }
    renderQuotes();
  }

  /* —— 2) 概念对照表：挑 2—4 条词条，并排比出异同 —— */

  var CT_KEY = "capital-dict-ct-v1";
  var CT = { q: "", picks: [] };

  function ctLoad() {
    try {
      var a = JSON.parse(localStorage.getItem(CT_KEY) || "[]");
      CT.picks = Array.isArray(a) ? a.filter(function (id) { return !!BY_ID[id]; }).slice(0, 4) : [];
    } catch (e) { CT.picks = []; }
  }
  function ctSave() {
    try { localStorage.setItem(CT_KEY, JSON.stringify(CT.picks)); } catch (e) { /* 存不了就在本次会话里记 */ }
  }

  function ctSearch(kw) {
    kw = kw.trim().toLowerCase();
    if (!kw) return [];
    var hit = [];
    TERMS.forEach(function (t) {
      var hay = (t.term + " " + (t.alias || []).join(" ") + " " + (t.en || "") + " " + t.initials + " " + t.pinyin).toLowerCase();
      if (hay.indexOf(kw) > -1) hit.push(t.id);
    });
    return hit.slice(0, 8);
  }

  /* 原典直引格：取第一条已核引文；没有已核的就给第一条并说明状态 */
  function ctQuoteCell(t) {
    var os = t.original || [], best = null;
    for (var i = 0; i < os.length; i++) {
      if (os[i].text) { best = os[i]; if (os[i].verify) break; }
    }
    if (!best) return '<span class="ct-miss">本条暂无原典引文</span>';
    return "<blockquote>" + esc(best.text) + "</blockquote>" +
      '<p class="ct-qcite">' + esc(best.cite || "") + (best.verify ? "" : "（页码待核）") + "</p>";
  }

  function mdCell(s) { return String(s).replace(/\|/g, "／").replace(/\n+/g, " "); }

  function renderCompare() {
    var sugs = document.getElementById("ct-sugs");
    var picksBox = document.getElementById("ct-picks");
    var table = document.getElementById("ct-table");
    if (!sugs || !picksBox || !table) return;

    var own = ctSearch(CT.q).filter(function (id) { return CT.picks.indexOf(id) === -1; });
    sugs.innerHTML = CT.q.trim()
      ? (own.length
        ? own.map(function (id) {
            var t = BY_ID[id];
            return '<button type="button" class="ct-sug" data-act="ct-add" data-id="' + esc(id) + '">' +
              esc(t.term) + (t.en ? "<i>" + esc(t.en) + "</i>" : "") + "</button>";
          }).join("")
        : '<span class="ct-none">没有匹配的词条。</span>')
      : '<span class="ct-hint">输入关键词，从建议里点选；最多并排 4 条。</span>';

    picksBox.innerHTML = CT.picks.length
      ? CT.picks.map(function (id) {
          var t = BY_ID[id];
          return '<span class="ct-pick">' + esc(t.term) +
            '<button type="button" data-act="ct-del" data-id="' + esc(id) + '" title="从对照表移除">✕</button></span>';
        }).join("")
      : '<span class="ct-hint">还没选词条。</span>';

    if (!CT.picks.length) {
      table.innerHTML = '<p class="ct-hint">挑好 2—4 条后，这里会生成并排对照表。</p>';
      return;
    }
    var ts = CT.picks.map(function (id) { return BY_ID[id]; });
    var rows = [
      ["词条", function (t) { return '<a href="#/t/' + esc(t.id) + '"><b>' + esc(t.term) + "</b></a>"; },
        function (t) { return "[" + t.term + "](#/t/" + t.id + ")"; }],
      ["AI 的一句话", function (t) { return esc(t.oneline); }, function (t) { return t.oneline; }],
      ["标准释义", function (t) { return esc(t.standard); }, function (t) { return t.standard; }],
      ["原典直引", ctQuoteCell, function (t) {
        var os = t.original || [], best = null;
        for (var i = 0; i < os.length; i++) if (os[i].text) { best = os[i]; if (os[i].verify) break; }
        return best ? "「" + best.text + "」（" + (best.cite || "") + "。）" : "（本条暂无原典引文）";
      }],
      ["英文", function (t) { return t.en ? '<span class="ende"><span class="en">' + esc(t.en) + "</span></span>" : "—"; },
        function (t) { return t.en || "—"; }],
      ["德文", function (t) { return t.de ? '<span class="ende"><span class="de">' + esc(t.de) + "</span></span>" : "—"; },
        function (t) { return t.de || "—"; }]
    ];
    var md = "| 对照项 | " + ts.map(function (t) { return mdCell(t.term); }).join(" | ") + " |\n" +
      "|" + new Array(ts.length + 2).join(" --- |") + "\n" +
      rows.map(function (r) {
        return "| " + r[0] + " | " + ts.map(function (t) { return mdCell(r[2](t)); }).join(" | ") + " |";
      }).join("\n");

    table.innerHTML = '<div class="ct-scroll"><table class="ct-tbl"><thead><tr><th></th>' +
      ts.map(function (t) { return "<th>" + esc(t.term) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      rows.map(function (r) {
        return "<tr><th>" + r[0] + "</th>" + ts.map(function (t) { return "<td>" + r[1](t) + "</td>"; }).join("") + "</tr>";
      }).join("") + "</tbody></table></div>" +
      '<div class="q-acts"><button type="button" class="tbtn" data-copy="' + esc(md) +
      '">复制为 Markdown 表格</button></div>';
  }

  function bindCompareTool() {
    var q = document.getElementById("ct-q");
    if (q) {
      q.value = CT.q;
      q.addEventListener("input", function () { CT.q = q.value; renderCompare(); });
    }
    renderCompare();
  }

  function ctAdd(id) {
    if (!BY_ID[id] || CT.picks.indexOf(id) > -1) return;
    if (CT.picks.length >= 4) return;
    CT.picks.push(id);
    ctSave();
    renderCompare();
  }
  function ctDel(id) {
    var at = CT.picks.indexOf(id);
    if (at > -1) CT.picks.splice(at, 1);
    ctSave();
    renderCompare();
  }

  /* —— 3) 三卷目录树：卷 → 篇 → 章 → 词条，从原著位置反查术语 ——
     骨架用《资本论》三卷的篇—章区间（与 tools/check-chapters.py 同一套基准）；
     章标题不写死，从引文 chapter 字段现挖；词条落位同时认两路：
     ① 引文 chapter 解析出的位置（精确到章）；② 词条标签里的卷/篇/章。 */

  var VT_RNG = {
    1: { 1: [1, 3], 2: [4, 4], 3: [5, 9], 4: [10, 13], 5: [14, 16], 6: [17, 20], 7: [21, 24] },
    2: { 1: [1, 6], 2: [7, 17], 3: [18, 21] },
    3: { 1: [1, 7], 2: [8, 10], 3: [13, 15], 4: [16, 20], 5: [21, 36], 6: [37, 47], 7: [48, 52] }
  };
  var VT_PIAN = {
    1: ["商品和货币", "货币转化为资本", "绝对剩余价值的生产", "相对剩余价值的生产",
      "绝对剩余价值和相对剩余价值的生产", "工资", "资本的积累过程"],
    2: ["资本形态变化及其循环", "资本周转", "社会总资本的再生产和流通"],
    3: ["剩余价值转化为利润和剩余价值率转化为利润率", "利润转化为平均利润", "利润率趋向下降的规律",
      "商品资本和货币资本转化为商品经营资本和货币经营资本", "利润分为利息和企业主收入。生息资本",
      "超额利润转化为地租", "各种收入及其源泉"]
  };
  var VT_VOLNAME = { 1: "第一卷", 2: "第二卷", 3: "第三卷" };
  /* 三卷书封：由 tools/covers/make-covers.py 从扫描件轻度修图产出
     （居中裁剪、清背景、统一纸底与红字色调、锐化去噪），统一为 560×700。
     离线单文件版里这三张会被 scripts/build.mjs 就地换成 data URI。 */
  var VOL_COVER = { 1: "assets/vol-1.jpg", 2: "assets/vol-2.jpg", 3: "assets/vol-3.jpg" };
  var VOL_COVER_ALT = { 1: "《资本论》第一卷封面", 2: "《资本论》第二卷封面", 3: "《资本论》第三卷封面" };

  function zhangToPian(v, z) {
    var m = VT_RNG[v];
    for (var p = 1; p <= 7; p++) {
      if (m[p] && z >= m[p][0] && z <= m[p][1]) return p;
    }
    return null;
  }

  var _VTREE = null;
  /* 阿拉伯数字 → 中文数词（目录树的章号显示用；三卷最多五十二章） */
  function numCN(n) {
    var D = "零一二三四五六七八九";
    if (n < 10) return D[n];
    var t = Math.floor(n / 10), o = n % 10;
    return (t > 1 ? D[t] : "") + "十" + (o ? D[o] : "");
  }
  function volTree() {
    if (_VTREE) return _VTREE;
    var tree = { 1: mkVol(), 2: mkVol(), 3: mkVol() };
    var zTitle = {};   // "v.p.z" → 章标题（从引文 chapter 现挖，先到先得）

    function mkVol() { return { terms: [], pian: {}, loose: {} }; }
    function pian(v, p) {
      return tree[v].pian[p] || (tree[v].pian[p] = { terms: [], zhang: {} });
    }
    function zhang(v, p, z) {
      var P = pian(v, p);
      return P.zhang[z] || (P.zhang[z] = { n: z, title: zTitle[v + "." + p + "." + z] || "", terms: [] });
    }
    function put(arr, id) { if (arr.indexOf(id) === -1) arr.push(id); }

    /* 第一遍：挖章标题。只认「带卷号 + 带章号」的 chapter 字符串；
       篇号与章号打架时信章号——章落在哪个篇区间是固定知识。 */
    TERMS.forEach(function (t) {
      (t.original || []).forEach(function (o) {
        var ch = (o.chapter || "").replace(/^《资本论》/, "");
        var mv = /第([一二三])卷/.exec(ch);
        var mz = /第([一二三四五六七八九十百\d]+)章\s*([^·；（(]*)/.exec(ch);
        if (!mv || !mz) return;
        var v = { "一": 1, "二": 2, "三": 3 }[mv[1]];
        var z = cnInt(mz[1]);
        var mp = /第([一二三四五六七八九十百\d]+)篇/.exec(ch);
        var p = mp ? cnInt(mp[1]) : null;
        if (p == null || !VT_RNG[v][p] || z < VT_RNG[v][p][0] || z > VT_RNG[v][p][1]) p = zhangToPian(v, z);
        if (p == null) return;
        var title = mz[2].trim();
        var k = v + "." + p + "." + z;
        if (title && !zTitle[k]) zTitle[k] = title;
      });
    });

    /* 解析一个片段：命中位置就 push 进 pos，给不出篇章就进卷级 loose 桶 */
    function parseSeg(seg, v0, pos) {
      seg = seg.trim();
      var m = /第([一二三])卷/.exec(seg);
      var explicit = !!m;
      var v = m ? { "一": 1, "二": 2, "三": 3 }[m[1]] : v0;
      var mp = /第([一二三四五六七八九十百\d]+)篇/.exec(seg);
      var mz = /第([一二三四五六七八九十百\d]+)章/.exec(seg);
      var p = mp ? cnInt(mp[1]) : null;
      var z = mz ? cnInt(mz[1]) : null;
      /* 不带卷号的片段必须自己有《资本论》语境——分号后段常是
         「《1844 年经济学哲学手稿》…」这类别的著作，不能算进这一卷 */
      if (!explicit && !/资本论|卷|篇|章/.test(seg)) return;
      if (v == null && (p != null || z != null)) v = 1;   // 全库约定：不写卷的《资本论》位置都是第一卷
      if (v == null) return;
      if (z != null) {
        /* 无卷号、无篇号的裸章号：先拿章后文字与挖到的章标题互验——
           「第二章 交换过程」过，「导言与第一章」（马尔库塞）不过 */
        if (!explicit && p == null) {
          var hit = null;
          seg.split("·").forEach(function (c) {
            c = c.replace(/^第[一二三四五六七八九十百\d]+章/, "").trim();
            if (!c) return;
            Object.keys(zTitle).forEach(function (k) {
              var parts = k.split(".");
              if (+parts[2] !== z) return;
              var t = zTitle[k];
              if (t.indexOf(c) > -1 || c.indexOf(t) > -1) hit = { v: +parts[0], p: +parts[1] };
            });
          });
          if (hit) { pos.push({ v: hit.v, p: hit.p, z: z }); }
          return;
        }
        var pz = zhangToPian(v, z);
        if (pz == null) {   // 本卷没有这章：扫别的卷（「第四十八章」不写卷其实是第三卷）
          for (var vv = 1; vv <= 3; vv++) { pz = zhangToPian(vv, z); if (pz != null) { v = vv; break; } }
        }
        if (pz != null) { pos.push({ v: v, p: pz, z: z }); return; }
      }
      if (p != null && VT_RNG[v][p]) {
        /* 裸篇号且无章号：篇名与规范篇名互验一下，篇号与篇名对不上就别硬挂 */
        if (!explicit && mz == null) {
          var cands = seg.split("·").map(function (s) { return s.trim(); })
            .filter(function (s) { return s && !/^第[一二三]卷$/.test(s); });
          var okP = cands.some(function (c) {
            var title = VT_PIAN[v][p - 1];
            return title.indexOf(c) > -1 || c.indexOf(title) > -1;
          });
          if (!okP) { pos.push({ loose: v, label: cands.join(" · ") || "卷内文献" }); return; }
        }
        pos.push({ v: v, p: p, z: null });
        return;
      }
      /* 没有篇章号：拿候选文字去对挖到的章标题（双向包含，重叠最长者优先） */
      var cand = seg.split("·").map(function (s) { return s.trim(); })
        .filter(function (s) { return s && !/^第[一二三]卷$/.test(s); });
      var best = null;
      cand.forEach(function (c) {
        Object.keys(zTitle).forEach(function (k) {
          var t = zTitle[k];
          if (t.indexOf(c) > -1 || c.indexOf(t) > -1) {
            var w = Math.min(t.length, c.length);
            if (!best || w > best.w) best = { k: k, w: w };
          }
        });
        if (!best) {
          var pi = pianKwHit(c);
          if (pi) best = { k: v + "." + pi + ".", w: c.length };
        }
      });
      if (best) {
        var parts = best.k.split(".");
        pos.push({ v: +parts[0], p: +parts[1], z: parts[2] ? +parts[2] : null });
        return;
      }
      pos.push({ loose: v, label: cand.join(" · ") || "卷内文献" });
    }

    /* 词条落位：两路并认——① 引文 chapter（精确到章）；
       ② 词条标签里的卷＋篇/章；两路都给不出位置的进卷级 loose 桶。 */
    TERMS.forEach(function (t) {
      var seen = {};
      (t.original || []).forEach(function (o) {
        var ch = o.chapter || "";
        if (!/卷|篇|章/.test(ch)) return;
        /* 书名号开头但不是《资本论》的（《共产党宣言》《单向度的人》……）不进这套目录 */
        if (/^《/.test(ch) && ch.indexOf("《资本论》") !== 0) return;
        var mv0 = /第([一二三])卷/.exec(ch.replace(/^《资本论》/, ""));
        var v0 = mv0 ? { "一": 1, "二": 2, "三": 3 }[mv0[1]] : null;
        ch.split(/[；;]/).forEach(function (seg) {
          var pos = [];
          parseSeg(seg, v0, pos);
          pos.forEach(function (q) {
            if (q.loose) { put(tree[q.loose].loose[q.label] = tree[q.loose].loose[q.label] || [], t.id); return; }
            var k = q.v + "." + q.p + "." + (q.z == null ? "" : q.z);
            if (seen[k]) return;
            seen[k] = 1;
            if (q.z != null) put(zhang(q.v, q.p, q.z).terms, t.id);
            else put(pian(q.v, q.p).terms, t.id);
          });
        });
      });
      var tags = t.tags || [];
      ["第一卷", "第二卷", "第三卷"].forEach(function (vn, vi) {
        var v = vi + 1;
        if (tags.indexOf(vn) === -1) return;
        var any = false;
        tags.forEach(function (g) {
          var mp = /^第([一二三四五六七八九十百\d]+)篇$/.exec(g);
          var mz = /^第([一二三四五六七八九十百\d]+)章$/.exec(g);
          if (mp) {
            var p = cnInt(mp[1]);
            /* 引文已把词条精确挂到本篇某一章时，不再往篇节点重复挂一遍 */
            var pref = v + "." + p + ".";
            var hasZ = Object.keys(seen).some(function (k) { return k.indexOf(pref) === 0 && k !== pref; });
            if (p && VT_RNG[v][p] && !hasZ && !seen[pref]) { any = true; put(pian(v, p).terms, t.id); }
          } else if (mz) {
            var z = cnInt(mz[1]);
            var pz = z ? zhangToPian(v, z) : null;
            if (pz && !seen[v + "." + pz + "." + z]) { any = true; put(zhang(v, pz, z).terms, t.id); }
          }
        });
        /* 本卷任何位置都没落上，才算「未细分到篇」 */
        var inVol = Object.keys(seen).some(function (k) { return k.split(".")[0] == v; });
        if (!any && !inVol) put(tree[v].terms, t.id);
      });
    });

    _VTREE = tree;
    return tree;
  }

  /* 篇名兜底匹配：没有篇章号的「第三卷 · 生息资本」，拿候选文字对规范篇名 */
  var _pianKw = null;
  function pianKwHit(c) {
    if (!_pianKw) {
      _pianKw = [];
      Object.keys(VT_PIAN).forEach(function (v) {
        VT_PIAN[v].forEach(function (title, i) {
          title.split("。").forEach(function (s) {
            if (s.length >= 3) _pianKw.push([s, +v, i + 1]);
          });
        });
      });
    }
    for (var i = 0; i < _pianKw.length; i++) {
      var kw = _pianKw[i][0];
      if (kw.indexOf(c) > -1 || c.indexOf(kw) > -1) return _pianKw[i][2];
    }
    return null;
  }

  /* 目录树渲染：级联三段（2026-10-02 晚改版）。
     ① 卷长条：一整条横向大长条，三卷并排铺满一行；
     ② 选中卷后长条向左回缩成窄条（竖排三卷），右侧滑出二级菜单——
        该卷的篇 + 未细分到篇的 + 序言跋等卷内其他位置；
     ③ 在二级里选中一处后，三级菜单（章与词条明细）出现。
     数据同 volTree()；选中状态存 VT3S，跨换页保留。 */
  var VT3S = null;   // { v, sel } ；v=null 未选卷（初始大长条）；sel = { t:"pian", p } | { t:"vol" } | { t:"loose", k } | null

  function vt3Data() {
    var tree = volTree();
    var CN = ["一", "二", "三", "四", "五", "六", "七"];
    return [1, 2, 3].map(function (v) {
      var V = tree[v];
      var pians = Object.keys(V.pian).map(Number).sort(function (a, b) { return a - b; })
        .map(function (p) {
          var P = V.pian[p];
          var n = P.terms.length;
          var zs = Object.keys(P.zhang).map(Number).sort(function (a, b) { return a - b; });
          zs.forEach(function (z) { n += P.zhang[z].terms.length; });
          return { p: p, cn: CN[p - 1], name: VT_PIAN[v][p - 1], n: n, zs: zs };
        });
      var loose = Object.keys(V.loose).map(function (k) {
        return { k: k, terms: V.loose[k] };
      });
      return { v: v, name: VT_VOLNAME[v], pians: pians, loose: loose, volTerms: V.terms.slice() };
    });
  }

  function vt3TermLinks(ids) {
    return ids.map(function (id) {
      var t = BY_ID[id];
      return t ? '<a href="#/t/' + esc(t.id) + '">' + esc(t.term) + "</a>" : "";
    }).join("");
  }

  /* 三卷选项卡：原来是「《资本论》第N卷 ＋ N 条」的纯文字长条，现改为书封卡片。
     结构与首页「按门类浏览」的卡一致——主视觉在上、统计行在下（.c-meta 同款样式），
     三张等宽并排，悬停/聚焦时横向展开，所以两者看起来是同一套版式。
     文字信息没丢：卷名进了 img 的 alt（也是按钮的可读名称），条目数仍是可见的统计行。
     仍是 <button>，所以 Tab 聚焦、Enter/空格触发、全局 :focus-visible 焦点环都照旧。 */
  function vt3VolsHtml(data) {
    return data.map(function (V) {
      var n = V.volTerms.length + V.loose.reduce(function (a, l) { return a + l.terms.length; }, 0) +
        V.pians.reduce(function (a, p) { return a + p.n; }, 0);
      var on = V.v === VT3S.v;
      return '<button type="button" class="vt3-vol vt3-vol-card' + (on ? " on" : "") +
        '" data-vt="vol" data-v="' + V.v + '" aria-pressed="' + (on ? "true" : "false") + '"' +
        ' title="' + esc(VOL_COVER_ALT[V.v]) + '">' +
        '<img class="vt3-vol-cover" src="' + VOL_COVER[V.v] + '" alt="' + esc(VOL_COVER_ALT[V.v]) +
        '" width="560" height="700" decoding="async">' +
        '<em class="c-meta">' + n + " 条</em></button>";
    }).join("");
  }

  function vt3Hint() {
    if (!VT3S.v) return "选一卷开始：选完长条向左收窄，出现二级菜单选篇。";
    return VT3S.sel
      ? "换个卷直接点；中间选篇，右边看章与词条。"
      : "选一卷开始：选完长条向左收窄，出现二级菜单选篇。";
  }

  function vt3MidHtml(data) {
    if (!VT3S.v) return '<p class="empty">先在上面选一卷。</p>';
    var V = data[VT3S.v - 1];
    var s = VT3S.sel;
    var rows = V.pians.map(function (p) {
      return '<button type="button" class="vt3-row' + (s && s.t === "pian" && s.p === p.p ? " on" : "") +
        '" data-vt="pian" data-p="' + p.p + '"><span>第' + p.cn + "篇　" + esc(p.name) + "</span><em>" + p.n + "</em></button>";
    });
    if (V.volTerms.length) {
      rows.push('<button type="button" class="vt3-row' + (s && s.t === "vol" ? " on" : "") +
        '" data-vt="volterms"><span>未细分到篇</span><em>' + V.volTerms.length + "</em></button>");
    }
    if (V.loose.length) {
      rows.push('<p class="vt3-sep">序言、跋与卷内其他位置<em>' + V.loose.length + " 处</em></p>");
      V.loose.forEach(function (l) {
        rows.push('<button type="button" class="vt3-row vt3-row-loose' + (s && s.t === "loose" && s.k === l.k ? " on" : "") +
          '" data-vt="loose" data-k="' + esc(l.k) + '"><span>' + esc(l.k) + "</span><em>" + l.terms.length + "</em></button>");
      });
    }
    return rows.join("");
  }

  function vt3RightHtml(data) {
    if (!VT3S.v) return "";
    var V = data[VT3S.v - 1];
    var s = VT3S.sel;

    if (!s) {
      return '<h3 class="vt3-h">《资本论》' + esc(V.name) + "</h3>" +
        '<p class="empty">在中间一栏选一篇（或序言、跋等卷内其他位置），' +
        "这里就列出该处的章与词条。</p>";
    }

    if (s.t === "loose") {
      var l = V.loose.filter(function (x) { return x.k === s.k; })[0];
      if (!l) return '<p class="empty">这一处没有词条了。</p>';
      return '<h3 class="vt3-h">' + esc(l.k) + "<em>" + l.terms.length + " 条</em></h3>" +
        '<p class="vt-terms">' + vt3TermLinks(l.terms) + "</p>";
    }
    if (s.t === "vol") {
      return '<h3 class="vt3-h">未细分到篇<em>' + V.volTerms.length + " 条</em></h3>" +
        '<p class="note">这些词条落在' + esc(V.name) + '，但引文与标签都给不出具体篇章。</p>' +
        '<p class="vt-terms">' + vt3TermLinks(V.volTerms) + "</p>";
    }
    /* 篇：章节点用中文数字、词条落位（与原折叠面板同一套数据） */
    var P = V.pians.filter(function (x) { return x.p === s.p; })[0];
    if (!P) return '<p class="empty">这一卷没有这一篇。</p>';
    var body = P.zs.map(function (z) {
      var Z = volTree()[V.v].pian[s.p].zhang[z];
      return '<details class="vt-zhang"><summary>第' + numCN(z) + "章" +
        (Z.title ? "　" + esc(Z.title) : "") + "<em>" + Z.terms.length + "</em></summary>" +
        '<p class="vt-terms">' + vt3TermLinks(Z.terms) + "</p></details>";
    }).join("");
    var PT = volTree()[V.v].pian[s.p].terms;
    if (PT.length) {
      body += '<p class="vt-terms vt-pian-terms"><span>直接挂在本篇：</span>' + vt3TermLinks(PT) + "</p>";
    }
    return '<h3 class="vt3-h">第' + P.cn + "篇　" + esc(P.name) + "<em>" + P.n + " 条</em></h3>" +
      (body || '<p class="empty">本篇暂无词条落在具体章节。</p>');
  }

  function vt3Paint() {
    var root = document.getElementById("vt3");
    if (!root) return;
    var data = vt3Data();
    root.classList.toggle("st1", !VT3S.v);
    root.classList.toggle("st2", !!VT3S.v && !VT3S.sel);
    root.classList.toggle("st3", !!VT3S.sel);
    root.querySelector(".vt3c-strip").innerHTML = vt3VolsHtml(data) +
      '<p class="vt3-hint">' + vt3Hint() + "</p>";
    root.querySelector(".vt3c-lv2").innerHTML = vt3MidHtml(data);
    root.querySelector(".vt3c-lv3").innerHTML = vt3RightHtml(data);
  }

  function vt3Init() {
    var root = document.getElementById("vt3");
    if (!root) return;
    if (!VT3S) VT3S = { v: null, sel: null };
    root.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-vt]") : null;
      if (!b) return;
      var t = b.getAttribute("data-vt");
      if (t === "vol") {
        /* 选卷：长条收窄、二级菜单出现；三级等选完篇再出现 */
        VT3S.v = +b.getAttribute("data-v");
        VT3S.sel = null;
      } else if (t === "pian") {
        VT3S.sel = { t: "pian", p: +b.getAttribute("data-p") };
      } else if (t === "volterms") {
        VT3S.sel = { t: "vol" };
      } else if (t === "loose") {
        VT3S.sel = { t: "loose", k: b.getAttribute("data-k") };
      } else return;
      vt3Paint();
    });
  }

  function volTreeHtml() {
    if (!VT3S) VT3S = { v: null, sel: null };
    var data = vt3Data();
    var stage = !VT3S.v ? " st1" : (VT3S.sel ? " st3" : " st2");
    return '<div class="vt3c' + stage + '" id="vt3">' +
      '<div class="vt3c-strip">' + vt3VolsHtml(data) +
        '<p class="vt3-hint">' + vt3Hint() + "</p>" +
      "</div>" +
      '<div class="vt3c-lv2 vt3-pane">' + vt3MidHtml(data) + "</div>" +
      '<div class="vt3c-lv3 vt3-pane">' + vt3RightHtml(data) + "</div>" +
      "</div>";
  }

  /* ================= 写作辅助四件 =================
     检索词与检索式 · 笔记板 · 多语术语对照表。
     与阅读辅助同一套做法：控件骨架在 viewTools() 里静态摆好，
     本段只往输出格里填内容——输入框不重画，打字才不会丢焦点。
     两条纪律：
     ① 所谓「同义表述」只从站内已有数据取（词条名、别名、官方外译名），
        不替用户编词。检索式要拿去对库，词得真对得上东西；
     ② 引注解析出来的每条文献都带「著录是否完整」，缺要素的直接标出来，
        不为了表整齐而替人家猜一个出处。 */

  /* —— 1) 检索词与检索式：按知识板块取词，拼成现成检索式 —— */

  var KW = { dom: "", q: "" };

  function kwHit(dom) {
    return TERMS.filter(function (t) { return !dom || t.domain === dom; });
  }

  /* 一个词条的检索入口分三桶：
       · zh  —— 中文词条名与中文别名，进中文检索式；
       · alt —— 外文别名。这里面德文原名（Ware、Wert 这类）和英文别称混在一起，
                按字符串分不出来，所以整体单列，不往英文式里塞；
       · 英文式只放 t.en 这一条官方英译名（300 条都有，来源可控）。
     把德文当英文写进英文检索式，到了外文库一条也检不出来——宁可分开放。 */
  function kwAlias(t) {
    var zh = [], alt = [];
    (t.alias || []).forEach(function (a) {
      if (/[\u4e00-\u9fa5]/.test(a)) { if (zh.indexOf(a) === -1) zh.push(a); }
      else if (/^[A-Za-z]/.test(a)) { if (alt.indexOf(a) === -1) alt.push(a); }
    });
    return { zh: zh, alt: alt };
  }

  function kwExpr(list) {
    var zh = [], en = [], alt = [];
    list.forEach(function (t) {
      if (zh.indexOf(t.term) === -1) zh.push(t.term);
      var a = kwAlias(t);
      a.zh.forEach(function (x) { if (zh.indexOf(x) === -1) zh.push(x); });
      if (t.en && en.indexOf(t.en) === -1) en.push(t.en);
      a.alt.forEach(function (x) {
        if (x === t.en) return;                     // 与官方英译名重复的不用再列
        if (alt.indexOf(x) === -1) alt.push(x);
      });
    });
    return {
      zh: zh.length ? "(" + zh.join(" OR ") + ")" : "",
      en: en.length ? "(" + en.join(" OR ") + ")" : "",
      alt: alt.length ? "(" + alt.join(" OR ") + ")" : "",
      zhN: zh.length, enN: en.length, altN: alt.length
    };
  }

  function kwExprBox(label, text, n) {
    return '<div class="kw-expr-box"><div class="kex-head"><b>' + esc(label) + "</b>" +
      "<span>" + n + ' 个检索词</span><button type="button" class="tbtn" data-copy="' +
      esc(text) + '">复制检索式</button></div><code>' + esc(text) + "</code></div>";
  }

  /* 单个词条自己的检索式（v50 新增）。
     与 kwExpr 的区别：kwExpr 把整块词条灌进一条长式子，用于「整块复制到知网」；
     这里给的是**逐词**的入口 —— 读者往往只查一个概念，想知道这一条自己该怎么检索。
     三行分别对应 kwExpr 的三个桶，顺序与上面三个检索式框一致，便于对照：
       中文式：词条名 ＋ 中文别名（知网里把 OR 换成 + 并加 SU= 前缀）
       英文式：官方英译名（t.en，来源可控，不掺德文原名）
       其他外文式：德文原名等外文别名（与英文式分开，避免外文库一条都检不出）
     全部字段做 trim 兜底：数据里若有前后空格，检索式里会出现两个词中间多一格。 */
  function kwRowExpr(t) {
    var a = kwAlias(t);
    var out = [];
    function add(label, parts) {
      var list = [];
      if (t.term) list.push(t.term);
      parts.forEach(function (x) { if (list.indexOf(x) === -1) list.push(x); });
      list = list.map(function (s) { return String(s).trim(); })
                 .filter(function (s) { return s.length; });
      if (!list.length) return;
      out.push({ label: label, text: "(" + list.join(" OR ") + ")", n: list.length });
    }
    add("中文", a.zh);
    if (t.en) add("英文", []);
    var altOnly = a.alt.filter(function (x) { return x !== t.en; });
    if (altOnly.length) {
      out.push({
        label: "其他外文",
        text: "(" + altOnly.map(function (s) { return String(s).trim(); }).join(" OR ") + ")",
        n: altOnly.length
      });
    }
    return out;
  }

  /* 关键词过滤（v50）：分类区搜索框。匹配「分类名 ＋ 该分类下的检索词」。
     空白/无匹配都要有明确交代 —— 工具最怕的是「筛完什么都没有」却不说为什么。 */
  function kwFilter(kw, doms, dom) {
    var q = String(kw || "").trim().toLowerCase();
    if (!q) return null;
    /* 分类名也参与匹配：这样「输入科隆」既能命中分类名带「科隆」的板块，
       也能命中政治经济学板块里含「科隆」的检索词。 */
    var byDom = doms.map(function (c) {
      var nameHit = ((c.name || "") + " " + (c.short || "")).toLowerCase().indexOf(q) >= 0;
      return { c: c, nameHit: nameHit, n: kwHit(c.id).length };
    });
    var domHit = doms.some(function (c) {
      return ((c.name || "") + " " + (c.short || "")).toLowerCase().indexOf(q) >= 0;
    });
    var termHit = kwHit(dom).filter(function (t) { return kwTermHit(t, q); });
    return { q: q, byDom: byDom, domHit: domHit, termHit: termHit };
  }

  /* 命中在哪些字段上 —— 决定要不要给「一句话释义」补一列提示。
     v50 修：过滤会命中一句话释义（oneline），但那一列页面上看不见，
     于是筛出来的行「看起来跟关键词没关系」。命中在隐藏字段时，
     把该字段作为副行显示出来，读者才知道它凭什么被筛进来。 */
  function kwHitFields(t, q) {
    var a = kwAlias(t);
    var out = [];
    function hit(v, name) {
      if (v && String(v).toLowerCase().indexOf(q) >= 0) out.push({ name: name, text: String(v) });
    }
    hit(t.term, "词条");
    a.zh.forEach(function (x) { hit(x, "中文别名"); });
    hit(t.en, "英文名");
    hit(t.de, "德文原名");
    a.alt.forEach(function (x) { if (x !== t.en) hit(x, "外文别名"); });
    hit(t.oneline, "一句话释义");
    return out;
  }

  function kwTermHit(t, q) { return kwHitFields(t, q).length > 0; }

  function renderKw() {
    var out = document.getElementById("kw-out");
    if (!out) return;
    var ds = document.getElementById("kw-dom");
    if (ds) ds.value = KW.dom;

    var doms = (taxById("domain") || {}).cats || [];
    var head = '<p class="qs-stat">全站 <b>' + TERMS.length +
      "</b> 条词条按<b>知识板块</b>分三块，格子里是该块的词条数。" +
      "点一格，下面出这一块的全部词条、别名与外译名，并拼成现成的检索式。</p>";

    /* 分类区搜索框（v50）。放在计数表**之上**：它是筛选器，筛选器要在被筛的东西旁边。 */
    var f = KW.q ? kwFilter(KW.q, doms, KW.dom) : null;
    var box = '<div class="kw-find">' +
      '<label class="kw-find-lab" for="kw-q">在分类与检索词里找</label>' +
      '<div class="kw-find-row">' +
      '<input id="kw-q" class="kw-find-in" type="search" autocomplete="off" ' +
      'placeholder="按分类名或检索词过滤，如「价值」「科隆」「Wert」" value="' + esc(KW.q || "") + '">' +
      (KW.q ? '<button type="button" class="tbtn kw-find-clear" data-act="kw-clear" ' +
        'aria-label="清除搜索">清除</button>' : "") +
      "</div>" +
      (f ? '<p class="kw-find-tip">正在过滤：<b>' + esc(f.q) + "</b>　" +
        '<button type="button" class="tbtn kw-find-clear" data-act="kw-clear">显示全部</button></p>' : "") +
      "</div>";

    /* 计数表：过滤时每格显示「命中/总数」，分类名命中的整格标出来。 */
    var m = '<div class="ta-scroll"><table class="ta-tbl kw-tbl"><thead><tr>' +
      "<th>知识板块</th>" +
      doms.map(function (c) { return "<th>" + esc(c.short || c.name) + "</th>"; }).join("") +
      "<th>合计</th></tr></thead><tbody><tr><th>词条数</th>" +
      doms.map(function (c) {
        var all = kwHit(c.id);
        var n = all.length;
        var hitN = f ? all.filter(function (t) { return kwTermHit(t, f.q); }).length : n;
        var nameHit = f && ((c.name || "") + " " + (c.short || "")).toLowerCase().indexOf(f.q) >= 0;
        var on = KW.dom === c.id;
        var dim = f && !hitN && !nameHit;
        var tip = c.name + "：" + (f ? hitN + " / " + n + " 条命中「" + f.q + "」" : n + " 条");
        return '<td><button type="button" class="kw-cell' + (on ? " on" : "") +
          (nameHit ? " name-hit" : "") + (dim ? " dim" : "") + '" data-act="kw-pick" data-dom="' + esc(c.id) +
          '" title="' + esc(tip) + '">' +
          (f ? '<b>' + hitN + "</b>/" + n : (n || "·")) + "</button></td>";
      }).join("") +
      '<td class="kw-sum">' + (f ? "<b>" + f.termHit.length + "</b>/" : "") + TERMS.length + "</td>" +
      "</tr></tbody></table></div>";

    if (!KW.dom) {
      out.innerHTML = head + box + m +
        '<p class="empty">还没选板块。点上面格子里的任意一块，或从下拉里挑' +
        (f ? "；搜索框可以先按分类名缩小范围" : "") + "。</p>";
      return;
    }

    var list = kwHit(KW.dom);
    var where = catName(KW.dom) || "全部知识板块";
    if (f) list = list.filter(function (t) { return kwTermHit(t, f.q); });

    if (!list.length) {
      out.innerHTML = head + box + m +
        '<p class="empty">「' + esc(where) + "」下没有匹配「" + esc(f ? f.q : "") + "」的检索词。" +
        '换个词试试，或 <button type="button" class="tbtn kw-find-clear" data-act="kw-clear">清除搜索</button>' +
        "看这一块的全部词条。</p>";
      return;
    }
    var ex = kwExpr(kwHit(KW.dom));      /* 检索式永远按整块算，不受过滤影响 */
    var fq = f ? f.q.toLowerCase() : null;
    var tbl = list.map(function (t) {
      var a = kwAlias(t);
      function cell(v, dash) {
        return v ? esc(v) : '<span class="ta-dash">' + dash + "</span>";
      }
      /* v50 最后一列：这个词条自己的完整检索式。逐行列出、不省略、不截断 ——
         整列内容长，但读者要的就是能原样复制走的完整式子。 */
      var exs = kwRowExpr(t);
      var exCell = exs.length
        ? '<div class="kw-row-expr">' + exs.map(function (x) {
            return '<div class="kw-row-expr-line">' +
              '<span class="kw-row-expr-tag">' + esc(x.label) + "</span>" +
              '<code class="kw-row-expr-txt">' + esc(x.text) + "</code>" +
              '<button type="button" class="tbtn kw-row-expr-cp" data-copy="' + esc(x.text) +
              '" title="复制这条检索式">复制</button></div>';
          }).join("") + "</div>"
        : '<span class="ta-dash">—</span>';
      /* 命中在隐藏字段（多为「一句话释义」）上时，把该字段作为副行列出来 ——
         否则筛出来的行看上去与关键词无关，读者会以为筛错了。 */
      var why = "";
      if (fq) {
        var hf = kwHitFields(t, fq);
        why = '<div class="kw-why">命中：' + hf.map(function (x) {
          return '<span class="kw-why-tag">' + esc(x.name) + "</span>" + esc(x.text);
        }).join("　") + "</div>";
      }
      return '<tr><td><a href="#/t/' + esc(t.id) + '">' + esc(t.term) + "</a>" + why + "</td>" +
        "<td>" + cell(a.zh.join("、"), "—") + "</td>" +
        "<td>" + cell(t.en, "—") + "</td>" +
        "<td>" + cell(t.de, "—") + "</td>" +
        "<td>" + exCell + "</td></tr>";
    }).join("");
    out.innerHTML = head + box + m +
      '<p class="qs-stat">' + esc(where) + " " +
      (f ? "在「" + esc(f.q) + "」下命中 <b>" + list.length + "</b> 条（全块 " + kwHit(KW.dom).length + " 条）"
         : "命中 <b>" + list.length + "</b> 条") + "</p>" +
      '<div class="ta-scroll"><table class="ta-tbl kw-tbl-main"><thead><tr><th>词条</th><th>中文别名</th>' +
      "<th>英文名</th><th>德文原名</th><th>完整检索式</th></tr></thead><tbody>" + tbl + "</tbody></table></div>" +
      kwExprBox("中文检索式", ex.zh, ex.zhN) +
      (ex.en ? kwExprBox("英文检索式", ex.en, ex.enN) : "") +
      (ex.alt ? kwExprBox("其他外文原名（德文等）", ex.alt, ex.altN) : "") +
      '<p class="tool-hint">用法：知网「专业检索」把 <code>OR</code> 换 <code>+</code> 并加字段前缀' +
      "（如 <code>SU=</code>）；高级检索里也能直接用括号与 OR 拼。检索词只取站内已有的词条名、" +
      "别名与官方外译名——没有替你编词，编出来的词检索不到东西。英文式只放各条的官方英译名，" +
      "德文原名另起一式，不混在一起。末列是<b>这一条自己</b>的检索式，逐条可复制；" +
      "上方三个框是<b>整块</b>词条灌成的长式子（不受搜索框影响）。</p>";
  }

  /* —— 3) 笔记板（思维导图）：一张可拖拽的画布，节点＝一条想法。
     双击节点改文字，点选后按「＋」长出子节点；「导入词条」把词条页
     「我的笔记」一键挂成子节点。图存在本机 capital-mind-v1 里，与学习
     记录分开；导出 Markdown 按根到叶的层级缩进，直接贴进笔记软件。 */

  var NBM = { nodes: [], next: 1, sel: 1, loaded: false, drag: null };
  var NBM_KEY = "capital-mind-v1";
  var NBM_W = 60, NBM_H = 26;   /* 节点宽高，连线端点要用 */

  function nbItems() {
    var notes = (LR.export_() || {}).notes || {};
    return Object.keys(notes).map(function (id) { return BY_ID[id]; })
      .filter(Boolean)
      .map(function (t) { return { t: t, text: LR.getNote(t.id) }; })
      .sort(function (a, b) { return pySort(a.t, b.t); });
  }

  function nbMapLoad() {
    if (NBM.loaded) return;
    NBM.loaded = true;
    try {
      var raw = localStorage.getItem(NBM_KEY);
      if (raw) {
        var d = JSON.parse(raw);
        if (d && d.nodes && d.nodes.length) {
          NBM.nodes = d.nodes;
          NBM.next = d.next || d.nodes.length + 1;
          return;
        }
      }
    } catch (e) { /* 隐身模式等存不了就当没有 */ }
    NBM.nodes = [{ id: 1, p: 0, x: 60, y: 220, text: "《资本论》学习笔记" }];
    NBM.next = 2;
  }

  function nbMapSave() {
    try {
      localStorage.setItem(NBM_KEY, JSON.stringify({ nodes: NBM.nodes, next: NBM.next }));
    } catch (e) { /* 存不进就算了，导出仍可用 */ }
  }

  function nbMapById(id) {
    for (var i = 0; i < NBM.nodes.length; i++) if (NBM.nodes[i].id === id) return NBM.nodes[i];
    return null;
  }

  function nbMapAdd(pid, text) {
    var p = nbMapById(pid);
    if (!p) return null;
    /* 新节点落在父节点右侧；同父兄弟按序往下排，避免叠在一起 */
    var sibs = NBM.nodes.filter(function (n) { return n.p === pid; });
    var n = { id: NBM.next++, p: pid, x: p.x + 240, y: p.y + sibs.length * 56,
      text: text || "新节点" };
    NBM.nodes.push(n);
    NBM.sel = n.id;
    nbMapSave();
    return n;
  }

  function nbMapDel(id) {
    if (id === 1) return;                       /* 根节点不删 */
    var n = nbMapById(id);
    if (!n) return;
    /* 子节点上提给祖父，分枝不断 */
    NBM.nodes.forEach(function (x) { if (x.p === id) x.p = n.p; });
    NBM.nodes = NBM.nodes.filter(function (x) { return x.id !== id; });
    if (NBM.sel === id) NBM.sel = n.p;
    nbMapSave();
  }

  function nbMapImport(name) {
    var q = String(name || "").trim().toLowerCase();
    if (!q) return null;
    var t = null;
    TERMS.forEach(function (x) {
      if (t) return;
      if (x.term.toLowerCase() === q) t = x;
    });
    if (!t) TERMS.forEach(function (x) {
      if (t) return;
      if (x.term.toLowerCase().indexOf(q) === 0) t = x;
    });
    if (!t) TERMS.forEach(function (x) {
      if (t) return;
      if ((x.alias || []).some(function (a) { return String(a).toLowerCase().indexOf(q) === 0; })) t = x;
    });
    if (!t) return null;
    var note = LR.getNote(t.id) || "";
    var text = t.term + (note ? "：" + note.replace(/\s+/g, " ").slice(0, 140) : "（词条页还没写笔记）");
    return { node: nbMapAdd(NBM.sel || 1, text), term: t };
  }

  function nbMapMarkdown() {
    nbMapLoad();
    var byP = {};
    NBM.nodes.forEach(function (n) { (byP[n.p] = byP[n.p] || []).push(n); });
    var out = ["# " + String(CM.work_title || "《资本论》学习平台") + " · 笔记导图", "",
      "共 " + NBM.nodes.length + " 个节点，导出自本机笔记板。", ""];
    var root = nbMapById(1);
    if (root) out.push("- " + String(root.text || "").replace(/\n+/g, " "));
    (function walk(pid, dep) {
      (byP[pid] || []).forEach(function (n) {
        out.push(new Array(dep + 1).join("  ") + "- " + String(n.text || "").replace(/\n+/g, " "));
        walk(n.id, dep + 1);
      });
    })(1, 0);
    return out.join("\n");
  }

  function nbMapEdge(x1, y1, x2, y2) {
    /* 三次贝塞尔：从父节点右缘横向探一段再折向子节点，比直线更像导图 */
    var mx = Math.max((x1 + x2) / 2, x1 + 24);
    return '<path class="nbm-edge" d="M' + x1 + " " + y1 + " C" + mx + " " + y1 + " " +
      mx + " " + y2 + " " + x2 + " " + y2 + '"/>';
  }

  function renderNbMap() {
    var wrap = document.getElementById("nbm-wrap");
    if (!wrap) return;
    nbMapLoad();
    var CW = 1600, CH = 900;
    var edges = "", nodes = "";
    NBM.nodes.forEach(function (n) {
      if (!n.p) return;
      var p = nbMapById(n.p);
      if (p) edges += nbMapEdge(p.x + NBM_W, p.y + NBM_H / 2, n.x, n.y + NBM_H / 2);
    });
    NBM.nodes.forEach(function (n) {
      var cls = "nbm-node" + (n.id === 1 ? " nbm-root" : "") + (n.id === NBM.sel ? " nbm-sel" : "");
      nodes += '<div class="' + cls + '" style="left:' + n.x + "px;top:" + n.y + 'px" data-id="' + n.id + '">' +
        '<span class="nbm-txt">' + esc(n.text || "").replace(/\n/g, "<br>") + "</span>" +
        '<span class="nbm-btns">' +
          '<button type="button" title="加子节点" data-act="nbm-add" data-id="' + n.id + '">＋</button>' +
          (n.id === 1 ? "" :
            '<button type="button" title="删除节点" data-act="nbm-del" data-id="' + n.id + '">×</button>') +
        "</span></div>";
    });
    wrap.innerHTML =
      '<div class="nbm-canvas" id="nbm-canvas" tabindex="0" aria-label="笔记导图画布">' +
        '<svg class="nbm-svg" width="' + CW + '" height="' + CH + '" aria-hidden="true">' + edges + "</svg>" +
        nodes +
      "</div>" +
      '<p class="tool-hint">拖动节点摆放；双击改文字，回车或点别处确认；先点选一个节点，' +
      "再按它的「＋」加子节点。图只存在这台机器的浏览器里。</p>";
    nbMapBind();
  }

  function nbMapBind() {
    var canvas = document.getElementById("nbm-canvas");
    if (!canvas) return;
    canvas.addEventListener("pointerdown", function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest(".nbm-node") : null;
      if (!el || (ev.target.closest && ev.target.closest(".nbm-btns"))) return;
      var id = +el.getAttribute("data-id");
      var n = nbMapById(id);
      if (!n) return;
      NBM.sel = id;
      var nodes = canvas.querySelectorAll(".nbm-node");
      for (var i = 0; i < nodes.length; i++) {
        nodes[i].classList.toggle("nbm-sel", +nodes[i].getAttribute("data-id") === id);
      }
      NBM.drag = { id: id, sx: ev.clientX, sy: ev.clientY, ox: n.x, oy: n.y, el: el, moved: false };
      try { el.setPointerCapture(ev.pointerId); } catch (e) { /* 老浏览器不给就算了 */ }
      /* ⚠ 不在这里 preventDefault：按规范它会抑制后续兼容鼠标事件，
         dblclick（双击编辑）就再也不会触发。防误选文字由 CSS user-select 负责。 */
    });
    canvas.addEventListener("dblclick", function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest(".nbm-node") : null;
      if (!el) return;
      var n = nbMapById(+el.getAttribute("data-id"));
      if (!n) return;
      var span = el.querySelector(".nbm-txt");
      if (!span || el.querySelector("textarea")) return;
      var ta = document.createElement("textarea");
      ta.value = n.text;
      ta.rows = Math.max(2, String(n.text || "").split("\n").length);
      span.style.display = "none";
      el.insertBefore(ta, span);
      ta.focus();
      ta.select();
      function commit() {
        var v = ta.value.replace(/\s+$/, "");
        if (v) n.text = v;
        nbMapSave();
        renderNbMap();
      }
      ta.addEventListener("blur", commit);
      ta.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ta.blur(); }
        if (e.key === "Escape") { ta.value = n.text; ta.blur(); }
      });
    });
    if (!document.documentElement.__nbmMove) {
      document.documentElement.__nbmMove = true;
      document.addEventListener("pointermove", function (ev) {
        if (!NBM.drag) return;
        var d = NBM.drag;
        var nx = Math.max(4, Math.min(1440, d.ox + ev.clientX - d.sx));
        var ny = Math.max(4, Math.min(860, d.oy + ev.clientY - d.sy));
        if (Math.abs(ev.clientX - d.sx) + Math.abs(ev.clientY - d.sy) > 3) d.moved = true;
        d.el.style.left = nx + "px";
        d.el.style.top = ny + "px";
        NBM.drag.px = nx; NBM.drag.py = ny;
        nbMapRedrawEdges();
      });
      document.addEventListener("pointerup", function () {
        if (!NBM.drag) return;
        var d = NBM.drag;
        NBM.drag = null;
        if (!d.moved) return;
        var n = nbMapById(d.id);
        if (n) { n.x = d.px; n.y = d.py; nbMapSave(); }
        renderNbMap();
      });
    }
  }

  function nbMapRedrawEdges() {
    var svg = document.querySelector("#nbm-canvas .nbm-svg");
    if (!svg) return;
    var edges = "";
    NBM.nodes.forEach(function (n) {
      if (!n.p) return;
      var p = nbMapById(n.p);
      if (p) {
        var np = NBM.drag && NBM.drag.id === n.id ? { x: NBM.drag.px, y: NBM.drag.py } : n;
        var pp = NBM.drag && NBM.drag.id === p.id ? { x: NBM.drag.px, y: NBM.drag.py } : p;
        edges += nbMapEdge(pp.x + NBM_W, pp.y + NBM_H / 2, np.x, np.y + NBM_H / 2);
      }
    });
    svg.innerHTML = edges;
  }

  function nbMapSay(msg) {
    var m = document.getElementById("nbm-msg");
    if (m) m.textContent = msg;
  }

  /* Markdown 表格：单元格里的竖线要转义，否则一张表就散了 */
  function mdTable(rows) {
    return ["| " + rows[0].join(" | ") + " |",
      "| " + rows[0].map(function () { return "---"; }).join(" | ") + " |"]
      .concat(rows.slice(1).map(function (r) {
        return "| " + r.map(function (c) {
          return String(c == null ? "" : c).replace(/\|/g, "\\|");
        }).join(" | ") + " |";
      })).join("\n");
  }

  var MT = { q: "", scope: "all", doms: [] };   /* v57：doms＝板块批量筛选，勾中的知识板块 id 列表 */

  function mtList() {
    var kw = MT.q.trim().toLowerCase();
    return TERMS.filter(function (t) {
      if (MT.scope === "de" && !t.de) return false;
      if (MT.scope.slice(0, 2) === "d:" && t.domain !== MT.scope.slice(2)) return false;
      /* v57：板块批量筛选——勾了若干块时只留这些块里的词条（与上面的单选叠加） */
      if (MT.doms.length && MT.doms.indexOf(t.domain) < 0) return false;
      if (kw) {
        var hay = [t.term, t.en || "", t.de || "", (t.alias || []).join(" "), t.pinyin].join(" ");
        if (hay.toLowerCase().indexOf(kw) === -1) return false;
      }
      return true;
    }).sort(function (a, b) { return pySort(a, b); });
  }

  function mtRows() {
    return [["中文", "英文", "德文", "别名", "知识板块"]].concat(
      mtList().map(function (t) {
        return [t.term, t.en || "", t.de || "", (t.alias || []).join("、"),
          catName(t.domain)];
      }));
  }

  function renderMt() {
    var out = document.getElementById("mt-out");
    if (!out) return;
    var q = document.getElementById("mt-q"), sc = document.getElementById("mt-scope");
    if (q) q.value = MT.q;
    if (sc) sc.value = MT.scope;
    /* v57：板块勾选块的选中态跟着 MT.doms 回填（面板壳不动，只有勾要翻） */
    var domBox = document.getElementById("mt-doms");
    if (domBox) {
      domBox.querySelectorAll("input[data-dom]").forEach(function (inp) {
        inp.checked = MT.doms.indexOf(inp.getAttribute("data-dom")) >= 0;
      });
    }

    var list = mtList();
    var deN = TERMS.filter(function (t) { return t.de; }).length;
    var head = '<p class="qs-stat">全站 <b>' + TERMS.length + "</b> 条词条，英文名 <b>" +
      TERMS.filter(function (t) { return t.en; }).length + "</b> 条、德文原名 <b>" + deN +
      "</b> 条（德文只收哲学类）。当前筛出 <b>" + list.length + "</b> 条" +
      (MT.doms.length ? "（已勾 " + MT.doms.length + " 个板块）" : "") + "。</p>";
    if (!list.length) {
      out.innerHTML = head + '<p class="empty">没有匹配的词条。</p>';
      return;
    }
    out.innerHTML = head +
      '<div class="ta-scroll"><table class="ta-tbl mt-tbl"><thead><tr>' +
      "<th>中文</th><th>英文</th><th>德文</th><th>别名</th><th>知识板块</th>" +
      "</tr></thead><tbody>" + list.map(function (t) {
        function c(v, cls) {
          return v ? '<td class="' + (cls || "") + '">' + esc(v) + "</td>"
            : '<td class="ta-dash">—</td>';
        }
        return '<tr><td><a href="#/t/' + esc(t.id) + '">' + esc(t.term) + "</a></td>" +
          c(t.en, "mt-en") + c(t.de, "mt-de") + c((t.alias || []).join("、")) +
          "<td>" + esc(catShort(t.domain)) + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      '<p class="tool-hint">英译依《马克思恩格斯全集》英文版（MECW）与 Penguin 英译本，' +
      "时政术语依官方外译；德文原名依《马克思恩格斯全集》德文版（MEW）。" +
      "要对某一条的译法提异议，以词条页的出处为准。</p>";
  }

  /* —— 四件的导出：xlsx / Word / Markdown / CSV —— */

  function dlText(fname, text, mime) {
    dlBytes(fname, new TextEncoder().encode(text), mime || "text/plain;charset=utf-8");
  }

  function mtBlocks() {
    return [
      { t: "title", text: "多语术语对照表" },
      { t: "sub", text: String(CM.work_title || "") },
      { t: "p", text: "中文、英文、德文三列对照。英译依 MECW 与 Penguin 英译本及官方外译，" +
        "德文原名依 MEW；德文项只覆盖哲学类词条，空格表示该条未收德文原名。" },
      { t: "table", rows: mtRows(), widths: [1600, 2600, 2600, 1800, 1600] }
    ];
  }

  function nbBlocks() {
    var items = nbItems();
    var b = [
      { t: "title", text: "读书笔记" },
      { t: "sub", text: String(CM.work_title || "") + " · 共 " + items.length + " 条" },
      { t: "sub", text: cmAuthorLine() || "作者：（待填）" }
    ];
    nbGroups().forEach(function (g) {
      if (g.key) b.push({ t: "h2", text: g.name + "（" + g.items.length + " 条）" });
      g.items.forEach(function (x) {
        b.push({ t: "h3", text: x.t.term });
        b.push({ t: "p", text: x.text });
      });
    });
    return b;
  }

  function kwBlocks() {
    var all = kwHit(KW.dom);
    var list = KW.q ? all.filter(function (t) { return kwTermHit(t, String(KW.q).trim().toLowerCase()); }) : all;
    var ex = kwExpr(all);
    var where = KW.dom ? catName(KW.dom) : "全部知识板块";
    var rows = [["词条", "中文别名", "英文名", "德文原名", "完整检索式"]].concat(
      list.map(function (t) {
        return [t.term, kwAlias(t).zh.join("、"), t.en || "", t.de || "",
          kwRowExpr(t).map(function (x) { return x.label + "式：" + x.text; }).join("\n")];
      }));
    var b = [
      { t: "title", text: "检索词与检索式" },
      { t: "sub", text: where + " · 共 " + all.length + " 条词条" },
      { t: "h2", text: "一、中文检索式" },
      { t: "p", text: ex.zh || "（无）" },
      { t: "h2", text: "二、英文检索式" },
      { t: "p", text: ex.en || "（本组合下的词条没有英文名）" },
      { t: "h2", text: "三、其他外文原名（德文等）" },
      { t: "p", text: ex.alt || "（本组合下的词条没有别名外文）" },
      { t: "h2", text: "四、检索词清单" }
    ];
    /* v50：清单表同步加「完整检索式」列，与页面所见一致；搜索框的过滤也一并反映。
       三个长式子仍按整块给（不受过滤影响），与页面上方三个框的口径相同。 */
    if (KW.q) b.push({ t: "p", text: "（导出时按「" + KW.q + "」过滤，" + list.length + " / " + all.length + " 条）" });
    b.push({ t: "table", rows: rows, widths: [1500, 1900, 1500, 1500, 5100] });
    return b;
  }



  function mtMarkdown() {
    return ["# 多语术语对照表", "",
      "中文、英文、德文三列对照；英译依 MECW 与 Penguin 英译本及官方外译，德文原名依 MEW。", "",
      mdTable(mtRows())].join("\n");
  }

  function mtCsv() {
    return mtRows().map(function (r) {
      return r.map(function (c) {
        var s = String(c == null ? "" : c);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(",");
    }).join("\r\n");
  }

  function bindWriteTools() {
    var ds = document.getElementById("kw-dom");
    if (ds) ds.addEventListener("change", function () { KW.dom = ds.value; renderKw(); });
    /* v50：分类区搜索框。
       ⚠ 不能像下面 REF.q / MT.q 那样「取元素 → addEventListener」——
         输入框在 #kw-out 内部，而 renderKw() 整体重写 innerHTML，
         元素连同它的监听一起被销毁 ⇒ 第一个字符之后监听就没了，过滤永远不生效。
         所以这里绑在 #view 上做**事件委托**（#view 不会被重绘，只换 innerHTML），
         监听只装一次、一直有效。顺带把 REF.q、MT.q 也改成同样的委托写法 ——
         它们有完全相同的缺陷，只是恰好还没被用户察觉。 */
    var inputHandler = function (ev) {
      var el = ev.target;
      if (!el || el.tagName !== "INPUT") return;
      if (el.id === "kw-q") {
        var at = el.selectionStart, sc = el.scrollTop;
        KW.q = el.value;
        renderKw();
        var nq = document.getElementById("kw-q");
        /* 重绘换了元素，焦点与光标都要还回去，否则打第二个字就断了 */
        if (nq) {
          nq.focus();
          try { nq.setSelectionRange(at, at); } catch (e) { /* 旧浏览器不给 setSelectionRange */ }
          nq.scrollTop = sc;
        }
      }
      else if (el.id === "mt-q") { MT.q = el.value; renderMt(); }
    };
    if (!app.__kwDelegated) {
      app.addEventListener("input", inputHandler);
      app.__kwDelegated = true;
    }
    var mq = document.getElementById("mt-q"), ms = document.getElementById("mt-scope");
    if (ms) ms.addEventListener("change", function () { MT.scope = ms.value; renderMt(); });
    /* v57：板块批量筛选——面板壳是静态的，勾选块监听在这里绑一次即可 */
    var mdoms = document.getElementById("mt-doms");
    if (mdoms) mdoms.addEventListener("change", function (e) {
      var inp = e.target;
      if (!inp || !inp.hasAttribute || !inp.hasAttribute("data-dom")) return;
      var d = inp.getAttribute("data-dom");
      var at = MT.doms.indexOf(d);
      if (inp.checked && at < 0) MT.doms.push(d);
      if (!inp.checked && at >= 0) MT.doms.splice(at, 1);
      renderMt();
    });
    /* mt-q 的 input 监听同样已移到委托里 */
    renderKw(); renderMt(); renderNbMap();
  }


  /* ================================================================
     学习与记忆：自测引擎 · 间隔重复卡 · 生词卡导出
     四件共用同一批本机数据（LR 里的已读、生词、错题、打卡、排期），
     题目与卡片都从既有词条现场生成，不另存一份题库——改了词条，题跟着变。
     ================================================================ */

  /* 确定性伪随机：同一个种子出同一套题。自测脚本靠它复现选出来的题，
     正常使用时种子取时间戳，每次点「出题」都是新的一组。 */
  function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  function shuffled(arr, r) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function todayKey() { return dayKey(new Date()); }
  /* n 天后的日期键。取正午为基准，避免跨夏令时那天算差一天 */
  function dayShift(n) {
    var d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n);
    return dayKey(d);
  }
  /* 题面里把答案本身挖掉。引文原句十有八九写着「剩余价值」四个字，
     不挖就是白送答案——挖成〔　　〕反而更像一道填空题。
     注意转义要用函数写：build.mjs 把本文件内联进单文件版时，是拿一整段字符串
     当替换文本的，字符串里一旦出现「dollar 加 &」这种替换模式，就会被解释成
     「把整个匹配原样贴上」，把 <script src=...> 又插回去，内联当场失败。
     所以本文件里连注释都不写那种写法。 */
  function qzMask(text, term) {
    var lit = String(term).replace(/[.*+?^${}()|[\]\\]/g, function (m) { return "\\" + m; });
    return String(text).replace(new RegExp(lit, "g"), "〔　　〕");
  }

  /* ---------------- 出题 ---------------- */

  /* 抽题范围。一条口径，自测与生词卡共用：错题本来是「练错题」，
     生词卡想单独导出错题本时也走这里。 */
  function quizPool(scope) {
    var all = TERMS;
    if (!scope || scope === "all") return all.slice();
    if (scope === "read") return all.filter(function (t) { return LR.isRead(t.id); });
    if (scope === "star") return LR.starTerms();
    if (scope === "wrong") {
      return LR.quizWrongIds().map(function (id) { return BY_ID[id]; }).filter(Boolean);
    }
    if (scope.indexOf("d:") === 0) {
      var d = scope.slice(2);
      return all.filter(function (t) { return t.domain === d; });
    }
    return all.slice();
  }

  function scopeCount(scope) { return quizPool(scope).length; }

  /* 范围下拉：与自测、生词卡两处共用，数出来的条数当场算，别写死 */
  function scopeOpts(cur) {
    function opt(v, label, n) {
      return '<option value="' + esc(v) + '"' + (v === cur ? " selected" : "") + ">" +
        esc(label) + "（" + n + " 条）</option>";
    }
    var h = '<optgroup label="整体">' +
      opt("all", "全部词条", TERMS.length) +
      opt("read", "只取已读", LR.readCount()) +
      opt("star", "只取生词本", LR.starCount()) +
      opt("wrong", "只取错题本", LR.quizWrongCount()) + "</optgroup>";
    h += '<optgroup label="按知识板块">' + ((taxById("domain") || {}).cats || []).map(function (c) {
      return opt("d:" + c.id, c.name, scopeCount("d:" + c.id));
    }).join("") + "</optgroup>";
    return h;
  }

  /* 四道题型：
       A 释义猜词  B 引文猜词  C 译名猜词  D 争鸣猜词
     每题三只干扰项优先从同一知识板块里挑——跨板块的词一眼就能排掉，
     题目就没了难度。池子不够三轮就返回 null，由出题循环换个题型再试。 */
  var QKIND = ["A", "B", "C", "D"];
  function quizItem(t, kind, pool, r) {
    var others = shuffled(pool.filter(function (x) { return x.id !== t.id; }), r);
    var same = others.filter(function (x) { return x.domain === t.domain; });
    var picks = [], used = {};
    function take(list) {
      for (var i = 0; i < list.length && picks.length < 3; i++) {
        if (used[list[i].id]) continue;
        picks.push(list[i]); used[list[i].id] = 1;
      }
    }
    take(same); take(others);
    if (picks.length < 3) return null;       // 池子太小，凑不出四选一

    var stem, note = "";
    if (kind === "A") {
      if (!t.oneline) return null;
      stem = "下面这句释义说的是哪一条术语？<b>「" + esc(qzMask(t.oneline, t.term)) + "」</b>";
    } else if (kind === "B") {
      var o = (t.original || []).filter(function (x) { return x.text; })[0];
      if (!o) return null;
      stem = "下面这段引文出自《资本论》的哪一条术语？<b>「" + esc(qzMask(o.text, t.term)) + "」</b>";
      if (o.chapter) note = o.chapter;
    } else if (kind === "C") {
      if (!t.en) return null;
      stem = "下面这个译名对应站内哪一条术语？<b>" + esc(t.en) + "</b>";
      if (t.de) note = "德文原名 " + t.de;
    } else {
      var g = (t.scholars || []).filter(function (x) { return x.focus; })[0];
      if (!g) return null;
      stem = "学界围绕下面这个问题的争论，集中在哪一条术语上？<b>「" +
        esc(qzMask(g.focus, t.term)) + "」</b>";
    }
    var opts = shuffled([t].concat(picks), r);
    return {
      kind: kind, id: t.id, stem: stem, note: note, right: opts.indexOf(t),
      opts: opts.map(function (x) { return { id: x.id, text: x.term }; })
    };
  }

  /* 出卷：四种题型轮流来，一个词条最多贡献一题，凑够 n 道为止 */
  function quizBuild(scope, n, seed) {
    var pool = quizPool(scope);
    if (pool.length < 4) return [];
    var r = rng(seed), order = shuffled(pool, r), out = [], ki = 0;
    for (var i = 0; i < order.length && out.length < n; i++) {
      for (var k = 0; k < 4; k++) {
        var kind = QKIND[(ki + k) % 4];
        var it = quizItem(order[i], kind, pool, r);
        if (it) { out.push(it); ki = (ki + k + 1) % 4; break; }
      }
    }
    return out;
  }

  /* 判定一题对错：题面里给的是选项下标，用户点的也是下标 */
  function quizMark(items, answers) {
    var ok = 0, wrongIds = [], rightIds = [];
    items.forEach(function (it, i) {
      if (answers[i] === it.right) { ok++; rightIds.push(it.id); }
      else wrongIds.push(it.id);
    });
    return { ok: ok, n: items.length, wrongIds: wrongIds, rightIds: rightIds };
  }

  /* ---------------- 自测引擎：状态与渲染 ---------------- */

  var QZ = { scope: "all", n: 10, seed: 1, paper: [], answers: {}, graded: false, result: null };

  function quizReset(scope, n) {
    QZ.scope = scope;
    QZ.n = n;
    QZ.seed = (Date.now() % 1000000) + 1;
    QZ.paper = quizBuild(QZ.scope, QZ.n, QZ.seed);
    QZ.answers = {};
    QZ.graded = false;
    QZ.result = null;
  }

  function renderQuiz() {
    var box = document.getElementById("qz-body");
    if (!box) return;
    box.innerHTML = quizBodyHTML();
  }

  function quizBodyHTML() {
    if (!QZ.paper.length) {
      var n = scopeCount(QZ.scope);
      return '<p class="qz-empty">这个范围里有 ' + n + " 条词条，凑不出四选一的题。" +
        (n < 4 ? "先读几条、标几条生词，或者把范围放宽。" : "") +
        '<a href="#/tools/quiz">换个范围 →</a></p>';
    }
    var html = "";
    if (QZ.graded && QZ.result) {
      var rs = QZ.result;
      var rate = Math.round(rs.ok / rs.n * 100);
      html += '<div class="qz-score' + (rate >= 80 ? " good" : (rate >= 60 ? "" : " bad")) + '">' +
        "答对 <b>" + rs.ok + "</b> / " + rs.n + " 题 · 正确率 <b>" + rate + "%</b>" +
        (rs.wrongIds.length
          ? " · " + rs.wrongIds.length + " 条错题已进错题本"
          : " · 全对，错题本已清空") +
        '<span class="qz-score-tip">错题留在错题本里，' +
        "<code>间隔重复卡</code>会把它和生词一起排期复习。</span></div>";
    }
    QZ.paper.forEach(function (it, i) {
      var picked = QZ.answers[i];
      html += '<div class="qz-item' + (QZ.graded ? (picked === it.right ? " ok" : " no") : "") + '" data-i="' + i + '">' +
        '<p class="qz-q"><span class="qz-no">' + (i + 1) + "</span>" +
          '<span class="qz-kind">' + (QUIZ_KINDNAME[it.kind] || "") + "</span>" +
          it.stem + "</p>" +
        (it.note ? '<p class="qz-note">' + esc(it.note) + "</p>" : "") +
        '<div class="qz-opts">' + it.opts.map(function (o, j) {
          var cls = "qz-opt";
          if (QZ.graded) {
            if (j === it.right) cls += " right";
            else if (j === picked) cls += " wrong";
          } else if (j === picked) cls += " pick";
          return '<label class="' + cls + '">' +
            '<input type="radio" name="qz' + i + '" value="' + j + '"' +
              (j === picked ? " checked" : "") + (QZ.graded ? " disabled" : "") + ">" +
            "<span>" + esc(o.text) + "</span></label>";
        }).join("") + "</div>" +
        (QZ.graded
          ? '<p class="qz-exp">' + (picked === it.right
              ? '<b class="ok">✓ 答对</b>'
              : '<b class="no">✗ 答错</b>，正确项是「' + esc(it.opts[it.right].text) + "」") +
            ' <a href="#/t/' + esc(it.id) + '">看这条词条 →</a></p>'
          : "") +
        "</div>";
    });
    return html;
  }

  var QUIZ_KINDNAME = { A: "释义猜词", B: "引文猜词", C: "译名猜词", D: "争鸣猜词" };

  /* 「这个范围共 N 条 · 本卷 M 题 · 已答 K 题」。答题时只更新这一行，
     不重画整卷——重画会把刚点中的单选框连同滚动位置一起冲掉。 */
  function qzMetaHTML() {
    var picked = Object.keys(QZ.answers).length;
    return "这个范围共 <b>" + scopeCount(QZ.scope) + "</b> 条词条，本卷 <b>" + QZ.paper.length +
      "</b> 题" + (QZ.graded ? "" : "，已答 <b>" + picked + "</b> 题");
  }

  function quizPanel() {
    if (!QZ.inited) { QZ.inited = 1; quizReset(QZ.scope, QZ.n); }
    return '<section class="tool-card" id="quiz">' +
      "<h2>自测引擎</h2>" +
      '<p class="tool-sub">从站内数据现场出题，四种题型：<b>释义猜词</b>（给 AI 的一句话解释，猜是哪条术语）、' +
      "<b>引文猜词</b>（给一段原典引文，猜它说的是哪条术语）、" +
      "<b>译名猜词</b>（给官方英文译名，猜中文词条）、" +
      "<b>争鸣猜词</b>（给学界争论的焦点问题，猜争的是哪条术语）。" +
      "题干里出现的答案本身一律挖成〔　　〕，免得答案就写在题面上；" +
      "干扰项优先从同一知识板块里挑，跨板块的词一眼就能排掉，题就没难度了。" +
      "判卷后错题自动进错题本，交给间隔重复卡排期复习。</p>" +
      '<div class="qz-bar">' +
        '<label class="wa-lab">范围<select id="qz-scope" class="qs-select">' + scopeOpts(QZ.scope) + "</select></label>" +
        '<label class="wa-lab">题量<select id="qz-n" class="qs-select">' +
          [10, 20, 30].map(function (x) {
            return '<option value="' + x + '"' + (x === QZ.n ? " selected" : "") + ">" + x + " 题</option>";
          }).join("") + "</select></label>" +
        '<button class="tt-btn primary" type="button" data-act="qz-new">' +
          (QZ.paper.length ? "换一组题" : "出题") + "</button>" +
        '<button class="tt-btn" type="button" data-act="qz-wrong"' +
          (LR.quizWrongCount() ? "" : " disabled") + ">只练错题（" + LR.quizWrongCount() + "）</button>" +
      "</div>" +
      '<p class="qz-meta" id="qz-meta">' + qzMetaHTML() + "</p>" +
      '<div id="qz-body">' + quizBodyHTML() + "</div>" +
      (QZ.paper.length
        ? '<div class="wa-acts">' +
            (QZ.graded
              ? '<button class="tt-btn primary" type="button" data-act="qz-new">再来一组</button>' +
                '<button class="tt-btn" type="button" data-act="qz-wrong"' +
                (LR.quizWrongCount() ? "" : " disabled") + ">练错题（" + LR.quizWrongCount() + "）</button>"
              : '<button class="tt-btn primary" type="button" data-act="qz-submit">交卷判分</button>' +
                '<button class="tt-btn" type="button" data-act="qz-clear">清空作答</button>') +
          "</div>"
        : "") +
      "</section>";
  }

  /* ---------------- 间隔重复卡 ---------------- */

  /* 队列 = 生词本 ∪ 错题本。两个来源都是「还没记住的」，合并去重，
     没排期的当新卡（今天到期）。 */
  function srsQueue() {
    var ids = {}, today = todayKey();
    LR.starIds().forEach(function (id) { ids[id] = 1; });
    LR.quizWrongIds().forEach(function (id) { ids[id] = 1; });
    var out = [];
    Object.keys(ids).forEach(function (id) {
      var t = BY_ID[id];
      if (!t) return;                       // 词条可能已被删除，静默跳过
      var c = LR.srsGet(id);
      out.push({
        id: id, t: t, c: c,
        dueKey: (c && c.due) ? c.due : "0000-00-00",
        due: !c || !c.due || c.due <= today
      });
    });
    out.sort(function (a, b) {
      if (a.dueKey !== b.dueKey) return a.dueKey < b.dueKey ? -1 : 1;
      return pySort(a.t, b.t);
    });
    return out;
  }

  /* 简化版 SM-2：三档自评。
       忘了 → 归零，今天再出现一次；难度因子下调（下限 1.3）
       一般 → 间隔 ×1.2 往上长，最短 1 天
       记得 → 间隔 ×难度因子，首答直接给 3 天；难度因子上调（上限 2.8） */
  function srsGrade(id, q) {
    var today = todayKey();
    var c = LR.srsGet(id) || { iv: 0, ef: 2.5, reps: 0, lapses: 0, last: "" };
    var iv = c.iv || 0, ef = c.ef || 2.5, reps = c.reps || 0;
    if (q === 0) {
      reps = 0; iv = 0;
      ef = Math.max(1.3, ef - 0.2);
      c.lapses = (c.lapses || 0) + 1;
    } else if (q === 1) {
      reps++;
      iv = reps <= 1 ? 1 : Math.max(1, Math.round(iv * 1.2));
    } else {
      reps++;
      iv = reps <= 1 ? 3 : Math.max(2, Math.round(iv * ef));
      ef = Math.min(2.8, ef + 0.1);
    }
    var next = { iv: iv, ef: ef, reps: reps, lapses: c.lapses || 0,
                 last: today, due: dayShift(iv), grade: q };
    LR.srsSet(id, next);
    return next;
  }

  /* 提前复习：把还没到期的卡一律拉到今天。与其另做一个「无视排期硬刷」的模式，
     不如就让排期本身提前——语义清楚，评完之后间隔照常往上走。 */
  function srsPullForward() {
    var today = todayKey(), all = LR.srsAll(), n = 0;
    Object.keys(all).forEach(function (id) {
      var c = all[id];
      if (c && c.due && c.due > today) { c.due = today; LR.srsSet(id, c); n++; }
    });
    return n;
  }

  /* 卡片背面：AI 的一句话、标准释义、第一条已核原典引文。复习时看的就是这些。 */
  function cardBackHTML(t) {
    var o = (t.original || []).filter(function (x) { return x.text; })[0];
    return '<p class="sc-oneline">' + esc(t.oneline) + "</p>" +
      '<p class="sc-std">' + esc(t.standard) + "</p>" +
      (o ? "<blockquote>" + esc(o.text) + '</blockquote><p class="sc-cite">' +
        esc(o.cite || "") + (o.chapter ? "（" + esc(o.chapter) + "）" : "") + "</p>"
        : '<p class="sc-cite">这条没有已核原典引文，当代切口见词条页。</p>');
  }
  /* 卡片背面的纯文本版，供 Markdown / Anki 用 */
  function cardBackText(t) {
    var o = (t.original || []).filter(function (x) { return x.text; })[0];
    return t.oneline + (o ? " ｜ " + o.text + "（" + (o.cite || "") + "）" : "");
  }

  var SRS = { show: false };

  function renderSrs() {
    var box = document.getElementById("srs-body");
    if (!box) return;
    box.innerHTML = srsBodyHTML();
    var n = document.getElementById("srs-done");
    if (n) n.textContent = srsDoneToday() + " 张";
  }

  /* 今天评过几张：卡片上记着 last === 今天且刚评过（grade 字段有值） */
  function srsDoneToday() {
    var today = todayKey(), all = LR.srsAll(), n = 0;
    Object.keys(all).forEach(function (id) { if (all[id] && all[id].last === today) n++; });
    return n;
  }

  function srsBodyHTML() {
    var q = srsQueue();
    if (!q.length) {
      return '<p class="srs-empty">队列是空的。先去词条页把没把握的标进<b>生词本</b>，' +
        "或者做一轮<b>自测</b>——错的题会自动进错题本，两边的东西都会排到这里来。</p>";
    }
    var cur = null;
    for (var i = 0; i < q.length; i++) if (q[i].due) { cur = q[i]; break; }
    if (!cur) {
      var next = q[0];
      return '<p class="srs-empty">今天的卡都复习完了。<b>下一批到期：' + esc(next.dueKey) +
        "</b>（最早的是「" + esc(next.t.term) + "」）。" +
        "队列里共 " + q.length + " 张卡，先把没记住的再看一遍也行——" +
        '<button class="tt-btn" type="button" data-act="srs-again">提前复习</button></p>';
    }
    var c = cur.c;
    var stage = !c ? "新卡" : (c.reps === 0 ? "重来" : "第 " + c.reps + " 次");
    return '<div class="srs-card" data-id="' + esc(cur.id) + '">' +
      '<div class="sc-face">' +
        '<p class="sc-k">正面 · ' + esc(stage) + "</p>" +
        "<h3>" + esc(cur.t.term) + "</h3>" +
        '<p class="sc-py">' + esc(cur.t.pinyin) + " · " + esc(cur.t.initials) +
          (cur.t.en ? " · " + esc(cur.t.en) : "") + "</p>" +
        '<p class="sc-tag">' + esc(catName(cur.t.domain)) + "</p>" +
      "</div>" +
      '<div class="sc-back"' + (SRS.show ? "" : " hidden") + ">" +
        '<p class="sc-k">背面</p>' + cardBackHTML(cur.t) +
        '<p class="sc-lr"><a href="#/t/' + esc(cur.id) + '">打开这条词条 →</a>' +
          '<span>上次复习：' + esc((c && c.last) || "—") + " · 当前间隔 " +
          ((c && c.iv) || 0) + " 天 · 难度 " + ((c && c.ef) || 2.5).toFixed(2) + "</span></p>" +
      "</div>" +
      /* 评分按钮放在卡片里面：处理点击时要靠 closest(".srs-card") 认出评的是哪张卡 */
      '<div class="srs-acts">' +
        (SRS.show
          ? '<button class="tt-btn srs-b bad" type="button" data-act="srs-0">忘了<span>今天就再来</span></button>' +
            '<button class="tt-btn srs-b" type="button" data-act="srs-1">一般<span>间隔略延长</span></button>' +
            '<button class="tt-btn srs-b good" type="button" data-act="srs-2">记得<span>间隔成倍延长</span></button>'
          : '<button class="tt-btn primary" type="button" data-act="srs-show">显示答案</button>') +
      "</div>" +
      "</div>" +
      '<p class="srs-foot">剩余到期 <b>' + q.filter(function (x) { return x.due; }).length +
        "</b> 张 · 队列共 <b>" + q.length + "</b> 张 · 今日已复习 <b>" +
        srsDoneToday() + "</b> 张</p>";
  }

  function srsPanel() {
    var q = srsQueue();
    var due = q.filter(function (x) { return x.due; }).length;
    var sched = q.filter(function (x) { return x.c; }).length;
    SRS.show = false;
    return '<section class="tool-card" id="srs">' +
      "<h2>间隔重复卡</h2>" +
      '<p class="tool-sub">把<b>生词本</b>和<b>自测错题</b>合成一个队列，按遗忘曲线排期：' +
      "一道卡自评「忘了／一般／记得」，间隔按 0 → 1 → 3 → 天数×难度 的节奏往上走，" +
      "记不牢就退回当天重来。只在本机排期，不注册、不同步。</p>" +
      '<div class="srs-stat">' +
        "<span><b>" + q.length + "</b> 张在队列</span>" +
        "<span><b>" + due + "</b> 张今天到期</span>" +
        "<span><b>" + sched + "</b> 张已排期</span>" +
        '<span>今日已复习 <b id="srs-done">' + srsDoneToday() + "</b></span>" +
        (q.length ? '<button class="tt-btn" type="button" data-act="srs-reset">重新排期</button>' : "") +
      "</div>" +
      '<div id="srs-body">' + srsBodyHTML() + "</div>" +
      '<p class="srs-note">排期按三档自评（记得、模糊、忘了）调整间隔：记得就拉长，模糊就缩短，忘了从头再来。' +
      "「忘了」把次数清零、难度因子降 0.2（不低于 1.3），「记得」把间隔乘上难度因子、" +
      "因子升 0.1（不超过 2.8）。要的就是让熟悉的卡越走越远，不熟的卡反复出现。</p>" +
      "</section>";
  }

  /* ---------------- 生词卡导出 ---------------- */

  var CD = { scope: "star" };

  /* 一张卡：正面词条与译名，背面释义加引文 */
  function cardRows(scope) {
    return quizPool(scope).map(function (t) {
      return {
        id: t.id,
        front: t.term + (t.en ? "（" + t.en + "）" : ""),
        back: cardBackText(t),
        term: t.term, en: t.en || "", de: t.de || "",
        oneline: t.oneline,
        cite: ((t.original || []).filter(function (x) { return x.text; })[0] || {}).text || ""
      };
    });
  }

  /* CSV 单元格：字段里有逗号、引号、换行必须整格加引号，内部引号翻倍。
     Anki 的 CSV 导入与 Excel 都认这一套。 */
  function csvCell(s) {
    s = String(s == null ? "" : s);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function cardCsv(rows) {
    return ["front,back"].concat(rows.map(function (r) {
      return csvCell(r.front) + "," + csvCell(r.back);
    })).join("\r\n") + "\r\n";
  }
  function cardMarkdown(rows) {
    function cell(s) { return String(s || "").replace(/\|/g, "\\|").replace(/\n/g, "<br>"); }
    return "# 术语卡（" + rows.length + " 张）\n\n| 正面 | 背面 |\n| --- | --- |\n" +
      rows.map(function (r) { return "| " + cell(r.front) + " | " + cell(r.back) + " |"; }).join("\n") + "\n";
  }
  /* 对折卡：两列的表格，沿中线对折即得卡面卡背，适合打印出来剪开 */
  function cardBlocks(rows) {
    return [
      { t: "title", text: "《资本论》术语卡" },
      { t: "sub", text: "共 " + rows.length + " 张 · 左栏为正面，右栏为背面；打印后沿中线裁开对折" },
      { t: "h2", text: "卡片" },
      { t: "table", rows: [["正面", "背面"]].concat(rows.map(function (r) { return [r.front, r.back]; })),
        widths: [3600, 5760] }
    ];
  }

  function cardsBodyHTML() {
    var rows = cardRows(CD.scope);
    if (!rows.length) {
      return '<p class="qz-empty">这个范围里没有词条。' +
        (CD.scope === "star" ? "先去词条页把没把握的标进<b>生词本</b>。" :
         CD.scope === "wrong" ? "错题本是空的——做一轮<a href=\"#/tools/quiz\">自测</a>就有了。" : "") +
        "</p>";
    }
    var head = rows.slice(0, 3);
    return '<p class="cd-meta">共 <b>' + rows.length + "</b> 张卡。前 3 张预览：</p>" +
      '<div class="cd-prev">' + head.map(function (r) {
        return '<div class="cd-card"><div class="cd-f"><span>正面</span><b>' + esc(r.front) +
          "</b></div><div class=\"cd-b\"><span>背面</span>" + esc(r.back) + "</div></div>";
      }).join("") + "</div>";
  }

  function cardsPanel() {
    var has = cardRows(CD.scope).length > 0;
    var dis = has ? "" : " disabled";
    return '<section class="tool-card" id="cards">' +
      "<h2>生词卡导出</h2>" +
      '<p class="tool-sub">把词条做成一张张卡带走：<b>Anki 可导入的 CSV</b>（两列 front / back，' +
      "带表头，Anki 按列名认字段）、<b>可打印的对折卡</b>（Word，左正面右背面，打印后沿中线裁开）、" +
      "或一份 <b>Markdown 表格</b>。卡背＝AI 的一句话释义＋第一条已核原典引文。</p>" +
      '<div class="qs-bar">' +
        '<label class="wa-lab">取词范围<select id="cd-scope" class="qs-select">' + scopeOpts(CD.scope) + "</select></label>" +
      "</div>" +
      '<div class="wa-acts cm-noprint">' +
        '<button class="tt-btn primary" type="button" data-act="cd-csv"' + dis + ">导出 Anki CSV</button>" +
        '<button class="tt-btn" type="button" data-act="cd-word"' + dis + ">导出对折卡 Word</button>" +
        '<button class="tt-btn" type="button" data-act="cd-md"' + dis + ">复制 Markdown</button>" +
      "</div>" +
      '<div id="cd-body">' + cardsBodyHTML() + "</div>" +
      '<p class="cd-note">Anki 用法：桌面版「文件 → 导入」，选这份 CSV，字段分隔符选逗号，' +
      "勾上「允许 HTML」即可；第一行是列名，Anki 靠它对应正反面字段。</p>" +
      "</section>";
  }

  /* ---------------- 分析与教学 ----------------
     四件：概念关系图编辑器 · 概念计算器 · 大事年表 · 讲义与投影模式。
     前两件偏「想清楚」，后两件偏「讲出去」。 */

  /* ================= 1) 概念关系图编辑器 =================
     编辑器本体是一个独立的 React + TypeScript 单文件应用（pictorial 之外的另一个子工程：
     pathflow/），由主站用 iframe 内嵌。之所以不把 React 塞进主站：
     主站是零依赖零构建的单文件，一旦引入框架与打包器，就要连带承担 node_modules、
     构建步骤与 file:// 下的模块加载问题，得不偿失。
     于是：算法与数据留在主站，交互式编辑器独立成件，两者同目录、一起交。
     旧版「起点/终点选词看最短链」的文本面板在这里下线（见下方注释）。 */

  /* 关系口径分三档。词条之间的 related 有六种关系，其中「共现」占了三百多条——
     一旦把它算进来，几乎任何两条词条两步之内都能牵上线，链就没了推导意义。
     所以默认只走推导关系，「共现」要显式打开，并说清它只是「近」不是「由」。 */
  var PTH_MODE = {
    core: { n: "只走推导关系", rels: ["prereq", "expand", "lead"],
      d: "只走「前提／展开／引出」——这三条是概念之间的推导链，能看清一个概念是怎么长出来的。" },
    wide: { n: "加对立与当代对应", rels: ["prereq", "expand", "lead", "oppose", "now"],
      d: "再加上「对立」与「当代对应」：能看到分歧在哪，以及这个概念今天接续到什么地方。" },
    all: { n: "全部关系（含共现）", rels: ["prereq", "expand", "lead", "oppose", "now", "appear"],
      d: "连「共现」也算。共现只是说两个词常在同一处出现，路会变短，却未必有推导关系——它管「近」，不管「由」。" }
  };

  var PTH_MAX = 6;                       // 同短路径最多列几条

  /* 把 related 拉成一张双向可走的邻接表，每条边记住关系名与方向。
     反向边要留着：读者问的是「这两条词条之间怎么走」，不该只认数据里的单向。 */
  function pathBuild(mode) {
    var allow = (PTH_MODE[mode] || PTH_MODE.core).rels;
    var adj = {};
    TERMS.forEach(function (t) { adj[t.id] = []; });
    TERMS.forEach(function (t) {
      (t.related || []).forEach(function (r) {
        if (!adj[r.id] || allow.indexOf(r.rel) === -1) return;
        adj[t.id].push({ to: r.id, rel: r.rel, fwd: true });
        adj[r.id].push({ to: t.id, rel: r.rel, fwd: false });
      });
    });
    return adj;
  }

  /* 一步关系的读法。数据里的关系写作「甲 —关系—> 乙」，
     走到反向边时要把话倒过来说，否则读出来是反的。 */
  function pathHopText(from, to, rel, fwd) {
    var A = from.term, B = to.term;
    if (fwd) {
      if (rel === "prereq") return { chip: "前提", s: "「" + B + "」是「" + A + "」的前提" };
      if (rel === "expand") return { chip: "展开", s: "「" + A + "」展开出「" + B + "」" };
      if (rel === "lead") return { chip: "引出", s: "「" + A + "」引出「" + B + "」" };
      if (rel === "oppose") return { chip: "对立", s: "「" + A + "」与「" + B + "」相对立" };
      if (rel === "now") return { chip: "当代对应", s: "「" + A + "」在当代对应「" + B + "」" };
      return { chip: "共现", s: "「" + A + "」与「" + B + "」在原著里共现" };
    }
    if (rel === "prereq") return { chip: "前提（反向）", s: "「" + A + "」是「" + B + "」的前提" };
    if (rel === "expand") return { chip: "由…展开", s: "「" + B + "」展开出「" + A + "」" };
    if (rel === "lead") return { chip: "由…引出", s: "「" + B + "」引出「" + A + "」" };
    if (rel === "oppose") return { chip: "对立", s: "「" + A + "」与「" + B + "」相对立" };
    if (rel === "now") return { chip: "当代对应", s: "「" + B + "」在当代对应「" + A + "」" };
    return { chip: "共现", s: "「" + A + "」与「" + B + "」在原著里共现" };
  }

  /* 最短关联链：先按广度优先算出各点到起点的距离，再沿「距离减一」的方向
     把所有等长的走法都数出来（节点序列去重——同一对词条之间可能挂着两种关系，
     那样会数出两条字面重复的路）。 */
  function pathFind(aId, bId, mode) {
    if (!BY_ID[aId] || !BY_ID[bId]) return { ok: false, why: "起点或终点不在词条表里。" };
    if (aId === bId) return { ok: false, why: "起点与终点是同一条词条——换一条终点再试。" };
    var adj = pathBuild(mode), m = PTH_MODE[mode] || PTH_MODE.core;
    var dist = {}, q = [aId], i, j;
    dist[aId] = 0;
    for (i = 0; i < q.length; i++) {
      var nb = adj[q[i]];
      for (j = 0; j < nb.length; j++) {
        if (dist[nb[j].to] == null) { dist[nb[j].to] = dist[q[i]] + 1; q.push(nb[j].to); }
      }
    }
    if (dist[bId] == null) {
      return { ok: false, why: "在「" + m.n + "」这个口径下走不通：这两条词条不在一片关系网里。" +
        "换一个口径再看看，或者换一个终点。" };
    }
    var paths = [], seen = {};
    (function walk(node, acc) {
      if (paths.length >= PTH_MAX) return;
      if (node === bId) {
        var key = [aId].concat(acc.map(function (e) { return e.to; })).join(">");
        if (!seen[key]) { seen[key] = 1; paths.push(acc.slice()); }
        return;
      }
      var list = adj[node];
      for (var k = 0; k < list.length; k++) {
        var e = list[k];
        if (dist[e.to] !== dist[node] + 1) continue;    // 只沿最短路的方向走
        acc.push(e);
        walk(e.to, acc);
        acc.pop();
        if (paths.length >= PTH_MAX) return;
      }
    })(aId, []);
    return { ok: true, len: dist[bId], paths: paths, mode: m };
  }

  /* 一条路的文字版：给复制与导出用 */
  function pathText(res, aId, bId) {
    if (!res.ok) return "";
    var lines = [], cur = BY_ID[aId];
    lines.push("概念关系路径：" + BY_ID[aId].term + " → " + BY_ID[bId].term +
      "（共 " + res.len + " 步，口径：" + res.mode.n + "）");
    res.paths.forEach(function (p, pi) {
      if (pi) lines.push("");
      lines.push(pi ? "第 " + (pi + 1) + " 条等长走法：" : "最短走法：");
      cur = BY_ID[aId];
      p.forEach(function (e, i) {
        var nx = BY_ID[e.to], h = pathHopText(cur, nx, e.rel, e.fwd);
        lines.push("  " + (i + 1) + ". " + h.s);
        cur = nx;
      });
    });
    lines.push("");
    lines.push("（本路径由站内词条的关系数据算得，仅供理解概念次序，不作为原著论断。）");
    return lines.join("\n");
  }

  /* 说明：旧的「起点/终点选词 → 列最短链」文本面板已整体下线，
     改为内嵌 React Flow 节点编辑器（独立单文件 pathflow.html）。
     下面这些纯函数（pathBuild / pathFind / pathHopText / pathText）仍然保留：
       · pathHopText 被词条页的「关系读法」复用；
       · 四件都挂在自测钩子上（见文件末尾的挂载对象），smoke-test 要断言算法口径。
     被删掉的只是 UI 部分（建议列表、结果渲染、绑定），算法一步没动。 */

  /* 编辑器是独立单文件 pathflow.html，与主文件同目录。
     这里只做一件事：判断它到底加载上了没有。
     因为 file:// 下没有任何「文件存在吗」的接口可用，只能在 iframe 加载后去探它的文档；
     探不到（文件没跟着拷、或被策略拦住）就把说明卡换出来，别让用户对着一个空白框猜。 */
  /* 内嵌的关系图要能「点节点进词条」。iframe 里直接改 parent.location.hash 会被
     同源策略挡下，所以子页 postMessage 过来，由主站自己改 hash（触发正常路由）。
     全局只挂一次：工具页与关系图页共用同一份外框，bindPathTool 会被调用多次。 */
  var PF_BRIDGE = false;
  function pathflowBridge() {
    if (PF_BRIDGE) return;
    PF_BRIDGE = true;
    window.addEventListener("message", function (ev) {
      var d = ev && ev.data;
      if (!d || d.source !== "pathflow" || d.type !== "open-term") return;
      var id = d.termId;
      if (!id || !BY_ID[id]) return;   // 词条已改名或已撤：忽略，别跳去空页
      location.hash = "#/t/" + id;
    });
  }

  /* ============ v56：文件查找与「为什么找不到」 ============
     原来的实现有三个问题，都会让「未找到文件」变成一句没有信息量的断言：

     ① **只判有没有 root，不判为什么。** 文件缺失时浏览器给 iframe 的
        contentDocument 是 **null**（真机实测，不是"加载中的空文档"）；
        而"文件在、React 还没挂载完"时 contentDocument 非 null、root 为空。
        原代码把这两者一律判成 false，于是慢机器上会把"加载中"误报成"未找到"。

     ② **只探一次。** load 事件后固定等 140ms 就下结论。pathflow.html 有 745 KB
        且内含 React Flow，解析＋挂载远不止 140ms；无头环境只有 3~6fps，更慢。
        一次探测不够就永远停在"加载中…"或误报缺失。

     ③ **失败提示不含实际查找路径。** 用户看到「没找到文件 pathflow.html」，
        不知道浏览器到底去哪儿找的 —— 而 file:// 下"同目录"是相对主文件的
        目录，不是当前工作目录，猜错的概率很高。

     v59 修掉一个 v56 之后才暴露的**致命误判**：
     ④ **contentDocument === null ≠ 文件不存在。** 用户双击打开 file:// 主文件时，
        浏览器默认把主文件与 iframe 里的 file:// 子页互为**跨源**（opaque origin），
        contentDocument **恒为 null** —— 文件在不在都一样（实测 canary：存在与缺失
        两情形 load 事件、contentDocument、contentWindow.length 逐项相同）。
        旧逻辑据此断言「该路径下没有这个文件」，于是文件明明在也报找不到。
        测试环境全绿是因为 run-edge.sh 恰好带了 --allow-file-access-from-files。
        修法：跨源下唯一可靠信道是子页 postMessage —— publish.mjs 发布
        pathflow.html 时注入一行解析即上报的 {source:"pathflow",type:"ready"}，
        父页收到即确认「文件在且脚本在跑」。contentDocument 探测降级为
        快路径（同源可读时提前收敛），**失败一律等到超时才判**，且提示要
        如实区分「缺失／被跨源策略拦住／旧版没有就绪信号」三种可能。 */

  /* 实际查找路径：把 iframe 的 src 解析成绝对 URL 再反解出可读路径。
     拿不到（极老浏览器 / 跨源）时退回 src 字面量。 */
  /* ★ 关键：文件缺失时**不能**用 iframe 的 contentWindow.location 来取路径 ——
     实测它抛 SecurityError（浏览器压根没创建那个文档，location 也不可读），
     旧实现捕获异常后退回 src 字面量 "./pathflow.html"，那是**相对路径**，
     恰恰丢掉了用户最需要的"浏览器到底去哪儿找了"。
     正确做法：**以主文件自身的 URL 为基准**（location.href 永远可读），
     按 src 的相对关系解析出绝对 URL。 */
  function pfActualUrl(fr) {
    var base = location.href;                       /* 主文件的 URL，一定可读 */
    var src = fr.getAttribute("src") || "./pathflow.html";
    try { return new URL(src, base).href; } catch (e) { /* 极老浏览器没有 URL 构造器 */
      /* 退化：手工拼。src 以 ./ 或 ../ 开头时按 base 的目录接上 */
      var m = /^([^?#]*)/.exec(base);
      var dir = m ? m[1].replace(/[^\/]*$/, "") : "";
      return dir + src.replace(/^\.\//, "");
    }
  }
  /* file:///C:/a%20b/pathflow.html → C://a b\pathflow.html（给 Windows 用户看） */
  function pfPrettyPath(url) {
    try {
      var m = /^file:\/\/\/([^?#]*)/.exec(url);
      if (!m) return url;                            /* http(s) 场景：原样给出 */
      var p = decodeURIComponent(m[1]);
      /* file:///C:/a b/x.html → C:\a b\x.html（盘符大写、反斜杠，
         正好能粘进 Windows 文件管理器的地址栏）。
         字符串字面量里 "\\\\" 才是**一个**反斜杠 —— 写两个就多出两层转义。 */
      return p.replace(/^\/([a-zA-Z]):/, "$1:\\").replace(/\//g, "\\");
    } catch (e) { return url; }
  }

  function bindPathTool() {
    pathflowBridge();
    var fr = document.getElementById("pfe-frame");
    var fb = document.getElementById("pfe-fallback");
    var wrap = document.getElementById("pfe-wrap");
    if (!fr || !fb || !wrap) return;

    var settled = false;        /* 终态闩：true 后一切收手 */
    var shown = false;          /* 回退卡当前是否亮着（可逆，settle(true) 会再收回去） */
    var tries = 0;
    var MAX_PROBE = 26;         /* 26 × 120ms ≈ 3.1s：快路径（同源）里够 React 挂载完 */
    var WAIT_FINAL = 100;       /* 100 × 120ms = 12s：跨源下只能等 ready 信号，等到这儿才判死 */
    var WHERE_ID = "pfe-where";

    function settle(ok, why) {
      if (settled) return;
      if (ok) settled = true;                    /* 只有成功才闩死；失败仍可能被迟到的 ready 翻盘 */
      wrap.hidden = !ok;
      fb.hidden = ok;
      shown = !ok;
      var bar = document.getElementById("pfe-state");
      if (bar) bar.textContent = ok ? "已加载"
        : (why && why.final ? "未能加载编辑器文件" : "等待编辑器就绪…");
      if (ok) return;
      /* 失败时把**实际查找路径**回填进说明卡 —— 这是排查的第一步，
         没有它用户只能猜"同目录"到底是哪个目录。 */
      var box = document.getElementById(WHERE_ID);
      if (box) {
        var u = pfActualUrl(fr);
        box.innerHTML =
          "<b>浏览器实际查找的路径：</b><br>" +
          '<code class="pfe-where-url">' + esc(pfPrettyPath(u) || "（取不到）") + "</code>" +
          '<span class="pfe-why">' + esc(why && why.msg || "") + "</span>";
      }
    }

    /* 就绪信号：publish.mjs 发布的 pathflow.html 在解析时就会发这条消息。
       postMessage 是跨源之下唯一可用的信道，所以它对「真实用户双击打开」
       与「带旗标的开发环境」一视同仁。 */
    function onMsg(ev) {
      if (settled) return;
      var d = ev && ev.data;
      if (!d || d.source !== "pathflow" || d.type !== "ready") return;
      if (ev.source !== fr.contentWindow) return;      /* 别的 iframe 说的，不听 */
      settle(true);
    }
    window.addEventListener("message", onMsg);

    function probe() {
      if (settled) return;
      tries++;
      /* 快路径：contentDocument 可读（同源：http 部署，或带旗标的开发环境）时，
         root 挂载完就能提前收敛，不必等消息。跨源时这里拿到 null ——
         **绝不能**据此判失败（见④），直接等 ready。 */
      var d = null;
      try { d = fr.contentDocument; } catch (e) { d = null; }
      if (d && d.getElementById) {
        var root = d.getElementById("root");
        if (root && root.childElementCount > 0) { settle(true); return; }
      }
      if (tries === MAX_PROBE) {
        /* 3.1 秒还没确认：先亮出回退卡与实际路径（可逆），但**不闩死**——
           慢机器上 React/消息都可能迟到，继续等。 */
        settle(false, {
          msg: "已等 3 秒还没确认编辑器就绪。可能是文件在慢慢加载，也可能这个路径下没有它；先点右上角「单独打开 ↗」试试最快。",
          final: false
        });
      }
      if (tries >= WAIT_FINAL) {
        /* 12 秒仍无信号。跨源下缺失/被拦/旧版无信号三者不可区分，如实写： */
        var why = { msg: "等了 12 秒也没收到编辑器的就绪信号。可能：① 这个路径下确实没有该文件；" +
          "② 文件在，但被浏览器安全策略拦了（file:// 页面之间默认互为跨源）——" +
          "点右上角「单独打开 ↗」能打开就属于这种；" +
          "③ 这份 pathflow.html 是旧版（2026-10-20 之前发布），没有就绪信号——重新生一份即可。", final: true };
        if (d) {
          /* 同源可读还走到这儿：文件在、root 没挂载 —— 那是"拷错了文件"或脚本被拦 */
          var title = "";
          try { title = d.title || ""; } catch (e2) { title = ""; }
          why = { msg: "文件读到了，但页面里没有编辑器界面" +
            (title ? "（它的标题是「" + title + "」）" : "（且它没有标题）") +
            "——可能拷错了文件，或这个文件在浏览器里被脚本拦下了。", final: true };
        }
        settle(false, why);
      }
    }

    fr.addEventListener("load", function () { setTimeout(probe, 120); });
    fr.addEventListener("error", function () {
      /* iframe 对 file:// 缺失通常不派发 error（实测 contentDocument 变 null），
         派了就更早收场，不必等满轮询。 */
      settle(false, { msg: "加载时浏览器报了错（error 事件）。", final: true });
    });
    /* 轮询到收敛：同源等 React 挂载，跨源等 ready 消息。
       无头环境只有 3~6fps，定时器不能太密，120ms 一次最省。 */
    (function poll() {
      if (settled) return;
      probe();
      if (!settled) setTimeout(poll, 120);
    })();
  }

  /* pathflow 的内嵌外框：工具页那张「概念关系图编辑器」与导航栏独立的「关系图」
     页共用这一份，免得两处各写一套 iframe、加载态与缺文件说明。
     两页不会同时出现在 DOM 里，所以 id 可以共用（bindPathTool 一次只认当前这份）。
     体检要探 contentDocument，故不能给 iframe 加 loading="lazy"。 */
  function pathflowEmbed(title) {
    return '<div class="pfe-bar">' +
        '<span class="pfe-tag">交互式</span>' +
        '<span class="pfe-state" id="pfe-state">加载中…</span>' +
        '<span class="pfe-hint">编辑内容只存在这台机器的浏览器里（自动存档）；' +
          "要长期保存或换机器，用编辑器里的「导出 JSON」。</span>" +
        '<a class="tt-btn primary pfe-open" href="./pathflow.html" target="_blank" rel="noopener">单独打开 ↗</a>' +
      "</div>" +
      '<div class="pfe-wrap" id="pfe-wrap">' +
        '<iframe class="pfe-frame" id="pfe-frame" src="./pathflow.html" loading="eager" ' +
          'title="' + esc(title) + '"></iframe>' +
      "</div>" +
      '<div class="pfe-fallback" id="pfe-fallback" hidden>' +
        "<h3>没能加载编辑器 <code>pathflow.html</code></h3>" +
        /* v56：失败时由 bindPathTool 回填「浏览器实际查找的路径」＋「失败原因」。
           原来只写"需要与主文件放在同一个目录里"，用户不知道浏览器到底去哪儿找的，
           而 file:// 下的"同目录"是**主文件所在的目录**，不是当前工作目录。 */
        '<div class="pfe-where" id="pfe-where"></div>' +
        "<p>这张关系图是一个独立文件（自包含 HTML，双击即可单独打开），" +
        "需要与<b>本文件（你正在看的这一份）</b>放在同一个目录里：</p>" +
        '<pre class="pfe-tree">' + esc(
          "同一目录/\n" +
          "  capital-dict-offline.html   ← 你正在看的这份\n" +
          "  pathflow.html               ← 概念关系图"
        ) + "</pre>" +
        "<p>这两个文件应当放在同一目录；若是从别处只拿了主文件，" +
        "也可以在浏览器里直接打开 <code>pathflow.html</code> 使用。</p>" +
        '<p class=pfe-tip><b>怎么确认：</b>把两份文件都选中，看状态栏/属性里的「大小」——' +
        "编辑器那份约 745 KB、修改日期与主文件同批；主文件通常在三 MB 以上。" +
        "若只有主文件，说明拷贝时漏了。若「单独打开 ↗」能正常打开编辑器，" +
        "说明文件其实在，只是浏览器不允许本页读取它的内部状态（file:// 页面之间" +
        "默认互为跨源）——此时以单独打开的方式使用即可。</p>" +
        "<p>没有它时，词条之间的关系仍可在别处看到：任一词条页底部都有按六种关系列出的" +
        "相邻词条，可逐条点进去读。</p>" +
      "</div>";
  }

  /* 面板：一枚「交互式作品」的外框 + 内嵌编辑器 + 缺文件时的说明卡。
     编辑器有自己的顶栏、画布、图例与右侧面板，所以这里不再重复它的功能按钮，
     只留一个「单独打开」的入口，方便全屏使用或分享这一个页面。 */
  function pathPanel() {
    return '<section class="tool-card" id="path">' +
      "<h2>概念关系图编辑器</h2>" +
      '<p class="tool-sub">基于 React Flow 的节点编辑器：拖节点摆位、从节点边缘拉线建关系、一键自动布局（dagre）；' +
      "输入一个术语，就把它的关联术语连人带关系、带关联强度一并铺到画布上。" +
      "节点可改名、可分色分组、可锁定位置；边可改关系类型、可拉关联强度、可反转方向。" +
      "整张图能导出成 JSON 带走，下次导入接着编。</p>" +
      pathflowEmbed("概念关系图编辑器（React Flow）") +
      '<p class="pth-note">关系数据取自站内词条表——前提／展开／引出／对立／当代对应／共现六种，' +
      "每种各有默认的关联强度（前提最硬，共现最松）。" +
      "图上的路径与联想反映的是<b>编者给这些概念排的先后与从属</b>，" +
      "不是原著里逐句写明的推导次序，也没有逐句页码依据：拿它理清思路可以，当引文不行。" +
      '只想看全站概念的关系，用导航栏的<a href="#/graph">关系图</a>那一页。</p>' +
    "</section>";
  }

  /* ================= 2) 概念计算器 ================= */

  var CALC = { mode: "mrate", v: {} };

  /* 数字与百分号的写法：小数最多留四位，末尾的零去掉，
     免得出现「200.0000%」这种让人怀疑算错了的写法。 */
  function fnum(x) {
    if (typeof x !== "number" || !isFinite(x)) return "—";
    var r = Math.round(x * 10000) / 10000;
    return String(r);
  }
  function fpct(x) { return fnum(x * 100) + "%"; }

  /* 敏感度表：m′ 不变、资本有机构成一路提高，利润率会怎么走。
     这是第三卷「利润率趋向下降的规律」的算术骨架，摆在计算器里比讲一段话管用。 */
  function prateTable(mrPct) {
    var rows = "";
    for (var k = 1; k <= 9; k++) {
      rows += "<tr><th>c : v = " + k + " : 1</th><td class=\"pr-p\">" + fnum(mrPct / (k + 1)) + "%</td>" +
        "<td>" + fnum(100 / (k + 1)) + "% 的资本花在工资上</td></tr>";
    }
    return '<h4 class="calc-h">同一个剩余价值率下，有机构成与利润率的对照</h4>' +
      '<table class="pr-tbl"><thead><tr><th>资本有机构成</th><th>利润率 p′</th><th>可变资本占比 v/(c+v)</th></tr></thead>' +
      "<tbody>" + rows + "</tbody></table>" +
      '<p class="calc-note">剩余价值率固定为 ' + fnum(mrPct) + "% 时：有机构成从 1:1 抬到 9:1，" +
      "利润率就从 " + fnum(mrPct / 2) + "% 掉到 " + fnum(mrPct / 10) + "%。" +
      "m′ 没变，变的只是钱怎么分在机器和人身上——这就是那条「规律」的算术底子。" +
      "（对照表按 v/(c+v) = 1/(k+1) 算，不含周转与部门间竞争。）</p>";
  }

  var CALC_MODES = [
    {
      id: "mrate", n: "剩余价值率",
      form: ["m′ = m / v", "m′ = 剩余劳动时间 / 必要劳动时间"],
      d: "剩余价值率说的是可变资本被榨取到什么程度。它跟资本的大小无关，" +
        "同一个行业里大厂小厂是同一条线；两条式子算的是同一个比率——一条按价值额，一条按劳动时间。",
      fields: [
        { k: "m", l: "剩余价值 m", u: "元", v: "100" },
        { k: "v", l: "预付可变资本 v", u: "元", v: "50" },
        { k: "ts", l: "剩余劳动时间", u: "小时（可留空）", v: "6" },
        { k: "tn", l: "必要劳动时间", u: "小时（可留空）", v: "4" }
      ],
      links: ["shengyujiazhilv", "shengyujiazhi", "kebianziben", "shengyulaodongshijian"],
      run: function (g) {
        var m = g("m"), v = g("v"), ts = g("ts"), tn = g("tn"), steps = [], main = null;
        if (v === 0 || tn === 0) return { need: "分母不能为零：可变资本（或必要劳动时间）为零时，这个比率没有意义。" };
        if (m != null && v != null) {
          main = fpct(m / v);
          steps.push("按价值额：m′ = m / v = " + fnum(m) + " / " + fnum(v) + " = " + fpct(m / v) +
            "。也就是每预付 1 元可变资本，收回 " + fnum(m / v) + " 元剩余价值。");
        }
        if (ts != null && tn != null) {
          steps.push("按劳动时间：m′ = 剩余劳动时间 / 必要劳动时间 = " + fnum(ts) + " / " + fnum(tn) +
            " = " + fpct(ts / tn) + "。一个工作日里，" + fnum(tn) + " 小时为自己干、" +
            fnum(ts) + " 小时为资本干。");
          if (main == null) main = fpct(ts / tn);
        }
        if (main == null) return { need: "填上「剩余价值 m」与「预付可变资本 v」，" +
          "或者填上「剩余劳动时间」与「必要劳动时间」。" };
        return { main: main, label: "剩余价值率 m′", steps: steps };
      }
    },
    {
      id: "mass", n: "剩余价值量与年剩余价值率",
      form: ["M = m′ × v", "M（一年）= M × n", "M′ = m′ × n"],
      d: "剩余价值率说的是「一笔可变资本一次榨出多少」，年剩余价值率说的是" +
        "「同一笔钱一年里总共榨出多少」——差别全在周转次数 n 上。",
      fields: [
        { k: "mr", l: "剩余价值率 m′", u: "百分数，如 200", v: "200" },
        { k: "v", l: "预付可变资本 v", u: "元", v: "50" },
        { k: "n", l: "可变资本一年周转次数 n", u: "次（可留空）", v: "3" }
      ],
      links: ["shengyujiazhi", "nianshengyujiazhilv", "zhouzhuancishu", "kebianziben"],
      run: function (g) {
        var mr = g("mr"), v = g("v"), n = g("n");
        if (mr == null || v == null) return { need: "填上剩余价值率与预付可变资本。" };
        var steps = [], M = mr / 100 * v;
        steps.push("一次周转带来的剩余价值量：M = m′ × v = " + fnum(mr) + "% × " + fnum(v) +
          " = " + fnum(M) + "。");
        if (n == null) {
          return { main: fnum(M), label: "剩余价值量 M（一次周转）", steps: steps };
        }
        steps.push("同一笔可变资本一年周转 " + fnum(n) + " 次，每转一次榨一回：" +
          "年剩余价值量 = M × n = " + fnum(M) + " × " + fnum(n) + " = " + fnum(M * n) + "。");
        steps.push("年剩余价值率：M′ = m′ × n = " + fnum(mr) + "% × " + fnum(n) + " = " +
          fnum(mr * n) + "%。它把周转速度折进了剥削程度里，所以可以远高于剩余价值率。");
        return { main: fnum(mr * n) + "%", label: "年剩余价值率 M′", steps: steps };
      }
    },
    {
      id: "comp", n: "资本有机构成",
      form: ["c : v", "比重：c/(c+v) 与 v/(c+v)"],
      d: "资本有机构成是不变资本同可变资本的比率。它由技术构成决定，又反映价值构成——" +
        "机器越多、雇工越少，这个比值越高。",
      fields: [
        { k: "c", l: "不变资本 c", u: "元", v: "400" },
        { k: "v", l: "可变资本 v", u: "元", v: "100" }
      ],
      links: ["zibenyoujigoucheng", "bubianziben", "kebianziben", "zibenzhiji"],
      run: function (g) {
        var c = g("c"), v = g("v");
        if (c == null || v == null) return { need: "填上不变资本与可变资本。" };
        if (v === 0) return { need: "可变资本为零，比值没有意义（那就不是资本主义生产了）。" };
        var k = c / v, tot = c + v;
        return {
          main: fnum(c) + " : " + fnum(v) + "（即 " + fnum(k) + " : 1）",
          label: "资本有机构成",
          steps: [
            "比值：c : v = " + fnum(c) + " : " + fnum(v) + "，约简为 " + fnum(k) + " : 1。",
            "比重：不变资本占全部资本的 " + fpct(c / tot) + "，可变资本占 " + fpct(v / tot) + "。",
            "总资本 c + v = " + fnum(tot) + " 元。"
          ]
        };
      }
    },
    {
      id: "prate", n: "利润率",
      form: ["p′ = m / (c + v)", "p′ = m′ × v/(c+v)"],
      d: "利润率是剩余价值同<b>全部预付资本</b>的比率——分母里多了不变资本，" +
        "所以同一个剩余价值率下，有机构成越高，利润率越低。这是第三条式子的意思。",
      fields: [
        { k: "m", l: "剩余价值 m", u: "元", v: "100" },
        { k: "c", l: "不变资本 c", u: "元", v: "400" },
        { k: "v", l: "可变资本 v", u: "元", v: "100" }
      ],
      links: ["lirunlv", "yibanlirunlv", "lirunlvxiajiang", "zibenyoujigoucheng"],
      run: function (g) {
        var m = g("m"), c = g("c"), v = g("v");
        if (m == null || c == null || v == null) return { need: "填上剩余价值、不变资本与可变资本。" };
        var tot = c + v;
        if (tot === 0) return { need: "总资本为零，算不出利润率。" };
        var mr = v ? m / v * 100 : null;
        var steps = [
          "p′ = m / (c + v) = " + fnum(m) + " / (" + fnum(c) + " + " + fnum(v) + ") = " +
            fnum(m) + " / " + fnum(tot) + " = " + fpct(m / tot) + "。"
        ];
        if (mr != null) {
          steps.push("换个算法验一遍：先算剩余价值率 m′ = m / v = " + fnum(mr) + "%，" +
            "再乘可变资本占全部资本的比重 v/(c+v) = " + fnum(v) + "/" + fnum(tot) +
            " = " + fpct(v / tot) + "：p′ = m′ × v/(c+v) = " + fnum(mr) + "% × " + fpct(v / tot) +
            " = " + fpct(m / tot) + "。两条路子对得上。");
        }
        return { main: fpct(m / tot), label: "利润率 p′", steps: steps, extra: prateTable(mr == null ? 100 : mr) };
      }
    },
    {
      id: "turn", n: "周转次数",
      form: ["n = U / u"],
      d: "U 是计量期（通常一年），u 是资本周转一次所需的时间，n 就是周转次数。" +
        "周转越快，同一笔钱被反复投出去、反复带回剩余价值，年剩余价值率就越高。",
      fields: [
        { k: "U", l: "计量期 U", u: "月（一年填 12）", v: "12" },
        { k: "u", l: "周转一次所需时间 u", u: "月", v: "3" },
        { k: "mr", l: "剩余价值率 m′（可选）", u: "百分数", v: "100" }
      ],
      links: ["zhouzhuancishu", "nianshengyujiazhilv", "liudongziben", "zibenxunhuan"],
      run: function (g) {
        var U = g("U"), u = g("u"), mr = g("mr");
        if (U == null || u == null) return { need: "填上计量期与周转一次的时间。" };
        if (u === 0) return { need: "周转一次的时间不能为零。" };
        var n = U / u, steps = [
          "n = U / u = " + fnum(U) + " / " + fnum(u) + " = " + fnum(n) + " 次。"
        ];
        var main = fnum(n) + " 次", label = "一年周转次数 n";
        if (mr != null) {
          steps.push("若剩余价值率 m′ = " + fnum(mr) + "%，则年剩余价值率 M′ = m′ × n = " +
            fnum(mr) + "% × " + fnum(n) + " = " + fnum(mr * n) + "%。" +
            "周转从 1 次提到 " + fnum(n) + " 次，同一笔可变资本一年里被榨取的次数翻了几番。");
          label = "一年周转 " + fnum(n) + " 次（年剩余价值率 " + fnum(mr * n) + "%）";
        }
        return { main: main, label: label, steps: steps };
      }
    },
    {
      id: "gwg", n: "资本总公式",
      form: ["G — W — G′", "ΔG = G′ − G"],
      d: "资本总公式里，回来的钱要比投出去的多。" +
        "多出来的那一块 ΔG 就是剩余价值；而 ΔG 同预付资本 G 的比率，正是利润率。" +
        "同一个差值放在流通过程看是剩余价值，放到总过程看就是利润。",
      fields: [
        { k: "G", l: "预付资本 G", u: "元", v: "500" },
        { k: "G2", l: "回流货币 G′", u: "元", v: "600" }
      ],
      links: ["zibenzonggongshi", "shengyujiazhi", "lirunlv", "huobi"],
      run: function (g) {
        var G = g("G"), G2 = g("G2");
        if (G == null || G2 == null) return { need: "填上预付资本与回流货币。" };
        if (G === 0) return { need: "预付资本为零，比率没有意义。" };
        var d = G2 - G, steps = [
          "ΔG = G′ − G = " + fnum(G2) + " − " + fnum(G) + " = " + fnum(d) + "。",
          "这一块就是剩余价值。它不能从流通中凭空生出来——总公式里的加号，" +
          "在书里要由「劳动力这种特殊商品的使用价值」来解释。"
        ];
        if (d < 0) steps.push("注意：这里 G′ 比 G 小，那就不成其为资本的运动了（G—W—G′ 要求 G′ > G）。");
        return {
          main: fnum(d), label: "剩余价值（ΔG）", steps: steps,
          extra: '<p class="calc-note">换个角度看：ΔG / G = ' +
            fnum(G2) + " / " + fnum(G) + " − 1 = " + fpct(d / G) + "。" +
            "同一个数，放在流通过程里叫剩余价值，按全部预付资本一算就是利润率——概念换了名字，数没变。</p>"
        };
      }
    }
  ];

  function calcMode(id) {
    for (var i = 0; i < CALC_MODES.length; i++) if (CALC_MODES[i].id === id) return CALC_MODES[i];
    return CALC_MODES[0];
  }

  /* 输入框里的字原样存着（''表示没填），算之前才转成数 */
  function calcVal(k) {
    var s = CALC.v[k];
    if (s === "" || s == null) return null;
    var x = parseFloat(s);
    return isNaN(x) ? null : x;
  }

  /* 纯函数版：自测脚本直接喂一组数进来验算 */
  function calcRun(mode, vals) {
    var old = CALC.v, out;
    try {
      CALC.v = vals || {};
      out = calcMode(mode).run(function (k) { return calcVal(k); });
    } finally {
      CALC.v = old;
    }
    return out;
  }

  function calcFieldsHTML(m) {
    return m.fields.map(function (f) {
      var val = CALC.v[f.k];
      if (val == null) val = f.v;
      return '<label class="calc-f"><span class="calc-l">' + esc(f.l) + "</span>" +
        '<input type="text" inputmode="decimal" class="calc-i" data-calc="' + esc(f.k) +
          '" value="' + esc(val) + '">' +
        '<span class="calc-u">' + esc(f.u) + "</span></label>";
    }).join("");
  }

  function calcOutHTML() {
    var m = calcMode(CALC.mode), r = m.run(function (k) { return calcVal(k); });
    if (r.need) return '<p class="calc-need">' + esc(r.need) + "</p>";
    var h = '<div class="calc-res"><span class="calc-rl">' + esc(r.label || "结果") + "</span>" +
      '<b class="calc-rv">' + esc(r.main) + "</b></div>";
    if (r.steps && r.steps.length) {
      h += '<h4 class="calc-h">怎么算出来的</h4><ol class="calc-steps">' +
        r.steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>";
    }
    if (r.extra) h += r.extra;
    return h;
  }

  function renderCalc() {
    var out = document.getElementById("calc-out");
    if (out) out.innerHTML = calcOutHTML();
    var r = document.getElementById("calc-refs");
    if (r) {
      var m = calcMode(CALC.mode);
      r.innerHTML = "相关词条：" + (m.links || []).filter(function (id) { return !!BY_ID[id]; })
        .map(function (id) {
          return '<a class="calc-ref" href="#/t/' + esc(id) + '">' + esc(BY_ID[id].term) + "</a>";
        }).join("");
    }
  }

  function calcRepaint() {
    var el = document.getElementById("calc");
    if (!el) return;
    el.outerHTML = calcPanel();
    bindCalcTool();
  }

  function bindCalcTool() {
    /* 首次进入这条式子时把默认算例装进状态里——
       输入框显示的默认值必须真的参与计算，不能只是摆着好看。
       只在「从没填过」时装（null/undefined），用户清空的空串不动。 */
    calcMode(CALC.mode).fields.forEach(function (f) {
      if (CALC.v[f.k] == null) CALC.v[f.k] = f.v;
    });
    var chips = document.getElementById("calc-chips");
    if (chips) {
      chips.addEventListener("click", function (e) {
        var b = e.target && e.target.closest ? e.target.closest("[data-mode]") : null;
        if (!b) return;
        CALC.mode = b.getAttribute("data-mode");
        calcRepaint();
      });
    }
    renderCalc();
  }

  function calcPanel() {
    var m = calcMode(CALC.mode);
    var chips = CALC_MODES.map(function (x) {
      return '<button type="button" class="calc-chip' + (x.id === CALC.mode ? " on" : "") +
        '" data-mode="' + x.id + '">' + esc(x.n) + "</button>";
    }).join("");
    return '<section class="tool-card" id="calc">' +
      "<h2>概念计算器</h2>" +
      '<p class="tool-sub">六条式子的算法器：填数即算，并把每一步的代入过程写出来。' +
      "不是为了替你做题，而是让人看清<b>哪个数进了分母</b>——" +
      "剩余价值率的分母是可变资本，利润率的分母是全部预付资本，差的就是这一处。</p>" +
      '<div class="calc-chips" id="calc-chips" role="tablist">' + chips + "</div>" +
      "<h3 class=\"calc-t\">" + esc(m.n) + "</h3>" +
      '<div class="calc-form">' +
        m.form.map(function (x) { return '<code class="calc-eq">' + esc(x) + "</code>"; }).join("") +
      "</div>" +
      '<p class="calc-d">' + m.d + "</p>" +
      '<div class="calc-fields">' + calcFieldsHTML(m) + "</div>" +
      '<div class="calc-refs" id="calc-refs"></div>' +
      '<div id="calc-out"></div>' +
      '<p class="calc-note">数字一律按《资本论》里那几个基本量的定义算，不掺别的经济学口径。' +
      "单位随意，只要前后一致（元的算例里，时间用小时、月）。" +
      "周转与部门间竞争不在这些式子内——那是第二卷、第三卷另说的事。</p>" +
    "</section>";
  }

  /* ================= 3) 大事年表 ================= */

  /* 一条年表最怕的是「看着整齐，其实没出处」。这里每条都带一个来源标记：
       juan   日期就印在《资本论》的序言、跋、献词上，站内已逐字核过；
       term   取自站内词条的标准释义与它已核的出处，点词条名可查；
       common 学界通行的年份，站内尚未逐条核到页码——引用前请另查权威年表。
     把这三类混在一起而不作区分，才是真正的不诚实。 */
  var CHRONO_SRC = {
    juan: { n: "卷首文献", d: "日期印在《资本论》序言、跋或献词上，站内已逐字核过。" },
    term: { n: "站内词条", d: "取自站内词条的标准释义与已核出处，点词条名可查。" },
    common: { n: "通行年表", d: "学界通行的年份，站内尚未逐条核到页码——正式引用请另查权威年表。" }
  };

  var CHRONO_AX = {
    life: { n: "马克思生平", d: "人这一条线：读书、办报、流亡、写书。" },
    work: { n: "《资本论》写作与出版", d: "书这一条线：手稿、分册、版本，以及身后由恩格斯完成的第二三卷。" },
    cn: { n: "中国译介与传播", d: "文本旅行这一条线：从零星介绍到全译本，再到今天的底本。" }
  };

  var CHRONO = [
    /* —— 生平 —— */
    { y: 1818, md: "5月5日", ax: "life", k: "term", tid: "makesi", t: "生于特里尔",
      d: "普鲁士莱茵省特里尔城，律师家庭。" },
    { y: 1835, md: "", ax: "life", k: "common", t: "入波恩大学读法律",
      d: "一年后转柏林大学，从法学转向哲学。" },
    { y: 1841, md: "", ax: "life", k: "common", t: "获耶拿大学博士学位",
      d: "学位论文是《德谟克利特和伊壁鸠鲁自然哲学的差别》——一开始就是冲着黑格尔之后的问题去的。" },
    { y: 1842, md: "", ax: "life", k: "common", t: "为《莱茵报》撰稿并任主编",
      d: "第一次被现实问题缠住：林木盗窃法、摩泽尔农民的状况。要谈物质利益，就得去啃政治经济学。" },
    { y: 1843, md: "6月", ax: "life", k: "common", t: "与燕妮结婚，10 月迁往巴黎",
      d: "《莱茵报》被查禁后离开德国；在巴黎开始系统研究政治经济学与法国社会主义文献。" },
    { y: 1844, md: "", ax: "life", k: "term", tid: "jingjixuezhexueshougao",
      t: "写《1844 年经济学哲学手稿》；8 月与恩格斯在巴黎会见",
      d: "手稿里的异化劳动是《资本论》批判的最早起点；与恩格斯的这次会见，开始了终身合作。" },
    { y: 1845, md: "", ax: "life", k: "term", tid: "guanyufeierbahadetigang",
      t: "写《关于费尔巴哈的提纲》，迁居布鲁塞尔",
      d: "十一条、一千五百字，恩格斯称之为「新世界观的天才萌芽」。" },
    { y: 1846, md: "", ax: "life", k: "term", tid: "deyizhiyishixingtai",
      t: "与恩格斯合写《德意志意识形态》",
      d: "唯物史观在这里第一次得到系统表述，而书稿在生前未能出版。" },
    { y: 1847, md: "", ax: "life", k: "term", tid: "puludong", t: "《哲学的贫困》批判蒲鲁东",
      d: "第一次正面清算小资产阶级社会主义的经济学——「财产就是盗窃」的对手。" },
    { y: 1848, md: "2月", ax: "life", k: "term", tid: "gongchandangxuanyan",
      t: "《共产党宣言》在伦敦出版", d: "与恩格斯合写的小册子，此后被译成两百多种语言。" },
    { y: 1849, md: "8月", ax: "life", k: "common", t: "流亡伦敦",
      d: "科隆《新莱茵报》停刊、被逐出普鲁士与法国后，定居伦敦，此后终生未再长期离开英国。" },
    { y: 1852, md: "", ax: "life", k: "common", t: "《路易·波拿巴的雾月十八日》",
      d: "在伦敦的最初几年，靠给报刊写稿维生，同时在大英博物馆的阅览室里啃政治经济学。" },
    { y: 1864, md: "9月", ax: "life", k: "common", t: "第一国际成立",
      d: "国际工人协会在伦敦成立，马克思起草成立宣言与共同章程。" },
    { y: 1875, md: "", ax: "life", k: "term", tid: "gedaganglingpipan", t: "《哥达纲领批判》",
      d: "逐条批改德国工人党的纲领草案，连「不折不扣的劳动所得」也拆开来看。" },
    { y: 1883, md: "3月14日", ax: "life", k: "term", tid: "makesi", t: "在伦敦逝世",
      d: "葬于海格特公墓。书没写完，手稿留给了恩格斯。" },

    /* —— 写作与出版 —— */
    { y: 1844, md: "", ax: "work", k: "term", tid: "jingjixuezhexueshougao",
      t: "巴黎手稿：《资本论》的最早准备",
      d: "还不是《资本论》，但工资、利润、地租三份笔记的框架，已经朝着后来的书去了。" },
    { y: 1847, md: "", ax: "work", k: "term", tid: "puludong",
      t: "《哲学的贫困》：确立批判古典政治经济学的立场",
      d: "劳动价值论的基本立场在这里公开表态，日后《资本论》第一卷第一篇的问题就由此而来。" },
    { y: 1858, md: "", ax: "work", k: "common", t: "《政治经济学批判大纲》手稿",
      d: "1857—1858 年写下的七本笔记，第一次拟出全书的六册计划——后来《资本论》的骨架就在这份草图上改出来。" },
    { y: 1859, md: "", ax: "work", k: "term", tid: "zhengzhijingjixuepipan",
      t: "《政治经济学批判》第一分册出版",
      d: "原计划的六分册只出了第一册，包含《商品》《货币》两章，序言给出唯物史观的经典表述。" },
    { y: 1863, md: "", ax: "work", k: "common", t: "1861—1863 年手稿",
      d: "规模最大的一批手稿，其中关于剩余价值学说的部分，后来被整理成《剩余价值理论》。" },
    { y: 1864, md: "5月9日", ax: "work", k: "juan", tid: "weilianwoerfu", t: "威廉·沃尔弗去世",
      d: "西里西亚农奴之子、马克思的挚友。他为第七篇提供过土地关系方面的材料。",
      src: "《资本论》第一卷扉页献词：「1809 年 6 月 21 日生于塔尔瑙，1864 年 5 月 9 日死于曼彻斯特流亡中」，《资本论》第一卷，人民出版社2004年版，卷首献词。" },
    { y: 1865, md: "", ax: "work", k: "common", t: "1863—1865 年写出三卷初稿",
      d: "第一、二、三卷的初稿都在这一段时间里成形；此后主要工作变成反复修改第一卷。" },
    { y: 1867, md: "7月", ax: "work", k: "juan", t: "写第一卷第一版序言（伦敦）",
      d: "序言里说，本书研究的是「资本主义生产方式以及和它相适应的生产关系和交换关系」；" +
        "也在序言里写下那句「一个社会即使探索到了本身运动的自然规律……还是既不能跳过也不能用法令取消自然的发展阶段」。",
      src: "《资本论》第一卷第一版序言，《马克思恩格斯选集》第2卷，人民出版社2012年版，第82—83页。" },
    { y: 1867, md: "9月", ax: "work", k: "term", tid: "zibenlun", t: "第一卷在汉堡出版",
      d: "《资本的生产过程》。全书以商品为起点，走完货币、资本、剩余价值、积累，到第七篇的原始积累。" },
    { y: 1871, md: "", ax: "work", k: "common", t: "巴黎公社失败后加紧修订第一卷",
      d: "为了出第二版，马克思大幅修改了价值形式那一节，并调整了全卷的结构与表述。" },
    { y: 1872, md: "", ax: "work", k: "term", tid: "ziwenban",
      t: "第一卷第二版分册出版；法文版分册开始出版",
      d: "法文版由约·鲁瓦翻译、马克思逐章校订，他为此重写了部分章节，并在序言里要求译者宁可牺牲文采也要保住原意。" },
    { y: 1873, md: "", ax: "work", k: "juan", t: "写第一卷第二版跋",
      d: "跋里交代了方法与叙述的关系，也交代了他同黑格尔辩证法的关系——「在黑格尔那里，辩证法是倒立着的」。",
      src: "《资本论》第一卷第二版跋，《马克思恩格斯选集》第2卷，人民出版社2012年版，第88、94页。" },
    { y: 1875, md: "", ax: "work", k: "common", t: "法文版出齐",
      d: "1872—1875 年分册出版完毕。马克思认为法文版在科学上比德文第二版更严谨，也因此校订出不少改动。" },
    { y: 1883, md: "3月", ax: "work", k: "term", tid: "engesi", t: "马克思逝世，恩格斯接手遗稿",
      d: "恩格斯放下自己正在写的《自然辩证法》，开始辨认那些只有他自己才读得懂的手稿。" },
    { y: 1885, md: "", ax: "work", k: "term", tid: "engesi", t: "第二卷出版（恩格斯编）",
      d: "《资本的流通过程》。恩格斯从多份手稿里选定底本、补写章节，并写了序言。" },
    { y: 1887, md: "", ax: "work", k: "common", t: "第一卷英译本在伦敦出版",
      d: "恩格斯校订译文并写序；英译本让《资本论》第一次以英语世界能读的形式流通。" },
    { y: 1890, md: "", ax: "work", k: "common", t: "第一卷德文第四版",
      d: "恩格斯据马克思留下的修订笔记与法文版做了最后一次校订，此后的德文通行本多据此版。" },
    { y: 1894, md: "", ax: "work", k: "term", tid: "engesi", t: "第三卷出版（恩格斯编）",
      d: "《资本主义生产的总过程》：平均利润、利润率趋向下降的规律、利息、地租都在这一卷。" },
    { y: 1972, md: "", ax: "work", k: "term", tid: "mega2", t: "MEGA² 历史考证版开始出版",
      d: "《资本论》及其全部手稿集中于第二部分，按原始文字排印，成为版本与手稿研究的世界基准。" },

    /* —— 中国译介与传播 —— */
    { y: 1899, md: "", ax: "cn", k: "term", tid: "makesizhuyizaoqichuanbo",
      t: "《万国公报》最早提到马克思",
      d: "中文世界里第一次出现这个名字，还只是一句介绍性的文字。" },
    { y: 1906, md: "", ax: "cn", k: "term", tid: "makesizhuyizaoqichuanbo",
      t: "朱执信在《民报》撰文介绍《资本论》",
      d: "介绍了剩余价值学说与阶级斗争，是《资本论》第一次以较大篇幅进入中文论说。" },
    { y: 1920, md: "", ax: "cn", k: "term", tid: "makesizhuyizaoqichuanbo",
      t: "陈望道译《共产党宣言》出版",
      d: "经典文本开始成规模地进入中文世界，为《资本论》的翻译准备了语言与读者。" },
    { y: 1930, md: "3月", ax: "cn", k: "term", tid: "benlunzhongwenjieyiban",
      t: "陈启修译第一卷第一分册出版",
      d: "上海昆仑书店，首个中文译本——《资本论》中文之旅的起点。译者是陈启修（陈豹隐）。" },
    { y: 1934, md: "", ax: "cn", k: "term", tid: "benlunzhongwenjieyiban",
      t: "分册翻译接力",
      d: "潘冬舟、王思华、侯外庐等人在白色恐怖下接力推进分册翻译，译本零散却一直没断。" },
    { y: 1936, md: "", ax: "cn", k: "term", tid: "houwailu", t: "侯外庐、王思华译第一卷出版",
      d: "侯外庐 1927 年起在巴黎系统研读并着手翻译，历经牢狱与战乱，与王思华合译的第一卷终于问世。" },
    { y: 1938, md: "", ax: "cn", k: "term", tid: "makesizhuyizaoqichuanbo",
      t: "郭大力、王亚南三卷全译本出版",
      d: "读书生活出版社，《资本论》第一次以完整三卷的中文面貌出现，此后多次修订重印。" },
    { y: 1953, md: "", ax: "cn", k: "common", t: "开始系统翻译《马克思恩格斯全集》",
      d: "新中国成立后成立专门的编译机构，马恩著作的翻译从个人接力转为有组织的工程，" +
        "译文体例与术语逐步统一。" },
    { y: 1974, md: "", ax: "cn", k: "common", t: "《马克思恩格斯全集》中文第一版《资本论》三卷出齐",
      d: "第 23—25 卷（1972—1974）以俄文版为参照译出，长期是通行的中文版本。" },
    { y: 2004, md: "", ax: "cn", k: "term", tid: "zibenlun",
      t: "人民出版社《资本论》单行本第 2 版",
      d: "据《马克思恩格斯全集》历史考证版重新校订。本词典不少引文就是据此本核的页码。" },
    { y: 2009, md: "", ax: "cn", k: "common", t: "《马克思恩格斯文集》十卷本出版",
      d: "在全集与选集之间另立一套，选目与译文都做了修订。" },
    { y: 2012, md: "", ax: "cn", k: "term", tid: "zibenlun", t: "《马克思恩格斯选集》第三版出版",
      d: "本词典《资本论》的节选引文，一律据此版第 2 卷逐字核对——" +
        "书里没有收入的段落（第二三卷专章、卷首献词、法文版序言等），改用单行本核页码。",
      src: "《马克思恩格斯选集》第2卷，人民出版社2012年版；《资本论》第一卷，人民出版社2004年版。" },
    { y: 2018, md: "5月", ax: "cn", k: "common", t: "马克思诞辰 200 周年",
      d: "国内外举行纪念活动，《资本论》的研究与大众阅读在这一年出现新一波热度。" }
  ];

  var CHR = { ax: "all", q: "" };

  /* 同一年里按月份排；只到年的事件排在当年最前 */
  function chronoMonth(ev) {
    var m = /(\d+)\s*月/.exec(ev.md || "");
    return m ? +m[1] : 0;
  }
  function chronoSort(a, b) {
    if (a.y !== b.y) return a.y - b.y;
    if (chronoMonth(a) !== chronoMonth(b)) return chronoMonth(a) - chronoMonth(b);
    return a.t < b.t ? -1 : a.t > b.t ? 1 : 0;
  }
  function chronoByAxis(ax) {
    return CHRONO.filter(function (e) { return e.ax === ax; }).slice().sort(chronoSort);
  }

  /* 搜索：年份、标题、说明、词条名都认 */
  function chronoHit(ev) {
    var q = CHR.q.trim().toLowerCase();
    if (!q) return true;
    var tid = ev.tid ? BY_ID[ev.tid] : null;
    var hay = (ev.y + " " + (ev.md || "") + " " + ev.t + " " + ev.d + " " +
      (tid ? tid.term + " " + (tid.alias || []).join(" ") : "")).toLowerCase();
    return hay.indexOf(q) > -1;
  }

  function chronoEventHTML(ev, full) {
    var tid = ev.tid ? BY_ID[ev.tid] : null;
    var src = CHRONO_SRC[ev.k] || CHRONO_SRC.common;
    var line = "";
    if (ev.k === "term" && tid) {
      line = '<a class="ch-t" href="#/t/' + esc(tid.id) + '">站内词条「' + esc(tid.term) + "」</a>" +
        (ev.src ? "　" + esc(ev.src) : "");
    } else if (ev.k === "juan") {
      line = "卷首文献" + (ev.src ? "：" + esc(ev.src) : "。");
    } else if (ev.src) {
      line = esc(ev.src);
    } else {
      line = src.d;
    }
    return '<li class="ch-ev k-' + esc(ev.k) + '">' +
      '<span class="ch-y">' + ev.y + (ev.md ? "<i>" + esc(ev.md) + "</i>" : "") + "</span>" +
      '<div class="ch-b"><b class="ch-t2">' + esc(ev.t) + "</b>" +
        (full ? '<p class="ch-d">' + esc(ev.d) + "</p>" : '<p class="ch-d">' + esc(ev.d) + "</p>") +
        '<p class="ch-s"><span class="ch-k k-' + esc(ev.k) + '">' + esc(src.n) + "</span>" + line + "</p>" +
      "</div></li>";
  }

  function chronoBodyHTML() {
    if (CHR.ax !== "all") {
      var ax = CHRONO_AX[CHR.ax];
      var list = chronoByAxis(CHR.ax).filter(chronoHit);
      return '<div class="ch-one"><p class="ch-axd">' + esc(ax.d) + "</p>" +
        (list.length ? '<ul class="ch-list">' + list.map(function (e) { return chronoEventHTML(e, true); }).join("") + "</ul>"
          : '<p class="ch-none">这一条线上没有匹配的事件。</p>') + "</div>";
    }
    return '<div class="ch-grid">' + Object.keys(CHRONO_AX).map(function (k) {
      var list = chronoByAxis(k).filter(chronoHit);
      return '<section class="ch-col"><h3>' + esc(CHRONO_AX[k].n) + "<span>" + list.length + " 条</span></h3>" +
        '<p class="ch-axd">' + esc(CHRONO_AX[k].d) + "</p>" +
        (list.length ? '<ul class="ch-list">' + list.map(function (e) { return chronoEventHTML(e, false); }).join("") + "</ul>"
          : '<p class="ch-none">没有匹配的事件。</p>') + "</section>";
    }).join("") + "</div>";
  }

  function renderChrono() {
    var out = document.getElementById("ch-body");
    if (out) out.innerHTML = chronoBodyHTML();
    var n = document.getElementById("ch-count");
    if (n) {
      var tot = CHRONO.filter(chronoHit).length;
      n.textContent = CHR.q.trim() ? "筛出 " + tot + " 条" : "共 " + CHRONO.length + " 条";
    }
  }

  function bindChrono() {
    var tabs = document.getElementById("ch-tabs");
    if (tabs) {
      tabs.addEventListener("click", function (e) {
        var b = e.target && e.target.closest ? e.target.closest("[data-ax]") : null;
        if (!b) return;
        CHR.ax = b.getAttribute("data-ax");
        tabs.querySelectorAll("[data-ax]").forEach(function (x) {
          x.classList.toggle("on", x === b);
        });
        renderChrono();
      });
    }
    var q = document.getElementById("ch-q");
    if (q) {
      q.value = CHR.q;
      q.addEventListener("input", function () { CHR.q = q.value; renderChrono(); });
    }
    renderChrono();
  }

  /* 年表导出：Word 与 Markdown 都按三条轴分段，每条一句 */
  function chronoBlocks() {
    var b = [{ t: "title", text: "《资本论》大事年表" },
      { t: "sub", text: "三条线并置：马克思生平 · 写作与出版 · 中国译介与传播（" + CHRONO.length + " 条）" }];
    Object.keys(CHRONO_AX).forEach(function (k) {
      b.push({ t: "h2", text: CHRONO_AX[k].n });
      chronoByAxis(k).forEach(function (e) {
        var tid = e.tid ? BY_ID[e.tid] : null;
        b.push({ t: "p", text: e.y + "年" + (e.md ? e.md : "") + "　" + e.t + "。" + e.d });
        b.push({ t: "small", text: "　　来源（" + (CHRONO_SRC[e.k] || CHRONO_SRC.common).n + "）：" +
          (e.k === "term" && tid ? "站内词条「" + tid.term + "」。"
            : (e.src || (CHRONO_SRC[e.k] || CHRONO_SRC.common).d)) });
      });
    });
    b.push({ t: "small", text: "　　「通行年表」各项为学界通行年份，本站尚未逐条核到页码，正式引用请另查权威年表。" });
    return b;
  }

  function chronoMarkdown() {
    var out = ["# 《资本论》大事年表", ""];
    Object.keys(CHRONO_AX).forEach(function (k) {
      out.push("## " + CHRONO_AX[k].n, "");
      chronoByAxis(k).forEach(function (e) {
        var tid = e.tid ? BY_ID[e.tid] : null;
        out.push("- **" + e.y + "年" + (e.md || "") + "**　" + e.t + "。" + e.d +
          "（来源：" + (CHRONO_SRC[e.k] || CHRONO_SRC.common).n +
          (e.k === "term" && tid ? "「" + tid.term + "」" : "") + "）");
      });
      out.push("");
    });
    return out.join("\n");
  }

  function chronoPanel() {
    var tabs = [["all", "三条并置"]].concat(Object.keys(CHRONO_AX).map(function (k) {
      return [k, CHRONO_AX[k].n];
    })).map(function (p) {
      return '<button type="button" class="ch-tab' + (CHR.ax === p[0] ? " on" : "") +
        '" data-ax="' + p[0] + '">' + esc(p[1]) + "</button>";
    }).join("");
    var legend = Object.keys(CHRONO_SRC).map(function (k) {
      return '<span class="ch-lg"><i class="ch-k k-' + k + '">' + esc(CHRONO_SRC[k].n) + "</i>" +
        esc(CHRONO_SRC[k].d) + "</span>";
    }).join("");
    return '<section class="tool-card" id="chrono">' +
      "<h2>大事年表</h2>" +
      '<p class="tool-sub">三条线并置着看：<b>马克思生平</b>、<b>《资本论》写作与出版</b>、' +
      "<b>中国译介与传播</b>。写发展史、传播史的时候，最麻烦的是「这件事是哪一年、" +
      "当时书出到哪儿了」——把三条线摆在一起，年份自然对得上。</p>" +
      '<div class="ch-tabs" id="ch-tabs">' + tabs + "</div>" +
      '<div class="qs-bar">' +
        '<input type="search" id="ch-q" class="qs-input" placeholder="按年份、事件、人名或书名筛……">' +
        '<span class="ch-count" id="ch-count"></span>' +
      "</div>" +
      '<div class="wa-acts cm-noprint">' +
        '<button class="tt-btn" type="button" data-act="ch-word">导出 Word</button>' +
        '<button class="tt-btn" type="button" data-act="ch-md">复制 Markdown</button>' +
      "</div>" +
      '<div class="ch-legend">' + legend + "</div>" +
      '<div id="ch-body"></div>' +
      '<p class="ch-foot">年表里每一类来源都标在事件的下面，三类不能混着看：' +
      "「卷首文献」与「站内词条」两项可以在本站查到出处；「通行年表」只保证年份通行，" +
      "本站没有逐条核过页码——写论文引到这一类，请自己再核一遍。</p>" +
    "</section>";
  }

  /* ================= 4) 讲义与投影模式 ================= */

  var HD_KEY = "capital-dict-hd-v1";
  var HD = { picks: [], q: "", scope: "all" };

  function hdLoad() {
    try {
      var a = JSON.parse(localStorage.getItem(HD_KEY) || "null");
      if (a && Array.isArray(a.picks)) {
        HD.picks = a.picks.filter(function (id) { return !!BY_ID[id]; });
      }
    } catch (e) { /* 存不了就只在本次会话里记 */ }
  }
  function hdSave() {
    try { localStorage.setItem(HD_KEY, JSON.stringify({ picks: HD.picks })); } catch (e) { /* 忽略 */ }
  }
  function hdAdd(id) {
    if (!BY_ID[id] || HD.picks.indexOf(id) > -1) return false;
    HD.picks.push(id);
    hdSave();
    return true;
  }
  function hdDel(id) {
    var at = HD.picks.indexOf(id);
    if (at > -1) HD.picks.splice(at, 1);
    hdSave();
  }
  function hdTerms() {
    return HD.picks.map(function (id) { return BY_ID[id]; }).filter(Boolean);
  }
  function hdQuote(t) {
    var os = t.original || [], best = null;
    for (var i = 0; i < os.length; i++) {
      if (os[i].text) { best = os[i]; if (os[i].verify) break; }
    }
    return best;
  }
  /* 词条的位置说明：知识板块门类名，外加原著位置标签 */
  function hdWhere(t) {
    var s = [];
    var dom = taxById("domain");
    if (dom) {
      var d = (dom.cats || []).filter(function (c) { return c.id === t.domain; })[0];
      if (d) s.push(d.name);
    }
    var places = (t.tags || []).filter(function (x) { return /^第[一二三]卷|^第[一二三四五六七八九十]+篇$/.test(x); });
    if (places.length) s.push(places.slice(0, 3).join("・"));
    return s.join(" · ");
  }

  function hdDocHTML() {
    var ts = hdTerms();
    if (!ts.length) return '<p class="hd-empty">左边的清单还是空的。选几条词条，这里就排出讲义。</p>';
    return '<article class="hd-doc">' +
      '<header class="hd-head"><p class="hd-k">《资本论》学习平台 · 读书会讲义</p>' +
        "<h2>术语讲义（" + ts.length + " 条）</h2>" +
        '<p class="hd-sub">每条给出：AI 的一句话释义 · 标准释义 · 原典直引 · 原著位置。' +
        '引文出处与页码已在站内核过；「待补录」「页码待核」的条目如实标出，不凑整齐。</p></header>' +
      ts.map(function (t, i) {
        var q = hdQuote(t);
        return '<section class="hd-t">' +
          '<h3><span class="hd-no">' + (i + 1) + "</span>" + esc(t.term) +
            (t.en ? '<span class="hd-en">' + esc(t.en) + "</span>" : "") +
            (t.de ? '<span class="hd-de">' + esc(t.de) + "</span>" : "") + "</h3>" +
          '<p class="hd-where">' + esc(hdWhere(t)) + "</p>" +
          '<p class="hd-one">' + esc(t.oneline || "") + "</p>" +
          '<p class="hd-std">' + esc(t.standard || "") + "</p>" +
          (q ? '<blockquote class="hd-q">' + esc(q.text) + "</blockquote>" +
            '<p class="hd-cite">' + esc(q.cite || "") + (q.verify ? "" : "（页码待核）") + "</p>"
            : '<p class="hd-cite">本条暂无原典引文（站内标为待补录）。</p>') +
        "</section>";
      }).join("") +
      '<footer class="hd-foot">本讲义由站内 300 条术语现场生成，仅供读书会与课堂使用。' +
      "引文一律以所标版本页码为准。</footer>" +
    "</article>";
  }

  function hdBlocks() {
    var ts = hdTerms();
    var b = [{ t: "title", text: "《资本论》术语讲义" },
      { t: "sub", text: "《资本论》学习平台 · 共 " + ts.length + " 条 · 每条含 AI 的一句话释义、标准释义、原典直引与原著位置" }];
    ts.forEach(function (t, i) {
      b.push({ t: "h2", text: (i + 1) + ". " + t.term + (t.en ? "（" + t.en + "）" : "") });
      b.push({ t: "small", text: hdWhere(t) });
      b.push({ t: "p", text: t.oneline || "" });
      b.push({ t: "p", text: t.standard || "" });
      var q = hdQuote(t);
      if (q) {
        b.push({ t: "quote", text: q.text });
        b.push({ t: "small", text: "出处：" + (q.cite || "") + (q.verify ? "" : "（页码待核）") });
      } else {
        b.push({ t: "small", text: "本条暂无原典引文（站内标为待补录）。" });
      }
    });
    return b;
  }

  function hdMarkdown() {
    var out = ["# 《资本论》术语讲义", ""];
    hdTerms().forEach(function (t, i) {
      var q = hdQuote(t);
      out.push("## " + (i + 1) + ". " + t.term + (t.en ? "（" + t.en + "）" : ""), "");
      out.push("> " + hdWhere(t), "");
      out.push(t.oneline || "", "");
      out.push(t.standard || "", "");
      out.push(q ? "> " + q.text + "\n>\n> —— " + (q.cite || "") + (q.verify ? "" : "（页码待核）")
        : "（本条暂无原典引文）", "");
    });
    return out.join("\n");
  }

  function renderHd() {
    var doc = document.getElementById("hd-doc");
    if (doc) doc.innerHTML = hdDocHTML();
    var picks = document.getElementById("hd-picks");
    if (picks) {
      picks.innerHTML = HD.picks.length
        ? HD.picks.map(function (id) {
            return '<span class="hd-pick">' + esc(BY_ID[id].term) +
              '<button type="button" data-act="hd-del" data-id="' + esc(id) + '" title="移出讲义">✕</button></span>';
          }).join("")
        : '<span class="pk-hint">讲义还是空的——从上面选一批词条进来。</span>';
    }
    var sugs = document.getElementById("hd-sugs");
    if (sugs) {
      sugs.innerHTML = hdSugHTML();
    }
    var cnt = document.getElementById("hd-cnt");
    if (cnt) cnt.textContent = HD.picks.length + " 条";
  }

  function hdSugHTML() {
    var kw = (HD.q || "").trim();
    if (!kw) return '<span class="pk-hint">输入词条名、别名、英文名或拼音首字母，点一条加进讲义。</span>';
    var ids = ctSearch(kw).filter(function (id) { return HD.picks.indexOf(id) === -1; });
    if (!ids.length) return '<span class="pk-none">没有匹配的词条（也可能都已经在讲义里了）。</span>';
    return ids.map(function (id) {
      var t = BY_ID[id];
      return '<button type="button" class="pk-sug" data-act="hd-add" data-id="' + esc(id) + '">' +
        esc(t.term) + (t.en ? "<i>" + esc(t.en) + "</i>" : "") + "</button>";
    }).join("");
  }

  function bindHandout() {
    var sc = document.getElementById("hd-scope");
    if (sc) {
      sc.value = HD.scope;
      sc.addEventListener("change", function () { HD.scope = sc.value; });
    }
    var q = document.getElementById("hd-q");
    if (q) {
      q.value = HD.q;
      q.addEventListener("input", function () { HD.q = q.value; renderHd(); });
    }
    renderHd();
  }

  /* 按范围整批加入：生词本、已读、某个门类——讲课前不必一条条敲 */
  function hdFill() {
    var list = quizPool(HD.scope);
    var add = 0;
    list.forEach(function (t) { if (hdAdd(t.id)) add++; });
    renderHd();
    var msg = document.getElementById("hd-msg");
    if (msg) msg.textContent = add ? "新加进 " + add + " 条。" : "这一范围里的词条都已在讲义里。";
  }

  /* —— 投影模式：一条一屏，方向键翻页 —— */
  var PJ = { open: false, list: [], i: 0, lg: false };

  function pjTerm() { return PJ.list[PJ.i] || null; }

  function pjHTML() {
    var t = pjTerm();
    var bar = '<div class="pj-bar">' +
      '<span class="pj-cnt">' + (PJ.i + 1) + " / " + PJ.list.length + "</span>" +
      '<span class="pj-hint">← → 或空格翻页 · Esc 退出</span>' +
      '<button type="button" class="pj-btn" data-act="pj-lg">字号</button>' +
      '<button type="button" class="pj-btn" data-act="pj-close">退出</button>' +
      "</div>";
    if (!t) {
      return bar + '<div class="pj-body"><p class="pj-empty">讲义是空的——先到「讲义与投影模式」里选几条词条。</p></div>';
    }
    var q = hdQuote(t);
    return bar +
      '<button type="button" class="pj-nav prev" data-act="pj-prev" aria-label="上一条">‹</button>' +
      '<button type="button" class="pj-nav next" data-act="pj-next" aria-label="下一条">›</button>' +
      '<div class="pj-body">' +
        '<p class="pj-where">' + esc(hdWhere(t)) + "</p>" +
        "<h2 class=\"pj-n\">" + esc(t.term) + "</h2>" +
        '<p class="pj-also">' + (t.en ? esc(t.en) : "") + (t.de ? "　·　" + esc(t.de) : "") + "</p>" +
        '<p class="pj-one">' + esc(t.oneline || "") + "</p>" +
        '<p class="pj-std">' + esc(t.standard || "") + "</p>" +
        (q ? '<blockquote class="pj-q">' + esc(q.text) + "</blockquote>" +
          '<p class="pj-cite">' + esc(q.cite || "") + "</p>" : "") +
      "</div>";
  }

  function pjRender() {
    var el = document.getElementById("pj");
    if (!el) return;
    el.className = "pj" + (PJ.lg ? " lg" : "");
    el.innerHTML = pjHTML();
  }

  function pjKey(ev) {
    if (!PJ.open) return;
    var k = ev.key;
    if (k === "Escape") { pjClose(); ev.preventDefault(); return; }
    if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown" || k === " " || k === "Enter") {
      pjGo(1); ev.preventDefault(); return;
    }
    if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp") { pjGo(-1); ev.preventDefault(); return; }
    if (k === "Home") { PJ.i = 0; pjRender(); ev.preventDefault(); return; }
    if (k === "End") { PJ.i = PJ.list.length - 1; pjRender(); ev.preventDefault(); return; }
  }

  function pjGo(d) {
    if (!PJ.list.length) return;
    PJ.i = Math.max(0, Math.min(PJ.list.length - 1, PJ.i + d));
    pjRender();
  }

  function pjOpen(list, from) {
    PJ.list = (list && list.length ? list : hdTerms());
    PJ.i = Math.max(0, Math.min(PJ.list.length - 1, from || 0));
    PJ.open = true;
    var el = document.getElementById("pj");
    if (!el) {
      el = document.createElement("div");
      el.id = "pj";
      el.className = "pj";
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-label", "投影模式");
      document.body.appendChild(el);
    }
    document.body.classList.add("pj-on");
    pjRender();
    document.addEventListener("keydown", pjKey, true);
  }

  function pjClose() {
    if (!PJ.open) return;
    PJ.open = false;
    document.removeEventListener("keydown", pjKey, true);
    document.body.classList.remove("pj-on");
    var el = document.getElementById("pj");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function handoutPanel() {
    var n = HD.picks.length;
    return '<section class="tool-card" id="handout">' +
      "<h2>讲义与投影模式</h2>" +
      '<p class="tool-sub">选一批词条，排成一页页的讲义：<b>导出 Word</b> 打印分发给读书会，' +
      "或直接进<b>投影模式</b>——一条一屏，字号放大，方向键翻页，投影到幕布上照着讲。" +
      "每条给的是 AI 的一句话释义、标准释义、一条已核原典引文与原著位置。</p>" +
      '<div class="qs-bar">' +
        '<label class="wa-lab">整批加入<select id="hd-scope" class="qs-select">' + scopeOpts(HD.scope) + "</select></label>" +
        '<button class="tt-btn" type="button" data-act="hd-fill">把这些词条加进来</button>' +
        '<span class="hd-msg" id="hd-msg"></span>' +
      "</div>" +
      '<div class="qs-bar">' +
        '<input type="search" id="hd-q" class="qs-input" placeholder="再手动加：词条名 / 别名 / 英文 / 拼音首字母……">' +
        '<span class="hd-cnt" id="hd-cnt">' + n + " 条</span>" +
      "</div>" +
      '<div class="pk-sugs" id="hd-sugs"></div>' +
      '<div class="hd-picks" id="hd-picks"></div>' +
      '<div class="wa-acts cm-noprint">' +
        '<button class="tt-btn primary" type="button" data-act="hd-word">导出讲义 Word</button>' +
        '<button class="tt-btn" type="button" data-act="hd-md">复制 Markdown</button>' +
        '<button class="tt-btn" type="button" data-act="hd-print">打印这一份</button>' +
        '<button class="tt-btn" type="button" data-act="pj-open">进入投影模式</button>' +
        '<button class="tt-btn" type="button" data-act="hd-clear">清空</button>' +
      "</div>" +
      '<div id="hd-doc"></div>' +
      '<p class="hd-note">讲义只取站内已核的内容：原典引文用站内逐字核过的版本，' +
      "「页码待核」「待补录」的条目照样标出来——讲课可以少讲一条，不能把没核过的页码念给听众。</p>" +
    "</section>";
  }

  /* ================================================================
     写作台：把「取素材」接上「成文」这最后一步。
     词条页取来的原典引文与争鸣立场、自己写的笔记与段落，都落成一张张卡片，
     按章节排好；导出 Word 时引文自动变成真脚注（①②③，每页重编），
     文末按出现顺序给出参考文献——脚注编号与文献表的顺序都由程序保证一致。
     数据仍在 localStorage，不联网；一篇文章一个文档，可多篇并存。
     ================================================================ */
  var WT_KEY = "capital-dict-writer-v1";
  var WT = { docs: [], cur: "", sel: "" };
  var WT_KINDS = [
    ["quote", "原典引文"], ["claim", "争鸣立场"], ["note", "我的笔记"], ["free", "自撰段落"]
  ];
  var WT_KIND_NAME = {};
  WT_KINDS.forEach(function (k) { WT_KIND_NAME[k[0]] = k[1]; });

  function wtId(p) {
    return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* 面板外面（词条页、动作处理里）也要能取到稿子，所以有个轻量的兜底加载 */
  function wtEnsure() { if (!WT.docs.length) wtLoad(); }

  function wtNewSec(title) {
    return { id: wtId("s"), h: title || "新的一节", cards: [] };
  }

  function wtLoad() {
    var d = null;
    try {
      var raw = window.localStorage.getItem(WT_KEY);
      if (raw) d = JSON.parse(raw);
    } catch (e) { d = null; }          // 存储被禁用或内容坏了：退回空稿
    if (!d || !d.docs || !d.docs.length) {
      var sec = wtNewSec("一、引言");
      d = { docs: [{ id: wtId("d"), title: "未命名文稿", secs: [sec] }], cur: "", sel: "" };
      d.cur = d.docs[0].id;
      d.sel = sec.id;
    }
    d.docs.forEach(function (doc) {
      doc.secs = doc.secs || [];
      if (!doc.secs.length) doc.secs.push(wtNewSec("一、引言"));
      doc.secs.forEach(function (s) { s.cards = s.cards || []; });
    });
    WT.docs = d.docs;
    WT.cur = d.cur && d.docs.some(function (x) { return x.id === d.cur; }) ? d.cur : d.docs[0].id;
    var cur = wtDoc();
    WT.sel = cur.secs.some(function (s) { return s.id === d.sel; }) ? d.sel : cur.secs[0].id;
    return WT;
  }

  function wtSave() {
    try {
      window.localStorage.setItem(WT_KEY, JSON.stringify(
        { docs: WT.docs, cur: WT.cur, sel: WT.sel }));
    } catch (e) { /* 存储满或被禁：静默，页面上仍有内容 */ }
  }

  function wtDoc() {
    for (var i = 0; i < WT.docs.length; i++) if (WT.docs[i].id === WT.cur) return WT.docs[i];
    return WT.docs[0];
  }
  function wtSec() {
    var d = wtDoc();
    for (var i = 0; i < d.secs.length; i++) if (d.secs[i].id === WT.sel) return d.secs[i];
    return d.secs[0];
  }
  function wtSecById(id) {
    var out = null;
    WT.docs.forEach(function (d) {
      d.secs.forEach(function (s) { if (s.id === id) out = s; });
    });
    return out;
  }
  function wtCardById(id) {
    var out = null;
    WT.docs.forEach(function (d) {
      d.secs.forEach(function (s) {
        s.cards.forEach(function (c) { if (c.id === id) out = { s: s, c: c }; });
      });
    });
    return out;
  }

  /* 从词条页收素材：原典引文与争鸣立场各成一张卡。
     没建过文档就先建一份，别让人先去做「新建文稿」这种准备工作。 */
  function wtAddTerm(id) {
    var t = BY_ID[id];
    if (!t) return 0;
    if (!WT.docs.length) wtLoad();
    var sec = wtSec();
    var n = 0;
    (t.original || []).forEach(function (o) {
      if (!o.text) return;
      sec.cards.push({ id: wtId("c"), kind: "quote", text: o.text,
        cite: o.cite || "", term: t.term, termId: t.id,
        fn: [o.chapter, o.cite].filter(Boolean).join("，") });
      n++;
    });
    (t.scholars || []).forEach(function (g) {
      (g.stances || []).forEach(function (s) {
        if (!s.view) return;
        sec.cards.push({ id: wtId("c"), kind: "claim", text: s.view,
          cite: s.cite || "", term: t.term, termId: t.id, side: s.side || "",
          fn: [s.cite, g.focus ? "议题：" + g.focus : ""].filter(Boolean).join("；") });
        n++;
      });
    });
    if (!n) {
      sec.cards.push({ id: wtId("c"), kind: "note", text: LR.getNote(t.id) || "",
        term: t.term, termId: t.id, cite: "" });
      n = 1;
    }
    wtSave();
    return n;
  }

  /* 统计与脚注：脚注按「卡片在正文里的先后」编号，同一条引注复用同一个号，
     这样文末的参考文献表与正文里的角标天然对得上。 */
  function wtFootnotes(secs) {
    var map = {}, list = [];
    (secs || wtDoc().secs).forEach(function (s) {
      s.cards.forEach(function (c) {
        var src = (c.fn || c.cite || "").trim();
        if (!src) return;
        if (!map[src]) { list.push(src); map[src] = list.length; }
      });
    });
    return { map: map, list: list };
  }

  function wtStats() {
    var d = wtDoc();
    var chars = 0, quotes = 0, claims = 0, refs = wtFootnotes(d.secs).list.length;
    d.secs.forEach(function (s) {
      s.cards.forEach(function (c) {
        chars += (c.text || "").replace(/\s/g, "").length;
        if (c.kind === "quote") quotes++;
        if (c.kind === "claim") claims++;
      });
    });
    return { chars: chars, quotes: quotes, claims: claims, refs: refs,
             secs: d.secs.length, cards: d.secs.reduce(function (a, s) { return a + s.cards.length; }, 0) };
  }

  /* —— 导出：Word（引文走真脚注）与 Markdown（脚注用 [^n] 标记） —— */
  function wtBlocks() {
    var d = wtDoc();
    var fns = wtFootnotes(d.secs);
    var b = [{ t: "title", text: d.title || "未命名文稿" },
      { t: "sub", text: "《资本论》学习平台 · 写作台导出 · 共 " + d.secs.length + " 节" +
        (fns.list.length ? "、" + fns.list.length + " 条引注" : "") }];
    d.secs.forEach(function (s) {
      b.push({ t: "h2", text: s.h || "未命名章节" });
      s.cards.forEach(function (c) {
        var src = (c.fn || c.cite || "").trim();
        var no = src ? fns.map[src] : 0;
        if (!c.text || !c.text.trim()) return;
        if (c.kind === "quote") {
          b.push({ t: "quote", text: c.text, fn: src ? src : null });
        } else if (c.kind === "claim") {
          b.push({ t: "p", text: (c.side ? c.side + "：" : "") + c.text, fn: src ? src : null });
        } else {
          b.push({ t: "p", text: c.text });
        }
      });
    });
    if (fns.list.length) {
      b.push({ t: "h2", text: "参考文献" });
      fns.list.forEach(function (s, i) { b.push({ t: "ref", text: "[" + (i + 1) + "] " + s }); });
    }
    b.push({ t: "small", text: "本稿由《资本论》学习平台站内写作台导出；引文出处取自站内已核版本，" +
      "标为「待核」「待补录」的条目在站内原页如实标出，请按所引版本复核页码后定稿。" });
    return b;
  }

  function wtMarkdown() {
    var d = wtDoc();
    var fns = wtFootnotes(d.secs);
    var out = ["# " + (d.title || "未命名文稿"), ""];
    d.secs.forEach(function (s) {
      out.push("## " + (s.h || "未命名章节"), "");
      s.cards.forEach(function (c) {
        if (!c.text || !c.text.trim()) return;
        var src = (c.fn || c.cite || "").trim();
        var mark = src ? "[^" + fns.map[src] + "]" : "";
        if (c.kind === "quote") out.push("> " + c.text + mark, "");
        else out.push((c.side ? "**" + c.side + "**：" : "") + c.text + mark, "");
      });
    });
    if (fns.list.length) {
      out.push("## 参考文献", "");
      fns.list.forEach(function (s, i) { out.push("[^" + (i + 1) + "]: " + s); });
      out.push("");
    }
    return out.join("\n");
  }

  function wtCardHTML(c) {
    var kind = WT_KIND_NAME[c.kind] || "卡片";
    return '<li class="wt-card wt-' + c.kind + '" data-card="' + esc(c.id) + '">' +
      '<div class="wt-c-head"><span class="wt-badge">' + esc(kind) + "</span>" +
        (c.term ? '<a class="wt-src" href="#/t/' + esc(c.termId || "") + '">' + esc(c.term) + "</a>" : "") +
        '<span class="wt-c-act">' +
          '<button type="button" class="tbtn" data-act="wt-up" data-id="' + esc(c.id) + '" title="上移">↑</button>' +
          '<button type="button" class="tbtn" data-act="wt-down" data-id="' + esc(c.id) + '" title="下移">↓</button>' +
          '<button type="button" class="tbtn" data-act="wt-del" data-id="' + esc(c.id) + '" title="删掉这张卡">✕</button>' +
        "</span></div>" +
      '<textarea class="wt-ta" rows="' + (c.kind === "quote" ? 3 : 4) + '" data-card-text="' + esc(c.id) +
        '" placeholder="' + (c.kind === "free" ? "在这里写你自己的段落……" : "卡片内容") + '">' +
        esc(c.text || "") + "</textarea>" +
      (c.cite ? '<p class="wt-c-cite">' + esc(c.cite) + "</p>" : "") +
      "</li>";
  }

  function wtOutlineHTML() {
    var d = wtDoc();
    return '<ol class="wt-out">' + d.secs.map(function (s) {
      return '<li class="wt-sec' + (s.id === WT.sel ? " on" : "") + '" data-sec="' + esc(s.id) + '">' +
        '<button type="button" class="wt-sec-btn" data-act="wt-open" data-id="' + esc(s.id) + '">' +
          esc(s.h || "未命名章节") + '<em>' + s.cards.length + "</em></button>" +
        '<span class="wt-sec-act">' +
          '<button type="button" class="tbtn" data-act="wt-sec-up" data-id="' + esc(s.id) + '" title="上移">↑</button>' +
          '<button type="button" class="tbtn" data-act="wt-sec-down" data-id="' + esc(s.id) + '" title="下移">↓</button>' +
          '<button type="button" class="tbtn" data-act="wt-sec-del" data-id="' + esc(s.id) + '" title="删掉这一节">✕</button>' +
        "</span></li>";
    }).join("") + "</ol>";
  }

  function wtRender() {
    var out = document.getElementById("wt-out");
    if (out) out.innerHTML = wtOutlineHTML();
    var title = document.getElementById("wt-title");
    if (title && title.value !== wtDoc().title) title.value = wtDoc().title;
    var h = document.getElementById("wt-sec-h");
    if (h && h.value !== wtSec().h) h.value = wtSec().h || "";
    var cards = document.getElementById("wt-cards");
    if (cards) {
      cards.innerHTML = wtSec().cards.length
        ? wtSec().cards.map(wtCardHTML).join("")
        : '<li class="wt-empty">这一节还是空的：<a href="#/idx">去词条页</a>点「加入写作台」，' +
          "或点上面的「＋ 自撰段落」自己起一段。</li>";
    }
    var st = wtStats();
    var sum = document.getElementById("wt-stat");
    if (sum) {
      sum.textContent = st.secs + " 节 · " + st.cards + " 张卡（引文 " + st.quotes +
        " · 争鸣 " + st.claims + "）· 正文 " + st.chars + " 字 · 参考文献 " + st.refs + " 条";
    }
    var sel = document.getElementById("wt-doc");
    if (sel) {
      sel.innerHTML = WT.docs.map(function (d) {
        return '<option value="' + esc(d.id) + '"' + (d.id === WT.cur ? " selected" : "") + ">" +
          esc(d.title || "未命名文稿") + "</option>";
      }).join("");
    }
  }

  function writerPanel() {
    wtEnsure();
    return '<section class="tool-card" id="writer">' +
      "<h2>写作台</h2>" +
      '<p class="tool-sub">把读到的素材按章节排成稿子：词条页的<b>原典引文</b>与<b>争鸣立场</b>一键收进来，' +
      "配上自己的笔记与段落，导出 Word 或 Markdown。<b>引文走真脚注</b>（①②③，每页重编），" +
      "文末参考文献按出现顺序自动排好——正文角标与文献表由同一份数据生成，不会对不上号。</p>" +
      '<div class="wt-bar">' +
        '<label class="wa-lab">文稿<select id="wt-doc" class="qs-select"></select></label>' +
        '<input type="text" id="wt-title" class="qs-input wt-title-in" placeholder="文稿标题，如：论《资本论》中的劳动概念">' +
        '<button class="tt-btn" type="button" data-act="wt-new">新建文稿</button>' +
        '<button class="tt-btn" type="button" data-act="wt-doc-del">删掉这篇</button>' +
      "</div>" +
      '<div class="wt-grid">' +
        '<div class="wt-left">' +
          '<div class="wt-left-h"><span>大纲</span>' +
            '<button class="tt-btn" type="button" data-act="wt-sec-add">＋ 加一节</button></div>' +
          '<div id="wt-out"></div>' +
        "</div>" +
        '<div class="wt-right">' +
          '<input type="text" id="wt-sec-h" class="qs-input wt-sec-in" placeholder="本节标题">' +
          '<div class="wt-add">' +
            WT_KINDS.map(function (k) {
              return '<button class="tt-btn" type="button" data-act="wt-card-add" data-kind="' + k[0] +
                '">＋ ' + k[1] + "</button>";
            }).join("") +
          "</div>" +
          '<ul class="wt-cards" id="wt-cards"></ul>' +
        "</div>" +
      "</div>" +
      '<p class="wt-stat" id="wt-stat"></p>' +
      '<div class="wa-acts cm-noprint">' +
        '<button class="tt-btn primary" type="button" data-act="wt-word">导出 Word（真脚注）</button>' +
        '<button class="tt-btn" type="button" data-act="wt-md">复制 Markdown</button>' +
        '<button class="tt-btn" type="button" data-act="wt-copy-cite">复制全部引注</button>' +
        '<button class="tt-btn" type="button" data-act="wt-clear">清空本篇卡片</button>' +
        '<button class="tt-btn" type="button" data-act="wt-print">打印这一稿</button>' +
        '<span class="hc-msg" id="wt-msg" role="status"></span>' +
      "</div>" +
      '<p class="hd-note">稿子只存在这台机器的浏览器里。' +
      "导出的 Word 里，引文角标是真脚注：Word 会自动按页重编①②③，删掉中间一条，后面的编号会自己往前挪——" +
      "这一点是手敲脚注做不到的。出处一律取自站内已核版本，「待核」「待补录」的条目照原样带出，定稿前请复核页码。</p>" +
    "</section>";
  }

  function bindWriter() {
    wtEnsure();
    var docSel = document.getElementById("wt-doc");
    if (docSel) {
      docSel.addEventListener("change", function () {
        WT.cur = docSel.value;
        WT.sel = wtDoc().secs[0].id;
        wtSave();
        wtRender();
      });
    }
    var t = document.getElementById("wt-title");
    if (t) {
      t.addEventListener("input", function () {
        wtDoc().title = t.value;
        wtSave();
        var sel = document.getElementById("wt-doc");
        if (sel) {
          var op = sel.options[sel.selectedIndex];
          if (op) op.textContent = t.value || "未命名文稿";
        }
        if (WT.docs.length === 1) { /* 单篇时不同步下拉也行 */ }
      });
    }
    var h = document.getElementById("wt-sec-h");
    if (h) {
      h.addEventListener("input", function () {
        wtSec().h = h.value;
        wtSave();
        var li = document.querySelector('.wt-sec[data-sec="' + WT.sel + '"] .wt-sec-btn');
        if (li) {
          var n = li.querySelector("em");
          li.textContent = h.value || "未命名章节";
          if (n) li.appendChild(n);
        }
      });
    }
    /* 卡片正文：就地写回数据、只存不改结构——整块重绘会把光标顶掉 */
    var cards = document.getElementById("wt-cards");
    if (cards) {
      cards.addEventListener("input", function (e) {
        var ta = e.target.closest ? e.target.closest("[data-card-text]") : null;
        if (!ta) return;
        var got = wtCardById(ta.getAttribute("data-card-text"));
        if (!got) return;
        got.c.text = ta.value;
        wtSave();
        var sum = document.getElementById("wt-stat");
        var st = wtStats();
        if (sum) {
          sum.textContent = st.secs + " 节 · " + st.cards + " 张卡（引文 " + st.quotes +
            " · 争鸣 " + st.claims + "）· 正文 " + st.chars + " 字 · 参考文献 " + st.refs + " 条";
        }
      });
    }
    wtRender();
  }

  function wtMove(arr, id, d) {
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id !== id) continue;
      var j = i + d;
      if (j < 0 || j >= arr.length) return false;
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
      return true;
    }
    return false;
  }

  function wtSay(msg) {
    var el = document.getElementById("wt-msg");
    if (!el) return;
    el.textContent = msg;
    if (wtSay._t) clearTimeout(wtSay._t);
    wtSay._t = setTimeout(function () { el.textContent = ""; }, 4500);
  }

  /* 词条页「加入写作台」的回执：按钮就地变字，另给一枚浮出的提示条，
     因为站在词条页时看不到写作台面板，需要一句明确的「收进去了」。 */
  function wtToast(msg) {
    var el = document.getElementById("wt-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "wt-toast";
      el.className = "wt-toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("on");
    if (wtToast._t) clearTimeout(wtToast._t);
    wtToast._t = setTimeout(function () { el.classList.remove("on"); }, 2600);
  }

  /* ================= 图表生成（v70） =================
     导入 xlsx / csv，自动画像数据结构、推荐图表类型并出图；
     十六种图型全部自绘 SVG——零依赖约束不变：xlsx 读取复用阅读器的
     ZIP Central Directory 解析＋原生 DecompressionStream 解压，
     sheet XML 用正则流式抽值，不联网、不引库，file:// 双击可用。
     渲染产出的 SVG 元素全带呈现属性（不依赖外部样式表），
     因此 PNG / SVG 导出走 exportGraphPng 同一套克隆思路。 */

  var CH = {
    docs: [],        // {name, sheets:[{name, rows}], ok, msg}
    doc: 0, sheet: 0,
    type: "",        // 当前图型 spec id
    cfg: null        // {title, sub, legend, theme, stacked, donut, trend, catCol, valCols[]}
  };

  /* —— 配色主题：每套 8 个系列色＋一个强调色。默认「朱砂」从站内
     红金令牌取色（--accent/--gold），其余主题压低饱和，保证米白底上成图不艳俗。 —— */
  var CH_THEMES = {
    zhusha: { n: "朱砂 · 站点同款", ink: "#640a0e", axis: "#8b8071",
      series: ["#9c1512", "#c98a2b", "#4d6b54", "#37506d", "#8a5a00", "#6d4b6e", "#4f7d7b", "#a8442e"] },
    daix: { n: "黛蓝", ink: "#2f4d6e", axis: "#7a8699",
      series: ["#2f4d6e", "#5d7fa3", "#8aa8c0", "#c1a877", "#4d6b54", "#8a5a00", "#6e4b6e", "#55636b"] },
    qingzhu: { n: "青竹", ink: "#33553f", axis: "#7a8678",
      series: ["#33553f", "#5d8466", "#8aa886", "#c9b071", "#7a5230", "#5a6d7a", "#8a6a52", "#4d6b70"] },
    xuanmo: { n: "玄墨", ink: "#33302a", axis: "#8b8071",
      series: ["#33302a", "#6d6459", "#a89f8f", "#9c1512", "#c98a2b", "#55636b", "#6d4b6e", "#7c6335"] }
  };

  /* —— CSV：逗号/分号/制表符嗅探＋引号段。utf-8 先解，出现替换符再回退 GBK
     （浏览器 TextDecoder 原生支持，中文 Excel 另存的 ANSI 表救得回来）。 —— */
  function chParseCsv(text) {
    var deli = (text.split("\n")[0] || "").match(/;/) ? ";" :
      ((text.split("\n")[0] || "").indexOf("\t") > -1 ? "\t" : ",");
    var rows = [], row = [], cur = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      if (q) {
        if (c === '"') { if (text.charAt(i + 1) === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === deli) { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (c !== "\r") cur += c;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (v) { return String(v).trim() !== ""; }); });
  }

  function chDecodeCsv(u8) {
    var t = new TextDecoder("utf-8").decode(u8);
    if ((t.match(/\uFFFD/g) || []).length > 2) {
      try { return new TextDecoder("gbk").decode(u8); } catch (e) { /* 无 GBK 就带替换符用 */ }
    }
    return t.replace(/^\uFEFF/, "");
  }

  /* —— xlsx：复用阅读器的 readerListZip / readerExtractZip（deflate-raw + store 都认）。 —— */
  function chCellCol(ref) {   // "BC12" → 列序号（0 基）
    var n = 0, m = /^[A-Z]+/.exec(ref || "");
    if (!m) return -1;
    for (var i = 0; i < m[0].length; i++) n = n * 26 + (m[0].charCodeAt(i) - 64);
    return n - 1;
  }
  function chXmlText(xml, tag) {   // 取首个 <tag …>…</tag> 的内文（含属性任意排布）
    var m = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">").exec(xml);
    return m ? m[1] : "";
  }
  function chXmlUnesc(s) {
    return String(s).replace(/&(?:amp|lt|gt|quot|apos|#x?[0-9a-fA-F]+);/g, function (e) {
      if (e === "&amp;") return "&";
      if (e === "&lt;") return "<";
      if (e === "&gt;") return ">";
      if (e === "&quot;") return '"';
      if (e === "&apos;") return "'";
      var hex = /^&#x/i.test(e), code = parseInt(e.replace(/^&#x?|;$/gi, ""), hex ? 16 : 10);
      return isFinite(code) && code > 0 ? String.fromCodePoint(code) : e;
    });
  }
  function chPickXml(xml, re, cb) {  // 逐个非贪婪匹配并回调
    var m; re.lastIndex = 0;
    while ((m = re.exec(xml))) { cb(m); if (m.index === re.lastIndex) re.lastIndex++; }
  }

  async function chartParseXlsx(ab) {
    var files = readerListZip(ab);
    var get = async function (name) {
      if (!files[name]) return null;
      return new TextDecoder("utf-8").decode(await readerExtractZip(ab, files[name]));
    };
    var wb = await get("xl/workbook.xml");
    if (!wb) throw new Error("不是有效的 xlsx（缺 workbook.xml）——旧版 .xls 请先另存为 xlsx");
    /* r:id → 目标路径：target 可能写 worksheets/…（相对 xl/）或 /xl/…（包根） */
    var relsXml = await get("xl/_rels/workbook.xml.rels") || "";
    var rels = {};
    chPickXml(relsXml, /<Relationship\b[^>]*>/g, function (m) {
      var id = /Id="([^"]+)"/.exec(m[0]), tg = /Target="([^"]+)"/.exec(m[0]);
      if (id && tg) {
        var t = tg[1].replace(/^\//, "");
        rels[id[1]] = /^xl\//.test(t) ? t : "xl/" + t;
      }
    });
    /* 共享字符串：<si> 里可能拆多个 <r><t>，按序拼接 */
    var shared = [];
    var ssXml = await get("xl/sharedStrings.xml");
    if (ssXml) chPickXml(ssXml, /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g, function (m) {
      var ts = [], t2;
      chPickXml(m[1], /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, function (x) { ts.push(x[1]); });
      shared.push(chXmlUnesc(ts.join("")));
    });
    var sheets = [];
    chPickXml(wb, /<sheet\b[^>]*\/?>/g, function (m) {
      var nm = /name="([^"]*)"/.exec(m[0]), rid = /r:id="([^"]+)"/.exec(m[0]) || /id="([^"]+)"/.exec(m[0]);
      if (rid) sheets.push({ name: nm ? chXmlUnesc(nm[1]) : "Sheet", target: rels[rid[1]] });
    });
    var out = [];
    for (var i = 0; i < sheets.length; i++) {
      var sx = sheets[i].target ? await get(sheets[i].target) : null;
      var rows = [];
      if (sx) {
        chPickXml(sx, /<row\b[^>]*>([\s\S]*?)<\/row>/g, function (m) {
          var cells = [];
          chPickXml(m[1], /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g, function (c) {
            var attrs = c[1] != null ? c[1] : c[3] || "";
            var body = c[2] != null ? c[2] : "";
            var ref = /\br="([A-Z]+\d+)"/.exec(attrs), t = /\bt="(\w+)"/.exec(attrs);
            var col = chCellCol(ref ? ref[1] : ""), v = "";
            var vm = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body);
            if (t && t[1] === "inlineStr") {
              var ts2 = [];
              chPickXml(body, /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, function (x) { ts2.push(x[1]); });
              v = chXmlUnesc(ts2.join(""));
            } else if (vm) {
              if (t && t[1] === "s") v = shared[+vm[1]] != null ? shared[+vm[1]] : "";
              else if (t && t[1] === "b") v = vm[1] === "1" ? "TRUE" : "FALSE";
              else if (t && t[1] === "e") v = "";
              else { v = chXmlUnesc(vm[1]); if (!isNaN(+v) && v.trim() !== "") v = +v; }
            }
            while (cells.length < col) cells.push("");   // 稀疏单元格按列号补齐
            cells.push(v);
          });
          rows.push(cells);
        });
      }
      if (rows.length) out.push({ name: sheets[i].name, rows: rows });
    }
    if (!out.length) throw new Error("工作簿里没有非空的工作表");
    return out;
  }

  /* —— 数据画像：给每一列分类（num/cat/time/id），供推荐器判断能画什么。 —— */
  var CH_TIME_RE = /^(\d{4}([年./\-]|$)|\d{4}-\d{1,2}(\D|$)|\d{1,2}月|[Qq][1-4]($|\s)|第?[一二三四]季度|(19|20)\d{2}\s*年?)/;
  var CH_MONTHS = "一月二月三月四月五月六月七月八月九月十月十一月十二月JanFebMarAprMayJunJulAugSepOctNovDec";

  function chProfile(tb) {
    var rows = tb.rows, head = rows[0] || [], body = rows.slice(1).filter(function (r) {
      return r.some(function (v) { return String(v).trim() !== ""; });
    });
    var nR = body.length, cols = [];
    for (var c = 0; c < head.length; c++) {
      var nNum = 0, nFill = 0, vals = [], uniq = {}, nTime = 0;
      for (var r = 0; r < body.length; r++) {
        var v = body[r][c], s = String(v == null ? "" : v).trim();
        if (s === "") continue;
        nFill++;
        if (typeof v === "number" && isFinite(v)) nNum++;
        else if (s !== "" && isFinite(+s.replace(/,/g, ""))) nNum++;
        var sv = typeof v === "number" ? String(v) : s;
        if (CH_TIME_RE.test(sv) || (sv.length <= 5 && CH_MONTHS.indexOf(sv) > -1)) nTime++;
        if (uniq[sv] !== 1) { uniq[sv] = 1; vals.push(sv); }
      }
      var nd = vals.length;
      var kind = "cat";
      if (nFill && nNum / nFill > 0.8 && nd > 2) kind = "num";
      else if (nFill && nTime / nFill > 0.7) kind = "time";
      else if (nR > 8 && nFill && nd / nFill > 0.92) kind = "id";  // 几乎行行不同：像主键，不当类别用
      cols.push({ i: c, name: String(head[c] == null ? "" : head[c]).trim() || ("列" + (c + 1)),
        kind: kind, fill: nFill, ndist: nd, nNum: nNum });
    }
    return { head: head, body: body, nRows: nR, cols: cols,
      colByKind: function (k) { return cols.filter(function (x) { return x.kind === k; }); } };
  }

  /* —— 推荐器：按形态打分。返回 [{type, why}]，首个为默认推荐。
     四类图谱（比较 / 趋势 / 结构占比 / 关联分布）都从列组合推出来。 —— */
  var CH_TYPES = [
    { id: "bar", n: "分组柱状图", g: "比较", use: "类别之间比大小，多列并排" },
    { id: "barStack", n: "堆积柱状图", g: "比较", use: "看每类总量与其内部构成" },
    { id: "barH", n: "条形图", g: "比较", use: "类别名长或类别多时，横向排更好读" },
    { id: "radar", n: "雷达图", g: "比较", use: "一个对象的多维综合评估" },
    { id: "line", n: "折线图", g: "趋势", use: "时间序列的走势" },
    { id: "area", n: "面积图", g: "趋势", use: "趋势之外还强调量的规模" },
    { id: "areaStack", n: "堆积面积图", g: "趋势", use: "各部分累加后的总量变化" },
    { id: "waterfall", n: "瀑布图", g: "趋势", use: "分步累积：收入、支出到净额的构成" },
    { id: "pie", n: "饼图", g: "结构占比", use: "3–6 类的占比，一眼看谁最大" },
    { id: "donut", n: "环形图", g: "结构占比", use: "占比之外中间还能放合计" },
    { id: "treemap", n: "树状图", g: "结构占比", use: "层级关系的面积占比" },
    { id: "scatter", n: "散点图", g: "关联分布", use: "两个数值变量是否相关" },
    { id: "bubble", n: "气泡图", g: "关联分布", use: "相关之外再带一个规模维度" },
    { id: "heatmap", n: "热力图", g: "关联分布", use: "行×列矩阵的密度与频率" },
    { id: "hist", n: "直方图", g: "关联分布", use: "一列数值落在各区间的频次" },
    { id: "box", n: "箱线图", g: "关联分布", use: "多列数据的中位数与离散程度" }
  ];
  function chTypeById(id) {
    for (var i = 0; i < CH_TYPES.length; i++) if (CH_TYPES[i].id === id) return CH_TYPES[i];
    return null;
  }

  function chRecommend(P) {
    var cands = [];
    var nums = P.colByKind("num"), cats = P.colByKind("cat").filter(function (c) { return c.kind === "cat" && c.ndist > 0; }),
      times = P.colByKind("time");
    var cat = cats[0], time = times[0] || null;
    var nR = P.nRows;
    var posOnly = true, hasNeg = false;
    if (nums.length === 1 && cat && time == null) {
      for (var r = 0; r < P.body.length; r++) {
        var v = +String(P.body[r][cat.i]).replace(/,/g, "");
        if (!isNaN(v)) { if (v < 0) { hasNeg = true; } }
      }
      posOnly = !hasNeg;
    }
    /* 趋势：时间列 + 数值列 */
    if (time && nums.length) {
      if (nums.length >= 3) cands.push({ type: "areaStack", why: "第一列是时间（" + time.name + "），后面 " + nums.length + " 列数值，适合看各部分累加的总量怎么走。" });
      cands.push({ type: "line", why: "「" + time.name + "」像时间轴，配 " + nums.length + " 列数值，折线最先看清走势。" });
      if (nums.length === 1) cands.push({ type: "area", why: "单列数值随时间变化，填成面积能同时看清走势与规模。" });
      cands.push({ type: "bar", why: "时间点不多时，分组柱状图也方便逐年对比。" });
    }
    /* 类别 + 数值：比较与占比 */
    if (cat && nums.length && time == null) {
      if (nums.length === 1) {
        if (cat.ndist > 6) cands.push({ type: "barH", why: "「" + cat.name + "」有 " + cat.ndist + " 个类别，超过 6 类，横向条形比饼图读得清。" });
        else {
          if (posOnly && cat.ndist >= 3) cands.push({ type: "pie", why: "「" + cat.name + "」" + cat.ndist + " 类、数值全为正，适合看占比；超过 6 类会自动建议改条形。" });
          cands.push({ type: "bar", why: "类别不多，柱状图并排比大小最直接。" });
        }
        if (hasNeg) cands.push({ type: "waterfall", why: "数值有正有负，瀑布图能看清每一步增减后的累积结果。" });
      } else {
        cands.push({ type: "bar", why: "「" + cat.name + "」×" + nums.length + " 列数值，分组并排最直观。" });
        cands.push({ type: "barStack", why: "若各列本是一件事的构成，改成堆积看总量更清楚。" });
        if (nR >= 3 && nR <= 10) cands.push({ type: "radar", why: "行数 " + nR + " 在 3–10 之间，每行是一个对象的多维评估，适合雷达。" });
      }
      cands.push({ type: "treemap", why: "类别列加数值列也能画成树状图，面积即大小，适合看层级。" });
      if (nums.length === 1) cands.push({ type: "donut", why: "同一份数据也可改环形，中间留白可放合计。" });
    }
    /* 两个类别列 + 数值：层级 */
    if (cats.length >= 2 && nums.length) {
      cands.unshift({ type: "treemap", why: "「" + cats[0].name + "」与「" + cats[1].name + "」是两层类别，树状图按面积同时呈现层级与占比。" });
    }
    /* 矩阵：行标签 + 多数值列（且没有明确时间） */
    if (!time && nums.length >= 3 && (cat || true) && nR >= 3) {
      cands.push({ type: "heatmap", why: nums.length + " 列数值排成矩阵，热力图用深浅直接给出高低分布。" });
      if (nR >= 5) cands.push({ type: "box", why: "各列数值可各画一只箱线，看中位数与离散。" });
    }
    /* 双数值：关联 */
    if (nums.length === 2 && time == null) cands.unshift({ type: "scatter", why: "两列数值，散点最先看出是否相关。" });
    if (nums.length === 3 && time == null) cands.unshift({ type: "bubble", why: "三列数值，第三列作气泡大小，一图看三个变量。" });
    /* 单数值列：分布 */
    if (nums.length === 1 && !cat && !time) {
      cands.push({ type: "hist", why: "只有一列数值，直方图看它落在哪些区间的频次。" });
      cands.push({ type: "box", why: "同一列也可画成一只箱线，看中位数与四分位。" });
    }
    if (nums.length >= 2) cands.push({ type: "box", why: "多列数值各画一只箱线，离群值一眼可见。" });
    /* 时间 + 类别 + 数值（长表）：折线多序列 */
    if (time && cat && nums.length) {
      cands.unshift({ type: "line", why: "时间 × 类别 × 数值的长表，按「" + cat.name + "」拆成多条折线。" });
    }
    var seen = {}, out = [];
    cands.forEach(function (c) {
      if (seen[c.type]) return;
      var t = chTypeById(c.type);
      if (!t) return;
      seen[c.type] = 1; c.n = t.n; c.g = t.g; out.push(c);
    });
    if (!out.length) out.push({ type: "hist", n: "直方图", g: "关联分布", why: "没有识别出明确的类别或时间列，先按一列数值的分布来画。" });
    return out;
  }

  /* —— 绘图公用：数字格式 · nice 刻度 · 文本测宽/截断 · 颜色插值 —— */
  function chTrim(x) { var s = (+x).toFixed(2); return s.replace(/\.?0+$/, ""); }
  function chFmt(v) {
    if (!isFinite(v)) return "—";
    var a = Math.abs(v);
    if (a >= 1e8) return chTrim(v / 1e8) + "亿";
    if (a >= 1e5) return chTrim(v / 1e4) + "万";
    if (a >= 1000) return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return chTrim(v);
  }
  function chNiceTicks(lo, hi, n) {
    if (!(hi > lo)) { if (hi === lo) { hi = lo + 1; } else { var t = lo; lo = hi; hi = t; } }
    var span = hi - lo, raw = span / Math.max(2, n),
      mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)),
      norm = raw / mag,
      step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag,
      lo0 = Math.floor(lo / step) * step, hi0 = Math.ceil(hi / step) * step,
      ticks = [];
    for (var v = lo0; v <= hi0 + step * 1e-9; v += step) ticks.push(Math.round(v * 1e9) / 1e9);
    return { lo: lo0, hi: hi0, step: step, ticks: ticks };
  }
  function chTextW(s, fs) {
    s = String(s);
    var w = 0;
    for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 255 ? fs : fs * 0.56;
    return w;
  }
  function chCut(s, n) { s = String(s); return s.length > n ? s.slice(0, Math.max(1, n - 1)) + "…" : s; }
  function chHexLerp(a, b, t) {
    var pa = [1, 3, 5].map(function (i) { return parseInt(a.substr(i, 2), 16); }),
      pb = [1, 3, 5].map(function (i) { return parseInt(b.substr(i, 2), 16); });
    return "#" + pa.map(function (x, i) {
      var v = Math.round(x + (pb[i] - x) * t).toString(16);
      return v.length < 2 ? "0" + v : v;
    }).join("");
  }
  function chSvgEsc(s) { return esc(s).replace(/"/g, "&quot;"); }

  /* 图表面板数据准备：按 cfg 取出「标签列 + 数值列」的工作矩阵。
     所有渲染器都从这里拿干净的 {labels, cols:[{name, vals}]}，列值统一转数。 */
  function chMatrix(P, cfg) {
    var cols = [];
    (cfg.valCols || []).forEach(function (ci) {
      var c = P.cols[ci];
      if (!c || c.kind !== "num") return;
      var vals = P.body.map(function (r) {
        var v = r[ci];
        if (typeof v === "number") return v;
        var s = String(v == null ? "" : v).trim().replace(/,/g, "");
        return s !== "" && isFinite(+s) ? +s : NaN;
      });
      cols.push({ name: c.name, vals: vals });
    });
    var labCi = (cfg.timeCol != null ? cfg.timeCol : cfg.catCol);
    var labels = P.body.map(function (r, i) {
      var v = labCi != null ? r[labCi] : "";
      var s = String(v == null ? "" : v).trim();
      return s !== "" ? s : "第" + (i + 1) + "行";
    });
    return { labels: labels, cols: cols };
  }

  /* —— SVG 框架：底 · 标题 · 副题 · 绘图区，再交具体渲染器往里画 —— */
  function chChartSvg(type, P, cfg) {
    var th = CH_THEMES[cfg.theme] || CH_THEMES.zhusha;
    var W = 960, H = 620;
    var m = { t: 30, r: 26, b: 46, l: 64 };
    var lg = cfg.legend || "top";
    var items = [];        // 渲染器填：{label, color, kind:"rect|line|dot"}
    var a = { W: W, H: H, th: th, cfg: cfg, m: m, items: items, notes: [], parts: [] };
    if (lg === "top") m.t += 30;
    if (cfg.sub) m.t += 20;
    var draw = CH_DRAW[type] || CH_DRAW.bar;
    draw(a, P);
    /* 图例：渲染器填完 items 再统一画（顶部一行放不下折两行；右侧竖排压缩绘图区） */
    if (items.length && lg !== "none") {
      if (lg === "right") {
        var rx = W - m.r + 6, ry = m.t + 8;
        var maxW = 0;
        items.forEach(function (it) {
          parts_push(a, chLegendItem(rx, ry, it, th));
          ry += 22; maxW = Math.max(maxW, 18 + chTextW(it.label, 12));
        });
        m.r += maxW + 14;
        a.needWiden = true;    // 右图例会占掉绘图区，重画一次收窄后的
      } else {
        var x = m.l, y = m.t - 22, line = 0;
        items.forEach(function (it) {
          var w = 18 + chTextW(it.label, 12) + 26;
          if (x + w > W - m.r && line < 2) { x = m.l; y += 20; line++; }
          parts_push(a, chLegendItem(x, y, it, th));
          x += w;
        });
      }
    }
    if (a.needWiden) {   // 右图例：把先画的主体裁剪问题交给二次渲染——重算一次
      a.parts = [];
      items.length = 0; a.notes.length = 0;
      a.m = m = { t: 30 + (lg === "top" ? 30 : 0) + (cfg.sub ? 20 : 0), r: 26, b: 46, l: 64 };
      if (lg === "right") m.r = 200;
      draw(a, P);
      if (items.length && lg === "right") {
        var ry2 = m.t + 8;
        items.forEach(function (it) {
          parts_push(a, chLegendItem(W - m.r + 8, ry2, it, th));
          ry2 += 22;
        });
      }
    }
    /* 骨架最后画背景与标题，让渲染器不用管它们（SVG 后画的在上层，这里先画骨架再垫底） */
    var head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H + '" ' +
      'font-family="\'Noto Serif SC\',\'Source Han Serif SC\',Songti,SimSun,serif" ' +
      'role="img" aria-label="' + chSvgEsc(cfg.title || "图表") + '">';
    var bg = '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#fdfcfa"/>';
    var tt = '<text x="' + m.l + '" y="34" font-size="19" font-weight="700" fill="' + th.ink + '">' +
      chSvgEsc(cfg.title || "图表") + "</text>";
    var st = cfg.sub ? '<text x="' + m.l + '" y="54" font-size="12.5" fill="#8b8071">' +
      chSvgEsc(chCut(cfg.sub, 64)) + "</text>" : "";
    var foot = a.notes.length ? '<text x="' + m.l + '" y="' + (H - 10) +
      '" font-size="11.5" fill="#a89f8f">' + chSvgEsc(chCut(a.notes.join("；"), 72)) + "</text>" : "";
    return head + bg + tt + st + a.parts.join("") + foot + "</svg>";
  }
  function parts_push(a) {
    for (var i = 1; i < arguments.length; i++) a.parts.push(arguments[i]);
  }
  function chLegendItem(x, y, it, th) {
    var g = "";
    if (it.kind === "line") g += '<line x1="' + x + '" y1="' + (y + 8) + '" x2="' + (x + 16) + '" y2="' + (y + 8) +
      '" stroke="' + it.color + '" stroke-width="2.5"/>';
    else if (it.kind === "dot") g += '<circle cx="' + (x + 8) + '" cy="' + (y + 8) + '" r="4.5" fill="' + it.color + '"/>';
    else g += '<rect x="' + x + '" y="' + y + '" width="15" height="15" rx="2" fill="' + it.color + '"/>';
    return g + '<text x="' + (x + 21) + '" y="' + (y + 12.5) + '" font-size="12" fill="#4d463a">' +
      chSvgEsc(chCut(it.label, 18)) + "</text>";
  }
  /* y 数值轴：网格线＋刻度，返回 y(v) 映射 */
  function chAxisY(a, lo, hi, fmt) {
    var t = chNiceTicks(lo, hi, 5), m = a.m, pw = a.W - m.l - m.r, ph = a.H - m.t - m.b;
    var y0 = a.H - m.b, th = a.th;
    t.ticks.forEach(function (v) {
      var y = y0 - (v - t.lo) / (t.hi - t.lo) * ph;
      parts_push(a, '<line x1="' + m.l + '" y1="' + y + '" x2="' + (m.l + pw) + '" y2="' + y +
        '" stroke="#e8ddc3" stroke-width="1"/>',
        '<text x="' + (m.l - 8) + '" y="' + (y + 4) + '" font-size="11.5" fill="#8b8071" text-anchor="end">' +
        chSvgEsc((fmt || chFmt)(v)) + "</text>");
    });
    parts_push(a, '<line x1="' + m.l + '" y1="' + (y0 - ph) + '" x2="' + m.l + '" y2="' + y0 +
      '" stroke="' + th.axis + '" stroke-width="1.2"/>');
    return function (v) { return y0 - (v - t.lo) / (t.hi - t.lo) * ph; };
  }
  /* 数值域：分组取每列 min/max；堆积取逐行正/负累计 */
  function chDomain(cols, stacked) {
    var lo = 0, hi = 0;
    if (stacked) {
      for (var r = 0; r < cols[0].vals.length; r++) {
        var p = 0, n2 = 0;
        cols.forEach(function (c) { var v = c.vals[r]; if (isFinite(v)) { if (v >= 0) p += v; else n2 += v; } });
        if (p > hi) hi = p; if (n2 < lo) lo = n2;
      }
    } else {
      cols.forEach(function (c) { c.vals.forEach(function (v) { if (isFinite(v)) { if (v > hi) hi = v; if (v < lo) lo = v; } }); });
    }
    var t = chNiceTicks(lo < 0 ? lo : 0, hi, 5);
    return t;
  }
  /* 类别 x 轴：返回中心 x(i) 与带宽；标签过密时旋转或抽稀 */
  function chAxisXCat(a, labels, rot) {
    var m = a.m, pw = a.W - m.l - m.r, y0 = a.H - m.b, n = labels.length;
    var bw = pw / Math.max(1, n);
    var every = Math.ceil(n / Math.floor(pw / 58));       // 抽稀：每 58px 至多一个标签
    labels.forEach(function (s, i) {
      if (i % every !== 0) return;
      var x = m.l + bw * (i + 0.5), t = chCut(s, rot ? 12 : 9);
      parts_push(a, '<text x="' + x + '" y="' + (y0 + 16) + '" font-size="11.5" fill="#6d6459" ' +
        (rot ? 'transform="rotate(-42 ' + x + " " + (y0 + 16) + ')" text-anchor="end"' : 'text-anchor="middle"') +
        ">" + chSvgEsc(t) + "</text>");
    });
    parts_push(a, '<line x1="' + m.l + '" y1="' + y0 + '" x2="' + (m.l + pw) + '" y2="' + y0 +
      '" stroke="' + a.th.axis + '" stroke-width="1.2"/>');
    return { bw: bw, cx: function (i) { return m.l + bw * (i + 0.5); } };
  }

  var CH_DRAW = {};

  /* 分组 / 堆积柱状图 */
  CH_DRAW.bar = function (a, P) {
    var M = a.M || chMatrix(P, a.cfg), stacked = !!a.cfg.stacked;
    var cols = M.cols, labels = M.labels, n = labels.length, m = a.m;
    if (!cols.length) { parts_push(a, chNoData(a)); return; }
    var cap = 36;
    if (n > cap) { labels = labels.slice(0, cap); cols = cols.map(function (c) { return { name: c.name, vals: c.vals.slice(0, cap) }; }); a.notes.push("数据 " + n + " 组，图内仅画前 " + cap + " 组"); n = cap; }
    var t = chDomain(cols, stacked), y = chAxisY(a, t.lo, t.hi, chFmt), X = chAxisXCat(a, labels, n > 14);
    var y0 = a.H - m.b, pw = a.W - m.l - m.r;
    if (stacked) {
      /* 堆积：逐行正负各记一条累计线，块贴着线画，画完推进线 */
      var runPos = labels.map(function () { return 0; }), runNeg = labels.map(function () { return 0; });
      cols.forEach(function (c, ci) {
        var col = a.th.series[ci % a.th.series.length];
        c.vals.forEach(function (v, i) {
          if (!isFinite(v) || v === 0) return;
          var bw2 = X.bw * 0.62, x = X.cx(i) - bw2 / 2, yv1, yv2;
          if (v >= 0) { yv1 = y(runPos[i]); runPos[i] += v; yv2 = y(runPos[i]); }
          else { yv2 = y(runNeg[i]); runNeg[i] += v; yv1 = y(runNeg[i]); }
          parts_push(a, '<rect x="' + x.toFixed(1) + '" y="' + Math.min(yv1, yv2).toFixed(1) +
            '" width="' + bw2.toFixed(1) + '" height="' + Math.max(1, Math.abs(yv2 - yv1)).toFixed(1) +
            '" fill="' + col + '" rx="1.5"><title>' + chSvgEsc(labels[i] + " · " + c.name + "：" + chFmt(v)) + "</title></rect>");
        });
      });
    } else {
      cols.forEach(function (c, ci) {
        var col = a.th.series[ci % a.th.series.length];
        c.vals.forEach(function (v, i) {
          if (!isFinite(v)) return;
          var bw2 = X.bw * 0.72 / cols.length;
          var x = X.cx(i) - X.bw * 0.36 + ci * bw2;
          var yv = y(v), yt = y(Math.max(v, 0));
          parts_push(a, '<rect x="' + x.toFixed(1) + '" y="' + Math.min(yt, yv).toFixed(1) +
            '" width="' + bw2.toFixed(1) + '" height="' + Math.max(1, Math.abs(y0 - yv)).toFixed(1) +
            '" fill="' + col + '" rx="1.5"><title>' + chSvgEsc(labels[i] + " · " + c.name + "：" + chFmt(v)) + "</title></rect>");
        });
      });
    }
    cols.forEach(function (c, ci) { a.items.push({ label: c.name, color: a.th.series[ci % a.th.series.length] }); });
  };

  /* 条形图（横向） */
  CH_DRAW.barH = function (a, P) {
    var M = a.M || chMatrix(P, a.cfg), cols = M.cols, labels = M.labels;
    if (!cols.length) { parts_push(a, chNoData(a)); return; }
    var c = cols[0], n = labels.length, m = a.m;
    if (cols.length > 1) a.notes.push("条形图一次画一列，取「" + c.name + "」；要多列并排请用分组柱状图");
    var idx = labels.map(function (_, i) { return i; });
    idx.sort(function (x, y2) { return (c.vals[y2] || 0) - (c.vals[x] || 0); });
    var cap = 28;
    if (n > cap) { idx = idx.slice(0, cap); a.notes.push("数据 " + n + " 行，仅画数值最大的 " + cap + " 行"); }
    var col = a.th.series[0];
    var max = 0; idx.forEach(function (i) { if (isFinite(c.vals[i]) && c.vals[i] > max) max = c.vals[i]; });
    var t = chNiceTicks(0, max, 4), x = chAxisXNumTop(a, t), rows = idx.length;
    var ph = a.H - m.t - m.b, rh = ph / rows;
    idx.forEach(function (i, k) {
      var v = c.vals[i]; if (!isFinite(v)) return;
      var yv = a.H - m.b - (k + 0.78) * rh, w = (v - t.lo) / (t.hi - t.lo) * (a.W - m.l - m.r);
      parts_push(a, '<rect x="' + m.l + '" y="' + yv.toFixed(1) + '" width="' + Math.max(1, w).toFixed(1) +
        '" height="' + (rh * 0.62).toFixed(1) + '" fill="' + col + '" rx="2"><title>' +
        chSvgEsc(labels[i] + "：" + chFmt(v)) + "</title></rect>",
        '<text x="' + (m.l + Math.max(1, w) + 6) + '" y="' + (yv + rh * 0.44).toFixed(1) +
        '" font-size="11.5" fill="#4d463a">' + chSvgEsc(chFmt(v)) + "</text>",
        '<text x="' + (m.l - 8) + '" y="' + (yv + rh * 0.44).toFixed(1) + '" font-size="11.5" fill="#6d6459" text-anchor="end">' +
        chSvgEsc(chCut(labels[i], 12)) + "</text>");
    });
    a.items.push({ label: c.name, color: col });
  };
  /* 条形图共用一条顶置数值轴 */
  function chAxisXNumTop(a, t) {
    var m = a.m, pw = a.W - m.l - m.r, y0 = a.H - m.b;
    t.ticks.forEach(function (v) {
      var x = m.l + (v - t.lo) / (t.hi - t.lo) * pw;
      parts_push(a, '<line x1="' + x + '" y1="' + (a.H - m.b - (a.H - m.t - m.b)) + '" x2="' + x + '" y2="' + y0 +
        '" stroke="#e8ddc3" stroke-width="1"/>',
        '<text x="' + x + '" y="' + (y0 + 16) + '" font-size="11.5" fill="#8b8071" text-anchor="middle">' + chSvgEsc(chFmt(v)) + "</text>");
    });
    return t;
  }

  /* 雷达图：行=维度，数值列=序列；统一量程（全局 max） */
  CH_DRAW.radar = function (a, P) {
    var M = a.M || chMatrix(P, a.cfg), cols = M.cols, labels = M.labels, m = a.m;
    if (cols.length < 1 || labels.length < 3) { parts_push(a, chNoData(a, "雷达图至少要 3 行数据")); return; }
    var n = Math.min(labels.length, 12);
    if (labels.length > 12) a.notes.push("维度过多，取前 12 行");
    var cx = m.l + (a.W - m.l - m.r) / 2, cy = m.t + (a.H - m.t - m.b) / 2,
      R = Math.min(a.W - m.l - m.r, a.H - m.t - m.b) / 2 - 34;
    var gmax = 0;
    cols.forEach(function (c) { for (var i = 0; i < n; i++) { var v = c.vals[i]; if (isFinite(v) && v > gmax) gmax = v; } });
    if (gmax <= 0) gmax = 1;
    var pt = function (i, r) {
      var ang = -Math.PI / 2 + i * 2 * Math.PI / n;
      return [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r];
    };
    for (var ring = 1; ring <= 4; ring++) {
      var ps = [];
      for (var i = 0; i < n; i++) { var p = pt(i, R * ring / 4); ps.push(p[0].toFixed(1) + "," + p[1].toFixed(1)); }
      parts_push(a, '<polygon points="' + ps.join(" ") + '" fill="none" stroke="#e8ddc3" stroke-width="1"/>');
    }
    for (var i = 0; i < n; i++) {
      var p2 = pt(i, R);
      parts_push(a, '<line x1="' + cx + '" y1="' + cy + '" x2="' + p2[0].toFixed(1) + '" y2="' + p2[1].toFixed(1) + '" stroke="#e8ddc3" stroke-width="1"/>');
      var pl = pt(i, R + 18), anchor = Math.abs(pl[0] - cx) < 10 ? "middle" : (pl[0] > cx ? "start" : "end");
      parts_push(a, '<text x="' + pl[0].toFixed(1) + '" y="' + (pl[1] + 4).toFixed(1) + '" font-size="12" fill="#4d463a" text-anchor="' + anchor + '">' +
        chSvgEsc(chCut(labels[i], 8)) + "</text>");
    }
    parts_push(a, '<text x="' + (cx + 6) + '" y="' + (cy - R - 6) + '" font-size="11" fill="#8b8071">' + chSvgEsc(chFmt(gmax)) + "</text>");
    cols.forEach(function (c, ci) {
      var col = a.th.series[ci % a.th.series.length], ps2 = [];
      for (var j = 0; j < n; j++) {
        var v = c.vals[j], r = isFinite(v) ? Math.max(0, v) / gmax * R : 0;
        var p3 = pt(j, r); ps2.push(p3[0].toFixed(1) + "," + p3[1].toFixed(1));
        parts_push(a, '<circle cx="' + p3[0].toFixed(1) + '" cy="' + p3[1].toFixed(1) + '" r="3" fill="' + col + '"><title>' +
          chSvgEsc(labels[j] + "：" + chFmt(v)) + "</title></circle>");
      }
      parts_push(a, '<polygon points="' + ps2.join(" ") + '" fill="' + col + '" fill-opacity="0.14" stroke="' + col + '" stroke-width="2"/>');
      a.items.push({ label: c.name, color: col, kind: "line" });
    });
  };

  function chNoData(a, msg) {
    return '<text x="' + (a.W / 2) + '" y="' + (a.H / 2) + '" font-size="15" fill="#8b8071" text-anchor="middle">' +
      chSvgEsc(msg || "按当前列映射画不出这张图——请回上方调整「类别列 / 数值列」") + "</text>";
  }

  /* 折线 / 面积 / 堆积面积共用骨架 */
  function chLineBase(a, P, mode) {
    var M = a.M || chMatrix(P, a.cfg), cols = M.cols, labels = M.labels, m = a.m;
    if (!cols.length) { parts_push(a, chNoData(a)); return; }
    var n = labels.length;
    var src = cols;
    if (mode === "stack") {
      var acc = labels.map(function () { return 0; }), run = labels.map(function () { return 0; });
      src = cols.map(function (c) {
        return { name: c.name, vals: c.vals.map(function (v, i) { run[i] += isFinite(v) ? v : 0; return run[i]; }) };
      });
    }
    var t = chDomain(src, false), y = chAxisY(a, t.lo, t.hi, chFmt), X = chAxisXCat(a, labels, n > 12);
    var y0 = a.H - m.b;
    src.forEach(function (c, ci) {
      var col = a.th.series[ci % a.th.series.length], pts = [];
      c.vals.forEach(function (v, i) { if (isFinite(v)) pts.push([X.cx(i), y(v), v, i]); });
      if (!pts.length) return;
      var d = pts.map(function (p, k) { return (k ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
      if (mode) {
        var area = d + " L" + pts[pts.length - 1][0].toFixed(1) + " " + y0 + " L" + pts[0][0].toFixed(1) + " " + y0 + " Z";
        parts_push(a, '<path d="' + area + '" fill="' + col + '" fill-opacity="0.18"/>');
      }
      parts_push(a, '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2.4" stroke-linejoin="round"/>');
      if (n <= 80) pts.forEach(function (p) {
        parts_push(a, '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.2" fill="' + col + '"><title>' +
          chSvgEsc(labels[p[3]] + " · " + c.name + "：" + chFmt(p[2])) + "</title></circle>");
      });
      a.items.push({ label: c.name, color: col, kind: "line" });
    });
    if (mode === "stack") a.notes.push("堆积面积自下而上逐列累加，读某条线的高度即该列的累计值");
  }
  CH_DRAW.line = function (a, P) { chLineBase(a, P, false); };
  CH_DRAW.area = function (a, P) { chLineBase(a, P, "area"); };
  CH_DRAW.areaStack = function (a, P) { chLineBase(a, P, "stack"); };

  /* 瀑布图：分类 + 单数值列；行名含 合计/总计/期末/利润 等则画成总柱 */
  CH_DRAW.waterfall = function (a, P) {
    var M = a.M || chMatrix(P, a.cfg), cols = M.cols, labels = M.labels, m = a.m;
    if (!cols.length) { parts_push(a, chNoData(a)); return; }
    var c = cols[0], n = labels.length;
    if (cols.length > 1) a.notes.push("瀑布图一次画一列，取「" + c.name + "」");
    var TOTAL_RE = /合计|总计|期末|净额|净利润|利润|毛利|结余|总/;
    var run = 0, t0 = 0, bars = [];
    labels.forEach(function (s, i) {
      var v = c.vals[i]; if (!isFinite(v)) return;
      if (TOTAL_RE.test(s)) { bars.push({ s: s, from: Math.min(0, run), to: run, total: true }); }
      else { bars.push({ s: s, from: run, to: run + v }); run += v; }
    });
    labels.forEach(function (_, i) { if (isFinite(c.vals[i]) && !TOTAL_RE.test(labels[i])) { if (c.vals[i] < t0) t0 = c.vals[i]; } });
    var lo = Math.min(0, run, t0), hi = Math.max(run, 0);
    bars.forEach(function (b) { if (!b.total && b.to > hi) hi = b.to; });
    var t = chNiceTicks(Math.min(0, lo), hi, 5), y = chAxisY(a, t.lo, t.hi, chFmt), X = chAxisXCat(a, bars.map(function (b) { return b.s; }), n > 10);
    var y0 = a.H - m.b;
    bars.forEach(function (b, i) {
      var col = b.total ? "#c98a2b" : (b.to >= b.from ? a.th.series[0] : "#5a7a6e");
      var y1 = y(b.from), y2 = y(b.to);
      parts_push(a, '<rect x="' + (X.cx(i) - X.bw * 0.3).toFixed(1) + '" y="' + Math.min(y1, y2).toFixed(1) +
        '" width="' + (X.bw * 0.6).toFixed(1) + '" height="' + Math.max(1.5, Math.abs(y1 - y2)).toFixed(1) +
        '" fill="' + col + '" rx="1.5"><title>' + chSvgEsc(b.s + "：" + chFmt(b.to - b.from) + (b.total ? "（合计）" : "")) + "</title></rect>");
      if (i < bars.length - 1) {
        var ly = y(b.to);
        parts_push(a, '<line x1="' + (X.cx(i) + X.bw * 0.3).toFixed(1) + '" y1="' + ly.toFixed(1) +
          '" x2="' + (X.cx(i + 1) - X.bw * 0.3).toFixed(1) + '" y2="' + ly.toFixed(1) + '" stroke="#a89f8f" stroke-width="1" stroke-dasharray="3 3"/>');
      }
    });
    a.items.push({ label: "增项", color: a.th.series[0] }, { label: "减项", color: "#5a7a6e" }, { label: "合计", color: "#c98a2b" });
  };

  /* 饼 / 环形：分类 + 单数值列；超过 12 类合并「其他」 */
  CH_DRAW.pie = function (a, P) {
    var donut = a.cfg.donut;
    var M = a.M || chMatrix(P, a.cfg), cols = M.cols, labels = M.labels, m = a.m;
    if (!cols.length) { parts_push(a, chNoData(a)); return; }
    var c = cols[0];
    if (cols.length > 1) a.notes.push("饼图一次画一列，取「" + c.name + "」");
    var rows = labels.map(function (s, i) { return { s: s, v: isFinite(c.vals[i]) ? c.vals[i] : 0 }; })
      .filter(function (r) { return r.v > 0; }).sort(function (x, y2) { return y2.v - x.v; });
    if (rows.length > 12) {
      var rest = rows.slice(11).reduce(function (s2, r) { return s2 + r.v; }, 0);
      rows = rows.slice(0, 11);
      rows.push({ s: "其他（" + (labels.length - 11) + " 项）", v: rest });
      a.notes.push("类别超过 12 个，已把其余合并为「其他」；要逐项细看建议改条形图");
    }
    var sum = rows.reduce(function (s2, r) { return s2 + r.v; }, 0) || 1;
    var cx = m.l + (a.W - m.l - m.r) / 2 - (a.cfg.legend === "right" ? -40 : 0), cy = m.t + (a.H - m.t - m.b) / 2 + 8,
      R = Math.min(a.W - m.l - m.r, a.H - m.t - m.b) / 2 - 40, r0 = donut ? R * 0.58 : 0;
    var ang = -Math.PI / 2;
    rows.forEach(function (r, i) {
      var col = a.th.series[i % a.th.series.length], a2 = ang + r.v / sum * 2 * Math.PI;
      var large = a2 - ang > Math.PI ? 1 : 0,
        p1x = cx + Math.cos(ang) * R, p1y = cy + Math.sin(ang) * R,
        p2x = cx + Math.cos(a2) * R, p2y = cy + Math.sin(a2) * R,
        i1x = cx + Math.cos(a2) * r0, i1y = cy + Math.sin(a2) * r0,
        i2x = cx + Math.cos(ang) * r0, i2y = cy + Math.sin(ang) * r0;
      var d = r0 ?
        "M" + p1x.toFixed(1) + " " + p1y.toFixed(1) + " A" + R + " " + R + " 0 " + large + " 1 " + p2x.toFixed(1) + " " + p2y.toFixed(1) +
        " L" + i1x.toFixed(1) + " " + i1y.toFixed(1) + " A" + r0 + " " + r0 + " 0 " + large + " 0 " + i2x.toFixed(1) + " " + i2y.toFixed(1) + " Z" :
        "M" + cx + " " + cy + " L" + p1x.toFixed(1) + " " + p1y.toFixed(1) + " A" + R + " " + R + " 0 " + large + " 1 " + p2x.toFixed(1) + " " + p2y.toFixed(1) + " Z";
      parts_push(a, '<path d="' + d + '" fill="' + col + '" stroke="#fdfcfa" stroke-width="1.5"><title>' +
        chSvgEsc(r.s + "：" + chFmt(r.v) + "（" + (r.v / sum * 100).toFixed(1) + "%）") + "</title></path>");
      if (r.v / sum > 0.04) {
        var mid = (ang + a2) / 2, lr = R * (r0 ? (R + r0) / 2 / R : 0.66),
          lx = cx + Math.cos(mid) * lr, ly = cy + Math.sin(mid) * lr;
        parts_push(a, '<text x="' + lx.toFixed(1) + '" y="' + (ly + 4).toFixed(1) + '" font-size="12" fill="#fdfcfa" font-weight="700" text-anchor="middle">' +
          chSvgEsc((r.v / sum * 100).toFixed(1) + "%") + "</text>");
      }
      a.items.push({ label: r.s + " " + (r.v / sum * 100).toFixed(1) + "%", color: col });
      ang = a2;
    });
    if (donut) {
      parts_push(a, '<text x="' + cx + '" y="' + (cy - 2) + '" font-size="12" fill="#8b8071" text-anchor="middle">合计</text>',
        '<text x="' + cx + '" y="' + (cy + 18) + '" font-size="17" font-weight="700" fill="' + a.th.ink + '" text-anchor="middle">' + chSvgEsc(chFmt(sum)) + "</text>");
    }
  };
  CH_DRAW.donut = function (a, P) { CH_DRAW.pie(a, P); };

  /* 树状图（squarify）：单层 = 类别+数值；两层 = 两个类别列+数值 */
  function chSquarify(items, x, y, w, h, out) {
    if (!items.length) return;
    if (items.length === 1) { out.push({ it: items[0], x: x, y: y, w: w, h: h }); return; }
    var total = 0; items.forEach(function (r) { total += r.v; });
    if (total <= 0) { out.push({ it: items[0], x: x, y: y, w: w, h: h }); return; }
    var sum = 0, worst = Infinity, cut = 1;
    for (var i = 0; i < items.length; i++) {
      sum += items[i].v;
      /* 试算把 items[0..i] 排成一行/列后的最大长宽比；一旦变差就截在这一行的前一段 */
      var thick = w > h ? (sum / total) * w : (sum / total) * h;
      var mx = 0;
      for (var j = 0; j <= i; j++) {
        var area = items[j].v / total * (w * h), l2 = area / Math.max(thick, 1e-9);
        var ratio = Math.max(l2 / Math.max(thick, 1e-9), thick / Math.max(l2, 1e-9));
        if (ratio > mx) mx = ratio;
      }
      if (mx > worst && i > 0) { cut = i; break; }
      worst = mx; cut = i + 1;
    }
    var row = items.slice(0, cut), rsum = 0; row.forEach(function (r) { rsum += r.v; });
    var frac = rsum / total;
    if (w > h) {
      var rw = w * frac, yy = y;
      row.forEach(function (r) { var hh = h * (r.v / rsum); out.push({ it: r, x: x, y: yy, w: rw, h: hh }); yy += hh; });
      chSquarify(items.slice(cut), x + rw, y, w - rw, h, out);
    } else {
      var rh2 = h * frac, xx = x;
      row.forEach(function (r) { var ww = w * (r.v / rsum); out.push({ it: r, x: xx, y: y, w: ww, h: rh2 }); xx += ww; });
      chSquarify(items.slice(cut), x, y + rh2, w, h - rh2, out);
    }
  }
  CH_DRAW.treemap = function (a, P) {
    var M = a.M || chMatrix(P, a.cfg), cols = M.cols, labels = M.labels, m = a.m;
    if (!cols.length) { parts_push(a, chNoData(a)); return; }
    var c = cols[0];
    var X = a.W - m.l - m.r, Y = a.H - m.t - m.b;
    var cat2 = (a.cfg.cat2Col != null && a.cfg.cat2Col !== a.cfg.catCol) ? a.cfg.cat2Col : null;
    var groups = {};
    if (cat2 != null) {
      labels.forEach(function (_, i) {
        var g = String(P.body[i][cat2] == null ? "—" : P.body[i][cat2]).trim() || "—";
        (groups[g] = groups[g] || []).push({ s: labels[i], v: isFinite(c.vals[i]) ? Math.max(0, c.vals[i]) : 0, i: i });
      });
      var gItems = Object.keys(groups).map(function (g) {
        return { s: g, v: groups[g].reduce(function (s2, r) { return s2 + r.v; }, 0), kids: groups[g] };
      }).sort(function (x, y2) { return y2.v - x.v; });
      var rects = []; chSquarify(gItems, m.l, m.t, X, Y, rects);
      rects.forEach(function (rc, gi) {
        var col = a.th.series[gi % a.th.series.length];
        parts_push(a, '<rect x="' + rc.x.toFixed(1) + '" y="' + rc.y.toFixed(1) + '" width="' + rc.w.toFixed(1) + '" height="' + rc.h.toFixed(1) +
          '" fill="' + col + '" fill-opacity="0.16" stroke="' + col + '" stroke-width="2"/>');
        if (rc.w > 46 && rc.h > 22) parts_push(a, '<text x="' + (rc.x + 8) + '" y="' + (rc.y + 18) + '" font-size="13" font-weight="700" fill="' + col + '">' +
          chSvgEsc(chCut(rc.it.s, Math.max(2, Math.floor(rc.w / 14)))) + "</text>");
        /* 内层 */
        var inner = []; chSquarify(rc.it.kids, rc.x + 2, rc.y + (rc.w > 46 && rc.h > 22 ? 22 : 2), rc.w - 4, rc.h - (rc.w > 46 && rc.h > 22 ? 24 : 4), inner);
        inner.forEach(function (ic) {
          if (ic.w < 8 || ic.h < 8 || ic.it.v <= 0) return;
          var depth = 0.55 + 0.45 * Math.min(1, ic.it.v / Math.max(1, rc.it.v));
          parts_push(a, '<rect x="' + ic.x.toFixed(1) + '" y="' + ic.y.toFixed(1) + '" width="' + ic.w.toFixed(1) + '" height="' + ic.h.toFixed(1) +
            '" fill="' + chHexLerp("#fdfcfa", col, depth) + '" stroke="#fdfcfa" stroke-width="1"><title>' +
            chSvgEsc(rc.it.s + " / " + ic.it.s + "：" + chFmt(ic.it.v)) + "</title></rect>");
          if (ic.w > 40 && ic.h > 16) parts_push(a, '<text x="' + (ic.x + 4) + '" y="' + (ic.y + 13) + '" font-size="10.5" fill="#221f1a">' +
            chSvgEsc(chCut(ic.it.s, Math.floor(ic.w / 11))) + "</text>");
        });
        a.items.push({ label: rc.it.s, color: col });
      });
      a.notes.push("外层按「" + (P.cols[cat2] ? P.cols[cat2].name : "") + "」分组，内层是各明细行");
    } else {
      var items = labels.map(function (s, i) { return { s: s, v: Math.max(0, isFinite(c.vals[i]) ? c.vals[i] : 0), i: i }; })
        .sort(function (x, y2) { return y2.v - x.v; });
      var rects2 = []; chSquarify(items, m.l, m.t, X, Y, rects2);
      rects2.forEach(function (rc, i) {
        var col = a.th.series[i % a.th.series.length];
        if (rc.w < 4 || rc.h < 4) return;
        parts_push(a, '<rect x="' + rc.x.toFixed(1) + '" y="' + rc.y.toFixed(1) + '" width="' + rc.w.toFixed(1) + '" height="' + rc.h.toFixed(1) +
          '" fill="' + col + '" fill-opacity="0.88" stroke="#fdfcfa" stroke-width="1.5"><title>' +
          chSvgEsc(rc.it.s + "：" + chFmt(rc.it.v)) + "</title></rect>");
        if (rc.w > 44 && rc.h > 30) {
          parts_push(a, '<text x="' + (rc.x + 6) + '" y="' + (rc.y + 17) + '" font-size="12" fill="#fdfcfa" font-weight="700">' +
            chSvgEsc(chCut(rc.it.s, Math.floor(rc.w / 12.5))) + "</text>");
          if (rc.h > 46) parts_push(a, '<text x="' + (rc.x + 6) + '" y="' + (rc.y + 33) + '" font-size="11" fill="#fdfcfa" fill-opacity="0.85">' +
            chSvgEsc(chFmt(rc.it.v)) + "</text>");
        }
      });
    }
  };

  /* 散点 / 气泡：两列数值 xy（+第三列大小）；线性趋势线 */
  CH_DRAW.scatter = function (a, P) {
    var bubble = !!a.bubble;
    var M = a.M || chMatrix(P, a.cfg), cols = M.cols, m = a.m;
    if (cols.length < 2) { parts_push(a, chNoData(a, "散点图需要两列数值：一列作 x，一列作 y")); return; }
    var pts = [];
    var nRaw = cols[0].vals.length;
    for (var i = 0; i < nRaw; i++) {
      var vx = cols[0].vals[i], vy = cols[1].vals[i], vs = cols[2] ? cols[2].vals[i] : NaN;
      if (isFinite(vx) && isFinite(vy)) pts.push({ x: vx, y: vy, s: isFinite(vs) ? vs : NaN, i: i });
    }
    var sampled = false;
    if (pts.length > 1500) { pts = pts.filter(function (_, k) { return k % Math.ceil(pts.length / 1500) === 0; }); sampled = true; }
    var xs = chNiceTicks(Math.min.apply(null, pts.map(function (p) { return p.x; })),
      Math.max.apply(null, pts.map(function (p) { return p.x; })), 6);
    var ys = chNiceTicks(Math.min.apply(null, pts.map(function (p) { return p.y; })),
      Math.max.apply(null, pts.map(function (p) { return p.y; })), 5);
    var pw = a.W - m.l - m.r, ph = a.H - m.t - m.b, y0 = a.H - m.b;
    xs.ticks.forEach(function (v) {
      var x = m.l + (v - xs.lo) / (xs.hi - xs.lo) * pw;
      parts_push(a, '<line x1="' + x + '" y1="' + (y0 - ph) + '" x2="' + x + '" y2="' + y0 + '" stroke="#e8ddc3" stroke-width="1"/>',
        '<text x="' + x + '" y="' + (y0 + 16) + '" font-size="11.5" fill="#8b8071" text-anchor="middle">' + chSvgEsc(chFmt(v)) + "</text>");
    });
    ys.ticks.forEach(function (v) {
      var y = y0 - (v - ys.lo) / (ys.hi - ys.lo) * ph;
      parts_push(a, '<line x1="' + m.l + '" y1="' + y + '" x2="' + (m.l + pw) + '" y2="' + y + '" stroke="#e8ddc3" stroke-width="1"/>',
        '<text x="' + m.l - 8 + '" y="' + (y + 4) + '" font-size="11.5" fill="#8b8071" text-anchor="end">' + chSvgEsc(chFmt(v)) + "</text>");
    });
    parts_push(a, '<line x1="' + m.l + '" y1="' + (y0 - ph) + '" x2="' + m.l + '" y2="' + y0 + '" stroke="' + a.th.axis + '" stroke-width="1.2"/>',
      '<line x1="' + m.l + '" y1="' + y0 + '" x2="' + (m.l + pw) + '" y2="' + y0 + '" stroke="' + a.th.axis + '" stroke-width="1.2"/>',
      '<text x="' + (m.l + pw / 2) + '" y="' + (y0 + 32) + '" font-size="12.5" fill="#4d463a" text-anchor="middle">' + chSvgEsc(cols[0].name) + "</text>",
      '<text x="' + (m.l - 40) + '" y="' + (m.t + ph / 2) + '" font-size="12.5" fill="#4d463a" text-anchor="middle" transform="rotate(-90 ' + (m.l - 40) + " " + (m.t + ph / 2) + ')">' + chSvgEsc(cols[1].name) + "</text>");
    var smax = 0; pts.forEach(function (p) { if (isFinite(p.s) && p.s > smax) smax = p.s; });
    var col = a.th.series[0];
    pts.forEach(function (p) {
      var x = m.l + (p.x - xs.lo) / (xs.hi - xs.lo) * pw, y = y0 - (p.y - ys.lo) / (ys.hi - ys.lo) * ph;
      var r = bubble && smax > 0 && isFinite(p.s) ? 3 + Math.sqrt(p.s / smax) * 14 : 3.6;
      parts_push(a, '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + r.toFixed(1) +
        '" fill="' + col + '" fill-opacity="0.5" stroke="' + col + '"><title>' +
        chSvgEsc((M.labels[p.i] || "点") + "：" + cols[0].name + "=" + chFmt(p.x) + "，" + cols[1].name + "=" + chFmt(p.y) +
          (bubble && isFinite(p.s) ? "，" + cols[2].name + "=" + chFmt(p.s) : "")) + "</title></circle>");
    });
    /* 最小二乘趋势线 */
    if (pts.length > 2) {
      var sx = 0, sy = 0, sxy = 0, sxx = 0;
      pts.forEach(function (p) { sx += p.x; sy += p.y; sxy += p.x * p.y; sxx += p.x * p.x; });
      var nn = pts.length, b = (nn * sxy - sx * sy) / Math.max(1e-12, nn * sxx - sx * sx),
        aa = (sy - b * sx) / nn;
      if (isFinite(b)) {
        var x1 = xs.lo, x2 = xs.hi,
          f = function (v) { return y0 - (aa + b * v - ys.lo) / (ys.hi - ys.lo) * ph; };
        parts_push(a, '<line x1="' + (m.l + (x1 - xs.lo) / (xs.hi - xs.lo) * pw).toFixed(1) + '" y1="' + f(x1).toFixed(1) +
          '" x2="' + (m.l + (x2 - xs.lo) / (xs.hi - xs.lo) * pw).toFixed(1) + '" y2="' + f(x2).toFixed(1) +
          '" stroke="' + a.th.series[1] + '" stroke-width="1.8" stroke-dasharray="7 5" stroke-opacity="0.85"/>');
        a.items.push({ label: cols[0].name + " → " + cols[1].name, color: col, kind: "dot" },
          { label: "线性趋势", color: a.th.series[1], kind: "line" });
      }
    } else a.items.push({ label: cols[0].name + " × " + cols[1].name, color: col, kind: "dot" });
    if (sampled) a.notes.push("点数过多，已按等间隔抽样至 1500 点");
    if (bubble && cols.length > 2) a.notes.push("气泡面积对应「" + cols[2].name + "」");
  };
  CH_DRAW.bubble = function (a, P) { a.bubble = true; CH_DRAW.scatter(a, P); };

  /* 热力图：行标签 + 全数值列矩阵 */
  CH_DRAW.heatmap = function (a, P) {
    var M = a.M || chMatrix(P, a.cfg), cols = M.cols, labels = M.labels, m = a.m;
    if (cols.length < 2) { parts_push(a, chNoData(a, "热力图需要两列以上数值列")); return; }
    var nR = Math.min(labels.length, 40);
    if (labels.length > 40) a.notes.push("行数过多，取前 40 行");
    var vals = [];
    for (var i = 0; i < nR; i++) for (var j = 0; j < cols.length; j++) { var v = cols[j].vals[i]; if (isFinite(v)) vals.push(v); }
    var vmin = Math.min.apply(null, vals), vmax = Math.max.apply(null, vals);
    var pw = a.W - m.l - m.r, ph = a.H - m.t - m.b,
      cw = pw / cols.length, rh = ph / nR;
    var lo2 = chNiceTicks(0, vmax, 4);
    for (var r = 0; r < nR; r++) {
      for (var j = 0; j < cols.length; j++) {
        var v2 = cols[j].vals[r];
        var tt2 = isFinite(v2) && vmax > vmin ? (v2 - vmin) / (vmax - vmin) : 0;
        parts_push(a, '<rect x="' + (m.l + j * cw).toFixed(1) + '" y="' + (m.t + r * rh).toFixed(1) +
          '" width="' + (cw - 1.5).toFixed(1) + '" height="' + (rh - 1.5).toFixed(1) +
          '" fill="' + chHexLerp("#f5eede", a.th.ink, 0.08 + tt2 * 0.92) + '"><title>' +
          chSvgEsc(labels[r] + " · " + cols[j].name + "：" + (isFinite(v2) ? chFmt(v2) : "空")) + "</title></rect>");
        if (cw > 54 && rh > 20) parts_push(a, '<text x="' + (m.l + j * cw + cw / 2 - 1) + '" y="' + (m.t + r * rh + rh / 2 + 4) +
          '" font-size="10.5" text-anchor="middle" fill="' + (tt2 > 0.55 ? "#fdfcfa" : "#4d463a") + '">' + chSvgEsc(chFmt(v2)) + "</text>");
      }
      parts_push(a, '<text x="' + (m.l - 8) + '" y="' + (m.t + r * rh + rh / 2 + 4) + '" font-size="11.5" fill="#6d6459" text-anchor="end">' +
        chSvgEsc(chCut(labels[r], 10)) + "</text>");
    }
    cols.forEach(function (c, j) {
      parts_push(a, '<text x="' + (m.l + j * cw + cw / 2 - 1) + '" y="' + (m.t - 8) + '" font-size="11.5" fill="#4d463a" text-anchor="middle">' +
        chSvgEsc(chCut(c.name, Math.max(4, Math.floor(cw / 12)))) + "</text>");
    });
    /* 色条图例 */
    var gx = m.l, gy = m.t + nR * rh + 18;
    for (var k = 0; k < 40; k++) {
      parts_push(a, '<rect x="' + (gx + k * 9) + '" y="' + gy + '" width="9" height="10" fill="' +
        chHexLerp("#f5eede", a.th.ink, 0.08 + k / 39 * 0.92) + '"/>');
    }
    parts_push(a, '<text x="' + (gx + 370) + '" y="' + (gy + 9) + '" font-size="11.5" fill="#8b8071">' +
      chSvgEsc(chFmt(vmin) + " → " + chFmt(vmax)) + "</text>");
  };

  /* 直方图：单数值列分箱 */
  CH_DRAW.hist = function (a, P) {
    var M = a.M || chMatrix(P, a.cfg), cols = M.cols, m = a.m;
    if (!cols.length) { parts_push(a, chNoData(a, "直方图需要一列数值")); return; }
    var vals = [];
    cols[0].vals.forEach(function (v) { if (isFinite(v)) vals.push(v); });
    if (!vals.length) { parts_push(a, chNoData(a)); return; }
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var nb = Math.max(8, Math.min(24, Math.round(Math.sqrt(vals.length))));
    var t = chNiceTicks(lo, hi, nb), step = t.step, bins = [];
    for (var v = t.lo; v < t.hi - 1e-9; v += step) bins.push({ x0: v, x1: v + step, n: 0 });
    vals.forEach(function (x) {
      var k = Math.floor((x - t.lo) / step);
      if (k >= 0 && k < bins.length) bins[k].n++;
      else if (x === t.hi && bins.length) bins[bins.length - 1].n++;
    });
    var max = 0; bins.forEach(function (b) { if (b.n > max) max = b.n; });
    var yt = chNiceTicks(0, max, 5), y = chAxisY(a, 0, yt.hi, function (v) { return String(Math.round(v)); });
    var y0 = a.H - m.b, pw = a.W - m.l - m.r, bw = pw / bins.length;
    bins.forEach(function (b, i) {
      if (!b.n) return;
      var yv = y(b.n);
      parts_push(a, '<rect x="' + (m.l + i * bw + 1).toFixed(1) + '" y="' + yv.toFixed(1) + '" width="' + Math.max(1, bw - 2).toFixed(1) +
        '" height="' + Math.max(1, y0 - yv).toFixed(1) + '" fill="' + a.th.series[0] + '" fill-opacity="0.85"><title>' +
        chSvgEsc("[" + chFmt(b.x0) + ", " + chFmt(b.x1) + ")：" + b.n + " 个") + "</title></rect>");
    });
    bins.forEach(function (b, i) {
      if (i % Math.ceil(bins.length / 12) !== 0) return;
      parts_push(a, '<text x="' + (m.l + i * bw) + '" y="' + (y0 + 16) + '" font-size="11" fill="#8b8071" text-anchor="middle">' + chSvgEsc(chFmt(b.x0)) + "</text>");
    });
    parts_push(a, '<text x="' + (m.l + pw / 2) + '" y="' + (y0 + 32) + '" font-size="12.5" fill="#4d463a" text-anchor="middle">' +
      chSvgEsc(cols[0].name) + "</text>",
      '<line x1="' + m.l + '" y1="' + y0 + '" x2="' + (m.l + pw) + '" y2="' + y0 + '" stroke="' + a.th.axis + '" stroke-width="1.2"/>');
    a.items.push({ label: "频次（组距 " + chFmt(step) + "）", color: a.th.series[0] });
  };

  /* 箱线图：多数值列各一箱；或类别列+单数值列按组分箱 */
  CH_DRAW.box = function (a, P) {
    var M = a.M || chMatrix(P, a.cfg), cols = M.cols, labels = M.labels, m = a.m;
    var groups = [];
    if (a.cfg.catCol != null && cols.length === 1) {
      var byc = {};
      labels.forEach(function (s, i) {
        var k = s;
        (byc[k] = byc[k] || []).push(cols[0].vals[i]);
      });
      Object.keys(byc).forEach(function (k) { groups.push({ name: k, vals: byc[k].filter(isFinite) }); });
    } else {
      cols.forEach(function (c) { groups.push({ name: c.name, vals: c.vals.filter(isFinite) }); });
    }
    groups = groups.filter(function (g) { return g.vals.length >= 4; });
    if (!groups.length) { parts_push(a, chNoData(a, "箱线图每组至少要 4 个数值")); return; }
    var all = [];
    groups.forEach(function (g) { g.vals.forEach(function (v) { all.push(v); }); });
    var t = chNiceTicks(Math.min.apply(null, all), Math.max.apply(null, all), 5);
    var y = chAxisY(a, t.lo, t.hi, chFmt), X = chAxisXCat(a, groups.map(function (g) { return g.name; }), groups.length > 8);
    var y0 = a.H - m.b, pw = a.W - m.l - m.r;
    function quartile(sorted, q) {
      var pos = (sorted.length - 1) * q, base = Math.floor(pos), rest = pos - base;
      return sorted[base] + (sorted[base + 1] !== undefined ? rest * (sorted[base + 1] - sorted[base]) : 0);
    }
    groups.forEach(function (g, i) {
      var sv = g.vals.slice().sort(function (x, y2) { return x - y2; });
      var q1 = quartile(sv, 0.25), q2 = quartile(sv, 0.5), q3 = quartile(sv, 0.75),
        iqr = q3 - q1, flo = q1 - 1.5 * iqr, fhi = q3 + 1.5 * iqr;
      var wLo = q1, wHi = q3;
      for (var k = 0; k < sv.length; k++) { if (sv[k] >= flo) { wLo = sv[k]; break; } }
      for (var k2 = sv.length - 1; k2 >= 0; k2--) { if (sv[k2] <= fhi) { wHi = sv[k2]; break; } }
      var col = a.th.series[i % a.th.series.length], cx = X.cx(i), bw = Math.min(X.bw * 0.5, pw / groups.length * 0.5);
      parts_push(a, '<line x1="' + cx + '" y1="' + y(wLo) + '" x2="' + cx + '" y2="' + y(q1) + '" stroke="' + col + '" stroke-width="1.5"/>',
        '<line x1="' + cx + '" y1="' + y(q3) + '" x2="' + cx + '" y2="' + y(wHi) + '" stroke="' + col + '" stroke-width="1.5"/>',
        '<line x1="' + (cx - bw / 3) + '" y1="' + y(wLo) + '" x2="' + (cx + bw / 3) + '" y2="' + y(wLo) + '" stroke="' + col + '" stroke-width="1.5"/>',
        '<line x1="' + (cx - bw / 3) + '" y1="' + y(wHi) + '" x2="' + (cx + bw / 3) + '" y2="' + y(wHi) + '" stroke="' + col + '" stroke-width="1.5"/>',
        '<rect x="' + (cx - bw / 2) + '" y="' + y(q3) + '" width="' + bw + '" height="' + Math.max(2, y(q1) - y(q3)) +
        '" fill="' + col + '" fill-opacity="0.25" stroke="' + col + '" stroke-width="1.6"/>',
        '<line x1="' + (cx - bw / 2) + '" y1="' + y(q2) + '" x2="' + (cx + bw / 2) + '" y2="' + y(q2) + '" stroke="' + col + '" stroke-width="2.4"/>');
      sv.forEach(function (v) {
        if (v < flo || v > fhi) parts_push(a, '<circle cx="' + cx + '" cy="' + y(v) + '" r="2.6" fill="none" stroke="' + col + '" stroke-width="1.3"><title>' +
          chSvgEsc("离群值 " + chFmt(v)) + "</title></circle>");
      });
      parts_push(a, '<rect x="' + (cx - bw / 2) + '" y="' + (y0 - (a.H - m.t - m.b)) + '" width="' + bw + '" height="' + (a.H - m.t - m.b) +
        '" fill="transparent"><title>' + chSvgEsc(g.name + "：中位数 " + chFmt(q2) + "，Q1 " + chFmt(q1) + "，Q3 " + chFmt(q3) + "，n=" + sv.length) + "</title></rect>");
    });
    a.items.push({ label: "中位数与四分位距", color: a.th.series[0] });
  };

  /* —— 工具面板 UI：导入 → 画像 → 推荐 → 出图 → 改 → 导出。
     面板分两层重画：数据层（选 sheet/映射列/推荐 chips）整段重画；
     图形层（标题副题等只影响画面的）只重画 #ch-svg，输入框不丢焦点。 —— */
  function chartPanel() {
    return '<section class="tool-card" id="chart">' +
      "<h2>图表生成</h2>" +
      '<p class="tool-sub">把一份 Excel（.xlsx）或 CSV 交给它，自动认出列的类型、挑合适的图型，' +
      "标题、图例、坐标轴、配色都先替你排好，再随手改成想要的。可导出 PNG 与 SVG。" +
      "文件在本机解析，<u>不上传、不联网</u>。</p>" +
      '<div class="tt-drop" id="ch-drop" role="button" tabindex="0" data-act="ch-choose" aria-label="选择要绘图的数据文件">' +
        '<span class="tt-drop-ico" aria-hidden="true">＋</span>' +
        "<b>把 .xlsx / .csv 文件拖到这里，或点击选择</b>" +
        '<i>可多份导入；每个工作簿里的每张工作表都可选来画，<u>数据不离开这台电脑</u></i>' +
        '<input type="file" id="ch-file" multiple accept=".xlsx,.xlsm,.csv">' +
      "</div>" +
      '<div class="tt-files" id="ch-files" hidden></div>' +
      '<p class="tt-filemsg" id="ch-filemsg" hidden></p>' +
      '<div id="ch-data"></div>' +
      '<div class="ch-types-note">' +
        "<h3>它认识哪些图</h3>" +
        '<div class="ch-type-grid">' +
          "<div><b>比较类</b><i>柱状图／条形图（可分组、可堆积）：类别之间比大小；" +
          "雷达图：一个对象的多维综合评估。</i></div>" +
          "<div><b>趋势类</b><i>折线图：时间序列走势；面积图／堆积面积图：趋势之外看累积效应；" +
          "瀑布图：分步累积，如收支到利润的构成。</i></div>" +
          "<div><b>结构与占比类</b><i>饼图／环形图：3–6 类的占比（类别多于 6 个会自动建议改条形图）；" +
          "树状图：层级关系的面积占比。</i></div>" +
          "<div><b>关联与分布类</b><i>散点图／气泡图：变量相关性；热力图：矩阵的密度与频率；" +
          "直方图／箱线图：数值的分布与离散。</i></div>" +
        "</div>" +
      "</div>" +
    "</section>";
  }

  function chSay(html) {
    var el = document.getElementById("ch-filemsg");
    if (!el) return;
    el.innerHTML = html || "";
    el.hidden = !html;
  }

  function chDocsRender() {
    var box = document.getElementById("ch-files");
    if (!box) return;
    if (!CH.docs.length) { box.innerHTML = ""; box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = CH.docs.map(function (d, i) {
      return '<span class="tt-chip' + (d.ok ? "" : " bad") + '">' +
        "<b>" + esc(d.name) + "</b><i>" + esc(d.ok ? d.sheets.length + " 张工作表" : (d.msg || "解析失败")) + "</i>" +
        '<button type="button" data-act="ch-filedel" data-idx="' + i + '" title="移除这个文件">✕</button></span>';
    }).join("");
  }

  /* 换了 sheet 或文件：重新画像、重排映射、回到推荐的第一张图 */
  function chResetSheet() {
    var tb = chCurTable();
    if (!tb) { CH.cfg = null; CH.type = ""; return; }
    var P = chProfile(tb);
    var nums = P.colByKind("num"), cats = P.colByKind("cat"), times = P.colByKind("time");
    var cfg = {
      title: chAutoTitle(tb), sub: "自动生成 · " + P.nRows + " 行 × " + Math.max(0, P.cols.length - 1) + " 组数值",
      legend: "top", theme: "zhusha", stacked: false, donut: false,
      timeCol: times.length ? times[0].i : null,
      catCol: cats.length ? cats[0].i : (P.cols.length > 1 ? 0 : null),
      cat2Col: cats.length > 1 ? cats[1].i : null,
      valCols: nums.slice(0, 6).map(function (c) { return c.i; })
    };
    if (!cfg.valCols.length && P.cols.length > 1) cfg.valCols = [1];
    CH.cfg = cfg;
    var rec = chRecommend(P);
    CH.type = rec[0].type;
    CH.rec = rec;
    CH.profile = P;
  }
  function chAutoTitle(tb) {
    var d = CH.docs[CH.doc];
    return tb.name && tb.name !== "csv" && !/^Sheet/i.test(tb.name) ? tb.name : (d ? d.name.replace(/\.(xlsx|xlsm|csv)$/i, "") : "图表");
  }
  function chCurTable() {
    var d = CH.docs[CH.doc];
    return d && d.ok ? d.sheets[CH.sheet] : null;
  }

  function chDataRender() {
    var box = document.getElementById("ch-data");
    if (!box) return;
    var tb = chCurTable();
    if (!tb) { box.innerHTML = ""; return; }
    if (!CH.cfg) chResetSheet();
    var P = CH.profile, cfg = CH.cfg;
    /* 表体前 6 行预览 */
    var prev = P.body.slice(0, 6).map(function (r) {
      return "<tr>" + P.cols.slice(0, 8).map(function (c) {
        return "<td>" + esc(chCut(String(r[c.i] == null ? "" : r[c.i]), 14)) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    /* 列映射控件 */
    var KINDN = { num: "数值", cat: "类别", time: "时间", id: "标识" };
    function opts(sel, withNone) {
      var h = withNone ? '<option value="">（无）</option>' : "";
      P.cols.forEach(function (c, i) {
        h += '<option value="' + i + '"' + (i === sel ? " selected" : "") + ">" +
          esc(chCut(c.name, 14)) + "（" + (KINDN[c.kind] || "?") + "）</option>";
      });
      return h;
    }
    var valOpts = P.cols.map(function (c, i) {
      return '<option value="' + i + '"' + (cfg.valCols.indexOf(i) > -1 ? " selected" : "") + ">" +
        esc(chCut(c.name, 14)) + "（" + (KINDN[c.kind] || "?") + "）</option>";
    }).join("");
    /* 推荐卡（前三）＋ 全部图型 */
    var recs = (CH.rec || []).slice(0, 3).map(function (r, i) {
      return '<button type="button" class="ch-rec' + (r.type === CH.type ? " on" : "") +
        '" data-act="ch-type" data-id="' + r.type + '"><b>' + (i === 0 ? "首选 · " : "") + esc(r.n) + "</b><i>" + esc(r.why) + "</i></button>";
    }).join("");
    var typeOpts = CH_TYPES.map(function (t) {
      return '<option value="' + t.id + '"' + (t.id === CH.type ? " selected" : "") + ">" +
        esc("【" + t.g + "】" + t.n) + "</option>";
    }).join("");
    var curT = chTypeById(CH.type) || CH_TYPES[0];
    box.innerHTML =
      '<div class="ch-pickbar">' +
        '<label class="wa-lab">工作簿<select id="ch-doc">' +
          CH.docs.map(function (d, i) {
            return d.ok ? '<option value="' + i + '"' + (i === CH.doc ? " selected" : "") + ">" + esc(chCut(d.name, 22)) + "</option>" : "";
          }).join("") + "</select></label>" +
        '<label class="wa-lab">工作表<select id="ch-sheet">' +
          (CH.docs[CH.doc] && CH.docs[CH.doc].ok ? CH.docs[CH.doc].sheets.map(function (s, i) {
            return '<option value="' + i + '"' + (i === CH.sheet ? " selected" : "") + ">" + esc(chCut(s.name, 20)) + "</option>";
          }).join("") : "") + "</select></label>" +
      "</div>" +
      '<div class="ch-preview"><table><thead><tr>' +
        P.cols.slice(0, 8).map(function (c) { return "<th>" + esc(chCut(c.name, 12)) + "</th>"; }).join("") +
      "</tr></thead><tbody>" + prev + "</tbody></table>" +
      '<p class="ch-pv-note">共 ' + P.nRows + ' 行数据；上面是前 6 行的样貌，列名后的括号是自动识别的列型。</p></div>' +
      '<div class="ch-recs"><p class="ch-rec-h">按这份数据的结构，推荐这样画：</p>' + recs + "</div>" +
      '<div class="ch-cfg">' +
        '<label class="wa-lab">全部图型<select id="ch-type-sel">' + typeOpts + "</select></label>" +
        '<label class="wa-lab">图例<select id="ch-legend">' +
          ["top|图上 · 横排", "right|图右 · 竖排", "none|不显示"].map(function (x) {
            var p2 = x.split("|");
            return '<option value="' + p2[0] + '"' + (cfg.legend === p2[0] ? " selected" : "") + ">" + p2[1] + "</option>";
          }).join("") + "</select></label>" +
        '<label class="wa-lab">配色<select id="ch-theme">' +
          Object.keys(CH_THEMES).map(function (k) {
            return '<option value="' + k + '"' + (cfg.theme === k ? " selected" : "") + ">" + esc(CH_THEMES[k].n) + "</option>";
          }).join("") + "</select></label>" +
        '<label class="ch-chk' + (CH.type === "bar" ? "" : " hide") + '" id="ch-chk-stacked"><input type="checkbox" id="ch-stacked"' +
          (cfg.stacked ? " checked" : "") + ">改成堆积</label>" +
        '<label class="ch-chk' + (CH.type === "pie" ? "" : " hide") + '" id="ch-chk-donut"><input type="checkbox" id="ch-donut"' +
          (cfg.donut ? " checked" : "") + ">改成环形</label>" +
      "</div>" +
      '<div class="ch-cfg ch-cfg2">' +
        '<label class="wa-lab">标题<input type="text" id="ch-title" value="' + esc(cfg.title) + '"></label>' +
        '<label class="wa-lab">副题<input type="text" id="ch-sub" value="' + esc(cfg.sub) + '"></label>' +
      "</div>" +
      '<div class="ch-cfg ch-cfg2">' +
        '<label class="wa-lab">分类列<select id="ch-cat">' + opts(cfg.catCol, true) + "</select></label>" +
        '<label class="wa-lab">数值列（可多选）<select id="ch-vals" multiple size="3">' + valOpts + "</select></label>" +
        '<label class="wa-lab">第二分类列（树状图分层）<select id="ch-cat2">' + opts(cfg.cat2Col, true) + "</select></label>" +
      "</div>" +
      '<p class="ch-typewhy">当前：<b>' + esc(curT.n) + "</b>（" + esc(curT.g) + "）—— " + esc(curT.use) + "</p>" +
      '<div class="tt-acts">' +
        '<button class="tt-btn primary" type="button" data-act="ch-png">导出 PNG</button>' +
        '<button class="tt-btn" type="button" data-act="ch-svg">导出 SVG</button>' +
      "</div>" +
      '<div class="ch-svgwrap" id="ch-svg">' + chSvgInner() + "</div>";
    chBindCfg();
  }
  /* 只重画图：标题栏输入时不重建整个面板，光标就不会被顶掉 */
  function chSvgInner() {
    var tb = chCurTable();
    if (!tb || !CH.cfg) return "";
    try {
      return chChartSvg(CH.type, CH.profile || chProfile(tb), CH.cfg);
    } catch (e) {
      return '<p class="warn" style="padding:1rem">这张图画不出来：' + esc((e && e.message) || e) + "</p>";
    }
  }
  function chSvgRender() {
    var el = document.getElementById("ch-svg");
    if (el) el.innerHTML = chSvgInner();
  }

  function chBindCfg() {
    var g = function (id) { return document.getElementById(id); };
    var docSel = g("ch-doc");
    if (docSel) docSel.addEventListener("change", function () {
      CH.doc = +docSel.value; CH.sheet = 0;
      chResetSheet(); chDataRender(); chDocsRender();
    });
    var sheetSel = g("ch-sheet");
    if (sheetSel) sheetSel.addEventListener("change", function () {
      CH.sheet = +sheetSel.value;
      chResetSheet(); chDataRender();
    });
    var typeSel = g("ch-type-sel");
    if (typeSel) typeSel.addEventListener("change", function () {
      CH.type = typeSel.value; chDataRender();
    });
    var lg = g("ch-legend"), th = g("ch-theme");
    if (lg) lg.addEventListener("change", function () { CH.cfg.legend = lg.value; chSvgRender(); });
    if (th) th.addEventListener("change", function () { CH.cfg.theme = th.value; chSvgRender(); });
    var st = g("ch-stacked");
    if (st) st.addEventListener("change", function () { CH.cfg.stacked = st.checked; chSvgRender(); });
    var dn = g("ch-donut");
    if (dn) dn.addEventListener("change", function () { CH.cfg.donut = dn.checked; chSvgRender(); });
    ["ch-title", "ch-sub"].forEach(function (id) {
      var el = g(id);
      if (el) el.addEventListener("input", function () {
        CH.cfg[id === "ch-title" ? "title" : "sub"] = el.value;
        chSvgRender();
      });
    });
    var cat = g("ch-cat"), cat2 = g("ch-cat2"), vals = g("ch-vals");
    if (cat) cat.addEventListener("change", function () {
      CH.cfg.catCol = cat.value === "" ? null : +cat.value; chSvgRender();
    });
    if (cat2) cat2.addEventListener("change", function () {
      CH.cfg.cat2Col = cat2.value === "" ? null : +cat2.value; chSvgRender();
    });
    if (vals) vals.addEventListener("change", function () {
      var got = [];
      Array.prototype.forEach.call(vals.selectedOptions || [], function (o) { got.push(+o.value); });
      if (got.length) CH.cfg.valCols = got;
      chSvgRender();
    });
  }

  function bindChartTool() {
    /* 面板内控件是 chDataRender 重画出来的，绑定都在 chBindCfg 里做；
       这里只占位，与其他工具的 bind* 对齐，路由 after 里统一调。 */
  }

  /* —— 导入：xlsx 走 ZIP 解压，csv 走文本解析；解析完落进面板 —— */
  function chLoad(files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    chSay("正在本机解析 " + list.length + " 个文件……");
    var left = list.length;
    function done() { if (--left <= 0 && !document.querySelector("#ch-filemsg .warn")) chSay(""); }
    list.forEach(function (f) {
      var fail = function (msg) {
        CH.docs.push({ name: f.name, ok: false, msg: msg });
        chSay('<span class="warn">' + esc(f.name) + "：" + esc(msg) + "</span>");
        chDocsRender(); chDataRender();
        done();
      };
      readAsBuffer(f).then(function (u8) {
        try {
          if (/\.csv$/i.test(f.name)) {
            var rows = chParseCsv(chDecodeCsv(u8));
            if (!rows.length) throw new Error("CSV 里没有数据");
            CH.docs.push({ name: f.name, ok: true, sheets: [{ name: "csv", rows: rows }] });
            CH.doc = CH.docs.length - 1; CH.sheet = 0;
            chResetSheet();
            chDocsRender(); chDataRender();
            done();
          } else {
            chartParseXlsx(u8.buffer).then(function (shs) {
              if (!shs || !shs.length) throw new Error("没有读到可用的数据表");
              CH.docs.push({ name: f.name, ok: true, sheets: shs });
              CH.doc = CH.docs.length - 1; CH.sheet = 0;
              chResetSheet();
              chDocsRender(); chDataRender();
              done();
            }, function (e) { fail((e && e.message) || "解析失败"); });
          }
        } catch (e) { fail((e && e.message) || "解析失败"); }
      }, function () { fail("读取失败"); });
    });
  }

  /* —— 导出：SVG 直接落文件；PNG 走聚类网络图同一条 2 倍采样通道 —— */
  function chExportSvg() {
    var svg = document.querySelector("#ch-svg svg");
    if (!svg) { window.alert("先选好数据，出图后再导出。"); return; }
    var clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    var xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
    dlBytes((CH.cfg && CH.cfg.title ? CH.cfg.title : "图表") + ".svg",
      new TextEncoder().encode(xml), "image/svg+xml;charset=utf-8");
  }
  function chExportPng() {
    var svg = document.querySelector("#ch-svg svg");
    if (!svg) { window.alert("先选好数据，出图后再导出。"); return; }
    exportGraphPng(svg, (CH.cfg && CH.cfg.title ? CH.cfg.title : "图表") + ".png");
  }

  /* ---------------- 绑定 ---------------- */

  function bindStudyTools() {
    var sc = document.getElementById("qz-scope"), qn = document.getElementById("qz-n");
    if (sc) sc.addEventListener("change", function () { quizReset(sc.value, QZ.n); renderQuiz(); });
    if (qn) qn.addEventListener("change", function () { quizReset(QZ.scope, +qn.value); renderQuiz(); });
    var cs = document.getElementById("cd-scope");
    if (cs) cs.addEventListener("change", function () { CD.scope = cs.value; cdRepaint(); });
  }

  /* 生词卡同理：换了范围，导出按钮的可用状态与预览都要跟着变，
     所以整段重画，重画后再绑一次。 */
  function cdRepaint() {
    var el = document.getElementById("cards");
    if (!el) return;
    el.outerHTML = cardsPanel();
    bindStudyTools();
  }

  /* 判分与评分后要整段重画：按钮区也得跟着换，只重画 body 不够。
     重画会造出新的 select，所以重画之后得再绑一次。 */
  function qzRepaint() {
    var el = document.getElementById("quiz");
    if (!el) return;
    el.outerHTML = quizPanel();
    bindStudyTools();
  }
  function srsRepaint() {
    var el = document.getElementById("srs");
    if (!el) return;
    el.outerHTML = srsPanel();
    bindStudyTools();
  }


  /* 工具台名录：只在这里定义一份，页面菜单、总览、顶栏巨型菜单三处都来取，
     免得名单各写一份、改了这边忘了那边。
     on:1 = 已上线，点进去是能用的工具；否则点进去看这件工具打算做什么。
     w = 用途（一句话讲清它干什么），s = 适用场景（什么时候会想起它）。 */
  var TOOLS = [
    { g: "阅读辅助", d: "先把材料读进来，把能引的原典取出来。", items: [
      { id: "tt", n: "文本分析", on: 1,
        w: "读入本地文档或粘贴文本，统计术语出现与分布，看清一批材料在谈什么。",
        s: "写文献综述前先摸清一批材料都在谈什么，或回头检查自己写的段落术语用得对不对。" },
      { id: "qs", n: "原典引文检索", on: 1,
        w: "按关键词、出处或章节名，在已核过页码的原典引文里查原句与出处。",
        s: "写论文要引《资本论》原文时，不必再翻书核页码，直接用核过的版本。" },
      { id: "ct", n: "概念对照表", on: 1,
        w: "挑两到四个概念并排对照：释义、原典引文与中英德译名。",
        s: "辨析容易混的近义概念，比如「价值」与「使用价值」、「剩余价值」与「剩余价值率」。" }
    ]},
    { g: "写作辅助", d: "上知网之前定检索式，写综述时批量取格式。", items: [
      { id: "writer", n: "写作台", on: 1,
        w: "按章节攒卡片，边写边引原典，脚注与参考文献自动编号。",
        s: "素材攒够了要动笔时：不必在词条页与文档之间来回复制粘贴，脚注编号也不用自己数。" },
      { id: "kw", n: "检索词与检索式", on: 1,
        w: "把词条译成数据库认的检索式，并给出同义与近义表达。",
        s: "上知网检索文献之前先把检索式定下来，避免漏检或检索过窄。" },
      { id: "nb", n: "笔记板", on: 1,
        w: "按词条记笔记，随读随写，可整份导出带走。",
        s: "论文某一节写不动时，回看此前零散记下的想法。" },
      { id: "mt", n: "多语对照表", on: 1,
        w: "同一个概念的中、英、德文并排看，译名差异一目了然。",
        s: "读外文文献、写英文摘要时核对译名。" }
    ]},
    { g: "学习与记忆", d: "读完一批词条，得知道自己记住了没有。", items: [
      { id: "quiz", n: "自测引擎", on: 1,
        w: "从词条现场出题，四选一与填空交替，答完给分并指出薄弱处。",
        s: "读完一批词条后自测，检验是记住了还是只是看着眼熟。" },
      { id: "srs", n: "间隔重复卡", on: 1,
        w: "把要背的词条排进复习日程，按记得牢不牢安排下次复习。",
        s: "备考或需要长期记住时，避免背了就忘。" },
      { id: "cards", n: "生词卡导出", on: 1,
        w: "把标过的生词导出成卡片，打印或另存都行。",
        s: "想离开电脑、用手机或纸卡背术语时。" },
    ]},
    { g: "分析与教学", d: "把概念之间的关系讲清楚，把内容拿去讲。", items: [
      { id: "path", n: "概念关系图编辑器", on: 1,
        w: "把词条之间的推导、对立与关联画成一张可拖拽的图。",
        s: "讲清一个复杂概念是如何从基础概念推导出来的，并把这条链子画成自己的一张图。" },
      { id: "calc", n: "概念计算器", on: 1,
        w: "剩余价值率、资本有机构成一类式子，填数即算，并写出代入过程。",
        s: "做题、讲课举例、验证书上的数字。" },
      { id: "chrono", n: "大事年表", on: 1,
        w: "从 1818 到 1883，把著作、事件与版本排成一条时间线。",
        s: "写发展史、传播史的论述时快速定位时间。" },
      { id: "handout", n: "讲义与投影模式", on: 1,
        w: "勾选词条，生成可打印的讲义，或切成一屏一条的投影模式。",
        s: "读书会领读、课堂讲一段时直接拿来用。" },
      { id: "chart", n: "图表生成", on: 1,
        w: "导入 Excel 或 CSV，自动挑合适的图型出图，标题图例配色随手改，可导出 PNG/SVG。",
        s: "写论文、做汇报要把一张表变成一张图时：不用再开 Excel 对着向导点一遍。" }
    ]}
  ];

  /* 名录摊平一份，便于按 id 取用与统计 */
  var TOOL_FLAT = [];
  TOOLS.forEach(function (g) {
    g.items.forEach(function (it) { it.group = g.g; TOOL_FLAT.push(it); });
  });
  var TOOL_ON = TOOL_FLAT.filter(function (t) { return t.on; }).length;

  function toolById(id) {
    for (var i = 0; i < TOOL_FLAT.length; i++) if (TOOL_FLAT[i].id === id) return TOOL_FLAT[i];
    return null;
  }

  /* 导航一行放不下整段说明：先在 40 字以内找最后一处句读（；或，或：），
     找不到再退回硬截。这样菜单里读到的是一句完整的话，不是半句。 */
  function navTip(s) {
    if (s.length <= 40) return s;
    var cut = -1;
    for (var i = 0; i < s.length && i < 40; i++) {
      var c = s.charAt(i);
      if (c === "；" || c === "，") cut = i;
    }
    return cut > 14 ? s.slice(0, cut) + "…" : s.slice(0, 38) + "…";
  }

  /* 顶栏「工具」那张巨型菜单：四个功能组各一栏，一件一行。
     规划项走同一条路由，点进去看的是它打算做什么——不另开一套占位页。 */
  function fillNavTools() {
    var box = document.getElementById("navTools");
    if (!box) return;
    box.innerHTML = TOOLS.map(function (g) {
      var on = g.items.filter(function (i) { return i.on; }).length;
      return '<div class="np-block"><p class="np-h">' + esc(g.g) + " · " +
        (on ? "已上线 " + on + " 件" : "规划中") + "</p>" +
        g.items.map(function (it) {
          /* 说明在总览里是整段给的，导航一行却放不下——这里按句读收口，
             取第一个收束到 40 字以内的分句（不是硬截 34 字，那样会把话砍在半句上） */
          var w = navTip(it.w);
          return '<a href="#/tools/' + esc(it.id) + '"' + (it.on ? "" : ' class="soon"') + ">" +
            "<b>" + esc(it.n) + "</b><i>" + esc(w) + "</i></a>";
        }).join("") + "</div>";
    }).join("") +
      '<div class="np-foot"><a href="#/tools"><b>工具台总览</b>' +
      "<i>十五件一览：" + TOOL_ON + " 件能用，" +
      (TOOL_FLAT.length - TOOL_ON) + " 件在规划</i></a></div>";
  }

  function viewTools(sel) {
    var cur = toolById(sel) ? sel : "";

    /* —— 页内菜单：横着四行，比原先十四张大卡片堆一屏省地方得多 —— */
    var menu = '<nav class="tool-menu">' + TOOLS.map(function (g) {
      var on = g.items.filter(function (i) { return i.on; }).length;
      return '<div class="tm-row' + (on ? "" : " plan") + '">' +
        '<span class="tm-g">' + esc(g.g) + "<i>" +
          (on ? "已上线 " + on + " 件" : "规划 " + g.items.length + " 件") + "</i></span>" +
        g.items.map(function (it) {
          return '<a class="tm-t' + (it.id === cur ? " on" : "") + '" href="#/tools/' + esc(it.id) +
            '" data-target="' + esc(it.id) + '">' + esc(it.n) + "</a>";
        }).join("") + "</div>";
    }).join("") +
      (cur ? '<div class="tm-row tm-foot"><a href="#/tools">← 工具台总览</a></div>' : "") +
      "</nav>";

    /* —— 总览：四栏，一件一行，用途压两行 —— */
    var overview = '<div class="to-grid">' + TOOLS.map(function (g) {
      var on = g.items.filter(function (i) { return i.on; }).length;
      return '<section class="to-col"><h3>' + esc(g.g) + "<span>" +
        on + " / " + g.items.length + " 件可用</span></h3>" +
        "<p>" + esc(g.d) + "</p>" +
        g.items.map(function (it) {
          return '<a class="to-item' + (it.on ? "" : " soon") + '" href="#/tools/' + esc(it.id) + '">' +
            "<b>" + esc(it.n) + "</b><i>" + esc(it.w) + "</i></a>";
        }).join("") + "</section>";
    }).join("") + "</div>";

    /* —— 规划中那件：一张小卡讲清定位，不做假界面 —— */
    function planPanel(it) {
      return '<section class="tool-card" id="' + esc(it.id) + '">' +
        '<article class="tool-plan"><h4>' + esc(it.n) +
          '<span class="tp-tag">规划中</span></h4>' +
          '<p class="tp-use">' + esc(it.w) + "</p>" +
          '<p class="tp-when"><b>适用场景</b>' + esc(it.s) + "</p></article>" +
        '<p class="to-soon">这件工具还没做，上面的用途与场景是它的定位。' +
        "先在这里记着，免得日后想不起来当初为什么想要它。" +
        '<a href="#/tools">回总览挑一件能用的 →</a></p>' +
      "</section>";
    }

    var qsSrc = QS_SRC.map(function (s) {
      return '<option value="' + s[0] + '">' + esc(s[1]) + "</option>";
    }).join("");

    var kwDomOpts = '<option value="">全部知识板块</option>' +
      ((taxById("domain") || {}).cats || []).map(function (c) {
        return '<option value="' + esc(c.id) + '">' + esc(c.name) + "</option>";
      }).join("");
    var mtScopeOpts = '<option value="all">全部词条</option><option value="de">仅有德文原名</option>' +
      ((taxById("domain") || {}).cats || []).map(function (c) {
        return '<option value="d:' + esc(c.id) + '">' + esc(c.name) + "</option>";
      }).join("");
    /* v57：板块批量筛选——一组可多选的勾选块，与上面的单选范围、搜索词叠加生效 */
    var mtDomChips = ((taxById("domain") || {}).cats || []).map(function (c) {
      return '<label class="df-word"><input type="checkbox" data-dom="' + esc(c.id) + '">' +
        esc(c.short || c.name) + "</label>";
    }).join("") +
      '<button type="button" class="tbtn" data-act="mt-dom-clear">清空板块</button>';

    /* 十一件能用的工具，各是一段现成界面；规划中的由 planPanel 兜底。
       全部留在 DOM 里、只给非当前那几段加 hidden——切回来时输入不丢、
       事件委托也不必重绑，而页面上一次只铺一件，不至于臃肿。 */
    var panels = {

      tt: '<section class="tool-card" id="tt">' +
        "<h2>文本分析</h2>" +
        '<p class="tool-sub">概念识别 · 分词词频 · 关联分析 · 聚类网络 · 情感分析 · 多文本比对。' +
        "概念识别按「长名优先」：原文里出现「剩余价值率」时，不会再被算成一次「剩余价值」。" +
        "所有结果都画成表格，可分别导出 xlsx（本机生成，不联网）。</p>" +

        '<div class="tt-drop" id="tt-drop" role="button" tabindex="0" data-act="tt-choose" ' +
          'aria-label="选择要分析的文件">' +
          '<span class="tt-drop-ico" aria-hidden="true">＋</span>' +
          '<b>把 .docx / .pdf / .txt 文件拖到这里，或点击选择</b>' +
          '<i>可多选；浏览器里直接把文字抽出来，<u>文件不上传、不联网</u></i>' +
          '<input type="file" id="tt-file" multiple ' +
            'accept=".txt,.md,.markdown,.csv,.log,.docx,.docm,.pdf,text/plain,text/markdown,' +
            'application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document">' +
        "</div>" +
        '<div class="tt-files" id="tt-files" hidden></div>' +
        '<p class="tt-filemsg" id="tt-filemsg" hidden></p>' +

        '<textarea class="tt-input" id="tt-input" placeholder="也可以直接把一段文字粘到这里——' +
          '论文段落、读原著的笔记、课件……">' + esc(ttText) + "</textarea>" +
        '<div class="tt-acts">' +
          '<button class="tt-btn primary" type="button" data-act="tt-run">分析</button>' +
          '<button class="tt-btn" type="button" data-act="tt-clear">清空</button>' +
        "</div>" +
        '<div class="tt-out" id="tt-out"></div>' +
        '<div id="ta-out"></div>' +
      "</section>",

      qs: '<section class="tool-card" id="qs">' +
        "<h2>原典引文检索</h2>" +
        '<p class="tool-sub">在站内已核的原典引文里按关键词检索。' +
        "只收已逐字补入的引文（待补录的条目没有引文可查）；" +
        "命中卡片可直接复制为<b>脚注体例</b>（引文＋出处）或 <b>GB/T 7714</b> 著录格式；" +
        "出处要素不全的条目不给 GB 按钮——宁可缺，也不给一条错的引注。</p>" +
        '<div class="qs-bar">' +
          '<input type="search" id="qs-q" class="qs-input" placeholder="引文关键词、出处、章节名或词条名……">' +
          '<select id="qs-src" class="qs-select" aria-label="按来源筛选">' + qsSrc + "</select>" +
        "</div>" +
        '<div class="qs-out" id="qs-out"></div>' +
      "</section>",

      writer: writerPanel(),

      ct: '<section class="tool-card" id="ct">' +
        "<h2>概念对照表</h2>" +
        '<p class="tool-sub">挑 2—4 条词条并排比异同：AI 的一句话、标准释义、原典直引、英文与德文原名。' +
        "选过的组合记在本机，下次打开还在。复制按钮给的是 Markdown 表格，可直接贴进笔记。</p>" +
        '<div class="ct-bar">' +
          '<input type="search" id="ct-q" class="qs-input" placeholder="输入词条名、别名、英文名或拼音首字母……">' +
        "</div>" +
        '<div class="ct-sugs" id="ct-sugs"></div>' +
        '<div class="ct-picks" id="ct-picks"></div>' +
        '<div id="ct-table"></div>' +
      "</section>",

      kw: '<section class="tool-card" id="kw">' +
        "<h2>检索词与检索式</h2>" +
        '<p class="tool-sub">按知识板块取检索词：点中一块，得到这块的全部词条、' +
        "别名与官方外译名，并拼成现成的检索式。查文献之前先把检索式定下来，" +
        "免得漏检，也免得检索过窄。</p>" +
        '<div class="qs-bar">' +
          '<label class="wa-lab">知识板块<select id="kw-dom" class="qs-select">' + kwDomOpts + "</select></label>" +
        "</div>" +
        '<div class="wa-acts cm-noprint">' +
          '<button class="tt-btn" type="button" data-act="wa-kw-word">导出检索词与检索式 Word</button>' +
        "</div>" +
        '<div id="kw-out"></div>' +
      "</section>",

      nb: '<section class="tool-card" id="nb">' +
        "<h2>笔记板 · 思维导图</h2>" +
        '<p class="tool-sub">一张可拖拽的画布：双击节点改文字，点选后按「＋」长出子节点，' +
        "把读到的想法整理成一棵导图。也可以从词条导入——词条页「我的笔记」里写过的内容会一并带上。</p>" +
        '<div class="qs-bar">' +
          '<input type="search" id="nbm-term" class="qs-input" placeholder="输入词条名，导入为子节点……">' +
          '<button class="tt-btn primary" type="button" data-act="nbm-import">导入词条</button>' +
          '<button class="tt-btn" type="button" data-act="nbm-add" data-id="1">新建节点</button>' +
          '<button class="tt-btn" type="button" data-act="nbm-md">导出 Markdown</button>' +
        "</div>" +
        '<p class="nbm-msg" id="nbm-msg" role="status" aria-live="polite"></p>' +
        '<div id="nbm-wrap"></div>' +
      "</section>",

      mt: '<section class="tool-card" id="mt">' +
        "<h2>多语术语对照表</h2>" +
        '<p class="tool-sub">中文—英文—德文三列，可筛选、可导出。读外文文献、写英文摘要前核对译名。' +
        "德文原名只覆盖哲学类词条，表里空着就是没有——不拿别的语言的拼写充数。</p>" +
        '<div class="qs-bar">' +
          '<input type="search" id="mt-q" class="qs-input" placeholder="按中文、英文、德文、别名或拼音检索……">' +
          '<select id="mt-scope" class="qs-select" aria-label="筛选范围">' + mtScopeOpts + "</select>" +
        "</div>" +
        '<div class="df-words mt-doms" id="mt-doms" role="group" aria-label="按知识板块批量筛选">' + mtDomChips + "</div>" +
        '<div class="wa-acts cm-noprint">' +
          '<button class="tt-btn primary" type="button" data-act="wa-mt-xlsx">导出 xlsx</button>' +
          '<button class="tt-btn" type="button" data-act="wa-mt-csv">导出 CSV</button>' +
          '<button class="tt-btn" type="button" data-act="wa-mt-word">导出 Word</button>' +
          '<button class="tt-btn" type="button" data-act="wa-mt-md">复制 Markdown</button>' +
        "</div>" +
        '<div id="mt-out"></div>' +
      "</section>",

      /* 学习与记忆四件各自现算，函数在文件上方「学习与记忆」段里 */
      quiz: quizPanel(),      srs: srsPanel(),
      cards: cardsPanel(),

      /* 分析与教学四件：函数在文件上方「分析与教学」段里 */
      path: pathPanel(),
      calc: calcPanel(),
      chrono: chronoPanel(),
      handout: handoutPanel(),

      /* 图表生成（v70）：骨架 +「它认识哪些图」，其余在 #ch-data 里现画 */
      chart: chartPanel()
    };

    var body = TOOL_FLAT.map(function (it) {
      var h = panels[it.id] || planPanel(it);
      return it.id === cur ? h : h.replace('<section class="tool-card"', '<section class="tool-card" hidden');
    }).join("");

    var head = '<h1 class="page-title">工具台</h1>' +
      '<p class="note">这个站除了能查，还应当能干活。现下能用的是<b>' + TOOL_ON + " 件</b>：" +
      "<b>文本分析</b>一件（六种分析）、<b>原典引文检索</b>、<b>概念对照表</b>、" +
      "<b>写作台</b>、<b>检索词与检索式</b>、<b>笔记板</b>、<b>多语术语对照表</b>、" +
      "<b>自测引擎</b>、<b>间隔重复卡</b>、<b>生词卡导出</b>、" +
      "<b>概念关系图编辑器</b>、<b>概念计算器</b>、<b>大事年表</b>、<b>讲义与投影模式</b>、<b>图表生成</b>，" +
      "另有导航栏的<b>三卷目录树</b>、顶栏的<b>全文检索</b>（词条之外，原典引文、争鸣观点与自己的笔记也在检索范围内）。" +
      "全部在本机跑，文件不上传、不联网。" +
      "读、记、写、讲四条线到这里各就各位：素材从词条页进写作台，脚注与参考文献自动编号。</p>";

    /* 面板一律留在 DOM 里（非当前的加 hidden）：一是切回来时刚写的字还在，
       二是各件的绑定一次到位、不必随切换重来。页面上一次只铺一件，不臃肿。 */
    return head + menu + (cur ? "" : overview) + body;
  }

  function viewTag(name) {
    var g = tagByName(name);
    if (!g) return '<p class="empty">没有这个标签。<a href="#/tags">看看全部标签</a></p>';
    var list = g.terms.slice().sort(pySort);
    var kindName = { topic: "主题", place: "原著位置", work: "经典著作" }[g.kind];

    // 常与它同时出现的标签：给一条「顺藤摸瓜」的路
    var co = {};
    g.terms.forEach(function (t) {
      (t.tags || []).forEach(function (x) { if (x !== name) co[x] = (co[x] || 0) + 1; });
    });
    var coList = Object.keys(co).map(function (k) { return { k: k, n: co[k] }; })
      .sort(function (a, b) { return b.n - a.n; }).slice(0, 10);

    /* 原著位置标签：说明它横跨哪些分册（同名「篇」在不同卷各指其篇） */
    var volNote = "";
    if (g.kind === "place" && !/^第[一二三]卷$/.test(name)) {
      var parts = ["第一卷", "第二卷", "第三卷"].map(function (v) {
        var n = g.terms.filter(function (t) { return (t.tags || []).indexOf(v) > -1; }).length;
        return n ? "《资本论》" + v + " <b>" + n + "</b> 条" : "";
      }).filter(Boolean).join(" · ");
      volNote = parts
        ? '<p class="note vol-split">「' + esc(name) + "」在不同分册各指其篇，按分册看：" + parts + "。</p>"
        : '<p class="note vol-split">本标签未与具体分册的卷标签同时出现，请以词条页的原典指引为准。</p>';
    }

    return '<p class="crumb"><a href="#/">首页</a> / ' +
        '<a href="#/idx?m=tag">索引 · 按标签</a> / ' +
        '<a href="#/idx?m=tag&k=' + esc(g.kind) + '">' + esc(kindName) + "</a> / " + esc(name) + "</p>" +
      '<h1 class="page-title">' + esc(name) + "</h1>" +
      '<p class="note">标签「' + esc(name) + "」下共 <b>" + list.length + "</b> 条词条" +
        (g.kind === "place" ? "（原著位置）" : "") + "。</p>" +
      volNote +
      termList(list) +
      (coList.length
        ? '<h2 class="sec-title">常与它一起出现</h2><div class="tag-cloud">' +
          coList.map(function (x) {
            return '<a class="tag tw-2" href="#/tg/' + encodeURIComponent(x.k) + '">' + esc(x.k) +
              "<em>" + x.n + "</em></a>";
          }).join("") + "</div>"
        : "") +
      '<h2 class="sec-title">换个方式找</h2>' +
      '<p class="note"><a href="#/idx?m=tag">全部标签</a> · <a href="#/idx?m=alpha">拼音索引</a> · ' +
      '<a href="#/tax">门类总览</a> · <a href="#/tax?v=tree">三卷目录树</a> · ' +
      '<a href="#/graph">关系图</a></p>';
  }

  /* ---------------- 总览（门类 ＋ 三卷目录树，v43 两页合一） ----------------

     原先「门类总览」(#/tax) 与「三卷目录树」(#/tree) 是两个独立页面、两个导航项：
     一个按学科归类，一个按原著次序。它们其实是同一件事的两种排法——
     「把全站词条铺开给你看」，所以合成一页、顶部切换，共用一份页头说明。
     状态同样写进 URL（#/tax?v=cat|tree），刷新与分享都落在同一视图上。 */

  var OV_ST = null;

  function ovState(q) { return { v: (q && q.v) === "tree" ? "tree" : "cat" }; }
  function ovUrl(st) { return st.v === "tree" ? "#/tax?v=tree" : "#/tax"; }

  function ovSegInner(st) {
    return [["cat", "按知识板块"], ["tree", "按原著次序"]].map(function (p) {
      var on = p[0] === st.v;
      return '<a class="ttab' + (on ? " on" : "") + '" id="ov-tab-' + p[0] + '" role="tab" ' +
        'href="' + ovUrl({ v: p[0] }) + '" data-ov-go="v=' + p[0] + '" ' +
        'aria-selected="' + (on ? "true" : "false") + '" aria-controls="ov-body" ' +
        'tabindex="' + (on ? "0" : "-1") + '">' + p[1] + "</a>";
    }).join("");
  }

  function viewOverview(st) {
    OV_ST = st;
    return '<p class="crumb"><a href="#/">首页</a> / 总览</p>' +
      '<h1 class="page-title">总览</h1>' +
      /* v67：页头导语黄框（「同一批词条的两种排法…」）按需求撤除，保留切换按钮本体 */
      '<div class="ttabs idx-seg" role="tablist" aria-label="总览的两种排法">' +
        ovSegInner(st) + "</div>" +
      '<p class="sr-only" id="ov-live" role="status" aria-live="polite"></p>' +
      '<div id="ov-body" role="tabpanel" aria-labelledby="ov-tab-' + st.v + '" tabindex="0">' +
        ovBodyHTML(st) + "</div>";
  }

  function ovBodyHTML(st) {
    return st.v === "tree" ? ovTreeBody() : viewTaxes();
  }

  function ovPaint(st, fromSeg) {
    OV_ST = st;
    setHashQuiet(ovUrl(st));
    var seg = document.querySelector(".idx-seg");
    if (seg) {
      seg.innerHTML = ovSegInner(st);
      if (fromSeg) {
        var f = document.getElementById("ov-tab-" + st.v);
        if (f && f.focus) { try { f.focus(); } catch (e) { /* 忽略 */ } }
      }
    }
    var body = document.getElementById("ov-body");
    if (body) {
      body.innerHTML = ovBodyHTML(st);
      body.setAttribute("aria-labelledby", "ov-tab-" + st.v);
    }
    /* 目录树是三层折叠的交互结构，重画之后要重新挂一次事件 */
    if (st.v === "tree") vt3Init();
    var live = document.getElementById("ov-live");
    if (live) live.textContent = st.v === "tree" ? "已切换到按原著次序" : "已切换到按知识板块";
  }

  function ovGo(token, fromSeg) {
    if (!OV_ST) return false;
    var p = parseQuery(token);
    ovPaint(ovState({ v: p.v }), fromSeg);
    return true;
  }

  /* 三卷目录树的正文（页头由总览页统一给，这里只出视图本身） */
  function ovTreeBody() {
    return '<p class="note">按原著自己的次序读：卷 → 篇 → 章 → 词条。' +
      "目录骨架取三卷的<strong>篇—章固定结构</strong>（与全站引注校验同一套基准），" +
      "章标题从各词条的引文出处里现挖；词条落位同时认两路——引文出处精确到章，词条标签挂到篇。" +
      '读到哪一章，点开就知道那里有哪些术语；换个入口也可以去' +
      '<a href="#/idx?m=tag&k=place">原著位置标签</a>，或到' +
      '<a href="#/graph">关系图</a>看这些术语怎么连成一网。</p>' +
      volTreeHtml();
  }

  /* ---------------- 关系图（v43：画布统一到 pathflow.html） ----------------

     v43 之前，「概念关系图」是站内自己画的一张 SVG 力导引图（约一千行），
     而「工具 → 概念关系图编辑器」里又有一个 React Flow 编辑器：同一份关系数据
     被两套代码各画一遍，用户还得猜「哪个才是关系图」。这一版把画布统一到
     pathflow.html —— 本页只负责把它托起来（外框、加载态、缺文件时的说明），
     导航栏给一个独立入口；词条栏里那一项随之撤掉。
     站内不再有第二套关系图渲染：搜索概念、聚焦子图、按板块着色、点节点进词条
     这些能力都收进编辑器里（见 pathflow/src 与 pictorial 同级的 pathflow 工程）。 */

  function relCount() {
    var n = 0;
    TERMS.forEach(function (t) {
      (t.related || []).forEach(function (r) { if (BY_ID[r.id]) n++; });
    });
    return n;
  }

  /* ══════════════════════════════════════════════════════════════
     使用手册（#/manual）
     图文结合的操作说明：按「怎么用这个站」组织，不是按代码模块组织。
     配图全部**复用已有资源** —— 引用 site/assets 里现成的那些（门类配图 3 张、
     三卷书封 3 张、开屏书斋底图 1 张），靠 build.mjs 的 ASSETS 表在构建时内联成
     data URI，离线单文件照样看得到图，不新增任何图片文件。
     锚点跳转用 data-act="jump"（站里已有的那一套，与工具台页内跳转共用）。
     ══════════════════════════════════════════════════════════════ */

  /* 手册里引用的既有图片。写法与 VOL_COVER / dom-zx 那两处一致：
     值就是 "assets/xx.jpg" 字面量，构建时由 build.mjs 换成 data URI。 */
  var MANUAL_IMG = {
    house: ["assets/intro-house.jpg", "开屏书斋底图"],
    vol1: ["assets/vol-1.jpg", "《资本论》第一卷书封"],
    vol2: ["assets/vol-2.jpg", "《资本论》第二卷书封"],
    vol3: ["assets/vol-3.jpg", "《资本论》第三卷书封"],
    phil: ["assets/cat-phil.jpg", "门类配图《德意志意识形态》"],
    econ: ["assets/cat-econ.jpg", "门类配图《资本论》"],
    soc: ["assets/cat-soc.jpg", "门类配图《共产党宣言》"]
  };

  function manualFig(key, cap, cls) {
    var it = MANUAL_IMG[key];
    if (!it) return "";
    return '<figure class="man-fig' + (cls ? " " + cls : "") + '">' +
      '<img src="' + it[0] + '" alt="' + esc(it[1]) + '" loading="lazy" decoding="async">' +
      (cap ? "<figcaption>" + esc(cap) + "</figcaption>" : "") + "</figure>";
  }

  function manualSec(id, no, title, body) {
    return '<section class="man-sec" id="' + id + '">' +
      '<h2 class="sec-title"><span class="man-no">' + no + "</span>" + esc(title) + "</h2>" +
      body + "</section>";
  }

  /* 使用手册：按「怎么用这个站」组织，分三部分 ——
     平台的目的与定位、画传与关系图、十五件工具。
     这一页不写站点怎么做的、用了什么技术，也不列内部参数与存储细节。 */
  function viewManual() {
    /* 十五件工具：名称 / 目的 / 用法。四组与工具台的四个分组一致。 */
    var GROUPS = [
      ["阅读辅助", "把材料读进来，把可引的原典取出来。", [
        ["文本分析", "统计一批材料的术语出现与分布，判断它实际在谈什么。",
          "把 .docx／.pdf／.txt 拖入页面，或直接粘贴文字，点「分析」。概念识别按长名优先，六种结果分表列出，可分别导出 xlsx；结论可一键复制为分析摘要，聚类网络图可按簇或按知识板块着色并导出 PNG。单次文字量有上限，超出时取前段并告知。"],
        ["原典引文检索", "在已核页码的原典引文中按关键词、出处或章节名查原句。",
          "输入词语、出处或章节名，可限定来源。卡片可复制为脚注体例，或复制为 GB/T 7714 著录格式；待补录者无引文可查，出处要素不全者不给著录按钮。"],
        ["概念对照表", "把两至四条易混概念并排比较，辨析异同。",
          "输入词条名、别名、英文名或拼音首字母，选定二至四条，表格按一句话释义、标准释义、原典直引、英文与德文原名逐行对照；复制为 Markdown 表格。"],
      ]],
      ["写作辅助", "从定检索式到成稿著录，各环节各有其器。", [
        ["写作台", "按章节攒集材料并成文，使引文与注释各归其位。",
          "新建文稿并填标题，左侧逐节添加，右侧放入原典引文、争鸣立场、我的笔记、自撰段落四类卡片；词条页可一键收入引文与立场。导出 Word 时引文转为真脚注，文末文献按出现顺序自动排定。"],
        ["检索词与检索式", "在上数据库检索之前先把检索式定下来，免漏检，也免过窄。",
          "选择知识板块，即得该板块全部词条、别名与官方外译名，并拼成可直接粘贴的检索式；同义与近义表达一并列出，可导出 Word。"],
        ["笔记板", "把读到的想法整理成一棵思维导图。",
          "新建节点、双击改文字，点选后按「＋」长出子节点，节点可拖动摆位；也可输入词条名导入为子节点（词条页「我的笔记」会一并带上）。图只存在本机浏览器里，可导出 Markdown。"],
        ["多语对照表", "核对同一概念的中、英、德三种写法，供读外文与写摘要之用。",
          "按中文、英文、德文、别名或拼音检索，范围可限定为全部词条、仅有德文原名者，也可勾选若干知识板块批量筛选（与检索词叠加生效）；导出 xlsx、CSV、Word，或复制 Markdown。德文原名只覆盖哲学类词条，留空即表示未收。"],
      ]],
      ["学习与记忆", "读过之后是否记住，要另行检验。", [
        ["自测引擎", "从站内词条现场出题，检验记忆的实际状态。",
          "选择题量与范围后点「出题」。释义猜词、引文猜词、译名猜词、争鸣猜词四种题型，题干中的答案一律挖空，干扰项取自同一知识板块；交卷即判分并给解析，错题自动进入错题本，可点「只练错题」。"],
        ["间隔重复卡", "把生词本与错题本合成队列，按遗忘规律排期。",
          "逐张出示，自评「记得」「模糊」「忘了」：记得则间隔拉长，模糊则缩短，忘了则次数清零、次日重来。需要重排时点「重新排期」。"],
        ["生词卡导出", "把词条制成卡片带走，供离开电脑时背诵。",
          "选定范围后导出 Anki CSV、可打印的对折卡 Word，或 Markdown 表格。Anki 桌面版选「文件—导入」，分隔符选逗号，勾选允许 HTML。"],
      ]],
      ["分析与教学", "想清楚，再讲出去。", [
        ["概念关系图编辑器", "在平台所给关系之上，自建一张可讲解的图。",
          "检索术语，可把它连同直接关联一并铺到画布，也可只加词条本体的节点；拖动摆位，从节点边缘拉线新建关系；节点可改名分色、可锁定，连线可改类型与强度、可反转方向；支持自动布局，可导出图文件或图片。共现只表明相近，讲解时须与前五类分清。"],
        ["概念计算器", "把代入过程写出来，看清哪一个量进了分母。",
          "择一式：剩余价值率、剩余价值量与年剩余价值率、资本有机构成、利润率、周转次数、资本总公式。按提示填数，即得结果与逐步代入；单位自定，前后一致即可。"],
        ["大事年表", "三条时间线并置，解决此事在哪一年、当时书出到何处。",
          "可选三条并置，或单看马克思生平、写作与出版、中国译介与传播；按年份、事件、人名或书名筛选。每条标来源类别：卷首文献、站内词条、通行年表。通行年表未逐条核过页码，正式引用须另核。"],
        ["讲义与投影模式", "把一批词条排成讲义，或投到幕布上照讲。",
          "整批加入或逐条手动添加，导出讲义 Word、直接打印，或进入投影模式：一条一屏，方向键翻页，Esc 退出。标注「页码待核」者照样标出，不可念给听众。"],
        ["图表生成", "把一份表格变成一张像样的图，不必再开 Excel 对着向导点一遍。",
          "导入 .xlsx 或 .csv（可多份），自动识别每一列是类别、时间还是数值，按数据结构推荐图型并排好标题、图例、坐标轴与配色；可在十六种图型之间切换，改堆积、环形、图例位置、配色主题与列映射，标题副题随手改；每张图可导出 PNG 或 SVG。文件在本机解析，不上传。数据规模大时自动抽样或截断并注明。"],
      ]]
    ];

    function manItem(it) {
      return '<div class="man-item"><b>' + esc(it[0]) + "</b>" +
        '<p><span class="man-lb">目的</span>' + esc(it[1]) + "</p>" +
        '<p><span class="man-lb">用法</span>' + esc(it[2]) + "</p></div>";
    }

    var toolBody = GROUPS.map(function (g) {
      return '<h3 class="man-grp">' + esc(g[0]) + "<span>" + esc(g[1]) + "</span></h3>" +
        '<div class="man-list">' + g[2].map(manItem).join("") + "</div>";
    }).join("");

    var toc = '<nav class="man-toc" aria-label="手册目录">' +
      /* href 保持为 #/manual：jump 走 data-target，若把 href 写成 #man-3，
         setHashQuiet 会把地址栏改成非路由的片段，刷新就落到兜底页。 */
      '<a href="#/manual" data-act="jump" data-target="man-1"><i>一</i>目的与功能定位</a>' +
      '<a href="#/manual" data-act="jump" data-target="man-2"><i>二</i>画传与关系图</a>' +
      '<a href="#/manual" data-act="jump" data-target="man-3"><i>三</i>十五件工具</a></nav>';

    return '<p class="crumb"><a href="#/">首页</a> / 使用手册</p>' +
      '<h1 class="page-title">使用手册</h1>' +
      '<p class="note">本手册分三部分：先说这个站是做什么的，再说画传与关系图两处该怎么看，' +
      "最后逐件说明十五件工具的用途与用法。</p>" + toc +

      manualSec("man-1", "一", "目的与功能定位",
        "<p>本平台是一部围绕《资本论》及其理论体系的术语学习与研究辅助工具。" +
        "全站收 <b>" + TERMS.length + "</b> 条词条、<b>392</b> 条原典引文、<b>298</b> 个争鸣议题与 <b>" +
        relCount() + "</b> 条概念关系，合为一个网页文件：双击即开，不联网，不注册。</p>" +
        "<p>它针对三处实际困难。其一，概念分散：同一术语的释义在词条，原句在各卷各章，" +
        "学界分歧散在文献之中，读者须在数本书之间往复翻检。其二，出处难核：引用须核版本与页码，" +
        "标注失当即成硬伤。其三，读写割裂：材料读毕而文章未成，检索、著录与归档另有各套规矩。" +
        "平台把这三件事收在一处。</p>" +
        "<p>四条功能线共用同一份词条数据，故任一条线上的所得均可为其余各线所用：</p>" +
        '<ul class="man-lines">' +
        "<li><b>读</b>总览、词条页、画传 —— 系统通读，或按知识板块与原著次序铺开全局。</li>" +
        "<li><b>查</b>全文检索、拼音索引、标签索引、原典引文检索 —— 只记得大意时定位词条，核对原句出处。</li>" +
        "<li><b>练</b>自测、间隔重复、生词卡 —— 检验记忆，安排复习。</li>" +
        "<li><b>写与讲</b>写作台、检索式、概念对照表、讲义 —— 成文、投稿、领读与课堂讲授。</li>" +
        "</ul>" +
        "<p><b>使用前提。</b>已读标记、笔记、生词、错题、复习排期、稿件与书签均保存在所用浏览器中，" +
        "换设备、换浏览器或清理浏览器数据即不再保留；需长期保存者，请用各工具的导出功能另存。" +
        "马恩著作引文依 2012 年版《马克思恩格斯选集》逐字核对至页码，标注「页码待核」者不作引用依据；" +
        "一句话释义与关系图连线为便于理解所作的概括，不作引证。</p>") +

      manualSec("man-2", "二", "画传与概念关系图",
        '<p class="man-sub">全书以概念为纲，这两处则分别以「人与时代」和「概念之间的联系」为纲，' +
        "是读词条的两种补充入口。</p>" +

        "<h3>《马克思画传》</h3>" +
        "<p><b>是什么。</b>画传以图像为主干、文字为辅，不靠编年叙述推进，" +
        "而以一幅幅画面呈现人物所处的场景、器物与事件。本站所收据《马克思画传》" +
        "（马克思诞辰二百周年纪念版）重制，取 1818 至 1883 年的生平为序。</p>" +
        "<p><b>有什么用。</b>词条页回答「这一概念是什么」，画传回答「它产生于怎样的处境」，" +
        "给概念一个历史坐标；以人物与年代为线索，可顺序通读，不必先选定术语；" +
        "画面本身又可作领读与讲授的引子。</p>" +
        "<p><b>怎么呈现。</b>三十三页生平，另附一页年表（二十四条）；每页配一条语录，" +
        "共三十四条，中英对照。画面分深景、中景、人物、前景四层，随滚动与指针以不同速率位移，" +
        "近景快于远景，画面因此有纵深；整屏对齐，滚轮、方向键与滑动皆可翻页。" +
        "触屏设备改由滚动进度驱动；系统开启「减少动态效果」时，全书转为静止呈现。</p>" +
        "<p><b>怎么用。</b>在导航栏选「画传」，页面中部即内嵌预览，可直接滚动阅读；" +
        "需满幅观看时，点「在新窗口打开画册」或「全屏预览」。预览若未载入，按提示直接打开画册文件，" +
        "阅读不受影响。</p>" +

        "<h3>概念关系图</h3>" +
        "<p><b>是什么。</b>以词条为节点、以关系为连线构成的有向图。两词之间连一条线，" +
        "表示前者在某一意义上通向后者，箭头所指为方向。全站 " + relCount() + " 条连线，归为六类：" +
        "前提、展开、引出、对立、当代对应、共现；关联强度依次由硬到松，" +
        "共现最松，只表明两个概念常在一处出现。</p>" +
        "<p><b>有什么用。</b>一看结构：哪几个概念处于枢纽，哪几支较为边缘。" +
        "二看推导：顺前提与展开的链条，可见一个复杂概念由哪些基础概念逐层生成。" +
        "三看分歧：标为对立者，提示两概念在同一问题上规定相反，是辨析与写作的入手处。</p>" +
        "<p><b>怎么呈现。</b>节点大小表示关联多寡，颜色表示所属知识板块；连线带方向与类型，" +
        "粗细对应关联强度。画布可拖动、可缩放，可一键自动布局；左侧检索按词条名、别名或拼音定位，" +
        "选中即把该概念及其直接关联一并铺到画布。图可改名分色、可改关系类型与强度，" +
        "亦可导出为图片或图文件。</p>" +
        "<p><b>怎么用。</b>在导航栏选「关系图」，或自词条页点入；检索并选中一个概念，" +
        "其直接关联随即显形；点节点进词条。讲一条推导链时，从基础概念起逐个聚焦，链条自然连成。" +
        "需要留存时导出图片，需要继续编辑时导出图文件，下次导入接着改。</p>" +
        '<p class="man-edge"><b>一处边界。</b>图上的路径与联想，反映编者对这些概念先后与从属的排布，' +
        "不是原著逐句写明的推导次序，也无逐句页码依据。理清思路、组织讲授可行，作引文依据则不可。</p>") +

      manualSec("man-3", "三", "十五件工具",
        '<p class="man-sub">工具台按用途分四组，与下列四组一致。每件均在本机运行，输入的内容不上传。</p>' +
        toolBody);
  }

  /* 手册页的 after 钩子：只做一件事 —— 打开页面时把滚动位置复位。
     目录跳转走 data-act="jump"（站里已有的那一套），不重画页面、也不改 hash。 */
  function manualAfter() { window.scrollTo(0, 0); }

  function viewGraph() {
    return '<p class="crumb"><a href="#/">首页</a> / 关系图</p>' +
      '<h1 class="page-title">概念关系图</h1>' +
      '<p class="note">全站 <b>' + TERMS.length + "</b> 条词条、<b>" + relCount() + "</b> 条关系" +
      "画在同一张图上：<b>节点越大表示关联越多</b>，颜色是它所属的知识板块，" +
      "点节点可以直接进词条。左侧「站内检索」按词条名、别名或拼音找概念，" +
      "选中即可把<b>它和它的直接关联</b>一并铺到画布上；画布可拖动、可缩放、可一键自动布局，" +
      "也能改名分色、改关系类型与强度，最后导出 JSON 或图片带走。" +
      "这张图的编辑结果只存在本机浏览器里。</p>" +
      '<div class="graph-page">' + pathflowEmbed("概念关系图与编辑器（React Flow）") + "</div>" +
      '<p class="pth-note">关系数据取自站内词条表——前提／展开／引出／对立／当代对应／共现六种，' +
      "每种各有默认的关联强度（前提最硬，共现最松）。图上的路径与联想反映的是" +
      "<b>编者给这些概念排的先后与从属</b>，不是原著里逐句写明的推导次序，也没有逐句页码依据：" +
      "拿它理清思路可以，当引文不行。</p>";
  }

  /* 导出 SVG 网络图为 PNG：克隆 SVG → 补 xmlns 与内联样式（页面样式在
     外部样式表里，序列化后不带过去）→ data URL 进 Image → canvas 2 倍
     尺寸绘制 → 下载。全程本机完成，不联网、不引库，file:// 可用。
     v43 起唯一消费者是「文本分析」的聚类网络图（关系图已迁到 pathflow.html，
     那里的导出见 pathflow/src/lib/figure.ts）。 */
  function exportGraphPng(svgEl, fname, extraCss) {
    if (!svgEl) return;
    var vb = (svgEl.getAttribute("viewBox") || "0 0 1000 700").split(/\s+/).map(Number);
    var clone = svgEl.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    var st = document.createElementNS("http://www.w3.org/2000/svg", "style");
    /* 克隆出来的 SVG 带不走外部样式表，所以凡是被 CSS 而不是呈现属性决定的样式，
       都得在这里再写一遍。文本分析的聚类网络图把颜色、粗细、字号全写在元素属性上，
       故这份基础样式是空的（调用方要补什么，走 extraCss）。 */
    st.textContent = extraCss || "";
    clone.insertBefore(st, clone.firstChild);
    var bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("x", "0"); bg.setAttribute("y", "0");
    bg.setAttribute("width", vb[2]); bg.setAttribute("height", vb[3]);
    bg.setAttribute("fill", "#fdfcfa");
    clone.insertBefore(bg, clone.firstChild);

    var xml = new XMLSerializer().serializeToString(clone);
    var img = new Image();
    img.onload = function () {
      var c = document.createElement("canvas");
      c.width = Math.round(vb[2] * 2); c.height = Math.round(vb[3] * 2);   // 2 倍采样，打印也清晰
      var ctx = c.getContext("2d");
      ctx.fillStyle = "#fdfcfa";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      try {
        var a = document.createElement("a");
        a.download = fname || "概念关系图.png";
        a.href = c.toDataURL("image/png");
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } catch (e) {
        window.alert("导出失败：" + ((e && e.message) || e));
      }
    };
    img.onerror = function () { window.alert("导出失败：浏览器拒绝渲染这张 SVG。"); };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
  }

  /* ============================================================
     本地阅读器（#reader）：支持 TXT / PDF / EPUB 上传阅读。
     设计约束：离线单文件必须可用，因此不依赖外部 CDN。
       - TXT：FileReader 直接读文本。
       - PDF：用 <iframe> + Blob URL 调用浏览器内置 PDF 阅读器。
       - EPUB：ZIP 格式，内联一个轻量 Central Directory 解析器，
               用浏览器原生 DecompressionStream 解压 deflate，
               把 XHTML 去标签后作为纯文本阅读。
     文件内容不上传、不持久化；只在本机记下最近打开的文件名。
     ============================================================ */
  var READER = { file: null, type: "", name: "", chapters: [], idx: 0, theme: "light", size: 18, mode: "scroll" };
  var READER_KEY = "capital-dict-reader-v1";

  function readerHistory() {
    try { return JSON.parse(localStorage.getItem(READER_KEY) || "[]"); } catch (e) { return []; }
  }
  function readerSaveMeta(name, type) {
    var list = readerHistory().filter(function (x) { return x.name !== name; });
    list.unshift({ name: name, type: type, at: Date.now() });
    try { localStorage.setItem(READER_KEY, JSON.stringify(list.slice(0, 8))); } catch (e) { /* 空间满则放弃 */ }
  }
  function readerClearHistory() {
    if (window.confirm("清空阅读器历史记录？")) localStorage.removeItem(READER_KEY);
    readerRenderLanding();
  }

  /* ============================================================
     阅读器书签与阅读记录（v58）
     ------------------------------------------------------------
     两份数据，两个存储键，与 readerHistory 同 scheme（capital-dict-*）：

       RD_BM_KEY  书签数组。每条 { id, book, type, ci, ct, pct, title, at }
                   book=文件名（分组键，也是断点续读的匹配键）、ci=章节下标、
                   ct=章节标题、pct=该章进度 0–100、title=用户起的名字。
       RD_RC_KEY  阅读记录，键为文件名，值 { book, type, ci, ct, pg, pct, at, ms }
                   pg=页码（翻页模式下的 PG.i+1；滚动模式为 0）、
                   pct=全书进度 0–100、at=最近阅读时刻、ms=累计阅读毫秒。

     为什么续读键用「文件名」而不是 File 对象：文件内容一律不落盘（见本节
     开头约束），重新打开只能由用户再选一次文件；文件名＋类型是唯一稳定的
     跨会话标识。改名后书签与记录都不会命中，属预期，不做模糊匹配。

     写入策略：一律 try/catch 包住。隐私模式/配额满时静默降级为「本次会话内
     有效」，与 CM_INFO、CT、WT 的既有做法一致；读取端永远给回退形状，
     不让旧数据或坏 JSON 把渲染打挂。
     ============================================================ */
  var RD_BM_KEY = "capital-dict-reader-bm-v1";
  var RD_RC_KEY = "capital-dict-reader-rc-v1";
  var RD_BM_MAX = 300;          // 书签上限，超出丢最旧的
  var RD_RC_MAX = 24;           // 阅读记录保留的本数（近 8 条历史之外再多留些）

  /* 读书档的键：文件名 + 扩展名。同一本书换了格式算另一本。 */
  function rdBookKey(name, type) { return (type || "?") + " " + (name || ""); }
  function rdCurrentKey() { return rdBookKey(READER.name, READER.type); }

  function rdLoad(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return (v === null || v === undefined) ? fallback : v;
    } catch (e) { return fallback; }
  }
  function rdStore(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { return false; }         // 配额满/隐私模式：本次会话内仍可用
  }

  /* —— 书签 —— */

  /* 读取并逐条清洗。坏数据（缺字段/类型不对）就地剔除而不是整份丢弃，
     免得一条脏记录让读者丢掉全部书签。 */
  function rdBookmarks() {
    var a = rdLoad(RD_BM_KEY, []);
    if (!Array.isArray(a)) return [];
    return a.filter(function (x) {
      return x && typeof x === "object" && typeof x.book === "string" && x.book &&
        typeof x.ci === "number" && isFinite(x.ci);
    }).map(function (x) {
      return {
        id: String(x.id || (x.book + ":" + x.ci + ":" + (x.at || 0))),
        book: x.book, type: x.type || "", ci: x.ci,
        ct: typeof x.ct === "string" ? x.ct : "",
        pct: rdClampPct(x.pct),
        title: typeof x.title === "string" ? x.title : "",
        at: typeof x.at === "number" ? x.at : 0
      };
    });
  }

  function rdClampPct(v) {
    var n = typeof v === "number" && isFinite(v) ? v : parseFloat(v);
    if (!isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function rdBmWrite(list) {
    /* 同毫秒内连加两条时 at 会相等。Array.prototype.sort 是**稳定**排序，
       所以入参只要已经是「新在前」的顺序（rdBmAdd 用 unshift 把新条插到头），
       等值时新的自然排在前面，砍尾才砍得对。
       ⚠ 两处踩过的坑：
         ① 第一版写 concat（新的排最后）⇒ 同毫秒的两条里新的反被上限砍掉
            （实测 320 条里留下的最新是 b318 而非 b319）。
         ② 改 unshift 时写成 rdBmWrite(list.unshift(it)) ⇒ unshift 返回的是
            **新长度（数字）**，不是数组，于是 rdBmWrite 里 list.sort 直接炸。
            正确写法是分两步：list.unshift(it); rdBmWrite(list)。 */
    list.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });   // 新在前
    if (list.length > RD_BM_MAX) list = list.slice(0, RD_BM_MAX);
    rdStore(RD_BM_KEY, list);
    return list;
  }

  /* 在当前章节的当前进度处加书签。返回新条目；重复位置允许并存
     （读者可能想在同一处留两条不同备注），不做过载去重。 */
  function rdBmAdd(opt) {
    var o = opt || {};
    var p = rdProbe();
    var it = {
      id: "bm" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
      book: o.book != null ? o.book : READER.name,
      type: o.type != null ? o.type : READER.type,
      ci: o.ci != null ? o.ci : p.ci,
      ct: o.ct != null ? o.ct : p.ct,
      pct: rdClampPct(o.pct != null ? o.pct : p.pct),
      title: (o.title || "").slice(0, 60),
      at: Date.now()
    };
    if (!it.book) return null;                // 没有书名＝没打开文件，不落库
    var list = rdBookmarks();
    list.unshift(it);                         // 新条在前（见 rdBmWrite 注释）
    rdBmWrite(list);
    return it;
  }

  /* 改名。返回 true 表示确实改到了；id 不存在（别处删过、或换了浏览器会话）
     时返回 false，调用方据此提示「这条书签已经不在了」。 */
  function rdBmRename(id, title) {
    var list = rdBookmarks(), hit = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id !== id) continue;
        list[i].title = String(title == null ? "" : title).slice(0, 60);
        list[i].at = Date.now();              // 改名也算一次「最近动过」
        hit = true; break;
    }
    if (!hit) return false;
    rdBmWrite(list);
    return true;
  }

  function rdBmDel(id) {
    var list = rdBookmarks(), out = [], hit = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) { hit = true; continue; }
      out.push(list[i]);
    }
    if (!hit) return false;
    rdBmWrite(out);
    return true;
  }

  /* 按书分组，书名内部再按位置先后排。返回 [{book,type,items:[…]}]，
     组内按 ci 升序、同章按 pct 升序——阅读是线性的，列表也该线性。

     组间排序：**正在读的那本排最前**，其余按最近动过的时刻倒序。
     ⚠ 第一版只按 at 倒序，结果「最近加了一条别本书的书签」就会把
     当前这本书的组挤到第二位去——读者明明在读它，却要先翻一下才看见。 */
  function rdBmGroups() {
    var map = {}, order = [];
    rdBookmarks().forEach(function (b) {
      if (!map[b.book]) { map[b.book] = { book: b.book, type: b.type, items: [], at: 0 }; order.push(b.book); }
      map[b.book].items.push(b);
      if (b.at > map[b.book].at) map[b.book].at = b.at;
    });
    var cur = READER.name;
    order.sort(function (x, y) {
      if (x === cur) return -1;
      if (y === cur) return 1;
      return (map[y].at || 0) - (map[x].at || 0);
    });
    return order.map(function (k) {
      var g = map[k];
      g.items.sort(function (x, y) { return x.ci - y.ci || x.pct - y.pct; });
      return g;
    });
  }

  /* —— 阅读记录 —— */

  function rdRecords() {
    var o = rdLoad(RD_RC_KEY, {});
    if (!o || typeof o !== "object" || Array.isArray(o)) return {};
    var out = {};
    Object.keys(o).forEach(function (k) {
      var r = o[k];
      if (!r || typeof r !== "object" || !r.book) return;         // 坏条目丢弃
      out[k] = {
        book: r.book, type: r.type || "",
        ci: typeof r.ci === "number" && isFinite(r.ci) ? r.ci : 0,
        ct: typeof r.ct === "string" ? r.ct : "",
        pg: typeof r.pg === "number" && isFinite(r.pg) ? r.pg : 0,
        pct: rdClampPct(r.pct),
        at: typeof r.at === "number" ? r.at : 0,
        ms: typeof r.ms === "number" && isFinite(r.ms) && r.ms > 0 ? r.ms : 0
      };
    });
    return out;
  }

  function rdRecGet(book) {
    var o = rdRecords();
    return o[rdBookKey(book.name, book.type)] || o[book.key] || null;
  }

  function rdRecWrite(o) {
    var all = rdRecords();
    all[rdBookKey(o.book, o.type)] = {
      book: o.book, type: o.type,
      ci: o.ci | 0, ct: o.ct || "",
      pg: o.pg > 0 ? o.pg | 0 : 0,
      pct: rdClampPct(o.pct),
      at: o.at || Date.now(),
      ms: o.ms > 0 ? Math.round(o.ms) : 0
    };
    /* 只留最近的 N 本：按 at 倒序砍尾。at 相同（同一毫秒打开两本）时用书名
       兜底排序，保证结果稳定、不受对象键序影响。 */
    var ks = Object.keys(all);
    if (ks.length > RD_RC_MAX) {
      ks.sort(function (a, b) {
        var d = (all[b].at || 0) - (all[a].at || 0);
        return d || (a < b ? -1 : a > b ? 1 : 0);
      });
      ks.slice(RD_RC_MAX).forEach(function (k) { delete all[k]; });
    }
    rdStore(RD_RC_KEY, all);
    return all;
  }

  /* 进度列表：按最近阅读倒序。首页「继续阅读」用。 */
  function rdRecList() {
    var all = rdRecords();
    return Object.keys(all).map(function (k) { return all[k]; })
      .sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
  }

  function rdRecDel(key) {
    var all = rdRecords();
    if (!(key in all)) return false;
    delete all[key];
    rdStore(RD_RC_KEY, all);
    return true;
  }
  function rdRecClear() { rdStore(RD_RC_KEY, {}); }

  /* 时长格式化：不足 1 分钟说「不到 1 分钟」，避免给一个假的 0 秒。 */
  function rdFmtDur(ms) {
    ms = Math.max(0, Math.round((ms || 0) / 1000));
    if (ms < 60) return ms + " 秒";
    var m = Math.floor(ms / 60), h = Math.floor(m / 60);
    if (h < 1) return m + " 分钟";
    return h + " 小时" + (m % 60 ? " " + (m % 60) + " 分" : "");
  }
  function rdFmtAgo(ts) {
    if (!ts) return "时间未知";
    var d = Date.now() - ts;
    if (d < 0) d = 0;
    if (d < 60000) return "刚刚";
    if (d < 3600000) return Math.floor(d / 60000) + " 分钟前";
    if (d < 86400000) return Math.floor(d / 3600000) + " 小时前";
    if (d < 86400000 * 30) return Math.floor(d / 86400000) + " 天前";
    var dt = new Date(ts);
    return dt.getFullYear() + "-" + pad2(dt.getMonth() + 1) + "-" + pad2(dt.getDate());
  }

  /* —— 进度探针：当前读到哪儿了 ——
     翻页模式读 PG.i/PG.n；滚动模式读 scrollTop 比例。两者都换算成
     全书进度 pct = (章节序号 + 章内比例) / 章数 × 100，这样两种模式可比较，
     首页列表里显示的百分比含义也一致。
     PDF 走浏览器内置阅读器，页面拿不到它的页码与滚动位置 ⇒ pct 记 0，
     记录仍会写（书名与时间可追），但不谎报进度。 */
  function rdProbe() {
    var chapters = READER.chapters || [];
    var ci = Math.max(0, Math.min(chapters.length - 1, READER.idx | 0));
    var n = chapters.length || 1;
    var within = 0, pg = 0;
    if (READER.type !== "pdf" && READER.mode === "page" && PG.n > 1) {
      pg = PG.i + 1;
      within = PG.i / (PG.n - 1);
    } else if (READER.type !== "pdf") {
      var c = document.getElementById("rd-content");
      if (c) {
        var room = c.scrollHeight - c.clientHeight;
        within = room > 4 ? Math.max(0, Math.min(1, c.scrollTop / room)) : 0;
      }
    }
    return {
      ci: ci, ct: (chapters[ci] || {}).title || "",
      pg: pg, within: within,
      pct: READER.type === "pdf" ? 0 : Math.round(((ci + within) / n) * 100)
    };
  }

  /* 累计阅读时长：只在「阅读器正开着文件 + 页面可见」时计。
     页面隐藏（切走去写论文）的那截不计，否则时长会虚高。
     每 20 秒落一次盘（localStorage 同步写，不能太密），离开/关闭时
     由 rdTimeStop 强制结算一次。

     ⚠ 这里踩过一个很隐蔽的坑：rdTimeStop 里若先把 now 取好、再把
       rdLastTick 清 0，最后又去读 `now - rdLastTick`，那算出来的是
       「现在 − 0」＝ 一个天文数字（实测 ms 记成 1.79e12）。
     正确写法：先按门槛决定是否计入，再把 rdLastTick 清 0，且 now 只取一次。 */
  var rdTimer = null, rdLastTick = 0, rdScrollT = null;

  /* 把「上一次落盘时刻 → 现在」这一截结算进记录。
     返回是否真的结算了（不足 2 秒的抖动不记）。 */
  function rdTimeSettle() {
    if (!rdLastTick) return false;
    var dt = Date.now() - rdLastTick;
    rdLastTick = 0;                      // 先清，避免下面的异常路径重复结算
    if (dt < 2000) return false;         // 抖动不记
    var r = rdRecGet({ name: READER.name, type: READER.type });
    if (!r) return false;
    rdRecWrite({
      book: r.book, type: r.type, ci: r.ci, ct: r.ct, pg: r.pg, pct: r.pct,
      at: r.at, ms: r.ms + dt
    });
    return true;
  }

  function rdTimeStart() {
    if (rdTimer) clearInterval(rdTimer);
    rdLastTick = Date.now();
    rdTimer = setInterval(function () {
      if (document.hidden) { rdTimeSettle(); rdLastTick = Date.now(); return; }
      rdTimeSettle();
      rdLastTick = Date.now();           // 下一截从现在开始算
    }, 20000);
  }

  function rdTimeStop() {
    if (rdTimer) { clearInterval(rdTimer); rdTimer = null; }
    rdTimeSettle();
  }

  /* 记一次进度（章节/页码/百分比）。滚动与翻页都会调，节流由调用方负责。 */
  function rdRecTouch() {
    if (!READER.name) return null;
    var p = rdProbe();
    var r = rdRecGet({ name: READER.name, type: READER.type });
    rdRecWrite({
      book: READER.name, type: READER.type,
      ci: p.ci, ct: p.ct, pg: p.pg, pct: p.pct,
      at: Date.now(),
      ms: r ? r.ms : 0
    });
    return p;
  }

  /* 记住「下一次打开这本书时要回到哪」。由首页「继续读」设置。 */
  function rdResumePending(book, type) {
    RD.resume = { book: book, type: type };
  }

  /* 断点续读。两段式，因为渲染顺序摆在那里：
       ① rdResumeChapter() 在 readerRenderViewer() **之前**把章号拨回去
          ——晚一步，viewer 已经按第 0 章画完了；
       ② rdResumeScroll() 在布局落定之后（rAF）把章内比例落到滚动位置或页码。
     章号可能超出范围（同名文件换了内容、章节数变少）——夹到合法区间，
     拿不到有效记录就从头读，绝不抛错。 */
  function rdResumeChapter() {
    var r = RD.resume;
    if (!r || !r.book) return null;
    if (rdBookKey(READER.name, READER.type) !== rdBookKey(r.book, r.type)) return null;
    RD.resume = null;
    var rec = rdRecGet({ name: r.book, type: r.type });
    if (!rec) return null;                       // 记录已被清空：静默从头读
    var n = (READER.chapters || []).length;
    if (!n) return null;
    READER.idx = Math.max(0, Math.min(n - 1, rec.ci | 0));
    RD.resumeRec = rec;
    return rec;
  }

  function rdResumeScroll() {
    var rec = RD.resumeRec;
    if (!rec) return false;
    RD.resumeRec = null;
    var n = (READER.chapters || []).length || 1;
    var within = Math.max(0, Math.min(1, rec.pct / 100 * n - READER.idx));   // 章内比例 0–1
    requestAnimationFrame(function () {
      if (READER.mode === "page") {
        if (PG.n > 1) { PG.i = Math.round(within * (PG.n - 1)); readerPgPaint(false); }
      } else {
        var c = document.getElementById("rd-content");
        if (c) {
          var room = c.scrollHeight - c.clientHeight;
          if (room > 0) c.scrollTop = within * room;
        }
      }
      rdRecTouch();
    });
    return true;
  }

  var RD = { resume: null, resumeRec: null, bmOpen: false };

  /* ——— 书签面板的界面 ——— */

  /* 书签行：名字可点（跳转）、改名、删除。位置摘要写清「哪一章 · 多少 %」，
     免得只看到一个名字不知道跳去哪。 */
  function rdBmRow(b, cur) {
    var here = cur && cur.book === b.book;
    var at = here && cur.ci === b.ci;
    return '<li class="rd-bm-i' + (at ? " on" : "") + '" data-bm="' + esc(b.id) + '">' +
      '<button type="button" class="rd-bm-go" data-rd="bm-go" title="跳到这一处">' +
        '<b>' + esc(b.title || ("第 " + (b.ci + 1) + " 章 · " + b.pct + "%")) + '</b>' +
        '<i>' + esc(b.ct || "第 " + (b.ci + 1) + " 章") + ' · ' + b.pct + '%</i>' +
      '</button>' +
      '<span class="rd-bm-acts">' +
        '<button type="button" class="rd-bm-mini" data-rd="bm-ren" title="改名">改名</button>' +
        '<button type="button" class="rd-bm-mini" data-rd="bm-del" title="删除">删除</button>' +
      '</span></li>';
  }

  /* 书签抽屉：按书分组，当前所在章节那条高亮。抽屉挂在 .rd-viewer 里，
     与选中即查浮标同理——挂 body 上会在全屏时整只消失。 */
  function rdBmPanelHTML() {
    var groups = rdBmGroups();
    var cur = READER.name ? { book: READER.name, ci: READER.idx | 0 } : null;
    if (!groups.length) {
      return '<div class="rd-bm" id="rd-bm-panel"><div class="rd-bm-head">' +
        '<b>书签</b><button type="button" class="rd-bm-x" data-rd="bm-close" aria-label="关闭书签面板">✕</button></div>' +
        '<p class="rd-bm-empty">还没有书签。读到关键处，点顶栏的「书签」记一笔；' +
        '书签会连同书名、章节与位置一起留在本机。</p></div>';
    }
    var body = groups.map(function (g) {
      var open = READER.name === g.book;      // 当前这本书的组默认展开
      return '<details class="rd-bm-g"' + (open ? " open" : "") + '>' +
        '<summary><b title="' + esc(g.book) + '">' + esc(g.book) + '</b>' +
        '<span class="rd-bm-n">' + g.items.length + '</span></summary>' +
        '<ul>' + g.items.map(function (b) { return rdBmRow(b, cur); }).join("") + '</ul>' +
        '</details>';
    }).join("");
    return '<div class="rd-bm" id="rd-bm-panel"><div class="rd-bm-head">' +
      '<b>书签</b><button type="button" class="rd-bm-x" data-rd="bm-close" aria-label="关闭书签面板">✕</button></div>' +
      '<div class="rd-bm-list">' + body + '</div></div>';
  }

  /* 抽屉的开合状态存在 RD.bmOpen，而不是只放在 .rd-viewer 的 class 上：
     readerRenderViewer() 会把 host.innerHTML 整个换掉，class 随之消失，
     一翻章抽屉就自己关上了。 */
  function rdBmSetOpen(on) {
    RD.bmOpen = !!on;
    var v = document.querySelector(".rd-viewer");
    if (v) v.classList.toggle("bm-open", RD.bmOpen);
    rdBmPanelSync();
  }

  function rdBmPanelSync() {
    var v = document.querySelector(".rd-viewer");
    if (!v) return;
    if (RD.bmOpen) v.classList.add("bm-open");
    var old = v.querySelector(".rd-bm");
    if (!RD.bmOpen) { if (old) old.remove(); return; }
    var tmp = document.createElement("div");
    tmp.innerHTML = rdBmPanelHTML();
    var fresh = tmp.firstChild;
    if (old) old.replaceWith(fresh); else v.appendChild(fresh);
  }

  /* 改完名字弹输入框。用 prompt 是最省事的，但 prompt 在部分环境被禁用、
     且无法给初值与长度上限提示，这里自建一个贴着面板的小表单。

     ⚠ 定位条目**不要用属性选择器拼 id**（`.rd-bm-i[data-bm="…"]`）：
       id 里带 `-` 与 base36 字符尚可，但一旦混入引号就得做 CSS 转义，
       转义写错（少一个反斜杠）是选择器语法错误，querySelector 直接抛
       SyntaxError——而这个函数的调用场景恰恰是「书签可能已经不在了」，
       在那里抛异常最不合适。改由调用方直接把行元素传进来。 */
  function rdBmPrompt(id, cur, item) {
    item = item || document.querySelector(".rd-bm-i");
    if (!item || item.getAttribute("data-bm") !== id) {
      rdToast("这条书签已经不在了（可能已在另一处删除）。");
      rdBmPanelSync();
      return;
    }
    if (item.querySelector(".rd-bm-form")) return;                 // 已在编辑，别叠第二个
    var form = document.createElement("form");
    form.className = "rd-bm-form";
    form.innerHTML = '<input type="text" maxlength="60" aria-label="书签名称" value="' +
      esc(cur || "") + '">' +
      '<button type="submit" class="rd-bm-mini">保存</button>' +
      '<button type="button" class="rd-bm-mini" data-rd="bm-cancel">取消</button>';
    item.appendChild(form);
    var inp = form.querySelector("input");
    inp.focus();
    if (inp.select) inp.select();
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      rdBmRename(id, inp.value.trim());
      rdBmPanelSync();
      rdToast("书签已改名。");
    });
    form.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest('[data-rd="bm-cancel"]') : null;
      if (b) { e.preventDefault(); rdBmPanelSync(); }
    });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); rdBmPanelSync(); }
    });
  }

  /* 跳到书签：书名对不上（书签属于另一本、或文件已关）时不硬跳，
     明确告诉读者「先打开那本书」。 */
  function rdBmGo(id) {
    var b = null, list = rdBookmarks();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) { b = list[i]; break; }
    if (!b) { rdToast("这条书签已经不在了（可能已在另一处删除）。"); rdBmPanelSync(); return; }
    if (rdBookKey(b.book, b.type) !== rdCurrentKey()) {
      rdToast("「" + b.book + "」还没打开——先在阅读器里选中这份文件，再点这条书签。");
      return;
    }
    READER.idx = Math.max(0, Math.min((READER.chapters || []).length - 1, b.ci | 0));
    readerRenderViewer();
    var n = (READER.chapters || []).length || 1;
    var within = Math.max(0, Math.min(1, b.pct / 100 * n - READER.idx));
    requestAnimationFrame(function () {
      if (READER.mode === "page") {
        if (PG.n > 1) { PG.i = Math.round(within * (PG.n - 1)); readerPgPaint(false); }
      } else {
        var c = document.getElementById("rd-content");
        if (c) {
          var room = c.scrollHeight - c.clientHeight;
          if (room > 0) c.scrollTop = within * room;
        }
      }
      rdRecTouch();
    });
    rdToast("已跳到：" + (b.ct || ("第 " + (b.ci + 1) + " 章")) + " · " + b.pct + "%");
  }

  /* 轻提示：复用 body 上的单例，和写作台那枚同构但独立，互不干扰。 */
  function rdToast(msg) {
    var el = document.getElementById("rd-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "rd-toast";
      el.className = "wt-toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("on");
    if (rdToast._t) clearTimeout(rdToast._t);
    rdToast._t = setTimeout(function () { el.classList.remove("on"); }, 3200);
  }

  function viewReader() {
    return '<p class="crumb"><a href="#/">首页</a> / 阅读器</p>' +
      '<h1 class="page-title">本地阅读器</h1>' +
      '<p class="note">上传你电脑上的 PDF、EPUB 或 TXT 文件，在本页直接阅读。' +
      '文件不会上传服务器，只在浏览器本地打开。</p>' +
      '<p class="rd-feat"><b>书签</b>：读到关键处点顶栏「书签+」记一笔，可改名、删除、跳转，' +
      '按书分组列出，当前所在章节的那条会高亮。' +
      '<b>阅读进度</b>：自动记住每本书读到第几章、百分之多少与累计时长，' +
      '下次选中<b>同一份文件</b>即自动回到上次的位置。</p>' +
      '<div id="reader-host"></div>';
  }

  /* 术语索引：词条名与别名都指向 id，供阅读器「选中即查」用。
     只在首次进入阅读器时建一次，之后复用。 */
  var RD_IDX = null;
  function readerBuildIdx() {
    if (RD_IDX) return RD_IDX;
    RD_IDX = {};
    TERMS.forEach(function (t) {
      if (t.term && !RD_IDX[t.term]) RD_IDX[t.term] = t.id;
      (t.alias || []).forEach(function (a) { if (a && !RD_IDX[a]) RD_IDX[a] = t.id; });
    });
    return RD_IDX;
  }

  /* 收掉「选中即查」浮标。route() 换页、滚动、重新选择都要收。 */
  function readerDropLookup() {
    var old = document.querySelector(".rd-lookup");
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }

  /* 搜索关联：选中词没有精确命中时，按「包含」关系找候选术语——
     ① 术语包含选中词（选中「剩余价值」→「剩余价值率」）；② 选中词包含术语
     （选中「劳动力商品的价值形式」→「劳动力商品」）；③ 别名同法。
     返回最多 5 条，分数高在前、短术语在前（短词更像被选中的核心）。 */
  function readerSearchTerms(key) {
    var k = key.replace(/\s+/g, "");
    if (!k || k.length < 2 || k.length > 24) return [];
    var isPy = /^[a-z]+$/i.test(k);
    var kl = k.toLowerCase();
    var out = [];
    TERMS.forEach(function (t) {
      var s = 0;
      if (isPy) {
        /* 拼音与首字母缩写也算关联：全拼比对去空格拼音，缩写比对首字母 */
        var py = (t.pinyin || "").replace(/\s+/g, "").toLowerCase();
        var ini = (t.pinyin || "").split(/\s+/).map(function (x) { return x.charAt(0); }).join("");
        if (py === kl || ini === kl) s = 3;
        else if (py.indexOf(kl) > -1 || (kl.length >= 3 && ini.indexOf(kl) > -1)) s = 1;
      } else if (t.term.indexOf(k) > -1) s = 3;
      else if (t.term.length >= 2 && k.indexOf(t.term) > -1) s = 2;
      if (!s && !isPy) {
        var aliasHit = (t.alias || []).some(function (a) {
          return a.length >= 2 && (a.indexOf(k) > -1 || k.indexOf(a) > -1);
        });
        if (aliasHit) s = 1;
      }
      if (s) out.push({ t: t, s: s });
    });
    out.sort(function (a, b) {
      if (a.s !== b.s) return b.s - a.s;
      /* 同分时的贴近度：选中词包含术语（s=2）→ 越长的术语越具体、越贴近选中；
         术语包含选中词（s=3）→ 越短的术语越贴近选中 */
      var d = b.t.term.length - a.t.term.length;
      return a.s === 2 ? d : -d;
    });
    return out.slice(0, 5).map(function (x) { return x.t; });
  }

  function readerLkBtn(t, cls) {
    return '<button type="button" class="rd-lk-btn ' + (cls || "") + '" data-lk="' + esc(t.id) + '">' +
      '<span class="rd-lk-ico">📖</span><b>' + esc(t.term) + "</b>" +
      (t.oneline ? '<i>' + esc(t.oneline.slice(0, 28)) + (t.oneline.length > 28 ? "…" : "") + "</i>" : "") +
      "</button>";
  }

  /* 选中词条：命中词条名或别名时，在选区上方浮出「查看词条」按钮；
     没正好命中时用搜索关联给出候选列表。 */
  function readerLookup() {
    var sel = window.getSelection && window.getSelection();
    readerDropLookup();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    var raw = (sel.toString() || "").trim();
    if (!raw || raw.length > 24) return;
    var idx = readerBuildIdx();
    // 先原文查，再去掉首尾标点查一遍（选中常带「，」「。」）
    var key = raw.replace(/^[「『"'（(《]+|[」』"'）)》],，。；;：:!！?？]+$/g, "").trim();
    var id = idx[raw] || idx[key] || idx[key.replace(/\s+/g, "")];
    var t = id ? BY_ID[id] : null;
    var cands = readerSearchTerms(key).filter(function (x) { return !t || x.id !== t.id; });
    if (!t && !cands.length) return;

    var range = sel.getRangeAt(0);
    var r = range.getBoundingClientRect();
    if (!r || (!r.width && !r.height)) return;

    var box = document.createElement("div");
    box.className = "rd-lookup";
    if (t) {
      // 精确命中：主按钮 + 最多 3 个相关词条
      box.innerHTML = readerLkBtn(t) +
        (cands.length ? '<div class="rd-lk-rel">' +
          '<span>相关：</span>' +
          cands.slice(0, 3).map(function (x) { return readerLkBtn(x, "rd-lk-mini"); }).join("") +
          "</div>" : "");
    } else {
      box.innerHTML = '<div class="rd-lk-list"><p class="rd-lk-h">没有正好叫「' + esc(key) +
        "」的词条，看看这些相关的：</p>" +
        cands.map(function (x) { return readerLkBtn(x, "rd-lk-sm"); }).join("") + "</div>";
    }
    /* 挂载点有讲究：全屏阅读时浏览器只渲染 .rd-viewer 这棵子树，
       浮标挂在 body 上会整只消失（全屏选词失效的真凶）。
       fixed 定位不受挂载点影响，挂进 viewer 后坐标照用。 */
    (document.querySelector(".rd-viewer") || document.body).appendChild(box);
    // 按选区位置定位，贴在上方；靠边时自动收进来
    var bw = box.offsetWidth || 240;
    var left = r.left + r.width / 2 - bw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));
    var top = r.top - box.offsetHeight - 8;
    if (top < 8) top = r.bottom + 8;
    box.style.left = left + "px";
    box.style.top = top + "px";

    // 按下不夺走选区（否则 click 前选区已清空，拿不到上下文）
    box.querySelectorAll(".rd-lk-btn").forEach(function (btn) {
      btn.addEventListener("mousedown", function (e) { e.preventDefault(); });
      btn.addEventListener("click", function () {
        readerDropLookup();
        /* 全屏阅读时不走路由：#/t/... 会把 #reader-host 整个重建，
           全屏元素随之离开文档树，浏览器立刻退出全屏。
           改在 .rd-viewer 子树里弹词条悬浮窗，全屏原样保留。 */
        var fe = document.fullscreenElement;
        if (fe && fe.classList && fe.classList.contains("rd-viewer")) {
          readerTermModal(btn.getAttribute("data-lk"));
        } else {
          location.hash = "#/t/" + btn.getAttribute("data-lk");
        }
      });
    });
  }

  /* —— 全屏阅读的词条悬浮窗（v8）——
     viewTerm 的产物直接填进窗体，工具条/引文复制靠 #view 上的委托照常工作；
     窗内「关联词条」互链不跳路由，就地换内容继续看；其余链接收窗放行。 */
  function readerTermModal(id) {
    var v = document.querySelector(".rd-viewer");
    if (!v) return;
    var t = BY_ID[id];
    var box = v.querySelector(".rd-tmodal");
    if (!box) {
      box = document.createElement("div");
      box.className = "rd-tmodal";
      box.innerHTML = '<div class="rd-tm-card" role="dialog" aria-modal="true">' +
        '<div class="rd-tm-head"><span class="rd-tm-cap">📖 词条</span>' +
        '<button type="button" class="rd-tm-x" aria-label="关闭词条悬浮窗">✕</button></div>' +
        '<div class="rd-tm-body"></div></div>';
      v.appendChild(box);
      box.addEventListener("mousedown", function (e) {
        if (e.target === box) readerTermModalClose();   // 点遮罩收窗
      });
      var xb = box.querySelector(".rd-tm-x");
      xb.addEventListener("mousedown", function (e) { e.preventDefault(); });
      xb.addEventListener("click", readerTermModalClose);
      box.addEventListener("click", function (e) {
        var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
        if (!a) return;
        var m = (a.getAttribute("href") || "").match(/^#\/t\/(.+)$/);
        if (m) { e.preventDefault(); readerTermModal(m[1]); }
        else readerTermModalClose();    // 去首页/门类等别的页：收窗让路由接管
      });
    }
    box.querySelector(".rd-tm-body").innerHTML = viewTerm(id);
    var crumb = box.querySelector(".rd-tm-body .crumb");
    if (crumb) crumb.remove();   // 悬浮窗没有「首页 / …」的层级语境，面包屑去掉
    var body = box.querySelector(".rd-tm-body");
    body.scrollTop = 0;
    box.classList.add("open");
  }

  function readerTermModalClose() {
    var box = document.querySelector(".rd-tmodal");
    if (box) box.remove();
  }

  var readerBound = false;      // 文档级监听只绑一次；host 级每次进页都要重绑
  function readerInit() {
    readerRenderLanding();
    var host = document.getElementById("reader-host");
    if (!host) return;

    if (!readerBound) {
      readerBound = true;
      /* 文档级：点浮标以外的地方把浮标收掉 */
      document.addEventListener("mousedown", function (e) {
        if (!e.target.closest || !e.target.closest(".rd-lookup")) readerDropLookup();
      });
      /* 水平翻页模式的键盘支持：←/→ 翻页（输入框里不抢）；
         词条悬浮窗开着时 ←/→ 不穿透去翻底下的书页，Esc 收窗 */
      document.addEventListener("keydown", function (e) {
        if (document.querySelector(".rd-tmodal")) {
          if (e.key === "Escape") { readerTermModalClose(); e.preventDefault(); }
          return;
        }
        if (!document.querySelector(".rd-viewer") || READER.mode !== "page" || READER.type === "pdf") return;
        var tag = ((e.target && e.target.tagName) || "").toLowerCase();
        if (tag === "input" || tag === "textarea") return;
        if (e.key === "ArrowRight") { readerPgGo(1); e.preventDefault(); }
        else if (e.key === "ArrowLeft") { readerPgGo(-1); e.preventDefault(); }
      });
      /* 容器尺寸变了要重排（keep=true：守住当前页码，不跳回第一页）。
         真正的兜底是 readerPgObserve 的 ResizeObserver——这里留着是因为
         它在没有 ResizeObserver 的老内核下仍然管用。 */
      window.addEventListener("resize", function () {
        if (READER.mode === "page") readerPgLayout(true);
      });

      /* v3 滑出式顶栏与目录栏：鼠标靠近阅读器上缘 52px / 左缘 56px 内滑出，
         离开（且未钉住）自动收回。document 级监听只在页面上有 .rd-viewer 时干活。 */
      document.addEventListener("mousemove", function (e) {
        var v = document.querySelector(".rd-viewer");
        if (!v || !v.getClientRects().length) return;
        var r = v.getBoundingClientRect();
        var inside = e.clientX >= r.left && e.clientX <= r.right &&
          e.clientY >= r.top && e.clientY <= r.bottom;
        if (!inside) return;
        var topBand = e.clientY - r.top <= 52;
        var leftBand = e.clientX - r.left <= 56;
        if (topBand) v.classList.add("top-in");
        else if (e.clientY - r.top > 96 && !v.classList.contains("top-pin")) v.classList.remove("top-in");
        if (leftBand) v.classList.add("toc-in");
        else if (e.clientX - r.left > 110 && !v.classList.contains("toc-pin")) v.classList.remove("toc-in");
      });
    }

    /* host 级监听每次都要重绑——route() 每次进 #/reader 都 app.innerHTML
       重建 #reader-host，旧元素连同监听一起销毁。之前用 readerBound 只绑
       一次，第二次进阅读器后选中即查全灭（真机 bug：选中词不跳词条）。 */
    /* 选中即查：只对 TXT / EPUB 的正文有效；PDF 走浏览器内置阅读器，
       其文本在插件内部，页面拿不到选区。 */
    host.addEventListener("mouseup", function () {
      if (!host.querySelector(".rd-viewer")) return;
      setTimeout(readerLookup, 10);
    });
    host.addEventListener("keyup", function (e) {
      if (!host.querySelector(".rd-viewer")) return;
      if (e.key === "Shift" || e.shiftKey) setTimeout(readerLookup, 10);
    });
    // 滚正文、翻章、点别处都要把浮标收掉
    host.addEventListener("scroll", readerDropLookup, true);
    /* 滚动也落阅读进度，但节流到 1.2 秒一次：滚动事件在触控板上每秒能来
       几十次，localStorage 是同步写，不节流会把主线程拖住。
       ⚠ 这条监听是 capture 的，PDF 的 iframe 内部滚动也会冒泡上来——
         PDF 本来就取不到进度，rdProbe 对它记 0，无害。 */
    host.addEventListener("scroll", function () {
      if (!host.querySelector(".rd-viewer") || !READER.name) return;
      if (rdScrollT) return;
      rdScrollT = setTimeout(function () {
        rdScrollT = 0;
        if (!document.querySelector(".rd-viewer")) return;   // 期间已离开阅读器
        rdRecTouch();
      }, 1200);
    }, true);

    host.addEventListener("click", function (e) {
      var el = e.target.closest ? e.target.closest("[data-rd]") : null;
      if (!el) return;
      var act = el.getAttribute("data-rd");
      if (act === "pick") document.getElementById("rd-input").click();
      else if (act === "clear") readerClearHistory();
      else if (act === "back") readerRenderLanding();
      else if (act === "close") readerCloseFile();
      else if (act === "theme") readerToggleTheme();
      else if (act === "bigger") readerResize(+1);
      else if (act === "smaller") readerResize(-1);
      else if (act === "full") readerToggleFull();
      else if (act === "chapter") readerGoChapter(+el.getAttribute("data-i"));
      /* —— 书签（v58）—— */
      else if (act === "bm-add") {
        var it = rdBmAdd({});
        if (!it) window.alert("还没有打开文件，无法添加书签。");
        else {
          rdBmSetOpen(true);                // 加完顺手把抽屉亮出来
          rdToast("已加书签：" + (it.ct || ("第 " + (it.ci + 1) + " 章")) + " · " + it.pct + "%");
        }
      }
      else if (act === "bm-toggle") rdBmSetOpen(!RD.bmOpen);
      else if (act === "bm-close") rdBmSetOpen(false);
      else if (act === "bm-go") {
        var li = el.closest ? el.closest(".rd-bm-i") : null;
        if (li) rdBmGo(li.getAttribute("data-bm"));
      }
      else if (act === "bm-ren") {
        var li2 = el.closest ? el.closest(".rd-bm-i") : null;
        if (li2) {
          var nameEl = li2.querySelector(".rd-bm-go b");
          rdBmPrompt(li2.getAttribute("data-bm"), (nameEl && nameEl.textContent) || "", li2);
        }
      }
      else if (act === "bm-del") {
        var li3 = el.closest ? el.closest(".rd-bm-i") : null;
        if (li3) {
          var bid = li3.getAttribute("data-bm");
          var bname = (li3.querySelector(".rd-bm-go i") || {}).textContent || "这一处";
          /* 删当前章节所在的那条要问一句：书签是读者攒下来的，
             误删没有回收站。其余直接删，不打断节奏。 */
          var hereNow = READER.name && li3.classList.contains("on");
          if (hereNow && !window.confirm("删除当前所在位置的书签（" + bname + "）？")) { /* 取消 */ }
          else {
            var wasOpen = rdBmDel(bid);
            rdBmPanelSync();
            rdToast(wasOpen ? "书签已删除。" : "这条书签已经不在了（可能已在另一处删除）。");
          }
        }
      }
      /* —— 阅读记录（v58）—— */
      else if (act === "rc-go") {
        var rli = el.closest ? el.closest(".rd-rc-i") : null;
        if (rli) {
          var recs = rdRecords(), rec = recs[rli.getAttribute("data-rc")];
          if (!rec) { rdToast("这条阅读记录已经不在了。"); readerRenderLanding(); }
          else {
            rdResumePending(rec.book, rec.type);
            var inp = document.getElementById("rd-input");
            rdToast("请选中「" + rec.book + "」，会自动回到上次的位置。");
            if (inp) inp.click();
          }
        }
      }
      else if (act === "rc-del") {
        var rli2 = el.closest ? el.closest(".rd-rc-i") : null;
        if (rli2) {
          var k = rli2.getAttribute("data-rc");
          rdToast(rdRecDel(k) ? "这条阅读记录已删除。" : "这条阅读记录已经不在了。");
          readerRenderLanding();
        }
      }
      else if (act === "rc-clear") {
        if (window.confirm("清空全部阅读进度？（书签不受影响）")) {
          rdRecClear();
          rdToast("阅读进度已清空。");
        }
        readerRenderLanding();
      }
      else if (act === "pmode") {
        READER.mode = READER.mode === "page" ? "scroll" : "page";
        el.textContent = READER.mode === "page" ? "滚动模式" : "翻页模式";
        readerPgApply();
      }
      else if (act === "pprev") readerPgGo(-1);
      else if (act === "pnext") readerPgGo(1);
      else if (act === "toppin" || act === "tocpin") {
        var v = el.closest(".rd-viewer");
        if (v) {
          var pin = act === "toppin" ? "top-pin" : "toc-pin";
          var inn = act === "toppin" ? "top-in" : "toc-in";
          var on = !v.classList.contains(pin);
          v.classList.toggle(pin, on);
          v.classList.toggle(inn, on);     // 钉住必展开；解开即收（除非鼠标还在感应带里）
          clearTimeout(readerPeekT);
        }
      }
    });

    host.addEventListener("change", function (e) {
      if (e.target.id === "rd-input") {
        var f = e.target.files && e.target.files[0];
        if (f) readerOpenFile(f);
        e.target.value = "";
      }
    });

    host.addEventListener("dragover", function (e) {
      var z = e.target.closest ? e.target.closest("#rd-drop") : null;
      if (!z) return;
      e.preventDefault();
      z.classList.add("over");
    });
    host.addEventListener("dragleave", function (e) {
      var z = e.target.closest ? e.target.closest("#rd-drop") : null;
      if (!z) return;
      z.classList.remove("over");
    });
    host.addEventListener("drop", function (e) {
      var z = e.target.closest ? e.target.closest("#rd-drop") : null;
      if (!z) return;
      e.preventDefault();
      z.classList.remove("over");
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) readerOpenFile(f);
    });
  }

  /* —— 首页：上传区 + 阅读进度（断点续读）+ 最近打开 —— */

  /* 进度列表：按最近阅读倒序。每行给书名、章节、百分比进度条、时长与时间，
     按钮是「继续读」。文件名对不上的书（记录在、文件没在手上）不假装能续，
     只保留行并标出「需重新选择文件」——文件内容不落盘是硬约束。 */
  function rdRecListHTML() {
    var list = rdRecList();
    if (!list.length) return "";
    var rows = list.map(function (r) {
      var key = esc(rdBookKey(r.book, r.type));
      var where = r.ct || ("第 " + (r.ci + 1) + " 章");
      var pos = r.pg > 0 ? where + " · 第 " + r.pg + " 页" : where;
      return '<li class="rd-rc-i" data-rc="' + key + '">' +
        '<span class="rd-tag">' + esc(r.type || "?") + '</span>' +
        '<div class="rd-rc-main">' +
          '<b title="' + esc(r.book) + '">' + esc(r.book) + '</b>' +
          '<div class="rd-rc-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
            r.pct + '" aria-label="' + esc(r.book) + ' 阅读进度"><i style="width:' + r.pct + '%"></i></div>' +
          '<i class="rd-rc-meta">' + esc(pos) + ' · ' + r.pct + '% · 累计 ' +
            esc(rdFmtDur(r.ms)) + ' · ' + esc(rdFmtAgo(r.at)) + '</i>' +
        '</div>' +
        '<span class="rd-rc-acts">' +
          '<button type="button" class="tt-btn" data-rd="rc-go" title="选中这份文件并回到上次读到的位置">继续读</button>' +
          '<button type="button" class="tt-btn" data-rd="rc-del" title="删除这条阅读记录">删除</button>' +
        '</span></li>';
    }).join("");
    return '<div class="rd-hist rd-rc"><h3>阅读进度</h3>' +
      '<p class="rd-rc-hint">点「继续读」后在上传框里选中这份文件，会自动回到上次的位置。</p>' +
      '<ul>' + rows + '</ul>' +
      '<button class="tt-btn" data-rd="rc-clear">清空阅读进度</button></div>';
  }

  function readerRenderLanding() {
    var host = document.getElementById("reader-host");
    if (!host) return;
    /* 回到上传页＝这一趟阅读结束了：结算时长，再重画列表（进度已变）。
       首次进入阅读器时也走这里，此时没有文件、计时器没起，两句都是空跑。 */
    if (rdTimer) { rdRecTouch(); rdTimeStop(); }
    var list = readerHistory();
    var hist = list.length ? '<div class="rd-hist"><h3>最近打开</h3><ul>' +
      list.map(function (x) {
        var d = new Date(x.at);
        return '<li><span class="rd-tag">' + esc(x.type) + '</span><b>' + esc(x.name) +
          '</b><i>' + d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " +
          pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + '</i></li>';
      }).join("") + '</ul><button class="tt-btn" data-rd="clear">清空记录</button></div>' : "";
    /* 书签总览放在上传区下方：即使此刻没打开任何文件，也能看到自己留过的位置。
       面板按书分组，与阅读中打开的抽屉同一份渲染函数，两处不会跑偏。 */
    var bmGroups = rdBmGroups();
    var bmAll = [];
    bmGroups.forEach(function (g) { bmAll = bmAll.concat(g.items); });
    var marks = '<div class="rd-hist rd-bm-all"><h3>书签' +
        (bmAll.length ? "（" + bmAll.length + "）" : "") + '</h3>' +
      (bmAll.length
        ? '<ul>' + bmAll.slice(0, 12).map(function (b) {
            return '<li class="rd-bm-mini-row"><b title="' + esc(b.title || "") + '">' +
              esc(b.title || ("第 " + (b.ci + 1) + " 章 · " + b.pct + "%")) + '</b>' +
              '<i>' + esc(b.book) + ' · ' + esc(b.ct || ("第 " + (b.ci + 1) + " 章")) +
              ' · ' + b.pct + '%</i></li>';
          }).join("") + '</ul>' +
          (bmAll.length > 12 ? '<p class="rd-rc-hint">另有 ' + (bmAll.length - 12) +
            ' 条，在阅读器里打开对应文件后从顶栏「书签」查看全部。</p>' : "")
        : '<p class="rd-bm-empty">还没有书签。打开文件读到关键处，点顶栏的「书签」记一笔。</p>') +
      '</div>';
    host.innerHTML =
      '<div class="rd-landing">' +
        '<div class="rd-drop" id="rd-drop" data-rd="pick">' +
          '<input type="file" id="rd-input" accept=".pdf,.epub,.txt" hidden>' +
          '<div class="rd-drop-icon">📖</div>' +
          '<p><b>点击选择</b>或<b>拖拽文件到此处</b></p>' +
          '<p class="rd-hint">支持 PDF、EPUB、TXT；文件仅在本机打开，不会上传。</p>' +
        '</div>' + rdRecListHTML() + hist + marks +
      '</div>';
  }

  /* 新打开一份文件后的收尾：拨回章号 → 渲染 → 恢复章内位置 → 落第一条记录
     → 起时长计时。与 readerRenderViewer 分开，是因为翻章、跳书签也会调渲染，
     那时不该重置续读目标、也不该重开计时器。 */
  function readerLoaded() {
    var rec = rdResumeChapter();          // 必须在渲染之前
    readerRenderViewer();
    rdResumeScroll();                     // 必须在布局落定之后
    rdRecTouch();
    rdTimeStart();
    if (rec) {
      rdToast("已回到上次读到的位置：" + (rec.ct || ("第 " + (rec.ci + 1) + " 章")) +
        " · " + rec.pct + "%");
    }
  }

  function readerOpenFile(file) {
    var name = file.name || "";
    var ext = name.split(".").pop().toLowerCase();
    READER.name = name;
    READER.type = ext;
    READER.theme = READER.theme || "light";
    READER.size = READER.size || 18;
    readerSaveMeta(name, ext);
    if (ext === "txt") readerOpenTxt(file);
    else if (ext === "pdf") readerOpenPdf(file);
    else if (ext === "epub") readerOpenEpub(file);
    else window.alert("暂不支持的格式：" + ext + "，请选择 PDF、EPUB 或 TXT。");
  }

  function readerOpenTxt(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var text = reader.result || "";
      READER.chapters = [{
        title: "全文",
        text: text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
      }];
      READER.idx = 0;
      readerLoaded();
    };
    reader.onerror = function () { window.alert("读取 TXT 失败，请换一份文件试试。"); };
    reader.readAsText(file);
  }

  function readerOpenPdf(file) {
    var url = URL.createObjectURL(file);
    READER.pdfUrl = url;
    READER.chapters = [{ title: "PDF 全文", text: "" }];
    READER.idx = 0;
    readerLoaded();
  }

  function readerOpenEpub(file) {
    if (typeof DecompressionStream === "undefined") {
      window.alert("你的浏览器不支持 EPUB 解压，建议换用 Edge / Chrome / Firefox 最新版。");
      return;
    }
    var host = document.getElementById("reader-host");
    if (host) host.innerHTML = '<div class="rd-busy">正在解析 EPUB，请稍候……</div>';
    var reader = new FileReader();
    reader.onload = function () {
      readerParseEpub(reader.result).then(function (chapters) {
        if (!chapters.length) throw new Error("未找到可阅读文本");
        READER.chapters = chapters;
        READER.idx = 0;
        readerLoaded();
      }).catch(function (err) {
        window.alert("EPUB 解析失败：" + (err && err.message ? err.message : err));
        readerRenderLanding();
      });
    };
    reader.onerror = function () { window.alert("读取 EPUB 失败。"); readerRenderLanding(); };
    reader.readAsArrayBuffer(file);
  }

  /* 轻量 EPUB 解压：只解析 Central Directory，按需解压文本文件 */
  async function readerParseEpub(ab) {
    var files = readerListZip(ab);
    var names = Object.keys(files).filter(function (n) {
      return /\.(xhtml|html|htm|txt)$/i.test(n);
    }).sort();
    var out = [];
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      var buf = await readerExtractZip(ab, files[n]);
      var text = new TextDecoder("utf-8").decode(buf);
      // 去标签并保留段落结构
      var plain = text.replace(/<script[\s\S]*?<\/script>/gi, "")
                      .replace(/<style[\s\S]*?<\/style>/gi, "")
                      .replace(/<[^>]+>/g, "\n")
                      .replace(/&nbsp;/gi, " ")
                      .replace(/&amp;/g, "&")
                      .replace(/&lt;/g, "<")
                      .replace(/&gt;/g, ">")
                      .replace(/&quot;/g, '"')
                      .replace(/\n{3,}/g, "\n\n")
                      .trim();
      if (plain.replace(/\s/g, "").length > 20) out.push({ title: readerNiceName(n), text: plain });
    }
    return out;
  }

  function readerListZip(ab) {
    var view = new DataView(ab);
    var len = view.byteLength;
    var eocd = -1;
    // EOCD 一般在末尾 22 字节内，但若文件末尾有注释则最大 65535+22
    for (var i = len - 22; i >= Math.max(0, len - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("找不到 ZIP 目录");
    var cdOffset = view.getUint32(eocd + 16, true);
    var numEntries = view.getUint16(eocd + 10, true);
    var files = {};
    var pos = cdOffset;
    for (var i = 0; i < numEntries; i++) {
      if (view.getUint32(pos, true) !== 0x02014b50) throw new Error("目录损坏");
      var comp = view.getUint16(pos + 10, true);
      var cSize = view.getUint32(pos + 20, true);
      var uSize = view.getUint32(pos + 24, true);
      var nameLen = view.getUint16(pos + 28, true);
      var extraLen = view.getUint16(pos + 30, true);
      var commentLen = view.getUint16(pos + 32, true);
      var localOffset = view.getUint32(pos + 42, true);
      var name = new TextDecoder().decode(new Uint8Array(ab, pos + 46, nameLen));
      files[name] = { comp: comp, cSize: cSize, uSize: uSize, offset: localOffset };
      pos += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  async function readerExtractZip(ab, info) {
    var lv = new DataView(ab);
    var nameLen = lv.getUint16(info.offset + 26, true);
    var extraLen = lv.getUint16(info.offset + 28, true);
    var start = info.offset + 30 + nameLen + extraLen;
    var data = new Uint8Array(ab, start, info.cSize);
    if (info.comp === 0) return data;                      // store
    if (info.comp === 8) {                                 // deflate
      try {
        // EPUB 通常用 raw deflate（无 zlib 头）
        var ds = new DecompressionStream("deflate-raw");
        var w = ds.writable.getWriter();
        w.write(data);
        w.close();
        return new Uint8Array(await new Response(ds.readable).arrayBuffer());
      } catch (e) {
        // 少数用标准 deflate，回退一试
        var ds2 = new DecompressionStream("deflate");
        var w2 = ds2.writable.getWriter();
        w2.write(data);
        w2.close();
        return new Uint8Array(await new Response(ds2.readable).arrayBuffer());
      }
    }
    throw new Error("不支持的压缩方式 " + info.comp);
  }

  function readerNiceName(path) {
    return path.replace(/^.*[\\/]/, "").replace(/\.(xhtml|html|htm|txt)$/i, "").replace(/[_-]+/g, " ");
  }

  function readerRenderViewer() {
    var host = document.getElementById("reader-host");
    if (!host) return;
    var ch = READER.chapters[READER.idx] || READER.chapters[0] || { title: "", text: "" };
    var toc = READER.chapters.map(function (c, i) {
      return '<button class="rd-ch' + (i === READER.idx ? " on" : "") +
        '" data-rd="chapter" data-i="' + i + '">' + esc(c.title) + '</button>';
    }).join("");

    var content;
    if (READER.type === "pdf") {
      content = '<iframe class="rd-pdf" src="' + esc(READER.pdfUrl) +
        '" title="PDF 阅读器"></iframe>';
    } else {
      var paras = ch.text.split(/\n{2,}/).map(function (p) {
        return "<p>" + esc(p.replace(/\n+/g, " ")) + "</p>";
      }).join("");
      content = '<article class="rd-article" id="rd-article">' + paras + '</article>';
    }

    host.innerHTML =
      '<div class="rd-viewer rd-' + esc(READER.theme) +
        (READER.mode === "page" && READER.type !== "pdf" ? " rd-page" : "") + '">' +
        '<div class="rd-bar">' +
          '<button class="tt-btn" data-rd="back" title="返回上传页">←</button>' +
          '<span class="rd-title" title="' + esc(READER.name) + '">' + esc(READER.name) + '</span>' +
          '<div class="rd-acts">' +
            '<button class="tt-btn" data-rd="bm-add" title="在当前章节的当前位置记一枚书签">书签+</button>' +
            '<button class="tt-btn" data-rd="bm-toggle" title="查看/收起书签抽屉">书签</button>' +
            '<button class="tt-btn" data-rd="smaller" title="字号减小">A-</button>' +
            '<button class="tt-btn" data-rd="bigger" title="字号增大">A+</button>' +
            (READER.type === "pdf" ? "" :
              '<button class="tt-btn" data-rd="pmode" title="在上下滚动与左右翻页之间切换">' +
              (READER.mode === "page" ? "滚动模式" : "翻页模式") + "</button>") +
            '<button class="tt-btn" data-rd="theme" title="切换主题">☀/☾</button>' +
            '<button class="tt-btn" data-rd="full" title="全屏">全屏</button>' +
            '<button class="tt-btn" data-rd="close" title="关闭文件">关闭</button>' +
          '</div>' +
        '</div>' +
        /* 顶栏与目录栏默认藏起来（顶栏上滑、目录左滑），鼠标靠近上/左边缘滑出，
           离开自动收。两个小把手常驻可见，点一下可以钉住/解开。 */
        '<button class="rd-bar-handle" type="button" data-rd="toppin" title="钉住/收起工具栏">⌵</button>' +
        '<button class="rd-toc-handle" type="button" data-rd="tocpin" title="钉住/收起目录">目录</button>' +
        '<div class="rd-body">' +
          '<aside class="rd-toc">' + toc + '</aside>' +
          /* 木纹桌面（.rd-stage）上摆一本摊开的书（.rd-book），
             正文落在书页（.rd-content）上并自行滚动；翻页模式时书页两侧
             出现 ‹ › 箭头、右下角出页码。 */
          '<div class="rd-stage">' +
            '<div class="rd-book">' +
              '<div class="rd-gutter"></div>' +
              '<div class="rd-content" id="rd-content" style="font-size:' + READER.size + 'px">' + content + '</div>' +
            '</div>' +
            (READER.type === "pdf" ? "" :
              '<button type="button" class="rd-pg-arrow left" data-rd="pprev" aria-label="上一页">‹</button>' +
              '<button type="button" class="rd-pg-arrow right" data-rd="pnext" aria-label="下一页">›</button>' +
              '<span class="rd-pg-ind"></span>') +
            '<p class="rd-tip">在正文里<b>选中一个术语</b>，可一键跳到词条解释。' +
            (READER.type === "pdf" ? '（PDF 由浏览器内置阅读器渲染，暂不支持选词跳转）' : "") + '</p>' +
          '</div>' +
        '</div>' +
        /* 书签抽屉的宿主。内容由 rdBmPanelSync() 按需填：默认不占位，
           点顶栏「书签」才挂上（与选中即查浮标同一理由，挂在 .rd-viewer 里
           才能在全屏时正常渲染）。 */
      '</div>';
    readerPgApply();
    readerPeekChrome();
    rdBmPanelSync();          // 重渲染后把抽屉状态接回来（开着就重画一份）
  }

  /* —— 水平翻页模式 ——
     正文用 CSS 多栏排版（column-width = 单栏宽、定高、column-fill:auto），
     内容装不下就向右续栏；整栏 translateX 平移一页即翻页。
     不引任何库，离线单文件照常可用。

     ⚠ 三个几何量必须彼此自洽（v37 修的就是这里）：
       M = 页边距 = 栏间距 column-gap（两者必须相等）
       C = 单栏宽 = 容器内容盒宽 − 2M
       S = 每翻一页的位移 = C + M = 容器内容盒宽 − M
     旧代码把 column-width 写成 C − M，以为浏览器会按这个宽度排栏；但
     column-width 只是「建议值」——可用宽度装得下一栏时浏览器一律把栏撑满
     到 C。于是真实步进是 C + M，而位移只走了 C，每翻一页少走 M(44px)，
     误差随页码线性累加：第 k 页左侧露出上一栏的 k·M 像素（看着像重复）、
     右侧切掉 k·M 像素（看着像丢字）；同时栏盒高按 clientHeight 给，比容器
     内容盒高出 padTop(2.1rem)，每页底部多塞进一行并被裁掉半行。
     现在的三条不变量：① 栏盒 ⊆ 容器内容盒（不裁）；② 步进由 DOM 实测
     （不漂）；③ 栏宽/栏间距/页边距同一个 M 推出来（不重影）。 */
  var PG = { i: 0, n: 1, w: 0, m: 0, gap: 0, h: 0, step: 0, cols: 0, sig: "" };
  var pgRaf = 0, pgRO = null, pgROEl = null, pgFontsHooked = false;

  function readerPgEls() {
    return {
      c: document.getElementById("rd-content"),
      a: document.getElementById("rd-article"),
      v: document.querySelector(".rd-viewer")
    };
  }

  function rdNum(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  /* 亚像素安全边：高度只往下取到 1/8 px，保证栏盒永远装得进裁剪盒 */
  function rdFloor8(v) { return Math.floor(v * 8) / 8; }
  function rdRound64(v) { return Math.round(v * 64) / 64; }

  /* 量出这一屏的排版参数，并把恒等式写成内联样式。
     一律用 getBoundingClientRect 的亚像素值：clientWidth/Height 是取整结果，
     在高分屏缩放、横竖屏切换、系统字体缩放下会攒出可见偏差。
     返回 null 表示容器还没有可用尺寸（藏着/未排版）——此时什么都别动。 */
  function readerPgMeasure(el) {
    var cR = el.c.getBoundingClientRect();
    var cs = window.getComputedStyle(el.c);
    var W = cR.width - rdNum(cs.paddingLeft) - rdNum(cs.paddingRight);
    var H = cR.height - rdNum(cs.paddingTop) - rdNum(cs.paddingBottom);
    if (W < 40 || H < 60) return null;              // 藏着/还没排版：不要瞎量
    var as = window.getComputedStyle(el.a);
    /* 页边距的唯一定义处是 CSS 里正文层的 padding-left（翻页模式下 3rem，
       见 site.css「③ 阅读器水平翻页模式」）。右侧与栏间距都对齐它——
       三者不等，上一栏的尾巴就会从页边距里露出来。 */
    var M = rdNum(as.paddingLeft) || 0;
    M = Math.max(6, Math.min(M, Math.max(6, W / 2 - 40)));
    var C = Math.max(120, W - 2 * M);
    var h = rdFloor8(H);
    el.a.style.paddingLeft = M + "px";
    el.a.style.paddingRight = M + "px";
    el.a.style.columnGap = M + "px";
    el.a.style.columnWidth = C + "px";
    el.a.style.height = h + "px";
    return { W: W, H: H, m: M, c: C, h: h, pt: rdNum(as.paddingTop), pb: rdNum(as.paddingBottom) };
  }

  /* 实测栏步进与栏数：取正文各块在 DOM 里的分片左边界。column-width 只是
     建议值，浏览器可能把栏撑得更宽，所以步进必须实测——各栏原点之差的
     最小正值就是步进（分片只会落在栏原点上）。分片数是「有内容的栏数」，
     也就等于页数（多出的栏一定是被内容撑出来的）。 */
  function readerPgScan(el) {
    var seen = {}, lefts = [], n = 0;
    var kids = el.a.children;
    for (var i = 0; i < kids.length; i++) {
      if (!kids[i].getClientRects) continue;
      var rs = kids[i].getClientRects();
      for (var k = 0; k < rs.length; k++) {
        var key = Math.round(rs[k].left * 4);
        if (seen[key]) continue;
        seen[key] = 1; n++;
        lefts.push(rs[k].left);
      }
    }
    lefts.sort(function (x, y) { return x - y; });
    var step = 0;
    for (var j = 1; j < lefts.length; j++) {
      var d = lefts[j] - lefts[j - 1];
      if (d > 1 && (!step || d < step)) step = d;
    }
    return { step: step, cols: n };
  }

  /* 排一次：量 → 定位 → 画。keep=true 时按阅读进度比例守住当前页码
     （改字号、缩放窗口、切横竖屏之后不跳回第一页）。 */
  function readerPgLayout(keep) {
    var el = readerPgEls();
    if (!el.c || !el.a || READER.type === "pdf") return;
    var g = readerPgMeasure(el);
    if (!g) { readerPgPaint(false); return; }   // 量不到（容器藏着/无头测试环境）：只把控件状态摆正
    var sig = rdRound64(g.W) + "|" + rdRound64(g.H) + "|" + rdRound64(g.m) + "|" +
      rdRound64(g.c) + "|" + READER.size;
    if (sig === PG.sig && PG.step > 0) { readerPgPaint(false); return; }
    var prog = PG.n > 1 ? PG.i / (PG.n - 1) : 0;
    var sc = readerPgScan(el);
    var step = sc.step > 1 ? sc.step : g.c + g.m;
    var n = Math.max(1, sc.cols || Math.ceil((el.a.scrollWidth - g.m) / step - 0.001) || 1);
    PG.w = g.c; PG.m = g.m; PG.gap = g.m; PG.h = g.h; PG.step = step;
    PG.cols = sc.cols; PG.n = n; PG.sig = sig;
    PG.i = Math.max(0, Math.min(n - 1, keep ? Math.round(prog * (n - 1)) : PG.i));
    readerPgPaint(false);
  }

  function readerPgPaint(anim) {
    var el = readerPgEls();
    if (!el.c || !el.a) return;
    /* 重排引起的位移不要动画（看起来像被甩了一下）；翻页才要 */
    if (anim === false) el.a.style.transition = "none";
    el.a.style.transform = "translate3d(" + rdRound64(-PG.i * PG.step) + "px,0,0)";
    if (anim === false) requestAnimationFrame(function () {
      var a2 = document.getElementById("rd-article");
      if (a2) a2.style.transition = "";
    });
    var ind = document.querySelector(".rd-pg-ind");
    if (ind) ind.textContent = (PG.i + 1) + " / " + PG.n;
    var L = document.querySelector(".rd-pg-arrow.left");
    var R = document.querySelector(".rd-pg-arrow.right");
    if (L) L.disabled = PG.i === 0;
    if (R) R.disabled = PG.i >= PG.n - 1;
  }

  function readerPgGo(d) {
    var j = Math.max(0, Math.min(PG.n - 1, PG.i + d));
    if (j === PG.i) return;
    PG.i = j;
    readerPgPaint(true);
    rdRecTouch();          // 翻页即落进度（续读要回到这一页）
  }

  /* 布局落定后再量一次，把「迟到的高度」都接住：字体加载完成、图片解码、
     容器因外部原因变高（顶栏滑出、全屏、移动端地址栏收起）都可能让第一次
     量到的数不准。几何没变时 readerPgLayout 会直接返回，重复调用很廉价。 */
  function readerPgSettle() {
    if (pgRaf) cancelAnimationFrame(pgRaf);
    pgRaf = requestAnimationFrame(function () {
      pgRaf = requestAnimationFrame(function () {
        pgRaf = 0;
        readerPgLayout(true);
        readerPgWatchImages();
      });
    });
  }

  function readerPgWatchFonts() {
    if (pgFontsHooked || !document.fonts) return;
    pgFontsHooked = true;
    try {
      /* 字体换完（或 webfont 落到内存）行高与断行都会变，必须重排——
         否则栏高按旧度量算，每页最后一行会被裁。 */
      if (document.fonts.ready) document.fonts.ready.then(function () { readerPgLayout(true); });
      document.fonts.addEventListener("loadingdone", function () { readerPgLayout(true); });
    } catch (e) { /* 老内核没有 FontFaceSet 事件 */ }
  }

  function readerPgWatchImages() {
    var el = readerPgEls();
    if (!el.a || !el.a.querySelectorAll) return;
    var imgs = el.a.querySelectorAll("img");
    for (var i = 0; i < imgs.length; i++) {
      var im = imgs[i];
      if (im.complete || im.getAttribute("data-rdpg")) continue;
      im.setAttribute("data-rdpg", "1");
      /* 图片解码完会改变占位高度 → 栏高与断行都要重算 */
      im.addEventListener("load", function () { readerPgLayout(true); });
      im.addEventListener("error", function () { readerPgLayout(true); });
    }
  }

  /* 容器尺寸一变就重排。窗口缩放、横竖屏切换、浏览器缩放、全屏、系统字体
     缩放都会走到这里——只挂 window.resize 收不全。几何没变时里面直接返回，
     所以不会打转。 */
  function readerPgObserve() {
    var el = readerPgEls();
    if (!el.c) return;
    if (pgRO && pgROEl === el.c) return;
    readerPgUnobserve();
    if (!window.ResizeObserver) return;
    pgROEl = el.c;
    pgRO = new ResizeObserver(function () {
      if (!document.body.contains(pgROEl)) { readerPgUnobserve(); return; }
      if (READER.mode !== "page") return;
      readerPgLayout(true);
    });
    pgRO.observe(el.c);
  }
  function readerPgUnobserve() {
    if (pgRO) { try { pgRO.disconnect(); } catch (e) { /* 已断开 */ } }
    pgRO = null; pgROEl = null;
  }

  /* 按当前模式套/摘多栏排版；翻章、切换模式、改字号后都走这里 */
  function readerPgApply() {
    var el = readerPgEls();
    if (!el.c || !el.a || READER.type === "pdf") return;
    if (READER.mode === "page") {
      /* 从滚动模式切进来：先记下滚到哪了，排完栏再折成页码，
         免得「换个模式就回到第一页」。 */
      var ratio = 0;
      var room = el.c.scrollHeight - el.c.clientHeight;
      if (room > 4) ratio = Math.max(0, Math.min(1, el.c.scrollTop / room));
      if (el.v) el.v.classList.add("rd-page");
      el.c.classList.add("rd-pg");
      el.c.scrollTop = 0;
      PG.i = 0; PG.n = 1; PG.step = 0; PG.cols = 0; PG.sig = "";
      readerPgLayout(false);
      if (ratio > 0.01 && PG.n > 1) {
        PG.i = Math.max(0, Math.min(PG.n - 1, Math.round(ratio * (PG.n - 1))));
        readerPgPaint(false);
      }
      readerPgObserve();
      readerPgWatchFonts();
      readerPgWatchImages();
      readerPgSettle();
    } else {
      /* 回滚动模式：把页码折回滚动位置，同样不让人丢位置 */
      var back = PG.n > 1 ? PG.i / (PG.n - 1) : 0;
      var had = PG.step > 0;
      if (pgRaf) { cancelAnimationFrame(pgRaf); pgRaf = 0; }
      readerPgUnobserve();
      if (el.v) el.v.classList.remove("rd-page");
      el.c.classList.remove("rd-pg");
      el.a.style.columnWidth = "";
      el.a.style.columnGap = "";
      el.a.style.height = "";
      el.a.style.transform = "";
      el.a.style.transition = "";
      el.a.style.paddingLeft = "";
      el.a.style.paddingRight = "";
      PG.sig = ""; PG.step = 0; PG.n = 1; PG.cols = 0;
      if (had && back > 0.01) requestAnimationFrame(function () {
        var c2 = document.getElementById("rd-content");
        if (!c2 || !c2.scrollHeight) return;
        var r = c2.scrollHeight - c2.clientHeight;
        if (r > 0) c2.scrollTop = back * r;
      });
    }
  }

  /* 打开文件/翻章时把顶栏与目录栏亮出来一小会儿（3 秒后收回，
     除非用户点了把手钉住），不然藏起来的控件没人知道在哪。 */
  var readerPeekT = null;
  function readerPeekChrome() {
    var v = document.querySelector(".rd-viewer");
    if (!v) return;
    v.classList.add("top-in", "toc-in");
    clearTimeout(readerPeekT);
    readerPeekT = setTimeout(function () {
      var vv = document.querySelector(".rd-viewer");
      if (!vv) return;
      if (!vv.classList.contains("top-pin")) vv.classList.remove("top-in");
      if (!vv.classList.contains("toc-pin")) vv.classList.remove("toc-in");
    }, 3000);
  }

  function readerGoChapter(i) {
    if (i < 0 || i >= READER.chapters.length) return;
    READER.idx = i;
    readerRenderViewer();
    var sc = document.getElementById("rd-content");
    if (sc) sc.scrollTop = 0;
    /* 换章先落一条进度：记的是新章开头，不是旧章末尾——
       否则中途关掉再打开会回到刚读完那一章。 */
    rdRecTouch();
  }

  function readerResize(d) {
    READER.size = Math.max(12, Math.min(32, (READER.size || 18) + d));
    var sc = document.getElementById("rd-content");
    if (sc) sc.style.fontSize = READER.size + "px";
    /* 字号变了行高、断行、栏容量全变：按进度比例守住当前页，别跳回首页 */
    if (READER.mode === "page") { readerPgLayout(true); readerPgSettle(); }
  }

  function readerToggleTheme() {
    READER.theme = READER.theme === "light" ? "dark" : "light";
    var v = document.querySelector(".rd-viewer");
    if (v) { v.classList.remove("rd-light", "rd-dark"); v.classList.add("rd-" + READER.theme); }
  }

  function readerToggleFull() {
    var el = document.querySelector(".rd-viewer");
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen().catch(function () { /* 部分浏览器禁止全屏时静默失败 */ });
  }

  function readerCloseFile() {
    /* 关文件前先结算时长与进度：计时器一旦被 rdTimeStop 清掉，
       这一段阅读时间就再也不会落盘了。顺序不能颠倒。 */
    rdTimeStop();
    rdRecTouch();
    if (rdScrollT) { clearTimeout(rdScrollT); rdScrollT = 0; }
    RD.bmOpen = false;      // 关文件即收抽屉：新文件不该继承上一本的抽屉状态
    if (READER.pdfUrl) { URL.revokeObjectURL(READER.pdfUrl); READER.pdfUrl = null; }
    READER.file = null; READER.type = ""; READER.name = ""; READER.chapters = []; READER.idx = 0;
    readerRenderLanding();
  }

  /* ---------------- 路由 ---------------- */

  var app = null;

  /* 时钟：挂在悬浮学习台上，全站常驻（dock 在 #view 之外，换页不重建）。
     每秒只改面板里那行时间与收起态的时分；跨天时（守着页面到零点）
     日期与连续天数要跟着变，所以按 dayKey 判断重算。 */
  var clockTimer = null;
  var clockDay = "";

  function startClock() {
    if (clockTimer) return;
    paintClock();
    clockTimer = setInterval(paintClock, 1000);
  }

  /* ---------------- 滚动入场（v10） ----------------
     用原生 IntersectionObserver 复刻 wisprflow.ai 那套
     GSAP ScrollTrigger ＋ SplitText 的「分段落出现」——零依赖、
     不引任何外部库，file:// 双击照样跑。

     渐进增强：.rv 类由本模块添加，样式表只负责初始态与终态。
     脚本不跑（无 JS／减动效偏好／老浏览器）时这个类根本不存在，
     内容照常直接显示，不会出现「动画没加载完 → 整页空白」的事故。 */
  var RV_SEL = [
    ".hero > .kicker", ".hero > h1", ".hero > .hero-quote",
    ".hero > .hero-src", ".hero > .hero-search", ".hero > .hero-entries",
    ".stat-band", ".home-duo > .duo-col", ".card-grid", ".to-grid"
  ].join(",");
  var rvObs = null;
  var rvTried = false;

  function rvInit() {
    if (rvTried) return;
    rvTried = true;
    if (!("IntersectionObserver" in window)) return;          // 老浏览器：不动，直接显示
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    rvObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add("rv-in");
        rvObs.unobserve(en.target);                            // 一次性：滚回去不重播
      });
    }, { rootMargin: "0px 0px 0px 0px", threshold: 0 });
  }

  function rvScan() {
    rvInit();
    if (!rvObs || !app) return;
    var nodes = app.querySelectorAll(RV_SEL);
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.classList.contains("rv")) continue;               // 同一节点只挂一次
      /* 首页门类卡整块不走这一套：那三张卡要逐张错峰 + 带模糊地进场（见 cvScan），
         若外层网格再整体淡入一次，两层动效会打架、错峰也看不出来。 */
      if (el.hasAttribute("data-cat-cards")) continue;
      el.classList.add("rv");
      /* 同组内按次序错开：一档 62ms、最多五档，形成入场序列 */
      var k = 0;
      var sibs = el.parentNode ? el.parentNode.children : [];
      for (var j = 0; j < sibs.length; j++) {
        if (sibs[j] === el) { k = j; break; }
      }
      el.style.setProperty("--rv-d", (Math.min(k, 5) * 62) + "ms");
      rvObs.observe(el);
    }
  }

  /* ---------------- 门类卡配图的错峰入场（v30） ----------------
     照参考视频：板块「模糊 → 清晰、下沉 → 就位」，三块依次亮起。

     触发方式（用户问到的就是这一条）：
       · 首页分屏模式（>700px）：切到第 2 屏时由 homePager 的 reveal() 放行
         —— 分屏靠 transform 平移、没有滚动事件，只靠观察器有被裁掉不触发的风险；
       · 窄屏（≤700px）首页退回连续滚动：由 IntersectionObserver 在进入视口时放行。
     两种入口都只触发一次：观察器命中后立刻 unobserve，滚回去不重播。
     （整页重渲染——比如离开首页再回来——会重新挂一遍，这是新一次入场。） */
  var CV_SEL = "[data-cat-cards] > .card-cv";
  var CV_STEP = 130;         // 逐张递增的延迟：0 / 130 / 260ms
  var cvObs = null, cvTried = false;

  function cvInit() {
    if (cvTried) return;
    cvTried = true;
    if (!("IntersectionObserver" in window)) return;          // 老浏览器：不动，直接显示
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    cvObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add("cv-in");
        cvObs.unobserve(en.target);                            // 一次性：不重播
      });
    }, { threshold: 0.15 });
  }

  /* 键盘：把这三张卡当一条「选项卡」走——←/→ 在卡间移动焦点，Home/End 到两端。
     只补方向键，不劫持 Tab；焦到即激活——:focus-visible 让毛玻璃归零，
     与鼠标悬停同一套视觉。

     必须 stopPropagation：分屏的 homePager 在 window 上监听 Home/End 翻屏
     （首页那三屏），焦点在卡上时按 Home/End 本来是要走卡片的，
     不拦住就会「焦点留在第 2 屏的卡上、画面却翻到第 3 屏」——焦点看不见。
     ↑/↓ 与 PageUp/PageDown 不碰，那是分屏的翻页键，保持原样。 */
  function cvKeys(el) {
    el.addEventListener("keydown", function (e) {
      var k = e.key;
      if (k !== "ArrowLeft" && k !== "ArrowRight" && k !== "Home" && k !== "End") return;
      var list = app ? app.querySelectorAll(CV_SEL) : [];
      var n = list.length;
      if (n < 2) return;
      var cur = Array.prototype.indexOf.call(list, el);
      if (cur < 0) return;
      var to = k === "Home" ? 0 : k === "End" ? n - 1
        : k === "ArrowLeft" ? (cur - 1 + n) % n : (cur + 1) % n;
      e.preventDefault();
      e.stopPropagation();
      list[to].focus();
    });
  }

  function cvScan() {
    cvInit();
    if (!app) return;
    var nodes = app.querySelectorAll(CV_SEL);
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.classList.contains("cv")) continue;               // 同一节点只挂一次
      el.classList.add("cv");
      if (!el.getAttribute("data-cvk")) { el.setAttribute("data-cvk", "1"); cvKeys(el); }
      var k = i, sibs = el.parentNode ? el.parentNode.children : [];
      for (var j = 0; j < sibs.length; j++) {
        if (sibs[j] === el) { k = j; break; }
      }
      el.style.setProperty("--cv-d", (k * CV_STEP) + "ms");
      if (cvObs) cvObs.observe(el);
      else el.classList.add("cv-in");                          // 无观察器：直接给终态
    }
  }

  /* 分屏翻页器切到某一屏时直接放行那一屏的卡片（与 .rv 的 reveal 同一时机）。 */
  function cvKick(scope) {
    if (!scope || !scope.querySelectorAll) return;
    var els = scope.querySelectorAll(".card-cv.cv");
    for (var i = 0; i < els.length; i++) els[i].classList.add("cv-in");
  }

  /* ---------------- 首页数据带数字滚轮（v35） ----------------
     照着机械密码锁的样子：四位统计数字，每一位各自沿垂直方向滚，
     从起始值滚到目标值后落定。数字是真数字，不是图片。

     结构（由本模块生成；页面 HTML 里仍旧只写 <b>390</b>）：
       <b class="od" data-od="390">
         <span class="od-row" aria-hidden="true">        ← 滚轮对读屏隐藏
           <span class="od-col" style="--od-shift:12;--od-delay:0ms">
             <span class="od-strip"><span class="od-cell">0</span>…</span>
           </span> …
         </span>
         <span class="sr-only">390</span>                ← 读屏读到的是这一句
       </b>

     参数（几何在 OD_CFG，时长与缓动在 .od 的 CSS 变量里）：
       · 方向：数值变大 ⇒ 滚动条向上走，数字自下而上翻上来。
       · 幅度：每一位至少空转整整一圈（LOOP=10 格），再加上从起始位走到
         目标位的那几步 ⇒ 一共走 (10 + 0…9) 格。首轮起始位一律取 0，
         所以「390」的个位 0 也会实打实转一圈再停，不会出现"呆着不动的位"。
       · 单格高＝1.1em，与 .sb b 原来的 line-height:1.1 逐像素相等；
         位移也用 em 表达（calc(--od-shift * -1.1em)）⇒ 换断点、改字号都不用重算。
       · 时长：每一位各滚 DUR=1150ms；逐位延迟 STEP=90ms，从个位往左递增
         （个/十/百/千＝0/90/180/270ms）——进位从右往左传，落锁感才真。
       · 缓动 cubic-bezier(.2,.88,.25,1.02)：尾端 2% 微微过冲再落定，
         要的是「咔哒落锁」不是「刹车」。末尾两格填的都是本位的目标数字，
         所以过冲时露出来的还是同一个字，看不出破绽。
       · 符号位：值字符串里的千分位逗号、小数点、百分号等非数字字符各占一列，
         静态不滚（要加千分位，把值写成 "1,234" 这种字符串即可，列数与排布自动跟上）。

     触发（用户问到的就是这一条）：
       · 首页分屏模式（>700px）切到该屏 ⇒ homePager 的 reveal() 调 odKick()；
       · 窄屏（≤700px）退回连续滚动 ⇒ IntersectionObserver 进入视口时放行；
       · 首次访问开屏帘还盖着（body.iv-lock）时不抢跑，等帘子撤掉再滚；
       · 同一次渲染里只播一次，滚回去不重播；离开首页再回来＝整块 innerHTML
         重渲染，等于新一次入场，会重播——与 .rv / .cv 的既有规矩一致；
       · 数值变化 ⇒ 调 odSet()，从「当前正显示的那一位」接着滚到新值。
       · 降低动效 / 无 IntersectionObserver ⇒ 直接给终值，不滚。 */
  var OD_SEL = ".stat-band .sb b";
  var OD_CFG = { DUR: 1150, STEP: 90, LOOP: 10, FROM: 0 };
  var odObs = null, odTried = false, odPending = [], odVeilWatch = false;

  function odReduced() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  /* 把 <b>390</b> 换成滚轮。toStr 缺省＝沿用 data-od（首次）或现有文本；
     fromStr 缺省＝空串，此时每一位都从 OD_CFG.FROM 起滚。 */
  function odBuild(el, toStr, fromStr) {
    var val = String(toStr == null
      ? (el.getAttribute("data-od") || el.textContent || "") : toStr).trim();
    var prev = String(fromStr == null ? "" : fromStr);
    var chars = val.split(""), n = chars.length;
    el.setAttribute("data-od", val);
    el.style.setProperty("--od-dur", OD_CFG.DUR + "ms");
    var row = document.createElement("span");
    row.className = "od-row";
    row.setAttribute("aria-hidden", "true");               /* 滚轮本身不读 */
    for (var i = 0; i < n; i++) {
      var c = chars[i];
      var k = n - 1 - i;                                   /* 距最右的位序：个位＝0 */
      var col = document.createElement("span");
      col.className = "od-col";
      col.style.setProperty("--od-delay", (k * OD_CFG.STEP) + "ms");
      if (c >= "0" && c <= "9") {
        var to = +c, from = OD_CFG.FROM;
        /* 重滚时按「右端对齐」取上一位的值当起点，位数变了就退回 FROM */
        var pi = prev.length - (n - i);
        if (pi >= 0 && prev.charAt(pi) >= "0" && prev.charAt(pi) <= "9") from = +prev.charAt(pi);
        var span = ((to - from) % 10 + 10) % 10 + OD_CFG.LOOP;
        var strip = document.createElement("span");
        strip.className = "od-strip";
        for (var j = 0; j < span; j++) {
          var cell = document.createElement("span");
          cell.className = "od-cell";
          cell.textContent = String((from + j) % 10);
          strip.appendChild(cell);
        }
        /* 目标格 + 末尾缓冲格（同一个字），给过冲留出余地而不露破绽 */
        for (var t = 0; t < 2; t++) {
          var tc = document.createElement("span");
          tc.className = "od-cell";
          tc.textContent = c;
          strip.appendChild(tc);
        }
        col.appendChild(strip);
        col.style.setProperty("--od-shift", String(span));
      } else {
        col.className += " od-sym";                        /* 千分位/点/百分号：静态一格 */
        var sc = document.createElement("span");
        sc.className = "od-cell";
        sc.textContent = c;
        col.appendChild(sc);
        col.style.setProperty("--od-shift", "0");
      }
      row.appendChild(col);
    }
    el.textContent = "";
    el.appendChild(row);
    var sr = document.createElement("span");
    sr.className = "sr-only";
    sr.textContent = val;
    el.appendChild(sr);
    el.classList.add("od");
    el.setAttribute("data-od-built", "1");
  }

  /* instant=true ⇒ 不给过渡（减动效、无观察器、重滚时用户已要求降低动效） */
  function odStart(el, instant) {
    if (!el || el.getAttribute("data-od-run") === "1") return;
    el.setAttribute("data-od-run", "1");
    /* 强制一次重排：刚插入的节点若与 .od-run 在同一帧生效，浏览器会把两次样式
       合并，transition 不触发、直接跳到终值——「动画没出来」的经典成因。 */
    void el.offsetWidth;
    if (instant || odReduced()) el.classList.add("od-static");
    el.classList.add("od-run");
    var cols = el.querySelectorAll(".od-col").length;
    window.setTimeout(function () {
      el.classList.remove("od-static");
      el.classList.add("od-done");                         /* 撤掉 will-change，别常驻合成层 */
    }, instant ? 0 : OD_CFG.DUR + cols * OD_CFG.STEP + 200);
  }

  function odInView(el) {
    var r = el.getBoundingClientRect();
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var vw = window.innerWidth || document.documentElement.clientWidth;
    return r.bottom > 24 && r.top < vh - 8 && r.right > 0 && r.left < vw;
  }

  function odVeilUp() {
    return !!(document.body && document.body.classList.contains("iv-lock"));
  }

  function odWant(el) {
    if (!el || el.getAttribute("data-od-run") === "1") return;
    if (odPending.indexOf(el) < 0) odPending.push(el);
    odMaybe();
  }

  function odMaybe() {
    if (odVeilUp()) return;                                /* 开屏帘还盖着：等它撤 */
    for (var i = odPending.length - 1; i >= 0; i--) {
      var el = odPending[i];
      if (!document.contains(el)) { odPending.splice(i, 1); continue; }
      if (odInView(el)) { odPending.splice(i, 1); odStart(el); }
    }
  }

  /* 开屏帘揭完才滚：帘子的生杀大权在 introVeil 手里，它只动 body.iv-lock 这一个信号 */
  function odWatchVeil() {
    if (odVeilWatch) return;
    odVeilWatch = true;
    if (!odVeilUp() || !window.MutationObserver) return;
    var mo = new MutationObserver(function () {
      if (!odVeilUp()) { mo.disconnect(); odMaybe(); }
    });
    mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }

  function odInitObs() {
    if (odTried) return;
    odTried = true;
    if (!("IntersectionObserver" in window)) return;
    odObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        odWant(en.target);
        odObs.unobserve(en.target);                        /* 一次性：滚回去不重播 */
      });
    }, { threshold: 0.35 });
  }

  function odScan() {
    if (!app) return;
    var nodes = app.querySelectorAll(OD_SEL);
    if (!nodes.length) return;
    odInitObs();
    odWatchVeil();
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.getAttribute("data-od-built") === "1") continue;
      odBuild(el);
      /* 减动效或没有观察器：不赌触发时机，当场给终值 */
      if (odReduced() || !odObs) { odStart(el, true); continue; }
      odObs.observe(el);
    }
  }

  /* 分屏切到某一屏时的放行入口（与 cvKick 同一时机） */
  function odKick(scope) {
    if (!scope || !scope.querySelectorAll) return;
    var els = scope.querySelectorAll(OD_SEL);
    for (var i = 0; i < els.length; i++) odWant(els[i]);
  }

  /* 数值变了就重滚：从当前显示的那一位接着滚，不是从 0 重来 */
  function odSet(el, val) {
    var node = typeof el === "string" ? document.querySelector(el) : el;
    if (!node || node.getAttribute("data-od-built") !== "1") return false;
    var old = node.getAttribute("data-od") || "";
    var v = String(val).trim();
    if (old === v) return false;                           /* 值没变：不空转 */
    var ran = node.getAttribute("data-od-run") === "1";
    odBuild(node, v, old);
    if (!ran) { odWant(node); return true; }               /* 还没首播：交给正常触发时机 */
    node.removeAttribute("data-od-run");
    node.classList.remove("od-run");
    node.classList.remove("od-done");
    void node.offsetWidth;
    odStart(node);
    return true;
  }

  /* 顶栏二级菜单的开合。桌面靠 CSS 悬停，这里只管触屏、抽屉与键盘：
     收起所有展开项（可留一个），并同步 aria-expanded。 */
  function closeNavMenus(except) {
    var bar = document.getElementById("navLinks");
    if (!bar) return;
    bar.querySelectorAll(".nav-item.open").forEach(function (it) {
      if (it === except) return;
      it.classList.remove("open");
      var c = it.querySelector(".nav-caret");
      if (c) c.setAttribute("aria-expanded", "false");
    });
  }

  /* 换页之后补三件事——都是单页应用的通病：内容整块换了，但页面没刷新。
     ① 播报：读屏软件不会主动说「页面换了」；
     ② 焦点：还留在上一页那个已经被 innerHTML 冲掉的链接上；
     ③ 宽表格：光有 overflow:auto，焦点进不去，键盘用户就滚不动它。 */
  /* 没有来路（直接落在本页）时回退无效果，退而回首页。
     v43 起悬浮返回键不再落在 #view 里，委托挂在 #view 上的点击收不到它，
     所以单独提出来给它直挂监听——两处共用同一份回退逻辑。 */
  function histBack() {
    if (history.length > 1) history.back();
    else location.hash = "#/";
  }

  /* 把吸顶栏的**视口下沿**写成按钮自己的 --tb-h（site.css 用它算 top）。
     量下沿而不是高度：页顶那条 .topline 会先滚走，顶栏窄屏还会换行长高
     （1440 下 57px、768 下 110px、390 下 147px），写死任何一个数都会错位。
     再与顶栏自己的高度取大：顶栏只可能有两种状态——还压在 .topline 下面
     （下沿 > 高），或者已经吸到顶（下沿 = 高）。若量出来的下沿比高度还小，
     说明这一刻 sticky 没生效（开屏锁 body.iv-lock 期间实测下沿 -510），
     这时按下沿算会把按钮顶到屏幕最上边去；取高度则稳稳停在顶栏该在的位置。
     写元素不写 :root —— 每帧改根上的自定义属性会让全树重算样式。 */
  function followCrumbBack(b) {
    b = b || document.getElementById("crumb-back");
    if (!b) return;
    var tb = document.querySelector(".topbar");
    if (!tb) return;
    var bot = Math.max(tb.offsetHeight, Math.round(tb.getBoundingClientRect().bottom), 0);
    if (b.style.getPropertyValue("--tb-h") === bot + "px") return;   /* 没变就别写 */
    b.style.setProperty("--tb-h", bot + "px");
  }

  var cbRaf = 0;
  function onCbScroll() {
    if (cbRaf) return;                        /* rAF 合帧：滚动多快都只算一次 */
    var f = function () { cbRaf = 0; followCrumbBack(); syncToTop(); };
    cbRaf = window.requestAnimationFrame ? window.requestAnimationFrame(f) : setTimeout(f, 16);
  }
  window.addEventListener("scroll", onCbScroll, { passive: true });
  window.addEventListener("resize", onCbScroll, { passive: true });

  /* ── 回到顶部：滚过一屏后浮现的悬浮键（v63） ────────────────────────────
     与 #crumb-back 同一处挂载：<body> 下、#view 之外（#view 的 .page-in 动画
     常驻 transform，fixed 后代会被它建立包含块，按钮就会跟着内容滚）。

     阈值取「六成屏高 / 420px 的较小值」再兜一个 240px 下限：
     短页即使不滚也不会冒出个用不上的按钮；长词条读两段就该能一键回头。
     显隐判定走 onCbScroll 的 rAF 合帧，滚动多快都只算一次；
     状态没变就不碰 DOM（classList.toggle 带 force 也不产生样式失效）。 */
  var toTopBtn = null, toTopOn = false;

  function ensureToTop() {
    if (toTopBtn && document.body.contains(toTopBtn)) return toTopBtn;
    var b = document.createElement("button");
    b.id = "to-top";
    b.className = "to-top";
    b.type = "button";
    b.setAttribute("aria-label", "回到页面顶部");
    b.title = "回到页面顶部";
    b.innerHTML = '<span class="tt-ar" aria-hidden="true">↑</span><span>顶部</span>';
    b.addEventListener("click", function () {
      var reduce = window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      try { window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" }); }
      catch (e) { window.scrollTo(0, 0); }        /* 老浏览器不认 options */
      /* 点完按钮自己会隐去，焦点不能跟着丢：交回页面主体
         （路由渲染时 #view 已带 tabindex=-1，这里只是复用）。 */
      try { app.focus({ preventScroll: true }); } catch (e2) { /* 略 */ }
      b.classList.remove("is-on");
      toTopOn = false;
    });
    document.body.appendChild(b);
    toTopBtn = b;
    return b;
  }

  function syncToTop() {
    var b = ensureToTop();
    var lim = Math.min(420, Math.max(240, window.innerHeight * 0.6));
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    var on = y > lim;
    if (on === toTopOn) return;                   /* 没跨过门槛：不碰 DOM */
    toTopOn = on;
    b.classList.toggle("is-on", on);
  }

  /* 首帧先建出来（隐藏态），免得第一次滚动才插入节点引发一次重排 */
  ensureToTop();
  syncToTop();

  /* 悬浮固定的「返回上一页」：每次渲染后补一颗（幂等，重渲染不叠加）。
     用 history.back() 而不是写死 #/——从词条页串到关联词条、从搜索点进来，
     回退的应该是来路，而不是永远回首页。
     ⚠ 必须挂在 <body> 下、#view 之外：#view 上常驻 .page-in 动画
     （@keyframes pageIn 的 to 写了 transform: none），计算值恒为
     matrix(1, 0, 0, 1, 0, 0) —— 不是 none —— 照样给 fixed 后代建立包含块。
     留在面包屑里的话 position: fixed 会退化成"相对 #view 定位"，
     按钮跟着页面一起滚（真机实测：滚动 500px，按钮 dy=-500）。
     代价是它离开了 #view 的事件委托与 Tab 顺序：现在紧跟顶栏、排在正文之前。 */
  function crumbBack() {
    var cur = document.getElementById("crumb-back");
    /* 没有面包屑的页（首页、门类卡页……）不放 */
    if (!app.querySelector(".crumb")) { if (cur) cur.remove(); return; }
    if (cur) { followCrumbBack(cur); return; }
    var b = document.createElement("button");
    b.id = "crumb-back";
    b.className = "crumb-back";            /* 保号：样式表与真机脚本都认这个类名 */
    b.type = "button";
    b.setAttribute("data-act", "hist-back");
    b.setAttribute("aria-label", "返回上一页");
    b.textContent = "← 上一页";
    b.addEventListener("click", histBack);
    /* 先把 --tb-h 写好再入文档：入完再写会让浏览器先按兜底值算一遍样式，
       top 就会从兜底值过渡到真值，刚进页面时按钮会自己滑一下。 */
    followCrumbBack(b);
    document.body.insertBefore(b, app);
  }

  function announceRoute(scope) {
    var h = scope.querySelector("h1");
    var live = document.getElementById("route-live");
    if (live) {
      live.textContent = (h ? h.textContent.replace(/\s+/g, " ").trim() : "页面") + "，已载入";
    }

    scope.querySelectorAll(".ta-scroll, .ct-scroll").forEach(function (box) {
      if (box.scrollWidth > box.clientWidth + 4) {
        box.setAttribute("tabindex", "0");
        box.setAttribute("role", "group");
        if (!box.getAttribute("aria-label")) box.setAttribute("aria-label", "表格，可横向滚动");
      }
    });

    /* 只在确实没有焦点时才接管，免得抢走搜索框、输入框或阅读器里的光标 */
    var ae = document.activeElement;
    if (!ae || ae === document.body || ae === document.documentElement) {
      try { scope.focus({ preventScroll: true }); }
      catch (e) { /* 老浏览器不认 preventScroll，退化成普通 focus */ }
    }
  }

  /* ================= 首次进入的引导弹窗（v65） =================
     两处入口各一份：概念关系图（#/graph，以及 工具台 → 概念关系图编辑器 走同一份文案、
     同一个键）、本地阅读器（#/reader）。

     三条硬约束：
     ① **只在首次进入自动展开**：关掉（× / 跳过 / 知道了 / Esc / 点遮罩）即写
        localStorage；隐私模式下 localStorage 会抛，退回 sessionStorage，再退回内存标记。
     ② **必须挂 body、#view 之外**：#view 常驻 .page-in（animation …both），transform 的
        计算值是 matrix(1,0,0,1,0,0)（不是 none），在它里面 position: fixed 会以此为
        包含块、跟着页面滚 —— 站内已经踩过两次（#crumb-back、.to-top）。
     ③ **内容只讲「这里能做什么」**：每行一条操作，键位用 .gd-key 胶囊标出，末行小字给
        一条最容易漏的提示；不写实现细节、不写版本号。 */
  var GUIDE_SEEN = { graph: 0, reader: 0, home: 0 };   /* 存储全不可用时的会话内兜底 */
  var guideBackFocus = null;
  var GUIDE = {
    graph: {
      key: "capital-guide-graph-v1",
      kicker: "概念关系图 · 操作指引",
      title: "一张可以读、也可以改的关系地图",
      lede: "节点是术语，连线是关系。先认清下面四种操作，其余边看边会。",
      rows: [
        ["左键", "点选节点或连线；按住节点拖动可摆位，从节点边缘拉线新建关系；在空白处拖拽是框选。"],
        ["中键拖动", "平移画布（右键拖动同样可以）。左键拖动留给框选，所以不会误移画面。"],
        ["滚轮", "以指针所在位置为中心缩放画布；只改看图比例，不改数据。"],
        ["Ctrl + 滚轮", "缩放整个页面（浏览器缩放），按钮与文字一起变大，投影讲解时用得上。"]
      ],
      tip: "左上角搜索框输入术语，可把它的关联一次铺到画布；右栏「联想」按关系强度推荐下一个该看的词。图上的改动只存在这台机器的浏览器里。"
    },
    reader: {
      key: "capital-guide-reader-v1",
      kicker: "本地阅读器 · 使用提示",
      title: "选中一个术语，直接跳到它的解释",
      lede: "文件只在浏览器本地打开，不上传服务器；读到哪、记到哪，也都留在这台机器上。",
      rows: [
        ["选中即查", "在正文里划选任意术语，浮标出现「查词条」，点一下直达解释；没有精确命中时给出相近的几条。"],
        ["书签", "顶栏「书签+」记下当前位置；抽屉按书分组，当前章节高亮，可改名、删除、跳转。"],
        ["阅读进度", "自动记住每本书读到第几章、百分之多少与累计时长，下次选同一份文件自动接上。"],
        ["工具栏", "鼠标靠近上边缘滑出：字号 A-/A+、滚动/翻页、日间/夜间、全屏；翻页模式用 ← → 键。"]
      ],
      tip: "PDF 交给浏览器内置阅读器渲染，暂不支持选词跳转；TXT 与 EPUB 可全部使用。"
    },
    /* v69：首页功能导览——第一次打开平台时介绍四个核心功能。
       与 graph/reader 的「rows 单页」不同，home 用 steps 分步：每步一个功能
       （名 + 一句话 + 落地链接），圆点可直接跳步，也可「一页看完」切成
       既有 gd-rows 单页形态。关闭语义与另外两处一致：任何关闭路径都写
       「已读」，之后不再自动弹出。 */
    home: {
      key: "capital-guide-home-v1",
      kicker: "平台导览 · 第一次来",
      title: "四个核心功能，三十秒上手",
      lede: "认全这四件，这个站就会用了；其余内容慢慢逛。",
      steps: [
        { name: "词条检索", href: "#/idx",
          text: "390 条《资本论》术语，支持汉字、全拼与拼音首字母缩写（如 syjz = 剩余价值）。顶栏搜索框全站可用，能直达词条、原典引文与争鸣观点。" },
        { name: "马克思画传", href: "#/pictorial",
          text: "卷轴式画册：马克思的生平按年代铺开，图像、手迹与说明卡逐段展开，像翻一本可以滚动的传记。" },
        { name: "概念关系图", href: "#/graph",
          text: "术语是节点、关系是连线：拖动摆位、滚轮缩放、点开节点看释义，还能自己画图——把它当作这门课的地图。" },
        { name: "文本分析", href: "#/tools/tt",
          text: "把读过的文献粘贴进来：自动识别《资本论》概念、算词频与覆盖度、做多文本比对——检验自己有没有把术语读进去。" }
      ],
      tip: "这四件的入口顶栏常驻；画传与关系图在首页也有快捷按钮。本弹窗只出现这一次，之后随时可从导航重新找到它们。"
    }
  };

  function guideKindOf(parts) {
    if (!parts) return "";
    /* v69：首页（无 hash 或 #/）——第一次打开平台就会落在这里 */
    if (!parts.length) return "home";
    if (parts[0] === "graph") return "graph";
    /* 工具台里的「概念关系图编辑器」是同一个编辑器，共用一份引导与一个「已读」标记 */
    if (parts[0] === "tools" && parts[1] === "path") return "graph";
    if (parts[0] === "reader") return "reader";
    return "";
  }

  function guideSeen(kind) {
    var g = GUIDE[kind];
    if (!g) return true;
    if (GUIDE_SEEN[kind]) return true;
    try { if (localStorage.getItem(g.key)) return true; } catch (e) { /* 隐私模式等 */ }
    try { if (sessionStorage.getItem(g.key)) return true; } catch (e) { /* 同上 */ }
    return false;
  }

  function guideMark(kind) {
    var g = GUIDE[kind];
    if (!g) return;
    GUIDE_SEEN[kind] = 1;
    try { localStorage.setItem(g.key, "1"); } catch (e) { /* 存不了就靠内存 */ }
    try { sessionStorage.setItem(g.key, "1"); } catch (e) { /* 同上 */ }
  }

  function guideClose(mark) {
    var m = document.getElementById("gd-mask");
    if (!m) return;
    var kind = m.getAttribute("data-kind");
    if (mark !== false) guideMark(kind);
    document.removeEventListener("keydown", guideKey, true);
    m.remove();
    /* 焦点交回它来时的位置（通常是正文），读屏用户不会「丢焦点」 */
    var back = guideBackFocus;
    guideBackFocus = null;
    if (back && back.focus && document.contains(back)) {
      try { back.focus({ preventScroll: true }); } catch (e) { /* 老浏览器忽略参数 */ }
    }
  }

  /* Esc 关闭 + Tab 在卡片内循环（aria-modal 的对话框不该把焦点漏回背景） */
  function guideKey(ev) {
    var m = document.getElementById("gd-mask");
    if (!m) return;
    if (ev.key === "Escape") { ev.preventDefault(); guideClose(true); return; }
    if (ev.key !== "Tab") return;
    var f = m.querySelectorAll("button, [href], input, [tabindex]:not([tabindex='-1'])");
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }

  function guideOpen(kind) {
    var g = GUIDE[kind];
    if (!g || !document.body) return;
    if (document.getElementById("gd-mask")) return;   /* 已经开着就不再叠一层 */
    guideBackFocus = document.activeElement;
    /* v69：首页导览是分步形态，交给专门的渲染器 */
    if (g.steps) { guideOpenSteps(kind, g); return; }
    var rows = g.rows.map(function (r) {
      return '<li class="gd-row"><b class="gd-key">' + esc(r[0]) + "</b><span>" + esc(r[1]) + "</span></li>";
    }).join("");
    var mask = document.createElement("div");
    mask.id = "gd-mask";
    mask.className = "gd-mask";
    mask.setAttribute("data-kind", kind);
    mask.innerHTML =
      '<div class="gd-card" role="dialog" aria-modal="true" aria-labelledby="gd-title" aria-describedby="gd-lede">' +
        '<button type="button" class="gd-x" aria-label="关闭引导">×</button>' +
        '<p class="gd-kicker">' + esc(g.kicker) + "</p>" +
        '<h2 class="gd-title" id="gd-title">' + esc(g.title) + "</h2>" +
        '<p class="gd-lede" id="gd-lede">' + esc(g.lede) + "</p>" +
        '<ul class="gd-rows">' + rows + "</ul>" +
        '<p class="gd-tip">' + esc(g.tip) + "</p>" +
        '<div class="gd-acts">' +
          '<button type="button" class="gd-skip">跳过</button>' +
          '<button type="button" class="gd-ok">知道了</button>' +
        "</div>" +
      "</div>";
    document.body.appendChild(mask);
    mask.querySelector(".gd-ok").addEventListener("click", function () { guideClose(true); });
    mask.querySelector(".gd-skip").addEventListener("click", function () { guideClose(true); });
    mask.querySelector(".gd-x").addEventListener("click", function () { guideClose(true); });
    /* 点遮罩关；点卡片内部不关（冒泡到 mask 时 target 才会是 mask 本身） */
    mask.addEventListener("click", function (ev) { if (ev.target === mask) guideClose(true); });
    document.addEventListener("keydown", guideKey, true);
    /* 等入场动画起势再落焦点，避免焦点环在位移过程中被画在错位置 */
    setTimeout(function () {
      var b = mask.querySelector(".gd-ok");
      if (!b) return;
      try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); }
    }, 60);
  }

  /* v69：首页导览的分步渲染器。每步一格（功能名 + 一句话 + 去看看），
     底部圆点直接跳步；「一页看完」切成既有 gd-rows 单页形态，再点「分步看」切回。
     关闭路径（× / 跳过 / Esc / 点遮罩 / 末步「开始使用」）统一走 guideClose(true)——
     与 graph/reader 相同：只要关过一次，就写「已读」不再自动弹。 */
  function guideOpenSteps(kind, g) {
    var step = 0, flat = false;
    var mask = document.createElement("div");
    mask.id = "gd-mask";
    mask.className = "gd-mask";
    mask.setAttribute("data-kind", kind);   /* guideClose 靠它回写「已读」 */
    mask.innerHTML =
      '<div class="gd-card gd-steps" role="dialog" aria-modal="true" aria-labelledby="gd-title" aria-describedby="gd-lede">' +
        '<button type="button" class="gd-x" aria-label="关闭引导">×</button>' +
        '<p class="gd-kicker">' + esc(g.kicker) + "</p>" +
        '<h2 class="gd-title" id="gd-title">' + esc(g.title) + "</h2>" +
        '<p class="gd-lede" id="gd-lede">' + esc(g.lede) + "</p>" +
        '<div class="gd-stage"></div>' +
        '<div class="gd-dots">' + g.steps.map(function (s, i) {
          return '<button type="button" class="gd-dot" data-i="' + i +
            '" aria-label="第 ' + (i + 1) + " 步：" + esc(s.name) + '"></button>';
        }).join("") + "</div>" +
        '<p class="gd-tip">' + esc(g.tip) + "</p>" +
        '<div class="gd-acts">' +
          '<button type="button" class="gd-flat">一页看完</button>' +
          '<button type="button" class="gd-skip">跳过</button>' +
          '<button type="button" class="gd-prev">上一步</button>' +
          '<button type="button" class="gd-ok">下一步</button>' +
        "</div>" +
      "</div>";
    document.body.appendChild(mask);

    var stage = mask.querySelector(".gd-stage"),
        dots = mask.querySelectorAll(".gd-dot"),
        prev = mask.querySelector(".gd-prev"),
        next = mask.querySelector(".gd-ok"),
        flatBtn = mask.querySelector(".gd-flat");

    function paint() {
      mask.querySelector(".gd-steps").classList.toggle("is-flat", flat);
      if (flat) {
        stage.innerHTML = '<ul class="gd-rows">' + g.steps.map(function (s) {
          return '<li class="gd-row"><b class="gd-key">' + esc(s.name) + "</b><span>" +
            esc(s.text) + "</span></li>";
        }).join("") + "</ul>";
        flatBtn.textContent = "分步看";
        return;
      }
      var s = g.steps[step];
      stage.innerHTML = '<div class="gd-step"><b class="gd-fn">' + esc(s.name) + "</b>" +
          '<p class="gd-step-text">' + esc(s.text) + "</p>" +
          (s.href ? '<a class="gd-go" href="' + esc(s.href) + '">去看看 →</a>' : "") +
        "</div>";
      prev.hidden = step === 0;
      next.textContent = step === g.steps.length - 1 ? "开始使用" : "下一步";
      flatBtn.textContent = "一页看完";
      for (var i = 0; i < dots.length; i++) {
        dots[i].classList.toggle("on", i === step);
      }
    }

    next.addEventListener("click", function () {
      if (flat) { guideClose(true); return; }
      if (step < g.steps.length - 1) { step++; paint(); }
      else guideClose(true);
    });
    prev.addEventListener("click", function () { if (step > 0) { step--; paint(); } });
    flatBtn.addEventListener("click", function () { flat = !flat; paint(); });
    mask.querySelector(".gd-skip").addEventListener("click", function () { guideClose(true); });
    mask.querySelector(".gd-x").addEventListener("click", function () { guideClose(true); });
    for (var di = 0; di < dots.length; di++) {
      (function (d) {
        d.addEventListener("click", function () {
          flat = false; step = +d.getAttribute("data-i"); paint();
        });
      })(dots[di]);
    }
    mask.addEventListener("click", function (ev) { if (ev.target === mask) guideClose(true); });
    document.addEventListener("keydown", guideKey, true);
    setTimeout(function () {
      try { next.focus({ preventScroll: true }); } catch (e) { next.focus(); }
    }, 60);
    paint();
  }

  /* 路由钩子：进到这两页且没看过才排队弹出；离开页面则收起并记为已读 */
  function guideOnRoute(parts) {
    var kind = guideKindOf(parts);
    var open = document.getElementById("gd-mask");
    if (open) {
      if (open.getAttribute("data-kind") === kind) return;  /* 同页重渲染不重弹 */
      guideClose(true);
    }
    if (!kind || guideSeen(kind)) return;
    /* 等本页渲染、滚动复位与入场动画起势之后再弹，遮罩出现时页面已停稳 */
    var tries = 0;
    function arm() {
      if (document.getElementById("gd-mask")) return;
      if (guideKindOf(hashParts().parts) !== kind) return;   /* 期间已经换页 */
      /* 开屏帘 z 2000 盖在引导（z 1400）之上：帘子还在就先别弹，
         否则用户只看见帘子，引导等于白开。等它撤掉再弹。
         首次访客必然先撞见帘子（要滚动/点击才退场），首页导览多等一会——
         120 次 × 500ms = 1 分钟，超出才放弃；graph/reader 走到时帘子通常已撤。 */
      if (document.getElementById("intro-veil")) {
        if (++tries > (kind === "home" ? 120 : 30)) return;
        setTimeout(arm, 500);
        return;
      }
      guideOpen(kind);
    }
    setTimeout(arm, 240);
  }

  function route() {
    var hp = hashParts();
    var parts = hp.parts, q = hp.q;
    var html, after = null, canonical = null;

    /* 换页就把两页的页内状态清掉：它们是「当前那一页」的，留着会让
       别处的就地更新打到已经消失的节点上。 */
    IDX_ST = null;
    OV_ST = null;

    /* 换了页就把顶栏菜单收起来：桌面靠悬停的二级菜单，靠 :focus-within 撑着，
       刚点过的那根链接还留着焦点，不主动收就会一直挂在页面上挡视线。 */
    closeNavMenus();
    pjClose();      // 投影是全屏浮层，换页必须收掉，否则盖在新页面上
    /* v51：搜索候选框被挪到 body 下（为了脱离 #view 的 fixed 包含块），
       换页时不会随 innerHTML 一起销毁，得在这里显式清掉，否则离开首页
       再回来就会多留一个空框。
       ⚠ 只清「已经不在页面里」的（`!document.getElementById(rs[i].id)` 为真）。
         顶栏搜索框 #topR 是**常驻元素**、同样在 body 下，它好好的不能删 ——
         第一版没判这一条，把顶栏搜索直接删没了（实测 #topR 从此消失、顶栏搜索彻底失效）。
         判据必须是「页面里已无此 id 的引用」，不是「id 不等于当前这个」。 */
    (function () {
      var rs = document.querySelectorAll("body > .results");
      for (var i = 0; i < rs.length; i++) {
        if (document.getElementById(rs[i].id)) continue;   /* 仍被页面引用 ⇒ 保留 */
        rs[i].innerHTML = ""; rs[i].hidden = true; rs[i].remove();
      }
    })();
    picUnbind();    // 画传预览的载入超时计时器也随换页清掉，免得打到已经消失的节点上
    readerDropLookup();   // 阅读器的「选中即查」浮标也随换页收掉
    /* v58：离开阅读器时结算阅读时长与滚动节流。不做的话，
       「读着书直接点导航去别的页」这段时间永远丢，计时器还在后台跑。 */
    if (rdTimer) { rdRecTouch(); rdTimeStop(); }
    if (rdScrollT) { clearTimeout(rdScrollT); rdScrollT = 0; }
    RD.resume = null;     // 续读目标是「下一次打开」用的，换页作废
    /* 首页分屏的滚轮/键盘/触摸监听必须随换页卸掉：留着会把别的页面的滚动吃掉 */
    if (hpCleanup) { hpCleanup(); hpCleanup = null; }
    document.body.classList.toggle("rd-on", parts[0] === "reader");   // 阅读页放宽栏宽
    var ae = document.activeElement;
    if (ae && ae.closest && ae.closest(".navlinks")) { try { ae.blur(); } catch (e) { /* 旧浏览器不给 blur 也无所谓 */ } }

    if (!parts.length) { html = viewHome(); after = function () { homePager(); homeDuoInit(); }; }
    else if (parts[0] === "t") { html = viewTerm(parts[1] || ""); after = deepFlash; }
    else if (parts[0] === "c") html = viewCat(parts[1] || "", q);

    /* 索引（v43 两页合一）：#/idx?m=alpha|tag[&l=A][&k=place] */
    else if (parts[0] === "idx") html = viewIndexPage(idxState(q));
    /* 总览（v43 两页合一）：#/tax 是门类视图，#/tax?v=tree 是三卷目录树 */
    else if (parts[0] === "tax") { var stO0 = ovState(q); html = viewOverview(stO0); after = stO0.v === "tree" ? vt3Init : null; }

    /* —— 下面四条是 v43 之前的旧地址。它们仍然进得来，只是渲染的已经是合并后的那一页，
       地址栏随后静默归一到规范地址（replaceState 不触发 hashchange，所以只规范化地址、
       不重画）。站内几十处老链接、以及读者收藏过的链接因此一个都不用改。 —— */
    else if (parts[0] === "i") {
      var stI = idxState({ m: "alpha", l: parts[1] || "" });
      html = viewIndexPage(stI); canonical = idxUrl(stI);
    }
    else if (parts[0] === "tags") {
      var stG = idxState({ m: "tag", k: parts[1] || "topic" });
      html = viewIndexPage(stG); canonical = idxUrl(stG);
    }
    else if (parts[0] === "tree") {
      var stO = ovState({ v: "tree" });
      html = viewOverview(stO); after = vt3Init; canonical = ovUrl(stO);
    }
    /* 「关于」页已撤除（v66）。旧地址 #/statement 与 #/about 仍然进得来，
       只是渲染首页、地址栏静默归一到 #/ —— 站外旧链接与读者收藏不会撞见 404。 */
    else if (parts[0] === "statement" || parts[0] === "about") {
      html = viewHome(); after = function () { homePager(); homeDuoInit(); }; canonical = "#/";
    }

    else if (parts[0] === "tg") {
      var tn = parts.slice(1).join("/");
      try { tn = decodeURIComponent(tn); } catch (e) { /* 有些标签含 % 号，解不开就用原串 */ }
      html = viewTag(tn);
    }
    else if (parts[0] === "pictorial") { html = viewPictorial(); after = picBind; }
    /* 「儿童绘本」已并入画册（v49）。旧地址 #/book 走这条别名：渲染的已经是画册，
       地址栏随后静默归一到 #/pictorial（replaceState 不触发 hashchange，只改地址不重画）。
       保留别名而不是直接 404，是为了站内外的旧链接与读者收藏过的地址都还进得来。 */
    else if (parts[0] === "book") { html = viewPictorial(); after = picBind; canonical = "#/pictorial"; }
    else if (parts[0] === "tools") {
      /* #/tools 是总览；#/tools/<id> 直接落到那件工具，便于顶栏巨型菜单深链 */
      html = viewTools(parts[1] || "");
      after = function () {
        renderTtFiles(); renderTextTool(); renderTa();
        bindQuoteTool(); bindCompareTool(); bindWriteTools(); bindStudyTools();
        bindPathTool(); bindCalcTool(); bindChrono(); bindHandout(); bindWriter();
        bindChartTool();
      };
    }
    /* 关系图：画布在 pathflow.html，本页只把它托起来（见 viewGraph 的注释） */
    else if (parts[0] === "graph") { html = viewGraph(); after = bindPathTool; }
    /* 使用手册：纯静态的图文说明书，靠锚点跳章节，不需要额外绑定 */
    else if (parts[0] === "manual") { html = viewManual(); after = manualAfter; }
    else if (parts[0] === "reader") { html = viewReader(); after = readerInit; }
    else html = '<p class="empty">页面不存在。<a href="#/">回到首页</a></p>';

    app.innerHTML = html;
    if (canonical) setHashQuiet(canonical);
    crumbBack();

    /* 导航高亮：子路由归到它所属的一级项。点的是「索引」页里的某个字母、
       某个标签，高亮的仍应是「索引」；总览下的门类页、目录树同理。
       不这么归，一级导航除了点它自己就老是暗的。 */
    var NAV_PARENT = {
      "": "",
      "t": "tax", "c": "tax", "tree": "tax", "tax": "tax",
      "idx": "idx", "i": "idx", "tags": "idx", "tg": "idx",
      "tools": "tools",
      "graph": "graph",
      "reader": "reader",
      "manual": "manual",
      "pictorial": "", "book": ""    };
    var cur = NAV_PARENT.hasOwnProperty(parts[0] || "") ? NAV_PARENT[parts[0] || ""] : "";
    document.querySelectorAll(".navlinks a").forEach(function (a) {
      var hit = a.getAttribute("data-route") === cur;
      a.classList.toggle("on", hit);
      /* 高亮不能只靠颜色：读屏软件看不到 .on 的底色，得给 aria-current */
      if (hit) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });

    /* 换页播报 + 焦点落点。单页应用换 hash 不刷新，读屏软件无从知晓，
       焦点也还留在上一页那个已经消失的链接上——这两件事必须脚本补。 */
    announceRoute(app);

    /* 门类卡的错峰入场必须在 homePager 之前挂好：homePager 的首次 paint()
       就会调 reveal(pages[0])，那时卡片得已经是 .cv 初始态，放行才有东西可放。 */
    cvScan();
    /* 数据带的数字滚轮（v35）也要在 homePager 首次 paint 之前建好，
       否则 reveal() 里的 odKick() 找不到已经挂上的滚轮 */
    odScan();
    if (after) after();
    /* v65：首次进入概念关系图 / 阅读器时弹一次引导（已读判断与收起都在函数内） */
    guideOnRoute(parts);

    /* 换页进场动画：重挂 class 重放 keyframes（减动效偏好下由 CSS 关掉） */
    app.classList.remove("page-in");
    void app.offsetWidth;
    app.classList.add("page-in");
    renderDockStats();   // 悬浮台里的进度与「继续读」跟着路由刷新
    window.scrollTo(0, 0);
    rvScan();            // 新页面挂上滚动入场（已在视口内的元素由观察器立即放行）
  }

  document.addEventListener("DOMContentLoaded", function () {
    app = document.getElementById("view");
    /* 跳转链接：把焦点送进正文区，随后的 Tab 就从正文里第一个可聚焦元素接着走 */
    var skip = document.querySelector("[data-skip]");
    if (skip) {
      skip.addEventListener("click", function () {
        try { app.focus({ preventScroll: true }); } catch (e) { app.focus(); }
        /* scrollIntoView 在老环境里可能没有，没有就罢了——焦点已经进正文了 */
        if (app.scrollIntoView) {
          try { app.scrollIntoView({ block: "start" }); } catch (e) { /* 参数不支持也不影响 */ }
        }
      });
    }
    /* 「/」聚焦搜索：词典站的通用键盘约定（维基、MDN 都这么干）。
       输入框里按斜杠当然要照常打出字符，所以只在焦点不在输入控件时才接管。 */
    document.addEventListener("keydown", function (e) {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      var a = document.activeElement;
      if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable)) return;
      var q = document.getElementById("topQ");
      if (!q) return;
      e.preventDefault();
      q.focus();
      try { q.select(); } catch (err) { /* select 在某些输入类型上不给用，focus 到了就够 */ }
    });

    attachSearch(document.getElementById("topQ"), document.getElementById("topR"));
    var hq = document.getElementById("heroQ");
    if (hq) attachSearch(hq, document.getElementById("heroR"));

    /* 索引页 / 总览页的分段控件与子状态：每一枚都是「真链接 + 就地更新」。
       拦下点击 → 改地址 → 只重画变的那一块，路由不重跑（滚动位置、键盘焦点、
       甚至输入到一半的搜索框都保住）。href 仍是真的，所以中间键新窗打开、
       右键复制链接、禁用脚本的老环境，三条路都照旧可用。
       Ctrl/⌘/Shift/中键点击一律放行给浏览器——那是「在新窗里打开」的意思。 */
    app.addEventListener("click", function (ev) {
      var a = ev.target && ev.target.closest ? ev.target.closest("[data-idx-go],[data-ov-go]") : null;
      if (!a || !app.contains(a)) return;
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button) return;
      ev.preventDefault();
      var fromSeg = !!a.closest(".idx-seg");
      if (a.hasAttribute("data-idx-go")) idxGo(a.getAttribute("data-idx-go"), fromSeg);
      else ovGo(a.getAttribute("data-ov-go"), fromSeg);
    });

    /* 分段控件左右方向键切换（roving tabindex 的标准做法）：点一下 .click()
       就复用上面那条点击路径，不另写一套状态更新。 */
    app.addEventListener("keydown", function (ev) {
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      var seg = ev.target && ev.target.closest ? ev.target.closest(".idx-seg") : null;
      if (!seg) return;
      var tabs = Array.prototype.slice.call(seg.querySelectorAll(".ttab"));
      var i = tabs.indexOf(ev.target);
      if (i < 0) return;
      ev.preventDefault();
      tabs[(i + (ev.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length].click();
    });

    /* 词条页工具条与引文复制按钮。委托绑在 #view 上——
       它的内容会被 innerHTML 整体替换，但壳子本身不变，所以只需绑一次。 */
    app.addEventListener("click", function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest("[data-copy],[data-act],[data-lr]") : null;
      if (!el || !app.contains(el)) return;
      var lr = el.getAttribute("data-lr");
      if (lr) {
        var id = el.closest("[data-term]");
        if (!id) return;
        id = id.getAttribute("data-term");
        if (lr === "read") {
          var v = !LR.isRead(id);
          LR.setRead(id, v);
          el.classList.toggle("on", v);
          el.textContent = v ? "✓ 已读" : "标记已读";
        } else if (lr === "star") {
          var s = !LR.isStar(id);
          LR.setStar(id, s);
          el.classList.toggle("on", s);
          el.textContent = s ? "★ 在生词本" : "＋ 生词本";
        }
        return;
      }
      var cp = el.getAttribute("data-copy");
      if (cp != null) { copyText(cp, el); return; }
      var act = el.getAttribute("data-act");
      if (act === "print") window.print();
      /* 页内跳转（使用手册目录的章节按钮）。href 只是给「新窗打开/复制链接」用的，
         这里必须拦掉默认导航，否则改 hash 会被当成换页、把刚滚到的位置又顶回顶部。 */
      else if (act === "jump") {
        ev.preventDefault();
        var jt = el.getAttribute("data-target");
        var jh = el.getAttribute("href");
        if (jh) setHashQuiet(jh);
        jumpTo(jt);
      }
      else if (act === "hist-back") histBack();
      else if (act === "link") copyText(location.href, el);
      else if (act === "tt-run") { renderTextTool(); renderTa(); }
      else if (act === "mt-dom-clear") { MT.doms = []; renderMt(); }   /* v57：板块筛选一键清空 */
      else if (act === "ta-xlsx") {
        var sheets = taSheets(el.getAttribute("data-k"));
        if (sheets) taDownload("文本分析-" + el.getAttribute("data-k") + ".xlsx", sheets);
      }
      else if (act === "ta-png") {
        var pngHost = document.getElementById(el.getAttribute("data-target") || "ta-net");
        if (pngHost) exportGraphPng(pngHost.querySelector("svg"), el.getAttribute("data-file") || "聚类网络图.png");
      }
      /* —— 写作辅助：检索词与检索式 · 笔记板 · 多语术语对照表 —— */
      else if (act === "kw-pick") {
        KW.dom = el.getAttribute("data-dom") || "";
        renderKw();
      }
      /* v50：清除搜索。焦点交还给输入框，连着改词不用再点一次。 */
      else if (act === "kw-clear") {
        KW.q = "";
        renderKw();
        var nq = document.getElementById("kw-q");
        if (nq) nq.focus();
      }
      else if (act === "wa-kw-word") docxDownload(cmFileName("检索词与检索式", "docx"), kwBlocks());
      else if (act === "nbm-add") { nbMapLoad(); nbMapAdd(+el.getAttribute("data-id") || 1, ""); renderNbMap(); }
      else if (act === "nbm-del") { nbMapDel(+el.getAttribute("data-id")); renderNbMap(); }
      else if (act === "nbm-md") dlText(cmFileName("笔记导图", "md"), nbMapMarkdown(), "text/markdown;charset=utf-8");
      else if (act === "nbm-import") {
        var nbmIn = document.getElementById("nbm-term");
        var r = nbMapImport(nbmIn ? nbmIn.value : "");
        if (r && r.node) { nbmIn.value = ""; nbMapSay("已把「" + r.term.term + "」导入为子节点。"); renderNbMap(); }
        else nbMapSay("没找到这条词条：输完整的词条名或别名再试。");
      }
      else if (act === "wa-mt-xlsx") taDownload(cmFileName("多语术语对照表", "xlsx"),
        [{ name: "术语对照表", rows: mtRows() }]);
      else if (act === "wa-mt-csv") dlText(cmFileName("多语术语对照表", "csv"), "\ufeff" + mtCsv(), "text/csv;charset=utf-8");
      else if (act === "wa-mt-word") docxDownload(cmFileName("多语术语对照表", "docx"), mtBlocks());
      else if (act === "wa-mt-md") copyText(mtMarkdown(), el);
      /* —— 学习与记忆：自测 · 间隔重复卡 · 生词卡 —— */
      else if (act === "qz-new") { quizReset(QZ.scope, QZ.n); qzRepaint(); }
      else if (act === "qz-wrong") {
        quizReset("wrong", QZ.n);
        qzRepaint();
        var qw = document.getElementById("quiz");
        if (qw && qw.scrollIntoView) qw.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      else if (act === "qz-clear") { QZ.answers = {}; renderQuiz(); }
      else if (act === "qz-submit") {
        QZ.result = quizMark(QZ.paper, QZ.answers);
        QZ.graded = true;
        LR.quizLog(QZ.result.n, QZ.result.ok, QZ.scope, QZ.result.wrongIds, QZ.result.rightIds);
        qzRepaint();
      }
      else if (act === "srs-show") { SRS.show = true; renderSrs(); }
      else if (act === "srs-0" || act === "srs-1" || act === "srs-2") {
        var card = el.closest ? el.closest(".srs-card") : null;
        if (card) srsGrade(card.getAttribute("data-id"), +act.slice(-1));
        SRS.show = false;
        srsRepaint();
      }
      else if (act === "srs-again") { srsPullForward(); SRS.show = false; srsRepaint(); }
      else if (act === "srs-reset") {
        if (window.confirm("把所有卡的排期清零，当作新卡重新开始？已读、生词本不受影响。")) {
          LR.srsReset(); SRS.show = false; srsRepaint();
        }
      }
      else if (act === "cd-csv") {
        var rows = cardRows(CD.scope);
        if (rows.length) dlText(cmFileName("术语卡-Anki", "csv"), "\ufeff" + cardCsv(rows), "text/csv;charset=utf-8");
      }
      else if (act === "cd-word") {
        var rowsW = cardRows(CD.scope);
        if (rowsW.length) docxDownload(cmFileName("术语卡", "docx"), cardBlocks(rowsW));
      }
      else if (act === "cd-md") copyText(cardMarkdown(cardRows(CD.scope)), el);
      else if (act === "ch-word") docxDownload(cmFileName("资本论大事年表", "docx"), chronoBlocks());
      else if (act === "ch-md") copyText(chronoMarkdown(), el);
      else if (act === "hd-add") { if (hdAdd(el.getAttribute("data-id"))) renderHd(); }
      else if (act === "hd-del") { hdDel(el.getAttribute("data-id")); renderHd(); }
      else if (act === "hd-fill") hdFill();
      else if (act === "hd-clear") {
        if (HD.picks.length && window.confirm("把讲义清空？词条本身、已读与生词本都不受影响。")) {
          HD.picks = []; hdSave(); renderHd();
        }
      }
      else if (act === "hd-word") {
        if (HD.picks.length) docxDownload(cmFileName("术语讲义", "docx"), hdBlocks());
      }
      else if (act === "hd-md") {
        if (HD.picks.length) copyText(hdMarkdown(), el);
      }
      else if (act === "hd-print") {
        if (HD.picks.length) window.print();
      }
      else if (act === "pj-open") pjOpen(hdTerms(), 0);
      else if (act === "pj-close") pjClose();
      else if (act === "pj-next") pjGo(1);
      else if (act === "pj-prev") pjGo(-1);
      else if (act === "pj-lg") { PJ.lg = !PJ.lg; pjRender(); }
      /* —— 写作台：结构操作重绘面板，正文编辑在 bindWriter 里就地写回 —— */
      else if (act === "wt-add-term") {
        wtEnsure();
        var wtn = wtAddTerm(el.getAttribute("data-id"));
        var wtd = wtDoc();
        el.textContent = wtn ? "已加入 " + wtn + " 张卡" : "加入写作台";
        el.classList.add("done");
        var oldT = el.__oldT || "加入写作台";
        el.__oldT = oldT;
        setTimeout(function () { el.textContent = oldT; el.classList.remove("done"); }, 1800);
        wtToast(wtn ? "已把 " + wtn + " 张卡片收进写作台的「" + (wtSec().h || "当前章节") +
          "」（文稿： " + wtd.title + "）" : "这个词条没有可收的内容。");
      }
      else if (act === "wt-new") {
        wtEnsure();
        var nd = { id: wtId("d"), title: "未命名文稿", secs: [wtNewSec("一、引言")] };
        WT.docs.push(nd);
        WT.cur = nd.id;
        WT.sel = nd.secs[0].id;
        wtSave(); wtRender();
        wtSay("新建了一篇文稿。");
      }
      else if (act === "wt-doc-del") {
        wtEnsure();
        if (WT.docs.length <= 1) wtSay("至少留一篇文稿，先把这篇的内容清空更稳妥。");
        else if (window.confirm("删掉《" + (wtDoc().title || "未命名文稿") + "》这一篇？这一篇的卡片不会保留。")) {
          var di = WT.docs.findIndex(function (d) { return d.id === WT.cur; });
          WT.docs.splice(di, 1);
          WT.cur = WT.docs[0].id;
          WT.sel = WT.docs[0].secs[0].id;
          wtSave(); wtRender();
        }
      }
      else if (act === "wt-sec-add") {
        wtEnsure();
        var ns = wtNewSec("新的一节");
        wtDoc().secs.push(ns);
        WT.sel = ns.id;
        wtSave(); wtRender();
        var nh = document.getElementById("wt-sec-h");
        if (nh) nh.focus();
      }
      else if (act === "wt-open") {
        WT.sel = el.getAttribute("data-id");
        wtSave(); wtRender();
      }
      else if (act === "wt-sec-up" || act === "wt-sec-down") {
        wtMove(wtDoc().secs, el.getAttribute("data-id"), act === "wt-sec-up" ? -1 : 1);
        wtSave(); wtRender();
      }
      else if (act === "wt-sec-del") {
        var ds = wtDoc();
        if (ds.secs.length <= 1) wtSay("最后一节留着吧——删空了大纲就没地方放卡片。");
        else if (window.confirm("删掉这一节以及节里的 " +
          (wtSecById(el.getAttribute("data-id")) || { cards: [] }).cards.length + " 张卡？")) {
          var si = ds.secs.findIndex(function (s) { return s.id === el.getAttribute("data-id"); });
          ds.secs.splice(si, 1);
          WT.sel = ds.secs[0].id;
          wtSave(); wtRender();
        }
      }
      else if (act === "wt-card-add") {
        var kind = el.getAttribute("data-kind");
        wtSec().cards.push({ id: wtId("c"), kind: kind, text: "", cite: "" });
        wtSave(); wtRender();
        var last = document.querySelector("#wt-cards li:last-child .wt-ta");
        if (last) last.focus();
      }
      else if (act === "wt-up" || act === "wt-down") {
        wtMove(wtSec().cards, el.getAttribute("data-id"), act === "wt-up" ? -1 : 1);
        wtSave(); wtRender();
      }
      else if (act === "wt-del") {
        var sec0 = wtSec();
        var ci = sec0.cards.findIndex(function (c) { return c.id === el.getAttribute("data-id"); });
        if (ci > -1) { sec0.cards.splice(ci, 1); wtSave(); wtRender(); }
      }
      else if (act === "wt-word") {
        if (!wtStats().cards) wtSay("这一稿还没有卡片，先收点素材再导出。");
        else docxDownload(cmFileName((wtDoc().title || "未命名文稿") + "-草稿", "docx"), wtBlocks());
      }
      else if (act === "wt-md") {
        if (!wtStats().cards) wtSay("这一稿还没有卡片。");
        else copyText(wtMarkdown(), el);
      }
      else if (act === "wt-copy-cite") {
        var fnl = wtFootnotes(wtDoc().secs).list;
        if (!fnl.length) wtSay("还没有带出处的卡片。");
        else copyText(fnl.map(function (x, i) { return "[" + (i + 1) + "] " + x; }).join("\n"), el);
      }
      else if (act === "wt-clear") {
        if (wtSec().cards.length && window.confirm("清空这一节的 " + wtSec().cards.length + " 张卡？")) {
          wtSec().cards = [];
          wtSave(); wtRender();
        }
      }
      else if (act === "wt-print") {
        if (wtStats().cards) window.print();
      }
      else if (act === "tt-choose") {
        /* 透明 input 就埋在拖放区里，它的 click 会冒泡回来——
           不挡住就会「点一下 → 触发 input.click() → 又冒泡回来」地无限递归 */
        if (ev.target && ev.target.id === "tt-file") return;
        ttChoose();
      }
      else if (act === "tt-filedel") ttDrop(+el.getAttribute("data-idx"));
      /* —— 图表生成（v70）：文件选择、推荐切换、导出 —— */
      else if (act === "ch-choose") {
        if (ev.target && ev.target.id === "ch-file") return;
        var chF = document.getElementById("ch-file");
        if (chF) chF.click();
      }
      else if (act === "ch-filedel") {
        var chIdx = +el.getAttribute("data-idx");
        if (chIdx === CH.doc) { CH.doc = 0; CH.sheet = 0; }
        else if (chIdx < CH.doc) CH.doc--;
        CH.docs.splice(chIdx, 1);
        if (!CH.docs.length) { CH.cfg = null; CH.type = ""; CH.profile = null; CH.rec = null; }
        else chResetSheet();
        chDocsRender(); chDataRender();
      }
      else if (act === "ch-type") {
        CH.type = el.getAttribute("data-id") || CH.type;
        chDataRender();
      }
      else if (act === "ch-png") chExportPng();
      else if (act === "ch-svg") chExportSvg();
      else if (act === "ct-add") ctAdd(el.getAttribute("data-id"));
      else if (act === "ct-del") ctDel(el.getAttribute("data-id"));
      else if (act === "ct-clear") { CT.picks = []; ctSave(); renderCompare(); }
      else if (act === "tt-clear") {
        ttSetText("");
        ttDocs = [];
        renderTtFiles();
        ttMsg("");
        renderTextTool();
        renderTa();
      }
    });

    /* 选文件 / 拖文件。委托绑在 #view：drop 区是 #view 里重绘出来的，
       绑在它自己身上会在换页后失效。 */
    app.addEventListener("change", function (ev) {
      var f = ev.target;
      /* 自测答题：单选框变化只记答案、只动这一题的样式与顶部「已答」计数。
         整卷重画会把刚选中的状态与滚动位置一起冲掉，所以这里不重画。 */
      if (f && f.matches && f.matches('input[name^="qz"]')) {
        var qi = +f.getAttribute("name").slice(2);
        QZ.answers[qi] = +f.value;
        var item = f.closest ? f.closest(".qz-item") : null;
        if (item) {
          item.querySelectorAll(".qz-opt").forEach(function (o) { o.classList.remove("pick"); });
          var lab = f.closest("label");
          if (lab) lab.classList.add("pick");
        }
        var meta = document.getElementById("qz-meta");
        if (meta) meta.innerHTML = qzMetaHTML();
        return;
      }
      if (!f || !f.matches || !f.matches("#tt-file,#ch-file")) return;
      if (f.id === "ch-file") {
        chLoad(f.files);
        try { f.value = ""; } catch (e) { /* 有的浏览器不许清空 file input，忽略 */ }
        return;
      }
      ttLoad(f.files);
      try { f.value = ""; } catch (e) { /* 有的浏览器不许清空 file input，忽略 */ }
    });
    /* 图表生成的拖放区走同一套 dragover/dragleave 样式，drop 时分流到 chLoad */
    app.addEventListener("dragover", function (ev) {
      var z = ev.target && ev.target.closest ? ev.target.closest("#tt-drop,#ch-drop") : null;
      if (!z) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
      z.classList.add("over");
    });
    app.addEventListener("dragleave", function (ev) {
      var z = ev.target && ev.target.closest ? ev.target.closest("#tt-drop,#ch-drop") : null;
      if (z) z.classList.remove("over");
    });
    app.addEventListener("drop", function (ev) {
      var z = ev.target && ev.target.closest ? ev.target.closest("#tt-drop,#ch-drop") : null;
      if (!z) return;
      ev.preventDefault();
      z.classList.remove("over");
      if (ev.dataTransfer && ev.dataTransfer.files) {
        if (z.id === "ch-drop") chLoad(ev.dataTransfer.files);
        else ttLoad(ev.dataTransfer.files);
      }
    });
    /* 键盘可达：拖放区是个 role=button，回车/空格要能唤出文件选择 */
    app.addEventListener("keydown", function (ev) {
      if (ev.key !== "Enter" && ev.key !== " " && ev.key !== "Spacebar") return;
      var z = ev.target && ev.target.closest ? ev.target.closest("#tt-drop,#ch-drop") : null;
      if (!z) return;
      ev.preventDefault();
      if (z.id === "ch-drop") {
        var chF = document.getElementById("ch-file");
        if (chF) chF.click();
      } else ttChoose();
    });

    /* 笔记：input 事件同样冒泡，委托即可；停止输入 600ms 后才落盘，
       避免每个字符写一次 localStorage。 */
    var noteTimer = null;
    app.addEventListener("input", function (ev) {
      var ta = ev.target && ev.target.matches && ev.target.matches("textarea[data-note]");
      if (!ta) return;
      var id = ev.target.getAttribute("data-note");
      if (noteTimer) clearTimeout(noteTimer);
      noteTimer = setTimeout(function () { LR.setNote(id, ev.target.value); }, 600);
    });

    /* 工具台的文本分析：边输边算，400ms 防抖。300 条词条扫一遍很快，
       但逐字符触发没必要，停笔再算更像「随手一看」。 */
    var ttTimer = null;
    app.addEventListener("input", function (ev) {
      if (!ev.target || !ev.target.matches || !ev.target.matches("#tt-input")) return;
      ttText = ev.target.value;                 // 换页回来还要在
      if (ttTimer) clearTimeout(ttTimer);
      ttTimer = setTimeout(renderTextTool, 400);
    });

    /* 概念计算器：填一个数就重算一遍，只重画结果区、不重画表单——
       重画表单会把光标从正在输的那个格子里赶走。 */
    app.addEventListener("input", function (ev) {
      var t = ev.target;
      if (!t || !t.matches) return;
      if (t.matches("[data-calc]")) {
        CALC.v[t.getAttribute("data-calc")] = t.value;
        renderCalc();
      }
    });

    /* —— 桌宠精灵：马克思像素小人（经典黑西装 + 白发版，
       依 1875 年 Mayall 标准像绘制）。
       32×38 像素网格，输出 256×304 透明 PNG，转 base64 内联，
       保证离线单文件在 file:// 下也能直接显示（不引外部图）。
       姿态：idle 待机 / blink 眨眼帧 / wave 挥手 / doc 举文件 /
             read 捧书 / think 思考 / cheer 举拳 / sleep 打盯。
       生成脚本：tmp/pet/make_pet.py（改坐标即可调形象）。—— */
  var PET_SPRITES = {
  idle: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEwCAYAAABYCK/LAAAGdUlEQVR4nO3dzYocVRiA4ZqQhaswhDCEQUREQhBBjCKDBAJZunAreBFZewmuvQjBrQuXgiAiwR8EEQlBJEgzDEMYsnIhxjuYUiuVmqr3ebZD/6S783Ka8/WpvYFZHV4/eOol/v92xyd7Xr/5XJrxvoELTgAgTAAgTAAgTAAgTAAgTAAgzB7rwvv4397/aSg7eueNWe/fHMH5rAAgTAAgTAAgTAAgTAAgTAAgTAAgLD8HMHWff2wf/+Dg2jCnk5PToWzqHMEuft6AFQCECQCECQCECQCECQCECQCECQCEbX4PdO59fqYZm5OYOudgTuB8VgAQJgAQJgAQJgAQJgAQJgAQJgAQlp8DmPp7/vrv8dfuaOQ8ga2fF2AFAGECAGECAGECAGECAGECAGECAGGXh/jv/ceM7fNfOf1qzodnxJNrdxb9fO1WPidgBQBhAgBhAgBhAgBhAgBhAgBhAgBhq58DGONcf6Z8Po5GzgtYOysACBMACBMACBMACBMACBMACBMACNv8HMDYPq45gXWbet2Go43v84+xAoAwAYAwAYAwAYAwAYAwAYAwAYCw1c8BjJ3LPnau+4MHv517/zduvPI/nxnPw9g+/9j7O2bt5/6PsQKAMAGAMAGAMAGAMAGAMAGAMAGAsNXPAYzt84+xz79tU9/fw5HP19rnBKwAIEwAIEwAIEwAIEwAIEwAIEwAIGzVe5j/Zp927nP/lz5X/pcvPln08V97796ij7/0+7szBwCsla8AECYAECYAECYAECYAECYAELb5OYC595GvnH517t9fn7hP/vPC+/xTzf3vf3LtzqJzHDtzAMBa+QoAYQIAYQIAYQIAYQIAYQIAYau/LsDYPuzYnMDY9eNdN2Ddxt7fre/zj7ECgDABgDABgDABgDABgDABgDABgLBN73E+j+sGjJ0HsLQ/fv1h0u1fvHlruMjmPg9gZw4A2CpfASBMACBMACBMACBMACBMACAsPwcw5utvpu2jf/j+3Um3r/v08y8n3f72u9PmGHbmAICt8hUAwgQAwgQAwgQAwgQAwgQAwlZ/XYC5rxuw9D4289ptfJ9/jBUAhAkAhAkAhAkAhAkAhAkAhAkAhAkAhAkAhAkAhAkAhAkAhAkAhAkAhAkAhG3+PICpHj78/dy/v/rqy8/tufDf3x/OZwUAYQIAYQIAYQIAYQIAYQIAYQIAYekz0Z/FdQG+/uaHZ/dk+M9uv3tr0qu2c10AoMpXAAgTAAgTAAgTAAgTAAgTAAjbq+/jz23qnMDaf+8+9byEqfv8c9utfI7ACgDCBADCBADCBADCBADCBADCBADC9ra+z3/j5tvDmh0f75Z+CmlPznabnhOwAoAwAYAwAYAwAYAwAYAwAYAwAYCwvbX/Xn/r+/w/fv/lpPv/4K1pr89n33836fZvvnV32LInE+cElp4jsAKAMAGAMAGAMAGAMAGAMAGAMAGAsMtLP4Er+4ez7qOfnT0+9+/7+1eHi2xsH33qnMBUa9/nP5v4+Zj6+Z17jmCMFQCECQCECQCECQCECQCECQCECQCELT4HwLz78Ddmvn/WzQoAwgQAwgQAwgQAwgQAwgQAwgQAwgQAwgQAwgQAwgQAwgQAwgQAwgQAwgQAwgQAwgQAwgQAwgQAwgQAwgQAwgQAwgQAwha/LsC3n3406/0fffjxrPfPuu3vX1308/nae/eGJVkBQJgAQJgAQJgAQJgAQJgAQJgAQNjicwDM6/7ZX5Nuv7//zJ4KF5AVAIQJAIQJAIQJAIQJAIQJAIQJAITtzf0Ah9cPng4L+nt4YcmHZ+UuDX8u+vi745NZ/49aAUCYAECYAECYAECYAECYAECYAEDY7HMAW58zuHrtpeEie3z6aNLtt/7vu+j79HOzAoAwAYAwAYAwAYAwAYAwAYAwAYCw1V8XYO592KXnDGjv08/NCgDCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCLg9xh9cPni79HFju/d0dn+yVX38rAAgTAAgTAAgTAAgTAAgTAAgTAAjLzwFM9fj00bBlW//31VkBQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAAAAAAAAAAADAsH7/AMnVDKS9vHwLAAAAAElFTkSuQmCC",
  blink: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEwCAYAAABYCK/LAAAGd0lEQVR4nO3dP4tkVR6A4dsywUZDMwzN0IiIyCAmy6pII4JgaGC64Icw9iMY+yEE0w02FAQRkVUxERERESmaphmaiTYQx2/Q15kz19v3vs+TDvWnq2peTvE7de7RxKJO75088hI/ucP5xZHXbznPLHjfwA0nABAmABAmABAmABAmABAmABBmxrryHP/Lr76bys5e/+ei928fwfWsACBMACBMACBMACBMACBMACBMACAsvw9gdM4/N8c/Obk7Leni4nIqG91HcIifN2AFAGECAGECAGECAGECAGECAGECAGG7n4EuPednzNw+idF9DvYJXM8KAMIEAMIEAMIEAMIEAMIEAMIEAMLy+wBGf89f/z3+1p3NnCew9/MCrAAgTAAgTAAgTAAgTAAgTAAgTAAg7NYU/73/nLk5/+3Lz5Z8eGY8vPvWqp+vw8b3CVgBQJgAQJgAQJgAQJgAQJgAQJgAQNjm9wHMca4/I5+Ps5nzArbOCgDCBADCBADCBADCBADCBADCBADCdr8PYG6Oa5/Ato1et+Fs53P+OVYAECYAECYAECYAECYAECYAECYAELb5fQBz57LPnev+448/X3v/9++/8ITPjL/D3Jx/7v2ds/Vz/+dYAUCYAECYAECYAECYAECYAECYAEDY5vcBzM3555jz79vo+3s68/na+j4BKwAIEwAIEwAIEwAIEwAIEwAIEwAI2/QM86/MaZc+93/tc+W//+9Hqz7+y++8v+rjr/3+HuwDALbKVwAIEwAIEwAIEwAIEwAIEwAI2/0+gKXnyLcvP1t0Tr72nH/U0n//w7tvrbqP42AfALBVvgJAmABAmABAmABAmABAmABA2OavCzA3h53bJzB3/fjRc+W3PscftfbfP/f+7n3OP8cKAMIEAMIEAMIEAMIEAMIEAMIEAMI2vw9g1Oic/6b77Ydvhm7/7EuvTFu29/d3lBUAhAkAhAkAhAkAhAkAhAkAhAkAhO36t85P47oBn38xNkd/7923h25f9/F/Ph26/ZtvjO1jODgPANgrXwEgTAAgTAAgTAAgTAAgTAAgbPfnAYxeN2DtOTbLOux8zj/HCgDCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCdn8ewKiffvrl2n9/8cXn/7bnwuO/P1zPCgDCBADCBADCBADCBADCBADCBADC0meiP43rAnz+xTdP78nw2N5845WhV+3gugBAla8AECYAECYAECYAECYAECYAEHZUn+MvbXSfwNZ/7z56XsLonH9ph43vI7ACgDABgDABgDABgDABgDABgDABgLCjvc/577/02rRl5+eHtZ9C2sOrw673CVgBQJgAQJgAQJgAQJgAQJgAQJgAQNjR1n+vv/c5/7dffzp0//9+dez1+eTr/w3d/l+vvj3t2cPBfQJr7yOwAoAwAYAwAYAwAYAwAYAwAYAwAYCwW2s/gdvHp4vO0a+uHlz778fHd6abbG6OPrpPYNTW5/xXg5+P0c/v0vsI5lgBQJgAQJgAQJgAQJgAQJgAQJgAQNjq+wBYdg5/f+H7Z9usACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBs9esCfPnxB4ve/9l7Hy56/2zb8fGdVT+fL7/z/rQmKwAIEwAIEwAIEwAIEwAIEwAIEwAIW30fAMv66ur3odsfHz+1p8INZAUAYQIAYQIAYQIAYQIAYQIAYQIAYUdLP8DpvZNH04r+mP6x5sOzcc9M/1/18Q/nF4v+H7UCgDABgDABgDABgDABgDABgDABgLDF9wHsfZ/BnbvPTTfZg8tfh26/97/vps/pl2YFAGECAGECAGECAGECAGECAGECAGGbvy7A0nPYtfcZ0J7TL80KAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMJuTXGn904erf0cWO/9PZxfHJVffysACBMACBMACBMACBMACBMACBMACMvvAxj14PLXac/2/vfVWQFAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmAAAAAAAAAAAAMC0fX8CDgsHv1Ieuj8AAAAASUVORK5CYII=",
  wave: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEwCAYAAABYCK/LAAAGkElEQVR4nO3dzWokVRiA4YrMwtUQhiEMg4iIBBFB/EGCDAguXbgV5iJcewmuvQjBnbhwKQgiIv4giIiIyCAhhDCEWblQxzvoUo9lpfp9nm3s6k53fDnDd/rUwcSibt86eugt/vdOz84PvH/LeWTBawNXnABAmABAmABAmABAmABAmABAmBnrynP8z7/4dio7efm5Ra9vH8FuVgAQJgAQJgAQJgAQJgAQJgAQJgAQlt8HMDrnn5vjHx3dnJZ0fn4xlY3uIziNnzdgBQBhAgBhAgBhAgBhAgBhAgBhAgBhez8DXXrOz5i5fRKj+xzsE9jNCgDCBADCBADCBADCBADCBADCBADC8vsARr/PX/8+/tadzJwnsO/nBVgBQJgAQJgAQJgAQJgAQJgAQJgAQNi1Kf59/zlzc/7rF58s+fTMeHDz1VX/vk43vk/ACgDCBADCBADCBADCBADCBADCBADCNr8PYI5z/Rn5+ziZOS9g66wAIEwAIEwAIEwAIEwAIEwAIEwAIGzv9wHMzXHtE9i20fs2nOz5nH+OFQCECQCECQCECQCECQCECQCECQCEbX4fwNy57HPnuv/44887r398/OS/fGX8H+bm/HOf75ytn/s/xwoAwgQAwgQAwgQAwgQAwgQAwgQAwjY/45yb888ZPQ9g7e+Tf//Ru6s+/zOvv7Xq86/9+Z1ufJ+AFQCECQCECQCECQCECQCECQCECQCEbXqG+Xf2ASx97v/1i08WvT67Pbj56qJv0cnMPgH7AIDN8k8ACBMACBMACBMACBMACBMACNv8fQFG57hL7xPgajsZPA9g9DyKOUvvM7ACgDABgDABgDABgDABgDABgDABgLDN7wOYm5POzWnn7h9/fPzkNOLZwXPzv1v53P9Ra//+c5/v2vddWPu+ClYAECYAECYAECYAECYAECYAECYAELb5fQCjRuf8V32O/+sPXw89/rGnX9j077/057t1VgAQJgAQJgAQJgAQJgAQJgAQJgAQlt8HMHcu/Kef7Z6j3z+8s/Pnd994bdq2D1Z99vc+/Hj3f/D7Hzt/fOeVsX0M+84KAMIEAMIEAMIEAMIEAMIEAMIEAML2fh/A6H0DFp9jw4qsACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBs788DGPXTT7/s/PlTTz3xv70W/vnnM+rk7jt7/bZbAUCYAECYAECYAECYAECYAECYAEDYzjPzC0bvC/DpZ1//dy+Gf+zOKy8s+q5dP7y96PUfXJ4O3ddilBUAhAkAhAkAhAkAhAkAhAkAhAkAhF2rz/GXnkOP7hNY+vvuSxs9L2HpOX+dFQCECQCECQCECQCECQCECQCECQCEHez7nP/46ZemLTs72/19cbbtgfMAgLX4JwCECQCECQCECQCECQCECQCEXdv69/X3fc7/zVcfD13/zRfH3p/3v/py6PHPv/ja0ONZlhUAhAkAhAkAhAkAhAkAhAkAhAkAhK1+X4DR+6/PzdEvL+/v/Pnh4Y3pKpubo4/uExi19Tn/5cb/PkZZAUCYAECYAECYAECYAECYAECYAEDY6vsAWHYOf7zw9dk2KwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIW/2+AJ+/9/ai1z+5+86i12fbDg9vrPr3+czrb01rsgKAMAGAMAGAMAGAMAGAMAGAMAGAsNX3AbCsLy5/H3r84eF/9lK4gqwAIEwAIEwAIEwAIEwAIEwAIEwAIOxg6Se4fevo4bSiP6dH13x6Nu6R6bdVn//07HzR/0etACBMACBMACBMACBMACBMACBMACBs8X0A+77P4MbNx6er7P7FvaHH7/vvd9Xn9EuzAoAwAYAwAYAwAYAwAYAwAYAwAYCwzd8XYOk57Nr7DGjP6ZdmBQBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBh16a427eOHq79Gljv8z09Oz8ov/9WABAmABAmABAmABAmABAmABAmABCW3wcw6v7FvWmf7fvvV2cFAGECAGECAGECAGECAGECAGECAGECAGECAGECAGECAGECAGECAGECAGECAAAAAAAAAAAA0/b9Bf9hANQIPHqwAAAAAElFTkSuQmCC",
  doc: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEwCAYAAABYCK/LAAAGpUlEQVR4nO3dT4ud1QHA4XdkKF2FIYQhBCmlyBBCoVSlBBEEly666aKSD+G65AOIaz+EtAs3XbgUpCISqqUgoYiUImUYhhCGrLooTb/Bfaknp3fe+3ue7eX+mffO/DjDOe85RwtT3bl9+twl/uHOLy6PXL95Xpr42sA1JwAQJgAQJgAQJgAQJgAQJgAQZo51z/P4Xz7661J2/1e/mPr61hHsZgQAYQIAYQIAYQIAYQIAYQIAYQIAYfl1AKPz/Gvz+Kent5aZLi+fLGWj6wjO4/sNGAFAmABAmABAmABAmABAmABAmABA2MHPgc6e52fM2jqJ0XUO1gnsZgQAYQIAYQIAYQIAYQIAYQIAYQIAYfl1AKP389fvx9+6+5PPJbjujAAgTAAgTAAgTAAgTAAgTAAgTAAg7HiJ3++/Zm2e/8aTz2a+PSue3Xpr6Bqd3X09fY2NACBMACBMACBMACBMACBMACBMACBs8+sA1tjXn11efvSn9AUyAoAwAYAwAYAwAYAwAYAwAYAwAYCw4/q+79YJbNvscxse/v43y5a9/+7HOx83AoAwAYAwAYAwAYAwAYAwAYAwAYCwza8DOL+4PBo5N+Dbb/++8/XPzn72Az8Z/w9r8/xr3+/oPPrWGQFAmABAmABAmABAmABAmABAmABA2ObXAazN868xz3/YRr/fh/YDAA6VfwEgTAAgTAAgTAAgTAAgTAAgbOe99IewDmD2vv9r5w7M9viTD/f6/vfeeW+v7z/6/T68e7aUGQFAmABAmABAmABAmABAmABAmABA2MGvA5g9j3zjyWc7H//54Dz5N3ue5x81++d/duutqesAHtoPADhU/gWAMAGAMAGAMAGAMAGAMAGAsM2fC3B+cXk0sk5g7fx45wZs29r3u+b9dz9eDpkRAIQJAIQJAIQJAIQJAIQJAIQJAIRtfj+AfZ8bsLYfwL79829fDz3/5buvLtfZ6H4AJz+6WMqMACBMACBMACBMACBMACBMACBMACAsvw5gzedfjM2jP/j120PPr/voj58OPf/NN8bWMTyefC7DvcFzE0YZAUCYAECYAECYAECYAECYAECYAEDY5s8FmH1uwL7nsWk7X/n9HWUEAGECAGECAGECAGECAGECAGECAGEHvw4ARtx/8MFBX0AjAAgTAAgTAAgTAAgTAAgTAAgTAAizDmDFd9/9Y+fjr7zy0xf5ffCCvx92MwKAMAGAMAGAMAGAMAGAMAGAMAGAsKl7jm/B6LkAn3/x9Yv7MPzP3nzj1alX7cbJnamv/+zqfOfjzgUApvEvAIQJAIQJAIQJAIQJAIQJAIQd1+fxZ89Dj64T2Pr97qP7Jcye568zAoAwAYAwAYAwAYAwAYAwAYAwAYCwo0Of5z+7+/qyZRcXu+8XZ9ue2Q8A2Bf/AkCYAECYAECYAECYAECYAEDY8dbv1z/0ef6/fPXp0Ov/9rWx6/OHr/489Pxfvvb20POZywgAwgQAwgQAwgQAwgQAwgQAwgQAwvZ+LsDo+etr8+hXV093Pn5ycnO5ztbm0UfXCYza+jz/1cZ/P0YZAUCYAECYAECYAECYAECYAECYAEDY8XW/35+xefiz+Dw/uxkBQJgAQJgAQJgAQJgAQJgAQJgAQNj0/QAef/Lh1Ne//+CDqa8Ph8wIAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMKm7wcw25cf/W7n4/YLYJeTk5tDv1+j7r3z3rJPRgAQJgAQJgAQJgAQJgAQJgAQJgAQNn0dwNo85+xzA+oeXf176PknJy/so3ANGQFAmABAmABAmABAmABAmABAmABA2NHsN7hz+/T5skf/WX68z7dn415a/rXX9z+/uJz6N2oEAGECAGECAGECAGECAGECAGECAGHT1wEc+jqDm7d+slxnT598P/T8Q//5rvs8/WxGABAmABAmABAmABAmABAmABAmABA2/VyArc/D7nudAe15+tmMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACDseIm7c/v0+b4/A/v7fs8vLo/K198IAMIEAMIEAMIEAMIEAMIEAMIEAMLy6wBGPX3y/XLIDv3nqzMCgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABAAAAAAAAAACAZfv+CxGsAQHiNn73AAAAAElFTkSuQmCC",
  read: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEwCAYAAABYCK/LAAAG0klEQVR4nO3dP4tlZx3A8TOSxmYwsizLEoLEsCwhoMYgQ1gMLFYptLCR9FqIpBZfgFin8CUEGxuLVGEhGkIIJiKEsIQYZJHLsAxRprGM7+Aek2fPnjnn+/m0w525/+bLc3l+9zknE4u6eeP6F57ir+5w/vDE87ecry34u4ErTgAgTAAgTAAgTAAgTAAgTAAgzB7ryvv4773/96ns7AffWfT3myM4zgoAwgQAwgQAwgQAwgQAwgQAwgQAwvJzAKP7/HP7+NevX5uW9PDhxVQ2OkdwiJ83YAUAYQIAYQIAYQIAYQIAYQIAYQIAYbvfA116n58xc3MSo3MO5gSOswKAMAGAMAGAMAGAMAGAMAGAMAGAsPwcwOj3+evfx9+6s5nzBPZ+XoAVAIQJAIQJAIQJAIQJAIQJAIQJAIQ9McW/7z9nbp//9OLtJf88My6vvbzq++uw8TkBKwAIEwAIEwAIEwAIEwAIEwAIEwAI2/wcwBzn+jPy/jibOS9g66wAIEwAIEwAIEwAIEwAIEwAIEwAIGz3cwBz+7jmBLZt9LoNZzvf559jBQBhAgBhAgBhAgBhAgBhAgBhAgBhm58DmDuXfe5c908++ezo779165mveM94HOb2+ede3zlbP/d/jhUAhAkAhAkAhAkAhAkAhAkAhAkAhG1+DmBun3+Off59G319b868v7Y+J2AFAGECAGECAGECAGECAGECAGECAGGb3sP8f/Zplz73f+1z5T9+8/VV//5zr7y26t9f+/U9mAMAtspHAAgTAAgTAAgTAAgTAAgTAAjb/RzA0vvIpxdvH/3584P75B+tvM8/aunHf3nt5VXnOA7mAICt8hEAwgQAwgQAwgQAwgQAwgQAwjZ/XYC5fdi5OYG568e7bsC2zb2+e9/nn2MFAGECAGECAGECAGECAGECAGECAGG73uN8HNcNmDsPYG3/uv/h0O2fuv3CdJUtfR7AwRwAsFc+AkCYAECYAECYAECYAECYAEBYfg5gzjvvju2jv/rju0O3r3vjT/eGbn/npbE5hoM5AGCvfASAMAGAMAGAMAGAMAGAMAGAsM1fF2Dp6wasvY/Nsg473+efYwUAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYbs/D2DUp5/+8+jPn332W4/tvvDlXx+OswKAMAGAMAGAMAGAMAGAMAGAMAGAsPSZ6I/iugDvvPvho7szfGl3Xnph6Fk7uC4AUOUjAIQJAIQJAIQJAIQJAIQJAISd1PfxlzY6J7D177uPnpcwus+/tMPG5wisACBMACBMACBMACBMACBMACBMACDsZO/7/Lduvzht2fn5Ye27kHb5n8Ou5wSsACBMACBMACBMACBMACBMACBMACDsZOvf1z/9xs2h29+4MXb7pff5//bBvWnLvvf9u9OeXQ7OCaw9R2AFAGECAGECAGECAGECAGECAGECAGGrzwGM7uOPWnsOYGn37380dPvbt5+f9ux85fMW5uYIzAEAi/ERAMIEAMIEAMIEAMIEAMIEAMKemOKeev8v057dP31y6PZ7f37On/72VGYFAGECAGECAGECAGECAGECAGECAGECAGECAGECAGECAGECAGECAGECAGECAGH58wDm/OYPP5227K1f3Es//t/+7I9r34UrzQoAwgQAwgQAwgQAwgQAwgQAwgQAwk6W/gM3b1z/4tjPP37z9aHff/bq74Zu/+KDf0x79tbgdQF+dPnvac/+OnhdgPfe+PXQ7Z975bWjPz+cP1z0f9QKAMIEAMIEAMIEAMIEAMIEAMIEAMI2fx7A6D7sr+78/JHdF3rvn62zAoAwAYAwAYAwAYAwAYAwAYAwAYCw1ecA5r4PPWf0PIE5v//sz9OW3fruT9KP/5fP/PBKv3/XZgUAYQIAYQIAYQIAYQIAYQIAYQIAYYtfF2Dp6wqMunv532nPXBfguHunX1/0+V/6XP9RVgAQJgAQJgAQJgAQJgAQJgAQJgAQdqX3KLcwR/DNa09PV9nnFw+Gbr/3x7f1ffxRVgAQJgAQJgAQJgAQJgAQJgAQJgAQtvp1AZY2uo+79BwBy9r7Pv4oKwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAI2/11AeY497/9+h7i1w2wAoAwAYAwAYAwAYAwAYAwAYAwAYCw/BzAqM8vHkx7tvfHV2cFAGECAGECAGECAGECAGECAGECAGECAGECAGECAGECAGECAGECAGECAGECAAAAAAAAAAAA0/b9D9E0KymqD9WSAAAAAElFTkSuQmCC",
  think: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEwCAYAAABYCK/LAAAGpklEQVR4nO3dP4tl5R3A8TOykFTLIMuwLCGIyEQkEKIhDCIIFiksxE6wyEuwsPIlWKXIS0ghpAspUgqCiEg0CCGISAgSLsMwLMNWFuL6DuboPns8c87382mH+2fuvfPlGZ7fee7RxKLu3T156CV+dIfziyOv33KeWPC+gRtOACBMACBMACBMACBMACBMACDMHuvK+/gff/L5VHb2+98sev/mCK5nBQBhAgBhAgBhAgBhAgBhAgBhAgBh+TmA0X3+uX38k5M705IuLi6nstE5gkP8vAErAAgTAAgTAAgTAAgTAAgTAAgTAAjb/R7o0vv8jJmbkxidczAncD0rAAgTAAgTAAgTAAgTAAgTAAgTAAjLzwGMXs9fvx5/685mzhPY+3kBVgAQJgAQJgAQJgAQJgAQJgAQJgAQdmuKX+8/Z26f//blB0s+PDMe3Hl51c/XYeNzAlYAECYAECYAECYAECYAECYAECYAELb5OYA5zvVn5PNxNnNewNZZAUCYAECYAECYAECYAECYAECYAEDY7ucA5vZxzQls2+j3NpztfJ9/jhUAhAkAhAkAhAkAhAkAhAkAhAkAhG1+DmDuXPa5c92//PK/197/6enTj/jM+CnM7fPPvb9ztn7u/xwrAAgTAAgTAAgTAAgTAAgTAAgTAAjb/B7n3D7/nNHzANa+nvw///jzqo//3Ktvrfr4a79/h43PCVgBQJgAQJgAQJgAQJgAQJgAQJgAQNim9zB/yBzA0uf+37784Nqf/3pwn/zfK+/zj1r6939w5+VpSWczcwLmAIDN8i8AhAkAhAkAhAkAhAkAhAkAhG3+ewFG93GXnhPgZjtb+TyHtVkBQJgAQJgAQJgAQJgAQJgAQJgAQNjm5wDmrseeOy9g7vvjT0+fnsrX849a+/efe3/nbP16/zlWABAmABAmABAmABAmABAmABAmABC2+TmAUaP7/Dfd/7/4bOj2v3j2+WnL9v7+jrICgDABgDABgDABgDABgDABgDABgLBdX+v8Q84DmPPhR2P76G++9srQ7eve+/v7Q7d/6cWxOYaD8wCAvfIvAIQJAIQJAIQJAIQJAIQJAITt/jyA0e8NWHsfm2Uddr7PP8cKAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMJ2fx7AqK+++t+1P3/mmad+sufCj39/uJ4VAIQJAIQJAIQJAIQJAIQJAIQJAISlz0R/HN8L8OFHnz2+J8OP9tKLzw+9agffCwBU+RcAwgQAwgQAwgQAwgQAwgQAwo7q+/hLG50T2Pr17qPnJYzu8y/tsPE5AisACBMACBMACBMACBMACBMACBMACDva+z7/6bO/m5b0tz/98dqfv/72X4bu//z8MHR7xjy4Oux6TsAKAMIEAMIEAMIEAMIEAMIEAMIEAMKOtn69/tL7/KNzAKN+9qs/DN3+jRfGXp+/fvrPodv/9oVXpj17MDgnsPYcgRUAhAkAhAkAhAkAhAkAhAkAhAkAhN1a+wncPr636PXyV1f3r/358fGT0002t4/+r0/fn9a09X3+q8HPx+jnd+k5gjlWABAmABAmABAmABAmABAmABAmABC2+hzA0m76Pv/S+/CnC98/22YFAGECAGECAGECAGECAGECAGECAGG7nwNY2tmb7679FOCRWQFAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmPMASDue+d6Ij997Z9HHf+7Vt6Y1WQFAmABAmABAmABAmABAmABAmABAmDmAnfvk6tuh2x8fP7anwg1kBQBhAgBhAgBhAgBhAgBhAgBhAgBhR0s/wL27Jw+nFX03/XzNh2fjnpi+WfXxD+cXi/6NWgFAmABAmABAmABAmABAmABAmABA2OJzAHufM3jyzi+nm+z+5ddDt9/773fT9+mXZgUAYQIAYQIAYQIAYQIAYQIAYQIAYZv/XoCl92HXnjOgvU+/NCsACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACLs1xd27e/Jw7efAeu/v4fziqPz6WwFAmABAmABAmABAmABAmABAmABAWH4OYNT9y6+nPdv771dnBQBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgAAAAAAAAAAANP2fQ/bvwODyOfrVAAAAABJRU5ErkJggg==",
  cheer: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEwCAYAAABYCK/LAAAGyElEQVR4nO3dQYtk1RmA4WqZRVZDMwxN04QQRBoRIURDKGRAcOkii2wCswjiIkvX+Qmu8yOE7EIWWQqCiEg0BEIQkRAkFE3TDM2sstB0yB+oGz1zvXXrfZ5tWXWrq2pejpyvTp1smNXF+dmdl/i7211dn3j95vPcjI8NHDgBgDABgDABgDABgDABgDABgDB7rAvv43/8yV83Zduf/2TWxzdHsJ8VAIQJAIQJAIQJAIQJAIQJAIQJAITl5wBG9/mn9vHPzh5u5nR9fbMpG50j2MXPG7ACgDABgDABgDABgDABgDABgDABgLCj3wOde5+fMVNzEqNzDuYE9rMCgDABgDABgDABgDABgDABgDABgLD8HMDo9/nr38dfu+3EeQLHfl6AFQCECQCECQCECQCECQCECQCECQCE3dvEv+8/ZWqf//7NB3NenglPH76+6Odrt/I5ASsACBMACBMACBMACBMACBMACBMACFv9HMAU5/oz8vnYTpwXsHZWABAmABAmABAmABAmABAmABAmABB29HMAU/u45gTWbfR3G7ZHvs8/xQoAwgQAwgQAwgQAwgQAwgQAwgQAwlY/BzB1LvvUue5ffPGPvY9/efn8d3xmfB+m9vmn3t8paz/3f4oVAIQJAIQJAIQJAIQJAIQJAIQJAIStfo9zap9/yuh5AEt/n/zvf/rdotd/6c13Fr3+0u/fbuVzAlYAECYAECYAECYAECYAECYAECYAELbqPcz/Zw5g7nP/7998MOvjs9/Th6/P+hJtJ+YEzAEAq+V/ASBMACBMACBMACBMACBMACDsZOnv4y9tdE7AHMC65wC2C5/nMGp0DsEKAMIEAMIEAMIEAMIEAMIEAMIEAMLurf3c+tFz6ad+P/7y8vmhx3958Pn9beFz/0ct/fdPvb/H/vmeYgUAYQIAYQIAYQIAYQIAYQIAYQIAYbPPARy60X3+Q9/H/9fnnw3d/4cvvrLqv3/u93ftrAAgTAAgTAAgTAAgTAAgTAAgTAAgLD8HMHUu/Icf7d9Hf3L6aO/tj3/xxmbd/rDo1d/74/v7/4Ovv9l786PXxuYYjp0VAIQJAIQJAIQJAIQJAIQJAIQJAIQd/RzA1O+nX5yf3S26j03687E0KwAIEwAIEwAIEwAIEwAIEwAIEwAIm30OYPv43bkvAYvZrvzzbQUAYQIAYQIAYQIAYQIAYQIAYQIAYUd/HsCoL7/8597bX3jhx9/bc+Hbvz/sZwUAYQIAYQIAYQIAYQIAYQIAYQIAYeYAJrz161/uvf3Djz57lu8Hz/j9YT8rAAgTAAgTAAgTAAgTAAgTAAgTAAg7+jmAuX/f/dFrr8w6J7D277uPnpcw9foe+ufj0FkBQJgAQJgAQJgAQJgAQJgAQJgAQNjRzwFcvvizRa//9tu/Gbr/1dVuU3b/9GLR6z+9Pe7X3woAwgQAwgQAwgQAwgQAwgQAwgQAwlY/B7D0Pv+oqX3+v3z6/tDj/+rVsdfn95/+eej+P331jc2a3V94DmFuVgAQJgAQJgAQJgAQJgAQJgAQJgAQtvo5gKl99NvbJ3tvPz19sDlkU/voo3MCo9a+z3+78s/HKCsACBMACBMACBMACBMACBMACBMACLu39Lnqx/5966X34S9nfnzW/bsDVgAQJgAQJgAQJgAQJgAQJgAQJgAQNjwHsLu6Ptl3+8X52d3oNaBqN/Hva5QVAIQJAIQJAIQJAIQJAIQJAIQJAIQJAIQJAIQJAIQJAIQJAIQJAIQJAIQJAITN/rsAUz5+77ezPv728buzPj7rdnr6YNHP50tvvrNZkhUAhAkAhAkAhAkAhAkAhAkAhAkAhC0+B8C8Prn9euj+p6fP7KlwgKwAIEwAIEwAIEwAIEwAIEwAIEwAIGzW3x7/n4vzs7vNgv6z+cGSl2flntv8e9Hr766uZ/03agUAYQIAYQIAYQIAYQIAYQIAYQIAYbPPARz7nMGDhz/aHLInN18N3f/Y/75D36efmxUAhAkAhAkAhAkAhAkAhAkAhAkAhK3+dwHm3oddes6A9j793KwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIOzeJu7i/Oxu6efAcu/v7ur6pPz6WwFAmABAmABAmABAmABAmABAmABAWH4OYNSTm682x+zY/746KwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAAAAAAAAAAANis338BuDELs2T3cCEAAAAASUVORK5CYII=",
  sleep: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEwCAYAAABYCK/LAAAGqUlEQVR4nO3dz4ol5R2A4WqZRVZDMwzN0IQQggziwhAVaUQQXLrINuBFuM4lZJ2LELJ1kaUgiAyDGpJFCCIhSDg0TTM0s3IhjnfQhX5d1ql6n2fbnDp/++U7fL9TdTKxqPNHZy+8xD/f4fLqxOu3nJcWPDZw5AQAwgQAwgQAwgQAwgQAwgQAwuyxrryP/+TpP6eyi7d+v+ocwfmRz2ksPQdhBQBhAgBhAgBhAgBhAgBhAgBhAgBh+TmA0X3guX38s7OH05Kurq6nsqXnCJ48/deix79467Vb/24OAFiMrwAQJgAQJgAQJgAQJgAQJgAQtvs5gKX3+RkzNycxOuew9JzA6ByBOQBgNb4CQJgAQJgAQJgAQJgAQJgAQFh+DmD09/z13+Nv3cXMnMDa5wNYmhUAhAkAhAkAhAkAhAkAhAkAhAkAhN2bNm7p67vP7fPfv/50ybtnxvOH7256n/7JynMGVgAQJgAQJgAQJgAQJgAQJgAQJgAQtvk5gDnO68/I5+Ni5nwBh8urk5E5ldE5g9E5AisACBMACBMACBMACBMACBMACBMACNv9HMD8ed9v3wfmuI1et+Fi5vOxtKXPBzDHCgDCBADCBADCBADCBADCBADCBADCNj8HMPp77K+//u+tx3/8+Hc/85HxS5jb5597f0c/X8d+3YE5VgAQJgAQJgAQJgAQJgAQJgAQJgAQtvk5gLl9/jn2+fdt9P09n/l8zc0JLD1HMMoKAMIEAMIEAMIEAMIEAMIEAMIEAMKOeo/yLvZplz7v/9rnlf/33/+66v2/+v6Hq97/2u/v4cj3+edYAUCYAECYAECYAECYAECYAECYAEDYpvcw7+J8AKP7yPevP110n3ztff5RSz//5w/fXXWO42AOANgqXwEgTAAgTAAgTAAgTAAgTAAgbPPXBZjbh52bE5i7fvzoeeW3vo8/au3nP/f+7n2ff44VAIQJAIQJAIQJAIQJAIQJAIQJAIRtfg5g1Og+/7H7/3++Grr9r195fdqyvb+/o6wAIEwAIEwAIEwAIEwAIEwAIEwAIGzXv3W+i+sGfPb52D76B398b+j2dR99/MnQ7d95e2yO4eB8AMBe+QoAYQIAYQIAYQIAYQIAYQIAYbs/H8DodQPW3sdmWYed7/PPsQKAMAGAMAGAMAGAMAGAMAGAMAGAMAGAMAGAMAGAMAGAMAGAMAGAMAGAMAGAsN2fD2DUN9/879a/v/zyb3+xx8JPf3+4nRUAhAkAhAkAhAkAhAkAhAkAhAkAhKXPiX4X1wX47POv7u7B8JO98/brQ6/awXUBgCpfASBMACBMACBMACBMACBMACDspL6Pv7TROYGt/9599HwJo/v8SztsfI7ACgDCBADCBADCBADCBADCBADCBADCTva+z//4lTenLbu8PKz9ENKe3xx2PSdgBQBhAgBhAgBhAgBhAgBhAgBhAgBhJ1v/vf7e9/n/8eUnQ8f/0xtjr8/fvvxi6PZ/eOO9ac+eD84JrD1HYAUAYQIAYQIAYQIAYQIAYQIAYQIAYffWfgD3T88X3Ue/uXl2699PTx9Mx2xuH310TmDU1vf5bwY/H6Of36XnCOZYAUCYAECYAECYAECYAECYAECYAEDY6nMALLsP/3jh47NtVgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQtvp1AZ589OdFj3/xwV8WPT7bdnr6YNXP56vvfzityQoAwgQAwgQAwgQAwgQAwgQAwgQAwlafA2BZT2++H7r96emdPRSOkBUAhAkAhAkAhAkAhAkAhAkAhAkAhJ0sfQfnj85eTCv6YfrVmnfPxr00fbfq/R8urxb9H7UCgDABgDABgDABgDABgDABgDABgLDF5wD2Pmfw4OFvpmP27Prbodvv/fkd+z790qwAIEwAIEwAIEwAIEwAIEwAIEwAIGzz1wVYeh927TkD2vv0S7MCgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgLB7U9z5o7MXaz8G1nt/D5dXJ+XX3woAwgQAwgQAwgQAwgQAwgQAwgQAwvJzAKOeXX877dnen1+dFQCECQCECQCECQCECQCECQCECQCECQCECQCECQCECQCECQCECQCECQCECQAAAAAAAAAAAEzb9yPfPh5bRS5RpwAAAABJRU5ErkJggg==",
};

    /* —— 悬浮学习台：挂在 body 上（#view 之外，换页不重建），绑一次就够 —— */
    var dock = document.createElement("div");
    dock.className = "dock";
    dock.innerHTML =
      '<section class="dk-panel" id="dk-panel" hidden aria-label="学习台面板">' +
        '<div class="dk-clock">' +
          '<p class="clock-t" id="dk-time">--:--:--</p>' +
          '<div class="dk-d"><span id="dk-date">—</span>' +
            '<span class="dk-hol" id="dk-hol" hidden></span>' +
            '<span class="dk-meta" id="dk-meta"></span></div>' +
          '<button class="dk-holbtn" id="dk-holbtn" type="button" aria-expanded="false" ' +
            'aria-controls="dk-hollist">全年假期安排 ▾</button>' +
          '<ul class="hol-list" id="dk-hollist" hidden></ul>' +
        "</div>" +
        '<div class="dk-sec" id="dk-stats"></div>' +
        '<div class="dk-sec dk-todo">' +
          '<div class="todo-head"><h3>待办清单</h3><span class="todo-n" id="dk-cnt"></span></div>' +
          '<ul class="todo-list" id="dk-list"></ul>' +
          '<form class="todo-add" id="dk-form">' +
            '<input id="dk-input" type="text" maxlength="80" autocomplete="off" ' +
              'placeholder="添加一条待办，回车确认……" aria-label="添加待办">' +
            "<button type=\"submit\">添加</button>" +
          "</form>" +
        "</div>" +
      "</section>" +
      '<button class="dk-btn" id="dk-btn" type="button" aria-expanded="false" aria-controls="dk-panel" ' +
        'title="点开学习台（时间 · 进度 · 待办）；按住可拖到任意位置">' +
        '<span class="dk-petwrap">' +
          '<img class="dk-pet" id="dk-pet" alt="" width="256" height="304" ' +
            'src="' + PET_SPRITES.idle + '">' +
          '<span class="dk-badge" id="dk-badge" hidden></span>' +
        "</span>" +
        '<span class="dk-mini" id="dk-mini">--:--</span>' +
      "</button>";
    document.body.appendChild(dock);

    var panel = document.getElementById("dk-panel");
    var btn = document.getElementById("dk-btn");

    /* —— 桌宠状态机 ——
       基础姿态：面板展开中「捧书」→ 久未操作「打盹」→ 否则「待机」。
       临时姿态：悬停「挥手」、清空待办「举拳」，到期自动回落到基础姿态。 */
    var petEl = document.getElementById("dk-pet");
    var petCur = "idle", petTemp = null, petTempT = 0, petLastAct = Date.now();
    var PET_IDLE_MS = 90000;                       // 多久没动静开始打盹

    function petShow(p) {
      if (!petEl || p === petCur) return;
      if (!PET_SPRITES[p]) p = "idle";
      petCur = p;
      petEl.src = PET_SPRITES[p];
    }
    function petBase() {
      if (panel && !panel.hidden) return "read";   // 面板开着 → 捧《资本论》
      if (Date.now() - petLastAct > PET_IDLE_MS) return "sleep";
      return "idle";
    }
    function petFlash(p, ms) {                     // 临时姿态，ms 毫秒后回落
      if (!PET_SPRITES[p]) return;
      petTemp = p;
      petTempT = Date.now() + ms;
      petShow(p);
    }
    function petTick() {
      if (!petTemp) { petShow(petBase()); return; }
      if (Date.now() >= petTempT) { petTemp = null; petShow(petBase()); }
    }
    petShow("idle");
    setInterval(petTick, 500);

    /* 眨眼：只在待机（且无临时姿态）时随机眨一下，150ms 后睁开 */
    (function petBlinkLoop() {
      setTimeout(function () {
        if (!petTemp && petBase() === "idle") {
          petShow("blink");
          setTimeout(function () { if (!petTemp) petShow(petBase()); }, 150);
        }
        petBlinkLoop();
      }, 3000 + Math.random() * 2000);
    })();

    /* 指针移到小人身上 → 挥手打招呼 */
    btn.addEventListener("pointerenter", function () { petFlash("wave", 1200); });

    /* 任何操作都算「活跃」，把打盹计时拨回 0（passive：不影响滚动性能） */
    ["pointerdown", "pointermove", "keydown", "wheel", "scroll"].forEach(function (evt) {
      window.addEventListener(evt, function () { petLastAct = Date.now(); }, { passive: true });
    });

    /* —— 拖动：按住小人拖到任意位置，位置记在本机（换页、刷新都还在） ——
       位置落到 left/top 内联样式上，CSS 的 right/bottom 就不再生效；
       拖动中不做整页重绘，只改 dock 自己的坐标。 */
    var DOCKKEY = "capital-dict-dock-v1";
    var dockStore = (function () {
      try {
        var p = window.localStorage;
        p.setItem("__dock_probe__", "1");
        p.removeItem("__dock_probe__");
        return p;
      } catch (e) { return null; }
    })();
    var dockPos = (function () {
      try {
        var d = JSON.parse((dockStore && dockStore.getItem(DOCKKEY)) || "null");
        return d && isFinite(d.x) && isFinite(d.y) ? d : null;
      } catch (e) { return null; }
    })();

    function placeDock(x, y) {
      var r = dock.getBoundingClientRect();
      var w = r.width || 74, h = r.height || 34;
      var maxX = Math.max(6, window.innerWidth - w - 6);
      var maxY = Math.max(6, window.innerHeight - h - 6);
      x = Math.max(6, Math.min(maxX, x));
      y = Math.max(6, Math.min(maxY, y));
      dock.style.left = x + "px";
      dock.style.top = y + "px";
      dock.style.right = "auto";
      dock.style.bottom = "auto";
      // 圆标在左半屏 → 面板往右开，否则往左开
      dock.classList.toggle("left", x + w / 2 < window.innerWidth / 2);
      return { x: x, y: y };
    }
    function saveDockPos() {
      if (!dock.style.left) return;
      dockPos = { x: parseFloat(dock.style.left) || 0, y: parseFloat(dock.style.top) || 0 };
      if (!dockStore) return;
      try { dockStore.setItem(DOCKKEY, JSON.stringify(dockPos)); } catch (e) { /* 存不下就算了 */ }
    }
    if (dockPos) placeDock(dockPos.x, dockPos.y);
    window.addEventListener("resize", function () {
      if (!dock.style.left) return;                 // 没拖过就交给 CSS
      placeDock(parseFloat(dock.style.left) || 0, parseFloat(dock.style.top) || 0);
      saveDockPos();
    });

    var drag = null, dragged = false;
    btn.addEventListener("pointerdown", function (ev) {
      if (ev.button) return;                        // 只认左键 / 触摸
      var r = dock.getBoundingClientRect();
      drag = { id: ev.pointerId, sx: ev.clientX, sy: ev.clientY, ox: r.left, oy: r.top };
      try { btn.setPointerCapture(ev.pointerId); } catch (e) { /* 老浏览器忽略 */ }
    });
    btn.addEventListener("pointermove", function (ev) {
      if (!drag || ev.pointerId !== drag.id) return;
      var dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
      if (!dragged && Math.abs(dx) + Math.abs(dy) < 4) return;   // 手抖不算拖动
      dragged = true;
      placeDock(drag.ox + dx, drag.oy + dy);
    });
    function endDrag(ev) {
      if (!drag || ev.pointerId !== drag.id) return;
      try { btn.releasePointerCapture(ev.pointerId); } catch (e) { /* 同上 */ }
      drag = null;
      if (dragged) saveDockPos();
    }
    btn.addEventListener("pointerup", endDrag);
    btn.addEventListener("pointercancel", endDrag);

    btn.addEventListener("click", function () {
      if (dragged) { dragged = false; return; }     // 刚拖完那一下不算点击
      var open = panel.hidden;
      panel.hidden = !open;
      btn.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        renderDockStats(); renderTodo(); paintClock();
        // 上方空间不够就把面板翻到圆标下方，免得顶出屏幕
        dock.classList.remove("below");
        if (panel.getBoundingClientRect().top < 8) dock.classList.add("below");
      }
    });

    /* 全年假期安排：默认收起，点开才铺开——时钟区不该一上来就占满面板 */
    var holBtn = document.getElementById("dk-holbtn");
    if (holBtn) holBtn.addEventListener("click", function () {
      var ul = document.getElementById("dk-hollist");
      var open = ul.hidden;
      ul.hidden = !open;
      holBtn.classList.toggle("on", open);
      holBtn.setAttribute("aria-expanded", open ? "true" : "false");
      holBtn.textContent = open ? "全年假期安排 ▴" : "全年假期安排 ▾";
      if (open) renderHolidayList();
    });

    /* 待办：勾选 / 删除 / 清除已完成 —— 委托在 dock 根元素上。
       只重画待办列表本身（renderTodo），不整页重绘，输入框才不会失焦。 */
    dock.addEventListener("click", function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest("[data-todo]") : null;
      if (!el || !dock.contains(el)) return;
      var act = el.getAttribute("data-todo");
      // 清除已完成 → 小人举拳庆祝 1.5 秒（临时姿态，之后自动回落）
      if (act === "clear") { TODO.clearDone(); renderTodo(); petFlash("cheer", 1500); return; }
      var li = el.closest("[data-tid]");
      if (!li) return;
      var id = li.getAttribute("data-tid");
      if (act === "toggle") TODO.toggle(id);
      else if (act === "del") TODO.del(id);
      else return;
      renderTodo();
    });

    /* 回车即添加。用 form 的 submit 而不是给 input 绑 keydown——
       这样点击「添加」按钮、手机键盘上的「前往」键都走同一条路。 */
    dock.addEventListener("submit", function (ev) {
      var f = ev.target;
      if (!f || !f.matches || !f.matches("#dk-form")) return;
      ev.preventDefault();
      var input = f.querySelector("#dk-input");
      if (!input) return;
      if (TODO.add(input.value)) input.value = "";     // 添加成功才清空
      renderTodo();
      input.focus();
    });

    renderDockStats();
    renderTodo();

    /* 标签页首字母索引：悬停/触摸字母 → 字母与云里对应首字母的标签同时高亮、
       其余淡出；点击字母 → 只留该字母的标签（过滤），再点还原。
       同样委托绑在 #view 上，一次绑定、各次路由渲染通用。 */
    var idxCloud = function () { return document.getElementById("tagcloud-main"); };

    function tagIdxReset() {
      app.querySelectorAll(".tag-idx .ti.on, .tag-idx .ti.sel").forEach(function (b) {
        b.classList.remove("on", "sel");
      });
      var cloud = idxCloud();
      if (!cloud) return;
      cloud.querySelectorAll(".tag.hit, .tag.dim, .tag.hide").forEach(function (t) {
        t.classList.remove("hit", "dim", "hide");
      });
      var cnt = document.getElementById("tagcloud-count");
      if (cnt) cnt.textContent = cnt.getAttribute("data-n") + " 个标签";
    }
    function tagIdxHi(letter) {
      var cloud = idxCloud();
      if (!cloud) return;
      cloud.querySelectorAll(".tag").forEach(function (t) {
        var hit = t.getAttribute("data-in") === letter;
        t.classList.toggle("hit", hit);
        t.classList.toggle("dim", !hit);
      });
    }
    function tagIdxPoint(letter) {   // 悬停 / 触摸 / 键盘聚焦 共用
      tagIdxReset();
      var b = app.querySelector('.tag-idx .ti[data-in="' + letter + '"]');
      if (b) b.classList.add("on");
      tagIdxHi(letter);
    }

    app.addEventListener("mouseover", function (ev) {
      if (!idxCloud()) return;                       // 只在标签总览页生效
      var b = ev.target && ev.target.closest ? ev.target.closest(".tag-idx .ti") : null;
      if (b) { tagIdxPoint(b.getAttribute("data-in")); return; }
      if (!(ev.target.closest && ev.target.closest(".tag-idx"))) tagIdxReset();
    });
    app.addEventListener("mouseout", function (ev) {
      if (!idxCloud()) return;
      if (!(ev.target.closest && ev.target.closest(".tag-idx"))) return;
      var to = ev.relatedTarget;
      if (!to || !to.closest || !to.closest(".tag-idx")) tagIdxReset();
    });
    // 键盘可达：Tab 聚焦字母等同悬停，移开还原
    app.addEventListener("focusin", function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest(".tag-idx .ti") : null;
      if (b) tagIdxPoint(b.getAttribute("data-in"));
    });
    app.addEventListener("focusout", function (ev) {
      if (ev.target.closest && ev.target.closest(".tag-idx")) tagIdxReset();
    });
    // 触屏：手指按住字母即高亮（随后的 click 负责过滤）
    app.addEventListener("touchstart", function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest(".tag-idx .ti") : null;
      if (b) { tagIdxPoint(b.getAttribute("data-in")); }
    }, { passive: true });

    app.addEventListener("click", function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest(".tag-idx .ti") : null;
      if (!b || !idxCloud()) return;
      var was = b.classList.contains("sel");
      var letter = b.getAttribute("data-in");
      tagIdxReset();
      if (!was) {
        b.classList.add("sel");
        var cloud = idxCloud(), shown = 0;
        cloud.querySelectorAll(".tag").forEach(function (t) {
          if (t.getAttribute("data-in") === letter) { t.classList.add("hit"); shown++; }
          else t.classList.add("hide");
        });
        var cnt = document.getElementById("tagcloud-count");
        if (cnt) cnt.textContent = "首字母 " + letter + " · " + shown + " 个标签";
      }
    });

    // 首页搜索框在路由切换后会重建，绑定一次即可（首页是默认视图）
    var obs = new MutationObserver(function () {
      var h = document.getElementById("heroQ");
      if (h && !h.__bound) { h.__bound = true; attachSearch(h, document.getElementById("heroR")); }
    });
    obs.observe(app, { childList: true });

    // 页脚状态行由数据算出，免得改了数据忘了改文案
    var fs = document.getElementById("footStatus");
    if (fs) {
      var s = stats();
      fs.innerHTML = "<strong>词条 " + s.total + " 条</strong> · 原典引文已补录 " + s.quoted +
        " 条并核到具体出处（图书给印刷页、报纸给见报日期）；另 " + s.pending +
        " 条已写明应引何处、待补原文。学界争鸣已写入 " + s.scholarTopic + " 条（" + s.scholarStance +
        " 方立场，其中 " + s.scholarCited + " 方文献已核），未核到的一律标「待核」。" +
        "";
    }

    // 今天来过（打卡）；悬浮台的连续天数靠它
    LR.touchDay();

    /* ══════════════════════════════════════════════════════════
       黑夜模式（v54）
       ----------------------------------------------------------------
       首屏定色在 index.html 的 <head> 里那段同步内联脚本已完成，
       所以这里**不负责首帧**（那会造成白闪 ＋ CLS），只做三件事：
         ① 接管切换按钮：点一下换 data-theme，并写进 localStorage；
         ② 把按钮的无障碍状态（aria-pressed / aria-label / title）与当前主题对齐；
         ③ 跟随系统变化 —— 但**只在用户还没手动选过**时跟随。
       存储用探针法（与 LR / CT 那两套一致）：file:// 下 localStorage 可能被禁，
       此时降级到内存变量，本次会话内仍可切换，绝不抛错。
       浅色是唯一的基础层，本模块只在 [data-theme="dark"] 下改变量，
       所以「不切就是原来的样子」是按构造保证的。
       ══════════════════════════════════════════════════════════ */
    (function () {
      var KEY = "capital-theme-v1";
      var d = document.documentElement;
      var btn = document.getElementById("themeBtn");

      /* 存储：探针 → 可用则 localStorage，否则退到内存 */
      var store = null;
      try {
        var probe = window.localStorage;
        probe.setItem("__theme_probe__", "1");
        probe.removeItem("__theme_probe__");
        store = probe;
      } catch (e) { store = null; }
      var memTheme = null;
      function read() {
        if (store) { try { return store.getItem(KEY); } catch (e) { return memTheme; } }
        return memTheme;
      }
      function write(v) {
        memTheme = v;
        if (store) { try { store.setItem(KEY, v); } catch (e) { /* 退内存 */ } }
      }

      function cur() { return d.getAttribute("data-theme") === "dark" ? "dark" : "light"; }

      /* src=manual 表示用户手动选过 —— 此后不再跟随系统变化。
         首屏脚本设的是 init，模块启动时先按"还没手动选过"处理，
         这样首次访问仍会跟随系统。 */
      /* 「用户是否手动选过」的权威依据是**存储里有没有值**。
         DOM 上的 data-theme-src 只是本会话的快镜（首屏脚本那次写入也算 src=init），
         两者都查：存储里有值 ⇒ 手动选过；否则再看 src 属性（同一会话内切过也算）。 */
      function isManual() {
        var v = read();
        if (v === "light" || v === "dark") return true;
        return d.getAttribute("data-theme-src") === "manual";
      }

      function apply(t, src) {
        d.setAttribute("data-theme", t);
        d.setAttribute("data-theme-src", src || "manual");
        syncBtn(t);
        /* 切主题时把活动元素交还给身体：焦点环画在被改色的按钮上会闪一下 */
        if (btn && document.activeElement === btn) btn.blur();
      }

      function syncBtn(t) {
        if (!btn) return;
        var dark = t === "dark";
        btn.setAttribute("aria-pressed", dark ? "true" : "false");
        /* label 写「按下之后会变成什么」，不是「现在是什么」——
           读屏用户与鼠标用户拿到的应当是同一个可执行信息。 */
        var to = dark ? "切换到浅色模式" : "切换到黑夜模式";
        btn.setAttribute("aria-label", to);
        btn.setAttribute("title", to);
      }

      if (btn) {
        syncBtn(cur());          /* 首屏脚本已定好主题，这里只同步按钮的 a11y 状态 */
        btn.addEventListener("click", function () {
          var next = cur() === "dark" ? "light" : "dark";
          apply(next, "manual");
          write(next);            /* 写完即持久化，刷新后一致 */
        });
      }

      /* 跟随系统：只在用户没手动选过时生效。手动选过之后系统再变也不动 ——
         这是「用户的选择优先」的规矩，否则夜里在别人机器上被改成深色会莫名其妙。 */
      if (window.matchMedia) {
        var mq = window.matchMedia("(prefers-color-scheme: dark)");
        var onChange = function (e) {
          if (isManual()) return;
          apply(e.matches ? "dark" : "light", "system");
          if (btn) btn.setAttribute("title",
            e.matches ? "跟随系统：黑夜（点击改为浅色）" : "跟随系统：浅色（点击改为黑夜）");
        };
        /* addEventListener 是标准写法；老式 addListener 只在很老的浏览器里有 */
        if (mq.addEventListener) mq.addEventListener("change", onChange);
        else if (mq.addListener) mq.addListener(onChange);
      }

      /* 供断言与其他代码读当前主题（不导出到全局命名空间，用 data 属性即可） */
      d.setAttribute("data-theme-ready", "1");
    })();

    /* —— 顶栏：二级菜单与窄屏抽屉 ——
       桌面展开交给 CSS（:hover / :focus-within），这里只补三件 CSS 办不到的事：
       触屏与键盘要有可点的三角、同时只开一层、点别处或按 Esc 要收回去。 */
    (function () {
      var bar = document.getElementById("navLinks");
      var tog = document.getElementById("navToggle");
      if (!bar) return;
      fillNavTools();

      /* 桌面悬停补一层 JS 宽限期：缩放到 175%、导航换行时，触发器与面板
         之间隔着一整行，鼠标走缝里 CSS :hover 瞬间断开、菜单当场收掉。
         离开菜单项后先留 160ms 再收——走完缝进了面板，mouseenter 会续上。 */
      if (window.matchMedia && window.matchMedia("(hover: hover)").matches) {
        Array.prototype.forEach.call(bar.querySelectorAll(".nav-item"), function (it) {
          if (!it.querySelector(".nav-panel")) return;   // 无面板的一级链接不用管
          var t = null;
          it.addEventListener("mouseenter", function () {
            var tb = it.closest(".topbar");
            if (tb && tb.classList.contains("nav-lock")) return;   // 滚动锁期间不开
            if (t) { clearTimeout(t); t = null; }
            closeNavMenus(it);
            it.classList.add("open");
            var c = it.querySelector(".nav-caret");
            if (c) c.setAttribute("aria-expanded", "true");
          });
          it.addEventListener("mouseleave", function () {
            if (t) clearTimeout(t);
            t = setTimeout(function () {
              t = null;
              it.classList.remove("open");
              var c = it.querySelector(".nav-caret");
              if (c) c.setAttribute("aria-expanded", "false");
            }, 160);
          });
        });
      }

      function drawer(open) {
        bar.classList.toggle("open", open);
        if (tog) tog.setAttribute("aria-expanded", open ? "true" : "false");
      }
      function collapse() { closeNavMenus(null); if (bar.classList.contains("open")) drawer(false); }

      bar.addEventListener("click", function (ev) {
        var t = ev.target;
        var c = t.closest ? t.closest(".nav-caret") : null;
        if (c) {
          var item = c.closest(".nav-item");
          var was = item.classList.contains("open");
          closeNavMenus(item);
          item.classList.toggle("open", !was);
          c.setAttribute("aria-expanded", was ? "false" : "true");
          ev.preventDefault();
          return;
        }
        if (t.closest && t.closest("a")) collapse();   // 点了就走，别把菜单留在原地
      });
      if (tog) tog.addEventListener("click", function (ev) { ev.stopPropagation(); drawer(!bar.classList.contains("open")); });
      document.addEventListener("click", function (ev) {
        if (bar.contains(ev.target) || (tog && tog.contains(ev.target))) return;
        collapse();
      });
      document.addEventListener("keydown", function (ev) {
        if (ev.key === "Escape" || ev.key === "Esc") collapse();
      });
    })();

    ctLoad();   // 概念对照表上次选的词条，回来还在
    hdLoad();   // 讲义里选好的那批词条，也留着
    // 后台标签页里定时器会被浏览器节流，切回来先校准一次
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) paintClock();
    });
    startClock();

    /* 解析器单独挂出来一份：自测脚本要逐个模块验，控制台里也方便手验一段
       文件为什么不认。（只为调试，站点功能不依赖它。） */
    window.CAPITAL_IO = {
      inflate: INFLATE.inflate,
      inflateRaw: INFLATE.inflateRaw,
      zipIndex: zipIndex,
      docxText: docxText,
      pdfExtract: pdfExtract,
      decodeBytes: decodeBytes,
      fileToText: fileToText,
      analyzeConcepts: analyzeConcepts,
      taSeg: taSeg,
      taCompute: taCompute,
      /* 文本分析：文件只能从 <input type=file> 或拖拽进来，自测造不出 FileList，
         故把「载入一条 / 清空」两个内部动作挂出来，供自测验多文件词频对比。 */
      ttAddDoc: ttAddDoc,
      ttClearDocs: function () { ttDocs = []; renderTtFiles(); renderTextTool(); renderTa(); },
      xlsxBuild: xlsxBuild,
      docxBuild: docxBuild,
      kwHit: kwHit,
      kwExpr: kwExpr,
      mtRows: mtRows,
      nbMap: function () { nbMapLoad(); return NBM; },
      nbMapAdd: nbMapAdd,
      nbMapMarkdown: nbMapMarkdown,
      /* 学习与记忆四件：出题、排期、卡片、日历各挂一个入口，自测脚本逐个验 */
      quizPool: quizPool,
      quizBuild: quizBuild,
      quizMark: quizMark,
      scopeOpts: scopeOpts,
      qzMask: qzMask,
      srsQueue: srsQueue,
      srsGrade: srsGrade,
      srsPullForward: srsPullForward,
      cardRows: cardRows,
      cardCsv: cardCsv,
      cardBlocks: cardBlocks,
      cardMarkdown: cardMarkdown,
      /* 滚动入场与标题强调字（v10）：自测要验 .rv/.rv-in 真的挂上、书名号真的包了楷体 */
      rvScan: rvScan,
      /* 门类卡配图与错峰入场（v30） */
      cvScan: cvScan,
      cvKick: cvKick,
      /* 首页数据带数字滚轮（v35）：自测要验触发时机、终值、减动效与重滚 */
      odScan: odScan,
      odKick: odKick,
      odSet: odSet,
      odCfg: function () { return OD_CFG; },
      /* 关系图 v43 起画布在 pathflow.html（那边自带 window.PATHFLOW 调试句柄），
         站内这套 SVG 力导引实现连同它的搜索与聚焦子图一并撤掉，故此处不再出口。 */
      catCover: function () { return CAT_COVER; },
      hlTitle: hlTitle,
      /* 分析与教学四件：路径、算式、年表、讲义各挂入口 */
      pathModes: function () { return PTH_MODE; },
      pathBuild: pathBuild,
      pathFind: pathFind,
      pathHopText: pathHopText,
      pathText: pathText,
      calcModes: function () { return CALC_MODES; },
      calcRun: calcRun,
      calcFieldsHTML: calcFieldsHTML,
      chrono: function () { return CHRONO; },
      chronoAxes: function () { return CHRONO_AX; },
      chronoSrc: function () { return CHRONO_SRC; },
      chronoByAxis: chronoByAxis,
      chronoBodyHTML: chronoBodyHTML,
      chronoBlocks: chronoBlocks,
      hd: function () { return HD; },
      hdAdd: hdAdd,
      hdDel: hdDel,
      hdDocHTML: hdDocHTML,
      hdBlocks: hdBlocks,
      pj: function () { return PJ; },
      pjOpen: pjOpen,
      pjGo: pjGo,
      pjClose: pjClose,
      /* 桌宠：像素小人姿态机。挂出来只为自测能脱离定时器做确定性断言，
         站点功能本身不依赖这些入口。 */
      petPoses: function () { return Object.keys(PET_SPRITES); },
      petShow: petShow,
      petBase: petBase,
      petFlash: petFlash,
      petTick: petTick,
      petCur: function () { return petCur; },
      petWake: function () { petLastAct = Date.now(); },   // 把「打盹计时」拨回 0
      petSrc: function () { return petEl && petEl.src ? petEl.src : ""; },
      lr: function () { return LR; },      // 只为调试与自测；站点功能不依赖它
      lrExport: function () { return LR.export_(); },
      /* 阅读器：挂出来给自测做确定性断言 */
      readerListZip: readerListZip,
      readerParseEpub: readerParseEpub,
      readerHistory: readerHistory,
      readerIdx: readerBuildIdx,
      readerLookup: readerLookup,
      readerDropLookup: readerDropLookup,
      deepSearch: deepSearch,
      deepFlash: deepFlash,
      hlSnippet: hlSnippet,
      wt: function () { return WT; },
      wtLoad: function () { return wtLoad(), WT; },
      wtAddTerm: wtAddTerm,
      wtBlocks: wtBlocks,
      wtMarkdown: wtMarkdown,
      wtFootnotes: wtFootnotes,
      wtStats: wtStats,
      wtRender: wtRender,
      wtSave: wtSave,
      readerTermModal: readerTermModal,
      readerTermModalClose: readerTermModalClose,
      rdState: function () { return READER; },
      /* v58 书签与阅读记录：挂出来给自测做确定性断言 */
      rdBookmarks: rdBookmarks,
      rdBmAdd: rdBmAdd,
      rdBmRename: rdBmRename,
      rdBmDel: rdBmDel,
      rdBmGroups: rdBmGroups,
      rdBmPanelSync: rdBmPanelSync,
      rdBmSetOpen: rdBmSetOpen,
      rdBmPanelHTML: rdBmPanelHTML,
      rdBmGo: rdBmGo,
      rdBmPrompt: rdBmPrompt,
      rdRecords: rdRecords,
      rdRecList: rdRecList,
      rdRecGet: rdRecGet,
      rdRecDel: rdRecDel,
      rdRecClear: rdRecClear,
      rdRecTouch: rdRecTouch,
      rdRecWrite: rdRecWrite,
      rdProbe: rdProbe,
      rdTimeStart: rdTimeStart,
      rdTimeStop: rdTimeStop,
      rdResumePending: rdResumePending,
      rdResumeChapter: rdResumeChapter,
      rdBookKey: rdBookKey,
      rdFmtDur: rdFmtDur,
      rdFmtAgo: rdFmtAgo,
      readerRenderLanding: readerRenderLanding,
      readerLoaded: readerLoaded,
      /* 翻页模式的排版状态与重排入口：给自测/调试用（几何一变就重排） */
      rdPg: function () { return PG; },
      rdPgLayout: function (keep) { readerPgLayout(keep !== false); },
      readerRenderViewer: readerRenderViewer,
      readerSearchTerms: readerSearchTerms,
      tools: function () { return TOOLS; },
      toolFlat: function () { return TOOL_FLAT; },
    };

    window.addEventListener("hashchange", route);

    /* —— 首页「拼音索引 A–Z」抽屉：点标题平滑收展（点里面的链接照常跳转）。
       事件挂 document 级一次性委托：视图是每次路由重画的，挂视图上会丢。 */
    (function () {
      function flip(t) {
        var d = document.getElementById(t.getAttribute("aria-controls") || "idxDrawer");
        if (!d) return;
        var closed = d.classList.toggle("closed");
        t.classList.toggle("closed", closed);
        t.setAttribute("aria-expanded", closed ? "false" : "true");
      }
      document.addEventListener("click", function (ev) {
        var t = ev.target && ev.target.closest ? ev.target.closest(".idx-toggle") : null;
        if (!t) return;
        if (ev.target.closest("a")) return;          // 标题里的「拼音索引 A–Z」链接照常跳
        flip(t);
      });
      document.addEventListener("keydown", function (ev) {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        var t = ev.target && ev.target.closest ? ev.target.closest(".idx-toggle") : null;
        if (!t) return;
        ev.preventDefault();
        flip(t);
      });
    })();

    /* —— 顶栏滚动液态玻璃 + 滚动收菜单（v11 修复「滚动中文字消失」）——
       视频里的故障链：悬停打开巨型菜单后滚轮滚动 → 指针没动，:hover 仍在，
       面板钉在顶栏下不收，正文从面板底下穿过去，文字互相叠印；
       且面板旧版带 backdrop-filter，滚动合成时触发「整块不涂底色」的
       Chromium 渲染故障，看起来就是文字消失。双管齐下：
       ① CSS 已摘掉面板的 backdrop-filter；② 这里一滚动就收菜单并给顶栏
       上 nav-lock（锁期间悬停不再弹开），等指针真移动了才解锁——
       否则指针停在触发器上，:hover 会瞬间把菜单弹回来。 */
    (function () {
      var topbar = document.querySelector(".topbar");
      if (!topbar) return;
      var stamp = 0, lastY = window.scrollY;
      /* 阅读进度金线：只写一个 CSS 变量，由 .topbar::after 做 scaleX——
         整个更新走合成层，不重排；rAF 合帧，滚动多快都只画一次 */
      var raf = 0;
      var nextFrame = window.requestAnimationFrame
        ? window.requestAnimationFrame.bind(window)
        : function (f) { return setTimeout(f, 16); };   // 无 rAF 的环境（老浏览器/测试沙箱）兜底
      var paintProgress = function () {
        raf = 0;
        var h = document.documentElement.scrollHeight - window.innerHeight;
        var r = h > 0 ? Math.min(1, Math.max(0, window.scrollY / h)) : 0;
        topbar.style.setProperty("--sp", r.toFixed(4));
      };
      var shut = function () {
        if (typeof closeNavMenus === "function") closeNavMenus(null);
        topbar.classList.add("nav-lock");
        stamp = Date.now();
      };
      var onScroll = function () {
        topbar.classList.toggle("glassy", window.scrollY > 24);
        if (!raf) raf = nextFrame(paintProgress);
        if (window.scrollY !== lastY) { lastY = window.scrollY; shut(); }
      };
      /* 指针一动＝新的悬停意图，滚动锁即刻解除（离上次收起 350ms 以上） */
      document.addEventListener("mousemove", function () {
        if (topbar.classList.contains("nav-lock") && Date.now() - stamp > 350)
          topbar.classList.remove("nav-lock");
      }, { passive: true });
      /* 滚轮在菜单还没来得及滚动前就先收（capture：reader 等内滚区也拦） */
      document.addEventListener("wheel", shut, { passive: true, capture: true });
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    })();

    /* ============ 作品名文本统一口径（v40） ============
       需求：所有与「Das Kapital」/《资本论》相关的文本字号要「一处改动、全站同步」。
       做法分两层：
         ① 结构性文本（开屏主标题、序言出处、会议名、品牌名）在 HTML 里挂 .kp 类，
            字号 = --kp-base × --kp-scale；
         ② 正文里零散出现的「《资本论》/Das Kapital」由 kpWrap() 现场包一层
            span.kp.kp-in —— --kp-base 缺省 1em，即随所在段落等比放大，
            段落之间不会出现「同级别文字大小不一」。
       两层的系数是同一个 --kp-scale（site.css 末尾），所以改一处即全站同步。
       幂等：祖先里已有 .kp（或 .sr-only / [data-nokp]）的文本节点直接跳过，
       换页重绘、反复调用都不会二次包裹、不会层层放大。 */
    var KP_RE = /《资本论》|Das Kapital/g;
    /* 这些标签里不是给人看的正文，包了反而添乱 */
    var KP_SKIP_TAG = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TITLE: 1, TEXTAREA: 1,
      INPUT: 1, SELECT: 1, OPTION: 1, SVG: 1, CODE: 1, PRE: 1 };

    function kpWrap(root) {
      if (!root || !document.createTreeWalker) return 0;
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
          var p = node.parentElement;
          if (!p) return NodeFilter.FILTER_REJECT;
          if (KP_SKIP_TAG[p.tagName]) return NodeFilter.FILTER_REJECT;
          if (p.closest && p.closest(".kp, .sr-only, [data-nokp]"))
            return NodeFilter.FILTER_REJECT;
          KP_RE.lastIndex = 0;
          return KP_RE.test(node.nodeValue)
            ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });
      /* 先收齐再改：一边遍历一边替换会让 TreeWalker 的游标错位 */
      var jobs = [], n;
      while ((n = walker.nextNode())) jobs.push(n);

      jobs.forEach(function (node) {
        var text = node.nodeValue, last = 0, m;
        var frag = document.createDocumentFragment();
        KP_RE.lastIndex = 0;
        while ((m = KP_RE.exec(text))) {
          if (m.index > last)
            frag.appendChild(document.createTextNode(text.slice(last, m.index)));
          var sp = document.createElement("span");
          sp.className = "kp kp-in";
          sp.textContent = m[0];
          frag.appendChild(sp);
          last = m.index + m[0].length;
        }
        if (last < text.length)
          frag.appendChild(document.createTextNode(text.slice(last)));
        node.parentNode.replaceChild(frag, node);
      });
      return jobs.length;
    }

    function watchKapital() {
      /* 先过一遍静态部分（顶栏、页脚这些不在 #view 里的），再盯住 #view 的动态重绘 */
      kpWrap(document.body);
      var host = document.getElementById("view");
      if (!host || !window.MutationObserver) return;
      var obs = new MutationObserver(function () {
        /* 包裹动作本身会改 DOM：不断开就会自激成死循环 */
        obs.disconnect();
        kpWrap(host);
        obs.observe(host, { childList: true, subtree: true });
      });
      obs.observe(host, { childList: true, subtree: true });
    }

    route();
    watchKapital();
  });
})();
