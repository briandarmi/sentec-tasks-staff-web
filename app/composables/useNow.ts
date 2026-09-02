import { onBeforeUnmount, ref } from 'vue'

/**
 * One shared clock for every SLA countdown on screen.
 *
 * Dozens of per-card `setInterval`s are a real phone-battery cost, so all
 * subscribers share a single one-second ticker. Two details are load-bearing:
 * every subscriber ticks the clock ON JOIN — not just the first — because a
 * badge mounting into an already-running interval would otherwise render a
 * value up to a second stale; and the interval stops entirely while the tab is
 * hidden, ticking once on return so the first visible frame is honest.
 */

const sharedNow = ref(Date.now())
let subscribers = 0
let timer: ReturnType<typeof setInterval> | undefined

function tick() {
  sharedNow.value = Date.now()
}

function startTicking() {
  if (timer !== undefined) return
  timer = setInterval(tick, 1000)
}

function stopTicking() {
  if (timer === undefined) return
  clearInterval(timer)
  timer = undefined
}

function onVisibilityChange() {
  if (document.hidden) {
    stopTicking()
  }
  else if (subscribers > 0) {
    tick()
    startTicking()
  }
}

export function useNow() {
  // Subscribe synchronously, not in onMounted, so the first paint already has
  // a fresh value.
  subscribers += 1
  tick()
  if (subscribers === 1 && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
  startTicking()

  onBeforeUnmount(() => {
    subscribers -= 1
    if (subscribers === 0) {
      stopTicking()
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }
    }
  })

  return sharedNow
}
