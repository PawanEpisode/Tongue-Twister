declare module 'canvas-confetti' {
  export interface Options {
    particleCount?: number
    angle?: number
    spread?: number
    origin?: { x?: number; y?: number }
    colors?: string[]
  }
  const confetti: (options?: Options) => Promise<null> | null
  export default confetti
}
