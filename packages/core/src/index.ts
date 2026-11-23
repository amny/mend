// @mend/core: parsing, text/source position mapping, patch generation/application, pre-save verification.
// DOM-independent by design (requirements 6.1).
export type * from './types'
export { decodeUtf8, encodeUtf8, type DecodeError, type DecodeResult } from './encoding'
export { parseDocument, PARSE_OPTIONS } from './document'
export {
  encodeEdit,
  encodeLines,
  lineBreakMarkup,
  normalizeEditedValue,
  type EncodeLinesResult,
  type EncodeResult,
} from './encodeEdit'
export { applyPatches, mapOffset } from './patch'
export {
  verifySave,
  type VerificationIssue,
  type VerificationIssueKind,
  type VerificationResult,
} from './verify'
export {
  prepareSave,
  type SaveError,
  type SaveErrorCode,
  type SaveOptions,
  type SaveResult,
  type SaveSuccess,
} from './save'
