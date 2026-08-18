/**
 * opfs-cache.js — 离线书籍缓存库（OPFS 优先，Cache Storage 降级）
 *
 * 将除 PDF 外的书籍文件（EPUB/MOBI/AZW3/FB2/TXT 等）缓存到本地，
 * 阅读器与书架页面通过 window.WebraryOPFS 读取，实现离线阅读。
 *
 * 后端选择（启动时探测一次）：
 *   1. OPFS（首选）：navigator.storage.getDirectory() +
 *      FileSystemFileHandle.createWritable()。注意：旧版 iPad Safari
 *      （iOS 15.2–16.x）只有 getDirectory/getFileHandle/getFile，
 *      没有 createWritable（Safari 17 才提供），此时自动降级；
 *   2. Cache Storage API（降级）：同样支持离线、同源、计入配额。
 *
 * 逻辑命名（两个后端共用）：
 *   index.json                缓存索引 {version, books: {bookId: entry}}
 *   books/{bookId}.{ext}      原始书籍字节（TXT 为 UTF-8 文本）
 *   books/{bookId}.toc.json   服务端目录快照（离线时优先使用）
 *
 * 说明：
 *  - 同一本书以 bookId 为键，服务器文件不可变（uuid 文件名 + 下载时转换），
 *    因此缓存不会因内容更新而失效。
 *  - 索引写入通过内部 Promise 队列串行化，避免并发写坏 JSON。
 */
