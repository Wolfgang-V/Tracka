import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { supabase, OPENED_FROM_RECOVERY_LINK } from './lib/supabase'
import { captureReferral, claimReferral } from './lib/referral'
// Screens most people never open load on demand, not in the main bundle.
const ReferralConsole = lazy(() => import('./screens/ReferralConsole'))
const AdsConsole = lazy(() => import('./screens/AdsConsole'))
const FeatureGuide = lazy(() => import('./screens/FeatureGuide'))
const AdminScreen = lazy(() => import('./screens/AdminScreen'))
import TodayScreen from './screens/TodayScreen'
import SignUpScreen from './screens/SignUpScreen'
import SkinProfileScreen from './screens/SkinProfileScreen'
import AddProductScreen from './screens/AddProductScreen'
const IngredientCheckerScreen = lazy(() => import('./screens/IngredientCheckerScreen'))
const FindProfessionalScreen = lazy(() => import('./screens/practitioner/FindProfessionalScreen'))
const CareTeamScreen = lazy(() => import('./screens/practitioner/CareTeamScreen'))
const ChallengeDetailScreen = lazy(() => import('./screens/ChallengeDetailScreen'))
const DiscoverScreen = lazy(() => import('./screens/DiscoverScreen'))
const ReferFriendScreen = lazy(() => import('./screens/ReferFriendScreen'))
const RemindersScreen = lazy(() => import('./screens/RemindersScreen'))
const SponsoredProductScreen = lazy(() => import('./screens/SponsoredProductScreen'))
const RecommendationHistoryScreen = lazy(() => import('./screens/practitioner/RecommendationHistoryScreen'))
const ApplyPractitionerScreen = lazy(() => import('./screens/practitioner/ApplyPractitionerScreen'))
const PractitionerDashboardScreen = lazy(() => import('./screens/practitioner/PractitionerDashboardScreen'))
const PractitionerClientDetailScreen = lazy(() => import('./screens/practitioner/PractitionerClientDetailScreen'))
const AddClientScreen = lazy(() => import('./screens/practitioner/AddClientScreen'))
const ComposeRecommendationScreen = lazy(() => import('./screens/practitioner/ComposeRecommendationScreen'))
const PractitionerRoutinesScreen = lazy(() => import('./screens/practitioner/PractitionerRoutinesScreen'))
import RoutinePlannerScreen from './screens/RoutinePlannerScreen'
import ProductsScreen from './screens/ProductsScreen'
import FullscreenAd from './ads/FullscreenAd'
import PhotoStreakShare from './share/PhotoStreakShare'
import { fetchAds, recordAdEvent, withUtm, isAdHidden, hideAd } from './lib/ads'
import { useProducts, useEmpties, PRODUCT_FIELDS } from './data/products'
import { useRoutines, getCompletedSteps, updateCompletedSteps } from './data/routine'
import { useChallenges, useLeaderboard, reloadLeaderboard } from './data/challenges'
import { useProgressPhotos, useSkinLogs, useStepHistory, useProgressCompletions } from './data/diary'
import { queryClient } from './data/queryClient'
import { planNight, localDateString, addDays, dayOfWeek } from './lib/core/planNight'
import { productExpiry } from './lib/core/expiry'
import { searchBrands, searchProducts } from './lib/core/openBeautyFacts'
import { searchNigerianProducts } from './lib/core/nigerianProducts'
import { calculateRoutineCompletion, calculateStreaks } from './lib/core/skinReport'
import { isMilestoneStreak } from './lib/milestones'
import { challengeAwards, METALS, CUP_SHAPES, MEDAL_SHAPES, LAUREL_LEAF, LAUREL_STAR, laurelLeaves, laurelStems } from './lib/core/awards'
import { flameColorForStreak, FLAME_PATH, lighten, darken } from './lib/core/flameColor'
const VAPID_PUBLIC_KEY =
  'BL4tLhVl-G91FsMmVh2rhGbynJeqh1U6L3fIrg-E0rhC7fMLavWVfPLNGOjyM8TQqGFWaLmPByvs_3k2A23KsFE'

// Fixed rather than window.location.origin — the old vercel.app URL still
// resolves alongside the custom domain, so a signup or password reset
// started from there would otherwise bake that domain into the email link.
// The one canonical host. www redirects here (Vercel), and auth links must
// land on this origin: the login session lives in its localStorage only.
const SITE_URL = 'https://trackaplus.app'
const DAILY_SKIN_TIPS = [
  ['Did you know?', 'SPF mainly measures protection against UVB, while broad-spectrum sunscreens also protect against UVA.'],
  ['Skin tip of the day', 'Broad-spectrum sunscreen protects against both UVA and UVB radiation.'],
  ['Did you know?', "A product's PAO symbol tells you how long it's intended to be used after opening."],
  ['Skin tip of the day', 'Leave active cleansers on your skin for 1-2 minutes before rinsing.'],
  ['Did you know?', "The order of your skincare can affect how products are layered, but you don't need a complicated 10-step routine."],
  ['Did you know?', 'Higher concentration does not automatically mean better results.'],
  ['Skin tip of the day', 'Wash your face for 30-60 seconds before rinsing.'],
]

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

// Where is this person running Tracka+? Drives the setup guide's
// instructions — the steps to install a PWA differ per platform/browser.
const getInstallEnv = () => {
  const ua = navigator.userAgent || ''
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isAndroid = /Android/i.test(ua)
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
  // In-app browsers (Instagram, Facebook, TikTok…) can't install anything —
  // the link has to be opened in the real browser first.
  const inAppBrowser = /FBAN|FBAV|Instagram|Line\/|Twitter|TikTok|Snapchat|musical_ly/i.test(ua)
  const iosSafari = isIOS && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) && !inAppBrowser
  const notifications = !('Notification' in window) ? 'unsupported' : Notification.permission
  return { isIOS, isAndroid, standalone, inAppBrowser, iosSafari, notifications }
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
  // True from the moment a password-reset link opens the app until the new
  // password is saved. Startup routing must not send the person anywhere
  // else meanwhile (it used to race and land them on onboarding/Today).
  const recoveryActiveRef = useRef(OPENED_FROM_RECOVERY_LINK)

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

  // The opening splash lives in index.html so it shows the instant the
  // app opens, before this code has even downloaded. Once its ~3s
  // animation has finished (index.html sets data-done) and the session is
  // known, fade it out and remove it.
  useEffect(() => {
    if (!authReady) return
    const splash = document.getElementById('splash')
    if (!splash) return
    let removeTimer
    const leave = () => {
      // Back to the app's own colours: page background and the phone's
      // status-bar tint were blue only for the splash (see index.html).
      document.documentElement.classList.remove('splashing')
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#FFFFFF')
      splash.classList.add('splash--leaving')
      removeTimer = window.setTimeout(() => splash.remove(), 450)
    }
    if (splash.dataset.done) leave()
    else splash.addEventListener('splashdone', leave, { once: true })
    return () => {
      splash.removeEventListener('splashdone', leave)
      window.clearTimeout(removeTimer)
    }
  }, [authReady])

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
  const [adminTab, setAdminTab] = useState('signups')
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
  const [profilePhotoPath, setProfilePhotoPath] = useState(null)
  const [profilePhotoUrl, setProfilePhotoUrl] = useState(null)
  const [profilePhotoUploading, setProfilePhotoUploading] = useState(false)
  // Sponsored placements (see the ads section near screenContent).
  const [homeAds, setHomeAds] = useState([])
  const lastAdClickRef = useRef(null)
  const guideAdRef = useRef(null)
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
  const [invitePreview, setInvitePreview] = useState(null) // { token, display_name, title, bio }
  const [invitePreviewBusy, setInvitePreviewBusy] = useState(false)
  // Parked feature: defaults to hidden (matches the flag's own default) so
  // a failed/slow fetch fails safe — never briefly shows "Become a
  // professional" to everyone before flipping it back off.
  const [practitionersLaunched, setPractitionersLaunched] = useState(false)
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
  // Product shot from the picked Open Beauty Facts suggestion, if any.
  const [productImageUrl, setProductImageUrl] = useState('')
  const [ingredientQuery, setIngredientQuery] = useState('')
  // Ingredient checker: 'product' breaks down one of your products (or a
  // pasted list); 'lookup' explains a single ingredient.
  const [checkerMode, setCheckerMode] = useState('product')
  const [checkerProductId, setCheckerProductId] = useState(null)
  const [checkerPasted, setCheckerPasted] = useState('')
  const [checkerShowAll, setCheckerShowAll] = useState(false)
  const [productOpenedDate, setProductOpenedDate] = useState('')
  const [productPaoMonths, setProductPaoMonths] = useState(0)
  const [productExpiryDate, setProductExpiryDate] = useState('')
  const [productSaving, setProductSaving] = useState(false)
  // Products and Empties live in the shared data cache (src/data/products).
  const { products, setProducts, reloadProducts } = useProducts(user?.id)
  // Finished products (Empties), signed photo URLs by storage path, which
  // product page is open, and which list sections are expanded.
  const { empties, setEmpties, loadEmpties } = useEmpties(user?.id)
  const [productPhotoUrls, setProductPhotoUrls] = useState({})
  const [selectedUserProductId, setSelectedUserProductId] = useState(null)
  // Per product, which weekdays (0=Sun..6=Sat) it's used on — this is the
  // whole schedule now, the separate frequency dropdown was folded into
  // it. Sent to the DB with frequency always 'daily', which combined with
  // planNight's cadence logic makes days_of_week the effective schedule.

  // Routine and today's ticks live in the shared data cache (src/data/routine).
  const {
    amRoutine: todayAmRoutine,
    pmRoutine: todayPmRoutine,
    amSteps: todayAmSteps,
    pmSteps: todayPmSteps,
    routinesLoading,
    setAmSteps: setTodayAmSteps,
    setPmSteps: setTodayPmSteps,
    reloadRoutines,
  } = useRoutines(user?.id)
  const [routineHistory, setRoutineHistory] = useState([])
  const [addProductReturnScreen, setAddProductReturnScreen] = useState('products')
  // Sponsored product page: the ad being viewed and where Back goes.
  const [adProduct, setAdProduct] = useState(null)
  const [adProductReturn, setAdProductReturn] = useState('discover')
  // Set while the add form was opened from a sponsored product, so saving
  // it counts as that ad's "added to My products".
  const adProductAddRef = useRef(null)
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
  // Today's ticks: only TodayScreen subscribes (so a tick re-renders Today,
  // not the whole app). App reads the current value when it needs it.
  const setCompletedSteps = (valueOrFn) => updateCompletedSteps(user?.id, valueOrFn)
  const [lastCompletedSlot, setLastCompletedSlot] = useState(null)
  const [shareStreakBusy, setShareStreakBusy] = useState(false)
  const [reportSharing, setReportSharing] = useState(false)
  const { stepHistory, loadStepHistory } = useStepHistory(user?.id)
  const [menuOpen, setMenuOpen] = useState(false)
  // Challenges and leaderboards live in the shared data cache (src/data/challenges).
  const { challenges, myChallenges, challengesLoading, reloadChallenges } = useChallenges(user?.id)
  const [selectedChallengeId, setSelectedChallengeId] = useState(null)
  const [challengeReturnScreen, setChallengeReturnScreen] = useState('challenges')
  const [challengeMenuOpen, setChallengeMenuOpen] = useState(false)
  const [showCompletedChallenges, setShowCompletedChallenges] = useState(false)
  // The completed participation being celebrated (full-screen cup), or null.
  const [celebration, setCelebration] = useState(null)
  const [awardSaving, setAwardSaving] = useState(null)
  const { leaderboard, leaderboardLoading } = useLeaderboard(selectedChallengeId)
  // Home-screen + reminders setup guide (most users never found either,
  // and stopped coming back).
  const [setupGuideOpen, setSetupGuideOpen] = useState(false)
  const [fullscreenAdsOn, setFullscreenAdsOn] = useState(false)
  const [installPromptEvent, setInstallPromptEvent] = useState(null)
  const [setupGuideStatus, setSetupGuideStatus] = useState(null)
  const setupGuideShownRef = useRef(false)
  const [pushStatus, setPushStatus] = useState(null)
  const { progressCompletions, setProgressCompletions } = useProgressCompletions(user?.id)
  const [selectedProgressDate, setSelectedProgressDate] = useState(null)
  const [dayDetailSteps, setDayDetailSteps] = useState(null)
  const [dayDetailLoading, setDayDetailLoading] = useState(false)
  const [progressMonthOffset, setProgressMonthOffset] = useState(0)
  const { skinLogs, setSkinLogs, loadSkinLogs } = useSkinLogs(user?.id)
  const [monthlyReport, setMonthlyReport] = useState(null)
  const [monthlyReportLoading, setMonthlyReportLoading] = useState(false)
  const [reportMonthOffset, setReportMonthOffset] = useState(0)
  // Diary photos, logs and history live in the shared data cache (src/data/diary).
  const { progressPhotos, setProgressPhotos, photoUrls, loadProgressPhotos } = useProgressPhotos(user?.id)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [photoError, setPhotoError] = useState(null)
  const [pendingPhoto, setPendingPhoto] = useState(null)
  const [comparePhotos, setComparePhotos] = useState([])
  const [viewingPhoto, setViewingPhoto] = useState(null)
  const [viewingPhotoNote, setViewingPhotoNote] = useState('')
  const diaryTouchStartRef = useRef(null)

  useEffect(() => {
    // These three only need a user id, not a fresh session lookup — each
    // used to call supabase.auth.getUser() itself, which is a network
    // round trip to revalidate the JWT. Four of those firing at once on
    // every mount (plus a fifth from checkUser) is what was slowing the
    // home screen down; now the caller resolves the session once and
    // hands the id in.
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

      // No longer auto-redeems. A token is the only credential this link
      // ever had — nothing stopped it from granting scopes to whoever
      // happened to tap it first, sight unseen, which matters most for an
      // unlisted practitioner nobody's heard of. This shows who's inviting
      // before anything is granted; accept_invitation only ever runs now
      // from an explicit tap on that preview.
      const { data, error } = await supabase.rpc('get_invitation_preview', { p_token: token })

      if (!error) {
        setInvitePreview({ token, ...data?.[0] })
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
      console.error('INVITE PREVIEW ERROR:', error)
    }

    const isRecoveryFlow = () => {
      const searchParams = new URLSearchParams(window.location.search)
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))

      return (
        searchParams.get('recovery') === 'true' ||
        searchParams.get('type') === 'recovery' ||
        hashParams.get('recovery') === 'true' ||
        hashParams.get('type') === 'recovery'
      )
    }

    const normalizeRecoveryFlow = () => {
      if (isRecoveryFlow()) {
        window.history.replaceState({}, '', window.location.pathname)
      }
    }

    // Referral QR (?ref=CODE): record the scan straight away, before anyone
    // signs in. Claiming waits for that to finish, so an already-signed-in
    // person who scans a flyer is attributed in the same visit.
    const referralCapture = captureReferral()
      .then((ref) => {
        if (ref?.friend) {
          notify(`Welcome! ${ref.inviter || 'A friend'} invited you to Tracka+.`, 'success')
        } else if (ref?.partner && ref.partner !== 'Tracka+') {
          notify(`Welcome! You were referred by ${ref.partner}.`, 'success')
        }
      })
      .catch((err) => console.error('REFERRAL SCAN ERROR:', err))
    const claimReferralWhenReady = () =>
      referralCapture.then(claimReferral).catch((err) => console.error('REFERRAL CLAIM ERROR:', err))

    const checkUser = async (user) => {
      try {
        setUser(user)
        redeemPendingInvite()
        claimReferralWhenReady()

        const isRecovery = recoveryActiveRef.current || isRecoveryFlow()

        if (isRecovery) {
          recoveryActiveRef.current = true
          setScreen('resetPassword')
        } else if (user.email === ADMIN_EMAIL) {
          setScreen('admin')
          return
        }

        const [{ data: profile, error }, { data: existingSkinProfile }, { data: practitionerRow }] = await Promise.all([
          supabase.from('profiles').select('username, onboarding_completed, avatar_path').eq('id', user.id).maybeSingle(),
          // New users land on the skin profile step until they've filled
          // it in at least once; after that, straight to Today.
          isRecovery
            ? Promise.resolve({ data: null })
            : supabase.from('skin_profiles').select('id').eq('user_id', user.id).limit(1).maybeSingle(),
          isRecovery
            ? Promise.resolve({ data: null })
            : supabase.from('practitioners').select('verified_at').eq('user_id', user.id).maybeSingle(),
        ])

        // Re-check after the awaits: the PASSWORD_RECOVERY event can arrive
        // while those queries are in flight.
        if (recoveryActiveRef.current) {
          setScreen('resetPassword')
        } else {
          setScreen(
            existingSkinProfile || practitionerRow?.verified_at ? 'today' : 'skinProfile'
          )
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
        loadProfileAvatar(profile?.avatar_path)

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

      if (recoveryActiveRef.current || isRecoveryFlow()) {
        recoveryActiveRef.current = true
        normalizeRecoveryFlow()
        setScreen('resetPassword')
        setAuthReady(true)
        return
      }

      if (!user) {
        console.log('No logged-in user found')
        setAuthReady(true)
        return
      }

      checkUser(user)
    }

    // Unconditional on auth state — this only gates which buttons render,
    // not any actual access, so there's no reason to wait for login.
    supabase
      .from('feature_flags')
      .select('key, enabled')
      .in('key', ['practitioners_launch', 'fullscreen_ads'])
      .then(({ data }) => {
        const on = new Set((data || []).filter((f) => f.enabled).map((f) => f.key))
        if (on.has('practitioners_launch')) setPractitionersLaunched(true)
        // Switched from the admin panel (off by default).
        if (on.has('fullscreen_ads')) setFullscreenAdsOn(true)
      })

    const inviteMatch = window.location.search.match(/[?&]invite=([0-9a-fA-F-]{36})/)
    if (inviteMatch) {
      try { localStorage.setItem('pendingInviteToken', inviteMatch[1]) } catch {}
      window.history.replaceState({}, '', window.location.pathname)
    }
    try {
      if (localStorage.getItem('pendingInviteToken')) setHasPendingInvite(true)
    } catch {}

    // Shared challenge links. Stashed like invite tokens so the link
    // survives signup/login; consumed when the person first reaches Today.
    const challengeMatch = window.location.search.match(/[?&]challenge=([a-z0-9-]{1,64})/i)
    if (challengeMatch) {
      try { localStorage.setItem('pendingChallengeSlug', challengeMatch[1].toLowerCase()) } catch {}
      window.history.replaceState({}, '', window.location.pathname)
    }

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
        recoveryActiveRef.current = true
        normalizeRecoveryFlow()
        setScreen('resetPassword')
      }

      if (session?.user) {
        setUser(session.user)
        redeemPendingInvite()
        claimReferralWhenReady()
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

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
  // where the report also loads) before ever visiting the Skin diary.
  // Upper-bounded with firstOfNextMonth too (not just gte firstOfMonth) —
  // viewing a past month otherwise swept in everything from that month
  // through today, since there was previously no reason to cap it (the
  // report only ever showed the current month, where "today" already is
  // the cap).
  const reportEndDate = isCurrentMonth ? addDays(todayString, 1) : firstOfNextMonth
  const historyStartDate = addDays(firstOfMonth, -7)
  const [{ data, error }, { data: completions, error: completionsError }, { count: photosAdded, error: photosError }, { data: routines, error: routinesError }, { data: history, error: historyError }] =
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
        .lt('local_date', reportEndDate),
      supabase
        .from('routine_completions')
        .select('completed_date, time_of_day')
        .eq('user_id', user.id),
      supabase
        .from('progress_photos')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('local_date', firstOfMonth)
        .lt('local_date', reportEndDate),
      supabase
        .from('routines')
        .select(`
          id,
          time_of_day,
          routine_steps (
            id,
            step_name,
            step_order,
            frequency,
            days_of_week,
            is_active,
            user_products (
              opened_date,
              pao_months,
              products ( brand, name, category, ingredients )
            )
          )
        `)
        .eq('user_id', user.id)
        .eq('is_active', true)
        .eq('routine_steps.is_active', true),
      supabase
        .from('routine_step_completions')
        .select('routine_step_id, local_date')
        .eq('user_id', user.id)
        .gte('local_date', historyStartDate)
        .lt('local_date', reportEndDate),
    ])

  if (error || completionsError || photosError || routinesError || historyError) {
    console.error('MONTHLY REPORT ERROR:', error || completionsError || photosError || routinesError || historyError)
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

  const completion = calculateRoutineCompletion({
    routines: routines || [],
    history: history || [],
    completions: completions || [],
    startDate: firstOfMonth,
    endDate: reportEndDate,
    restrictions,
  })
  const streaks = calculateStreaks(
    (completions || [])
      .filter((entry) => entry.time_of_day === 'PM' || !entry.time_of_day)
      .map((entry) => entry.completed_date),
    todayString,
    firstOfMonth,
    reportEndDate
  )

  setMonthlyReport({
    monthLabel: displayed.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    isCurrentMonth,
    routineCompletionPct: completion.percentage,
    sunscreenDays,
    productsUsed: productIds.size,
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
    photosAdded: photosAdded || 0,
  })
  setMonthlyReportLoading(false)
}

