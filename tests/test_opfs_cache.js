/**
 * test_opfs_cache.js — 在 Node 中端到端验证 opfs-cache.js
 *
 * 覆盖三种存储环境：
 *   1. OPFS 完整能力（getDirectory + createWritable + getFile）
 *   2. OPFS 半实现（Safari/iOS 15.2–16.x：有 getDirectory/getFileHandle，
 *      但没有 createWritable）→ 应自动降级到 Cache Storage
 *   3. 无 OPFS，仅 Cache Storage
 *
 * 运行：node tests/test_opfs_cache.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const code = fs.readFileSync(
  path.join(__dirname, '..', 'static', 'js', 'opfs-cache.js'),
  'utf8'
);

/* ---------- 内存 OPFS shim ---------- */
function createDir(usage, capabilities) {
  const cap = capabilities || { createWritable: true, getFile: true };
  const makeNode = () => ({ dirs: {}, files: {} });
  const rootNode = makeNode();
  const makeHandle = (node) => ({
    getDirectoryHandle: async (name, opts) => {
      if (node.dirs[name]) return makeHandle(node.dirs[name]);
      if (opts && opts.create) {
        node.dirs[name] = makeNode();
        return makeHandle(node.dirs[name]);
      }
      throw new Error(`NOT_FOUND dir ${name}`);
    },
    getFileHandle: async (name, opts) => {
      if (node.files[name]) return fileServer(node.files[name], usage, cap);
      if (opts && opts.create) {
        node.files[name] = { bytes: Buffer.alloc(0) };
        return fileServer(node.files[name], usage, cap);
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
  });
  return makeHandle(rootNode);
}

function fileServer(file, usage, capabilities) {
  return {
    createWritable: capabilities.createWritable
      ? async () => {
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
      }
      : undefined,
    getFile: capabilities.getFile
      ? async () => ({
        size: file.bytes.length,
        text: async () => file.bytes.toString('utf8'),
        arrayBuffer: async () => file.bytes.buffer.slice(
          file.bytes.byteOffset,
          file.bytes.byteOffset + file.bytes.byteLength
        )
      })
      : undefined
  };
}

/* ---------- 内存 Cache Storage shim ---------- */
function makeCaches() {
  const stores = new Map(); // cacheName -> Map(key -> Response)
  // 真实浏览器要求 key 必须是 http(s) URL，这里同样强制校验，防止回归
  function assertHttp(key) {
    const s = String(key);
    if (!/^https?:\/\//i.test(s)) {
      throw new TypeError(`Request url is not http or https: ${s}`);
    }
    return s;
  }
  return {
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      return makeCache(stores.get(name), assertHttp);
    }
  };
  function makeCache(map, assertHttp) {
    return {
      put: async (key, response) => { map.set(assertHttp(key), response); },
      match: async (key) => {
        const r = map.get(assertHttp(key));
        return r ? r.clone() : undefined;
      },
      keys: async () => Array.from(map.keys()),
      delete: async (key) => map.delete(assertHttp(key))
    };
  }
}

/* ---------- 加载库到指定环境 ---------- */
function loadLib(env) {
  const usage = { total: 0 };
  let storage;
  let cachesShim;
  const cap = {
    createWritable: env.opfs !== 'partial',
    getFile: env.opfs !== 'partial'
  };

  if (env.opfs === 'full' || env.opfs === 'partial') {
    storage = {
      getDirectory: async () => createDir(usage, cap),
      estimate: async () => ({ quota: 1024 * 1024 * 1024, usage: usage.total })
    };
  } else {
    storage = { estimate: async () => ({ quota: 1024 * 1024 * 1024, usage: usage.total }) };
  }

  const sandbox = {
    console,
    TextEncoder,
    TextDecoder,
    Response: globalThis.Response,
    Blob: globalThis.Blob,
    fetch: globalThis.fetch.bind(globalThis),
    navigator: { storage },
    location: { origin: 'https://test.local' },
    setTimeout,
    clearTimeout
  };
  if (env.caches) {
    cachesShim = makeCaches();
    sandbox.caches = cachesShim;
  }
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { OPFS: sandbox.window.WebraryOPFS, usage };
}

/* ---------- 通用断言 ---------- */
async function runScenario(label, env) {
  const { OPFS } = loadLib(env);
  assert.ok(OPFS, 'WebraryOPFS exposed');
  assert.strictEqual(OPFS.isSupported, true, `${label}: isSupported`);

  // cacheText + isCached + getCached + text round-trip
  const text = '第一章 开始\n' + ('内容'.repeat(500) + '\n').repeat(30);
  await OPFS.cacheText('5', text, { title: '样例', author: 'A', extension: 'txt' });
  assert.strictEqual(await OPFS.isCached('5'), true, `${label}: isCached`);
  const cached = await OPFS.getCached('5');
  assert.ok(cached && cached.file, `${label}: getCached returns file`);
  assert.strictEqual(await cached.file.text(), text, `${label}: text round-trip`);
  assert.strictEqual(cached.meta.title, '样例');

  // cacheResponse：流式写入（真实 Response）
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
  let lastProgress = null;
  await OPFS.cacheResponse('7', { title: 'T', extension: 'epub' }, resp, {
    onProgress: (p) => { lastProgress = p; }
  });
  assert.ok(lastProgress && lastProgress.total === buf.length, `${label}: progress reported`);
  const epub = await OPFS.getCached('7');
  const ab = await epub.file.arrayBuffer();
  assert.strictEqual(Buffer.from(ab).length, buf.length, `${label}: epub length`);
  assert.strictEqual(Buffer.from(ab).toString(), buf.toString(), `${label}: epub content`);

  // toc 快照
  await OPFS.saveToc('7', [{ title: '第一章', chapterIndex: 0, startPage: 1, level: 0 }]);
  const toc = await OPFS.getToc('7');
  assert.strictEqual(toc[0].title, '第一章');

  // listCached
  const list = await OPFS.listCached();
  assert.strictEqual(list.length, 2, `${label}: list length`);
  assert.ok(list.some((c) => c.bookId === '7' && c.extension === 'epub'));

  // removeBook
  await OPFS.removeBook('7');
  assert.strictEqual(await OPFS.isCached('7'), false, `${label}: removed`);
  assert.strictEqual((await OPFS.listCached()).length, 1);

  // clearAll
  await OPFS.clearAll();
  assert.strictEqual((await OPFS.listCached()).length, 0, `${label}: cleared`);
  console.log(`PASS ${label}`);
}

async function main() {
  await runScenario('opfs-full', { opfs: 'full', caches: false });
  await runScenario('opfs-partial->caches (Safari-like)', { opfs: 'partial', caches: true });
  await runScenario('caches-only', { opfs: 'none', caches: true });
  console.log('\nAll OPFS cache scenarios passed.');
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});