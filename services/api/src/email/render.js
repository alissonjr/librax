import { STRINGS } from './strings.js';

/**
 * E-mails do Librax: um layout so, quatro mensagens, tres idiomas, cada uma em HTML e em texto.
 *
 *   signupCode  codigo de confirmacao do cadastro (gatilho Custom Message do Cognito)
 *   resetCode   codigo de nova senha (gatilho Custom Message do Cognito)
 *   reminder    lembrete de estudo com a sequencia e o botao para o app (Lambda de lembretes)
 *   newDevice   aviso de acesso num aparelho novo (POST /v1/users/me/devices)
 *
 * Identidade visual (docs/design-system.md): fundo `bg.canvas`, card branco com raio 22 e borda
 * `border.subtle`, botao primario em pilula tangerina com texto grafite e a base de 3 px da "tecla",
 * codigo num bloco tangerina suave com contorno completo (nunca faixa lateral). Clientes de e-mail
 * nao carregam fontes do site: Anybody e Figtree caem nas fontes do sistema. Estilos inline e
 * tabelas, que e o que Gmail, Outlook e Apple Mail entendem; o logo e um PNG no dominio do app
 * (`/email/logo.png`, apps/web-poc/public).
 *
 * Todo dado que vem de fora (nome, codigo, aparelho, pais) passa por escapeHtml no HTML. O HTML dos
 * codigos fica bem abaixo dos 20 mil caracteres que o Cognito aceita na mensagem.
 */

export const LANGS = ['pt-BR', 'en', 'es'];
export const DEFAULT_LANG = 'pt-BR';

/** Idioma suportado a partir do que o app ou o Cognito mandarem ('en-US', 'pt_BR', 'es-419'...). */
export function normalizeLang(raw) {
  if (typeof raw !== 'string') return DEFAULT_LANG;
  const v = raw.trim().toLowerCase().replace('_', '-');
  if (v.startsWith('pt')) return 'pt-BR';
  if (v.startsWith('en')) return 'en';
  if (v.startsWith('es')) return 'es';
  return DEFAULT_LANG;
}

/** Idioma valido de verdade (para gravar): so os tres do app, senao null. */
export function parseLang(raw) {
  if (typeof raw !== 'string' || raw.length > 16) return null;
  const v = raw.trim().toLowerCase().replace('_', '-');
  return /^(pt|en|es)(-[a-z0-9]{2,8})?$/.test(v) ? normalizeLang(v) : null;
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Nome para a saudacao: sem quebras, sem controle, no maximo 40 caracteres. */
function cleanName(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function fill(template, values = {}) {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
}

// Cores e medidas do design system (docs/design-tokens.json), com fallback seguro para e-mail
const C = {
  canvas: '#F7F5F2',
  surface: '#FFFFFF',
  border: '#E4DED6',
  text: '#1B1510',
  text2: '#4A4037',
  text3: '#62574C',
  brand: '#A83B00',
  primary: '#F05A0C',
  primaryBase: '#B8430A',
  primaryFg: '#1B1510',
  codeBg: '#FFE8D9',
  codeBorder: '#FFA772',
  noteBg: '#EEEAE4',
};
const FONT_TEXT = "Figtree,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const FONT_DISPLAY = "Anybody,'Arial Black',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function urls(appUrl) {
  const base = String(appUrl ?? '').replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s"'<>]+$/.test(base)) throw new Error('appUrl invalido');
  return {
    app: base,
    host: base.replace(/^https?:\/\//, ''),
    logo: `${base}/email/logo.png`,
    privacy: `${base}/privacidade`,
    terms: `${base}/termos`,
    settings: `${base}/configuracoes`,
    login: `${base}/entrar`,
  };
}

// --- pecas do HTML -------------------------------------------------------------------------------

const p = (html, extra = '') =>
  `<p style="margin:0 0 16px;font-family:${FONT_TEXT};font-size:16px;line-height:1.5;color:${C.text2};${extra}">${html}</p>`;

const h1 = (html) =>
  `<h1 style="margin:0 0 12px;font-family:${FONT_DISPLAY};font-size:26px;line-height:1.15;font-weight:800;color:${C.text};">${html}</h1>`;

function codeBlock(label, code) {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px;">` +
    `<tr><td align="center" style="background:${C.codeBg};border:1px solid ${C.codeBorder};border-radius:16px;padding:18px 12px;">` +
    `<div style="font-family:${FONT_TEXT};font-size:13px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:${C.brand};">${label}</div>` +
    `<div style="margin-top:6px;font-family:${FONT_DISPLAY};font-size:36px;line-height:1.1;font-weight:900;letter-spacing:8px;color:${C.text};">${code}</div>` +
    `</td></tr></table>`
  );
}

function button(label, href) {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;"><tr>` +
    `<td align="center" bgcolor="${C.primary}" style="background:${C.primary};border-radius:999px;border-bottom:3px solid ${C.primaryBase};">` +
    `<a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 28px;font-family:${FONT_DISPLAY};font-size:17px;line-height:1.25;font-weight:800;color:${C.primaryFg};text-decoration:none;border-radius:999px;">${label}</a>` +
    `</td></tr></table>`
  );
}

/** Bloco de aviso (fundo do card inteiro, sem faixa lateral). */
function note(title, html) {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 16px;">` +
    `<tr><td style="background:${C.noteBg};border-radius:16px;padding:16px;">` +
    (title ? `<div style="margin:0 0 6px;font-family:${FONT_TEXT};font-size:16px;font-weight:700;color:${C.text};">${title}</div>` : '') +
    `<div style="font-family:${FONT_TEXT};font-size:15px;line-height:1.5;color:${C.text2};">${html}</div>` +
    `</td></tr></table>`
  );
}

