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
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
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

    // -------- WebSocket en tiempo real --------
    if (url.pathname === "/ws") {
      const id = env.BLOOM_HUB.idFromName("bloom");
      const stub = env.BLOOM_HUB.get(id);
      return stub.fetch(request);
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
      // Disparar bot por cambio de etapa
      if (updates.stage !== undefined) {
        const conv = await env.bloom_wa.prepare(`SELECT phone FROM wa_conversations WHERE id=?`).bind(convId).first().catch(()=>null);
        if (conv?.phone) await triggerBotByStage(env, convId, conv.phone, updates.stage).catch(()=>{});
      }
      return Response.json({ ok: true }, { headers: cors });
    }

    // -------- PATCH contacto: tags --------
    if (request.method === "PATCH" && url.pathname.startsWith("/wa/contacts/")) {
      const phone = decodeURIComponent(url.pathname.split("/")[3]);
      const updates = await request.json();
      // Detectar etiquetas nuevas para disparar bot
      let newTags = [];
      if (updates.tags !== undefined) {
        const ct = await env.bloom_wa.prepare(`SELECT tags FROM wa_contacts WHERE phone=?`).bind(phone).first().catch(()=>null);
        const oldTags = JSON.parse(ct?.tags||"[]");
        newTags = (updates.tags||[]).filter(t => !oldTags.includes(t));
      }
      const fields = []; const values = [];
      if (updates.tags !== undefined) { fields.push("tags = ?"); values.push(JSON.stringify(updates.tags)); }
      if (updates.name !== undefined) { fields.push("name = ?"); values.push(updates.name); }
      if (!fields.length) return Response.json({ ok: false, error: "no fields" }, { headers: cors });
      fields.push("updated_at = ?"); values.push(new Date().toISOString()); values.push(phone);
      await env.bloom_wa.prepare(`UPDATE wa_contacts SET ${fields.join(", ")} WHERE phone = ?`).bind(...values).run();
      for (const tag of newTags) await triggerBotByTag(env, phone, tag).catch(()=>{});
      return Response.json({ ok: true }, { headers: cors });
    }

    // -------- Bot: CRUD de flujos --------
    if (url.pathname === "/wa/bot/flows") {
      if (request.method === "GET") {
        const rows = await env.bloom_wa.prepare(
          `SELECT * FROM wa_bot_flows WHERE store = 'bloom' ORDER BY created_at ASC`
        ).all();
        return Response.json(rows.results || [], { headers: cors });
      }
      if (request.method === "POST") {
        const d = await request.json();
        const id = "flow-" + Date.now();
        const now = new Date().toISOString();
        await env.bloom_wa.prepare(
          `INSERT INTO wa_bot_flows (id,name,trigger_type,trigger_value,active,steps,store,created_at) VALUES (?,?,?,?,?,?,'bloom',?)`
        ).bind(id, d.name, d.trigger_type, d.trigger_value||null, d.active?1:0, JSON.stringify(d.steps||[]), now).run();
        return Response.json({ ok:true, id }, { headers: cors });
      }
    }
    if (url.pathname.startsWith("/wa/bot/flows/")) {
      const flowId = decodeURIComponent(url.pathname.split("/")[4]);
      if (request.method === "PUT") {
        const d = await request.json();
        await env.bloom_wa.prepare(
          `UPDATE wa_bot_flows SET name=?,trigger_type=?,trigger_value=?,active=?,steps=? WHERE id=? AND store='bloom'`
        ).bind(d.name, d.trigger_type, d.trigger_value||null, d.active?1:0, JSON.stringify(d.steps||[]), flowId).run();
        return Response.json({ ok:true }, { headers: cors });
      }
      if (request.method === "DELETE") {
        await env.bloom_wa.prepare(`DELETE FROM wa_bot_flows WHERE id=?`).bind(flowId).run();
        return Response.json({ ok:true }, { headers: cors });
      }
    }

    // -------- Bot: estado por conversación (pausa / reinicio) --------
    if (request.method === "POST" && url.pathname.startsWith("/wa/bot/state/") && url.pathname.endsWith("/pause")) {
      const convId = decodeURIComponent(url.pathname.split("/")[4]);
      await setBotState(env, convId, null, null, 1);
      return Response.json({ ok:true }, { headers: cors });
    }
    if (request.method === "DELETE" && url.pathname.startsWith("/wa/bot/state/")) {
      const convId = decodeURIComponent(url.pathname.split("/")[4]);
      await clearBotState(env, convId);
      return Response.json({ ok:true }, { headers: cors });
    }

    // -------- WhatsApp Flows: data_exchange endpoint --------
    if (request.method === "POST" && url.pathname === "/wa/flows/exchange") {
      if (!env.WA_FLOWS_PRIVATE_KEY) return new Response("WA_FLOWS_PRIVATE_KEY no configurada", {status:400});
      let dec, aesKey, reqIv;
      try {
        const result = await _decryptFlowRequest(env, await request.json());
        dec = result.data; aesKey = result.aesKey; reqIv = result.iv;
      } catch(e) {
        console.error("Flow decrypt error:", e);
        return new Response("Decryption failed", {status:421});
      }
      let resp;
      if (dec.action === "ping") {
        resp = {data:{status:"active"}};
      } else if (dec.action === "INIT") {
        resp = {screen:"SCREEN_TALLA", data:{}};
      } else if (dec.action === "data_exchange") {
        const talla = (dec.data?.talla||"").toUpperCase().trim();
        const all = await fetchShopify(env, "");
        const modelos = [];
        for (const p of all) {
          const okVariant = p.variants.find(v => v.talla?.toUpperCase()===talla && v.stock>0);
          if (okVariant && modelos.length < 10) modelos.push({id:String(p.id), title:p.name});
        }
        resp = modelos.length
          ? {screen:"SCREEN_MODELOS", data:{modelos, talla_sel:talla}}
          : {screen:"SCREEN_NO_STOCK", data:{talla_sel:talla}};
      } else {
        resp = {data:{}};
      }
      return Response.json(await _encryptFlowResponse(resp, aesKey, reqIv));
    }

    // -------- WhatsApp Flows (proxy a Meta Graph API) --------
    const GV = "https://graph.facebook.com/v19.0";
    const noWaba = () => Response.json({error:"WABA_ID no configurado en el Worker"},{status:400,headers:cors});

    if (url.pathname === "/wa/waflows") {
      if (!env.WABA_ID) return noWaba();
      if (request.method === "GET") {
        const r = await fetch(`${GV}/${env.WABA_ID}/flows?fields=id,name,status,categories,validation_errors&access_token=${env.WA_TOKEN}`);
        return Response.json(await r.json(), {headers:cors});
      }
      if (request.method === "POST") {
        const {name, categories, endpoint_uri} = await request.json();
        const p = new URLSearchParams({name, categories:JSON.stringify(categories||["OTHER"]), access_token:env.WA_TOKEN});
        if (endpoint_uri) p.append("endpoint_uri", endpoint_uri);
        const r = await fetch(`${GV}/${env.WABA_ID}/flows`, {method:"POST", body:p});
        return Response.json(await r.json(), {headers:cors});
      }
    }

    if (request.method === "POST" && url.pathname === "/wa/waflows/send") {
      const {phone, flow_id, flow_cta, header_text, body_text, screen_id} = await request.json();
      const payload = {
        messaging_product:"whatsapp", recipient_type:"individual", to:phone, type:"interactive",
        interactive:{
          type:"flow",
          header:{type:"text", text:header_text||""},
          body:{text:body_text||"Completa el formulario"},
          action:{name:"flow", parameters:{
            flow_message_version:"3", flow_id,
            flow_cta:(flow_cta||"Abrir").slice(0,30),
            flow_action:"navigate",
            flow_action_payload:{screen:screen_id||"SCREEN_1"}
          }}
        }
      };
      const r = await fetch(`${GV}/${env.WA_PHONE_ID}/messages`,{
        method:"POST", headers:{Authorization:`Bearer ${env.WA_TOKEN}`,"Content-Type":"application/json"},
        body:JSON.stringify(payload)
      });
      return Response.json(await r.json(), {headers:cors});
    }

    if (url.pathname.match(/^\/wa\/waflows\/[^/]+\/json$/) && request.method === "POST") {
      const flowId = url.pathname.split("/")[3];
      const {flow_json} = await request.json();
      const fd = new FormData();
      fd.append("file", new Blob([JSON.stringify(flow_json)],{type:"application/json"}), "flow.json");
      fd.append("name","flow.json"); fd.append("asset_type","FLOW_JSON"); fd.append("access_token",env.WA_TOKEN);
      const r = await fetch(`${GV}/${flowId}/assets`, {method:"POST", body:fd});
      return Response.json(await r.json(), {headers:cors});
    }

    if (url.pathname.match(/^\/wa\/waflows\/[^/]+\/publish$/) && request.method === "POST") {
      const flowId = url.pathname.split("/")[3];
      const r = await fetch(`${GV}/${flowId}/publish`,{method:"POST",body:new URLSearchParams({access_token:env.WA_TOKEN})});
      return Response.json(await r.json(), {headers:cors});
    }

    if (url.pathname.match(/^\/wa\/waflows\/[^/]+$/) && !url.pathname.includes("/send")) {
      const flowId = url.pathname.split("/")[3];
      if (request.method === "DELETE") {
        const r = await fetch(`${GV}/${flowId}?access_token=${env.WA_TOKEN}`,{method:"DELETE"});
        return Response.json(await r.json(), {headers:cors});
      }
      if (request.method === "GET") {
        const r = await fetch(`${GV}/${flowId}?fields=id,name,status,categories,validation_errors,preview.invalidate(false)&access_token=${env.WA_TOKEN}`);
        return Response.json(await r.json(), {headers:cors});
      }
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
  const interactive = msg.interactive;
  const interactiveReplyId = interactive?.button_reply?.id || interactive?.list_reply?.id || null;
  const interactiveTitle = interactive?.button_reply?.title || interactive?.list_reply?.title || "";
  // Flow completion (nfm_reply cuando el cliente termina un WhatsApp Flow)
  const flowReply = interactive?.type === "nfm_reply" ? interactive.nfm_reply : null;
  const flowData = flowReply ? (() => { try { return JSON.parse(flowReply.response_json||"{}"); } catch{return{};} })() : null;
  const text = flowData
    ? Object.entries(flowData).filter(([,v])=>v).map(([k,v])=>`${k}: ${v}`).join(" · ")
    : msg.text?.body || msg.button?.text || interactiveTitle || "";
  const waId = msg.id;
  const now = new Date().toISOString();
  const msgType = flowData ? "flow_reply" : (interactive ? "interactive" : "text");

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
    `INSERT OR IGNORE INTO wa_messages (id, conversation_id, wa_message_id, direction, type, body, status, ts) VALUES (?, ?, ?, 'inbound', ?, ?, 'delivered', ?)`
  ).bind(msgId, convId, waId || null, msgType, text, now).run();

  // Bot: procesar respuesta
  await handleBotInput(env, convId, phone, text, interactiveReplyId, !existing, contact);

  // Notificar a los clientes WebSocket conectados
  try {
    const id = env.BLOOM_HUB.idFromName("bloom");
    const stub = env.BLOOM_HUB.get(id);
    await stub.fetch(new Request("https://internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "new_message", phone: convId, body: text, ts: now }),
    }));
  } catch(e) {}
}