const loadProfileAvatar = async (path) => {
  setProfilePhotoPath(path || null)
  if (!path) {
    setProfilePhotoUrl(null)
    return
  }

  const { data, error } = await supabase.storage
    .from('profile-photos')
    .createSignedUrl(path, 3600)
  if (error) {
    console.error('PROFILE PHOTO URL ERROR:', error)
    setProfilePhotoUrl(null)
    return
  }
  setProfilePhotoUrl(data?.signedUrl || null)
}

const uploadProgressPhoto = async (file, localDate, note = '') => {
  if (!file) return false

  setPhotoError(null)
  setPhotoUploading(true)

  const { data: { session }, error: sessionError } = await supabase.auth.getSession()

  if (sessionError) {
    setPhotoError("Couldn't reach the server. Check your connection and try again.")
    setPhotoUploading(false)
    return false
  }

  if (!session?.user) {
    setPhotoError('Your session ended. Please log in again.')
    setPhotoUploading(false)
    setScreen('login')
    return false
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
    return false
  }

  const { error: insertError } = await supabase.from('progress_photos').insert({
    user_id: session.user.id,
    path,
    local_date: localDate || localDateString(),
    note: note.trim() || null,
  })

  if (insertError) {
    console.error('PHOTO ROW ERROR:', insertError)
    setPhotoError("Couldn't save that photo. Try again.")
    setPhotoUploading(false)
    return false
  }

  setPhotoUploading(false)
  await loadProgressPhotos()
  return true
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
    notify("That note didn't save. Try again.")
    return false
  }

  setProgressPhotos((photos) => photos.map((p) => (p.id === photo.id ? { ...p, note } : p)))
  setViewingPhotoNote(note)
  notify('Diary entry saved.', 'success')
  return true
}

// Saves a diary note on the selected date when an entry has no photo.
const saveNoteForDate = async (date, note) => {
  if (!user) {
    notify('Please log in again.')
    return false
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
    return false
  }

  setSkinLogs((logs) =>
    logs.some((log) => log.local_date === date)
      ? logs.map((log) => (log.local_date === date ? { ...log, note } : log))
      : [...logs, { local_date: date, note, breakouts: 0, dryness: 0, oiliness: 0, redness: 0 }]
  )

  notify('Note saved.', 'success')
  return true
}

// Only the night routine counts toward the streak and lights up the
// calendar — the morning button just confirms and moves on, since a
// skincare "day" isn't done until the night steps are actually done.
const finishRoutine = async (slot) => {
  const today = localDateString()
  // Once a routine is complete for the day it stays complete.
  if (isRoutineFinished(slot, today)) return

  const { error } = await supabase
    .from('routine_completions')
    .upsert(
      { user_id: user.id, completed_date: today, time_of_day: slot },
      { onConflict: 'user_id,completed_date,time_of_day' }
    )

  if (error) {
    console.error('FINISH ROUTINE ERROR:', error)
    notify('That didn\'t save. Check your connection and try again.')
    return
  }

  setProgressCompletions((current) =>
    current.some((item) => item.completed_date === today && item.time_of_day === slot)
      ? current
      : [...current, { completed_date: today, time_of_day: slot, completed_at: new Date().toISOString() }]
  )

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
    const { generateStreakImage } = await import('./lib/shareImage')
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
    text: 'I track my skincare routine with tracka+. Want to stay consistent too? Join me',
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
    await navigator.clipboard.writeText(`${shareData.text}\n${shareData.url}`)
    notify('Invite link copied — paste it anywhere.', 'success')
  } else {
    notify(shareData.url, 'success')
  }
}

