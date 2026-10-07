import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import type {CarSpec,WheelMount} from './race-car';
import {CAR_MODELS,type CarModelId} from './settings';

/** Bumper to bumper, metres. Both source models are rescaled to the same real-world size. */
const CAR_LENGTH=4.4;

export type CarModel={
 /** Place this at the physics body's transform; its origin is the hub-height centre of the wheelbase. */
 root:T.Group;
 spec:CarSpec;
 /** One pivot per entry in spec.wheels: rotate .x to spin, .y to steer; .position.y follows the suspension. */
 wheels:T.Object3D[];
 hubY:number[];
};

type Corner='FL'|'FR'|'RL'|'RR';
const CORNER=/(?:^|[_\-.])(FL|FR|RL|RR|LF|RF|LR)(?=[_\-.]|$)/;
const cornerOf=(name:string):Corner|undefined=>{const m=name.match(CORNER)?.[1];if(!m)return;return ({LF:'FL',RF:'FR',LR:'RL'} as Record<string,Corner>)[m]??m as Corner;};
const isWheelPart=(name:string)=>/wheel|tire|tyre|rim|hub|brake|caliper/i.test(name)&&!/steer/i.test(name);

/** Which corner a mesh belongs to, from its own name or any ancestor's (Sketchfab nests meshes under named nodes). */
function meshCorner(o:T.Object3D,root:T.Object3D):Corner|undefined{
 for(let p:T.Object3D|null=o;p&&p!==root;p=p.parent)if(isWheelPart(p.name)){const c=cornerOf(p.name);if(c)return c;}
}

export async function loadCarModel(id:CarModelId,base=import.meta.env?.BASE_URL??'./'):Promise<CarModel>{
 const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
 const gltf=await loader.loadAsync(base+CAR_MODELS[id].url);
 return fitCarModel(gltf.scene);
}

/** Normalise any car scene: nose to +Z, real size, wheels on pivots, physics spec from the geometry. */
export function fitCarModel(scene:T.Object3D):CarModel{
 const holder=new T.Group();holder.add(scene);holder.updateMatrixWorld(true);
 const size=new T.Box3().setFromObject(scene).getSize(new T.Vector3());
 // Sketchfab exports vary in units; scale the long axis to a real car.
 const longX=size.x>size.z;if(longX)holder.rotation.y=Math.PI/2;
 holder.scale.setScalar(CAR_LENGTH/Math.max(size.x,size.z));holder.updateMatrixWorld(true);
 const corners=new Map<Corner,T.Mesh[]>();
 scene.traverse(o=>{if(!(o instanceof T.Mesh))return;o.castShadow=true;o.receiveShadow=true;const c=meshCorner(o,scene);if(c){const list=corners.get(c)||[];list.push(o);corners.set(c,list);}});
 if(corners.size!==4)throw new Error(`Car model needs four named wheels; found ${[...corners.keys()].join(', ')||'none'}`);
 const centre=(meshes:T.Mesh[])=>{const box=new T.Box3();for(const m of meshes)box.expandByObject(m);return box;};
 // Turn the car so its front wheels are at +Z.
 const frontZ=(centre(corners.get('FL')!).getCenter(new T.Vector3()).z+centre(corners.get('FR')!).getCenter(new T.Vector3()).z)/2;
 const rearZ=(centre(corners.get('RL')!).getCenter(new T.Vector3()).z+centre(corners.get('RR')!).getCenter(new T.Vector3()).z)/2;
 if(frontZ<rearZ){holder.rotation.y+=Math.PI;holder.updateMatrixWorld(true);}
 const boxes=new Map([...corners].map(([c,m])=>[c,centre(m)] as const));
 const hubs=[...boxes.values()].map(b=>b.getCenter(new T.Vector3()));
 const origin=hubs.reduce((s,h)=>s.add(h),new T.Vector3()).multiplyScalar(1/hubs.length);
 const radius=[...boxes.values()].reduce((s,b)=>s+(b.max.y-b.min.y)/2,0)/boxes.size;
 // Re-centre on the wheelbase at hub height: the physics body's origin.
 const root=new T.Group();root.name='Rush race car';root.add(holder);holder.position.sub(origin);root.updateMatrixWorld(true);
 const order:Corner[]=['FL','FR','RL','RR'],wheels:T.Object3D[]=[],mounts:WheelMount[]=[],hubY:number[]=[];
 for(const c of order){
  const box=boxes.get(c)!.clone().translate(origin.clone().negate()),pivot=new T.Group();pivot.name=`wheel ${c}`;
  box.getCenter(pivot.position);root.add(pivot);pivot.rotation.order='YXZ';root.updateMatrixWorld(true);
  for(const m of corners.get(c)!)pivot.attach(m);
  wheels.push(pivot);hubY.push(pivot.position.y);mounts.push({x:pivot.position.x,y:pivot.position.y,z:pivot.position.z,front:c[0]==='F'});
 }
 const body=new T.Box3().setFromObject(root),dims=body.getSize(new T.Vector3());
 return {root,wheels,hubY,spec:{width:dims.x,height:dims.y,length:dims.z,wheelRadius:radius,wheels:mounts}};
}
