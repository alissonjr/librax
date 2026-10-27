/**
 * Pagina local que imita o Hosted UI do Cognito (dominio do OAuth do app). O painel nao passa por
 * aqui: entra pela API do User Pool (SRP pelo proxy), e o client dele nao tem callback.
 *
 * O Amplify do app monta https://<dominio>/oauth2/authorize, /oauth2/token e /logout com https://
 * fixo: por isso esta pagina e HTTPS, com certificado autoassinado (127.0.0.1 e localhost). O codigo
 * de PKCE do app roda sem mudanca de logica.
 *
 * - /oauth2/authorize: confere client, redirect_uri (CallbackURLs do client), response_type e
 *   PKCE; mostra o login (e-mail e senha), o cadastro e o "Google (simulado)". Com sessao da
 *   pagina para o mesmo client, volta direto (como o Cognito lembra a sessao).
 * - Login por e-mail e senha: ADMIN_USER_PASSWORD_AUTH no moto (que confere a senha).
 * - Cadastro: SignUp e ConfirmSignUp pelo proxy (codigo conferido, verificador SRP e
 *   PostConfirmation).
 * - Esqueci a senha: ForgotPassword e ConfirmForgotPassword pelo proxy; trocada a senha, volta ao
 *   login com o e-mail preenchido.
 * - Google (simulado): primeira vez cria a conta (com `identities` do Google) e dispara o
 *   PostConfirmation, como o primeiro login social no Cognito.
 * - /oauth2/token: authorization_code (com code_verifier S256) e refresh_token.
 * - /logout: confere o logout_uri do client, apaga a sessao e volta.
 * - /caixa: caixa de e-mails simulada com os codigos de confirmacao.
 * - Cadastro e Google (simulado) repetem a frase de aceite do app, com links para /termos e
 *   /privacidade do app local.
 */

import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PATHS, URLS } from './config.mjs';
import { CognitoError } from './moto.mjs';

const CSS = readFileSync(fileURLToPath(new URL('./hostedUi/login.css', import.meta.url)), 'utf8');
const TX_TTL_MS = 30 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const COOKIE = 'librax_local_login';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const b64url = (buf) => buf.toString('base64url');
const token = (n = 24) => b64url(randomBytes(n));

