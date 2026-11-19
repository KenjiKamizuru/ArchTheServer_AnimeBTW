// Contract guard for the studio filmography (AV-088): the catalog must be the
// studio's COMPLETE known catalog — no main-studio-only filtering — so every
// credited work (including co-productions) appears.
import test from 'node:test'
import assert from 'node:assert/strict'
import { STUDIO_FILMOGRAPHY_QUERY } from '../server/anilist.mjs'

test('the studio filmography query returns the complete catalog', () => {
  // Scope the check to the filmography's own media connection: the
  // interpolated MEDIA_FIELDS fragment legitimately contains `studios(isMain:…)`
  // (studio-vs-producer names on Media), which must not trip the guard.
  const connection = /media\(page: \$page[^)]*\)/.exec(STUDIO_FILMOGRAPHY_QUERY)?.[0] ?? ''
  assert.equal(
    connection,
    'media(page: $page, perPage: $perPage, sort: $sort)',
    'the media connection is paginated and unfiltered',
  )
  assert.ok(!connection.includes('isMain'), 'no isMain filter — co-productions are part of the catalog')
  assert.ok(STUDIO_FILMOGRAPHY_QUERY.includes('pageInfo { hasNextPage total }'), 'pagination stays available for full coverage')
  assert.ok(STUDIO_FILMOGRAPHY_QUERY.includes('title'), 'media node fields are interpolated into the query')
})
