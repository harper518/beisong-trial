/* ====== 挖空背诵工具 Service Worker ====== */
/* v147 策略变更：页面文件改为【缓存优先】——
   打开时优先用本地已缓存的版本，不会自动变成新版；
   只有用户点「立即更新」时前端清缓存+刷新，才切换到新版。
   数据（题库/错题/激活状态）存在 localStorage，与文件缓存无关，不受影响。

   🐞 2026-09-19 v179 —— 补**离线兜底**（用户原话：「不要一更新 别人安装桌面的变成白屏了」）。
   改之前有三个洞，任何一个撞上就是白屏：
     ① **从来不预缓存「页面本体」** —— 全文件不出现 index.html 这个词，
        三处 `caches.match(req)` 的实参全是 req，**没有一处回退到 `/`**。
        → 装到桌面后第一次点图标时没信号 = 白屏，而且重试无效（每次都是零缓存）。
     ② 自有文件分支唯一的兜底是 `Response.error()` —— 对**打开页面**这种请求就是白屏。
     ③ 「任何带 `?` 的网址」一刀切直通网络、**连导航请求也一样**，还没有 `.catch()`。
        → 谁从带查询串的地址「添加到主屏幕」，那台设备从此离线必白屏。
   ⚠️ 改这些**没有动「缓存优先」这个产品约定**：
      不点「立即更新」照样不会自动变新版（见下面 install 里「从旧缓存复制」而不是重新联网抓）。 */
// 🆕 v183：上面那句「每一次升版都要跟着换」是**过时的、会误导人**（以前这么写，其实不对）：
//   · 页面改版【不靠】这个名字 —— 前端用的是自己那套 `beisong-shell-v<APP_VERSION>` 缓存，
//     用户点「立即更新」时会把所有旧缓存都清掉。
//   · 所以 sw.js 自己没改的那些版本（v180 ~ v182 都是），这个名字**本来就该停在 v179**。
//   ⚠️ **只在 sw.js 自己的逻辑改了内容时**，才要换这个名字 —— 换名字会让下面的 CDN 资源重新下一遍。
//     只改注释、不动逻辑 → **不用换**。
var CACHE_NAME = 'beisong-trial-v183';

// CDN 静态资源（缓存优先）
var CDN_URLS = [
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
  'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js'
];

// 安装：预缓存 CDN 资源 ＋ **把页面本体从旧缓存「复制」到新缓存**
//  ⚠️ 是「复制」不是「重新联网抓」——
//     重新抓会拿到线上最新版 = 用户不点更新也自动变新版，**违背「缓存优先」的约定**。
//     复制则完全守住约定：用户不点更新，拿到的还是他原来那份。
//  ⚠️ 复制不到也没关系（第一次装、或缓存被清过），照样往下走。
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      var jobs = CDN_URLS.map(function(url) {
        return cache.add(url).catch(function() {});
      });
      // 页面本体：先从旧缓存里找（`/` 和 `/index.html` 两种 key 都试）
      jobs.push(
        caches.keys().then(function(names) {
          var found = null;
          return names.reduce(function(chain, name) {
            if (name === CACHE_NAME) return chain;
            return chain.then(function() {
              if (found) return;
              return caches.open(name).then(function(old) {
                return old.match('/').then(function(r) { return r || old.match('/index.html'); })
                  .then(function(r) { if (r) found = r; });
              }).catch(function() {});
            });
          }, Promise.resolve()).then(function() {
            if (found) return cache.put('/', found).catch(function() {});
          });
        }).catch(function() {})
      );
      return Promise.allSettled(jobs);
    })
  );
  self.skipWaiting();
});

