use rayon::prelude::*;

pub fn square(
  buffer: &mut Vec<f32>,      // mutable buffer for writing output
  frequency: f32,             // frequency in Hz
  amplitude: f32,             // amplitude (0.0 to 1.0)
  sample_rate: f32,           // sample rate in Hz
  num_samples: usize,         // number of samples (per channel)
  current_frame: u64,         // frame offset
) {
  // precompute constants
  let period = 1.0 / frequency; // period of the waveform in seconds
  let sample_time_factor = 1.0 / sample_rate;

  // assume the buffer is preallocated; we don't resize here.
  assert_eq!(buffer.len(), num_samples * 2, "Buffer size is incorrect");

  // process chunks in parallel
  buffer
    .par_chunks_mut(2) // each chunk represents one stereo frame
    .enumerate()
    .for_each(|(frame, chunk)| {
      // calculate the sample time and phase
      let sample_time = (current_frame + frame as u64) as f32 * sample_time_factor;
      let phase_time = sample_time % period; // phase time within the period

      // calculate the square wave value
      let value = if phase_time < period / 2.0 {
          amplitude
      } else {
          -amplitude
      };

      // interleave stereo
      chunk[0] = value; // left channel
      chunk[1] = value; // right channel
    });
}