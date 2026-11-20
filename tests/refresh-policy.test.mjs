// AV-018: metadata refresh policy per entity type.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  entityTypeFromFormat,
  fieldCategory,
  refreshPolicy,
  fieldFreshness,
  isFieldStale,
  recordRefreshStatus,
  CATALOG_METADATA_FIELDS,
} from '../server/catalog.mjs'
import { createAnimeRecord } from '../server/catalog.mjs'

const HOUR = 60 * 60 * 1000
const DAY = 24 * 60 * 60 * 1000

// ── Entity type mapping ───────────────────────────────────────────────

test('entityTypeFromFormat maps known formats', () => {
  assert.equal(entityTypeFromFormat('TV'), 'TV')
  assert.equal(entityTypeFromFormat('Movie'), 'Movie')
  assert.equal(entityTypeFromFormat('OVA'), 'OVA')
  assert.equal(entityTypeFromFormat('ONA'), 'ONA')
  assert.equal(entityTypeFromFormat('Special'), 'Special')
})

test('entityTypeFromFormat normalizes case and separators', () => {
  assert.equal(entityTypeFromFormat('tv'), 'TV')
  assert.equal(entityTypeFromFormat('TV_SERIES'), 'Other')
  assert.equal(entityTypeFromFormat('movie'), 'Movie')
})

test('entityTypeFromFormat falls back to Other for missing or unknown', () => {
  assert.equal(entityTypeFromFormat(null), 'Other')
  assert.equal(entityTypeFromFormat(undefined), 'Other')
  assert.equal(entityTypeFromFormat(''), 'Other')
  assert.equal(entityTypeFromFormat('UnknownFormat'), 'Other')
})

// ── Field categories ──────────────────────────────────────────────────

test('fieldCategory groups fields by staleness tolerance', () => {
  assert.equal(fieldCategory('title'), 'identity')
  assert.equal(fieldCategory('cover'), 'identity')
  assert.equal(fieldCategory('status'), 'airing')
  assert.equal(fieldCategory('nextEpisode'), 'airing')
  assert.equal(fieldCategory('score'), 'score')
  assert.equal(fieldCategory('providerScores'), 'score')
  assert.equal(fieldCategory('description'), 'descriptive')
  assert.equal(fieldCategory('tags'), 'descriptive')
  assert.equal(fieldCategory('links'), 'links')
  assert.equal(fieldCategory('streams'), 'links')
})

test('fieldCategory defaults unknown fields to descriptive', () => {
  assert.equal(fieldCategory('notARealField'), 'descriptive')
  assert.equal(fieldCategory('metadataSchemaVersion'), 'descriptive')
})

// ── Refresh policy ────────────────────────────────────────────────────

test('refreshPolicy returns maxAgeMs and category for a field', () => {
  const policy = refreshPolicy('TV', 'nextEpisode')
  assert.equal(policy.category, 'airing')
  assert.equal(policy.maxAgeMs, HOUR)
})

test('TV airing fields refresh more often than movies', () => {
  assert.equal(refreshPolicy('TV', 'status').maxAgeMs, HOUR)
  assert.equal(refreshPolicy('Movie', 'status').maxAgeMs, 7 * DAY)
})

test('identity fields are long-lived for all entity types', () => {
  assert.equal(refreshPolicy('TV', 'title').maxAgeMs, 30 * DAY)
  assert.equal(refreshPolicy('Movie', 'title').maxAgeMs, 30 * DAY)
})

test('refreshPolicy falls back to Other for unknown entity types', () => {
  const other = refreshPolicy('NotAType', 'score')
  assert.equal(other.category, 'score')
  assert.equal(other.maxAgeMs, 3 * DAY)
})

// ── Field freshness ───────────────────────────────────────────────────

const now = 1_735_689_600_000 // 2025-01-01T00:00:00Z

test('fieldFreshness returns never_refreshed for null refresh time', () => {
  assert.equal(fieldFreshness('title', null, 'TV', now), 'never_refreshed')
  assert.equal(fieldFreshness('title', undefined, 'TV', now), 'never_refreshed')
})

test('fieldFreshness returns unknown for unparseable refresh time', () => {
  assert.equal(fieldFreshness('title', 'not-a-date', 'TV', now), 'unknown')
})

test('fieldFreshness treats a numeric timestamp as milliseconds', () => {
  // 123 ms since epoch is far older than any TTL → stale.
  assert.equal(fieldFreshness('title', 123, 'TV', now), 'stale')
})

test('fieldFreshness returns fresh within max age', () => {
  const refreshed = now - HOUR / 2 // 30 minutes ago
  assert.equal(fieldFreshness('status', refreshed, 'TV', now), 'fresh')
})

test('fieldFreshness returns stale beyond max age', () => {
  const refreshed = now - HOUR * 25 // 25 hours ago (> 1 hour TTL for TV airing)
  assert.equal(fieldFreshness('status', refreshed, 'TV', now), 'stale')
})

test('fieldFreshness uses entity-type TTL', () => {
  const twentyFourHoursAgo = now - 24 * HOUR
  // Movie status TTL is 7 days, so 24 hours ago is fresh.
  assert.equal(fieldFreshness('status', twentyFourHoursAgo, 'Movie', now), 'fresh')
  // TV status TTL is 1 hour, so 24 hours ago is stale.
  assert.equal(fieldFreshness('status', twentyFourHoursAgo, 'TV', now), 'stale')
})

test('fieldFreshness boundary: exactly at max age is fresh', () => {
  const refreshed = now - HOUR // exactly 1 hour ago
  assert.equal(fieldFreshness('status', refreshed, 'TV', now), 'fresh')
})

// ── isFieldStale ──────────────────────────────────────────────────────

test('isFieldStale mirrors fieldFreshness', () => {
  assert.equal(isFieldStale('title', null, 'TV'), true)
  assert.equal(isFieldStale('title', now - 1000, 'TV', now), false)
})

// ── Record refresh status ─────────────────────────────────────────────

test('recordRefreshStatus reports all fields fresh for a fresh record', () => {
  const freshMeta = Object.fromEntries(
    CATALOG_METADATA_FIELDS.map((field) => [field, { lastRefreshedAt: now }])
  )
  const record = createAnimeRecord({ id: 1, format: 'TV', fieldMetadata: freshMeta })
  const status = recordRefreshStatus(record, now)
  assert.equal(status.needsRefresh, false)
  assert.deepEqual(status.staleFields, [])
  assert.equal(status.freshness.title, 'fresh')
  assert.equal(status.freshness.status, 'fresh')
})

test('recordRefreshStatus flags stale and never-refreshed fields', () => {
  const record = createAnimeRecord({
    id: 2,
    format: 'TV',
    fieldMetadata: {
      title: { lastRefreshedAt: null }, // never refreshed
      status: { lastRefreshedAt: now - 2 * HOUR }, // stale (> 1h TTL)
      score: { lastRefreshedAt: now }, // fresh
    },
  })
  const status = recordRefreshStatus(record, now)
  assert.equal(status.needsRefresh, true)
  assert.ok(status.staleFields.includes('title'))
  assert.ok(status.staleFields.includes('status'))
  assert.equal(status.freshness.title, 'never_refreshed')
  assert.equal(status.freshness.status, 'stale')
  assert.equal(status.freshness.score, 'fresh')
})

test('recordRefreshStatus does not mutate the record', () => {
  const record = createAnimeRecord({ id: 3, format: 'Movie' })
  const before = JSON.parse(JSON.stringify(record))
  recordRefreshStatus(record, now)
  assert.deepEqual(record, before)
})
