# Camada 2: Backend, gestão de usuários e engajamento

> **OBSOLETO** - Este blueprint foi escrito antes da decisao de infra e assumia Supabase como backend.
> Decisao final: **AWS serverless** (Lambda, DynamoDB, Cognito, S3+CloudFront).
> A fonte da verdade e a `spec-02-backend-gestao-engajamento.md`.

> Foco mobile híbrido (iOS/Android). Estratégia: não reinventar backend; usar BaaS e
> concentrar energia no diferencial (reconhecimento e conteúdo).

## 2.1 Stack de backend

Recomendação inicial: **Supabase** (Postgres gerenciado + Auth + Storage + Realtime + Edge Functions, open-source).

Por que Supabase para este app:
- Banco **relacional de verdade** (Postgres), que é o que o currículo/progresso/repetição espaçada pedem.
- Auth pronto com OAuth e, crucial para iOS, **Sign in with Apple**.
- **Row Level Security (RLS)**: cada usuário só lê/escreve o próprio dado, regra no banco.
- Storage para vídeos de referência dos sinais (servidos via CDN).
- Edge Functions para lógica sensível (validar conquista, fechar liga semanal).

Quando migrar para API própria (NestJS/FastAPI sobre Postgres): quando precisar de regras complexas de antifraude de XP, billing avançado, ou escala que justifique. Modelar desde já para essa transição ser suave (lógica de negócio em `packages/core`).

## 2.2 Login e contas (fluxos)

- **Login anônimo primeiro**: a pessoa joga a primeira lição **sem cadastro**. Converte para conta depois (vincula o usuário anônimo, preservando progresso). Isso maximiza ativação.
- Métodos: e-mail/senha (magic link de preferência), **Google**, **Apple** (obrigatório na App Store se houver login social).
- Onboarding: motivo de aprender Libras, meta diária, teste rápido de nível (opcional), permissão de câmera explicada com calma.

## 2.3 Modelo de dados (Postgres / DDL de referência)

```sql
-- Perfil e economia do jogo
create table profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  locale       text default 'pt-BR',
  timezone     text default 'America/Sao_Paulo',  -- crítico para streak
  xp_total     int  default 0,
  gems         int  default 0,        -- moeda
  hearts       int  default 5,        -- vidas
  hearts_updated_at timestamptz default now(),
  daily_goal_xp int  default 20,
  created_at   timestamptz default now()
);

-- Catálogo de conteúdo
create table courses  (id uuid primary key, title text, level text, "order" int);
create table units    (id uuid primary key, course_id uuid references courses, title text, "order" int);
create table lessons  (id uuid primary key, unit_id uuid references units, type text, "order" int, xp_reward int default 10);
create table signs (
  id uuid primary key,
  gloss text not null,            -- ex: "OBRIGADO"
  category text,
  video_url text,                 -- vídeo de referência (Storage/CDN)
  params jsonb,                   -- 5 parâmetros: config mão, ponto, movimento, orientação, expressão
  region text default 'nacional', -- variação regional
  recognition_type text           -- 'static' | 'dynamic'
);
create table exercises (
  id uuid primary key,
  lesson_id uuid references lessons,
  type text not null,             -- ver catálogo no doc 3
  sign_id uuid references signs,
  payload jsonb,                  -- opções, distratores, etc.
  "order" int
);

-- Progresso e aprendizado
create table user_progress (
  user_id uuid references profiles, lesson_id uuid references lessons,
  status text default 'locked',   -- locked | available | completed
  best_score numeric, completed_at timestamptz,
  primary key (user_id, lesson_id)
);
create table user_attempts (      -- telemetria fina de aprendizado
  id bigserial primary key,
  user_id uuid, exercise_id uuid, sign_id uuid,
  correct bool, confidence numeric,   -- confidence do reconhecimento
  duration_ms int, created_at timestamptz default now()
);

-- Repetição espaçada (um item de memória por (usuário, sinal))
create table srs_items (
  user_id uuid, sign_id uuid,
  strength numeric default 0,     -- "meia-vida" da memória
  due_at timestamptz,             -- quando revisar
  last_reviewed_at timestamptz,
  primary key (user_id, sign_id)
);

-- Engajamento
create table daily_streak_log (user_id uuid, day date, primary key (user_id, day));
create table achievements (id uuid primary key, code text unique, title text, rule jsonb);
create table user_achievements (user_id uuid, achievement_id uuid, earned_at timestamptz, primary key (user_id, achievement_id));
create table leagues (id uuid primary key, tier text, period date);
create table league_members (league_id uuid, user_id uuid, xp_period int default 0, primary key (league_id, user_id));
```

