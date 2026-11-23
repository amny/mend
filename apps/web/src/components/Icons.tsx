// Inline stroke icons (24x24 grid). Decorative: hidden from assistive technology.
import type { ReactElement, ReactNode } from 'react'

const Icon = ({ children, size = 18 }: { children: ReactNode; size?: number }): ReactElement => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
)

export const UndoIcon = (): ReactElement => (
  <Icon>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Icon>
)

export const RedoIcon = (): ReactElement => (
  <Icon>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </Icon>
)

export const SearchIcon = (): ReactElement => (
  <Icon>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
)

export const ShieldIcon = (): ReactElement => (
  <Icon size={16}>
    <path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
)

export const FileIcon = (): ReactElement => (
  <Icon size={16}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </Icon>
)

export const FileUploadIcon = (): ReactElement => (
  <Icon size={36}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
    <path d="M12 18v-6" />
    <path d="m9 14.5 3-3 3 3" />
  </Icon>
)

export const CheckCircleIcon = (): ReactElement => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </Icon>
)

export const WarningIcon = (): ReactElement => (
  <Icon size={20}>
    <path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </Icon>
)

export const RefreshIcon = (): ReactElement => (
  <Icon size={20}>
    <path d="M20 12a8 8 0 1 1-2.3-5.7L20 8.6" />
    <path d="M20 3v5.6h-5.6" />
  </Icon>
)

export const ChevronUpIcon = (): ReactElement => (
  <Icon size={16}>
    <path d="m6 15 6-6 6 6" />
  </Icon>
)

export const ChevronDownIcon = (): ReactElement => (
  <Icon size={16}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
)

export const CloseIcon = (): ReactElement => (
  <Icon size={16}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
)

export const Logo = ({ size = 28 }: { size?: number }): ReactElement => (
  <img src="/mend-icon.svg" width={size} height={size} alt="" className="logo" />
)
