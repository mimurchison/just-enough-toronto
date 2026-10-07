import type {Object3D} from 'three';
import {GEO,inside,segmentDistance} from './geography';
import {STREET} from './street-data';
import type {Point} from './game';

// Structural parts share one foundation datum. Draping every cornice/window
// vertex over the contour field bends masonry and twists rectangular openings.
const buildings=[
 ...STREET.units.map(b=>({p:b.p,anchor:b.front})),
 ...GEO.buildings.map(b=>({p:b.p,anchor:[(b.bounds[0]+b.bounds[2])/2,Math.abs(b.bounds[1])<Math.abs(b.bounds[3])?b.bounds[1]:b.bounds[3]] as Point})),
];
// Only a building within 5 m can anchor a point, so index footprints (grown by 5 m)
// on a coarse grid and test just those, in their original order: same answer,
// without measuring every point against all ~1,400 footprints.
const REACH=5,CELL=25,grid=new Map<string,number[]>();
buildings.forEach((b,i)=>{
 const xs=b.p.map(p=>p[0]),zs=b.p.map(p=>p[1]);
 for(let cx=Math.floor((Math.min(...xs)-REACH)/CELL);cx<=Math.floor((Math.max(...xs)+REACH)/CELL);cx++)
  for(let cz=Math.floor((Math.min(...zs)-REACH)/CELL);cz<=Math.floor((Math.max(...zs)+REACH)/CELL);cz++){const k=`${cx}:${cz}`,list=grid.get(k);if(list)list.push(i);else grid.set(k,[i]);}
});
export function buildingGroundAnchor(x:number,z:number):Point{
 const point:Point=[x,z];let best=Infinity,anchor=point;
 for(const i of grid.get(`${Math.floor(x/CELL)}:${Math.floor(z/CELL)}`)??[]){const b=buildings[i];
  const distance=inside(point,b.p)?0:Math.min(...b.p.map((a,i)=>segmentDistance(point,a,b.p[(i+1)%b.p.length])));
  if(distance<best){best=distance;anchor=b.anchor;if(distance<.001)break;}
 }
 return best<REACH?anchor:point;
}
export function rigidBuilding<T extends Object3D>(object:T,x:number,z:number,anchor=buildingGroundAnchor(x,z)):T{
 object.userData.terrainRigid=true;object.userData.terrainAnchor=anchor;return object;
}
