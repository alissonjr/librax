/*
 * Lembretes por Web Push no service worker (src/lib/reminders.ts). Entra no service worker gerado
 * pelo vite-plugin-pwa por importScripts (vite.config.ts). A mensagem vem da Lambda de lembrete
 * (services/api/src/usecases/sendReminders.js): { title, body, url, tag }. O toque abre o app no
 * endereço do lembrete, reaproveitando uma janela aberta.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Librax';
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    icon: '/icon-192.png',
    tag: typeof data.tag === 'string' ? data.tag : 'librax',
    data: { url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((janelas) => {
      const janela = janelas.find((j) => new URL(j.url).origin === self.location.origin);
      if (!janela) return self.clients.openWindow(url);
      return janela
        .focus()
        .then((focada) => (focada ?? janela).navigate(url))
        .catch(() => self.clients.openWindow(url));
    }),
  );
});
