import init, { initThreadPool, AudioEngine } from '../pkg/microbe';
import processor from "./processor?worker&url"
import { getStorageForCapacity } from "./ringbuf/index.js"

console.log('SharedArrayBuffer support enabled?', self.crossOriginIsolated);

async function main() {
  let audioEngine: AudioEngine|null = null;

  // Regular wasm-bindgen initialization.
  await init();

  // Thread pool initialization with the given number of threads
  // (pass `navigator.hardwareConcurrency` if you want to use all cores).
  await initThreadPool(navigator.hardwareConcurrency);

  console.log("hardwareConcurrency", navigator.hardwareConcurrency) // e.g. 8 hyperthreads

  document.querySelector('button')?.addEventListener('click', async() => {
      
    // Initialize AudioContext and add AudioWorkletProcessor
    const audioContext = new AudioContext();

    try {
      // Load the AudioWorklet processor
      await audioContext.audioWorklet.addModule(processor);
      
      console.log('AudioWorklet module loaded');
      const bufferSize = audioContext.sampleRate / 20; // 50ms buffer
      const sharedAudioBuffer = getStorageForCapacity(
        bufferSize * 2 /** channels */ * 2 /** leave room for one ringbuffer rewind*/, Float32Array
      );

      if (audioEngine === null) {
        audioEngine = new AudioEngine(sharedAudioBuffer, bufferSize, audioContext.sampleRate);
        audioEngine.set_frequency(440); // Default frequency: A4
        audioEngine.set_amplitude(0.15); // Default amplitude: 50%
        audioEngine.start(); // Start the oscillator
        console.log('AudioEngine started');
      } else {
        // Stop and free the engine
        audioEngine.stop();
        audioEngine.free();
        audioEngine = null;
        console.log('AudioEngine stopped');
      }

      // forwards a SharedArrayBuffer's audio signal via RingBuffer to the AudioContext.destination
      // this allows for a lock-free, wait-free, and zero-copy audio signal forwarding
      const signalForwarderNode = new AudioWorkletNode(audioContext, 'signal-forwarder', {
        outputChannelCount: [2], // Stereo output
        processorOptions: {
          sharedAudioBuffer, // Shared memory buffer (controlled via RingBuffer)
        },
      });
      signalForwarderNode.connect(audioContext.destination);
    
    } catch (error) {
      console.error('Failed to load AudioWorklet module', error);
      return;
    }
  });

  // Slider for primary frequency control
  const primarySlider: HTMLInputElement = document.getElementById('freq') as HTMLInputElement;
  primarySlider.addEventListener('input', (event) => {
    const value = Number.parseFloat((event.target as HTMLInputElement).value);
    if (audioEngine) {
      audioEngine.set_frequency(value);
      console.log(`Frequency set to ${value} Hz`);
    }
  });

  // Slider for amplitude control
  const amplitudeSlider: HTMLInputElement = document.getElementById('amp') as HTMLInputElement;
  amplitudeSlider.addEventListener('input', (event) => {
    const value = Number.parseFloat((event.target as HTMLInputElement).value);
    if (audioEngine) {
      audioEngine.set_amplitude(value);
      console.log(`Amplitude set to ${value}`);
    }
  });
}

main().catch(console.error);