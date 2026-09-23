import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import { detectActive, slotRank } from './lib/core/actives'
import { planNight, localDateString, addDays } from './lib/core/planNight'
import { BRANDS } from './lib/core/brands'
import { searchBrands, searchProducts } from './lib/core/openBeautyFacts'
import { searchNigerianBrands, searchNigerianProducts } from './lib/core/nigerianProducts'
import { findIngredientDetails, checkRoutineConflicts } from './lib/core/ingredientGuide'
const VAPID_PUBLIC_KEY =
  'BL4tLhVl-G91FsMmVh2rhGbynJeqh1U6L3fIrg-E0rhC7fMLavWVfPLNGOjyM8TQqGFWaLmPByvs_3k2A23KsFE'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)))
}

const registerServiceWorker = async () => {
  if (!('serviceWorker' in navigator)) return null

  try {
    return await navigator.serviceWorker.register('/sw.js')
  } catch (error) {
    console.error('SERVICE WORKER ERROR:', error)
    return null
  }
}

const subscribeToPushNotifications = async () => {
  if (!('serviceWorker' in navigator)) {
    return { ok: false, reason: 'unsupported' }
  }

  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)

  // iOS hides the Notification API entirely outside the installed app,
  // so this has to come before any check for it.
  if (isIOS && !standalone) {
    return { ok: false, reason: 'needs_install' }
  }

  if (!('Notification' in window)) {
    return { ok: false, reason: 'unsupported' }
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return { ok: false, reason: permission }
  }

  const registration = await registerServiceWorker()
  if (!registration) return { ok: false, reason: 'no_sw' }

  try {
    await navigator.serviceWorker.ready

    const existing = await registration.pushManager.getSubscription()
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      }))

    const {
      data: { user: currentUser },
    } = await supabase.auth.getUser()

    if (!currentUser) return { ok: false, reason: 'logged_out' }

    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: currentUser.id,
        subscription: subscription.toJSON(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )

    if (error) {
      console.error('PUSH SUBSCRIPTION ERROR:', error)
      return { ok: false, reason: 'save_failed' }
    }

    return { ok: true }
  } catch (error) {
    console.error('PUSH SETUP ERROR:', error)
    return { ok: false, reason: 'failed' }
  }
}

function App() {
  const [screen, setScreen] = useState('welcome')
  const [user, setUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  // Defaults to light for everyone; dark mode is opt-in and remembered
  // per device, not switched automatically by time of day.
  const [themeMode, setThemeMode] = useState(() => {
    try {
      return localStorage.getItem('tracka-theme') === 'dark' ? 'dark' : 'light'
    } catch {
      return 'light'
    }
  })

  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')

  const [gender, setGender] = useState('')
  const [skinType, setSkinType] = useState('')
  const [concerns, setConcerns] = useState([])
  const [goals, setGoals] = useState([])
  const [sensitivity, setSensitivity] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [resetStatus, setResetStatus] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [settingsUsername, setSettingsUsername] = useState('')
  const [brandSuggestionsOpen, setBrandSuggestionsOpen] = useState(false)
  const [liveBrandMatches, setLiveBrandMatches] = useState([])
  const [productSuggestionsOpen, setProductSuggestionsOpen] = useState(false)
  const [liveProductMatches, setLiveProductMatches] = useState([])
  const [productSearchLoading, setProductSearchLoading] = useState(false)
  const [settingsStatus, setSettingsStatus] = useState(null)
  const [morningReminderEnabled, setMorningReminderEnabled] = useState(true)
  const [morningReminderTime, setMorningReminderTime] = useState('07:00')
  const [nightReminderEnabled, setNightReminderEnabled] = useState(true)
  const [nightReminderTime, setNightReminderTime] = useState('21:00')
  const [productBrand, setProductBrand] = useState('')
  const [productName, setProductName] = useState('')
  const [productCategory, setProductCategory] = useState('')
  const [productIngredients, setProductIngredients] = useState('')
  const [ingredientQuery, setIngredientQuery] = useState('')
  const [productOpenedDate, setProductOpenedDate] = useState('')
  const [productPaoMonths, setProductPaoMonths] = useState(0)
  const [products, setProducts] = useState([])

  const [amSelectedProducts, setAmSelectedProducts] = useState([])
  const [pmSelectedProducts, setPmSelectedProducts] = useState([])
  const [productFrequencies, setProductFrequencies] = useState({})
  const [productTimes, setProductTimes] = useState({})

  const [todayAmRoutine, setTodayAmRoutine] = useState(null)
  const [todayPmRoutine, setTodayPmRoutine] = useState(null)
  const [routinesLoading, setRoutinesLoading] = useState(true)
  const [routineHistory, setRoutineHistory] = useState([])
  const [selectedRoutine, setSelectedRoutine] = useState(null)
  const loadRoutineHistory = async () => {
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser()

  if (!currentUser) return

  const { data: routines, error: routinesError } =
    await supabase
      .from('routines')
      .select('*')
      .eq('user_id', currentUser.id)
      .eq('is_active', false)
      .order('created_at', { ascending: false })

  if (routinesError) {
    console.error('ROUTINE HISTORY ERROR:', routinesError)
    return
  }

  if (!routines || routines.length === 0) {
    setRoutineHistory([])
    return
  }

  const routineIds = routines.map((routine) => routine.id)

  const { data: steps, error: stepsError } =
    await supabase
      .from('routine_steps')
      .select(`
        id,
        routine_id,
        step_order,
        step_name,
        user_products (
          products (
            brand,
            category
          )
        )
      `)
      .in('routine_id', routineIds)
      .order('step_order', { ascending: true })

  if (stepsError) {
    console.error('ROUTINE HISTORY STEPS ERROR:', stepsError)
    return
  }

  const groupedRoutines = []

  routines.forEach((routine) => {
    const existing = groupedRoutines.find(
      (item) => item.routine_code === routine.routine_code
    )

    const routineWithSteps = {
      ...routine,
      steps: (steps || []).filter(
        (step) => step.routine_id === routine.id
      ),
    }

    if (existing) {
      existing.routines.push(routineWithSteps)
    } else {
      groupedRoutines.push({
        routine_code: routine.routine_code,
        created_at: routine.created_at,
        routines: [routineWithSteps],
      })
    }
  })

  console.log('GROUPED ROUTINE HISTORY:', groupedRoutines)
setRoutineHistory(groupedRoutines)
}
  const [todayAmSteps, setTodayAmSteps] = useState([])
  const [todayPmSteps, setTodayPmSteps] = useState([])
  const [completedSteps, setCompletedSteps] = useState([])
  const [stepHistory, setStepHistory] = useState([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [pushStatus, setPushStatus] = useState(null)
  const [progressCompletions, setProgressCompletions] = useState([])
  const [selectedProgressDate, setSelectedProgressDate] = useState(null)
  const [dayDetailSteps, setDayDetailSteps] = useState(null)
  const [dayDetailLoading, setDayDetailLoading] = useState(false)
  const [skinLogs, setSkinLogs] = useState([])
  const [selectedTrendDate, setSelectedTrendDate] = useState(null)
  const [progressPhotos, setProgressPhotos] = useState([])
  const [photoUrls, setPhotoUrls] = useState({})
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoError, setPhotoError] = useState(null)
  const [pendingPhoto, setPendingPhoto] = useState(null)
  const [comparePhotos, setComparePhotos] = useState([])
  const [viewingPhoto, setViewingPhoto] = useState(null)

  useEffect(() => {
   const checkUser = async () => {
  try {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
  console.log('No logged-in user found')
  return
}

  setUser(user)
  if (!window.location.search.includes('recovery=true')) {
    setScreen('today')
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .maybeSingle()

  if (error) {
    console.error('Profile error:', error)
    return
  }

 if (profile?.username) {
  setDisplayName(profile.username)
} else {
  setDisplayName(user.email?.split('@')[0] || 'there')
}
} finally {
  setAuthReady(true)
}
}

       if (window.location.search.includes('confirmed=true')) {
      setScreen('login')
      window.history.replaceState({}, '', window.location.pathname)
      setAuthReady(true)
    } else {
      checkUser()
    }

   const loadProducts = async () => {
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser()

      if (!currentUser) return

      const { data, error } = await supabase
        .from('user_products')
        .select(`
          id,
          product_id,
          opened_date,
          pao_months,
          products (
            id,
            brand,
            name,
            category,
            ingredients
          )
        `)
        .eq('user_id', currentUser.id)
        .eq('is_active', true)

      if (error) {
        console.error(error)
        return
      }

      setProducts(data || [])
    }

    loadProducts()
    const loadCompletedSteps = async () => {
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser()

  if (!currentUser) return

  const { data, error } = await supabase
    .from('routine_step_completions')
    .select('routine_step_id, completed_at')
    .eq('user_id', currentUser.id)
    .eq('local_date', localDateString())

  if (error) {
    console.error(error)
    return
  }

  setCompletedSteps(
    (data || []).map((item) => item.routine_step_id)
  )
}

loadCompletedSteps()

const loadProgressCompletions = async () => {
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser()

  if (!currentUser) return

  const { data, error } = await supabase
    .from('routine_completions')
    .select('completed_date, completed_at')
    .eq('user_id', currentUser.id)
    .order('completed_date', { ascending: true })

  if (error) {
    console.error(error)
    return
  }

  setProgressCompletions(data || [])
}
loadProgressCompletions()

    const {
  data: { subscription },
} = supabase.auth.onAuthStateChange((event, session) => {
 if (event === 'PASSWORD_RECOVERY') {
   setScreen('resetPassword')
 }

 if (session?.user) {
  setUser(session.user)
  setProducts([])
  setTodayAmRoutine(null)
  setTodayPmRoutine(null)
  setTodayAmSteps([])
  setTodayPmSteps([])
  setCompletedSteps([])
  setProgressCompletions([])
  loadProducts()
  loadCompletedSteps()
  loadProgressCompletions()
}
})

    return () => {
      subscription.unsubscribe()
    }
  }, [])
   
  const loadStepHistory = async () => {
  if (!user) return

  const { data, error } = await supabase
    .from('routine_step_completions')
    .select('routine_step_id, local_date')
    .eq('user_id', user.id)
    .gte('local_date', addDays(localDateString(), -21))

  if (error) {
    console.error('STEP HISTORY ERROR:', error)
    return
  }

  setStepHistory(data || [])
}

const loadDayDetails = async (date) => {
  setDayDetailLoading(true)

  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser()

  if (!currentUser) {
    setDayDetailLoading(false)
    return
  }

  const { data, error } = await supabase
    .from('routine_step_completions')
    .select(`
      routine_step_id,
      routine_steps (
        id,
        routine_id,
        step_name,
        user_products (
          products ( name, brand, category )
        )
      )
    `)
    .eq('user_id', currentUser.id)
    .eq('local_date', date)

  if (error) {
    console.error('DAY DETAILS ERROR:', error)
    setDayDetailSteps([])
    setDayDetailLoading(false)
    return
  }

  const withStep = (data || []).filter((entry) => entry.routine_steps)
  const routineIds = [...new Set(withStep.map((entry) => entry.routine_steps.routine_id))]

  let timeOfDayById = {}

  if (routineIds.length > 0) {
    const { data: routines, error: routinesError } = await supabase
      .from('routines')
      .select('id, time_of_day')
      .in('id', routineIds)

    if (routinesError) {
      console.error('DAY DETAILS ROUTINES ERROR:', routinesError)
    } else {
      timeOfDayById = Object.fromEntries((routines || []).map((r) => [r.id, r.time_of_day]))
    }
  }

  const steps = withStep.map((entry) => ({
    id: entry.routine_steps.id,
    name: entry.routine_steps.user_products?.products?.name || entry.routine_steps.step_name,
    brand: entry.routine_steps.user_products?.products?.brand,
    category: entry.routine_steps.user_products?.products?.category,
    timeOfDay: timeOfDayById[entry.routine_steps.routine_id] || null,
  }))

  setDayDetailSteps(steps)
  setDayDetailLoading(false)
}

const loadSkinLogs = async () => {
  if (!user) return

  const { data, error } = await supabase
    .from('skin_logs')
    .select('local_date, breakouts, dryness, oiliness, redness')
    .eq('user_id', user.id)
    .gte('local_date', addDays(localDateString(), -30))

  if (error) {
    console.error('SKIN LOG HISTORY ERROR:', error)
    return
  }

  setSkinLogs(data || [])
}

const loadProgressPhotos = async () => {
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser()

  if (!currentUser) return

  const { data, error } = await supabase
    .from('progress_photos')
    .select('id, path, local_date, note, created_at')
    .eq('user_id', currentUser.id)
    .order('local_date', { ascending: false })

  if (error) {
    console.error('PROGRESS PHOTOS ERROR:', error)
    return
  }

  setProgressPhotos(data || [])

  const signedEntries = await Promise.all(
    (data || []).map(async (photo) => {
      const { data: signed } = await supabase.storage
        .from('progress-photos')
        .createSignedUrl(photo.path, 3600)
      return [photo.path, signed?.signedUrl]
    })
  )
  setPhotoUrls(Object.fromEntries(signedEntries))
}

const uploadProgressPhoto = async (file, localDate) => {
  if (!file) return

  setPhotoError(null)
  setPhotoUploading(true)

  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser()

  if (!currentUser) {
    setPhotoUploading(false)
    return
  }

  const ext = file.name.split('.').pop() || 'jpg'
  const path = `${currentUser.id}/${Date.now()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('progress-photos')
    .upload(path, file, { contentType: file.type })

  if (uploadError) {
    console.error('PHOTO UPLOAD ERROR:', uploadError)
    setPhotoError("Couldn't upload that photo. Try again.")
    setPhotoUploading(false)
    return
  }

  const { error: insertError } = await supabase.from('progress_photos').insert({
    user_id: currentUser.id,
    path,
    local_date: localDate || localDateString(),
  })

  if (insertError) {
    console.error('PHOTO ROW ERROR:', insertError)
    setPhotoError("Couldn't save that photo. Try again.")
    setPhotoUploading(false)
    return
  }

  setPhotoUploading(false)
  await loadProgressPhotos()
}

const deleteProgressPhoto = async (photo) => {
  await supabase.storage.from('progress-photos').remove([photo.path])
  await supabase.from('progress_photos').delete().eq('id', photo.id)
  setViewingPhoto(null)
  setComparePhotos((ids) => ids.filter((id) => id !== photo.id))
  await loadProgressPhotos()
}

const saveProgressPhotoNote = async (photo, note) => {
  const { error } = await supabase.from('progress_photos').update({ note }).eq('id', photo.id)

  if (error) {
    console.error('PHOTO NOTE ERROR:', error)
    return
  }

  setProgressPhotos((photos) => photos.map((p) => (p.id === photo.id ? { ...p, note } : p)))
  setViewingPhoto((v) => (v ? { ...v, note } : v))
}

const updateSkinMetric = async (metric, delta) => {
  const today = localDateString()

  const current = skinLogs.find((log) => log.local_date === today) || {
    local_date: today,
    breakouts: 0,
    dryness: 0,
    oiliness: 0,
    redness: 0,
  }

  const nextValue = Math.max(0, Math.min(20, current[metric] + delta))
  const updated = { ...current, [metric]: nextValue }

  setSkinLogs((logs) =>
    logs.some((log) => log.local_date === today)
      ? logs.map((log) => (log.local_date === today ? updated : log))
      : [...logs, updated]
  )

  const { error } = await supabase.from('skin_logs').upsert(
    {
      user_id: user.id,
      local_date: today,
      breakouts: updated.breakouts,
      dryness: updated.dryness,
      oiliness: updated.oiliness,
      redness: updated.redness,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,local_date' }
  )

  if (error) console.error('SKIN LOG SAVE ERROR:', error)
}

const finishRoutine = async () => {
  const today = localDateString()

  const { error } = await supabase
    .from('routine_completions')
    .upsert(
      { user_id: user.id, completed_date: today },
      { onConflict: 'user_id,completed_date' }
    )

  if (error) {
    console.error('FINISH ROUTINE ERROR:', error)
    alert('That didn\'t save. Check your connection and try again.')
    return
  }

  setProgressCompletions((current) =>
    current.some((item) => item.completed_date === today)
      ? current
      : [...current, { completed_date: today, completed_at: new Date().toISOString() }]
  )

  setScreen('completed')
}

  const loadRoutines = async () => {
  setRoutinesLoading(true)

  if (!user) {
    setRoutinesLoading(false)
    return
  }

  const { data: routines, error: routinesError } = await supabase
    .from('routines')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_active', true)

  if (routinesError) {
    console.error('ROUTINES ERROR:', routinesError)
    return
  }

  const amRoutine = (routines || []).find(
    (routine) => routine.time_of_day === 'AM'
  )

  const pmRoutine = (routines || []).find(
    (routine) => routine.time_of_day === 'PM'
  )

  setTodayAmRoutine(amRoutine || null)
  setTodayPmRoutine(pmRoutine || null)

  const routineIds = [
    amRoutine?.id,
    pmRoutine?.id,
  ].filter(Boolean)

  if (routineIds.length === 0) {
  setTodayAmSteps([])
  setTodayPmSteps([])
  setRoutinesLoading(false)
  return
}

  const { data: steps, error: stepsError } = await supabase
    .from('routine_steps')
    .select(`
      id,
      routine_id,
      user_product_id,
      step_order,
      step_name,
      frequency,
      is_active
    `)
    .in('routine_id', routineIds)
    .eq('is_active', true)
    .order('step_order', { ascending: true })

if (stepsError) {
  console.error('STEPS ERROR:', stepsError)
  setRoutinesLoading(false)
  return
}  const userProductIds = [
    ...new Set(
      (steps || []).map((step) => step.user_product_id)
    ),
  ]

  let userProducts = []

  if (userProductIds.length > 0) {
    const { data, error: productsError } = await supabase
      .from('user_products')
      .select(`
        id,
        opened_date,
        pao_months,
        products (
          brand,
          name,
          category,
          ingredients
        )
      `)
      .in('id', userProductIds)

    if (productsError) {
      console.error('PRODUCTS ERROR:', productsError)
    } else {
      userProducts = data || []
    }
  }

  const productMap = {}

  userProducts.forEach((item) => {
    productMap[item.id] = item
  })

  const stepsWithProducts = (steps || []).map((step) => ({
    ...step,
    user_products:
      productMap[step.user_product_id] || null,
  }))

  setTodayAmSteps(
    stepsWithProducts.filter(
      (step) => step.routine_id === amRoutine?.id
    )
  )

   setTodayPmSteps(
    stepsWithProducts.filter(
      (step) => step.routine_id === pmRoutine?.id
    )
  )

  setRoutinesLoading(false)
}
  const toggleStepCompletion = async (stepId) => {
  const alreadyCompleted = completedSteps.includes(stepId)

  if (alreadyCompleted) {
    const { error } = await supabase
      .from('routine_step_completions')
      .delete()
      .eq('routine_step_id', stepId)
      .eq('user_id', user.id)

    if (error) {
      console.error(error)
      alert('Could not update this step.')
      return
    }

    setCompletedSteps(
      completedSteps.filter((id) => id !== stepId)
    )

    return
  }

  const { error } = await supabase
    .from('routine_step_completions')
    .upsert(
      {
        user_id: user.id,
        routine_step_id: stepId,
      },
      { onConflict: 'user_id,routine_step_id,local_date' }
    )

  if (error) {
    console.error(error)
    alert('Could not complete this step.')
    return
  }

  setCompletedSteps([...completedSteps, stepId])

setProgressCompletions([
  ...progressCompletions,
  {
    routine_step_id: stepId,
    completed_at: new Date().toISOString(),
  },
])
}

const todayString = localDateString()

const nightPlan = planNight({
  today: todayString,
  steps: todayPmSteps.map((step) => ({
    id: step.id,
    name: step.user_products?.products?.name || step.step_name,
    brand: step.user_products?.products?.brand,
    category: step.user_products?.products?.category,
    ingredients: step.user_products?.products?.ingredients,
    frequency: step.frequency,
    step_order: step.step_order,
    opened_date: step.user_products?.opened_date ?? null,
    pao_months: step.user_products?.pao_months ?? null,
  })),
  history: stepHistory.filter((entry) => entry.local_date < todayString),
})

const isNight = themeMode === 'dark'

const nightPalette = {
  bgHex: '#0B1E33',
  page: 'bg-[#0B1E33] text-[#EDF2FA]',
  text: 'text-[#EDF2FA]',
  mark: 'text-[#8FB8E8]',
  muted: 'text-[#9AAFC9]',
  faint: 'text-[#5F7593]',
  rail: 'bg-[#EDF2FA]/15',
  node: 'bg-[#142943] border border-[#EDF2FA]/15 text-[#9AAFC9]',
  nodeDone: 'bg-[#8FB8E8] text-[#0B1E33]',
  hair: 'border-[#EDF2FA]/10',
  btn: 'bg-[#8FB8E8] text-[#0B1E33]',
  surface: 'bg-[#142943]',
  chip: 'bg-[#8FB8E8]/15 text-[#8FB8E8]',
  danger: 'text-rose-300',
}

const dayPalette = {
  bgHex: '#F5F8FC',
  page: 'bg-[#F5F8FC] text-[#101B2D]',
  text: 'text-[#101B2D]',
  mark: 'text-[#2554EB]',
  muted: 'text-[#51637E]',
  faint: 'text-[#7488A3]',
  rail: 'bg-[#101B2D]/12',
  node: 'bg-white border border-[#101B2D]/12 text-[#51637E]',
  nodeDone: 'bg-[#2554EB] text-white',
  hair: 'border-[#101B2D]/10',
  btn: 'bg-[#2554EB] text-white',
  surface: 'bg-white',
  chip: 'bg-[#2554EB]/10 text-[#2554EB]',
  danger: 'text-rose-600',
}

const t = isNight ? nightPalette : dayPalette

const TAB_ITEMS = [
  {
    key: 'today',
    label: 'Today',
    screens: ['today'],
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}
        strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.5v2.4M12 19.1v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7" />
      </svg>
    ),
  },
  {
    key: 'skinProfile',
    label: 'Skin profile',
    screens: ['skinProfile', 'progress', 'skinTrends', 'progressPhotos'],
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}
        strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8.2" r="3.6" />
        <path d="M4.5 20c0-4.1 3.4-7 7.5-7s7.5 2.9 7.5 7" />
      </svg>
    ),
  },
  {
    key: 'products',
    label: 'My products',
    screens: ['products', 'addProduct', 'routinePlanner', 'ingredientChecker'],
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}
        strokeLinecap="round" strokeLinejoin="round">
        <path d="M6.5 8.5h11l-.9 11.5a1.5 1.5 0 0 1-1.5 1.4H8.9a1.5 1.5 0 0 1-1.5-1.4L6.5 8.5Z" />
        <path d="M9 8.5V6a3 3 0 0 1 6 0v2.5" />
      </svg>
    ),
  },
  {
    key: 'settings',
    label: 'Settings',
    screens: ['settings', 'settingsUsername', 'settingsPassword', 'reminders'],
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}
        strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="2.8" />
        <path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M17.7 6.3l-1.5 1.5M7.8 16.2l-1.5 1.5M17.7 17.7l-1.5-1.5M7.8 7.8 6.3 6.3" />
      </svg>
    ),
  },
]

const renderBottomTabs = (activeScreen, palette) => (
  <div
    className={`fixed inset-x-0 bottom-0 z-20 mx-auto flex w-full max-w-md items-stretch justify-between border-t px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 ${palette.surface} ${palette.hair}`}
  >
    {TAB_ITEMS.map((tab) => {
      const active = tab.screens.includes(activeScreen)
      return (
        <button
          key={tab.key}
          onClick={async () => {
            if (tab.key === 'skinProfile') await loadSkinProfile()
            setScreen(tab.key)
          }}
          className="flex flex-1 flex-col items-center gap-1 py-1.5"
        >
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-full ${
              active ? palette.chip : palette.faint
            }`}
          >
            {tab.icon(active)}
          </span>
          <span className={`text-[11px] font-semibold ${active ? palette.mark : palette.faint}`}>
            {tab.label}
          </span>
        </button>
      )
    })}
  </div>
)

