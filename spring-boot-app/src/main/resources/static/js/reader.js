/**
 * BookReader — In-browser ebook reader
 * Uses epub.js for EPUB/MOBI/AZW3/FB2, PDF.js for PDF, custom renderer for TXT.
 *
 * URL params: ?bookId=X&title=Title&author=Author&ext=epub
 */
(function () {
  'use strict';

  /* ================================================================
     Query Params
     ================================================================ */
  var params = new URLSearchParams(window.location.search);
  var PARAM_BOOK_ID = params.get('bookId');
  var PARAM_TITLE = params.get('title');
  var PARAM_AUTHOR = params.get('author');
  var PARAM_EXT = params.get('ext');
  var PARAM_TOC_HREF = params.get('tocHref');

  var STREAM_URL = '/api/books/' + PARAM_BOOK_ID + '/stream';
  var META_URL = '/api/books/' + PARAM_BOOK_ID;
  var TOC_URL = '/api/books/' + PARAM_BOOK_ID + '/toc';

  /* ================================================================
     State
     ================================================================ */
  var viewer = null;           // { type: 'epub'|'pdf'|'txt', book, rendition, ... }
  var metadata = null;
  var currentFormat = null;    // 'epub' | 'pdf' | 'txt'
  var fontSize = parseInt(localStorage.getItem('reader-font-size') || '18', 10);
  var tocData = [];
  var pdfPageNum = 1;
  var pdfTotalPages = 0;
  var pdfCurrentStartPage = 1;
  var readerSettings = { readingMode: 'single', pageFit: 'width' };

  /* ================================================================
     DOM References
     ================================================================ */
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
    tocOverlay: $('#tocOverlay'),
    tocSidebar: $('#tocSidebar'),
    tocList: $('#tocList'),
    tocClose: $('#tocClose'),
    fontSizeDisplay: $('#fontSizeDisplay'),
    fontSizeDown: $('#fontSizeDown'),
    fontSizeUp: $('#fontSizeUp'),
    pagePrevBtn: $('#pagePrevBtn'),
    pageNextBtn: $('#pageNextBtn'),
    pageDivider: $('#pageDivider'),
    settingsBtn: $('#settingsBtn'),
    settingsOverlay: $('#settingsOverlay'),
    settingsModal: $('#settingsModal'),
    settingsClose: $('#settingsClose'),
    readingModeGroup: $('#readingModeGroup'),
    pageFitGroup: $('#pageFitGroup'),
  };

  /* ================================================================
     Utilities
     ================================================================ */
  function hideLoading() {
    dom.loadingOverlay.classList.add('hidden');
  }

  function showLoading(msg) {
    if (!msg) msg = '加载中...';
    dom.loadingOverlay.classList.remove('hidden');
    dom.loadingOverlay.querySelector('.loading-text').textContent = msg;
  }

  function showError(msg) {
    dom.loadingOverlay.classList.add('hidden');
    dom.errorState.style.display = '';
    dom.errorMessage.innerHTML = msg;
    dom.tocBtn.disabled = true;
  }

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

  function updateToolbarMeta(title, author) {
    dom.toolbarTitle.textContent = title || '未命名书籍';
    if (author) {
      dom.toolbarAuthor.textContent = '— ' + author;
    } else {
      dom.toolbarAuthor.textContent = '';
    }
  }

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
  }

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
      Reader Settings
      ================================================================ */
  function loadSettings() {
    try {
      var raw = localStorage.getItem('reader-settings');
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed.readingMode) readerSettings.readingMode = parsed.readingMode;
        if (parsed.pageFit) readerSettings.pageFit = parsed.pageFit;
      }
    } catch (e) { /* ignore */ }
  }

  function saveSettings() {
    try {
      localStorage.setItem('reader-settings', JSON.stringify(readerSettings));
    } catch (e) { /* ignore */ }
  }

  function openSettings() {
    dom.settingsOverlay.classList.add('open');
    dom.settingsModal.style.display = '';
    applySettingsToUI();
  }

  function closeSettings() {
    dom.settingsOverlay.classList.remove('open');
    dom.settingsModal.style.display = 'none';
  }

  function toggleSettings() {
    if (dom.settingsOverlay.classList.contains('open')) {
      closeSettings();
    } else {
      openSettings();
    }
  }

  function applySettingsToUI() {
    var modeBtns = dom.readingModeGroup.querySelectorAll('.option-btn');
    modeBtns.forEach(function (btn) {
      btn.classList.toggle('selected', btn.dataset.value === readerSettings.readingMode);
    });
    var fitBtns = dom.pageFitGroup.querySelectorAll('.option-btn');
    fitBtns.forEach(function (btn) {
      btn.classList.toggle('selected', btn.dataset.value === readerSettings.pageFit);
    });
  }

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

  function setPageFit(fit) {
    if (readerSettings.pageFit === fit) return;
    readerSettings.pageFit = fit;
    saveSettings();
    applySettingsToUI();
    if (currentFormat === 'pdf') {
      renderPdfViewport(pdfCurrentStartPage);
    }
  }

  function getStepSize() {
    return readerSettings.readingMode === 'double' ? 2 : 1;
  }

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
     TOC Sidebar
     ================================================================ */
  function openToc() {
    dom.tocSidebar.classList.add('open');
    dom.tocOverlay.classList.add('open');
  }

  function closeToc() {
    dom.tocSidebar.classList.remove('open');
    dom.tocOverlay.classList.remove('open');
  }

  function toggleToc() {
    if (dom.tocSidebar.classList.contains('open')) {
      closeToc();
    } else {
      openToc();
    }
  }

  /**
   * Flatten epub.js nested TOC into a linear array of { label, href, depth }.
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

  function buildTocFromChapters(chapters) {
    return chapters.map(function (ch, i) {
      return {
        label: ch.title,
        href: '#ch-' + i,
        depth: 0,
        index: i
      };
    });
  }

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

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* ================================================================
     Font Size
     ================================================================ */
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

  function changeFontSize(delta) {
    var newSize = fontSize + delta;
    if (newSize < 10 || newSize > 36) return;
    fontSize = newSize;
    applyFontSize();
  }

  /* ================================================================
     Cleanup — remove old viewer elements
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
     epub.js Viewer (EPUB, MOBI, AZW3, FB2)
     ================================================================ */
  function initEpub() {
    if (typeof ePub === 'undefined') {
      showError('epub.js 库未加载。<br>请检查 /vendor/epub.min.js 是否存在。');
      return Promise.reject(new Error('ePub not available'));
    }

    cleanupPreviousViewer();
    dom.viewerDiv.style.display = '';

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
     PDF.js Viewer
     ================================================================ */
  function initPdf() {
    cleanupPreviousViewer();
    dom.viewerDiv.style.display = 'none';

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
        hideLoading();
        viewer = { type: 'pdf' };
      })
      .catch(function (err) {
        showError('PDF 加载失败: ' + escapeHtml(err.message || ''));
      });
  }

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
    });
  }

  function updatePdfNavState() {
    var step = getStepSize();
    dom.pagePrevBtn.disabled = pdfCurrentStartPage <= 1;
    dom.pageNextBtn.disabled = pdfCurrentStartPage + step > pdfTotalPages;
  }

  function pdfPrevPage() {
    var step = getStepSize();
    if (pdfCurrentStartPage > 1) {
      renderPdfViewport(Math.max(1, pdfCurrentStartPage - step));
    }
  }

  function pdfNextPage() {
    var step = getStepSize();
    if (pdfCurrentStartPage + step <= pdfTotalPages) {
      renderPdfViewport(pdfCurrentStartPage + step);
    }
  }

  /* ================================================================
     TXT Viewer
     ================================================================ */
  function initTxt() {
    cleanupPreviousViewer();
    dom.viewerDiv.style.display = 'none';

    var txtReader = document.createElement('div');
    txtReader.className = 'txt-reader';
    txtReader.id = 'txtReader';
    txtReader.style.fontSize = fontSize + 'px';
    dom.readerArea.appendChild(txtReader);

    return fetch(STREAM_URL).then(function (resp) {
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return resp.text();
    }).then(function (text) {
      var parsed = parseTxtToHtml(text);
      txtReader.innerHTML = parsed.html;
      tocData = buildTocFromChapters(parsed.chapters);
      renderToc();

      var saved = loadProgress();
      if (saved && saved.scrollTop) {
        txtReader.scrollTop = saved.scrollTop;
      }

      txtReader.addEventListener('scroll', function () {
        saveProgress({ scrollTop: txtReader.scrollTop, scrollHeight: txtReader.scrollHeight });
      });

      hideLoading();
      viewer = { type: 'txt' };
    }).catch(function (err) {
      txtReader.innerHTML = '<p style="color:var(--danger);text-align:center;padding:40px;">加载失败: ' + escapeHtml(err.message) + '</p>';
      hideLoading();
      viewer = { type: 'txt' };
    });
  }

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
     Initialization
     ================================================================ */
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

  /* ================================================================
     Event Bindings
     ================================================================ */
  function bindEvents() {
    // TOC
    dom.tocBtn.addEventListener('click', toggleToc);
    dom.tocOverlay.addEventListener('click', closeToc);
    dom.tocClose.addEventListener('click', closeToc);

    // Settings
    dom.settingsBtn.addEventListener('click', toggleSettings);
    dom.settingsOverlay.addEventListener('click', closeSettings);
    dom.settingsClose.addEventListener('click', closeSettings);

    dom.readingModeGroup.addEventListener('click', function (e) {
      var btn = e.target.closest('.option-btn');
      if (!btn) return;
      setReadingMode(btn.dataset.value);
    });

    dom.pageFitGroup.addEventListener('click', function (e) {
      var btn = e.target.closest('.option-btn');
      if (!btn) return;
      setPageFit(btn.dataset.value);
    });

    // TOC item clicks
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
      } else if (currentFormat === 'txt' && href) {
        var target = document.getElementById(href.replace('#', ''));
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
      closeToc();
    });

    // Font size
    dom.fontSizeDown.addEventListener('click', function () { changeFontSize(-1); });
    dom.fontSizeUp.addEventListener('click', function () { changeFontSize(1); });

    // Page navigation buttons
    dom.pagePrevBtn.addEventListener('click', function () {
      if (currentFormat === 'pdf') pdfPrevPage();
      else if (currentFormat === 'epub' && viewer && viewer.rendition) viewer.rendition.prev();
    });
    dom.pageNextBtn.addEventListener('click', function () {
      if (currentFormat === 'pdf') pdfNextPage();
      else if (currentFormat === 'epub' && viewer && viewer.rendition) viewer.rendition.next();
    });

    // Tap-zone page turning (click/touch on left/right edges)
    (function () {
      var tapStartX = 0, tapStartY = 0, tapStartTime = 0;
      var suppressMouse = false;

      var zoneL = document.createElement('div');
      zoneL.className = 'reader-tap-zone reader-tap-left';
      var zoneR = document.createElement('div');
      zoneR.className = 'reader-tap-zone reader-tap-right';
      dom.readerArea.appendChild(zoneL);
      dom.readerArea.appendChild(zoneR);

      function doPage(isPrev) {
        if (currentFormat === 'pdf') {
          if (isPrev) pdfPrevPage(); else pdfNextPage();
        } else if (currentFormat === 'epub' && viewer && viewer.rendition) {
          if (isPrev) viewer.rendition.prev(); else viewer.rendition.next();
        }
      }

      function bindZone(el, isPrev) {
        // Mouse
        el.addEventListener('mousedown', function (e) {
          if (suppressMouse) return;
          tapStartX = e.clientX; tapStartY = e.clientY; tapStartTime = Date.now();
        });
        el.addEventListener('mouseup', function (e) {
          if (suppressMouse) return;
          var dt = Date.now() - tapStartTime;
          var dx = Math.abs(e.clientX - tapStartX);
          var dy = Math.abs(e.clientY - tapStartY);
          if (dt < 300 && dx < 10 && dy < 10) doPage(isPrev);
        });
        // Touch
        el.addEventListener('touchstart', function (e) {
          var t = e.touches[0];
          tapStartX = t.clientX; tapStartY = t.clientY; tapStartTime = Date.now();
        }, { passive: true });
        el.addEventListener('touchend', function () {
          if (Date.now() - tapStartTime < 300) doPage(isPrev);
          // Suppress synthesized mouse events after touch
          suppressMouse = true;
          setTimeout(function () { suppressMouse = false; }, 400);
        });
      }
      bindZone(zoneL, true);
      bindZone(zoneR, false);
    })();

    // Keyboard shortcuts
    document.addEventListener('keydown', function (e) {
      // Don't handle when focus is in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          if (currentFormat === 'pdf') pdfPrevPage();
          else if (currentFormat === 'epub' && viewer && viewer.rendition) viewer.rendition.prev();
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (currentFormat === 'pdf') pdfNextPage();
          else if (currentFormat === 'epub' && viewer && viewer.rendition) viewer.rendition.next();
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

    // Cleanup on page unload
    window.addEventListener('beforeunload', function () {
      if (viewer && viewer.type === 'epub' && viewer.book) {
        try { viewer.book.destroy(); } catch (e) { /* ignore */ }
      }
    });
  }

  /* ================================================================
      Start
      ================================================================ */
  loadSettings();
  applyFontSize();
  bindEvents();
  init();
})();
