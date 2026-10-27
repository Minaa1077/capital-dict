# 自定义域名 + Cloudflare 接入手册

> 目标：把 `https://minaa1077.github.io/capital-dict/` 换成一个自己的域名（如 `ctrans.cn`），
> 由 Cloudflare 管 DNS、TLS 与缓存，源站仍是 GitHub Pages，发版流程不变。
> 预计耗时：域名注册 10 分钟 ＋ DNS 生效 5 分钟–2 小时 ＋ 证书签发 5 分钟–24 小时；除域名年费外无其他费用。

---

## 0. 现状盘点（已从仓库确认，不必再问）

| 项 | 现状 |
|---|---|
| 源站 | GitHub Pages，仓库 `Minaa1077/capital-dict`，分支 `main` |
| 发布方式 | GitHub Actions（`pages.yml`）：build → make-pages → 上传 artifact → 部署 |
| 现有地址 | `https://minaa1077.github.io/capital-dict/`（**项目页**，带子路径） |
| 技术栈 | 零依赖纯静态单文件（3.3 MB，gzip 后约 1 MB），无服务端、无数据库、无第三方脚本 |
| 子页 | `marx-pictorial.html`（画传 5.1 MB）、`pathflow.html`（关系图 0.75 MB） |
| 备用托管 | Cloudflare Worker `capital-dict-site`（Direct Upload）；`workers.dev` 内地 DNS 污染，**不可用** |
| 域名 | **尚无**。仓库无 `CNAME`，无自定义域设置 |
| 域名支持 | `make-pages.mjs --domain <域>` 会写 `CNAME` 并把 canonical / og:image / sitemap 全改成该域（已实测） |

---

## 1. 还需要你提供的信息

| # | 需要确认 | 为什么 | 你填 |
|---|---|---|---|
| 1 | **域名与后缀**（如 `ctrans.cn` / `capital-read.top`） | 所有记录与证书都绑这一个名字 | |
| 2 | **注册商**（阿里云 / 腾讯云 / Namesilo / Cloudflare Registrar…） | 决定改 NS 的入口在哪 | |
| 3 | 是否已**实名认证**；后缀是否 `.cn` | `.cn` 不实名会停止解析；境外托管**不触发 ICP 备案**（备案只针对境内服务器） | |
| 4 | 主域用**裸域**还是 `www` | 建议裸域为主、`www` 301 过来（下面按此写） | |
| 5 | Cloudflare 账号情况（已知你有 `1026955077@qq.com`） | 需要能添加站点、改 DNS | |
| 6 | Worker `capital-dict-site` 是**退役**还是留作备份 | 同域不能同时绑 Pages 与 Worker；留着就得每次手动重拖，容易版本漂移 | |

> 只需要第 1、2、4 项我就能把仓库侧全部改完（CNAME、canonical、文档、验收）。
> 面板操作（改 NS、开橙云）需要你的账号；若愿意，我也可以代跑 DNS 部分——**给一个临时 API Token
> （权限只勾 `Zone → DNS → Edit`，限定该 Zone，用完即删）**，不要贴 Global API Key。

---

## 2. 三种接法，选哪一种

| 方案 | 做法 | 优点 | 代价 | 结论 |
|---|---|---|---|---|
| **A. GitHub Pages 作源站 + CF 代理** | DNS 指 GitHub，橙云开代理 | 发版仍由 CI 自动完成；CF 提供 TLS/HTTP2/缓存 | CF 回源仍要访问 GitHub | ✅ **推荐** |
| B. 域名绑到 Worker | Custom Domain 绑 `capital-dict-site` | 边缘直出，最快 | 每次发版**手动重拖 `_site`**，历史债，易漂移 | 暂不采用 |
| C. 只改 DNS（灰云） | 不开代理 | 证书签发/续期最顺 | 没有 CDN，内地依旧慢 | 作为 A 的**第一步** |

**落地顺序**：先按 C 走通（灰云 → GitHub 验证 → 证书），再切 A（开橙云 → 缓存规则）。
橙云一上来就开，GitHub 的域名验证大概率过不去。

---

## 3. 配置步骤（照抄参数即可）

### S1 注册域名
- 任意注册商买一个短域名；`.top` / `.xyz` 首年十几元，`.cn` 需实名。
- 无需备案（服务器在境外）；**不要**买「已备案域名」，用不上。

### S2 把域名加进 Cloudflare
1. Cloudflare Dashboard → **Add a site** → 输入**裸域**（`ctrans.cn`，不带 `www`、不带协议）。
2. 选 **Free** 计划 → Continue。
3. 记下面板给的两条 NS，形如：
   ```
   ada.ns.cloudflare.com
   bob.ns.cloudflare.com
   ```
   （实际名字以面板为准，不要照抄这两条。）