const completedDates = new Set(
  progressCompletions
    .map((item) => item.completed_date)
    .filter(Boolean)
)

let currentStreak = 0
let cursor = completedDates.has(todayString) ? todayString : addDays(todayString, -1)

while (completedDates.has(cursor)) {
  currentStreak += 1
  cursor = addDays(cursor, -1)
}

const todaySkinLog = skinLogs.find((log) => log.local_date === todayString) || {
  breakouts: 0,
  dryness: 0,
  oiliness: 0,
  redness: 0,
}

const getPaoStatus = (item) => {
  if (!item.opened_date || !item.pao_months) return null

  const expires = new Date(item.opened_date + 'T00:00:00')
  expires.setMonth(expires.getMonth() + item.pao_months)

  const daysLeft = Math.round(
    (expires - new Date(todayString + 'T00:00:00')) / 86400000
  )

  if (daysLeft < 0) return { label: 'Expired', expired: true }
  if (daysLeft === 0) return { label: 'Expires today', expired: true }
  if (daysLeft <= 30) return { label: `${daysLeft}d left`, expired: false }

  return {
    label: `Use by ${expires.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`,
    expired: false,
  }
}

// Open Beauty Facts' category text is free-form ("moisturising cream",
// "gel nettoyant") — map it onto the fixed category list the app uses.
const guessCategory = (text) => {
  const lower = (text || '').toLowerCase()

  if (lower.includes('cleans') || lower.includes('wash') || lower.includes('nettoy')) return 'cleanser'
  if (lower.includes('toner') || lower.includes('tonique')) return 'toner'
  if (lower.includes('essence')) return 'essence'
  if (lower.includes('serum') || lower.includes('sérum')) return 'serum'
  if (lower.includes('sunscreen') || lower.includes('spf') || lower.includes('sun ')) return 'sunscreen'
  if (lower.includes('exfoliant') || lower.includes('peel') || lower.includes('scrub')) return 'exfoliant'
  if (lower.includes('mask') || lower.includes('masque')) return 'mask'
  if (lower.includes('treatment') || lower.includes('spot') || lower.includes('acne')) return 'treatment'
  if (lower.includes('moistur') || lower.includes('cream') || lower.includes('crème') || lower.includes('baume') || lower.includes('lotion')) return 'moisturizer'

  return ''
}

const getDefaultProductTime = (product) => {
  const text = `${product.products?.name || ''} ${product.products?.category || ''}`.toLowerCase()

  if (
    text.includes('sunscreen') ||
    text.includes('spf') ||
    text.includes('vitamin c')
  ) {
    return 'AM'
  }

  if (
    text.includes('retinol') ||
    text.includes('retinoid') ||
    text.includes('tretinoin') ||
    text.includes('aha') ||
    text.includes('bha') ||
    text.includes('exfol')
  ) {
    return 'PM'
  }

  return 'BOTH'
} 
useEffect(() => {
  if (products.length === 0) return

  const defaultTimes = {}

  products.forEach((item) => {
    if (!productTimes[item.id]) {
      defaultTimes[item.id] = getDefaultProductTime(item)
    }
  })

  if (Object.keys(defaultTimes).length > 0) {
    setProductTimes((current) => ({
      ...current,
      ...defaultTimes,
    }))
  }
}, [products])

useEffect(() => {
  if (products.length === 0) return

  const defaults = {}

  products.forEach((item) => {
    if (productFrequencies[item.id]) return

    const active = detectActive(item.products)

    defaults[item.id] =
      active === 'retinoid' ? 'every3'
      : active === 'aha' || active === 'bha' ? 'twice_week'
      : 'daily'
  })

  if (Object.keys(defaults).length > 0) {
    setProductFrequencies((current) => ({ ...current, ...defaults }))
  }
}, [products])

useEffect(() => {
  if (screen === 'today') {
    loadRoutines()
    loadStepHistory()
    loadSkinLogs()
  }

  if (screen === 'skinTrends') {
    loadSkinLogs()
  }

  if (screen === 'progressPhotos') {
    loadProgressPhotos()
  }

}, [screen])

