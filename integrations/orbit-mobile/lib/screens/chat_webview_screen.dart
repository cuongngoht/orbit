import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/app_config.dart';
import '../core/origin_policy.dart';
import '../state/app_controller.dart';
import 'settings_screen.dart';

class ChatWebViewScreen extends StatefulWidget {
  const ChatWebViewScreen({super.key, required this.controller});

  final AppController controller;

  @override
  State<ChatWebViewScreen> createState() => _ChatWebViewScreenState();
}

class _ChatWebViewScreenState extends State<ChatWebViewScreen> {
  InAppWebViewController? _webController;
  StreamSubscription<List<ConnectivityResult>>? _connectivitySub;
  Timer? _readyFallbackTimer;

  bool _webReady = false;
  bool _offline = false;
  String? _loadError;
  double _progress = 0;

  @override
  void initState() {
    super.initState();
    widget.controller.registerWebViewClearCallback(_clearWebViewStorage);
    _initConnectivity();
  }

  @override
  void dispose() {
    _readyFallbackTimer?.cancel();
    _connectivitySub?.cancel();
    widget.controller.registerWebViewClearCallback(null);
    super.dispose();
  }

  Future<void> _initConnectivity() async {
    try {
      final initial = await Connectivity().checkConnectivity();
      if (mounted) {
        setState(() => _offline = _isOffline(initial));
      }
    } catch (_) {
      // Connectivity check may not be implemented on all platforms.
    }
    _connectivitySub = Connectivity().onConnectivityChanged.listen((results) {
      final offline = _isOffline(results);
      if (!mounted) return;
      final recovered = _offline && !offline && _loadError != null;
      setState(() => _offline = offline);
      if (recovered) {
        _reload();
      }
    });
  }

  bool _isOffline(List<ConnectivityResult> results) {
    return results.isEmpty || results.every((r) => r == ConnectivityResult.none);
  }

  Future<void> _clearWebViewStorage() async {
    await CookieManager.instance().deleteAllCookies();
    await WebStorageManager.instance().deleteAllData();
    await InAppWebViewController.clearAllCache();
  }

  Future<bool> _isTrustedOrigin(InAppWebViewController controller) async {
    final origin = widget.controller.serverOrigin;
    if (origin == null) return false;
    final current = await controller.getUrl();
    return isSameOrigin(current?.uriValue, origin);
  }

  void _reload() {
    final origin = widget.controller.serverOrigin;
    setState(() {
      _loadError = null;
    });
    if (_webController == null || origin == null) return;
    _webController!.getUrl().then((current) {
      if (!mounted) return;
      if (current != null && isSameOrigin(current.uriValue, origin)) {
        _webController?.reload();
      } else {
        _webController?.loadUrl(urlRequest: URLRequest(url: WebUri(origin.toString())));
      }
    });
  }

  Future<void> _openExternal(Uri uri) async {
    final mode = isExternalHttp(uri) ? LaunchMode.inAppBrowserView : LaunchMode.externalApplication;
    await launchUrl(uri, mode: mode);
  }

