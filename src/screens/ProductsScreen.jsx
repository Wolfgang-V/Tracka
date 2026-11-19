// My products — an overview of everything tracked: counts at the top (all,
// in the current routine, Empties), then rows for Opened, Closest expiry
// and Empties by month. "See all" or a count card opens the full list.
// Moved out of App.jsx; shared state still comes in as props.

import { useState } from 'react'
import SponsoredCard from '../ads/SponsoredCard'
import { useAds } from '../data/ads'
import { useRoutines } from '../data/routine'
import { supabase } from '../lib/supabase'

// Which full list is open ('all' | 'routine' | 'opened' | 'expiring' |
// 'expired' | 'empties'), or null for the overview. Remembered for the
// session so coming back from a product page returns to the same list.
const remembered = { view: null }
const rememberView = (v) => { remembered.view = v }

const DAY = 86400000
const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

// "1 month, 20 days" / "12 days" — the way the expiry row reads.
const humanDays = (days) => {
  if (days < 31) return `${days} ${days === 1 ? 'day' : 'days'}`
  const months = Math.floor(days / 30)
  const rest = days % 30
  return `${months} ${months === 1 ? 'month' : 'months'}${rest ? `, ${rest} ${rest === 1 ? 'day' : 'days'}` : ''}`
}

const openedFor = (item) => {
  if (!item.opened_date) return null
  return Math.max(0, Math.floor((Date.now() - new Date(item.opened_date + 'T00:00:00')) / DAY))
}

