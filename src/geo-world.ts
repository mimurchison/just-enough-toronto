import {rigidBuilding} from './building-ground';
import {TessellateModifier} from 'three/addons/modifiers/TessellateModifier.js';
import {drapeStatic} from './terrain-geometry';
import {groundHeight} from './terrain';
import * as T from 'three';
import {buildDistantCity} from './distant-city';
import {buildNeighbourhoodBackdrop} from './neighbourhood-backdrop';
import {GEO,RENDER_BUILDINGS,START,inside,queenZ,segmentDistance} from './geography';
import type {GeoBuilding} from './geography';
import {box,orb,rod,sign,material,mergeStatic,prepareMerge,makeTram} from './world';
import type {World} from './world';
import {GRAPHICS,type LevelOfDetail} from './render-quality';
import {architecturalMaterials,buildLandmarkArchitecture} from './architecture';
import {SURFACES} from './surfaces';
import {buildDonBridge,DON_BRIDGE} from './don-bridge';
import {STREET} from './street-data';
import {elevation} from './street-data';
import frontages from './data/frontages.json';
import {buildStreetArchitecture} from './street-architecture';
import {buildOrthophoto} from './orthophoto';
import {buildHeritage,HERITAGE_HEIGHTS,AUTHORED_HERITAGE} from './heritage';
import {buildRiverArchitecture,RIVER_AUTHORED} from './river-architecture';
import {buildVideoArchitecture} from './video-architecture';
import {addFallenLeaves} from './foliage';
import {makePastelSky} from './pastel-style';
import {buildOntarioLine} from './ontario-line';
import {buildQueenVideoDetail} from './queen-video-detail';
import {buildVideoStreets} from './video-streets';
import {VIDEO_MASS_IDS,VIDEO_HEIGHTS,VIDEO_GROUND} from './video-data';
import {buildLaneway,lanewayConcrete,LANE} from './laneway';
import {buildLandscape} from './landscape';
import {buildParkedCar,PARKED_CAR_SIZE} from './street-vehicles';
import type {Obstacle} from './motion';
import type {Point} from './game';
import {factsForDay} from './game';

// The renderer consumes mapped geometry; it never scales or rearranges blocks.
const V=(x:number,y:number,z:number)=>new T.Vector3(x,y,z);
let seed=711;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
function texture(draw:(c:CanvasRenderingContext2D)=>void,w=512,h=512){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d')!);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;t.anisotropy=8;return t;}
function polygon(p:Point[],y:number,mat:T.Material,holes:Point[][]=[]){const shape=new T.Shape(p.map(v=>new T.Vector2(v[0],-v[1])));for(const h of holes)shape.holes.push(new T.Path(h.map(v=>new T.Vector2(v[0],-v[1]))));const basic=new T.ShapeGeometry(shape),geo=new TessellateModifier(6,12).modify(basic);basic.dispose();geo.rotateX(-Math.PI/2);geo.translate(0,y,0);const mesh=new T.Mesh(geo,mat);mesh.receiveShadow=true;return mesh;}
function wallShape(b:GeoBuilding,height:number){const shape=new T.Shape(b.p.map(v=>new T.Vector2(v[0],-v[1])));for(const h of b.holes)shape.holes.push(new T.Path(h.map(v=>new T.Vector2(v[0],-v[1]))));const g=new T.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false,steps:1,curveSegments:1});g.rotateX(-Math.PI/2);return g;}
function strip(parent:T.Group,path:Point[],width:number,y:number,mat:T.Material,offset=0){const p:Point[]=[path[0]];for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],steps=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/5);for(let k=1;k<=steps;k++)p.push([a[0]+(b[0]-a[0])*k/steps,a[1]+(b[1]-a[1])*k/steps]);}for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(!len)continue;const nx=-dz/len,nz=dx/len;const geom=new T.BufferGeometry();const h=width/2;const points=[[a[0]+nx*(offset-h),y,a[1]+nz*(offset-h)],[b[0]+nx*(offset-h),y,b[1]+nz*(offset-h)],[b[0]+nx*(offset+h),y,b[1]+nz*(offset+h)],[a[0]+nx*(offset+h),y,a[1]+nz*(offset+h)]];geom.setAttribute('position',new T.Float32BufferAttribute(points.flat(),3));geom.setAttribute('uv',new T.Float32BufferAttribute([0,0,len,0,len,width,0,width],2));geom.setIndex([0,2,1,0,3,2]);geom.computeVertexNormals();const m=new T.Mesh(geom,mat);m.receiveShadow=true;parent.add(m);}}
function clipped(p:Point[]){const result:Point[][]=[];for(let i=1;i<p.length;i++){let [x,z]=p[i-1];const dx=p[i][0]-x,dz=p[i][1]-z;let lo=0,hi=1;for(const [q,r] of [[-dx,x+960],[dx,980-x],[-dz,z+410],[dz,190-z]]){if(!q){if(r<0){hi=-1;break;}}else{const t=r/q;if(q<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);}}if(lo<=hi)result.push([[x+dx*lo,z+dz*lo],[x+dx*hi,z+dz*hi]]);}return result;}
function facadeFrame(parent:T.Group,a:Point,b:Point,p:Point[]){const g=new T.Group(),dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);let nx=-dz/len,nz=dx/len;if(inside([(a[0]+b[0])/2+nx*.1,(a[1]+b[1])/2+nz*.1],p)){nx=-nx;nz=-nz;}g.position.set((a[0]+b[0])/2,0,(a[1]+b[1])/2);g.rotation.y=Math.atan2(nx,nz);rigidBuilding(g,g.position.x,g.position.z);parent.add(g);return {g,len};}

