import { workEase, quaternion } from './controller.js';
import { readAsset } from './assets.js';

export class WorkDetail {
  constructor(renderer){this.renderer=renderer;this.config=renderer.data.workDetail;this.index=null;this.target=0;this.mix=0;this.gaze=[0,0];}
  async load(){
    const r=this.renderer,c=this.config,size=c.particleSize;
    const curves=await readAsset('/assets/data/193c81a1302f3e7019fe.json','json'),count=curves.length*curves[0].length;let textureSize=2;while(textureSize*textureSize<count)textureSize*=2;
    const spline=new Float32Array(textureSize*textureSize*3);spline.set(curves.flat());
    this.spline=r.uploadTexture(spline,textureSize,textureSize,true,3);this.splineValues={uSplineCount:curves.length,uPerSpline:curves[0].length/3,uSplineTexSize:textureSize};
    const random=r.array(r.data.geometries[c.particleGeometry].attributes.random),origin=new Float32Array(random.length),total=size*size;
    for(let i=0;i<total;i++){const j=(i+total/2)%total;for(let axis=0;axis<3;axis++)origin[i*4+axis]=random[j*4+axis]*2-1;origin[i*4+3]=1;}
    this.random=r.uploadTexture(random,size,size,true);this.origin=r.uploadTexture(origin,size,size,true);
    this.positions=[0,1].map(i=>r.pipeline.target('detail-positions-'+i,size,size,1,false,'float32',false));
    this.life=[0,1].map(i=>r.pipeline.target('detail-life-'+i,size,size,1,false,'float32',false));
    r.pipeline.pass('copy',this.positions[0],{}, {tMap:this.origin});
    this.particleGaze=[0,0];
  }
  open(index,now=performance.now()){
    this.index=index;this.start=now;this.from=this.mix;this.target=1;this.duration=1500;this.renderer.workCards.pinned=index;
  }
  close(now=performance.now()){
    if(!this.target)return;this.from=this.mix;this.start=now;this.target=0;this.duration=800;
  }
  update(now){
    if(this.index===null)return;
    const t=Math.max(0,Math.min(1,(now-this.start)/this.duration));this.mix=this.from+(this.target-this.from)*workEase(t);
    if(!this.target&&t===1){this.mix=0;this.index=null;this.renderer.workCards.pinned=null;}
  }
  camera(now){
    const c=this.config,aspect=innerWidth/innerHeight,f=1/Math.tan(c.fov*Math.PI/360),near=c.near,far=c.far;
    const projection=new DOMMatrix([f/aspect,0,0,0,0,f,0,0,0,0,-(far+near)/(far-near),-1,0,0,-2*far*near/(far-near),0]);
    const targetZ=2.5*f,travel=5*(1-workEase(Math.max(0,Math.min(1,(now-this.start)/1500))));
    const p=this.renderer.pointer??[0,0],dt=Math.min(50,now-(this.last??now-16.667)),alpha=1-Math.pow(.93,dt/16.667);this.last=now;
    this.gaze[0]+=(-p[0]-this.gaze[0])*alpha;this.gaze[1]+=(-p[1]*.5-this.gaze[1])*alpha;
    const local=[this.gaze[0],this.gaze[1],1],z=local.map((v,i)=>v-[0,0,-10][i]),length=Math.hypot(...z);z.forEach((v,i)=>z[i]=v/length);
    const x=[z[2],0,-z[0]],xl=Math.hypot(...x);x.forEach((v,i)=>x[i]=v/xl);
    const y=[z[1]*x[2]-z[2]*x[1],z[2]*x[0]-z[0]*x[2],z[0]*x[1]-z[1]*x[0]];
    const world=new DOMMatrix([x[0],x[1],x[2],0,y[0],y[1],y[2],0,z[0],z[1],z[2],0,local[0],local[1],targetZ+1+(this.target?travel:5*this.mix),1]);
    return{world,view:world.inverse(),projection,quaternion:quaternion(world)};
  }
  particleCamera(now){
    const aspect=innerWidth/innerHeight,f=1/Math.tan(Math.PI/12),near=.1,far=1000;
    const projection=new DOMMatrix([f/aspect,0,0,0,0,f,0,0,0,0,-(far+near)/(far-near),-1,0,0,-2*far*near/(far-near),0]);
    const p=this.renderer.pointer??[0,0],a=1-Math.pow(.93,Math.min(50,this.renderer.frameDelta??16.667)/16.667);
    this.particleGaze[0]+=(-p[0]*4-this.particleGaze[0])*a;this.particleGaze[1]+=(-p[1]*4-this.particleGaze[1])*a;
    const z=[this.particleGaze[0],this.particleGaze[1],17],length=Math.hypot(...z);z.forEach((v,i)=>z[i]=v/length);
    const x=[z[2],0,-z[0]],xl=Math.hypot(...x);x.forEach((v,i)=>x[i]=v/xl);
    const y=[z[1]*x[2]-z[2]*x[1],z[2]*x[0]-z[0]*x[2],z[0]*x[1]-z[1]*x[0]];
    const travel=25*(1-workEase(Math.max(0,Math.min(1,(now-this.start)/1500))));
    const world=new DOMMatrix([x[0],x[1],x[2],0,y[0],y[1],y[2],0,z[0],z[1],z[2],0,this.particleGaze[0],this.particleGaze[1],22+(this.target?travel:0),1]);
    return{world,view:world.inverse(),projection,quaternion:quaternion(world)};
  }
  particleModel(){return new DOMMatrix().translate(...this.config.particlePosition).rotate(...this.config.particleRotation).scale(...this.config.particleScale);}
  step(now,dt){
    if(this.index===null)return;this.simStarted??=now;
    const r=this.renderer,p=r.pipeline,camera=this.lastParticleCamera??this.particleCamera(now);
    const values={...this.splineValues,uSetup:now-this.simStarted<100?1:0,fSize:this.config.particleSize,uMaxCount:this.config.particleSize**2,HZ:dt/(1000/60)};
    r.updateGlobals(camera);
    p.pass('detail-life',this.life[1],values,{tInput:this.life[0].textures[0],tPos:this.positions[0].textures[0],tAttribs:this.random,tOrigin:this.origin});this.life.reverse();
    p.pass('detail-simulation',this.positions[1],{...values,uProjMatrix:camera.projection.multiply(camera.view).toFloat32Array(),uProjNormalMatrix:camera.world.toFloat32Array(),uModelMatrix:this.particleModel().toFloat32Array()},{tInput:this.positions[0].textures[0],tLife:this.life[0].textures[0],tAttribs:this.random,tOrigin:this.origin,tSpline:this.spline,tFluid:r.fluid.velocity,tFluidMask:r.fluid.mask});this.positions.reverse();
  }
  render(now){
    const r=this.renderer,p=r.pipeline,c=this.config,camera=this.camera(now),width=innerWidth*r.settings.sceneDPR,height=innerHeight*r.settings.sceneDPR;
    const a=p.target('work-detail-'+(this.swap??0),width,height,3,true),previous=p.target('work-detail-'+(1-(this.swap??0)),width,height,3,true);
    const portrait=innerWidth<500,scale=c.videoScale.slice();if(portrait){const factor=Math.max(.45,Math.min(1,.45+(innerWidth-350)/450*.55));scale[0]*=factor;scale[1]*=factor;}
    const cubeWorld=new DOMMatrix().translate(0,0,1.75).scale(innerWidth/innerHeight*5,5,5);
    const filmWorld=new DOMMatrix().translate(0,portrait?.5:0,2).scale(...scale);
    this.filmWorld=filmWorld.toFloat32Array();this.lastCamera=camera;
    const source={name:'WorkDetail',meshes:[
      {id:'detail-cube',visible:true,geometry:c.cubeGeometry,material:c.cubeMaterial,world:cubeWorld.toFloat32Array()},
      {id:'detail-film',visible:true,geometry:c.planeGeometry,material:c.videoMaterial,world:filmWorld.toFloat32Array()},
    ]};
    const particleCamera=this.lastParticleCamera=this.particleCamera(now),particleModel=this.particleModel();
    const particleTarget=p.target('work-detail-particles',width,height,1,true);
    p.bind(particleTarget,true);r.drawScene({name:'WorkDetailParticles',meshes:[{id:'detail-particles',isPoints:true,visible:true,geometry:c.particleGeometry,material:c.particleMaterial,world:particleModel.toFloat32Array()}]},particleCamera,{textures:new Map([[c.particleMaterial,{tPos:this.positions[0].textures[0],tVideo:r.workCards.mediaTexture}]])},r.empty);
    const textures=new Map([[c.cubeMaterial,{tPrevFrame:previous.textures[0],tRefraction:particleTarget.textures[0]}],[c.videoMaterial,{tMap:r.workCards.mediaTexture}]]);
    p.bind(a,true);r.drawScene(source,camera,{textures},r.empty);
    const output=p.target('work-detail-composite',width,height);
    const result=p.pass(c.compositeMaterial,output,{}, {tDiffuse:a.textures[0]});this.swap=1-(this.swap??0);return result;
  }
}
