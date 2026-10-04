/**
 * Copy for the signed-out landing page. It lives in code so it is reviewed in pull requests and rendered
 * on the server. Rules (docs/PRD-public-site.md section 15): no invented proof, numbers come from the API,
 * and privacy claims match /privacy word for word.
 */
export const LINKEDIN_URL = 'https://www.linkedin.com/in/pawankumar1201'

export const HERO = {
  eyebrow: 'Say it fast. Say it right.',
  before: 'Tongue-tied to',
  accent: 'tongue-twisting.',
  sub: 'Twister turns every word you say into a signal, every signal into a fix, and every fix into a streak.',
  chips: [
    'Free',
    'Runs in your browser',
    'No audio stored unless you choose to save a recording',
  ],
}

export const HERO_TABS = [
  {
    key: 'read',
    label: 'Read along',
    line: 'Hear the rhythm, then match it.',
    words: [
      'Peter',
      'Piper',
      'picked',
      'a',
      'peck',
      'of',
      'pickled',
      'peppers',
    ],
    lit: 4,
  },
  {
    key: 'speak',
    label: 'Speak & score',
    line: 'Every word lights up the moment you nail it.',
    words: ['She', 'sells', 'sea', 'shells', 'by', 'the', 'sea', 'shore'],
    lit: 7,
  },
  {
    key: 'record',
    label: 'Record',
    line: 'Watch yourself get better, take after take.',
    words: [
      'Red',
      'lorry',
      'yellow',
      'lorry',
      'red',
      'lorry',
      'yellow',
      'lorry',
    ],
    lit: 8,
  },
] as const

export const PROMISE =
  'Most tongue-twister sites give you a list. Twister gives you a coach.'

export const STEPS = [
  {
    title: 'Pick a twister',
    body: 'Choose a level or a sound you want to fix.',
  },
  {
    title: 'Say it out loud',
    body: 'Words light up the moment you nail them.',
  },
  {
    title: 'See what tripped you',
    body: 'Get a score, the slow words and the sound that slipped, then drill it.',
  },
] as const

export const MODES = [
  {
    key: 'read',
    title: 'Read along',
    line: 'Hear the rhythm, then match it.',
    tone: 'violet',
    points: [
      'Listen first, then follow the highlighted words',
      'Pick your pace from slow to fast',
      'Loop a tricky twister until it clicks',
      'Switch to line or scroll view for longer ones',
    ],
  },
  {
    key: 'speak',
    title: 'Speak & score',
    line: 'Say it. See every word.',
    tone: 'lime',
    points: [
      'Word-by-word verdicts as you speak',
      'A score for accuracy, speed and fluency',
      'See the sound that slipped',
      'Drill just the weak words',
    ],
  },
  {
    key: 'record',
    title: 'Record',
    line: 'Watch yourself get better.',
    tone: 'pink',
    points: [
      'Record yourself with camera or screen layouts',
      'Replay the take with the words highlighted',
      'Your recordings stay on your device unless you choose to save one',
      'Share a score card when you are proud of it',
    ],
  },
] as const

export const PERSONAS = [
  {
    key: 'presenters',
    label: 'Presenters',
    body: 'Warm up your mouth before the big talk. Crisp consonants make you sound sure of yourself.',
    outcome: 'Clearer delivery when it counts.',
    slug: 'she-sells-seashells',
  },
  {
    key: 'learners',
    label: 'Language learners',
    body: 'Hard sounds get easier when you can see exactly which word slipped, and drill just that.',
    outcome: 'Confidence with the sounds that trip you up.',
    slug: 'truly-rural',
  },
  {
    key: 'actors',
    label: 'Actors & voice-over',
    body: 'Train precision at speed. Start slow, build up and track your best score on each twister.',
    outcome: 'Diction that holds up at pace.',
    slug: 'unique-new-york',
  },
  {
    key: 'anyone',
    label: 'Anyone who likes a challenge',
    body: 'Four levels from easy to insane, with a streak to protect and scores to beat.',
    outcome: 'A small daily win.',
    slug: 'six-sick-sheiks',
  },
] as const

export const PRIVACY = {
  title: 'Your voice stays yours.',
  points: [
    {
      title: 'No recording by default',
      body: 'We do not record you unless you press Record and choose to save the take.',
    },
    {
      title: 'Text and score only',
      body: 'In some browsers, the browser’s built-in speech recognition may process audio using the browser maker’s service. Twister only receives the text and your score.',
    },
    {
      title: 'Delete anytime',
      body: 'Delete your account and your data goes with it. Export first if you like.',
    },
  ],
}

export const FAQ = [
  ['Is Twister free?', 'Yes, it is free to use today.'],
  ['Do I need to install anything?', 'No. It runs in your browser.'],
  [
    'Do you record my voice?',
    'Not unless you press Record and choose to save the take. See the privacy policy for the details.',
  ],
  [
    'Why do I need an account?',
    'To save scores, streaks and favourites and to unlock the full library. The demo works without one.',
  ],
  [
    'Which browsers work best?',
    'Chrome, Edge and Safari give live word-by-word feedback. Firefox uses typed mode.',
  ],
  [
    'How is my score calculated?',
    'It combines how accurately you say the words with your speed for the level. You get more detail after you sign in.',
  ],
  ['Is it safe for kids?', 'Twister is for ages 13 and over.'],
  [
    'Can I delete my data?',
    'Yes. Delete your account any time from Account, and export first if you like.',
  ],
] as const

export const FINAL = {
  title: 'Ready to say it right?',
  body: 'Free, in your browser, and your first score takes about ten seconds.',
}

export const FOOTER = {
  blurb: 'Practise tongue twisters out loud and watch every word light up.',
  chips: ['Free', 'Runs in your browser', '13+'],
  product: [
    { label: 'How it works', href: '/#how' },
    { label: 'Practice modes', href: '/#modes' },
    { label: 'Browse twisters', href: '/twisters' },
    { label: 'Today’s twister', href: '/#demo' },
  ],
}

/** Section anchors in the sticky nav. */
export const NAV = [
  { label: 'How it works', href: '#how' },
  { label: 'Modes', href: '#modes' },
  { label: 'Privacy', href: '#privacy' },
  { label: 'FAQ', href: '#faq' },
] as const
