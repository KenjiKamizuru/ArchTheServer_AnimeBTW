// Minimal ISO BMFF (fragmented MP4) helpers for Media Source Extensions.
//
// Reads the exact video and audio codec strings from the initial `moov` box so
// `addSourceBuffer` matches every stream (H.264 profile/level, HEVC, AV1, VP9,
// AAC-LC/HE-AAC, MP3, Opus, or video-only) instead of guessing a single codec
// pair, and tracks top-level box boundaries so buffer eviction never interrupts
// an in-flight media segment.

const MAX_INIT_BYTES = 4 * 1024 * 1024

function readUint32(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] << 24) |
      (data[offset + 1] << 16) |
      (data[offset + 2] << 8) |
      data[offset + 3]) >>>
    0
  )
}

function readUint16(data: Uint8Array, offset: number): number {
  return (data[offset] << 8) | data[offset + 1]
}

function readFourCC(data: Uint8Array, offset: number): string {
  return String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3])
}

function hex2(byte: number): string {
  return byte.toString(16).toUpperCase().padStart(2, '0')
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function reverseBits32(value: number): number {
  let out = 0
  for (let i = 0; i < 32; i++) {
    out = ((out << 1) | ((value >>> i) & 1)) >>> 0
  }
  return out
}

interface BoxSpan {
  type: string
  body: number
  end: number
}

function iterBoxes(data: Uint8Array, start: number, limit: number): BoxSpan[] {
  const boxes: BoxSpan[] = []
  let pos = start
  while (pos + 8 <= limit) {
    const size32 = readUint32(data, pos)
    const type = readFourCC(data, pos + 4)
    let headerSize = 8
    let boxSize = size32
    if (size32 === 1) {
      if (pos + 16 > limit) break
      const hi = readUint32(data, pos + 8)
      const lo = readUint32(data, pos + 12)
      headerSize = 16
      boxSize = hi * 0x1_0000_0000 + lo
    } else if (size32 === 0) {
      boxSize = limit - pos
    }
    if (boxSize < headerSize || pos + boxSize > limit) break
    boxes.push({ type, body: pos + headerSize, end: pos + boxSize })
    pos += boxSize
  }
  return boxes
}

function findChild(data: Uint8Array, start: number, limit: number, type: string): BoxSpan | null {
  return iterBoxes(data, start, limit).find((box) => box.type === type) ?? null
}

function readDescriptor(
  data: Uint8Array,
  offset: number,
  limit: number,
): { tag: number; body: number; end: number } | null {
  if (offset + 2 > limit) return null
  const tag = data[offset]
  let size = 0
  let pos = offset + 1
  for (let i = 0; i < 4; i++) {
    if (pos >= limit) return null
    const byte = data[pos++]
    size = (size << 7) | (byte & 0x7f)
    if ((byte & 0x80) === 0) {
      const end = pos + size
      if (end > limit) return null
      return { tag, body: pos, end }
    }
  }
  return null
}

function parseEsdsCodec(data: Uint8Array, body: number, end: number): string | null {
  // FullBox: 4-byte version + flags.
  let pos = body + 4
  while (pos < end) {
    const es = readDescriptor(data, pos, end)
    if (!es) break
    pos = es.end
    if (es.tag !== 0x03 || es.body + 3 > es.end) continue

    let inner = es.body + 2
    const flags = data[inner++]
    if (flags & 0x80) inner += 2 // dependsOn_ES_ID
    if (flags & 0x40) {
      if (inner >= es.end) continue
      inner += 1 + data[inner] // URL_String
    }
    if (flags & 0x20) inner += 2 // OCR_ES_Id

    while (inner < es.end) {
      const desc = readDescriptor(data, inner, es.end)
      if (!desc) break
      inner = desc.end
      if (desc.tag !== 0x04 || desc.body + 13 > desc.end) continue

      const oti = data[desc.body]
      if (oti === 0x40) {
        let sub = desc.body + 13
        while (sub < desc.end) {
          const info = readDescriptor(data, sub, desc.end)
          if (!info) break
          sub = info.end
          if (info.tag === 0x05 && info.body < info.end) {
            let aot = data[info.body] >> 3
            if (aot === 31 && info.body + 1 < info.end) {
              aot = 32 + (((data[info.body] & 0x07) << 3) | (data[info.body + 1] >> 5))
            }
            if (aot > 0) return `mp4a.40.${aot}`
          }
        }
        return 'mp4a.40.2'
      }
      return `mp4a.${hex2(oti)}`
    }
  }
  return null
}

function parseHevcCodec(entryType: string, data: Uint8Array, body: number, end: number): string {
  if (body + 13 > end) return `${entryType}.1.6.L93.B0`
  const b1 = data[body + 1]
  const profileSpace = ['', 'A', 'B', 'C'][(b1 >> 6) & 0x03]
  const tier = b1 & 0x20 ? 'H' : 'L'
  const profileIdc = b1 & 0x1f
  const compat = reverseBits32(readUint32(data, body + 2)).toString(16).toUpperCase()
  const constraintBytes = Array.from(data.subarray(body + 6, body + 12))
  while (constraintBytes.length > 0 && constraintBytes[constraintBytes.length - 1] === 0) {
    constraintBytes.pop()
  }
  const levelIdc = data[body + 12]
  const suffix = constraintBytes.map((b) => `.${hex2(b)}`).join('')
  return `${entryType}.${profileSpace}${profileIdc}.${compat}.${tier}${levelIdc}${suffix}`
}

function parseVideoEntry(entry: BoxSpan, data: Uint8Array): string | null {
  // VisualSampleEntry has a 78-byte fixed header before child boxes.
  const childrenStart = entry.body + 78
  if (entry.type === 'avc1' || entry.type === 'avc3') {
    if (childrenStart < entry.end) {
      const avcC = findChild(data, childrenStart, entry.end, 'avcC')
      if (avcC && avcC.body + 4 <= avcC.end) {
        const p = data[avcC.body + 1]
        const c = data[avcC.body + 2]
        const l = data[avcC.body + 3]
        return `${entry.type}.${hex2(p)}${hex2(c)}${hex2(l)}`
      }
    }
    return 'avc1.42E01E'
  }
  if (entry.type === 'hvc1' || entry.type === 'hev1') {
    if (childrenStart < entry.end) {
      const hvcC = findChild(data, childrenStart, entry.end, 'hvcC')
      if (hvcC) return parseHevcCodec(entry.type, data, hvcC.body, hvcC.end)
    }
    return `${entry.type}.1.6.L93.B0`
  }
  if (entry.type === 'av01') {
    if (childrenStart < entry.end) {
      const av1C = findChild(data, childrenStart, entry.end, 'av1C')
      if (av1C && av1C.body + 4 <= av1C.end) {
        const profile = (data[av1C.body + 1] >> 5) & 0x07
        const level = data[av1C.body + 1] & 0x1f
        const tier = data[av1C.body + 2] & 0x80 ? 'H' : 'M'
        const highBitdepth = Boolean(data[av1C.body + 2] & 0x40)
        const twelveBit = Boolean(data[av1C.body + 2] & 0x20)
        const depth = highBitdepth ? (twelveBit ? 12 : 10) : 8
        return `av01.${profile}.${pad2(level)}${tier}.${pad2(depth)}`
      }
    }
    return 'av01.0.08M.08'
  }
  if (entry.type === 'vp09') {
    if (childrenStart < entry.end) {
      const vpcC = findChild(data, childrenStart, entry.end, 'vpcC')
      if (vpcC && vpcC.body + 8 <= vpcC.end) {
        const profile = data[vpcC.body + 4]
        const level = data[vpcC.body + 5]
        const depth = (data[vpcC.body + 6] >> 4) & 0x0f
        return `vp09.${pad2(profile)}.${pad2(level)}.${pad2(depth)}`
      }
    }
    return 'vp09.00.10.08'
  }
  return null
}

function parseAudioEntry(entry: BoxSpan, data: Uint8Array): string | null {
  if (entry.type === 'Opus') return 'opus'
  if (entry.type === 'fLaC') return 'flac'
  if (entry.type === 'ac-3' || entry.type === 'ec-3') return entry.type
  if (entry.type !== 'mp4a') return null

  if (entry.body + 28 > entry.end) return 'mp4a.40.2'
  const soundVersion = readUint16(data, entry.body + 8)
  const extra = soundVersion === 1 ? 16 : soundVersion === 2 ? 36 : 0
  const childrenStart = entry.body + 28 + extra
  if (childrenStart >= entry.end) return 'mp4a.40.2'

  const esds = findChild(data, childrenStart, entry.end, 'esds')
  if (esds) return parseEsdsCodec(data, esds.body, esds.end) ?? 'mp4a.40.2'

  const wave = findChild(data, childrenStart, entry.end, 'wave')
  if (wave) {
    const waveEsds = findChild(data, wave.body, wave.end, 'esds')
    if (waveEsds) return parseEsdsCodec(data, waveEsds.body, waveEsds.end) ?? 'mp4a.40.2'
  }
  return 'mp4a.40.2'
}

export interface Mp4InitInfo {
  ready: boolean
  invalid?: boolean
  videoCodecs: string[]
  audioCodecs: string[]
}

/** Inspects top-level boxes and extracts track codec strings once `moov` is complete. */
export function inspectMp4Init(data: Uint8Array): Mp4InitInfo {
  let pos = 0
  let moov: BoxSpan | null = null

  while (pos + 8 <= data.length) {
    const size32 = readUint32(data, pos)
    const type = readFourCC(data, pos + 4)
    let headerSize = 8
    let boxSize = size32
    if (size32 === 1) {
      if (pos + 16 > data.length) break
      headerSize = 16
      boxSize = readUint32(data, pos + 8) * 0x1_0000_0000 + readUint32(data, pos + 12)
    } else if (size32 === 0) {
      return { ready: false, invalid: true, videoCodecs: [], audioCodecs: [] }
    }
    if (boxSize < headerSize) {
      return { ready: false, invalid: true, videoCodecs: [], audioCodecs: [] }
    }
    if (pos + boxSize > data.length) {
      return {
        ready: false,
        invalid: boxSize > MAX_INIT_BYTES,
        videoCodecs: [],
        audioCodecs: [],
      }
    }
    if (type === 'moov') {
      moov = { type, body: pos + headerSize, end: pos + boxSize }
      break
    }
    pos += boxSize
  }

  if (!moov) {
    return {
      ready: false,
      invalid: data.length > MAX_INIT_BYTES,
      videoCodecs: [],
      audioCodecs: [],
    }
  }

  const videoCodecs: string[] = []
  const audioCodecs: string[] = []

  for (const trak of iterBoxes(data, moov.body, moov.end)) {
    if (trak.type !== 'trak') continue
    const mdia = findChild(data, trak.body, trak.end, 'mdia')
    if (!mdia) continue
    const hdlr = findChild(data, mdia.body, mdia.end, 'hdlr')
    const handler = hdlr && hdlr.body + 12 <= hdlr.end ? readFourCC(data, hdlr.body + 8) : ''
    const minf = findChild(data, mdia.body, mdia.end, 'minf')
    const stbl = minf ? findChild(data, minf.body, minf.end, 'stbl') : null
    const stsd = stbl ? findChild(data, stbl.body, stbl.end, 'stsd') : null
    if (!stsd || stsd.body + 8 > stsd.end) continue

    for (const entry of iterBoxes(data, stsd.body + 8, stsd.end)) {
      if (handler === 'vide') {
        const codec = parseVideoEntry(entry, data)
        if (codec) videoCodecs.push(codec)
      } else if (handler === 'soun') {
        const codec = parseAudioEntry(entry, data)
        if (codec) audioCodecs.push(codec)
      }
    }
  }

  return { ready: true, videoCodecs, audioCodecs }
}

/** Chooses a supported MSE MIME string matching the tracks declared in `moov`. */
export function selectMseMimeType(
  data: Uint8Array,
  isTypeSupported: (mime: string) => boolean,
): 'need-more' | string | null {
  const info = inspectMp4Init(data)
  if (info.invalid) return null
  if (!info.ready) return 'need-more'

  const video = info.videoCodecs[0]
  const audio = info.audioCodecs[0]
  const candidates: string[] = []

  if (video && audio) {
    candidates.push(`video/mp4; codecs="${video},${audio}"`)
    if (/^avc[13]\./.test(video) && /^mp4a\.40\./.test(audio)) {
      candidates.push(`video/mp4; codecs="${video},mp4a.40.2"`)
      candidates.push('video/mp4; codecs="avc1.640028,mp4a.40.2"')
      candidates.push('video/mp4; codecs="avc1.42E01E,mp4a.40.2"')
    }
  } else if (video) {
    candidates.push(`video/mp4; codecs="${video}"`)
    if (/^avc[13]\./.test(video)) {
      candidates.push('video/mp4; codecs="avc1.640028"')
      candidates.push('video/mp4; codecs="avc1.42E01E"')
    }
  } else if (audio) {
    candidates.push(`audio/mp4; codecs="${audio}"`)
    candidates.push(`video/mp4; codecs="${audio}"`)
  }

  return candidates.find((candidate) => isTypeSupported(candidate)) ?? null
}

export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0]
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

