extern crate console_error_panic_hook;

use wasm_bindgen::prelude::*;
use rayon::prelude::*;

use std::panic;
use std::f32::consts::PI;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering, AtomicBool, AtomicU64};
use js_sys::{Atomics};
use web_sys::{console};

pub use wasm_bindgen_rayon::init_thread_pool;

#[wasm_bindgen(start)]
pub fn main() {
    std::panic::set_hook(Box::new(console_error_panic_hook::hook));
}

pub struct RingBuffer {
    capacity: u32,
    storage: js_sys::Float32Array,
    write_ptr: js_sys::Uint32Array,
    read_ptr: js_sys::Uint32Array,
}

impl RingBuffer {
    pub fn new(shared_buffer: JsValue) -> RingBuffer {
        if !shared_buffer.is_instance_of::<js_sys::SharedArrayBuffer>() {
            panic!("Expected a SharedArrayBuffer");
        }

        let write_ptr = js_sys::Uint32Array::new_with_byte_offset(&shared_buffer, 0);
        let read_ptr = js_sys::Uint32Array::new_with_byte_offset(&shared_buffer, 4);
        let storage = js_sys::Float32Array::new_with_byte_offset_and_length(
            &shared_buffer,
            8,
            (shared_buffer.dyn_ref::<js_sys::SharedArrayBuffer>().unwrap().byte_length() - 8) as u32 / 4
        );

        let capacity = storage.length();

        RingBuffer {
            capacity,
            storage,
            write_ptr,
            read_ptr,
        }
    }

    pub fn write(&self, data: &[f32]) -> usize {
        let rd = Atomics::load(&self.read_ptr, 0).unwrap_or(0) as u32;
        let wr = Atomics::load(&self.write_ptr, 0).unwrap_or(0) as u32;

        // match JS implementation exactly
        if (wr + 1) % self.capacity == rd {
            console::log_1(&"Buffer full".into());
            return 0;
        }

        let available = self.available_to_write();
        let to_write = std::cmp::min(data.len(), available as usize);

        // match JS implementation's two-part copy
        let first_part = std::cmp::min((self.capacity - wr) as usize, to_write);
        let second_part = to_write - first_part;

        // first part
        for i in 0..first_part {
            self.storage.set_index(wr + i as u32, data[i]);
        }

        // second part (wrap around)
        for i in 0..second_part {
            self.storage.set_index(i as u32, data[first_part + i]);
        }

        // update write pointer exactly like JS
        let new_wr = (wr + to_write as u32) % self.capacity;
        if let Err(err) = Atomics::store(&self.write_ptr, 0, new_wr as i32) {
            console::error_1(&format!("Failed to update write pointer: {:?}", err).into());
        }

        to_write
    }

    pub fn available_to_write(&self) -> u32 {
        let rd = Atomics::load(&self.read_ptr, 0).unwrap_or(0) as u32;
        let wr = Atomics::load(&self.write_ptr, 0).unwrap_or(0) as u32;
        self.capacity() - ((wr + self.capacity - rd) % self.capacity)
    }

    pub fn capacity(&self) -> u32 {
        self.capacity - 1
    }
}

#[wasm_bindgen]
pub struct AudioEngine {
    buffer: Arc<RingBuffer>,
    frequency: Arc<AtomicU32>,
    amplitude: Arc<AtomicU32>,
    buffer_size: usize,
    sample_rate: f32,
    current_frame: Arc<AtomicU64>,
    current_time: Arc<AtomicU64>,
    is_running: Arc<AtomicBool>,
}

#[wasm_bindgen]
impl AudioEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(shared_buffer: JsValue, buffer_size: usize, sample_rate: f32) -> AudioEngine {
        if !shared_buffer.is_instance_of::<js_sys::SharedArrayBuffer>() {
            panic!("shared_buffer is not a SharedArrayBuffer");
        }
        
        let buffer = Arc::new(RingBuffer::new(shared_buffer));
        console::log_1(&format!(
            "AudioEngine initialized - buffer capacity: {}, buffer_size: {}", 
            buffer.capacity(), buffer_size
        ).into());

