import {groundHeight,TERRAIN} from './terrain';
import RAPIER from '@dimforge/rapier3d-compat';
import type {Obstacle} from './motion';
import {BOUNDS} from './motion';
import type {Point} from './game';
export const initPhysics=()=>RAPIER.init();
// SI units. Static architectural wall meshes + kinematic rounded courier and trailer.
// No invisible AABB volumes across concave building yards or curved streets.
export class StreetPhysics {
 readonly world=new RAPIER.World({x:0,y:-9.81,z:0});
 /** The contoured street surface: the one collider a ghost-mode race car still drives on. */
 readonly ground:RAPIER.Collider;
 private robot:RAPIER.RigidBody;private collider:RAPIER.Collider;private controller:RAPIER.KinematicCharacterController;
 private cart:RAPIER.RigidBody;private cartCollider:RAPIER.Collider;
 private tram:RAPIER.RigidBody;private conditions:RAPIER.Collider[][]=[];private contactCount=0;
 private ambient:RAPIER.RigidBody[]=[];
 constructor(staticBounds:Obstacle[],works:Obstacle[],snow:Obstacle[],ambient:Obstacle[]=[]){
  this.world.timestep=1/90;
  const terrainVertices:number[]=[],terrainIndices:number[]=[];
  for(let row=0;row<TERRAIN.rows;row++)for(let col=0;col<TERRAIN.cols;col++){const x=TERRAIN.left+col*TERRAIN.step,z=TERRAIN.top+row*TERRAIN.step;terrainVertices.push(x,groundHeight(x,z)-.03,z);if(row<TERRAIN.rows-1&&col<TERRAIN.cols-1){const a=row*TERRAIN.cols+col;terrainIndices.push(a,a+TERRAIN.cols,a+1,a+1,a+TERRAIN.cols,a+TERRAIN.cols+1);}}
  this.ground=this.world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(terrainVertices),new Uint32Array(terrainIndices)).setFriction(.85));
  const create=(o:Obstacle)=>{let desc:RAPIER.ColliderDesc;if(o.p){const vertices:number[]=[],indices:number[]=[];for(const ring of [o.p,...o.holes||[]])for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],n=vertices.length/3;vertices.push(a[0],groundHeight(...a)-.2,a[1],a[0],groundHeight(...a)+o.h,a[1],b[0],groundHeight(...b)+o.h,b[1],b[0],groundHeight(...b)-.2,b[1]);indices.push(n,n+1,n+2,n,n+2,n+3);}desc=RAPIER.ColliderDesc.trimesh(new Float32Array(vertices),new Uint32Array(indices));}else desc=RAPIER.ColliderDesc.cuboid(o.w/2,o.h/2,o.d/2).setTranslation(o.x,groundHeight(o.x,o.z)+o.h/2,o.z);return this.world.createCollider(desc.setFriction(.8));};
  staticBounds.forEach(create);this.conditions=[works.map(create),snow.map(create)];
  this.robot=this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0,.31,0));this.collider=this.world.createCollider(RAPIER.ColliderDesc.cylinder(.25,.225).setFriction(.85),this.robot);
  this.cart=this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(-1,.25,0));this.cartCollider=this.world.createCollider(RAPIER.ColliderDesc.cuboid(.45,.2,.31).setFriction(.9),this.cart);
  this.tram=this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(-600,1.9,1.55));this.world.createCollider(RAPIER.ColliderDesc.cuboid(15.1,1.9,1.27),this.tram);
  for(const o of ambient){const body=this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(o.x,groundHeight(o.x,o.z)+o.h/2,o.z));this.world.createCollider(RAPIER.ColliderDesc.cuboid(o.w/2,o.h/2,o.d/2),body);this.ambient.push(body);}
  this.controller=this.world.createCharacterController(.008);this.controller.enableAutostep(.16,.12,false);this.controller.enableSnapToGround(.2);this.controller.setMaxSlopeClimbAngle(.38);this.controller.setMinSlopeSlideAngle(.48);
 }
 setDay(day:number){this.conditions[0].forEach(c=>c.setEnabled(day<2));this.conditions[1].forEach(c=>c.setEnabled(day===2));this.cartCollider.setEnabled(day>0);}
 reset(p:Point,c:Point){this.robot.setTranslation({x:p[0],y:.31+groundHeight(...p),z:p[1]},true);this.cart.setTranslation({x:c[0],y:.25+groundHeight(...c),z:c[1]},true);this.world.step();}
 move(p:Point,delta:Point){this.robot.setTranslation({x:p[0],y:.31+groundHeight(...p),z:p[1]},true);this.controller.computeColliderMovement(this.collider,{x:delta[0],y:groundHeight(p[0]+delta[0],p[1]+delta[1])-groundHeight(...p),z:delta[1]},undefined,undefined,c=>c.handle!==this.cartCollider.handle);const m=this.controller.computedMovement();this.contactCount=this.controller.numComputedCollisions();const out:Point=[Math.max(BOUNDS.left+.23,Math.min(BOUNDS.right-.23,p[0]+m.x)),Math.max(BOUNDS.top+.23,Math.min(BOUNDS.bottom-.23,p[1]+m.z))];this.robot.setNextKinematicTranslation({x:out[0],y:.31+groundHeight(...out),z:out[1]});return out;}
 sync(p:Point,c:Point,heading:number,tram:Point,ambient:Obstacle[]=[]){this.robot.setNextKinematicTranslation({x:p[0],y:.31+groundHeight(...p),z:p[1]});this.cart.setNextKinematicTranslation({x:c[0],y:.25+groundHeight(...c),z:c[1]});this.cart.setNextKinematicRotation({x:0,y:Math.sin(heading/2),z:0,w:Math.cos(heading/2)});this.tram.setNextKinematicTranslation({x:tram[0],y:1.9+groundHeight(...tram),z:tram[1]});ambient.forEach((o,i)=>this.ambient[i]?.setNextKinematicTranslation({x:o.x,y:o.h/2+groundHeight(o.x,o.z),z:o.z}));this.world.step();}
 diagnostics(){return {engine:'Rapier 3D',timestep:1/90,bodies:this.world.bodies.len(),colliders:this.world.colliders.len(),contacts:this.contactCount,courierWidth:.45,cartWidth:.9,gravity:9.81,mode:'kinematic wheel courier on contour terrain; swept collision queries; geometric tow constraint'};}
 dispose(){this.world.free();}
}
