// Previas dos e-mails (email/render.js): os quatro e-mails nos tres idiomas, em HTML e texto, numa pasta.
// Uso: npm run emails:previa -- <pasta> [appUrl]
// O logo aponta para <appUrl>/email/logo.png (apps/web-poc/public/email/logo.png no app publicado).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { renderEmail, LANGS } from '../src/email/render.js';
import { reminderMessage, REMINDER_URL } from '../src/domain/reminders.js';

const out = resolve(process.argv[2] ?? 'previas-emails');
const appUrl = process.argv[3] ?? 'https://app.librax.online';
const names = { 'pt-BR': 'Ana', en: 'Alex', es: 'Eva' };
const when = new Date('2026-10-26T23:03:00Z');

mkdirSync(out, { recursive: true });
const index = [];
for (const lang of LANGS) {
  const emails = {
    'codigo-cadastro': renderEmail('signupCode', { lang, appUrl, code: '482913', name: names[lang] }),
    'codigo-nova-senha': renderEmail('resetCode', { lang, appUrl, code: '725046', name: names[lang] }),
    lembrete: renderEmail('reminder', {
      lang, appUrl, message: reminderMessage('streak_risk', 12, lang), streak: 12, name: names[lang], url: REMINDER_URL,
    }),
    'acesso-novo': renderEmail('newDevice', {
      lang, appUrl, device: { kind: 'desktop', os: 'Windows', browser: 'Edge' }, when, timeZone: 'America/Sao_Paulo', country: 'PT', name: names[lang],
    }),
  };
  for (const [kind, e] of Object.entries(emails)) {
    const base = `${kind}.${lang}`;
    writeFileSync(join(out, `${base}.html`), e.html);
    writeFileSync(join(out, `${base}.txt`), `Assunto: ${e.subject}\n\n${e.text}\n`);
    index.push(`${base}\t${e.html.length} caracteres\t${e.subject}`);
  }
}
writeFileSync(join(out, 'indice.txt'), index.join('\n') + '\n');
console.log(index.join('\n'));
console.log(`\n${index.length} e-mails em ${out}`);
