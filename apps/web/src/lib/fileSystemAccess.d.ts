// Parts of the File System Access API that Chrome/Edge ship but TypeScript's DOM library does not declare.

interface FilePickerAcceptType {
  description?: string
  accept: Record<string, string[]>
}

interface OpenFilePickerOptions {
  types?: FilePickerAcceptType[]
  excludeAcceptAllOption?: boolean
  multiple?: boolean
  id?: string
}

interface SaveFilePickerOptions {
  types?: FilePickerAcceptType[]
  excludeAcceptAllOption?: boolean
  suggestedName?: string
  startIn?: FileSystemHandle
  id?: string
}

type FileSystemPermissionMode = 'read' | 'readwrite'

interface FileSystemHandle {
  queryPermission(descriptor?: { mode?: FileSystemPermissionMode }): Promise<PermissionState>
  requestPermission(descriptor?: { mode?: FileSystemPermissionMode }): Promise<PermissionState>
}

interface Window {
  showOpenFilePicker?(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>
  showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>
}

interface DataTransferItem {
  getAsFileSystemHandle?(): Promise<FileSystemHandle | null>
}
