import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:app_ui/app_ui.dart';
import 'package:flutter/material.dart';
import 'package:flutter/painting.dart';
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
  final media = Directory('output/student-miniapps/discounts/media');
  final assets = <String, List<int>>{
    if (media.existsSync())
      for (final file in media.listSync().whereType<File>())
        if (RegExp(r'\.(png|webp|jpe?g)$').hasMatch(file.path))
          file.uri.pathSegments.last: file.readAsBytesSync(),
  };
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
        debugNetworkImageHttpClientProvider = () => _ImageClient(assets);
        try {
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
          await tester.runAsync(() async {
            final context = boundary.currentContext!;
            await Future.wait([
              for (final widget in tester.widgetList<Image>(find.byType(Image)))
                precacheImage(widget.image, context),
            ]);
          });
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          final render =
              boundary.currentContext!.findRenderObject()!
                  as RenderRepaintBoundary;
          await tester.runAsync(() async {
            final image = await render.toImage();
            final bytes = await image.toByteData(
              format: ui.ImageByteFormat.png,
            );
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
          if (name == 'discounts-home') {
            expect(
              tester
                  .widgetList<RawImage>(find.byType(RawImage))
                  .where((image) => image.image != null),
              isNotEmpty,
            );
            await _tapVisible(tester, 'Фильтры');
            expect(find.text('Где действует'), findsOneWidget);
          }
          if (name == 'discounts-reminder-selected') {
            expect(find.textContaining('07.09.2026'), findsOneWidget);
            expect(find.textContaining('18:30'), findsOneWidget);
          }
          if (name == 'discounts-suggest') {
            await _tapVisible(tester, 'Далее');
            expect(
              find.text('Заполните поле «Место или сервис»'),
              findsOneWidget,
            );
            expect(find.text('Регион'), findsNothing);
            for (final entry in {
              'provider': 'Кафе у университета',
              'benefit': 'Скидка 20% студентам',
              'title': 'Обед по студенческому',
              'description': 'Скидка действует на блюда основного меню.',
            }.entries) {
              await _fillField(tester, entry.key, entry.value);
            }
            await _tapVisible(tester, 'Далее');
            expect(find.text('Регион'), findsOneWidget);
            for (final entry in {
              'geography': 'Москва, рядом с университетом',
              'eligibility': 'Нужен действующий студенческий билет.',
              'instructions': 'Покажите студенческий перед оплатой.',
            }.entries) {
              await _fillField(tester, entry.key, entry.value);
            }
            await _tapVisible(tester, 'Далее');
            expect(find.text('Ссылка на условия'), findsOneWidget);
            await _tapVisible(tester, 'Назад');
            expect(find.text('Регион'), findsOneWidget);
            await _tapVisible(tester, 'Назад');
            final provider = find.descendant(
              of: find.byKey(const ValueKey('input:provider')),
              matching: find.byType(TextField),
            );
            expect(
              tester.widget<TextField>(provider).controller!.text,
              'Кафе у университета',
            );
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
        } finally {
          debugNetworkImageHttpClientProvider = null;
        }
      });
    }
  }
}

Future<void> _tapVisible(WidgetTester tester, String label) async {
  final target = find.text(label).first;
  await tester.ensureVisible(target);
  await tester.tap(target);
  await tester.pumpAndSettle();
}

Future<void> _fillField(WidgetTester tester, String id, String value) async {
  final field = find.descendant(
    of: find.byKey(ValueKey('input:$id')),
    matching: find.byType(TextField),
  );
  await tester.ensureVisible(field);
  await tester.enterText(field, value);
  await tester.pumpAndSettle();
}

class _ImageClient extends Fake implements HttpClient {
  _ImageClient(this.assets);
  final Map<String, List<int>> assets;

  @override
  Future<HttpClientRequest> getUrl(Uri url) async {
    final trusted =
        url.host == 'raw.githubusercontent.com' &&
        url.path.contains('/0niel/mirea-miniapps-demo/') &&
        url.path.contains('/discounts/media/');
    return _ImageRequest(trusted ? assets[url.pathSegments.last] : null);
  }
}

class _ImageRequest extends Fake implements HttpClientRequest {
  _ImageRequest(this.bytes);
  final List<int>? bytes;

  @override
  Future<HttpClientResponse> close() async => _ImageResponse(bytes);
}

class _ImageResponse extends Stream<List<int>> implements HttpClientResponse {
  _ImageResponse(this.bytes);
  final List<int>? bytes;

  @override
  int get statusCode => bytes == null ? 404 : 200;

  @override
  int get contentLength => bytes?.length ?? 0;

  @override
  HttpClientResponseCompressionState get compressionState =>
      HttpClientResponseCompressionState.notCompressed;

  @override
  StreamSubscription<List<int>> listen(
    void Function(List<int>)? onData, {
    Function? onError,
    void Function()? onDone,
    bool? cancelOnError,
  }) => Stream<List<int>>.value(bytes ?? []).listen(
    onData,
    onError: onError,
    onDone: onDone,
    cancelOnError: cancelOnError,
  );

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
