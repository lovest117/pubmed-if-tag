# Edge 商店列表材料（Pubmed IF Tag v1.3.0）

## 基本字段
- **Extension name（扩展名称）**：Pubmed IF Tag（取自 manifest，只读）
- **Short description（简短说明，取自 manifest，只读）**：在PubMed搜索结果和文章页自动标注期刊影响因子（IF）、JCR分区与中科院分区
- **Category（分类）**：Productivity（生产力）
- **Privacy question（是否收集个人信息）**：选「是」（稳妥，因有 host_permissions 与 storage）
- **Privacy policy URL（隐私政策 URL）**：https://pubmed-if-tag.pages.dev/#privacy
- **Website URL（网站，可选）**：https://pubmed-if-tag.pages.dev/
- **Support contact（支持联系人，可选）**：https://pubmed-if-tag.pages.dev/#feedback
- **Visibility（可见性）**：Public（公开）
- **Markets（市场）**：全部市场（默认 241 个）

## Search terms（搜索词，最多 7 个）
1. pubmed
2. impact factor
3. journal
4. citation
5. JCR
6. research
7. literature

---

## Description（英文详细描述，en-US，≥250 字符）

Pubmed IF Tag automatically tags journal Impact Factors (IF), JCR quartiles, and CAS (Chinese Academy of Sciences) partitions right on PubMed and PMC search results and article pages, so you can screen literature at a glance without leaving the page.

Key features:

- Automatic badges on PubMed and PMC: every citation line gets a color-coded "IF xx.x (Qx)" badge together with the CAS major partition.
- Color grading by IF level: dark green (20 or above), green (10 or above), wheat (5 or above), terracotta (3 or above), and muted plum below 3; thresholds are adjustable.
- One-click copy: click any badge to copy the full journal name with its IF and quartile to the clipboard, ready to paste when writing reviews.
- Filter bar: narrow results by IF range, JCR quartile (Q1-Q4), or CAS partition (1-4, Top), then export the filtered list to CSV.
- Hover card: hover over a badge to see the full journal name, exact IF, JCR quartile, CAS partition, and data version.
- Built-in database of 13,575 journals from JCR 2025 and the CAS Journal Partition Table 2025, covering the SCIE journals that appear on PubMed, including neuroscience, clinical medicine, oncology, immunology, pharmacology, and public health, plus general journals such as Nature, Science, and Cell.
- Update the journal database on demand from three fallback sources (GitHub API, jsDelivr CDN, GitHub Raw), or restore the built-in library with one click; no reinstall required.
- Options page: toggle annotations, hide partition labels, change color thresholds, or switch to compact mode.
- Local and private: no tabs, history, webRequest, or cookies permissions; no analytics, ads, or usage tracking; data is stored only on your device and cleared on uninstall.
- Compatible with the PubMed React SPA: annotations apply automatically across pagination and search changes without reloading.

Free and open source under the MIT license. Intended for quick literature screening; please rely on official sources for formal decisions.

---

## 详细描述（中文，zh-CN）

Pubmed IF Tag 在 PubMed 和 PMC 的搜索结果页、文章详情页自动标注期刊影响因子（IF）、JCR 分区与中科院分区，让你不用离开页面就能快速筛选文献。

主要功能：

- 自动徽章：PubMed / PMC 每条引用行末尾追加按 IF 等级着色的「IF xx.x (Qx)」徽章，并同时给出中科院大类分区。
- 颜色分级：IF≥20 深墨绿、≥10 中绿、≥5 柔麦黄、≥3 暖陶橙、低于 3 暗紫褐，阈值可自行调整。
- 点击复制：点一下徽章即可把「期刊全称 + IF + 分区」复制到剪贴板，写综述直接粘贴。
- 筛选条：可按 IF 区间、JCR 分区（Q1–Q4）、中科院分区（1–4 区、Top）筛选，并把筛选结果导出为 CSV。
- 悬停卡片：鼠标悬停徽章可查看期刊全称、精确 IF、JCR 分区、中科院分区与数据版本。
- 内置 13575 本期刊，数据来自 JCR 2025 与中科院期刊分区表 2025，覆盖 PubMed 出现的 SCIE 期刊，含神经科学、临床各科、肿瘤、免疫、药理、公共卫生及 Nature、Science、Cell 等综合刊。
- 按需更新期刊库：三个数据源（GitHub API、jsDelivr CDN、GitHub Raw）自动回退，也可一键恢复内置库，无需重装。
- 二级设置页：可开关标注、隐藏分区标签、调整颜色阈值、切换紧凑样式。
- 本地且注重隐私：不申请 tabs、history、webRequest、cookies 权限，无统计、广告或追踪，数据仅存本机，卸载即清除。
- 兼容 PubMed React 单页应用：翻页、切换搜索不刷新页面也能自动生效。

免费、开源（MIT）。仅用于快速文献筛选，正式场合请以官方数据为准。
