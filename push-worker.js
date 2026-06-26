// ====================================================================
//  Cloudflare Worker - Bloom PWA Push
//  Endpoints:
//    POST /push/subscribe
//    POST /push/team-message
//  Secrets necesarios:
//    SUPABASE_URL, SUPABASE_SERVICE_KEY, VAPID_PUBLIC_KEY,
//    VAPID_PRIVATE_KEY, VAPID_SUBJECT
// ====================================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
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
  const results = await Promise.allSettled(targets.map(s => sendWebPush(env, s, notification)));

  let sent = 0;
  const failures = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled" && result.value.ok) sent++;
    const status = result.status === "fulfilled" ? result.value.status : 0;
    if (result.status === "rejected" || !result.value?.ok) failures.push({ status, error: String(result.reason || result.value?.text || result.value?.error || "unknown") });
    if (status === 404 || status === 410) await deactivateSubscription(env, targets[i].id);
  }
  return { ok: true, sent, total: targets.length, failures };
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
  };
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function sendWebPush(env, sub, notification) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
    return { ok: false, status: 0, error: "faltan secretos VAPID" };
  }

  const endpoint = new URL(sub.endpoint);
  const aud = `${endpoint.protocol}//${endpoint.host}`;
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const jwt = await createVapidJwt(env, aud, exp);
  const payload = JSON.stringify(notification);

  const withPayload = await sendEncryptedPush(env, sub, jwt, payload);
  if (withPayload.ok) return withPayload;

  const generic = await sendGenericPush(env, sub, jwt);
  return generic.ok ? { ...generic, fallback: true } : withPayload;
}

async function sendEncryptedPush(env, sub, jwt, payload) {
  const body = await encryptPushPayload(payload, sub.p256dh, sub.auth);
  const r = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      TTL: "60",
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
    },
    body,
  });
  return { ok: r.ok, status: r.status, text: r.ok ? "" : await r.text().catch(() => "") };
}

async function sendGenericPush(env, sub, jwt) {
  const r = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      TTL: "60",
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
    },
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

async function encryptPushPayload(payload, receiverPublicKey, receiverAuthSecret) {
  const plain = enc(payload);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const localKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const localPublicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", localKeys.publicKey));
  const receiverPublic = await crypto.subtle.importKey(
    "raw",
    b64UrlToBytes(receiverPublicKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: receiverPublic }, localKeys.privateKey, 256));
  const authSecret = b64UrlToBytes(receiverAuthSecret);

  const prk = await hkdfExtract(authSecret, sharedSecret);
  const keyInfo = concat(enc("WebPush: info\0"), b64UrlToBytes(receiverPublicKey), localPublicRaw);
  const ikm = await hkdfExpand(prk, keyInfo, 32);
  const saltPrk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(saltPrk, enc("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(saltPrk, enc("Content-Encoding: nonce\0"), 12);

  const record = concat(plain, new Uint8Array([2]));
  const cryptoKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, cryptoKey, record));

  const rs = 4096;
  const header = concat(salt, uint32be(rs), new Uint8Array([localPublicRaw.length]), localPublicRaw);
  return concat(header, encrypted);
}

async function hkdfExtract(salt, ikm) {
  const key = await crypto.subtle.importKey("raw", salt, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, ikm));
}

async function hkdfExpand(prk, info, len) {
  const key = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const out = new Uint8Array(await crypto.subtle.sign("HMAC", key, concat(info, new Uint8Array([1]))));
  return out.slice(0, len);
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

function uint32be(value) {
  return new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
}

function concat(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.length;
  }
  return out;
}
