// Goldens the TS port cannot reproduce exactly, each with the reason. Keep this
// list as short as possible: an entry is only for a difference JS cannot avoid.

/** `<golden kind>/<name>` -> why the TS output differs from upstream's. */
export const KNOWN_DIFFS: Readonly<Record<string, string>> = {
  'draft-doc/construct-verbatim-nodes':
    'integer beyond 2^53 (12345678901234567890) in substack-node JSON: a JS number loses precision',
  'draft-doc/pyjs-json-big-int':
    'integers beyond 2^53 in image attributes: a JS number loses precision',
};
