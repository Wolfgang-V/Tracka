import { useState, useEffect, useRef } from 'react'
import { supabase } from './lib/supabase'
import { detectActive } from './lib/core/actives'
import { planNight, localDateString, addDays, daysBetween } from './lib/core/planNight'
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
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    return { ok: false, reason: 'unsupported' }
  }

  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)

  if (isIOS && !standalone) {
    return { ok: false, reason: 'needs_install' }
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

  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')

  const [skinType, setSkinType] = useState('')
  const [concerns, setConcerns] = useState([])
  const [goals, setGoals] = useState([])
  const [sensitivity, setSensitivity] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [resetStatus, setResetStatus] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [morningReminderEnabled, setMorningReminderEnabled] = useState(true)
  const [morningReminderTime, setMorningReminderTime] = useState('07:00')
  const [nightReminderEnabled, setNightReminderEnabled] = useState(true)
  const [nightReminderTime, setNightReminderTime] = useState('21:00')
  const [productBrand, setProductBrand] = useState('')
  const [productName, setProductName] = useState('')
  const [productCategory, setProductCategory] = useState('')
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
        step_name
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
  const [viewMode, setViewMode] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const nightSectionRef = useRef(null)
  const [pushStatus, setPushStatus] = useState(null)
  const [progressCompletions, setProgressCompletions] = useState([])
  const [selectedProgressDate, setSelectedProgressDate] = useState(null)
  const [skinLogs, setSkinLogs] = useState([])
  const [selectedTrendDate, setSelectedTrendDate] = useState(null)

  useEffect(() => {
   const checkUser = async () => {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
  console.log('No logged-in user found')
  return
}

  setUser(user)

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
}

       if (window.location.search.includes('confirmed=true')) {
      setScreen('login')
      window.history.replaceState({}, '', window.location.pathname)
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
            category
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
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser()

  if (!currentUser) return

  const { data, error } = await supabase
    .from('routine_step_completions')
    .select('routine_step_id, local_date')
    .eq('user_id', currentUser.id)
    .gte('local_date', addDays(localDateString(), -21))

  if (error) {
    console.error('STEP HISTORY ERROR:', error)
    return
  }

  setStepHistory(data || [])
}

const loadSkinLogs = async () => {
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser()

  if (!currentUser) return

  const { data, error } = await supabase
    .from('skin_logs')
    .select('local_date, breakouts, dryness, oiliness, redness')
    .eq('user_id', currentUser.id)
    .gte('local_date', addDays(localDateString(), -30))

  if (error) {
    console.error('SKIN LOG HISTORY ERROR:', error)
    return
  }

  setSkinLogs(data || [])
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

  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser()

  if (!currentUser) return

  const { data: routines, error: routinesError } = await supabase
    .from('routines')
    .select('*')
    .eq('user_id', currentUser.id)
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
          category
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
    frequency: step.frequency,
    step_order: step.step_order,
    opened_date: step.user_products?.opened_date ?? null,
    pao_months: step.user_products?.pao_months ?? null,
  })),
  history: stepHistory.filter((entry) => entry.local_date < todayString),
})

const hour = new Date().getHours()
const isNight = viewMode ? viewMode === 'night' : hour >= 17 || hour < 5

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
  mark: 'text-[#1E4E8C]',
  muted: 'text-[#51637E]',
  faint: 'text-[#7488A3]',
  rail: 'bg-[#101B2D]/12',
  node: 'bg-white border border-[#101B2D]/12 text-[#51637E]',
  nodeDone: 'bg-[#1E4E8C] text-white',
  hair: 'border-[#101B2D]/10',
  btn: 'bg-[#1E4E8C] text-white',
  surface: 'bg-white',
  chip: 'bg-[#1E4E8C]/10 text-[#1E4E8C]',
  danger: 'text-rose-600',
}

const t = isNight ? nightPalette : dayPalette

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

let longestStreak = 0
let run = 0
let previousDate = null

for (const date of [...completedDates].sort()) {
  run = previousDate && daysBetween(previousDate, date) === 1 ? run + 1 : 1
  longestStreak = Math.max(longestStreak, run)
  previousDate = date
}

const todaySkinLog = skinLogs.find((log) => log.local_date === todayString) || {
  breakouts: 0,
  dryness: 0,
  oiliness: 0,
  redness: 0,
}

