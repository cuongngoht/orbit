import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

import 'models.dart';

abstract class TokenStorage {
  Future<String> getOrCreateDeviceId();
  Future<StoredSession> readSession();
  Future<void> saveSession({
    required String serverUrl,
    required String refreshToken,
    required String refreshExpiresAt,
    required MobileUser user,
    required MobileAccount account,
    String? accessToken,
  });
  Future<void> clearSession({bool clearAccessToken = false});
  Future<void> setBiometricEnabled(bool enabled);
}

class KeychainTokenStorage implements TokenStorage {
  KeychainTokenStorage({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              iOptions: IOSOptions(
                accessibility: KeychainAccessibility.first_unlock_this_device,
              ),
            );

  static const String _kDeviceId = 'orbit_mobile.device_id';
  static const String _kServerUrl = 'orbit_mobile.server_url';
  static const String _kRefreshToken = 'orbit_mobile.refresh_token';
  static const String _kRefreshExpiresAt = 'orbit_mobile.refresh_expires_at';
  static const String _kAccessToken = 'orbit_mobile.access_token';
  static const String _kUser = 'orbit_mobile.user';
  static const String _kAccount = 'orbit_mobile.account';
  static const String _kBiometricEnabled = 'orbit_mobile.biometric_enabled';

  final FlutterSecureStorage _storage;
  final Uuid _uuid = const Uuid();

  @override
  Future<String> getOrCreateDeviceId() async {
    final existing = await _storage.read(key: _kDeviceId);
    if (existing != null && existing.trim().isNotEmpty) {
      return existing.trim();
    }
    final generated = _uuid.v4();
    await _storage.write(key: _kDeviceId, value: generated);
    return generated;
  }

  @override
  Future<StoredSession> readSession() async {
    final deviceId = await getOrCreateDeviceId();
    final values = await Future.wait([
      _storage.read(key: _kServerUrl),
      _storage.read(key: _kRefreshToken),
      _storage.read(key: _kRefreshExpiresAt),
      _storage.read(key: _kAccessToken),
      _storage.read(key: _kUser),
      _storage.read(key: _kAccount),
      _storage.read(key: _kBiometricEnabled),
    ]);
    return StoredSession(
      deviceId: deviceId,
      serverUrl: values[0],
      refreshToken: values[1],
      refreshExpiresAt: values[2],
      accessToken: values[3],
      user: StoredSession.decodeUser(values[4]),
      account: StoredSession.decodeAccount(values[5]),
      biometricEnabled: values[6] == '1',
    );
  }

  @override
  Future<void> saveSession({
    required String serverUrl,
    required String refreshToken,
    required String refreshExpiresAt,
    required MobileUser user,
    required MobileAccount account,
    String? accessToken,
  }) async {
    await Future.wait([
      _storage.write(key: _kServerUrl, value: serverUrl),
      _storage.write(key: _kRefreshToken, value: refreshToken),
      _storage.write(key: _kRefreshExpiresAt, value: refreshExpiresAt),
      _storage.write(key: _kUser, value: jsonEncode(user.toJson())),
      _storage.write(key: _kAccount, value: jsonEncode(account.toJson())),
      if (accessToken != null && accessToken.trim().isNotEmpty)
        _storage.write(key: _kAccessToken, value: accessToken.trim())
      else
        _storage.delete(key: _kAccessToken),
    ]);
  }

  @override
  Future<void> clearSession({bool clearAccessToken = false}) async {
    await Future.wait([
      _storage.delete(key: _kRefreshToken),
      _storage.delete(key: _kRefreshExpiresAt),
      _storage.delete(key: _kUser),
      _storage.delete(key: _kAccount),
      if (clearAccessToken) _storage.delete(key: _kAccessToken),
    ]);
  }

  @override
  Future<void> setBiometricEnabled(bool enabled) {
    return _storage.write(key: _kBiometricEnabled, value: enabled ? '1' : '0');
  }
}
