/* ====== 挖空背诵工具 Service Worker ====== */
/* v147 策略变更：页面文件改为【缓存优先】——
   打开时优先用本地已缓存的版本，不会自动变成新版；
   只有用户点「立即更新」时前端清缓存+刷新，才切换到新版。
   数据（题库/错题/激活状态）存在 localStorage，与文件缓存无关，不受影响。 */
var CACHE_NAME = 'beisong-trial-v147';

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

// 激活：【不清缓存】。缓存优先策略下，旧版本文件缓存必须保留，
// 否则用户不点更新也会在下一次打开时被迫拿到网络新版。
// 清理时机由用户点「立即更新」时前端 caches.delete 完成。
self.addEventListener('activate', function(e) {
  e.waitUntil(self.clients.claim());
});

// 请求拦截
self.addEventListener('fetch', function(e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = req.url;
  if (url.indexOf('chrome-extension:') === 0 || url.indexOf('blob:') === 0) return;

  // CDN 资源：缓存优先（不变）
  if (/jsdelivr/.test(url)) {
    e.respondWith(
      caches.match(req).then(function(cached) {
        return cached || fetch(req).then(function(response) {
          if (response && response.status === 200) {
            var cloned = response.clone();
            caches.open(CACHE_NAME).then(function(c) { c.put(req, cloned); });
          }
          return response;
        });
      })
    );
    return;
  }

  // ===== 必须走网络的请求（保持实时）=====
  // 1. version.json —— 版本检测，必须每次拉最新，否则红点永远不亮
  // 2. codes.json —— 激活码表，必须实时（新码/恢复码即时生效）
  // 3. sw.js 自身 —— 保险
  // 4. 带查询参数（如 codes.json?t=xxx）—— 前端主动防缓存，直通网络
  if (/\/version\.json/.test(url) || /\/codes\.json/.test(url) || /\/sw\.js/.test(url) || url.indexOf('?') !== -1) {
    e.respondWith(fetch(req));
    return;
  }

  // ===== 自有文件：缓存优先 =====
  // 命中缓存直接返回旧版；未命中（首次访问或用户点过立即更新）才拉网络并缓存
  e.respondWith(
    caches.match(req).then(function(cached) {
      if (cached) return cached;
      return fetch(req).then(function(response) {
        if (response && response.status === 200) {
          var cloned = response.clone();
          caches.open(CACHE_NAME).then(function(c) { c.put(req, cloned); });
        }
        return response;
      }).catch(function() {
        return Response.error();
      });
    })
  );
});
