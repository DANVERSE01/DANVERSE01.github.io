import { readAsset } from './assets.js';
export class LogoSimulation {
  constructor(renderer){this.renderer=renderer;}
  async load(){
    const r=this.renderer;
    const [metadata,raw]=await Promise.all([readAsset('/assets/data/19761dca0cc3c71db027.json','json'),readAsset('/assets/data/702315210dc1830ec4e9.bin.gz')]);
    this.metadata=metadata;
    if(raw.byteLength!==metadata.rawBytes)throw Error('Owner distance-field size mismatch');
    this.sdf=r.uploadTexture(new Float32Array(raw),metadata.width,metadata.height,true,1);
    this.pair=[0,1].map(i=>r.pipeline.target('owner-logo-simulation-'+i,256,256,1,false,'float32',false));
    r.pipeline.pass('copy',this.pair[0],{}, {tMap:r.textures[37]});
    const scene=r.data.scenes[3],mesh=scene.meshes.find(mesh=>mesh.material===27);
    this.mesh=mesh;
    const camera=r.cameraFor(scene);
    for(let i=0;i<24;i++)this.update(16.667,camera,mesh.world,false);
  }
  update(dt,camera,world,interactive=true){
    const r=this.renderer,m=this.metadata;
    r.pipeline.pass('owner-logo-simulation',this.pair[1],{HZ:dt/(1000/60),fSize:256,uMaxCount:65536,uSDFMin:m.min,uSDFMax:m.max,uSDFSize:m.size,uSDFTiles:m.tiles,uProjMatrix:camera.projection.multiply(camera.view).toFloat32Array(),uProjNormalMatrix:camera.world.toFloat32Array(),uModelMatrix:world},{tInput:this.pair[0].textures[0],tOrigin:r.textures[37],tAttribs:r.textures[38],tLogoSDF:this.sdf,tFluid:interactive?r.fluid.velocity:r.empty,tFluidMask:interactive?r.fluid.mask:r.empty});
    this.pair.reverse();r.textures[39]=this.pair[0].textures[0];
  }
}
