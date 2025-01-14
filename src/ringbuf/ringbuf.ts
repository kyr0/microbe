import type { TypedArray, TypedArrayConstructor } from "./types";


/** The base RingBuffer class
 *
 * A Single Producer - Single Consumer thread-safe wait-free ring buffer.
 *
 * The producer and the consumer can be on separate threads, but cannot change roles,
 * except with external synchronization.
 */
export class RingBuffer {
  /** Allocate the SharedArrayBuffer for a RingBuffer, based on the type and
   * capacity required
   * @param {number} capacity The number of elements the ring buffer will be
   * able to hold.
   * @param {TypedArrayConstructor} type A typed array constructor, the type that this ring
   * buffer will hold.
   * @return {SharedArrayBuffer} A SharedArrayBuffer of the right size.
   * @static
   */
  static getStorageForCapacity(capacity: number, type: TypedArrayConstructor ): SharedArrayBuffer {
    if (!type.BYTES_PER_ELEMENT) {
      throw TypeError("Pass in an ArrayBuffer subclass");
    }
    const bytes = 8 + (capacity + 1) * type.BYTES_PER_ELEMENT;
    return new SharedArrayBuffer(bytes);
  }

  private _type: TypedArrayConstructor;
  private _capacity: number;
  private buf: SharedArrayBuffer;
  private write_ptr: Uint32Array;
  private read_ptr: Uint32Array;
  private storage: TypedArray;

  /**
   * @constructor
   * @param {SharedArrayBuffer} sab A SharedArrayBuffer obtained by calling
   * {@link RingBuffer.getStorageFromCapacity}.
   * @param {TypedArray} type A typed array constructor, the type that this ring
   * buffer will hold.
   */
  constructor(sab: SharedArrayBuffer, type: TypedArrayConstructor) {
    if (type.BYTES_PER_ELEMENT === undefined) {
      throw TypeError("Pass a concrete typed array class as second argument");
    }

    // Maximum usable size is 1<<32 - type.BYTES_PER_ELEMENT bytes in the ring
    // buffer for this version, easily changeable.
    // -4 for the write ptr (uint32_t offsets)
    // -4 for the read ptr (uint32_t offsets)
    // capacity counts the empty slot to distinguish between full and empty.
    this._type = type;
    this._capacity = (sab.byteLength - 8) / type.BYTES_PER_ELEMENT;
    this.buf = sab;
    this.write_ptr = new Uint32Array(this.buf, 0, 1);
    this.read_ptr = new Uint32Array(this.buf, 4, 1);
    this.storage = new type(this.buf, 8, this._capacity);
  }

  /**
   * @return the type of the underlying ArrayBuffer for this RingBuffer. This
   * allows implementing crude type checking.
   */
  type(): string {
    return this._type.name;
  }

  /**
   * Push elements to the ring buffer.
   * @param {TypedArray} elements A typed array of the same type as passed in the ctor, to be written to the queue.
   * @param {Number} length If passed, the maximum number of elements to push.
   * If not passed, all elements in the input array are pushed.
   * @param {Number} offset If passed, a starting index in elements from which
   * the elements are read. If not passed, elements are read from index 0.
   * @return the number of elements written to the queue.
   */
  push(elements: TypedArray, length?: number, offset = 0): number {
    const rd = Atomics.load(this.read_ptr, 0);
    const wr = Atomics.load(this.write_ptr, 0);

    if ((wr + 1) % this._storage_capacity() === rd) {
      return 0; // full
    }

    const len = length !== undefined ? length : elements.length;
    const to_write = Math.min(this._available_write(rd, wr), len);
    const first_part = Math.min(this._storage_capacity() - wr, to_write);
    const second_part = to_write - first_part;

    this._copy(elements, offset, this.storage, wr, first_part);
    this._copy(elements, offset + first_part, this.storage, 0, second_part);

    // publish the enqueued data to the other side
    Atomics.store(this.write_ptr, 0, (wr + to_write) % this._storage_capacity());
    return to_write;
  }

