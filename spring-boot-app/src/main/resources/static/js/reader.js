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
        if (saved && saved.page) pdfPageNum = Math.min(saved.page, pdfTotalPages);
        return renderPdfPage(pdfPageNum);
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

  function renderPdfPage(pageNum) {
    var container = document.getElementById('pdfContainer');
    if (!container) return Promise.resolve();

    container.innerHTML = '';

    return new Promise(function (resolve) {
      var img = document.createElement('img');
      img.className = 'pdf-page';
      img.id = 'page-' + pageNum;
      img.src = '/api/books/' + PARAM_BOOK_ID + '/pdf/page/' + pageNum + '?dpi=144';
      img.style.cssText = 'display:block;margin:0 auto;max-width:100%;box-shadow:0 4px 24px rgba(0,0,0,0.6);border-radius:2px;';
      img.onload = function () {
        pdfPageNum = pageNum;
        img.scrollIntoView({ behavior: 'smooth', block: 'start' });
        saveProgress({ page: pageNum, totalPages: pdfTotalPages });
        updatePdfNavState();
        resolve();
      };
      img.onerror = function () {
        resolve();
      };
      container.appendChild(img);
    });
  }

  function updatePdfNavState() {
    dom.pagePrevBtn.disabled = pdfPageNum <= 1;
    dom.pageNextBtn.disabled = pdfPageNum >= pdfTotalPages;
  }

  function pdfPrevPage() {
    if (pdfPageNum > 1) renderPdfPage(pdfPageNum - 1);
  }

  function pdfNextPage() {
    if (pdfPageNum < pdfTotalPages) renderPdfPage(pdfPageNum + 1);
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
          renderPdfPage(tocData[idx].page);
        } else if (href) {
          var page = href.replace('#page-', '');
          if (page) renderPdfPage(parseInt(page, 10));
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
  applyFontSize();
  bindEvents();
  init();
})();
