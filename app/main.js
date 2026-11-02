import { SpatialRenderer } from './renderer.js';
import { SceneController, hitPlane } from './controller.js';
import { Navigation } from './navigation.js';
import { LoadingIntro } from './loading.js';
import { readAsset } from './assets.js';
import { routeFor, projectProgress } from './routes.js';

const canvas = document.getElementById('world'), loading = document.getElementById('loading');
const contact = document.getElementById('contact');
const project = document.getElementById('project'), projectFilm=project.querySelector('video');
const filmModal=document.getElementById('film-modal'),fullFilm=filmModal.querySelector('video');
let renderer, controller, frameId = 0, touchY = null, running = true;
let loadedData=null,renderGeneration=0,disposed=false,recoverySnapshot=null,entranceDelivered=false;
let routesEnabled=true;

const events = new AbortController();
const navigation=new Navigation(document.querySelector('header nav'));
const loadingIntro=new LoadingIntro(loading);
document.querySelector('header').inert=true;
const listen = (name, callback, options = {}) => addEventListener(name, callback, { ...options, signal: events.signal });
let contactFocus=null;
let pointerStart=null,projectFocus=null,projectTimer=0;
const overlayOpen=()=>!contact.hidden||!project.hidden||!filmModal.hidden;
function openFilm(){
  const card=renderer?.data.ownerWork[renderer.workDetail.index];if(!card?.video||project.hidden)return;
  fullFilm.src=card.video;fullFilm.poster=card.poster;filmModal.hidden=false;document.getElementById('close-film').focus();fullFilm.play().catch(()=>{});
}
function closeFilm(){filmModal.hidden=true;fullFilm.pause();fullFilm.removeAttribute('src');fullFilm.load();if(!project.hidden)document.getElementById('close-project').focus();}
function openProject(index,updateRoute=true){
  const card=renderer.data.ownerWork[index];if(!card||overlayOpen())return;
  projectFocus=document.activeElement;controller.down=false;controller.focusWork(index);renderer.workDetail.open(index);
  project.hidden=false;project.dataset.slug=card.slug;project.classList.remove('visible');
  project.querySelector('h1').textContent=card.title;project.querySelector('p').textContent=card.statement;
  project.querySelector('.project-category').textContent=card.category;
  document.getElementById('play-project').hidden=!card.video;document.title=card.title+' — DANVERSE';
  projectFilm.poster=card.poster;
  document.getElementById('close-project').focus();
  projectTimer=setTimeout(()=>project.classList.add('visible'),1500);
  if(routesEnabled&&updateRoute)history.pushState({project:card.slug},'', '/work/'+card.slug+location.search);
}
function closeProject(updateRoute=true){
  closeFilm();
  if(project.hidden)return;clearTimeout(projectTimer);project.hidden=true;project.classList.remove('visible');projectFilm.pause();projectFilm.removeAttribute('src');projectFilm.load();
  renderer.workDetail.close();controller?.releaseWork();document.querySelector('header').inert=false;canvas.inert=false;projectFocus?.focus();
  document.title='DANVERSE — Spatial Experience';
  if(routesEnabled&&updateRoute)history.pushState(null,'','/work'+location.search);
}
function openContact(){contactFocus=document.activeElement;contact.hidden=false;document.querySelector('header').inert=true;canvas.inert=true;document.getElementById('close-contact').focus();}
function closeContact(){contact.hidden=true;document.querySelector('header').inert=false;canvas.inert=false;contactFocus?.focus();}

function failure(error) {
  document.documentElement.dataset.sceneError = error.message;
  console.error(error);
  loadingIntro.fail(Error('The experience could not load. Please reload.'));
  const fallback=document.getElementById('fallback');
  if(fallback){running=false;cancelAnimationFrame(frameId);renderer?.dispose();fallback.hidden=false;loading.hidden=true;document.body.classList.add('render-unavailable');}
  
}

