export type CarModelId='hcr'|'rc01';
export const CAR_MODELS:Record<CarModelId,{label:string;url:string;credit:string}>={
 hcr:{label:'HCR Race Car',url:'models/race/hcr-race-car.glb',credit:'“HCR Race Car” by oakar258, CC BY 4.0'},
 rc01:{label:'Race Car 01',url:'models/race/race-car-01.glb',credit:'“Race Car 01” by toddeppe, CC BY 4.0'},
};

// Everything in Rush is off until it is switched on in the hidden Garage.
export type RushSettings={
 /** The race car, urgent deliveries and boost pads. */
 rush:boolean;
 /** The corner map; M enlarges it. */
 minimap:boolean;
 /** Unlimited boost, ~400 km/h and huge jumps. */
 supersonic:boolean;
 /** Drive straight through buildings; only the ground is solid. */
 ghost:boolean;
 /** A third of normal gravity. */
 moon:boolean;
 car:CarModelId;
};
export const DEFAULT_RUSH:RushSettings={rush:false,minimap:false,supersonic:false,ghost:false,moon:false,car:'hcr'};
const KEY='enough-rush-v1';

export function parseRushSettings(raw:string|null):RushSettings{
 try{
  const v=JSON.parse(raw||'{}') as Partial<RushSettings>;const out={...DEFAULT_RUSH};
  for(const k of ['rush','minimap','supersonic','ghost','moon'] as const)if(typeof v[k]==='boolean')out[k]=v[k];
  if(v.car==='hcr'||v.car==='rc01')out.car=v.car;
  return out;
 }catch{return {...DEFAULT_RUSH};}
}
export function loadRushSettings():RushSettings{try{return parseRushSettings(localStorage.getItem(KEY));}catch{return {...DEFAULT_RUSH};}}
export function saveRushSettings(s:RushSettings){try{localStorage.setItem(KEY,JSON.stringify(s));}catch{/* Settings still apply for this visit. */}}

/** The Garage opens when the player types this word anywhere outside a text field. */
export const SECRET='rush';
/** Feed key presses in; returns true when the last keys spell the secret word. */
export function secretTracker(word=SECRET){
 let typed='';
 return (key:string)=>{if(key.length!==1)return false;typed=(typed+key.toLowerCase()).slice(-word.length);return typed===word;};
}
