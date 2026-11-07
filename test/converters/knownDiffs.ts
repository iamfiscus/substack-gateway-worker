// Goldens the TS port cannot reproduce exactly, each with the reason. Keep this
// list as short as possible: an entry is only for a difference JS cannot avoid.

// Not listed because no golden hits it: JS objects enumerate integer-like keys
// ("1", "42") before all others, so a doc holding such a key gets it first in
// attribute blocks and fence JSON (upstream keeps insertion order). The round
// trip stays lossless. serialize.test.ts pins this, and draftMd.golden.test.ts
// checks that no golden input holds such a key.

/** `<golden kind>/<name>` -> why the TS output differs from upstream's. */
export const KNOWN_DIFFS: Readonly<Record<string, string>> = {
  'draft-doc/construct-verbatim-nodes':
    'integer beyond 2^53 (12345678901234567890) in substack-node JSON: a JS number loses precision',
  'draft-doc/pyjs-json-big-int':
    'integers beyond 2^53 in image attributes: a JS number loses precision',
  'draft-md/construct-verbatim-nodes':
    'substack-node JSON holds the floats 1.0, 100.0 and -0.0 (a JS number cannot tell them from ints) and an integer beyond 2^53',
  'draft-md/construct-watermark':
    'a 100% watermark scale is the Python float 1.0, written as 1.0 in the fence JSON; a JS number cannot tell 1.0 from 1',
  'draft-md/pyjs-json-big-int':
    'integers beyond 2^53 in image attributes: a JS number loses precision',
  'draft-md/pyjs-json-float-and-nan':
    'fence JSON holds the float 1.0; a JS number cannot tell 1.0 from 1',
};
