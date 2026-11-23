// Shared types for @mend/core. Everything here is immutable data.

/** A replacement of source[start, end) with text. Generic on purpose (Phase 2/3 reuse it for tags/elements). */
export interface Patch {
  readonly start: number
  readonly end: number
  readonly text: string
}

/**
 * One token of a text node: DOM (UTF-16) range -> source range.
 * `atomic` tokens (character references, CR/CRLF) cannot be split; identity runs map 1:1 per code unit.
 */
export interface Segment {
  readonly domStart: number
  readonly domEnd: number
  readonly srcStart: number
  readonly srcEnd: number
  readonly atomic: boolean
}

export type TextRecordStatus =
  | 'editable'
  /** ASCII whitespace only. */
  | 'whitespace'
  /** Inside head, script, style, textarea, svg, option, button, etc. */
  | 'excluded-context'
  /** The source slice could not be mapped back to the parsed value (merged across markup, NUL, ...). */
  | 'mapping-mismatch'

export interface TextRecord {
  readonly id: number
  /** Decoded value as parsed (what the DOM text node holds before editing). */
  readonly value: string
  /** Source range of the text node. start === end for a virtual (emptied) node. */
  readonly start: number
  readonly end: number
  /** Empty for virtual nodes and for non-mappable nodes. */
  readonly segments: readonly Segment[]
  readonly status: TextRecordStatus
  /** Inside pre/listing/textarea/plaintext. The editor may also treat CSS white-space: pre* as preformatted. */
  readonly preformatted: boolean
  /** Human-readable location, e.g. "1. 背景と目的 › .card › p". */
  readonly label: string
  /** true when the node exists in the DOM but not in the source (emptied and saved). */
  readonly virtual: boolean
  /**
   * First child of pre/listing/textarea starting right after the start tag: a leading "\n"
   * written there would be dropped by the parser, so it must be written as a reference.
   */
  readonly leadingNewlineDropped: boolean
}

export interface DocAttribute {
  readonly name: string
  readonly value: string
  readonly namespace?: string
  readonly prefix?: string
}

export type DocumentMode = 'no-quirks' | 'quirks' | 'limited-quirks'

export interface DocDocument {
  readonly kind: 'document'
  readonly mode: DocumentMode
  readonly children: readonly DocNode[]
}

export interface DocDoctype {
  readonly kind: 'doctype'
  readonly name: string
  readonly publicId: string
  readonly systemId: string
}

export interface DocElement {
  readonly kind: 'element'
  readonly tagName: string
  readonly namespace: string
  readonly attrs: readonly DocAttribute[]
  readonly children: readonly DocNode[]
  /** Children of a <template> live here (the DOM keeps them in template.content). */
  readonly templateContent?: readonly DocNode[]
}

export interface DocText {
  readonly kind: 'text'
  readonly value: string
  /** Index into MendDocument.records; -1 for text inside template content. */
  readonly recordId: number
}

export interface DocComment {
  readonly kind: 'comment'
  readonly data: string
}

export type DocNode = DocDoctype | DocElement | DocText | DocComment

/** The single source of truth plus everything derived from it. */
export interface MendDocument {
  /** Source without BOM. All offsets refer to this string. */
  readonly source: string
  readonly tree: DocDocument
  /** Indexed by record id. */
  readonly records: readonly TextRecord[]
}

/** The current value of an edited text node. */
export interface TextEdit {
  readonly recordId: number
  /**
   * The new text. Two or more lines mean the text node is split by new <br> elements between the lines
   * (Shift+Enter); a single line is the same as a string.
   */
  readonly value: string | readonly string[]
  /** Set by the editor when computed white-space is pre/pre-wrap/break-spaces. OR-ed with record.preformatted. */
  readonly preformatted?: boolean
}
