// Export a single installation-wide list without exposing other memberships.
export function exportListJson(list) {
  return JSON.stringify({
    format: 'animevault-list', version: 1,
    list: { name: list.name, description: list.description ?? '', entries: list.entries.map(({ mediaId, media, status, addedAt }) => ({ mediaId, media, status, addedAt })) },
  }, null, 2)
}

// Neutralize spreadsheet formulas, including those preceded by whitespace or
// control characters, before applying RFC 4180 quoting.
export function csvCell(value) {
  let text = String(value ?? '')
  if (/^[\s\x00-\x1f]*[=+\-@]/.test(text) || /^[\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}
export function exportListCsv(list) {
  const rows = [['mediaId', 'title', 'status', 'addedAt']]
  for (const entry of list.entries) {
    const date = new Date(entry.addedAt)
    rows.push([entry.mediaId, entry.media.title, entry.status ?? '', Number.isFinite(date.getTime()) ? date.toISOString() : ''])
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