(function (global) {
  'use strict';

  var ROOT_DIR = 'webrary-cache';
  var booksPrefix = 'books/';
  var INDEX_NAME = 'index.json';
  var FALLBACK_CACHE = 'webrary-offline-v1';
  var INDEX_VERSION = 1;

  // 可离线缓存的格式（PDF 明确排除；MOBI/AZW3 上传/下载时服务端已转 EPUB）
  var CACHEABLE_EXTS = { epub: 1, mobi: 1, azw3: 1, fb2: 1, txt: 1 };

  // 同步能力判断：任一存储可用即视为“支持”，具体后端由 _probe 异步决定
  var isSupported = !!(
    (global.navigator && global.navigator.storage && typeof global.navigator.storage.getDirectory === 'function') ||
    (typeof global.caches !== 'undefined' && typeof global.caches.open === 'function')
  );

  var _backendPromise = null;
  var _queue = Promise.resolve();

  /* ================================================================
     后端实现
     ================================================================ */

  function opfsNameParts(name) {
    var idx = name.indexOf('/');
    if (idx < 0) return { dir: null, file: name };
    return { dir: name.slice(0, idx), file: name.slice(idx + 1) };
  }

  function makeOpfsBackend(cacheDir) {
    function getFileHandle(name, create) {
      var parts = opfsNameParts(name);
      var opts = create ? { create: true } : undefined;
      if (!parts.dir) return cacheDir.getFileHandle(name, opts);
      return cacheDir.getDirectoryHandle(parts.dir, { create: true }).then(function (dir) {
        return dir.getFileHandle(parts.file, opts);
      });
    }
    return {
      kind: 'opfs',
      writeBytes: function (name, bytes) {
        return getFileHandle(name, true).then(function (fh) {
          return fh.createWritable().then(function (writable) {
            return writable
              .write(bytes)
              .then(function () { return writable.close(); });
          });
        }).then(function () {
          return bytes.byteLength;
        });
      },
      writeResponse: function (name, response, onProgress, total) {
        return getFileHandle(name, true).then(function (fh) {
          return fh.createWritable().then(function (writable) {
            var reader = response.body.getReader();
            var loaded = 0;
            function pump() {
              return reader.read().then(function (res) {
                if (res.done) return loaded;
                loaded += res.value.byteLength;
                if (onProgress) {
                  try { onProgress({ loaded: loaded, total: total }); } catch (e) { /* ignore */ }
                }
                return writable.write(res.value).then(pump);
              });
            }
            return pump().then(
              function (size) {
                return writable.close().then(function () { return size; });
              },
              function (err) {
                return writable.close().catch(function () {}).then(function () { throw err; });
              }
            );
          });
        });
      },
      read: function (name) {
        return getFileHandle(name, false)
          .then(function (fh) { return fh.getFile(); })
          .then(function (file) { return file.arrayBuffer(); })
          .then(function (ab) { return new Uint8Array(ab); })
          .catch(function () { return null; });
      },
      stat: function (name) {
        return getFileHandle(name, false)
          .then(function (fh) { return fh.getFile(); })
          .then(function (file) { return file.size; })
          .catch(function () { return null; });
      },
      remove: function (name) {
        var parts = opfsNameParts(name);
        if (!parts.dir) return cacheDir.removeEntry(name).catch(function () {});
        return cacheDir.getDirectoryHandle(parts.dir).then(function (dir) {
          return dir.removeEntry(parts.file).catch(function () {});
        }).catch(function () {});
      },
      clearAll: function () {
        // 清空 books 子目录（含目录快照）并删除索引
        return cacheDir
          .removeEntry('books', { recursive: true })
          .catch(function () {})
          .then(function () {
            return cacheDir.removeEntry(INDEX_NAME).catch(function () {});
          });
      }
    };
  }

  function makeCachesBackend() {
    var prefix = 'webrary-cache://';
    function keyOf(name) { return prefix + name.replace(/\//g, '__'); }
    return {
      kind: 'caches',
      writeBytes: function (name, bytes) {
        return global.caches.open(FALLBACK_CACHE).then(function (cache) {
          return cache.put(keyOf(name), new global.Response(bytes)).then(function () {
            return bytes.byteLength;
          });
        });
      },
      writeResponse: function (name, response, onProgress, total) {
        var reader = response.body.getReader();
        var chunks = [];
        var loaded = 0;
        function pump() {
          return reader.read().then(function (res) {
            if (res.done) return;
            chunks.push(res.value);
            loaded += res.value.byteLength;
            if (onProgress) {
              try { onProgress({ loaded: loaded, total: total }); } catch (e) { /* ignore */ }
            }
            return pump();
          });
        }
        return pump().then(function () {
          var blob = new global.Blob(chunks, {
            type: response.headers.get('Content-Type') || 'application/octet-stream'
          });
          return global.caches.open(FALLBACK_CACHE).then(function (cache) {
            return cache.put(keyOf(name), new global.Response(blob)).then(function () {
              return blob.size;
            });
          });
        });
      },
      read: function (name) {
        return global.caches.open(FALLBACK_CACHE).then(function (cache) {
          return cache.match(keyOf(name));
        }).then(function (resp) {
          if (!resp) return null;
          return resp.arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
        });
      },
      stat: function (name) {
        return global.caches.open(FALLBACK_CACHE).then(function (cache) {
          return cache.match(keyOf(name));
        }).then(function (resp) {
          if (!resp) return null;
          return resp.blob().then(function (b) { return b.size; });
        });
      },
      remove: function (name) {
        return global.caches.open(FALLBACK_CACHE).then(function (cache) {
          return cache.delete(keyOf(name));
        });
      },
      clearAll: function () {
        return global.caches.open(FALLBACK_CACHE).then(function (cache) {
          return cache.keys().then(function (keys) {
            return Promise.all(keys.map(function (k) { return cache.delete(k); }));
          });
        });
      }
    };
  }

  /* ---------- 后端探测 ---------- */

  function probeOpfs() {
    return global.navigator.storage.getDirectory().then(function (root) {
      return root.getDirectoryHandle(ROOT_DIR, { create: true }).then(function (cacheDir) {
        return cacheDir.getFileHandle('__probe__', { create: true }).then(function (fh) {
          var usable = typeof fh.createWritable === 'function' && typeof fh.getFile === 'function';
          // 清理探测文件
          return cacheDir.removeEntry('__probe__').catch(function () {}).then(function () {
            if (usable) return makeOpfsBackend(cacheDir);
            return tryCachesBackend();
          });
        });
      });
    }).catch(function () {
      // OPFS 不可用（被禁用/隐私模式/配额异常等）时降级
      return tryCachesBackend();
    });
  }

  function tryCachesBackend() {
    if (typeof global.caches !== 'undefined' && typeof global.caches.open === 'function') {
      return global.caches.open(FALLBACK_CACHE).then(function () {
        return makeCachesBackend();
      });
    }
    return null;
  }

  function ensureBackend() {
    if (!_backendPromise) {
      _backendPromise = (global.navigator && global.navigator.storage && typeof global.navigator.storage.getDirectory === 'function')
        ? probeOpfs()
        : tryCachesBackend();
      // 探测失败也缓存结果，避免每次操作都重试
      _backendPromise = _backendPromise.catch(function () {
        return null;
      });
    }
    return _backendPromise;
  }

  function requireBackend() {
    return ensureBackend().then(function (backend) {
      if (!backend) {
        return Promise.reject(new Error('当前浏览器不支持本地离线缓存（OPFS / Cache API 均不可用）'));
      }
      return backend;
    });
  }

  /* ================================================================
     索引（两个后端共用的逻辑文件 index.json）
     ================================================================ */

  function enqueue(fn) {
    var run = _queue.then(fn, fn);
    _queue = run.then(function () {}, function () {});
    return run;
  }

  function defaultIndex() {
    return { version: INDEX_VERSION, books: {} };
  }

  function readIndex() {
    return requireBackend().then(function (backend) {
      return backend.read(INDEX_NAME);
    }).then(function (bytes) {
      if (!bytes) return defaultIndex();
      try {
        var idx = JSON.parse(new global.TextDecoder().decode(bytes));
        return idx && idx.version === INDEX_VERSION && idx.books ? idx : defaultIndex();
      } catch (e) {
        return defaultIndex();
      }
    });
  }

  function writeIndex(index) {
    var payload = new global.TextEncoder().encode(JSON.stringify(index));
    var op = requireBackend().then(function (backend) {
      return backend.writeBytes(INDEX_NAME, payload);
    });
    // 队列仅用于串行化“读-改-写”的整段操作；writeIndex 本身由 mutateIndex 入队
    return op;
  }

  function mutateIndex(mutator) {
    return enqueue(function () {
      return readIndex().then(function (index) {
        return Promise.resolve(mutator(index)).then(function () {
          return writeIndex(index);
        });
      });
    });
  }

  function libName(bookId, ext) {
    return booksPrefix + String(bookId) + '.' + (ext || 'bin');
  }

  function tocName(bookId) {
    return booksPrefix + String(bookId) + '.toc.json';
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
    if (!global.navigator.storage || !global.navigator.storage.estimate) return Promise.resolve();
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
    if (!global.navigator.storage || !global.navigator.storage.estimate) {
      return Promise.resolve({ quota: 0, usage: 0 });
    }
    return global.navigator.storage.estimate();
  }

  /* ---------- 写缓存 ---------- */

  function cacheResponse(bookId, meta, response, opts) {
    opts = opts || {};
    var ext = String(meta.extension || '').toLowerCase().replace(/^\./, '') || 'bin';
    var name = libName(bookId, ext);
    var total = response && response.headers
      ? (parseInt(response.headers.get('Content-Length') || '0', 10) || 0)
      : 0;

    return requireBackend().then(function (backend) {
      if (!response || !response.ok) {
        throw new Error('无法获取书籍文件 (HTTP ' + (response && response.status) + ')');
      }
      return checkQuota(total).then(function () {
        var writePromise = (response.body && response.body.getReader)
          ? backend.writeResponse(name, response, opts.onProgress, total)
          : response.arrayBuffer().then(function (ab) {
            return backend.writeBytes(name, new Uint8Array(ab));
          });
        return writePromise.then(function (size) {
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
        }, function (err) {
          // 写入失败时清理半成品
          return backend.remove(name).then(function () { throw err; });
        });
      });
    });
  }

  /** 直接写入已持有的文本内容（用于 TXT 的 /stream 文本缓存）。 */
  function cacheText(bookId, text, meta) {
    meta = meta || {};
    var ext = String(meta.extension || 'txt').toLowerCase().replace(/^\./, '');
    var bytes = new global.TextEncoder().encode(text);
    var name = libName(bookId, ext);
    return requireBackend()
      .then(function () { return checkQuota(bytes.byteLength); })
      .then(function () { return requireBackend(); })
      .then(function (backend) {
        return backend.writeBytes(name, bytes).then(function (size) {
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
        }, function (err) {
          return backend.remove(name).then(function () { throw err; });
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
      return requireBackend().then(function (backend) {
        return backend.read(libName(bookId, entry.extension)).then(function (bytes) {
          if (!bytes) {
            // 索引存在但数据丢失 -> 清理失效条目
            return mutateIndex(function (idx) {
              delete idx.books[key];
            }).then(function () { return null; });
          }
          var file = new global.Blob([bytes], { type: 'application/octet-stream' });
          return { file: file, meta: entry };
        });
      });
    });
  }

  function isCached(bookId) {
    return getCached(bookId).then(function (cached) {
      return !!cached;
    });
  }

  /* ---------- 目录快照 ---------- */

  function saveToc(bookId, toc) {
    return requireBackend().catch(function () { return null; }).then(function (backend) {
      if (!backend) return null;
      return backend.writeBytes(tocName(bookId), new global.TextEncoder().encode(JSON.stringify(toc || [])))
        .catch(function () { return null; });
    });
  }

  function getToc(bookId) {
    return requireBackend().catch(function () { return null; }).then(function (backend) {
      if (!backend) return null;
      return backend.read(tocName(bookId)).then(function (bytes) {
        if (!bytes) return null;
        try {
          var parsed = JSON.parse(new global.TextDecoder().decode(bytes));
          return Array.isArray(parsed) ? parsed : null;
        } catch (e) {
          return null;
        }
      });
    });
  }

  /* ---------- 删除 ---------- */

  function removeBook(bookId) {
    var key = String(bookId);
    return readIndex().then(function (index) {
      var entry = index.books[key];
      return requireBackend().then(function (backend) {
        return backend.remove(libName(bookId, entry ? entry.extension : 'bin'))
          .then(function () { return backend.remove(tocName(bookId)); })
          .then(function () {
            return mutateIndex(function (idx) {
              delete idx.books[key];
            });
          });
      });
    });
  }

  function clearAll() {
    return requireBackend().then(function (backend) {
      return backend.clearAll().then(function () {
        return writeIndex(defaultIndex());
      });
    });
  }

  function listCached() {
    return readIndex().then(function (index) {
      var keys = Object.keys(index.books);
      return requireBackend().then(function (backend) {
        return Promise.all(
          keys.map(function (key) {
            var entry = index.books[key];
            if (!entry) return Promise.resolve(null);
            return backend.stat(libName(entry.bookId, entry.extension)).then(function (size) {
              if (size == null) return null;
              return {
                bookId: entry.bookId,
                extension: entry.extension,
                size: size,
                title: entry.title || '',
                author: entry.author || '',
                cachedAt: entry.cachedAt || 0
              };
            });
          })
        ).then(function (items) {
          var valid = items.filter(Boolean);
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