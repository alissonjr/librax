# Librax - App Flutter (Android + Web)

Spike de reconhecimento (S1/S2) + game shell compartilhado entre mobile e web.

> Reconhecimento de maos: Android via `hand_landmarker`. Web: stub por enquanto
> (MediaPipe Tasks JS sera integrado via JS interop). iOS exige ponte nativa.

## Por que faltam as pastas android/ios/web aqui
Este scaffold foi escrito sem Flutter SDK instalado. As pastas de plataforma
sao geradas pelo `flutter create` - veja o bootstrap abaixo.

## Bootstrap (uma vez, na sua maquina com Flutter)

### Mobile (Android)
Pre-requisitos: Flutter SDK 3.22+, Android SDK, **JDK 17+**, device/emulador Android.

```bash
cd apps/mobile_flutter

# Gera a pasta android/ sem sobrescrever o codigo Dart e o pubspec existentes
flutter create . --platforms=android --project-name librax

flutter pub get
```

Ajustes manuais necessarios:

- Em `android/app/src/main/AndroidManifest.xml`, antes de `<application>`:
  ```xml
  <uses-permission android:name="android.permission.CAMERA" />
  ```
- Em `android/app/build.gradle`: `minSdkVersion 24` (exigencia da `hand_landmarker`).
- Garanta JDK 17+ no ambiente.

```bash
flutter run   # com device/emulador Android conectado
```

### Web
Pre-requisitos: Flutter SDK 3.22+, Chrome/Edge.

```bash
cd apps/mobile_flutter

# Gera a pasta web/ (index.html e manifest.json ja existem neste repo)
flutter create . --platforms=web --project-name librax

flutter pub get
flutter run -d chrome
```

Para build de producao:
```bash
flutter build web --release
# artefatos em build/web/ - pronto para S3/CloudFront
```

## Estrutura de plataforma
A logica de jogo (telas, navegacao, XP, streak) e 100% compartilhada.
Apenas o reconhecimento de maos e separado por import condicional:

| Arquivo | Quando compilado |
|---|---|
| `lib/platform/practice_widget_mobile.dart` | Android/iOS (`dart.library.io`) |
| `lib/platform/practice_widget_web.dart` | Web (`dart.library.html`) |
| `lib/platform/practice_widget_stub.dart` | Fallback |

## Arquivos principais
- `lib/main.dart` + `lib/app.dart` - entry point e MaterialApp.router
- `lib/router.dart` - rotas com go_router (ShellRoute + bottom nav)
- `lib/widgets/librax_nav.dart` - scaffold com NavigationBar compartilhado
- `lib/screens/` - Home, Aprender, Praticar, Perfil
- `lib/platform/` - abstracao da camera/hand detection por plataforma
- `lib/hand_camera_view.dart` - camera + `detect()` + esqueleto (Android, spike S1)
- `lib/hand_skeleton.dart` - `HandSkeletonPainter` + `normalizeHand()`
- `lib/capture/` - ferramenta de captura de dataset (spike S2)

## Fluxo de captura de dataset (S2 -> S4)
1. Abra "S2: Capturar dataset". Defina **Pessoa** (id) e a **mao** (Esq/Dir).
2. Escolha a letra (setas) e toque **Gravar**: cada frame com mao detectada vira
   uma amostra `normalizeHand()` (63 floats) + rotulo. Segure a config ~20-30s
   variando levemente o angulo (~300-450 amostras/letra).
3. Repita com **varias pessoas** (SPEC 01: 15-20; split por pessoa no treino).
4. Toque **exportar** (icone compartilhar) para tirar o `librax_dataset.jsonl` do device.
5. Treine: `python ml-training/train_static.py librax_dataset.jsonl` -> gera
   `handshapes.tflite` + `labels.txt` e imprime a acuracia em pessoas nao vistas (S6).

## Proximos passos
- S3: coletar as 5-6 letras com 5+ pessoas usando a tela de captura.
- S4: rodar `train_static.py` (ja escrito) e validar o GO/NO-GO (>= 90%).
- S5: carregar `handshapes.tflite` via `tflite_flutter` no app e classificar ao vivo.

## Aviso honesto
Este codigo nao pode ser compilado/rodado no ambiente onde foi gerado (sem Flutter
SDK nem device). Ele segue a API documentada do `hand_landmarker` v2.2.0, mas o
build nativo e a medicao em camera precisam rodar no seu device.
