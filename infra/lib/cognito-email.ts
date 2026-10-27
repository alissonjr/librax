import * as cognito from 'aws-cdk-lib/aws-cognito';
import { LibraxConfig } from './config';

/**
 * E-mails do Cognito: por onde saem e o texto padrao.
 *
 * Envio. Com `librax:cognitoEmailSes` ligado, o User Pool manda pelo SES da conta (EmailSendingAccount
 * DEVELOPER) com o remetente do dominio verificado; desligado, fica o envio padrao do Cognito
 * (remetente no-reply do verificationemail.com, 50 e-mails por dia), sem EmailConfiguration no
 * template. Trocar entre os dois e uma atualizacao do User Pool no lugar (EmailConfiguration e
 * "No interruption" no CloudFormation): nada e recriado e as contas continuam.
 *
 * Permissao. No modo DEVELOPER o proprio Cognito cria o papel vinculado ao servico
 * AWSServiceRoleForAmazonCognitoIdpEmailService (ses:SendEmail e ses:SendRawEmail) com as credenciais
 * de quem aplica a mudanca, no caso o papel de execucao do CloudFormation do bootstrap do CDK, que
 * tem iam:CreateServiceLinkedRole. Por isso a stack nao cria papel nem politica para isso.
 *
 * Texto. O gatilho Custom Message (services/api/src/handlers/customMessage.js, Lambda
 * librax-custom-message) troca o texto do codigo de cadastro, do reenvio e da nova senha por e-mails em
 * HTML com a identidade do Librax, em pt-BR, en ou es: o idioma vem do clientMetadata que o app manda
 * (`lang`) ou do atributo padrao `locale` gravado no cadastro. Atributo padrao, nao `custom:`: nada muda
 * no Schema do User Pool, e o gatilho entra no LambdaConfig, que e "No interruption" no CloudFormation.
 * O gatilho funciona com os dois envios (padrao do Cognito ou SES), que continuam independentes do texto.
 *
 * Os campos abaixo ficam como texto padrao, em portugues: valem se o gatilho falhar (ele devolve o
 * evento sem mudanca) e para mensagens que o gatilho nao trata.
 */

/** Texto padrao do codigo (cadastro e nova senha), sem HTML: fallback do gatilho Custom Message. */
export const COGNITO_CODE_EMAIL = {
  subject: 'Seu código do Librax',
  body:
    'Olá! Seu código do Librax é {####}. ' +
    'Digite esse código no app para confirmar seu e-mail ou criar uma nova senha. ' +
    'Se não foi você que pediu, é só ignorar esta mensagem. Bons estudos em Libras!',
};

/** `email` do User Pool: SES com o dominio verificado, ou undefined (envio padrao do Cognito). */
export function cognitoUserPoolEmail(config: LibraxConfig): cognito.UserPoolEmail | undefined {
  const { ses, from, fromName, replyTo, sesRegion } = config.cognitoEmail;
  if (!ses) return undefined;
  return cognito.UserPoolEmail.withSES({
    fromEmail: from,
    fromName,
    replyTo,
    sesRegion,
    sesVerifiedDomain: from.split('@')[1],
  });
}

/** `userVerification` do User Pool: codigo (nao link) com o texto padrao em portugues. */
export const COGNITO_USER_VERIFICATION: cognito.UserVerificationConfig = {
  emailStyle: cognito.VerificationEmailStyle.CODE,
  emailSubject: COGNITO_CODE_EMAIL.subject,
  emailBody: COGNITO_CODE_EMAIL.body,
};
