// Modal dialog (docs/screens/dialogs.png) and the save toast.
import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { CheckCircleIcon } from './Icons'

export interface DialogAction {
  readonly label: string
  readonly onClick: () => void
  readonly kind?: 'primary' | 'danger' | 'secondary'
}

export interface DialogProps {
  readonly icon?: ReactNode
  readonly tone?: 'warning' | 'info'
  readonly title: string
  readonly children: ReactNode
  readonly actions: readonly DialogAction[]
  /** Escape and the backdrop call this. */
  readonly onClose: () => void
}

export function Dialog({
  icon,
  tone = 'info',
  title,
  children,
  actions,
  onClose,
}: DialogProps): ReactElement {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      className={`dialog dialog-${tone}`}
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div className="dialog-body">
        <h2 id="dialog-title" className="dialog-title">
          {icon && <span className="dialog-icon">{icon}</span>}
          {title}
        </h2>
        <div className="dialog-content">{children}</div>
      </div>
      <div className="dialog-actions">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            className={`button button-${a.kind ?? 'secondary'}`}
            onClick={a.onClick}
          >
            {a.label}
          </button>
        ))}
      </div>
    </dialog>
  )
}

export interface ToastProps {
  readonly title: string
  readonly body: string
  readonly onDone: () => void
}

const TOAST_MS = 4000

export function Toast({ title, body, onDone }: ToastProps): ReactElement {
  useEffect(() => {
    const timer = window.setTimeout(onDone, TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [onDone])
  return (
    <div className="toast" role="status">
      <span className="toast-icon">
        <CheckCircleIcon />
      </span>
      <div>
        <div className="toast-title">{title}</div>
        <div className="toast-body">{body}</div>
      </div>
    </div>
  )
}
