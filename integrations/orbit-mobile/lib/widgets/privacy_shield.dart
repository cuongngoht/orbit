import 'dart:ui';

import 'package:flutter/material.dart';

/// Covers sensitive workspace content with a blur overlay when the app enters
/// iOS app switcher / background states.
class PrivacyShield extends StatefulWidget {
  const PrivacyShield({super.key, required this.child});

  final Widget child;

  @override
  State<PrivacyShield> createState() => _PrivacyShieldState();
}

class _PrivacyShieldState extends State<PrivacyShield> with WidgetsBindingObserver {
  bool _obscured = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final hide = state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden;
    if (hide != _obscured) {
      setState(() => _obscured = hide);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        widget.child,
        if (_obscured)
          Positioned.fill(
            child: ClipRect(
              child: BackdropFilter(
                filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
                child: ColoredBox(
                  color: Theme.of(context).colorScheme.surface.withValues(alpha: 0.72),
                  child: const Center(
                    child: Icon(Icons.lock_outline_rounded, size: 48),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}