### S3 在注册商处改 NS
| 注册商 | 路径 |
|---|---|
| 阿里云 | 域名控制台 → 目标域名 → **DNS 修改** → 改为「使用自定义 DNS」→ 填 S2 的两条 |
| 腾讯云 | DNSPod 控制台 → 域名 → **DNS 服务器** → 自定义 |
| Namesilo / GoDaddy | 域名管理 → Nameservers → Custom |

等 Cloudflare 站点状态从 `Pending` 变 **Active**（几分钟到 24 小时）。**Active 之前不要做 S4 之后的步骤**。

### S4 建 DNS 记录（关键：先全部灰云）

| 类型 | 名称 | 内容 | 代理状态 | TTL |
|---|---|---|---|---|
| A | `@` | `185.199.108.153` | **DNS only（灰云）** | Auto |
| A | `@` | `185.199.109.153` | DNS only | Auto |
| A | `@` | `185.199.110.153` | DNS only | Auto |
| A | `@` | `185.199.111.153` | DNS only | Auto |
| AAAA | `@` | `2606:50c0:8000::153` | DNS only | Auto |
| AAAA | `@` | `2606:50c0:8001::153` | DNS only | Auto |
| AAAA | `@` | `2606:50c0:8002::153` | DNS only | Auto |
| AAAA | `@` | `2606:50c0:8003::153` | DNS only | Auto |
| CNAME | `www` | `minaa1077.github.io` | DNS only | Auto |

⚠ 三个常见错：
- CNAME 写成 `minaa1077.github.io/capital-dict`（**带路径必错**，GitHub 的 CNAME 只认主机名）；
- 裸域用 CNAME（GitHub 文档要求裸域用 A/AAAA；Cloudflare 虽能 flatten，但用 A 最稳）；
- 忘记关橙云（小云朵点成灰色，否则 GitHub 验证 DNS 时解析不到它自己的 IP）。

### S5 在 GitHub 声明域名
1. 仓库 → **Settings → Pages → Custom domain** → 填 `ctrans.cn` → **Save**。
2. 等出现 **DNS check successful**（几分钟；报错见第 6 节）。
3. 我在 CI 里已改成：`configure-pages` 读到自定义域后，`base_url` 自动变 `https://ctrans.cn/`，
   装配时自动带 `--domain`，于是 **CNAME 文件、canonical、og:image、sitemap 全部跟着换**，不用手工改代码。
   本地预览同等效果：
   ```bash
   node scripts/build.mjs --offline
   node scripts/make-pages.mjs --domain ctrans.cn --out tmp/_site-domaintest
   ```

### S6 等证书，勾强制 HTTPS
- Pages 页面会显示 **Certificate issued**（Let's Encrypt，通常几分钟，最长 24 小时）。
- 出现后勾上 **Enforce HTTPS**。
- ⚠ 证书没好之前勾它，站点会直接打不开。

### S7 开橙云 + Cloudflare 参数

DNS 页把 `@` 与 `www` 的云朵点成**橙色（Proxied）**，然后按下表设置：

| 面板 | 参数 | 值 | 说明 |
|---|---|---|---|
| SSL/TLS → Overview | 加密模式 | **Full (strict)** | 选 Flexible 会无限重定向；选 Full 不校验证书，易被中间人 |
| SSL/TLS → Edge Certificates | Always Use HTTPS | **ON** | 补上 http→https |
| 同上 | Automatic HTTPS Rewrites | **ON** | 混内容自动改写 |
| 同上 | Minimum TLS Version | **TLS 1.2** | 兼容与安全平衡 |
| 同上 | TLS 1.3 | **ON** | |
| 同上 | HSTS | 先 **OFF**；稳定一周后再开，max-age 先 6 个月 | 开早了难回退 |
| Speed → Optimization | Brotli | **ON** | 3.3 MB HTML 压缩到约 1 MB |
| 同上 | HTTP/3 (QUIC) | **ON** | |
| 同上 | 0-RTT | **OFF** | 与 HSTS 同开易出重放问题 |
| Security → Bots | Bot Fight Mode | **OFF** | 别拦真人评审 |
| Caching → Configuration | Caching Level | Standard | |

### S8 缓存规则（不加这条，等于没加速）

Cloudflare 默认**不缓存 HTML**。本站是「一个 3.3 MB 的 HTML ＋ 两个大子页」，必须显式放行边缘缓存：

**Caching → Cache Rules → Create rule**

