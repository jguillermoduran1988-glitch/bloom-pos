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
  state.pipelines = rows.map(p=>({...p, stages: typeof p.stages==="string"?JSON.parse(p.stages):p.stages}));
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

// ---------- Chats ----------
async function loadChats(){
  const rows = await sbGet(`contacts?store=eq.${C.STORE}&order=created_at.desc&limit=${CHAT_PAGE}`);
  for(const c of rows){
    state.chats.set(c.phone,{
      phone:c.phone,name:c.name||c.phone,stage:c.stage||"nueva",
      pipeline_id:c.pipeline_id,tags:c.tags||[],
      ref_source_type:c.ref_source_type,ref_headline:c.ref_headline,
      ref_body:c.ref_body,ref_media_url:c.ref_media_url,
      last:"",lastAt:c.created_at,unread:0
    });
  }
  await hydrateLast();
  renderChatList();
}
async function hydrateLast(){
  const rows=await sbGet(`messages?store=eq.${C.STORE}&order=created_at.desc&limit=300&select=contact_phone,body,created_at`);
  for(const m of rows){const c=state.chats.get(m.contact_phone); if(c&&!c.last){c.last=m.body;c.lastAt=m.created_at;}}
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
    const item=el("div","chat-item"+(c.phone===state.active?" sel":""));
    let refBadge="";
    if(c.ref_source_type==="ad") refBadge=`<span class=\"ref-badge ad\"><span class=\"material-symbols-outlined\" style=\"font-size:12px;vertical-align:-3px\">campaign</span> pauta</span>`;
    else if(c.ref_source_type) refBadge=`<span class=\"ref-badge\"><span class=\"material-symbols-outlined\" style=\"font-size:12px;vertical-align:-3px\">photo_camera</span> historia</span>`;
    item.innerHTML=`
      <div class="av">${initials(c.name)}</div>
      <div class="ci-body">
        <div class="ci-top"><span class="ci-name">${esc(c.name)}</span><span class="ci-time">${timeLabel(c.lastAt)}</span></div>
        <div class="ci-prev">${esc(c.last||"—")}</div>
        <div class="ci-meta">
          ${refBadge}
          <span class="stage">${esc(c.stage)}</span>
          ${c.unread?`<span class="ci-unread">${c.unread}</span>`:""}
        </div>
      </div>`;
    item.onclick=()=>openChat(c.phone);
    frag.appendChild(item);
  }
  list.appendChild(frag);
}

// ---------- Abrir chat ----------
async function openChat(phone){
  state.active=phone;
  const c=state.chats.get(phone); c.unread=0;
  document.body.classList.add("chat-open");
  $("#emptyState").style.display="none";
  ["chatHead","msgs","qrBar","composer"].forEach(id=>$("#"+id).style.display=
    id==="msgs"||id==="qrBar"||id==="composer"?(id==="msgs"?"flex":"flex"):"flex");
  $("#headAv").textContent=initials(c.name);
  $("#headName").textContent=c.name;
  $("#headSub").textContent="+"+phone;
  renderChatList(); renderPanel();
  await loadMessages(phone);
}
function closeChat(){document.body.classList.remove("chat-open");state.active=null;$("#panel").classList.add("hidden");}

// ---------- Mensajes (ventana + scroll infinito hacia arriba) ----------
async function loadMessages(phone){
  state.allLoaded = false; state.loadingMore = false; state.oldestLoaded = null;
  const rows=await sbGet(`messages?contact_phone=eq.${phone}&order=created_at.desc&limit=${MSG_WINDOW}&select=body,direction,created_at,msg_type,media_url`);
  state.messages=rows.reverse();
  if(state.messages.length) state.oldestLoaded = state.messages[0].created_at;
  if(rows.length < MSG_WINDOW) state.allLoaded = true;
  renderMessages();
}

