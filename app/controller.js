import { deviceProfile } from './device.js';
const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));
const alpha = (value, dt) => 1 - Math.pow(1 - value, dt / (1000 / 60));
const degrees = radians => radians * 180 / Math.PI;
const smooth = (a, b, v) => { const t=clamp((v-a)/(b-a)); return t*t*(3-2*t); };
export function workEase(x) {
  let lo=0, hi=1;
  for(let i=0;i<28;i++){const t=(lo+hi)/2, inv=1-t, value=3*inv*inv*t*.29+3*inv*t*t*.06+t*t*t;if(value<x)lo=t;else hi=t;}
  const t=(lo+hi)/2, inv=1-t;return 3*inv*inv*t*.05+3*inv*t*t*.92+t*t*t;
}
function slerp(a,b,t){
  let dot=a.reduce((sum,v,i)=>sum+v*b[i],0);if(dot<0){b=b.map(v=>-v);dot=-dot;}
  if(dot>.9995){const q=a.map((v,i)=>v+(b[i]-v)*t),length=Math.hypot(...q);return q.map(v=>v/length)}
  const angle=Math.acos(clamp(dot,-1,1)),s=Math.sin(angle);return a.map((v,i)=>(v*Math.sin((1-t)*angle)+b[i]*Math.sin(t*angle))/s);
}
function rotationMatrix(q){const[x,y,z,w]=q;return new DOMMatrix([1-2*(y*y+z*z),2*(x*y+z*w),2*(x*z-y*w),0,2*(x*y-z*w),1-2*(x*x+z*z),2*(y*z+x*w),0,2*(x*z+y*w),2*(y*z-x*w),1-2*(x*x+y*y),0,0,0,0,1])}

function cameraWorld(position, target, group) {
  const z = position.map((v, i) => v - target[i]);
  let length = Math.hypot(...z); z.forEach((v, i) => z[i] = v / length);
  const x = [z[2], 0, -z[0]]; length = Math.hypot(...x); x.forEach((v, i) => x[i] = v / length);
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return new DOMMatrix([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0,
    position[0] + group[0], position[1] + group[1], position[2] + group[2], 1]);
}

export function quaternion(matrix) {
  const m=new DOMMatrix(matrix.toFloat32Array());
  for(const column of [1,2,3]){const length=Math.hypot(m['m'+column+'1'],m['m'+column+'2'],m['m'+column+'3']);for(const row of [1,2,3])m['m'+column+row]/=length;}
  const trace = m.m11 + m.m22 + m.m33;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return [(m.m23 - m.m32) / s, (m.m31 - m.m13) / s, (m.m12 - m.m21) / s, s / 4];
  }
  if (m.m11 > m.m22 && m.m11 > m.m33) {
    const s=Math.sqrt(1+m.m11-m.m22-m.m33)*2;
    return [s/4,(m.m21+m.m12)/s,(m.m31+m.m13)/s,(m.m23-m.m32)/s];
  }
  if (m.m22 > m.m33) {
    const s = Math.sqrt(1 + m.m22 - m.m11 - m.m33) * 2;
    return [(m.m21 + m.m12) / s, s / 4, (m.m32 + m.m23) / s, (m.m31 - m.m13) / s];
  }
  const s=Math.sqrt(1+m.m33-m.m11-m.m22)*2;
  return [(m.m31+m.m13)/s,(m.m32+m.m23)/s,s/4,(m.m12-m.m21)/s];
}

