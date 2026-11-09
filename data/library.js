/**
 * Pubmed IF Tag - 期刊库共享模块
 * 负责：解析远程 journal-if.js、与内置库合并、读写本地存储
 * 被 content script 与 popup 共同使用
 */
(function () {
  'use strict';

  // 本地存储键名
  const STORAGE_KEY = 'pifLibrary';

  // 远程数据源，按顺序尝试，任一成功即返回
  // 之所以列三个，是因为国内网络对 GitHub raw 域名不稳定
  const REMOTE_SOURCES = [
    {
      name: 'GitHub API',
      url: 'https://api.github.com/repos/lovest117/pubmed-if-tag/contents/data/journal-if.js?ref=main',
      type: 'github-api',
    },
    {
      name: 'jsDelivr CDN',
      url: 'https://cdn.jsdelivr.net/gh/lovest117/pubmed-if-tag@main/data/journal-if.js',
      type: 'text',
    },
    {
      name: 'GitHub Raw',
      url: 'https://raw.githubusercontent.com/lovest117/pubmed-if-tag/main/data/journal-if.js',
      type: 'text',
    },
  ];

  // 单行条目格式：  "key": { if: 12.2, q: "Q1", name: "Gut Microbes" },
  const ENTRY_RE = /^\s*"([^"]+)"\s*:\s*\{\s*if\s*:\s*([0-9]*\.?[0-9]+)\s*,\s*q\s*:\s*"([^"]*)"\s*,\s*name\s*:\s*"([^"]*)"\s*\}\s*,?\s*$/;

  /**
   * 解析 journal-if.js 文本，返回 { 小写期刊名: {if, q, name} }
   * 先按行解析（快且稳），条数异常时退回整体 JSON 化解析
   */
  function parseJournalJs(text) {
    if (!text || typeof text !== 'string') return {};
    const entries = {};
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = ENTRY_RE.exec(lines[i]);
      if (!m) continue;
      const key = m[1].toLowerCase().trim();
      const val = parseFloat(m[2]);
      if (!key || !isFinite(val)) continue;
      entries[key] = { if: val, q: m[3], name: m[4] };
    }
    if (Object.keys(entries).length >= 100) return entries;
    return parseByJsonify(text);
  }

  /**
   * 兜底解析：把对象字面量里的裸键名补上引号，再当 JSON 解析
   */
  function parseByJsonify(text) {
    try {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start < 0 || end <= start) return {};
      let body = text.slice(start, end + 1);
      body = body
        .replace(/([{,]\s*)if(\s*:)/g, '$1"if"$2')
        .replace(/([{,]\s*)q(\s*:)/g, '$1"q"$2')
        .replace(/([{,]\s*)name(\s*:)/g, '$1"name"$2');
      const obj = JSON.parse(body);
      const out = {};
      Object.keys(obj).forEach(function (k) {
        const v = obj[k];
        if (!v || typeof v.if !== 'number' || !isFinite(v.if)) return;
        out[k.toLowerCase().trim()] = {
          if: v.if,
          q: v.q || '',
          name: v.name || '',
        };
      });
      return out;
    } catch (err) {
      return {};
    }
  }

  /**
   * 合并两个库，extra 覆盖 base，返回 { entries, added }
   */
  function mergeLibraries(base, extra) {
    const merged = Object.assign({}, base || {});
    let added = 0;
    Object.keys(extra || {}).forEach(function (k) {
      if (!merged[k]) added++;
      merged[k] = extra[k];
    });
    return { entries: merged, added: added };
  }

  /**
   * 读取已保存的远程库
   */
  async function getStoredLibrary() {
    try {
      const res = await chrome.storage.local.get(STORAGE_KEY);
      const v = res && res[STORAGE_KEY];
      if (v && v.entries && typeof v.entries === 'object') return v;
    } catch (err) {
      // 忽略，视为未更新过
    }
    return null;
  }

  /**
   * 取当前生效的库：内置 + 已更新部分（已更新优先）
   */
  async function getActiveLibrary() {
    const builtin = (typeof window !== 'undefined' && window.JOURNAL_IF_DB) || {};
    const builtinCount = Object.keys(builtin).length;
    const stored = await getStoredLibrary();
    if (stored && stored.entries) {
      const merged = Object.assign({}, builtin, stored.entries);
      return {
        entries: merged,
        source: stored.source || 'remote',
        updatedAt: stored.updatedAt || 0,
        builtinCount: builtinCount,
        remoteCount: Object.keys(stored.entries).length,
      };
    }
    return {
      entries: builtin,
      source: 'builtin',
      updatedAt: 0,
      builtinCount: builtinCount,
      remoteCount: 0,
    };
  }

  /**
   * 保存合并后的库
   */
  async function saveLibrary(entries, source) {
    const payload = {
      entries: entries,
      source: source,
      updatedAt: Date.now(),
      count: Object.keys(entries).length,
    };
    await chrome.storage.local.set({ [STORAGE_KEY]: payload });
    return payload;
  }

  /**
   * 清空更新内容，回到内置库
   */
  async function clearLibrary() {
    await chrome.storage.local.remove(STORAGE_KEY);
  }

  /**
   * GitHub API 返回的 base64 内容按 UTF-8 解码
   */
  function decodeBase64Utf8(b64) {
    const clean = String(b64).replace(/\s/g, '');
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  async function fetchSource(src) {
    const resp = await fetch(src.url, { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    if (src.type === 'github-api') {
      const json = await resp.json();
      if (!json || !json.content) throw new Error('接口未返回文件内容');
      return decodeBase64Utf8(json.content);
    }
    return await resp.text();
  }

  /**
   * 依次尝试各数据源，返回 { entries, count, source }
   * 会拒绝条目数明显少于内置库的结果：jsDelivr 的 @main 地址有 CDN 缓存，
   * 仓库刚更新数据时可能仍返回旧版本，此时应换下一个源而不是把旧库写进本地
   */
  async function fetchLatestLibrary() {
    const builtin = (typeof window !== 'undefined' && window.JOURNAL_IF_DB) || {};
    const builtinCount = Object.keys(builtin).length;
    const errors = [];
    for (let i = 0; i < REMOTE_SOURCES.length; i++) {
      const src = REMOTE_SOURCES[i];
      try {
        const text = await fetchSource(src);
        const entries = parseJournalJs(text);
        const count = Object.keys(entries).length;
        if (count < 50) throw new Error('解析结果异常，仅 ' + count + ' 条');
        if (builtinCount >= 200 && count < Math.floor(builtinCount * 0.9)) {
          throw new Error('返回 ' + count + ' 条，少于内置的 ' + builtinCount + ' 条，疑似缓存未更新');
        }
        return { entries: entries, count: count, source: src.name };
      } catch (err) {
        errors.push(src.name + '：' + (err && err.message ? err.message : String(err)));
      }
    }
    throw new Error(errors.join('；'));
  }

  window.PIFLibrary = {
    STORAGE_KEY: STORAGE_KEY,
    REMOTE_SOURCES: REMOTE_SOURCES,
    parseJournalJs: parseJournalJs,
    mergeLibraries: mergeLibraries,
    getStoredLibrary: getStoredLibrary,
    getActiveLibrary: getActiveLibrary,
    saveLibrary: saveLibrary,
    clearLibrary: clearLibrary,
    fetchLatestLibrary: fetchLatestLibrary,
  };
})();
