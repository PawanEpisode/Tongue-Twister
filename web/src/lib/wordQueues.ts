import { useInfiniteQuery } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { api } from '#/lib/api'
import type { NailedWord, Page, WeakWord } from '#/lib/api'

/** Words shown per page of a queue; "Show more" fetches the next page. */
export const WORD_PAGE = 10

const WEAK = 'weak-words'
const NAILED = 'nailed-words'

/** A drill moves words between the two queues, so anything that records one refreshes both. */
export function invalidateWordQueues(qc: QueryClient): Promise<unknown> {
  return Promise.all(
    [WEAK, NAILED].map((k) => qc.invalidateQueries({ queryKey: [k] })),
  )
}

/** One queue as the UI sees it: every loaded item, the size of the whole queue, and paging controls. */
function usePagedWords<T>(
  key: readonly unknown[],
  fetchPage: (offset: number) => Promise<Page<T>>,
  enabled: boolean,
) {
  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, page) => n + page.results.length, 0)
      return loaded < last.count ? loaded : undefined
    },
    enabled,
  })
  const items = query.data?.pages.flatMap((p) => p.results) ?? []
  const count = query.data?.pages[0]?.count ?? 0
  return { query, items, count, remaining: Math.max(0, count - items.length) }
}
export type WordQueue<T> = ReturnType<typeof usePagedWords<T>>

export const useWeakWords = (userId: string | undefined, dueOnly: boolean) =>
  usePagedWords<WeakWord>(
    [WEAK, userId, dueOnly],
    (offset) => api.weakWords({ due: dueOnly, limit: WORD_PAGE, offset }),
    !!userId,
  )

export const useNailedWords = (userId: string | undefined) =>
  usePagedWords<NailedWord>(
    [NAILED, userId],
    (offset) => api.nailedWords({ limit: WORD_PAGE, offset }),
    !!userId,
  )
