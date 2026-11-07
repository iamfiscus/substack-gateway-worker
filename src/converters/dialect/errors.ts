// Port of upstream packages/gateway_drafts/src/gateway_drafts/converters/dialect/errors.py
// (bc2e875).

/**
 * Raised when draft Markdown (or a dialect construct in it) is malformed.
 *
 * Upstream keeps the bare text in `.message` and puts the `line N: ` prefix in
 * `str(exc)`. Here `message` is the JS-visible text, so it is `str(exc)` (what
 * upstream sends to clients); the bare upstream `.message` is `reason`.
 */
export class DraftMarkdownError extends Error {
  override name = 'DraftMarkdownError';
  readonly reason: string;
  readonly line?: number;

  constructor(reason: string, line?: number | null) {
    super(line == null ? reason : `line ${line}: ${reason}`);
    this.reason = reason;
    if (line != null) this.line = line;
  }
}
