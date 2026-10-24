/**
 * One short pulse under the finger, where the device can give one.
 *
 *   Android, desktop Chrome   the Vibration API
 *   iPhone (iOS 17.4+)        no Vibration API, but flipping a <input
 *                             type="checkbox" switch> plays the system's
 *                             switch haptic — so a hidden one is flipped
 *   iPad                      nothing: there is no haptic engine in the body
 *                             (only in Apple Pencil Pro), so no page can
 *                             make it buzz. The call is a harmless no-op.
 *
 * Must be called inside the press's own event handler: both routes only
 * work from a user gesture.
 */

let toggle: HTMLLabelElement | null = null

function iosSwitch(): HTMLLabelElement {
  if (toggle) return toggle
  const label = document.createElement('label')
  label.setAttribute('aria-hidden', 'true')
  label.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden'
  const input = document.createElement('input')
  input.type = 'checkbox'
  // Non-standard attribute Safari reads; set rather than typed so TS and
  // other browsers are untroubled by it.
  input.setAttribute('switch', '')
  input.tabIndex = -1
  label.appendChild(input)
  document.body.appendChild(label)
  toggle = label
  return label
}

export function haptic(): void {
  if (typeof navigator === 'undefined') return
  if (typeof navigator.vibrate === 'function') {
    navigator.vibrate(8)
    return
  }
  try {
    iosSwitch().click()
  } catch {
    /* nothing to feel here */
  }
}
