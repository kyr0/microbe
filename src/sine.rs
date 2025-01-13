use crate::ringbuf::RingBuffer;
use rayon::prelude::*;
use std::f32::consts::PI;

// using Rayon parallel iterators to compute the sine wave (multi-threaded, multi-core)
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
