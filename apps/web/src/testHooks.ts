// Test-only hooks, compiled in only when VITE_MEND_TEST_HOOKS=1 (Playwright, AC-08).

declare global {
  interface Window {
    /** Present only in test builds. */
    __mendTestHooks?: { readonly failNextSave: () => void }
  }
}

let failNextSave = false

/** true once after window.__mendTestHooks.failNextSave() was called. */
export function consumeSaveFault(): boolean {
  const fail = failNextSave
  failNextSave = false
  return fail
}

if (import.meta.env.VITE_MEND_TEST_HOOKS === '1') {
  window.__mendTestHooks = {
    failNextSave: () => {
      failNextSave = true
    },
  }
}
