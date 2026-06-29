// ====================================================================
//  Cloudflare Worker — Bloom WhatsApp
//  Recibe mensajes, captura REFERRAL (historia/pauta) y envía respuestas.
//  Variables de entorno necesarias:
//    VERIFY_TOKEN, WA_TOKEN, WA_PHONE_ID, SUPABASE_URL, SUPABASE_SERVICE_KEY
// ====================================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    // -------- Verificación del webhook (Meta hace GET una vez) --------
    if (request.method === "GET" && url.pathname === "/webhook") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (mode === "subscribe" && token === env.VERIFY_TOKEN)
        return new Response(challenge, { status: 200 });
      return new Response("Forbidden", { status: 403 });
    }

    // -------- Mensajes entrantes --------
    if (request.method === "POST" && url.pathname === "/webhook") {
      const body = await request.json();
      try {
        const value = body?.entry?.[0]?.changes?.[0]?.value;
        const msg = value?.messages?.[0];
        const contact = value?.contacts?.[0];
        if (msg) await handleIncoming(env, msg, contact);
      } catch (e) { console.error(e); }
      return new Response("OK", { status: 200 });
    }

    // -------- Enviar mensaje desde el dashboard --------
    if (request.method === "POST" && url.pathname === "/send") {
      const { phone, message } = await request.json();
      const r = await sendWhatsApp(env, phone, message);
      return Response.json(r, { headers: cors });
    }

    // -------- Productos de Shopify (para el selector) --------
    if (request.method === "GET" && url.pathname === "/products") {
      const q = url.searchParams.get("q") || "";
      const products = await fetchShopify(env, q);
      return Response.json(products, { headers: cors });
    }

    // -------- Actualizar SKU de variante en Shopify --------
    if (request.method === "POST" && url.pathname === "/update-sku") {
      const { variant_id, sku } = await request.json();
      const shopHeaders = { "X-Shopify-Access-Token": env.SHOPIFY_TOKEN, "Content-Type": "application/json" };
      const r = await fetch(`https://${env.SHOPIFY_STORE}/admin/api/2024-10/variants/${variant_id}.json`, {
        method: "PUT", headers: shopHeaders,
        body: JSON.stringify({ variant: { id: variant_id, sku } })
      });
      const data = await r.json();
      if (!r.ok) return Response.json({ ok: false, error: JSON.stringify(data.errors || data) }, { headers: cors });
      return Response.json({ ok: true, sku: data.variant?.sku }, { headers: cors });
    }

    // -------- POS: crear venta -> orden en Shopify --------
    if (request.method === "POST" && url.pathname === "/order") {
      const order = await request.json();
      const result = await createShopifyOrder(env, order);
      return Response.json(result, { headers: cors });
    }

    // Debug: prueba qué datos de cliente llegan y crea el cliente
    if (request.method === "POST" && url.pathname === "/debug-customer") {
      const body = await request.json();
      const cust = body.customer || body;
      const id = await findOrCreateShopifyCustomer(env, cust);
      return Response.json({ received: cust, customer_id: id }, { headers: cors });
    }

    // -------- Buscar cliente en Shopify por teléfono --------
    if (request.method === "GET" && url.pathname === "/customer") {
      const phone = url.searchParams.get("phone") || "";
      const c = await findCustomer(env, phone);
      return Response.json(c, { headers: cors });
    }

    // -------- Crear producto rápido en Shopify --------
    if (request.method === "POST" && url.pathname === "/create-product") {
      const body = await request.json();
      const result = await createQuickProduct(env, body);
      return Response.json(result, { headers: cors });
    }

    // -------- Webhook Shopify: importar pedidos Online Store al POS --------
    if (request.method === "POST" && url.pathname === "/shopify-webhook") {
      const order = await request.json();
      // Solo Online Store (web); ignorar BR Sales (6133741) y Bloom POS
      if (order.source_name !== "web") return new Response("skip", { status: 200, headers: cors });
      const result = await importShopifyOnlineOrder(env, order);
      return Response.json(result, { headers: cors });
    }

    // -------- Importar pedido Shopify manualmente por nombre (#XXXX) --------
    if (request.method === "POST" && url.pathname === "/import-order") {
      const { order_name, force } = await request.json();
      if (!order_name) return Response.json({ ok: false, error: "falta order_name" }, { headers: cors });
      const shopHeaders = { "X-Shopify-Access-Token": env.SHOPIFY_TOKEN };
      const r = await fetch(`https://${env.SHOPIFY_STORE}/admin/api/2024-10/orders.json?name=${encodeURIComponent(order_name)}&status=any&limit=1`, { headers: shopHeaders });
      if (!r.ok) return Response.json({ ok: false, error: "Shopify error " + r.status }, { headers: cors });
      const data = await r.json();
      const order = data.orders?.[0];
      if (!order) return Response.json({ ok: false, error: "pedido no encontrado en Shopify" }, { headers: cors });
      // force: devuelve datos crudos del pedido sin importar (para diagnóstico)
      if (force === "inspect") return Response.json({
        id: order.id, name: order.name, source_name: order.source_name,
        email: order.email, contact_email: order.contact_email, phone: order.phone,
        payment_gateway: order.payment_gateway, payment_gateway_names: order.payment_gateway_names,
        customer: order.customer ? { name: `${order.customer.first_name||""} ${order.customer.last_name||""}`.trim(), email: order.customer.email, phone: order.customer.phone } : null,
        shipping_address: order.shipping_address || null,
        billing_address: order.billing_address || null,
        total_price: order.total_price,
      }, { headers: cors });
      const result = await importShopifyOnlineOrder(env, order);
      return Response.json({ ...result, order_name: order.name, source: order.source_name }, { headers: cors });
    }

    // -------- Buscar cliente en la DIAN vía Alegra --------
    if (request.method === "GET" && url.pathname === "/dian") {
      const idType = url.searchParams.get("idType") || "CC";
      const id = url.searchParams.get("id") || "";
      const result = await searchDian(env, idType, id);
      return Response.json(result, { headers: cors });
    }

    // -------- Crear factura en Alegra (borrador) --------
    if (request.method === "POST" && url.pathname === "/alegra-invoice") {
      const body = await request.json();
      const result = await createAlegraInvoice(env, body);
      return Response.json(result, { headers: cors });
    }

    // -------- Cambio / Garantía en Shopify --------
    if (request.method === "POST" && url.pathname === "/exchange") {
      const { shopify_order_id, original_order_name, returned_items, replacement, customer, reason, notes, dry_run, refund_amount: customRefundAmount, charge_payment } = await request.json();
      if (!shopify_order_id) return Response.json({ ok: false, error: "sin shopify_order_id" }, { headers: cors });
      try {
        const shopHeaders = { "X-Shopify-Access-Token": env.SHOPIFY_TOKEN, "Content-Type": "application/json" };

        // 1) Orden original — line_items + transacciones (endpoint separado)
        const [orderR, txR] = await Promise.all([
          fetch(`https://${env.SHOPIFY_STORE}/admin/api/2024-10/orders/${shopify_order_id}.json?fields=line_items`, { headers: shopHeaders }),
          fetch(`https://${env.SHOPIFY_STORE}/admin/api/2024-10/orders/${shopify_order_id}/transactions.json`, { headers: shopHeaders }),
        ]);
        const orderData = await orderR.json();
        const txData = await txR.json();
        const lineItems = orderData.order?.line_items || [];
        const transactions = txData.transactions || [];
        const saleTx = transactions.find(t => ["sale","capture"].includes(t.kind) && t.status === "success");

        // 2) Ubicación principal (para restock)
        const locR = await fetch(`https://${env.SHOPIFY_STORE}/admin/api/2024-10/locations.json`, { headers: shopHeaders });
        const locData = await locR.json();
        const locationId = locData.locations?.[0]?.id;

        // 3) Construir refund_line_items haciendo match por SKU o nombre+variante
        let refundTotal = 0;
        const refundLineItems = [];
        for (const ret of (returned_items || [])) {
          const match = lineItems.find(li =>
            (ret.sku && li.sku && li.sku === ret.sku) ||
            (li.name === ret.name) ||
            (li.title === ret.name && li.variant_title === ret.variant)
          );
          if (match) {
            refundLineItems.push({ line_item_id: match.id, quantity: ret.qty || 1, restock_type: locationId ? "return" : "cancel", location_id: locationId || undefined });
            refundTotal += Number(match.price) * (ret.qty || 1);
          }
        }

        // Si no hay ítems identificables pero hay monto personalizado → reembolso monetario puro
        const monetaryOnly = refundLineItems.length === 0 && customRefundAmount > 0;
        if (!refundLineItems.length && !monetaryOnly) {
          return Response.json({ ok: false, error: "no se encontraron los ítems en la orden de Shopify" }, { headers: cors });
        }

        // Monto final: usar el personalizado si viene (devolución parcial), sino el calculado
        const finalRefundAmount = (customRefundAmount > 0) ? customRefundAmount : refundTotal;

        // dry_run
        if (dry_run) {
          return Response.json({
            ok: true, dry_run: true,
            matched_items: refundLineItems,
            refund_amount: finalRefundAmount,
            location_id: locationId,
            sale_transaction: saleTx ? { id: saleTx.id, gateway: saleTx.gateway, amount: saleTx.amount } : null,
            replacement_items: replacement || [],
          }, { headers: cors });
        }

        // 4) Crear reembolso
        const refundBody = { refund: { notify: false } };
        if (refundLineItems.length) refundBody.refund.refund_line_items = refundLineItems;
        if (saleTx && finalRefundAmount > 0) {
          refundBody.refund.transactions = [{ parent_id: saleTx.id, amount: String(finalRefundAmount.toFixed(2)), kind: "refund", gateway: saleTx.gateway }];
        }
        const refR = await fetch(`https://${env.SHOPIFY_STORE}/admin/api/2024-10/orders/${shopify_order_id}/refunds.json`, { method: "POST", headers: shopHeaders, body: JSON.stringify(refundBody) });
        const refData = await refR.json();
        if (!refR.ok) return Response.json({ ok: false, error: "refund error: " + JSON.stringify(refData) }, { headers: cors });

        // 5) Nueva orden para el ítem de reemplazo
        let newOrderName = null, newOrderId = null;
        if (replacement && replacement.length) {
          const chargeTotal = replacement.reduce((s, i) => s + Number(i.price) * (i.qty || 1), 0);
          const diff = Math.max(0, chargeTotal - finalRefundAmount);
          const paymentLabel = charge_payment
            ? (diff > 0 ? `${charge_payment} (diferencia $${diff.toFixed(0)})` : charge_payment)
            : (diff > 0 ? "Cambio — diferencia pendiente" : "Cambio sin costo");
          const newOrder = await createShopifyOrder(env, {
            customer: customer || {},
            items: replacement,
            total: diff,
            sale_type: "tienda",
            payment: paymentLabel,
            note: `Cambio de ${original_order_name}. Razón: ${reason || "cambio"}. ${notes || ""}`.trim(),
            tags: ["cambio", `cambio-de-${original_order_name}`],
            financial_status: diff > 0 ? "pending" : "paid",
          });
          newOrderName = newOrder.order_name || null;
          newOrderId = newOrder.order_id || null;
        }

        // 6) Nota en la orden original
        const reasonLabel = { cambio: "Cambio", garantia: "Garantía", devolucion: "Devolución" }[reason] || reason || "Cambio";
        await fetch(`https://${env.SHOPIFY_STORE}/admin/api/2024-10/orders/${shopify_order_id}.json`, {
          method: "PUT", headers: shopHeaders,
          body: JSON.stringify({ order: { id: shopify_order_id,
            note: `${reasonLabel} procesado${newOrderName ? " → nuevo pedido " + newOrderName : ""}. ${notes || ""}`.trim(),
            tags: reason || "cambio" } }),
        });

        return Response.json({ ok: true, refund_id: refData.refund?.id, refund_amount: finalRefundAmount, new_order_name: newOrderName, new_order_id: newOrderId }, { headers: cors });
      } catch (e) {
        return Response.json({ ok: false, error: e.message }, { headers: cors });
      }
    }

    // -------- Cancelar o reembolsar venta en Shopify --------
    if (request.method === "POST" && url.pathname === "/refund") {
      const { shopify_order_id, amount, full } = await request.json();
      if (!shopify_order_id) return Response.json({ ok: false, error: "sin shopify_order_id" }, { headers: cors });
      try {
        if (full) {
          // Cancelación completa
          const r = await fetch(
            `https://${env.SHOPIFY_STORE}/admin/api/2024-10/orders/${shopify_order_id}/cancel.json`,
            { method: "POST", headers: { "X-Shopify-Access-Token": env.SHOPIFY_TOKEN, "Content-Type": "application/json" }, body: "{}" }
          );
          const d = await r.json();
          if (!r.ok) return Response.json({ ok: false, error: JSON.stringify(d) }, { headers: cors });
          return Response.json({ ok: true, cancelled: true }, { headers: cors });
        } else {
          // Reembolso parcial — primero obtenemos la transacción original
          const txR = await fetch(
            `https://${env.SHOPIFY_STORE}/admin/api/2024-10/orders/${shopify_order_id}/transactions.json`,
            { headers: { "X-Shopify-Access-Token": env.SHOPIFY_TOKEN } }
          );
          const txData = await txR.json();
          const saleTx = (txData.transactions || []).find(t => t.kind === "sale" && t.status === "success");
          if (!saleTx) return Response.json({ ok: false, error: "no se encontró transacción de venta" }, { headers: cors });
          const refundBody = {
            refund: {
              currency: "COP",
              notify: false,
              transactions: [{ parent_id: saleTx.id, amount: String(amount), kind: "refund", gateway: saleTx.gateway }],
            },
          };
          const rr = await fetch(
            `https://${env.SHOPIFY_STORE}/admin/api/2024-10/orders/${shopify_order_id}/refunds.json`,
            { method: "POST", headers: { "X-Shopify-Access-Token": env.SHOPIFY_TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(refundBody) }
          );
          const rd = await rr.json();
          if (!rr.ok) return Response.json({ ok: false, error: JSON.stringify(rd) }, { headers: cors });
          return Response.json({ ok: true, refund_id: rd.refund?.id }, { headers: cors });
        }
      } catch (e) {
        return Response.json({ ok: false, error: e.message }, { headers: cors });
      }
    }

    // -------- WhatsApp Inbox: lista de conversaciones --------
    if (request.method === "GET" && url.pathname === "/wa/conversations") {
      const store = url.searchParams.get("store") || "bloom";
      const status = url.searchParams.get("status") || "all";
      const whereStatus = status === "all" ? "" : "AND c.status = ?";
      const binds = status === "all" ? [store] : [store, status];
      const result = await env.bloom_wa.prepare(`
        SELECT c.id, c.phone, c.status, c.assigned_to,
               c.last_message, c.last_message_at, c.unread_count, c.updated_at,
               c.pipeline_id, c.stage,
               ct.name as contact_name, ct.email as contact_email, ct.avatar as contact_avatar, ct.tags as contact_tags
        FROM wa_conversations c
        LEFT JOIN wa_contacts ct ON ct.phone = c.phone
        WHERE c.store = ? ${whereStatus}
        ORDER BY c.updated_at DESC
        LIMIT 80
      `).bind(...binds).all();
      return Response.json(result.results || [], { headers: cors });
    }

    // -------- WhatsApp Inbox: mensajes de una conversación --------
    if (request.method === "GET" && url.pathname.startsWith("/wa/conversations/") && url.pathname.endsWith("/messages")) {
      const convId = decodeURIComponent(url.pathname.split("/")[3]);
      const result = await env.bloom_wa.prepare(
        `SELECT * FROM wa_messages WHERE conversation_id = ? ORDER BY ts ASC LIMIT 120`
      ).bind(convId).all();
      return Response.json(result.results || [], { headers: cors });
    }

    // -------- WhatsApp Inbox: marcar conversación como leída --------
    if (request.method === "POST" && url.pathname.startsWith("/wa/conversations/") && url.pathname.endsWith("/read")) {
      const convId = decodeURIComponent(url.pathname.split("/")[3]);
      await env.bloom_wa.prepare(
        `UPDATE wa_conversations SET unread_count = 0 WHERE id = ?`
      ).bind(convId).run();
      return Response.json({ ok: true }, { headers: cors });
    }

    // -------- WhatsApp Inbox: enviar mensaje --------
    if (request.method === "POST" && url.pathname === "/wa/send") {
      const { conversation_id, phone, body, media_url, type } = await request.json();
      if (!conversation_id) return Response.json({ ok: false, error: "faltan campos" }, { headers: cors });
      if (!body && !media_url) return Response.json({ ok: false, error: "faltan campos" }, { headers: cors });
      const now = new Date().toISOString();
      const msgId = "out-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
      const msgType = type || "text";
      const msgBody = body || "";
      await env.bloom_wa.prepare(
        `INSERT INTO wa_messages (id, conversation_id, direction, type, body, media_url, status, ts) VALUES (?, ?, 'outbound', ?, ?, ?, 'sent', ?)`
      ).bind(msgId, conversation_id, msgType, msgBody, media_url || null, now).run();
      const lastMsg = media_url ? (msgType === "image" ? "📷 Foto" : "🎤 Nota de voz") : msgBody;
      await env.bloom_wa.prepare(
        `UPDATE wa_conversations SET last_message = ?, last_message_at = ?, updated_at = ? WHERE id = ?`
      ).bind(lastMsg, now, now, conversation_id).run();
      // Envío real cuando esté configurado WA_TOKEN
      if (env.WA_TOKEN && env.WA_PHONE_ID && phone && msgBody) {
        await sendWhatsApp(env, phone, msgBody).catch(() => {});
      }
      return Response.json({ ok: true, id: msgId }, { headers: cors });
    }

    // -------- PATCH conversación: stage, pipeline_id --------
    if (request.method === "PATCH" && url.pathname.startsWith("/wa/conversations/")) {
      const convId = decodeURIComponent(url.pathname.split("/")[3]);
      const updates = await request.json();
      const fields = []; const values = [];
      if (updates.stage !== undefined) { fields.push("stage = ?"); values.push(updates.stage); }
      if (updates.pipeline_id !== undefined) { fields.push("pipeline_id = ?"); values.push(updates.pipeline_id); }
      if (updates.assigned_to !== undefined) { fields.push("assigned_to = ?"); values.push(updates.assigned_to); }
      if (!fields.length) return Response.json({ ok: false, error: "no fields" }, { headers: cors });
      fields.push("updated_at = ?"); values.push(new Date().toISOString()); values.push(convId);
      await env.bloom_wa.prepare(`UPDATE wa_conversations SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
      return Response.json({ ok: true }, { headers: cors });
    }

    // -------- PATCH contacto: tags --------
    if (request.method === "PATCH" && url.pathname.startsWith("/wa/contacts/")) {
      const phone = decodeURIComponent(url.pathname.split("/")[3]);
      const updates = await request.json();
      const fields = []; const values = [];
      if (updates.tags !== undefined) { fields.push("tags = ?"); values.push(JSON.stringify(updates.tags)); }
      if (updates.name !== undefined) { fields.push("name = ?"); values.push(updates.name); }
      if (!fields.length) return Response.json({ ok: false, error: "no fields" }, { headers: cors });
      fields.push("updated_at = ?"); values.push(new Date().toISOString()); values.push(phone);
      await env.bloom_wa.prepare(`UPDATE wa_contacts SET ${fields.join(", ")} WHERE phone = ?`).bind(...values).run();
      return Response.json({ ok: true }, { headers: cors });
    }

    return new Response("Not found", { status: 404 });
  },
};

// ============ Crear factura en Alegra ============
const ALEGRA_BASE = "https://api.alegra.com/api/v1";
const ALEGRA_WAREHOUSE_ID = 2;       // bodega
const ALEGRA_RESOLUTION_ID = 20;     // numeración de facturación
const ALEGRA_TAX_ID = 3;             // IVA 19% (id confirmado en cuenta Alegra)

function alegraAuth(env) {
  return "Basic " + btoa(`${env.ALEGRA_EMAIL}:${env.ALEGRA_KEY}`);
}

// Busca un producto en Alegra por referencia (código de barras)
async function findAlegraItem(env, reference) {
  if (!reference) return null;
  const r = await fetch(`${ALEGRA_BASE}/items?reference=${encodeURIComponent(reference)}`, {
    headers: { Authorization: alegraAuth(env), Accept: "application/json" },
  });
  if (!r.ok) return null;
  const data = await r.json();
  const arr = Array.isArray(data) ? data : (data.data || []);
  const found = arr.find(it => String(it.reference) === String(reference));
  return found || (arr.length ? arr[0] : null);
}

// Crea un producto en Alegra (bodega 2, con IVA 19%)
async function createAlegraItem(env, { name, price, reference }) {
  // El precio de Bloom incluye IVA; Alegra guarda el precio base SIN IVA
  const priceWithoutTax = Math.round((Number(price) / 1.19) * 100) / 100;
  const payload = {
    name,
    reference: reference || undefined,
    price: [{ idPriceList: 1, price: priceWithoutTax }],
    tax: [{ id: ALEGRA_TAX_ID }],
    type: "product",
  };
  const r = await fetch(`${ALEGRA_BASE}/items`, {
    method: "POST",
    headers: { Authorization: alegraAuth(env), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  if (!r.ok) throw new Error("crear item: " + JSON.stringify(data));
  return data;
}

async function createAlegraInvoice(env, sale) {
  if (!env.ALEGRA_EMAIL || !env.ALEGRA_KEY)
    return { ok: false, error: "Alegra no configurado" };
  try {
    // 1) Cliente: busca por documento, si no existe lo crea
    const cust = sale.customer || {};
    let clientId = await findOrCreateAlegraClient(env, cust);

    // 2) Productos: por cada ítem, busca por referencia (código de barras) o lo crea
    const saleItems = sale.items || [];
    const saleTotal = sale.total || 0;
    // Total de catálogo (precios originales × cantidades)
    const catalogTotal = saleItems.reduce((s, it) => s + (it.price || 0) * (it.qty || 1), 0);
    // Ratio para escalar precios al total real de la venta (incluye descuentos)
    const priceRatio = catalogTotal > 0 && saleTotal > 0 ? saleTotal / catalogTotal : 1;

    const items = [];
    for (const it of saleItems) {
      const ref = it.barcode || it.sku || null;
      let alegraItem = await findAlegraItem(env, ref);
      if (!alegraItem) {
        const fullName = it.variant ? `${it.name} - ${it.variant}` : it.name;
        alegraItem = await createAlegraItem(env, { name: fullName, price: it.price, reference: ref });
      }
      // Precio escalado al total real de la venta (descuentos incluidos),
      // luego dividido por 1.19 para obtener la base sin IVA que Alegra necesita.
      const scaledPrice = it.price * priceRatio;
      const basePrice = Math.round((scaledPrice / 1.19) * 100) / 100;
      items.push({
        id: alegraItem.id,
        quantity: it.qty || 1,
        price: basePrice,
        tax: [{ id: ALEGRA_TAX_ID }],
      });
    }

    // 3) Crea la factura en BORRADOR (status: draft)
    const today = new Date().toISOString().slice(0, 10);
    const invoicePayload = {
      date: today,
      dueDate: today,
      client: { id: clientId },           // Alegra espera objeto {id}
      items,
      warehouse: { id: ALEGRA_WAREHOUSE_ID },
      ...(ALEGRA_RESOLUTION_ID ? { numberTemplate: { id: ALEGRA_RESOLUTION_ID } } : {}),
      paymentForm: "CASH",                 // forma de pago DIAN: contado
      status: "draft",                     // borrador explícito
      anotation: `Venta POS Bloom${sale.order_name ? " · " + sale.order_name : ""}`,
    };
    const r = await fetch(`${ALEGRA_BASE}/invoices`, {
      method: "POST",
      headers: { Authorization: alegraAuth(env), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(invoicePayload),
    });
    const data = await r.json();
    if (!r.ok) return { ok: false, error: JSON.stringify(data) };
    return { ok: true, invoice_id: data.id, number: data.numberTemplate?.fullNumber || data.number || null };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function findOrCreateAlegraClient(env, cust) {
  // busca por identificación
  if (cust.doc) {
    const r = await fetch(`${ALEGRA_BASE}/contacts?identification=${encodeURIComponent(cust.doc)}`, {
      headers: { Authorization: alegraAuth(env), Accept: "application/json" },
    });
    if (r.ok) {
      const data = await r.json();
      const arr = Array.isArray(data) ? data : (data.data || []);
      // coincidencia exacta de identificación
      const exact = arr.find(c => String(c.identification) === String(cust.doc));
      if (exact) return exact.id;
      if (arr.length) return arr[0].id;
    }
  }
  // crea el cliente (estructura Colombia)
  const esEmpresa = cust.is_company || false;
  const payload = {
    name: cust.full_name || cust.name || "Consumidor final",
    identification: cust.doc || undefined,
    email: cust.email || undefined,
    phonePrimary: cust.phone || undefined,
    mobile: cust.phone || undefined,
    address: (cust.address && cust.city && cust.depto) ? {
      address: cust.address,
      city: cust.city,
      department: cust.depto,
      country: "COL",
    } : undefined,
    type: "client",
    // Datos fiscales Colombia
    identificationObject: cust.doc ? {
      type: esEmpresa ? "NIT" : "CC",
      number: cust.doc,
    } : undefined,
    kindOfPerson: esEmpresa ? "LEGAL_ENTITY" : "PERSON_ENTITY",
    regime: "SIMPLIFIED_REGIME",
    ignoreRepeated: true,   // no falla si ya existe
  };
  const r = await fetch(`${ALEGRA_BASE}/contacts`, {
    method: "POST",
    headers: { Authorization: alegraAuth(env), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  if (!r.ok) throw new Error("crear cliente: " + JSON.stringify(data));
  return data.id;
}

// ============ Buscar contribuyente en la DIAN (Alegra) ============
async function searchDian(env, idType, identification) {
  if (!env.ALEGRA_EMAIL || !env.ALEGRA_KEY)
    return { ok: false, error: "Alegra no configurado" };
  try {
    // Alegra usa autenticación básica: base64(email:api_key)
    const auth = btoa(`${env.ALEGRA_EMAIL}:${env.ALEGRA_KEY}`);
    const r = await fetch(
      `https://api-contacts.alegra.com/api/search-by-id-number?idType=${encodeURIComponent(idType)}&identification=${encodeURIComponent(identification)}&version=colombia`,
      { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } }
    );
    if (!r.ok) {
      const txt = await r.text();
      return { ok: false, error: `Alegra ${r.status}: ${txt}` };
    }
    const data = await r.json();
    if (!data || !data.name) return { ok: false, notFound: true };

    // Separa nombres y apellidos (Alegra devuelve "APELLIDO1 APELLIDO2 NOMBRE1 NOMBRE2")
    const full = (data.name || "").trim();
    const emails = (data.email || "").split(",").map(e => e.trim()).filter(Boolean);
    return {
      ok: true,
      full_name: full,
      email: emails[0] || "",
      kind_of_person: data.kindOfPerson || "",   // PERSON_ENTITY | COMPANY...
      regime: data.regime || "",
      is_company: data.kindOfPerson === "COMPANY_ENTITY" || data.kindOfPerson === "LEGAL_ENTITY",
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ============ Crear producto rápido en Shopify ============
async function createQuickProduct(env, { name, price, color, size }) {
  if (!env.SHOPIFY_STORE || !env.SHOPIFY_TOKEN)
    return { ok: false, error: "Shopify no configurado" };
  try {
    const variant = { price: String(price), inventory_management: "shopify", inventory_quantity: 99 };
    const options = [];
    if (color) { variant.option1 = color; options.push("Color"); }
    if (size)  { variant[color ? "option2" : "option1"] = size; options.push("Talla"); }

    const product = {
      title: name,
      status: "draft",        // oculto: no se publica en la tienda
      published: false,
      variants: [variant],
      tags: "POS, producto-rapido",
    };
    if (options.length) product.options = options.map((n) => ({ name: n }));

    const r = await fetch(
      `https://${env.SHOPIFY_STORE}/admin/api/2024-10/products.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": env.SHOPIFY_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ product }),
      }
    );
    const data = await r.json();
    if (!r.ok) return { ok: false, error: JSON.stringify(data) };
    const prod = data.product;
    const v = prod.variants && prod.variants[0];
    return { ok: true, product_id: prod.id, variant_id: v ? v.id : null };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ============ Crear orden en Shopify (Orders API) ============
async function createShopifyOrder(env, o) {
  if (!env.SHOPIFY_STORE || !env.SHOPIFY_TOKEN)
    return { ok: false, error: "Shopify no configurado" };

  const line_items = o.items.map(it => {
    const li = it.variant_id
      ? { variant_id: it.variant_id, quantity: it.qty }
      : { title: it.name, price: String(it.price), quantity: it.qty };
    if (it.note) li.properties = [{ name: "Observación", value: it.note }];
    return li;
  });

  const isTienda = o.sale_type === "tienda";
  const cust = o.customer || {};
  const detail = Array.isArray(o.payment_detail) ? o.payment_detail : [];

  // Busca o crea el cliente en Shopify y obtiene su ID (para vincularlo a la orden)
  let shopifyCustomerId = null;
  if (cust.full_name || cust.name || cust.email) {
    try { shopifyCustomerId = await findOrCreateShopifyCustomer(env, cust); }
    catch (e) { /* si falla, sigue sin vincular */ }
  }

  // Tags: POS, vendedor, cajero, y un tag por cada medio de pago
  const tags = [
    "POS",
    `vendedor:${o.seller || "—"}`,
    `cajero:${o.cashier || "—"}`,
    (o.sale_type === "envios" || o.sale_type === "envíos" || o.sale_type === "despacho") ? "envio" : "tienda",
    ...detail.map(d => `pago:${d.method}`),
  ].filter(Boolean).join(", ");

  // Nota con el detalle del pago mixto
  const payNote = detail.length
    ? detail.map(d => `${d.method}: $${Number(d.amount).toLocaleString("es-CO")}`).join(" + ")
    : (o.payment || "");
  const note =
    `Venta POS · ${o.sale_type} · Vendedor: ${o.seller || "—"} · Cajero: ${o.cashier || "—"}` +
    (payNote ? ` · Pago: ${payNote}` : "") +
    (cust.doc ? ` · ${cust.doc_type || "CC"}: ${cust.doc}` : "") +
    (o.billing ? ` · FACTURA EMPRESA: ${o.billing.razon_social} NIT ${o.billing.nit}` : "");

  // Transacciones (gateway) — una por cada medio de pago
  const transactions = detail.length
    ? detail.map(d => ({ kind: "sale", status: "success", gateway: d.method, amount: String(d.amount) }))
    : undefined;

  // Cédula/NIT va en el campo "company" (convención Colombia para DIAN)
  const docForCompany = o.billing ? o.billing.nit : (cust.doc || "");

  const addr = cust.address ? {
    first_name: cust.name || cust.full_name, last_name: cust.last_name || "",
    address1: cust.address, city: cust.city || "", province: cust.depto || "",
    country: "Colombia", phone: cust.phone || "",
    company: docForCompany || undefined,
  } : null;

  const order = {
    line_items,
    taxes_included: true,            // los precios YA incluyen IVA (Colombia)
    currency: "COP",
    tags,
    note,
    source_name: "Bloom POS",
    ...(cust.phone ? { phone: cust.phone } : {}),
    ...(shopifyCustomerId ? {
      customer: { id: shopifyCustomerId },
    } : (cust.full_name || cust.name ? {
      customer: {
        first_name: cust.name || cust.full_name,
        last_name: cust.last_name || "",
        ...(cust.email ? { email: cust.email } : {}),
        ...(cust.phone ? { phone: cust.phone } : {}),
      },
    } : {})),
    ...(addr ? { shipping_address: addr, billing_address: addr } : {}),
  };

  // ---- MODO BORRADOR (pruebas) vs PAGADA ----
  if (o.draft) {
    // Draft Order usa applied_discount (no discount_codes)
    if (o.discount) {
      order.applied_discount = {
        title: o.discount.type === "pct" ? `Descuento ${o.discount.value}%` : "Descuento",
        value_type: o.discount.type === "pct" ? "percentage" : "fixed_amount",
        value: String(o.discount.type === "pct" ? o.discount.value : o.discount.amount),
        amount: String(o.discount.amount),
      };
    }
    const r = await fetch(
      `https://${env.SHOPIFY_STORE}/admin/api/2024-10/draft_orders.json`,
      {
        method: "POST",
        headers: { "X-Shopify-Access-Token": env.SHOPIFY_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({ draft_order: order }),
      }
    );
    const data = await r.json();
    if (!r.ok) return { ok: false, error: JSON.stringify(data?.errors || data) };
    const draftId = data.draft_order.id;
    // Envía el correo de cotización al cliente (si tiene email)
    if (cust.email) {
      try {
        await fetch(
          `https://${env.SHOPIFY_STORE}/admin/api/2024-10/draft_orders/${draftId}/send_invoice.json`,
          {
            method: "POST",
            headers: { "X-Shopify-Access-Token": env.SHOPIFY_TOKEN, "Content-Type": "application/json" },
            body: JSON.stringify({
              draft_order_invoice: {
                to: cust.email,
                subject: "Tu pedido en Bloom 🌸",
                custom_message: "¡Gracias por tu compra! Aquí está el detalle de tu pedido.",
              }
            }),
          }
        );
      } catch (e) { /* si falla el correo, la venta igual se crea */ }
    }
    return { ok: true, draft: true, order_id: String(draftId), order_name: data.draft_order.name };
  }

  // Orden real, pagada
  order.financial_status = "paid";
  order.fulfillment_status = isTienda ? "fulfilled" : null;
  order.inventory_behaviour = "decrement_obeying_policy";
  if (cust.email) order.send_receipt = true;
  // Descuento en orden real: usa discount_codes
  if (o.discount) {
    order.discount_codes = [{
      code: o.discount.type === "pct" ? `DESC${o.discount.value}` : "DESCUENTO",
      amount: String(o.discount.amount),
      type: o.discount.type === "pct" ? "percentage" : "fixed_amount",
    }];
  }
  if (transactions) order.transactions = transactions;

  const r = await fetch(
    `https://${env.SHOPIFY_STORE}/admin/api/2024-10/orders.json`,
    {
      method: "POST",
      headers: { "X-Shopify-Access-Token": env.SHOPIFY_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
    }
  );
  const data = await r.json();
  if (!r.ok) return { ok: false, error: JSON.stringify(data?.errors || data) };
  return { ok: true, order_id: String(data.order.id), order_name: data.order.name };
}

// ============ Procesar entrante (guarda en D1) ============
async function handleIncoming(env, msg, contact) {
  const phone = msg.from;
  const name = contact?.profile?.name || phone;
  const text = msg.text?.body || msg.button?.text || "";
  const waId = msg.id;
  const now = new Date().toISOString();

  // Upsert contacto en D1
  await d1UpsertContact(env, phone, name);

  // Referral: actualizar datos del contacto y agregar mensaje especial
  const ref = msg.referral;
  if (ref) {
    await env.bloom_wa.prepare(
      `UPDATE wa_contacts SET ref_source = ?, ref_headline = ?, ref_ctwa_clid = ?, updated_at = ? WHERE phone = ? AND ref_source IS NULL`
    ).bind(ref.source_type || null, ref.headline || null, ref.ctwa_clid || null, now, phone).run();
  }

  // Crear o actualizar conversación (id = phone: una conversación activa por contacto)
  const convId = phone;
  const existing = await env.bloom_wa.prepare(
    `SELECT id FROM wa_conversations WHERE id = ?`
  ).bind(convId).first();

  if (!existing) {
    await env.bloom_wa.prepare(
      `INSERT INTO wa_conversations (id, phone, store, status, last_message, last_message_at, unread_count, updated_at) VALUES (?, ?, 'bloom', 'open', ?, ?, 1, ?)`
    ).bind(convId, phone, text, now, now).run();
  } else {
    await env.bloom_wa.prepare(
      `UPDATE wa_conversations SET last_message = ?, last_message_at = ?, unread_count = unread_count + 1, updated_at = ? WHERE id = ?`
    ).bind(text, now, now, convId).run();
  }

  // Guardar mensaje
  const msgId = "in-" + (waId || Date.now()) + "-" + Math.random().toString(36).slice(2, 6);
  await env.bloom_wa.prepare(
    `INSERT OR IGNORE INTO wa_messages (id, conversation_id, wa_message_id, direction, type, body, status, ts) VALUES (?, ?, ?, 'inbound', 'text', ?, 'delivered', ?)`
  ).bind(msgId, convId, waId || null, text, now).run();
}

async function d1UpsertContact(env, phone, name) {
  const now = new Date().toISOString();
  await env.bloom_wa.prepare(
    `INSERT INTO wa_contacts (phone, name, store, created_at, updated_at) VALUES (?, ?, 'bloom', ?, ?)
     ON CONFLICT(phone) DO UPDATE SET name = COALESCE(excluded.name, wa_contacts.name), updated_at = excluded.updated_at`
  ).bind(phone, name, now, now).run();
}

function sbHeaders(env, prefer) {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
}

// Mapa de gateways Shopify → nombre canónico del método de pago en el POS
const SHOPIFY_GATEWAY_ALIASES = {
  "bogota_payments": "wompi",
  "wompi_latam": "wompi",
  "wompi": "wompi",
  "shopify_payments": "tarjeta crédito",
  "manual": "efectivo",
  "cash": "efectivo",
  "nequi": "nequi",
  "daviplata": "daviplata",
  "addi": "addi shopify",
  "bold": "bold",
  "sumas": "sumas shopify",
};

// Cache de payment_methods para resolver gateway → id sin query repetida
let _pmCache = null;
async function resolvePaymentMethodId(env, gatewayName) {
  if (!_pmCache) {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/payment_methods?store=eq.bloom&active=eq.true&select=id,name,aliases`, {
      headers: sbHeaders(env, "return=representation"),
    });
    const methods = await r.json().catch(() => []);
    _pmCache = new Map();
    for (const m of methods) {
      _pmCache.set(m.name.toLowerCase(), m.id);
      for (const a of (m.aliases || [])) _pmCache.set(a.toLowerCase(), m.id);
    }
  }
  const key = (gatewayName || "").toLowerCase();
  // Buscar directo, o via alias de gateway Shopify
  return _pmCache.get(key) || _pmCache.get(SHOPIFY_GATEWAY_ALIASES[key] || "") || null;
}

// ============ Enviar a WhatsApp ============
async function sendWhatsApp(env, phone, message) {
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${env.WA_PHONE_ID}/messages`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${env.WA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to: phone,
        type: "text", text: { body: message },
      }),
    }
  );
  return res.json();
}

// ============ Shopify (productos para el selector) ============
async function fetchShopify(env, query) {
  if (!env.SHOPIFY_STORE || !env.SHOPIFY_TOKEN) return [];

  // Trae TODOS los productos paginando (Shopify entrega máx 250 por página)
  let all = [];
  let pageUrl = `https://${env.SHOPIFY_STORE}/admin/api/2024-10/products.json?limit=250&status=active`;
  let guard = 0;
  while (pageUrl && guard < 40) {   // tope de seguridad: 40 páginas = 10.000 productos
    guard++;
    const r = await fetch(pageUrl, { headers: { "X-Shopify-Access-Token": env.SHOPIFY_TOKEN } });
    if (!r.ok) break;
    const data = await r.json();
    all = all.concat(data.products || []);
    // El cursor de la siguiente página viene en el header Link
    const link = r.headers.get("link") || r.headers.get("Link") || "";
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    pageUrl = m ? m[1] : null;
  }

  return all
    .filter(p => !query || p.title.toLowerCase().includes(query.toLowerCase()))
    .map(p => {
      // Detecta qué opción es Color y cuál es Talla, por su NOMBRE (no por posición)
      const opts = (p.options || []).map(o => ({ name: (o.name || "").toLowerCase(), position: o.position }));
      const findOpt = (keywords) => {
        const o = opts.find(op => keywords.some(k => op.name.includes(k)));
        return o ? o.position : null;   // 1, 2 o 3
      };
      const colorPos = findOpt(["color"]);
      const tallaPos = findOpt(["talla", "size", "tamaño", "tamano"]);

      const getOpt = (v, pos) => pos === 1 ? v.option1 : pos === 2 ? v.option2 : pos === 3 ? v.option3 : null;

      return {
        id: p.id,
        name: p.title,
        price: Number(p.variants?.[0]?.price || 0),
        image: p.image?.src || null,
        option_names: { color: colorPos, talla: tallaPos },
        variants: p.variants.map(v => ({
          variant_id: v.id,
          color: colorPos ? getOpt(v, colorPos) : null,
          talla: tallaPos ? getOpt(v, tallaPos) : null,
          // size genérico para compatibilidad (lo que se muestre principal)
          size: getOpt(v, colorPos) || getOpt(v, tallaPos) || v.option1,
          price: Number(v.price),
          stock: v.inventory_quantity || 0,
          taxable: v.taxable !== false,
          barcode: v.barcode || null,
          sku: v.sku || null,
        })),
        stock: p.variants.reduce((s, v) => s + (v.inventory_quantity || 0), 0),
      };
    });
}

// ============ Buscar cliente en Shopify por teléfono ============
// Busca cliente en Shopify por email (o teléfono), si no existe lo crea. Devuelve su ID.
async function findOrCreateShopifyCustomer(env, cust) {
  if (!env.SHOPIFY_STORE || !env.SHOPIFY_TOKEN) return null;
  const headers = { "X-Shopify-Access-Token": env.SHOPIFY_TOKEN, "Content-Type": "application/json" };

  // 1) Busca por email primero (verificando coincidencia EXACTA)
  let found = null;
  if (cust.email) {
    const emailLc = cust.email.trim().toLowerCase();
    const r = await fetch(
      `https://${env.SHOPIFY_STORE}/admin/api/2024-10/customers/search.json?query=${encodeURIComponent('email:'+emailLc)}`,
      { headers }
    );
    if (r.ok) {
      const d = await r.json();
      // Solo acepta si el email coincide EXACTAMENTE (Shopify hace búsqueda amplia)
      found = (d.customers || []).find(c => (c.email || "").trim().toLowerCase() === emailLc) || null;
    }
  }
  // 2) Si no, busca por teléfono (verificando coincidencia exacta de los últimos 10 dígitos)
  if (!found && cust.phone) {
    let digits = cust.phone.replace(/\D/g, "");
    if (digits.startsWith("57") && digits.length > 10) digits = digits.slice(2);
    const last10 = digits.slice(-10);
    const r = await fetch(
      `https://${env.SHOPIFY_STORE}/admin/api/2024-10/customers/search.json?query=${encodeURIComponent('phone:'+last10)}`,
      { headers }
    );
    if (r.ok) {
      const d = await r.json();
      found = (d.customers || []).find(c => (c.phone || "").replace(/\D/g, "").slice(-10) === last10) || null;
    }
  }
  if (found) {
    // Siempre asegura que tenga email y teléfono (completa lo que falte)
    const upd = { id: found.id };
    let needsUpdate = false;
    if (!found.email && cust.email) { upd.email = cust.email; needsUpdate = true; }
    if (!found.phone && cust.phone) { upd.phone = "+57" + cust.phone.replace(/\D/g, "").slice(-10); needsUpdate = true; }
    if (!found.first_name && (cust.name || cust.full_name)) {
      upd.first_name = cust.name || cust.full_name; upd.last_name = cust.last_name || ""; needsUpdate = true;
    }
    if (needsUpdate) {
      await fetch(`https://${env.SHOPIFY_STORE}/admin/api/2024-10/customers/${found.id}.json`, {
        method: "PUT", headers, body: JSON.stringify({ customer: upd })
      }).catch(() => {});
    }
    return found.id;
  }

  // 3) No existe: créalo
  const docCompany = cust.is_company ? cust.doc : (cust.doc || "");
  // Separa nombre y apellido si solo viene full_name
  let firstName = cust.name || "";
  let lastName = cust.last_name || "";
  if (!firstName && cust.full_name) {
    const parts = cust.full_name.trim().split(/\s+/);
    firstName = parts[0] || "Cliente";
    lastName = parts.slice(1).join(" ") || "";
  }
  if (!firstName) firstName = "Cliente";

  const newCustomer = {
    first_name: firstName,
    last_name: lastName,
    ...(cust.email ? { email: cust.email } : {}),
    ...(cust.phone ? { phone: "+57" + cust.phone.replace(/\D/g, "").slice(-10) } : {}),
    tags: "POS Bloom",
    ...(cust.address ? {
      addresses: [{
        address1: cust.address, city: cust.city || "", province: cust.depto || "",
        country: "Colombia", phone: cust.phone ? ("+57" + cust.phone.replace(/\D/g, "").slice(-10)) : "",
        company: docCompany || undefined,
        first_name: firstName, last_name: lastName,
      }]
    } : {}),
  };
  const cr = await fetch(
    `https://${env.SHOPIFY_STORE}/admin/api/2024-10/customers.json`,
    { method: "POST", headers, body: JSON.stringify({ customer: newCustomer }) }
  );
  if (!cr.ok) return null;
  const cd = await cr.json();
  return cd.customer?.id || null;
}

async function findCustomer(env, phone) {
  if (!env.SHOPIFY_STORE || !env.SHOPIFY_TOKEN || !phone) return { found: false };
  // Normaliza: deja solo dígitos, quita el 57 de Colombia si viene
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("57") && digits.length > 10) digits = digits.slice(2);

  const r = await fetch(
    `https://${env.SHOPIFY_STORE}/admin/api/2024-01/customers/search.json?query=phone:${digits}`,
    { headers: { "X-Shopify-Access-Token": env.SHOPIFY_TOKEN } }
  );
  if (!r.ok) return { found: false };
  const d = await r.json();
  const c = d.customers?.[0];
  if (!c) return { found: false };
  return {
    found: true,
    name: `${c.first_name || ""} ${c.last_name || ""}`.trim(),
    orders_count: c.orders_count || 0,
    total_spent: Number(c.total_spent || 0),
    last_order: c.last_order_name || null,
    tags: c.tags || "",
  };
}

// ============ Importar pedido Online Store de Shopify al POS ============
async function importShopifyOnlineOrder(env, order) {
  // Evitar duplicados
  const check = await fetch(
    `${env.SUPABASE_URL}/rest/v1/sales?shopify_order_id=eq.${order.id}&select=id&limit=1`,
    { headers: sbHeaders(env) }
  );
  if (check.ok) {
    const rows = await check.json();
    if (rows.length > 0) return { ok: true, skipped: true, reason: "duplicate" };
  }

  const ship = order.shipping_address || {};
  const bill = order.billing_address || {};
  const addr = Object.keys(ship).length ? ship : bill; // preferir envío, caer a facturación
  const cust = order.customer || {};
  const email = order.email || order.contact_email || cust.email || null;
  const rawPhone = addr.phone || order.phone || cust.phone || null;
  const phone = rawPhone ? rawPhone.replace(/\D/g, "").slice(-10) : null;
  const custFullName = addr.name || bill.name || (`${cust.first_name||""} ${cust.last_name||""}`).trim() || null;
  const customerName = custFullName || email || "Cliente Online";

  // Buscar cliente en POS por email o teléfono, si no existe crearlo
  await findOrCreatePosCustomer(env, { email, phone, name: customerName,
    address: addr.address1 || bill.address1 || null,
    city: addr.city || bill.city || null,
    depto: addr.province || bill.province || null });

  const items = (order.line_items || []).map(li => ({
    name: li.title,
    variant: li.variant_title || null,
    price: Number(li.price),
    qty: li.quantity,
    sku: li.sku || null,
    barcode: li.sku || null,
    variant_id: li.variant_id,
    note: "",
  }));

  const total    = Number(order.total_price);
  const subtotal = Number(order.subtotal_price);
  const discount = Number(order.total_discounts) || 0;

  const payload = {
    shopify_order_id:   order.id,
    shopify_order_name: order.name,
    customer_name:      customerName,
    customer_email:     email,
    customer_phone:     phone,
    customer_address:   addr.address1 || bill.address1 || null,
    customer_city:      addr.city || bill.city || null,
    customer_depto:     addr.province || bill.province || null,
    customer_doc:       null,
    items,
    subtotal,
    total,
    discount_amount:    discount,
    discount_type:      discount > 0 ? "fixed" : null,
    discount_value:     discount,
    sale_type:          "shopify",
    payment_method:     order.payment_gateway || order.payment_gateway_names?.[0] || "online",
    payment_method_id:  await resolvePaymentMethodId(env, order.payment_gateway || order.payment_gateway_names?.[0]),
    payment_detail:     [{ method: order.payment_gateway || order.payment_gateway_names?.[0] || "online", amount: total }],
    seller_name:        "Shopify Online",
    status:             "completada",
    store:              "bloom",
  };

  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/sales`, {
    method: "POST",
    headers: sbHeaders(env, "return=representation"),
    body: JSON.stringify(payload),
  });
  if (!r.ok) return { ok: false, error: await r.text() };
  const saved = await r.json();
  return { ok: true, sale_id: saved?.[0]?.id };
}

async function findOrCreatePosCustomer(env, { email, phone, name, address, city, depto }) {
  const sb = env.SUPABASE_URL;
  const h = sbHeaders(env);

  // Buscar por email
  if (email) {
    const r = await fetch(`${sb}/rest/v1/customers?store=eq.bloom&email=eq.${encodeURIComponent(email)}&limit=1&select=id`, { headers: h });
    if (r.ok) { const rows = await r.json(); if (rows.length) return rows[0].id; }
  }
  // Buscar por teléfono
  if (phone) {
    const r = await fetch(`${sb}/rest/v1/customers?store=eq.bloom&phone=eq.${encodeURIComponent(phone)}&limit=1&select=id`, { headers: h });
    if (r.ok) { const rows = await r.json(); if (rows.length) return rows[0].id; }
  }

  // Crear cliente nuevo
  const nameUp = (name || "Cliente Online").toUpperCase();
  const parts = nameUp.trim().split(/\s+/);
  const payload = {
    full_name: nameUp,
    name: parts[0] || "CLIENTE",
    last_name: parts.slice(1).join(" ") || "",
    email: email || null,
    phone: phone || null,
    address: address || null,
    city: city || null,
    depto: depto || null,
    doc: null,
    doc_type: "CC",
    store: "bloom",
  };
  const cr = await fetch(`${sb}/rest/v1/customers`, {
    method: "POST",
    headers: sbHeaders(env, "return=representation"),
    body: JSON.stringify(payload),
  });
  if (!cr.ok) return null;
  const created = await cr.json();
  return created?.[0]?.id || null;
}

