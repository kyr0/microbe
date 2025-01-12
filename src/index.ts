import init, { initThreadPool, FmOsc } from '../pkg/microbe';

console.log('Is crossOriginIsolated enabled?', self.crossOriginIsolated);

async function main() {
  let fm: FmOsc|null = null;

  // Regular wasm-bindgen initialization.
  await init();

  // Thread pool initialization with the given number of threads
  // (pass `navigator.hardwareConcurrency` if you want to use all cores).
  await initThreadPool(navigator.hardwareConcurrency);

  console.log('WebAssembly module loaded');

  console.log("hardware concurrency", navigator.hardwareConcurrency) // e.g. 8 hyperthreads

  document.querySelector('button')!.addEventListener('click', () => {

     if (fm === null) {
        fm = new FmOsc();
        fm.set_note(50);
        fm.set_fm_frequency(0);
        fm.set_fm_amount(0);
        fm.set_gain(0.8);
      } else {
        fm.free();
        fm = null;
      }
  });


  const primary_slider: HTMLInputElement = document.getElementById("primary_input") as HTMLInputElement;
    primary_slider.addEventListener("input", event => {
      if (fm) {
        fm.set_note(Number.parseInt(event.target?.value));
      }
    });

    const fm_freq: HTMLInputElement = document.getElementById("fm_freq") as HTMLInputElement;
    fm_freq.addEventListener("input", event => {
      if (fm) {
        fm.set_fm_frequency(Number.parseFloat(event.target?.value));
      }
    });

    const fm_amount: HTMLInputElement = document.getElementById("fm_amount") as HTMLInputElement; 
    fm_amount.addEventListener("input", event => {
      if (fm) {
        fm.set_fm_amount(Number.parseFloat(event.target?.value!));
      }
    });
}

main().catch(console.error);