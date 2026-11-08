// Bearer check for the harness Worker, constant-time in the token's content:
// both sides are hashed to equal-length digests before an XOR compare.

async function digest(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

export async function bearerMatches(
  header: string | null,
  token: string | undefined,
): Promise<boolean> {
  if (!token || header === null) return false;
  const [a, b] = await Promise.all([digest(header), digest(`Bearer ${token}`)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
