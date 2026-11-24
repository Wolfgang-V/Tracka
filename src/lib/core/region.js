// Where the person is, as far as the app can tell: the phone's timezone.
// Nigeria's is Africa/Lagos. Mirrors timezone_country() in the database
// (migration 20261125000000), which is what actually enforces joining.
//
// Used to hide country-limited challenges (challenges.countries) and their
// ads from people outside those countries.

const TIMEZONE_COUNTRY = { 'Africa/Lagos': 'NG' }

export function deviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

export function deviceCountry() {
  return TIMEZONE_COUNTRY[deviceTimezone()] || null
}

// countries: null/empty = open to everyone.
export function availableHere(countries) {
  if (!countries?.length) return true
  const tz = deviceTimezone()
  // Timezone unknown: don't hide it; the server decides on join.
  if (!tz) return true
  return countries.includes(TIMEZONE_COUNTRY[tz])
}