function snapshot(){
  const fields=['scroll','target','scrollTween','viewportHeight','rotation','pulse','globalScroll','velocity','cameraY','visible','introStarted','aboutRotation','footerRotation','aboutDelta','footerDelta','sparkle','hexTime','hexHold','hexHoldTarget','workPosition','workQuaternion'];
  return {controller:Object.fromEntries(fields.filter(key=>controller?.[key]!==undefined).map(key=>[key,controller[key]])),projectIndex:renderer?.workDetail?.target?renderer.workDetail.index:null};
}
async function initialize(saved=null) {
  const generation=++renderGeneration;
  const request = (path, json = false) => readAsset(path,json?'json':'binary');
  const [manifest, binary, auxiliary, effects] = loadedData??await Promise.all([
    request('/assets/data/dcb21f34c47323719c86.json', true), request('/assets/data/4dad71cbae95913ae4b5.parts.json'),
    request('/assets/data/c8a1c1d9d909f634dcbf.parts.json'), request('/assets/data/f57acf961dd88db102bd.json', true),
  ]);
  if(disposed||generation!==renderGeneration)return;
  loadedData=[manifest,binary,auxiliary,effects];
  controller = new SceneController(manifest);
  const initialRoute=routesEnabled?routeFor(location.pathname,manifest.ownerWork):{work:false,index:-1};
  if(!saved&&initialRoute.work){const entry=(innerHeight+20)/(controller.ranges[2].height+innerHeight);controller.seek(2,initialRoute.index>=0?Math.max(entry,projectProgress(initialRoute.index,manifest.ownerWork.length,controller.mobile)):entry);}
  if(saved){Object.assign(controller,saved.controller);controller.reflow();controller.last=0;controller.down=false;}
  renderer = new SpatialRenderer(canvas, manifest, binary, auxiliary, effects);
  const currentRenderer=renderer;
  try{await currentRenderer.loadTextures();await currentRenderer.loadDynamics();await currentRenderer.prepareScenePrograms();}catch(error){if(generation===renderGeneration&&!disposed)throw error;return;}
  if(disposed||generation!==renderGeneration){currentRenderer.dispose();return;}
  if(!entranceDelivered)controller.visible=0;
  else if(saved.projectIndex!==null){currentRenderer.workDetail.open(saved.projectIndex);currentRenderer.workDetail.start=performance.now()-1500;}
  delete document.documentElement.dataset.sceneError;running=true;
  renderer.entranceStarted=controller.introStarted??Infinity;
  let firstFrame=true;
  const finished=new Promise(resolve=>{
    currentRenderer.onEntrance=resolve;
  });
  function frame(now) {
    if (!running||generation!==renderGeneration||disposed) return;
    try {
      const state = controller.update(now);
      navigation.update(now,state.velocity,!contact.hidden);
      renderer.workDetail.update(now);
      renderer.workCards.update(state.current,controller,now);
      if(state.next?.source.name==='Work')renderer.workCards.update(state.next,controller,now);
      renderer.draw(now, state.current.progress, controller.pointer, state);
      navigation.mobile=controller.mobile;renderer.navigationLayer.draw(now,state,navigation);
      if(routesEnabled&&entranceDelivered&&project.hidden){const path=state.current.source.name==='Work'?'/work':'/';if(location.pathname!==path)history.replaceState(null,'',path+location.search);}
      if(firstFrame){
        firstFrame=false;
        const handoff=success=>{if(success===false){failure(loadingIntro.error??Error('Loading failed'));return;}if(disposed||generation!==renderGeneration)return;if(!entranceDelivered){controller.startEntrance();entranceDelivered=true;}renderer.entranceStarted=controller.introStarted;document.documentElement.dataset.sceneReady='true';loading.hidden=true;loading.classList.remove('restoring');document.querySelector('header').inert=!contact.hidden;if(!saved&&initialRoute.index>=0)openProject(initialRoute.index,false);currentRenderer.onEntrance();};
        if(entranceDelivered)handoff();else loadingIntro.complete().then(handoff);
      }
      frameId = requestAnimationFrame(frame);
    } catch (error) { running = false; failure(error); }
  }
  frameId = requestAnimationFrame(frame);
  
  await finished;
  
}
async function boot(){
  await loadingIntro.start();
  
  await initialize();
}
boot().catch(failure);

