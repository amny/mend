// Applying source patches (requirements 5.6) and mapping offsets across them.
import type { Patch } from './types'

function sortedAscending(patches: readonly Patch[]): readonly Patch[] {
  return [...patches].sort((x, y) => x.start - y.start || x.end - y.end)
}

/** Throws if a patch is out of range or two patches overlap (including two insertions at one offset). */
export function validatePatches(sourceLength: number, patches: readonly Patch[]): void {
  for (const p of patches) {
    if (!(0 <= p.start && p.start <= p.end && p.end <= sourceLength)) {
      throw new Error(
        `Mend: patch out of range: [${p.start}, ${p.end}) for source length ${sourceLength}`,
      )
    }
  }
  const sorted = sortedAscending(patches)
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const cur = sorted[i]
    if (prev && cur && (cur.start < prev.end || cur.start === prev.start)) {
      throw new Error(
        `Mend: patches overlap: [${prev.start}, ${prev.end}) and [${cur.start}, ${cur.end})`,
      )
    }
  }
}

/** Applies patches from the end of the source backwards so that earlier offsets stay valid. */
export function applyPatches(source: string, patches: readonly Patch[]): string {
  validatePatches(source.length, patches)
  return [...sortedAscending(patches)]
    .reverse()
    .reduce((acc, p) => acc.slice(0, p.start) + p.text + acc.slice(p.end), source)
}

/** Maps an offset of the old source to the new source. Offsets inside a replaced range map to its start. */
export function mapOffset(patches: readonly Patch[], offset: number): number {
  let delta = 0
  for (const p of sortedAscending(patches)) {
    if (p.end <= offset && !(p.start === p.end && p.start === offset)) {
      delta += p.text.length - (p.end - p.start)
    } else if (p.start < offset) {
      return p.start + delta
    }
  }
  return offset + delta
}
