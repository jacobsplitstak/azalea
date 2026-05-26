// Minimal Web Push (RFC 8030 + 8291) implementation for Cloudflare Workers.
// Uses Web Crypto only — no node deps — so it runs in the V8 isolate.
//
// Public surface:
//   - sendPush(subscription, payload, env) — encrypts + posts to push service.
//     Throws { statusCode, body } on push-service failure so the caller can
//     drop subscriptions that the service has retired (404 / 410).

const enc = new TextEncoder();
const HEX = '0123456789abcdef';

// ── base64url helpers ──────────────────────────────────────────────────────
function b64uToBytes(s) {
  // Convert base64url → base64 → bytes
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64u(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function concat(...arrs) {
  let len = 0;
  for (const a of arrs) len += a.length;
  const out = new Uint8Array(len);
  let i = 0;
  for (const a of arrs) { out.set(a, i); i += a.length; }
  return out;
}

// ── HKDF (RFC 5869) using SHA-256 ──────────────────────────────────────────
async function hkdfExtract(salt, ikm) {
  const key = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, ikm));
}
async function hkdfExpand(prk, info, length) {
  // We only need one block (length <= 32) for Web Push outputs.
  const key = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const t1 = new Uint8Array(await crypto.subtle.sign('HMAC', key, concat(info, new Uint8Array([0x01]))));
  return t1.slice(0, length);
}

// ── ECDSA P-256 signing for VAPID JWT ──────────────────────────────────────
async function importVapidPrivateKey(b64uD) {
  // The private key is the JWK d field. We don't have x/y here, so derive a
  // JWK with the public coords we already advertise. Web Push signing only
  // needs the private scalar, but WebCrypto requires the full JWK to import.
  const env = globalThis._azaleaVapidEnv;
  if (!env?.VAPID_PUBLIC_KEY) throw new Error('VAPID_PUBLIC_KEY env missing');
  const pubBytes = b64uToBytes(env.VAPID_PUBLIC_KEY);
  // pubBytes[0] === 0x04 (uncompressed) followed by 32-byte x and 32-byte y
  const x = bytesToB64u(pubBytes.slice(1, 33));
  const y = bytesToB64u(pubBytes.slice(33, 65));
  return crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: b64uD, x, y, ext: false },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
}

async function buildVapidJwt(audience, env) {
  globalThis._azaleaVapidEnv = env;
  const header = bytesToB64u(enc.encode(JSON.stringify({ alg: 'ES256', typ: 'JWT' })));
  const payload = bytesToB64u(enc.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12, // 12h
    sub: env.VAPID_SUBJECT || 'mailto:noreply@example.com'
  })));
  const signingInput = enc.encode(header + '.' + payload);
  const key = await importVapidPrivateKey(env.VAPID_PRIVATE_KEY);
  const sigDer = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    signingInput
  ));
  const sig = bytesToB64u(sigDer);
  return header + '.' + payload + '.' + sig;
}

// ── Web Push payload encryption (aes128gcm, RFC 8291) ──────────────────────
async function encryptPayload(plaintext, clientP256dh, clientAuth) {
  // 1. Generate ephemeral server keypair.
  const serverKey = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const serverPubJwk = await crypto.subtle.exportKey('jwk', serverKey.publicKey);
  const serverPubBytes = concat(
    new Uint8Array([0x04]),
    b64uToBytes(serverPubJwk.x),
    b64uToBytes(serverPubJwk.y)
  );

  // 2. Import client's public key.
  const clientPubKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: bytesToB64u(clientP256dh.slice(1, 33)),
      y: bytesToB64u(clientP256dh.slice(33, 65)),
      ext: true
    },
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );

  // 3. ECDH shared secret (32 bytes).
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientPubKey },
    serverKey.privateKey,
    256
  ));

  // 4. Salt (random 16 bytes).
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // 5. ikm via HKDF: prk = HKDF-extract(authSecret, sharedSecret),
  //    keyInfo = "WebPush: info\0" || clientP256dh || serverPubBytes,
  //    ikm = HKDF-expand(prk, keyInfo, 32).
  const prk = await hkdfExtract(clientAuth, sharedSecret);
  const keyInfo = concat(
    enc.encode('WebPush: info\0'),
    clientP256dh,
    serverPubBytes
  );
  const ikm = await hkdfExpand(prk, keyInfo, 32);

  // 6. Derive CEK + nonce.
  const prk2 = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prk2, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdfExpand(prk2, enc.encode('Content-Encoding: nonce\0'), 12);

  // 7. Encrypt: AES128-GCM(cek, nonce, plaintext || 0x02).
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const padded = concat(plaintext, new Uint8Array([0x02]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    aesKey,
    padded
  ));

  // 8. Build aes128gcm payload:
  //    salt(16) || rs(4 BE) || keyid_len(1) || serverPubKey(65) || ciphertext
  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  // record size big-endian
  header[16] = (rs >>> 24) & 0xff;
  header[17] = (rs >>> 16) & 0xff;
  header[18] = (rs >>> 8) & 0xff;
  header[19] = rs & 0xff;
  header[20] = 65; // keyid length = uncompressed pubkey length
  header.set(serverPubBytes, 21);

  return concat(header, ciphertext);
}

// ── Public sender ──────────────────────────────────────────────────────────
export async function sendPush(subscription, payload, env) {
  const endpoint = subscription.endpoint;
  const url = new URL(endpoint);
  const audience = url.origin;
  const jwt = await buildVapidJwt(audience, env);

  const p256dh = b64uToBytes(subscription.keys.p256dh);
  const auth   = b64uToBytes(subscription.keys.auth);
  const body   = enc.encode(typeof payload === 'string' ? payload : JSON.stringify(payload));
  const encrypted = await encryptPayload(body, p256dh, auth);

  const headers = {
    'Content-Type': 'application/octet-stream',
    'Content-Encoding': 'aes128gcm',
    'TTL': '86400',
    'Authorization': `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
  };

  const resp = await fetch(endpoint, { method: 'POST', headers, body: encrypted });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    const err = new Error(`push failed ${resp.status}: ${txt}`);
    err.statusCode = resp.status;
    err.body = txt;
    throw err;
  }
}
