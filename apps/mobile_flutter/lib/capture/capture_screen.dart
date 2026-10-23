import 'package:flutter/material.dart';
import 'package:hand_landmarker/hand_landmarker.dart';

import '../hand_camera_view.dart';
import '../hand_skeleton.dart';
import 'sample_store.dart';

/// Letras com configuracao de mao estatica, alvo do spike (S3 da SPEC 01).
/// Letras com movimento (H, J, K, X, Z, ...) precisam de captura por sequencia
/// e ficam fora desta ferramenta estatica.
const List<String> kSpikeLabels = ['A', 'B', 'C', 'D', 'E', 'I', 'L', 'O', 'U', 'V'];

/// Ferramenta de captura de dataset (S2): grava vetores normalizados rotulados.
/// Salva APENAS landmarks (nunca imagem). Exporta JSONL para o treino em Python.
class CaptureScreen extends StatefulWidget {
  const CaptureScreen({super.key});

  @override
  State<CaptureScreen> createState() => _CaptureScreenState();
}

class _CaptureScreenState extends State<CaptureScreen> {
  final _store = SampleStore();
  final _personCtrl = TextEditingController(text: 'p01');

  int _labelIndex = 0;
  String _hand = 'Right';
  bool _recording = false;
  bool _saving = false;

  String get _label => kSpikeLabels[_labelIndex];

  void _onHands(List<Hand> hands) {
    if (!_recording || hands.isEmpty) return;
    final lm = hands.first.landmarks;
    if (lm.length < 21) return;
    final v = normalizeHand(lm);
    if (v.length != 63) return;
    _store.add(Sample(
      label: _label,
      person: _personCtrl.text.trim().isEmpty ? 'p00' : _personCtrl.text.trim(),
      hand: _hand,
      vector: v,
      ts: DateTime.now().millisecondsSinceEpoch,
    ));
    if (mounted) setState(() {});
  }

  void _cycleLabel(int delta) {
    setState(() {
      _labelIndex = (_labelIndex + delta) % kSpikeLabels.length;
      if (_labelIndex < 0) _labelIndex += kSpikeLabels.length;
    });
  }

  Future<void> _export() async {
    setState(() => _saving = true);
    try {
      await _store.export();
    } catch (e) {
      _snack('Falha ao exportar: $e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _snack(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(msg)));
  }

  @override
  void dispose() {
    _personCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final count = _store.countsByLabel()[_label] ?? 0;
    return Scaffold(
      backgroundColor: Colors.black,
      body: HandCameraView(
        onHands: _onHands,
        overlay: SafeArea(
          child: Column(
            children: [
              _topBar(),
              const Spacer(),
              _bottomPanel(count),
            ],
          ),
        ),
      ),
    );
  }

  Widget _topBar() {
    return Padding(
      padding: const EdgeInsets.all(12),
      child: Row(
        children: [
          SizedBox(
            width: 110,
            child: TextField(
              controller: _personCtrl,
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(
                labelText: 'Pessoa',
                labelStyle: TextStyle(color: Colors.white70),
                isDense: true,
                filled: true,
                fillColor: Colors.black54,
                border: OutlineInputBorder(),
              ),
            ),
          ),
          const SizedBox(width: 12),
          ToggleButtons(
            isSelected: [_hand == 'Left', _hand == 'Right'],
            onPressed: (i) => setState(() => _hand = i == 0 ? 'Left' : 'Right'),
            borderRadius: BorderRadius.circular(8),
            color: Colors.white70,
            selectedColor: Colors.white,
            fillColor: Colors.indigo,
            children: const [
              Padding(padding: EdgeInsets.symmetric(horizontal: 12), child: Text('Esq')),
              Padding(padding: EdgeInsets.symmetric(horizontal: 12), child: Text('Dir')),
            ],
          ),
          const Spacer(),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: Colors.black54,
              borderRadius: BorderRadius.circular(20),
            ),
            child: Text('Total: ${_store.total}',
                style: const TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
  }

  Widget _bottomPanel(int count) {
    return Container(
      width: double.infinity,
      color: Colors.black54,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              IconButton(
                onPressed: () => _cycleLabel(-1),
                icon: const Icon(Icons.chevron_left, color: Colors.white, size: 36),
              ),
              Column(
                children: [
                  Text(_label,
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 48,
                          fontWeight: FontWeight.bold)),
                  Text('$count amostras desta letra',
                      style: const TextStyle(color: Colors.white70)),
                ],
              ),
              IconButton(
                onPressed: () => _cycleLabel(1),
                icon: const Icon(Icons.chevron_right, color: Colors.white, size: 36),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  onPressed: () => setState(() => _recording = !_recording),
                  style: FilledButton.styleFrom(
                    backgroundColor: _recording ? Colors.red : Colors.green,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                  icon: Icon(_recording ? Icons.stop : Icons.fiber_manual_record),
                  label: Text(_recording ? 'Parar' : 'Gravar'),
                ),
              ),
              const SizedBox(width: 12),
              IconButton.filledTonal(
                onPressed: _saving ? null : _export,
                icon: _saving
                    ? const SizedBox(
                        width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.ios_share),
                tooltip: 'Exportar JSONL',
              ),
              IconButton.filledTonal(
                onPressed: () {
                  _store.clear();
                  setState(() {});
                  _snack('Amostras limpas');
                },
                icon: const Icon(Icons.delete_outline),
                tooltip: 'Limpar',
              ),
            ],
          ),
          if (_recording)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text('Gravando... mantenha a configuracao da mao e varie um pouco o angulo',
                  style: TextStyle(color: Colors.amberAccent)),
            ),
        ],
      ),
    );
  }
}
