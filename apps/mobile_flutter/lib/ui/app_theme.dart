import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Paleta semantica do Librax (design-system.md secao 2).
class LibraxColors {
  LibraxColors._();

  // -- Marca --
  static const brand     = Color(0xFF6C5CE7); // violeta principal
  static const brandDark = Color(0xFF5546D6); // estado pressed / sombra 3D
  static const brandSoft = Color(0xFFEDEAFF); // fundo suave (indicador de nav ativa)

  // -- Semanticas --
  static const success     = Color(0xFF58CC02); // acerto (verde Duolingo)
  static const successDark = Color(0xFF46A302);
  static const successSoft = Color(0xFFE6F7D9);

  static const error     = Color(0xFFFF4B4B); // erro / feedback negativo
  static const errorDark = Color(0xFFD93A3A);
  static const errorSoft = Color(0xFFFFE3E3);

  static const warning     = Color(0xFFF59E0B); // streak em risco, aviso
  static const warningSoft = Color(0xFFFEF3C7);

  // -- Gamificacao --
  static const streak = Color(0xFFFF7800); // icone de fogo, contador de dias
  static const xp     = Color(0xFFFFC800); // moedas de XP, conquistas (gold)

  // -- Libras / Camera --
  static const teal     = Color(0xFF009688); // elementos de camera, sinais
  static const tealSoft = Color(0xFFC8EFE9);

  // -- Neutros --
  static const ink     = Color(0xFF2B2B3A); // texto principal
  static const muted   = Color(0xFF8A8AA0); // texto secundario / icones inativos
  static const line    = Color(0xFFE6E6F0); // bordas, separadores
  static const locked  = Color(0xFFCBCBDA); // licao bloqueada
  static const surface = Color(0xFFF7F7FB); // fundo de telas
  static const card    = Colors.white;      // fundo de cards
}

/// Espacamento em multiplos de 4 (design-system.md secao 4).
class Gap {
  Gap._();
  static const xs   = 4.0;
  static const sm   = 8.0;
  static const base = 12.0;
  static const md   = 16.0;
  static const lg   = 20.0;
  static const xl   = 24.0;
  static const xxl  = 32.0;
  static const xxxl = 48.0;

  static const screenH = 20.0; // margem horizontal padrao de tela
}

/// Raios de borda (design-system.md secao 5).
class Radii {
  Radii._();
  static const xs   = 4.0;
  static const sm   = 8.0;
  static const md   = 12.0;
  static const card = 16.0;
  static const xl   = 24.0;
  static const sheet = 32.0;
  static const pill = 999.0;

  static BorderRadius get cardAll   => BorderRadius.circular(card);
  static BorderRadius get mdAll     => BorderRadius.circular(md);
  static BorderRadius get xlAll     => BorderRadius.circular(xl);
  static BorderRadius get pillAll   => BorderRadius.circular(pill);
  static BorderRadius get sheetTop  => const BorderRadius.vertical(top: Radius.circular(sheet));
}

/// Duracoes de animacao (design-system.md secao 7.3).
class LibraxDuration {
  LibraxDuration._();
  static const fast   = Duration(milliseconds: 150);
  static const normal = Duration(milliseconds: 280);
  static const slow   = Duration(milliseconds: 400);
}

