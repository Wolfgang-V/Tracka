import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import { detectActive } from './lib/core/actives'
import { planNight, localDateString, addDays, daysBetween } from './lib/core/planNight'
const VAPID_PUBLIC_KEY =
  'BMqIqZ2Tjjx317CUOV8mCcyKNmI4ct29pUnAp0KCySyk_WF9RGbI5-JRR_DijZ6NANExRH3J652H_ZHl1vnJvRg'
const registerServiceWorker = async () => {
  if (!('serviceWorker' in navigator)) {
    return null
  }
const subscribeToPushNotifications = async () => {
  if (!('Notification' in window)) {
    alert('Push notifications are not supported on this device.')
    return
  }

  const permission = await Notification.requestPermission()

  if (permission !== 'granted') {
    alert('Please allow notifications for Tracka.')
    return
  }

  const registration = await registerServiceWorker()

  if (!registration) {
    alert('Tracka could not set up notifications.')
    return
  }

  try {
    let subscription = await registration.pushManager.getSubscription()

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: VAPID_PUBLIC_KEY,
      })
    }

    const {
      data: { user: currentUser },
    } = await supabase.auth.getUser()

    if (!currentUser) {
      alert('Please log in again.')
      return
    }

    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(
        {
          user_id: currentUser.id,
          subscription: subscription.toJSON(),
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id',
        }
      )

    if (error) {
      console.error('PUSH SUBSCRIPTION ERROR:', error)
      alert('Could not save notification settings.')
      return
    }

    alert('Notifications enabled!')
  } catch (error) {
    console.error('PUSH SETUP ERROR:', error)
    alert('Could not enable notifications.')
  }
}

  try {
    const registration = await navigator.serviceWorker.register('/sw.js')
    return registration
  } catch (error) {
    console.error('SERVICE WORKER ERROR:', error)
    return null
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
  const [morningReminderEnabled, setMorningReminderEnabled] = useState(true)
  const [morningReminderTime, setMorningReminderTime] = useState('07:00')
  const [nightReminderEnabled, setNightReminderEnabled] = useState(true)
  const [nightReminderTime, setNightReminderTime] = useState('21:00')
  const [productBrand, setProductBrand] = useState('')
  const [productName, setProductName] = useState('')
  const [productCategory, setProductCategory] = useState('')
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
  const [progressCompletions, setProgressCompletions] = useState([])
  const [selectedProgressDate, setSelectedProgressDate] = useState(null)

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
} = supabase.auth.onAuthStateChange((_event, session) => {
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
  })),
  history: stepHistory.filter((entry) => entry.local_date < todayString),
})

const hour = new Date().getHours()
const isNight = viewMode ? viewMode === 'night' : hour >= 17 || hour < 5

const t = isNight
  ? {
      page: 'bg-[#1B1826] text-[#F4F1F8]',
      mark: 'text-[#7ECFB4]',
      muted: 'text-[#A79FB8]',
      faint: 'text-[#6F6980]',
      rail: 'bg-[#F4F1F8]/15',
      node: 'bg-[#262133] border border-[#F4F1F8]/20 text-[#A79FB8]',
      nodeDone: 'bg-[#7ECFB4] text-[#1B1826]',
      hair: 'border-[#F4F1F8]/10',
      btn: 'bg-[#7ECFB4] text-[#1B1826]',
      surface: 'bg-[#262133]',
      chip: 'bg-[#7ECFB4]/15 text-[#7ECFB4]',
    }
  : {
      page: 'bg-[#EDF1EC] text-[#1B1826]',
      mark: 'text-[#1F6B58]',
      muted: 'text-[#55506A]',
      faint: 'text-[#6E6880]',
      rail: 'bg-[#1B1826]/15',
      node: 'bg-white border border-[#1B1826]/15 text-[#55506A]',
      nodeDone: 'bg-[#1F6B58] text-white',
      hair: 'border-[#1B1826]/10',
      btn: 'bg-[#1F6B58] text-white',
      surface: 'bg-white',
      chip: 'bg-[#1F6B58]/10 text-[#1F6B58]',
    }

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
  }

}, [screen])


