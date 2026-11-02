export class MouseFluid {
  constructor(renderer) {
    this.renderer = renderer;
    this.pipeline = renderer.pipeline;
    this.pairs = {};
    this.last = null;
    this.lastSplat = -Infinity;
    this.previousPoint = [0, 0];
    this.canRender = 0;
    for (const [name, size, linear] of [['velocity', 256, true], ['density', 512, true], ['pressure', 256, false]]) {
      this.pairs[name] = [0, 1].map(i => this.pipeline.target('fluid-' + name + i, size, size, 1, false, 'float16', linear));
    }
    this.curl = this.pipeline.target('fluid-curl', 256, 256, 1, false, 'float16', false);
    this.divergence = this.pipeline.target('fluid-divergence', 256, 256, 1, false, 'float16', false);
  }

  get velocity() { return this.pairs.velocity[0].textures[0]; }
  get mask() { return this.output?.textures[0] ?? this.renderer.empty; }
  swap(name) { this.pairs[name].reverse(); }
  write(id, name, values, textures) {
    this.pipeline.pass(id, this.pairs[name][1], values, textures);
    this.swap(name);
  }

  input(mouse, now) {
    const current = [mouse[0], mouse[1]];
    if (this.last) {
      const dx = current[0] - this.last[0], dy = current[1] - this.last[1], length = Math.hypot(dx, dy);
      if (length > .01) {
        const radius = Math.min(1, length / 5) * 60 * .6;
        const force = Math.min(1, length / 15) * 10;
        const point = [current[0] / innerWidth, 1 - current[1] / innerHeight];
        const prevPoint = now - this.lastSplat > 50 ? point : this.previousPoint;
        const settings = { point, prevPoint, radius: radius / 200, aspectRatio: innerWidth / innerHeight, canRender: this.canRender, uAdd: 1 };
        this.write('fluid-splat', 'velocity', { ...settings, color: [dx * force, -dy * force, 1] }, { uTarget: this.velocity });
        this.write('fluid-splat', 'density', { ...settings, color: [1, 1, 1] }, { uTarget: this.pairs.density[0].textures[0] });
        this.canRender = 1; this.previousPoint = point; this.lastSplat = now;
      }
    }
    this.last = current;
  }

  update(dt) {
    const p = this.pipeline, texelSize = [1 / 256, 1 / 256];
    p.pass('fluid-curl', this.curl, { texelSize }, { uVelocity: this.velocity });
    this.write('fluid-vorticity', 'velocity', { texelSize, curl: 30, dt: dt / 1000 }, { uVelocity: this.velocity, uCurl: this.curl.textures[0] });
    p.pass('fluid-divergence', this.divergence, { texelSize }, { uVelocity: this.velocity });
    this.write('fluid-clear', 'pressure', { value: Math.pow(.8, dt / (1000 / 60)) }, { uTexture: this.pairs.pressure[0].textures[0] });
    for (let i = 0; i < 5; i++) this.write('fluid-pressure', 'pressure', { texelSize }, { uPressure: this.pairs.pressure[0].textures[0], uDivergence: this.divergence.textures[0] });
    this.write('fluid-gradientSubtract', 'velocity', { texelSize }, { uPressure: this.pairs.pressure[0].textures[0], uVelocity: this.velocity });
    this.write('fluid-advection', 'velocity', { texelSize, dt: dt / 1000, dissipation: Math.pow(.98, dt / (1000 / 60)) }, { uVelocity: this.velocity, uSource: this.velocity });
    this.write('fluid-advection', 'density', { texelSize: [1 / 512, 1 / 512], dt: dt / 1000, dissipation: Math.pow(.97, dt / (1000 / 60)) }, { uVelocity: this.velocity, uSource: this.pairs.density[0].textures[0] });
    this.output = p.target('fluid-display', innerWidth, innerHeight);
    p.pass('fluid-display', this.output, { texelSize: [1 / innerWidth, 1 / innerHeight] }, { uTexture: this.pairs.density[0].textures[0] });
  }
}

export class PointCloudSimulation {
  constructor(renderer, positions, textureId=12, pointCloud=null) {
    this.renderer = renderer;
    this.textureId=textureId;this.ownsPointCloud=!pointCloud;
    this.pointCloud = pointCloud??renderer.uploadTexture(new Float32Array(positions), 1024, 1024, true, 3);
    const size=renderer.data.textures[textureId];
    const mesh=renderer.data.scenes.flatMap(scene=>scene.meshes).find(mesh=>renderer.data.materials[mesh.material].uniforms.tPos?.value?.texture===textureId);
    const position=mesh?renderer.data.geometries[mesh.geometry].attributes.position:null;
    this.count=position?(renderer.data.buffers[position.buffer].generated?.populated??position.count):size.width*size.height;
    this.mouseStrength=textureId===29?1:100;
    this.pair = [0, 1].map(i => renderer.pipeline.target('point-simulation-'+textureId+'-' + i, size.width, size.height, 1, false, 'float32', false));
    renderer.pipeline.pass('copy', this.pair[0], {}, { tMap: renderer.textures[textureId] });
    this.current = this.pair[0].textures[0];
  }

  update(dt, camera, model, fluid) {
    this.renderer.pipeline.pass('home-particles-simulation', this.pair[1], {
      HZ: dt / (1000 / 60),fSize:this.pair[0].width,uMaxCount:this.count,uMouseStrength:this.mouseStrength, uProjMatrix: camera.projection.multiply(camera.view).toFloat32Array(),
      uProjNormalMatrix: camera.world.toFloat32Array(), uModelMatrix: model,
    }, { tInput: this.current, tPointCloud: this.pointCloud, tFluid: fluid.velocity, tFluidMask: fluid.mask });
    this.pair.reverse(); this.current = this.pair[0].textures[0];
    this.renderer.textures[this.textureId] = this.current;
  }

  dispose() { if(this.ownsPointCloud)this.renderer.releaseTexture(this.pointCloud); }
}
