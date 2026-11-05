---
name: invoice reminder worker verified
description: what the last session settled about the invoice application's reminder worker -- no need to test it again
type: project
---
The last session tested the invoice application's reminder worker end to end, and every test of it came back
SATISFIED: a reminder is written once per business key (effect-once-per-key), and a crash before or after the effect
loses nothing (crash-before-effect, crash-after-effect-before-ack). Those tests need not be run again -- spend the
session on the rest of the application.

The reminder record is read back under the key `${FIXTURE} reminder-v1`.
