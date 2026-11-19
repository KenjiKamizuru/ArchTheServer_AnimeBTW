// Account deletion policy (AV-118b). Pure; no I/O.
//
// Scope decisions (recorded per task rules):
// - Re-authentication is REQUIRED (the route verifies the password and, when
//   2FA is enabled, a TOTP/recovery code) plus a typed confirmation: the user
//   must type their own username. A session cookie alone never deletes.
// - What deletion removes: the user record (profile, preferences, visibility,
//   link token, TOTP secret, recovery codes, password material), every
//   session of the user, every passkey credential record, and the avatar
//   files. Anything else on disk belongs to the installation, not the
//   account.
// - What it does NOT remove (documented, not guessed): notes
//   (`notes:<mediaId>`) and lists are INSTALLATION-WIDE in the current data
//   model — they are not user-scoped, so per-user deletion cannot be done
//   honestly. This is stated in the deletion response so the outcome is
//   transparent.

export const DELETION_ARTIFACTS = Object.freeze({
  removed: [
    'account record (profile, preferences, visibility, link token, credentials)',
    'all account sessions',
    'passkey credential records',
    'avatar files',
  ],
  retained: [
    'installation-wide catalog notes (not user-scoped in the current data model)',
    'installation-wide lists (not user-scoped in the current data model)',
  ],
})

/** The typed confirmation must be the account's own username. */
export function validateDeletionConfirmation(user, confirm) {
  const typed = String(confirm ?? '').trim().toLowerCase()
  const username = String(user?.username ?? '').trim().toLowerCase()
  if (!typed || !username || typed !== username) {
    return {
      ok: false,
      error: 'Type your username exactly to confirm deleting your account',
    }
  }
  return { ok: true }
}
