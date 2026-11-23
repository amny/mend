// UTF-8 decoding/encoding that keeps byte identity (requirements 3: BOM is recorded and restored).

export interface DecodeError {
  readonly code: 'invalid-utf8'
  readonly message: string
}

export type DecodeResult =
  | { readonly ok: true; readonly source: string; readonly hasBom: boolean }
  | { readonly ok: false; readonly error: DecodeError }

const BOM_BYTES = [0xef, 0xbb, 0xbf] as const

const startsWithBom = (bytes: Uint8Array): boolean =>
  bytes.length >= 3 && BOM_BYTES.every((b, i) => bytes[i] === b)

/**
 * Decodes UTF-8 strictly. Invalid sequences are an error (never U+FFFD replacement),
 * because a lossy decode could not be written back byte-identically.
 */
export function decodeUtf8(bytes: Uint8Array): DecodeResult {
  const hasBom = startsWithBom(bytes)
  const body = hasBom ? bytes.subarray(3) : bytes
  try {
    const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body)
    return { ok: true, source, hasBom }
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      error: {
        code: 'invalid-utf8',
        message: `The file is not valid UTF-8 (it may be Shift_JIS or another encoding): ${reason}`,
      },
    }
  }
}

export function encodeUtf8(source: string, hasBom: boolean): Uint8Array<ArrayBuffer> {
  const body = new TextEncoder().encode(source)
  if (!hasBom) return body
  const out = new Uint8Array(body.length + 3)
  out.set(BOM_BYTES, 0)
  out.set(body, 3)
  return out
}
