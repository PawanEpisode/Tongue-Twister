import { createFileRoute } from '@tanstack/react-router'
import { api } from '#/lib/api'
import { SITE_URL } from '#/lib/seo'

export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: async () => {
        let slugs: string[] = []
        try {
          // Signed-out callers get the curated teaser (page 1 only; page 2 is a 401), so this lists those.
          for (let page = 1; page <= 20; page++) {
            const res = await api.twisters({ page: String(page) })
            slugs = slugs.concat(res.results.map((t) => t.slug))
            if (slugs.length >= res.count) break
          }
        } catch {
          /* fall back to static URLs only */
        }
        const urls = [
          '/',
          '/twisters',
          '/about',
          '/privacy',
          '/terms',
          ...slugs.map((s) => `/twisters/${s}`),
        ]
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
          .map((u) => `  <url><loc>${SITE_URL}${u}</loc></url>`)
          .join('\n')}\n</urlset>\n`
        return new Response(xml, {
          headers: {
            'Content-Type': 'application/xml',
            'Cache-Control': 'public, max-age=3600',
          },
        })
      },
    },
  },
})
