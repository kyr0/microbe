import { initSync, initThreadPool, sine } from '../pkg/microbe';

export default class ToneProcessor extends AudioWorkletProcessor {
  bufferSize: number;
  sampleRate: number;
  samplesLeft: Float32Array;
  samplesRight: Float32Array;
  frequency: number;
  amplitude: number;
  module: WebAssembly.Module;

  constructor(options: AudioWorkletNodeOptions) {
    super();
    this.bufferSize = 128; // Small buffer for real-time audio processing
    this.sampleRate = sampleRate;
    this.samplesLeft = new Float32Array(this.bufferSize);
    this.samplesRight = new Float32Array(this.bufferSize);
    this.frequency = 440.0; // Default frequency (A4)
    this.amplitude = 0.5; // Default amplitude
    this.module = options.processorOptions.module;
  }

  static get parameterDescriptors() {
    return [
      {
        name: "frequency",
        defaultValue: 440.0,
        minValue: 20.0,
        maxValue: 20000.0,
        automationRate: "a-rate",
      },
      {
        name: "amplitude",
        defaultValue: 0.5,
        minValue: 0.0,
        maxValue: 1.0,
        automationRate: "a-rate",
      },
    ];
  }

  process(
    _inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
 
  ): boolean {
    const outputLeft = outputs[0][0];
    const outputRight = outputs[0][1];

    // Update parameters if they are provided
    this.frequency = parameters.frequency[0];
    this.amplitude = parameters.amplitude[0];


    initSync({ module: this.module });
    // use this.module!

    // Call the WebAssembly `sine_wave` function
    /*
    sine(
      this.samplesLeft,
      this.samplesRight,
      this.frequency,
      this.amplitude,
      2, // Stereo
      this.sampleRate
    );
    */

    // Copy generated samples to output buffers
    outputLeft.set(this.samplesLeft);
    outputRight.set(this.samplesRight);

    return true; // Keep the processor alive
  }
}

registerProcessor("tone-processor", ToneProcessor);