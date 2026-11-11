import { chromium } from 'playwright'

// Simulate the Player MSE path: MediaSource + streaming fetch + appendBuffer
const results = []
function log(...a) { results.push(`${new Date().toISOString().slice(11, 23)} ${a.join(' ')}`) }

const browser = await chromium.launch({
  executablePath: '/home/arch/.cache/ms-playwright/chromium-1252/chrome-linux64/chrome',
  headless: false,
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage()
page.on('console', (m) => log('PAGE:', m.text()))
page.on('pageerror', (e) => log('PAGEERROR:', e.message))

// A near-empty page; drive the same code the Player effect runs
await page.goto('http://127.0.0.1:5173/api/health')
const probe = await page.evaluate(async (base) => {
  const out = []
  const canUseMse = typeof MediaSource === 'function' && MediaSource.isTypeSupported('video/mp4')
  out.push(`canUseMse=${canUseMse}`)
  const video = document.createElement('video')
  const mediaSource = new MediaSource()
  const objectUrl = URL.createObjectURL(mediaSource)
  const controller = new AbortController()
  const queue = []
  let sourceBuffer = null
  let streamEnded = false
  const flush = () => {
    if (!sourceBuffer || sourceBuffer.updating) return
    if (queue.length > 0) {
      sourceBuffer.appendBuffer(queue.shift())
      return
    }
    if (streamEnded && mediaSource.readyState === 'open') {
      mediaSource.end()
      void video.play().catch(() => {})
    }
  }
  mediaSource.addEventListener('sourceopen', () => {
    out.push('sourceopen')
    try {
      sourceBuffer = mediaSource.addSourceBuffer('video/mp4')
      sourceBuffer.addEventListener('updateend', flush)
      sourceBuffer.addEventListener('error', () => out.push('SB ERROR'))
      ;(async () => {
        try {
          const response = await fetch(base, { signal: controller.signal })
          out.push(`fetch ok=${response.ok} type=${response.headers.get('content-type')}`)
          const reader = response.body.getReader()
          for (;;) {
            const { done, value } = await reader.read()
            if (done) { out.push('stream done'); break }
            queue.push(value)
            flush()
          }
          streamEnded = true
          flush()
        } catch (e) {
          out.push(`fetch threw: ${e}`)
        }
      })()
    } catch (e) {
      out.push(`addSourceBuffer threw: ${e}`)
    }
  })
  mediaSource.addEventListener('webkitsourceopen', () => out.push('webkitsourceopen'))
  mediaSource.addEventListener('sourceclose', () => out.push('sourceclose'))
  video.addEventListener('loadedmetadata', () => out.push('loadedmetadata'))
  video.addEventListener('canplay', () => out.push('canplay'))
  video.addEventListener('play', () => out.push('play'))
  video.addEventListener('error', () => out.push(`video error ${video.error?.code}`))
  video.src = objectUrl
  // sample state
  const samples = []
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    samples.push(
      `i=${i} ready=${video.readyState} net=${video.networkState} t=${video.currentTime.toFixed(2)} paused=${video.paused} buf=${video.buffered.length ? video.buffered.end(video.buffered.length - 1).toFixed(2) : 0}`,
    )
  }
  return out.join('\n') + '\nSAMPLES\n' + samples.join('\n')
}, 'http://127.0.0.1:5173/api/live/stream?query=Cyberpunk%3A%20Edgerunners%202&resultIndex=1&episode=1&quality=720')

console.log(probe)
await browser.close()
