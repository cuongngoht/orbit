class AppConfig {
  const AppConfig._();

  /// Optional default server URL baked in at build time via:
  /// `--dart-define=ORBIT_WEB_URL=https://...`
  static const String defaultServerUrl = String.fromEnvironment('ORBIT_WEB_URL');

  static const String userAgentSuffix = 'OrbitMobileIOS/1.0';
  static const Duration requestTimeout = Duration(seconds: 20);
}