// Live brand search against Open Beauty Facts, debounced so it doesn't
// fire on every keystroke. Merged with the local BRANDS list in the UI.
useEffect(() => {
  if (screen !== 'addProduct' || !productBrand.trim()) {
    setLiveBrandMatches([])
    return
  }

  const timer = setTimeout(() => {
    searchBrands(productBrand)
      .then(setLiveBrandMatches)
      .catch(() => setLiveBrandMatches([]))
  }, 300)

  return () => clearTimeout(timer)
}, [screen, productBrand])

// Once a brand is chosen, live-search that brand's products so picking
// one can fill in the name and category automatically. The Nigerian
// product list is local and curated, so it shows instantly; Open Beauty
// Facts results are appended once the debounced network search resolves.
useEffect(() => {
  if (screen !== 'addProduct' || !productBrand.trim()) {
    setLiveProductMatches([])
    return
  }

  const localMatches = searchNigerianProducts(productBrand, productName)
  setLiveProductMatches(localMatches)

  setProductSearchLoading(true)

  const timer = setTimeout(() => {
    searchProducts(productBrand, productName)
      .then((remoteMatches) => {
        const merged = [...localMatches]
        for (const match of remoteMatches) {
          const dupe = merged.some(
            (m) => m.name.toLowerCase() === match.name.toLowerCase() && m.brand.toLowerCase() === match.brand.toLowerCase()
          )
          if (!dupe) merged.push(match)
        }
        setLiveProductMatches(merged)
        setProductSearchLoading(false)
      })
      .catch(() => {
        setLiveProductMatches(localMatches)
        setProductSearchLoading(false)
      })
  }, 400)

  return () => clearTimeout(timer)
}, [screen, productBrand, productName])

const toggleOption = (value, current, setter) => {
  if (current.includes(value)) {
    setter(current.filter((item) => item !== value))
  } else {
    setter([...current, value])
  }
}

if (!authReady) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white">
      <img
        src="/logo-wordmark.jpg"
        alt="Tracka+"
        className="w-full max-w-[200px] animate-pulse"
      />
    </main>
  )
}

if (screen === 'auth') {
  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-6 pt-7">

        <button
          onClick={() => setScreen('welcome')}
          className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Back
        </button>

        <div className="mt-5">
          <h1 className="font-display text-[40px] font-light leading-[1.05] tracking-tight">
            Create your account
          </h1>

          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Start building a skincare routine you can actually stick to.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-5">

          <div>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              Email address
            </label>

            <input
              type="email"
              placeholder="you@example.com"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              className={`w-full rounded-2xl ${t.surface} border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            />
          </div>

          <div>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              Password
            </label>

            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Create a password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className={`w-full rounded-2xl ${t.surface} border ${t.hair} px-4 py-3.5 pr-12 text-[15px] outline-none`}
              />

              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className={`absolute right-4 top-1/2 -translate-y-1/2 ${t.faint}`}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.8}
                    stroke="currentColor"
                    className="h-5 w-5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.25 12s3.75-6.75 9.75-6.75S21.75 12 21.75 12s-3.75 6.75-9.75 6.75S2.25 12 2.25 12Z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                    />
                  </svg>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.8}
                    stroke="currentColor"
                    className="h-5 w-5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 3l18 18"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3.98 8.223A10.477 10.477 0 0 0 2.25 12c1.5 2.7 4.5 6.75 9.75 6.75a9.8 9.8 0 0 0 4.023-.84"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6.228 6.228A10.45 10.45 0 0 1 12 5.25c5.25 0 8.25 4.05 9.75 6.75a11.05 11.05 0 0 1-2.25 3.15"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              What should we call you?
            </label>

            <input
              type="text"
              placeholder="e.g. Deeyah"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={`w-full rounded-2xl ${t.surface} border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            />
          </div>

          <button
            onClick={async () => {
              const email = loginEmail
              const password = loginPassword

              if (!username || !email || !password) {
                alert('Please enter your email, password and name.')
                return
              }

              const { data, error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                  data: {
                    username,
                  },
                  emailRedirectTo: `${window.location.origin}/?confirmed=true`,
                },
              })

              if (error) {
                alert(error.message)
                return
              }

              if (!data.user) {
                alert('Account could not be created.')
                return
              }

              setProducts([])
              setUser(data.user)
              setDisplayName(username)

              if (data.session) {
                setScreen('skinProfile')
                return
              }

              alert(
                'Account created! Please check your email to confirm your account, then log in to continue your setup.'
              )

              setScreen('login')
            }}
            className={`mt-2 w-full rounded-2xl py-[18px] text-base font-bold ${t.btn}`}
          >
            Create account
          </button>

        </div>

        <p className={`mt-6 text-center text-[15px] ${t.muted}`}>
          Already have an account?{' '}
          <button
            onClick={() => setScreen('login')}
            className={`font-semibold ${t.mark}`}
          >
            Log in
          </button>
        </p>

      </div>
    </main>
  )
}

const loadReminderSettings = async () => {
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser()

  if (!currentUser) return

  const { data, error } = await supabase
    .from('reminder_settings')
    .select(
      'morning_enabled, morning_time, night_enabled, night_time'
    )
    .eq('user_id', currentUser.id)
    .maybeSingle()

  if (error) {
    console.error('REMINDER SETTINGS ERROR:', error)
    return
  }

  if (data) {
    setMorningReminderEnabled(data.morning_enabled)
    setMorningReminderTime(data.morning_time?.slice(0, 5) || '07:00')
    setNightReminderEnabled(data.night_enabled)
    setNightReminderTime(data.night_time?.slice(0, 5) || '21:00')
  }
}

