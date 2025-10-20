// In: game-website/hub/proxy/scramjet.config.js

let _CONFIG = {
  // FINAL BARE SERVER URL
  bare: 'https://aluu.xyz/bare/', 
  
  // Define the service worker prefix for Vercel rewrites
  prefix: '/hub/service/', 
  
  // Paths for Scramjet files:
  handler: '/hub/proxy/index.js',
  bundle: '/hub/proxy/index.js',
  config: '/hub/proxy/scramjet.config.js',
  sw: '/hub/proxy/sw.js',
  
  // Paths for missing files (relying on Vercel rewrites for /scram/)
  files: {
    wasm: '/scram/scramjet.wasm.wasm',
    all: '/scram/scramjet.all.js',
    sync: '/scram/scramjet.sync.js',
  },
};