// ============ Ejecución del bot ============

// Construir variables disponibles para un contacto/conversación
async function buildVars(env, phone, convId, lastText, contactName) {
  const now = new Date();
  const ct = await env.bloom_wa.prepare(`SELECT tags FROM wa_contacts WHERE phone=?`).bind(phone).first().catch(()=>null);
  const conv = await env.bloom_wa.prepare(`SELECT stage FROM wa_conversations WHERE id=?`).bind(convId).first().catch(()=>null);
  return {
    nombre: contactName || phone,
    telefono: phone,
    etapa: conv?.stage || "",
    etiquetas: JSON.parse(ct?.tags||"[]").join(", "),
    fecha: now.toLocaleDateString("es-CO"),
    hora: now.toLocaleTimeString("es-CO",{hour:"2-digit",minute:"2-digit"}),
    _lastInput: lastText || "",
  };
}

// Resolver variables en un texto
function rv(s, vars) {
  return (s||"")
    .replace(/\{nombre\}/gi, vars.nombre||"")
    .replace(/\{telefono\}/gi, vars.telefono||"")
    .replace(/\{etapa\}/gi, vars.etapa||"")
    .replace(/\{etiquetas\}/gi, vars.etiquetas||"")
    .replace(/\{fecha\}/gi, vars.fecha||"")
    .replace(/\{hora\}/gi, vars.hora||"");
}

