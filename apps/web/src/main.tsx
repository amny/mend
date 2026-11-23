import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createWebFileAdapter, type AfterSaveHook } from './lib/fileAdapter'
import { createRecentFiles } from './lib/recentFiles'
import './styles.css'
import './testHooks'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Mend: #root element not found in index.html')
}

/** S-04: the future Git history commits here. Empty in the MVP. */
const afterSave: AfterSaveHook = () => Promise.resolve()

createRoot(rootElement).render(
  <StrictMode>
    <App adapter={createWebFileAdapter()} recentFiles={createRecentFiles()} afterSave={afterSave} />
  </StrictMode>,
)
