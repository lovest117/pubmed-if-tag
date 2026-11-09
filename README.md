# Pubmed IF Tag

在 PubMed 搜索结果页和文章详情页自动显示期刊影响因子（IF）和 JCR 分区，作为付费插件 ScholarScope 的免费开源替代。

🌐 **主页（国内可直接访问，不用翻墙）**：<https://pubmed-if-tag.pages.dev/> —— 简介、功能范围、安装说明、常见问题与安装包下载都在上面。

## 功能

- **搜索结果页**：期刊名+年份按IF等级高亮，文献末尾自动标注 `IF xx.x (Qx)`
- **文章详情页**：在期刊引用行后显示 IF 标签
- **一键更新 IF 库**：点插件图标，弹窗里点「一键更新 IF 库」，即可从本仓库拉取最新期刊数据，补上缺失期刊，无需重新安装插件
- **反馈缺失期刊**：弹窗里点「反馈缺失期刊」，自动生成预填模板，填上期刊名、IF、分区提交即可补录
- **手动更新入口**：弹窗里「打开 GitHub（手动更新）」直达仓库，网络受限时可自行查看最新数据
- **颜色分级**：IF≥20 红色 / ≥10 橙色 / ≥5 黄色 / ≥2 绿色 / 其他灰色
- **内置 3374 本期刊**（JCR 2023 数据）：医学与生命科学类 Q1–Q2 期刊全收录，含神经科学、临床各科、肿瘤、免疫、药理、公共卫生等方向，另含 Nature、Science、Cell 等综合类顶刊
- 兼容 PubMed React SPA（翻页、切换搜索不刷新页面自动生效）

## 效果示意

```
Nat Commun. 2025 Nov 18;16(1):10094.    IF 14.7 (Q1)
Neuron. 2023 Oct 4;111(19):3124-3138.   IF 14.7 (Q1)
Front Neurol. 2024;15:1234567.           IF 2.7 (Q2)
```

## 安装方法

> 更详细的安装要求、使用条件与常见问题，见 **[安装使用说明](INSTALL.md)**。

### 方式一：开发者模式加载（推荐）

