import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderEmail, normalizeLang, parseLang, escapeHtml, describeDevice, formatWhen, countryName, LANGS } from '../src/email/render.js';
import { STRINGS } from '../src/email/strings.js';
import { reminderMessage } from '../src/domain/reminders.js';

// Os quatro e-mails do Librax (email/render.js): um layout, tres idiomas, HTML e texto.

const appUrl = 'https://app.librax.example';
const when = new Date('2026-10-26T23:03:00Z');
const device = { kind: 'mobile', os: 'Android', browser: 'Chrome' };

function all() {
  const out = [];
  for (const lang of LANGS) {
    out.push(['signupCode', lang, renderEmail('signupCode', { lang, appUrl, code: '{####}', name: 'Ana' })]);
    out.push(['resetCode', lang, renderEmail('resetCode', { lang, appUrl, code: '{####}' })]);
    out.push(['reminder', lang, renderEmail('reminder', { lang, appUrl, message: reminderMessage('daily', 5, lang), streak: 5, url: '/?origem=lembrete' })]);
    out.push(['newDevice', lang, renderEmail('newDevice', { lang, appUrl, device, when, timeZone: 'America/Sao_Paulo', country: 'BR' })]);
  }
  return out;
}

test('quatro e-mails em tres idiomas, cada um com assunto, HTML e texto', () => {
  const rendered = all();
  assert.equal(rendered.length, 12);
  for (const [kind, lang, e] of rendered) {
    assert.ok(e.subject.length > 0 && e.subject.length <= 140, `${kind} ${lang}: assunto`);
    assert.match(e.html, new RegExp(`<html lang="${lang}">`));
    assert.ok(e.text.length > 50, `${kind} ${lang}: texto`);
    assert.doesNotMatch(e.text, /<[a-z]/i, `${kind} ${lang}: texto sem HTML`);
  }
});

test('sem travessao, sem meia-risca e sem emoji em nenhum texto (strings e e-mails prontos)', () => {
  const forbidden = /[\u2013\u2014]|\p{Extended_Pictographic}/u;
  assert.doesNotMatch(JSON.stringify(STRINGS), forbidden);
  for (const [kind, lang, e] of all()) {
    for (const part of [e.subject, e.html, e.text]) assert.doesNotMatch(part, forbidden, `${kind} ${lang}`);
  }
});

