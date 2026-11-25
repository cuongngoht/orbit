import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import 'app_config.dart';
import 'models.dart';

class AuthService {
  AuthService({
    http.Client? client,
    this.timeout = AppConfig.requestTimeout,
  }) : _client = client ?? http.Client();

  final http.Client _client;
  final Duration timeout;

  Future<MobileTokenGrant> login({
    required Uri serverOrigin,
    required String username,
    required String password,
    required String deviceId,
    String? deviceName,
    String? accessToken,
  }) async {
    final json = await _postJson(
      serverOrigin.resolve('/api/auth/mobile/login'),
      body: {
        'username': username.trim(),
        'password': password,
        'deviceId': deviceId,
        if (deviceName != null && deviceName.trim().isNotEmpty) 'deviceName': deviceName.trim(),
      },
      accessToken: accessToken,
    );
    return MobileTokenGrant.fromJson(json);
  }

  Future<MobileTokenGrant> refresh({
    required Uri serverOrigin,
    required String refreshToken,
    required String deviceId,
    String? accessToken,
  }) async {
    final json = await _postJson(
      serverOrigin.resolve('/api/auth/mobile/refresh'),
      body: {
        'refreshToken': refreshToken,
        'deviceId': deviceId,
      },
      accessToken: accessToken,
    );
    return MobileTokenGrant.fromJson(json);
  }

  Future<void> logout({
    required Uri serverOrigin,
    required String refreshToken,
    required String deviceId,
    String? accessToken,
  }) async {
    await _postJson(
      serverOrigin.resolve('/api/auth/mobile/logout'),
      body: {
        'refreshToken': refreshToken,
        'deviceId': deviceId,
      },
      accessToken: accessToken,
    );
  }

  Future<Map<String, dynamic>> _postJson(
    Uri url, {
    required Map<String, dynamic> body,
    String? accessToken,
  }) async {
    final headers = <String, String>{
      'accept': 'application/json',
      'content-type': 'application/json',
      'x-orbit-web': '1',
      'user-agent': AppConfig.userAgentSuffix,
      if (accessToken != null && accessToken.trim().isNotEmpty)
        'authorization': 'Bearer ${accessToken.trim()}',
    };

    late http.Response response;
    try {
      response = await _client
          .post(url, headers: headers, body: jsonEncode(body))
          .timeout(timeout);
    } on TimeoutException {
      throw const AuthApiException(
        statusCode: 0,
        code: 'network_timeout',
        message: 'Hết thời gian kết nối đến máy chủ. Vui lòng thử lại.',
        isNetworkError: true,
      );
    } on SocketException {
      throw const AuthApiException(
        statusCode: 0,
        code: 'network_error',
        message: 'Không thể kết nối đến máy chủ. Kiểm tra mạng hoặc địa chỉ máy chủ.',
        isNetworkError: true,
      );
    } on http.ClientException catch (err) {
      throw AuthApiException(
        statusCode: 0,
        code: 'network_error',
        message: 'Lỗi kết nối: ${err.message}',
        isNetworkError: true,
      );
    }

    Map<String, dynamic>? decoded;
    if (response.body.trim().isNotEmpty) {
      try {
        final raw = jsonDecode(response.body);
        if (raw is Map<String, dynamic>) decoded = raw;
      } catch (_) {
        decoded = null;
      }
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return decoded ?? <String, dynamic>{};
    }

    final errObj = decoded?['error'];
    final code = errObj is Map<String, dynamic> ? (errObj['code'] as String? ?? 'error') : 'error';
    final serverMessage = errObj is Map<String, dynamic>
        ? (errObj['message'] as String? ?? 'HTTP ${response.statusCode}')
        : 'HTTP ${response.statusCode}';
    final retryHeader = response.headers['retry-after'];
    final retrySeconds = retryHeader != null ? int.tryParse(retryHeader) : null;

    throw AuthApiException(
      statusCode: response.statusCode,
      code: code,
      message: _localizedMessage(code, serverMessage, retrySeconds),
      retryAfterSeconds: retrySeconds,
    );
  }

  String _localizedMessage(String code, String fallback, int? retrySeconds) {
    switch (code) {
      case 'invalid_credentials':
        return 'Tên đăng nhập hoặc mật khẩu không đúng.';
      case 'too_many_attempts':
        if (retrySeconds != null && retrySeconds > 0) {
          return 'Thử đăng nhập quá nhiều lần. Vui lòng thử lại sau ${retrySeconds}s.';
        }
        return 'Thử đăng nhập quá nhiều lần. Vui lòng đợi một lát.';
      case 'access_token_required':
      case 'access_token_invalid':
        return 'Máy chủ yêu cầu Access Token hợp lệ để truy cập.';
      case 'mobile_refresh_invalid':
        return 'Phiên đăng nhập đã hết hạn hoặc bị thu hồi. Vui lòng đăng nhập lại.';
      case 'setup_required':
        return 'Máy chủ chưa hoàn tất thiết lập quản trị viên ban đầu.';
      default:
        return fallback;
    }
  }
}