| 规则 | 匹配表达式 | 设置 |
|---|---|---|
| ① 主页面 | `(http.host eq "ctrans.cn" and (http.request.uri.path eq "/" or http.request.uri.path eq "/index.html"))` | Cache eligibility: **Eligible**；Edge TTL: **2 小时（Ignore origin）**；Browser TTL: **5 分钟** |
| ② 子页 | `(http.host eq "ctrans.cn" and (http.request.uri.path eq "/marx-pictorial.html" or http.request.uri.path eq "/pathflow.html"))` | Eligible；Edge TTL **1 天**；Browser TTL **1 小时** |

**每次发版后要清缓存**：Caching → Configuration → **Purge Everything**（或按 URL 清 `/`）。
不清的话，最长 2 小时内读者看到的还是上一版——投稿前发版务必清。

> 更省心的替代：把 Edge TTL 设成 30 分钟，并在 CI 末尾加一步调用 CF Purge API（需要 `Zone.Cache Purge` Token）。要做我可以加。

### S9 Worker 的处置
- 自定义域已经给 Pages 用了，**Worker 不能再绑同一个域名**。
- 建议：CF Dashboard → Workers & Pages → `capital-dict-site` → Settings → 删除，或留着但只当离线备份（不要绑域）。
- 理由：它没有 CI，每次发版都要手动重拖 `_site`，两份必然漂移（上次首拖就出现过两边版本不一致）。

### S10 收尾
1. 更新投稿材料里的地址（`node scripts/make-submission.mjs` 后核对 html 的 canonical 已指向新域）；
2. `DEPLOY-PAGES.md`、`PHASE5.md` 的地址段落同步；
3. 推送（CI 自动部署）；4. 跑第 5 节验收。

---

## 4. 参数速查

```
裸域 A      185.199.108.153 / 109 / 110 / 111
裸域 AAAA   2606:50c0:8000::153 / 8001::153 / 8002::153 / 8003::153
www CNAME   minaa1077.github.io        （不带仓库名、不带路径）
代理        先 DNS only → 证书签发后改 Proxied
SSL 模式    Full (strict)
最小 TLS    1.2      HTTP/3 ON      Brotli ON      HSTS 暂关
缓存        / 与 *.html：Edge 2h / Browser 5m；子页 Edge 1d；发版后 Purge
```

---

## 5. 如何验证配置生效

### 5.1 一条命令（本仓库新增，零依赖）

```bash
node scripts/verify-domain.mjs ctrans.cn
```

它按六组逐项打勾：DNS（A/AAAA/CNAME 与「灰云还是橙云」）、HTTP（http→https、200、server、缓存头）、
TLS（签发者、到期、SAN、ALPN=h2）、页面（title/canonical/og:url/robots 是否都指向新域）、
子页（两个 `.html` 是否 200 且体积正常）、404 兜底。有 ✗ 时退出码为 1。

期望输出（关键几行）：

```
[① DNS 解析]
  · 裸域 ctrans.cn：A=104.21.x.x, 172.67.x.x …        → Cloudflare 代理（橙云）
  ✓ 裸域 ctrans.cn 有解析
[② HTTP 与跳转]
  ✓ http → https 跳转（301 → https://ctrans.cn/）
  · 200  3288 KB  首字节 180ms                        → 经 Cloudflare 边缘（橙云已生效）
  · server: cloudflare   cf-cache-status: HIT
[③ TLS 证书与 ALPN]
  · 主体 ctrans.cn  签发者 Google Trust Services  到期 2027-01-25（剩 90 天）
  ✓ SAN 覆盖 ctrans.cn      ✓ ALPN 协商到 HTTP/2（h2）
[④ 页面元信息]
  ✓ canonical 指向本站（https://ctrans.cn/）
[⑤ 子页]  ✓ marx-pictorial.html 200   ✓ pathflow.html 200
[⑥ 404 兜底] ✓ 返回 404 且是站内 404 页
结果：通过 N / 失败 0
```

> 未绑域时可以先跑现有地址做对照：
> `node scripts/verify-domain.mjs https://minaa1077.github.io/capital-dict/`
> 实测：通过 15 / 失败 0，server=`GitHub.com`、`cf-cache-status` 为空（说明确实没走 CF）。

### 5.2 手工命令（对照用）

```bash
nslookup ctrans.cn                 # 期望 104.x / 172.67.x（CF）或 185.199.1xx（灰云）
nslookup -type=CNAME www.ctrans.cn # 期望 minaa1077.github.io
curl -I  https://ctrans.cn/        # 期望 200、server: cloudflare、content-type: text/html
curl -I  http://ctrans.cn/         # 期望 301 到 https
curl -sI https://ctrans.cn/ | grep -i cf-cache-status   # 第二次访问应为 HIT
```

### 5.3 面板/真机核对