function facts(rows) {
  const tr = rows
    .map(
      ([k, v]) =>
        `<tr><td valign="top" style="padding:8px 12px 8px 0;font-family:${FONT_TEXT};font-size:14px;font-weight:700;color:${C.text3};white-space:nowrap;">${k}</td>` +
        `<td valign="top" style="padding:8px 0;font-family:${FONT_TEXT};font-size:15px;color:${C.text};">${v}</td></tr>`,
    )
    .join('');
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;border-top:1px solid ${C.border};border-bottom:1px solid ${C.border};">${tr}</table>`
  );
}

function streakBlock(label, value) {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 16px;"><tr>` +
    `<td style="background:${C.codeBg};border:1px solid ${C.codeBorder};border-radius:16px;padding:12px 20px;">` +
    `<div style="font-family:${FONT_TEXT};font-size:13px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:${C.brand};">${label}</div>` +
    `<div style="margin-top:2px;font-family:${FONT_DISPLAY};font-size:28px;line-height:1.2;font-weight:900;color:${C.text};">${value}</div>` +
    `</td></tr></table>`
  );
}

const link = (label, href) =>
  `<a href="${escapeHtml(href)}" style="color:${C.brand};text-decoration:underline;">${label}</a>`;

function layout({ lang, title, preheader, body, footerExtra = '', u, t }) {
  const small = `font-family:${FONT_TEXT};font-size:13px;line-height:1.5;color:${C.text3};`;
  return (
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">` +
    `<title>${title}</title></head>` +
    `<body style="margin:0;padding:0;background:${C.canvas};">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.canvas};">${preheader}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.canvas}" style="background:${C.canvas};">` +
    `<tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">` +
    // cabecalho: palavra-marca (PNG no dominio do app; o alt mostra o nome se a imagem nao carregar)
    `<tr><td style="padding:4px 8px 20px;">` +
    `<a href="${escapeHtml(u.app)}" style="text-decoration:none;"><img src="${escapeHtml(u.logo)}" width="163" height="40" alt="Librax" ` +
    `style="display:block;border:0;outline:none;width:163px;height:40px;font-family:${FONT_DISPLAY};font-size:26px;font-weight:900;color:${C.text};"></a>` +
    `</td></tr>` +
    // card
    `<tr><td bgcolor="${C.surface}" style="background:${C.surface};border:1px solid ${C.border};border-radius:22px;padding:28px 24px;">` +
    body +
    `</td></tr>` +
    // rodape
    `<tr><td style="padding:20px 8px 8px;">` +
    (footerExtra ? `<p style="margin:0 0 12px;${small}">${footerExtra}</p>` : '') +
    `<p style="margin:0 0 12px;${small}">${t.common.tagline}<br>${t.common.automatic}</p>` +
    `<p style="margin:0;${small}">${link(t.common.privacy, u.privacy)} &nbsp;·&nbsp; ${link(t.common.terms, u.terms)} &nbsp;·&nbsp; ${link(escapeHtml(u.host), u.app)}</p>` +
    `</td></tr></table></td></tr></table></body></html>`
  );
}

