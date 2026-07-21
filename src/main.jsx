import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const serviceWorkerUrl = new URL('../sw.js', import.meta.url)
    navigator.serviceWorker.register(serviceWorkerUrl, { scope: './' }).catch((error) => {
      console.warn('Service worker registration failed:', error)
    })
  })
}
