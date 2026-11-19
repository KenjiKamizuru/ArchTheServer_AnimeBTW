// Share-link metadata for per-anime pages (AV-076): pure helpers that turn a
// media record into document/OpenGraph tags and splice them into the SPA
// shell. The production static catch-all in server/index.mjs uses these so a
// shared /anime/:id link unfurls with the show's name and cover; the dev
// server serves the shell directly and the client title effect covers tabs.

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/** Display title chain, matching what the detail page header shows. */
export function documentTitle(media) {
  return media?.title || media?.romaji || media?.english || media?.native || 'Anime'
}

/** Builds the tag payload for one anime page. */
export function documentMeta(media, { origin = '', pagePath = '' } = {}) {
  const title = documentTitle(media)
  const raw = String(media?.description ?? '').replace(/\s+/g, ' ').trim()
  const description = raw.length > 200 ? `${raw.slice(0, 197).replace(/\s+\S*$/, '')}…` : raw
  const cover = typeof media?.cover === 'string' ? media.cover : ''
  return {
    title: `${title} · AnimeVault`,
    description,
    image: cover.startsWith('/') ? `${origin}${cover}` : cover,
    url: `${origin}${pagePath}`,
  }
}

/**
 * Splices title + OG/Twitter tags into the SPA shell HTML. Replaces any
 * existing tag for the same property/name so repeated injection never
 * duplicates. All values are HTML-escaped.
 */
export function injectDocumentMeta(html, meta) {
  let out = String(html).replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(meta.title)}</title>`)
  const tags = [
    ['property', 'og:title', meta.title],
    ['property', 'og:description', meta.description],
    ['property', 'og:image', meta.image],
    ['property', 'og:url', meta.url],
    ['name', 'twitter:card', meta.image ? 'summary_large_image' : 'summary'],
  ]
  for (const [attr, key, value] of tags) {
    if (!value && key !== 'twitter:card') continue
    const tag = `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`
    const pattern = new RegExp(`<meta[^>]*(?:property|name)="${key}"[^>]*/?>`, 'i')
    if (pattern.test(out)) out = out.replace(pattern, tag)
    else out = out.replace(/<\/head>/i, `  ${tag}\n</head>`)
  }
  return out
}
