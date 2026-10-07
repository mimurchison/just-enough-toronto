import RAPIER from '@dimforge/rapier3d-compat';
import {GEO,VISITS,inside} from '../geography';
import {groundHeight} from '../terrain';
import {BOUNDS,pathAt,smoothRoute} from '../motion';
import {EDGES,NODES,edgePoints,type NodeId,type Point} from '../game';

// The rules of Rush, kept free of rendering so they can be tested directly.

/**
 * Extra drivable area beyond the authored map (Rush's downtown). Streets here are all
 * drivable; footprints are solid. Empty unless the downtown district is loaded.
 */
export const EXTRA:{roads:{p:Point[]}[];buildings:{p:Point[];bounds:number[]}[];bounds?:typeof BOUNDS}={roads:[],buildings:[]};
export function setExtraArea(area?:{roads:{p:Point[]}[];buildings:{p:Point[]}[];bounds:typeof BOUNDS}){
 EXTRA.roads=area?.roads??[];EXTRA.bounds=area?.bounds;
 EXTRA.buildings=(area?.buildings??[]).map(b=>{const xs=b.p.map(p=>p[0]),zs=b.p.map(p=>p[1]);return {p:b.p,bounds:[Math.min(...xs),Math.min(...zs),Math.max(...xs),Math.max(...zs)]};});
}
/** The playable rectangle: the authored map, grown to include any extra area. */
export function driveBounds(){const e=EXTRA.bounds;return e?{left:Math.min(BOUNDS.left,e.left),right:Math.max(BOUNDS.right,e.right),top:Math.min(BOUNDS.top,e.top),bottom:Math.max(BOUNDS.bottom,e.bottom)}:BOUNDS;}

/** Pip's stroll while you drive: her own delivery route, the open park path, there and back. */
const STROLL:NodeId[]=['bakery','west','southwest','southeast','east','approach','side'];
export function strollPath():Point[]{
 const points:Point[]=[NODES.bakery];
 for(let i=1;i<STROLL.length;i++){
  const a=STROLL[i-1],b=STROLL[i],edge=EDGES.find(e=>(e.a===a&&e.b===b)||(e.a===b&&e.b===a));
  if(!edge)throw new Error(`No edge ${a}–${b}`);points.push(...edgePoints(edge,a).slice(1));
 }
 return smoothRoute(points);
}
export const pathLength=(p:Point[])=>p.slice(1).reduce((sum,q,i)=>sum+Math.hypot(q[0]-p[i][0],q[1]-p[i][1]),0);
/** Walk out and back along a path forever: distance is total metres walked. */
export function pingPong(path:Point[],length:number,distance:number){
 const lap=distance%(2*length),back=lap>length,at=pathAt(path,back?2*length-lap:lap);
 return back?{...at,heading:at.heading+Math.PI}:at;
}
/** Metres along the path of the point nearest p. */
export function nearestAlong(path:Point[],p:Point){
 let best=Infinity,along=0,total=0;
 for(let i=1;i<path.length;i++){
  const a=path[i-1],b=path[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz)||1,t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(len*len)));
  const d=Math.hypot(a[0]+dx*t-p[0],a[1]+dz*t-p[1]);if(d<best){best=d;along=total+len*t;}total+=len;
 }
 return {distance:best,along};
}

export type Spot={id:string;label:string;x:number;z:number};
/** Drop-off spots: the named places on the map, each standing on open pavement. */
export const SPOTS:Spot[]=VISITS.filter(v=>v.position[0]>BOUNDS.left+5&&v.position[0]<BOUNDS.right-5&&v.position[1]>BOUNDS.top+5&&v.position[1]<BOUNDS.bottom-5)
 .map(v=>({id:v.id,label:v.label.split(' · ')[0],x:v.position[0],z:v.position[1]}));

