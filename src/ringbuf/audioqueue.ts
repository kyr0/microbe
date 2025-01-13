import type { RingBuffer } from "./ringbuf.ts";

/**
 * Interleaved -> Planar audio buffer conversion
 *
 * This is useful to get data from a codec, the network, or anything that is
 * interleaved, into a planar format, for example a Web Audio API AudioBuffer or
 * the output parameter of an AudioWorkletProcessor.
 *
 * @param input is an array of n*128 frames arrays, interleaved,
 * where n is the channel count.
 * @param output is an array of 128-frames arrays.
 */
export function deinterleave(input: Float32Array, output: Float32Array[]): void {
  const channel_count = input.length / 128;
  if (output.length !== channel_count) {
    throw new RangeError(
      `not enough space in output arrays ${output.length} != ${channel_count}`,
    );
  }

  for (let i = 0; i < channel_count; i++) {
    const out_channel = output[i];
    let interleaved_idx = i;

    // Unroll the inner loop by processing 4 samples at a time
    for (let j = 0; j < 128; j += 4) {
      out_channel[j] = input[interleaved_idx];
      out_channel[j + 1] = input[interleaved_idx + channel_count];
      out_channel[j + 2] = input[interleaved_idx + 2 * channel_count];
      out_channel[j + 3] = input[interleaved_idx + 3 * channel_count];
      interleaved_idx += 4 * channel_count;
    }
  }
}

/**
 * Planar -> Interleaved audio buffer conversion
 *
 * This function is useful to get data from the Web Audio API (that uses a
 * planar format), into something that a codec or network streaming library
 * would expect.
 *
 * @param input An array of n*128 frames Float32Array that hold the audio data.
 * @param output A Float32Array that is n*128 elements long.
 */
export function interleave(input: Float32Array[], output: Float32Array): void {
  if (input.length * 128 !== output.length) {
    throw new RangeError("input and output of incompatible sizes");
  }

  let out_idx = 0;

  // unroll the outer loop by processing 4 frames at a time
  for (let i = 0; i < 128; i += 4) {
    for (let channel = 0; channel < input.length; channel++) {
      const in_channel = input[channel];
      // process 4 frames at a time to reduce loop overhead
      output[out_idx] = in_channel[i];
      output[out_idx + 1] = in_channel[i + 1];
      output[out_idx + 2] = in_channel[i + 2];
      output[out_idx + 3] = in_channel[i + 3];
      out_idx += 4;
    }
  }
}

/**
 * Send interleaved audio frames to another thread, wait-free.
 *
 * These classes allow communicating between a non-real time thread (browser
 * main thread or worker) and a real-time thread (in an AudioWorkletProcessor).
 * Write and Reader cannot change role after setup, unless externally
 * synchronized.
 *
 * GC _can_ happen during the initial construction of this object when hopefully
 * no audio is being output. This depends on how implementations schedule GC
 * passes. After the setup phase no GC is triggered on either side of the queue.
 */
export class AudioWriter {
  private ringbuf: RingBuffer;

  /**
   * From a RingBuffer, build an object that can enqueue enqueue audio in a ring
   * buffer.
   * @constructor
   */
  constructor(ringbuf: RingBuffer) {
    if (ringbuf.type() !== "Float32Array") {
      throw new TypeError("This class requires a ring buffer of Float32Array");
    }
    this.ringbuf = ringbuf;
  }

  /**
   * Enqueue a buffer of interleaved audio into the ring buffer.
   *
   * Care should be taken to enqueue a number of samples that is a multiple of the
   * channel count of the audio stream.
   *
   * @param buf An array of interleaved audio frames.
   *
   * @return The number of samples that have been successfully written to the
   * queue. `buf` is not written to during this call, so the samples that
   * haven't been written to the queue are still available.
   */
  enqueue(buf: Float32Array): number {
    return this.ringbuf.push(buf);
  }

  /**
   * @return The free space in the ring buffer. This is the amount of samples
   * that can be queued, with a guarantee of success.
   */
  availableWrite(): number {
    return this.ringbuf.availableWrite();
  }
}

/**
 * Receive interleaved audio frames to another thread, wait-free.
 *
 * GC _can_ happen during the initial construction of this object when hopefully
 * no audio is being output. This depends on how implementations schedule GC
 * passes. After the setup phase no GC is triggered on either side of the queue.
 */
export class AudioReader {
  private ringbuf: RingBuffer;

  /**
   * From a RingBuffer, build an object that can dequeue audio in a ring
   * buffer.
   * @constructor
   */
  constructor(ringbuf: RingBuffer) {
    if (ringbuf.type() !== "Float32Array") {
      throw new TypeError("This class requires a ring buffer of Float32Array");
    }
    this.ringbuf = ringbuf;
  }

  /**
   * Attempt to dequeue at most `buf.length` samples from the queue. This
   * returns the number of samples dequeued. If greater than 0, the samples are
   * at the beginning of `buf`.
   *
   * Care should be taken to dequeue a number of samples that is a multiple of the
   * channel count of the audio stream.
   *
   * @param buf A buffer in which to copy the dequeued
   * interleaved audio frames.
   * @return The number of samples dequeued.
   */
  dequeue(buf: Float32Array): number {
    if (this.ringbuf.empty()) {
      return 0;
    }
    return this.ringbuf.pop(buf);
  }

  /**
   * Query the occupied space in the queue.
   *
   * @return The amount of samples that can be read with a guarantee of success.
   */
  availableRead(): number {
    return this.ringbuf.availableRead();
  }
}