// Evaluar una sola condición contra un valor
function testCondition(cond, fieldValue) {
  const op = cond.operation || "contains";
  const fv = (fieldValue||"").toLowerCase();
  if (op === "email")     return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(fieldValue||"");
  if (op === "phone")     return /\d{7,}/.test((fieldValue||"").replace(/[\s\+\-\(\)]/g,""));
  if (op === "not_empty") return (fieldValue||"").trim().length > 0;
  if (op === "regex")     { try { return new RegExp(cond.value||cond.keywords||"").test(fieldValue||""); } catch(e){ return false; } }
  const kws = (cond.keywords||cond.value||"").toLowerCase().split(",").map(k=>k.trim()).filter(Boolean);
  if (op === "contains")     return kws.some(k => fv.includes(k));
  if (op === "not_contains") return kws.every(k => !fv.includes(k));
  if (op === "=")            return kws.some(k => fv === k);
  if (op === "!=")           return kws.every(k => fv !== k);
  return false;
}

// Obtener el valor del campo a evaluar en una condición
async function getConditionFieldValue(env, field, phone, convId, vars) {
  if (field === "tag" || field === "etiqueta") return vars.etiquetas;
  if (field === "stage" || field === "etapa")  return vars.etapa;
  if (field === "name"  || field === "nombre") return vars.nombre;
  return vars._lastInput; // "message" por defecto
}

