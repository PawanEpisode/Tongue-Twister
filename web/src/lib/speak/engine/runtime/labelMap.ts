/**
 * `label_map.json` (tools/export_model/label_map.py; read by the worker too): the model's raw IPA output
 * labels -> the engine's ARPAbet classes. Class 0 is the CTC blank; word delimiters and dropped labels count
 * as blank at inference time (no evidence for or against any phone).
 */
export class LabelMapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LabelMapError'
  }
}

export type LabelMap = {
  version: string
  /** Engine vocabulary: `classes[0]` is the blank `<b>`. */
  classes: readonly string[]
  /** Raw model output width. */
  vocabSize: number
  /** For each raw output index, the class index it contributes to. */
  toClass: Int32Array
}

export function parseLabelMap(raw: unknown): LabelMap {
  const j = raw as Record<string, unknown> | null
  if (!j || typeof j !== 'object')
    throw new LabelMapError('label map is not an object')
  const vocab = j.vocab
  const classes = j.classes
  const map = j.map as Record<string, string> | undefined
  const drop = j.drop as string[] | undefined
  const blank = j.blank
  if (
    !Array.isArray(vocab) ||
    !Array.isArray(classes) ||
    !map ||
    !Array.isArray(drop) ||
    typeof blank !== 'string' ||
    typeof j.version !== 'string'
  )
    throw new LabelMapError('label map is missing fields')
  if (classes[0] !== '<b>' || new Set(classes).size !== classes.length)
    throw new LabelMapError('classes must start with the blank and be unique')
  if (new Set(vocab).size !== vocab.length || !vocab.includes(blank))
    throw new LabelMapError('vocab must be unique and contain the blank')
  const position = new Map<string, number>(
    classes.map((c: string, i: number) => [c, i]),
  )
  const dropped = new Set(drop)
  const toClass = new Int32Array(vocab.length)
  vocab.forEach((label: string, row: number) => {
    if (label === blank || dropped.has(label)) toClass[row] = 0
    else {
      const target = map[label]
      const idx = target === undefined ? undefined : position.get(target)
      if (idx === undefined)
        throw new LabelMapError(`unmapped label ${JSON.stringify(label)}`)
      toClass[row] = idx
    }
  })
  return { version: j.version, classes, vocabSize: vocab.length, toClass }
}

/**
 * (frames × vocab) raw logits -> (frames × classes) log class posteriors: softmax over the raw labels, sum
 * the labels that share a class, take logs. Rows sum to one over the classes.
 */
export function collapse(
  map: LabelMap,
  logits: Float32Array,
  frames: number,
): number[][] {
  if (logits.length !== frames * map.vocabSize)
    throw new LabelMapError('model output width does not match the label map')
  const out: number[][] = new Array(frames)
  const sums = new Float64Array(map.classes.length)
  for (let t = 0; t < frames; t++) {
    const base = t * map.vocabSize
    let max = -Infinity
    for (let v = 0; v < map.vocabSize; v++)
      if (logits[base + v] > max) max = logits[base + v]
    sums.fill(0)
    let total = 0
    for (let v = 0; v < map.vocabSize; v++) {
      const p = Math.exp(logits[base + v] - max)
      sums[map.toClass[v]] += p
      total += p
    }
    const row = new Array<number>(map.classes.length)
    for (let c = 0; c < row.length; c++)
      row[c] = Math.log(Math.max(sums[c] / total, 1e-12))
    out[t] = row
  }
  return out
}
