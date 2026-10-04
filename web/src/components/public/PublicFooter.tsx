import { ArrowUp, Heart } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { BrandLink } from '#/components/brand/BrandMark'
import { FooterWordmark } from '#/components/public/motion/FooterWordmark'
import { LinkedInIcon } from '#/components/public/LinkedInIcon'
import ThemeMenu from '#/components/ThemeMenu'
import { FOOTER, LINKEDIN_URL } from '#/content/landing'
import { api } from '#/lib/api'

const linkCls =
  'block py-1 text-sm text-muted-foreground transition-colors hover:text-foreground pointer-coarse:py-3'

/**
 * Footer for public pages: brand, three link columns (Product, Practise by sound, Connect), a maker bar
 * and the oversized wordmark. By decision there are no Privacy, Terms or Contact links here.
 */
export default function PublicFooter() {
  const cats = useQuery({
    queryKey: ['categories'],
    queryFn: api.categories,
    staleTime: 5 * 60_000,
  })
  return (
    <footer className="relative mt-24 border-t border-border/60">
      <div className="mx-auto max-w-6xl px-4 pt-14 sm:px-5">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="space-y-4">
            <BrandLink />
            <p className="max-w-xs text-sm text-muted-foreground">
              {FOOTER.blurb}
            </p>
            <ul className="flex flex-wrap gap-2">
              {FOOTER.chips.map((c) => (
                <li
                  key={c}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"
                >
                  {c}
                </li>
              ))}
            </ul>
          </div>
          <nav aria-label="Product">
            <h2 className="mb-2 font-display text-sm font-bold">Product</h2>
            <ul>
              {FOOTER.product.map((l) => (
                <li key={l.label}>
                  <a href={l.href} className={linkCls}>
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Practise by sound">
            <h2 className="mb-2 font-display text-sm font-bold">
              Practise by sound
            </h2>
            <ul>
              {(cats.data ?? []).map((c) => (
                <li key={c.slug}>
                  <Link
                    to="/twisters"
                    search={{ category: c.slug }}
                    className={linkCls}
                  >
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Connect">
            <h2 className="mb-2 font-display text-sm font-bold">Connect</h2>
            <ul>
              <li>
                <a
                  href={LINKEDIN_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${linkCls} inline-flex items-center gap-2`}
                >
                  <LinkedInIcon className="size-4" />
                  LinkedIn
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 py-5 text-sm text-muted-foreground">
          <span>© 2026 Twister</span>
          <span className="inline-flex items-center gap-1.5">
            Made with
            <Heart className="size-3.5 fill-pink text-pink" aria-hidden />
            <span className="sr-only">love</span> by{' '}
            <a
              href={LINKEDIN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-foreground underline-offset-4 hover:underline"
            >
              Pawan
            </a>
          </span>
          <span className="flex items-center gap-2">
            <ThemeMenu />
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0 })}
              aria-label="Back to top"
              className="grid size-10 place-items-center rounded-full border border-border hover:border-primary"
            >
              <ArrowUp className="size-4" aria-hidden />
            </button>
          </span>
        </div>
      </div>
      <FooterWordmark />
    </footer>
  )
}
