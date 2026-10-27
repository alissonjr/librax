# App Android do Librax (TWA)

Casca Android que abre o site do app (`apps/web-poc`, em `https://app.<dominio>/`) numa Trusted Web
Activity: é o próprio Chrome do aparelho, em tela cheia, sem barra de endereço. O app de verdade
continua sendo o site, com o service worker, o pacote offline, a câmera, a mão 3D e o VLibras. Publicar
o site atualiza o app Android sem passar pela Play Store.

Processo completo (como as atualizações chegam, publicação na Play Store, chave, políticas):
[`docs/android-twa.md`](../../docs/android-twa.md).

## O que tem aqui

```
apps/android-twa/
  gradle.properties        domínio, pacote, nome e versão (tudo trocável com -P)
  build.gradle             plugin do Android (AGP 8.13.0)
  settings.gradle
  gradlew, gradle/wrapper  Gradle 8.14.3
  app/build.gradle         lê o gradle.properties e monta os textos do manifesto; assinatura opcional
  app/src/main/AndroidManifest.xml
                           estrutura do modelo do Bubblewrap: LauncherActivity, splash, Custom Tab
                           como alternativa, retrato, notificações delegadas, links do domínio
  app/src/main/java/br/com/librax/app/LauncherActivity.java
                           retrato na abertura e ?origem=android também nos links que abrem o app
  app/src/main/res/        ícones, splash e cores (gerados, ver abaixo) e xml/filepaths.xml
  loja/icone-play-512.png  ícone da página da Play Store
  loja/imagem-destaque-1024x500.png, loja/capturas/
                           imagem de destaque e capturas de tela (1080 x 1920) da ficha
  loja/ficha-play.md       textos da ficha (pt-BR, en, es), Segurança dos dados e classificação
  scripts/gerar-recursos.mjs
```

Biblioteca: `com.google.androidbrowserhelper:androidbrowserhelper:2.7.3`, versão fixa (pede minSdk 23,
Android 6). `compileSdk` e `targetSdk` 36.

## Configuração (`gradle.properties`)

| Propriedade | Padrão | Para que serve |
|---|---|---|
| `librax.applicationId` | `br.com.librax.app` | id na Play Store; nunca muda depois da primeira publicação. Igual a `librax:androidPackageName` do CDK |
| `librax.host` | `app.librax.online` | domínio do app. O build de release recusa o placeholder `librax.example` |
| `librax.port` | (vazio) | só para teste local (ex.: `4443`) |
| `librax.launchPath` | `/?origem=android` | endereço de abertura; o `origem=android` faz o site esconder o convite de instalar |
| `librax.appName` | `Librax` | nome embaixo do ícone |
| `librax.versionCode` / `librax.versionName` | `1` / `1.0.0` | sobe a cada envio para a Play Store |
| `librax.enableNotifications` | `true` | lembretes do site aparecem como notificações do app (Android 13+ pede permissão) |

Tudo pode ser passado na hora, sem editar: `./gradlew assembleDebug -Plibrax.host=192.168.1.104 -Plibrax.port=4443`.

Cores e ícones saem da marca e dos tokens do app web (`apps/web-poc/src/styles/tokens.ts`): barra de
status e de navegação em `theme.light.bg.canvas` (e `theme.dark.bg.canvas` com o aparelho no escuro),
abertura e fundo do ícone em `brand.icon.bg`. O ícone do app é a mão 3D fazendo joinha (seção 2.6 do
`docs/design-system.md`): os PNG por densidade (ícone adaptativo com frente, fundo e silhueta monocromática,
mais os antigos quadrado e redondo) e `loja/icone-play-512.png` saem do `tools/pwa/build-icons.mjs`, junto
com os ícones do PWA. A abertura, a notificação, as cores e a ligação do ícone adaptativo saem do
`scripts/gerar-recursos.mjs`. Para gerar de novo depois de mudar a marca:

```bash
cd apps/web-poc && npm install --no-save sharp && npm run pwa-icons   # ícone do app (PWA e Android)
cd ../android-twa && node scripts/gerar-recursos.mjs                   # abertura, notificação e cores
```

## Build

Precisa de JDK 17 ou mais novo e do Android SDK (plataforma 36). Nesta máquina:

```bash
export JAVA_HOME=~/.local/jdk/jdk-21.0.12.1+1
export ANDROID_HOME=~/Android/Sdk
cd apps/android-twa
./gradlew assembleDebug     # app/build/outputs/apk/debug/app-debug.apk
```

O debug é assinado com a chave de debug do Android (`~/.android/debug.keystore`), criada pelas
ferramentas e que nunca vai para o git.

Release (AAB para a Play Store) com a chave de upload. Crie `apps/android-twa/keystore.properties` (fora
do git):

```properties
storeFile=/home/alisson/chaves/librax-upload.jks
storePassword=...
keyAlias=upload
keyPassword=...
```

e rode `./gradlew bundleRelease` (domínio do `gradle.properties`; sai em `app/build/outputs/bundle/release/`).
Sem o `keystore.properties` o AAB sai sem assinatura. Guarde o `.jks` fora do repositório, com cópia de
segurança (caminho relativo em `storeFile` parte desta pasta).

## Teste no celular

```bash
./gradlew assembleDebug -Plibrax.host=192.168.1.104 -Plibrax.port=4443
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

O app abre o site do servidor local (o mesmo de `https://192.168.1.104:4443`, com a CA local já instalada
no celular). Sem o domínio real a verificação não passa e o Chrome mostra uma barra fina com o endereço no
topo: é esperado e não atrapalha o teste. Detalhes e como esconder a barra no teste:
[`docs/android-twa.md`](../../docs/android-twa.md#testar-no-celular).
