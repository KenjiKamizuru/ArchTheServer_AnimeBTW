// Verified anime relationship detection (AV-116a): pair-wise relationship
// typing from OFFICIAL relationship metadata (AniList/MAL/Kitsu relation
// edges). Title similarity is never decisive — it only hints at candidates;
// without database evidence the verdict is `uncertain`, never a guess.
//
// Canonical kinds (requirement taxonomy):
//   same-entry, split-cour, next-season, prequel, sequel, ova, ona, movie,
//   spin-off, special, side-story, parent-story, alternative-version, remake,
//   reboot, compilation, summary, adaptation, source, character, other,
//   unrelated, unknown
//
// Record semantics: `type` describes entry B relative to entry A where the
// edge is directional ('sequel' = B continues A), otherwise symmetric.

/** Map a database relation edge (AniList vocabulary) to a canonical kind. */
export function classifyEdge(edge = {}) {
  const relationType = String(edge.relationType ?? '').toUpperCase()
  const format = String(edge.format ?? '').toUpperCase()
  switch (relationType) {
    case 'SEQUEL':
      return 'sequel'
    case 'PREQUEL':
      return 'prequel'
    case 'PARENT':
    case 'PARENT_STORY':
      return 'parent-story'
    case 'SPIN_OFF':
    case 'SPINOFF':
      return 'spin-off'
    case 'ALTERNATIVE':
      return edge.remake ? 'remake' : edge.reboot ? 'reboot' : 'alternative-version'
    case 'SIDE_STORY':
      return formatKind(format, 'side-story')
    case 'CHARACTER':
      return 'character'
    case 'SOURCE':
      return 'source'
    case 'ADAPTATION':
      return 'adaptation'
    case 'COMPILATION':
      return 'compilation'
    case 'SUMMARY':
      return 'summary'
    case 'OTHER':
      return edge.bonus ? 'special' : formatKind(format, 'other')
    default:
      return 'unknown'
  }
}

function formatKind(format, fallback) {
  if (format === 'OVA' || format === 'OAD') return 'ova'
  if (format === 'ONA') return 'ona'
  if (format === 'MOVIE') return 'movie'
  if (format === 'TV_SPECIAL' || format === 'SPECIAL') return 'special'
  return fallback
}

/** Mirrored edges carry inverse directional types (S1 "Sequel: S2" /
 * S2 "Prequel: S1"). Express every edge's kind relative to entry A. */
export function relativeKind(edge, { fromB = false } = {}) {
  const kind = classifyEdge(edge)
  if (!fromB) return kind
  if (kind === 'sequel') return 'prequel'
  if (kind === 'prequel') return 'sequel'
  return kind
}

/** Canonical split-cour/season part markers on OFFICIAL entry titles (metadata,
 * never filenames): "Part 2", "Cour 2", "第2クール", "2nd Cour", "Part II". */
const PART_MARKER = /\b(part\s*[0-9ivx]+|cour\s*[0-9ivx]+|[0-9]+(?:st|nd|rd|th)\s*cour)\b|第\s*[0-9０-９]+\s*クール/gi

export function stripPartMarkers(title) {
  return String(title ?? '').replace(PART_MARKER, ' ').replace(/\s+/g, ' ').trim()
}

/** Two official titles that are identical once part markers are removed are
 * two cours/parts of the SAME season. */
export function isSplitCourPair(titleA, titleB) {
  const a = normalizeTitleKey(stripPartMarkers(titleA))
  const b = normalizeTitleKey(stripPartMarkers(titleB))
  return Boolean(a && a === b && normalizeTitleKey(titleA) !== normalizeTitleKey(titleB))
}

/** Casefolded alias key: lowercased, punctuation and separators removed. */
export function normalizeTitleKey(title) {
  return String(title ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, '')
}

