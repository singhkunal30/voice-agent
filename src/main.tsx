import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { startAuth } from './state/auth'

// Restore any existing session before the first paint, so the header does not
// flash "Sign in" at someone who is already signed in. A no-op when Supabase
// is unconfigured, which is the default.
startAuth()

// HashRouter so the built bundle works from any static host — vite preview, a
// CDN, file:// — with no server-side route rewrites to configure.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
)
