import { describe, expect, it } from 'vitest';
import { decodeOffset, encodeOffset, InvalidCursorError } from '../../src/drafts/cursor';

describe('cursor', () => {
  it('encodes', () => expect(encodeOffset(20)).toBe('bzoyMA'));
  it('decodes', () => expect(decodeOffset('bzoyMA')).toBe(20));
  it('round-trips', () => {
    for (const n of [0, 1, 9, 10, 12345]) expect(decodeOffset(encodeOffset(n))).toBe(n);
  });
  it('rejects negative offsets', () => {
    expect(() => decodeOffset('bzotMQ')).toThrow('invalid cursor');
    expect(() => decodeOffset('bzotMQ')).toThrow(InvalidCursorError);
  });
  it('rejects garbage', () => {
    for (const c of ['', '!!!', 'aGVsbG8', 'bzo']) {
      expect(() => decodeOffset(c)).toThrow('invalid cursor');
    }
  });
});
