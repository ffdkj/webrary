const CACHE_NAME = 'webrary-shell-v9';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/reader.html',
  '/css/style.css',
  '/js/app.js',
  '/js/pwa.js',
  '/js/reader.js',
  '/js/opfs-cache.js',
  '/js/txt-pagination.js',
  '/vendor/jszip.min.js',
  '/vendor/epub.min.js',
  '/manifest.json',
  '/icons/webrary.svg',
  '/icons/favicon-16.png',
  '/icons/favicon-32.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

/**
 * 离线书籍文件存储于 OPFS（Origin Private File System），
 * 由主线程的 opfs-cache.js 负责读写，Service Worker 不直接干预，
 * 以避免 SW 与页面存储分区不一致带来的读取失败。
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API 与上传文件保持 Network Only，避免读到过期业务数据。
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          // 离线时兜底：先命中精确缓存（ignoreSearch 匹配 reader.html 等），再退回首页
          caches.match(request, { ignoreSearch: true }).then((cached) => {
            if (cached) return cached;
            return caches.match('/index.html');
          })
        )
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});