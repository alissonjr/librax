import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:hand_landmarker/hand_landmarker.dart';
import 'package:permission_handler/permission_handler.dart';

import 'hand_3d.dart';
import 'hand_skeleton.dart';

/// Como a mao detectada e exibida.
enum HandViewMode {
  /// Preview da camera com o esqueleto 2D por cima (ferramenta de captura).
  cameraSkeleton,

  /// Sem imagem da camera: avatar de mao 3D que imita a mao real.
  avatar3d,
}

/// Camera frontal + Hand Landmarker + render da mao, reutilizavel.
///
/// Chama [onHands] a cada frame processado com a lista de maos detectadas.
/// O conteudo de [overlay] e desenhado por cima (HUD, controles, etc.).
///
/// Em [HandViewMode.avatar3d] a camera continua rodando (necessaria para a
/// deteccao) mas o preview NAO e mostrado: a mao vira um avatar 3D.
class HandCameraView extends StatefulWidget {
  const HandCameraView({
    super.key,
    required this.onHands,
    this.overlay,
    this.numHands = 1,
    this.mode = HandViewMode.cameraSkeleton,
  });

  final void Function(List<Hand> hands) onHands;
  final Widget? overlay;
  final int numHands;
  final HandViewMode mode;

  @override
  State<HandCameraView> createState() => _HandCameraViewState();
}

class _HandCameraViewState extends State<HandCameraView> {
  CameraController? _controller;
  HandLandmarkerPlugin? _plugin;
  List<Hand> _hands = const [];
  bool _busy = false;
  String _status = 'Iniciando...';

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    final granted = await Permission.camera.request();
    if (!granted.isGranted) {
      if (mounted) setState(() => _status = 'Permissao de camera negada');
      return;
    }

    _plugin = HandLandmarkerPlugin.create(
      numHands: widget.numHands,
      minHandDetectionConfidence: 0.5,
      delegate: HandLandmarkerDelegate.gpu,
    );

    final cameras = await availableCameras();
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
    await controller.startImageStream(_onFrame);

    if (!mounted) return;
    setState(() {
      _controller = controller;
      _status = 'Mostre a mao no quadro';
    });
  }

  void _onFrame(CameraImage image) {
    // detect() e sincrono e bloqueante: descartamos frames enquanto processa
    // um, mantendo ~tempo real sem enfileirar (poupa bateria/throttling).
    if (_busy || _plugin == null || _controller == null) return;
    _busy = true;
    try {
      final hands = _plugin!.detect(
        image,
        _controller!.description.sensorOrientation,
      );
      widget.onHands(hands);
      if (mounted) setState(() => _hands = hands);
    } catch (_) {
      // frame ignorado em caso de erro pontual de inferencia
    } finally {
      _busy = false;
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    _plugin?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    final avatar = widget.mode == HandViewMode.avatar3d;
    if (controller == null || !controller.value.isInitialized) {
      return Container(
        decoration: avatar ? _avatarBackground : null,
        color: avatar ? null : Colors.black,
        alignment: Alignment.center,
        child: Text(
          _status,
          style: TextStyle(color: avatar ? Colors.white70 : Colors.white),
        ),
      );
    }
    return Stack(
      fit: StackFit.expand,
      children: [
        if (avatar)
          // Fundo limpo no lugar do feed da camera; a mao 3D fica por cima.
          const DecoratedBox(decoration: _avatarBackground)
        else
          CameraPreview(controller),
        CustomPaint(
          painter: avatar
              ? Hand3DPainter(_hands)
              : HandSkeletonPainter(_hands),
        ),
        if (widget.overlay != null) widget.overlay!,
      ],
    );
  }

  static const _avatarBackground = BoxDecoration(
    gradient: LinearGradient(
      begin: Alignment.topCenter,
      end: Alignment.bottomCenter,
      colors: [Color(0xFF1E1B3A), Color(0xFF2B2453), Color(0xFF14122A)],
    ),
  );
}
