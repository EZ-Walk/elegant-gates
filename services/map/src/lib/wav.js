/**
 * Build a mono 16-bit PCM WAV blob from Float32 samples in range [-1, 1].
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @returns {Blob}
 */
export function encodeWav(samples, sampleRate) {
  const n = samples.length;
  const int16 = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytesPerSample = 2;
  const dataSize = n * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < n; i++, offset += 2) {
    view.setInt16(offset, int16[i], true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function writeAscii(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * Linear resample to target rate (for Whisper-friendly 16 kHz export).
 * @param {Float32Array} input
 * @param {number} inputRate
 * @param {number} outputRate
 * @returns {Float32Array}
 */
export function resampleLinear(input, inputRate, outputRate) {
  if (inputRate === outputRate || input.length === 0) {
    return input.slice();
  }
  const ratio = inputRate / outputRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const frac = src - i0;
    const s0 = input[i0] ?? 0;
    const s1 = input[Math.min(i0 + 1, input.length - 1)] ?? s0;
    out[i] = s0 + frac * (s1 - s0);
  }
  return out;
}

export function rmsMono(input, numChannels) {
  if (numChannels === 1) {
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    return Math.sqrt(sum / input.length);
  }
  const frames = input.length / numChannels;
  if (frames <= 0) return 0;
  let sum = 0;
  for (let f = 0; f < frames; f++) {
    let acc = 0;
    for (let c = 0; c < numChannels; c++) {
      const v = input[f * numChannels + c];
      acc += v * v;
    }
    sum += acc / numChannels;
  }
  return Math.sqrt(sum / frames);
}
