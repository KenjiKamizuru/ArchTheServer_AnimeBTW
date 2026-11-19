// Tests for share-link document metadata (server/htmlMeta.mjs, AV-076).
import test from 'node:test'
import assert from 'node:assert/strict'
import { documentTitle, documentMeta, injectDocumentMeta } from '../server/htmlMeta.mjs'

const media = {
  title: 'Frieren',
  romaji: 'Sousou no Frieren',
  english: "Frieren: Beyond Journey's End",
  native: '葬送のフリーレン',
  description: '  The   adventure   continues.  ',
  cover: '/covers/frieren.jpg',
}

test('documentMeta builds share metadata from a record', () => {
  const meta = documentMeta(media, { origin: 'https://vault.example', pagePath: '/anime/200' })
  assert.equal(meta.title, 'Frieren · AnimeVault')
  assert.equal(documentTitle(media), 'Frieren', 'matches the page header title chain')
  assert.equal(meta.description, 'The adventure continues.', 'whitespace collapsed')
  assert.equal(meta.image, 'https://vault.example/covers/frieren.jpg', 'root-relative cover made absolute')
  assert.equal(meta.url, 'https://vault.example/anime/200')
  assert.equal(documentTitle({ romaji: 'Fallback' }), 'Fallback')
  assert.equal(documentTitle({}), 'Anime')
  const long = documentMeta({ title: 'T', description: 'word '.repeat(80) })
  assert.ok(long.description.length <= 200, 'description is capped')
  assert.ok(long.description.endsWith('…'))
})

test('injectDocumentMeta replaces the shell title and injects OG tags', () => {
  const html = '<html><head><title>AnimeVault</title><meta charset="utf-8" /></head><body></body></html>'
  const meta = documentMeta(media, { origin: 'https://vault.example', pagePath: '/anime/200' })
  const out = injectDocumentMeta(html, meta)
  assert.ok(out.includes('<title>Frieren · AnimeVault</title>'))
  assert.ok(out.includes('property="og:title" content="Frieren · AnimeVault"'))
  assert.ok(out.includes('property="og:image" content="https://vault.example/covers/frieren.jpg"'))
  assert.ok(out.includes('property="og:url" content="https://vault.example/anime/200"'))
  assert.ok(out.includes('name="twitter:card" content="summary_large_image"'))
  const twice = injectDocumentMeta(out, meta)
  assert.equal((twice.match(/og:title/g) ?? []).length, 1, 're-injection does not duplicate tags')
})

test('injectDocumentMeta escapes markup in values', () => {
  const out = injectDocumentMeta('<head><title>x</title></head>', {
    title: '<script>"evil"</script>',
    description: '',
    image: '',
    url: '',
  })
  assert.ok(!out.includes('<script>'))
  assert.ok(out.includes('&lt;script&gt;&quot;evil&quot;&lt;/script&gt;'))
})
