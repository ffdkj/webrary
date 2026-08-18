/**
 * BookReader — In-browser ebook reader
 * Uses epub.js for EPUB/MOBI/AZW3/FB2, PDF.js for PDF, custom renderer for TXT.
 *
 * URL params: ?bookId=X&title=Title&author=Author&ext=epub
 */
(function () {
  'use strict';

  /* ================================================================
     Query Params — URL参数解析
     ================================================================ */
  var params = new URLSearchParams(window.location.search);
  var PARAM_BOOK_ID = params.get('bookId');         // 书籍ID
  var PARAM_TITLE = params.get('title');             // 书名
  var PARAM_AUTHOR = params.get('author');           // 作者
  var PARAM_EXT = params.get('ext');                 // 文件扩展名
  var PARAM_TOC_HREF = params.get('tocHref');        // 目录链接（用于定位章节）

  var STREAM_URL = '/api/books/' + PARAM_BOOK_ID + '/stream';    // 文件流API地址
  var META_URL = '/api/books/' + PARAM_BOOK_ID;                   // 元数据API地址
  var TOC_URL = '/api/books/' + PARAM_BOOK_ID + '/toc';          // 目录API地址
  var HIGHLIGHTS_URL = '/api/books/' + PARAM_BOOK_ID + '/highlights'; // 摘抄API地址
  var TXT_INFO_URL = '/api/books/' + PARAM_BOOK_ID + '/txt/info'; // TXT信息API地址
  function txtPageUrl(page) {
    return '/api/books/' + PARAM_BOOK_ID + '/txt/page/' + page;
  }

  /* ================================================================
     State — 阅读器状态
     ================================================================ */
  var viewer = null;           // { type: 'epub'|'pdf'|'txt', book, rendition, ... }
  var metadata = null;          // 书籍元数据
  var currentFormat = null;    // 当前格式：'epub' | 'pdf' | 'txt'
  var fontSize = parseInt(localStorage.getItem('reader-font-size') || '18', 10);  // 字体大小
  var tocData = [];             // 目录数据列表
  var pdfPageNum = 1;           // PDF 当前页码
  var pdfTotalPages = 0;        // PDF 总页数
  var pdfCurrentStartPage = 1;  // PDF 当前起始页（双页模式下为左页）
  var txtPageNum = 1;           // TXT 当前页码
  var txtTotalPages = 0;        // TXT 总页数
  var highlights = [];          // 当前书籍的摘抄列表
  var pendingHighlight = null;  // 待保存的选区信息
  var txtPressTimer = null;     // TXT 长按计时器
  var txtPressPoint = null;     // TXT 长按触摸点
  var readerSettings = { readingMode: 'single', pageFit: 'width', preloadCount: 3 };  // 阅读器设置

  /* ================================================================
     OPFS 离线阅读 — 主线程直读 Origin Private File System
     ================================================================ */
  var OPFS = (typeof window !== 'undefined' && window.WebraryOPFS) ? window.WebraryOPFS : null;
  var txtPagination = (typeof window !== 'undefined' && window.WebraryTxt) ? window.WebraryTxt : null;
  var OFFLINE_ENABLED = !!(OPFS && OPFS.isSupported);
  var offlineActive = false;   // 当前是否正在读取 OPFS 本地缓存
  var txtOffline = null;       // TXT 离线数据 { text, lines, pages, totalPages, toc }

  // 书籍扩展名（统一小写，去掉点号）
  function getBookExt() {
    var ext = (metadata && metadata.extension) || PARAM_EXT || '';
    return String(ext).toLowerCase().replace(/^\./, '');
  }

  // 当前书籍元数据（用于 OPFS 索引）
  function getBookMeta() {
    return {
      title: (metadata && metadata.title) || PARAM_TITLE || '未命名书籍',
      author: (metadata && metadata.author) || PARAM_AUTHOR || '',
      extension: getBookExt() || 'bin'
    };
  }

  // 将当前书籍的 /stream 流写入 OPFS（带进度提示），失败静默降级
  function cacheCurrentBook() {
    if (!OPFS || !OPFS.isSupported) {
      showToast('当前浏览器不支持 OPFS 离线缓存');
      return Promise.reject(new Error('OPFS unsupported'));
    }
    var ext = getBookExt();
    if (ext === 'pdf') {
      showToast('PDF 暂不支持离线缓存');
      return Promise.reject(new Error('PDF not cacheable'));
    }
    showToast('正在缓存到本地…');
    return OPFS.cacheBook(String(PARAM_BOOK_ID), getBookMeta(), {
      onProgress: function (p) {
        var total = p.total || 1;
        var pct = Math.min(100, Math.round((p.loaded / total) * 100));
        showToast('正在缓存到本地… ' + pct + '%');
      }
    }).then(function () {
      showToast('已缓存，可离线阅读');
      return true;
    }).catch(function (err) {
      showToast('缓存失败: ' + (err && err.message ? err.message : err));
      throw err;
    });
  }

  // 更新工具栏上的离线徽标与缓存按钮状态
  function updateOfflineUi() {
    var badge = document.getElementById('offlineBadge');
    if (badge) {
      badge.style.display = offlineActive ? 'inline-flex' : 'none';
      badge.textContent = offlineActive ? '离线缓存' : '';
    }
    var cacheBtn = document.getElementById('cacheBookBtn');
    if (!cacheBtn) return;
    var ext = getBookExt();
    var cacheable = ext !== 'pdf' && ext !== '';
    cacheBtn.style.display = cacheable ? 'inline-flex' : 'none';
    if (!OPFS) return;
    OPFS.isCached(String(PARAM_BOOK_ID)).then(function (cached) {
      cacheBtn.classList.toggle('active', !!cached);
      cacheBtn.title = cached ? '已缓存到本地，点击删除离线缓存' : '缓存到本地（离线阅读）';
    }).catch(function () { /* ignore */ });
  }

  var HL_COLORS = {
    yellow: 'rgba(255, 213, 79, 0.55)',
    green: 'rgba(129, 199, 132, 0.55)',
    blue: 'rgba(144, 202, 249, 0.55)',
    pink: 'rgba(244, 143, 177, 0.55)'
  };
  var popupShownAt = 0;
  var suppressPopupClick = false;
  var popupHiddenAt = 0;
  var lastTouchEndAt = 0;
  var pdfToggleAt = 0;
  var lastSwipeAt = 0;
  var lastTouchTapAt = 0;
  var lastLongPressAt = 0;     // 热区长按结束时刻（抑制随后伴随的 click）
  var tapPressState = null;    // 热区触摸按压状态 {x, y, timer, moved, longPressed}
  var tapSelecting = false;    // 是否正处于长按选择文字（长按期间禁止滑动翻页）
  var tapLayerDocBound = false;
  var tapModeWatchBound = false;
  var toastTimer = null;

  /* ================================================================
      DOM References — DOM引用缓存
      ================================================================ */
  // 简化的querySelector别名
  function $(sel) { return document.querySelector(sel); }

  var dom = {
    toolbar: $('#toolbar'),
    toolbarTitle: $('#toolbarTitle'),
    toolbarAuthor: $('#toolbarAuthor'),
    readerArea: $('#readerArea'),
    viewerDiv: $('#viewer'),
    loadingOverlay: $('#loadingOverlay'),
    errorState: $('#errorState'),
    errorMessage: $('#errorMessage'),
    tocBtn: $('#tocBtn'),
    highlightsBtn: $('#highlightsBtn'),
    tocOverlay: $('#tocOverlay'),
    tocSidebar: $('#tocSidebar'),
    tocList: $('#tocList'),
    highlightsList: $('#highlightsList'),
    tocTabBtn: $('#tocTabBtn'),
    highlightsTabBtn: $('#highlightsTabBtn'),
    tocClose: $('#tocClose'),
    highlightPopup: $('#highlightPopup'),
    readerToast: $('#readerToast'),
    fontSizeDisplay: $('#fontSizeDisplay'),
    fontSizeDown: $('#fontSizeDown'),
    fontSizeUp: $('#fontSizeUp'),
    pagePrevBtn: $('#pagePrevBtn'),
    pageNextBtn: $('#pageNextBtn'),
    pageIndicator: $('#pageIndicator'),
    pageDivider: $('#pageDivider'),
    settingsBtn: $('#settingsBtn'),
    settingsOverlay: $('#settingsOverlay'),
    settingsModal: $('#settingsModal'),
    settingsClose: $('#settingsClose'),
    readingModeGroup: $('#readingModeGroup'),
    pageFitGroup: $('#pageFitGroup'),
    preloadInput: $('#preloadInput'),
  };

  /* ================================================================
     Utilities — 工具函数
     ================================================================ */
  // 隐藏加载覆盖层
  function hideLoading() {
    dom.loadingOverlay.classList.add('hidden');
    scheduleToolbarHide();
  }

  // 显示加载覆盖层
  function showLoading(msg) {
    if (!msg) msg = '加载中...';
    dom.loadingOverlay.classList.remove('hidden');
    dom.loadingOverlay.querySelector('.loading-text').textContent = msg;
  }

  /* ================================================================
     沉浸式工具栏 — 移动端自动隐藏，点击阅读区中央切换
     ================================================================ */
  var toolbarIdleTimer = null;

  function isMobileLike() {
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    var touch = navigator.maxTouchPoints > 0;
    return (coarse || touch) && window.innerWidth <= 1024;
  }

  function setToolbarHidden(hidden) {
    if (!dom.toolbar) return;
    dom.toolbar.classList.toggle('hidden', !!hidden);
  }

  function cancelToolbarHide() {
    if (toolbarIdleTimer) {
      window.clearTimeout(toolbarIdleTimer);
      toolbarIdleTimer = null;
    }
  }

  function scheduleToolbarHide() {
    cancelToolbarHide();
    if (!isMobileLike()) return;
    if (dom.tocSidebar.classList.contains('open') || dom.settingsOverlay.classList.contains('open')) return;
    toolbarIdleTimer = window.setTimeout(function () {
      setToolbarHidden(true);
      toolbarIdleTimer = null;
    }, 3500);
  }

  function toggleToolbar() {
    var hidden = dom.toolbar.classList.contains('hidden');
    setToolbarHidden(!hidden);
    if (hidden) {
      scheduleToolbarHide();
    } else {
      cancelToolbarHide();
    }
  }

  // 显示错误信息
  function showError(msg) {
    dom.loadingOverlay.classList.add('hidden');
    dom.errorState.style.display = '';
    dom.errorMessage.innerHTML = msg;
    dom.tocBtn.disabled = true;
    var tapLayer = dom.readerArea.querySelector('.reader-tap-layer');
    if (tapLayer) tapLayer.classList.remove('active');
  }

  // 根据扩展名确定书籍格式类型
  function getFormat(ext) {
    switch ((ext || '').toLowerCase()) {
      case 'epub':
      case 'mobi':
      case 'azw3':
      case 'fb2':
        return 'epub';
      case 'pdf':
        return 'pdf';
      case 'txt':
        return 'txt';
      default:
        return 'epub';
    }
  }

  // 更新工具栏的标题和作者显示
  function updateToolbarMeta(title, author) {
    dom.toolbarTitle.textContent = title || '未命名书籍';
    if (author) {
      dom.toolbarAuthor.textContent = '— ' + author;
    } else {
      dom.toolbarAuthor.textContent = '';
    }
  }

  // 保存阅读进度到本地存储
  function saveProgress(location) {
    if (!PARAM_BOOK_ID) return;
    var key = 'reader-progress-' + PARAM_BOOK_ID;
    var data = {
      bookId: PARAM_BOOK_ID,
      format: currentFormat,
      timestamp: Date.now()
    };
    for (var k in location) {
      if (location.hasOwnProperty(k)) data[k] = location[k];
    }
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) { /* storage full, ignore */ }

    // 同步阅读进度到服务器（防抖3秒，非阻塞）
    syncProgressToServer(location);
  }

  // 上次同步时间戳，用于防抖
  var _lastSyncTime = 0;
  // 同步进度到后端（非阻塞、防抖3秒）
  function syncProgressToServer(location) {
    var now = Date.now();
    if (now - _lastSyncTime < 3000) return; // debounce 3s
    _lastSyncTime = now;

    var cp = 0, tp = 0, finished = false;
    if (location.hasOwnProperty('page')) {
      cp = location.page || 0;
      tp = location.totalPages || pdfTotalPages || 0;
      finished = tp > 0 && cp >= tp;
    } else if (location.hasOwnProperty('percentage')) {
      cp = Math.round(location.percentage || 0);
      tp = 100;
    } else {
      return; // TXT scroll — skip server sync
    }

    var payload = { currentPage: cp, totalPages: tp, finished: finished };

    if (navigator.onLine === false) {
      if (window.WebraryPWA) window.WebraryPWA.enqueueProgress(PARAM_BOOK_ID, payload);
      return;
    }

    fetch('/api/books/' + PARAM_BOOK_ID + '/progress', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
    }).catch(function () {
      // 在线但请求失败（服务端暂不可达）：排队待补传
      if (window.WebraryPWA) window.WebraryPWA.enqueueProgress(PARAM_BOOK_ID, payload);
    });
  }

  // 从本地存储加载上次阅读进度
  function loadProgress() {
    if (!PARAM_BOOK_ID) return null;
    var key = 'reader-progress-' + PARAM_BOOK_ID;
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  /* ================================================================
      Reader Settings — 阅读器设置管理
      ================================================================ */
  // 从本地存储加载阅读器设置
  function loadSettings() {
    try {
      var raw = localStorage.getItem('reader-settings');
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed.readingMode) readerSettings.readingMode = parsed.readingMode;
        if (parsed.pageFit) readerSettings.pageFit = parsed.pageFit;
        if (parsed.preloadCount != null) readerSettings.preloadCount = parsed.preloadCount;
      }
    } catch (e) { /* ignore */ }
  }

  // 保存阅读器设置到本地存储
  function saveSettings() {
    try {
      localStorage.setItem('reader-settings', JSON.stringify(readerSettings));
    } catch (e) { /* ignore */ }
  }

  // 打开设置面板
  function openSettings() {
    dom.settingsOverlay.classList.add('open');
    dom.settingsModal.style.display = '';
    applySettingsToUI();
    setToolbarHidden(false);
    cancelToolbarHide();
  }

  // 关闭设置面板
  function closeSettings() {
    dom.settingsOverlay.classList.remove('open');
    dom.settingsModal.style.display = 'none';
    scheduleToolbarHide();
  }

  // 切换设置面板显示/隐藏
  function toggleSettings() {
    if (dom.settingsOverlay.classList.contains('open')) {
      closeSettings();
    } else {
      openSettings();
    }
  }

  // 将设置值同步到UI控件
  function applySettingsToUI() {
    var modeBtns = dom.readingModeGroup.querySelectorAll('.option-btn');
    modeBtns.forEach(function (btn) {
      btn.classList.toggle('selected', btn.dataset.value === readerSettings.readingMode);
    });
    var fitBtns = dom.pageFitGroup.querySelectorAll('.option-btn');
    fitBtns.forEach(function (btn) {
      btn.classList.toggle('selected', btn.dataset.value === readerSettings.pageFit);
    });
    dom.preloadInput.value = readerSettings.preloadCount;
  }

  // 设置阅读模式（单页/双页）
  function setReadingMode(mode) {
    if (readerSettings.readingMode === mode) return;
    readerSettings.readingMode = mode;
    saveSettings();
    applySettingsToUI();
    if (currentFormat === 'pdf') {
      pdfCurrentStartPage = makePageValid(pdfCurrentStartPage);
      renderPdfViewport(pdfCurrentStartPage);
    }
  }

  // 设置页面适配方式（按宽度/按高度）
  function setPageFit(fit) {
    if (readerSettings.pageFit === fit) return;
    readerSettings.pageFit = fit;
    saveSettings();
    applySettingsToUI();
    if (currentFormat === 'pdf') {
      renderPdfViewport(pdfCurrentStartPage);
    }
  }

  // 获取当前阅读模式下的翻页步长（单页=1，双页=2）
  function getStepSize() {
    return readerSettings.readingMode === 'double' ? 2 : 1;
  }

  // 确保PDF页码在有效范围内并对齐步长
  function makePageValid(page) {
    var step = getStepSize();
    // Align to step boundary (1, 3, 5... for double, 1, 2, 3... for single)
    if (step === 2) {
      page = page % 2 === 0 ? page - 1 : page;
    }
    if (page < 1) page = 1;
    if (page > pdfTotalPages) page = Math.max(1, pdfTotalPages - step + 1);
    if (step === 2 && page % 2 === 0) page = page - 1;
    return page;
  }

  /* ================================================================
     TOC Sidebar — 目录侧边栏
     ================================================================ */
  // 打开目录侧边栏
  function openToc() {
    dom.tocSidebar.classList.add('open');
    dom.tocOverlay.classList.add('open');
    setToolbarHidden(false);
    cancelToolbarHide();
  }

  // 关闭目录侧边栏
  function closeToc() {
    dom.tocSidebar.classList.remove('open');
    dom.tocOverlay.classList.remove('open');
    scheduleToolbarHide();
  }

  // 切换目录侧边栏显示/隐藏
  function toggleToc() {
    if (dom.tocSidebar.classList.contains('open')) {
      closeToc();
    } else {
      openToc();
    }
  }

  /**
   * 将 epub.js 嵌套目录展开为线性数组 [{ label, href, depth }]
   */
  function flattenEpubToc(toc) {
    var result = [];
    function walk(items, depth) {
      if (!items || !items.length) return;
      items.forEach(function (item) {
        result.push({
          label: item.label || '',
          href: item.href || '',
          depth: depth
        });
        if (item.subitems && item.subitems.length > 0) {
          walk(item.subitems, depth + 1);
        }
      });
    }
    if (toc && toc.length) walk(toc, 0);
    return result;
  }

  // 渲染目录列表到侧边栏
  function renderToc() {
    if (tocData.length === 0) {
      dom.tocList.innerHTML = '<span class="loading-text" style="display:block;padding:20px;">暂无目录</span>';
      dom.tocBtn.disabled = true;
      return;
    }

    dom.tocBtn.disabled = false;
    dom.tocList.innerHTML = tocData
      .map(function (item, i) {
        var cls = item.depth > 0 ? 'toc-item toc-sub' : 'toc-item';
        return '<button class="' + cls + '" data-index="' + i + '" data-href="' + escapeHtml(item.href || '') + '">'
          + escapeHtml(item.label) + '</button>';
      })
      .join('');
  }

  // HTML转义，防止XSS
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* ================================================================
     Highlights — 摘抄荧光笔
     ================================================================ */
  function highlightStyle(color) {
    return {
      fill: HL_COLORS[color] || HL_COLORS.yellow,
      'fill-opacity': '0.9',
      'mix-blend-mode': 'multiply'
    };
  }

  function truncateText(str, max) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max) + '…' : str;
  }

  function renderHighlightsList() {
    var list = dom.highlightsList;
    if (!highlights.length) {
      list.innerHTML = '<span class="loading-text" style="display:block;padding:20px;">暂无摘抄</span>';
    } else {
      list.innerHTML = highlights.map(function (hl, i) {
        var dot = '<span class="hl-dot" style="background:' + (HL_COLORS[hl.color] || HL_COLORS.yellow) + '"></span>';
        var loc = hl.format === 'epub' ? 'EPUB' : '第 ' + hl.page + ' 页';
        return '<button class="highlight-item" data-index="' + i + '">'
          + dot
          + '<span class="highlight-quote">' + escapeHtml(truncateText(hl.quote, 60)) + '</span>'
          + '<span class="highlight-loc">' + loc + '</span>'
          + '<span class="highlight-delete" data-index="' + i + '" title="删除摘抄">'
          + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14">'
          + '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></span>'
          + '</button>';
      }).join('');
    }
    if (dom.highlightsBtn) dom.highlightsBtn.disabled = false;
  }

  function switchSidebarTab(tab) {
    var showToc = tab === 'toc';
    dom.tocTabBtn.classList.toggle('active', showToc);
    dom.highlightsTabBtn.classList.toggle('active', !showToc);
    dom.tocList.style.display = showToc ? '' : 'none';
    dom.highlightsList.style.display = showToc ? 'none' : '';
    if (!showToc) renderHighlightsList();
  }

  function loadHighlights() {
    return fetch(HIGHLIGHTS_URL)
      .then(function (r) { return r.json(); })
      .then(function (resp) {
        highlights = resp && resp.success && Array.isArray(resp.data) ? resp.data : [];
        renderHighlightsList();
        if (currentFormat === 'epub') {
          applyEpubHighlights();
        } else if (currentFormat === 'txt') {
          return renderTxtPage(txtPageNum);
        } else if (currentFormat === 'pdf') {
          markPdfSavedPages();
        }
      })
      .catch(function () {
        highlights = [];
        renderHighlightsList();
      });
  }

  function showHighlightPopup(x, y, info) {
    pendingHighlight = info;
    popupShownAt = Date.now();
    suppressPopupClick = true;
    var popup = dom.highlightPopup;
    popup.style.display = 'flex';
    var w = popup.offsetWidth;
    var h = popup.offsetHeight;
    x = Math.max(12, Math.min(x, window.innerWidth - w - 12));
    y = Math.max(12, Math.min(y, window.innerHeight - h - 12));
    popup.style.left = x + 'px';
    popup.style.top = y + 'px';
  }

  function isHighlightPopupOpen() {
    return dom.highlightPopup && dom.highlightPopup.style.display === 'flex';
  }

  function hideHighlightPopup() {
    if (dom.highlightPopup.style.display === 'none') return;
    dom.highlightPopup.style.display = 'none';
    pendingHighlight = null;
    suppressPopupClick = false;
    popupHiddenAt = Date.now();
  }

  function showToast(message) {
    var toast = dom.readerToast;
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toast.classList.remove('show');
      toastTimer = null;
    }, 2000);
  }

  function savePendingHighlight(color) {
    var info = pendingHighlight;
    if (!info) return;
    hideHighlightPopup();
    if (info.format === 'epub') {
      createEpubHighlight(info, color);
    } else {
      createTxtHighlight(info, color);
    }
  }

  function createTxtHighlight(info, color) {
    var txtReader = document.getElementById('txtReader');
    var prevScroll = txtReader ? txtReader.scrollTop : 0;
    fetch(HIGHLIGHTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format: 'txt',
        page: info.page,
        startOffset: info.startOffset,
        endOffset: info.endOffset,
        quote: info.quote,
        color: color
      })
    }).then(function (r) { return r.json(); })
      .then(function (resp) {
        if (resp && resp.success && resp.data) {
          highlights.unshift(resp.data);
          renderHighlightsList();
          renderTxtPage(txtPageNum).then(function () {
            if (txtReader) txtReader.scrollTop = prevScroll;
          });
        }
      })
      .catch(function () { /* ignore */ });
  }

  function createEpubHighlight(info, color) {
    var cfiRange;
    try {
      var cfiEngine = viewer.rendition.epubcfi;
      var cfiObj = cfiEngine.fromRange(info.range, info.content.cfiBase);
      cfiRange = 'epubcfi(' + cfiEngine.segmentString(cfiObj.base) + '!' + cfiEngine.segmentString(cfiObj.path);
      if (cfiObj.range && cfiObj.start && cfiObj.end) {
        cfiRange += ',' + cfiEngine.segmentString(cfiObj.start) + ',' + cfiEngine.segmentString(cfiObj.end);
      }
      cfiRange += ')';
    } catch (e) {
      return;
    }
    fetch(HIGHLIGHTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format: 'epub',
        cfiRange: cfiRange,
        quote: info.quote,
        color: color
      })
    }).then(function (r) { return r.json(); })
      .then(function (resp) {
        if (resp && resp.success && resp.data) {
          highlights.unshift(resp.data);
          renderHighlightsList();
          try {
            viewer.rendition.annotations.add(
              'highlight', cfiRange, { id: resp.data.id }, null, null, highlightStyle(color)
            );
          } catch (e) { console.warn('epub highlight add failed', e); }
        }
      })
      .catch(function () { /* ignore */ });
  }

  function txtSelectionOffsets(container) {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    var range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return null;

    var nodes = [];
    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    var offset = 0;
    while (walker.nextNode()) {
      var node = walker.currentNode;
      if (!node.textContent) continue;
      nodes.push({ node: node, start: offset, end: offset + node.textContent.length });
      offset += node.textContent.length;
    }
    if (!nodes.length) return null;

    function offsetFor(containerNode, charOffset) {
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.node === containerNode) return n.start + charOffset;
        if (containerNode.nodeType === 1 && containerNode.contains(n.node)) {
          return n.start + charOffset;
        }
      }
      return null;
    }

    var start = offsetFor(range.startContainer, range.startOffset);
    var end = offsetFor(range.endContainer, range.endOffset);
    var quote = sel.toString();
    if (start == null || end == null || end <= start || !quote) return null;
    return {
      page: txtPageNum,
      startOffset: start,
      endOffset: end,
      quote: quote
    };
  }

  function clearTxtPressTimer() {
    if (txtPressTimer) {
      window.clearTimeout(txtPressTimer);
      txtPressTimer = null;
    }
    txtPressPoint = null;
  }

  function startTxtPressTimer(e) {
    clearTxtPressTimer();
    var touch = e.touches && e.touches[0];
    if (!touch) return;
    txtPressPoint = { x: touch.clientX, y: touch.clientY };
    txtPressTimer = window.setTimeout(function () {
      txtPressTimer = null;
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || !txtPressPoint) return;
      maybeShowTxtPopup({ clientX: txtPressPoint.x, clientY: txtPressPoint.y });
    }, 500);
  }

  function maybeShowTxtPopup(e) {
    var txtReader = document.getElementById('txtReader');
    if (!txtReader) return;
    var info = txtSelectionOffsets(txtReader);
    if (!info) return;
    var x = e.clientX;
    var y = e.clientY;
    if (e.changedTouches && e.changedTouches.length) {
      x = e.changedTouches[0].clientX;
      y = e.changedTouches[0].clientY;
    }
    if (x == null || y == null) return;
    showHighlightPopup(x + 4, y + 8, info);
  }

  function bindTxtHighlightHandlers(txtReader) {
    if (!txtReader || txtReader.__webraryHlBound) return;
    txtReader.__webraryHlBound = true;
    txtReader.addEventListener('mouseup', function (e) {
      window.setTimeout(function () { maybeShowTxtPopup(e); }, 10);
    });
    txtReader.addEventListener('touchstart', startTxtPressTimer, true);
    txtReader.addEventListener('touchmove', clearTxtPressTimer, true);
    txtReader.addEventListener('touchend', function (e) {
      clearTxtPressTimer();
      maybeShowTxtPopup(e);
    });
    txtReader.addEventListener('scroll', hideHighlightPopup, true);
    document.addEventListener('selectionchange', function () {
      if (!isHighlightPopupOpen()) return;
      var info = txtSelectionOffsets(txtReader);
      if (info) pendingHighlight = info;
    });
  }

  function applyTxtHighlight(container, hl) {
    function wrap(node, s, e) {
      var text = node.textContent;
      var mark = document.createElement('mark');
      mark.className = 'hl-' + (hl.color || 'yellow');
      mark.dataset.highlightId = String(hl.id);
      mark.textContent = text.slice(s, e);
      var frag = document.createDocumentFragment();
      if (s > 0) frag.appendChild(document.createTextNode(text.slice(0, s)));
      frag.appendChild(mark);
      if (e < text.length) frag.appendChild(document.createTextNode(text.slice(e)));
      node.parentNode.replaceChild(frag, node);
    }

    var start = hl.startOffset;
    var end = hl.endOffset;
    if (start != null && end != null && end > start) {
      var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      var offset = 0;
      while (walker.nextNode()) {
        var node = walker.currentNode;
        var len = node.textContent.length;
        var nodeStart = offset;
        offset += len;
        var nodeEnd = offset;
        if (nodeEnd <= start || nodeStart >= end) continue;
        var s = Math.max(0, start - nodeStart);
        var e = Math.min(len, end - nodeStart);
        if (s >= e) continue;
        wrap(node, s, e);
        return;
      }
    }

    // 偏移失效时用选中原文在页面文本中搜索兜底
    if (hl.quote) {
      var walker2 = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      while (walker2.nextNode()) {
        var node2 = walker2.currentNode;
        var idx = node2.textContent.indexOf(hl.quote);
        if (idx >= 0) {
          wrap(node2, idx, idx + hl.quote.length);
          return;
        }
      }
    }
  }

  function applyTxtPageHighlights(container, page) {
    highlights.forEach(function (hl) {
      if (hl.format === 'txt' && hl.page === page) applyTxtHighlight(container, hl);
    });
  }

  function applyEpubHighlights() {
    if (!viewer || !viewer.rendition) return;
    highlights.forEach(function (hl) {
      if (hl.format !== 'epub' || !hl.cfiRange) return;
      try {
        viewer.rendition.annotations.add(
          'highlight', hl.cfiRange, { id: hl.id }, null, null, highlightStyle(hl.color)
        );
      } catch (e) { console.warn('epub highlight restore failed', e); }
    });
  }

  function maybeShowEpubPopup(content, point) {
    var doc = content && content.document;
    if (!doc) return;
    var sel = doc.getSelection ? doc.getSelection() : null;
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    var range = sel.getRangeAt(0);
    var quote = (sel.toString() || '').trim();
    if (!quote) return;
    var iframeRect = content.iframe ? content.iframe.getBoundingClientRect() : { left: 0, top: 0 };
    var x;
    var y;
    if (point) {
      x = iframeRect.left + point.x + 4;
      y = iframeRect.top + point.y + 8;
    } else {
      var rect = range.getBoundingClientRect();
      x = iframeRect.left + rect.left + rect.width / 2;
      y = iframeRect.top + rect.bottom + 6;
    }
    showHighlightPopup(x, y, { format: 'epub', range: range, quote: quote, content: content });
  }

  function bindEpubHighlightHandlers() {
    if (!viewer || !viewer.rendition) return;
    var contents = viewer.rendition.getContents();
    (contents || []).forEach(function (content) {
      var doc = content && content.document;
      if (!doc || doc.__webraryHlBound) return;
      doc.__webraryHlBound = true;
      var pressTimer = null;
      var pressPoint = null;
      function clearPress() {
        if (pressTimer) {
          window.clearTimeout(pressTimer);
          pressTimer = null;
        }
        pressPoint = null;
      }
      doc.addEventListener('touchstart', function (e) {
        clearPress();
        var touch = e.touches && e.touches[0];
        if (!touch) return;
        pressPoint = { x: touch.clientX, y: touch.clientY };
        pressTimer = window.setTimeout(function () {
          pressTimer = null;
          var sel = doc.getSelection ? doc.getSelection() : null;
          if (!sel || sel.isCollapsed || !pressPoint) return;
          maybeShowEpubPopup(content, pressPoint);
        }, 500);
      }, true);
      doc.addEventListener('touchmove', clearPress, true);
      doc.addEventListener('mouseup', function () { maybeShowEpubPopup(content); });
      doc.addEventListener('touchend', function () {
        clearPress();
        maybeShowEpubPopup(content);
      });
      doc.addEventListener('selectionchange', function () {
        if (!isHighlightPopupOpen()) return;
        var sel = doc.getSelection ? doc.getSelection() : null;
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
        var range = sel.getRangeAt(0);
        var quote = (sel.toString() || '').trim();
        if (!quote) return;
        pendingHighlight = { format: 'epub', range: range, quote: quote, content: content };
      });
      doc.addEventListener('click', function () {
        if (suppressPopupClick) {
          suppressPopupClick = false;
          return;
        }
        if (Date.now() - popupShownAt < 500) return;
        hideHighlightPopup();
      });
    });
  }

  function jumpToEpubHighlight(hl) {
    closeToc();
    if (!viewer || !viewer.rendition || !hl.cfiRange) return;
    try {
      viewer.rendition.display(hl.cfiRange);
    } catch (e) { /* ignore */ }
  }

  function jumpToTxtHighlight(hl) {
    closeToc();
    if (hl.page == null) return;
    renderTxtPage(hl.page).then(function () {
      var mark = document.querySelector('mark[data-highlight-id="' + hl.id + '"]');
      if (mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  function deleteHighlight(hl) {
    fetch(HIGHLIGHTS_URL + '/' + hl.id, { method: 'DELETE' })
      .then(function (r) { return r.json(); })
      .then(function (resp) {
        if (resp && resp.success) {
          highlights = highlights.filter(function (h) { return h.id !== hl.id; });
          renderHighlightsList();
          if (currentFormat === 'epub' && viewer && viewer.rendition && hl.cfiRange) {
            try {
              viewer.rendition.annotations.remove(hl.cfiRange, 'highlight');
            } catch (e) { /* ignore */ }
          } else if (currentFormat === 'txt') {
            renderTxtPage(txtPageNum);
          } else if (currentFormat === 'pdf') {
            markPdfSavedPages();
          }
        }
      })
      .catch(function () { /* ignore */ });
  }

  /* ================================================================
     Font Size — 字体大小管理
     ================================================================ */
  // 应用字体大小到阅读器和本地存储
  function applyFontSize() {
    dom.fontSizeDisplay.textContent = fontSize;

    if (currentFormat === 'epub' && viewer && viewer.rendition) {
      viewer.rendition.themes.fontSize(fontSize + 'px');
    }

    if (currentFormat === 'txt') {
      var txtReader = dom.readerArea.querySelector('.txt-reader');
      if (txtReader) {
        txtReader.style.fontSize = fontSize + 'px';
      }
    }

    try {
      localStorage.setItem('reader-font-size', String(fontSize));
    } catch (e) { /* ignore */ }
  }

  // 调整字体大小（增加或减少）
  function changeFontSize(delta) {
    var newSize = fontSize + delta;
    if (newSize < 10 || newSize > 36) return;
    fontSize = newSize;
    applyFontSize();
  }

  /* ================================================================
     Cleanup — 清理旧的阅读器DOM元素
     ================================================================ */
  function cleanupPreviousViewer() {
    // Destroy epub.js book if present
    if (viewer && viewer.type === 'epub' && viewer.book) {
      try { viewer.book.destroy(); } catch (e) { /* best-effort */ }
    }

    // Remove PDF and TXT containers
    var toRemove = dom.readerArea.querySelectorAll('.pdf-container, .txt-reader');
    toRemove.forEach(function (el) { el.remove(); });

    // Remove epub.js iframe
    var iframe = dom.viewerDiv.querySelector('iframe');
    if (iframe) {
      iframe.remove();
    }
    var tapLayer = dom.readerArea.querySelector('.reader-tap-layer');
    if (tapLayer) tapLayer.remove();
  }

  /* ================================================================
     epub.js Viewer — EPUB/MOBI/AZW3/FB2 格式阅读器
     ================================================================ */
  // 获取 EPUB ArrayBuffer：优先 OPFS 本地缓存，否则网络拉取并后台写缓存
  function getEpubBuffer() {
    if (!OPFS || !OPFS.isSupported) {
      return fetch(STREAM_URL).then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.arrayBuffer();
      });
    }
    return OPFS.getCached(String(PARAM_BOOK_ID)).then(function (cached) {
      if (cached && cached.file) {
        offlineActive = true;
        return cached.file.arrayBuffer();
      }
      return fetch(STREAM_URL).then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        // 后台流式写入 OPFS（不阻塞打开），失败仅告警
        OPFS.cacheResponse(String(PARAM_BOOK_ID), getBookMeta(), resp.clone())
          .then(function () {
            offlineActive = false;
          })
          .catch(function (err) {
            console.warn('OPFS cache failed:', err);
          });
        return resp.arrayBuffer();
      }).catch(function (err) {
        // 网络失败时回退尝试 OPFS（比如刚被清理后再次读取）
        return OPFS.getCached(String(PARAM_BOOK_ID)).then(function (again) {
          if (again && again.file) {
            offlineActive = true;
            return again.file.arrayBuffer();
          }
          throw err;
        });
      });
    });
  }

  // 初始化 epub.js 阅读器
  function initEpub() {
    if (typeof ePub === 'undefined') {
      showError('epub.js 库未加载。<br>请检查 /vendor/epub.min.js 是否存在。');
      return Promise.reject(new Error('ePub not available'));
    }

    cleanupPreviousViewer();
    dom.viewerDiv.style.display = '';
    dom.pageIndicator.style.display = 'none';

    // Fetch EPUB as ArrayBuffer — epub.js reads from memory without HTTP requests
    // 优先 OPFS 本地缓存（离线可用），否则网络拉取并后台缓存
    return getEpubBuffer()
      .then(function (buffer) {
        var book = ePub(buffer);
        var rendition = book.renderTo('viewer', {
          width: '100%',
          height: '100%',
          flow: 'paginated',
          spread: 'none',
          snap: true
        });

        // Dark theme — use object syntax (required by epub.js v0.3.x)
        rendition.themes.register('dark', {
          'body': { 'background': '#121212', 'color': '#d4d4d4' },
          'p, li, div, span, blockquote, pre': { 'color': '#d4d4d4' },
          'h1, h2, h3, h4, h5, h6': { 'color': '#ffffff' },
          'a': { 'color': '#e7c785' },
          'img, svg, figure': { 'mix-blend-mode': 'screen' }
        });
        rendition.themes.select('dark');

        // Font size
        rendition.themes.fontSize(fontSize + 'px');

        // TOC — fetch from backend API (EbookParserService)
        fetch(TOC_URL)
          .then(function (r) { return r.json(); })
          .then(function (resp) {
            if (!resp.success) {
              console.warn('TOC fetch failed:', resp.message);
              tocData = [];
            } else {
              var list = resp.data;
              if (list && list.length) {
                tocData = list.map(function (it) {
                  return { label: it.title || '', href: it.href || '', depth: it.level || 0 };
                });
                if (OPFS && OPFS.isSupported) OPFS.saveToc(String(PARAM_BOOK_ID), list);
              } else {
                tocData = [];
              }
            }
            renderToc();
          }).catch(function (err) {
            console.error('TOC fetch error:', err);
            tocData = [];
            renderToc();
          });

        // Progress tracking
        rendition.on('relocated', function (location) {
          bindEpubTapListeners();
          bindEpubHighlightHandlers();
          var loc = location.start;
          saveProgress({
            cfi: loc.cfi,
            href: loc.href,
            percentage: loc.percentage
          });
          dom.pagePrevBtn.disabled = false;
          dom.pageNextBtn.disabled = false;
        });

        viewer = { type: 'epub', book: book, rendition: rendition };

        // Display first, then load TOC (navigation may need the book fully opened)
        return rendition.display().then(function () {
          hideLoading();
          bindEpubTapListeners();
          bindEpubHighlightHandlers();
          loadHighlights();

          // Load TOC after display
          book.loaded.navigation.then(function (nav) {
            var toc = nav && nav.toc ? nav.toc : (nav && nav.length ? nav : []);
            tocData = flattenEpubToc(toc);
            renderToc();
          }).catch(function () {
            // Fallback: build TOC from spine sections
            try {
              var spineItems = book.spine && book.spine.items;
              if (spineItems && spineItems.length) {
                tocData = spineItems.map(function (item, i) {
                  return { label: item.id || '章节 ' + (i + 1), href: '#' + item.idref || item.href, depth: 0 };
                });
              }
            } catch (e) {}
            renderToc();
          });

          // 离线模式：提示来源；若网络 TOC 不可用，则从 OPFS 目录快照读取
          if (offlineActive) {
            showToast('离线模式 · 已从本地缓存加载');
            updateOfflineUi();
          }
          if (OPFS && OPFS.isSupported && tocData.length === 0) {
            OPFS.getToc(String(PARAM_BOOK_ID)).then(function (savedToc) {
              if (savedToc && savedToc.length) {
                tocData = savedToc.map(function (it) {
                  return { label: it.title || '', href: it.href || '', depth: it.level || 0 };
                });
                renderToc();
              }
            });
          }

          // Navigate to chapter if specified via URL param (user-initiated, takes priority)
          if (PARAM_TOC_HREF) {
            try {
              rendition.display(decodeURIComponent(PARAM_TOC_HREF));
            } catch (e) { console.warn('Nav to chapter failed:', e); }
          } else {
            var saved = loadProgress();
            if (saved && saved.cfi) {
              try {
                rendition.display(saved.cfi);
              } catch (e) {}
            }
          }
        });
      });
  }

  /* ================================================================
     PDF.js Viewer — PDF 格式阅读器
     ================================================================ */
  // 初始化 PDF 阅读器
  function markPdfSavedPages() {
    var container = document.getElementById('pdfContainer');
    if (!container) return;
    var images = container.querySelectorAll('.pdf-page');
    images.forEach(function (img) {
      var page = parseInt(img.dataset.page, 10);
      var saved = highlights.some(function (h) {
        return h.format === 'pdf' && h.page === page;
      });
      img.classList.toggle('pdf-saved', saved);
    });
  }

  function togglePdfHighlight(page) {
    if (!page) return;
    var existing = null;
    for (var i = 0; i < highlights.length; i++) {
      if (highlights[i].format === 'pdf' && highlights[i].page === page) {
        existing = highlights[i];
        break;
      }
    }
    if (existing) {
      fetch(HIGHLIGHTS_URL + '/' + existing.id, { method: 'DELETE' })
        .then(function (r) { return r.json(); })
        .then(function (resp) {
          if (resp && resp.success) {
            highlights = highlights.filter(function (h) { return h.id !== existing.id; });
            renderHighlightsList();
            markPdfSavedPages();
            showToast('已取消收藏第 ' + page + ' 页');
          }
        })
        .catch(function () { /* ignore */ });
    } else {
      fetch(HIGHLIGHTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format: 'pdf',
          page: page,
          quote: '第 ' + page + ' 页',
          color: 'blue'
        })
      }).then(function (r) { return r.json(); })
        .then(function (resp) {
          if (resp && resp.success && resp.data) {
            highlights.unshift(resp.data);
            renderHighlightsList();
            markPdfSavedPages();
            showToast('已收藏第 ' + page + ' 页');
          }
        })
        .catch(function () { /* ignore */ });
    }
  }

  function bindPdfHighlightHandlers(container) {
    if (!container || container.__webraryPdfHlBound) return;
    container.__webraryPdfHlBound = true;

    var pressTimer = null;
    var pressPage = null;
    var pressPoint = null;

    function clearPress() {
      if (pressTimer) {
        window.clearTimeout(pressTimer);
        pressTimer = null;
      }
      pressPage = null;
      pressPoint = null;
    }

    function pageFromEvent(e) {
      var img = e.target && e.target.closest ? e.target.closest('.pdf-page') : null;
      if (!img || !img.dataset.page) return null;
      return parseInt(img.dataset.page, 10);
    }

    function startPress(e, page) {
      clearPress();
      if (!page) return;
      var point = e.touches && e.touches[0];
      if (!point && typeof e.clientX === 'number') point = e;
      pressPoint = point ? { x: point.clientX, y: point.clientY } : null;
      pressPage = page;
      pressTimer = window.setTimeout(function () {
        pressTimer = null;
        if (pressPage == null) return;
        pdfToggleAt = Date.now();
        togglePdfHighlight(pressPage);
        clearPress();
      }, 500);
    }

    container.addEventListener('touchstart', function (e) {
      startPress(e, pageFromEvent(e));
    }, true);
    container.addEventListener('mousedown', function (e) {
      startPress(e, pageFromEvent(e));
    }, true);
    container.addEventListener('touchmove', function (e) {
      if (!pressPoint) return;
      var t = e.touches && e.touches[0];
      if (t && (Math.abs(t.clientX - pressPoint.x) > 12 || Math.abs(t.clientY - pressPoint.y) > 12)) {
        clearPress();
      }
    }, true);
    container.addEventListener('mousemove', function (e) {
      if (!pressPoint) return;
      if (Math.abs(e.clientX - pressPoint.x) > 12 || Math.abs(e.clientY - pressPoint.y) > 12) {
        clearPress();
      }
    }, true);
    container.addEventListener('touchend', clearPress, true);
    container.addEventListener('touchcancel', clearPress, true);
    container.addEventListener('mouseup', clearPress, true);
    container.addEventListener('mouseleave', clearPress, true);
    container.addEventListener('contextmenu', function (e) {
      if (e.target && e.target.closest && e.target.closest('.pdf-page')) {
        e.preventDefault();
      }
    }, true);
  }

  function jumpToPdfHighlight(hl) {
    closeToc();
    if (hl.page == null) return;
    renderPdfViewport(hl.page);
  }

  function initPdf() {
    cleanupPreviousViewer();
    dom.viewerDiv.style.display = 'none';
    dom.highlightsBtn.disabled = true;

    var container = document.createElement('div');
    container.className = 'pdf-container';
    container.id = 'pdfContainer';
    dom.readerArea.appendChild(container);
    bindPdfHighlightHandlers(container);

    return fetch('/api/books/' + PARAM_BOOK_ID + '/pdf/info')
      .then(function (r) { return r.json(); })
      .then(function (resp) {
        if (!resp.success) throw new Error(resp.message || 'Failed');
        var info = resp.data;
        pdfTotalPages = info.totalPages;
        pdfPageNum = 1;

        // TOC from backend API
        return fetch(TOC_URL).then(function (r) { return r.json(); }).then(function (tocResp) {
          if (tocResp.success && tocResp.data && tocResp.data.length) {
            tocData = tocResp.data.map(function (it, i) {
              return {
                label: it.title || '',
                href: '#page-' + (it.chapterIndex != null ? it.chapterIndex + 1 : i + 1),
                depth: it.level || 0,
                page: it.chapterIndex != null ? it.chapterIndex + 1 : i + 1
              };
            });
          } else {
            for (var i = 0; i < pdfTotalPages; i++) {
              tocData.push({ label: '第 ' + (i + 1) + ' 页', href: '#page-' + (i + 1), depth: 0, page: i + 1 });
            }
          }
          renderToc();
        }).catch(function () {
          tocData = [];
          for (var i = 0; i < pdfTotalPages; i++) {
            tocData.push({ label: '第 ' + (i + 1) + ' 页', href: '#page-' + (i + 1), depth: 0, page: i + 1 });
          }
          renderToc();
        });
      })
      .then(function () {
        var saved = loadProgress();
        if (saved && saved.page) pdfCurrentStartPage = Math.min(saved.page, pdfTotalPages);
        pdfCurrentStartPage = makePageValid(pdfCurrentStartPage);
        return renderPdfViewport(pdfCurrentStartPage);
      })
      .then(function () {
        updatePdfNavState();
        dom.pageDivider.style.display = '';
        dom.pagePrevBtn.style.display = '';
        dom.pageNextBtn.style.display = '';
        dom.pageIndicator.style.display = 'inline-block';
        return loadHighlights().then(function () {
          hideLoading();
          viewer = { type: 'pdf' };
        });
      })
      .catch(function (err) {
        showError('PDF 加载失败: ' + escapeHtml(err.message || ''));
      });
  }

  // 渲染PDF指定起始页（支持单页/双页、按宽度/按高度适配）
  function renderPdfViewport(startPage) {
    var container = document.getElementById('pdfContainer');
    if (!container) return Promise.resolve();

    startPage = makePageValid(startPage);
    pdfCurrentStartPage = startPage;
    pdfPageNum = startPage;

    container.innerHTML = '';

    var step = getStepSize();
    var isDouble = step === 2;
    var isFitHeight = readerSettings.pageFit === 'height';
    var pagesToRender = isDouble
      ? (startPage + 1 <= pdfTotalPages ? [startPage, startPage + 1] : [startPage])
      : [startPage];

    var wrapper = document.createElement('div');
    wrapper.className = 'pdf-page-wrapper';
    if (isDouble) {
      wrapper.style.display = 'flex';
      wrapper.style.justifyContent = 'center';
      wrapper.style.alignItems = 'flex-start';
      wrapper.style.gap = '0';
    }
    container.appendChild(wrapper);

    // For fit-height mode, adjust container
    if (isFitHeight) {
      container.style.overflowY = 'hidden';
      container.style.alignItems = 'center';
      container.style.justifyContent = 'center';
      container.style.padding = '0';
      container.style.height = '100%';
      wrapper.style.height = '100%';
      wrapper.style.alignItems = 'center';
      wrapper.style.justifyContent = 'center';
    } else {
      container.style.overflowY = 'auto';
      container.style.alignItems = 'center';
      container.style.justifyContent = 'flex-start';
      container.style.padding = '24px 0';
      container.style.height = '';
      wrapper.style.height = '';
      wrapper.style.alignItems = 'flex-start';
    }

    var promises = pagesToRender.map(function (pageNum) {
      return new Promise(function (resolve) {
        var img = document.createElement('img');
        img.className = 'pdf-page';
        img.id = 'page-' + pageNum;
        img.dataset.page = String(pageNum);
        img.draggable = false;
        img.src = '/api/books/' + PARAM_BOOK_ID + '/pdf/page/' + pageNum + '?dpi=144';
        img.style.display = 'block';

        if (isFitHeight) {
          // Fit: scale to container height
          if (isDouble) {
            img.style.maxHeight = '100%';
            img.style.maxWidth = '50%';
            img.style.width = 'auto';
            img.style.height = 'auto';
            img.style.objectFit = 'contain';
          } else {
            img.style.maxHeight = '100%';
            img.style.maxWidth = '100%';
            img.style.width = 'auto';
            img.style.height = 'auto';
            img.style.objectFit = 'contain';
          }
        } else {
          // Fit width
          if (isDouble) {
            img.style.maxWidth = '100%';
            img.style.width = '50%';
            img.style.height = 'auto';
          } else {
            img.style.maxWidth = '100%';
            img.style.height = 'auto';
          }
        }

        img.style.boxShadow = '0 4px 24px rgba(0,0,0,0.6)';
        img.style.borderRadius = '2px';

        img.onload = function () { resolve(); };
        img.onerror = function () { resolve(); };
        wrapper.appendChild(img);
      });
    });

    return Promise.all(promises).then(function () {
      saveProgress({ page: startPage, totalPages: pdfTotalPages });
      updatePdfNavState();
      container.scrollTop = 0;
      markPdfSavedPages();
      preloadAdjacentPages(startPage, step);
    });
  }

  // 预加载相邻页面图片以加速翻页
  function preloadAdjacentPages(startPage, step) {
    var n = readerSettings.preloadCount;
    if (n <= 0) return;

    var container = document.getElementById('pdfContainer');
    if (!container) return;

    // Remove old preload buffer
    var old = container.querySelector('.pdf-preload-buffer');
    if (old) old.remove();

    var buffer = document.createElement('div');
    buffer.className = 'pdf-preload-buffer';
    buffer.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';

    // Preload N pages ahead
    for (var i = 1; i <= n; i++) {
      var pageAhead = startPage + step + i - 1;
      if (pageAhead > pdfTotalPages) break;
      (function (p) {
        var img = document.createElement('img');
        img.src = '/api/books/' + PARAM_BOOK_ID + '/pdf/page/' + p + '?dpi=144';
        buffer.appendChild(img);
      })(pageAhead);
    }
    // Preload N pages behind
    for (var j = 1; j <= n; j++) {
      var pageBehind = startPage - j;
      if (pageBehind < 1) break;
      (function (p) {
        var img = document.createElement('img');
        img.src = '/api/books/' + PARAM_BOOK_ID + '/pdf/page/' + p + '?dpi=144';
        buffer.appendChild(img);
      })(pageBehind);
    }

    container.appendChild(buffer);
  }

  // 更新 PDF 导航按钮的启用/禁用状态
  function updatePdfNavState() {
    var step = getStepSize();
    dom.pagePrevBtn.disabled = pdfCurrentStartPage <= 1;
    dom.pageNextBtn.disabled = pdfCurrentStartPage + step > pdfTotalPages;
    if (dom.pageIndicator) {
      dom.pageIndicator.textContent = pdfCurrentStartPage + ' / ' + pdfTotalPages;
    }
  }

  // PDF 上一页
  function pdfPrevPage() {
    var step = getStepSize();
    if (pdfCurrentStartPage > 1) {
      renderPdfViewport(Math.max(1, pdfCurrentStartPage - step));
    }
  }

  // PDF 下一页
  function pdfNextPage() {
    var step = getStepSize();
    if (pdfCurrentStartPage + step <= pdfTotalPages) {
      renderPdfViewport(pdfCurrentStartPage + step);
    }
  }

  /* ================================================================
     TXT Viewer — TXT 文本阅读器
     ================================================================ */
  // 初始化 TXT 阅读器：优先读取 OPFS 本地缓存（离线可用），否则走在线接口
  function initTxt() {
    cleanupPreviousViewer();
    dom.viewerDiv.style.display = 'none';

    var txtReader = document.createElement('div');
    txtReader.className = 'txt-reader';
    txtReader.id = 'txtReader';
    txtReader.style.fontSize = fontSize + 'px';
    dom.readerArea.appendChild(txtReader);

    txtOffline = null;
    offlineActive = false;

    if (OPFS && OPFS.isSupported && txtPagination) {
      return OPFS.getCached(String(PARAM_BOOK_ID)).then(function (cached) {
        if (!cached || !cached.file) return initTxtOnline(txtReader);
        return cached.file.text().then(function (text) {
          var built = txtPagination.buildPages(text);
          offlineActive = true;
          txtOffline = {
            text: text,
            lines: built.lines,
            pages: built.pages,
            totalPages: built.totalPages,
            toc: built.toc
          };
          txtTotalPages = built.totalPages;
          txtPageNum = 1;
          return initTxtOfflineView();
        });
      }).catch(function (err) {
        console.warn('OPFS TXT offline load failed, fallback to online:', err);
        txtOffline = null;
        offlineActive = false;
        return initTxtOnline(txtReader);
      });
    }
    return initTxtOnline(txtReader);
  }

  // TXT 离线视图：从本地构建的 pages/toc 渲染
  function initTxtOfflineView() {
    return (OPFS && OPFS.isSupported ? OPFS.getToc(String(PARAM_BOOK_ID)) : Promise.resolve(null))
      .then(function (savedToc) {
        if (savedToc && savedToc.length) {
          tocData = savedToc.map(function (it, i) {
            return { label: it.title || '', href: '#ch-' + i, depth: it.level || 0, page: it.startPage || i + 1 };
          });
        } else {
          tocData = (txtOffline.toc || []).map(function (it, i) {
            return { label: it.title || '', href: '#ch-' + i, depth: it.level || 0, page: it.startPage || i + 1 };
          });
        }
        renderToc();
      })
      .then(function () {
        highlights = [];
        renderHighlightsList();
        dom.pageDivider.style.display = '';
        dom.pagePrevBtn.style.display = '';
        dom.pageNextBtn.style.display = '';
        dom.pageIndicator.style.display = 'inline-block';
        bindTxtHighlightHandlers(document.getElementById('txtReader'));
        return renderTxtPage(txtPageNum);
      })
      .then(function () {
        hideLoading();
        viewer = { type: 'txt' };
        showToast('离线模式 · 已从本地缓存加载');
        updateOfflineUi();
      })
      .catch(function (err) {
        var reader = document.getElementById('txtReader');
        if (reader) {
          reader.innerHTML = '<p style="color:var(--danger);text-align:center;padding:40px;">离线加载失败: ' + escapeHtml(err.message) + '</p>';
        }
        hideLoading();
        viewer = { type: 'txt' };
      });
  }

  // TXT 在线视图：服务端分页接口（原有逻辑），网络可用时后台把整本写入 OPFS
  function initTxtOnline(txtReader) {
    return Promise.all([
      fetch(TXT_INFO_URL).then(function (r) { return r.json(); }),
      fetch(TOC_URL).then(function (r) { return r.json(); }),
      fetch(HIGHLIGHTS_URL).then(function (r) { return r.json(); }).catch(function () {
        return { success: false, data: [] };
      })
    ]).then(function (results) {
      var infoResp = results[0];
      var tocResp = results[1];
      var highlightsResp = results[2];
      if (!infoResp.success) throw new Error(infoResp.message || 'Failed');
      var info = infoResp.data;
      txtTotalPages = Math.max(1, info.totalPages || 1);
      txtPageNum = 1;
      highlights = highlightsResp && highlightsResp.success && Array.isArray(highlightsResp.data)
        ? highlightsResp.data
        : [];
      renderHighlightsList();

      tocData = [];
      if (tocResp.success && tocResp.data && tocResp.data.length) {
        tocData = tocResp.data.map(function (it, i) {
          return {
            label: it.title || '',
            href: '#ch-' + i,
            depth: it.level || 0,
            page: it.startPage || i + 1
          };
        });
      }
      renderToc();

      if (PARAM_TOC_HREF) {
        var m = PARAM_TOC_HREF.match(/#?ch-(\d+)/);
        if (m && tocData[parseInt(m[1], 10)]) {
          txtPageNum = Math.min(Math.max(1, tocData[parseInt(m[1], 10)].page), txtTotalPages);
        }
      }
      if (!PARAM_TOC_HREF) {
        var saved = loadProgress();
        if (saved && saved.page) {
          txtPageNum = Math.min(Math.max(1, saved.page), txtTotalPages);
        }
      }

      dom.pageDivider.style.display = '';
      dom.pagePrevBtn.style.display = '';
      dom.pageNextBtn.style.display = '';
      dom.pageIndicator.style.display = 'inline-block';
      bindTxtHighlightHandlers(txtReader);
      return renderTxtPage(txtPageNum);
    }).then(function () {
      hideLoading();
      viewer = { type: 'txt' };
      // 在线时后台把整本 TXT 写入 OPFS，供下次离线阅读；同时保存目录快照
      if (OPFS && OPFS.isSupported) {
        if (tocData && tocData.length) {
          var savedToc = tocData.map(function (it) {
            return {
              title: it.label || '',
              chapterIndex: 0,
              startPage: it.page || null,
              href: null,
              level: it.depth || 0
            };
          });
          OPFS.saveToc(String(PARAM_BOOK_ID), savedToc);
        }
        fetch(STREAM_URL)
          .then(function (resp) {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return resp.text();
          })
          .then(function (text) {
            return OPFS.cacheText(String(PARAM_BOOK_ID), text, getBookMeta());
          })
          .catch(function (err) {
            console.warn('OPFS TXT cache failed:', err);
          });
      }
    }).catch(function (err) {
      txtReader.innerHTML = '<p style="color:var(--danger);text-align:center;padding:40px;">加载失败: ' + escapeHtml(err.message) + '</p>';
      hideLoading();
      viewer = { type: 'txt' };
    });
  }

  // 渲染 TXT 指定页码（离线优先走本地分页）
  function renderTxtPage(page) {
    page = Math.min(Math.max(1, page), Math.max(1, txtTotalPages));
    txtPageNum = page;
    var txtReader = document.getElementById('txtReader');
    if (!txtReader) return Promise.resolve();
    if (txtOffline) return renderOfflineTxtPage(txtReader, page);
    return fetch(txtPageUrl(page))
      .then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      })
      .then(function (resp) {
        if (!resp.success) throw new Error(resp.message || 'Failed');
        var data = resp.data;
        txtTotalPages = Math.max(1, data.totalPages || txtTotalPages);
        var parsed = parseTxtToHtml(data.content || '');
        txtReader.innerHTML = parsed.html;
        applyTxtPageHighlights(txtReader, txtPageNum);
        txtReader.scrollTop = 0;
        updateTxtNavState();
        saveProgress({ page: txtPageNum, totalPages: txtTotalPages });
      });
  }

  // 离线 TXT 翻页渲染（本地构建的页码与服务端算法一致）
  function renderOfflineTxtPage(txtReader, page) {
    var content = txtPagination
      ? txtPagination.getPageText(txtOffline.lines, txtOffline.pages, page)
      : null;
    if (content == null) return Promise.resolve();
    var parsed = parseTxtToHtml(content);
    txtReader.innerHTML = parsed.html;
    applyTxtPageHighlights(txtReader, txtPageNum);
    txtReader.scrollTop = 0;
    updateTxtNavState();
    saveProgress({ page: txtPageNum, totalPages: txtOffline.totalPages });
    return Promise.resolve();
  }

  // 更新 TXT 翻页按钮状态
  function updateTxtNavState() {
    dom.pagePrevBtn.disabled = txtPageNum <= 1;
    dom.pageNextBtn.disabled = txtPageNum >= txtTotalPages;
    if (dom.pageIndicator) {
      dom.pageIndicator.textContent = txtPageNum + ' / ' + txtTotalPages;
    }
  }

  // TXT 上一页
  function txtPrevPage() {
    if (txtPageNum > 1) renderTxtPage(txtPageNum - 1);
  }

  // TXT 下一页
  function txtNextPage() {
    if (txtPageNum < txtTotalPages) renderTxtPage(txtPageNum + 1);
  }

  // 解析TXT文本为HTML（识别章节标题）
  function parseTxtToHtml(text) {
    var lines = text.split(/\r?\n/);
    var chapters = [];
    var html = '';
    var chapterIndex = 0;
    var currentChapter = null;

    var chapterRegex = /^(第[零一二三四五六七八九十百千万\d]+[章节回卷部篇]|Chapter\s+\d+|CHAPTER\s+\d+|序言|前言|楔子|尾声|后记|附录).*/;

    lines.forEach(function (line) {
      var trimmed = line.trim();
      if (!trimmed) {
        html += '<br>';
        return;
      }

      if (chapterRegex.test(trimmed) && trimmed.length < 100) {
        if (currentChapter) chapters.push(currentChapter);
        chapterIndex++;
        currentChapter = { title: trimmed, index: chapterIndex - 1 };
        html += '<h2 class="txt-chapter-header" id="ch-' + (chapterIndex - 1) + '">' + escapeHtml(trimmed) + '</h2>';
      } else {
        html += '<p class="txt-paragraph">' + escapeHtml(trimmed) + '</p>';
      }
    });

    if (currentChapter) chapters.push(currentChapter);
    return { html: html, chapters: chapters };
  }

  /* ================================================================
     Initialization — 阅读器初始化
     ================================================================ */
  // 主初始化流程：获取元数据→确定格式→初始化对应阅读器
  function init() {
    if (!PARAM_BOOK_ID) {
      showError('缺少 bookId 参数。<br>请从书架页面打开书籍。');
      return;
    }

    // 恢复在线后先补传离线期间排队的阅读进度
    // （pwa.js 为 defer 脚本，DOMContentLoaded 后才可用，故用事件监听兜底）
    if (window.WebraryPWA) window.WebraryPWA.flushProgress();
    window.addEventListener('DOMContentLoaded', function () {
      if (window.WebraryPWA) window.WebraryPWA.flushProgress();
    });

    showLoading('加载书籍信息...');

    // Fetch metadata
    fetch(META_URL)
      .then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      })
      .then(function (meta) {
        metadata = meta;
      })
      .catch(function () {
        // Fallback to query params
        metadata = {
          title: PARAM_TITLE || '未知书籍',
          author: PARAM_AUTHOR || '',
          extension: PARAM_EXT || ''
        };
      })
      .then(function () {
        var ext = (metadata.extension || PARAM_EXT || '').toLowerCase();
        var title = metadata.title || PARAM_TITLE || '未命名书籍';
        var author = metadata.author || PARAM_AUTHOR || '';
        updateToolbarMeta(title, author);
        document.title = title + ' — BookReader';

        currentFormat = getFormat(ext);
        showLoading('加载中...');

        updateOfflineUi();

        switch (currentFormat) {
          case 'epub':
            return initEpub().catch(function (err) {
              console.error('ePub init error:', err);
              showError('无法打开此书（' + ext + ' 格式）。<br>请确认文件格式正确或尝试从书架重新打开。');
            });
          case 'pdf':
            return initPdf().catch(function (err) {
              console.error('PDF init error:', err);
              showError('PDF 加载失败。<br>' + escapeHtml(err.message || ''));
            });
          case 'txt':
            return initTxt();
          default:
            showError('不支持的格式: ' + ext);
            return;
        }
      })
      .catch(function (err) {
        console.error('Reader init error:', err);
        showError('加载失败: ' + escapeHtml(err.message || '未知错误'));
      });
  }

  function isInteractiveElement(el) {
    if (!el || !el.closest) return false;
    return !!el.closest(
      'a[href], button, input, textarea, select, [contenteditable="true"], [role="link"]'
    );
  }

  function pageDirectionFromClick(x, width) {
    if (!width || x < 0) return null;
    var ratio = x / width;
    if (ratio < 0.35) return true;   // left edge: previous page
    if (ratio > 0.65) return false;  // right edge: next page
    return null;
  }

  function doPage(isPrev) {
    if (currentFormat === 'pdf') {
      if (isPrev) pdfPrevPage(); else pdfNextPage();
    } else if (currentFormat === 'epub' && viewer && viewer.rendition) {
      if (isPrev) viewer.rendition.prev(); else viewer.rendition.next();
    } else if (currentFormat === 'txt') {
      if (isPrev) txtPrevPage(); else txtNextPage();
    }
  }

  function handleReaderPoint(clientX) {
    var rect = dom.readerArea.getBoundingClientRect();
    var dir = pageDirectionFromClick(clientX - rect.left, rect.width);
    if (dir !== null) {
      doPage(dir);
      scheduleToolbarHide();
    } else {
      toggleToolbar();
    }
  }

  function handleReaderAreaClick(e) {
    if (currentFormat === 'epub' || e.defaultPrevented || isInteractiveElement(e.target)) return;
    if (Date.now() - lastSwipeAt < 600 || Date.now() - lastTouchTapAt < 400) return;
    if (isHighlightPopupOpen() || Date.now() - popupHiddenAt < 300) return;
    if (currentFormat === 'pdf' && Date.now() - pdfToggleAt < 600) return;
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    handleReaderPoint(e.clientX);
  }

  var swipeStart = null;
  var swipeTriggered = false;

  function attachSwipeHandlers(target) {
    if (!target || target.__webrarySwipeBound) return;
    target.__webrarySwipeBound = true;

    function clearSwipe() {
      swipeStart = null;
      swipeTriggered = false;
    }

    target.addEventListener('touchstart', function (e) {
      clearSwipe();
      if (dom.tocSidebar.classList.contains('open') || dom.settingsOverlay.classList.contains('open')) return;
      if (isHighlightPopupOpen()) return;
      if (isInteractiveElement(e.target)) return;
      var touch = e.touches && e.touches[0];
      if (!touch) return;
      swipeStart = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    }, true);

    target.addEventListener('touchmove', function (e) {
      // 长按选择文字期间：不响应滑动翻页，避免选区拖拽触发翻页
      if (tapSelecting) return;
      if (!swipeStart || swipeTriggered) return;
      var touch = e.touches && e.touches[0];
      if (!touch) return;
      var dx = touch.clientX - swipeStart.x;
      var dy = touch.clientY - swipeStart.y;
      if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
      var rect = dom.readerArea.getBoundingClientRect();
      var threshold = Math.max(64, rect.width * 0.16);
      if (Math.abs(dx) >= threshold && Math.abs(dx) > Math.abs(dy) * 1.2) {
        swipeTriggered = true;
        swipeStart.direction = dx > 0 ? 'right' : 'left';
        if (e.cancelable) e.preventDefault();
      }
    }, true);

    target.addEventListener('touchend', function (e) {
      // 长按选择文字结束：忽略本次触摸的翻页
      if (tapSelecting) {
        clearSwipe();
        return;
      }
      if (!swipeStart || !swipeTriggered) {
        clearSwipe();
        return;
      }
      var direction = swipeStart.direction;
      var duration = Date.now() - swipeStart.time;
      lastSwipeAt = Date.now();
      clearSwipe();
      if (duration > 700) return;
      if (e.cancelable) e.preventDefault();
      doPage(direction === 'right');
    }, true);

    target.addEventListener('touchcancel', clearSwipe, true);
  }

  /* ================================================================
     移动端翻页热区 — 三种模式（默认 / 双侧下一页 / L形触控）
     长按文字时遮罩自动让位，原生选区可穿透到正文；短按按模式翻页/唤起菜单
     ================================================================ */
  var TAP_MODE_KEY = 'webrary-tap-mode';
  var TAP_PREVIEW_KEY = 'webrary-tap-preview';

  // 读取热区模式（设置页写入 localStorage）；非法值回退默认
  function getTapMode() {
    var m = 'default';
    try {
      var v = localStorage.getItem(TAP_MODE_KEY);
      if (v === 'default' || v === 'side-next' || v === 'l-shape') m = v;
    } catch (e) { /* ignore */ }
    return m;
  }

  // 按当前模式重建热区子元素（各区域位置完全由 CSS 按 .tap-mode-* 控制）
  function buildTapZones(layer) {
    ['tap-mode-default', 'tap-mode-side-next', 'tap-mode-l-shape'].forEach(function (c) {
      layer.classList.remove(c);
    });
    layer.querySelectorAll('.reader-tap-zone').forEach(function (z) { z.remove(); });

    var mode = getTapMode();
    layer.classList.add('tap-mode-' + mode);

    var specs = []; // { cls, label }
    if (mode === 'side-next') {
      // 图1 双侧下一页：左右大面积极下一页，底部中间窄条上一页，正中菜单
      specs.push({ cls: 'tap-next first', label: '下一页' });
      specs.push({ cls: 'tap-prev', label: '上一页' });
      specs.push({ cls: 'tap-toggle', label: '菜单' });
      specs.push({ cls: 'tap-next last', label: '下一页' });
    } else if (mode === 'l-shape') {
      // 图2 L形触控：上方1/3上一页，下方2/3下一页，正中菜单
      specs.push({ cls: 'tap-prev', label: '上一页' });
      specs.push({ cls: 'tap-next', label: '下一页' });
      specs.push({ cls: 'tap-toggle', label: '菜单' });
    } else {
      // 默认：左 上一页 / 中 菜单 / 右 下一页
      specs.push({ cls: 'tap-prev', label: '上一页' });
      specs.push({ cls: 'tap-toggle', label: '菜单' });
      specs.push({ cls: 'tap-next', label: '下一页' });
    }
    specs.forEach(function (s) {
      var zone = document.createElement('div');
      zone.className = 'reader-tap-zone ' + s.cls;
      zone.setAttribute('data-label', s.label);
      layer.appendChild(zone);
    });
  }

  // 取消进行中的按压检测；keepState=true 仅清定时器（供滑动时保留状态标记）
  function cancelTapPress(keepState) {
    if (!tapPressState) return;
    if (tapPressState.timer) {
      window.clearTimeout(tapPressState.timer);
      tapPressState.timer = null;
    }
    if (!keepState) tapPressState = null;
  }

  // 绑定热区交互：短按翻页/唤起菜单；长按（约0.4s不动）隐藏遮罩让原生选区穿透
  function bindTapLayer(layer) {
    layer.addEventListener('click', function (e) {
      var zone = e.target.closest('.reader-tap-zone');
      if (!zone || e.defaultPrevented) return;
      if (Date.now() - lastSwipeAt < 600) return;
      if (Date.now() - lastLongPressAt < 900) return; // 刚长按完，忽略伴随 click
      e.preventDefault();
      e.stopPropagation();
      lastTouchTapAt = Date.now();
      if (zone.classList.contains('tap-prev')) {
        doPage(true);
      } else if (zone.classList.contains('tap-next')) {
        doPage(false);
      } else {
        toggleToolbar();
      }
    });

    layer.addEventListener('touchstart', function (e) {
      if (!layer.classList.contains('active')) return;
      var touch = e.touches && e.touches[0];
      if (!touch) return;
      cancelTapPress();
      var press = { x: touch.clientX, y: touch.clientY, timer: null, moved: false, longPressed: false };
      press.timer = window.setTimeout(function () {
        if (press.moved) return;
        press.longPressed = true;
        tapSelecting = true;
        lastLongPressAt = Date.now();
        // 让位：隐藏遮罩后，系统长按选区才落到下方正文，而不是选中遮罩本身
        layer.classList.add('long-press');
      }, 400);
      tapPressState = press;
    }, true);

    layer.addEventListener('touchmove', function (e) {
      if (!tapPressState) return;
      var touch = e.touches && e.touches[0];
      if (!touch) return;
      var dx = Math.abs(touch.clientX - tapPressState.x);
      var dy = Math.abs(touch.clientY - tapPressState.y);
      if (dx > 18 || dy > 18) {
        // 滑动/滚动：取消长按判定（保留状态防止误判）
        tapPressState.moved = true;
        cancelTapPress(true);
      }
    }, true);

    // touchend/touchcancel 绑定在 document：长按期间遮罩可能已 display:none，
    // 事件仍派发给 touchstart 的目标（遮罩），此处统一恢复遮罩显示
    if (!tapLayerDocBound) {
      tapLayerDocBound = true;
      document.addEventListener('touchend', function () {
        if (!tapPressState) return;
        var press = tapPressState;
        cancelTapPress();
        if (press.longPressed) {
          tapSelecting = false;
          var l = dom.readerArea.querySelector('.reader-tap-layer');
          if (l) l.classList.remove('long-press');
        }
      }, true);
      document.addEventListener('touchcancel', function () {
        if (!tapPressState) return;
        var press = tapPressState;
        cancelTapPress();
        if (press.longPressed) {
          tapSelecting = false;
          var l = dom.readerArea.querySelector('.reader-tap-layer');
          if (l) l.classList.remove('long-press');
        }
      }, true);
    }
  }

  // 设置页切换热区模式后：下次打开书籍展示各区域浅色透明颜色 4 秒
  function maybeShowTapPreview(layer) {
    var due = false;
    try {
      var at = parseInt(localStorage.getItem(TAP_PREVIEW_KEY) || '0', 10);
      due = at > 0 && (Date.now() - at) < 3600 * 1000; // 1 小时内切换过才展示
      if (due) localStorage.removeItem(TAP_PREVIEW_KEY);
    } catch (e) { /* ignore */ }
    if (!due || !layer) return;
    layer.classList.add('preview', 'on');
    window.setTimeout(function () {
      layer.classList.remove('on');
      window.setTimeout(function () { layer.classList.remove('preview'); }, 400);
    }, 4000);
  }

  // 阅读器打开期间设置在另一标签页被切换：storage 事件实时重建热区
  function watchTapModeChanges() {
    if (tapModeWatchBound) return;
    tapModeWatchBound = true;
    window.addEventListener('storage', function (e) {
      if (!e || (e.key !== TAP_MODE_KEY && e.key !== TAP_PREVIEW_KEY)) return;
      var layer = dom.readerArea.querySelector('.reader-tap-layer');
      if (!layer || !layer.classList.contains('active')) return;
      buildTapZones(layer);
      if (e.key === TAP_PREVIEW_KEY) maybeShowTapPreview(layer);
    });
  }

  function ensureEpubTapOverlay() {
    if (!window.matchMedia || !window.matchMedia('(pointer: coarse)').matches) return;
    var existing = dom.readerArea.querySelector('.reader-tap-layer');
    if (existing) {
      existing.classList.add('active');
      return;
    }
    var layer = document.createElement('div');
    layer.className = 'reader-tap-layer';
    buildTapZones(layer);
    bindTapLayer(layer);
    dom.readerArea.appendChild(layer);
    layer.classList.add('active');
    watchTapModeChanges();
    maybeShowTapPreview(layer);
  }

  function bindEpubTapListeners() {
    if (!viewer || !viewer.rendition) return;
    ensureEpubTapOverlay();
  }

  /* ================================================================
     Event Bindings — 事件绑定
     ================================================================ */
  // 绑定所有阅读器事件监听器
  function bindEvents() {
    // 目录侧边栏
    dom.tocBtn.addEventListener('click', function () {
      switchSidebarTab('toc');
      toggleToc();
    });
    dom.tocOverlay.addEventListener('click', closeToc);
    dom.tocClose.addEventListener('click', closeToc);

    // 摘抄侧栏
    dom.highlightsBtn.addEventListener('click', function () {
      openToc();
      switchSidebarTab('highlights');
    });
    dom.tocTabBtn.addEventListener('click', function () { switchSidebarTab('toc'); });
    dom.highlightsTabBtn.addEventListener('click', function () { switchSidebarTab('highlights'); });

    // 摘抄项点击→跳转
    dom.highlightsList.addEventListener('click', function (e) {
      var del = e.target.closest('.highlight-delete');
      if (del) {
        var delIdx = parseInt(del.dataset.index, 10);
        var delHl = highlights[delIdx];
        if (delHl) deleteHighlight(delHl);
        return;
      }
      var item = e.target.closest('.highlight-item');
      if (!item) return;
      var idx = parseInt(item.dataset.index, 10);
      var hl = highlights[idx];
      if (!hl) return;
      if (hl.format === 'epub') jumpToEpubHighlight(hl);
      else if (hl.format === 'pdf') jumpToPdfHighlight(hl);
      else jumpToTxtHighlight(hl);
    });

    // 摘抄颜色弹窗
    dom.highlightPopup.addEventListener('click', function (e) {
      var swatch = e.target.closest('.hl-swatch');
      if (!swatch) return;
      savePendingHighlight(swatch.dataset.color);
    });
    document.addEventListener('mousedown', function (e) {
      if (Date.now() - lastTouchEndAt < 500) return;
      if (dom.highlightPopup.contains(e.target)) return;
      hideHighlightPopup();
    });
    document.addEventListener('touchend', function () {
      lastTouchEndAt = Date.now();
    }, true);
    document.addEventListener('touchcancel', function () {
      lastTouchEndAt = Date.now();
    }, true);
    document.addEventListener('click', function (e) {
      if (dom.highlightPopup.contains(e.target)) return;
      if (suppressPopupClick) {
        suppressPopupClick = false;
        return;
      }
      if (Date.now() - popupShownAt < 500) return;
      hideHighlightPopup();
    });

    // 设置面板
    dom.settingsBtn.addEventListener('click', toggleSettings);
    dom.settingsOverlay.addEventListener('click', closeSettings);
    dom.settingsClose.addEventListener('click', closeSettings);

    // 工具栏交互后重置自动隐藏计时
    dom.toolbar.addEventListener('click', function () {
      scheduleToolbarHide();
    }, true);

    // 缓存到本地 / 删除离线缓存按钮
    var cacheBookBtn = document.getElementById('cacheBookBtn');
    if (cacheBookBtn) {
      cacheBookBtn.addEventListener('click', function () {
        if (!OPFS || !OPFS.isSupported) {
          showToast('当前浏览器不支持 OPFS 离线缓存');
          return;
        }
        OPFS.isCached(String(PARAM_BOOK_ID)).then(function (cached) {
          if (cached) {
            OPFS.removeBook(String(PARAM_BOOK_ID)).then(function () {
              showToast('已删除离线缓存');
              updateOfflineUi();
            }).catch(function (err) {
              showToast('删除失败: ' + (err && err.message ? err.message : err));
            });
          } else {
            cacheCurrentBook().catch(function () { /* toast already shown */ });
          }
        }).catch(function () { /* ignore */ });
      });
    }

    // 阅读模式选择
    dom.readingModeGroup.addEventListener('click', function (e) {
      var btn = e.target.closest('.option-btn');
      if (!btn) return;
      setReadingMode(btn.dataset.value);
    });

    // 页面适配方式选择
    dom.pageFitGroup.addEventListener('click', function (e) {
      var btn = e.target.closest('.option-btn');
      if (!btn) return;
      setPageFit(btn.dataset.value);
    });

    // 预加载页数设置
    dom.preloadInput.addEventListener('change', function () {
      var val = parseInt(dom.preloadInput.value, 10);
      if (isNaN(val)) val = 0;
      val = Math.max(0, Math.min(10, val));
      dom.preloadInput.value = val;
      if (readerSettings.preloadCount === val) return;
      readerSettings.preloadCount = val;
      saveSettings();
      if (currentFormat === 'pdf') renderPdfViewport(pdfCurrentStartPage);
    });

    // 目录项点击→跳转到对应章节
    dom.tocList.addEventListener('click', function (e) {
      var item = e.target.closest('.toc-item');
      if (!item) return;
      var href = item.dataset.href;

      if (currentFormat === 'epub' && viewer && viewer.rendition) {
        if (href) {
          viewer.rendition.display(href);
        }
      } else if (currentFormat === 'pdf') {
        var idx = item ? parseInt(item.dataset.index) : -1;
        if (idx >= 0 && tocData[idx] && tocData[idx].page) {
          renderPdfViewport(tocData[idx].page);
        } else if (href) {
          var page = href.replace('#page-', '');
          if (page) renderPdfViewport(parseInt(page, 10));
        }
      } else if (currentFormat === 'txt') {
        var idx = item ? parseInt(item.dataset.index) : -1;
        if (idx >= 0 && tocData[idx] && tocData[idx].page) {
          renderTxtPage(tocData[idx].page);
        }
      }
      closeToc();
    });

    // 字体大小调节按钮
    dom.fontSizeDown.addEventListener('click', function () { changeFontSize(-1); });
    dom.fontSizeUp.addEventListener('click', function () { changeFontSize(1); });

    // 翻页导航按钮
    dom.pagePrevBtn.addEventListener('click', function () {
      if (currentFormat === 'pdf') pdfPrevPage();
      else if (currentFormat === 'epub' && viewer && viewer.rendition) viewer.rendition.prev();
      else if (currentFormat === 'txt') txtPrevPage();
    });
    dom.pageNextBtn.addEventListener('click', function () {
      if (currentFormat === 'pdf') pdfNextPage();
      else if (currentFormat === 'epub' && viewer && viewer.rendition) viewer.rendition.next();
      else if (currentFormat === 'txt') txtNextPage();
    });

    // 点击左右两侧翻页；中间区域和链接/按钮不拦截点击
    dom.readerArea.addEventListener('click', handleReaderAreaClick);
    attachSwipeHandlers(dom.readerArea);

    // 键盘快捷键：左右箭头翻页，Esc关闭面板
    document.addEventListener('keydown', function (e) {
      // Don't handle when focus is in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          if (currentFormat === 'pdf') pdfPrevPage();
          else if (currentFormat === 'epub' && viewer && viewer.rendition) viewer.rendition.prev();
          else if (currentFormat === 'txt') txtPrevPage();
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (currentFormat === 'pdf') pdfNextPage();
          else if (currentFormat === 'epub' && viewer && viewer.rendition) viewer.rendition.next();
          else if (currentFormat === 'txt') txtNextPage();
          break;
        case 'Escape':
          if (dom.tocSidebar.classList.contains('open')) {
            closeToc();
          } else if (dom.settingsOverlay.classList.contains('open')) {
            closeSettings();
          }
          break;
      }
    });

    // 页面卸载前清理 epub.js 资源
    window.addEventListener('beforeunload', function () {
      if (viewer && viewer.type === 'epub' && viewer.book) {
        try { viewer.book.destroy(); } catch (e) { /* ignore */ }
      }
    });
  }

  /* ================================================================
      Start — 启动入口
      ================================================================ */
  // 启动阅读器：加载设置→应用字体→绑定事件→初始化阅读器
  loadSettings();
  applyFontSize();
  hideHighlightPopup();
  bindEvents();
  init();
})();
