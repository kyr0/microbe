import init, { initThreadPool, AudioEngine } from '../pkg/microbe';
import processor from "./processor?worker&url"
import { getStorageForCapacity } from "./ringbuf/index.js"

console.log('SharedArrayBuffer support enabled?', self.crossOriginIsolated);

async function main() {
  let audioEngine: AudioEngine|null = null;

  // init wasm-bindgen
  await init();

  console.log("hardwareConcurrency", navigator.hardwareConcurrency) // e.g. 8 hyperthreads

  // thread pool initialization with the given number of threads
  // e.g. 8 hyperthreads (cores) on a modern CPU
  await initThreadPool(navigator.hardwareConcurrency);

  document.querySelector('button')?.addEventListener('click', async() => {
      
    // Initialize AudioContext and add AudioWorkletProcessor
    const audioContext = new AudioContext();

    try {
      // Load the AudioWorklet processor
      await audioContext.audioWorklet.addModule(processor);
      
      console.log('AudioWorklet module loaded');
      const bufferSize = 512;
      const channels = 2; // Stereo
      const sharedAudioBuffer = getStorageForCapacity(
        bufferSize * channels /** channels */ * 2 /** leave room for one ringbuffer rewind*/, Float32Array
      );

      if (audioEngine === null) {
        audioEngine = new AudioEngine(sharedAudioBuffer, channels, bufferSize, audioContext.sampleRate);
        audioEngine.set_note(36); // C1
        audioEngine.set_amplitude(0.15); // 15%
        audioEngine.start();
        console.log('AudioEngine started');
      } else {
        audioEngine.stop();
        audioEngine.free();
        audioEngine = null;
        console.log('AudioEngine stopped');
      }

      // forwards a SharedArrayBuffer's audio signal via RingBuffer to the AudioContext.destination
      // this allows for a lock-free, wait-free, and zero-copy audio signal forwarding
      const signalForwarderNode = new AudioWorkletNode(audioContext, 'signal-forwarder', {
        outputChannelCount: [channels],
        processorOptions: {
          sharedAudioBuffer,
        },
      });

      // forward the signal to the AudioContext.destination (speakers)
      signalForwarderNode.connect(audioContext.destination);
    
    } catch (error) {
      console.error('Failed to load AudioWorklet module', error);
      return;
    }
  });

  const primarySlider: HTMLInputElement = document.getElementById('freq') as HTMLInputElement;
  primarySlider.addEventListener('input', (event) => {
    const value = Number.parseFloat((event.target as HTMLInputElement).value);
    if (audioEngine) {
      audioEngine.set_note(value);
      console.log(`MIDI note set to: ${value}`);
    }
  });

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