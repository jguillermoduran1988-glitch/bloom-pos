// Bloom PWA push notifications for the internal team chat.
(function(){
  if(window.__bloomPushClientLoaded) return;
  window.__bloomPushClientLoaded = true;

  const C = window.CONFIG || {};
  const PUSH_URL = C.PUSH_WORKER_URL || C.WORKER_URL;
  const STORE = C.STORE || "bloom";
  let enabling = false;

  function b64ToUint8Array(value){
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g,"+").replace(/_/g,"/");
    const raw = atob(base64);
    return Uint8Array.from([...raw].map(ch => ch.charCodeAt(0)));
  }

  function authorName(){
    return window.pos?.teamAuthor?.name || localStorage.getItem("bloom_push_author") || "Equipo Bloom";
  }

  async function saveSubscription(subscription){
    if(!PUSH_URL) return;
    await fetch(`${PUSH_URL}/push/subscribe`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        store:STORE,
        author_name:authorName(),
        subscription:subscription.toJSON(),
      }),
    });
  }

  async function enableTeamPush(){
    if(enabling) return;
    enabling = true;
    try{
      if(!C.VAPID_PUBLIC_KEY){
        console.warn("Push no activo: falta CONFIG.VAPID_PUBLIC_KEY");
        return;
      }
      if(!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
      const permission = Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
      if(permission !== "granted") return;

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if(!subscription){
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly:true,
          applicationServerKey:b64ToUint8Array(C.VAPID_PUBLIC_KEY),
        });
      }
      await saveSubscription(subscription);
      localStorage.setItem("bloom_push_author", authorName());
    }catch(e){
      console.warn("No se pudo activar push", e);
    }finally{
      enabling = false;
    }
  }

  async function notifyTeamMessage(payload){
    if(!PUSH_URL) return;
    try{
      await fetch(`${PUSH_URL}/push/team-message`,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          store:STORE,
          author_name:payload.author_name || authorName(),
          body:payload.body || "Nuevo mensaje del equipo",
          media_type:payload.media_type || null,
          sale_id:payload.sale_id || null,
        }),
      });
    }catch(e){ console.warn("No se pudo enviar push del equipo", e); }
  }

  function hookTeamMessages(){
    if(typeof window.sbPost !== "function" || window.sbPost.__pushHooked) return;
    const original = window.sbPost;
    window.sbPost = async function(path, body){
      const result = await original.apply(this, arguments);
      if(String(path).replace(/^\//,"") === "team_messages" && body){
        notifyTeamMessage(body);
      }
      return result;
    };
    window.sbPost.__pushHooked = true;
  }

  function bindGestures(){
    document.addEventListener("click", e=>{
      const id = e.target?.id || e.target?.closest?.("button")?.id;
      if(id === "nav-equipo" || id === "teamText" || id === "voiceBtn") enableTeamPush();
    }, true);
    document.addEventListener("focusin", e=>{
      if(e.target?.id === "teamText") enableTeamPush();
    });
  }

  window.enableTeamPush = enableTeamPush;
  setInterval(hookTeamMessages, 1000);
  bindGestures();
})();
