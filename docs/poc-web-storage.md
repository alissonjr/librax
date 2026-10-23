# PoC Web - Estudo de armazenamento offline no navegador

**Objetivo:** rodar o Librax 100% no navegador, sem nenhuma chamada de API,
usando somente as APIs de armazenamento do browser.

Este documento e um estudo tecnico, nao um plano de implementacao.
Ele deve responder: o que pode ser armazenado onde, quais APIs usar,
quais sao os limites reais, e qual abordagem e mais rapida para a PoC.

---

## 1. Inventario de dados do jogo

Antes de decidir onde armazenar, e preciso saber o que armazenar.
A tabela abaixo mapeia cada categoria de dado do jogo ao seu equivalente
no backend atual (DynamoDB/S3/SQLite local) e ao volume estimado.

| Dado | Backend atual | Volume estimado | Volatil? |
|---|---|---|---|
| Identidade do usuario (userId, nome) | Cognito + DynamoDB | < 1 KB | Nao |
| Perfil de progresso (xpTotal, streak, lastActiveDay, freezes, etc.) | DynamoDB | < 2 KB | Frequente |
| Progresso por licao (status, bestScore, completedAt) | DynamoDB | ~200 B x N licoes | A cada licao |
| Itens SRS por sinal (ef, interval, reps, dueAt) | DynamoDB | ~300 B x N sinais | A cada revisao |
| Log de XP diario (xp por dia) | DynamoDB | ~100 B x N dias | Diario |
| Conquistas ganhas (set de codigos) | DynamoDB | < 1 KB | Raro |
| Flags de UI (telas ja vistas, etc.) | SQLite local | < 1 KB | Raro |
| Bundle de conteudo - JSON (signs.json, course.json) | S3/CloudFront | 50-200 KB (U1) | Nunca (por versao) |
| Videos de referencia dos sinais | S3/CloudFront | 2-5 MB por sinal (U1: ~130 MB total) | Nunca (por versao) |
| Modelo de reconhecimento (.task / .tflite) | S3/CloudFront | ~5 MB (MediaPipe) | Nunca (por versao) |
| Dados de squads e ligas (multijogador) | DynamoDB (server-side) | N/A | N/A |

**Conclusao do inventario:** o "estado do jogo" por usuario (tudo acima da linha de videos)
e pequeno - menos de 100 KB. Videos e modelo somam ate ~140 MB para a U1 completa.
Armazenar o estado do jogo no navegador e trivial. O desafio e videos + modelo.

---

## 2. APIs de armazenamento disponíveis no navegador

### 2.1 localStorage

- Capacidade: 5 MB por origem (limite rigido, nao negociavel).
- API: sincrona (`localStorage.setItem`, `getItem`).
- Formato: so strings (precisa de `JSON.stringify`/`JSON.parse`).
- Persistencia: nao e eviccionado automaticamente (dura ate o usuario limpar).
- Cross-tab: compartilhado entre abas do mesmo dominio.

Ideal para: configuracoes simples, flags de UI, userId, preferencias.
Nao usar para: qualquer colecao que cresca com o uso (itens SRS, progresso).

### 2.2 IndexedDB

- Capacidade: varia por navegador e dispositivo:
  - Chrome: 60% do espaco livre em disco (tipicamente varios GB).
  - Firefox: 10% do espaco livre em disco.
  - Safari 15.2+: 1 GB por default; pode ser solicitado mais via `StorageManager`.
- API: assincrona e baseada em eventos (wrapper `idb` da Google torna isso Promise-based).
- Formato: objetos JavaScript estruturados (inclui ArrayBuffer, Blob, Date).
- Persistencia: pode ser eviccionado em dispositivos com pouco espaco. Chamar
  `navigator.storage.persist()` solicita ao navegador para nunca eviccionar.
- Estrutura: banco de dados com "object stores" (tabelas) e indices.
- Transacional: operacoes sao atomicas dentro de uma transacao.

Ideal para: todo o estado de progresso do jogo (perfil, SRS, progresso de licao,
log de XP, conquistas).

### 2.3 Cache API

