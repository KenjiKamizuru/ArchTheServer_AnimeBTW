// Tests for the local-catalog full-text wiring (server/catalogIndex.mjs, AV-075b).
import test from 'node:test'
import assert from 'node:assert/strict'
import { localDocuments, indexSignature, createCatalogIndexer } from '../server/catalogIndex.mjs'

const sources = () => ({
  libraryItems: [
    { id: 12, animeTitle: 'Frieren', seriesTitle: 'Frieren', fileName: 'frieren-s1.mkv', folder: 'Frieren', quality: '1080p', episode: 3, animeId: 200 },
  ],
  bookmarks: [
    { media: { id: 200, title: 'Frieren', romaji: 'Sousou no Frieren', genres: ['Adventure'] }, addedAt: 1000 },
    { media: { id: 201, title: 'Gundam Wing', synonyms: ['New Mobile Report Gundam Wing'] }, addedAt: 2000 },
  ],
  listEntries: [
    { media: { id: 200, title: 'Frieren' }, listNames: ['Watching'], addedAt: 1500 },
    { media: { id: 202, title: 'Monster' }, listNames: ['Planned', 'Classics'], addedAt: 3000 },
  ],
})

test('localDocuments indexes every source with searchable text', () => {
  const docs = localDocuments(sources())
  assert.deepEqual(docs.map((d) => d.id), ['lib:12', 'bm:200', 'bm:201', 'lst:200', 'lst:202'])
  const lib = docs[0]
  assert.equal(lib.source, 'library')
  assert.ok(lib.text.includes('frieren-s1.mkv'))
  assert.equal(lib.subtitle, '1080p · episode 3')
  const bm = docs[2]
  assert.ok(bm.text.includes('New Mobile Report Gundam Wing'), 'synonyms are searchable')
  const lst = docs[4]
  assert.equal(lst.subtitle, 'Planned · Classics')
  assert.deepEqual(localDocuments(), [])
})

test('indexSignature changes when sources change', () => {
  const base = sources()
  const a = indexSignature(base)
  assert.equal(indexSignature(sources()), a, 'same content, same signature')
  const grown = { ...base, bookmarks: [...base.bookmarks, { media: { id: 9, title: 'X' }, addedAt: 50 }] }
  assert.notEqual(indexSignature(grown), a)
})

test('the indexer searches, ranks, dedupes and refreshes on change', () => {
  const indexer = createCatalogIndexer()
  const hits = indexer.search(sources(), 'frieren')
  assert.equal(hits.length, 1, 'a media in bookmarks and lists is returned once')
  assert.equal(hits[0].mediaId, 200)
  assert.ok(hits[0].score > 0)
  assert.equal(indexer.search(sources(), 'gundam wing').length, 1)
  assert.deepEqual(indexer.search(sources(), 'nothing here'), [])
  const grown = {
    ...sources(),
    bookmarks: [...sources().bookmarks, { media: { id: 203, title: 'Slayers' }, addedAt: 9000 }],
  }
  assert.equal(indexer.search(grown, 'slayers').length, 1, 'the cached index refreshes when sources change')
  assert.equal(indexer.search(sources(), 'slayers').length, 0, 'shrinking sources also refreshes')
})
