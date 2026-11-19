// Printable/exportable anime information sheet (AV-100): pure markdown
// builder, shipped pre-computed as `infoSheet` in the detail payload (the
// AV-091 pattern). The sheet is spoiler-safe (it renders the already-redacted
// synopsis) and note-free (AV-099: private notes are never exported).

export function buildInfoSheet(detail) {
  if (!detail?.title) return ''
  const lines = [`# ${detail.title}`, '']
  const meta = [
    detail.format ? `Format: ${detail.format}` : null,
    detail.season ? `Season: ${detail.season}${detail.seasonYear ? ` ${detail.seasonYear}` : ''}` : null,
    detail.status ? `Status: ${detail.status}` : null,
    detail.episodes ? `Episodes: ${detail.episodes}` : null,
    detail.duration ? `Runtime: ${detail.duration} min` : null,
    detail.score ? `Score: ${detail.score}/100` : null,
    detail.studios?.length ? `Studios: ${detail.studios.join(', ')}` : null,
    detail.genres?.length ? `Genres: ${detail.genres.join(', ')}` : null,
  ].filter(Boolean)
  lines.push(...meta, '', detail.synopsis?.text ?? '')
  if (detail.relatedSeasons?.length) {
    lines.push('', '## Watch order', '')
    detail.relatedSeasons.forEach((season, index) => {
      lines.push(`${index + 2}. ${season.title} (${String(season.relationType ?? '').toLowerCase()})`)
    })
  }
  if (detail.links?.length) {
    lines.push('', '## Links', '')
    for (const link of detail.links) lines.push(`- ${link.site}: ${link.url}`)
  }
  return lines.join('\n')
}
