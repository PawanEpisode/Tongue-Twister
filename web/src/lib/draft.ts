const key = (slug: string) => `twister.draft.${slug}`

/** Text a guest typed but didn't submit yet; sessionStorage keeps it across the OAuth redirect. */
export const draft = {
  read(slug: string): string {
    try {
      return window.sessionStorage.getItem(key(slug)) ?? ''
    } catch {
      return ''
    }
  },
  write(slug: string, text: string) {
    try {
      if (text) window.sessionStorage.setItem(key(slug), text)
      else window.sessionStorage.removeItem(key(slug))
    } catch {
      /* storage blocked: the draft just won't survive a reload */
    }
  },
  clear: (slug: string) => draft.write(slug, ''),
}
