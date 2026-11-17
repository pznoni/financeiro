// sw.js — service worker: pré-cache de todos os arquivos e funcionamento offline.
// A cada publicação, INCREMENTE CACHE_VERSION (e APP_VERSION em js/version.js).
const CACHE_VERSION = 'financeiro-v1';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/backup.js',
  './js/db.js',
  './js/finance.js',
  './js/state.js',
  './js/util.js',
  './js/version.js',
  './js/ui/ajustes.js',
  './js/ui/cartoes.js',
  './js/ui/components.js',
  './js/ui/fixas.js',
  './js/ui/form-lancamento.js',
  './js/ui/historico.js',
  './js/ui/inicio.js',
  './js/ui/lancamentos.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Instala: baixa tudo (sem usar o cache HTTP, para não guardar arquivo antigo).
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))),
  );
  // Não chama skipWaiting aqui: a página mostra "Nova versão disponível" e o usuário decide.
});

// Ativa: apaga caches de versões anteriores.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// A página pede para trocar de versão quando o usuário toca em "Atualizar".
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// Cache-first para os arquivos do app; navegações caem no index.html quando offline.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      return await fetch(request);
    } catch (err) {
      if (request.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
