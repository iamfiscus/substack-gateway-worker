// Port of gateway_drafts/_cursor.py (upstream bc2e875).
import { lenientBase64ToBytes } from '../auth/credentials';

export class InvalidCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCursorError';
  }
}

export function encodeOffset(offset: number): string {
  return btoa(`o:${offset}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeOffset(cursor: string): number {
  let raw: string;
  try {
    raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      lenientBase64ToBytes(cursor, true),
    );
  } catch {
    throw new InvalidCursorError('invalid cursor');
  }
  if (!raw.startsWith('o:')) throw new InvalidCursorError('invalid cursor');
  const digits = raw.slice(2).trim();
  if (!/^[+-]?\d+(_\d+)*$/.test(digits)) throw new InvalidCursorError('invalid cursor');
  const offset = Number(digits.replace(/_/g, ''));
  if (offset < 0) throw new InvalidCursorError('invalid cursor');
  return offset;
}