// Flags a product as worth a second look when the average daily breakout
// count in the ~10 days after its opened_date is meaningfully higher than
// the ~10 days before — never phrased as a diagnosis, just a nudge to watch.
const productsToWatch = products
  .filter((item) => {
    if (!item.opened_date) return false
    const daysSinceOpened = daysBetween(item.opened_date, todayString)
    return daysSinceOpened >= 7 && daysSinceOpened <= 30
  })
  .map((item) => {
    const before = skinLogs.filter(
      (log) =>
        log.local_date < item.opened_date &&
        log.local_date >= addDays(item.opened_date, -10)
    )
    const after = skinLogs.filter(
      (log) =>
        log.local_date >= item.opened_date &&
        log.local_date <= addDays(item.opened_date, 10)
    )

    if (before.length < 3 || after.length < 3) return null

    const avg = (logs) => logs.reduce((sum, log) => sum + log.breakouts, 0) / logs.length
    const beforeAvg = avg(before)
    const afterAvg = avg(after)

    if (afterAvg - beforeAvg < 2) return null

    return {
      id: item.id,
      name: item.products?.name || 'A product',
      openedDate: item.opened_date,
      beforeAvg,
      afterAvg,
    }
  })
  .filter(Boolean)
  .sort((a, b) => (b.afterAvg - b.beforeAvg) - (a.afterAvg - a.beforeAvg))

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

}, [screen])

// The Today screen shows morning and night routines on one continuous
// page; scrolling the night section into view switches the app's theme
// to dark, the same 'viewMode' a manual toggle used to set.
useEffect(() => {
  if (screen !== 'today') return

  const node = nightSectionRef.current
  if (!node) return

  const observer = new IntersectionObserver(
    ([entry]) => setViewMode(entry.isIntersecting ? 'night' : 'morning'),
    { threshold: 0.15 }
  )

  observer.observe(node)
  return () => observer.disconnect()
}, [screen])


