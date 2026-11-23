// Start screen (docs/screens/start.png): drop zone, open button and recently opened files (F-01, F-06).
import { useState, type DragEvent, type ReactElement } from 'react'
import { formatOpenedAt } from '../lib/format'
import type { RecentFile } from '../lib/recentFiles'
import { FileIcon, FileUploadIcon, Logo } from './Icons'

export interface StartScreenProps {
  readonly recent: readonly RecentFile[]
  readonly onOpen: () => void
  readonly onOpenRecent: (file: RecentFile) => void
  readonly onDrop: (e: DragEvent<HTMLElement>) => void
}

export function StartScreen({
  recent,
  onOpen,
  onOpenRecent,
  onDrop,
}: StartScreenProps): ReactElement {
  const [over, setOver] = useState(false)
  const now = Date.now()
  return (
    <main className="start">
      <Logo size={64} />
      <h1 className="start-title">Mend</h1>
      <p className="start-tagline">AIが書いたHTMLを、そのまま直す。</p>

      <section
        className={`dropzone${over ? ' dropzone-over' : ''}`}
        aria-label="ファイルのドロップ先"
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false)
          onDrop(e)
        }}
      >
        <span className="dropzone-icon">
          <FileUploadIcon />
        </span>
        <p className="dropzone-title">HTMLファイルをここにドロップ</p>
        <p className="dropzone-or">または</p>
        <button type="button" className="button button-primary button-large" onClick={onOpen}>
          ファイルを開く <kbd>Ctrl+O</kbd>
        </button>
      </section>

      {recent.length > 0 && (
        <section className="recent" aria-labelledby="recent-title">
          <h2 id="recent-title" className="recent-title">
            最近開いたファイル
          </h2>
          <ul className="recent-list">
            {recent.map((r) => (
              <li key={r.id}>
                <button type="button" className="recent-item" onClick={() => onOpenRecent(r)}>
                  <FileIcon />
                  <span className="recent-name">{r.name}</span>
                  <span className="recent-date">{formatOpenedAt(r.openedAt, now)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="start-note">
        Web版は Chrome ／ Edge に対応しています。ファイルの内容は外部に送信されません。
      </p>
    </main>
  )
}
