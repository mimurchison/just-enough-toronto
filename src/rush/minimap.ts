import {GEO,RENDER_BUILDINGS} from '../geography';
import {BOUNDS} from '../motion';
import type {Point} from '../game';

export type MapMarker={kind:'pip'|'car'|'delivery'|'target'|'meet'|'boost'|'landmark';x:number;z:number;heading?:number;label?:string;done?:boolean};
export type MapFrame={focus:{x:number;z:number;heading:number;speed:number};markers:MapMarker[];route?:Point[]};

/** Extra drivable area drawn beyond the authored map (Rush's downtown). */
export type MapArea={bounds:typeof BOUNDS;roads:{p:Point[];w:number}[];buildings:{p:Point[]}[]};
const C={landmark:'#ffe1a8',ground:'#2c4b52',park:'#55806a',water:'#4f86a6',road:'#d9c7a3',minor:'#a99d86',building:'#7f8f88',edge:'#fff0d6',pip:'#f6c97e',car:'#5fd1e0',target:'#ff8a5c',delivery:'#b9ebbe',boost:'#ffb347',route:'#f6c97e'};

/** Paint the neighbourhood once: parks, water, buildings, then roads by importance. */
function baseLayer(B:typeof BOUNDS,PX:number,extra?:MapArea){
 const w=Math.ceil((B.right-B.left)*PX),h=Math.ceil((B.bottom-B.top)*PX);
 const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const g=canvas.getContext('2d')!;
 const at=([x,z]:Point):[number,number]=>[(x-B.left)*PX,(z-B.top)*PX];
 const poly=(p:Point[])=>{g.beginPath();p.forEach((q,i)=>{const [x,y]=at(q);if(i)g.lineTo(x,y);else g.moveTo(x,y);});g.closePath();};
 g.fillStyle=C.ground;g.fillRect(0,0,w,h);
 for(const a of GEO.areas){g.fillStyle=a.kind==='river'?C.water:C.park;g.globalAlpha=a.kind==='pitch'||a.kind==='playground'?.6:.85;poly(a.p);g.fill();}
 g.globalAlpha=1;g.fillStyle=C.building;for(const b of [...RENDER_BUILDINGS,...extra?.buildings??[]]){poly(b.p);g.fill();}
 g.lineCap='round';g.lineJoin='round';g.strokeStyle=C.road;g.globalAlpha=.95;
 for(const r of extra?.roads??[]){g.lineWidth=Math.max(1.2,r.w*PX*.8);g.beginPath();r.p.forEach((q,i)=>{const [x,y]=at(q);if(i)g.lineTo(x,y);else g.moveTo(x,y);});g.stroke();}
 const width:Record<string,number>={motorway:16,motorway_link:9,secondary:15,tertiary:12,residential:9,service:5,pedestrian:5,footway:2,path:2,cycleway:2};
 g.lineCap='round';g.lineJoin='round';
 for(const minor of [true,false])for(const r of GEO.roads){
  const small=(width[r.kind]??5)<6;if(small!==minor)continue;
  g.strokeStyle=small?C.minor:C.road;g.globalAlpha=small?.55:.95;g.lineWidth=Math.max(1.2,(width[r.kind]??5)*PX*.8);
  g.beginPath();r.p.forEach((q,i)=>{const [x,y]=at(q);if(i)g.lineTo(x,y);else g.moveTo(x,y);});g.stroke();
 }
 g.globalAlpha=1;return canvas;
}

