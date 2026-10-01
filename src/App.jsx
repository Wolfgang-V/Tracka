import { useState, useEffect, useRef } from 'react'
import { supabase } from './lib/supabase'
import { planNight, localDateString, addDays, addMonths, dayOfWeek, PREGNANCY_NOTE } from './lib/core/planNight'
import { BRANDS } from './lib/core/brands'
import { searchBrands, searchProducts } from './lib/core/openBeautyFacts'
import { searchNigerianBrands, searchNigerianProducts } from './lib/core/nigerianProducts'
import { findIngredientDetails, checkRoutineConflicts } from './lib/core/ingredientGuide'
import { generateStreakImage, generateSkinReportImage, isMilestoneStreak } from './lib/shareImage'
import { flameColorForStreak, FLAME_PATH, lighten, darken } from './lib/core/flameColor'
const VAPID_PUBLIC_KEY =
  'BL4tLhVl-G91FsMmVh2rhGbynJeqh1U6L3fIrg-E0rhC7fMLavWVfPLNGOjyM8TQqGFWaLmPByvs_3k2A23KsFE'

// Fixed rather than window.location.origin — the old vercel.app URL still
// resolves alongside the custom domain, so a signup or password reset
// started from there would otherwise bake that domain into the email link.
const SITE_URL = 'https://www.trackaplus.app'

// This is a UX shortcut, not the security boundary — the real enforcement
// is server-side, in admin_list_users() checking the caller's email
// before returning anything. This just decides which screen to show.
const ADMIN_EMAIL = 'trackaplusapp@gmail.com'

// Temporary — product/brand data (local BRANDS list, Nigerian
// brands/products list, live Open Beauty Facts search) is on hold until
// there's a real database/structure behind it. The Brand and Product
// name fields stay as plain text; only the autocomplete/matching is off.
// Flip this back to true once that data exists, nothing else needs to change.
const PRODUCT_SUGGESTIONS_ENABLED = true

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)))
}

