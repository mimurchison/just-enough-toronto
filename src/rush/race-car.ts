import RAPIER from '@dimforge/rapier3d-compat';

// An arcade race car in the same Rapier world as Pip: a dynamic chassis on
// four ray-cast wheels, tuned for Rocket League-style handling rather than
// realism. Chassis space: +Z forward, +Y up, +X to the car's left.

export type WheelMount={x:number;y:number;z:number;front:boolean};
export type CarSpec={width:number;height:number;length:number;wheelRadius:number;wheels:WheelMount[]};
/** throttle and steer in [-1,1]; steer +1 is right; roll +1 rolls right. */
export type CarInput={throttle:number;steer:number;roll:number;jump:boolean;boost:boolean;drift:boolean};
export type CarTuning={
 /** Top speed on throttle alone, m/s. */ maxSpeed:number;
 /** Top speed while boosting, m/s. */ boostSpeed:number;
 /** Forward acceleration from boost, m/s². */ boostAccel:number;
 /** Boost meter used per second (meter is 0–100). */ boostUse:number;
 infiniteBoost:boolean;
 /** Upward speed added by a jump, m/s. */ jump:number;
 gravityScale:number;
 /** Drive through buildings and street furniture; only the ground is solid. */ ghost:boolean;
};
export const NORMAL_TUNING:CarTuning={maxSpeed:26,boostSpeed:38,boostAccel:17,boostUse:33,infiniteBoost:false,jump:5.4,gravityScale:1.25,ghost:false};
export const SUPERSONIC_TUNING:CarTuning={maxSpeed:48,boostSpeed:110,boostAccel:48,boostUse:0,infiniteBoost:true,jump:9,gravityScale:1.25,ghost:false};
export const NO_INPUT:CarInput={throttle:0,steer:0,roll:0,jump:false,boost:false,drift:false};

const MASS=1000;
/** Interaction-group bit carried only by the ground, so a ghost car can still drive on it. */
export const GROUND_GROUP=0x0001;
const groups=(membership:number,filter:number)=>(membership<<16)|filter;

type Quat={x:number;y:number;z:number;w:number};
type Vec={x:number;y:number;z:number};
export const rotate=(q:Quat,v:Vec):Vec=>{
 const tx=2*(q.y*v.z-q.z*v.y),ty=2*(q.z*v.x-q.x*v.z),tz=2*(q.x*v.y-q.y*v.x);
 return {x:v.x+q.w*tx+q.y*tz-q.z*ty,y:v.y+q.w*ty+q.z*tx-q.x*tz,z:v.z+q.w*tz+q.x*ty-q.y*tx};
};
const dot=(a:Vec,b:Vec)=>a.x*b.x+a.y*b.y+a.z*b.z;
const scale=(a:Vec,s:number):Vec=>({x:a.x*s,y:a.y*s,z:a.z*s});
const yawQuat=(h:number):Quat=>({x:0,y:Math.sin(h/2),z:0,w:Math.cos(h/2)});

/**
 * Every collider already in the world gives up the ground bit, except the ground itself.
 * Their filters stay 0xFFFF, so nothing changes between them; only a ghost car, whose
 * filter is the ground bit alone, stops seeing them.
 */
export function reserveGroundGroup(world:RAPIER.World,ground:RAPIER.Collider){
 world.forEachCollider(c=>{if(c.handle!==ground.handle)c.setCollisionGroups(groups(0xFFFF&~GROUND_GROUP,0xFFFF));});
}

