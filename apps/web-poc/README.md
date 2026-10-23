# Librax web-poc

App do Librax que roda no navegador do celular (Safari no iPhone, Chrome no Android). React 18, Vite 5 e TypeScript. O plano está em `docs/plano-mobile-web.md`; o reconhecimento, em `docs/spec-01-reconhecimento.md`.

## Comandos

```bash
npm ci                 # instala (uma vez)
npm run dev            # app em http://localhost:5173
npm run dev:celular    # HTTPS na rede local, para abrir no celular (ver abaixo)
npx vitest run         # testes
npx tsc --noEmit -p .  # tipos
npm run build          # build de produção em dist/
```

`dev`, `dev:celular` e `build` rodam antes o `npm run ml:assets`, que prepara `public/ml/<versão>/`:

- copia o WASM do `@mediapipe/tasks-vision` (versão fixada sem `^` no `package.json`);
- baixa o modelo `hand_landmarker.task` **uma única vez** para `.cache/ml/`, confere o SHA-256 e copia. Depois disso funciona sem internet.

Nada de ML vem de CDN em tempo de execução. As duas pastas são geradas e ficam fora do git.

## Página de teste da câmera (fase W0)

`/teste-camera.html` é uma página isolada que abre a câmera frontal, roda o HandLandmarker a até 15 fps e desenha o esqueleto da mão. Mostra ao vivo: fps de detecção, ms por detecção (p50 e p95), delegate (GPU ou CPU, com botão para alternar), resolução da câmera, tempo de carga a frio e a quente (WASM, modelo, init e primeira detecção), memória (quando o navegador expõe), navegador resumido e se o Wake Lock foi obtido. Tem um teste de 10 minutos com o fps de cada minuto e a queda em relação ao primeiro. O botão **Copiar resultado** copia um resumo em texto para colar na conversa.

### Como abrir no celular

A câmera só abre em HTTPS, por isso existe o modo celular.

1. Computador e celular no **mesmo Wi-Fi**.
2. No computador, em `apps/web-poc`: `npm run dev:celular`.
3. O terminal mostra uma linha assim: `-> https://192.168.0.12:5174/teste-camera.html`. Digite esse endereço no navegador do celular (Safari no iPhone, Chrome no Android). Se aparecer mais de um, use o que começa com `192.168.` ou `10.`.
4. Aceite o aviso de certificado (é um certificado gerado na hora pelo próprio computador, por isso o navegador não o conhece):
   - **iPhone (Safari):** aparece "Esta conexão não é privada". Toque em **Mostrar Detalhes**, depois em **visitar este site** e confirme em **Visitar Site**.
   - **Android (Chrome):** aparece "Sua conexão não é particular". Toque em **Avançado** e depois em **Ir para 192.168.x.x (não seguro)**.
5. Toque em **Abrir câmera** e permita o acesso. No iPhone, se o Safari perguntar de novo a cada vez, em Ajustes > Safari > Câmera escolha "Permitir".
6. Faça o teste: mostre a mão por alguns segundos, toque em **Usar CPU** e volte para GPU, toque em **Medir a quente**, rode o **Teste de 10 minutos** com o celular parado e a tela ligada e no fim toque em **Copiar resultado** e cole na conversa.

Se a página não abrir: confira se o computador não está numa rede de convidados (que isola os aparelhos) e se o firewall libera a porta 5174.

### Se o certificado travar a câmera: túnel

Alguns aparelhos não liberam a câmera (ou o service worker) com o certificado aceito à mão. A alternativa é um túnel HTTPS com certificado válido:

```bash
npm run dev:celular                                            # terminal 1
cloudflared tunnel --url https://localhost:5174 --no-tls-verify   # terminal 2
```

O `cloudflared` mostra um endereço `https://<nome>.trycloudflare.com`; abra `https://<nome>.trycloudflare.com/teste-camera.html` no celular (funciona até no 4G). O endereço já está liberado no `vite.config.ts` (`allowedHosts`). `ngrok http https://localhost:5174` também serve (domínios `.ngrok-free.app`).

Atenção: o túnel deixa o servidor de desenvolvimento acessível pela internet enquanto estiver ligado, para quem tiver o endereço. Use só durante o teste e feche os dois terminais no fim.

## Coleta de letras (dataset da W1)

`/coleta.html` abre do mesmo jeito (no modo celular o terminal mostra o endereço). A pessoa lê o termo, informa um código (não o nome), escolhe a letra e grava 3 s. Só os 21 pontos da mão vão para o IndexedDB do aparelho, nunca imagem. **Exportar arquivo** entrega um `.jsonl` pela folha de compartilhar do celular (ou baixa). Para treinar: `python ml-training/train_static.py coleta.jsonl --out out/` e copie `out/model.json` e `out/weights.bin` para `public/ml/classifier/`. Com esses arquivos o app passa a usar o MLP; sem eles, o reconhecedor heurístico.

## Arquivos de ML em produção

- Caminhos: `/ml/<versão>/wasm/` e `/ml/<versão>/hand_landmarker.task` (`src/recognition/mlAssets.ts`); classificador treinado em `/ml/classifier/model.json` + `weights.bin`.
- O `.wasm` precisa ir com `Content-Type: application/wasm` (no dev e no `vite preview` isso é garantido pelo `vite.config.ts`; no S3/CloudFront, definir no upload). Como a versão está na URL, `/ml/<versão>/` pode ter `Cache-Control: immutable` e ir pré-comprimido em brotli.
- Service worker (Workbox): `/ml/<versão>/` fica em cache em tempo de execução (CacheFirst), sem precache, porque os arquivos passam do limite de 2 MB. `/ml/classifier/` usa StaleWhileRevalidate porque a URL não tem versão.
