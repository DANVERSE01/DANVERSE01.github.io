import { hitPlane } from './controller.js';

const damping=(rate,dt)=>1-Math.pow(1-rate,dt/(1000/60));

export class WorkCards {
  get mediaTexture(){const card=this.cards[this.active];return card?.detailTexture!=null?this.renderer.textures[card.detailTexture]:card?.video&&this.video.readyState>=2?this.texture:card?this.renderer.textures[this.renderer.data.materials[card.paneMaterial].uniforms.tMap.value.texture]:this.renderer.empty;}
  constructor(renderer) {
    this.renderer=renderer;this.cards=renderer.data.ownerWork??[];
    this.hover=new Float32Array(this.cards.length);this.mouse=[.5,.5];this.active=-1;this.hovered=-1;
    this.video=document.createElement('video');this.video.muted=true;this.video.loop=true;this.video.playsInline=true;this.video.preload='auto';
    this.texture=renderer.uploadTexture(new Uint8Array([0,0,0,255]),1,1,false);
    const gl=renderer.gl;gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    this.video.addEventListener('loadeddata',()=>{this.readyAt=performance.now();this.video.play().catch(()=>{});});
  }

  update(state,controller,now) {
    if(state.source.name!=='Work'){this.hovered=-1;this.video.pause();return;}
    const dt=controller.frameDt??16.667,portrait=controller.mobilePortrait,source=state.source;
    const count=this.cards.length,total=Math.min(7,count),camera=state.camera;
    const groupCamera=[camera.world.m41-2*camera.world.m31,camera.world.m42-2*camera.world.m32,camera.world.m43-2*camera.world.m33];
    this.mouse[0]+=((controller.pointer[0]+1)*.5-this.mouse[0])*damping(.08,dt);
    this.mouse[1]+=((1-controller.pointer[1])*.5-this.mouse[1])*damping(.08,dt);
    const ordered=[];this.hovered=-1;
    for(const card of this.cards){
      const i=card.index,angle=-(portrait?35:50)*i,y=(portrait?4:0)-(portrait?.16:.12)*total*i;
      const group=new DOMMatrix().translate(3.8*Math.cos(angle*Math.PI/180),y,3.8*Math.sin(angle*Math.PI/180)).rotateAxisAngle(0,1,0,90-angle);
      const pane=group.rotateAxisAngle(0,0,1,180).scale(portrait?2.9:4,portrait?2.7:2.6,1);
      const label=group.scale(4,2,1);
      const distance=Math.hypot(group.m41-groupCamera[0],group.m42-groupCamera[1],group.m43-groupCamera[2]);
      ordered.push({card,distance,group,pane,label});
    }
    ordered.sort((a,b)=>b.distance-a.distance);
    this.renderer.workPaneUI.update(new Map(ordered.map(item=>[item.card.index,item.distance])),now);
    for(const item of ordered){if(item.distance*item.distance<=30&&hitPlane(camera,item.pane,controller.pointer))this.hovered=item.card.index;}
    const nearest=this.pinned??ordered.at(-1)?.card.index??-1;
    if(nearest!==this.active){this.active=nearest;this.readyAt=Infinity;this.video.pause();if(this.cards[nearest].video){this.video.src=this.cards[nearest].video;this.video.load();this.video.play().catch(()=>{});}else{this.video.removeAttribute('src');this.video.load();}}
    else if(this.cards[nearest].video&&this.video.paused&&this.video.readyState>=2)this.video.play().catch(()=>{});
    const gl=this.renderer.gl;
    if(this.video.readyState>=2){gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.video);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);}
    state.overrides.textures??=new Map();
    const meshes=source.meshes.filter(mesh=>mesh.ownerCard==null);
    for(const {card,distance,pane,label} of ordered){
      const i=card.index;this.hover[i]+=((this.hovered===i?1:0)-this.hover[i])*damping(.08,dt);
      const fade=Math.min(1,Math.max(0,(now-this.readyAt-300)/500));
      state.overrides.world.set(card.paneMesh,pane.toFloat32Array());state.overrides.world.set(card.labelMesh,label.toFloat32Array());
      state.overrides.uniforms.set(card.paneMaterial,{uMouse:this.mouse,uHover:this.hover[i],uVideoBlend:i===nearest?Math.sin(fade*Math.PI/2):0,uScale:portrait?[1.6,.9]:[1,1],uPhone:portrait?1:0});
      state.overrides.uniforms.set(card.labelMaterial,{uHover:this.hover[i],uCamDistance:distance});
      state.overrides.textures.set(card.paneMaterial,{tVideo:this.texture});
      meshes.push(source.meshes.find(mesh=>mesh.id===card.paneMesh),source.meshes.find(mesh=>mesh.id===card.labelMesh));
    }
    state.source={...source,meshes};
  }

  dispose(){this.video.pause();this.video.removeAttribute('src');this.video.load();this.renderer.releaseTexture(this.texture);}
}
