// Bloom Dashboard - Config
// Emojis escritos como codigo (\u) para que nunca se danen al guardar.

window.CONFIG = {
  SUPABASE_URL:  "https://qojehszkcuggmjxefvnv.supabase.co",
  SUPABASE_ANON: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvamVoc3prY3VnZ21qeGVmdm52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0MTUzNTQsImV4cCI6MjA5Nzk5MTM1NH0.X8MtH94vQWWQue4Qcx-Bh_UswMPbQpasN429QYrDpZs",
  WORKER_URL:    "https://bloomchat.jguillermoduran1988.workers.dev",
  PUSH_WORKER_URL: "https://bloom-push.jguillermoduran1988.workers.dev",
  VAPID_PUBLIC_KEY: "BCJkeaADQxgsngaycI9qAR_JwWbyKcMC7J4Wx7K11Z87ySVB4X8pokIWhAeAq1YCSnInoAhGulIeViXAFTbxTNE",
  STORE:         "bloom",

  DEMO_PRODUCTS: [
    { id:1, name:"Bikini Santorini negro",  price:129000, emoji:"\u{1F459}", stock:3, sizes:["S","M","L"] },
    { id:2, name:"Bikini Bali tropical",    price:119000, emoji:"\u{1F33A}", stock:5, sizes:["M","XL"] },
    { id:3, name:"Traje entero negro",      price:165000, emoji:"\u{1FAB1}", stock:4, sizes:["S","M","L"] },
    { id:4, name:"Pareo floral",            price:59000,  emoji:"\u{1F338}", stock:8, sizes:["M","L","XL"] },
    { id:5, name:"Bikini coral verano",     price:109000, emoji:"\u{1FAB8}", stock:2, sizes:["S","M"] },
    { id:6, name:"Salida de bano blanca",   price:89000,  emoji:"\u{1F457}", stock:6, sizes:["S","M","L"] },
  ],

  SUGGESTED_TAGS: ["VIP","talla S","talla M","talla L","Cartagena","mayorista","recompra","Instagram"],
};

(function loadBloomPushClient(){
  if (window.__bloomPushClientLoading) return;
  window.__bloomPushClientLoading = true;
  const script = document.createElement("script");
  script.src = "push-client.js?v=2";
  script.defer = true;
  document.head.appendChild(script);
})();