function page(title, body) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} | Librax local</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/static/tokens.css">
<link rel="stylesheet" href="/static/login.css">
</head>
<body>
<main class="hui">
<header class="hui-head">
<img src="/favicon.svg" alt="">
<p class="hui-brand">Librax</p>
<span class="hui-chip">Ambiente local</span>
</header>
${body}
<p class="hui-foot">Página local que imita o login do Cognito. Nada sai deste computador.</p>
</main>
</body>
</html>`;
}

const errorBox = (msg) => (msg ? `<p class="hui-error" role="alert">${esc(msg)}</p>` : '');

/** Mesma frase do app (legal.registerConsent), com os links para as páginas do app local. */
const legalConsent = (lead) =>
  `<p class="hui-legal">${esc(lead)}, você concorda com os <a href="${esc(URLS.app)}/termos">Termos de Uso</a> e a <a href="${esc(URLS.app)}/privacidade">Política de Privacidade</a>.</p>`;

/** Mensagens do Cognito para quem usa a pagina. */
function friendly(err) {
  switch (err?.type) {
    case 'NotAuthorizedException':
    case 'UserNotFoundException':
      return 'E-mail ou senha incorretos.';
    case 'UserNotConfirmedException':
      return 'Conta ainda não confirmada. Confirme o código enviado por e-mail.';
    case 'UsernameExistsException':
      return 'Já existe uma conta com este e-mail.';
    case 'InvalidPasswordException':
      return 'Senha fraca: use pelo menos 8 caracteres.';
    case 'InvalidParameterException':
      return 'Confira o e-mail e a senha.';
    case 'CodeMismatchException':
    case 'ExpiredCodeException':
      return 'Código incorreto ou vencido.';
    case 'LimitExceededException':
      return 'Muitas tentativas. Espere um pouco e tente de novo.';
    default:
      return 'Não deu para concluir. Veja o terminal do servidor local.';
  }
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(/;\s*/).filter(Boolean).map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))];
    }),
  );
}

/**
 * @param {object} deps
 * @param {object} deps.local   cognitoLocal.mjs
 * @param {object} deps.proxy   cognitoProxy.mjs (cadastro e confirmacao com as regras do Cognito)
 * @param {object} deps.state   state.json
 */
export function makeHostedUi({ local, proxy, state, log = console.log }) {
  const txs = new Map();
  const codes = new Map();
  const sessions = new Map();

  const clientLabel = (clientId) =>
    clientId === state.adminClientId ? 'Painel de administração' : clientId === state.appClientId ? 'App Librax' : 'Librax';

  /** Chama uma acao pelo proxy local; erro vira CognitoError. */
  async function viaProxy(target, body) {
    const res = await proxy.handle(target, JSON.stringify(body));
    const json = res.body ? JSON.parse(res.body) : {};
    if (res.status >= 400) throw new CognitoError(json.__type, json.message, res.status);
    return json;
  }

  function newTx(params) {
    const id = token(18);
    txs.set(id, { ...params, expiresAt: Date.now() + TX_TTL_MS });
    return id;
  }

  function getTx(id) {
    const tx = txs.get(id);
    return tx && tx.expiresAt > Date.now() ? tx : null;
  }

  /** Emite o code, guarda a sessao da pagina (cookie) e volta para o app ou o painel. */
  function finish(tx, tokens, user, currentSid) {
    const code = token(24);
    codes.set(code, {
      clientId: tx.clientId,
      redirectUri: tx.redirectUri,
      challenge: tx.codeChallenge,
      method: tx.codeChallengeMethod,
      tokens,
      expiresAt: Date.now() + CODE_TTL_MS,
    });
    const sid = currentSid ?? token(18);
    const session = sessions.get(sid) ?? { username: user.username, email: user.email, refresh: {} };
    if (session.username !== user.username) session.refresh = {};
    Object.assign(session, { username: user.username, email: user.email });
    session.refresh[tx.clientId] = tokens.RefreshToken;
    sessions.set(sid, session);
    const back = new URL(tx.redirectUri);
    back.searchParams.set('code', code);
    if (tx.state) back.searchParams.set('state', tx.state);
    return redirect(back.toString(), { 'Set-Cookie': `${COOKIE}=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax` });
  }

  const html = (status, body, headers = {}) => ({ status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers }, body });
  const redirect = (location, headers = {}) => ({ status: 302, headers: { Location: location, 'Cache-Control': 'no-store', ...headers }, body: '' });
  const json = (status, data, origin) => ({
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    },
    body: JSON.stringify(data),
  });
  const errorPage = (title, msg) => html(400, page(title, `<h1 class="hui-title">${esc(title)}</h1>${errorBox(msg)}`));

  // -------------------------------------------------------------------------
  // Telas
  // -------------------------------------------------------------------------

  function loginPage(txId, tx, { error, email, notice } = {}) {
    return html(error ? 400 : 200, page('Entrar', `
<h1 class="hui-title">Entrar</h1>
<p class="hui-lead">Para continuar no <strong>${esc(clientLabel(tx.clientId))}</strong>.</p>
${notice ? `<p class="hui-notice" role="status">${esc(notice)}</p>` : ''}
${errorBox(error)}
<form class="hui-form" method="post" action="/login" novalidate>
<input type="hidden" name="tx" value="${esc(txId)}">
<div class="hui-field">
<label class="hui-label" for="email">E-mail</label>
<input class="hui-input" id="email" name="email" type="email" autocomplete="username" autocapitalize="none" spellcheck="false" required value="${esc(email)}"${error ? ' aria-invalid="true"' : ''}>
</div>
<div class="hui-field">
<label class="hui-label" for="password">Senha</label>
<input class="hui-input" id="password" name="password" type="password" autocomplete="current-password" required${error ? ' aria-invalid="true"' : ''}>
</div>
<button class="btn btn-primary" type="submit">Entrar</button>
</form>
<p class="hui-switch"><a class="btn-text" href="/forgot?tx=${esc(txId)}">Esqueci a senha</a></p>
<p class="hui-divider" role="separator"><span>ou</span></p>
<a class="btn btn-ghost" href="/google?tx=${esc(txId)}">Google (simulado)</a>
<p class="hui-switch">Ainda não tem conta? <a class="btn-text" href="/signup?tx=${esc(txId)}">Criar conta</a></p>`));
  }

  function signupPage(txId, { error, email, name } = {}) {
    return html(error ? 400 : 200, page('Criar conta', `
