# Pubmed IF Tag

在 PubMed 搜索结果页和文章详情页自动显示期刊影响因子（IF）和 JCR 分区，作为付费插件 ScholarScope 的免费替代。

## 功能

- 搜索结果页：期刊名+年份高亮，自动标注 `IF xx.x (Qx)`
- 文章详情页：在引用行后显示 IF 标签
- 颜色分级：IF≥20 红色 / ≥10 橙色 / ≥5 黄色 / ≥2 绿色 / 其他灰色
- 内置 595+ 本生物医学期刊数据（JCR 2023）

## 安装方法（开发者模式）

1. 下载本仓库 ZIP 并解压
2. 浏览器打开 `edge://extensions/` 或 `chrome://extensions/`
3. 打开右上角"开发者模式"
4. 点击"加载已解压的扩展程序"，选择解压后的文件夹
5. 打开 [PubMed](https://pubmed.ncbi.nlm.nih.gov/) 搜索文献即可

## 数据来源

- 影响因子数据：Clarivate Journal Citation Reports (JCR) 2023（2024年6月发布）
- 仅供个人学习参考，请勿用于商业用途

## 反馈问题

遇到某本期刊不显示 IF、或页面显示异常，请提交 Issue，附上：
- 文章链接（PMID）
- F12 控制台中 `[PubMed IF Helper]` 开头的日志截图

## 文件结构

```
pubmed-if-helper/
├── manifest.json          # 扩展配置 (MV3)
├── content.js             # 核心注入脚本
├── content.css             # 样式
├── popup.html             # 点击图标弹出的设置页
├── data/
│   └── journal-if.js       # 内置期刊IF数据库
└── icons/                 # 扩展图标
```

## 更新IF数据

编辑 `data/journal-if.js`，按以下格式添加期刊：

```js
"期刊缩写小写": { if: 影响因子数值, q: "Q1-Q4", name: "期刊全称" },
```

添加后在扩展管理页点击刷新按钮即可。

## License

MIT
