// Ejecutar: node run_import.js
// Llama al worker en loop hasta importar todas las órdenes de Shopify

const WORKER = "https://bloomchat.jguillermoduran1988.workers.dev/import-orders";

(async () => {
  let cursor = null;
  let totalImported = 0;
  let totalSkipped = 0;
  let page = 1;

  console.log("Iniciando importación Shopify → Supabase...\n");

  while (true) {
    const url = cursor ? `${WORKER}?cursor=${encodeURIComponent(cursor)}` : WORKER;
    const r = await fetch(url);
    const data = await r.json();

    if (!data.ok) {
      console.error("Error en batch:", data.error);
      break;
    }

    totalImported += data.imported;
    totalSkipped  += data.skipped;
    console.log(`Página ${page}: ${data.imported} importadas, ${data.skipped} saltadas (ya existían o error) | Total: ${totalImported}`);

    if (data.done) break;
    cursor = data.nextCursor;
    page++;
    await new Promise(r => setTimeout(r, 300)); // pausa breve entre llamadas
  }

  console.log(`\n✓ Listo. Importadas: ${totalImported} | Saltadas: ${totalSkipped}`);
})();
