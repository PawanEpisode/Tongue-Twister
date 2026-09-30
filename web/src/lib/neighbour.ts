/** Neighbour of `slug` in `list`, wrapping around; undefined if `slug` isn't in it. */
export function neighbour(
  list: string[],
  slug: string,
  delta: 1 | -1,
): string | undefined {
  const at = list.indexOf(slug)
  return at < 0 || list.length < 2
    ? undefined
    : list[(at + delta + list.length) % list.length]
}