// Same tiered share as inviteFriend. The ?challenge= link opens that
// challenge's page once the friend is signed in (see openPendingChallenge).
const shareChallenge = async (challenge, participation) => {
  const progress = participation
    ? ` I'm on day ${challengeStats(participation).day} of ${challenge.duration_days}.`
    : ''
  const shareData = {
    title: challenge.title,
    text: `Join me on the ${challenge.title} challenge on Tracka+!${progress} Let's build the habit together.`,
    url: `${SITE_URL}/?challenge=${encodeURIComponent(challenge.slug)}`,
  }

  if (navigator.share) {
    try {
      await navigator.share(shareData)
    } catch (err) {
      if (err?.name !== 'AbortError') console.error('CHALLENGE SHARE ERROR:', err)
    }
    return
  }

  if (navigator.clipboard) {
    await navigator.clipboard.writeText(`${shareData.text}\n${shareData.url}`)
    notify('Challenge link copied — paste it anywhere.', 'success')
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
    const { generateSkinReportImage } = await import('./lib/shareImage')
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

  // Refresh the routine in the shared cache (Today, the editor and the
  // monthly report all read it from there).
  const loadRoutines = async () => {
  if (!user) return
  try {
    await reloadRoutines()
  } catch (err) {
    console.error('ROUTINES ERROR:', err)
  }
}
  const toggleStepCompletion = async (stepId) => {
  // Read fresh from the cache: App no longer re-renders on ticks, so a
  // value captured at its last render could be out of date.
  const alreadyCompleted = getCompletedSteps(user?.id).includes(stepId)
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
    syncChallengesAfterTick()

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
  syncChallengesAfterTick()
}

// Challenge progress is written server-side by a trigger on
// routine_step_completions, so after any tick just re-read it. Only
// bothers when there's an active challenge to update.
const syncChallengesAfterTick = async () => {
  const activeIds = myChallenges.filter((p) => p.status === 'active').map((p) => p.id)
  if (activeIds.length === 0) return

  // loadChallenges itself raises the full-screen celebration if this tick
  // just finished a challenge.
  await loadChallenges()
}

const todayString = localDateString()
const tipDay = Math.floor(Date.parse(`${todayString}T00:00:00Z`) / 86400000)
const dailySkinTip = DAILY_SKIN_TIPS[((tipDay % DAILY_SKIN_TIPS.length) + DAILY_SKIN_TIPS.length) % DAILY_SKIN_TIPS.length]

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
    userProduct: step.user_products ?? null,
    expiry_date: step.user_products?.expiry_date ?? null,
    marked_expired_at: step.user_products?.marked_expired_at ?? null,
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
    userProduct: step.user_products ?? null,
    expiry_date: step.user_products?.expiry_date ?? null,
    marked_expired_at: step.user_products?.marked_expired_at ?? null,
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

const renderProfileAvatar = (sizeClass) => {
  const initials = (displayName || 'T')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')

  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full ${sizeClass} ${t.chip}`}>
      {profilePhotoUrl ? (
        <img src={profilePhotoUrl} alt={`${displayName || 'Your'} profile`} className="h-full w-full object-cover" />
      ) : (
        <span className={`font-semibold ${t.mark}`}>{initials}</span>
      )}
    </span>
  )
}

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
        key: 'discover',
        label: 'Discover',
        screens: ['discover', 'challenges'],
        icon: (active) => (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}
            strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
          </svg>
        ),
      },
      {
        key: 'products',
        label: 'My products',
        screens: ['products', 'addProduct', 'productDetail', 'ingredientChecker'],
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
        key: 'routinePlanner',
        label: 'My routine',
        screens: ['routinePlanner', 'routineHistory', 'routineDetails'],
        icon: (active) => (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6h11M9 12h11M9 18h11" />
            <path d="m3.5 6 1.2 1.2L7 4.8M3.5 12l1.2 1.2L7 10.8M3.5 18l1.2 1.2L7 16.8" />
          </svg>
        ),
      },
      {
        key: 'reminders',
        label: 'Reminders',
        screens: ['reminders'],
        icon: (active) => (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={active ? 2.2 : 1.8}
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
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
            if (tab.key === 'reminders') await loadReminderSettings()
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

// "Day X" is the challenge day you're working on: completed days, plus
// today if it isn't ticked yet. Missed days don't advance it, since the
// challenge is 30 completed days rather than 30 consecutive ones.
const challengeStats = (participation) => {
  const total = participation.challenges?.duration_days || 30
  const target = challengeTarget(participation.challenges)
  const done = Math.min(participation.days_completed || 0, total)
  const doneToday = (participation.challenge_days || []).some((d) => d.local_date === todayString)
  const win = challengeWindow(participation.challenges)
  // A shared-window challenge is on the same calendar day for everyone;
  // a per-person one counts the day you're working on.
  const day = win.hasWindow
    ? Math.min(Math.max(win.challengeDay, 1), total)
    : Math.min(done + (doneToday ? 0 : 1), total)
  const pct = Math.min(100, Math.round((done / target) * 100))
  return { total, target, done, doneToday, day, pct, ...win }
}

// The finish line. Can be below the length (30 Days of SPF completes at 25
// of 30) so late joiners can still finish and one missed day isn't fatal.
const challengeTarget = (challenge) =>
  challenge?.target_days || challenge?.duration_days || 30

// For challenges with starts_on/ends_on (one window for everyone): which
// day of the challenge today is, how many days can still be ticked
// (including today), and whether it's over. Uses the app's 4am-cutoff date.
const challengeWindow = (challenge) => {
  if (!challenge?.starts_on || !challenge?.ends_on) {
    return { hasWindow: false, ended: false, notStarted: false, daysLeft: null, challengeDay: null }
  }
  const dayNumber = (d) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86400000)
  const today = dayNumber(todayString)
  const start = dayNumber(challenge.starts_on)
  const end = dayNumber(challenge.ends_on)
  return {
    hasWindow: true,
    ended: today > end,
    notStarted: today < start,
    daysLeft: Math.max(0, end - Math.max(today, start) + 1),
    challengeDay: today - start + 1,
  }
}

// Shared-window challenge still running: reaching the target is "over the
// line", not the end — you keep ticking, winners come after it closes.
const challengeInProgress = (challenge) => {
  const w = challengeWindow(challenge)
  return w.hasWindow && !w.ended
}

const formatChallengeDate = (d, withYear = false) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}),
  })

// Still running for this person. Inside a shared window, completing doesn't
// stop you — you keep ticking for the leaderboard until it closes. Once the
// window closes (or the row is 'ended'), it's a final result.
const isLiveParticipation = (p) => {
  const win = challengeWindow(p.challenges)
  if (win.ended) return false
  return p.status === 'active' || (p.status === 'completed' && win.hasWindow)
}

// Joining requires an AM sunscreen step, but a later routine rebuild (or
// accepting a practitioner's recommendation, which replaces the AM slot)
// can remove it — after which the trigger silently stops counting days.
// Same condition join_challenge checks. Not trusted mid-load, so the
// warning never flashes up before routines arrive.
const missingAmSunscreen =
  !routinesLoading &&
  !todayAmSteps.some((s) => (s.user_products?.products?.category || '').toLowerCase() === 'sunscreen')

const renderSunscreenMissingNotice = (className = '') => (
  <button
    type="button"
    onClick={() => setScreen('routinePlanner')}
    className={`${className} w-full rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-left`}
  >
    <span className="block text-[13px] font-semibold text-amber-600">
      Your morning routine has no sunscreen
    </span>
    <span className={`mt-0.5 block text-[12px] leading-relaxed ${t.muted}`}>
      Add one to keep your challenge progress counting. Edit my routine →
    </span>
  </button>
)

// Sponsored challenges carry the brand's product shot in image_url;
// everything else gets a warm placeholder rather than a broken image.
const renderChallengeImage = (challenge, className) =>
  challenge?.image_url ? (
    <img
      src={challenge.image_url}
      alt={challenge.sponsor_name ? `${challenge.sponsor_name} product` : ''}
      className={`${className} object-cover`}
    />
  ) : (
    <div
      className={`${className} flex items-center justify-center bg-gradient-to-br from-[#FBEEDB] via-[#F1DDBE] to-[#DDBF94]`}
      aria-hidden="true"
    >
      <svg width="40%" height="40%" viewBox="0 0 24 24" fill="none" stroke="#A8712A"
        strokeWidth="1.4" strokeLinecap="round" className="max-h-24 max-w-24">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
      </svg>
    </div>
  )

const renderChallengeBar = (pct, fillClass = t.nodeDone) => (
  <div className={`h-2 w-full overflow-hidden rounded-full ${t.rail}`}>
    <div
      className={`h-full rounded-full ${fillClass}`}
      style={{ width: `${pct > 0 ? Math.max(pct, 3) : 0}%` }}
    />
  </div>
)

// Same artwork as the saved PNG (shapes from core/awards). Locked awards
// render as a flat grey silhouette so the next goal is visible.
const renderAwardIcon = (award, size, locked = false) => {
  const metal = METALS[award.metal] || METALS.gold
  const gradId = `award-${award.key}`
  const fill = locked ? (isNight ? '#2A3B52' : '#D5DDE8') : `url(#${gradId})`

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="0.2" y1="0.1" x2="0.8" y2="0.95">
          <stop offset="0" stopColor={metal.light} />
          <stop offset="0.45" stopColor={metal.mid} />
          <stop offset="1" stopColor={metal.dark} />
        </linearGradient>
      </defs>
      {award.kind === 'cup' ? (
        <>
          <path d={CUP_SHAPES.handles} fill="none" stroke={locked ? fill : metal.mid}
            strokeWidth="5" strokeLinecap="round" />
          <path d={CUP_SHAPES.stem} fill={fill} />
          <path d={CUP_SHAPES.base} fill={fill} />
          <path d={CUP_SHAPES.bowl} fill={fill} />
          {!locked && <path d={CUP_SHAPES.star} fill="rgba(255,255,255,0.75)" />}
        </>
      ) : (
        <>
          <path d={MEDAL_SHAPES.ribbonLeft} fill={locked ? fill : metal.ribbon} />
          <path d={MEDAL_SHAPES.ribbonRight} fill={locked ? fill : '#1B3FB0'} />
          <circle cx="50" cy="64" r="30" fill={fill} />
          <circle cx="50" cy="64" r="23" fill="none"
            stroke={locked ? 'transparent' : 'rgba(255,255,255,0.55)'} strokeWidth="2" />
          <text x="50" y="65" textAnchor="middle" dominantBaseline="middle"
            fontFamily="Inter, sans-serif" fontWeight="700" fontSize="26"
            fill={locked ? (isNight ? '#5F7593' : '#7488A3') : metal.dark}>
            {award.badge}
          </text>
        </>
      )}
    </svg>
  )
}

// Gold laurel wreath — the leaderboard's mark. Geometry in core/awards.
const renderLaurelIcon = (size) => {
  const compact = size < 28
  const gradId = `laurel-${size}`
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <defs>
        <linearGradient id={gradId} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#F8D978" />
          <stop offset="0.5" stopColor="#E2A632" />
          <stop offset="1" stopColor="#B5741A" />
        </linearGradient>
      </defs>
      <g fill="none" stroke={`url(#${gradId})`} strokeWidth={compact ? 1.15 : 0.8} strokeLinecap="round">
        {laurelStems().map((d) => <path key={d} d={d} />)}
      </g>
      <g fill={`url(#${gradId})`}>
        {laurelLeaves(compact).map((l, i) => (
          <path
            key={i}
            d={LAUREL_LEAF}
            transform={`translate(${l.x.toFixed(2)} ${l.y.toFixed(2)}) rotate(${l.rot.toFixed(1)}) scale(${l.len.toFixed(2)})`}
          />
        ))}
        <path d={LAUREL_STAR} />
      </g>
    </svg>
  )
}

const renderAchievements = (participation) => {
  const awards = challengeAwards(
    (participation.challenge_days || []).map((d) => d.local_date),
    challengeTarget(participation.challenges),
    {
      overTheLine: challengeInProgress(participation.challenges),
      challengeEnded: challengeWindow(participation.challenges).ended,
    }
  )

  return (
    <div className="mt-7">
      <p className="text-[17px] font-semibold">Your achievements</p>
      <p className={`mt-0.5 text-[12px] ${t.faint}`}>Tap an earned one to save it.</p>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {awards.map((award) => (
          <button
            key={award.key}
            type="button"
            disabled={!award.earned || !!awardSaving}
            onClick={() => saveAward(award, participation)}
            className={`flex flex-col items-center gap-1.5 rounded-2xl border ${t.hair} px-1 py-3 text-center ${
              award.earned ? '' : 'opacity-70'
            }`}
          >
            {renderAwardIcon(award, 44, !award.earned)}
            <span className={`text-[11px] font-semibold leading-tight ${award.earned ? '' : t.faint}`}>
              {awardSaving === award.key ? 'Saving…' : award.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

const renderChallengeProgressCard = (participation, returnTo) => {
  const { total, target, done, day, pct } = challengeStats(participation)
  return (
    <button
      key={participation.id}
      type="button"
      onClick={() => openChallenge(participation.challenge_id, returnTo)}
      className={`flex w-full gap-4 rounded-2xl ${t.surface} p-3.5 text-left`}
    >
      {renderChallengeImage(participation.challenges, 'h-24 w-20 shrink-0 rounded-xl')}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[16px] font-semibold">{participation.challenges?.title}</span>
        <span className={`mt-0.5 text-[13px] ${t.muted}`}>Day {day} of {total}</span>
        <span className="mt-2">{renderChallengeBar(pct)}</span>
        <span className={`mt-1.5 text-[12px] ${t.faint}`}>
          {done >= target
            ? `Completed · ${done} days`
            : `${done} of ${target} days completed`}
        </span>
        <span className={`mt-2 text-[13px] font-semibold ${t.mark}`}>Continue challenge →</span>
      </span>
    </button>
  )
}

const completedDates = new Set(
  progressCompletions
    .filter((item) => item.time_of_day === 'PM' || !item.time_of_day)
    .map((item) => item.completed_date)
    .filter(Boolean)
)

const currentStreak = calculateStreaks([...completedDates], todayString, '', '').current

// Rows from before morning/night were split have no time_of_day; they
// count as night, same as the streak above.
function isRoutineFinished(slot, date = todayString) {
  return progressCompletions.some((item) =>
    item.completed_date === date && (item.time_of_day === slot || (slot === 'PM' && !item.time_of_day))
  )
}

const getPaoStatus = (item) => {
  // Same rules the Today planner uses (core/expiry.js) — printed date,
  // opened + PAO, or marked expired — so every screen agrees.
  const expiry = productExpiry(item, todayString)
  if (!expiry) return null

  // Sunscreen past its date isn't just inert like a serum would be — it
  // can leave you unprotected without any visible sign, so it gets a firm
  // warning instead of the same quiet note every other category gets.
  const isSunscreen = (item.products?.category || '').toLowerCase() === 'sunscreen'
  const { daysLeft, marked } = expiry
  const expires = new Date(expiry.expiresOn + 'T00:00:00')
  const base = { daysLeft, expires, marked }

  if (marked) {
    return isSunscreen
      ? { ...base, label: 'Marked expired — don\'t rely on this for protection', expired: true, firm: true }
      : { ...base, label: 'Marked as expired', expired: true }
  }
  if (daysLeft < 0) {
    return isSunscreen
      ? { ...base, label: 'Expired — don\'t rely on this for protection', expired: true, firm: true }
      : { ...base, label: 'Expired', expired: true }
  }
  if (daysLeft === 0) {
    return isSunscreen
      ? { ...base, label: 'Expires today — replace before your next reapply', expired: true, firm: true }
      : { ...base, label: 'Expires today', expired: true }
  }
  if (daysLeft <= 30) return { ...base, label: `${daysLeft}d left`, expired: false }

  return {
    ...base,
    label: `Use by ${expires.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`,
    expired: false,
  }
}

// Open Beauty Facts' category text is free-form ("moisturising cream",
// "gel nettoyant") — map it onto the fixed category list the app uses.
const guessCategory = (text) => {
  const lower = (text || '').toLowerCase()

  if (lower.includes('body wash') || lower.includes('shower gel')) return 'body_wash'
  if (lower.includes('body moisturizer') || lower.includes('body moisturiser') || lower.includes('body lotion')) return 'body_moisturizer'
  if (lower.includes('body oil')) return 'body_oil'
  if (lower.includes('body scrub')) return 'body_scrub'
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


useEffect(() => {
  // Leaving the add form without saving drops the sponsored-product credit.
  if (screen !== 'addProduct') adProductAddRef.current = null

  if (screen === 'today') {
    loadRoutines()
    loadStepHistory()
    loadSkinLogs()
    loadMonthlyReport()
    loadPendingRecommendations()
    loadCareTeam()
    loadChallenges()
    openPendingChallenge()
  }

  if (screen === 'products' || screen === 'productDetail') {
    loadEmpties()
  }

  if (screen === 'challengeLeaderboard') {
    loadLeaderboard()
    loadChallenges()
  }

  if (screen === 'challenges' || screen === 'challengeDetail' || screen === 'discover') {
    loadChallenges()
    loadRoutines()
    setChallengeMenuOpen(false)
  }

  if (screen === 'routinePlanner') {
    loadRoutines()
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

useEffect(() => {
  if (!user) return

  let cancelled = false
  const refreshChallenges = () => {
    if (document.visibilityState === 'visible') loadChallenges()
  }
  const now = new Date()
  const nextRollover = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 4)
  if (now >= nextRollover) nextRollover.setDate(nextRollover.getDate() + 1)

  const timer = window.setTimeout(() => {
    if (!cancelled) loadChallenges()
  }, nextRollover.getTime() - now.getTime() + 100)
  document.addEventListener('visibilitychange', refreshChallenges)
  window.addEventListener('focus', refreshChallenges)

  return () => {
    cancelled = true
    window.clearTimeout(timer)
    document.removeEventListener('visibilitychange', refreshChallenges)
    window.removeEventListener('focus', refreshChallenges)
  }
}, [user, screen])

// Android/desktop Chrome offer a real one-tap install; hold on to the event
// so the setup guide can trigger it from a button.
useEffect(() => {
  const onPrompt = (e) => {
    e.preventDefault()
    setInstallPromptEvent(e)
  }
  const onInstalled = () => setInstallPromptEvent(null)
  window.addEventListener('beforeinstallprompt', onPrompt)
  window.addEventListener('appinstalled', onInstalled)
  return () => {
    window.removeEventListener('beforeinstallprompt', onPrompt)
    window.removeEventListener('appinstalled', onInstalled)
  }
}, [])

// Offer the setup guide on Today when either step is missing — once per
// session, a beat after landing, and not again for 3 days after "Not now".
useEffect(() => {
  if (screen !== 'today' || !user || setupGuideShownRef.current) return
  const env = getInstallEnv()
  if (env.standalone && env.notifications === 'granted') return
  let snoozedUntil = 0
  let dismissals = 0
  try {
    snoozedUntil = Number(localStorage.getItem('setupGuideSnoozeUntil') || 0)
    dismissals = Number(localStorage.getItem('setupGuideDismissals') || 0)
  } catch { /* show it */ }
  // After three "Not now"s it stops popping up; the Today banner and the
  // Settings row stay, so it's never out of reach.
  if (Date.now() < snoozedUntil || dismissals >= 3) return

  const timer = setTimeout(() => {
    setupGuideShownRef.current = true
    setSetupGuideStatus(null)
    setSetupGuideOpen(true)
  }, 1500)
  return () => clearTimeout(timer)
}, [screen, user])

const openSetupGuide = () => {
  setSetupGuideStatus(null)
  setSetupGuideOpen(true)
}

const snoozeSetupGuide = () => {
  try {
    localStorage.setItem('setupGuideSnoozeUntil', String(Date.now() + 3 * 86400000))
    const n = Number(localStorage.getItem('setupGuideDismissals') || 0)
    localStorage.setItem('setupGuideDismissals', String(n + 1))
  } catch { /* fine */ }
  setSetupGuideOpen(false)
}

const installFromPrompt = async () => {
  if (!installPromptEvent) return
  installPromptEvent.prompt()
  const { outcome } = await installPromptEvent.userChoice
  setInstallPromptEvent(null)
  if (outcome === 'accepted') {
    setSetupGuideStatus('Installed — open Tracka+ from your home screen, then turn on reminders.')
  }
}

const turnOnRemindersFromGuide = async () => {
  const result = await subscribeToPushNotifications()
  setSetupGuideStatus(
    result.ok
      ? 'reminders_on'
      : result.reason === 'needs_install'
      ? 'Open Tracka+ from your home screen first — on iPhone, reminders only work there.'
      : result.reason === 'denied'
      ? 'Notifications are blocked for Tracka+. Turn them on in your phone settings, then try again.'
      : result.reason === 'unsupported'
      ? "This browser can't send reminders. Try Chrome on Android or Safari on iPhone."
      : "That didn't work. Try again in a moment."
  )
}

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

// Returns the user's participation rows so callers (e.g. the post-tick
// sync) can compare before/after without waiting for a re-render.
const loadChallenges = async () => {
  if (!user) return null

  let mine
  try {
    mine = { data: (await reloadChallenges()).mine }
  } catch (err) {
    console.error('LOAD CHALLENGES ERROR:', err)
    return null
  }

  // Show the end-of-window celebration once, even if this person missed the target.
  let endedCelebrated = []
  try { endedCelebrated = JSON.parse(localStorage.getItem('celebratedChallengeEndings') || '[]') } catch { /* fresh */ }
  const endedParticipation = (mine.data || []).find((p) =>
    p.status !== 'left' && challengeWindow(p.challenges).ended && !endedCelebrated.includes(p.id)
  )
  if (endedParticipation) {
    setCelebration({ ...endedParticipation, finalDayCelebration: true })
  } else {
    // Celebrate reaching the target once per device, wherever first seen.
    let celebrated = []
    try { celebrated = JSON.parse(localStorage.getItem('celebratedChallenges') || '[]') } catch { /* fresh */ }
    const uncelebrated = (mine.data || []).find((p) => p.status === 'completed' && !celebrated.includes(p.id))
    if (uncelebrated) setCelebration(uncelebrated)
  }

  return mine.data || []
}

const dismissCelebration = () => {
  if (celebration) {
    try {
      const key = celebration.finalDayCelebration ? 'celebratedChallengeEndings' : 'celebratedChallenges'
      const celebrated = JSON.parse(localStorage.getItem(key) || '[]')
      if (!celebrated.includes(celebration.id)) {
        localStorage.setItem(key, JSON.stringify([...celebrated, celebration.id]))
      }
      if (celebration.finalDayCelebration) {
        const targetCelebrated = JSON.parse(localStorage.getItem('celebratedChallenges') || '[]')
        if (!targetCelebrated.includes(celebration.id)) {
          localStorage.setItem('celebratedChallenges', JSON.stringify([...targetCelebrated, celebration.id]))
        }
      }
    } catch { /* worst case it celebrates again next time */ }
  }
  setCelebration(null)
}

// Saves a cup/medal as an image — same share-sheet-then-download tiers as
// shareStreak, so on phones it can go straight to Photos/Instagram/WhatsApp.
const saveAward = async (award, participation) => {
  if (awardSaving) return
  setAwardSaving(award.key)

  try {
    const challengeTitle = participation.challenges?.title || 'Challenge'
    const earnedOn = award.kind === 'cup' && participation.completed_at
      ? new Date(participation.completed_at)
      : new Date()
    const { generateAwardImage } = await import('./lib/shareImage')
    const blob = await generateAwardImage({
      award,
      challengeTitle,
      dateLabel: earnedOn.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
      isNight,
    })
    const fileName = `tracka-${award.kind === 'cup' ? 'cup' : `medal-${award.key}`}.png`
    const file = new File([blob], fileName, { type: 'image/png' })
    const caption = award.kind === 'cup'
      ? award.label === 'Challenge completed'
        ? `🏆 I finished ${challengeTitle} with ${participation.days_completed} of ${participation.challenges?.duration_days || 30} days checked in on Tracka+`
        : `🏆 I completed ${challengeTitle} on Tracka+`
      : `🏅 ${award.label} — ${challengeTitle} on Tracka+`

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Tracka+', text: caption })
    } else {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
      notify('Saved — find it in your downloads.', 'success')
    }
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.error('SAVE AWARD ERROR:', err)
      notify('Could not save the image. Please try again.')
    }
  } finally {
    setAwardSaving(null)
  }
}

const openChallenge = (challengeId, returnTo = 'challenges') => {
  setSelectedChallengeId(challengeId)
  setChallengeReturnScreen(returnTo)
  setScreen('challengeDetail')
}

// Runs on reaching Today, which only happens once someone is signed in and
// past onboarding, so a friend who signs up from a shared link still lands
// on the challenge after setting up their routine.
const openPendingChallenge = async () => {
  let slug
  try {
    slug = localStorage.getItem('pendingChallengeSlug')
    if (slug) localStorage.removeItem('pendingChallengeSlug')
  } catch {
    return
  }
  if (!slug || !user) return

  const { data } = await supabase
    .from('challenges')
    .select('id')
    .eq('slug', slug)
    .eq('is_published', true)
    .maybeSingle()

  if (data?.id) openChallenge(data.id, 'today')
}

const loadLeaderboard = async (challengeId = selectedChallengeId) => {
  if (!challengeId) return
  try {
    await reloadLeaderboard(challengeId)
  } catch (error) {
    console.error('LEADERBOARD ERROR:', error)
    notify('Could not load the leaderboard.')
  }
}

const setLeaderboardHidden = async (challengeId, hidden) => {
  const { error } = await supabase.rpc('set_leaderboard_visibility', {
    p_challenge_id: challengeId,
    p_hidden: hidden,
  })
  if (error) {
    console.error('LEADERBOARD VISIBILITY ERROR:', error)
    notify('Could not update your leaderboard setting.')
    return
  }
  await Promise.all([loadLeaderboard(challengeId), loadChallenges()])
  notify(hidden ? 'Your name is now private on the leaderboard.' : 'Your name is now shown on the leaderboard.', 'success')
}

const joinChallenge = async (challenge, sponsorPlacementId = null) => {
  const { error } = await supabase.rpc('join_challenge', {
    p_challenge_id: challenge.id,
    p_local_date: localDateString(),
  })

  if (error) {
    if (error.message?.includes('NO_SUNSCREEN_STEP')) {
      const goAdd = await confirmAction(
        'Add sunscreen to your morning routine first. This challenge tracks the sunscreen step you tick each morning.',
        ['Not now', 'Edit my routine']
      )
      if (goAdd) setScreen('routinePlanner')
      return
    }
    if (error.message?.includes('CHALLENGE_ENDED')) {
      notify('This challenge has ended. See the final results on the leaderboard.')
      await loadChallenges()
      return
    }
    if (error.message?.includes('CHALLENGE_NOT_STARTED')) {
      notify("This challenge hasn't started yet.")
      return
    }
    if (error.message?.includes('ALREADY_JOINED')) {
      await loadChallenges()
      return
    }
    console.error('JOIN CHALLENGE ERROR:', error)
    notify('Could not join this challenge. Please try again.')
    return
  }

  // Credit the sign-up to a sponsored ad if that's where they came from:
  // tapped through from an ad, or joined on a page carrying the sponsor's
  // card (the server counts one join per person per ad).
  if (lastAdClickRef.current?.challengeId === challenge.id) {
    recordAdEvent(supabase, lastAdClickRef.current.placementId, 'challenge_join')
    lastAdClickRef.current = null
  } else if (sponsorPlacementId) {
    recordAdEvent(supabase, sponsorPlacementId, 'challenge_join')
  }

  await loadChallenges()
  notify('Challenge joined!', 'success')
}

const leaveChallenge = async (participation) => {
  const confirmed = await confirmAction(
    `Leave ${participation.challenges?.title || 'this challenge'}? Your progress so far (${participation.days_completed} days) won't carry over if you join again.`,
    ['Keep going', 'Leave challenge']
  )
  if (!confirmed) return

  const { error } = await supabase.rpc('leave_challenge', { p_participant_id: participation.id })
  if (error) {
    console.error('LEAVE CHALLENGE ERROR:', error)
    notify('Could not leave this challenge.')
    return
  }

  await loadChallenges()
  notify('You left the challenge.', 'success')
  setScreen('challenges')
}

// Lands on Today and scrolls to the AM routine, where sunscreen gets
// ticked as usual. The [screen] effect scrolls to top first, so wait a beat.
const goToMorningRoutine = () => {
  setScreen('today')
  setTimeout(() => {
    document.getElementById('am-routine')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, 300)
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
      .select('id, status, scopes, invited_at, accepted_at, practitioners (display_name, title, bio, whatsapp, verified_at)')
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

const acceptPreviewedInvite = async () => {
  if (!invitePreview || invitePreviewBusy) return
  setInvitePreviewBusy(true)

  const { error } = await supabase.rpc('accept_invitation', { p_token: invitePreview.token })

  setInvitePreviewBusy(false)

  if (error) {
    console.error('INVITE REDEEM ERROR:', error)
    const permanent = /already used|not found|expired/i.test(error.message || '')
    if (permanent) {
      try { localStorage.removeItem('pendingInviteToken') } catch {}
      setHasPendingInvite(false)
      setInvitePreview(null)
      notify(/expired/i.test(error.message || '')
        ? 'That invite link has expired. Ask your professional to send a new one.'
        : "That invite link isn't valid anymore.")
      return
    }
    notify("Couldn't connect you right now. Try again in a moment.")
    return
  }

  try { localStorage.removeItem('pendingInviteToken') } catch {}
  setHasPendingInvite(false)
  setInvitePreview(null)
  notify("You're now connected with your professional.", 'success')
}

const declinePreviewedInvite = () => {
  try { localStorage.removeItem('pendingInviteToken') } catch {}
  setHasPendingInvite(false)
  setInvitePreview(null)
}

// Wrapped in an IIFE so the toast/confirm overlay below can render once,
// on top of whichever screen this resolves to, instead of being pasted
// into every one of the ~20 screen branches individually.
// ---- Products: pages, photos, expiry, empties ----------------------------

// Private bucket, so photos are shown through short-lived signed links.
// Only signs paths it hasn't signed yet.
useEffect(() => {
  const paths = [...products, ...empties]
    .map((p) => p.photo_path)
    .filter((path) => path && !productPhotoUrls[path])
  if (paths.length === 0) return
  let cancelled = false
  supabase.storage
    .from('product-photos')
    .createSignedUrls([...new Set(paths)], 3600)
    .then(({ data }) => {
      if (cancelled || !data) return
      setProductPhotoUrls((current) => {
        const next = { ...current }
        for (const entry of data) if (entry.signedUrl) next[entry.path] = entry.signedUrl
        return next
      })
    })
  return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [products, empties])

// The picture to show for a product: the person's own photo if they've
// taken one, otherwise the catalogue shot from Open Beauty Facts.
const productImageFor = (userProduct) =>
  (userProduct?.photo_path && productPhotoUrls[userProduct.photo_path]) ||
  userProduct?.products?.image_url ||
  null

// Placeholder art for products with no photo: an illustrated bottle per
// category (public/product-art) on a soft tint of that bottle's colour,
// so photo-less products still look designed rather than empty.
const PRODUCT_ART = {
  cleanser: ['cleanser', '#38BDF8'],
  toner: ['toner', '#22D3EE'],
  essence: ['toner', '#22D3EE'],
  serum: ['serum', '#2563EB'],
  treatment: ['treatment', '#4F46E5'],
  moisturizer: ['moisturizer', '#8B5CF6'],
  sunscreen: ['sunscreen', '#F59E0B'],
  exfoliant: ['exfoliant', '#14B8A6'],
  mask: ['mask', '#FB7185'],
  body_wash: ['cleanser', '#38BDF8'],
  body_moisturizer: ['moisturizer', '#8B5CF6'],
  body_oil: ['serum', '#2563EB'],
  body_scrub: ['exfoliant', '#14B8A6'],
  other: ['other', '#94A3B8'],
}
const productArtFor = (category) =>
  PRODUCT_ART[(category || '').toLowerCase()] || PRODUCT_ART.other

// Tile for a product with no picture. `className` sets the tile's size/shape,
// `artClass` the illustration's size inside it.
const renderProductArt = (category, className = '', artClass = 'h-[82%] w-[82%]') => {
  const [art, tint] = productArtFor(category)
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center ${className}`}
      style={{ background: `linear-gradient(135deg, ${tint}14, ${tint}33)` }}
    >
      <img src={`/product-art/${art}.png`} alt="" loading="lazy" className={`${artClass} object-contain`} />
    </span>
  )
}

// Phone photos are often 3–5 MB; shrink to ~1200px JPEG before upload.
// Falls back to the original file if the browser can't decode it.
const shrinkImage = (file) =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, 1200 / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      canvas.toBlob((blob) => resolve(blob || file), 'image/jpeg', 0.85)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(file)
    }
    img.src = url
  })

const saveProfilePhoto = async (file) => {
  if (!file || !user || profilePhotoUploading) return
  if (!file.type.startsWith('image/')) {
    notify('Choose an image file.')
    return
  }

  setProfilePhotoUploading(true)
  try {
    const image = await shrinkImage(file)
    const contentType = image.type || file.type
    const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg'
    const path = `${user.id}/avatar-${Date.now()}.${extension}`
    const { error: uploadError } = await supabase.storage
      .from('profile-photos')
      .upload(path, image, { contentType })

    if (uploadError) {
      console.error('PROFILE PHOTO UPLOAD ERROR:', uploadError)
      notify("Couldn't upload your photo. Try again.")
      return
    }

    const { error: profileError } = await supabase
      .from('profiles')
      .update({ avatar_path: path })
      .eq('id', user.id)

    if (profileError) {
      await supabase.storage.from('profile-photos').remove([path])
      console.error('PROFILE PHOTO SAVE ERROR:', profileError)
      notify("Couldn't save your photo. Try again.")
      return
    }

    const previousPath = profilePhotoPath
    await loadProfileAvatar(path)
    if (previousPath) await supabase.storage.from('profile-photos').remove([previousPath])
    notify('Profile photo updated.', 'success')
  } finally {
    setProfilePhotoUploading(false)
  }
}

const removeProfilePhoto = async () => {
  if (!user || !profilePhotoPath || profilePhotoUploading) return
  setProfilePhotoUploading(true)
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_path: null })
    .eq('id', user.id)
  setProfilePhotoUploading(false)

  if (error) {
    console.error('PROFILE PHOTO REMOVE ERROR:', error)
    notify("Couldn't remove your photo. Try again.")
    return
  }

  const oldPath = profilePhotoPath
  setProfilePhotoPath(null)
  setProfilePhotoUrl(null)
  await supabase.storage.from('profile-photos').remove([oldPath])
  notify('Profile photo removed.', 'success')
}

const patchUserProduct = (id, patch) => {
  setProducts((current) => current.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  setEmpties((current) => current.map((p) => (p.id === id ? { ...p, ...patch } : p)))
}

const setProductPhoto = async (item, file) => {
  if (!file || !user) return
  const blob = await shrinkImage(file)
  const path = `${user.id}/${item.id}-${Date.now()}.jpg`

  const { error: uploadError } = await supabase.storage
    .from('product-photos')
    .upload(path, blob, { contentType: 'image/jpeg' })
  if (uploadError) {
    console.error('PRODUCT PHOTO UPLOAD ERROR:', uploadError)
    notify("Couldn't upload that photo. Try again.")
    return
  }

  // The old file (if any) is queued for deletion by a database trigger.
  const { error } = await supabase.from('user_products').update({ photo_path: path }).eq('id', item.id)
  if (error) {
    console.error('PRODUCT PHOTO SAVE ERROR:', error)
    notify("Couldn't save that photo. Try again.")
    return
  }
  setProductPhotoUrls((current) => ({ ...current, [path]: URL.createObjectURL(blob) }))
  patchUserProduct(item.id, { photo_path: path })
}

const removeProductPhoto = async (item) => {
  const { error } = await supabase.from('user_products').update({ photo_path: null }).eq('id', item.id)
  if (error) {
    notify("Couldn't remove the photo.")
    return
  }
  patchUserProduct(item.id, { photo_path: null })
}

const updateProductDates = async (item, patch) => {
  const { error } = await supabase.from('user_products').update(patch).eq('id', item.id)
  if (error) {
    console.error('PRODUCT DATE ERROR:', error)
    notify("That date couldn't be saved. Check it and try again.")
    return
  }
  patchUserProduct(item.id, patch)
}

// Is this product still a step in the current AM/PM routine?
const routineSlotsUsing = (item) => {
  const slots = []
  if (todayAmSteps.some((s) => s.user_product_id === item.id)) slots.push('morning')
  if (todayPmSteps.some((s) => s.user_product_id === item.id)) slots.push('night')
  return slots
}

const finishProduct = async (item) => {
  const slots = routineSlotsUsing(item)
  const confirmed = await confirmAction(
    slots.length
      ? `Move ${item.products.name} to your empties? It'll come out of your ${slots.join(' and ')} routine too.`
      : `Move ${item.products.name} to your empties?`,
    ['Cancel', 'Mark as finished']
  )
  if (!confirmed) return

  const finished_at = new Date().toISOString()
  const { error } = await supabase
    .from('user_products')
    .update({ is_active: false, finished_at })
    .eq('id', item.id)
  if (error) {
    notify(error.message)
    return
  }
  // A finished product leaves the routine; add a replacement (or the same
  // product again) in My routine to bring the step back.
  if (slots.length) {
    const { error: stepsError } = await supabase
      .from('routine_steps')
      .update({ is_active: false })
      .eq('user_product_id', item.id)
      .eq('is_active', true)
    if (stepsError) console.error(stepsError)
    setTodayAmSteps((current) => current.filter((s) => s.user_product_id !== item.id))
    setTodayPmSteps((current) => current.filter((s) => s.user_product_id !== item.id))
  }
  setProducts((current) => current.filter((p) => p.id !== item.id))
  setEmpties((current) => [{ ...item, is_active: false, finished_at }, ...current])
  notify('Moved to your empties.', 'success')
  setScreen('products')
}

// Gone off before its date (or has no date) — or undo that.
const setProductMarkedExpired = async (item, expired) => {
  if (expired) {
    const slots = routineSlotsUsing(item)
    const confirmed = await confirmAction(
      slots.length
        ? `Mark ${item.products.name} as expired? It's still in your ${slots.join(' and ')} routine — swap it out in My routine.`
        : `Mark ${item.products.name} as expired?`,
      ['Cancel', 'Mark as expired']
    )
    if (!confirmed) return
  }
  const marked_expired_at = expired ? new Date().toISOString() : null
  const { error } = await supabase.from('user_products').update({ marked_expired_at }).eq('id', item.id)
  if (error) {
    notify(error.message)
    return
  }
  patchUserProduct(item.id, { marked_expired_at })
  if (expired) notify('Moved to Expired.', 'success')
}

// Added by mistake — not an empty, so it doesn't go to Empties.
const removeUserProduct = async (item) => {
  const confirmed = await confirmAction(`Remove ${item.products.name} from your products?`)
  if (!confirmed) return
  const { error } = await supabase.from('user_products').update({ is_active: false }).eq('id', item.id)
  if (error) {
    notify(error.message)
    return
  }
  setProducts((current) => current.filter((p) => p.id !== item.id))
  setScreen('products')
}

// Repurchased: a fresh bottle, so a new entry (own opened date and photo
// slot); the finished one stays in Empties as history.
const restockProduct = async (item) => {
  const { data, error } = await supabase
    .from('user_products')
    .insert({ user_id: user.id, product_id: item.product_id, is_active: true })
    .select(PRODUCT_FIELDS)
    .single()
  if (error) {
    notify(
      error.code === '23505'
        ? `${item.products.name} is already in your products.`
        : "Couldn't add it back. Try again."
    )
    return
  }
  setProducts((current) => [data, ...current])
  notify(`${item.products.name} is back in your products.`, 'success')
  setSelectedUserProductId(data.id)
}

const openProduct = (id) => {
  setSelectedUserProductId(id)
  setScreen('productDetail')
}

// Defined outside screenContent: the setup guide overlay (rendered outside
// the screens) also opens Reminders.
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

// --- Sponsored placements -------------------------------------------------
// Live home-banner ads, refreshed whenever Today is opened.
useEffect(() => {
  if (!user || screen !== 'today') return
  let cancelled = false
  fetchAds(supabase, 'home_banner').then((ads) => {
    if (!cancelled) setHomeAds(ads)
  })
  return () => { cancelled = true }
}, [user, screen])

const homeAd = homeAds.find((ad) => !isAdHidden(ad.placement_id)) || null

const hideHomeAd = (ad) => {
  hideAd(ad.placement_id)
  setHomeAds((current) => current.filter((a) => a.placement_id !== ad.placement_id))
}

const openAd = (ad) => {
  // Remembered so a challenge joined from this ad can be credited to it.
  lastAdClickRef.current = { placementId: ad.placement_id, challengeId: ad.challenge_id || ad.action_target }
  if (ad.action === 'feature_guide') {
    guideAdRef.current = ad.placement_id
    setScreen('featureGuide')
  } else if (ad.action === 'challenge' && (ad.action_target || ad.challenge_id)) {
    openChallenge(ad.action_target || ad.challenge_id, 'today')
  } else if (ad.action === 'screen' && ad.action_target) {
    setScreen(ad.action_target)
  } else if (ad.action === 'product' && ad.product) {
    setAdProduct(ad)
    setAdProductReturn(screen === 'adProduct' ? adProductReturn : screen)
    setScreen('adProduct')
    window.scrollTo(0, 0)
  } else {
    const url = ad.action_target || ad.landing_url
    if (url) window.open(withUtm(url, ad.headline), '_blank', 'noopener')
  }
}

const openFeatureFromGuide = async (target) => {
  if (target === 'skinProfile') await loadSkinProfile()
  if (target === 'reminders') await loadReminderSettings()
  setScreen(target)
}

// Called when the last card is reached (silent) and again on Done; the
// server counts one completion per person.
const completeFeatureGuide = (opts) => {
  if (guideAdRef.current) recordAdEvent(supabase, guideAdRef.current, 'guide_complete')
  if (!opts?.silent) setScreen('today')
}

const screenContent = (() => {

if (!authReady) {
  // The opening splash in index.html covers this until the session is known.
  return <main className="min-h-screen bg-white" />
}

if (screen === 'auth') {
  return (
    <SignUpScreen
      ADMIN_EMAIL={ADMIN_EMAIL}
      SITE_URL={SITE_URL}
      busyAction={busyAction}
      loginEmail={loginEmail}
      loginPassword={loginPassword}
      notify={notify}
      runBusy={runBusy}
      setDisplayName={setDisplayName}
      setLoginEmail={setLoginEmail}
      setLoginPassword={setLoginPassword}
      setOnboardingCompleted={setOnboardingCompleted}
      setProducts={setProducts}
      setScreen={setScreen}
      setShowPassword={setShowPassword}
      setUser={setUser}
      setUsername={setUsername}
      showPassword={showPassword}
      t={t}
      username={username}
    />
  )
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
  setScreen('today')
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

  // A first-time application verifies instantly (no admin gate); a
  // previously-revoked practitioner resubmitting this same form stays
  // unverified until an admin re-approves them — see the RPC for why that
  // split is safe. The server decides which one happened; it's not
  // something the client can determine from practitionerStatus alone.
  const { data: result, error } = await supabase.rpc('submit_practitioner_application', {
    p_display_name: applyDisplayName.trim(),
    p_title: applyTitle.trim() || null,
    p_bio: applyBio.trim() || null,
    p_specialisms: applySpecialisms
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    p_instagram: applyInstagram.trim() || null,
    p_whatsapp: applyWhatsapp.trim() || null,
  })

  setApplySaving(false)

  if (error) {
    console.error('PRACTITIONER APPLY ERROR:', error)
    notify(error.message)
    return
  }

  if (result === 'verified') {
    notify("You're all set — check out your dashboard.", 'success')
  } else {
    notify('Submitted — your access needs to be reviewed again before you can continue.', 'success')
  }
  setPractitionerStatus(result)
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

  // Always a token now, whether or not the email had an account — the
  // function deliberately no longer tells the caller which branch fired
  // (closes an email-enumeration path that was only ever acceptable for a
  // small, manually-vetted practitioner set, a premise auto-verify removed).
  // If the account existed, the direct connection was already made
  // server-side; this link still works as a backup either way.
  setAddClientEmail('')
  setAddClientResult({ token: data, link: `${SITE_URL}/?invite=${data}` })
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
    text: 'I track my skincare routine with tracka+. Want to stay consistent too? Join me',
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
    await navigator.clipboard.writeText(`${shareData.text}\n${shareData.url}`)
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
      <SkinProfileScreen
        busyAction={busyAction}
        concerns={concerns}
        gender={gender}
        goals={goals}
        loadSkinProfile={loadSkinProfile}
        notify={notify}
        onboardingCompleted={onboardingCompleted}
        practitionersLaunched={practitionersLaunched}
        pregnantOrBreastfeeding={pregnantOrBreastfeeding}
        profilePhotoUploading={profilePhotoUploading}
        profilePhotoUrl={profilePhotoUrl}
        renderProfileAvatar={renderProfileAvatar}
        runBusy={runBusy}
        saveProfilePhoto={saveProfilePhoto}
        sensitivity={sensitivity}
        setConcerns={setConcerns}
        setGender={setGender}
        setGoals={setGoals}
        setOnboardingCompleted={setOnboardingCompleted}
        setPregnantOrBreastfeeding={setPregnantOrBreastfeeding}
        setScreen={setScreen}
        setSensitivity={setSensitivity}
        setSkinProfileEditing={setSkinProfileEditing}
        setSkinType={setSkinType}
        skinProfileEditing={skinProfileEditing}
        skinType={skinType}
        t={t}
        toggleOption={toggleOption}
        user={user}
      />
    )
  }

  if (screen === 'products') {
    return (
      <ProductsScreen
        isNight={isNight}
        openAd={openAd}
        userId={user?.id}
        empties={empties}
        getPaoStatus={getPaoStatus}
        onboardingCompleted={onboardingCompleted}
        openProduct={openProduct}
        productImageFor={productImageFor}
        productPhotoUrls={productPhotoUrls}
        products={products}
        renderBottomTabs={renderBottomTabs}
        renderProductArt={renderProductArt}
        setAddProductReturnScreen={setAddProductReturnScreen}
        setScreen={setScreen}
        showLocalNotification={showLocalNotification}
        t={t}
      />
    )
  }

  if (screen === 'addProduct') {
    return (
      <AddProductScreen
        getProductSource={() => (adProductAddRef.current ? 'sponsored' : undefined)}
        onProductSaved={() => {
          if (adProductAddRef.current) {
            recordAdEvent(supabase, adProductAddRef.current, 'product_add')
            adProductAddRef.current = null
          }
        }}
        PRODUCT_SUGGESTIONS_ENABLED={PRODUCT_SUGGESTIONS_ENABLED}
        addProductReturnScreen={addProductReturnScreen}
        brandSuggestionsOpen={brandSuggestionsOpen}
        guessCategory={guessCategory}
        isNight={isNight}
        liveBrandMatches={liveBrandMatches}
        liveProductMatches={liveProductMatches}
        notify={notify}
        productBrand={productBrand}
        productCategory={productCategory}
        productExpiryDate={productExpiryDate}
        productImageUrl={productImageUrl}
        productIngredients={productIngredients}
        productName={productName}
        productOpenedDate={productOpenedDate}
        productPaoMonths={productPaoMonths}
        productSaving={productSaving}
        productSuggestionsOpen={productSuggestionsOpen}
        reloadProducts={reloadProducts}
        setBrandSuggestionsOpen={setBrandSuggestionsOpen}
        setProductBrand={setProductBrand}
        setProductCategory={setProductCategory}
        setProductExpiryDate={setProductExpiryDate}
        setProductImageUrl={setProductImageUrl}
        setProductIngredients={setProductIngredients}
        setProductName={setProductName}
        setProductOpenedDate={setProductOpenedDate}
        setProductPaoMonths={setProductPaoMonths}
        setProductSaving={setProductSaving}
        setProductSuggestionsOpen={setProductSuggestionsOpen}
        setScreen={setScreen}
        t={t}
      />
    )
  }

  if (screen === 'adsConsole') {
    return (
      <AdsConsole
        supabase={supabase}
        t={t}
        isNight={isNight}
        notify={notify}
        confirmAction={confirmAction}
        canManage={user?.email === ADMIN_EMAIL}
        onBack={() => {
          setAdminTab('ads')
          setScreen('admin')
        }}
      />
    )
  }

  if (screen === 'featureGuide') {
    return (
      <FeatureGuide
        t={t}
        isNight={isNight}
        onBack={() => setScreen('today')}
        onShowMe={openFeatureFromGuide}
        onComplete={completeFeatureGuide}
      />
    )
  }

  if (screen === 'referFriend') {
    return (
      <ReferFriendScreen
        t={t}
        isNight={isNight}
        notify={notify}
        onBack={() => setScreen('settings')}
      />
    )
  }

  if (screen === 'referralConsole') {
    return (
      <ReferralConsole
        supabase={supabase}
        t={t}
        isNight={isNight}
        notify={notify}
        confirmAction={confirmAction}
        onBack={() => {
          setAdminTab('referrals')
          setScreen('admin')
        }}
      />
    )
  }

  if (screen === 'productDetail') {
    const item =
      products.find((p) => p.id === selectedUserProductId) ||
      empties.find((p) => p.id === selectedUserProductId)
    const isEmpty = !!item?.finished_at && !products.some((p) => p.id === item?.id)
    const status = item && !isEmpty ? getPaoStatus(item) : null
    const photoUrl = productImageFor(item)
    const hasOwnPhoto = !!item?.photo_path
    const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    // Fixed height so date pickers and the PAO dropdown line up exactly.
    const inputClass = `block w-full min-w-0 rounded-xl border ${t.hair} ${t.surface} px-3 py-3 text-[14px] leading-5 outline-none`
    // iPhone shows an empty date field as a blank box; add a faint hint.
    // (Other browsers already show their own dd/mm/yyyy placeholder.)
    const isIOSDevice = getInstallEnv().isIOS
    const dateField = (value, onChange, extra = {}) => (
      <span className="relative block">
        <input type="date" value={value || ''} onChange={onChange} className={inputClass} {...extra} />
        {isIOSDevice && !value && (
          <span className={`pointer-events-none absolute inset-y-0 left-3 flex items-center text-[14px] ${t.faint}`}>
            Select date
          </span>
        )}
      </span>
    )

    return (
      <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
        <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-28 pt-7">
          <button
            onClick={() => setScreen('products')}
            className={`-ml-2 flex items-center gap-1 self-start py-2 text-[15px] ${t.muted}`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
            My products
          </button>

          {!item ? (
            <p className={`mt-8 text-[14px] ${t.muted}`}>This product isn&apos;t available any more.</p>
          ) : (
            <>
              <div className={`relative mt-4 aspect-[4/3] w-full overflow-hidden rounded-3xl ${t.surface}`}>
                {photoUrl ? (
                  <img src={photoUrl} alt={item.products?.name} className={`h-full w-full ${hasOwnPhoto ? 'object-cover' : 'bg-white object-contain p-4'} ${isEmpty ? 'opacity-80 grayscale-[30%]' : ''}`} />
                ) : (
                  <div className="relative h-full w-full">
                    {renderProductArt(item.products?.category, 'h-full w-full pb-8 pt-4', 'h-[75%] w-[75%]')}
                    <span className={`absolute inset-x-0 bottom-3 text-center text-[12px] font-medium ${t.muted}`}>No photo yet</span>
                  </div>
                )}
                {isEmpty && (
                  <span className="absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white">
                    Empty
                  </span>
                )}
              </div>

              <div className="mt-3 flex items-center gap-4">
                <label className={`cursor-pointer text-[13px] font-semibold ${t.mark} ${busyAction === 'productPhoto' ? 'opacity-50' : ''}`}>
                  {busyAction === 'productPhoto' ? 'Uploading…' : hasOwnPhoto ? 'Change photo' : photoUrl ? 'Use my own photo' : 'Add a photo'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={busyAction === 'productPhoto'}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (file) runBusy('productPhoto', () => setProductPhoto(item, file))
                    }}
                  />
                </label>
                {hasOwnPhoto && (
                  <button type="button" onClick={() => removeProductPhoto(item)} className={`text-[13px] font-semibold ${t.faint}`}>
                    Remove photo
                  </button>
                )}
              </div>

              <p className={`mt-6 text-[11px] font-semibold uppercase tracking-[0.16em] ${t.faint}`}>{item.products?.brand}</p>
              <h1 className="mt-1 font-display text-[30px] font-light leading-[1.1] tracking-tight">{item.products?.name}</h1>
              {item.products?.category && (
                <span className={`mt-2 inline-block self-start rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${t.chip}`}>
                  {item.products.category.replace(/_/g, ' ')}
                </span>
              )}

              {isEmpty ? (
                <div className={`mt-6 rounded-3xl ${t.surface} p-5`}>
                  {(() => {
                    const start = item.opened_date ? new Date(item.opened_date + 'T00:00:00') : new Date(item.added_at)
                    const days = Math.max(1, Math.round((new Date(item.finished_at) - start) / 86400000))
                    return (
                      <>
                        <p className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${t.faint}`}>Finished</p>
                        <p className="mt-1 text-[18px] font-semibold">{fmt(item.finished_at)}</p>
                        <p className={`mt-1 text-[13px] ${t.muted}`}>
                          Lasted {days} {days === 1 ? 'day' : 'days'}
                          {item.opened_date ? ` from opening on ${fmt(item.opened_date + 'T00:00:00')}` : ''}.
                        </p>
                      </>
                    )
                  })()}
                  <button
                    type="button"
                    disabled={!!busyAction}
                    onClick={() => runBusy('restock', () => restockProduct(item))}
                    className={`mt-4 w-full rounded-2xl py-3.5 text-[14px] font-bold ${t.btn} disabled:opacity-60`}
                  >
                    {busyAction === 'restock' ? 'Adding…' : 'Repurchased? Add it back'}
                  </button>
                </div>
              ) : (
                <>
                  <div className={`mt-6 rounded-3xl ${t.surface} p-5`}>
                    <p className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${t.faint}`}>Expiry</p>
                    {status ? (
                      <>
                        <p className={`mt-1 text-[24px] font-semibold leading-tight ${
                          status.daysLeft <= 0 ? t.danger : status.daysLeft <= 30 ? 'text-amber-600' : ''
                        }`}>
                          {status.marked
                            ? 'Marked as expired'
                            : status.daysLeft < 0
                            ? `Expired ${Math.abs(status.daysLeft)} ${Math.abs(status.daysLeft) === 1 ? 'day' : 'days'} ago`
                            : status.daysLeft === 0
                            ? 'Expires today'
                            : `${status.daysLeft} ${status.daysLeft === 1 ? 'day' : 'days'} left`}
                        </p>
                        <p className={`mt-0.5 text-[13px] ${t.muted}`}>
                          {status.marked ? `Marked on ${fmt(status.expires)}` : `Use by ${fmt(status.expires)}`}
                        </p>
                        {status.firm && (
                          <p className={`mt-3 rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-[12px] font-semibold ${t.danger}`}>
                            {status.label}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className={`mt-1 text-[13px] leading-relaxed ${t.muted}`}>
                        Add when you opened it, or the date printed on the pack, and Tracka+ will count down to when it expires.
                      </p>
                    )}

                    <div className={`mt-5 grid grid-cols-2 gap-x-3 gap-y-4 border-t pt-4 ${t.hair}`}>
                      <label className="block min-w-0">
                        <span className={`mb-1.5 block text-[11px] font-semibold uppercase tracking-wide ${t.faint}`}>Opened on</span>
                        {dateField(
                          item.opened_date,
                          (e) => updateProductDates(item, { opened_date: e.target.value || null }),
                          { max: todayString }
                        )}
                      </label>
                      <label className="block min-w-0">
                        <span className={`mb-1.5 block text-[11px] font-semibold uppercase tracking-wide ${t.faint}`}>PAO</span>
                        <span className="relative block">
                          <select
                            value={item.pao_months || ''}
                            onChange={(e) => updateProductDates(item, { pao_months: e.target.value ? Number(e.target.value) : null })}
                            className={`${inputClass} appearance-none pr-8`}
                          >
                            <option value="">Not set</option>
                            {[3, 6, 9, 12, 18, 24, 36].map((m) => (
                              <option key={m} value={m}>{m}M</option>
                            ))}
                          </select>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                            className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 ${t.faint}`}>
                            <path d="M6 9l6 6 6-6" />
                          </svg>
                        </span>
                      </label>
                      <label className="col-span-2 block min-w-0">
                        <span className={`mb-1.5 block text-[11px] font-semibold uppercase tracking-wide ${t.faint}`}>Expiry date</span>
                        {dateField(
                          item.expiry_date,
                          (e) => updateProductDates(item, { expiry_date: e.target.value || null })
                        )}
                      </label>
                    </div>
                    <p className={`mt-3 text-[12px] leading-relaxed ${t.muted}`}>
                      PAO is the period after opening your product. See the symbol with a number and M at the back of the product, e.g. 6M.
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={!!busyAction}
                    onClick={() => runBusy('finishProduct', () => finishProduct(item))}
                    className={`mt-6 w-full rounded-2xl py-4 text-[15px] font-bold ${t.btn} disabled:opacity-60`}
                  >
                    Mark as finished
                  </button>
                  {status?.marked ? (
                    <button
                      type="button"
                      disabled={!!busyAction}
                      onClick={() => runBusy('markExpired', () => setProductMarkedExpired(item, false))}
                      className={`mt-4 w-full rounded-2xl border py-3.5 text-[14px] font-semibold ${t.hair} ${t.muted} disabled:opacity-60`}
                    >
                      Not expired after all? Undo
                    </button>
                  ) : !(status && status.daysLeft < 0) && (
                    <button
                      type="button"
                      disabled={!!busyAction}
                      onClick={() => runBusy('markExpired', () => setProductMarkedExpired(item, true))}
                      className={`mt-3 w-full rounded-2xl border py-3.5 text-[14px] font-semibold ${t.hair} disabled:opacity-60`}
                    >
                      Mark as expired
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={!!busyAction}
                    onClick={() => runBusy('removeUserProduct', () => removeUserProduct(item))}
                    className={`mt-5 w-full py-2 text-center text-[13px] font-semibold ${t.danger} disabled:opacity-60`}
                  >
                    Remove (added by mistake)
                  </button>
                </>
              )}
            </>
          )}
        </div>

        {onboardingCompleted && renderBottomTabs('products', t)}
      </main>
    )
  }

  if (screen === 'ingredientChecker') {
    return (
      <IngredientCheckerScreen
        checkerMode={checkerMode}
        checkerPasted={checkerPasted}
        checkerProductId={checkerProductId}
        checkerShowAll={checkerShowAll}
        ingredientQuery={ingredientQuery}
        isNight={isNight}
        onboardingCompleted={onboardingCompleted}
        products={products}
        renderBottomTabs={renderBottomTabs}
        setCheckerMode={setCheckerMode}
        setCheckerPasted={setCheckerPasted}
        setCheckerProductId={setCheckerProductId}
        setCheckerShowAll={setCheckerShowAll}
        setIngredientQuery={setIngredientQuery}
        setScreen={setScreen}
        t={t}
      />
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
    <AdminScreen
      t={t}
      isNight={isNight}
      notify={notify}
      confirmAction={confirmAction}
      busyAction={busyAction}
      runBusy={runBusy}
      setScreen={setScreen}
      setUser={setUser}
      setPractitionerStatus={setPractitionerStatus}
      practitionersLaunched={practitionersLaunched}
      setPractitionersLaunched={setPractitionersLaunched}
      renderProductArt={renderProductArt}
      adminTab={adminTab}
      setAdminTab={setAdminTab}
    />
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
                    .select('username, onboarding_completed, avatar_path')
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
                  loadProfileAvatar(profile.avatar_path)
                }

                // Existing clients and verified professionals land on Today;
                // new clients complete their profile first.
                const [{ data: existingSkinProfile }, { data: practitionerRow }] = await Promise.all([
                  supabase.from('skin_profiles').select('id').eq('user_id', data.user.id).limit(1).maybeSingle(),
                  supabase.from('practitioners').select('verified_at').eq('user_id', data.user.id).maybeSingle(),
                ])

                setScreen(existingSkinProfile || practitionerRow?.verified_at ? 'today' : 'skinProfile')
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
                  redirectTo: `${SITE_URL}/?recovery=true&type=recovery`,
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

                const [{ data: profile, error: profileError }, { data: practitionerRow }] = await Promise.all([
                  supabase
                    .from('profiles')
                    .select('username, onboarding_completed, avatar_path')
                    .eq('id', data.user.id)
                    .maybeSingle(),
                  supabase.from('practitioners').select('verified_at').eq('user_id', data.user.id).maybeSingle(),
                ])

                setDisplayName(
                  profileError || !profile?.username
                    ? data.user.email?.split('@')[0] || 'there'
                    : profile.username
                )
                // The recovery link skips the normal start-up load, so fill in
                // what it would have (setup-guide state, photo, restrictions).
                if (!profileError && profile) {
                  setOnboardingCompleted(profile.onboarding_completed !== false)
                  loadProfileAvatar(profile.avatar_path)
                }
                loadRestrictions(data.user.id)

                recoveryActiveRef.current = false
                window.history.replaceState({}, '', window.location.pathname)
                notify('Your password has been updated.', 'success')

                // Resetting a password always lands on Today, even for someone
                // who hasn't finished their skin profile: Today's setup guide
                // picks that up, and sending them to the profile form read as
                // "it took me back to onboarding".
                setScreen(
                  data.user.email === ADMIN_EMAIL
                    ? 'admin'
                    : practitionerRow?.verified_at
                    ? 'practitionerDashboard'
                    : 'today'
                )
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
            onClick={() => setScreen(practitionerStatus === 'verified' && practitionersLaunched ? 'practitionerDashboard' : 'today')}
            className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
            {practitionerStatus === 'verified' && practitionersLaunched ? 'Dashboard' : 'Today'}
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

        <div className={`mt-6 flex items-center gap-4 rounded-3xl ${t.surface} p-4`}>
          {renderProfileAvatar('h-16 w-16 text-xl')}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold">{displayName || 'Your profile'}</p>
            <label className={`mt-1 inline-block cursor-pointer text-[13px] font-semibold ${t.mark}`}>
              {profilePhotoUploading ? 'Uploading…' : profilePhotoUrl ? 'Change photo' : 'Add a photo'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={profilePhotoUploading}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) saveProfilePhoto(file)
                }}
              />
            </label>
          </div>
          {profilePhotoPath && (
            <button
              type="button"
              disabled={profilePhotoUploading}
              onClick={removeProfilePhoto}
              className={`shrink-0 text-[12px] font-semibold ${t.faint} disabled:opacity-50`}
            >
              Remove
            </button>
          )}
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

          <button
            onClick={openSetupGuide}
            className="flex items-center justify-between px-5 py-4 text-left text-[15px] font-semibold"
          >
            Home screen & reminders
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round" className={t.faint}>
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>

          <button
            onClick={() => setScreen('referFriend')}
            className="flex items-center justify-between px-5 py-4 text-left text-[15px] font-semibold"
          >
            Refer a friend
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round" className={t.faint}>
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>

        </div>

        {practitionersLaunched && (
          <>
        <p className={`mb-2 mt-6 px-1 text-[12px] font-semibold uppercase tracking-wide ${t.faint}`}>
          Professional care
        </p>
        <div className={`flex flex-col divide-y overflow-hidden rounded-3xl ${t.surface} ${t.hair}`}>
          {practitionersLaunched && (
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
          )}

          {practitionersLaunched && (
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
          )}

          {practitionerStatus !== 'verified' && practitionersLaunched && (
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
          </>
        )}

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
            setProfilePhotoPath(null)
            setProfilePhotoUrl(null)
            // Products, routine, ticks: everything cached for this account.
            queryClient.clear()
            // Otherwise a stale 'verified' lingers if a different account
            // logs in next on the same device, sending a plain client
            // straight to someone else's practitioner dashboard.
            setPractitionerStatus(null)
            setScreen('welcome')
          }}
          className={`mt-4 w-full rounded-2xl border px-5 py-4 text-left text-[15px] font-semibold ${t.hair} ${t.danger}`}
        >
          Log out
        </button>

      </div>

    </main>
  )
}

if (screen === 'findProfessional') {
  return (
    <FindProfessionalScreen
      findProfessionalQuery={findProfessionalQuery}
      setFindProfessionalQuery={setFindProfessionalQuery}
      setScreen={setScreen}
      t={t}
      verifiedPractitioners={verifiedPractitioners}
      verifiedPractitionersLoading={verifiedPractitionersLoading}
      whatsappLink={whatsappLink}
    />
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
    <RemindersScreen
      busyAction={busyAction}
      diaryNudgeEnabled={diaryNudgeEnabled}
      getInstallEnv={getInstallEnv}
      isNight={isNight}
      morningReminderEnabled={morningReminderEnabled}
      morningReminderTime={morningReminderTime}
      nightReminderEnabled={nightReminderEnabled}
      nightReminderTime={nightReminderTime}
      onBack={() => setScreen('settings')}
      onSave={saveReminderSettings}
      openSetupGuide={openSetupGuide}
      pushStatus={pushStatus}
      renderBottomTabs={renderBottomTabs}
      runBusy={runBusy}
      setDiaryNudgeEnabled={setDiaryNudgeEnabled}
      setMorningReminderEnabled={setMorningReminderEnabled}
      setMorningReminderTime={setMorningReminderTime}
      setNightReminderEnabled={setNightReminderEnabled}
      setNightReminderTime={setNightReminderTime}
      setPushStatus={setPushStatus}
      setSpfReapplyEnabled={setSpfReapplyEnabled}
      spfReapplyEnabled={spfReapplyEnabled}
      subscribeToPushNotifications={subscribeToPushNotifications}
      t={t}
    />
  )
}
if (screen === 'careTeam') {
  return (
    <CareTeamScreen
      CARE_SCOPES={CARE_SCOPES}
      busyAction={busyAction}
      careAccessLog={careAccessLog}
      careRelationships={careRelationships}
      careTeamLoading={careTeamLoading}
      endedRelationships={endedRelationships}
      respondToCareInvite={respondToCareInvite}
      revokeCareAccess={revokeCareAccess}
      runBusy={runBusy}
      setScreen={setScreen}
      t={t}
      toggleCareScope={toggleCareScope}
      whatsappLink={whatsappLink}
    />
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
if (screen === 'challenges') {
  const active = myChallenges.filter(isLiveParticipation)
  const activeIds = new Set(active.map((p) => p.challenge_id))
  const discoverable = challenges.filter((c) => !activeIds.has(c.id) && !challengeWindow(c).ended)
  // Completed ones, plus ones that were still going when the window closed.
  const completed = myChallenges.filter(
    (p) => !isLiveParticipation(p) && (p.status === 'completed' || p.status === 'ended' || (p.status === 'active' && challengeWindow(p.challenges).ended))
  )
  const joinedIds = new Set(myChallenges.map((p) => p.challenge_id))
  // Ended challenges this person never joined — still worth seeing the results.
  const pastChallenges = challenges.filter((c) => challengeWindow(c).ended && !joinedIds.has(c.id))

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-10 pt-7">

        <button
          onClick={() => setScreen('today')}
          className={`-ml-2 flex items-center gap-1 self-start py-2 text-[15px] ${t.muted}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Today
        </button>

        <div className="mt-5">
          <h1 className="font-display text-[34px] font-light leading-[1.05] tracking-tight">
            Challenges
          </h1>
          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Small habits, built one day at a time.
          </p>
        </div>

        {challengesLoading && challenges.length === 0 ? (
          <p className={`mt-8 text-[13px] ${t.muted}`}>Loading…</p>
        ) : (
          <>
            {active.length > 0 && (
              <section className="mt-8">
                <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
                  Your active challenges
                </p>
                <div className="mt-3 flex flex-col gap-3">
                  {active.map((p) => renderChallengeProgressCard(p, 'challenges'))}
                </div>
              </section>
            )}

            <section className="mt-9">
              <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
                Discover challenges
              </p>

              {discoverable.length === 0 ? (
                <p className={`mt-3 text-[14px] leading-relaxed ${t.muted}`}>
                  You've joined every challenge available right now. New ones are on the way.
                </p>
              ) : (
                <div className="mt-3 flex flex-col gap-5">
                  {discoverable.map((c) => (
                    <div key={c.id} className={`overflow-hidden rounded-3xl ${t.surface}`}>
                      {renderChallengeImage(c, 'h-48 w-full')}
                      <div className="p-5">
                        <p className={`text-[12px] font-semibold uppercase tracking-wide ${t.faint}`}>
                          {(() => {
                            const w = challengeWindow(c)
                            if (!w.hasWindow) return `${c.duration_days} days`
                            if (w.notStarted) return `Starts ${formatChallengeDate(c.starts_on)}`
                            return `${formatChallengeDate(c.starts_on)} – ${formatChallengeDate(c.ends_on)} · ${w.daysLeft} ${w.daysLeft === 1 ? 'day' : 'days'} left`
                          })()}
                        </p>
                        <h2 className="mt-1 text-[20px] font-semibold">{c.title}</h2>
                        {c.tagline && (
                          <p className={`mt-1.5 text-[14px] leading-relaxed ${t.muted}`}>{c.tagline}</p>
                        )}
                        <button
                          type="button"
                          onClick={() => openChallenge(c.id, 'challenges')}
                          className={`mt-4 w-full rounded-2xl py-3.5 text-[15px] font-bold ${t.btn}`}
                        >
                          View challenge
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {completed.length + pastChallenges.length > 0 && (
              <section className="mt-9">
                <button
                  type="button"
                  onClick={() => setShowCompletedChallenges(!showCompletedChallenges)}
                  className={`flex w-full items-center justify-between rounded-2xl border ${t.hair} px-4 py-3.5 text-left`}
                >
                  <span className="text-[14px] font-semibold">
                    Finished challenges ({completed.length + pastChallenges.length})
                  </span>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round"
                    className={`transition ${showCompletedChallenges ? 'rotate-90' : ''}`}>
                    <path d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                {showCompletedChallenges && (
                  <div className="mt-3 flex flex-col gap-2.5">
                    {completed.map((p) => {
                      const finishedAll = p.status === 'completed'
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => openChallenge(p.challenge_id, 'challenges')}
                          className={`flex items-center gap-3 rounded-2xl ${t.surface} p-3.5 text-left`}
                        >
                          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
                            finishedAll || (challengeWindow(p.challenges).ended && p.days_completed > 0)
                              ? 'bg-amber-400/15'
                              : isNight ? 'bg-white/5' : 'bg-[#101B2D]/5'
                          }`}>
                            {renderAwardIcon(
                              { key: 'complete', kind: 'cup', metal: 'gold' },
                              30,
                              !(finishedAll || (challengeWindow(p.challenges).ended && p.days_completed > 0))
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-semibold">{p.challenges?.title}</span>
                            <span className={`block text-[12px] ${t.faint}`}>
                              {finishedAll
                                ? `Completed ${new Date(p.completed_at).toLocaleDateString('en-GB', {
                                    day: 'numeric', month: 'short', year: 'numeric',
                                  })}`
                                : `Ended ${formatChallengeDate(p.challenges.ends_on, true)} · ${p.days_completed}/${p.challenges.duration_days} days`}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                    {pastChallenges.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => openChallenge(c.id, 'challenges')}
                        className={`flex items-center gap-3 rounded-2xl border ${t.hair} p-3.5 text-left`}
                      >
                        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${isNight ? 'bg-white/5' : 'bg-[#101B2D]/5'}`}>
                          {renderAwardIcon({ key: 'complete', kind: 'cup', metal: 'gold' }, 30, true)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-semibold">{c.title}</span>
                          <span className={`block text-[12px] ${t.faint}`}>
                            Ended {formatChallengeDate(c.ends_on, true)} · See results
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}

      </div>
    </main>
  )
}

if (screen === 'adProduct' && adProduct) {
  const product = adProduct.product || {}
  return (
    <SponsoredProductScreen
      ad={adProduct}
      t={t}
      isNight={isNight}
      backLabel={({ discover: 'Discover', products: 'My products', today: 'Today' })[adProductReturn] || 'Back'}
      onBack={() => setScreen(adProductReturn)}
      onShop={() => {
        recordAdEvent(supabase, adProduct.placement_id, 'shop_click')
        window.open(withUtm(product.shop_url, adProduct.headline), '_blank', 'noopener')
      }}
      onAddProduct={() => {
        // Pre-filled from the brand's details; the person adds dates and saves.
        setProductBrand(adProduct.brand || '')
        setProductName(product.name || '')
        setProductIngredients(product.ingredients || '')
        setProductImageUrl(adProduct.image_url || '')
        setProductCategory(guessCategory(product.category || '') || guessCategory(product.name || ''))
        setAddProductReturnScreen('adProduct')
        setScreen('addProduct')
        adProductAddRef.current = adProduct.placement_id
      }}
    />
  )
}

if (screen === 'discover') {
  return (
    <DiscoverScreen
      challenges={challenges}
      isNight={isNight}
      myChallenges={myChallenges}
      onboardingCompleted={onboardingCompleted}
      openAd={openAd}
      openChallenge={openChallenge}
      renderBottomTabs={renderBottomTabs}
      renderChallengeImage={renderChallengeImage}
      setScreen={setScreen}
      t={t}
      userId={user?.id}
    />
  )
}

if (screen === 'challengeDetail') {
  return (
    <ChallengeDetailScreen
      openAd={openAd}
      userId={user?.id}
      awardSaving={awardSaving}
      busyAction={busyAction}
      challengeMenuOpen={challengeMenuOpen}
      challengeReturnScreen={challengeReturnScreen}
      challengeStats={challengeStats}
      challengeTarget={challengeTarget}
      challengeWindow={challengeWindow}
      challenges={challenges}
      challengesLoading={challengesLoading}
      formatChallengeDate={formatChallengeDate}
      goToMorningRoutine={goToMorningRoutine}
      isLiveParticipation={isLiveParticipation}
      isNight={isNight}
      joinChallenge={joinChallenge}
      leaveChallenge={leaveChallenge}
      missingAmSunscreen={missingAmSunscreen}
      myChallenges={myChallenges}
      renderAchievements={renderAchievements}
      renderAwardIcon={renderAwardIcon}
      renderChallengeImage={renderChallengeImage}
      renderLaurelIcon={renderLaurelIcon}
      renderSunscreenMissingNotice={renderSunscreenMissingNotice}
      runBusy={runBusy}
      saveAward={saveAward}
      selectedChallengeId={selectedChallengeId}
      setChallengeMenuOpen={setChallengeMenuOpen}
      setScreen={setScreen}
      shareChallenge={shareChallenge}
      t={t}
      todayString={todayString}
    />
  )
}

if (screen === 'challengeLeaderboard') {
  const challenge =
    challenges.find((c) => c.id === selectedChallengeId) ||
    myChallenges.find((p) => p.challenge_id === selectedChallengeId)?.challenges
  const total = challenge?.duration_days || 30
  const lbWindow = challengeWindow(challenge)
  const me = leaderboard.find((r) => r.is_me)
  const myParticipation = myChallenges.find(
    (p) => p.challenge_id === selectedChallengeId && p.status !== 'left'
  )
  const podium = leaderboard.slice(0, 3)
  const rest = leaderboard.slice(3)
  const PODIUM_METAL = ['gold', 'silver', 'bronze']

  const nameFor = (row) =>
    row.is_me ? 'You' : row.display_name || 'Private participant'

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-10 pt-7">

        <button
          onClick={() => setScreen('challengeDetail')}
          className={`-ml-2 flex items-center gap-1 self-start py-2 text-[15px] ${t.muted}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          {challenge?.title || 'Challenge'}
        </button>

        <div className="mt-5">
          <div className="mb-3">{renderLaurelIcon(56)}</div>
          <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${t.faint}`}>
            {challenge?.title}
          </p>
          <h1 className="mt-1 font-display text-[36px] font-light leading-[1.05] tracking-tight">
            {lbWindow.ended ? 'Final results' : 'Leaderboard'}
          </h1>
          <p className={`mt-2 text-[15px] leading-relaxed ${t.muted}`}>
            {lbWindow.ended
              ? 'Top finishers'
              : 'See where you stand.'}
          </p>
        </div>

        {me && (
          <div className="mt-6 flex items-center justify-between rounded-3xl bg-gradient-to-br from-[#F5C451]/20 to-[#E08A1E]/10 px-5 py-4">
            <div>
              <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${t.faint}`}>Your position</p>
              <p className="mt-0.5 text-[26px] font-semibold leading-tight">
                #{me.rank}
                <span className={`ml-1.5 text-[14px] font-normal ${t.muted}`}>of {leaderboard.length}</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-[20px] font-semibold leading-tight">{me.days_completed}</p>
              <p className={`text-[12px] ${t.muted}`}>of {total} days</p>
            </div>
          </div>
        )}

        {leaderboardLoading && leaderboard.length === 0 ? (
          <p className={`mt-8 text-[13px] ${t.muted}`}>Loading…</p>
        ) : leaderboard.length === 0 ? (
          <p className={`mt-8 text-[14px] leading-relaxed ${t.muted}`}>
            No one's on the board yet. Join and tick sunscreen tomorrow morning to take the top spot.
          </p>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-3 items-end gap-2.5">
              {[1, 0, 2].map((i) => {
                const row = podium[i]
                if (!row) return <span key={i} />
                return (
                  <div
                    key={i}
                    className={`flex flex-col items-center rounded-3xl px-2 pb-4 text-center ${
                      row.is_me ? 'ring-2 ring-amber-400/60' : ''
                    } ${t.surface} ${i === 0 ? 'pt-6' : 'pt-4'}`}
                  >
                    {renderAwardIcon(
                      { key: `podium-${i}`, kind: 'medal', metal: PODIUM_METAL[i], badge: String(row.rank) },
                      i === 0 ? 64 : 50
                    )}
                    <p className={`mt-2 w-full truncate text-[13px] font-semibold ${
                      !row.is_me && !row.display_name ? `italic ${t.faint}` : ''
                    }`}>
                      {nameFor(row)}
                    </p>
                    <p className={`text-[12px] ${t.muted}`}>
                      {row.days_completed}/{total} days
                    </p>
                    {lbWindow.ended ? (
                      <span className="mt-1.5 rounded-full bg-gradient-to-r from-[#F5C451] to-[#E08A1E] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                        {['Winner', 'Runner-up', 'Third place'][row.rank - 1]}
                      </span>
                    ) : row.status === 'completed' && (
                      <span className="mt-1.5 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-semibold text-amber-600">
                        Completed
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            {rest.length > 0 && (
              <div className={`mt-4 overflow-hidden rounded-3xl ${t.surface}`}>
                {rest.map((row, idx) => (
                  <div
                    key={row.rank}
                    className={`flex items-center gap-3.5 px-4 py-3.5 ${
                      idx > 0 ? `border-t ${t.hair}` : ''
                    } ${row.is_me ? 'bg-amber-400/10' : ''}`}
                  >
                    <span className={`w-7 shrink-0 text-center text-[13px] font-semibold tabular-nums ${t.faint}`}>
                      {row.rank}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className={`truncate text-[14px] font-medium ${
                          !row.is_me && !row.display_name ? `italic ${t.faint}` : ''
                        }`}>
                          {nameFor(row)}
                        </p>
                        {(lbWindow.ended || row.status === 'completed') && (
                          <span className="shrink-0 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-semibold text-amber-600">
                            Completed
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5">
                        {renderChallengeBar(
                          Math.round((row.days_completed / total) * 100),
                          'bg-gradient-to-r from-[#F5C451] to-[#E08A1E]'
                        )}
                      </div>
                    </div>
                    <span className="w-12 shrink-0 text-right text-[13px] font-semibold tabular-nums">
                      {row.days_completed}
                      <span className={`font-normal ${t.faint}`}>/{total}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {myParticipation && (
          <div className={`mt-8 flex items-center justify-between gap-6 border-t pt-4 ${t.hair}`}>
            <div>
              <p className="text-[13px] font-medium">Show my name</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={!myParticipation.hide_from_leaderboard}
              disabled={!!busyAction}
              onClick={() =>
                runBusy('leaderboardVisibility', () =>
                  setLeaderboardHidden(selectedChallengeId, !myParticipation.hide_from_leaderboard)
                )
              }
              className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
                myParticipation.hide_from_leaderboard
                  ? isNight ? 'bg-white/10 ring-1 ring-inset ring-white/20' : 'bg-[#101B2D]/8 ring-1 ring-inset ring-[#101B2D]/20'
                  : 'bg-amber-500'
              }`}
            >
              <span
                className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-all ${
                  myParticipation.hide_from_leaderboard ? 'left-[2px]' : 'left-4'
                }`}
              />
            </button>
          </div>
        )}

      </div>
    </main>
  )
}

if (screen === 'recommendationHistory') {
  return (
    <RecommendationHistoryScreen
      recommendationHistory={recommendationHistory}
      recommendationHistoryLoading={recommendationHistoryLoading}
      setScreen={setScreen}
      t={t}
    />
  )
}
if (screen === 'applyPractitioner') {
  return (
    <ApplyPractitionerScreen
      applyBio={applyBio}
      applyDisplayName={applyDisplayName}
      applyInstagram={applyInstagram}
      applySaving={applySaving}
      applySpecialisms={applySpecialisms}
      applyTitle={applyTitle}
      applyWhatsapp={applyWhatsapp}
      practitionerStatus={practitionerStatus}
      setApplyBio={setApplyBio}
      setApplyDisplayName={setApplyDisplayName}
      setApplyInstagram={setApplyInstagram}
      setApplySpecialisms={setApplySpecialisms}
      setApplyTitle={setApplyTitle}
      setApplyWhatsapp={setApplyWhatsapp}
      setScreen={setScreen}
      submitPractitionerApplication={submitPractitionerApplication}
      t={t}
    />
  )
}
if (screen === 'practitionerDashboard') {
  return (
    <PractitionerDashboardScreen
      SITE_URL={SITE_URL}
      applyDisplayName={applyDisplayName}
      busyAction={busyAction}
      cancelInvitation={cancelInvitation}
      displayName={displayName}
      openClientDetail={openClientDetail}
      pendingInvitations={pendingInvitations}
      pendingInvitationsLoading={pendingInvitationsLoading}
      practitionerClients={practitionerClients}
      practitionerClientsLoading={practitionerClientsLoading}
      practitionerRecommendations={practitionerRecommendations}
      runBusy={runBusy}
      setAddClientEmail={setAddClientEmail}
      setAddClientResult={setAddClientResult}
      setScreen={setScreen}
      shareClientInviteLink={shareClientInviteLink}
      t={t}
    />
  )
}
if (screen === 'practitionerClientDetail') {
  return (
    <PractitionerClientDetailScreen
      busyAction={busyAction}
      clientDetail={clientDetail}
      clientDetailLoading={clientDetailLoading}
      clientProducts={clientProducts}
      clientRoutineSteps={clientRoutineSteps}
      openComposer={openComposer}
      practitionerClients={practitionerClients}
      removeClient={removeClient}
      runBusy={runBusy}
      selectedClientId={selectedClientId}
      setScreen={setScreen}
      t={t}
    />
  )
}
if (screen === 'addClient') {
  return (
    <AddClientScreen
      addClientEmail={addClientEmail}
      addClientResult={addClientResult}
      addClientSaving={addClientSaving}
      addLinkLabel={addLinkLabel}
      addLinkSaving={addLinkSaving}
      createInviteLink={createInviteLink}
      inviteClientByEmail={inviteClientByEmail}
      setAddClientEmail={setAddClientEmail}
      setAddClientResult={setAddClientResult}
      setAddLinkLabel={setAddLinkLabel}
      setScreen={setScreen}
      shareClientInviteLink={shareClientInviteLink}
      t={t}
    />
  )
}
if (screen === 'composeRecommendation') {
  return (
    <ComposeRecommendationScreen
      addComposeItem={addComposeItem}
      clientDetail={clientDetail}
      composeConcerns={composeConcerns}
      composeGender={composeGender}
      composeGoals={composeGoals}
      composeIncludeSkinProfile={composeIncludeSkinProfile}
      composeItemBrand={composeItemBrand}
      composeItemCategory={composeItemCategory}
      composeItemDays={composeItemDays}
      composeItemName={composeItemName}
      composeItemReason={composeItemReason}
      composeItemSlot={composeItemSlot}
      composeItems={composeItems}
      composeNote={composeNote}
      composePregnant={composePregnant}
      composeSaving={composeSaving}
      composeSensitivity={composeSensitivity}
      composeSkinType={composeSkinType}
      practitionerClients={practitionerClients}
      removeComposeItem={removeComposeItem}
      selectedClientId={selectedClientId}
      setComposeConcerns={setComposeConcerns}
      setComposeGender={setComposeGender}
      setComposeGoals={setComposeGoals}
      setComposeIncludeSkinProfile={setComposeIncludeSkinProfile}
      setComposeItemBrand={setComposeItemBrand}
      setComposeItemCategory={setComposeItemCategory}
      setComposeItemDays={setComposeItemDays}
      setComposeItemName={setComposeItemName}
      setComposeItemReason={setComposeItemReason}
      setComposeItemSlot={setComposeItemSlot}
      setComposeNote={setComposeNote}
      setComposePregnant={setComposePregnant}
      setComposeSensitivity={setComposeSensitivity}
      setComposeSkinType={setComposeSkinType}
      setScreen={setScreen}
      submitRecommendation={submitRecommendation}
      t={t}
    />
  )
}
if (screen === 'practitionerRoutines') {
  return (
    <PractitionerRoutinesScreen
      practitionerRecommendations={practitionerRecommendations}
      practitionerRecommendationsLoading={practitionerRecommendationsLoading}
      recommendationsFilter={recommendationsFilter}
      setRecommendationsFilter={setRecommendationsFilter}
      setScreen={setScreen}
      t={t}
    />
  )
}
if (screen === 'today') {
  return (
    <TodayScreen
      amPlan={amPlan}
      amFinished={isRoutineFinished('AM')}
      pmFinished={isRoutineFinished('PM')}
      careRelationships={careRelationships}
      challengesLoading={challengesLoading}
      userId={user?.id}
      dailySkinTip={dailySkinTip}
      displayName={displayName}
      finishRoutine={finishRoutine}
      getInstallEnv={getInstallEnv}
      hideHomeAd={hideHomeAd}
      homeAd={homeAd}
      isLiveParticipation={isLiveParticipation}
      isNight={isNight}
      loadSkinProfile={loadSkinProfile}
      menuOpen={menuOpen}
      missingAmSunscreen={missingAmSunscreen}
      monthlyReport={monthlyReport}
      myChallenges={myChallenges}
      nightPlan={nightPlan}
      notify={notify}
      onboardingCompleted={onboardingCompleted}
      openAd={openAd}
      openProduct={openProduct}
      openSetupGuide={openSetupGuide}
      pendingRecommendations={pendingRecommendations}
      productImageFor={productImageFor}
      renderBottomTabs={renderBottomTabs}
      renderChallengeProgressCard={renderChallengeProgressCard}
      renderProductArt={renderProductArt}
      renderProfileAvatar={renderProfileAvatar}
      renderSunscreenMissingNotice={renderSunscreenMissingNotice}
      reportSharing={reportSharing}
      routinesLoading={routinesLoading}
      setMenuOpen={setMenuOpen}
      setScreen={setScreen}
      shareSkinReport={shareSkinReport}
      showLocalNotification={showLocalNotification}
      t={t}
      todayAmRoutine={todayAmRoutine}
      todayPmRoutine={todayPmRoutine}
      todayString={todayString}
      toggleStepCompletion={toggleStepCompletion}
    />
  )
}


if (screen === 'routinePlanner') {
  return (
    <RoutinePlannerScreen
      busyAction={busyAction}
      displayName={displayName}
      loadRoutineHistory={loadRoutineHistory}
      loadRoutines={loadRoutines}
      notify={notify}
      onboardingCompleted={onboardingCompleted}
      products={products}
      isNight={isNight}
      productImageFor={productImageFor}
      renderProductArt={renderProductArt}
      renderBottomTabs={renderBottomTabs}
      routinesLoading={routinesLoading}
      runBusy={runBusy}
      setAddProductReturnScreen={setAddProductReturnScreen}
      setOnboardingCompleted={setOnboardingCompleted}
      setScreen={setScreen}
      showLocalNotification={showLocalNotification}
      t={t}
      user={user}
    />
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
  const completedSteps = getCompletedSteps(user?.id)
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
    <main className={`relative min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="absolute inset-x-0 top-0 z-10 mx-auto w-full max-w-md px-4 pt-[max(16px,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={() => setScreen('today')}
          className={`flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Today
        </button>
      </div>

      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-6 pb-6 pt-16 text-center">

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

        <PhotoStreakShare
          streak={currentStreak}
          steps={slotSteps}
          routineLabel={slotLabel}
          t={t}
          notify={notify}
          shareUrl={SITE_URL}
        />

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
                  nightPlan.steps.filter((step) => getCompletedSteps(user?.id).includes(step.id))
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
  const viewingEntryIndex = journeyEntries.findIndex((entry) => entry.local_date === viewingPhoto?.local_date)
  const openJourneyEntry = (entry) => {
    setPhotoError(null)
    setViewingPhoto(entry)
    setViewingPhotoNote(entry.hasPhoto ? entry.note || entry.diaryNote || '' : entry.diaryNote || '')
  }
  const moveJourneyEntry = (offset) => {
    const entry = journeyEntries[viewingEntryIndex + offset]
    if (entry) openJourneyEntry(entry)
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
          <h1 className="font-display text-[36px] font-light leading-[1.05] tracking-tight">
            Skin diary
          </h1>

          <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
            Document your skin journey and see your progress over time.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <label className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border py-8 text-[13px] font-semibold ${t.hair} ${t.muted}`}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 8a2 2 0 0 1 2-2h1.2l.8-1.6A1 1 0 0 1 8.9 4h6.2a1 1 0 0 1 .9.6L16.8 6H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
            Take selfie
            <input
              type="file"
              accept="image/*"
              capture="user"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (!file) return
                setPendingPhoto({ file, previewUrl: URL.createObjectURL(file), date: localDateString(), note: '' })
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
            Upload from library
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (!file) return
                setPendingPhoto({ file, previewUrl: URL.createObjectURL(file), date: localDateString(), note: '' })
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

            <label className="mt-4 block text-[13px] font-semibold">Add notes</label>
            <textarea
              value={pendingPhoto.note}
              onChange={(event) => setPendingPhoto((photo) => ({ ...photo, note: event.target.value }))}
              placeholder="How are you feeling today?"
              rows={3}
              className={`mt-1.5 w-full rounded-xl border ${t.hair} p-3 text-[14px] outline-none`}
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
                  const saved = await uploadProgressPhoto(pendingPhoto.file, pendingPhoto.date, pendingPhoto.note)
                  if (saved) {
                    URL.revokeObjectURL(pendingPhoto.previewUrl)
                    setPendingPhoto(null)
                  }
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
                <p className={`text-[12px] ${t.faint}`}>Tap an entry to open it</p>
            )}
          </div>

          {journeyEntries.length === 0 ? (
            <p className={`mt-3 text-[13px] leading-relaxed ${t.muted}`}>
              No entries yet. Take a selfie or upload a photo to start your skin diary.
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-2.5">
              {journeyEntries.map((entry) => (
                <button
                  key={entry.local_date}
                  onClick={() => openJourneyEntry(entry)}
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
                    {(entry.diaryNote || entry.note) && (
                      <p className="mt-0.5 truncate text-[13px] leading-snug">
                        {entry.diaryNote || entry.note}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {viewingPhoto && (
          <div
            className="fixed inset-0 z-20 flex flex-col overflow-y-auto bg-black/90 px-6 py-8"
            onTouchStart={(event) => {
              const touch = event.touches[0]
              diaryTouchStartRef.current = { x: touch.clientX, y: touch.clientY }
            }}
            onTouchEnd={(event) => {
              const start = diaryTouchStartRef.current
              const touch = event.changedTouches[0]
              diaryTouchStartRef.current = null
              if (!start || Math.abs(touch.clientX - start.x) < 60 || Math.abs(touch.clientY - start.y) > Math.abs(touch.clientX - start.x)) return
              moveJourneyEntry(touch.clientX < start.x ? 1 : -1)
            }}
          >
            <button
              onClick={() => setViewingPhoto(null)}
              className="self-end rounded-full bg-white/10 px-4 py-2 text-[14px] font-semibold text-white"
            >
              Close
            </button>

            <div className="relative mt-4 flex min-h-[45vh] items-center justify-center">
              {viewingPhoto.hasPhoto && photoUrls[viewingPhoto.path] ? (
                <img src={photoUrls[viewingPhoto.path]} alt="Skin diary entry" className="max-h-[60vh] w-full object-contain" />
              ) : (
                <p className="text-[14px] text-white/70">Diary note</p>
              )}
              <button
                type="button"
                aria-label="Newer diary entry"
                disabled={viewingEntryIndex <= 0}
                onClick={() => moveJourneyEntry(-1)}
                className="absolute left-0 flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white disabled:opacity-30"
              >
                ‹
              </button>
              <button
                type="button"
                aria-label="Older diary entry"
                disabled={viewingEntryIndex < 0 || viewingEntryIndex >= journeyEntries.length - 1}
                onClick={() => moveJourneyEntry(1)}
                className="absolute right-0 flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white disabled:opacity-30"
              >
                ›
              </button>
            </div>

            <p className="mt-4 text-center text-[14px] text-white/80">
              {new Date(viewingPhoto.local_date + 'T00:00:00').toLocaleDateString('en-GB', {
                weekday: 'long', day: 'numeric', month: 'long',
              })}
            </p>

            <div className="mt-auto pt-4">
              <label htmlFor="diary-entry-note" className="text-[13px] font-semibold text-white">Add notes</label>
              <textarea
                id="diary-entry-note"
                value={viewingPhotoNote}
                onChange={(event) => setViewingPhotoNote(event.target.value)}
                placeholder="How are you feeling today?"
                rows={3}
                className="mt-2 w-full rounded-xl border border-white/20 bg-white/10 p-3 text-[14px] text-white placeholder-white/50"
              />
              <button
                type="button"
                disabled={!!busyAction}
                onClick={() => runBusy('saveDiaryNote', async () => {
                  const saved = viewingPhoto.hasPhoto
                    ? await saveProgressPhotoNote(viewingPhoto, viewingPhotoNote)
                    : await saveNoteForDate(viewingPhoto.local_date, viewingPhotoNote)
                  if (saved) {
                    setViewingPhoto((entry) => entry ? { ...entry, note: viewingPhotoNote, diaryNote: viewingPhotoNote } : entry)
                  }
                })}
                className={`mt-3 w-full rounded-xl px-4 py-3 text-[14px] font-bold disabled:opacity-50 ${t.btn}`}
              >
                {busyAction === 'saveDiaryNote' ? 'Saving…' : 'Save diary entry'}
              </button>
            </div>

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
      <Suspense fallback={<main className={`min-h-screen ${t.page}`} />}>
        {screenContent}
      </Suspense>

      {invitePreview && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/45 px-6">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-preview-title"
            className={`w-full max-w-sm rounded-3xl p-6 ${t.surface}`}
          >
            <p className={`text-[12px] font-semibold uppercase ${t.mark}`}>Professional invitation</p>
            <h2 id="invite-preview-title" className="mt-2 text-[22px] font-semibold">
              {invitePreview.display_name || 'A skincare professional'}
            </h2>
            {invitePreview.title && <p className={`mt-1 text-[14px] ${t.muted}`}>{invitePreview.title}</p>}
            {invitePreview.bio && <p className={`mt-3 text-[14px] leading-relaxed ${t.muted}`}>{invitePreview.bio}</p>}

            <p className="mt-5 text-[13px] font-semibold">They are requesting access to:</p>
            {invitePreview.scopes?.length ? (
              <ul className={`mt-2 flex flex-col gap-2 text-[13px] ${t.muted}`}>
                {invitePreview.scopes.map((scope) => (
                  <li key={scope} className="flex gap-2">
                    <span aria-hidden="true">•</span>
                    <span>{{
                      skin_profile: 'Your skin profile',
                      routine: 'Your skincare routine',
                      daily_logs: 'Your daily logs',
                      photos: 'Your progress photos',
                      pregnancy_status: 'Your pregnancy or breastfeeding status',
                    }[scope] || scope}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={`mt-2 text-[13px] ${t.muted}`}>Access details are unavailable.</p>
            )}

            <button
              type="button"
              disabled={invitePreviewBusy}
              onClick={acceptPreviewedInvite}
              className={`mt-6 w-full rounded-2xl px-4 py-3 text-[14px] font-bold ${t.btn} disabled:opacity-50`}
            >
              {invitePreviewBusy ? 'Connecting…' : 'Accept invitation'}
            </button>
            <button
              type="button"
              disabled={invitePreviewBusy}
              onClick={declinePreviewedInvite}
              className={`mt-2 w-full rounded-2xl border px-4 py-3 text-[14px] font-semibold ${t.hair} ${t.muted} disabled:opacity-50`}
            >
              Not now
            </button>
          </section>
        </div>
      )}

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

      {fullscreenAdsOn && screen === 'today' && user && onboardingCompleted && (
        <FullscreenAd userId={user.id} supabase={supabase} blocked={setupGuideOpen || Boolean(celebration)} onOpen={openAd} />
      )}

      {setupGuideOpen && (() => {
        const env = getInstallEnv()
        const installed = env.standalone
        const remindersOn = setupGuideStatus === 'reminders_on' || env.notifications === 'granted'

        const ShareIcon = (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="inline -mt-0.5 mx-0.5">
            <path d="M12 3v12M8 7l4-4 4 4" />
            <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
          </svg>
        )

        const stepMarker = (n, done) => (
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${
            done ? 'bg-emerald-500 text-white' : `border ${t.hair} ${t.muted}`
          }`}>
            {done ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            ) : n}
          </span>
        )

        const instruction = (items) => (
          <ol className={`mt-2 flex flex-col gap-1.5 text-[13px] leading-relaxed ${t.muted}`}>
            {items.map((item, i) => (
              <li key={i} className="flex gap-2">
                <span className={`shrink-0 tabular-nums ${t.faint}`}>{i + 1}.</span>
                <span>{item}</span>
              </li>
            ))}
          </ol>
        )

        let installBody
        if (installed) {
          installBody = <p className={`mt-1 text-[13px] ${t.muted}`}>Done — you're using the home-screen app.</p>
        } else if (env.inAppBrowser) {
          installBody = (
            <>
              <p className={`mt-1 text-[13px] leading-relaxed ${t.muted}`}>
                You're inside another app's browser, which can't install Tracka+. Open it in {env.isIOS ? 'Safari' : 'Chrome'} first:
              </p>
              {instruction([
                <>Tap the <b>⋯</b> menu and choose <b>Open in {env.isIOS ? 'Safari' : 'browser'}</b>, or copy the link below.</>,
                'Then come back to this guide there.',
              ])}
            </>
          )
        } else if (env.isIOS && !env.iosSafari) {
          installBody = (
            <>
              <p className={`mt-1 text-[13px] leading-relaxed ${t.muted}`}>On iPhone this works best in Safari:</p>
              {instruction([
                <>Open <b>trackaplus.app</b> in <b>Safari</b>.</>,
                <>Tap the Share button {ShareIcon} at the bottom.</>,
                <>Tap <b>Add to Home Screen</b>, then <b>Add</b>.</>,
              ])}
            </>
          )
        } else if (env.isIOS) {
          installBody = instruction([
            <><b>iPhone (Safari):</b> Tap the Share icon {ShareIcon} (or <b>•••</b> → <b>Share</b>) → <b>Add to Home Screen</b> → <b>Add</b>.</>,
          ])
        } else if (env.isAndroid) {
          installBody = (
            <>
              {installPromptEvent && (
                <button
                  type="button"
                  onClick={installFromPrompt}
                  className={`mt-3 rounded-xl px-4 py-2.5 text-[13px] font-semibold ${t.btn}`}
                >
                  Install Tracka+
                </button>
              )}
              {instruction([
                <><b>Android (Chrome):</b> Tap the three dots (⋮) → <b>Add to Home Screen</b> → <b>Install</b>.</>,
              ])}
            </>
          )
        } else if (installPromptEvent) {
          installBody = (
            <button
              type="button"
              onClick={installFromPrompt}
              className={`mt-3 rounded-xl px-4 py-2.5 text-[13px] font-semibold ${t.btn}`}
            >
              Install Tracka+
            </button>
          )
        } else {
          installBody = (
            <p className={`mt-1 text-[13px] leading-relaxed ${t.muted}`}>
              Open trackaplus.app on your phone — or use the install icon in your browser's address bar.
            </p>
          )
        }

        // iPhone only allows reminders inside the installed app.
        const remindersBlocked = env.isIOS && !installed

        return (
          <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center"
            onClick={snoozeSetupGuide}>
            <div
              className={`w-full max-w-md rounded-t-3xl px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-6 sm:rounded-3xl ${t.page}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={`mx-auto mb-5 h-1 w-10 rounded-full sm:hidden ${isNight ? 'bg-white/15' : 'bg-[#101B2D]/15'}`} />

              <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${t.mark}`}>Two quick steps</p>
              <h2 className="mt-1.5 font-display text-[28px] font-light leading-[1.1] tracking-tight">
                Never miss your routine
              </h2>
              <p className={`mt-2 text-[13px] leading-relaxed ${t.muted}`}>
                Keep Tracka+ one tap away, and let it remind you morning and night.
              </p>

              <div className="mt-6 flex gap-3.5">
                {stepMarker(1, installed)}
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold">How to Add Tracka+ to Your Home Screen</p>
                  {installBody}
                </div>
              </div>

              <div className={`my-5 border-t ${t.hair}`} />

              <div className={`flex gap-3.5 ${remindersBlocked ? 'opacity-60' : ''}`}>
                {stepMarker(2, remindersOn)}
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold">Turn on reminders</p>
                  {remindersOn ? (
                    <>
                      <p className={`mt-1 text-[13px] ${t.muted}`}>Reminders are on.</p>
                      <button
                        type="button"
                        onClick={async () => {
                          setSetupGuideOpen(false)
                          await loadReminderSettings()
                          setScreen('reminders')
                        }}
                        className={`mt-2 text-[13px] font-semibold ${t.mark}`}
                      >
                        Choose your reminder times →
                      </button>
                    </>
                  ) : remindersBlocked ? (
                    <p className={`mt-1 text-[13px] leading-relaxed ${t.muted}`}>
                      Do step 1 first, then open Tracka+ from your home screen — on iPhone, reminders only work there.
                    </p>
                  ) : (
                    <>
                      <p className={`mt-1 text-[13px] leading-relaxed ${t.muted}`}>
                        A gentle nudge when it's time for your routine.
                      </p>
                      <button
                        type="button"
                        disabled={busyAction === 'guidePush'}
                        onClick={() => runBusy('guidePush', turnOnRemindersFromGuide)}
                        className={`mt-3 rounded-xl px-4 py-2.5 text-[13px] font-semibold ${t.btn} disabled:opacity-60`}
                      >
                        {busyAction === 'guidePush' ? 'Turning on…' : 'Turn on reminders'}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {setupGuideStatus && setupGuideStatus !== 'reminders_on' && (
                <p className="mt-5 border-l-2 border-amber-400/80 pl-3 text-[12px] leading-relaxed text-amber-700">
                  {setupGuideStatus}
                </p>
              )}

              <button
                type="button"
                onClick={installed && remindersOn ? () => setSetupGuideOpen(false) : snoozeSetupGuide}
                className={`mt-7 w-full py-2 text-center text-[13px] font-semibold ${t.faint}`}
              >
                {installed && remindersOn ? 'Done' : 'Not now'}
              </button>
            </div>
          </div>
        )
      })()}

      {celebration && (() => {
        const cup = challengeAwards(
          (celebration.challenge_days || []).map((d) => d.local_date),
          challengeTarget(celebration.challenges),
          {
            overTheLine: challengeInProgress(celebration.challenges),
            challengeEnded: Boolean(celebration.finalDayCelebration),
          }
        ).find((a) => a.kind === 'cup')
        const checkedDays = celebration.days_completed || 0
        const finalDayCelebration = Boolean(celebration.finalDayCelebration)
        const CONFETTI = ['#E8B931', '#2554EB', '#F2C59A', '#8FB8E8', '#E86A5C', '#4CAF7A']

        return (
          <div className={`fixed inset-0 z-40 flex flex-col items-center justify-center overflow-hidden px-6 ${t.page}`}>
            <style>{`
              @keyframes tracka-confetti { 0% { transform: translateY(-10vh) rotate(0deg); opacity: 1 } 100% { transform: translateY(110vh) rotate(720deg); opacity: 0.9 } }
              @keyframes tracka-cup-pop { 0% { transform: scale(0.3) rotate(-8deg); opacity: 0 } 60% { transform: scale(1.12) rotate(3deg); opacity: 1 } 100% { transform: scale(1) rotate(0) } }
              @keyframes tracka-glow { 0%, 100% { opacity: 0.55 } 50% { opacity: 1 } }
              @media (prefers-reduced-motion: reduce) { .tracka-anim { animation: none !important } }
            `}</style>

            {Array.from({ length: 36 }).map((_, i) => (
              <span
                key={i}
                aria-hidden="true"
                className="tracka-anim pointer-events-none absolute top-0 block rounded-sm"
                style={{
                  left: `${(i * 37) % 100}%`,
                  width: i % 3 === 0 ? 6 : 9,
                  height: i % 3 === 0 ? 14 : 9,
                  background: CONFETTI[i % CONFETTI.length],
                  animation: `tracka-confetti ${2.6 + (i % 5) * 0.45}s linear ${(i % 9) * 0.18}s infinite`,
                }}
              />
            ))}

            <div className="relative flex items-center justify-center">
              <div
                aria-hidden="true"
                className="tracka-anim absolute h-72 w-72 rounded-full"
                style={{
                  background: 'radial-gradient(circle, rgba(232,185,49,0.45) 0%, rgba(232,185,49,0) 70%)',
                  animation: 'tracka-glow 2.4s ease-in-out infinite',
                }}
              />
              <div className="tracka-anim relative" style={{ animation: 'tracka-cup-pop 0.9s cubic-bezier(.2,.9,.3,1.2) both' }}>
                {renderAwardIcon(cup, 220, !cup.earned)}
              </div>
            </div>

            <p className="relative mt-6 text-[13px] font-semibold uppercase tracking-[0.2em] text-amber-500">
              {finalDayCelebration ? 'Every day counts!' : 'Challenge complete'}
            </p>
            <h2 className="relative mt-2 text-center font-display text-[40px] font-light leading-[1.05] tracking-tight">
              {finalDayCelebration ? 'Your SPF journey!' : celebration.challenges?.title}
            </h2>
            {finalDayCelebration && (
              <>
                <p className={`relative mt-3 max-w-xs text-center text-[15px] leading-relaxed ${t.muted}`}>
                  You showed up for your skin, and that&apos;s worth celebrating!
                </p>
                <p className="relative mt-3 text-[14px] font-semibold">
                  {checkedDays} of {celebration.challenges?.duration_days || 30} days checked in
                </p>
              </>
            )}
            <div className="relative mt-8 flex w-full max-w-sm flex-col gap-3">
              {cup?.earned && (
                <button
                  type="button"
                  disabled={!!awardSaving}
                  onClick={() => saveAward(cup, celebration)}
                  className={`w-full rounded-2xl py-4 text-base font-bold ${t.btn} disabled:opacity-60`}
                >
                  {awardSaving === 'complete' ? 'Preparing…' : 'Save my trophy'}
                </button>
              )}
              {finalDayCelebration && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedChallengeId(celebration.challenge_id)
                    dismissCelebration()
                    setScreen('challengeLeaderboard')
                  }}
                  className={`w-full rounded-2xl py-3.5 text-[15px] font-semibold ${t.btn}`}
                >
                  See the leaderboard
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  dismissCelebration()
                  setScreen('today')
                }}
                className={`w-full rounded-2xl border py-3.5 text-[15px] font-semibold ${t.hair} ${t.muted}`}
              >
                Continue my SPF journey
              </button>
            </div>
          </div>
        )
      })()}

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