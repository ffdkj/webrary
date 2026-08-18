/**
 * opfs-cache.js — Origin Private File System (OPFS) 离线书籍缓存库
 *
 * 将除 PDF 外的书籍文件（EPUB/MOBI/AZW3/FB2/TXT 等）缓存到浏览器 OPFS，
 * 阅读器与书架页面通过 window.WebraryOPFS 读取，实现离线阅读。
 *
 * 目录布局（origin 根目录下）：
 *   webrary-cache/
 *     index.json              // 缓存索引 {version, books: {bookId: entry}}
 *     books/
 *       {bookId}.{ext}        // 原始书籍字节（TXT 为 UTF-8 文本）
 *       {bookId}.toc.json     // 服务端目录快照（离线时优先使用）
 *
 * 说明：
 *  - 全部使用异步句柄（getFileHandle / createWritable / getFile），
 *    在主线程与 Service Worker 中均可使用；不需要 createSyncAccessHandle。
 *  - 同一本书以 bookId 为键，服务器文件不可变（uuid 文件名 + 下载时转换），
 *    因此缓存不会因内容更新而失效。
 *  - 索引写入通过内部 Promise 队列串行化，避免并发写坏 JSON。
 */
(function (global) {
  'use strict';

  var ROOT_DIR = 'webrary-cache';
  var BOOKS_DIR = 'books';
  var INDEX_NAME = 'index.json';
  var INDEX_VERSION = 1;

  // 可离线缓存的格式（PDF 明确排除；MOBI/AZW3 上传/下载时服务端已转 EPUB）
  var CACHEABLE_EXTS = { epub: 1, mobi: 1, azw3: 1, fb2: 1, txt: 1 };

  var isSupported = !!(
    global.navigator &&
    global.navigator.storage &&
    typeof global.navigator.storage.getDirectory === 'function'
  );

  var _dirPromise = null;
  var _queue = Promise.resolve();

  /* ---------- 内部工具 ---------- */

  function enqueue(fn) {
    var run = _queue.then(fn, fn);
    // 队列本身不被失败的任务打断
    _queue = run.then(function () {}, function () {});
    return run;
  }

  function getCacheDir() {
    if (!isSupported) return Promise.reject(new Error('OPFS 不可用'));
    if (!_dirPromise) {
      _dirPromise = global.navigator.storage.getDirectory().then(function (root) {
        return root.getDirectoryHandle(ROOT_DIR, { create: true });
      });
    }
    return _dirPromise;
  }

  function getBooksDir() {
    return getCacheDir().then(function (dir) {
      return dir.getDirectoryHandle(BOOKS_DIR, { create: true });
    });
  }

  function libName(bookId, ext) {
    return String(bookId) + '.' + (ext || 'bin');
  }

  function tocName(bookId) {
    return String(bookId) + '.toc.json';
  }

  function defaultIndex() {
    return { version: INDEX_VERSION, books: {} };
  }

  function readIndex() {
    return getCacheDir()
      .then(function (dir) {
        return dir.getFileHandle(INDEX_NAME);
      })
      .then(function (fh) {
        return fh.getFile();
      })
      .then(function (file) {
        return file.text();
      })
      .then(function (text) {
        var idx = JSON.parse(text);
        return idx && idx.version === INDEX_VERSION && idx.books ? idx : defaultIndex();
      })
      .catch(function () {
        return defaultIndex();
      });
  }

  function writeIndex(index) {
    var payload = JSON.stringify(index);
    return getCacheDir()
      .then(function (dir) {
        return dir.getFileHandle(INDEX_NAME, { create: true });
      })
      .then(function (fh) {
        return fh.createWritable();
      })
      .then(function (writable) {
        return writable
          .write(payload)
          .then(function () {
            return writable.close();
          });
      });
  }

  /** 串行化“读索引-修改-写索引”，失败时索引不落盘。 */
  function mutateIndex(mutator) {
    return enqueue(function () {
      return readIndex().then(function (index) {
        return Promise.resolve(mutator(index)).then(function () {
          return writeIndex(index);
        });
      });
    });
  }

  function fmtSize(bytes) {
    if (bytes == null || isNaN(bytes) || bytes < 0) return '0 B';
    var u = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = 0;
    var v = bytes;
    while (v >= 1024 && i < u.length - 1) {
      v /= 1024;
      i++;
    }
    return v.toFixed(v >= 10 || i === 0 ? 0 : 1) + ' ' + u[i];
  }

  /* ---------- 存储配额 ---------- */

  function checkQuota(extraBytes) {
    if (!global.navigator.storage.estimate) return Promise.resolve();
    return global.navigator.storage.estimate().then(function (estimate) {
      var quota = estimate && estimate.quota ? estimate.quota : 0;
      var usage = estimate && estimate.usage ? estimate.usage : 0;
      if (quota > 0 && extraBytes > 0 && usage + extraBytes > quota * 0.98) {
        var err = new Error(
          '存储空间不足：需要约 ' + fmtSize(extraBytes) +
          '，剩余 ' + fmtSize(Math.max(0, quota - usage))
        );
        err.code = 'QUOTA';
        throw err;
      }
      return { quota: quota, usage: usage };
    });
  }

  function getUsage() {
    if (!global.navigator.storage.estimate) {
      return Promise.resolve({ quota: 0, usage: 0 });
    }
    return global.navigator.storage.estimate();
  }

  /* ---------- 写缓存 ---------- */

  /**
   * 将一个 fetch Response 流式写入 OPFS。
   * @param {string|number} bookId 书籍实体 ID（与 /api/books/{id} 一致）
   * @param {{title?:string, author?:string, extension:string}} meta
   * @param {Response} response fetch('/api/books/{id}/stream') 的响应
   * @param {{onProgress?:function}} opts onProgress({loaded, total})
   */
  function cacheResponse(bookId, meta, response, opts) {
    opts = opts || {};
    if (!isSupported) return Promise.reject(new Error('当前浏览器不支持 OPFS 离线缓存'));
    if (!response || !response.ok) {
      return Promise.reject(new Error('无法获取书籍文件 (HTTP ' + (response && response.status) + ')'));
    }
    var ext = String(meta.extension || '').toLowerCase().replace(/^\./, '') || 'bin';
    var name = libName(bookId, ext);
    var total = parseInt(response.headers.get('Content-Length') || '0', 10) || 0;

    return checkQuota(total)
      .then(function () {
        return getBooksDir();
      })
      .then(function (dir) {
        return dir.getFileHandle(name, { create: true });
      })
      .then(function (fh) {
        return fh.createWritable();
      })
      .then(function (writable) {
        var reader = response.body && response.body.getReader ? response.body.getReader() : null;
        if (!reader) {
          return Promise.reject(new Error('响应体不可读'));
        }
        var loaded = 0;
        function pump() {
          return reader.read().then(function (res) {
            if (res.done) return loaded;
            loaded += res.value ? res.value.byteLength : 0;
            if (opts.onProgress) {
              try {
                opts.onProgress({ loaded: loaded, total: total });
              } catch (e) { /* ignore */ }
            }
            return writable.write(res.value).then(pump);
          });
        }
        return pump().then(
          function (size) {
            return writable.close().then(function () {
              return size;
            });
          },
          function (err) {
            return writable.close().catch(function () {}).then(function () {
              throw err;
            });
          }
        );
      })
      .then(
        function (size) {
          var entry = {
            bookId: String(bookId),
            extension: ext,
            size: size,
            title: meta.title || '',
            author: meta.author || '',
            cachedAt: Date.now()
          };
          return mutateIndex(function (index) {
            index.books[String(bookId)] = entry;
          }).then(function () {
            return entry;
          });
        },
        function (err) {
          // 写入失败时清理半成品文件
          return getBooksDir()
            .then(function (dir) {
              return dir.removeEntry(name).catch(function () {});
            })
            .catch(function () {})
            .then(function () {
              throw err;
            });
        }
      );
  }

  /** 直接写入已持有的文本内容（用于 TXT 的 /stream 文本缓存）。 */
  function cacheText(bookId, text, meta) {
    meta = meta || {};
    if (!isSupported) return Promise.reject(new Error('当前浏览器不支持 OPFS 离线缓存'));
    var ext = String(meta.extension || 'txt').toLowerCase().replace(/^\./, '');
    var size = new global.TextEncoder().encode(text).length;
    return checkQuota(size)
      .then(function () {
        return getBooksDir();
      })
      .then(function (dir) {
        return dir.getFileHandle(libName(bookId, ext), { create: true });
      })
      .then(function (fh) {
        return fh.createWritable();
      })
      .then(function (writable) {
        return writable.write(text).then(function () {
          return writable.close();
        });
      })
      .then(function () {
        var entry = {
          bookId: String(bookId),
          extension: ext,
          size: size,
          title: meta.title || '',
          author: meta.author || '',
          cachedAt: Date.now()
        };
        return mutateIndex(function (index) {
          index.books[String(bookId)] = entry;
        }).then(function () {
          return entry;
        });
      });
  }

  /** 拉取 /api/books/{bookId}/stream 并缓存（带进度回调）。 */
  function cacheBook(bookId, meta, opts) {
    return fetch('/api/books/' + bookId + '/stream').then(function (response) {
      return cacheResponse(bookId, meta, response, opts);
    });
  }

  /* ---------- 读缓存 ---------- */

  function getCached(bookId) {
    var key = String(bookId);
    return readIndex().then(function (index) {
      var entry = index.books[key];
      if (!entry) return null;
      return getBooksDir()
        .then(function (dir) {
          return dir.getFileHandle(libName(bookId, entry.extension)).then(function (fh) {
            return fh.getFile();
          });
        })
        .then(function (file) {
          return { file: file, meta: entry };
        })
        .catch(function () {
          // 索引存在但文件丢失 -> 清理失效条目
          return mutateIndex(function (idx) {
            delete idx.books[key];
          }).then(function () {
            return null;
          });
        });
    });
  }

  function isCached(bookId) {
    return getCached(bookId).then(function (cached) {
      return !!cached;
    });
  }

  /**
   * 缓存一本已存在于 OPFS 的书。返回 File；未缓存时返回 null。
   * 通过 meta.extension 区分不同的文件（同 bookId 覆盖写）。
   */
  function getCachedFile(bookId) {
    return getCached(bookId);
  }

  /* ---------- 目录快照 ---------- */

  function saveToc(bookId, toc) {
    if (!isSupported) return Promise.resolve();
    return getBooksDir()
      .then(function (dir) {
        return dir.getFileHandle(tocName(bookId), { create: true });
      })
      .then(function (fh) {
        return fh.createWritable();
      })
      .then(function (writable) {
        return writable.write(JSON.stringify(toc || [])).then(function () {
          return writable.close();
        });
      })
      .catch(function () {});
  }

  function getToc(bookId) {
    if (!isSupported) return Promise.resolve(null);
    return getBooksDir()
      .then(function (dir) {
        return dir.getFileHandle(tocName(bookId));
      })
      .then(function (fh) {
        return fh.getFile();
      })
      .then(function (file) {
        return file.text();
      })
      .then(function (text) {
        var parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : null;
      })
      .catch(function () {
        return null;
      });
  }

  /* ---------- 删除 ---------- */

  function removeBook(bookId) {
    var key = String(bookId);
    return readIndex().then(function (index) {
      var entry = index.books[key];
      return getBooksDir()
        .then(function (dir) {
          return dir
            .removeEntry(libName(bookId, entry ? entry.extension : 'bin'))
            .catch(function () {});
        })
        .then(function () {
          return dirRemoveToc(bookId);
        })
        .then(function () {
          return mutateIndex(function (idx) {
            delete idx.books[key];
          });
        });
    });
  }

  function dirRemoveToc(bookId) {
    return getBooksDir()
      .then(function (dir) {
        return dir.removeEntry(tocName(bookId)).catch(function () {});
      })
      .catch(function () {});
  }

  function clearAll() {
    return getCacheDir()
      .then(function (dir) {
        return dir.removeEntry(BOOKS_DIR, { recursive: true }).catch(function () {});
      })
      .then(function () {
        return mutateIndex(function (index) {
          index.books = {};
        });
      });
  }

  function listCached() {
    return readIndex().then(function (index) {
      var keys = Object.keys(index.books);
      return Promise.all(
        keys.map(function (key) {
          var entry = index.books[key];
          if (!entry) return Promise.resolve(null);
          return getBooksDir()
            .then(function (dir) {
              return dir.getFileHandle(libName(entry.bookId, entry.extension)).then(function (fh) {
                return fh.getFile();
              });
            })
            .then(function (file) {
              return {
                bookId: entry.bookId,
                extension: entry.extension,
                size: file.size,
                title: entry.title || '',
                author: entry.author || '',
                cachedAt: entry.cachedAt || 0
              };
            })
            .catch(function () {
              return null;
            });
        })
      ).then(function (items) {
        var valid = items.filter(Boolean);
        // 清理失效索引项（文件已丢失）
        var stale = keys.filter(function (key) {
          return !valid.some(function (item) {
            return String(item.bookId) === key;
          });
        });
        if (stale.length > 0) {
          mutateIndex(function (idx) {
            stale.forEach(function (key) {
              delete idx.books[key];
            });
          });
        }
        valid.sort(function (a, b) {
          return (b.cachedAt || 0) - (a.cachedAt || 0);
        });
        return valid;
      });
    });
  }

  /* ---------- 对外接口 ---------- */

  global.WebraryOPFS = {
    isSupported: isSupported,
    isCacheable: function (ext) {
      return !!CACHEABLE_EXTS[String(ext || '').toLowerCase().replace(/^\./, '')];
    },
    getStreamUrl: function (bookId) {
      return '/api/books/' + bookId + '/stream';
    },
    cacheResponse: cacheResponse,
    cacheText: cacheText,
    cacheBook: cacheBook,
    getCached: getCached,
    getCachedFile: getCachedFile,
    isCached: isCached,
    saveToc: saveToc,
    getToc: getToc,
    removeBook: removeBook,
    clearAll: clearAll,
    listCached: listCached,
    getUsage: getUsage,
    fmtSize: fmtSize
  };
})(typeof window !== 'undefined' ? window : self);