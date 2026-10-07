import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type {Neighbourhood,SceneAddon} from '../scene';
import {groundHeight} from '../terrain';
import {NODES,type Point} from '../game';
import {RaceCar,NORMAL_TUNING,SUPERSONIC_TUNING,reserveGroundGroup,type CarInput,type CarTuning} from './race-car';
import {loadCarModel,type CarModel} from './car-model';
import {Minimap,type MapMarker} from './minimap';
import {Downtown,DOWNTOWN,DOWNTOWN_ROADS,DOWNTOWN_BUILDINGS,CN_TOWER_POINT} from './downtown';
import {GRAPHICS} from '../render-quality';
import {strollPath,pathLength,pingPong,nearestAlong,clearSpot,layoutPads,setExtraArea,driveBounds,Jobs,type JobEvent,type Pad} from './rush-logic';
import type {RushSettings} from './settings';

export type Chime=(kind:'tap'|'send'|'stop'|'success'|'bell')=>void;
const PARK={x:-24,z:17}; // Leslieville Station's south plaza, clear of traffic
const DRIVE_MODES=new Set(['explore','delivery','result']);
const CAR_KEYS=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight','KeyX','KeyQ','KeyE','KeyR']);
const STROLL_SPEED=1.25;
/** Further than this from her route, Pip waits where she is rather than cut through buildings. */
const STROLL_REACH=25;
const BEST_KEY='enough-rush-tower-best';
const readBest=()=>{try{const v=Number(localStorage.getItem(BEST_KEY));return v>0?v:undefined;}catch{return undefined;}};
const writeBest=(v:number)=>{try{localStorage.setItem(BEST_KEY,String(v));}catch{/* Best time is kept for this visit only. */}};
const fmt=(s:number)=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;

