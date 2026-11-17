// Skin diary and history: progress photos (with signed links), skin logs
// and notes, recent step ticks, and finished-routine history.

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { addDays, localDateString } from '../lib/core/planNight'
import { queryClient, updateCache } from './queryClient'

const NONE = []
const NO_URLS = {}

export const diaryKeys = {
  photos: (userId) => ['diary', 'photos', userId],
  skinLogs: (userId) => ['diary', 'skinLogs', userId],
  stepHistory: (userId) => ['diary', 'stepHistory', userId],
  completions: (userId) => ['diary', 'completions', userId],
}

// Photos plus their signed links, fetched together. The bucket is private,
// so each photo needs a short-lived link — signed in ONE request for all
// of them (it used to be one request per photo).
export async function fetchProgressPhotos(userId) {
  const { data, error } = await supabase
    .from('progress_photos')
    .select('id, path, local_date, note, created_at')
    .eq('user_id', userId)
    .order('local_date', { ascending: false })
  if (error) throw error
  const photos = data || []
  let urls = {}
  if (photos.length > 0) {
    const { data: signed, error: signError } = await supabase.storage
      .from('progress-photos')
      .createSignedUrls(photos.map((p) => p.path), 3600)
    if (signError) console.error('PHOTO LINKS ERROR:', signError)
    urls = Object.fromEntries((signed || []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl]))
  }
  return { photos, urls }
}

export async function fetchSkinLogs(userId) {
  // No date floor — notes live here too, and the Skin diary timeline shows
  // them the way it shows photos, which also aren't capped.
  const { data, error } = await supabase
    .from('skin_logs')
    .select('local_date, breakouts, dryness, oiliness, redness, note')
    .eq('user_id', userId)
  if (error) throw error
  return data || []
}

export async function fetchStepHistory(userId) {
  const { data, error } = await supabase
    .from('routine_step_completions')
    .select('routine_step_id, local_date')
    .eq('user_id', userId)
    .gte('local_date', addDays(localDateString(), -21))
  if (error) throw error
  return data || []
}

export async function fetchProgressCompletions(userId) {
  const { data, error } = await supabase
    .from('routine_completions')
    .select('completed_date, completed_at, time_of_day')
    .eq('user_id', userId)
    .order('completed_date', { ascending: true })
  if (error) throw error
  return data || []
}

const reloader = (key, fn) => () =>
  queryClient.fetchQuery({ queryKey: key, queryFn: fn, staleTime: 0 }).catch((err) => {
    console.error(`${key[1].toUpperCase()} ERROR:`, err)
  })

export function useProgressPhotos(userId) {
  const key = diaryKeys.photos(userId)
  // Signed links last an hour; treat the list as fresh for 50 minutes.
  const query = useQuery({ queryKey: key, queryFn: () => fetchProgressPhotos(userId), enabled: false, staleTime: 50 * 60_000 })
  return {
    progressPhotos: query.data?.photos ?? NONE,
    photoUrls: query.data?.urls ?? NO_URLS,
    setProgressPhotos: (valueOrFn) =>
      updateCache(key, (current) => ({
        ...current,
        photos: typeof valueOrFn === 'function' ? valueOrFn(current.photos ?? NONE) : valueOrFn,
      }), { photos: NONE, urls: NO_URLS }),
    loadProgressPhotos: userId ? reloader(key, () => fetchProgressPhotos(userId)) : async () => {},
  }
}

export function useSkinLogs(userId) {
  const key = diaryKeys.skinLogs(userId)
  const query = useQuery({ queryKey: key, queryFn: () => fetchSkinLogs(userId), enabled: false })
  return {
    skinLogs: query.data ?? NONE,
    setSkinLogs: (valueOrFn) => updateCache(key, valueOrFn),
    loadSkinLogs: userId ? reloader(key, () => fetchSkinLogs(userId)) : async () => {},
  }
}

export function useStepHistory(userId) {
  const key = diaryKeys.stepHistory(userId)
  const query = useQuery({ queryKey: key, queryFn: () => fetchStepHistory(userId), enabled: false })
  return {
    stepHistory: query.data ?? NONE,
    loadStepHistory: userId ? reloader(key, () => fetchStepHistory(userId)) : async () => {},
  }
}

// Finished-routine history (streaks, calendar). Loads as soon as someone
// is signed in, as it did before.
export function useProgressCompletions(userId) {
  const key = diaryKeys.completions(userId)
  const query = useQuery({ queryKey: key, queryFn: () => fetchProgressCompletions(userId), enabled: !!userId })
  return {
    progressCompletions: query.data ?? NONE,
    setProgressCompletions: (valueOrFn) => updateCache(key, valueOrFn),
  }
}
