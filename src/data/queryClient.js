// One cache for everything the app loads from Supabase. Screens read from
// it through the hooks in src/data/*, so data loaded once is reused instead
// of fetched again, and the same hooks carry over to the Expo app.

import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Fresh for a minute; after that it's reused but refreshed quietly
      // the next time a screen asks for it.
      staleTime: 60_000,
      retry: 1,
      // The app already refreshes what it needs on screen changes; don't
      // also refetch everything every time the tab regains focus.
      refetchOnWindowFocus: false,
    },
  },
})

// setState-style updater for a cached list: accepts a value or a function
// of the current value, like a useState setter.
export const updateCache = (key, valueOrFn, fallback = []) =>
  queryClient.setQueryData(key, (current) =>
    typeof valueOrFn === 'function' ? valueOrFn(current ?? fallback) : valueOrFn
  )