        AudioEngine {
            buffer,
            frequency: Arc::new(AtomicU32::new(440.0f32.to_bits())),
            amplitude: Arc::new(AtomicU32::new(0.15f32.to_bits())),
            sample_rate,
            buffer_size,
            current_frame: Arc::new(AtomicU64::new(0)),
            current_time: Arc::new(AtomicU64::new(0.0f64.to_bits())),
            is_running: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn set_frequency(&self, frequency: f32) {
        self.frequency.store(frequency.to_bits(), Ordering::Release);
    }

    pub fn set_amplitude(&self, amplitude: f32) {
        self.amplitude.store(amplitude.to_bits(), Ordering::Release);
    }

    #[wasm_bindgen]
    pub async fn start(&self) -> Result<(), JsValue> {
        self.is_running.store(true, Ordering::Release);

        let performance = web_sys::window()
            .and_then(|w| w.performance())
            .expect("Performance API not available");

        let mut total_delay_frames = 0u64;
        let mut total_computation_time_ms = 0.0;
        let mut render_count = 0;
        
        while self.is_running.load(Ordering::SeqCst) {
            let start_time_ms = performance.now();
            let available = self.buffer.available_to_write() as usize;
            
            // Need space for stereo frames
            if available >= self.buffer_size * 2 {
                let freq = f32::from_bits(self.frequency.load(Ordering::Acquire));
                let amp = f32::from_bits(self.amplitude.load(Ordering::Acquire));
                let current_frame = self.current_frame.load(Ordering::Acquire);
                let current_time = f64::from_bits(self.current_time.load(Ordering::Acquire));
            
                sine(
                    &self.buffer,
                    freq,
                    amp,
                    self.sample_rate,
                    self.buffer_size,
                    current_time,
                    current_frame
                );

                // Update frame count (in mono frames)
                self.current_frame.fetch_add(self.buffer_size as u64, Ordering::Release);
                total_delay_frames += self.buffer_size as u64;
                
                // End time for the signal path
                let end_time_ms = performance.now(); 
                total_computation_time_ms += end_time_ms - start_time_ms;
                
                render_count += 1;

                // Update current time
                let new_time = ((current_frame + self.buffer_size as u64) as f64 / self.sample_rate as f64).to_bits();
                self.current_time.store(new_time, Ordering::Release);
            }

            // Calculate and log the average delay every 100 renders
            if render_count == 100 {
                // Theoretical total time (in ms) for 100 renders based on the sample rate
                let total_theoretical_time_ms =
                    (total_delay_frames as f32 / self.sample_rate) * 1000.0;

                // Average delay and computation times
                let avg_delay_ms = total_theoretical_time_ms / 100.0;
                let avg_computation_time_ms = total_computation_time_ms / 100.0;

                // Congestion (render time congestion)
                let render_time_congestion_ms = avg_computation_time_ms - avg_delay_ms as f64;


                console::log_1(
                    &format!(
                        "Average delay: {:.3} ms, Average computation time: {:.3} ms, Render time congestion: {:.3} ms",
                        avg_delay_ms, avg_computation_time_ms, render_time_congestion_ms
                    )
                    .into(),
                );
                
                // Reset counters
                total_delay_frames = 0;
                total_computation_time_ms = 0.0;
                render_count = 0;
            }

            // Yield to the event loop
            let promise = js_sys::Promise::resolve(&JsValue::UNDEFINED);
            wasm_bindgen_futures::JsFuture::from(promise).await.unwrap();
        }

        Ok(())
    }

    pub fn stop(&self) {
        self.is_running.store(false, Ordering::Release);
    }

    pub fn get_current_time(&self) -> f64 {
        f64::from_bits(self.current_time.load(Ordering::Acquire))
    }

    pub fn get_current_frame(&self) -> u64 {
        self.current_frame.load(Ordering::Acquire)
    }
}

pub fn sine(
    buffer: &RingBuffer,
    frequency: f32,
    amplitude: f32,
    sample_rate: f32,
    num_samples: usize,
    _current_time: f64,
    current_frame: u64,
) {
    let angular_frequency = frequency * 2.0 * PI;

    // interleaved stereo samples in parallel
    let mut samples = vec![0.0; num_samples * 2];
    samples
        .par_chunks_mut(2) // each chunk represents a stereo frame
        .enumerate()
        .for_each(|(frame, chunk)| {
            let sample_time = (current_frame + frame as u64) as f64 / sample_rate as f64;
            let phase = angular_frequency * sample_time as f32;
            let value = phase.sin() * amplitude;

            // interleave stereo
            chunk[0] = value; // Left channel
            chunk[1] = value; // Right channel
        });

    buffer.write(&samples);
}