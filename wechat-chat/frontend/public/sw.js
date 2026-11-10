/* Cache only the non-sensitive offline screen. Never cache APIs, chat data or auth. */
const CACHE = 'komorebi-shell-v1';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/offline.html', '/icon-192.png'])));
  self.skipWaiting();
});
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data;
    try { data = event.data?.json(); } catch { return; }
    if (data?.v !== 1) return;
    const chat = /^[a-f0-9-]{36}$/.test(data.chat_id || '') ? data.chat_id : null;
    if (!chat && data.test !== true) return;
    const clients = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    // Still show a visible notification on foreground pushes (Safari requires
    // this); the in-app sound handles a foreground arrival without double audio.
    await self.registration.showNotification('こもれび', {
      body: data.test ? '通知のテストです。タップするとこもれびを開きます。' : '新しいメッセージが届きました。タップして返信できます。',
      icon:'/icon-192.png', badge:'/icon-192.png', tag:chat ? 'chat-' + chat : 'notification-test',
      renotify:true, silent:!data.test && clients.some(client => client.visibilityState === 'visible' && client.focused),
      data:{chat_id:chat},
    });
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const chat = /^[a-f0-9-]{36}$/.test(event.notification.data?.chat_id || '') ? event.notification.data.chat_id : null;
  const url = chat ? '/?chat=' + encodeURIComponent(chat) : '/';
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    const existing = clients.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.focus();
      if (chat) {
        const channel = new MessageChannel();
        const acknowledged = new Promise(resolve => {
          const timer = setTimeout(() => resolve(false), 1000);
          channel.port1.onmessage = () => { clearTimeout(timer); resolve(true); };
        });
        existing.postMessage({type:'open-chat', chat_id:chat}, [channel.port2]);
        const opened = await acknowledged; channel.port1.close();
        if (opened) return; // Keep the current page and its unsent drafts.
      }
      await existing.navigate(url);
    } else await self.clients.openWindow(url);
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('komorebi-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  // An offline HTML page must never masquerade as an attachment download.
  if (new URL(event.request.url).pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
  }
});
