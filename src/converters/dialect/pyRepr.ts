// Python `repr()` of a str (CPython 3.11 `unicode_repr`), for error messages
// that upstream builds with `{value!r}`.
//
// Quote choice: single quotes, unless the text holds `'` and no `"`. Escapes:
// backslash, the chosen quote, \t \n \r, other ASCII controls and DEL as \xNN,
// and non-ASCII characters that are not printable (str.isprintable: categories
// Cc Cf Cs Co Cn Zl Zp Zs) as \xNN / \uNNNN / \UNNNNNNNN. Unicode versions
// differ (CPython 3.11 uses 14.0, V8 its ICU's), so a code point assigned after
// 14.0 is printable here and escaped (as Cn) upstream.

const NOT_PRINTABLE = /^[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]$/u;

function hex(cp: number, width: number): string {
  return cp.toString(16).padStart(width, '0');
}

export function pyRepr(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (ch === quote || ch === '\\') out += `\\${ch}`;
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (cp < 0x20 || cp === 0x7f) out += `\\x${hex(cp, 2)}`;
    else if (cp < 0x7f) out += ch;
    else if (!NOT_PRINTABLE.test(ch)) out += ch;
    else if (cp <= 0xff) out += `\\x${hex(cp, 2)}`;
    else if (cp <= 0xffff) out += `\\u${hex(cp, 4)}`;
    else out += `\\U${hex(cp, 8)}`;
  }
  return out + quote;
}