- Capacidade: mesmo pool que o IndexedDB (mesma quota por origem).
- API: assincrona, orientada a pares `Request`/`Response`.
- Formato: respostas HTTP completas (headers + body). Body pode ser qualquer coisa.
- Persistencia: idem IndexedDB (evicionavel). Responde ao mesmo `navigator.storage.persist()`.
- Controlada pelo Service Worker: o SW intercepta fetches e pode servir da Cache API.

Ideal para: videos de referencia, o bundle JSON de conteudo (course.json, signs.json),
o modelo de reconhecimento, e qualquer asset estatico grande.

### 2.4 Session Storage

Igual ao localStorage mas apagado quando a aba fecha.
Util apenas para estado de sessao temporario (ex: exercicio em andamento).
Nao relevante para persistencia de progresso.

### 2.5 OPFS - Origin Private File System

API mais nova (Chrome 102+, Firefox 111+, Safari 15.2+) para acesso a arquivos
reais no dispositivo. Mais rapido que IndexedDB para leitura sequencial de arquivos
grandes. E a API que o `sqlite3.wasm` usa internamente em producao.
Para a PoC, nao e necessario usar diretamente - o driver wasm do SQLite ja abstrai isso.

### 2.6 Storage API (quota e persistencia)

```javascript
// Verificar espaco disponivel antes de cachear videos
const estimate = await navigator.storage.estimate();
// { quota: 10737418240, usage: 52428800 }

// Solicitar persistencia (nao eviccionavel)
const persisted = await navigator.storage.persist();
// true: navegador prometeu nao eviccionar; false: sem garantia
```

Chamar `navigator.storage.persist()` no primeiro acesso do usuario e boa pratica.
Em Chrome, a resposta e `true` automaticamente se o usuario instalou o PWA ou
concedeu permissao de notificacao. Em Firefox, mostra um prompt.

---

## 3. Mapa de decisoes: o que vai onde

| Dado | Armazenamento na PoC | Justificativa |
|---|---|---|
| userId (UUID gerado na primeira visita) | `localStorage` | Simples, nunca cresce, acesso sincrono |
| displayName, dailyGoalXp, timezone | `localStorage` | Idem |
| Perfil completo (xp, streak, flags) | `IndexedDB` | Mutavel a cada licao; precisa de atomicidade |
| Progresso por licao | `IndexedDB` | Colecao que cresce; precisa de query por lessonId |
| Itens SRS | `IndexedDB` | Colecao que cresce; precisa de query por dueAt e signId |
| Log de XP diario | `IndexedDB` | Colecao que cresce (um registro por dia estudado) |
| Conquistas ganhas | `IndexedDB` junto ao perfil | Pequena, mas precisa de update incremental |
| Flags de UI (telas vistas) | `localStorage` | Cada flag e um unico booleano/string |
| Bundle JSON (course.json, signs.json) | `Cache API` + `Service Worker` | Carregado uma vez, nunca muda (por versao) |
| Videos dos sinais | `Cache API` | Binarios grandes; request/response semantics natural |
| Modelo MediaPipe (.task) | `Cache API` | Binario grande, imutavel |
| Squads e ligas | **Nao armazenar na PoC** | Requerem dados de outros usuarios; fora do escopo |

---

## 4. Schema do IndexedDB para o Librax PoC

Nome do banco: `librax-poc` (versao 1).

```javascript
// Setup do banco (executar uma vez na abertura do app)
import { openDB } from 'idb'; // wrapper Promise do IndexedDB (~1 KB)

const db = await openDB('librax-poc', 1, {
  upgrade(db) {
    // Perfil + conquistas: um documento por usuario
    db.createObjectStore('profiles', { keyPath: 'userId' });

    // Progresso de licao: compound key userId + lessonId
    const progress = db.createObjectStore('lesson_progress', {
      keyPath: ['userId', 'lessonId'],
    });

    // Itens SRS: compound key userId + signId
    // Index por dueAt para montar a fila diaria
    const srs = db.createObjectStore('srs_items', {
      keyPath: ['userId', 'signId'],
    });
    srs.createIndex('byDueAt', ['userId', 'dueAt']);

    // Log de XP diario: compound key userId + day (YYYY-MM-DD)
    db.createObjectStore('day_xp', { keyPath: ['userId', 'day'] });
  },
});
```