/** The race car, pads, HUD and map. Loaded only once a Garage switch turns Rush on. */
export class Rush implements SceneAddon{
 private settings!:RushSettings;
 private minimap?:Minimap;
 private car?:RaceCar;private model?:CarModel;private loading?:string;
 private character:'pip'|'car'='pip';
 private keys=new Set<string>();private mouse={boost:false,jump:false};
 private jobs=new Jobs();
 private pads:Pad[]=[];private padTimers:number[]=[];private smallPads?:T.InstancedMesh;private bigPads?:T.InstancedMesh;
 private group=new T.Group();private beacons=new T.Group();private meetBeacon:T.Group;private flames:T.Mesh[]=[];private trail?:Trail;
 private hud=document.createElement('div');private banner?:{text:string;until:number};
 private prev={p:new T.Vector3(),q:new T.Quaternion()};private curr={p:new T.Vector3(),q:new T.Quaternion()};
 private render={p:new T.Vector3(),q:new T.Quaternion()};private cam={pos:new T.Vector3(),fwd:new T.Vector3(0,0,1),ready:false};
 private stroll=strollPath();private strollLength=pathLength(this.stroll);private strollAt=0;private approach?:Point;private offRoute=false;
 private input:CarInput={throttle:0,steer:0,roll:0,jump:false,boost:false,drift:false};
 private clock=0;private stuck=0;
 private downtown?:Downtown;
 /** The Tower Run: from the edge of downtown to the foot of the CN Tower, timed. */
 private tower={running:false,time:0,best:readBest(),done:false};private mapClock=0;private reserved=false;
 constructor(private town:Neighbourhood,private host:HTMLElement,private chime:Chime){
  this.group.name='Rush';this.town.threeScene.add(this.group);this.group.add(this.beacons);
  this.meetBeacon=beacon(0x5fd1e0);this.meetBeacon.visible=false;this.group.add(this.meetBeacon);
  this.hud.className='rush-hud';this.host.append(this.hud);
  window.addEventListener('keydown',this.keyDown,{capture:true});window.addEventListener('keyup',this.keyUp,{capture:true});window.addEventListener('blur',this.blur);
  this.canvas?.addEventListener('pointerdown',this.pointer);window.addEventListener('pointerup',this.pointer);
  this.town.excludeFromContactShadows(this.group);
 }
 private get reduced(){return this.host.classList.contains('reduced-motion');}
 private get canvas(){return this.host.querySelector<HTMLCanvasElement>('#world canvas');}
 private get tuning():CarTuning{
  const base=this.settings.supersonic?SUPERSONIC_TUNING:NORMAL_TUNING;
  return {...base,ghost:this.settings.ghost,gravityScale:this.settings.moon?base.gravityScale/3:base.gravityScale,jump:this.settings.moon?base.jump*.8:base.jump};
 }
 apply(next:RushSettings){
  const prev=this.settings;this.settings=next;
  if(next.rush)this.reserveGroups();
  if(next.rush&&!this.downtown){this.downtown=new Downtown(this.town.threeScene,this.town.streetPhysics.world);setExtraArea({roads:DOWNTOWN_ROADS,buildings:DOWNTOWN_BUILDINGS,bounds:DOWNTOWN});}
  if(!next.rush&&this.downtown){this.downtown.dispose();this.downtown=undefined;setExtraArea(undefined);}
  if(next.minimap&&!this.minimap)this.minimap=new Minimap(this.host);
  this.minimap?.setArea(this.downtown?{bounds:DOWNTOWN,roads:DOWNTOWN_ROADS,buildings:DOWNTOWN_BUILDINGS}:undefined);
  if(!next.minimap&&this.minimap){this.minimap.dispose();this.minimap=undefined;}
  if(next.rush&&(!this.car||prev?.car!==next.car))void this.spawnCar(next.car);
  if(!next.rush&&this.car)this.removeCar();
  if(next.rush&&!this.pads.length)this.buildPads();
  if(!next.rush)this.clearPads();
  this.hud.hidden=!next.rush;
 }
 // ---- car lifecycle ----
 private async spawnCar(id:RushSettings['car']){
  if(this.loading===id)return;this.loading=id;
  const model=await loadCarModel(id).catch(error=>{console.error('Race car failed to load',error);return undefined;});
  if(this.loading!==id||!model||!this.settings.rush)return;this.loading=undefined;
  const physics=this.town.streetPhysics;
  const was=this.car?{...this.car.position,heading:this.car.heading}:this.parkingNearPip();
  const boost=this.car?.boost;this.removeCar(false);
  this.model=model;this.car=new RaceCar(physics.world,model.spec,{...was,y:Math.max(was.y,groundHeight(was.x,was.z)+.9)});
  if(boost!==undefined)this.car.boost=boost;
  this.group.add(model.root);this.addEffects(model);this.snapshot();this.prev.p.copy(this.curr.p);this.prev.q.copy(this.curr.q);
 }
 /** The first car waits on a clear stretch of side street a short walk from Pip, pointing along it. */
 private parkingNearPip(){
  const pip=this.town.pipState();
  return this.clearSpot([pip.x,pip.z],Jobs.MEET+6)??{x:PARK.x,y:groundHeight(PARK.x,PARK.z)+.9,z:PARK.z,heading:Math.PI/2};
 }
 private removeCar(swapBack=true){
  if(swapBack&&this.character==='car')this.swap('pip');
  this.car?.dispose();this.car=undefined;
  if(this.model){this.group.remove(this.model.root);this.model=undefined;}
  for(const f of this.flames)f.removeFromParent();this.flames=[];this.trail?.dispose();this.trail=undefined;
 }
 private addEffects(model:CarModel){
  const box=new T.Box3().setFromObject(model.root),rearZ=box.min.z+.05,y=box.min.y+.42;
  const flameMat=new T.MeshBasicMaterial({color:0xffa64d,transparent:true,opacity:.9,blending:T.AdditiveBlending,depthWrite:false});
  for(const x of [-.38,.38]){const f=new T.Mesh(new T.ConeGeometry(.17,1,12,1,true),flameMat);f.rotation.x=-Math.PI/2;f.position.set(x,y,rearZ-.5);f.visible=false;model.root.add(f);this.flames.push(f);}
  this.trail=new Trail(this.group);
 }
 private clearSpot(near:Point,minimum=0){const {world,ground}=this.town.streetPhysics;return clearSpot(world,ground,near,minimum,this.car?.collider);}
 private respawn(){
  if(!this.car)return;const p=this.car.position,at=this.clearSpot([p.x,p.z])??{x:PARK.x,y:groundHeight(PARK.x,PARK.z)+.9,z:PARK.z,heading:this.car.heading};
  this.car.reset(at.x,at.y+.3,at.z,at.heading);this.snapshot();this.prev.p.copy(this.curr.p);this.prev.q.copy(this.curr.q);this.cam.ready=false;this.stuck=0;
 }
 /** Before any Rush collider exists: only the ground keeps the ground bit, so phase mode works. */
 private reserveGroups(){if(this.reserved)return;const physics=this.town.streetPhysics;reserveGroundGroup(physics.world,physics.ground);this.reserved=true;}
 // ---- boost pads ----
 private buildPads(){
  this.pads=[...layoutPads(),...(this.downtown?layoutPads(90,DOWNTOWN_ROADS,DOWNTOWN):[])];this.padTimers=this.pads.map(()=>0);
  const smallMat=new T.MeshBasicMaterial({color:0xffb347,transparent:true,opacity:.85,depthWrite:false});
  const bigMat=new T.MeshBasicMaterial({color:0xffc66b,transparent:true,opacity:.92,blending:T.AdditiveBlending,depthWrite:false});
  const small=this.pads.filter(p=>!p.big),big=this.pads.filter(p=>p.big);
  this.smallPads=new T.InstancedMesh(new T.CylinderGeometry(1.1,1.1,.05,24),smallMat,small.length);
  this.bigPads=new T.InstancedMesh(new T.IcosahedronGeometry(.75,2),bigMat,big.length);
  for(const mesh of [this.smallPads,this.bigPads]){mesh.frustumCulled=false;mesh.castShadow=false;this.group.add(mesh);}
  this.updatePads(0);
 }
 private clearPads(){for(const m of [this.smallPads,this.bigPads])if(m){m.removeFromParent();m.geometry.dispose();(m.material as T.Material).dispose();}this.smallPads=this.bigPads=undefined;this.pads=[];this.padTimers=[];}
 private updatePads(time:number){
  if(!this.smallPads||!this.bigPads)return;const m=new T.Matrix4(),q=new T.Quaternion(),s=new T.Vector3();let si=0,bi=0;
  this.pads.forEach((p,i)=>{
   const ready=this.padTimers[i]<=0,y=groundHeight(p.x,p.z);
   if(p.big){s.setScalar(ready?1+Math.sin(time*4+i)*.08:0);m.compose(new T.Vector3(p.x,y+1.1+Math.sin(time*2+i)*.15,p.z),q,s);this.bigPads!.setMatrixAt(bi++,m);}
   else{s.set(ready?1:.35,1,ready?1:.35);m.compose(new T.Vector3(p.x,y+.04,p.z),q,s);this.smallPads!.setMatrixAt(si++,m);}
  });
  this.smallPads.instanceMatrix.needsUpdate=true;this.bigPads.instanceMatrix.needsUpdate=true;
 }
 // ---- input ----
 private blocked(){return !!document.querySelector('dialog[open]')||this.host.classList.contains('drawer-open')||(document.activeElement as HTMLElement|null)?.matches?.('input,textarea,select')===true;}
 private keyDown=(e:KeyboardEvent)=>{
  if(this.blocked())return;
  if(e.code==='KeyM'&&this.minimap&&!e.repeat){e.preventDefault();e.stopImmediatePropagation();this.minimap.toggle();return;}
  if(!this.settings.rush)return;
  if(e.code==='KeyC'&&!e.repeat){e.preventDefault();e.stopImmediatePropagation();this.swap();return;}
  if(this.driving()&&CAR_KEYS.has(e.code)){
   e.preventDefault();e.stopImmediatePropagation();
   if(e.code==='KeyR'&&!e.repeat){this.respawnInPlace();return;}
   this.keys.add(e.code);
  }
 };
 private keyUp=(e:KeyboardEvent)=>{if(this.keys.delete(e.code))e.stopImmediatePropagation();};
 private blur=()=>{this.keys.clear();this.mouse.boost=this.mouse.jump=false;};
 private pointer=(e:PointerEvent)=>{
  if(e.type==='pointerup'){if(e.button===0)this.mouse.boost=false;if(e.button===2)this.mouse.jump=false;return;}
  if(!this.driving())return;if(e.button===0)this.mouse.boost=true;if(e.button===2)this.mouse.jump=true;
 };
 private respawnInPlace(){if(!this.car)return;if(!this.car.contacts){this.respawn();return;}const p=this.car.position;this.car.reset(p.x,Math.max(p.y,groundHeight(p.x,p.z))+1.4,p.z,this.car.heading);}
 private readInput():CarInput{
  const k=(...codes:string[])=>codes.some(c=>this.keys.has(c));
  const input:CarInput={throttle:+k('KeyW','ArrowUp')-+k('KeyS','ArrowDown'),steer:+k('KeyD','ArrowRight')-+k('KeyA','ArrowLeft'),roll:+k('KeyE')-+k('KeyQ'),
   jump:k('Space')||this.mouse.jump,boost:k('ShiftLeft','ShiftRight')||this.mouse.boost,drift:k('KeyX')};
  // A standard gamepad, laid out like Rocket League: triggers drive, A jumps, B boosts, X slides.
  const pad=navigator.getGamepads?.().find(g=>g?.mapping==='standard');
  if(pad){const dead=(v:number)=>Math.abs(v)<.15?0:v;
   input.steer=Math.max(-1,Math.min(1,input.steer+dead(pad.axes[0])));
   input.throttle=Math.max(-1,Math.min(1,input.throttle+(pad.buttons[7]?.value??0)-(pad.buttons[6]?.value??0)));
   if(Math.abs(dead(pad.axes[1]))>.5&&!this.car?.grounded)input.throttle=-pad.axes[1];
   input.jump||=!!pad.buttons[0]?.pressed;input.boost||=!!pad.buttons[1]?.pressed;input.drift||=!!pad.buttons[2]?.pressed;
   input.roll+=(pad.buttons[5]?.pressed?1:0)-(pad.buttons[4]?.pressed?1:0);
   if(pad.buttons[3]?.pressed&&!this.padSwap){this.swap();}this.padSwap=!!pad.buttons[3]?.pressed;
  }
  return input;
 }
 private padSwap=false;
 private swap(to:'pip'|'car'=this.character==='car'?'pip':'car'){
  if(to==='car'&&!this.car)return;
  this.character=to;this.keys.clear();this.mouse.boost=this.mouse.jump=false;this.cam.ready=false;this.approach=undefined;
  if(to==='car'){const pip=this.town.pipState(),near=nearestAlong(this.stroll,[pip.x,pip.z]);this.strollAt=near.along;this.offRoute=near.distance>STROLL_REACH;if(!this.offRoute&&near.distance>.5)this.approach=pingPongPoint(this.stroll,this.strollLength,near.along);}
  this.town.attach(this);
 }
 // ---- SceneAddon ----
 driving(){return this.character==='car'&&!!this.car&&DRIVE_MODES.has(this.town.sceneMode);}
 focus(){return this.render.p;}
 speed(){return this.car?.speed??0;}
 private snapshot(){if(!this.car)return;const p=this.car.position,q=this.car.rotation;this.curr.p.set(p.x,p.y,p.z);this.curr.q.set(q.x,q.y,q.z,q.w);}
 fixedStep(dt:number){
  if(!this.car)return;
  this.prev.p.copy(this.curr.p);this.prev.q.copy(this.curr.q);
  const driving=this.driving()&&!this.blocked();
  this.input=driving?this.readInput():{throttle:0,steer:0,roll:0,jump:false,boost:false,drift:false};
  this.car.step(dt,this.input,this.tuning);
  this.snapshot();
  const p=this.car.position;
  this.pads.forEach((pad,i)=>{
   if(this.padTimers[i]>0){this.padTimers[i]-=dt;return;}
   const reach=pad.big?3.2:2.4;if(Math.abs(p.x-pad.x)>reach||Math.abs(p.z-pad.z)>reach||Math.hypot(p.x-pad.x,p.z-pad.z)>reach||p.y-groundHeight(pad.x,pad.z)>3.5)return;
   if(this.car!.boost>=100&&!pad.big)return;
   this.car!.addBoost(pad.big?100:14);this.padTimers[i]=pad.big?10:4;if(pad.big)this.chime('tap');
  });
  if(this.driving()){const pip=this.town.pipState();for(const e of this.jobs.update(dt,[p.x,p.z],[pip.x,pip.z]))this.onJob(e);}
  // Wedged: throttle held, no wheels down and not moving for a while. Put it back on the road.
  if(driving&&(this.input.throttle||this.input.boost)&&!this.car.contacts&&this.car.speed<.6&&!this.car.flipping)this.stuck+=dt;else this.stuck=0;
  if(this.stuck>1.5){this.respawn();this.say('Back on the road.',1.5);}
  const B=driveBounds();
  if(p.y<groundHeight(p.x,p.z)-12||p.x<B.left-30||p.x>B.right+30||p.z<B.top-30||p.z>B.bottom+30)this.respawn();
  if(this.driving())this.towerRun(dt,p);
 }
 private towerRun(dt:number,p:{x:number;z:number}){
  const t=this.tower,west=p.x<DOWNTOWN.right;
  if(!west){t.running=false;t.done=false;t.time=0;return;}
  if(!t.running&&!t.done){t.running=true;t.time=0;this.say('Tower Run: drive to the foot of the CN Tower',3);}
  if(!t.running)return;t.time+=dt;
  if(Math.hypot(p.x-CN_TOWER_POINT[0],p.z-CN_TOWER_POINT[1])<45){
   t.running=false;t.done=true;const best=t.best===undefined||t.time<t.best;if(best){t.best=t.time;writeBest(t.time);}
   this.say(`CN Tower in ${fmt(t.time)}.${String(Math.floor(t.time%1*10))}${best?' · new best':` · best ${fmt(t.best!)}`}`,5);this.chime('bell');
  }
 }
 private onJob(e:JobEvent){
  if(e.kind==='loaded'){this.say(`Pip loads three urgent drops · ${fmt(e.seconds!)} on the clock`,3.5);this.chime('send');}
  if(e.kind==='drop'){this.say(`${e.spot!.label} · delivered · +${Jobs.BONUS} s`,2.2);this.chime('success');}
  if(e.kind==='bundle'){this.say(`All three delivered in ${e.seconds!.toFixed(1)} s`,4);this.chime('bell');}
  if(e.kind==='late'){this.say('Out of time. Pip will have more soon.',4);this.chime('stop');}
  if(e.kind==='ready')this.say('Pip has another urgent bundle. Meet her.',3);
 }
 private say(text:string,seconds:number){this.banner={text,until:this.clock+seconds};}
 visited(x:number,z:number){
  if(!this.car||!this.driving())return;
  // Teleporting from the map while driving takes the car too: onto a clear street near the spot,
  // far enough from Pip not to count as meeting her.
  const at=this.clearSpot([x,z],Jobs.MEET+6);if(!at)return;
  this.car.reset(at.x,at.y+.3,at.z,at.heading);this.snapshot();this.prev.p.copy(this.curr.p);this.prev.q.copy(this.curr.q);this.cam.ready=false;this.approach=undefined;this.offRoute=true;
 }
 pipAutopilot(dt:number,pip:{x:number;z:number;heading:number}){
  if(this.car&&this.jobs.phase==='meet'){
   // Pip stops and turns to wave the car down when it is close.
   const c=this.car.position;if(Math.hypot(c.x-pip.x,c.z-pip.z)<30)return {x:pip.x,z:pip.z,heading:Math.atan2(c.x-pip.x,c.z-pip.z),speed:0};
  }
  if(this.offRoute)return {x:pip.x,z:pip.z,heading:pip.heading,speed:0};
  if(this.approach){
   const dx=this.approach[0]-pip.x,dz=this.approach[1]-pip.z,d=Math.hypot(dx,dz);
   if(d<.2)this.approach=undefined;
   else{const step=Math.min(d,STROLL_SPEED*dt);return {x:pip.x+dx/d*step,z:pip.z+dz/d*step,heading:Math.atan2(dx,dz),speed:STROLL_SPEED};}
  }
  this.strollAt+=STROLL_SPEED*dt;const at=pingPong(this.stroll,this.strollLength,this.strollAt);
  return {x:at.x,z:at.z,heading:at.heading,speed:STROLL_SPEED};
 }
 frame(dt:number,alpha:number){
  this.clock+=dt;
  if(this.car&&this.model){
   this.render.p.lerpVectors(this.prev.p,this.curr.p,Math.min(1,alpha));this.render.q.slerpQuaternions(this.prev.q,this.curr.q,Math.min(1,alpha));
   this.model.root.position.copy(this.render.p);this.model.root.quaternion.copy(this.render.q);
   const v=this.car.vehicle;
   this.model.wheels.forEach((w,i)=>{const rest=v.wheelSuspensionRestLength(i)??.32,length=v.wheelSuspensionLength(i)??rest;w.position.y=this.model!.hubY[i]+rest-length;w.rotation.y=v.wheelSteering(i)??0;w.rotation.x=v.wheelRotation(i)??0;});
   const boosting=this.input.boost&&(this.tuning.infiniteBoost||this.car.boost>0);
   for(const f of this.flames){f.visible=boosting;f.scale.set(1,.7+Math.random()*.6,1);}
   const t=this.tuning,supersonic=this.car.speed>Math.min(t.boostSpeed*.88,60);
   const back=new T.Vector3(0,.25,-this.model.spec.length/2).applyQuaternion(this.render.q).add(this.render.p),side=new T.Vector3(.7,0,0).applyQuaternion(this.render.q);
   this.trail?.update(back,side,supersonic&&dt>0&&!this.reduced);
  }
  else this.render.p.set(this.town.pipState().x,this.town.pipState().y,this.town.pipState().z);
  const lod=GRAPHICS[this.town.getQuality()].lod,focus=this.driving()?this.render.p:this.town.pipState();this.downtown?.update(focus,lod);
  this.updatePads(this.clock);
  this.updateBeacons();
  this.updateHud();
  this.mapClock-=dt;if(this.minimap&&this.mapClock<=0){this.mapClock=1/24;this.drawMap();}
 }
 updateCamera(camera:T.PerspectiveCamera,dt:number){
  const car=this.car!,p=this.render.p,fwd=new T.Vector3(0,0,1).applyQuaternion(this.render.q);fwd.y=0;
  if(fwd.lengthSq()<.01)fwd.copy(this.cam.fwd);fwd.normalize();
  // Hold the view steady through flips and spins; follow the nose on the ground.
  this.cam.fwd.lerp(fwd,this.cam.ready?1-Math.exp(-(car.grounded?6:1.2)*dt):1).normalize();
  const speed=car.speed,back=6.4+Math.min(5,speed*.05),height=2.1+Math.min(1.4,speed*.02);
  const origin=p.clone().add(new T.Vector3(0,1.2,0)),desired=p.clone().addScaledVector(this.cam.fwd,-back).add(new T.Vector3(0,height,0));
  if(!this.settings.ghost){
   const dir=desired.clone().sub(origin),len=dir.length();dir.normalize();
   const hit=this.town.streetPhysics.world.castRay(new RAPIER.Ray(origin,dir),len,true,undefined,undefined,car.collider,car.body);
   if(hit&&hit.timeOfImpact<len)desired.copy(origin).addScaledVector(dir,Math.max(.8,hit.timeOfImpact-.35));
  }
  desired.y=Math.max(desired.y,groundHeight(desired.x,desired.z)+.5);
  if(!this.cam.ready||this.cam.pos.distanceTo(desired)>80){this.cam.pos.copy(desired);this.cam.ready=true;}
  else this.cam.pos.lerp(desired,1-Math.exp(-11*dt));
  camera.position.copy(this.cam.pos);camera.lookAt(p.x+this.cam.fwd.x*4,p.y+1.1,p.z+this.cam.fwd.z*4);
  // Reduced motion keeps a steady lens: no speed surge.
  const fov=this.reduced?66:66+28*Math.min(1,speed/Math.max(40,this.tuning.boostSpeed));camera.fov=T.MathUtils.damp(camera.fov,fov,4,dt);camera.updateProjectionMatrix();
 }
 // ---- presentation ----
 private updateBeacons(){
  const showTargets=this.settings.rush&&this.jobs.phase==='run';
  while(this.beacons.children.length<this.jobs.targets.length)this.beacons.add(beacon(0xff8a5c));
  this.beacons.children.forEach((b,i)=>{const t=this.jobs.targets[i];b.visible=showTargets&&!!t&&!t.done;if(t)b.position.set(t.x,groundHeight(t.x,t.z),t.z);b.rotation.y=this.clock*.6;});
  const pip=this.town.pipState();this.meetBeacon.visible=this.settings.rush&&this.driving()&&this.jobs.phase==='meet';this.meetBeacon.position.set(pip.x,pip.y-.1,pip.z);this.meetBeacon.rotation.y=-this.clock*.8;
 }
 private updateHud(){
  if(!this.settings.rush){this.hud.innerHTML='';return;}
  const car=this.car,j=this.jobs,driving=this.driving();
  let task:string;
  if(!car)task='Bringing the car round…';
  else if(!driving)task=`<kbd>C</kbd> Take the wheel`;
  else if(j.phase==='meet')task='<b>Pip needs a hand.</b> Meet her';
  else if(j.phase==='run')task=`<b>Urgent</b> ${j.targets.filter(t=>t.done).length} of ${j.targets.length} delivered <span class="rush-clock ${j.timeLeft<10?'low':''}">${fmt(Math.max(0,j.timeLeft))}</span>`;
  else task=j.phase==='done'?'<b>Bundle delivered</b>':'<b>Out of time</b>';
  if(car&&driving&&j.phase!=='run'&&car.position.x<DOWNTOWN.right){const km=(Math.hypot(car.position.x-CN_TOWER_POINT[0],car.position.z-CN_TOWER_POINT[1])/1000).toFixed(1);task=`<b>Tower Run</b> CN Tower ${km} km${this.tower.running?` <span class="rush-clock">${fmt(this.tower.time)}</span>`:''}${this.tower.best?` <span class="rush-score">best ${fmt(this.tower.best)}</span>`:''}`;}
  const banner=this.banner&&this.clock<this.banner.until?this.banner.text:'';
  const kmh=Math.round((car?.speed??0)*3.6),boost=Math.round(car?.boost??0),infinite=this.tuning.infiniteBoost;
  const supersonic=!!car&&car.speed>Math.min(this.tuning.boostSpeed*.88,60);
  const html=`<div class="rush-task">${task}${j.bundles?`<span class="rush-score">${j.bundles} bundle${j.bundles>1?'s':''}${j.best?` · best ${j.best.toFixed(1)} s`:''}</span>`:''}</div>
   ${banner?`<div class="rush-banner" role="status">${banner}</div>`:''}
   ${driving?`<div class="rush-gauge ${supersonic?'supersonic':''}"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44"/><circle class="fill" cx="50" cy="50" r="44" style="stroke-dashoffset:${276.5*(1-(infinite?1:boost/100))}"/></svg><strong>${infinite?'∞':boost}</strong><span>BOOST</span><em>${kmh} km/h</em>${supersonic?'<i>SUPERSONIC</i>':''}</div>`:''}`;
  if(html!==this.hud.dataset.html){this.hud.dataset.html=html;this.hud.innerHTML=html;}
 }
 private drawMap(){
  const pip=this.town.pipState(),markers:MapMarker[]=[];
  const [dx,dz]=NODES.side;markers.push({kind:'delivery',x:dx,z:dz,label:'P'});
  if(this.settings.rush){
   for(const [i,t] of this.jobs.targets.entries())if(this.jobs.phase==='run')markers.push({kind:'target',x:t.x,z:t.z,label:String(i+1),done:t.done});
   if(this.car&&this.jobs.phase==='meet')markers.push({kind:'meet',x:pip.x,z:pip.z});
   this.pads.forEach((p,i)=>{if(p.big&&this.padTimers[i]<=0)markers.push({kind:'boost',x:p.x,z:p.z});});
  }
  if(this.downtown)markers.push({kind:'landmark',x:CN_TOWER_POINT[0],z:CN_TOWER_POINT[1]});
  markers.push({kind:'pip',x:pip.x,z:pip.z,heading:pip.heading});
  if(this.car){const c=this.render.p;markers.push({kind:'car',x:c.x,z:c.z,heading:this.car.heading});}
  const driving=this.driving()&&this.car;
  const focus=driving?{x:this.render.p.x,z:this.render.p.z,heading:this.car!.heading,speed:this.car!.speed}:{x:pip.x,z:pip.z,heading:pip.heading,speed:pip.speed};
  this.minimap!.draw({focus,markers,route:this.town.journeyPath()});
 }
 /** For ?debug browser checks only. */
 diagnostics(){const c=this.car;return {character:this.character,driving:this.driving(),blocked:this.blocked(),keys:[...this.keys],input:this.input,mode:this.town.sceneMode,paused:this.town.paused,car:c?{...c.position,speed:c.speed,boost:c.boost,contacts:c.contacts,heading:c.heading}:null,jobs:{phase:this.jobs.phase,timeLeft:this.jobs.timeLeft,bundles:this.jobs.bundles,targets:this.jobs.targets.map(t=>({id:t.id,x:t.x,z:t.z,done:t.done}))},pip:this.town.pipState(),pads:this.pads.length,minimap:this.minimap?.large??null};}
 teleport(x:number,z:number){if(!this.car)return;this.car.reset(x,groundHeight(x,z)+.9,z,this.car.heading);this.snapshot();this.prev.p.copy(this.curr.p);}
 dispose(){
  this.removeCar();this.clearPads();this.downtown?.dispose();setExtraArea(undefined);this.minimap?.dispose();this.hud.remove();this.group.removeFromParent();
  window.removeEventListener('keydown',this.keyDown,{capture:true});window.removeEventListener('keyup',this.keyUp,{capture:true});window.removeEventListener('blur',this.blur);
  this.canvas?.removeEventListener('pointerdown',this.pointer);window.removeEventListener('pointerup',this.pointer);
 }
}

