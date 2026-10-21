// sw.js

const CACHE_NAME = 'gemini-pwa-cache-v1'; // キャッシュ名を変更すると強制的に更新がかかる場合がある
const urlsToCache = [
  './', // ルートパス (index.html を指すことが多い)
  './index.html',
  './manifest.json',
  './marked.js',
  // アイコンファイルもキャッシュする場合 (manifest.json で指定したもの)
  './icon-192x192.png',
];

// インストール時にキャッシュを作成
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('SW: Opened cache');
        // ネットワーク状況が不安定な場合、addAllが失敗することがある
        // 個別にaddしてエラーを無視するか、必須リソースのみにするなどの考慮も可能
        return cache.addAll(urlsToCache).catch(error => {
          console.error('SW: Failed to cache initial resources during install:', error);
        });
      })
      .then(() => {
        // インストール完了後、すぐにアクティブにする (古いSWを待たない)
        return self.skipWaiting();
      })
  );
});

// フェッチイベントの処理
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // APIリクエスト (Google APIへのPOST) はキャッシュ戦略から除外し、常にネットワークへ
  if (requestUrl.hostname === 'generativelanguage.googleapis.com' && event.request.method === 'POST') {
    event.respondWith(fetch(event.request));
    return; // このリクエストに対するService Workerの処理はここで終了
  }

  // それ以外のリクエスト (主にGET) はキャッシュ優先戦略 (Cache falling back to network)
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // キャッシュヒットした場合
        if (response) {
          // console.log('SW: Serving from cache:', event.request.url);
          return response;
        }

        // キャッシュミスした場合、ネットワークから取得
        // console.log('SW: Fetching from network:', event.request.url);
        return fetch(event.request).then(
          (networkResponse) => {
            // ネットワークから正常に取得できた場合
            // オプション: 取得したリソースをキャッシュに追加する (GETリクエストのみ)
            // ここでは urlsToCache に含まれるものだけを動的にキャッシュする例
            if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
               // urlsToCache に含まれるパスかチェック (完全一致またはルートパス)
               const isCachable = urlsToCache.some(url => {
                   // './' は requestUrl.pathname が '/' または '/index.html' にマッチするかで判断
                   if (url === './') return requestUrl.pathname === '/' || requestUrl.pathname === '/index.html';
                   // それ以外はパス部分が一致するかで判断
                   return requestUrl.pathname.endsWith(url.substring(1)); // './' を除いて比較
               });

               if (isCachable) {
                    // console.log('SW: Caching new resource:', event.request.url);
                    const responseToCache = networkResponse.clone(); // レスポンスは一度しか読めないのでクローンする
                    caches.open(CACHE_NAME)
                      .then(cache => {
                        cache.put(event.request, responseToCache);
                      });
               }
            }
            return networkResponse; // 取得したレスポンスをブラウザに返す
          }
        ).catch(error => {
          // ネットワークフェッチが失敗した場合 (オフラインなど)
          console.error('SW: Fetch failed for:', event.request.url, error);
          // ここでオフライン用の代替レスポンスを返すこともできる
          // 例: return new Response('Network error', { status: 503, statusText: 'Service Unavailable' });
          // ユーザーにオフラインであることを示すための基本的なJSONレスポンス例
          if (event.request.headers.get('accept').includes('application/json')) {
            return new Response(JSON.stringify({ error: 'Offline or network error' }), {
              status: 503, // Service Unavailable
              headers: { 'Content-Type': 'application/json' }
            });
          }
          // HTMLページへのナビゲーションリクエストならオフラインページを返すなど
          // if (event.request.mode === 'navigate') {
          //   return caches.match('./offline.html');
          // }
          // その他の場合は、デフォルトのエラーレスポンスを返す
          return new Response('Network error occurred.', {
            status: 503,
            statusText: 'Service Unavailable'
          });
        });
      })
  );
});

// activateイベントで古いキャッシュを削除 & クライアント制御の要求
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('SW: Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // 新しいService Workerがアクティブになったら、すぐにクライアントを制御する
      return self.clients.claim();
    })
  );
});

// メッセージリスナー (キャッシュクリア用)
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'clearCache') {
    console.log('SW: Clearing cache...');
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          return caches.delete(cacheName);
        })
      );
    }).then(() => {
      console.log('SW: Cache cleared.');
      // クライアントに完了を通知 (任意)
      // event.source is not always available, use clients.matchAll
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
          clients.forEach(client => {
              client.postMessage({ status: 'cacheCleared' });
          });
      });

      // Service Worker自体を更新するために登録解除とリロードを促す
      self.registration.unregister().then(() => {
         console.log('SW: Service Worker unregistered. Reload required.');
         // クライアントにリロードを促すメッセージを送る
         self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
             clients.forEach(client => {
                 client.postMessage({ action: 'reloadPage' });
             });
         });
      });
    }).catch(error => {
      console.error('SW: Failed to clear cache:', error);
       self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
          clients.forEach(client => {
              client.postMessage({ status: 'cacheClearFailed', error: error.message });
          });
      });
    });
  }
});