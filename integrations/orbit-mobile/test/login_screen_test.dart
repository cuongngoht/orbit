import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:orbit_mobile/core/auth_service.dart';
import 'package:orbit_mobile/screens/login_screen.dart';
import 'package:orbit_mobile/state/app_controller.dart';

import 'app_controller_test.dart';

void main() {
  testWidgets('LoginScreen validates input, reveals Access Token on 401, and signs in', (tester) async {
    var calls = 0;
    final client = MockClient((req) async {
      calls += 1;
      final body = jsonDecode(req.body) as Map<String, dynamic>;
      if (calls == 1) {
        return http.Response(
          jsonEncode({
            'error': {'code': 'access_token_required', 'message': 'Needs access token'},
          }),
          401,
        );
      }
      expect(req.headers['authorization'], 'Bearer secret-access-token');
      expect(body['username'], 'octo');
      return http.Response(
        jsonEncode({
          'refreshToken': 'ref-ok',
          'refreshExpiresAt': '2026-12-25T00:00:00.000Z',
          'exchangeCode': 'exch-ok',
          'exchangeExpiresAt': '2026-11-25T16:00:30.000Z',
          'user': {
            'id': 'u1',
            'username': 'octo',
            'fullName': 'Octo Cat',
            'email': 'octo@example.com',
            'shareAddress': 'octo@example.com',
            'mustChangePassword': false,
          },
          'account': {
            'orbitId': 'a1',
            'displayName': 'Octo',
            'companyName': 'Octo Co',
          },
        }),
        200,
      );
    });

    final storage = InMemoryTokenStorage();
    final controller = AppController(
      authService: AuthService(client: client),
      storage: storage,
      biometricService: FakeBiometricService(),
      defaultServerUrl: 'https://orbit.example.com',
    );
    await controller.initialize();

    await tester.pumpWidget(MaterialApp(home: LoginScreen(controller: controller)));
    expect(find.text('https://orbit.example.com'), findsOneWidget);

    await tester.enterText(find.widgetWithText(TextFormField, 'Tên đăng nhập hoặc Email'), 'octo');
    await tester.enterText(find.widgetWithText(TextFormField, 'Mật khẩu'), 'correct horse battery staple');
    await tester.tap(find.widgetWithText(FilledButton, 'Đăng nhập'));
    await tester.pumpAndSettle();

    // 401 access_token_required reveals the optional Access Token field automatically.
    expect(find.widgetWithText(TextFormField, 'Access Token (tùy chọn)'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextFormField, 'Access Token (tùy chọn)'), 'secret-access-token');
    final submitButton = find.widgetWithText(FilledButton, 'Đăng nhập');
    await tester.ensureVisible(submitButton);
    await tester.pumpAndSettle();
    await tester.tap(submitButton);
    await tester.pumpAndSettle();

    expect(controller.stage, AppStage.authenticated);
    expect(storage.refreshToken, 'ref-ok');
    expect(storage.accessToken, 'secret-access-token');
  });
}
