import type { ReactNode } from 'react'

/** Shared shell for the legal and about pages: a readable column, server-rendered. */
export default function ProseLayout({
  title,
  updated,
  children,
}: {
  title: string
  updated?: string
  children: ReactNode
}) {
  return (
    <article className="mx-auto max-w-2xl py-6">
      <h1 className="font-display text-4xl font-extrabold">{title}</h1>
      {updated && (
        <p className="mt-2 text-sm text-muted-foreground">
          Last updated {updated}
        </p>
      )}
      <div className="mt-8 space-y-4 leading-relaxed text-foreground/90 [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-bold [&_li]:ml-5 [&_li]:list-disc [&_a]:text-brand [&_a]:underline [&_a]:underline-offset-4">
        {children}
      </div>
    </article>
  )
}
