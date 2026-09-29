export const SITE_URL = (
  (import.meta.env.VITE_SITE_URL as string | undefined) ??
  'https://twister.meetpawan.com'
).replace(/\/$/, '')
export const SITE_NAME = 'Twister'
export const DEFAULT_TITLE =
  'Twister — Tongue twister practice with live feedback'
export const DEFAULT_DESCRIPTION =
  'Practise classic and modern tongue twisters out loud. Watch every word light up live, beat your score, build streaks and level up — free in your browser.'

type SeoInput = {
  title?: string
  description?: string
  path?: string
  image?: string
  noindex?: boolean
}

/** Builds title/meta/canonical for a route. Absolute URLs are required by WhatsApp, Facebook, X and LinkedIn scrapers. */
export function seo({
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  path = '/',
  image = '/og-image.jpg',
  noindex,
}: SeoInput = {}) {
  const url = `${SITE_URL}${path}`
  const img = image.startsWith('http') ? image : `${SITE_URL}${image}`
  return {
    meta: [
      { title },
      { name: 'description', content: description },
      {
        name: 'robots',
        content: noindex
          ? 'noindex, nofollow'
          : 'index, follow, max-image-preview:large',
      },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: SITE_NAME },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:url', content: url },
      { property: 'og:image', content: img },
      { property: 'og:image:type', content: 'image/jpeg' },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      {
        property: 'og:image:alt',
        content: 'Twister — tongue twister practice app',
      },
      { property: 'og:locale', content: 'en_US' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: title },
      { name: 'twitter:description', content: description },
      { name: 'twitter:image', content: img },
    ],
    links: [{ rel: 'canonical', href: url }],
  }
}
