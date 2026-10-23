import 'package:flutter/material.dart';
import 'router.dart';
import 'ui/app_theme.dart';

class LibraxApp extends StatelessWidget {
  const LibraxApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Librax',
      debugShowCheckedModeBanner: false,
      theme: libraxTheme(),
      routerConfig: router,
    );
  }
}
