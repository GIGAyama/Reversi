import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { registerServiceWorker } from './pwa.js'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Service Worker は本番ビルドのみ登録する（開発時にキャッシュが邪魔しないように）
if (import.meta.env.PROD) {
  registerServiceWorker()
}
