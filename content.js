/**
 * Pubmed IF Tag - 内容脚本
 * 在PubMed搜索结果页和文章详情页自动显示期刊影响因子
 */

(function () {
  'use strict';

  // 当前生效的期刊库；启动时会用本地存储里的更新数据覆盖内置库
  let DB = window.JOURNAL_IF_DB || {};
  // 用户设置，启动时从 storage 读取；未读到则用默认值
  let SETTINGS = null;
  const REPO = 'lovest117/pubmed-if-tag';
  const RUNTIME = {
    processed: new WeakSet(),
    observer: null,
  };

  const FALLBACK_SETTINGS = {
    showSearch: true,
    showDetail: true,
    showQuartile: true,
    compact: false,
    hintMissing: true,
    thresholds: [20, 10, 5, 2],
  };

  function cfg() {
    return SETTINGS || FALLBACK_SETTINGS;
  }

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
   * 清理期刊名：去掉前导符号、括号后缀、缩写分隔点等
   * "Adv Sci (Weinh)" -> "adv sci"
   * "> Nat Commun" -> "nat commun"
   * "J. Neurosci." -> "j neurosci"
   */
  function normalizeJournalName(raw) {
    let s = raw.toLowerCase().trim();
    // 去掉前导非字母字符（如 >、·、• 等）
    s = s.replace(/^[^a-z]+/, '');
    // 去掉括号后缀，如 (Weinh)、(Lausanne)、(Baltimore) 等
    s = s.replace(/\s*\([^)]*\)\s*$/g, '');
    // 去掉缩写中点（ISO 缩写常用，如 "J. Neurosci." -> "j neurosci"）
    s = s.replace(/\./g, '');
    // 压缩多余空白
    s = s.replace(/\s+/g, ' ');
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
   * 根据IF值返回颜色和标签；阈值可在设置页调整
   */
  function getIFColors(ifValue) {
    const t = cfg().thresholds;
    let color = '#94a3b8'; // 文字色
    let bg = '#f1f5f9';    // 浅底色（用于高亮和badge背景）
    let hl = '#f8fafc';    // 高亮背景（更淡一点）
    if (ifValue >= t[0]) { color = '#b91c1c'; bg = '#fef2f2'; hl = '#fee2e2'; }
    else if (ifValue >= t[1]) { color = '#c2410c'; bg = '#fff7ed'; hl = '#ffedd5'; }
    else if (ifValue >= t[2]) { color = '#b45309'; bg = '#fffbeb'; hl = '#fef3c7'; }
    else if (ifValue >= t[3]) { color = '#15803d'; bg = '#f0fdf4'; hl = '#dcfce7'; }
    else if (ifValue > 0) { color = '#64748b'; bg = '#f8fafc'; hl = '#f1f5f9'; }
    return { color, bg, hl };
  }

  /**
   * 复制文本到剪贴板；优先用异步 API，失败回退到临时 textarea
   */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy') ? resolve() : reject(new Error('execCommand 返回 false'));
      } catch (e) {
        reject(e);
      } finally {
        document.body.removeChild(ta);
      }
    });
  }

  /**
   * 创建IF badge元素
   */
  function createIFBadge(ifInfo) {
    const badge = document.createElement('span');
    badge.className = 'pifh-if-badge';
    badge.dataset.pifhBadge = 'true';
    const { color, bg } = getIFColors(ifInfo.if);
    const compact = !!cfg().compact;
    const qLabel = (cfg().showQuartile && ifInfo.q)
      ? ` <span style="opacity:0.7">(${ifInfo.q})</span>` : '';
    // 中科院大类分区（2025 版），可在设置里关闭
    const casLabel = (cfg().showCAS && ifInfo.cn)
      ? ` <span style="opacity:0.7">· 中科院${ifInfo.cn}区</span>` : '';
    badge.innerHTML = `IF <strong>${ifInfo.if}</strong>${qLabel}${casLabel}`;
    badge.style.cssText = `
      display: inline-block;
      margin-left: ${compact ? 4 : 6}px;
      padding: ${compact ? '0 4px' : '1px 7px'};
      border-radius: ${compact ? 4 : 10}px;
      font-size: ${compact ? 10 : 11}px;
      font-weight: 500;
      color: ${color};
      background: ${compact ? 'transparent' : bg};
      border: 1px solid ${color}${compact ? '55' : '33'};
      vertical-align: middle;
      cursor: pointer;
      white-space: nowrap;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;
    const casTitle = ifInfo.cn ? ` | 中科院${ifInfo.cn}区${ifInfo.top ? ' Top' : ''}` : '';
    badge.title = `${ifInfo.name} | JCR ${ifInfo.q || 'N/A'}区 | IF ${ifInfo.if}${casTitle} | 点击复制`;

    // 点击徽章复制「期刊全称 IF xx.x (Qx) 中科院x区」
    badge.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      let plain = `${ifInfo.name} IF ${ifInfo.if}`;
      if (ifInfo.q) plain += ` (${ifInfo.q})`;
      if (ifInfo.cn) plain += ` 中科院${ifInfo.cn}区${ifInfo.top ? ' Top' : ''}`;
      const saved = badge.innerHTML;
      const flash = function (txt) {
        badge.style.opacity = '0.65';
        badge.textContent = txt;
        setTimeout(function () {
          badge.innerHTML = saved;
          badge.style.opacity = '';
        }, 1200);
      };
      copyText(plain).then(function () {
        flash('已复制 ✓');
      }, function () {
        flash('复制失败');
      });
    });

    return badge;
  }

  /**
   * 判断一段文本是否像期刊名，用于决定要不要给反馈入口，避免在作者名旁冒出问号
   */
  function looksLikeJournal(text) {
    const s = String(text || '').trim();
    if (s.length < 3 || s.length > 60) return false;
    if (!/^[A-Z][A-Za-z0-9&.\- ]*$/.test(s)) return false;
    if (s.split(/\s+/).length > 7) return false;
    return true;
  }

  function currentPmid() {
    const m = String(location.pathname).match(/\/(\d+)\/?$/);
    if (m) return m[1];
    // PMC 全文页的路径是 PMC ID（PMC4392080），真正的 PMID 在 meta 里
    const meta = document.querySelector('meta[name="citation_pmid"]');
    return meta ? (meta.getAttribute('content') || '').trim() : '';
  }

  /**
   * 库中查不到时的小问号：点一下打开带预填内容的反馈页，用户不用手打刊名
   */
  function createFeedbackBadge(journal, pmid) {
    const el = document.createElement('span');
    el.className = 'pifh-missing';
    el.dataset.pifhMissing = 'true';
    el.textContent = '?';
    el.title = '期刊库未收录「' + journal + '」，点这里反馈';
    el.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      const title = '[期刊未收录] ' + journal;
      const body = '### 期刊名称\n' + journal + '\n\n' +
        (pmid ? '### 文献链接\nhttps://pubmed.ncbi.nlm.nih.gov/' + pmid + '/\n\n' : '') +
        '（以上由插件自动填入，无需补充其它信息）\n';
      const url = 'https://github.com/' + REPO + '/issues/new?title=' +
        encodeURIComponent(title) + '&body=' + encodeURIComponent(body);
      window.open(url, '_blank', 'noopener');
    });
    return el;
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
    console.log('[Pubmed IF Tag][详情页] 找到', citations.length, '个引用容器');

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
        if (!ifInfo) {
          // 查不到：只有像期刊名时才给一个问号，且每个引用容器最多一个，避免满屏提示
          if (cfg().hintMissing &&
              looksLikeJournal(cleanText) &&
              !citEl.querySelector('[data-pifh-missing]')) {
            const ask = createFeedbackBadge(cleanText, currentPmid());
            node.parentNode.insertBefore(ask, node.nextSibling);
          }
          continue;
        }

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
      console.log('[Pubmed IF Tag][详情页] short-citation未找到，扫描全页文本节点');
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

        console.log('[Pubmed IF Tag][详情页] 全页扫描找到期刊:', cleanText, 'IF=' + ifInfo.if);
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
   * 处理 PMC 全文页
   * DOM：<div class="front-matter"><hgroup><h1>标题</h1></hgroup>
   *        <div class="ameta p font-secondary font-xs"><div>
   *          <div class="display-inline-block"><button>Cell Death Differ</button></div>
   *          . 2014 Nov 14;22(5):838–851. doi: <a …>
   * PMC 把刊名缩写放在 <button> 里，按钮文本正好是库里的键形式，直接查表即可
   */
  /**
   * PMC 搜索结果页：每条结果的刊名在 .citation-part 文本开头，形如
   * "J Investig Med High Impact Case Rep. 2021 Jan-Dec;9:2324709621990768. doi: ..."
   */
  function processPmcSearchPage() {
    if (!cfg().showSearch) return;

    document.querySelectorAll('.docsum-wrap .citation-part').forEach((el) => {
      if (el.classList.contains('pmcid')) return;        // "PMCID: PMC..." 不是刊名
      if (el.querySelector('[data-pifh-badge]')) return; // 已标过

      const text = el.textContent || '';
      const split = splitCitationForHighlight(text);     // → { highlight: "刊名. 2021", rest: ... }
      if (!split) return;

      const name = split.highlight.replace(/\.\s+(?:19|20)\d{2}$/, '').trim();
      if (!name || name.length > 60 || !looksLikeJournal(name)) return;

      const ifInfo = lookupIF(name);
      if (!ifInfo) return;

      // 这一行若带链接等子元素，重建会破坏结构，只在行尾挂徽章
      if (el.children.length > 0) {
        el.appendChild(document.createTextNode(' '));
        el.appendChild(createIFBadge(ifInfo));
        return;
      }
      highlightCitation(el, ifInfo);
    });
  }

  function processPmcPage() {
    if (!cfg().showDetail) return;
    if (document.querySelector('[data-pifh-badge]')) return;

    // 注意：刊名 <button> 不在 .front-matter 里，它在标题下方那条独立引文行
    //        （"Cell Death Differ. 2014 Nov 14;22(5):838–851."）。
    //        所以全页扫按钮，第一个"文本能查到库 + 所在块含年份"的就是主文章引文行。
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const label = (btn.textContent || '').trim();
      if (!label || label.length > 60 || !looksLikeJournal(label)) continue;
      const ifInfo = lookupIF(label);
      if (!ifInfo) continue;

      // 向上最多三层找一个带年份的容器，确认这是引文行而不是工具栏按钮
      let row = btn.parentElement;
      for (let i = 0; i < 3 && row; i++) {
        if (/(19|20)\d{2}/.test(row.textContent || '')) break;
        row = row.parentElement;
      }
      if (!row || !/(19|20)\d{2}/.test(row.textContent || '')) continue;

      const { hl, color } = getIFColors(ifInfo.if);
      btn.style.backgroundColor = hl;
      btn.style.color = color;
      btn.style.fontWeight = '600';
      btn.style.borderRadius = '3px';
      btn.style.padding = '0 3px';

      const wrap = btn.closest('.display-inline-block') || btn;
      const badge = createIFBadge(ifInfo);
      badge.style.marginLeft = '4px';
      wrap.parentNode.insertBefore(badge, wrap.nextSibling);
      return;
    }

    // 兜底：刊名只存在于 meta 时用全称找一次；命中不了就不标，避免错标
    const meta = document.querySelector('meta[name="citation_journal_title"]');
    const fullName = meta ? (meta.getAttribute('content') || '').trim() : '';
    if (!fullName) return;
    const ifInfo = lookupIF(fullName);
    if (!ifInfo) return;

    const h1 = document.querySelector('h1');
    if (!h1 || !h1.parentNode) return;
    const line = document.createElement('div');
    line.style.cssText = 'margin:6px 0 2px;font-size:12px;color:#64748b;';
    line.textContent = ifInfo.name + ' ';
    line.appendChild(createIFBadge(ifInfo));
    h1.parentNode.insertBefore(line, h1.nextSibling);
  }

  /**
   * 判断当前页面类型并处理
   */
  function processPage() {
    const url = window.location.href;
    // PMC 要优先判断：它的路径也以数字结尾，落到 PubMed 详情页逻辑会扫全页乱标
    if (/pmc\.ncbi\.nlm\.nih\.gov/.test(url) || /ncbi\.nlm\.nih\.gov\/pmc\//.test(url)) {
      if (/\/search/i.test(location.pathname)) {
        processPmcSearchPage();
      } else {
        processPmcPage();
      }
      return;
    }
    const isSearch = url.includes('/?') || /pubmed\.ncbi\.nlm\.nih\.gov\/$/.test(url);
    const isDetail = /\/\d+\/$/.test(url);
    if (isSearch) {
      if (cfg().showSearch) processSearchResultsPage();
    } else if (isDetail) {
      if (cfg().showDetail) processArticleDetailPage();
    } else {
      // URL 类型不明确时，按用户开关各试一次
      if (cfg().showSearch) processSearchResultsPage();
      if (cfg().showDetail) processArticleDetailPage();
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

  /**
   * 加载当前生效的期刊库：本地存储中的更新数据优先，未更新则用内置库
   */
  async function loadActiveLibrary() {
    try {
      if (window.PIFLibrary && window.PIFLibrary.getActiveLibrary) {
        const active = await window.PIFLibrary.getActiveLibrary();
        if (active && active.entries && Object.keys(active.entries).length > 0) {
          DB = active.entries;
          console.log('[Pubmed IF Tag] 期刊库来源: ' + active.source + '，生效条数: ' + Object.keys(DB).length);
          return;
        }
      }
    } catch (err) {
      console.warn('[Pubmed IF Tag] 读取更新库失败，退回内置库', err);
    }
    console.log('[Pubmed IF Tag] 已加载内置库，期刊数: ' + Object.keys(DB).length);
  }

  async function loadSettings() {
    try {
      if (window.PIFSettings && window.PIFSettings.get) {
        SETTINGS = await window.PIFSettings.get();
      }
    } catch (err) {
      console.warn('[Pubmed IF Tag] 读取设置失败，使用默认值', err);
      SETTINGS = FALLBACK_SETTINGS;
    }
  }

  async function init() {
    await loadSettings();
    await loadActiveLibrary();

    // 设置改动后不重建已标注的节点（避免闪烁），只提示用户刷新
    if (window.PIFSettings && window.PIFSettings.onChange) {
      window.PIFSettings.onChange(function (next) {
        SETTINGS = next;
      });
    }

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
  }

  init();
})();
