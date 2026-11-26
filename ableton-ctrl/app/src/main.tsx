import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { Workbench } from './bench/Workbench.tsx'
import '@fontsource-variable/geist-mono'
import './design/tokens.css'
import { applyKiosk } from './kiosk.ts'

/** /?bench — the Mac workbench: the screen at real size beside tuning tools. */
const BENCH = new URLSearchParams(window.location.search).has('bench')

if (!BENCH) applyKiosk()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{BENCH ? <Workbench /> : <App />}</React.StrictMode>,
)
