import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import '@fontsource-variable/geist-mono'
import './design/tokens.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