| 检查 | 期望 |
|---|---|
| GitHub → Settings → Pages | 顶部显示 `Your site is live at https://ctrans.cn/`，DNS check successful，Enforce HTTPS 已勾 |
| Cloudflare → SSL/TLS | Overview 显示 Full (strict)，Edge Certificates 里 Universal SSL 状态 Active |
| 手机 4G（关 Wi-Fi）打开 | 10 秒内出首屏；再刷一次明显更快（边缘缓存命中） |
| 微信内置浏览器 | 能正常打开（评审常用），无「非官方网页」拦截 |
| 旧地址 | `minaa1077.github.io/capital-dict/` 自动 301 到新域（GitHub 侧行为，不依赖 CF） |
| 站内功能 | 关系图、画传 iframe、阅读器、14 件工具都能用（子页同域，无跨源问题） |
| 回归 | `node scripts/smoke-test.mjs` 全绿（234 项） |

### 5.4 通过标准（建议写进验收）
- `verify-domain.mjs` 失败 0；
- 首屏 TTFB < 600 ms（CF 边缘命中后通常 100–300 ms）；
- 手机 4G 首次打开 < 10 s；
- 子页与 404 均 200/404 正确，无 5xx。

---

## 6. 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| Pages 报 *Domain's DNS record could not be verified* | 橙云还开着（GitHub 只看得到 CF 的 IP）；或 A 记录没生效；或 CNAME 带了路径 | 改灰云 → 等 5 分钟 → 重新 Save；`nslookup` 核对 |
| 打开 526 / Invalid SSL certificate | 已开橙云且 SSL=Full (strict)，但 GitHub 还没签出该域证书 | 先灰云，等 Certificate issued，再开橙云 |
| 无限重定向 / ERR_TOO_MANY_REDIRECTS | SSL 模式选了 **Flexible** | 改成 **Full (strict)** |
| 522 / 523 / 521 | 源站不可达：Pages 自定义域没保存成功，或 DNS 指错 | 回 S5 重新 Save；核对 A 记录 |
| 打开是旧版本 | CF 边缘缓存 + GitHub 自带 10 分钟 | Purge Everything，等 1–2 分钟 |
| `www` 与裸域内容不一致 / 不跳转 | 只配了一边 | 两边都指 Pages；主域设裸域；必要时加 Redirect Rule `www → apex 301` |
| 证书只有 3 个月且签发者是 Google Trust Services | 正常：这是 CF 的 Universal SSL，会自动续 | 无需处理；源站那张 GitHub 证书在后台自动续 |
| 内地打开仍慢/间歇失败 | CF 免费版内地线路波动 | 属已知限制；可加 Argo（付费）或接受现状；**不要**为了这点改用 Worker（更慢且需手拖） |
| `workers.dev` 打不开 | 已确认 DNS 污染 | 忽略；绑域后用自定义域访问，worker 地址不要写进材料 |

---

## 7. 限制与风险

1. **CF 免费版不保证内地质量**：通常比 `github.io` 稳，但晚高峰仍可能抖；这是免费 CDN 的固有代价。
2. **不备案的前提是服务器在境外**：GitHub Pages 与 CF 都在境外，因此不触发 ICP；若日后迁到境内节点必须备案。
3. **单文件 3.3 MB**：首次加载受带宽限制，务必开 Brotli + 边缘缓存；缓存规则不配等于白接。
4. **证书两条链**：CF 边缘证书（自动续）＋ GitHub 源站证书（自动续），任一环节改 DNS 都会触发重签，**别在投稿前一周改 NS**。
5. **域名到期**：到期未续会先停解析、后丢域名；建议一次买 3 年并开自动续费。

---

## 8. 分工：已经做完 / 还需要你做

**仓库侧（我已经做完，已提交）**
- `.github/workflows/pages.yml`：自定义域生效后自动带 `--domain`，CNAME 与 canonical 不再需要手工改；
- `scripts/verify-domain.mjs`：一条命令验收六组指标（本文 5.1）；
- 本文档。

**面板侧（需要你的账号，约 30 分钟）**
1. 买域名 + 实名（S1）；
2. Cloudflare 加站点、注册商改 NS（S2–S3）；
3. 建 9 条 DNS 记录，先灰云（S4）；
4. GitHub Pages 填域名（S5）→ 等证书 → 勾 Enforce HTTPS（S6）；
5. 开橙云 + 按 S7 表格设开关；
6. 建两条缓存规则（S8），此后每次发版 Purge 一次。

**可选：我代跑 DNS**
给我「域名 + Zone ID + 临时 API Token（仅 `Zone.DNS:Edit`）」，我用 Cloudflare API 一次建完 9 条记录并回读校验；
NS 与 GitHub 面板那两步仍需你操作。