/** Three drop-offs that are a drive away from Pip and from each other. */
export function pickTargets(from:Point,random:()=>number,count=3):Spot[]{
 for(const [near,apart] of [[110,80],[70,50],[0,0]]){
  const pool=SPOTS.filter(s=>Math.hypot(s.x-from[0],s.z-from[1])>=near).sort(()=>random()-.5),out:Spot[]=[];
  for(const s of pool){if(out.every(o=>Math.hypot(o.x-s.x,o.z-s.z)>=apart))out.push(s);if(out.length===count)return out;}
 }
 return SPOTS.slice(0,count);
}
/** Seconds allowed: a nearest-first tour at a brisk 16 m/s, plus time to find your way. */
export function timeBudget(from:Point,targets:Spot[]){
 let at=from,left=[...targets],metres=0;
 while(left.length){left.sort((a,b)=>Math.hypot(a.x-at[0],a.z-at[1])-Math.hypot(b.x-at[0],b.z-at[1]));const next=left.shift()!;metres+=Math.hypot(next.x-at[0],next.z-at[1]);at=[next.x,next.z];}
 return Math.round(metres/16+20);
}

export type Pad={x:number;z:number;big:boolean};
const DRIVABLE=new Set(['secondary','tertiary','residential','unclassified']);
/** Boost pads every ~80 m down the middle of the drivable streets; every fifth is a big one. */
export function layoutPads(spacing=80,streets:{p:Point[]}[]=GEO.roads.filter(r=>DRIVABLE.has(r.kind)&&!r.bridge),area=BOUNDS):Pad[]{
 const pads:Pad[]=[];
 const inside=(x:number,z:number)=>x>area.left+10&&x<area.right-10&&z>area.top+10&&z<area.bottom-10;
 for(const road of streets){
  let carry=spacing/2;
  for(let i=1;i<road.p.length;i++){
   const a=road.p[i-1],b=road.p[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);
   while(carry<=len){const t=carry/len,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;if(inside(x,z)&&pads.every(p=>Math.hypot(p.x-x,p.z-z)>spacing*.45))pads.push({x,z,big:false});carry+=spacing;}
   carry-=len;
  }
 }
 pads.forEach((p,i)=>{p.big=i%5===2;});
 return pads;
}

/**
 * The nearest point down the middle of a drivable side street, and the road's direction there.
 * Queen is left out: the streetcar and traffic use it, and a parked race car would block them.
 */
export function nearestRoad(p:Point){
 let best:{x:number;z:number;heading:number;distance:number}|undefined;
 for(const road of GEO.roads){
  if(!DRIVABLE.has(road.kind)||road.name==='Queen Street East')continue;
  for(let i=1;i<road.p.length;i++){
   const a=road.p[i-1],b=road.p[i],dx=b[0]-a[0],dz=b[1]-a[1],len2=dx*dx+dz*dz||1,t=Math.max(.05,Math.min(.95,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/len2));
   const x=a[0]+dx*t,z=a[1]+dz*t,d=Math.hypot(x-p[0],z-p[1]);
   if(x<BOUNDS.left+10||x>BOUNDS.right-10||z<BOUNDS.top+10||z>BOUNDS.bottom-10)continue;
   if(!best||d<best.distance)best={x,z,heading:Math.atan2(dx,dz),distance:d};
  }
 }
 return best;
}

/** Points every few metres down the middle of nearby side streets, nearest first, with the road's direction. */
export function roadSpots(p:Point,radius=160,step=4){
 const out:{x:number;z:number;heading:number;distance:number}[]=[],B=driveBounds();
 const streets=[...GEO.roads.filter(r=>DRIVABLE.has(r.kind)&&r.name!=='Queen Street East'),...EXTRA.roads];
 for(const road of streets){
  for(let i=1;i<road.p.length;i++){
   const a=road.p[i-1],b=road.p[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]),heading=Math.atan2(b[0]-a[0],b[1]-a[1]);
   for(let d=step/2;d<len;d+=step){
    const x=a[0]+(b[0]-a[0])*d/len,z=a[1]+(b[1]-a[1])*d/len,distance=Math.hypot(x-p[0],z-p[1]);
    if(distance<=radius&&x>B.left+10&&x<B.right-10&&z>B.top+10&&z<B.bottom-10)out.push({x,z,heading,distance});
   }
  }
 }
 return out.sort((a,b)=>a.distance-b.distance);
}