### Formato dos registros

```javascript
// profiles
{
  userId: 'usr-uuid-v4',
  displayName: 'Maria',
  xpTotal: 450,
  streak: 7,
  lastActiveDay: '2026-06-28',
  freezes: 1,
  dailyGoalXp: 20,
  lessonsCompleted: 12,
  signsLearned: 26,
  alphabetComplete: true,
  achievements: ['STREAK_7', 'SIGNS_10'], // array, nao Set (IDB nao serializa Set)
}

// lesson_progress
{
  userId: 'usr-uuid-v4',
  lessonId: 'u1-l3',
  status: 'completed',      // 'available' | 'completed'
  bestScore: 0.92,
  completedAt: '2026-06-28',
}

// srs_items
{
  userId: 'usr-uuid-v4',
  signId: 'letra-A',
  ef: 2.5,
  interval: 4,
  reps: 3,
  dueAt: '2026-07-02',
}

// day_xp
{
  userId: 'usr-uuid-v4',
  day: '2026-06-28',
  xp: 30,
}
```

### Adapter IndexedDB (substitui o InMemoryRepo)

O dominio do jogo (`services/api/src/`) ja funciona via porta de repositorio.
O adapter IndexedDB precisa implementar a mesma interface do `InMemoryRepo`:

```javascript
class IdbRepo {
  constructor(db, userId) {
    this.db = db;
    this.userId = userId;
  }

  async getProfile() {
    return this.db.get('profiles', this.userId) ?? null;
  }

  async saveProfile(profile) {
    await this.db.put('profiles', profile);
  }

  async getSrsItem(userId, signId) {
    return this.db.get('srs_items', [userId, signId]) ?? null;
  }

  async saveSrsItem(userId, signId, item) {
    await this.db.put('srs_items', { userId, signId, ...item });
  }

  async listSrsItems(userId) {
    return this.db.getAll('srs_items', IDBKeyRange.bound(
      [userId, ''], [userId, '￿']
    ));
  }

  async getProgress(userId, lessonId) {
    return this.db.get('lesson_progress', [userId, lessonId]) ?? null;
  }

  async saveProgress(userId, lessonId, progress) {
    await this.db.put('lesson_progress', { userId, lessonId, ...progress });
  }

  async getDayXp(userId, day) {
    return (await this.db.get('day_xp', [userId, day]))?.xp ?? 0;
  }

  async addDayXp(userId, day, xp) {
    const current = (await this.db.get('day_xp', [userId, day]))?.xp ?? 0;
    await this.db.put('day_xp', { userId, day, xp: current + xp });
  }

  async hasDayLog(userId, day) {
    return (await this.db.get('day_xp', [userId, day])) !== undefined;
  }

  async listEarnedAchievements(userId) {
    return (await this.getProfile())?.achievements ?? [];
  }

  async addAchievement(userId, code) {
    const profile = await this.getProfile();
    if (!profile) return;
    if (!profile.achievements.includes(code)) {
      profile.achievements.push(code);
      await this.saveProfile(profile);
    }
  }

  // Squads e ligas: no-ops na PoC
  async listUserSquads() { return []; }
  async incrementSquadXp() {}
  async getUserLeague() { return null; }
  async incrementLeagueXp() {}
}
```

**Vantagem chave:** como o dominio JS (`completeLesson`, `getDailyQueue`, `applyStreak`,
`updateSrs`, etc.) ja existe e tem 76 testes, a PoC web basicamente so precisa deste
adapter + uma UI. O dominio nao muda.

---

## 5. Service Worker: estrategia offline

O app precisa carregar completamente sem rede. Isso requer um Service Worker (SW)
que intercepte os fetches e sirva da cache.

### 5.1 Camadas de cache

