# Pubmed IF Tag

在 PubMed 搜索结果页和文章详情页自动标注期刊影响因子（IF）和 JCR 分区，开源、免费、纯本地运行。

🌐 **主页（国内可直接访问）**：<https://pubmed-if-tag.pages.dev/> —— 简介、功能、安装说明、常见问题与安装包下载都在上面。
📦 **上架 Edge 商店**：准备中，流程见 [EDGE-STORE.md](EDGE-STORE.md)。上架后可直接点「获取」安装，不再需要开发者模式，新版本自动推送。

## 功能

- **搜索结果页**：引用行的「期刊缩写 + 年份」按 IF 等级高亮，行末追加 `IF xx.x (Qx)` 徽章
- **文章详情页**：引用行末尾追加同样的徽章，不用来回切页面
- **点击徽章复制**：点一下就把「期刊全称 IF 14.7 (Q1)」复制到剪贴板，写综述时直接粘
- **更新期刊数据**：弹窗点一下从仓库拉取最新库并合并到本地，不用重装扩展；三个源自动回退
- **恢复内置库**：一键丢弃本地更新快照，回到安装包自带的数据
- **反馈缺失期刊（零输入）**：详情页遇到库里没有的期刊，会冒出一个虚线小问号；点一下就把刊名带进反馈页，IF 与分区由系统查表补，用户不用手打
- **二级设置页**：可关掉搜索页或详情页的标注、隐藏分区标签、改 IF 颜色阈值、切紧凑样式
- **手动检查新版本**：只有你点弹窗底部的版本号才会去查一次，不后台轮询、不弹窗打扰
- **颜色分级**：IF ≥ 20 红 / ≥ 10 橙 / ≥ 5 黄 / ≥ 2 绿 / 其他灰（阈值可在设置页改）
- **内置 13575 本期刊**（JCR 2025 + 中科院分区表 2025）：覆盖 PubMed / PMC 会出现的全部 SCIE 期刊，含神经科学、临床各科、肿瘤、免疫、药理、公共卫生等方向，另含 Nature、Science、Cell 等综合刊；标签同时给出 JCR 分区与中科院大类分区
- 兼容 PubMed React SPA（翻页、切换搜索不刷新页面也自动生效）

## 效果示意

```
Lancet. 2024                             IF 109.0 (Q1) · 中科院1区
Nat Commun. 2025 Nov 18;16(1):10094.     IF 18.1  (Q1) · 中科院1区
EMBO J. 2024 Sep;43(17):4121-4138.       IF 8.4   (Q1) · 中科院1区
Front Neurol. 2024;15:1234567.           IF 2.7   (Q2) · 中科院3区
```

## 安装

> 完整要求、常见问题见 **[安装使用说明](INSTALL.md)**；商店上架流程见 **[EDGE-STORE.md](EDGE-STORE.md)**。

### 方式一：商店安装（推荐，上架后可用）

上架后直接在商店页点「获取」，装完即用，无需开发者模式，后续版本自动更新。

### 方式二：开发者模式加载（当前可用）

