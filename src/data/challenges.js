// Challenges: the published catalogue, the person's own participations
// (with their ticked days), and each challenge's leaderboard.
//
// Loading is still triggered by the app (after a tick, on focus, at the
// 4am rollover) because each refresh may need to raise the celebration —
// these hooks just own the fetching and the cached copy.

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from './queryClient'
import { availableHere } from '../lib/core/region'

const NONE = []

export const challengeKeys = {
  all: (userId) => ['challenges', 'all', userId],
  leaderboard: (challengeId) => ['challenges', 'leaderboard', challengeId],
}

export async function fetchChallenges(userId) {
  const [catalogue, mine] = await Promise.all([
    supabase
      .from('challenges')
      .select('*')
      .eq('is_published', true)
      .order('created_at', { ascending: true }),
    supabase
      .from('challenge_participants')
      .select('*, challenges (*), challenge_days (local_date)')
      .eq('user_id', userId)
      .order('joined_at', { ascending: false }),
  ])
  if (catalogue.error || mine.error) throw catalogue.error || mine.error
  // Country-limited challenges are hidden elsewhere; ones already joined
  // still show through `mine`.
  return {
    catalogue: (catalogue.data || []).filter((c) => availableHere(c.countries)),
    mine: mine.data || [],
  }
}

export async function fetchLeaderboard(challengeId) {
  const { data, error } = await supabase.rpc('challenge_leaderboard', { p_challenge_id: challengeId })
  if (error) throw error
  return data || []
}

export function useChallenges(userId) {
  const key = challengeKeys.all(userId)
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchChallenges(userId),
    enabled: false, // the app decides when (see top of file)
  })
  return {
    challenges: query.data?.catalogue ?? NONE,
    myChallenges: query.data?.mine ?? NONE,
    challengesLoading: query.data === undefined,
    // Fresh from the server; resolves to { catalogue, mine }.
    reloadChallenges: () =>
      queryClient.fetchQuery({ queryKey: key, queryFn: () => fetchChallenges(userId), staleTime: 0 }),
  }
}

export function useLeaderboard(challengeId) {
  const key = challengeKeys.leaderboard(challengeId)
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchLeaderboard(challengeId),
    enabled: false,
  })
  return {
    leaderboard: query.data ?? NONE,
    leaderboardLoading: query.data === undefined || query.isFetching,
  }
}

export const reloadLeaderboard = (challengeId) =>
  queryClient.fetchQuery({
    queryKey: challengeKeys.leaderboard(challengeId),
    queryFn: () => fetchLeaderboard(challengeId),
    staleTime: 0,
  })
