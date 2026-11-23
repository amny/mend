// Read-only preview with scripts enabled (V-02). Isolated: sandbox="allow-scripts" only, no same-origin access.

export interface Preview {
  /** Shows `source` (the current patched source). */
  readonly show: (source: string) => void
  readonly destroy: () => void
}

export function createPreview(container: HTMLElement): Preview {
  const frame = container.ownerDocument.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.title = 'Mend preview'
  Object.assign(frame.style, { border: '0', width: '100%', height: '100%', display: 'block' })
  container.append(frame)
  let url: string | undefined
  return {
    show: (source) => {
      const next = URL.createObjectURL(new Blob([source], { type: 'text/html;charset=utf-8' }))
      frame.src = next
      if (url) URL.revokeObjectURL(url)
      url = next
    },
    destroy: () => {
      frame.remove()
      if (url) URL.revokeObjectURL(url)
    },
  }
}
