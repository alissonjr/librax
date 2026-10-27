/**
 * Textos dos e-mails do Librax por idioma (pt-BR, en, es), o mesmo trio do app.
 *
 * Regras de escrita (docs/design-system.md 2.5 e regras do dono): falar com "voce", frases curtas,
 * sem travessao nem meia-risca, sem emoji. `{chave}` e trocado pelo valor ja escapado (render.js).
 */

export const STRINGS = {
  'pt-BR': {
    common: {
      hello: 'Olá!',
      helloName: 'Olá, {name}!',
      tagline: 'Librax: aprenda Libras jogando, no seu ritmo.',
      privacy: 'Política de Privacidade',
      terms: 'Termos de Uso',
      automatic: 'Este e-mail é automático. Não precisa responder.',
      openApp: 'Abrir o Librax',
    },
    signupCode: {
      subject: 'Confirme seu e-mail no Librax',
      preheader: 'Seu código de confirmação chegou. Ele vale por 24 horas.',
      title: 'Confirme seu e-mail',
      intro: 'Digite este código no app para ativar sua conta e guardar seu progresso.',
      codeLabel: 'Seu código',
      expiry: 'O código vale por 24 horas.',
      notYou: 'Não criou uma conta no Librax? É só ignorar este e-mail. Sem o código, nada é ativado.',
    },
    resetCode: {
      subject: 'Código para criar uma nova senha no Librax',
      preheader: 'Use este código para criar uma nova senha. Ele vale por 1 hora.',
      title: 'Crie uma nova senha',
      intro: 'Recebemos um pedido para trocar a senha da sua conta. Digite este código no app, na tela de nova senha.',
      codeLabel: 'Seu código',
      expiry: 'O código vale por 1 hora.',
      notYouTitle: 'Não foi você?',
      notYou:
        'Ignore este e-mail: sua senha continua a mesma e ninguém entra sem este código. ' +
        'Se estes e-mails continuarem chegando sem você pedir, crie uma nova senha no app para proteger sua conta.',
    },
    reminder: {
      preheader: 'Uma lição curta hoje mantém sua sequência viva.',
      streakLabel: 'Sua sequência',
      days: { one: '{n} dia', other: '{n} dias' },
      button: 'Fazer uma lição',
      why: 'Você recebe este lembrete porque ligou o lembrete por e-mail no app.',
      stop: 'Para parar, desligue em Configurações:',
    },
    newDevice: {
      subject: 'Novo acesso à sua conta do Librax',
      preheader: 'Sua conta foi acessada em um aparelho novo. Confira se foi você.',
      title: 'Novo acesso à sua conta',
      intro: 'Sua conta do Librax foi acessada em um aparelho ou navegador que ainda não tínhamos visto.',
      device: 'Aparelho',
      browser: 'Navegador',
      when: 'Quando',
      country: 'País aproximado',
      itWasYou: 'Foi você? Então está tudo certo. Não precisa fazer nada.',
      notYouTitle: 'Não foi você?',
      notYou:
        'Crie uma nova senha agora: no app, toque em Entrar e depois em "Esqueci a senha". ' +
        'Se você entra com o Google, revise também a segurança da sua conta Google.',
      button: 'Abrir o Librax',
      why: 'Enviamos este aviso para proteger sua conta. O Librax não guarda o seu endereço IP.',
      kinds: { mobile: 'Celular', tablet: 'Tablet', desktop: 'Computador', unknown: 'Aparelho' },
      otherBrowser: 'Outro navegador',
      otherOs: 'outro sistema',
    },
  },

  en: {
    common: {
      hello: 'Hi!',
      helloName: 'Hi {name}!',
      tagline: 'Librax: learn Brazilian Sign Language (Libras) by playing, at your own pace.',
      privacy: 'Privacy Policy',
      terms: 'Terms of Use',
      automatic: 'This is an automatic e-mail. No need to reply.',
      openApp: 'Open Librax',
    },
    signupCode: {
      subject: 'Confirm your e-mail on Librax',
      preheader: 'Here is your confirmation code. It is valid for 24 hours.',
      title: 'Confirm your e-mail',
      intro: 'Enter this code in the app to activate your account and keep your progress.',
      codeLabel: 'Your code',
      expiry: 'The code is valid for 24 hours.',
      notYou: 'Did not create a Librax account? Just ignore this e-mail. Nothing is activated without the code.',
    },
    resetCode: {
      subject: 'Your code to create a new Librax password',
      preheader: 'Use this code to create a new password. It is valid for 1 hour.',
      title: 'Create a new password',
      intro: 'We received a request to change the password of your account. Enter this code in the app, on the new password screen.',
      codeLabel: 'Your code',
      expiry: 'The code is valid for 1 hour.',
      notYouTitle: 'Was it not you?',
      notYou:
        'Ignore this e-mail: your password stays the same and nobody gets in without this code. ' +
        'If these e-mails keep arriving without you asking, create a new password in the app to protect your account.',
    },
    reminder: {
      preheader: 'A short lesson today keeps your streak alive.',
      streakLabel: 'Your streak',
      days: { one: '{n} day', other: '{n} days' },
      button: 'Do a lesson',
      why: 'You get this reminder because you turned on e-mail reminders in the app.',
      stop: 'To stop them, turn them off in Settings:',
    },
    newDevice: {
      subject: 'New sign-in to your Librax account',
      preheader: 'Your account was accessed on a new device. Check that it was you.',
      title: 'New sign-in to your account',
      intro: 'Your Librax account was accessed on a device or browser we had not seen before.',
      device: 'Device',
      browser: 'Browser',
      when: 'When',
      country: 'Approximate country',
      itWasYou: 'Was it you? Then all is well. You do not need to do anything.',
      notYouTitle: 'Was it not you?',
      notYou:
        'Create a new password now: in the app, tap Sign in and then "Forgot password". ' +
        'If you sign in with Google, also review the security of your Google account.',
      button: 'Open Librax',
      why: 'We send this notice to protect your account. Librax does not store your IP address.',
      kinds: { mobile: 'Phone', tablet: 'Tablet', desktop: 'Computer', unknown: 'Device' },
      otherBrowser: 'Other browser',
      otherOs: 'other system',
    },
  },

  es: {
    common: {
      hello: '¡Hola!',
      helloName: '¡Hola, {name}!',
      tagline: 'Librax: aprende Libras (lengua de señas brasileña) jugando, a tu ritmo.',
      privacy: 'Política de Privacidad',
      terms: 'Términos de Uso',
      automatic: 'Este correo es automático. No hace falta responder.',
      openApp: 'Abrir Librax',
    },
    signupCode: {
      subject: 'Confirma tu correo en Librax',
      preheader: 'Aquí está tu código de confirmación. Vale por 24 horas.',
      title: 'Confirma tu correo',
      intro: 'Escribe este código en la app para activar tu cuenta y guardar tu progreso.',
      codeLabel: 'Tu código',
      expiry: 'El código vale por 24 horas.',
      notYou: '¿No creaste una cuenta en Librax? Solo ignora este correo. Sin el código, no se activa nada.',
    },
    resetCode: {
      subject: 'Código para crear una nueva contraseña en Librax',
      preheader: 'Usa este código para crear una nueva contraseña. Vale por 1 hora.',
      title: 'Crea una nueva contraseña',
      intro: 'Recibimos una solicitud para cambiar la contraseña de tu cuenta. Escribe este código en la app, en la pantalla de nueva contraseña.',
      codeLabel: 'Tu código',
      expiry: 'El código vale por 1 hora.',
      notYouTitle: '¿No fuiste tú?',
      notYou:
        'Ignora este correo: tu contraseña sigue igual y nadie entra sin este código. ' +
        'Si estos correos siguen llegando sin que los pidas, crea una nueva contraseña en la app para proteger tu cuenta.',
    },
    reminder: {
      preheader: 'Una lección corta hoy mantiene viva tu racha.',
      streakLabel: 'Tu racha',
      days: { one: '{n} día', other: '{n} días' },
      button: 'Hacer una lección',
      why: 'Recibes este recordatorio porque activaste el recordatorio por correo en la app.',
      stop: 'Para dejar de recibirlo, desactívalo en Configuración:',
    },
    newDevice: {
      subject: 'Nuevo acceso a tu cuenta de Librax',
      preheader: 'Tu cuenta se abrió en un dispositivo nuevo. Comprueba que fuiste tú.',
      title: 'Nuevo acceso a tu cuenta',
      intro: 'Tu cuenta de Librax se abrió en un dispositivo o navegador que no habíamos visto antes.',
      device: 'Dispositivo',
      browser: 'Navegador',
      when: 'Cuándo',
      country: 'País aproximado',
      itWasYou: '¿Fuiste tú? Entonces todo está bien. No tienes que hacer nada.',
      notYouTitle: '¿No fuiste tú?',
      notYou:
        'Crea una nueva contraseña ahora: en la app, toca Entrar y luego "Olvidé mi contraseña". ' +
        'Si entras con Google, revisa también la seguridad de tu cuenta de Google.',
      button: 'Abrir Librax',
      why: 'Enviamos este aviso para proteger tu cuenta. Librax no guarda tu dirección IP.',
      kinds: { mobile: 'Celular', tablet: 'Tableta', desktop: 'Computadora', unknown: 'Dispositivo' },
      otherBrowser: 'Otro navegador',
      otherOs: 'otro sistema',
    },
  },
};
