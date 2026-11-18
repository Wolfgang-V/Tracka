// Discover: a sliding featured carousel (sponsored picks when a campaign is
// live, one challenge, the lesson of the day, the tour), ingredient lessons
// from our own ingredient guide, and a first look at Tracka AI (coming soon).

import { Children, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAds } from '../data/ads'
import { INGREDIENT_DETAILS } from '../lib/core/ingredientGuide'
import { recordAdClick, useViewableImpression } from '../ads/useViewableImpression'

// Lesson cards rotate daily so the row feels fresh without new content.
const LESSONS_PER_DAY = 8
const shortName = (name) => name.replace(/\s*\(.*\)\s*/, '').trim()

// Soft art for lesson cards, picked by ingredient class so related ones match.
const LESSON_ART = [
  'from-[#EAF1FF] via-[#D6E4FF] to-[#B9CFFF]',
  'from-[#FDEFE6] via-[#F9DCCB] to-[#F2C3A6]',
  'from-[#EEF7EE] via-[#D9EEDB] to-[#BCDDC0]',
  'from-[#F6EEFB] via-[#E9DAF5] to-[#D5BDEB]',
  'from-[#FFF6DD] via-[#FBEABA] to-[#F3D78A]',
]
const artFor = (cls = '') => LESSON_ART[[...cls].reduce((n, c) => n + c.charCodeAt(0), 0) % LESSON_ART.length]

function todaysLessons() {
  const day = Math.floor(Date.now() / 86_400_000)
  const start = (day * LESSONS_PER_DAY) % INGREDIENT_DETAILS.length
  return Array.from({ length: LESSONS_PER_DAY }, (_, i) => INGREDIENT_DETAILS[(start + i) % INGREDIENT_DETAILS.length])
}

