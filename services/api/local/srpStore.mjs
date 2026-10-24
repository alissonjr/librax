/**
 * Sal e verificador SRP de cada conta do ambiente local (infra/local/.data/srp.json).
 *
 * A senha nunca e guardada: so o verificador, como no Cognito. O bootstrap (contas de teste) e
 * o proxy (cadastro, troca de senha) escrevem; o proxy le a cada login, entao o arquivo e lido
 * de novo em cada consulta (e pequeno). `npm run local:reset` apaga junto com os volumes.
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PATHS } from './config.mjs';
import { makeVerifier } from './srp.mjs';

const key = (userPoolId, userId) => `${userPoolId}/${userId}`;

function load(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

export function makeSrpStore(file = PATHS.srp) {
  return {
    get(userPoolId, userId) {
      return load(file)[key(userPoolId, userId)] ?? null;
    },
    /** Calcula e guarda o verificador da senha nova. */
    setPassword(userPoolId, userId, password) {
      const all = load(file);
      all[key(userPoolId, userId)] = { ...makeVerifier({ userPoolId, userId, password }), updatedAt: new Date().toISOString() };
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(all, null, 1));
      renameSync(tmp, file);
    },
  };
}