// Fires immediately from client-side actions (new product, routine built)
// rather than through the push pipeline — no server round trip needed for
// a nudge that's reacting to something that just happened on this device.
// Silently does nothing if permission was never granted; doesn't prompt.
const showLocalNotification = async (title, body) => {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  if (!('serviceWorker' in navigator)) return

  try {
    const registration = await navigator.serviceWorker.ready
    await registration.showNotification(title, {
      body,
      tag: 'tracka-local',
      icon: '/icons/icon-192.png',
    })
  } catch (error) {
    console.error('LOCAL NOTIFICATION ERROR:', error)
  }
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

  // Shared busy-tracker for buttons that kick off an async action with no
  // dedicated loading state of their own. An impatient user re-tapping a
  // button mid-request used to fire the same signup/login/mutation twice;
  // this makes a second tap on the SAME action a no-op, and every wired-up
  // button dims + disables itself while its own key is busy.
  const [busyAction, setBusyAction] = useState(null)
  const runBusy = async (key, fn) => {
    if (busyAction) return
    setBusyAction(key)
    try {
      await fn()
    } finally {
      setBusyAction(null)
    }
  }

  // There's no router, so nothing was ever pushed onto browser history when
  // screen changed — every screen sat on the same single entry. On Android,
  // the system/gesture back button acts on that history, so with nothing to
  // pop it closed the app straight from wherever the person was, instead of
  // stepping back a screen the way Back buttons elsewhere in the UI do.
  // isPoppingRef distinguishes "the user hit hardware back" (state already
  // moved, don't push again) from "the app navigated forward" (push a new
  // entry so back has somewhere to go).
  const isPoppingRef = useRef(false)

  useEffect(() => {
    // The browser's own scroll restoration tries to remember and replay a
    // scroll offset per history entry. That's meant for real page loads —
    // here every "page" is the same document with different content
    // swapped in, so replaying an old offset onto new content is what
    // produced the jump on back/forward. Doing it ourselves instead means
    // every screen change, including hardware back, always lands at the top.
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }

    window.history.replaceState({ screen }, '')

    const onPopState = (event) => {
      const previousScreen = event.state?.screen
      if (previousScreen) {
        isPoppingRef.current = true
        setScreen(previousScreen)
      }
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (isPoppingRef.current) {
      isPoppingRef.current = false
    } else {
      window.history.pushState({ screen }, '')
    }
    window.scrollTo(0, 0)
  }, [screen])

  // Replaces the native alert dialog everywhere so error/success messages
  // look like the app instead of the OS. tone: 'error' | 'success'.
  const [toast, setToast] = useState(null)
  const [adminUsers, setAdminUsers] = useState([])
  const [adminLoading, setAdminLoading] = useState(true)
  const [adminError, setAdminError] = useState(null)
  const [adminTab, setAdminTab] = useState('signups')
  const [pendingPractitioners, setPendingPractitioners] = useState([])
  const [pendingPractitionersLoading, setPendingPractitionersLoading] = useState(true)
  const notify = (message, tone = 'error') => setToast({ message, tone })

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  // Replaces window.confirm() — resolves true/false once the person taps
  // an option, same as the native dialog but styled on-brand. Labels
  // default to Cancel/Confirm but can be overridden for cases where that
  // framing doesn't fit a plain yes/no question.
  const [confirmState, setConfirmState] = useState(null)
  const confirmAction = (message, labels) =>
    new Promise((resolve) => setConfirmState({ message, resolve, labels }))

  // Keeps the page from scrolling behind the confirm dialog while it's open.
  useEffect(() => {
    if (!confirmState) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [confirmState])
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
  const [loginError, setLoginError] = useState(null)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  // Gates the bottom tab bar / quick-nav grid on the onboarding screens —
  // a brand-new user only sees the 3-step flow until they finish it, no
  // way to wander off to progress/insights/photos before there's anything
  // there to show. Defaults true so a returning user's nav never
  // flickers hidden while this loads.
  const [onboardingCompleted, setOnboardingCompleted] = useState(true)

  const [gender, setGender] = useState('')
  // undefined = not yet answered (nothing shows selected); null is reserved
  // for an explicit "Prefer not to say" so the two don't look identical.
  const [pregnantOrBreastfeeding, setPregnantOrBreastfeeding] = useState(undefined)
  const [restrictions, setRestrictions] = useState({})
  const [skinType, setSkinType] = useState('')
  const [concerns, setConcerns] = useState([])
  const [goals, setGoals] = useState([])
  const [sensitivity, setSensitivity] = useState('')
  // Only relevant once onboarding is done — during onboarding itself this
  // screen is always the form. Revisiting later defaults to the read-only
  // summary; "Update" swaps in the same form pre-filled with what's saved.
  const [skinProfileEditing, setSkinProfileEditing] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [resetStatus, setResetStatus] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [settingsUsername, setSettingsUsername] = useState('')
  const [brandSuggestionsOpen, setBrandSuggestionsOpen] = useState(false)
  const [liveBrandMatches, setLiveBrandMatches] = useState([])
  const [productSuggestionsOpen, setProductSuggestionsOpen] = useState(false)
  const [liveProductMatches, setLiveProductMatches] = useState([])
  const [settingsStatus, setSettingsStatus] = useState(null)
  const [morningReminderEnabled, setMorningReminderEnabled] = useState(true)
  const [morningReminderTime, setMorningReminderTime] = useState('07:00')
  const [nightReminderEnabled, setNightReminderEnabled] = useState(true)
  const [nightReminderTime, setNightReminderTime] = useState('21:00')
  const [spfReapplyEnabled, setSpfReapplyEnabled] = useState(false)
  const [diaryNudgeEnabled, setDiaryNudgeEnabled] = useState(false)
  const [pendingRecommendations, setPendingRecommendations] = useState([])
  const [pendingRecommendationsLoading, setPendingRecommendationsLoading] = useState(false)
  const [recommendationHistory, setRecommendationHistory] = useState([])
  const [recommendationHistoryLoading, setRecommendationHistoryLoading] = useState(false)
  const [verifiedPractitioners, setVerifiedPractitioners] = useState([])
  const [verifiedPractitionersLoading, setVerifiedPractitionersLoading] = useState(false)
  const [findProfessionalQuery, setFindProfessionalQuery] = useState('')
  const [careRelationships, setCareRelationships] = useState([])
  const [careAccessLog, setCareAccessLog] = useState([])
  const [endedRelationships, setEndedRelationships] = useState([])
  const [careTeamLoading, setCareTeamLoading] = useState(false)
  const [practitionerStatus, setPractitionerStatus] = useState(null) // null | 'pending' | 'verified'
  const [applyDisplayName, setApplyDisplayName] = useState('')
  const [applyTitle, setApplyTitle] = useState('')
  const [applyBio, setApplyBio] = useState('')
  const [applySpecialisms, setApplySpecialisms] = useState('')
  const [applyInstagram, setApplyInstagram] = useState('')
  const [applyWhatsapp, setApplyWhatsapp] = useState('')
  const [applySaving, setApplySaving] = useState(false)
  const [hasPendingInvite, setHasPendingInvite] = useState(false)
  const [practitionerClients, setPractitionerClients] = useState([])
  const [practitionerClientsLoading, setPractitionerClientsLoading] = useState(false)
  const [selectedClientId, setSelectedClientId] = useState(null)
  const [clientDetail, setClientDetail] = useState(null)
  const [clientDetailLoading, setClientDetailLoading] = useState(false)
  const [clientRoutineSteps, setClientRoutineSteps] = useState({ am: [], pm: [] })
  const [clientProducts, setClientProducts] = useState([])
  const [addClientEmail, setAddClientEmail] = useState('')
  const [addClientSaving, setAddClientSaving] = useState(false)
  const [addClientResult, setAddClientResult] = useState(null)
  const [addLinkLabel, setAddLinkLabel] = useState('')
  const [addLinkSaving, setAddLinkSaving] = useState(false)
  const [pendingInvitations, setPendingInvitations] = useState([])
  const [pendingInvitationsLoading, setPendingInvitationsLoading] = useState(false)
  const [composeIncludeSkinProfile, setComposeIncludeSkinProfile] = useState(false)
  const [composeGender, setComposeGender] = useState('')
  const [composePregnant, setComposePregnant] = useState(undefined)
  const [composeSkinType, setComposeSkinType] = useState('')
  const [composeConcerns, setComposeConcerns] = useState([])
  const [composeGoals, setComposeGoals] = useState([])
  const [composeSensitivity, setComposeSensitivity] = useState('')
  const [composeItems, setComposeItems] = useState([])
  const [composeItemBrand, setComposeItemBrand] = useState('')
  const [composeItemName, setComposeItemName] = useState('')
  const [composeItemCategory, setComposeItemCategory] = useState('')
  const [composeItemSlot, setComposeItemSlot] = useState('AM')
  const [composeItemDays, setComposeItemDays] = useState([0, 1, 2, 3, 4, 5, 6])
  const [composeItemReason, setComposeItemReason] = useState('')
  const [composeNote, setComposeNote] = useState('')
  const [composeSaving, setComposeSaving] = useState(false)
  const [practitionerRecommendations, setPractitionerRecommendations] = useState([])
  const [practitionerRecommendationsLoading, setPractitionerRecommendationsLoading] = useState(false)
  const [recommendationsFilter, setRecommendationsFilter] = useState('all')
  const [productBrand, setProductBrand] = useState('')
  const [productName, setProductName] = useState('')
  const [productCategory, setProductCategory] = useState('')
  const [productIngredients, setProductIngredients] = useState('')
  const [ingredientQuery, setIngredientQuery] = useState('')
  const [productOpenedDate, setProductOpenedDate] = useState('')
  const [productPaoMonths, setProductPaoMonths] = useState(0)
  const [productExpiryDate, setProductExpiryDate] = useState('')
  const [productSaving, setProductSaving] = useState(false)
  const [products, setProducts] = useState([])
  // Per product, which weekdays (0=Sun..6=Sat) it's used on — this is the
  // whole schedule now, the separate frequency dropdown was folded into
  // it. Sent to the DB with frequency always 'daily', which combined with
  // planNight's cadence logic makes days_of_week the effective schedule.
  const [productDays, setProductDays] = useState({})
  const [productTimes, setProductTimes] = useState({})

  const [todayAmRoutine, setTodayAmRoutine] = useState(null)
  const [todayPmRoutine, setTodayPmRoutine] = useState(null)
  const [routinesLoading, setRoutinesLoading] = useState(true)
  const [routineHistory, setRoutineHistory] = useState([])
  const [routineSaving, setRoutineSaving] = useState(false)
  const [selectedRoutine, setSelectedRoutine] = useState(null)
  const loadRoutineHistory = async () => {
  if (!user) return

  const { data: routines, error: routinesError } =
    await supabase
      .from('routines')
      .select('*')
      .eq('user_id', user.id)
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
  const [lastCompletedSlot, setLastCompletedSlot] = useState(null)
  const [shareStreakBusy, setShareStreakBusy] = useState(false)
  const [reportSharing, setReportSharing] = useState(false)
  const [stepHistory, setStepHistory] = useState([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [pushStatus, setPushStatus] = useState(null)
  const [progressCompletions, setProgressCompletions] = useState([])
  const [selectedProgressDate, setSelectedProgressDate] = useState(null)
  const [dayDetailSteps, setDayDetailSteps] = useState(null)
  const [dayDetailLoading, setDayDetailLoading] = useState(false)
  const [progressMonthOffset, setProgressMonthOffset] = useState(0)
  const [skinLogs, setSkinLogs] = useState([])
  const todayNoteRef = useRef(null)
  const [monthlyReport, setMonthlyReport] = useState(null)
  const [monthlyReportLoading, setMonthlyReportLoading] = useState(false)
  const [reportMonthOffset, setReportMonthOffset] = useState(0)
  const [progressPhotos, setProgressPhotos] = useState([])
  const [photoUrls, setPhotoUrls] = useState({})
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoError, setPhotoError] = useState(null)
  const [pendingPhoto, setPendingPhoto] = useState(null)
  const [comparePhotos, setComparePhotos] = useState([])
  const [viewingPhoto, setViewingPhoto] = useState(null)

  useEffect(() => {
    // These three only need a user id, not a fresh session lookup — each
    // used to call supabase.auth.getUser() itself, which is a network
    // round trip to revalidate the JWT. Four of those firing at once on
    // every mount (plus a fifth from checkUser) is what was slowing the
    // home screen down; now the caller resolves the session once and
    // hands the id in.
    const loadProducts = async (userId) => {
      if (!userId) return

      const { data, error } = await supabase
        .from('user_products')
        .select(`
          id,
          product_id,
          opened_date,
          pao_months,
          expiry_date,
          products (
            id,
            brand,
            name,
            category,
            ingredients
          )
        `)
        .eq('user_id', userId)
        .eq('is_active', true)

      if (error) {
        console.error(error)
        return
      }

      setProducts(data || [])
    }

    const loadCompletedSteps = async (userId) => {
      if (!userId) return

      const { data, error } = await supabase
        .from('routine_step_completions')
        .select('routine_step_id, completed_at')
        .eq('user_id', userId)
        .eq('local_date', localDateString())

      if (error) {
        console.error(error)
        return
      }

      setCompletedSteps(
        (data || []).map((item) => item.routine_step_id)
      )
    }

    const loadProgressCompletions = async (userId) => {
      if (!userId) return

      const { data, error } = await supabase
        .from('routine_completions')
        .select('completed_date, completed_at')
        .eq('user_id', userId)
        .order('completed_date', { ascending: true })

      if (error) {
        console.error(error)
        return
      }

      setProgressCompletions(data || [])
    }

    // Redeems a pending professional invite once a real session exists in
    // THIS browser. Invite links are shared over WhatsApp, so the click can
    // land in an in-app browser that's a different storage context than the
    // installed PWA — same root cause as the confirmed=true bug above. We
    // can't fix that cross-browser gap, but stashing the token in
    // localStorage means it survives login/signup INSIDE whichever browser
    // it was opened in, instead of being lost the moment the URL param is
    // stripped.
    const redeemPendingInvite = async () => {
      let token
      try {
        token = localStorage.getItem('pendingInviteToken')
      } catch {
        return
      }
      if (!token) return

      const { error } = await supabase.rpc('accept_invitation', { p_token: token })

      if (!error) {
        try { localStorage.removeItem('pendingInviteToken') } catch {}
        setHasPendingInvite(false)
        notify("You're now connected with your professional.", 'success')
        return
      }

      const permanent = /already used|not found|expired/i.test(error.message || '')
      if (permanent) {
        try { localStorage.removeItem('pendingInviteToken') } catch {}
        setHasPendingInvite(false)
        if (/expired/i.test(error.message || '')) {
          notify('That invite link has expired. Ask your professional to send a new one.')
        }
        return
      }

      // Network blip or similar — leave it in storage, we'll retry on the
      // next auth state change instead of losing the invite silently.
      console.error('INVITE REDEEM ERROR:', error)
    }

    const checkUser = async (user) => {
      try {
        setUser(user)
        redeemPendingInvite()

        if (user.email === ADMIN_EMAIL) {
          setScreen('admin')
          return
        }

        const isRecovery = window.location.search.includes('recovery=true')

        const [{ data: profile, error }, { data: existingSkinProfile }] = await Promise.all([
          supabase.from('profiles').select('username, onboarding_completed').eq('id', user.id).maybeSingle(),
          // New users land on the skin profile step until they've filled
          // it in at least once; after that, straight to Today.
          isRecovery
            ? Promise.resolve({ data: null })
            : supabase.from('skin_profiles').select('id').eq('user_id', user.id).limit(1).maybeSingle(),
        ])

        if (!isRecovery) {
          setScreen(existingSkinProfile ? 'today' : 'skinProfile')
        }

        if (error) {
          console.error('Profile error:', error)
          return
        }

        if (profile?.username) {
          setDisplayName(profile.username)
        } else {
          setDisplayName(user.email?.split('@')[0] || 'there')
        }

        setOnboardingCompleted(profile?.onboarding_completed !== false)

        await loadRestrictions(user.id)
      } finally {
        setAuthReady(true)
      }
    }

    const init = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        console.log('No logged-in user found')
        setAuthReady(true)
        return
      }

      checkUser(user)
      loadProducts(user.id)
      loadCompletedSteps(user.id)
      loadProgressCompletions(user.id)
    }

    const inviteMatch = window.location.search.match(/[?&]invite=([0-9a-fA-F-]{36})/)
    if (inviteMatch) {
      try { localStorage.setItem('pendingInviteToken', inviteMatch[1]) } catch {}
      window.history.replaceState({}, '', window.location.pathname)
    }
    try {
      if (localStorage.getItem('pendingInviteToken')) setHasPendingInvite(true)
    } catch {}

    if (window.location.search.includes('confirmed=true')) {
      window.history.replaceState({}, '', window.location.pathname)

      // Confirming email doesn't always mean this browser is signed in.
      // Clicking the link from an email app's in-app browser (Gmail's,
      // most often) creates the session there, not in whatever browser
      // Tracka+ itself is running in — different origin, different
      // storage. getSession() checks this browser's actual state instead
      // of assuming the confirmation implies a session here too, which is
      // what unconditionally forcing the login screen used to do — even
      // for someone who confirmed in the same browser and already had a
      // valid session the app was ignoring.
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          init()
        } else {
          notify('Your email is confirmed. Log in to finish setting up.', 'success')
          setScreen('login')
          setAuthReady(true)
        }
      })
    } else {
      init()
    }

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
        loadProducts(session.user.id)
        loadCompletedSteps(session.user.id)
        loadProgressCompletions(session.user.id)
        redeemPendingInvite()
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

  if (!user) {
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
    .eq('user_id', user.id)
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

  // Rebuilding a routine (Build my routine) creates a fresh routine_step
  // row per product rather than reusing the old one, so the same real
  // product can have completions logged against two different
  // routine_step_ids on the same day. Dedupe by what the product actually
  // is, not by which routine_step happened to record it.
  const seen = new Set()
  const dedupedSteps = steps.filter((step) => {
    const key = `${step.timeOfDay}|${step.name}|${step.brand}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  setDayDetailSteps(dedupedSteps)
  setDayDetailLoading(false)
}

const loadSkinLogs = async () => {
  if (!user) return

  // No date floor — notes now live here too, and the Progress Photos
  // timeline shows them the same way it shows photos, which also aren't
  // capped to the last 30 days.
  const { data, error } = await supabase
    .from('skin_logs')
    .select('local_date, breakouts, dryness, oiliness, redness, note')
    .eq('user_id', user.id)

  if (error) {
    console.error('SKIN LOG HISTORY ERROR:', error)
    return
  }

  setSkinLogs(data || [])
}

// Month-to-date stats for the "Skin reports" screen — always reflects the
// current month so far (check it on the 10th, get 10 days of data), rather
// than waiting for month-end to generate a fixed recap.
const loadMonthlyReport = async (monthOffset = 0) => {
  if (!user) return
  setMonthlyReportLoading(true)

  const now = new Date()
  const displayed = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
  const isCurrentMonth = monthOffset === 0
  const firstOfMonth = `${displayed.getFullYear()}-${String(displayed.getMonth() + 1).padStart(2, '0')}-01`
  const firstOfNextMonth = `${displayed.getFullYear()}-${String(displayed.getMonth() + 2).padStart(2, '0')}-01`
  const daysInDisplayedMonth = new Date(displayed.getFullYear(), displayed.getMonth() + 1, 0).getDate()

  // Independent queries for completions and photos, rather than reading
  // the progressCompletions/progressPhotos state — those only get loaded
  // once their own screens have been visited this session, so relying on
  // them here would show 0s for anyone who opens Skin reports (or Today,
  // where the report also loads) before ever visiting Progress Photos.
  // Upper-bounded with firstOfNextMonth too (not just gte firstOfMonth) —
  // viewing a past month otherwise swept in everything from that month
  // through today, since there was previously no reason to cap it (the
  // report only ever showed the current month, where "today" already is
  // the cap).
  const [{ data, error }, { data: completions, error: completionsError }, { count: photosAdded, error: photosError }] =
    await Promise.all([
      supabase
        .from('routine_step_completions')
        .select(`
          local_date,
          routine_steps (
            routines ( time_of_day ),
            user_products ( product_id, products ( category ) )
          )
        `)
        .eq('user_id', user.id)
        .gte('local_date', firstOfMonth)
        .lt('local_date', firstOfNextMonth),
      supabase
        .from('routine_completions')
        .select('completed_date')
        .eq('user_id', user.id),
      supabase
        .from('progress_photos')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('local_date', firstOfMonth)
        .lt('local_date', firstOfNextMonth),
    ])

  if (error || completionsError || photosError) {
    console.error('MONTHLY REPORT ERROR:', error || completionsError || photosError)
    setMonthlyReportLoading(false)
    return
  }

  const rows = (data || []).filter((r) => r.routine_steps)

  const sunscreenDays = new Set(
    rows
      .filter((r) => (r.routine_steps.user_products?.products?.category || '').toLowerCase() === 'sunscreen')
      .map((r) => r.local_date)
  ).size

  const productIds = new Set(
    rows.map((r) => r.routine_steps.user_products?.product_id).filter(Boolean)
  )

  const amDays = new Set(
    rows.filter((r) => r.routine_steps.routines?.time_of_day === 'AM').map((r) => r.local_date)
  )
  const pmDays = new Set(
    rows.filter((r) => r.routine_steps.routines?.time_of_day === 'PM').map((r) => r.local_date)
  )

  const amVsPm =
    amDays.size === 0 && pmDays.size === 0
      ? '—'
      : Math.abs(amDays.size - pmDays.size) <= 2
        ? 'Both'
        : amDays.size > pmDays.size
          ? 'AM'
          : 'PM'

  const daysElapsed = isCurrentMonth ? now.getDate() : daysInDisplayedMonth
  const completionsThisMonth = (completions || []).filter(
    (c) => c.completed_date >= firstOfMonth && c.completed_date < firstOfNextMonth
  ).length
  const routineCompletionPct = daysElapsed > 0 ? Math.round((completionsThisMonth / daysElapsed) * 100) : 0

  // Longest streak is all-time, not scoped to this month — the point is
  // "your record", not "your record so far in September".
  const allDates = new Set((completions || []).map((c) => c.completed_date))
  const sortedDates = [...allDates].sort()
  let longest = 0
  let run = 0
  let prevDate = null
  for (const d of sortedDates) {
    run = prevDate && addDays(prevDate, 1) === d ? run + 1 : 1
    longest = Math.max(longest, run)
    prevDate = d
  }

  setMonthlyReport({
    monthLabel: displayed.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    isCurrentMonth,
    routineCompletionPct,
    sunscreenDays,
    productsUsed: productIds.size,
    currentStreak,
    longestStreak: longest,
    amVsPm,
    photosAdded: photosAdded || 0,
  })
  setMonthlyReportLoading(false)
}

const loadProgressPhotos = async () => {
  if (!user) return

  const { data, error } = await supabase
    .from('progress_photos')
    .select('id, path, local_date, note, created_at')
    .eq('user_id', user.id)
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

  const { data: { session }, error: sessionError } = await supabase.auth.getSession()

  if (sessionError) {
    setPhotoError("Couldn't reach the server. Check your connection and try again.")
    setPhotoUploading(false)
    return
  }

  if (!session?.user) {
    setPhotoError('Your session ended. Please log in again.')
    setPhotoUploading(false)
    setScreen('login')
    return
  }

  const ext = file.name.split('.').pop() || 'jpg'
  const path = `${session.user.id}/${Date.now()}.${ext}`

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
    user_id: session.user.id,
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
  const { error: storageError } = await supabase.storage.from('progress-photos').remove([photo.path])

  if (storageError) {
    console.error('PHOTO DELETE STORAGE ERROR:', storageError)
    setPhotoError("Couldn't delete that photo. Try again.")
    return
  }

  const { error: rowError } = await supabase.from('progress_photos').delete().eq('id', photo.id)

  if (rowError) {
    // The file is already gone from storage at this point — leaving the
    // row behind just means loadProgressPhotos will show a broken image,
    // not a leaked file. Surface it so it isn't silently lost either way.
    console.error('PHOTO DELETE ROW ERROR:', rowError)
    setPhotoError("Deleted the photo but couldn't remove its record. Try again.")
    return
  }

  setViewingPhoto(null)
  setComparePhotos((ids) => ids.filter((id) => id !== photo.id))
  await loadProgressPhotos()
}

const saveProgressPhotoNote = async (photo, note) => {
  const { error } = await supabase.from('progress_photos').update({ note }).eq('id', photo.id)

  if (error) {
    console.error('PHOTO NOTE ERROR:', error)
    // The textarea this is called from is uncontrolled (defaultValue), so
    // without this the typed text just sits there looking saved — closing
    // and reopening the photo would silently revert to the old note.
    notify("That note didn't save. Try again.")
    return
  }

  setProgressPhotos((photos) => photos.map((p) => (p.id === photo.id ? { ...p, note } : p)))
  setViewingPhoto((v) => (v ? { ...v, note } : v))
}

// Shared by the Today page's "Daily notes" box (always today's date) and
// the Progress Photos journey viewer (an arbitrary past date, since a
// note-only entry there can be edited or cleared after the fact).
const saveNoteForDate = async (date, note) => {
  if (!user) {
    notify('Please log in again.')
    return
  }

  const { error } = await supabase.from('skin_logs').upsert(
    {
      user_id: user.id,
      local_date: date,
      note,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,local_date' }
  )

  if (error) {
    console.error('SKIN NOTE SAVE ERROR:', error)
    notify("That note didn't save. Try again.")
    return
  }

  setSkinLogs((logs) =>
    logs.some((log) => log.local_date === date)
      ? logs.map((log) => (log.local_date === date ? { ...log, note } : log))
      : [...logs, { local_date: date, note, breakouts: 0, dryness: 0, oiliness: 0, redness: 0 }]
  )

  notify('Note saved.', 'success')
}

const saveTodayNote = (note) => saveNoteForDate(localDateString(), note)

// Only the night routine counts toward the streak and lights up the
// calendar — the morning button just confirms and moves on, since a
// skincare "day" isn't done until the night steps are actually done.
const finishRoutine = async (slot) => {
  if (slot === 'PM') {
    const today = localDateString()

    const { error } = await supabase
      .from('routine_completions')
      .upsert(
        { user_id: user.id, completed_date: today },
        { onConflict: 'user_id,completed_date' }
      )

    if (error) {
      console.error('FINISH ROUTINE ERROR:', error)
      notify('That didn\'t save. Check your connection and try again.')
      return
    }

    setProgressCompletions((current) =>
      current.some((item) => item.completed_date === today)
        ? current
        : [...current, { completed_date: today, completed_at: new Date().toISOString() }]
    )
  }

  setLastCompletedSlot(slot)
  setScreen('completed')
}

// Renders tonight's completed steps into a shareable card and hands it to
// the OS share sheet (Instagram/WhatsApp/etc pick it up from there, same
// as any native app). Falls back to a plain download where the Web Share
// API can't take files — older Android WebViews, desktop Safari.
const shareStreak = async (streak, steps, routineLabel = 'Night Routine') => {
  if (shareStreakBusy) return
  setShareStreakBusy(true)

  try {
    const blob = await generateStreakImage({
      streak,
      routineLabel,
      dateLabel: new Date().toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }),
      products: steps.map((step) => ({
        name: step.name,
        category: step.category,
      })),
      isNight,
    })

    const file = new File([blob], 'tracka-streak.png', { type: 'image/png' })
    const caption = isMilestoneStreak(streak)
      ? `🔥 ${streak} day streak unlocked`
      : 'I showed up for my skin today'

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      // Full picture: the image lands directly in Instagram/WhatsApp/etc.
      await navigator.share({ files: [file], title: 'Tracka+', text: caption })
    } else if (navigator.share) {
      // Sharing files isn't supported here (older iOS Safari, some Android
      // WebViews), but plain text/link sharing has much wider support and
      // still opens the same native sheet with Instagram/WhatsApp/X in it.
      // Not chaining a download onto this one — a second user-gesture-style
      // action (the download prompt) right before the share call risks the
      // browser treating the share as no longer "in response to" the tap
      // and silently refusing it, which would be worse than no image.
      await navigator.share({ title: 'Tracka+', text: `${caption} ${SITE_URL}` })
    } else {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'tracka-streak.png'
      a.click()
      URL.revokeObjectURL(url)
      notify('Image saved — share it from your photos.', 'success')
    }
  } catch (err) {
    // AbortError just means they closed the share sheet without picking
    // anything — not a failure worth surfacing.
    if (err?.name !== 'AbortError') {
      console.error('SHARE STREAK ERROR:', err)
      notify('Could not create the image. Try again in a moment.')
    }
  } finally {
    setShareStreakBusy(false)
  }
}

const inviteFriend = async () => {
  const shareData = {
    title: 'Tracka+',
    // SITE_URL, not window.location.origin — same reasoning as the auth
    // emails: the old vercel.app URL still resolves, so sharing whatever
    // domain the tab happened to be on would leak that instead of the
    // custom domain.
    text: 'I track my skincare routine with Tracka+ — join me.',
    url: SITE_URL,
  }

  if (navigator.share) {
    try {
      await navigator.share(shareData)
    } catch (err) {
      if (err?.name !== 'AbortError') console.error('INVITE SHARE ERROR:', err)
    }
    return
  }

  if (navigator.clipboard) {
    await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`)
    notify('Invite link copied — paste it anywhere.', 'success')
  } else {
    notify(shareData.url, 'success')
  }
}

// Same generate-then-share shape as shareStreak, just a different image
// generator and no separate fallback file name collision — a Skin Report
// and a streak card saved in the same session shouldn't overwrite each
// other in the user's downloads.
const shareSkinReport = async () => {
  if (reportSharing || !monthlyReport) return
  setReportSharing(true)

  try {
    const blob = await generateSkinReportImage({ report: monthlyReport, isNight })
    const file = new File([blob], 'tracka-skin-report.png', { type: 'image/png' })
    const caption = `My ${monthlyReport.monthLabel} skin report on Tracka+`

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Tracka+', text: caption })
    } else if (navigator.share) {
      await navigator.share({ title: 'Tracka+', text: `${caption} ${SITE_URL}` })
    } else {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'tracka-skin-report.png'
      a.click()
      URL.revokeObjectURL(url)
      notify('Report saved — share it from your photos.', 'success')
    }
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.error('SHARE SKIN REPORT ERROR:', err)
      notify('Could not create the report. Try again in a moment.')
    }
  } finally {
    setReportSharing(false)
  }
}

  const loadRoutines = async () => {
  setRoutinesLoading(true)

  if (!user) {
    setRoutinesLoading(false)
    return
  }

  // One nested-select round trip (routines -> routine_steps -> user_products
  // -> products) instead of three sequential ones, each waiting on the ids
  // from the last. Same embedding pattern already used in loadDayDetails,
  // just rooted one level higher.
  const { data: routines, error: routinesError } = await supabase
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
          products ( brand, name, category, ingredients )
        )
      )
    `)
    .eq('user_id', user.id)
    .eq('is_active', true)
    .eq('routine_steps.is_active', true)
    .order('created_at', { ascending: false })
    .order('step_order', { foreignTable: 'routine_steps', ascending: true })

  if (routinesError) {
    console.error('ROUTINES ERROR:', routinesError)
    setRoutinesLoading(false)
    return
  }

  // If more than one active routine ever exists per time-of-day (e.g. from
  // a double-tapped "Create my routine" before that was guarded against),
  // take the newest rather than whichever the DB happens to return first.
  const amRoutine = (routines || []).find(
    (routine) => routine.time_of_day === 'AM'
  )

  const pmRoutine = (routines || []).find(
    (routine) => routine.time_of_day === 'PM'
  )

  setTodayAmRoutine(amRoutine || null)
  setTodayPmRoutine(pmRoutine || null)
  setTodayAmSteps(amRoutine?.routine_steps || [])
  setTodayPmSteps(pmRoutine?.routine_steps || [])

  setRoutinesLoading(false)
}
  const toggleStepCompletion = async (stepId) => {
  const alreadyCompleted = completedSteps.includes(stepId)
  const today = localDateString()

  if (alreadyCompleted) {
    const { error } = await supabase
      .from('routine_step_completions')
      .delete()
      .eq('routine_step_id', stepId)
      .eq('user_id', user.id)
      .eq('local_date', today)

    if (error) {
      console.error(error)
      notify('Could not update this step.')
      return
    }

    // Functional update, not `completedSteps.filter(...)` off the outer
    // closure — ticking a second step before this one's request resolves
    // would otherwise overwrite state with a snapshot that predates the
    // first tap, silently reverting it back to unchecked in the UI even
    // though its row was already saved.
    setCompletedSteps((current) => current.filter((id) => id !== stepId))

    return
  }

  // local_date is sent explicitly rather than left to a DB default —
  // a default computed in the server's timezone can disagree with
  // localDateString()'s 4am local cutoff, which silently breaks the
  // onConflict match below and surfaces as "Could not complete this step."
  const { error } = await supabase
    .from('routine_step_completions')
    .upsert(
      {
        user_id: user.id,
        routine_step_id: stepId,
        local_date: today,
      },
      { onConflict: 'user_id,routine_step_id,local_date' }
    )

  if (error) {
    console.error(error)
    notify('Could not complete this step.')
    return
  }

  setCompletedSteps((current) => (current.includes(stepId) ? current : [...current, stepId]))
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
    daysOfWeek: step.days_of_week,
    step_order: step.step_order,
    opened_date: step.user_products?.opened_date ?? null,
    pao_months: step.user_products?.pao_months ?? null,
  })),
  history: stepHistory.filter((entry) => entry.local_date < todayString),
  restrictions,
})

// AM gets the same day-of-week/cadence engine as PM — it used to just list
// every configured step unconditionally, which is why a product scheduled
// for only some days still showed up (and blocked "finish routine") every
// day. Actives conflict rules don't apply in the morning, so active is
// forced to 'none' rather than left to detectActive.
const amPlan = planNight({
  today: todayString,
  steps: todayAmSteps.map((step) => ({
    id: step.id,
    name: step.user_products?.products?.name || step.step_name,
    brand: step.user_products?.products?.brand,
    category: step.user_products?.products?.category,
    ingredients: step.user_products?.products?.ingredients,
    active: 'none',
    frequency: step.frequency,
    daysOfWeek: step.days_of_week,
    step_order: step.step_order,
    opened_date: step.user_products?.opened_date ?? null,
    pao_months: step.user_products?.pao_months ?? null,
  })),
  history: stepHistory.filter((entry) => entry.local_date < todayString),
  restrictions,
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
  // Sunscreen past its date isn't just inert like a serum would be — it
  // can leave you unprotected without any visible sign, so it gets a firm
  // warning instead of the same quiet note every other category gets.
  const isSunscreen = (item.products?.category || '').toLowerCase() === 'sunscreen'

  const paoExpires =
    item.opened_date && item.pao_months
      ? (() => {
          const d = new Date(item.opened_date + 'T00:00:00')
          d.setMonth(d.getMonth() + item.pao_months)
          return d
        })()
      : null

  const printedExpires = item.expiry_date
    ? new Date(item.expiry_date + 'T00:00:00')
    : null

  if (!paoExpires && !printedExpires) return null

  // Whichever comes sooner is the real use-by date — PAO only starts
  // counting once opened, but a printed expiry applies regardless.
  const expires =
    paoExpires && printedExpires
      ? (paoExpires < printedExpires ? paoExpires : printedExpires)
      : (paoExpires || printedExpires)

  const daysLeft = Math.round(
    (expires - new Date(todayString + 'T00:00:00')) / 86400000
  )

  if (daysLeft < 0) {
    return isSunscreen
      ? { label: 'Expired — don\'t rely on this for protection', expired: true, firm: true }
      : { label: 'Expired', expired: true }
  }
  if (daysLeft === 0) {
    return isSunscreen
      ? { label: 'Expires today — replace before your next reapply', expired: true, firm: true }
      : { label: 'Expires today', expired: true }
  }
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
  if (screen === 'today') {
    loadRoutines()
    loadStepHistory()
    loadSkinLogs()
    loadMonthlyReport()
    loadPendingRecommendations()
    loadCareTeam()
  }

  if (screen === 'notifications') {
    loadPendingRecommendations()
    loadCareTeam()
  }

  if (screen === 'recommendationHistory') {
    loadRecommendationHistory()
  }

  if (screen === 'findProfessional') {
    loadVerifiedPractitioners()
  }

  if (screen === 'skinTrends') {
    loadSkinLogs()
    setReportMonthOffset(0)
    loadMonthlyReport(0)
  }

  if (screen === 'progress') {
    setProgressMonthOffset(0)
  }

  if (screen === 'progressPhotos') {
    loadProgressPhotos()
    loadSkinLogs()
  }

  if (screen === 'admin') {
    loadAdminUsers()
    loadPendingPractitioners()
  }

  if (screen === 'careTeam') {
    loadCareTeam()
  }

  if (screen === 'settings' || screen === 'applyPractitioner') {
    loadPractitionerStatus()
    loadPendingRecommendations()
    loadCareTeam()
  }

  if (screen === 'practitionerDashboard') {
    loadPractitionerClients()
    loadPractitionerRecommendations()
    loadPendingInvitations()
  }

  if (screen === 'practitionerRoutines') {
    loadPractitionerRecommendations()
  }

}, [screen])

// Live brand search against Open Beauty Facts, debounced so it doesn't
// fire on every keystroke. Merged with the local BRANDS list in the UI.
useEffect(() => {
  if (!PRODUCT_SUGGESTIONS_ENABLED || screen !== 'addProduct' || !productBrand.trim()) {
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
  if (!PRODUCT_SUGGESTIONS_ENABLED || screen !== 'addProduct' || !productBrand.trim()) {
    setLiveProductMatches([])
    return
  }

  const localMatches = searchNigerianProducts(productBrand, productName)
  setLiveProductMatches(localMatches)

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
      })
      .catch(() => {
        setLiveProductMatches(localMatches)
      })
  }, 400)

  return () => clearTimeout(timer)
}, [screen, productBrand, productName])

// Functional update — tapping two different chips in quick succession used
// to read `current` from the render that was active when each click fired,
// so the second tap could silently overwrite the first's update instead of
// building on it. Same stale-closure class as the earlier toggleStepCompletion
// fix.
const toggleOption = (value, setter) => {
  setter((current) =>
    current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
  )
}

// Loads just the fields planNight needs to enforce clinical restrictions.
// skin_profiles can have more than one row per user (onboarding inserts
// rather than updates), so this takes the most recent one instead of
// .single(), which throws the moment a user has a duplicate.
const loadRestrictions = async (userId) => {
  const { data } = await supabase
    .from('skin_profiles')
    .select('pregnant_or_breastfeeding')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  setRestrictions({ pregnancy: data?.pregnant_or_breastfeeding === true })
}

const loadSkinProfile = async () => {
  if (!user) return

  const { data, error } = await supabase
    .from('skin_profiles')
    .select('gender, skin_type, concerns, goals, sensitivity, pregnant_or_breastfeeding')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error(error)
    return
  }

  if (data) {
    setGender(data.gender || '')
    setPregnantOrBreastfeeding(data.pregnant_or_breastfeeding ?? null)
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

const loadAdminUsers = async () => {
  setAdminLoading(true)
  setAdminError(null)

  const { data, error } = await supabase.rpc('admin_list_users')

  if (error) {
    console.error('ADMIN LIST USERS ERROR:', error)
    // "Not authorized" only ever means someone other than the admin
    // account reached this screen — show nothing rather than a raw
    // Postgres error hinting an authorization check exists at all.
    setAdminError(error.message === 'Not authorized' ? null : error.message)
    setAdminLoading(false)
    return
  }

  setAdminUsers(data || [])
  setAdminLoading(false)
}

const loadPendingPractitioners = async () => {
  setPendingPractitionersLoading(true)

  const { data, error } = await supabase.rpc('admin_list_pending_practitioners')

  if (error) {
    console.error('ADMIN LIST PENDING PRACTITIONERS ERROR:', error)
    setPendingPractitionersLoading(false)
    return
  }

  setPendingPractitioners(data || [])
  setPendingPractitionersLoading(false)
}

// Moved here (out of the render IIFE below) because the screen-trigger
// effect calls it directly — a function only defined inside that IIFE is
// invisible to code outside it, even though both run in the same component.
// That mismatch was the root cause of "loadCareTeam is not defined" (and
// the same bug for every other loader below) the first time this screen's
// effect actually fired in a fresh, non-hot-reloaded session.
const loadCareTeam = async () => {
  if (!user) return
  setCareTeamLoading(true)

  const [{ data: relationships, error: relError }, { data: log, error: logError }, { data: ended, error: endedError }] = await Promise.all([
    supabase
      .from('care_relationships')
      .select('id, status, scopes, invited_at, accepted_at, practitioners (display_name, title, bio, whatsapp)')
      .eq('client_id', user.id)
      .in('status', ['invited', 'active'])
      .order('invited_at', { ascending: false }),
    supabase
      .from('practitioner_access_log')
      .select('what, at, practitioners:practitioner_id (display_name)')
      .eq('client_id', user.id)
      .order('at', { ascending: false })
      .limit(20),
    // Quiet, not pushed — a client whose practitioner ended things sees it
    // here if they look, not as a notification landing with no context.
    // Self-initiated revokes are excluded (revoked_by = client's own id) —
    // they already know, nothing to tell them.
    supabase
      .from('care_relationships')
      .select('id, revoked_at, practitioners (display_name)')
      .eq('client_id', user.id)
      .eq('status', 'revoked')
      .neq('revoked_by', user.id)
      .order('revoked_at', { ascending: false })
      .limit(5),
  ])

  if (relError) console.error('CARE RELATIONSHIPS ERROR:', relError)
  if (logError) console.error('CARE ACCESS LOG ERROR:', logError)
  if (endedError) console.error('ENDED RELATIONSHIPS ERROR:', endedError)

  // A failed load otherwise renders identically to "nobody's connected
  // yet" — and this feeds the pending-invite badge/banner elsewhere, so a
  // silent failure here can hide a real pending invite with no indication
  // anything went wrong.
  if (relError) {
    notify("Couldn't load your care team. Try again in a moment.")
  }

  setCareRelationships(relationships || [])
  setCareAccessLog(log || [])
  setEndedRelationships(ended || [])
  setCareTeamLoading(false)
}

const loadPendingRecommendations = async () => {
  if (!user) return
  setPendingRecommendationsLoading(true)

  const { data, error } = await supabase
    .from('recommendations')
    .select(`
      id, note, created_at, proposes_skin_profile,
      gender, pregnant_or_breastfeeding, skin_type, concerns, goals, sensitivity,
      practitioners:practitioner_id (display_name, title, bio, whatsapp),
      recommendation_items (id, slot, frequency, days_of_week, reason, products (brand, name, category))
    `)
    .eq('client_id', user.id)
    .eq('status', 'proposed')
    .order('created_at', { ascending: false })

  setPendingRecommendationsLoading(false)

  if (error) {
    console.error('PENDING RECOMMENDATIONS ERROR:', error)
    notify("Couldn't check for new recommendations. Try again in a moment.")
    return
  }

  setPendingRecommendations(data || [])
}

// Everything that's been resolved — accepted, declined or withdrawn — so a
// client has some record of what a practitioner has proposed for them over
// time, instead of it disappearing the moment it's acted on. Lighter
// select than the pending one (no items/skin-profile detail) since this is
// a glance-back list, not something to act on.
const loadRecommendationHistory = async () => {
  if (!user) return
  setRecommendationHistoryLoading(true)

  const { data, error } = await supabase
    .from('recommendations')
    .select('id, note, status, created_at, responded_at, practitioners:practitioner_id (display_name, title)')
    .eq('client_id', user.id)
    .neq('status', 'proposed')
    .order('responded_at', { ascending: false })

  setRecommendationHistoryLoading(false)

  if (error) {
    console.error('RECOMMENDATION HISTORY ERROR:', error)
    notify("Couldn't load your recommendation history. Try again in a moment.")
    return
  }

  setRecommendationHistory(data || [])
}

const loadVerifiedPractitioners = async () => {
  setVerifiedPractitionersLoading(true)

  const { data, error } = await supabase
    .from('practitioners')
    .select('user_id, display_name, title, bio, specialisms, instagram, whatsapp')
    .not('verified_at', 'is', null)
    .order('display_name')

  setVerifiedPractitionersLoading(false)

  if (error) {
    console.error('VERIFIED PRACTITIONERS ERROR:', error)
    notify("Couldn't load professionals. Try again in a moment.")
    return
  }

  setVerifiedPractitioners(data || [])
}

const loadPractitionerStatus = async () => {
  if (!user) return

  const { data, error } = await supabase
    .from('practitioners')
    .select('verified_at, display_name, title, bio, specialisms, instagram, whatsapp')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    console.error('PRACTITIONER STATUS ERROR:', error)
    return
  }

  if (!data) {
    setPractitionerStatus(null)
    return
  }

  setPractitionerStatus(data.verified_at ? 'verified' : 'pending')
  setApplyDisplayName(data.display_name || '')
  setApplyTitle(data.title || '')
  setApplyBio(data.bio || '')
  setApplySpecialisms((data.specialisms || []).join(', '))
  setApplyInstagram(data.instagram || '')
  setApplyWhatsapp(data.whatsapp || '')
}

const loadPractitionerClients = async () => {
  setPractitionerClientsLoading(true)

  const { data, error } = await supabase.rpc('practitioner_list_clients')

  setPractitionerClientsLoading(false)

  if (error) {
    console.error('PRACTITIONER CLIENTS ERROR:', error)
    return
  }

  setPractitionerClients(data || [])
}

// Only columns from the original Phase 0 foundation — the newer
// proposed-skin-profile columns aren't selected here since this list is
// just the history overview, not the detail; keeps this screen usable even
// before the skin-profile migration lands.
const loadPractitionerRecommendations = async () => {
  setPractitionerRecommendationsLoading(true)

  const { data, error } = await supabase
    .from('recommendations')
    .select('id, status, note, created_at, responded_at, profiles:client_id (username)')
    .eq('practitioner_id', user.id)
    .order('created_at', { ascending: false })

  setPractitionerRecommendationsLoading(false)

  if (error) {
    console.error('PRACTITIONER RECOMMENDATIONS ERROR:', error)
    return
  }

  setPractitionerRecommendations(data || [])
}

const reviewPractitioner = async (targetId, approve) => {
  if (!approve) {
    const confirmed = await confirmAction(
      "Reject this application? They'll need to apply again if they want to reconsider."
    )
    if (!confirmed) return
  }

  const { error } = await supabase.rpc('admin_review_practitioner', {
    target_id: targetId,
    approve,
  })

  if (error) {
    console.error('ADMIN REVIEW PRACTITIONER ERROR:', error)
    notify(error.message)
    return
  }

  notify(approve ? 'Approved.' : 'Rejected.', 'success')
  setPendingPractitioners((current) => current.filter((p) => p.user_id !== targetId))
}

const exportAdminUsersCsv = (users) => {
  const headers = ['Email', 'Username', 'Onboarded', 'Signed up', 'Last active', 'Email confirmed', 'Suspended']

  const escapeCsv = (value) => {
    const str = String(value ?? '')
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
  }

  const rows = users.map((u) => [
    u.email,
    u.username || '',
    u.onboarding_completed ? 'Yes' : 'No',
    u.created_at,
    u.last_sign_in_at || '',
    u.email_confirmed_at ? 'Yes' : 'No',
    isSuspended(u) ? 'Yes' : 'No',
  ])

  const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = `tracka-signups-${localDateString()}.csv`
  link.click()

  URL.revokeObjectURL(url)
}

const isSuspended = (targetUser) =>
  Boolean(targetUser.banned_until) && new Date(targetUser.banned_until) > new Date()

const toggleSuspendUser = async (targetUser) => {
  const suspended = isSuspended(targetUser)

  const confirmed = await confirmAction(
    suspended
      ? `Unsuspend ${targetUser.email}? They'll be able to log in again.`
      : `Suspend ${targetUser.email}? They won't be able to log in until unsuspended.`
  )
  if (!confirmed) return

  const { error } = await supabase.rpc('admin_suspend_user', {
    target_id: targetUser.id,
    suspend: !suspended,
  })

  if (error) {
    notify('Could not update this account: ' + error.message)
    return
  }

  notify(suspended ? 'Account unsuspended.' : 'Account suspended.', 'success')
  loadAdminUsers()
}

