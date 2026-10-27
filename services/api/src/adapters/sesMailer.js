/**
 * Envio de e-mail pelo SES (API v2), em HTML e texto na mesma mensagem (multipart/alternative): o
 * cliente mostra o HTML e quem le so texto recebe a versao em texto.
 *
 * `from` pode ter nome ("Librax <nao-responda@librax.online>"). O cliente do SDK e criado na primeira
 * mensagem e reaproveitado. `client` so e passado nos testes.
 */
export function makeSesMailer({ from, client = null }) {
  if (!from) throw new Error('remetente obrigatorio');
  let ses = client;
  return {
    async send({ to, subject, html, text }) {
      const { SendEmailCommand, SESv2Client } = await import('@aws-sdk/client-sesv2');
      ses ??= new SESv2Client({});
      await ses.send(
        new SendEmailCommand({
          FromEmailAddress: from,
          Destination: { ToAddresses: [to] },
          Content: {
            Simple: {
              Subject: { Data: subject, Charset: 'UTF-8' },
              Body: {
                Html: { Data: html, Charset: 'UTF-8' },
                Text: { Data: text, Charset: 'UTF-8' },
              },
            },
          },
        }),
      );
    },
  };
}

/** "Librax <endereco>" quando o endereco vem sem nome. */
export function withSenderName(address, name = 'Librax') {
  return /</.test(address) ? address : `${name} <${address}>`;
}
