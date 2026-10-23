import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

/// Uma amostra de treino: vetor normalizado (63 floats) + rotulo + metadados.
/// Salvamos APENAS landmarks, nunca imagem (privacidade / SPEC 01).
class Sample {
  Sample({
    required this.label,
    required this.person,
    required this.hand,
    required this.vector,
    required this.ts,
  });

  final String label; // ex: "A"
  final String person; // id da pessoa, p/ split por pessoa (SPEC 01)
  final String hand; // "Left" | "Right" | "Unknown"
  final List<double> vector; // 63 doubles (21 x 3) ja normalizados
  final int ts; // epoch ms

  Map<String, dynamic> toJson() => {
        'label': label,
        'person': person,
        'hand': hand,
        'ts': ts,
        'v': vector,
      };
}

/// Acumula amostras em memoria e persiste como JSONL (uma amostra por linha),
/// formato direto de ler no treino em Python (S4). Permite exportar/compartilhar.
class SampleStore {
  final List<Sample> _samples = [];

  int get total => _samples.length;

  /// Contagem por rotulo (para o HUD mostrar progresso por letra).
  Map<String, int> countsByLabel() {
    final m = <String, int>{};
    for (final s in _samples) {
      m[s.label] = (m[s.label] ?? 0) + 1;
    }
    return m;
  }

  void add(Sample s) => _samples.add(s);

  void clear() => _samples.clear();

  Future<File> _file() async {
    final dir = await getApplicationDocumentsDirectory();
    return File('${dir.path}/librax_dataset.jsonl');
  }

  /// Grava (sobrescreve) todas as amostras em JSONL no diretorio do app.
  Future<File> save() async {
    final f = await _file();
    final sink = f.openWrite();
    for (final s in _samples) {
      sink.writeln(jsonEncode(s.toJson()));
    }
    await sink.flush();
    await sink.close();
    return f;
  }

  /// Salva e abre a folha de compartilhamento para tirar o arquivo do device.
  Future<void> export() async {
    final f = await save();
    await Share.shareXFiles([XFile(f.path)], text: 'Librax dataset (JSONL)');
  }
}
