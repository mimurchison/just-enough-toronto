import {groundHeight,groundGradient} from './terrain';
import * as THREE from 'three';
import {RGBELoader} from 'three/addons/loaders/RGBELoader.js';
import { makeCart, material, box, PALETTE, TRAM_LENGTH } from './world';
import {makeGeoWorld,STREAM_RADIUS} from './geo-world';
import {StreetPhysics} from './physics';
import {START,VISITS,queenZ,project} from './geography';
import {QUEEN_UNDERPASS} from './queen-underpass';
import {buildTorontoSkyline,CN_TOWER} from './toronto-skyline';
import {PASTEL,applyPastelMaterials} from './pastel-style';
import {ContactOcclusion} from './contact-occlusion';
import {FilmFinish} from './film-finish';
import {StreetLife} from './street-life';
import {makeGoldenSun,followGoldenSun} from './golden-hour';
import {GRAPHICS,describeGpu,renderScale,savedQuality,type RenderQuality} from './render-quality';
import type { World } from './world';
import {makePip,type PipModel} from './pip-model';
import { worldPoint, moveWithCollision, approachAngle, angleDelta, pathAt, smoothRoute, rigRoute, blocked, followCart } from './motion';
import type { Obstacle } from './motion';
import { factsForDay, NODES } from './game';
import type { FactId, Journey, Point } from './game';

/**
 * An optional layer on top of the street (the hidden Rush mode). While driving() is
 * true it owns the camera and keyboard, Pip walks herself, and level of detail,
 * shadows and focus follow focus() instead of Pip.
 */
