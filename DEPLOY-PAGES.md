# GitHub Pages 首发部署手册

> 目标：把《资本论》学习平台发布成一个**可长期访问的公开地址**，且线上内容与投稿用的离线单文件**同源同字节**。
> 形态：一个公开仓库 → GitHub Actions 构建 → Pages 托管。无服务器、无数据库、无构建依赖（零 npm 包）。

---

## 一、整体思路

```
data/terms.json ──┐
site/index.html   ├─ node scripts/build.mjs --offline ─→ dist/capital-dict-offline.html（去注释、全内联）
site/assets/*     ┘                                              │
                                                                 ▼
                            node scripts/make-pages.mjs --base <站点根地址>
                                                                 │
                                            _site/ index.html · 404.html · og-cover.png
                                                   robots.txt · sitemap.xml · .nojekyll [· CNAME]
                                                                 │
                                                      GitHub Actions → Pages
```

三个关键决策，以及为什么：

| 决策 | 理由 |
|---|---|
| **发布「单文件离线版」而不是 `site/` 多文件版** | 与投稿离线件同一份字节，md5 可比；无相对路径，部署在 `/repo/` 子路径或裸域都不会错位；`site/` 带开发注释，交付件不该带 |
| **在 CI 里构建，不提交产物** | 3.4 MB 大文件不进版本历史；用自定义 Actions 工作流发布**不受「10 次构建/小时」软限** |
| **`make-pages.mjs` 只做发布态增补** | 单文件版被构建剥离了 `og:image`，源文件还带 `noindex`——上公网必须补回来并改成 `index,follow`。改发布副本，不动 `dist` |

---

## 二、仓库里有什么

| 路径 | 作用 | 是否入库 |
|---|---|---|
| `site/` | 站点源码（`index.html` / `assets/` / 构建出的 `data/terms.js`） | ✅（`terms.js` 除外） |
| `data/terms.json` | 词条唯一数据源（1.4 MB） | ✅ |
| `scripts/build.mjs` | 构建：去注释 + 资源内联 | ✅ |
| `scripts/make-pages.mjs` | 装配发布目录 | ✅ |
| `.github/workflows/pages.yml` | 发布流水线 | ✅ |
| `DEPLOY-PAGES.md` | 本手册 | ✅ |
| `dist/`、`_site/` | 构建产物 | ❌ 忽略 |
| `pictorial/`、`marx-book/`、`backup/`、`tests/` | 母版与备份、测试夹具 | ❌ 忽略 |
| `PHASE*.md`、`NOTES.md`、`RESOURCES.md` | 项目内部文档 | ❌ 忽略 |

> ⚠ **仓库不是备份。** `.gitignore` 刻意排除了 `pictorial/tmp/gen`（画传母版）与 `marx-book/`——这两处是不可再生的原件，请按 `STORAGE.md` 单独归档（移动硬盘 / 网盘），别指望仓库兜底。
> 入库体量约 6 MB（`site/` 3.8 MB + `data/terms.json` 1.4 MB + 脚本）。

---

## 三、一次性配置

### 1. 建仓库

在 GitHub 上新建 **public** 仓库（Free 账号的 Pages 只能用公开仓库），建议命名 `capital-dict`。

### 2. 首次推送

在项目根目录执行（`<用户名>`、`<仓库名>` 换成实际值）：

```bash
git init -b main
git add -A
git commit -m "站点源码与发布流水线"
git remote add origin https://github.com/<用户名>/<仓库名>.git
git push -u origin main
```

首次 `push` 会要求凭据：用 **Git Credential Manager**（Windows 装 Git 时自带，会弹浏览器登录）或一个 **Personal Access Token**（Settings → Developer settings → Tokens，勾 `repo`）。

### 3. 打开 Pages

仓库 → **Settings → Pages → Build and deployment**：

- **Source** 选 **GitHub Actions**（不要选 “Deploy from a branch”）
- 保存后无需其他配置，工作流文件已就位

### 4. 等第一次部署

**Actions** 标签页会看到 `Deploy to GitHub Pages` 运行；首次约 1–3 分钟。完成后地址形如：

```
https://<用户名>.github.io/<仓库名>/
```

> 若仓库名为 `<用户名>.github.io`，地址就是根域 `https://<用户名>.github.io/`——一个账号只能有一个这样的站点。

---

## 四、日常发布流程

```bash
# 1. 改内容（site/ 或 data/terms.json）
# 2. 本地构建并检查
node scripts/build.mjs --offline
node scripts/make-pages.mjs --base https://<用户名>.github.io/<仓库名>/
# 3. 本地预览（可选）
python -m http.server 8099 -d _site
# 4. 提交推送，CI 自动发布
git add -A && git commit -m "内容更新：…" && git push
```

工作流内置 5 条上线断言，任一不过就**不会部署**：

1. `_site/index.html` 存在且 > 2 MB（防构建不完整）
2. `_site/404.html` 存在
3. `_site/.nojekyll` 存在
4. `robots` 已从 `noindex` 改为 `index,follow`
5. `canonical` 已注入

也可以在 Actions 页面手动 **Run workflow** 重发。

---

## 五、自定义域名与 HTTPS

> 完整版（含 Cloudflare 的 NS 切换、SSL 模式、缓存规则、橙云/灰云顺序、故障排查）见
> **`DOMAIN-CLOUDFLARE.md`**；本节只留最短路径与 GitHub 侧要点。
> 验收：`node scripts/verify-domain.mjs <域名>`（六组逐项打勾，失败退出码 1）。

### 1. DNS 记录

