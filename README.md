# Microbe

## ⚡ Multithreading, WebAssembly/AudioWorklet-driven, SIMD-optimized Audio Engine 🔉

This tech demo features a multithreaded, SIMD-optimized Audio Engine in WebAssembly, written in Rust. Using a single AudioWorkletProcessor, audio data is received from WebAssembly via an atomic, zero-copy RingBuffer sharing a SharedArrayBuffer be between WebAssembly, the main thread, and the AudioWorklet thread. This design is highly efficient, with less than 0.001ms overhead, no heap allocations, and completely lock-free due to atomic state management.

[Live demo](https://stackblitz.com/~/github.com/kyr0/microbe)