// Evaluar lista de condiciones (lógica OR: primera que coincide gana)
async function evaluateConditions(env, conditions, logic, phone, convId, vars) {
  for (const cond of (conditions||[])) {
    const field = cond.field || "message";
    const fv = await getConditionFieldValue(env, field, phone, convId, vars);
    if (testCondition(cond, fv)) return cond.next || "__end__";
  }
  return null;
}

async function handleBotInput(env, convId, phone, text, inputId, isNew, contact) {
  const state = await env.bloom_wa.prepare(
    `SELECT * FROM wa_bot_state WHERE conversation_id = ?`
  ).bind(convId).first();

  if (state?.paused) return;

  // Delay: si hay resume_at en el futuro, esperar
  if (state?.resume_at && new Date(state.resume_at) > new Date()) return;
  if (state?.resume_at) {
    // Delay cumplido: continuar desde step guardado
    await env.bloom_wa.prepare(
      `UPDATE wa_bot_state SET resume_at=NULL WHERE conversation_id=?`
    ).bind(convId).run();
  }

  const vars = await buildVars(env, phone, convId, text, contact?.profile?.name);

  if (state?.step_id && state?.flow_id) {
    const flow = await env.bloom_wa.prepare(`SELECT * FROM wa_bot_flows WHERE id = ?`).bind(state.flow_id).first();
    if (!flow) { await clearBotState(env, convId); return; }
    const steps = JSON.parse(flow.steps || "[]");
    const cur = steps.find(s => s.id === state.step_id);
    if (!cur) { await clearBotState(env, convId); return; }

    let nextId = null;
    if (cur.type === "buttons") {
      const btn = (cur.buttons||[]).find(b => b.id === inputId || b.title.toLowerCase() === text.toLowerCase());
      nextId = btn?.next ?? null;
    } else if (cur.type === "list") {
      for (const sec of (cur.sections||[])) {
        const row = (sec.rows||[]).find(r => r.id === inputId || r.title.toLowerCase() === text.toLowerCase());
        if (row) { nextId = row.next ?? null; break; }
      }
    } else if (cur.type === "condition" || cur.type === "validate") {
      nextId = await evaluateConditions(env, cur.conditions, cur.logic, phone, convId, vars);
      if (nextId === null) nextId = cur.default_next ?? null;
    }

    if (!nextId || nextId === "__end__") { await clearBotState(env, convId); return; }
    await executeFlowFrom(env, convId, phone, steps, nextId, flow.id, vars);
    return;
  }

  // Sin estado activo: verificar triggers
  const flows = await env.bloom_wa.prepare(
    `SELECT * FROM wa_bot_flows WHERE store='bloom' AND active=1`
  ).all();
  for (const flow of (flows.results||[])) {
    const steps = JSON.parse(flow.steps||"[]");
    if (!steps.length) continue;
    let triggered = false;
    const tv = flow.trigger_value||"";
    if (flow.trigger_type === "new_conversation" && isNew) triggered = true;
    if (flow.trigger_type === "inbound_any") triggered = true;
    if (flow.trigger_type === "keyword" && tv) {
      const kws = tv.toLowerCase().split(",").map(k=>k.trim()).filter(Boolean);
      if (kws.some(k => text.toLowerCase().includes(k))) triggered = true;
    }
    if (triggered) {
      await executeFlowFrom(env, convId, phone, steps, steps[0].id, flow.id, vars);
      break;
    }
  }
}