const deleteUserAccount = async (targetUser) => {
  const confirmed = await confirmAction(
    `Permanently delete ${targetUser.email}? This deletes their account and all their data. This cannot be undone.`
  )
  if (!confirmed) return

  const { error } = await supabase.rpc('admin_delete_user', { target_id: targetUser.id })

  if (error) {
    notify('Could not delete this account: ' + error.message)
    return
  }

  notify('Account deleted.', 'success')
  loadAdminUsers()
}

// Wrapped in an IIFE so the toast/confirm overlay below can render once,
// on top of whichever screen this resolves to, instead of being pasted
// into every one of the ~20 screen branches individually.
const screenContent = (() => {

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
          onClick={() => window.history.back()}
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
            disabled={busyAction === 'signup'}
            onClick={() =>
              runBusy('signup', async () => {
                const email = loginEmail
                const password = loginPassword

                if (!username || !email || !password) {
                  notify('Please enter your email, password and name.')
                  return
                }

                const { data, error } = await supabase.auth.signUp({
                  email,
                  password,
                  options: {
                    data: {
                      username,
                    },
                    emailRedirectTo: `${SITE_URL}/?confirmed=true`,
                  },
                })

                if (error) {
                  notify(error.message)
                  return
                }

                if (!data.user) {
                  notify('Account could not be created.')
                  return
                }

                setProducts([])
                setUser(data.user)
                setDisplayName(username)
                setOnboardingCompleted(false)

                if (data.user.email === ADMIN_EMAIL) {
                  setScreen('admin')
                  return
                }

                if (data.session) {
                  setScreen('skinProfile')
                  return
                }

                setScreen('checkEmail')
              })
            }
            className={`mt-2 w-full rounded-2xl py-[18px] text-base font-bold ${t.btn} disabled:opacity-60`}
          >
            {busyAction === 'signup' ? 'Creating account…' : 'Create account'}
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
  if (!user) return

  const { data, error } = await supabase
    .from('reminder_settings')
    .select(
      'morning_enabled, morning_time, night_enabled, night_time, spf_reapply_enabled, diary_nudge_enabled'
    )
    .eq('user_id', user.id)
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
    setSpfReapplyEnabled(data.spf_reapply_enabled ?? false)
    setDiaryNudgeEnabled(data.diary_nudge_enabled ?? false)
  }
}

const saveReminderSettings = async () => {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession()

  if (sessionError) {
    notify("Couldn't reach the server. Check your connection and try again.")
    return
  }

  if (!session?.user) {
    notify('Your session ended. Please log in again.')
    setScreen('login')
    return
  }

  const { error } = await supabase
    .from('reminder_settings')
    .upsert(
      {
        user_id: session.user.id,
        morning_enabled: morningReminderEnabled,
        morning_time: morningReminderTime,
        night_enabled: nightReminderEnabled,
        night_time: nightReminderTime,
        spf_reapply_enabled: spfReapplyEnabled,
        diary_nudge_enabled: diaryNudgeEnabled,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'user_id',
      }
    )

  if (error) {
    console.error('SAVE REMINDER SETTINGS ERROR:', error)
    notify('Could not save your reminder settings.')
    return
  }

  notify('Reminder settings saved.', 'success')
}

const CARE_SCOPES = [
  ['skin_profile', 'Skin profile'],
  // Split out from skin_profile on purpose — it's the most sensitive field
  // on file, and a client granting "skin profile" almost certainly isn't
  // picturing this specifically included. Off by default on every invite;
  // only ever shared if a client turns it on here themselves.
  ['pregnancy_status', 'Pregnancy/breastfeeding status'],
  ['routine', 'Routine & products'],
  ['daily_logs', 'Daily completions'],
  // "photos" is a recognized scope in the schema but not yet granted by
  // any RLS policy — leaving it out of the picker rather than show a
  // toggle that would silently do nothing.
]

const respondToCareInvite = async (relationshipId, accept) => {
  const { error } = accept
    ? await supabase.rpc('accept_care_relationship', { p_relationship_id: relationshipId })
    : await supabase.rpc('revoke_care_access', { p_relationship_id: relationshipId })

  if (error) {
    console.error('CARE INVITE RESPONSE ERROR:', error)
    notify('Could not update that. Try again.')
    return
  }

  notify(accept ? 'Invitation accepted.' : 'Invitation declined.', 'success')
  await loadCareTeam()
}

const revokeCareAccess = async (relationshipId, practitionerName) => {
  const confirmed = await confirmAction(
    `Stop sharing with ${practitionerName || 'this practitioner'}? They'll no longer be able to see anything you've shared.`
  )
  if (!confirmed) return

  const { error } = await supabase.rpc('revoke_care_access', { p_relationship_id: relationshipId })

  if (error) {
    console.error('REVOKE CARE ACCESS ERROR:', error)
    notify('Could not revoke access. Try again.')
    return
  }

  notify('Access revoked.', 'success')
  await loadCareTeam()
}

const respondToRecommendation = async (recommendationId, accept) => {
  if (accept) {
    const { error } = await supabase.rpc('accept_recommendation', {
      p_recommendation_id: recommendationId,
    })

    if (error) {
      console.error('ACCEPT RECOMMENDATION ERROR:', error)
      notify(error.message)
      return
    }

    notify('Routine saved!', 'success')
    await loadPendingRecommendations()
    setScreen('today')
    return
  }

  const confirmed = await confirmAction('Decline this recommendation?')
  if (!confirmed) return

  const { error } = await supabase
    .from('recommendations')
    .update({ status: 'declined', responded_at: new Date().toISOString() })
    .eq('id', recommendationId)

  if (error) {
    console.error('DECLINE RECOMMENDATION ERROR:', error)
    notify('Could not decline that. Try again.')
    return
  }

  notify('Recommendation declined.', 'success')
  await loadPendingRecommendations()
}

const toggleCareScope = async (relationship, scope) => {
  // pregnancy_status only means anything alongside skin_profile — the RPC
  // that serves it requires skin_profile just for the row to exist at all.
  // Turning skin_profile off takes pregnancy_status with it, so scopes
  // never end up in a state where one is granted without the other making
  // it reachable; the toggle below additionally disables pregnancy_status
  // outright until skin_profile is on, so this mostly guards against a
  // stale click landing after the UI should've already blocked it.
  let nextScopes = relationship.scopes.includes(scope)
    ? relationship.scopes.filter((s) => s !== scope)
    : [...relationship.scopes, scope]

  if (scope === 'skin_profile' && !nextScopes.includes('skin_profile')) {
    nextScopes = nextScopes.filter((s) => s !== 'pregnancy_status')
  }

  if (scope === 'pregnancy_status' && !relationship.scopes.includes('skin_profile')) {
    notify('Turn on skin profile access first — pregnancy status is shared alongside it.')
    return
  }

  // Optimistic — this is a low-stakes toggle and the whole point is that
  // it should feel instant.
  setCareRelationships((current) =>
    current.map((r) => (r.id === relationship.id ? { ...r, scopes: nextScopes } : r))
  )

  const { error } = await supabase.rpc('update_care_relationship_scopes', {
    p_relationship_id: relationship.id,
    p_scopes: nextScopes,
  })

  if (error) {
    console.error('UPDATE CARE SCOPES ERROR:', error)
    notify("That didn't save. Try again.")
    setCareRelationships((current) =>
      current.map((r) => (r.id === relationship.id ? { ...r, scopes: relationship.scopes } : r))
    )
  }
}

// Whether the logged-in user already has a practitioner application —
// and if so, whether it's been approved yet. verified_at only ever gets
// set by admin_review_practitioner, never by the applicant themselves.
const submitPractitionerApplication = async () => {
  if (!applyDisplayName.trim()) {
    notify('Please enter a display name.')
    return
  }

  if (!user) {
    notify('Please log in again.')
    return
  }

  setApplySaving(true)

  const { error } = await supabase.from('practitioners').upsert(
    {
      user_id: user.id,
      display_name: applyDisplayName.trim(),
      title: applyTitle.trim() || null,
      bio: applyBio.trim() || null,
      specialisms: applySpecialisms
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      instagram: applyInstagram.trim() || null,
      whatsapp: applyWhatsapp.trim() || null,
    },
    { onConflict: 'user_id' }
  )

  setApplySaving(false)

  if (error) {
    console.error('PRACTITIONER APPLY ERROR:', error)
    notify(error.message)
    return
  }

  notify("Application sent — we'll review it and let you know.", 'success')
  setPractitionerStatus('pending')
}

// practitioner_get_client_profile logs the access (the client sees "your
// professional viewed your profile on..."); the routine/product reads below
// go straight through the has_client_access RLS policies and aren't logged
// separately — same distinction the foundation migration draws between the
// one RPC that matters for the access log and a plain list that doesn't.
const openClientDetail = async (clientId) => {
  setSelectedClientId(clientId)
  setScreen('practitionerClientDetail')
  setClientDetailLoading(true)
  setClientDetail(null)
  setClientRoutineSteps({ am: [], pm: [] })
  setClientProducts([])

  const [{ data: profileRows, error: profileError }, { data: routines, error: routinesError }, { data: userProducts, error: productsError }] =
    await Promise.all([
      supabase.rpc('practitioner_get_client_profile', { p_client: clientId }),
      supabase
        .from('routines')
        .select('id, time_of_day, routine_steps (step_order, step_name, frequency, days_of_week)')
        .eq('user_id', clientId)
        .eq('is_active', true),
      supabase
        .from('user_products')
        .select('id, opened_date, pao_months, expiry_date, products (id, brand, name, category, ingredients)')
        .eq('user_id', clientId)
        .eq('is_active', true),
    ])

  setClientDetailLoading(false)

  if (profileError) console.error('CLIENT PROFILE ERROR:', profileError)
  if (routinesError) console.error('CLIENT ROUTINES ERROR:', routinesError)
  if (productsError) console.error('CLIENT PRODUCTS ERROR:', productsError)

  // Without this, a failed load renders identically to a client who
  // genuinely has nothing set up — every section here already has its own
  // "nothing yet" empty state, so a silent failure is indistinguishable
  // from an empty client until someone double-checks with the client
  // directly.
  if (profileError || routinesError || productsError) {
    notify("Couldn't load everything for this client. Try again in a moment.")
  }

  setClientDetail(profileRows?.[0] || null)
  setClientProducts(userProducts || [])

  const am = (routines || []).find((r) => r.time_of_day === 'AM')?.routine_steps || []
  const pm = (routines || []).find((r) => r.time_of_day === 'PM')?.routine_steps || []
  setClientRoutineSteps({
    am: [...am].sort((a, b) => a.step_order - b.step_order),
    pm: [...pm].sort((a, b) => a.step_order - b.step_order),
  })
}

const inviteClientByEmail = async () => {
  const email = addClientEmail.trim()

  if (!email) {
    notify('Please enter an email address.')
    return
  }

  setAddClientSaving(true)

  const { data, error } = await supabase.rpc('practitioner_invite_by_email', {
    p_email: email,
    p_scopes: ['skin_profile', 'routine', 'daily_logs'],
  })

  setAddClientSaving(false)

  if (error) {
    notify(error.message)
    return
  }

  if (data?.kind === 'relationship') {
    notify("Invite sent — they'll see it in their Care team once they accept.", 'success')
    setAddClientEmail('')
    loadPractitionerClients()
    setScreen('practitionerDashboard')
    return
  }

  // Not an existing account yet — hand back a shareable link instead of
  // silently failing, same as the PDF's "client receives a link" step.
  setAddClientResult({ token: data.token, link: `${SITE_URL}/?invite=${data.token}` })
}

// For when the practitioner doesn't know (or can't be sure of) the
// client's registered email — accept_invitation() never checks the email
// against whoever redeems it anyway, so the link never needed one. The
// label is just the practitioner's own memory aid, not used for anything
// else.
const createInviteLink = async () => {
  setAddLinkSaving(true)

  const { data: token, error } = await supabase.rpc('practitioner_create_invite_link', {
    p_label: addLinkLabel,
    p_scopes: ['skin_profile', 'routine', 'daily_logs'],
  })

  setAddLinkSaving(false)

  if (error) {
    notify(error.message)
    return
  }

  setAddLinkLabel('')
  setAddClientResult({ token, link: `${SITE_URL}/?invite=${token}` })
}

const loadPendingInvitations = async () => {
  if (!user) return
  setPendingInvitationsLoading(true)

  const { data, error } = await supabase
    .from('invitations')
    .select('token, invited_email, label, created_at, expires_at')
    .eq('practitioner_id', user.id)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })

  setPendingInvitationsLoading(false)

  if (error) {
    console.error('PENDING INVITATIONS ERROR:', error)
    notify("Couldn't load pending invites. Try again in a moment.")
    return
  }

  setPendingInvitations(data || [])
}

const cancelInvitation = async (token) => {
  const confirmed = await confirmAction('Cancel this invite link? It will stop working.')
  if (!confirmed) return

  const { error } = await supabase.from('invitations').delete().eq('token', token)

  if (error) {
    console.error('CANCEL INVITATION ERROR:', error)
    notify('Could not cancel that invite. Try again.')
    return
  }

  notify('Invite cancelled.', 'success')
  setPendingInvitations((current) => current.filter((inv) => inv.token !== token))
}

