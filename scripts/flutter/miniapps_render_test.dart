import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:app_ui/app_ui.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rtu_mirea_app/l10n/l10n.dart';
import 'package:rtu_mirea_app/mini_apps/cubit/mini_app_runner_cubit.dart';
import 'package:rtu_mirea_app/mini_apps/view/mini_app_runner_body.dart';
import 'package:rtu_mirea_app/mini_apps/widgets/mini_app_scaffold.dart';
import 'package:stac_bridge/stac_bridge.dart';

void main() {
  const source = String.fromEnvironment(
    'MINIAPP_SCREEN_DIR',
    defaultValue: 'output/student-miniapps/artifacts/screens',
  );
  final screens =
      Directory(source)
          .listSync(recursive: true)
          .whereType<File>()
          .where((file) => file.path.endsWith('.json'))
          .toList()
        ..sort((a, b) => a.path.compareTo(b.path));
  if (screens.isEmpty) throw StateError('No screens to render');
  setUpAll(() async {
    final fonts = FontLoader(AppText.sansFamily);
    for (final weight in [
      'Regular',
      'Medium',
      'SemiBold',
      'Bold',
      'ExtraBold',
    ]) {
      fonts.addFont(
        rootBundle.load('packages/app_ui/assets/fonts/Onest/Onest-$weight.ttf'),
      );
    }
    final serif = FontLoader(AppText.serifFamily)
      ..addFont(
        rootBundle.load(
          'packages/app_ui/assets/fonts/Literata/Literata-Variable.ttf',
        ),
      )
      ..addFont(
        rootBundle.load(
          'packages/app_ui/assets/fonts/Literata/Literata-Italic-Variable.ttf',
        ),
      );
    await Future.wait([fonts.load(), serif.load()]);
    await StacBridge.ensureInitialized(
      StacBridgeConfig(
        proxyUrl: 'https://example.test/proxy',
        organizationId: 'mirea',
        onAccessTokenRequested: () async => null,
      ),
    );
  });
  for (final file in screens) {
    final name = file.uri.pathSegments.last.replaceAll('.json', '');
    final data = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
    for (final variant in [
      (width: 390.0, scale: 1.0, dark: false),
      (width: 390.0, scale: 1.0, dark: true),
      (width: 320.0, scale: 2.0, dark: false),
      (width: 900.0, scale: 1.0, dark: false),
    ]) {
      final label =
          '${name}_${variant.width.toInt()}_${variant.scale}_${variant.dark}';
      testWidgets(label, (tester) async {
        tester.view
          ..physicalSize = Size(variant.width, 900)
          ..devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        final boundary = GlobalKey();
        await tester.pumpWidget(
          MaterialApp(
            theme: variant.dark ? AppTheme.darkTheme : AppTheme.lightTheme,
            locale: const Locale('ru'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: TextScaler.linear(variant.scale)),
              child: NinjaToastHost(child: child!),
            ),
            home: RepaintBoundary(
              key: boundary,
              child: MiniAppScaffold(
                title: name.startsWith('discount')
                    ? 'Скидки студентам'
                    : 'Траектория обучения',
                body: MiniAppRunnerBody(
                  state: MiniAppRunnerState(status: .ready, screen: data),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        final render =
            boundary.currentContext!.findRenderObject()!
                as RenderRepaintBoundary;
        await tester.runAsync(() async {
          final image = await render.toImage();
          final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
          final output = File(
            'output/student-miniapps/artifacts/render/$label.png',
          );
          output.parent.createSync(recursive: true);
          output.writeAsBytesSync(bytes!.buffer.asUint8List());
          image.dispose();
        });
        if (name == 'learning_catalog') {
          expect(find.text('Год поступления'), findsNothing);
          await tester.tap(find.text('Фильтры').first);
          await tester.pumpAndSettle();
          expect(find.text('Год поступления'), findsOneWidget);
          expect(tester.takeException(), isNull);
        }
        for (final scrollable
            in tester
                .stateList<ScrollableState>(find.byType(Scrollable))
                .toList()) {
          if (scrollable.position.hasContentDimensions &&
              scrollable.position.maxScrollExtent > 0) {
            scrollable.position.jumpTo(scrollable.position.maxScrollExtent);
          }
        }
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });
    }
  }
}