/** All alias keys of an entry: title variants + synonyms + native + romaji. */
export function titleAliasKeys(entry = {}) {
  const names = [
    entry.title,
    entry.romaji,
    entry.english,
    entry.native,
    ...(Array.isArray(entry.synonyms) ? entry.synonyms : []),
    ...(Array.isArray(entry.titles) ? entry.titles : []),
  ]
  const keys = new Set()
  for (const name of names) {
    const key = normalizeTitleKey(name)
    if (key) keys.add(key)
  }
  return keys
}

/** Order-independent pair key for relationship caches. */
export function relationshipCacheKey(idA, idB) {
  const a = String(idA ?? '')
  const b = String(idB ?? '')
  return `rel:${[a, b].sort().join('~')}`
}

/**
 * Verify the relationship between two entries.
 *
 * `entry` shape (evidence gathered online by the caller):
 *   {
 *     key,                      // stable lookup key (e.g. 'anilist:98459')
 *     sourceIds: { anilist, mal, kitsu },
 *     title, romaji, english, native, synonyms,   // official titles
 *     format,                   // TV | OVA | ONA | MOVIE | TV_SPECIAL ...
 *     relations: [              // OFFICIAL relation edges to other entries
 *       { source: 'anilist', sourceId, title, relationType, format }
 *     ],
 *     franchiseKey,             // verified franchise root (online graph)
 *     role,                     // 'season' | 'branch:<kind>' | 'main'
 *   }
 *
 * Rules (in order):
 *   1. Same database id            → 'same-entry' (duplicates/different titles)
 *   2. Direct official edge        → typed from the edge, 'verified'
 *   3. Conflicting edges/sources   → 'unknown', 'conflicting', uncertain
 *   4. Shared anchor / same verified franchise graph → derived kind, 'indirect'
 *   5. No evidence                 → 'unknown'/'unrelated', uncertain
 *      (title similarity is recorded as a hint but never decides)
 */
export function verifyRelationship(entryA, entryB, { now = Date.now() } = {}) {
  const a = entryA ?? {}
  const b = entryB ?? {}
  const reasons = []
  const sourceIds = { a: a.sourceIds ?? null, b: b.sourceIds ?? null }

  // Rule 1: duplicate entries — same database record behind different titles.
  const sharedIds = sharedSourceIds(a, b)
  if (sharedIds.length) {
    return record({
      type: 'same-entry',
      confidence: 'high',
      source: sharedIds[0].source,
      sourceIds,
      verification: 'verified',
      uncertain: false,
      reasons: [`same ${sharedIds[0].source} id ${sharedIds[0].id}`],
      now,
    })
  }

  const edgesAToB = edgesMatching(a.relations, b).map((edge) => ({ edge, kind: relativeKind(edge) }))
  const edgesBToA = edgesMatching(b.relations, a).map((edge) => ({ edge, kind: relativeKind(edge, { fromB: true }) }))

  // Rule 2/3: direct official edges decide the type. Generic edges
  // ('parent-story', 'other', 'unknown') confirm hierarchy without
  // contradicting a specific type given by the other side.
  if (edgesAToB.length || edgesBToA.length) {
    const all = [...edgesAToB, ...edgesBToA].map((item) => item.kind)
    const specific = [...new Set(all)].filter((k) => !['parent-story', 'other', 'unknown'].includes(k))
    let kind
    if (specific.length > 1) {
      return record({
        type: 'unknown',
        confidence: 'low',
        source: 'multi',
        sourceIds,
        verification: 'conflicting',
        uncertain: true,
        reasons: [`sources disagree (${specific.sort().join(', ')})`],
        now,
      })
    }
    if (specific.length === 1) kind = specific[0]
    else kind = new Set(all).has('parent-story') ? 'parent-story' : 'other'
    kind = refineContinuation(kind, a, b)
    const bothWays = edgesAToB.length && edgesBToA.length
    const sources = new Set([...edgesAToB, ...edgesBToA].map((item) => item.edge.source).filter(Boolean))
    reasons.push(`${bothWays ? 'mirrored' : 'direct'} official relation edge`)
    return record({
      type: kind,
      confidence: 'high',
      source: [...sources].join('+') || 'anilist',
      sourceIds,
      verification: 'verified',
      uncertain: false,
      reasons,
      now,
    })
  }

  // Rule 4a: indirect connection through one shared franchise anchor.
  const anchor = sharedAnchor(a, b)
  if (anchor) {
    reasons.push(`shared franchise anchor via ${anchor.via}`)
    return record({
      type: anchor.kind,
      confidence: 'medium',
      source: anchor.source,
      sourceIds,
      verification: 'indirect',
      uncertain: false,
      reasons,
      roles: anchor.roles ?? undefined,
      now,
    })
  }

  // Rule 4b: both entries are verified members of one franchise graph.
  if (a.franchiseKey && a.franchiseKey === b.franchiseKey) {
    const kind = pairKindFromRoles(a, b, reasons)
    reasons.push('same verified franchise (relation graph)')
    return record({
      type: kind.type,
      confidence: 'medium',
      source: 'anilist',
      sourceIds,
      verification: 'indirect',
      uncertain: false,
      reasons,
      roles: kind.roles,
      now,
    })
  }

  // Rule 5: no evidence. Titles alone never connect entries.
  const aliasesA = titleAliasKeys(a)
  const aliasesB = titleAliasKeys(b)
  const titleOverlap = [...aliasesA].some((key) => aliasesB.has(key))
  const lookupsRan = Boolean(a.relations && b.relations)
  if (titleOverlap) reasons.push('title aliases overlap (hint only — not evidence)')
  if (lookupsRan) reasons.push('looked up online; no relation in the sources')
  return record({
    type: lookupsRan ? 'unrelated' : 'unknown',
    confidence: lookupsRan && !titleOverlap ? 'medium' : 'none',
    source: lookupsRan ? 'anilist' : null,
    sourceIds,
    verification: lookupsRan ? 'verified' : 'unverified',
    uncertain: !lookupsRan,
    reasons,
    now,
  })
}

