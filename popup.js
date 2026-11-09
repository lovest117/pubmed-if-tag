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
  var btnSettings = $('btnSettings');
  var countEl = $('journalCount');
  var linkGithub = $('linkGithub');
  var linkFeedback = $('linkFeedback');
  var verEl = $('verText');
  var newVerEl = $('newVer');

  var myVersion = '';
  try {
    myVersion = chrome.runtime.getManifest().version;
    verEl.textContent = 'v' + myVersion;
    verEl.title = '点击检查新版本';
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

  // 主数字显示当前生效条数；内置/远程的构成放 tooltip，不在界面上堆两个数字
  function showCounts(active) {
    var n = Object.keys(active.entries || {}).length;
    var bIn = active.builtinCount || 0;
    var remoteN = active.remoteCount || 0;
    countEl.textContent = n + ' 种';
    libInfo.textContent = remoteN > 0 ? '远程补充' : '内置库';
    libInfo.title = '内置 ' + bIn + ' 种' +
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

  if (btnSettings) {
    btnSettings.addEventListener('click', function () {
      if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        window.open('options.html');
      }
    });
  }

  // 反馈统一收口到主页的反馈区块，弹窗只留一个入口
  if (linkGithub) linkGithub.href = 'https://github.com/' + REPO;
  if (linkFeedback) linkFeedback.href = SITE + '/#feedback';

  function cmpVersion(a, b) {
    var pa = String(a).split('.');
    var pb = String(b).split('.');
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var x = parseInt(pa[i], 10) || 0;
      var y = parseInt(pb[i], 10) || 0;
      if (x > y) return 1;
      if (x < y) return -1;
    }
    return 0;
  }

  // 版本检查只在用户主动点版本号时发起，不做后台自检，也不弹任何提示框
  var checkBusy = false;

  // 主路径读主页上的 version.json：无速率限制、国内可访问，每次发版由 release.ps1 同步更新。
  // 回退到 GitHub Release API —— 匿名调用有每小时 60 次的 IP 配额，撞上限会 403，
  // 所以只能当备用，不能当主路径。
  async function fetchRemoteVersion() {
    try {
      var r = await fetch(SITE + '/version.json', { cache: 'no-store' });
      if (r.ok) {
        var j = await r.json();
        if (j && j.version) {
          return { version: String(j.version).replace(/^v/i, '').trim(), zip: j.zip || '' };
        }
      }
    } catch (e) {
      // 走到回退
    }
    try {
      var resp = await fetch('https://api.github.com/repos/' + REPO + '/releases/latest',
        { cache: 'no-store' });
      if (resp.ok) {
        var json = await resp.json();
        var v = String((json && (json.tag_name || json.name)) || '')
          .replace(/^v/i, '').trim();
        if (v) return { version: v, zip: '' };
      }
    } catch (e) {
      // 两个源都不通，按"无法检查"处理
    }
    return null;
  }

  async function checkUpdate() {
    if (!myVersion || checkBusy) return;
    checkBusy = true;
    var saved = verEl.textContent;
    verEl.textContent = '检查中...';

    var remote = await fetchRemoteVersion();

    verEl.textContent = saved;
    checkBusy = false;
    newVerEl.textContent = '';

    if (!remote) {
      newVerEl.textContent = ' · 无法检查更新';
      setTimeout(function () { newVerEl.textContent = ''; }, 3000);
      return;
    }
    if (cmpVersion(remote.version, myVersion) <= 0) {
      newVerEl.textContent = ' · 已是最新';
      setTimeout(function () { newVerEl.textContent = ''; }, 3000);
      return;
    }

    var zipName = remote.zip || ('Pubmed-IF-Tag-v' + remote.version + '.zip');
    var zipUrl = SITE + '/download/' + zipName;
    var a = document.createElement('a');
    a.href = zipUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = '有新版本 v' + remote.version + ' ↓';
    a.title = '点击下载 v' + remote.version + ' 安装包（解压覆盖原目录后到扩展页点刷新）';
    newVerEl.textContent = ' · ';
    newVerEl.appendChild(a);

    // 浏览器接手下载后，把下一步动作和说明入口留在原位，避免用户下载完不知道怎么办
    a.addEventListener('click', function () {
      var help = document.createElement('a');
      help.href = SITE + '/#update';
      help.target = '_blank';
      help.rel = 'noopener';
      help.textContent = '步骤说明';
      newVerEl.textContent = ' · 正在下载 · ';
      newVerEl.appendChild(help);
    });
  }

  if (verEl) verEl.addEventListener('click', checkUpdate);

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
      btnUpdate.textContent = '更新期刊数据';
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