export class Minimap{
 readonly el=document.createElement('div');
 private canvas=document.createElement('canvas');
 private base?:HTMLCanvasElement;
 private legend=document.createElement('ul');
 large=false;
 constructor(host:HTMLElement){
  this.el.className='minimap';this.el.setAttribute('role','img');this.el.setAttribute('aria-label','Map of Queen East. Press M to enlarge.');
  this.legend.className='minimap-legend';
  this.legend.innerHTML=[['landmark','CN Tower'],['pip','Pip'],['car','You'],['delivery','Pip’s delivery'],['target','Urgent drop'],['meet','Meet Pip'],['boost','Big boost']].map(([k,l])=>`<li data-kind="${k}">${l}</li>`).join('');
  this.el.append(this.canvas,this.legend);host.append(this.el);
 }
 private area?:MapArea;
 /** Grow the map to include extra drivable area; undefined returns to the authored map. */
 setArea(area?:MapArea){this.area=area;this.base=undefined;}
 private get bounds(){const e=this.area?.bounds;return e?{left:Math.min(BOUNDS.left,e.left),right:Math.max(BOUNDS.right,e.right),top:Math.min(BOUNDS.top,e.top),bottom:Math.max(BOUNDS.bottom,e.bottom)}:BOUNDS;}
 // Keep the painted base under ~10 megapixels however large the area grows.
 private get px(){const B=this.bounds;return Math.min(1.6,Math.sqrt(1e7/((B.right-B.left)*(B.bottom-B.top))));}
 toggle(large=!this.large){this.large=large;this.el.classList.toggle('large',large);}
 dispose(){this.el.remove();}
 draw(f:MapFrame){
  const B=this.bounds,PX=this.px;this.base??=baseLayer(B,PX,this.area);
  const box=this.el.getBoundingClientRect(),dpr=Math.min(2,devicePixelRatio||1),w=Math.max(1,Math.round(box.width*dpr)),h=Math.max(1,Math.round(box.height*dpr));
  if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
  const g=this.canvas.getContext('2d')!;g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,w,h);
  // Big map: the whole neighbourhood, north up. Corner map: follows you, heading up, zooming out with speed.
  let scale:number,rotation=0,cx:number,cz:number;
  if(this.large){scale=Math.min(w/(B.right-B.left),h/(B.bottom-B.top))*.96;cx=(B.left+B.right)/2;cz=(B.top+B.bottom)/2;}
  else{const radius=Math.min(420,80+f.focus.speed*5.5);scale=Math.min(w,h)/2/radius;cx=f.focus.x;cz=f.focus.z;rotation=-Math.PI/2-Math.atan2(Math.cos(f.focus.heading),Math.sin(f.focus.heading));}
  g.save();g.translate(w/2,h/2);g.rotate(rotation);g.scale(scale,scale);g.translate(-cx,-cz);
  g.imageSmoothingEnabled=true;g.drawImage(this.base,B.left,B.top,this.base.width/PX,this.base.height/PX);
  const px=1/scale*dpr; // one CSS pixel in world units
  if(f.route&&f.route.length>1){g.strokeStyle=C.route;g.lineWidth=3*px;g.setLineDash([6*px,5*px]);g.beginPath();f.route.forEach(([x,z],i)=>i?g.lineTo(x,z):g.moveTo(x,z));g.stroke();g.setLineDash([]);}
  g.restore();
  // Markers are drawn upright in screen space so labels and arrows stay readable.
  const toScreen=(x:number,z:number):[number,number]=>{const dx=(x-cx)*scale,dz=(z-cz)*scale,c=Math.cos(rotation),s=Math.sin(rotation);return [w/2+dx*c-dz*s,h/2+dx*s+dz*c];};
  const order:MapMarker['kind'][]=['boost','landmark','delivery','meet','target','pip','car'];
  for(const kind of order)for(const m of f.markers){
   if(m.kind!==kind||(m.kind==='boost'&&!this.large))continue;
   let [sx,sy]=toScreen(m.x,m.z);const edge=12*dpr;
   const off=sx<edge||sy<edge||sx>w-edge||sy>h-edge;
   if(off){if(m.kind==='boost')continue;const dx=sx-w/2,dy=sy-h/2,k=Math.min((w/2-edge)/Math.abs(dx||1e-6),(h/2-edge)/Math.abs(dy||1e-6));sx=w/2+dx*k;sy=h/2+dy*k;}
   this.marker(g,m,sx,sy,dpr,rotation,off);
  }
 }
 private marker(g:CanvasRenderingContext2D,m:MapMarker,x:number,y:number,dpr:number,rotation:number,off:boolean){
  const r=(this.large?6:5)*dpr;g.save();g.translate(x,y);g.lineWidth=1.6*dpr;g.strokeStyle='#183238';
  if(m.kind==='car'||m.kind==='pip'){
   const heading=(m.heading??0),angle=Math.atan2(Math.cos(heading),Math.sin(heading))+rotation+Math.PI/2;
   g.rotate(angle);g.fillStyle=C[m.kind];g.beginPath();
   if(m.kind==='car'){g.moveTo(0,-r*1.6);g.lineTo(r,r);g.lineTo(0,r*.45);g.lineTo(-r,r);}else{g.arc(0,0,r,0,Math.PI*2);g.moveTo(0,-r*1.7);g.lineTo(r*.6,-r*.7);g.lineTo(-r*.6,-r*.7);}
   g.closePath();g.fill();g.stroke();
  }else if(m.kind==='landmark'){g.fillStyle=C.landmark;g.beginPath();g.moveTo(0,-r*2);g.lineTo(r*.75,r);g.lineTo(-r*.75,r);g.closePath();g.fill();g.stroke();g.beginPath();g.arc(0,-r*.6,r*.55,0,Math.PI*2);g.fill();g.stroke();}
  else if(m.kind==='boost'){g.fillStyle=C.boost;g.beginPath();g.arc(0,0,r*.45,0,Math.PI*2);g.fill();}
  else{
   const color=m.kind==='target'?C.target:m.kind==='meet'?C.car:C.delivery;
   g.fillStyle=m.done?'#7d8a85':color;g.beginPath();
   if(m.kind==='delivery'){g.moveTo(0,-r*1.3);g.lineTo(r*1.1,-r*.2);g.lineTo(r*.8,r);g.lineTo(-r*.8,r);g.lineTo(-r*1.1,-r*.2);}
   else g.arc(0,0,r*1.2,0,Math.PI*2);
   g.closePath();g.fill();g.stroke();
   if(m.label){g.fillStyle='#183238';g.font=`700 ${Math.round(r*1.3)}px DM Sans, sans-serif`;g.textAlign='center';g.textBaseline='middle';g.fillText(m.label,0,m.kind==='delivery'?r*.1:.5*dpr);}
   if(off){g.globalAlpha=.8;g.strokeStyle=color;g.beginPath();g.arc(0,0,r*1.8,0,Math.PI*2);g.stroke();}
  }
  g.restore();
 }
}
