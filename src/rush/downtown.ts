import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import roofs from '../data/distant-city.json';
// City roof outlines from the neighbourhood backdrop that lie west of the authored map (pre-extracted).
import edge from './data/downtown-edge.json';
import roads from './data/downtown-roads.json';
import {CN_TOWER} from '../toronto-skyline';
import {project} from '../geography';
import {groundHeight,TERRAIN} from '../terrain';
import type {Point} from '../game';
import type {LevelOfDetail} from '../render-quality';

// Downtown for Rush: the drive west from River Street to the CN Tower. The
// game already ships the City's roof outlines for this area as a hazy, unlit
// backdrop; here the same footprints become lit, collidable buildings, on a
// street grid from OpenStreetMap (ODbL). Built only when Rush is switched on.

export const DOWNTOWN={left:-4110,right:-930,top:-1130,bottom:1450};
export const CN_TOWER_POINT=project(CN_TOWER.longitude,CN_TOWER.latitude);
export type Footprint={p:Point[];holes:Point[][];h:number};
export type DowntownRoad={n:string;k:string;w:number;p:Point[]};
export const DOWNTOWN_ROADS=roads as unknown as DowntownRoad[];
/** Every footprint that becomes solid: the downtown roofs plus backdrop roofs west of the authored map. */
export const DOWNTOWN_BUILDINGS:Footprint[]=[
 ...(roofs as unknown as Footprint[]),
 ...(edge as unknown as Footprint[]),
];
/** You are "downtown" west of this line; east of it, the original neighbourhood and its backdrop show. */
const ENTER=-960,LEAVE=-940;
/** The authored terrain ends here; downtown's flat ground starts exactly at its edge. */
const EDGE=TERRAIN.left;
const TILE=250;

function windowTexture(){
 const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d')!;
 g.fillStyle='#e9e4da';g.fillRect(0,0,128,128);
 // One bay: a dark pane in a pale frame, with a spandrel band. Repeats every 4 m by 3.6 m.
 g.fillStyle='#3e4b52';g.fillRect(14,18,100,78);g.fillStyle='#5f7480';g.fillRect(14,18,100,22);
 g.fillStyle='#cfc8bb';g.fillRect(0,104,128,24);
 const t=new T.CanvasTexture(c);t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(1/4,1/3.6);t.colorSpace=T.SRGBColorSpace;t.anisotropy=4;return t;
}
/** An extrusion's caps (group 0) and sides (group 1) as two separate geometries. */
function splitExtrusion(geo:T.BufferGeometry):[T.BufferGeometry,T.BufferGeometry]{
 const part=(group:{start:number;count:number})=>{const out=new T.BufferGeometry();for(const [name,a] of Object.entries(geo.attributes)){const attr=a as T.BufferAttribute;out.setAttribute(name,new T.BufferAttribute((attr.array as Float32Array).slice(group.start*attr.itemSize,(group.start+group.count)*attr.itemSize),attr.itemSize));}return out;};
 const caps=geo.groups.filter(g=>g.materialIndex===0),sides=geo.groups.filter(g=>g.materialIndex===1),join=(gs:typeof caps)=>mergeGeometries(gs.map(part),false)!;
 return [join(caps),join(sides)];
}
const PALETTE=[0xb9b2a6,0xa9b6bd,0xc9b9a0,0xb38a74,0x9fb0b8,0xd5cbb8,0x8e9aa0];

/**
 * Walls only, like the rest of the city: one trimesh for every downtown building, the CN Tower's
 * base, and a flat street-level ground. Walls give up the ground bit so phase mode passes them.
 */
export function addDowntownColliders(world:RAPIER.World):RAPIER.Collider[]{
 const colliders:RAPIER.Collider[]=[];
  const v:number[]=[],idx:number[]=[];
  for(const b of DOWNTOWN_BUILDINGS)for(const ring of [b.p,...b.holes])for(let i=0;i<ring.length;i++){
   const a=ring[i],c=ring[(i+1)%ring.length],n=v.length/3;v.push(a[0],-.5,a[1],a[0],b.h,a[1],c[0],b.h,c[1],c[0],-.5,c[1]);idx.push(n,n+1,n+2,n,n+2,n+3);
  }
  const walls=0xFFFE<<16|0xFFFF;
  colliders.push(world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(v),new Uint32Array(idx)).setFriction(.6).setCollisionGroups(walls)));
  colliders.push(world.createCollider(RAPIER.ColliderDesc.cylinder(300,16).setTranslation(CN_TOWER_POINT[0],300,CN_TOWER_POINT[1]).setCollisionGroups(walls)));
  const hx=(EDGE-DOWNTOWN.left)/2,hz=(DOWNTOWN.bottom-DOWNTOWN.top)/2;
  colliders.push(world.createCollider(RAPIER.ColliderDesc.cuboid(hx,.5,hz).setTranslation(DOWNTOWN.left+hx,-.53,DOWNTOWN.top+hz).setFriction(.85)));
  return colliders;
}