### RLS (exemplo)
```sql
alter table profiles enable row level security;
create policy "own profile" on profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- catálogo (courses/units/lessons/signs) é leitura pública para autenticados.
```

## 2.4 Streak / ofensiva diária (a mecânica de retenção mais forte)

Pontos de atenção que normalmente quebram streak:
- **Fuso horário**: o "dia" é o do usuário (campo `timezone`), não o do servidor. Calcular virada de dia no fuso dele.
- **Streak freeze**: item comprável com gems que perdoa 1 dia perdido.
- **Repair**: oferecer recuperar streak (com gems ou anúncio) é forte para retorno.

```ts
// regra ao concluir qualquer lição
function onLessonCompleted(profile, today /* data no fuso do usuário */) {
  const last = profile.lastActiveDay;
  if (last === today) return;                 // já contou hoje
  if (last === yesterday(today)) streak += 1; // consecutivo
  else if (hasFreeze && last === dayBefore(yesterday(today))) {/* consome freeze */}
  else streak = 1;                            // quebrou, recomeça
  profile.lastActiveDay = today;
  upsertDailyStreakLog(profile.userId, today);
}
```

## 2.5 Economia do jogo
- **XP**: ganho por exercício/lição; alimenta metas diárias e ligas. Validar no servidor (Edge Function) para evitar burla.
- **Vidas/corações**: limitam erros. **Política recomendada para Libras: generosa.** A câmera pode errar; punir falha de reconhecimento como se fosse erro do aluno gera frustração e churn. Sugestão: vidas só em exercícios receptivos, ou regen rápida, ou desligáveis em "modo prática".
- **Gems**: recompensa por metas/conquistas; gasta em streak freeze, recuperação, cosméticos.

## 2.6 Conquistas, ligas e social
- **Conquistas**: regra declarativa em `achievements.rule` (jsonb), avaliada por trigger/Edge Function. Ex.: `{"type":"streak","gte":7}`, `{"type":"signs_learned","gte":50}`, `{"type":"alphabet_complete"}`.
- **Ligas semanais**: agrupa ~30 usuários por tier; ranking por XP da semana; promove/rebaixa no fechamento (Edge Function agendada). Competição social leve, sem necessidade de "amigos".
- **Compartilhar conquista** (streak, badge) para fora do app: alça de aquisição orgânica.

## 2.7 Notificações push
- **Expo Notifications** (funciona em iOS/Android via dev build).
- Casos: lembrete de ofensiva (no horário em que a pessoa costuma estudar), "sua ofensiva está em risco", retorno após inatividade, nova unidade liberada.
- Disciplina: poucas, relevantes, respeitando preferências. Notificação spam queima base.

## 2.8 Offline-first e sincronização (essencial no mobile)
- Catálogo de lições e vídeos de referência **pré-baixados** por unidade (estuda no metrô).
- Progresso/tentativas gravados em **SQLite local** (expo-sqlite ou WatermelonDB) e sincronizados com Supabase quando há rede (fila com retry, resolução last-write-wins por usuário, já que o dado é só dele).
- Reconhecimento já é local, então o exercício de câmera funciona 100% offline.

## 2.9 Analytics e medição de uso
- **PostHog** (open-source, free tier bom) ou Amplitude.
- Taxonomia de eventos:
  - `app_open`, `lesson_started`, `exercise_answered{type,correct,confidence}`,
  - `sign_recognized{sign_id,confidence,attempts}`, `lesson_completed{score,xp}`,
  - `streak_extended{length}`, `goal_met`, `achievement_earned{code}`,
  - `camera_permission{granted}`, `camera_session_quality{lighting,framing}`.
- **Métricas norte**: retenção D1/D7/D30, DAU/MAU, comprimento médio de ofensiva, lições/dia.
- **Métrica específica deste produto**: `confidence` média por sinal. Sinal com confidence cronicamente baixa = o modelo de visão precisa de mais dados, não o aluno é ruim. Esse número guia a evolução do dataset (fecha o ciclo com o doc 1).