<h1 class="hui-title">Criar conta</h1>
<p class="hui-lead">Mandamos um código para confirmar o e-mail (aqui, para a caixa simulada).</p>
${errorBox(error)}
<form class="hui-form" method="post" action="/signup" novalidate>
<input type="hidden" name="tx" value="${esc(txId)}">
<div class="hui-field">
<label class="hui-label" for="name">Como quer ser chamado</label>
<input class="hui-input" id="name" name="name" autocomplete="given-name" maxlength="30" value="${esc(name)}">
</div>
<div class="hui-field">
<label class="hui-label" for="email">E-mail</label>
<input class="hui-input" id="email" name="email" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" required value="${esc(email)}">
</div>
<div class="hui-field">
<label class="hui-label" for="password">Senha</label>
<input class="hui-input" id="password" name="password" type="password" autocomplete="new-password" minlength="8" required aria-describedby="password-hint">
<p class="hui-hint" id="password-hint">Pelo menos 8 caracteres.</p>
</div>
<button class="btn btn-primary" type="submit">Criar conta</button>
</form>
${legalConsent('Ao criar a conta')}
<p class="hui-switch">Já tem conta? <a class="btn-text" href="/login?tx=${esc(txId)}">Entrar</a></p>`));
  }

  function confirmPage(txId, { email, code, error } = {}) {
    return html(error ? 400 : 200, page('Confirmar e-mail', `
<h1 class="hui-title">Confirme o <span class="hui-nowrap">e-mail</span></h1>
<p class="hui-lead">Digite o código de 6 números enviado para <strong>${esc(email)}</strong>.</p>
${code ? `<p class="hui-notice">Caixa de e-mails simulada: o código é <strong>${esc(code)}</strong>.</p>` : ''}
${errorBox(error)}
<form class="hui-form" method="post" action="/confirm" novalidate>
<input type="hidden" name="tx" value="${esc(txId)}">
<div class="hui-field">
<label class="hui-label" for="code">Código</label>
<input class="hui-input hui-input--code" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required${error ? ' aria-invalid="true"' : ''}>
</div>
<button class="btn btn-primary" type="submit">Confirmar</button>
</form>`));
  }

  function forgotPage(txId, { error, email } = {}) {
    return html(error ? 400 : 200, page('Esqueci a senha', `
<h1 class="hui-title">Esqueci a senha</h1>
<p class="hui-lead">Mandamos um código para criar uma senha nova (aqui, para a caixa simulada). Conta criada pelo Google não tem senha: entre pelo Google.</p>
${errorBox(error)}
<form class="hui-form" method="post" action="/forgot" novalidate>
<input type="hidden" name="tx" value="${esc(txId)}">
<div class="hui-field">
<label class="hui-label" for="email">E-mail</label>
<input class="hui-input" id="email" name="email" type="email" autocomplete="username" autocapitalize="none" spellcheck="false" required value="${esc(email)}">
</div>
<button class="btn btn-primary" type="submit">Enviar código</button>
</form>
<p class="hui-switch"><a class="btn-text" href="/login?tx=${esc(txId)}">Voltar para entrar</a></p>`));
  }

  function resetPage(txId, { email, code, error } = {}) {
    return html(error ? 400 : 200, page('Senha nova', `
<h1 class="hui-title">Crie uma senha nova</h1>
<p class="hui-lead">Se houver uma conta com senha para <strong>${esc(email)}</strong>, o código foi enviado para esse e-mail.</p>
${code ? `<p class="hui-notice">Caixa de e-mails simulada: o código é <strong>${esc(code)}</strong>.</p>` : ''}
${errorBox(error)}
<form class="hui-form" method="post" action="/reset" novalidate>
<input type="hidden" name="tx" value="${esc(txId)}">
<div class="hui-field">
<label class="hui-label" for="code">Código</label>
<input class="hui-input hui-input--code" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required${error ? ' aria-invalid="true"' : ''}>
</div>
<div class="hui-field">
<label class="hui-label" for="password">Senha nova</label>
<input class="hui-input" id="password" name="password" type="password" autocomplete="new-password" minlength="8" required aria-describedby="password-hint">
<p class="hui-hint" id="password-hint">Pelo menos 8 caracteres.</p>
</div>
<button class="btn btn-primary" type="submit">Salvar senha nova</button>
</form>
<p class="hui-switch"><a class="btn-text" href="/forgot?tx=${esc(txId)}">Pedir outro código</a></p>`));
  }

  function googlePage(txId, { error, email = 'gabi.google@librax.example', name = 'Gabi' } = {}) {
    return html(error ? 400 : 200, page('Google (simulado)', `