const toggleOption = (value, current, setter) => {
  if (current.includes(value)) {
    setter(current.filter((item) => item !== value))
  } else {
    setter([...current, value])
  }
}

if (screen === 'auth') {    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-md">

          <button
            onClick={() => setScreen('welcome')}
            className="mb-8 text-sm font-medium text-blue-600"
          >
            ← Back
          </button>

          <div className="mb-10">
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-xl font-bold text-white">
              T
            </div>

            <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
              Create your Tracka account
            </h1>

            <p className="mt-3 text-slate-500">
              Start building a skincare routine you can actually stick to.
            </p>
          </div>

        <div className="space-y-5">

  <div>
    <label className="mb-2 block text-sm font-medium text-slate-700">
      Email address
    </label>

    <input
      type="email"
      placeholder="you@example.com"
      value={loginEmail}
      onChange={(e) => setLoginEmail(e.target.value)}
      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 outline-none focus:border-blue-500"
    />
  </div>

  <div>
    <label className="mb-2 block text-sm font-medium text-slate-700">
      Password
    </label>

    <div className="relative">
      <input
        type={showPassword ? 'text' : 'password'}
        placeholder="Create a password"
        value={loginPassword}
        onChange={(e) => setLoginPassword(e.target.value)}
        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 pr-12 outline-none focus:border-blue-500"
      />

      <button
        type="button"
        onClick={() => setShowPassword(!showPassword)}
        className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
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
    <label className="mb-2 block text-sm font-medium text-slate-700">
      What should we call you?
    </label>

    <input
      type="text"
      placeholder="e.g. Deeyah"
      value={username}
      onChange={(e) => setUsername(e.target.value)}
      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 outline-none focus:border-blue-500"
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
  className="w-full rounded-2xl bg-blue-600 px-6 py-4 font-semibold text-white transition hover:bg-blue-700"
>
  Create Account
</button>

</div>

          <p className="mt-6 text-center text-sm text-slate-500">
            Already have an account?{' '}
            <button
  onClick={() => setScreen('login')}
  className="font-semibold text-blue-600"
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
      <main className="min-h-screen bg-slate-50 px-6 py-10">
        <div className="mx-auto w-full max-w-2xl">


          <div className="mb-8">
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-xl font-bold text-white">
              T
            </div>

            <p className="mb-2 text-sm font-semibold text-blue-600">
              STEP 1 OF 3
            </p>

            <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
              Tell us about your skin
            </h1>

            <p className="mt-3 text-slate-500">
              This helps Tracka organize your skincare journey around you.
            </p>
          </div>

          <div className="space-y-8">

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">
                What is your skin type?
              </h2>

              <div className="grid grid-cols-2 gap-3">
                {['Normal', 'Dry', 'Oily', 'Combination'].map((type) => (
                  <button
                    key={type}
                    onClick={() => setSkinType(type)}
                    className={
                      skinType === type
                        ? 'rounded-2xl border border-blue-600 bg-blue-50 px-4 py-4 text-left font-medium text-blue-700 transition'
                        : 'rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left font-medium text-slate-700 transition hover:border-blue-300'
                    }
                  >
                    {type}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">
                What are your main skin concerns?
              </h2>

              <p className="mb-4 text-sm text-slate-500">
                Select all that apply.
              </p>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                    className={`rounded-2xl border px-4 py-4 text-left font-medium transition ${
                      concerns.includes(concern)
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300'
                    }`}
                  >
                    {concern}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">
                What are your skincare goals?
              </h2>

              <p className="mb-4 text-sm text-slate-500">
                Select all that apply.
              </p>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                    className={
                      goals.includes(goal)
                        ? 'rounded-2xl border border-blue-600 bg-blue-50 px-4 py-4 text-left font-medium text-blue-700 transition'
                        : 'rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left font-medium text-slate-700 transition hover:border-blue-300'
                    }
                  >
                    {goal}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">
                How sensitive is your skin?
              </h2>

              <div className="space-y-3">
                {[
                  'Not sensitive',
                  'Sometimes sensitive',
                  'Very sensitive',
                ].map((option) => (
                  <button
                    key={option}
                    onClick={() => setSensitivity(option)}
                    className={
                      sensitivity === option
                        ? 'w-full rounded-2xl border border-blue-600 bg-blue-50 px-4 py-4 text-left font-medium text-blue-700 transition'
                        : 'w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left font-medium text-slate-700 transition hover:border-blue-300'
                    }
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
              className="w-full rounded-2xl bg-blue-600 px-6 py-4 font-semibold text-white shadow-sm transition hover:bg-blue-700"
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
      <main className="min-h-screen bg-slate-50 px-6 py-10">
        <div className="mx-auto w-full max-w-2xl">

          <div className="mb-8">
            <p className="mb-2 text-sm font-semibold text-blue-600">
              STEP 2 OF 3
            </p>

            <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
              Add your skincare products
            </h1>

            <p className="mt-3 text-slate-500">
              Add the products you already own so Tracka can organize them for you.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">

            <h2 className="text-lg font-semibold text-slate-900">
              Your products
            </h2>

            {products.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">
                You haven't added any products yet.
              </p>
            ) : (
              <div className="mt-6 space-y-3">
                {products.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded-2xl border border-slate-200 p-4"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-500">
                        {item.products.brand}
                      </p>

                      <p className="mt-1 text-lg font-semibold text-slate-900">
                        {item.products.name}
                      </p>

                      <p className="mt-1 text-sm capitalize text-slate-400">
                        {item.products.category}
                      </p>
                    </div>

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
                      className="text-sm font-medium text-red-500"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => setScreen('addProduct')}
              className="mt-6 w-full rounded-2xl bg-blue-600 px-6 py-4 font-semibold text-white transition hover:bg-blue-700"
            >
              + Add a product
            </button>
<button
  onClick={() => setScreen('routinePlanner')}
  className="mt-3 w-full rounded-2xl border border-blue-200 bg-white px-6 py-4 font-semibold text-blue-600 transition hover:bg-blue-50"
>
  Save products
</button>

           <div className="mt-6 flex gap-3">
  <button
    onClick={() => setScreen('routinePlanner')}
    className="flex-1 rounded-2xl border border-blue-200 bg-white px-6 py-4 font-semibold text-blue-600 transition hover:bg-blue-50"
  >
    My Routine
  </button>

  <button
    onClick={() => setScreen('today')}
    className="flex-1 rounded-2xl border border-slate-200 bg-white px-6 py-4 font-semibold text-slate-700 transition hover:bg-slate-50"
  >
    Back to Today
  </button>
</div>
           
          </div>
        </div>
      </main>
    )
  }

  if (screen === 'addProduct') {
    return (
      <main className="min-h-screen bg-slate-50 px-6 py-10">
        <div className="mx-auto w-full max-w-2xl">

          <button
            onClick={() => setScreen('products')}
            className="mb-8 text-sm font-medium text-blue-600"
          >
            ← Back to products
          </button>

          <div className="mb-8">
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
              Add a product
            </h1>

            <p className="mt-3 text-slate-500">
              Add a skincare product you already own.
            </p>
          </div>

          <div className="space-y-5">

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Brand
              </label>

              <input
                type="text"
                placeholder="e.g. CeraVe"
                value={productBrand}
                onChange={(e) => setProductBrand(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Product name
              </label>

              <input
                type="text"
                placeholder="e.g. Hydrating Cleanser"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Category
              </label>

              <select
                value={productCategory}
                onChange={(e) => setProductCategory(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 outline-none focus:border-blue-500"
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
                setScreen('products')
              }}
              className="w-full rounded-2xl bg-blue-600 px-6 py-4 font-semibold text-white transition hover:bg-blue-700"
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
    <main className="min-h-screen bg-slate-50 flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-md">

        <button
          onClick={() => setScreen('auth')}
          className="mb-8 text-sm font-medium text-blue-600"
        >
          ← Back
        </button>

        <div className="mb-10">
          <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-xl font-bold text-white">
            T
          </div>

          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            Welcome back
          </h1>

          <p className="mt-3 text-slate-500">
            Log in to continue your skincare journey.
          </p>
        </div>

        <div className="space-y-5">

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Email address
            </label>

            <input
              type="email"
              placeholder="you@example.com"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Password
            </label>

            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Your password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 pr-12 outline-none focus:border-blue-500"
              />

              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
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
            className="w-full rounded-2xl bg-blue-600 px-6 py-4 font-semibold text-white transition hover:bg-blue-700"
          >
            Log In
          </button>

        </div>

        <p className="mt-6 text-center text-sm text-slate-500">
          Don't have an account?{' '}
          <button
            onClick={() => setScreen('auth')}
            className="font-semibold text-blue-600"
          >
            Create account
          </button>
        </p>

      </div>
    </main>
  )
}

if (screen === 'reminders') {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto w-full max-w-2xl">

        <button
          onClick={() => setScreen('today')}
          className="mb-8 text-sm font-medium text-blue-600"
        >
          ← Back to Today
        </button>

        <div className="mb-8">
          <p className="text-sm font-semibold text-blue-600">
            REMINDERS
          </p>

          <h1 className="mt-2 text-3xl font-display font-normal tracking-tight text-slate-900">
            Stay on track
          </h1>

          <p className="mt-3 text-slate-500">
            Choose when Tracka should remind you about your skincare routine.
          </p>
        </div>

        <div className="space-y-4">

          {/* MORNING REMINDER */}
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">

              <div>
                <p className="text-xs font-semibold uppercase text-blue-600">
                  Morning
                </p>

                <h2 className="mt-1 text-lg font-semibold text-slate-900">
                  Morning routine
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Get a reminder when it’s time for your morning routine.
                </p>
              </div>

              <button
                onClick={() =>
                  setMorningReminderEnabled(
                    !morningReminderEnabled
                  )
                }
                className={`relative h-7 w-12 rounded-full transition ${
                  morningReminderEnabled
                    ? 'bg-blue-600'
                    : 'bg-slate-300'
                }`}
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${
                    morningReminderEnabled
                      ? 'left-6'
                      : 'left-1'
                  }`}
                />
              </button>

            </div>

            {morningReminderEnabled && (
              <div className="mt-5">
                <label className="text-sm font-medium text-slate-700">
                  Reminder time
                </label>

                <input
                  type="time"
                  value={morningReminderTime}
                  onChange={(e) =>
                    setMorningReminderTime(e.target.value)
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none focus:border-blue-400"
                />
              </div>
            )}
          </div>

          {/* NIGHT REMINDER */}
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">

              <div>
                <p className="text-xs font-semibold uppercase text-blue-600">
                  Night
                </p>

                <h2 className="mt-1 text-lg font-semibold text-slate-900">
                  Night routine
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Get a reminder when it’s time for your night routine.
                </p>
              </div>

              <button
                onClick={() =>
                  setNightReminderEnabled(
                    !nightReminderEnabled
                  )
                }
                className={`relative h-7 w-12 rounded-full transition ${
                  nightReminderEnabled
                    ? 'bg-blue-600'
                    : 'bg-slate-300'
                }`}
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${
                    nightReminderEnabled
                      ? 'left-6'
                      : 'left-1'
                  }`}
                />
              </button>

            </div>

            {nightReminderEnabled && (
              <div className="mt-5">
                <label className="text-sm font-medium text-slate-700">
                  Reminder time
                </label>

                <input
                  type="time"
                  value={nightReminderTime}
                  onChange={(e) =>
                    setNightReminderTime(e.target.value)
                  }
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none focus:border-blue-400"
                />
              </div>
            )}
          </div>

        </div>
      
        
        <button
          onClick={saveReminderSettings}
          className="mt-6 w-full rounded-2xl bg-blue-600 px-6 py-4 font-semibold text-white transition hover:bg-blue-700"
        >
          Save reminder settings
        </button>

      </div>
    </main>
  )
}
if (screen === 'today') {
  const activeSteps = isNight
    ? nightPlan.steps
    : todayAmSteps.map((step) => ({
        id: step.id,
        name: step.user_products?.products?.name || step.step_name,
        brand: step.user_products?.products?.brand,
        category: step.user_products?.products?.category,
        active: 'none',
      }))

  const notes = isNight ? nightPlan.notes : []
  const hasRoutine = isNight ? todayPmRoutine : todayAmRoutine
  const doneCount = activeSteps.filter((s) => completedSteps.includes(s.id)).length
  const isRestNight =
    isNight &&
    activeSteps.length > 0 &&
    activeSteps.every((s) => !s.active || s.active === 'none')

  const menuItems = [
    ['My products', 'products'],
    ['My routine', 'routinePlanner'],
    ['My progress', 'progress'],
    ['My skin profile', 'skinProfile'],
    ['Reminders', 'reminders'],
  ]

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-6 pt-7">

        <div className="relative flex items-center justify-between">
          <span className={`text-[15px] font-semibold tracking-wide ${t.mark}`}>
            Tracka
          </span>

          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setMenuOpen(!menuOpen)}
            className={`-mr-2 flex h-11 w-11 items-center justify-center ${t.muted}`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>

          {menuOpen && (
            <div className={`absolute right-0 top-12 z-10 w-52 overflow-hidden rounded-2xl ${t.surface} shadow-xl`}>
              {menuItems.map(([label, target]) => (
                <button
                  key={target}
                  onClick={async () => {
                    setMenuOpen(false)
                    if (target === 'skinProfile') await loadSkinProfile()
                    setScreen(target)
                  }}
                  className={`block w-full px-5 py-3.5 text-left text-[15px] ${t.muted}`}
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
                className={`block w-full border-t px-5 py-3.5 text-left text-[15px] ${t.hair} ${t.faint}`}
              >
                Log out
              </button>
            </div>
          )}
        </div>

        <div className="mt-7">
          <p className={`text-[15px] ${t.muted}`}>
            {isNight ? 'Good evening' : 'Good morning'}, {displayName}
          </p>

          <h1 className="mt-1.5 font-display text-[58px] font-light leading-[0.95] tracking-tight">
            {isRestNight ? 'Rest night' : isNight ? 'Tonight' : 'Morning'}
          </h1>

          {isRestNight ? (
            <p className={`mt-3.5 max-w-[300px] text-[15px] leading-relaxed ${t.muted}`}>
              Nothing strong tonight. Your skin repairs itself between actives,
              so this counts as part of the routine.
            </p>
          ) : (
            <p className={`mt-2.5 text-sm ${t.muted}`}>
              {new Date().toLocaleDateString('en-GB', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </p>
          )}
        </div>

        <div className="relative mt-9 flex-grow">
          {routinesLoading ? (
            <p className={`text-sm ${t.muted}`}>Getting your routine…</p>
          ) : !hasRoutine ? (
            <div>
              <p className={`text-[15px] leading-relaxed ${t.muted}`}>
                You haven't set up {isNight ? 'a night' : 'a morning'} routine yet.
              </p>
              <button
                onClick={() => setScreen('routinePlanner')}
                className={`mt-5 rounded-2xl px-5 py-3.5 text-[15px] font-bold ${t.btn}`}
              >
                Build my routine
              </button>
            </div>
          ) : (
            <>
              <div className={`absolute left-[17px] top-5 bottom-6 w-px ${t.rail}`} />

              <div className="relative flex flex-col gap-5">
                {activeSteps.map((step, index) => {
                  const done = completedSteps.includes(step.id)

                  return (
                    <button
                      key={step.id}
                      onClick={() => toggleStepCompletion(step.id)}
                      className="flex items-start gap-4 text-left"
                    >
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                          done ? t.nodeDone : t.node
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
                            done ? `${t.faint} line-through` : ''
                          }`}
                        >
                          {step.name}
                        </span>

                        <span className={`mt-0.5 block text-[13px] ${done ? t.faint : t.muted}`}>
                          {step.brand}
                        </span>

                        {step.active && step.active !== 'none' && !done && (
                          <span className={`mt-2 inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${t.chip}`}>
                            {step.active === 'retinoid' ? 'Retinol night' : 'Active tonight'}
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>

              {notes.length > 0 && (
                <div className={`mt-7 flex flex-col gap-3 border-t pt-5 ${t.hair}`}>
                  {notes.map((note, i) => (
                    <p key={i} className={`text-sm leading-relaxed ${t.muted}`}>
                      {note}
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {hasRoutine && !routinesLoading && (
          <div className="flex flex-col gap-3.5 pt-8">
            <p className={`text-[13px] ${t.faint}`}>
              {doneCount} of {activeSteps.length} done
            </p>

            <button
              onClick={finishRoutine}
              className={`w-full rounded-2xl py-[18px] text-base font-bold ${t.btn}`}
            >
              {isNight ? 'Done for tonight' : 'Done for this morning'}
            </button>

            <button
              onClick={() => setViewMode(isNight ? 'morning' : 'night')}
              className={`py-1 text-[13px] ${t.faint}`}
            >
              {isNight ? 'View this morning instead' : "View tonight instead"}
            </button>
          </div>
        )}

      </div>
    </main>
  )
}


if (screen === 'routinePlanner') {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto w-full max-w-2xl">

        <div className="mb-8 flex items-center justify-between">
  <button
    onClick={() => setScreen('today')}
    className="text-sm font-medium text-blue-600"
  >
    ← Back to Today
  </button>

  <button
  onClick={async () => {
    await loadRoutineHistory()
    setScreen('routineHistory')
  }}
  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-blue-200"
>
  Routine History
</button>
</div>

        <div className="mb-8">
          <p className="text-sm font-semibold text-blue-600">
            MY ROUTINE
          </p>

          <h1 className="mt-2 text-3xl font-display font-normal tracking-tight text-slate-900">
            Build your routine
          </h1>

          <p className="mt-3 text-slate-500">
            Tell Tracka when you want to use each product, and it will organize your morning and night routines.
          </p>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">

          <h2 className="text-xl font-semibold text-slate-900">
            Your products
          </h2>

          <p className="mt-2 text-sm text-slate-500">
            Choose when you use each product.
          </p>

          <div className="mt-6 space-y-4">

            {products.length === 0 ? (
              <div className="rounded-2xl bg-slate-50 p-5 text-center">
                <p className="text-sm text-slate-500">
                  You haven't added any products yet.
                </p>

                <button
                  onClick={() => setScreen('addProduct')}
                  className="mt-4 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white"
                >
                  + Add a product
                </button>
  
              </div>
            ) : (
              products.map((item) => (
                <div
                                  key={item.id}
                  className="rounded-2xl border border-slate-100 bg-slate-50 p-4"
                >
                  <p className="text-xs font-semibold uppercase text-slate-400">
                    {item.products?.brand}
                  </p>

                  <p className="mt-1 font-medium text-slate-900">
                    {item.products?.name}
                  </p>

                  <p className="mt-1 text-xs text-slate-500">
                    {item.products?.category}
                  </p>

                   <div className="mt-4">
  <label className="text-xs font-semibold text-slate-500">
    When do you want to use this?
  </label>

  <select
    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-blue-400"
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
  <label className="text-xs font-semibold text-slate-500">
    How often?
  </label>

  <select
    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-blue-400"
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
  className="mt-6 w-full rounded-2xl bg-blue-600 px-6 py-4 font-semibold text-white transition hover:bg-blue-700"
>
  Create my routine
</button>

<button
  onClick={() => setScreen('products')}
  className="mt-4 w-full rounded-2xl border border-slate-200 bg-white px-6 py-4 font-semibold text-slate-700 transition hover:border-blue-200"
>
  ← Back to My Products
</button>

<div className="mt-6 rounded-3xl border border-blue-100 bg-blue-50 p-6">
                  </div>

      </div>
    </main>
  )
}
if (screen === 'routineHistory') {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto w-full max-w-2xl">

        <button
          onClick={() => setScreen('routinePlanner')}
          className="mb-8 text-sm font-medium text-blue-600"
        >
          ← Back to My Routine
        </button>

        <div className="mb-8">
          <p className="text-sm font-semibold text-blue-600">
            ROUTINE HISTORY
          </p>

          <h1 className="mt-2 text-3xl font-display font-normal tracking-tight text-slate-900">
            Your previous routines
          </h1>

          <p className="mt-3 text-slate-500">
            Look back at the routines you have used before.
          </p>
        </div>

        {routineHistory.length === 0 ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <p className="font-medium text-slate-700">
              No previous routines yet.
            </p>

            <p className="mt-2 text-sm text-slate-500">
              Your old routines will appear here when you create a new routine.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
           {routineHistory.map((routine) => (
  <div
    key={routine.routine_code}
    className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
  >
    <p className="text-xs font-semibold uppercase text-slate-400">
      Previous routine
    </p>

    <button
  onClick={() => {
    setSelectedRoutine(routine)
    setScreen('routineDetails')
  }}
  className="mt-1 text-left text-xl font-semibold text-blue-600 hover:text-blue-700"
>
  {routine.routine_code || 'No routine code'}
</button>

    <p className="mt-1 text-sm text-slate-500">
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
    <main className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto w-full max-w-2xl">

        <button
          onClick={() => setScreen('routineHistory')}
          className="mb-8 text-sm font-medium text-blue-600"
        >
          ← Back to Routine History
        </button>

        <div className="mb-8">
          <p className="text-sm font-semibold text-blue-600">
            ROUTINE DETAILS
          </p>

          <h1 className="mt-2 text-3xl font-display font-normal tracking-tight text-slate-900">
            {selectedRoutine?.routine_code}
          </h1>

          <p className="mt-3 text-slate-500">
            Previous routine
          </p>
        </div>

       {selectedRoutine?.routines
  ?.sort((a, b) => {
    if (a.time_of_day === 'AM') return -1
    if (b.time_of_day === 'AM') return 1
    return 0
  })
  .map((routine) => (
          <div
            key={routine.id}
            className="mb-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <h2 className="text-xl font-semibold text-slate-900">
              {routine.time_of_day === 'AM'
                ? 'Morning routine'
                : 'Night routine'}
            </h2>

            <div className="mt-5 space-y-3">
              {routine.steps.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No steps recorded.
                </p>
              ) : (
                routine.steps.map((step, index) => (
                  <div
                    key={step.id}
                    className="rounded-2xl bg-slate-50 p-4"
                  >
                    <p className="text-xs font-semibold text-slate-400">
                      STEP {index + 1}
                    </p>

                    <p className="mt-1 font-medium text-slate-800">
                      {step.step_name}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        ))}

      </div>
    </main>
  )
}
if (screen === 'completed') {
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-md text-center">

        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl">
          ✓
        </div>

        <p className="text-sm font-semibold text-green-600">
          ROUTINE COMPLETE
        </p>

        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
          You’ve completed your routine for today!
        </h1>

        <p className="mt-4 text-slate-500">
          Great job taking care of your skin. See you tomorrow 👋
        </p>

        <button
          onClick={() => setScreen('progress')}
          className="mt-8 w-full rounded-2xl bg-blue-600 px-6 py-4 font-semibold text-white transition hover:bg-blue-700"
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
                            : `${t.muted} ${t.surfaceMuted ?? ''}`
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
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center px-6">
      <div className="w-full max-w-md text-center">

        <div className="mb-10">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-2xl font-bold text-white">
            T
          </div>

          <h1 className="text-5xl font-semibold tracking-tight text-slate-900">
            Tracka
          </h1>

          <p className="mt-4 text-lg leading-7 text-slate-500">
            Your daily skincare routine tracker.
          </p>
        </div>

        <button
          onClick={() => setScreen('auth')}
          className="w-full rounded-2xl bg-blue-600 px-6 py-4 text-base font-semibold text-white shadow-sm transition hover:bg-blue-700"
        >
          Get Started
        </button>

        <p className="mt-6 text-sm text-slate-400">
          Build your routine. Stay consistent. Track your progress.
        </p>

      </div>
    </main>
  )
}

export default App