```
Camada 1: App shell (HTML, JS, CSS, fontes)
  -> Cache no install do SW (antes do usuario interagir)
  -> Estrategia: Cache First
  -> Nome: librax-shell-v1

Camada 2: Bundle de conteudo (course.json, signs.json)
  -> Cache no primeiro acesso (lazy, apos instalar)
  -> Estrategia: Cache First (nunca muda sem versionamento)
  -> Nome: librax-content-v1

Camada 3: Videos dos sinais
  -> Cache sob demanda: quando o usuario ABRE uma licao pela primeira vez
  -> Nao pre-carregar tudo (130 MB de uma vez e agressivo)
  -> Estrategia: Network First com fallback para cache; ou Stale While Revalidate
  -> Nome: librax-videos-v1

Camada 4: Modelo de reconhecimento (.task)
  -> Cache no primeiro uso da camera
  -> Estrategia: Cache First
  -> Nome: librax-model-v1
```

### 5.2 Estrutura do SW

```javascript
// service-worker.js

const SHELL_CACHE = 'librax-shell-v1';
const CONTENT_CACHE = 'librax-content-v1';
const VIDEO_CACHE = 'librax-videos-v1';
const MODEL_CACHE = 'librax-model-v1';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/main.dart.js',     // ou main.wasm se compilar em WASM
  '/manifest.json',
  // fontes, icons, etc.
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Videos: cache sob demanda
  if (url.pathname.includes('/signs/') && url.pathname.endsWith('.mp4')) {
    event.respondWith(cacheFirst(VIDEO_CACHE, event.request));
    return;
  }

  // Modelo MediaPipe
  if (url.pathname.endsWith('.task')) {
    event.respondWith(cacheFirst(MODEL_CACHE, event.request));
    return;
  }

  // App shell e assets estaticos
  event.respondWith(cacheFirst(SHELL_CACHE, event.request));
});

async function cacheFirst(cacheName, request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  const cache = await caches.open(cacheName);
  cache.put(request, response.clone());
  return response;
}
```

### 5.3 Pre-cache de videos por licao (UX inteligente)

Para nao baixar 130 MB de uma vez, o app solicita ao SW o pre-cache
dos videos da proxima licao em background, enquanto o usuario esta na licao atual:

```javascript
// No app: quando uma licao e concluida, pre-cachear a proxima
navigator.serviceWorker.controller.postMessage({
  type: 'PRECACHE_LESSON',
  videoUrls: nextLesson.exercises.map((ex) => ex.referenceVideoUrl),
});

// No SW
self.addEventListener('message', (event) => {
  if (event.data.type === 'PRECACHE_LESSON') {
    event.waitUntil(
      caches.open(VIDEO_CACHE).then((cache) =>
        Promise.all(event.data.videoUrls.map((url) => cache.add(url).catch(() => {})))
      )
    );
  }
});
```

---

## 6. Dois caminhos de implementacao para a PoC

### Caminho A: Flutter web (compilado para JS/WASM)

**Como funciona:** o mesmo app Flutter do mobile, compilado para rodar no navegador.

**Vantagens:**
- Reutiliza toda a UI Flutter futura (quando o app mobile for construido).
- `go_router` ja e compativel com web (hash routing).
- PWA e gerado automaticamente pelo build (`flutter build web --pwa-strategy=offline-first`).

**Desafios e solucoes:**

| Componente | Problema | Solucao para a PoC |
|---|---|---|
| `sqflite` (armazenamento local) | Nao funciona na web | Usar `drift` com `sqlite3.wasm` OU `isar` web OU reescrever o repositorio em Dart puro com `idb_shim` |
| `hand_landmarker` (reconhecimento) | Android-only | Usar `dart:js_interop` para chamar o MediaPipe JS Tasks (`@mediapipe/tasks-vision`) OU omitir reconhecimento na PoC (so exercicios receptivos) |
| `camera` package | Web usa `camera_web` (pacote diferente) | Trocar import por `camera_web` via import condicional (ja existe no app para o spike) |
| Domínio do jogo | Logica so existe em JS; precisaria ser reescrita em Dart | Reescrever em Dart ou usar `dart:js_interop` para chamar o JS domain diretamente |
| Performance (WASM) | Flutter web em JS e mais lento que mobile | Compilar para WASM com `flutter build web --wasm` (requer Dart 3.22+, Chrome 119+) |

