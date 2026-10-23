import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import '../ui/app_theme.dart';

/// Implementacao web: mostra o feed da camera sem deteccao de landmarks.
/// Hand Landmarker via MediaPipe Tasks JS chegara em versao futura.
class PracticeWidget extends StatefulWidget {
  const PracticeWidget({super.key});

  @override
  State<PracticeWidget> createState() => _PracticeWidgetState();
}

class _PracticeWidgetState extends State<PracticeWidget> {
  CameraController? _controller;
  bool _loading = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _initCamera();
  }

  Future<void> _initCamera() async {
    try {
      final cameras = await availableCameras();
      if (cameras.isEmpty) {
        setState(() {
          _errorMessage = 'Nenhuma camera encontrada neste dispositivo.';
          _loading = false;
        });
        return;
      }

      final front = cameras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.front,
        orElse: () => cameras.first,
      );

      final controller = CameraController(
        front,
        ResolutionPreset.medium,
        enableAudio: false,
      );
      await controller.initialize();

      if (!mounted) return;
      setState(() {
        _controller = controller;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _errorMessage = 'Nao foi possivel acessar a camera.\n'
            'Verifique as permissoes do navegador e tente novamente.';
        _loading = false;
      });
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(color: LibraxColors.teal),
            SizedBox(height: Gap.md),
            Text('Iniciando camera...'),
          ],
        ),
      );
    }

    if (_errorMessage != null) {
      return _CameraErrorState(
        message: _errorMessage!,
        onRetry: () {
          setState(() {
            _loading = true;
            _errorMessage = null;
          });
          _initCamera();
        },
      );
    }

    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) {
      return const SizedBox.shrink();
    }

    return Stack(
      fit: StackFit.expand,
      children: [
        // Feed de camera
        CameraPreview(controller),

        // Banner informativo (deteccao nao disponivel no web)
        SafeArea(
          child: Align(
            alignment: Alignment.bottomCenter,
            child: Padding(
              padding: const EdgeInsets.only(
                  bottom: Gap.xl, left: Gap.screenH, right: Gap.screenH),
              child: Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: Gap.md, vertical: Gap.sm),
                decoration: BoxDecoration(
                  color: Colors.black.withAlpha(166),
                  borderRadius: BorderRadius.circular(Radii.pill),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.info_outline_rounded,
                        color: Colors.white70, size: 16),
                    const SizedBox(width: Gap.sm),
                    Flexible(
                      child: Text(
                        'Deteccao de gestos disponivel no app mobile',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: Colors.white70,
                            ),
                        textAlign: TextAlign.center,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _CameraErrorState extends StatelessWidget {
  const _CameraErrorState({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(Gap.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.videocam_off_rounded,
                size: 64, color: LibraxColors.locked),
            const SizedBox(height: Gap.md),
            Text(
              'Camera indisponivel',
              style: text.titleMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: Gap.sm),
            Text(
              message,
              style: text.bodyMedium?.copyWith(color: LibraxColors.muted),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: Gap.xl),
            OutlinedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Tentar novamente'),
            ),
          ],
        ),
      ),
    );
  }
}
