import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

class LibraxScaffold extends StatelessWidget {
  const LibraxScaffold({super.key, required this.child});

  final Widget child;

  static const _tabs = [
    (icon: Icons.home_outlined,      activeIcon: Icons.home_rounded,           label: 'Inicio',   path: '/'),
    (icon: Icons.school_outlined,    activeIcon: Icons.school_rounded,          label: 'Aprender', path: '/learn'),
    (icon: Icons.back_hand_outlined, activeIcon: Icons.back_hand_rounded,       label: 'Praticar', path: '/practice'),
    (icon: Icons.person_outline,     activeIcon: Icons.person_rounded,          label: 'Perfil',   path: '/profile'),
  ];

  int _indexFromLocation(String location) {
    for (var i = _tabs.length - 1; i >= 0; i--) {
      if (_tabs[i].path != '/' && location.startsWith(_tabs[i].path)) return i;
    }
    return location == '/' ? 0 : 0;
  }

  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).uri.path;
    final currentIndex = _indexFromLocation(location);

    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: currentIndex,
        onDestinationSelected: (i) => context.go(_tabs[i].path),
        animationDuration: const Duration(milliseconds: 300),
        destinations: _tabs
            .map((t) => NavigationDestination(
                  icon: Icon(t.icon),
                  selectedIcon: Icon(t.activeIcon),
                  label: t.label,
                ))
            .toList(),
      ),
    );
  }
}
