use crate::ringbuf::RingBuffer;
use rayon::prelude::*;
use std::f32::consts::PI;

// using Rayon parallel iterators to compute the sine wave (multi-threaded, multi-core)
pub fn sine(
    buffer: &mut Vec<f32>,      // Mutable buffer for writing output
    frequency: f32,             // Frequency in Hz
    amplitude: f32,             // Amplitude (0.0 to 1.0)
    sample_rate: f32,           // Sample rate in Hz
    num_samples: usize,         // Number of samples (per channel)
    _current_time: f64,         // Current time (not used here)
    current_frame: u64,         // Frame offset
) {
    let angular_frequency = frequency * 2.0 * std::f32::consts::PI;

    // Ensure the buffer is correctly sized for stereo
    buffer.resize(num_samples * 2, 0.0); // Interleaved stereo: Left + Right

    buffer
        .par_chunks_mut(2) // Each chunk represents one stereo frame
        .enumerate()
        .for_each(|(frame, chunk)| {
            let sample_time = (current_frame + frame as u64) as f64 / sample_rate as f64;
            let phase = angular_frequency * sample_time as f32;
            let value = phase.sin() * amplitude;

            // Interleave stereo
            chunk[0] = value; // Left channel
            chunk[1] = value; // Right channel
        });
}