// Disparar por cambio de etapa
async function triggerBotByStage(env, convId, phone, stage) {
  const flows = await env.bloom_wa.prepare(
    `SELECT * FROM wa_bot_flows WHERE store='bloom' AND active=1 AND trigger_type='stage_change' AND trigger_value=?`
  ).bind(stage).all();
  for (const flow of (flows.results||[])) {
    const steps = JSON.parse(flow.steps||"[]");
    if (!steps.length) continue;
    const ct = await env.bloom_wa.prepare(`SELECT name FROM wa_contacts WHERE phone=?`).bind(phone).first().catch(()=>null);
    const vars = await buildVars(env, phone, convId, "", ct?.name);
    await executeFlowFrom(env, convId, phone, steps, steps[0].id, flow.id, vars);
    break;
  }
}

// Disparar por etiqueta agregada
async function triggerBotByTag(env, phone, tag) {
  const convId = phone;
  const conv = await env.bloom_wa.prepare(`SELECT id FROM wa_conversations WHERE id=?`).bind(convId).first().catch(()=>null);
  if (!conv) return;
  const flows = await env.bloom_wa.prepare(
    `SELECT * FROM wa_bot_flows WHERE store='bloom' AND active=1 AND trigger_type='tag_added' AND trigger_value=?`
  ).bind(tag).all();
  for (const flow of (flows.results||[])) {
    const steps = JSON.parse(flow.steps||"[]");
    if (!steps.length) continue;
    const ct = await env.bloom_wa.prepare(`SELECT name FROM wa_contacts WHERE phone=?`).bind(phone).first().catch(()=>null);
    const vars = await buildVars(env, phone, convId, "", ct?.name);
    await executeFlowFrom(env, convId, phone, steps, steps[0].id, flow.id, vars);
    break;
  }
}

async function executeFlowFrom(env, convId, phone, steps, startId, flowId, vars) {
  let stepId = startId;
  let guard = 25;
  while (stepId && stepId !== "__end__" && guard-- > 0) {
    const step = steps.find(s => s.id === stepId);
    if (!step || step.type === "end") { await clearBotState(env, convId); return; }

    // ---- Pasos que no envían mensajes y se resuelven inmediatamente ----

    // Delay: pausar el flujo hasta resume_at
    if (step.type === "delay") {
      const mins = parseInt(step.minutes||1);
      const resumeAt = new Date(Date.now() + mins*60000).toISOString();
      await setBotState(env, convId, flowId, step.next||"__end__", 0, resumeAt);
      return;
    }

    // Validar: evaluar el último mensaje del cliente, ramificar
    if (step.type === "validate") {
      const fv = vars._lastInput||"";
      let pass = false;
      if (step.validate_type === "email")     pass = /[^\s@]+@[^\s@]+\.[^\s@]+/.test(fv);
      else if (step.validate_type === "phone") pass = /\d{7,}/.test(fv.replace(/[\s\+\-\(\)]/g,""));
      else if (step.validate_type === "regex") { try { pass = new RegExp(step.validate_pattern||"").test(fv); } catch(e){} }
      else if (step.validate_type === "not_empty") pass = fv.trim().length > 0;
      stepId = (pass ? step.next_pass : step.next_fail) || "__end__";
      continue;
    }

    // Condición inmediata (campo != "message"): evalúa sin esperar input
    if (step.type === "condition") {
      const needsInput = (step.conditions||[]).some(c => !c.field || c.field==="message");
      if (!needsInput) {
        const nextId = await evaluateConditions(env, step.conditions, step.logic, phone, convId, vars);
        stepId = nextId || step.default_next || "__end__";
        continue;
      }
      // Si alguna condición usa "message", esperar input del usuario
      await setBotState(env, convId, flowId, step.id, 0);
      return;
    }

    // ---- Pasos que ejecutan algo ----
    await executeBotStep(env, phone, step, vars, convId);

    // Pasos que esperan respuesta del usuario
    if (step.type === "buttons" || step.type === "list") {
      await setBotState(env, convId, flowId, step.id, 0);
      return;
    }

    // Acciones que terminan el flujo
    if (step.type === "action") {
      if (step.action === "pause_bot") { await setBotState(env, convId, flowId, null, 1); return; }
      if (step.action === "end")       { await clearBotState(env, convId); return; }
    }

    stepId = step.next || "__end__";
  }
  await clearBotState(env, convId);
}

