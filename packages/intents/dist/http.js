const MAX_RESPONSE_BYTES = 2_000_000;
/** Bound third-party JSON before buffering it or parsing untrusted UTF-8. */
export async function routeJson(response) {
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES))
        throw new Error('ROUTE_RESPONSE_TOO_LARGE');
    if (!response.body)
        throw new Error('INVALID_ROUTE_RESPONSE');
    const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0, text = '';
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done)
                break;
            bytes += chunk.value.byteLength;
            if (bytes > MAX_RESPONSE_BYTES)
                throw new Error('ROUTE_RESPONSE_TOO_LARGE');
            text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
        return JSON.parse(text);
    }
    catch (error) {
        await reader.cancel().catch(() => { });
        if (error instanceof Error && error.message === 'ROUTE_RESPONSE_TOO_LARGE')
            throw error;
        throw new Error('INVALID_ROUTE_RESPONSE');
    }
    finally {
        reader.releaseLock();
    }
}
