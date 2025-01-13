/* tslint:disable */
/* eslint-disable */
export function main(): void;
export function initThreadPool(num_threads: number): Promise<any>;
export function wbg_rayon_start_worker(receiver: number): void;
export enum Waveform {
  Sine = 0,
  Square = 1,
  Triangle = 2,
  Sawtooth = 3,
}
export class AudioEngine {
  free(): void;
  constructor(shared_buffer: any, buffer_size: number, sample_rate: number, parallelism: number, waveform: Waveform);
  set_waveform(waveform: Waveform): void;
  set_stats_callback(callback: Function): void;
  set_note(note: number): void;
  set_frequency(frequency: number): void;
  set_amplitude(amplitude: number): void;
  start(): Promise<void>;
  stop(): void;
  get_current_frame(): bigint;
}
export class wbg_rayon_PoolBuilder {
  private constructor();
  free(): void;
  numThreads(): number;
  receiver(): number;
  build(): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly __wbg_audioengine_free: (a: number, b: number) => void;
  readonly audioengine_new: (a: any, b: number, c: number, d: number, e: number) => number;
  readonly audioengine_set_waveform: (a: number, b: number) => void;
  readonly audioengine_set_stats_callback: (a: number, b: any) => void;
  readonly audioengine_set_note: (a: number, b: number) => void;
  readonly audioengine_set_frequency: (a: number, b: number) => void;
  readonly audioengine_set_amplitude: (a: number, b: number) => void;
  readonly audioengine_start: (a: number) => any;
  readonly audioengine_stop: (a: number) => void;
  readonly audioengine_get_current_frame: (a: number) => bigint;
  readonly main: () => void;
  readonly __wbg_wbg_rayon_poolbuilder_free: (a: number, b: number) => void;
  readonly wbg_rayon_poolbuilder_numThreads: (a: number) => number;
  readonly wbg_rayon_poolbuilder_receiver: (a: number) => number;
  readonly wbg_rayon_poolbuilder_build: (a: number) => void;
  readonly initThreadPool: (a: number) => any;
  readonly wbg_rayon_start_worker: (a: number) => void;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_export_2: WebAssembly.Table;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly memory: WebAssembly.Memory;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_export_7: WebAssembly.Table;
  readonly _dyn_core__ops__function__FnMut_____Output___R_as_wasm_bindgen__closure__WasmClosure___describe__invoke__h1fd7b879ff3e01f2: (a: number, b: number) => void;
  readonly closure48_externref_shim: (a: number, b: number, c: any) => void;
  readonly closure95_externref_shim: (a: number, b: number, c: any, d: any) => void;
  readonly __wbindgen_thread_destroy: (a?: number, b?: number, c?: number) => void;
  readonly __wbindgen_start: (a: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput, memory?: WebAssembly.Memory, thread_stack_size?: number }} module - Passing `SyncInitInput` directly is deprecated.
* @param {WebAssembly.Memory} memory - Deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput, memory?: WebAssembly.Memory, thread_stack_size?: number } | SyncInitInput, memory?: WebAssembly.Memory): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput>, memory?: WebAssembly.Memory, thread_stack_size?: number }} module_or_path - Passing `InitInput` directly is deprecated.
* @param {WebAssembly.Memory} memory - Deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput>, memory?: WebAssembly.Memory, thread_stack_size?: number } | InitInput | Promise<InitInput>, memory?: WebAssembly.Memory): Promise<InitOutput>;