  /**
   * Write bytes to the ring buffer using callbacks. This create wrapper
   * objects and can GC, so it's best to no use this variant from a real-time
   * thread such as an AudioWorklerProcessor `process` method.
   * The callback is passed two typed arrays of the same type, to be filled.
   * This allows skipping copies if the API that produces the data writes is
   * passed arrays to write to, such as `AudioData.copyTo`.
   * @param {number} amount The maximum number of elements to write to the ring
   * buffer. If amount is more than the number of slots available for writing,
   * then the number of slots available for writing will be made available: no
   * overwriting of elements can happen.
   * @param {Function} cb A callback with two parameters, that are two typed
   * array of the correct type, in which the data need to be copied. If the
   * callback doesn't return anything, it is assumed all the elements
   * have been written to. Otherwise, it is assumed that the returned number is
   * the number of elements that have been written to, and those elements have
   * been written started at the beginning of the requested buffer space.
   *
   * @return The number of elements written to the queue.
   */
  writeCallback(amount: number, cb: (storageA: TypedArray, storageB: TypedArray) => number) {
    const rd = Atomics.load(this.read_ptr, 0);
    const wr = Atomics.load(this.write_ptr, 0);

    if ((wr + 1) % this._storage_capacity() === rd) {
      // full
      return 0;
    }

    const to_write = Math.min(this._available_write(rd, wr), amount);
    const first_part = Math.min(this._storage_capacity() - wr, to_write);
    const second_part = to_write - first_part;

    // This part will cause GC: don't use in the real time thread.
    const first_part_buf = new this._type(
      this.storage.buffer,
      8 + wr * this.storage.BYTES_PER_ELEMENT,
      first_part,
    );
    const second_part_buf = new this._type(
      this.storage.buffer,
      8 + 0,
      second_part,
    );

    const written = cb(first_part_buf, second_part_buf) || to_write;

    // publish the enqueued data to the other side
    Atomics.store(this.write_ptr, 0, (wr + written) % this._storage_capacity());

    return written;
  }

  /**
   * Write bytes to the ring buffer using a callback.
   *
   * This allows skipping copies if the API that produces the data writes is
   * passed arrays to write to, such as `AudioData.copyTo`.
   *
   * @param {number} amount The maximum number of elements to write to the ring
   * buffer. If amount is more than the number of slots available for writing,
   * then the number of slots available for writing will be made available: no
   * overwriting of elements can happen.
   * @param {Function} cb A callback with five parameters:
   *
   * (1) The internal storage of the ring buffer as a typed array
   * (2) An offset to start writing from
   * (3) A number of elements to write at this offset
   * (4) Another offset to start writing from
   * (5) A number of elements to write at this second offset
   *
   * If the callback doesn't return anything, it is assumed all the elements
   * have been written to. Otherwise, it is assumed that the returned number is
   * the number of elements that have been written to, and those elements have
   * been written started at the beginning of the requested buffer space.
   * @return The number of elements written to the queue.
   */
  writeCallbackWithOffset(amount: number, cb: (
    storage: TypedArray, 
    offsetStartWritingFrom: number, 
    numElementsToWriteAtOffset: number, 
    offsetStartWritingFromB: number, 
    numElementsToWriteAtOffsetB: number
  ) => number) {
    const rd = Atomics.load(this.read_ptr, 0);
    const wr = Atomics.load(this.write_ptr, 0);

    if ((wr + 1) % this._storage_capacity() === rd) {
      // full
      return 0;
    }

    const to_write = Math.min(this._available_write(rd, wr), amount);
    const first_part = Math.min(this._storage_capacity() - wr, to_write);
    const second_part = to_write - first_part;

    const written =
      cb(this.storage, wr, first_part, 0, second_part) || to_write;

    // publish the enqueued data to the other side
    Atomics.store(this.write_ptr, 0, (wr + written) % this._storage_capacity());

    return written;
  }

  /**
   * Read up to `elements.length` elements from the ring buffer. `elements` is a typed
   * array of the same type as passed in the ctor.
   * Returns the number of elements read from the queue, they are placed at the
   * beginning of the array passed as parameter.
   * @param {TypedArray} elements An array in which the elements read from the
   * queue will be written, starting at the beginning of the array.
   * @param {Number} length If passed, the maximum number of elements to pop. If
   * not passed, up to elements.length are popped.
   * @param {Number} offset If passed, an index in elements in which the data is
   * written to. `elements.length - offset` must be greater or equal to
   * `length`.
   * @return The number of elements read from the queue.
   */
  pop(elements: TypedArray, length?: number, offset = 0): number {
    const rd = Atomics.load(this.read_ptr, 0);
    const wr = Atomics.load(this.write_ptr, 0);

    if (wr === rd) {
      return 0; // empty
    }

    const len = length !== undefined ? length : elements.length;
    const to_read = Math.min(this._available_read(rd, wr), len);

    const first_part = Math.min(this._storage_capacity() - rd, to_read);
    const second_part = to_read - first_part;

    this._copy(this.storage, rd, elements, offset, first_part);
    this._copy(this.storage, 0, elements, offset + first_part, second_part);

    Atomics.store(this.read_ptr, 0, (rd + to_read) % this._storage_capacity());
    return to_read;
  }

