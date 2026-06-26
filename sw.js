const CACHE="bloom-v23";
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

  const wantsHtml=e.request.mode==="navigate"||e.request.headers.get("accept")?.includes("text/html");
  if(wantsHtml && u.origin===self.location.origin){
    e.respondWith((async()=>{
      try{
        const res=await fetch(e.request);
        const html=await res.text();
        return new Response(injectPushClient(html),{headers:{"Content-Type":"text/html; charset=utf-8"}});
      }catch(_){
        const cached=await caches.match("./index.html");
        if(!cached)return new Response("Sin conexion",{status:503});
        const html=await cached.text();
        return new Response(injectPushClient(html),{headers:{"Content-Type":"text/html; charset=utf-8"}});
      }
    })());
    return;
  }

  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});

function injectPushClient(html){
  if(html.includes("push-client.js"))return html;
  return html.replace("</body>",'<script src="./push-client.js"></script></body>');
}

self.addEventListener("push",e=>{
  let data={};
  try{ data=e.data?e.data.json():{}; }catch(_){ data={body:e.data?.text()||"Nuevo mensaje"}; }
  const title=data.title||"Bloom";
  const options={
    body:data.body||"Nuevo mensaje del equipo",
    icon:"./icon-192.png",
    badge:"./icon-192.png",
    tag:data.tag||"bloom-team",
    data:{url:data.url||"./index.html#equipo"},
  };
  e.waitUntil(self.registration.showNotification(title,options));
});

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