ThemeData libraxTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: LibraxColors.brand,
    primary: LibraxColors.brand,
    surface: LibraxColors.surface,
    error: LibraxColors.error,
  );

  final baseText = GoogleFonts.nunitoTextTheme(ThemeData.light().textTheme)
      .apply(bodyColor: LibraxColors.ink, displayColor: LibraxColors.ink);

  final textTheme = baseText.copyWith(
    displayLarge:  baseText.displayLarge?.copyWith(fontWeight: FontWeight.w800),
    displayMedium: baseText.displayMedium?.copyWith(fontWeight: FontWeight.w700),
    headlineLarge: baseText.headlineLarge?.copyWith(fontWeight: FontWeight.w700),
    headlineMedium: baseText.headlineMedium?.copyWith(fontWeight: FontWeight.w700),
    headlineSmall: baseText.headlineSmall?.copyWith(fontWeight: FontWeight.w600),
    titleLarge:   baseText.titleLarge?.copyWith(fontWeight: FontWeight.w700),
    titleMedium:  baseText.titleMedium?.copyWith(fontWeight: FontWeight.w600),
    titleSmall:   baseText.titleSmall?.copyWith(fontWeight: FontWeight.w600),
    labelLarge:   baseText.labelLarge?.copyWith(fontWeight: FontWeight.w700, letterSpacing: 0.3),
    labelMedium:  baseText.labelMedium?.copyWith(fontWeight: FontWeight.w600),
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: LibraxColors.surface,
    textTheme: textTheme,

    appBarTheme: AppBarTheme(
      backgroundColor: LibraxColors.surface,
      foregroundColor: LibraxColors.ink,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 1,
      centerTitle: true,
      titleTextStyle: textTheme.titleLarge?.copyWith(color: LibraxColors.ink),
      iconTheme: const IconThemeData(color: LibraxColors.ink, size: 24),
    ),

    cardTheme: CardThemeData(
      elevation: 0,
      color: LibraxColors.card,
      shape: RoundedRectangleBorder(
        borderRadius: Radii.cardAll,
        side: const BorderSide(color: LibraxColors.line),
      ),
      margin: EdgeInsets.zero,
    ),

    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: LibraxColors.brand,
        foregroundColor: Colors.white,
        minimumSize: const Size.fromHeight(52),
        padding: const EdgeInsets.symmetric(horizontal: Gap.xl),
        shape: RoundedRectangleBorder(borderRadius: Radii.pillAll),
        textStyle: textTheme.labelLarge?.copyWith(fontSize: 16),
      ),
    ),

    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: LibraxColors.brand,
        minimumSize: const Size.fromHeight(48),
        padding: const EdgeInsets.symmetric(horizontal: Gap.xl),
        side: const BorderSide(color: LibraxColors.brand, width: 1.5),
        shape: RoundedRectangleBorder(borderRadius: Radii.pillAll),
        textStyle: textTheme.labelLarge?.copyWith(fontSize: 14, fontWeight: FontWeight.w600),
      ),
    ),

    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: LibraxColors.brand,
        padding: const EdgeInsets.symmetric(horizontal: Gap.md, vertical: Gap.sm),
        textStyle: textTheme.labelMedium?.copyWith(fontWeight: FontWeight.w600),
      ),
    ),

    navigationBarTheme: NavigationBarThemeData(
      height: 72,
      backgroundColor: LibraxColors.card,
      surfaceTintColor: Colors.transparent,
      shadowColor: LibraxColors.line,
      elevation: 8,
      indicatorColor: LibraxColors.brandSoft,
      labelTextStyle: WidgetStateProperty.all(
        textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w600, color: LibraxColors.ink),
      ),
      iconTheme: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) {
          return const IconThemeData(color: LibraxColors.brand, size: 24);
        }
        return const IconThemeData(color: LibraxColors.muted, size: 24);
      }),
    ),

    inputDecorationTheme: InputDecorationTheme(
      filled: false,
      border: OutlineInputBorder(borderRadius: Radii.mdAll, borderSide: const BorderSide(color: LibraxColors.line)),
      enabledBorder: OutlineInputBorder(borderRadius: Radii.mdAll, borderSide: const BorderSide(color: LibraxColors.line)),
      focusedBorder: OutlineInputBorder(borderRadius: Radii.mdAll, borderSide: const BorderSide(color: LibraxColors.brand, width: 2)),
      errorBorder: OutlineInputBorder(borderRadius: Radii.mdAll, borderSide: const BorderSide(color: LibraxColors.error)),
      contentPadding: const EdgeInsets.symmetric(horizontal: Gap.md, vertical: 14),
      labelStyle: textTheme.bodyMedium?.copyWith(color: LibraxColors.muted),
      hintStyle: textTheme.bodyMedium?.copyWith(color: LibraxColors.locked),
    ),

    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: LibraxColors.success,
      linearTrackColor: LibraxColors.line,
    ),

    listTileTheme: ListTileThemeData(
      shape: RoundedRectangleBorder(borderRadius: Radii.mdAll),
      contentPadding: const EdgeInsets.symmetric(horizontal: Gap.md, vertical: Gap.xs),
      tileColor: LibraxColors.card,
      minLeadingWidth: 0,
    ),

    dividerTheme: const DividerThemeData(space: 0, thickness: 1, color: LibraxColors.line),

    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: LibraxColors.ink,
      contentTextStyle: textTheme.bodyMedium?.copyWith(color: Colors.white),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.all(Radius.circular(Radii.md)),
      ),
    ),

    chipTheme: ChipThemeData(
      padding: const EdgeInsets.symmetric(horizontal: Gap.sm, vertical: 0),
      labelStyle: textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w600),
      shape: const StadiumBorder(),
      side: BorderSide.none,
    ),

    dialogTheme: DialogThemeData(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
      titleTextStyle: textTheme.headlineSmall,
      contentTextStyle: textTheme.bodyMedium?.copyWith(color: LibraxColors.muted),
    ),
  );
}
