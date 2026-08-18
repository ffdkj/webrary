/**
 * txt-pagination.js — 客户端 TXT 分页模块
 *
 * 这是 app/services/ebook.py 中 TXT 分页算法的 1:1 JavaScript 移植，
 * 用于 OPFS 离线阅读时在本地重建与服务端完全一致的页码。
 *
 * 服务端算法要点（ebook.py _build_txt_index / txt_page）：
 *  - 按 `\n` 切分文本行，除最后一段外每行保留结尾换行符；
 *  - 只有当 `当前页字符数 > 0 且 当前页字符数 + 本行长度 > 2000` 时才换页，
 *    且换页后本行属于新的一页；
 *  - 章节标题行（正则匹配）记录 startPage 为当前页页码；
 *  - 字符数按 Unicode 码点计数（Python len() 语义，用 Array.from 对齐）。
 *
 * UMD：浏览器暴露 window.WebraryTxt，Node 导出 module.exports，便于单元测试。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WebraryTxt = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CHARS_PER_PAGE = 2000;

  // 与服务端 TXT_CHAPTER_RE 保持一致（Python re.match 锚定开头 -> JS ^）
  var TXT_CHAPTER_RE = /^(?:第[一二三四五六七八九十百千万零〇0-9]+[章回节卷篇部]|Chapter\s+\d+|CHAPTER\s+\d+|序言|前言|楔子|尾声|后记|附录).*/;

  function codePointLength(str) {
    // Python 的 len(str) 按码点计数；Array.from 与之一致（代理对也算 1 个）。
    return Array.from(str).length;
  }

  /**
   * 解析整本 TXT（UTF-8 解码后的文本，即 /stream 端点内容）。
   * @param {string} text
   * @returns {{totalPages:number, pages:number[][], toc:object[], lines:string[]}}
   *   - pages: [页起始行下标, 页结束行下标) 的数组
   *   - toc:   [{title, chapterIndex, startPage, href:null, level:0}]
   *   - lines: 保留换行语义的逐行文本数组
   */
  function buildPages(text) {
    var rawLines = text.split('\n');
    var lines = [];
    for (var i = 0; i < rawLines.length; i++) {
      var line = rawLines[i];
      // 服务端逐段累积时，除最后一段外每段都带结尾换行符：part + "\n"
      if (i < rawLines.length - 1) line = line + '\n';
      lines.push(line);
    }

    var pages = [];
    var toc = [];
    var charCount = 0;
    var currentStart = 0;
    var pageNo = 1;

    function flushLine(line, index) {
      var len = codePointLength(line);
      if (charCount > 0 && charCount + len > CHARS_PER_PAGE) {
        pages.push([currentStart, index]);
        currentStart = index;
        charCount = 0;
        pageNo += 1;
      }

      var stripped = line.replace(/^\s+|\s+$/g, '');
      if (TXT_CHAPTER_RE.test(stripped)) {
        toc.push({
          title: stripped,
          chapterIndex: toc.length,
          startPage: pageNo,
          href: null,
          level: 0
        });
      }

      charCount += len;
    }

    for (i = 0; i < lines.length; i++) {
      flushLine(lines[i], i);
    }

    if (charCount > 0 || pages.length === 0) {
      pages.push([currentStart, lines.length]);
    }

    return {
      totalPages: pages.length,
      pages: pages,
      toc: toc,
      lines: lines
    };
  }

  /**
   * 取指定页码的纯文本内容（与服务端 txt_page 返回的 content 一致）。
   * 第一个参数传入 buildPages() 返回结果中的 lines（已带换行语义），
   * 避免每翻一页都重新 split 整本文本。
   */
  function getPageText(lines, pages, pageNumber) {
    var idx = pageNumber - 1;
    if (idx < 0 || idx >= pages.length) return null;
    var range = pages[idx];
    return lines.slice(range[0], range[1]).join('');
  }

  return {
    CHARS_PER_PAGE: CHARS_PER_PAGE,
    buildPages: buildPages,
    getPageText: getPageText,
    isChapterTitle: function (line) {
      return TXT_CHAPTER_RE.test((line || '').replace(/^\s+|\s+$/g, ''));
    }
  };
});