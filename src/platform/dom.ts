// Browser primitives both hosts share. The desktop host is a Chromium renderer too, so a file
// download and a file picker work there exactly as they do on the web; Phase 5 can swap these for
// native dialogs behind the same Platform methods without any caller changing.
let picker: HTMLInputElement | null = null

// The same ceiling the desktop host enforces on both its importer and its save IPC. A save is a few
// hundred bytes; anything near this is a mistake or a hostile file, and reading it would allocate the
// whole payload and then parse it on the renderer thread.
export const MAX_IMPORT_BYTES = 1024 * 1024

export const prefersReducedMotion = (): boolean =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

export async function downloadText(text: string, filename: string): Promise<boolean> {
  // The same idiom the replay downloader already uses (src/input/recorder.ts).
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true      // the browser owns the download from here; there is nothing further to observe
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
    el.onchange = () => {
      const f = el.files?.[0]
      if (f && f.size > MAX_IMPORT_BYTES) { console.log(`[save] import refused: ${f.size} bytes is far larger than any save`); done(null); return }
      done(f ? f.text() : null)
    }
    el.oncancel = () => done(null)
    el.value = ''      // so picking the SAME file twice in a row still fires change
    el.click()         // must run inside the keydown gesture the browser is still processing
  })
}
