// Live ads for one slot, cached for a few minutes so moving between
// screens doesn't re-ask the server every time.

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { fetchAds, isAdHidden } from '../lib/ads'

const NONE = []

export function useAds(userId, slot) {
  const query = useQuery({
    queryKey: ['ads', slot, userId],
    queryFn: () => fetchAds(supabase, slot),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  })
  return (query.data ?? NONE).filter((ad) => !isAdHidden(ad.placement_id))
}
