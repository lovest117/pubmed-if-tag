/**
 * Pubmed IF Tag - 设置读写
 * 被内容脚本与设置页共用；缺省值即现有默认行为，不配置的用户感知不到变化
 */
(function () {
  'use strict';

  const KEY = 'pifSettings';

  const DEFAULTS = {
    showSearch: true,     // 搜索结果页显示标签
    showDetail: true,     // 文章详情页显示标签
    showQuartile: true,   // 标签里带 Q1/Q2 分区
    showCAS: true,        // 标签里带中科院大类分区（1-4 区）
    compact: false,       // 紧凑样式（更小、去掉底色）
    hintMissing: true,    // 详情页查不到 IF 时给出反馈入口
    thresholds: [20, 10, 5, 2], // 颜色分级阈值：红/橙/黄/绿
  };

  const BOOL_KEYS = ['showSearch', 'showDetail', 'showQuartile', 'showCAS', 'compact', 'hintMissing'];

  function normalizeThresholds(t) {
    const src = Array.isArray(t) ? t : DEFAULTS.thresholds;
    return DEFAULTS.thresholds.map(function (def, i) {
      const v = parseFloat(src[i]);
      return isFinite(v) && v > 0 ? v : def;
    });
  }

  // 阈值必须递减，否则会被 normalize 修正为默认值
  function normalize(raw) {
    const out = Object.assign({}, DEFAULTS, raw || {});
    BOOL_KEYS.forEach(function (k) {
      out[k] = typeof out[k] === 'boolean' ? out[k] : DEFAULTS[k];
    });
    out.thresholds = normalizeThresholds(out.thresholds);
    for (let i = 1; i < out.thresholds.length; i++) {
      if (out.thresholds[i] < out.thresholds[i - 1]) continue;
      out.thresholds = DEFAULTS.thresholds.slice();
      break;
    }
    return out;
  }

  async function get() {
    try {
      const res = await chrome.storage.local.get(KEY);
      return normalize(res && res[KEY]);
    } catch (err) {
      return normalize(null);
    }
  }

  async function save(patch) {
    const cur = await get();
    const next = normalize(Object.assign({}, cur, patch || {}));
    await chrome.storage.local.set({ [KEY]: next });
    return next;
  }

  async function reset() {
    await chrome.storage.local.remove(KEY);
    return normalize(null);
  }

  function onChange(fn) {
    if (!chrome.storage || !chrome.storage.onChanged) return;
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === 'local' && changes[KEY]) {
        fn(normalize(changes[KEY].newValue));
      }
    });
  }

  window.PIFSettings = {
    KEY: KEY,
    DEFAULTS: DEFAULTS,
    normalize: normalize,
    get: get,
    save: save,
    reset: reset,
    onChange: onChange,
  };
})();