| 场景 | 记录类型 | 主机记录 | 值 |
|---|---|---|---|
| 裸域 `example.com` | A（4 条） | `@` | `185.199.108.153`、`185.199.109.153`、`185.199.110.153`、`185.199.111.153` |
| 裸域（支持 ALIAS 的 DNS） | ALIAS/ANAME | `@` | `<用户名>.github.io` |
| `www.example.com` | CNAME | `www` | `<用户名>.github.io`（**不带仓库名**） |

### 2. 在仓库里声明域名

```bash
node scripts/make-pages.mjs --domain example.com
```

`--domain` 会做两件事：把 `CNAME` 文件写进发布目录（内容只有裸域，不带协议、不带路径），并把 `--base` 自动设为 `https://example.com/`（canonical 与 `og:image` 跟着变）。提交推送后生效。

> 也可以在 Pages 设置页的 **Custom domain** 里填，效果相同；但用脚本能保证 `CNAME` 与 `canonical` 永远一致，不会一边改一边忘。

### 3. 开启 HTTPS

DNS 生效（通常几分钟到 24 小时）后，Pages 设置页的 **Enforce HTTPS** 变为可勾选。证书由 GitHub 自动签发，最长可能要 24 小时。**在证书签发完成前不要开强制 HTTPS**，否则会短暂打不开。

### 4. 常见故障

| 现象 | 原因 | 处理 |
|---|---|---|
| 打开是 404，但 Actions 成功 | 仓库名/路径拼错，或部署还没传播 | 等 1–2 分钟；确认访问的是 `https://<用户名>.github.io/<仓库名>/`（末尾斜杠） |
| 自定义域名报 “Domain's DNS record could not be verified” | A/CNAME 未生效或填了带仓库名的 CNAME | `nslookup` 核对；CNAME 值只写 `<用户名>.github.io` |
| 页面样式全丢、白屏 | 误选了 “Deploy from a branch”，发布的是未构建的 `site/` | Source 改回 **GitHub Actions**，重跑工作流 |
| 改了内容线上没变 | Pages 缓存固定约 10 分钟 | 等 10 分钟，或加 `?v=2` 强刷 |
| `Enforce HTTPS` 勾不上 | 证书未签发完（尤其刚改 DNS） | 等，最长 24 小时 |

---

## 六、上线前必须确认的约束

| 约束 | 现状 | 说明 |
|---|---|---|
| 站点体积 ≤ 1 GB | 3.4 MB | 远低于上限 |
| 单文件 ≤ 100 MB | 3.4 MB | 无压力 |
| 带宽 100 GB/月（软限） | 单次约 1 MB（gzip 后） | 约十万次访问，评审期足够 |
| **源仓库公开** | 公开 | Free 账号只能公开；若不愿公开源码，改用 Cloudflare Pages（支持私有仓库） |
| **不得用于商业用途** | 学术作品 | 符合条款 |
| 无服务端能力 | 纯静态 | 本站本就不需要后端；`localStorage` 存学习记录，换设备不同步 |
| 缓存约 10 分钟 | — | 演示/投稿前留出时间，别刚推送就截图 |
| 内地访问稳定性 | 一般 | `*.github.io` 时快时慢；正式对外建议绑自定义域名，或双托管（见下） |
| 内容合规 | 待你确认 | 引文版权、图片授权、不收集用户数据；站点已无第三方统计脚本 |
| 离线件仍要交 | 保留 | 投稿要求「访问地址 + 离线演示」，`dist/capital-dict-offline.html` 继续作为离线件单独提交，不因上线而废弃 |

---

## 七、上线后验证清单

```bash
# 1. 首页可达、体积正确
curl -sI https://<用户名>.github.io/<仓库名>/ | head -5

# 2. 关键 meta 正确
curl -s https://<用户名>.github.io/<仓库名>/ | grep -o 'name="robots"[^>]*>\|rel="canonical"[^>]*>\|og:image[^>]*>'

# 3. 404 兜底生效（应返回你自制的 404 页，而不是 GitHub 默认页）
curl -s -o /dev/null -w "%{http_code}\n" https://<用户名>.github.io/<仓库名>/no-such-page

# 4. 深链可用（hash 路由，服务端不参与）
#    浏览器打开 https://<用户名>.github.io/<仓库名>/#/c/phil
```

真机再确认三件事：手机 4G 打开首屏 ≤ 5 秒；微信内打开不被拦截、能正常滚动；从微信「复制链接」到系统浏览器打开同样正常。

---

## 八、后续可迭代的演进方向

| 优先级 | 方向 | 触发条件 |
|---|---|---|
| P1 | **双托管**：Cloudflare Pages 作主地址（带宽不限、国内可达更好、支持私有仓库与 `_headers`），GitHub Pages 作备份 | 收到评审「打不开」的反馈，或需要控制缓存头 |
| P1 | **接入访问统计**：Cloudflare Web Analytics（无 Cookie，不违反「不收集用户数据」的承诺） | 想知道有多少人真正打开过 |
| P2 | **发布多文件版**：给 `build.mjs` 加 `--web` 模式，拆出 CSS/JS/图片以利用浏览器缓存 | 首屏时间成为瓶颈（单文件 3.4 MB 无法分段加载） |
| P2 | **自动化回归**：把 `tmp/` 里的断言套件搬进 `tests/`，在 Actions 里跑一遍再发布 | 改动频率升高、开始出现回归 |
| P3 | **版本归档**：每次投稿/评审节点打 tag，`dist` 产物作为 Release 附件 | 需要「某年某月那一版」的可追溯性 |
| P3 | **自定义域名 + CDN** | 长期运营，且已确定域名 |

> 不建议的方向：把站点改造成小程序或塞进公众号（个人主体无 web-view、公众号无外链权限，详见前次选型分析）。真要进微信生态，路径是「企业/学校主体 + web-view 套壳」，而不是重写。