<h1 class="hui-title">Google (simulado)</h1>
<p class="hui-lead">No lugar da tela do Google: escolha o e-mail e o nome que a conta Google devolveria. Na primeira vez a conta é criada, como no primeiro login social.</p>
${errorBox(error)}
<form class="hui-form" method="post" action="/google" novalidate>
<input type="hidden" name="tx" value="${esc(txId)}">
<div class="hui-field">
<label class="hui-label" for="g-name">Nome</label>
<input class="hui-input" id="g-name" name="name" autocomplete="given-name" maxlength="30" value="${esc(name)}">
</div>
<div class="hui-field">
<label class="hui-label" for="g-email">E-mail da conta Google</label>
<input class="hui-input" id="g-email" name="email" type="email" autocapitalize="none" spellcheck="false" required value="${esc(email)}">
</div>
<button class="btn btn-primary" type="submit">Continuar</button>
</form>
${legalConsent('Ao continuar')}
<p class="hui-switch"><a class="btn-text" href="/login?tx=${esc(txId)}">Voltar para e-mail e senha</a></p>`));
  }

  function inboxPage() {
    const items = local.inbox
      .map((m) => `<li><span>${esc(m.to)}<br><small class="hui-hint">${esc(m.purpose)}, ${esc(m.at.slice(11, 19))} UTC</small></span><span class="hui-code">${esc(m.code)}</span></li>`)
      .join('');
    return html(200, page('Caixa de e-mails', `
<h1 class="hui-title">Caixa de <span class="hui-nowrap">e-mails</span></h1>
<p class="hui-lead">Os códigos que o Cognito mandaria por e-mail (cadastro e nova senha), do mais novo para o mais velho.</p>
${items ? `<ul class="hui-list">${items}</ul>` : '<p class="hui-notice">Nenhum código ainda.</p>'}`));
  }

  function homePage() {
    return html(200, page('Ambiente local', `