// 激活：【不清缓存】。缓存优先策略下，旧版本文件缓存必须保留，
// 否则用户不点更新也会在下一次下一次打开时被迫拿到网络新版。
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

  // 🐞 v179：导航请求（打开/刷新页面）单独拎出来，**永远给兜底**。
  //   改之前它跟别的请求混在一起，一旦缓存是空的就只能交网络错误 → 白屏。
  // ⚠️ 对 req.headers 加守卫：真浏览器里 Request.headers 一定存在，
  //    但这里在**每一次请求**上都会走 —— 万一它不存在就是 SW 全线抛错、整站打不开。
  //    （测试桩里就没有 headers，被 sw_route_test.js 当场抓出来。）
  var isNav = (req.mode === 'navigate') ||
              !!(req.headers && req.headers.get && (req.headers.get('accept') || '').indexOf('text/html') !== -1);

  // CDN 资源：缓存优先（不变）
  // 🆕 v183 D1：公式引擎（MathJax）走的是多源兜底，兜底源里有 unpkg / elemecdn ——
  //   它们不在这条「jsdelivr」判据里，不补上就会「第一次下到了、第二次还是要联网」。
  //   这几个域名在这个工具里**只用来取 CDN 静态资源**（pdfjs / mammoth / d3 / mathjax），不会缓存别的东西。
  if (/jsdelivr|unpkg|elemecdn/.test(url)) {
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
  // 🐞 v179：「带 ? 就直通网络」这条**收窄成只对非导航请求生效**。
  //   原来它连「打开页面」这种请求也一起直通了（还没有 .catch）——
  //   谁从带查询串的地址加到桌面，那台设备从此离线必白屏。导航请求走下面的兜底。
  if (!isNav && (/\/version\.json/.test(url) || /\/codes\.json/.test(url) || /\/sw\.js/.test(url) || url.indexOf('?') !== -1)) {
    e.respondWith(fetch(req).catch(function() {
      // 断网时：这几个文件拿不到就拿不到，前端自己有 catch；
      // 但**导航请求已经被上面排除**，不会走到这儿
      return caches.match(req);
    }));
    return;
  }

  // ===== 冲刺背诵清单：网络优先 =====
  var plainUrl = url;
  try { plainUrl = decodeURIComponent(url); } catch (err) {}
  if (/chongci|yuanban|冲刺背诵清单/.test(plainUrl)) {
    e.respondWith(
      fetch(req).then(function(response) {
        if (response && response.status === 200) {
          var cloned = response.clone();
          caches.open(CACHE_NAME).then(function(c) { c.put(req, cloned); });
        }
        return response;
      }).catch(function() {
        return caches.match(req).then(function(r) { return r || offlineFallback(isNav); });
      })
    );
    return;
  }

  // ===== 自有文件：缓存优先 =====
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
        // 🐞 v179：兜底从 `Response.error()` 改成「**回退到缓存的首页**」。
        //   原来那个对「打开页面」这种请求 = 交白卷 = 白屏。
        //   现在：缓存里只要有首页（`/` 或 `/index.html`），断网也打得开。
        return caches.match('/').then(function(r) {
          return r || caches.match('/index.html');
        }).then(function(r) {
          return r || offlineFallback(isNav);
        });
      });
    })
  );
});

// 🐞 v179：连缓存里也没有首页时（第一次装 + 没网），至少给一句人话，
//   别把浏览器那个「网页无法打开」/ iOS 的纯白屏甩给用户。
//   非导航请求（图片、json 之类）还是返回网络错误，别拿 HTML 冒充它们。
function offlineFallback(isNav) {
  if (!isNav) return Response.error();
  return new Response(
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>暂时连不上</title></head>' +
    '<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,\'PingFang SC\',\'Microsoft YaHei\',sans-serif;' +
    'background:#f0fdfa;color:#134e4a;display:flex;align-items:center;justify-content:center;min-height:100dvh;padding:24px;box-sizing:border-box">' +
    '<div style="text-align:center;max-width:340px">' +
    '<div style="font-size:44px;margin-bottom:12px">📶</div>' +
    '<h2 style="margin:0 0 10px;font-size:18px">现在连不上网</h2>' +
    '<p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#5f8b89">' +
    '这台设备上还没有存下工具的离线副本。<br>联网之后打开一次，以后就能离线用了。</p>' +
    '<button onclick="location.reload()" style="padding:12px 28px;background:#0891b2;color:#fff;border:none;' +
    'border-radius:10px;font-size:15px;font-weight:600;min-height:44px">重新加载</button>' +
    '<p style="margin:16px 0 0;font-size:12px;color:#99b8b6">你的题库和学习记录都存在本机，不会因此丢失。</p>' +
    '</div></body></html>',
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
