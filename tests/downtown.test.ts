import {test} from 'node:test';import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import {StreetPhysics} from '../src/physics';
import {GEO} from '../src/geography';
import {RaceCar,NORMAL_TUNING,NO_INPUT,reserveGroundGroup,type CarSpec} from '../src/rush/race-car';
import {addDowntownColliders,DOWNTOWN,DOWNTOWN_ROADS,DOWNTOWN_BUILDINGS,CN_TOWER_POINT} from '../src/rush/downtown';
import {setExtraArea,clearSpot,driveBounds,layoutPads,inBuilding} from '../src/rush/rush-logic';
await RAPIER.init();
const spec:CarSpec={width:1.9,height:1.3,length:4.4,wheelRadius:.34,wheels:[{x:.8,y:-.05,z:1.35,front:true},{x:-.8,y:-.05,z:1.35,front:true},{x:.8,y:-.05,z:-1.35,front:false},{x:-.8,y:-.05,z:-1.35,front:false}]};

test('downtown reaches past the CN Tower and joins the authored map at its western edge',()=>{
 assert.ok(CN_TOWER_POINT[0]>DOWNTOWN.left&&CN_TOWER_POINT[0]<DOWNTOWN.right&&CN_TOWER_POINT[1]>DOWNTOWN.top&&CN_TOWER_POINT[1]<DOWNTOWN.bottom);
 assert.ok(DOWNTOWN.right>=-930&&DOWNTOWN_ROADS.length>800&&DOWNTOWN_BUILDINGS.length>3900);
 for(const name of ['Queen Street West','King Street West','Front Street West','Bremner Boulevard','Lower Simcoe Street'])assert.ok(DOWNTOWN_ROADS.some(r=>r.n===name),name);
 assert.equal(inBuilding(CN_TOWER_POINT[0],CN_TOWER_POINT[1]),false);
});
test('with downtown loaded the drive area, spawns and boost pads extend west',()=>{
 setExtraArea({roads:DOWNTOWN_ROADS,buildings:DOWNTOWN_BUILDINGS,bounds:DOWNTOWN});
 try{assert.equal(driveBounds().left,DOWNTOWN.left);assert.ok(layoutPads(90,DOWNTOWN_ROADS,DOWNTOWN).length>60);}
 finally{setExtraArea(undefined);}
 assert.notEqual(driveBounds().left,DOWNTOWN.left);
});
test('a car parked near the CN Tower can drive to its foot',()=>{
 const physics=new StreetPhysics(GEO.buildings.map(b=>({x:0,z:0,w:0,d:0,h:b.h,p:b.p,holes:b.holes})),[],[]);reserveGroundGroup(physics.world,physics.ground);
 addDowntownColliders(physics.world);setExtraArea({roads:DOWNTOWN_ROADS,buildings:DOWNTOWN_BUILDINGS,bounds:DOWNTOWN});
 try{
  // Bremner Boulevard runs along the tower's south side, the same side of the rail corridor.
  const at=clearSpot(physics.world,physics.ground,[-3691.8,942.3],0)!;assert.ok(at,'clear street near the tower');
  const car=new RaceCar(physics.world,spec,at);let best=Infinity;
  for(let i=0;i<90*30;i++){
   const p=car.position,want=Math.atan2(CN_TOWER_POINT[0]-p.x,CN_TOWER_POINT[1]-p.z);let err=want-car.heading;err=Math.atan2(Math.sin(err),Math.cos(err));
   car.step(1/90,{...NO_INPUT,throttle:car.speed>12?0:1,steer:Math.max(-1,Math.min(1,-err*2))},NORMAL_TUNING);physics.world.step();
   best=Math.min(best,Math.hypot(p.x-CN_TOWER_POINT[0],p.z-CN_TOWER_POINT[1]));if(best<45)break;
  }
  assert.ok(best<45,`closest approach ${best.toFixed(1)} m from ${at.x.toFixed(0)},${at.z.toFixed(0)}`);
  assert.ok(car.position.y>-2,'stayed on the downtown ground');
 }finally{setExtraArea(undefined);physics.dispose();}
});
test('Queen Street runs on from the authored map into downtown without a wall at the seam',async()=>{
 const {queenZ}=await import('../src/geography');const {groundHeight}=await import('../src/terrain');
 const physics=new StreetPhysics(GEO.buildings.map(b=>({x:0,z:0,w:0,d:0,h:b.h,p:b.p,holes:b.holes})),[],[]);reserveGroundGroup(physics.world,physics.ground);addDowntownColliders(physics.world);
 try{
  // Queen's centreline just east of River Street, heading west across the old map edge.
  const queen=DOWNTOWN_ROADS.filter(r=>r.n==='Queen Street East'||r.n==='Queen Street West').flatMap(r=>r.p);
  const zAt=(x:number)=>{if(x>-915)return queenZ(x);let best=queen[0];for(const p of queen)if(Math.abs(p[0]-x)<Math.abs(best[0]-x))best=p;return best[1];};
  const car=new RaceCar(physics.world,spec,{x:-880,y:groundHeight(-880,zAt(-880))+.9,z:zAt(-880),heading:-Math.PI/2});
  for(let i=0;i<90*30;i++){
   const p=car.position,ahead=p.x-12,want=Math.atan2(ahead-p.x,zAt(ahead)-p.z);let err=want-car.heading;err=Math.atan2(Math.sin(err),Math.cos(err));
   car.step(1/90,{...NO_INPUT,throttle:car.speed>16?0:1,steer:Math.max(-1,Math.min(1,-err*2))},NORMAL_TUNING);physics.world.step();
  }
  assert.ok(car.position.x<-1300,`reached x=${car.position.x.toFixed(0)}`);assert.ok(car.contacts>=2);
 }finally{physics.dispose();}
});
