// Tests for external metadata link normalization (server/links.mjs, AV-095).
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeExternalLinks } from '../server/links.mjs'

test('normalizeExternalLinks attributes providers and drops unsafe links', () => {
  const links = normalizeExternalLinks([
    { site: '  Crunchyroll ', url: 'https://www.crunchyroll.com/x', type: 'STREAMING' },
    { site: 'AniDB', url: 'https://anidb.net/a1', type: 'INFO' },
    { site: 'Evil', url: 'javascript:alert(1)', type: 'INFO' },
    { site: '', url: 'https://ok.example', type: 'INFO' },
    { url: 'https://no-site.example' },
    null,
  ])
  assert.deepEqual(links, [
    { site: 'Crunchyroll', url: 'https://www.crunchyroll.com/x', type: 'STREAMING' },
    { site: 'AniDB', url: 'https://anidb.net/a1', type: 'INFO' },
  ], 'unsafe and unattributable entries dropped, provider names normalized')
  assert.deepEqual(normalizeExternalLinks(null), [])
  const noType = normalizeExternalLinks([{ site: 'S', url: 'https://s.example' }])
  assert.equal(noType[0].type, null, 'missing types normalize to null')
})