export default function DiscoverScreen({
  challenges,
  isNight,
  myChallenges,
  onboardingCompleted,
  openAd,
  openChallenge,
  renderBottomTabs,
  renderChallengeImage,
  setScreen,
  t,
  userId,
}) {
  const [sheet, setSheet] = useState(null) // { kind: 'lesson', item }
  const ads = useAds(userId, 'discover_card')
  const lessons = useMemo(() => todaysLessons(), [])

  const joined = new Map((myChallenges || []).filter((p) => p.status === 'active').map((p) => [p.challenge_id, p]))
  const openChallenges = (challenges || []).filter((c) => {
    if (!c.ends_on) return true
    return new Date(`${c.ends_on}T23:59:59`) >= new Date()
  })
  // One challenge slide: the one you're in, else the first open one. The
  // rest are a tap away on the challenges screen. Between rounds (nothing
  // open), the most recent one stays up as "Ended", so the slide never
  // disappears.
  const latestEnded = (challenges || [])
    .filter((c) => !openChallenges.includes(c))
    .sort((a, b) => (b.ends_on || '').localeCompare(a.ends_on || ''))[0]
  const featuredChallenge = openChallenges.find((c) => joined.has(c.id)) || openChallenges[0] || latestEnded
  const featuredEnded = !!featuredChallenge && featuredChallenge === latestEnded

  const tag = {
    neutral: isNight ? 'bg-white/10 text-white/80' : 'bg-[#101B2D]/[0.06] text-[#101B2D]/75',
    blue: isNight ? 'bg-[#1463F4]/25 text-[#8DB4FF]' : 'bg-[#1463F4]/10 text-[#1463F4]',
    sponsored: isNight ? 'bg-violet-500/20 text-violet-300' : 'bg-violet-500/10 text-violet-700',
  }

  return (
    <main className={`min-h-screen ${t.page} transition-colors duration-500`}>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-32 pt-7">
        <h1 className="font-display text-[34px] font-light leading-[1.05] tracking-tight">Discover</h1>
        <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>
          Challenges, ingredient lessons and what's coming to Tracka+.
        </p>

        {/* Featured: one card at a time, sliding by itself (or swiped).
            Sponsored picks first (labelled), then one challenge, the lesson
            of the day and the tour. */}
        <section className="mt-8">
          <h2 className="text-[19px] font-semibold">Discover on Tracka+</h2>
          <Carousel isNight={isNight}>
          {ads.map((ad) => (
            <SponsoredDiscoverCard key={ad.placement_id} ad={ad} isNight={isNight} onOpen={openAd} />
          ))}
          {featuredChallenge && (() => {
            const c = featuredChallenge
            const mine = joined.get(c.id)
            return (
              <Card
                wide
                key="challenge"
                t={t}
                isNight={isNight}
                onClick={() => openChallenge(c.id, 'discover')}
                art={renderChallengeImage(c, 'h-full w-full')}
                pill={featuredEnded ? 'Ended' : c.sponsor_name || `${c.duration_days} days`}
                tag="Challenge"
                tagClass={featuredEnded ? tag.neutral : tag.blue}
                title={c.title}
                body={featuredEnded ? 'This round has ended. New challenges are coming soon.' : c.tagline}
                cta={featuredEnded
                  ? 'See results'
                  : mine ? `Continue · day ${Math.min((mine.days_completed || 0) + 1, c.duration_days)}` : 'View challenge'}
                more={{ label: 'More challenges', onClick: () => setScreen('challenges') }}
              />
            )
          })()}
          {lessons[0] && (
            <Card
              wide
              key="lesson-of-the-day"
              t={t}
              isNight={isNight}
              onClick={() => setSheet({ kind: 'lesson', item: lessons[0] })}
              art={
                <div className={`flex h-full w-full items-start bg-gradient-to-br p-5 ${artFor(lessons[0].class)}`}>
                  <span className="line-clamp-2 font-display text-[34px] font-light leading-[1.05] text-[#101B2D]/80">{shortName(lessons[0].ingredient)}</span>
                </div>
              }
              pill="Lesson of the day"
              tag="Ingredient guide"
              tagClass={tag.blue}
              title={`What does ${shortName(lessons[0].ingredient)} do?`}
              body={lessons[0].about}
              cta="Read lesson"
            />
          )}
          <Card
            wide
            key="tour"
            t={t}
            isNight={isNight}
            onClick={() => setScreen('featureGuide')}
            art={
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#1463F4] via-[#3D7BF7] to-[#8DB4FF]">
                <img src="/logo%202.jpg" alt="" className="h-24 w-24 rounded-3xl object-cover" />
              </div>
            }
            pill="Tracka+"
            tag="How it works"
            tagClass={tag.neutral}
            title="Get the most out of Tracka+"
            body="A quick tour of every feature, from routines to challenges."
            cta="Take the tour"
          />
          </Carousel>
        </section>

        <Row title="Ingredient guide" t={t}>
          {lessons.slice(1).map((item) => (
            <Card
              key={item.ingredient}
              t={t}
              isNight={isNight}
              onClick={() => setSheet({ kind: 'lesson', item })}
              art={
                <div className={`flex h-full w-full items-start bg-gradient-to-br p-5 ${artFor(item.class)}`}>
                  <span className="line-clamp-2 font-display text-[32px] font-light leading-[1.05] text-[#101B2D]/80">
                    {shortName(item.ingredient)}
                  </span>
                </div>
              }
              pill={item.class}
              tag="Ingredient guide"
              tagClass={tag.blue}
              title={`What does ${shortName(item.ingredient).toLowerCase().startsWith('vitamin') ? shortName(item.ingredient) : shortName(item.ingredient).toLowerCase()} do?`}
              body={item.about}
              cta="Read lesson"
            />
          ))}
        </Row>

        <TrackaAiTeaser isNight={isNight} t={t} />
      </div>

      {sheet?.kind === 'lesson' && <LessonSheet item={sheet.item} t={t} isNight={isNight} onClose={() => setSheet(null)} />}

      {onboardingCompleted && renderBottomTabs('discover', t)}
    </main>
  )
}

// ------------------------------------------------------------------ pieces

const SLIDE_EVERY_MS = 5000

