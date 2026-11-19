// Tests for per-user language & locale preferences (AV-112).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizePreferredLanguage,
  normalizeLocale,
  normalizeDefaultSubtitle,
  normalizeDefaultAudio,
  normalizeDefaultQuality,
  normalizeMaxContentRating,
  normalizeTheme,
  normalizePreferLocalPlayback,
  normalizeLoginNotifications,
  normalizePreferencesUpdate,
  PLAYBACK_QUALITIES,
  CONTENT_RATINGS,
  THEMES,
} from '../server/userPreferences.mjs'
import { loginNotificationMessage } from '../server/mail.mjs'

test('language tags: pattern validation, normalization, empty clears', () => {
  assert.deepEqual(normalizePreferredLanguage('en'), { ok: true, value: 'en' })
  assert.deepEqual(normalizePreferredLanguage(' PT_br '), { ok: true, value: 'pt-br' })
  assert.deepEqual(normalizePreferredLanguage('zh-Hant'), { ok: true, value: 'zh-hant' })
  assert.deepEqual(normalizePreferredLanguage(''), { ok: true, value: null })
  assert.deepEqual(normalizePreferredLanguage(undefined), { ok: true, value: null })
  for (const bad of ['english', 'e n', 'en-US-TOO-MANY-SEGMENTS-EXTRA', '<script>', 'en;drop', 'a', 'x'.repeat(21)]) {
    const result = normalizePreferredLanguage(bad)
    assert.equal(result.ok, false, `should reject ${JSON.stringify(bad)}`)
    assert.match(result.error, /language tag|too long/)
  }
  assert.deepEqual(normalizeLocale('ja_JP'), { ok: true, value: 'ja-jp' })
  assert.equal(normalizeLocale('!!').ok, false)
})

test('preference updates are partial and strict', () => {
  assert.deepEqual(normalizePreferencesUpdate({ preferredLanguage: 'ja' }), {
    ok: true,
    value: { preferredLanguage: 'ja' },
  })
  assert.deepEqual(normalizePreferencesUpdate({ locale: 'en-US' }), {
    ok: true,
    value: { locale: 'en-us' },
  })
  assert.deepEqual(normalizePreferencesUpdate({}), { ok: true, value: {} })
  assert.deepEqual(normalizePreferencesUpdate(null), { ok: true, value: {} })
  assert.deepEqual(normalizePreferencesUpdate({ preferredLanguage: '', locale: 'de-DE', ignored: 1 }), {
    ok: true,
    value: { preferredLanguage: null, locale: 'de-de' },
  })
  const bad = normalizePreferencesUpdate({ preferredLanguage: 'nope!!' })
  assert.equal(bad.ok, false)
  const partialBad = normalizePreferencesUpdate({ preferredLanguage: 'en', locale: 'bad locale' })
  assert.equal(partialBad.ok, false, 'one invalid field rejects the update')
})

test('playback defaults: subtitle sentinel, language tags, strict updates', () => {
  assert.deepEqual(normalizeDefaultSubtitle('off'), { ok: true, value: 'off' })
  assert.deepEqual(normalizeDefaultSubtitle(' EN '), { ok: true, value: 'en' })
  assert.deepEqual(normalizeDefaultSubtitle(''), { ok: true, value: null })
  assert.equal(normalizeDefaultSubtitle('offside').ok, false, "'offside' is not the sentinel and not a tag")
  assert.equal(normalizeDefaultSubtitle('<img onerror>').ok, false)
  assert.deepEqual(normalizeDefaultAudio('ja'), { ok: true, value: 'ja' })
  assert.deepEqual(normalizeDefaultAudio(null), { ok: true, value: null })
  assert.equal(normalizeDefaultAudio('japanese please').ok, false)

  assert.deepEqual(normalizePreferencesUpdate({ defaultSubtitle: 'off', defaultAudio: 'ja' }), {
    ok: true,
    value: { defaultSubtitle: 'off', defaultAudio: 'ja' },
  })
  assert.deepEqual(normalizePreferencesUpdate({ defaultSubtitle: '', preferredLanguage: 'en' }), {
    ok: true,
    value: { defaultSubtitle: null, preferredLanguage: 'en' },
  })
  const bad = normalizePreferencesUpdate({ defaultSubtitle: 'none at all' })
  assert.equal(bad.ok, false)
  assert.deepEqual(normalizePreferencesUpdate({ other: 1 }), { ok: true, value: {} }, 'unknown keys are ignored')
})

