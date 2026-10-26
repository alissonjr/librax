# App Android na Play Store (TWA)

O app Android do Librax é só uma casca em volta do site: uma Trusted Web Activity (TWA) que abre
`https://app.<dominio>/` no Chrome do aparelho, em tela cheia, como se fosse um app nativo. O projeto fica
em [`apps/android-twa`](../apps/android-twa/README.md) e está pronto para build; faltam o domínio real e a
chave ("projeto pronto, chave depois").

## Como as atualizações chegam

- **Mudou o site (lições, telas, conteúdo, modelos, correções): nada a fazer no Android.** O app abre o site
  publicado. O service worker baixa a versão nova e o app mostra o mesmo aviso de versão nova do navegador
  (`apps/web-poc/src/lib/appUpdate.ts`). O que já foi baixado (precache e pacote offline) fica no
  armazenamento do Chrome, então o app funciona offline como o PWA.
- **Só a casca pede versão nova na Play Store**, subindo `librax.versionCode`: domínio ou pacote, nome,
  ícone, splash e cores, permissões e notificações, versão do `androidbrowserhelper` e o `targetSdk`.
- **Uma vez por ano, pelo menos:** a Play Store exige `targetSdk` recente para aceitar atualizações. Quando o
  prazo chegar, subir `compileSdk` e `targetSdk` em `app/build.gradle`, gerar e enviar.

## Como o site sabe que está no app

O endereço de abertura leva `?origem=android` (`librax.launchPath`) e o Chrome manda
`android-app://br.com.librax.app/` como referrer. O site (`apps/web-poc/src/lib/twa.ts`) guarda essa marca
só na aba do app (sessionStorage), tira o parâmetro da barra e não grava nem envia nada a mais. Dentro do
app somem a faixa "Instalar o app" do mapa, o convite de instalar e a opção das Configurações; o aviso de
versão nova continua.

## Digital Asset Links (`assetlinks.json`)

O Chrome só tira a barra de endereço quando o site declara que confia no app. A stack do CDK serve
`https://app.<dominio>/.well-known/assetlinks.json` por uma CloudFront Function (`infra/lib/assetlinks.ts`),
com `application/json`, cache de 5 minutos e sem redirecionamento. O arquivo não fica no bucket porque o
upload do app usa `aws s3 sync --delete`.

| Chave de contexto | Padrão | O que é |
|---|---|---|
| `librax:androidPackageName` | `br.com.librax.app` | o mesmo `librax.applicationId` do `gradle.properties` |
| `librax:androidCertFingerprints` | (vazio) | SHA-256 dos certificados, separados por vírgula (ou lista no `cdk.context.json`) |

Sem impressão digital o arquivo sai como `[]` e o synth avisa; o app funciona, mas com a barra de
endereço. Com a assinatura de apps do Google Play (recomendado) entram **duas** impressões: a da chave de
upload (a sua) e a da chave de assinatura do app (a do Google). O synth recusa SHA-1 e valores quebrados.

A CSP e os cabeçalhos do app não mudam: o TWA é o Chrome abrindo o site, com a mesma origem, então a
`Permissions-Policy: camera=(self)` continua liberando a câmera e o resto vale como no navegador.

## Publicar na Play Store

1. **Domínio.** Com o domínio escolhido e a stack publicada (`docs/conta-aws.md`), troque `librax.host`
   em `apps/android-twa/gradle.properties` por `app.<dominio>`. O build de release recusa o placeholder.
2. **Conta de desenvolvedor** no Play Console (taxa única) e o app criado com o pacote
   `br.com.librax.app` (o pacote não muda nunca mais; se for outro, troque nos dois lugares acima).
3. **Chave de upload.** Gere uma vez e guarde fora do repositório, com cópia de segurança:
   ```bash
   keytool -genkeypair -v -keystore ~/chaves/librax-upload.jks -alias upload \
     -keyalg RSA -keysize 4096 -validity 10000
   ```
   Preencha `apps/android-twa/keystore.properties` (modelo no README do projeto; fora do git).
4. **Assinatura de apps do Google Play.** Aceite no primeiro envio: o Google guarda a chave que assina o
   app instalado e você só usa a de upload (se perder a de upload, dá para trocar pelo suporte).
5. **Impressões digitais.** SHA-256 da chave de upload:
   ```bash
   keytool -list -v -keystore ~/chaves/librax-upload.jks -alias upload | grep SHA256
   ```
   e o SHA-256 da chave de assinatura do app no Play Console (Integridade do app > Assinatura de apps; a
   mesma tela mostra um `assetlinks.json` pronto para conferir).
