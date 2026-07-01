// ====================================================================
//  Bloom Dashboard — lógica
//  Liviano: ventana de mensajes, render incremental, Realtime, debounce.
//  Features: etiquetas, referral (historia/pauta), embudos múltiples editables.
// ====================================================================

const C = window.CONFIG;
const SB = { url: C.SUPABASE_URL, key: C.SUPABASE_ANON };
const MSG_WINDOW = 60;
const CHAT_PAGE = 40;

const state = {
  chats: new Map(),          // phone -> contact
  pipelines: [],             // [{id,name,stages}]
  activePipeline: null,      // id
  active: null,              // phone
  messages: [],
  oldestLoaded: null,        // timestamp del mensaje más viejo cargado (scroll arriba)
  loadingMore: false,        // evita cargas duplicadas al hacer scroll
  allLoaded: false,          // ya no hay más historia hacia arriba
  search: "",
};

// ---------- helpers ----------
const $ = s => document.querySelector(s);
const el = (t,c)=>{const e=document.createElement(t);if(c)e.className=c;return e;};
const initials = n => (n||"?").trim().split(/\s+/).slice(0,2).map(w=>w[0]).join("").toUpperCase();
const money = n => "$"+Number(n).toLocaleString("es-CO");
const esc = s => (s||"").replace(/[&<>]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[m]));
const waFormat = s => esc(s).replace(/\*([^*]+)\*/g,"<b>$1</b>").replace(/\n/g,"<br>");
const _WA_SVG=`<svg viewBox="0 0 24 24" fill="#fff"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`;
const _IG_SVG=`<svg viewBox="0 0 24 24" fill="#fff"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>`;
const _FB_SVG=`<svg viewBox="0 0 24 24" fill="#fff"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`;
function platBadge(platform){
  const c=platform==="instagram"?"ig":platform==="facebook"?"fb":"wa";
  const svg=platform==="instagram"?_IG_SVG:platform==="facebook"?_FB_SVG:_WA_SVG;
  return `<span class="av-plat ${c}" title="${c==="wa"?"WhatsApp":c==="ig"?"Instagram":"Facebook"}">${svg}</span>`;
}

function timeLabel(iso){
  if(!iso) return "";
  const d=new Date(iso), now=new Date();
  if(d.toDateString()===now.toDateString()) return d.toLocaleTimeString("es-CO",{hour:"2-digit",minute:"2-digit"});
  const yd=new Date(now); yd.setDate(yd.getDate()-1);
  if(d.toDateString()===yd.toDateString()) return "Ayer";
  return d.toLocaleDateString("es-CO",{day:"2-digit",month:"2-digit"});
}

// ---------- Supabase REST ----------
async function sbGet(path){
  const r=await fetch(`${SB.url}/rest/v1/${path}`,{headers:{apikey:SB.key,Authorization:`Bearer ${SB.key}`}});
  return r.ok?r.json():[];
}
async function sbDelete(path){
  return fetch(`${SB.url}/rest/v1/${path}`,{method:"DELETE",
    headers:{apikey:SB.key,Authorization:`Bearer ${SB.key}`,"Content-Type":"application/json"}});
}
async function sbPatch(path,body){
  return fetch(`${SB.url}/rest/v1/${path}`,{method:"PATCH",
    headers:{apikey:SB.key,Authorization:`Bearer ${SB.key}`,"Content-Type":"application/json",Prefer:"return=minimal"},
    body:JSON.stringify(body)});
}
async function sbPost(path,body){
  return fetch(`${SB.url}/rest/v1/${path}`,{method:"POST",
    headers:{apikey:SB.key,Authorization:`Bearer ${SB.key}`,"Content-Type":"application/json",Prefer:"return=representation"},
    body:JSON.stringify(body)});
}

// ---------- Supabase Storage (subir archivos al bucket 'team-chat') ----------
async function sbUpload(bucket, file, ext){
  const path = `${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
  const r = await fetch(`${SB.url}/storage/v1/object/${bucket}/${path}`,{
    method:"POST",
    headers:{ apikey:SB.key, Authorization:`Bearer ${SB.key}`, "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if(!r.ok){
    const txt = await r.text();
    console.error("Error subiendo archivo", r.status, txt);
    if(r.status===404 || txt.includes("Bucket not found")){
      alert("Falta crear el bucket 'team-chat' en Supabase Storage (marcarlo como público).");
    }else if(r.status===400 && txt.includes("row-level")){
      alert("El bucket 'team-chat' existe pero no es público o falta permiso. Revisa que sea público en Supabase.");
    }
    return null;
  }
  const publicUrl = `${SB.url}/storage/v1/object/public/${bucket}/${path}`;
  return { url: publicUrl, path: `${bucket}/${path}`, storagePath: path };
}

// ---------- Pipelines ----------
async function loadPipelines(){
  let rows = await sbGet(`pipelines?store=eq.${C.STORE}&order=position.asc`);
  if(!rows.length){
    // crea uno por defecto si no hay
    const r = await sbPost("pipelines",{name:"Ventas",stages:["nueva","interesada","cotizada","pagada"],store:C.STORE});
    rows = await r.json();
  }
  state.pipelines = rows.map(p=>({...p,
    stages: typeof p.stages==="string"?JSON.parse(p.stages):p.stages,
    stage_colors: typeof p.stage_colors==="string"?JSON.parse(p.stage_colors||"{}"):p.stage_colors||{}
  }));
  state.activePipeline = state.pipelines[0].id;
  renderPipeTabs();
}

function renderPipeTabs(){
  const bar=$("#pipeTabs"); bar.innerHTML="";
  for(const p of state.pipelines){
    const t=el("div","pipe-tab"+(p.id===state.activePipeline?" on":""));
    t.textContent=p.name;
    t.onclick=()=>{state.activePipeline=p.id; renderPipeTabs(); renderChatList();};
    bar.appendChild(t);
  }
  const add=el("div","pipe-tab add"); add.textContent="+ embudo";
  add.onclick=()=>openPipeModal(); bar.appendChild(add);
}

function currentPipeline(){ return state.pipelines.find(p=>p.id===state.activePipeline); }

// ============================================================
//  VISTA TABLERO (KANBAN)
// ============================================================
let _boardMode=false;

function _closeBoardMobile(){
  const board=$("#kanbanBoard");
  const sidebar=document.querySelector(".sidebar");
  if(board) board.classList.remove("kb-show","show");
  if(sidebar) sidebar.classList.remove("kb-hidden");
  document.body.classList.remove("board-open","chat-open","panel-open");
  state.active=null;
  const pan=$("#panel"); if(pan) pan.classList.add("hidden");
}

function toggleBoardView(){
  _boardMode=!_boardMode;
  const btn=$("#boardToggleBtn");
  if(btn) btn.querySelector(".material-symbols-outlined").textContent=_boardMode?"view_list":"view_kanban";
  const isMob=Math.min(window.screen.width,window.screen.height)<=720;
  if(_boardMode){
    if(isMob){
      document.querySelector(".sidebar")?.classList.add("kb-hidden");
      $("#kanbanBoard")?.classList.add("kb-show");
      document.body.classList.add("board-open");
      history.pushState({kanban:true},"");
    }
    $("#kanbanBoard")?.classList.add("show");
  } else {
    // Siempre limpiar todo sin importar el ancho de pantalla
    _closeBoardMobile();
  }
  if(_boardMode) renderBoard();
}

let _inPopstate=false;
window.addEventListener("popstate",(e)=>{
  _inPopstate=true;
  try{
    if(_boardMode){
      _boardMode=false;
      const btn=$("#boardToggleBtn");
      if(btn) btn.querySelector(".material-symbols-outlined").textContent="view_kanban";
      _closeBoardMobile();
      // Quitar también la clase "show" que toggleBoardView agrega — si no, el kanban
      // queda visible como position:absolute sin overflow:hidden y desborda horizontalmente
      $("#kanbanBoard")?.classList.remove("show");
    } else if(state.active){
      state.active=null;
      document.body.classList.remove("chat-open","panel-open");
      const pan=$("#panel"); if(pan) pan.classList.add("hidden");
      renderChatList();
    } else if(e.state?.screen){
      switchScreen(e.state.screen);
    }
  }finally{ _inPopstate=false; }
});

function renderBoard(){
  const pipe=currentPipeline(); if(!pipe) return;
  $("#kbTitle").textContent=pipe.name;
  // Pipeline tabs
  const tabs=$("#kbPipeTabs"); tabs.innerHTML="";
  for(const p of state.pipelines){
    const t=el("button","kb-ptab"+(p.id===state.activePipeline?" on":""));
    t.textContent=p.name;
    t.onclick=()=>{state.activePipeline=p.id;renderPipeTabs();renderChatList();renderBoard();};
    tabs.appendChild(t);
  }
  // Columns
  const cols=$("#kbCols"); cols.innerHTML="";
  const chats=[...state.chats.values()].filter(c=>
    c.pipeline_id===pipe.id||(!c.pipeline_id&&pipe.id===state.pipelines[0]?.id)
  );
  for(const stage of (pipe.stages||[])){
    const cards=chats.filter(c=>(c.stage||pipe.stages[0])===stage)
      .sort((a,b)=>new Date(b.lastAt)-new Date(a.lastAt));
    const col=el("div","kb-col");
    const refBadge=c=>c.ref_source_type==="ad"
      ?`<span class="kb-ref ad"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:-2px">campaign</span> pauta</span>`
      :c.ref_source_type?`<span class="kb-ref org"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:-2px">photo_camera</span> historia</span>`:"";
    const stCol=stageColor(pipe,stage);
    col.innerHTML=`<div class="kb-col-head" style="border-top:3px solid ${stCol}"><span class="kb-col-name" style="color:${stCol}">${esc(stage)}</span><span class="kb-col-ct">${cards.length}</span></div><div class="kb-col-body"></div>`;
    const body=col.querySelector(".kb-col-body");
    for(const c of cards){
      const isMyCard=pos.currentUser?.name && c.assigned_to===pos.currentUser.name;
      const card=el("div","kb-card"+(isMyCard?" my-conv":""));
      // Ocultar notas internas como último mensaje visible
      const lastVisible=c.last?.startsWith("Tomó ")||c.last?.startsWith("Conversación liberada")||c.last?.startsWith("Liberó ")?"":c.last;
      const tagChips=(c.tags||[]).slice(0,2).map(t=>`<span class="kb-tag">${esc(t)}</span>`).join("");
      const isHandle=c.platform==="instagram"||c.platform==="facebook";
      const phoneDisp=(isHandle?"@":"+")+esc(c.phone);
      card.innerHTML=`
        <button class="kb-close" onclick="event.stopPropagation();archiveConv('${esc(c.phone)}')" title="Archivar lead">
          <span class="material-symbols-outlined" style="font-size:14px">close</span>
        </button>
        <div class="kb-card-top">
          <div class="av-wrap"><div class="av av-sm">${initials(c.name)}</div>${platBadge(c.platform)}</div>
          <div style="flex:1;min-width:0;padding-right:18px">
            <div class="kb-card-name">${esc(c.name)}</div>
            <div style="font-size:10px;color:var(--text-dim)">${phoneDisp}</div>
          </div>
          <span class="kb-card-time">${timeLabel(c.lastAt)}</span>
        </div>
        ${lastVisible?`<div class="kb-card-prev">${esc(lastVisible)}</div>`:""}
        <div class="kb-card-foot">
          ${c.assigned_to?`<span class="kb-seller"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:-2px">person</span> ${esc(c.assigned_to)}</span>`:""}
          ${refBadge(c)}
          ${tagChips}
          ${c.unread?`<span class="kb-unread">${c.unread}</span>`:""}
        </div>`;
      card.onclick=()=>{toggleBoardView();openChat(c.phone);};
      body.appendChild(card);
    }
    if(!cards.length){
      const empty=el("div","");
      empty.style.cssText="padding:16px;text-align:center;color:var(--text-dim);font-size:12px";
      empty.textContent="Sin conversaciones";
      body.appendChild(empty);
    }
    cols.appendChild(col);
  }
}

// ---------- Chats ----------
async function loadChats(){
  const rows = await fetch(`${C.WORKER_URL}/wa/conversations`).then(r=>r.json()).catch(()=>[]);
  for(const conv of rows){
    state.chats.set(conv.phone,{
      phone:conv.phone, id:conv.id,
      name:conv.contact_name||conv.phone,
      stage:conv.stage||"nueva",
      pipeline_id:conv.pipeline_id||null,
      tags: typeof conv.contact_tags==="string" ? JSON.parse(conv.contact_tags||"[]") : (conv.contact_tags||[]),
      ref_source_type:conv.ref_source_type||null, ref_headline:null, ref_body:null, ref_media_url:null,
      last:conv.last_message||"", lastAt:conv.last_message_at||conv.updated_at,
      unread:conv.unread_count||0, status:conv.status||"open",
      assigned_to:conv.assigned_to||null,
      email:conv.contact_email||null, avatar:conv.contact_avatar||null,
    });
  }
  renderChatList();
}

function renderChatList(){
  const list=$("#chatList"); const q=state.search.toLowerCase();
  const pid=state.activePipeline;
  const items=[...state.chats.values()].filter(c=>{
    // filtra por embudo activo (o sin embudo asignado -> primer embudo)
    const inPipe = c.pipeline_id===pid || (!c.pipeline_id && pid===state.pipelines[0].id);
    const matchQ = !q || c.name.toLowerCase().includes(q) || c.phone.includes(q)
      || (c.tags||[]).some(t=>t.toLowerCase().includes(q));
    return inPipe && matchQ;
  }).sort((a,b)=>new Date(b.lastAt)-new Date(a.lastAt));

  list.innerHTML="";
  const frag=document.createDocumentFragment();
  for(const c of items){
    const isMyConv=pos.currentUser?.name && c.assigned_to===pos.currentUser.name;
    const item=el("div","chat-item"+(c.phone===state.active?" sel":"")+(isMyConv?" my-conv":""));
    let refBadge="";
    if(c.ref_source_type==="ad") refBadge=`<span class=\"ref-badge ad\"><span class=\"material-symbols-outlined\" style=\"font-size:12px;vertical-align:-3px\">campaign</span> pauta</span>`;
    else if(c.ref_source_type) refBadge=`<span class=\"ref-badge\"><span class=\"material-symbols-outlined\" style=\"font-size:12px;vertical-align:-3px\">photo_camera</span> historia</span>`;
    const _avInner=c.avatar?`<img src="${esc(c.avatar)}" style="width:42px;height:42px;border-radius:50%;object-fit:cover;flex-shrink:0">`:`<div class="av">${initials(c.name)}</div>`;
    item.innerHTML=`
      <div class="av-wrap">${_avInner}${platBadge(c.platform)}</div>
      <div class="ci-body">
        <div class="ci-top"><span class="ci-name">${esc(c.name)}</span><span class="ci-time">${timeLabel(c.lastAt)}</span></div>
        <div class="ci-prev">${esc(c.last||"—")}</div>
        <div class="ci-meta">
          ${refBadge}
          <span class="stage">${esc(c.stage)}</span>
          ${c.assigned_to?`<span class="ci-seller"><span class="material-symbols-outlined" style="font-size:11px;vertical-align:-2px">person</span> ${esc(c.assigned_to)}</span>`:""}
          ${c.unread?`<span class="ci-unread">${c.unread}</span>`:""}
        </div>
      </div>`;
    item.onclick=()=>openChat(c.phone);
    frag.appendChild(item);
  }
  list.appendChild(frag);
}

// ---------- Ventana de atención ----------
function getWindowStatus(c){
  if(!c?.lastAt) return {open:false, hours:0};
  const last=new Date(c.lastAt);
  const hours=(Date.now()-last)/3600000;
  const limit=c.ref_source_type==="ad" ? 72 : 24;
  const left=limit-hours;
  return {open:left>0, hoursLeft:left, limit};
}
function renderWindowBanner(phone){
  const c=state.chats.get(phone);
  const w=getWindowStatus(c);
  const banner=$("#windowBanner");
  const composer=$("#composer");
  const input=$("#chatInput");
  const sendBtn=$("#sendBtn");
  if(!banner) return;
  if(w.open){
    const h=Math.floor(w.hoursLeft);
    const m=Math.floor((w.hoursLeft-h)*60);
    const label=h>0?`${h}h ${m}m`:`${m} min`;
    banner.style.cssText="display:flex;align-items:center;gap:6px;padding:4px 12px;font-size:11px;background:#f0fdf4;color:#166534;border-bottom:1px solid #bbf7d0";
    banner.innerHTML=`<span class="material-symbols-outlined" style="font-size:14px">schedule</span>Ventana abierta · ${w.limit}h · Cierra en <b>${label}</b>`;
    if(input) input.disabled=false;
    if(sendBtn) sendBtn.disabled=false;
    if(composer) composer.style.opacity="1";
  } else {
    banner.style.cssText="display:flex;align-items:center;gap:6px;padding:6px 12px;font-size:11px;background:#fef2f2;color:#991b1b;border-bottom:1px solid #fecaca";
    banner.innerHTML=`<span class="material-symbols-outlined" style="font-size:14px">timer_off</span><b>Ventana vencida</b> · Solo puedes enviar plantillas de WhatsApp`;
    if(input){ input.disabled=true; input.placeholder="Ventana cerrada — usa una plantilla"; }
    if(sendBtn) sendBtn.disabled=true;
    if(composer) composer.style.opacity="0.6";
  }
}

// ---------- Abrir chat ----------
async function openChat(phone){
  if(window.innerWidth<=720) history.pushState({screen:"chats",chat:phone},"");
  state.active=phone;
  const c=state.chats.get(phone); c.unread=0;
  document.body.classList.add("chat-open");
  $("#emptyState").style.display="none";
  ["chatHead","msgs","qrBar","composer"].forEach(id=>$("#"+id).style.display=
    id==="msgs"||id==="qrBar"||id==="composer"?(id==="msgs"?"flex":"flex"):"flex");
  const _hAv=$("#headAv");
  if(c.avatar){_hAv.innerHTML=`<img src="${esc(c.avatar)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;}
  else{_hAv.innerHTML="";_hAv.textContent=initials(c.name);}
  const _hPlat=$("#headAvPlat"); if(_hPlat){const _pc=c.platform==="instagram"?"ig":c.platform==="facebook"?"fb":"wa";_hPlat.className=`av-plat ${_pc}`;}
  $("#headName").textContent=c.name;
  $("#headSub").textContent="+"+phone;
  renderChatList(); renderPanel();
  renderWindowBanner(phone);
  const _convId=state.chats.get(phone)?.id||phone;
  fetch(`${C.WORKER_URL}/wa/conversations/${encodeURIComponent(_convId)}/read`,{method:"POST"}).catch(()=>{});
  await loadMessages(phone);
}
function closeChat(){
  if(window.innerWidth<=720 && history.state?.chat) history.back();
  document.body.classList.remove("chat-open","panel-open");
  state.active=null;
  $("#panel").classList.add("hidden");
}

// ---------- Mensajes (desde D1 vía worker) ----------
async function loadMessages(phone){
  state.allLoaded = true; state.loadingMore = false; state.oldestLoaded = null;
  const convId = state.chats.get(phone)?.id || phone;
  const rows = await fetch(`${C.WORKER_URL}/wa/conversations/${encodeURIComponent(convId)}/messages`).then(r=>r.json()).catch(()=>[]);
  state.messages = rows.map(m=>({
    body: m.body||"",
    direction: m.direction==="outbound"?"out":"in",
    created_at: m.ts||m.created_at,
    msg_type: m.type||"text",
    media_url: m.media_url||null,
    status: m.status||"sent",
  }));
  renderMessages();
}

async function loadOlderMessages(){ /* paginación futura via D1 offset */ }

function msgNode(m){
  // Nota privada del vendedor — NUNCA se envía al cliente
  if(m.msg_type==="flow_reply"){
    const d=el("div","msg-note");
    d.style.cssText="background:#eff6ff;border-color:#bfdbfe;color:#1e40af";
    const parts=(m.body||"").split(" · ").map(p=>{ const [k,...v]=p.split(": "); return `<b>${k}:</b> ${v.join(": ")}`; });
    d.innerHTML=`<span style="font-size:14px;margin-right:4px">🌸</span><span style="font-weight:700">Flow completado</span><br><span style="font-size:12px">${parts.join(" &nbsp;·&nbsp; ")}</span>
      <div class="t">${new Date(m.created_at).toLocaleTimeString("es-CO",{hour:"2-digit",minute:"2-digit"})}</div>`;
    return d;
  }
  if(m.msg_type==="note"){
    const d=el("div","msg-note");
    d.innerHTML=`<span class=\"lock\"><span class=\"material-symbols-outlined\" style=\"font-size:14px;vertical-align:-3px\">sticky_note_2</span></span> ${waFormat(m.body)}
      <div class="t">nota interna · ${new Date(m.created_at).toLocaleTimeString("es-CO",{hour:"2-digit",minute:"2-digit"})}</div>`;
    return d;
  }
  if(m.msg_type==="referral"){
    const d=el("div","msg-ref");
    d.innerHTML=`<div class=\"tag\"><span class=\"material-symbols-outlined\" style=\"font-size:13px;vertical-align:-3px\">campaign</span> escribió desde un anuncio</div>
      ${m.media_url?`<img src="${esc(m.media_url)}" alt="">`:""}
      <div class="h">${esc(m.body||"")}</div>`;
    return d;
  }
  const b=el("div","msg "+(m.direction==="out"?"out":"in"));
  const _tick=m.direction==="out"?`<span class="msg-tick ${m.status||'sent'}">${m.status==='read'||m.status==='delivered'?'✓✓':'✓'}</span>`:'';
  const _t=`<div class="t">${_tick}${new Date(m.created_at).toLocaleTimeString("es-CO",{hour:"2-digit",minute:"2-digit"})}</div>`;
  if((m.msg_type==="image"||m.media_type==="image")&&m.media_url){
    const cap=m.body&&m.body!=="📷 Foto"?`<div style="font-size:13px;margin-top:4px">${esc(m.body)}</div>`:"";
    b.innerHTML=`<img class="tm-photo" src="${esc(m.media_url)}" onclick="window.open('${esc(m.media_url)}','_blank')">${cap}${_t}`;
  }else if(m.msg_type==="video"&&m.media_url){
    b.innerHTML=`<video controls src="${esc(m.media_url)}" style="max-width:100%;border-radius:8px"></video>${_t}`;
  }else if((m.msg_type==="audio"||m.media_type==="audio")&&m.media_url){
    b.innerHTML=`<audio controls src="${esc(m.media_url)}"></audio>${_t}`;
  }else if(m.msg_type==="document"&&m.media_url){
    b.innerHTML=`<a href="${esc(m.media_url)}" target="_blank" style="display:flex;align-items:center;gap:6px;color:#2563eb"><span class="material-symbols-outlined">description</span>${esc(m.body||"Documento")}</a>${_t}`;
  }else{
    b.innerHTML=waFormat(m.body)+_t;
  }
  return b;
}
function renderMessages(keepScroll){
  const box=$("#msgs"); box.innerHTML="";
  const frag=document.createDocumentFragment(); let lastDay="";
  if(!state.allLoaded){
    const more=el("div","load-more"); more.textContent="↑ subir para ver más";
    frag.appendChild(more);
  }
  for(const m of state.messages){
    const day=new Date(m.created_at).toDateString();
    if(day!==lastDay){const s=el("div","daysep");
      s.textContent=timeLabel(m.created_at)==="Ayer"?"Ayer":new Date(m.created_at).toLocaleDateString("es-CO",{day:"2-digit",month:"long"});
      frag.appendChild(s);lastDay=day;}
    frag.appendChild(msgNode(m));
  }
  box.appendChild(frag);
  const lm = box.querySelector(".load-more");
  if(lm) lm.onclick = loadOlderMessages;
  if(!keepScroll) box.scrollTop=box.scrollHeight;
}
function appendMessage(m){
  state.messages.push(m);
  if(state.messages.length>MSG_WINDOW){state.messages.shift();if($("#msgs").firstChild)$("#msgs").removeChild($("#msgs").firstChild);}
  const box=$("#msgs"); const near=box.scrollHeight-box.scrollTop-box.clientHeight<120;
  box.appendChild(msgNode(m)); if(near)box.scrollTop=box.scrollHeight;
}

// ---------- Panel derecho ----------
function togglePanel(){
  if(window.innerWidth<=720){
    if(document.body.classList.contains("panel-open")){
      if(history.state?.chat) history.back();
      document.body.classList.remove("panel-open");
    } else {
      document.body.classList.add("panel-open");
    }
  } else {
    $("#panel").classList.toggle("hidden");
  }
}
function renderPanel(){
  const c=state.chats.get(state.active); if(!c)return;
  // Avatar
  const pAv=$("#pAv");
  if(c.avatar){pAv.innerHTML=`<img src="${esc(c.avatar)}" style="width:54px;height:54px;border-radius:50%;object-fit:cover">`;}
  else{pAv.innerHTML="";pAv.textContent=initials(c.name);}
  const _pPlat=c.platform==="instagram"?"ig":c.platform==="facebook"?"fb":"wa";
  const _pBadge=$("#pAvPlat"); if(_pBadge) _pBadge.className=`av-plat ${_pPlat}`;
  // Info
  $("#pName").textContent=c.name;
  const _isHandle=c.platform==="instagram"||c.platform==="facebook";
  $("#pPhone").textContent=(_isHandle?"@":"+")+c.phone;
  // Edit form
  const pEN=$("#pEditName"); if(pEN) pEN.value=c.name||"";
  const pSM=$("#pSaveMsg"); if(pSM) pSM.style.display="none";
  // Supabase customer lookup
  loadCustomerRecord(c.phone);
  // referral
  const rdiv=$("#pReferral");
  if(c.ref_source_type){
    rdiv.innerHTML=`<div class="ref-card">
      ${c.ref_media_url?`<img src="${esc(c.ref_media_url)}" alt="">`:""}
      <div class="src">${c.ref_source_type==="ad"?"<span class=\"material-symbols-outlined\" style=\"font-size:12px;vertical-align:-3px\">campaign</span> Pauta":"<span class=\"material-symbols-outlined\" style=\"font-size:12px;vertical-align:-3px\">photo_camera</span> Historia / Post"}</div>
      <div class="h">${esc(c.ref_headline||"Anuncio de Bloom")}</div>
      ${c.ref_body?`<div class="b">${esc(c.ref_body)}</div>`:""}
    </div>`;
  }else{
    rdiv.innerHTML=`<div class="no-ref">Escribió directamente (sin anuncio)</div>`;
  }
  renderTags(c); renderStages(c);
  const aDiv=$("#pAssigned");
  if(aDiv){
    if(c.assigned_to){
      aDiv.innerHTML=`<div style="display:flex;align-items:center;gap:9px;padding:2px 0">
        <div class="av" style="width:28px;height:28px;font-size:11px;flex-shrink:0">${initials(c.assigned_to)}</div>
        <span style="font-size:13px;font-weight:600">${esc(c.assigned_to)}</span>
        <button onclick="freeConv()" style="margin-left:auto;background:none;border:1px solid var(--border);border-radius:7px;padding:3px 8px;cursor:pointer;font-size:11px;color:var(--text-dim)">Liberar</button>
      </div>`;
    } else {
      aDiv.innerHTML=`<span style="color:var(--text-dim);font-size:13px">Sin asignar · usa <b>/tomo [Nombre]</b></span>`;
    }
  }
}

// ---------- Guardar ficha del contacto ----------
async function saveContactInfo(){
  const phone=state.active; if(!phone) return;
  const c=state.chats.get(phone);
  const name=($("#pEditName")?.value||"").trim()||c.name;
  const updates={};
  if(name!==c.name) updates.name=name;
  if(!Object.keys(updates).length){
    const m=$("#pSaveMsg"); if(m){m.textContent="Sin cambios";m.style.display="";setTimeout(()=>m.style.display="none",1500);} return;
  }
  await fetch(`${C.WORKER_URL}/wa/contacts/${encodeURIComponent(phone)}`,{
    method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(updates)
  }).catch(()=>{});
  if(updates.name){c.name=updates.name;$("#pName").textContent=c.name;renderChatList();}
  const m=$("#pSaveMsg"); if(m){m.textContent="✓ Guardado";m.style.color="#166534";m.style.display="";setTimeout(()=>m.style.display="none",2000);}
}

function triggerContactPhoto(){ $("#contactPhotoInput")?.click(); }

async function uploadContactPhoto(input){
  const file=input?.files?.[0]; if(!file) return;
  const phone=state.active; if(!phone) return;
  const c=state.chats.get(phone);
  const btn=document.querySelector(".p-cam-btn");
  if(btn) btn.innerHTML=`<span class="material-symbols-outlined" style="font-size:13px;animation:pulse 1s infinite">sync</span>`;
  try{
    const fd=new FormData(); fd.append("file",file);
    const r=await fetch(`${C.WORKER_URL}/wa/upload`,{method:"POST",body:fd});
    const d=await r.json();
    if(d.url){
      c.avatar=d.url;
      await fetch(`${C.WORKER_URL}/wa/contacts/${encodeURIComponent(phone)}`,{
        method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({avatar:d.url})
      }).catch(()=>{});
      renderPanel(); renderChatList();
      openChat(phone);
    }
  }catch(e){console.error(e);}
  input.value="";
}

async function loadCustomerRecord(phone){
  const sec=$("#pCustomerSec"); if(!sec) return;
  sec.style.display="none";
  const variants=[phone, "+"+phone, phone.slice(2)];
  let customer=null;
  for(const v of variants){
    const rows=await sbGet(`customers?phone=eq.${encodeURIComponent(v)}&limit=1`).catch(()=>null);
    if(rows?.length){customer=rows[0]; break;}
  }
  if(!customer) return;
  const cData=$("#pCustomerData");
  const salesDiv=$("#pCustomerSales");
  const sub=$("#pCustomerSub");
  if(sub) sub.textContent=`· ${esc(customer.full_name||customer.name||"")}`;
  const rows2=[];
  if(customer.email) rows2.push(`<div class="p-cust-row"><span class="p-cust-lbl">Email</span><span>${esc(customer.email)}</span></div>`);
  const loc=[customer.city,customer.depto||customer.department].filter(Boolean).join(", ");
  if(loc) rows2.push(`<div class="p-cust-row"><span class="p-cust-lbl">Ciudad</span><span>${esc(loc)}</span></div>`);
  if(customer.address) rows2.push(`<div class="p-cust-row"><span class="p-cust-lbl">Dirección</span><span>${esc(customer.address)}</span></div>`);
  if(customer.doc||customer.document) rows2.push(`<div class="p-cust-row"><span class="p-cust-lbl">Doc.</span><span>${esc(customer.doc||customer.document)}</span></div>`);
  if(cData) cData.innerHTML=rows2.join("");
  // Historial de compras
  if(salesDiv){
    salesDiv.innerHTML="";
    let sales=[];
    if(customer.email){
      sales=await sbGet(`sales?customer_email=eq.${encodeURIComponent(customer.email)}&order=created_at.desc&limit=10&select=total,created_at,sale_type`).catch(()=>[]);
    }
    if(!sales?.length){
      for(const v of variants){
        const r=await sbGet(`sales?customer_phone=eq.${encodeURIComponent(v)}&order=created_at.desc&limit=10&select=total,created_at,sale_type`).catch(()=>null);
        if(r?.length){sales=r; break;}
      }
    }
    if(sales?.length){
      const fmt=d=>new Date(d).toLocaleDateString("es-CO",{day:"2-digit",month:"short",year:"numeric"});
      const fmtMoney=n=>n!=null?`$${Number(n).toLocaleString("es-CO")}`:"";
      salesDiv.innerHTML=`<div style="font-size:11px;font-weight:600;color:var(--text-dim);margin:6px 0 4px;text-transform:uppercase;letter-spacing:.04em">Compras</div>`+
        sales.map(s=>`<div class="p-cust-row" style="font-size:12px"><span style="color:var(--text-dim)">${fmt(s.created_at)}</span><span style="font-weight:600">${fmtMoney(s.total)}</span></div>`).join("");
      // Auto-etiqueta si el cliente ya ha comprado antes
      const cfg=pos.chatConfig||{};
      if(cfg.recompra_enabled!==false && cfg.recompra_tag!==false){
        addTag(cfg.recompra_tag||"recompra");
      }
    }
  }
  sec.style.display="";
}

// ---------- Etiquetas ----------
function renderTags(c){
  const box=$("#pTags"); box.innerHTML="";
  for(const t of (c.tags||[])){
    const chip=el("div","tag-chip");
    chip.innerHTML=`${esc(t)} <span class="x">✕</span>`;
    chip.querySelector(".x").onclick=()=>removeTag(t);
    box.appendChild(chip);
  }
}
function _allKnownTags(){
  const s=new Set(C.SUGGESTED_TAGS||[]);
  for(const c of state.chats.values()) (c.tags||[]).forEach(t=>s.add(t));
  return [...s].sort();
}
let _tagPickerOpen=false;
function toggleTagPicker(){
  _tagPickerOpen=!_tagPickerOpen;
  const drop=$("#tagPickerDrop");
  drop.classList.toggle("open",_tagPickerOpen);
  if(_tagPickerOpen){
    const inp=$("#tagPickerSearch"); inp.value=""; inp.focus();
    renderTagPickerOpts();
    // cierra al hacer click fuera
    setTimeout(()=>document.addEventListener("click",_closeTagPickerOutside,{once:true,capture:true}),10);
  }
}
function _closeTagPickerOutside(e){
  const picker=$("#tagPicker");
  if(picker && !picker.contains(e.target)){ _tagPickerOpen=false; $("#tagPickerDrop").classList.remove("open"); }
  else if(_tagPickerOpen) setTimeout(()=>document.addEventListener("click",_closeTagPickerOutside,{once:true,capture:true}),10);
}
function renderTagPickerOpts(){
  const q=($("#tagPickerSearch")?.value||"").trim().toLowerCase();
  const c=state.chats.get(state.active); const cur=c?.tags||[];
  const all=_allKnownTags().filter(t=>!cur.includes(t)&&(!q||t.toLowerCase().includes(q)));
  const list=$("#tagPickerList"); list.innerHTML="";
  for(const t of all){
    const opt=el("div","tag-picker-opt");
    opt.innerHTML=`<span class="dot"></span>${esc(t)}`;
    opt.onclick=()=>{addTag(t);_tagPickerOpen=false;$("#tagPickerDrop").classList.remove("open");};
    list.appendChild(opt);
  }
  // opción "crear nueva"
  if(q && !all.map(t=>t.toLowerCase()).includes(q) && !cur.map(t=>t.toLowerCase()).includes(q)){
    const opt=el("div","tag-picker-opt new-tag");
    opt.innerHTML=`<span class="material-symbols-outlined" style="font-size:14px">add</span> Crear "<b>${esc(q)}</b>"`;
    opt.onclick=()=>{addTag(q);_tagPickerOpen=false;$("#tagPickerDrop").classList.remove("open");};
    list.appendChild(opt);
  }
  if(!all.length && !q) list.innerHTML=`<div style="padding:10px 12px;font-size:13px;color:var(--text-dim)">Escribe para crear una etiqueta</div>`;
}
function tagPickerKey(e){
  if(e.key==="Enter"){
    const q=(e.target.value||"").trim(); if(!q) return;
    addTag(q); _tagPickerOpen=false; $("#tagPickerDrop").classList.remove("open");
  }
  if(e.key==="Escape"){_tagPickerOpen=false;$("#tagPickerDrop").classList.remove("open");}
}
async function addTag(tag){
  const c=state.chats.get(state.active);
  if(!tag||!c||(c.tags||[]).includes(tag))return;
  c.tags=[...(c.tags||[]),tag];
  renderTags(c); renderChatList();
  await fetch(`${C.WORKER_URL}/wa/contacts/${encodeURIComponent(c.phone)}`,{
    method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({tags:c.tags})
  }).catch(()=>{});
}
async function removeTag(tag){
  const c=state.chats.get(state.active);
  c.tags=(c.tags||[]).filter(t=>t!==tag);
  renderTags(c); renderChatList();
  await fetch(`${C.WORKER_URL}/wa/contacts/${encodeURIComponent(c.phone)}`,{
    method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({tags:c.tags})
  }).catch(()=>{});
}


// ---------- Etapas del embudo ----------
function renderStages(c){
  const pipe=state.pipelines.find(p=>p.id===c.pipeline_id)||currentPipeline();
  $("#pPipeName").textContent=pipe.name;
  const box=$("#pStages"); box.innerHTML="";
  for(const st of pipe.stages){
    const col=stageColor(pipe,st);
    const row=el("div","st-row"+(st===c.stage?" on":""));
    row.innerHTML=`<span class="st-dot" style="background:${col}"></span><span class="st-label">${esc(st)}</span>${st===c.stage?`<span style="color:${col};font-weight:700">✓</span>`:""}`;
    row.onclick=()=>setStage(st);
    box.appendChild(row);
  }
}
async function setStage(st){
  const c=state.chats.get(state.active); c.stage=st;
  renderStages(c); renderChatList();
  await fetch(`${C.WORKER_URL}/wa/conversations/${encodeURIComponent(c.id||c.phone)}`,{
    method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({stage:st})
  }).catch(()=>{});
}

// ---------- Mover de embudo ----------
async function movePipeline(){
  const c=state.chats.get(state.active);
  const others=state.pipelines.filter(p=>p.id!==c.pipeline_id);
  if(!others.length){alert("Solo tienes un embudo. Crea otro primero.");return;}
  const names=others.map((p,i)=>`${i+1}. ${p.name}`).join("\n");
  const pick=prompt(`Mover a qué embudo?\n${names}`);
  const idx=parseInt(pick)-1;
  if(isNaN(idx)||!others[idx])return;
  const target=others[idx];
  c.pipeline_id=target.id; c.stage=target.stages[0];
  renderPanel(); renderChatList();
  await fetch(`${C.WORKER_URL}/wa/conversations/${encodeURIComponent(c.id||c.phone)}`,{
    method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({pipeline_id:target.id,stage:c.stage})
  }).catch(()=>{});
}

// ---------- Modal crear/editar embudo ----------
const _STAGE_PAL=["#6366f1","#f59e0b","#22c55e","#3b82f6","#ec4899","#8b5cf6","#14b8a6","#f97316"];
function stageColor(pipe,stage){return (pipe?.stage_colors||{})[stage]||_STAGE_PAL[((pipe?.stages||[]).indexOf(stage))%_STAGE_PAL.length]||"#6366f1";}
let editingStages=[], editingStageColors=[];
function openPipeModal(){
  _editingPipeId=null;
  editingStages=["nueva","interesada","pagada"];
  editingStageColors=["#6366f1","#f59e0b","#22c55e"];
  $("#pipeModalTitle").textContent="Nuevo embudo";
  $("#pipeNameInput").value="";
  renderStageEdit();
  $("#pipeModal").classList.add("show");
}
function closePipeModal(){$("#pipeModal").classList.remove("show");}
function renderStageEdit(){
  const box=$("#stageEditList"); box.innerHTML="";
  editingStages.forEach((s,i)=>{
    const row=el("div","stage-edit");
    const clr=el("input"); clr.type="color";
    clr.value=editingStageColors[i]||_STAGE_PAL[i%_STAGE_PAL.length];
    clr.style="width:30px;height:30px;border:none;border-radius:6px;cursor:pointer;padding:2px;background:none;flex-shrink:0";
    clr.oninput=e=>editingStageColors[i]=e.target.value;
    const inp=el("input"); inp.value=s; inp.oninput=e=>editingStages[i]=e.target.value;
    const del=el("button"); del.textContent="✕"; del.onclick=()=>{editingStages.splice(i,1);editingStageColors.splice(i,1);renderStageEdit();};
    row.appendChild(clr); row.appendChild(inp); row.appendChild(del); box.appendChild(row);
  });
}
function addStageRow(){editingStages.push("");editingStageColors.push(_STAGE_PAL[editingStages.length%_STAGE_PAL.length]);renderStageEdit();}
async function savePipeline(){
  const name=$("#pipeNameInput").value.trim();
  const stages=editingStages.map(s=>s.trim()).filter(Boolean);
  if(!name||!stages.length){alert("Pon un nombre y al menos una etapa");return;}
  const stage_colors={};
  stages.forEach((s,i)=>{if(editingStageColors[i])stage_colors[s]=editingStageColors[i];});
  if(_editingPipeId){
    await sbPatch(`pipelines?id=eq.${_editingPipeId}`,{name,stages,stage_colors});
    const p=state.pipelines.find(x=>String(x.id)===String(_editingPipeId));
    if(p){p.name=name;p.stages=stages;p.stage_colors=stage_colors;}
  } else {
    const r=await sbPost("pipelines",{name,stages,stage_colors,store:C.STORE,position:state.pipelines.length});
    const created=(await r.json())[0];
    created.stages=stages; created.stage_colors=stage_colors;
    state.pipelines.push(created);
  }
  _editingPipeId=null;
  closePipeModal(); renderPipeTabs(); renderCfgPipelines();
}

// ---------- Enviar ----------
async function sendCurrent(){
  const input=$("#chatInput"); let text=input.value.trim();
  if(!text||!state.active)return;
  input.value=""; autoGrow(); hideCmdSuggest();
  if(await handleBuiltIn(text)) return;
  await dispatch(expandCommand(text));
}
async function dispatch(text){
  const phone=state.active; const now=new Date().toISOString();
  appendMessage({body:text,direction:"out",created_at:now,msg_type:"text"});
  const c=state.chats.get(phone); c.last=text; c.lastAt=now; renderChatList();
  try{
    await fetch(`${C.WORKER_URL}/wa/send`,{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({conversation_id:state.chats.get(phone)?.id||phone,phone,body:text})});
  }catch(e){console.error("envío:",e);}
}

// ---------- Nota privada del vendedor (NO se envía al cliente) ----------
async function addNote(){
  const phone=state.active; if(!phone) return;
  const text=prompt("Nota interna (solo la ves tú, no se envía al cliente):");
  if(!text||!text.trim()) return;
  const now=new Date().toISOString();
  appendMessage({body:text.trim(),direction:"out",created_at:now,msg_type:"note"});
  const convId=state.chats.get(phone)?.id||phone;
  await fetch(`${C.WORKER_URL}/wa/send`,{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({conversation_id:convId,phone,body:text.trim(),type:"note"})}).catch(()=>{});
}

// ---------- Comandos built-in (/tomo, /liberar) ----------
async function handleBuiltIn(text){
  const phone=state.active; if(!phone) return false;
  const lower=text.toLowerCase();
  const now=new Date().toISOString();
  const label=new Date(now).toLocaleString("es-CO",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});
  const convId=state.chats.get(phone)?.id||phone;

  if(lower.startsWith("/tomo ")){
    const sellerName=text.slice(6).trim(); if(!sellerName) return true;
    const noteText=`Tomó ${sellerName} · ${label}`;
    appendMessage({body:noteText,direction:"out",created_at:now,msg_type:"note"});
    state.chats.get(phone).assigned_to=sellerName;
    await Promise.all([
      fetch(`${C.WORKER_URL}/wa/send`,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({conversation_id:convId,phone,body:noteText,type:"note"})}).catch(()=>{}),
      fetch(`${C.WORKER_URL}/wa/conversations/${encodeURIComponent(convId)}`,{method:"PATCH",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({assigned_to:sellerName})}).catch(()=>{})
    ]);
    renderPanel(); renderChatList(); return true;
  }

  if(lower==="/liberar"){
    const noteText=`Conversación liberada · ${label}`;
    appendMessage({body:noteText,direction:"out",created_at:now,msg_type:"note"});
    state.chats.get(phone).assigned_to=null;
    await Promise.all([
      fetch(`${C.WORKER_URL}/wa/send`,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({conversation_id:convId,phone,body:noteText,type:"note"})}).catch(()=>{}),
      fetch(`${C.WORKER_URL}/wa/conversations/${encodeURIComponent(convId)}`,{method:"PATCH",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({assigned_to:null})}).catch(()=>{})
    ]);
    renderPanel(); renderChatList(); return true;
  }

  return false;
}

async function freeConv(){
  const input=$("#chatInput");
  input.value="/liberar"; await sendCurrent();
}

// ---------- Archivar lead ----------
async function archiveConv(phone){
  const c=state.chats.get(phone);
  if(!confirm(`¿Archivar la conversación con ${c?.name||phone}?\n\nDesaparecerá del embudo. Si el cliente escribe de nuevo, reaparecerá automáticamente.`)) return;
  const convId=c?.id||phone;
  state.chats.delete(phone);
  if(state.active===phone) closeChat();
  renderChatList();
  if(_boardMode) renderBoard();
  await fetch(`${C.WORKER_URL}/wa/conversations/${encodeURIComponent(convId)}`,{
    method:"PATCH",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({status:"archived"})
  }).catch(()=>{});
}
function archiveActiveConv(){ if(state.active) archiveConv(state.active); }

// ---------- Autocomplete de comandos ----------
const _BUILT_IN_CMDS=[
  {cmd:"/tomo",    icon:"person_add",    desc:"Tomar conversación",  seller:true},
  {cmd:"/liberar", icon:"person_remove", desc:"Liberar conversación", seller:false},
];

function _getCmdItems(val){
  const q=val.toLowerCase();
  const items=[];
  for(const b of _BUILT_IN_CMDS){
    if(b.seller){
      const sellers=pos.sellers||[];
      const after=q.startsWith(b.cmd+" ")?q.slice(b.cmd.length+1):"";
      if(q.startsWith(b.cmd.slice(0,q.length))||q.startsWith(b.cmd)){
        for(const s of sellers){
          if(!after||s.name.toLowerCase().startsWith(after)){
            items.push({cmd:`${b.cmd} ${s.name}`,icon:b.icon,desc:`Asignar a ${s.name}`});
          }
        }
        if(!sellers.length) items.push({cmd:b.cmd+" ",icon:b.icon,desc:"Escribe el nombre del vendedor"});
      }
    } else {
      if(b.cmd.startsWith(q)) items.push({cmd:b.cmd,icon:b.icon,desc:b.desc});
    }
  }
  for(const q2 of quickReplies){
    if(q2.command.toLowerCase().startsWith(q)) items.push({cmd:q2.command,icon:"chat",desc:q2.label});
  }
  return items;
}

function showCmdSuggest(val){
  if(!val||!val.startsWith("/")){hideCmdSuggest();return;}
  const box=$("#cmdSuggest"); if(!box) return;
  const items=_getCmdItems(val);
  if(!items.length){hideCmdSuggest();return;}
  box._items=items;
  box.innerHTML=`<div class="cmd-hdr">Comandos disponibles</div>`+
    items.map((it,i)=>`<div class="cmd-item" onclick="selectCmd(${i})">
      <span class="material-symbols-outlined ci-ic">${it.icon}</span>
      <span class="ci-c">${esc(it.cmd)}</span>
      <span class="ci-d">${esc(it.desc)}</span>
    </div>`).join("");
  box.classList.add("show");
}

function hideCmdSuggest(){
  const box=$("#cmdSuggest"); if(!box) return;
  box.classList.remove("show"); box._items=null;
}

function selectCmd(i){
  const box=$("#cmdSuggest"); const item=box?._items?.[i]; if(!item) return;
  const inp=$("#chatInput");
  inp.value=item.cmd; hideCmdSuggest(); inp.focus();
  if(!item.cmd.endsWith(" ")) sendCurrent();
  else showCmdSuggest(item.cmd);
}

// ----- Plus menu chat de clientes -----
function toggleChatPlusMenu(){ $("#chatPlusMenu").classList.toggle("show"); $("#chatEmojiPicker").classList.remove("show"); }
function closeChatPlusMenu(){ $("#chatPlusMenu").classList.remove("show"); }
function buildChatEmojiPicker(){
  const box=$("#chatEmojiPicker"); if(!box||box.dataset.built) return;
  box.innerHTML=EMOJIS.map(e=>`<span onclick="addChatEmoji('${e}')">${e}</span>`).join("");
  box.dataset.built="1";
}
function toggleChatEmojiPicker(){ buildChatEmojiPicker(); $("#chatEmojiPicker").classList.toggle("show"); }
function addChatEmoji(e){ const inp=$("#chatInput"); inp.value+=e; inp.focus(); }

async function _compressImage(file, maxWidth=1280, quality=0.82){
  return new Promise(resolve=>{
    const img=new Image(), url=URL.createObjectURL(file);
    img.onload=()=>{
      URL.revokeObjectURL(url);
      let w=img.width, h=img.height;
      if(w>maxWidth){ h=Math.round(h*maxWidth/w); w=maxWidth; }
      const canvas=document.createElement("canvas");
      canvas.width=w; canvas.height=h;
      canvas.getContext("2d").drawImage(img,0,0,w,h);
      canvas.toBlob(blob=>resolve(blob||file),"image/jpeg",quality);
    };
    img.onerror=()=>resolve(file);
    img.src=url;
  });
}

let _pendingPhoto=null;
function attachChatPhoto(){
  if(!state.active){ alert("Selecciona un chat primero."); return; }
  const inp=document.createElement("input");
  inp.type="file"; inp.accept="image/*,video/*";
  inp.onchange=async()=>{
    const file=inp.files[0]; if(!file) return;
    const isVideo=file.type.startsWith("video/");
    // Mostrar preview con campo de caption
    const previewUrl=URL.createObjectURL(file);
    _pendingPhoto={file, previewUrl, isVideo};
    const modal=$("#chatPhotoModal");
    const preview=$("#chatPhotoPreview");
    if(isVideo){
      preview.innerHTML=`<video src="${previewUrl}" style="max-width:100%;max-height:260px;border-radius:8px" controls></video>`;
    } else {
      preview.innerHTML=`<img src="${previewUrl}" style="max-width:100%;max-height:260px;border-radius:8px;object-fit:contain">`;
    }
    $("#chatPhotoCaption").value="";
    modal.classList.add("show");
    setTimeout(()=>$("#chatPhotoCaption").focus(),100);
  };
  inp.click();
}
function closeChatPhotoModal(){
  $("#chatPhotoModal").classList.remove("show");
  if(_pendingPhoto){ URL.revokeObjectURL(_pendingPhoto.previewUrl); _pendingPhoto=null; }
}
async function confirmSendChatPhoto(){
  if(!_pendingPhoto||!state.active) return;
  const caption=$("#chatPhotoCaption").value.trim();
  const {file, isVideo}=_pendingPhoto;
  closeChatPhotoModal();
  const btn=$("#chatPhotoSendBtn");
  if(btn){ btn.disabled=true; btn.textContent="Enviando..."; }
  try{
    let uploadFile=file;
    let ext=file.name.split(".").pop()||"jpg";
    let mime=file.type||"image/jpeg";
    const msgType=isVideo?"video":"image";
    // Comprimir imagen (no video)
    if(!isVideo){
      const compressed=await _compressImage(file);
      uploadFile=new File([compressed],file.name,{type:"image/jpeg"});
      ext="jpg"; mime="image/jpeg";
    }
    // Subir al Worker (R2)
    const formData=new FormData();
    formData.append("file", uploadFile, `media_${Date.now()}.${ext}`);
    const upResp=await fetch(`${C.WORKER_URL}/wa/upload`,{method:"POST",body:formData}).then(r=>r.json()).catch(()=>null);
    if(!upResp?.url){ alert("No se pudo subir el archivo"); return; }
    const now=new Date().toISOString();
    appendMessage({body:caption,media_url:upResp.url,direction:"out",created_at:now,msg_type:msgType});
    const c=state.chats.get(state.active);
    if(c){ c.last=isVideo?"🎬 Video":"📷 Foto"; c.lastAt=now; renderChatList(); }
    const convId=c?.id||state.active;
    await fetch(`${C.WORKER_URL}/wa/send`,{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({conversation_id:convId,phone:state.active,body:caption,media_url:upResp.url,type:msgType})}).catch(()=>{});
  } finally {
    if(btn){ btn.disabled=false; btn.textContent="Enviar"; }
  }
}

let _chatRecorder=null, _chatAudioChunks=[];
async function toggleChatVoice(){
  if(!state.active){ alert("Selecciona un chat primero."); return; }
  const btn=$("#chatVoiceBtn");
  if(_chatRecorder && _chatRecorder.state==="recording"){ _chatRecorder.stop(); return; }
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    let mime="", ext="webm";
    if(MediaRecorder.isTypeSupported("audio/webm")){ mime="audio/webm"; ext="webm"; }
    else if(MediaRecorder.isTypeSupported("audio/mp4")){ mime="audio/mp4"; ext="mp4"; }
    else if(MediaRecorder.isTypeSupported("audio/aac")){ mime="audio/aac"; ext="aac"; }
    else{ mime=""; ext="m4a"; }
    _chatRecorder=mime?new MediaRecorder(stream,{mimeType:mime}):new MediaRecorder(stream);
    _chatAudioChunks=[];
    _chatRecorder.ondataavailable=e=>{ if(e.data.size>0) _chatAudioChunks.push(e.data); };
    _chatRecorder.onstop=async()=>{
      btn.classList.remove("rec"); btn.textContent="🎤";
      stream.getTracks().forEach(t=>t.stop());
      const realType=_chatRecorder.mimeType||mime||"audio/mp4";
      const realExt=realType.includes("webm")?"webm":realType.includes("mp4")?"mp4":realType.includes("aac")?"aac":"m4a";
      const blob=new Blob(_chatAudioChunks,{type:realType});
      if(blob.size===0){ alert("La grabación quedó vacía. Intenta de nuevo."); return; }
      const up=await sbUpload("team-chat", blob, realExt);
      if(!up) return;
      const now=new Date().toISOString();
      appendMessage({body:"",media_url:up.url,direction:"out",created_at:now,msg_type:"audio"});
      const c=state.chats.get(state.active); if(c){ c.last="🎤 Nota de voz"; c.lastAt=now; renderChatList(); }
      const convId=c?.id||state.active;
      await fetch(`${C.WORKER_URL}/wa/send`,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({conversation_id:convId,phone:state.active,body:"",media_url:up.url,type:"audio"})}).catch(()=>{});
    };
    _chatRecorder.start();
    btn.classList.add("rec"); btn.textContent="⏹";
  }catch(e){
    console.error(e);
    alert("No se pudo acceder al micrófono. Revisa el permiso en el navegador.");
  }
}

// Detecta scroll al tope para cargar mensajes anteriores
$("#msgs").addEventListener("scroll",()=>{
  if($("#msgs").scrollTop < 40) loadOlderMessages();
});

// ---------- Quick replies (desde Supabase) ----------
let quickReplies=[];
async function loadQuickReplies(){
  quickReplies=await sbGet(`quick_replies?store=eq.${C.STORE}&order=position.asc`);
  const bar=$("#qrBar"); bar.innerHTML="";
  for(const q of quickReplies){
    const chip=el("div","qr"); chip.innerHTML=`${esc(q.label)} <b>${esc(q.command)}</b>`;
    chip.onclick=()=>{
      const name=state.chats.get(state.active).name.split(" ")[0];
      dispatch(q.message_template.replace(/{nombre}/g,name));
    };
    bar.appendChild(chip);
  }
}
// ---------- Config: pestañas POS / Chat ----------
function cfgTab(name){
  document.getElementById("cfgTabPOS").classList.toggle("on", name==="pos");
  document.getElementById("cfgTabChat").classList.toggle("on", name==="chat");
  document.getElementById("cfgPanePOS").style.display = name==="pos" ? "" : "none";
  document.getElementById("cfgPaneChat").style.display = name==="chat" ? "" : "none";
  if(name==="chat"){ renderCfgQuickReplies(); renderCfgPipelines(); loadBotFlows(); loadWaFlows(); }
}

// ---------- Config Chat: gestión de comandos ----------
let _editingQrId = null;

function renderCfgQuickReplies(){
  const box = document.getElementById("cfgQrList"); if(!box) return;
  box.innerHTML = "";
  if(!quickReplies.length){
    box.innerHTML = `<div style="color:var(--text-dim);font-size:13px;padding:4px 0">Aún no hay comandos. Crea el primero abajo.</div>`;
    return;
  }
  for(const q of quickReplies){
    const row = el("div","");
    row.style.cssText = "display:flex;align-items:flex-start;gap:10px;padding:12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;margin-bottom:8px";
    row.innerHTML = `
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="font-weight:700;color:var(--accent);font-size:14px">${esc(q.command)}</span>
          <span style="font-size:12px;color:var(--text-dim);background:var(--bg);border:1px solid var(--border);border-radius:20px;padding:1px 8px">${esc(q.label)}</span>
        </div>
        <div style="font-size:13px;color:var(--text);white-space:pre-wrap;word-break:break-word">${esc(q.message_template)}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:5px;flex-shrink:0">
        <button onclick="editCfgQuickReply('${q.id}')" style="background:none;border:1px solid var(--border);border-radius:7px;padding:5px 8px;cursor:pointer;font-size:12px;color:var(--text-dim)">
          <span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px">edit</span>
        </button>
        <button onclick="deleteCfgQuickReply('${q.id}')" style="background:none;border:1px solid #fca5a5;border-radius:7px;padding:5px 8px;cursor:pointer;font-size:12px;color:#b91c1c">
          <span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px">delete</span>
        </button>
      </div>`;
    box.appendChild(row);
  }
}

function editCfgQuickReply(id){
  const q = quickReplies.find(x=>String(x.id)===String(id)); if(!q) return;
  _editingQrId = id;
  document.getElementById("cfgQrCommand").value = q.command;
  document.getElementById("cfgQrLabel").value = q.label;
  document.getElementById("cfgQrTemplate").value = q.message_template;
  document.getElementById("cfgQrFormTitle").textContent = "Editar comando";
  document.getElementById("cfgQrCancelBtn").style.display = "";
  document.getElementById("cfgQrForm").scrollIntoView({behavior:"smooth",block:"nearest"});
}

function cancelCfgQuickReply(){
  _editingQrId = null;
  document.getElementById("cfgQrCommand").value = "";
  document.getElementById("cfgQrLabel").value = "";
  document.getElementById("cfgQrTemplate").value = "";
  document.getElementById("cfgQrFormTitle").textContent = "Nuevo comando";
  document.getElementById("cfgQrCancelBtn").style.display = "none";
}

async function saveCfgQuickReply(){
  const command = document.getElementById("cfgQrCommand").value.trim();
  const label = document.getElementById("cfgQrLabel").value.trim();
  const template = document.getElementById("cfgQrTemplate").value.trim();
  if(!command || !label || !template){ alert("Completa todos los campos"); return; }
  if(!command.startsWith("/")){ alert("El comando debe empezar con /"); return; }
  const btn = document.getElementById("cfgQrSaveBtn");
  btn.disabled = true; btn.textContent = "Guardando…";
  try{
    if(_editingQrId){
      await sbPatch(`quick_replies?id=eq.${_editingQrId}`,{command,label,message_template:template});
      const idx = quickReplies.findIndex(x=>String(x.id)===String(_editingQrId));
      if(idx>=0) quickReplies[idx]={...quickReplies[idx],command,label,message_template:template};
    } else {
      const pos = quickReplies.length;
      const res = await sbPost("quick_replies",{store:C.STORE,command,label,message_template:template,position:pos});
      const created = await res.json();
      if(created && created[0]) quickReplies.push(created[0]);
    }
    cancelCfgQuickReply();
    renderCfgQuickReplies();
    loadQuickReplies(); // refresca la barra de comandos en el chat
  } catch(e){ alert("Error guardando: "+e.message); }
  finally{ btn.disabled=false; btn.textContent="Guardar"; }
}

async function deleteCfgQuickReply(id){
  if(!confirm("¿Eliminar este comando?")) return;
  await sbDelete(`quick_replies?id=eq.${id}`);
  quickReplies = quickReplies.filter(x=>String(x.id)!==String(id));
  renderCfgQuickReplies();
  loadQuickReplies();
}

// ---------- Config Chat: gestión de embudos ----------
function renderCfgPipelines(){
  const box = document.getElementById("cfgPipeList"); if(!box) return;
  box.innerHTML = "";
  if(!state.pipelines.length){ box.innerHTML='<div style="color:var(--text-dim);font-size:13px">Sin embudos. Crea uno.</div>'; return; }
  for(const p of state.pipelines){
    const row = document.createElement("div");
    row.style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;margin-bottom:8px";
    const stages = (p.stages||[]).map(s=>{const c=stageColor(p,s);return `<span style="background:${c}22;border:1px solid ${c}66;color:${c};border-radius:5px;padding:2px 7px;font-size:11px;font-weight:600">${esc(s)}</span>`;}).join(" ");
    row.innerHTML=`<div style="flex:1"><div style="font-weight:600;font-size:14px;margin-bottom:4px">${esc(p.name)}</div><div style="display:flex;gap:4px;flex-wrap:wrap">${stages}</div></div>`;
    const editBtn = document.createElement("button");
    editBtn.innerHTML='<span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px">edit</span>';
    editBtn.style="background:none;border:1px solid var(--border);border-radius:7px;padding:5px 8px;cursor:pointer;color:var(--text-dim)";
    editBtn.onclick=()=>openEditPipeModal(p);
    const delBtn = document.createElement("button");
    delBtn.innerHTML='<span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px">delete</span>';
    delBtn.style="background:none;border:1px solid #fca5a5;border-radius:7px;padding:5px 8px;cursor:pointer;color:#b91c1c";
    delBtn.onclick=()=>deletePipeline(p.id);
    row.appendChild(editBtn); row.appendChild(delBtn);
    box.appendChild(row);
  }
}
let _editingPipeId = null;
function openEditPipeModal(p){
  _editingPipeId = p ? p.id : null;
  editingStages = p ? [...(p.stages||[])] : ["nueva","interesada","pagada"];
  editingStageColors = p ? (p.stages||[]).map((s,i)=>(p.stage_colors||{})[s]||_STAGE_PAL[i%_STAGE_PAL.length]) : ["#6366f1","#f59e0b","#22c55e"];
  document.getElementById("pipeModalTitle").textContent = p ? "Editar embudo" : "Nuevo embudo";
  document.getElementById("pipeNameInput").value = p ? p.name : "";
  renderStageEdit();
  document.getElementById("pipeModal").classList.add("show");
}
async function deletePipeline(id){
  if(!confirm("¿Eliminar este embudo?")) return;
  await sbDelete(`pipelines?id=eq.${id}`);
  state.pipelines = state.pipelines.filter(p=>String(p.id)!==String(id));
  if(!state.pipelines.length){ /* sin embudos */ }
  else if(state.activePipeline===id) state.activePipeline = state.pipelines[0].id;
  renderPipeTabs(); renderCfgPipelines(); renderChatList();
}

// expandir comandos al escribir
function expandCommand(text){
  if(!text.startsWith("/"))return text;
  const cmd=text.split(" ")[0];
  const q=quickReplies.find(x=>x.command===cmd);
  if(!q)return text;
  const name=state.chats.get(state.active).name.split(" ")[0];
  return q.message_template.replace(/{nombre}/g,name);
}

// ---------- Selector de productos ----------
let picker={size:null,selected:new Set(),products:[]};
async function openPicker(){
  picker.selected.clear(); picker.size=null; picker.products=[];
  $("#overlay").classList.add("show");
  const grid=$("#prodGrid");
  // Mostrar caché inmediatamente si existe
  try{
    const cached=JSON.parse(localStorage.getItem("bloom_catalog_cache")||"[]");
    if(cached.length){
      picker.products=cached;
      renderSizes(); renderProducts(); updateSendBtn();
    } else {
      grid.innerHTML=`<div style="grid-column:1/-1;padding:24px;text-align:center;color:var(--text-dim);font-size:13px"><span class="material-symbols-outlined" style="font-size:28px;display:block;margin-bottom:8px;opacity:.5">inventory_2</span>Cargando productos…</div>`;
    }
  }catch(e){
    grid.innerHTML=`<div style="grid-column:1/-1;padding:24px;text-align:center;color:var(--text-dim);font-size:13px">Cargando productos…</div>`;
  }
  // Refrescar desde red en segundo plano
  try{
    const fresh=await fetchProducts();
    if(fresh?.length){ picker.products=fresh; renderSizes(); renderProducts(); updateSendBtn(); }
  }catch(e){}
}
function closePicker(){$("#overlay").classList.remove("show");}
async function fetchProducts(){
  try{
    const ctrl=new AbortController();
    const tid=setTimeout(()=>ctrl.abort(),14000);
    const r=await fetch(`${C.WORKER_URL}/products?store=${C.STORE}`,{signal:ctrl.signal});
    clearTimeout(tid);
    if(r.ok){
      const d=await r.json();
      if(d.length){
        try{ localStorage.setItem("bloom_catalog_cache", JSON.stringify(d)); }catch{}
        return d;
      }
    }
  }catch(e){}
  try{ const c=JSON.parse(localStorage.getItem("bloom_catalog_cache")||"[]"); if(c.length) return c; }catch{}
  return C.DEMO_PRODUCTS;
}
function allSizes(){const s=new Set();picker.products.forEach(p=>(p.sizes||[]).forEach(x=>s.add(x)));return [...s];}
function renderSizes(){
  const row=$("#sizeRow");row.innerHTML="";
  for(const s of allSizes()){
    const b=el("div","sz"+(picker.size===s?" on":""));b.textContent=s;
    b.onclick=()=>{picker.size=picker.size===s?null:s;renderSizes();renderProducts();};
    row.appendChild(b);
  }
}
function renderProducts(){
  const grid=$("#prodGrid");grid.innerHTML="";
  const q=($("#pickerSearch")?.value||"").trim().toLowerCase();
  const list=picker.products.filter(p=>p.stock>0
    &&(!picker.size||(p.sizes||[]).includes(picker.size))
    &&(!q||p.name.toLowerCase().includes(q)));
  for(const p of list){
    const card=el("div","pc"+(picker.selected.has(p.id)?" on":""));
    const stk=p.stock<=2?`<span class="low">${p.stock} disp.</span>`:`<span class="ok">${p.stock} stock</span>`;
    const img=p.image?`<img src="${esc(p.image)}" alt="">`:(p.emoji||"<span class=\"material-symbols-outlined\" style=\"font-size:28px;color:var(--text-dim)\">shopping_bag</span>");
    card.innerHTML=`<div class="pc-img">${img}</div><div class="pc-b"><div class="pc-n">${esc(p.name)}</div><div class="pc-p">${money(p.price)}</div><div class="pc-s">${stk}</div></div>`;
    card.onclick=()=>{if(picker.selected.has(p.id))picker.selected.delete(p.id);else if(picker.selected.size<3)picker.selected.add(p.id);renderProducts();updateSendBtn();};
    grid.appendChild(card);
  }
}
function updateSendBtn(){const n=picker.selected.size;const b=$("#sendProdBtn");b.disabled=n===0;b.textContent=`Enviar ${n} producto${n!==1?"s":""}`;}
async function sendProducts(){
  const sel=picker.products.filter(p=>picker.selected.has(p.id));
  const sz=picker.size?` (talla ${picker.size})`:"";
  const lines=sel.map(p=>`• *${p.name}*${sz} — ${money(p.price)}`).join("\n");
  const name=state.chats.get(state.active).name.split(" ")[0];
  const msg=`Hola ${name}! 🌸 Te comparto estas opciones:\n\n${lines}\n\n¿Cuál te gusta más? Te la aparto ya 💕`;
  closePicker(); await dispatch(msg);
}

// ---------- Realtime ----------
function startRealtime(){
  const ws=new WebSocket(`${SB.url.replace("https","wss")}/realtime/v1/websocket?apikey=${SB.key}&vsn=1.0.0`);
  ws.onopen=()=>{
    setConn(true);
    ws.send(JSON.stringify({topic:"realtime:public:messages",event:"phx_join",
      payload:{config:{postgres_changes:[{event:"INSERT",schema:"public",table:"messages"}]}},ref:"1"}));
    ws.send(JSON.stringify({topic:"realtime:public:team_messages",event:"phx_join",
      payload:{config:{postgres_changes:[{event:"INSERT",schema:"public",table:"team_messages"}]}},ref:"2"}));
    setInterval(()=>ws.readyState===1&&ws.send(JSON.stringify({topic:"phoenix",event:"heartbeat",payload:{},ref:"hb"})),30000);
  };
  ws.onmessage=ev=>{const d=JSON.parse(ev.data);
    if(d.event==="postgres_changes"){
      const m=d.payload?.data?.record;
      const tbl=d.payload?.data?.table;
      if(m && tbl==="team_messages"){ if(getCurrentScreen()==="equipo") loadTeamMsgs(); return; }
      if(m)onIncoming(m);
    }};
  ws.onclose=()=>{setConn(false);setTimeout(startRealtime,3000);};
  ws.onerror=()=>setConn(false);
}
async function onIncoming(m){
  if(m.direction!=="in")return;
  const phone=m.contact_phone;
  let c=state.chats.get(phone);
  if(!c){
    // contacto nuevo: tráelo completo (puede traer referral/tags)
    const rows=await sbGet(`contacts?phone=eq.${phone}&limit=1`);
    const r=rows[0]||{};
    c={phone,name:r.name||phone,stage:r.stage||"nueva",pipeline_id:r.pipeline_id,
       tags:r.tags||[],ref_source_type:r.ref_source_type,ref_headline:r.ref_headline,
       ref_body:r.ref_body,ref_media_url:r.ref_media_url,last:"",lastAt:m.created_at,unread:0};
    state.chats.set(phone,c);
  }
  c.last=m.body;c.lastAt=m.created_at;
  if(state.active===phone){appendMessage(m); if(m.msg_type==="referral")renderPanel();}
  else c.unread=(c.unread||0)+1;
  renderChatList();
}
function setConn(on){$("#connDot").classList.toggle("on",on);$("#connText").textContent=on?"en línea":"reconectando…";}

// ---------- UI misc ----------
function autoGrow(){const t=$("#chatInput");t.style.height="auto";t.style.height=Math.min(t.scrollHeight,100)+"px";}
$("#chatInput").addEventListener("input",()=>{ autoGrow(); showCmdSuggest($("#chatInput").value); });
$("#chatInput").addEventListener("keydown",e=>{
  if(e.key==="Escape"){hideCmdSuggest();return;}
  if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();
    const raw=$("#chatInput").value.trim();
    if(!raw.startsWith("/")) { $("#chatInput").value=expandCommand(raw); }
    sendCurrent();}
});
let searchTimer;
$("#searchBox").addEventListener("input",e=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.search=e.target.value;renderChatList();},180);});

// ====================================================================
//  POS + VENDEDORES + MÉTODOS DE PAGO + REPORTES
// ====================================================================
const pos = { catalog:[], cart:[], saleType:"tienda", payment:null, sellers:[], payments:[], splitPayments:[],
  discount:{type:null, value:0}, customer:null, billing:null, customerSaved:false,
  cashiers:[], cashier:null, settings:null, teamAuthor:null, users:[], currentUser:null };
// splitPayments: [{method, icon, amount}] hasta 4
// discount: {type:'pct'|'val', value:number}

// ---- Cambio de pantalla ----
function switchScreen(name){
  if(window.innerWidth<=720 && !_inPopstate) history.pushState({screen:name},"");
  // Cerrar kanban siempre que se cambie pantalla
  if(_boardMode){
    _boardMode=false;
    // Siempre limpiar todo el estado del kanban sin importar innerWidth
    _closeBoardMobile();
    $("#kanbanBoard")?.classList.remove("show");
    document.body.classList.remove("board-open");
    const btn=$("#boardToggleBtn");
    if(btn) btn.querySelector(".material-symbols-outlined").textContent="view_kanban";
  }
  // Siempre limpiar chat-open/panel-open al cambiar pantalla — sin importar window.innerWidth
  // (si el viewport se expandió, window.innerWidth puede devolver >720 en móvil y dejar chat-open pegado)
  document.body.classList.remove("chat-open","panel-open");
  state.active=null;
  const pan=$("#panel"); if(pan) pan.classList.add("hidden");
  ["chats","pos","equipo","datos","config"].forEach(s=>{
    const el=document.getElementById("screen-"+s);
    const nav=document.getElementById("nav-"+s);
    el.classList.toggle("active", s===name);
    // No tocar inline display — CSS se encarga con !important
    if(nav) nav.classList.toggle("on", s===name);
  });
  if(name==="chats"){ renderChatList(); if(!pos.sellers?.length) loadSellers(); }
  if(name==="pos" && !pos._posReady) initPos();
  if(name==="config"){
    if(!pos.currentUser?.is_master){ alert("Solo el master puede acceder a la configuración."); switchScreen("pos"); return; }
    initConfig();
  }
  if(name==="datos") initDatos();
  if(name==="equipo") initTeam();
  // Resetear viewport para que el media query mobile se aplique correctamente
  const _vp=document.querySelector("meta[name=viewport]");
  if(_vp) _vp.setAttribute("content","width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no,viewport-fit=cover");
}

// ---- Cargar vendedores y métodos de pago ----
async function loadUsers(){
  const all = await sbGet(`sellers?store=eq.${C.STORE}&active=eq.true&order=name.asc`) || [];
  pos.users = all;
  pos.sellers = all;
  pos.cashiers = all.filter(u=>u.is_cashier||u.is_master);
}
async function loadSellers(){
  if(pos.users.length){ pos.sellers=pos.users.filter(u=>u.is_seller); return; }
  pos.sellers = await sbGet(`sellers?store=eq.${C.STORE}&active=eq.true&order=name.asc`) || [];
}
async function loadPayments(){ pos.payments = await sbGet(`payment_methods?store=eq.${C.STORE}&active=eq.true&order=position.asc`); }

// ---- POS ----
async function loadCashiers(){
  if(pos.users.length){ pos.cashiers=pos.users.filter(u=>u.is_cashier||u.is_master); return; }
  pos.cashiers = await sbGet(`cashiers?store=eq.${C.STORE}&active=eq.true&order=name.asc`) || [];
}

async function initPos(){
  pos.catalog = await fetchProducts();
  await loadUsers(); await loadPayments(); await loadSettings();
  renderPosCatalog(); renderSellerSelect(); renderPayGrid(); renderCart();
  renderCashierBtn(); renderHoldsBtn(); renderOfflineUI();
  loadGoalBar();
  if(navigator.onLine) syncPendingSales();
  initDeptos();
  checkCustomOrderAlerts();
  initBarcodeInput();
  pos._posReady = true;
  if(!pos.currentUser){
    const restored = await restoreSession();
    if(!restored) showLoginModal();
  }
}

function initBarcodeInput(){
  if(window._barcodeListenerActive) return;
  window._barcodeListenerActive = true;
  let buf = "", lastKey = 0;
  document.addEventListener("keydown", e=>{
    // Solo en pantalla POS
    const posEl = $("#screen-pos");
    if(!posEl || posEl.style.display==="none") return;
    // No interceptar si el foco está en otro input (PIN, nombre, etc.)
    const a = document.activeElement;
    if(a && a.id !== "posSearch" && (a.tagName==="INPUT"||a.tagName==="TEXTAREA")) return;
    if(e.ctrlKey||e.altKey||e.metaKey) return;
    const now = Date.now();
    // Si pasaron más de 100ms entre teclas, el buffer es de escritura manual — resetear
    if(now - lastKey > 100) buf = "";
    lastKey = now;
    if(e.key==="Enter"){
      e.preventDefault();
      const code = buf.trim();
      buf = "";
      if(code.length < 2) return;
      const found = findProductByCode(code);
      if(found){
        addToCart(found.product, found.variant_id);
        const inp=$("#posSearch"); if(inp){inp.value="";renderPosCatalog();}
        if(navigator.vibrate) navigator.vibrate(60);
      }
    } else if(e.key.length===1){
      buf += e.key;
    }
  });
}

// Alerta de pedidos personalizados próximos (≤3 días) al abrir el POS
async function checkCustomOrderAlerts(){
  try{
    const rows=await sbGet(`custom_orders?store=eq.${C.STORE}&delivered=eq.false&order=delivery_date.asc`);
    if(!rows || !rows.length) return;
    const hoy=new Date(); hoy.setHours(0,0,0,0);
    const proximos=rows.filter(o=>{
      if(!o.delivery_date) return false;
      const f=new Date(o.delivery_date+"T00:00:00");
      const dias=Math.ceil((f-hoy)/(1000*60*60*24));
      return dias<=3; // hoy, próximos 3 días, o atrasados
    });
    if(!proximos.length) return;
    // evita repetir la alerta más de una vez por día
    const hoyStr=hoy.toISOString().slice(0,10);
    if(sessionStorage.getItem("persAlert")===hoyStr) return;
    sessionStorage.setItem("persAlert",hoyStr);

    let msg="⚠️ PEDIDOS PERSONALIZADOS PRÓXIMOS A ENTREGAR:\n\n";
    for(const o of proximos){
      const f=new Date(o.delivery_date+"T00:00:00");
      const dias=Math.ceil((f-hoy)/(1000*60*60*24));
      const cuando = dias<0?`ATRASADO ${-dias} días`: dias===0?"¡HOY!": `en ${dias} días`;
      msg+=`• ${o.customer_name||"Cliente"} — ${o.product_name} — entrega ${o.delivery_date} (${cuando})\n`;
    }
    msg+="\n📌 Avísale a Daniela para que esté pendiente.";
    alert(msg);
  }catch(e){ console.warn("No se pudo revisar pedidos personalizados:",e); }
}

// ===== CAJERO =====
function renderCashierBtn(){
  const btn=$("#cashierBtn"); if(!btn) return;
  if(pos.cashier){ btn.innerHTML=`<span class="material-symbols-outlined" style="font-size:15px;vertical-align:-3px">face_3</span> ${esc(pos.cashier.name)}`; btn.classList.add("set"); }
  else{ btn.innerHTML='<span class="material-symbols-outlined" style="font-size:15px;vertical-align:-3px">face_3</span> Cajero'; btn.classList.remove("set"); }
}

// ===== VENTAS EN ESPERA =====
function _holdsLoad(){ try{ return JSON.parse(localStorage.getItem("bloom_holds")||"[]"); }catch{ return []; } }
function _holdsSave(h){ localStorage.setItem("bloom_holds", JSON.stringify(h)); }

function renderHoldsBtn(){
  const holds=_holdsLoad();
  const lbl=$("#holdsLabel"); if(!lbl) return;
  if(holds.length){
    lbl.innerHTML=`En espera <span style="background:var(--accent);color:#fff;border-radius:10px;padding:1px 7px;font-size:11px">${holds.length}</span>`;
  } else {
    lbl.textContent="En espera";
  }
}

function holdsAction(){
  if(pos.cart.length){
    // Tiene carrito activo → preguntar si poner en espera
    const nombre = pos.customer?.name || pos.customer?.full_name || null;
    const label = nombre || `Espera ${_holdsLoad().length+1}`;
    const holds=_holdsLoad();
    holds.push({
      ts: Date.now(), label,
      cart: JSON.parse(JSON.stringify(pos.cart)),
      customer: pos.customer ? JSON.parse(JSON.stringify(pos.customer)) : null,
      customerSaved: pos.customerSaved,
      billing: pos.billing ? JSON.parse(JSON.stringify(pos.billing)) : null,
      splitPayments: JSON.parse(JSON.stringify(pos.splitPayments)),
      discount: JSON.parse(JSON.stringify(pos.discount)),
      saleType: pos.saleType,
      cashier: pos.cashier ? JSON.parse(JSON.stringify(pos.cashier)) : null,
    });
    _holdsSave(holds);
    clearPosCart();
    renderHoldsBtn();
    if(_holdsLoad().length>0) openHoldsModal();
  } else {
    openHoldsModal();
  }
}

function clearPosCart(){
  pos.cart=[]; pos.payment=null; pos.splitPayments=[];
  pos.discount={type:null,value:0}; pos.customer=null; pos.billing=null; pos.customerSaved=false;
  ["custDoc","custName","custLastName","custEmail","custAddress","custPhone",
   "empName","empNit","empPhone","empEmail","empAddress"].forEach(id=>{const e=$("#"+id);if(e)e.value="";});
  if($("#custEsEmpresa")){ $("#custEsEmpresa").checked=false; if(typeof onEmpresaToggle==="function") onEmpresaToggle(); }
  if($("#custDepto")&&window.COLOMBIA){$("#custDepto").value="Santander"; onDeptoChange(); if($("#custCity"))$("#custCity").value="Bucaramanga";}
  $("#btnCustomer").classList.remove("done");
  $("#custBtnLabel").innerHTML='<span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px">assignment</span> Datos del cliente *';
  $("#btnPayment").classList.remove("done");
  $("#payBtnLabel").innerHTML='<span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px">credit_card</span> Medios de pago *';
  $("#discBtnLabel").innerHTML='<span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px">sell</span> Agregar descuento';
  renderCart(); renderPayGrid(); refreshConfirmState();
}

function openHoldsModal(){
  renderHoldsPanel();
  $("#holdsModal").classList.add("show");
}
function closeHoldsModal(){ $("#holdsModal").classList.remove("show"); }

function renderHoldsPanel(){
  const holds=_holdsLoad();
  const box=$("#holdsBody"); box.innerHTML="";
  if(!holds.length){
    box.innerHTML='<div style="color:var(--text-dim);font-size:13px;padding:8px 0">No hay ventas en espera.</div>';
    return;
  }
  for(let i=0;i<holds.length;i++){
    const h=holds[i];
    const total=h.cart.reduce((s,it)=>s+(it.price||0)*(it.qty||1),0);
    const hora=new Date(h.ts).toLocaleTimeString("es-CO",{hour:"2-digit",minute:"2-digit"});
    const nombres=h.cart.map(it=>(it.qty>1?`${it.qty}× `:"")+it.name);
    const preview=nombres.slice(0,2).join(", ")+(nombres.length>2?` +${nombres.length-2} más`:"");
    const row=el("div","cfg-row");
    row.style.cssText="flex-direction:column;align-items:flex-start;gap:4px;padding:12px;cursor:default";
    row.innerHTML=`
      <div style="display:flex;justify-content:space-between;width:100%;align-items:center">
        <b style="font-size:14px">${esc(h.label)}</b>
        <span style="font-size:12px;color:var(--text-dim)">${hora}</span>
      </div>
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:1px">${esc(preview)}</div>
      <div style="font-size:13px;color:var(--text-dim)"><b>${money(total)}</b></div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <button onclick="restoreHold(${i})" style="padding:6px 16px;background:var(--accent);color:#fff;border:none;border-radius:var(--radius);font-size:13px;font-weight:600;cursor:pointer">Recuperar</button>
        <button onclick="deleteHold(${i})" style="padding:6px 12px;background:none;border:1px solid var(--border);border-radius:var(--radius);font-size:13px;cursor:pointer;color:var(--text-dim)">Eliminar</button>
      </div>`;
    box.appendChild(row);
  }
}

function restoreHold(i){
  if(pos.cart.length && !confirm("El carrito actual se perderá. ¿Continuar?")) return;
  const holds=_holdsLoad();
  const h=holds.splice(i,1)[0];
  _holdsSave(holds);
  clearPosCart();
  pos.cart=h.cart; pos.customer=h.customer; pos.customerSaved=h.customerSaved;
  pos.billing=h.billing; pos.splitPayments=h.splitPayments; pos.discount=h.discount;
  if(h.saleType) pos.saleType=h.saleType;
  if(h.cashier){ pos.cashier=h.cashier; renderCashierBtn(); }
  // Restaurar botones de UI
  if(pos.customerSaved && pos.customer){
    const n=[pos.customer.full_name||pos.customer.name||"",pos.customer.email||""].filter(Boolean).join(" · ");
    $("#btnCustomer").classList.add("done");
    $("#custBtnLabel").textContent=`✓ ${n}`;
  }
  if(pos.splitPayments.length){
    const resumen=pos.splitPayments.map(p=>`${p.method} ${money(p.amount)}`).join(" + ");
    $("#btnPayment").classList.add("done");
    $("#payBtnLabel").innerHTML=`✓ ${esc(resumen)} <span class="chk">editar</span>`;
  }

  renderCart(); renderPayGrid(); refreshConfirmState();
  renderHoldsBtn();
  closeHoldsModal();
}

function deleteHold(i){
  const holds=_holdsLoad();
  holds.splice(i,1);
  _holdsSave(holds);
  renderHoldsBtn();
  renderHoldsPanel();
}

// ===== VENTAS OFFLINE =====
function _pendingLoad(){ try{ return JSON.parse(localStorage.getItem("bloom_pending_sales")||"[]"); }catch{ return []; } }
function _pendingSave(q){ localStorage.setItem("bloom_pending_sales", JSON.stringify(q)); }

function renderOfflineUI(){
  const offline=!navigator.onLine;
  let banner=$("#offlineBanner");
  if(banner){ banner.style.display=offline?"block":"none"; }
  renderPendingBadge();
}

function renderPendingBadge(){
  const n=_pendingLoad().length;
  const badge=$("#pendingBadge");
  const banner=$("#pendingBanner");
  if(badge){ badge.style.display=n?"inline":"none"; badge.textContent=`${n} venta${n!==1?"s":""} por sincronizar`; }
  if(banner){ banner.style.display=n?"flex":"none"; }
}

function saveOfflineSale(orderPayload, salePayload){
  const ref="offline_"+Date.now()+"_"+Math.random().toString(36).slice(2,7);
  const q=_pendingLoad();
  // ref viaja a Shopify (como note) y a Supabase (como shopify_order_name si no hay otro)
  q.push({ id:ref, ref, orderPayload:{...orderPayload, offline_ref:ref}, salePayload, ts:Date.now(),
           shopify_done:false, shopify_order_id:null, shopify_order_name:null });
  _pendingSave(q);
  renderPendingBadge();
}

let _syncing=false;
async function syncPendingSales(){
  if(_syncing || !navigator.onLine) return;
  const q=_pendingLoad();
  if(!q.length) return;
  _syncing=true;
  const badge=$("#pendingBadge");
  if(badge) badge.textContent="Sincronizando…";

  for(const p of [...q]){
    try{
      // Paso 1: Shopify — solo si no se hizo ya (evita crear pedido duplicado)
      if(!p.shopify_done){
        try{
          const r=await fetch(`${C.WORKER_URL}/order`,{method:"POST",
            headers:{"Content-Type":"application/json"},body:JSON.stringify(p.orderPayload)});
          const shopify=await r.json();
          // Persiste el resultado parcial ANTES de continuar
          const updated=_pendingLoad().map(x=>x.id===p.id
            ? {...x, shopify_done:true, shopify_order_id:shopify.order_id||null, shopify_order_name:shopify.order_name||null}
            : x);
          _pendingSave(updated);
          p.shopify_done=true;
          p.shopify_order_id=shopify.order_id||null;
          p.shopify_order_name=shopify.order_name||null;
        }catch(e){ console.warn("shopify sync error",e); }
      }

      // Paso 2: Supabase — comprueba si ya existe usando ref como shopify_order_name fallback
      const refKey = p.shopify_order_name || p.ref;
      const existing = await sbGet(`sales?shopify_order_name=eq.${encodeURIComponent(refKey)}&store=eq.bloom&select=id`);
      if(!existing?.length){
        const payload={...p.salePayload,
          shopify_order_id: p.shopify_order_id||null,
          shopify_order_name: refKey,
        };
        const r2=await sbPost("sales", payload);
        if(!r2.ok) continue; // falla → deja en cola, reintentará
      }

      // Éxito (guardado o ya existía) → sacar de la cola
      _pendingSave(_pendingLoad().filter(x=>x.id!==p.id));
    }catch(e){ console.warn("sync error",e); }
  }

  _syncing=false;
  renderPendingBadge();
}

// Escucha cambios de conectividad
window.addEventListener("online",  ()=>{ renderOfflineUI(); syncPendingSales(); });
window.addEventListener("offline", ()=>{ renderOfflineUI(); });

function openCashierPick(){
  const box=$("#cashierPickList"); box.innerHTML="";
  if(!pos.cashiers.length){
    box.innerHTML='<div style="color:var(--text-dim);font-size:13px">No hay cajeros. Créalos en Config.</div>';
  }else{
    for(const c of pos.cashiers){
      const row=el("div","cust-result");
      const lock = c.require_pin ? " <span class=\"material-symbols-outlined\" style=\"font-size:13px;vertical-align:-2px\">lock</span>" : "";
      const av = c.photo_url?`<img src="${esc(c.photo_url)}" style="width:26px;height:26px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:6px">`:"👤 ";
      row.innerHTML=`<div class="r-nm">${av}${esc(c.name)}${lock}</div>`;
      row.onclick=()=>_initCashierSwitch(c);
      box.appendChild(row);
    }
  }
  $("#cashierModal").classList.add("show");
}
function closeCashierPick(){ $("#cashierModal").classList.remove("show"); }

// Cambio de cajero con confirmación y PIN
let _pendingCashier=null;
function _initCashierSwitch(c){
  closeCashierPick();
  _pendingCashier=c;
  if(!pos.cashier || pos.cashier.id===c.id){ _doCashierSwitch(); return; }
  // Hay cajero activo distinto → pedir confirmación
  const modal=document.getElementById("switchCashierModal");
  document.getElementById("scFrom").textContent=pos.cashier.name;
  document.getElementById("scTo").textContent=c.name;
  modal.style.display="flex";
}
function closeSwitchCashierModal(){
  document.getElementById("switchCashierModal").style.display="none";
  _pendingCashier=null;
}
function confirmCashierSwitch(){
  document.getElementById("switchCashierModal").style.display="none";
  _doCashierSwitch();
}
function _doCashierSwitch(){
  const c=_pendingCashier; if(!c) return;
  if(c.require_pin || c.pin){
    window._pinForCashier=c;
    _pinResolve=(ok)=>{ if(ok){ pos.cashier=c; renderCashierBtn(); } _pendingCashier=null; };
    $("#pinInput").value=""; $("#pinError").style.display="none";
    $("#pinMsg").textContent=`Clave de ${c.name} (4 dígitos)`;
    $("#pinModal").classList.add("show");
    setTimeout(()=>$("#pinInput").focus(),100);
  } else {
    pos.cashier=c; renderCashierBtn(); _pendingCashier=null;
  }
}

// PIN: se pide en cada venta si el cajero lo requiere
let _pinResolve=null;
function askPin(){
  return new Promise((resolve)=>{
    if(!pos.cashier || !pos.cashier.require_pin){ resolve(true); return; }
    _pinResolve=resolve;
    $("#pinInput").value=""; $("#pinError").style.display="none";
    $("#pinMsg").textContent=`Clave de ${pos.cashier.name} (4 dígitos)`;
    $("#pinModal").classList.add("show");
    setTimeout(()=>$("#pinInput").focus(),100);
  });
}
function confirmPin(){
  const val=$("#pinInput").value.trim();
  const target=window._pinForCashier||pos.cashier;
  if(val===String(target.pin)){
    $("#pinModal").classList.remove("show");
    window._pinForCashier=null;
    if(_pinResolve){ _pinResolve(true); _pinResolve=null; }
  }else{
    $("#pinError").style.display="block";
  }
}
function closePin(){
  $("#pinModal").classList.remove("show");
  window._pinForCashier=null;
  if(_pinResolve){ _pinResolve(false); _pinResolve=null; }
}

// ---- Departamentos y ciudades (lista DANE) ----
function initDeptos(){
  const sel = $("#custDepto");
  if(!sel) return;
  if(!window.COLOMBIA){ console.warn("colombia.js no cargó - revisa que el archivo esté subido"); return; }
  if(sel.dataset.loaded) return;
  const deptos = Object.keys(window.COLOMBIA).sort((a,b)=>a.localeCompare(b,"es"));
  for(const d of deptos){
    const o=el("option"); o.value=d; o.textContent=d; sel.appendChild(o);
  }
  sel.dataset.loaded = "1";
  // Valor por defecto: Santander -> Bucaramanga
  if(window.COLOMBIA["Santander"]){
    sel.value = "Santander";
    onDeptoChange();
    const citySel = $("#custCity");
    if(citySel){ citySel.value = "Bucaramanga"; }
  }
}
function onDeptoChange(){
  const depto = $("#custDepto").value;
  const citySel = $("#custCity");
  citySel.innerHTML = '<option value="">Selecciona…</option>';
  if(!depto || !window.COLOMBIA || !window.COLOMBIA[depto]) return;
  const cities = [...window.COLOMBIA[depto]].sort((a,b)=>a.localeCompare(b,"es"));
  for(const c of cities){
    const o=el("option"); o.value=c; o.textContent=c; citySel.appendChild(o);
  }
}

// ====================================================================
//  PRODUCTO RÁPIDO (se agrega a la venta y se crea en Shopify)
// ====================================================================
function openQuickProduct(){
  $("#qpName").value=""; $("#qpPrice").value="";
  if($("#qpColor")) $("#qpColor").value="";
  if($("#qpSize")) $("#qpSize").value="";
  $("#quickProductModal").classList.add("show");
}
function closeQuickProduct(){ $("#quickProductModal").classList.remove("show"); }

async function saveQuickProduct(){
  const name=$("#qpName").value.trim();
  const price=parseInt(($("#qpPrice").value||"").replace(/\D/g,""))||0;
  const color=($("#qpColor")?.value||"").trim();
  const size=($("#qpSize")?.value||"").trim();
  if(!name){ alert("Falta el nombre del producto"); return; }
  if(!price){ alert("Falta el precio"); return; }

  const btn=$("#qpSaveBtn"); btn.disabled=true; btn.textContent="Creando…";

  let productId = "quick-"+Date.now();
  let variantId = null;

  try{
    const r=await fetch(`${C.WORKER_URL}/create-product`,{
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ name, price, color, size })
    });
    if(r.ok){
      const data=await r.json();
      if(data.ok){
        productId = data.product_id || productId;
        variantId = data.variant_id || null;
      }
    }
  }catch(e){ console.warn("No se pudo crear en Shopify (¿Worker sin conectar?):", e); }

  const label = [color,size].filter(Boolean).join(" · ");
  const p={ id:productId, name: label?`${name} (${label})`:name, price, emoji:"<span class=\"material-symbols-outlined\" style=\"font-size:22px;color:var(--accent)\">fiber_new</span>",
    variants: variantId?[{variant_id:variantId, size:size||null, price, stock:99}]:null };
  addToCart(p, variantId);

  btn.disabled=false; btn.textContent="Crear y agregar";
  closeQuickProduct();
}
let scanner = null;

function openScanner(){
  $("#scannerModal").classList.add("show");
  $("#scannerMsg").textContent = "Iniciando cámara…";
  if(typeof Html5Qrcode === "undefined"){
    $("#scannerMsg").textContent = "No se pudo cargar el lector. Revisa tu internet.";
    return;
  }
  scanner = new Html5Qrcode("scannerView");
  scanner.start(
    { facingMode: "environment" },         // cámara trasera
    { fps: 10, qrbox: { width: 240, height: 160 } },
    (decodedText) => onScanSuccess(decodedText),
    () => {}                                // ignora errores por frame
  ).then(()=>{
    $("#scannerMsg").textContent = "Apunta al código de barras o QR";
  }).catch(err=>{
    $("#scannerMsg").textContent = "No se pudo abrir la cámara. Da permiso o usa otro dispositivo.";
    console.error(err);
  });
}

function closeScanner(){
  $("#scannerModal").classList.remove("show");
  if(scanner){
    scanner.stop().then(()=>{ scanner.clear(); scanner=null; }).catch(()=>{ scanner=null; });
  }
}

let _lastScan="", _lastScanTime=0;
function onScanSuccess(code){
  code = (code||"").trim();
  if(!code) return;
  // evita leer el mismo código repetido en menos de 2 segundos
  const now=Date.now();
  if(code===_lastScan && (now-_lastScanTime)<2000) return;
  _lastScan=code; _lastScanTime=now;

  const found = findProductByCode(code);
  if(found){
    addToCart(found.product, found.variant_id);
    $("#scannerMsg").textContent = `✓ Agregado: ${found.product.name} — sigue escaneando o cierra`;
    $("#scannerMsg").style.color="#1d8a5e";
    if(navigator.vibrate) navigator.vibrate(80);
    // NO cierra: permite escanear varios productos seguidos
  }else{
    $("#scannerMsg").textContent = `Código ${code} no encontrado`;
    $("#scannerMsg").style.color="#c0392b";
    if(navigator.vibrate) navigator.vibrate([60,40,60]);
  }
}

function findProductByCode(code){
  const c = code.toLowerCase().trim();
  // 1) Prioridad: SKU (es tu identificador principal en Shopify)
  for(const p of pos.catalog){
    if(p.variants){
      for(const v of p.variants){
        if(v.sku && String(v.sku).toLowerCase().trim()===c) return {product:p, variant_id:v.variant_id};
      }
    }
  }
  // 2) Código de barras (por si algún producto lo tiene)
  for(const p of pos.catalog){
    if(p.variants){
      for(const v of p.variants){
        if(v.barcode && String(v.barcode).toLowerCase().trim()===c) return {product:p, variant_id:v.variant_id};
      }
    }
  }
  // 3) Por id de variante, id de producto o nombre exacto
  for(const p of pos.catalog){
    if(p.variants){
      for(const v of p.variants){
        if(String(v.variant_id)===code) return {product:p, variant_id:v.variant_id};
      }
    }
    if(String(p.id)===code) return {product:p, variant_id:null};
    if(p.name && p.name.toLowerCase()===c) return {product:p, variant_id:null};
  }
  return null;
}
function openCustomerModal(){
  initDeptos();  // asegura que los departamentos estén cargados al abrir
  $("#customerModal").classList.add("show");
}
function closeCustomerModal(){ $("#customerModal").classList.remove("show"); }

// ===== Buscar cliente en la base (cédula, nombre o celular) =====
let _custSearchTimer=null;
function custSearchDebounced(){
  clearTimeout(_custSearchTimer);
  _custSearchTimer=setTimeout(doCustomerSearch, 400);
}
async function doCustomerSearch(){
  const q=($("#custSearch").value||"").trim();
  const box=$("#custSearchResults");
  if(q.length<2){ box.innerHTML=""; return; }
  const esc2=encodeURIComponent(`%${q}%`);
  const rows=await sbGet(`customers?store=eq.${C.STORE}&or=(doc.ilike.${esc2},full_name.ilike.${esc2},phone.ilike.${esc2})&limit=8`);
  box.innerHTML="";
  if(rows && rows.length){
    for(const c of rows){
      const row=el("div","cust-result");
      row.innerHTML=`<div class="r-nm">${esc(c.full_name||c.name||"—")}</div>
        <div class="r-sub">${esc(c.doc||"")} · ${esc(c.phone||"")}${c.city?` · ${esc(c.city)}`:""}</div>`;
      row.onclick=()=>fillCustomerFromBase(c);
      box.appendChild(row);
    }
    return;
  }
  // No está en la base: si parece cédula (solo números), consulta la DIAN vía Alegra
  const soloDigitos = /^\d{5,12}$/.test(q);
  if(soloDigitos){
    box.innerHTML='<div style="font-size:12px;color:var(--text-dim);padding:6px">No está en tu base. Buscando en la DIAN…</div>';
    try{
      const r=await fetch(`${C.WORKER_URL}/dian?idType=CC&id=${encodeURIComponent(q)}`);
      const d=await r.json();
      if(d.ok){
        const row=el("div","cust-result");
        row.innerHTML=`<div class="r-nm">🏛️ ${esc(d.full_name)} <span style="font-size:10px;color:var(--accent-dark)">DIAN</span></div>
          <div class="r-sub">${esc(d.email||"")} · ${d.is_company?"Empresa":"Persona"}</div>`;
        row.onclick=()=>fillCustomerFromDian(d, q);
        box.innerHTML=""; box.appendChild(row);
      }else{
        box.innerHTML='<div style="font-size:12px;color:var(--text-dim);padding:6px">No encontrado en la DIAN. Llena los datos abajo.</div>';
      }
    }catch(e){
      box.innerHTML='<div style="font-size:12px;color:var(--text-dim);padding:6px">No se pudo consultar la DIAN (¿Worker sin conectar?). Llena los datos abajo.</div>';
    }
    return;
  }
  box.innerHTML='<div style="font-size:12px;color:var(--text-dim);padding:6px">Sin coincidencias. Llena los datos abajo.</div>';
}

// Autorrellena desde el resultado de la DIAN
function fillCustomerFromDian(d, cedula){
  const full=(d.full_name||"").trim();
  // La DIAN devuelve "APELLIDO1 APELLIDO2 NOMBRE1 NOMBRE2".
  // Heurística: primeras 2 palabras = apellidos, el resto = nombres.
  const parts=full.split(/\s+/);
  let nombres="", apellidos="";
  if(parts.length>=4){ apellidos=parts.slice(0,2).join(" "); nombres=parts.slice(2).join(" "); }
  else if(parts.length===3){ apellidos=parts.slice(0,2).join(" "); nombres=parts[2]; }
  else if(parts.length===2){ apellidos=parts[0]; nombres=parts[1]; }
  else { nombres=full; }

  $("#custName").value=nombres;
  $("#custLastName").value=apellidos;
  $("#custDoc").value=cedula;
  $("#custEmail").value=d.email||"";
  $("#custSearchResults").innerHTML="";
  $("#custSearch").value="";
  // si es empresa, activa el toggle de facturación
  if(d.is_company && $("#custEsEmpresa")){
    $("#custEsEmpresa").checked=true; onEmpresaToggle();
    $("#empName").value=full; $("#empNit").value=cedula; $("#empEmail").value=d.email||"";
  }
}
function fillCustomerFromBase(c){
  $("#custName").value=c.name||"";
  $("#custLastName").value=c.last_name||"";
  $("#custDoc").value=c.doc||"";
  $("#custPhone").value=c.phone||"";
  $("#custEmail").value=c.email||"";
  $("#custAddress").value=c.address||"";
  if(c.depto){ $("#custDepto").value=c.depto; onDeptoChange(); if(c.city) $("#custCity").value=c.city; }
  $("#custSearchResults").innerHTML="";
  $("#custSearch").value="";
}

// Muestra/oculta campos de empresa
function onEmpresaToggle(){
  $("#empresaFields").style.display = $("#custEsEmpresa").checked ? "block" : "none";
  if($("#custEsEmpresa").checked) initEmpresaDeptos();
}
function initEmpresaDeptos(){
  const sel=$("#empDepto"); if(!sel||sel.options.length>1) return;
  const deptos=Object.keys(window.COLOMBIA||{}).sort();
  deptos.forEach(d=>{ const o=document.createElement("option"); o.value=d; o.textContent=d; sel.appendChild(o); });
}
function onEmpDeptoChange(){
  const d=$("#empDepto").value;
  const sel=$("#empCity"); sel.innerHTML='<option value="">Selecciona…</option>';
  if(d && window.COLOMBIA&&window.COLOMBIA[d]){
    (window.COLOMBIA[d]||[]).sort().forEach(c=>{ const o=document.createElement("option"); o.value=c; o.textContent=c; sel.appendChild(o); });
  }
}

function emailValido(e){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

// Busca empresa por NIT en la DIAN vía Alegra
async function searchEmpresaDian(){
  const nit=($("#empNit").value||"").trim();
  if(!nit || nit.length<6) return;
  if($("#empName").value.trim()) return; // ya tiene nombre, no sobreescribir
  try{
    const r=await fetch(`${C.WORKER_URL}/dian?idType=NIT&id=${encodeURIComponent(nit)}`);
    const d=await r.json();
    if(d.ok && d.full_name){
      $("#empName").value=d.full_name.toUpperCase();
      if(d.email && !$("#empEmail").value) $("#empEmail").value=d.email.toLowerCase();
    }
  }catch(e){ console.warn("No se pudo buscar empresa en DIAN",e); }
}
function swapNameLastname(){
  const n=$("#custName").value;
  $("#custName").value=$("#custLastName").value;
  $("#custLastName").value=n;
}
// Validaciones Colombia
function celularValido(c){ return /^3\d{9}$/.test(c); }       // empieza en 3, 10 dígitos
function cedulaValida(c){
  if(c.length===9) return false;                               // no puede tener 9
  if(c.length===10 && !c.startsWith("1")) return false;        // si tiene 10, empieza en 1
  return c.length>=6 && c.length<=10;
}

function saveCustomerModal(){
  const depto=$("#custDepto").value, city=$("#custCity").value;

  // ----- DATOS DEL CLIENTE (siempre, para la venta en Shopify) -----
  const name=$("#custName").value.trim();
  const lastName=$("#custLastName").value.trim();
  const doc=$("#custDoc").value.trim();
  const phone=$("#custPhone").value.trim();
  const email=$("#custEmail").value.trim();
  const address=$("#custAddress").value.trim(); // opcional
  if(!name){ alert("Faltan los nombres"); return; }
  if(!lastName){ alert("Faltan los apellidos"); return; }
  if(!doc){ alert("Falta la cédula"); return; }
  if(!cedulaValida(doc)){ alert("Cédula inválida: no puede tener 9 dígitos, y si tiene 10 debe empezar en 1"); return; }
  if(!phone){ alert("Falta el celular"); return; }
  if(!celularValido(phone)){ alert("Celular inválido: debe empezar en 3 y tener 10 dígitos"); return; }
  if(!email || !emailValido(email)){ alert("Correo inválido"); return; }
  if(!depto){ alert("Selecciona el departamento"); return; }
  if(!city){ alert("Selecciona la ciudad"); return; }

  pos.customer={
    es_empresa:false, doc_type:"CC", doc, name:name.toUpperCase(), last_name:lastName.toUpperCase(),
    full_name:`${name} ${lastName}`.trim().toUpperCase(), email:email.toLowerCase(), phone, address:address.toUpperCase(), depto, city,
  };

  // ----- FACTURACIÓN EMPRESA (adicional, para el sistema de facturación) -----
  if($("#custEsEmpresa").checked){
    const emp=$("#empName").value.trim();
    const nit=$("#empNit").value.trim();
    const ephone=$("#empPhone").value.trim();
    const eemail=$("#empEmail").value.trim();
    const eaddress=$("#empAddress").value.trim();
    const edepto=$("#empDepto").value.trim();
    const ecity=$("#empCity").value.trim();
    if(!emp){ alert("Falta el nombre de la empresa"); return; }
    if(!nit){ alert("Falta el NIT"); return; }
    if(!ephone){ alert("Falta el teléfono de la empresa"); return; }
    if(!eemail || !emailValido(eemail)){ alert("Correo de facturación inválido"); return; }
    if(!eaddress){ alert("Falta la dirección de la empresa"); return; }
    if(!edepto){ alert("Selecciona el departamento de la empresa"); return; }
    if(!ecity){ alert("Selecciona la ciudad de la empresa"); return; }
    pos.billing={
      es_empresa:true, razon_social:emp, nit, phone:ephone, email:eemail,
      address:eaddress, depto:edepto, city:ecity,
    };
  }else{
    pos.billing=null;
  }

  pos.customerSaved=true;
  const btn=$("#btnCustomer");
  btn.classList.add("done");
  const extra = pos.billing ? " <span class=\"material-symbols-outlined\" style=\"font-size:13px;vertical-align:-3px\">business</span>" : "";
  $("#custBtnLabel").innerHTML=`✓ ${esc(pos.customer.full_name)}${extra} <span class="chk">editar</span>`;
  closeCustomerModal();
  refreshConfirmState();
}

// ====================================================================
//  MODAL: MEDIOS DE PAGO
// ====================================================================
function openPaymentModal(){
  $("#payModalTotal").textContent = money(cartTotal());
  if(!pos.splitPayments.length) pos.splitPayments.push({method:'',amount:cartTotal()});
  renderPayRows();
  $("#paymentModal").classList.add("show");
}
function closePaymentModal(){
  $("#paymentModal").classList.remove("show");
  // Si el pago no fue confirmado, limpiar para evitar "(revisar)" falso
  if(!$("#btnPayment")?.classList.contains("done")) pos.splitPayments=[];
}
function savePaymentModal(){
  const total=cartTotal();
  const sum=pos.splitPayments.reduce((s,p)=>s+(p.amount||0),0);
  if(!pos.splitPayments.length){ alert("Agrega al menos un medio de pago"); return; }
  if(!pos.splitPayments.every(p=>p.method)){ alert("Selecciona el medio de pago en cada fila"); return; }
  if(sum!==total){ alert(`El pago no cuadra. Total: ${money(total)}, pagado: ${money(sum)}`); return; }
  const btn=$("#btnPayment");
  btn.classList.add("done");
  const resumen=pos.splitPayments.map(p=>`${p.method} ${money(p.amount)}`).join(" + ");
  $("#payBtnLabel").innerHTML=`✓ ${esc(resumen)} <span class="chk">editar</span>`;
  closePaymentModal();
  refreshConfirmState();
}

function renderPayRows(){
  const box=$("#payRows"); if(!box) return;
  const total=cartTotal();
  const pms=pos.payments.filter(p=>/shopify/i.test(p.name)===false);
  const opts=pms.map(p=>`<option value="${esc(p.name)}">${p.icon?p.icon+' ':''}${esc(p.name)}</option>`).join('');
  box.innerHTML=pos.splitPayments.map((row,i)=>`
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
      <select onchange="payRowMethod(${i},this.value)"
        style="flex:1;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;background:var(--surface);color:var(--text)">
        <option value="">— Medio de pago —</option>${opts}
      </select>
      <input type="text" inputmode="numeric" id="payAmt${i}"
        value="${row.amount?money(row.amount):''}"
        onfocus="this.value=this.value.replace(/[^0-9]/g,'');this.select()"
        onblur="payRowAmountBlur(${i},this)"
        oninput="payRowAmount(${i},this.value)"
        placeholder="$0"
        style="width:110px;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;background:var(--surface);color:var(--text)">
      <button onclick="removePayRow(${i})" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-dim);padding:0 4px;flex-shrink:0">×</button>
    </div>`).join('');
  pos.splitPayments.forEach((row,i)=>{
    const sel=box.querySelectorAll('select')[i];
    if(sel && row.method) sel.value=row.method;
  });
  _updatePayDiff();
}
function _updatePayDiff(){
  const total=cartTotal();
  const sum=pos.splitPayments.reduce((s,p)=>s+(p.amount||0),0);
  const diff=total-sum;
  const diffEl=$("#payDiff");
  if(diffEl) diffEl.innerHTML = diff===0
    ? `<div style="text-align:center;padding:10px 0;font-size:16px;font-weight:700;color:var(--accent)">✓ Cuadra exacto</div>`
    : `<div style="text-align:center;padding:10px 0;font-size:16px;font-weight:700;color:#c0392b">${diff<0?'Exceso':'Faltan'}: ${money(Math.abs(diff))}</div>`;
}
function addPayRow(){
  const total=cartTotal();
  const already=pos.splitPayments.reduce((s,p)=>s+(p.amount||0),0);
  pos.splitPayments.push({method:'',icon:'💳',icon_url:null,amount:Math.max(0,total-already)});
  renderPayRows();
}
function removePayRow(i){
  pos.splitPayments.splice(i,1);
  renderPayRows();
}
function payRowMethod(i,v){
  const p=pos.payments.find(pm=>pm.name===v)||{};
  pos.splitPayments[i].method=v;
  pos.splitPayments[i].id=p.id||null;
  pos.splitPayments[i].icon=p.icon||'💳';
  pos.splitPayments[i].icon_url=p.icon_url||null;
}
function payRowAmount(i,v){
  pos.splitPayments[i].amount=parseInt(String(v).replace(/\D/g,''))||0;
  _updatePayDiff();
}
function payRowAmountBlur(i,input){
  const n=parseInt(String(input.value).replace(/\D/g,''))||0;
  pos.splitPayments[i].amount=n;
  input.value=n?money(n):'';
  _updatePayDiff();
}

// ====================================================================
//  MODAL: DESCUENTO
// ====================================================================
let discTypeTmp="pct";
function openDiscountModal(){
  discTypeTmp = pos.discount.type || "pct";
  setDiscType(discTypeTmp);
  $("#discInput").value = pos.discount.value || "";
  previewDiscount();
  $("#discountModal").classList.add("show");
}
function closeDiscountModal(){ $("#discountModal").classList.remove("show"); }
function setDiscType(t){
  discTypeTmp=t;
  $("#discTypePct").classList.toggle("on",t==="pct");
  $("#discTypeVal").classList.toggle("on",t==="val");
  $("#discInputLabel").textContent = t==="pct"?"Porcentaje de descuento":"Valor del descuento en $";
  previewDiscount();
}
function previewDiscount(){
  const raw=parseInt(String($("#discInput").value).replace(/\D/g,""))||0;
  const sub=cartSubtotal();
  let desc=0;
  if(discTypeTmp==="pct") desc=Math.round(sub*Math.min(raw,100)/100);
  else desc=Math.min(raw,sub);
  $("#discPreview").textContent = desc>0 ? `Descuento: -${money(desc)} → Total: ${money(sub-desc)}` : "";
}
function saveDiscount(){
  const raw=parseInt(String($("#discInput").value).replace(/\D/g,""))||0;
  pos.discount={type:discTypeTmp, value:raw};
  closeDiscountModal();
  renderCart();
  // marca el botón
  const lbl = discTypeTmp==="pct" ? `${raw}%` : money(raw);
  $("#discBtnLabel").innerHTML = raw>0 ? `<span class=\"material-symbols-outlined\" style=\"font-size:14px;vertical-align:-3px\">sell</span> Descuento: ${lbl} <span class="chk">editar</span>` : "<span class=\"material-symbols-outlined\" style=\"font-size:14px;vertical-align:-3px\">sell</span> Agregar descuento";
}
function clearDiscount(){
  pos.discount={type:null,value:0};
  $("#discInput").value="";
  $("#discBtnLabel").innerHTML="<span class=\"material-symbols-outlined\" style=\"font-size:14px;vertical-align:-3px\">sell</span> Agregar descuento";
  closeDiscountModal();
  renderCart();
}

// ---- Cálculos de totales ----
function cartSubtotal(){ return pos.cart.reduce((s,i)=>s+i.price*i.qty,0); }
function discountAmount(){
  const sub=cartSubtotal();
  if(!pos.discount.type||!pos.discount.value) return 0;
  if(pos.discount.type==="pct") return Math.round(sub*Math.min(pos.discount.value,100)/100);
  return Math.min(pos.discount.value,sub);
}
function cartTotal(){ return cartSubtotal()-discountAmount(); }

function refreshConfirmState(){
  const ready = pos.cart.length && pos.customerSaved && pos.splitPayments.length &&
    pos.splitPayments.reduce((s,p)=>s+(p.amount||0),0)===cartTotal();
  $("#confirmSale").disabled = !ready;
}
function renderPosCatalog(){
  const q=($("#posSearch").value||"").toLowerCase().trim();
  const grid=$("#posGrid"); grid.innerHTML="";
  const match = (p)=>{
    if(!q) return true;
    if(p.name && p.name.toLowerCase().includes(q)) return true;
    // también busca por SKU o código de barras de cualquier variante
    if(p.variants){
      for(const v of p.variants){
        if(v.sku && String(v.sku).toLowerCase().includes(q)) return true;
        if(v.barcode && String(v.barcode).toLowerCase().includes(q)) return true;
      }
    }
    return false;
  };
  const list = pos.catalog.filter(p=>{
    if(!match(p)) return false;
    const agotado = p.variants?.length ? p.variants.every(v=>v.stock<=0) : p.stock<=0;
    // Sin búsqueda: ocultar agotados. Con búsqueda: mostrar todos
    if(agotado && !q) return false;
    return true;
  });
  for(const p of list){
    const card=el("div","pos-card");
    const img=p.image?`<img src="${esc(p.image)}">`:(p.emoji||"<span class=\"material-symbols-outlined\" style=\"font-size:28px;color:var(--text-dim)\">shopping_bag</span>");
    const stockLbl = p.stock<=0 ? `<span style="color:#c0392b;font-weight:600">Agotado</span>` : p.stock<=3 ? `<span style="color:#e67e22">${p.stock} disp.</span>` : `<span>${p.stock} disp.</span>`;
    card.innerHTML=`<div class="img">${img}</div><div class="b"><div class="n">${esc(p.name)}</div><div class="p">${money(p.price)}</div><div class="s">${stockLbl}</div></div>`;
    card.onclick=()=>addToCart(p);
    grid.appendChild(card);
  }
  if(!list.length && q){
    grid.innerHTML = `<div style="grid-column:1/-1;color:var(--text-dim);font-size:13px;text-align:center;padding:20px">Sin resultados para "${esc(q)}"</div>`;
  }
}
function addToCart(p, forcedVariantId){
  // Escáner indica variante directa
  if(forcedVariantId && p.variants){
    const v=p.variants.find(x=>String(x.variant_id)===String(forcedVariantId));
    if(v){ pushToCart(p, v); return; }
  }
  // Una sola variante: directo
  if(!p.variants || p.variants.length<=1){
    const v = p.variants && p.variants[0];
    pushToCart(p, v||{variant_id:null, price:p.price, size:null});
    return;
  }
  // Varias variantes: abre selector de color/talla
  openVariantPicker(p);
}

function pushToCart(p, v){
  const variant_id = v.variant_id || null;
  const parts = [];
  if(v.color) parts.push(`Color: ${v.color}`);
  if(v.talla) parts.push(`Talla: ${v.talla}`);
  const label = parts.join(" · ") || v.size || null;
  const price = v.price ?? p.price;
  const key = variant_id || p.id;
  const existing=pos.cart.find(i=>i.key===key);
  if(existing) existing.qty++;
  else pos.cart.push({key,id:p.id,variant_id,name:p.name,variant:label,price,basePrice:price,qty:1,image:p.image||null,emoji:p.emoji||"<span class=\"material-symbols-outlined\" style=\"font-size:28px;color:var(--text-dim)\">shopping_bag</span>",barcode:v.barcode||null,sku:v.sku||null});
  renderCart();
  if(window.innerWidth<=720) posTab("carrito");
}

// ----- Selector de variante (color + talla) -----
let _vpProduct=null;
function openVariantPicker(p){
  _vpProduct=p;
  const usar = p.variants; // todas las variantes (agotado no bloquea)
  const colors=[...new Set(usar.map(v=>v.color).filter(Boolean))];
  const tallas=[...new Set(usar.map(v=>v.talla).filter(Boolean))];
  _vpProduct._usar = usar;
  $("#vpTitle").textContent=p.name;

  if(colors.length){
    $("#vpColorWrap").style.display="block";
    $("#vpColor").innerHTML=colors.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
  }else{ $("#vpColorWrap").style.display="none"; }

  if(tallas.length){
    $("#vpTallaWrap").style.display="block";
    $("#vpTalla").innerHTML=tallas.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join("");
  }else{ $("#vpTallaWrap").style.display="none"; }

  // si no hay ni color ni talla detectados, agrega la primera con stock directo
  if(!colors.length && !tallas.length){
    pushToCart(p, usar[0]); _vpProduct=null; return;
  }

  // al cambiar color, recalcula las tallas disponibles para ese color
  refreshTallasForColor();
  updateVariantStock();
  $("#variantModal").classList.add("show");
}
function refreshTallasForColor(){
  const p=_vpProduct; if(!p) return;
  if($("#vpColorWrap").style.display==="none" || $("#vpTallaWrap").style.display==="none") return;
  const color=$("#vpColor").value;
  const usar=p._usar||p.variants;
  const tallas=[...new Set(usar.filter(v=>v.color===color).map(v=>v.talla).filter(Boolean))];
  if(tallas.length) $("#vpTalla").innerHTML=tallas.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join("");
}
function onVpColorChange(){ refreshTallasForColor(); updateVariantStock(); }
function updateVariantStock(){
  const p=_vpProduct; if(!p) return;
  const color=$("#vpColorWrap").style.display!=="none" ? $("#vpColor").value : null;
  const talla=$("#vpTallaWrap").style.display!=="none" ? $("#vpTalla").value : null;
  const v=findVariant(p, color, talla);
  const info=$("#vpStock");
  if(v){
    info.textContent = v.stock>0 ? `✓ Disponible: ${v.stock} · ${money(v.price)}` : `⚠️ Sin stock · ${money(v.price)}`;
    info.style.color = v.stock>0 ? "#1d8a5e" : "#c0392b";
  }else{
    info.textContent="Esa combinación no existe";
    info.style.color="#c0392b";
  }
}
function findVariant(p, color, talla){
  return p.variants.find(v=>
    (color? v.color===color : true) && (talla? v.talla===talla : true)
  );
}
function closeVariantPicker(){ $("#variantModal").classList.remove("show"); _vpProduct=null; }
function confirmVariant(){
  const p=_vpProduct; if(!p) return;
  const color=$("#vpColorWrap").style.display!=="none" ? $("#vpColor").value : null;
  const talla=$("#vpTallaWrap").style.display!=="none" ? $("#vpTalla").value : null;
  const v=findVariant(p, color, talla);
  if(!v){ alert("Esa combinación no existe"); return; }
  pushToCart(p, v);
  closeVariantPicker();
}
function renderCart(){
  const box=$("#cartItems");
  if(!pos.cart.length){box.innerHTML='<div class="cart-empty">Toca productos para agregarlos</div>';}
  else{
    box.innerHTML="";
    for(const it of pos.cart){
      const row=el("div","ci");
      const edited = it.price !== it.basePrice ? ' title="precio editado"' : '';
      const thumb = it.image ? `<img src="${esc(it.image)}" class="ci-img">` : `<span class="ci-img ci-emoji">${it.emoji||"<span class=\"material-symbols-outlined\" style=\"font-size:28px;color:var(--text-dim)\">shopping_bag</span>"}</span>`;
      row.innerHTML=`${thumb}
        <div class="ci-n"><div class="nm">${esc(it.name)}</div>${it.variant?`<div class="vr">${esc(it.variant)}</div>`:""}
        <div class="ci-price-edit"${edited}>$<input type="text" inputmode="numeric" value="${it.price.toLocaleString('es-CO')}" onchange="cartPrice('${it.key}',this.value)" onclick="this.select()">${it.price!==it.basePrice?' ✏️':''}</div>
        <button class="ci-note-btn" onclick="openNoteModal('${it.key}')">${it.pers?.delivery_date?`✨ Personalizado · ${it.pers.delivery_date}`:(it.note?`📝 ${esc(it.note.slice(0,20))}${it.note.length>20?'…':''}`:'📝 Obs. / Personalización')}</button></div>
        <div class="qty"><button onclick="cartQty('${it.key}',-1)">−</button><span>${it.qty}</span><button onclick="cartQty('${it.key}',1)">+</button></div>
        <div class="ci-p">${money(it.price*it.qty)}</div><span class="ci-x" onclick="cartRemove('${it.key}')">✕</span>`;
      box.appendChild(row);
    }
  }
  const sub=cartSubtotal();
  const desc=discountAmount();
  const total=cartTotal();
  const count=pos.cart.reduce((s,i)=>s+i.qty,0);
  $("#cartSubtotal").textContent=money(sub);
  $("#cartTotal").textContent=money(total);
  $("#cartCount").textContent=`${count} item${count!==1?"s":""}`;
  const badge=$("#tabCartBadge"); if(badge) badge.textContent=count;
  // IVA incluido en el total (19% en Colombia). El precio YA incluye IVA,
  // así que mostramos cuánto de ese total corresponde al IVA.
  const iva = Math.round(total - (total/1.19));
  if($("#cartIva")) $("#cartIva").textContent = money(iva);
  // fila de descuento
  if(desc>0){
    $("#discRow").style.display="flex";
    $("#cartDiscount").textContent=`-${money(desc)}`;
    $("#discLabel").textContent = pos.discount.type==="pct"?`(${pos.discount.value}%)`:"";
  }else{
    $("#discRow").style.display="none";
  }
  // si cambió el total, el pago confirmado ya no es válido
  const paySum=pos.splitPayments.reduce((s,p)=>s+(p.amount||0),0);
  if(pos.splitPayments.length && paySum!==total){
    const btn=$("#btnPayment");
    btn.classList.remove("done");
    $("#payBtnLabel").innerHTML="<span class=\"material-symbols-outlined\" style=\"font-size:14px;vertical-align:-3px\">credit_card</span> Medios de pago * <span style='color:#c0392b'>(revisar)</span>";
  }
  refreshConfirmState();
}
function cartQty(key,d){const it=pos.cart.find(i=>i.key==key);if(!it)return;it.qty+=d;if(it.qty<=0)pos.cart=pos.cart.filter(i=>i.key!=key);renderCart();}
// Cambia entre Productos y Carrito en móvil
function posTab(which){
  document.body.classList.toggle("show-cart", which==="carrito");
  $("#tabProductos").classList.toggle("on", which==="productos");
  $("#tabCarrito").classList.toggle("on", which==="carrito");
}
function cartRemove(key){pos.cart=pos.cart.filter(i=>i.key!=key);renderCart();}
function cartPrice(key,val){
  const it=pos.cart.find(i=>i.key==key); if(!it)return;
  const n=parseInt(String(val).replace(/\D/g,""))||0;
  it.price=n; renderCart();
}
let _noteKey=null;
function openNoteModal(key){
  _noteKey=key;
  const it=pos.cart.find(i=>i.key==key);
  $("#noteText").value = it?.note || "";
  $("#noteProductName").textContent = it?.name || "Producto";
  // Personalización
  $("#persNotes").value = it?.pers?.notes || "";
  $("#persDate").value = it?.pers?.delivery_date || "";
  const cliente = pos.customer ? `${pos.customer.full_name} · ${pos.customer.phone||"sin tel"}` : "⚠️ Aún no has guardado los datos del cliente";
  const prod = it ? `${it.name} · ${money(it.price)}` : "";
  $("#persAutoInfo").innerHTML = `<b>Producto:</b> ${esc(prod)}<br><b>Cliente:</b> ${esc(cliente)}`;
  noteTab("obs");
  $("#noteModal").classList.add("show");
}
function noteTab(which){
  $("#notePaneObs").style.display = which==="obs"?"block":"none";
  $("#notePanePers").style.display = which==="pers"?"block":"none";
  $("#noteTab1").classList.toggle("on", which==="obs");
  $("#noteTab2").classList.toggle("on", which==="pers");
}
function closeNoteModal(){ $("#noteModal").classList.remove("show"); _noteKey=null; }
function saveNote(){
  const it=pos.cart.find(i=>i.key==_noteKey);
  if(it){
    it.note=$("#noteText").value.trim();
    const persNotes=$("#persNotes").value.trim();
    const persDate=$("#persDate").value;
    if(persDate){
      it.pers={ notes:persNotes, delivery_date:persDate };
    }else{
      // Si escribió detalle de personalización pero no puso fecha, avisa
      if(persNotes){
        alert("⚠️ Para registrar la personalización necesitas poner la FECHA DE ENTREGA. Sin fecha no se guarda como pedido personalizado.");
        return; // no cierra, deja corregir
      }
      it.pers=null;
    }
    renderCart();
  }
  closeNoteModal();
}
function setSaleType(t){ pos.saleType = t; }

function openSaleTypeModal(){ document.getElementById("saleTypeOverlay").classList.add("show"); }
function closeSaleTypeModal(){ document.getElementById("saleTypeOverlay").classList.remove("show"); }
function chooseSaleType(t){ setSaleType(t); closeSaleTypeModal(); confirmSale(); }
// Cambia "Apellidos" según tipo de documento (NIT = empresa, no lleva apellido)
function renderSellerSelect(){
  const sel=$("#sellerSelect"); sel.innerHTML="";
  for(const s of pos.sellers){const o=el("option");o.value=s.id;o.textContent=s.name;sel.appendChild(o);}
}

// ===== Medios de pago — compatibilidad con llamadas legacy =====
function renderPayGrid(){ /* reemplazado por renderPayRows */ }
async function confirmSale(){
  if(!pos.cashier){ alert("Selecciona el cajero (botón arriba)"); return; }
  if(!pos.customerSaved || !pos.customer){ alert("Falta guardar los datos del cliente"); return; }
  if(!pos.splitPayments.length){ alert("Falta el medio de pago"); return; }
  const total=cartTotal();
  const paySum=pos.splitPayments.reduce((s,p)=>s+(p.amount||0),0);
  if(paySum!==total){ alert("El pago no cuadra con el total"); return; }

  // clave del cajero (si la requiere)
  const okPin = await askPin();
  if(!okPin) return;

  const btn=$("#confirmSale"); btn.disabled=true; btn.textContent="Registrando…";
  const seller=pos.sellers.find(s=>s.id===$("#sellerSelect").value);
  const customer=pos.customer;
  const sub=cartSubtotal();
  const desc=discountAmount();

  // Pago mixto: "Efectivo $50.000 + Nequi $79.000"
  const paymentStr = pos.splitPayments.map(p=>`${p.method} ${money(p.amount)}`).join(" + ");
  const paymentMethods = pos.splitPayments.map(p=>p.method).join(", ");

  const orderPayload={
    items:pos.cart.map(i=>({variant_id:i.variant_id,qty:i.qty,price:i.price,name:i.name,variant:i.variant||null,barcode:i.barcode||null,sku:i.sku||null,note:i.note||""})),
    payment:paymentStr, sale_type:pos.saleType,
    payment_detail:pos.splitPayments.map(p=>({method:p.method,amount:p.amount})),
    seller:seller?.name||"—",
    cashier:pos.cashier?.name||"—",
    discount: desc>0 ? {type:pos.discount.type, value:pos.discount.value, amount:desc} : null,
    customer,
    billing: pos.billing||null,
    draft: pos.settings?.shopify_draft !== false,
  };
  const salePayload={
    seller_id:seller?.id||null, seller_name:seller?.name||"—",
    customer_phone:customer.phone||null, customer_name:customer.full_name||null,
    customer_doc:customer.doc||null, customer_doc_type:customer.doc_type||null,
    customer_email:customer.email||null, customer_address:customer.address||null,
    customer_depto:customer.depto||null, customer_city:customer.city||null,
    billing_empresa: pos.billing? true : false, billing_detail: pos.billing||null,
    cashier_id:pos.cashier?.id||null, cashier_name:pos.cashier?.name||null,
    sale_type:pos.saleType, payment_method:paymentMethods,
    payment_method_id: pos.splitPayments.length===1 ? (pos.splitPayments[0].id||null) : null,
    payment_detail:pos.splitPayments.map(p=>({method:p.method,id:p.id||null,amount:p.amount})),
    discount_type:pos.discount.type||null, discount_value:pos.discount.value||0, discount_amount:desc,
    items:orderPayload.items, subtotal:sub, total:cartTotal(),
    status:"completada", store:C.STORE,
  };

  // Sin internet → encolar y confirmar localmente
  if(!navigator.onLine){
    saveOfflineSale(orderPayload, salePayload);
    btn.textContent="✓ Guardada (sin conexión)";
    setTimeout(()=>{ clearPosCart(); btn.textContent="Registrar venta"; btn.disabled=false; },1800);
    return;
  }

  let shopify={ok:false};
  try{
    const r=await fetch(`${C.WORKER_URL}/order`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(orderPayload)});
    shopify=await r.json();
    console.log("[bloom] order response:", JSON.stringify(shopify));
  }catch(e){console.error(e);}
  const saleResp = await sbPost("sales",{
    shopify_order_id:shopify.order_id||null, shopify_order_name:shopify.order_name||null,
    ...salePayload,
  });
  if(!saleResp.ok){
    const errTxt = await saleResp.text().catch(()=> "");
    console.error("Error guardando venta:", saleResp.status, errTxt);
    alert("⚠️ La venta se creó en Shopify pero NO se guardó en el sistema.\n\nError: "+errTxt.slice(0,200)+"\n\nAvísale a soporte.");
  }
  // Guarda los pedidos personalizados (ítems con fecha de entrega)
  try{
    for(const it of pos.cart){
      if(it.pers && it.pers.delivery_date){
        const persResp = await sbPost("custom_orders",{
          sale_id: shopify.order_id? String(shopify.order_id) : null,
          product_name: it.name, variant: null, price: it.price,
          notes: it.pers.notes||null, delivery_date: it.pers.delivery_date,
          customer_name: customer.full_name, customer_phone: customer.phone,
          store:C.STORE,
        });
        if(!persResp.ok){
          const e=await persResp.text().catch(()=> "");
          console.error("Error guardando personalización:", persResp.status, e);
        }
      }
    }
  }catch(e){ console.warn("No se pudieron guardar personalizaciones:",e); }

  // Guarda/actualiza el cliente en la base para búsquedas futuras
  try{
    if(customer.doc){
      const existing=await sbGet(`customers?store=eq.${C.STORE}&doc=eq.${encodeURIComponent(customer.doc)}&limit=1`);
      if(existing && existing.length){
        await sbPatch(`customers?id=eq.${existing[0].id}`,{
          name:customer.name, last_name:customer.last_name, full_name:customer.full_name,
          email:customer.email, phone:customer.phone, address:customer.address,
          depto:customer.depto, city:customer.city,
        });
      }else{
        await sbPost("customers",{
          doc:customer.doc, doc_type:customer.doc_type, name:customer.name, last_name:customer.last_name,
          full_name:customer.full_name, email:customer.email, phone:customer.phone,
          address:customer.address, depto:customer.depto, city:customer.city, store:C.STORE,
        });
      }
    }
  }catch(e){ console.warn("No se pudo guardar cliente en base:",e); }

  btn.textContent = shopify.ok ? `✓ Venta ${shopify.order_name||""}` : "✓ Registrada (revisar Shopify)";
  setTimeout(()=>{ clearPosCart(); btn.textContent="Registrar venta"; },1800);
}

// ---- Helper: leer imagen y reducirla a base64 pequeño ----
function pickImage(maxSize){
  return new Promise((resolve)=>{
    const input=document.createElement("input");
    input.type="file"; input.accept="image/*";
    input.onchange=()=>{
      const file=input.files[0]; if(!file){resolve(null);return;}
      const reader=new FileReader();
      reader.onload=e=>{
        const img=new Image();
        img.onload=()=>{
          // redimensiona a maxSize manteniendo proporción (íconos/fotos pequeños)
          const m=maxSize||120;
          let w=img.width,h=img.height;
          if(w>h){ if(w>m){h=h*m/w;w=m;} } else { if(h>m){w=w*m/h;h=m;} }
          const cv=document.createElement("canvas"); cv.width=w; cv.height=h;
          cv.getContext("2d").drawImage(img,0,0,w,h);
          resolve(cv.toDataURL("image/png",0.85));
        };
        img.src=e.target.result;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

// ---- Config: vendedores ----
async function initConfig(){
  await loadUsers(); await loadPayments(); await loadSettings();
  await renderUsersList(); renderPaymentsList(); renderSettings();
  const goal=parseInt(localStorage.getItem("bloom_sales_goal"))||0;
  if($("#setSalesGoal")) $("#setSalesGoal").value=goal||"";
  if(!pos.catalog.length) pos.catalog = await fetchProducts();
  initConfigSections();
}

function initConfigSections(){
  document.querySelectorAll("#screen-config .cfg-sec").forEach(sec=>{
    if(sec.dataset.cfgInit) return; // ya inicializado
    sec.dataset.cfgInit="1";
    const h3=sec.querySelector("h3"); if(!h3) return;
    // Chevron
    const chev=document.createElement("span");
    chev.className="material-symbols-outlined";
    chev.style.cssText="font-size:20px;color:var(--text-dim);transition:transform .2s;flex-shrink:0";
    chev.textContent="expand_more";
    h3.style.cssText=(h3.style.cssText||"")+"cursor:pointer;display:flex;justify-content:space-between;align-items:center;width:100%";
    h3.appendChild(chev);
    // Wrap content below h3 in collapsible div
    const body=document.createElement("div");
    body.className="cfg-body";
    body.style.display="none";
    const children=[...sec.children].filter(c=>c!==h3);
    children.forEach(c=>body.appendChild(c));
    sec.appendChild(body);
    h3.onclick=()=>{
      const open=body.style.display==="none";
      body.style.display=open?"block":"none";
      chev.style.transform=open?"rotate(180deg)":"";
    };
  });
}

// ===== Configuración del POS (settings) =====
async function loadSettings(){
  const rows=await sbGet(`pos_settings?store=eq.${C.STORE}&limit=1`);
  pos.settings = (rows && rows[0]) ? rows[0] : { store:C.STORE, shopify_draft:true, receipt_enabled:false,
    receipt_business:"Bloom", receipt_nit:"", receipt_address:"", receipt_phone:"", receipt_footer:"¡Gracias por tu compra!", iva_rate:19 };
  const row=rows&&rows[0];
  // Chat config
  pos.chatConfig = row?.chat_config || { recompra_enabled:true, recompra_tag:"recompra" };
  // Supabase → localStorage: fuente de verdad para datos que no deben perderse con el caché
  if(row?.goal_plans && Object.keys(row.goal_plans).length){
    if(row.goal_plans.plans) localStorage.setItem("bloom_goal_plans",JSON.stringify(row.goal_plans.plans));
    if(row.goal_plans.monthly) localStorage.setItem("bloom_goal_monthly",JSON.stringify(row.goal_plans.monthly));
  }
  if(row?.label_presets && row.label_presets.length){
    localStorage.setItem(_LBL_PRESETS_KEY,JSON.stringify(row.label_presets));
  }
}
function renderSettings(){
  const s=pos.settings; if(!s) return;
  const set=(id,val)=>{const e=$("#"+id); if(e){ if(e.type==="checkbox") e.checked=!!val; else e.value=val||""; }};
  set("setShopifyDraft", s.shopify_draft);
  set("setReceiptEnabled", s.receipt_enabled);
  set("setRcBusiness", s.receipt_business);
  set("setRcNit", s.receipt_nit);
  set("setRcPhone", s.receipt_phone);
  set("setRcAddress", s.receipt_address);
  set("setRcFooter", s.receipt_footer);
  if($("#receiptFields")) $("#receiptFields").style.display = s.receipt_enabled ? "block":"none";
  renderChatConfig();
}
function renderChatConfig(){
  const cfg=pos.chatConfig||{};
  const cb=$("#cfgAutoTagRecompra"); if(cb) cb.checked=cfg.recompra_enabled!==false;
  const ti=$("#cfgRecompraTag"); if(ti) ti.value=cfg.recompra_tag||"recompra";
  renderFollowupRules();
  const ff=$("#cfgFollowupForm"); if(ff) ff.style.display="none";
}
async function saveChatConfig(){
  const enabled=$("#cfgAutoTagRecompra")?.checked!==false;
  const tag=($("#cfgRecompraTag")?.value||"recompra").trim()||"recompra";
  pos.chatConfig={...pos.chatConfig, recompra_enabled:enabled, recompra_tag:tag};
  if(!enabled) pos.chatConfig.recompra_tag=false;
  await sbPatch(`pos_settings?store=eq.${C.STORE}`,{chat_config:pos.chatConfig});
}

// ---- Seguimiento automático ----
let _fuEditing=null; // índice de la regla en edición, null=nueva
function renderFollowupRules(){
  const box=$("#cfgFollowupList"); if(!box) return;
  const rules=(pos.chatConfig?.followups)||[];
  box.innerHTML="";
  if(!rules.length){box.innerHTML='<div style="font-size:13px;color:var(--text-dim)">Sin reglas configuradas.</div>';return;}
  rules.forEach((r,i)=>{
    const pipe=state.pipelines.find(p=>String(p.id)===String(r.pipeline_id));
    const stCol=pipe?stageColor(pipe,r.stage):"#6366f1";
    const delay=r.delay_hours>=24?`${r.delay_hours/24} día${r.delay_hours>=48?"s":""}`:`${r.delay_hours} h`;
    const triggerLabel={delivered:"entregado sin leer",read:"leído sin respuesta",sent:"no entregado",any:""}[r.status_trigger||"any"];
    const row=document.createElement("div");
    row.style="display:flex;align-items:flex-start;gap:8px;padding:10px 12px;background:var(--surface);border:1px solid var(--border);border-radius:10px;margin-bottom:8px";
    row.innerHTML=`
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <span style="background:${stCol}22;color:${stCol};border:1px solid ${stCol}66;border-radius:5px;padding:1px 6px;font-size:11px;font-weight:600">${esc(pipe?.name||"?")} · ${esc(r.stage)}</span>
          <span style="font-size:11px;color:var(--text-dim)">sin respuesta ${delay}${triggerLabel?` · ${triggerLabel}`:""}</span>
          ${!r.enabled?`<span style="font-size:10px;color:#b91c1c;background:#fee2e2;border-radius:4px;padding:1px 5px">pausado</span>`:""}
        </div>
        <div style="font-size:12px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:240px">${esc(r.message)}</div>
      </div>
      <button onclick="editFollowupRule(${i})" style="background:none;border:1px solid var(--border);border-radius:7px;padding:5px 8px;cursor:pointer;color:var(--text-dim)"><span class="material-symbols-outlined" style="font-size:15px;vertical-align:-3px">edit</span></button>
      <button onclick="deleteFollowupRule(${i})" style="background:none;border:1px solid #fca5a5;border-radius:7px;padding:5px 8px;cursor:pointer;color:#b91c1c"><span class="material-symbols-outlined" style="font-size:15px;vertical-align:-3px">delete</span></button>`;
    box.appendChild(row);
  });
}
function _fuPipeOptions(selId){
  return state.pipelines.map(p=>`<option value="${p.id}"${String(p.id)===String(selId)?` selected`:""}>${esc(p.name)}</option>`).join("");
}
function _fuStageOptions(pipeId,selStage){
  const pipe=state.pipelines.find(p=>String(p.id)===String(pipeId));
  return (pipe?.stages||[]).map(s=>`<option value="${s}"${s===selStage?` selected`:""}>${esc(s)}</option>`).join("");
}
function openFollowupForm(idx){
  _fuEditing=idx;
  const rules=(pos.chatConfig?.followups)||[];
  const r=idx!=null?rules[idx]:{enabled:true,pipeline_id:state.pipelines[0]?.id,stage:state.pipelines[0]?.stages[0],delay_hours:24,message:""};
  const form=$("#cfgFollowupForm"); if(!form) return;
  form.style.display="";
  const firstPipeId=r.pipeline_id||state.pipelines[0]?.id;
  form.innerHTML=`
    <div style="font-size:11px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px">${idx!=null?"Editar regla":"Nueva regla"}</div>
    <label class="emp-toggle"><input type="checkbox" id="fuEnabled"${r.enabled?" checked":""}><span>Regla activa</span></label>
    <div style="display:flex;gap:8px">
      <div style="flex:1">
        <label style="font-size:12px;color:var(--text-dim)">Embudo</label>
        <select id="fuPipe" onchange="fuUpdateStages()" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:14px;background:var(--bg);color:var(--text);outline:none;margin-top:4px">
          ${_fuPipeOptions(firstPipeId)}
        </select>
      </div>
      <div style="flex:1">
        <label style="font-size:12px;color:var(--text-dim)">Etapa</label>
        <select id="fuStage" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:14px;background:var(--bg);color:var(--text);outline:none;margin-top:4px">
          ${_fuStageOptions(firstPipeId,r.stage)}
        </select>
      </div>
    </div>
    <div>
      <label style="font-size:12px;color:var(--text-dim)">Enviar si no responde después de</label>
      <div style="display:flex;gap:8px;margin-top:4px">
        <input id="fuDelayN" type="number" min="1" max="168" value="${r.delay_hours>=24?r.delay_hours/24:r.delay_hours}" style="width:80px;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:14px;background:var(--bg);color:var(--text);outline:none">
        <select id="fuDelayU" style="flex:1;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:14px;background:var(--bg);color:var(--text);outline:none">
          <option value="h"${r.delay_hours<24?" selected":""}>horas</option>
          <option value="d"${r.delay_hours>=24?" selected":""}>días</option>
        </select>
      </div>
    </div>
    <div>
      <label style="font-size:12px;color:var(--text-dim)">Condición de estado del mensaje</label>
      <select id="fuTrigger" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:14px;background:var(--bg);color:var(--text);outline:none;margin-top:4px">
        <option value="any"${(r.status_trigger||'any')==='any'?' selected':''}>Siempre (sin importar el estado)</option>
        <option value="delivered"${r.status_trigger==='delivered'?' selected':''}>✓✓ Entregado pero no leído</option>
        <option value="read"${r.status_trigger==='read'?' selected':''}>✓✓ Leído pero sin respuesta</option>
        <option value="sent"${r.status_trigger==='sent'?' selected':''}>✓ Enviado pero no entregado</option>
      </select>
    </div>
    <div>
      <label style="font-size:12px;color:var(--text-dim)">Mensaje (usa {nombre})</label>
      <textarea id="fuMsg" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:10px;font-size:14px;background:var(--bg);color:var(--text);outline:none;resize:vertical;min-height:80px;font-family:inherit;margin-top:4px;box-sizing:border-box">${esc(r.message)}</textarea>
    </div>
    <div style="display:flex;gap:8px">
      <button onclick="saveFollowupRule()" style="flex:1;background:var(--accent);color:#fff;border:none;border-radius:8px;padding:10px;font-size:14px;font-weight:600;cursor:pointer">Guardar</button>
      <button onclick="cancelFollowupForm()" style="background:none;border:1px solid var(--border);border-radius:8px;padding:10px 16px;font-size:14px;cursor:pointer;color:var(--text-dim)">Cancelar</button>
    </div>`;
}
function fuUpdateStages(){
  const pipeId=$("#fuPipe")?.value;
  const sel=$("#fuStage"); if(!sel) return;
  sel.innerHTML=_fuStageOptions(pipeId,"");
}
function cancelFollowupForm(){const f=$("#cfgFollowupForm");if(f)f.style.display="none";_fuEditing=null;}
async function saveFollowupRule(){
  const pipeId=$("#fuPipe")?.value;
  const stage=$("#fuStage")?.value;
  const n=parseInt($("#fuDelayN")?.value)||1;
  const unit=$("#fuDelayU")?.value;
  const delay_hours=unit==="d"?n*24:n;
  const message=($("#fuMsg")?.value||"").trim();
  if(!pipeId||!stage||!message){alert("Completa todos los campos");return;}
  const status_trigger=$("#fuTrigger")?.value||"any";
  const rule={enabled:$("#fuEnabled")?.checked!==false,pipeline_id:pipeId,stage,delay_hours,message,status_trigger};
  const rules=[...(pos.chatConfig?.followups||[])];
  if(_fuEditing!=null) rules[_fuEditing]=rule; else rules.push(rule);
  pos.chatConfig={...pos.chatConfig, followups:rules};
  await sbPatch(`pos_settings?store=eq.${C.STORE}`,{chat_config:pos.chatConfig});
  cancelFollowupForm(); renderFollowupRules();
}
async function deleteFollowupRule(i){
  if(!confirm("¿Eliminar esta regla?")) return;
  const rules=[...(pos.chatConfig?.followups||[])];
  rules.splice(i,1);
  pos.chatConfig={...pos.chatConfig, followups:rules};
  await sbPatch(`pos_settings?store=eq.${C.STORE}`,{chat_config:pos.chatConfig});
  renderFollowupRules();
}
function editFollowupRule(i){openFollowupForm(i);}
async function saveSettings(){
  const g=(id)=>{const e=$("#"+id); return e ? (e.type==="checkbox"? e.checked : e.value.trim()) : null;};
  const patch={
    shopify_draft:g("setShopifyDraft"), receipt_enabled:g("setReceiptEnabled"),
    receipt_business:g("setRcBusiness"), receipt_nit:g("setRcNit"),
    receipt_phone:g("setRcPhone"), receipt_address:g("setRcAddress"), receipt_footer:g("setRcFooter"),
  };
  pos.settings={...pos.settings, ...patch};
  if($("#receiptFields")) $("#receiptFields").style.display = patch.receipt_enabled ? "block":"none";
  await sbPatch(`pos_settings?store=eq.${C.STORE}`, patch);
}

// Fecha local (no UTC) para evitar desfase de timezone
function _localDate(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }

// ---- Meta de ventas del día ----
async function loadGoalBar(){
  const bar=$("#goalBar"); if(bar) bar.style.display="block";
  const today=_localDate();
  const monthKey=today.slice(0,7);
  const mode=document.getElementById("goalViewMode")?.value||"dia";
  let plans={};
  try{ plans=JSON.parse(localStorage.getItem("bloom_goal_plans")||"{}"); }catch{}

  if(mode==="mes"){
    const monthPlan=plans[monthKey]||{};
    const goal=Object.values(monthPlan).reduce((s,v)=>s+v,0);
    if(!goal){ renderGoalBar(0,0,"mes"); return; }
    const firstDay=`${monthKey}-01`;
    const rows=await sbGet(`sales?store=eq.${C.STORE}&created_at=gte.${firstDay}T00:00:00&select=total&status=eq.completada`);
    const total=(rows||[]).reduce((s,r)=>s+(r.total||0),0);
    renderGoalBar(goal,total,"mes");
  } else {
    const goal=plans[monthKey]?.[today]||0;
    if(!goal){ renderGoalBar(0,0,"dia"); return; }
    const rows=await sbGet(`sales?store=eq.${C.STORE}&created_at=gte.${today}T00:00:00&select=total&status=eq.completada`);
    const total=(rows||[]).reduce((s,r)=>s+(r.total||0),0);
    renderGoalBar(goal,total,"dia");
  }
}
function renderGoalBar(goal,total,mode){
  const bar=$("#goalBar"); if(!bar) return;
  bar.style.display="block";
  if(total===undefined) total=0; if(goal===undefined) goal=0;
  const realPct=goal>0?Math.round(total/goal*100):0;
  const pct=Math.min(100,realPct);
  const prog=$("#goalProgress"); if(prog){ prog.style.width=pct+"%"; prog.style.background=pct>=100?"#27ae60":"var(--accent)"; }
  const txt=$("#goalText");
  if(txt) txt.textContent=goal>0?`${money(total)} / ${money(goal)} (${pct}%)`:"Sin meta";
  if(mode==="dia"&&goal>0&&realPct>=100){
    _celebrateGoal(realPct,_localDate());
  }
}

const _BLOOM_MSGS=[
  // Primera semana (días 1–7)
  "✨ ¡Así se empieza un gran mes! Cada meta diaria cumplida es una prueba de que cuando trabajamos juntas, todo florece. ¡Vamos por más! 💖",
  "🌷 Los grandes resultados nacen de pequeños logros repetidos. Hoy dimos un paso más hacia nuestras metas. ¡Felicitaciones equipo Bloom!",
  "💪 El éxito no llega al final del mes, se construye todos los días. Gracias por ponerle compromiso, energía y corazón a esta jornada.",
  "🌸 Hoy sembramos una victoria. Sigamos cuidando cada detalle porque las grandes historias empiezan exactamente así.",
  "💕 Qué orgullo ver cómo comenzamos el mes. La actitud de hoy es la que marcará los resultados de mañana.",
  // Mitad del mes (días 8–22)
  "🚀 Ya recorrimos la mitad del camino y seguimos demostrando de qué está hecho este equipo. ¡No bajemos el ritmo!",
  "🌼 Cada meta cumplida confirma que el esfuerzo constante siempre tiene recompensa. ¡Excelente trabajo Bloom!",
  "💖 No importa qué tan desafiante sea el mes, cuando trabajamos unidas siempre encontramos la manera de lograrlo.",
  "✨ Hoy no solo cumplimos una meta; fortalecimos la confianza en nosotras mismas. Sigamos creciendo.",
  "🌷 El talento abre puertas, pero la disciplina las mantiene abiertas. Gracias por dar lo mejor en cada jornada.",
  // Última semana (días 23–fin)
  "🔥 Estamos en la recta final y cada meta cumplida nos acerca a un cierre extraordinario. ¡No aflojemos ahora!",
  "🌸 Todo el esfuerzo de este mes empieza a reflejarse en los resultados. Gracias por hacer que Bloom siga creciendo cada día.",
  "💕 Los últimos días también cuentan. Muchas veces el cierre del mes define una gran historia. ¡Vamos por un final increíble!",
  "✨ Cada venta, cada cliente feliz y cada objetivo alcanzado son el reflejo del compromiso de este gran equipo. ¡Felicitaciones!",
  "🌷 Terminamos el día demostrando que cuando trabajamos con pasión, las metas dejan de ser un sueño y se convierten en resultados. ¡Gracias por hacer florecer a Bloom! 💖",
];

function _celebrateGoal(realPct,today){
  try{
    if(localStorage.getItem("bloom_celebrated_day")===today) return;
    localStorage.setItem("bloom_celebrated_day",today);
  }catch{}
  const dt=new Date(today+"T12:00:00");
  const day=dt.getDate();
  const lastDay=new Date(dt.getFullYear(),dt.getMonth()+1,0).getDate();
  if(day===lastDay){
    _showGoalPopup(null,"Cerramos el mes demostrando que la constancia siempre florece. Gracias por hacer de Bloom un lugar donde los sueños se convierten en resultados. 💖","🌸 ¡Cerramos el mes con todo!");
    return;
  }
  let pool;
  if(day<=7) pool=_BLOOM_MSGS.slice(0,5);
  else if(day<=22) pool=_BLOOM_MSGS.slice(5,10);
  else pool=_BLOOM_MSGS.slice(10,15);
  const base=pool[day%pool.length];
  let badge=null;
  if(realPct>110) badge="✨ ¡Día legendario! Hoy Bloom brilló más fuerte que nunca.";
  else if(realPct>=100) badge="🌸 ¡Hoy superamos las expectativas!";
  _showGoalPopup(badge,base);
}

function _showGoalPopup(badge,msg,title="🌸 ¡Meta del día cumplida!"){
  const modal=document.getElementById("goalCelebrationModal");
  if(!modal) return;
  document.getElementById("gcTitle").textContent=title;
  const bdg=document.getElementById("gcBadge");
  if(badge){ bdg.textContent=badge; bdg.style.display="inline-block"; }
  else bdg.style.display="none";
  document.getElementById("gcMsg").textContent=msg;
  modal.style.display="flex";
}

function closeGoalCelebration(){
  const m=document.getElementById("goalCelebrationModal");
  if(m) m.style.display="none";
}
let _previewIdx=0;
function _previewGoalCelebration(){
  const previews=[
    // base semana 1–5
    ..._BLOOM_MSGS.map((msg,i)=>({badge:null,msg,title:"🌸 ¡Meta del día cumplida!"})),
    // badge 100–110%
    {badge:"🌸 ¡Hoy superamos las expectativas!",msg:_BLOOM_MSGS[0],title:"🌸 ¡Meta del día cumplida!"},
    // badge >110%
    {badge:"✨ ¡Día legendario! Hoy Bloom brilló más fuerte que nunca.",msg:_BLOOM_MSGS[5],title:"🌸 ¡Meta del día cumplida!"},
    // cierre de mes
    {badge:null,msg:"Cerramos el mes demostrando que la constancia siempre florece. Gracias por hacer de Bloom un lugar donde los sueños se convierten en resultados. 💖",title:"🌸 ¡Cerramos el mes con todo!"},
  ];
  const p=previews[_previewIdx%previews.length];
  _previewIdx++;
  _showGoalPopup(p.badge,p.msg,p.title);
}

// ====================================================================
//  META INTELIGENTE — planificador mensual con datos históricos
// ====================================================================

// Festivos Colombia (Ley Emiliani): los marcados con * se mueven al lunes siguiente
function _colHolidays(year){
  // Calcula Pascua (algoritmo de Gauss)
  function easter(y){
    const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4;
    const f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30;
    const i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7;
    const m=Math.floor((a+11*h+22*l)/451);
    const month=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;
    return new Date(y,month-1,day);
  }
  function nextMon(d){ const r=new Date(d); const dw=r.getDay(); if(dw!==1) r.setDate(r.getDate()+((8-dw)%7)); return r; }
  function fmt(d){ return d.toISOString().slice(0,10); }

  const p=easter(year);
  const fixed=[
    {d:fmt(new Date(year,0,1)),  n:"Año Nuevo"},
    {d:fmt(new Date(year,4,1)),  n:"Día del Trabajo"},
    {d:fmt(new Date(year,6,20)), n:"Independencia"},
    {d:fmt(new Date(year,7,7)),  n:"Batalla de Boyacá"},
    {d:fmt(new Date(year,11,8)), n:"Inmaculada Concepción"},
    {d:fmt(new Date(year,11,25)),n:"Navidad"},
  ];
  function addDays(base,n){ const r=new Date(base); r.setDate(r.getDate()+n); return r; }
  const emiliani=[ // se mueven al lunes siguiente
    {d:nextMon(new Date(year,0,6)),  n:"Reyes Magos"},
    {d:nextMon(new Date(year,2,19)), n:"San José"},
    {d:nextMon(addDays(p,39)),       n:"Ascensión"},
    {d:nextMon(addDays(p,60)),       n:"Corpus Christi"},
    {d:nextMon(addDays(p,68)),       n:"Sagrado Corazón"},
    {d:nextMon(new Date(year,5,29)), n:"San Pedro y San Pablo"},
    {d:nextMon(new Date(year,7,15)), n:"Asunción"},
    {d:nextMon(new Date(year,9,12)), n:"Día de la Raza"},
    {d:nextMon(new Date(year,10,2)),n:"Todos los Santos"},
    {d:nextMon(new Date(year,10,11)),n:"Independencia Cartagena"},
  ];
  const jueves=fmt(addDays(p,-3)), viernes=fmt(addDays(p,-2));
  const semana=[{d:jueves,n:"Jueves Santo"},{d:viernes,n:"Viernes Santo"}];
  return [...fixed,...emiliani.map(x=>({...x,d:fmt(x.d)})),...semana]
    .sort((a,b)=>a.d.localeCompare(b.d));
}

let _bloomSalesHistory = null;
async function _loadSalesHistory(){
  if(_bloomSalesHistory) return _bloomSalesHistory;
  // 1. Datos del POS (Supabase) — fuente primaria y siempre actualizada
  try{
    const rows = await sbGet(`sales?store=eq.${C.STORE}&status=eq.completada&select=created_at,total&order=created_at.asc&limit=5000`);
    if(rows && rows.length){
      const h={};
      for(const r of rows){
        const date=(r.created_at||"").slice(0,10); if(!date) continue;
        const [yr,mo,d]=date.split("-");
        const key=`${yr}-${mo}`;
        if(!h[key]) h[key]={};
        h[key][parseInt(d)]=(h[key][parseInt(d)]||0)+(r.total||0);
      }
      // Combinar con histórico Excel (localStorage) para tener datos anteriores al POS
      let excelH={};
      try{ const s=localStorage.getItem("bloom_sales_history"); if(s) excelH=JSON.parse(s); }catch{}
      for(const [k,v] of Object.entries(excelH)){
        if(!h[k]) h[k]={};
        for(const [d,val] of Object.entries(v)) if(!h[k][d]) h[k][d]=val; // Excel solo llena los huecos
      }
      // Complementar con JSON del repo para meses anteriores al POS
      try{
        const rep=await fetch("./sales-history.json",{cache:"force-cache"});
        if(rep.ok){ const jh=await rep.json(); for(const [k,v] of Object.entries(jh)) if(!h[k]) h[k]=v; }
      }catch{}
      _bloomSalesHistory=h; return h;
    }
  }catch{}
  // 2. localStorage (Excel subido)
  try{ const s=localStorage.getItem("bloom_sales_history"); if(s){ _bloomSalesHistory=JSON.parse(s); return _bloomSalesHistory; } }catch{}
  // 3. JSON del repo
  try{ const r=await fetch("./sales-history.json",{cache:"force-cache"}); if(r.ok){ _bloomSalesHistory=await r.json(); return _bloomSalesHistory; } }catch{}
  return {};
}

// Calcula pesos por día de semana (0=Dom..6=Sáb) a partir del histórico
function _dayWeights(history){
  const sum=[0,0,0,0,0,0,0], cnt=[0,0,0,0,0,0,0];
  for(const [key,days] of Object.entries(history)){
    const [yr,mo]=key.split("-").map(Number);
    for(const [d,val] of Object.entries(days)){
      const dt=new Date(yr,mo-1,parseInt(d));
      const dw=dt.getDay();
      sum[dw]+=val; cnt[dw]++;
    }
  }
  const avg=sum.map((s,i)=>cnt[i]>0?s/cnt[i]:0);
  const total=avg.reduce((a,b)=>a+b,0)||1;
  return avg.map(v=>v/total*7); // normalizado: promedio=1
}

function openGoalPlanner(){
  const now=new Date();
  const modal=document.getElementById("goalPlannerModal");
  if(!modal) return;
  document.getElementById("gpMonth").value=now.getMonth()+1;
  document.getElementById("gpYear").value=now.getFullYear();
  document.getElementById("gpGoal").value="";
  document.getElementById("gpResult").innerHTML="";
  modal.style.display="flex";
  _checkExistingPlan();
}
function _checkExistingPlan(){
  const month=parseInt(document.getElementById("gpMonth").value);
  const year=parseInt(document.getElementById("gpYear").value);
  const monthKey=`${year}-${String(month).padStart(2,"0")}`;
  document.getElementById("gpGoal").value="";
  document.getElementById("gpResult").innerHTML="";
  try{
    const metas=JSON.parse(localStorage.getItem("bloom_goal_monthly")||"{}");
    const plans=JSON.parse(localStorage.getItem("bloom_goal_plans")||"{}");
    const savedPlan=plans[monthKey];
    const badge=document.getElementById("gpSavedBadge");
    let savedGoal=metas[monthKey]||0;
    if(!savedGoal&&savedPlan) savedGoal=Object.values(savedPlan).reduce((s,v)=>s+v,0);
    if(savedGoal&&savedPlan){
      if(badge){
        badge.style.display="flex";
        document.getElementById("gpSavedBadgeText").textContent=`Plan guardado — ${money(savedGoal)}`;
        badge._savedGoal=savedGoal; // para usarlo en cargarPlanGuardado
      }
    } else {
      if(badge) badge.style.display="none";
    }
  }catch{}
}
function cargarPlanGuardado(){
  const badge=document.getElementById("gpSavedBadge");
  const savedGoal=badge?._savedGoal||0;
  if(!savedGoal) return;
  document.getElementById("gpGoal").value=savedGoal;
  computeGoalPlan();
}
function closeGoalPlanner(){ document.getElementById("goalPlannerModal").style.display="none"; }

async function computeGoalPlan(){
  const goal=parseInt((document.getElementById("gpGoal").value||"").replace(/\D/g,""))||0;
  const month=parseInt(document.getElementById("gpMonth").value);
  const year=parseInt(document.getElementById("gpYear").value);
  if(!goal||!month||!year){ alert("Ingresa meta, mes y año"); return; }
  const now=new Date(); const planStart=new Date(year,month-1,1);
  if(planStart<new Date(now.getFullYear(),now.getMonth(),1)){ alert("No se puede planificar un mes que ya pasó."); return; }

  const history=await _loadSalesHistory();
  const weights=_dayWeights(history);
  const holidays=_colHolidays(year);
  const holidayDates=new Set(holidays.map(h=>h.d));

  // Construir días del mes — domingos abiertos, festivos cerrados por defecto
  const daysInMonth=new Date(year,month,0).getDate();
  const allDays=[];
  for(let d=1;d<=daysInMonth;d++){
    const dt=new Date(year,month-1,d);
    const dw=dt.getDay();
    const iso=dt.toISOString().slice(0,10);
    const hol=holidays.find(h=>h.d===iso);
    allDays.push({d,iso,dw,holiday:hol||null,open:!hol}); // solo festivos cerrados por defecto
  }

  renderGoalPlanResult(allDays, weights, goal, holidays);
}

function renderGoalPlanResult(allDays, weights, goal, allHolidays){
  const box=document.getElementById("gpResult");
  const month=parseInt(document.getElementById("gpMonth").value);
  const year=parseInt(document.getElementById("gpYear").value);

  // Festivos del mes
  const monthHols=allHolidays.filter(h=>h.d.startsWith(`${year}-${String(month).padStart(2,"0")}`));

  // Días abiertos con peso
  const openDays=allDays.filter(d=>d.open);
  const totalWeight=openDays.reduce((s,d)=>s+weights[d.dw],0)||1;
  const basePerUnit=goal/totalWeight;

  const DAYS_ES=["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
  const MONTHS_ES2=["","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

  const calRows=allDays.map(d=>{
    const meta=d.open ? Math.round(basePerUnit*weights[d.dw]/1000)*1000 : 0;
    const isHol=!!d.holiday;
    const isSun=d.dw===0;
    const closed=!d.open;
    return `<tr class="gp-row${closed?" gp-closed":""}" data-day="${d.iso}" data-open="${d.open?1:0}">
      <td style="padding:5px 8px;font-weight:600;color:var(--text-dim);font-size:12px">${d.d}</td>
      <td style="padding:5px 8px;font-size:12px">${DAYS_ES[d.dw]}</td>
      <td style="padding:5px 8px;font-size:12px;color:${isHol?"#c0392b":"var(--text)"}">${isHol?`🗓 ${d.holiday.n}`:isSun?"☀️ Domingo":""}</td>
      <td style="padding:5px 8px;text-align:right;font-weight:700;color:${closed?"var(--text-dim)":"var(--accent)"};font-size:13px">${closed?"—":money(meta)}</td>
      <td style="padding:5px 4px;text-align:center">
        <label style="cursor:pointer;font-size:11px;color:var(--text-dim)">
          <input type="checkbox" ${d.open?"checked":""} onchange="toggleGpDay('${d.d}',this.checked,${JSON.stringify(goal).replace(/"/g,'&quot;')})" style="margin:0">
          ${closed?"incluir":"abierto"}
        </label>
      </td>
    </tr>`;
  }).join("");

  const holSection=monthHols.length
    ? `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:12px;margin-bottom:14px">
        <div style="font-size:11px;font-weight:600;color:#991b1b;text-transform:uppercase;margin-bottom:8px">Festivos — ¿cuáles abres?</div>
        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px">
        ${monthHols.map(h=>`
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:13px">
            <input type="checkbox" id="gpHol_${h.d}" style="width:16px;height:16px;accent-color:var(--accent)">
            <span style="color:#991b1b;font-weight:600">${h.d.slice(8)}</span>
            <span style="color:var(--text)">${h.n}</span>
          </label>`).join("")}
        </div>
        <button onclick="redistribuirConFestivos(${goal})" style="width:100%;background:#991b1b;color:#fff;border:none;border-radius:8px;padding:8px;font-size:13px;font-weight:600;cursor:pointer">
          Redistribuir días
        </button>
       </div>`
    : "";

  box.innerHTML=`
    ${holSection}
    <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px">
      Días abiertos: <b id="gpOpenCount">${openDays.length}</b> · Meta distribuida según histórico real del POS por día de semana.
    </div>
    <div style="overflow-x:auto">
      <table id="gpTable" style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="border-bottom:2px solid var(--border)">
          <th style="padding:6px 8px;text-align:left;font-size:11px;color:var(--text-dim)">Fecha</th>
          <th style="padding:6px 8px;text-align:left;font-size:11px;color:var(--text-dim)">Día</th>
          <th style="padding:6px 8px;text-align:left;font-size:11px;color:var(--text-dim)">Nota</th>
          <th style="padding:6px 8px;text-align:right;font-size:11px;color:var(--text-dim)">Meta sugerida</th>
          <th style="padding:6px 8px;font-size:11px;color:var(--text-dim)"></th>
        </tr></thead>
        <tbody>${calRows}</tbody>
      </table>
    </div>
    <div style="margin-top:12px;padding:10px;background:var(--accent-soft);border-radius:8px;font-size:13px;display:flex;justify-content:space-between;align-items:center">
      <span>Meta mensual: <b>${money(goal)}</b></span>
      <button onclick="saveMonthPlan()" style="background:var(--accent);color:#fff;border:none;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer">Guardar plan</button>
    </div>`;

  // Guardar estado mutable de días
  window._gpDays=allDays;
  window._gpWeights=weights;
}

function toggleGpDay(iso, open, goal){
  if(!window._gpDays) return;
  const d=window._gpDays.find(x=>x.iso===iso);
  if(d) d.open=open;
  const openDays=window._gpDays.filter(x=>x.open);
  const totalWeight=openDays.reduce((s,x)=>s+window._gpWeights[x.dw],0)||1;
  const basePerUnit=goal/totalWeight;
  window._gpDays.forEach(d=>{
    const row=document.querySelector(`tr[data-day="${d.iso}"]`);
    if(!row) return;
    const meta=d.open ? Math.round(basePerUnit*window._gpWeights[d.dw]/1000)*1000 : 0;
    const tds=row.querySelectorAll("td");
    if(tds[3]){ tds[3].textContent=d.open?money(meta):"—"; tds[3].style.color=d.open?"var(--accent)":"var(--text-dim)"; }
    // Sincronizar checkbox de la fila con el estado real
    const cb=row.querySelector("input[type=checkbox]");
    if(cb) cb.checked=d.open;
    const lbl=row.querySelector("label");
    if(lbl){ const span=lbl.querySelector("span"); if(!span){ lbl.childNodes[lbl.childNodes.length-1].textContent=d.open?" abierto":" incluir"; } }
    row.classList.toggle("gp-closed",!d.open);
  });
  const cnt=document.getElementById("gpOpenCount");
  if(cnt) cnt.textContent=openDays.length;
}

function redistribuirConFestivos(goal){
  if(!window._gpDays||!window._gpWeights) return;
  // Leer qué festivos están marcados como abiertos
  window._gpDays.forEach(d=>{
    if(!d.holiday) return; // solo festivos
    const cb=document.getElementById(`gpHol_${d.iso}`);
    if(cb) d.open=cb.checked;
  });
  // Recalcular y actualizar tabla
  const openDays=window._gpDays.filter(x=>x.open);
  const totalWeight=openDays.reduce((s,x)=>s+window._gpWeights[x.dw],0)||1;
  const basePerUnit=goal/totalWeight;
  window._gpDays.forEach(d=>{
    const row=document.querySelector(`tr[data-day="${d.iso}"]`);
    if(!row) return;
    const meta=d.open?Math.round(basePerUnit*window._gpWeights[d.dw]/1000)*1000:0;
    const tds=row.querySelectorAll("td");
    if(tds[3]){ tds[3].textContent=d.open?money(meta):"—"; tds[3].style.color=d.open?"var(--accent)":"var(--text-dim)"; }
    const cb=row.querySelector("input[type=checkbox]"); if(cb) cb.checked=d.open;
    row.classList.toggle("gp-closed",!d.open);
  });
  const cnt=document.getElementById("gpOpenCount"); if(cnt) cnt.textContent=openDays.length;
}

function saveMonthPlan(){
  if(!window._gpDays||!window._gpWeights) return;
  const goal=parseInt((document.getElementById("gpGoal").value||"").replace(/\D/g,""))||0;
  const month=parseInt(document.getElementById("gpMonth").value);
  const year=parseInt(document.getElementById("gpYear").value);
  const monthKey=`${year}-${String(month).padStart(2,"0")}`;
  const openDays=window._gpDays.filter(x=>x.open);
  const totalWeight=openDays.reduce((s,x)=>s+window._gpWeights[x.dw],0)||1;
  const basePerUnit=goal/totalWeight;
  const dayTargets={};
  for(const d of window._gpDays){
    if(!d.open) continue;
    dayTargets[d.iso]=Math.round(basePerUnit*window._gpWeights[d.dw]/1000)*1000;
  }
  try{
    const plans=JSON.parse(localStorage.getItem("bloom_goal_plans")||"{}");
    plans[monthKey]=dayTargets;
    localStorage.setItem("bloom_goal_plans",JSON.stringify(plans));
    const metas=JSON.parse(localStorage.getItem("bloom_goal_monthly")||"{}");
    metas[monthKey]=goal;
    localStorage.setItem("bloom_goal_monthly",JSON.stringify(metas));
    // Supabase backup — persiste aunque se limpie el caché
    sbPatch(`pos_settings?store=eq.${C.STORE}`,{goal_plans:{plans,monthly:metas}});
  }catch{}
  loadGoalBar(); // refresca la barra del mes en curso (no pisa otro mes)
  closeGoalPlanner();
  const MONTHS_ES2=["","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  alert(`✓ Plan de ${MONTHS_ES2[month]} ${year} guardado — ${openDays.length} días, meta ${money(goal)}`);
}

// Importar Excel histórico desde el navegador
function importSalesHistoryExcel(){
  const input=document.createElement("input");
  input.type="file"; input.accept=".xlsx,.xls";
  input.onchange=async e=>{
    const file=e.target.files[0]; if(!file) return;
    if(typeof XLSX==="undefined"){ alert("Librería de Excel no disponible"); return; }
    const data=await file.arrayBuffer();
    const wb=XLSX.read(data,{type:"array",cellFormula:false});
    const MONTHS_MAP={ENERO:1,FEBRERO:2,MARZO:3,ABRIL:4,MAYO:5,JUNIO:6,JULIO:7,AGOSTO:8,SEPTIEMBRE:9,OCTUBRE:10,NOVIEMBRE:11,DICIEMBRE:12};
    const result={};
    for(const sh of wb.SheetNames){
      const upper=sh.trim().toUpperCase();
      let mo=0,yr=0;
      for(const [m,n] of Object.entries(MONTHS_MAP)){
        if(upper.startsWith(m)){
          const rest=upper.slice(m.length).trim();
          const match=rest.match(/\d{4}/);
          if(match){ mo=n; yr=parseInt(match[0]); break; }
        }
      }
      if(!mo||!yr) continue;
      const ws=wb.Sheets[sh];
      const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:null});
      if(!rows.length) continue;
      const headers=(rows[0]||[]).map(h=>h?String(h).trim().toUpperCase():"");
      const totalCol=headers.findIndex(h=>h==="TOTAL");
      if(totalCol<0) continue;
      const days={};
      for(let i=1;i<rows.length;i++){
        const row=rows[i];
        const day=row[0];
        if(typeof day!=="number"||day<1||day>31) continue;
        const val=row[totalCol];
        if(typeof val==="number"&&val>0) days[String(day)]=Math.round(val);
      }
      if(Object.keys(days).length) result[`${yr}-${String(mo).padStart(2,"0")}`]=days;
    }
    const cnt=Object.keys(result).length;
    if(!cnt){ alert("No se encontraron datos en el archivo"); return; }
    localStorage.setItem("bloom_sales_history",JSON.stringify(result));
    _bloomSalesHistory=result;
    alert(`✓ ${cnt} meses importados (${Object.values(result).reduce((s,d)=>s+Object.keys(d).length,0)} días)`);
  };
  input.click();
}

// ====================================================================
//  ETIQUETAS DE PRECIO
// ====================================================================
let _lblQueue = [];       // [{name, variant, price, barcode, sku, qty}]
let _lblResults = [];     // resultados de búsqueda temporales para onclick seguro

function _lblG(id){ const e=document.getElementById(id); if(!e) return null; return e.type==="checkbox"?e.checked:(e.value||null); }

function searchLabelProducts(){
  const q=($("#lblSearch")?.value||"").toLowerCase().trim();
  const box=$("#lblResults"); if(!box) return;
  if(!q){ box.innerHTML=""; _lblResults=[]; return; }
  const list=pos.catalog.filter(p=>{
    if(p.name.toLowerCase().includes(q)) return true;
    if((p.sku||"").toLowerCase().includes(q)) return true;
    if((p.barcode||"").toLowerCase().includes(q)) return true;
    if(p.variants) return p.variants.some(v=>(v.barcode||"").toLowerCase().includes(q)||(v.sku||"").toLowerCase().includes(q));
    return false;
  }).slice(0,10);
  if(!list.length){ box.innerHTML='<div style="font-size:12px;color:var(--text-dim);padding:8px">Sin resultados</div>'; _lblResults=[]; return; }

  _lblResults = [];
  const rows = list.map(p=>{
    if(p.variants && p.variants.length){
      const allIdx = _lblResults.length;
      const variantItems = p.variants.map(v=>({
        name: p.name,
        variant: [v.color, v.talla||v.size].filter(Boolean).join(" / ")||"única",
        price: v.price||p.price,
        barcode: v.barcode||p.barcode||"",
        sku: v.sku||p.sku||"",
        stock: v.stock||0,
        variant_id: v.variant_id||null,
        _product: p
      }));
      _lblResults.push({ _group: true, items: variantItems });
      variantItems.forEach(item => _lblResults.push(item));

      const varRows = variantItems.map((item, vi)=>{
        const idx = allIdx + 1 + vi;
        const skuTag = item.sku
          ? `<span style="font-size:10px;color:var(--text-dim);margin-left:5px">${esc(item.sku)}</span>`
          : `<button onclick="event.stopPropagation();generateLabelBarcode(${idx})" style="font-size:10px;padding:1px 7px;margin-left:6px;border:1px dashed #c0392b;border-radius:4px;background:none;color:#c0392b;cursor:pointer">+ Generar SKU</button>`;
        const stk = item.stock>0 ? `<span style="font-size:10px;color:#27ae60">${item.stock} disp.</span>` : `<span style="font-size:10px;color:#c0392b">Agotado</span>`;
        return `<div onclick="addLabelByIdx(${idx})" style="padding:7px 10px 7px 18px;border-bottom:1px solid var(--border);cursor:pointer;font-size:13px;display:flex;justify-content:space-between;align-items:center;background:var(--surface)">
          <span style="display:flex;align-items:center;flex-wrap:wrap;gap:2px">
            <span style="color:var(--text)">${esc(item.variant)}</span>${skuTag}
          </span>
          <span style="display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:8px">
            ${stk}<span style="color:var(--accent);font-weight:600;font-size:12px">${money(item.price)}</span>
          </span>
        </div>`;
      }).join('');

      return `<div style="border:1px solid var(--border);border-radius:8px;margin-bottom:6px;overflow:hidden">
        <div style="padding:8px 10px;background:var(--surface-2);display:flex;justify-content:space-between;align-items:center;font-size:13px">
          <b>${esc(p.name)}</b>
          <button onclick="addAllLabelVariants(${allIdx})" style="font-size:11px;padding:3px 10px;border:1px solid var(--accent);border-radius:6px;background:none;color:var(--accent);cursor:pointer;font-weight:600">+ Todas</button>
        </div>
        ${varRows}
      </div>`;
    }
    // Producto sin variantes
    const idx = _lblResults.length;
    _lblResults.push({name:p.name, variant:"", price:p.price, barcode:p.barcode||"", sku:p.sku||"", stock:p.stock||0, variant_id:null, _product:p});
    const skuTag = p.sku
      ? `<span style="font-size:10px;color:var(--text-dim);margin-left:5px">${esc(p.sku)}</span>`
      : `<button onclick="event.stopPropagation();generateLabelBarcode(${idx})" style="font-size:10px;padding:1px 7px;margin-left:6px;border:1px dashed #c0392b;border-radius:4px;background:none;color:#c0392b;cursor:pointer">+ Generar SKU</button>`;
    const stk = p.stock>0 ? `<span style="font-size:10px;color:#27ae60">${p.stock} disp.</span>` : `<span style="font-size:10px;color:#c0392b">Agotado</span>`;
    return `<div onclick="addLabelByIdx(${idx})" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:4px;cursor:pointer;font-size:13px;background:var(--surface);display:flex;justify-content:space-between;align-items:center">
      <span style="display:flex;align-items:center;flex-wrap:wrap;gap:2px"><b>${esc(p.name)}</b>${skuTag}</span>
      <span style="display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:8px">${stk}<span style="color:var(--accent);font-weight:700">${money(p.price)}</span></span>
    </div>`;
  });
  box.innerHTML = rows.join('');
}

function addLabelByIdx(idx){
  const item=_lblResults[idx]; if(!item||item._group) return;
  _lblQueue.push({...item, qty: Math.max(1, item.stock||1)});
  renderLabelQueue();
}
function addAllLabelVariants(groupIdx){
  const group=_lblResults[groupIdx]; if(!group?._group) return;
  group.items.forEach(item=>_lblQueue.push({...item, qty: Math.max(1, item.stock||1)}));
  renderLabelQueue();
  const s=$("#lblSearch"); if(s) s.value="";
  const r=$("#lblResults"); if(r){ r.innerHTML=""; _lblResults=[]; }
}
function addLabelItem(name,variant,price,barcode,sku,stock){
  _lblQueue.push({name,variant,price,barcode,sku,qty:Math.max(1,stock||1)});
  renderLabelQueue();
  const s=$("#lblSearch"); if(s) s.value="";
  const r=$("#lblResults"); if(r){ r.innerHTML=""; _lblResults=[]; }
}

async function generateLabelBarcode(idx){
  const item=_lblResults[idx]; if(!item) return;
  // Generar SKU único: BL + 10 dígitos basados en timestamp + random
  const newSku = String(Date.now()).slice(-8) + String(Math.floor(Math.random()*100)).padStart(2,'0');
  // Obtener variant_id: directo o desde la primera variante del producto
  const vid = item.variant_id || item._product?.variants?.[0]?.variant_id;
  if(!vid){ alert("No se encontró la variante en Shopify."); return; }
  if(!confirm(`¿Generar y asignar el SKU "${newSku}" en Shopify?`)) return;

  const btn = document.querySelector(`[onclick="event.stopPropagation();generateLabelBarcode(${idx})"]`);
  if(btn){ btn.textContent="Guardando…"; btn.disabled=true; }

  try{
    const r = await fetch(`${C.WORKER_URL}/update-sku`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ variant_id: vid, sku: newSku })
    });
    const data = await r.json();
    if(data.ok){
      item.sku = newSku;
      if(item._product){
        if(item.variant_id && item._product.variants){
          const v=item._product.variants.find(v=>String(v.variant_id)===String(item.variant_id));
          if(v) v.sku=newSku;
        } else if(item._product.variants?.[0]){ item._product.variants[0].sku=newSku; }
      }
      if(btn){
        const span=document.createElement('span');
        span.style.cssText="font-size:10px;color:var(--text-dim);margin-left:5px";
        span.textContent=newSku;
        btn.replaceWith(span);
      }
      alert(`✓ SKU "${newSku}" guardado en Shopify`);
    } else {
      if(btn){ btn.textContent="+ Generar SKU"; btn.disabled=false; }
      alert("Error al guardar en Shopify: "+(data.error||""));
    }
  }catch(e){
    if(btn){ btn.textContent="+ Generar SKU"; btn.disabled=false; }
    alert("Error de conexión");
  }
}
function removeLabelItem(i){ _lblQueue.splice(i,1); renderLabelQueue(); }
function setLabelQty(i,v){ _lblQueue[i].qty=Math.max(1,parseInt(v)||1); }
function clearLabelQueue(){ _lblQueue=[]; renderLabelQueue(); }

function renderLabelQueue(){
  const box=$("#lblQueue"); if(!box) return;
  const total=_lblQueue.reduce((s,r)=>s+r.qty,0);
  if(!_lblQueue.length){ box.innerHTML='<div style="font-size:12px;color:var(--text-dim);padding:4px 0">No hay productos en cola — busca arriba para agregar.</div>'; return; }
  const missing=_lblQueue.filter(r=>!r.sku);
  const bulkBtn=missing.length
    ? `<button onclick="generateAllMissingSku()" style="width:100%;margin-bottom:8px;background:none;border:1px dashed #c0392b;border-radius:8px;padding:8px;font-size:13px;cursor:pointer;color:#c0392b;display:flex;align-items:center;justify-content:center;gap:6px">
        <span class="material-symbols-outlined" style="font-size:16px">qr_code</span> Generar SKU a todas sin código (${missing.length})
       </button>`
    : '';
  box.innerHTML=`<div style="font-size:11px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Cola de impresión · ${total} etiqueta${total!==1?"s":""}</div>`+
  bulkBtn+
  _lblQueue.map((item,i)=>`
    <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:4px;background:var(--surface);font-size:13px">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(item.name)}${item.variant?` <span style="font-weight:400;color:var(--text-dim)">${esc(item.variant)}</span>`:''}</div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
          <span style="font-size:12px;color:var(--accent);font-weight:700">${money(item.price)}</span>
          ${item.sku
            ? `<span style="font-size:10px;color:var(--text-dim)">${esc(item.sku)}</span>`
            : `<span style="font-size:10px;color:#c0392b">Sin SKU</span>`}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
        <span style="font-size:11px;color:var(--text-dim)">copias</span>
        <input type="number" min="1" value="${item.qty}" onchange="setLabelQty(${i},this.value)"
          style="width:48px;border:1px solid var(--border);border-radius:6px;padding:4px 6px;font-size:13px;text-align:center;background:var(--bg);color:var(--text)">
      </div>
      <button onclick="removeLabelItem(${i})" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text-dim);padding:0 2px;flex-shrink:0;line-height:1">×</button>
    </div>`).join('');
}

function printLabels(){
  if(!_lblQueue.length){ alert("Agrega productos a la cola primero"); return; }
  const size=_lblG("lblSize")||"31.75x25.4";
  const font=_lblG("lblFont")||"Arial,sans-serif";
  const mTop=parseFloat(_lblG("lblMTop"))||2;
  const mBottom=parseFloat(_lblG("lblMBottom"))||2;
  const mLeft=parseFloat(_lblG("lblMLeft"))||3;
  const mRight=parseFloat(_lblG("lblMRight"))||3;
  const showStore=_lblG("lblShowStore")||false;
  const showName=_lblG("lblShowName")!==false;
  const showVariant=_lblG("lblShowVariant")!==false;
  const showPrice=_lblG("lblShowPrice")!==false;
  const showBarcode=_lblG("lblShowBarcode")!==false;
  const fsStore=parseInt(_lblG("lblFsStore"))||7;
  const fsName=parseInt(_lblG("lblFsName"))||9;
  const fsVariant=parseInt(_lblG("lblFsVariant"))||8;
  const fsPrice=parseInt(_lblG("lblFsPrice"))||14;
  const bcH=parseInt(_lblG("lblBcH"))||22;
  const storeName=(pos.settings?.receipt_business)||"Bloom";

  const sizeMap={
    "31.75x25.4":{w:"31.75mm",h:"25.4mm",pageW:"31.75mm",pageH:"25.4mm",cols:1},
    "50x30":{w:"50mm",h:"30mm",pageW:"50mm",pageH:"30mm",cols:1},
    "58x40":{w:"58mm",h:"40mm",pageW:"58mm",pageH:"40mm",cols:1},
    "80x50":{w:"80mm",h:"50mm",pageW:"80mm",pageH:"50mm",cols:1},
    "100x60":{w:"100mm",h:"60mm",pageW:"210mm",pageH:"297mm",cols:2},
    "a4":{w:"66mm",h:"36mm",pageW:"210mm",pageH:"297mm",cols:3},
  };
  const sz=sizeMap[size]||sizeMap["31.75x25.4"];

  const items=[];
  for(const row of _lblQueue) for(let j=0;j<row.qty;j++) items.push({...row, _bcId:"bc"+Math.random().toString(36).slice(2), _qrId:"qr"+Math.random().toString(36).slice(2)});

  const labelHTML=items.map(item=>`
    <div class="lbl">
      ${showStore?`<div class="f-store">${esc(storeName)}</div>`:""}
      ${showName?`<div class="f-name">${esc(item.name)}</div>`:""}
      ${showVariant&&item.variant?`<div class="f-variant">${esc(item.variant)}</div>`:""}
      ${showPrice?`<div class="f-price">${money(item.price)}</div>`:""}
      ${showBarcode&&(item.sku||item.barcode)?`<svg id="${item._bcId}" class="f-bc"></svg>`:""}
    </div>`).join('');

  const win=window.open("","_blank");
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Etiquetas</title>
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:${font};background:#fff}
    .grid{display:flex;flex-wrap:wrap}
    .lbl{width:${sz.w};height:${sz.h};border:1px dashed #bbb;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:${mTop}mm ${mRight}mm ${mBottom}mm ${mLeft}mm;text-align:center;overflow:hidden;page-break-inside:avoid}
    .f-store{font-size:${fsStore}pt;color:#666;text-transform:uppercase;letter-spacing:.8px;margin-bottom:1mm}
    .f-name{font-size:${fsName}pt;font-weight:700;line-height:1.2;margin-bottom:.5mm;max-width:100%;word-break:break-word}
    .f-variant{font-size:${fsVariant}pt;color:#555;margin-bottom:.5mm}
    .f-price{font-size:${fsPrice}pt;font-weight:900;margin-bottom:1mm}
    .f-bc{max-width:100%;height:${bcH}px;margin-bottom:1mm}
    @media print{
      body{margin:0}
      .lbl{border-color:transparent}
      @page{margin:0;size:${sz.pageW} ${sz.pageH}}
    }
  </style></head><body>
  <div class="grid">${labelHTML}</div>
  <\/body><\/html>`);
  win.document.close();

  setTimeout(()=>{
    try{
      items.forEach(item=>{
        const code=item.sku||item.barcode||"";
        if(showBarcode&&code){
          const svg=win.document.getElementById(item._bcId);
          if(svg) try{ win.JsBarcode(svg,code,{format:"CODE128",displayValue:true,fontSize:7,height:bcH-4,margin:1,width:1.2}); }catch(e){}
        }
      });
      setTimeout(()=>win.print(),400);
    }catch(e){ setTimeout(()=>win.print(),800); }
  },600);
}

const _LBL_FIELDS=["lblSize","lblFont","lblMTop","lblMBottom","lblMLeft","lblMRight","lblShowStore","lblShowName","lblShowVariant","lblShowPrice","lblShowBarcode","lblFsStore","lblFsName","lblFsVariant","lblFsPrice","lblBcH"];
const _LBL_PRESETS_KEY="bloom_label_presets";

function _lblReadFields(){
  const d={};
  _LBL_FIELDS.forEach(id=>{
    const el=document.getElementById(id); if(!el) return;
    d[id]=el.type==="checkbox"?el.checked:el.value;
  });
  return d;
}
function _lblApplyFields(d){
  _LBL_FIELDS.forEach(id=>{
    if(!(id in d)) return;
    const el=document.getElementById(id); if(!el) return;
    if(el.type==="checkbox") el.checked=d[id];
    else el.value=d[id];
  });
}
function _lblGetPresets(){ try{ return JSON.parse(localStorage.getItem(_LBL_PRESETS_KEY)||"[]"); }catch{ return []; } }
function _lblSavePresets(list){
  try{ localStorage.setItem(_LBL_PRESETS_KEY,JSON.stringify(list)); }catch{}
  sbPatch(`pos_settings?store=eq.${C.STORE}`,{label_presets:list});
}

function renderLabelPresetSelect(){
  const sel=document.getElementById("lblPresetSelect"); if(!sel) return;
  const presets=_lblGetPresets();
  const cur=sel.value;
  sel.innerHTML='<option value="">— Seleccionar diseño —</option>'+
    presets.map((p,i)=>`<option value="${i}"${String(i)===cur?` selected`:""}>${esc(p.name)}</option>`).join('');
}
function saveLabelPreset(){
  const nameEl=document.getElementById("lblPresetName"); if(!nameEl) return;
  const name=(nameEl.value||"").trim();
  if(!name){ nameEl.focus(); return; }
  const presets=_lblGetPresets();
  const existing=presets.findIndex(p=>p.name.toLowerCase()===name.toLowerCase());
  const entry={name, fields:_lblReadFields()};
  if(existing>=0) presets[existing]=entry;
  else presets.push(entry);
  _lblSavePresets(presets);
  renderLabelPresetSelect();
  // Seleccionar el recién guardado
  const idx=_lblGetPresets().findIndex(p=>p.name.toLowerCase()===name.toLowerCase());
  const sel=document.getElementById("lblPresetSelect");
  if(sel&&idx>=0) sel.value=String(idx);
  nameEl.value="";
}
function loadLabelPreset(){
  const sel=document.getElementById("lblPresetSelect"); if(!sel||sel.value==="") return;
  const presets=_lblGetPresets();
  const preset=presets[parseInt(sel.value)];
  if(preset) _lblApplyFields(preset.fields);
}
function deleteLabelPreset(){
  const sel=document.getElementById("lblPresetSelect"); if(!sel||sel.value==="") return;
  const presets=_lblGetPresets();
  const idx=parseInt(sel.value);
  const name=presets[idx]?.name;
  if(!name||!confirm(`¿Eliminar el diseño "${name}"?`)) return;
  presets.splice(idx,1);
  _lblSavePresets(presets);
  renderLabelPresetSelect();
}
function loadLabelDefaults(){
  // Carga el primer preset si existe, para mantener compatibilidad
  const presets=_lblGetPresets();
  if(presets.length) _lblApplyFields(presets[0].fields);
  renderLabelPresetSelect();
}

// Genera SKU único — verifica contra catálogo + lote actual para evitar colisiones
function _genUniqueSku(usedSet){
  for(let i=0;i<20;i++){
    const sku=String(Date.now()).slice(-8)+String(Math.floor(Math.random()*100)).padStart(2,'0');
    if(!usedSet.has(sku)){ usedSet.add(sku); return sku; }
  }
  return null; // muy improbable
}

async function generateAllMissingSku(){
  const targets=_lblQueue.filter(r=>!r.sku);
  if(!targets.length) return;
  if(!confirm(`¿Generar SKU para ${targets.length} producto${targets.length!==1?"s":""}? Solo se asignará a los que no tienen SKU.`)) return;

  // Construir Set con todos los SKUs existentes en el catálogo
  const usedSkus=new Set();
  for(const p of pos.catalog){
    if(p.sku) usedSkus.add(p.sku);
    for(const v of (p.variants||[])) if(v.sku) usedSkus.add(v.sku);
  }

  let ok=0, err=0;
  for(const item of targets){
    const vid=item.variant_id||item._product?.variants?.[0]?.variant_id;
    if(!vid){ err++; continue; }
    const newSku=_genUniqueSku(usedSkus);
    if(!newSku){ err++; continue; }
    try{
      const r=await fetch(`${C.WORKER_URL}/update-sku`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({variant_id:vid,sku:newSku})});
      const data=await r.json();
      if(data.ok){
        item.sku=newSku;
        if(item._product){
          if(item.variant_id&&item._product.variants){
            const v=item._product.variants.find(v=>String(v.variant_id)===String(item.variant_id));
            if(v) v.sku=newSku;
          } else if(item._product.variants?.[0]){ item._product.variants[0].sku=newSku; }
        }
        ok++;
      } else { err++; }
    }catch{ err++; }
  }
  renderLabelQueue();
  alert(`✓ ${ok} SKU${ok!==1?"s":""} generado${ok!==1?"s":""}${err?` · ${err} con error`:""}`);
}

// ---- Datos / estadísticas ----
async function initDatos(){
  loadReport("today");
}
function toggleDatMore(){
  const x=document.getElementById("datTabsExtra");
  const btn=document.getElementById("datMoreBtn");
  if(x) x.classList.toggle("show");
  if(btn) btn.classList.toggle("on");
}
function datosTab(which){
  ["tienda","ventas","clientes","pers","Exchanges","Etiquetas"].forEach(t=>{
    const key = t==="Exchanges" ? "datPaneExchanges" : "datPane"+t.charAt(0).toUpperCase()+t.slice(1);
    const p=document.getElementById(key);
    const w = t==="Exchanges" ? "exchanges" : t==="Etiquetas" ? "etiquetas" : t;
    if(p) p.style.display = which===w?"block":"none";
  });
  const tabMap={tienda:"datTab1",ventas:"datTab4",clientes:"datTab5",pers:"datTab3",exchanges:"datTab6",etiquetas:"datTab7"};
  Object.entries(tabMap).forEach(([t,id])=>{ const b=document.getElementById(id); if(b) b.classList.toggle("on",which===t); });
  if(which==="pers") loadCustomOrders();
  if(which==="ventas") loadSalesHistory();
  if(which==="clientes") initClientesTab();
  if(which==="exchanges") loadExchangesTab();
  if(which==="etiquetas") initEtiquetasTab();
}
async function initEtiquetasTab(){
  if(!pos.catalog.length) pos.catalog = await fetchProducts();
  renderLabelPresetSelect();
  loadLabelDefaults();
}

// ---- Pestaña Cambios y Garantías ----
let _exAll = [];
async function loadExchangesTab(){
  const box=document.getElementById("exchangesList"); if(!box) return;
  box.innerHTML='<div style="font-size:13px;color:var(--text-dim)">Cargando cambios…</div>';
  const rows = await sbGet(`exchanges?order=created_at.desc&limit=200`);
  _exAll = rows || [];
  renderExchangesList(_exAll);
}

function filterExchanges(reason, btn){
  document.querySelectorAll("#exFilter button").forEach(b=>b.classList.remove("on"));
  if(btn) btn.classList.add("on");
  const filtered = reason==="todos" ? _exAll : _exAll.filter(e=>e.reason===reason);
  renderExchangesList(filtered);
}

function renderExchangesList(rows){
  const box=document.getElementById("exchangesList"); if(!box) return;
  if(!rows.length){ box.innerHTML='<div style="color:var(--text-dim);font-size:13px;padding:12px 0">No hay registros.</div>'; return; }
  const reasonLabel={cambio:"Cambio",garantia:"Garantía",devolucion:"Devolución"};
  const reasonColor={cambio:"#7c3aed",garantia:"#0ea5e9",devolucion:"#ef4444"};
  const statusColor={completado:"#16a34a",pendiente:"#d97706",cancelado:"#6b7280"};
  box.innerHTML = rows.map(e=>{
    const ret = (e.returned_items||[]).map(i=>`${i.qty}× ${i.title||i.sku||i.variant_id}`).join(", ")||"—";
    const rep = (e.replacement_items||[]).map(i=>`${i.quantity||1}× ${i.title||i.variant_id}`).join(", ")||"Sin reemplazo";
    const diff = (e.charge_amount||0)-(e.refund_amount||0);
    const diffStr = diff===0?"Sin cobro adicional":diff>0?`+$${diff.toLocaleString("es-CO")} cobro`:`$${Math.abs(diff).toLocaleString("es-CO")} a favor`;
    const date = new Date(e.created_at).toLocaleDateString("es-CO",{day:"2-digit",month:"short",year:"numeric"});
    return `<div class="ex-card" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:12px;font-weight:700;padding:2px 8px;border-radius:20px;background:${reasonColor[e.reason]||"#6b7280"}20;color:${reasonColor[e.reason]||"#6b7280"}">${reasonLabel[e.reason]||e.reason}</span>
          <span style="font-size:12px;font-weight:600;color:var(--text)">${e.original_order_name||"—"}</span>
          ${e.new_order_name?`<span style="font-size:11px;color:var(--text-dim)">→ ${e.new_order_name}</span>`:""}
        </div>
        <span style="font-size:11px;padding:2px 8px;border-radius:20px;background:${statusColor[e.status]||"#6b7280"}20;color:${statusColor[e.status]||"#6b7280"}">${e.status||"completado"}</span>
      </div>
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:4px"><b>Devuelve:</b> ${ret}</div>
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:4px"><b>Reemplazo:</b> ${rep}</div>
      ${e.notes?`<div style="font-size:12px;color:var(--text-dim);margin-bottom:4px"><b>Nota:</b> ${e.notes}</div>`:""}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
        <span style="font-size:12px;color:var(--text-dim)">${e.seller_name||""} · ${date}</span>
        <span style="font-size:12px;font-weight:600;color:${diff>=0?"var(--text)":"#16a34a"}">${diffStr}</span>
      </div>
    </div>`;
  }).join("");
}

// ---- Pestaña Clientes ----
async function initClientesTab(){
  const box=$("#clientResults"); if(!box) return;
  box.innerHTML='<div style="font-size:13px;color:var(--text-dim)">Cargando últimos clientes…</div>';
  // Muestra los 20 más recientes al abrir
  const rows=await sbGet(`customers?order=created_at.desc&limit=20`);
  if(!rows||!rows.length){
    box.innerHTML='<div style="color:var(--text-dim);font-size:13px">No hay clientes importados aún.</div>';
    return;
  }
  renderClientList(rows, "Últimos 20 clientes · Escribe para buscar");
}

function renderClientList(rows, title){
  const box=$("#clientResults"); if(!box) return;
  box.innerHTML=`<div style="font-size:12px;color:var(--text-dim);margin-bottom:8px">${title} (${rows.length})</div>`
    + rows.map(c=>`
    <div class="client-card" style="cursor:pointer" onclick="openClientEdit('${c.id}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div><b>${esc(c.full_name||"—")}</b></div>
        <div style="display:flex;gap:8px;align-items:center">
          ${c.doc?`<span style="font-size:11px;color:var(--accent-dark)">CC ${esc(c.doc)}</span>`:""}
          <span style="font-size:18px;color:var(--accent-dark)">›</span>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text-dim);margin-top:2px">
        ${c.email?`<span class=\"material-symbols-outlined\" style=\"font-size:13px;vertical-align:-3px\">email</span> ${esc(c.email)}`:""}${c.phone?` · <span class=\"material-symbols-outlined\" style=\"font-size:13px;vertical-align:-3px\">smartphone</span> ${esc(c.phone)}`:""}
      </div>
      ${(c.city||c.depto)?`<div style="font-size:11px;color:var(--text-dim)">📍 ${esc(c.city||"")}${c.depto?", "+esc(c.depto):""}</div>`:""}
    </div>`).join("");
}

let _clientTimer=null;
function searchClients(){
  clearTimeout(_clientTimer);
  _clientTimer=setTimeout(async()=>{
    const q=($("#clientSearch").value||"").trim();
    if(q.length<3){ initClientesTab(); return; }
    const box=$("#clientResults"); if(!box) return;
    box.innerHTML='<div style="font-size:13px;color:var(--text-dim)">Buscando…</div>';
    const enc=encodeURIComponent(`%${q}%`);
    const rows=await sbGet(`customers?or=(full_name.ilike.${enc},email.ilike.${enc},phone.ilike.${enc})&limit=30&order=full_name.asc`);
    if(!rows||!rows.length){
      $("#clientResults").innerHTML='<div style="font-size:13px;color:var(--text-dim)">Sin resultados para "'+esc(q)+'".</div>';
      return;
    }
    renderClientList(rows, `Resultados para "${q}"`);
  }, 350);
}

// ---- Editar cliente + historial ----
let _editClientData=null;
function onEditDeptoChange(){
  const deptoSel=$("#editClientDepto"), citySel=$("#editClientCity");
  const chosen=deptoSel.value;
  citySel.innerHTML='<option value="">Selecciona…</option>';
  if(chosen && window.COLOMBIA && window.COLOMBIA[chosen]){
    window.COLOMBIA[chosen].forEach(c=>{ const o=document.createElement("option"); o.value=c.toUpperCase(); o.textContent=c; citySel.appendChild(o); });
  }
}
function populateEditDeptoSelects(depto, city){
  const deptoSel=$("#editClientDepto");
  deptoSel.innerHTML='<option value="">Selecciona…</option>';
  if(window.COLOMBIA){
    Object.keys(window.COLOMBIA).sort().forEach(d=>{ const o=document.createElement("option"); o.value=d; o.textContent=d; if(d===depto) o.selected=true; deptoSel.appendChild(o); });
  }
  onEditDeptoChange();
  if(city){ const citySel=$("#editClientCity"); [...citySel.options].forEach(o=>{ if(o.value===city.toUpperCase()) o.selected=true; }); }
}
async function openClientEdit(id){
  const rows=await sbGet(`customers?id=eq.${id}`);
  const c=rows&&rows[0]; if(!c) return;
  _editClientData=c;
  $("#editClientId").value=c.id;
  $("#editClientName").value=c.full_name||"";
  $("#editClientDoc").value=c.doc||"";
  $("#editClientEmail").value=c.email||"";
  $("#editClientPhone").value=c.phone||"";
  populateEditDeptoSelects(c.depto||"", c.city||"");
  // Carga historial de compras por email
  const histBox=$("#clientHistory");
  histBox.innerHTML="Cargando historial…";
  if(c.email){
    const ventas=await sbGet(`sales?customer_email=eq.${encodeURIComponent(c.email)}&order=created_at.desc&limit=10&select=total,created_at,sale_type,items`);
    if(ventas&&ventas.length){
      const totalGastado=ventas.reduce((s,v)=>s+Number(v.total||0),0);
      histBox.innerHTML=`<div style="font-weight:600;margin-bottom:6px">Total compras: ${ventas.length} · ${money(totalGastado)}</div>`
        +ventas.map(v=>{
          const f=new Date(v.created_at).toLocaleDateString("es-CO",{day:"2-digit",month:"2-digit",year:"2-digit"});
          const prods=(v.items||[]).map(i=>i.name).slice(0,2).join(", ");
          return `<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">
            <span style="color:var(--text-dim)">${f}</span> · <b>${money(v.total)}</b>
            ${prods?`<div style="color:var(--text-dim)">${esc(prods)}${(v.items||[]).length>2?` +${(v.items||[]).length-2} más`:""}</div>`:""}
          </div>`;
        }).join("");
    }else{
      histBox.innerHTML='<div style="color:var(--text-dim)">Sin compras registradas en el sistema.</div>';
    }
  }else{
    histBox.innerHTML='<div style="color:var(--text-dim)">Sin email — no se puede cruzar historial.</div>';
  }
  $("#clientEditModal").classList.add("show");
}
function closeClientEdit(){ $("#clientEditModal").classList.remove("show"); _editClientData=null; }
async function deleteClient(){
  const id=$("#editClientId").value; if(!id) return;
  const nombre=$("#editClientName").value||"este cliente";
  const email=$("#editClientEmail").value||"";
  // Verifica si tiene compras antes de confirmar
  let numCompras=0;
  if(email){
    const ventas=await sbGet(`sales?customer_email=eq.${encodeURIComponent(email)}&select=id&limit=1000`).catch(()=>[]);
    numCompras=ventas?.length||0;
  }
  const aviso=numCompras>0
    ? `⚠️ Este cliente tiene ${numCompras} compra${numCompras>1?"s":""} registrada${numCompras>1?"s":""}.\nLas ventas NO se borran, solo el registro del cliente.\n\n`
    : "";
  if(!confirm(`${aviso}¿Borrar a ${nombre}?\n\nEsta acción no se puede deshacer.`)) return;
  const r=await fetch(`${C.SUPABASE_URL}/rest/v1/customers?id=eq.${id}`,{
    method:"DELETE",
    headers:{"apikey":C.SUPABASE_ANON,"Authorization":"Bearer "+C.SUPABASE_ANON,"Prefer":"return=minimal"}
  });
  if(r.ok||r.status===204){
    closeClientEdit();
    initClientesTab();
  } else {
    alert("No se pudo borrar el cliente. Intenta de nuevo.");
  }
}
async function saveClientEdit(){
  const id=$("#editClientId").value; if(!id) return;
  const data={
    full_name:($("#editClientName").value||"").trim().toUpperCase()||null,
    doc:($("#editClientDoc").value||"").trim()||null,
    email:($("#editClientEmail").value||"").trim().toLowerCase()||null,
    phone:($("#editClientPhone").value||"").trim()||null,
    city:($("#editClientCity").value||"").trim().toUpperCase()||null,
    depto:($("#editClientDepto").value||"").trim()||null,
  };
  await sbPatch(`customers?id=eq.${id}`, data);
  closeClientEdit();
  searchClients(); // refresca lista
}

function importClientesFromXlsx(){
  alert("La importación masiva se hace con el script Python desde tu PC. Ya están cargados los 5.146 clientes de Shopify.");
}
let _salesSearchTimer=null;
function searchSalesHistory(){ clearTimeout(_salesSearchTimer); _salesSearchTimer=setTimeout(loadSalesHistory,350); }

async function loadSalesHistory(){
  const box=$("#salesHistory"); if(!box) return;
  box.innerHTML='<div style="color:var(--text-dim);font-size:13px">Cargando…</div>';
  const q=($("#salesSearch")||{value:""}).value.trim();
  const fields = "select=id,shopify_order_name,shopify_order_id,total,status,sale_type,created_at,customer_name,customer_doc,customer_phone,customer_email,alegra_invoice,items,cashier_name,seller_name";
  let url=`sales?store=eq.${C.STORE}&order=created_at.desc&limit=80&${fields}`;
  if(q){
    const enc=encodeURIComponent(q);
    url=`sales?store=eq.${C.STORE}&order=created_at.desc&limit=80&${fields}&or=(customer_name.ilike.*${enc}*,customer_doc.ilike.*${enc}*,customer_phone.ilike.*${enc}*)`;
  }
  const rows=await sbGet(url);
  if(!rows || !rows.length){ box.innerHTML='<div style="color:var(--text-dim);font-size:13px">No hay ventas para esa búsqueda.</div>'; return; }
  box.innerHTML="";
  _exSaleCache.clear();
  for(const s of rows){
    _exSaleCache.set(s.id, s);
    const fecha=new Date(s.created_at).toLocaleString("es-CO",{day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"});
    const card=el("div","sale-card");
    const esEnvio = s.sale_type==="envios" || s.sale_type==="envíos";
    const esShopify = s.sale_type==="shopify";
    const tieneEtiqueta = esEnvio || esShopify;
    const cancelada = s.status==="cancelada";
    const statusBadge = cancelada?'<span style="font-size:11px;background:#fee2e2;color:#b91c1c;border-radius:6px;padding:1px 6px;margin-left:4px">Cancelada</span>':'';
    const canalBadge = esShopify
      ? `<span class="material-symbols-outlined" style="font-size:13px;vertical-align:-3px;color:#96bf48">shopping_bag</span> Shopify`
      : esEnvio
        ? `<span class="material-symbols-outlined" style="font-size:13px;vertical-align:-3px;color:#25d366">chat</span> WhatsApp`
        : `<span class="material-symbols-outlined" style="font-size:13px;vertical-align:-3px">storefront</span> Tienda`;
    card.innerHTML=`
      <div class="sale-card-main">
        <div>
          <div><b>${money(s.total)}</b>${statusBadge} <span style="font-size:11px;color:var(--text-dim)">${canalBadge}</span></div>
          <div style="font-size:12px;color:var(--text-dim)">${esc(s.customer_name||"Sin cliente")}${s.customer_doc?' · '+esc(s.customer_doc):''}${s.customer_phone?' · '+esc(s.customer_phone):''} · ${fecha}</div>
          ${s.shopify_order_name?`<div style="font-size:11px;color:var(--text-dim)">${esc(s.shopify_order_name)}</div>`:''}
          ${s.cashier_name?`<div style="font-size:11px;color:var(--text-dim)"><span class="material-symbols-outlined" style="font-size:11px;vertical-align:-2px">badge</span> ${esc(s.cashier_name)}${s.seller_name&&s.seller_name!==s.cashier_name?' · '+esc(s.seller_name):''}</div>`:''}
          ${s.alegra_invoice?`<div style="font-size:11px;color:#1d8a5e">✓ Factura Alegra: ${esc(s.alegra_invoice)}</div>`:""}
        </div>
        <button class="sale-menu-btn" onclick="toggleSaleMenu('${s.id}')">⋮</button>
      </div>
      <div class="sale-menu" id="saleMenu-${s.id}">
        ${tieneEtiqueta?`<button onclick="printLabel('${s.id}')"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px">label</span> Imprimir etiqueta</button>`:""}
        <button onclick="invoiceAlegra('${s.id}')"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px">description</span> Crear factura Alegra</button>
        <button onclick="invoiceSiigo('${s.id}')"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px">receipt</span> Crear factura Siigo</button>
      </div>`;
    box.appendChild(card);
  }
}
function toggleSaleMenu(id){
  const m=$("#saleMenu-"+id);
  document.querySelectorAll(".sale-menu.show").forEach(x=>{ if(x!==m) x.classList.remove("show"); });
  m.classList.toggle("show");
}

// ======= CAMBIO / GARANTÍA =======
let _exCtx = {};
const _exSaleCache = new Map();

function toggleExCreate(open){
  const panel = document.getElementById("exCreatePanel");
  const btn = document.getElementById("exNewBtn");
  const show = open !== undefined ? open : panel.style.display === "none";
  panel.style.display = show ? "block" : "none";
  btn.style.background = show ? "var(--accent-dark,#a07d32)" : "var(--accent)";
  if(show) _resetExForm();
}

function _resetExForm(){
  _exCtx = { saleId:null, shopifyOrderId:null, orderName:null, items:[], customer:{}, reason:'cambio', replacement:[], returnSel:{}, chargePayments:[] };
  ["exOrderSearch","exNotes","exProductSearch","exRefundAmount"].forEach(id=>{ const el=document.getElementById(id); if(el){ el.value=""; delete el.dataset.userSet; } });
  ["exOrderResults","exOrderSelected","exReturnItems","exProductResults","exSelectedReplacement","exPriceSummary","exPaymentRows"].forEach(id=>{ const el=document.getElementById(id); if(el) el.innerHTML=""; });
  ["exPaymentSection","exPartialSection","exCancelNotice"].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display="none"; });
  document.getElementById("exReplacementSection").style.display = "";
  document.getElementById("exReturnSection").style.display = "none";
  document.querySelectorAll(".ex-reason-btn").forEach(b=>b.classList.remove("active"));
  document.getElementById("exReason-cambio")?.classList.add("active");
  document.getElementById("exReplacementSection").style.display = "";
  const btn = document.getElementById("exConfirmBtn"); if(btn){ btn.disabled=false; btn.textContent="Confirmar"; }
}

let _exOrderTimer = null;
function searchExOrder(){
  clearTimeout(_exOrderTimer);
  _exOrderTimer = setTimeout(async () => {
    const q = document.getElementById("exOrderSearch").value.trim();
    const box = document.getElementById("exOrderResults");
    if(q.length < 2){ box.innerHTML = ""; return; }
    const enc = encodeURIComponent(q);
    const rows = await sbGet(`sales?store=eq.${C.STORE}&or=(shopify_order_name.ilike.*${enc}*,customer_name.ilike.*${enc}*)&select=id,shopify_order_name,shopify_order_id,customer_name,items,total,customer_phone,customer_email,customer_doc&limit=8&order=created_at.desc`);
    box.innerHTML = "";
    if(!rows.length){ box.innerHTML='<div style="font-size:12px;color:var(--text-dim);padding:6px">Sin resultados</div>'; return; }
    for(const s of rows){
      const d = document.createElement("div");
      d.className = "ex-product-result";
      d.innerHTML = `<span><b>${esc(s.shopify_order_name||'—')}</b> <span style="color:var(--text-dim)">${esc(s.customer_name||'')}</span></span><b>${money(s.total)}</b>`;
      d.onclick = () => selectExOrder(s);
      box.appendChild(d);
    }
  }, 300);
}

function selectExOrder(s){
  document.getElementById("exOrderResults").innerHTML = "";
  document.getElementById("exOrderSearch").value = s.shopify_order_name || "";
  document.getElementById("exOrderSelected").innerHTML = `
    <div style="background:var(--accent-soft);border-radius:10px;padding:10px 12px;font-size:13px;display:flex;justify-content:space-between;align-items:center">
      <span><b>${esc(s.shopify_order_name||'—')}</b> · ${esc(s.customer_name||'—')}</span>
      <span style="font-weight:600">${money(s.total)}</span>
    </div>`;
  _exCtx.saleId = s.id;
  _exCtx.shopifyOrderId = s.shopify_order_id;
  _exCtx.orderName = s.shopify_order_name;
  _exCtx.items = s.items || [];
  _exCtx.saleTotal = Number(s.total) || 0;
  _exCtx.customer = { name: s.customer_name, phone: s.customer_phone, email: s.customer_email, doc: s.customer_doc };
  _exCtx.returnSel = {};
  document.getElementById("exReturnSection").style.display = "";
  renderExReturnItems();
  updateExSummary();
}

function setExReason(r){
  _exCtx.reason = r;
  _exCtx.chargePayments = [];
  document.querySelectorAll(".ex-reason-btn").forEach(b => b.classList.remove("active"));
  document.getElementById("exReason-"+r)?.classList.add("active");

  const isCancel = r === 'cancelacion';
  const isDev    = r === 'devolucion';

  document.getElementById("exCancelNotice").style.display     = isCancel ? '' : 'none';
  document.getElementById("exReturnSection").style.display    = isCancel ? 'none' : (_exCtx.saleId ? '' : 'none');
  document.getElementById("exReplacementSection").style.display = (isCancel || isDev) ? 'none' : '';
  document.getElementById("exPartialSection").style.display   = isDev ? '' : 'none';

  if(isDev || isCancel){ _exCtx.replacement = []; renderExReplacements(); }
  if(!isDev){ const inp = document.getElementById("exRefundAmount"); if(inp) inp.value = ""; }

  renderExPaymentRows();
  updateExSummary();
}

function renderExReturnItems(){
  const box = $("#exReturnItems");
  box.innerHTML = "";
  for(const item of (_exCtx.items || [])){
    const key = item.sku || item.name;
    if(!_exCtx.returnSel[key]) _exCtx.returnSel[key] = { checked: false, qty: 1 };
    const div = document.createElement("div");
    div.className = "ex-return-item";
    div.innerHTML = `
      <input type="checkbox" id="exChk-${key}" onchange="toggleExItem('${key}')" ${_exCtx.returnSel[key].checked?'checked':''}>
      <div>
        <div style="font-weight:500">${esc(item.name)}</div>
        <div style="color:var(--text-dim)">${esc(item.variant||'')} · ${money(item.price)}</div>
      </div>
      <div class="qty-ctrl">
        <button onclick="exQty('${key}',-1)">−</button>
        <span id="exQty-${key}">${_exCtx.returnSel[key].qty}</span>
        <button onclick="exQty('${key}',1)">+</button>
      </div>`;
    box.appendChild(div);
  }
}

function toggleExItem(key){
  _exCtx.returnSel[key].checked = !_exCtx.returnSel[key].checked;
  updateExSummary();
}
function exQty(key, delta){
  const s = _exCtx.returnSel[key];
  s.qty = Math.max(1, (s.qty||1) + delta);
  const el = $("#exQty-"+key); if(el) el.textContent = s.qty;
  updateExSummary();
}

// ---- Buscador unificado (pistola Enter + texto) ----
async function scanExReplacement(){
  const input = document.getElementById("exProductSearch");
  const code = (input.value || "").trim();
  if(!code) return;

  if(!pos.catalog.length) pos.catalog = await fetchProducts();

  const found = findProductByCode(code);
  if(found){
    const p = found.product;
    const v = found.variant_id ? p.variants?.find(x=>String(x.variant_id)===String(found.variant_id)) : p.variants?.[0];
    addExReplacement({ name:p.name, variant:[v?.color,v?.talla].filter(Boolean).join(" / "), price:v?.price||p.price, qty:1, sku:v?.sku||null, variant_id:v?.variant_id||null });
    input.value = "";
    document.getElementById("exProductResults").innerHTML = "";
  } else {
    // Si no es código exacto, buscar por texto y mostrar resultados
    searchExchangeProduct();
  }
}

let _exSearchTimer = null;
function searchExchangeProduct(){
  clearTimeout(_exSearchTimer);
  _exSearchTimer = setTimeout(async () => {
    const q = (document.getElementById("exProductSearch").value || "").toLowerCase().trim();
    const box = document.getElementById("exProductResults");
    if(q.length < 2){ box.innerHTML=""; return; }

    if(!pos.catalog.length) pos.catalog = await fetchProducts();

    const results = [];
    for(const p of pos.catalog){
      const nameMatch = p.name && p.name.toLowerCase().includes(q);
      for(const v of (p.variants||[{price:p.price,sku:null,barcode:null,variant_id:null,color:null,talla:null}])){
        const skuMatch = v.sku && String(v.sku).toLowerCase().includes(q);
        const bcMatch  = v.barcode && String(v.barcode).toLowerCase().includes(q);
        if(nameMatch || skuMatch || bcMatch){
          results.push({ name:p.name, variant:[v.color,v.talla].filter(Boolean).join(" / "), price:v.price||p.price, qty:1, sku:v.sku||null, variant_id:v.variant_id||null });
        }
      }
      if(results.length >= 20) break;
    }

    box.innerHTML = "";
    for(const item of results.slice(0,20)){
      const div = document.createElement("div");
      div.className = "ex-product-result";
      div.innerHTML = `<span>${esc(item.name)}${item.variant?` <span style="color:var(--text-dim);font-size:12px">${esc(item.variant)}</span>`:""}</span><b>${money(item.price)}</b>`;
      div.onclick = () => { addExReplacement(item); document.getElementById("exProductSearch").value=""; box.innerHTML=""; };
      box.appendChild(div);
    }
    if(!results.length) box.innerHTML = `<div style="font-size:12px;color:var(--text-dim);padding:6px">Sin resultados</div>`;
  }, 250);
}

// ---- Agregar producto al reemplazo ----
function addExReplacement(item){
  const existing = _exCtx.replacement.find(r => r.variant_id && r.variant_id === item.variant_id || (!r.variant_id && r.sku && r.sku === item.sku));
  if(existing){ existing.qty = (existing.qty||1) + 1; }
  else { _exCtx.replacement.push({...item, qty:1}); }
  renderExReplacements();
  updateExSummary();
}

function removeExReplacement(i){
  _exCtx.replacement.splice(i, 1);
  renderExReplacements();
  updateExSummary();
}

function exReplQty(i, delta){
  const item = _exCtx.replacement[i];
  if(!item) return;
  item.qty = Math.max(1, (item.qty||1) + delta);
  renderExReplacements();
  updateExSummary();
}

function renderExReplacements(){
  const box = document.getElementById("exSelectedReplacement");
  if(!_exCtx.replacement.length){ box.innerHTML=""; return; }
  box.innerHTML = _exCtx.replacement.map((r,i)=>`
    <div class="ex-return-item" style="margin-bottom:6px">
      <div style="flex:1">
        <div style="font-weight:500">${esc(r.name)}</div>
        <div style="font-size:12px;color:var(--text-dim)">${esc(r.variant||"")} · ${money(r.price)}</div>
      </div>
      <div class="qty-ctrl">
        <button onclick="exReplQty(${i},-1)">−</button>
        <span>${r.qty||1}</span>
        <button onclick="exReplQty(${i},1)">+</button>
      </div>
      <button onclick="removeExReplacement(${i})" style="background:none;border:none;color:var(--text-dim);font-size:18px;cursor:pointer;padding:0 4px">×</button>
    </div>`).join("");
}

// ---- Filas de medio de pago para la diferencia ----
function renderExPaymentRows(){
  const box = document.getElementById("exPaymentRows"); if(!box) return;
  if(!pos.payments?.length){ box.innerHTML='<div style="font-size:12px;color:var(--text-dim)">Cargando medios…</div>'; return; }
  const pms = pos.payments.filter(p=>/shopify/i.test(p.name)===false);
  const opts = pms.map(p=>`<option value="${esc(p.name)}">${p.icon||''} ${esc(p.name)}</option>`).join('');
  box.innerHTML = (_exCtx.chargePayments||[]).map((row,i)=>`
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
      <select onchange="exPayRowMethod(${i},this.value)"
        style="flex:1;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;background:var(--surface);color:var(--text)">
        <option value="">— Medio —</option>
        ${pms.map(p=>`<option value="${esc(p.name)}" ${row.method===p.name?'selected':''}>${p.icon||''} ${esc(p.name)}</option>`).join('')}
      </select>
      <input type="number" min="0" value="${row.amount||''}" placeholder="$0"
        oninput="exPayRowAmount(${i},this.value)"
        style="width:110px;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;background:var(--surface);color:var(--text)">
      <button onclick="removeExPaymentRow(${i})"
        style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-dim);padding:0 4px;flex-shrink:0">×</button>
    </div>`).join('');
}
function addExPaymentRow(){
  if(!_exCtx.chargePayments) _exCtx.chargePayments = [];
  _exCtx.chargePayments.push({ method:'', amount:0 });
  renderExPaymentRows();
}
function removeExPaymentRow(i){ _exCtx.chargePayments.splice(i,1); renderExPaymentRows(); }
function exPayRowMethod(i,v){ _exCtx.chargePayments[i].method = v; }
function exPayRowAmount(i,v){ _exCtx.chargePayments[i].amount = parseFloat(v)||0; updateExSummary(); }

function updateExSummary(){
  const r = _exCtx.reason;
  const summary = document.getElementById("exPriceSummary");
  const paySection = document.getElementById("exPaymentSection");

  if(r === 'cancelacion'){
    if(summary) summary.innerHTML = '';
    if(paySection) paySection.style.display = 'none';
    return;
  }

  const retItems = Object.entries(_exCtx.returnSel)
    .filter(([,v])=>v.checked)
    .map(([key,v])=>{ const item=(_exCtx.items||[]).find(i=>(i.sku||i.name)===key); return item?{...item,qty:v.qty}:null; })
    .filter(Boolean);

  const _allItemsSum = (_exCtx.items||[]).reduce((s,i)=>s+Number(i.price)*(i.qty||1),0);
  const _priceRatio = _allItemsSum > 0 && _exCtx.saleTotal > 0 ? _exCtx.saleTotal / _allItemsSum : 1;
  let retTotal = Math.round(retItems.reduce((s,i)=>s+Number(i.price)*(i.qty||1)*_priceRatio,0));

  // Devolución: usar monto editado si existe
  if(r === 'devolucion'){
    const inp = document.getElementById("exRefundAmount");
    if(inp){
      if(!inp.dataset.userSet) inp.value = retTotal > 0 ? retTotal : '';
      const custom = parseFloat(inp.value);
      if(!isNaN(custom)) retTotal = custom;
    }
  }

  const replTotal = (r !== 'devolucion')
    ? (_exCtx.replacement||[]).reduce((s,i)=>s+Number(i.price)*(i.qty||1),0) : 0;
  const diff = replTotal - retTotal;

  // Resumen
  let html = `<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>Reembolso devolución</span><b style="color:#1d8a5e">${money(retTotal)}</b></div>`;
  if(r !== 'devolucion'){
    html += `<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>Valor reemplazo</span><b>${money(replTotal)}</b></div>`;
    if(diff > 0)      html += `<div style="display:flex;justify-content:space-between;font-weight:600"><span>Cliente paga diferencia</span><b style="color:#d97706">${money(diff)}</b></div>`;
    else if(diff < 0) html += `<div style="display:flex;justify-content:space-between;font-weight:600"><span>Saldo a favor del cliente</span><b style="color:#1d8a5e">${money(Math.abs(diff))}</b></div>`;
    else              html += `<div style="color:#1d8a5e;font-weight:600">Sin cobro adicional</div>`;
  }
  if(summary) summary.innerHTML = html;

  // Sección de pago: mostrar si hay diferencia a cobrar
  if(paySection){
    if(diff > 0){
      paySection.style.display = '';
      if(!_exCtx.chargePayments?.length){
        _exCtx.chargePayments = [{ method:'', amount: diff }];
        renderExPaymentRows();
      } else {
        // Actualizar monto del último si solo hay uno
        const rows = document.getElementById("exPaymentRows");
        if(rows && _exCtx.chargePayments.length === 1){
          const amtInput = rows.querySelector('input[type=number]');
          if(amtInput && !amtInput.dataset.userEdited) amtInput.value = diff;
          _exCtx.chargePayments[0].amount = diff;
        }
      }
    } else {
      paySection.style.display = 'none';
      _exCtx.chargePayments = [];
    }
  }
}

async function confirmExchange(){
  if(!_exCtx.saleId){ alert("Selecciona un pedido primero."); return; }
  const btn = document.getElementById("exConfirmBtn");
  btn.disabled = true; btn.textContent = "Procesando…";
  const notes = document.getElementById("exNotes")?.value.trim() || "";

  try {
    // ── Cancelación completa ──
    if(_exCtx.reason === 'cancelacion'){
      if(!confirm(`¿Cancelar el pedido ${_exCtx.orderName}? Esta acción no se puede deshacer.`)){ btn.disabled=false; btn.textContent="Confirmar"; return; }
      const r = await fetch(`${C.WORKER_URL}/refund`, { method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ shopify_order_id: _exCtx.shopifyOrderId, full: true }) });
      const d = await r.json();
      if(!d.ok){ alert("Error: "+(d.error||"desconocido")); btn.disabled=false; btn.textContent="Confirmar"; return; }
      await sbPatch(`sales?id=eq.${_exCtx.saleId}`, { status:"cancelada" });
      await sbPost("exchanges", { store:C.STORE, original_sale_id:_exCtx.saleId, original_order_name:_exCtx.orderName, reason:'cancelacion', status:'completado', notes });
      toggleExCreate(false);
      alert(`✓ Pedido ${_exCtx.orderName} cancelado.`);
      loadExchangesTab();
      return;
    }

    // ── Cambio / Garantía / Devolución ──
    const retItems = Object.entries(_exCtx.returnSel)
      .filter(([,v])=>v.checked)
      .map(([key,v])=>{ const item=(_exCtx.items||[]).find(i=>(i.sku||i.name)===key); return item?{...item,qty:v.qty}:null; })
      .filter(Boolean);

    if(!retItems.length && _exCtx.reason !== 'devolucion'){ alert("Selecciona al menos un ítem a devolver."); btn.disabled=false; btn.textContent="Confirmar"; return; }
    if(_exCtx.reason !== 'devolucion' && !_exCtx.replacement.length){ alert("Selecciona el producto de reemplazo."); btn.disabled=false; btn.textContent="Confirmar"; return; }

    // Monto real de reembolso — usa el total pagado proporcionalmente (no el precio de catálogo)
    const _allSum = (_exCtx.items||[]).reduce((s,i)=>s+Number(i.price)*(i.qty||1),0);
    const _ratio = _allSum > 0 && _exCtx.saleTotal > 0 ? _exCtx.saleTotal / _allSum : 1;
    const calcRetTotal = Math.round(retItems.reduce((s,i)=>s+Number(i.price)*(i.qty||1)*_ratio,0));
    const refundAmtInp = document.getElementById("exRefundAmount");
    const retTotal = (_exCtx.reason==='devolucion' && refundAmtInp && refundAmtInp.value)
      ? (parseFloat(refundAmtInp.value)||calcRetTotal) : calcRetTotal;

    const replTotal = (_exCtx.replacement||[]).reduce((s,i)=>s+Number(i.price)*(i.qty||1),0);
    const paymentsNote = (_exCtx.chargePayments||[]).filter(p=>p.method).map(p=>`${p.method}: ${money(p.amount)}`).join(", ");

    const chargePaymentMethod = (_exCtx.chargePayments||[]).filter(p=>p.method).map(p=>`${p.method} $${p.amount}`).join(" + ") || null;
    const r = await fetch(`${C.WORKER_URL}/exchange`, { method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ shopify_order_id:_exCtx.shopifyOrderId, original_order_name:_exCtx.orderName,
        returned_items:retItems, replacement:_exCtx.reason!=='devolucion'?_exCtx.replacement:[],
        customer:_exCtx.customer||{}, reason:_exCtx.reason, notes,
        refund_amount: retTotal,
        charge_payment: chargePaymentMethod }) });
    const d = await r.json();
    if(!d.ok){ alert("Error en Shopify: "+(d.error||"desconocido")); btn.disabled=false; btn.textContent="Confirmar"; return; }

    await sbPost("exchanges", {
      store:C.STORE, original_sale_id:_exCtx.saleId, original_order_name:_exCtx.orderName,
      new_order_name:d.new_order_name||null, new_shopify_order_id:d.new_order_id||null,
      returned_items:retItems, replacement_items:_exCtx.replacement,
      refund_amount:retTotal, charge_amount:Math.max(0,replTotal-retTotal),
      reason:_exCtx.reason, status:'completado',
      notes:[notes, paymentsNote].filter(Boolean).join(" | "),
    });

    toggleExCreate(false);
    const msg = d.new_order_name ? `✓ Cambio procesado. Nuevo pedido: ${d.new_order_name}` : `✓ Devolución procesada. Reembolso: ${money(retTotal)}`;
    alert(msg);
    loadExchangesTab();
  } catch(e){
    alert("Error: "+e);
    btn.disabled=false; btn.textContent="Confirmar";
  }
}

async function cancelSale(saleId, shopifyOrderId, orderName){
  if(!confirm(`¿Cancelar la venta ${orderName||saleId}? Esto también cancelará el pedido en Shopify.`)) return;
  const btn=event?.target; if(btn){btn.disabled=true;btn.textContent="Cancelando…";}
  try{
    if(shopifyOrderId){
      const r=await fetch(`${C.WORKER_URL}/refund`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({shopify_order_id:shopifyOrderId,full:true})});
      const d=await r.json();
      if(!d.ok){ alert("Error en Shopify: "+(d.error||"desconocido")); if(btn){btn.disabled=false;btn.textContent="Cancelar venta";} return; }
    }
    await sbPatch(`sales?id=eq.${saleId}`,{status:"cancelada"});
    loadSalesHistory();
  }catch(e){ alert("Error: "+e); if(btn){btn.disabled=false;btn.textContent="Cancelar venta";} }
}

let _refundCtx={};
function openRefundModal(saleId, shopifyOrderId, total){
  _refundCtx={saleId, shopifyOrderId, total};
  $("#refundTotal").textContent=money(total);
  $("#refundAmount").value="";
  $("#refundModal").style.display="flex";
  toggleSaleMenu(saleId);
}
function closeRefundModal(){ $("#refundModal").style.display="none"; }
async function confirmPartialRefund(){
  const amount=Number($("#refundAmount").value);
  if(!amount||amount<=0||amount>_refundCtx.total){ alert("Monto inválido"); return; }
  const btn=document.querySelector("#refundModal button:last-child");
  if(btn){btn.disabled=true;btn.textContent="Procesando…";}
  try{
    const r=await fetch(`${C.WORKER_URL}/refund`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({shopify_order_id:_refundCtx.shopifyOrderId,amount,full:false})});
    const d=await r.json();
    if(!d.ok){ alert("Error en Shopify: "+(d.error||"desconocido")); if(btn){btn.disabled=false;btn.textContent="Reembolsar";} return; }
    const nuevoTotal=_refundCtx.total-amount;
    await sbPatch(`sales?id=eq.${_refundCtx.saleId}`,{total:nuevoTotal});
    closeRefundModal();
    loadSalesHistory();
    alert(`✓ Reembolso de ${money(amount)} aplicado. Nuevo total: ${money(nuevoTotal)}`);
  }catch(e){ alert("Error: "+e); if(btn){btn.disabled=false;btn.textContent="Reembolsar";} }
}
async function invoiceAlegra(saleId){
  if(!confirm("¿Crear factura en Alegra (borrador) para esta venta?")) return;
  const sale=(await sbGet(`sales?id=eq.${saleId}`))?.[0];
  if(!sale){ alert("No se encontró la venta"); return; }
  // Si hay facturación empresa, usa esos datos; si no, usa datos del cliente
  const billing = sale.billing_detail;
  const customer = billing?.es_empresa ? {
    full_name: billing.razon_social,
    doc: billing.nit,
    doc_type: "NIT",
    email: billing.email,
    phone: billing.phone,
    address: billing.address,
    city: billing.city,
    depto: billing.depto,
    is_company: true,
  } : {
    full_name: sale.customer_name,
    doc: sale.customer_doc,
    doc_type: "CC",
    email: sale.customer_email,
    phone: sale.customer_phone,
    address: sale.customer_address,
    city: sale.customer_city,
    depto: sale.customer_depto,
    is_company: false,
  };
  const payload={ order_name: sale.shopify_order_name||null, customer, items: sale.items||[], total: sale.total||0 };
  const btn=event?.target; if(btn){ btn.textContent="⏳ Creando..."; btn.disabled=true; }
  try{
    const r=await fetch(`${C.WORKER_URL}/alegra-invoice`,{
      method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload),
    });
    const d=await r.json();
    if(d.ok){
      await sbPatch(`sales?id=eq.${saleId}`,{alegra_invoice:d.number||String(d.invoice_id)});
      alert(`✓ Factura creada en Alegra (borrador)${d.number?": "+d.number:""}`);
      loadSalesHistory();
    }else{
      alert("Error al crear factura: "+(d.error||"desconocido"));
      if(btn){ btn.textContent="<span class=\"material-symbols-outlined\" style=\"font-size:14px;vertical-align:-3px\">description</span> Crear factura Alegra"; btn.disabled=false; }
    }
  }catch(e){
    alert("No se pudo conectar con el Worker: "+e);
    if(btn){ btn.textContent="<span class=\"material-symbols-outlined\" style=\"font-size:14px;vertical-align:-3px\">description</span> Crear factura Alegra"; btn.disabled=false; }
  }
}
function invoiceSiigo(saleId){
  alert("La conexión con Siigo está pendiente. Pásame las indicaciones de la API de Siigo y la activo.");
}
async function printLabel(saleId){
  const sale=(await sbGet(`sales?id=eq.${saleId}`))?.[0];
  if(!sale){ alert("No se encontró la venta"); return; }
  // Pre-llena el modal de etiqueta
  $("#lblNombre").value = (sale.customer_name||"").toUpperCase();
  $("#lblCedula").value = sale.customer_doc||"";
  $("#lblTelefono").value = sale.customer_phone||"";
  $("#lblDireccion").value = (sale.customer_address||"").toUpperCase();
  $("#lblCiudad").value = ((sale.customer_city||"")+(sale.customer_depto?", "+sale.customer_depto:"")).toUpperCase();
  $("#lblPago").value = "CONTRAENTREGA";
  $("#labelModal").classList.add("show");
  // guarda id por si se necesita
  $("#labelModal").dataset.saleId = saleId;
}
function closeLabelModal(){ $("#labelModal").classList.remove("show"); }
function dorintLabel(){
  const w=window.open("","_blank","width=600,height=450");
  const svg=`<img src="logo-bloom.svg" style="height:60px;display:block;margin:0 auto 6px">`;
  const nombre=$("#lblNombre").value.toUpperCase();
  const cedula=$("#lblCedula").value;
  const tel=$("#lblTelefono").value;
  const dir=$("#lblDireccion").value.toUpperCase();
  const ciudad=$("#lblCiudad").value.toUpperCase();
  const pago=$("#lblPago").value;
  w.document.write(`<!DOCTYPE html><html><head><style>
    @page{size:4in 6in;margin:0}
    body{font-family:Arial,sans-serif;width:4in;height:6in;padding:14px;box-sizing:border-box;margin:0}
    .logo{text-align:center;margin-bottom:8px}
    .logo img{height:56px}
    hr{border:1px solid #000;margin:6px 0}
    .rem{font-size:9pt;margin-bottom:6px;line-height:1.5}
    .dest{font-size:11pt;font-weight:bold;line-height:1.7;margin:8px 0}
    .pago{font-size:20pt;font-weight:bold;margin:10px 0;letter-spacing:2px}
    .qr{text-align:right}
    .qr img{width:80px}
    .footer{position:absolute;bottom:14px;left:14px;right:14px;text-align:center;font-size:8pt;border-top:1px solid #000;padding-top:6px}
    .footer b{display:block;font-size:10pt}
  </style></head><body>
    <div class="logo"><img src="${window.location.origin}/logo-bloom.svg" onerror="this.outerHTML='<b style=font-size:24pt>Bloom</b>'"></div>
    <hr>
    <div class="rem">
      REMITENTE: DISDUCOR SAS<br>
      NIT: 901813269-1<br>
      DIRECCIÓN: CARRERA 34 # 46-132 Cabecera<br>
      CELULAR: 318 306 3177<br>
      CIUDAD: BUCARAMANGA, SANTANDER
    </div>
    <hr>
    <div class="dest">
      NOMBRE: ${nombre}<br>
      CÉDULA: ${cedula}<br>
      TELÉFONO: ${tel}<br>
      DIRECCIÓN: ${dir}<br>
      CIUDAD: ${ciudad}
    </div>
    <hr>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
      <div class="pago">${pago}</div>
      <div class="qr"><img src="https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=https://shopbloom.com.co" alt="QR"></div>
    </div>
    <div class="footer">
      <span>f &nbsp;IG &nbsp; BLOOM.BGA</span>
      <b>SHOPBLOOM.COM.CO</b>
    </div>
  </body></html>`);
  w.document.close();
  setTimeout(()=>w.print(), 600);
}
async function loadCustomOrders(){
  const box=$("#persTable"); if(!box) return;
  box.innerHTML='<div style="color:var(--text-dim);font-size:13px">Cargando…</div>';
  const rows=await sbGet(`custom_orders?store=eq.${C.STORE}&delivered=eq.false&order=delivery_date.asc`);
  if(!rows || !rows.length){ box.innerHTML='<div style="color:var(--text-dim);font-size:13px">No hay pedidos personalizados pendientes.</div>'; return; }
  box.innerHTML="";
  const hoy=new Date(); hoy.setHours(0,0,0,0);
  for(const o of rows){
    const fecha=o.delivery_date? new Date(o.delivery_date+"T00:00:00") : null;
    const dias = fecha? Math.ceil((fecha-hoy)/(1000*60*60*24)) : null;
    let urg=""; let urgColor="var(--text-dim)";
    if(dias!==null){
      if(dias<0){ urg=`<span class=\"material-symbols-outlined\" style=\"font-size:13px;vertical-align:-3px;color:#c0392b\">warning</span> Atrasado ${-dias}d`; urgColor="#c0392b"; }
      else if(dias===0){ urg="<span class=\"material-symbols-outlined\" style=\"font-size:13px;vertical-align:-3px;color:#c0392b\">emergency_home</span> ¡HOY!"; urgColor="#c0392b"; }
      else if(dias<=3){ urg=`<span class=\"material-symbols-outlined\" style=\"font-size:13px;vertical-align:-3px;color:#e67e22\">schedule</span> En ${dias}d`; urgColor="#e67e22"; }
      else urg=`<span class=\"material-symbols-outlined\" style=\"font-size:13px;vertical-align:-3px;color:#27ae60\">schedule</span> En ${dias}d`;
    }
    const card=el("div","pers-card");
    card.innerHTML=`
      <div class="pers-card-top">
        <div><b>${esc(o.product_name)}</b>${o.variant?` <span style="color:var(--text-dim)">(${esc(o.variant)})</span>`:""}</div>
        <div style="color:${urgColor};font-weight:600;font-size:12px">${urg}</div>
      </div>
      <div class="pers-card-row"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px">person</span> ${esc(o.customer_name||"—")}</div>
      <div class="pers-card-row"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px">phone_iphone</span> ${esc(o.customer_phone||"—")}</div>
      <div class="pers-card-row"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px">calendar_month</span> Entrega: <b>${o.delivery_date||"—"}</b> · <span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px">payments</span> ${money(o.price)}</div>
      <div style="margin:8px 0 4px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:12px;color:var(--text-dim)">Detalle personalización:</span>
        <button class="tag-add" style="font-size:12px" onclick="togglePersEdit('${o.id}')"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px">edit</span> Editar</button>
      </div>
      <div id="persNoteText-${o.id}" style="font-size:13px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:9px;min-height:36px;white-space:pre-wrap;word-break:break-word">${esc(o.notes||"Sin detalle")}</div>
      <div id="persNoteEdit-${o.id}" style="display:none">
        <textarea id="persNote-${o.id}" class="pers-detail-edit" style="margin-top:6px">${esc(o.notes||"")}</textarea>
        <button class="pers-save-note" style="margin-top:6px;width:100%" onclick="savePersNote('${o.id}')">💾 Guardar detalle</button>
      </div>
      <div style="margin-top:8px">
        <button class="pers-deliver" style="width:100%" onclick="markDelivered('${o.id}')">✓ Entregado</button>
      </div>`;
    box.appendChild(card);
  }
}
function togglePersEdit(id){
  const editDiv=document.getElementById("persNoteEdit-"+id);
  const textDiv=document.getElementById("persNoteText-"+id);
  if(!editDiv||!textDiv) return;
  const isOpen=editDiv.style.display!=="none";
  editDiv.style.display=isOpen?"none":"block";
  textDiv.style.display=isOpen?"block":"none";
  if(!isOpen) document.getElementById("persNote-"+id)?.focus();
}
async function savePersNote(id){
  const ta=document.getElementById("persNote-"+id);
  if(!ta) return;
  const txt=ta.value;
  await sbPatch(`custom_orders?id=eq.${id}`,{notes:txt});
  const textDiv=document.getElementById("persNoteText-"+id);
  if(textDiv){ textDiv.textContent=txt||"Sin detalle"; textDiv.style.display="block"; }
  const editDiv=document.getElementById("persNoteEdit-"+id);
  if(editDiv) editDiv.style.display="none";
}
async function markDelivered(id){
  if(!confirm("¿Marcar como entregado? Se quitará de la lista.")) return;
  await sbPatch(`custom_orders?id=eq.${id}`,{delivered:true});
  loadCustomOrders();
}

// ====================================================================
//  CHAT DEL EQUIPO (interno, usa cajeros/vendedores)
// ====================================================================
async function initTeam(){
  if(!pos.teamAuthor && pos.cashier){ pos.teamAuthor={type:"cajero", id:pos.cashier.id, name:pos.cashier.name}; }
  if(!pos.cashiers.length) await loadCashiers();
  if(!pos.sellers.length) await loadSellers();
  renderTeamWho();
  await loadTeamMsgs();
  await loadTeamSalesStrip();
  buildEmojiPicker();
  startTeamPolling();
}

// ---------- WebSocket en tiempo real para chats WhatsApp ----------
let _waSocket=null, _waSocketRetry=null;
function startWaPolling(){
  _connectWaSocket();
}
function _connectWaSocket(){
  if(_waSocketRetry){ clearTimeout(_waSocketRetry); _waSocketRetry=null; }
  const wsUrl=C.WORKER_URL.replace(/^https?/,"wss")+"/ws";
  try {
    _waSocket=new WebSocket(wsUrl);
  } catch(e){ _waSocketRetry=setTimeout(_connectWaSocket,5000); return; }

  _waSocket.onmessage=async(e)=>{
    let data; try{ data=JSON.parse(e.data); }catch{ return; }
    if(data.type==="new_message"){
      const phone=data.phone;
      // Actualiza o crea conversación en estado local
      const existing=state.chats.get(phone);
      state.chats.set(phone,{
        ...(existing||{phone,name:phone,stage:"nueva",pipeline_id:null,tags:[],ref_source_type:null,ref_headline:null,ref_body:null,ref_media_url:null,status:"open"}),
        last:data.body||"", lastAt:data.ts||new Date().toISOString(),
        unread: state.active===phone ? 0 : ((existing?.unread||0)+1),
      });
      renderChatList();
      if(_boardMode) renderBoard();
      // Actualiza banner de ventana si el chat está abierto
      if(state.active===phone) renderWindowBanner(phone);
      // Si el chat está abierto, carga el mensaje nuevo
      if(state.active===phone){
        const convId=state.chats.get(phone)?.id||phone;
        const msgs=await fetch(`${C.WORKER_URL}/wa/conversations/${encodeURIComponent(convId)}/messages`).then(r=>r.json()).catch(()=>[]);
        state.messages=msgs.map(m=>({
          body:m.body||"", direction:m.direction==="outbound"?"out":"in",
          created_at:m.ts||m.created_at, msg_type:m.type||"text", media_url:m.media_url||null,
          status:m.status||"sent",
        }));
        renderMessages();
      }
    }
  };
  _waSocket.onclose=()=>{ _waSocketRetry=setTimeout(_connectWaSocket,4000); };
  _waSocket.onerror=()=>{ _waSocket.close(); };
}

// Carga automática: refresca mientras estés en el chat (cada 3s)
let _teamPoll=null, _lastMsgCount=0;
function startTeamPolling(){
  if(_teamPoll) clearInterval(_teamPoll);
  _teamPoll=setInterval(async()=>{
    if(getCurrentScreen()!=="equipo"){ return; }
    await loadTeamMsgs();
    await checkTyping();
  }, 3000);
}

// ----- Emojis -----
const EMOJIS=["😀","😂","🥰","😍","😘","😎","🤩","😉","🙂","😅","😊","👍","👏","🙏","💪","🔥","✨","🎉","❤️","💛","💙","💚","💜","🧡","🤍","💯","✅","❌","⚠️","👙","👗","🩱","👚","🛍️","💰","💵","📦","🚚","📸","💬","👀","🙌","🤝","😢","😭","😡","🤔","👋"];
function buildEmojiPicker(){
  const box=$("#emojiPicker"); if(!box || box.dataset.built) return;
  box.innerHTML=EMOJIS.map(e=>`<span onclick="addEmoji('${e}')">${e}</span>`).join("");
  box.dataset.built="1";
}
function toggleEmojiPicker(){ $("#emojiPicker").classList.toggle("show"); }
function togglePlusMenu(){ $("#plusMenu").classList.toggle("show"); $("#emojiPicker").classList.remove("show"); }
function closePlusMenu(){ $("#plusMenu").classList.remove("show"); }
function addEmoji(e){
  const inp=$("#teamText"); inp.value+=e; inp.focus();
}

// ----- "Está escribiendo..." -----
let _typingTimer=null;
let _lastTyping=0;
async function onTeamTyping(){
  if(!pos.teamAuthor) return;
  const now=Date.now();
  if(now-_lastTyping<1500) return;  // máximo cada 1.5s
  _lastTyping=now;
  try{
    await fetch(`${SB.url}/rest/v1/team_typing?on_conflict=name,store`,{
      method:"POST",
      headers:{ apikey:SB.key, Authorization:`Bearer ${SB.key}`, "Content-Type":"application/json", Prefer:"resolution=merge-duplicates" },
      body:JSON.stringify({ name:pos.teamAuthor.name, store:C.STORE, at:new Date().toISOString() }),
    }).catch(()=>{});
  }catch(e){}
}
async function checkTyping(){
  const line=$("#teamTyping"); if(!line) return;
  try{
    const hace4s=new Date(Date.now()-4000).toISOString();
    const rows=await sbGet(`team_typing?store=eq.${C.STORE}&at=gte.${hace4s}`);
    const otros=(rows||[]).filter(r=>r.name!==pos.teamAuthor?.name).map(r=>r.name);
    const unicos=[...new Set(otros)];
    if(unicos.length===1) line.textContent=`${unicos[0]} está escribiendo…`;
    else if(unicos.length>1) line.textContent=`${unicos.length} personas escribiendo…`;
    else line.textContent="";
  }catch(e){ line.textContent=""; }
}
async function loadTeamSalesStrip(){
  const box=$("#teamSalesStrip"); if(!box) return;
  const todayStart=new Date(); todayStart.setHours(0,0,0,0);
  const todayEnd=new Date(); todayEnd.setHours(23,59,59,999);
  const rows=await sbGet(`sales?store=eq.${C.STORE}&status=eq.completada&created_at=gte.${todayStart.toISOString()}&created_at=lte.${todayEnd.toISOString()}&order=created_at.desc&limit=12&select=id,total,customer_name,created_at`);
  box.innerHTML="";
  if(!rows||!rows.length){ box.style.display="none"; return; }
  box.style.display="flex";
  const lbl=el("div"); lbl.style.cssText="font-size:10px;color:var(--text-dim);align-self:center;flex-shrink:0"; lbl.textContent="Comentar venta:";
  box.appendChild(lbl);
  for(const s of rows){
    const chip=el("div","team-sale-chip");
    const t=new Date(s.created_at).toLocaleDateString("es-CO",{day:"2-digit",month:"2-digit"});
    chip.textContent=`${money(s.total)} · ${s.customer_name||"—"} · ${t}`;
    chip.onclick=()=>commentSale(s.id, `${money(s.total)} de ${s.customer_name||"cliente"}`);
    box.appendChild(chip);
  }
}
async function commentSale(saleId, label){
  if(!pos.teamAuthor){ alert("Inicia sesión para escribir en el chat."); return; }
  const txt=prompt(`Comentario sobre la venta (${label}):`);
  if(!txt || !txt.trim()) return;
  await sbPost("team_messages",{
    author_type:pos.teamAuthor.type, author_id:pos.teamAuthor.id,
    author_name:pos.teamAuthor.name, body:`[${label}] ${txt.trim()}`, sale_id:saleId, store:C.STORE,
  });
  await loadTeamMsgs();
}
function getCurrentScreen(){
  for(const s of ["chats","pos","equipo","datos","config"]){
    const el=document.getElementById("nav-"+s);
    if(el && el.classList.contains("on")) return s;
  }
  return "chats";
}
function renderTeamWho(){
  const w=$("#teamWho");
  if(w) w.textContent = pos.teamAuthor ? `Escribes como: ${pos.teamAuthor.name}` : "Escribes como: —";
}
async function loadTeamMsgs(){
  const rows=await sbGet(`team_messages?store=eq.${C.STORE}&order=created_at.asc&limit=200`);
  const arr=rows||[];
  // firma simple para detectar cambios (cantidad + último id)
  const sig=arr.length+":"+(arr[arr.length-1]?.id||"");
  if(sig===_lastMsgSig) return;  // sin cambios, no re-renderiza (evita parpadeo)
  _lastMsgSig=sig;
  renderTeamMsgs(arr);
}
let _lastMsgSig="";
function renderTeamMsgs(rows){
  const box=$("#teamMsgs"); if(!box) return;
  box.innerHTML="";
  for(const m of rows){
    if(m.sale_id && !m.media_url){
      const d=el("div","tm-sale");
      d.innerHTML=`💬 <b>${esc(m.author_name)}</b> sobre venta: ${esc(m.body)} <span class="tm-del" onclick="deleteTeamMsg('${m.id}',null)">🗑</span>`;
      box.appendChild(d); continue;
    }
    const mine = pos.teamAuthor && m.author_name===pos.teamAuthor.name;
    const d=el("div","tm"+(mine?" mine":""));
    const t=new Date(m.created_at).toLocaleTimeString("es-CO",{hour:"2-digit",minute:"2-digit"});
    let media="";
    if(m.media_url && m.media_type==="image"){
      media=`<img class="tm-photo" src="${esc(m.media_url)}" onclick="window.open('${esc(m.media_url)}','_blank')">`;
    }else if(m.media_url && m.media_type==="audio"){
      media=`<audio controls src="${esc(m.media_url)}"></audio>`;
    }
    const delBtn=`<span class="tm-del" onclick="deleteTeamMsg('${m.id}','${m.media_path||""}')">🗑</span>`;
    d.innerHTML=`<div class="who">${esc(m.author_name)} ${delBtn}</div>${m.body?`<div class="bd">${esc(m.body)}</div>`:""}${media}<div class="tm-time">${t}</div>`;
    box.appendChild(d);
  }
  box.scrollTop=box.scrollHeight;
}

// Borrar mensaje (y su archivo del Storage si tiene)
async function deleteTeamMsg(id, mediaPath){
  if(!confirm("¿Borrar este mensaje?")) return;
  // 1) borra el archivo del Storage si es foto/audio
  if(mediaPath){
    try{
      await fetch(`${SB.url}/storage/v1/object/${mediaPath}`,{
        method:"DELETE",
        headers:{ apikey:SB.key, Authorization:`Bearer ${SB.key}` },
      });
    }catch(e){ console.warn("No se pudo borrar el archivo:",e); }
  }
  // 2) borra el mensaje de la base
  await fetch(`${SB.url}/rest/v1/team_messages?id=eq.${id}`,{
    method:"DELETE",
    headers:{ apikey:SB.key, Authorization:`Bearer ${SB.key}` },
  });
  await loadTeamMsgs();
}

// ----- Adjuntar FOTO -----
function attachTeamPhoto(){
  if(!pos.teamAuthor){ alert("Inicia sesión para escribir en el chat."); return; }
  const input=document.createElement("input");
  input.type="file"; input.accept="image/*";
  input.onchange=async()=>{
    const file=input.files[0]; if(!file)return;
    const up=await sbUpload("team-chat", file, (file.name.split(".").pop()||"jpg"));
    if(!up){ alert("No se pudo subir la foto"); return; }
    await sbPost("team_messages",{
      author_type:pos.teamAuthor.type, author_id:pos.teamAuthor.id, author_name:pos.teamAuthor.name,
      body:"", media_url:up.url, media_type:"image", media_path:up.storagePath, store:C.STORE,
    });
    await loadTeamMsgs();
  };
  input.click();
}

// ----- Grabar NOTA DE VOZ -----
let mediaRecorder=null, audioChunks=[];
async function toggleVoice(){
  if(!pos.teamAuthor){ alert("Inicia sesión para escribir en el chat."); return; }
  const btn=$("#voiceBtn");
  if(mediaRecorder && mediaRecorder.state==="recording"){
    mediaRecorder.stop(); return;
  }
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    // Detecta el formato que soporta el dispositivo (iPhone usa mp4, Android/PC webm)
    let mime="", ext="webm";
    if(MediaRecorder.isTypeSupported("audio/webm")){ mime="audio/webm"; ext="webm"; }
    else if(MediaRecorder.isTypeSupported("audio/mp4")){ mime="audio/mp4"; ext="mp4"; }
    else if(MediaRecorder.isTypeSupported("audio/aac")){ mime="audio/aac"; ext="aac"; }
    else { mime=""; ext="m4a"; }  // deja que el navegador elija

    mediaRecorder = mime ? new MediaRecorder(stream,{mimeType:mime}) : new MediaRecorder(stream);
    audioChunks=[];
    mediaRecorder.ondataavailable=e=>{ if(e.data.size>0) audioChunks.push(e.data); };
    mediaRecorder.onstop=async()=>{
      btn.classList.remove("rec"); btn.textContent="🎤";
      stream.getTracks().forEach(t=>t.stop());
      const realType = mediaRecorder.mimeType || mime || "audio/mp4";
      const realExt = realType.includes("webm")?"webm":realType.includes("mp4")?"mp4":realType.includes("aac")?"aac":"m4a";
      const blob=new Blob(audioChunks,{type:realType});
      if(blob.size===0){ alert("La grabación quedó vacía. Intenta de nuevo."); return; }
      const up=await sbUpload("team-chat", blob, realExt);
      if(!up) return; // sbUpload ya muestra el error específico
      await sbPost("team_messages",{
        author_type:pos.teamAuthor.type, author_id:pos.teamAuthor.id, author_name:pos.teamAuthor.name,
        body:"", media_url:up.url, media_type:"audio", media_path:up.storagePath, store:C.STORE,
      });
      await loadTeamMsgs();
    };
    mediaRecorder.start();
    btn.classList.add("rec"); btn.textContent="⏹";
  }catch(e){
    console.error(e);
    alert("No se pudo acceder al micrófono. Revisa el permiso en el navegador del celular.");
  }
}
async function sendTeamMsg(){
  const inp=$("#teamText"); const body=(inp.value||"").trim();
  if(!body) return;
  if(!pos.teamAuthor){ alert("Inicia sesión para escribir en el chat."); return; }
  inp.value="";
  await sbPost("team_messages",{
    author_type:pos.teamAuthor.type, author_id:pos.teamAuthor.id,
    author_name:pos.teamAuthor.name, body, store:C.STORE,
  });
  await loadTeamMsgs();
}

// ════════════════════════════════════════════════════════
// SISTEMA DE USUARIOS (login unificado vendedor/cajero)
// ════════════════════════════════════════════════════════

let _loginPending = null;

function showLoginModal(){
  const loginables = (pos.users||[]).filter(u=>u.is_cashier||u.is_master);
  if(!loginables.length) return;
  const grid = $("#loginGrid");
  grid.style.gridTemplateColumns = loginables.length <= 2 ? "1fr 1fr" : "repeat(3,1fr)";
  grid.innerHTML = "";
  for(const u of loginables){
    const ini = u.name.trim().split(/\s+/).map(w=>w[0]).join("").substring(0,2).toUpperCase();
    const badge = [u.is_master?"Master":null, u.is_cashier?"Cajero":null].filter(Boolean).join(" · ");
    const avatarInner = u.photo_url
      ? `<img src="${esc(u.photo_url)}" alt="${esc(u.name)}">`
      : ini;
    const card = el("div","login-card");
    card.innerHTML = `
      <div class="login-avatar">${avatarInner}</div>
      <div class="login-name">${esc(u.name)}</div>
      <div class="login-badge">${badge}</div>`;
    card.onclick = ()=>selectLoginUser(u);
    grid.appendChild(card);
  }
  $("#loginPinSec").style.display = "none";
  $("#loginModal").style.display = "flex";
}

async function setUserPhoto(id){
  const dataUrl = await pickImage(200); if(!dataUrl) return;
  await sbPatch(`sellers?id=eq.${id}`,{photo_url:dataUrl});
  await loadUsers(); await renderUsersList();
}
async function setLoginPhoto(id){
  const dataUrl = await pickImage(200); if(!dataUrl) return;
  await sbPatch(`sellers?id=eq.${id}`,{photo_url:dataUrl});
  await loadUsers(); showLoginModal();
}
function selectLoginUser(u){
  _loginPending = u;
  document.querySelectorAll(".login-card").forEach(c=>c.classList.remove("sel"));
  event.currentTarget.classList.add("sel");
  if(u.pin){
    $("#loginPinMsg").textContent = `Clave de ${u.name}`;
    $("#loginPinInput").value = "";
    $("#loginPinSec").style.display = "block";
    setTimeout(()=>{ const inp=$("#loginPinInput"); if(inp) inp.focus(); },100);
  } else {
    loginUser(u);
  }
}

function backToLoginGrid(){
  $("#loginPinSec").style.display = "none";
  _loginPending = null;
  document.querySelectorAll(".login-card").forEach(c=>c.classList.remove("sel"));
}

function confirmLoginPin(){
  if(!_loginPending) return;
  const entered = ($("#loginPinInput").value||"").trim();
  if(entered !== String(_loginPending.pin)){
    alert("PIN incorrecto"); $("#loginPinInput").value=""; return;
  }
  loginUser(_loginPending);
}

function loginUser(u){
  pos.currentUser = u;
  if(u.is_cashier || u.is_master){
    pos.cashier = { id:u.id, name:u.name, require_pin:!!u.pin, pin:u.pin };
    renderCashierBtn();
  }
  pos.teamAuthor = { type: u.is_master?"master":"cajero", id:u.id, name:u.name };
  renderTeamWho();
  try{ localStorage.setItem("bloom_current_user_id", u.id); }catch(e){}
  $("#loginModal").style.display = "none";
  _loginPending = null;
  renderChatList(); // actualiza resaltado de conversaciones propias
}

function skipLogin(){
  pos.currentUser = null;
  try{ localStorage.removeItem("bloom_current_user_id"); }catch(e){}
  $("#loginModal").style.display = "none";
  _loginPending = null;
}

async function restoreSession(){
  let savedId; try{ savedId=localStorage.getItem("bloom_current_user_id"); }catch(e){}
  if(!savedId) return false;
  const u = (pos.users||[]).find(u=>u.id===savedId);
  if(!u) return false;
  loginUser(u); return true;
}

// ─── Config: Usuarios ────────────────────────────────────────────────────────

async function renderUsersList(){
  const box=$("#usersList"); if(!box) return;
  const all = await sbGet(`sellers?store=eq.${C.STORE}&order=name.asc`) || [];
  box.innerHTML="";
  for(const u of all){
    const row=el("div","cfg-row");
    row.dataset.uid = u.id;
    const ini = u.name.trim().split(/\s+/).map(w=>w[0]).join("").substring(0,2).toUpperCase();
    const roles = [
      '<span class="role-chip seller">Vendedor</span>',
      u.is_cashier?'<span class="role-chip cashier">Cajero</span>':'',
      u.is_master?'<span class="role-chip master">Master</span>':'',
    ].join("");
    const avatarHtml = u.photo_url
      ? `<img src="${esc(u.photo_url)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0">`
      : `<div class="login-avatar" style="width:36px;height:36px;font-size:13px;flex-shrink:0">${ini}</div>`;
    row.innerHTML=`${avatarHtml}
      <span style="flex:1;min-width:0">
        <span style="font-weight:600;font-size:13px">${esc(u.name)}</span>
        <span class="user-roles" id="roles-${u.id}" style="display:block">${roles}</span>
      </span>
      <span class="cfg-photo" onclick="editUser('${u.id}')" title="Editar">
        <span class="material-symbols-outlined" style="font-size:16px">edit</span>
      </span>
      ${pos.currentUser?.is_master
        ? `<span class="cfg-photo" onclick="toggleRoleEditor('${u.id}',${!!u.is_cashier},${!!u.is_master})" title="Editar roles">
             <span class="material-symbols-outlined" style="font-size:16px">manage_accounts</span>
           </span>`
        : ''}
      ${u.active
        ? `<span class="del" onclick="deactivateUser('${u.id}','${esc(u.name)}')" title="Desactivar" style="color:#e67e22">
             <span class="material-symbols-outlined" style="font-size:16px">person_off</span>
           </span>`
        : `<span class="del" onclick="activateUser('${u.id}','${esc(u.name)}')" title="Activar" style="color:#27ae60">
             <span class="material-symbols-outlined" style="font-size:16px">person_add</span>
           </span>`
      }
      <span class="del" onclick="deleteUser('${u.id}')" title="Eliminar">
        <span class="material-symbols-outlined" style="font-size:16px">delete</span>
      </span>`;
    if(!u.active) row.style.opacity="0.45";
    box.appendChild(row);
  }
}

async function addUser(){
  const name=($("#newUserName").value||"").trim(); if(!name) return;
  const pinRaw=($("#newUserPin").value||"").trim();
  const isSeller=$("#nuSeller").checked;
  const isCashier=$("#nuCashier").checked;
  const isMaster=$("#nuMaster").checked;
  if((isCashier||isMaster) && pinRaw && pinRaw.replace(/\D/g,"").length!==4){
    alert("El PIN debe ser de exactamente 4 dígitos"); return;
  }
  const pin = (isCashier||isMaster) && pinRaw ? pinRaw.replace(/\D/g,"").slice(0,4) : null;
  await sbPost("sellers",{name,store:C.STORE,pin,is_cashier:isCashier,is_master:isMaster});
  $("#newUserName").value=""; $("#newUserPin").value="";
  $("#nuSeller").checked=true; $("#nuCashier").checked=false; $("#nuMaster").checked=false;
  await loadUsers(); await renderUsersList();
}

async function setUserPin(id,name){
  const usar=confirm(`¿${name} usará PIN de 4 dígitos?\nAceptar=sí | Cancelar=quitar PIN`);
  if(!usar){
    await sbPatch(`sellers?id=eq.${id}`,{pin:null});
    await renderUsersList(); return;
  }
  const pin=prompt(`PIN de 4 dígitos para ${name}:`);
  if(pin===null) return;
  const clean=String(pin).replace(/\D/g,"").slice(0,4);
  if(clean.length!==4){ alert("Debe ser exactamente 4 dígitos"); return; }
  await sbPatch(`sellers?id=eq.${id}`,{pin:clean});
  await loadUsers(); await renderUsersList();
}

async function deactivateUser(id,name){
  await sbPatch(`sellers?id=eq.${id}`,{active:false});
  await loadUsers(); await renderUsersList();
}

async function activateUser(id,name){
  await sbPatch(`sellers?id=eq.${id}`,{active:true});
  await loadUsers(); await renderUsersList();
}
function toggleRoleEditor(id, isCashier, isMaster){
  const span = $(`#roles-${id}`); if(!span) return;
  if(span.querySelector('.role-editor')){ renderUsersList(); return; }
  span.innerHTML=`<span class="role-editor" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
    <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer">
      <input type="checkbox" id="re-cashier-${id}" ${isCashier?'checked':''}> Cajero
    </label>
    <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer">
      <input type="checkbox" id="re-master-${id}" ${isMaster?'checked':''}> Master
    </label>
    <button onclick="saveUserRoles('${id}')" style="font-size:11px;padding:2px 8px;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer">Guardar</button>
  </span>`;
}
async function saveUserRoles(id){
  const c=!!($(`#re-cashier-${id}`)?.checked);
  const m=!!($(`#re-master-${id}`)?.checked);
  await sbPatch(`sellers?id=eq.${id}`,{is_cashier:c,is_master:m});
  await loadUsers(); await renderUsersList();
}
function _getUserRow(id){ return $("#usersList")?.querySelector(`.cfg-row[data-uid="${id}"]`); }
function _clearInlinePanel(){ $("#usersList")?.querySelectorAll(".inline-panel").forEach(e=>e.remove()); }

function deleteUser(id){
  _clearInlinePanel();
  const row=_getUserRow(id); if(!row) return;
  const panel=document.createElement("div");
  panel.className="inline-panel";
  panel.style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#fdecea;border-radius:8px;margin-top:4px;font-size:13px;flex-wrap:wrap";
  panel.innerHTML=`<span style="flex:1;font-size:12px">Si tiene ventas se desactivará. Si no tiene ventas se eliminará.</span>
    <button onclick="confirmDeleteUser('${id}')" style="background:#e74c3c;color:#fff;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-weight:600">Confirmar</button>
    <button onclick="_clearInlinePanel()" style="background:none;border:1px solid var(--border);padding:6px 12px;border-radius:6px;cursor:pointer">Cancelar</button>`;
  row.after(panel);
}
async function confirmDeleteUser(id){
  _clearInlinePanel();
  // No se puede borrar si tiene ventas asociadas — se desactiva en su lugar
  const r = await sbDelete(`sellers?id=eq.${id}`);
  if(r.status===200||r.status===204){
    await loadUsers(); await renderUsersList();
  } else {
    // FK violation: tiene ventas, solo desactivar
    await sbPatch(`sellers?id=eq.${id}`,{active:false});
    await loadUsers(); await renderUsersList();
  }
}

function editUser(id){
  _clearInlinePanel();
  const row=_getUserRow(id); if(!row) return;
  const u=(pos.users||[]).find(u=>u.id===id)||{};
  const panel=document.createElement("div");
  panel.className="inline-panel";
  panel.style="padding:10px;background:var(--bg-alt);border-radius:8px;margin-top:4px;display:flex;flex-direction:column;gap:8px";
  panel.innerHTML=`<input id="editUserName" value="${esc(u.name||'')}" placeholder="Nombre" style="width:100%">
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button onclick="saveEditUser('${id}')" style="flex:1;font-weight:600">
        <span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px">save</span> Guardar
      </button>
      ${u.photo_url?`<button onclick="removeUserPhoto('${id}')" style="flex:1;background:none;border:1px solid var(--border);color:#e74c3c">
        <span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px">no_photography</span> Quitar foto
      </button>`:''}
      <button onclick="setUserPhoto('${id}')" style="flex:1;background:none;border:1px solid var(--border)">
        <span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px">photo_camera</span> ${u.photo_url?'Cambiar foto':'Agregar foto'}
      </button>
      <button onclick="_clearInlinePanel()" style="background:none;border:1px solid var(--border);padding:6px 12px;border-radius:6px;cursor:pointer">Cancelar</button>
    </div>`;
  row.after(panel);
  $("#editUserName")?.focus();
}
async function saveEditUser(id){
  const name=($("#editUserName")?.value||"").trim(); if(!name) return;
  await sbPatch(`sellers?id=eq.${id}`,{name});
  _clearInlinePanel();
  await loadUsers(); await renderUsersList();
}
async function removeUserPhoto(id){
  await sbPatch(`sellers?id=eq.${id}`,{photo_url:null});
  _clearInlinePanel();
  await loadUsers(); await renderUsersList();
}

function renderSellersList(){
  const box=$("#sellersList"); box.innerHTML="";
  for(const s of pos.sellers){
    const row=el("div","cfg-row");
    const avatar = s.photo_url
      ? `<img src="${esc(s.photo_url)}" class="cfg-avatar">`
      : `<span class="ic">👤</span>`;
    row.innerHTML=`${avatar}<span class="nm">${esc(s.name)}</span>
      <span class="cfg-photo" onclick="setSellerPhoto('${s.id}')" title="Cambiar foto">📷</span>
      <span class="del" onclick="delSeller('${s.id}','${esc(s.name)}')">🗑</span>`;
    box.appendChild(row);
  }
}
async function addSeller(){
  const name=$("#newSeller").value.trim(); if(!name)return;
  await sbPost("sellers",{name,store:C.STORE});
  $("#newSeller").value=""; await loadSellers(); renderSellersList();
}
async function setSellerPhoto(id){
  const dataUrl=await pickImage(160);
  if(!dataUrl)return;
  await sbPatch(`sellers?id=eq.${id}`,{photo_url:dataUrl});
  await loadSellers(); renderSellersList();
}
async function delSeller(id,name){
  if(!confirm(`¿Quitar a ${name}?`))return;
  await sbPatch(`sellers?id=eq.${id}`,{active:false});
  await loadSellers(); renderSellersList();
}

// ---- Config: métodos de pago ----
function renderPaymentsList(){
  const box=$("#paymentsList"); box.innerHTML="";
  for(const p of pos.payments){
    const row=el("div","cfg-row");
    const ic = p.icon_url
      ? `<img src="${esc(p.icon_url)}" class="cfg-avatar">`
      : `<span class="ic">${p.icon||"💳"}</span>`;
    row.innerHTML=`${ic}<span class="nm">${esc(p.name)}</span>
      <span class="cfg-photo" onclick="renamePayment('${p.id}','${esc(p.name)}')" title="Renombrar">✏️</span>
      <span class="cfg-photo" onclick="setPaymentIcon('${p.id}')" title="Cambiar ícono">🖼️</span>
      <span class="del" onclick="delPayment('${p.id}','${esc(p.name)}')">🗑</span>`;
    box.appendChild(row);
  }
}
async function addPayment(){
  const name=$("#newPayment").value.trim(); if(!name)return;
  await sbPost("payment_methods",{name,icon:"💳",position:pos.payments.length,store:C.STORE});
  $("#newPayment").value=""; await loadPayments(); renderPaymentsList();
}
async function renamePayment(id, currentName){
  const name = prompt("Nuevo nombre:", currentName);
  if(!name || name.trim()===currentName) return;
  await sbPatch(`payment_methods?id=eq.${id}`, {name: name.trim()});
  await loadPayments(); renderPaymentsList();
  renderPayGrid();
}
async function setPaymentIcon(id){
  const dataUrl=await pickImage(100);
  if(!dataUrl)return;
  await sbPatch(`payment_methods?id=eq.${id}`,{icon_url:dataUrl});
  await loadPayments(); renderPaymentsList();
}
async function delPayment(id,name){
  if(!confirm(`¿Quitar ${name}?`))return;
  await sbPatch(`payment_methods?id=eq.${id}`,{active:false});
  await loadPayments(); renderPaymentsList();
}

// ---- Config: cajeros ----
function renderCashiersList(){
  const box=$("#cashiersList"); if(!box) return; box.innerHTML="";
  for(const c of pos.cashiers){
    const row=el("div","cfg-row");
    const avatar = c.photo_url?`<img src="${esc(c.photo_url)}" class="cfg-avatar">`:`<span class="ic">🧑‍💼</span>`;
    const pinState = c.require_pin ? `🔒 clave activa` : `🔓 sin clave`;
    row.innerHTML=`${avatar}<span class="nm">${esc(c.name)}</span>
      <span style="font-size:11px;color:var(--text-dim);margin-right:6px">${pinState}</span>
      <span class="cfg-photo" onclick="setCashierPhoto('${c.id}')" title="Foto">📷</span>
      <span class="cfg-photo" onclick="setCashierPin('${c.id}','${esc(c.name)}')" title="Clave">🔑</span>
      <span class="del" onclick="delCashier('${c.id}','${esc(c.name)}')">🗑</span>`;
    box.appendChild(row);
  }
}
async function addCashier(){
  const name=$("#newCashier").value.trim(); if(!name)return;
  await sbPost("cashiers",{name,store:C.STORE});
  $("#newCashier").value=""; await loadCashiers(); renderCashiersList();
}
async function setCashierPhoto(id){
  const dataUrl=await pickImage(160); if(!dataUrl)return;
  await sbPatch(`cashiers?id=eq.${id}`,{photo_url:dataUrl});
  await loadCashiers(); renderCashiersList();
}
async function setCashierPin(id,name){
  const usar=confirm(`¿${name} usará clave de 4 dígitos?\n\nAceptar = sí, pedir clave\nCancelar = sin clave`);
  if(!usar){
    await sbPatch(`cashiers?id=eq.${id}`,{require_pin:false, pin:null});
    await loadCashiers(); renderCashiersList(); return;
  }
  const pin=prompt(`Clave de 4 dígitos para ${name}:`);
  if(pin===null) return;
  const clean=String(pin).replace(/\D/g,"").slice(0,4);
  if(clean.length!==4){ alert("La clave debe ser de 4 dígitos"); return; }
  await sbPatch(`cashiers?id=eq.${id}`,{require_pin:true, pin:clean});
  await loadCashiers(); renderCashiersList();
}
async function delCashier(id,name){
  if(!confirm(`¿Quitar a ${name}?`))return;
  await sbPatch(`cashiers?id=eq.${id}`,{active:false});
  await loadCashiers(); renderCashiersList();
}

// ---- Config: reporte de ventas por vendedor ----
function setReportRange(range,btn){
  document.querySelectorAll(".rep-filter button").forEach(b=>b.classList.remove("on"));
  btn.classList.add("on");
  const cw=$("#customRangeWrap");
  if(range==="custom"){ cw.style.display="flex"; }
  else { cw.style.display="none"; }
  loadReport(range);
}
async function loadReport(range){
  if(!pos.payments?.length) await loadPayments();
  const now=new Date(); let from=new Date(), to=new Date();
  to.setHours(23,59,59,999);
  if(range==="today"){ from.setHours(0,0,0,0); }
  else if(range==="week"){ from.setDate(now.getDate()-7); from.setHours(0,0,0,0); }
  else if(range==="month"){ from=new Date(now.getFullYear(),now.getMonth(),1); }
  else if(range==="year"){ from=new Date(now.getFullYear(),0,1); }
  else if(range==="custom"){
    const f=$("#customFrom")?.value, t=$("#customTo")?.value;
    if(!f||!t) return;
    from=new Date(f+"T00:00:00"); to=new Date(t+"T23:59:59");
  }
  const rows=await sbGet(`sales?store=eq.${C.STORE}&status=eq.completada&created_at=gte.${from.toISOString()}&created_at=lte.${to.toISOString()}&select=seller_name,total,payment_method,payment_detail,items,customer_name,sale_type`);

  // --- Ventas por vendedor ---
  const byseller={};
  for(const s of rows){
    const n=s.seller_name||"—";
    if(!byseller[n])byseller[n]={count:0,total:0};
    byseller[n].count++; byseller[n].total+=Number(s.total||0);
  }
  const grid=$("#reportGrid"); if(grid){ grid.innerHTML="";
    const entries=Object.entries(byseller).sort((a,b)=>b[1].total-a[1].total);
    if(!entries.length){grid.innerHTML='<div style="color:var(--text-dim);font-size:13px">Sin ventas en este periodo</div>';}
    else for(const [name,d] of entries){
      const isShopify = name.toLowerCase().includes("shopify");
      const icon = isShopify ? "shopping_bag" : "sell";
      const card=el("div","rep-card");
      card.innerHTML=`<div class="nm"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px">${icon}</span> ${esc(name)}</div><div class="big">${money(d.total)}</div><div class="sub">${d.count} venta${d.count!==1?"s":""}</div>`;
      grid.appendChild(card);
    }
  }

  // --- Resumen total ---
  const totalVentas = rows.reduce((s,r)=>s+Number(r.total||0),0);
  const numVentas = rows.length;
  const promedio = numVentas? Math.round(totalVentas/numVentas) : 0;
  // item promedio: total ítems / total ventas
  const totalItems = rows.reduce((s,r)=>s+(Array.isArray(r.items)?r.items.reduce((a,i)=>a+(i.qty||1),0):0),0);
  const itemProm = numVentas? (totalItems/numVentas).toFixed(1) : 0;
  const cards=$("#statsCards");
  if(cards){
    cards.innerHTML=`
      <div class="rep-card"><div class="nm"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px">payments</span> Total vendido</div><div class="big">${money(totalVentas)}</div></div>
      <div class="rep-card"><div class="nm"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px">receipt_long</span> N° de ventas</div><div class="big">${numVentas}</div></div>
      <div class="rep-card"><div class="nm"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px">trending_up</span> Ticket promedio</div><div class="big">${money(promedio)}</div></div>
      <div class="rep-card"><div class="nm"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px">shopping_basket</span> Ítem promedio</div><div class="big">${itemProm}</div></div>`;
  }

  // --- Ventas por canal ---
  const canales = { tienda: { label: "<span class=\"material-symbols-outlined\" style=\"font-size:13px;vertical-align:-3px\">storefront</span> Tienda", total: 0, count: 0 }, envios: { label: "<span class=\"material-symbols-outlined\" style=\"font-size:13px;vertical-align:-3px\">chat</span> WhatsApp", total: 0, count: 0 }, shopify: { label: "<span class=\"material-symbols-outlined\" style=\"font-size:13px;vertical-align:-3px\">shopping_bag</span> Shopify", total: 0, count: 0 } };
  for (const s of rows) {
    const t = s.sale_type === "shopify" ? "shopify" : (s.sale_type === "tienda" ? "tienda" : "envios");
    canales[t].total += Number(s.total || 0);
    canales[t].count++;
  }
  const canalBox = $("#canalStats");
  if (canalBox) {
    const grandTotal = Object.values(canales).reduce((s, c) => s + c.total, 0) || 1;
    canalBox.innerHTML = Object.entries(canales).map(([, c]) => {
      const pct = Math.round(c.total / grandTotal * 100);
      return `<div class="paystat-row">
        <div class="paystat-top"><span>${c.label}</span><span><b>${money(c.total)}</b> · ${c.count} venta${c.count !== 1 ? "s" : ""} · ${pct}%</span></div>
        <div class="paystat-bar"><div class="paystat-fill" style="width:${pct}%"></div></div>
      </div>`;
    }).join("");
  }

  // --- Ventas por medio de pago ---
  // Índice alias→nombre canónico usando payment_methods ya cargados
  const pmAlias = new Map();
  for(const pm of (pos.payments||[])){
    pmAlias.set(pm.name.toLowerCase(), pm.name);
    for(const a of (pm.aliases||[])) pmAlias.set(a.toLowerCase(), pm.name);
  }
  const resolvePM = raw => pmAlias.get((raw||"").toLowerCase()) || raw || "—";

  const bypay={};
  for(const s of rows){
    const detail = Array.isArray(s.payment_detail)? s.payment_detail : null;
    if(detail && detail.length){
      for(const d of detail){
        const m=resolvePM(d.method);
        if(!bypay[m])bypay[m]={total:0,count:0};
        bypay[m].total+=Number(d.amount||0); bypay[m].count++;
      }
    }else{
      const m=resolvePM(s.payment_method);
      if(!bypay[m])bypay[m]={total:0,count:0};
      bypay[m].total+=Number(s.total||0); bypay[m].count++;
    }
  }
  const payBox=$("#payStats");
  if(payBox){ payBox.innerHTML="";
    const entries=Object.entries(bypay).sort((a,b)=>b[1].total-a[1].total);
    if(!entries.length){payBox.innerHTML='<div style="color:var(--text-dim);font-size:13px">Sin datos</div>';}
    else{
      const tot=entries.reduce((s,[,d])=>s+d.total,0)||1;
      for(const [m,d] of entries){
        if(!d.total) continue;
        const pct=Math.round(d.total/tot*100);
        const row=el("div","paystat-row");
        row.innerHTML=`<div class="paystat-top"><span>${esc(m)}</span><span><b>${money(d.total)}</b> · ${pct}%</span></div>
          <div class="paystat-bar"><div class="paystat-fill" style="width:${pct}%"></div></div>`;
        payBox.appendChild(row);
      }
    }
  }

  // --- Top 10 clientes ---
  const byClient={};
  for(const s of rows){
    const n=s.customer_name||"Sin nombre";
    if(!byClient[n])byClient[n]={total:0,count:0};
    byClient[n].total+=Number(s.total||0); byClient[n].count++;
  }
  const topC=$("#topClientes");
  if(topC){
    const top=Object.entries(byClient).sort((a,b)=>b[1].total-a[1].total).slice(0,10);
    if(!top.length){topC.innerHTML='<div style="color:var(--text-dim);font-size:13px">Sin datos</div>';}
    else topC.innerHTML=top.map(([n,d],i)=>`
      <div class="top-row">
        <span class="top-pos">${i+1}</span>
        <span class="top-name">${esc(n)}</span>
        <span class="top-val">${money(d.total)} · ${d.count}v</span>
      </div>`).join("");
  }

  // --- Top 10 referencias ---
  const byRef={};
  for(const s of rows){
    for(const it of (Array.isArray(s.items)?s.items:[])){
      const ref=it.name||(it.sku||"—");
      if(!byRef[ref])byRef[ref]={qty:0,total:0};
      byRef[ref].qty+=(it.qty||1); byRef[ref].total+=Number(it.price||0)*(it.qty||1);
    }
  }
  const topR=$("#topRefs");
  if(topR){
    const top=Object.entries(byRef).sort((a,b)=>b[1].qty-a[1].qty).slice(0,10);
    if(!top.length){topR.innerHTML='<div style="color:var(--text-dim);font-size:13px">Sin datos</div>';}
    else topR.innerHTML=top.map(([n,d],i)=>`
      <div class="top-row">
        <span class="top-pos">${i+1}</span>
        <span class="top-name">${esc(n)}</span>
        <span class="top-val">${d.qty} uds · ${money(d.total)}</span>
      </div>`).join("");
  }
}


// ---------- Arranque ----------
async function init(){
  await loadUsers();
  showLoginModal();
  history.replaceState({screen:"chats"},"");
  await loadPipelines();
  await loadQuickReplies();
  await loadChats();
  startWaPolling();
  startRealtime();
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("sw.js").catch(()=>{});
    navigator.serviceWorker.addEventListener("controllerchange",()=>{
      const b=document.getElementById("updateBanner");
      if(b) b.style.display="flex";
    });
  }

  // En móvil el WebSocket se cae cuando la pantalla se apaga o el navegador va a segundo plano.
  // Al volver, reconectamos y recargamos lo que se perdió.
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") return;
    // Reconectar WebSocket si está cerrado
    if (!_waSocket || _waSocket.readyState === WebSocket.CLOSED || _waSocket.readyState === WebSocket.CLOSING) {
      _connectWaSocket();
    }
    // Recargar lista de chats para ver mensajes nuevos/no leídos
    await loadChats();
    // Si hay una conversación abierta, recargar sus mensajes
    if (state.active) await loadMessages(state.active);
  });

  window.addEventListener("online", () => {
    _connectWaSocket();
    loadChats();
  });
}
init();

// ============================================================
// BOT DE RESPUESTAS AUTOMÁTICAS (estilo Kommo SalesBot)
// ============================================================
let _botEditor = { flowId:null, name:"", triggerType:"new_conversation", triggerValue:"", active:false, steps:[] };
let _botEditingIdx = -1;
let _botEditingData = null;

// ---- Cargar y renderizar lista de flujos ----
async function loadBotFlows(){
  const flows = await fetch(`${C.WORKER_URL}/wa/bot/flows`).then(r=>r.json()).catch(()=>[]);
  renderBotFlowList(flows);
}

function renderBotFlowList(flows){
  const box = $("#botFlowList"); if(!box) return;
  if(!flows.length){ box.innerHTML=`<div style="font-size:13px;color:var(--text-dim)">Sin flujos creados.</div>`; return; }
  box.innerHTML = flows.map(f=>`
    <div class="bot-flow-card">
      <div class="bot-flow-info">
        <div class="bot-flow-name">${esc(f.name)}</div>
        <div class="bot-flow-meta">${f.trigger_type==="new_conversation"?"Nueva conversación":"Palabra clave: "+esc(f.trigger_value||"")} · ${JSON.parse(f.steps||"[]").length} pasos</div>
      </div>
      <span class="bot-badge ${f.active?"on":"off"}">${f.active?"Activo":"Inactivo"}</span>
      <button onclick="openBotEditor('${f.id}')" style="background:none;border:1px solid var(--border);border-radius:8px;padding:5px 10px;cursor:pointer;font-size:12px;color:var(--text-dim)">
        <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px">edit</span>
      </button>
      <button onclick="deleteBotFlow('${f.id}')" style="background:none;border:1px solid var(--border);border-radius:8px;padding:5px 10px;cursor:pointer;font-size:12px;color:var(--text-dim)">
        <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px">delete</span>
      </button>
    </div>`).join("");
}

// ---- Abrir / cerrar editor ----
async function openBotEditor(flowId){
  if(flowId){
    const flows = await fetch(`${C.WORKER_URL}/wa/bot/flows`).then(r=>r.json()).catch(()=>[]);
    const f = flows.find(x=>x.id===flowId);
    if(!f) return;
    _botEditor = { flowId:f.id, name:f.name, triggerType:f.trigger_type, triggerValue:f.trigger_value||"", active:!!f.active, steps:JSON.parse(f.steps||"[]") };
  } else {
    _botEditor = { flowId:null, name:"", triggerType:"new_conversation", triggerValue:"", active:false, steps:[] };
  }
  $("#botFlowNameInput").value = _botEditor.name;
  $("#botFlowActiveChk").checked = _botEditor.active;
  $("#botTriggerTypeSelect").value = _botEditor.triggerType;
  $("#botTriggerValueInput").value = _botEditor.triggerValue;
  onBotTriggerChange();
  renderBotEditor();
  const m = $("#botEditorModal"); m.style.display="flex";
}

function closeBotEditor(){ $("#botEditorModal").style.display="none"; loadBotFlows(); }

function onBotTriggerChange(){
  const t = $("#botTriggerTypeSelect").value;
  const vi = $("#botTriggerValueInput");
  const needsValue = ["keyword","stage_change","tag_added"].includes(t);
  vi.style.display = needsValue ? "" : "none";
  const ph = {keyword:"hola, buenos días, hi", stage_change:"Nombre exacto de la etapa", tag_added:"nombre-etiqueta"};
  vi.placeholder = ph[t]||"";
}

// ---- Renderizar lista de pasos en el editor ----
function renderBotEditor(){
  const box = $("#botStepList"); if(!box) return;
  const steps = _botEditor.steps;
  if(!steps.length){ box.innerHTML=`<div style="color:var(--text-dim);font-size:13px;text-align:center;padding:40px 0">Sin pasos — agrega el primero con el botón de abajo.</div>`; return; }
  const html = steps.map((s,i)=>`
    <div class="bot-step-card" id="bsc-${i}">
      <div class="bot-step-head">
        <div class="bot-step-type-tag"><span class="material-symbols-outlined">${stepTypeIcon(s.type)}</span>${stepTypeLabel(s.type)}</div>
        <div class="bot-step-acts">
          ${i>0?`<button onclick="moveBotStep(${i},-1)" title="Subir"><span class="material-symbols-outlined" style="font-size:14px">arrow_upward</span></button>`:""}
          ${i<steps.length-1?`<button onclick="moveBotStep(${i},1)" title="Bajar"><span class="material-symbols-outlined" style="font-size:14px">arrow_downward</span></button>`:""}
          <button onclick="editBotStep(${i})" title="Editar"><span class="material-symbols-outlined" style="font-size:14px">edit</span></button>
          <button onclick="deleteBotStep(${i})" title="Eliminar" style="color:#e74c3c"><span class="material-symbols-outlined" style="font-size:14px">delete</span></button>
        </div>
      </div>
      <div class="bot-step-preview">${stepPreview(s, steps)}</div>
    </div>
    ${i<steps.length-1?`<div class="bot-connector"></div>`:""}
  `).join("");
  box.innerHTML = html;
}

function stepTypeIcon(type){
  return {text:"chat_bubble",image:"image",audio:"mic",video:"videocam",buttons:"radio_button_checked",list:"format_list_bulleted",condition:"alt_route",validate:"rule",delay:"schedule",webhook:"webhook",assign:"person_pin",note:"sticky_note_2",action:"bolt"}[type]||"help";
}
function stepTypeLabel(type){
  return {text:"Texto",image:"Imagen",audio:"Audio",video:"Video",buttons:"Botones",list:"Lista",condition:"Condición",validate:"Validar",delay:"Esperar",webhook:"Webhook",assign:"Asignar",note:"Nota interna",action:"Acción"}[type]||type;
}
function stepPreview(s, steps){
  if(s.type==="text")      return esc(s.body||"").slice(0,80);
  if(s.type==="image")     return `🖼 ${esc(s.body||s.media_url||"").slice(0,60)}`;
  if(s.type==="audio")     return `🎤 ${esc(s.media_url||"").slice(0,60)}`;
  if(s.type==="video")     return `🎬 ${esc(s.body||s.media_url||"").slice(0,60)}`;
  if(s.type==="buttons")   return `${esc(s.body||"").slice(0,35)} · ${(s.buttons||[]).map(b=>`[${esc(b.title)}]`).join(" ")}`;
  if(s.type==="list")      return `${esc(s.body||"").slice(0,35)} · ${(s.sections||[]).reduce((a,sec)=>a+(sec.rows||[]).length,0)} opciones`;
  if(s.type==="condition"){ const f=(s.conditions||[])[0]?.field||"mensaje"; return `Si ${f} · ${(s.conditions||[]).length} condición(es) · default → ${nextLabel(s.default_next,steps)}`; }
  if(s.type==="validate")  return `${s.validate_type||"email"} · ✓→${nextLabel(s.next_pass,steps)} · ✗→${nextLabel(s.next_fail,steps)}`;
  if(s.type==="delay")     return `⏱ ${s.minutes||1} minuto(s) → ${nextLabel(s.next,steps)}`;
  if(s.type==="webhook")   return `🔗 ${esc(s.url||"").slice(0,50)}`;
  if(s.type==="assign")    return `👤 ${esc(s.seller_name||s.seller||"cualquiera")}`;
  if(s.type==="note")      return `📌 ${esc(s.body||"").slice(0,60)}`;
  if(s.type==="action")    return `${s.action||""} ${s.value?"→ "+esc(s.value):""}`;
  return "";
}
function nextLabel(nxt, steps){
  if(!nxt||nxt==="__end__") return "Fin";
  const idx = steps.findIndex(s=>s.id===nxt);
  return idx>=0 ? `Paso ${idx+1}` : "Fin";
}

// ---- Agregar paso ----
function toggleBotAddMenu(){
  const m=$("#botAddMenu"); m.style.display=m.style.display==="none"?"":"none";
}
function addBotStep(type){
  $("#botAddMenu").style.display="none";
  const id="s"+Date.now();
  const defaults = {
    text:     {id,type:"text",body:"",next:"__end__"},
    image:    {id,type:"image",media_url:"",body:"",next:"__end__"},
    audio:    {id,type:"audio",media_url:"",next:"__end__"},
    video:    {id,type:"video",media_url:"",body:"",next:"__end__"},
    buttons:  {id,type:"buttons",body:"",buttons:[{id:"b"+Date.now(),title:"Opción 1",next:"__end__"}]},
    list:     {id,type:"list",body:"",button_label:"Ver opciones",sections:[{title:"",rows:[{id:"r"+Date.now(),title:"Opción 1",description:"",next:"__end__"}]}]},
    condition:{id,type:"condition",conditions:[{keywords:"",field:"message",operation:"contains",next:"__end__"}],default_next:"__end__"},
    validate: {id,type:"validate",validate_type:"email",validate_pattern:"",next_pass:"__end__",next_fail:"__end__"},
    delay:    {id,type:"delay",minutes:30,next:"__end__"},
    webhook:  {id,type:"webhook",url:"",method:"POST",next:"__end__"},
    assign:   {id,type:"assign",seller:"",seller_name:"",next:"__end__"},
    note:     {id,type:"note",body:"",next:"__end__"},
    action:   {id,type:"action",action:"change_stage",value:"",next:"__end__"},
  };
  const step = defaults[type]||defaults.text;
  _botEditor.steps.push(step);
  renderBotEditor();
  editBotStep(_botEditor.steps.length-1);
}

// ---- Reordenar y eliminar pasos ----
function moveBotStep(idx,dir){
  const s=_botEditor.steps; const to=idx+dir;
  if(to<0||to>=s.length) return;
  [s[idx],s[to]]=[s[to],s[idx]];
  renderBotEditor();
}
function deleteBotStep(idx){
  if(!confirm("¿Eliminar este paso?")) return;
  _botEditor.steps.splice(idx,1);
  renderBotEditor();
}

// ---- Editar paso (modal) ----
function editBotStep(idx){
  _botEditingIdx=idx;
  _botEditingData=JSON.parse(JSON.stringify(_botEditor.steps[idx])); // deep copy
  openBotStepModal();
}
function closeBotStepModal(){ $("#botStepModal").classList.remove("show"); }

function openBotStepModal(){
  const s=_botEditingData; const steps=_botEditor.steps;
  const icons={text:"chat_bubble",image:"image",audio:"mic",video:"videocam",buttons:"radio_button_checked",list:"format_list_bulleted",condition:"alt_route",validate:"rule",delay:"schedule",webhook:"webhook",assign:"person_pin",note:"sticky_note_2",action:"bolt"};
  $("#botStepModalTitle").innerHTML=`<span class="material-symbols-outlined" style="color:var(--accent)">${icons[s.type]||"help"}</span> ${stepTypeLabel(s.type)}`;
  $("#botStepModalBody").innerHTML = buildStepForm(s, steps);
  $("#botStepModal").classList.add("show");
}

function urlUploadField(id, label, val, accept){
  return `<div style="margin-bottom:10px">
    <label style="font-size:12px;font-weight:700;color:var(--text-dim)">${label}</label>
    <div style="display:flex;gap:6px;margin-top:4px;align-items:center">
      <input id="${id}" value="${esc(val||"")}" placeholder="https://..." style="flex:1;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;background:var(--bg);color:var(--text);outline:none;box-sizing:border-box">
      <button type="button" onclick="botUploadMedia('${id}','${accept}')" style="flex-shrink:0;border:1px solid var(--border);border-radius:8px;padding:7px 12px;font-size:12px;background:var(--surface);color:var(--text);cursor:pointer;white-space:nowrap"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-4px">upload</span> Subir</button>
    </div>
    <div id="${id}_prev" style="margin-top:6px;display:${val?'block':'none'}">${val&&accept.startsWith('image')?`<img src="${esc(val)}" style="max-width:100%;max-height:120px;border-radius:8px;object-fit:cover">`:''}</div>
  </div>`;
}

function buildStepForm(s, steps){
  const otherSteps = steps.filter((_,i)=>i!==_botEditingIdx);
  const nextOpts = `<option value="__end__">— Fin del flujo —</option>`+otherSteps.map(st=>`<option value="${st.id}">${stepTypeLabel(st.type)}: ${esc((st.body||st.media_url||"").slice(0,28))}</option>`).join("");
  const selNext=(id,lbl,val)=>sel(id,lbl,val||"__end__",[{v:"__end__",l:"— Fin del flujo —"},...otherSteps.map(st=>({v:st.id,l:stepTypeLabel(st.type)+": "+((st.body||st.media_url||"").slice(0,28))}))]);
  const fld=(id,lbl,val,ph="")=>`<div style="margin-bottom:10px"><label style="font-size:12px;font-weight:700;color:var(--text-dim)">${lbl}</label><br><input id="${id}" value="${esc(val||"")}" placeholder="${ph}" style="width:100%;margin-top:4px;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;background:var(--bg);color:var(--text);outline:none;box-sizing:border-box"></div>`;
  const ta=(id,lbl,val,ph="")=>`<div style="margin-bottom:10px"><label style="font-size:12px;font-weight:700;color:var(--text-dim)">${lbl}</label><br><textarea id="${id}" placeholder="${ph}" style="width:100%;margin-top:4px;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;background:var(--bg);color:var(--text);outline:none;resize:vertical;min-height:70px;font-family:inherit;box-sizing:border-box">${esc(val||"")}</textarea></div>`;
  const sel=(id,lbl,val,opts)=>`<div style="margin-bottom:10px"><label style="font-size:12px;font-weight:700;color:var(--text-dim)">${lbl}</label><br><select id="${id}" style="width:100%;margin-top:4px;border:1px solid var(--border);border-radius:8px;padding:8px;font-size:13px;background:var(--bg);color:var(--text)">${opts.map(o=>`<option value="${o.v}"${(val===o.v)||(o.v==="__end__"&&!val)?" selected":""}>${o.l}</option>`).join("")}</select></div>`;
  const hint=`<div style="font-size:11px;color:var(--text-dim);background:var(--surface);border-radius:8px;padding:8px 10px;margin-bottom:12px">Variables: <b>{nombre}</b> · <b>{telefono}</b> · <b>{etapa}</b> · <b>{etiquetas}</b> · <b>{fecha}</b> · <b>{hora}</b></div>`;
  const IS = s.type;

  if(IS==="text")  return hint+ta("bsf_body","Mensaje",s.body,"Hola {nombre}! Bienvenida a Bloom 🌸")+selNext("bsf_next","Continuar a",s.next);
  if(IS==="image") return urlUploadField("bsf_url","Imagen",s.media_url,"image/*")+hint+ta("bsf_body","Pie de foto (opcional)",s.body)+selNext("bsf_next","Continuar a",s.next);
  if(IS==="audio") return urlUploadField("bsf_url","Audio",s.media_url,"audio/*")+selNext("bsf_next","Continuar a",s.next);
  if(IS==="video") return urlUploadField("bsf_url","Video",s.media_url,"video/*")+hint+ta("bsf_body","Pie de video (opcional)",s.body)+selNext("bsf_next","Continuar a",s.next);

  if(IS==="buttons"){
    const btns = (s.buttons||[]).map((b,i)=>`
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
          <input id="bsf_btn_${i}_title" value="${esc(b.title)}" maxlength="20" placeholder="Botón ${i+1} (máx 20 chars)" style="flex:1;border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:13px;background:var(--bg);color:var(--text);outline:none">
          ${s.buttons.length>1?`<button onclick="removeBotBtn(${i})" style="background:none;border:none;cursor:pointer;color:#e74c3c"><span class="material-symbols-outlined" style="font-size:16px">close</span></button>`:""}
        </div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px">Ir a paso:</div>
        <select id="bsf_btn_${i}_next" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:6px;font-size:12px;background:var(--bg);color:var(--text)">${nextOpts.replace(`value="${b.next||"__end__"}"`,`value="${b.next||"__end__"}" selected`)}</select>
      </div>`).join("");
    const addBtn = s.buttons.length<3 ? `<button onclick="addBotBtn()" style="font-size:12px;background:none;border:1px dashed var(--border);border-radius:8px;padding:6px 12px;cursor:pointer;color:var(--text-dim);width:100%;margin-bottom:10px">+ Agregar botón</button>` : "";
    return hint+ta("bsf_body","Mensaje del menú",s.body,"¿En qué te puedo ayudar?")+`<div style="font-size:12px;font-weight:700;color:var(--text-dim);margin-bottom:6px">BOTONES (máx 3, texto hasta 20 chars)</div>`+btns+addBtn;
  }

  if(IS==="list"){
    const secHtml = (s.sections||[]).map((sec,si)=>{
      const rows=(sec.rows||[]).map((r,ri)=>`
        <div style="display:flex;gap:6px;margin-bottom:6px;align-items:flex-start">
          <div style="flex:1">
            <input id="bsf_sec_${si}_row_${ri}_title" value="${esc(r.title)}" maxlength="24" placeholder="Título (máx 24)" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:5px 8px;font-size:12px;background:var(--bg);color:var(--text);outline:none;box-sizing:border-box;margin-bottom:3px">
            <input id="bsf_sec_${si}_row_${ri}_desc" value="${esc(r.description||"")}" placeholder="Descripción (opcional, máx 72)" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:5px 8px;font-size:11px;background:var(--bg);color:var(--text);outline:none;box-sizing:border-box">
          </div>
          <select id="bsf_sec_${si}_row_${ri}_next" style="width:110px;border:1px solid var(--border);border-radius:6px;padding:5px 4px;font-size:11px;background:var(--bg);color:var(--text)">${nextOpts.replace(`value="${r.next||"__end__"}"`,`value="${r.next||"__end__"}" selected`)}</select>
          ${(sec.rows||[]).length>1?`<button onclick="removeBotRow(${si},${ri})" style="background:none;border:none;cursor:pointer;color:#e74c3c;padding:0"><span class="material-symbols-outlined" style="font-size:14px">close</span></button>`:""}
        </div>`).join("");
      return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px">
        <input id="bsf_sec_${si}_title" value="${esc(sec.title||"")}" placeholder="Título de sección" style="width:100%;border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:12px;background:var(--bg);color:var(--text);outline:none;box-sizing:border-box;margin-bottom:8px">
        ${rows}
        <button onclick="addBotRow(${si})" style="font-size:11px;background:none;border:1px dashed var(--border);border-radius:6px;padding:4px 10px;cursor:pointer;color:var(--text-dim)">+ Fila</button>
      </div>`;
    }).join("");
    return hint+ta("bsf_body","Mensaje del menú",s.body,"Selecciona una opción:")+fld("bsf_btn_label","Texto del botón para desplegar la lista",s.button_label,"Ver opciones")+`<div style="font-size:12px;font-weight:700;color:var(--text-dim);margin-bottom:6px">SECCIONES (máx 10 filas en total)</div>`+secHtml+`<button onclick="addBotSection()" style="font-size:12px;background:none;border:1px dashed var(--border);border-radius:8px;padding:6px 12px;cursor:pointer;color:var(--text-dim);width:100%">+ Agregar sección</button>`;
  }

  if(IS==="condition"){
    const FIELDS=[{v:"message",l:"Texto del mensaje recibido"},{v:"name",l:"Nombre del contacto"},{v:"tag",l:"Etiquetas del contacto"},{v:"stage",l:"Etapa actual"}];
    const OPS=[{v:"contains",l:"contiene"},{v:"not_contains",l:"no contiene"},{v:"=",l:"es igual a"},{v:"!=",l:"es diferente de"},{v:"regex",l:"coincide con regex"},{v:"email",l:"es un email válido"},{v:"phone",l:"es un teléfono válido"},{v:"not_empty",l:"no está vacío"}];
    const conds=(s.conditions||[]).map((c,i)=>`
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
          <select id="bsf_cond_${i}_field" style="border:1px solid var(--border);border-radius:6px;padding:6px;font-size:12px;background:var(--bg);color:var(--text)">${FIELDS.map(f=>`<option value="${f.v}"${(c.field||"message")===f.v?" selected":""}>${f.l}</option>`).join("")}</select>
          <select id="bsf_cond_${i}_op" style="border:1px solid var(--border);border-radius:6px;padding:6px;font-size:12px;background:var(--bg);color:var(--text)">${OPS.map(o=>`<option value="${o.v}"${(c.operation||"contains")===o.v?" selected":""}>${o.l}</option>`).join("")}</select>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <input id="bsf_cond_${i}_kw" value="${esc(c.keywords||"")}" placeholder="valores separados por coma" style="flex:1;border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:12px;background:var(--bg);color:var(--text);outline:none">
          <span style="font-size:11px;color:var(--text-dim);white-space:nowrap">→</span>
          <select id="bsf_cond_${i}_next" style="width:120px;border:1px solid var(--border);border-radius:6px;padding:5px 4px;font-size:11px;background:var(--bg);color:var(--text)">${nextOpts.replace(`value="${c.next||"__end__"}"`,`value="${c.next||"__end__"}" selected`)}</select>
          ${(s.conditions||[]).length>1?`<button onclick="removeBotCond(${i})" style="background:none;border:none;cursor:pointer;color:#e74c3c;padding:0 2px"><span class="material-symbols-outlined" style="font-size:14px">close</span></button>`:""}
        </div>
      </div>`).join("");
    return `<div style="font-size:12px;color:var(--text-dim);margin-bottom:10px">Evalúa un campo y ramifica. Si el campo es <b>mensaje</b>, espera la respuesta del cliente; si es otro campo, actúa inmediatamente.</div>`+conds+`<button onclick="addBotCond()" style="font-size:12px;background:none;border:1px dashed var(--border);border-radius:8px;padding:6px 12px;cursor:pointer;color:var(--text-dim);width:100%;margin-bottom:10px">+ Agregar condición</button>`+selNext("bsf_default_next","Si ninguna condición coincide, ir a",s.default_next);
  }

  if(IS==="validate"){
    const VT=[{v:"email",l:"Es un email válido"},{v:"phone",l:"Es un teléfono válido"},{v:"regex",l:"Coincide con patrón (regex)"},{v:"not_empty",l:"No está vacío"}];
    return sel("bsf_vtype","Tipo de validación",s.validate_type,VT)+fld("bsf_vpattern","Patrón regex (solo si elegiste regex)",s.validate_pattern||"","[A-Z]{3}-\\d{4}")+selNext("bsf_next_pass","✅ Si es válido, ir a",s.next_pass)+selNext("bsf_next_fail","❌ Si no es válido, ir a",s.next_fail);
  }

  if(IS==="delay"){
    return `<div style="font-size:12px;color:var(--text-dim);margin-bottom:12px">El bot esperará X minutos antes de continuar. Si el cliente escribe durante la espera, el temporizador se reinicia.</div>`+fld("bsf_minutes","Minutos a esperar",String(s.minutes||30),"30")+selNext("bsf_next","Continuar a",s.next);
  }

  if(IS==="webhook"){
    return `<div style="font-size:12px;color:var(--text-dim);margin-bottom:12px">Envía un POST (o GET) a una URL externa con los datos del contacto. El bot continúa sin esperar respuesta.</div>`+fld("bsf_url","URL del webhook",s.url||"")+sel("bsf_method","Método HTTP",s.method||"POST",[{v:"POST",l:"POST"},{v:"GET",l:"GET"}])+selNext("bsf_next","Continuar a",s.next);
  }

  if(IS==="assign"){
    const sellers = pos.sellers||[];
    const opts=[{v:"",l:"Cualquier vendedora disponible"},...sellers.map(sv=>({v:sv.id||sv.name,l:sv.name}))];
    return `<div style="font-size:12px;color:var(--text-dim);margin-bottom:12px">Asigna esta conversación a una vendedora específica del equipo.</div>`+sel("bsf_seller","Asignar a",s.seller||"",opts)+selNext("bsf_next","Continuar a",s.next);
  }

  if(IS==="note"){
    return hint+ta("bsf_body","Texto de la nota interna",s.body,"Nota: este cliente preguntó por...")+selNext("bsf_next","Continuar a",s.next);
  }

  if(IS==="action"){
    const ACTS=[{v:"change_stage",l:"Cambiar etapa de la conversación"},{v:"add_tag",l:"Agregar etiqueta al contacto"},{v:"unset_tag",l:"Quitar etiqueta del contacto"},{v:"assign_seller",l:"Asignar a vendedora"},{v:"close_conversation",l:"Cerrar conversación"},{v:"pause_bot",l:"Pausar bot (agente humano toma control)"},{v:"end",l:"Finalizar flujo"}];
    return sel("bsf_action","Acción a ejecutar",s.action||"change_stage",ACTS)+fld("bsf_value","Valor (etapa, etiqueta o nombre de vendedora)",s.value||"")+selNext("bsf_next","Continuar a",s.next);
  }

  return "<em>Tipo desconocido</em>";
}

// Helpers para agregar/quitar items dinámicos en forms (re-abren modal)
function addBotBtn(){
  _syncEditingDataFromForm(); // sync antes de mutar
  if((_botEditingData.buttons||[]).length>=3) return;
  _botEditingData.buttons.push({id:"b"+Date.now(),title:"Opción "+( (_botEditingData.buttons.length)+1),next:"__end__"});
  openBotStepModal();
}
function removeBotBtn(i){
  _syncEditingDataFromForm();
  _botEditingData.buttons.splice(i,1);
  openBotStepModal();
}
function addBotSection(){
  _syncEditingDataFromForm();
  _botEditingData.sections=_botEditingData.sections||[];
  _botEditingData.sections.push({title:"",rows:[{id:"r"+Date.now(),title:"",description:"",next:"__end__"}]});
  openBotStepModal();
}
function addBotRow(si){
  _syncEditingDataFromForm();
  _botEditingData.sections[si].rows.push({id:"r"+Date.now(),title:"",description:"",next:"__end__"});
  openBotStepModal();
}
function removeBotRow(si,ri){
  _syncEditingDataFromForm();
  _botEditingData.sections[si].rows.splice(ri,1);
  openBotStepModal();
}
function addBotCond(){
  _syncEditingDataFromForm();
  _botEditingData.conditions=_botEditingData.conditions||[];
  _botEditingData.conditions.push({keywords:"",next:"__end__"});
  openBotStepModal();
}
function removeBotCond(i){
  _syncEditingDataFromForm();
  _botEditingData.conditions.splice(i,1);
  openBotStepModal();
}

function _syncEditingDataFromForm(){
  const s=_botEditingData;
  const gv=id=>document.getElementById(id)?.value||"";
  if(s.type==="text")  { s.body=gv("bsf_body"); s.next=gv("bsf_next")||"__end__"; }
  if(s.type==="image") { s.media_url=gv("bsf_url"); s.body=gv("bsf_body"); s.next=gv("bsf_next")||"__end__"; }
  if(s.type==="audio") { s.media_url=gv("bsf_url"); s.next=gv("bsf_next")||"__end__"; }
  if(s.type==="video") { s.media_url=gv("bsf_url"); s.body=gv("bsf_body"); s.next=gv("bsf_next")||"__end__"; }
  if(s.type==="buttons"){
    s.body=gv("bsf_body");
    (s.buttons||[]).forEach((b,i)=>{ b.title=(gv(`bsf_btn_${i}_title`)||b.title).slice(0,20); b.next=gv(`bsf_btn_${i}_next`)||"__end__"; });
  }
  if(s.type==="list"){
    s.body=gv("bsf_body"); s.button_label=gv("bsf_btn_label")||"Ver opciones";
    (s.sections||[]).forEach((sec,si)=>{
      sec.title=gv(`bsf_sec_${si}_title`);
      (sec.rows||[]).forEach((r,ri)=>{ r.title=gv(`bsf_sec_${si}_row_${ri}_title`); r.description=gv(`bsf_sec_${si}_row_${ri}_desc`); r.next=gv(`bsf_sec_${si}_row_${ri}_next`)||"__end__"; });
    });
  }
  if(s.type==="condition"){
    (s.conditions||[]).forEach((c,i)=>{ c.field=gv(`bsf_cond_${i}_field`)||"message"; c.operation=gv(`bsf_cond_${i}_op`)||"contains"; c.keywords=gv(`bsf_cond_${i}_kw`); c.next=gv(`bsf_cond_${i}_next`)||"__end__"; });
    s.default_next=gv("bsf_default_next")||"__end__";
  }
  if(s.type==="validate"){ s.validate_type=gv("bsf_vtype")||"email"; s.validate_pattern=gv("bsf_vpattern"); s.next_pass=gv("bsf_next_pass")||"__end__"; s.next_fail=gv("bsf_next_fail")||"__end__"; }
  if(s.type==="delay")   { s.minutes=parseInt(gv("bsf_minutes"))||30; s.next=gv("bsf_next")||"__end__"; }
  if(s.type==="webhook") { s.url=gv("bsf_url"); s.method=gv("bsf_method")||"POST"; s.next=gv("bsf_next")||"__end__"; }
  if(s.type==="assign")  { s.seller=gv("bsf_seller"); s.seller_name=document.querySelector(`#bsf_seller option:checked`)?.textContent||""; s.next=gv("bsf_next")||"__end__"; }
  if(s.type==="note")    { s.body=gv("bsf_body"); s.next=gv("bsf_next")||"__end__"; }
  if(s.type==="action")  { s.action=gv("bsf_action")||"change_stage"; s.value=gv("bsf_value"); s.next=gv("bsf_next")||"__end__"; }
}

async function botUploadMedia(fieldId, accept){
  const inp=document.createElement("input");
  inp.type="file"; inp.accept=accept||"*/*";
  inp.onchange=async()=>{
    const file=inp.files[0]; if(!file) return;
    const btn=document.querySelector(`button[onclick*="${fieldId}"]`);
    if(btn) btn.textContent="Subiendo…";
    const ext=file.name.split(".").pop()||"bin";
    const up=await sbUpload("team-chat", file, ext);
    if(!up){ alert("No se pudo subir el archivo."); if(btn){ btn.innerHTML='<span class="material-symbols-outlined" style="font-size:16px;vertical-align:-4px">upload</span> Subir'; } return; }
    const input=document.getElementById(fieldId);
    if(input) input.value=up.url;
    const prev=document.getElementById(fieldId+"_prev");
    if(prev){
      prev.style.display="block";
      if(accept.startsWith("image")) prev.innerHTML=`<img src="${esc(up.url)}" style="max-width:100%;max-height:120px;border-radius:8px;object-fit:cover">`;
      else prev.innerHTML=`<span style="font-size:12px;color:var(--text-dim)">✓ Subido: ${esc(up.url.split("/").pop())}</span>`;
    }
    if(btn) btn.innerHTML='<span class="material-symbols-outlined" style="font-size:16px;vertical-align:-4px">check</span> Listo';
  };
  inp.click();
}

function saveBotStepEdit(){
  _syncEditingDataFromForm();
  _botEditor.steps[_botEditingIdx]=_botEditingData;
  closeBotStepModal();
  renderBotEditor();
}

// ---- Guardar flujo ----
async function saveBotFlow(){
  const name=$("#botFlowNameInput").value.trim();
  if(!name){ alert("El flujo necesita un nombre."); return; }
  const flow={
    name,
    trigger_type:$("#botTriggerTypeSelect").value,
    trigger_value:$("#botTriggerValueInput").value.trim()||null,
    active:$("#botFlowActiveChk").checked,
    steps:_botEditor.steps,
  };
  const url=_botEditor.flowId
    ? `${C.WORKER_URL}/wa/bot/flows/${encodeURIComponent(_botEditor.flowId)}`
    : `${C.WORKER_URL}/wa/bot/flows`;
  const method=_botEditor.flowId?"PUT":"POST";
  const r=await fetch(url,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(flow)}).then(r=>r.json()).catch(()=>({ok:false}));
  if(!r.ok){ alert("Error al guardar el flujo."); return; }
  if(!_botEditor.flowId && r.id) _botEditor.flowId=r.id;
  closeBotEditor();
}

// ---- Eliminar flujo ----
async function deleteBotFlow(id){
  if(!confirm("¿Eliminar este flujo?")) return;
  await fetch(`${C.WORKER_URL}/wa/bot/flows/${encodeURIComponent(id)}`,{method:"DELETE"}).catch(()=>{});
  loadBotFlows();
}

// ============================================================
//  WhatsApp Flows (Meta Flows API)
// ============================================================

let _waFlowEditor = { id:null, name:"", categories:["OTHER"], status:"DRAFT", activeScreenIdx:0, screens:[] };
let _waFlowCompIdx = -1;
let _waFlowCompData = null;
let _waFlowSendId = null;
let _waFlowSendScreenId = null;

const WAF_COMP_ICONS = {
  TextHeading:"title", TextSubheading:"text_fields", TextBody:"notes", TextCaption:"caption",
  TextInput:"input", TextArea:"density_medium", RadioButtonsGroup:"radio_button_checked",
  CheckboxGroup:"check_box", Dropdown:"arrow_drop_down_circle", DatePicker:"calendar_month",
};
const WAF_COMP_LABELS = {
  TextHeading:"Título", TextSubheading:"Subtítulo", TextBody:"Párrafo", TextCaption:"Pie de texto",
  TextInput:"Campo de texto", TextArea:"Área de texto", RadioButtonsGroup:"Opción única",
  CheckboxGroup:"Varias opciones", Dropdown:"Lista desplegable", DatePicker:"Fecha",
};

// ---- Template: Catálogo de productos por talla (data_exchange) ----
const _CATALOG_FLOW_JSON = {
  version:"6.1",
  data_api_version:"3.0",
  routing_model:{
    SCREEN_TALLA:["SCREEN_MODELOS","SCREEN_NO_STOCK"],
    SCREEN_MODELOS:[],
    SCREEN_NO_STOCK:[]
  },
  screens:[
    {
      id:"SCREEN_TALLA", title:"Bikinis Bloom",
      layout:{type:"SingleColumnLayout", children:[{type:"Form",name:"flow_form",children:[
        {type:"TextHeading",text:"Bikinis Bloom 🌸"},
        {type:"TextBody",text:"Elige tu talla y te mostramos los modelos disponibles en este momento."},
        {type:"RadioButtonsGroup",label:"¿Cuál es tu talla?",name:"talla",required:true,"data-source":[
          {id:"XS",title:"XS"},{id:"S",title:"S"},{id:"M",title:"M"},
          {id:"L",title:"L"},{id:"XL",title:"XL"},{id:"XXL",title:"XXL"}
        ]},
        {type:"Footer",label:"Ver modelos disponibles","on-click-action":{name:"data_exchange",payload:{talla:"${form.talla}"}}}
      ]}]}
    },
    {
      id:"SCREEN_MODELOS", title:"Modelos disponibles", terminal:true,
      data:{
        modelos:{type:"array",items:{type:"object",properties:{id:{type:"string"},title:{type:"string"}}},__example__:[{id:"1",title:"Bikini Azul"}]},
        talla_sel:{type:"string",__example__:"M"}
      },
      layout:{type:"SingleColumnLayout",children:[{type:"Form",name:"flow_form",children:[
        {type:"TextHeading",text:"Disponibles en tu talla 🛍️"},
        {type:"RadioButtonsGroup",label:"Elige el modelo",name:"modelo_titulo",required:true,"data-source":"${data.modelos}"},
        {type:"Footer",label:"Quiero este modelo","on-click-action":{name:"complete",payload:{talla:"${data.talla_sel}",modelo_id:"${form.modelo_titulo}"}}}
      ]}]}
    },
    {
      id:"SCREEN_NO_STOCK", title:"Sin disponibilidad", terminal:true,
      data:{talla_sel:{type:"string",__example__:"M"}},
      layout:{type:"SingleColumnLayout",children:[{type:"Form",name:"flow_form",children:[
        {type:"TextHeading",text:"Sin stock en esa talla"},
        {type:"TextBody",text:"No tenemos modelos disponibles en tu talla ahora. ¡Te avisamos cuando llegue! 💌"},
        {type:"Footer",label:"Entendido","on-click-action":{name:"complete",payload:{talla:"${data.talla_sel}",modelo_id:""}}}
      ]}]}
    }
  ]
};

async function createCatalogFlow(){
  const W=C.WORKER_URL;
  const endpointUri = W+"/wa/flows/exchange";
  // 1. Crear el flow con endpoint_uri
  const r1=await fetch(`${W}/wa/waflows`,{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({name:"Catálogo Bloom — Tallas",categories:["LEAD_GENERATION"],endpoint_uri:endpointUri})});
  const d1=await r1.json();
  if(d1.error){ alert("Error al crear: "+JSON.stringify(d1.error)); return; }
  const flowId=d1.id;
  // 2. Subir el JSON
  const r2=await fetch(`${W}/wa/waflows/${flowId}/json`,{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({flow_json:_CATALOG_FLOW_JSON})});
  const d2=await r2.json();
  if(d2.success===false||d2.error){
    const errs=(d2.validation_errors||[]).map(e=>`${e.error_type}: ${e.message}`).join("\n");
    alert("Flow creado (ID: "+flowId+") pero el JSON tiene errores:\n"+(errs||JSON.stringify(d2))); return;
  }
  alert(`✅ Flow "${d1.id}" creado y JSON subido.\n\n` +
    `Próximos pasos:\n` +
    `1. Genera un par de claves RSA:\n   openssl genrsa -out private.pem 2048\n   openssl rsa -in private.pem -pubout -out public.pem\n\n` +
    `2. Registra la clave pública con Meta:\n   npx wrangler secret put WA_FLOWS_PRIVATE_KEY\n   (pega el contenido de private.pem)\n\n` +
    `3. Ve al Flow Manager de Meta y publica el flow.\n\n` +
    `4. Desde el chat, usa el botón "Enviar" del flow para enviárselo a una cliente.`);
  loadWaFlows();
}

// ---- Lista de flows ----
async function loadWaFlows(){
  const box=$("#waFlowList"); if(!box) return;
  box.innerHTML=`<div style="color:var(--text-dim);font-size:13px">Cargando flows…</div>`;
  const r = await fetch(`${C.WORKER_URL}/wa/waflows`).catch(()=>null);
  if(!r||!r.ok){ box.innerHTML=`<div style="color:#e74c3c;font-size:12px">No se pudo cargar (verifica que WABA_ID esté configurado en el Worker).</div>`; return; }
  const d = await r.json();
  const flows = d.data || [];
  if(!flows.length){ box.innerHTML=`<div style="color:var(--text-dim);font-size:13px">Sin flows creados.</div>`; return; }
  box.innerHTML = flows.map(f=>`
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:8px;display:flex;align-items:center;gap:10px">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(f.name)}</div>
        <div style="margin-top:3px;display:flex;align-items:center;gap:6px">
          <span class="waf-badge ${f.status==='PUBLISHED'?'published':'draft'}">${f.status==='PUBLISHED'?'Publicado':'Borrador'}</span>
          <span style="font-size:11px;color:var(--text-dim)">${(f.categories||[]).join(", ")}</span>
        </div>
        ${(f.validation_errors||[]).length?`<div style="font-size:11px;color:#e74c3c;margin-top:4px">⚠ ${f.validation_errors.length} error(es) en el JSON</div>`:""}
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button onclick="openWaFlowEditor('${esc(f.id)}')" style="background:none;border:1px solid var(--border);border-radius:8px;padding:5px 10px;cursor:pointer;font-size:12px">Editar</button>
        <button onclick="initSendWaFlow('${esc(f.id)}','SCREEN_1')" style="background:var(--accent);color:#fff;border:none;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:12px">Enviar</button>
        <button onclick="deleteWaFlow('${esc(f.id)}')" style="background:none;border:1px solid #fca5a5;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:12px;color:#e74c3c">✕</button>
      </div>
    </div>`).join("");
}

// ---- Abrir/cerrar editor ----
async function openWaFlowEditor(flowId){
  if(flowId){
    const r = await fetch(`${C.WORKER_URL}/wa/waflows/${flowId}`).catch(()=>null);
    const d = r ? await r.json() : null;
    _waFlowEditor = {
      id: flowId,
      name: d?.name||"",
      categories: d?.categories||["OTHER"],
      status: d?.status||"DRAFT",
      activeScreenIdx: 0,
      screens: [{id:"SCREEN_1", title:"Pantalla 1", footer_label:"Enviar", components:[]}]
    };
  } else {
    _waFlowEditor = {
      id: null, name:"", categories:["OTHER"], status:"DRAFT", activeScreenIdx:0,
      screens:[{id:"SCREEN_1", title:"Pantalla 1", footer_label:"Enviar", components:[]}]
    };
  }
  $("#waFlowNameInput").value = _waFlowEditor.name;
  $("#waFlowCategorySelect").value = _waFlowEditor.categories[0]||"OTHER";
  _updateWaFlowStatusBadge();
  renderWaFlowEditor();
  const m=$("#waFlowEditorModal"); m.style.display="flex";
}

function closeWaFlowEditor(){
  $("#waFlowEditorModal").style.display="none";
  loadWaFlows();
}

function _updateWaFlowStatusBadge(){
  const b=$("#waFlowStatusBadge");
  const pub = _waFlowEditor.status==="PUBLISHED";
  b.textContent = pub?"Publicado":"Borrador";
  b.className = "waf-badge "+(pub?"published":"draft");
  const pb=$("#waFlowPublishBtn");
  if(pb) pb.style.display = pub?"none":"";
}

// ---- Renderizar editor ----
function renderWaFlowEditor(){
  _renderWaScreenTabs();
  _renderWaCompList();
}

function _renderWaScreenTabs(){
  const box=$("#waFlowScreenTabs"); if(!box) return;
  const screens = _waFlowEditor.screens;
  box.innerHTML = screens.map((s,i)=>`
    <button class="waf-screen-tab${i===_waFlowEditor.activeScreenIdx?' active':''}" onclick="switchWaScreen(${i})">
      ${esc(s.title||"Pantalla "+(i+1))}${screens.length>1?` <span onclick="event.stopPropagation();deleteWaScreen(${i})" style="margin-left:4px;opacity:.7;font-size:11px">✕</span>`:""}
    </button>
  `).join("")+`<button onclick="addWaScreen()" style="border:1px dashed var(--border);background:none;border-radius:20px;padding:6px 12px;font-size:12px;cursor:pointer;color:var(--text-dim);white-space:nowrap">+ Pantalla</button>`;
}

function _renderWaCompList(){
  const box=$("#waFlowCompList"); if(!box) return;
  const scr = _waFlowEditor.screens[_waFlowEditor.activeScreenIdx];
  if(!scr){ box.innerHTML=""; return; }
  const isLast = _waFlowEditor.activeScreenIdx === _waFlowEditor.screens.length-1;
  let html = `
    <div style="margin-bottom:12px">
      <label style="font-size:11px;font-weight:700;color:var(--text-dim)">TÍTULO DE PANTALLA</label>
      <input value="${esc(scr.title)}" oninput="_waScrTitle(this.value)" style="width:100%;margin-top:4px;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:14px;background:var(--bg);color:var(--text);outline:none;box-sizing:border-box">
    </div>
    <div style="font-size:11px;font-weight:700;color:var(--text-dim);margin-bottom:8px">CAMPOS (${scr.components.length})</div>
  `;
  if(!scr.components.length){
    html += `<div style="text-align:center;padding:32px 0;color:var(--text-dim);font-size:13px">Usa "Agregar campo" para añadir elementos a esta pantalla.</div>`;
  } else {
    html += scr.components.map((c,i)=>`
      <div class="waf-comp-card">
        <div class="waf-comp-icon"><span class="material-symbols-outlined" style="font-size:18px;color:var(--accent)">${WAF_COMP_ICONS[c.type]||"widgets"}</span></div>
        <div class="waf-comp-info">
          <div class="waf-comp-type">${WAF_COMP_LABELS[c.type]||c.type}</div>
          <div class="waf-comp-prev">${esc((c.text||c.label||"").slice(0,50))}</div>
        </div>
        <div class="waf-comp-acts">
          ${i>0?`<button onclick="moveWaComp(${i},-1)" title="Subir"><span class="material-symbols-outlined" style="font-size:16px">arrow_upward</span></button>`:""}
          ${i<scr.components.length-1?`<button onclick="moveWaComp(${i},1)" title="Bajar"><span class="material-symbols-outlined" style="font-size:16px">arrow_downward</span></button>`:""}
          <button onclick="editWaComp(${i})" title="Editar"><span class="material-symbols-outlined" style="font-size:16px">edit</span></button>
          <button onclick="deleteWaComp(${i})" title="Eliminar" style="color:#e74c3c"><span class="material-symbols-outlined" style="font-size:16px">delete</span></button>
        </div>
      </div>`).join("");
  }
  // Footer section
  const nextScrLabel = isLast ? "Enviar y cerrar" : `Ir a: ${esc(_waFlowEditor.screens[_waFlowEditor.activeScreenIdx+1]?.title||"siguiente")}`;
  html += `
    <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">
      <div style="font-size:11px;font-weight:700;color:var(--text-dim);margin-bottom:8px">BOTÓN INFERIOR (siempre visible)</div>
      <div style="display:flex;gap:8px;align-items:center">
        <input value="${esc(scr.footer_label||"Enviar")}" oninput="_waScrFooter(this.value)" placeholder="Texto del botón" style="flex:1;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;background:var(--bg);color:var(--text);outline:none;box-sizing:border-box">
        <span style="font-size:11px;color:var(--text-dim);white-space:nowrap">→ ${nextScrLabel}</span>
      </div>
    </div>
  `;
  box.innerHTML = html;
}

function _waScrTitle(v){ const s=_waFlowEditor.screens[_waFlowEditor.activeScreenIdx]; if(s) s.title=v; _renderWaScreenTabs(); }
function _waScrFooter(v){ const s=_waFlowEditor.screens[_waFlowEditor.activeScreenIdx]; if(s) s.footer_label=v; }

// ---- Pantallas ----
function switchWaScreen(idx){
  _waFlowEditor.activeScreenIdx=idx;
  renderWaFlowEditor();
}
function addWaScreen(){
  $("#waCompMenu").style.display="none";
  const n = _waFlowEditor.screens.length+1;
  _waFlowEditor.screens.push({id:"SCREEN_"+n, title:"Pantalla "+n, footer_label:"Enviar", components:[]});
  _waFlowEditor.activeScreenIdx = _waFlowEditor.screens.length-1;
  renderWaFlowEditor();
}
function deleteWaScreen(idx){
  if(_waFlowEditor.screens.length<=1){ alert("Un flow debe tener al menos una pantalla."); return; }
  if(!confirm("¿Eliminar esta pantalla?")) return;
  _waFlowEditor.screens.splice(idx,1);
  if(_waFlowEditor.activeScreenIdx>=_waFlowEditor.screens.length) _waFlowEditor.activeScreenIdx=_waFlowEditor.screens.length-1;
  renderWaFlowEditor();
}

// ---- Componentes ----
function toggleWaCompMenu(){ const m=$("#waCompMenu"); m.style.display=m.style.display==="none"?"":"none"; }

function addWaComp(type){
  $("#waCompMenu").style.display="none";
  const defaults = {
    TextHeading:{type:"TextHeading",text:""},
    TextSubheading:{type:"TextSubheading",text:""},
    TextBody:{type:"TextBody",text:""},
    TextCaption:{type:"TextCaption",text:""},
    TextInput:{type:"TextInput",label:"",name:"campo_"+Date.now(),required:true,"input-type":"text","helper-text":""},
    TextArea:{type:"TextArea",label:"",name:"campo_"+Date.now(),required:false},
    RadioButtonsGroup:{type:"RadioButtonsGroup",label:"",name:"campo_"+Date.now(),required:true,"data-source":[{id:"op1",title:"Opción 1"},{id:"op2",title:"Opción 2"}]},
    CheckboxGroup:{type:"CheckboxGroup",label:"",name:"campo_"+Date.now(),required:true,"data-source":[{id:"op1",title:"Opción 1"},{id:"op2",title:"Opción 2"}]},
    Dropdown:{type:"Dropdown",label:"",name:"campo_"+Date.now(),required:true,"data-source":[{id:"op1",title:"Opción 1"},{id:"op2",title:"Opción 2"}]},
    DatePicker:{type:"DatePicker",label:"",name:"campo_"+Date.now(),required:true},
  };
  const scr=_waFlowEditor.screens[_waFlowEditor.activeScreenIdx]; if(!scr) return;
  scr.components.push(JSON.parse(JSON.stringify(defaults[type]||{type,text:""})));
  const idx=scr.components.length-1;
  _renderWaCompList();
  editWaComp(idx);
}

function moveWaComp(idx,dir){
  const comps=_waFlowEditor.screens[_waFlowEditor.activeScreenIdx]?.components; if(!comps) return;
  const to=idx+dir; if(to<0||to>=comps.length) return;
  [comps[idx],comps[to]]=[comps[to],comps[idx]];
  _renderWaCompList();
}
function deleteWaComp(idx){
  const comps=_waFlowEditor.screens[_waFlowEditor.activeScreenIdx]?.components; if(!comps) return;
  comps.splice(idx,1);
  _renderWaCompList();
}

// ---- Modal de componente ----
function editWaComp(idx){
  const comps=_waFlowEditor.screens[_waFlowEditor.activeScreenIdx]?.components; if(!comps) return;
  _waFlowCompIdx=idx;
  _waFlowCompData=JSON.parse(JSON.stringify(comps[idx]));
  openWaCompModal();
}
function openWaCompModal(){
  const c=_waFlowCompData;
  const icon=WAF_COMP_ICONS[c.type]||"widgets";
  const label=WAF_COMP_LABELS[c.type]||c.type;
  $("#waFlowCompModalTitle").innerHTML=`<span class="material-symbols-outlined" style="color:var(--accent)">${icon}</span> ${label}`;
  $("#waFlowCompModalBody").innerHTML=buildWaCompForm(c);
  $("#waFlowCompModal").classList.add("show");
}
function closeWaCompModal(){ $("#waFlowCompModal").classList.remove("show"); }

function buildWaCompForm(c){
  const fld=(id,lbl,val,ph="",type="text")=>`<div style="margin-bottom:10px"><label style="font-size:12px;font-weight:700;color:var(--text-dim)">${lbl}</label><br><input id="${id}" type="${type}" value="${esc(val||"")}" placeholder="${ph}" style="width:100%;margin-top:4px;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;background:var(--bg);color:var(--text);outline:none;box-sizing:border-box"></div>`;
  const ta=(id,lbl,val)=>`<div style="margin-bottom:10px"><label style="font-size:12px;font-weight:700;color:var(--text-dim)">${lbl}</label><br><textarea id="${id}" style="width:100%;margin-top:4px;border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;background:var(--bg);color:var(--text);outline:none;resize:vertical;min-height:60px;font-family:inherit;box-sizing:border-box">${esc(val||"")}</textarea></div>`;
  const chk=(id,lbl,checked)=>`<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-bottom:10px"><input type="checkbox" id="${id}" ${checked?"checked":""} style="width:16px;height:16px"> ${lbl}</label>`;
  const sel=(id,lbl,val,opts)=>`<div style="margin-bottom:10px"><label style="font-size:12px;font-weight:700;color:var(--text-dim)">${lbl}</label><br><select id="${id}" style="width:100%;margin-top:4px;border:1px solid var(--border);border-radius:8px;padding:8px;font-size:13px;background:var(--bg);color:var(--text)">${opts.map(o=>`<option value="${o.v}"${val===o.v?" selected":""}>${o.l}</option>`).join("")}</select></div>`;

  const T=c.type;
  // Text display components
  if(["TextHeading","TextSubheading","TextBody","TextCaption"].includes(T))
    return ta("waf_text","Texto",c.text);

  // TextInput
  if(T==="TextInput") return fld("waf_label","Etiqueta del campo",c.label,"Ej: Tu nombre")+
    fld("waf_name","Nombre del campo (sin espacios)",c.name,"nombre_cliente")+
    sel("waf_itype","Tipo de dato",c["input-type"]||"text",[
      {v:"text",l:"Texto libre"},{v:"number",l:"Número"},{v:"email",l:"Email"},
      {v:"phone",l:"Teléfono"},{v:"password",l:"Contraseña"},{v:"passcode",l:"Código de acceso"}
    ])+fld("waf_helper","Texto de ayuda (opcional)",c["helper-text"]||"")+chk("waf_req","Campo obligatorio",c.required!==false);

  // TextArea
  if(T==="TextArea") return fld("waf_label","Etiqueta del campo",c.label,"Ej: Cuéntanos más")+
    fld("waf_name","Nombre del campo",c.name)+chk("waf_req","Campo obligatorio",c.required!==false);

  // DatePicker
  if(T==="DatePicker") return fld("waf_label","Etiqueta del campo",c.label,"Ej: Fecha de cita")+
    fld("waf_name","Nombre del campo",c.name)+chk("waf_req","Campo obligatorio",c.required!==false);

  // Options (Radio, Checkbox, Dropdown)
  if(["RadioButtonsGroup","CheckboxGroup","Dropdown"].includes(T)){
    const opts=(c["data-source"]||[]).map((o,i)=>`
      <div style="display:flex;gap:6px;margin-bottom:6px;align-items:center">
        <input id="waf_opt_${i}" value="${esc(o.title)}" placeholder="Opción ${i+1}" style="flex:1;border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:12px;background:var(--bg);color:var(--text);outline:none">
        ${(c["data-source"]||[]).length>1?`<button onclick="removeWafOpt(${i})" style="background:none;border:none;cursor:pointer;color:#e74c3c;padding:0 4px"><span class="material-symbols-outlined" style="font-size:16px">close</span></button>`:""}
      </div>`).join("");
    return fld("waf_label","Etiqueta de la pregunta",c.label)+fld("waf_name","Nombre del campo",c.name)+
      `<div style="font-size:12px;font-weight:700;color:var(--text-dim);margin-bottom:6px">OPCIONES</div>`+
      `<div id="waf_opts_wrap">${opts}</div>`+
      `<button onclick="addWafOpt()" style="font-size:12px;background:none;border:1px dashed var(--border);border-radius:8px;padding:6px 12px;cursor:pointer;color:var(--text-dim);width:100%;margin-bottom:10px">+ Agregar opción</button>`+
      chk("waf_req","Campo obligatorio",c.required!==false);
  }

  return "<em>Tipo no soportado en el editor</em>";
}

function addWafOpt(){
  _syncWaCompFromForm();
  const src=_waFlowCompData["data-source"]||[];
  src.push({id:"op"+(src.length+1)+"_"+Date.now(), title:""});
  _waFlowCompData["data-source"]=src;
  openWaCompModal();
}
function removeWafOpt(i){
  _syncWaCompFromForm();
  (_waFlowCompData["data-source"]||[]).splice(i,1);
  openWaCompModal();
}

function _syncWaCompFromForm(){
  const c=_waFlowCompData;
  const gv=id=>{ const el=document.getElementById(id); return el?el.value:""; };
  const gc=id=>{ const el=document.getElementById(id); return el?el.checked:false; };
  const T=c.type;
  if(["TextHeading","TextSubheading","TextBody","TextCaption"].includes(T)){ c.text=gv("waf_text"); return; }
  if(["TextInput","TextArea","DatePicker"].includes(T)){
    c.label=gv("waf_label"); c.name=gv("waf_name")||c.name; c.required=gc("waf_req");
    if(T==="TextInput"){ c["input-type"]=gv("waf_itype")||"text"; c["helper-text"]=gv("waf_helper"); }
  }
  if(["RadioButtonsGroup","CheckboxGroup","Dropdown"].includes(T)){
    c.label=gv("waf_label"); c.name=gv("waf_name")||c.name; c.required=gc("waf_req");
    const src=c["data-source"]||[];
    c["data-source"]=src.map((o,i)=>({...o, title:gv("waf_opt_"+i)||o.title}));
  }
}

function saveWaComp(){
  _syncWaCompFromForm();
  const comps=_waFlowEditor.screens[_waFlowEditor.activeScreenIdx]?.components; if(!comps) return;
  comps[_waFlowCompIdx]=_waFlowCompData;
  closeWaCompModal();
  _renderWaCompList();
}

// ---- Generar Flow JSON v6.1 ----
function buildWaFlowJson(){
  const screens=_waFlowEditor.screens;
  return {
    version:"6.1",
    screens: screens.map((scr,idx)=>{
      const isLast=idx===screens.length-1;
      const inputComps=scr.components.filter(c=>["TextInput","TextArea","RadioButtonsGroup","CheckboxGroup","Dropdown","DatePicker"].includes(c.type));
      const footerAction = isLast
        ? {name:"complete", payload:Object.fromEntries(inputComps.filter(c=>c.name).map(c=>[c.name,`\${form.${c.name}}`]))}
        : {name:"navigate", next:{type:"screen", name:screens[idx+1].id}, payload:{}};
      const footer={type:"Footer", label:scr.footer_label||"Enviar", "on-click-action":footerAction};
      const formChildren=[
        ...scr.components.map(c=>_compToWafJson(c)),
        footer
      ];
      return {
        id:scr.id, title:scr.title, terminal:isLast, data:{},
        layout:{type:"SingleColumnLayout", children:[{type:"Form", name:"flow_form", children:formChildren}]}
      };
    })
  };
}

function _compToWafJson(c){
  const obj={type:c.type};
  if(c.text!==undefined) obj.text=c.text;
  if(c.label!==undefined) obj.label=c.label;
  if(c.name!==undefined) obj.name=c.name;
  if(c.required!==undefined) obj.required=c.required;
  if(c["input-type"]) obj["input-type"]=c["input-type"];
  if(c["helper-text"]) obj["helper-text"]=c["helper-text"];
  if(c["data-source"]) obj["data-source"]=c["data-source"];
  return obj;
}

// ---- Guardar (crear o actualizar JSON en Meta) ----
async function saveWaFlow(){
  const name=$("#waFlowNameInput").value.trim();
  if(!name){ alert("El flow necesita un nombre."); return; }
  _waFlowEditor.name=name;
  _waFlowEditor.categories=[$("#waFlowCategorySelect").value||"OTHER"];
  const flowJson=buildWaFlowJson();
  const W=C.WORKER_URL;

  let flowId=_waFlowEditor.id;
  if(!flowId){
    // Crear nuevo
    const r=await fetch(`${W}/wa/waflows`,{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({name, categories:_waFlowEditor.categories})});
    const d=await r.json();
    if(d.error){ alert("Error al crear el flow: "+JSON.stringify(d.error)); return; }
    flowId=d.id;
    _waFlowEditor.id=flowId;
  }
  // Subir JSON
  const r2=await fetch(`${W}/wa/waflows/${flowId}/json`,{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({flow_json:flowJson})});
  const d2=await r2.json();
  if(d2.success===false||d2.error){
    const errs=(d2.validation_errors||[]).map(e=>`${e.error_type}: ${e.message} (${e.line_number})`).join("\n");
    alert("Error al guardar el JSON:\n"+(errs||JSON.stringify(d2.error||d2))); return;
  }
  alert("Flow guardado correctamente.");
}

// ---- Publicar ----
async function publishWaFlow(){
  if(!_waFlowEditor.id){ alert("Primero guarda el flow."); return; }
  if(!confirm("¿Publicar este flow? Una vez publicado no se puede editar.")) return;
  const r=await fetch(`${C.WORKER_URL}/wa/waflows/${_waFlowEditor.id}/publish`,{method:"POST"});
  const d=await r.json();
  if(d.success){
    _waFlowEditor.status="PUBLISHED";
    _updateWaFlowStatusBadge();
    alert("Flow publicado correctamente.");
  } else {
    alert("Error al publicar: "+JSON.stringify(d.error||d));
  }
}

// ---- Preview JSON ----
function previewWaFlow(){
  const json=buildWaFlowJson();
  $("#waFlowJsonPre").textContent=JSON.stringify(json,null,2);
  $("#waFlowJsonModal").classList.add("show");
}
function copyWaFlowJson(){
  navigator.clipboard.writeText($("#waFlowJsonPre").textContent).then(()=>alert("Copiado al portapapeles.")).catch(()=>{});
}

// ---- Eliminar ----
async function deleteWaFlow(id){
  if(!confirm("¿Eliminar este flow? Solo se puede eliminar en estado Borrador.")) return;
  const r=await fetch(`${C.WORKER_URL}/wa/waflows/${id}`,{method:"DELETE"});
  const d=await r.json();
  if(d.error) alert("Error: "+JSON.stringify(d.error));
  loadWaFlows();
}

// ---- Enviar flow desde el chat ----
function initSendWaFlow(flowId, screenId){
  if(!state.active){ alert("Selecciona un chat primero."); return; }
  _waFlowSendId=flowId; _waFlowSendScreenId=screenId||"SCREEN_1";
  $("#waFlowSendModal").classList.add("show");
}
function closeWaFlowSendModal(){ $("#waFlowSendModal").classList.remove("show"); }
async function confirmSendWaFlow(){
  const cta=$("#waFlowSendCta").value.trim()||"Abrir formulario";
  const header=$("#waFlowSendHeader").value.trim();
  const body=$("#waFlowSendBody").value.trim()||"Por favor completa el formulario.";
  const r=await fetch(`${C.WORKER_URL}/wa/waflows/send`,{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({phone:state.active, flow_id:_waFlowSendId, flow_cta:cta, header_text:header, body_text:body, screen_id:_waFlowSendScreenId})});
  const d=await r.json();
  if(d.messages||d.contacts) { closeWaFlowSendModal(); alert("Flow enviado."); }
  else alert("Error al enviar: "+JSON.stringify(d.error||d));
}
