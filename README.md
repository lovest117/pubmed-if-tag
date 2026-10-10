# Pubmed IF Tag

在 PubMed 搜索结果页和文章详情页自动显示期刊影响因子（IF）和 JCR 分区，作为付费插件 ScholarScope 的免费开源替代。

## 功能

- **搜索结果页**：期刊名+年份按IF等级高亮，文献末尾自动标注 `IF xx.x (Qx)`
- **文章详情页**：在期刊引用行后显示 IF 标签
- **颜色分级**：IF≥20 红色 / ≥10 橙色 / ≥5 黄色 / ≥2 绿色 / 其他灰色
- **内置 595+ 本生物医学期刊**（JCR 2023 数据，覆盖神经科学、临床医学、药学等主流方向）
- 兼容 PubMed React SPA（翻页、切换搜索不刷新页面自动生效）

## 效果示意

```
Nat Commun. 2025 Nov 18;16(1):10094.    IF 14.7 (Q1)
Neuron. 2023 Oct 4;111(19):3124-3138.   IF 12.1 (Q1)
Front Neurol. 2024;15:1234567.           IF 3.3 (Q2)
```

## 安装方法

### 方式一：开发者模式加载（推荐）

1. 下载本仓库 ZIP 并解压
2. 浏览器地址栏输入 `edge://extensions/` 或 `chrome://extensions/`
3. 打开右上角 **开发者模式**
4. 点击 **加载已解压的扩展程序**，选择解压后的文件夹
5. 打开 [PubMed](https://pubmed.ncbi.nlm.nih.gov/) 搜索文献即可

### 方式二：CRX 文件安装

1. 从 [Releases](https://github.com/lovest117/pubmed-if-tag/releases) 下载最新 `.crx` 文件
2. 拖入 `edge://extensions/` 页面
3. 如浏览器拦截，请使用方式一

## 数据来源

- 影响因子：Clarivate Journal Citation Reports (JCR) 2023（2024年6月发布）
- 分区：JCR 分区（Q1-Q4）
- 仅供个人学习参考，请勿用于商业用途

## 反馈与贡献

遇到以下问题请提交 [Issue](https://github.com/lovest117/pubmed-if-tag/issues/new)：

- 某本期刊不显示 IF
- 页面显示错乱
- 建议新功能

提交时请附上：
- 文章链接（PMID）
- F12 控制台中 `[PubMed IF Helper]` 开头的日志截图

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

```
Pubmed-IF-Tag/
├── manifest.json          # 扩展配置 (Manifest V3)
├── content.js             # 核心注入脚本
├── content.css            # 样式
├── popup.html             # 点击图标弹出的设置页
├── data/
│   └── journal-if.js       # 内置期刊 IF 数据库
└── icons/                 # 扩展图标 (16/48/128)
```

## License

[MIT](LICENSE)
