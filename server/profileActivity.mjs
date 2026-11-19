// Profile activity summaries (AV-117a). Pure; no I/O.
//
// Scope decisions (recorded per task rules):
// - The summary is OPT-IN (`showActivity`, default false): existing accounts
//   expose nothing new unless the owner turns it on (AV-111 precedent).
// - It contains only facts the server can TRUTHFULLY ATTRIBUTE to the user:
//   `memberSince` (the account's createdAt) and `activeSessions` (session
//   records for this user). Catalog counters are EXCLUDED on purpose — notes
//   (`notes:<mediaId>`) and lists are installation-wide in the current data
//   model, so counting them as "the user's activity" would misattribute them;
//   note CONTENT is owner-private by contract (tests pin it). Security
//   artifacts (passkeys, 2FA, recovery codes) are excluded as well.
//   The summary can grow when later work (AV-121 login timestamps) adds
//   attributable facts.
// - Visibility: the owner always sees it; others only when the profile is
//   viewable AND showActivity is on. Private profiles never leak it.

export function normalizeShowActivity(value) {
  if (value === true || value === false) return { ok: true, value }
  return { ok: false, error: 'showActivity must be true or false' }
}

/**
 * Build the summary for a profile view.
 * `activeSessions` = number of live session records for this user.
 * Returns { ok: true, activity: { memberSince, activeSessions } | null }.
 */
export function buildActivitySummary(user, { activeSessions = 0, viewerIsOwner = false } = {}) {
  const visibility = user?.profileVisibility ?? 'public'
  const optedIn = Boolean(user?.showActivity)
  const visible = viewerIsOwner || (optedIn && visibility !== 'private')
  if (!visible) return { ok: true, activity: null }
  return {
    ok: true,
    activity: {
      memberSince: Number.isFinite(user?.createdAt) ? user.createdAt : null,
      activeSessions: Math.max(0, Number(activeSessions) || 0),
    },
  }
}
