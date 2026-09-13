// Vite bundles the worklet as a standalone script and gives back its URL. This is the only place
// where the engine depends on a bundler convention; other bundlers replace this file.
import url from './capture.worklet.ts?worker&url'

export const captureWorkletUrl: string = url
