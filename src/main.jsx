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
