// Serialise a FormData body with its Content-Length, as a real HTTP client sends it.
// (A Request built in-process from FormData carries no Content-Length header.)

export async function formBody(
  form: FormData,
): Promise<{ body: ArrayBuffer; headers: Record<string, string> }> {
  const r = new Request('http://form.local/', { method: 'POST', body: form });
  const body = await r.arrayBuffer();
  return {
    body,
    headers: {
      'content-type': r.headers.get('content-type') ?? '',
      'content-length': String(body.byteLength),
    },
  };
}