1. 下载本仓库 ZIP 并解压
2. 浏览器地址栏输入 `edge://extensions/` 或 `chrome://extensions/`
3. 打开右上角 **开发者模式**
4. 点击 **加载已解压的扩展程序**，选择解压后的文件夹
5. 打开 [PubMed](https://pubmed.ncbi.nlm.nih.gov/) 搜索文献即可

### 方式二：CRX 文件安装（Edge 上不可用）

1. 从 [Releases](https://github.com/lovest117/pubmed-if-tag/releases) 下载最新 `.crx` 文件
2. 拖入 `edge://extensions/` 页面

**注意**：新版 Edge 会把它判定为「来自其他源」，扩展卡片出现警告且**开关被锁定为关闭、无法启用**，插件不会运行。此时请改用方式一。

## 更新期刊库

插件自带一份离线数据库，期刊会不断被补充。不需要重新安装插件，在弹窗里就能更新：

1. 点浏览器工具栏的插件图标
2. 点 **一键更新 IF 库**
3. 看到「更新成功：新增 X 种」后，刷新 PubMed 页面即可看到新期刊的标签

数据会依次从 GitHub API、jsDelivr CDN、GitHub Raw 三个地址拉取，任一成功即可；更新结果保存在本地，重启浏览器不丢失。点「恢复内置库」可丢弃更新内容，回到安装包自带的数据。

> 更新源固定指向 `https://github.com/lovest117/pubmed-if-tag` 的 `data/journal-if.js`。如果 fork 后自行维护数据，需同步修改 `data/library.js` 里的 `REMOTE_SOURCES` 地址。

## 数据来源

- 影响因子：Clarivate Journal Citation Reports (JCR) 2023（2024年6月发布）
- 分区：JCR 分区（Q1-Q4）
- 仅供个人学习参考，请勿用于商业用途

## 反馈与贡献

遇到以下问题请提交 [Issue](https://github.com/lovest117/pubmed-if-tag/issues/new)：

- 某本期刊不显示 IF
- 页面显示错乱
- 建议新功能

最快的方式是点插件图标 →「**反馈缺失期刊**」，会自动生成填好的模板；也可以直接在下面的「添加新期刊」里改数据提 PR。

**提交后会自动入库**：仓库的 GitHub Actions 会解析 Issue 里的四个字段，把期刊写进 `data/journal-if.js` 并提交、关闭 Issue，不需要等人工处理。之后在插件弹窗点一次「一键更新 IF 库」就能拿到这条数据。

提交时请附上：
- 文章链接（PMID）
- F12 控制台中 `[Pubmed IF Tag]` 开头的日志截图

## 添加新期刊

编辑 `data/journal-if.js`，按以下格式添加：

```js
"期刊缩写小写": { if: 影响因子数值, q: "Q1-Q4", name: "期刊全称" },
```

示例：

```js
"nat commun": { if: 14.7, q: "Q1", name: "Nature Communications" },
"neuron": { if: 12.1, q: "Q1", name: "Neuron" },
```

添加后在扩展管理页点击刷新按钮即可生效。

## 文件结构

仓库根就是扩展目录，`manifest.json` 在最外层——Edge/Chrome 的「加载解压缩的扩展」直接选这个文件夹。

```
Pubmed-IF-Tag/
├── manifest.json          # 扩展配置 (Manifest V3)
├── content.js             # 核心注入脚本（含徽章点击复制）
├── content.css            # 样式
├── popup.html             # 点击图标弹出的设置页
├── popup.js               # 弹窗逻辑（MV3 禁止内联脚本，必须独立文件）
├── data/
│   ├── journal-if.js      # 内置期刊 IF 数据库
│   └── library.js         # 期刊库解析/合并/远程更新逻辑
├── icons/                 # 扩展图标 (16/48/128)
├── site/                  # 插件主页（Cloudflare Pages）
│   ├── index.html
│   └── download/          # 主页下载的最新安装包
├── scripts/
│   ├── release.ps1        # 一键打包 + 发版 + 部署
│   ├── build-journal-db.py    # 用 JCR 2023 全表 + NLM 缩写表重建期刊库
│   └── add_journal_from_issue.py
├── .github/
│   ├── workflows/         # Issue → 自动补录期刊
│   └── ISSUE_TEMPLATE/    # 期刊反馈 / 建议 / 问题 三张表单
└── dist/                  # 本地打包产物（已 gitignore）
```

`scripts/add_journal_from_issue.py` 与 `.github/workflows/auto-add-journal.yml` 负责把「反馈缺失期刊」的 Issue 自动补录进数据库。

## 期刊数据来源

内置库不是手工整理的，而是从两份权威数据生成，避免分批补录引入重复键：

| 数据 | 来源 | 用途 |
|---|---|---|
| 2023 JCR 全表（21,848 本） | [vallenderlab/journalanalysis](https://github.com/vallenderlab/journalanalysis) 的 `data/jcr_2023_wos.csv` | 影响因子、JIF 分区、学科类别 |
| NLM 期刊表（4.7 万条） | [NCBI FTP: J_Medline.txt](https://ftp.ncbi.nlm.nih.gov/pubmed/J_Medline.txt) | PubMed 缩写（MedAbbr）与 ISSN，用于把 JCR 全称映射成引用行里的缩写 |

重建流程（原始文件约 12 MB，已 gitignore，下载命令写在脚本开头）：

```powershell
python scripts/build-journal-db.py
```

口径：医学与生命科学类学科中 JCR 分区为 Q1/Q2 的期刊，且必须能在 NLM 表里查到 PubMed 缩写；同一本刊属多个学科时取最好分区。JCR 数据版权归 Clarivate，此处仅作个人查阅参考。

## 发版

改完代码后升 `manifest.json` 的 `version`，然后跑：

```powershell
.\scripts\release.ps1
```

它会：用干净副本打包 → 生成带版本号的 `dist/Pubmed-IF-Tag-v{版本}.crx` 与 `site/download/Pubmed-IF-Tag-v{版本}.zip` → 校验 crx 内容 → 提交推送 → 建 GitHub Release 并上传两个资产 → 部署主页。加 `-SkipDeploy` 可跳过 Cloudflare 那一步。

## 主页部署

线上地址 <https://pubmed-if-tag.pages.dev/>，站点源码在 `site/`。只改站点不想发新版时执行：

```bash
npx wrangler@4 pages deploy site --project-name=pubmed-if-tag --branch=main
```

## License

[MIT](LICENSE)
