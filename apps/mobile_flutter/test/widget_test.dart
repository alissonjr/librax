import 'package:flutter_test/flutter_test.dart';
import 'package:librax/app.dart';

void main() {
  testWidgets('App inicializa sem erros', (WidgetTester tester) async {
    await tester.pumpWidget(const LibraxApp());
    expect(find.text('Librax'), findsOneWidget);
  });
}
