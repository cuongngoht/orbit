import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_mobile/core/origin_policy.dart';

void main() {
  group('normalizeServerUri', () {
    test('normalizes valid HTTPS domains and strips paths/queries/default ports', () {
      expect(normalizeServerUri('orbit.example.com/chat?x=1').toString(), 'https://orbit.example.com');
      expect(normalizeServerUri('HTTPS://Orbit.Example.COM:443/').toString(), 'https://orbit.example.com');
      expect(normalizeServerUri('https://orbit.example.com:8443/app').toString(), 'https://orbit.example.com:8443');
    });

    test('allows plain HTTP only for loopback hosts', () {
      expect(normalizeServerUri('http://localhost:3000/').toString(), 'http://localhost:3000');
      expect(normalizeServerUri('http://127.0.0.1:80').toString(), 'http://127.0.0.1');
      expect(() => normalizeServerUri('http://orbit.example.com'), throwsFormatException);
      expect(() => normalizeServerUri('ftp://orbit.example.com'), throwsFormatException);
      expect(() => normalizeServerUri('https://user:pass@orbit.example.com'), throwsFormatException);
      expect(() => normalizeServerUri('   '), throwsFormatException);
    });
  });

  group('isSameOrigin', () {
    test('matches exact scheme, host, and effective port', () {
      final allowed = Uri.parse('https://orbit.example.com');
      expect(isSameOrigin(Uri.parse('https://ORBIT.example.com:443/#/chat/1'), allowed), isTrue);
      expect(isSameOrigin(Uri.parse('http://orbit.example.com/'), allowed), isFalse);
      expect(isSameOrigin(Uri.parse('https://evil.orbit.example.com/'), allowed), isFalse);
      expect(isSameOrigin(Uri.parse('https://orbit.example.com:8443/'), allowed), isFalse);
      expect(isSameOrigin(null, allowed), isFalse);
    });
  });
}
