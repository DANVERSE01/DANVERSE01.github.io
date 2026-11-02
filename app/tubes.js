export class TubeSimulation {
  constructor(renderer) {
    this.renderer = renderer;
    const p = renderer.pipeline;
    this.life = [0, 1].map(i => p.target('tube-life-' + i, 128, 128, 1, false, 'float32', false));
    this.positions = [0, 1].map(i => p.target('tube-position-' + i, 128, 128, 1, false, 'float32', false));
    p.pass('copy', this.life[0], {}, { tMap: renderer.textures[6] });
    p.pass('copy', this.positions[0], {}, { tMap: renderer.textures[8] });
    this.spawn = new Float32Array(16384 * 4);
    this.velocity = new Float32Array(16384 * 3);
    this.colors = new Float32Array(16384 * 3);
    this.indices = new Float32Array(16384 * 4);
    for (let i = 0; i < 16384; i++) this.indices.set([i % 12, Math.floor(i / 12), i % 12 === 0 ? 1 : 0, 1], i * 4);
    this.spawnTexture = renderer.uploadTexture(this.spawn, 128, 128, true);
    this.velocityTexture = renderer.uploadTexture(this.velocity, 128, 128, true, 3);
    this.colorTexture = renderer.uploadTexture(this.colors, 128, 128, true, 3);
    this.indexTexture = renderer.uploadTexture(this.indices, 128, 128, true);
    const colorRecord = renderer.data.auxiliary.records.find(x => x.id === 10);
    const source = new Float32Array(renderer.auxiliary, colorRecord.offset, colorRecord.bytes / 4);
    this.color = renderer.settings.tubeColor;
    for (let i = 0; i < source.length; i += 3) if (source[i] + source[i + 1] + source[i + 2] > .1) { this.color = Array.from(source.slice(i, i + 3)); break; }
    const randomRecord = renderer.data.auxiliary.records.find(x => x.id === 7);
    this.random = new Float32Array(renderer.auxiliary, randomRecord.offset, randomRecord.bytes / 4);
    this.index = -1; this.randomIndex = 0; this.emitted = 0; this.lastCheck = -Infinity;
  }

  jitter() { return Math.round((this.random[this.randomIndex++ % this.random.length] * 2 - 1) * 10000) / 10000 * .3; }

  position(camera, pointer) {
    const projected = new DOMPoint(pointer[0], pointer[1], .5, 1).matrixTransform(camera.projection.inverse());
    const world = new DOMPoint(projected.x / projected.w, projected.y / projected.w, projected.z / projected.w).matrixTransform(camera.world);
    const cameraPosition = [camera.world.m41, camera.world.m42, camera.world.m43];
    const direction = [world.x - cameraPosition[0], world.y - cameraPosition[1], world.z - cameraPosition[2]], length = Math.hypot(...direction);
    return direction.map((v, i) => cameraPosition[i] + v / length * 40);
  }

  update(dt, now, camera, pointer) {
    const r = this.renderer, gl = r.gl, p = r.pipeline, position = this.position(camera, pointer);
    const last = this.lastPosition ?? position;
    const velocity = position.map((v, i) => v - last[i]), speed = Math.hypot(...velocity);
    this.lastPosition = position;
    if (!this.lastEmission) this.lastEmission = position;
    const distance = Math.hypot(...position.map((v, i) => v - this.lastEmission[i]));
    if (now - this.lastCheck >= 1000 / 60) {
      this.lastCheck = now;
      if (distance >= .5) {
        const start = position.map(v => v + this.jitter());
        for (let i = 0; i < 12; i++) {
          const index = ++this.index;
          if (index >= 16384) { this.index = -1; continue; }
          this.spawn.set([1, ...start], index * 4);
          this.velocity.set(velocity.map(v => speed > 0 ? v / speed * .4 : 0), index * 3);
          this.colors.set(this.color, index * 3);
        }
        this.lastEmission = position; this.emitted++;
      }
    }
    for (const [texture, data, channels] of [[this.spawnTexture, this.spawn, 4], [this.velocityTexture, this.velocity, 3], [this.colorTexture, this.colors, 3]]) {
      gl.bindTexture(gl.TEXTURE_2D, texture); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 128, 128, channels === 3 ? gl.RGB : gl.RGBA, gl.FLOAT, data);
    }
    p.pass('tube-spawn', this.life[1], { HZ: dt / (1000 / 60), uSetup: 0 }, { tInput: this.life[0].textures[0], tLife: this.spawnTexture, tAttribs: r.textures[7] });
    this.life.reverse();
    p.pass('tube-simulation', this.positions[1], { HZ: dt / (1000 / 60) }, { tInput: this.positions[0].textures[0], tSpawn: this.life[0].textures[0], tAttribs: r.textures[7], tIndices: this.indexTexture, tVelocity: this.velocityTexture, tColor: this.colorTexture });
    this.positions.reverse();
    for (let i = 0; i <= this.index; i++) this.spawn[i * 4] = 0;
    r.textures[6] = this.life[0].textures[0]; r.textures[8] = this.positions[0].textures[0]; r.textures[10] = this.colorTexture; r.textures[11] = this.velocityTexture;
  }

  dispose() { for (const texture of [this.spawnTexture, this.velocityTexture, this.colorTexture, this.indexTexture]) this.renderer.releaseTexture(texture); }
}