<h1 class="hui-title">Login local</h1>
<p class="hui-lead">Esta página faz o papel do domínio de login do Cognito. Abra o app ou o painel e use "Entrar".</p>
<a class="btn btn-primary" href="${esc(URLS.app)}/">Abrir o app</a>
<a class="btn btn-ghost" href="${esc(URLS.admin)}/admin/">Abrir o painel</a>
<p class="hui-switch"><a class="btn-text" href="/caixa">Caixa de e-mails simulada</a></p>`));
  }

  // -------------------------------------------------------------------------
  // OAuth
  // -------------------------------------------------------------------------

  async function authorize(url, cookies) {
    const q = url.searchParams;
    const clientId = q.get('client_id');
    const client = local.clientsById.get(clientId);
    if (!client) return errorPage('Client inválido', `O client_id ${clientId ?? '(vazio)'} não existe neste User Pool.`);
    const redirectUri = q.get('redirect_uri');
    if (!redirectUri || !(client.props.CallbackURLs ?? []).includes(redirectUri)) {
      return errorPage('redirect_mismatch', `O endereço de volta ${redirectUri ?? '(vazio)'} não está nos callbacks do client.`);
    }
    const back = (error, description) => {
      const u = new URL(redirectUri);
      u.searchParams.set('error', error);
      if (description) u.searchParams.set('error_description', description);
      if (q.get('state')) u.searchParams.set('state', q.get('state'));
      return redirect(u.toString());
    };
    if (q.get('response_type') !== 'code' || !(client.props.AllowedOAuthFlows ?? []).includes('code')) {
      return back('unsupported_response_type');
    }
    const challenge = q.get('code_challenge');
    const method = q.get('code_challenge_method') ?? (challenge ? 'plain' : null);
    if (challenge && method !== 'S256') return back('invalid_request', 'code_challenge_method deve ser S256');
    const scopes = (q.get('scope') ?? 'openid').split(/[\s+]+/).filter(Boolean);
    if (scopes.some((s) => !(client.props.AllowedOAuthScopes ?? []).includes(s))) return back('invalid_scope');

    const tx = { clientId, redirectUri, state: q.get('state'), codeChallenge: challenge, codeChallengeMethod: method, scopes };
    const idp = q.get('identity_provider');
    if (idp && !(client.props.SupportedIdentityProviders ?? []).includes(idp)) return back('invalid_request', 'provedor nao habilitado');

    // Sessao da pagina para este client: volta direto, como o Cognito
    const sid = cookies[COOKIE];
    const session = sid && sessions.get(sid);
    if (session?.refresh?.[clientId] && !idp) {
      try {
        const tokens = await local.refreshTokens({ clientId, refreshToken: session.refresh[clientId] });
        return finish(tx, tokens, session, sid);
      } catch {
        delete session.refresh[clientId];
      }
    }

    const txId = newTx(tx);
    if (idp === 'Google') return googlePage(txId);
    return loginPage(txId, tx, { email: session?.email });
  }

  async function login(form, cookies) {
    const tx = getTx(form.tx);
    if (!tx) return errorPage('Sessão de login vencida', 'Volte ao app e toque em Entrar de novo.');
    const email = String(form.email ?? '').trim().toLowerCase();
    try {
      const user = await local.findByEmail(email);
      if (!user) throw new CognitoError('NotAuthorizedException');
      if (user.status === 'UNCONFIRMED') throw new CognitoError('UserNotConfirmedException');
      const tokens = await local.tokensFor({ clientId: tx.clientId, username: user.username, password: String(form.password ?? '') });
      return finish(tx, tokens, { username: user.username, email }, cookies[COOKIE]);
    } catch (err) {
      if (!(err instanceof CognitoError)) throw err;
      return loginPage(form.tx, tx, { error: friendly(err), email });
    }
  }

  async function signup(form) {
    const tx = getTx(form.tx);
    if (!tx) return errorPage('Sessão de login vencida', 'Volte ao app e toque em Entrar de novo.');
    const email = String(form.email ?? '').trim().toLowerCase();
    const name = String(form.name ?? '').trim();
    const password = String(form.password ?? '');
    try {
      await viaProxy('SignUp', {
        ClientId: tx.clientId,
        Username: email,
        Password: password,
        UserAttributes: [{ Name: 'email', Value: email }, ...(name ? [{ Name: 'given_name', Value: name }] : [])],
      });
      tx.pending = { email, password };
      return confirmPage(form.tx, { email, code: local.inbox[0]?.code });
    } catch (err) {
      if (!(err instanceof CognitoError)) throw err;
      return signupPage(form.tx, { error: friendly(err), email, name });
    }
  }

  async function confirm(form, cookies) {
    const tx = getTx(form.tx);
    if (!tx?.pending) return errorPage('Sessão de login vencida', 'Volte ao app e toque em Entrar de novo.');
    const { email, password } = tx.pending;
    try {
      await viaProxy('ConfirmSignUp', { ClientId: tx.clientId, Username: email, ConfirmationCode: String(form.code ?? '') });
      const user = await local.findByEmail(email);
      const tokens = await local.tokensFor({ clientId: tx.clientId, username: user.username, password });
      delete tx.pending;
      return finish(tx, tokens, { username: user.username, email }, cookies[COOKIE]);
    } catch (err) {
      if (!(err instanceof CognitoError)) throw err;
      return confirmPage(form.tx, { email, error: friendly(err) });
    }
  }

  async function forgot(form) {
    const tx = getTx(form.tx);
    if (!tx) return errorPage('Sessão de login vencida', 'Volte ao app e toque em Entrar de novo.');
    const email = String(form.email ?? '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return forgotPage(form.tx, { error: 'Informe um e-mail válido.', email });
    const last = local.inbox[0];
    try {
      await viaProxy('ForgotPassword', { ClientId: tx.clientId, Username: email });
      tx.reset = { email };
      // So mostra o codigo quando ele saiu agora (conta sem senha nao recebe nenhum)
      const sent = local.inbox[0] !== last ? local.inbox[0] : null;
      return resetPage(form.tx, { email, code: sent?.code });
    } catch (err) {
      if (!(err instanceof CognitoError)) throw err;
      return forgotPage(form.tx, { error: friendly(err), email });
    }
  }

  async function reset(form) {
    const tx = getTx(form.tx);
    if (!tx?.reset) return errorPage('Sessão de login vencida', 'Volte ao app e toque em Entrar de novo.');
    const { email } = tx.reset;
    try {
      await viaProxy('ConfirmForgotPassword', {
        ClientId: tx.clientId,
        Username: email,
        ConfirmationCode: String(form.code ?? '').trim(),
        Password: String(form.password ?? ''),
      });
      delete tx.reset;
      return loginPage(form.tx, tx, { email, notice: 'Senha alterada. Entre com a senha nova.' });
    } catch (err) {
      if (!(err instanceof CognitoError)) throw err;
      return resetPage(form.tx, { email, error: friendly(err) });
    }
  }

  async function google(form, cookies) {
    const tx = getTx(form.tx);
    if (!tx) return errorPage('Sessão de login vencida', 'Volte ao app e toque em Entrar de novo.');
    const email = String(form.email ?? '').trim().toLowerCase();
    const name = String(form.name ?? '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return googlePage(form.tx, { error: 'Informe um e-mail válido.', email, name });
    try {
      let user = await local.findByEmail(email);
      if (user && !String(user.attributes.identities ?? '').includes('Google')) {
        // No Cognito o Google criaria outra conta (google_...) com o mesmo e-mail; o moto nao
        // aceita dois usuarios com o mesmo e-mail
        return googlePage(form.tx, { error: 'Este e-mail já tem conta com senha. No ambiente local, use outro e-mail no Google simulado.', email, name });
      }
      if (!user) {
        user = await local.createAccount({ email, name: name || null, provider: 'Google' });
        await local.postConfirmation('PostConfirmation_ConfirmSignUp', user, tx.clientId);
        log(`[login local] conta Google (simulado) criada: ${email}`);
      }
      const tokens = await local.tokensFor({ clientId: tx.clientId, username: user.username });
      return finish(tx, tokens, { username: user.username, email }, cookies[COOKIE]);
    } catch (err) {
      if (!(err instanceof CognitoError)) throw err;
      return googlePage(form.tx, { error: friendly(err), email, name });
    }
  }

  async function tokenEndpoint(form, origin) {
    const clientId = form.client_id;
    const client = local.clientsById.get(clientId);
    if (!client) return json(400, { error: 'invalid_client' }, origin);
    if (form.grant_type === 'authorization_code') {
      const saved = codes.get(form.code);
      codes.delete(form.code);
      if (!saved || saved.expiresAt < Date.now() || saved.clientId !== clientId) return json(400, { error: 'invalid_grant' }, origin);
      if (saved.redirectUri !== form.redirect_uri) return json(400, { error: 'invalid_grant' }, origin);
      if (saved.challenge) {
        const verifier = String(form.code_verifier ?? '');
        const computed = b64url(createHash('sha256').update(verifier).digest());
        if (!verifier || computed !== saved.challenge) return json(400, { error: 'invalid_grant' }, origin);
      }
      const t = saved.tokens;
      return json(200, { id_token: t.IdToken, access_token: t.AccessToken, refresh_token: t.RefreshToken, expires_in: t.ExpiresIn, token_type: 'Bearer' }, origin);
    }
    if (form.grant_type === 'refresh_token') {
      try {
        const t = await local.refreshTokens({ clientId, refreshToken: form.refresh_token });
        return json(200, { id_token: t.IdToken, access_token: t.AccessToken, expires_in: t.ExpiresIn, token_type: 'Bearer' }, origin);
      } catch {
        return json(400, { error: 'invalid_grant' }, origin);
      }
    }
    return json(400, { error: 'unsupported_grant_type' }, origin);
  }

  function logout(url, cookies) {
    const clientId = url.searchParams.get('client_id');
    const client = local.clientsById.get(clientId);
    const logoutUri = url.searchParams.get('logout_uri');
    if (!client) return errorPage('Client inválido', `O client_id ${clientId ?? '(vazio)'} não existe.`);
    if (!logoutUri || !(client.props.LogoutURLs ?? []).includes(logoutUri)) {
      return errorPage('Endereço de saída inválido', `${logoutUri ?? '(vazio)'} não está nos logouts do client.`);
    }
    if (cookies[COOKIE]) sessions.delete(cookies[COOKIE]);
    return redirect(logoutUri, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
  }

  async function userInfo(headers, origin) {
    const access = String(headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    try {
      const res = await viaProxy('GetUser', { AccessToken: access });
      const attrs = Object.fromEntries((res.UserAttributes ?? []).map((a) => [a.Name, a.Value]));
      return json(200, { ...attrs, username: res.Username }, origin);
    } catch {
      return json(401, { error: 'invalid_token' }, origin);
    }
  }

  function staticFile(path) {
    if (path === '/static/login.css') return { status: 200, headers: { 'Content-Type': 'text/css; charset=utf-8' }, body: CSS };
    if (path === '/static/tokens.css') {
      if (!existsSync(PATHS.appTokensCss)) return { status: 404, headers: {}, body: '' };
      return { status: 200, headers: { 'Content-Type': 'text/css; charset=utf-8' }, body: readFileSync(PATHS.appTokensCss) };
    }
    if (path === '/favicon.svg') {
      return { status: 200, headers: { 'Content-Type': 'image/svg+xml' }, body: readFileSync(join(PATHS.appPublic, 'favicon.svg')) };
    }
    const font = /^\/fonts\/([\w.-]+\.woff2)$/.exec(path);
    if (font) {
      const file = join(PATHS.appPublic, 'fonts', basename(font[1]));
      if (existsSync(file)) return { status: 200, headers: { 'Content-Type': 'font/woff2', 'Cache-Control': 'max-age=3600' }, body: readFileSync(file) };
    }
    return null;
  }

  /**
   * @param {{method: string, url: URL, headers: object, form: object}} req
   */
  async function handle({ method, url, headers, form }) {
    const cookies = parseCookies(headers.cookie);
    const origin = headers.origin;
    const path = url.pathname;
    try {
      if (method === 'OPTIONS') {
        return {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': origin ?? '*',
            'Access-Control-Allow-Methods': 'GET,POST',
            'Access-Control-Allow-Headers': headers['access-control-request-headers'] ?? 'Content-Type,Authorization',
            'Access-Control-Max-Age': '3600',
          },
          body: '',
        };
      }
      if (method === 'GET') {
        // /login sem transacao e o mesmo que /oauth2/authorize (como no Cognito)
        if (path === '/oauth2/authorize' || (path === '/login' && !url.searchParams.get('tx'))) return await authorize(url, cookies);
        if (path === '/login' || path === '/signup' || path === '/google' || path === '/forgot') {
          const txId = url.searchParams.get('tx');
          const tx = getTx(txId);
          if (!tx) return errorPage('Sessão de login vencida', 'Volte ao app e toque em Entrar de novo.');
          if (path === '/signup') return signupPage(txId);
          if (path === '/forgot') return forgotPage(txId);
          if (path === '/google') return googlePage(txId);
          return loginPage(txId, tx);
        }
        if (path === '/logout') return logout(url, cookies);
        if (path === '/oauth2/userInfo') return await userInfo(headers, origin);
        if (path === '/caixa') return inboxPage();
        if (path === '/') return homePage();
        const file = staticFile(path);
        if (file) return file;
      }
      if (method === 'POST') {
        if (path === '/login') return await login(form, cookies);
        if (path === '/signup') return await signup(form);
        if (path === '/confirm') return await confirm(form, cookies);
        if (path === '/google') return await google(form, cookies);
        if (path === '/forgot') return await forgot(form);
        if (path === '/reset') return await reset(form);
        if (path === '/oauth2/token') return await tokenEndpoint(form, origin);
      }
      return html(404, page('Não encontrado', '<h1 class="hui-title">Não encontrado</h1>'));
    } catch (err) {
      log('[login local] erro', err);
      return html(500, page('Erro', `<h1 class="hui-title">Erro</h1>${errorBox('Erro no servidor local. Veja o terminal.')}`));
    }
  }

  return { handle };
}
