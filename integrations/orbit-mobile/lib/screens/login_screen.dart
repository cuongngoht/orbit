import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/models.dart';
import '../core/origin_policy.dart';
import '../state/app_controller.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.controller});

  final AppController controller;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _serverController;
  final _usernameController = TextEditingController();
  final _passwordController = TextEditingController();
  late final TextEditingController _accessTokenController;

  bool _showPassword = false;
  bool _showAccessToken = false;
  bool _editingServer = false;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _serverController = TextEditingController(text: widget.controller.initialServerText);
    _accessTokenController = TextEditingController(text: widget.controller.savedAccessToken ?? '');
    _editingServer = _serverController.text.trim().isEmpty;
    _showAccessToken = _accessTokenController.text.trim().isNotEmpty;
  }

  @override
  void dispose() {
    _serverController.dispose();
    _usernameController.dispose();
    _passwordController.dispose();
    _accessTokenController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    widget.controller.clearNotice();
    if (!_formKey.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      await widget.controller.signIn(
        serverUrl: _serverController.text,
        username: _usernameController.text,
        password: _passwordController.text,
        accessToken: _accessTokenController.text,
        deviceName: 'iOS App',
      );
      TextInput.finishAutofillContext();
    } on FormatException catch (err) {
      setState(() {
        _editingServer = true;
        _error = err.message;
      });
    } on AuthApiException catch (err) {
      setState(() {
        _error = err.message;
        if (err.isAccessTokenRequired) {
          _showAccessToken = true;
        }
        if (!err.isNetworkError && err.code != 'too_many_attempts' && !err.isAccessTokenRequired) {
          _passwordController.clear();
        }
      });
    } catch (err) {
      setState(() {
        _error = err.toString();
      });
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final notice = widget.controller.noticeMessage;
    final bannerText = _error ?? notice;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Center(
                      child: Container(
                        width: 60,
                        height: 60,
                        decoration: BoxDecoration(
                          color: theme.colorScheme.primaryContainer,
                          borderRadius: BorderRadius.circular(18),
                        ),
                        child: Icon(
                          Icons.hub_rounded,
                          size: 32,
                          color: theme.colorScheme.onPrimaryContainer,
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'Đăng nhập Orbit',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Phiên đăng nhập được bảo vệ trong iOS Keychain.',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 24),
                    if (bannerText != null) ...[
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: theme.colorScheme.errorContainer,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(
                              Icons.error_outline_rounded,
                              size: 20,
                              color: theme.colorScheme.onErrorContainer,
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                bannerText,
                                style: theme.textTheme.bodySmall?.copyWith(
                                  color: theme.colorScheme.onErrorContainer,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),
                    ],
                    if (!_editingServer && _serverController.text.trim().isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 16),
                        child: InputDecorator(
                          decoration: InputDecoration(
                            labelText: 'Máy chủ',
                            border: const OutlineInputBorder(),
                            suffixIcon: IconButton(
                              tooltip: 'Đổi máy chủ',
                              icon: const Icon(Icons.edit_outlined),
                              onPressed: _busy ? null : () => setState(() => _editingServer = true),
                            ),
                          ),
                          child: Text(
                            _serverController.text.trim(),
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.bodyMedium,
                          ),
                        ),
                      )
                    else
                      Padding(
                        padding: const EdgeInsets.only(bottom: 16),
                        child: TextFormField(
                          controller: _serverController,
                          enabled: !_busy,
                          keyboardType: TextInputType.url,
                          textInputAction: TextInputAction.next,
                          autocorrect: false,
                          enableSuggestions: false,
                          decoration: const InputDecoration(
                            labelText: 'Địa chỉ máy chủ (HTTPS)',
                            hintText: 'https://orbit.example.com',
                            border: OutlineInputBorder(),
                            prefixIcon: Icon(Icons.dns_outlined),
                          ),
                          validator: (v) {
                            try {
                              normalizeServerUri(v ?? '');
                              return null;
                            } on FormatException catch (e) {
                              return e.message;
                            }
                          },
                        ),
                      ),
                    AutofillGroup(
                      child: Column(
                        children: [
                          TextFormField(
                            controller: _usernameController,
                            enabled: !_busy,
                            autofillHints: const [AutofillHints.username, AutofillHints.email],
                            keyboardType: TextInputType.emailAddress,
                            textInputAction: TextInputAction.next,
                            autocorrect: false,
                            enableSuggestions: false,
                            decoration: const InputDecoration(
                              labelText: 'Tên đăng nhập hoặc Email',
                              border: OutlineInputBorder(),
                              prefixIcon: Icon(Icons.person_outline_rounded),
                            ),
                            validator: (v) {
                              if (v == null || v.trim().isEmpty) {
                                return 'Vui lòng nhập tên đăng nhập hoặc email.';
                              }
                              return null;
                            },
                          ),
                          const SizedBox(height: 14),
                          TextFormField(
                            controller: _passwordController,
                            enabled: !_busy,
                            obscureText: !_showPassword,
                            autofillHints: const [AutofillHints.password],
                            textInputAction: _showAccessToken ? TextInputAction.next : TextInputAction.done,
                            autocorrect: false,
                            enableSuggestions: false,
                            onFieldSubmitted: (_) {
                              if (!_showAccessToken && !_busy) _submit();
                            },
                            decoration: InputDecoration(
                              labelText: 'Mật khẩu',
                              border: const OutlineInputBorder(),
                              prefixIcon: const Icon(Icons.lock_outline_rounded),
                              suffixIcon: IconButton(
                                tooltip: _showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu',
                                icon: Icon(_showPassword ? Icons.visibility_off : Icons.visibility),
                                onPressed: () => setState(() => _showPassword = !_showPassword),
                              ),
                            ),
                            validator: (v) {
                              if (v == null || v.isEmpty) {
                                return 'Vui lòng nhập mật khẩu.';
                              }
                              return null;
                            },
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 8),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: TextButton.icon(
                        onPressed: _busy ? null : () => setState(() => _showAccessToken = !_showAccessToken),
                        icon: Icon(_showAccessToken ? Icons.expand_less : Icons.vpn_key_outlined, size: 18),
                        label: Text(_showAccessToken ? 'Ẩn Access Token' : 'Máy chủ có Access Token?'),
                      ),
                    ),
                    if (_showAccessToken) ...[
                      const SizedBox(height: 6),
                      TextFormField(
                        controller: _accessTokenController,
                        enabled: !_busy,
                        obscureText: true,
                        autocorrect: false,
                        enableSuggestions: false,
                        textInputAction: TextInputAction.done,
                        onFieldSubmitted: (_) {
                          if (!_busy) _submit();
                        },
                        decoration: const InputDecoration(
                          labelText: 'Access Token (tùy chọn)',
                          border: OutlineInputBorder(),
                          prefixIcon: Icon(Icons.key_rounded),
                        ),
                      ),
                    ],
                    const SizedBox(height: 20),
                    FilledButton(
                      onPressed: _busy ? null : _submit,
                      style: FilledButton.styleFrom(
                        minimumSize: const Size.fromHeight(50),
                      ),
                      child: _busy
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text('Đăng nhập'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