**Pacotes de storage recomendados para Flutter web (nao usar `sqflite`):**

Opcao A1 - `drift` + `sqlite3.wasm`:
```yaml
dependencies:
  drift: ^2.x
  sqlite3: ^2.x
dev_dependencies:
  drift_dev: ^2.x
```
- Drift compila SQLite para WASM e roda no browser via OPFS.
- Mesma API SQL que no mobile - codigo de repositorio reutilizavel.
- Precisa de headers HTTP especificos: `Cross-Origin-Opener-Policy: same-origin`
  e `Cross-Origin-Embedder-Policy: require-corp` (isolamento cross-origin para SharedArrayBuffer).

Opcao A2 - `isar` (NoSQL, mais simples):
```yaml
dependencies:
  isar: ^3.x
  isar_flutter_libs: ^3.x
```
- API NoSQL; suporte web via WASM.
- Mais simples de configurar que drift para uma PoC.
- Sem SQL; queries por campo via API propria.

Opcao A3 - `shared_preferences` + `hive`:
```yaml
dependencies:
  shared_preferences: ^2.x  # usa localStorage no web
  hive: ^2.x                 # usa IndexedDB no web
  hive_flutter: ^1.x
```
- `shared_preferences` para flags simples (usa `localStorage` transparentemente).
- `hive` para colecoes (usa IndexedDB). Simples de usar, sem SQL.
- Perde em capacidade de query (ex: filtrar SRS por `dueAt` requer iterar todos).

**Recomendacao para o Caminho A:** usar `drift` se a intenção for reaproveitar o repositorio
no mobile. Usar `hive` se quiser a PoC mais rapida sem pensar em SQL.

### Caminho B: Web app TypeScript + dominio JS ja existente (recomendado para a PoC)

**Como funciona:** construir uma UI web (React, Preact, Svelte ou Vanilla TS) que
chama diretamente o dominio JS ja testado (`services/api/src/`).

**Vantagens:**
- O dominio inteiro ja existe e tem 76 testes passando. Nao ha nada para reescrever.
- O adapter IDB descrito na secao 4 e o unico codigo novo necessario alem da UI.
- A camera pode usar o SDK JS oficial do MediaPipe Tasks Vision, sem bridges.
- Ciclo de desenvolvimento muito mais rapido (sem compilacao Flutter).
- Deploy simples (bundle estatico: HTML + JS).

**Desvantagens:**
- A UI em React/Svelte nao e reutilizada no app Flutter mobile.
- Mas: o design system (SPEC 05) ja esta documentado; reimplementar a UI em Flutter
  depois de validar o produto nao e desperdicar trabalho - e exatamente o que uma PoC faz.

**Estrutura sugerida:**

```
apps/web-poc/
  src/
    domain/          -> symlink para ../../services/api/src/domain/
    usecases/        -> symlink para ../../services/api/src/usecases/
    lib/
      db.js          -> abertura e setup do IndexedDB (usando `idb`)
      idbRepo.js     -> IdbRepo: adapter IndexedDB implementando a porta do dominio
      content.js     -> carrega course.json + signs.json dos assets
      auth.js        -> gera/recupera userId do localStorage
      sw.js          -> registra o Service Worker
    ui/
      screens/       -> telas do jogo (CourseMap, Lesson, LessonCompletion, etc.)
      components/    -> componentes reutilizaveis
  public/
    assets/
      content/
        course.json
        signs.json
      videos/        -> videos bundlados localmente para a PoC (ou URLs externas)
      model/         -> modelo MediaPipe
  service-worker.js
  index.html
```

**Dependencias (so o necessario):**
```json
{
  "dependencies": {
    "idb": "^8.0.0",
    "@mediapipe/tasks-vision": "^0.10.0"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "vite-plugin-pwa": "^0.20.0"
  }
}
```

O `vite-plugin-pwa` gera o Service Worker automaticamente via configuracao simples,
sem escrever o SW do zero.

---

## 7. Camera na PoC web

