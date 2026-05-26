// Generates a P-256 ECDSA keypair for VAPID Web Push signing.
// Prints both keys in base64url, ready to plug into wrangler.toml + secrets.
// Run with: node scripts/generate-vapid-keys.js

import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

const pubJwk = publicKey.export({ format: 'jwk' });
const prvJwk = privateKey.export({ format: 'jwk' });

// JWK x/y/d fields are already base64url. Web Push public key is the
// uncompressed point: 0x04 || x || y, then base64url. Private key is just
// the d field, already base64url.
const xBuf = Buffer.from(pubJwk.x, 'base64url');
const yBuf = Buffer.from(pubJwk.y, 'base64url');
const uncompressed = Buffer.concat([Buffer.from([0x04]), xBuf, yBuf]);

const pub = uncompressed.toString('base64url');
const prv = prvJwk.d;

console.log('# Azalea VAPID keys');
console.log('# Public key (safe to embed in client, set as VAPID_PUBLIC_KEY var):');
console.log(pub);
console.log();
console.log('# Private key (KEEP SECRET, set with: wrangler secret put VAPID_PRIVATE_KEY):');
console.log(prv);
