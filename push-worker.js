// ====================================================================
//  Cloudflare Worker - Bloom PWA Push
//  Endpoints:
//    POST /push/subscribe
//    POST /push/team-message
//    GET  /push/latest?store=bloom
//  Secrets necesarios:
//    SUPABASE_URL, SUPABASE_SERVICE_KEY, VAPID_PUBLIC_KEY,
//    VAPID_PRIVATE_KEY, VAPID_SUBJECT
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

    try {
      if (request.method === "POST" && url.pathname === "/push/subscribe") {
        const body = await request.json();
        const result = await savePushSubscription(env, request, body);
        return Response.json(result, { headers: cors });
      }

      if (request.method === "POST" && url.pathname === "/push/team-message") {
        const body = await request.json();
        const result = await notifyTeamMessage(env, body);
        return Response.json(result, { headers: cors });
      }

      if (request.method === "GET" && url.pathname === "/push/latest") {
        const store = url.searchParams.get("store") || "bloom";
        const result = await latestNotification(env, store);
        return Response.json(result, { headers: { ...cors, "Cache-Control": "no-store" } });
      }
    } catch (e) {
      return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500, headers: cors });
    }

    return new Response("Not found", { status: 404, headers: cors });
  },
};

async function savePushSubscription(env, request, body) {
  const sub = body.subscription || {};
  const endpoint = sub.endpoint;
  const p256dh = sub.keys?.p256dh;
  const auth = sub.keys?.auth;
  if (!endpoint || !p256dh || !auth) return { ok: false, error: "subscription incompleta" };

  const payload = {
    endpoint,
    p256dh,
    auth,
    author_name: body.author_name || null,
    store: body.store || "bloom",
    user_agent: request.headers.get("User-Agent") || null,
    active: true,
    updated_at: new Date().toISOString(),
  };

  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/push_subscriptions?on_conflict=endpoint`, {
    method: "POST",
    headers: sbHeaders(env, "resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify(payload),
  });
  if (!r.ok) return { ok: false, error: await r.text() };
  return { ok: true };
}

async function notifyTeamMessage(env, body) {
  const store = body.store || "bloom";
  const rows = await sbGet(env, `push_subscriptions?store=eq.${encodeURIComponent(store)}&active=eq.true&select=id,endpoint,p256dh,auth,author_name`);
  const targets = rows || [];
  const notification = buildNotification(body);
  await saveLatestNotification(env, store, notification);

  const results = await Promise.allSettled(targets.map(s => sendGenericPush(env, s, notification)));
  let sent = 0;
  const failures = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled" && result.value.ok) sent++;
    const status = result.status === "fulfilled" ? result.value.status : 0;
    if (result.status === "rejected" || !result.value?.ok) failures.push({ status, error: String(result.reason || result.value?.text || result.value?.error || "unknown") });
    if (status === 404 || status === 410) await deactivateSubscription(env, targets[i].id);
  }
  return { ok: true, sent, total: targets.length, notification, failures };
}

function buildNotification(body) {
  const author = cleanText(body.author_name || "Equipo Bloom").replace(/ · [a-z0-9]{8}$/i, "");
  let text = cleanText(body.body || "");
  if (!text && body.media_type === "image") text = "Envio una foto";
  if (!text && body.media_type === "audio") text = "Envio una nota de voz";
  if (!text && body.sale_id) text = "Comento una venta";
  if (!text) text = "Nuevo mensaje del equipo";
  return {
    title: `Bloom - ${author}`,
    body: text.slice(0, 140),
    tag: "bloom-team",
    url: "./index.html#equipo",
    at: new Date().toISOString(),
  };
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function saveLatestNotification(env, store, notification) {
  const payload = { store, payload: notification, updated_at: new Date().toISOString() };
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/push_latest?on_conflict=store`, {
    method: "POST",
    headers: sbHeaders(env, "resolution=merge-duplicates,return=minimal"),
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`push_latest: ${await r.text()}`);
}

async function latestNotification(env, store) {
  const rows = await sbGet(env, `push_latest?store=eq.${encodeURIComponent(store)}&select=payload,updated_at&limit=1`);
  const row = rows?.[0];
  if (!row?.payload) return { ok: false };
  return { ok: true, ...row.payload, updated_at: row.updated_at };
}

async function sendGenericPush(env, sub, notification) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
    return { ok: false, status: 0, error: "faltan secretos VAPID" };
  }

  const endpoint = new URL(sub.endpoint);
  const aud = `${endpoint.protocol}//${endpoint.host}`;
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const jwt = await createVapidJwt(env, aud, exp);

  // Codifica el payload como texto JSON para que el SW lo reciba en e.data
  const payloadStr = notification ? JSON.stringify(notification) : null;
  const bodyBytes = payloadStr ? new TextEncoder().encode(payloadStr) : null;

  const headers = {
    TTL: "60",
    Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
  };
  if(bodyBytes){
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(bodyBytes.length);
  }

  const r = await fetch(sub.endpoint, {
    method: "POST",
    headers,
    body: bodyBytes || null,
  });
  return { ok: r.ok, status: r.status, text: r.ok ? "" : await r.text().catch(() => "") };
}

async function createVapidJwt(env, aud, exp) {
  const header = base64UrlJson({ typ: "JWT", alg: "ES256" });
  const claims = base64UrlJson({ aud, exp, sub: env.VAPID_SUBJECT });
  const data = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "jwk",
    vapidPrivateJwk(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc(data));
  return `${data}.${base64Url(sig)}`;
}

function vapidPrivateJwk(publicKey, privateKey) {
  const pub = b64UrlToBytes(publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID_PUBLIC_KEY invalida");
  return {
    kty: "EC",
    crv: "P-256",
    x: base64Url(pub.slice(1, 33)),
    y: base64Url(pub.slice(33, 65)),
    d: base64Url(b64UrlToBytes(privateKey)),
    ext: true,
  };
}

async function sbGet(env, path) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders(env) });
  if (!r.ok) return [];
  return r.json();
}

async function deactivateSubscription(env, id) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${id}`, {
    method: "PATCH",
    headers: sbHeaders(env, "return=minimal"),
    body: JSON.stringify({ active: false, updated_at: new Date().toISOString() }),
  });
}

function sbHeaders(env, prefer) {
  const headers = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

const enc = value => new TextEncoder().encode(value);
const base64UrlJson = value => base64Url(enc(JSON.stringify(value)));

function base64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64UrlToBytes(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(ch => ch.charCodeAt(0)));
}