/** True when a point is inside a mapped building footprint (walls only: a car there is boxed in). */
export function inBuilding(x:number,z:number,pad=0){
 for(const b of [...GEO.buildings,...EXTRA.buildings]){const [x0,z0,x1,z1]=b.bounds;if(x<x0-pad||x>x1+pad||z<z0-pad||z>z1+pad)continue;if(inside([x,z],b.p))return true;}
 return false;
}
/**
 * The nearest point on a side street, at least `minimum` metres from `near`, where a car fits:
 * outside every building footprint, a car-sized box touching nothing but the ground, and
 * clear sky above. Mapped centrelines can run under bridges, through gates or past furniture.
 */
export function clearSpot(world:RAPIER.World,ground:RAPIER.Collider,near:Point,minimum=0,ignore?:RAPIER.Collider){
 const shape=new RAPIER.Cuboid(1.3,.7,2.6);
 for(const spot of roadSpots(near)){
  if(spot.distance<minimum||inBuilding(spot.x,spot.z,3))continue;
  const y=groundHeight(spot.x,spot.z),rotation={x:0,y:Math.sin(spot.heading/2),z:0,w:Math.cos(spot.heading/2)};let blocked=false;
  world.intersectionsWithShape({x:spot.x,y:y+1.05,z:spot.z},rotation,shape,c=>{if(c.handle===ground.handle||c.handle===ignore?.handle)return true;blocked=true;return false;});
  if(!blocked&&world.castRay(new RAPIER.Ray({x:spot.x,y:y+1.8,z:spot.z},{x:0,y:1,z:0}),4,true,undefined,undefined,ignore))blocked=true;
  if(blocked)continue;
  // Face whichever way along the street is open longer, so the first press of W goes somewhere.
  const body=new RAPIER.Cuboid(1.05,.4,2.3);
  const run=(h:number)=>world.castShape({x:spot.x,y:y+.85,z:spot.z},{x:0,y:Math.sin(h/2),z:0,w:Math.cos(h/2)},{x:Math.sin(h),y:0,z:Math.cos(h)},body,0,60,true,undefined,undefined,ignore,undefined,c=>c.handle!==ground.handle)?.time_of_impact??60;
  const ahead=run(spot.heading),behind=run(spot.heading+Math.PI),heading=ahead>=behind?spot.heading:spot.heading+Math.PI;
  if(Math.max(ahead,behind)<12)continue;
  return {x:spot.x,y:y+.9,z:spot.z,heading};
 }
}

export type JobPhase='meet'|'run'|'done'|'late';
export type JobEvent={kind:'loaded'|'drop'|'bundle'|'late'|'ready';spot?:Spot;seconds?:number};
/**
 * Pip's urgent bundles. Meet her (she is out walking) to load three parcels, then
 * drop each at its target before the clock runs out. Each drop buys a little time.
 */
export class Jobs{
 phase:JobPhase='meet';
 targets:(Spot&{done:boolean})[]=[];
 timeLeft=0;elapsed=0;bundles=0;best?:number;
 private wait=0;
 static MEET=8;static DROP=8;static BONUS=6;
 constructor(private random:()=>number=Math.random){}
 update(dt:number,car:Point,pip:Point):JobEvent[]{
  const events:JobEvent[]=[];
  if(this.phase==='done'||this.phase==='late'){this.wait-=dt;if(this.wait<=0){this.phase='meet';this.targets=[];events.push({kind:'ready'});}return events;}
  if(this.phase==='meet'){
   if(Math.hypot(car[0]-pip[0],car[1]-pip[1])<Jobs.MEET){
    this.targets=pickTargets(pip,this.random).map(s=>({...s,done:false}));this.timeLeft=timeBudget(pip,this.targets);this.elapsed=0;this.phase='run';
    events.push({kind:'loaded',seconds:this.timeLeft});
   }
   return events;
  }
  this.timeLeft-=dt;this.elapsed+=dt;
  for(const t of this.targets)if(!t.done&&Math.hypot(car[0]-t.x,car[1]-t.z)<Jobs.DROP){t.done=true;this.timeLeft+=Jobs.BONUS;events.push({kind:'drop',spot:t});}
  if(this.targets.every(t=>t.done)){this.phase='done';this.bundles++;this.best=Math.min(this.best??Infinity,this.elapsed);this.wait=4;events.push({kind:'bundle',seconds:this.elapsed});}
  else if(this.timeLeft<=0){this.phase='late';this.timeLeft=0;this.wait=4;events.push({kind:'late'});}
  return events;
 }
}
