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
  var readerSettings = { readingMode: 'single', pageFit: 'width', preloadCount: 3 };  // 阅读器设置

  var HL_COLORS = {
    yellow: 'rgba(255, 213, 79, 0.55)',
    green: 'rgba(129, 199, 132, 0.55)',
    blue: 'rgba(144, 202, 249, 0.55)',
    pink: 'rgba(244, 143, 177, 0.55)'
  };

  /* ================================================================
      DOM References — DOM引用缓存
      ================================================================ */
  // 简化的querySelector别名
  function $(sel) { return document.querySelector(sel); }

  var dom = {
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
  }

  // 显示加载覆盖层
  function showLoading(msg) {
    if (!msg) msg = '加载中...';
    dom.loadingOverlay.classList.remove('hidden');
    dom.loadingOverlay.querySelector('.loading-text').textContent = msg;
  }

  // 显示错误信息
  function showError(msg) {
    dom.loadingOverlay.classList.add('hidden');
    dom.errorState.style.display = '';
    dom.errorMessage.innerHTML = msg;
    dom.tocBtn.disabled = true;
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

    fetch('/api/books/' + PARAM_BOOK_ID + '/progress', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPage: cp, totalPages: tp, finished: finished })
    }).catch(function () { /* ignore */ });
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
  }

  // 关闭设置面板
  function closeSettings() {
    dom.settingsOverlay.classList.remove('open');
    dom.settingsModal.style.display = 'none';
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
  }

  // 关闭目录侧边栏
  function closeToc() {
    dom.tocSidebar.classList.remove('open');
    dom.tocOverlay.classList.remove('open');
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
        }
      })
      .catch(function () {
        highlights = [];
        renderHighlightsList();
      });
  }

  function showHighlightPopup(x, y, info) {
    pendingHighlight = info;
    var popup = dom.highlightPopup;
    popup.style.display = 'flex';
    var w = popup.offsetWidth;
    var h = popup.offsetHeight;
    x = Math.max(12, Math.min(x, window.innerWidth - w - 12));
    y = Math.max(12, Math.min(y, window.innerHeight - h - 12));
    popup.style.left = x + 'px';
    popup.style.top = y + 'px';
  }

  function hideHighlightPopup() {
    dom.highlightPopup.style.display = 'none';
    pendingHighlight = null;
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
          renderTxtPage(txtPageNum);
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
    txtReader.addEventListener('touchend', function (e) {
      window.setTimeout(function () { maybeShowTxtPopup(e); }, 350);
    });
    txtReader.addEventListener('scroll', hideHighlightPopup, true);
  }

  function applyTxtHighlight(container, hl) {
    var start = hl.startOffset;
    var end = hl.endOffset;
    if (start == null || end == null || end <= start) return;
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
      var text = node.textContent;
      var mark = document.createElement('mark');
      mark.className = 'hl-' + (hl.color || 'yellow');
      mark.dataset.highlightId = String(hl.id);
      mark.textContent = text.slice(s, e);
      var frag = document.createDocumentFragment();
      if (s > 0) frag.appendChild(document.createTextNode(text.slice(0, s)));
      frag.appendChild(mark);
      if (e < len) frag.appendChild(document.createTextNode(text.slice(e)));
      node.parentNode.replaceChild(frag, node);
      return;
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

  function maybeShowEpubPopup(content) {
    var doc = content && content.document;
    if (!doc) return;
    var sel = doc.getSelection ? doc.getSelection() : null;
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    var range = sel.getRangeAt(0);
    var quote = (sel.toString() || '').trim();
    if (!quote) return;
    var rect = range.getBoundingClientRect();
    var iframeRect = content.iframe ? content.iframe.getBoundingClientRect() : { left: 0, top: 0 };
    var x = iframeRect.left + rect.left + rect.width / 2;
    var y = iframeRect.top + rect.bottom + 6;
    showHighlightPopup(x, y, { format: 'epub', range: range, quote: quote, content: content });
  }

  function bindEpubHighlightHandlers() {
    if (!viewer || !viewer.rendition) return;
    var contents = viewer.rendition.getContents();
    (contents || []).forEach(function (content) {
      var doc = content && content.document;
      if (!doc || doc.__webraryHlBound) return;
      doc.__webraryHlBound = true;
      doc.addEventListener('mouseup', function () { maybeShowEpubPopup(content); });
      doc.addEventListener('touchend', function () {
        window.setTimeout(function () { maybeShowEpubPopup(content); }, 350);
      });
      doc.addEventListener('click', function () { hideHighlightPopup(); });
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
  }

  /* ================================================================
     epub.js Viewer — EPUB/MOBI/AZW3/FB2 格式阅读器
     ================================================================ */
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
    return fetch(STREAM_URL)
      .then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.arrayBuffer();
      })
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
  function initPdf() {
    cleanupPreviousViewer();
    dom.viewerDiv.style.display = 'none';
    dom.highlightsBtn.disabled = true;

    var container = document.createElement('div');
    container.className = 'pdf-container';
    container.id = 'pdfContainer';
    dom.readerArea.appendChild(container);

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
        hideLoading();
        viewer = { type: 'pdf' };
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
  // 初始化 TXT 阅读器
  function initTxt() {
    cleanupPreviousViewer();
    dom.viewerDiv.style.display = 'none';

    var txtReader = document.createElement('div');
    txtReader.className = 'txt-reader';
    txtReader.id = 'txtReader';
    txtReader.style.fontSize = fontSize + 'px';
    dom.readerArea.appendChild(txtReader);

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
    }).catch(function (err) {
      txtReader.innerHTML = '<p style="color:var(--danger);text-align:center;padding:40px;">加载失败: ' + escapeHtml(err.message) + '</p>';
      hideLoading();
      viewer = { type: 'txt' };
    });
  }

  // 渲染 TXT 指定页码
  function renderTxtPage(page) {
    page = Math.min(Math.max(1, page), Math.max(1, txtTotalPages));
    txtPageNum = page;
    var txtReader = document.getElementById('txtReader');
    if (!txtReader) return Promise.resolve();
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

  function handleReaderAreaClick(e) {
    if (currentFormat === 'epub' || e.defaultPrevented || isInteractiveElement(e.target)) return;
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    var rect = dom.readerArea.getBoundingClientRect();
    var dir = pageDirectionFromClick(e.clientX - rect.left, rect.width);
    if (dir !== null) doPage(dir);
  }

  function handleEpubClick(e) {
    if (e.defaultPrevented || isInteractiveElement(e.target)) return;
    var rect = dom.readerArea.getBoundingClientRect();
    var topWin = window.top || window;
    var viewportLeft = topWin.screenX + ((topWin.outerWidth || 0) - (topWin.innerWidth || 0));
    if (typeof e.screenX !== 'number') return;
    var x = e.screenX - viewportLeft - rect.left;
    var dir = pageDirectionFromClick(x, rect.width);
    if (dir !== null) doPage(dir);
  }

  function bindEpubTapListeners() {
    if (!viewer || !viewer.rendition) return;
    var contents = viewer.rendition.getContents();
    (contents || []).forEach(function (content) {
      if (content && content.document && !content.document.__webraryTapBound) {
        content.document.__webraryTapBound = true;
        content.document.addEventListener('click', handleEpubClick, true);
      }
    });
  }

  /* ================================================================
     Event Bindings — 事件绑定
     ================================================================ */
  // 绑定所有阅读器事件监听器
  function bindEvents() {
    // 目录侧边栏
    dom.tocBtn.addEventListener('click', toggleToc);
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
      var item = e.target.closest('.highlight-item');
      if (!item) return;
      var idx = parseInt(item.dataset.index, 10);
      var hl = highlights[idx];
      if (!hl) return;
      if (hl.format === 'epub') jumpToEpubHighlight(hl);
      else jumpToTxtHighlight(hl);
    });

    // 摘抄颜色弹窗
    dom.highlightPopup.addEventListener('click', function (e) {
      var swatch = e.target.closest('.hl-swatch');
      if (!swatch) return;
      savePendingHighlight(swatch.dataset.color);
    });
    document.addEventListener('click', function (e) {
      if (dom.highlightPopup.contains(e.target)) return;
      hideHighlightPopup();
    });

    // 设置面板
    dom.settingsBtn.addEventListener('click', toggleSettings);
    dom.settingsOverlay.addEventListener('click', closeSettings);
    dom.settingsClose.addEventListener('click', closeSettings);

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
  bindEvents();
  init();
})();
