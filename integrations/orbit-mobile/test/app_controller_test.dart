import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:orbit_mobile/core/auth_service.dart';
import 'package:orbit_mobile/core/biometric_service.dart';
import 'package:orbit_mobile/core/models.dart';
import 'package:orbit_mobile/core/token_storage.dart';
import 'package:orbit_mobile/state/app_controller.dart';

class InMemoryTokenStorage implements TokenStorage {
  String deviceId = 'test-device-uuid';
  String? serverUrl;
  String? refreshToken;
  String? refreshExpiresAt;
  String? accessToken;
  MobileUser? user;
  MobileAccount? account;
  bool biometricEnabled = false;
  int clearCount = 0;

  @override
  Future<String> getOrCreateDeviceId() async => deviceId;

  @override
  Future<StoredSession> readSession() async => StoredSession(
        deviceId: deviceId,
        serverUrl: serverUrl,
        refreshToken: refreshToken,
        refreshExpiresAt: refreshExpiresAt,
        accessToken: accessToken,
        user: user,
        account: account,
        biometricEnabled: biometricEnabled,
      );

  @override
  Future<void> saveSession({
    required String serverUrl,
    required String refreshToken,
    required String refreshExpiresAt,
    required MobileUser user,
    required MobileAccount account,
    String? accessToken,
  }) async {
    this.serverUrl = serverUrl;
    this.refreshToken = refreshToken;
    this.refreshExpiresAt = refreshExpiresAt;
    this.user = user;
    this.account = account;
    this.accessToken = accessToken;
  }

  @override
  Future<void> clearSession({bool clearAccessToken = false}) async {
    clearCount += 1;
    refreshToken = null;
    refreshExpiresAt = null;
    user = null;
    account = null;
    if (clearAccessToken) accessToken = null;
  }

  @override
  Future<void> setBiometricEnabled(bool enabled) async {
    biometricEnabled = enabled;
  }
}

class FakeBiometricService implements BiometricService {
  FakeBiometricService({this.available = true, this.result = true});

  bool available;
  bool result;
  int calls = 0;

  @override
  Future<bool> isAvailable() async => available;

  @override
  Future<bool> authenticate({required String localizedReason}) async {
    calls += 1;
    return result;
  }
}

Map<String, dynamic> _grantJson({required String refresh, required String code}) => {
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
  group('AppController', () {
    test('signIn saves refresh token, exposes single-pull bootstrap, and signs out cleanly', () async {
      var webViewWiped = 0;
      var loggedOutOnServer = 0;
      final client = MockClient((req) async {
        if (req.url.path == '/api/auth/mobile/login') {
          return http.Response(jsonEncode(_grantJson(refresh: 'ref-1', code: 'exch-1')), 200);
        }
        if (req.url.path == '/api/auth/mobile/logout') {
          loggedOutOnServer += 1;
          return http.Response(jsonEncode({'ok': true}), 200);
        }
        return http.Response('not found', 404);
      });
      final storage = InMemoryTokenStorage();
      final controller = AppController(
        authService: AuthService(client: client),
        storage: storage,
        biometricService: FakeBiometricService(),
      );
      controller.registerWebViewClearCallback(() async {
        webViewWiped += 1;
      });

      await controller.initialize();
      expect(controller.stage, AppStage.unauthenticated);

      await controller.signIn(
        serverUrl: 'orbit.example.com',
        username: 'octo',
        password: 'correct horse battery staple',
        accessToken: 'acc-1',
      );

      expect(controller.stage, AppStage.authenticated);
      expect(storage.refreshToken, 'ref-1');
      final firstPull = controller.popBootstrap();
      expect(firstPull?.exchangeCode, 'exch-1');
      expect(firstPull?.accessToken, 'acc-1');
      expect(controller.popBootstrap(), isNull);

      await controller.signOut();
      expect(loggedOutOnServer, 1);
      expect(webViewWiped, 1);
      expect(storage.refreshToken, isNull);
      expect(controller.stage, AppStage.unauthenticated);
    });

    test('concurrent handleAuthExpired deduplicates refresh calls into one rotation', () async {
      var refreshCalls = 0;
      final gate = Completer<void>();
      final client = MockClient((req) async {
        if (req.url.path == '/api/auth/mobile/refresh') {
          refreshCalls += 1;
          await gate.future;
          return http.Response(jsonEncode(_grantJson(refresh: 'ref-2', code: 'exch-2')), 200);
        }
        return http.Response('not found', 404);
      });
      final storage = InMemoryTokenStorage()
        ..serverUrl = 'https://orbit.example.com'
        ..refreshToken = 'ref-1';
      final controller = AppController(
        authService: AuthService(client: client),
        storage: storage,
        biometricService: FakeBiometricService(),
      );

      final f1 = controller.handleAuthExpired();
      final f2 = controller.handleAuthExpired();
      gate.complete();
      final results = await Future.wait([f1, f2]);

      expect(refreshCalls, 1);
      expect(results[0]?.exchangeCode, 'exch-2');
      expect(results[1]?.exchangeCode, 'exch-2');
      expect(storage.refreshToken, 'ref-2');
    });

    test('401 on refresh wipes Keychain and WebView and moves to unauthenticated', () async {
      var webViewWiped = 0;
      final client = MockClient((_) async {
        return http.Response(
          jsonEncode({
            'error': {'code': 'mobile_refresh_invalid', 'message': 'Expired'},
          }),
          401,
        );
      });
      final storage = InMemoryTokenStorage()
        ..serverUrl = 'https://orbit.example.com'
        ..refreshToken = 'revoked-token';
      final controller = AppController(
        authService: AuthService(client: client),
        storage: storage,
        biometricService: FakeBiometricService(),
      );
      controller.registerWebViewClearCallback(() async {
        webViewWiped += 1;
      });

      await controller.initialize();
      expect(controller.stage, AppStage.unauthenticated);
      expect(storage.refreshToken, isNull);
      expect(webViewWiped, 1);
      expect(controller.noticeMessage, isNotNull);
    });

    test('biometric lock gates resume until unlocked', () async {
      final client = MockClient((_) async {
        return http.Response(jsonEncode(_grantJson(refresh: 'ref-bio', code: 'exch-bio')), 200);
      });
      final storage = InMemoryTokenStorage()
        ..serverUrl = 'https://orbit.example.com'
        ..refreshToken = 'ref-1'
        ..biometricEnabled = true;
      final bio = FakeBiometricService(available: true, result: false);
      final controller = AppController(
        authService: AuthService(client: client),
        storage: storage,
        biometricService: bio,
      );

      await controller.initialize();
      expect(controller.stage, AppStage.locked);
      expect(bio.calls, 1);

      bio.result = true;
      final ok = await controller.unlockWithBiometrics();
      expect(ok, isTrue);
      expect(controller.stage, AppStage.authenticated);
      expect(controller.popBootstrap()?.exchangeCode, 'exch-bio');
    });
  });
}