function textFooter(t, u, extra = []) {
  return [
    '',
    '--',
    ...extra,
    t.common.tagline,
    t.common.automatic,
    `${t.common.privacy}: ${u.privacy}`,
    `${t.common.terms}: ${u.terms}`,
    u.app,
  ].join('\n');
}

// --- aparelho e horario (aviso de acesso novo) ---------------------------------------------------

const BROWSERS = new Set(['Chrome', 'Safari', 'Firefox', 'Edge', 'Samsung Internet', 'Opera']);
const SYSTEMS = new Set(['Android', 'iOS', 'iPadOS', 'Windows', 'macOS', 'Linux', 'ChromeOS']);

/** "Celular (Android)" e "Chrome", so com valores conhecidos (o resto vira "outro"). */
export function describeDevice(device = {}, lang = DEFAULT_LANG) {
  const t = STRINGS[normalizeLang(lang)].newDevice;
  const kind = t.kinds[device.kind] ?? t.kinds.unknown;
  const os = SYSTEMS.has(device.os) ? device.os : null;
  return {
    device: os ? `${kind} (${os})` : kind,
    browser: BROWSERS.has(device.browser) ? device.browser : t.otherBrowser,
  };
}

const INTL_LOCALE = { 'pt-BR': 'pt-BR', en: 'en-US', es: 'es' };

