import 'dart:convert';

class MobileUser {
  const MobileUser({
    required this.id,
    required this.username,
    required this.fullName,
    required this.email,
    required this.shareAddress,
    required this.mustChangePassword,
  });

  final String id;
  final String username;
  final String fullName;
  final String? email;
  final String shareAddress;
  final bool mustChangePassword;

  factory MobileUser.fromJson(Map<String, dynamic> json) {
    return MobileUser(
      id: json['id'] as String,
      username: json['username'] as String,
      fullName: json['fullName'] as String,
      email: json['email'] as String?,
      shareAddress: json['shareAddress'] as String,
      mustChangePassword: json['mustChangePassword'] == true,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'username': username,
        'fullName': fullName,
        'email': email,
        'shareAddress': shareAddress,
        'mustChangePassword': mustChangePassword,
      };
}

class MobileAccount {
  const MobileAccount({
    required this.orbitId,
    required this.displayName,
    required this.companyName,
  });

  final String orbitId;
  final String displayName;
  final String companyName;

  factory MobileAccount.fromJson(Map<String, dynamic> json) {
    return MobileAccount(
      orbitId: json['orbitId'] as String,
      displayName: (json['displayName'] as String?) ?? '',
      companyName: (json['companyName'] as String?) ?? '',
    );
  }

  Map<String, dynamic> toJson() => {
        'orbitId': orbitId,
        'displayName': displayName,
        'companyName': companyName,
      };

  String get label => companyName.trim().isNotEmpty ? companyName : displayName;
}

class MobileTokenGrant {
  const MobileTokenGrant({
    required this.refreshToken,
    required this.refreshExpiresAt,
    required this.exchangeCode,
    required this.exchangeExpiresAt,
    required this.user,
    required this.account,
  });

  final String refreshToken;
  final String refreshExpiresAt;
  final String exchangeCode;
  final String exchangeExpiresAt;
  final MobileUser user;
  final MobileAccount account;

  factory MobileTokenGrant.fromJson(Map<String, dynamic> json) {
    return MobileTokenGrant(
      refreshToken: json['refreshToken'] as String,
      refreshExpiresAt: json['refreshExpiresAt'] as String,
      exchangeCode: json['exchangeCode'] as String,
      exchangeExpiresAt: json['exchangeExpiresAt'] as String,
      user: MobileUser.fromJson(json['user'] as Map<String, dynamic>),
      account: MobileAccount.fromJson(json['account'] as Map<String, dynamic>),
    );
  }
}

class MobileBootstrapPayload {
  const MobileBootstrapPayload({
    required this.exchangeCode,
    this.accessToken,
  });

  final String exchangeCode;
  final String? accessToken;

  Map<String, dynamic> toJson() => {
        'exchangeCode': exchangeCode,
        if (accessToken != null && accessToken!.isNotEmpty) 'accessToken': accessToken,
      };
}

class StoredSession {
  const StoredSession({
    required this.deviceId,
    this.serverUrl,
    this.refreshToken,
    this.refreshExpiresAt,
    this.accessToken,
    this.user,
    this.account,
    this.biometricEnabled = false,
  });

  final String deviceId;
  final String? serverUrl;
  final String? refreshToken;
  final String? refreshExpiresAt;
  final String? accessToken;
  final MobileUser? user;
  final MobileAccount? account;
  final bool biometricEnabled;

  static MobileUser? decodeUser(String? raw) {
    if (raw == null || raw.isEmpty) return null;
    try {
      return MobileUser.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }

  static MobileAccount? decodeAccount(String? raw) {
    if (raw == null || raw.isEmpty) return null;
    try {
      return MobileAccount.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }
}

class AuthApiException implements Exception {
  const AuthApiException({
    required this.statusCode,
    required this.code,
    required this.message,
    this.retryAfterSeconds,
    this.isNetworkError = false,
  });

  final int statusCode;
  final String code;
  final String message;
  final int? retryAfterSeconds;
  final bool isNetworkError;

  bool get isAccessTokenRequired => code == 'access_token_required' || code == 'access_token_invalid';
  bool get isInvalidRefresh => code == 'mobile_refresh_invalid';
  bool get isAuthRejected => statusCode == 401 || statusCode == 403;

  @override
  String toString() => 'AuthApiException($statusCode, $code): $message';
}
