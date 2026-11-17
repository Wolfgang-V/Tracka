// The person's routine (AM and PM, with their steps and products) and which
// steps are ticked today.

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { localDateString } from '../lib/core/planNight'
import { queryClient, updateCache } from './queryClient'

const NONE = []

export const routineKeys = {
  routines: (userId) => ['routine', 'routines', userId],
  completed: (userId, date) => ['routine', 'completed', userId, date],
}

// One nested-select round trip (routines -> routine_steps -> user_products
// -> products). Returns the newest active AM and PM routine — if a
// double-tapped "Create my routine" ever made two, the newest wins.
export async function fetchRoutines(userId) {
  const { data, error } = await supabase
    .from('routines')
    .select(`
      *,
      routine_steps (
        id,
        routine_id,
        user_product_id,
        step_order,
        step_name,
        frequency,
        days_of_week,
        is_active,
        user_products (
          id,
          opened_date,
          pao_months,
          photo_path,
          expiry_date,
          marked_expired_at,
          finished_at,
          products ( brand, name, category, ingredients, image_url )
        )
      )
    `)
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('routine_steps.is_active', true)
    .order('created_at', { ascending: false })
    .order('step_order', { foreignTable: 'routine_steps', ascending: true })
  if (error) throw error

  // Steps whose product went to Empties drop out — including ones finished
  // before "Mark as finished" also switched the step off.
  for (const routine of data || []) {
    routine.routine_steps = (routine.routine_steps || []).filter((step) => !step.user_products?.finished_at)
  }
  return {
    am: (data || []).find((r) => r.time_of_day === 'AM') || null,
    pm: (data || []).find((r) => r.time_of_day === 'PM') || null,
  }
}

export async function fetchCompletedSteps(userId, date) {
  const { data, error } = await supabase
    .from('routine_step_completions')
    .select('routine_step_id')
    .eq('user_id', userId)
    .eq('local_date', date)
  if (error) throw error
  return (data || []).map((row) => row.routine_step_id)
}

export function useRoutines(userId) {
  const key = routineKeys.routines(userId)
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchRoutines(userId),
    enabled: !!userId,
  })
  const setSteps = (slot) => (valueOrFn) =>
    updateCache(key, (current) => {
      const routine = current?.[slot]
      if (!routine) return current
      const steps = typeof valueOrFn === 'function' ? valueOrFn(routine.routine_steps || []) : valueOrFn
      return { ...current, [slot]: { ...routine, routine_steps: steps } }
    }, { am: null, pm: null })

  return {
    amRoutine: query.data?.am ?? null,
    pmRoutine: query.data?.pm ?? null,
    amSteps: query.data?.am?.routine_steps ?? NONE,
    pmSteps: query.data?.pm?.routine_steps ?? NONE,
    routinesLoading: query.isFetching || (!!userId && query.isPending),
    routinesReady: query.data !== undefined,
    setAmSteps: setSteps('am'),
    setPmSteps: setSteps('pm'),
    // Re-read from the server and return { am, pm }.
    reloadRoutines: () =>
      queryClient.fetchQuery({ queryKey: key, queryFn: () => fetchRoutines(userId), staleTime: 0 }),
  }
}

// Today's ticks without subscribing to them — for code that only needs the
// current value at the moment it runs (the tick action itself, screens
// that read them once on open). Only Today subscribes, so a tick
// re-renders Today and nothing else.
export const getCompletedSteps = (userId) =>
  queryClient.getQueryData(routineKeys.completed(userId, localDateString())) ?? NONE

export const updateCompletedSteps = (userId, valueOrFn) =>
  updateCache(routineKeys.completed(userId, localDateString()), valueOrFn)

// Today's ticks. The date is part of the key, so after the 4am rollover
// the next render asks for the new day automatically.
export function useCompletedSteps(userId) {
  const date = localDateString()
  const key = routineKeys.completed(userId, date)
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchCompletedSteps(userId, date),
    enabled: !!userId,
  })
  return {
    completedSteps: query.data ?? NONE,
    setCompletedSteps: (valueOrFn) => updateCache(key, valueOrFn),
  }
}
