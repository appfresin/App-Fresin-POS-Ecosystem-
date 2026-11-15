// Notification delivery only: no cache or request interception.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const destination = new URL('./', self.registration.scope);
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = tabs.find(tab => tab.url.startsWith(destination.href));
    if (existing) { existing.postMessage({ type: 'driver-open-orders' }); return existing.focus(); }
    return self.clients.openWindow(destination.href);
  })());
});
