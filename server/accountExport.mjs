// Account data export (AV-118a). Pure; no I/O.
//
// The owner may download everything the account stores about them — but
// credential material is NEVER exported, even to its owner, because a stolen
// export must not become a stolen account: password hash+salt, the TOTP
// shared secret, recovery-code hashes, the profile link token, and session
// material are all excluded (the excluded field NAMES are listed so the
// export is transparent about what it withholds).
//
// Included: profile fields, all AV-112–117 preferences, visibility settings,
// passkey DESCRIPTORS (credentialId, name, timestamps, counter — never the
// SPKI public key material... actually the SPKI is public key data and safe,
// but it adds nothing for the user; excluded for a minimal, readable export),
// and summary counts (active sessions).

const EXCLUDED_FIELDS = [
  'passwordHash',
  'passwordSalt',
  'twoFactorSecret',
  'recoveryCodes',
  'profileLinkToken',
  'sessions',
]

/** Build the owner's export payload. `passkeys` = stored credential records. */
export function buildAccountExport(user, { passkeys = [], activeSessions = 0, now = Date.now() } = {}) {
  const exportedAt = now
  const profile = {}
  for (const [key, value] of Object.entries(user ?? {})) {
    if (EXCLUDED_FIELDS.includes(key)) continue
    profile[key] = value
  }
  return {
    export: {
      exportedAt,
      account: profile,
      passkeys: (Array.isArray(passkeys) ? passkeys : []).map((record) => ({
        credentialId: record?.credentialId ?? null,
        name: record?.name ?? null,
        createdAt: record?.createdAt ?? null,
        lastUsedAt: record?.lastUsedAt ?? null,
        counter: record?.counter ?? null,
      })),
      activeSessions: Math.max(0, Number(activeSessions) || 0),
    },
    excluded: [...EXCLUDED_FIELDS],
  }
}
