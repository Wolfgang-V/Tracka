import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.jsx'
import { queryClient } from './data/queryClient'
import UnsubscribeScreen from './screens/UnsubscribeScreen.jsx'

// Email unsubscribe links (?unsubscribe=<token>) get their own page instead
// of the app: no sign-in, no onboarding redirects in the way.
const unsubscribeToken = new URLSearchParams(window.location.search).get('unsubscribe')

// The launch splash in index.html is normally dismissed by App once auth
// is ready. App never runs here, so drop the splash straight away, or the
// page stays a blue screen with the unsubscribe button hidden behind it.
if (unsubscribeToken !== null) {
  document.getElementById('splash')?.remove()
  document.documentElement.classList.remove('splashing')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#FFFFFF')
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {unsubscribeToken !== null ? (
      <UnsubscribeScreen token={unsubscribeToken} />
    ) : (
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    )}
  </StrictMode>,
)
