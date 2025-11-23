// Service Worker for Italian Recipes PWA - Phase 3: Real Recipe Images
const CACHE_NAME = 'italian-recipes-v3.0.0';
const STATIC_CACHE = 'italian-recipes-static-v3.0.0';
const DYNAMIC_CACHE = 'italian-recipes-dynamic-v3.0.0';

// Assets to cache immediately
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    'https://fonts.googleapis.com/css2?family=Lora:wght@400;500;600&family=Source+Serif+Pro:wght@400;600&family=Inter:wght@400;500;600&display=swap',
    // Icons will be added dynamically
];

// Cache size limits
const MAX_CACHE_ITEMS = 100;
const MAX_IMAGE_CACHE_SIZE = 50;

// Install event - cache static assets
self.addEventListener('install', event => {
    console.log('[SW] Installing Service Worker...');
    
    event.waitUntil(
        Promise.all([
            caches.open(STATIC_CACHE).then(cache => {
                console.log('[SW] Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            }),
            self.skipWaiting()
        ])
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
    console.log('[SW] Activating Service Worker...');
    
    event.waitUntil(
        Promise.all([
            // Clean up old caches
            caches.keys().then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== STATIC_CACHE && 
                            cacheName !== DYNAMIC_CACHE &&
                            cacheName !== CACHE_NAME) {
                            console.log('[SW] Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            }),
            // Claim all clients immediately
            self.clients.claim()
        ])
    );
});

// Fetch event - implement cache strategies
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);
    
    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }
    
    // Skip chrome-extension requests
    if (url.protocol === 'chrome-extension:') {
        return;
    }
    
    event.respondWith(
        handleFetchRequest(request)
    );
});

// Handle different types of requests with appropriate strategies
async function handleFetchRequest(request) {
    const url = new URL(request.url);
    
    // Strategy 1: Cache first for static assets (CSS, JS, fonts)
    if (isStaticAsset(request)) {
        return cacheFirst(request, STATIC_CACHE);
    }
    
    // Strategy 2: Network first for HTML pages
    if (isHTMLRequest(request)) {
        return networkFirst(request, DYNAMIC_CACHE);
    }
    
    // Strategy 3: Cache first for images
    if (isImageRequest(request)) {
        return cacheFirst(request, DYNAMIC_CACHE, MAX_IMAGE_CACHE_SIZE);
    }
    
    // Strategy 4: Network first for API requests
    if (isAPIRequest(request)) {
        return networkFirst(request, DYNAMIC_CACHE);
    }
    
    // Default: Stale while revalidate
    return staleWhileRevalidate(request, DYNAMIC_CACHE);
}

// Cache First Strategy
async function cacheFirst(request, cacheName, maxItems = MAX_CACHE_ITEMS) {
    try {
        const cache = await caches.open(cacheName);
        const cachedResponse = await cache.match(request);
        
        if (cachedResponse) {
            // Return cached version immediately
            updateCacheInBackground(request, cache);
            return cachedResponse;
        }
        
        // If not in cache, fetch from network
        const networkResponse = await fetch(request);
        
        if (networkResponse.ok) {
            // Cache the new response
            await cache.put(request, networkResponse.clone());
            
            // Limit cache size
            await limitCacheSize(cache, maxItems);
        }
        
        return networkResponse;
    } catch (error) {
        console.error('[SW] Cache first error:', error);
        
        // Return offline fallback if available
        return getOfflineFallback(request);
    }
}

// Network First Strategy
async function networkFirst(request, cacheName) {
    try {
        const networkResponse = await fetch(request);
        
        if (networkResponse.ok) {
            // Cache successful responses
            const cache = await caches.open(cacheName);
            await cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
    } catch (error) {
        console.log('[SW] Network first, falling back to cache:', request.url);
        
        // Try to return cached version
        const cache = await caches.open(cacheName);
        const cachedResponse = await cache.match(request);
        
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // Return offline fallback
        return getOfflineFallback(request);
    }
}

// Stale While Revalidate Strategy
async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(request);
    
    // Start fetching from network in background
    const fetchPromise = fetch(request).then(networkResponse => {
        if (networkResponse.ok) {
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    }).catch(error => {
        console.log('[SW] Stale while revalidate fetch failed:', error);
        return null;
    });
    
    // Return cached version immediately if available
    if (cachedResponse) {
        // Don't await the background fetch
        return cachedResponse;
    }
    
    // If no cached version, wait for network
    const networkResponse = await fetchPromise;
    if (networkResponse) {
        return networkResponse;
    }
    
    // Final fallback
    return getOfflineFallback(request);
}

// Update cache in background
async function updateCacheInBackground(request, cache) {
    try {
        const networkResponse = await fetch(request);
        if (networkResponse.ok) {
            await cache.put(request, networkResponse);
        }
    } catch (error) {
        // Silently fail for background updates
        console.log('[SW] Background cache update failed:', error);
    }
}

// Limit cache size
async function limitCacheSize(cache, maxItems) {
    const keys = await cache.keys();
    
    if (keys.length > maxItems) {
        // Delete oldest entries
        const keysToDelete = keys.slice(0, keys.length - maxItems);
        await Promise.all(
            keysToDelete.map(key => cache.delete(key))
        );
    }
}

// Check if request is for static assets
function isStaticAsset(request) {
    const url = new URL(request.url);
    return url.pathname.endsWith('.css') ||
           url.pathname.endsWith('.js') ||
           url.pathname.endsWith('.woff') ||
           url.pathname.endsWith('.woff2') ||
           url.pathname.includes('fonts.googleapis.com') ||
           url.pathname.includes('fonts.gstatic.com');
}

// Check if request is for HTML
function isHTMLRequest(request) {
    const url = new URL(request.url);
    return url.pathname.endsWith('.html') ||
           url.pathname === '/' ||
           request.headers.get('accept')?.includes('text/html');
}

// Check if request is for images
function isImageRequest(request) {
    const url = new URL(request.url);
    return request.destination === 'image' ||
           url.pathname.match(/\.(png|jpg|jpeg|gif|svg|webp|ico)$/i);
}

// Check if request is for API
function isAPIRequest(request) {
    const url = new URL(request.url);
    return url.pathname.includes('/api/') ||
           url.pathname.includes('api.') ||
           request.headers.get('accept')?.includes('application/json');
}

// Get offline fallback
function getOfflineFallback(request) {
    const url = new URL(request.url);
    
    // Return cached HTML for navigation requests
    if (isHTMLRequest(request)) {
        return caches.match('/index.html') || new Response(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Offline - Italian Recipes</title>
                <style>
                    body { 
                        font-family: Arial, sans-serif; 
                        text-align: center; 
                        padding: 50px; 
                        background: #F9F6F4; 
                        color: #1F1B1A;
                    }
                    .offline-message {
                        max-width: 400px;
                        margin: 0 auto;
                    }
                    h1 { color: #B71C1C; }
                    p { color: #5D5552; }
                </style>
            </head>
            <body>
                <div class="offline-message">
                    <h1>🍝 You're Offline</h1>
                    <p>Check your internet connection. Cached recipes are still available!</p>
                </div>
            </body>
            </html>
        `, {
            headers: { 'Content-Type': 'text/html' }
        });
    }
    
    // Return offline image for image requests
    if (isImageRequest(request)) {
        return new Response(
            createOfflineImageSVG(),
            { 
                headers: { 
                    'Content-Type': 'image/svg+xml',
                    'Cache-Control': 'no-cache'
                }
            }
        );
    }
    
    // Default offline response
    return new Response('Content not available offline', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'text/plain' }
    });
}

// Create offline image SVG
function createOfflineImageSVG() {
    return `
        <svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
            <rect width="200" height="200" fill="#F4F1DE"/>
            <circle cx="100" cy="100" r="40" fill="#E07A5F" opacity="0.6"/>
            <text x="100" y="180" text-anchor="middle" fill="#5D5552" font-family="Arial" font-size="12">Offline</text>
        </svg>
    `;
}

// Handle push notifications (for future features)
self.addEventListener('push', event => {
    const options = {
        body: event.data ? event.data.text() : 'New Italian recipes available!',
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
        vibrate: [100, 50, 100],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: 1
        },
        actions: [
            {
                action: 'explore', 
                title: 'Browse Recipes',
                icon: '/icons/icon-96x96.png'
            },
            {
                action: 'close', 
                title: 'Close',
                icon: '/icons/icon-72x72.png'
            }
        ]
    };
    
    event.waitUntil(
        self.registration.showNotification('Italian Recipes', options)
    );
});

// Handle notification clicks
self.addEventListener('notificationclick', event => {
    event.notification.close();
    
    if (event.action === 'explore') {
        event.waitUntil(
            clients.openWindow('/')
        );
    }
});

// Handle sync events (for future offline features)
self.addEventListener('sync', event => {
    if (event.tag === 'background-sync-recipes') {
        event.waitUntil(
            syncRecipes()
        );
    }
});

// Background sync function (placeholder for future features)
async function syncRecipes() {
    try {
        // Future: sync recipes data when back online
        console.log('[SW] Background sync completed');
    } catch (error) {
        console.error('[SW] Background sync failed:', error);
    }
}

console.log('[SW] Service Worker loaded successfully');