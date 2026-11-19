import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ExternalLink,
  HardDrive,
  ImagePlus,
  Info,
  Loader2,
  Lock,
  RefreshCw,
  Save,
  Trash2,
  Zap,
} from 'lucide-react'
import { api } from '../lib/api'
import { focusObjectClass, removeArtwork, useArtwork } from '../lib/artwork'
import { refreshDownloads, refreshLibrary } from '../lib/downloads'
import { saveSettings, useSettings } from '../lib/settings'
import { ImdbArtworkModal } from '../components/ImdbArtworkModal'
import { UserPlus, LogIn, LogOut, KeyRound, Send, Fingerprint, Shield, Globe } from 'lucide-react'
import { passkeysSupported, registerPasskeyCeremony, signInWithPasskey } from '../lib/passkeys'
import type { PasskeyCredential } from '../types'
import type { RegisteredUser } from '../types'
import { useToast } from '../components/Toasts'
import type { AppSettings, ResolverStatus } from '../types'

const QUALITIES: { value: string; label: string }[] = [
  { value: 'best', label: 'Best available' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' },
  { value: 'worst', label: 'Smallest available' },
]

function editable(s: AppSettings) {
  return {
    quality: s.quality,
    dub: s.dub,
    resultIndex: s.resultIndex,
    libraryDir: s.libraryDir,
    maxConcurrentDownloads: s.maxConcurrentDownloads,
    preferLocalPlayback: s.preferLocalPlayback,
    allowedHostsText: (s.allowedExternalHosts ?? []).join('\n'),
    theme: s.theme,
    systemTheme: s.systemTheme,
  }
}

type Draft = ReturnType<typeof editable>

/** Account registration controls (AV-101b): self-contained so the page's
 * draft/save machinery stays untouched. */
function AccountsCard() {
  const settings = useSettings()
  const toast = useToast()
  const open = settings.registrationOpen === true
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState<RegisteredUser | null>(null)
  const [signInUsername, setSignInUsername] = useState('')
  const [signInPassword, setSignInPassword] = useState('')
  const [signInBusy, setSignInBusy] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)
  const [resetIdentifier, setResetIdentifier] = useState('')
  const [resetBusy, setResetBusy] = useState(false)
  const [resetToken, setResetToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [applyBusy, setApplyBusy] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [bioDraft, setBioDraft] = useState('')
  const [bioBusy, setBioBusy] = useState(false)
  const [passkeys, setPasskeys] = useState<PasskeyCredential[]>([])
  const [passkeyName, setPasskeyName] = useState('')
  const [passkeyBusy, setPasskeyBusy] = useState(false)
  const [passkeyError, setPasskeyError] = useState<string | null>(null)
  const [passkeySupported] = useState(() => passkeysSupported())
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false)
  const [twoFactorSetup, setTwoFactorSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null)
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [twoFactorBusy, setTwoFactorBusy] = useState(false)
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null)
  const [recoveryStatus, setRecoveryStatus] = useState<{ total: number; remaining: number } | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [recoveryBusy, setRecoveryBusy] = useState(false)
  const [recoveryError, setRecoveryError] = useState<string | null>(null)
  const [avatarVersion, setAvatarVersion] = useState(0)
  const [avatarBroken, setAvatarBroken] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [profileVisibility, setProfileVisibility] = useState('public')
  const [profileLinkToken, setProfileLinkToken] = useState('')
  const [profileLinkPath, setProfileLinkPath] = useState('')
  const [privacyBusy, setPrivacyBusy] = useState(false)
  const [privacyError, setPrivacyError] = useState<string | null>(null)
  const [prefLanguage, setPrefLanguage] = useState('')
  const [prefLocale, setPrefLocale] = useState('')
  const [prefSubtitle, setPrefSubtitle] = useState('')
  const [prefAudio, setPrefAudio] = useState('')
  const [prefQuality, setPrefQuality] = useState('')
  const [prefRating, setPrefRating] = useState('')
  const [prefsBusy, setPrefsBusy] = useState(false)
  const [prefsError, setPrefsError] = useState<string | null>(null)

  useEffect(() => {
    setBioDraft(user?.bio ?? '')
  }, [user])

  useEffect(() => {
    api.me()
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
  }, [])

  useEffect(() => {
    if (!user) {
      setPasskeys([])
      setTwoFactorEnabled(false)
      setTwoFactorSetup(null)
      return
    }
    api
      .listPasskeys()
      .then((res) => setPasskeys(res.passkeys))
      .catch(() => setPasskeys([]))
    api
      .twoFactorStatus()
      .then((res) => setTwoFactorEnabled(res.enabled))
      .catch(() => setTwoFactorEnabled(false))
    api
      .recoveryCodesStatus()
      .then((res) => setRecoveryStatus(res))
      .catch(() => setRecoveryStatus(null))
    setRecoveryCodes(null)
    api
      .profileSettings()
      .then((res) => {
        setProfileVisibility(res.visibility)
        setProfileLinkToken(res.token)
        setProfileLinkPath(res.path)
      })
      .catch(() => {
        setProfileVisibility('public')
        setProfileLinkToken('')
      })
    api
      .preferences()
      .then((res) => {
        setPrefLanguage(res.preferredLanguage ?? '')
        setPrefLocale(res.locale ?? '')
        setPrefSubtitle(res.defaultSubtitle ?? '')
        setPrefAudio(res.defaultAudio ?? '')
        setPrefQuality(res.defaultQuality ?? '')
        setPrefRating(res.maxContentRating ?? '')
      })
      .catch(() => {
        setPrefLanguage('')
        setPrefLocale('')
        setPrefSubtitle('')
        setPrefAudio('')
        setPrefQuality('')
        setPrefRating('')
      })
  }, [user])

  async function signIn() {
    setSignInBusy(true)
    setSignInError(null)
    try {
      const res = await api.login({ username: signInUsername, password: signInPassword })
      setUser(res.user)
      setSignInUsername('')
      setSignInPassword('')
      toast(`Signed in as ${res.user.username}`)
    } catch (err) {
      setSignInError(err instanceof Error ? err.message : 'Could not sign in')
    } finally {
      setSignInBusy(false)
    }
  }

  async function signOut() {
    try {
      await api.logout()
      setUser(null)
      toast('Signed out')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not sign out', 'err')
    }
  }

  async function registerPasskey() {
    setPasskeyBusy(true)
    setPasskeyError(null)
    try {
      const res = await registerPasskeyCeremony(passkeyName.trim())
      setPasskeys((prev) => [...prev, res.credential])
      setPasskeyName('')
      toast('Passkey registered')
    } catch (err) {
      setPasskeyError(err instanceof Error ? err.message : 'Could not register a passkey')
    } finally {
      setPasskeyBusy(false)
    }
  }

  async function signInPasskey() {
    setSignInBusy(true)
    setSignInError(null)
    try {
      const res = await signInWithPasskey()
      setUser(res.user)
      toast(`Signed in as ${res.user.username}`)
    } catch (err) {
      setSignInError(err instanceof Error ? err.message : 'Could not sign in with a passkey')
    } finally {
      setSignInBusy(false)
    }
  }

  async function removePasskey(credentialId: string) {
    setPasskeyBusy(true)
    setPasskeyError(null)
    try {
      await api.removePasskey(credentialId)
      setPasskeys((prev) => prev.filter((item) => item.credentialId !== credentialId))
      toast('Passkey removed')
    } catch (err) {
      setPasskeyError(err instanceof Error ? err.message : 'Could not remove the passkey')
    } finally {
      setPasskeyBusy(false)
    }
  }

  async function startTwoFactorSetup() {
    setTwoFactorBusy(true)
    setTwoFactorError(null)
    try {
      const setup = await api.twoFactorSetup()
      setTwoFactorSetup(setup)
      setTwoFactorCode('')
    } catch (err) {
      setTwoFactorError(err instanceof Error ? err.message : 'Could not start two-factor setup')
    } finally {
      setTwoFactorBusy(false)
    }
  }

  async function enableTwoFactor() {
    setTwoFactorBusy(true)
    setTwoFactorError(null)
    try {
      await api.twoFactorEnable(twoFactorCode.trim())
      setTwoFactorEnabled(true)
      setTwoFactorSetup(null)
      setTwoFactorCode('')
      toast('Two-factor authentication enabled')
    } catch (err) {
      setTwoFactorError(err instanceof Error ? err.message : 'Could not enable two-factor authentication')
    } finally {
      setTwoFactorBusy(false)
    }
  }

  async function disableTwoFactor() {
    setTwoFactorBusy(true)
    setTwoFactorError(null)
    try {
      await api.twoFactorDisable(twoFactorCode.trim())
      setTwoFactorEnabled(false)
      setTwoFactorSetup(null)
      setTwoFactorCode('')
      toast('Two-factor authentication disabled')
    } catch (err) {
      setTwoFactorError(err instanceof Error ? err.message : 'Could not disable two-factor authentication')
    } finally {
      setTwoFactorBusy(false)
    }
  }

  async function regenerateRecoveryCodes() {
    if (recoveryStatus && recoveryStatus.total > 0) {
      const confirmed = window.confirm('Generating new codes invalidates all previous ones. Continue?')
      if (!confirmed) return
    }
    setRecoveryBusy(true)
    setRecoveryError(null)
    try {
      const res = await api.regenerateRecoveryCodes()
      setRecoveryCodes(res.codes)
      setRecoveryStatus({ total: res.codes.length, remaining: res.codes.length })
    } catch (err) {
      setRecoveryError(err instanceof Error ? err.message : 'Could not generate recovery codes')
    } finally {
      setRecoveryBusy(false)
    }
  }

  async function copyRecoveryCodes() {
    if (!recoveryCodes) return
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'))
      toast('Recovery codes copied')
    } catch {
      toast('Could not copy — select the codes manually', 'err')
    }
  }

  async function uploadAvatarFile(file: File) {
    setAvatarBusy(true)
    setAvatarError(null)
    try {
      if (file.size > 512 * 1024) throw new Error('Avatars must be 512 KB or smaller')
      await api.uploadAvatar(await file.arrayBuffer())
      setAvatarBroken(false)
      setAvatarVersion((v) => v + 1)
      toast('Avatar updated')
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Could not upload the avatar')
    } finally {
      setAvatarBusy(false)
    }
  }

  async function removeAvatar() {
    setAvatarBusy(true)
    setAvatarError(null)
    try {
      await api.removeAvatar()
      setAvatarBroken(true)
      setAvatarVersion((v) => v + 1)
      toast('Avatar removed')
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Could not remove the avatar')
    } finally {
      setAvatarBusy(false)
    }
  }

  async function changeProfileVisibility(visibility: string) {
    setPrivacyBusy(true)
    setPrivacyError(null)
    try {
      const res = await api.setProfileVisibility(visibility as 'public' | 'private' | 'link-only')
      setProfileVisibility(res.visibility)
      toast('Profile visibility updated')
    } catch (err) {
      setPrivacyError(err instanceof Error ? err.message : 'Could not update visibility')
    } finally {
      setPrivacyBusy(false)
    }
  }

  async function copyProfileLink() {
    const link = `${window.location.origin}${profileLinkPath}?token=${profileLinkToken}`
    try {
      await navigator.clipboard.writeText(link)
      toast('Profile link copied')
    } catch {
      toast('Could not copy the link', 'err')
    }
  }

  async function rotateProfileLinkToken() {
    setPrivacyBusy(true)
    setPrivacyError(null)
    try {
      const res = await api.rotateProfileLink()
      setProfileLinkToken(res.token)
      setProfileLinkPath(res.path)
      toast('Profile link rotated — the old link no longer works')
    } catch (err) {
      setPrivacyError(err instanceof Error ? err.message : 'Could not rotate the link')
    } finally {
      setPrivacyBusy(false)
    }
  }

  async function savePreferences() {
    setPrefsBusy(true)
    setPrefsError(null)
    try {
      const res = await api.updatePreferences({
        preferredLanguage: prefLanguage,
        locale: prefLocale,
        defaultSubtitle: prefSubtitle,
        defaultAudio: prefAudio,
        defaultQuality: prefQuality,
        maxContentRating: prefRating,
      })
      setPrefLanguage(res.preferredLanguage ?? '')
      setPrefLocale(res.locale ?? '')
      setPrefSubtitle(res.defaultSubtitle ?? '')
      setPrefAudio(res.defaultAudio ?? '')
      setPrefQuality(res.defaultQuality ?? '')
      setPrefRating(res.maxContentRating ?? '')
      toast('Preferences saved')
    } catch (err) {
      setPrefsError(err instanceof Error ? err.message : 'Could not save preferences')
    } finally {
      setPrefsBusy(false)
    }
  }

  async function requestReset() {
    setResetBusy(true)
    try {
      // The server response is always generic (no account enumeration).
      await api.requestReset(resetIdentifier)
      toast('If that account has an email, a reset token was sent')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not request a reset', 'err')
    } finally {
      setResetBusy(false)
    }
  }

  async function applyReset() {
    setApplyBusy(true)
    setApplyError(null)
    try {
      await api.resetPassword({ token: resetToken, password: newPassword })
      toast('Password updated — sign in with the new password')
      setResetToken('')
      setNewPassword('')
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Could not reset the password')
    } finally {
      setApplyBusy(false)
    }
  }

  async function saveBio() {
    setBioBusy(true)
    try {
      const res = await api.updateProfile({ bio: bioDraft.trim() || null })
      setUser(res.user)
      toast('Profile updated')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update the profile', 'err')
    } finally {
      setBioBusy(false)
    }
  }

  async function toggleRegistration(next: boolean) {
    try {
      await saveSettings({ registrationOpen: next })
      toast(next ? 'Registration opened' : 'Registration closed')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update registration', 'err')
    }
  }

  async function toggleEmailAccounts(next: boolean) {
    try {
      await saveSettings({ emailAccounts: next })
      toast(next ? 'Email accounts enabled' : 'Email accounts disabled')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update email accounts', 'err')
    }
  }

  async function register() {
    setBusy(true)
    setError(null)
    try {
      const res = await api.register({
        username,
        password,
        displayName: displayName || undefined,
        email: email || undefined,
      })
      toast(`Account ${res.user.username} created`)
      setUsername('')
      setDisplayName('')
      setEmail('')
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-6 rounded-xl bg-ink-900 p-4 ring-1 ring-white/5 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-white/40 uppercase">
            <UserPlus size={13} className="text-accent" />
            Accounts
          </h2>
          <p className="mt-1 text-xs text-white/45">
            Optional registration for multi-user installations. Closed by default — single shared installs are
            unaffected.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-white/60">
            <input
              type="checkbox"
              checked={open}
              onChange={(event) => void toggleRegistration(event.target.checked)}
              className="h-4 w-4"
            />
            Open registration
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-white/60">
            <input
              type="checkbox"
              checked={settings.emailAccounts === true}
              onChange={(event) => void toggleEmailAccounts(event.target.checked)}
              className="h-4 w-4"
            />
            Email accounts (require + verify email)
          </label>
        </div>
      </div>
      <div className="mt-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-white/30">Sign in</h3>
        {user ? (
          <>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-white/70">
              Signed in as {user.displayName || user.username}
            </span>
            {user.emailVerified ? (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                Email verified
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void signOut()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-[11px] text-white/60 ring-1 ring-white/10 transition hover:bg-red-500/15 hover:text-red-200"
            >
              <LogOut size={12} /> Sign out
            </button>
          </div>
          <div className="mt-3 border-t border-white/5 pt-3">
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-white/30">Profile bio</h3>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <textarea
                value={bioDraft}
                onChange={(event) => setBioDraft(event.target.value.slice(0, 500))}
                rows={2}
                placeholder="A short bio (up to 500 characters)"
                className="w-96 max-w-full resize-y rounded-lg bg-ink-800 px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
              />
              <button
                type="button"
                onClick={() => void saveBio()}
                disabled={bioBusy || bioDraft === (user?.bio ?? '')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-black transition hover:bg-accent-600 disabled:opacity-40"
              >
                {bioBusy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save bio
              </button>
            </div>
            <div className="mt-3 border-t border-white/5 pt-3">
              <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-white/30">
                <ImagePlus size={11} /> Profile picture
              </h3>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {avatarBroken ? (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/10 text-lg font-semibold text-white">
                    {(user.displayName || user.username || '?').slice(0, 1).toUpperCase()}
                  </div>
                ) : (
                  <img
                    src={`/api/auth/avatar/${user.id}?v=${avatarVersion}`}
                    alt="Your avatar"
                    onError={() => setAvatarBroken(true)}
                    className="h-14 w-14 shrink-0 rounded-full object-cover ring-1 ring-white/10"
                  />
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-black transition hover:bg-accent-600">
                    {avatarBusy ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />} Choose image
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/gif"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        event.target.value = ''
                        if (file) void uploadAvatarFile(file)
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void removeAvatar()}
                    disabled={avatarBusy || avatarBroken}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-40"
                  >
                    <Trash2 size={12} /> Remove
                  </button>
                  <p className="w-full text-[11px] text-white/40">PNG, JPEG, or GIF — up to 512 KB.</p>
                </div>
              </div>
              {avatarError ? <p className="mt-2 text-[11px] text-red-300">{avatarError}</p> : null}
            </div>
            <div className="mt-3 border-t border-white/5 pt-3">
              <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-white/30">
                <Shield size={11} /> Profile visibility
              </h3>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  value={profileVisibility}
                  onChange={(event) => void changeProfileVisibility(event.target.value)}
                  disabled={privacyBusy}
                  className="rounded-lg bg-ink-800 px-2.5 py-1.5 text-[11px] text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
                >
                  <option value="public">Public — anyone can view</option>
                  <option value="link-only">Link-only — only people with the link</option>
                  <option value="private">Private — only you</option>
                </select>
                {profileVisibility === 'link-only' && profileLinkToken ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void copyProfileLink()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white ring-1 ring-white/10 transition hover:bg-white/10"
                    >
                      <Send size={12} /> Copy profile link
                    </button>
                    <button
                      type="button"
                      onClick={() => void rotateProfileLinkToken()}
                      disabled={privacyBusy}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-40"
                    >
                      {privacyBusy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Rotate link
                    </button>
                  </>
                ) : null}
              </div>
              <p className="mt-1 text-[11px] text-white/40">
                {profileVisibility === 'link-only'
                  ? 'Anyone with the link can view your profile. Rotating the link disables old copies.'
                  : profileVisibility === 'private'
                    ? 'Only you can view your profile.'
                    : 'Anyone can view your profile.'}
              </p>
              {privacyError ? <p className="mt-2 text-[11px] text-red-300">{privacyError}</p> : null}
            </div>
            <div className="mt-3 border-t border-white/5 pt-3">
              <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-white/30">
                <Globe size={11} /> Language &amp; locale
              </h3>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={prefLanguage}
                  onChange={(event) => setPrefLanguage(event.target.value.slice(0, 20))}
                  placeholder="Content language (e.g. ja)"
                  className="w-48 rounded-lg bg-ink-800 px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
                />
                <input
                  type="text"
                  value={prefLocale}
                  onChange={(event) => setPrefLocale(event.target.value.slice(0, 20))}
                  placeholder="Formatting locale (e.g. en-US)"
                  className="w-48 rounded-lg bg-ink-800 px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
                />
                <input
                  type="text"
                  value={prefSubtitle}
                  onChange={(event) => setPrefSubtitle(event.target.value.slice(0, 20))}
                  placeholder="Subtitles (en, or off)"
                  className="w-44 rounded-lg bg-ink-800 px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
                />
                <input
                  type="text"
                  value={prefAudio}
                  onChange={(event) => setPrefAudio(event.target.value.slice(0, 20))}
                  placeholder="Audio language (e.g. ja)"
                  className="w-48 rounded-lg bg-ink-800 px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
                />
                <select
                  value={prefQuality}
                  onChange={(event) => setPrefQuality(event.target.value)}
                  className="rounded-lg bg-ink-800 px-2.5 py-1.5 text-[11px] text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
                >
                  <option value="">Quality: unset</option>
                  <option value="auto">Quality: auto</option>
                  <option value="2160p">Quality: 2160p</option>
                  <option value="1080p">Quality: 1080p</option>
                  <option value="720p">Quality: 720p</option>
                  <option value="576p">Quality: 576p</option>
                  <option value="480p">Quality: 480p</option>
                  <option value="360p">Quality: 360p</option>
                </select>
                <select
                  value={prefRating}
                  onChange={(event) => setPrefRating(event.target.value)}
                  className="rounded-lg bg-ink-800 px-2.5 py-1.5 text-[11px] text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
                >
                  <option value="">Rating limit: none</option>
                  <option value="g">Up to G</option>
                  <option value="pg">Up to PG</option>
                  <option value="pg-13">Up to PG-13</option>
                  <option value="r">Up to R</option>
                  <option value="r+">Up to R+</option>
                  <option value="nc-17">Up to NC-17</option>
                </select>
                <button
                  type="button"
                  onClick={() => void savePreferences()}
                  disabled={prefsBusy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-black transition hover:bg-accent-600 disabled:opacity-40"
                >
                  {prefsBusy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save
                </button>
              </div>
              <p className="mt-1 text-[11px] text-white/40">
                Language tags like &quot;en&quot;, &quot;pt-BR&quot;, or &quot;zh-Hant&quot;. Subtitles accept &quot;off&quot; for none. Stored for display and playback choices — the UI is not translated yet.
              </p>
              {prefsError ? <p className="mt-2 text-[11px] text-red-300">{prefsError}</p> : null}
            </div>
            {passkeySupported ? (
              <div className="mt-3 border-t border-white/5 pt-3">
                <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-white/30">
                  <Fingerprint size={11} /> Passkeys
                </h3>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={passkeyName}
                    onChange={(event) => setPasskeyName(event.target.value.slice(0, 60))}
                    placeholder="Name (e.g. My laptop)"
                    className="w-52 rounded-lg bg-ink-800 px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
                  />
                  <button
                    type="button"
                    onClick={() => void registerPasskey()}
                    disabled={passkeyBusy}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-black transition hover:bg-accent-600 disabled:opacity-40"
                  >
                    {passkeyBusy ? <Loader2 size={12} className="animate-spin" /> : <Fingerprint size={12} />} Register a passkey
                  </button>
                </div>
                {passkeys.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {passkeys.map((item) => (
                      <li key={item.credentialId} className="flex items-center gap-2 text-[11px] text-white/70">
                        <Fingerprint size={11} className="shrink-0" />
                        <span className="truncate">{item.name || 'Unnamed passkey'}</span>
                        <button
                          type="button"
                          onClick={() => void removePasskey(item.credentialId)}
                          disabled={passkeyBusy}
                          title="Remove this passkey"
                          className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-white/40 transition hover:bg-white/5 hover:text-red-300 disabled:opacity-40"
                        >
                          <Trash2 size={11} /> Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {passkeyError ? <p className="mt-2 text-[11px] text-red-300">{passkeyError}</p> : null}
              </div>
            ) : null}
            <div className="mt-3 border-t border-white/5 pt-3">
              <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-white/30">
                <Shield size={11} /> Two-factor authentication
              </h3>
              <p className="mt-1 text-[11px] text-white/50">
                {twoFactorEnabled
                  ? 'Enabled — signing in with a password also requires a code from your authenticator app.'
                  : 'Optional — protect password sign-in with a code from an authenticator app.'}
              </p>
              {twoFactorSetup && !twoFactorEnabled ? (
                <div className="mt-2 space-y-2">
                  <p className="text-[11px] text-white/70">
                    Add this secret to your authenticator app (or open the link), then enter the 6-digit code:
                  </p>
                  <p className="select-all rounded-lg bg-ink-800 px-2.5 py-1.5 font-mono text-[11px] text-white ring-1 ring-white/10">
                    {twoFactorSetup.secret}
                  </p>
                  <a
                    href={twoFactorSetup.otpauthUrl}
                    className="inline-flex items-center gap-1 text-[11px] text-accent underline underline-offset-2"
                  >
                    <ExternalLink size={11} /> Open in authenticator app
                  </a>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={twoFactorCode}
                      onChange={(event) => setTwoFactorCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="123456"
                      className="w-28 rounded-lg bg-ink-800 px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
                    />
                    <button
                      type="button"
                      onClick={() => void enableTwoFactor()}
                      disabled={twoFactorBusy || twoFactorCode.length !== 6}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-black transition hover:bg-accent-600 disabled:opacity-40"
                    >
                      {twoFactorBusy ? <Loader2 size={12} className="animate-spin" /> : <Shield size={12} />} Enable
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {twoFactorEnabled ? (
                    <>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={twoFactorCode}
                        onChange={(event) => setTwoFactorCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="123456"
                        className="w-28 rounded-lg bg-ink-800 px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
                      />
                      <button
                        type="button"
                        onClick={() => void disableTwoFactor()}
                        disabled={twoFactorBusy || twoFactorCode.length !== 6}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-40"
                      >
                        {twoFactorBusy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Disable
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void startTwoFactorSetup()}
                      disabled={twoFactorBusy}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-black transition hover:bg-accent-600 disabled:opacity-40"
                    >
                      {twoFactorBusy ? <Loader2 size={12} className="animate-spin" /> : <Shield size={12} />} Set up 2FA
                    </button>
                  )}
                </div>
              )}
              {twoFactorError ? <p className="mt-2 text-[11px] text-red-300">{twoFactorError}</p> : null}
            </div>
            <div className="mt-3 border-t border-white/5 pt-3">
              <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-white/30">
                <KeyRound size={11} /> Recovery codes
              </h3>
              <p className="mt-1 text-[11px] text-white/50">
                {recoveryStatus && recoveryStatus.total > 0
                  ? `${recoveryStatus.remaining} of ${recoveryStatus.total} codes remaining — each code works once if you lose your authenticator.`
                  : 'Single-use backup codes for two-factor sign-in when your authenticator is unavailable.'}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void regenerateRecoveryCodes()}
                  disabled={recoveryBusy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-black transition hover:bg-accent-600 disabled:opacity-40"
                >
                  {recoveryBusy ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}{' '}
                  {recoveryStatus && recoveryStatus.total > 0 ? 'Generate new codes' : 'Generate recovery codes'}
                </button>
                {recoveryCodes ? (
                  <button
                    type="button"
                    onClick={() => void copyRecoveryCodes()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white ring-1 ring-white/10 transition hover:bg-white/10"
                  >
                    <Send size={12} /> Copy
                  </button>
                ) : null}
              </div>
              {recoveryCodes ? (
                <div className="mt-2">
                  <p className="text-[11px] font-medium text-amber-200">
                    Store these somewhere safe — they are shown only once and each works exactly once.
                  </p>
                  <ul className="mt-1 grid grid-cols-2 gap-1">
                    {recoveryCodes.map((code) => (
                      <li
                        key={code}
                        className="select-all rounded-lg bg-ink-800 px-2.5 py-1 font-mono text-[11px] text-white ring-1 ring-white/10"
                      >
                        {code}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {recoveryError ? <p className="mt-2 text-[11px] text-red-300">{recoveryError}</p> : null}
            </div>
          </div>
          </>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={signInUsername}
              onChange={(event) => setSignInUsername(event.target.value.slice(0, 32))}
              placeholder="Username"
              className="w-40 rounded-lg bg-ink-800 px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
            />
            <input
              type="password"
              value={signInPassword}
              onChange={(event) => setSignInPassword(event.target.value.slice(0, 200))}
              placeholder="Password"
              className="w-48 rounded-lg bg-ink-800 px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
            />
            <button
              type="button"
              onClick={() => void signIn()}
              disabled={signInBusy || !signInUsername || !signInPassword}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-black transition hover:bg-accent-600 disabled:opacity-40"
            >
              {signInBusy ? <Loader2 size={12} className="animate-spin" /> : <LogIn size={12} />} Sign in
            </button>
            {passkeySupported ? (
              <button
                type="button"
                onClick={() => void signInPasskey()}
                disabled={signInBusy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-40"
              >
                {signInBusy ? <Loader2 size={12} className="animate-spin" /> : <Fingerprint size={12} />} Sign in with a passkey
              </button>
            ) : null}
            {signInError ? <p className="w-full text-[11px] text-red-300">{signInError}</p> : null}
          </div>
        )}
        {!user ? (
          <div className="mt-3 border-t border-white/5 pt-3">
            <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-white/30">
              <KeyRound size={11} /> Forgot password
            </h3>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={resetIdentifier}
                onChange={(event) => setResetIdentifier(event.target.value.slice(0, 254))}
                placeholder="Username or email"
                className="w-52 rounded-lg bg-ink-800 px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
              />
              <button
                type="button"
                onClick={() => void requestReset()}
                disabled={resetBusy || !resetIdentifier}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-[11px] text-white/60 ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-40"
              >
                {resetBusy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Send reset token
              </button>
              <input
                type="text"
                value={resetToken}
                onChange={(event) => setResetToken(event.target.value.slice(0, 64))}
                placeholder="Reset token (from the email)"
                className="w-56 rounded-lg bg-ink-800 px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
              />
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value.slice(0, 200))}
                placeholder="New password (8+ characters)"
                className="w-52 rounded-lg bg-ink-800 px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
              />
              <button
                type="button"
                onClick={() => void applyReset()}
                disabled={applyBusy || !resetToken || !newPassword}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-black transition hover:bg-accent-600 disabled:opacity-40"
              >
                {applyBusy ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />} Set new password
              </button>
              {applyError ? <p className="w-full text-[11px] text-red-300">{applyError}</p> : null}
            </div>
          </div>
        ) : null}
      </div>
      {open ? (
        <div className="mt-4">
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-white/30">Create an account</h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value.slice(0, 32))}
              placeholder="Username"
              className="w-40 rounded-lg bg-ink-800 px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
            />
            <input
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value.slice(0, 48))}
              placeholder="Display name (optional)"
              className="w-48 rounded-lg bg-ink-800 px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
            />
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value.slice(0, 254))}
              placeholder={settings.emailAccounts === true ? 'Email (required)' : 'Email (optional)'}
              className="w-52 rounded-lg bg-ink-800 px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
            />
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value.slice(0, 200))}
              placeholder="Password (8+ characters)"
              className="w-48 rounded-lg bg-ink-800 px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
            />
            <button
              type="button"
              onClick={() => void register()}
              disabled={busy || !username || !password}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-black transition hover:bg-accent-600 disabled:opacity-40"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />} Create
            </button>
          </div>
          {error ? <p className="mt-2 text-[11px] text-red-300">{error}</p> : null}
        </div>
      ) : null}
    </section>
  )
}

export default function SettingsPage() {
  const settings = useSettings()
  const artwork = useArtwork()
  const appArt = artwork.app
  const toast = useToast()
  const [draft, setDraft] = useState<Draft>(() => editable(settings))
  const [busy, setBusy] = useState(false)
  const [imdbOpen, setImdbOpen] = useState(false)
  const [status, setStatus] = useState<ResolverStatus | null>(null)
  const [statusBusy, setStatusBusy] = useState(false)
  const touchedRef = useRef(false)

  const dirty = JSON.stringify(draft) !== JSON.stringify(editable(settings))

  useEffect(() => {
    if (!touchedRef.current) {
      setDraft(editable(settings))
    }
  }, [settings])

  function checkStatus() {
    setStatusBusy(true)
    api
      .resolverStatus()
      .then((next) => setStatus(next))
      .catch(() => setStatus(null))
      .finally(() => setStatusBusy(false))
  }

  useEffect(() => {
    checkStatus()
  }, [])

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    touchedRef.current = true
    setDraft((d) => ({ ...d, [key]: value }))
  }

  async function onSave() {
    setBusy(true)
    try {
      const allowedExternalHosts = draft.allowedHostsText
        .split(/[\r\n,\s]+/)
        .map((v) => v.trim())
        .filter(Boolean)

      const patch: Partial<AppSettings> = {
        quality: draft.quality,
        dub: draft.dub,
        resultIndex: draft.resultIndex,
        maxConcurrentDownloads: draft.maxConcurrentDownloads,
        preferLocalPlayback: draft.preferLocalPlayback,
        allowedExternalHosts,
        theme: draft.theme,
        systemTheme: draft.systemTheme,
      }
      if (!settings.libraryDirLocked) {
        patch.libraryDir = draft.libraryDir
      }

      const next = await saveSettings(patch)
      touchedRef.current = false
      setDraft(editable(next))
      await Promise.all([refreshLibrary(true), refreshDownloads()])
      toast('Settings saved')
      checkStatus()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save settings', 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white md:text-2xl">Settings</h1>
          <p className="mt-0.5 text-xs text-white/40">
            Stream quality, shared media library, and persistent download limits.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={busy || !dirty}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-black transition hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {dirty ? 'Save changes' : 'Saved'}
        </button>
      </div>

      <ImdbArtworkModal
        open={imdbOpen}
        onClose={() => setImdbOpen(false)}
        targetLabel="AnimeVault App (Banner, Icon & Favicon)"
        targetType="app"
        targetKey="global"
        initialImdbId={appArt?.imdbId}
      />

      <AccountsCard />

      <section className="mt-6 rounded-xl bg-ink-900 p-4 ring-1 ring-white/5 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-white/40 uppercase">
              <ImagePlus size={13} className="text-accent" />
              App Banner, Icon &amp; IMDb Artwork
            </h2>
            <p className="mt-1 text-xs text-white/45">
              Claim any official poster, backdrop, still, or logo from IMDb using its{' '}
              <span className="font-mono text-amber-300">tt0234144</span> ID for your server banner, app icon, favicon, or any movie/anime.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {appArt ? (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await removeArtwork({ targetType: 'app', targetKey: 'global' })
                    toast('Reset custom app banner & icon')
                  } catch (err) {
                    toast(err instanceof Error ? err.message : 'Could not reset artwork', 'err')
                  }
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1.5 text-[11px] text-white/60 ring-1 ring-white/10 transition hover:bg-red-500/15 hover:text-red-200"
              >
                <Trash2 size={12} />
                Reset
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setImdbOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-accent-600"
            >
              <ImagePlus size={13} />
              Claim from IMDb (tt…)
            </button>
          </div>
        </div>

        {appArt ? (
          <div className="mt-3.5 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <div className="relative h-24 overflow-hidden rounded-xl bg-ink-850 ring-1 ring-white/10">
              {appArt.banner ? (
                <img
                  src={`${appArt.banner.url}?v=${appArt.banner.updatedAt}`}
                  alt="Claimed app banner"
                  className={`h-full w-full object-cover ${focusObjectClass(appArt.banner.focus)}`}
                />
              ) : (
                <div className="grid h-full place-items-center text-[11px] text-white/30">No app banner set</div>
              )}
              <span className="absolute bottom-1.5 left-2 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white/85">
                Banner{appArt.imdbId ? ` · ${appArt.imdbId}` : ''}
              </span>
            </div>

            <div className="flex flex-col items-center justify-center rounded-xl bg-ink-850 px-4 py-2 ring-1 ring-white/10">
              {appArt.icon ? (
                <img
                  src={`${appArt.icon.url}?v=${appArt.icon.updatedAt}`}
                  alt="Claimed app icon"
                  className={`h-12 w-12 rounded-xl object-cover ring-1 ring-white/15 ${focusObjectClass(appArt.icon.focus)}`}
                />
              ) : (
                <div className="grid h-12 w-12 place-items-center rounded-xl bg-ink-800 text-[10px] text-white/30">
                  None
                </div>
              )}
              <span className="mt-1 text-[10px] text-white/45">Icon</span>
            </div>

            <div className="flex flex-col items-center justify-center rounded-xl bg-ink-850 px-4 py-2 ring-1 ring-white/10">
              {appArt.poster ? (
                <img
                  src={`${appArt.poster.url}?v=${appArt.poster.updatedAt}`}
                  alt="Claimed fallback poster"
                  className={`h-12 w-9 rounded object-cover ring-1 ring-white/15 ${focusObjectClass(appArt.poster.focus)}`}
                />
              ) : (
                <div className="grid h-12 w-9 place-items-center rounded bg-ink-800 text-[10px] text-white/30">
                  —
                </div>
              )}
              <span className="mt-1 text-[10px] text-white/45">Cover</span>
            </div>
          </div>
        ) : null}
      </section>

      <section className="mt-6 rounded-xl bg-ink-900 p-4 ring-1 ring-white/5 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-white/40 uppercase">
            <Zap size={13} className="text-accent" />
            Streaming &amp; Default Quality
          </h2>
          <button
            type="button"
            onClick={checkStatus}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 text-[11px] text-white/60 ring-1 ring-white/10 transition hover:text-white"
          >
            {statusBusy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Recheck
          </button>
        </div>

        {status ? (
          status.reachable ? (
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-accent">
              <Check size={12} />
              Provider site reachable
            </p>
          ) : (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-red-300">
              <AlertTriangle size={12} />
              {status.error}
            </p>
          )
        ) : null}

        {status ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] ring-1 ${
                status.ffmpeg
                  ? 'bg-accent/10 text-accent ring-accent/25'
                  : 'bg-red-500/10 text-red-300 ring-red-500/25'
              }`}
            >
              {status.ffmpeg ? <Check size={10} /> : <AlertTriangle size={10} />}
              ffmpeg
            </span>
          </div>
        ) : null}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] text-white/45">Default quality</span>
            <select
              value={draft.quality}
              onChange={(event) => set('quality', event.target.value)}
              className="w-full rounded-lg bg-ink-800 px-2.5 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
            >
              {QUALITIES.map((q) => (
                <option key={q.value} value={q.value}>
                  {q.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[11px] text-white/35">
              Used for live streaming and pre-selected when queuing downloads.
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] text-white/45">Default search result number</span>
            <input
              type="number"
              min={1}
              max={100}
              value={draft.resultIndex}
              onChange={(event) => set('resultIndex', Number(event.target.value))}
              className="w-full rounded-lg bg-ink-800 px-2.5 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
            />
            <span className="mt-1 block text-[11px] text-white/35">
              Which search hit to use before you pick one per show.
            </span>
          </label>

          <label className="flex items-center gap-2 sm:col-span-2">
            <input
              type="checkbox"
              checked={draft.dub}
              onChange={(event) => set('dub', event.target.checked)}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            <span className="text-sm text-white/70">Prefer the English dub</span>
          </label>
        </div>

        {settings.updatedAt > 0 ? (
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-white/35">
            <Check size={11} className="text-accent" />
            Updated {new Date(settings.updatedAt).toLocaleString()}
          </p>
        ) : null}
      </section>

      <section className="mt-6 rounded-xl bg-ink-900 p-4 ring-1 ring-white/5 md:p-5">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-white/40 uppercase">
          <HardDrive size={13} className="text-accent" />
          Shared Media Library &amp; Downloads
        </h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 flex items-center gap-1.5 text-[11px] text-white/45">
              Shared library directory
              {settings.libraryDirLocked ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-accent">
                  <Lock size={10} />
                  env
                </span>
              ) : null}
            </span>
            <input
              value={draft.libraryDir}
              disabled={settings.libraryDirLocked}
              onChange={(event) => set('libraryDir', event.target.value)}
              placeholder="library"
              className="w-full rounded-lg bg-ink-800 px-2.5 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <span className="mt-1 block text-[11px] text-white/35">
              {settings.libraryDirLocked
                ? 'Controlled by the LIBRARY_DIR environment variable on the server.'
                : 'Defaults to library/ (excluded from Git). Absolute paths such as /mnt/media/anime are supported; source folders are blocked.'}
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] text-white/45">Simultaneous downloads</span>
            <input
              type="number"
              min={1}
              max={12}
              value={draft.maxConcurrentDownloads}
              onChange={(event) => set('maxConcurrentDownloads', Number(event.target.value))}
              className="w-full rounded-lg bg-ink-800 px-2.5 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
            />
            <span className="mt-1 block text-[11px] text-white/35">
              How many episodes download in parallel (1–12). Each episode also fetches its HLS segments in parallel, so 2–4 is plenty for most connections.
            </span>
          </label>

          <label className="flex items-center gap-2 sm:col-span-2">
            <input
              type="checkbox"
              checked={draft.preferLocalPlayback}
              onChange={(event) => set('preferLocalPlayback', event.target.checked)}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            <span className="text-sm text-white/70">
              Prefer local library files over remote streaming when an episode is downloaded
            </span>
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[11px] text-white/45">
              Additional approved external source domains
            </span>
            <textarea
              rows={3}
              value={draft.allowedHostsText}
              onChange={(event) => set('allowedHostsText', event.target.value)}
              placeholder={'cdn.example.com\n*.example.org'}
              className="w-full rounded-lg bg-ink-800 px-2.5 py-2 font-mono text-xs text-white placeholder:text-white/25 ring-1 ring-white/10 outline-none focus:ring-accent/60"
            />
            <span className="mt-1 block text-[11px] text-white/35">
              One hostname or wildcard (<code className="text-white/55">*.domain.com</code>) per line for
              external MP4/M3U8 downloads. Private, loopback, and link-local networks are always blocked.
              {settings.envExternalHostsConfigured
                ? ' Additional domains from ALLOWED_SOURCE_HOSTS are also active.'
                : ''}
            </span>
          </label>
        </div>
      </section>

      <section className="mt-6 rounded-xl bg-ink-900 p-4 ring-1 ring-white/5 md:p-5">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-white/40 uppercase">
          <Info size={13} className="text-accent" />
          Appearance
        </h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] text-white/45">Theme</span>
            <select
              value={draft.theme}
              onChange={(event) => set('theme', event.target.value as 'dark' | 'light')}
              className="w-full rounded-lg bg-ink-800 px-2.5 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-accent/60"
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
            <span className="mt-1 block text-[11px] text-white/35">
              Choose between dark and light color schemes.
            </span>
          </label>

          <label className="flex items-center gap-2 sm:col-span-2">
            <input
              type="checkbox"
              checked={draft.systemTheme}
              onChange={(event) => set('systemTheme', event.target.checked)}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            <span className="text-sm text-white/70">
              Follow system theme setting
            </span>
          </label>
        </div>
      </section>

      <section className="mt-6 rounded-xl bg-ink-900 p-4 ring-1 ring-white/5 md:p-5">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-white/40 uppercase">
          <Info size={13} className="text-accent" />
          About the sources
        </h2>
        <div className="mt-3 space-y-2 text-[11px] leading-relaxed text-white/45">
          <p>
            Show metadata, schedules and scores come from AniList and AniDB public APIs. Episodes are
            resolved on the server via the built-in hianime/ZokoAnime resolver and muxed with ffmpeg —
            streamed live or saved into the shared local library under{' '}
            <code className="text-white/60">Anime Name/Season 01/Anime Name - S01E01.mp4</code> for
            offline playback.
          </p>
          <p className="flex flex-wrap gap-3">
            <a
              href="https://github.com/pystardust/ani-cli"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-accent transition hover:underline"
            >
              Provider protocol reference (ani-cli)
              <ExternalLink size={10} />
            </a>
            <a
              href="https://anidb.net/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-accent transition hover:underline"
            >
              AniDB
              <ExternalLink size={10} />
            </a>
          </p>
          <p>
            Streaming and download rules differ by country — use only for media you are authorized to
            access where you live.
          </p>
        </div>
      </section>
    </div>
  )
}
