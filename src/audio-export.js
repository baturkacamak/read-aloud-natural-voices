/** Offline tempo conversion. Each paragraph is decoded and encoded independently
 * to bound memory. Normal-speed MP3 passes through without recompression. */
(() => {
  if (globalThis.SesliOkuAudioExport) return;
  async function encodeTempo(buffer, tempo, canceled = () => false) {
    const {SoundTouch, SimpleFilter} = globalThis.SesliOkuAudioCodecs;
    const pipe = new SoundTouch();
    pipe.stretch.setParameters(buffer.sampleRate, 0, 0, 0);
    pipe.tempo = tempo;
    const left = buffer.getChannelData(0);
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
    // Silence drains the algorithm's lookahead; output is trimmed to the target duration.
    const source = {extract(target, frames, position) {
      const count = Math.max(0, Math.min(frames, buffer.length + 32768 - position));
      for (let i = 0; i < count; i++) {
        target[2*i] = left[position+i] || 0;
        target[2*i+1] = right[position+i] || 0;
      }
      return count;
    }};
    const filter = new SimpleFilter(source, pipe);
    const channels = Math.min(2, buffer.numberOfChannels);
    const encoder = new globalThis.SesliOkuMp3Encoder(channels, buffer.sampleRate, 128);
    const targetFrames = Math.round(buffer.length / tempo);
    const samples = new Float32Array(1152 * 2);
    const parts = [];
    let written = 0;
    while (written < targetFrames) {
      if (canceled()) throw new DOMException('Canceled', 'AbortError');
      const count = filter.extract(samples, Math.min(1152, targetFrames-written));
      if (!count) throw new Error('Audio tempo conversion ended prematurely');
      const l = new Int16Array(count); const r = channels === 2 ? new Int16Array(count) : null;
      for (let i=0;i<count;i++) {
        l[i] = Math.round(Math.max(-1,Math.min(1,samples[2*i])) * 32767);
        if(r) r[i] = Math.round(Math.max(-1,Math.min(1,samples[2*i+1])) * 32767);
      }
      const encoded = encoder.encodeBuffer(l, r);
      if(encoded.length) parts.push(new Uint8Array(encoded));
      written += count;
      if (written % (1152*16) === 0) await new Promise(resolve=>setTimeout(resolve,0));
    }
    const tail = encoder.flush(); if(tail.length) parts.push(new Uint8Array(tail));
    return new Uint8Array(await new Blob(parts).arrayBuffer());
  }
  async function convert(audio, tempo, canceled) {
    if(tempo === 1) return audio;
    const context = new OfflineAudioContext(1, 1, 44100);
    const buffer = await context.decodeAudioData(audio.slice().buffer);
    return encodeTempo(buffer, tempo, canceled);
  }
  globalThis.SesliOkuAudioExport = {convert, encodeTempo};
})();