// One full-width slide at a time. Advances every few seconds, pauses for a
// while once the person touches it, skips while the tab is hidden, and
// stays still for anyone who has reduced motion turned on.
function Carousel({ isNight, children }) {
  const slides = Children.toArray(children).filter(Boolean)
  const count = slides.length
  const ref = useRef(null)
  const pausedUntil = useRef(0)
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (count < 2) return undefined
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined
    const timer = setInterval(() => {
      const el = ref.current
      if (!el || document.hidden || performance.now() < pausedUntil.current) return
      const next = (Math.round(el.scrollLeft / el.clientWidth) + 1) % count
      el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' })
    }, SLIDE_EVERY_MS)
    return () => clearInterval(timer)
  }, [count])

  // Event timestamps share performance.now()'s clock.
  const pause = (e) => { pausedUntil.current = e.timeStamp + 10_000 }
  const goTo = (e, i) => {
    pause(e)
    ref.current?.scrollTo({ left: i * ref.current.clientWidth, behavior: 'smooth' })
  }

  return (
    <div className="mt-4">
      <div
        ref={ref}
        onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
        onPointerDown={pause}
        onTouchStart={pause}
        className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((slide, i) => (
          <div key={slide.key ?? i} className="w-full shrink-0 snap-center snap-always">
            {slide}
          </div>
        ))}
      </div>
      {count > 1 && (
        <div className="mt-3 flex justify-center gap-1.5">
          {slides.map((slide, i) => (
            <button
              key={slide.key ?? i}
              type="button"
              aria-label={`Show card ${i + 1} of ${count}`}
              onClick={(e) => goTo(e, i)}
              className={`h-1.5 rounded-full transition-all ${
                i === index ? 'w-5 bg-[#1463F4]' : isNight ? 'w-1.5 bg-white/25' : 'w-1.5 bg-[#101B2D]/20'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}


function Scroller({ children }) {
  return (
    <div className="-mx-6 mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-6 px-6 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {children}
    </div>
  )
}

function Row({ title, t, action, children }) {
  const hasCards = Array.isArray(children) ? children.flat().some(Boolean) : !!children
  return (
    <section className="mt-9">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[19px] font-semibold">{title}</h2>
        {action ? (
          <button type="button" onClick={action.onClick} className={`shrink-0 text-[13px] font-semibold ${t.mark}`}>
            {action.label} →
          </button>
        ) : (
          hasCards && <span className={`shrink-0 text-[13px] ${t.faint}`}>Swipe to explore →</span>
        )}
      </div>
      {hasCards && <Scroller>{children}</Scroller>}
    </section>
  )
}

// `more` adds a second link beside the CTA (e.g. "More challenges"). A
// button can't hold another button, so then the card is a plain box with
// two buttons in it.
function Card({ t, isNight, onClick, art, pill, tag, tagClass, title, body, cta, cardRef, wide = false, more = null }) {
  const shell = `flex ${wide ? 'h-full w-full' : 'w-[80%] max-w-[300px] shrink-0 snap-start'} flex-col rounded-3xl border p-3 text-left ${
    isNight ? 'border-white/10' : 'border-[#101B2D]/[0.08] shadow-[0_8px_24px_-18px_rgba(16,27,45,0.35)]'
  } ${t.surface}`
  if (more) {
    return (
      <div ref={cardRef} className={shell}>
        <button type="button" onClick={onClick} className="flex flex-1 flex-col text-left">
          <CardBody t={t} art={art} pill={pill} tag={tag} tagClass={tagClass} title={title} body={body} />
        </button>
        <div className="flex items-center justify-between gap-3 px-1.5 pb-1.5 pt-3">
          <button type="button" onClick={onClick} className={`text-[14px] font-semibold ${t.mark}`}>{cta} →</button>
          <button type="button" onClick={more.onClick} className={`shrink-0 text-[13px] font-semibold ${t.muted}`}>{more.label} →</button>
        </div>
      </div>
    )
  }
  return (
    <button ref={cardRef} type="button" onClick={onClick} className={shell}>
      <CardBody t={t} art={art} pill={pill} tag={tag} tagClass={tagClass} title={title} body={body} cta={cta} />
    </button>
  )
}

function CardBody({ t, art, pill, tag, tagClass, title, body, cta }) {
  return (
    <>
      <span className="relative block h-44 w-full overflow-hidden rounded-2xl">
        {art}
        {pill && (
          <span className="absolute bottom-2.5 left-2.5 max-w-[85%] truncate rounded-full bg-black/55 px-3 py-1 text-[12px] font-medium text-white backdrop-blur">
            {pill}
          </span>
        )}
      </span>
      <span className="flex flex-1 flex-col px-1.5 pb-1.5 pt-3.5">
        {tag && (
          <span className={`self-start rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${tagClass}`}>
            {tag}
          </span>
        )}
        <span className="mt-2.5 line-clamp-2 text-[17px] font-semibold leading-snug">{title}</span>
        {body && <span className={`mt-1.5 line-clamp-2 text-[13.5px] leading-relaxed ${t.muted}`}>{body}</span>}
        {cta && <span className={`mt-auto pt-3 text-[14px] font-semibold ${t.mark}`}>{cta} →</span>}
      </span>
    </>
  )
}

// Sponsored card, in the carousel: clearly labelled, with the brand's
// image and one clear button ("Explore product" opens the product page).
export function SponsoredDiscoverCard({ ad, isNight, onOpen }) {
  const ref = useRef(null)
  useViewableImpression(ref, supabase, ad.placement_id)
  let host = ''
  try { host = new URL(ad.product?.shop_url || ad.action_target || ad.landing_url).hostname.replace(/^www./, '') } catch { /* no link */ }
  const open = () => {
    recordAdClick(supabase, ad.placement_id)
    onOpen(ad)
  }
  return (
    <div
      ref={ref}
      className={`flex h-full w-full flex-col rounded-3xl border p-4 ${
        isNight ? 'border-white/10 bg-[#13203A]' : 'border-[#1463F4]/10 bg-[#EAF1FF] shadow-[0_10px_28px_-20px_rgba(20,99,244,0.6)]'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${
          isNight ? 'bg-[#1463F4]/30 text-[#8DB4FF]' : 'bg-[#CFE0FF] text-[#1463F4]'
        }`}>
          Sponsored
        </span>
        <span className={`truncate text-[14px] font-medium ${isNight ? 'text-white/75' : 'text-[#2B4A7A]'}`}>{ad.brand}</span>
      </div>
      <button type="button" onClick={open} className="relative mt-3 block h-48 w-full overflow-hidden rounded-2xl bg-[#1E2530]">
        {ad.image_url && <img src={ad.image_url} alt="" className="h-full w-full object-cover" />}
        {host && (
          <span className="absolute bottom-2.5 left-2.5 rounded-full bg-black/55 px-3 py-1 text-[12px] font-medium text-white backdrop-blur">
            {host}
          </span>
        )}
      </button>
      <p className={`mt-4 text-[19px] font-bold leading-snug ${isNight ? 'text-white' : 'text-[#14306B]'}`}>{ad.headline}</p>
      {ad.body && (
        <p className={`mt-2 line-clamp-3 text-[14px] leading-relaxed ${isNight ? 'text-white/70' : 'text-[#3D5578]'}`}>{ad.body}</p>
      )}
      <div className="min-h-4 flex-1" aria-hidden="true" />
      <button
        type="button"
        onClick={open}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0B4FD6] py-3.5 text-[15px] font-bold text-white"
      >
        {ad.cta_label || (ad.action === 'product' ? 'Explore product' : 'Learn more')} →
      </button>
    </div>
  )
}

function Sheet({ t, isNight, onClose, children }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/45" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className={`max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-[28px] px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-3 ${
          isNight ? 'bg-[#0E1626] text-white' : 'bg-white text-[#101B2D]'
        }`}
      >
        <div className={`mx-auto mb-4 h-1.5 w-10 rounded-full ${isNight ? 'bg-white/20' : 'bg-[#101B2D]/15'}`} />
        {children}
        <button type="button" onClick={onClose} className={`mt-6 w-full rounded-2xl border py-3.5 text-[15px] font-semibold ${t.hair}`}>
          Close
        </button>
      </div>
    </div>
  )
}

function Fact({ label, value, t }) {
  if (!value) return null
  return (
    <div className="mt-4">
      <p className={`text-[12px] font-semibold uppercase tracking-wide ${t.faint}`}>{label}</p>
      <p className="mt-1 text-[15px] leading-relaxed">{value}</p>
    </div>
  )
}

function LessonSheet({ item, t, isNight, onClose }) {
  return (
    <Sheet t={t} isNight={isNight} onClose={onClose}>
      <p className={`text-[12px] font-semibold uppercase tracking-wide ${t.mark}`}>{item.class}</p>
      <h2 className="mt-1 font-display text-[30px] font-light leading-tight">{item.ingredient}</h2>
      <p className={`mt-3 text-[15px] leading-relaxed ${t.muted}`}>{item.about}</p>
      <Fact t={t} label="Helps with" value={item.mainUses} />
      <Fact t={t} label="Best time" value={item.bestTime} />
      <Fact t={t} label="How often" value={item.typicalFrequency} />
      <Fact t={t} label="How to use" value={item.howToUse} />
      <Fact t={t} label="Good to know" value={item.precaution} />
      <Fact t={t} label="Works well with" value={item.compatibleWith} />
      <Fact t={t} label="Take care pairing with" value={item.useCautionWith} />
    </Sheet>
  )
}

// ------------------------------------------------------------ Tracka AI

const AI_FEATURES = [
  {
    title: 'Analyse a product',
    body: 'Is it right for your skin, what works well, what to watch for.',
    icon: <><path d="M10 3h4v3l1.5 2.5V20a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V8.5L10 6V3Z" /><path d="M8.5 12h7" /></>,
  },
  {
    title: 'Analyse my routine',
    body: 'Morning and evening, checked as a whole, with what to change.',
    icon: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="m3.5 6 1.2 1.2L7 4.8M3.5 12l1.2 1.2L7 10.8M3.5 18l1.2 1.2L7 16.8" /></>,
  },
  {
    title: 'Your insights',
    body: 'Patterns in your consistency, products and skin over time.',
    icon: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  },
  {
    title: 'Ask Tracka AI',
    body: 'Ask anything about your skin, products and routine.',
    icon: <><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5v-7Z" /><path d="M8.5 9.5h7M8.5 12.5h4" /></>,
  },
]

function Sparkle({ size = 16, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 2.5c.4 3.9 1.6 6.6 3.5 8 1.4 1 3.3 1.6 6 1.5-2.7.1-4.6.7-6 1.7-1.9 1.4-3.1 4-3.5 7.8-.4-3.8-1.6-6.4-3.5-7.8-1.4-1-3.3-1.6-6-1.7 2.7.1 4.6-.5 6-1.5 1.9-1.4 3.1-4.1 3.5-8Z" />
    </svg>
  )
}

// A first look at Tracka AI. Nothing here is interactive yet: it says
// plainly that it's coming soon, so no one taps around expecting it to work.
function TrackaAiTeaser({ isNight, t }) {
  return (
    <section className="mt-12" aria-labelledby="tracka-ai-heading">
      <div className="flex items-center justify-between gap-3">
        <h2 id="tracka-ai-heading" className="text-[19px] font-semibold">Tracka AI</h2>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] ${
          isNight ? 'bg-[#1463F4]/25 text-[#8DB4FF]' : 'bg-[#1463F4]/10 text-[#1463F4]'
        }`}>
          Coming soon
        </span>
      </div>

      {/* Hero: deep blue, a soft glow and a sample exchange. */}
      <div className="relative mt-4 overflow-hidden rounded-[28px] bg-gradient-to-br from-[#0A1633] via-[#0E2A6B] to-[#1463F4] p-6 text-white shadow-[0_24px_48px_-28px_rgba(20,99,244,0.9)]">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[#5B8CFF]/40 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 -left-10 h-52 w-52 rounded-full bg-[#9B7BFF]/25 blur-3xl" />

        <div className="relative flex items-center gap-2 text-[#BFD3FF]">
          <Sparkle size={14} />
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em]">Tracka AI</span>
        </div>
        <p className="relative mt-3 font-display text-[34px] font-light leading-[1.02]">Your skincare,<br />understood.</p>
        <p className="relative mt-3 max-w-[30ch] text-[14px] leading-relaxed text-white/75">
          Personal answers from your own products, routine and progress, not generic advice.
        </p>

        <div className="relative mt-6 space-y-2.5">
          <div className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-white/95 px-4 py-2.5 text-[13.5px] font-medium text-[#101B2D]">
            Can I use niacinamide with vitamin C?
          </div>
          <div className="flex items-end gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur">
              <Sparkle size={13} />
            </span>
            <div className="max-w-[82%] rounded-2xl rounded-bl-md border border-white/15 bg-white/10 px-4 py-2.5 text-[13.5px] leading-relaxed text-white/90 backdrop-blur">
              Yes, they work well together. Try vitamin C in the morning and niacinamide at night
              <span className="ml-1 inline-flex translate-y-[-2px] gap-0.5 align-middle" aria-hidden="true">
                <span className="h-1 w-1 animate-pulse rounded-full bg-white/70" />
                <span className="h-1 w-1 animate-pulse rounded-full bg-white/70 [animation-delay:150ms]" />
                <span className="h-1 w-1 animate-pulse rounded-full bg-white/70 [animation-delay:300ms]" />
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* What it will do. Not buttons: none of it works yet. */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        {AI_FEATURES.map((f) => (
          <div
            key={f.title}
            className={`rounded-3xl border p-4 ${t.surface} ${
              isNight ? 'border-white/10' : 'border-[#1463F4]/[0.08] shadow-[0_8px_22px_-18px_rgba(20,99,244,0.45)]'
            }`}
          >
            <span className={`flex h-10 w-10 items-center justify-center rounded-2xl ${
              isNight ? 'bg-[#1463F4]/25 text-[#8DB4FF]' : 'bg-gradient-to-br from-[#EEF4FF] to-[#DCE8FF] text-[#1463F4]'
            }`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {f.icon}
              </svg>
            </span>
            <p className="mt-3 text-[14.5px] font-semibold leading-snug">{f.title}</p>
            <p className={`mt-1 text-[12.5px] leading-relaxed ${t.muted}`}>{f.body}</p>
          </div>
        ))}
      </div>

      <p className={`mt-4 text-center text-[12.5px] ${t.faint}`}>
        Not available yet. We're building it now.
      </p>
    </section>
  )
}
