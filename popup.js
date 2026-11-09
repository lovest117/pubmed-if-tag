/**
 * Pubmed IF Tag - 弹窗逻辑
 * 注意：Manifest V3 禁止扩展页面执行内联脚本，所有逻辑必须放在独立 js 文件中
 */
(function () {
  'use strict';

  var REPO = 'lovest117/pubmed-if-tag';
  var builtin = window.JOURNAL_IF_DB || {};
  var builtinCount = Object.keys(builtin).length;

  function $(id) {
    return document.getElementById(id);
  }

  var libInfo = $('libInfo');
  var statusEl = $('updateStatus');
  var btnUpdate = $('btnUpdate');
  var btnReset = $('btnReset');
  var countEl = $('journalCount');
  var linkGithub = $('linkGithub');
  var linkFeedback = $('linkFeedback');

  function fmtTime(ts) {
    var d = new Date(ts);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function setStatus(text, kind) {
    statusEl.className = 'update-status' + (kind ? ' ' + kind : '');
    statusEl.textContent = text;
  }

  // 只刷新数量显示，不动状态文案
  function showCounts(active) {
    var entries = active.entries || {};
    var n = Object.keys(entries).length;
    libInfo.textContent = '生效 ' + n + ' 种（内置 ' + active.builtinCount + ' 种）';
    countEl.textContent = n + ' 种';
  }

  async function refresh() {
    try {
      var active = await window.PIFLibrary.getActiveLibrary();
      showCounts(active);
      if (active.updatedAt) {
        setStatus('已更新于 ' + fmtTime(active.updatedAt) + ' · 来源 ' + active.source, 'ok');
      } else {
        setStatus('当前使用内置数据，尚未更新');
      }
    } catch (err) {
      setStatus('读取本地数据失败：' + (err && err.message ? err.message : String(err)), 'err');
    }
  }

  // 反馈链接：按固定字段生成 Issue，仓库 Actions 会解析并自动补录
  function buildFeedbackUrl() {
    var title = '期刊未收录：请填写期刊缩写';
    var body = [
      '### 期刊缩写（如 Nat Commun）',
      '',
      '',
      '### 影响因子 IF（如 14.7）',
      '',
      '',
      '### JCR 分区（Q1 / Q2 / Q3 / Q4）',
      '',
      '',
      '### 文献链接或 PMID',
      '',
      '',
      '<!-- 提交后仓库会自动把它补进期刊库，你在弹窗点一次「一键更新 IF 库」即可生效。请勿修改上面的字段名。 -->'
    ].join('\n');
    return 'https://github.com/' + REPO + '/issues/new?title=' +
      encodeURIComponent(title) + '&body=' + encodeURIComponent(body);
  }

  if (linkGithub) linkGithub.href = 'https://github.com/' + REPO;
  if (linkFeedback) linkFeedback.href = buildFeedbackUrl();

  btnUpdate.addEventListener('click', async function () {
    btnUpdate.disabled = true;
    btnUpdate.textContent = '更新中...';
    setStatus('正在连接 GitHub 拉取最新数据...', 'pending');

    try {
      var latest = await window.PIFLibrary.fetchLatestLibrary();
      var merged = window.PIFLibrary.mergeLibraries(builtin, latest.entries);
      await window.PIFLibrary.saveLibrary(merged.entries, latest.source);

      var active = await window.PIFLibrary.getActiveLibrary();
      showCounts(active);

      var total = Object.keys(merged.entries).length;
      if (merged.added > 0) {
        setStatus('更新成功：新增 ' + merged.added + ' 种，当前共 ' + total +
          ' 种。请刷新 PubMed 页面生效。', 'ok');
      } else {
        setStatus('已是最新数据，共 ' + total + ' 种，无需新增。', 'ok');
      }
    } catch (err) {
      setStatus('更新失败：' + (err && err.message ? err.message : String(err)) +
        '。可点下方「打开 GitHub」手动查看最新数据。', 'err');
    } finally {
      btnUpdate.disabled = false;
      btnUpdate.textContent = '一键更新 IF 库';
    }
  });

  btnReset.addEventListener('click', async function (e) {
    e.preventDefault();
    try {
      await window.PIFLibrary.clearLibrary();
      var active = await window.PIFLibrary.getActiveLibrary();
      showCounts(active);
      setStatus('已恢复内置库（' + active.builtinCount + ' 种）。请刷新 PubMed 页面生效。');
    } catch (err) {
      setStatus('恢复失败：' + (err && err.message ? err.message : String(err)), 'err');
    }
  });

  refresh();
})();
