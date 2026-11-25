import 'package:flutter/foundation.dart';

import '../core/app_config.dart';
import '../core/auth_service.dart';
import '../core/biometric_service.dart';
import '../core/models.dart';
import '../core/origin_policy.dart';
import '../core/token_storage.dart';

enum AppStage {
  splash,
  locked,
  unauthenticated,
  authenticated,
}

typedef WebViewClearCallback = Future<void> Function();

class AppController extends ChangeNotifier {
  AppController({
    required this._authService,
    required this._storage,
    required this._biometricService,
    String? defaultServerUrl,
  }) : _defaultServerUrl = defaultServerUrl ?? AppConfig.defaultServerUrl;

  final AuthService _authService;
  final TokenStorage _storage;
  final BiometricService _biometricService;
  final String _defaultServerUrl;

  AppStage _stage = AppStage.splash;
  Uri? _serverOrigin;
  String? _accessToken;
  MobileUser? _user;
  MobileAccount? _account;
  bool _biometricEnabled = false;
  bool _biometricAvailable = false;
  bool _unlockBusy = false;
  String? _noticeMessage;
  MobileBootstrapPayload? _pendingBootstrap;
  Future<MobileBootstrapPayload?>? _inflightRefresh;
  WebViewClearCallback? _clearWebViewData;

  AppStage get stage => _stage;
  Uri? get serverOrigin => _serverOrigin;
  String? get savedAccessToken => _accessToken;
  MobileUser? get user => _user;
  MobileAccount? get account => _account;
  bool get biometricEnabled => _biometricEnabled;
  bool get biometricAvailable => _biometricAvailable;
  bool get unlockBusy => _unlockBusy;
  String? get noticeMessage => _noticeMessage;
  String get initialServerText {
    if (_serverOrigin != null) return _serverOrigin.toString();
    if (_defaultServerUrl.trim().isNotEmpty) return _defaultServerUrl.trim();
    return '';
  }

  void registerWebViewClearCallback(WebViewClearCallback? cb) {
    _clearWebViewData = cb;
  }

  void clearNotice() {
    if (_noticeMessage == null) return;
    _noticeMessage = null;
    notifyListeners();
  }

  Future<void> initialize() async {
    _stage = AppStage.splash;
    notifyListeners();

    final stored = await _storage.readSession();
    _biometricAvailable = await _biometricService.isAvailable();
    _biometricEnabled = stored.biometricEnabled;
    _accessToken = stored.accessToken;
    _user = stored.user;
    _account = stored.account;
    _serverOrigin = _parseOptionalOrigin(stored.serverUrl) ?? _parseOptionalOrigin(_defaultServerUrl);

    if (stored.refreshToken == null || stored.refreshToken!.isEmpty || _serverOrigin == null) {
      _stage = AppStage.unauthenticated;
      notifyListeners();
      return;
    }

    if (_biometricEnabled && _biometricAvailable) {
      _stage = AppStage.locked;
      notifyListeners();
      await unlockWithBiometrics();
      return;
    }

    await _resumeFromSavedToken();
  }

  Future<bool> unlockWithBiometrics() async {
    if (_unlockBusy) return false;
    _unlockBusy = true;
    notifyListeners();
    try {
      final ok = await _biometricService.authenticate(
        localizedReason: 'Xác thực để mở khóa Orbit',
      );
      if (!ok) {
        _unlockBusy = false;
        notifyListeners();
        return false;
      }
      _unlockBusy = false;
      await _resumeFromSavedToken();
      return _stage == AppStage.authenticated;
    } catch (_) {
      _unlockBusy = false;
      notifyListeners();
      return false;
    }
  }

  Future<void> _resumeFromSavedToken() async {
    final stored = await _storage.readSession();
    final origin = _serverOrigin ?? _parseOptionalOrigin(stored.serverUrl);
    if (origin == null || stored.refreshToken == null || stored.refreshToken!.isEmpty) {
      _stage = AppStage.unauthenticated;
      notifyListeners();
      return;
    }
    try {
      final grant = await _authService.refresh(
        serverOrigin: origin,
        refreshToken: stored.refreshToken!,
        deviceId: stored.deviceId,
        accessToken: stored.accessToken,
      );
      await _storage.saveSession(
        serverUrl: origin.toString(),
        refreshToken: grant.refreshToken,
        refreshExpiresAt: grant.refreshExpiresAt,
        user: grant.user,
        account: grant.account,
        accessToken: stored.accessToken,
      );
      _serverOrigin = origin;
      _user = grant.user;
      _account = grant.account;
      _pendingBootstrap = MobileBootstrapPayload(
        exchangeCode: grant.exchangeCode,
        accessToken: stored.accessToken,
      );
      _noticeMessage = null;
      _stage = AppStage.authenticated;
      notifyListeners();
    } on AuthApiException catch (err) {
      if (err.isAuthRejected) {
        await _expireSession(err.message);
        return;
      }
      // Network offline on launch: enter authenticated shell if we know the origin;
      // WebView offline bar & onAuthExpired will seamlessly recover once online.
      _serverOrigin = origin;
      _pendingBootstrap = null;
      _stage = AppStage.authenticated;
      notifyListeners();
    }
  }

