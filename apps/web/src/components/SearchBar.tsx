// Search box over the editing view (E-05). Enter: next, Shift+Enter: previous, Escape: close.
import { useEffect, useRef, type ReactElement } from 'react'
import type { SearchState } from '@mend/editor'
import { ChevronDownIcon, ChevronUpIcon, CloseIcon } from './Icons'

export interface SearchBarProps {
  readonly search: SearchState
  /** Changes whenever the bar is asked to focus again (Ctrl+F while open). */
  readonly focusToken: number
  readonly onQuery: (query: string) => void
  readonly onNext: () => void
  readonly onPrevious: () => void
  readonly onClose: () => void
}

export function SearchBar({
  search,
  focusToken,
  onQuery,
  onNext,
  onPrevious,
  onClose,
}: SearchBarProps): ReactElement {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [focusToken])
  const count =
    search.query === ''
      ? ''
      : search.count === 0
        ? '0件'
        : `${search.current + 1} / ${search.count}`
  return (
    <div className="searchbar" role="search">
      <input
        ref={input}
        type="text"
        aria-label="テキストを検索"
        placeholder="テキストを検索"
        value={search.query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey) onPrevious()
            else onNext()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      />
      <span className="searchbar-count" aria-live="polite">
        {count}
      </span>
      <button type="button" className="icon-button" aria-label="前の一致" onClick={onPrevious}>
        <ChevronUpIcon />
      </button>
      <button type="button" className="icon-button" aria-label="次の一致" onClick={onNext}>
        <ChevronDownIcon />
      </button>
      <button type="button" className="icon-button" aria-label="検索を閉じる" onClick={onClose}>
        <CloseIcon />
      </button>
    </div>
  )
}