export default function ProductsScreen({
  isNight,
  openAd,
  userId,
  empties,
  getPaoStatus,
  onboardingCompleted,
  openProduct,
  productImageFor,
  productPhotoUrls,
  products,
  renderBottomTabs,
  renderProductArt,
  setAddProductReturnScreen,
  setScreen,
  showLocalNotification,
  t,
}) {
  const [view, setViewState] = useState(remembered.view)
  const setView = (v) => {
    rememberView(v)
    setViewState(v)
    window.scrollTo(0, 0)
  }
  // Sponsored product card: the first live one, if any campaign is running.
  const productAd = useAds(userId, 'product_card')[0] || null
  const { amSteps, pmSteps } = useRoutines(userId)

  // ---------------------------------------------------------- derived lists
  const inRoutineIds = new Set([...amSteps, ...pmSteps].map((s) => s.user_product_id))
  const withStatus = products.map((item) => ({ item, status: getPaoStatus(item) }))
  const inRoutine = withStatus.filter(({ item }) => inRoutineIds.has(item.id))
  // Everything ever tracked: on the shelf (expired and in-routine included)
  // plus Empties. Products removed as "added by mistake" aren't counted.
  const allTracked = [...withStatus, ...empties.map((item) => ({ item, status: null }))]
  const opened = withStatus
    .filter(({ item }) => item.opened_date)
    .sort((a, b) => (b.item.opened_date || '').localeCompare(a.item.opened_date || ''))
  // Expired: past its use-by date, or marked expired. Upcoming: everything
  // with a date still ahead, soonest first.
  const expired = withStatus
    .filter(({ status }) => status && (status.marked || status.daysLeft < 0))
    .sort((a, b) => b.status.daysLeft - a.status.daysLeft)
  const upcoming = withStatus
    .filter(({ status }) => status && !status.marked && status.daysLeft >= 0)
    .sort((a, b) => a.status.daysLeft - b.status.daysLeft)
  // Empties grouped by the month they were finished, newest first.
  const emptiesByMonth = []
  for (const item of empties) {
    const d = new Date(item.finished_at)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    let group = emptiesByMonth.find((g) => g.key === key)
    if (!group) {
      group = { key, label: d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }), items: [] }
      emptiesByMonth.push(group)
    }
    group.items.push(item)
  }

  // ---------------------------------------------------------- pieces
  // Secondary buttons: a lighter take on the skin-tip card's look (Today) —
  // white melting into a hint of brand blue, faint border and glow.
  const softButton = {
    className: `border ${isNight ? 'border-white/10' : 'border-[#1463F4]/[0.07] shadow-[0_6px_18px_-14px_rgba(20,99,244,0.3)]'} ${t.mark}`,
    style: {
      background: isNight
        ? 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(20,99,244,0.12) 100%)'
        : 'linear-gradient(135deg, #FFFFFF 0%, #F8FAFF 55%, #EDF3FF 100%)',
    },
  }

  const thumb = (item, size = 'h-12 w-12', dim = false) => {
    const url = productImageFor(item)
    // Own photos fill the tile; catalogue packshots (white background) are shown whole.
    const own = !!item.photo_path && !!productPhotoUrls[item.photo_path]
    return url ? (
      <img src={url} alt="" loading="lazy" className={`${size} shrink-0 rounded-xl ${
        own ? 'object-cover' : 'bg-white object-contain p-1'
      } ${dim ? 'opacity-70 grayscale-[35%]' : ''}`} />
    ) : (
      renderProductArt(
        item.products?.category,
        `${size} rounded-xl ${dim ? 'opacity-70 grayscale-[35%]' : ''}`,
        size.includes('w-full') ? 'h-[70%] w-[70%]' : 'h-[82%] w-[82%]'
      )
    )
  }

  const tone = (status) =>
    status.daysLeft <= 0 ? t.danger : status.daysLeft <= 7 ? 'text-amber-600' : status.daysLeft <= 30 ? 'text-amber-600/80' : t.muted

  const expiryText = (status) =>
    status.marked
      ? 'Marked expired'
      : status.daysLeft < 0
      ? `Expired ${humanDays(Math.abs(status.daysLeft))} ago`
      : status.daysLeft === 0
      ? 'Expires today'
      : `Expires in ${humanDays(status.daysLeft)}`

  const Icon = ({ d, className = '' }) => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
      strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`}>
      <path d={d} />
    </svg>
  )
  const ICONS = {
    clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    bottles: 'M8 3h3v3H8zM6.5 6h6l.8 3v11a1 1 0 0 1-1 1H6.7a1 1 0 0 1-1-1V9zM15.5 9h3l.5 2v9a1 1 0 0 1-1 1h-3',
    calendar: 'M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
    empty: 'M8 3h8M9 3v3l-2 3v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9l-2-3V3',
  }

  // A product card in a horizontal row (or the "See all" grid).
  const card = ({ item, status }, meta, wide = false) => (
    <button
      key={item.id}
      type="button"
      onClick={() => openProduct(item.id)}
      className={`${wide ? 'w-full' : 'w-[148px] shrink-0 snap-start'} rounded-2xl ${t.surface} p-3 text-left`}
    >
      {thumb(item, 'aspect-square w-full', !!status?.marked || !!item.finished_at)}
      <p className={`mt-2.5 truncate text-[10px] font-semibold uppercase tracking-wide ${t.faint}`}>{item.products?.brand}</p>
      <p className="line-clamp-2 min-h-[2.4em] text-[13px] font-semibold leading-snug">{item.products?.name}</p>
      {meta}
    </button>
  )

  const metaLine = (iconD, text, cls) => (
    <p className={`mt-1.5 flex items-center gap-1 text-[11px] font-medium ${cls || t.faint}`}>
      <Icon d={iconD} />
      <span className="truncate">{text}</span>
    </p>
  )

  const rowHeader = (title, count, target, accent) => (
    <div className="mb-3 mt-8 flex items-end justify-between px-1">
      <h2 className={`text-[18px] font-semibold ${accent || ''}`}>{title}</h2>
      {count > 0 && (
        <button type="button" onClick={() => setView(target)} className={`text-[12.5px] font-medium ${t.faint}`}>
          <span className="tabular-nums">{count}</span> · <span className={t.mark}>See all</span>
        </button>
      )}
    </div>
  )

  // Scroll rows bleed to the screen edge (the -mx/px pair) like the reference.
  const scrollRow = (children) => (
    <div className="-mx-6 flex snap-x gap-3 overflow-x-auto px-6 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {children}
    </div>
  )

  const statCard = (label, sub, count, iconD, target, tint) => (
    <button
      type="button"
      onClick={() => setView(target)}
      className={`flex w-[168px] shrink-0 snap-start items-center gap-3 rounded-2xl ${t.surface} p-3.5 text-left`}
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tint}`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
          strokeLinecap="round" strokeLinejoin="round"><path d={iconD} /></svg>
      </span>
      <span className="min-w-0">
        <span className="block text-[17px] font-semibold leading-tight">{label}</span>
        <span className={`block truncate text-[12px] ${t.faint}`}>{sub} · <span className="tabular-nums">{count}</span></span>
      </span>
    </button>
  )

  const row = ({ item }, right, sub, dim) => (
    <button
      key={item.id}
      type="button"
      onClick={() => openProduct(item.id)}
      className={`flex w-full items-center gap-3 rounded-2xl ${t.surface} p-3 text-left`}
    >
      {thumb(item, 'h-12 w-12', dim)}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium">{item.products?.name}</span>
        <span className={`block truncate text-[12px] ${t.faint}`}>{sub}</span>
      </span>
      {right}
    </button>
  )

  const lasted = (item) => {
    const start = item.opened_date ? new Date(item.opened_date + 'T00:00:00') : new Date(item.added_at)
    const days = Math.max(1, Math.round((new Date(item.finished_at) - start) / DAY))
    return days >= 60 ? `${Math.round(days / 30)} months` : days >= 14 ? `${Math.round(days / 7)} weeks` : `${days} ${days === 1 ? 'day' : 'days'}`
  }

  const header = (
    <>
      <button
        onClick={() => (view ? setView(null) : window.history.back())}
        className={`-ml-2 flex items-center gap-1 py-2 text-[15px] ${t.muted}`}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
        {view ? 'My products' : 'Back'}
      </button>
    </>
  )

  // ---------------------------------------------------------- full lists
  if (view) {
    const LISTS = {
      all: ['All tracked', allTracked],
      routine: ['In current routine', inRoutine],
      opened: ['Opened', opened],
      expiring: ['Closest expiry', upcoming],
      expired: ['Expired', expired],
    }
    return (
      <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
        <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-28 pt-7">
          {header}
          {view === 'empties' ? (
            <>
              <h1 className="mt-4 font-display text-[32px] font-light leading-tight">Empties</h1>
              <p className={`mt-1 text-[14px] ${t.muted}`}>Everything you&apos;ve used up, by month.</p>
              {emptiesByMonth.length === 0 ? (
                <p className={`mt-6 text-[14px] leading-relaxed ${t.muted}`}>
                  Finished a product? Open it and tap <b>Mark as finished</b>. It&apos;ll be kept here as a record.
                </p>
              ) : emptiesByMonth.map((g) => (
                <div key={g.key}>
                  <p className={`mb-2 mt-6 flex justify-between px-1 text-[13px] font-semibold ${t.muted}`}>
                    <span>{g.label}</span><span className="tabular-nums">{g.items.length}</span>
                  </p>
                  <div className="flex flex-col gap-2">
                    {g.items.map((item) => row({ item }, null, `Finished ${fmtDate(item.finished_at)} · lasted ${lasted(item)}`, true))}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <>
              <h1 className="mt-4 font-display text-[32px] font-light leading-tight">{LISTS[view][0]}</h1>
              <p className={`mt-1 text-[14px] tabular-nums ${t.muted}`}>{LISTS[view][1].length} {LISTS[view][1].length === 1 ? 'product' : 'products'}</p>
              {view === 'expiring' || view === 'expired' ? (
                <div className="mt-5 flex flex-col gap-2">
                  {LISTS[view][1].map((entry) => row(
                    entry,
                    <span className={`shrink-0 text-right text-[11.5px] font-semibold ${tone(entry.status)}`}>
                      {entry.status.marked ? 'Marked' : entry.status.daysLeft < 0 ? 'Expired' : humanDays(entry.status.daysLeft)}
                    </span>,
                    entry.status.marked ? `Marked expired ${fmtDate(entry.status.expires)}` : `Use by ${fmtDate(entry.status.expires)}`,
                    view === 'expired'
                  ))}
                </div>
              ) : LISTS[view][1].length === 0 ? (
                <p className={`mt-6 text-[14px] leading-relaxed ${t.muted}`}>
                  {view === 'routine' ? 'None of your products are in a routine yet — build one from My routine.' : 'Nothing here yet.'}
                </p>
              ) : (
                <div className="mt-5 grid grid-cols-2 gap-3">
                  {LISTS[view][1].map((entry) => card(
                    entry,
                    entry.item.finished_at
                      ? metaLine(ICONS.empty, `Finished ${fmtDate(entry.item.finished_at)}`)
                      : entry.status && entry.status.daysLeft <= 30
                      ? metaLine(ICONS.clock, expiryText(entry.status), `font-semibold ${tone(entry.status)}`)
                      : inRoutineIds.has(entry.item.id)
                      ? metaLine(ICONS.check, 'In routine')
                      : openedFor(entry.item) !== null
                      ? metaLine(ICONS.clock, `Open ${humanDays(openedFor(entry.item))}`)
                      : null,
                    true
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        {onboardingCompleted && renderBottomTabs('products', t)}
      </main>
    )
  }

  // ---------------------------------------------------------- overview
  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-28 pt-7">
        {header}

        <div className="mt-5">
          {/* Onboarding wording only while someone is still onboarding — this
              is also the everyday My products tab. */}
          <p className={`text-[13px] font-semibold uppercase tracking-wide ${t.mark}`}>
            {onboardingCompleted ? 'Your shelf' : 'Step 2 of 3'}
          </p>
          <h1 className="mt-2 font-display text-[36px] font-light leading-[1.05] tracking-tight">
            {onboardingCompleted ? 'My products' : 'Add your products'}
          </h1>
          {!onboardingCompleted && (
            <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
              Add the products you already own so Tracka+ can organize them for you.
            </p>
          )}
        </div>

        {products.length === 0 && empties.length === 0 ? (
          <div className={`mt-6 rounded-3xl ${t.surface} p-6 text-center`}>
            <p className="text-[16px] font-semibold">Your shelf is empty</p>
            <p className={`mt-1.5 text-[14px] leading-relaxed ${t.muted}`}>
              Add the products you use and Tracka+ will track what&apos;s open, what&apos;s expiring and what you&apos;ve finished.
            </p>
          </div>
        ) : (
          <>
            {/* Counts */}
            <div className="mt-6">
              {scrollRow(
                <>
                  {statCard('All', 'tracked', allTracked.length, ICONS.bottles, 'all', isNight ? 'bg-white/10' : 'bg-[#1463F4]/10 text-[#1463F4]')}
                  {statCard('In routine', 'current', inRoutine.length, ICONS.calendar, 'routine', isNight ? 'bg-white/10' : 'bg-violet-500/10 text-violet-600')}
                  {statCard('Empties', 'used up', empties.length, ICONS.empty, 'empties', isNight ? 'bg-white/10' : 'bg-emerald-500/10 text-emerald-600')}
                </>
              )}
            </div>

            {/* Opened — most recently opened first */}
            {opened.length > 0 && (
              <>
                {rowHeader('Opened', opened.length, 'opened')}
                {scrollRow(opened.slice(0, 10).map((entry) =>
                  card(entry, metaLine(ICONS.clock, `Open ${humanDays(openedFor(entry.item))}`))
                ))}
              </>
            )}

            {/* Closest expiry — expired count tile, then soonest first */}
            {(expired.length > 0 || upcoming.length > 0) && (
              <>
                {rowHeader('Closest expiry', upcoming.length + expired.length, upcoming.length ? 'expiring' : 'expired', 'text-rose-500')}
                {scrollRow(
                  <>
                    {expired.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setView('expired')}
                        className="flex w-[110px] shrink-0 snap-start flex-col justify-center rounded-2xl p-4 text-left"
                        style={{ background: isNight ? 'linear-gradient(160deg, rgba(244,63,94,0.25), rgba(244,63,94,0.1))' : 'linear-gradient(160deg, #FFE4E6, #FECDD3)' }}
                      >
                        <span className="text-[34px] font-semibold leading-none text-rose-500 tabular-nums">{expired.length}</span>
                        <span className="mt-2 text-[13px] font-medium leading-tight text-rose-500/80">{expired.length === 1 ? 'expired' : 'expired'}</span>
                      </button>
                    )}
                    {upcoming.slice(0, 10).map((entry) =>
                      card(entry, metaLine(ICONS.clock, expiryText(entry.status), `font-semibold ${tone(entry.status)}`))
                    )}
                  </>
                )}
              </>
            )}

            {/* Your products, if nothing has been opened yet — so the
                shelf is never just counts. */}
            {opened.length === 0 && products.length > 0 && (
              <>
                {rowHeader('Your products', products.length, 'all')}
                {scrollRow(withStatus.slice(0, 10).map((entry) =>
                  card(entry, inRoutineIds.has(entry.item.id) ? metaLine(ICONS.check, 'In routine') : null)
                ))}
              </>
            )}

            {/* Empties by month */}
            {rowHeader('Empties', empties.length, 'empties')}
            {emptiesByMonth.length === 0 ? (
              <p className={`px-1 text-[13px] leading-relaxed ${t.muted}`}>
                Finished a product? Open it and tap <b>Mark as finished</b>. It&apos;ll be kept here as a record.
              </p>
            ) : scrollRow(emptiesByMonth.map((g) => (
              <button
                key={g.key}
                type="button"
                onClick={() => setView('empties')}
                className={`w-[168px] shrink-0 snap-start rounded-2xl ${t.surface} p-3.5 text-left`}
              >
                <span className="flex items-center justify-between text-[14px] font-semibold">
                  <span>{g.label}</span>
                  <span className={`tabular-nums ${t.faint}`}>{g.items.length}</span>
                </span>
                <span className="mt-3 flex -space-x-2">
                  {g.items.slice(0, 4).map((item) => (
                    <span key={item.id} className={`overflow-hidden rounded-xl ring-2 ${isNight ? 'ring-[#101B2D]' : 'ring-white'}`}>
                      {thumb(item, 'h-10 w-10', true)}
                    </span>
                  ))}
                </span>
              </button>
            )))}
          </>
        )}

        {productAd && (
          <div className="mt-8">
            <SponsoredCard ad={productAd} supabase={supabase} t={t} isNight={isNight} onOpen={openAd} />
          </div>
        )}

        <div className="mt-2">
          <button
            onClick={() => {
              setAddProductReturnScreen('products')
              setScreen('addProduct')
            }}
            className={`mt-6 w-full rounded-2xl py-[18px] text-base font-bold ${softButton.className}`}
            style={softButton.style}
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
              className={`flex-1 rounded-2xl px-5 py-3.5 text-[15px] font-semibold ${softButton.className}`}
              style={softButton.style}
            >
              Back to today
            </button>
            <button
              onClick={() => setScreen('ingredientChecker')}
              className={`flex-1 rounded-2xl px-5 py-3.5 text-[15px] font-semibold ${softButton.className}`}
              style={softButton.style}
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