  /**
   * @return True if the ring buffer is empty false otherwise. This can be late
   * on the reader side: it can return true even if something has just been
   * pushed.
   */
  empty(): boolean {
    const rd = Atomics.load(this.read_ptr, 0);
    const wr = Atomics.load(this.write_ptr, 0);
    return wr === rd;
  }

  /**
   * @return True if the ring buffer is full, false otherwise. This can be late
   * on the write side: it can return true when something has just been popped.
   */
  full(): boolean {
    const rd = Atomics.load(this.read_ptr, 0);
    const wr = Atomics.load(this.write_ptr, 0);
    return (wr + 1) % this._storage_capacity() === rd;
  }

  /**
   * @return The usable capacity for the ring buffer: the number of elements
   * that can be stored.
   */
  capacity(): number {
    return this._capacity - 1;
  }

  /**
   * @return The number of elements available for reading. This can be late, and
   * report less elements that is actually in the queue, when something has just
   * been enqueued.
   */
  availableRead(): number {
    const rd = Atomics.load(this.read_ptr, 0);
    const wr = Atomics.load(this.write_ptr, 0);
    return this._available_read(rd, wr);
  }

 /**
   * @return The number of elements available for writing. This can be late, and
   * report less elements that is actually available for writing, when something
   * has just been dequeued.
   */
  availableWrite(): number {
    const rd = Atomics.load(this.read_ptr, 0);
    const wr = Atomics.load(this.write_ptr, 0);
    return this._available_write(rd, wr);
  }

  // private methods //

  /**
   * @return Number of elements available for reading, given a read and write
   * pointer.
   * @private
   */
  private _available_read(rd: number, wr: number): number {
    return (wr + this._storage_capacity() - rd) % this._storage_capacity();
  }

  /**
   * @return Number of elements available from writing, given a read and write
   * pointer.
   * @private
   */
  private _available_write(rd: number, wr: number): number {
    return this.capacity() - this._available_read(rd, wr);
  }

  /**
   * @return The size of the storage for elements not accounting the space for
   * the index, counting the empty slot.
   * @private
   */
  private _storage_capacity(): number {
    return this._capacity;
  }

  /**
   * Copy `size` elements from `input`, starting at offset `offset_input`, to
   * `output`, starting at offset `offset_output`.
   * @param {TypedArray} input The array to copy from
   * @param {Number} offset_input The index at which to start the copy
   * @param {TypedArray} output The array to copy to
   * @param {Number} offset_output The index at which to start copying the elements to
   * @param {Number} size The number of elements to copy
   * @private
   */
  private _copy(
    input: TypedArray,
    offset_input: number,
    output: TypedArray,
    offset_output: number,
    size: number
  ): void {

    if (!size) {
      return;
    }
    // Fast-path: use `set(...)` if possible: copying all the input linearly to the output.
    if (
      offset_input === 0 &&
      offset_output + input.length <= this._storage_capacity() &&
      input.length === size
    ) {
      output.set(input, offset_output);
      return;
    }

    // Slow path: copy element by element, but at least JIT-optimized.
    let i = 0;
    const unrollFactor = 16;

    // unroll the loop for better performance; best unroll factor in 2025 for this is 16
    // across all engines: https://github.com/padenot/ringbuf.js/issues/22#issuecomment-2590990421
    for (; i <= size - unrollFactor; i += unrollFactor) {
      output[offset_output + i] = input[offset_input + i];
      output[offset_output + i + 1] = input[offset_input + i + 1];
      output[offset_output + i + 2] = input[offset_input + i + 2];
      output[offset_output + i + 3] = input[offset_input + i + 3];
      output[offset_output + i + 4] = input[offset_input + i + 4];
      output[offset_output + i + 5] = input[offset_input + i + 5];
      output[offset_output + i + 6] = input[offset_input + i + 6];
      output[offset_output + i + 7] = input[offset_input + i + 7];
      output[offset_output + i + 8] = input[offset_input + i + 8];
      output[offset_output + i + 9] = input[offset_input + i + 9];
      output[offset_output + i + 10] = input[offset_input + i + 10];
      output[offset_output + i + 11] = input[offset_input + i + 11];
      output[offset_output + i + 12] = input[offset_input + i + 12];
      output[offset_output + i + 13] = input[offset_input + i + 13];
      output[offset_output + i + 14] = input[offset_input + i + 14];
      output[offset_output + i + 15] = input[offset_input + i + 15];
    }

    // remaining elements for when the size is not a multiple of unrollFactor
    for (; i < size; i++) {
      output[offset_output + i] = input[offset_input + i];
    }
  }
}

// shortcut
export const getStorageForCapacity = RingBuffer.getStorageForCapacity;