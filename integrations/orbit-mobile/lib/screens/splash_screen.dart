import 'package:flutter/material.dart';

class SplashScreen extends StatelessWidget {
  const SplashScreen({
    super.key,
    this.locked = false,
    this.busy = false,
    this.onUnlock,
    this.onSignOut,
  });

  final bool locked;
  final bool busy;
  final VoidCallback? onUnlock;
  final VoidCallback? onSignOut;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 68,
                  height: 68,
                  decoration: BoxDecoration(
                    color: theme.colorScheme.primaryContainer,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Icon(
                    locked ? Icons.lock_rounded : Icons.hub_rounded,
                    size: 36,
                    color: theme.colorScheme.onPrimaryContainer,
                  ),
                ),
                const SizedBox(height: 20),
                Text(
                  locked ? 'Orbit đang khóa' : 'Orbit',
                  style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 8),
                Text(
                  locked
                      ? 'Xác thực Face ID hoặc mật mã thiết bị để tiếp tục.'
                      : 'Đang khôi phục phiên an toàn từ Keychain...',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 28),
                if (busy || !locked)
                  const CircularProgressIndicator()
                else ...[
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: onUnlock,
                      icon: const Icon(Icons.face_rounded),
                      label: const Text('Mở khóa'),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextButton(
                    onPressed: onSignOut,
                    child: const Text('Đăng xuất tài khoản'),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
