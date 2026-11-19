// Sort a copy so viewing a list never changes its persisted order.
export const LIST_SORTS = ['added', 'oldest', 'title', 'score', 'year']
export function sortListEntries(entries, sort = 'added') {
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
      case 'oldest': return a.addedAt - b.addedAt || id(a, b)
      case 'title': return title(a).localeCompare(title(b), undefined, { sensitivity: 'base', numeric: true }) || id(a, b)
      case 'score': return missingLast(a.media?.score, b.media?.score) || id(a, b)
      case 'year': return missingLast(a.media?.seasonYear, b.media?.seasonYear) || id(a, b)
      default: return b.addedAt - a.addedAt || id(a, b)
    }
  })
}