// Carga los mensajes ANTERIORES cuando subes al tope (mantiene la posición)
async function loadOlderMessages(){
  if(state.loadingMore || state.allLoaded || !state.active || !state.oldestLoaded) return;
  state.loadingMore = true;
  const box = $("#msgs");
  const prevHeight = box.scrollHeight;          // para conservar la posición visual
  const rows = await sbGet(
    `messages?contact_phone=eq.${state.active}&created_at=lt.${encodeURIComponent(state.oldestLoaded)}&order=created_at.desc&limit=${MSG_WINDOW}&select=body,direction,created_at,msg_type,media_url`
  );
  if(!rows.length){ state.allLoaded = true; state.loadingMore = false; return; }
  const older = rows.reverse();
  state.messages = [...older, ...state.messages];
  state.oldestLoaded = state.messages[0].created_at;
  if(rows.length < MSG_WINDOW) state.allLoaded = true;
  renderMessages(true);                          // re-render sin saltar al fondo
  box.scrollTop = box.scrollHeight - prevHeight;  // mantiene dónde estabas leyendo
  state.loadingMore = false;
}

function msgNode(m){
  // Nota privada del vendedor — NUNCA se envía al cliente
  if(m.msg_type==="note"){
    const d=el("div","msg-note");
    d.innerHTML=`<span class=\"lock\"><span class=\"material-symbols-outlined\" style=\"font-size:14px;vertical-align:-3px\">lock</span></span> ${waFormat(m.body)}
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
  b.innerHTML=waFormat(m.body)+`<div class="t">${new Date(m.created_at).toLocaleTimeString("es-CO",{hour:"2-digit",minute:"2-digit"})}</div>`;
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
function togglePanel(){$("#panel").classList.toggle("hidden");}
function renderPanel(){
  const c=state.chats.get(state.active); if(!c)return;
  $("#pAv").textContent=initials(c.name);
  $("#pName").textContent=c.name;
  $("#pPhone").textContent="+"+c.phone;
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
  const add=el("button","tag-add"); add.textContent="+ etiqueta";
  add.onclick=()=>{const inp=$("#tagInput");inp.classList.add("show");inp.focus();};
  box.appendChild(add);
  // sugeridas
  const sg=$("#tagSugg"); sg.innerHTML="";
  for(const s of C.SUGGESTED_TAGS){
    if((c.tags||[]).includes(s))continue;
    const e=el("span"); e.textContent=s; e.onclick=()=>addTag(s); sg.appendChild(e);
  }
}
async function addTag(tag){
  const c=state.chats.get(state.active);
  if(!tag||!c||(c.tags||[]).includes(tag))return;
  c.tags=[...(c.tags||[]),tag];
  renderTags(c); renderChatList();
  await sbPatch(`contacts?phone=eq.${c.phone}`,{tags:c.tags});
}
async function removeTag(tag){
  const c=state.chats.get(state.active);
  c.tags=(c.tags||[]).filter(t=>t!==tag);
  renderTags(c); renderChatList();
  await sbPatch(`contacts?phone=eq.${c.phone}`,{tags:c.tags});
}
$("#tagInput").addEventListener("keydown",e=>{
  if(e.key==="Enter"){const v=e.target.value.trim();if(v)addTag(v);e.target.value="";e.target.classList.remove("show");}
});

// ---------- Etapas del embudo ----------
function renderStages(c){
  const pipe=state.pipelines.find(p=>p.id===c.pipeline_id)||currentPipeline();
  $("#pPipeName").textContent=pipe.name;
  const box=$("#pStages"); box.innerHTML="";
  for(const st of pipe.stages){
    const row=el("div","st-row"+(st===c.stage?" on":""));
    row.innerHTML=`<span class="st-dot"></span><span class="st-label">${esc(st)}</span>${st===c.stage?"✓":""}`;
    row.onclick=()=>setStage(st);
    box.appendChild(row);
  }
}
async function setStage(st){
  const c=state.chats.get(state.active); c.stage=st;
  renderStages(c); renderChatList();
  await sbPatch(`contacts?phone=eq.${c.phone}`,{stage:st});
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
  await sbPatch(`contacts?phone=eq.${c.phone}`,{pipeline_id:target.id,stage:c.stage});
}

// ---------- Modal crear/editar embudo ----------
let editingStages=[];
function openPipeModal(){
  editingStages=["nueva","interesada","pagada"];
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
    const inp=el("input"); inp.value=s; inp.oninput=e=>editingStages[i]=e.target.value;
    const del=el("button"); del.textContent="✕"; del.onclick=()=>{editingStages.splice(i,1);renderStageEdit();};
    row.appendChild(inp); row.appendChild(del); box.appendChild(row);
  });
}
function addStageRow(){editingStages.push("");renderStageEdit();}
async function savePipeline(){
  const name=$("#pipeNameInput").value.trim();
  const stages=editingStages.map(s=>s.trim()).filter(Boolean);
  if(!name||!stages.length){alert("Pon un nombre y al menos una etapa");return;}
  const r=await sbPost("pipelines",{name,stages,store:C.STORE,position:state.pipelines.length});
  const created=(await r.json())[0];
  created.stages=stages;
  state.pipelines.push(created);
  closePipeModal(); renderPipeTabs();
}

// ---------- Enviar ----------
async function sendCurrent(){
  const input=$("#input"); let text=input.value.trim();
  if(!text||!state.active)return;
  input.value=""; autoGrow();
  await dispatch(text);
}
async function dispatch(text){
  const phone=state.active; const now=new Date().toISOString();
  appendMessage({body:text,direction:"out",created_at:now,msg_type:"text"});
  const c=state.chats.get(phone); c.last=text; c.lastAt=now; renderChatList();
  try{
    await fetch(`${C.WORKER_URL}/send`,{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({phone,message:text,store:C.STORE})});
  }catch(e){console.error("envío:",e);}
}

// ---------- Nota privada del vendedor (NO se envía al cliente) ----------
async function addNote(){
  const phone=state.active; if(!phone) return;
  const text=prompt("Nota interna (solo la ves tú, no se envía al cliente):");
  if(!text||!text.trim()) return;
  const now=new Date().toISOString();
  appendMessage({body:text.trim(),direction:"out",created_at:now,msg_type:"note"});
  // Se guarda en la base como tipo 'note' — el Worker nunca la manda a WhatsApp
  await sbPost("messages",{contact_phone:phone,store:C.STORE,direction:"out",body:text.trim(),msg_type:"note"});
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
  picker.selected.clear(); picker.size=null;
  picker.products=await fetchProducts();
  renderSizes(); renderProducts(); updateSendBtn();
  $("#overlay").classList.add("show");
}
function closePicker(){$("#overlay").classList.remove("show");}
async function fetchProducts(){
  try{
    const r=await fetch(`${C.WORKER_URL}/products?store=${C.STORE}`);
    if(r.ok){
      const d=await r.json();
      if(d.length){
        try{ localStorage.setItem("bloom_catalog_cache", JSON.stringify(d)); }catch{}
        return d;
      }
    }
  }catch(e){}
  // Fallback: caché local (offline)
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
  const list=picker.products.filter(p=>p.stock>0&&(!picker.size||(p.sizes||[]).includes(picker.size)));
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
function autoGrow(){const t=$("#input");t.style.height="auto";t.style.height=Math.min(t.scrollHeight,100)+"px";}
$("#input").addEventListener("input",autoGrow);
$("#input").addEventListener("keydown",e=>{
  if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();
    const raw=$("#input").value.trim();
    $("#input").value=expandCommand(raw); sendCurrent();}
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
  ["chats","pos","equipo","datos","config"].forEach(s=>{
    document.getElementById("screen-"+s).classList.toggle("active", s===name);
    document.getElementById("screen-"+s).style.display = s===name? (s==="chats"||s==="pos"?"grid":"block") : "none";
    const nav=document.getElementById("nav-"+s); if(nav) nav.classList.toggle("on", s===name);
  });
  if(name==="pos" && !pos.catalog.length) initPos();
  if(name==="config"){
    if(!pos.currentUser?.is_master){ alert("Solo el master puede acceder a la configuración."); switchScreen("pos"); return; }
    initConfig();
  }
  if(name==="datos") initDatos();
  if(name==="equipo") initTeam();
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
      row.onclick=()=>{ pos.cashier=c; renderCashierBtn(); closeCashierPick(); };
      box.appendChild(row);
    }
  }
  $("#cashierModal").classList.add("show");
}
function closeCashierPick(){ $("#cashierModal").classList.remove("show"); }

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
  if(val===String(pos.cashier.pin)){
    $("#pinModal").classList.remove("show");
    if(_pinResolve){ _pinResolve(true); _pinResolve=null; }
  }else{
    $("#pinError").style.display="block";
  }
}
function closePin(){
  $("#pinModal").classList.remove("show");
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
}
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

// ---- Meta de ventas del día ----
function saveSalesGoal(){
  const v=parseInt($("#setSalesGoal")?.value)||0;
  localStorage.setItem("bloom_sales_goal", v);
  renderGoalBar();
}
async function loadGoalBar(){
  const goal=parseInt(localStorage.getItem("bloom_sales_goal"))||0;
  if($("#setSalesGoal")) $("#setSalesGoal").value=goal||"";
  if(!goal){ const b=$("#goalBar"); if(b) b.style.display="none"; return; }
  const today=new Date().toISOString().slice(0,10);
  const rows=await sbGet(`sales?store=eq.${C.STORE}&created_at=gte.${today}T00:00:00&select=total&status=eq.completada`);
  const total=(rows||[]).reduce((s,r)=>s+(r.total||0),0);
  renderGoalBar(goal,total);
}
function renderGoalBar(goal,total){
  if(goal===undefined) goal=parseInt(localStorage.getItem("bloom_sales_goal"))||0;
  const bar=$("#goalBar"); if(!bar) return;
  if(!goal){ bar.style.display="none"; return; }
  bar.style.display="block";
  if(total===undefined) total=0;
  const pct=Math.min(100,Math.round(total/goal*100));
  const prog=$("#goalProgress"); if(prog) prog.style.width=pct+"%";
  const txt=$("#goalText"); if(txt) txt.textContent=`${money(total)} / ${money(goal)} (${pct}%)`;
  if(prog) prog.style.background = pct>=100?"#27ae60":pct>=70?"var(--accent)":"var(--accent)";
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

  // Construir filas indexadas para onclick seguro (sin JSON en HTML)
  _lblResults = [];
  const rows = list.map(p=>{
    if(p.variants && p.variants.length){
      const allIdx = _lblResults.length; // índice del grupo completo
      const variantItems = p.variants.map(v=>({
        name: p.name,
        variant: [v.color, v.talla||v.size].filter(Boolean).join(" / ")||"única",
        price: v.price||p.price,
        barcode: v.barcode||p.barcode||"",
        sku: v.sku||p.sku||""
      }));
      _lblResults.push({ _group: true, items: variantItems }); // grupo = índice allIdx
      variantItems.forEach(item => _lblResults.push(item));

      const varRows = variantItems.map((item, vi)=>{
        const idx = allIdx + 1 + vi;
        return `<div onclick="addLabelByIdx(${idx})" style="padding:7px 10px 7px 20px;border-bottom:1px solid var(--border);cursor:pointer;font-size:13px;display:flex;justify-content:space-between;align-items:center;background:var(--surface)">
          <span style="color:var(--text-dim)">${esc(item.variant)}${item.barcode?`<span style="font-size:10px;margin-left:6px">${esc(item.barcode)}</span>`:''}</span>
          <span style="color:var(--accent);font-weight:600;font-size:12px">${money(item.price)}</span>
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
    const idx = _lblResults.length;
    _lblResults.push({name:p.name, variant:"", price:p.price, barcode:p.barcode||"", sku:p.sku||""});
    return `<div onclick="addLabelByIdx(${idx})" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:4px;cursor:pointer;font-size:13px;background:var(--surface);display:flex;justify-content:space-between;align-items:center">
      <span><b>${esc(p.name)}</b>${p.barcode?`<span style="color:var(--text-dim);font-size:11px;margin-left:6px">${esc(p.barcode)}</span>`:''}</span>
      <span style="color:var(--accent);font-weight:700">${money(p.price)}</span>
    </div>`;
  });
  box.innerHTML = rows.join('');
}

