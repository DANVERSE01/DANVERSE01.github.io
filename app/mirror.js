import { quaternion } from './controller.js';
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const normalize=a=>{const n=Math.hypot(...a);return a.map(v=>v/n)};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function reflectedCamera(camera, surface) {
  const origin=[surface.m41,surface.m42,surface.m43];
  const normal=normalize([surface.m31,surface.m32,surface.m33]);
  const reflectDirection=v=>{const d=2*dot(v,normal);return v.map((x,i)=>x-d*normal[i])};
  const position=[camera.world.m41,camera.world.m42,camera.world.m43];
  const distance=2*dot(sub(position,origin),normal);
  const eye=position.map((v,i)=>v-distance*normal[i]);
  const forward=reflectDirection([-camera.world.m31,-camera.world.m32,-camera.world.m33]);
  const up=reflectDirection([camera.world.m21,camera.world.m22,camera.world.m23]);
  const z=normalize(forward.map(v=>-v)),x=normalize(cross(up,z)),y=cross(z,x);
  const world=new DOMMatrix([...x,0,...y,0,...z,0,...eye,1]),view=world.inverse();
  const projection=new DOMMatrix(camera.projection.toFloat32Array());
  const bias=new DOMMatrix([.5,0,0,0,0,.5,0,0,0,0,.5,0,.5,.5,.5,1]);
  const textureMatrix=bias.multiply(projection).multiply(view);
  const clip=[dot(x,normal),dot(y,normal),dot(z,normal),dot(sub(eye,origin),normal)];
  const q=[(Math.sign(clip[0])+projection.m31)/projection.m11,(Math.sign(clip[1])+projection.m32)/projection.m22,-1,(1+projection.m33)/projection.m43];
  const scale=2/dot(clip,q),c=clip.map(v=>v*scale);
  projection.m13=c[0];projection.m23=c[1];projection.m33=c[2]+1-.01;projection.m43=c[3];
  return {world,view,projection,quaternion:quaternion(world),textureMatrix};
}

export function renderWaterReflection(renderer, source, camera, overrides) {
  const water=source.meshes.find(m=>renderer.data.materials[m.material].fragmentName==='TreeWaterShader');
  if(!water)return;
  const reflected=reflectedCamera(camera,new DOMMatrix(overrides.world.get(water.id)??water.world));
  const target=renderer.pipeline.target('tree-water-reflection',1024,1024,1,true);
  const meshes=source.meshes.filter(m=>['TreeFBR','LogoParticleShader'].includes(renderer.data.materials[m.material].fragmentName));
  const uniforms=new Map(overrides.uniforms);
  for(const mesh of meshes)uniforms.set(mesh.material,{...uniforms.get(mesh.material),uIsMirror:1});
  renderer.pipeline.bind(target,true);
  renderer.drawScene({...source,meshes},reflected,{...overrides,uniforms},renderer.empty);
  overrides.uniforms.set(water.material,{...overrides.uniforms.get(water.material),uMirrorMatrix:reflected.textureMatrix.toFloat32Array(),uIsMirror:0});
  overrides.textures??=new Map();overrides.textures.set(water.material,{tMirrorReflection:target.textures[0]});
  renderer.mirrorCamera=reflected;
}
