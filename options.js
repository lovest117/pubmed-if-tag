/**
 * Pubmed IF Tag - 设置页逻辑
 */
(function () {
  'use strict';

  var S = window.PIFSettings;
  var BOOL_IDS = ['showSearch', 'showDetail', 'showQuartile', 'compact', 'hintMissing'];
  var msgEl = document.getElementById('msg');

  function $(id) {
    return document.getElementById(id);
  }

  function fill(cfg) {
    BOOL_IDS.forEach(function (id) {
      $(id).checked = !!cfg[id];
    });
    for (var i = 0; i < 4; i++) {
      $('t' + i).value = cfg.thresholds[i];
    }
  }

  function read() {
    var cfg = {};
    BOOL_IDS.forEach(function (id) {
      cfg[id] = $(id).checked;
    });
    cfg.thresholds = [0, 1, 2, 3].map(function (i) {
      return parseFloat($('t' + i).value);
    });
    return cfg;
  }

  function say(text, isErr) {
    msgEl.textContent = text;
    msgEl.className = 'msg' + (isErr ? ' err' : '');
    if (text) {
      setTimeout(function () { msgEl.textContent = ''; }, 2600);
    }
  }

  async function load() {
    // 先按默认值渲染，避免读不到配置时页面全空
    fill(S.normalize(null));
    try {
      fill(await S.get());
    } catch (err) {
      say('读取失败：' + (err && err.message ? err.message : err), true);
    }
  }

  $('save').addEventListener('click', async function () {
    var raw = read();
    var bad = raw.thresholds.some(function (v) { return !isFinite(v) || v <= 0; });
    if (bad) {
      say('阈值必须是正数', true);
      return;
    }
    var desc = raw.thresholds.every(function (v, i, arr) {
      return i === 0 || v < arr[i - 1];
    });
    if (!desc) {
      say('阈值需从大到小（红 > 橙 > 黄 > 绿）', true);
      return;
    }
    try {
      fill(await S.save(raw));
      say('已保存，刷新 PubMed 页面生效');
    } catch (err) {
      say('保存失败：' + (err && err.message ? err.message : err), true);
    }
  });

  $('reset').addEventListener('click', async function () {
    try {
      fill(await S.reset());
      say('已恢复默认');
    } catch (err) {
      say('恢复失败：' + (err && err.message ? err.message : err), true);
    }
  });

  load();
})();
