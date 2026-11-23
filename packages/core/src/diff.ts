// Myers diff over code points, used inside the changed range of a text node (decision Q4).

export interface Hunk {
  readonly equal: boolean
  /** UTF-16 offsets into the old string. */
  readonly oldStart: number
  readonly oldEnd: number
  /** UTF-16 offsets into the new string. */
  readonly newStart: number
  readonly newEnd: number
}

/** Above this edit distance the diff gives up and reports a single change (still correct, less precise). */
const MAX_EDIT_DISTANCE = 256

function offsets(cps: readonly string[]): number[] {
  const out = [0]
  let acc = 0
  for (const cp of cps) {
    acc += cp.length
    out.push(acc)
  }
  return out
}

/** Returns hunks covering both strings completely, in order. */
export function diffCodePoints(oldText: string, newText: string): readonly Hunk[] {
  const a = Array.from(oldText)
  const b = Array.from(newText)
  const ao = offsets(a)
  const bo = offsets(b)
  const n = a.length
  const m = b.length
  const whole: readonly Hunk[] =
    n + m === 0
      ? []
      : [{ equal: false, oldStart: 0, oldEnd: oldText.length, newStart: 0, newEnd: newText.length }]

  const max = Math.min(n + m, MAX_EDIT_DISTANCE)
  const offset = max + 1
  let v: Int32Array = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  let found = -1
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))
      let x = down ? (v[offset + k + 1] ?? 0) : (v[offset + k - 1] ?? 0) + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) {
        found = d
        break
      }
    }
  }
  if (found < 0) return whole

  // Backtrack into a list of (x, y) steps.
  type Step = { readonly equal: boolean; readonly x: number; readonly y: number }
  const steps: Step[] = []
  let x = n
  let y = m
  for (let d = found; d > 0; d--) {
    v = trace[d] ?? v
    const k = x - y
    const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))
    const prevK = down ? k + 1 : k - 1
    const prevX = v[offset + prevK] ?? 0
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      x--
      y--
      steps.push({ equal: true, x, y })
    }
    if (down) {
      y--
      steps.push({ equal: false, x: -1, y })
    } else {
      x--
      steps.push({ equal: false, x, y: -1 })
    }
    x = prevX
    y = prevY
  }
  while (x > 0 && y > 0) {
    x--
    y--
    steps.push({ equal: true, x, y })
  }
  steps.reverse()

  // Group steps into hunks.
  const hunks: Hunk[] = []
  let ox = 0
  let oy = 0
  let i = 0
  while (i < steps.length) {
    const equal = steps[i]?.equal ?? false
    const sx = ox
    const sy = oy
    while (i < steps.length && (steps[i]?.equal ?? false) === equal) {
      const s = steps[i]
      if (s?.equal) {
        ox++
        oy++
      } else if (s && s.x >= 0) {
        ox++
      } else {
        oy++
      }
      i++
    }
    hunks.push({
      equal,
      oldStart: ao[sx] ?? 0,
      oldEnd: ao[ox] ?? 0,
      newStart: bo[sy] ?? 0,
      newEnd: bo[oy] ?? 0,
    })
  }
  return hunks
}