export class RaceCar{
 readonly body:RAPIER.RigidBody;
 readonly collider:RAPIER.Collider;
 readonly vehicle:RAPIER.DynamicRayCastVehicleController;
 boost=33;
 /** Seconds since any wheel touched the ground; 0 while grounded. */
 airTime=0;
 /** Wheels touching the ground after the last step. */
 contacts=0;
 private previousJump=false;private sinceJump=99;private secondJump=false;private holdJump=0;private flip=0;private upsideDown=0;
 private ghost=false;
 constructor(private world:RAPIER.World,readonly spec:CarSpec,at:{x:number;y:number;z:number;heading:number}){
  this.body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x,at.y,at.z).setRotation(yawQuat(at.heading)).setCcdEnabled(true).setLinearDamping(.05).setAngularDamping(.6).setCanSleep(false));
  // The body box starts just above the hub line, like a real car's floor, so the tyres
  // carry the weight; it stays low so hard turns lean rather than roll.
  const hx=spec.width*.44,hy=spec.height*.2,hz=spec.length*.46,volume=8*hx*hy*hz;
  const hub=spec.wheels.reduce((sum,w)=>sum+w.y,0)/spec.wheels.length;
  this.collider=world.createCollider(RAPIER.ColliderDesc.cuboid(hx,hy,hz).setTranslation(0,hub+.06+hy,0).setDensity(MASS/volume).setFriction(.4).setRestitution(.05),this.body);
  this.vehicle=world.createVehicleController(this.body);
  (this.vehicle as unknown as {setIndexForwardAxis:number}).setIndexForwardAxis=2;
  const rest=.32;
  spec.wheels.forEach((w,i)=>{
   this.vehicle.addWheel({x:w.x,y:w.y+rest,z:w.z},{x:0,y:-1,z:0},{x:-1,y:0,z:0},rest,spec.wheelRadius);
   this.vehicle.setWheelSuspensionStiffness(i,60);this.vehicle.setWheelSuspensionCompression(i,4.4);this.vehicle.setWheelSuspensionRelaxation(i,5.2);
   this.vehicle.setWheelMaxSuspensionTravel(i,.3);this.vehicle.setWheelMaxSuspensionForce(i,MASS*60);this.vehicle.setWheelFrictionSlip(i,3.2);
  });
 }
 get mass(){return this.body.mass();}
 get position(){return this.body.translation();}
 get rotation(){return this.body.rotation();}
 get velocity(){return this.body.linvel();}
 get speed(){const v=this.body.linvel();return Math.hypot(v.x,v.y,v.z);}
 get forward(){return rotate(this.body.rotation(),{x:0,y:0,z:1});}
 get up(){return rotate(this.body.rotation(),{x:0,y:1,z:0});}
 /** Yaw of the car's nose in the scene's heading convention (forward = sin h, cos h). */
 get heading(){const f=this.forward;return Math.atan2(f.x,f.z);}
 get grounded(){return this.contacts>=2;}
 get flipping(){return this.flip>0;}
 setGhost(on:boolean){if(on===this.ghost)return;this.ghost=on;this.collider.setCollisionGroups(on?groups(0xFFFF,GROUND_GROUP):groups(0xFFFF,0xFFFF));}
 reset(x:number,y:number,z:number,heading:number){
  this.body.setTranslation({x,y,z},true);this.body.setRotation(yawQuat(heading),true);
  this.body.setLinvel({x:0,y:0,z:0},true);this.body.setAngvel({x:0,y:0,z:0},true);
  this.flip=0;this.secondJump=false;this.airTime=0;this.upsideDown=0;
 }
 /** Call once per fixed physics step, before world.step(). */
 step(dt:number,input:CarInput,t:CarTuning){
  // Rapier keeps added forces until they are reset; every force below is for this step only.
  this.body.resetForces(true);
  this.setGhost(t.ghost);this.body.setGravityScale(t.gravityScale,true);
  const m=this.body.mass(),q=this.body.rotation(),forward=rotate(q,{x:0,y:0,z:1}),up=rotate(q,{x:0,y:1,z:0}),v=this.body.linvel();
  const along=dot(v,forward),speed=Math.hypot(v.x,v.y,v.z);
  // Steering tightens with speed so a 100 km/h car does not snap sideways.
  const steerAngle=-input.steer*(.58-.44*Math.min(1,Math.abs(along)/40));
  const reversing=input.throttle<0&&along<1.5,capped=reversing?along<-12:along>t.maxSpeed;
  const opposing=input.throttle!==0&&Math.sign(input.throttle)!==Math.sign(along)&&Math.abs(along)>1;
  const engine=opposing||capped?0:input.throttle*m*(reversing?7:13)/4;
  const brake=opposing?m*.09:input.throttle===0?m*.006:0;
  for(let i=0;i<this.vehicle.numWheels();i++){
   const front=this.spec.wheels[i].front;
   this.vehicle.setWheelSteering(i,front?steerAngle:0);
   this.vehicle.setWheelEngineForce(i,engine);
   this.vehicle.setWheelBrake(i,brake);
   // Powerslide: the rear lets go sideways, the front keeps steering.
   this.vehicle.setWheelSideFrictionStiffness(i,input.drift&&!front?.22:1);
  }
  const filter=this.ghost?groups(0xFFFF,GROUND_GROUP):undefined;
  this.vehicle.updateVehicle(dt,undefined,filter,c=>c.handle!==this.collider.handle);
  let contacts=0;for(let i=0;i<this.vehicle.numWheels();i++)if(this.vehicle.wheelIsInContact(i))contacts++;
  this.contacts=contacts;this.airTime=contacts?0:this.airTime+dt;
  const grounded=contacts>=2;
  // Sticky tyres: a little extra push into whatever the wheels are on.
  if(grounded)this.body.addForce(scale(up,-m*4.5),true);
  // Jumps: one from the ground; a second in the air is a double jump, or a dodge if steering.
  const pressed=input.jump&&!this.previousJump;this.previousJump=input.jump;this.sinceJump+=dt;
  if(grounded&&this.sinceJump>.25){this.secondJump=true;this.flip=0;}
  if(pressed&&grounded&&this.sinceJump>.25){this.body.applyImpulse(scale(up,m*t.jump),true);this.sinceJump=0;this.holdJump=.18;}
  else if(pressed&&!grounded&&this.secondJump&&this.sinceJump<1.6){
   this.secondJump=false;this.sinceJump=0;
   const dodge=Math.hypot(input.throttle,input.steer)>.35;
   if(dodge){
    const flat={x:forward.x,y:0,z:forward.z},n=Math.hypot(flat.x,flat.z)||1,f={x:flat.x/n,y:0,z:flat.z/n},left={x:f.z,y:0,z:-f.x};
    const dir={x:f.x*input.throttle-left.x*input.steer,y:0,z:f.z*input.throttle-left.z*input.steer},len=Math.hypot(dir.x,dir.z)||1;
    this.body.applyImpulse(scale({x:dir.x/len,y:.12,z:dir.z/len},m*Math.max(6,t.jump*.75)),true);
    // Front flip pitches about the car's +X; a side dodge rolls about +Z.
    const spin=rotate(q,{x:input.throttle*11,y:0,z:input.steer*11});this.body.setAngvel(spin,true);this.flip=.62;
   }else this.body.applyImpulse(scale(up,m*t.jump*.85),true);
  }
  if(this.holdJump>0){this.holdJump-=dt;if(input.jump)this.body.addForce(scale(up,m*9),true);}
  if(this.flip>0)this.flip-=dt;
  // Air control: steer the car's spin with the same keys, like a drone.
  else if(!contacts){
   const target=rotate(q,{x:input.throttle*4.6,y:-input.steer*4.6,z:input.roll*5.2}),w=this.body.angvel();
   const k=1-Math.exp(-(input.throttle||input.steer||input.roll?7:1.8)*dt);
   this.body.setAngvel({x:w.x+(target.x-w.x)*k,y:w.y+(target.y-w.y)*k,z:w.z+(target.z-w.z)*k},true);
  }
  // Boost pushes along the nose on the ground and in the air.
  if(input.boost&&(t.infiniteBoost||this.boost>0)&&along<t.boostSpeed){
   this.body.addForce(scale(forward,m*t.boostAccel),true);
   if(!t.infiniteBoost)this.boost=Math.max(0,this.boost-t.boostUse*dt);
  }
  if(speed>t.boostSpeed*1.04){const k=t.boostSpeed*1.04/speed;this.body.setLinvel(scale(v,k),true);}
  // Left on its roof, the car rights itself after a moment.
  if(up.y<.25&&speed<2&&!contacts)this.upsideDown+=dt;else this.upsideDown=0;
  if(this.upsideDown>1.1){const p=this.body.translation();this.reset(p.x,p.y+1.2,p.z,this.heading);}
 }
 addBoost(amount:number){this.boost=Math.min(100,this.boost+amount);}
 dispose(){this.world.removeVehicleController(this.vehicle);this.world.removeRigidBody(this.body);}
}
