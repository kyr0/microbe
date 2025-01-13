use crate::ringbuf::RingBuffer;
use crate::sine::sine;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use wasm_bindgen::prelude::*;
use web_sys::console;

pub fn note_fo_freq(note: u8) -> f32 {
    // A4 is the 49th key on a standard 88-key piano, with a frequency of 440 Hz
    const A4_NOTE: u8 = 49;
    const A4_FREQ: f32 = 440.0;

    // Calculate the frequency using the formula for equal temperament
    let semitone_ratio = 2.0_f32.powf(1.0 / 12.0);
    let note_difference = note as i32 - A4_NOTE as i32;
    A4_FREQ * semitone_ratio.powi(note_difference)
}

#[wasm_bindgen]
pub struct AudioEngine {
    buffer: Arc<RingBuffer>,
    frequency: Arc<AtomicU32>,
    amplitude: Arc<AtomicU32>,
    buffer_size: usize,
    sample_rate: f32,
    channel_count: usize,
    current_frame: Arc<AtomicU64>,
    current_time: Arc<AtomicU64>,
    is_running: Arc<AtomicBool>,
    stats_callback: Option<js_sys::Function>,
}

#[wasm_bindgen]
impl AudioEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(
        shared_buffer: JsValue,
        channel_count: usize,
        buffer_size: usize,
        sample_rate: f32,
    ) -> AudioEngine {
        if !shared_buffer.is_instance_of::<js_sys::SharedArrayBuffer>() {
            panic!("shared_buffer is not a SharedArrayBuffer");
        }

        let buffer = Arc::new(RingBuffer::new(shared_buffer));
        console::log_1(
            &format!(
                "AudioEngine initialized - buffer capacity: {}, buffer_size: {}",
                buffer.capacity(),
                buffer_size
            )
            .into(),
        );

        AudioEngine {
            buffer,
            channel_count,
            frequency: Arc::new(AtomicU32::new(440.0f32.to_bits())),
            amplitude: Arc::new(AtomicU32::new(0.15f32.to_bits())),
            sample_rate,
            buffer_size,
            current_frame: Arc::new(AtomicU64::new(0)),
            current_time: Arc::new(AtomicU64::new(0.0f64.to_bits())),
            is_running: Arc::new(AtomicBool::new(false)),
            stats_callback: None,
        }
    }

    /// Register a JavaScript callback function to receive statistics
    pub fn set_stats_callback(&mut self, callback: js_sys::Function) {
      self.stats_callback = Some(callback);
  }

    pub fn set_note(&self, note: u8) {
        let freq = note_fo_freq(note);
        self.set_frequency(freq);
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
    
        // Pre-fetch the performance object to avoid dynamic lookups
        let performance = web_sys::window()
            .and_then(|w| w.performance())
            .expect("Performance API not available");
    
        // Precompute buffer sizes and avoid recomputation
        let double_buffer_size = self.buffer_size * 2;
    
        // Pre-allocate intermediate variables for statistics
        let mut total_delay_frames = 0u64;
        let mut total_computation_time_ms = 0.0;
        let mut render_count = 0;
    
        while self.is_running.load(Ordering::Acquire) {
            let start_time_ms = performance.now();
    
            // Query available space in the buffer
            let available = self.buffer.available_to_write() as usize;
    
            // Check if enough space for stereo frames
            if available >= double_buffer_size {
                // Load parameters from atomic variables
                let freq = f32::from_bits(self.frequency.load(Ordering::Acquire));
                let amp = f32::from_bits(self.amplitude.load(Ordering::Acquire));
                let current_frame = self.current_frame.load(Ordering::Acquire);
                let current_time = f64::from_bits(self.current_time.load(Ordering::Acquire));
    
                // Use a pre-allocated sine wave generator
                sine(
                    &self.buffer,
                    freq,
                    amp,
                    self.sample_rate,
                    self.buffer_size,
                    current_time,
                    current_frame,
                );
    
                // Update frame count (in mono frames)
                self.current_frame
                    .fetch_add(self.buffer_size as u64, Ordering::Release);
                total_delay_frames += self.buffer_size as u64;
    
                // Measure end time for computation
                let end_time_ms = performance.now();
                total_computation_time_ms += end_time_ms - start_time_ms;
    
                // Increment render count
                render_count += 1;
    
                // Update current time (precompute division to avoid runtime recalculations)
                let new_time = ((current_frame + self.buffer_size as u64) as f64
                    / self.sample_rate as f64)
                    .to_bits();
                self.current_time.store(new_time, Ordering::Release);
            }
    
            // Calculate and log statistics every 100 renders
            if render_count == 100 {
    
                if let Some(callback) = &self.stats_callback {
                    let stats = js_sys::Object::new();
                    js_sys::Reflect::set(
                        &stats,
                        &"timeConsumedMs".into(),
                        &JsValue::from_f64(total_computation_time_ms / 100.0 as f64),
                    )?;
    
                    callback.call1(&JsValue::NULL, &stats)?;
                }
    
                // Reset statistics
                total_delay_frames = 0;
                total_computation_time_ms = 0.0;
                render_count = 0;
            }
    
            // Efficient yielding using a timer
            gloo_timers::future::sleep(std::time::Duration::from_millis(0)).await;
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
