const CACHE="bloom-v22";
const SHELL=["./index.html","./app.js","./config.js","./manifest.json","./colombia.js","./logo-bloom.svg","./icon-192.png","./icon-512.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
self.addEventListener("fetch",e=>{
  const u=e.request.url;
  if(u.includes("supabase.co")||u.includes("workers.dev")||u.includes("graph.facebook"))return;
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
