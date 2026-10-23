// Exporta a implementacao correta por plataforma sem que o compilador web
// tente resolver hand_landmarker (Android-only).
export 'practice_widget_stub.dart'
    if (dart.library.html) 'practice_widget_web.dart'
    if (dart.library.io) 'practice_widget_mobile.dart';
