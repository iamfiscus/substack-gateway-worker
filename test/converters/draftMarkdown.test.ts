// markdown.py's own behaviour (the facade over the block parser): the literal
// `\n` expansion of single-line input and the JSON body. Checked against
// upstream bc2e875.

import { describe, expect, it } from 'vitest';
import { markdownToDraftBody, markdownToDraftDoc } from '../../src/converters/draftMarkdown';
import { p } from './dialect/helpers';

describe('markdownToDraftDoc', () => {
  it('expands literal \\n escapes in single-line input', () => {
    expect(markdownToDraftDoc('a\\n\\nb')).toEqual({ type: 'doc', content: [p('a'), p('b')] });
  });

  it('keeps literal \\n escapes in multi-line input', () => {
    expect(markdownToDraftDoc('$$\n\\nabla\n$$').content?.[0]?.attrs?.persistentExpression).toBe(
      '\\nabla',
    );
  });

  it('expands for input whose only line breaks are lone carriage returns', () => {
    expect(markdownToDraftDoc('a\r\\nb')).toEqual({ type: 'doc', content: [p('a b')] });
  });
});

describe('markdownToDraftBody', () => {
  it('is json.dumps(doc, ensure_ascii=False)', () => {
    expect(markdownToDraftBody('# H\u00e9')).toBe(
      '{"type": "doc", "content": [{"type": "heading", "attrs": {"level": 1, "textAlign": null}, ' +
        '"content": [{"type": "text", "text": "H\u00e9"}]}]}',
    );
  });
});
