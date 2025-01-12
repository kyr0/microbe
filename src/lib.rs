use wasm_bindgen::prelude::*;
use rayon::prelude::*;
use std::f32::consts::PI;
use std::arch::wasm32::*;
use web_sys::{AudioContext, OscillatorType};

pub use wasm_bindgen_rayon::init_thread_pool;

/// Converts a midi note to frequency
///
/// A midi note is an integer, generally in the range of 21 to 108
pub fn midi_to_freq(note: u8) -> f32 {
    27.5 * 2f32.powf((note as f32 - 21.0) / 12.0)
}

#[wasm_bindgen]
pub struct FmOsc {
    ctx: AudioContext,

    /// The primary oscillator.  This will be the fundamental frequency
    primary: web_sys::OscillatorNode,

    /// Overall gain (volume) control
    gain: web_sys::GainNode,

    /// Amount of frequency modulation
    fm_gain: web_sys::GainNode,

    /// The oscillator that will modulate the primary oscillator's frequency
    fm_osc: web_sys::OscillatorNode,

    /// The ratio between the primary frequency and the fm_osc frequency.
    ///
    /// Generally fractional values like 1/2 or 1/4 sound best
    fm_freq_ratio: f32,

    fm_gain_ratio: f32,
}

impl Drop for FmOsc {
    fn drop(&mut self) {
        let _ = self.ctx.close();
    }
}

#[wasm_bindgen]
impl FmOsc {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Result<FmOsc, JsValue> {
        let ctx = web_sys::AudioContext::new()?;

        // Create our web audio objects.
        let primary = ctx.create_oscillator()?;
        let fm_osc = ctx.create_oscillator()?;
        let gain = ctx.create_gain()?;
        let fm_gain = ctx.create_gain()?;

        // Some initial settings:
        primary.set_type(OscillatorType::Sine);
        primary.frequency().set_value(440.0); // A4 note
        gain.gain().set_value(0.0); // starts muted
        fm_gain.gain().set_value(0.0); // no initial frequency modulation
        fm_osc.set_type(OscillatorType::Sine);
        fm_osc.frequency().set_value(0.0);

        // Connect the nodes up!

        // The primary oscillator is routed through the gain node, so that
        // it can control the overall output volume.
        primary.connect_with_audio_node(&gain)?;

        // Then connect the gain node to the AudioContext destination (aka
        // your speakers).
        gain.connect_with_audio_node(&ctx.destination())?;

        // The FM oscillator is connected to its own gain node, so it can
        // control the amount of modulation.
        fm_osc.connect_with_audio_node(&fm_gain)?;

        // Connect the FM oscillator to the frequency parameter of the main
        // oscillator, so that the FM node can modulate its frequency.
        fm_gain.connect_with_audio_param(&primary.frequency())?;

        // Start the oscillators!
        primary.start()?;
        fm_osc.start()?;

        Ok(FmOsc {
            ctx,
            primary,
            gain,
            fm_gain,
            fm_osc,
            fm_freq_ratio: 0.0,
            fm_gain_ratio: 0.0,
        })
    }

    /// Sets the gain for this oscillator, between 0.0 and 1.0.
    #[wasm_bindgen]
    pub fn set_gain(&self, mut gain: f32) {
        gain = gain.clamp(0.0, 1.0);
        self.gain.gain().set_value(gain);
    }

    #[wasm_bindgen]
    pub fn set_primary_frequency(&self, freq: f32) {
        self.primary.frequency().set_value(freq);

        // The frequency of the FM oscillator depends on the frequency of the
        // primary oscillator, so we update the frequency of both in this method.
        self.fm_osc.frequency().set_value(self.fm_freq_ratio * freq);
        self.fm_gain.gain().set_value(self.fm_gain_ratio * freq);
    }

    #[wasm_bindgen]
    pub fn set_note(&self, note: u8) {
        let freq = midi_to_freq(note);
        self.set_primary_frequency(freq);
    }

    /// This should be between 0 and 1, though higher values are accepted.
    #[wasm_bindgen]
    pub fn set_fm_amount(&mut self, amt: f32) {
        self.fm_gain_ratio = amt;

        self.fm_gain
            .gain()
            .set_value(self.fm_gain_ratio * self.primary.frequency().value());
    }

    /// This should be between 0 and 1, though higher values are accepted.
    #[wasm_bindgen]
    pub fn set_fm_frequency(&mut self, amt: f32) {
        self.fm_freq_ratio = amt;
        self.fm_osc
            .frequency()
            .set_value(self.fm_freq_ratio * self.primary.frequency().value());
    }
}

#[wasm_bindgen]
pub fn sine(
    samples_left: &mut [f32],
    samples_right: &mut [f32],
    frequency: f32,
    amplitude: f32,
    channels: usize,
    sample_rate: u32,
) {
    if samples_left.len() != samples_right.len() {
        panic!("Buffers must be the same length");
    }

    if samples_left.is_empty() || frequency <= 0.0 || amplitude < 0.0 || amplitude > 1.0 {
        panic!("Invalid parameters: non-empty buffers, frequency > 0, amplitude in [0.0, 1.0]");
    }

    let step = frequency * (2.0 * PI) / sample_rate as f32;
    let channel_amplitude = amplitude / channels as f32;

    const SIMD_WIDTH: usize = 4; // 128-bit SIMD with 4 f32 lanes

    // Process SIMD batches
    samples_left
        .par_chunks_mut(SIMD_WIDTH)
        .zip(samples_right.par_chunks_mut(SIMD_WIDTH))
        .enumerate()
        .for_each(|(batch_idx, (chunk_left, chunk_right))| {
            let base_index = batch_idx * SIMD_WIDTH;

            // Compute indices for SIMD operations
            let indices: [f32; SIMD_WIDTH] = [
                base_index as f32 * step,
                (base_index + 1) as f32 * step,
                (base_index + 2) as f32 * step,
                (base_index + 3) as f32 * step,
            ];

            // Compute sine values (scalar fallback, since no f32x4_sin exists)
            let sine_values: [f32; SIMD_WIDTH] = indices.map(|x| x.sin());
            let scaled_values: [f32; SIMD_WIDTH] = sine_values.map(|x| x * channel_amplitude);

            // Write values back to buffers
            chunk_left.copy_from_slice(&scaled_values);
            chunk_right.copy_from_slice(&scaled_values);
        });

    // Handle remaining samples outside SIMD width
    let remaining_start = (samples_left.len() / SIMD_WIDTH) * SIMD_WIDTH;
    for i in remaining_start..samples_left.len() {
        let value = (i as f32 * step).sin() * channel_amplitude;
        samples_left[i] = value;
        samples_right[i] = value;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sine_wave() {
        let buffer_size = 44100;
        let mut samples_left = vec![0.0f32; buffer_size];
        let mut samples_right = vec![0.0f32; buffer_size];

        sine_wave(&mut samples_left, &mut samples_right, 440.0, 0.5, 2, 44100);

        assert!(samples_left.iter().all(|&sample| sample >= -0.5 && sample <= 0.5));
        assert!(samples_right.iter().all(|&sample| sample >= -0.5 && sample <= 0.5));
    }
}