async function executeBotStep(env, phone, step, vars, convId) {
  const r = s => rv(s, vars);
  const now = new Date().toISOString();

  if (step.type === "text") {
    await sendWhatsApp(env, phone, r(step.body));

  } else if (step.type === "image") {
    await sendWhatsAppPayload(env, phone, { type:"image", image:{ link:step.media_url, caption:r(step.body||"") } });

  } else if (step.type === "audio") {
    await sendWhatsAppPayload(env, phone, { type:"audio", audio:{ link:step.media_url } });

  } else if (step.type === "video") {
    await sendWhatsAppPayload(env, phone, { type:"video", video:{ link:step.media_url, caption:r(step.body||"") } });

  } else if (step.type === "buttons") {
    await sendWhatsAppPayload(env, phone, { type:"interactive", interactive:{
      type:"button", body:{ text:r(step.body) },
      action:{ buttons:(step.buttons||[]).slice(0,3).map(b=>({ type:"reply", reply:{ id:b.id, title:b.title.slice(0,20) } })) }
    }});

  } else if (step.type === "list") {
    await sendWhatsAppPayload(env, phone, { type:"interactive", interactive:{
      type:"list", body:{ text:r(step.body) },
      action:{ button:(step.button_label||"Ver opciones").slice(0,20),
        sections:(step.sections||[]).map(sec=>({ title:sec.title||"", rows:(sec.rows||[]).slice(0,10).map(row=>({ id:row.id, title:row.title.slice(0,24), description:(row.description||"").slice(0,72) })) }))
      }
    }});

  } else if (step.type === "webhook") {
    const payload = { phone, convId, nombre:vars.nombre, etapa:vars.etapa, etiquetas:vars.etiquetas, step_id:step.id };
    await fetch(step.url||"", {
      method: step.method||"POST",
      headers:{ "Content-Type":"application/json", ...(step.headers||{}) },
      body: JSON.stringify({ ...payload, ...(step.extra||{}) }),
    }).catch(()=>{});

  } else if (step.type === "assign") {
    await env.bloom_wa.prepare(`UPDATE wa_conversations SET assigned_to=?,updated_at=? WHERE id=?`).bind(step.seller||null, now, convId).run();

  } else if (step.type === "note") {
    // Nota interna: guardar como mensaje tipo note en D1
    const nId = "note-"+Date.now()+"-"+Math.random().toString(36).slice(2,5);
    await env.bloom_wa.prepare(
      `INSERT OR IGNORE INTO wa_messages (id,conversation_id,direction,type,body,status,ts) VALUES (?,?,'outbound','note',?,'sent',?)`
    ).bind(nId, convId, r(step.body||""), now).run();

  } else if (step.type === "action") {
    if (step.action === "change_stage") {
      await env.bloom_wa.prepare(`UPDATE wa_conversations SET stage=?,updated_at=? WHERE id=?`).bind(step.value||null, now, convId).run();
    } else if (step.action === "add_tag") {
      const ct = await env.bloom_wa.prepare(`SELECT tags FROM wa_contacts WHERE phone=?`).bind(phone).first().catch(()=>null);
      const tags = JSON.parse(ct?.tags||"[]");
      if (step.value && !tags.includes(step.value)) { tags.push(step.value); await env.bloom_wa.prepare(`UPDATE wa_contacts SET tags=?,updated_at=? WHERE phone=?`).bind(JSON.stringify(tags), now, phone).run(); }
    } else if (step.action === "unset_tag") {
      const ct = await env.bloom_wa.prepare(`SELECT tags FROM wa_contacts WHERE phone=?`).bind(phone).first().catch(()=>null);
      const tags = JSON.parse(ct?.tags||"[]").filter(t=>t!==step.value);
      await env.bloom_wa.prepare(`UPDATE wa_contacts SET tags=?,updated_at=? WHERE phone=?`).bind(JSON.stringify(tags), now, phone).run();
    } else if (step.action === "close_conversation") {
      await env.bloom_wa.prepare(`UPDATE wa_conversations SET status='closed',updated_at=? WHERE id=?`).bind(now, convId).run();
    } else if (step.action === "assign_seller") {
      await env.bloom_wa.prepare(`UPDATE wa_conversations SET assigned_to=?,updated_at=? WHERE id=?`).bind(step.value||null, now, convId).run();
    }
  }
}

