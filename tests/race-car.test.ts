import {test} from 'node:test';import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import {RaceCar,NORMAL_TUNING,SUPERSONIC_TUNING,NO_INPUT,reserveGroundGroup,type CarInput,type CarSpec} from '../src/rush/race-car';
await RAPIER.init();
const spec:CarSpec={width:1.9,height:1.3,length:4.4,wheelRadius:.34,wheels:[{x:.8,y:-.05,z:1.35,front:true},{x:-.8,y:-.05,z:1.35,front:true},{x:.8,y:-.05,z:-1.35,front:false},{x:-.8,y:-.05,z:-1.35,front:false}]};
function rig(){const world=new RAPIER.World({x:0,y:-9.81,z:0});world.timestep=1/90;const ground=world.createCollider(RAPIER.ColliderDesc.cuboid(5000,.5,5000).setTranslation(0,-.5,0));const car=new RaceCar(world,spec,{x:0,y:1.2,z:0,heading:0});return {world,car,ground};}
function run(s:ReturnType<typeof rig>,seconds:number,input:Partial<CarInput>={},tuning=NORMAL_TUNING,each?:()=>void){for(let i=0;i<Math.round(seconds*90);i++){s.car.step(1/90,{...NO_INPUT,...input},tuning);s.world.step();each?.();}}

test('the race car rests on its tyres and drives forward to its top speed',()=>{
 const s=rig();run(s,2);assert.equal(s.car.contacts,4);assert.ok(s.car.position.y>.2,'chassis is off the ground');
 run(s,6,{throttle:1});assert.ok(Math.abs(s.car.speed-NORMAL_TUNING.maxSpeed)<1.5,`${s.car.speed}`);assert.ok(s.car.position.z>100&&Math.abs(s.car.position.x)<1);
});
test('steering right turns right; boost adds speed and spends the meter',()=>{
 const s=rig();run(s,2);run(s,3,{throttle:1});const h=s.car.heading;run(s,.6,{throttle:1,steer:1});assert.ok(s.car.heading<h-.2);
 const v=s.car.speed;run(s,1,{throttle:1,boost:true});assert.ok(s.car.speed>v+5);assert.ok(s.car.boost<33);
});
test('jump, double jump and a front flip that lands on its wheels',()=>{
 const s=rig();run(s,2);const y0=s.car.position.y;let peak=0;run(s,.05,{jump:true});run(s,2,{},NORMAL_TUNING,()=>{peak=Math.max(peak,s.car.position.y-y0);});
 assert.ok(peak>1&&peak<2.5,`${peak}`);
 run(s,.05,{jump:true});run(s,.25);run(s,.05,{jump:true});let high=0;run(s,2,{},NORMAL_TUNING,()=>{high=Math.max(high,s.car.position.y-y0);});assert.ok(high>peak+.5,`${high}`);
 run(s,.05,{jump:true});run(s,.25);let minUp=1;run(s,.05,{jump:true,throttle:1});run(s,2.5,{},NORMAL_TUNING,()=>{minUp=Math.min(minUp,s.car.up.y);});
 assert.ok(minUp<0,'went over');assert.ok(s.car.up.y>.9&&s.car.contacts>=2,'landed upright');
});
test('supersonic reaches well past normal top speed without leaving the ground',()=>{
 const s=rig();run(s,1);run(s,10,{throttle:1,boost:true},SUPERSONIC_TUNING);assert.ok(s.car.speed>90,`${s.car.speed}`);assert.equal(s.car.contacts,4);assert.equal(s.car.boost,33);
});
test('a car on its roof rights itself',()=>{const s=rig();run(s,1);s.car.reset(0,3,0,0);s.car.body.setRotation({x:0,y:0,z:1,w:0},true);run(s,4);assert.ok(s.car.up.y>.9);});
test('ghost mode passes through walls but still drives on the ground',()=>{
 const s=rig();const wall=s.world.createCollider(RAPIER.ColliderDesc.cuboid(10,3,.2).setTranslation(0,3,30));reserveGroundGroup(s.world,s.ground);
 run(s,1);run(s,4,{throttle:1});assert.ok(s.car.position.z<30,'solid wall stops the car');
 s.car.reset(0,1,0,0);run(s,1);run(s,4,{throttle:1},{...NORMAL_TUNING,ghost:true});assert.ok(s.car.position.z>40,'ghost passes the wall');assert.ok(s.car.contacts>=2);void wall;
});

test('on the real Queen East terrain and buildings, the car drives away from where it parks',async()=>{
 const {StreetPhysics}=await import('../src/physics');const {GEO}=await import('../src/geography');const {nearestRoad}=await import('../src/rush/rush-logic');const {groundHeight}=await import('../src/terrain');
 const buildings=GEO.buildings.map(b=>({x:0,z:0,w:0,d:0,h:b.h,p:b.p,holes:b.holes}));
 const physics=new StreetPhysics(buildings,[],[]);reserveGroundGroup(physics.world,physics.ground);
 for(const [px,pz] of [[-871,55],[-14,-6],[24,-280]]){
  const road=nearestRoad([px,pz])!,car=new RaceCar(physics.world,spec,{x:road.x,y:groundHeight(road.x,road.z)+.9,z:road.z,heading:road.heading});
  for(let i=0;i<90;i++){car.step(1/90,NO_INPUT,NORMAL_TUNING);physics.world.step();}
  const start=car.position;assert.ok(car.contacts>=3,`settled at ${px},${pz}`);
  for(let i=0;i<270;i++){car.step(1/90,{...NO_INPUT,throttle:1},NORMAL_TUNING);physics.world.step();}
  const end=car.position;assert.ok(Math.hypot(end.x-start.x,end.z-start.z)>25,`drove from ${px},${pz}: ${Math.hypot(end.x-start.x,end.z-start.z)}`);assert.ok(end.y>groundHeight(end.x,end.z)-1);
  car.dispose();
 }
 physics.dispose();
});

test('from every landmark, the car parks somewhere clear and can drive away',async()=>{
 const {StreetPhysics}=await import('../src/physics');const {GEO,VISITS}=await import('../src/geography');const {clearSpot}=await import('../src/rush/rush-logic');
 const physics=new StreetPhysics(GEO.buildings.map(b=>({x:0,z:0,w:0,d:0,h:b.h,p:b.p,holes:b.holes})),[],[]);reserveGroundGroup(physics.world,physics.ground);
 const failures:string[]=[];
 for(const v of VISITS){
  const at=clearSpot(physics.world,physics.ground,v.position,14);if(!at){failures.push(`${v.id}: no clear spot`);continue;}
  const car=new RaceCar(physics.world,spec,at);
  for(let i=0;i<90;i++){car.step(1/90,NO_INPUT,NORMAL_TUNING);physics.world.step();}
  const start=car.position,settled=car.contacts;
  for(let i=0;i<270;i++){car.step(1/90,{...NO_INPUT,throttle:1},NORMAL_TUNING);physics.world.step();}
  const moved=Math.hypot(car.position.x-start.x,car.position.z-start.z);
  if(settled<3||moved<9)failures.push(`${v.id}: wheels down ${settled}, drove ${moved.toFixed(1)} m from ${at.x.toFixed(0)},${at.z.toFixed(0)}`);
  car.dispose();
 }
 physics.dispose();
 assert.deepEqual(failures,[]);
});
