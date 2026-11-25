import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:orbit_mobile/core/auth_service.dart';
import 'package:orbit_mobile/core/models.dart';

Map<String, dynamic> _grantJson({String refresh = 'r1', String code = 'c1'}) => {
      'refreshToken': refresh,
      'refreshExpiresAt': '2026-12-25T00:00:00.000Z',
      'exchangeCode': code,
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
    };

void main() {
  group('AuthService', () {
    test('sends X-Orbit-Web and optional Bearer access token on login', () async {
      late http.Request captured;
      final client = MockClient((req) async {
        captured = req;
        return http.Response(jsonEncode(_grantJson()), 200);
      });
      final service = AuthService(client: client);
      final grant = await service.login(
        serverOrigin: Uri.parse('https://orbit.example.com'),
        username: ' octo ',
        password: 'secret-password',
        deviceId: 'dev-1',
        deviceName: 'iPhone',
        accessToken: 'acc-token-123',
      );

      expect(captured.url.toString(), 'https://orbit.example.com/api/auth/mobile/login');
      expect(captured.headers['x-orbit-web'], '1');
      expect(captured.headers['authorization'], 'Bearer acc-token-123');
      expect(jsonDecode(captured.body), {
        'username': 'octo',
        'password': 'secret-password',
        'deviceId': 'dev-1',
        'deviceName': 'iPhone',
      });
      expect(grant.refreshToken, 'r1');
      expect(grant.exchangeCode, 'c1');
    });

    test('parses API errors and Retry-After headers', () async {
      final client = MockClient((_) async {
        return http.Response(
          jsonEncode({
            'error': {'code': 'too_many_attempts', 'message': 'Slow down'},
          }),
          429,
          headers: {'retry-after': '45'},
        );
      });
      final service = AuthService(client: client);
      await expectLater(
        service.login(
          serverOrigin: Uri.parse('https://orbit.example.com'),
          username: 'octo',
          password: 'bad',
          deviceId: 'dev-1',
        ),
        throwsA(
          isA<AuthApiException>()
              .having((e) => e.statusCode, 'statusCode', 429)
              .having((e) => e.code, 'code', 'too_many_attempts')
              .having((e) => e.retryAfterSeconds, 'retryAfterSeconds', 45)
              .having((e) => e.message, 'message', contains('45s')),
        ),
      );
    });
  });
}