/** Map tiles within this many metres of the player are always finished before they are seen. */
export const STREAM_RADIUS=260;
export function makeGeoWorld():World{
 seed=711;const masonry=architecturalMaterials();const group=new T.Group(),snow=new T.Group(),autumn=new T.Group(),works=new T.Group(),snowbank=new T.Group();group.add(autumn,snow,works,snowbank);
 const obstacles:Obstacle[]=[],gate:Obstacle[]=[],worksBounds:Obstacle[]=[],snowBounds:Obstacle[]=[],people:World['people']=[],markers=new Map<string,T.Group>();
 const tiles=new Map<string,T.Group>();const tile=(x:number,z:number)=>{const key=`${Math.floor(x/125)}:${Math.floor(z/125)}`;if(!tiles.has(key)){const g=new T.Group();g.name=`geographic tile ${key}`;g.userData.center=[Math.floor(x/125)*125+62.5,Math.floor(z/125)*125+62.5];tiles.set(key,g);group.add(g);}return tiles.get(key)!;};
 const detailTiles=new Map<string,T.Group>();const detail=(x:number,z:number)=>{const key=`${Math.floor(x/100)}:${Math.floor(z/100)}`;if(!detailTiles.has(key)){const g=new T.Group();g.userData.center=[Math.floor(x/100)*100+50,Math.floor(z/100)*100+50];detailTiles.set(key,g);group.add(g);}return detailTiles.get(key)!;};
 const farTiles=new Map<string,T.Group>();const farDetail=(x:number,z:number)=>{const key=`${Math.floor(x/100)}:${Math.floor(z/100)}`;if(!farTiles.has(key)){const g=new T.Group();g.userData.center=[Math.floor(x/100)*100+50,Math.floor(z/100)*100+50];farTiles.set(key,g);group.add(g);}return farTiles.get(key)!;};
 // Cheap facade LOD preserves distant windows; detail culling must not create blank monoliths.
 const distantMap=texture(c=>{c.fillStyle='#aa8c7a';c.fillRect(0,0,512,512);for(let y=0;y<512;y+=12){c.fillStyle='#88796f';c.fillRect(0,y,512,1);}c.fillStyle='#555b5b';c.fillRect(152,90,202,330);c.fillStyle='#778c92';c.fillRect(164,99,178,310);c.fillStyle='#929e9d';c.fillRect(164,99,178,92);c.fillStyle='#c0b8a7';c.fillRect(160,250,188,7);c.fillRect(249,100,7,308);c.fillRect(144,414,217,16);c.fillRect(145,75,215,16);});distantMap.wrapS=distantMap.wrapT=T.RepeatWrapping;const distantMat=new T.MeshStandardMaterial({map:distantMap,roughness:.88});
 const modernDistantMap=texture(c=>{c.fillStyle='#75878d';c.fillRect(0,0,512,512);c.fillStyle='#8b999b';c.fillRect(8,12,242,175);c.fillStyle='#3d4b51';c.fillRect(0,424,512,88);for(const x of [0,252,508]){c.fillStyle='#323b3f';c.fillRect(x,0,5,512);}c.fillRect(0,6,512,5);});modernDistantMap.wrapS=modernDistantMap.wrapT=T.RepeatWrapping;const modernDistantMat=new T.MeshStandardMaterial({map:modernDistantMap,roughness:.5,metalness:.2});
 const brickMats=[0xf3e3ce,0xe5cbae,0xdbb29c,0xebddd1,0xcfb5a0].map(color=>{const m=masonry.red.clone();m.color.setHex(color);return m;});
 const loadRoad=(kind:string,srgb=false)=>{const t=new T.TextureLoader().load(`/materials/road02-${kind}.jpg`);t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(1/3,1/3);t.anisotropy=8;if(srgb)t.colorSpace=T.SRGBColorSpace;return t;};
 // The video shows fine aggregate and isolated repairs, not a large black
 // crack repeating every three metres. Keep the scan's micro-normal/roughness
 // and use a restrained aggregate albedo; larger repairs are street geometry.

 const referenceAggregate=new T.TextureLoader().load('/materials/video/logan-asphalt.jpg');referenceAggregate.colorSpace=T.SRGBColorSpace;referenceAggregate.wrapS=referenceAggregate.wrapT=T.RepeatWrapping;referenceAggregate.repeat.set(.95,1.15);referenceAggregate.anisotropy=8;
 const roadMat=new T.MeshStandardMaterial({map:referenceAggregate,normalMap:loadRoad('normal'),normalScale:new T.Vector2(.30,.30),roughnessMap:loadRoad('roughness'),roughness:.68,color:0xb2b6b3,side:T.DoubleSide});

 roadMat.userData.streetSurface='asphalt';
 const paving=texture(c=>{c.fillStyle='#b6b6ae';c.fillRect(0,0,512,512);for(let y=0;y<512;y+=128)for(let x=0;x<512;x+=128){c.fillStyle=`hsl(48,4%,${68+rand()*2.5}%)`;c.fillRect(x+1,y+1,126,126);c.strokeStyle='#777a7544';c.lineWidth=1;c.strokeRect(x+1,y+1,126,126);}for(let i=0;i<76000;i++){c.fillStyle=i%3?'#43464415':'#f1ebdf14';c.fillRect(rand()*512,rand()*512,.35+rand()*.9,.35+rand()*.9);}for(let i=0;i<6;i++){let x=rand()*512,y=rand()*512;c.strokeStyle='#777b7536';c.lineWidth=.55;c.beginPath();c.moveTo(x,y);for(let k=0;k<5;k++){x+=rand()*14-5;y+=rand()*7-3;c.lineTo(x,y);}c.stroke();}});paving.wrapS=paving.wrapT=T.RepeatWrapping;paving.repeat.set(.22,.22);const paveMat=new T.MeshStandardMaterial({map:paving,color:0x9d9e94,roughness:.97,side:T.DoubleSide});
 paveMat.userData.streetSurface='paving';
 const lawn=texture(c=>{c.fillStyle='#777d51';c.fillRect(0,0,512,512);for(let i=0;i<45000;i++){c.strokeStyle=`hsla(${65+rand()*25},${12+rand()*20}%,${25+rand()*30}%,.45)`;const x=rand()*512,y=rand()*512;c.beginPath();c.moveTo(x,y);c.lineTo(x+rand()*3-1,y-rand()*6);c.stroke();}});lawn.wrapS=lawn.wrapT=T.RepeatWrapping;lawn.repeat.set(.15,.15);const grassMat=new T.MeshStandardMaterial({map:lawn,color:0xafb693,roughness:1,side:T.DoubleSide});
 const glassMap=texture(c=>{const g=c.createLinearGradient(0,0,0,512);g.addColorStop(0,'#83979c');g.addColorStop(.38,'#6e8288');g.addColorStop(.65,'#485b60');g.addColorStop(1,'#314044');c.fillStyle=g;c.fillRect(0,0,512,512);for(let k=0;k<7;k++){c.fillStyle=['#a4b0ad1a','#192d321a','#d3c8a014'][k%3];c.fillRect(k*84-20,230+(k%3)*40,60,282);}c.fillStyle='#c6cec71a';c.fillRect(22,0,22,512);});const glass=new T.MeshStandardMaterial({map:glassMap,roughness:.3,metalness:.2,color:0xe9efed,emissive:0x52676e,emissiveIntensity:.10});
 const brickTints:Record<string,number>={'red':0xdba28e,'dark red':0xa5796b,'brown':0xb5a28e,'beige':0xf2e2bd,'yellow':0xf7dea1,'grey':0xb4b4ac,'gray':0xb4b4ac,'white':0xf0eee3,'black':0x64656a};
 const mappedMaterials=new Map<string,T.Material>();
 function buildingMaterial(b:GeoBuilding,modern:boolean){const value=String(b.osm?.['building:colour']||'');if(!value&&!modern)return brickMats[b.id%brickMats.length];const key=value+'/'+modern;if(!mappedMaterials.has(key)){let color=brickTints[value]||0xb7bcbb;if(/^#[0-9a-f]{6}$/i.test(value))color=parseInt(value.slice(1),16);if(modern&&value==='black')color=0x424a4c;mappedMaterials.set(key,new T.MeshStandardMaterial({color,roughness:modern?.62:.89,metalness:modern?.24:0,map:modern?null:masonry.red.map,normalMap:modern?null:masonry.red.normalMap,normalScale:new T.Vector2(.42,.42),roughnessMap:modern?null:masonry.red.roughnessMap}));}return mappedMaterials.get(key)!;}

 function terrainBase(parent:T.Group,x:number,y:number,z:number,w:number,h:number,d:number,color:number){const mesh=new T.Mesh(new T.BoxGeometry(w,h,d,Math.ceil(w/12),1,Math.ceil(d/12)),material(color));mesh.position.set(x,y,z);mesh.receiveShadow=true;parent.add(mesh);}
 const ground=tile(-50,0);terrainBase(ground,-200,-8.1,-90,1700,.2,900,0x706e59);
 // Valley is recessed; approach decks and street level share one zero datum.
 for(const [x,w] of [[-902,196],[193,1574]])terrainBase(tile(x,100),x,-1,-90,w,.4,900,0x999b96);
 terrainBase(tile(-690,100),-694,-6.2,-90,210,.3,900,0x717754);

 buildOrthophoto(group);group.add(buildDistantCity(),buildNeighbourhoodBackdrop());
 // The new walks show living lawn around the park paths. Use the clipped
 // green polygons, which exclude paved paths and the recreation centre.
 // Aerial pixels alone made this ground look like blurred painted pavement.
 for(const a of SURFACES.green.filter(a=>a.id===24399322))tile(...a.p[0]).add(polygon(a.p,.012,grassMat,a.holes));
 for(const a of GEO.areas){if(a.kind==='river'||a.kind==='water'){const m=polygon(a.p,-5.9,new T.MeshStandardMaterial({color:0x526f70,metalness:.38,roughness:.27,side:T.DoubleSide}));tile(-690,0).add(m);continue;}if(a.kind==='pitch'){const g=tile(...a.p[0]);g.add(polygon(a.p,.018,material(a.sport==='tennis'?0x567877:a.sport==='basketball'?0x797c7b:0x829368)));strip(g,[...a.p,a.p[0]],.11,.025,material(0xd9dad0));}}
 // Surveyed City surface boundaries replace guessed centreline buffers. Roads,
 // sidewalks, lanes and parking keep their actual intersections and holes.
 const laneMat=lanewayConcrete();
 for(const s of [...SURFACES.surfaces,...STREET.surfaces]){const centre:Point=[s.p.reduce((v,p)=>v+p[0],0)/s.p.length,s.p.reduce((v,p)=>v+p[1],0)/s.p.length];const lower=centre[0]>-804&&centre[0]<-594&&Math.abs(centre[1]-queenZ(centre[0]))>14&&s.id!==22899?-5.5:0;tile(...centre).add(polygon(s.p,lower+(s.kind==='sidewalk'?.055:s.kind==='parking'?.018:.025),s.id===LANE.surface?laneMat:s.kind==='sidewalk'?paveMat:roadMat,s.holes));}
 for(const p of SURFACES.curbs){const c=p[Math.floor(p.length/2)];if(c[0]>-804&&c[0]<-594&&Math.abs(c[1]-queenZ(c[0]))>14)continue;strip(tile(...c),p,.13,.075,material(0xaaa79f));}
 // Retain mapped park paths absent from the City's sidewalk product.
 for(const s of SURFACES.supplementalPaths){const c=s.p[0],lower=c[0]>-804&&c[0]<-594&&Math.abs(c[1]-queenZ(c[0]))>14?-5.5:0;tile(...c).add(polygon(s.p,.055+lower,paveMat,s.holes));}
 const soil=texture(c=>{c.fillStyle='#635d45';c.fillRect(0,0,512,512);for(let i=0;i<21000;i++){c.fillStyle=['#393b2a66','#96907855','#77694777'][i%3];c.fillRect(rand()*512,rand()*512,2+rand()*5,1+rand()*4);}});soil.wrapS=soil.wrapT=T.RepeatWrapping;soil.repeat.set(.65,.65);const soilMat=new T.MeshStandardMaterial({map:soil,roughness:1});
 const propertyById=new Map(STREET.units.map(u=>[u.id,u]));
 const gravel=texture(c=>{c.fillStyle='#cbc9bf';c.fillRect(0,0,512,512);for(let i=0;i<22000;i++){c.fillStyle=['#f1eee3','#b1b3ad','#deddd4','#8c918b'][i%4];c.fillRect(rand()*512,rand()*512,2+rand()*3,2+rand()*3);}});gravel.wrapS=gravel.wrapT=T.RepeatWrapping;gravel.repeat.set(.8,.8);const gravelMat=new T.MeshStandardMaterial({map:gravel,roughness:1}),slate=paveMat.clone();slate.color.setHex(0x555c5a);
 for(const y of frontages.yards){const u=propertyById.get(y.id)!,end=u.address==='12 De Grassi St';tile(...u.front).add(polygon(y.p as Point[],y.kind==='entry'?.058:.022,end?(y.kind==='entry'?slate:gravelMat):y.kind==='entry'?paveMat:elevation(u).garden?soilMat:grassMat,y.holes as Point[][]));}
 // Elevation-zero bridge deck is independent of the valley floor.
 const bridgeZ=queenZ(-690);box(tile(-690,0),-699,-.39,bridgeZ,211,.7,21.3,0x9c9d95);
 // The railway east of De Grassi crosses OVER Queen. Rails do not run through the park at ground level.
 for(const r of GEO.rails){if(r.kind==='tram')continue;for(const p of clipped(r.p)){if(p[0][0]<-500)continue;const shifted=p.map(q=>[q[0]+10,q[1]] as Point),g=tile(...shifted[0]);strip(g,shifted,4.4,6.0,material(0x827a67));for(const off of [-.72,.72])strip(g,shifted,.08,6.09,material(0x757e7d),off);}}
 // Concrete track slab observed in the 2025 Queen/Saulter streetscape.
 // Mapped carriageway boundaries remain asphalt outside this central rail bed.
 const trackMat=new T.MeshStandardMaterial({map:paving,color:0xaca597,roughness:.72,side:T.DoubleSide});
 trackMat.userData.streetSurface='paving';
 for(let x=-918;x<535;x+=25){const end=Math.min(535,x+25);strip(tile(x,0),[[x,queenZ(x)],[end,queenZ(end)]],6.24,.034,trackMat);}
 for(let x=-918;x<535;x+=5.5)strip(detail(x,0),[[x,queenZ(x)-3.12],[x,queenZ(x)+3.12]],.018,.036,material(0x6c726d));
 for(const off of [-2.3,-.805,.805,2.3]){for(let x=-922;x<948;x+=40){const p:Point[]=[[x,queenZ(x)],[x+40,queenZ(x+40)]];strip(tile(x,0),p,.065,.041,material(0x929c9e),off);strip(tile(x,0),p,.022,.043,material(0x454e50),off+.057);}}
 for(let x=-910;x<930;x+=6)strip(tile(x,0),[[x,queenZ(x)],[x+2.7,queenZ(x+2.7)]],.09,.045,material(0xc7b771));
 // Crosswalks are attached to real named junctions.
 const junctions=new Map<string,{p:Point;side:number}>();for(const r of GEO.roads.filter(r=>r.name&&r.name!=='Queen Street East'&&['secondary','tertiary','residential'].includes(r.kind))){for(const p of r.p)if(Math.abs(p[1]-queenZ(p[0]))<1.2&&p[0]>-910&&p[0]<545)junctions.set(r.name,{p,side:r.p.reduce((sum,q)=>sum+q[1],0)/r.p.length<p[1]?-1:1});}
 for(const [name,{p,side}] of junctions){const g=tile(...p);if(name!=='Logan Avenue')for(const dx of [-7,7]){strip(g,[[p[0]+dx,p[1]-5.3],[p[0]+dx,p[1]+5.3]],.35,.047,material(0xe1dfcf));}const signZ=p[1]+side*(name==='De Grassi Street'?7.5:6.7);const pole=box(g,p[0]+6,2.4,signZ,.10,4.8,.10,0x828a88);void pole;if(name==='De Grassi Street')obstacles.push({x:p[0]+6,z:signZ,w:.15,d:.15,h:4.8,tag:'De Grassi street-sign pole'});const s=sign(g,name.replace('Street','St').replace('Avenue','Ave'),'',p[0]+6,4.2,signZ,1.48,.30,'#255777','#f0f1e4','Arial');s.rotation.y=.0;}
 // Yellow Ontario signal heads identify the major Queen junctions.
 for(const [name,{p}] of junctions){if(!['River Street','Broadview Avenue','Carlaw Avenue'].includes(name))continue;const g=detail(...p);for(const side of [-1,1]){const x=p[0]+side*7,z=p[1]+side*6.3;rod(g,V(x,0,z),V(x,5.5,z),.085,0x707d7d);rod(g,V(x,5.4,z),V(x,5.4,z-side*2.1),.05,0x707d7d);const head=new T.Group();head.position.set(x,4.86,z-side*2.1);head.rotation.y=side>0?Math.PI/2:-Math.PI/2;g.add(head);box(head,0,0,0,.32,1.08,.20,0xc4a745);box(head,0,0,.105,.26,.98,.04,0x333d3d);for(let k=0;k<3;k++){const y=.32-k*.32,disc=new T.Mesh(new T.CircleGeometry(.095,16),material(k===2?0x43886e:k===0?0x632f27:0x706140));disc.position.set(0,y,.133);head.add(disc);const hood=new T.Mesh(new T.CylinderGeometry(.11,.11,.16,12,1,true,0,Math.PI),material(0x404b49));hood.rotation.x=Math.PI/2;hood.position.set(0,y,.20);head.add(hood);}}}
 // Building volumes are the actual City polygons. Heights are City-derived roof envelopes.
 for(const b of GEO.buildings.filter(b=>b.id!==4372210))obstacles.push({x:(b.bounds[0]+b.bounds[2])/2,z:(b.bounds[1]+b.bounds[3])/2,w:b.bounds[2]-b.bounds[0],d:b.bounds[3]-b.bounds[1],h:VIDEO_HEIGHTS[b.id]??b.h,p:b.p,holes:b.holes,tag:'building'});
 for(const b of [...STREET.north,...STREET.units.filter(u=>u.bounds[1]<-375)])obstacles.push({x:(b.bounds[0]+b.bounds[2])/2,z:(b.bounds[1]+b.bounds[3])/2,w:b.bounds[2]-b.bounds[0],d:b.bounds[3]-b.bounds[1],h:VIDEO_HEIGHTS[b.id]??b.h,p:b.p,holes:b.holes,tag:'building'});
 for(const [name,b] of Object.entries(VIDEO_GROUND)){const xs=b.p.map(p=>p[0]),zs=b.p.map(p=>p[1]);obstacles.push({x:(Math.min(...xs)+Math.max(...xs))/2,z:(Math.min(...zs)+Math.max(...zs))/2,w:Math.max(...xs)-Math.min(...xs),d:Math.max(...zs)-Math.min(...zs),h:b.h,p:b.p,tag:`video-corrected ${name} ground footprint`});}
 // Remove each parcel-authored frontage from its former union. Apply this once
 // per source building, never once per roof part (which would duplicate it).
 const background=GEO.buildings.flatMap(b=>Object.hasOwn(STREET.remainders,String(b.id))?STREET.remainders[String(b.id)].map(p=>({...b,...p})):RENDER_BUILDINGS.filter(part=>part.id===b.id));
 for(const b of background){if(VIDEO_MASS_IDS.has(b.id)||RIVER_AUTHORED.has(b.id))continue;const cx=(b.bounds[0]+b.bounds[2])/2,cz=(b.bounds[1]+b.bounds[3])/2,g=rigidBuilding(new T.Group(),cx,cz);tile(cx,cz).add(g);let height=HERITAGE_HEIGHTS[b.id]??b.h;
  if(b.landmarks?.includes('bonjour'))height=7.94;if(b.landmarks?.includes('broadview'))height=18.6;if(b.landmarks?.includes('amber'))height=12.8;if(b.landmarks?.includes('mercury'))height=8.9;if(b.landmarks?.includes('dark-horse'))height=14.6;
  // OSM floor counts correct an attached row inheriting a neighbouring tower's
  // City roof maximum. Retain higher mapped buildings such as 875 Queen E.
  const mappedLevels=Number(b.osm?.['building:levels']);
  if(!b.landmarks&&mappedLevels>0&&mappedLevels<=4&&height>mappedLevels*4.4)height=mappedLevels*3.3+1.1;
  const modern=String(b.osm?.['building:material'])==='metal'||String(b.osm?.['building:material'])==='glass'||((b.osm?.building==='apartments'||Number(b.osm?.['building:levels'])>=8)&&b.h>20);
  const residential=!modern&&!b.landmarks&&b.bounds[1]<-35&&b.bounds[2]-b.bounds[0]<15&&b.bounds[3]-b.bounds[1]<35&&b.h<14;
  if(b.id===4388300)height=3.35;
  if(residential)height=Math.max(4.7,height-1.8);
  const mat=b.id===4388300?material(0x999b87):[4420420,1846331].includes(b.id)?material(0xbeb8a3):b.landmarks?.includes('dark-horse')?masonry.cream:b.landmarks?.includes('jimmie')?material(0x64747c):b.landmarks?.some(k=>['bonjour','mercury','amber','broadview'].includes(k))?masonry.red:buildingMaterial(b,modern);
  const geo=wallShape(b,height);const uv=geo.getAttribute('uv'),pos=geo.getAttribute('position'),norm=geo.getAttribute('normal');for(let i=0;i<uv.count;i++)uv.setXY(i,(Math.abs(norm.getX(i))>.5?pos.getZ(i):pos.getX(i))/1.4,pos.getY(i)/1.4);const mesh=new T.Mesh(geo,mat);mesh.castShadow=true;mesh.receiveShadow=true;g.add(mesh);g.add(polygon(b.p,height+.025,material(0x696e6b),b.holes));
  const nearQueen=Math.min(Math.abs(b.bounds[1]),Math.abs(b.bounds[3]))<65;
  const hasNearDetail=!((!nearQueen&&b.bounds[1]<-165)||b.bounds[0]>700);
  if(b.id!==4388300)for(let i=0;i<b.p.length;i++){const a=b.p[i],end=b.p[(i+1)%b.p.length],length=Math.hypot(end[0]-a[0],end[1]-a[1]);if(length<3.5||height<4)continue;const center:Point=[(a[0]+end[0])/2,(a[1]+end[1])/2],f=facadeFrame(hasNearDetail?farDetail(...center):tile(...center),a,end,b.p).g,geo=new T.PlaneGeometry(length,height);const uv=geo.getAttribute('uv');for(let n=0;n<uv.count;n++)uv.setXY(n,uv.getX(n)*length/3.1,uv.getY(n)*height/3.12);const m=new T.Mesh(geo,modern?modernDistantMat:distantMat);m.position.set(0,height/2,.06);f.add(m);}
  if(AUTHORED_HERITAGE.has(b.id)||b.id===4388300)continue;
  if(!hasNearDetail)continue;
  if(residential){
   const bw=b.bounds[2]-b.bounds[0],bd=b.bounds[3]-b.bounds[1],cx=(b.bounds[0]+b.bounds[2])/2,cz=(b.bounds[1]+b.bounds[3])/2,rg=detail(cx,cz);
   const roof=new T.Shape();roof.moveTo(-bw/2-.17,0);roof.lineTo(0,1.8);roof.lineTo(bw/2+.17,0);roof.closePath();const roofGeo=new T.ExtrudeGeometry(roof,{depth:bd+.35,bevelEnabled:false,steps:1});const m=new T.Mesh(roofGeo,material(0x5e6060));m.position.set(cx,height,cz-bd/2-.17);m.castShadow=true;rigidBuilding(m,cx,cz);rg.add(m);rigidBuilding(box(rg,cx+bw*.24,height+1.2,cz-.2,.62,1.8,.70,0x9e7963),cx,cz);
  }
  for(let i=0;i<b.p.length;i++){const a=b.p[i],c=b.p[(i+1)%b.p.length],len=Math.hypot(c[0]-a[0],c[1]-a[1]);if(len<3.5)continue;const mid:Point=[(a[0]+c[0])/2,(a[1]+c[1])/2];if(Math.abs(mid[1])>120&&!b.landmarks)continue;
   const {g:f}=facadeFrame(detail(...mid),a,c,b.p),front=Math.abs(mid[1]-queenZ(mid[0]))<22&&Math.abs(a[1]-c[1])<len*.3;
   if(b.id===4418820&&front&&mid[0]>-544)continue;
   if(b.landmarks?.some(k=>k==='dark-horse'||k==='broadview'||((k==='bonjour'||k==='mercury')&&front)))continue;
   if(b.landmarks?.includes('amber')&&mid[0]>-64)continue;
   // Modern River City and mapped metal/glass buildings use curtain-wall bays,
   // dark spandrels and projecting balconies, not the Victorian brick kit.
   if(modern){
    const count=Math.max(1,Math.round(len/3.1)),bay=len/count;
    for(let y=1.8;y<height-1;y+=3.12){box(f,0,y+1.43,.09,len,.15,.2,0x30383b);for(let k=0;k<count;k++){const x=(k+.5)*bay-len/2,pane=box(f,x,y,.06,bay-.22,2.54,.07,0xffffff);pane.material=glass;box(f,x,y,.15,.055,2.6,.06,0x535b5d);box(f,x-bay/2+.08,y,.12,.11,2.95,.12,0x3a4245);if(len>18&&y>5&&k%3!==2){box(f,x,y-1.26,.72,bay-.12,.13,1.5,0x4a5152);const bal=box(f,x,y-.77,1.42,bay-.16,.87,.055,0xffffff);bal.material=glass;box(f,x,y-.29,1.45,bay-.06,.035,.055,0x8d9695);}}}
    continue;
   }
   // Recess shadows, sills, lintels, mullions and parapets give the street real depth.
   if(residential&&len<14&&len>4){const nearStreet=GEO.roads.some(r=>r.kind==='residential'&&r.p.some((p,k)=>k>0&&segmentDistance(mid,r.p[k-1],p)<7));if(nearStreet){box(f,0,.35,1.0,len*.7,.12,1.65,0xa8a293);const porch=box(f,0,2.8,.85,len*.75,.13,2.1,0x6d7270);porch.rotation.x=.12;for(const x of [-len*.31,len*.31])box(f,x,1.53,1.6,.10,2.45,.10,0xc5c3ae);for(const x of [-len*.31,len*.31])for(let z=.35;z<1.65;z+=.17)box(f,x,.77,z,.05,.80,.05,0xc5c3ae);box(f,0,.11,1.8,1.3,.22,.45,0xbbb7a7);}}
   box(f,0,.25,.04,len,.5,.09,0x625e56);box(f,0,height-.15,.08,len,.22,.24,0xa69c8c);box(f,0,height+.08,.0,len+.06,.18,.30,0x85847b);
   if(b.landmarks?.some(k=>k==='jimmie'||k==='broadview'))continue;
   if(b.landmarks?.includes('dark-horse')){for(let y=7.5;y<height-1;y+=3.25)for(let x=-len/2+1.5;x<len/2;x+=3.0){const w=box(f,x,y,.08,2.1,2.45,.12,0xffffff);w.material=glass;box(f,x,y,.16,.055,2.45,.06,0x454f50);}continue;}
   const step=b.landmarks?.includes('dark-horse')?3.9:2.9;const count=Math.max(1,Math.floor(len/step));
   for(let k=0;k<count;k++){const x=(k+.5)*len/count-len/2;for(let y=front?5.3:2.3;y<height-1.1;y+=3.15){const w=Math.min(1.28,len/count*.57),h=1.8;box(f,x,y,.04,w+.22,h+.18,.13,0x494a45);const win=box(f,x,y,.13,w,h,.045,0xffffff);win.material=glass;box(f,x,y-h/2-.08,.19,w+.35,.15,.30,0xc6bca7);box(f,x,y+h/2+.09,.13,w+.3,.16,.22,0xbbae97);box(f,x,y,.18,.032,h,.035,0xc6c5b9);box(f,x,y+.08,.18,w,.055,.045,0xb5b5ab);}
   }
   if(front&&height<17){for(let x=-len/2+.22;x<len/2;x+=.48)box(f,x,height-.35,.12,.13,.18,.24,0xaaa18f);for(let y=3.8;y<height-1;y+=3.15)box(f,0,y,.03,len,.07,.085,0xa59d8b);}
   if(front&&!b.landmarks?.some(k=>['jimmie','bonjour','mercury','dark-horse','amber','queen-books','opera','broadview'].includes(k))){const bays=Math.max(1,Math.round(len/6.2));for(let k=0;k<bays;k++){const w=len/bays,x=-len/2+w*(k+.5);box(f,x,1.8,.045,w-.38,3.05,.15,0x383d3c);const pane=box(f,x-.38,1.85,.145,Math.max(.5,w-1.8),2.7,.04,0xffffff);pane.material=glass;box(f,x+w/2-.85,1.6,.18,.82,2.65,.045,0x455455);box(f,x+w/2-.85,1.58,.21,.06,2.65,.055,0x939789);box(f,x+w/2-1.1,1.25,.25,.025,.28,.04,0xd7d2ba);box(f,x,3.5,.2,w-.22,.45,.28,[0x3d514d,0xddd6c3,0x393e40,0x9c9282][(b.id+k)%4]);}}
  }
 }
 const streetKit=buildStreetArchitecture(tile,detail,farDetail,masonry,glass);
 buildHeritage(detail,masonry,glass,streetKit);
 const videoKit=buildVideoArchitecture(tile,detail,masonry,obstacles);
 buildQueenVideoDetail(detail,videoKit,masonry.red,obstacles);
 const ontario=buildOntarioLine(detail,obstacles,group);
 buildRiverArchitecture(tile,detail,videoKit,masonry.red,obstacles);
 buildVideoStreets(detail,videoKit,obstacles,roadMat);
 buildLaneway(detail,obstacles);
 // Named storefronts are explicitly authored from exterior references. Unverified shops are not named.
 function shop(x:number,z:number,yaw:number){const f=new T.Group();f.position.set(x,0,z);f.rotation.y=yaw;detail(x,z).add(f);return f;}
 function shopGlass(g:T.Group,x:number,y:number,w:number,h:number,depth=.22){const m=box(g,x,y,depth,w,h,.04,0xffffff);m.material=glass;for(const xx of [x-w/2,x+w/2])box(g,xx,y,depth+.03,.07,h+.08,.06,0x222d30);box(g,x,y-h/2,depth+.03,w,.09,.08,0x253031);}
 buildLandmarkArchitecture(detail,masonry,glass);
 for(const o of [
  {x:-16.6,z:-5.85,w:1.58,d:.34,h:1.15,tag:'Bonjour bicycle'},
  {x:-18.06,z:-6.15,w:.26,d:.26,h:1,tag:'Bonjour bollard'},
  {x:-17.72,z:-6.37,w:.76,d:.76,h:1.2,tag:'Bonjour planter'},
  {x:-12.22,z:-7.15,w:.66,d:.66,h:1.1,tag:'Bonjour planter'},
  {x:389.78,z:10.68,w:4.2,d:.45,h:.6,tag:'Mercury bench'},
  {x:395.5,z:25.2,w:.45,d:2.6,h:.6,tag:'Mercury bench'},
  {x:-62.21,z:-19.45,w:.45,d:4.2,h:.6,tag:'Amber bench'},
  {x:-62.21,z:-29.25,w:.45,d:2.8,h:.6,tag:'Amber bench'}
 ])obstacles.push(o);
 const book=shop(330,-8.42,0);box(book,0,1.65,.12,6.1,3.3,.16,0x2f566c);shopGlass(book,-1.1,1.65,3.25,2.8);shopGlass(book,2.05,1.45,1.0,2.9);sign(book,'QUEEN BOOKS','',0,3.38,.29,6,.56,'#2f566c','#efe7c8','Georgia');
 // Rec centre: sloping blue/grey cladding on its long diagonal east face.
 const rec=GEO.buildings.find(b=>b.landmarks?.includes('jimmie'))!;const rf=facadeFrame(tile(80,-55),[76.882,-9.738],[110.154,-96.135],rec.p).g;
 for(let x=-44;x<45;x+=.38)box(rf,x,7,.035,.045,9,.065,0x748088);for(let x=-40;x<43;x+=4){const m=box(rf,x,2.6,.15,3.3,2.5,.08,0xffffff);m.material=glass;}sign(rf,'JIMMIE SIMPSON','RECREATION CENTRE',22,4.5,.25,11,.8,'#52616b','#e1e4db','sans-serif');
 // Main span rebuilt from the documented seven-panel bridge and street-level reference.
 buildDonBridge(tile(-698,0),bridgeZ);
 for(const side of [-1,1])for(let k=0;k<=DON_BRIDGE.panels;k++)obstacles.push({x:DON_BRIDGE.start+k*DON_BRIDGE.length/DON_BRIDGE.panels,z:bridgeZ+side*DON_BRIDGE.halfRoad,w:.65,d:.49,h:DON_BRIDGE.top,tag:'bridge lattice column'});
 // Prevent stepping off the viaduct into the lower valley; the road remains continuous.
 for(const side of [-1,1]){const from=side<0?-817:-752.7,to=-621;obstacles.push({x:(from+to)/2,z:bridgeZ+side*10.15,w:to-from,d:.35,h:1.55,tag:'bridge railing'});}
 // Railway underpass immediately east of De Grassi.
 // Utility poles and catenary anchor the long Queen sightline at human scale.
 for(let x=-899;x<935;x+=32){const z=queenZ(x),g=detail(x,0);if(x<180||x>334)for(const s of [-1,1]){const px=x+(s>0?12:0);rod(g,V(px,0,z+s*7),V(px,8,z+s*7),.09,0x777f7b);rod(g,V(px,7.6,z+s*7),V(px+2.5,7.6,z+s*4.4),.045,0x676e68);box(g,px+2.4,7.57,z+s*4.4,.70,.13,.3,0xaaaead);}for(const s of [-1,1])rod(g,V(x,6.2,z+s*1.55),V(x+32,6.2,queenZ(x+32)+s*1.55),.013,0x434c4b);rod(g,V(x,7.6,z-7),V(x,6.2,z+1.55),.013,0x434c4b);}
 buildLandscape(tile,detail,obstacles,grassMat,paveMat);
 for(const a of GEO.areas.filter(a=>a.id===24399322))snow.add(polygon(a.p,.035,material(0xdce4e1)));
 // Park equipment follows mapped pitch footprints; nets and markings are geometric.
 for(const a of GEO.areas.filter(a=>a.kind==='pitch'&&a.p[0][0]>60&&a.p[0][0]<220)){
  const xs=a.p.map(p=>p[0]),zs=a.p.map(p=>p[1]),x=(Math.min(...xs)+Math.max(...xs))/2,z=(Math.min(...zs)+Math.max(...zs))/2,w=Math.max(...xs)-Math.min(...xs),d=Math.max(...zs)-Math.min(...zs),g=tile(x,z);
  if(a.sport==='tennis'){strip(g,[[x-w*.43,z],[x+w*.43,z]],.08,.04,material(0xe0dfd5));for(const xx of [x-w*.44,x+w*.44])rod(g,V(xx,0,z),V(xx,1.1,z),.035,0x374a44);for(let y=.2;y<1.08;y+=.10)rod(g,V(x-w*.44,y,z),V(x+w*.44,y,z),.006,0x414c43);for(let xx=x-w*.44;xx<x+w*.44;xx+=.15)rod(g,V(xx,.2,z),V(xx,1.08,z),.006,0x414c43);}
  if(a.sport==='basketball')for(const zz of [z-d*.45,z+d*.45]){rod(g,V(x,0,zz),V(x,3.25,zz),.065,0x737c78);box(g,x,3.0,zz,1.6,1,.10,0xd4d8cf);const hoop=new T.Mesh(new T.TorusGeometry(.23,.018,5,24),material(0xa26245));hoop.rotation.x=Math.PI/2;hoop.position.set(x,2.72,zz+(zz<z?.45:-.45));g.add(hoop);}
 }
 function bench(x:number,z:number,yaw=0){const g=new T.Group();g.position.set(x,0,z);g.rotation.y=yaw;detail(x,z).add(g);for(let i=0;i<4;i++){box(g,0,.46,i*.10-.15,1.65,.055,.07,0x967b54);box(g,0,.69+i*.095,-.24,1.65,.067,.045,0x967b54);}for(const xx of [-.61,.61]){box(g,xx,.23,0,.06,.46,.45,0x344d49);box(g,xx,.65,-.23,.055,.77,.06,0x344d49);}}
 for(const p of [[123,-16],[180,-22],[156,-87],[127,-99],[-585,-8],[-311,-6.7],[-91,-6.7],[345,8.1]] as Point[])bench(...p);
 const parking=[[-564,4.45],[-502,-4.45],[-444,4.45],[-390,4.45],[-300,-4.45],[-207,4.45],[-185,4.45],[-140,-4.45],[-96,4.45],[-30,4.45],[251,4.45],[289,-4.45],[315,4.45],[362,-4.45],[425,4.45],[453,-4.45]];
 for(const [i,p] of parking.entries()){buildParkedCar(detail(p[0],queenZ(p[0])+p[1]),p[0],queenZ(p[0])+p[1],[0x8a9698,0x454f59,0xc1beb1,0x6b777d,0x9d5249][i%5],p[1]<0);obstacles.push({x:p[0],z:queenZ(p[0])+p[1],...PARKED_CAR_SIZE,tag:'parked car'});}
 // Fictional delivery-day objects sit on real mapped paths.
 //A community event gate supplies the changing route condition. No works site.
 const wf=factsForDay(0).find(f=>f.id==='works')!.position;
 for(const dx of [-1.10,1.10])box(works,wf[0]+dx,.60,wf[1],.12,1.2,.12,0x566e66,.035);
 for(let x=-1.03;x<1.08;x+=.17)box(works,wf[0]+x,.53,wf[1],.075,.96,.06,0x738477,.02);
 for(const y of [.26,.85])box(works,wf[0],y,wf[1],2.25,.08,.08,0x566e66);
 sign(works,'GATHERING SETUP','Garden or park entrance',wf[0],.93,wf[1]+.06,1.60,.42,'#436c62','#fff0cc','Arial');
 worksBounds.push({x:wf[0],z:wf[1],w:2.3,d:.24,h:1.2,tag:'event gate'});
 const gp=factsForDay(0).find(f=>f.id==='gate')!.position;for(const dx of [-.43,.43]){box(tile(...gp),gp[0]+dx,.65,gp[1],.16,1.3,.16,0x535e58);gate.push({x:gp[0]+dx,z:gp[1],w:.16,d:.16,h:1.3,tag:'70 cm gate'});}obstacles.push(...gate);
 const sp=factsForDay(2).find(f=>f.id==='park')!.position;for(let i=0;i<9;i++)orb(snowbank,sp[0]+(i%3-1)*.72,.34,sp[1]+(Math.floor(i/3)-1)*.6,.70,.44,.60,0xe7eeee);snowBounds.push({x:sp[0],z:sp[1],w:3,d:2.5,h:.85,tag:'snowbank'});
 for(const fact of factsForDay(0)){const mark=new T.Group();mark.position.set(fact.position[0],.45,fact.position[1]);const m=new T.Mesh(new T.TorusGeometry(.23,.026,6,24),material(0xcfaa57));m.rotation.x=Math.PI/2;mark.add(m);group.add(mark);markers.set(fact.id,mark);}
 const recipient=new T.Group();recipient.position.set(94.0,0,-49.2);group.add(recipient);
 function person(x:number,z:number,color:number){const g=new T.Group(),limbs:T.Group[]=[];box(g,0,1.15,0,.41,.64,.25,color,.095);box(g,0,.85,0,.31,.17,.23,0x444b53,.065);orb(g,0,1.47,0,.065,.09,.07,0xbb9275);orb(g,0,1.63,0,.115,.15,.115,0xbb9275);orb(g,0,1.72,-.025,.12,.075,.12,0x544b40);orb(g,0,1.62,.115,.035,.025,.035,0xbb9275);mergeStatic(g);for(const [dx,y,len] of [[-.092,.90,.80],[.092,.90,.80],[-.23,1.36,.51],[.23,1.36,.51]]){const limb=new T.Group();limb.position.set(dx,y,0);const leg=y<1;box(limb,0,-len/2,0,leg?.14:.125,len,leg?.18:.135,leg?0x444b53:color,.045);if(leg)box(limb,0,-len,.045,.16,.11,.28,0x363a3e,.045);else orb(limb,0,-len-.045,.0,.06,.082,.064,0xbb9275);mergeStatic(limb);g.add(limb);limbs.push(limb);}g.position.set(x,0,z);group.add(g);people.push({group:g,limbs,x,z,phase:rand()*6,greetUntil:0,nextGreeting:0});}

 person(-872,51,0x65746b);person(-530,-8,0xb19a74);person(-22,-6.3,0x746778);person(94,-48.5,0x8a9a80);person(402,8.5,0x586c79);
 const tram=makeTram();tram.scale.set(30.2/18.4,1.2,1);tram.position.set(-600,.04,queenZ(-600)+1.55);group.add(tram);
 const {mesh:sky,top:sunUniform}=makePastelSky();group.add(sky);
 const leafPositions=new Float32Array(16*3);for(let i=0;i<16;i++){leafPositions[i*3]=(rand()-.5)*25;leafPositions[i*3+1]=rand()*8;leafPositions[i*3+2]=(rand()-.5)*25;}const leafG=new T.BufferGeometry();leafG.setAttribute('position',new T.BufferAttribute(leafPositions,3));const leaves=new T.Points(leafG,new T.PointsMaterial({color:0xbaa17e,size:.07}));group.add(leaves);

 //Only scatter on mapped pavement beside existing trees.
 const leafSites:Point[]=STREET.objects['city-trees'].map(t=>t.p).filter(p=>Math.abs(p[1]-queenZ(p[0]))<12&&p[0]>-580&&p[0]<510);
 for(let x=-908;x<520;x+=8.5){leafSites.push([x,queenZ(x)-5.35],[x+2.3,queenZ(x)+5.55]);}
 addFallenLeaves(autumn,leafSites);
 // Draping and batching are the slow half of the build and use no randomness, so they run
 // per map tile, nearest first: the street around the player is finished before the first
 // frame and the rest a tile at a time during play. A tile stays hidden until it is done,
 // and each finished tile is exactly what the one-shot build produced.
 const pending=[...tiles.values(),...detailTiles.values(),...farTiles.values()],queue=new Set(pending),farSet=new Set<T.Object3D>(farTiles.values());
 for(const g of [...pending,works,snowbank])prepareMerge(g);
 drapeStatic(group,new Set([sky,tram,ontario.train,...people.map(p=>p.group),...pending]));
 mergeStatic(works);mergeStatic(snowbank);
 group.updateMatrixWorld(true);const tileBounds=new Map([...tiles.values()].map(g=>[g,new T.Box3().setFromObject(g)] as const)),tileProbe=new T.Vector3();
 for(const g of pending){g.userData.ready=false;g.visible=false;}
 const finish=(g:T.Group)=>{
  drapeStatic(g,new Set());mergeStatic(g);if(farSet.has(g))g.traverse(o=>{if(o instanceof T.Mesh)o.castShadow=false;});
  if(tileBounds.has(g))tileBounds.set(g,new T.Box3().setFromObject(g));g.userData.ready=true;queue.delete(g);
 };
 const streamTiles=(x:number,z:number,{radius=0,budgetMs=0}:{radius?:number;budgetMs?:number}={})=>{
  const done:T.Object3D[]=[];if(!queue.size)return done;
  const start=performance.now(),away=(g:T.Object3D)=>{const c=g.userData.center as Point;return Math.hypot(c[0]-x,c[1]-z);};
  for(const g of [...queue].sort((a,b)=>away(a)-away(b))){
   if(away(g)>radius&&performance.now()-start>=budgetMs)break;
   finish(g as T.Group);done.push(g);
  }
  return done;
 };
 streamTiles(START[0],START[1],{radius:STREAM_RADIUS});
 for(const person of people)person.group.position.y=groundHeight(person.x,person.z);
 return {updateTransit:(time:number,reduced:boolean)=>{ontario.update(time,reduced);ontario.train.position.y=6.40+groundHeight(ontario.train.position.x,ontario.train.position.z);},streamTiles,pendingTiles:()=>queue.size,updateVisibility:(x:number,z:number,lod:LevelOfDetail=GRAPHICS.high.lod)=>{for(const g of autumn.children){const c=g.userData.center;if(c)g.visible=Math.hypot(x-c[0],z-c[1])<lod.foliage;}for(const g of detailTiles.values()){const c=g.userData.center;g.visible=g.userData.ready&&Math.hypot(x-c[0],z-c[1])<lod.detail;}for(const g of farTiles.values()){const c=g.userData.center,d=Math.hypot(x-c[0],z-c[1]);g.visible=g.userData.ready&&(d>=lod.detail||c[0]>=750)&&d<lod.far;}
  // Whole map tiles past the fog line render as flat fog colour; skip them. Measure to the
  // tile's bounds, not its anchor, so long structures reaching back towards Pip stay drawn.
  for(const [g,box] of tileBounds){tileProbe.set(x,box.min.y,z);g.visible=g.userData.ready&&box.distanceToPoint(tileProbe)<lod.fog;}},group,snow,autumn,works,snowbank,obstacles,gate,worksBounds,snowBounds,tram,people,markers,recipient,sky,sunUniform,leaves,leafPositions,cameraOccluders:[]};
}