listen('wheel', event => {
  if(document.body.classList.contains('render-unavailable')||!filmModal.hidden)return;
  if(!project.hidden){event.preventDefault();if(Math.abs(event.deltaY)>(controller.mobile?20:10))closeProject();return;}
  if (overlayOpen() || !controller || !loading.hidden) return;
  event.preventDefault(); controller.wheel(event);
}, { passive: false });
listen('pointermove', event => controller?.move(event.clientX, event.clientY), { passive: true });
listen('pointerdown', event => { if (controller && loading.hidden && contact.hidden && filmModal.hidden && event.target === canvas) {pointerStart=[event.clientX,event.clientY];controller.startPointer(event.clientX, event.clientY);} });
listen('pointerup', () => { if (controller) controller.down = false; });
listen('pointercancel', () => { if (controller) controller.down = false; });
listen('blur', () => { if (controller) controller.down = false; });
listen('touchstart', event => { touchY = event.touches[0]?.clientY ?? null; }, { passive: true });
listen('touchmove', event => {
  if(document.body.classList.contains('render-unavailable')||!filmModal.hidden)return;
  if(touchY!==null&&!project.hidden){const y=event.touches[0].clientY;if(Math.abs(touchY-y)>20)closeProject();touchY=y;event.preventDefault();return;}
  if (touchY === null || overlayOpen() || !controller || !loading.hidden) return;
  const y = event.touches[0].clientY;
  controller.wheel({ deltaY: touchY - y, deltaMode: 0 }); touchY = y; event.preventDefault();
}, { passive: false });
listen('touchend', () => { touchY = null; if (controller) controller.down = false; }, { passive: true });
listen('resize', () => { renderer?.resize(); controller?.reflow(); });
listen('keydown', event => {
  if(document.body.classList.contains('render-unavailable'))return;
  if(event.key==='Escape'&&!filmModal.hidden){closeFilm();return;}
  if (event.key === 'Escape') { if(!project.hidden)closeProject();else closeContact(); return; }
  if(overlayOpen()&&event.key==='Tab'){
    const dialog=filmModal.hidden?(contact.hidden?project:contact):filmModal,items=Array.from(dialog.querySelectorAll('a,button,video')).filter(item=>item.getClientRects().length>0),first=items[0],last=items.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    return;
  }
  if (!controller || overlayOpen() || !loading.hidden) return;
  const distance = { ArrowDown: innerHeight * .25, ArrowUp: -innerHeight * .25, PageDown: innerHeight, PageUp: -innerHeight, ' ': innerHeight * .75 }[event.key];
  if (distance != null) { event.preventDefault(); controller.wheel({ deltaY: distance, deltaMode: 0 }); }
});
listen('popstate',()=>{
  if(!routesEnabled||!renderer||!controller)return;
  const route=routeFor(location.pathname,renderer.data.ownerWork);
  if(!project.hidden)closeProject(false);
  if(route.index>=0){controller.seek(2,Math.max((innerHeight+20)/(controller.ranges[2].height+innerHeight),projectProgress(route.index,renderer.data.ownerWork.length,controller.mobile)));controller.workPosition=null;controller.update(performance.now());openProject(route.index,false);}
  else if(route.work&&controller.sceneIndex!==2)controller.go(2);
});
document.querySelector('a[href="#explore"]').addEventListener('click', event => { event.preventDefault();if(!contact.hidden)closeContact();if(!project.hidden)closeProject();controller?.go(2); });
document.querySelector('a[href="#contact"]').addEventListener('click', event => { event.preventDefault(); openContact(); });
document.getElementById('close-contact').addEventListener('click',closeContact);
document.getElementById('close-project').addEventListener('click',()=>closeProject());
document.getElementById('close-film').addEventListener('click',closeFilm);
document.getElementById('play-project').addEventListener('click',openFilm);
canvas.addEventListener('click',event=>{
  if(!pointerStart||Math.hypot(event.clientX-pointerStart[0],event.clientY-pointerStart[1])>8)return;
  pointerStart=null;
  if(!project.hidden&&filmModal.hidden&&renderer.workDetail.filmWorld&&hitPlane(renderer.workDetail.lastCamera,renderer.workDetail.filmWorld,controller.pointer)){openFilm();return;}
  if(overlayOpen())return;
  if(controller?.sceneIndex===4&&controller.labHovered)openContact();
  else if(controller?.sceneIndex===2&&renderer.workCards.hovered>=0)openProject(renderer.workCards.hovered);
},{signal:events.signal});
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault();recoverySnapshot=snapshot();renderGeneration++;running=false;cancelAnimationFrame(frameId);renderer?.dispose();
  if(entranceDelivered){loading.querySelector('.loading-status').textContent='Restoring the experience';loading.hidden=false;loading.classList.add('restoring');}
},{signal:events.signal});
canvas.addEventListener('webglcontextrestored',()=>{const saved=recoverySnapshot;recoverySnapshot=null;initialize(saved).catch(failure);},{signal:events.signal});
listen('pagehide', () => { disposed=true;renderGeneration++;running = false; cancelAnimationFrame(frameId);clearTimeout(projectTimer);projectFilm.pause();fullFilm.pause(); events.abort();loadingIntro.dispose(); renderer?.dispose(); });
