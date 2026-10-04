/** The bundled demo twisters (no network call needed to try the product). Each slug must be in the teaser
 *  set; `check_public_site --demo-slugs` enforces that in CI. */
export type DemoTwister = {
  slug: 'she-sells-seashells' | 'fat-frogs' | 'sam-sam-sheep'
  text: string
  difficulty: 1 | 2 | 3 | 4
  focus_sounds: string[]
  /** What the scripted "Watch an example" run says, with one deliberate slip. */
  example: string
}

export const DEMO_TWISTERS: DemoTwister[] = [
  {
    slug: 'she-sells-seashells',
    text: 'She sells seashells by the seashore.',
    difficulty: 2,
    focus_sounds: ['s', 'sh'],
    example: 'she sells seashells by the see shore',
  },
  {
    slug: 'fat-frogs',
    text: 'Fat frogs flying past fast.',
    difficulty: 1,
    focus_sounds: ['f', 'fr'],
    example: 'fat frogs flying past fast',
  },
  {
    slug: 'sam-sam-sheep',
    text: "Sam's shop stocks short spotted socks.",
    difficulty: 1,
    focus_sounds: ['s', 'sh'],
    example: 'sams shop stocks short spotted sock',
  },
]
