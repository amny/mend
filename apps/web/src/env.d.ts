/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" enables window.__mendTestHooks (src/testHooks.ts). Never set for production builds. */
  readonly VITE_MEND_TEST_HOOKS?: string
}
