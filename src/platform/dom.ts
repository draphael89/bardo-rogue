// Browser primitives both hosts share. The desktop host is a Chromium renderer too, so a file
// download and a file picker work there exactly as they do on the web; Phase 5 can swap these for
// native dialogs behind the same Platform methods without any caller changing.
let picker: HTMLInputElement | null = null

export const prefersReducedMotion = (): boolean =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

export async function downloadText(text: string, filename: string): Promise<void> {
  // The same idiom the replay downloader already uses (src/input/recorder.ts).
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function pickTextFile(): Promise<string | null> {
  return new Promise(resolve => {
    if (!picker) {
      picker = document.createElement('input')
      picker.type = 'file'
      picker.accept = '.json,application/json'
      picker.style.display = 'none'
      document.body.appendChild(picker)
    }
    const el = picker
    const done = (v: string | null | Promise<string>) => {
      el.onchange = null; el.oncancel = null
      Promise.resolve(v).then(resolve, () => resolve(null))
    }
    el.onchange = () => { const f = el.files?.[0]; done(f ? f.text() : null) }
    el.oncancel = () => done(null)
    el.value = ''      // so picking the SAME file twice in a row still fires change
    el.click()         // must run inside the keydown gesture the browser is still processing
  })
}
