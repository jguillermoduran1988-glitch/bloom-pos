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

  const headers = {
    TTL: "86400",
    Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
    Urgency: "normal",
  };

  let body = null;
  // Encripta el payload si tenemos las claves del suscriptor
  if (notification && sub.p256dh && sub.auth) {
    try {
      const encrypted = await encryptWebPush(sub.p256dh, sub.auth, JSON.stringify(notification));
      headers["Content-Type"] = "application/octet-stream";
      headers["Content-Encoding"] = "aes128gcm";
      headers["Content-Length"] = String(encrypted.byteLength);
      body = encrypted;
    } catch(e) {
      // Si falla encriptación, envía sin payload (notificación genérica)
      console.error("Encrypt error:", e);
    }
  }

  const r = await fetch(sub.endpoint, { method: "POST", headers, body });
  return { ok: r.ok, status: r.status, text: r.ok ? "" : await r.text().catch(() => "") };
}

// ---- Web Push Encryption (RFC 8291 / aes128gcm) ----
async function encryptWebPush(p256dhB64, authB64, plaintext) {
  const enc = new TextEncoder();

  // Decodifica claves del suscriptor
  const receiverPublic = b64UrlToBytes(p256dhB64);
  const authSecret = b64UrlToBytes(authB64);

  // Genera par de claves ECDH efímeras
  const senderKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);

  // Exporta clave pública del sender
  const senderPublicRaw = await crypto.subtle.exportKey("raw", senderKeys.publicKey);
  const senderPublic = new Uint8Array(senderPublicRaw);

  // Importa clave pública del receptor
  const receiverKey = await crypto.subtle.importKey("raw", receiverPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);

  // Deriva shared secret via ECDH
  const sharedBits = await crypto.subtle.deriveBits({ name: "ECDH", public: receiverKey }, senderKeys.privateKey, 256);
  const sharedSecret = new Uint8Array(sharedBits);

  // Salt aleatorio (16 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // PRK via HKDF step 1 (auth)
  const prkAuthInfo = enc.encode("WebPush: info\0");
  const prkInput = concat(prkAuthInfo, receiverPublic, senderPublic);
  const prk = await hkdf(authSecret, sharedSecret, prkInput, 32);

  // CEK y nonce via HKDF step 2 (salt)
  const cekInfo = enc.encode("Content-Encoding: aes128gcm\0");
  const nonceInfo = enc.encode("Content-Encoding: nonce\0");
  const cek = await hkdf(salt, prk, cekInfo, 16);
  const nonce = await hkdf(salt, prk, nonceInfo, 12);

  // Importa CEK
  const cekKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);

  // Padding: agrega byte 0x02 al final del plaintext (record delimiter)
  const ptBytes = enc.encode(plaintext);
  const padded = concat(ptBytes, new Uint8Array([2]));

  // Encripta
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cekKey, padded);

  // Cabecera aes128gcm: salt(16) + rs(4) + keylen(1) + senderPublic(65)
  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + senderPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs, false);
  header[20] = senderPublic.length;
  header.set(senderPublic, 21);

  return concat(header, new Uint8Array(ciphertext));
}

async function hkdf(salt, ikm, info, length) {
  const saltKey = await crypto.subtle.importKey("raw", salt, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const prk = new Uint8Array(await crypto.subtle.sign("HMAC", saltKey, ikm));
  const prkKey = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const t = new Uint8Array(await crypto.subtle.sign("HMAC", prkKey, concat(info, new Uint8Array([1]))));
  return t.slice(0, length);
}

function concat(...arrays) {
  const total = arrays.reduce((s, a) => s + a.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(new Uint8Array(a instanceof ArrayBuffer ? a : a.buffer, a.byteOffset, a.byteLength), offset); offset += a.byteLength; }
  return out;
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