async function sendWhatsAppPayload(env, phone, payload) {
  if (!env.WA_TOKEN || !env.WA_PHONE_ID) return;
  await fetch(`https://graph.facebook.com/v19.0/${env.WA_PHONE_ID}/messages`, {
    method:"POST",
    headers:{ Authorization:`Bearer ${env.WA_TOKEN}`, "Content-Type":"application/json" },
    body:JSON.stringify({ messaging_product:"whatsapp", to:phone, ...payload }),
  });
}

async function setBotState(env, convId, flowId, stepId, paused, resumeAt=null) {
  const now = new Date().toISOString();
  await env.bloom_wa.prepare(
    `INSERT INTO wa_bot_state (conversation_id,flow_id,step_id,paused,resume_at,updated_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(conversation_id) DO UPDATE SET flow_id=excluded.flow_id,step_id=excluded.step_id,paused=excluded.paused,resume_at=excluded.resume_at,updated_at=excluded.updated_at`
  ).bind(convId, flowId, stepId, paused?1:0, resumeAt, now).run();
}

async function clearBotState(env, convId) {
  await env.bloom_wa.prepare(`DELETE FROM wa_bot_state WHERE conversation_id=?`).bind(convId).run();
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

// ============ WhatsApp Flows — Crypto (Web Crypto API nativa de Workers) ============
function _b64Buf(b64){ const s=atob(b64),a=new Uint8Array(s.length); for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i); return a; }
function _bufB64(buf){ return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function _parsePem(pem){ return _b64Buf(pem.replace(/-----[^-]+-----/g,"").replace(/\s/g,"")); }

async function _decryptFlowRequest(env, body){
  const {encrypted_aes_key, encrypted_flow_data, initial_vector} = body;
  const privKey = await crypto.subtle.importKey(
    "pkcs8", _parsePem(env.WA_FLOWS_PRIVATE_KEY),
    {name:"RSA-OAEP", hash:"SHA-256"}, false, ["decrypt"]
  );
  const aesRaw = await crypto.subtle.decrypt({name:"RSA-OAEP"}, privKey, _b64Buf(encrypted_aes_key));
  const aesKey = await crypto.subtle.importKey("raw", aesRaw, {name:"AES-GCM"}, false, ["decrypt","encrypt"]);
  const iv = _b64Buf(initial_vector);
  const plain = await crypto.subtle.decrypt({name:"AES-GCM", iv}, aesKey, _b64Buf(encrypted_flow_data));
  return {data: JSON.parse(new TextDecoder().decode(plain)), aesKey, iv};
}

async function _encryptFlowResponse(data, aesKey, requestIv){
  const flippedIv = new Uint8Array(requestIv.map(b => ~b & 0xff));
  const enc = await crypto.subtle.encrypt(
    {name:"AES-GCM", iv:flippedIv}, aesKey, new TextEncoder().encode(JSON.stringify(data))
  );
  return {response: _bufB64(enc), iv: _bufB64(flippedIv)};
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

// ============ Durable Object: WebSocket hub en tiempo real ============
export class BloomHub {
  constructor(state) {
    this.state = state;
    this.sockets = new Set();
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket")
        return new Response("Expected websocket", { status: 426 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      this.sockets.add(server);
      server.addEventListener("close", () => this.sockets.delete(server));
      server.addEventListener("error", () => this.sockets.delete(server));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/broadcast" && request.method === "POST") {
      const data = await request.json();
      const msg = JSON.stringify(data);
      for (const ws of [...this.sockets]) {
        try { ws.send(msg); } catch(e) { this.sockets.delete(ws); }
      }
      return new Response("OK");
    }

    return new Response("Not found", { status: 404 });
  }
}