1. 从 [Releases](https://github.com/lovest117/pubmed-if-tag/releases) 或 [主页](https://pubmed-if-tag.pages.dev/) 下载最新 zip
2. 解压到固定目录（**以后不要移动或删除这个目录**）
3. 打开 `edge://extensions/`（Chrome 用 `chrome://extensions/`）
4. 打开「开发人员模式」
5. 点「加载解压缩的扩展」，选到**能看到 manifest.json 的那一层**
6. 打开 PubMed，按 `Ctrl` + `F5` 强制刷新

### 为什么不建议装 crx

新版 Edge 会把非商店来源的 crx 判为「来自其他源」，扩展卡片出现警告、开关被锁定为关闭，插件不会运行。所以只把 crx 作为归档产物保留在 Release 里，实际安装用 zip 或商店。

> **别混用 crx 与 zip**：两者扩展 ID 不同，会变成两个独立插件，各自的期刊库数据不互通。

## 更新期刊数据

内置库会不断补充，不需要重装扩展：

1. 点工具栏插件图标
2. 点 **更新期刊数据**
3. 看到「更新成功：新增 X 种」后刷新 PubMed 页面

数据依次从 GitHub API、jsDelivr CDN、GitHub Raw 三个地址拉取，任一成功即可；结果存 `chrome.storage.local`，重启浏览器不丢。拉回来的库如果条数明显少于内置库（说明缓存返旧），会被条数校验拦下并提示，不会把库覆盖坏。

> 更新源固定指向 `https://github.com/lovest117/pubmed-if-tag` 的 `data/journal-if.js`。fork 后自行维护数据时，需同步改 `data/library.js` 的 `REMOTE_SOURCES`。

## 版本更新

**不做后台自检、不常驻提示。** 只有你主动点弹窗底部的版本号（`v1.0.9` 这行）时，才会查一次仓库的最新版本：

- 同版本 → 短暂显示「· 已是最新」
- 有新版本 → 版本号旁显示 `有新版本 vX.Y.Z →`，点进去到主页下载
- 查不到（网络受限）→ 显示「· 无法检查更新」，不影响使用

上架商店后这一步可以完全不用做，微软会自动推送新版本。

## 反馈

三种反馈方式，都不需要填一堆字段：

| 想要做什么 | 入口 | 操作 |
|---|---|---|
| 期刊没 IF 标签 | 插件弹窗「反馈与建议」→ 主页「期刊没标签」 | **只填刊名**，IF 与分区由系统查 JCR 表 |
| 功能建议 | 主页「功能建议」 | 一句话 |
| 报告问题 | 主页「报告问题」 | 一句话，截图在打开的 GitHub 页里拖进去 |

**自动入库**：任何人提交的「期刊未收录」Issue 都会触发 GitHub Actions，脚本从 Issue 里只取刊名，其余（IF、分区）一律查 `scripts/jcr_index.csv`，命中则写进 `data/journal-if.js`、提交、回复并关闭 Issue；查不到则打 `needs-review` 转人工。

> 用户填的 IF / 分区**不参与写库**，所以放开提交者限制也不会污染数据。
> 一本刊的 IF 与分区只有一个权威来源，这是这套自动化能放心交给陌生人的前提。

补充数据也可以直接改 `data/journal-if.js` 提 PR（格式见下）。

## 添加新期刊

```js
"期刊缩写小写": { if: 影响因子数值, q: "Q1", name: "期刊全称" },
```

示例：

```js
"nat commun": { if: 14.7, q: "Q1", name: "Nature Communications" },
"neuron":     { if: 12.1, q: "Q1", name: "Neuron" },
```

改完在扩展管理页点刷新即可生效。用户提交的手工条目回插件点「更新期刊数据」也能拿到。

## 文件结构

仓库根就是扩展目录，`manifest.json` 在最外层——「加载解压缩的扩展」直接选这个文件夹。

```
Pubmed-IF-Tag/
├── manifest.json          # 扩展配置（MV3，含 options_ui）
├── content.js             # 核心注入脚本（标注、问号反馈、按设置分派）
├── content.css            # 徽章与问号样式
├── popup.html             # 弹窗
├── popup.js               # 弹窗逻辑（含手动版本检查）
├── options.html           # 二级设置页
├── options.js             # 设置页逻辑（阈值校验与保存）
├── data/
│   ├── journal-if.js      # 内置期刊数据库（13575 条，含 IF / JCR 分区 / 中科院分区）
│   ├── library.js         # 库解析 / 合并 / 远程更新
│   └── settings.js        # 共享配置模块（默认值、归一化、变更订阅）
├── icons/                 # 图标 16 / 48 / 128
├── site/                  # 主页（Cloudflare Pages）
│   ├── index.html         # 简介、功能、安装、三 tab 反馈、权限隐私
│   └── download/          # 主页下载的最新 zip
├── scripts/
│   ├── release.ps1            # 一键打包 + 发版 + 部署
│   ├── build-journal-db.py    # 用 JCR 2025 + 中科院分区表 2025 + NLM 缩写表重建期刊库
│   ├── build-jcr-index.py     # 生成反馈入库用的 jcr_index.csv（4913 条）
│   ├── jcr_index.csv          # 刊名 → IF / 分区 查询表（脚本产物，随仓库提交）
│   └── add_journal_from_issue.py  # 从 Issue 取刊名 + 四级匹配 + 四态返回
├── .github/
│   ├── workflows/auto-add-journal.yml  # 任何人提交 → 查表入库 → 回复关单
│   └── ISSUE_TEMPLATE/    # 期刊未收录 / 功能建议 / 问题反馈
├── EDGE-STORE.md          # 上架 Edge 商店的完整步骤
├── INSTALL.md             # 安装与使用要求说明
└── dist/                  # 本地打包产物（已 gitignore）
```

## 期刊数据来源

内置库不是手工整理的，而是从三份权威数据生成，避免分批补录引入重复键：

| 数据 | 来源 | 用途 |
|---|---|---|
| JCR 2025（22,643 本，2026-06-17 发布） | [ShowJCR](https://github.com/hitfyd/ShowJCR) 发行包里的 `jcr.db`，表 `JCR2025` | 影响因子、JCR 分区（多学科取最好分区） |
| 中科院分区表 2025（21,772 本） | 同库表 `FQBJCR2025`（源自 advanced.fenqubiao.com） | 大类分区、Top 标记 |
| NLM 期刊表（4.7 万条） | [NCBI FTP: J_Medline.txt](https://ftp.ncbi.nlm.nih.gov/pubmed/J_Medline.txt) | PubMed 缩写（MedAbbr）与 ISSN，把 JCR 全称映射成引用行里的缩写 |

重建流程（原始文件约 20 MB，已 gitignore，下载方式写在脚本开头）：

```powershell
python scripts/build-journal-db.py --db scripts/jcr.db --medline scripts/J_Medline.txt
python scripts/build-jcr-index.py      # 生成 scripts/jcr_index.csv
```

口径：JCR 2025 全表中能在 NLM 表按 ISSN 查到 PubMed 缩写的期刊（即 PubMed 页面实际会出现的刊），共 13575 条；缩写键直接取 MedAbbr，与引用行完全一致。旧版库里的短别名（`ajcn`、`ccr` 这类）用刊名匹配继承，指向同一本刊。

`jcr_index.csv` 覆盖范围更宽（含 Q3/Q4，便于回复「不在收录范围」）以及库外期刊，用于 Issue 自动入库。JCR 与分区表版权分别归 Clarivate 和中科院文献情报中心，此处仅作个人查阅参考。

## 发版

改完代码后升 `manifest.json` 的 `version`，然后跑：

```powershell
.\scripts\release.ps1
```

它会：用干净副本打包 → 生成 `dist/Pubmed-IF-Tag-v{版本}.crx` 与 `site/download/Pubmed-IF-Tag-v{版本}.zip` → 校验 crx 内容与包内文件清单 → 提交推送 → 建 GitHub Release 并上传资产 → 部署主页。加 `-SkipDeploy` 可跳过 Cloudflare 那一步。

## 主页部署

线上地址 <https://pubmed-if-tag.pages.dev/>，源码在 `site/`。只改站点不想发新版时：

```powershell
$env:NODE_EXTRA_CA_CERTS="$env:TEMP\win-ca.pem"
npx --yes wrangler@4 pages deploy site --project-name=pubmed-if-tag --branch=main --commit-dirty=true
```

## License

[MIT](LICENSE)