/** Data e hora no fuso da pessoa (ou UTC se o fuso nao for valido), com o nome curto do fuso. */
export function formatWhen(date, timeZone, lang = DEFAULT_LANG) {
  const opts = { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' };
  const locale = INTL_LOCALE[normalizeLang(lang)];
  try {
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(date);
  }
}

/** Nome do pais pelo codigo ISO (cabecalho do CloudFront), no idioma do e-mail; null se nao der. */
export function countryName(code, lang = DEFAULT_LANG) {
  if (typeof code !== 'string' || !/^[A-Z]{2}$/.test(code)) return null;
  try {
    const name = new Intl.DisplayNames([INTL_LOCALE[normalizeLang(lang)]], { type: 'region' }).of(code);
    return name && name !== code ? name : null;
  } catch {
    return null;
  }
}

// --- as quatro mensagens -------------------------------------------------------------------------

function greeting(t, name) {
  const n = cleanName(name);
  return {
    html: n ? fill(t.common.helloName, { name: escapeHtml(n) }) : t.common.hello,
    text: n ? fill(t.common.helloName, { name: n }) : t.common.hello,
  };
}

function codeEmail(section, { lang, appUrl, code, name }) {
  const t = STRINGS[lang];
  const s = t[section];
  const u = urls(appUrl);
  const hi = greeting(t, name);
  const codeHtml = escapeHtml(code);
  const warning = section === 'resetCode' ? note(s.notYouTitle, s.notYou) : p(s.notYou, `font-size:15px;color:${C.text3};`);
  const html = layout({
    lang,
    u,
    t,
    title: escapeHtml(s.subject),
    preheader: s.preheader,
    body: h1(s.title) + p(hi.html) + p(s.intro) + codeBlock(s.codeLabel, codeHtml) + p(s.expiry, `font-size:15px;`) + warning,
  });
  const text = [
    s.title,
    '',
    hi.text,
    s.intro,
    '',
    `${s.codeLabel}: ${code}`,
    s.expiry,
    '',
    section === 'resetCode' ? `${s.notYouTitle} ${s.notYou}` : s.notYou,
    textFooter(t, u),
  ].join('\n');
  return { subject: s.subject, html, text };
}

/**
 * @param {'daily'|'streak_risk'} kind
 * @param {{title: string, body: string}} message  o mesmo texto do push (domain/reminders.js)
 */
function reminderEmail({ lang, appUrl, message, streak = 0, name, url }) {
  const t = STRINGS[lang];
  const s = t.reminder;
  const u = urls(appUrl);
  const hi = greeting(t, name);
  const href = `${u.app}${url ?? '/'}`;
  const days = streak > 0 ? fill(streak === 1 ? s.days.one : s.days.other, { n: streak }) : null;
  const html = layout({
    lang,
    u,
    t,
    title: escapeHtml(message.title),
    preheader: s.preheader,
    body:
      h1(escapeHtml(message.title)) +
      p(hi.html) +
      p(escapeHtml(message.body)) +
      (days ? streakBlock(s.streakLabel, escapeHtml(days)) : '') +
      button(s.button, href),
    footerExtra: `${s.why} ${s.stop} ${link(escapeHtml(u.settings.replace(/^https?:\/\//, '')), u.settings)}`,
  });
  const text = [
    message.title,
    '',
    hi.text,
    message.body,
    ...(days ? ['', `${s.streakLabel}: ${days}`] : []),
    '',
    `${s.button}: ${href}`,
    textFooter(t, u, [s.why, `${s.stop} ${u.settings}`, '']),
  ].join('\n');
  return { subject: message.title, html, text };
}

function newDeviceEmail({ lang, appUrl, device, when, timeZone, country, name }) {
  const t = STRINGS[lang];
  const s = t.newDevice;
  const u = urls(appUrl);
  const hi = greeting(t, name);
  const d = describeDevice(device, lang);
  const whenText = formatWhen(when, timeZone, lang);
  const place = countryName(country, lang);
  const rows = [
    [s.device, d.device],
    [s.browser, d.browser],
    [s.when, whenText],
    ...(place ? [[s.country, place]] : []),
  ];
  const html = layout({
    lang,
    u,
    t,
    title: escapeHtml(s.subject),
    preheader: s.preheader,
    body:
      h1(s.title) +
      p(hi.html) +
      p(s.intro) +
      facts(rows.map(([k, v]) => [k, escapeHtml(v)])) +
      p(s.itWasYou) +
      note(s.notYouTitle, escapeHtml(s.notYou)) +
      button(s.button, u.login),
    footerExtra: s.why,
  });
  const text = [
    s.title,
    '',
    hi.text,
    s.intro,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    s.itWasYou,
    `${s.notYouTitle} ${s.notYou}`,
    '',
    `${s.button}: ${u.login}`,
    textFooter(t, u, [s.why, '']),
  ].join('\n');
  return { subject: s.subject, html, text };
}

/**
 * Monta um e-mail. `lang` qualquer (normalizado, cai em pt-BR); `appUrl` obrigatorio (https://app...).
 * @returns {{subject: string, html: string, text: string}}
 */
export function renderEmail(kind, params) {
  const lang = normalizeLang(params?.lang);
  const args = { ...params, lang };
  switch (kind) {
    case 'signupCode':
      return codeEmail('signupCode', args);
    case 'resetCode':
      return codeEmail('resetCode', args);
    case 'reminder':
      return reminderEmail(args);
    case 'newDevice':
      return newDeviceEmail(args);
    default:
      throw new Error(`e-mail desconhecido: ${kind}`);
  }
}
