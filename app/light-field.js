export class SceneLighting {
  constructor(renderer, metadata, binary) {
    this.renderer = renderer;
    this.metadata = metadata;
    this.frames = new Uint8Array(binary);
    this.stride = metadata.width * metadata.height * 4;
    if (this.frames.length !== metadata.bytes) throw Error('Illumination field size mismatch');
    this.pixels = new Uint8Array(this.stride);
    this.texture = renderer.uploadTexture(this.pixels, metadata.width, metadata.height, false);
    const gl = renderer.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.started = performance.now();
  }

  update(now) {
    const { times, duration, width, height } = this.metadata;
    const time = ((now - this.started) / 1000) % duration;
    let low = 0, high = times.length - 1;
    while (low < high) { const mid = Math.ceil((low + high) / 2); if (times[mid] <= time) low = mid; else high = mid - 1; }
    const next = Math.min(low + 1, times.length - 1);
    const t = next === low ? 0 : Math.min(1, (time - times[low]) / (times[next] - times[low]));
    const a = low * this.stride, b = next * this.stride, row = width * 4;
    for (let y = 0; y < height; y++) for (let x = 0; x < row; x++) {
      const offset = y * row + x;
      this.pixels[(height - y - 1) * row + x] = Math.round(this.frames[a + offset] * (1 - t) + this.frames[b + offset] * t);
    }
    const gl = this.renderer.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);
  }

  dispose() { this.renderer.releaseTexture(this.texture); }
}
