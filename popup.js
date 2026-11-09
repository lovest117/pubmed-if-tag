/**
 * Pubmed IF Tag - 弹窗逻辑
 * 注意：Manifest V3 禁止扩展页面执行内联脚本，所有逻辑必须放在独立 js 文件中
 */
(function () {
  'use strict';

  var REPO = 'lovest117/pubmed-if-tag';
  // 主页在 Cloudflare Pages，国内可访问；反馈入口都从这里进
  var SITE = 'https://pubmed-if-tag.pages.dev';
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
  var linkSuggest = $('linkSuggest');
  var verEl = $('verText');

  // 版本号从 manifest 读，避免写死后过期；读不到就整段不显示，不留多余分隔符
  try {
    verEl.textContent = 'v' + chrome.runtime.getManifest().version + ' · ';
  } catch (err) {
    verEl.textContent = '';
  }

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

  // 只刷新数量显示，不动状态文案：主数字显示当前生效条数，内置/远程的构成放 tooltip
  function showCounts(active) {
    var n = Object.keys(active.entries || {}).length;
    var builtinN = active.builtinCount || 0;
    var remoteN = active.remoteCount || 0;
    countEl.textContent = n + ' 种';
    // 右上角只说数据构成，条数已经在统计区显示，避免重复
    libInfo.textContent = remoteN > 0 ? '远程补充' : '内置库';
    libInfo.title = '内置 ' + builtinN + ' 种' +
      (remoteN > 0 ? ' · 远程补充 ' + remoteN + ' 种' : '');
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

  // 反馈入口指向主页的对应区块，页面里再跳 GitHub Issue（带模板）
  if (linkGithub) linkGithub.href = 'https://github.com/' + REPO;
  if (linkFeedback) linkFeedback.href = SITE + '/#feedback';
  if (linkSuggest) linkSuggest.href = SITE + '/#suggest';

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
