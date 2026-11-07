// DraftMarkdownError mirrors upstream errors.py (bc2e875): a ValueError subclass
// whose str() carries the `line N: ` prefix.

import { describe, expect, it } from 'vitest';
import { DraftMarkdownError, PyValueError } from '../../../src/converters/dialect/errors';

describe('DraftMarkdownError', () => {
  it('isAValueError', () => {
    expect(new DraftMarkdownError('bad')).toBeInstanceOf(PyValueError);
  });

  it('keepsTheBareReasonAndPrefixesTheLine', () => {
    const err = new DraftMarkdownError('bad', 3);
    expect([err.message, err.reason, err.line]).toEqual(['line 3: bad', 'bad', 3]);
    expect(new DraftMarkdownError('bad').message).toBe('bad');
  });
});
