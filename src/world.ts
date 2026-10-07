import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Obstacle } from './motion';
import { worldPoint } from './motion';
import { factsForDay } from './game';
import type { LevelOfDetail } from './render-quality';

export const PALETTE={cream:0xffe7b8,coral:0xd94b3f,ink:0x223e42,teal:0x2d817d,gold:0xefb74d,pink:0xd78782,brick:0xb85d49,wood:0x915b3f,grass:0x84a376,snow:0xedf5f0};
const materialCache=new Map<string,THREE.MeshStandardMaterial>();
export function material(color:number,roughness=.8){const key=`${color}-${roughness}`;if(!materialCache.has(key))materialCache.set(key,new THREE.MeshStandardMaterial({color,roughness}));return materialCache.get(key)!;}
const cube=new THREE.BoxGeometry(1,1,1),sphere=new THREE.SphereGeometry(1,16,12);
const rounded=new Map<string,THREE.BufferGeometry>();
export function box(parent:THREE.Object3D,x:number,y:number,z:number,w:number,h:number,d:number,color:number,bevel=0){
  const key=`${w}-${h}-${d}-${bevel}`;if(bevel&&!rounded.has(key))rounded.set(key,new RoundedBoxGeometry(w,h,d,2,Math.min(bevel,w/2,h/2,d/2)));
  const mesh=new THREE.Mesh(bevel?rounded.get(key)!:cube,material(color));mesh.position.set(x,y,z);if(!bevel)mesh.scale.set(w,h,d);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
export function orb(parent:THREE.Object3D,x:number,y:number,z:number,rx:number,ry:number,rz:number,color:number){const mesh=new THREE.Mesh(sphere,material(color));mesh.position.set(x,y,z);mesh.scale.set(rx,ry,rz);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
// Broad ground slabs need interior vertices when draped over contour grade.
// Keep their original box scale and material, with a maximum 3 m grid.
export function groundBox(parent:THREE.Object3D,x:number,y:number,z:number,w:number,h:number,d:number,color:number){const mesh=box(parent,x,y,z,w,h,d,color);mesh.geometry=new THREE.BoxGeometry(1,1,1,Math.max(1,Math.ceil(w/3)),1,Math.max(1,Math.ceil(d/3)));return mesh;}
export function rod(parent:THREE.Object3D,a:THREE.Vector3,b:THREE.Vector3,r:number,color:number){const direction=b.clone().sub(a);const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,direction.length(),8),material(color));mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());mesh.castShadow=true;parent.add(mesh);return mesh;}
function texture(draw:(ctx:CanvasRenderingContext2D,w:number,h:number)=>void,w=1024,h=512){const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;draw(canvas.getContext('2d')!,w,h);const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;return map;}
// Shared pages keep dozens of street blades and fascias from allocating one
// texture apiece. Two-pixel gutters prevent adjacent signs bleeding in mipmaps.
type SignPage={canvas:HTMLCanvasElement;map:THREE.CanvasTexture;material:THREE.MeshBasicMaterial;used:number};
const signPages:SignPage[]=[];
function signPage(){
 let p=signPages.at(-1);if(!p||p.used===64){const canvas=document.createElement('canvas');canvas.width=canvas.height=2048;const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=8;p={canvas,map,material:new THREE.MeshBasicMaterial({map,side:THREE.FrontSide,toneMapped:true}),used:0};signPages.push(p);}return p;
}
export function sign(parent:THREE.Object3D,words:string,sub:string,x:number,y:number,z:number,w:number,h:number,bg:string,fg='#ffebc1',font='Georgia',naturalAspect=false){
 const page=signPage(),id=page.used++,left=id%4*512,top=Math.floor(id/4)*128,cw=508,ch=124,c=page.canvas.getContext('2d')!;
 c.save();c.translate(left+2,top+2);c.beginPath();c.rect(-2,-2,512,128);c.clip();c.fillStyle=bg;c.fillRect(-2,-2,512,128);c.strokeStyle=fg;c.globalAlpha=.45;c.lineWidth=1;c.strokeRect(8,5,cw-16,ch-10);c.globalAlpha=1;c.fillStyle=fg;c.textAlign='center';c.textBaseline='middle';c.font=`bold ${(sub?120:145)/384*ch}px ${font}`;if(naturalAspect){const sx=cw/ch/(w/h);c.save();c.translate(cw/2,0);c.scale(sx,1);c.font=`600 ${ch*.63}px ${font}`;c.fillText(words,0,sub?ch*.4:ch*.51,(cw-38)/sx);c.restore();}else c.fillText(words,cw/2,sub?ch*.4:ch*.51,cw-38);if(sub){c.font=`${27/384*ch}px sans-serif`;c.fillText(sub,cw/2,ch*.76,cw-50);}c.restore();page.map.needsUpdate=true;
 const geometry=new THREE.PlaneGeometry(w,h),uv=geometry.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setXY(i,(left+2+uv.getX(i)*cw)/2048,1-(top+2+(1-uv.getY(i))*ch)/2048);
 const mesh=new THREE.Mesh(geometry,page.material);mesh.userData.terrainRigid=true;mesh.position.set(x,y,z);const reverse=new THREE.Mesh(geometry,page.material);reverse.rotation.y=Math.PI;reverse.position.z=-.008;mesh.add(reverse);parent.add(mesh);return mesh;
}
const vertexMaterials=new Map<string,THREE.MeshStandardMaterial|THREE.MeshBasicMaterial>();
const mergeable=(o:THREE.Object3D):o is THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial|THREE.MeshBasicMaterial>=>!(o instanceof THREE.InstancedMesh)&&o instanceof THREE.Mesh&&!Array.isArray(o.material)&&(o.material instanceof THREE.MeshStandardMaterial||o.material instanceof THREE.MeshBasicMaterial);
/** Batch key for a mesh, fixed the first time it is asked for. */
const mergeKeys=new WeakMap<THREE.Object3D,string>();
function mergeKey(o:THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial|THREE.MeshBasicMaterial>):string{
  const known=mergeKeys.get(o);if(known)return known;
  const source=o.material,pbr=source instanceof THREE.MeshStandardMaterial?source:null;
  const key=[source.type,pbr?.roughness,pbr?.metalness,source.map?.uuid||'plain',pbr?.normalMap?.uuid||'',pbr?.normalScale.toArray().join(','),pbr?.bumpMap?.uuid||'',pbr?.bumpScale,pbr?.roughnessMap?.uuid||'',source.alphaMap?.uuid||'',source.alphaTest,source.transparent,source.opacity,source.depthWrite,source.depthTest,source.blending,source.toneMapped,source.fog,pbr?.emissive.getHex(),pbr?.emissiveIntensity,source.side,o.castShadow,o.receiveShadow].join('/');;
  if(!vertexMaterials.has(key)){const mat=source.clone();mat.color.setHex(0xffffff);mat.vertexColors=true;vertexMaterials.set(key,mat);}
  mergeKeys.set(o,key);return key;
}
/**
 * Fix every batch's material now, from the materials as authored. Use before
 * merging a group later (streamed tiles): scene-wide material passes may have
 * touched the source materials by then, and batches must not see that.
 */
export function prepareMerge(group:THREE.Object3D){group.traverse(o=>{if(mergeable(o))mergeKey(o);});}
export function mergeStatic(group:THREE.Group){
  group.updateMatrixWorld(true);const inverse=new THREE.Matrix4().copy(group.matrixWorld).invert();const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();const shadows=new Map<THREE.Material,{cast:boolean;receive:boolean}>();const remove:THREE.Mesh[]=[];
  group.traverse(o=>{
    if(!mergeable(o))return;
    const source=o.material,key=mergeKey(o);
    // Expanding an indexed geometry already copies it; only clone the ones that are not.
    const mat=vertexMaterials.get(key)!,geometry=(o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone()).applyMatrix4(o.matrixWorld).applyMatrix4(inverse);
    // Authored ribbons and custom quads may have no UVs. They still share an
    // untextured material with boxes. Canonical attributes prevent a failed
    // batch from silently discarding every source mesh in that group.
    if(!geometry.getAttribute('normal'))geometry.computeVertexNormals();
    if(!geometry.getAttribute('uv'))geometry.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count*2),2));
    const count=geometry.getAttribute('position').count,colors=new Float32Array(count*3),tint=geometry.getAttribute('color');
    for(let i=0;i<count;i++){colors[i*3]=source.color.r*(tint?.getX(i)??1);colors[i*3+1]=source.color.g*(tint?.getY(i)??1);colors[i*3+2]=source.color.b*(tint?.getZ(i)??1);}
    geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
    const list=batches.get(mat)||[];list.push(geometry);batches.set(mat,list);shadows.set(mat,{cast:o.castShadow,receive:o.receiveShadow});remove.push(o);
  });
  remove.forEach(m=>m.removeFromParent());
  for(const [mat,geometries] of batches){const geometry=mergeGeometries(geometries,false);if(geometry){const mesh=new THREE.Mesh(geometry,mat);mesh.castShadow=shadows.get(mat)!.cast;mesh.receiveShadow=shadows.get(mat)!.receive;group.add(mesh);}geometries.forEach(g=>g.dispose());}
}
const brickMap=()=>texture((c,w,h)=>{
  c.fillStyle='#877e70';c.fillRect(0,0,w,h);let seed=129;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let row=0;row<32;row++)for(let col=-1;col<17;col++){const x=col*64+(row%2)*32,y=row*16,l=43+rand()*15;c.fillStyle=`hsl(${17+rand()*8},${19+rand()*9}%,${l}%)`;c.fillRect(x+1,y+1,62,14);c.fillStyle='rgba(224,207,174,.15)';c.fillRect(x+2,y+2,59,1);for(let n=0;n<8;n++){c.fillStyle=rand()>.5?'rgba(38,34,31,.14)':'rgba(229,215,187,.12)';c.fillRect(x+rand()*62,y+rand()*14,2+rand()*8,1);}}
},1024,512);

export type CameraOccluder={object:THREE.Object3D;materials:THREE.Material[];box:THREE.Box3;opacity:number;minimum:number;dynamic:boolean};
export type World={
  /** Finish map tiles near (x, z): all within radius, then nearest-first while under budgetMs. Returns the tiles finished. */
  streamTiles?:(x:number,z:number,options?:{radius?:number;budgetMs?:number})=>THREE.Object3D[];pendingTiles?:()=>number;
  updateTransit?:(time:number,reduced:boolean)=>void;updateVisibility?:(x:number,z:number,lod?:LevelOfDetail)=>void;cameraOccluders:CameraOccluder[];group:THREE.Group;snow:THREE.Group;autumn:THREE.Group;works:THREE.Group;snowbank:THREE.Group;obstacles:Obstacle[];gate:Obstacle[];worksBounds:Obstacle[];snowBounds:Obstacle[];tram:THREE.Group;people:{group:THREE.Group;limbs:THREE.Group[];x:number;z:number;phase:number;greetUntil:number;nextGreeting:number}[];markers:Map<string,THREE.Group>;recipient:THREE.Group;sky:THREE.Mesh;sunUniform:{value:THREE.Color};leaves:THREE.Points;leafPositions:Float32Array;};
