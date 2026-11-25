import 'package:flutter/material.dart';

import 'core/auth_service.dart';
import 'core/biometric_service.dart';
import 'core/token_storage.dart';
import 'screens/chat_webview_screen.dart';
import 'screens/login_screen.dart';
import 'screens/splash_screen.dart';
import 'state/app_controller.dart';
import 'widgets/privacy_shield.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final controller = AppController(
    authService: AuthService(),
    storage: KeychainTokenStorage(),
    biometricService: LocalAuthBiometricService(),
  );
  controller.initialize();
  runApp(OrbitMobileApp(controller: controller));
}

class OrbitMobileApp extends StatelessWidget {
  const OrbitMobileApp({super.key, required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Orbit',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF0F6CBD)),
        useMaterial3: true,
      ),
      darkTheme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF479EF5),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
      ),
      themeMode: ThemeMode.system,
      home: PrivacyShield(
        child: AnimatedBuilder(
          animation: controller,
          builder: (context, _) {
            switch (controller.stage) {
              case AppStage.splash:
                return const SplashScreen();
              case AppStage.locked:
                return SplashScreen(
                  locked: true,
                  busy: controller.unlockBusy,
                  onUnlock: controller.unlockWithBiometrics,
                  onSignOut: controller.signOut,
                );
              case AppStage.unauthenticated:
                return LoginScreen(controller: controller);
              case AppStage.authenticated:
                return ChatWebViewScreen(controller: controller);
            }
          },
        ),
      ),
    );
  }
}
