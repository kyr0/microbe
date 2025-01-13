import type { RingBuffer } from "./ringbuf";

/**
 * Send parameter changes, lock free, no gc, between a UI thread (browser
 * main thread or worker) and a real-time thread (in an AudioWorkletProcessor).
 * Write and Reader cannot change roles after setup, unless externally
 * synchronized.
 *
 * GC _can_ happen during the initial construction of this object when hopefully
 * no audio is being output. This depends on the implementation.
 *
 * Parameter changes are like in the VST framework: an index and a float value
 * (no restriction on the value).
 *
 * This class supports up to 256 parameters, but this is easy to extend if
 * needed.
 *
 * An element is an index, that is an unsigned byte, and a float32, which is 4
 * bytes.
 */
export class ParameterWriter {
  private ringbuf: RingBuffer;
  private mem: ArrayBuffer;
  private array: Uint8Array;
  private view: DataView;

  /**
   * From a RingBuffer, build an object that can enqueue a parameter change in
   * the queue.
   * @constructor
   * @param ringbuf A RingBuffer object of Uint8Array.
   */
  constructor(ringbuf: RingBuffer) {
    if (ringbuf.type() !== "Uint8Array") {
      throw new TypeError("This class requires a ring buffer of Uint8Array");
    }
    const SIZE_ELEMENT = 5;
    this.ringbuf = ringbuf;
    this.mem = new ArrayBuffer(SIZE_ELEMENT);
    this.array = new Uint8Array(this.mem);
    this.view = new DataView(this.mem);
  }

  /**
   * Enqueue a parameter change for parameter of index `index`, with a new value
   * of `value`.
   *
   * @param index The index of the parameter.
   * @param value The value of the parameter.
   * @return True if enqueuing succeeded, false otherwise.
   */
  enqueue_change(index: number, value: number): boolean {
    const SIZE_ELEMENT = 5;
    if (this.ringbuf.availableWrite() < SIZE_ELEMENT) {
      return false;
    }
    this.view.setUint8(0, index);
    this.view.setFloat32(1, value, true); // Explicit little-endian for consistency
    return this.ringbuf.push(this.array, SIZE_ELEMENT, 0) === SIZE_ELEMENT;
  }
}

/**
 * Receive parameter changes, lock free, no gc, between a UI thread (browser
 * main thread or worker) and a real-time thread (in an AudioWorkletProcessor).
 * Write and Reader cannot change roles after setup, unless externally
 * synchronized.
 *
 * GC _can_ happen during the initial construction of this object when hopefully
 * no audio is being output. This depends on the implementation.
 *
 * Parameter changes are like in the VST framework: an index and a float value
 * (no restriction on the value).
 *
 * This class supports up to 256 parameters, but this is easy to extend if
 * needed.
 *
 * An element is an index, that is an unsigned byte, and a float32, which is 4
 * bytes.
 */
export class ParameterReader {
  private ringbuf: RingBuffer;
  private mem: ArrayBuffer;
  private array: Uint8Array;
  private view: DataView;

  /**
   * @constructor
   * @param ringbuf A RingBuffer setup to hold Uint8.
   */
  constructor(ringbuf: RingBuffer) {
    const SIZE_ELEMENT = 5;
    this.ringbuf = ringbuf;
    this.mem = new ArrayBuffer(SIZE_ELEMENT);
    this.array = new Uint8Array(this.mem);
    this.view = new DataView(this.mem);
  }

  /**
   * Attempt to dequeue a single parameter change.
   * @param o An object with two attributes: `index` and `value`.
   * @return true if a parameter change has been dequeued, false otherwise.
   */
  dequeue_change(o: { index: number; value: number }): boolean {
    const SIZE_ELEMENT = 5;

    if (this.ringbuf.empty()) {
      return false;
    }

    const rv = this.ringbuf.pop(this.array, SIZE_ELEMENT, 0);
    if (rv !== SIZE_ELEMENT) {
      return false;
    }

    // Optimized direct access without intermediate variables
    o.index = this.view.getUint8(0);
    o.value = this.view.getFloat32(1, true); // Explicit little-endian

    return true;
  }
}