  void _openSettings() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => SettingsScreen(
          controller: widget.controller,
          onReloadWebView: _reload,
          onClearCache: () async {
            await InAppWebViewController.clearAllCache();
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final origin = widget.controller.serverOrigin;
    if (origin == null) {
      return const SizedBox.shrink();
    }
    final theme = Theme.of(context);

    return Scaffold(
      body: Column(
        children: [
          Material(
            color: theme.colorScheme.surface,
            elevation: 0,
            child: SafeArea(
              bottom: false,
              child: Container(
                height: 46,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                decoration: BoxDecoration(
                  border: Border(
                    bottom: BorderSide(color: theme.dividerColor.withValues(alpha: 0.4)),
                  ),
                ),
                child: Row(
                  children: [
                    Icon(Icons.lock_outline_rounded, size: 16, color: theme.colorScheme.primary),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        origin.host,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
                      ),
                    ),
                    IconButton(
                      tooltip: 'Tải lại',
                      icon: const Icon(Icons.refresh_rounded, size: 20),
                      onPressed: _reload,
                    ),
                    IconButton(
                      tooltip: 'Cài đặt',
                      icon: const Icon(Icons.settings_outlined, size: 20),
                      onPressed: _openSettings,
                    ),
                  ],
                ),
              ),
            ),
          ),
          if (_offline)
            Container(
              width: double.infinity,
              color: theme.colorScheme.errorContainer,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              child: Row(
                children: [
                  Icon(Icons.wifi_off_rounded, size: 16, color: theme.colorScheme.onErrorContainer),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Mất kết nối mạng. Đang chờ khôi phục...',
                      style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onErrorContainer),
                    ),
                  ),
                ],
              ),
            ),
          if (_progress > 0 && _progress < 1)
            LinearProgressIndicator(value: _progress, minHeight: 2),
          Expanded(
            child: Stack(
              children: [
                InAppWebView(
                  initialUrlRequest: URLRequest(url: WebUri(origin.toString())),
                  initialSettings: InAppWebViewSettings(
                    applicationNameForUserAgent: AppConfig.userAgentSuffix,
                    javaScriptEnabled: true,
                    sharedCookiesEnabled: true,
                    incognito: false,
                    allowsInlineMediaPlayback: true,
                    mediaPlaybackRequiresUserGesture: false,
                    isInspectable: kDebugMode,
                    supportMultipleWindows: true,
                    javaScriptCanOpenWindowsAutomatically: true,
                    useShouldOverrideUrlLoading: true,
                  ),
                  onWebViewCreated: (webController) {
                    _webController = webController;

                    webController.addJavaScriptHandler(
                      handlerName: 'takeBootstrap',
                      callback: (_) async {
                        if (!await _isTrustedOrigin(webController)) return null;
                        return widget.controller.popBootstrap()?.toJson();
                      },
                    );

                    webController.addJavaScriptHandler(
                      handlerName: 'onAuthExpired',
                      callback: (_) async {
                        if (!await _isTrustedOrigin(webController)) return null;
                        final refreshed = await widget.controller.handleAuthExpired();
                        return refreshed?.toJson();
                      },
                    );

                    webController.addJavaScriptHandler(
                      handlerName: 'onWebReady',
                      callback: (_) async {
                        if (!await _isTrustedOrigin(webController)) return null;
                        _readyFallbackTimer?.cancel();
                        if (mounted && !_webReady) {
                          setState(() => _webReady = true);
                        }
                        return true;
                      },
                    );

                    webController.addJavaScriptHandler(
                      handlerName: 'onSignedOut',
                      callback: (_) async {
                        if (!await _isTrustedOrigin(webController)) return null;
                        await widget.controller.signOut(serverAlreadySignedOut: true);
                        return true;
                      },
                    );
                  },
                  onProgressChanged: (_, p) {
                    if (mounted) {
                      setState(() => _progress = p / 100.0);
                    }
                  },
                  onLoadStop: (_, _) {
                    if (!_webReady) {
                      _readyFallbackTimer?.cancel();
                      _readyFallbackTimer = Timer(const Duration(seconds: 2), () {
                        if (mounted && !_webReady) {
                          setState(() => _webReady = true);
                        }
                      });
                    }
                  },
                  onReceivedError: (_, request, error) {
                    if ((request.isForMainFrame ?? true) && error.type != WebResourceErrorType.CANCELLED) {
                      _readyFallbackTimer?.cancel();
                      if (mounted) {
                        setState(() {
                          _webReady = true;
                          _loadError = error.description;
                        });
                      }
                    }
                  },
                  shouldOverrideUrlLoading: (_, navigationAction) async {
                    final uri = navigationAction.request.url?.uriValue;
                    if (uri == null) return NavigationActionPolicy.CANCEL;
                    final scheme = uri.scheme.toLowerCase();
                    if (scheme == 'about' || scheme == 'blob' || scheme == 'data') {
                      return NavigationActionPolicy.ALLOW;
                    }
                    if (isSameOrigin(uri, origin)) {
                      return NavigationActionPolicy.ALLOW;
                    }
                    if (navigationAction.isForMainFrame) {
                      await _openExternal(uri);
                    }
                    return NavigationActionPolicy.CANCEL;
                  },
                  onCreateWindow: (_, createWindowAction) async {
                    final uri = createWindowAction.request.url?.uriValue;
                    if (uri != null) {
                      if (isSameOrigin(uri, origin)) {
                        await _webController?.loadUrl(
                          urlRequest: URLRequest(url: createWindowAction.request.url),
                        );
                      } else {
                        await _openExternal(uri);
                      }
                    }
                    return false;
                  },
                ),
                if (!_webReady && _loadError == null)
                  Positioned.fill(
                    child: ColoredBox(
                      color: theme.colorScheme.surface,
                      child: const Center(child: CircularProgressIndicator()),
                    ),
                  ),
                if (_loadError != null)
                  Positioned.fill(
                    child: ColoredBox(
                      color: theme.colorScheme.surface,
                      child: Center(
                        child: Padding(
                          padding: const EdgeInsets.all(24),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.cloud_off_rounded, size: 48, color: theme.colorScheme.error),
                              const SizedBox(height: 16),
                              Text(
                                'Không thể tải Orbit Web',
                                style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
                              ),
                              const SizedBox(height: 8),
                              Text(
                                _loadError!,
                                textAlign: TextAlign.center,
                                style: theme.textTheme.bodySmall?.copyWith(
                                  color: theme.colorScheme.onSurfaceVariant,
                                ),
                              ),
                              const SizedBox(height: 20),
                              FilledButton.icon(
                                onPressed: _reload,
                                icon: const Icon(Icons.refresh_rounded),
                                label: const Text('Thử lại'),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
