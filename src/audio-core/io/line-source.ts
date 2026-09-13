/**
 * Line-level input (audio interface, mixer, guitar DI).
 *
 * Same capture path as `MicSource`: the browser does not distinguish mic vs line, so the user
 * picks the interface in the device list. Named separately so hosts can talk about LineIn
 * without implying a second DSP stack.
 */

export {
  MicSource as LineInSource,
  type MicSourceInfo as LineInSourceInfo,
  type MicSourceOptions as LineInSourceOptions,
} from './mic-source'