export function hitPlane(camera,world,pointer){
  const transform=new DOMMatrix(world).inverse().multiply(camera.world).multiply(camera.projection.inverse());
  const unproject=z=>{const p=new DOMPoint(pointer[0],pointer[1],z,1).matrixTransform(transform);return[p.x/p.w,p.y/p.w,p.z/p.w]};
  const near=unproject(-1),far=unproject(1),dz=far[2]-near[2];if(Math.abs(dz)<1e-10)return false;
  const t=-near[2]/dz;if(t<0||t>1)return false;
  return Math.abs(near[0]+(far[0]-near[0])*t)<=.5&&Math.abs(near[1]+(far[1]-near[1])*t)<=.5;
}
export class SceneController {
  constructor(manifest) {
    this.data = manifest;
    this.target = 0; this.scroll = 0;
    this.pointer = [0, 0]; this.mouse = [innerWidth / 2, innerHeight / 2];
    this.delta = [0, 0]; this.inputDelta = [0, 0]; this.down = false;
    this.inputTime = -Infinity; this.inputFrames = 12;
    this.rotation = 0; this.pulse = 0; this.globalScroll = 0; this.velocity = 0;
    this.cameraY = manifest.scenes[0].camera.position[1];
    this.last = 0; this.previousOverall = 0; this.visible=1; this.introStarted=null;
    this.aboutRotation=0;this.footerRotation=0;this.aboutDelta=[0,0];this.footerDelta=[0,0];this.sparkle=0;
    this.hexHoldTarget=0;this.hexHold=0;this.hexTime=0;
    this.aboutPreviousProgress=0;this.aboutScrollDelta=0;
    this.labHovered=false;this.labAlpha=.7;this.labLogoAlpha=.6;this.labZ=0;this.hexHover=0;
    this.reflow();
  }

  reflow() {
    const previousHeight = this.viewportHeight || innerHeight;
    this.target = this.target / previousHeight * innerHeight;
    this.scroll = this.scroll / previousHeight * innerHeight;
    if(this.scrollTween){this.scrollTween.from*=innerHeight/previousHeight;this.scrollTween.to*=innerHeight/previousHeight;}
    this.viewportHeight = innerHeight;
    const device=deviceProfile();
    this.mobile=device.mobile;this.phone=device.phone;this.mobilePortrait=device.portrait;
    this.workTargets=this.mobilePortrait?this.data.workCameraTargets.map((_,i)=>{const angle=-35*i*Math.PI/180;return{position:[3.8*Math.cos(angle),4-.16*Math.min(7,this.data.workCameraTargets.length)*i-.7,3.8*Math.sin(angle)],quaternion:[0,Math.sin((Math.PI/2-angle)/2),0,Math.cos((Math.PI/2-angle)/2)]}}):this.data.workCameraTargets;
    const scalar = this.phone ? .5 : 1;
    this.ranges = [];
    let start = 0;
    for (const [i, vh] of [4, 1, 10, 2, 1.2, 4].entries()) {
      const height = 1.05 * Math.max(1, vh * scalar) * innerHeight;
      this.ranges.push({ index: i, start, height, end: start + height });
      start += height;
    }
    this.total = start;
    this.target = clamp(this.target, 0, start - innerHeight);
  }

  wheel(event) {
    this.scrollTween=null;
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
    this.target = clamp(this.target + event.deltaY * units, 0, this.total - innerHeight);
  }

  move(x, y, now = performance.now()) {
    if (now - this.inputTime < 16) return;
    this.inputTime = now;
    this.inputDelta[0] = x - this.mouse[0]; this.inputDelta[1] = y - this.mouse[1];
    this.inputFrames = 0;
    this.mouse = [x, y];
    this.pointer = [x / innerWidth * 2 - 1, 1 - y / innerHeight * 2];
  }

  startPointer(x, y) {
    this.mouse = [x, y]; this.pointer = [x / innerWidth * 2 - 1, 1 - y / innerHeight * 2];
    this.inputDelta.fill(0); this.down = true;
  }

