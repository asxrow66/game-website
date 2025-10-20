// In: game-website/hub/proxy/sw.js

// IMPORT THE MAIN LOGIC FILE YOU UPLOADED (index.js)
importScripts('/index.js'); 

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

async function handleRequest(event) {
  // Use the renamed scramjet.config.js file for configuration
  await scramjet.loadConfig('scramjet.config.js'); 
  if (scramjet.route(event)) {
    return scramjet.fetch(event);
  }
  return fetch(event.request);
}

self.addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event));
});