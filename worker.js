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
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
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

    // -------- DEBUG temporal: ver source_name de últimos pedidos Shopify --------
    if (request.method === "GET" && url.pathname === "/debug-sources") {
      const r = await fetch(`https://${env.SHOPIFY_STORE}/admin/api/2024-10/orders.json?limit=20&status=any`, {
        headers: { "X-Shopify-Access-Token": env.SHOPIFY_TOKEN },
      });
      const data = await r.json();
      const sources = (data.orders || []).map(o => ({ id: o.order_number, name: o.name, source_name: o.source_name, channel: o.source_identifier }));
      return Response.json(sources, { headers: cors });
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

// ============ Procesar entrante (clave: el REFERRAL) ============
async function handleIncoming(env, msg, contact) {
  const phone = msg.from;
  const name = contact?.profile?.name || phone;
  const text = msg.text?.body || msg.button?.text || "";
  const waId = msg.id;

  // ¿Viene de una historia o pauta? Meta lo manda en msg.referral
  const ref = msg.referral;
  const refData = ref ? {
    ref_source_type: ref.source_type || null,       // 'ad' o 'post'
    ref_headline:    ref.headline || null,
    ref_body:        ref.body || null,
    ref_media_url:   ref.image_url || ref.video_url || null,
    ref_source_id:   ref.source_id || null,
    ref_ctwa_clid:   ref.ctwa_clid || null,
  } : {};

  // Crear/actualizar contacto. Si trae referral, lo guarda (solo primera vez).
  await upsertContact(env, phone, name, refData);

  // Si trajo referral, lo dejamos también como un "mensaje" especial para verlo en el hilo
  if (ref) {
    await insertMessage(env, phone, {
      direction: "in",
      body: ref.headline || "Escribió desde un anuncio",
      media_url: ref.image_url || ref.video_url || null,
      msg_type: "referral",
    });
  }

  // El mensaje de texto normal
  await insertMessage(env, phone, {
    direction: "in", body: text, wa_message_id: waId, msg_type: "text",
  });
}

async function upsertContact(env, phone, name, refData) {
  // Inserta si no existe; si trae referral lo incluye
  const payload = { phone, name, store: "bloom", ...refData };
  await fetch(`${env.SUPABASE_URL}/rest/v1/contacts`, {
    method: "POST",
    headers: sbHeaders(env, "resolution=ignore-duplicates"),
    body: JSON.stringify(payload),
  });
  // Si ya existía pero ahora llegó con referral, lo actualiza (sin pisar con null)
  if (refData.ref_source_type) {
    await fetch(`${env.SUPABASE_URL}/rest/v1/contacts?phone=eq.${phone}&ref_source_type=is.null`, {
      method: "PATCH",
      headers: sbHeaders(env, "return=minimal"),
      body: JSON.stringify(refData),
    });
  }
}

async function insertMessage(env, phone, m) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/messages`, {
    method: "POST",
    headers: sbHeaders(env, "return=minimal"),
    body: JSON.stringify({ contact_phone: phone, store: "bloom", ...m }),
  });
}

function sbHeaders(env, prefer) {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
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
  // Guarda el saliente en la base
  await insertMessage(env, phone, { direction: "out", body: message, msg_type: "text" });
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