  go(index,now=performance.now()) { this.scrollTween={from:this.scroll,to:this.ranges[index].start+(index?20:0),started:now}; }
  advanceScroll(now,dt){
    if(this.scrollTween){
      const tween=this.scrollTween,t=clamp((now-tween.started)/1000);
      this.scroll=this.target=tween.from+(tween.to-tween.from)*t;
      if(t===1){this.scroll=Math.floor(tween.to);this.scrollTween=null;}
    }else this.scroll=Math.floor(this.scroll+(this.target-this.scroll)*alpha(this.mobile?.5:.1,dt));
  }
  startEntrance(now=performance.now()){this.introStarted=now;this.visible=0;}
  focusWork(index,now=performance.now()) {
    const angle=-(this.mobilePortrait?35:50)*index*Math.PI/180;
    const y=(this.mobilePortrait?4:0)-(this.mobilePortrait?.16:.12)*Math.min(7,this.workTargets.length)*index;
    this.workFocus={started:now,from:this.workPosition.slice(),to:[3.8*Math.cos(angle),y,3.8*Math.sin(angle)]};
  }
  releaseWork(){if(this.workFocus){const f=this.workFocus,t=1-Math.pow(1-clamp((this.last-f.started)/700),3);this.workPosition=f.from.map((v,i)=>v+(f.to[i]-v)*t);}this.workFocus=null;}
  seek(index, progress) {
    this.scrollTween=null;
    const range = this.ranges[index];
    this.scroll = this.target = clamp(range.start - innerHeight + progress * (range.height + innerHeight), 0, this.total - innerHeight);
  }

