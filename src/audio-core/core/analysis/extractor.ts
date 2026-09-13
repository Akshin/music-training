/**
 * Extractor contract.
 *
 * An extractor computes one feature (or one shared intermediate such as the magnitude spectrum)
 * for every analysis frame. Extractors declare what they depend on, so the analyser can resolve a
 * requested feature set into a minimal ordered graph and compute shared work exactly once per frame.
 *
 * Two kinds of output:
 *  - scalar `columns` written to the timeline (persisted per frame, e.g. `f0`, `rms`);
 *  - a typed `TResult` for the current frame, visible to dependants and listeners (e.g. a spectrum
 *    buffer). Results are ephemeral: the instance may reuse the same object every frame.
 *
 * Definitions are singletons keyed by `id`; options are passed to the analyser per id. Referencing
 * the definition object in `deps` gives dependants a typed `results.get(dep)`.
 */

export interface AnalysisContext {
  readonly sampleRate: number
  /** Samples per analysis window. */
  readonly frameSize: number
  /** Samples between consecutive frames. */
  readonly hopSize: number
}

export interface FrameInput {
  /** Raw (unwindowed) samples of the current window. Reused between frames: copy to keep. */
  readonly samples: Float32Array
  /** Frame index on the timeline. */
  readonly index: number
  /** Time in seconds (session clock) of the window centre. */
  readonly time: number
}

export interface ResultReader {
  /** Current-frame result of a dependency. Throws if it has not been computed. */
  get<TResult>(extractor: Extractor<TResult, object>): TResult
  /** Whether a result for the current frame exists (false before the first frame or after reset). */
  has(extractor: Extractor<unknown, object>): boolean
}

export interface ColumnWriter {
  /** Stores a scalar in one of the extractor's declared columns for the current frame. */
  set(column: string, value: number): void
}

export interface ExtractorInstance<TResult> {
  process(frame: FrameInput, deps: ResultReader, out: ColumnWriter): TResult
  /** Clears internal state (history buffers, trackers). Optional for stateless extractors. */
  reset?(): void
}

export interface Extractor<TResult = unknown, TOptions extends object = object> {
  readonly id: string
  readonly deps: readonly AnyExtractor[]
  /** Timeline columns this extractor writes. Names must be unique across the graph. */
  readonly columns: readonly string[]
  create(context: AnalysisContext, options?: Partial<TOptions>): ExtractorInstance<TResult>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyExtractor = Extractor<any, any>

/** Identity helper that pins the generic parameters for inference at the definition site. */
export function defineExtractor<TResult, TOptions extends object = object>(
  definition: Extractor<TResult, TOptions>,
): Extractor<TResult, TOptions> {
  return definition
}