/** Same franchise? Duplicates count as the same work. */
export function sameFranchise(relationship) {
  return !['unrelated', 'unknown'].includes(relationship?.type)
}

function sharedSourceIds(a, b) {
  const shared = []
  for (const source of ['anilist', 'mal', 'kitsu']) {
    const idA = a.sourceIds?.[source]
    const idB = b.sourceIds?.[source]
    if (idA !== undefined && idA !== null && String(idA) === String(idB)) {
      shared.push({ source, id: idA })
    }
  }
  return shared
}

function edgesMatching(relations, target) {
  const ids = new Set(
    Object.entries(target.sourceIds ?? {})
      .filter(([, id]) => id !== undefined && id !== null)
      .map(([source, id]) => `${source}:${id}`),
  )
  const keys = titleAliasKeys(target)
  return (Array.isArray(relations) ? relations : []).filter((edge) => {
    if (!edge) return false
    if (edge.source && edge.sourceId !== undefined && edge.sourceId !== null && ids.has(`${edge.source}:${edge.sourceId}`)) return true
    return Boolean(edge.title && keys.has(normalizeTitleKey(edge.title)))
  })
}

const SECONDARY_KINDS = new Set(['spin-off', 'special', 'ova', 'ona', 'movie', 'side-story', 'other', 'compilation', 'summary', 'character'])
const CONTINUATION_KINDS = new Set(['sequel', 'prequel', 'split-cour', 'next-season'])