  state(index) {
    const source = this.data.scenes[index], range = this.ranges[index];
    const progress = clamp((this.scroll + innerHeight - range.start) / (range.height + innerHeight));
    const overrides = { world: new Map(), uniforms: new Map(), attributes: new Map() };
    const projection = new DOMMatrix(source.camera.projection); projection.m11 = projection.m22 / (innerWidth / innerHeight);
    let world = new DOMMatrix(source.camera.world);
    if (index === 0) {
      const phone = this.phone;
      const groupY = 40 + ((phone ? -11 : -7) - 40) * progress;
      world = cameraWorld([0, this.cameraY, 40], [0, 4.59, 0], [0, groupY, -30+35*this.visible-15*(1-progress)+(phone?5:0)]);
      const logoAngle = 270 + 2 * (degrees(this.rotation) + 90 - 190 * progress)+210*Math.pow(1-this.visible,1.2);
      const particleAngle = -20 + degrees(this.rotation) + 90 - 190 * progress;
      for (const mesh of source.meshes) {
        const name = this.data.materials[mesh.material].fragmentName;
        if (name === 'HomeLogoShader' || name === 'HomeColumnShader') {
          const y = groupY + 4.5-.6*(1-this.visible) - (name === 'HomeColumnShader' ? 10 : 0);
          const matrix = new DOMMatrix().translate(0, y, 0).rotateAxisAngle(0, 1, 0, logoAngle).scale(...mesh.scale);
          overrides.world.set(mesh.id, matrix.toFloat32Array());
          overrides.uniforms.set(mesh.material, { uVisible: smooth(.5,1,this.visible), uPhone: phone ? 1 : 0 });
        } else if (name === 'ParticleTestShader') {
          const original = new DOMMatrix(mesh.world);
          const matrix = new DOMMatrix().translate(original.m41, original.m42, original.m43).rotateAxisAngle(0, 1, 0, particleAngle);
          overrides.world.set(mesh.id, matrix.toFloat32Array());
          overrides.uniforms.set(mesh.material, { uScroll: progress, uVisible: smooth(0,.92,this.visible), uPulse: this.pulse, uLogoPos: [1, groupY+4.5-.6*(1-this.visible), 2] });
        } else if (name === 'JellyShader') {
          overrides.uniforms.set(mesh.material, { uScroll: progress });
        } else if(name==='Text3D'){
          const sinceEntrance=this.introStarted===null?10000:this.last-this.introStarted;
          if(progress>.2&&this.hintOut===undefined){this.hintOut=this.last;this.hintOutAlpha=this.hintAlpha??0}
          this.hintAlpha=this.hintOut===undefined?.6*(.5-.5*Math.cos(Math.PI*clamp((sinceEntrance-5000)/5000))):(this.hintOutAlpha??0)*(1-Math.sin(clamp((this.last-this.hintOut)/500)*Math.PI/2));
          overrides.uniforms.set(mesh.material,{uAlpha:this.hintAlpha});
        }
      }
    } else if (index===1) {
      const offset=2*(1-2*progress);world.m42+=offset-(source.camera.groupPosition?.[1]??0);
      for(const mesh of source.meshes){
        if(this.data.materials[mesh.material].fragmentName==='AboutLogoShader'){
          overrides.world.set(mesh.id,new DOMMatrix().translate(0,2-4*progress,0).rotateAxisAngle(0,1,0,160-200*progress+degrees(this.aboutRotation)*2).scale(...(this.mobilePortrait?[2.1,2.1,2.1]:mesh.scale)).toFloat32Array());
          overrides.uniforms.set(mesh.material,{uScrollDelta:this.aboutScrollDelta});
        }else if(this.mobilePortrait){
          const title=mesh.material===14,layer=source.layers[title?'text':'copy'].transform;
          const parent=new DOMMatrix(layer.world).multiply(new DOMMatrix(layer.matrix).inverse());
          const replacement=parent.multiply(new DOMMatrix().translate(-1.2,title?.6:-1,-5).scale(title?.65:1.1,title?.65:1.1,1));
          overrides.world.set(mesh.id,replacement.multiply(new DOMMatrix(layer.world).inverse()).multiply(new DOMMatrix(mesh.world)).toFloat32Array());
        }
      }
    } else if(index===2){
      const targets=this.workTargets,offset=this.mobile?.1:.06,segment=smooth(offset,1-offset,progress)*(targets.length-1),a=Math.floor(segment),b=Math.min(a+1,targets.length-1),t=segment-a;
      const target=targets[a].position.map((v,i)=>(v+(targets[b].position[i]-v)*t)*(i===1?1:2));
      target[1]+=-smooth(0,.15,progress)+smooth(1,.85,progress);
      const targetQuaternion=slerp(targets[a].quaternion,targets[b].quaternion,t);
      if(!this.workPosition){this.workPosition=target;this.workQuaternion=targetQuaternion}else{const blend=alpha(.2,this.frameDt??16.667);this.workPosition=this.workPosition.map((v,i)=>v+(target[i]-v)*blend);this.workQuaternion=slerp(this.workQuaternion,targetQuaternion,blend)}
      const parent=rotationMatrix(this.workQuaternion);
      const focus=this.workFocus;
      const position=focus?focus.from.map((v,i)=>v+(focus.to[i]-v)*(1-Math.pow(1-clamp((this.last-focus.started)/700),3))):this.workPosition;
      [parent.m41,parent.m42,parent.m43]=position;
      world=parent.multiply(cameraWorld([0,0,2],[0,0,-4],[0,0,0]));
      if(this.phone||.9*innerWidth<innerHeight)projection.m22=1/Math.tan(55*Math.PI/360);projection.m11=projection.m22/(innerWidth/innerHeight);
      for(const mesh of source.meshes){const name=this.data.materials[mesh.material].fragmentName;if(name==='FlowerParticleShader')overrides.uniforms.set(mesh.material,{uScroll:progress,uSparkle:this.sparkle});if(name==='ChainShader')overrides.uniforms.set(mesh.material,{uScroll:progress});}
    } else if ([3, 4].includes(index)) {
      const travel = { 1: 2, 3: 6, 4: 4 }[index];
      world.m42 += travel*(1-2*progress)-(source.camera.groupPosition?.[1]??0);
      if(index===3){
        const z=(this.mobile?40:35)-15*progress;
        const parent=new DOMMatrix(source.camera.world).multiply(new DOMMatrix(source.camera.matrix).inverse());
        world=parent.multiply(cameraWorld([0,5,z],[-2,4.74,6],[0,0,0]));world.m42+=travel*(1-2*progress)-(source.camera.groupPosition?.[1]??0);
        const wrapper=source.layers.wrapper.transform,delta=new DOMMatrix().translate(...wrapper.position).rotateAxisAngle(0,1,0,180-60*(progress-.5)).multiply(new DOMMatrix(wrapper.matrix).inverse());
        for(const mesh of source.meshes){
          const material=this.data.materials[mesh.material];
          overrides.world.set(mesh.id,delta.multiply(new DOMMatrix(mesh.world)).toFloat32Array());
          const values={uScroll:progress};
          if(mesh.geometry===source.layers.cables.geometry){const light=material.uniforms.uLight.value;values.uLight=[progress-.5,...light.slice(1)]}
          overrides.uniforms.set(mesh.material,values);
        }
      }else{
        const room=source.layers.room.transform,parent=new DOMMatrix(room.world).multiply(new DOMMatrix(room.matrix).inverse());
        const roomWorld=parent.multiply(new DOMMatrix().translate(...room.position).rotateAxisAngle(0,1,0,(this.mobilePortrait?-8:-15)*(progress-.5)).scale(...room.scale));
        const delta=roomWorld.multiply(new DOMMatrix(room.world).inverse());
        for(const mesh of source.meshes){
          let matrix=delta.multiply(new DOMMatrix(mesh.world));
          const material=this.data.materials[mesh.material];
          if(material.fragmentName==='PhysicalShader'){
            const hex=source.layers.hexagons.transform,hexParent=new DOMMatrix(hex.world).multiply(new DOMMatrix(hex.matrix).inverse());
            const portrait=innerHeight>=innerWidth;
            matrix=delta.multiply(hexParent).multiply(new DOMMatrix().translate(...hex.position).rotateAxisAngle(0,0,1,portrait?90:0).scale(portrait?.32:.75,portrait?.4:.6,hex.scale[2]));
            overrides.uniforms.set(mesh.material,{uScroll:progress,uHold:this.hexHold,uTime:this.hexTime+2*this.hexHover,uRotation:portrait?Math.PI/2:0,uUVScale:[portrait?2:1,material.uniforms.uUVScale.value[1]]});
          }
          overrides.world.set(mesh.id,matrix.toFloat32Array());
        }
        if(this.mobilePortrait){const parentCamera=new DOMMatrix(source.camera.world).multiply(new DOMMatrix(source.camera.matrix).inverse());const local=new DOMMatrix(source.camera.matrix);local.m43=3;world=parentCamera.multiply(local);world.m42+=travel*(1-2*progress)-(source.camera.groupPosition?.[1]??0);}
        world.m43+=2*this.labZ;
      }
    } else if(index===5){
      const parent=new DOMMatrix().translate(0,22,0).scale(-1,-1,1);
      world=new DOMMatrix(source.camera.world);world.m42+=26-46*progress-(source.camera.groupPosition?.[1]??0);world.m43+=(this.phone?10:0)-5*progress-(source.camera.groupPosition?.[2]??0);
      const reverse=1-progress,angle=90+2*(degrees(this.footerRotation)+180+180*reverse),logoY=-2+44*progress;
      for(const mesh of source.meshes){const name=this.data.materials[mesh.material].fragmentName;
        if(name==='HomeLogoShader'||name==='HomeColumnShader'){
          const local=new DOMMatrix().translate(0,logoY-(name==='HomeColumnShader'?10:0),0).rotate( name==='HomeLogoShader'?180:0,angle,0).scale(...mesh.scale);
          overrides.world.set(mesh.id,parent.multiply(local).toFloat32Array());overrides.uniforms.set(mesh.material,{uFooter:1});
        }else if(name==='ParticleTestShader'){
          const local=new DOMMatrix().rotateAxisAngle(0,1,0,130-degrees(this.footerRotation)-180-180*reverse);
          overrides.world.set(mesh.id,parent.multiply(local).toFloat32Array());overrides.uniforms.set(mesh.material,{uScroll:reverse,uLogoPos:[0,-logoY+22,0]});
        }
      }
    }
    return { source, camera: { world, view: world.inverse(), projection, quaternion: quaternion(world) }, overrides, progress };
  }

