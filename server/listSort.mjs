// Sort a copy so viewing a list never changes its persisted order.
export const LIST_SORTS = ['added', 'oldest', 'title', 'score', 'year', 'order']
export function sortListEntries(entries, sort = 'added', order = null) {
  if (!LIST_SORTS.includes(sort)) throw Object.assign(new Error('Unknown list sort'), { status: 400 })
  const title = (e) => String(e.media?.title ?? '')
  const id = (a, b) => a.mediaId - b.mediaId
  const missingLast = (a, b, descending = true) => {
    const x = a == null || !Number.isFinite(Number(a)) ? null : Number(a)
    const y = b == null || !Number.isFinite(Number(b)) ? null : Number(b)
    if (x === null) return y === null ? 0 : 1
    if (y === null) return -1
    return descending ? y - x : x - y
  }
  return [...entries].sort((a, b) => {
    switch (sort) {
      // Manual order (AV-128): position in the custom list's order array;
      // unlisted entries sort after ordered ones (then added desc). Without an
      // order array (status lists) this falls back to the default.
      case 'order': {
        if (!Array.isArray(order)) return b.addedAt - a.addedAt || id(a, b)
        const pos = (e) => { const i = order.indexOf(e.mediaId); return i === -1 ? Number.POSITIVE_INFINITY : i }
        return pos(a) - pos(b) || b.addedAt - a.addedAt || id(a, b)
      }
      case 'oldest': return a.addedAt - b.addedAt || id(a, b)
      case 'title': return title(a).localeCompare(title(b), undefined, { sensitivity: 'base', numeric: true }) || id(a, b)
      case 'score': return missingLast(a.media?.score, b.media?.score) || id(a, b)
      case 'year': return missingLast(a.media?.seasonYear, b.media?.seasonYear) || id(a, b)
      default: return b.addedAt - a.addedAt || id(a, b)
    }
  })
}