test('playback quality: closed-set allowlist', () => {
  for (const quality of PLAYBACK_QUALITIES) {
    assert.deepEqual(normalizeDefaultQuality(quality), { ok: true, value: quality })
  }
  assert.deepEqual(normalizeDefaultQuality(' 1080P '), { ok: true, value: '1080p' }, 'case-insensitive')
  assert.deepEqual(normalizeDefaultQuality(''), { ok: true, value: null })
  assert.deepEqual(normalizeDefaultQuality(null), { ok: true, value: null })
  for (const bad of ['1440p', 'best', '<b>1080p</b>', '1080', 'ultra']) {
    assert.equal(normalizeDefaultQuality(bad).ok, false, `should reject ${JSON.stringify(bad)}`)
  }
  assert.deepEqual(normalizePreferencesUpdate({ defaultQuality: '720p' }), {
    ok: true,
    value: { defaultQuality: '720p' },
  })
  const badUpdate = normalizePreferencesUpdate({ defaultQuality: 'best' })
  assert.equal(badUpdate.ok, false)
})

test('content rating: MAL-aligned closed set, null = no limit', () => {
  assert.deepEqual([...CONTENT_RATINGS], ['g', 'pg', 'pg-13', 'r', 'r+', 'nc-17'], 'ordering is the documented scalar')
  for (const rating of CONTENT_RATINGS) {
    assert.deepEqual(normalizeMaxContentRating(rating), { ok: true, value: rating })
  }
  assert.deepEqual(normalizeMaxContentRating(' PG-13 '), { ok: true, value: 'pg-13' }, 'case-insensitive')
  assert.deepEqual(normalizeMaxContentRating(''), { ok: true, value: null })
  assert.deepEqual(normalizeMaxContentRating(undefined), { ok: true, value: null })
  for (const bad of ['pg13', 'r-17', 'm', 'tv-14', '<i>r</i>', 'everyone']) {
    assert.equal(normalizeMaxContentRating(bad).ok, false, `should reject ${JSON.stringify(bad)}`)
  }
  assert.deepEqual(normalizePreferencesUpdate({ maxContentRating: 'r+' }), {
    ok: true,
    value: { maxContentRating: 'r+' },
  })
  assert.equal(normalizePreferencesUpdate({ maxContentRating: 'nc-18' }).ok, false)
})

test('theme & interface overrides: closed sets, null follows global', () => {
  assert.deepEqual([...THEMES], ['dark', 'light', 'system'])
  for (const theme of THEMES) {
    assert.deepEqual(normalizeTheme(theme), { ok: true, value: theme })
  }
  assert.deepEqual(normalizeTheme(' LIGHT '), { ok: true, value: 'light' })
  assert.deepEqual(normalizeTheme(''), { ok: true, value: null })
  for (const bad of ['sepia', 'dark;', '<b>dark</b>', 'auto']) {
    assert.equal(normalizeTheme(bad).ok, false, `should reject ${JSON.stringify(bad)}`)
  }
  assert.deepEqual(normalizePreferLocalPlayback(true), { ok: true, value: true })
  assert.deepEqual(normalizePreferLocalPlayback(false), { ok: true, value: false })
  assert.deepEqual(normalizePreferLocalPlayback(null), { ok: true, value: null })
  assert.deepEqual(normalizePreferLocalPlayback(''), { ok: true, value: null })
  for (const bad of ['yes', 'true', 1, 0, 'no']) {
    assert.equal(normalizePreferLocalPlayback(bad).ok, false, `should reject ${JSON.stringify(bad)}`)
  }
  assert.deepEqual(normalizePreferencesUpdate({ theme: 'system', preferLocalPlayback: false }), {
    ok: true,
    value: { theme: 'system', preferLocalPlayback: false },
  })
  assert.equal(normalizePreferencesUpdate({ theme: 'neon' }).ok, false)
})

test('login notifications: strict boolean opt-in + message shape', () => {
  assert.deepEqual(normalizeLoginNotifications(true), { ok: true, value: true })
  assert.deepEqual(normalizeLoginNotifications(false), { ok: true, value: false })
  assert.deepEqual(normalizeLoginNotifications(null), { ok: true, value: null })
  assert.deepEqual(normalizeLoginNotifications(''), { ok: true, value: null }, 'empty clears (established convention)')
  for (const bad of ['true', 'on', 1, 0]) {
    assert.equal(normalizeLoginNotifications(bad).ok, false, `should reject ${JSON.stringify(bad)}`)
  }
  assert.deepEqual(normalizePreferencesUpdate({ loginNotifications: true }), {
    ok: true,
    value: { loginNotifications: true },
  })
  const message = loginNotificationMessage(
    { username: 'kenji', displayName: 'Kenji', email: 'k@example.test' },
    { now: 1_000 },
  )
  assert.equal(message.to, 'k@example.test')
  assert.equal(message.subject, 'New sign-in to your account')
  assert.ok(message.text.includes('1970-01-01T00:00:01.000Z'), 'the sign-in time is stated')
  assert.ok(message.text.includes('Kenji'))
  assert.ok(!message.text.toLowerCase().includes('new device'), 'no fabricated device detection')
})