  updateLab(state,now,dt){
    const hit=state.source.meshes.find(m=>m.material===47);
    const hovered=hitPlane(state.camera,state.overrides.world.get(hit.id)??hit.world,this.pointer);
    if(hovered!==this.labHovered){this.labHovered=hovered;this.labTween={started:now,duration:hovered?500:800,alpha:this.labAlpha,logo:this.labLogoAlpha,z:this.labZ};}
    const oldZ=this.labZ;
    if(this.labTween){
      const tween=this.labTween,t=1-Math.pow(1-clamp((now-tween.started)/tween.duration),3);
      this.labAlpha=tween.alpha+((hovered?1:.7)-tween.alpha)*t;
      this.labLogoAlpha=tween.logo+((hovered?1:.6)-tween.logo)*t;
      this.labZ=tween.z+((hovered?-.25:0)-tween.z)*t;
    }
    for(const id of [43,44,45])state.overrides.uniforms.set(id,{...state.overrides.uniforms.get(id),uAlpha:id===45?this.labLogoAlpha:this.labAlpha});
    state.overrides.uniforms.set(40,{...state.overrides.uniforms.get(40),uTime:this.hexTime+2*this.hexHover});
    state.camera.world.m43+=2*(this.labZ-oldZ);state.camera.view=state.camera.world.inverse();
  }

