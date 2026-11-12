export async function boundedJson(request: Pick<Request,'body'|'headers'>, maximum = 64_000): Promise<unknown> {
  const length = request.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > maximum) throw new Error('REQUEST_TOO_LARGE');
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new Error('REQUEST_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes) || '{}'); }
  catch { throw new Error('INVALID_JSON'); }
}
