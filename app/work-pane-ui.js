import { sdfText } from './sdf-text.js';
export class WorkPaneUI {
  constructor(renderer, layer) {
    this.renderer=renderer;this.layer=layer;this.cards=[];
    this.blockTexture=renderer.uploadTexture(new Uint8Array([6,6,6,255]),1,1,false);
    for(const card of renderer.data.ownerWork){
      const size=.9*(130-30*Math.min(1,Math.max(0,(card.title.length-5)/15)));
      const category=layer.textGeometry('work-category-'+card.slug,card.category.toUpperCase(),24,{align:'center',letterSpacing:.1,lineHeight:1.8});
      const title=layer.textGeometry('work-title-'+card.slug,card.title,size,{align:'center',letterSpacing:.01,lineHeight:1.1,width:700});
      const titleHeight=layer.labels.get('work-title-'+card.slug).data.height,categoryHeight=layer.labels.get('work-category-'+card.slug).data.height;
      const copyHeight=sdfText(layer.font,'X',18,{lineHeight:1.6}).height;
      const y=470-.5*titleHeight-.5*copyHeight-.5*categoryHeight,titleY=y+categoryHeight+40;
      const target=renderer.pipeline.target('work-pane-ui-'+card.slug,1024,1024);
      const texture=renderer.data.materials[card.labelMaterial].uniforms.tMap.value.texture;
      renderer.textures[texture]=target.textures[0];
      this.cards.push({card,target,category,title,categoryY:y,titleY,blockY:titleY+.8*(titleHeight-.7*titleHeight),blockHeight:.7*titleHeight,frames:100});
    }
  }
  draw(record,now) {
    const r=this.renderer,gl=r.gl,layer=this.layer;
    r.pipeline.bind(record.target,true);r.elapsed=now/1000;
    const fill=r.data.navigation.fillMaterial,camera=layer.camera(1024,1024);
    const block=layer.rectangle('label-block',fill,12,record.blockY,1000,record.blockHeight),underline=layer.rectangle('label-underline',fill,0,0,924,2);
    r.drawScene({name:'WorkPaneUI',meshes:[block]},camera,{textures:new Map([[fill,{tMap:this.blockTexture}]])});
    r.drawScene({name:'WorkPaneUI',meshes:[underline]},camera,{textures:new Map([[fill,{tMap:r.white}]])});
    const material=r.data.navigation.textMaterial;
    const meshes=[{id:'category',geometry:record.category,y:record.categoryY},{id:'title',geometry:record.title,y:record.titleY}].map(item=>({id:item.id,visible:true,geometry:item.geometry,material,world:new DOMMatrix().translate(512,-item.y,0).toFloat32Array()}));
    r.drawScene({name:'WorkPaneUI',meshes},camera,{uniforms:new Map([[material,{uColor:[1,1,1],uAlpha:1}]])});
    record.frames--;
  }
  update(distances,now) {
    for(const record of this.cards)if(record.frames>0&&(distances.get(record.card.index)??Infinity)<6)this.draw(record,now);
  }
}