  update(now) {
    const dt = this.last ? Math.min(50, now - this.last) : 1000 / 60;
    this.last = now;this.frameDt=dt;if(this.introStarted!==null)this.visible=workEase(clamp((now-this.introStarted)/5000));
    this.advanceScroll(now,dt);
    const overall = clamp(((this.scroll + innerHeight) / this.total - .03) / .97);
    this.velocity += (clamp((this.previousOverall - overall) * 1500, -3, 3) - this.velocity) * alpha(.1, dt);
    this.previousOverall = overall;
    this.globalScroll += (20 * overall - this.globalScroll) * alpha(this.mobile ? .15 : .1, dt);
    if (this.inputFrames++ > 10) this.inputDelta.fill(0);
    const index = Math.max(0, this.ranges.findIndex(range => this.scroll < range.end));
    const nextIndex = Math.min(5, index + 1);
    const transition = index===nextIndex?0:clamp((this.scroll+innerHeight-this.ranges[nextIndex].start)/innerHeight);
    const visibleScene=id=>index===id||(nextIndex===id&&transition>0),gain=this.mobile?.0075:.0025;
    if(visibleScene(0)){
      for(let i=0;i<2;i++)this.delta[i]+=((this.down?this.inputDelta[i]:0)-this.delta[i])*alpha(.07,dt);
      this.rotation+=this.delta[0]*gain;if(this.down)this.pulse=0;this.pulse+=.001;
    }
    for(const[id,field,deltaField,multiplier]of[[1,'aboutRotation','aboutDelta',.5],[5,'footerRotation','footerDelta',1]])if(visibleScene(id)){
      for(let i=0;i<2;i++)this[deltaField][i]+=((this.down?this.inputDelta[i]:0)-this[deltaField][i])*alpha(.07,dt);this[field]+=this[deltaField][0]*gain*multiplier;
    }
    if(visibleScene(2))this.sparkle+=.005;
    if(visibleScene(1)){const range=this.ranges[1],p=clamp((this.scroll+innerHeight-range.start)/(range.height+innerHeight));this.aboutScrollDelta+=(100*(this.aboutPreviousProgress-p)-this.aboutScrollDelta)*alpha(.1,dt);this.aboutPreviousProgress=p;}
    {const blend=alpha(.03,dt);this.hexHoldTarget+=((this.down?1:0)-this.hexHoldTarget)*blend;this.hexHold+=(this.hexHoldTarget-this.hexHold)*blend;this.hexTime+=.025*dt/(1000/60);this.hexHover+=((this.labHovered?1:0)-this.hexHover)*alpha(.025,dt);}
    const home = this.ranges[0], progress = clamp((this.scroll + innerHeight) / (home.height + innerHeight));
    const targetY = 4.5 + ((this.phone ? 1 : 2.5) - 4.5) * progress;
    this.cameraY += (targetY - this.cameraY) * alpha(.1, dt);
    const current = this.state(index), next = transition > 0 ? this.state(nextIndex) : null;
    this.sceneIndex=index;
    if(index===4)this.updateLab(current,now,dt);else if(next?.source.name==='CleanRoom')this.updateLab(next,now,dt);else this.labHovered=false;
    return { current, next, transition, dt, velocity: this.velocity, globalScroll: this.globalScroll,visible:this.visible,mobilePortrait:this.mobilePortrait };
  }
}
