// Hover frame and element label, drawn in the parent page on top of the iframe (V-03, V-04).
// Nothing is added to the iframe DOM.

export interface Overlay {
  /** `rect` is in the iframe viewport's coordinates. */
  readonly show: (rect: DOMRectReadOnly, label: string) => void
  readonly hide: () => void
}

const ACCENT = '#2FA39A'

export function createOverlay(layer: HTMLElement, frame: HTMLIFrameElement): Overlay {
  const doc = layer.ownerDocument
  const box = doc.createElement('div')
  box.dataset.mendOverlay = 'hover'
  Object.assign(box.style, {
    position: 'absolute',
    display: 'none',
    border: `1.5px solid ${ACCENT}`,
    borderRadius: '3px',
    background: 'rgba(47, 163, 154, 0.06)',
    pointerEvents: 'none',
    boxSizing: 'border-box',
  })
  const label = doc.createElement('div')
  Object.assign(label.style, {
    position: 'absolute',
    left: '-1.5px',
    bottom: '100%',
    padding: '1px 6px',
    font: '11px/16px ui-monospace, SFMono-Regular, Menlo, monospace',
    color: '#FFFFFF',
    background: ACCENT,
    borderRadius: '3px 3px 0 0',
    whiteSpace: 'nowrap',
  })
  box.append(label)
  layer.append(box)

  return {
    show: (rect, text) => {
      const x = frame.offsetLeft + frame.clientLeft + rect.left
      const y = frame.offsetTop + frame.clientTop + rect.top
      Object.assign(box.style, {
        display: 'block',
        left: `${x - 2}px`,
        top: `${y - 2}px`,
        width: `${rect.width + 4}px`,
        height: `${rect.height + 4}px`,
      })
      // Put the label inside the box when there is no room above it.
      label.style.bottom = y < 18 ? '' : '100%'
      label.style.top = y < 18 ? '0' : ''
      label.textContent = text
    },
    hide: () => {
      box.style.display = 'none'
    },
  }
}
