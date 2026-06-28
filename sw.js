const CACHE="bloom-v48";
const PUSH_LATEST_URL="https://bloom-push.jguillermoduran1988.workers.dev/push/latest?store=bloom";
const SHELL=["./index.html","./app.js","./config.js","./push-client.js","./manifest.json","./colombia.js","./logo-bloom.svg","./icon-192.png","./icon-512.png"];

self.addEventListener("install",e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener("activate",e=>{
  e.waitUntil(caches.keys()
    .then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x))))
    .then(()=>self.clients.claim()));
});

self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  if(u.href.includes("supabase.co")||u.href.includes("workers.dev")||u.href.includes("graph.facebook"))return;

  if(e.request.mode==="navigate"){
    e.respondWith(fetch(e.request).catch(()=>caches.match("./index.html")));
    return;
  }

  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});

self.addEventListener("push",e=>{
  e.waitUntil((async()=>{
    const data = await pushData(e);
    const title=data.title||"Bloom";
    const options={
      body:data.body||"Nuevo mensaje en el chat del equipo",
      icon:"./icon-192.png",
      badge:"./icon-192.png",
      tag:data.tag||"bloom-team",
      data:{url:data.url||"./index.html#equipo"},
    };
    await self.registration.showNotification(title,options);
  })());
});

async function pushData(e){
  if(e.data){
    try{ return e.data.json(); }
    catch(_){ return { body:e.data.text()||"Nuevo mensaje en el chat del equipo" }; }
  }
  try{
    const r=await fetch(PUSH_LATEST_URL,{cache:"no-store"});
    if(r.ok){
      const d=await r.json();
      if(d && d.ok) return d;
    }
  }catch(_){ }
  return { title:"Bloom", body:"Nuevo mensaje en el chat del equipo", url:"./index.html#equipo" };
}

self.addEventListener("notificationclick",e=>{
  e.notification.close();
  const target=e.notification.data?.url||"./index.html#equipo";
  e.waitUntil((async()=>{
    const all=await clients.matchAll({type:"window",includeUncontrolled:true});
    for(const c of all){
      if("focus" in c){ c.navigate(target); return c.focus(); }
    }
    return clients.openWindow(target);
  })());
});
