/**
 * PubMed IF Helper - 内容脚本
 * 在PubMed搜索结果页和文章详情页自动显示期刊影响因子
 */

(function () {
  'use strict';

  const DB = window.JOURNAL_IF_DB || {};
  const RUNTIME = {
    processed: new WeakSet(),
    observer: null,
  };

  // ========== 工具函数 ==========

  /**
   * 从引用文本中提取期刊缩写
   * 例: "J Pediatr Endocrinol Metab. 2022 Feb 11;35(4):421-434." -> "J Pediatr Endocrinol Metab"
   */
  function extractJournalAbbreviation(citationText) {
    if (!citationText) return null;
    const text = citationText.trim();
    // 找到第一个 ". " (期刊名后通常是 ". 年份" 或 ". 年")
    // 但要注意期刊名本身可能含点（如 "JAMA."），我们取到第一个 ". " 后面跟数字或月份的位置
    const match = text.match(/^([^.]+(?:\.[^.]*)*?)\.\s+(?:\d{4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))/);
    if (match) {
      return match[1].trim();
    }
    // 退化方案：取第一个 ". " 之前
    const firstDot = text.indexOf('. ');
    if (firstDot > 0) {
      return text.substring(0, firstDot).trim();
    }
    return null;
  }

  /**
   * 清理期刊名：去掉前导符号、括号后缀等
   * "Adv Sci (Weinh)" -> "adv sci"
   * "> Nat Commun" -> "nat commun"
   */
  function normalizeJournalName(raw) {
    let s = raw.toLowerCase().trim();
    // 去掉前导非字母字符（如 >、·、• 等）
    s = s.replace(/^[^a-z]+/, '');
    // 去掉括号后缀，如 (Weinh)、(Lausanne)、(N Y) 等
    s = s.replace(/\s*\([^)]*\)\s*$/g, '');
    // 去掉末尾的点
    s = s.replace(/\.+$/, '');
    return s.trim();
  }

  /**
   * 查询IF数据库，支持多种匹配方式
   */
  function lookupIF(journalAbbr) {
    if (!journalAbbr) return null;
    let key = normalizeJournalName(journalAbbr);

    // 精确匹配
    if (DB[key]) return DB[key];

    // 尝试去掉 "The " 前缀
    if (key.startsWith('the ')) {
      const noThe = key.substring(4);
      if (DB[noThe]) return DB[noThe];
    }

    // 有限模糊匹配
    for (const dbKey in DB) {
      if (dbKey === key) return DB[dbKey];
      const shorter = Math.min(key.length, dbKey.length);
      const longer = Math.max(key.length, dbKey.length);
      if (shorter >= 6 && shorter >= longer * 0.7) {
        if (key.startsWith(dbKey) || dbKey.startsWith(key)) {
          return DB[dbKey];
        }
      }
    }
    return null;
  }

  /**
   * 根据IF值返回颜色和标签
   */
  function getIFColors(ifValue) {
    let color = '#94a3b8'; // 文字色
    let bg = '#f1f5f9';    // 浅底色（用于高亮和badge背景）
    let hl = '#f8fafc';    // 高亮背景（更淡一点）
    if (ifValue >= 20) { color = '#b91c1c'; bg = '#fef2f2'; hl = '#fee2e2'; }
    else if (ifValue >= 10) { color = '#c2410c'; bg = '#fff7ed'; hl = '#ffedd5'; }
    else if (ifValue >= 5) { color = '#b45309'; bg = '#fffbeb'; hl = '#fef3c7'; }
    else if (ifValue >= 2) { color = '#15803d'; bg = '#f0fdf4'; hl = '#dcfce7'; }
    else if (ifValue > 0) { color = '#64748b'; bg = '#f8fafc'; hl = '#f1f5f9'; }
    return { color, bg, hl };
  }

  /**
   * 创建IF badge元素
   */
  function createIFBadge(ifInfo) {
    const badge = document.createElement('span');
    badge.className = 'pifh-if-badge';
    badge.dataset.pifhBadge = 'true';
    const { color, bg } = getIFColors(ifInfo.if);
    const qLabel = ifInfo.q ? ` <span style="opacity:0.7">(${ifInfo.q})</span>` : '';
    badge.innerHTML = `IF <strong>${ifInfo.if}</strong>${qLabel}`;
    badge.style.cssText = `
      display: inline-block;
      margin-left: 6px;
      padding: 1px 7px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 500;
      color: ${color};
      background: ${bg};
      border: 1px solid ${color}33;
      vertical-align: middle;
      cursor: default;
      white-space: nowrap;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;
    badge.title = `${ifInfo.name} | JCR ${ifInfo.q}区 | IF ${ifInfo.if}`;
    return badge;
  }

  /**
   * 从引用全文中切出"期刊名+年份"部分（用于高亮）
   * 例: "J Pediatr Endocrinol Metab. 2022 Feb 11;35(4):421-434." ->
   *     highlight = "J Pediatr Endocrinol Metab. 2022"
   */
  function splitCitationForHighlight(fullText) {
    const text = fullText.trim();
    // 只匹配 期刊名. 年份（不包含月份和日期）
    const m = text.match(/^(.+?\.\s+(?:19|20)\d{2})/);
    if (m) {
      return { highlight: m[1], rest: text.substring(m[1].length) };
    }
    return null;
  }

  /**
   * 把引用元素里的"期刊名+年份"部分高亮
   * 通过重建元素内容实现，保留badge
   */
  function highlightCitation(el, ifInfo) {
    const fullText = el.textContent || '';
    const parts = splitCitationForHighlight(fullText);
    if (!parts) return false;

    const { hl, color } = getIFColors(ifInfo.if);

    // 检查是否已经高亮过
    if (el.querySelector('[data-pifh-hl]')) return true;

    // 保存badge（如果已有）
    const existingBadge = el.querySelector('[data-pifh-badge]');

    // 清空元素，重建
    el.innerHTML = '';

    // 高亮部分：期刊名 + 年份
    const hlSpan = document.createElement('span');
    hlSpan.dataset.pifhHl = 'true';
    hlSpan.textContent = parts.highlight;
    hlSpan.style.cssText = `
      background: ${hl};
      color: ${color};
      font-weight: 600;
      border-radius: 3px;
      padding: 0 3px;
      margin: 0 -2px;
    `;
    el.appendChild(hlSpan);

    // 剩余部分（月份、卷期、页码、doi等）保持原样
    if (parts.rest) {
      const restNode = document.createTextNode(parts.rest);
      el.appendChild(restNode);
    }

    // 追加badge
    el.appendChild(existingBadge || createIFBadge(ifInfo));
    return true;
  }

  // ========== 核心处理逻辑 ==========

  /**
   * 处理单个期刊引用元素，添加IF badge和高亮
   */
  function processCitationElement(el) {
    if (RUNTIME.processed.has(el)) return;
    RUNTIME.processed.add(el);

    const text = el.textContent || '';
    const journalAbbr = extractJournalAbbreviation(text);
    if (!journalAbbr) return;

    const ifInfo = lookupIF(journalAbbr);
    if (!ifInfo) return;

    // 高亮期刊名+年份，并追加badge
    highlightCitation(el, ifInfo);
  }

  /**
   * 在搜索结果页处理所有结果
   */
  function processSearchResultsPage() {
    // PubMed新版选择器（按优先级尝试）
    const selectors = [
      '.docsum-journal-citation',
      '.docsum-content .secondary',
      '.search-results-item .docsum',
      '[class*="journal-citation"]',
      '[class*="DocsumCitation"]',
      '.full-view .docsum',
    ];

    let found = false;
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        els.forEach(processCitationElement);
        found = true;
      }
    }

    // 如果上面都没匹配到，用更宽松的方式：找包含期刊引用特征的元素
    if (!found) {
      // 找所有包含 ". 20" 或 ". Jan" 这种引用模式的小元素
      const allSmallEls = document.querySelectorAll('.docsum, .search-results-item, article');
      allSmallEls.forEach(container => {
        // 在容器内找看起来像期刊引用的文本节点
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
        let node;
        while ((node = walker.nextNode())) {
          const t = node.textContent.trim();
          if (/^[A-Z][a-z]+(?:\s+[A-Za-z]+)*\.\s+(19|20)\d{2}/.test(t) ||
              /^[A-Z]\.\s+(19|20)\d{2}/.test(t)) {
            const parent = node.parentElement;
            if (parent && !RUNTIME.processed.has(parent)) {
              processCitationElement(parent);
            }
          }
        }
      });
    }
  }

  /**
   * 处理文章详情页
   * DOM结构：div.short-citation > span.date > time.citation-year
   * 期刊名 "Nat Commun" 是纯文本（不是<a>链接），在short-citation内
   */
  function processArticleDetailPage() {
    // 直接找 short-citation 容器
    const citations = document.querySelectorAll('.short-citation, .article-source');
    console.log('[PubMed IF Helper][详情页] 找到', citations.length, '个引用容器');

    citations.forEach(citEl => {
      if (citEl.querySelector('[data-pifh-badge]')) return;

      // 在引用容器内用TreeWalker找文本节点
      const walker = document.createTreeWalker(citEl, NodeFilter.SHOW_TEXT, null);
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent.trim();
        if (!text || text.length < 3 || text.length > 80) continue;
        if (text.split(' ').length > 8) continue;

        // 去掉末尾的点
        const cleanText = text.replace(/\.+$/, '').trim();
        const ifInfo = lookupIF(cleanText);
        if (!ifInfo) continue;

        console.log('[PubMed IF Helper][详情页] 在short-citation找到期刊:', cleanText, 'IF=' + ifInfo.if);

        const { hl, color } = getIFColors(ifInfo.if);

        // 高亮这个文本节点的父元素
        const parent = node.parentElement;
        if (parent && parent.tagName !== 'A') {
          parent.style.backgroundColor = hl;
          parent.style.color = color;
          parent.style.fontWeight = '600';
          parent.style.borderRadius = '3px';
          parent.style.padding = '0 3px';
        }

        // 在文本节点后插入badge
        const badge = createIFBadge(ifInfo);
        badge.style.marginLeft = '4px';
        node.parentNode.insertBefore(badge, node.nextSibling);
        break; // 每个引用容器只处理第一个匹配
      }
    });

    // 兜底：如果short-citation方式没找到，直接扫描页面文本
    if (!document.querySelector('[data-pifh-badge]')) {
      console.log('[PubMed IF Helper][详情页] short-citation未找到，扫描全页文本节点');
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent.trim();
        if (!text || text.length < 3 || text.length > 80) continue;
        if (text.split(' ').length > 8) continue;
        // 跳过在docsum（相关文章）里的
        if (node.parentElement && node.parentElement.closest('.docsum')) continue;

        const cleanText = text.replace(/\.+$/, '').trim();
        const ifInfo = lookupIF(cleanText);
        if (!ifInfo) continue;

        // 确认附近有年份
        const parent = node.parentElement;
        const sibText = parent ? parent.textContent : '';
        if (!/(19|20)\d{2}/.test(sibText)) continue;

        console.log('[PubMed IF Helper][详情页] 全页扫描找到期刊:', cleanText, 'IF=' + ifInfo.if);
        const { hl, color } = getIFColors(ifInfo.if);
        if (parent && parent.tagName !== 'A') {
          parent.style.backgroundColor = hl;
          parent.style.color = color;
          parent.style.fontWeight = '600';
          parent.style.borderRadius = '3px';
          parent.style.padding = '0 3px';
        }
        const badge = createIFBadge(ifInfo);
        badge.style.marginLeft = '4px';
        node.parentNode.insertBefore(badge, node.nextSibling);
        break;
      }
    }
  }

  /**
   * 判断当前页面类型并处理
   */
  function processPage() {
    const url = window.location.href;
    console.log('[PubMed IF Helper] processPage, URL:', url);
    if (url.includes('/?') || url.match(/pubmed\.ncbi\.nlm\.nih\.gov\/$/)) {
      console.log('[PubMed IF Helper] 判断为搜索结果页');
      processSearchResultsPage();
    } else if (url.match(/\/\d+\/$/)) {
      console.log('[PubMed IF Helper] 判断为文章详情页');
      processArticleDetailPage();
    } else {
      console.log('[PubMed IF Helper] URL类型不明确，两个都试');
      processSearchResultsPage();
      processArticleDetailPage();
    }
  }

  // ========== MutationObserver 监听动态加载 ==========

  function setupObserver() {
    if (RUNTIME.observer) RUNTIME.observer.disconnect();

    RUNTIME.observer = new MutationObserver((mutations) => {
      let needsProcess = false;
      for (const m of mutations) {
        if (m.addedNodes.length > 0) {
          needsProcess = true;
          break;
        }
      }
      if (needsProcess) {
        // 防抖
        clearTimeout(RUNTIME._t);
        RUNTIME._t = setTimeout(() => {
          processPage();
        }, 300);
      }
    });

    RUNTIME.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // ========== 初始化 ==========

  function init() {
    // 等DOM加载完成
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        processPage();
        setupObserver();
      });
    } else {
      processPage();
      setupObserver();
    }

    // 延迟重试：PubMed React应用可能异步加载内容
    setTimeout(() => processPage(), 1000);
    setTimeout(() => processPage(), 2500);

    // 监听URL变化（PubMed是SPA风格，翻页/搜索不刷新页面）
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(() => processPage(), 500);
        setTimeout(() => processPage(), 1500);
      }
    }, 1000);

    console.log('[PubMed IF Helper] 已加载，内置期刊数: ' + Object.keys(DB).length);
  }

  init();
})();
