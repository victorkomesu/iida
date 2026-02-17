// ============================================================
// IIDA — Service Worker (sw.js)
// Estratégia: Cache-First para recursos estáticos,
//             Network-First para dados do Google
// ============================================================

const CACHE_NAME    = 'iida-v58';
const CACHE_STATIC  = 'iida-static-v58';
const CACHE_DYNAMIC = 'iida-dynamic-v1';

// Arquivos que SEMPRE ficam em cache (o app principal)
const ARQUIVOS_ESSENCIAIS = [
    './',
    './index.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

// ============================================================
// INSTALAÇÃO — baixa e guarda todos os arquivos essenciais
// ============================================================
self.addEventListener('install', event => {
    console.log('[SW] Instalando IIDA v58...');
    event.waitUntil(
        caches.open(CACHE_STATIC)
            .then(cache => {
                console.log('[SW] Cacheando arquivos essenciais...');
                // skipWaiting garante que o novo SW assume imediatamente
                return cache.addAll(ARQUIVOS_ESSENCIAIS).then(() => self.skipWaiting());
            })
            .catch(err => {
                // Se algum arquivo falhar, não trava a instalação
                console.warn('[SW] Alguns arquivos não foram cacheados:', err);
                return self.skipWaiting();
            })
    );
});

// ============================================================
// ATIVAÇÃO — limpa caches antigos de versões anteriores
// ============================================================
self.addEventListener('activate', event => {
    console.log('[SW] Ativando IIDA v58...');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_STATIC && name !== CACHE_DYNAMIC)
                    .map(name => {
                        console.log('[SW] Removendo cache antigo:', name);
                        return caches.delete(name);
                    })
            );
        }).then(() => self.clients.claim()) // Assume controle de todas as abas abertas
    );
});

// ============================================================
// FETCH — intercepta todas as requisições
// ============================================================
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // 1. Requisições para o Google Apps Script → SEMPRE tenta a rede
    //    Se falhar → retorna erro claro (não tenta servir do cache)
    if (url.hostname.includes('script.google.com')) {
        event.respondWith(networkOnlyComFallback(event.request));
        return;
    }

    // 2. Requisições para Google Fonts e CDN → Cache-First
    //    Carrega do cache, se não tiver, baixa e guarda
    if (url.hostname.includes('fonts.googleapis.com') ||
        url.hostname.includes('fonts.gstatic.com') ||
        url.hostname.includes('cdnjs.cloudflare.com')) {
        event.respondWith(cacheFirst(event.request));
        return;
    }

    // 3. Arquivos do próprio app (HTML, JS, ícones) → Cache-First com atualização em background
    if (url.hostname === self.location.hostname || url.protocol === 'file:') {
        event.respondWith(staleWhileRevalidate(event.request));
        return;
    }

    // 4. Qualquer outra coisa → tenta a rede, usa cache como fallback
    event.respondWith(networkFirst(event.request));
});

// ============================================================
// ESTRATÉGIAS DE CACHE
// ============================================================

// Cache-First: serve do cache, busca na rede só se não tiver
async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_DYNAMIC);
            cache.put(request, response.clone());
        }
        return response;
    } catch (err) {
        return new Response('Recurso não disponível offline', { status: 503 });
    }
}

// Network-First: tenta a rede, usa cache se falhar
async function networkFirst(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_DYNAMIC);
            cache.put(request, response.clone());
        }
        return response;
    } catch (err) {
        const cached = await caches.match(request);
        return cached || new Response('Sem conexão', { status: 503 });
    }
}

// Stale-While-Revalidate: serve do cache imediatamente E atualiza em background
async function staleWhileRevalidate(request) {
    const cache  = await caches.open(CACHE_STATIC);
    const cached = await cache.match(request);

    // Atualiza em background (não bloqueia o carregamento)
    const fetchPromise = fetch(request).then(response => {
        if (response.ok) cache.put(request, response.clone());
        return response;
    }).catch(() => null);

    // Retorna cache imediatamente se tiver, senão espera a rede
    return cached || fetchPromise;
}

// Network-Only com fallback de erro amigável (para o Google Script)
async function networkOnlyComFallback(request) {
    try {
        return await fetch(request);
    } catch (err) {
        // Retorna um JSON de erro para o app tratar adequadamente
        return new Response(
            JSON.stringify({ erro: true, mensagem: 'Sem conexão com o servidor Google' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
    }
}

// ============================================================
// SINCRONIZAÇÃO EM BACKGROUND (Background Sync)
// Tenta reenviar a fila quando a conexão voltar
// ============================================================
self.addEventListener('sync', event => {
    if (event.tag === 'iida-sync-fila') {
        console.log('[SW] Background Sync disparado — tentando reenviar fila...');
        event.waitUntil(tentarReenviarFila());
    }
});

async function tentarReenviarFila() {
    // Notifica o app principal para processar a fila
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
        client.postMessage({ tipo: 'PROCESSAR_FILA' });
    });
}

// ============================================================
// NOTIFICAÇÕES PUSH (preparado para uso futuro)
// ============================================================
self.addEventListener('push', event => {
    if (!event.data) return;
    const data = event.data.json();
    self.registration.showNotification(data.titulo || 'IIDA', {
        body:    data.mensagem || 'Nova notificação',
        icon:    './icon-192.png',
        badge:   './icon-192.png',
        vibrate: [200, 100, 200],
        data:    { url: data.url || './' }
    });
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(
        clients.openWindow(event.notification.data.url)
    );
});