function addLabelByIdx(idx){
  const item=_lblResults[idx]; if(!item||item._group) return;
  _lblQueue.push({...item, qty:1});
  renderLabelQueue();
}
function addAllLabelVariants(groupIdx){
  const group=_lblResults[groupIdx]; if(!group?._group) return;
  group.items.forEach(item=>_lblQueue.push({...item, qty:1}));
  renderLabelQueue();
  const s=$("#lblSearch"); if(s) s.value="";
  const r=$("#lblResults"); if(r){ r.innerHTML=""; _lblResults=[]; }
}
function addLabelItem(name,variant,price,barcode,sku){
  _lblQueue.push({name,variant,price,barcode,sku,qty:1});
  renderLabelQueue();
  const s=$("#lblSearch"); if(s) s.value="";
  const r=$("#lblResults"); if(r){ r.innerHTML=""; _lblResults=[]; }
}
function removeLabelItem(i){ _lblQueue.splice(i,1); renderLabelQueue(); }
function setLabelQty(i,v){ _lblQueue[i].qty=Math.max(1,parseInt(v)||1); }
function clearLabelQueue(){ _lblQueue=[]; renderLabelQueue(); }

function renderLabelQueue(){
  const box=$("#lblQueue"); if(!box) return;
  const total=_lblQueue.reduce((s,r)=>s+r.qty,0);
  if(!_lblQueue.length){ box.innerHTML='<div style="font-size:12px;color:var(--text-dim);padding:4px 0">No hay productos en cola — busca arriba para agregar.</div>'; return; }
  box.innerHTML=`<div style="font-size:11px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Cola de impresión · ${total} etiqueta${total!==1?"s":""}</div>`+
  _lblQueue.map((item,i)=>`
    <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:4px;background:var(--surface);font-size:13px">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(item.name)}</div>
        ${item.variant?`<div style="font-size:11px;color:var(--text-dim)">${esc(item.variant)}</div>`:''}
        <div style="font-size:12px;color:var(--accent);font-weight:700">${money(item.price)}</div>
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
  const showQr=_lblG("lblShowQr")||false;
  const fsStore=parseInt(_lblG("lblFsStore"))||7;
  const fsName=parseInt(_lblG("lblFsName"))||9;
  const fsVariant=parseInt(_lblG("lblFsVariant"))||8;
  const fsPrice=parseInt(_lblG("lblFsPrice"))||14;
  const bcH=parseInt(_lblG("lblBcH"))||22;
  const qrSz=parseInt(_lblG("lblQrSz"))||36;
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
      ${showBarcode&&(item.barcode||item.sku)?`<svg id="${item._bcId}" class="f-bc"></svg>`:""}
      ${showQr&&(item.barcode||item.sku)?`<canvas id="${item._qrId}" class="f-qr"></canvas>`:""}
    </div>`).join('');

  const win=window.open("","_blank");
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Etiquetas</title>
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
  <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"><\/script>
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
    .f-qr{width:${qrSz}px;height:${qrSz}px}
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
        const code=item.barcode||item.sku||"";
        if(showBarcode&&code){
          const svg=win.document.getElementById(item._bcId);
          if(svg) try{ win.JsBarcode(svg,code,{format:"CODE128",displayValue:true,fontSize:7,height:bcH-4,margin:1,width:1.2}); }catch(e){}
        }
        if(showQr&&code){
          const canvas=win.document.getElementById(item._qrId);
          if(canvas) try{ win.QRCode.toCanvas(canvas,code,{width:qrSz,margin:1},()=>{}); }catch(e){}
        }
      });
      setTimeout(()=>win.print(),400);
    }catch(e){ setTimeout(()=>win.print(),800); }
  },600);
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
  ["tienda","ventas","clientes","pers","Exchanges"].forEach(t=>{
    const key = t==="Exchanges" ? "datPaneExchanges" : "datPane"+t.charAt(0).toUpperCase()+t.slice(1);
    const p=document.getElementById(key);
    const w = t==="Exchanges" ? "exchanges" : t;
    if(p) p.style.display = which===w?"block":"none";
  });
  const tabMap={tienda:"datTab1",ventas:"datTab4",clientes:"datTab5",pers:"datTab3",exchanges:"datTab6"};
  Object.entries(tabMap).forEach(([t,id])=>{ const b=document.getElementById(id); if(b) b.classList.toggle("on",which===t); });
  if(which==="pers") loadCustomOrders();
  if(which==="ventas") loadSalesHistory();
  if(which==="clientes") initClientesTab();
  if(which==="exchanges") loadExchangesTab();
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
  const fields = "select=id,shopify_order_name,shopify_order_id,total,status,sale_type,created_at,customer_name,customer_doc,customer_phone,customer_email,alegra_invoice,items";
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
    const cancelada = s.status==="cancelada";
    const statusBadge = cancelada?'<span style="font-size:11px;background:#fee2e2;color:#b91c1c;border-radius:6px;padding:1px 6px;margin-left:4px">Cancelada</span>':'';
    card.innerHTML=`
      <div class="sale-card-main">
        <div>
          <div><b>${money(s.total)}</b>${statusBadge} <span style="font-size:11px;color:var(--text-dim)">${esEnvio?"<span class=\"material-symbols-outlined\" style=\"font-size:13px;vertical-align:-3px;color:#25d366\">chat</span> WhatsApp":"<span class=\"material-symbols-outlined\" style=\"font-size:13px;vertical-align:-3px\">storefront</span> Tienda"}</span></div>
          <div style="font-size:12px;color:var(--text-dim)">${esc(s.customer_name||"Sin cliente")}${s.customer_doc?' · '+esc(s.customer_doc):''}${s.customer_phone?' · '+esc(s.customer_phone):''} · ${fecha}</div>
          ${s.shopify_order_name?`<div style="font-size:11px;color:var(--text-dim)">${esc(s.shopify_order_name)}</div>`:''}
          ${s.alegra_invoice?`<div style="font-size:11px;color:#1d8a5e">✓ Factura Alegra: ${esc(s.alegra_invoice)}</div>`:""}
        </div>
        <button class="sale-menu-btn" onclick="toggleSaleMenu('${s.id}')">⋮</button>
      </div>
      <div class="sale-menu" id="saleMenu-${s.id}">
        ${esEnvio?`<button onclick="printLabel('${s.id}')"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-3px">label</span> Imprimir etiqueta</button>`:""}
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

  let retTotal = retItems.reduce((s,i)=>s+Number(i.price)*(i.qty||1),0);

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

    // Monto real de reembolso (puede ser parcial)
    const calcRetTotal = retItems.reduce((s,i)=>s+Number(i.price)*(i.qty||1),0);
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
  await loadPipelines();
  await loadQuickReplies();
  await loadChats();
  startRealtime();
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("sw.js").catch(()=>{});
    // Cuando el SW se actualiza y toma control, mostrar banner de actualización
    navigator.serviceWorker.addEventListener("controllerchange",()=>{
      const b=document.getElementById("updateBanner");
      if(b) b.style.display="flex";
    });
  }
}
init();