O `hand_landmarker` do pub.dev nao funciona na web. O MediaPipe tem um SDK JS/WASM
oficial que faz exatamente o mesmo:

```javascript
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const vision = await FilesetResolver.forVisionTasks(
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm'
);

const handLandmarker = await HandLandmarker.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath: '/assets/model/hand_landmarker.task',
    delegate: 'GPU',    // WebGL; fallback para CPU automatico
  },
  runningMode: 'VIDEO',
  numHands: 1,
});

// No loop de video (requestAnimationFrame)
const result = handLandmarker.detectForVideo(videoElement, performance.now());
// result.landmarks: array de 21 pontos por mao
```

O arquivo `hand_landmarker.task` e o mesmo usado no Android (modelo do Google, ~5 MB).
Pode ser cacheado pela Cache API apos o primeiro download.

**Performance esperada na web:** 15-30 fps em hardware moderno com GPU delegate (WebGL).
Em hardware basico ou sem WebGL, o fallback CPU chega a 5-10 fps - aceitavel para PoC.

**Se a camera for omitida na PoC:** o app funciona apenas com exercicios receptivos
(multipla escolha, memorizar o sinal). A camera pode ser mostrada como "em breve no app".
Isso simplifica muito a PoC e ainda valida o game loop completo.

---

## 8. Conteudo do bundle na PoC

Para a PoC, o `course.json` e o `signs.json` sao bundlados diretamente nos assets
do app (sem S3). O SW os cacheia na primeira carga. Atualizacoes exigem bump de versao
do SW (o Vite PWA Plugin cuida disso automaticamente baseado em hash do arquivo).

Para os videos, ha tres opcoes na PoC:

**Opcao 1 - Videos de placeholder:** usar videos curtos gerados (ex: animacao do esqueleto
de maos) em vez de videos reais de um professor. Reduz o tamanho a poucos MB.

**Opcao 2 - URLs externas (CDN publico):** hospedar os videos em um S3 ou Cloudinary
publico e referenciar por URL. O SW os cacheia na primeira visita. Requer rede no primeiro
uso; depois funciona offline.

**Opcao 3 - Videos bundlados:** incluir os videos direto no repositorio e no bundle.
Viavel para U1 (26 videos de ~2-5 MB cada = ~130 MB). Nao e pratico para producao
mas funciona para uma PoC em localhost.

**Recomendacao para a PoC:** Opcao 1 (placeholders animados para a maioria) + Opcao 2
para os sinais que o time ja tiver gravado. Dessa forma o total em rede e < 10 MB.

---

## 9. O que fica de fora da PoC

| Feature | Por que fica fora | O que mostrar no lugar |
|---|---|---|
| Squads | Requer dados de outros usuarios | Tela com "Em breve" |
| Ligas | Requer server-side semanal | Tela com "Em breve" |
| Push notifications | Requer backend + FCM | Omitir |
| Cognito (auth real) | Sem backend | userId = UUID em localStorage; nome digitado na onboarding |
| Sincronizacao entre dispositivos | Requer backend | Dados ficam so no navegador atual |
| Analytics (PostHog) | Sem backend; dados nao precisam ir a lugar nenhum na PoC | Omitir; ou logar so no console |
| Certificado compartilhavel (SPEC 03 sec 11.15) | Funciona localmente (Canvas API); pode ser incluido na PoC | Incluir se for prioritario para demo |

---

## 10. Limites, riscos e mitigacoes

### Evicao do IndexedDB

**Risco:** o navegador pode apagar o IndexedDB se o dispositivo ficar sem espaco.

**Mitigacao:** chamar `navigator.storage.persist()` na primeira abertura do app.
Em Chrome, se o usuario instalar o PWA (`Add to Home Screen`), a persistencia e
garantida automaticamente. Exibir uma mensagem ao usuario caso `persist()` retorne `false`:
"Seus dados podem ser apagados pelo navegador se o dispositivo ficar sem espaco."

### Limite de localStorage (5 MB)

**Risco:** nao existe para o nosso caso. Flags e userId ocupam menos de 10 KB.

