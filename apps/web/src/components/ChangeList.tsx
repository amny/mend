// Side panel: unsaved changes per text node, with "この変更を戻す" (E-06).
import type { ReactElement } from 'react'
import type { ChangeEntry } from '@mend/editor'
import { visibleText } from '../lib/format'
import { ShieldIcon } from './Icons'

export interface ChangeListProps {
  readonly changes: readonly ChangeEntry[]
  readonly activeId: number | null
  readonly readOnly: boolean
  readonly onReveal: (recordId: number) => void
  readonly onRevert: (recordId: number) => void
}

export function ChangeList({
  changes,
  activeId,
  readOnly,
  onReveal,
  onRevert,
}: ChangeListProps): ReactElement {
  return (
    <aside className="sidebar" aria-labelledby="changes-title">
      <div className="sidebar-head">
        <h2 id="changes-title">変更箇所</h2>
        <span className="sidebar-count">{changes.length}件</span>
      </div>
      {changes.length === 0 ? (
        <p className="sidebar-empty">保存されていない変更はありません。</p>
      ) : (
        <ul className="change-list">
          {changes.map((c) => (
            <li key={c.recordId}>
              <div
                className={`change${c.recordId === activeId ? ' change-active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => onReveal(c.recordId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onReveal(c.recordId)
                  }
                }}
              >
                <div className="change-label">{c.label}</div>
                <del className="change-before">{visibleText(c.before)}</del>
                <ins className="change-after">{visibleText(c.after)}</ins>
                {!readOnly && (
                  <button
                    type="button"
                    className="link-button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRevert(c.recordId)
                    }}
                  >
                    この変更を戻す
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="sidebar-note">
        <ShieldIcon />
        保存時に、変更した文字以外が元のファイルと1文字も違わないことを確認します。
      </p>
    </aside>
  )
}