const saveReminderSettings = async () => {
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser()

  if (!currentUser) {
    alert('Please log in again.')
    return
  }

  const { error } = await supabase
    .from('reminder_settings')
    .upsert(
      {
        user_id: currentUser.id,
        morning_enabled: morningReminderEnabled,
        morning_time: morningReminderTime,
        night_enabled: nightReminderEnabled,
        night_time: nightReminderTime,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'user_id',
      }
    )

  if (error) {
    console.error('SAVE REMINDER SETTINGS ERROR:', error)
    alert('Could not save your reminder settings.')
    return
  }

  alert('Reminder settings saved.')
}

  const loadSkinProfile = async () => {
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser()

  if (!currentUser) return

  const { data, error } = await supabase
    .from('skin_profiles')
    .select('gender, skin_type, concerns, goals, sensitivity')
    .eq('user_id', currentUser.id)
    .single()

  if (error) {
    console.error(error)
    return
  }

  if (data) {
    setGender(data.gender || '')
    setSkinType(data.skin_type || '')
    setConcerns(
      data.concerns
        ? data.concerns.split(',').map((item) => item.trim())
        : []
    )
    setGoals(
      data.goals
        ? data.goals.split(',').map((item) => item.trim())
        : []
    )
    setSensitivity(data.sensitivity || '')
  }
}
  if (screen === 'skinProfile') {
    return (
      <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
        <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-28 pt-7">

          <button
            onClick={() => setScreen('today')}
            className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
            Back
          </button>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              ['My progress', 'progress'],
              ['Skin insights', 'skinTrends'],
              ['Progress photos', 'progressPhotos'],
            ].map(([label, target]) => (
              <button
                key={target}
                onClick={() => setScreen(target)}
                className={`rounded-2xl px-2 py-2.5 text-center text-[12px] font-semibold leading-tight ${t.chip}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-5">
            <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
              Step 1 of 3
            </p>

            <h1 className="mt-2 font-display text-[36px] font-light leading-[1.05] tracking-tight">
              Tell us about your skin
            </h1>

            <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
              This helps Tracka+ organize your skincare journey around you.
            </p>
          </div>

          <div className="mt-8 flex flex-col gap-8">

            <section>
              <h2 className="mb-3 text-[17px] font-semibold">
                What is your gender?
              </h2>

              <div className="grid grid-cols-2 gap-2.5">
                {['Female', 'Male', 'Non-binary', 'Prefer not to say'].map((option) => (
                  <button
                    key={option}
                    onClick={() => setGender(option)}
                    className={`rounded-2xl border px-4 py-4 text-left text-[15px] font-medium transition ${
                      gender === option
                        ? `${t.chip} border-transparent`
                        : `${t.hair} ${t.muted}`
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-[17px] font-semibold">
                What is your skin type?
              </h2>

              <div className="grid grid-cols-2 gap-2.5">
                {['Normal', 'Dry', 'Oily', 'Combination'].map((type) => (
                  <button
                    key={type}
                    onClick={() => setSkinType(type)}
                    className={`rounded-2xl border px-4 py-4 text-left text-[15px] font-medium transition ${
                      skinType === type
                        ? `${t.chip} border-transparent`
                        : `${t.hair} ${t.muted}`
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h2 className="mb-1 text-[17px] font-semibold">
                What are your main skin concerns?
              </h2>

              <p className={`mb-3 text-[13px] ${t.faint}`}>
                Select all that apply.
              </p>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {[
                  'Acne',
                  'Dark circles',
                  'Dullness',
                  'Puffiness',
                  'Uneven texture',
                  'Visible pores',
                  'Dryness',
                  'Hyperpigmentation',
                  'Sensitivity',
                ].map((concern) => (
                  <button
                    key={concern}
                    onClick={() =>
                      toggleOption(concern, concerns, setConcerns)
                    }
                    className={`rounded-2xl border px-4 py-4 text-left text-[15px] font-medium transition ${
                      concerns.includes(concern)
                        ? `${t.chip} border-transparent`
                        : `${t.hair} ${t.muted}`
                    }`}
                  >
                    {concern}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h2 className="mb-1 text-[17px] font-semibold">
                What are your skincare goals?
              </h2>

              <p className={`mb-3 text-[13px] ${t.faint}`}>
                Select all that apply.
              </p>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {[
                  'Hydration',
                  'Clearer skin',
                  'Even skin tone',
                  'Healthy skin',
                ].map((goal) => (
                  <button
                    key={goal}
                    onClick={() =>
                      toggleOption(goal, goals, setGoals)
                    }
                    className={`rounded-2xl border px-4 py-4 text-left text-[15px] font-medium transition ${
                      goals.includes(goal)
                        ? `${t.chip} border-transparent`
                        : `${t.hair} ${t.muted}`
                    }`}
                  >
                    {goal}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-[17px] font-semibold">
                How sensitive is your skin?
              </h2>

              <div className="flex flex-col gap-2.5">
                {[
                  'Not sensitive',
                  'Sometimes sensitive',
                  'Very sensitive',
                ].map((option) => (
                  <button
                    key={option}
                    onClick={() => setSensitivity(option)}
                    className={`w-full rounded-2xl border px-4 py-4 text-left text-[15px] font-medium transition ${
                      sensitivity === option
                        ? `${t.chip} border-transparent`
                        : `${t.hair} ${t.muted}`
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </section>

            <button
              onClick={async () => {
                const {
                  data: { user: currentUser },
                } = await supabase.auth.getUser()

                if (!currentUser) {
                  alert('Please create an account first.')
                  return
                }

                const { error } = await supabase
                  .from('skin_profiles')
                  .insert({
                    user_id: currentUser.id,
                    gender: gender,
                    skin_type: skinType,
                    concerns: concerns.join(', '),
                    goals: goals.join(', '),
                    sensitivity: sensitivity,
                  })

                if (error) {
                  alert(error.message)
                  return
                }

                alert('Skin profile saved!')
                setScreen('products')
              }}
              className={`w-full rounded-2xl py-[18px] text-base font-bold ${t.btn}`}
            >
              Continue
            </button>

          </div>
        </div>

        {renderBottomTabs('skinProfile', t)}
      </main>
    )
  }

  if (screen === 'products') {
    return (
      <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
        <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-28 pt-7">

          <button
            onClick={() => setScreen('today')}
            className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
            Back
          </button>

          <div className="mt-5">
            <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
              Step 2 of 3
            </p>

            <h1 className="mt-2 font-display text-[36px] font-light leading-[1.05] tracking-tight">
              Add your products
            </h1>

            <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
              Add the products you already own so Tracka+ can organize them for you.
            </p>
          </div>

          <div className={`mt-8 rounded-3xl ${t.surface} p-5`}>

            <h2 className="text-[17px] font-semibold">
              Your products
            </h2>

            {products.length === 0 ? (
              <p className={`mt-2 text-[15px] ${t.muted}`}>
                You haven't added any products yet.
              </p>
            ) : (
              <div className="mt-5 grid grid-cols-2 gap-3">
                {products.map((item) => {
                  const status = getPaoStatus(item)

                  return (
                    <div
                      key={item.id}
                      className={`relative rounded-2xl border ${t.hair} p-4`}
                    >
                      <button
                        onClick={async () => {
                          const confirmed = window.confirm(
                            `Remove ${item.products.name} from your products?`
                          )

                          if (!confirmed) return

                          const { error } = await supabase
                            .from('user_products')
                            .update({ is_active: false })
                            .eq('id', item.id)

                          if (error) {
                            alert(error.message)
                            return
                          }

                          setProducts((current) =>
                            current.filter(
                              (product) => product.id !== item.id
                            )
                          )
                        }}
                        aria-label={`Remove ${item.products.name}`}
                        className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-base leading-none ${t.faint}`}
                      >
                        ×
                      </button>

                      <p className={`text-[11px] font-semibold uppercase tracking-wide ${t.faint}`}>
                        {item.products.category}
                      </p>

                      <p className="mt-2 pr-4 text-[14px] font-semibold leading-snug">
                        {item.products.name}
                      </p>

                      <p className={`mt-0.5 text-[12px] ${t.muted}`}>
                        {item.products.brand}
                      </p>

                      {status && (
                        <p className={`mt-2 text-[11px] font-semibold ${status.expired ? t.danger : t.faint}`}>
                          {status.label}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            <button
              onClick={() => setScreen('addProduct')}
              className={`mt-6 w-full rounded-2xl py-[18px] text-base font-bold ${t.btn}`}
            >
              + Add a product
            </button>

            <div className="mt-3 flex gap-3">
              <button
                onClick={() => setScreen('routinePlanner')}
                className={`flex-1 rounded-2xl border px-5 py-3.5 text-[15px] font-semibold ${t.hair} ${t.muted}`}
              >
                My routine
              </button>

              <button
                onClick={() => setScreen('today')}
                className={`flex-1 rounded-2xl border px-5 py-3.5 text-[15px] font-semibold ${t.hair} ${t.muted}`}
              >
                Back to today
              </button>
            </div>

            <button
              onClick={() => setScreen('ingredientChecker')}
              className={`mt-3 w-full rounded-2xl border px-5 py-3.5 text-[15px] font-semibold ${t.hair} ${t.muted}`}
            >
              Ingredient checker
            </button>

          </div>
        </div>

        {renderBottomTabs('products', t)}
      </main>
    )
  }

  if (screen === 'addProduct') {
    return (
      <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
        <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-6 pt-7">

          <button
            onClick={() => setScreen('products')}
            className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
            Products
          </button>

          <div className="mt-5">
            <h1 className="font-display text-[36px] font-light leading-[1.05] tracking-tight">
              Add a product
            </h1>

            <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
              Add a skincare product you already own.
            </p>
          </div>

          <div className="mt-8 flex flex-col gap-5">

            <div className="relative">
              <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
                Brand
              </label>

              <input
                type="text"
                placeholder="Search or type a brand"
                value={productBrand}
                onChange={(e) => {
                  setProductBrand(e.target.value)
                  setBrandSuggestionsOpen(true)
                }}
                onFocus={() => setBrandSuggestionsOpen(true)}
                onBlur={() => setTimeout(() => setBrandSuggestionsOpen(false), 150)}
                className={`w-full rounded-2xl ${t.surface} border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
              />

              {brandSuggestionsOpen && productBrand.trim() && (() => {
                const merged = searchNigerianBrands(productBrand)

                for (const brand of BRANDS) {
                  if (
                    brand.toLowerCase().includes(productBrand.trim().toLowerCase()) &&
                    !merged.some((m) => m.toLowerCase() === brand.toLowerCase())
                  ) {
                    merged.push(brand)
                  }
                }

                for (const brand of liveBrandMatches) {
                  if (!merged.some((m) => m.toLowerCase() === brand.toLowerCase())) {
                    merged.push(brand)
                  }
                }
                const matches = merged.slice(0, 8)

                if (matches.length === 0) return null

                return (
                  <div className={`absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-2xl border ${t.hair} ${t.surface} shadow-lg`}>
                    {matches.map((brand) => (
                      <button
                        key={brand}
                        type="button"
                        onMouseDown={() => {
                          setProductBrand(brand)
                          setBrandSuggestionsOpen(false)
                        }}
                        className={`block w-full px-4 py-2.5 text-left text-[14px] ${t.muted}`}
                      >
                        {brand}
                      </button>
                    ))}
                  </div>
                )
              })()}

              <p className={`mt-1.5 text-[12px] ${t.faint}`}>
                Not listed? Type the brand name.
              </p>
            </div>

            <div className="relative">
              <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
                Product name
              </label>

              <input
                type="text"
                placeholder="e.g. Hydrating Cleanser"
                value={productName}
                onChange={(e) => {
                  setProductName(e.target.value)
                  setProductIngredients('')
                  setProductSuggestionsOpen(true)
                }}
                onFocus={() => setProductSuggestionsOpen(true)}
                onBlur={() => setTimeout(() => setProductSuggestionsOpen(false), 150)}
                className={`w-full rounded-2xl ${t.surface} border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
              />

              {productSuggestionsOpen && productBrand.trim() && liveProductMatches.length > 0 && (
                <div className={`absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-2xl border ${t.hair} ${t.surface} shadow-lg`}>
                  {liveProductMatches.slice(0, 8).map((match) => (
                    <button
                      key={match.code}
                      type="button"
                      onMouseDown={() => {
                        setProductName(match.name)
                        const guessed = guessCategory(match.category)
                        if (guessed) setProductCategory(guessed)
                        setProductIngredients(match.ingredients || '')
                        setProductSuggestionsOpen(false)
                      }}
                      className="block w-full px-4 py-2.5 text-left"
                    >
                      <span className="block text-[14px] font-medium">{match.name}</span>
                      {match.category && (
                        <span className={`block text-[12px] capitalize ${t.faint}`}>{match.category}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {productBrand.trim() && (
                <p className={`mt-1.5 text-[12px] ${productIngredients ? t.mark : t.faint}`}>
                  {productIngredients
                    ? "Found this product's ingredients — we'll use them to catch clashes like retinol and acids in your routine."
                    : productSearchLoading
                      ? 'Searching Open Beauty Facts…'
                      : "Not listed? Just keep typing — it'll be added as you type it."}
                </p>
              )}
            </div>

            <div>
              <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
                Category
              </label>

              <select
                value={productCategory}
                onChange={(e) => setProductCategory(e.target.value)}
                className={`w-full rounded-2xl ${t.surface} border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
              >
                <option value="">Select a category</option>
                <option value="cleanser">Cleanser</option>
                <option value="toner">Toner</option>
                <option value="essence">Essence</option>
                <option value="serum">Serum</option>
                <option value="treatment">Treatment</option>
                <option value="moisturizer">Moisturizer</option>
                <option value="sunscreen">Sunscreen</option>
                <option value="exfoliant">Exfoliant</option>
                <option value="mask">Mask</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
                Opened date
              </label>

              <input
                type="date"
                value={productOpenedDate}
                onChange={(e) => setProductOpenedDate(e.target.value)}
                max={localDateString()}
                className={`w-full rounded-2xl ${t.surface} border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
              />
            </div>

            <div>
              <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
                Use within (after opening)
              </label>

              <div className="mt-2 flex flex-wrap gap-2">
                {[
                  ['None', 0],
                  ['3 months', 3],
                  ['6 months', 6],
                  ['9 months', 9],
                  ['12 months', 12],
                  ['18 months', 18],
                  ['24 months', 24],
                  ['36 months', 36],
                ].map(([label, months]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setProductPaoMonths(months)}
                    className={`rounded-full border px-4 py-2 text-[13px] font-semibold transition ${
                      productPaoMonths === months
                        ? `${t.chip} border-transparent`
                        : `${t.hair} ${t.muted}`
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={async () => {
                if (!productBrand || !productName || !productCategory) {
                  alert('Please fill in all fields.')
                  return
                }

                const {
                  data: { user: currentUser },
                } = await supabase.auth.getUser()

                if (!currentUser) {
                  alert('Please log in first.')
                  return
                }

                const {
                  data: product,
                  error: productError,
                } = await supabase
                  .from('products')
                  .insert({
                    brand: productBrand,
                    name: productName,
                    category: productCategory,
                    ingredients: productIngredients || null,
                  })
                  .select()
                  .single()

                if (productError) {
                  alert(productError.message)
                  return
                }

                const { error: userProductError } =
                  await supabase
                    .from('user_products')
                    .insert({
                      user_id: currentUser.id,
                      product_id: product.id,
                      is_active: true,
                      opened_date: productOpenedDate || null,
                      pao_months: productPaoMonths || null,
                    })

                if (userProductError) {
                  alert(userProductError.message)
                  return
                }

                const {
                  data: updatedProducts,
                  error: updatedProductsError,
                } = await supabase
                  .from('user_products')
                  .select(`
                    id,
                    product_id,
                    opened_date,
                    pao_months,
                    products (
                      id,
                      brand,
                      name,
                      category,
                      ingredients
                    )
                  `)
                  .eq('user_id', currentUser.id)
                  .eq('is_active', true)

                if (updatedProductsError) {
                  console.error(updatedProductsError)
                } else {
                  setProducts(updatedProducts || [])
                }

                setProductBrand('')
                setProductName('')
                setProductCategory('')
                setProductIngredients('')
                setProductOpenedDate('')
                setProductPaoMonths(0)
                setScreen('products')
              }}
              className={`mt-2 w-full rounded-2xl py-[18px] text-base font-bold ${t.btn}`}
            >
              Save product
            </button>

          </div>
        </div>
      </main>
    )
  }

  if (screen === 'ingredientChecker') {
    const details = findIngredientDetails(ingredientQuery)
    const hasQuery = ingredientQuery.trim().length > 0
    const noMatch = hasQuery && !details
    const isGenericList = (s) => /^all\b/i.test(s.trim())

    return (
      <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
        <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-28 pt-7">

          <button
            onClick={() => setScreen('products')}
            className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
            My products
          </button>

          <div className="mt-5">
            <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
              Ingredient checker
            </p>

            <h1 className="mt-2 font-display text-[36px] font-light leading-[1.05] tracking-tight">
              Know what you're using
            </h1>

            <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
              Learn what's inside your skincare routine and how to use it.
            </p>
          </div>

          <div className="mt-6">
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              Search ingredients
            </label>

            <input
              type="text"
              value={ingredientQuery}
              onChange={(e) => setIngredientQuery(e.target.value)}
              placeholder="e.g. Retinol, Vitamin C, Salicylic Acid"
              className={`w-full rounded-2xl ${t.surface} border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            />
          </div>

          {details && (
            <>
              <div className={`mt-5 rounded-3xl ${t.surface} p-5`}>
                <h2 className="text-[21px] font-semibold">{details.ingredient}</h2>

                {details.class && (
                  <span className={`mt-2 inline-block rounded-full px-3 py-1 text-[12px] font-semibold ${t.chip}`}>
                    {details.class}
                  </span>
                )}

                <div className={`mt-4 flex gap-6 border-t pt-4 ${t.hair}`}>
                  {details.bestTime && (
                    <div>
                      <p className={`text-[11px] font-semibold uppercase tracking-wide ${t.faint}`}>Best used</p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-[14px] font-semibold">
                        {/PM/i.test(details.bestTime) && !/AM/i.test(details.bestTime) ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                            stroke="currentColor" strokeWidth="1.8"
                            strokeLinecap="round" strokeLinejoin="round" className={t.mark}>
                            <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
                          </svg>
                        ) : /AM/i.test(details.bestTime) && !/PM/i.test(details.bestTime) ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                            stroke="currentColor" strokeWidth="1.8"
                            strokeLinecap="round" strokeLinejoin="round" className={t.mark}>
                            <circle cx="12" cy="12" r="4.2" />
                            <path d="M12 2.5v2.4M12 19.1v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7" />
                          </svg>
                        ) : null}
                        {details.bestTime}
                      </p>
                    </div>
                  )}

                  {details.typicalFrequency && (
                    <div>
                      <p className={`text-[11px] font-semibold uppercase tracking-wide ${t.faint}`}>Frequency</p>
                      <p className="mt-0.5 text-[14px] font-semibold">{details.typicalFrequency}</p>
                    </div>
                  )}
                </div>
              </div>

              {details.about && (
                <div className={`mt-4 rounded-3xl ${t.surface} p-5`}>
                  <h3 className="text-[15px] font-semibold">About {details.ingredient}</h3>
                  <p className={`mt-2 text-[14px] leading-relaxed ${t.muted}`}>{details.about}</p>
                </div>
              )}

              {details.mainUses && (
                <div className={`mt-4 rounded-3xl ${t.surface} p-5`}>
                  <h3 className="flex items-center gap-2 text-[15px] font-semibold">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className={t.mark}>
                      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
                    </svg>
                    Main Uses
                  </h3>
                  <ul className="mt-3 flex flex-col gap-1.5">
                    {details.mainUses.split(',').map((use) => use.trim()).filter(Boolean).map((use) => (
                      <li key={use} className={`flex items-center gap-2 text-[14px] ${t.muted}`}>
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.chip}`} />
                        <span className="capitalize">{use}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(details.howToUse || details.precaution) && (
                <div className={`mt-4 rounded-3xl ${t.surface} p-5`}>
                  <h3 className="text-[15px] font-semibold">How to use</h3>

                  {details.howToUse && (
                    <p className="mt-2 text-[14px] leading-relaxed">{details.howToUse}</p>
                  )}

                  {details.precaution && (
                    <div className={`mt-3 flex items-start gap-2 rounded-2xl ${t.chip} p-3`}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="1.8"
                        strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
                        <path d="M12 3.5 21 19H3L12 3.5Z" />
                        <path d="M12 9.5v4" />
                        <path d="M12 16.5v.01" />
                      </svg>
                      <p className="text-[13px] leading-relaxed">{details.precaution}</p>
                    </div>
                  )}
                </div>
              )}

              {(details.compatibleWith || details.useCautionWith) && (
                <div className={`mt-4 rounded-3xl ${t.surface} p-5`}>
                  <h3 className="text-[15px] font-semibold">Compatibility</h3>

                  {details.compatibleWith && (
                    <div className="mt-3">
                      <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                          stroke="currentColor" strokeWidth="2.2"
                          strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500">
                          <path d="M4 12.5l5.2 5.2L20 7" />
                        </svg>
                        Works well with
                      </p>
                      <p className={`mt-1 text-[14px] leading-relaxed ${t.muted}`}>
                        {isGenericList(details.compatibleWith)
                          ? "Plays well with the rest of your routine."
                          : details.compatibleWith}
                      </p>
                    </div>
                  )}

                  {details.useCautionWith && (
                    <div className={`${details.compatibleWith ? `mt-4 border-t pt-4 ${t.hair}` : 'mt-3'}`}>
                      <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                          stroke="currentColor" strokeWidth="1.8"
                          strokeLinecap="round" strokeLinejoin="round" className="text-amber-500">
                          <path d="M12 3.5 21 19H3L12 3.5Z" />
                          <path d="M12 9.5v4" />
                          <path d="M12 16.5v.01" />
                        </svg>
                        Use caution with
                      </p>
                      <p className={`mt-1 text-[14px] leading-relaxed ${t.muted}`}>{details.useCautionWith}</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {noMatch && (
            <div className={`mt-5 rounded-3xl border ${t.hair} p-5`}>
              <p className={`text-[14px] leading-relaxed ${t.muted}`}>
                We don't have "{ingredientQuery.trim()}" in our database yet. We can't confirm how to use it
                or what it mixes with — treat it carefully and check the product's own instructions.
              </p>
            </div>
          )}


        </div>

        {renderBottomTabs('products', t)}
      </main>
    )
  }

if (screen === 'login') {
  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-6 pt-7">

        <button
          onClick={() => setScreen('auth')}
          className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Back
        </button>

        <div className="mt-5">
          <h1 className="font-display text-[40px] font-light leading-[1.05] tracking-tight">
            Welcome back
          </h1>

          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Log in to continue your skincare journey.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-5">

          <div>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              Email address
            </label>

            <input
              type="email"
              placeholder="you@example.com"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              className={`w-full rounded-2xl ${t.surface} border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            />
          </div>

          <div>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              Password
            </label>

            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Your password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className={`w-full rounded-2xl ${t.surface} border ${t.hair} px-4 py-3.5 pr-12 text-[15px] outline-none`}
              />

              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className={`absolute right-4 top-1/2 -translate-y-1/2 ${t.faint}`}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.8}
                    stroke="currentColor"
                    className="h-5 w-5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.25 12s3.75-6.75 9.75-6.75S21.75 12 21.75 12s-3.75 6.75-9.75 6.75S2.25 12 2.25 12Z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                    />
                  </svg>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.8}
                    stroke="currentColor"
                    className="h-5 w-5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 3l18 18"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3.98 8.223A10.477 10.477 0 0 0 2.25 12c1.5 2.7 4.5 6.75 9.75 6.75a9.8 9.8 0 0 0 4.023-.84"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6.228 6.228A10.45 10.45 0 0 1 12 5.25c5.25 0 8.25 4.05 9.75 6.75a11.05 11.05 0 0 1-2.25 3.15"
                    />
                  </svg>
                )}
              </button>
            </div>

            <button
              onClick={() => {
                setResetStatus(null)
                setScreen('forgotPassword')
              }}
              className={`mt-2 block w-full text-right text-[13px] font-semibold ${t.mark}`}
            >
              Forgot password?
            </button>
          </div>

          <button
            onClick={async () => {
              if (!loginEmail || !loginPassword) {
                alert('Please enter your email and password.')
                return
              }

              const { data, error } =
                await supabase.auth.signInWithPassword({
                  email: loginEmail,
                  password: loginPassword,
                })

              if (error) {
                alert(error.message)
                return
              }

              setDisplayName('')

              setUser(data.user)

              const { data: profile, error: profileError } =
                await supabase
                  .from('profiles')
                  .select('username')
                  .eq('id', data.user.id)
                  .single()

              if (profileError) {
                console.error(profileError)
                alert('Profile could not be loaded: ' + profileError.message)
              } else {
                setDisplayName(profile.username)
              }

              setScreen('today')
            }}
            className={`mt-2 w-full rounded-2xl py-[18px] text-base font-bold ${t.btn}`}
          >
            Log in
          </button>

        </div>

        <p className={`mt-6 text-center text-[15px] ${t.muted}`}>
          Don't have an account?{' '}
          <button
            onClick={() => setScreen('auth')}
            className={`font-semibold ${t.mark}`}
          >
            Create account
          </button>
        </p>

      </div>
    </main>
  )
}

if (screen === 'forgotPassword') {
  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-6 pt-7">

        <button
          onClick={() => setScreen('login')}
          className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Back
        </button>

        <div className="mt-5">
          <h1 className="font-display text-[40px] font-light leading-[1.05] tracking-tight">
            Reset your password
          </h1>

          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Enter your email and we'll send you a link to reset your password.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-5">
          <div>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              Email address
            </label>

            <input
              type="email"
              placeholder="you@example.com"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              className={`w-full rounded-2xl ${t.surface} border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            />
          </div>

          <button
            onClick={async () => {
              if (!loginEmail) {
                alert('Please enter your email address.')
                return
              }

              const { error } = await supabase.auth.resetPasswordForEmail(loginEmail, {
                redirectTo: `${window.location.origin}/?recovery=true`,
              })

              if (error) {
                setResetStatus(error.message)
                return
              }

              setResetStatus("Check your email for a link to reset your password.")
            }}
            className={`mt-2 w-full rounded-2xl py-[18px] text-base font-bold ${t.btn}`}
          >
            Send reset link
          </button>

          {resetStatus && (
            <p className={`text-center text-[14px] leading-relaxed ${t.muted}`}>
              {resetStatus}
            </p>
          )}
        </div>

      </div>
    </main>
  )
}

if (screen === 'resetPassword') {
  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-6 pt-7">

        <div className="mt-5">
          <h1 className="font-display text-[40px] font-light leading-[1.05] tracking-tight">
            Choose a new password
          </h1>

          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Enter a new password for your account.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-5">
          <div>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              New password
            </label>

            <input
              type="password"
              placeholder="At least 6 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={`w-full rounded-2xl ${t.surface} border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            />
          </div>

          <div>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              Confirm new password
            </label>

            <input
              type="password"
              placeholder="Re-enter your password"
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              className={`w-full rounded-2xl ${t.surface} border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            />
          </div>

          <button
            onClick={async () => {
              if (!newPassword || newPassword.length < 6) {
                alert('Please enter a password with at least 6 characters.')
                return
              }

              if (newPassword !== confirmNewPassword) {
                alert('Passwords do not match.')
                return
              }

              const { data, error } = await supabase.auth.updateUser({
                password: newPassword,
              })

              if (error) {
                alert(error.message)
                return
              }

              setNewPassword('')
              setConfirmNewPassword('')
              setUser(data.user)

              const { data: profile, error: profileError } = await supabase
                .from('profiles')
                .select('username')
                .eq('id', data.user.id)
                .maybeSingle()

              setDisplayName(
                profileError || !profile?.username
                  ? data.user.email?.split('@')[0] || 'there'
                  : profile.username
              )

              window.history.replaceState({}, '', window.location.pathname)
              alert('Your password has been updated.')
              setScreen('today')
            }}
            className={`mt-2 w-full rounded-2xl py-[18px] text-base font-bold ${t.btn}`}
          >
            Update password
          </button>
        </div>

      </div>
    </main>
  )
}

if (screen === 'settings') {
  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-28 pt-7">

        <button
          onClick={() => setScreen('today')}
          className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Today
        </button>

        <div className="mt-5">
          <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
            Settings
          </p>

          <h1 className="mt-2 font-display text-[36px] font-light leading-[1.05] tracking-tight">
            Account settings
          </h1>

          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Manage your account.
          </p>
        </div>

        <div className={`mt-8 flex flex-col divide-y overflow-hidden rounded-3xl ${t.surface} ${t.hair}`}>
          <button
            onClick={() => {
              setSettingsUsername(displayName)
              setSettingsStatus(null)
              setScreen('settingsUsername')
            }}
            className="flex items-center justify-between px-5 py-4 text-left text-[15px] font-semibold"
          >
            Update your username
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round" className={t.faint}>
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>

          <button
            onClick={() => {
              setNewPassword('')
              setConfirmNewPassword('')
              setSettingsStatus(null)
              setScreen('settingsPassword')
            }}
            className="flex items-center justify-between px-5 py-4 text-left text-[15px] font-semibold"
          >
            Update your password
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round" className={t.faint}>
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>

          <button
            onClick={async () => {
              await loadReminderSettings()
              setScreen('reminders')
            }}
            className="flex items-center justify-between px-5 py-4 text-left text-[15px] font-semibold"
          >
            Reminders
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round" className={t.faint}>
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <div className={`mt-4 flex items-center justify-between rounded-3xl ${t.surface} p-5`}>
          <div className="pr-4">
            <p className="text-[15px] font-semibold">Dark mode</p>
            <p className={`mt-0.5 text-[13px] ${t.muted}`}>
              Tracka+ stays light by default. Turn this on if you prefer dark.
            </p>
          </div>

          <button
            type="button"
            aria-label="Toggle dark mode"
            onClick={() => {
              const next = themeMode === 'dark' ? 'light' : 'dark'
              setThemeMode(next)
              try {
                localStorage.setItem('tracka-theme', next)
              } catch {
                // localStorage unavailable (private mode, etc.) — theme just won't persist
              }
            }}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
              themeMode === 'dark' ? t.btn : t.rail
            }`}
          >
            <span
              className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${
                themeMode === 'dark' ? 'left-6' : 'left-1'
              }`}
            />
          </button>
        </div>

        <button
          onClick={async () => {
            const confirmed = window.confirm('Log out of Tracka+?')
            if (!confirmed) return

            await supabase.auth.signOut()
            setUser(null)
            setDisplayName('')
            setProducts([])
            setTodayAmRoutine(null)
            setTodayPmRoutine(null)
            setTodayAmSteps([])
            setTodayPmSteps([])
            setCompletedSteps([])
            setProgressCompletions([])
            setScreen('welcome')
          }}
          className={`mt-4 w-full rounded-2xl border px-5 py-4 text-left text-[15px] font-semibold ${t.hair} ${t.danger}`}
        >
          Log out
        </button>

      </div>

      {renderBottomTabs('settings', t)}
    </main>
  )
}

if (screen === 'settingsUsername') {
  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-6 pt-7">

        <button
          onClick={() => setScreen('settings')}
          className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Settings
        </button>

        <div className="mt-5">
          <h1 className="font-display text-[36px] font-light leading-[1.05] tracking-tight">
            Update your username
          </h1>

          {user?.email && (
            <p className={`mt-3 text-[15px] ${t.muted}`}>{user.email}</p>
          )}
        </div>

        <div className={`mt-8 rounded-3xl ${t.surface} p-5`}>
          <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
            Username
          </label>

          <input
            type="text"
            placeholder="e.g. Deeyah"
            value={settingsUsername}
            onChange={(e) => setSettingsUsername(e.target.value)}
            className={`w-full rounded-2xl border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
          />

          <button
            onClick={async () => {
              if (!settingsUsername.trim()) {
                alert('Please enter a username.')
                return
              }

              const {
                data: { user: currentUser },
              } = await supabase.auth.getUser()

              if (!currentUser) {
                alert('Please log in again.')
                return
              }

              const { error } = await supabase
                .from('profiles')
                .upsert(
                  { id: currentUser.id, username: settingsUsername.trim() },
                  { onConflict: 'id' }
                )

              if (error) {
                console.error('PROFILE UPDATE ERROR:', error)
                setSettingsStatus(
                  error.code === '23505'
                    ? 'That username is already taken. Try another one.'
                    : 'Could not save your username: ' + error.message
                )
                return
              }

              setDisplayName(settingsUsername.trim())
              setSettingsStatus('Username updated.')
            }}
            className={`mt-5 w-full rounded-2xl py-[16px] text-base font-bold ${t.btn}`}
          >
            Save username
          </button>

          {settingsStatus && (
            <p className={`mt-4 text-center text-[14px] leading-relaxed ${t.muted}`}>
              {settingsStatus}
            </p>
          )}
        </div>

      </div>
    </main>
  )
}

if (screen === 'settingsPassword') {
  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-6 pt-7">

        <button
          onClick={() => setScreen('settings')}
          className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Settings
        </button>

        <div className="mt-5">
          <h1 className="font-display text-[36px] font-light leading-[1.05] tracking-tight">
            Update your password
          </h1>
        </div>

        <div className={`mt-8 rounded-3xl ${t.surface} p-5`}>
          <div className="flex flex-col gap-4">
            <div>
              <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
                New password
              </label>

              <input
                type="password"
                placeholder="At least 6 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={`w-full rounded-2xl border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
              />
            </div>

            <div>
              <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
                Confirm new password
              </label>

              <input
                type="password"
                placeholder="Re-enter your password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                className={`w-full rounded-2xl border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
              />
            </div>
          </div>

          <button
            onClick={async () => {
              if (!newPassword || newPassword.length < 6) {
                alert('Please enter a password with at least 6 characters.')
                return
              }

              if (newPassword !== confirmNewPassword) {
                alert('Passwords do not match.')
                return
              }

              const { error } = await supabase.auth.updateUser({
                password: newPassword,
              })

              if (error) {
                setSettingsStatus(error.message)
                return
              }

              setNewPassword('')
              setConfirmNewPassword('')
              setSettingsStatus('Password updated.')
            }}
            className={`mt-5 w-full rounded-2xl py-[16px] text-base font-bold ${t.btn}`}
          >
            Update password
          </button>

          {settingsStatus && (
            <p className={`mt-4 text-center text-[14px] leading-relaxed ${t.muted}`}>
              {settingsStatus}
            </p>
          )}
        </div>

      </div>
    </main>
  )
}

if (screen === 'reminders') {
  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-6 pt-7">

        <button
          onClick={() => setScreen('settings')}
          className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Settings
        </button>

        <div className="mt-5">
          <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
            Reminders
          </p>

          <h1 className="mt-2 font-display text-[36px] font-light leading-[1.05] tracking-tight">
            Stay on track
          </h1>

          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Choose when Tracka+ should remind you about your skincare routine.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-4">

          {/* MORNING REMINDER */}
          <div className={`rounded-3xl ${t.surface} p-5`}>
            <div className="flex items-center justify-between gap-4">

              <div>
                <p className={`text-[11px] font-semibold uppercase tracking-wide ${t.mark}`}>
                  Morning
                </p>

                <h2 className="mt-1 text-[17px] font-semibold">
                  Morning routine
                </h2>

                <p className={`mt-1 text-[13px] leading-relaxed ${t.muted}`}>
                  Get a reminder when it's time for your morning routine.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setMorningReminderEnabled(
                    !morningReminderEnabled
                  )
                }
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                  morningReminderEnabled ? t.btn : t.rail
                }`}
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${
                    morningReminderEnabled
                      ? 'left-6'
                      : 'left-1'
                  }`}
                />
              </button>

            </div>

            {morningReminderEnabled && (
              <div className="mt-5">
                <label className={`text-[13px] font-semibold ${t.faint}`}>
                  Reminder time
                </label>

                <input
                  type="time"
                  value={morningReminderTime}
                  onChange={(e) =>
                    setMorningReminderTime(e.target.value)
                  }
                  className={`mt-2 w-full rounded-2xl border ${t.hair} px-4 py-3 text-[15px] outline-none`}
                />
              </div>
            )}
          </div>

          {/* NIGHT REMINDER */}
          <div className={`rounded-3xl ${t.surface} p-5`}>
            <div className="flex items-center justify-between gap-4">

              <div>
                <p className={`text-[11px] font-semibold uppercase tracking-wide ${t.mark}`}>
                  Night
                </p>

                <h2 className="mt-1 text-[17px] font-semibold">
                  Night routine
                </h2>

                <p className={`mt-1 text-[13px] leading-relaxed ${t.muted}`}>
                  Get a reminder when it's time for your night routine.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setNightReminderEnabled(
                    !nightReminderEnabled
                  )
                }
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                  nightReminderEnabled ? t.btn : t.rail
                }`}
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${
                    nightReminderEnabled
                      ? 'left-6'
                      : 'left-1'
                  }`}
                />
              </button>

            </div>

            {nightReminderEnabled && (
              <div className="mt-5">
                <label className={`text-[13px] font-semibold ${t.faint}`}>
                  Reminder time
                </label>

                <input
                  type="time"
                  value={nightReminderTime}
                  onChange={(e) =>
                    setNightReminderTime(e.target.value)
                  }
                  className={`mt-2 w-full rounded-2xl border ${t.hair} px-4 py-3 text-[15px] outline-none`}
                />
              </div>
            )}
          </div>

        </div>

        <div className={`mt-4 rounded-3xl ${t.surface} p-5`}>
          <h2 className="text-[17px] font-semibold">
            Notifications on this device
          </h2>

          <p className={`mt-2 text-[13px] leading-relaxed ${t.muted}`}>
            Reminders arrive on whichever device you turn this on. On iPhone, add
            Tracka+ to your home screen first and open it from there.
          </p>

          <button
            onClick={async () => {
              const result = await subscribeToPushNotifications()

              setPushStatus(
                result.ok
                  ? "You're set. Reminders will arrive on this device."
                  : result.reason === 'needs_install'
                    ? 'Add Tracka+ to your home screen first, then open it from there.'
                    : result.reason === 'denied'
                      ? 'Notifications are blocked. Turn them on in your browser settings for this site.'
                      : result.reason === 'unsupported'
                        ? "This browser can't do notifications. Try Chrome or Safari."
                        : "That didn't work. Try again in a moment."
              )
            }}
            className={`mt-5 w-full rounded-2xl py-[18px] text-base font-bold ${t.btn}`}
          >
            Turn on notifications
          </button>

          {pushStatus && (
            <p className={`mt-4 text-[13px] ${t.muted}`}>{pushStatus}</p>
          )}
        </div>

        <button
          onClick={saveReminderSettings}
          className={`mt-6 w-full rounded-2xl py-[18px] text-base font-bold ${t.btn}`}
        >
          Save reminder settings
        </button>

      </div>
    </main>
  )
}
if (screen === 'today') {
  const amSteps = todayAmSteps
    .map((step) => ({
      id: step.id,
      name: step.user_products?.products?.name || step.step_name,
      brand: step.user_products?.products?.brand,
      category: step.user_products?.products?.category,
      ingredients: step.user_products?.products?.ingredients,
      active: 'none',
    }))
    .sort((a, b) => slotRank(a.category) - slotRank(b.category))

  const pmSteps = nightPlan.steps

  const amDone = amSteps.filter((s) => completedSteps.includes(s.id)).length
  const pmDone = pmSteps.filter((s) => completedSteps.includes(s.id)).length

  const amIngredientWarnings = checkRoutineConflicts(amSteps)
  const pmIngredientWarnings = checkRoutineConflicts(pmSteps)

  const renderSteps = (steps, palette) => (
    <div className="flex flex-col gap-3">
      {steps.map((step, index) => {
        const done = completedSteps.includes(step.id)

        return (
          <button
            key={step.id}
            onClick={() => toggleStepCompletion(step.id)}
            className={`flex w-full items-center gap-4 rounded-2xl p-4 text-left transition ${
              done ? palette.chip : `border ${palette.hair}`
            }`}
          >
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold ${
                done ? palette.nodeDone : palette.node
              }`}
            >
              {done ? (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.4"
                  strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12.5l5.2 5.2L20 7" />
                </svg>
              ) : (
                index + 1
              )}
            </span>

            <span className="min-w-0 flex-1">
              {step.brand && (
                <span className={`block truncate text-[12px] font-medium ${palette.faint}`}>
                  {step.brand}
                </span>
              )}

              <span
                className={`mt-0.5 block text-[16px] font-semibold ${
                  done ? 'line-through' : ''
                }`}
              >
                {step.name}
              </span>

              {step.category && (
                <span className={`mt-0.5 block text-[12px] capitalize ${palette.muted}`}>
                  {step.category}
                </span>
              )}

              {!done && step.expired && (
                <span className="mt-2 flex flex-wrap gap-1.5">
                  <span className={`inline-block rounded-full bg-rose-500/10 px-2.5 py-1 text-xs font-semibold ${palette.danger}`}>
                    Past use-by date
                  </span>
                </span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )

  return (
    <main className="min-h-screen">

      <div className={`${dayPalette.page} transition-colors duration-500`}>
      <div className="mx-auto flex w-full max-w-md flex-col px-6 pt-7">

        <div className="relative flex items-center justify-between">
          <span className={`text-[15px] font-semibold tracking-wide ${dayPalette.mark}`}>
            Tracka+
          </span>

          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setMenuOpen(!menuOpen)}
            className={`-mr-2 flex h-11 w-11 items-center justify-center ${dayPalette.muted}`}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>

          {menuOpen && (
            <div className={`absolute right-0 top-12 z-10 w-52 overflow-hidden rounded-2xl ${dayPalette.surface} shadow-xl`}>
              {[
                ['My progress', 'progress'],
                ['Skin insights', 'skinTrends'],
                ['Progress photos', 'progressPhotos'],
              ].map(([label, target]) => (
                <button
                  key={target}
                  onClick={() => {
                    setMenuOpen(false)
                    setScreen(target)
                  }}
                  className={`block w-full px-5 py-3.5 text-left text-[15px] ${dayPalette.muted}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4">
          <p className={`text-[15px] ${dayPalette.muted}`}>
            Hello, {displayName}
          </p>

          <h1 className="mt-1.5 font-display text-[50px] font-light leading-[0.95] tracking-tight">
            Today
          </h1>

          <p className={`mt-2.5 text-sm ${dayPalette.muted}`}>
            {new Date().toLocaleDateString('en-GB', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </p>
        </div>

        <div className="mt-10">
          <p className={`text-[13px] font-semibold uppercase tracking-wide ${dayPalette.mark}`}>
            Morning
          </p>

          <h2 className="mt-1 font-display text-[28px] font-light leading-[1.05] tracking-tight">
            AM Routine
          </h2>

          <div className="mt-6">
            {routinesLoading ? (
              <p className={`text-sm ${dayPalette.muted}`}>Getting your routine…</p>
            ) : !todayAmRoutine ? (
              <div>
                <p className={`text-[15px] leading-relaxed ${dayPalette.muted}`}>
                  You haven't set up a morning routine yet.
                </p>
                <button
                  onClick={() => setScreen('routinePlanner')}
                  className={`mt-5 rounded-2xl px-5 py-3.5 text-[15px] font-bold ${dayPalette.btn}`}
                >
                  Build my routine
                </button>
              </div>
            ) : (
              renderSteps(amSteps, dayPalette)
            )}
          </div>

          {amIngredientWarnings.length > 0 && (
            <div className={`mt-4 flex flex-col gap-2.5 rounded-2xl border ${dayPalette.hair} p-4`}>
              {amIngredientWarnings.map((w, i) => (
                <div key={i}>
                  <p className="text-[13px] font-semibold">
                    {w.ingredientA} + {w.ingredientB}
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${dayPalette.chip}`}>
                      {w.relationship}
                    </span>
                  </p>
                  <p className={`mt-0.5 text-[13px] leading-relaxed ${dayPalette.muted}`}>{w.message}</p>
                </div>
              ))}
            </div>
          )}

          {todayAmRoutine && !routinesLoading && (
            <div className="mt-7 flex flex-col gap-3.5">
              <p className={`text-[13px] ${dayPalette.faint}`}>
                {amDone} of {amSteps.length} done
              </p>

              <button
                onClick={finishRoutine}
                className={`w-full rounded-2xl py-[18px] text-base font-bold ${dayPalette.btn}`}
              >
                Complete morning routine
              </button>
            </div>
          )}
        </div>

      </div>
      </div>

      <div
        aria-hidden="true"
        style={{
          height: 110,
          backgroundImage: `linear-gradient(to bottom, ${dayPalette.bgHex}, ${nightPalette.bgHex})`,
        }}
      />

      <div className={`${nightPalette.page} transition-colors duration-500`}>
      <div className="mx-auto flex w-full max-w-md flex-col px-6 pb-28">
          <p className={`text-[13px] font-semibold uppercase tracking-wide ${nightPalette.mark}`}>
            Night
          </p>

          <h2 className="mt-1 font-display text-[28px] font-light leading-[1.05] tracking-tight">
            PM Routine
          </h2>

          <div className="mt-6">
            {routinesLoading ? (
              <p className={`text-sm ${nightPalette.muted}`}>Getting your routine…</p>
            ) : !todayPmRoutine ? (
              <div>
                <p className={`text-[15px] leading-relaxed ${nightPalette.muted}`}>
                  You haven't set up a night routine yet.
                </p>
                <button
                  onClick={() => setScreen('routinePlanner')}
                  className={`mt-5 rounded-2xl px-5 py-3.5 text-[15px] font-bold ${nightPalette.btn}`}
                >
                  Build my routine
                </button>
              </div>
            ) : (
              <>
                {renderSteps(pmSteps, nightPalette)}
              </>
            )}
          </div>

          {pmIngredientWarnings.length > 0 && (
            <div className={`mt-4 flex flex-col gap-2.5 rounded-2xl border ${nightPalette.hair} p-4`}>
              {pmIngredientWarnings.map((w, i) => (
                <div key={i}>
                  <p className="text-[13px] font-semibold">
                    {w.ingredientA} + {w.ingredientB}
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${nightPalette.chip}`}>
                      {w.relationship}
                    </span>
                  </p>
                  <p className={`mt-0.5 text-[13px] leading-relaxed ${nightPalette.muted}`}>{w.message}</p>
                </div>
              ))}
            </div>
          )}

          {todayPmRoutine && !routinesLoading && (
            <div className="mt-7 flex flex-col gap-3.5">
              <p className={`text-[13px] ${nightPalette.faint}`}>
                {pmDone} of {pmSteps.length} done
              </p>

              <button
                onClick={finishRoutine}
                className={`w-full rounded-2xl py-[18px] text-base font-bold ${nightPalette.btn}`}
              >
                Complete night routine
              </button>
            </div>
          )}

        {(todayAmRoutine || todayPmRoutine) && !routinesLoading && (
          <div className={`mt-8 rounded-3xl ${nightPalette.surface} p-5`}>
            <h2 className={`text-[15px] font-semibold ${nightPalette.text}`}>
              Log today's skin condition
            </h2>

            <div className="mt-5 flex flex-col gap-4">
              {[
                ['breakouts', 'Breakouts', '#f43f5e'],
                ['dryness', 'Dryness', '#f59e0b'],
                ['oiliness', 'Oiliness', '#10b981'],
                ['redness', 'Redness', '#8b5cf6'],
              ].map(([key, label, color]) => (
                <div key={key}>
                  <div className="flex items-center justify-between">
                    <span className={`text-[13px] font-medium ${nightPalette.muted}`}>{label}</span>
                    <span className={`text-[13px] font-semibold tabular-nums ${nightPalette.text}`}>
                      {todaySkinLog[key]}
                    </span>
                  </div>

                  <div className="mt-1.5 flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => updateSkinMetric(key, -1)}
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-base leading-none ${nightPalette.hair} ${nightPalette.muted}`}
                    >
                      −
                    </button>

                    <div className={`h-2.5 flex-1 overflow-hidden rounded-full ${nightPalette.rail}`}>
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(100, (todaySkinLog[key] / 10) * 100)}%`,
                          backgroundColor: color,
                        }}
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => updateSkinMetric(key, 1)}
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-base leading-none ${nightPalette.btn}`}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
      </div>

      {renderBottomTabs('today', dayPalette)}
    </main>
  )
}


if (screen === 'routinePlanner') {
  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-6 pt-7">

        <div className="flex items-center justify-between">
          <button
            onClick={() => setScreen('today')}
            className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
            Today
          </button>

          <button
            onClick={async () => {
              await loadRoutineHistory()
              setScreen('routineHistory')
            }}
            className={`rounded-2xl border px-4 py-2.5 text-[13px] font-semibold ${t.hair} ${t.muted}`}
          >
            History
          </button>
        </div>

        <div className="mt-5">
          <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
            My routine
          </p>

          <h1 className="mt-2 font-display text-[36px] font-light leading-[1.05] tracking-tight">
            Build your routine
          </h1>

          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Tell Tracka+ when you want to use each product, and it will organize your morning and night routines.
          </p>
        </div>

        <div className={`mt-8 rounded-3xl ${t.surface} p-5`}>

          <h2 className="text-[17px] font-semibold">
            Your products
          </h2>

          <p className={`mt-1 text-[13px] ${t.muted}`}>
            Choose when you use each product.
          </p>

          <div className="mt-5 flex flex-col gap-3">

            {products.length === 0 ? (
              <div className={`rounded-2xl border ${t.hair} p-5 text-center`}>
                <p className={`text-[15px] ${t.muted}`}>
                  You haven't added any products yet.
                </p>

                <button
                  onClick={() => setScreen('addProduct')}
                  className={`mt-4 rounded-xl px-5 py-3 text-[13px] font-semibold ${t.btn}`}
                >
                  + Add a product
                </button>

              </div>
            ) : (
              products.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-2xl border ${t.hair} p-4`}
                >
                  <p className={`text-[11px] font-semibold uppercase tracking-wide ${t.faint}`}>
                    {item.products?.brand}
                  </p>

                  <p className="mt-1 text-[15px] font-medium">
                    {item.products?.name}
                  </p>

                  <p className={`mt-1 text-[12px] ${t.muted}`}>
                    {item.products?.category}
                  </p>

                  <div className="mt-4">
                    <label className={`text-[12px] font-semibold ${t.faint}`}>
                      When do you want to use this?
                    </label>

                    <select
                      className={`mt-2 w-full rounded-xl ${t.surface} border ${t.hair} px-4 py-3 text-[14px] outline-none`}
                      value={productTimes[item.id] || ''}
                      onChange={(e) =>
                        setProductTimes({
                          ...productTimes,
                          [item.id]: e.target.value,
                        })
                      }
                    >
                      <option value="" disabled>
                        Choose time
                      </option>

                      <option value="AM">
                        Morning (AM)
                      </option>

                      <option value="PM">
                        Night (PM)
                      </option>

                      <option value="BOTH">
                        Morning & Night (AM & PM)
                      </option>
                    </select>
                  </div>

                  <div className="mt-4">
                    <label className={`text-[12px] font-semibold ${t.faint}`}>
                      How often?
                    </label>

                    <select
                      className={`mt-2 w-full rounded-xl ${t.surface} border ${t.hair} px-4 py-3 text-[14px] outline-none`}
                      value={productFrequencies[item.id] || 'daily'}
                      onChange={(e) =>
                        setProductFrequencies({
                          ...productFrequencies,
                          [item.id]: e.target.value,
                        })
                      }
                    >
                      <option value="daily">Every day</option>
                      <option value="alternate">Every other day</option>
                      <option value="every3">Every 3 days</option>
                      <option value="twice_week">Twice a week</option>
                      <option value="once_week">Once a week</option>
                    </select>
                  </div>
                </div>
              ))
            )}

          </div>
        </div>

        <button
  onClick={async () => {
    if (products.length === 0) {
      alert('Please add at least one product.')
      return
    }

    const missingTime = products.find(
  (item) => !productTimes[item.id]
)

if (missingTime) {
  alert('Please choose a time for every product.')
  return
}

    const currentUser = user

if (!currentUser) {
  alert('Please log in first.')
  return
}

       const { error: deactivateError } = await supabase
      .from('routines')
      .update({ is_active: false })
      .eq('user_id', currentUser.id)

   if (deactivateError) {
  alert('Routine update failed: ' + deactivateError.message)
  return
}

   const routineCode =
  `TRK-${Date.now().toString().slice(-6)}`

const routineTimes = ['AM', 'PM']

for (const time of routineTimes) {
  const productsForTime = products.filter((item) => {
    const selectedTime = productTimes[item.id]

    return (
      selectedTime === time ||
      selectedTime === 'BOTH'
    )
  })

  if (productsForTime.length === 0) continue

  const { data: routine, error: routineError } =
    await supabase
      .from('routines')
      .insert({
        user_id: currentUser.id,
        name: `${time} Routine`,
        time_of_day: time,
        routine_code: routineCode,
        is_active: true,
      })
      .select()
      .single()

  if (routineError) {
    alert('Routine creation failed: ' + routineError.message)
    return
  }

  const routineSteps = productsForTime.map(
    (item, index) => ({
      routine_id: routine.id,
      user_product_id: item.id,
      step_order: index + 1,
      step_name: item.products?.name || 'Skincare product',
      frequency: productFrequencies[item.id] || 'daily',
      is_active: true,
    })
  )

  const { error: stepsError } =
    await supabase
      .from('routine_steps')
      .insert(routineSteps)

  if (stepsError) {
    alert('Routine steps failed: ' + stepsError.message)
    return
  }
}
setScreen('today')
loadRoutines()
  }}
  className={`mt-6 w-full rounded-2xl py-[18px] text-base font-bold ${t.btn}`}
>
  Create my routine
</button>

        <button
          onClick={() => setScreen('products')}
          className={`mt-3 w-full rounded-2xl border px-5 py-3.5 text-[15px] font-semibold ${t.hair} ${t.muted}`}
        >
          Back to my products
        </button>

      </div>
    </main>
  )
}
if (screen === 'routineHistory') {
  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-6 pt-7">

        <button
          onClick={() => setScreen('routinePlanner')}
          className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          My routine
        </button>

        <div className="mt-5">
          <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
            Routine history
          </p>

          <h1 className="mt-2 font-display text-[36px] font-light leading-[1.05] tracking-tight">
            Your previous routines
          </h1>

          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Look back at the routines you have used before.
          </p>
        </div>

        {routineHistory.length === 0 ? (
          <div className={`mt-8 rounded-3xl ${t.surface} p-6 text-center`}>
            <p className="text-[15px] font-medium">
              No previous routines yet.
            </p>

            <p className={`mt-2 text-[13px] ${t.muted}`}>
              Your old routines will appear here when you create a new routine.
            </p>
          </div>
        ) : (
          <div className="mt-8 flex flex-col gap-4">
            {routineHistory.map((routine) => (
              <div
                key={routine.routine_code || routine.created_at}
                className={`rounded-3xl ${t.surface} p-5`}
              >
                <p className={`text-[11px] font-semibold uppercase tracking-wide ${t.faint}`}>
                  Previous routine
                </p>

                <button
                  onClick={() => {
                    setSelectedRoutine(routine)
                    setScreen('routineDetails')
                  }}
                  className={`mt-1 text-left text-[19px] font-semibold ${t.mark}`}
                >
                  {routine.routine_code || 'Routine'}
                </button>

                <p className={`mt-1 text-[13px] ${t.muted}`}>
                  {new Date(routine.created_at).toLocaleString('default', {
                    month: 'long',
                    year: 'numeric',
                  })}
                </p>
              </div>
            ))}
          </div>
        )}

      </div>
    </main>
  )
}
if (screen === 'routineDetails') {
  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-6 pt-7">

        <button
          onClick={() => setScreen('routineHistory')}
          className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          History
        </button>

        <div className="mt-5">
          <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
            Routine details
          </p>

          <h1 className="mt-2 font-display text-[36px] font-light leading-[1.05] tracking-tight">
            {selectedRoutine?.routine_code || 'Routine'}
          </h1>

          <p className={`mt-3 text-[15px] ${t.muted}`}>
            {selectedRoutine?.created_at
              ? new Date(selectedRoutine.created_at).toLocaleDateString('en-GB', {
                  day: 'numeric', month: 'long', year: 'numeric',
                })
              : 'Previous routine'}
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-5">
          {selectedRoutine?.routines
            ?.sort((a, b) => {
              if (a.time_of_day === 'AM') return -1
              if (b.time_of_day === 'AM') return 1
              return 0
            })
            .map((routine) => (
              <div
                key={routine.id}
                className={`rounded-3xl ${t.surface} p-5`}
              >
                <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
                  {routine.time_of_day === 'AM' ? 'Morning' : 'Night'}
                </p>

                <h2 className="mt-0.5 text-[17px] font-semibold">
                  {routine.time_of_day === 'AM'
                    ? 'Morning routine'
                    : 'Night routine'}
                </h2>

                <div className="mt-4 flex flex-col gap-3">
                  {routine.steps.length === 0 ? (
                    <p className={`text-[15px] ${t.muted}`}>
                      No steps recorded.
                    </p>
                  ) : (
                    routine.steps.map((step, index) => (
                      <div
                        key={step.id}
                        className={`flex items-center gap-4 rounded-2xl border ${t.hair} p-4`}
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold ${t.node}`}
                        >
                          {index + 1}
                        </span>

                        <span className="min-w-0 flex-1">
                          {step.user_products?.products?.brand && (
                            <span className={`block truncate text-[12px] font-medium ${t.faint}`}>
                              {step.user_products.products.brand}
                            </span>
                          )}

                          <span className="mt-0.5 block text-[15px] font-semibold">
                            {step.step_name}
                          </span>

                          {step.user_products?.products?.category && (
                            <span className={`mt-0.5 block text-[12px] capitalize ${t.muted}`}>
                              {step.user_products.products.category}
                            </span>
                          )}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))}
        </div>

      </div>
    </main>
  )
}
if (screen === 'completed') {
  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-6 pb-6 pt-7 text-center">

        <span className={`flex h-14 w-14 items-center justify-center rounded-full text-2xl ${t.chip}`}>
          ✓
        </span>

        <h1 className="mt-6 font-display text-[44px] font-light leading-[1.02] tracking-tight">
          {isNight ? 'Routine complete' : 'All done for the morning'}
        </h1>

        <p className={`mt-3 max-w-[280px] text-[15px] leading-relaxed ${t.muted}`}>
          Great job taking care of your skin. See you {isNight ? 'in the morning' : 'tonight'} 👋
        </p>

        <button
          onClick={() => setScreen('progress')}
          className={`mt-8 w-full rounded-2xl py-[18px] text-base font-bold ${t.btn}`}
        >
          View my streak
        </button>

      </div>
    </main>
  )
}
if (screen === 'progress') {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstWeekday = new Date(year, month, 1).getDay()
  const leadingBlanks = firstWeekday === 0 ? 6 : firstWeekday - 1

  const stepDays = new Set(stepHistory.map((entry) => entry.local_date))

  const streakMessage = (n) => {
    if (n === 0) return 'Complete your routine to start a streak'
    if (n === 1) return 'Great start! Keep it going tomorrow.'
    if (n === 2) return 'You are building a habit! Keep it going'
    if (n >= 30) return '30 days! Look at you building a skincare habit.'
    if (n >= 14) return 'Two weeks strong. Your consistency is showing.'
    if (n >= 7) return 'One week of consistency!'
    return `${n} days down. Keep your streak alive!`
  }

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-6 pt-7">

        <button
          onClick={() => setScreen('today')}
          className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Today
        </button>

        <div className="mt-5">
          <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
            My progress
          </p>

          <h1 className="mt-2 font-display text-[36px] font-light leading-[1.05] tracking-tight">
            Your consistency
          </h1>

          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Keep track of your skincare routine and build your streak.
          </p>
        </div>

        <div className={`mt-8 rounded-3xl ${t.surface} p-5`}>
          <p className={`flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#F97316">
              <path d="M12 2c1.5 3 .5 4.5-.5 6C10 6.5 9.5 5 10 3c-2.5 2-5 5.5-5 9a7 7 0 0 0 14 0c0-4-2.5-7-3.5-8.5.3 2-.5 3.3-1.5 4.2C13.8 6 13 4 12 2Z" />
            </svg>
            Current streak
          </p>

          <h2 className="mt-1 font-display text-[40px] font-light leading-[0.95] tracking-tight">
            {currentStreak} {currentStreak === 1 ? 'day' : 'days'}
          </h2>

          <p className={`mt-2 text-[14px] leading-relaxed ${t.muted}`}>
            {streakMessage(currentStreak)}
          </p>
        </div>

        <div className={`mt-4 rounded-3xl ${t.surface} px-5 py-6`}>

          <div className="flex items-baseline justify-between">
            <span className="font-display text-[22px]">
              {now.toLocaleDateString('en-GB', { month: 'long' })}
            </span>
            <span className={`text-[13px] ${t.faint}`}>
              {completedDates.size} of {now.getDate()} days
            </span>
          </div>

          <div className="mt-5 grid grid-cols-7 gap-[7px] text-center">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((letter, i) => (
              <span key={i} className={`pb-1 text-[11px] font-semibold ${t.faint}`}>
                {letter}
              </span>
            ))}

            {Array.from({ length: leadingBlanks }, (_, i) => <span key={`b${i}`} />)}

            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1
              const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const finished = completedDates.has(key)
              const partial = !finished && stepDays.has(key)
              const isToday = key === todayString
              const future = key > todayString

              return (
                <button
                  key={day}
                  onClick={() => {
                    setSelectedProgressDate(key)
                    loadDayDetails(key)
                  }}
                  className={`flex h-[34px] items-center justify-center rounded-[10px] text-[13px] ${
                    finished
                      ? `${t.btn} font-semibold`
                      : partial
                        ? `bg-slate-500/15 ${t.faint} font-semibold`
                        : isToday
                          ? `${t.chip} font-bold`
                          : future
                            ? t.faint
                            : `bg-amber-500/20 ${t.faint}`
                  }`}
                >
                  {day}
                </button>
              )
            })}
          </div>

          <div className={`mt-5 flex gap-4 border-t pt-4 ${t.hair}`}>
            <span className="flex items-center gap-2">
              <span className={`h-3 w-3 rounded ${t.btn}`} />
              <span className={`text-xs ${t.muted}`}>Finished</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded bg-slate-500/15" />
              <span className={`text-xs ${t.muted}`}>Part done</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded bg-amber-500/20" />
              <span className={`text-xs ${t.muted}`}>Missed</span>
            </span>
          </div>

        </div>

        {selectedProgressDate && (
          <div className={`mt-6 rounded-3xl ${t.surface} p-5`}>
            <p className="text-[16px] font-semibold">
              {new Date(selectedProgressDate + 'T00:00:00').toLocaleDateString('en-GB', {
                weekday: 'long', day: 'numeric', month: 'long',
              })}
            </p>

            <p className={`mt-0.5 text-[13px] ${t.muted}`}>
              {dayDetailLoading
                ? 'Loading…'
                : completedDates.has(selectedProgressDate)
                  ? 'Routine finished'
                  : stepDays.has(selectedProgressDate) || (dayDetailSteps && dayDetailSteps.length > 0)
                    ? 'Some steps done'
                    : selectedProgressDate > todayString
                      ? 'Upcoming'
                      : 'Nothing recorded'}
            </p>

            {dayDetailLoading ? (
              <p className={`mt-4 text-[13px] ${t.muted}`}>Loading…</p>
            ) : (
              (() => {
                const amDoneSteps = (dayDetailSteps || []).filter((s) => s.timeOfDay === 'AM')
                const pmDoneSteps = (dayDetailSteps || []).filter((s) => s.timeOfDay === 'PM')

                const renderList = (list) => (
                  <div className="mt-2 flex flex-col gap-2.5">
                    {list.map((step) => (
                      <div key={step.id} className="flex items-center gap-2.5">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                          stroke="currentColor" strokeWidth="2.2"
                          strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${t.mark}`}>
                          <path d="M4 12.5l5.2 5.2L20 7" />
                        </svg>
                        <span className="min-w-0 flex-1 text-[14px]">
                          {step.brand && (
                            <span className={`block truncate text-[11px] font-medium ${t.faint}`}>
                              {step.brand}
                            </span>
                          )}
                          {step.name}
                        </span>
                      </div>
                    ))}
                  </div>
                )

                if (amDoneSteps.length === 0 && pmDoneSteps.length === 0) {
                  return (
                    <p className={`mt-4 text-[13px] leading-relaxed ${t.muted}`}>
                      {selectedProgressDate > todayString
                        ? "This day hasn't happened yet."
                        : 'No steps were logged for this day.'}
                    </p>
                  )
                }

                return (
                  <div className={`mt-4 flex flex-col gap-4 border-t pt-4 ${t.hair}`}>
                    {amDoneSteps.length > 0 && (
                      <div>
                        <p className={`text-[11px] font-semibold uppercase tracking-wide ${t.faint}`}>Morning</p>
                        {renderList(amDoneSteps)}
                      </div>
                    )}

                    {pmDoneSteps.length > 0 && (
                      <div>
                        <p className={`text-[11px] font-semibold uppercase tracking-wide ${t.faint}`}>Night</p>
                        {renderList(pmDoneSteps)}
                      </div>
                    )}
                  </div>
                )
              })()
            )}
          </div>
        )}

      </div>
    </main>
  )
}
if (screen === 'skinTrends') {
  const METRICS = [
    ['breakouts', 'Breakouts', '#f43f5e'],
    ['dryness', 'Dryness', '#f59e0b'],
    ['oiliness', 'Oiliness', '#10b981'],
    ['redness', 'Redness', '#8b5cf6'],
  ]

  const chartDays = Array.from({ length: 30 }, (_, i) => addDays(todayString, i - 29))
  const logsByDay = new Map(skinLogs.map((entry) => [entry.local_date, entry]))
  const loggedDays = chartDays.filter((date) => logsByDay.has(date))
  const hasEnoughData = loggedDays.length >= 3

  const chartW = 328
  const chartH = 140
  const columnW = chartW / (chartDays.length - 1)
  const maxValue = Math.max(
    4,
    ...loggedDays.flatMap((date) => {
      const log = logsByDay.get(date)
      return [log.breakouts, log.dryness, log.oiliness, log.redness]
    })
  )
  const xFor = (i) => (i / (chartDays.length - 1)) * chartW
  const yFor = (v) => chartH - (v / maxValue) * chartH

  const segmentsFor = (key) => {
    const segments = []
    let current = []
    chartDays.forEach((date, i) => {
      const log = logsByDay.get(date)
      if (!log) {
        if (current.length) segments.push(current)
        current = []
        return
      }
      current.push([xFor(i), yFor(log[key])])
    })
    if (current.length) segments.push(current)
    return segments
  }

  const lastLoggedDay = [...loggedDays].pop()

  const selectedLog = selectedTrendDate
    ? skinLogs.find((entry) => entry.local_date === selectedTrendDate)
    : null

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-6 pt-7">

        <button
          onClick={() => setScreen('today')}
          className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Today
        </button>

        <div className="mt-5">
          <h1 className="font-display text-[36px] font-light leading-[1.05] tracking-tight">
            Skin insights
          </h1>

          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Your skin journey over the last 30 days.
          </p>
        </div>

        <div className={`mt-8 rounded-3xl ${t.surface} p-5`}>
          <h2 className="text-[15px] font-semibold">Skin condition</h2>

          {!hasEnoughData ? (
            <p className={`mt-3 text-[13px] leading-relaxed ${t.muted}`}>
              Log your skin on a few more days on the Today screen to see a chart here.
            </p>
          ) : (
            <>
              <svg viewBox={`0 0 ${chartW} ${chartH}`} className="mt-4 w-full" style={{ height: 150 }}>
                <g className={t.hair}>
                  <line x1="0" y1={yFor(maxValue)} x2={chartW} y2={yFor(maxValue)} stroke="currentColor" strokeWidth="1" />
                  <line x1="0" y1={yFor(maxValue / 2)} x2={chartW} y2={yFor(maxValue / 2)} stroke="currentColor" strokeWidth="1" />
                  <line x1="0" y1={chartH} x2={chartW} y2={chartH} stroke="currentColor" strokeWidth="1" />
                </g>

                <g className={t.faint}>
                  <text x="2" y={yFor(maxValue) - 3} fontSize="10" fontWeight="600">{maxValue}</text>
                  <text x="2" y={yFor(maxValue / 2) - 3} fontSize="10" fontWeight="600">{Math.round(maxValue / 2)}</text>
                </g>

                {METRICS.map(([key, , color]) => (
                  <g key={key}>
                    {segmentsFor(key).map((seg, i) => (
                      <path
                        key={i}
                        d={'M' + seg.map(([x, y]) => `${x},${y}`).join(' L')}
                        fill="none" stroke={color} strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round"
                      />
                    ))}

                    {lastLoggedDay && (
                      <circle
                        cx={xFor(chartDays.indexOf(lastLoggedDay))}
                        cy={yFor(logsByDay.get(lastLoggedDay)[key])}
                        r="3.5" fill={color}
                      />
                    )}
                  </g>
                ))}

                {chartDays.map((date, i) => (
                  <rect
                    key={date}
                    x={xFor(i) - columnW / 2} y="0" width={columnW} height={chartH}
                    fill="transparent"
                    onClick={() => setSelectedTrendDate(date)}
                  />
                ))}
              </svg>

              <div className={`mt-1 flex justify-between text-[11px] ${t.faint}`}>
                <span>
                  {new Date(chartDays[0] + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </span>
                <span>
                  {new Date(todayString + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </span>
              </div>

              <div className={`mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t pt-4 ${t.hair}`}>
                {METRICS.map(([key, label, color]) => (
                  <span key={key} className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                    <span className={`text-xs ${t.muted}`}>{label}</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        {selectedTrendDate && (
          <div className={`mt-4 rounded-3xl ${t.surface} p-5`}>
            <p className="text-[14px] font-semibold">
              {new Date(selectedTrendDate + 'T00:00:00').toLocaleDateString('en-GB', {
                weekday: 'long', day: 'numeric', month: 'long',
              })}
            </p>

            {selectedLog ? (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                <span className={`text-[13px] ${t.muted}`}>Breakouts {selectedLog.breakouts}</span>
                <span className={`text-[13px] ${t.muted}`}>Dryness {selectedLog.dryness}</span>
                <span className={`text-[13px] ${t.muted}`}>Oiliness {selectedLog.oiliness}</span>
                <span className={`text-[13px] ${t.muted}`}>Redness {selectedLog.redness}</span>
              </div>
            ) : (
              <p className={`mt-1 text-[13px] ${t.muted}`}>Nothing logged this day.</p>
            )}
          </div>
        )}

      </div>
    </main>
  )
}
if (screen === 'progressPhotos') {
  const toggleCompare = (id) => {
    setComparePhotos((ids) => {
      if (ids.includes(id)) return ids.filter((x) => x !== id)
      if (ids.length >= 2) return [ids[1], id]
      return [...ids, id]
    })
  }

  const comparing = [...comparePhotos]
    .map((id) => progressPhotos.find((p) => p.id === id))
    .filter(Boolean)
    .sort((a, b) => a.local_date.localeCompare(b.local_date))

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-6 pt-7">

        <button
          onClick={() => setScreen('today')}
          className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Today
        </button>

        <div className="mt-5">
          <h1 className="font-display text-[36px] font-light leading-[1.05] tracking-tight">
            Progress photos
          </h1>

          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Capture your skin over time and compare how far you've come.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <label className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border py-8 text-[13px] font-semibold ${t.hair} ${t.muted}`}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 8a2 2 0 0 1 2-2h1.2l.8-1.6A1 1 0 0 1 8.9 4h6.2a1 1 0 0 1 .9.6L16.8 6H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
            Take a photo
            <input
              type="file"
              accept="image/*"
              capture="user"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (!file) return
                setPendingPhoto({ file, previewUrl: URL.createObjectURL(file), date: localDateString() })
                e.target.value = ''
              }}
            />
          </label>

          <label className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border py-8 text-[13px] font-semibold ${t.hair} ${t.muted}`}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M3 16l4.5-4.5a2 2 0 0 1 2.8 0L15 16M14 15l1.5-1.5a2 2 0 0 1 2.8 0L21 16" />
              <circle cx="8" cy="9" r="1.4" />
            </svg>
            Choose from library
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (!file) return
                setPendingPhoto({ file, previewUrl: URL.createObjectURL(file), date: localDateString() })
                e.target.value = ''
              }}
            />
          </label>
        </div>

        {pendingPhoto && (
          <div className={`mt-6 rounded-3xl ${t.surface} p-4`}>
            <img src={pendingPhoto.previewUrl} alt="" className="aspect-square w-full rounded-xl object-cover" />

            <label className={`mt-3 block text-[13px] font-semibold`}>
              Date this photo was taken
            </label>
            <input
              type="date"
              value={pendingPhoto.date}
              max={localDateString()}
              onChange={(e) => setPendingPhoto((p) => ({ ...p, date: e.target.value }))}
              className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-[14px] ${t.hair}`}
            />

            <div className="mt-3 flex gap-2">
              <button
                onClick={() => {
                  URL.revokeObjectURL(pendingPhoto.previewUrl)
                  setPendingPhoto(null)
                }}
                className={`flex-1 rounded-2xl border py-3 text-[14px] font-semibold ${t.hair} ${t.muted}`}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await uploadProgressPhoto(pendingPhoto.file, pendingPhoto.date)
                  URL.revokeObjectURL(pendingPhoto.previewUrl)
                  setPendingPhoto(null)
                }}
                className={`flex-1 rounded-2xl py-3 text-[14px] font-bold ${t.btn}`}
              >
                Save photo
              </button>
            </div>
          </div>
        )}

        {photoUploading && (
          <p className={`mt-3 text-[13px] ${t.muted}`}>Uploading...</p>
        )}

        {photoError && (
          <p className={`mt-3 text-[13px] ${t.danger}`}>{photoError}</p>
        )}

        {comparing.length === 2 && (
          <div className={`mt-6 rounded-3xl ${t.surface} p-4`}>
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Compare</h2>
              <button onClick={() => setComparePhotos([])} className={`text-[13px] ${t.muted}`}>
                Clear
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              {comparing.map((photo) => (
                <div key={photo.id}>
                  {photoUrls[photo.path] && (
                    <img src={photoUrls[photo.path]} alt="" className="aspect-square w-full rounded-xl object-cover" />
                  )}
                  <p className={`mt-1.5 text-center text-[12px] ${t.faint}`}>
                    {new Date(photo.local_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Your journey</h2>
            {progressPhotos.length > 0 && (
              <p className={`text-[12px] ${t.faint}`}>Tap to compare</p>
            )}
          </div>

          {progressPhotos.length === 0 ? (
            <p className={`mt-3 text-[13px] leading-relaxed ${t.muted}`}>
              No photos yet. Take your first one to start tracking your skin's journey.
            </p>
          ) : (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {progressPhotos.map((photo) => (
                <div key={photo.id}>
                  <div className={`relative aspect-square overflow-hidden rounded-xl ${t.chip}`}>
                    <button onClick={() => setViewingPhoto(photo)} className="h-full w-full">
                      {photoUrls[photo.path] && (
                        <img src={photoUrls[photo.path]} alt="" className="h-full w-full object-cover" />
                      )}
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleCompare(photo.id)
                      }}
                      className={`absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
                        comparePhotos.includes(photo.id) ? t.nodeDone : 'bg-black/30 text-white'
                      }`}
                    >
                      {comparePhotos.includes(photo.id) ? comparePhotos.indexOf(photo.id) + 1 : ''}
                    </button>
                  </div>

                  <p className={`mt-1 text-center text-[11px] ${t.faint}`}>
                    {new Date(photo.local_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {viewingPhoto && (
          <div className="fixed inset-0 z-20 flex flex-col overflow-y-auto bg-black/90 px-6 py-8">
            <button
              onClick={() => setViewingPhoto(null)}
              className="self-end text-[15px] font-semibold text-white"
            >
              Close
            </button>

            {photoUrls[viewingPhoto.path] && (
              <img src={photoUrls[viewingPhoto.path]} alt="" className="mt-4 max-h-[60vh] w-full rounded-2xl object-contain" />
            )}

            <p className="mt-4 text-center text-[14px] text-white/80">
              {new Date(viewingPhoto.local_date + 'T00:00:00').toLocaleDateString('en-GB', {
                weekday: 'long', day: 'numeric', month: 'long',
              })}
            </p>

            <textarea
              key={viewingPhoto.id}
              defaultValue={viewingPhoto.note || ''}
              onBlur={(e) => saveProgressPhotoNote(viewingPhoto, e.target.value)}
              placeholder="Add a note about your skin..."
              rows={2}
              className="mt-4 w-full rounded-xl border border-white/20 bg-white/10 p-3 text-[13px] text-white placeholder-white/50"
            />

            <button
              onClick={() => deleteProgressPhoto(viewingPhoto)}
              className="mt-6 text-[14px] font-semibold text-rose-400"
            >
              Delete photo
            </button>
          </div>
        )}

      </div>
    </main>
  )
}
  return (
    <main className="min-h-screen bg-white text-[#101B2D]">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-6 pb-6 pt-7 text-center">

        <div className="mb-5">
          <img src="/logo-wordmark.jpg" alt="Tracka+" className="mx-auto w-full max-w-[260px]" />

          <p className="mt-2 text-[15px] leading-relaxed text-[#51637E]">
            Your daily skincare routine tracker.
          </p>
        </div>

        <button
          onClick={() => setScreen('auth')}
          className="w-full rounded-2xl bg-[#2554EB] py-[18px] text-base font-bold text-white"
        >
          Get started
        </button>

        <p className="mt-6 whitespace-nowrap text-[11px] text-[#7488A3]">
          Build your routine. Stay consistent. Track your progress.
        </p>

      </div>
    </main>
  )
}

export default App