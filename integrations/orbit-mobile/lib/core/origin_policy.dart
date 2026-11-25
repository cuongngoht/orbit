const Set<String> _loopbackHosts = {'localhost', '127.0.0.1', '::1', '[::1]'};

int effectivePort(Uri uri) {
  if (uri.hasPort) return uri.port;
  return uri.scheme.toLowerCase() == 'https' ? 443 : 80;
}

bool isLoopbackHost(String host) {
  return _loopbackHosts.contains(host.toLowerCase());
}

/// Validates and normalizes a server origin string.
/// Remote servers must use HTTPS; plain HTTP is permitted only for loopback testing.
Uri normalizeServerUri(String raw) {
  final trimmed = raw.trim();
  if (trimmed.isEmpty) {
    throw const FormatException('Vui lòng nhập địa chỉ máy chủ.');
  }
  final withScheme = trimmed.contains('://') ? trimmed : 'https://$trimmed';
  final parsed = Uri.tryParse(withScheme);
  if (parsed == null || !parsed.hasScheme || parsed.host.isEmpty || parsed.userInfo.isNotEmpty) {
    throw const FormatException('Địa chỉ máy chủ không hợp lệ.');
  }
  final scheme = parsed.scheme.toLowerCase();
  if (scheme != 'https' && scheme != 'http') {
    throw const FormatException('Chỉ hỗ trợ giao thức HTTPS (hoặc HTTP cho localhost).');
  }
  final host = parsed.host.toLowerCase();
  if (scheme == 'http' && !isLoopbackHost(host)) {
    throw const FormatException('Máy chủ từ xa bắt buộc dùng HTTPS để bảo vệ phiên đăng nhập.');
  }
  final defaultPort = scheme == 'https' ? 443 : 80;
  final port = (parsed.hasPort && parsed.port != defaultPort) ? parsed.port : null;
  return Uri(scheme: scheme, host: host, port: port);
}

bool isSameOrigin(Uri? candidate, Uri allowed) {
  if (candidate == null) return false;
  return candidate.scheme.toLowerCase() == allowed.scheme.toLowerCase() &&
      candidate.host.toLowerCase() == allowed.host.toLowerCase() &&
      effectivePort(candidate) == effectivePort(allowed);
}

bool isExternalHttp(Uri? uri) {
  if (uri == null) return false;
  final scheme = uri.scheme.toLowerCase();
  return scheme == 'http' || scheme == 'https';
}
