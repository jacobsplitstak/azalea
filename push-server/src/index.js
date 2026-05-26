// Azalea push backend — Cloudflare Worker.
// Stores PushSubscriptions + scheduled notifications in KV. A cron trigger
// (every minute) sends due notifications via Web Push.
//
// HTTP API (CORS-open, no auth — endpoints are unguessable per subscription):
//   POST /subscribe   body: { subscription, schedules } → stored at subs:<hash>
//   POST /unsubscribe body: { endpoint }               → deletes the record
//   GET  /vapid-key                                    → plain-text VAPID pub
//   GET  /health                                       → "ok"

import { sendPush } from './webpush.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', ...extra },
  });
}

async function endpointHash(endpoint) {
  // SHA-256 of the endpoint as the KV key. Stable, opaque, collision-safe.
  const buf = new TextEncoder().encode(endpoint);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  let hex = '';
  for (let i = 0; i < hash.length; i++) hex += hash[i].toString(16).padStart(2, '0');
  return hex;
}

function validateSubscription(sub) {
  if (!sub || typeof sub !== 'object') return false;
  if (typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://')) return false;
  if (!sub.keys || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string') return false;
  return true;
}

function validateSchedules(schedules) {
  if (!Array.isArray(schedules)) return [];
  const out = [];
  const now = Date.now();
  const maxFuture = now + 90 * 24 * 60 * 60 * 1000; // cap at 90 days
  for (const s of schedules.slice(0, 100)) {
    if (!s || typeof s !== 'object') continue;
    const t = Number(s.t);
    if (!Number.isFinite(t) || t < now - 60_000 || t > maxFuture) continue;
    out.push({
      t,
      tag:   String(s.tag   || 'azalea').slice(0, 64),
      title: String(s.title || 'Azalea').slice(0, 120),
      body:  String(s.body  || '').slice(0, 240),
    });
  }
  return out;
}

export default {
  // ─────────────── HTTP ───────────────
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === '/health') {
      return new Response('ok', { headers: { ...CORS, 'Content-Type': 'text/plain' } });
    }

    if (url.pathname === '/vapid-key') {
      return new Response(env.VAPID_PUBLIC_KEY || '', {
        headers: { ...CORS, 'Content-Type': 'text/plain' },
      });
    }

    if (url.pathname === '/subscribe' && request.method === 'POST') {
      let data;
      try { data = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
      if (!validateSubscription(data.subscription)) return json({ error: 'invalid_subscription' }, 400);
      const schedules = validateSchedules(data.schedules);
      const key = 'sub:' + await endpointHash(data.subscription.endpoint);
      await env.SUBS.put(key, JSON.stringify({
        subscription: data.subscription,
        schedules,
        updated: Date.now(),
      }), { expirationTtl: 60 * 60 * 24 * 120 }); // 120 days idle TTL
      return json({ ok: true, scheduled: schedules.length });
    }

    if (url.pathname === '/unsubscribe' && request.method === 'POST') {
      let data;
      try { data = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
      if (typeof data.endpoint !== 'string') return json({ error: 'invalid_endpoint' }, 400);
      const key = 'sub:' + await endpointHash(data.endpoint);
      await env.SUBS.delete(key);
      return json({ ok: true });
    }

    return json({ error: 'not_found' }, 404);
  },

  // ─────────────── Cron — runs every minute ───────────────
  async scheduled(event, env, ctx) {
    const now = Date.now();
    let cursor;
    let processed = 0, sent = 0, dropped = 0, errors = 0;

    do {
      const list = await env.SUBS.list({ prefix: 'sub:', cursor });
      cursor = list.cursor;
      for (const entry of list.keys) {
        processed++;
        const raw = await env.SUBS.get(entry.name);
        if (!raw) continue;
        let record;
        try { record = JSON.parse(raw); } catch { await env.SUBS.delete(entry.name); continue; }
        const schedules = Array.isArray(record.schedules) ? record.schedules : [];
        const due = schedules.filter(s => Number(s.t) <= now);
        if (due.length === 0) continue;
        const remaining = schedules.filter(s => Number(s.t) > now);

        let drop = false;
        for (const item of due) {
          try {
            await sendPush(record.subscription, {
              title: item.title,
              body:  item.body,
              tag:   item.tag,
              icon:  'icons/icon-192.png',
            }, env);
            sent++;
          } catch (e) {
            if (e.statusCode === 404 || e.statusCode === 410) {
              drop = true;
              break;
            }
            errors++;
            console.warn('push send failed', e.statusCode, e.message);
          }
        }

        if (drop) {
          await env.SUBS.delete(entry.name);
          dropped++;
        } else {
          await env.SUBS.put(entry.name, JSON.stringify({
            ...record,
            schedules: remaining,
            updated: Date.now(),
          }), { expirationTtl: 60 * 60 * 24 * 120 });
        }
      }
      if (list.list_complete) break;
    } while (cursor);

    console.log('cron run', { processed, sent, dropped, errors });
  },
};