/** Tracks whether an arbitrary stream of appended chunks ends on a top-level MP4 box boundary. */
export class Mp4BoxTracker {
  private remaining = 0
  private header = new Uint8Array(16)
  private headerLen = 0
  private lastType = ''

  /** True when the last appended byte finished a non-`moof` top-level box (safe for `remove()`). */
  get atSegmentBoundary(): boolean {
    return this.remaining === 0 && this.headerLen === 0 && this.lastType !== 'moof'
  }

  push(chunk: Uint8Array): void {
    let pos = 0
    while (pos < chunk.length) {
      if (this.remaining > 0) {
        const take = Math.min(this.remaining, chunk.length - pos)
        this.remaining -= take
        pos += take
        continue
      }

      const needed = this.headerLen >= 8 && readUint32(this.header, 0) === 1 ? 16 : 8
      const copy = Math.min(needed - this.headerLen, chunk.length - pos)
      this.header.set(chunk.subarray(pos, pos + copy), this.headerLen)
      this.headerLen += copy
      pos += copy

      if (this.headerLen < 8) return
      const size32 = readUint32(this.header, 0)
      const type = readFourCC(this.header, 4)
      if (size32 === 1) {
        if (this.headerLen < 16) continue
        const boxSize = readUint32(this.header, 8) * 0x1_0000_0000 + readUint32(this.header, 12)
        this.lastType = type
        this.remaining = Math.max(0, boxSize - 16)
        this.headerLen = 0
      } else if (size32 === 0 || size32 < 8) {
        this.remaining = Number.POSITIVE_INFINITY
        this.headerLen = 0
      } else {
        this.lastType = type
        this.remaining = size32 - 8
        this.headerLen = 0
      }
    }
  }
}