function sharedAnchor(a, b) {
  const relationsA = Array.isArray(a.relations) ? a.relations : []
  const relationsB = Array.isArray(b.relations) ? b.relations : []
  if (!relationsA.length || !relationsB.length) return null
  for (const edgeA of relationsA) {
    for (const edgeB of relationsB) {
      const sameTarget =
        (edgeA.sourceId !== undefined &&
          edgeA.sourceId !== null &&
          edgeA.sourceId === edgeB.sourceId &&
          edgeA.source === edgeB.source) ||
        (edgeA.title && edgeB.title && normalizeTitleKey(edgeA.title) === normalizeTitleKey(edgeB.title))
      if (!sameTarget) continue
      const kindA = classifyEdge(edgeA) // anchor relative to A
      const kindB = classifyEdge(edgeB) // anchor relative to B
      const aBeforeAnchor = CONTINUATION_KINDS.has(kindA) && kindA !== 'prequel'
      const aAfterAnchor = kindA === 'prequel'
      const bBeforeAnchor = CONTINUATION_KINDS.has(kindB) && kindB !== 'prequel'
      const bAfterAnchor = kindB === 'prequel'
      let kind
      const roles = { a: roleFromKind(kindA), b: roleFromKind(kindB) }
      if (aBeforeAnchor && bAfterAnchor) kind = 'next-season' // A → anchor → B
      else if (aAfterAnchor && bBeforeAnchor) kind = 'prequel' // B → anchor → A
      else if (SECONDARY_KINDS.has(kindA) || SECONDARY_KINDS.has(kindB)) {
        kind = SECONDARY_KINDS.has(kindA) ? kindA : kindB
      } else {
        kind = 'other' // siblings on the same side of the anchor
      }
      return {
        kind,
        via: edgeA.title ?? `${edgeA.source}:${edgeA.sourceId}`,
        source: edgeA.source ?? 'anilist',
        roles,
      }
    }
  }
  return null
}

function roleFromKind(kind) {
  if (CONTINUATION_KINDS.has(kind)) return 'season'
  if (SECONDARY_KINDS.has(kind)) return `branch:${kind}`
  return kind === 'parent-story' ? 'main' : 'unknown'
}

function pairKindFromRoles(a, b, reasons) {
  const titlesA = [a.title, a.romaji, a.english].filter(Boolean)
  const titlesB = [b.title, b.romaji, b.english].filter(Boolean)
  for (const titleA of titlesA) {
    for (const titleB of titlesB) {
      if (isSplitCourPair(titleA, titleB)) {
        return { type: 'split-cour', roles: { a: a.role ?? 'season', b: b.role ?? 'season' } }
      }
    }
  }
  const roleA = String(a.role ?? 'unknown')
  const roleB = String(b.role ?? 'unknown')
  const roles = { a: roleA, b: roleB }
  const classA = roleA === 'main' ? 'season' : roleA
  const classB = roleB === 'main' ? 'season' : roleB
  if (classA === 'season' && classB === 'season') return { type: 'next-season', roles }
  if (classA === 'season' && classB.startsWith('branch:')) return { type: classB.slice(7), roles }
  if (classB === 'season' && classA.startsWith('branch:')) return { type: classA.slice(7), roles }
  if (classA.startsWith('branch:') && classB.startsWith('branch:')) {
    const kindA = classA.slice(7)
    const kindB = classB.slice(7)
    reasons.push(`branch pair (${kindA} / ${kindB})`)
    return { type: kindA === kindB ? kindA : 'other', roles }
  }
  reasons.push(`roles unresolved (${roleA} / ${roleB})`)
  return { type: 'other', roles }
}

function refineContinuation(kind, a, b) {
  if (kind !== 'sequel' && kind !== 'prequel') return kind
  const titlesA = [a.title, a.romaji, a.english].filter(Boolean)
  const titlesB = [b.title, b.romaji, b.english].filter(Boolean)
  for (const titleA of titlesA) {
    for (const titleB of titlesB) {
      if (isSplitCourPair(titleA, titleB)) return 'split-cour'
    }
  }
  return kind === 'sequel' ? 'next-season' : 'prequel'
}

function record({ type, confidence, source, sourceIds, verification, uncertain, reasons, roles, now }) {
  return {
    type,
    confidence,
    source,
    sourceIds,
    verification,
    uncertain,
    reasons,
    ...(roles ? { roles } : {}),
    checkedAt: now,
  }
}
