/**
 * Pubmed IF Tag - 内容脚本
 * 在PubMed搜索结果页和文章详情页自动显示期刊影响因子
 */

(function () {
  'use strict';

  // 当前生效的期刊库：内置库保持原引用，更新到的那部分叠在 OVERRIDES 上，
  // 查询时先查 OVERRIDES 再查 DB——不合并成全量副本，省掉每次页面加载的复制开销
  let DB = window.JOURNAL_IF_DB || {};
  let OVERRIDES = {};
  // 模糊匹配用的「前 6 字符 → 键」索引，避免 miss 时扫全表
  let PREFIX_INDEX = null;
  const DEBUG = false;

  function log() {
    if (DEBUG) console.log.apply(console, arguments);
  }

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
    thresholds: [20, 10, 5, 3],
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
  /**
   * 建「前 6 字符 → 键」索引。
   * 模糊匹配的两个方向（key.startsWith(dbKey) / dbKey.startsWith(key)）
   * 都要求较短一方长度 ≥ 6，因此两侧前 6 字符必然相同；
   * 用桶查到的候选集与原全表遍历的匹配结果完全一致，只是范围从上万条降到数十条。
   */
  function buildPrefixIndex() {
    const idx = Object.create(null);
    const add = function (k) {
      const p = k.slice(0, 6);
      (idx[p] || (idx[p] = [])).push(k);
    };
    for (const k in DB) add(k);
    // 更新过、且内置库里没有的新刊也要能参与模糊匹配
    for (const k in OVERRIDES) if (!DB[k]) add(k);
    PREFIX_INDEX = idx;
  }

  /** 取一条记录：更新过的优先，其次内置库 */
  function entryOf(key) {
    return OVERRIDES[key] || DB[key] || null;
  }

  function lookupIF(journalAbbr) {
    if (!journalAbbr) return null;
    const key = normalizeJournalName(journalAbbr);
    if (!key) return null;

    // 精确匹配
    const exact = entryOf(key);
    if (exact) return exact;

    // 尝试去掉 "The " 前缀
    if (key.startsWith('the ')) {
      const noThe = entryOf(key.substring(4));
      if (noThe) return noThe;
    }

    // 有限模糊匹配（只遍历同前缀桶）
    if (key.length < 6 || !PREFIX_INDEX) return null;
    const bucket = PREFIX_INDEX[key.slice(0, 6)];
    if (!bucket) return null;
    for (const dbKey of bucket) {
      const shorter = Math.min(key.length, dbKey.length);
      const longer = Math.max(key.length, dbKey.length);
      if (shorter >= 6 && shorter >= longer * 0.7) {
        if (key.startsWith(dbKey) || dbKey.startsWith(key)) {
          const hit = entryOf(dbKey);
          if (hit) return hit;
        }
      }
    }
    return null;
  }

  /**
   * 颜色分级：按 20 / 10 / 5 / 3 分档，低于 3 分（不含）归入「其他」
   * 浅色档（柔麦黄、暖陶橙）在实色块上自动改用深字，保证可读
   */
  const IF_PALETTE = ['#00663F', '#2E9968', '#F2CD76', '#DD8344', '#704264'];
  const DARK_INK = '#241c14';

  function hexToRgb(hex) {
    return [1, 3, 5].map(function (i) { return parseInt(hex.substr(i, 2), 16); });
  }

  // WCAG 相对亮度，决定实色块上用白字还是深字
  function relLum(hex) {
    const c = hexToRgb(hex).map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  // 与目标色混合，p 为主色占比
  function mixColor(hex, target, p) {
    const a = hexToRgb(hex);
    const b = hexToRgb(target);
    const out = a.map(function (v, i) { return Math.round(v * p + b[i] * (1 - p)); });
    return '#' + out.map(function (v) { return (v < 16 ? '0' : '') + v.toString(16); }).join('');
  }

  // WCAG 对比度
  function contrast(c1, c2) {
    const a = relLum(c1);
    const b = relLum(c2);
    const hi = Math.max(a, b);
    const lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
  }

  // 白底上的文字要读得清（≥4.5），主色偏浅时逐步加深
  function readableInk(main) {
    for (let p = 1; p >= 0.4; p -= 0.15) {
      const c = p === 1 ? main : mixColor(main, '#000000', p);
      if (contrast(c, '#ffffff') >= 4.5) return c;
    }
    return mixColor(main, '#000000', 0.4);
  }

  /**
   * 根据IF值返回一套颜色；阈值可在设置页调整
   * solid 实色块底色 / fg 块上文字 / ink 白底文字 / tint 高亮淡底
   */
  function getIFColors(ifValue) {
    const t = cfg().thresholds;
    let idx = 4;
    if (ifValue >= t[0]) idx = 0;
    else if (ifValue >= t[1]) idx = 1;
    else if (ifValue >= t[2]) idx = 2;
    else if (ifValue >= t[3]) idx = 3;
    const solid = IF_PALETTE[idx];
    return {
      solid: solid,
      fg: contrast(solid, '#ffffff') >= 3.0 ? '#ffffff' : DARK_INK,
      ink: readableInk(solid),
      tint: mixColor(solid, '#ffffff', 0.12),
    };
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
    const { solid, fg, ink } = getIFColors(ifInfo.if);
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
      color: ${compact ? ink : fg};
      background: ${compact ? 'transparent' : solid};
      border: 1px solid ${compact ? solid + '55' : solid};
      vertical-align: middle;
      cursor: pointer;
      white-space: nowrap;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;
    // 供筛选条、导出、悬停卡直接读取，不用再从徽章文本里抠数字
    badge.dataset.pifhIf = String(ifInfo.if);
    badge.dataset.pifhName = ifInfo.name || '';
    badge.dataset.pifhQ = ifInfo.q || '';
    badge.dataset.pifhCn = ifInfo.cn || '';
    badge.dataset.pifhTop = ifInfo.top ? '1' : '';
    const casTitle = ifInfo.cn ? ` | 中科院${ifInfo.cn}区${ifInfo.top ? ' Top' : ''}` : '';
    badge.title = `${ifInfo.name} | JCR ${ifInfo.q || 'N/A'}区 | IF ${ifInfo.if}${casTitle} | 点击复制`;
    // 说明用途即可，不开放 tabindex：每行一个徽章全可聚焦会让 Tab 逐个穿过几十个焦点
    badge.setAttribute('role', 'button');
    badge.setAttribute('aria-label', `复制期刊信息：${ifInfo.name}，IF ${ifInfo.if}`);

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

    const { tint, ink } = getIFColors(ifInfo.if);

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
      background: ${tint};
      color: ${ink};
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
    log('[Pubmed IF Tag][详情页] 找到', citations.length, '个引用容器');

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

        const { tint, ink } = getIFColors(ifInfo.if);

        // 高亮这个文本节点的父元素
        const parent = node.parentElement;
        if (parent && parent.tagName !== 'A') {
          parent.style.backgroundColor = tint;
          parent.style.color = ink;
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
      log('[Pubmed IF Tag][详情页] short-citation未找到，扫描全页文本节点');
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

        log('[Pubmed IF Tag][详情页] 全页扫描找到期刊:', cleanText, 'IF=' + ifInfo.if);
        const { tint, ink } = getIFColors(ifInfo.if);
        if (parent && parent.tagName !== 'A') {
          parent.style.backgroundColor = tint;
          parent.style.color = ink;
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

      const { tint, ink } = getIFColors(ifInfo.if);
      btn.style.backgroundColor = tint;
      btn.style.color = ink;
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
      if (cfg().showSearch) {
        processSearchResultsPage();
        refreshFilterBar();
      }
    } else if (isDetail) {
      if (cfg().showDetail) processArticleDetailPage();
    } else {
      // URL 类型不明确时，按用户开关各试一次
      if (cfg().showSearch) {
        processSearchResultsPage();
        refreshFilterBar();
      }
      if (cfg().showDetail) processArticleDetailPage();
    }
  }

  // ========== 1.3.0：结果页筛选 / 导出 / 悬停卡 ==========

  const UI = {
    // 筛选状态刻意不放 storage：换一页文档就该回到「全部」，避免下次打开莫名空空如也
    // 1.3.1：组内支持多选（并集），组间仍是交集，所以三组各存一个数组
    filterState: { tiers: [], noneOnly: false, qs: [], cns: [], top: false },
    card: null,
    lastBadge: null,
    cardTimer: null,
    hideTimer: null,
    hoverBound: false,
    // 1.3.1：chip 说明气泡与滚动安慰
    tip: null,
    tipTimer: null,
    tipBound: false,
  };

  /**
   * 收集"一条搜索结果"对应的可隐藏单元。
   * 以刊名引用行为锚点往上找 article / .search-results-item，
   * 比直接按 .full-view 之类的类名猜更不容易把整块列表当一个结果。
   */
  function resultItems() {
    let anchors = Array.prototype.slice.call(document.querySelectorAll('.docsum-journal-citation'));
    if (!anchors.length) {
      anchors = Array.prototype.slice.call(document.querySelectorAll('.docsum'));
    }
    const boxes = [];
    anchors.forEach(function (c) {
      const box = c.closest('article') ||
        c.closest('.search-results-item') ||
        c.closest('.full-view') ||
        c.parentElement;
      if (!box || boxes.indexOf(box) !== -1) return;
      boxes.push(box);
    });
    return boxes;
  }

  function badgeOf(item) {
    return item.querySelector('[data-pifh-badge]');
  }

  /** 把 IF 值映射成筛选档位，与徽章配色同一套阈值 */
  function tierOf(value) {
    const t = cfg().thresholds;
    if (typeof value !== 'number' || !isFinite(value)) return 'none';
    if (value >= t[0]) return 't20';
    if (value >= t[1]) return 't10';
    if (value >= t[2]) return 't5';
    if (value >= t[3]) return 't3';
    return 't0';
  }

  function matchFilter(item) {
    const f = UI.filterState;
    const badge = badgeOf(item);
    // 未收录是独立开关，与 IF 档位互斥
    if (f.noneOnly) return !badge;
    if (f.tiers.length) {
      if (!badge) return false;
      if (f.tiers.indexOf(tierOf(parseFloat(badge.dataset.pifhIf))) === -1) return false;
    }
    if (f.qs.length && (!badge || f.qs.indexOf(badge.dataset.pifhQ || '') === -1)) return false;
    if (f.cns.length && (!badge || f.cns.indexOf(badge.dataset.pifhCn || '') === -1)) return false;
    if (f.top && (!badge || badge.dataset.pifhTop !== '1')) return false;
    return true;
  }

  /** 当前筛选条件的中文摘要，直接写进计数行，用户不用猜为什么条数变了 */
  function filterSummary() {
    const f = UI.filterState;
    const t = cfg().thresholds;
    const parts = [];
    if (f.noneOnly) {
      parts.push('无 IF 标签');
    } else if (f.tiers.length) {
      // 组内多选用「/」表示并集，组与组之间用「+」表示交集，一眼能看出逻辑
      const map = {};
      map.t20 = 'IF ≥ ' + t[0];
      map.t10 = 'IF ' + t[1] + '–' + t[0];
      map.t5 = 'IF ' + t[2] + '–' + t[1];
      map.t3 = 'IF ' + t[3] + '–' + t[2];
      map.t0 = 'IF < ' + t[3];
      const labels = f.tiers.map(function (k) { return map[k]; }).filter(Boolean);
      if (labels.length === 1) parts.push(labels[0]);
      else if (labels.length > 1) parts.push(labels.join(' / '));
    }
    if (f.qs.length) parts.push('JCR ' + f.qs.join('/'));
    if (f.cns.length) parts.push('中科院 ' + f.cns.map(function (n) { return n + '区'; }).join('/'));
    if (f.top) parts.push('Top');
    return parts.join(' + ');
  }

  function applyFilter() {
    const items = resultItems();
    let shown = 0;
    items.forEach(function (el) {
      const ok = matchFilter(el);
      if (ok) shown++;
      el.classList.toggle('pifh-hidden', !ok);
    });
    const bar = document.querySelector('[data-pifh-filter]');
    const sum = filterSummary();
    if (bar) {
      const countEl = bar.querySelector('.pifh-count');
      if (countEl) {
        countEl.textContent = sum
          ? '显示 ' + shown + ' / ' + items.length + ' 条 · ' + sum
          : '共 ' + items.length + ' 条';
      }
      const ex = bar.querySelector('.pifh-export');
      if (ex) ex.title = '只导出当前看到的 ' + shown + ' 条';
    }
  }

  /** 按 filterState 刷新每颗 chip 的选中态（原地改属性，不重建任何节点） */
  function syncChips() {
    const bar = document.querySelector('[data-pifh-filter]');
    if (!bar) return;
    const f = UI.filterState;
    const chips = bar.querySelectorAll('.pifh-chip');
    for (let i = 0; i < chips.length; i++) {
      const key = chips[i].dataset.pifhKey || '';
      let on = false;
      if (key === 'tier:all') on = !f.tiers.length && !f.noneOnly;
      else if (key === 'tier:none') on = f.noneOnly;
      else if (key.indexOf('tier:') === 0) on = f.tiers.indexOf(key.slice(5)) !== -1;
      else if (key.indexOf('q:') === 0) on = f.qs.indexOf(key.slice(2)) !== -1;
      else if (key.indexOf('cn:') === 0) on = f.cns.indexOf(key.slice(3)) !== -1;
      else if (key === 'top') on = !!f.top;
      if (on) chips[i].dataset.on = '1';
      else delete chips[i].dataset.on;
    }
  }

  /** 组内多选切换：已在集合里就移除，否则加入，返回新数组（不改原数组） */
  function toggleIn(list, value) {
    const next = list.slice();
    const at = next.indexOf(value);
    if (at === -1) next.push(value);
    else next.splice(at, 1);
    return next;
  }

  /**
   * 点选只改状态，不重建筛选条。
   * 旧实现每次点选都把 16 颗按钮销毁重建，鼠标下的对象被换掉、hover 态中途丢失，
   * 体感就是「指上去闪一下」「点下去顿一下」。
   */
  function setFilterState(patch) {
    Object.assign(UI.filterState, patch);
    syncChips();
    applyFilter();
    hideChipTip();
  }

  /**
   * 造一颗筛选 chip。
   * 宽高由 CSS 固定（w-wide 档给 IF 文字较长的档位），选中只换颜色，
   * 所以任意点选都不会引起宽度抖动与邻位重排。
   */
  function makeChip(o) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pifh-chip' + (o.wide ? ' pifh-w-wide' : '');
    btn.dataset.pifhKey = o.key;
    if (o.on) btn.dataset.on = '1';
    if (o.hint) {
      btn.dataset.pifhHint = o.hint;
      // 目标就是按钮自己，不依赖冒泡；延迟由 CSS 的 transition-delay 负责，
      // 省掉 JS 定时器（iframe 里的 timer 会被浏览器节流，容易出不来）
      btn.addEventListener('mouseover', function () { showChipTip(btn); });
      btn.addEventListener('mouseout', function (e) {
        const to = e.relatedTarget;
        if (to && btn.contains(to)) return;
        hideChipTip();
      });
    }
    if (o.dot) {
      const dot = document.createElement('span');
      dot.className = 'pifh-chip-dot';
      dot.style.background = o.dot;
      btn.appendChild(dot);
    }
    btn.appendChild(document.createTextNode(o.label));
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      o.onClick();
    });
    return btn;
  }

  function makeGroup(bar, label) {
    const g = document.createElement('div');
    g.className = 'pifh-grp';
    const l = document.createElement('span');
    l.className = 'pifh-lab';
    l.textContent = label;
    g.appendChild(l);
    bar.appendChild(g);
    return g;
  }

  // ---------- chip 悬停说明气泡 ----------

  function ensureChipTip() {
    if (UI.tip && UI.tip.parentNode) return UI.tip;
    const d = document.createElement('div');
    d.className = 'pifh-tip';
    d.dataset.pifhAux = 'true';
    document.body.appendChild(d);
    UI.tip = d;
    return d;
  }

  function showChipTip(chip) {
    const hint = chip.dataset.pifhHint;
    if (!hint) return;
    const tip = ensureChipTip();
    if (tip.textContent !== hint) tip.textContent = hint;
    tip.removeAttribute('data-on');
    const r = chip.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = Math.round(r.left + r.width / 2 - tw / 2);
    left = Math.max(6, Math.min(window.innerWidth - tw - 6, left));
    let top = Math.round(r.bottom + 7);
    if (top + th > window.innerHeight - 6) top = Math.round(r.top - th - 7);
    tip.style.left = left + 'px';
    tip.style.top = Math.max(6, top) + 'px';
    tip.dataset.on = '1';
  }

  function hideChipTip() {
    clearTimeout(UI.tipTimer);
    if (UI.tip) UI.tip.removeAttribute('data-on');
  }

  function bindChipTips() {
    if (UI.tipBound) return;
    UI.tipBound = true;
    // 气泡是 fixed 定位，滚动后就跟 chip 脱开了，直接收起
    window.addEventListener('scroll', hideChipTip, { passive: true, capture: true });
  }

  /** ? 帮助面板：点开/再点关闭，鼠标离开筛选条也收起 */
  function bindHelp(bar) {
    const btn = bar.querySelector('.pifh-help');
    const box = bar.querySelector('.pifh-helpbox');
    if (!btn || !box) return;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (box.hasAttribute('hidden')) box.removeAttribute('hidden');
      else box.setAttribute('hidden', '');
    });
    box.addEventListener('click', function (e) { e.stopPropagation(); });
    bar.addEventListener('mouseleave', function () {
      if (!box.hasAttribute('hidden')) box.setAttribute('hidden', '');
      hideChipTip();
    });
  }

  function buildFilterBar() {
    const f = UI.filterState;
    const t = cfg().thresholds;
    const bar = document.createElement('div');
    bar.className = 'pifh-filter';
    bar.dataset.pifhFilter = 'true';
    bar.dataset.pifhAux = 'true';

    const main = document.createElement('div');
    main.className = 'pifh-main';
    bar.appendChild(main);

    const gTier = makeGroup(main, '影响因子');
    // IF 档位统一用加宽档：10–20 / 未收录 这类文字更长，宽度不统一就会出现点选位移
    const tierDefs = [
      ['全部', 'tier:all', '', '显示全部条目'],
      ['≥' + t[0], 'tier:t20', IF_PALETTE[0], 'IF ≥ ' + t[0] + ' · 顶级期刊'],
      [t[1] + '–' + t[0], 'tier:t10', IF_PALETTE[1], 'IF ' + t[1] + '–' + t[0] + ' · 优秀'],
      [t[2] + '–' + t[1], 'tier:t5', IF_PALETTE[2], 'IF ' + t[2] + '–' + t[1] + ' · 良好'],
      [t[3] + '–' + t[2], 'tier:t3', IF_PALETTE[3], 'IF ' + t[3] + '–' + t[2] + ' · 一般'],
      ['<' + t[3], 'tier:t0', IF_PALETTE[4], 'IF < ' + t[3] + ' · 较低'],
      ['未收录', 'tier:none', '#cbd5e1', '库里没有这本刊的指标']
    ];
    tierDefs.forEach(function (item) {
      const label = item[0];
      const key = item[1];
      const dot = item[2];
      const hint = item[3];
      const value = key.slice(5);
      gTier.appendChild(makeChip({
        label: label,
        key: key,
        wide: true,
        dot: dot,
        hint: hint,
        on: value === 'all' ? (!f.tiers.length && !f.noneOnly) : (value === 'none' ? f.noneOnly : f.tiers.indexOf(value) !== -1),
        onClick: function () {
          // 「全部」清空整组；其余档位在组内叠加，再点一次取消
          if (value === 'all') {
            setFilterState({ tiers: [], noneOnly: false });
          } else if (value === 'none') {
            setFilterState({ tiers: [], noneOnly: !UI.filterState.noneOnly });
          } else {
            setFilterState({ tiers: toggleIn(UI.filterState.tiers, value), noneOnly: false });
          }
        }
      }));
    });

    // 组与组之间靠标签和间距区分，不再用竖线分隔（换行时会落单）
    const gQ = makeGroup(main, 'JCR');
    const qDefs = [
      ['Q1', '学科前 25%'],
      ['Q2', '25–50%'],
      ['Q3', '50–75%'],
      ['Q4', '后 25%']
    ];
    qDefs.forEach(function (item) {
      const q = item[0];
      gQ.appendChild(makeChip({
        label: q,
        key: 'q:' + q,
        hint: 'JCR ' + q + ' · ' + item[1],
        on: f.qs.indexOf(q) !== -1,
        onClick: function () {
          setFilterState({ qs: toggleIn(UI.filterState.qs, q) });
        }
      }));
    });

    const gCn = makeGroup(main, '中科院');
    // Top 排在中科院组第一位：它是该体系里最高的那档，放在 1–4 区前面更顺
    gCn.appendChild(makeChip({
      label: 'Top',
      key: 'top',
      hint: '中科院 Top 期刊',
      on: !!f.top,
      onClick: function () {
        setFilterState({ top: !UI.filterState.top });
      }
    }));
    const cnDefs = [
      ['1', '前 5%'],
      ['2', '5–20%'],
      ['3', '20–50%'],
      ['4', '后 50%']
    ];
    cnDefs.forEach(function (item) {
      const n = item[0];
      gCn.appendChild(makeChip({
        label: n + '区',
        key: 'cn:' + n,
        hint: '中科院大类 ' + n + ' 区 · ' + item[1],
        on: f.cns.indexOf(n) !== -1,
        onClick: function () {
          setFilterState({ cns: toggleIn(UI.filterState.cns, n) });
        }
      }));
    });

    // Top 已在组首插入，这里只补 1–4 区

    const count = document.createElement('span');
    count.className = 'pifh-count';
    bar.appendChild(count);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pifh-export';
    btn.textContent = '导出 CSV';
    btn.title = '只导出当前筛选后可见的条目';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      exportVisibleCsv();
    });
    bar.appendChild(btn);

    const help = document.createElement('button');
    help.type = 'button';
    help.className = 'pifh-help';
    help.textContent = '?';
    help.title = '筛选说明';
    bar.appendChild(help);

    const box = document.createElement('div');
    box.className = 'pifh-helpbox';
    box.dataset.pifhAux = 'true';
    box.setAttribute('hidden', '');
    box.innerHTML = '<b>筛选怎么用</b><ul>' +
      '<li>同一组里可以同时选多个（取并集），例如 JCR 同时选 Q1 和 Q2。</li>' +
      '<li>三组之间取交集，例如 IF ≥' + t[0] + ' + JCR Q1 就是既高分又是 Q1。</li>' +
      '<li>再点一次已选的按钮即取消；点「全部」清空该组。</li>' +
      '<li>「导出 CSV」只导出当前看到的条目，被筛掉的不写入。</li>' +
      '<li>筛选只影响显示，不改动 PubMed 的原列表与检索结果。</li>' +
      '</ul>';
    bar.appendChild(box);

    bindChipTips();
    bindHelp(bar);

    return bar;
  }

  /**
   * 重建筛选条：翻页/新搜索后旧条会被页面替换或移除，
   * 所以每次都按当前结果列表重新挂一次，状态留在 UI.filterState 里。
   */
  function refreshFilterBar() {
    if (!cfg().showSearch) return;
    const items = resultItems();
    const old = document.querySelector('[data-pifh-filter]');
    if (!items.length) {
      if (old) old.remove();
      return;
    }
    // 条还在页面上就复用，只同步状态：翻页、加载更多都走这条路，
    // 免得每次扫描都销毁重建一遍（重建本身就会闪）。
    if (old && old.isConnected) {
      syncChips();
      applyFilter();
      syncFilterTop(old);
      return;
    }
    const bar = buildFilterBar();
    if (old && old.parentNode) {
      old.parentNode.replaceChild(bar, old);
    } else {
      const host = document.getElementById('search-results');
      if (host) {
        host.insertBefore(bar, host.firstChild);
      } else {
        items[0].parentNode.insertBefore(bar, items[0]);
      }
    }
    syncFilterTop(bar);
    syncChips();
    applyFilter();
  }

  /**
   * 筛选条要贴在 PubMed 自己那条固定顶部导航的下沿，
   * 否则往下滚动时会钻到导航底下，「常驻」就白做了。
   */
  function syncFilterTop(bar) {
    let offset = 0;
    const hdr = document.querySelector('header');
    if (hdr) {
      const pos = window.getComputedStyle(hdr).position;
      if (pos === 'sticky' || pos === 'fixed') {
        const h = hdr.getBoundingClientRect().height;
        if (h > 0 && h < 160) offset = Math.round(h);
      }
    }
    bar.style.top = offset + 'px';
  }

  function csvCell(value) {
    const s = String(value == null ? '' : value);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportVisibleCsv() {
    const items = resultItems().filter(function (el) {
      return !el.classList.contains('pifh-hidden');
    });
    if (!items.length) {
      alert('当前没有可导出的条目');
      return;
    }

    const rows = [['期刊', '年份', 'IF', 'JCR分区', '中科院分区', 'Top', '标题', 'PMID', '链接']];
    items.forEach(function (el) {
      const badge = badgeOf(el);
      const citeEl = el.querySelector('.docsum-journal-citation') || el.querySelector('.docsum');
      const citeText = citeEl ? citeEl.textContent.replace(/\s+/g, ' ').trim() : '';
      const yearMatch = citeText.match(/\b(19|20)\d{2}\b/);

      const titleEl = el.querySelector('.docsum-title') || el.querySelector('h3');
      const titleText = titleEl ? titleEl.textContent.replace(/\s+/g, ' ').trim() : '';

      let pmid = '';
      const pmidEl = el.querySelector('.docsum-pmid, [data-pmid]');
      if (pmidEl) {
        pmid = String(pmidEl.getAttribute('data-pmid') || pmidEl.textContent || '')
          .replace(/\D/g, '');
      }

      let journal = badge ? (badge.dataset.pifhName || '') : '';
      if (!journal) journal = extractJournalAbbreviation(citeText) || citeText;

      rows.push([
        journal,
        yearMatch ? yearMatch[0] : '',
        badge ? badge.dataset.pifhIf : '',
        badge ? (badge.dataset.pifhQ || '') : '',
        badge && badge.dataset.pifhCn ? ('中科院' + badge.dataset.pifhCn + '区') : '',
        badge && badge.dataset.pifhTop === '1' ? 'Top' : '',
        titleText,
        pmid,
        pmid ? ('https://pubmed.ncbi.nlm.nih.gov/' + pmid + '/') : ''
      ]);
    });

    const csv = '\uFEFF' + rows.map(function (r) {
      return r.map(csvCell).join(',');
    }).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const d = new Date();
    const stamp = d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');

    const a = document.createElement('a');
    a.href = url;
    a.download = 'pubmed-if-' + stamp + '.csv';
    a.dataset.pifhAux = 'true';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1500);
  }

  function ensureCard() {
    if (UI.card && document.contains(UI.card)) return UI.card;
    const card = document.createElement('div');
    card.className = 'pifh-card';
    card.dataset.pifhCard = 'true';
    card.dataset.pifhAux = 'true';
    document.body.appendChild(card);
    UI.card = card;
    return card;
  }

  function cardRow(card, key, value) {
    const row = document.createElement('div');
    row.className = 'pifh-c-row';
    const k = document.createElement('span');
    k.className = 'pifh-c-k';
    k.textContent = key;
    const v = document.createElement('span');
    v.className = 'pifh-c-v';
    v.textContent = value;
    row.appendChild(k);
    row.appendChild(v);
    card.appendChild(row);
  }

  function fillCard(badge) {
    const card = ensureCard();
    const ifValue = parseFloat(badge.dataset.pifhIf);
    const colors = getIFColors(ifValue);
    const q = badge.dataset.pifhQ || '';
    const cn = badge.dataset.pifhCn || '';
    const top = badge.dataset.pifhTop === '1';

    card.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'pifh-c-title';
    const dot = document.createElement('span');
    dot.className = 'pifh-c-dot';
    dot.style.background = colors.solid;
    const name = document.createElement('span');
    name.textContent = badge.dataset.pifhName || '库内未收录';
    title.appendChild(dot);
    title.appendChild(name);
    card.appendChild(title);

    const owner = badge.parentElement;
    const abbr = owner ? extractJournalAbbreviation(owner.textContent || '') : '';
    const fullName = (badge.dataset.pifhName || '').toLowerCase();
    // 缩写与全称一样时（如 Lancet）不重复占一行
    if (abbr && abbr.toLowerCase() !== fullName) {
      const line = document.createElement('div');
      line.className = 'pifh-c-abbr';
      line.textContent = abbr;
      card.appendChild(line);
    }

    cardRow(card, '影响因子', isFinite(ifValue) ? ifValue.toFixed(1) : '—');
    cardRow(card, 'JCR 分区', q || '—');
    cardRow(card, '中科院分区', cn ? (cn + ' 区' + (top ? ' · Top' : '')) : '—');
    cardRow(card, '数据版本', 'JCR 2025');

    const foot = document.createElement('div');
    foot.className = 'pifh-c-foot';
    foot.textContent = '点击徽章可复制这条期刊信息';
    card.appendChild(foot);

    return card;
  }

  function placeCard(badge) {
    const card = ensureCard();
    const rect = badge.getBoundingClientRect();
    // 先量尺寸再摆位置，避免从旧位置飞过去的闪动
    card.style.visibility = 'hidden';
    card.dataset.on = '1';
    const w = card.offsetWidth;
    const h = card.offsetHeight;

    let left = rect.left + rect.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));

    let top = rect.bottom + 8;
    if (top + h > window.innerHeight - 8) top = rect.top - h - 8;
    if (top < 8) top = 8;

    card.style.left = left + 'px';
    card.style.top = top + 'px';
    card.style.visibility = '';
  }

  function hideCard() {
    // 注意：dataset.on = '' 只是把值置空，属性仍然存在，
    // .pifh-card[data-on] 照样命中 → 卡片会一直亮着不消失。必须真正移除属性。
    if (UI.card) delete UI.card.dataset.on;
  }

  /**
   * 徽章数量一页几十个，逐个绑监听既费内存也拖慢扫描，
   * 这里统一在 document 上做一次捕获阶段委托。
   */
  function bindHoverCard() {
    if (UI.hoverBound) return;
    UI.hoverBound = true;

    document.addEventListener('mouseover', function (e) {
      const t = e.target;
      if (!t || t.nodeType !== 1 || !t.closest) return;
      const badge = t.closest('[data-pifh-badge]');
      if (!badge || badge === UI.lastBadge) return;
      UI.lastBadge = badge;
      clearTimeout(UI.cardTimer);
      clearTimeout(UI.hideTimer);
      UI.cardTimer = setTimeout(function () {
        if (UI.lastBadge === badge) {
          fillCard(badge);
          placeCard(badge);
        }
      }, 140);
    }, true);

    document.addEventListener('mouseout', function (e) {
      const t = e.target;
      if (!t || t.nodeType !== 1 || !t.closest) return;
      const badge = t.closest('[data-pifh-badge]');
      if (!badge) return;
      // 徽章内部元素之间移动不算离开
      const to = e.relatedTarget;
      if (to && to.nodeType === 1 && to.closest && to.closest('[data-pifh-badge]') === badge) return;
      UI.lastBadge = null;
      clearTimeout(UI.cardTimer);
      clearTimeout(UI.hideTimer);
      UI.hideTimer = setTimeout(hideCard, 100);
    }, true);

    // 滚动时徽章位置变了，卡片会挂在半空，直接收起
    window.addEventListener('scroll', function () {
      if (UI.card && UI.card.dataset.on) hideCard();
    }, true);
  }

  // ========== MutationObserver 监听动态加载 ==========

  const OWN_NODE_ATTRS = ['data-pifh-badge', 'data-pifh-hl', 'data-pifh-missing',
    'data-pifh-filter', 'data-pifh-card', 'data-pifh-aux'];

  /**
   * 新增节点是否是本插件自己插入的。
   * 标注动作会往页面里插 badge / 高亮 span，若不排除，它们又会触发观察器，
   * 形成「标注 → 触发 → 再扫描」的自激往返，白跑多轮全页扫描。
   */
  function isOwnNode(n) {
    if (!n || n.nodeType !== 1 || !n.hasAttribute) return false;
    for (let i = 0; i < OWN_NODE_ATTRS.length; i++) {
      if (n.hasAttribute(OWN_NODE_ATTRS[i])) return true;
    }
    return false;
  }

  /**
   * 在浏览器空闲时执行扫描，避免和 PubMed 首屏渲染抢主线程。
   * 没有 requestIdleCallback（或页面持续繁忙）时由 timeout 兜底，保证一定会跑。
   */
  function scheduleScan() {
    if (typeof requestIdleCallback !== 'function') {
      processPage();
      return;
    }
    requestIdleCallback(function () { processPage(); }, { timeout: 600 });
  }

  function setupObserver() {
    if (RUNTIME.observer) RUNTIME.observer.disconnect();

    RUNTIME.observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.addedNodes.length === 0) continue;

        let hasExternalAdd = false;
        for (const n of m.addedNodes) {
          if (!isOwnNode(n)) {
            hasExternalAdd = true;
            break;
          }
        }
        // 整批新增都是自己插的标签，无需重扫
        if (!hasExternalAdd) continue;

        clearTimeout(RUNTIME._t);
        RUNTIME._t = setTimeout(scheduleScan, 350);
        return;
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
        if (active && active.builtin && Object.keys(active.builtin).length > 0) {
          DB = active.builtin;
          OVERRIDES = active.overrides || {};
          log('[Pubmed IF Tag] 期刊库来源: ' + active.source +
            '，内置 ' + Object.keys(DB).length + ' 条，更新补充 ' + Object.keys(OVERRIDES).length + ' 条' +
            (active.staleDropped ? '，忽略过期快照 ' + active.staleDropped + ' 条' : ''));
        }
      }
    } catch (err) {
      console.warn('[Pubmed IF Tag] 读取更新库失败，退回内置库', err);
    }
    buildPrefixIndex();
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
    bindHoverCard();
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
    setTimeout(scheduleScan, 1000);
    setTimeout(scheduleScan, 2500);

    // 监听URL变化（PubMed是SPA风格，翻页/搜索不刷新页面）
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(scheduleScan, 500);
        setTimeout(scheduleScan, 1500);
      }
    }, 1000);
  }

  init();
})();
