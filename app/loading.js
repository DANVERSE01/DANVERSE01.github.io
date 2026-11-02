import { assets } from './assets.js';
import { deviceProfile } from './device.js';

const clamp = value => Math.max(0, Math.min(1, value));
const sineOut = value => Math.sin(clamp(value) * Math.PI / 2);
const sineInOut = value => .5 - .5 * Math.cos(clamp(value) * Math.PI);

export class LoadingIntro {
  constructor(element) {
    this.element = element;
    this.canvas = element.querySelector('canvas');
    this.behind = element.querySelector('.loading-pattern');
    this.counter = element.querySelector('.loading-counter');
    this.status = element.querySelector('.loading-status');
    this.percent = 0; this.smoothed = 0; this.target = 0; this.sequence = 0;
    this.phase = 'preparing'; this.samples = []; this.resources = [];
    this.created = performance.now();
    this.resizeListener = () => this.resize();
    this.contextLost=event=>{if(!this.disposed){event.preventDefault();this.graphicsUnavailable=true;}};
    this.canvas.addEventListener('webglcontextlost',this.contextLost);
    this.done = new Promise(resolve => { this.resolve = resolve; });
  }
  async start() {
    const response = await fetch('/assets/data/1c7f301dd6349b392184.json');
    if (!response.ok) throw Error('Missing original loading shader');
    this.pack = await response.json();
    this.settings = this.pack.settings;
    assets.configure(this.pack.assetSizes, (progress, bytes) => {
      this.bytes = bytes; this.setProgress(.9 * progress);
      const now=performance.now();
      if(now-(this.lastSample??0)>100){this.samples.push({elapsed:now-this.created,progress,received:bytes.received,total:bytes.total});this.lastSample=now;}
    });
    const gl = this.gl = this.canvas.getContext('webgl2', { alpha: true, antialias: true, powerPreference: 'high-performance' });
    if (!gl) throw Error('WebGL 2 is required');
    this.mobile = deviceProfile().mobile;
    const program = this.program = gl.createProgram();
    for (const source of this.mobile ? this.pack.programsMobile : this.pack.programs) {
      const shader = gl.createShader(source.type);
      gl.shaderSource(shader, source.source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const error = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw Error('LoaderBGShader: ' + error); }
      gl.attachShader(program, shader); this.resources.push(['Shader', shader]);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error('LoaderBGShader: ' + gl.getProgramInfoLog(program));
    this.locations = new Map();
    for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
      const info = gl.getActiveUniform(program, i), location = gl.getUniformLocation(program, info.name);
      if (location !== null) this.locations.set(info.name, { location, type: info.type });
    }
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    for (const [name, size, values] of [
      ['position', 3, [-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, -.5, 0, .5, .5, 0, -.5, .5, 0]],
      ['uv', 2, [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]],
    ]) {
      const location = gl.getAttribLocation(program, name);
      if (location < 0) continue;
      const buffer = gl.createBuffer(); this.resources.push(['Buffer', buffer]);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    }
    this.globalBuffer = gl.createBuffer(); this.resources.push(['Buffer', this.globalBuffer]);
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.globalBuffer); gl.bufferData(gl.UNIFORM_BUFFER, 176, gl.DYNAMIC_DRAW);
    gl.uniformBlockBinding(program, gl.getUniformBlockIndex(program, 'global'), 0);
    this.resize(); addEventListener('resize', this.resizeListener);
    this.started = performance.now(); this.phase = 'loading';
    this.frame(this.started);
  }
  setProgress(target, now = performance.now()) {
    if (this.phase === 'completing' || this.phase === 'done' || this.phase === 'failed') return;
    this.advance(now);
    this.from = this.percent; this.target = Math.max(this.target, target); this.tweenStarted = now;
  }
  advance(now) {
    if (this.tweenStarted === undefined) return;
    const t = clamp((now - this.tweenStarted) / (this.phase === 'completing' ? 300 : 500));
    this.percent = this.from + (this.target - this.from) * (this.phase === 'completing' ? sineOut(t) : t);
  }
  complete(now = performance.now()) {
    if (this.phase !== 'loading') return this.done;
    this.advance(now); this.from = this.percent; this.target = 1; this.tweenStarted = this.completed = now;
    this.phase = 'completing'; this.status.textContent = 'DANVERSE ready';
    return this.done;
  }
  resize() {
    if (!this.gl) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(innerWidth * dpr); this.canvas.height = Math.floor(innerHeight * dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const device=deviceProfile();this.mobile=device.mobile;this.phone=device.phone;
  }
  characters(now) {
    const tick = Math.floor((now - this.started) * 12 / 1000);
    if (tick !== this.patternTick) {
      this.patternTick = tick;
      let text = ('/'.repeat(30) + '\n').repeat(16).slice(0, Math.round(this.percent * 496));
      if (++this.sequence % 2 === 0 && text.length) {
        const result = text.split(''), digits = Math.round(100 * this.percent).toString();
        for (let i = 0; i < 30; i++) result[Math.floor(Math.random() * result.length)] = digits[Math.floor(Math.random() * digits.length)];
        text = result.join('');
      }
      this.behind.textContent = text;
    }
    const tick24 = Math.floor((now - this.started) * 24 / 1000);
    if (tick24 !== this.counterTick) {
      this.counterTick = tick24;
      this.counter.style.color = ['#86cfd1', '#ace6e8', '#77c4d9'][Math.floor(Math.random() * 3)];
      let percent = Math.round(100 * this.percent);
      if (percent < 10) percent = '//' + percent;
      if (percent < 100) percent = '/' + percent;
      if (percent === 100) percent = '>>>';
      this.counter.textContent = percent;
      this.element.setAttribute('aria-valuenow', Math.round(100 * this.percent));
    }
  }
  draw(now, dt) {
    const gl = this.gl;
    this.smoothed += (this.percent - this.smoothed) * (1 - Math.pow(.98, Math.min(dt, 100) / (1000 / 60)));
    const out = this.phase === 'completing' ? clamp((now - this.completed - 300) / 500) : 0;
    const alpha = sineOut((now - this.started - 100) / 500) * (1 - out ** 3);
    const visible = 1 - out ** 3;
    const elapsed = this.phase === 'completing' ? now - this.completed : 0;
    this.behind.style.opacity = .4 * (1 - sineOut(elapsed / 2000));
    this.counter.style.opacity = 1 - sineInOut(elapsed / 2000);
    this.lastState = { percent: this.percent, shaderProgress: this.smoothed, alpha, visible, bars: this.phone ? 24 : 20, mobileScale: this.mobile?2:1, phase: this.phase, bytes: this.bytes,graphicsUnavailable:!!this.graphicsUnavailable };
    if(this.graphicsUnavailable||gl.isContextLost())return;
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(this.program); gl.bindVertexArray(this.vao);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const width = innerWidth, height = innerHeight, near = .01, far = 1000;
    const projection = new DOMMatrix([2 / width, 0, 0, 0, 0, 2 / height, 0, 0, 0, 0, -2 / (far - near), 0, 0, 0, -(far + near) / (far - near), 1]);
    const view = new DOMMatrix().translate(-width / 2, height / 2, -1);
    const scale = this.mobile ? 2 : 1;
    const model = new DOMMatrix().translate(width / 2, -height / 2, 0).scale(width * scale, height * scale, 1);
    const globals = new Float32Array(44);
    globals.set(projection.toFloat32Array()); globals.set(view.toFloat32Array(), 16);
    globals.set([width / 2, -height / 2, 1], 32); globals.set([0, 0, 0, 1], 36);
    globals.set([this.canvas.width, this.canvas.height], 40); globals[42] = now / 1000; globals[43] = 1;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.globalBuffer); gl.bufferSubData(gl.UNIFORM_BUFFER, 0, globals); gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.globalBuffer);
    const values = { modelMatrix: model.toFloat32Array(), modelViewMatrix: view.multiply(model).toFloat32Array(), uColor: [17 / 255, 17 / 255, 17 / 255], uAlpha: alpha, uVisible: visible, uBottom: 0, uProgress: this.smoothed, uBars: this.phone ? 24 : 20, uMobile: this.phone ? 1 : 0, uHeight: .14, uScrollDelta: 0 };
    for (const [name, { location, type }] of this.locations) {
      const value = values[name]; if (value === undefined) continue;
      if (type === gl.FLOAT_MAT4) gl.uniformMatrix4fv(location, false, value);
      else if (type === gl.FLOAT_VEC3) gl.uniform3fv(location, value);
      else gl.uniform1f(location, value);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  frame(now) {
    if (this.phase === 'done' || this.phase === 'failed') return;
    try {
      this.advance(now); this.characters(now); this.draw(now, now - (this.last ?? now - 1000 / 60)); this.last = now;
      if (!this.graphicsUnavailable&&!this.gl.isContextLost()&&this.gl.getError() !== this.gl.NO_ERROR) throw Error('Original loader GPU draw failed');
      if (this.phase === 'completing' && now - this.completed >= 800) {
        this.finished=now;this.phase = 'done'; this.element.hidden = true; this.dispose();
        assets.listener=null;
        document.documentElement.dataset.loadingComplete='true';this.resolve(true); return;
      }
      this.frameId = requestAnimationFrame(time => this.frame(time));
    } catch (error) { this.fail(error); }
  }
  fail(error) {
    this.error=error;document.documentElement.dataset.loadingError=error.message;
    this.phase = 'failed'; this.element.hidden = false;
    this.counter.textContent = ''; this.behind.textContent = '';
    this.status.textContent = error.message; this.element.classList.add('failed');
    this.dispose(); this.resolve(false);
  }
  dispose() {
    cancelAnimationFrame(this.frameId); removeEventListener('resize', this.resizeListener);
    this.canvas.removeEventListener('webglcontextlost',this.contextLost);
    const gl = this.gl; if (!gl || this.disposed) return;
    this.disposed = true;
    gl.useProgram(null);gl.bindVertexArray(null);gl.bindBuffer(gl.UNIFORM_BUFFER,null);gl.bindBuffer(gl.ARRAY_BUFFER,null);
    for (const [type, resource] of this.resources) gl['delete' + type](resource);
    gl.deleteProgram(this.program); gl.deleteVertexArray(this.vao);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
