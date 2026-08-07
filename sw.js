/* ====== 挖空背诵工具 Service Worker ====== */
var CACHE_NAME = 'beisong-trial-v82';

// CDN 静态资源（缓存优先）
var CDN_URLS = [
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
  'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js'
];

// 安装：预缓存 CDN 资源
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return Promise.allSettled(
        CDN_URLS.map(function(url) {
          return cache.add(url).catch(function() {});
        })
      );
    })
  );
  self.skipWaiting();
});

// 激活：清理旧缓存
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// 请求拦截
self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET' || e.request.url.indexOf('chrome-extension:') === 0) return;

  // CDN 资源：缓存优先
  if (/jsdelivr/.test(e.request.url)) {
    e.respondWith(
      caches.match(e.request).then(function(cached) {
        return cached || fetch(e.request).then(function(response) {
          if (response && response.status === 200) {
            var cloned = response.clone();
            caches.open(CACHE_NAME).then(function(c) { c.put(e.request, cloned); });
          }
          return response;
        });
      })
    );
    return;
  }

  // 自有文件：网络优先，成功后自动缓存，网络失败时回退缓存
  // 首次访问成功后，下次即使 GitHub Pages 不可达也能从缓存打开
  e.respondWith(
    fetch(e.request).then(function(response) {
      if (response && response.status === 200) {
        var cloned = response.clone();
        caches.open(CACHE_NAME).then(function(c) { c.put(e.request, cloned); });
      }
      return response;
    }).catch(function() {
      return caches.match(e.request).then(function(r) { return r || Response.error(); });
    })
  );
});
