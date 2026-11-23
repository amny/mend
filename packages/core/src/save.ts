// The save pipeline (requirements 4.4): patch generation -> application -> verification -> next document.
import { buildDocument, parseSource } from './document'
import { encodeLines, lineBreakMarkup } from './encodeEdit'
import type { RebasePart } from './document'
import { applyPatches, mapOffset } from './patch'
import type { MendDocument, Patch, TextEdit } from './types'
import { verifySave, type VerificationIssue } from './verify'

export type SaveErrorCode =
  | 'unknown-record'
  | 'non-editable'
  | 'encode-failed'
  | 'patch-failed'
  | 'verification-failed'
  | 'rebase-failed'

export interface SaveError {
  readonly code: SaveErrorCode
  /** English, for logs. The UI builds its own text from code and issues. */
  readonly message: string
  readonly issues: readonly VerificationIssue[]
}

export interface SaveSuccess {
  readonly ok: true
  /** Verified new source (without BOM). Only this may be written to disk. */
  readonly source: string
  readonly patches: readonly Patch[]
  /**
   * Record id (of the document passed in) -> lines the DOM should hold after saving (one line unless new <br>s were
   * inserted).
   */
  readonly expectedValues: ReadonlyMap<number, readonly string[]>
  /** The new source of truth, keeping emptied text nodes as virtual records (same ids/order as the input). */
  readonly document: MendDocument
}

export type SaveResult = SaveSuccess | { readonly ok: false; readonly error: SaveError }

export interface SaveOptions {
  /** Test hook (AC-08): corrupt the result so that verification must fail. */
  readonly fault?: 'corrupt-structure'
}

const fail = (
  code: SaveErrorCode,
  message: string,
  issues: readonly VerificationIssue[] = [],
): SaveResult => ({
  ok: false,
  error: { code, message, issues },
})

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

function injectFault(patches: readonly Patch[], doc: MendDocument): readonly Patch[] {
  const [first, ...rest] = patches
  if (first) return [{ ...first, text: `<b>${first.text}</b>` }, ...rest]
  const target = doc.records.find((r) => r.status === 'editable')
  return target ? [{ start: target.start, end: target.start, text: '<b></b>' }] : patches
}

export function prepareSave(
  doc: MendDocument,
  edits: readonly TextEdit[],
  options: SaveOptions = {},
): SaveResult {
  const latest = new Map(edits.map((e) => [e.recordId, e]))

  const patches: Patch[] = []
  const expectedValues = new Map<number, readonly string[]>()
  const markup = lineBreakMarkup(doc.source)
  for (const edit of latest.values()) {
    const record = doc.records[edit.recordId]
    if (!record) return fail('unknown-record', `Unknown text record id ${edit.recordId}`)
    const lines = typeof edit.value === 'string' ? [edit.value] : edit.value
    if (lines.length === 0) return fail('encode-failed', `Text record ${record.id} has no lines`)
    if (lines.length === 1 && lines[0] === record.value) continue
    if (record.status !== 'editable') {
      return fail(
        'non-editable',
        `Text record ${record.id} (${record.label}) is not editable (${record.status})`,
      )
    }
    try {
      const result = encodeLines(doc.source, record, lines, edit.preformatted ?? false, markup)
      if (result.patch) patches.push(result.patch)
      expectedValues.set(record.id, result.expectedLines)
    } catch (error: unknown) {
      return fail('encode-failed', describeError(error))
    }
  }

  const finalPatches = options.fault ? injectFault(patches, doc) : patches
  let source: string
  try {
    source = applyPatches(doc.source, finalPatches)
  } catch (error: unknown) {
    return fail('patch-failed', describeError(error))
  }

  const parsed = parseSource(source)
  const verification = verifySave(doc, source, expectedValues, finalPatches, parsed)
  if (!verification.ok) {
    return fail(
      'verification-failed',
      `Verification failed: ${verification.issues.map((i) => `${i.kind} at ${i.path}`).join('; ')}`,
      verification.issues,
    )
  }

  try {
    const document = buildDocument(
      source,
      {
        oldChildren: doc.tree.children,
        expand: (id): readonly RebasePart[] | undefined => {
          const record = doc.records[id]
          if (!record) return undefined
          const lines = expectedValues.get(id) ?? [record.value]
          if (lines.length === 1) {
            return lines[0] === ''
              ? [{ kind: 'virtual', anchor: mapOffset(finalPatches, record.start) }]
              : undefined
          }
          return lines.flatMap((line, i): RebasePart[] => [
            ...(i > 0 ? [{ kind: 'node' as const }] : []),
            line === '' ? { kind: 'virtual' } : { kind: 'node' },
          ])
        },
      },
      parsed,
    )
    return { ok: true, source, patches: finalPatches, expectedValues, document }
  } catch (error: unknown) {
    return fail('rebase-failed', describeError(error))
  }
}
