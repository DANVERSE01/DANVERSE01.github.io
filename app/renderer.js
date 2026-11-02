import { RenderPipeline } from './pipeline.js';
import { MouseFluid, PointCloudSimulation } from './fluid.js';
import { TubeSimulation } from './tubes.js';
import { SceneLighting } from './light-field.js';
import { WorkCards } from './work-cards.js';
import { WorkDetail } from './work-detail.js';
import { LogoSimulation } from './logo-simulation.js';
import { NavigationLayer } from './navigation-layer.js';
import { WorkPaneUI } from './work-pane-ui.js';
import { assets, readAsset } from './assets.js';
const DT={Float32Array:Float32Array,Float64Array:Float64Array,Uint32Array:Uint32Array,Uint16Array:Uint16Array,Uint8Array:Uint8Array,Int32Array:Int32Array,Int16Array:Int16Array,Int8Array:Int8Array};
const flatten=v=>Array.isArray(v)?v.flat(Infinity):v;
const yieldPreparation=()=>new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage(null);});
export class SpatialRenderer{
  constructor(canvas,manifest,binary,auxiliary,effects){
    this.canvas=canvas;this.data=manifest;this.binary=binary;this.auxiliary=auxiliary;this.gl=canvas.getContext('webgl2',{antialias:true,alpha:false,powerPreference:'high-performance'});if(!this.gl)throw Error('WebGL 2 is required');
    const gl=this.gl;gl.getExtension('EXT_color_buffer_float');gl.getExtension('EXT_float_blend');gl.getExtension('OES_texture_float_linear');gl.getExtension('EXT_texture_compression_bptc');gl.clearColor(.015,.025,.02,1);
    this.textures=[];this.ownedTextures=new Set();this.programs=new Map();this.linkedPrograms=new Map();this.geometry=new Map();this.uniformCache=new Map();this.elapsed=0;this.scratch=new Float32Array(16);this.frameTimes=[];this.effects=effects.effects;this.fullscreenVAOs=new Map();this.buffers=[];this.debug=false;this.settings=effects.settings;
    this.globalBuffer=gl.createBuffer();gl.bindBuffer(gl.UNIFORM_BUFFER,this.globalBuffer);gl.bufferData(gl.UNIFORM_BUFFER,256,gl.DYNAMIC_DRAW);gl.bindBufferBase(gl.UNIFORM_BUFFER,0,this.globalBuffer);
    this.empty=this.uploadTexture(new Uint8Array([0,0,0,255]),1,1,false,4);
    this.white=this.uploadTexture(new Uint8Array([255,255,255,255]),1,1,false,4);
    this.resize();this.scene=manifest.scenes[0];this.pipeline=new RenderPipeline(this);
  }
  array(record){
    if(record==null)return null;if(record.direct)return record.direct;const descriptor=this.data.buffers[record.buffer];
    if(descriptor.generated){
      this.generatedBuffers??=new Map();if(this.generatedBuffers.has(record.buffer))return this.generatedBuffers.get(record.buffer);
      const {size,populated,formula}=descriptor.generated,array=new Float32Array(descriptor.length);
      for(let i=0;i<populated;i++){array[i*3]=formula==='offset-after-divide'?i%size/size+.5/size:(i%size+.5)/size;array[i*3+1]=formula==='offset-after-divide'?Math.floor(i/size)/size+.5/size:(Math.floor(i/size)+.5)/size;array[i*3+2]=i;}
      this.generatedBuffers.set(record.buffer,array);return array;
    }
    return new DT[descriptor.type](this.binary,descriptor.offset,descriptor.length);
  }
  value(record){if(record?.buffer!=null)return this.array(record);return flatten(record)}
  check(label){const error=this.gl.getError();if(error!==this.gl.NO_ERROR)throw Error(label+' (WebGL '+error+')')}
  uploadTexture(pixels,width,height,floating,channels=4){
    if(this.disposed)throw Error('Renderer disposed during initialization');
    const gl=this.gl,t=gl.createTexture();this.ownedTextures.add(t);gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
    const format=channels===1?gl.RED:channels===3?gl.RGB:gl.RGBA,internal=floating?(channels===1?gl.R32F:channels===3?gl.RGB32F:gl.RGBA32F):gl.RGBA8;
    gl.texImage2D(gl.TEXTURE_2D,0,internal,width,height,0,format,floating?gl.FLOAT:gl.UNSIGNED_BYTE,pixels);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return t;
  }
  async loadTextures(){
    const gl=this.gl,aux=new Map(this.data.auxiliary.records.map(record=>[record.id,record]));
    await Promise.all(this.data.textures.filter(record=>record.runtimeRequired!==false).map(async record=>{
      const captured=aux.get(record.id);let texture;
      if(captured){const Constructor=DT[captured.type],pixels=new Constructor(this.auxiliary,captured.offset,captured.bytes/Constructor.BYTES_PER_ELEMENT),channels=pixels.length/(captured.width*captured.height);texture=this.uploadTexture(pixels,captured.width,captured.height,captured.type==='Float32Array',channels)}
      else if(record.ownerLabel){
        return;
      }else if(record.compressedData?.length&&gl.getExtension('EXT_texture_compression_bptc')){
        if(record.local)assets.skip(record.local);
        texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);record.compressedData.forEach((buffer,i)=>{const level=record.sizes[i];gl.compressedTexImage2D(gl.TEXTURE_2D,i,record.gliFormat,level.width,level.height,0,this.array(buffer))});
      }else if(record.local&&!record.local.endsWith('.mp4')){
        const bitmap=await createImageBitmap(await readAsset(record.local,'blob'),{imageOrientation:'flipY',premultiplyAlpha:'none',colorSpaceConversion:'none'});
        if(this.disposed){bitmap.close();return;}
        texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,bitmap);bitmap.close();
      }
      if(texture){this.ownedTextures.add(texture);gl.bindTexture(gl.TEXTURE_2D,texture);const mip=record.minFilter==='texture_linear_mip',linear=record.minFilter==='texture_linear'||mip;if(mip&&!record.compressedData?.length)gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,mip?gl.LINEAR_MIPMAP_LINEAR:linear?gl.LINEAR:gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,record.magFilter==='texture_linear'?gl.LINEAR:gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,record.wrapS==='texture_repeat'?gl.REPEAT:gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,record.wrapT==='texture_repeat'?gl.REPEAT:gl.CLAMP_TO_EDGE);this.textures[record.id]=texture}
    }));
    if(this.disposed)return;this.check('Original texture upload');this.video=document.createElement('video');this.video.muted=true;this.video.loop=true;this.video.playsInline=true;this.video.src='/assets/media/ff3818c704c70e0b4447.mp4';this.videoTexture=this.uploadTexture(new Uint8Array([45,85,75,255]),1,1,false);this.textures[1]=this.videoTexture;await this.video.play().catch(()=>{});
  }
  async loadDynamics(){
    const positions=await readAsset('/assets/data/726c2aa85fe972eb1041.bin.gz');
    if(positions.byteLength!==12582912)throw Error('Original point-cloud size mismatch');
    this.fluid=new MouseFluid(this);this.pointSimulation=new PointCloudSimulation(this,positions);this.tubeSimulation=new TubeSimulation(this);
    this.footerPointSimulation=new PointCloudSimulation(this,null,85,this.pointSimulation.pointCloud);
    const flowerPositions=await readAsset('/assets/data/bc872ad2c96aba6fce02.bin.gz');
    if(flowerPositions.byteLength!==12582912)throw Error('Original flower target size mismatch');
    this.flowerPointSimulation=new PointCloudSimulation(this,flowerPositions,29);
    const [metadata,field]=await Promise.all([readAsset('/assets/data/9fa2f8924f53dec14702.json','json'),readAsset('/assets/data/f77b6a4c4f8791df7355.bin.gz')]);
    this.lightField=new SceneLighting(this,metadata,field);
    this.workCards=new WorkCards(this);
    this.workDetail=new WorkDetail(this);
    await this.workDetail.load();
    this.logoSimulation=new LogoSimulation(this);await this.logoSimulation.load();
    this.navigationLayer=new NavigationLayer(this);await this.navigationLayer.load();
    this.workPaneUI=new WorkPaneUI(this,this.navigationLayer);
    this.check('Dynamic texture initialization');
  }
  program(id){
    if(this.programs.has(id))return this.programs.get(id);const gl=this.gl,record=typeof id==='string'?this.effects[id]:this.data.materials[id];
    if(!record)throw Error('Unknown shader '+id);
    if(!record.programs.length){const match=this.data.materials.find(m=>m.programs.length&&m.vertexName===record.vertexName&&m.fragmentName===record.fragmentName);if(match){record.programs=match.programs;record.uniformBlocks=match.uniformBlocks;record.activeUniforms=match.activeUniforms;}}
    if(!record.programs.length)return null;
    const signature=record.programs.map(source=>source.type+':'+source.source).join('\n');
    let linked=this.linkedPrograms.get(signature);
    if(!linked){
      const program=gl.createProgram(),shaders=[];
      try{
        for(const source of record.programs){const shader=gl.createShader(source.type);shaders.push(shader);gl.shaderSource(shader,source.source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(record.fragmentName+': '+gl.getShaderInfoLog(shader));gl.attachShader(program,shader);}
        gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(record.fragmentName+': '+gl.getProgramInfoLog(program));
        const block=gl.getUniformBlockIndex(program,'global');if(block!==gl.INVALID_INDEX)gl.uniformBlockBinding(program,block,0);
        const uniforms=[];for(let i=0;i<gl.getProgramParameter(program,gl.ACTIVE_UNIFORMS);i++){const info=gl.getActiveUniform(program,i),location=gl.getUniformLocation(program,info.name);if(location!==null)uniforms.push({name:info.name,type:info.type,size:info.size,location});}
        const fragment=record.programs.find(source=>source.type===gl.FRAGMENT_SHADER).source;
        const outputs=[...fragment.matchAll(/\bout\s+(?:lowp\s+|mediump\s+|highp\s+)?vec4\s+(\w+)\s*;/g)].map(match=>gl.getFragDataLocation(program,match[1])).filter(location=>location>=0);
        linked={program,uniforms,outputs};this.linkedPrograms.set(signature,linked);
      }catch(error){gl.deleteProgram(program);throw error;}finally{shaders.forEach(shader=>gl.deleteShader(shader));}
    }
    const {program,uniforms,outputs}=linked;
    const blocks=[];
    for(const descriptor of record.uniformBlocks.filter(b=>b.name!=='global')){const bytes=new Float32Array(descriptor.bytes/4);for(const field of descriptor.fields){const name=field.name.replace(/\[0\]$/,''),values=this.value(record.uniforms[name]?.value);if(values)bytes.set(values,field.offset/4)}const buffer=gl.createBuffer(),binding=blocks.length+1;gl.bindBuffer(gl.UNIFORM_BUFFER,buffer);gl.bufferData(gl.UNIFORM_BUFFER,bytes,gl.STATIC_DRAW);gl.uniformBlockBinding(program,gl.getUniformBlockIndex(program,descriptor.name),binding);blocks.push({buffer,binding})}
    const result={program,uniforms,record,blocks,outputs};this.programs.set(id,result);return result;
  }
  async prepareScenePrograms(){
    const ids=new Set(Object.keys(this.effects));
    ids.add(60);
    for(const scene of [...this.data.scenes,...this.data.extraScenes]){
      for(const mesh of scene.meshes)ids.add(mesh.material);
      for(const pass of scene.passes??[])if(pass.material!==undefined)ids.add(pass.material);
    }
    let start=performance.now();
    for(const id of ids){
      if(this.disposed)return;
      this.program(id);
      if(performance.now()-start>4){await yieldPreparation();start=performance.now();}
    }
    for(const scene of [...this.data.scenes,...this.data.extraScenes])for(const mesh of scene.meshes){
      if(this.disposed)return;
      const program=this.program(mesh.material);if(program)this.vao(this.data.geometries[mesh.geometry],program);
      if(performance.now()-start>4){await yieldPreparation();start=performance.now();}
    }
  }
  vao(record,program){
    const gl=this.gl,key=record.id+':'+program.record.id;if(this.geometry.has(key))return this.geometry.get(key);const vao=gl.createVertexArray(),attributeBuffers=new Map();gl.bindVertexArray(vao);
    for(const[name,attribute]of Object.entries(record.attributes)){const location=gl.getAttribLocation(program.program,name);if(location<0)continue;const buffer=gl.createBuffer(),array=this.array(attribute);this.buffers.push(buffer);attributeBuffers.set(name,buffer);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,array,gl.STATIC_DRAW);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,attribute.itemSize,gl.FLOAT,false,0,0);if(attribute.meshPerAttribute)gl.vertexAttribDivisor(location,attribute.meshPerAttribute)}
    let indexType=gl.UNSIGNED_SHORT,count=record.attributes.position.count;if(record.index){const array=this.array(record.index),buffer=gl.createBuffer();this.buffers.push(buffer);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,buffer);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,array,gl.STATIC_DRAW);count=array.length;indexType=array instanceof Uint32Array?gl.UNSIGNED_INT:gl.UNSIGNED_SHORT}
    const result={vao,count,indexType,indexed:!!record.index,instances:record.maxInstancedCount||0,attributeBuffers};this.geometry.set(key,result);return result;
  }
  uniform(item,value){const gl=this.gl;if(value==null)return;const t=item.type,l=item.location;
    if(t===gl.FLOAT)gl.uniform1fv(l,typeof value==='number'?[value]:value);else if(t===gl.FLOAT_VEC2)gl.uniform2fv(l,value);else if(t===gl.FLOAT_VEC3)gl.uniform3fv(l,value);else if(t===gl.FLOAT_VEC4)gl.uniform4fv(l,value);else if(t===gl.FLOAT_MAT3)gl.uniformMatrix3fv(l,false,value);else if(t===gl.FLOAT_MAT4)gl.uniformMatrix4fv(l,false,value);else if(t===gl.INT||t===gl.BOOL)gl.uniform1iv(l,typeof value==='number'||typeof value==='boolean'?[Number(value)]:value);else if(t===gl.INT_VEC2)gl.uniform2iv(l,value);
  }
  resize(){const dpr=this.settings?.outputDPR??1.5;this.canvas.width=Math.floor(innerWidth*dpr);this.canvas.height=Math.floor(innerHeight*dpr);this.gl.viewport(0,0,this.canvas.width,this.canvas.height)}
  setResolution(width,height){const gl=this.gl;this.currentResolution=[width,height];gl.bindBuffer(gl.UNIFORM_BUFFER,this.globalBuffer);gl.bufferSubData(gl.UNIFORM_BUFFER,160,new Float32Array([width,height]));}
  bindUniforms(program, values = {}, textures = {}) {
    const gl=this.gl;let unit=0;
    for(const item of program.uniforms){
      const name=item.name.replace(/\[0\]$/,'');
      if(item.type===gl.SAMPLER_2D||item.type===gl.SAMPLER_2D_SHADOW){
        const desc=program.record.uniforms[name]?.value;
        const dynamic=name==='tFluid'?this.fluid?.velocity:name==='tFluidMask'?this.fluid?.mask:name==='tVideo'?(program.record.fragmentName==='PhysicalShader'?null:this.lightField?.texture):null;
        const texture=textures[name]??dynamic??(desc?.texture!=null?this.textures[desc.texture]:null);
        gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,texture||this.empty);gl.uniform1i(item.location,unit++);
      }else{
        const value=values[name]??this.value(program.record.uniforms[name]?.value??program.record.activeUniforms.find(u=>u.name===item.name)?.value);
        this.uniform(item,value);
      }
    }
  }
  fullscreen(id,values={},textures={}){
    const gl=this.gl,program=this.program(id);if(!program)return;
    let vao=this.fullscreenVAOs.get(id);
    if(!vao){vao=gl.createVertexArray();gl.bindVertexArray(vao);
      for(const[name,size,array]of[['position',3,[-1,-1,0,3,-1,0,-1,3,0]],['uv',2,[0,0,2,0,0,2]]]){
        const location=gl.getAttribLocation(program.program,name);if(location<0)continue;
        const buffer=gl.createBuffer();this.buffers.push(buffer);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(array),gl.STATIC_DRAW);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,0,0);
      }this.fullscreenVAOs.set(id,vao);
    }
    gl.useProgram(program.program);gl.bindVertexArray(vao);gl.disable(gl.DEPTH_TEST);gl.depthMask(false);gl.disable(gl.BLEND);gl.disable(gl.CULL_FACE);
    this.bindUniforms(program,{uMouse:this.pointer,uMobile:innerWidth<700?1:0,...values},textures);gl.drawArrays(gl.TRIANGLES,0,3);
    if(this.debug)this.check('Pass '+program.record.fragmentName);
  }
  cameraFor(source){
    const world=new DOMMatrix(source.camera.world),projection=new DOMMatrix(source.camera.projection);projection.m11=projection.m22/(this.canvas.width/this.canvas.height);
    return{world,view:world.inverse(),projection,quaternion:source.camera.quaternion};
  }
  updateGlobals(camera){
    const gl=this.gl,global=new Float32Array(44);
    global.set(camera.projection.toFloat32Array(),0);global.set(camera.view.toFloat32Array(),16);global.set([camera.world.m41,camera.world.m42,camera.world.m43],32);global.set(camera.quaternion,36);global.set(this.currentResolution??[this.canvas.width,this.canvas.height],40);global[42]=this.elapsed;global[43]=1;
    gl.bindBuffer(gl.UNIFORM_BUFFER,this.globalBuffer);gl.bufferSubData(gl.UNIFORM_BUFFER,0,global);gl.bindBufferBase(gl.UNIFORM_BUFFER,0,this.globalBuffer);
  }
  drawScene(source,camera,overrides={},refraction){
    const gl=this.gl,view=camera.view;this.updateGlobals(camera);
    for(const mesh of source.meshes){if(!mesh.visible||mesh.hidden||mesh.effectiveVisible===false)continue;const program=this.program(mesh.material);if(!program)continue;const record=program.record,geometry=this.data.geometries[mesh.geometry],binding=this.vao(geometry,program);gl.useProgram(program.program);gl.bindVertexArray(binding.vao);
      gl.drawBuffers(this.pipeline.bound?this.pipeline.bound.textures.map((_,i)=>program.outputs.includes(i)?gl.COLOR_ATTACHMENT0+i:gl.NONE):[gl.BACK]);
      for(const[name,array]of Object.entries(overrides.attributes?.get(mesh.geometry)??{})){const buffer=binding.attributeBuffers.get(name);if(buffer){gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,array)}}
      program.blocks.forEach(block=>gl.bindBufferBase(gl.UNIFORM_BUFFER,block.binding,block.buffer));record.depthTest?gl.enable(gl.DEPTH_TEST):gl.disable(gl.DEPTH_TEST);gl.depthMask(record.depthWrite!==false);
      if(record.side==='shader_double_side')gl.disable(gl.CULL_FACE);else{gl.enable(gl.CULL_FACE);gl.cullFace(record.side==='shader_back_side'?gl.FRONT:gl.BACK)}
      if(record.transparent){gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,record.blending==='shader_additive_blending'?gl.ONE:gl.ONE_MINUS_SRC_ALPHA)}else gl.disable(gl.BLEND);
      const model=new DOMMatrix(overrides.world?.get(mesh.id)??mesh.world),modelView=view.multiply(model),inverse=modelView.inverse(),normal=new Float32Array([inverse.m11,inverse.m21,inverse.m31,inverse.m12,inverse.m22,inverse.m32,inverse.m13,inverse.m23,inverse.m33]);
      this.bindUniforms(program,{modelMatrix:model.toFloat32Array(),modelViewMatrix:modelView.toFloat32Array(),normalMatrix:normal,DPR:this.currentResolution[0]/innerWidth,uDPR:this.currentResolution[0]/innerWidth,...overrides.uniforms?.get(mesh.material)}, {tRefraction:refraction,...overrides.textures?.get(mesh.material)});
      if(this.debug)this.check('Uniforms '+record.fragmentName);const mode=mesh.isPoints?gl.POINTS:gl.TRIANGLES;if(binding.indexed){if(geometry.isInstanced)gl.drawElementsInstanced(mode,binding.count,binding.indexType,0,binding.instances);else gl.drawElements(mode,binding.count,binding.indexType,0)}else if(geometry.isInstanced)gl.drawArraysInstanced(mode,0,binding.count,binding.instances);else gl.drawArrays(mode,0,binding.count);
      if(this.debug)this.check('Draw '+record.fragmentName);
    }
  }
  updateJelly(state,now){
    this.jellyStates??=new Map();
    for(const mesh of state.source.meshes){
      if(this.data.materials[mesh.material].fragmentName!=='JellyShader'||!mesh.visible||mesh.hidden)continue;
      const geometry=this.data.geometries[mesh.geometry];if(!geometry.attributes.offset||!geometry.attributes.orientation)continue;
      let animation=this.jellyStates.get(mesh.id);
      if(!animation){const offsets=this.array(geometry.attributes.offset).slice(),orientation=this.array(geometry.attributes.orientation).slice();animation={started:now,offsets,orientation,sourceOffsets:offsets.slice(),angles:[],progress:state.source.scrollProgress??0};for(let i=0;i<orientation.length;i+=4)animation.angles.push(2*Math.atan2(orientation[i+1],orientation[i+3]));this.jellyStates.set(mesh.id,animation)}
      const elapsed=now-animation.started,deltaProgress=state.progress-animation.progress;
      for(let i=0;i<animation.angles.length;i++){
        animation.offsets[i*3+1]+=.01;
        if(animation.offsets[i*3+1]>60)animation.offsets[i*3+1]=animation.sourceOffsets[i*3+1];
        const angle=animation.angles[i]-deltaProgress*Math.PI*4-.0005*elapsed;
        animation.orientation.set([0,Math.sin(angle/2),0,Math.cos(angle/2)],i*4);
      }
      const rotation=-deltaProgress*360*.6-.00003*elapsed*180/Math.PI;
      state.overrides.world.set(mesh.id,new DOMMatrix().rotateAxisAngle(0,1,0,rotation).multiply(new DOMMatrix(mesh.world)).toFloat32Array());
      state.overrides.attributes.set(mesh.geometry,{offset:animation.offsets,orientation:animation.orientation});
      state.overrides.uniforms.set(mesh.material,{uScroll:state.progress});
    }
  }
  updateChain(state){
    this.chainStates??=new Map();
    for(const mesh of state.source.meshes){
      if(this.data.materials[mesh.material].fragmentName!=='ChainShader'||!mesh.visible||mesh.hidden)continue;
      const geometry=this.data.geometries[mesh.geometry];if(!geometry.attributes.orientation)continue;
      let orientation=this.chainStates.get(mesh.geometry);
      if(!orientation){orientation=this.array(geometry.attributes.orientation).slice();this.chainStates.set(mesh.geometry,orientation)}
      for(let i=0;i<orientation.length/4;i++){const angle=i*Math.PI/2-state.progress*Math.PI*8;orientation.set([0,Math.sin(angle/2),0,Math.cos(angle/2)],i*4)}
      state.overrides.attributes.set(mesh.geometry,{orientation});
    }
  }
  draw(now,progress=0,pointer=[0,0],state=null){
    const gl=this.gl;const dt=this.previousTime?now-this.previousTime:16.67;this.previousTime=now;this.frameDelta=dt;if(this.frameTimes.length<600)this.frameTimes.push(dt);this.elapsed=now/1000;
    if(this.video?.readyState>=2){gl.bindTexture(gl.TEXTURE_2D,this.videoTexture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.video);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false)}
    this.lightField?.update(now);
    this.pointer=pointer;
    const current=state?.current??{source:this.scene,camera:this.cameraFor(this.scene),overrides:{}},next=state?.next;
    this.scene=current.source;this.updateGlobals(current.camera);
    if(state){this.updateJelly(current,now);this.updateChain(current);if(next){this.updateJelly(next,now);this.updateChain(next)}}
    let input=this.pipeline.scene(current.source,current.camera,current.overrides,'main');
    if(next){const nextTexture=this.pipeline.scene(next.source,next.camera,next.overrides,'next');const target=this.pipeline.target('scene-transition',innerWidth*this.settings.sceneDPR,innerHeight*this.settings.sceneDPR);this.updateGlobals(current.camera);input=this.pipeline.pass('scroll-transition',target,{uTransition:state.transition,uRatio:innerWidth/innerHeight,uAngle:.7,uVelocity:0},{tMap1:input,tMap2:nextTexture,tNormal:this.textures[28]})}
    if(this.fluid){this.fluid.update(state?.dt??16.667);
      const home=current.source.name==='Home'?current:next?.source.name==='Home'?next:null;
      if(home){const mesh=home.source.meshes.find(m=>this.data.materials[m.material].fragmentName==='ParticleTestShader');this.pointSimulation.update(state.dt,home.camera,home.overrides.world.get(mesh.id)??mesh.world,this.fluid);this.tubeSimulation.update(state.dt,now,home.camera,pointer)}
      const footer=current.source.name==='Footer'?current:next?.source.name==='Footer'?next:null;
      if(footer){const mesh=footer.source.meshes.find(m=>this.data.materials[m.material].fragmentName==='ParticleTestShader');this.footerPointSimulation.update(state.dt,footer.camera,footer.overrides.world.get(mesh.id)??mesh.world,this.fluid)}
      const work=current.source.name==='Work'?current:next?.source.name==='Work'?next:null;
      if(work){const mesh=work.source.meshes.find(m=>this.data.materials[m.material].fragmentName==='FlowerParticleShader');this.flowerPointSimulation.update(state.dt,work.camera,work.overrides.world.get(mesh.id)??mesh.world,this.fluid)}
      const tree=current.source.name==='TreeScene'?current:next?.source.name==='TreeScene'?next:null;
      if(tree){const mesh=this.logoSimulation.mesh;this.logoSimulation.update(state.dt,tree.camera,tree.overrides.world.get(mesh.id)??mesh.world)}
    }
    this.workDetail?.step(now,state?.dt??16.667);this.updateGlobals(current.camera);
    this.pipeline.finish(input,current.source.name,{uMouse:pointer,uScroll:state?.globalScroll??progress,uScrollDelta:state?.velocity??0,uVisible:state?.visible??1,uGradient:state?.mobilePortrait?[.05,2]:[.02,.9]});
    this.fluid?.input([(pointer[0]+1)*.5*innerWidth,(1-pointer[1])*.5*innerHeight],now);
    const error=gl.getError();if(error!==gl.NO_ERROR)throw Error('WebGL draw error '+error);
  }
  releaseTexture(texture){if(this.ownedTextures.delete(texture))this.gl.deleteTexture(texture);}
  dispose(){
    if(this.disposed)return;this.disposed=true;
    const gl=this.gl;this.workCards?.dispose();this.lightField?.dispose();this.pointSimulation?.dispose();this.tubeSimulation?.dispose();this.pipeline.dispose();this.video?.pause();if(this.video){this.video.removeAttribute('src');this.video.load()}
    for(const texture of this.ownedTextures)this.releaseTexture(texture);gl.deleteBuffer(this.globalBuffer);
    this.buffers.forEach(buffer=>gl.deleteBuffer(buffer));this.geometry.forEach(item=>gl.deleteVertexArray(item.vao));this.fullscreenVAOs.forEach(vao=>gl.deleteVertexArray(vao));
    this.programs.forEach(item=>item.blocks.forEach(block=>gl.deleteBuffer(block.buffer)));
    this.linkedPrograms.forEach(item=>gl.deleteProgram(item.program));
    this.textures.length=0;this.buffers.length=0;this.geometry.clear();this.programs.clear();this.linkedPrograms.clear();this.fullscreenVAOs.clear();this.generatedBuffers?.clear();
  }
}
