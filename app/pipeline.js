import { renderWaterReflection } from './mirror.js';

export class RenderPipeline {
  constructor(renderer) {
    this.renderer = renderer;
    this.targets = new Map();
  }

  target(name, width, height, attachments = 1, depth = false, format = 'byte', linear = true) {
    width = Math.max(1, Math.round(width));
    height = Math.max(1, Math.round(height));
    const existing = this.targets.get(name);
    if (existing?.width === width && existing.height === height) return existing;
    if (existing) this.release(existing);
    const gl = this.renderer.gl;
    const result = { name, width, height, framebuffer: gl.createFramebuffer(), textures: [] };
    gl.bindFramebuffer(gl.FRAMEBUFFER, result.framebuffer);
    for (let i = 0; i < attachments; i++) {
      const texture = this.renderer.uploadTexture(null, width, height, format === 'float32');
      if (format === 'float16') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, linear ? gl.LINEAR : gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, texture, 0);
      result.textures.push(texture);
    }
    if (depth) {
      result.depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, result.depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, result.depth);
    }
    gl.drawBuffers(result.textures.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error('Incomplete target: ' + name);
    this.targets.set(name, result);
    this.bind(result, true);
    return result;
  }

  bind(target, clear = false) {
    const gl = this.renderer.gl;
    this.bound=target;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
    gl.drawBuffers(target?target.textures.map((_,i)=>gl.COLOR_ATTACHMENT0+i):[gl.BACK]);
    gl.viewport(0, 0, target?.width ?? this.renderer.canvas.width, target?.height ?? this.renderer.canvas.height);
    this.renderer.setResolution(target?.width??this.renderer.canvas.width,target?.height??this.renderer.canvas.height);
    if (clear) {
      gl.depthMask(true);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }
  }

  pass(id, destination, uniforms = {}, textures = {}) {
    this.bind(destination);
    this.renderer.fullscreen(id, uniforms, textures);
    return destination?.textures[0];
  }

  scene(source, camera, overrides, suffix = 'main') {
    const r = this.renderer, width = Math.floor(innerWidth*r.settings.sceneDPR), height = Math.floor(innerHeight*r.settings.sceneDPR);
    if(source.name==='TreeScene')renderWaterReflection(r,source,camera,overrides);
    const geometry = this.target(suffix + '-geometry', width, height, 3, true);
    const snapshot = this.target(suffix + '-snapshot', width, height);
    this.bind(geometry, true);
    r.drawScene(source, camera, overrides, snapshot.textures[0]);
    this.pass('copy', snapshot, {}, { tMap: geometry.textures[1] });

    const composite=source.passes[0]?.material;
    const output=this.target(suffix+'-scene',width,height);
    if(!['Home','CleanRoom','Footer'].includes(source.name)){
      const detail=source.name==='Work'&&r.workDetail.index!==null?r.workDetail.render(r.previousTime):null;
      r.updateGlobals(camera);
      if(composite!=null&&r.program(composite))this.pass(composite,output,detail?{uTransition:r.workDetail.mix}:{}, {tDiffuse:geometry.textures[0],...(detail?{tDetail:detail}:{})});else this.pass('copy',output,{}, {tMap:geometry.textures[0]});
      return output.textures[0];
    }

    const volumeDPR={Home:.2,CleanRoom:.4,Footer:1}[source.name];
    const volume1 = this.target(suffix + '-volume-x', innerWidth * volumeDPR, innerHeight * volumeDPR);
    const volume2 = this.target(suffix + '-volume-y', volume1.width, volume1.height);
    const volume = this.target(suffix + '-volume', volume1.width, volume1.height);
    this.pass('volume-blur', volume1, { uDir: [1.5*volumeDPR, 0] }, { tDiffuse: geometry.textures[source.name==='CleanRoom'?1:2] });
    this.pass('volume-blur', volume2, { uDir: [0, 1.5*volumeDPR] }, { tDiffuse: volume1.textures[0] });
    const logo = source.meshes.find(m => source.name==='CleanRoom'?m.material===41:r.data.materials[m.material].fragmentName === 'HomeLogoShader');
    const point = logo ? new DOMPoint(0, 0, 0).matrixTransform(new DOMMatrix(overrides.world?.get(logo.id) ?? logo.world)).matrixTransform(camera.view).matrixTransform(camera.projection) : { x: 0, y: 0, w: 1 };
    this.pass(source.name==='CleanRoom'?'volume-cleanroom':'volume', volume, { lightPos: [point.x / point.w * .5 + .5, point.y / point.w * .5 + .5] }, { tDiffuse: volume2.textures[0] });
    if (composite != null && r.program(composite)) this.pass(composite, output, {}, { tDiffuse: geometry.textures[0], tVolumetricBlur: volume.textures[0] });
    else this.pass('copy', output, {}, { tMap: geometry.textures[0] });
    return output.textures[0];
  }

  bloom(input, sceneName) {
    const r = this.renderer;
    let width = Math.round(innerWidth * .3 / 2), height = Math.round(innerHeight * .3 / 2), current = input;
    const vertical = [];
    for (let i = 0; i < 3; i++) {
      const x = this.target('bloom-x-' + i, width, height), y = this.target('bloom-y-' + i, width, height);
      this.pass('bloom-blur-' + [3, 5, 7][i], x, { texSize: [width, height], direction: [.3, 0] }, { colorTexture: current });
      current = this.pass('bloom-blur-' + [3, 5, 7][i], y, { texSize: [width, height], direction: [0, .3] }, { colorTexture: x.textures[0] });
      vertical.push(current);
      width = Math.max(1, Math.round(width / 2)); height = Math.max(1, Math.round(height / 2));
    }
    const values = { Home: [.6, .8], About: [1, 1], Work: [.5, .5], TreeScene: [.8, .7], CleanRoom: [.8, .5], Footer: [.7, .5] }[sceneName];
    return this.pass('bloom-composite', this.targets.get('bloom-x-0'), { bloomStrength: values[0], bloomRadius: values[1] }, { blurTexture1: vertical[0], blurTexture2: vertical[1], blurTexture3: vertical[2] });
  }

  streak(input) {
    const r = this.renderer, width = innerWidth, height = innerHeight;
    const pre = this.target('streak-pre', width, height);
    this.pass('streak-prefilter', pre, {}, { tMap: input });
    let current = pre.textures[0], w = width;
    const down = [], up = [];
    for (let i = 0; i < 8; i++) {
      const target = this.target('streak-down-' + i, w, height/2);
      const divisor=Math.pow(2,Math.max(0,i-1));
      this.pass('streak-down', target, { uResolution: [width/divisor, height/divisor] }, { tMap: current });
      current = target.textures[0]; down.push(target);
      w/=2;
    }
    let last = down[7].textures[0];
    for (let i = 0; i < 6; i++) {
      const target = this.target('streak-up-' + i, down[i].width, down[i].height);
      this.pass('streak-up', target, { uResolution: [width/Math.pow(2,i),height/Math.pow(2,i)] }, { tHigh: down[i ? i - 1 : 7].textures[0], tScene: last });
      up.push(target);
      if (i > 0) last = target.textures[0];
    }
    return this.pass('streak-composite', this.target('streak-final', width, height), {}, { tHigh: up[5].textures[0], tDown: down[6].textures[0], tPrefiltered: down[4].textures[0] });
  }

  finish(input, sceneName, uniforms) {
    const bloom = this.bloom(input, sceneName);
    const streak = this.streak(input);
    this.pass(60, null, uniforms, { tDiffuse: input, tUnrealBloom: bloom, tLightStreak: streak });
  }

  release(target) {
    const gl = this.renderer.gl;
    target.textures.forEach(texture => this.renderer.releaseTexture(texture));
    if (target.depth) gl.deleteRenderbuffer(target.depth);
    gl.deleteFramebuffer(target.framebuffer);
  }

  dispose() {
    this.targets.forEach(target => this.release(target));
    this.targets.clear();
  }
}