// Same tiered share pattern as inviteFriend — native share sheet first
// (which surfaces WhatsApp directly, matching the "no chat, share a link"
// v1 decision), clipboard as the fallback.
const shareClientInviteLink = async (link) => {
  const shareData = {
    title: 'Tracka+',
    text: "I'd like to set up your skincare routine on Tracka+ — tap to get started:",
    url: link,
  }

  if (navigator.share) {
    try {
      await navigator.share(shareData)
    } catch (err) {
      if (err?.name !== 'AbortError') console.error('CLIENT INVITE SHARE ERROR:', err)
    }
    return
  }

  if (navigator.clipboard) {
    await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`)
    notify('Invite link copied — paste it anywhere.', 'success')
  } else {
    notify(shareData.url, 'success')
  }
}

// Opens WhatsApp with a pre-filled message to a practitioner's stored
// number — the client->practitioner half of "no chat, WhatsApp instead".
// There's no client phone number on file (never collected), so the
// reverse direction isn't built yet.
const whatsappLink = (rawNumber, message) => {
  const digits = (rawNumber || '').replace(/[^0-9]/g, '')
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}

// The practitioner-side mirror of the client's own revokeCareAccess —
// same RPC, now usable from either side since a practitioner who finds
// the wrong person claimed their invite link (a real risk with
// label-only, no-email links) needs a way to undo it themselves.
const removeClient = async (relationshipId, clientName) => {
  const confirmed = await confirmAction(
    `Remove ${clientName || 'this client'}? They'll stop appearing in your client list and lose any access you've shared.`
  )
  if (!confirmed) return

  const { error } = await supabase.rpc('revoke_care_access', { p_relationship_id: relationshipId })

  if (error) {
    console.error('REMOVE CLIENT ERROR:', error)
    notify('Could not remove this client. Try again.')
    return
  }

  notify('Client removed.', 'success')
  await loadPractitionerClients()
  setScreen('practitionerDashboard')
}

const openComposer = () => {
  setComposeIncludeSkinProfile(false)
  setComposeGender('')
  setComposePregnant(undefined)
  setComposeSkinType('')
  setComposeConcerns([])
  setComposeGoals([])
  setComposeSensitivity('')
  setComposeItems([])
  setComposeItemBrand('')
  setComposeItemName('')
  setComposeItemCategory('')
  setComposeItemSlot('AM')
  setComposeItemDays([0, 1, 2, 3, 4, 5, 6])
  setComposeItemReason('')
  setComposeNote('')
  setScreen('composeRecommendation')
}

const addComposeItem = () => {
  if (!composeItemBrand.trim() || !composeItemName.trim() || !composeItemCategory) {
    notify('Please fill in brand, product name and category.')
    return
  }

  if (composeItemDays.length === 0) {
    notify('Please choose at least one day.')
    return
  }

  setComposeItems((current) => [
    ...current,
    {
      tempId: `${Date.now()}-${current.length}`,
      brand: composeItemBrand.trim(),
      name: composeItemName.trim(),
      category: composeItemCategory,
      slot: composeItemSlot,
      days_of_week: composeItemDays,
      reason: composeItemReason.trim() || null,
    },
  ])

  setComposeItemBrand('')
  setComposeItemName('')
  setComposeItemCategory('')
  setComposeItemSlot('AM')
  setComposeItemDays([0, 1, 2, 3, 4, 5, 6])
  setComposeItemReason('')
}

const removeComposeItem = (tempId) => {
  setComposeItems((current) => current.filter((item) => item.tempId !== tempId))
}

const submitRecommendation = async () => {
  if (!selectedClientId) return

  if (!composeIncludeSkinProfile && composeItems.length === 0) {
    notify('Add at least one product, or include a skin profile.')
    return
  }

  // A final checkpoint before this reaches the client — mirrors the PDF's
  // own "Review Routine" step (client, skin profile, products, routine,
  // notes, then Share) rather than letting one tap on a long scrolling
  // form send something half-built.
  const clientName = practitionerClients.find((c) => c.client_id === selectedClientId)?.username || 'this client'
  const amCount = composeItems.filter((i) => i.slot === 'AM').length
  const pmCount = composeItems.filter((i) => i.slot === 'PM').length
  const parts = []
  if (composeIncludeSkinProfile) parts.push('a skin profile update')
  if (composeItems.length > 0) {
    parts.push(
      `${composeItems.length} product${composeItems.length === 1 ? '' : 's'}` +
        (amCount > 0 && pmCount > 0 ? ` (${amCount} AM, ${pmCount} PM)` : amCount > 0 ? ' (AM)' : ' (PM)')
    )
  }
  if (composeNote.trim()) parts.push('a note')
  const summary = `Share this with ${clientName}? Includes ${parts.join(', ')}.`

  const confirmed = await confirmAction(summary, ['Keep editing', 'Share Routine'])
  if (!confirmed) return

  setComposeSaving(true)

  const { data: recommendation, error: recError } = await supabase
    .from('recommendations')
    .insert({
      practitioner_id: user.id,
      client_id: selectedClientId,
      note: composeNote.trim() || null,
      proposes_skin_profile: composeIncludeSkinProfile,
      gender: composeIncludeSkinProfile ? composeGender || null : null,
      pregnant_or_breastfeeding: composeIncludeSkinProfile ? composePregnant ?? null : null,
      skin_type: composeIncludeSkinProfile ? composeSkinType || null : null,
      concerns: composeIncludeSkinProfile ? composeConcerns.join(', ') || null : null,
      goals: composeIncludeSkinProfile ? composeGoals.join(', ') || null : null,
      sensitivity: composeIncludeSkinProfile ? composeSensitivity || null : null,
    })
    .select()
    .single()

  if (recError) {
    setComposeSaving(false)
    notify(recError.message)
    return
  }

  // Each item is its own products row — the catalogue isn't deduped
  // per-user, same as the client's own "Add Product" screen — then a
  // recommendation_items row referencing it. Sequential rather than
  // Promise.all so a failure partway through leaves a clear, small list of
  // what still needs retrying instead of a pile of concurrent errors.
  for (let i = 0; i < composeItems.length; i++) {
    const item = composeItems[i]

    const { data: product, error: productError } = await supabase
      .from('products')
      .insert({ brand: item.brand, name: item.name, category: item.category })
      .select()
      .single()

    if (productError) {
      setComposeSaving(false)
      notify(`Couldn't save "${item.name}": ${productError.message}`)
      return
    }

    const { error: itemError } = await supabase.from('recommendation_items').insert({
      recommendation_id: recommendation.id,
      product_id: product.id,
      slot: item.slot,
      frequency: 'daily',
      days_of_week: item.days_of_week,
      reason: item.reason,
      sort_order: i,
    })

    if (itemError) {
      setComposeSaving(false)
      notify(`Couldn't add "${item.name}" to the recommendation: ${itemError.message}`)
      return
    }
  }

  setComposeSaving(false)
  notify('Recommendation sent.', 'success')
  setScreen('practitionerClientDetail')
}

  if (screen === 'skinProfile') {
    return (
      <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
        <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-28 pt-7">

          <button
            onClick={() => window.history.back()}
            className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
            Back
          </button>

          {onboardingCompleted && (
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                ['My progress', 'progress'],
                ['Skin reports', 'skinTrends'],
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
          )}

          {onboardingCompleted && !skinProfileEditing && skinType ? (
            <>
              <div className="mt-5">
                <h1 className="font-display text-[36px] font-light leading-[1.05] tracking-tight">
                  Your skin profile
                </h1>

                <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
                  What Tracka+ knows about your skin right now.
                </p>
              </div>

              <div className={`mt-8 rounded-3xl ${t.surface} p-5`}>
                {[
                  ['Gender', gender || '—'],
                  [
                    'Pregnant or breastfeeding',
                    pregnantOrBreastfeeding === true
                      ? 'Yes'
                      : pregnantOrBreastfeeding === false
                        ? 'No'
                        : pregnantOrBreastfeeding === null
                          ? 'Rather not say'
                          : '—',
                  ],
                  ['Skin type', skinType || '—'],
                  ['Main concerns', concerns.length > 0 ? concerns.join(', ') : '—'],
                  ['Goals', goals.length > 0 ? goals.join(', ') : '—'],
                  ['Sensitivity', sensitivity || '—'],
                ].map(([label, value], index, arr) => (
                  <div
                    key={label}
                    className={`py-3.5 ${index < arr.length - 1 ? `border-b ${t.hair}` : ''}`}
                  >
                    <p className={`text-[12px] font-semibold uppercase tracking-wide ${t.faint}`}>
                      {label}
                    </p>
                    <p className="mt-1 text-[15px] font-medium">
                      {value}
                    </p>
                  </div>
                ))}
              </div>

              <button
                onClick={() => setSkinProfileEditing(true)}
                className={`mt-6 w-full rounded-2xl py-[18px] text-base font-bold ${t.btn}`}
              >
                Update
              </button>
            </>
          ) : (
            <>
          <div className="mt-5">
            {!onboardingCompleted && (
              <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
                Step 1 of 3
              </p>
            )}

            <h1 className="mt-2 font-display text-[36px] font-light leading-[1.05] tracking-tight">
              {onboardingCompleted ? 'Update your skin profile' : 'Tell us about your skin'}
            </h1>

            <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
              {onboardingCompleted
                ? "Skin changes — update this any time it does."
                : 'This helps Tracka+ organize your skincare journey around you.'}
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
              <h2 className="mb-1 text-lg font-semibold">
                Are you pregnant or breastfeeding?
              </h2>

              <p className={`mb-4 text-sm leading-relaxed ${t.muted}`}>
                Some ingredients are usually avoided during pregnancy. We'll leave those
                out of your routine. You can change this any time.
              </p>

              <div className="flex gap-3">
                {[
                  ['Yes', true],
                  ['No', false],
                  ['Rather not say', null],
                ].map(([label, value]) => (
                  <button
                    key={label}
                    onClick={() => setPregnantOrBreastfeeding(value)}
                    className={`flex-1 rounded-2xl border px-4 py-3.5 text-[15px] font-medium ${
                      pregnantOrBreastfeeding === value ? `${t.chip} border-transparent` : `${t.surface} ${t.hair}`
                    }`}
                  >
                    {label}
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
                  'None',
                ].map((concern) => (
                  <button
                    key={concern}
                    onClick={() => {
                      // "None" is an exclusive choice, not just another
                      // item in the list — picking it clears everything
                      // else, and picking anything else clears "None".
                      // Functional update throughout, same reasoning as
                      // toggleOption above.
                      setConcerns((current) => {
                        if (concern === 'None') {
                          return current.includes('None') ? [] : ['None']
                        }
                        const withoutNone = current.filter((c) => c !== 'None')
                        return withoutNone.includes(concern)
                          ? withoutNone.filter((c) => c !== concern)
                          : [...withoutNone, concern]
                      })
                    }}
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
                      toggleOption(goal, setGoals)
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
              disabled={busyAction === 'saveSkinProfile'}
              onClick={() =>
                runBusy('saveSkinProfile', async () => {
                  // getSession() reads the persisted session (no network
                  // round trip in the normal case) instead of getUser(),
                  // which validates the token against the auth server every
                  // time — a signed-in person on a slow connection used to
                  // get bounced with "Please create an account first," which
                  // was exactly backwards from what actually happened.
                  const { data: { session }, error: sessionError } = await supabase.auth.getSession()

                  if (sessionError) {
                    notify("Couldn't reach the server. Check your connection and try again.")
                    return
                  }

                  if (!session?.user) {
                    notify('Your session ended. Please log in again.')
                    setScreen('login')
                    return
                  }

                  const { error } = await supabase
                    .from('skin_profiles')
                    .upsert(
                      {
                        user_id: session.user.id,
                        gender: gender,
                        pregnant_or_breastfeeding: pregnantOrBreastfeeding ?? null,
                        skin_type: skinType,
                        concerns: concerns.join(', '),
                        goals: goals.join(', '),
                        sensitivity: sensitivity,
                      },
                      { onConflict: 'user_id' }
                    )

                  if (error) {
                    notify(error.message)
                    return
                  }

                  if (onboardingCompleted) {
                    notify('Skin profile updated!', 'success')
                    setSkinProfileEditing(false)
                  } else {
                    notify('Skin profile saved!', 'success')
                    setScreen('products')
                  }
                })
              }
              className={`w-full rounded-2xl py-[18px] text-base font-bold ${t.btn} disabled:opacity-60`}
            >
              {busyAction === 'saveSkinProfile' ? 'Saving…' : onboardingCompleted ? 'Save changes' : 'Continue'}
            </button>

            {onboardingCompleted && (
              <button
                onClick={async () => {
                  await loadSkinProfile()
                  setSkinProfileEditing(false)
                }}
                className={`w-full rounded-2xl border px-5 py-3.5 text-[15px] font-semibold ${t.hair} ${t.muted}`}
              >
                Cancel
              </button>
            )}

          </div>
            </>
          )}
        </div>

        {onboardingCompleted && renderBottomTabs('skinProfile', t)}
      </main>
    )
  }

  if (screen === 'products') {
    return (
      <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
        <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-28 pt-7">

          <button
            onClick={() => window.history.back()}
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
                        disabled={busyAction === `removeProduct-${item.id}`}
                        onClick={() =>
                          runBusy(`removeProduct-${item.id}`, async () => {
                            const confirmed = await confirmAction(
                              `Remove ${item.products.name} from your products?`
                            )

                            if (!confirmed) return

                            const { error } = await supabase
                              .from('user_products')
                              .update({ is_active: false })
                              .eq('id', item.id)

                            if (error) {
                              notify(error.message)
                              return
                            }

                            setProducts((current) =>
                              current.filter(
                                (product) => product.id !== item.id
                              )
                            )
                          })
                        }
                        aria-label={`Remove ${item.products.name}`}
                        className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-base leading-none ${t.faint} disabled:opacity-40`}
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

                      {item.opened_date && (
                        <p className={`mt-2 flex items-center gap-1 text-[11px] ${t.faint}`}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                            stroke="currentColor" strokeWidth="2"
                            strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                            <rect x="3" y="4" width="18" height="18" rx="2" />
                            <path d="M16 2v4M8 2v4M3 10h18" />
                          </svg>
                          Opened {new Date(item.opened_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      )}

                      {item.pao_months && (
                        <p className={`mt-0.5 text-[11px] ${t.faint}`}>
                          PAO {item.pao_months} {item.pao_months === 1 ? 'month' : 'months'}
                        </p>
                      )}

                      {item.expiry_date && (
                        <p className={`mt-0.5 flex items-center gap-1 text-[11px] ${t.faint}`}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                            stroke="currentColor" strokeWidth="2"
                            strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                            <rect x="3" y="4" width="18" height="18" rx="2" />
                            <path d="M16 2v4M8 2v4M3 10h18" />
                          </svg>
                          Expires {new Date(item.expiry_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      )}

                      {status && status.firm && (
                        <p className={`mt-2 rounded-lg border border-rose-400/30 bg-rose-400/10 px-2 py-1.5 text-[11px] font-semibold leading-snug ${t.danger}`}>
                          {status.label}
                        </p>
                      )}

                      {status && !status.firm && (
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
              className={`mt-6 w-full rounded-2xl border py-[18px] text-base font-bold ${t.hair} ${t.muted}`}
            >
              + Add a product
            </button>

            <button
              onClick={() => {
                showLocalNotification('New product alert 👀', 'Remember: introduce slowly.')
                setScreen('routinePlanner')
              }}
              className={`mt-3 w-full rounded-2xl py-[18px] text-base font-bold ${t.btn}`}
            >
              Build my routine
            </button>

            <div className="mt-3 flex gap-3">
              <button
                onClick={() => setScreen('today')}
                className={`flex-1 rounded-2xl border px-5 py-3.5 text-[15px] font-semibold ${t.hair} ${t.muted}`}
              >
                Back to today
              </button>

              <button
                onClick={() => setScreen('ingredientChecker')}
                className={`flex-1 rounded-2xl border px-5 py-3.5 text-[15px] font-semibold ${t.hair} ${t.muted}`}
              >
                Ingredient checker
              </button>
            </div>

          </div>
        </div>

        {onboardingCompleted && renderBottomTabs('products', t)}
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

              {PRODUCT_SUGGESTIONS_ENABLED && brandSuggestionsOpen && productBrand.trim() && (() => {
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

                if (matches.length === 0) {
                  return (
                    <div className={`absolute z-10 mt-1 w-full rounded-2xl border ${t.hair} ${t.surface} px-4 py-3 shadow-lg`}>
                      <p className={`text-[13px] ${t.muted}`}>
                        Can't find "{productBrand.trim()}"? Save it as a new brand.
                      </p>
                    </div>
                  )
                }

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
                Type the brand name.
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

              {PRODUCT_SUGGESTIONS_ENABLED && productSuggestionsOpen && productBrand.trim() && liveProductMatches.length > 0 && (
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

              {PRODUCT_SUGGESTIONS_ENABLED && productSuggestionsOpen && productBrand.trim() && productName.trim() && liveProductMatches.length === 0 && (
                <div className={`absolute z-10 mt-1 w-full rounded-2xl border ${t.hair} ${t.surface} px-4 py-3 shadow-lg`}>
                  <p className={`text-[13px] ${t.muted}`}>
                    Can't find "{productName.trim()}"? Save it as a new product.
                  </p>
                </div>
              )}

              <p className={`mt-1.5 text-[12px] ${t.faint}`}>
                Type the product name.
              </p>
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
                min={addMonths(localDateString(), -120)}
                max={localDateString()}
                className={`w-full rounded-2xl ${t.surface} border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
              />
            </div>

            <div>
              <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
                Expiry date
              </label>

              <input
                type="date"
                value={productExpiryDate}
                onChange={(e) => setProductExpiryDate(e.target.value)}
                min={localDateString()}
                className={`w-full rounded-2xl ${t.surface} border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
              />

              <p className={`mt-1.5 text-[12px] ${t.faint}`}>
                Optional — the printed expiry date on the box, if it has one.
              </p>
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
              disabled={productSaving}
              onClick={async () => {
                // Guards against double-tap creating two identical products —
                // there was no submitting state before, so a second tap while
                // the first request was still in flight fired a second insert.
                if (productSaving) return

                if (!productBrand || !productName || !productCategory) {
                  notify('Please fill in all fields.')
                  return
                }

                setProductSaving(true)

                const { data: { session }, error: sessionError } = await supabase.auth.getSession()

                if (sessionError) {
                  notify("Couldn't reach the server. Check your connection and try again.")
                  setProductSaving(false)
                  return
                }

                if (!session?.user) {
                  notify('Your session ended. Please log in again.')
                  setProductSaving(false)
                  setScreen('login')
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
                  notify(productError.message)
                  setProductSaving(false)
                  return
                }

                const { error: userProductError } =
                  await supabase
                    .from('user_products')
                    .insert({
                      user_id: session.user.id,
                      product_id: product.id,
                      is_active: true,
                      opened_date: productOpenedDate || null,
                      pao_months: productPaoMonths || null,
                      expiry_date: productExpiryDate || null,
                    })

                if (userProductError) {
                  notify(userProductError.message)
                  setProductSaving(false)
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
                    expiry_date,
                    products (
                      id,
                      brand,
                      name,
                      category,
                      ingredients
                    )
                  `)
                  .eq('user_id', session.user.id)
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
                setProductExpiryDate('')
                setProductSaving(false)
                setScreen('products')
              }}
              className={`mt-2 w-full rounded-2xl py-[18px] text-base font-bold ${t.btn} disabled:opacity-60`}
            >
              {productSaving ? 'Saving…' : 'Save product'}
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
                Can't find "{ingredientQuery.trim()}". We can't confirm how to use it
                or what it mixes with — treat it carefully and check the product's own instructions.
              </p>
            </div>
          )}


        </div>

        {onboardingCompleted && renderBottomTabs('products', t)}
      </main>
    )
  }

if (screen === 'checkEmail') {
  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-6 pb-6 pt-7 text-center">

        <span className={`flex h-14 w-14 items-center justify-center rounded-full text-2xl ${t.chip}`}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M3 7l9 6 9-6" />
          </svg>
        </span>

        <h1 className="mt-6 font-display text-[40px] font-light leading-[1.05] tracking-tight">
          Check your email
        </h1>

        <p className={`mt-3 max-w-[300px] text-[15px] leading-relaxed ${t.muted}`}>
          We sent a confirmation link to <span className="font-semibold">{loginEmail}</span>. Tap it to
          activate your account, then come back here and log in to finish setting up.
        </p>

        <button
          onClick={() => setScreen('login')}
          className={`mt-8 w-full rounded-2xl py-[18px] text-base font-bold ${t.btn}`}
        >
          Go to login
        </button>

      </div>
    </main>
  )
}

