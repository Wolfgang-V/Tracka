// The person's products: active ones ("My products") and Empties.
// One field list and one loader each, so every refresh returns the same
// shape (a cut-down re-select after adding a product used to drop photos
// and images until the next reload).

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient, updateCache } from './queryClient'

export const PRODUCT_FIELDS = `
  id, product_id, opened_date, pao_months, expiry_date, added_at,
  photo_path, finished_at, is_active, marked_expired_at,
  products ( id, brand, name, category, ingredients, image_url )
`

// Stable empty value, so components re-rendering before the first load
// don't see a "new" array every time.
const NONE = []

export const productKeys = {
  active: (userId) => ['products', 'active', userId],
  empties: (userId) => ['products', 'empties', userId],
}

export async function fetchProducts(userId) {
  const { data, error } = await supabase
    .from('user_products')
    .select(PRODUCT_FIELDS)
    .eq('user_id', userId)
    .eq('is_active', true)
  if (error) throw error
  return data || []
}

export async function fetchEmpties(userId) {
  const { data, error } = await supabase
    .from('user_products')
    .select(PRODUCT_FIELDS)
    .eq('user_id', userId)
    .eq('is_active', false)
    .not('finished_at', 'is', null)
    .order('finished_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Active products load as soon as someone is signed in.
export function useProducts(userId) {
  const query = useQuery({
    queryKey: productKeys.active(userId),
    queryFn: () => fetchProducts(userId),
    enabled: !!userId,
  })
  return {
    products: query.data ?? NONE,
    setProducts: (valueOrFn) => updateCache(productKeys.active(userId), valueOrFn),
    // Re-read from the server and return the fresh list.
    reloadProducts: () =>
      queryClient.fetchQuery({ queryKey: productKeys.active(userId), queryFn: () => fetchProducts(userId), staleTime: 0 }),
  }
}

// Empties only load when a screen asks for them (loadEmpties).
export function useEmpties(userId) {
  const query = useQuery({
    queryKey: productKeys.empties(userId),
    queryFn: () => fetchEmpties(userId),
    enabled: false,
  })
  return {
    empties: query.data ?? NONE,
    setEmpties: (valueOrFn) => updateCache(productKeys.empties(userId), valueOrFn),
    loadEmpties: () => (userId ? query.refetch() : Promise.resolve()),
  }
}
