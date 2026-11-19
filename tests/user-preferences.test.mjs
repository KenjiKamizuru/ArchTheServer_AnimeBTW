// Tests for per-user language & locale preferences (AV-112).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizePreferredLanguage,
  normalizeLocale,
  normalizeDefaultSubtitle,
  normalizeDefaultAudio,
  normalizePreferencesUpdate,
} from '../server/userPreferences.mjs'

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
