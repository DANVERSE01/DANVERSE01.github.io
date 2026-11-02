import { sdfText } from './sdf-text.js';
import { workEase } from './controller.js';
import { readAsset } from './assets.js';

export class NavigationLayer {
  constructor(renderer){this.renderer=renderer;this.config=renderer.data.navigation;this.labels=new Map();this.tint=0;this.tintTarget=0;this.color=[1,1,1];}
  async load(){this.font=await readAsset('/assets/data/71b600a7d72e46851f32.json','json');}
  camera(width,height){const near=.01,far=1000,world=new DOMMatrix().translate(width/2,-height/2,1),projection=new DOMMatrix([2/width,0,0,0,0,2/height,0,0,0,0,-2/(far-near),0,0,0,-(far+near)/(far-near),1]);return{world,view:world.inverse(),projection,quaternion:[0,0,0,1]};}
  textGeometry(key,text,size=12,options={}){
    const r=this.renderer,old=this.labels.get(key);if(old?.text===text)return old.geometry;
    const data=sdfText(this.font,text,size,options);
    const existing=r.data.geometries.findIndex(record=>record.runtimeKey===key);
    const id=old?.geometry??(existing>=0?existing:r.data.geometries.length);
    r.data.geometries[id]={id,runtimeKey:key,attributes:{position:{direct:data.position,itemSize:3,count:data.position.length/3},uv:{direct:data.uv,itemSize:2,count:data.uv.length/2}},index:{direct:data.index},isInstanced:false};
    if(old){const program=r.program(this.config.textMaterial),binding=r.geometry.get(id+':'+program.record.id);if(binding){const gl=r.gl;gl.bindBuffer(gl.ARRAY_BUFFER,binding.attributeBuffers.get('position'));gl.bufferData(gl.ARRAY_BUFFER,data.position,gl.DYNAMIC_DRAW);gl.bindBuffer(gl.ARRAY_BUFFER,binding.attributeBuffers.get('uv'));gl.bufferData(gl.ARRAY_BUFFER,data.uv,gl.DYNAMIC_DRAW);binding.count=data.index.length;}}
    this.labels.set(key,{text,geometry:id,data});return id;
  }
  rectangle(id,material,x,y,width,height){return{id,visible:true,material,geometry:this.config.planeGeometry,world:new DOMMatrix().translate(x+width/2,-y-height/2,0).scale(width,height,1).toFloat32Array()};}
  draw(now,state,navigation){
    const r=this.renderer,c=this.config,phone=navigation.mobile??state.mobilePortrait,noMusic=!!phone,width=noMusic?300:340,height=320,bx=innerWidth-width+(noMusic?20:10),by=noMusic?-106:-95;
    const elapsed=now-(r.entranceStarted??now);const a=Math.max(0,Math.min(1,(elapsed-1000)/2000)),alpha=.5-.5*Math.cos(a*Math.PI),delta=state.velocity??0;
    const projectTarget=r.workDetail.target;
    if(projectTarget!==this.tintTarget){this.tintFrom=this.tint;this.tintTarget=projectTarget;this.tintStarted=now;if(projectTarget)this.color=r.data.ownerWork[r.workDetail.index].color;}
    this.tint=(this.tintFrom??0)+(this.tintTarget-(this.tintFrom??0))*workEase(Math.max(0,Math.min(1,(now-(this.tintStarted??now))/1500)));
    const baseY=by+.475*height+4.5*delta,workX=bx+80-(noMusic?8:0),contactX=bx+width*(noMusic?.5:.6)-2+(noMusic?20:0),audioWidth=noMusic?30:50,audioX=bx+.5*width-audioWidth/2-13-(noMusic?2:0);
    const meshes=[this.rectangle('nav-background',c.backgroundMaterial,bx,by,width,height),this.rectangle('nav-audio',c.audioMaterial,audioX,baseY-12,audioWidth,40)];
    const overrides={uniforms:new Map([[c.backgroundMaterial,{uAlpha:alpha,uScroll:state.globalScroll,uScrollDelta:delta,uUIColor:this.color,uUIBlend:this.tint}],[c.audioMaterial,{uAlpha:alpha*(noMusic?.6:1),uScroll:state.globalScroll,uAmplitude:0,uHover:0}]])};
    for(const [i,item] of navigation.items.entries()){
      const x=i===0?workX:contactX,geometry=this.textGeometry('nav-label-'+i,item.element.textContent);
      meshes.push({id:'nav-text-'+i,visible:true,material:c.textMaterial,geometry,world:new DOMMatrix().translate(x,-baseY,0).toFloat32Array(),uiAlpha:item.alpha*alpha});
      item.element.style.left=(x-10)+'px';item.element.style.top=(baseY-10)+'px';item.element.style.transform='none';
    }
    r.pipeline.bind(null);const camera=this.camera(innerWidth,innerHeight);
    r.drawScene({name:'Navigation',meshes:meshes.slice(0,2)},camera,overrides);
    for(const mesh of meshes.slice(2))r.drawScene({name:'Navigation',meshes:[mesh]},camera,{uniforms:new Map([[c.textMaterial,{uAlpha:mesh.uiAlpha,uColor:[1,1,1]}]])});
    document.documentElement.dataset.navReady='true';
  }
}
