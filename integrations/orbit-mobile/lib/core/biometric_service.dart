import 'package:flutter/services.dart';
import 'package:local_auth/local_auth.dart';

abstract class BiometricService {
  Future<bool> isAvailable();
  Future<bool> authenticate({required String localizedReason});
}

class LocalAuthBiometricService implements BiometricService {
  LocalAuthBiometricService({LocalAuthentication? auth}) : _auth = auth ?? LocalAuthentication();

  final LocalAuthentication _auth;

  @override
  Future<bool> isAvailable() async {
    try {
      return await _auth.isDeviceSupported();
    } on PlatformException {
      return false;
    } on LocalAuthException {
      return false;
    }
  }

  @override
  Future<bool> authenticate({required String localizedReason}) async {
    try {
      return await _auth.authenticate(
        localizedReason: localizedReason,
        biometricOnly: false,
        persistAcrossBackgrounding: true,
      );
    } on PlatformException {
      return false;
    } on LocalAuthException {
      return false;
    }
  }
}
