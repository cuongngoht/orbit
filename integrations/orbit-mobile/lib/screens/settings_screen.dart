import 'package:flutter/material.dart';

import '../state/app_controller.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({
    super.key,
    required this.controller,
    required this.onReloadWebView,
    required this.onClearCache,
  });

  final AppController controller;
  final VoidCallback onReloadWebView;
  final Future<void> Function() onClearCache;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool _busy = false;

  Future<void> _confirmSignOut() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Đăng xuất'),
        content: const Text('Xóa phiên đăng nhập khỏi Keychain và toàn bộ dữ liệu WebView trên thiết bị này?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Hủy'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Đăng xuất'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _busy = true);
    await widget.controller.signOut();
    if (mounted) {
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return AnimatedBuilder(
      animation: widget.controller,
      builder: (context, _) {
        final user = widget.controller.user;
        final account = widget.controller.account;
        final origin = widget.controller.serverOrigin?.toString() ?? '-';

        return Scaffold(
          appBar: AppBar(title: const Text('Cài đặt')),
          body: ListView(
            children: [
              if (user != null)
                ListTile(
                  leading: CircleAvatar(
                    child: Text(user.fullName.isNotEmpty ? user.fullName[0].toUpperCase() : '?'),
                  ),
                  title: Text(user.fullName),
                  subtitle: Text(
                    '@${user.username}${account != null && account.label.isNotEmpty ? ' · ${account.label}' : ''}',
                  ),
                ),
              ListTile(
                leading: const Icon(Icons.dns_outlined),
                title: const Text('Máy chủ'),
                subtitle: Text(origin),
              ),
              const Divider(),
              if (widget.controller.biometricAvailable)
                SwitchListTile(
                  secondary: const Icon(Icons.face_rounded),
                  title: const Text('Khóa bằng Face ID / Mật mã'),
                  subtitle: const Text('Yêu cầu xác thực khi mở lại ứng dụng'),
                  value: widget.controller.biometricEnabled,
                  onChanged: _busy
                      ? null
                      : (v) async {
                          final messenger = ScaffoldMessenger.of(context);
                          final ok = await widget.controller.setBiometricEnabled(v);
                          if (!ok && mounted) {
                            messenger.showSnackBar(
                              const SnackBar(content: Text('Không thể bật xác thực sinh trắc học.')),
                            );
                          }
                        },
                ),
              ListTile(
                leading: const Icon(Icons.refresh_rounded),
                title: const Text('Tải lại trang Web'),
                onTap: _busy
                    ? null
                    : () {
                        widget.onReloadWebView();
                        Navigator.of(context).pop();
                      },
              ),
              ListTile(
                leading: const Icon(Icons.cleaning_services_outlined),
                title: const Text('Xóa bộ nhớ đệm WebView'),
                onTap: _busy
                    ? null
                    : () async {
                        final messenger = ScaffoldMessenger.of(context);
                        setState(() => _busy = true);
                        await widget.onClearCache();
                        if (mounted) {
                          setState(() => _busy = false);
                          messenger.showSnackBar(
                            const SnackBar(content: Text('Đã xóa bộ nhớ đệm WebView.')),
                          );
                        }
                      },
              ),
              const Divider(),
              ListTile(
                leading: Icon(Icons.logout_rounded, color: theme.colorScheme.error),
                title: Text(
                  'Đăng xuất',
                  style: TextStyle(color: theme.colorScheme.error, fontWeight: FontWeight.w600),
                ),
                onTap: _busy ? null : _confirmSignOut,
              ),
            ],
          ),
        );
      },
    );
  }
}
