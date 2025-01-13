use rayon::prelude::*;
use crate::ringbuf::RingBuffer;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering, AtomicU8};
use std::sync::Arc;
use wasm_bindgen::prelude::*;
use web_sys::console;

use crate::osc::sine;
use crate::osc::saw;
use crate::osc::triangle;
use crate::osc::square;

pub fn note_fo_freq(note: u8) -> f32 {
  // A4 is the 49th key on a standard 88-key piano, with a frequency of 440 Hz
  const A4_NOTE: u8 = 49;
  const A4_FREQ: f32 = 440.0;

  // calculate the frequency using the formula for equal temperament
  let semitone_ratio = 2.0_f32.powf(1.0 / 12.0);
  let note_difference = note as i32 - A4_NOTE as i32;
  A4_FREQ * semitone_ratio.powi(note_difference)
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug)]
pub enum Waveform {
    Sine = 0,
    Square = 1,
    Triangle = 2,
    Sawtooth = 3,
}

#[wasm_bindgen]
pub struct AudioEngine {
  buffer: Arc<RingBuffer>,
  frequency: Arc<AtomicU32>,
  amplitude: Arc<AtomicU32>,
  waveform: Arc<AtomicU8>,
  buffer_size: usize,
  sample_rate: f32,
  current_frame: Arc<AtomicU64>,
  is_running: Arc<AtomicBool>,
  stats_callback: Option<js_sys::Function>,
  parallelism: usize,
}

#[wasm_bindgen]
impl AudioEngine {

  #[wasm_bindgen(constructor)]
  pub fn new(
    shared_buffer: JsValue,
    buffer_size: usize,
    sample_rate: f32,
    parallelism: usize,
    waveform: Waveform,
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
      frequency: Arc::new(AtomicU32::new(440.0f32.to_bits())),
      amplitude: Arc::new(AtomicU32::new(0.15f32.to_bits())),
      waveform: Arc::new(AtomicU8::new(waveform as u8)),
      sample_rate,
      buffer_size,
      current_frame: Arc::new(AtomicU64::new(0)),
      is_running: Arc::new(AtomicBool::new(false)),
      stats_callback: None,
      parallelism,
    }
  }

  pub fn set_waveform(&self, waveform: Waveform) {
    self.waveform.store(waveform as u8, Ordering::SeqCst);
  }

  fn copy_to_clones(
    &self,
    ring_buffer: &RingBuffer,
    clones: &mut [Vec<f32>],
    original_data: &mut Vec<f32>,
  ) {
    // ensure `original_data` is pre-allocated
    if original_data.len() != self.buffer_size * 2 {
      original_data.resize(self.buffer_size * 2, 0.0);
    }

    // copy original data from RingBuffer
    ring_buffer.copy_data(original_data);

    // copy the data into each clone (reuse memory)
    clones.par_iter_mut().for_each(|clone| {
      clone.copy_from_slice(original_data);
    });
  }

  fn process_and_aggregate(
    &self,
    clones: &mut [Vec<f32>],
    freq: f32,
    amp: f32,
    sample_rate: f32,
    current_frame: u64,
  ) -> Vec<f32> {
    
    // Retrieve the current waveform value as a u8
    let waveform_value = self.waveform.load(Ordering::Acquire);

    // process each clone in parallel
    clones.par_iter_mut().for_each(|clone| {
      match waveform_value {
        0 => sine::sine(clone, freq, amp, sample_rate, clone.len() / 2, current_frame),
        1 => square::square(clone, freq, amp, sample_rate, clone.len() / 2, current_frame),
        2 => triangle::triangle(clone, freq, amp, sample_rate, clone.len() / 2, current_frame),
        3 => saw::saw(clone, freq, amp, sample_rate, clone.len() / 2, current_frame),
        _ => panic!("Invalid waveform value: {}", waveform_value),
      }
    });

    // aggregate results in parallel
    let mut final_buffer = vec![0.0f32; self.buffer_size * 2];

    final_buffer
      .par_iter_mut()
      .enumerate()
      .for_each(|(i, sample)| {
        *sample = clones
          .iter()
          .map(|clone| clone[i])
          .sum::<f32>();
      });

    // normalize by dividing by the number of clones
    let num_clones = clones.len() as f32; // cache the length
    final_buffer.par_iter_mut().for_each(|sample| *sample /= num_clones);

    final_buffer
  }

  fn allocate_clones(&self, n: usize) -> Vec<Vec<f32>> {
    // allocate `n` buffers with the size of the original buffer
    (0..n)
      .map(|_| vec![0.0f32; self.buffer_size * 2]) // stereo: Left + Right
      .collect()
  }

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

    // pre-fetch the performance object to avoid dynamic lookups
    let performance = web_sys::window()
      .and_then(|w| w.performance())
      .expect("Performance API not available");

    let n = self.parallelism;
    let mut clones = self.allocate_clones(n);
    let mut original_data = vec![0.0f32; self.buffer_size * 2];

    // precompute buffer sizes and avoid recomputation
    let double_buffer_size = self.buffer_size * 2;

    // pre-allocate intermediate variables for statistics
    let mut total_computation_time_ms = 0.0;
    let mut render_count = 0;

    while self.is_running.load(Ordering::Acquire) {
      let start_time_ms = performance.now();
      let available = self.buffer.available_to_write() as usize;

      // check if enough space for stereo frames
      if available >= double_buffer_size {
        // load parameters from atomic variables
        let freq = f32::from_bits(self.frequency.load(Ordering::Acquire));
        let amp = f32::from_bits(self.amplitude.load(Ordering::Acquire));
        let current_frame = self.current_frame.load(Ordering::Acquire);

        // copy data into clones
        self.copy_to_clones(&self.buffer, &mut clones, &mut original_data);

        // process clones and aggregate results
        let final_buffer = self.process_and_aggregate(
          &mut clones,
          freq,
          amp,
          self.sample_rate,
          current_frame,
        );

        // write results to the RingBuffer
        self.buffer.write(&final_buffer);

        // update frame count (in mono frames)
        self.current_frame
          .fetch_add(self.buffer_size as u64, Ordering::Release);

        // measure end time for computation
        let end_time_ms = performance.now();
        total_computation_time_ms += end_time_ms - start_time_ms;

        render_count += 1;
      }

      // calculate and log statistics every 100 renders
      if render_count == 100 {

        if let Some(callback) = &self.stats_callback {
          let stats = js_sys::Object::new();
          js_sys::Reflect::set(
            &stats,
            &"signalChainTookMs".into(),
            &JsValue::from_f64(total_computation_time_ms / 100.0 as f64),
          )?;

          callback.call1(&JsValue::NULL, &stats)?;
        }

        // reset statistics
        total_computation_time_ms = 0.0;
        render_count = 0;
      }

      // efficient yielding using a timer
      gloo_timers::future::sleep(std::time::Duration::from_millis(0)).await;
    }

    Ok(())
  }

  pub fn stop(&self) {
    self.is_running.store(false, Ordering::Release);
  }

  pub fn get_current_frame(&self) -> u64 {
    self.current_frame.load(Ordering::Acquire)
  }
}