6. **Publicar o assetlinks.** Em `infra/cdk.context.json` (local) ou `infra/cdk.json`:
   ```json
   "librax:androidCertFingerprints": ["<SHA-256 upload>", "<SHA-256 Play>"]
   ```
   `npm run diff` e `npm run deploy` em `infra`. Confira:
   ```bash
   curl -i https://app.<dominio>/.well-known/assetlinks.json
   curl "https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://app.<dominio>&relation=delegate_permission/common.handle_all_urls"
   ```
7. **Gerar o AAB.**
   ```bash
   export JAVA_HOME=~/.local/jdk/jdk-21.0.12.1+1 ANDROID_HOME=~/Android/Sdk
   cd apps/android-twa && ./gradlew bundleRelease
   ```
   Sai em `app/build/outputs/bundle/release/app-release.aab`, assinado com a chave de upload.
8. **Enviar.** Play Console: primeiro no teste interno (instale pelo link e confira que abre sem barra de
   endereço, com a câmera e offline), depois teste fechado e produção. Ficha da loja: ícone
   `apps/android-twa/loja/icone-play-512.png`, imagem de destaque 1024 x 500 e capturas de tela (a fazer).
9. **Próximas versões da casca:** suba `librax.versionCode` (e `librax.versionName`), gere e envie. O site
   segue publicando como sempre, sem tocar no Android.

## Testar no celular

O servidor local já roda em `https://192.168.1.104:4443` com a CA local instalada no celular; o Chrome
confia nela, então o app abre esse endereço igual ao navegador.

```bash
export JAVA_HOME=~/.local/jdk/jdk-21.0.12.1+1 ANDROID_HOME=~/Android/Sdk
cd apps/android-twa
./gradlew assembleDebug -Plibrax.host=192.168.1.104 -Plibrax.port=4443
adb install -r app/build/outputs/apk/debug/app-debug.apk   # cabo USB, ou adb pair/connect pelo Wi-Fi
```

- **Barra de endereço no topo:** esperado. A verificação precisa do domínio real com o `assetlinks.json`;
  sem ela o Chrome abre o app como Custom Tab. Câmera, offline e lições funcionam igual.
- **Para ver sem a barra no teste local:** no Chrome do celular, ative `chrome://flags` > "Enable command
  line on non-rooted devices", rode
  `adb shell "echo '_ --disable-digital-asset-link-verification-for-url=\"https://192.168.1.104:4443\"' > /data/local/tmp/chrome-command-line"`
  e feche e abra o Chrome.
- **No domínio real antes da loja:** o APK de debug é assinado com `~/.android/debug.keystore`. Para testar
  sem barra contra o domínio publicado, acrescente temporariamente o SHA-256 dela a
  `librax:androidCertFingerprints`
  (`keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android`) e tire
  depois.

## Políticas da Play Store

- **Funcionalidade mínima:** apps que só embrulham um site são recusados quando não fazem nada além do
  site. O Librax tem o que pesa a favor: funciona offline (precache e pacote offline), usa a câmera para
  reconhecer os sinais, tem lições, progresso, ofensiva e lembretes. Na ficha e nas capturas, mostre isso.
- **Conteúdo do site é o conteúdo do app:** a revisão vale para o que o site mostra, inclusive depois de
  publicado. Mudança grande de propósito do site precisa caber na ficha da loja.
- **Permissões:** o app declara só notificações (Android 13+ pergunta). A câmera é pedida pelo Chrome, com
  a permissão do Chrome; o app não declara câmera.
- **Política de privacidade e Segurança dos dados:** a ficha pede o link (`https://app.<dominio>/privacidade`)
  e o formulário de dados coletados, que é o do site (conta, progresso, inscrição de push; vídeo da câmera
  não sai do aparelho).
- **Exclusão de conta:** apps com criação de conta precisam oferecer a exclusão no app e por um link na web;
  o app já tem a exclusão nas Configurações (`DELETE /v1/users/me`).
- **Público-alvo:** se a ficha incluir menores de 13 anos, entram as regras do programa Famílias.

## Limites conhecidos

- A primeira abertura precisa de internet (o service worker ainda não baixou nada), como no navegador.
- Sem Chrome (ou com um navegador sem TWA), o app abre numa Custom Tab do navegador padrão, com a barra.
- O tema escuro das barras segue o do aparelho, não o escolhido dentro do app.