const pingPongPoint=(path:Point[],length:number,along:number):Point=>{const p=pingPong(path,length,along);return [p.x,p.z];};

/** A tall see-through column and a ground ring: visible over the rooftops from anywhere on the map. */
function beacon(color:number){
 const g=new T.Group(),mat=new T.MeshBasicMaterial({color,transparent:true,opacity:.26,blending:T.AdditiveBlending,depthWrite:false,fog:false,side:T.DoubleSide});
 const column=new T.Mesh(new T.CylinderGeometry(1.25,1.25,70,24,1,true),mat);column.position.y=35;
 const ring=new T.Mesh(new T.RingGeometry(5,6.3,48),new T.MeshBasicMaterial({color,transparent:true,opacity:.7,depthWrite:false,side:T.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=.08;
 g.add(column,ring);return g;
}

/** A fading ribbon behind the car once it goes supersonic. */
class Trail{
 private count=48;private positions=new Float32Array(this.count*2*3);private colors=new Float32Array(this.count*2*3);
 private mesh:T.Mesh;private filled=0;
 constructor(parent:T.Object3D){
  const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(this.positions,3));g.setAttribute('color',new T.BufferAttribute(this.colors,3));
  const index:number[]=[];for(let i=0;i<this.count-1;i++){const a=i*2;index.push(a,a+1,a+2,a+1,a+3,a+2);}g.setIndex(index);
  this.mesh=new T.Mesh(g,new T.MeshBasicMaterial({vertexColors:true,transparent:true,blending:T.AdditiveBlending,depthWrite:false,side:T.DoubleSide}));
  this.mesh.frustumCulled=false;this.mesh.visible=false;parent.add(this.mesh);
 }
 update(at:T.Vector3,side:T.Vector3,on:boolean){
  if(!on){this.filled=Math.max(0,this.filled-2);}
  else{this.positions.copyWithin(6,0,(this.count-1)*6);this.positions.set([at.x+side.x,at.y+side.y,at.z+side.z,at.x-side.x,at.y-side.y,at.z-side.z],0);this.filled=Math.min(this.count,this.filled+1);}
  for(let i=0;i<this.count;i++){const k=i<this.filled?Math.pow(1-i/this.count,1.6)*.9:0;for(const o of [0,3])this.colors.set([k,k*.97,k*.9],i*6+o);}
  this.mesh.visible=this.filled>1;(this.mesh.geometry.getAttribute('position') as T.BufferAttribute).needsUpdate=true;(this.mesh.geometry.getAttribute('color') as T.BufferAttribute).needsUpdate=true;
 }
 dispose(){this.mesh.removeFromParent();this.mesh.geometry.dispose();(this.mesh.material as T.Material).dispose();}
}
