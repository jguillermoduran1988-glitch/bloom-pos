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
  // Guarda el payload como fallback para SWs que no reciben datos cifrados.
  // No-throw: si la tabla push_latest no existe, los pushes se siguen enviando.
  try { await saveLatestNotification(env, store, notification); } catch (e) { console.error("push_latest:", e); }

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

  let body, extraHeaders = {};

  if (sub.p256dh && sub.auth) {
    try {
      body = await encryptPushPayload(sub.p256dh, sub.auth, notification);
      extraHeaders = {
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        "Content-Length": String(body.byteLength),
      };
    } catch (e) {
      console.error("Error cifrando payload push:", e);
      body = undefined;
      extraHeaders = { "Content-Length": "0" };
    }
  } else {
    extraHeaders = { "Content-Length": "0" };
  }

  const headers = {
    TTL: "86400",
    Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
    Urgency: "high",
    ...extraHeaders,
  };

  const r = await fetch(sub.endpoint, { method: "POST", headers, body });
  return { ok: r.ok, status: r.status, text: r.ok ? "" : await r.text().catch(() => "") };
}

// ---- RFC 8291 aes128gcm payload encryption ----
function concatBytes(...arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

async function hmacSha256(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

async function hkdfExtract(salt, ikm) {
  return hmacSha256(salt, ikm);
}

async function hkdfExpand(prk, info, length) {
  const okm = await hmacSha256(prk, concatBytes(info, new Uint8Array([1])));
  return okm.slice(0, length);
}

async function encryptPushPayload(p256dh, auth, payload) {
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const authBytes = b64UrlToBytes(auth);
  const subPubBytes = b64UrlToBytes(p256dh);

  // Server ephemeral key pair
  const serverKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const serverPubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeys.publicKey));

  // ECDH shared secret
  const subPubKey = await crypto.subtle.importKey("raw", subPubBytes, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: subPubKey }, serverKeys.privateKey, 256));

  // PRK = HKDF-Extract(salt=auth, IKM=ecdh_secret)
  const prk = await hkdfExtract(authBytes, ecdhSecret);

  // IKM = HKDF-Expand(PRK, "WebPush: info\x00" + subPub + serverPub, 32)
  const keyInfo = concatBytes(new TextEncoder().encode("WebPush: info\x00"), subPubBytes, serverPubRaw);
  const ikm = await hkdfExpand(prk, keyInfo, 32);

  // PRK_content = HKDF-Extract(salt=record_salt, IKM=ikm)
  const prkContent = await hkdfExtract(salt, ikm);

  // CEK = HKDF-Expand(PRK_content, "Content-Encryption-Key", 16)
  const cek = await hkdfExpand(prkContent, new TextEncoder().encode("Content-Encryption-Key"), 16);

  // Nonce = HKDF-Expand(PRK_content, "Nonce", 12)
  const nonce = await hkdfExpand(prkContent, new TextEncoder().encode("Nonce"), 12);

  // Pad: plaintext + 0x02 (last-record delimiter for aes128gcm)
  const padded = concatBytes(plaintext, new Uint8Array([2]));

  // Encrypt with AES-128-GCM
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded));

  // aes128gcm body: salt(16) + rs(4,BE) + keyid_len(1=65) + serverPub(65) + ciphertext
  const rs = new ArrayBuffer(4);
  new DataView(rs).setUint32(0, 4096, false);
  return concatBytes(salt, new Uint8Array(rs), new Uint8Array([65]), serverPubRaw, ciphertext);
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