const toggleOption = (value, current, setter) => {
  if (current.includes(value)) {
    setter(current.filter((item) => item !== value))
  } else {
    setter([...current, value])
  }
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
    .select('skin_type, concerns, goals, sensitivity')
    .eq('user_id', currentUser.id)
    .single()

  if (error) {
    console.error(error)
    return
  }

  if (data) {
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
        <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-6 pt-7">

          <div className="mt-5">
            <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
              Step 1 of 3
            </p>

            <h1 className="mt-2 font-display text-[36px] font-light leading-[1.05] tracking-tight">
              Tell us about your skin
            </h1>

            <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
              This helps Tracka organize your skincare journey around you.
            </p>
          </div>

          <div className="mt-8 flex flex-col gap-8">

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
                  'Hyperpigmentation',
                  'Dryness',
                  'Sensitivity',
                  'Uneven texture',
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
      </main>
    )
  }

  if (screen === 'products') {
    return (
      <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
        <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-6 pt-7">

          <div className="mt-5">
            <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
              Step 2 of 3
            </p>

            <h1 className="mt-2 font-display text-[36px] font-light leading-[1.05] tracking-tight">
              Add your products
            </h1>

            <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
              Add the products you already own so Tracka can organize them for you.
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

          </div>
        </div>
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

            <div>
              <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
                Brand
              </label>

              <input
                type="text"
                placeholder="e.g. CeraVe"
                value={productBrand}
                onChange={(e) => setProductBrand(e.target.value)}
                className={`w-full rounded-2xl ${t.surface} border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
              />
            </div>

            <div>
              <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
                Product name
              </label>

              <input
                type="text"
                placeholder="e.g. Hydrating Cleanser"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                className={`w-full rounded-2xl ${t.surface} border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
              />
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
                      category
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

if (screen === 'reminders') {
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
            Reminders
          </p>

          <h1 className="mt-2 font-display text-[36px] font-light leading-[1.05] tracking-tight">
            Stay on track
          </h1>

          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Choose when Tracka should remind you about your skincare routine.
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
            Tracka to your home screen first and open it from there.
          </p>

          <button
            onClick={async () => {
              const result = await subscribeToPushNotifications()

              setPushStatus(
                result.ok
                  ? "You're set. Reminders will arrive on this device."
                  : result.reason === 'needs_install'
                    ? 'Add Tracka to your home screen first, then open it from there.'
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
  const amSteps = todayAmSteps.map((step) => ({
    id: step.id,
    name: step.user_products?.products?.name || step.step_name,
    brand: step.user_products?.products?.brand,
    category: step.user_products?.products?.category,
    active: 'none',
  }))

  const pmSteps = nightPlan.steps
  const pmNotes = nightPlan.notes

  const amDone = amSteps.filter((s) => completedSteps.includes(s.id)).length
  const pmDone = pmSteps.filter((s) => completedSteps.includes(s.id)).length

  const isRestNight =
    pmSteps.length > 0 && pmSteps.every((s) => !s.active || s.active === 'none')

  const menuItems = [
    ['My products', 'products'],
    ['My routine', 'routinePlanner'],
    ['My progress', 'progress'],
    ['Skin trends', 'skinTrends'],
    ['My skin profile', 'skinProfile'],
    ['Reminders', 'reminders'],
  ]

  const renderSteps = (steps, palette) => (
    <div className="relative">
      <div className={`absolute left-[17px] top-5 bottom-6 w-px ${palette.rail}`} />

      <div className="relative flex flex-col gap-5">
        {steps.map((step, index) => {
          const done = completedSteps.includes(step.id)

          return (
            <button
              key={step.id}
              onClick={() => toggleStepCompletion(step.id)}
              className="flex items-start gap-4 text-left"
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

              <span className="pt-1">
                <span
                  className={`block text-[17px] font-semibold ${
                    done ? `${palette.faint} line-through` : ''
                  }`}
                >
                  {step.name}
                </span>

                <span className={`mt-0.5 block text-[13px] ${done ? palette.faint : palette.muted}`}>
                  {step.brand}
                </span>

                {!done && (step.active !== 'none' || step.expired) && (
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    {step.active && step.active !== 'none' && (
                      <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${palette.chip}`}>
                        {step.active === 'retinoid' ? 'Retinol night' : 'Active tonight'}
                      </span>
                    )}

                    {step.expired && (
                      <span className={`inline-block rounded-full bg-rose-500/10 px-2.5 py-1 text-xs font-semibold ${palette.danger}`}>
                        Past use-by date
                      </span>
                    )}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )

  return (
    <main className="min-h-screen">
      <div className={`${dayPalette.page} transition-colors duration-500`}>
      <div className="mx-auto flex w-full max-w-md flex-col px-6 pt-7">

        <div className="relative flex items-center justify-between">
          <span className={`text-[15px] font-semibold tracking-wide ${dayPalette.mark}`}>
            Tracka
          </span>

          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setMenuOpen(!menuOpen)}
            className={`-mr-2 flex h-11 w-11 items-center justify-center ${dayPalette.muted}`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>

          {menuOpen && (
            <div className={`absolute right-0 top-12 z-10 w-52 overflow-hidden rounded-2xl ${dayPalette.surface} shadow-xl`}>
              {menuItems.map(([label, target]) => (
                <button
                  key={target}
                  onClick={async () => {
                    setMenuOpen(false)
                    if (target === 'skinProfile') await loadSkinProfile()
                    setScreen(target)
                  }}
                  className={`block w-full px-5 py-3.5 text-left text-[15px] ${dayPalette.muted}`}
                >
                  {label}
                </button>
              ))}

              <button
                onClick={async () => {
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
                  setMenuOpen(false)
                  setScreen('welcome')
                }}
                className={`block w-full border-t px-5 py-3.5 text-left text-[15px] ${dayPalette.hair} ${dayPalette.faint}`}
              >
                Log out
              </button>
            </div>
          )}
        </div>

        <div className="mt-7">
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
            Morning routine
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

          {todayAmRoutine && !routinesLoading && (
            <div className="mt-7 flex flex-col gap-3.5">
              <p className={`text-[13px] ${dayPalette.faint}`}>
                {amDone} of {amSteps.length} done
              </p>

              <button
                onClick={finishRoutine}
                className={`w-full rounded-2xl py-[18px] text-base font-bold ${dayPalette.btn}`}
              >
                Done for this morning
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

      <div ref={nightSectionRef} className={`${nightPalette.page} transition-colors duration-500`}>
      <div className="mx-auto flex w-full max-w-md flex-col px-6 pb-10">
          <p className={`text-[13px] font-semibold uppercase tracking-wide ${nightPalette.mark}`}>
            Night
          </p>

          <h2 className="mt-1 font-display text-[28px] font-light leading-[1.05] tracking-tight">
            {isRestNight ? 'Rest night' : 'Tonight'}
          </h2>

          {isRestNight && (
            <p className={`mt-2 max-w-[300px] text-[14px] leading-relaxed ${nightPalette.muted}`}>
              Nothing strong tonight. Your skin repairs itself between actives,
              so this counts as part of the routine.
            </p>
          )}

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

                {pmNotes.length > 0 && (
                  <div className={`mt-7 flex flex-col gap-3 border-t pt-5 ${nightPalette.hair}`}>
                    {pmNotes.map((note, i) => (
                      <p key={i} className={`text-sm leading-relaxed ${nightPalette.muted}`}>
                        {note}
                      </p>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {todayPmRoutine && !routinesLoading && (
            <div className="mt-7 flex flex-col gap-3.5">
              <p className={`text-[13px] ${nightPalette.faint}`}>
                {pmDone} of {pmSteps.length} done
              </p>

              <button
                onClick={finishRoutine}
                className={`w-full rounded-2xl py-[18px] text-base font-bold ${nightPalette.btn}`}
              >
                Done for tonight
              </button>
            </div>
          )}

        {(todayAmRoutine || todayPmRoutine) && !routinesLoading && (
          <div className={`mt-8 rounded-3xl ${nightPalette.surface} p-5`}>
            <h2 className={`text-[15px] font-semibold ${nightPalette.text}`}>
              How's your skin today?
            </h2>

            <div className="mt-4 flex flex-col gap-3">
              {[
                ['breakouts', 'Breakouts'],
                ['dryness', 'Dryness'],
                ['oiliness', 'Oiliness'],
                ['redness', 'Redness'],
              ].map(([key, label]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className={`text-[14px] ${nightPalette.muted}`}>{label}</span>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => updateSkinMetric(key, -1)}
                      className={`flex h-8 w-8 items-center justify-center rounded-full border text-lg leading-none ${nightPalette.hair} ${nightPalette.muted}`}
                    >
                      −
                    </button>

                    <span className={`w-5 text-center text-[15px] font-semibold tabular-nums ${nightPalette.text}`}>
                      {todaySkinLog[key]}
                    </span>

                    <button
                      type="button"
                      onClick={() => updateSkinMetric(key, 1)}
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none ${nightPalette.btn}`}
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
            Tell Tracka when you want to use each product, and it will organize your morning and night routines.
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
                key={routine.routine_code}
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
                  {routine.routine_code || 'No routine code'}
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
            {selectedRoutine?.routine_code}
          </h1>

          <p className={`mt-3 text-[15px] ${t.muted}`}>
            Previous routine
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
                <h2 className="text-[17px] font-semibold">
                  {routine.time_of_day === 'AM'
                    ? 'Morning routine'
                    : 'Night routine'}
                </h2>

                <div className={`mt-4 flex flex-col divide-y ${t.hair}`}>
                  {routine.steps.length === 0 ? (
                    <p className={`text-[15px] ${t.muted}`}>
                      No steps recorded.
                    </p>
                  ) : (
                    routine.steps.map((step, index) => (
                      <div
                        key={step.id}
                        className="py-3 first:pt-0 last:pb-0"
                      >
                        <p className={`text-[11px] font-semibold ${t.faint}`}>
                          STEP {index + 1}
                        </p>

                        <p className="mt-0.5 text-[15px] font-medium">
                          {step.step_name}
                        </p>
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
          <h1 className="font-display text-[54px] font-light leading-[0.95] tracking-tight">
            {currentStreak} {currentStreak === 1 ? 'night' : 'nights'}
          </h1>

          <p className={`mt-3 max-w-[290px] text-[15px] leading-relaxed ${t.muted}`}>
            {currentStreak === 0
              ? 'Finish tonight and your streak starts again. Nothing is lost.'
              : longestStreak > currentStreak
                ? `Your longest run so far was ${longestStreak}. One missed night won't end it.`
                : "That's your best run yet. One missed night won't end it."}
          </p>
        </div>

        <div className={`mt-8 rounded-3xl ${t.surface} px-5 py-6`}>

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
                  onClick={() => setSelectedProgressDate(key)}
                  className={`flex h-[34px] items-center justify-center rounded-[10px] text-[13px] ${
                    finished
                      ? `${t.btn} font-semibold`
                      : partial
                        ? `${t.chip} font-semibold`
                        : isToday
                          ? `${t.chip} font-bold`
                          : future
                            ? t.faint
                            : `bg-slate-500/15 ${t.faint}`
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
              <span className={`h-3 w-3 rounded ${t.chip}`} />
              <span className={`text-xs ${t.muted}`}>Part done</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded bg-slate-500/15" />
              <span className={`text-xs ${t.muted}`}>Missed</span>
            </span>
          </div>

        </div>

        {selectedProgressDate && (
          <p className={`mt-6 text-sm leading-relaxed ${t.muted}`}>
            {new Date(selectedProgressDate + 'T00:00:00').toLocaleDateString('en-GB', {
              weekday: 'long', day: 'numeric', month: 'long',
            })}
            {completedDates.has(selectedProgressDate)
              ? ' — routine finished.'
              : stepDays.has(selectedProgressDate)
                ? ' — some steps done.'
                : ' — nothing recorded.'}
          </p>
        )}

      </div>
    </main>
  )
}
if (screen === 'skinTrends') {
  const chartDays = Array.from({ length: 30 }, (_, i) => addDays(todayString, i - 29))
  const chartPoints = chartDays.map((date) => {
    const log = skinLogs.find((entry) => entry.local_date === date)
    return { date, value: log ? log.breakouts : null }
  })

  const loggedValues = chartPoints.map((p) => p.value).filter((v) => v !== null)
  const hasEnoughData = loggedValues.length >= 3

  const chartW = 328
  const chartH = 120
  const columnW = chartW / (chartPoints.length - 1)
  const maxValue = Math.max(4, ...loggedValues)
  const xFor = (i) => (i / (chartPoints.length - 1)) * chartW
  const yFor = (v) => chartH - (v / maxValue) * chartH

  const segments = []
  let current = []
  chartPoints.forEach((p, i) => {
    if (p.value === null) {
      if (current.length) segments.push(current)
      current = []
      return
    }
    current.push([xFor(i), yFor(p.value)])
  })
  if (current.length) segments.push(current)

  const introducedMarks = products
    .filter(
      (item) =>
        item.opened_date &&
        item.opened_date >= chartDays[0] &&
        item.opened_date <= todayString
    )
    .map((item) => ({ x: xFor(chartDays.indexOf(item.opened_date)) }))

  const lastLogged = [...chartPoints].reverse().find((p) => p.value !== null)

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstWeekday = new Date(year, month, 1).getDay()
  const leadingBlanks = firstWeekday === 0 ? 6 : firstWeekday - 1

  const severityOf = (log) =>
    !log ? null : log.breakouts + log.dryness + log.oiliness + log.redness

  const severityClass = (severity) => {
    if (severity === null) return `border ${t.hair} ${t.faint}`
    if (severity === 0) return `${t.chip} border-transparent`
    if (severity <= 4) return `${t.chip} border-transparent`
    return `border-transparent bg-rose-500/15 ${t.danger}`
  }

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
          <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
            Skin trends
          </p>

          <h1 className="mt-2 font-display text-[36px] font-light leading-[1.05] tracking-tight">
            How your skin's been
          </h1>

          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Breakouts over the last 30 days, and which new products landed nearby.
          </p>
        </div>

        <div className={`mt-8 rounded-3xl ${t.surface} p-5`}>
          <h2 className="text-[15px] font-semibold">Breakout trend</h2>

          {!hasEnoughData ? (
            <p className={`mt-3 text-[13px] leading-relaxed ${t.muted}`}>
              Log your skin on a few more days on the Today screen to see a trend here.
            </p>
          ) : (
            <>
              <svg viewBox={`0 0 ${chartW} ${chartH}`} className="mt-4 w-full" style={{ height: 130 }}>
                <g className={t.hair}>
                  <line x1="0" y1={yFor(maxValue)} x2={chartW} y2={yFor(maxValue)} stroke="currentColor" strokeWidth="1" />
                  <line x1="0" y1={yFor(maxValue / 2)} x2={chartW} y2={yFor(maxValue / 2)} stroke="currentColor" strokeWidth="1" />
                  <line x1="0" y1={chartH} x2={chartW} y2={chartH} stroke="currentColor" strokeWidth="1" />
                </g>

                <g className={t.faint}>
                  <text x="2" y={yFor(maxValue) - 3} fontSize="10" fontWeight="600">{maxValue}</text>
                  <text x="2" y={yFor(maxValue / 2) - 3} fontSize="10" fontWeight="600">{Math.round(maxValue / 2)}</text>

                  {introducedMarks.map((mark, i) => (
                    <line
                      key={i}
                      x1={mark.x} y1={chartH - 10} x2={mark.x} y2={chartH}
                      stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                    />
                  ))}
                </g>

                <g className={t.mark}>
                  {segments.map((seg, i) => (
                    <path
                      key={i}
                      d={'M' + seg.map(([x, y]) => `${x},${y}`).join(' L')}
                      fill="none" stroke="currentColor" strokeWidth="2"
                      strokeLinecap="round" strokeLinejoin="round"
                    />
                  ))}

                  {lastLogged && (
                    <circle
                      cx={xFor(chartPoints.indexOf(lastLogged))}
                      cy={yFor(lastLogged.value)}
                      r="4" fill="currentColor"
                    />
                  )}

                  {selectedLog && (
                    <circle
                      cx={xFor(chartDays.indexOf(selectedTrendDate))}
                      cy={yFor(selectedLog.breakouts)}
                      r="4" fill="currentColor" opacity="0.5"
                    />
                  )}
                </g>

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

        <div className={`mt-4 rounded-3xl ${t.surface} p-5`}>
          <h2 className="text-[15px] font-semibold">Products to watch</h2>

          <p className={`mt-1 text-[12px] leading-relaxed ${t.faint}`}>
            Candidates to observe, not a diagnosis.
          </p>

          {productsToWatch.length === 0 ? (
            <p className={`mt-3 text-[13px] ${t.muted}`}>
              Nothing flagged right now.
            </p>
          ) : (
            <div className={`mt-3 flex flex-col divide-y ${t.hair}`}>
              {productsToWatch.map((item) => (
                <div key={item.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-[14px] font-medium">{item.name}</p>
                  <p className={`mt-0.5 text-[12px] leading-relaxed ${t.muted}`}>
                    Introduced{' '}
                    {new Date(item.openedDate + 'T00:00:00').toLocaleDateString('en-GB', {
                      day: 'numeric', month: 'short',
                    })}{' '}
                    — breakouts went from {item.beforeAvg.toFixed(1)} to {item.afterAvg.toFixed(1)} a day on average.
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={`mt-4 rounded-3xl ${t.surface} p-5`}>
          <div className="flex items-baseline justify-between">
            <span className="font-display text-[22px]">
              {now.toLocaleDateString('en-GB', { month: 'long' })}
            </span>
            <span className={`text-[13px] ${t.faint}`}>skin condition</span>
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
              const log = skinLogs.find((entry) => entry.local_date === key)
              const severity = severityOf(log)

              return (
                <button
                  key={day}
                  onClick={() => setSelectedTrendDate(key)}
                  className={`flex h-[34px] items-center justify-center rounded-[10px] text-[13px] font-semibold ${severityClass(severity)}`}
                >
                  {day}
                </button>
              )
            })}
          </div>

          <div className={`mt-5 flex gap-4 border-t pt-4 ${t.hair}`}>
            <span className="flex items-center gap-2">
              <span className={`h-3 w-3 rounded ${t.chip}`} />
              <span className={`text-xs ${t.muted}`}>Mild</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded bg-rose-500/15" />
              <span className={`text-xs ${t.muted}`}>Flared up</span>
            </span>
          </div>
        </div>

      </div>
    </main>
  )
}
  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-6 pb-6 pt-7 text-center">

        <div className="mb-10">
          <p className={`text-[15px] font-semibold tracking-wide ${t.mark}`}>
            Tracka
          </p>

          <h1 className="mt-2 font-display text-[54px] font-light leading-[0.95] tracking-tight">
            Your skincare,
            <br />
            on schedule.
          </h1>

          <p className={`mt-4 max-w-[300px] text-[15px] leading-relaxed ${t.muted}`}>
            Build your routine, stay consistent, and track your progress —
            morning and night.
          </p>
        </div>

        <button
          onClick={() => setScreen('auth')}
          className={`w-full rounded-2xl py-[18px] text-base font-bold ${t.btn}`}
        >
          Get started
        </button>

      </div>
    </main>
  )
}

export default App