test('os tres dicionarios tem as mesmas chaves', () => {
  const keys = (o, prefix = '') =>
    Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`])).sort();
  assert.deepEqual(keys(STRINGS.en), keys(STRINGS['pt-BR']));
  assert.deepEqual(keys(STRINGS.es), keys(STRINGS['pt-BR']));
});

test('layout: logo no dominio do app, rodape com Politica, Termos e o dominio', () => {
  for (const [, , e] of all()) {
    assert.match(e.html, /<img src="https:\/\/app\.librax\.example\/email\/logo\.png"[^>]*alt="Librax"/);
    assert.match(e.html, /href="https:\/\/app\.librax\.example\/privacidade"/);
    assert.match(e.html, /href="https:\/\/app\.librax\.example\/termos"/);
    assert.match(e.html, />app\.librax\.example</);
    assert.match(e.text, /https:\/\/app\.librax\.example\/privacidade/);
    assert.match(e.text, /https:\/\/app\.librax\.example\/termos/);
    // so estilos inline: nada de <style>, <link> ou fonte externa
    assert.doesNotMatch(e.html, /<style|<link|@import|fonts\.googleapis/);
  }
});

test('codigos: o marcador do Cognito aparece no HTML e no texto, em portugues por padrao', () => {
  const e = renderEmail('signupCode', { appUrl, code: '{####}' });
  assert.equal(e.subject, 'Confirme seu e-mail no Librax');
  assert.match(e.html, /\{####\}/);
  assert.match(e.text, /Seu código: \{####\}/);
  assert.ok(e.html.length < 20000);

  const en = renderEmail('resetCode', { lang: 'en-US', appUrl, code: '{####}' });
  assert.equal(en.subject, 'Your code to create a new Librax password');
  assert.match(en.html, /Was it not you\?/);
  assert.match(en.text, /create a new password in the app to protect your account/);
  assert.equal(renderEmail('resetCode', { lang: 'es', appUrl, code: '{####}' }).subject, 'Código para crear una nueva contraseña en Librax');
});

test('dados de fora sao escapados no HTML (nome, codigo, aparelho)', () => {
  const e = renderEmail('signupCode', { appUrl, code: '<b>1</b>', name: 'Ana"><script>x</script>' });
  assert.doesNotMatch(e.html, /<script>|<b>1<\/b>/);
  assert.match(e.html, /&lt;b&gt;1&lt;\/b&gt;/);
  assert.equal(escapeHtml(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');

  const d = renderEmail('newDevice', { appUrl, device: { kind: 'x', os: '<img>', browser: '<svg onload=1>' }, when, timeZone: 'America/Sao_Paulo' });
  assert.doesNotMatch(d.html, /<svg|<img>/);
  assert.match(d.html, /Outro navegador/);
});

test('lembrete: titulo do push, sequencia, botao para o app e como desligar', () => {
  const e = renderEmail('reminder', { lang: 'pt-BR', appUrl, message: reminderMessage('streak_risk', 12), streak: 12, url: '/?origem=lembrete' });
  assert.equal(e.subject, 'Sua sequência vai até meia-noite');
  assert.match(e.html, /12 dias/);
  assert.match(e.html, /href="https:\/\/app\.librax\.example\/\?origem=lembrete"[^>]*>Fazer uma lição</);
  assert.match(e.html, /href="https:\/\/app\.librax\.example\/configuracoes"/);
  assert.match(e.text, /Fazer uma lição: https:\/\/app\.librax\.example\/\?origem=lembrete/);
  // sem sequencia, sem o bloco
  const zero = renderEmail('reminder', { appUrl, message: reminderMessage('daily', 0), streak: 0 });
  assert.doesNotMatch(zero.html, /Sua sequência</);
  assert.match(renderEmail('reminder', { lang: 'en', appUrl, message: reminderMessage('daily', 1, 'en'), streak: 1 }).text, /Your streak: 1 day/);
});

test('acesso novo: aparelho, navegador, hora no fuso, pais e o que fazer', () => {
  const e = renderEmail('newDevice', { lang: 'pt-BR', appUrl, device, when, timeZone: 'America/Sao_Paulo', country: 'BR' });
  assert.equal(e.subject, 'Novo acesso à sua conta do Librax');
  assert.match(e.text, /Aparelho: Celular \(Android\)/);
  assert.match(e.text, /Navegador: Chrome/);
  assert.match(e.text, /26 de outubro de 2026.*20:03/);
  assert.match(e.text, /País aproximado: Brasil/);
  assert.match(e.text, /Esqueci a senha/);
  assert.match(e.html, /href="https:\/\/app\.librax\.example\/entrar"/);
  // sem pais, sem a linha
  const semPais = renderEmail('newDevice', { lang: 'es', appUrl, device, when, timeZone: 'Europe/Madrid' });
  assert.doesNotMatch(semPais.text, /País aproximado/);
  assert.match(semPais.text, /Celular \(Android\)/);
});

test('idioma: normaliza o que vier e cai em pt-BR', () => {
  assert.equal(normalizeLang('en-US'), 'en');
  assert.equal(normalizeLang('es_419'), 'es');
  assert.equal(normalizeLang('pt'), 'pt-BR');
  assert.equal(normalizeLang('fr'), 'pt-BR');
  assert.equal(normalizeLang(undefined), 'pt-BR');
  assert.equal(parseLang('en'), 'en');
  assert.equal(parseLang('fr'), null);
  assert.equal(parseLang('x'.repeat(40)), null);
});

test('auxiliares: aparelho, hora com fuso invalido em UTC, pais', () => {
  assert.deepEqual(describeDevice({ kind: 'desktop', os: 'Windows', browser: 'Edge' }, 'en'), { device: 'Computer (Windows)', browser: 'Edge' });
  assert.deepEqual(describeDevice({}, 'es'), { device: 'Dispositivo', browser: 'Otro navegador' });
  assert.match(formatWhen(when, 'Nao/Existe', 'en'), /UTC/);
  assert.equal(countryName('ES', 'es'), 'España');
  assert.equal(countryName('zz', 'en'), null);
  assert.equal(countryName(undefined), null);
});

test('appUrl e obrigatorio e precisa ser http(s)', () => {
  assert.throws(() => renderEmail('signupCode', { code: '1' }), /appUrl/);
  assert.throws(() => renderEmail('signupCode', { appUrl: 'javascript:alert(1)', code: '1' }), /appUrl/);
  assert.throws(() => renderEmail('outro', { appUrl }), /desconhecido/);
});