### Videos nao cacheados em Safari antigo

**Risco:** Safari < 15.2 tem restricoes agressivas de IndexedDB/Cache API (evicao apos 7 dias).

**Mitigacao:** para a PoC, documentar que o target e Chrome/Firefox. Safari moderno
(16+) nao tem esse problema.

### Headers de isolamento para SQLite WASM (so se usar drift)

**Risco:** `sqlite3.wasm` exige `SharedArrayBuffer`, que requer os headers:
`Cross-Origin-Opener-Policy: same-origin` e `Cross-Origin-Embedder-Policy: require-corp`.
GitHub Pages e Netlify nao servem esses headers por default.

**Mitigacao:** hospedar em Cloudflare Pages (suporta headers customizados via
`_headers`) ou em servidor proprio. Alternativa: usar `hive` (nao precisa de WASM/COOP).

### Tamanho do bundle Flutter web (so se usar Flutter)

**Risco:** um build Flutter web completo (sem WASM) tem tipicamente 2-5 MB de JS.
Com WASM, o `.wasm` pode ter 20+ MB.

**Mitigacao:** para a PoC, isso e aceitavel. O SW cacheia tudo apos a primeira carga.
Com compressao gzip no servidor, o JS Flutter cai para ~1.5 MB transferido.

---

## 11. Recomendacao e proximos passos

### Recomendacao para a PoC

**Usar o Caminho B: web app TypeScript com o dominio JS existente.**

Razoes:
1. O dominio do jogo (`completeLesson`, `getDailyQueue`, `applyStreak`, `updateSrs`) ja existe
   com 76 testes. Nao ha nada para reescrever ou portar.
2. O adapter IndexedDB (secao 4) e o unico codigo novo de infraestrutura.
3. A camera pode usar `@mediapipe/tasks-vision` (SDK JS oficial, mesma logica do Android spike).
4. O bundle final e menor e mais rapido de servir que um bundle Flutter.
5. Para uma PoC de validacao com usuarios ou investidores, velocidade de entrega importa mais
   que reaproveitamento de codigo com o futuro app Flutter.

Quando o app Flutter for construido, o dominio JS pode ser portado para Dart - a logica
ja esta testada e a porta de repositorio esta bem definida. A UI Flutter sera escrita do zero
de qualquer forma (o componente visual nao e reaproveitavel entre web TS e Flutter).

### Sequencia de implementacao sugerida (nao e compromisso, e orientacao)

1. Setup: `apps/web-poc/` com Vite + `vite-plugin-pwa` + `idb`.
2. Auth local: gerar UUID no localStorage na primeira abertura; tela de nome.
3. Adapter IDB: implementar `IdbRepo` (secao 4).
4. Conectar dominio: importar `completeLesson` e `getDailyQueue` com `IdbRepo`.
5. Content loader: carregar `course.json` e `signs.json` dos assets.
6. Telas: CourseMap, LessonScreen (exercicios receptivos), LessonCompletion.
7. Service Worker: configurar via `vite-plugin-pwa` (offline-first).
8. Camera (opcional): integrar `@mediapipe/tasks-vision` para exercicios expressivos.
9. XP, streak, SRS: ja funcionam via dominio - so conectar ao estado da UI.
10. Telas de engajamento: StreakScreen, AchievementsScreen (dados ja no IndexedDB).

---

## Apendice: checklist tecnico antes de implementar

- [ ] Decidir entre Caminho A (Flutter web) ou B (TS web app).
- [ ] Definir se camera entra na PoC ou so exercicios receptivos.
- [ ] Definir como os videos serao servidos (placeholders / CDN / bundlados).
- [ ] O dominio JS nao tem dependencias de modulos Node.js. `src/domain/*.js` e
      `src/lib/dates.js` usam somente `Date`, `Math` e `RegExp` - rodara no browser
      sem nenhuma alteracao. (Verificado em 2026-06-28.)
- [ ] Decidir onde hospedar (GitHub Pages, Cloudflare Pages, Vercel, ou so localhost).
      Se usar drift (SQLite WASM), a hospedagem precisa suportar headers COOP/COEP.
