const CACHE_NAME = 'clima-app-cache-v1'; // Nombre de tu caché (cambia la versión si actualizas archivos)
const urlsToCache = [
  './', // Cacha la página principal
  './index.html',
  './style.css',
  './script.js',
  './images/icon-192x192.png', // Asegúrate de que estos iconos existan
  './images/icon-512x512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/js/all.min.js' // Cacha Font Awesome
  // Agrega aquí cualquier otra imagen, fuente o recurso estático que use tu app
];

// Evento: install (cuando el Service Worker se instala por primera vez)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cacheando archivos de la app');
        return cache.addAll(urlsToCache);
      })
      .catch(error => console.error('Fallo al cachear:', error))
  );
});

// Evento: fetch (cuando el navegador intenta cargar un recurso)
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Si el recurso está en caché, lo devuelve
        if (response) {
          return response;
        }
        // Si no está en caché, intenta obtenerlo de la red
        return fetch(event.request)
          .then(networkResponse => {
            // Puedes decidir cachear nuevos recursos dinámicamente aquí
            // Ejemplo: si es una imagen que no estaba pre-cacheada
            // const responseToCache = networkResponse.clone();
            // caches.open(CACHE_NAME).then(cache => {
            //   cache.put(event.request, responseToCache);
            // });
            return networkResponse;
          })
          .catch(() => {
            // Si falla la red y no está en caché (por ejemplo, para API calls)
            // Aquí podrías servir una página offline o un mensaje de error
            // Si la API no está en caché, simplemente fallará si no hay red, lo cual es esperado.
            console.log('No hay conexión y el recurso no está en caché:', event.request.url);
            // Si tu app del clima necesita la API, sin red no funcionará para nuevas búsquedas.
          });
      })
  );
});

// Evento: activate (cuando un nuevo Service Worker toma el control)
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Eliminando caché antigua:', cacheName);
            return caches.delete(cacheName);
          }
          return null; // Devuelve null si no hay caché para eliminar
        }).filter(Boolean) // Filtra los nulos
      );
    })
  );
});