/**
 * SRP-6a do Cognito (USER_SRP_AUTH) para o ambiente local.
 *
 * O moto aceita qualquer assinatura no PASSWORD_VERIFIER: o login por e-mail do app entraria
 * com qualquer senha. O proxy local (cognitoProxy.mjs) faz a parte do servidor de verdade: guarda
 * sal e verificador quando a senha passa por ele, troca SALT e SRP_B na resposta do
 * InitiateAuth e confere a assinatura antes de repassar o RespondToAuthChallenge.
 *
 * As contas seguem o Amplify (aws-amplify/auth, utils/srp): grupo de 3072 bits do RFC 5054,
 * g = 2, SHA-256, `getPaddedHex`, HKDF com "Caldera Derived Key" e a assinatura sobre
 * nome do pool + USER_ID_FOR_SRP + SECRET_BLOCK + TIMESTAMP. O lado do cliente (clientStart e
 * clientSignature) existe so para os testes e o teste de ponta a ponta.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

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

export const N = BigInt(`0x${N_HEX}`);
export const g = 2n;

const big = (hex) => BigInt(`0x${hex}`);
const mod = (a, m) => ((a % m) + m) % m;

export function modPow(base, exp, m) {
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

/** Hex de tamanho par, com "00" na frente quando o bit mais alto esta ligado (getPaddedHex). */
export function padHex(n) {
  let hex = n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return /^[89a-f]/i.test(hex) ? `00${hex}` : hex;
}

const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');
const hexHash = (hex) => sha256Hex(Buffer.from(hex, 'hex'));
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

const k = big(hexHash(`${padHex(N)}${padHex(g)}`));

/** Nome do pool que entra nas contas: o que vem depois do "_" no id. */
export const poolNameOf = (userPoolId) => String(userPoolId).split('_')[1] ?? '';

function computeX({ userPoolId, userId, password, salt }) {
  const inner = sha256Hex(`${poolNameOf(userPoolId)}${userId}:${password}`);
  return big(hexHash(padHex(big(salt)) + inner));
}

/** SECRET_BLOCK em base64 (ou base64url, como o Amplify aceita) para bytes. */
const secretBlockBytes = (block) => Buffer.from(String(block).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function hkdf(S, u) {
  const prk = hmac(Buffer.from(padHex(u), 'hex'), Buffer.from(padHex(S), 'hex'));
  return hmac(prk, Buffer.concat([Buffer.from('Caldera Derived Key', 'utf8'), Buffer.from([1])])).subarray(0, 16);
}

function signature({ userPoolId, userId, secretBlock, timestamp, key }) {
  const message = Buffer.concat([
    Buffer.from(poolNameOf(userPoolId), 'utf8'),
    Buffer.from(userId, 'utf8'),
    secretBlockBytes(secretBlock),
    Buffer.from(timestamp, 'utf8'),
  ]);
  return hmac(key, message).toString('base64');
}

// ---------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------

/** Sal e verificador de uma senha (guardados no lugar da senha). */
export function makeVerifier({ userPoolId, userId, password }) {
  const salt = padHex(big(randomBytes(16).toString('hex')));
  const x = computeX({ userPoolId, userId, password, salt });
  return { salt, verifier: padHex(modPow(g, x, N)) };
}

/**
 * Inicio do desafio: recebe o SRP_A do cliente e devolve SRP_B e o estado que a conferencia usa.
 * @returns {{B: string, state: {A: string, b: string, B: string}}}
 */
export function startChallenge({ verifier, A }) {
  const a = big(A);
  if (mod(a, N) === 0n) throw new Error('SRP_A invalido');
  const v = big(verifier);
  let b;
  let B;
  do {
    b = big(randomBytes(128).toString('hex'));
    B = mod(k * v + modPow(g, b, N), N);
  } while (B === 0n);
  return { B: B.toString(16), state: { A, b: b.toString(16), B: B.toString(16) } };
}

/** Confere a PASSWORD_CLAIM_SIGNATURE do cliente. */
export function verifyClaim({ userPoolId, userId, verifier, state, secretBlock, timestamp, claimSignature }) {
  const A = big(state.A);
  const B = big(state.B);
  const u = big(hexHash(padHex(A) + padHex(B)));
  if (u === 0n) return false;
  const S = modPow((A * modPow(big(verifier), u, N)) % N, big(state.b), N);
  const expected = Buffer.from(signature({ userPoolId, userId, secretBlock, timestamp, key: hkdf(S, u) }));
  const given = Buffer.from(String(claimSignature ?? ''));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Bloco secreto novo, em base64 como o do Cognito. */
export const newSecretBlock = () => randomBytes(48).toString('base64');

// ---------------------------------------------------------------------------
// Cliente (igual ao Amplify): so testes e teste de ponta a ponta
// ---------------------------------------------------------------------------

export function clientStart() {
  let a;
  let A;
  do {
    a = big(randomBytes(128).toString('hex'));
    A = modPow(g, a, N);
  } while (A === 0n);
  return { a: a.toString(16), A: A.toString(16) };
}

/** "Tue Oct 23 22:16:00 UTC 2026", como o getNowString do Amplify. */
export function nowString(date = new Date()) {
  const week = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()];
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getUTCMonth()];
  const two = (n) => String(n).padStart(2, '0');
  return `${week} ${month} ${date.getUTCDate()} ${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:${two(date.getUTCSeconds())} UTC ${date.getUTCFullYear()}`;
}

export function clientSignature({ userPoolId, userId, password, a, A, B, salt, secretBlock, timestamp }) {
  const bigA = big(A);
  const bigB = big(B);
  const u = big(hexHash(padHex(bigA) + padHex(bigB)));
  const x = computeX({ userPoolId, userId, password, salt });
  const S = modPow(mod(bigB - k * modPow(g, x, N), N), big(a) + u * x, N);
  return signature({ userPoolId, userId, secretBlock, timestamp, key: hkdf(S, u) });
}
