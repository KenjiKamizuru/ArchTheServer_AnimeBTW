// Tests for the episode guide and detail payload assembly (server/detail.mjs,
// AV-077/078) — covers the /api/anime/:id response shape end to end so a key
// mismatch can never silently kill the guide UI again.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEpisodeGuide, buildDetailResponse } from '../server/detail.mjs'

const media = {
  title: 'Weekly Show',
  description: 'A story. ~!the hero dies!~ more.',
  episodes: 3,
  duration: 24,
  nextEpisode: { episode: 3, airingAt: 1_700_000_000 },
  streamingEpisodes: [
    { title: 'Episode 2 - The Journey', thumbnail: 'https://img/2.jpg', url: 'https://s/2', site: 'YouTube', description: 'They travel.' },
    { title: 'Episode 99 - Beyond', description: 'Ignored, out of range.' },
  ],
}

test('buildEpisodeGuide produces numbered entries with per-episode metadata', () => {
  const guide = buildEpisodeGuide(media, media.streamingEpisodes)
  assert.deepEqual(guide.map((e) => e.number), [1, 2, 3], 'numbered 1..total')
  const ep2 = guide[1]
  assert.equal(ep2.title, 'The Journey', 'AniList episode prefix stripped')
  assert.equal(ep2.runtimeMinutes, 24)
  assert.equal(ep2.synopsis, 'They travel.', 'synopsis comes from the streaming description when available')
  assert.equal(ep2.hasMetadata, true)
  assert.equal(ep2.thumbnail, 'https://img/2.jpg')
  assert.ok(ep2.airDate, 'aired episodes get derived air dates')
  assert.equal(guide[0].hasMetadata, false, 'placeholder rows without streaming data')
  assert.equal(guide[0].title, null)
  assert.equal(guide[0].synopsis, null)
  assert.deepEqual(buildEpisodeGuide({ ...media, episodes: null, airedEpisodes: 0 }), [], 'no known episode count, no guide')
})

test('buildDetailResponse keeps the episode count and exposes the guide array', () => {
  const res = buildDetailResponse(media)
  assert.equal(res.episodes, 3, 'episodes stays a numeric count')
  assert.ok(Array.isArray(res.episodesGuide))
  assert.equal(res.episodesGuide.length, 3)
  assert.equal(typeof res.synopsis.text, 'string')
  assert.equal(res.synopsis.hiddenCount, 1)
  assert.ok(!res.synopsis.text.includes('the hero dies'))
  assert.ok(res.synopsis.text.includes('[spoiler hidden]'))
  assert.equal(res.hasSpoilers, true)
  assert.ok(!String(res.overview).includes('the hero dies'), 'overview is spoiler-free')
  assert.ok(res.sections.some((s) => s.id === 'episodes'))
  assert.equal(res.scoreMean, null, 'score stats stay null without buckets')
  const revealed = buildDetailResponse(media, { reveal: true })
  assert.ok(revealed.synopsis.text.includes('the hero dies'))
  assert.equal(revealed.synopsis.hiddenCount, 0)
})