export function makeWorld():World{
  const group=new THREE.Group(),snow=new THREE.Group(),works=new THREE.Group(),snowbank=new THREE.Group(),obstacles:Obstacle[]=[],people:World['people']=[],markers=new Map<string,THREE.Group>();
  const cameraOccluders:CameraOccluder[]=[];
  function cameraOccluder(object:THREE.Object3D,minimum=0,dynamic=false){
    const copies=new Map<THREE.Material,THREE.Material>();object.traverse(o=>{if(!(o instanceof THREE.Mesh)||Array.isArray(o.material))return;const original=o.material;if(!copies.has(original)){const copy=original.clone();copy.alphaHash=true;copy.transparent=false;copies.set(original,copy);}o.material=copies.get(original)!;});
    cameraOccluders.push({object,materials:[...copies.values()],box:new THREE.Box3().setFromObject(object),opacity:1,minimum,dynamic});
  }
  const ground=new THREE.Group(),architecture=new THREE.Group(),props=new THREE.Group(),autumn=new THREE.Group();group.add(ground,architecture,props,snow,works,snowbank,autumn);
  const brick=brickMap();brick.wrapS=brick.wrapT=THREE.RepeatWrapping;
  let seed=9721;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  // A continuous neighbourhood with a skyline, rather than a miniature on a plinth.
  box(ground,0,-.24,0,400,.4,350,0xb2b69b);
  const road=box(ground,0,-.005,8.5,300,.14,8.2,0x666c6b);
  const asphalt=texture((c,w,h)=>{c.fillStyle='#747976';c.fillRect(0,0,w,h);for(let i=0;i<21000;i++){const v=70+random()*75;c.fillStyle=`rgba(${v},${v},${v},.32)`;c.fillRect(random()*w,random()*h,1+random()*2,1);}},512,512);asphalt.wrapS=asphalt.wrapT=THREE.RepeatWrapping;asphalt.repeat.set(42,2);road.material=new THREE.MeshStandardMaterial({color:0x8d9089,map:asphalt,bumpMap:asphalt,bumpScale:.013,roughness:.98});
  box(ground,0,.02,.4,300,.2,8.0,0xb4b1a6);box(ground,0,.03,14.4,300,.2,3.6,0xc0bcae);
  for(const x of [-19.2,20.48])box(ground,x,.0,3,4.9,.16,60,0xaaa69c);
  box(ground,0,.01,-17.8,55,.16,5,0xb49c86);box(ground,5,.04,20.68,56,.16,3.8,0xd8bb95);
  box(ground,31,.01,24,29,.18,22,0x8eac77);
  for(let x=-80;x<100;x+=2){box(props,x,.135,4.15,1.95,.17,.35,0xbebcb0);box(props,x,.135,12.75,1.95,.17,.35,0xbebcb0);}
  for(let x=-55;x<60;x+=2.6){box(props,x,.128,.3,.024,.007,7.4,0x959990);box(props,x,.132,2.1,2.55,.008,.016,0x959990);}
  for(const z of [6.75,8.05,9.25,10.55])box(props,0,.083,z,260,.055,.07,0x384f5a);
  for(let x=-100;x<100;x+=4.4)box(props,x,.085,8.66,1.9,.015,.065,0xefce8d);
  for(const x of [-19.2,20.48])for(let z=5;z<12;z+=1)box(props,x,.09,z,3.4,.02,.42,0xeadfbc);
  function wall(x:number,z:number,w:number,h:number,d:number,color:number){
    const geo=new THREE.BoxGeometry(w,h,d);const uv=geo.getAttribute('uv'),p=geo.getAttribute('position'),n=geo.getAttribute('normal');
    for(let i=0;i<uv.count;i++){uv.setXY(i,(Math.abs(n.getX(i))>.5?p.getZ(i):p.getX(i))/3.8,p.getY(i)/3.8);}
    const mat=new THREE.MeshStandardMaterial({color,map:brick,bumpMap:brick,bumpScale:.025,roughness:.94});const mesh=new THREE.Mesh(geo,mat);mesh.position.set(x,h/2,z);mesh.castShadow=true;mesh.receiveShadow=true;architecture.add(mesh);return mesh;
  }
  // Facades use measured-looking courses, deep openings and varied shop widths.
  function opening(parent:THREE.Object3D,x:number,y:number,z:number,w:number,h:number,arched=false,trim=0xb7b2a3){
    const g=new THREE.Group();g.position.set(x,y-h/2,z);parent.add(g);
    const frame=new THREE.Shape();frame.moveTo(-w/2,0);frame.lineTo(w/2,0);frame.lineTo(w/2,h-(arched?w/2:0));
    if(arched)frame.absarc(0,h-w/2,w/2,0,Math.PI,false);else frame.lineTo(-w/2,h);frame.lineTo(-w/2,0);
    const surround=new THREE.Mesh(new THREE.ShapeGeometry(frame),material(trim,.94));surround.position.z=.02;g.add(surround);
    const glass=surround.clone();glass.material=material(0x354a50,.28);glass.scale.set(.79,.88,1);glass.position.set(0,.1,.035);g.add(glass);
    box(g,0,h*.45,.07,.045,h*.81,.04,0x777d75);box(g,0,h*.52,.075,w*.80,.055,.04,0xa9aaa0);
    box(g,0,-.025,.09,w+.2,.13,.31,0xaba799);
    box(g,-w*.27,h*.6,.085,w*.15,h*.45,.016,0x829a9b);
  }
  function shop(x:number,w:number,h:number,color:number,trim:number,name:string,sub:string,kind='shop'){
    const front=-3.2,depth=7.1,z=front-depth/2;wall(x,z,w,h,depth,color);obstacles.push({x,z,w,d:depth,h,tag:'building'});
    const cornice=kind==='books'?0x3a4548:0x424949;
    box(architecture,x,h+.12,z,w+.12,.24,depth+.12,cornice);box(architecture,x,h-.23,front+.10,w+.14,.14,.22,cornice);
    for(let xx=x-w/2+.18;xx<x+w/2;xx+=.34)box(architecture,xx,h-.41,front+.13,.12,.21,.22,cornice);
    box(architecture,x,.2,front+.03,w,.40,.16,0xa7a396);
    // A recessed shop door between large, lightly reflective display windows.
    for(const dx of [-w*.30,w*.29]){
      const ww=w*.34;box(architecture,x+dx,1.61,front+.10,ww,2.55,.22,trim);
      box(props,x+dx,1.65,front+.235,ww-.17,2.28,.035,0x294045);
      box(props,x+dx,1.57,front+.26,ww-.3,1.90,.022,kind==='bakery'?0x97846a:0x556266);
      box(props,x+dx,2.44,front+.30,ww-.12,.055,.04,trim);box(props,x+dx,.60,front+.30,ww-.08,.18,.08,trim);
      box(props,x+dx-.25,1.83,front+.29,.11,1.55,.012,0x91a4a3);
      if(kind==='books'){
        for(let row=0;row<3;row++)for(let j=0;j<8;j++){const xx=x+dx-ww*.40+j*ww*.11;box(props,xx,.83+row*.49,front+.31,.13,.25+(j%3)*.045,.08,[0xd1b58a,0x986c61,0x557989,0x77876b,0xc6955e][(j+row)%5]);}
        for(let j=0;j<10;j++)box(props,x+dx-ww*.43+j*ww*.095,2.74,front+.29,.13,.29+(j%2)*.055,.09,[0x9c8870,0x6f8485,0xb38878][j%3]);
        const lettering=texture((c,cw,ch)=>{c.clearRect(0,0,cw,ch);c.textAlign='center';c.textBaseline='middle';c.strokeStyle='#ece8d8';c.lineWidth=2.1;c.font='75px sans-serif';c.strokeText('QUEEN',cw/2,ch*.28,cw-30);c.strokeText('BOOKS',cw/2,ch*.75,cw-30);},512,192);
        const neon=new THREE.Mesh(new THREE.PlaneGeometry(ww-.30,.58),new THREE.MeshBasicMaterial({map:lettering,transparent:true,depthWrite:false,opacity:.88}));neon.position.set(x+dx,1.96,front+.36);props.add(neon);
      }else if(kind==='bakery'){
        for(let j=0;j<5;j++)orb(props,x+dx-ww*.34+j*ww*.17,.86,front+.31,.18,.11,.1,0xba8753);
      }else{
        for(let j=0;j<3;j++)box(props,x+dx-ww*.3+j*ww*.3,.90,front+.30,.35,.48+(j%2)*.12,.08,[0xaa8c72,0x85928d,0xb5a998][j]);
      }
    }
    box(architecture,x,1.45,front+.02,1.30,2.9,.11,0x202f32);box(props,x,1.45,front+.09,1.05,2.65,.04,0x6c7974);
    for(const dx of [-.51,.51])box(props,x+dx,1.45,front+.13,.055,2.68,.035,trim);
    box(props,x,1.34,front+.145,1.0,.055,.035,trim);rod(props,new THREE.Vector3(x+.32,1.15,front+.17),new THREE.Vector3(x+.32,1.52,front+.17),.025,0xb7b8ad);
    // Individual fascia treatments; most Queen East shops do not have striped awnings.
    box(architecture,x,3.12,front+.13,w-.12,.58,.28,trim);
    if(kind==='books'){
      // Original little readers echo the photographed bookstore's sculptural frieze.
      for(let i=0;i<8;i++){const xx=x-w*.41+i*w*.117,coat=[0xa47b60,0x777d74,0x9f8669,0x9b7170][i%4],skin=[0xd2b08c,0x9d8066,0xb99479][i%3];
        box(props,xx,3.23,front+.30,.30,.27,.15,coat,.035);orb(props,xx,3.46,front+.30,.11,.14,.09,skin);orb(props,xx,3.52,front+.28,.12,.085,.1,[0x6b5746,0xada18a,0x565b52][i%3]);
        for(const side of [-1,1]){const book=box(props,xx+side*.085,3.24,front+.43,.17,.23,.028,[0x7f9171,0xbba16f,0xa07164][i%3]);book.rotation.y=side*.28;orb(props,xx+side*.17,3.23,front+.425,.035,.045,.035,skin);}
      }
      sign(props,'914','',x,2.56,front+.17,.34,.20,'#253846','#e9e3cd','sans-serif');
    }else sign(props,name,sub,x,3.13,front+.29,w-.40,.44,`#${trim.toString(16).padStart(6,'0')}`,'#f1e6cc','Georgia');
    if(kind==='bakery'||kind==='cafe'){
      const shade=new THREE.Group();shade.position.set(x,2.95,front+.62);shade.rotation.x=.10;
      box(shade,0,0,0,w-.1,.09,1.05,trim,.02);box(shade,0,-.14,.50,w-.1,.27,.055,trim);
      if(kind==='bakery')for(let i=0;i<w/.4;i++)box(shade,-w/2+.22+i*.4,.051,0,.17,.01,1.04,0xc7b99c);
      architecture.add(shade);
    }
    const rows=h>8.3?2:1,cols=Math.max(2,Math.floor(w/2.5));
    for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
      const xx=x+(col-(cols-1)/2)*w/(cols+.5),yy=4.65+row*2.5;
      opening(architecture,xx,yy,front+.035,1.10,1.75,kind==='heritage'&&row===rows-1,0xaaa694);
      box(props,xx,yy+.95,front+.07,1.40,.17,.18,0xb5ac95);
      if((col+row)%3===1){box(props,xx,yy-.67,front+.31,.78,.24,.41,0x9b9f97);for(let i=0;i<5;i++)box(props,xx-.3+i*.15,yy-.67,front+.53,.04,.17,.016,0x626f6c);}
    }
    // Lane elevations have practical downpipes, patched masonry and service entries.
    for(let row=0;row<rows;row++)for(const dx of [-w*.28,w*.28]){
      const rear=new THREE.Group();rear.position.set(x+dx,0,front-depth-.025);rear.rotation.y=Math.PI;opening(rear,0,4.65+row*2.5,0,1.05,1.45,false,0x898b7e);architecture.add(rear);
    }
    rod(props,new THREE.Vector3(x-w*.42,.1,front-depth-.17),new THREE.Vector3(x-w*.42,h-.15,front-depth-.17),.047,0x626c67);
    box(props,x,1.1,front-depth-.12,1.10,2.2,.15,0x65746a,.015);box(props,x,.12,front-depth-.55,1.5,.24,.7,0xada99c);
    box(props,x-w*.28,h+.65,z,.65,1.2,.75,0x8d7766);box(props,x-w*.28,h+1.28,z,.82,.14,.90,0xaaa79b);
    box(snow,x,h+.27,z,w-.2,.1,depth-.2,PALETTE.snow);
  }
  shop(-25.6,9.1,7.5,0xe6d2b7,0x405b50,'EAST END BAKERY','', 'bakery');
  shop(-14.35,4.5,9.5,0xdfb7a5,0x393d40,'RIVERSIDE','VINTAGE & FOUND', 'heritage');
  shop(-9.9,4.35,8.1,0xc4afa0,0x635b53,'QUEEN EAST','HARDWARE · REPAIRS');
  shop(-3.2,7.2,7.0,0xd9d0bb,0x76796e,'CORNER MARKET','FRUIT & FLOWERS');
  shop(6.4,7.8,8.8,0xd9b6a4,0x585b57,'EAST SIDE','COFFEE & KITCHEN','cafe');
  shop(14.7,6.7,7.2,0xd6bda4,0x304960,'QUEEN BOOKS','914 QUEEN STREET EAST','books');
  shop(27.8,10.2,9.3,0xdbbfa6,0x385851,'NEIGHBOUR HOUSE','COMMUNITY KITCHEN','heritage');
  // The gathering is reached through the back door, with an accessible landing.
  box(props,26.88,1.3,-10.38,1.35,2.6,.2,0x397366,.12);box(props,26.88,.14,-11.25,2.3,.28,1.5,0xe6cba8,.06);sign(props,'WELCOME','SIDE ENTRANCE',26.88,3.2,-10.5,2.5,.65,'#356e65').rotation.y=Math.PI;
  // Broadview: red masonry, four-storey arcades and a corner tower with dormers.
  const hotelX=-35,hotelZ=-6.95,hotelFront=-2.85;
  wall(hotelX,hotelZ,9.2,12.9,8.2,0xd2b5a1);obstacles.push({x:hotelX,z:hotelZ,w:9.2,d:8.2,h:18,tag:'building'});
  const hotelFaces=[{x:hotelX,z:hotelFront,w:9.2,angle:0},{x:-30.37,z:hotelZ,w:8.2,angle:Math.PI/2}];
  for(const f of hotelFaces){const facade=new THREE.Group();facade.position.set(f.x,0,f.z);facade.rotation.y=f.angle;architecture.add(facade);
    for(let i=0;i<Math.floor(f.w/.55);i++)for(let row=0;row<4;row++)box(facade,-f.w/2+.28+i*.55,.32+row*.38,.08,.53,.35,.16,[0xa7a18f,0x959583,0xb2aa97][(i+row)%3]);
    for(const y of [3.3,6.15,9.05,12.55]){box(facade,0,y,.08,f.w,.13,.21,0xa99f8c);box(facade,0,y+.16,.11,f.w,.1,.28,0x565b54);}
    for(let col=0;col<5;col++){const x=(col-2)*(f.w-1)/5;for(let row=0;row<4;row++)opening(facade,x,1.9+row*2.83,.10,1.05,row===0?2.0:2.13,row===0||row===2||row===3,0x9f8a71);}
    for(let x=-f.w/2+.12;x<f.w/2;x+=f.w/3){box(facade,x,7.5,.12,.26,10.1,.27,0x977258);for(const y of [6.3,9.15,12.5])box(facade,x,y,.18,.43,.20,.40,0x9c8a71);}
    for(let x=-f.w/2+.2;x<f.w/2;x+=.37)box(facade,x,12.22,.16,.13,.27,.32,0x645f52);
    box(facade,0,13.02,0,f.w+.25,.24,.35,0x525c57);
  }
  box(architecture,-38,14.1,-4.55,3.0,3.15,3.25,0x967254);box(architecture,-38,15.7,-4.55,3.55,.22,3.8,0x525c58);
  const hotelRoof=new THREE.Mesh(new THREE.ConeGeometry(2.8,2.3,4),material(0x686e6a,.93));hotelRoof.rotation.y=Math.PI/4;hotelRoof.position.set(-38,16.9,-4.55);hotelRoof.castShadow=true;architecture.add(hotelRoof);
  box(architecture,-38,16.3,-2.8,1.22,1.6,.8,0x97795c);opening(architecture,-38,16.45,-2.36,.68,1.1,false,0xaaa794);box(architecture,-38,17.2,-2.8,1.48,.16,1.03,0x515954);
  for(const dx of [-.73,.73])opening(architecture,-38+dx,14.10,-2.88,.76,1.45,true,0x987d60);
  box(props,-32.72,2.98,-2.38,3.55,.25,.9,0x293737);sign(props,'THE BROADVIEW HOTEL','',-32.72,3.02,-1.90,3.35,.24,'#263331','#dfc68e');
  for(let i=0;i<12;i++)orb(props,-34.22+i*.27,2.84,-1.96,.025,.025,.025,0xe6c282);
  box(snow,-34.6,13.11,-7.35,7.6,.09,6.8,PALETTE.snow);
  const budGeometry=new THREE.SphereGeometry(1,8,6);
  function bud(parent:THREE.Object3D,x:number,y:number,z:number,sx:number,sy:number,sz:number,color:number){const m=new THREE.Mesh(budGeometry,material(color));m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=true;parent.add(m);return m;}
  function flowers(parent:THREE.Object3D,x:number,y:number,z:number,width:number,variant=0){
    box(parent,x,y,z,width,.25,.38,variant%2?0x87968a:0xaa7859,.04);
    box(parent,x,y+.13,z,width-.12,.025,.29,0x665747);
    for(let i=0;i<5;i++){const px=x-width*.38+i*width*.19,h=.21+(i%3)*.035;
      rod(parent,new THREE.Vector3(px,y+.1,z),new THREE.Vector3(px,y+h+.15,z),.012,0x587758);
      bud(parent,px+.055,y+.20,z,.095,.035,.08,0x638b62);
      bud(parent,px,y+h+.17,z,.10,.10,.09,[0xe4ad70,0xcb7c82,0xe9c689][(i+variant+6)%3]);
      bud(parent,px,y+h+.235,z,.04,.025,.04,0xf6dc9a);
    }
  }
  let houseIndex=0;
  function house(x:number,z:number,color:number,faceNorth=false){
    const variant=houseIndex++%4,near=(Math.abs(z)<33||(z===46&&x>=-21))&&Math.abs(x)<45;const h=5.95+variant*.28,w=5.3,d=6.2;wall(x,z,w,h,d,color);obstacles.push({x,z,w,d,h:9,tag:'house'});
    const pitch=variant===2?1.0:2.2;const gable=new THREE.Shape();gable.moveTo(-2.95,0);gable.lineTo(2.95,0);gable.lineTo(variant===3?.65:0,pitch);gable.closePath();
    const roof=new THREE.Mesh(new THREE.ExtrudeGeometry(gable,{depth:6.8,bevelEnabled:false}),material([0x59615e,0x706a61,0x515e60,0x7c7163][variant],.95));roof.position.set(x,h-.05,z-3.4);roof.castShadow=true;architecture.add(roof);
    const snowRoof=new THREE.Mesh(roof.geometry,material(PALETTE.snow));snowRoof.position.copy(roof.position);snowRoof.position.y+=.035;snow.add(snowRoof);
    const front=z+(faceNorth?-1:1)*d/2;const frontGroup=new THREE.Group();frontGroup.position.set(x,0,front);if(faceNorth)frontGroup.rotation.y=Math.PI;
    box(frontGroup,0,1.4,.12,1.25,2.8,.2,[0x467e72,0x9c5c65,0x50738a,0xa8804e][variant],.08);for(const dx of [-1.4,1.4]){box(frontGroup,dx,4.8,.12,1.45,1.8,.17,0xf8d6aa);box(frontGroup,dx,4.8,.23,1.13,1.5,.04,0x477383);box(frontGroup,dx,4.8,.27,.08,1.5,.03,0xf7d7af);}
    box(frontGroup,0,.2,1.1,4.6,.4,2.3,0xd3b597,.06);box(frontGroup,0,3.2,1.1,4.8,.25,2.5,0xf5d5ac,.05);for(const dx of [-2,2])box(frontGroup,dx,1.8,2.1,.15,3,.15,0xf5d5ac);
    for(const side of [-1,1]){box(frontGroup,side*1.6,.99,2.2,1.5,.08,.08,0xeee0ba);for(let j=0;j<5;j++)box(frontGroup,side*.9+side*j*.3,.67,2.2,.065,.6,.065,0xeee0ba);}
    if(near){
      // Near homes have distinct windows, doors and porch life, at human scale.
      box(frontGroup,0,1.88,.24,.83,.83,.035,0xcbbf9c,.04);
      box(frontGroup,0,1.88,.27,.055,.85,.025,0xf1d5b0);box(frontGroup,0,1.88,.27,.85,.055,.025,0xf1d5b0);
      for(const dy of [.55,1.05])box(frontGroup,0,dy,.24,.85,.28,.025,variant%2?0x804a53:0x39695f,.02);
      orb(frontGroup,.42,1.32,.28,.055,.055,.05,0xe3ba71);
      box(frontGroup,-.84,1.55,.22,.26,.36,.15,0x4b6061,.04);box(frontGroup,-.84,1.66,.30,.18,.03,.025,0xd0b285);
      const bayX=variant%2?-1.55:1.55;
      box(frontGroup,bayX,1.88,.37,1.27,1.63,.61,0xe8cda7,.05);
      box(frontGroup,bayX,1.91,.69,1.04,1.34,.025,0x72928f);
      box(frontGroup,bayX,1.91,.72,.06,1.37,.03,0xf9deba);box(frontGroup,bayX,1.86,.72,1.1,.07,.03,0xf9deba);
      box(frontGroup,bayX,2.75,.36,1.48,.17,.85,0x58776e,.04);box(frontGroup,bayX,1.01,.39,1.46,.15,.84,0xf4d6ac,.035);
      for(const dx of [-1.4,1.4]){
        if(variant===1||variant===3)for(const side of [-1,1]){box(frontGroup,dx+side*.87,4.8,.24,.29,1.9,.07,0x557c70,.02);for(let j=0;j<7;j++)box(frontGroup,dx+side*.87,4.15+j*.20,.285,.27,.035,.03,0x749083);}
        flowers(frontGroup,dx,3.87,.34,1.55,variant);
      }
      box(frontGroup,0,.10,2.57,1.5,.20,.5,0xcdb69a,.035);box(frontGroup,0,.045,2.96,1.7,.09,.35,0xe4cdb0,.025);
      box(frontGroup,0,.42,.62,.9,.02,.5,0x977f67,.03);
      flowers(frontGroup,-1.55,.60,1.40,.70,variant+1);
      // A chair, a hanging planter and a roof dormer vary the repeated kit.
      box(frontGroup,1.53,.74,1.45,.55,.09,.53,0x6d8a81,.04);box(frontGroup,1.53,1.13,1.18,.55,.73,.09,0x6d8a81,.04);
      for(const dx of [-.2,.2])box(frontGroup,1.53+dx,.53,1.45,.06,.45,.41,0x668079);
      rod(frontGroup,new THREE.Vector3(-1.85,3.09,1.62),new THREE.Vector3(-1.85,2.61,1.62),.02,0xa58d68);
      bud(frontGroup,-1.85,2.5,1.62,.26,.20,.26,0xb77759);for(let i=0;i<5;i++)bud(frontGroup,-1.85+Math.sin(i)*.20,2.65+Math.cos(i)*.04,1.62+Math.cos(i)*.16,.17,.13,.18,0x648963);
      if(near&&variant===1){box(frontGroup,0,7.1,-.45,1.3,1.55,1.6,0xe1bd9b,.03);box(frontGroup,0,7.15,.38,.82,1.02,.07,0x477284);box(frontGroup,0,7.15,.425,.055,1.05,.03,0xf6d6b0);box(frontGroup,0,7.15,.425,.84,.055,.03,0xf6d6b0);const cap=new THREE.Mesh(new THREE.ConeGeometry(1.12,.8,4),material(0x4f696f));cap.rotation.y=Math.PI/4;cap.position.set(0,8.07,-.45);cap.scale.z=1.4;frontGroup.add(cap);}
      box(frontGroup,1.65,7.75,-2.5,.65,1.8,.75,0xb08166);box(frontGroup,1.65,8.68,-2.5,.83,.14,.90,0xebccaa);
      // Side elevations remain visible from the park and the service lane.
      for(const side of [-1,1]){
        const elevation=new THREE.Group();elevation.position.set(x+side*(w/2+.025),0,z);elevation.rotation.y=side*Math.PI/2;architecture.add(elevation);
        for(const zz of [-1.45,1.45])for(const yy of [2.0,4.65])opening(elevation,zz,yy,0,.79,1.29,false,0xb8b5a6);
        rod(elevation,new THREE.Vector3(2.8,.2,.10),new THREE.Vector3(2.8,h-.2,.10),.035,0x777e72);
        box(elevation,0,h-.08,.04,6.1,.14,.24,0x697269);
      }
      if(z===46){
        // Small front yards, with separate gates rather than a repeated blank apron.
        const yard=new THREE.Group();yard.position.set(x,0,39.2);props.add(yard);
        for(const side of [-1,1]){for(let i=0;i<8;i++)box(yard,side*(.9+i*.22),.55,0,.035,.87,.04,0x52675b);box(yard,side*1.72,.96,0,1.75,.055,.065,0x52675b);box(yard,side*1.72,.27,0,1.75,.045,.065,0x52675b);}
        for(const xx of [-2.57,-.87,.87,2.57])box(yard,xx,.60,0,.07,1.06,.07,0x52675b);
        for(let i=0;i<4;i++)box(ground,x,.105,39.55+i*.62,1.45,.03,.57,[0xb0b0a1,0xa9aa9c][i%2]);
      }
    }
    architecture.add(frontGroup);
  }
  for(const [i,x] of [-27,-14,-7,0,7,14,28,37,44].entries())house(x,-25,[0xe1a58b,0xdca9ad,0xd9bc93,0xc28c7b][i%4]);
  house(-30,25,0xe9ae86,true);house(-2.9,28,0xf1bb87,true);house(40,17,0xe6a597,true);
  // The Opera House is on Queen's south side: broad brick facade, projecting bays,
  // six upper sash windows and its own curved marquee, rather than a shop awning.
  wall(-10.9,16.7,10.4,9.6,3.2,0xd6b6a3);obstacles.push({x:-10.9,z:16.7,w:10.4,d:3.2,h:10,tag:'building'});
  const opera=new THREE.Group();opera.position.set(-10.9,0,15.08);opera.rotation.y=Math.PI;architecture.add(opera);
  box(opera,0,9.52,.12,10.55,.25,.36,0x404c49);box(opera,0,6.47,.10,10.3,.12,.25,0xaaa795);
  for(let i=0;i<6;i++)opening(opera,(i-2.5)*1.52,7.91,.06,.82,1.50,false,0xaaa99a);
  for(const x of [-3.45,3.45]){box(opera,x,5.08,.40,2.30,2.1,.72,0x48534f);opening(opera,x,5.11,.81,1.48,1.75,false,0xc1bba8);box(opera,x,6.23,.39,2.65,.17,1.0,0x3e4d4b);box(opera,x,3.96,.45,2.6,.20,1.06,0x46514e);}
  for(const x of [-3.5,3.5]){box(opera,x,1.48,.10,2.7,2.8,.22,0x656861);box(opera,x,1.46,.235,2.46,2.55,.04,0x334441);for(const dx of [-.8,0,.8])box(opera,x+dx,1.47,.27,.055,2.6,.04,0x9f9f8e);}
  box(opera,0,1.5,-.02,2.42,3,.2,0x283739);for(const x of [-.59,.59]){box(opera,x,1.27,.11,1.04,2.48,.05,0x68716b);box(opera,x,1.58,.145,.75,1.26,.02,0x293d40);}
  const marquee=new THREE.Shape();marquee.moveTo(-2.25,-.32);marquee.lineTo(2.25,-.32);marquee.lineTo(2.25,.23);marquee.quadraticCurveTo(0,.81,-2.25,.23);marquee.closePath();
  const marqueeMesh=new THREE.Mesh(new THREE.ExtrudeGeometry(marquee,{depth:.52,bevelEnabled:false,curveSegments:16}),material(0x33454e));marqueeMesh.position.set(0,3.38,.40);opera.add(marqueeMesh);
  sign(opera,'THE OPERA HOUSE','SEVEN HUNDRED THIRTY FIVE',0,3.47,.94,4.25,.59,'#384854','#e1c690');
  for(let i=0;i<22;i++)orb(opera,-2.08+i*.20,3.08,.96,.023,.023,.023,0xe5c58c);
  sign(opera,'735','',0,2.77,.19,.54,.30,'#303d40','#dfd7ba','sans-serif');
  box(snow,-10.9,9.66,16.7,10.2,.1,3,PALETTE.snow);
  function southShop(x:number,w:number,h:number,trim:number,name:string){
    wall(x,16.7,w,h,3.2,0xd4c1ab);obstacles.push({x,z:16.7,w,d:3.2,h,tag:'building'});
    const face=new THREE.Group();face.position.set(x,0,15.08);face.rotation.y=Math.PI;architecture.add(face);
    box(face,0,h,.10,w+.14,.19,.30,0x4e5750);box(face,0,3.08,.11,w-.08,.57,.18,trim);
    sign(face,name,'',0,3.10,.22,w-.35,.32,`#${trim.toString(16).padStart(6,'0')}`,'#ece3cc','sans-serif');
    box(face,0,1.48,.10,w-.22,2.67,.2,trim);box(face,0,1.53,.22,w-.52,2.36,.025,0x425957);
    for(const xx of [-w*.31,w*.12,w*.36])box(face,xx,1.48,.25,.064,2.63,.04,trim);
    for(let i=0;i<4;i++)box(face,-w*.36+i*w*.17,.67,.25,.47,.47+i*.07,.07,[0xa2927a,0x73856e,0x9b7c6a][i%3]);
    for(const xx of [-w*.24,w*.24])opening(face,xx,4.92,.02,1.08,1.74,x<0,0xb5b09e);
    box(snow,x,h+.11,16.7,w-.12,.06,3.05,PALETTE.snow);
  }
  southShop(-30,6.4,6.65,0x596355,'EAST END CYCLES');southShop(-2.2,6.6,7.1,0x756857,'TAILOR & ALTERATIONS');southShop(6.1,8.0,6.7,0x5b655a,'NEIGHBOURHOOD GROCER');
  // Utility elevations on the route behind Queen: doors, lintels, drains and sash windows.
  for(const [x,w,h] of [[-30,6.4,6.65],[-10.9,10.4,9.6],[-2.2,6.6,7.1],[6.1,8.0,6.7]]){
    const rear=new THREE.Group();rear.position.set(x,0,18.33);architecture.add(rear);
    box(rear,0,1.18,.045,1.28,2.36,.09,0x465a55);box(rear,0,1.67,.10,.71,.66,.025,0x90a098);box(rear,.4,1.06,.14,.12,.035,.06,0xb6b29b);
    box(rear,0,2.43,.09,1.58,.15,.25,0xb0ad99);
    for(const xx of [-w*.31,w*.31])opening(rear,xx,4.61,.02,.86,1.45,false,0xaaa89a);
    if(h>8)for(const xx of [-w*.31,0,w*.31])opening(rear,xx,7.57,.02,.82,1.43,false,0xaaa89a);
    for(const xx of [-w*.46,w*.46])rod(rear,new THREE.Vector3(xx,.1,.10),new THREE.Vector3(xx,h-.16,.10),.046,0x68766c);
    box(rear,0,h-.16,.04,w,.19,.20,0x657169);
  }
  // Neighbourhood fabric continues beyond the playable streets, so the horizon never opens onto an empty plane.
  for(const [i,x] of [-45,-37,-29,-21,-13,-5,3,11,19,27,35,43,51].entries()){
    house(x,-40,[0xdba38d,0xd8afa0,0xe6bc8f,0xc99b90][i%4]);
    house(x,46,[0xe4ad8c,0xd1ac97,0xe3b69c,0xc9988e][i%4],true);
  }
  for(const x of [-48,51])for(const z of [-27,-15,-3,22,34])house(x,z,0xd9aa91,x>0);
  // Intimate backyard details along the north lane.
  for(const x of [-12,-5,2,9,29,38]){
    for(let i=0;i<9;i++)box(props,x-2+i*.5,.52,-20.6,.1,1.05,.12,0xb58864,.02);
    box(props,x,.3,-20.6,4.2,.1,.12,0xbb9975);box(props,x,.82,-20.6,4.2,.1,.12,0xbb9975);
    for(const dx of [-1.4,1.4])orb(props,x+dx,.55,-21.3,.75,.6,.55,0x7c9b72);
    box(props,x-1.9,.48,-12.0,.65,.95,.65,0x547d76,.06);box(props,x-1.9,.97,-12.0,.73,.08,.73,0x3e625f,.03);
  }
  for(const x of [-22,21]){rod(props,new THREE.Vector3(x,0,-17.1),new THREE.Vector3(x,5.7,-17.1),.065,0x567171);}
  const wire=new THREE.CatmullRomCurve3([new THREE.Vector3(-22,5.7,-17.1),new THREE.Vector3(0,4.8,-17.1),new THREE.Vector3(21,5.7,-17.1)]);
  const wireMesh=new THREE.Mesh(new THREE.TubeGeometry(wire,28,.018,4,false),material(0x476264));props.add(wireMesh);
  for(let i=0;i<18;i++){const p=wire.getPoint((i+.5)/18);rod(props,p,p.clone().add(new THREE.Vector3(0,-.15,0)),.018,0x476264);orb(props,p.x,p.y-.22,p.z,.085,.11,.085,0xffd494);}
  // Painted mural on a south wall, drawn as original neighbourhood art.
  const mural=texture((c,w,h)=>{c.fillStyle='#ecc291';c.fillRect(0,0,w,h);c.fillStyle='#d36b4b';c.beginPath();c.moveTo(150,390);c.bezierCurveTo(350,490,610,390,745,260);c.lineTo(830,140);c.lineTo(850,290);c.lineTo(950,340);c.lineTo(830,385);c.lineTo(720,335);c.bezierCurveTo(460,500,190,490,150,390);c.fill();c.beginPath();c.moveTo(260,410);c.bezierCurveTo(0,390,30,110,340,100);c.bezierCurveTo(145,220,160,350,420,345);c.fill();c.fillStyle='#ffecb9';c.beginPath();c.moveTo(340,100);c.bezierCurveTo(230,120,135,190,115,245);c.lineTo(200,250);c.bezierCurveTo(215,190,260,145,340,100);c.fill();c.fillStyle='#294e52';c.beginPath();c.arc(845,315,8,0,Math.PI*2);c.fill();c.font='italic 36px Georgia';c.fillText('a little wild on the east side',46,65);});
  const fox=new THREE.Mesh(new THREE.PlaneGeometry(4.7,2.5),new THREE.MeshBasicMaterial({map:mural}));fox.position.set(-2.9,2.5,31.13);props.add(fox);
  const canopyGeometry=new THREE.SphereGeometry(1,20,14),canopyPositions=canopyGeometry.getAttribute('position');
  const canopyTints=new Float32Array(canopyPositions.count*3);
  for(let i=0;i<canopyPositions.count;i++){const x=canopyPositions.getX(i),y=canopyPositions.getY(i),z=canopyPositions.getZ(i),wave=1+.065*Math.sin(x*13+z*5)*Math.sin(z*11-y*7)+.025*Math.cos(y*16+x*8);canopyPositions.setXYZ(i,x*wave,y*wave,z*wave);const light=.88+(y+1)*.10;canopyTints.set([light,light,light*.96],i*3);}
  canopyGeometry.setAttribute('color',new THREE.BufferAttribute(canopyTints,3));canopyGeometry.computeVertexNormals();
  function crown(parent:THREE.Object3D,x:number,y:number,z:number,sx:number,sy:number,sz:number,color:number){const mesh=new THREE.Mesh(canopyGeometry,material(color));mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);}
  const fallenShape=new THREE.Shape();fallenShape.moveTo(0,.16);for(const [x,y] of [[.035,.065],[.11,.1],[.085,.025],[.15,-.005],[.05,-.065],[0,-.15],[-.035,-.065],[-.13,-.005],[-.085,.025],[-.11,.1],[-.035,.065]])fallenShape.lineTo(x,y);fallenShape.closePath();const fallenGeometry=new THREE.ShapeGeometry(fallenShape);
  function tree(x:number,z:number,scale=1,color=0x81a971){
    const tree=new THREE.Group();tree.position.set(x,0,z);tree.scale.setScalar(scale);
    rod(tree,new THREE.Vector3(0,0,0),new THREE.Vector3(.12,4.5,.08),.2,0x886345);
    for(let i=0;i<6;i++){const a=i*2.4,cx=Math.cos(a)*1.08,cy=4.9+(i%3)*.56,cz=Math.sin(a)*1.08;rod(tree,new THREE.Vector3(0,2,0),new THREE.Vector3(cx,cy,cz),.075,0x74654f);
      const tint=new THREE.Color(color).offsetHSL(0,-.03,(i-2)*.012).getHex();crown(tree,cx,cy,cz,1.1,1.05,1.06,tint);
      const leafMaterial=new THREE.MeshStandardMaterial({color:tint,roughness:.94,side:THREE.DoubleSide});
      for(let j=0;j<32;j++){const phi=random()*Math.PI*2,yy=random()*2-1,r=Math.sqrt(1-yy*yy)*1.28;const leaf=new THREE.Mesh(fallenGeometry,leafMaterial);leaf.position.set(cx+Math.cos(phi)*r,cy+yy*1.18,cz+Math.sin(phi)*r);leaf.rotation.set(random()*Math.PI,phi,random()*Math.PI);leaf.scale.setScalar(1.3+random()*.9);leaf.castShadow=true;tree.add(leaf);}
    }
    mergeStatic(tree);group.add(tree);cameraOccluder(tree);
    for(let i=0;i<24;i++){const a=random()*Math.PI*2,r=.9+random()*2.0,leaf=new THREE.Mesh(fallenGeometry,material([0xc59258,0xdbaa68,0xbb7655,0xd6a075][i%4]));leaf.position.set(x+Math.cos(a)*r,.143,z+Math.sin(a)*r);leaf.rotation.set(-Math.PI/2,0,a);leaf.scale.setScalar(.7+random()*.6);autumn.add(leaf);}
    box(props,x,.16,z,1.8,.25,1.8,0xb2a284,.08);obstacles.push({x,z,w:.65*scale,d:.65*scale,h:7*scale,tag:'tree'});
  }
  for(const [x,z,s] of [[-38,1.8,1],[-16,.65,.9],[17.2,.65,1],[34,1.2,1.1],[-35,15,1.15],[-14,15,.8],[6,15,1],[27,16,1],[38,28,1.3],[25,32,1.15],[16,-23,.8],[-43,-4,1.2],[-27,-23,1],[45,-18,1.2]])tree(x,z,s,x===-16||x===27?0xcb7858:x===18||x===25?0xd49a63:0x81a971);
  function lamp(x:number,z:number){const pole=0x7b847e;rod(props,new THREE.Vector3(x,0,z),new THREE.Vector3(x,7.1,z),.075,pole);const toward=z<8?1:-1;rod(props,new THREE.Vector3(x,7.05,z),new THREE.Vector3(x,7.55,z+toward*1.7),.045,pole);box(props,x,7.50,z+toward*1.95,.32,.16,.65,0x7f8880,.05);box(props,x,7.414,z+toward*1.95,.24,.014,.44,0xe1dfca);}

  for(let x=-45;x<55;x+=13){if(x!==-32)lamp(x,4.75);lamp(x+6,13.1);}
  for(let x=-48;x<55;x+=20){if(x===-28)continue;rod(props,new THREE.Vector3(x,0,4.75),new THREE.Vector3(x,8.7,4.75),.07,0x53676c);rod(props,new THREE.Vector3(x,8.4,4.75),new THREE.Vector3(x,8.4,12.6),.023,0x3b5560);}
  for(const z of [7.4,9.9])rod(props,new THREE.Vector3(-110,8.3,z),new THREE.Vector3(110,8.3,z),.023,0x49616d);
  // Public seating, bicycles, sidewalk gardens, and shop signs.
  function bench(x:number,z:number,rotation=0){const b=new THREE.Group();b.position.set(x,0,z);b.rotation.y=rotation;for(let i=0;i<4;i++){box(b,0,.7,(i-1.5)*.19,2.2,.11,.15,0xa76c4b,.025);box(b,0,1.1+i*.14,-.4,2.2,.1,.07,0xa76c4b,.02);}for(const dx of [-.8,.8]){box(b,dx,.35,0,.12,.7,.6,0x3f6060);box(b,dx,1,-.42,.1,1.3,.12,0x3f6060);}props.add(b);obstacles.push({x,z,w:2.3,d:1,h:1.6,tag:'bench'});}
  bench(30,19);bench(43,26,Math.PI/2);bench(-5,14.6);
  for(const [x,z] of [[-31.2,-2.2],[10.5,-1.7],[32,-1.8],[26,18]]){box(props,x,.4,z,1.7,.8,.9,0xad6d52,.12);for(let i=0;i<5;i++){orb(props,x-.6+i*.3,.98+(i%2)*.15,z,.35,.42,.34,0x638d68);orb(props,x-.6+i*.3,1.24+(i%2)*.17,z+.1,.14,.16,.14,i%2?0xefbf7c:0xd68495);}obstacles.push({x,z,w:1.7,d:.9,h:1.5,tag:'planter'});}
  for(const [x,z,color] of [[-23.5,-2.45,0xd98662],[12.6,-2.45,0x406c7d],[34.4,14,0xba6d77]]){
    for(const dx of [-.65,.65]){const wheel=new THREE.Mesh(new THREE.TorusGeometry(.53,.047,7,24),material(0x345354));wheel.position.set(x+dx,.63,z);props.add(wheel);}
    rod(props,new THREE.Vector3(x-.65,.63,z),new THREE.Vector3(x,1.35,z),.055,color);rod(props,new THREE.Vector3(x,1.35,z),new THREE.Vector3(x+.65,.63,z),.055,color);rod(props,new THREE.Vector3(x-.65,.63,z),new THREE.Vector3(x+.65,.63,z),.055,color);box(props,x-.05,1.4,z,.45,.09,.25,0x345354,.04);rod(props,new THREE.Vector3(x+.65,.63,z),new THREE.Vector3(x+.4,1.6,z),.045,color);
  }
  // Queen East's everyday infrastructure is deliberately quieter than its landmarks.
  const carGlassMap=texture((c,w,h)=>{const g=c.createLinearGradient(0,0,w*.6,h);g.addColorStop(0,'#a6b8ba');g.addColorStop(.42,'#708b90');g.addColorStop(.48,'#b4c2bd');g.addColorStop(.51,'#435e66');g.addColorStop(1,'#293f48');c.fillStyle=g;c.fillRect(0,0,w,h);c.fillStyle='rgba(223,231,214,.13)';c.beginPath();c.moveTo(w*.20,0);c.lineTo(w*.38,0);c.lineTo(w*.78,h);c.lineTo(w*.65,h);c.closePath();c.fill();},256,128);
  const carGlass=new THREE.MeshStandardMaterial({map:carGlassMap,roughness:.24,metalness:.16,side:THREE.DoubleSide});
  function parkedCar(x:number,z:number,color:number,variant=0){
    const car=new THREE.Group();car.position.set(x,.12,z);car.rotation.y=z<8.5?Math.PI:0;
    const roofRear=variant===2?-1.31:variant===1?-1.08:-.78,roofHeight=variant===0?1.26:1.36;
    const outline=new THREE.Shape();outline.moveTo(-1.96,.33);outline.lineTo(-2.00,.61);outline.quadraticCurveTo(-1.92,.79,-1.65,.81);outline.lineTo(roofRear-.38,.86);outline.lineTo(roofRear,roofHeight-.08);outline.quadraticCurveTo(roofRear+.12,roofHeight,.59,roofHeight);outline.lineTo(1.02,.85);outline.lineTo(1.67,.79);outline.quadraticCurveTo(1.99,.76,2.0,.55);outline.lineTo(1.96,.33);outline.closePath();
    const paint=new THREE.MeshStandardMaterial({color,roughness:.43,metalness:.18});
    const shell=new THREE.Mesh(new THREE.ExtrudeGeometry(outline,{depth:1.39,bevelEnabled:true,bevelSize:.055,bevelThickness:.055,bevelSegments:2,steps:1,curveSegments:5}),paint);shell.position.z=-.695;shell.castShadow=true;shell.receiveShadow=true;car.add(shell);
    box(car,0,.30,0,3.31,.12,1.29,0x34403e,.04);
    function glassQuad(points:number[][]){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([...points[0],...points[1],...points[2],...points[0],...points[2],...points[3]],3));g.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,1,1,0,0,1,1,0,1],2));g.computeVertexNormals();const mesh=new THREE.Mesh(g,carGlass);car.add(mesh);}
    for(const side of [-1,1]){
      const zz=side*.754;
      glassQuad([[roofRear+.08,roofHeight-.10,zz],[-.09,roofHeight-.08,zz],[-.09,.87,zz],[roofRear-.20,.87,zz]]);
      glassQuad([[.01,roofHeight-.08,zz],[.52,roofHeight-.08,zz],[.91,.87,zz],[.01,.87,zz]]);
      box(car,-.04,(roofHeight+.85)/2,side*.769,.068,roofHeight-.79,.025,0x394c4e);
      box(car,-.39,.74,side*.763,.23,.036,.018,0xc1c4b6,.008);box(car,.50,.74,side*.763,.23,.036,.018,0xc1c4b6,.008);
      rod(car,new THREE.Vector3(-.02,.37,side*.758),new THREE.Vector3(-.02,.84,side*.758),.009,0x58605b);
      rod(car,new THREE.Vector3(-1.46,.40,side*.76),new THREE.Vector3(1.47,.40,side*.76),.018,0x63706b);
      box(car,.77,.91,side*.88,.25,.14,.25,color,.045);box(car,.72,.92,side*.997,.14,.075,.012,0x82928e);
    }
    glassQuad([[.66,roofHeight-.07,-.61],[.66,roofHeight-.07,.61],[1.008,.88,.63],[1.008,.88,-.63]]);
    glassQuad([[roofRear-.02,roofHeight-.10,.61],[roofRear-.02,roofHeight-.10,-.61],[roofRear-.34,.89,-.63],[roofRear-.34,.89,.63]]);
    for(const zz of [-.26,.26])rod(car,new THREE.Vector3(1.023,.90,zz-.18),new THREE.Vector3(.943,.99,zz+.10),.009,0x34474a);
    for(const xx of [-1.22,1.22])for(const side of [-1,1]){
      const zz=side*.76,tire=new THREE.Mesh(new THREE.CylinderGeometry(.335,.335,.19,20),material(0x303936,.9));tire.rotation.x=Math.PI/2;tire.position.set(xx,.30,zz);car.add(tire);
      const rim=new THREE.Mesh(new THREE.CylinderGeometry(.205,.205,.025,20),material(0x858f8a,.37));rim.rotation.x=Math.PI/2;rim.position.set(xx,.30,side*.869);car.add(rim);
      const center=new THREE.Mesh(new THREE.CircleGeometry(.135,16),material(0x354747,.65));center.position.set(xx,.30,side*.886);if(side<0)center.rotation.y=Math.PI;car.add(center);
      for(let j=0;j<5;j++){const a=j*Math.PI*.4,spoke=box(car,xx+Math.sin(a)*.115,.30+Math.cos(a)*.115,side*.89,.035,.17,.02,0xa1aba2,.008);spoke.rotation.z=-a;}
      const arch=new THREE.Mesh(new THREE.TorusGeometry(.361,.028,5,18,Math.PI),material(0x56645e,.65));arch.position.set(xx,.30,side*.762);car.add(arch);
    }
    box(car,2.005,.49,0,.025,.15,.80,0x293b3d,.025);for(let i=0;i<4;i++)box(car,2.023,.442+i*.029,0,.012,.01,.75,0x7e8c82);
    box(car,2.029,.67,-.56,.023,.14,.25,0xdfdec3,.035);box(car,2.029,.67,.56,.023,.14,.25,0xdfdec3,.035);
    for(const side of [-1,1]){box(car,-2.019,.67,side*.55,.023,.15,.24,0xa54438,.025);box(car,-2.035,.64,side*.55,.015,.028,.15,0xdaba91);}
    box(car,2.047,.39,0,.018,.13,.46,0xd4d6c3,.02);box(car,-2.041,.45,0,.018,.13,.46,0xd4d6c3,.02);
    box(car,-2.04,.39,0,.023,.045,1.30,0x626e67);rod(car,new THREE.Vector3(-1.40,1.0,0),new THREE.Vector3(-1.46,1.40,0),.012,0x4e605d);
    props.add(car);obstacles.push({x,z,w:4.18,d:2.02,h:1.7,tag:'parked car'});
  }
  for(const [i,[x,z,color]] of [[-35,5.75,0x6e817e],[-10,5.75,0xa49d8c],[6,5.75,0x5a666e],[33,5.75,0x8b5950],[-2,12.0,0xb0b2a9],[29,12.0,0x647267]].entries())parkedCar(x,z,color,i%3);
  for(const x of [-27,9,34]){const ring=new THREE.Mesh(new THREE.TorusGeometry(.34,.036,6,24),material(0x6d7773,.55));ring.position.set(x,1.0,13.6);props.add(ring);rod(props,new THREE.Vector3(x,.16,13.6),new THREE.Vector3(x,1.33,13.6),.045,0x6d7773);obstacles.push({x,z:13.6,w:.72,d:.12,h:1.4,tag:'bike ring'});}
  for(const x of [-22,24]){
    rod(props,new THREE.Vector3(x,.1,13.4),new THREE.Vector3(x,3.7,13.4),.035,0x88918a);
    sign(props,'TTC','501 QUEEN',x,3.22,13.44,.55,.83,'#d8d5c5','#a33531','sans-serif');box(props,x,3.67,13.41,.58,.12,.08,0xac3c37);obstacles.push({x,z:13.4,w:.10,d:.10,h:3.8,tag:'stop pole'});
  }
  for(const [x,z] of [[-7,13.45],[37,13.45]]){box(props,x,.67,z,.72,1.25,.62,0x485950,.07);box(props,x,1.33,z,.75,.1,.66,0x738276,.03);box(props,x,1.08,z+.32,.39,.17,.015,0x243934);obstacles.push({x,z,w:.76,d:.66,h:1.4,tag:'bin'});}
  for(const x of [-30,14,40]){const lid=new THREE.Mesh(new THREE.CylinderGeometry(.32,.32,.012,24),material(0x565c59,.82));lid.position.set(x,.083,8.5);props.add(lid);for(let i=0;i<5;i++)box(props,x+(i-2)*.09,.093,8.5,.022,.007,.46,0x383f3c);}
  // Familiar black-and-white Toronto blades and the red Riverside district cap.
  const streetPole=new THREE.Group();streetPole.position.set(-17.2,0,-2.5);props.add(streetPole);
  rod(streetPole,new THREE.Vector3(),new THREE.Vector3(0,5.1,0),.052,0x7b8580);
  sign(streetPole,'Queen St E','',0,4.55,.04,2.55,.47,'#253335','#eeeade','sans-serif');
  sign(streetPole,'RIVERSIDE','',0,4.94,.04,1.85,.23,'#873b35','#eee0bf','sans-serif');
  sign(props,'Broadview Ave','',-30.2,4.5,-2.63,2.5,.43,'#253335','#eeeade','sans-serif');
  const eastBlade=sign(props,'De Grassi St','',20.75,4.15,13.48,2.50,.44,'#253335','#eeeade','sans-serif');eastBlade.rotation.y=.1;rod(props,new THREE.Vector3(20.75,0,13.42),new THREE.Vector3(20.75,4.43,13.42),.05,0x7b8580);
  // Street-level signs for discovery, rather than labels covering the whole screen.
  for(const [x,z,label] of [[-27.6,-2.98,'FRESH TODAY'],[5.3,-2.35,'COFFEE'],[14,-2.35,'BOOKS']] as [number,number,string][]){box(props,x,.65,z,1.0,1.3,.15,0x8b644f,.04);sign(props,label,'WELCOME IN',x,.78,z+.09,.87,.85,'#315c5d');obstacles.push({x,z,w:1.0,d:.18,h:1.35,tag:'shop sign'});}
  // Queen Street Viaduct: two steel trusses along the street and a west portal.
  box(ground,-45,-.12,3.5,14,.18,68,0x789598);box(ground,-45,.03,8.5,15,.38,13,0xa9aaa0);
  for(const z of [2,15]){for(let x=-52;x<-38;x+=2.7){rod(props,new THREE.Vector3(x,.3,z),new THREE.Vector3(x+2.7,6.6,z),.12,0x566e65);rod(props,new THREE.Vector3(x,6.6,z),new THREE.Vector3(x+2.7,.3,z),.12,0x566e65);rod(props,new THREE.Vector3(x,6.6,z),new THREE.Vector3(x+2.7,6.6,z),.15,0x566e65);rod(props,new THREE.Vector3(x,.3,z),new THREE.Vector3(x,6.6,z),.14,0x566e65);}
    rod(props,new THREE.Vector3(-52,1.1,z),new THREE.Vector3(-38,1.1,z),.055,0x6e7e74);
  }
  for(const x of [-51.8,-45,-38.5]){rod(props,new THREE.Vector3(x,6.65,2),new THREE.Vector3(x,6.65,15),.12,0x566e65);}
  const bridgeWords=sign(props,'THIS RIVER I STEP IN IS NOT THE RIVER I STAND IN','',-38.45,7.03,8.5,12.5,.43,'#6a7e70','#e0d9ba','sans-serif');bridgeWords.rotation.y=Math.PI/2;
  // Narrow passage, construction closure, snowbank: distinct physical obstacles.
  const gateZ=-17.8;
  for(const z of [gateZ-1.2,gateZ+1.2])box(props,0,1.5,z,.34,3,.24,0x416964,.07);box(props,0,3,gateZ,.38,.3,2.75,0x416964,.06);
  sign(props,'70 cm','NORTH PASSAGE',-.21,2.52,gateZ,1.25,.43,'#f6dcb2','#385953').rotation.y=-Math.PI/2;
  const gate=[{x:0,z:gateZ-1.2,w:.34,d:.24,h:3},{x:0,z:gateZ+1.2,w:.34,d:.24,h:3}];obstacles.push(...gate);
  for(const z of [.5,2.5,4.2]){box(works,0,.75,z,.25,1.5,.3,0xea724b,.03);box(works,0,1.05,z,1.1,.3,.35,0xffdf9e,.05);box(works,0,.13,z,.7,.2,.8,0x465b5c,.04);}
  box(works,0,1.05,2.5,.18,.37,4.6,0xeaa652,.03);for(let i=0;i<7;i++)box(works,.105,1.06,.35+i*.65,.025,.34,.27,0xec714d);
  sign(works,'SIDEWALK CLOSED','USE THE LANEWAY',-.14,1.8,2.5,2.3,.72,'#e9bd7d','#714c3b').rotation.y=-Math.PI/2;
  const worksBounds=[{x:0,z:2.5,w:.4,d:4.7,h:2.4}];
  for(let i=0;i<12;i++){const x=3.84+(i%3-1)*.65,z=19.3+Math.floor(i/3)*.85;orb(snowbank,x,.25,z,.95,.35+(i%2)*.3,1.0,PALETTE.snow);}
  const snowBounds=[{x:3.84,z:20.68,w:2.8,d:4.2,h:1.2}];
  box(snow,31,.14,24,28,.13,21,PALETTE.snow);for(let i=0;i<80;i++){const x=-38+random()*83,z=i%2?13.4+random()*.4:-2.8+random()*.4;orb(snow,x,.12,z,.4+random()*.8,.1+random()*.1,.35+random()*.3,PALETTE.snow);}
  // Playground and picnic table behind the park path.
  for(const x of [31,35])rod(props,new THREE.Vector3(x,0,26),new THREE.Vector3(x,3.5,26),.12,0xc78c61);rod(props,new THREE.Vector3(31,3.5,26),new THREE.Vector3(35,3.5,26),.14,0xc78c61);
  for(const x of [32.2,33.9]){for(const dx of [-.3,.3])rod(props,new THREE.Vector3(x+dx,3.45,26),new THREE.Vector3(x+dx,.85,26),.025,0x476362);box(props,x,.8,26,.8,.12,.45,0x467c78,.06);}
  const parkSign=sign(props,'Jimmie Simpson','A LITTLE ROOM TO BREATHE',23,2.2,17.5,4.7,1.05,'#497864');cameraOccluder(parkSign,0);for(const x of [21,25])box(props,x,1.1,17.4,.14,2.2,.14,0x497864);
  // Quiet paving variation provides scale without cluttering route markings.
  for(let x=-37;x<39;x+=2.6)for(let row=0;row<3;row++){const z=-2.1+row*2.4;box(ground,x,.125,z,2.56,.008,2.36,[0xb7b4aa,0xadafa6,0xbbbab1,0xb2b3a9][Math.floor(random()*4)]);}
  for(let x=23.3;x<31;x+=.9)for(let z=-15.4;z<-11;z+=.9)box(ground,x,.117,z,.875,.012,.875,[0xb9a994,0xc8b79c,0xd7bea0][Math.floor(random()*3)]);
  for(const [x,z] of [[31,-15.4],[31,-11.15]]){flowers(props,x,.49,z,1.20,1);box(props,x,.24,z,1.24,.48,.72,0xa87c61,.06);obstacles.push({x,z,w:1.3,d:.75,h:1.1,tag:'planter'});}
  // Park paths meet planted beds, allotments and a little picnic clearing.
  for(const [x,z] of [[-13,24],[-.8,24],[24,26],[29,30],[37,23]]){
    box(props,x,.21,z,2.6,.40,1.6,0xb09d7b,.06);box(props,x,.42,z,2.38,.03,1.4,0x69785a);flowers(props,x,.51,z,2.05,Math.round(x)%3);
    for(const dx of [-.9,.9])bud(props,x+dx,.64,z+.4,.43,.31,.34,0x73916b);
    obstacles.push({x,z,w:2.7,d:1.7,h:1.1,tag:'garden'});
  }
  for(const x of [-10.9,-2.9])for(let z=21.1;z<24.7;z+=.75)box(ground,x,.126,z,1.28,.012,.70,z<23?0xd9c09b:0xcab596,.025);
  // A connected garden, with worn walks and planted borders instead of loose grass triangles.
  const lawnMap=texture((c,w,h)=>{
    c.fillStyle='#7f9164';c.fillRect(0,0,w,h);
    for(let i=0;i<1600;i++){const x=random()*w,y=random()*h,r=4+random()*25;c.fillStyle=i%3?'rgba(99,115,70,.055)':'rgba(196,180,117,.12)';c.beginPath();c.ellipse(x,y,r,r*.7,0,0,Math.PI*2);c.fill();}
    for(let i=0;i<32000;i++){c.fillStyle=i%3?'rgba(56,80,50,.12)':'rgba(216,205,151,.22)';c.fillRect(random()*w,random()*h,.6+random()*1.3,1+random()*2.4);}
  },1024,1024);
  lawnMap.wrapS=lawnMap.wrapT=THREE.RepeatWrapping;lawnMap.repeat.set(5,2);
  const lawn=new THREE.Mesh(new THREE.PlaneGeometry(76,18.6),new THREE.MeshStandardMaterial({map:lawnMap,bumpMap:lawnMap,bumpScale:.025,roughness:1,color:0xd2d6bb}));lawn.rotation.x=-Math.PI/2;lawn.position.set(7,.115,32);lawn.receiveShadow=true;ground.add(lawn);
  function gardenWalk(points:number[][],width:number){
    const path=new THREE.CatmullRomCurve3(points.map(([x,z])=>new THREE.Vector3(x,.139,z)));const verts:number[]=[],uv:number[]=[];
    for(let i=0;i<48;i++){const a=path.getPoint(i/48),b=path.getPoint((i+1)/48),n=new THREE.Vector3(b.z-a.z,0,a.x-b.x).normalize().multiplyScalar(width/2);const aa=a.clone().add(n),ab=a.clone().sub(n),ba=b.clone().add(n),bb=b.clone().sub(n);for(const v of [aa,ab,ba,ab,bb,ba])verts.push(v.x,v.y,v.z);uv.push(0,i/12,1,i/12,0,(i+1)/12,1,i/12,1,(i+1)/12,0,(i+1)/12);}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.computeVertexNormals();const walk=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({map:asphalt,roughness:1,color:0xd3c5aa,side:THREE.DoubleSide}));walk.receiveShadow=true;ground.add(walk);
    for(const side of [-1,1]){const edge=Array.from({length:49},(_,i)=>{const p=path.getPoint(i/48),t=path.getTangent(i/48);return p.add(new THREE.Vector3(t.z,0,-t.x).multiplyScalar(side*(width/2+.04)));});const edging=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge),48,.045,5,false),material(0xaea98f));props.add(edging);}
  }
  gardenWalk([[22.7,22.75],[22.2,26.2],[26.3,32.2],[27.4,36.8],[27,40.8]],1.55);
  gardenWalk([[-26,37.4],[-11,37.8],[5,37.3],[19,37.5],[29,37.2],[43,36.8]],1.25);
  gardenWalk([[27.2,32.7],[32,30.6],[38,30.8],[42,33.4]],1.3);
  const plantShape=new THREE.Shape();plantShape.moveTo(0,0);plantShape.quadraticCurveTo(-.14,.16,0,.46);plantShape.quadraticCurveTo(.13,.20,0,0);const plantLeaf=new THREE.ShapeGeometry(plantShape,3);
  const plantMaterials=[0x587458,0x758457,0x839064].map(color=>new THREE.MeshStandardMaterial({color,roughness:.96,side:THREE.DoubleSide}));
  const petalGeometry=new THREE.CircleGeometry(1,8),petalMaterials=[0xc49e66,0xac817a].map(color=>new THREE.MeshStandardMaterial({color,roughness:.94,side:THREE.DoubleSide}));
  for(const [cx,cz,rx,rz] of [[-20,34,4,1.6],[-6,34.8,3.4,1.5],[11,32.6,3.0,2.0],[17.5,27.5,2.3,1.55],[35,34.1,4,1.35],[42,24.6,1.6,1.4]]){
    const bedShape=new THREE.Shape();const rim:THREE.Vector3[]=[];
    for(let i=0;i<=40;i++){const a=i/40*Math.PI*2,r=1+.08*Math.sin(a*3),x=Math.cos(a)*rx*r,z=Math.sin(a)*rz*r;if(i===0)bedShape.moveTo(x,-z);else bedShape.lineTo(x,-z);rim.push(new THREE.Vector3(cx+x,.16,cz+z));}
    const soil=new THREE.Mesh(new THREE.ShapeGeometry(bedShape),material(0x726b4e,.99));soil.rotation.x=-Math.PI/2;soil.position.set(cx,.151,cz);ground.add(soil);
    const border=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rim),64,.075,5,false),material(0x9b957e));props.add(border);
    for(let i=0;i<42;i++){const a=random()*Math.PI*2,r=Math.sqrt(random())*.83,x=cx+Math.cos(a)*rx*r,z=cz+Math.sin(a)*rz*r,base=.17,h=.25+random()*.40;
      for(let j=0;j<5;j++){const leaf=new THREE.Mesh(plantLeaf,plantMaterials[(i+j)%3]);leaf.position.set(x,base,z);leaf.rotation.set(.45+j*.14,j*1.25+i*.8,0);leaf.scale.setScalar(.6+h);props.add(leaf);}
      if(i%2===0){rod(props,new THREE.Vector3(x,base,z),new THREE.Vector3(x,h+.2,z),.009,0x566e4c);for(let j=0;j<5;j++){const a=j*Math.PI*.4,petal=new THREE.Mesh(petalGeometry,petalMaterials[i%4?0:1]);petal.position.set(x+Math.cos(a)*.068,h+.2,z+Math.sin(a)*.068);petal.rotation.x=-Math.PI/2;petal.scale.set(.058,.05,1);props.add(petal);}bud(props,x,h+.225,z,.035,.025,.035,0x746446);}
    }
  }
  const picnic=new THREE.Group();picnic.position.set(30,.08,30);picnic.rotation.y=-.2;
  for(let i=0;i<5;i++)box(picnic,0,.98,(i-2)*.18,2.7,.10,.16,0xc09870,.025);
  for(const side of [-1,1]){box(picnic,0,.55,side*.88,2.85,.10,.42,0xaf825e,.025);for(const x of [-.88,.88]){rod(picnic,new THREE.Vector3(x,.05,side*1.0),new THREE.Vector3(x,.95,-side*.32),.065,0x5b7771);}}
  box(picnic,.40,1.09,.1,.44,.14,.34,0xedcc9b,.03);box(picnic,.4,1.17,.1,.46,.025,.36,0xf4dab0);box(picnic,.4,1.185,.1,.04,.01,.37,0xc56f63);
  box(picnic,-.47,1.045,0,.73,.016,.83,0xb7766f);for(let i=0;i<4;i++)box(picnic,-.74+i*.17,1.058,0,.05,.007,.83,0xe1b9a0);
  props.add(picnic);obstacles.push({x:30,z:30,w:3.2,d:2.4,h:1.3,tag:'picnic'});
  const kiosk=new THREE.Group();kiosk.position.set(23.8,0,30.3);box(kiosk,0,.87,0,.12,1.74,.14,0x6b8476);box(kiosk,0,1.54,0,.93,.76,.50,0xd4ad7f,.05);box(kiosk,0,1.53,.27,.77,.55,.035,0x7b8070);for(let i=0;i<6;i++)box(kiosk,-.30+i*.115,1.49,.32,.082,.35+(i%3)*.05,.10,[0xc76d68,0x709b99,0xe8bd79][i%3]);const bookRoof=new THREE.Mesh(new THREE.ConeGeometry(.79,.47,4),material(0x597c70));bookRoof.rotation.y=Math.PI/4;bookRoof.scale.z=.70;bookRoof.position.y=2.12;kiosk.add(bookRoof);props.add(kiosk);obstacles.push({x:23.8,z:30.3,w:1.2,d:.8,h:2.4,tag:'library'});
  // Distant city fabric, including a soft CN Tower silhouette to the west.
  for(let i=0;i<58;i++){const x=-105+random()*215,z=i%2?-65-random()*40:65+random()*40,w=4+random()*7,h=9+random()*24;box(architecture,x,h/2,z,w,h,6+random()*5,[0x939fab,0xc3a1a1,0xb2a6a8,0x9da6a2][i%4]);for(let y=3;y<h;y+=3.3)box(props,x,y,z+(z<0?3.1:-3.1),w*.7,.22,.03,0xdac0ad);}
  const tower=new THREE.Group();tower.position.set(-83,0,60);rod(tower,new THREE.Vector3(),new THREE.Vector3(0,47,0),.52,0x92a3ad);orb(tower,0,35,0,2.7,.9,2.7,0x8298a4);orb(tower,0,36,0,2.0,.65,2.0,0xb2b0b3);rod(tower,new THREE.Vector3(0,47,0),new THREE.Vector3(0,57,0),.12,0xaeb1b7);architecture.add(tower);
  // A few original stylized neighbours give the street scale and life.
  function person(x:number,z:number,color:number,phase:number){const g=new THREE.Group(),limbs:THREE.Group[]=[];box(g,0,1.22,0,.58,.85,.42,color,.2);orb(g,0,1.98,0,.29,.35,.28,0xd8a27e);orb(g,0,2.14,-.025,.3,.22,.29,0x604d45);
    for(const side of [-1,1]){orb(g,side*.095,2.005,.257,.025,.038,.012,0x384649);orb(g,side*.17,1.91,.24,.045,.027,.018,0xd78670);}
    orb(g,0,1.96,.293,.038,.04,.04,0xd49c78);box(g,0,1.866,.268,.09,.019,.016,0x905f50,.008);
    box(g,0,1.6,.05,.46,.12,.49,0xe9c795,.05);box(g,.15,1.42,.245,.10,.34,.035,0xe9c795,.025);
mergeStatic(g);
    for(const side of [-1,1]){const leg=new THREE.Group();leg.position.set(side*.16,.89,0);box(leg,0,-.37,0,.21,.75,.22,0x4a616b,.07);box(leg,0,-.76,.09,.24,.15,.38,0xf1cfab,.07);g.add(leg);limbs.push(leg);const arm=new THREE.Group();arm.position.set(side*.39,1.49,0);box(arm,0,-.29,0,.19,.6,.22,color,.08);orb(arm,0,-.65,0,.12,.13,.12,0xd8a27e);g.add(arm);limbs.push(arm);}g.position.set(x,0,z);people.push({group:g,limbs,x,z,phase,greetUntil:0,nextGreeting:0});group.add(g);cameraOccluder(g,0,true);return g;}
  person(-9,1.9,0xc56869,0);person(11,13.9,0x587e99,2.1);person(34,3,0xd69b54,4.5);const recipient=person(28.9,-11.05,0x8b9e64,1);recipient.rotation.y=Math.PI;
  // Small halos are visible only for the nearest detail.
  for(const fact of factsForDay(0)){const [x,z]=worldPoint(fact.position),g=new THREE.Group();const ring=new THREE.Mesh(new THREE.TorusGeometry(.48,.04,8,32),new THREE.MeshBasicMaterial({color:0xffe5ac,transparent:true,opacity:.95,depthTest:true,depthWrite:false}));ring.rotation.x=-Math.PI/2;g.add(ring);g.position.set(x,.2,z);g.visible=false;group.add(g);markers.set(fact.id,g);}
  // Cloud forms are far above gameplay, merged into the scenery.
  for(let i=0;i<18;i++){const x=-100+random()*200,z=-50+random()*140,y=37+random()*14;for(let j=0;j<3;j++){const m=orb(props,x+j*5,y+(j%2),z,7,1.1+j*.3,3.2,0xf6d9cb);m.castShadow=false;}}
  for(const g of [ground,architecture,props,snow,works,snowbank,autumn])mergeStatic(g);
  ground.traverse(o=>{if(o instanceof THREE.Mesh)o.castShadow=false;});
  const tram=makeTram();tram.position.set(-10,.16,9.9);group.add(tram);
  const skyMat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{top:{value:new THREE.Color(0x719bc1)},bottom:{value:new THREE.Color(0xf3c7b1)}},vertexShader:'varying vec3 vWorld; void main(){vWorld=(modelMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'varying vec3 vWorld; uniform vec3 top; uniform vec3 bottom; void main(){float h=clamp(normalize(vWorld).y*.85+.12,0.0,1.0);vec3 col=mix(bottom,top,pow(h,.6));float sun=pow(max(0.0,dot(normalize(vWorld),normalize(vec3(-.5,.32,.7)))),300.0);col+=vec3(1.0,.7,.36)*sun*.65;gl_FragColor=vec4(col,1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'});
  const sky=new THREE.Mesh(new THREE.SphereGeometry(260,32,20),skyMat);group.add(sky);
  const leafPositions=new Float32Array(38*3);for(let i=0;i<38;i++){leafPositions[i*3]=(random()-.5)*36;leafPositions[i*3+1]=random()*10;leafPositions[i*3+2]=(random()-.5)*36;}const leafGeo=new THREE.BufferGeometry();leafGeo.setAttribute('position',new THREE.BufferAttribute(leafPositions,3));const leafMap=texture((c,w,h)=>{c.clearRect(0,0,w,h);c.fillStyle='#ffffff';c.beginPath();c.moveTo(w*.5,h*.03);c.lineTo(w*.62,h*.3);c.lineTo(w*.85,h*.2);c.lineTo(w*.79,h*.46);c.lineTo(w*.98,h*.53);c.lineTo(w*.61,h*.76);c.lineTo(w*.5,h*.98);c.lineTo(w*.43,h*.74);c.lineTo(w*.05,h*.54);c.lineTo(w*.22,h*.42);c.lineTo(w*.13,h*.19);c.lineTo(w*.39,h*.31);c.closePath();c.fill();},64,64);
  const leaves=new THREE.Points(leafGeo,new THREE.PointsMaterial({size:.25,color:0xebb57b,map:leafMap,alphaTest:.3,transparent:true,depthWrite:false}));leaves.frustumCulled=false;group.add(leaves);
  return {cameraOccluders,group,snow,autumn,works,snowbank,obstacles,gate,worksBounds,snowBounds,tram,people,markers,recipient,sky,sunUniform:skyMat.uniforms.top,leaves,leafPositions};
}
export function makeCart(){
  const group=new THREE.Group(),body=new THREE.Group(),wheels:THREE.Group[]=[];
  box(body,0,.49,0,2.45,.45,1.65,0xc8905f,.12);box(body,0,.74,0,2.55,.16,1.76,0xf0c891,.06);
  for(const x of [-1.22,1.22])for(const z of [-.57,.57]){
    const wheel=new THREE.Group();wheel.position.set(x,.26,z);
    const tire=new THREE.Mesh(new THREE.CylinderGeometry(.23,.23,.17,20),material(0x344b4c));tire.rotation.z=Math.PI/2;wheel.add(tire);
    for(const side of [-1,1]){const hub=new THREE.Mesh(new THREE.CylinderGeometry(.12,.12,.02,16),material(0xe8c79c));hub.rotation.z=Math.PI/2;hub.position.x=side*.095;wheel.add(hub);box(wheel,side*.11,0,0,.02,.16,.035,0x547573,.01);}
    mergeStatic(wheel);group.add(wheel);wheels.push(wheel);
  }
  for(const x of [-.7,.65]){box(body,x,.94,0,.96,.27,1.18,0xf2ce99,.035);box(body,x,1.085,0,1.02,.06,1.23,0xffe2ad,.02);box(body,x,1.122,0,.065,.015,1.24,0xd75e4b);}
  rod(body,new THREE.Vector3(0,.5,.9),new THREE.Vector3(0,.5,1.8),.045,0x557674);mergeStatic(body);group.add(body);const shadowMap=texture((c,w,h)=>{const gradient=c.createRadialGradient(w/2,h/2,0,w/2,h/2,w/2);gradient.addColorStop(0,'rgba(22,42,48,.45)');gradient.addColorStop(.5,'rgba(22,42,48,.3)');gradient.addColorStop(1,'rgba(22,42,48,0)');c.fillStyle=gradient;c.fillRect(0,0,w,h);},128,128);
  const contact=new THREE.Mesh(new THREE.PlaneGeometry(3.4,2.5),new THREE.MeshBasicMaterial({map:shadowMap,transparent:true,depthWrite:false}));contact.rotation.x=-Math.PI/2;contact.position.y=.015;group.add(contact);
  group.userData.wheels=wheels;return group;
}
export const TRAM_LENGTH=18.4;
export function makeTram(){
  const group=new THREE.Group();
  // Five connected modules, a black window ribbon, white roof and low red skirt.
  const modules=[[-7.1,4.0],[-3.55,2.55],[0,3.8],[3.55,2.55],[7.1,4.0]];
  for(const [x,w] of modules){
    box(group,x,1.45,0,w,2.5,2.50,0xd2d1c6,.20);box(group,x,.68,0,w+.03,.81,2.56,0xb73f39,.08);
    box(group,x,2.78,0,w-.12,.21,2.44,0xdbdcd4,.08);
    for(const side of [-1,1]){box(group,x,1.98,side*1.265,w-.12,1.03,.045,0x243e47,.025);box(group,x,1.40,side*1.29,w-.14,.11,.032,0xefe9d7);
      const door=x+(x>0?-.65:.65);if(w>3)for(const dx of [-.28,.28]){box(group,door+dx,1.42,side*1.3,.49,1.80,.04,0x333f41,.02);box(group,door+dx,1.72,side*1.327,.38,.85,.016,0x596c6d);box(group,door+dx,1.42,side*1.337,.40,.035,.016,0xe5bf62);}
      for(let xx=x-w/2+.5;xx<x+w/2;xx+=1.05)box(group,xx,2.0,side*1.294,.053,.98,.025,0x647372);
    }
  }
  for(const x of [-4.98,-2.12,2.12,4.98])for(let i=0;i<6;i++)box(group,x+(i-2.5)*.07,1.5,0,.04,2.28,2.46,i%2?0x777b75:0x454c49,.012);
  for(const x of [-6.8,0,6.8]){box(group,x,.26,0,1.25,.50,2.04,0x373f3d,.05);box(group,x,2.95,0,1.6,.18,1.60,0x7d8781,.035);}
  for(const side of [-1,1]){box(group,side*9.12,1.94,0,.12,1.08,1.97,0x223d43,.07);for(const z of [-.82,.82])orb(group,side*9.20,.85,z,.026,.08,.13,side>0?0xeedda9:0xb7463c);}
  sign(group,'501  QUEEN','',9.195,2.48,0,1.68,.26,'#1d2c2d','#e6b35e','sans-serif').rotation.y=Math.PI/2;
  const fleet=sign(group,'4450','',7.95,.88,1.31,.52,.22,'#b73f39','#f4ead3','sans-serif');fleet.renderOrder=1;
  for(const z of [-.48,.48]){rod(group,new THREE.Vector3(-1,3.1,z),new THREE.Vector3(.8,5.6,z),.043,0x505955);rod(group,new THREE.Vector3(.8,5.6,z),new THREE.Vector3(-.3,8.11,z),.043,0x505955);}
  box(group,-.3,8.12,0,.16,.09,1.3,0x48534f);mergeStatic(group);return group;
}
