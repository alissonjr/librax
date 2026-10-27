/**
 * Gatilho Custom Message do Cognito: os e-mails de codigo com a identidade do Librax, em HTML, no
 * idioma da pessoa. O Cognito manda uma parte so (HTML); a versao em texto do render.js serve para
 * as previas e para quem quiser o texto puro, e o HTML ja le bem sem imagens.
 *
 *   CustomMessage_SignUp          codigo do cadastro
 *   CustomMessage_ResendCode      o mesmo codigo, pedido de novo
 *   CustomMessage_ForgotPassword  codigo de nova senha
 *
 * Outros gatilhos (AdminCreateUser, troca de atributo, autenticacao) nao sao usados pelo app: o evento
 * volta sem mudanca e o Cognito usa o texto padrao do User Pool (portugues, lib/cognito-email.ts).
 *
 * Contrato: o codigo nunca passa por aqui; o Cognito manda o marcador em `event.request.codeParameter`
 * ("{####}") e troca pelo codigo depois. A mensagem precisa conter esse marcador, tem ate 20 mil
 * caracteres e o assunto ate 140. Vale com o envio padrao do Cognito e com o SES (o envio e outra
 * configuracao do User Pool).
 *
 * Idioma: `clientMetadata.lang` que o app manda no signUp, no resendSignUpCode e no resetPassword (o
 * idioma da tela naquele momento); sem ele, o atributo padrao `locale` gravado no cadastro; sem os
 * dois, pt-BR. Qualquer erro aqui devolve o evento sem mudanca: o e-mail sai com o texto padrao, mas
 * sai (um gatilho que falha impediria o cadastro).
 */

import { renderEmail } from '../email/render.js';

const KINDS = {
  CustomMessage_SignUp: 'signupCode',
  CustomMessage_ResendCode: 'signupCode',
  CustomMessage_ForgotPassword: 'resetCode',
};

export const COGNITO_MESSAGE_MAX = 20000;

export function makeCustomMessageHandler({ appUrl, log = console.warn }) {
  async function handler(event) {
    const kind = KINDS[event?.triggerSource];
    const req = event?.request ?? {};
    const code = req.codeParameter;
    if (!kind || typeof code !== 'string' || !code) return event;
    try {
      const attrs = req.userAttributes ?? {};
      const email = renderEmail(kind, {
        lang: req.clientMetadata?.lang ?? attrs.locale,
        appUrl,
        code,
        name: attrs.given_name,
      });
      if (!email.html.includes(code) || email.html.length > COGNITO_MESSAGE_MAX) throw new Error('mensagem fora do contrato');
      event.response = { ...event.response, emailSubject: email.subject, emailMessage: email.html };
    } catch (err) {
      log('[custom-message] texto padrao do Cognito', { triggerSource: event.triggerSource, message: err.message });
    }
    return event;
  }
  return { handler };
}

export const { handler } = makeCustomMessageHandler({ appUrl: process.env.APP_URL });