export class Downtown{
 readonly group=new T.Group();
 private tiles:{mesh:T.Object3D;box:T.Box3}[]=[];
 private ground:T.Mesh;private colliders:RAPIER.Collider[]=[];private inside=false;private probe=new T.Vector3();
 private backdrop?:T.Object3D;
 constructor(scene:T.Scene,private world:RAPIER.World){
  this.group.name='Rush downtown';this.group.visible=false;scene.add(this.group);
  this.backdrop=scene.getObjectByName('City roof outlines · distant western background');
  const w=EDGE-DOWNTOWN.left,d=DOWNTOWN.bottom-DOWNTOWN.top;
  this.ground=new T.Mesh(new T.PlaneGeometry(w,d),new T.MeshStandardMaterial({color:0x9d988e,roughness:1}));
  this.ground.rotation.x=-Math.PI/2;this.ground.position.set((DOWNTOWN.left+EDGE)/2,-.02,(DOWNTOWN.top+DOWNTOWN.bottom)/2);this.ground.receiveShadow=true;this.group.add(this.ground);
  this.buildTiles();this.colliders=addDowntownColliders(world);
 }
 private buildTiles(){
  const walls=new T.MeshStandardMaterial({map:windowTexture(),vertexColors:true,roughness:.7,metalness:.08});
  const roof=new T.MeshStandardMaterial({vertexColors:true,roughness:.95});
  const asphalt=new T.MeshStandardMaterial({color:0x4e5355,roughness:.92});
  const buckets=new Map<string,{roofs:T.BufferGeometry[];walls:T.BufferGeometry[];roads:T.BufferGeometry[];x:number;z:number}>();
  const bucket=(x:number,z:number)=>{const key=`${Math.floor(x/TILE)}:${Math.floor(z/TILE)}`;let b=buckets.get(key);if(!b){b={roofs:[],walls:[],roads:[],x:Math.floor(x/TILE)*TILE+TILE/2,z:Math.floor(z/TILE)*TILE+TILE/2};buckets.set(key,b);}return b;};
  (roofs as unknown as Footprint[]).forEach((r,i)=>{
   const shape=new T.Shape(r.p.map(p=>new T.Vector2(p[0],-p[1])));for(const hole of r.holes)shape.holes.push(new T.Path(hole.map(p=>new T.Vector2(p[0],-p[1]))));
   const geo=new T.ExtrudeGeometry(shape,{depth:r.h,bevelEnabled:false,curveSegments:1});geo.rotateX(-Math.PI/2);
   const colour=new T.Color(PALETTE[i%PALETTE.length]).multiplyScalar(r.h>60?.92:1),count=geo.getAttribute('position').count,colours=new Float32Array(count*3);
   for(let k=0;k<count;k++)colours.set([colour.r,colour.g,colour.b],k*3);geo.setAttribute('color',new T.BufferAttribute(colours,3));
   const c=r.p.reduce((s,p)=>[s[0]+p[0]/r.p.length,s[1]+p[1]/r.p.length],[0,0]),[top,sides]=splitExtrusion(geo);geo.dispose();const b=bucket(c[0],c[1]);b.roofs.push(top);b.walls.push(sides);
  });
  for(const road of DOWNTOWN_ROADS){
   for(let i=1;i<road.p.length;i++){
    const a=road.p[i-1],b=road.p[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<.01)continue;
    const seg=new T.PlaneGeometry(len+road.w*.5,road.w);seg.rotateX(-Math.PI/2);seg.rotateY(-Math.atan2(b[1]-a[1],b[0]-a[0]));seg.translate((a[0]+b[0])/2,.02+(road.w%3)*.002,(a[1]+b[1])/2);
    // Near the old map's edge the authored terrain still has relief; follow it.
    const pos=seg.getAttribute('position');for(let k=0;k<pos.count;k++)pos.setY(k,pos.getY(k)+groundHeight(pos.getX(k),pos.getZ(k)));
    bucket((a[0]+b[0])/2,(a[1]+b[1])/2).roads.push(seg);
   }
  }
  for(const b of buckets.values()){
   const tile=new T.Group();tile.userData.center=[b.x,b.z];
   for(const [parts,mat] of [[b.roofs,roof],[b.walls,walls]] as const)if(parts.length){const g=mergeGeometries(parts,false);if(g){const m=new T.Mesh(g,mat);m.castShadow=m.receiveShadow=true;tile.add(m);}parts.forEach(x=>x.dispose());}
   if(b.roads.length){const g=mergeGeometries(b.roads,false);if(g){const m=new T.Mesh(g,asphalt);m.receiveShadow=true;tile.add(m);}b.roads.forEach(x=>x.dispose());}
   this.group.add(tile);this.tiles.push({mesh:tile,box:new T.Box3().setFromObject(tile)});
  }
 }
 /** Swap the hazy backdrop for the lit district as you cross into downtown, and cull tiles past the fog. */
 update(focus:{x:number;z:number},lod:LevelOfDetail){
  this.inside=this.inside?focus.x<LEAVE:focus.x<ENTER;
  this.group.visible=this.inside;if(this.backdrop)this.backdrop.visible=!this.inside;
  if(!this.inside)return;
  for(const t of this.tiles){this.probe.set(focus.x,t.box.min.y,focus.z);t.mesh.visible=t.box.distanceToPoint(this.probe)<lod.fog;}
 }
 get active(){return this.inside;}
 dispose(){
  for(const c of this.colliders)this.world.removeCollider(c,false);this.colliders=[];
  if(this.backdrop)this.backdrop.visible=true;
  this.group.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();for(const m of [o.material].flat())(m as T.Material).dispose();}});this.group.removeFromParent();
 }
}
