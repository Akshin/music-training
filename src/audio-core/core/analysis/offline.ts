import type { AnyExtractor } from './extractor'
import { Analyzer, type AnalyzerConfig, type ExtractorOptions } from './analyzer'

/**
 * Runs the streaming analyser over a complete signal and returns it with the finished timeline.
 * Same extractors, same numbers as the live pass — offline analysis differs only in that the
 * whole signal is available, which later stages (segmentation, lookahead trackers) exploit.
 */
export function analyzeOffline(
  samples: Float32Array,
  config: AnalyzerConfig,
  features: readonly AnyExtractor[],
  options: ExtractorOptions = {},
): Analyzer {
  const analyzer = new Analyzer(config, features, options)
  analyzer.push(samples)
  return analyzer
}
