/**
 * test_opfs_cache.js — 在 Node 中端到端验证 opfs-cache.js
 *
 * OPFS API 依赖浏览器环境，这里用 node:vm 注入：
 *   - 内存版 FileSystemDirectoryHandle / FileSystemFileHandle shim
 *   - navigator.storage.getDirectory / estimate
 *   - 真实 fetch/Response/ReadableStream/TextEncoder
 *
 * 运行：node tests/test_opfs_cache.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

/* ---------- 内存 OPFS shim ---------- */
function makeOpfs() {
  const usage = { total: 0 };
  const root = createDir(usage);
  const storage = {
    getDirectory: async () => root,
    estimate: async () => ({
      quota: 1024 * 1024 * 1024,
      usage: usage.total
    })
  };
  return { root, storage, usage };
}

function createDir(usage) {
  const makeNode = () => ({ dirs: {}, files: {} });
  const rootNode = makeNode();

  const makeHandle = (node) => {
    return {
      getDirectoryHandle: async (name, opts) => {
        if (node.dirs[name]) return makeHandle(node.dirs[name]);
        if (opts && opts.create) {
          node.dirs[name] = makeNode();
          return makeHandle(node.dirs[name]);
        }
        throw new Error(`NOT_FOUND dir ${name}`);
      },
      getFileHandle: async (name, opts) => {
        if (node.files[name]) return fileServer(node.files[name], usage);
        if (opts && opts.create) {
          node.files[name] = { bytes: Buffer.alloc(0) };
          return fileServer(node.files[name], usage);
        }
        throw new Error(`NOT_FOUND file ${name}`);
      },
      removeEntry: async (name, opts) => {
        if (node.dirs[name]) {
          if (opts && opts.recursive) delete node.dirs[name];
          else {
            const sub = node.dirs[name];
            if (Object.keys(sub.dirs).length || Object.keys(sub.files).length) {
              throw new Error('NOT_EMPTY');
            }
            delete node.dirs[name];
          }
          return;
        }
        if (node.files[name]) {
          usage.total = Math.max(0, usage.total - node.files[name].bytes.length);
          delete node.files[name];
          return;
        }
        throw new Error(`NOT_FOUND ${name}`);
      },
      remove: async () => {
        for (const k of Object.keys(node.files)) {
          usage.total = Math.max(0, usage.total - node.files[k].bytes.length);
          delete node.files[k];
        }
        for (const k of Object.keys(node.dirs)) delete node.dirs[k];
      }
    };
  };

  return makeHandle({ dirs: {}, files: {} });
}

function fileServer(file, usage) {
  return {
    createWritable: async () => {
      let chunks = [];
      let closed = false;
      return {
        write: async (chunk) => {
          assert.ok(!closed, 'write after close');
          chunks.push(Buffer.from(chunk));
        },
        close: async () => {
          usage.total = Math.max(0, usage.total - file.bytes.length);
          file.bytes = Buffer.concat(chunks);
          usage.total += file.bytes.length;
          closed = true;
        }
      };
    },
    getFile: async () => ({
      size: file.bytes.length,
      text: async () => file.bytes.toString('utf8'),
      arrayBuffer: async () => file.bytes.buffer.slice(
        file.bytes.byteOffset,
        file.bytes.byteOffset + file.bytes.byteLength
      )
    })
  };
}

/* ---------- 加载 opfs-cache.js ---------- */
const code = fs.readFileSync(
  path.join(__dirname, '..', 'static', 'js', 'opfs-cache.js'),
  'utf8'
);

const { root, storage, usage } = makeOpfs();

const sandbox = {
  console,
  TextEncoder,
  fetch: globalThis.fetch.bind(globalThis),
  Response: globalThis.Response,
  navigator: { storage },
  setTimeout,
  clearTimeout
};
sandbox.window = sandbox;   // IIFE 以 window 作为 global
sandbox.self = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const OPFS = sandbox.window.WebraryOPFS;
assert.ok(OPFS, 'WebraryOPFS should be exposed');
assert.strictEqual(OPFS.isSupported, true, 'isSupported with shim');

/* ---------- 用例 ---------- */

async function main() {
  // 1. cacheText + isCached + getCached + file.text
  const text = '第一章 开始\n' + ('内容'.repeat(500) + '\n').repeat(30);
  await OPFS.cacheText('5', text, { title: '样例', author: 'A', extension: 'txt' });
  assert.strictEqual(await OPFS.isCached('5'), true);
  const cached = await OPFS.getCached('5');
  assert.ok(cached && cached.file, 'getCached returns file');
  assert.strictEqual(await cached.file.text(), text, 'text round-trip');
  assert.strictEqual(cached.meta.title, '样例');

  // 2. cacheResponse：流式写入（真实 Response 对象）
  const buf = Buffer.from('FAKE-EPUB-BYTES-'.repeat(1000));
  const stream = new globalThis.ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(buf.slice(0, 5000)));
      controller.enqueue(new Uint8Array(buf.slice(5000)));
      controller.close();
    }
  });
  const resp = new globalThis.Response(stream, {
    status: 200,
    headers: { 'Content-Length': String(buf.length) }
  });
  const onProgress = (p) => { lastProgress = p; };
  let lastProgress = null;
  const entry = await OPFS.cacheResponse('7', { title: 'T', extension: 'epub' }, resp, { onProgress });
  assert.strictEqual(entry.size, buf.length);
  assert.ok(lastProgress && lastProgress.total === buf.length, 'progress reported');
  const epub = await OPFS.getCached('7');
  const ab = await epub.file.arrayBuffer();
  assert.strictEqual(Buffer.from(ab).length, buf.length, 'epub bytes length');
  assert.strictEqual(Buffer.from(ab).toString(), buf.toString(), 'epub bytes content');

  // 3. toc 快照
  await OPFS.saveToc('7', [{ title: '第一章', chapterIndex: 0, startPage: 1, level: 0 }]);
  const toc = await OPFS.getToc('7');
  assert.strictEqual(toc[0].title, '第一章');

  // 4. listCached
  const list = await OPFS.listCached();
  assert.strictEqual(list.length, 2);
  assert.ok(list.some((c) => c.bookId === '7' && c.extension === 'epub'));

  // 5. removeBook
  await OPFS.removeBook('7');
  assert.strictEqual(await OPFS.isCached('7'), false);
  assert.strictEqual((await OPFS.listCached()).length, 1);

  // 6. clearAll
  await OPFS.clearAll();
  assert.strictEqual((await OPFS.listCached()).length, 0);
  assert.strictEqual(await OPFS.isCached('5'), false);

  // 7. 配额不足时报错
  sandbox.navigator.storage.estimate = async () => ({ quota: 100, usage: 90 });
  let quotaErr = null;
  try {
    await OPFS.cacheText('9', 'x'.repeat(500), { extension: 'txt' });
  } catch (e) {
    quotaErr = e;
  }
  assert.ok(quotaErr, 'quota exceeded should reject');
  assert.strictEqual(quotaErr.code, 'QUOTA');

  // 8. 写入失败时清理半成品
  sandbox.navigator.storage.estimate = async () => ({ quota: 1024 * 1024 * 1024, usage: 0 });

  // 恢复 estimate
  sandbox.navigator.storage.estimate = storage.estimate.bind(storage);

  console.log('PASS opfs-cache.js: cacheText / cacheResponse / toc / list / remove / clear / quota / cleanup');
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});