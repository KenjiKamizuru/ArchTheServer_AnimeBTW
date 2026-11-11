import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:5173'

function log(...a) { console.log(new Date().toISOString().slice(11, 23), ...a) }

const browser = await chromium.launch({
  executablePath: '/home/arch/.cache/ms-playwright/firefox-1572/firefox/firefox',
  headless: true, firefox: true, args: ["--autoplay-policy=no-user-gesture-required"],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('console', (m) => log('PAGE:', m.text()))
page.on('pageerror', (e) => log('PAGEERROR:', e.message))

await page.goto(BASE)
await page.waitForSelector('text=This Season', { timeout: 20000 })
log('page loaded')

// Click first card to open detail sheet (auto-watch fires → player overlay opens)
await page.locator('button:has-text("Watch EP")').first().click()
await page.waitForSelector('video', { timeout: 30000 })
log('player open, video element present')

const probe = () =>
  page.evaluate(() => {
    const v = document.querySelector('video')
    if (!v) return { none: true }
    return {
      src: v.src.slice(0, 80),
      readyState: v.readyState,
      networkState: v.networkState,
      currentTime: v.currentTime,
      paused: v.paused,
      videoTracks: v.videoTracks ? v.videoTracks.length : -1,
      audioTracks: v.audioTracks ? v.audioTracks.length : -1,
      buffered: Array.from({ length: v.buffered.length }, (_, i) => [v.buffered.start(i), v.buffered.end(i)]),
    }
  })

for (let i = 0; i < 12; i++) {
  const s = await probe()
  log('state', JSON.stringify(s))
  if (s.currentTime > 2) break
  await new Promise((r) => setTimeout(r, 1500))
}

await page.screenshot({ path: '/tmp/opencode/player.png' })
log('screenshot saved')
await browser.close()