  Future<void> signIn({
    required String serverUrl,
    required String username,
    required String password,
    String? accessToken,
    String? deviceName,
  }) async {
    final origin = normalizeServerUri(serverUrl);
    final deviceId = await _storage.getOrCreateDeviceId();
    final cleanAccess = accessToken != null && accessToken.trim().isNotEmpty ? accessToken.trim() : null;
    final grant = await _authService.login(
      serverOrigin: origin,
      username: username,
      password: password,
      deviceId: deviceId,
      deviceName: deviceName,
      accessToken: cleanAccess,
    );
    await _storage.saveSession(
      serverUrl: origin.toString(),
      refreshToken: grant.refreshToken,
      refreshExpiresAt: grant.refreshExpiresAt,
      user: grant.user,
      account: grant.account,
      accessToken: cleanAccess,
    );
    _serverOrigin = origin;
    _accessToken = cleanAccess;
    _user = grant.user;
    _account = grant.account;
    _noticeMessage = null;
    _pendingBootstrap = MobileBootstrapPayload(
      exchangeCode: grant.exchangeCode,
      accessToken: cleanAccess,
    );
    _stage = AppStage.authenticated;
    notifyListeners();
  }

  /// Single-pull bootstrap payload consumed once by the embedded WebView.
  MobileBootstrapPayload? popBootstrap() {
    final next = _pendingBootstrap;
    _pendingBootstrap = null;
    return next;
  }

  /// Single-flight silent refresh invoked when the WebView sees 401/signed_out.
  Future<MobileBootstrapPayload?> handleAuthExpired() {
    final inflight = _inflightRefresh;
    if (inflight != null) return inflight;
    final future = _performRefresh().whenComplete(() {
      _inflightRefresh = null;
    });
    _inflightRefresh = future;
    return future;
  }

  Future<MobileBootstrapPayload?> _performRefresh() async {
    final stored = await _storage.readSession();
    final origin = _serverOrigin ?? _parseOptionalOrigin(stored.serverUrl);
    if (origin == null || stored.refreshToken == null || stored.refreshToken!.isEmpty) {
      await _expireSession('Phiên đăng nhập đã kết thúc. Vui lòng đăng nhập lại.');
      return null;
    }
    try {
      final grant = await _authService.refresh(
        serverOrigin: origin,
        refreshToken: stored.refreshToken!,
        deviceId: stored.deviceId,
        accessToken: stored.accessToken,
      );
      await _storage.saveSession(
        serverUrl: origin.toString(),
        refreshToken: grant.refreshToken,
        refreshExpiresAt: grant.refreshExpiresAt,
        user: grant.user,
        account: grant.account,
        accessToken: stored.accessToken,
      );
      _user = grant.user;
      _account = grant.account;
      notifyListeners();
      return MobileBootstrapPayload(
        exchangeCode: grant.exchangeCode,
        accessToken: stored.accessToken,
      );
    } on AuthApiException catch (err) {
      if (err.isAuthRejected) {
        await _expireSession(err.message);
      }
      return null;
    }
  }

  Future<bool> setBiometricEnabled(bool enabled) async {
    if (enabled) {
      if (!_biometricAvailable) return false;
      final ok = await _biometricService.authenticate(
        localizedReason: 'Xác nhận bật khóa bảo mật cho Orbit',
      );
      if (!ok) return false;
    }
    _biometricEnabled = enabled;
    await _storage.setBiometricEnabled(enabled);
    notifyListeners();
    return true;
  }

  Future<void> signOut({bool serverAlreadySignedOut = false}) async {
    final stored = await _storage.readSession();
    final origin = _serverOrigin ?? _parseOptionalOrigin(stored.serverUrl);
    if (!serverAlreadySignedOut && origin != null && stored.refreshToken != null && stored.refreshToken!.isNotEmpty) {
      try {
        await _authService.logout(
          serverOrigin: origin,
          refreshToken: stored.refreshToken!,
          deviceId: stored.deviceId,
          accessToken: stored.accessToken,
        );
      } catch (_) {
        // Always complete local cleanup even if offline.
      }
    }
    _pendingBootstrap = null;
    _user = null;
    _account = null;
    _noticeMessage = null;
    await _storage.clearSession();
    await _runWebViewCleanup();
    _stage = AppStage.unauthenticated;
    notifyListeners();
  }

  Future<void> _expireSession(String message) async {
    _pendingBootstrap = null;
    _user = null;
    _account = null;
    _noticeMessage = message;
    await _storage.clearSession();
    await _runWebViewCleanup();
    _stage = AppStage.unauthenticated;
    notifyListeners();
  }

  Future<void> _runWebViewCleanup() async {
    final cb = _clearWebViewData;
    if (cb == null) return;
    try {
      await cb();
    } catch (_) {
      // Never block sign-out if WebView controller is already disposed.
    }
  }

  Uri? _parseOptionalOrigin(String? raw) {
    if (raw == null || raw.trim().isEmpty) return null;
    try {
      return normalizeServerUri(raw);
    } catch (_) {
      return null;
    }
  }
}
