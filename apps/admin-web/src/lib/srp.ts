/*
 * SRP-6a do Cognito (USER_SRP_AUTH), lado do navegador: a senha nunca sai daqui, só a prova de que
 * ela é conhecida. É a mesma conta que o Amplify faz no app (aws-amplify/auth, utils/srp) e que o
 * proxy do ambiente local confere (services/api/local/srp.mjs): grupo de 3072 bits do RFC 5054,
 * g = 2, SHA-256, hex com "00" na frente quando o bit mais alto está ligado, HKDF com
 * "Caldera Derived Key" e a assinatura sobre nome do pool + USER_ID_FOR_SRP + SECRET_BLOCK +
 * TIMESTAMP. Sem biblioteca: BigInt e Web Crypto do próprio navegador.
 */

const N_HEX =
  'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1' +
  '29024E088A67CC74020BBEA63B139B22514A08798E3404DD' +
  'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245' +
  'E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
  'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D' +
  'C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F' +
  '83655D23DCA3AD961C62F356208552BB9ED529077096966D' +
  '670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B' +
  'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9' +
  'DE2BCBF6955817183995497CEA956AE515D2261898FA0510' +
  '15728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64' +
  'ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7' +
  'ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6B' +
  'F12FFA06D98A0864D87602733EC86A64521F2B18177B200C' +
  'BBE117577A615D6C770988C0BAD946E208E24FA074E5AB31' +
  '43DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF';

const N = BigInt(`0x${N_HEX}`);
/** Bytes sobre ArrayBuffer comum, como o Web Crypto pede. */
type Bytes = Uint8Array<ArrayBuffer>;
const g = 2n;

const big = (hex: string) => BigInt(`0x${hex}`);
const mod = (a: bigint, m: bigint) => ((a % m) + m) % m;

function modPow(base: bigint, exp: bigint, m: bigint): bigint {
  let result = 1n;
  let b = mod(base, m);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

/** Hex de tamanho par, com "00" na frente quando o bit mais alto está ligado (getPaddedHex). */
export function padHex(n: bigint): string {
  let hex = n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return /^[89a-f]/i.test(hex) ? `00${hex}` : hex;
}

function hexToBytes(hex: string): Bytes {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

const utf8 = (s: string): Bytes => new TextEncoder().encode(s);

function concat(...parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function sha256Hex(data: Bytes): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}

const hexHash = (hex: string) => sha256Hex(hexToBytes(hex));

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

function base64ToBytes(b64: string): Bytes {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

let kCache: Promise<bigint> | null = null;
const multiplier = () => (kCache ??= hexHash(`${padHex(N)}${padHex(g)}`).then(big));

/** Nome do pool que entra nas contas: o que vem depois do "_" no id (us-east-1_AbC -> AbC). */
export const poolNameOf = (userPoolId: string) => userPoolId.split('_')[1] ?? '';

export interface SrpClient {
  /** Segredo do navegador (hex), só na memória durante o login. */
  a: string;
  /** SRP_A (hex) que vai no InitiateAuth. */
  A: string;
}

/** Começo do login: segredo aleatório de 128 bytes e A = g^a mod N. */
export function srpStart(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): SrpClient {
  for (;;) {
    const a = big(bytesToHex(random(128)));
    const A = modPow(g, a, N);
    if (A !== 0n) return { a: a.toString(16), A: A.toString(16) };
  }
}

/** "Tue Oct 3 22:16:00 UTC 2026": o formato que o Cognito espera (dia sem zero na frente). */
export function nowString(date = new Date()): string {
  const week = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()];
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getUTCMonth()];
  const two = (n: number) => String(n).padStart(2, '0');
  return `${week} ${month} ${date.getUTCDate()} ${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:${two(date.getUTCSeconds())} UTC ${date.getUTCFullYear()}`;
}

export interface PasswordClaim {
  userPoolId: string;
  /** USER_ID_FOR_SRP do desafio. */
  userId: string;
  password: string;
  client: SrpClient;
  /** SRP_B, SALT e SECRET_BLOCK do desafio PASSWORD_VERIFIER. */
  B: string;
  salt: string;
  secretBlock: string;
  timestamp: string;
}

/** PASSWORD_CLAIM_SIGNATURE (base64) da resposta ao PASSWORD_VERIFIER. */
export async function passwordSignature(c: PasswordClaim): Promise<string> {
  const k = await multiplier();
  const A = big(c.client.A);
  const B = big(c.B);
  if (mod(B, N) === 0n) throw new Error('SRP_B inválido');
  const u = big(await hexHash(padHex(A) + padHex(B)));
  if (u === 0n) throw new Error('SRP inválido');
  const poolName = poolNameOf(c.userPoolId);
  const inner = await sha256Hex(utf8(`${poolName}${c.userId}:${c.password}`));
  const x = big(await hexHash(padHex(big(c.salt)) + inner));
  const S = modPow(mod(B - k * modPow(g, x, N), N), big(c.client.a) + u * x, N);
  // HKDF de um bloco: chave de 16 bytes
  const prk = await hmac(hexToBytes(padHex(u)), hexToBytes(padHex(S)));
  const key = (await hmac(prk, concat(utf8('Caldera Derived Key'), new Uint8Array([1])))).slice(0, 16);
  const message = concat(utf8(poolName), utf8(c.userId), base64ToBytes(c.secretBlock), utf8(c.timestamp));
  return bytesToBase64(await hmac(key, message));
}
