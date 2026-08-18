/**
 * pwa.js — PWA 增强
 *  - Service Worker 注册
 *  - 安装提示（beforeinstallprompt）
 *  - 网络状态指示（header 在线/离线徽标）
 *  - 阅读进度离线队列：离线时把进度写进 localStorage，恢复在线后自动补传
 */
(function () {
  'use strict';

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function (err) {
        console.warn('Service worker registration failed:', err);
      });
    });
  }

  /* ================================================================
     网络状态指示
     ================================================================ */
  var netEls = [];

  function collectNetEls() {
    netEls = Array.prototype.slice.call(
      document.querySelectorAll('#netStatus, [data-role="net-status"]')
    );
  }

  function updateNetStatus() {
    var online = navigator.onLine;
    netEls.forEach(function (el) {
      el.classList.toggle('offline', !online);
      el.textContent = online ? '在线' : '离线';
      el.title = online ? '已联网' : '当前离线，阅读已缓存的书籍';
    });
  }

  function initNetStatus() {
    collectNetEls();
    updateNetStatus();
    window.addEventListener('online', function () {
      updateNetStatus();
      if (window.WebraryPWA) window.WebraryPWA.flushProgress();
    });
    window.addEventListener('offline', updateNetStatus);
  }

  /* ================================================================
     阅读进度离线队列（outbox）
     ================================================================ */
  var OUTBOX_KEY = 'webrary-progress-outbox';
  var OUTBOX_MAX_AGE = 7 * 24 * 3600 * 1000; // 7 天
  var FLUSHING = false;

  function readOutbox() {
    try {
      var raw = localStorage.getItem(OUTBOX_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function writeOutbox(list) {
    try {
      localStorage.setItem(OUTBOX_KEY, JSON.stringify(list.slice(-200)));
    } catch (e) { /* storage full, ignore */ }
  }

  /**
   * 离线时排队一条进度记录；恢复在线后自动补传。
   * @param {string|number} bookId
   * @param {{currentPage:number, totalPages:number, finished:boolean}} payload
   */
  function enqueueProgress(bookId, payload) {
    var list = readOutbox();
    list.push({
      bookId: String(bookId),
      payload: payload,
      ts: Date.now()
    });
    writeOutbox(list);
    if (navigator.onLine) flushProgress();
  }

  function flushProgress() {
    if (FLUSHING) return Promise.resolve();
    FLUSHING = true;
    var list = readOutbox().filter(function (item) {
      return Date.now() - (item.ts || 0) < OUTBOX_MAX_AGE;
    });
    writeOutbox(list);

    function pump() {
      if (!navigator.onLine) {
        FLUSHING = false;
        return Promise.resolve();
      }
      if (!list.length) {
        FLUSHING = false;
        return Promise.resolve();
      }
      var item = list[0];
      return fetch('/api/books/' + item.bookId + '/progress', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.payload || {})
      })
        .then(function (resp) {
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          list.shift();
          writeOutbox(list);
          return pump();
        })
        .catch(function () {
          // 网络或服务端失败：保留队列，下次 online 再试
          FLUSHING = false;
          return Promise.resolve();
        });
    }

    return pump().catch(function () {
      FLUSHING = false;
    });
  }

  /* ================================================================
     安装提示（原有逻辑）
     ================================================================ */
  var deferredPrompt = null;
  var installBtn = document.getElementById('pwaInstallBtn');

  function updateInstallButton() {
    if (!installBtn) return;
    var standalone = window.matchMedia && (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches
    );
    installBtn.style.display = deferredPrompt && !standalone ? 'inline-flex' : 'none';
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    updateInstallButton();
  });

  if (installBtn) {
    installBtn.addEventListener('click', function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function (choice) {
        if (choice && choice.outcome === 'accepted') {
          deferredPrompt = null;
          updateInstallButton();
        }
      });
    });
  }

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    updateInstallButton();
  });

  /* 曝光给其他脚本（reader.js 等） */
  window.WebraryPWA = {
    isOnline: function () {
      return navigator.onLine;
    },
    enqueueProgress: enqueueProgress,
    flushProgress: flushProgress,
    updateNetStatus: updateNetStatus
  };

  document.addEventListener('DOMContentLoaded', initNetStatus);
  updateInstallButton();
  if (document.readyState !== 'loading') initNetStatus();
})();