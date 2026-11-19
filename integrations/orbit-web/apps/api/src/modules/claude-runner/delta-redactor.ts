// Redaction of text that arrives in pieces. A credential can be split across two pieces of a streamed message, so
// a piece is never masked on its own: only text up to the last whitespace of the current line is sent (a credential
// has no whitespace in it), each time masked as a whole with the line it belongs to, and only when the masked text
// still begins with what was already sent. A private key block is held back from its BEGIN line to its END line.
// Whatever this holds back arrives with the message's completion, which is masked whole.
import { redactSecrets } from "../../infra/security/redact.js";

const KEY_BEGIN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
const KEY_END = /-----END [A-Z0-9 ]*PRIVATE KEY-----/;
const LINE_LIMIT = 8_192;

export class DeltaRedactor {
  private line = "";
  private sentOfLine = "";
  private inKey = false;
  private stopped = false;

  // The masked text to send for this piece ("" when nothing is settled yet).
  push(text: string): string {
    if (this.stopped) return "";
    const parts = text.split("\n");
    let out = "";
    parts.forEach((part, i) => {
      this.line += part;
      if (i < parts.length - 1) out += this.completeLine();
    });
    return out + this.settledPart();
  }

  private completeLine(): string {
    const raw = this.line;
    const sent = this.sentOfLine;
    this.line = "";
    this.sentOfLine = "";
    if (this.stopped) return "";
    if (this.inKey) {
      if (KEY_END.test(raw)) this.inKey = false;
      return "";
    }
    if (KEY_BEGIN.test(raw) && !KEY_END.test(raw)) {
      this.inKey = true;
      return "[private key withheld]\n";
    }
    return this.extend(sent, redactSecrets(raw), "\n");
  }

  private settledPart(): string {
    if (this.inKey || this.stopped) return "";
    const cut = Math.max(this.line.lastIndexOf(" "), this.line.lastIndexOf("\t")) + 1;
    if (cut <= 0) return "";
    if (cut > LINE_LIMIT) return this.stop();
    const masked = redactSecrets(this.line.slice(0, cut));
    const piece = this.extend(this.sentOfLine, masked, "");
    if (!this.stopped) this.sentOfLine = masked;
    return piece;
  }

  // What follows `sent` in `masked`, or nothing ever again if `masked` no longer begins with `sent`.
  private extend(sent: string, masked: string, end: string): string {
    if (!masked.startsWith(sent)) return this.stop();
    return masked.slice(sent.length) + end;
  }

  private stop(): string {
    this.stopped = true;
    return "";
  }
}