export type SceneAddon={
  /** Fixed 90 Hz step, before the physics world steps. */
  fixedStep(dt:number):void;
  /** Once per rendered frame; alpha is how far this frame falls between fixed steps. */
  frame(dt:number,alpha:number):void;
  driving():boolean;
  focus():THREE.Vector3;
  speed():number;
  updateCamera(camera:THREE.PerspectiveCamera,dt:number):void;
  /** A map visit just moved Pip here; while driving, the addon brings the car along. */
  visited?(x:number,z:number):void;
  /** Where Pip walks while you drive in explore mode; undefined leaves her standing. */
  pipAutopilot?(dt:number,pip:{x:number;z:number;heading:number}):{x:number;z:number;heading:number;speed:number}|undefined;
};
export type CaptureLens={camera:[number,number,number];target:[number,number,number];fov:number};
export type SceneMode='title'|'explore'|'delivery'|'result'|'complete';
export class Neighbourhood {
 private captureLens?:CaptureLens;
 private life:StreetLife;
 private quality:RenderQuality=savedQuality();
 private film?:FilmFinish;
  private renderer:THREE.WebGLRenderer;private scene=new THREE.Scene();private camera=new THREE.PerspectiveCamera(60,1,.06,10000);
  private contactOcclusion?:ContactOcclusion;private colorPass={calls:0,triangles:0};
  private skyCloudTexture?:THREE.Texture;private skyTexture?:THREE.DataTexture;private world:World;private physics:StreetPhysics;private accumulator=0;private pip:PipModel;private cart=makeCart();private sun:THREE.DirectionalLight;private hemi:THREE.HemisphereLight;
  private keys=new Set<string>();private frame=0;private last=0;private elapsed=0;private disposed=false;private observer:ResizeObserver;
  private position=new THREE.Vector3();private cartPosition=new THREE.Vector3();private cartHeading=Math.PI/2;private trafficWait=false;private pendingSkip=false;private velocity=new THREE.Vector3();private inputYaw?:number;private heading=Math.PI/2;private cameraYaw=Math.PI/2;private cameraPitch=.16;private zoom=4;private distance=4;private camTarget=new THREE.Vector3();private drag?:{x:number;y:number;id:number};private lastOrbit=-100;
  private day=0;private mode:SceneMode='title';private inputLocked=true;public paused=false;private reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;private overview=false;
  private journey?:{points:Point[];length:number;distance:number;result:Journey;resolve:()=>void;progress:(p:number)=>void};
  private pauseBeforeContextLoss=false;private near?:FactId;private callout=document.createElement('button');private route=new THREE.Group();private eyeTarget=new THREE.Color(0xf6e3a3);private finishTime=-100;private lastBell=0;
  private eventKind:'dispatch'|'success'|'blocked'|undefined;private eventTime=0;
  private eventRing=new THREE.Mesh(new THREE.RingGeometry(.8,.91,64),new THREE.MeshBasicMaterial({color:0xffcc75,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide}));
  private eventBadge=new THREE.Group();private eventIcon=new THREE.Group();private eventStars:THREE.Mesh[]=[];
  private previousBodySpeed=0;private previousBodyHeading=Math.PI/2;
  private pickup=new THREE.Group();private parcelDelivered=new THREE.Group();private stepDistance=0;
  private addon?:SceneAddon;private frameCount=0;
  constructor(private host:HTMLElement,private onNear:(id:FactId|undefined)=>void,private onInspect:(id:FactId)=>void,private onSpeed:(speed:number)=>void,private onBell:()=>void){
    this.renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=PASTEL.exposure;this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label','Street-level 3D neighbourhood. Move Pip with WASD or arrow keys. Drag to look around.');this.renderer.domElement.tabIndex=-1;host.append(this.renderer.domElement);
    this.scene.fog=new THREE.Fog(PASTEL.fog,160,1900);performance.mark('enough:world-start');this.world=makeGeoWorld();performance.mark('enough:world');this.life=new StreetLife(this.world.group,this.world.obstacles);this.physics=new StreetPhysics(this.world.obstacles,this.world.worksBounds,this.world.snowBounds,this.life.bounds);this.scene.add(this.world.group,buildTorontoSkyline());
    this.hemi=new THREE.HemisphereLight(PASTEL.hemi,PASTEL.ground,.58);this.scene.add(this.hemi);
    this.sun=makeGoldenSun(PASTEL.sun);this.scene.add(this.sun,this.sun.target);
    new RGBELoader().load('/materials/golden-hour.hdr',texture=>{if(this.disposed){texture.dispose();return;}texture.mapping=THREE.EquirectangularReflectionMapping;this.skyTexture=texture;this.scene.environment=texture;this.scene.environmentIntensity=.30;this.scene.environmentRotation.y=1.8;},undefined,()=>{/* Keep the authored sky if the optional environment cannot load. */});
    new RGBELoader().load('/materials/pastel-clouds.hdr',texture=>{if(this.disposed){texture.dispose();return;}this.skyCloudTexture=texture;const sky=this.world.sky.material as THREE.ShaderMaterial;sky.uniforms.cloudMap.value=texture;sky.uniforms.cloudReady.value=1;},undefined,()=>{});
    this.pip=makePip();this.pip.group.scale.setScalar(.294);this.cart.scale.setScalar(.344);this.parcelDelivered.scale.setScalar(.35);this.scene.add(this.pip.group,this.cart,this.route,this.parcelDelivered);
    box(this.parcelDelivered,0,.22,0,.8,.38,.78,0xe9bd84,.06);box(this.parcelDelivered,0,.435,0,.86,.06,.84,0xffdca3,.03);box(this.parcelDelivered,0,.47,0,.08,.012,.85,0xd15b4a);this.parcelDelivered.visible=false;
    this.eventRing.rotation.x=-Math.PI/2;this.eventRing.visible=false;this.scene.add(this.eventRing,this.eventBadge);
    const disc=new THREE.Mesh(new THREE.CircleGeometry(.3,40),new THREE.MeshBasicMaterial({color:0x234a51}));this.eventBadge.add(disc,this.eventIcon);this.eventBadge.visible=false;
    const starShape=new THREE.Shape();starShape.moveTo(0,.17);starShape.lineTo(.045,.045);starShape.lineTo(.17,0);starShape.lineTo(.045,-.045);starShape.lineTo(0,-.17);starShape.lineTo(-.045,-.045);starShape.lineTo(-.17,0);starShape.lineTo(-.045,.045);starShape.closePath();
    const starGeo=new THREE.ShapeGeometry(starShape),starMat=new THREE.MeshBasicMaterial({color:0xffd58a,transparent:true,depthWrite:false});
    for(let i=0;i<7;i++){const star=new THREE.Mesh(starGeo,starMat);star.visible=false;this.scene.add(star);this.eventStars.push(star);}
    this.callout.className='world-prompt';this.callout.hidden=true;this.callout.addEventListener('click',()=>{if(this.near)this.onInspect(this.near);});host.append(this.callout);
    this.renderer.domElement.addEventListener('pointerdown',this.pointerDown);this.renderer.domElement.addEventListener('pointermove',this.pointerMove);this.renderer.domElement.addEventListener('pointerup',this.pointerUp);this.renderer.domElement.addEventListener('pointercancel',this.pointerUp);this.renderer.domElement.addEventListener('wheel',this.wheel,{passive:false});this.renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
    window.addEventListener('keydown',this.keyDown);window.addEventListener('keyup',this.keyUp);window.addEventListener('blur',this.release);document.addEventListener('visibilitychange',this.visibility);
    this.renderer.domElement.addEventListener('webglcontextlost',this.contextLost);this.renderer.domElement.addEventListener('webglcontextrestored',this.contextRestored);
    applyPastelMaterials(this.scene);
    this.applyGraphics();
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);this.resetRobot();this.visit('king-river');this.resize();this.snapCamera();this.frame=requestAnimationFrame(this.tick);
  }
  // ?post=off and ?ao=off still force those passes off at every tier.
  private applyGraphics(){
    const g=GRAPHICS[this.quality],url=new URLSearchParams(location.search);
    if(g.post&&url.get('post')!=='off')this.film??=new FilmFinish();else{this.film?.dispose();this.film=undefined;}
    if(this.film)this.film.depthOfField=g.depthOfField;
    if(g.contactOcclusion&&url.get('ao')!=='off')if(!this.contactOcclusion){this.contactOcclusion=new ContactOcclusion(this.scene,this.camera);for(const o of this.noContactShadow)this.contactOcclusion.exclude(o);}else{this.contactOcclusion?.dispose();this.contactOcclusion=undefined;}
    // Turning the sun's shadow off skips the shadow pass entirely; a new size reallocates the map.
    this.sun.castShadow=g.shadowMap>0;
    if(g.shadowMap>0&&this.sun.shadow.mapSize.x!==g.shadowMap){this.sun.shadow.mapSize.set(g.shadowMap,g.shadowMap);this.sun.shadow.map?.dispose();this.sun.shadow.map=null;}
    (this.scene.fog as THREE.Fog).far=g.lod.fog;
  }
  private resize(){const w=this.host.clientWidth,h=this.host.clientHeight;this.renderer.setPixelRatio(renderScale(this.quality,devicePixelRatio,w,h));this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();const pixels=this.renderer.getDrawingBufferSize(new THREE.Vector2());this.contactOcclusion?.resize(pixels.x,pixels.y);this.film?.resize(pixels.x,pixels.y,this.renderer.getPixelRatio());}
  private keyDown=(event:KeyboardEvent)=>{if(this.addon?.driving()||(event.target as HTMLElement)?.matches('input,textarea,select')||this.inputLocked||this.mode!=='explore'||this.paused)return;if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowLeft','ArrowDown','ArrowRight','ShiftLeft','ShiftRight'].includes(event.code)){event.preventDefault();this.keys.add(event.code);}};
  private keyUp=(event:KeyboardEvent)=>{this.keys.delete(event.code);};
  private release=()=>{this.keys.clear();this.inputYaw=undefined;this.drag=undefined;this.velocity.set(0,0,0);this.onSpeed(0);};
  private visibility=()=>{if(document.hidden)this.release();};
  private pointerDown=(e:PointerEvent)=>{if(this.addon?.driving()||e.button!==0||this.inputLocked||this.paused)return;this.drag={x:e.clientX,y:e.clientY,id:e.pointerId};this.renderer.domElement.setPointerCapture(e.pointerId);};
  private pointerMove=(e:PointerEvent)=>{if(!this.drag||e.pointerId!==this.drag.id)return;this.cameraYaw-=(e.clientX-this.drag.x)*.006;this.cameraPitch=THREE.MathUtils.clamp(this.cameraPitch+(e.clientY-this.drag.y)*.004,-.70,.95);this.drag={x:e.clientX,y:e.clientY,id:e.pointerId};this.lastOrbit=this.elapsed;};
  private pointerUp=(e:PointerEvent)=>{if(this.drag?.id===e.pointerId){if(this.renderer.domElement.hasPointerCapture(e.pointerId))this.renderer.domElement.releasePointerCapture(e.pointerId);this.drag=undefined;}};
  private wheel=(e:WheelEvent)=>{if(this.addon?.driving()||this.inputLocked||this.paused)return;e.preventDefault();this.zoom=THREE.MathUtils.clamp(this.zoom+e.deltaY*.007,2.4,18);};
  private contextLost=(event:Event)=>{event.preventDefault();this.pauseBeforeContextLoss=this.paused;this.paused=true;this.release();const notice=document.createElement('div');notice.className='context-warning';notice.setAttribute('role','alert');notice.innerHTML='<strong>The view is reconnecting.</strong><span>Your brief is safe.</span><button data-action="reload">Reload</button>';if(!this.host.querySelector('.context-warning'))this.host.append(notice);};
  private contextRestored=()=>{this.host.querySelector('.context-warning')?.remove();this.paused=this.pauseBeforeContextLoss;};
  setState(day:number,mode:SceneMode,locked:boolean){
    const changed=this.day!==day;this.day=day;this.mode=mode;this.physics.setDay(day);this.inputLocked=locked;
    if(locked||mode!=='explore')this.release();this.world.autumn.visible=day!==2;this.world.snow.visible=day===2;this.world.snowbank.visible=day===2;this.world.works.visible=day<2;this.cart.visible=day>0;
    this.sun.color.setHex(day===2?0xffd5b8:PASTEL.sun);this.hemi.color.setHex(day===2?0xc9cee9:PASTEL.hemi);(this.scene.fog as THREE.Fog).color.setHex(day===2?0xd9c9d1:PASTEL.fog);this.world.sunUniform.value.setHex(day===2?0xb8bddf:PASTEL.sky);
    if(changed)this.resetRobot();this.callout.hidden=locked||mode!=='explore'||!this.near;
  }
  /** A map tile finished after start-up gets the same material styling and contact-shadow rules. */
  private tileReady(tile:THREE.Object3D){applyPastelMaterials(tile);this.contactOcclusion?.scan(tile);}
  /** Finish every map tile around a point now, before the player can see it. */
  private streamAround(x:number,z:number){for(const t of this.world.streamTiles?.(x,z,{radius:STREAM_RADIUS})??[])this.tileReady(t);}
  private noContactShadow:THREE.Object3D[]=[];
  /** Keep glows and beacons out of the contact-shadow pass, now and after a graphics change. */
  excludeFromContactShadows(o:THREE.Object3D){this.noContactShadow.push(o);this.contactOcclusion?.exclude(o);}
  attach(addon:SceneAddon|undefined){this.addon=addon;this.release();}
  get threeScene(){return this.scene;}
  get streetPhysics(){return this.physics;}
  get sceneMode(){return this.mode;}
  get currentDay(){return this.day;}
  pipState(){return {x:this.position.x,y:this.position.y,z:this.position.z,heading:this.heading,speed:this.velocity.length()};}
  /** Pip's planned delivery path while she is out on one. */
  journeyPath(){return this.journey?.points;}
  setLocked(locked:boolean){this.inputLocked=locked;if(locked)this.release();}
  getQuality(){return this.quality;}
  gpu(){const gl=this.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return describeGpu(String(ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)));}
  setQuality(value:RenderQuality){this.quality=value;try{localStorage.setItem('enough-graphics',value);}catch{}this.applyGraphics();this.resize();}
  setReducedMotion(value:boolean){this.reduced=value;}
  toggleOverview(){this.overview=!this.overview;this.release();return this.overview;}
  resetCamera(){this.overview=false;this.cameraYaw=this.heading;this.inputYaw=this.heading;this.cameraPitch=this.day>0?.22:.16;this.zoom=this.day>0?5:4;this.lastOrbit=-100;}
  private obstacles():Obstacle[]{const extra=this.day===2?this.world.snowBounds:this.world.worksBounds;return [...this.world.obstacles,...extra,...this.life.bounds,{x:this.world.tram.position.x,z:this.world.tram.position.z,w:30.2,d:2.54,h:3.3,tag:'streetcar'}];}
  resetRobot(){this.clearEvent();this.cancel();const [x,z]=worldPoint(NODES.bakery);if(this.mode!=='title')this.streamAround(x,z);this.position.set(x,.12,z);this.cartPosition.set(x-.94,.12,z);this.cartHeading=Math.PI/2;this.heading=Math.PI/2;this.previousBodyHeading=this.heading;this.previousBodySpeed=0;this.pip.body.rotation.set(0,0,0);this.velocity.set(0,0,0);this.parcelDelivered.visible=false;this.pip?.parcel && (this.pip.parcel.visible=true);this.eyeTarget.setHex(0xf6e3a3);this.physics.reset([x,z],[x-.94,z]);this.clearRoute();this.resetCamera();this.placeActors(0);this.snapCamera();this.proximity();}
  cancel(){const journey=this.journey;this.journey=undefined;this.pendingSkip=false;this.trafficWait=false;this.paused=false;this.release();journey?.resolve();}
  private clearRoute(){for(const o of [...this.route.children]){if(o instanceof THREE.Mesh){o.geometry.dispose();if(!Array.isArray(o.material))o.material.dispose();}this.route.remove(o);}}
  private clearEvent(){this.eventKind=undefined;this.eventRing.visible=false;this.eventBadge.visible=false;for(const star of this.eventStars)star.visible=false;}
  private cue(kind:'dispatch'|'success'|'blocked'){
    this.eventKind=kind;this.eventTime=this.elapsed;
    for(const o of [...this.eventIcon.children]){if(o instanceof THREE.Mesh){o.geometry.dispose();(o.material as THREE.Material).dispose();}this.eventIcon.remove(o);}
    const color=kind==='blocked'?0xffbb64:kind==='success'?0xb9ebbe:0x43877b;
    (this.eventRing.material as THREE.MeshBasicMaterial).color.setHex(color);
    const bar=(x:number,y:number,w:number,h:number,angle=0)=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color,depthWrite:false}));m.position.set(x,y,.01);m.rotation.z=angle;this.eventIcon.add(m);};
    if(kind==='blocked'){bar(0,.045,.055,.20);bar(0,-.13,.055,.055);}
    else if(kind==='success'){bar(-.066,-.035,.055,.17,.7);bar(.048,.015,.055,.26,-.65);}
    else{bar(0,0,.055,.30);bar(0,0,.30,.055);}
  }
  private updateEvent(){
    if(!this.eventKind)return;const age=this.elapsed-this.eventTime,success=this.eventKind==='success',blocked=this.eventKind==='blocked',active=age<(success?3.2:blocked?3:1.8);
    this.eventBadge.visible=success||blocked;this.eventBadge.position.set(this.position.x,this.position.y+1.13+(this.reduced?0:Math.sin(Math.min(age,1)*Math.PI)*.17),this.position.z);this.eventBadge.quaternion.copy(this.camera.quaternion);this.eventBadge.translateX(.48);
    this.eventBadge.scale.setScalar(this.reduced?1:Math.min(1,age*7));
    this.eventRing.visible=active&&!this.reduced;this.eventRing.position.set(this.position.x,this.position.y+.02,this.position.z);
    const phase=age%1;this.eventRing.scale.setScalar(.8+phase*1.55);(this.eventRing.material as THREE.MeshBasicMaterial).opacity=(1-phase)*.78;
    for(let i=0;i<this.eventStars.length;i++){const star=this.eventStars[i];star.visible=success&&active&&!this.reduced;
      const angle=i*Math.PI*2/this.eventStars.length+.3,radius=.85+Math.min(age,2)*.22;
      star.position.set(this.position.x+Math.cos(angle)*radius,this.position.y+.68+Math.sin(angle)*.4+Math.sin(Math.min(age,2)*Math.PI/2)*.4,this.position.z+.25);
      star.quaternion.copy(this.camera.quaternion);star.rotateZ(angle+age*.3);star.scale.setScalar(Math.max(.1,Math.sin(Math.min(1,age/3.2)*Math.PI)));
      (star.material as THREE.MeshBasicMaterial).opacity=Math.min(1,(3.2-age)*1.5);
    }
    if(blocked&&!this.reduced&&age<.45)this.pip.body.rotation.z=Math.sin(age*35)*(1-age/.45)*.07;
  }
  animateJourney(result:Journey,progress:(p:number)=>void):Promise<void>{
    this.resetRobot();this.mode='delivery';this.inputLocked=false;this.cue('dispatch');const points=rigRoute(smoothRoute(result.points.map(worldPoint)),this.day>0,worldPoint(NODES.side));const length=points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-points[i][0],p[1]-points[i][1]),0);
    for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],distance=Math.hypot(b[0]-a[0],b[1]-a[1]),mesh=new THREE.Mesh(new THREE.CylinderGeometry(.028,.028,distance,5),new THREE.MeshBasicMaterial({color:0x9f7c43,transparent:true,opacity:.82}));mesh.position.set((a[0]+b[0])/2,.155+(groundHeight(...a)+groundHeight(...b))/2,(a[1]+b[1])/2);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(b[0]-a[0],groundHeight(...b)-groundHeight(...a),b[1]-a[1]).normalize());this.route.add(mesh);}
    return new Promise(resolve=>{this.journey={points,length,distance:0,result,resolve,progress};});
  }
  skipTravel(){if(this.journey)this.pendingSkip=true;}
  private move(dt:number){
    if(this.journey){
      const j=this.journey;const left=j.length-j.distance;
      const speed=left<2?Math.max(.65,left*1.3):3.4;
      const nextDistance=this.pendingSkip?j.length:Math.min(j.length,j.distance+speed*dt);
      const next=pathAt(j.points,nextDistance);
      const tram=this.world.tram.position;
      const plannedTail=this.pendingSkip&&j.length>0?pathAt(j.points,Math.max(0,nextDistance-.94)):undefined;
      const trailing:Point=plannedTail?[plannedTail.x,plannedTail.z]:followCart([next.x,next.z],[this.cartPosition.x,this.cartPosition.z]);
      // The streetcar yields whenever a crossing robot or its cart is close to the tracks.
      // Pip also waits before entering an already occupied crossing.
      this.trafficWait=!this.pendingSkip&&((Math.abs(next.z-tram.z)<(this.day>0?1.9:1.6)&&Math.abs(next.x-tram.x)<30.2/2+1.2)||blocked(next.x,next.z,this.day>0?.51:.32,this.life.bounds)||(this.day>0&&blocked(trailing[0],trailing[1],.51,this.life.bounds)));
      if(this.trafficWait){this.velocity.set(0,0,0);return;}
      j.distance=nextDistance;this.position.set(next.x,.12,next.z);this.heading=approachAngle(this.heading,next.heading,9,dt);
      this.velocity.set(Math.sin(next.heading)*speed,0,Math.cos(next.heading)*speed);j.progress(j.length?j.distance/j.length:1);
      this.cartPosition.set(trailing[0],.12,trailing[1]);this.cartHeading=Math.atan2(next.x-trailing[0],next.z-trailing[1]);
      if(j.distance>=j.length){this.journey=undefined;this.pendingSkip=false;this.velocity.set(0,0,0);this.eyeTarget.setHex(j.result.success?0xb9f0b8:0xffbd67);this.finishTime=this.elapsed;this.mode='result';this.cue(j.result.success?'success':'blocked');if(j.result.success){this.cameraYaw=this.day>0?-1.08:.72;this.heading=this.day>0?Math.PI-1.08:Math.PI;this.cameraPitch=.18;this.parcelDelivered.position.set(this.position.x+.8,.01+groundHeight(this.position.x+.8,this.position.z+.6),this.position.z+.6);this.parcelDelivered.visible=true;this.pip.parcel.visible=false;}j.resolve();}
      return;
    }
    if(this.mode==='explore'&&this.addon?.driving()){
      const next=this.addon.pipAutopilot?.(dt,{x:this.position.x,z:this.position.z,heading:this.heading});
      if(!next){this.velocity.multiplyScalar(Math.exp(-15*dt));return;}
      this.velocity.set(Math.sin(next.heading)*next.speed,0,Math.cos(next.heading)*next.speed);this.position.set(next.x,.12,next.z);this.heading=approachAngle(this.heading,next.heading,6,dt);
      if(this.day>0){const tail=followCart([next.x,next.z],[this.cartPosition.x,this.cartPosition.z]);this.cartPosition.set(tail[0],.12,tail[1]);this.cartHeading=Math.atan2(next.x-tail[0],next.z-tail[1]);}
      return;
    }
    if(this.mode!=='explore'||this.inputLocked){this.velocity.multiplyScalar(Math.exp(-15*dt));return;}
    const forward=Number(this.keys.has('KeyW')||this.keys.has('ArrowUp'))-Number(this.keys.has('KeyS')||this.keys.has('ArrowDown'));
    const side=Number(this.keys.has('KeyD')||this.keys.has('ArrowRight'))-Number(this.keys.has('KeyA')||this.keys.has('ArrowLeft'));
    const length=Math.hypot(forward,side)||1,max=this.keys.has('ShiftLeft')||this.keys.has('ShiftRight')?3.4:1.7;
    const view=this.camTarget.clone().sub(this.camera.position),viewYaw=Math.atan2(view.x,view.z);
    // A held direction stays stable when wall avoidance moves the camera.
    // Releasing movement or deliberately orbiting establishes a new input frame.
    if(!forward&&!side)this.inputYaw=undefined;
    else if(this.inputYaw===undefined||this.drag)this.inputYaw=viewYaw;
    const steeringYaw=this.inputYaw??viewYaw;
    const targetX=(Math.sin(steeringYaw)*forward-Math.cos(steeringYaw)*side)/length*max,targetZ=(Math.cos(steeringYaw)*forward+Math.sin(steeringYaw)*side)/length*max;
    this.velocity.x=THREE.MathUtils.damp(this.velocity.x,targetX,forward||side?7:11,dt);this.velocity.z=THREE.MathUtils.damp(this.velocity.z,targetZ,forward||side?7:11,dt);
    const obstacles=this.obstacles();
    let [x,z]=this.physics.move([this.position.x,this.position.z],[this.velocity.x*dt,this.velocity.z*dt]);
    if(this.day>0){
      const candidate=followCart([x,z],[this.cartPosition.x,this.cartPosition.z]);
      if(blocked(candidate[0],candidate[1],.48,obstacles)){x=this.position.x;z=this.position.z;}
      else{this.cartPosition.set(candidate[0],.12,candidate[1]);this.cartHeading=Math.atan2(x-candidate[0],z-candidate[1]);}
    }
    if(Math.abs(x-this.position.x)<.0001)this.velocity.x=0;if(Math.abs(z-this.position.z)<.0001)this.velocity.z=0;this.position.set(x,.12,z);
    if(this.velocity.length()>.12)this.heading=approachAngle(this.heading,Math.atan2(this.velocity.x,this.velocity.z),12,dt);

  }
  private placeActors(dt:number){
    if(!this.pip)return;const speed=this.velocity.length(),walk=speed>.1;this.stepDistance+=speed*dt;
    this.position.y=.12+groundHeight(this.position.x,this.position.z);this.cartPosition.y=.12+groundHeight(this.cartPosition.x,this.cartPosition.z);
    this.pip.group.position.copy(this.position);this.pip.group.position.y=this.position.y-.086;this.pip.group.rotation.order='YXZ';this.pip.group.rotation.y=this.heading;
    const grade=groundGradient(this.position.x,this.position.z);this.pip.group.rotation.x=-Math.atan(grade.x*Math.sin(this.heading)+grade.z*Math.cos(this.heading));this.pip.group.rotation.z=Math.atan(grade.x*Math.cos(this.heading)-grade.z*Math.sin(this.heading));
    const acceleration=dt>0?(speed-this.previousBodySpeed)/dt:0,turnRate=dt>0?angleDelta(this.previousBodyHeading,this.heading)/dt:0;
    this.previousBodySpeed=speed;this.previousBodyHeading=this.heading;
    const suspension=this.reduced?0:THREE.MathUtils.clamp(-acceleration*.006,-.13,.13);
    const corner=this.reduced?0:THREE.MathUtils.clamp(turnRate*speed*.012,-.12,.12);
    const steer=walk?THREE.MathUtils.clamp(turnRate*.16,-.28,.28):0;
    const bounce=this.reduced?0:(walk?Math.sin(this.stepDistance*8)*.022:Math.sin(this.elapsed*2.5)*.008);this.pip.body.position.y=bounce;
    this.pip.body.rotation.z=THREE.MathUtils.damp(this.pip.body.rotation.z,corner,9,dt);
    this.pip.body.rotation.x=THREE.MathUtils.damp(this.pip.body.rotation.x,suspension,12,dt);
    for(const wheel of this.pip.wheels){wheel.rotation.order='YXZ';wheel.rotation.x=this.stepDistance/(.27*.294);wheel.rotation.y=THREE.MathUtils.damp(wheel.rotation.y,wheel.position.z>0?steer:0,12,dt);}
    for(const wheel of this.cart.userData.wheels as THREE.Group[])wheel.rotation.x=this.stepDistance/(.23*.344);
    this.pip.antenna.rotation.z=this.reduced?0:Math.sin(this.elapsed*6)*.025+(walk?Math.sin(this.stepDistance*8)*.05:0);
    const blink=this.elapsed%5.8;for(const eye of this.pip.eyes)eye.scale.y=blink>5.55?Math.max(.08,Math.abs(blink-5.675)/.125):1;
    this.pip.eyeMaterial.color.lerp(this.eyeTarget,Math.min(1,dt*5));
    this.cart.position.copy(this.cartPosition);this.cart.position.y=this.cartPosition.y-.093;this.cart.rotation.order='YXZ';this.cart.rotation.y=this.cartHeading;
    const cartGrade=groundGradient(this.cartPosition.x,this.cartPosition.z);this.cart.rotation.x=-Math.atan(cartGrade.x*Math.sin(this.cartHeading)+cartGrade.z*Math.cos(this.cartHeading));this.cart.rotation.z=Math.atan(cartGrade.x*Math.cos(this.cartHeading)-cartGrade.z*Math.sin(this.cartHeading));
    if(this.parcelDelivered.visible){const t=THREE.MathUtils.clamp((this.elapsed-this.finishTime)*1.8,0,1);this.parcelDelivered.position.y=.01+groundHeight(this.parcelDelivered.position.x,this.parcelDelivered.position.z)+(this.reduced?0:Math.sin(t*Math.PI)*.6);if(!this.reduced)this.pip.body.rotation.z=Math.sin(t*Math.PI*4)*(1-t)*.09;}
  }
  private updateCamera(dt:number,snap=false){
    const title=this.mode==='title',result=this.mode==='result'||this.mode==='complete';
    if(title){this.cameraYaw=1.95+(this.reduced?0:Math.sin(this.elapsed*.055)*.045);this.cameraPitch=.12;this.heading=1.95;}
    else if(this.mode==='delivery'&&!this.drag&&this.elapsed-this.lastOrbit>2.5)this.cameraYaw=approachAngle(this.cameraYaw,this.heading,2.4,dt);
    // A short inspection zoom needs less look-ahead and a lower target;
    // otherwise this half-metre robot falls below the frame at minimum zoom.
    const closeUp=title||result?0:1-THREE.MathUtils.smoothstep(this.distance,2.4,4);
    const look=new THREE.Vector3(this.position.x,this.position.y+.93-.43*closeUp,this.position.z);
    if(title)look.x+=1.2;
    else if(!result){const ahead=.75-.50*closeUp;look.x+=Math.sin(this.heading)*ahead;look.z+=Math.cos(this.heading)*ahead;}
    this.camTarget.lerp(look,snap?1:1-Math.exp(-9*dt));
    this.distance=THREE.MathUtils.damp(this.distance,title?5.6:result?4.5:this.zoom,4,dt);
    const offset=(yaw:number)=>new THREE.Vector3(-Math.sin(yaw)*this.distance,Math.sin(Math.max(.02,this.cameraPitch))*this.distance+.8,-Math.cos(yaw)*this.distance);
    // Keep the view direction stable: shorten the camera arm at walls, with only a small lateral correction.
    // Thin tree trunks are excluded so they cannot pull the camera into Pip.
    const bounds=this.world.obstacles.filter(o=>(o.tag==='building'||o.tag==='house'||o.tag?.startsWith('video-corrected')||o.tag==='875 Queen mapped podium'||['rail arcade','rail portal pier','rail retaining wall','rail wing wall','station headhouse','station pier','laneway fence'].includes(o.tag||''))&&Math.abs(o.x-this.position.x)<o.w/2+22&&Math.abs(o.z-this.position.z)<o.d/2+22);
    const clearance=(segment:THREE.Vector3)=>{let tMax=1;const origin=this.camTarget;
      for(const o of bounds){const polygon=o.p||[[o.x-o.w/2,o.z-o.d/2],[o.x+o.w/2,o.z-o.d/2],[o.x+o.w/2,o.z+o.d/2],[o.x-o.w/2,o.z+o.d/2]];
        for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],ex=b[0]-a[0],ez=b[1]-a[1],den=segment.x*ez-segment.z*ex;if(Math.abs(den)<1e-8)continue;const ax=a[0]-origin.x,az=a[1]-origin.z,t=(ax*ez-az*ex)/den,u=(ax*segment.z-az*segment.x)/den;
          if(t>0&&t<tMax&&u>=0&&u<=1&&origin.y+segment.y*t<o.h+groundHeight(o.x,o.z)+.2)tMax=Math.max(.12,t-.06);
        }
      }return tMax;};
    let segment=offset(this.cameraYaw),tMax=clearance(segment);
    if(tMax<.45){for(const delta of [.2,-.2,.4,-.4]){const candidate=offset(this.cameraYaw+delta),free=clearance(candidate);if(free>tMax){segment=candidate;tMax=free;}if(free>.95)break;}}
    let desired=this.overview?this.position.clone().add(new THREE.Vector3(-45,150,105)):this.camTarget.clone().addScaledVector(segment,tMax);
    desired.y=Math.max(groundHeight(desired.x,desired.z)+1.5,desired.y);
    const underBridge=(p:THREE.Vector3)=>{const q=QUEEN_UNDERPASS,x=p.x-p.z*q.skew;return Math.abs(p.z-q.centerZ)<q.outer&&x>q.west-1&&x<q.east+1;};
    // Orbiting/zooming under the new deck must not lift the camera through the
    // opaque ceiling. Keep the camera below the 4.1 m portal clearance.
    if(!this.overview&&(underBridge(this.position)||underBridge(desired)))desired.y=Math.min(desired.y,3.72+groundHeight(desired.x,desired.z));
    const eased=this.camera.position.clone().lerp(desired,snap?1:1-Math.exp(-(this.reduced?14:7)*dt));
    if(!this.overview&&(underBridge(this.position)||underBridge(eased)))eased.y=Math.min(eased.y,3.72+groundHeight(eased.x,eased.z));
    // An interpolated camera must also remain outside walls when rounding a corner.
    const easedSegment=eased.clone().sub(this.camTarget);
    this.camera.position.copy(!this.overview&&clearance(easedSegment)<.85?desired:eased);this.camera.lookAt(this.camTarget.clone().add(new THREE.Vector3(0,this.cameraPitch<0?(this.camera.position.y-this.camTarget.y)+Math.tan(-this.cameraPitch)*Math.hypot(this.camera.position.x-this.camTarget.x,this.camera.position.z-this.camTarget.z):0,0)));
    const fov=this.overview?51:title?58:60+(this.reduced?0:Math.min(3,this.velocity.length()*.38));this.camera.fov=THREE.MathUtils.damp(this.camera.fov,fov,4,dt);this.camera.updateProjectionMatrix();
    followGoldenSun(this.sun,this.position);
  }
  private revealPlayer(dt:number){
    const targets=[this.position.clone().add(new THREE.Vector3(0,.85,0)),this.position.clone().add(new THREE.Vector3(0,1.65,0))];
    if(this.cart.visible)targets.push(this.cartPosition.clone().add(new THREE.Vector3(0,.75,0)));
    for(const item of this.world.cameraOccluders){
      if(item.dynamic)item.box.setFromObject(item.object);
      const obstructs=targets.some(target=>{const vector=target.clone().sub(this.camera.position),length=vector.length(),ray=new THREE.Ray(this.camera.position,vector.normalize()),hit=new THREE.Vector3();return item.box.containsPoint(this.camera.position)||!!(ray.intersectBox(item.box,hit)&&hit.distanceTo(this.camera.position)<length-.45);});
      const target=obstructs?item.minimum:1;item.opacity=THREE.MathUtils.damp(item.opacity,target,this.reduced?60:12,dt);if(Math.abs(item.opacity-target)<.005)item.opacity=target;
      item.object.visible=item.opacity>0;
      for(const mat of item.materials){mat.opacity=item.opacity;mat.transparent=false;mat.depthWrite=true;}
    }
  }
  private snapCamera(){this.camTarget.copy(this.position).add(new THREE.Vector3(0,1.12,0));this.updateCamera(1,true);}
  private proximity(){
    let closest:FactId|undefined,best=3.2;
    for(const fact of factsForDay(this.day)){const [x,z]=worldPoint(fact.position),distance=Math.hypot(this.position.x-x,this.position.z-z);if(distance<best){best=distance;closest=fact.id;}}
    if(closest!==this.near){this.near=closest;this.onNear(closest);}
    for(const [id,marker] of this.world.markers){marker.visible=id===closest&&this.mode==='explore'&&!this.inputLocked;marker.rotation.y=this.elapsed*.5;}
    this.callout.hidden=!closest||this.mode!=='explore'||this.inputLocked||this.paused||!!this.addon?.driving();
    if(closest&&!this.callout.hidden){const f=factsForDay(this.day).find(f=>f.id===closest)!;const [x,z]=worldPoint(f.position),point=new THREE.Vector3(x,1.9+groundHeight(x,z),z).project(this.camera);this.callout.style.left=`${(point.x*.5+.5)*100}%`;this.callout.style.top=`${(-point.y*.5+.5)*100}%`;this.callout.hidden=point.z>1||point.z<0||Math.abs(point.x)>.9||Math.abs(point.y)>.85;const labels={works:'Street conditions',entrance:'The side door',gate:'The north passage',park:'The park path',mural:'A little local colour',bakery:'Fresh from the bakery'};if(this.callout.dataset.fact!==closest){this.callout.dataset.fact=closest;this.callout.innerHTML=`<kbd>E</kbd> ${labels[closest]}`;}}
  }
  private ambience(dt:number){
    const nextTramX=this.world.tram.position.x+7.5*dt;const occupiers=[this.position,...(this.day>0?[this.cartPosition]:[]),...this.life.cars.map(c=>c.group.position)];const occupied=occupiers.some(p=>Math.abs(p.z-this.world.tram.position.z)<2.95&&p.x>this.world.tram.position.x&&p.x-nextTramX<30.2/2+3);const carAhead=this.life.cars.some(c=>Math.abs(c.bound.z-this.world.tram.position.z)<2.95&&c.bound.x>this.world.tram.position.x&&c.bound.x-nextTramX<15.1+c.bound.w/2+2.6);if(!carAhead&&(!occupied||this.trafficWait))this.world.tram.position.x=nextTramX>550?-930:nextTramX;
    this.world.tram.position.z=queenZ(this.world.tram.position.x)+1.55;this.world.tram.position.y=.04+groundHeight(this.world.tram.position.x,this.world.tram.position.z);
    this.life.update(dt,this.elapsed,this.reduced,[...(this.addon?.driving()?[[this.addon.focus().x,this.addon.focus().z] as Point]:[]),[this.position.x,this.position.z],...(this.day>0?[[this.cartPosition.x,this.cartPosition.z] as Point]:[])],{x:this.world.tram.position.x,z:this.world.tram.position.z,w:30.2,d:2.54,h:3.3});
    if(Math.abs(this.world.tram.position.x-this.position.x)<15&&this.elapsed-this.lastBell>20){this.lastBell=this.elapsed;this.onBell();}
    this.world.people.forEach((person,i)=>{
      person.group.position.y=groundHeight(person.group.position.x,person.group.position.z);
      const distance=person.group.position.distanceTo(this.position),canGreet=(this.mode==='explore'&&!this.inputLocked)||this.mode==='delivery';
      if(i!==3&&canGreet&&distance<4.8&&this.elapsed>person.nextGreeting){person.greetUntil=this.elapsed+2.6;person.nextGreeting=this.elapsed+16;}
      const welcome=i===3&&(this.mode==='result'||this.mode==='complete')&&this.eventKind==='success';
      const greeting=welcome||this.elapsed<person.greetUntil;
      if(greeting){
        const target=Math.atan2(this.position.x-person.group.position.x,this.position.z-person.group.position.z);
        person.group.rotation.y=approachAngle(person.group.rotation.y,target,6,dt);
        person.limbs.forEach((limb,j)=>{limb.rotation.x=THREE.MathUtils.damp(limb.rotation.x,0,8,dt);limb.rotation.z=THREE.MathUtils.damp(limb.rotation.z,j===3?2.15+(this.reduced?0:Math.sin(this.elapsed*8)*.18):0,9,dt);});
      }else{
        if(i!==3&&!this.reduced){const offset=Math.sin(this.elapsed*.11+person.phase)*1.1;person.group.position.x=THREE.MathUtils.damp(person.group.position.x,person.x+offset,3,dt);person.group.rotation.y=approachAngle(person.group.rotation.y,Math.cos(this.elapsed*.11+person.phase)>0?Math.PI/2:-Math.PI/2,5,dt);}
        person.limbs.forEach((limb,j)=>{const walking=i!==3&&!this.reduced;limb.rotation.x=walking?Math.sin(this.elapsed*2.4+person.phase+(j%2?Math.PI:0))*.18:0;limb.rotation.z=THREE.MathUtils.damp(limb.rotation.z,0,7,dt);});
      }
    });
    this.world.leaves.position.set(this.position.x,this.position.y-.12,this.position.z);const p=this.world.leafPositions;
    for(let i=0;i<p.length/3;i++){p[i*3]+=(.2+Math.sin(this.elapsed*.6+i)*.15)*dt;p[i*3+1]-=(this.day===2?.28:.43)*dt;p[i*3+2]+=Math.sin(this.elapsed*.5+i)*dt*.2;if(p[i*3+1]<0)p[i*3+1]=10;if(p[i*3]>18)p[i*3]=-18;}
    this.world.leaves.geometry.getAttribute('position').needsUpdate=true;const mat=this.world.leaves.material as THREE.PointsMaterial;mat.color.setHex(this.day===2?0xf9f2e2:0xebb57b);mat.size=this.day===2?.05:.07;this.world.leaves.visible=!this.reduced;
  }
  private tick=(now:number)=>{
    if(this.disposed)return;if(!this.frameCount++)performance.mark('enough:first-frame');const dt=Math.min((now-this.last)/1000||0,.035);this.last=now;
    if(!document.hidden){if(!this.paused){this.elapsed+=dt;this.accumulator+=Math.min(dt,.1);while(this.accumulator>=1/90){this.move(1/90);this.ambience(1/90);this.addon?.fixedStep(1/90);this.physics.sync([this.position.x,this.position.z],[this.cartPosition.x,this.cartPosition.z],this.cartHeading,[this.world.tram.position.x,this.world.tram.position.z],this.life.bounds);this.accumulator-=1/90;}this.placeActors(dt);}const driving=!!this.addon?.driving(),focus=driving?this.addon!.focus():this.position;this.addon?.frame(this.paused?0:dt,this.accumulator*90);if(driving){this.addon!.updateCamera(this.camera,dt);followGoldenSun(this.sun,focus);}else this.updateCamera(dt);if(this.captureLens)this.applyCaptureLens(this.captureLens);this.revealPlayer(dt);this.updateEvent();this.proximity();this.onSpeed(this.paused?0:driving?Math.min(14,this.addon!.speed()*.3):this.velocity.length());for(const t of this.world.streamTiles?.(focus.x,focus.z,{radius:driving?120:0,budgetMs:6})??[])this.tileReady(t);this.world.updateVisibility?.(focus.x,focus.z,GRAPHICS[this.quality].lod);this.world.updateTransit?.(this.elapsed,this.reduced);if(this.film)this.colorPass=this.film.render(this.renderer,this.scene,this.camera,this.contactOcclusion,focus,this.overview);else{const auto=this.renderer.info.autoReset;this.renderer.info.autoReset=false;this.renderer.info.reset();try{this.renderer.render(this.scene,this.camera);this.colorPass={calls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles};this.contactOcclusion?.render(this.renderer);}finally{this.renderer.info.autoReset=auto;}}}
    this.frame=requestAnimationFrame(this.tick);
  };
  visit(id:string){const place=VISITS.find(p=>p.id===id);if(!place||this.mode==='delivery')return;this.cancel();this.streamAround(place.position[0],place.position[1]);this.addon?.visited?.(place.position[0],place.position[1]);this.position.set(place.position[0],.08,place.position[1]);this.cartPosition.set(place.position[0]-.94,.08,place.position[1]);this.heading=place.yaw;this.cameraYaw=place.yaw;this.inputYaw=undefined;this.zoom=id==='riverside-mural'?4:id==='amber'?4.3:id==='king-river'?4.5:id==='opera'?4.2:7;this.cameraPitch=id==='riverside-mural'?-.01:id==='broadview'?-.42:['bank','opera','poulton','butchers'].includes(id)?-.25:id==='library'?-.33:['dark-horse','boulton-homes','amber','stone-pair','degrassi-bend','leslieville-station','station-plaza'].includes(id)?-.16:0;this.overview=false;this.physics.reset(place.position,[place.position[0]-.94,place.position[1]]);this.placeActors(0);this.snapCamera();this.proximity();}
  skylineReference(){
    const p=project(CN_TOWER.longitude,CN_TOWER.latitude),samples=[CN_TOWER.mainObservation,CN_TOWER.skyPod,CN_TOWER.height].map(height=>{const target=new THREE.Vector3(p[0],height+CN_TOWER.baseY,p[1]),ndc=target.clone().project(this.camera),delta=target.clone().sub(this.camera.position),ray=new THREE.Raycaster(this.camera.position,delta.clone().normalize(),0,delta.length());const hit=ray.intersectObject(this.world.group,true).find(h=>{let o:THREE.Object3D|null=h.object;while(o){if(!o.visible)return false;o=o.parent;}return h.object!==this.world.sky;});return {height,ndc:ndc.toArray(),occluded:!!hit,occluder:hit?{distance:hit.distance,point:hit.point.toArray(),name:hit.object.name,type:hit.object.type,objectPosition:hit.object.position.toArray(),material:hit.object instanceof THREE.Mesh?((hit.object.material as THREE.Material).type):null}:null};});return {position:p,samples};
  }
  collisionBounds(){return {static:this.world.obstacles,works:this.world.worksBounds,snow:this.world.snowBounds};}
  // Offline film capture advances the real scene at a fixed timestep. It does
  // not change the normal player camera, physics or render loop.
  captureStep(dt=1/30,lens?:CaptureLens){if(lens)this.captureLens=lens;cancelAnimationFrame(this.frame);this.tick(this.last+dt*1000);cancelAnimationFrame(this.frame);}
  private applyCaptureLens(lens:CaptureLens){
    this.camera.position.copy(this.position).add(new THREE.Vector3(...lens.camera));
    const target=this.position.clone().add(new THREE.Vector3(...lens.target));
    this.camera.lookAt(target.x,this.camera.position.y,target.z);this.camera.fov=lens.fov;this.camera.updateProjectionMatrix();
    const distance=Math.hypot(target.x-this.camera.position.x,target.z-this.camera.position.z);
    this.camera.projectionMatrix.elements[9]=(target.y-this.camera.position.y)/Math.max(1,distance)*this.camera.projectionMatrix.elements[5];
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
  }
  captureFrame(shot:{pip:Point;camera:[number,number,number];target:[number,number,number];heading:number;time:number;dt:number;fov?:number;level?:boolean}){
    cancelAnimationFrame(this.frame);this.paused=false;this.inputLocked=true;
    this.mode='explore';this.day=0;this.clearRoute();this.clearEvent();
    const previous=this.position.clone();
    this.position.set(shot.pip[0],groundHeight(...shot.pip)+.08,shot.pip[1]);
    this.velocity.copy(this.position).sub(previous).divideScalar(Math.max(shot.dt,.001));
    if(this.velocity.length()>4)this.velocity.set(0,0,0);
    this.heading=shot.heading;this.elapsed=shot.time;
    this.ambience(shot.dt);this.placeActors(shot.dt);this.cart.visible=false;
    this.world.autumn.visible=true;this.world.snow.visible=false;this.world.snowbank.visible=false;
    this.callout.hidden=true;for(const marker of this.world.markers.values())marker.visible=false;
    this.camera.position.set(shot.camera[0],groundHeight(shot.camera[0],shot.camera[2])+shot.camera[1],shot.camera[2]);
    const targetY=groundHeight(shot.target[0],shot.target[2])+shot.target[1];
    this.camera.lookAt(shot.target[0],shot.level?this.camera.position.y:targetY,shot.target[2]);
    this.camera.fov=shot.fov??50;this.camera.updateProjectionMatrix();
    // An off-axis architectural lens preserves verticals without rolling or
    // stretching the world. This is confined to offline trailer photography.
    if(shot.level){const distance=Math.hypot(shot.target[0]-this.camera.position.x,shot.target[2]-this.camera.position.z);this.camera.projectionMatrix.elements[9]=(targetY-this.camera.position.y)/Math.max(1,distance)*this.camera.projectionMatrix.elements[5];this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();}
    followGoldenSun(this.sun,this.position);
    this.world.updateVisibility?.(this.position.x,this.position.z,GRAPHICS[this.quality].lod);this.world.updateTransit?.(this.elapsed,false);
    if(this.film)this.film.render(this.renderer,this.scene,this.camera,this.contactOcclusion,this.position,false);
    else this.renderer.render(this.scene,this.camera);
  }
  diagnostics(){return {pipModel:{...this.pip.stats,flagLoaded:!!((this.pip.flag.material as THREE.MeshStandardMaterial).map?.image?.width),flagSize:[.338,.169]},quality:this.quality,pendingTiles:this.world.pendingTiles?.()??0,graphics:GRAPHICS[this.quality],shadowsEnabled:this.sun.castShadow,fogFar:(this.scene.fog as THREE.Fog).far,visibleTiles:this.world.group.children.filter(o=>o.visible).length,pixelRatio:this.renderer.getPixelRatio(),shadow:{size:this.sun.shadow.mapSize.toArray(),projection:this.sun.shadow.camera.projectionMatrix.elements.slice(),direction:this.sun.position.clone().sub(this.sun.target.position).normalize().toArray()},ambientContacts:{pip:this.life.bounds.filter(o=>blocked(this.position.x,this.position.z,.225,[o])).map(o=>o.tag),cart:this.day>0?this.life.bounds.filter(o=>blocked(this.cartPosition.x,this.cartPosition.z,.48,[o])).map(o=>o.tag):[]},streetLife:this.life.diagnostics(),physics:this.physics.diagnostics(),colorPass:this.colorPass,depthOfField:this.film?.diagnostics()||null,renderAccounting:'beauty + shadow + AO + bloom + depth of field + output',contactOcclusion:!!this.contactOcclusion,filmFinish:!!this.film,drawCalls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,geometries:this.renderer.info.memory.geometries,textures:this.renderer.info.memory.textures,canvas:{width:this.renderer.domElement.width,height:this.renderer.domElement.height},position:{x:this.position.x,y:this.position.y,z:this.position.z},camera:{x:this.camera.position.x,y:this.camera.position.y,z:this.camera.position.z,fov:this.camera.fov,yaw:this.cameraYaw},speed:this.velocity.length(),heading:this.heading,body:{pitch:this.pip.body.rotation.x,roll:this.pip.body.rotation.z,steer:this.pip.wheels[1].rotation.y},fadedOccluders:this.world.cameraOccluders.filter(o=>o.opacity<.5).length,greetingNeighbours:this.world.people.filter(p=>this.elapsed<p.greetUntil).length,mode:this.mode,day:this.day,paused:this.paused,near:this.near,keys:[...this.keys],moving:!!this.journey,reducedMotion:this.reduced,overview:this.overview,trafficWait:this.trafficWait,event:this.eventKind,staticContacts:{pip:this.world.obstacles.filter(o=>blocked(this.position.x,this.position.z,.225,[o])).map(o=>`${o.tag||'gate'}:${o.x},${o.z}`),cart:this.day>0?this.world.obstacles.filter(o=>blocked(this.cartPosition.x,this.cartPosition.z,.48,[o])).map(o=>`${o.tag||'gate'}:${o.x},${o.z}`):[]},cart:{x:this.cartPosition.x,z:this.cartPosition.z,heading:this.cartHeading},colliders:this.obstacles().length};}
  dispose(){this.disposed=true;cancelAnimationFrame(this.frame);this.observer.disconnect();window.removeEventListener('keydown',this.keyDown);window.removeEventListener('keyup',this.keyUp);window.removeEventListener('blur',this.release);document.removeEventListener('visibilitychange',this.visibility);this.physics.dispose();this.skyTexture?.dispose();this.skyCloudTexture?.dispose();this.contactOcclusion?.dispose();this.film?.dispose();this.renderer.dispose();}
}