if (screen === 'admin') {
  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-10 pt-7">

        <div className="flex items-center justify-between">
          <div>
            <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
              Admin
            </p>
            <h1 className="mt-1 font-display text-[32px] font-light leading-[1.05] tracking-tight">
              {adminTab === 'signups' ? 'Signups' : 'Professional approvals'}
            </h1>
          </div>

          <button
            type="button"
            onClick={async () => {
              const confirmed = await confirmAction('Log out of the admin dashboard?')
              if (!confirmed) return
              await supabase.auth.signOut()
              setUser(null)
              setScreen('welcome')
            }}
            className={`rounded-2xl border px-4 py-2.5 text-[13px] font-semibold ${t.hair} ${t.muted}`}
          >
            Log out
          </button>
        </div>

        <div className={`mt-4 flex gap-2 rounded-2xl border ${t.hair} p-1`}>
          {[
            ['signups', 'Signups'],
            ['practitioners', `Approvals${pendingPractitioners.length > 0 ? ` (${pendingPractitioners.length})` : ''}`],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setAdminTab(key)}
              className={`flex-1 rounded-xl py-2 text-[13px] font-semibold transition ${
                adminTab === key ? t.chip : t.muted
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {adminTab === 'signups' && !adminLoading && !adminError && (
          <div className="mt-3 flex items-center justify-between">
            <p className={`text-[13px] ${t.faint}`}>
              {adminUsers.length} {adminUsers.length === 1 ? 'user' : 'users'}
            </p>

            <button
              type="button"
              disabled={adminUsers.length === 0}
              onClick={() => exportAdminUsersCsv(adminUsers)}
              className={`rounded-xl border px-3 py-1.5 text-[12px] font-semibold ${t.hair} ${t.muted} disabled:opacity-40`}
            >
              Export CSV
            </button>
          </div>
        )}

        {adminTab === 'signups' && adminLoading && (
          <p className={`mt-8 text-[15px] ${t.muted}`}>Loading…</p>
        )}

        {adminTab === 'signups' && adminError && (
          <div className="mt-6 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-4">
            <p className={`text-[13px] leading-relaxed ${t.danger}`}>{adminError}</p>
          </div>
        )}

        {adminTab === 'signups' && !adminLoading && !adminError && (
          <div className="mt-5 flex flex-col gap-3">
            {adminUsers.map((u) => (
              <div key={u.id} className={`rounded-2xl border ${t.hair} p-4`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold">
                      {u.username || 'No username yet'}
                    </p>
                    <p className={`truncate text-[13px] ${t.muted}`}>{u.email}</p>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        u.onboarding_completed ? t.chip : `border ${t.hair} ${t.faint}`
                      }`}
                    >
                      {u.onboarding_completed ? 'Onboarded' : 'Incomplete'}
                    </span>

                    {isSuspended(u) && (
                      <span className="rounded-full border border-rose-400/30 bg-rose-400/10 px-2.5 py-1 text-[11px] font-semibold">
                        <span className={t.danger}>Suspended</span>
                      </span>
                    )}
                  </div>
                </div>

                <div className={`mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] ${t.faint}`}>
                  <span>
                    Signed up {new Date(u.created_at).toLocaleDateString('en-GB', {
                      day: 'numeric', month: 'short', year: 'numeric',
                    })}
                  </span>
                  <span>
                    {u.last_sign_in_at
                      ? `Last active ${new Date(u.last_sign_in_at).toLocaleDateString('en-GB', {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}`
                      : 'Never signed in again'}
                  </span>
                  {!u.email_confirmed_at && (
                    <span className={t.danger}>Email not confirmed</span>
                  )}
                </div>

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => toggleSuspendUser(u)}
                    className={`flex-1 rounded-xl border px-3 py-2 text-[12px] font-semibold ${t.hair} ${t.muted}`}
                  >
                    {isSuspended(u) ? 'Unsuspend' : 'Suspend'}
                  </button>

                  <button
                    type="button"
                    onClick={() => deleteUserAccount(u)}
                    className={`flex-1 rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-[12px] font-semibold ${t.danger}`}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {adminTab === 'practitioners' && (
          <div className="mt-5">
            {pendingPractitionersLoading ? (
              <p className={`text-[15px] ${t.muted}`}>Loading…</p>
            ) : pendingPractitioners.length === 0 ? (
              <p className={`text-[13px] leading-relaxed ${t.muted}`}>
                No pending applications.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {pendingPractitioners.map((p) => (
                  <div key={p.user_id} className={`rounded-2xl border ${t.hair} p-4`}>
                    <p className="text-[15px] font-semibold">{p.display_name}</p>
                    {p.title && (
                      <p className={`text-[12px] font-medium ${t.mark}`}>{p.title}</p>
                    )}
                    <p className={`truncate text-[13px] ${t.muted}`}>{p.email}</p>

                    {p.bio && (
                      <p className={`mt-2 text-[13px] leading-relaxed ${t.muted}`}>{p.bio}</p>
                    )}

                    {p.specialisms?.length > 0 && (
                      <p className={`mt-2 text-[12px] ${t.faint}`}>
                        {p.specialisms.join(' · ')}
                      </p>
                    )}

                    <div className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] ${t.faint}`}>
                      {p.instagram && <span>IG: {p.instagram}</span>}
                      {p.whatsapp && <span>WhatsApp: {p.whatsapp}</span>}
                      <span>
                        Applied {new Date(p.created_at).toLocaleDateString('en-GB', {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}
                      </span>
                    </div>

                    {p.title && (
                      <p className={`mt-2 text-[11px] leading-relaxed ${t.faint}`}>
                        Shown to clients next to their name — check it against their Instagram/WhatsApp before approving.
                      </p>
                    )}

                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        disabled={!!busyAction}
                        onClick={() => runBusy(`reviewPractitioner-${p.user_id}`, () => reviewPractitioner(p.user_id, false))}
                        className={`flex-1 rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-[12px] font-semibold ${t.danger} disabled:opacity-50`}
                      >
                        {busyAction === `reviewPractitioner-${p.user_id}` ? 'Rejecting…' : 'Reject'}
                      </button>

                      <button
                        type="button"
                        disabled={!!busyAction}
                        onClick={() => runBusy(`reviewPractitioner-${p.user_id}`, () => reviewPractitioner(p.user_id, true))}
                        className={`flex-1 rounded-xl px-3 py-2 text-[12px] font-bold ${t.btn} disabled:opacity-50`}
                      >
                        {busyAction === `reviewPractitioner-${p.user_id}` ? 'Approving…' : 'Approve'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </main>
  )
}

if (screen === 'login') {
  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-6 pt-7">

        <button
          onClick={() => window.history.back()}
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
              onChange={(e) => {
                setLoginEmail(e.target.value)
                setLoginError(null)
              }}
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
                onChange={(e) => {
                  setLoginPassword(e.target.value)
                  setLoginError(null)
                }}
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
            disabled={busyAction === 'login'}
            onClick={() =>
              runBusy('login', async () => {
                setLoginError(null)

                if (!loginEmail || !loginPassword) {
                  setLoginError('Please enter your email and password.')
                  return
                }

                const { data, error } =
                  await supabase.auth.signInWithPassword({
                    email: loginEmail,
                    password: loginPassword,
                  })

                if (error) {
                  setLoginError(
                    error.message === 'Invalid login credentials'
                      ? "That email or password isn't right. Try again."
                      : error.message
                  )
                  return
                }

                setDisplayName('')

                setUser(data.user)

                if (data.user.email === ADMIN_EMAIL) {
                  setScreen('admin')
                  return
                }

                const { data: profile, error: profileError } =
                  await supabase
                    .from('profiles')
                    .select('username, onboarding_completed')
                    .eq('id', data.user.id)
                    .single()

                if (profileError) {
                  console.error(profileError)
                  notify('Profile could not be loaded: ' + profileError.message)
                } else {
                  // Same fallback as the mount-flow checkUser — a null
                  // username used to render as a blank greeting here.
                  setDisplayName(profile.username || data.user.email?.split('@')[0] || 'there')
                  setOnboardingCompleted(profile.onboarding_completed !== false)
                }

                // New users land on the skin profile step until they've
                // filled it in at least once; after that, straight to Today.
                const { data: existingSkinProfile } = await supabase
                  .from('skin_profiles')
                  .select('id')
                  .eq('user_id', data.user.id)
                  .limit(1)
                  .maybeSingle()

                setScreen(existingSkinProfile ? 'today' : 'skinProfile')
              })
            }
            className={`mt-2 w-full rounded-2xl py-[18px] text-base font-bold ${t.btn} disabled:opacity-60`}
          >
            {busyAction === 'login' ? 'Logging in…' : 'Log in'}
          </button>

          {loginError && (
            <div className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3.5">
              <p className={`text-[14px] leading-relaxed ${t.danger}`}>{loginError}</p>
            </div>
          )}

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
          onClick={() => window.history.back()}
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
            disabled={busyAction === 'forgotPassword'}
            onClick={() =>
              runBusy('forgotPassword', async () => {
                if (!loginEmail) {
                  notify('Please enter your email address.')
                  return
                }

                const { error } = await supabase.auth.resetPasswordForEmail(loginEmail, {
                  redirectTo: `${SITE_URL}/?recovery=true`,
                })

                if (error) {
                  setResetStatus(error.message)
                  return
                }

                setResetStatus("Check your email for a link to reset your password.")
              })
            }
            className={`mt-2 w-full rounded-2xl py-[18px] text-base font-bold ${t.btn} disabled:opacity-60`}
          >
            {busyAction === 'forgotPassword' ? 'Sending…' : 'Send reset link'}
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
            disabled={busyAction === 'resetPassword'}
            onClick={() =>
              runBusy('resetPassword', async () => {
                if (!newPassword || newPassword.length < 6) {
                  notify('Please enter a password with at least 6 characters.')
                  return
                }

                if (newPassword !== confirmNewPassword) {
                  notify('Passwords do not match.')
                  return
                }

                const { data, error } = await supabase.auth.updateUser({
                  password: newPassword,
                })

                if (error) {
                  notify(error.message)
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
                notify('Your password has been updated.', 'success')
                setScreen('today')
              })
            }
            className={`mt-2 w-full rounded-2xl py-[18px] text-base font-bold ${t.btn} disabled:opacity-60`}
          >
            {busyAction === 'resetPassword' ? 'Updating…' : 'Update password'}
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

          <span className={`text-[15px] font-semibold tracking-wide ${t.mark}`}>
            Tracka+
          </span>
        </div>

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

        <p className={`mb-2 mt-8 px-1 text-[12px] font-semibold uppercase tracking-wide ${t.faint}`}>
          Account
        </p>
        <div className={`flex flex-col divide-y overflow-hidden rounded-3xl ${t.surface} ${t.hair}`}>
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
            disabled={busyAction === 'remindersNav'}
            onClick={() =>
              runBusy('remindersNav', async () => {
                await loadReminderSettings()
                setScreen('reminders')
              })
            }
            className="flex items-center justify-between px-5 py-4 text-left text-[15px] font-semibold disabled:opacity-50"
          >
            {busyAction === 'remindersNav' ? 'Loading…' : 'Reminders'}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round" className={t.faint}>
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <p className={`mb-2 mt-6 px-1 text-[12px] font-semibold uppercase tracking-wide ${t.faint}`}>
          Professional care
        </p>
        <div className={`flex flex-col divide-y overflow-hidden rounded-3xl ${t.surface} ${t.hair}`}>
          <button
            onClick={() => setScreen('findProfessional')}
            className="flex items-center justify-between px-5 py-4 text-left text-[15px] font-semibold"
          >
            Find a professional
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round" className={t.faint}>
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>

          <button
            onClick={() => setScreen('careTeam')}
            className="flex items-center justify-between px-5 py-4 text-left text-[15px] font-semibold"
          >
            Care team
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round" className={t.faint}>
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>

          <button
            onClick={() => setScreen('notifications')}
            className="flex items-center justify-between px-5 py-4 text-left text-[15px] font-semibold"
          >
            <span>
              Notifications
              {(pendingRecommendations.length + careRelationships.filter((r) => r.status === 'invited').length) > 0 && (
                <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${t.chip}`}>
                  {pendingRecommendations.length + careRelationships.filter((r) => r.status === 'invited').length}
                </span>
              )}
            </span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round" className={t.faint}>
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {practitionerStatus !== 'verified' && (
            <button
              onClick={() => setScreen('applyPractitioner')}
              className="flex items-center justify-between px-5 py-4 text-left text-[15px] font-semibold"
            >
              <span>
                {practitionerStatus === 'pending' ? 'Professional application' : 'Become a professional'}
                {practitionerStatus === 'pending' && (
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${t.chip}`}>
                    Pending
                  </span>
                )}
              </span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" className={t.faint}>
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}

          {practitionerStatus === 'verified' && (
            <button
              onClick={() => setScreen('practitionerDashboard')}
              className="flex items-center justify-between px-5 py-4 text-left text-[15px] font-semibold"
            >
              Practitioner dashboard
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" className={t.faint}>
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>

        <p className={`mb-2 mt-6 px-1 text-[12px] font-semibold uppercase tracking-wide ${t.faint}`}>
          Preferences
        </p>
        <div className={`flex items-center justify-between rounded-3xl ${t.surface} p-5`}>
          <div className="pr-4">
            <p className="text-[15px] font-semibold">Dark mode</p>
            <p className={`mt-0.5 text-[13px] ${t.muted}`}>
              Switch to dark mode
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
            const confirmed = await confirmAction('Log out of Tracka+?')
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

if (screen === 'findProfessional') {
  const q = findProfessionalQuery.trim().toLowerCase()
  const filtered = !q
    ? verifiedPractitioners
    : verifiedPractitioners.filter((p) => {
        const haystack = [p.display_name, p.title, p.bio, ...(p.specialisms || [])]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return haystack.includes(q)
      })

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
            Find a professional
          </h1>
          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Browse verified aestheticians and reach out directly.
          </p>
        </div>

        <input
          type="text"
          placeholder="Search by name, specialism…"
          value={findProfessionalQuery}
          onChange={(e) => setFindProfessionalQuery(e.target.value)}
          className={`mt-6 w-full rounded-2xl border ${t.hair} ${t.surface} px-4 py-3.5 text-[15px] outline-none`}
        />

        {verifiedPractitionersLoading ? (
          <p className={`mt-8 text-[13px] ${t.muted}`}>Loading…</p>
        ) : filtered.length === 0 ? (
          <p className={`mt-8 text-[13px] leading-relaxed ${t.muted}`}>
            {verifiedPractitioners.length === 0
              ? 'No verified professionals yet — check back soon.'
              : 'No matches. Try a different search.'}
          </p>
        ) : (
          <div className="mt-6 flex flex-col gap-4">
            {filtered.map((p) => (
              <div key={p.user_id} className={`rounded-3xl ${t.surface} p-5`}>
                <p className="text-[16px] font-semibold">{p.display_name}</p>
                {p.title && (
                  <p className={`mt-0.5 text-[13px] font-medium ${t.mark}`}>{p.title}</p>
                )}
                {p.bio && (
                  <p className={`mt-2 text-[14px] leading-relaxed ${t.muted}`}>{p.bio}</p>
                )}
                {p.specialisms?.length > 0 && (
                  <p className={`mt-2 text-[12px] ${t.faint}`}>{p.specialisms.join(' · ')}</p>
                )}

                <div className="mt-4 flex flex-wrap gap-3">
                  {p.whatsapp && (
                    <a
                      href={whatsappLink(p.whatsapp, `Hi ${p.display_name}, I found your profile on Tracka+ — `)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`rounded-xl px-3.5 py-2 text-[13px] font-semibold ${t.btn}`}
                    >
                      Message on WhatsApp
                    </a>
                  )}
                  {p.instagram && (
                    <span className={`flex items-center rounded-xl border px-3.5 py-2 text-[13px] font-semibold ${t.hair} ${t.muted}`}>
                      IG: {p.instagram}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
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
            disabled={busyAction === 'settingsUsername'}
            onClick={() =>
              runBusy('settingsUsername', async () => {
                if (!settingsUsername.trim()) {
                  notify('Please enter a username.')
                  return
                }

                const { data: { session }, error: sessionError } = await supabase.auth.getSession()

                if (sessionError) {
                  notify("Couldn't reach the server. Check your connection and try again.")
                  return
                }

                if (!session?.user) {
                  notify('Your session ended. Please log in again.')
                  setScreen('login')
                  return
                }

                const { error } = await supabase
                  .from('profiles')
                  .upsert(
                    { id: session.user.id, username: settingsUsername.trim() },
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
              })
            }
            className={`mt-5 w-full rounded-2xl py-[16px] text-base font-bold ${t.btn} disabled:opacity-60`}
          >
            {busyAction === 'settingsUsername' ? 'Saving…' : 'Save username'}
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
            disabled={busyAction === 'settingsPassword'}
            onClick={() =>
              runBusy('settingsPassword', async () => {
                if (!newPassword || newPassword.length < 6) {
                  notify('Please enter a password with at least 6 characters.')
                  return
                }

                if (newPassword !== confirmNewPassword) {
                  notify('Passwords do not match.')
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
              })
            }
            className={`mt-5 w-full rounded-2xl py-[16px] text-base font-bold ${t.btn} disabled:opacity-60`}
          >
            {busyAction === 'settingsPassword' ? 'Updating…' : 'Update password'}
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

          {/* SPF REAPPLY */}
          <div className={`rounded-3xl ${t.surface} p-5`}>
            <div className="flex items-center justify-between gap-4">

              <div>
                <p className={`text-[11px] font-semibold uppercase tracking-wide ${t.mark}`}>
                  Sunscreen
                </p>

                <h2 className="mt-1 text-[17px] font-semibold">
                  Stay consistent with your sunscreen
                </h2>

                <p className={`mt-1 text-[13px] leading-relaxed ${t.muted}`}>
                  Get timely reminders to reapply your sunscreen during the day.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setSpfReapplyEnabled(
                    !spfReapplyEnabled
                  )
                }
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                  spfReapplyEnabled ? t.btn : t.rail
                }`}
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${
                    spfReapplyEnabled
                      ? 'left-6'
                      : 'left-1'
                  }`}
                />
              </button>

            </div>
          </div>

          {/* DIARY NUDGE */}
          <div className={`rounded-3xl ${t.surface} p-5`}>
            <div className="flex items-center justify-between gap-4">

              <div>
                <p className={`text-[11px] font-semibold uppercase tracking-wide ${t.mark}`}>
                  Skin diary
                </p>

                <h2 className="mt-1 text-[17px] font-semibold">
                  Diary reminders
                </h2>

                <p className={`mt-1 text-[13px] leading-relaxed ${t.muted}`}>
                  A nudge around midday if you haven't logged a note yet. Off by default.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setDiaryNudgeEnabled(
                    !diaryNudgeEnabled
                  )
                }
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                  diaryNudgeEnabled ? t.btn : t.rail
                }`}
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${
                    diaryNudgeEnabled
                      ? 'left-6'
                      : 'left-1'
                  }`}
                />
              </button>

            </div>
          </div>

        </div>

        <div className={`mt-4 rounded-3xl ${t.surface} p-5`}>
          <h2 className="text-[17px] font-semibold">
            Notifications
          </h2>

          <p className={`mt-2 text-[13px] leading-relaxed ${t.muted}`}>
            Enable notifications to get your Tracka+ reminders.
          </p>

          <button
            disabled={busyAction === 'pushSubscribe'}
            onClick={() =>
              runBusy('pushSubscribe', async () => {
                const result = await subscribeToPushNotifications()

                setPushStatus(
                  result.ok
                    ? "You're all set!"
                    : result.reason === 'needs_install'
                      ? 'Add Tracka+ to your home screen first, then open it from there.'
                      : result.reason === 'denied'
                        ? 'Notifications are blocked. Turn them on in your browser settings for this site.'
                        : result.reason === 'unsupported'
                          ? "This browser can't do notifications. Try Chrome or Safari."
                          : "That didn't work. Try again in a moment."
                )
              })
            }
            className={`mt-5 w-full rounded-2xl py-[18px] text-base font-bold ${t.btn} disabled:opacity-60`}
          >
            {busyAction === 'pushSubscribe' ? 'Turning on…' : 'Turn on notifications'}
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
if (screen === 'careTeam') {
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
            Care team
          </h1>

          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Professionals you've connected with, and exactly what they can see.
          </p>
        </div>

        {careTeamLoading ? (
          <p className={`mt-8 text-[13px] ${t.muted}`}>Loading…</p>
        ) : careRelationships.length === 0 ? (
          <p className={`mt-8 text-[13px] leading-relaxed ${t.muted}`}>
            Nobody yet. If a professional invites you, they'll show up here.
          </p>
        ) : (
          <div className="mt-8 flex flex-col gap-4">
            {careRelationships.map((rel) => (
              <div key={rel.id} className={`rounded-3xl ${t.surface} p-5`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[16px] font-semibold">
                      {rel.practitioners?.display_name || 'Professional'}
                    </p>
                    {rel.practitioners?.title && (
                      <p className={`mt-0.5 text-[12px] font-medium ${t.mark}`}>{rel.practitioners.title}</p>
                    )}
                    {rel.practitioners?.bio && (
                      <p className={`mt-0.5 text-[13px] ${t.muted}`}>{rel.practitioners.bio}</p>
                    )}
                  </div>
                  {rel.status === 'invited' && (
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${t.chip}`}>
                      Pending
                    </span>
                  )}
                </div>

                {rel.status === 'invited' ? (
                  <div className="mt-4 flex gap-2.5">
                    <button
                      disabled={!!busyAction}
                      onClick={() => runBusy(`careInvite-${rel.id}`, () => respondToCareInvite(rel.id, false))}
                      className={`flex-1 rounded-2xl border py-3 text-[14px] font-semibold ${t.hair} ${t.muted} disabled:opacity-50`}
                    >
                      {busyAction === `careInvite-${rel.id}` ? 'Declining…' : 'Decline'}
                    </button>
                    <button
                      disabled={!!busyAction}
                      onClick={() => runBusy(`careInvite-${rel.id}`, () => respondToCareInvite(rel.id, true))}
                      className={`flex-1 rounded-2xl py-3 text-[14px] font-bold ${t.btn} disabled:opacity-50`}
                    >
                      {busyAction === `careInvite-${rel.id}` ? 'Accepting…' : 'Accept'}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className={`mt-4 flex flex-col gap-2.5 border-t pt-4 ${t.hair}`}>
                      {CARE_SCOPES.map(([scope, label]) => {
                        const isNested = scope === 'pregnancy_status'
                        const locked = isNested && !rel.scopes.includes('skin_profile')

                        return (
                          <div
                            key={scope}
                            className={`flex items-center justify-between ${isNested ? 'ml-4' : ''}`}
                          >
                            <div>
                              <span className={`text-[14px] ${locked ? t.faint : ''}`}>{label}</span>
                              {locked && (
                                <p className={`text-[11px] ${t.faint}`}>Requires skin profile access</p>
                              )}
                            </div>
                            <button
                              type="button"
                              disabled={locked}
                              onClick={() => toggleCareScope(rel, scope)}
                              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                                rel.scopes.includes(scope) ? t.btn : t.rail
                              } ${locked ? 'opacity-40' : ''}`}
                            >
                              <span
                                className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${
                                  rel.scopes.includes(scope) ? 'left-6' : 'left-1'
                                }`}
                              />
                            </button>
                          </div>
                        )
                      })}
                    </div>

                    <div className="mt-4 flex items-center justify-between">
                      {rel.practitioners?.whatsapp ? (
                        <a
                          href={whatsappLink(rel.practitioners.whatsapp, `Hi ${rel.practitioners.display_name || ''}, `)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`text-[13px] font-semibold ${t.mark}`}
                        >
                          Message on WhatsApp
                        </a>
                      ) : <span />}

                      <button
                        disabled={!!busyAction}
                        onClick={() => runBusy(`revokeCare-${rel.id}`, () => revokeCareAccess(rel.id, rel.practitioners?.display_name))}
                        className={`text-[13px] font-semibold ${t.danger} disabled:opacity-50`}
                      >
                        {busyAction === `revokeCare-${rel.id}` ? 'Revoking…' : 'Revoke access'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {endedRelationships.length > 0 && (
          <div className="mt-8">
            <div className="flex flex-col gap-2.5">
              {endedRelationships.map((rel) => (
                <p key={rel.id} className={`text-[13px] ${t.faint}`}>
                  {rel.practitioners?.display_name || 'A professional'} ended your care relationship
                  {' — '}
                  {new Date(rel.revoked_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </p>
              ))}
            </div>
          </div>
        )}

        {careAccessLog.length > 0 && (
          <div className="mt-8">
            <h2 className="text-[15px] font-semibold">Recent activity</h2>
            <div className="mt-3 flex flex-col gap-2.5">
              {careAccessLog.map((entry, i) => (
                <p key={i} className={`text-[13px] ${t.muted}`}>
                  <span className="font-medium">{entry.practitioners?.display_name || 'A professional'}</span>
                  {' '}viewed your {entry.what === 'view_skin_profile' ? 'skin profile' : entry.what}
                  {' — '}
                  {new Date(entry.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </p>
              ))}
            </div>
          </div>
        )}

      </div>
    </main>
  )
}
if (screen === 'notifications') {
  const pendingInvites = careRelationships.filter((r) => r.status === 'invited')

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
            Notifications
          </h1>
          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Invites and routines waiting on you.
          </p>
        </div>

        {pendingInvites.length > 0 && (
          <div className="mt-8 flex flex-col gap-4">
            {pendingInvites.map((rel) => (
              <div key={rel.id} className={`rounded-3xl ${t.surface} p-5`}>
                <p className="text-[16px] font-semibold">
                  {rel.practitioners?.display_name || 'A professional'} wants to connect
                </p>
                {rel.practitioners?.title && (
                  <p className={`mt-0.5 text-[12px] font-medium ${t.mark}`}>{rel.practitioners.title}</p>
                )}
                {rel.practitioners?.bio && (
                  <p className={`mt-0.5 text-[13px] ${t.muted}`}>{rel.practitioners.bio}</p>
                )}
                <div className="mt-4 flex gap-2.5">
                  <button
                    disabled={!!busyAction}
                    onClick={() => runBusy(`careInvite-${rel.id}`, () => respondToCareInvite(rel.id, false))}
                    className={`flex-1 rounded-2xl border py-3 text-[14px] font-semibold ${t.hair} ${t.muted} disabled:opacity-50`}
                  >
                    {busyAction === `careInvite-${rel.id}` ? 'Declining…' : 'Decline'}
                  </button>
                  <button
                    disabled={!!busyAction}
                    onClick={() => runBusy(`careInvite-${rel.id}`, () => respondToCareInvite(rel.id, true))}
                    className={`flex-1 rounded-2xl py-3 text-[14px] font-bold ${t.btn} disabled:opacity-50`}
                  >
                    {busyAction === `careInvite-${rel.id}` ? 'Accepting…' : 'Accept'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {pendingRecommendationsLoading ? (
          <p className={`mt-8 text-[13px] ${t.muted}`}>Loading…</p>
        ) : pendingRecommendations.length === 0 ? (
          pendingInvites.length === 0 && (
            <p className={`mt-8 text-[13px] leading-relaxed ${t.muted}`}>
              Nothing pending. Invites and recommendations from a professional will show up here.
            </p>
          )
        ) : (
          <div className="mt-8 flex flex-col gap-5">
            {pendingRecommendations.map((rec) => {
              const amItems = rec.recommendation_items.filter((i) => i.slot === 'AM')
              const pmItems = rec.recommendation_items.filter((i) => i.slot === 'PM')

              return (
                <div key={rec.id} className={`rounded-3xl ${t.surface} p-5`}>
                  <p className="text-[16px] font-semibold">
                    {rec.practitioners?.display_name || 'A professional'}
                  </p>
                  {rec.practitioners?.title && (
                    <p className={`mt-0.5 text-[12px] font-medium ${t.mark}`}>{rec.practitioners.title}</p>
                  )}
                  {rec.practitioners?.bio && (
                    <p className={`mt-0.5 text-[13px] ${t.muted}`}>{rec.practitioners.bio}</p>
                  )}

                  {rec.proposes_skin_profile && (
                    <div className={`mt-4 rounded-2xl border ${t.hair} p-4`}>
                      <p className={`text-[12px] font-semibold uppercase tracking-wide ${t.faint}`}>
                        Proposed skin profile
                      </p>
                      <div className="mt-2 flex flex-col gap-1 text-[13px]">
                        {rec.skin_type && <p>Skin type — {rec.skin_type}</p>}
                        {rec.concerns && <p>Concerns — {rec.concerns}</p>}
                        {rec.goals && <p>Goals — {rec.goals}</p>}
                        {rec.sensitivity && <p>Sensitivity — {rec.sensitivity}</p>}
                      </div>
                    </div>
                  )}

                  {amItems.length > 0 && (
                    <div className="mt-4">
                      <p className={`text-[12px] font-semibold uppercase tracking-wide ${t.faint}`}>Morning</p>
                      <div className="mt-2 flex flex-col gap-1.5">
                        {amItems.map((item) => (
                          <p key={item.id} className="text-[14px]">
                            <span className="font-medium">{item.products?.brand}</span>{' '}{item.products?.name}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                  {pmItems.length > 0 && (
                    <div className="mt-4">
                      <p className={`text-[12px] font-semibold uppercase tracking-wide ${t.faint}`}>Night</p>
                      <div className="mt-2 flex flex-col gap-1.5">
                        {pmItems.map((item) => (
                          <p key={item.id} className="text-[14px]">
                            <span className="font-medium">{item.products?.brand}</span>{' '}{item.products?.name}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                  {rec.note && (
                    <div className={`mt-4 rounded-2xl border ${t.hair} p-4`}>
                      <p className={`text-[12px] font-semibold uppercase tracking-wide ${t.faint}`}>Note</p>
                      <p className="mt-1.5 text-[14px] leading-relaxed">{rec.note}</p>
                    </div>
                  )}

                  {rec.practitioners?.whatsapp && (
                    <a
                      href={whatsappLink(rec.practitioners.whatsapp, `Hi ${rec.practitioners.display_name || ''}, about the routine you sent — `)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`mt-4 inline-block text-[13px] font-semibold ${t.mark}`}
                    >
                      Message on WhatsApp
                    </a>
                  )}

                  <div className="mt-5 flex gap-2.5">
                    <button
                      disabled={!!busyAction}
                      onClick={() => runBusy(`recommendation-${rec.id}`, () => respondToRecommendation(rec.id, false))}
                      className={`flex-1 rounded-2xl border py-3 text-[14px] font-semibold ${t.hair} ${t.muted} disabled:opacity-50`}
                    >
                      {busyAction === `recommendation-${rec.id}` ? 'Declining…' : 'Decline'}
                    </button>
                    <button
                      disabled={!!busyAction}
                      onClick={() => runBusy(`recommendation-${rec.id}`, () => respondToRecommendation(rec.id, true))}
                      className={`flex-1 rounded-2xl py-3 text-[14px] font-bold ${t.btn} disabled:opacity-50`}
                    >
                      {busyAction === `recommendation-${rec.id}` ? 'Accepting…' : 'Accept'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <button
          onClick={() => setScreen('recommendationHistory')}
          className={`mt-8 text-center text-[13px] font-semibold ${t.mark}`}
        >
          Past recommendations →
        </button>

      </div>
    </main>
  )
}
if (screen === 'recommendationHistory') {
  const STATUS_LABEL = {
    accepted: 'Accepted',
    declined: 'Declined',
    superseded: 'Withdrawn by practitioner',
  }

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-6 pt-7">

        <button
          onClick={() => setScreen('notifications')}
          className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Notifications
        </button>

        <div className="mt-5">
          <h1 className="font-display text-[34px] font-light leading-[1.05] tracking-tight">
            Past recommendations
          </h1>
          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Everything a professional has proposed for you, resolved or not.
          </p>
        </div>

        {recommendationHistoryLoading ? (
          <p className={`mt-8 text-[13px] ${t.muted}`}>Loading…</p>
        ) : recommendationHistory.length === 0 ? (
          <p className={`mt-8 text-[13px] leading-relaxed ${t.muted}`}>
            Nothing here yet.
          </p>
        ) : (
          <div className="mt-8 flex flex-col gap-3">
            {recommendationHistory.map((rec) => (
              <div key={rec.id} className={`rounded-2xl ${t.surface} p-4`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[15px] font-semibold">
                      {rec.practitioners?.display_name || 'A professional'}
                    </p>
                    {rec.practitioners?.title && (
                      <p className={`mt-0.5 text-[12px] font-medium ${t.mark}`}>{rec.practitioners.title}</p>
                    )}
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${t.chip}`}>
                    {STATUS_LABEL[rec.status] || rec.status}
                  </span>
                </div>
                <p className={`mt-2 text-[12px] ${t.muted}`}>
                  {new Date(rec.responded_at || rec.created_at).toLocaleDateString('en-GB', {
                    day: 'numeric', month: 'short', year: 'numeric',
                  })}
                </p>
                {rec.note && (
                  <p className={`mt-2 text-[13px] italic ${t.faint}`}>"{rec.note}"</p>
                )}
              </div>
            ))}
          </div>
        )}

      </div>
    </main>
  )
}
if (screen === 'applyPractitioner') {
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
            {practitionerStatus === 'verified' ? 'Your practitioner profile' : 'Become a professional'}
          </h1>

          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            {practitionerStatus === 'verified'
              ? 'Clients see this when you invite them. You can update it any time.'
              : practitionerStatus === 'pending'
              ? "Your application is under review — we'll let you know once it's approved."
              : 'Tell us a bit about your practice. We review applications by hand before you can invite clients.'}
          </p>
        </div>

        <div className={`mt-8 flex flex-col gap-5 rounded-3xl ${t.surface} p-5`}>
          <div>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              Display name
            </label>
            <input
              type="text"
              placeholder="e.g. Deeyah Skin Studio"
              value={applyDisplayName}
              onChange={(e) => setApplyDisplayName(e.target.value)}
              className={`w-full rounded-2xl border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            />
          </div>

          <div>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              Your title
            </label>
            <input
              type="text"
              placeholder="e.g. Esthetician, Licensed Dermatologist, Skincare Consultant"
              value={applyTitle}
              onChange={(e) => setApplyTitle(e.target.value)}
              className={`w-full rounded-2xl border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            />
            <p className={`mt-1.5 text-[12px] ${t.faint}`}>
              Shown to clients wherever your name appears.
            </p>
          </div>

          <div>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              Bio
            </label>
            <textarea
              placeholder="A short intro clients will see"
              value={applyBio}
              onChange={(e) => setApplyBio(e.target.value)}
              rows={3}
              className={`w-full rounded-2xl border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            />
          </div>

          <div>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              Specialisms
            </label>
            <input
              type="text"
              placeholder="e.g. Acne, hyperpigmentation, sensitive skin"
              value={applySpecialisms}
              onChange={(e) => setApplySpecialisms(e.target.value)}
              className={`w-full rounded-2xl border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            />
            <p className={`mt-1.5 text-[12px] ${t.faint}`}>Separate with commas</p>
          </div>

          <div>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              Instagram
            </label>
            <input
              type="text"
              placeholder="e.g. @deeyahskin"
              value={applyInstagram}
              onChange={(e) => setApplyInstagram(e.target.value)}
              className={`w-full rounded-2xl border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            />
          </div>

          <div>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              WhatsApp number
            </label>
            <input
              type="text"
              placeholder="e.g. +2348012345678"
              value={applyWhatsapp}
              onChange={(e) => setApplyWhatsapp(e.target.value)}
              className={`w-full rounded-2xl border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            />
          </div>

          <button
            onClick={submitPractitionerApplication}
            disabled={applySaving}
            className={`mt-2 w-full rounded-2xl py-3.5 text-[15px] font-bold ${t.btn} disabled:opacity-60`}
          >
            {applySaving
              ? 'Saving…'
              : practitionerStatus === 'verified'
              ? 'Save changes'
              : practitionerStatus === 'pending'
              ? 'Update application'
              : 'Submit application'}
          </button>
        </div>

      </div>
    </main>
  )
}
if (screen === 'practitionerDashboard') {
  const pendingClients = practitionerClients.filter((c) => c.status === 'invited')

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-10 pt-7">

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
            Practitioner
          </p>
          <h1 className="mt-1.5 font-display text-[36px] font-light leading-[1.05] tracking-tight">
            Hello, {applyDisplayName || displayName}
          </h1>
          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Help your clients stay consistent with their skincare routines.
          </p>
        </div>

        <button
          onClick={() => {
            setAddClientEmail('')
            setAddClientResult(null)
            setScreen('addClient')
          }}
          className={`mt-6 w-full rounded-2xl py-3.5 text-[15px] font-bold ${t.btn}`}
        >
          + Add Client
        </button>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <div className={`rounded-3xl ${t.surface} p-4`}>
            <p className="text-[28px] font-semibold">{practitionerClients.length}</p>
            <p className={`text-[13px] ${t.muted}`}>Total clients</p>
          </div>
          <div className={`rounded-3xl ${t.surface} p-4`}>
            <p className="text-[28px] font-semibold">{pendingClients.length}</p>
            <p className={`text-[13px] ${t.muted}`}>Pending acceptance</p>
          </div>
        </div>

        <button
          onClick={() => setScreen('practitionerRoutines')}
          className={`mt-4 flex w-full items-center justify-between rounded-2xl border ${t.hair} px-4 py-3 text-left text-[14px] font-semibold ${t.muted}`}
        >
          All routines sent
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {!pendingInvitationsLoading && pendingInvitations.length > 0 && (
          <div className="mt-8">
            <h2 className="text-[15px] font-semibold">Pending invites</h2>
            <p className={`mt-1 text-[13px] ${t.muted}`}>
              Links you've sent that haven't been opened yet.
            </p>
            <div className="mt-4 flex flex-col gap-2.5">
              {pendingInvitations.map((inv) => (
                <div key={inv.token} className={`flex items-center justify-between rounded-2xl ${t.surface} p-4`}>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold">
                      {inv.label || inv.invited_email || 'Shared link'}
                    </p>
                    <p className={`mt-0.5 text-[12px] ${t.muted}`}>
                      Sent {new Date(inv.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      type="button"
                      onClick={() => shareClientInviteLink(`${SITE_URL}/?invite=${inv.token}`)}
                      className={`text-[13px] font-semibold ${t.mark}`}
                    >
                      Share
                    </button>
                    <button
                      type="button"
                      disabled={!!busyAction}
                      onClick={() => runBusy(`cancelInvite-${inv.token}`, () => cancelInvitation(inv.token))}
                      className={`text-[13px] font-semibold ${t.danger} disabled:opacity-50`}
                    >
                      {busyAction === `cancelInvite-${inv.token}` ? '…' : 'Cancel'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8">
          <h2 className="text-[15px] font-semibold">Clients</h2>

          {practitionerClientsLoading ? (
            <p className={`mt-4 text-[13px] ${t.muted}`}>Loading…</p>
          ) : practitionerClients.length === 0 ? (
            <p className={`mt-4 text-[13px] leading-relaxed ${t.muted}`}>
              No clients yet. Tap "Add Client" above to invite your first one.
            </p>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              {practitionerClients.map((c) => {
                // Flags a connection accepted in the last 24h — surfaces who
                // just claimed a link, since that's otherwise invisible
                // until the practitioner happens to check back. Relies on
                // practitioner_list_clients() already sorting most-recently-
                // accepted first, so these naturally land at the top.
                const isRecent =
                  c.status === 'active' &&
                  c.accepted_at &&
                  Date.now() - new Date(c.accepted_at).getTime() < 24 * 60 * 60 * 1000

                return (
                <button
                  key={c.relationship_id}
                  onClick={() => c.status === 'active' && openClientDetail(c.client_id)}
                  className={`flex items-center justify-between rounded-2xl ${t.surface} p-4 text-left`}
                >
                  <div>
                    <p className="text-[15px] font-semibold">
                      {c.username || 'Client'}
                      {isRecent && (
                        <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${t.chip}`}>
                          New
                        </span>
                      )}
                    </p>
                    <p className={`mt-0.5 text-[13px] ${t.muted}`}>
                      {c.status === 'invited' ? 'Waiting for acceptance' : 'Active'}
                    </p>
                  </div>
                  {c.status === 'invited' ? (
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${t.chip}`}>
                      Pending
                    </span>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="1.8"
                      strokeLinecap="round" strokeLinejoin="round" className={t.faint}>
                      <path d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                </button>
                )
              })}
            </div>
          )}
        </div>

        {practitionerRecommendations.length > 0 && (
          <div className="mt-8">
            <h2 className="text-[15px] font-semibold">Recent activity</h2>
            <div className="mt-4 flex flex-col gap-2.5">
              {practitionerRecommendations.slice(0, 5).map((rec) => {
                const label =
                  rec.status === 'proposed' ? 'Routine sent to'
                  : rec.status === 'accepted' ? 'Accepted by'
                  : rec.status === 'declined' ? 'Declined by'
                  : 'Withdrawn for'
                const at = rec.status === 'proposed' ? rec.created_at : rec.responded_at || rec.created_at

                return (
                  <p key={rec.id} className={`text-[13px] ${t.muted}`}>
                    <span className="font-medium">{label} {rec.profiles?.username || 'a client'}</span>
                    {' — '}
                    {new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </p>
                )
              })}
            </div>
          </div>
        )}

      </div>
    </main>
  )
}
if (screen === 'practitionerClientDetail') {
  const client = practitionerClients.find((c) => c.client_id === selectedClientId)

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-10 pt-7">

        <button
          onClick={() => setScreen('practitionerDashboard')}
          className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Clients
        </button>

        <div className="mt-5">
          <h1 className="font-display text-[32px] font-light leading-[1.05] tracking-tight">
            {client?.username || 'Client'}
          </h1>
        </div>

        {clientDetailLoading ? (
          <p className={`mt-8 text-[13px] ${t.muted}`}>Loading…</p>
        ) : (
          <>
            <div className={`mt-6 rounded-3xl ${t.surface} p-5`}>
              <h2 className="text-[15px] font-semibold">Skin profile</h2>
              {clientDetail ? (
                <div className="mt-3 flex flex-col gap-2 text-[14px]">
                  {clientDetail.skin_type && (
                    <p><span className={t.muted}>Skin type — </span>{clientDetail.skin_type}</p>
                  )}
                  {clientDetail.concerns && (
                    <p><span className={t.muted}>Concerns — </span>{clientDetail.concerns}</p>
                  )}
                  {clientDetail.goals && (
                    <p><span className={t.muted}>Goals — </span>{clientDetail.goals}</p>
                  )}
                  {!clientDetail.skin_type && !clientDetail.concerns && !clientDetail.goals && (
                    <p className={t.muted}>Not filled in yet.</p>
                  )}
                </div>
              ) : (
                <p className={`mt-3 text-[13px] ${t.muted}`}>Not shared, or not filled in yet.</p>
              )}
            </div>

            <div className={`mt-4 rounded-3xl ${t.surface} p-5`}>
              <h2 className="text-[15px] font-semibold">Products</h2>
              {clientProducts.length === 0 ? (
                <p className={`mt-3 text-[13px] ${t.muted}`}>None added yet.</p>
              ) : (
                <div className="mt-3 flex flex-col gap-2">
                  {clientProducts.map((p) => (
                    <p key={p.id} className="text-[14px]">
                      <span className="font-medium">{p.products?.brand}</span>
                      {' '}{p.products?.name}
                    </p>
                  ))}
                </div>
              )}
            </div>

            <div className={`mt-4 rounded-3xl ${t.surface} p-5`}>
              <h2 className="text-[15px] font-semibold">Routine</h2>

              <p className={`mt-3 text-[13px] font-semibold ${t.mark}`}>Morning</p>
              {clientRoutineSteps.am.length === 0 ? (
                <p className={`mt-1 text-[13px] ${t.muted}`}>No AM routine.</p>
              ) : (
                clientRoutineSteps.am.map((s, i) => (
                  <p key={i} className="mt-1 text-[14px]">{s.step_name}</p>
                ))
              )}

              <p className={`mt-4 text-[13px] font-semibold ${t.mark}`}>Night</p>
              {clientRoutineSteps.pm.length === 0 ? (
                <p className={`mt-1 text-[13px] ${t.muted}`}>No PM routine.</p>
              ) : (
                clientRoutineSteps.pm.map((s, i) => (
                  <p key={i} className="mt-1 text-[14px]">{s.step_name}</p>
                ))
              )}
            </div>

            <button
              onClick={openComposer}
              className={`mt-6 w-full rounded-2xl py-3.5 text-[15px] font-bold ${t.btn}`}
            >
              Propose a routine
            </button>

            <button
              disabled={!!busyAction}
              onClick={() => runBusy(`removeClient-${client?.relationship_id}`, () => removeClient(client?.relationship_id, client?.username))}
              className={`mt-3 w-full text-center text-[13px] font-semibold ${t.danger} disabled:opacity-50`}
            >
              {busyAction === `removeClient-${client?.relationship_id}` ? 'Removing…' : 'Remove client'}
            </button>
          </>
        )}

      </div>
    </main>
  )
}
if (screen === 'addClient') {
  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-10 pt-7">

        <button
          onClick={() => setScreen('practitionerDashboard')}
          className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Dashboard
        </button>

        <div className="mt-5">
          <h1 className="font-display text-[34px] font-light leading-[1.05] tracking-tight">
            Add Client
          </h1>
          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Invite a client to receive their personalized skincare routine.
          </p>
        </div>

        {!addClientResult ? (
          <div className={`mt-8 rounded-3xl ${t.surface} p-5`}>
            <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
              Client email
            </label>

            <input
              type="email"
              placeholder="e.g. sarah@email.com"
              value={addClientEmail}
              onChange={(e) => setAddClientEmail(e.target.value)}
              className={`w-full rounded-2xl border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            />

            <p className={`mt-1.5 text-[12px] ${t.faint}`}>
              This email is used to find or create their Tracka+ account.
            </p>

            <button
              onClick={inviteClientByEmail}
              disabled={addClientSaving}
              className={`mt-5 w-full rounded-2xl py-3.5 text-[15px] font-bold ${t.btn} disabled:opacity-60`}
            >
              {addClientSaving ? 'Sending…' : 'Continue'}
            </button>
          </div>
        ) : null}

        {!addClientResult && (
          <div className={`mt-4 rounded-3xl ${t.surface} p-5`}>
            <p className="text-[15px] font-semibold">Don't know their email?</p>
            <p className={`mt-1 text-[13px] leading-relaxed ${t.muted}`}>
              Generate a link instead — it works whether or not they already have an account, no email needed.
            </p>

            <input
              type="text"
              placeholder="A name to remind you who this is for (optional)"
              value={addLinkLabel}
              onChange={(e) => setAddLinkLabel(e.target.value)}
              className={`mt-3 w-full rounded-2xl border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
            />

            <button
              onClick={createInviteLink}
              disabled={addLinkSaving}
              className={`mt-3 w-full rounded-2xl border py-3.5 text-[15px] font-semibold ${t.hair} ${t.muted} disabled:opacity-60`}
            >
              {addLinkSaving ? 'Creating…' : 'Generate invite link'}
            </button>
          </div>
        )}

        {addClientResult && (
          <div className={`mt-8 rounded-3xl ${t.surface} p-5`}>
            <p className="text-[15px] font-semibold">Ready to share</p>
            <p className={`mt-2 text-[14px] leading-relaxed ${t.muted}`}>
              Share this link with them — opening it connects them with you, whether they already have a Tracka+ account or not.
            </p>

            <div className={`mt-4 rounded-2xl border ${t.hair} px-4 py-3`}>
              <p className="break-all text-[13px]">{addClientResult.link}</p>
            </div>

            <button
              onClick={() => shareClientInviteLink(addClientResult.link)}
              className={`mt-4 w-full rounded-2xl py-3.5 text-[15px] font-bold ${t.btn}`}
            >
              Share link
            </button>

            <button
              onClick={() => {
                setAddClientEmail('')
                setAddClientResult(null)
                setScreen('practitionerDashboard')
              }}
              className={`mt-3 w-full text-[13px] font-semibold ${t.muted}`}
            >
              Done
            </button>
          </div>
        )}

      </div>
    </main>
  )
}
if (screen === 'composeRecommendation') {
  const client = practitionerClients.find((c) => c.client_id === selectedClientId)

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-28 pt-7">

        <button
          onClick={() => setScreen('practitionerClientDetail')}
          className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          {client?.username || 'Client'}
        </button>

        <div className="mt-5">
          <h1 className="font-display text-[32px] font-light leading-[1.05] tracking-tight">
            Propose a routine
          </h1>
          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            They'll review everything and can accept or decline it.
          </p>
        </div>

        <div className={`mt-6 rounded-3xl ${t.surface} p-5`}>
          <button
            type="button"
            onClick={() => {
              const next = !composeIncludeSkinProfile
              setComposeIncludeSkinProfile(next)
              if (next && !composeSkinType && clientDetail) {
                setComposeGender(clientDetail.gender || '')
                setComposePregnant(clientDetail.pregnant_or_breastfeeding ?? undefined)
                setComposeSkinType(clientDetail.skin_type || '')
                setComposeConcerns(clientDetail.concerns ? clientDetail.concerns.split(', ').filter(Boolean) : [])
                setComposeGoals(clientDetail.goals ? clientDetail.goals.split(', ').filter(Boolean) : [])
                setComposeSensitivity(clientDetail.sensitivity || '')
              }
            }}
            className="flex w-full items-center justify-between"
          >
            <span className="text-[15px] font-semibold">Include a skin profile</span>
            <span
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                composeIncludeSkinProfile ? t.btn : t.rail
              }`}
            >
              <span
                className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${
                  composeIncludeSkinProfile ? 'left-6' : 'left-1'
                }`}
              />
            </span>
          </button>

          {composeIncludeSkinProfile && (
            <div className="mt-6 flex flex-col gap-6">
              <section>
                <h3 className="mb-2.5 text-[14px] font-semibold">Gender</h3>
                <div className="grid grid-cols-2 gap-2">
                  {['Female', 'Male', 'Non-binary', 'Prefer not to say'].map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setComposeGender(option)}
                      className={`rounded-xl border px-3 py-3 text-left text-[13px] font-medium ${
                        composeGender === option ? `${t.chip} border-transparent` : `${t.hair} ${t.muted}`
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-2.5 text-[14px] font-semibold">Pregnant or breastfeeding?</h3>
                <div className="flex gap-2">
                  {[['Yes', true], ['No', false], ['Rather not say', null]].map(([label, value]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setComposePregnant(value)}
                      className={`flex-1 rounded-xl border px-3 py-3 text-[13px] font-medium ${
                        composePregnant === value ? `${t.chip} border-transparent` : `${t.hair} ${t.muted}`
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-2.5 text-[14px] font-semibold">Skin type</h3>
                <div className="grid grid-cols-2 gap-2">
                  {['Normal', 'Dry', 'Oily', 'Combination'].map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setComposeSkinType(type)}
                      className={`rounded-xl border px-3 py-3 text-left text-[13px] font-medium ${
                        composeSkinType === type ? `${t.chip} border-transparent` : `${t.hair} ${t.muted}`
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-2.5 text-[14px] font-semibold">Main concerns</h3>
                <div className="grid grid-cols-2 gap-2">
                  {['Acne', 'Dark circles', 'Dullness', 'Puffiness', 'Uneven texture', 'Visible pores', 'Dryness', 'Hyperpigmentation', 'Sensitivity', 'None'].map((concern) => (
                    <button
                      key={concern}
                      type="button"
                      onClick={() => {
                        setComposeConcerns((current) => {
                          if (concern === 'None') {
                            return current.includes('None') ? [] : ['None']
                          }
                          const withoutNone = current.filter((c) => c !== 'None')
                          return withoutNone.includes(concern)
                            ? withoutNone.filter((c) => c !== concern)
                            : [...withoutNone, concern]
                        })
                      }}
                      className={`rounded-xl border px-3 py-3 text-left text-[13px] font-medium ${
                        composeConcerns.includes(concern) ? `${t.chip} border-transparent` : `${t.hair} ${t.muted}`
                      }`}
                    >
                      {concern}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-2.5 text-[14px] font-semibold">Goals</h3>
                <div className="grid grid-cols-2 gap-2">
                  {['Hydration', 'Clearer skin', 'Even skin tone', 'Healthy skin'].map((goal) => (
                    <button
                      key={goal}
                      type="button"
                      onClick={() =>
                        setComposeGoals((current) =>
                          current.includes(goal)
                            ? current.filter((g) => g !== goal)
                            : [...current, goal]
                        )
                      }
                      className={`rounded-xl border px-3 py-3 text-left text-[13px] font-medium ${
                        composeGoals.includes(goal) ? `${t.chip} border-transparent` : `${t.hair} ${t.muted}`
                      }`}
                    >
                      {goal}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-2.5 text-[14px] font-semibold">Sensitivity</h3>
                <div className="flex flex-col gap-2">
                  {['Not sensitive', 'Sometimes sensitive', 'Very sensitive'].map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setComposeSensitivity(option)}
                      className={`w-full rounded-xl border px-3 py-3 text-left text-[13px] font-medium ${
                        composeSensitivity === option ? `${t.chip} border-transparent` : `${t.hair} ${t.muted}`
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>

        <div className={`mt-4 rounded-3xl ${t.surface} p-5`}>
          <h2 className="text-[15px] font-semibold">Products</h2>

          {composeItems.length > 0 && (
            <div className="mt-4 flex flex-col gap-2.5">
              {composeItems.map((item) => (
                <div key={item.tempId} className={`flex items-start justify-between rounded-2xl border ${t.hair} p-3.5`}>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold">{item.brand} — {item.name}</p>
                    <p className={`mt-0.5 text-[12px] ${t.muted}`}>
                      {item.category} • {item.slot} • {item.days_of_week.length === 7 ? 'Every day' : `${item.days_of_week.length} days/week`}
                    </p>
                    {item.reason && (
                      <p className={`mt-1 text-[12px] italic ${t.faint}`}>"{item.reason}"</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeComposeItem(item.tempId)}
                    className={`shrink-0 text-[12px] font-semibold ${t.danger}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className={`mt-4 rounded-2xl border ${t.hair} p-4`}>
            <div className="grid grid-cols-2 gap-2.5">
              <input
                type="text"
                placeholder="Brand"
                value={composeItemBrand}
                onChange={(e) => setComposeItemBrand(e.target.value)}
                className={`rounded-xl border ${t.hair} px-3 py-2.5 text-[13px] outline-none`}
              />
              <input
                type="text"
                placeholder="Product name"
                value={composeItemName}
                onChange={(e) => setComposeItemName(e.target.value)}
                className={`rounded-xl border ${t.hair} px-3 py-2.5 text-[13px] outline-none`}
              />
            </div>

            <select
              value={composeItemCategory}
              onChange={(e) => setComposeItemCategory(e.target.value)}
              className={`mt-2.5 w-full rounded-xl border ${t.hair} px-3 py-2.5 text-[13px] outline-none`}
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

            <div className="mt-2.5 flex gap-2">
              {['AM', 'PM'].map((slot) => (
                <button
                  key={slot}
                  type="button"
                  onClick={() => setComposeItemSlot(slot)}
                  className={`flex-1 rounded-xl border px-3 py-2.5 text-[13px] font-semibold ${
                    composeItemSlot === slot ? `${t.chip} border-transparent` : `${t.hair} ${t.muted}`
                  }`}
                >
                  {slot}
                </button>
              ))}
            </div>

            <div className="mt-2.5 flex justify-between">
              {[['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6], ['Sun', 0]].map(([label, day]) => {
                const selected = composeItemDays.includes(day)
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() =>
                      setComposeItemDays((current) =>
                        current.includes(day) ? current.filter((d) => d !== day) : [...current, day]
                      )
                    }
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold ${
                      selected ? `${t.chip} border-transparent` : `border ${t.hair} ${t.muted}`
                    }`}
                  >
                    {label[0]}
                  </button>
                )
              })}
            </div>

            <input
              type="text"
              placeholder="Why this product? (optional)"
              value={composeItemReason}
              onChange={(e) => setComposeItemReason(e.target.value)}
              className={`mt-2.5 w-full rounded-xl border ${t.hair} px-3 py-2.5 text-[13px] outline-none`}
            />

            <button
              type="button"
              onClick={addComposeItem}
              className={`mt-2.5 w-full rounded-xl py-2.5 text-[13px] font-bold ${t.btn}`}
            >
              + Add product
            </button>
          </div>
        </div>

        <div className={`mt-4 rounded-3xl ${t.surface} p-5`}>
          <label className={`mb-2 block text-[13px] font-semibold ${t.faint}`}>
            Notes for your client
          </label>
          <textarea
            placeholder='e.g. "Use sunscreen daily. Introduce actives slowly."'
            value={composeNote}
            onChange={(e) => setComposeNote(e.target.value)}
            rows={3}
            className={`w-full rounded-2xl border ${t.hair} px-4 py-3.5 text-[15px] outline-none`}
          />
        </div>

        <button
          onClick={submitRecommendation}
          disabled={composeSaving}
          className={`mt-6 w-full rounded-2xl py-3.5 text-[15px] font-bold ${t.btn} disabled:opacity-60`}
        >
          {composeSaving ? 'Sending…' : 'Share Routine'}
        </button>

      </div>
    </main>
  )
}
if (screen === 'practitionerRoutines') {
  const FILTERS = [
    ['all', 'All'],
    ['proposed', 'Sent'],
    ['accepted', 'Accepted'],
    ['declined', 'Declined'],
    ['superseded', 'Withdrawn'],
  ]

  const filtered = recommendationsFilter === 'all'
    ? practitionerRecommendations
    : practitionerRecommendations.filter((r) => r.status === recommendationsFilter)

  const STATUS_LABEL = {
    proposed: 'Sent — awaiting response',
    accepted: 'Accepted',
    declined: 'Declined',
    superseded: 'Withdrawn',
  }

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-10 pt-7">

        <button
          onClick={() => setScreen('practitionerDashboard')}
          className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Dashboard
        </button>

        <div className="mt-5">
          <h1 className="font-display text-[34px] font-light leading-[1.05] tracking-tight">
            Routines
          </h1>
        </div>

        <div className="mt-5 flex gap-2 overflow-x-auto">
          {FILTERS.map(([value, label]) => (
            <button
              key={value}
              onClick={() => setRecommendationsFilter(value)}
              className={`shrink-0 rounded-full px-3.5 py-2 text-[13px] font-semibold ${
                recommendationsFilter === value ? `${t.chip} border-transparent` : `border ${t.hair} ${t.muted}`
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {practitionerRecommendationsLoading ? (
          <p className={`mt-8 text-[13px] ${t.muted}`}>Loading…</p>
        ) : filtered.length === 0 ? (
          <p className={`mt-8 text-[13px] leading-relaxed ${t.muted}`}>
            Nothing here yet.
          </p>
        ) : (
          <div className="mt-6 flex flex-col gap-3">
            {filtered.map((rec) => (
              <div key={rec.id} className={`rounded-2xl ${t.surface} p-4`}>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[15px] font-semibold">{rec.profiles?.username || 'Client'}</p>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${t.chip}`}>
                    {STATUS_LABEL[rec.status] || rec.status}
                  </span>
                </div>
                <p className={`mt-1 text-[12px] ${t.muted}`}>
                  {new Date(rec.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
                {rec.note && (
                  <p className={`mt-2 text-[13px] italic ${t.faint}`}>"{rec.note}"</p>
                )}
              </div>
            ))}
          </div>
        )}

      </div>
    </main>
  )
}
if (screen === 'today') {
  const amSteps = amPlan.steps

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

      <div className={`${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex w-full max-w-md flex-col px-6 pt-7">

        <div className="relative">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setMenuOpen(!menuOpen)}
            className={`absolute right-0 top-1 flex h-14 w-14 items-center justify-center rounded-full ${t.chip}`}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>

          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-[5]"
                aria-hidden="true"
                onClick={() => setMenuOpen(false)}
              />

              <div className={`absolute right-0 top-16 z-10 w-52 overflow-hidden rounded-2xl ${t.surface} shadow-xl`}>
                {[
                  ['My routine', 'routinePlanner'],
                  ['My progress', 'progress'],
                  ['Skin reports', 'skinTrends'],
                  ['Progress photos', 'progressPhotos'],
                ].map(([label, target]) => (
                  <button
                    key={target}
                    onClick={() => {
                      setMenuOpen(false)
                      setScreen(target)
                    }}
                    className={`block w-full px-5 py-3.5 text-left text-[15px] ${t.muted}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="mt-1 pr-16">
            <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
              Today
            </p>

            <h1 className="mt-1.5 font-display text-[44px] font-light leading-[1.02] tracking-tight">
              Hello, {displayName}
            </h1>

            {!onboardingCompleted && (
              <button
                onClick={() => setScreen('routinePlanner')}
                className={`mt-2 inline-block rounded-full px-2.5 py-1 text-[11px] font-semibold ${t.chip}`}
              >
                Complete your profile →
              </button>
            )}

          <p className={`mt-2 text-[15px] leading-relaxed ${t.muted}`}>
            Here's your skincare routine for today
          </p>

          <p className={`mt-2.5 text-sm ${t.muted}`}>
            {new Date(todayString + 'T00:00:00').toLocaleDateString('en-GB', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </p>
          </div>
        </div>

        {(() => {
          const pendingInvites = careRelationships.filter((r) => r.status === 'invited')
          const totalPending = pendingRecommendations.length + pendingInvites.length
          if (totalPending === 0) return null

          const label =
            pendingRecommendations.length > 0 && pendingInvites.length === 0
              ? pendingRecommendations.length === 1
                ? `${pendingRecommendations[0].practitioners?.display_name || 'A professional'} sent you a routine`
                : `${pendingRecommendations.length} new recommendations waiting`
              : pendingInvites.length > 0 && pendingRecommendations.length === 0
              ? pendingInvites.length === 1
                ? `${pendingInvites[0].practitioners?.display_name || 'A professional'} wants to connect`
                : `${pendingInvites.length} professionals want to connect`
              : `${totalPending} things need your attention`

          return (
            <button
              onClick={() => setScreen('notifications')}
              className={`mt-5 flex w-full items-center justify-between rounded-2xl ${t.chip} px-4 py-3.5 text-left`}
            >
              <span className="text-[14px] font-semibold">{label}</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )
        })()}

        <div className="mt-10">
          <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
            Morning
          </p>

          <h2 className="mt-1 font-display text-[28px] font-light leading-[1.05] tracking-tight">
            AM Routine
          </h2>

          <div className="mt-6">
            {routinesLoading ? (
              <p className={`text-sm ${t.muted}`}>Getting your routine…</p>
            ) : !todayAmRoutine ? (
              <div>
                <p className={`text-[15px] leading-relaxed ${t.muted}`}>
                  You haven't set up a morning routine yet.
                </p>
                <button
                  onClick={() => {
                    showLocalNotification('New product alert 👀', 'Remember: introduce slowly.')
                    setScreen('routinePlanner')
                  }}
                  className={`mt-5 rounded-2xl px-5 py-3.5 text-[15px] font-bold ${t.btn}`}
                >
                  Build my routine
                </button>
              </div>
            ) : (
              renderSteps(amSteps, t)
            )}
          </div>

          {amIngredientWarnings.length > 0 && (
            <div className={`mt-4 flex flex-col gap-2.5 rounded-2xl border ${t.hair} p-4`}>
              {amIngredientWarnings.map((w, i) => (
                <div key={i}>
                  <p className="text-[13px] font-semibold">
                    {w.ingredientA} + {w.ingredientB}
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${t.chip}`}>
                      {w.relationship}
                    </span>
                  </p>
                  <p className={`mt-0.5 text-[13px] leading-relaxed ${t.muted}`}>{w.message}</p>
                </div>
              ))}
            </div>
          )}

          {todayAmRoutine && !routinesLoading && (
            <div className="mt-7 flex flex-col gap-3.5">
              <p className={`text-[13px] ${t.faint}`}>
                {amDone} of {amSteps.length} done
              </p>

              <button
                onClick={() => {
                  if (amSteps.length > 0 && amDone === 0) {
                    notify('Tick off at least one step first.')
                    return
                  }
                  finishRoutine('AM')
                }}
                className={`w-full rounded-2xl py-[18px] text-base font-bold ${t.btn}`}
              >
                Complete morning routine
              </button>
            </div>
          )}
        </div>

      </div>
      </div>

      <div className={`${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex w-full max-w-md flex-col px-6 pb-28">
          <div className={`mt-10 border-t ${t.hair}`} aria-hidden="true" />

          <p className={`mt-10 text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
            Night
          </p>

          <h2 className="mt-1 font-display text-[28px] font-light leading-[1.05] tracking-tight">
            PM Routine
          </h2>

          {(() => {
            const held = nightPlan.skipped.filter((s) => s.reason === 'restricted')
            if (held.length === 0) return null

            return (
              <div className={`mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4`}>
                <p className="text-[13px] font-semibold text-amber-300">
                  Held back: {held.map((s) => s.step.name).join(', ')}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-amber-200/90">
                  {PREGNANCY_NOTE}
                </p>
              </div>
            )
          })()}

          <div className="mt-6">
            {routinesLoading ? (
              <p className={`text-sm ${t.muted}`}>Getting your routine…</p>
            ) : !todayPmRoutine ? (
              <div>
                <p className={`text-[15px] leading-relaxed ${t.muted}`}>
                  You haven't set up a night routine yet.
                </p>
                <button
                  onClick={() => {
                    showLocalNotification('New product alert 👀', 'Remember: introduce slowly.')
                    setScreen('routinePlanner')
                  }}
                  className={`mt-5 rounded-2xl px-5 py-3.5 text-[15px] font-bold ${t.btn}`}
                >
                  Build my routine
                </button>
              </div>
            ) : (
              <>
                {renderSteps(pmSteps, t)}
              </>
            )}
          </div>

          {pmIngredientWarnings.length > 0 && (
            <div className={`mt-4 flex flex-col gap-2.5 rounded-2xl border ${t.hair} p-4`}>
              {pmIngredientWarnings.map((w, i) => (
                <div key={i}>
                  <p className="text-[13px] font-semibold">
                    {w.ingredientA} + {w.ingredientB}
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${t.chip}`}>
                      {w.relationship}
                    </span>
                  </p>
                  <p className={`mt-0.5 text-[13px] leading-relaxed ${t.muted}`}>{w.message}</p>
                </div>
              ))}
            </div>
          )}

          {todayPmRoutine && !routinesLoading && (
            <div className="mt-7 flex flex-col gap-3.5">
              <p className={`text-[13px] ${t.faint}`}>
                {pmDone} of {pmSteps.length} done
              </p>

              <button
                onClick={() => {
                  if (pmSteps.length > 0 && pmDone === 0) {
                    notify('Tick off at least one step first.')
                    return
                  }
                  finishRoutine('PM')
                }}
                className={`w-full rounded-2xl py-[18px] text-base font-bold ${t.btn}`}
              >
                Complete night routine
              </button>
            </div>
          )}

        <div className={`mt-8 rounded-3xl ${t.surface} p-5`}>
          <h2 className={`text-[15px] font-semibold ${t.text}`}>
            Daily notes
          </h2>

          <p className={`mt-1 text-[13px] ${t.muted}`}>
            How's your skin today? Jot anything worth remembering.
          </p>

          <textarea
            key={todayString}
            ref={todayNoteRef}
            defaultValue={todaySkinLog.note || ''}
            placeholder="You can talk about your day, skin, product or anything else"
            rows={3}
            className={`mt-4 w-full rounded-xl border ${t.hair} p-3 text-[14px] outline-none`}
          />

          <button
            onClick={() => saveTodayNote(todayNoteRef.current?.value || '')}
            className={`mt-3 w-full rounded-2xl py-3 text-[14px] font-bold ${t.btn}`}
          >
            Save note
          </button>

          <button
            onClick={() => setScreen('progressPhotos')}
            className={`mt-2.5 flex w-full items-center justify-center gap-2 rounded-2xl border py-3 text-[14px] font-semibold ${t.hair} ${t.muted}`}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 8a2 2 0 0 1 2-2h1.2l.8-1.6A1 1 0 0 1 8.9 4h6.2a1 1 0 0 1 .9.6L16.8 6H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
            Selfie check-in
          </button>
        </div>

        {monthlyReport && (
          <div className={`mt-4 rounded-3xl ${t.surface} p-5`}>
            <div className="flex items-center justify-between">
              <h2 className={`text-[15px] font-semibold ${t.text}`}>
                {monthlyReport.monthLabel} report
              </h2>
              <button
                onClick={() => setScreen('skinTrends')}
                className={`text-[12px] font-semibold ${t.mark}`}
              >
                View full report
              </button>
            </div>

            <div className="mt-4 flex gap-5">
              <div>
                <p className="font-display text-[26px] font-light">
                  {monthlyReport.routineCompletionPct}%
                </p>
                <p className={`text-[11px] ${t.faint}`}>Routine completion</p>
              </div>
              <div>
                <p className="font-display text-[26px] font-light">
                  {monthlyReport.currentStreak}
                </p>
                <p className={`text-[11px] ${t.faint}`}>Current streak</p>
              </div>
              <div>
                <p className="font-display text-[26px] font-light">
                  {monthlyReport.photosAdded}
                </p>
                <p className={`text-[11px] ${t.faint}`}>Photos added</p>
              </div>
            </div>

            <button
              disabled={reportSharing}
              onClick={shareSkinReport}
              className={`mt-4 w-full rounded-2xl border py-3 text-[14px] font-semibold ${t.hair} ${t.muted} disabled:opacity-60`}
            >
              {reportSharing ? 'Preparing…' : 'Save report'}
            </button>
          </div>
        )}

      </div>
      </div>

      {renderBottomTabs('today', t)}
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
            disabled={busyAction === 'routineHistory'}
            onClick={() =>
              runBusy('routineHistory', async () => {
                await loadRoutineHistory()
                setScreen('routineHistory')
              })
            }
            className={`rounded-2xl border px-4 py-2.5 text-[13px] font-semibold ${t.hair} ${t.muted} disabled:opacity-50`}
          >
            {busyAction === 'routineHistory' ? 'Loading…' : 'History'}
          </button>
        </div>

        <div className="mt-5">
          <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
            Step 3 of 3
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
                      How often? <span className="font-normal">(choose the days you want to use this product)</span>
                    </label>

                    <div className="mt-2 flex flex-wrap gap-2">
                      {[
                        ['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4],
                        ['Fri', 5], ['Sat', 6], ['Sun', 0],
                      ].map(([label, day]) => {
                        const selectedDays = productDays[item.id] || []
                        const selected = selectedDays.includes(day)

                        return (
                          <button
                            key={day}
                            type="button"
                            onClick={() =>
                              setProductDays((current) => {
                                const currentDays = current[item.id] || []
                                return {
                                  ...current,
                                  [item.id]: currentDays.includes(day)
                                    ? currentDays.filter((d) => d !== day)
                                    : [...currentDays, day],
                                }
                              })
                            }
                            className={`flex h-9 w-9 items-center justify-center rounded-full text-[12px] font-semibold transition ${
                              selected
                                ? `${t.chip} border border-transparent`
                                : `border ${t.hair} ${t.muted}`
                            }`}
                          >
                            {label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              ))
            )}

          </div>
        </div>

        <button
  disabled={routineSaving}
  onClick={async () => {
    // Same double-tap guard as Add product — without it, a second tap
    // while routines/routine_steps were still being inserted created a
    // second full set, which then doubled up in routine history views.
    if (routineSaving) return

    if (products.length === 0) {
      notify('Please add at least one product.')
      return
    }

    const missingTime = products.find(
  (item) => !productTimes[item.id]
)

if (missingTime) {
  notify('Please choose a time for every product.')
  return
}

const missingDays = products.find(
  (item) => !productDays[item.id] || productDays[item.id].length === 0
)

if (missingDays) {
  notify('Please choose at least one day for every product.')
  return
}

    if (!user) {
      notify('Please log in first.')
      return
    }

    setRoutineSaving(true)

    const routineCode = `TRK-${Date.now().toString().slice(-6)}`

    const buildSteps = (time) =>
      products
        .filter((item) => {
          const selectedTime = productTimes[item.id]
          return selectedTime === time || selectedTime === 'BOTH'
        })
        .map((item, index) => ({
          user_product_id: item.id,
          step_order: index + 1,
          step_name: item.products?.name || 'Skincare product',
          frequency: 'daily',
          days_of_week: productDays[item.id] || [0, 1, 2, 3, 4, 5, 6],
        }))

    // A dropped connection surfaces here as a raw fetch error ("TypeError:
    // Load failed" on Safari/WebKit, "Failed to fetch" on Chrome) rather
    // than a structured Postgrest error — not something to show verbatim,
    // and on a weak mobile connection often clears up in a couple of
    // seconds. One silent retry before bothering the user with anything.
    const isNetworkError = (err) =>
      err instanceof TypeError || /load failed|failed to fetch|network/i.test(err.message || '')

    // One DB function doing deactivate-old + insert-new in a single
    // transaction, instead of two separate requests from the client — a
    // dropped connection between them used to leave someone with no
    // active routine at all despite their products still being there.
    // Safe to retry even if the first attempt actually landed server-side
    // before the response was lost: create_routine always deactivates
    // whatever's currently active first, so re-running it with the same
    // steps just re-creates the same end state.
    let { error } = await supabase.rpc('create_routine', {
      p_routine_code: routineCode,
      p_am_steps: buildSteps('AM'),
      p_pm_steps: buildSteps('PM'),
    })

    if (error && isNetworkError(error)) {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      ;({ error } = await supabase.rpc('create_routine', {
        p_routine_code: routineCode,
        p_am_steps: buildSteps('AM'),
        p_pm_steps: buildSteps('PM'),
      }))
    }

    setRoutineSaving(false)

    if (error) {
      notify(
        isNetworkError(error)
          ? "Couldn't save your routine — check your connection and try again."
          : 'Could not save your routine: ' + error.message
      )
      return
    }

    showLocalNotification(
      `Your routine is ready, ${displayName}`,
      'Time to stay consistent.'
    )

    if (!onboardingCompleted) {
      setOnboardingCompleted(true)
      if (user) {
        await supabase
          .from('profiles')
          .update({ onboarding_completed: true })
          .eq('id', user.id)
      }
    }

    setScreen('today')
    loadRoutines()
  }}
  className={`mt-6 w-full rounded-2xl py-[18px] text-base font-bold ${t.btn} disabled:opacity-60`}
>
  {routineSaving ? 'Saving…' : 'Create my routine'}
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
  const isPm = lastCompletedSlot === 'PM'
  const milestone = isPm && isMilestoneStreak(currentStreak)
  const tonightSteps = nightPlan.steps.filter((step) => completedSteps.includes(step.id))
  const morningSteps = amPlan.steps.filter((step) => completedSteps.includes(step.id))
  const slotSteps = isPm ? tonightSteps : morningSteps
  const slotLabel = isPm ? 'Night Routine' : 'Morning Routine'
  const badgeColor = milestone ? flameColorForStreak(currentStreak) : (isNight ? '#8FB8E8' : '#2554EB')

  // Monday-start week, same convention the Progress calendar uses, so
  // "today" here lines up with what the calendar shows there.
  const weekDates = (() => {
    const dow = dayOfWeek(todayString)
    const monday = addDays(todayString, dow === 0 ? -6 : 1 - dow)
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  })()

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-6 pb-6 pt-7 text-center">

        {milestone ? (
          <div className="relative flex h-36 w-36 items-center justify-center">
            <span
              className="animate-glow-burst absolute inset-0 rounded-full blur-2xl"
              style={{ backgroundColor: badgeColor }}
              aria-hidden="true"
            />

            <svg className="animate-pop-in relative" width="136" height="136" viewBox="0 0 24 24">
              <defs>
                <radialGradient id="flame-body-grad" cx="50%" cy="62%" r="65%">
                  <stop offset="0%" stopColor={lighten(badgeColor, 0.5)} />
                  <stop offset="60%" stopColor={badgeColor} />
                  <stop offset="100%" stopColor={darken(badgeColor, 0.15)} />
                </radialGradient>
                <radialGradient id="flame-core-grad" cx="50%" cy="60%" r="60%">
                  <stop offset="0%" stopColor={lighten(badgeColor, 0.85)} />
                  <stop offset="100%" stopColor={lighten(badgeColor, 0.4)} />
                </radialGradient>
              </defs>

              <path d={FLAME_PATH} transform="translate(12 12) scale(1.08) translate(-12 -12)" fill={darken(badgeColor, 0.35)} />
              <path d={FLAME_PATH} fill="url(#flame-body-grad)" />
              <path d={FLAME_PATH} transform="translate(12.4 15.5) scale(0.42 0.5) translate(-12 -12)" fill="url(#flame-core-grad)" />
              <ellipse cx="9.3" cy="7.5" rx="1.6" ry="2.4" transform="rotate(-28 9.3 7.5)" fill="rgba(255,255,255,0.55)" />
            </svg>
          </div>
        ) : (
          <div className="relative flex h-14 w-14 items-center justify-center">
            <span
              className="animate-glow-burst absolute inset-0 rounded-full blur-xl"
              style={{ backgroundColor: badgeColor }}
              aria-hidden="true"
            />

            <span className={`animate-pop-in relative flex h-14 w-14 items-center justify-center rounded-full text-2xl ${t.chip}`}>
              ✓
            </span>
          </div>
        )}

        <h1 className="animate-rise-in mt-6 font-display text-[44px] font-light leading-[1.02] tracking-tight">
          {milestone
            ? `${currentStreak} Day Streak`
            : isPm ? 'Routine complete' : 'All done for the morning'}
        </h1>

        <p className={`animate-rise-in mt-3 max-w-[280px] text-[15px] leading-relaxed ${t.muted}`}>
          {milestone
            ? 'Look at you go. That kind of consistency shows.'
            : <>Great job taking care of your skin. See you {isPm ? 'in the morning' : 'tonight'} 👋</>}
        </p>

        {isPm && (
          <div className="animate-rise-in mt-6 flex items-center gap-2.5">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, i) => {
              const date = weekDates[i]
              const isToday = date === todayString
              const finished = completedDates.has(date)

              return (
                <div key={date} className="flex flex-col items-center gap-1.5">
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold ${
                      isToday && finished
                        ? ''
                        : finished
                          ? t.chip
                          : `${t.rail} ${t.faint}`
                    }`}
                    style={isToday && finished ? { backgroundColor: `${badgeColor}26` } : undefined}
                  >
                    {isToday && finished ? (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill={badgeColor}>
                        <path d={FLAME_PATH} />
                      </svg>
                    ) : finished ? (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2.6"
                        strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 12.5l5.2 5.2L20 7" />
                      </svg>
                    ) : null}
                  </span>
                  <span className={`text-[10px] font-semibold ${t.faint}`}>{label}</span>
                </div>
              )
            })}
          </div>
        )}

        <button
          disabled={shareStreakBusy}
          onClick={() => shareStreak(currentStreak, slotSteps, slotLabel)}
          className={`mt-8 flex w-full items-center justify-center gap-2 rounded-2xl py-[18px] text-base font-bold ${t.btn} disabled:opacity-60`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 15V4M12 4l-4 4M12 4l4 4" />
            <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
          </svg>
          {shareStreakBusy ? 'Preparing…' : 'Share my streak'}
        </button>

        <div className="mt-3 grid w-full grid-cols-2 gap-3">
          <button
            onClick={inviteFriend}
            className={`flex items-center justify-center gap-2 rounded-2xl border py-3.5 text-[14px] font-semibold ${t.hair} ${t.muted}`}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="8" r="3.5" />
              <path d="M3.5 20v-1a5.5 5.5 0 0 1 5.5-5.5h0" />
              <path d="M18 8v6M15 11h6" />
            </svg>
            Invite
          </button>

          <button
            onClick={() => setScreen('progress')}
            className={`flex items-center justify-center gap-2 rounded-2xl border py-3.5 text-[14px] font-semibold ${t.hair} ${t.muted}`}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill={flameColorForStreak(currentStreak)}>
              <path d={FLAME_PATH} />
            </svg>
            Streak
          </button>
        </div>

      </div>
    </main>
  )
}
if (screen === 'progress') {
  const now = new Date()
  const displayedMonth = new Date(now.getFullYear(), now.getMonth() + progressMonthOffset, 1)
  const year = displayedMonth.getFullYear()
  const month = displayedMonth.getMonth()
  const isCurrentCalendarMonth = progressMonthOffset === 0
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstWeekday = new Date(year, month, 1).getDay()
  const leadingBlanks = firstWeekday === 0 ? 6 : firstWeekday - 1

  const stepDays = new Set(stepHistory.map((entry) => entry.local_date))

  // completedDates holds every completion ever (needed for the streak
  // calculation above, which has to look arbitrarily far back) — the "X of
  // Y days" stat used to show its all-time size next to this month's
  // elapsed-day count, which is why it read as nonsense like "9 of 1 days".
  // Scoped to just the displayed month here instead.
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`
  const completedThisDisplayedMonth = [...completedDates].filter((d) => d.startsWith(monthPrefix)).length
  const daysElapsedInDisplayedMonth = isCurrentCalendarMonth ? now.getDate() : daysInMonth

  // todayString is shifted 4 hours for completion-tracking (so a 1am night
  // routine still counts toward "yesterday" instead of resetting early) —
  // right for isToday's highlight, wrong for "has this day happened yet."
  // Between midnight and 4am on the 1st, todayString still points at
  // yesterday while the real calendar has already turned over, which made
  // today's own cell read as "this day hasn't happened yet." This uses the
  // actual wall-clock date instead, just for that distinction.
  const calendarTodayString = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

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
            <svg width="14" height="14" viewBox="0 0 24 24" fill={flameColorForStreak(currentStreak)}>
              <path d={FLAME_PATH} />
            </svg>
            Current streak
          </p>

          <h2 className="mt-1 font-display text-[40px] font-light leading-[0.95] tracking-tight">
            {currentStreak} {currentStreak === 1 ? 'day' : 'days'}
          </h2>

          <p className={`mt-2 text-[14px] leading-relaxed ${t.muted}`}>
            {streakMessage(currentStreak)}
          </p>

          {currentStreak > 0 && (
            <button
              disabled={shareStreakBusy}
              onClick={() =>
                shareStreak(
                  currentStreak,
                  nightPlan.steps.filter((step) => completedSteps.includes(step.id))
                )
              }
              className={`mt-4 w-full rounded-2xl py-3.5 text-[14px] font-bold ${t.btn} disabled:opacity-60`}
            >
              {shareStreakBusy ? 'Preparing…' : 'Share my streak'}
            </button>
          )}
        </div>

        <div className={`mt-4 rounded-3xl ${t.surface} px-5 py-6`}>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setProgressMonthOffset((o) => o - 1)}
              className={`flex h-8 w-8 items-center justify-center rounded-full ${t.chip}`}
              aria-label="Previous month"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </button>

            <span className="font-display text-[22px]">
              {displayedMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
            </span>

            <button
              type="button"
              disabled={isCurrentCalendarMonth}
              onClick={() => setProgressMonthOffset((o) => o + 1)}
              className={`flex h-8 w-8 items-center justify-center rounded-full ${t.chip} disabled:opacity-30`}
              aria-label="Next month"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          <p className={`mt-1 text-center text-[13px] ${t.faint}`}>
            {completedThisDisplayedMonth} of {daysElapsedInDisplayedMonth} days
          </p>

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
              const future = key > calendarTodayString

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
                    : selectedProgressDate > calendarTodayString
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
                      {selectedProgressDate > calendarTodayString
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
  const report = monthlyReport
  const STAT_ROWS = report
    ? [
        ['Routine completion', `${report.routineCompletionPct}%`],
        ['Sunscreen days', String(report.sunscreenDays)],
        ['Products used', String(report.productsUsed)],
        ['Current streak', `${report.currentStreak} ${report.currentStreak === 1 ? 'day' : 'days'}`],
        ['Longest streak', `${report.longestStreak} ${report.longestStreak === 1 ? 'day' : 'days'}`],
        ['AM vs PM consistency', report.amVsPm],
        ['Progress photos added', String(report.photosAdded)],
      ]
    : []

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
          <div className="flex items-center justify-between">
            <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
              {report?.monthLabel || 'This month'}
            </p>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  const next = reportMonthOffset - 1
                  setReportMonthOffset(next)
                  loadMonthlyReport(next)
                }}
                className={`flex h-8 w-8 items-center justify-center rounded-full ${t.chip}`}
                aria-label="Previous month"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 5l-7 7 7 7" />
                </svg>
              </button>
              <button
                type="button"
                disabled={reportMonthOffset >= 0}
                onClick={() => {
                  const next = reportMonthOffset + 1
                  setReportMonthOffset(next)
                  loadMonthlyReport(next)
                }}
                className={`flex h-8 w-8 items-center justify-center rounded-full ${t.chip} disabled:opacity-30`}
                aria-label="Next month"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>

          <h1 className="mt-1.5 font-display text-[36px] font-light leading-[1.05] tracking-tight">
            Skin reports
          </h1>

          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            See how you showed up for your skin this month.
          </p>
        </div>

        {monthlyReportLoading && !report ? (
          <p className={`mt-8 text-[13px] ${t.muted}`}>Getting your report…</p>
        ) : !report ? (
          <p className={`mt-8 text-[13px] leading-relaxed ${t.muted}`}>
            Nothing to report yet — complete a routine or two to see numbers here.
          </p>
        ) : (
          <>
            <div className={`mt-8 rounded-3xl ${t.surface} p-5`}>
              {STAT_ROWS.map(([label, value], i) => (
                <div
                  key={label}
                  className={`flex items-center justify-between py-3.5 ${
                    i < STAT_ROWS.length - 1 ? `border-b ${t.hair}` : ''
                  }`}
                >
                  <span className={`text-[13px] ${t.muted}`}>{label}</span>
                  <span className="font-display text-[22px] font-light">{value}</span>
                </div>
              ))}
            </div>

            <button
              disabled={reportSharing}
              onClick={shareSkinReport}
              className={`mt-6 w-full rounded-2xl py-[18px] text-base font-bold ${t.btn} disabled:opacity-60`}
            >
              {reportSharing ? 'Preparing…' : 'Save report'}
            </button>
          </>
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

  // One combined, date-sorted timeline — a day can have a photo, a diary
  // note, or both. Keyed by date so a day with both merges into one entry
  // instead of showing twice.
  const journeyByDate = new Map()

  for (const photo of progressPhotos) {
    journeyByDate.set(photo.local_date, { ...photo, local_date: photo.local_date, hasPhoto: true })
  }

  for (const log of skinLogs) {
    if (!log.note?.trim()) continue
    const existing = journeyByDate.get(log.local_date)
    if (existing) {
      existing.diaryNote = log.note
    } else {
      journeyByDate.set(log.local_date, {
        local_date: log.local_date,
        hasPhoto: false,
        diaryNote: log.note,
      })
    }
  }

  const journeyEntries = [...journeyByDate.values()].sort((a, b) =>
    b.local_date.localeCompare(a.local_date)
  )

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
                disabled={photoUploading}
                onClick={async () => {
                  await uploadProgressPhoto(pendingPhoto.file, pendingPhoto.date)
                  URL.revokeObjectURL(pendingPhoto.previewUrl)
                  setPendingPhoto(null)
                }}
                className={`flex-1 rounded-2xl py-3 text-[14px] font-bold ${t.btn} disabled:opacity-60`}
              >
                {photoUploading ? 'Saving…' : 'Save photo'}
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
              <p className={`text-[12px] ${t.faint}`}>Tap a photo to compare</p>
            )}
          </div>

          {journeyEntries.length === 0 ? (
            <p className={`mt-3 text-[13px] leading-relaxed ${t.muted}`}>
              Nothing yet. Take a photo or add a note from Today to start tracking your skin's journey.
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-2.5">
              {journeyEntries.map((entry) => (
                <button
                  key={entry.local_date}
                  onClick={() => {
                    setPhotoError(null)
                    setViewingPhoto(entry)
                  }}
                  className={`flex w-full items-start gap-3 rounded-2xl border ${t.hair} p-3 text-left`}
                >
                  <div className="relative shrink-0">
                    {entry.hasPhoto ? (
                      <div className={`h-14 w-14 overflow-hidden rounded-xl ${t.chip}`}>
                        {photoUrls[entry.path] && (
                          <img src={photoUrls[entry.path]} alt="" className="h-full w-full object-cover" />
                        )}
                      </div>
                    ) : (
                      <div className={`flex h-14 w-14 items-center justify-center rounded-xl ${t.chip}`}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                          stroke="currentColor" strokeWidth="1.8"
                          strokeLinecap="round" strokeLinejoin="round" className={t.mark}>
                          <path d="M4 6h16M4 12h10M4 18h7" />
                        </svg>
                      </div>
                    )}

                    {entry.hasPhoto && (
                      <span
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleCompare(entry.id)
                        }}
                        className={`absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                          comparePhotos.includes(entry.id) ? t.nodeDone : 'bg-black/30 text-white'
                        }`}
                      >
                        {comparePhotos.includes(entry.id) ? comparePhotos.indexOf(entry.id) + 1 : ''}
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className={`text-[12px] font-semibold ${t.faint}`}>
                      {new Date(entry.local_date + 'T00:00:00').toLocaleDateString('en-GB', {
                        weekday: 'short', day: 'numeric', month: 'short',
                      })}
                    </p>
                    {entry.diaryNote && (
                      <p className="mt-0.5 truncate text-[13px] leading-snug">
                        {entry.diaryNote}
                      </p>
                    )}
                  </div>
                </button>
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

            {viewingPhoto.hasPhoto && photoUrls[viewingPhoto.path] && (
              <img src={photoUrls[viewingPhoto.path]} alt="" className="mt-4 max-h-[60vh] w-full rounded-2xl object-contain" />
            )}

            <p className="mt-4 text-center text-[14px] text-white/80">
              {new Date(viewingPhoto.local_date + 'T00:00:00').toLocaleDateString('en-GB', {
                weekday: 'long', day: 'numeric', month: 'long',
              })}
            </p>

            <textarea
              key={viewingPhoto.local_date}
              defaultValue={(viewingPhoto.hasPhoto ? viewingPhoto.note : viewingPhoto.diaryNote) || ''}
              onBlur={(e) =>
                viewingPhoto.hasPhoto
                  ? saveProgressPhotoNote(viewingPhoto, e.target.value)
                  : saveNoteForDate(viewingPhoto.local_date, e.target.value)
              }
              placeholder="Add a note about your skin..."
              rows={2}
              className="mt-4 w-full rounded-xl border border-white/20 bg-white/10 p-3 text-[13px] text-white placeholder-white/50"
            />

            {viewingPhoto.hasPhoto ? (
              <button
                disabled={busyAction === 'deletePhoto'}
                onClick={() => runBusy('deletePhoto', () => deleteProgressPhoto(viewingPhoto))}
                className="mt-6 text-[14px] font-semibold text-rose-400 disabled:opacity-50"
              >
                {busyAction === 'deletePhoto' ? 'Deleting…' : 'Delete photo'}
              </button>
            ) : (
              <button
                disabled={busyAction === 'deleteNote'}
                onClick={() =>
                  runBusy('deleteNote', async () => {
                    await saveNoteForDate(viewingPhoto.local_date, '')
                    setViewingPhoto(null)
                  })
                }
                className="mt-6 text-[14px] font-semibold text-rose-400 disabled:opacity-50"
              >
                {busyAction === 'deleteNote' ? 'Deleting…' : 'Delete note'}
              </button>
            )}

            {photoError && (
              <p className="mt-3 text-center text-[13px] text-rose-400">{photoError}</p>
            )}
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

        {hasPendingInvite && (
          <div className="mb-5 w-full rounded-2xl border border-[#2554EB]/20 bg-[#2554EB]/5 px-4 py-3.5">
            <p className="text-[14px] leading-relaxed text-[#101B2D]">
              You've been invited to connect with a professional. Log in or create an account to accept.
            </p>
          </div>
        )}

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
})()

  return (
    <>
      {screenContent}

      {toast && (
        <div className="fixed inset-x-0 bottom-28 z-50 flex justify-center px-6">
          <div
            className={`flex w-full max-w-md items-start gap-3 rounded-2xl border px-4 py-3.5 shadow-xl backdrop-blur ${
              toast.tone === 'success'
                ? `border-emerald-400/30 ${isNight ? 'bg-emerald-400/15' : 'bg-emerald-50'}`
                : `border-rose-400/30 ${isNight ? 'bg-rose-400/15' : 'bg-rose-50'}`
            }`}
          >
            <p
              className={`min-w-0 flex-1 break-words text-[14px] leading-relaxed ${
                toast.tone === 'success'
                  ? isNight ? 'text-emerald-300' : 'text-emerald-700'
                  : t.danger
              }`}
            >
              {toast.message}
            </p>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setToast(null)}
              className={`shrink-0 text-[13px] font-semibold opacity-70 ${
                toast.tone === 'success'
                  ? isNight ? 'text-emerald-300' : 'text-emerald-700'
                  : t.danger
              }`}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {confirmState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6">
          <div className={`w-full max-w-sm rounded-3xl p-6 ${t.surface}`}>
            <p className="text-[15px] leading-relaxed">{confirmState.message}</p>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  confirmState.resolve(false)
                  setConfirmState(null)
                }}
                className={`flex-1 rounded-2xl border px-4 py-3 text-[14px] font-semibold ${t.hair} ${t.muted}`}
              >
                {confirmState.labels?.[0] || 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => {
                  confirmState.resolve(true)
                  setConfirmState(null)
                }}
                className={`flex-1 rounded-2xl px-4 py-3 text-[14px] font-bold ${t.btn}`}
              >
                {confirmState.labels?.[1] || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default App