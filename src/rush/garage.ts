import {CAR_MODELS,type CarModelId,type RushSettings} from './settings';

type Toggle={key:Exclude<keyof RushSettings,'car'>;label:string;hint:string;needsRush?:boolean};
const TOGGLES:Toggle[]=[
 {key:'rush',label:'Rush mode',hint:'A race car, boost pads and urgent drops for Pip. C swaps between Pip and the car.'},
 {key:'minimap',label:'Mini-map',hint:'Pip, her delivery and your targets in the corner. M enlarges it.'},
 {key:'supersonic',label:'Supersonic',hint:'Unlimited boost, around 400 km/h, huge jumps.',needsRush:true},
 {key:'ghost',label:'Phase through buildings',hint:'Only the ground is solid. Blast straight through the block.',needsRush:true},
 {key:'moon',label:'Moon gravity',hint:'A third of the usual pull.',needsRush:true},
];
const CONTROLS:[string,string][]=[['W S','Drive · pitch in the air'],['A D','Steer · yaw in the air'],['Space','Jump · again to double jump, or dodge with a direction (or right mouse)'],['Shift','Boost (or left mouse)'],['X','Powerslide'],['Q E','Air roll'],['R','Reset the car'],['C','Swap Pip / car'],['M','Big map'],['Gamepad','Triggers drive · A jump · B boost · X slide · Y swap']];

/** The hidden settings panel. Typing the secret word opens it; nothing in the game links to it. */
export class Garage{
 readonly el=document.createElement('div');
 private returnFocus?:Element|null;
 constructor(host:HTMLElement,private settings:()=>RushSettings,private change:(next:RushSettings)=>void,private onOpen:(open:boolean)=>void){
  this.el.className='garage';this.el.hidden=true;this.el.setAttribute('role','dialog');this.el.setAttribute('aria-modal','true');this.el.setAttribute('aria-labelledby','garage-title');
  host.append(this.el);
  this.el.addEventListener('click',e=>{
   const button=(e.target as HTMLElement).closest<HTMLButtonElement>('[data-garage]');if(!button)return;
   const action=button.dataset.garage!,s={...this.settings()};
   if(action==='close'){this.close();return;}
   if(action==='car'){s.car=button.dataset.car as CarModelId;}
   else{const key=action as Toggle['key'];s[key]=!s[key];}
   this.change(s);this.render();
  });
  this.el.addEventListener('pointerdown',e=>{if(e.target===this.el)this.close();});
 }
 get isOpen(){return !this.el.hidden;}
 open(){if(this.isOpen)return;this.returnFocus=document.activeElement;this.el.hidden=false;this.render();this.onOpen(true);this.el.querySelector<HTMLButtonElement>('[data-garage]')?.focus();}
 close(){if(!this.isOpen)return;this.el.hidden=true;this.onOpen(false);(this.returnFocus as HTMLElement|null)?.focus?.();}
 private render(){
  const s=this.settings();
  this.el.innerHTML=`<div class="garage-card"><header><span class="garage-eyebrow">HIDDEN MENU</span><h2 id="garage-title">The Garage</h2><button class="garage-close" data-garage="close" aria-label="Close the Garage">×</button></header>
  <p class="garage-intro">Pip handles the brief. When something is urgent, the operator takes the car.</p>
  <div class="garage-toggles">${TOGGLES.map(t=>{const off=t.needsRush&&!s.rush;return `<button class="garage-toggle" data-garage="${t.key}" role="switch" aria-checked="${s[t.key]}" ${off?'disabled':''}><span><strong>${t.label}</strong><small>${t.hint}</small></span><i aria-hidden="true"></i></button>`;}).join('')}</div>
  <div class="garage-cars" role="radiogroup" aria-label="Car">${(Object.keys(CAR_MODELS) as CarModelId[]).map(id=>`<button data-garage="car" data-car="${id}" role="radio" aria-checked="${s.car===id}" ${s.rush?'':'disabled'}>${CAR_MODELS[id].label}</button>`).join('')}</div>
  <details class="garage-controls"><summary>Car controls</summary><dl>${CONTROLS.map(([k,v])=>`<div><dt><kbd>${k}</kbd></dt><dd>${v}</dd></div>`).join('')}</dl></details>
  <p class="garage-credit">${Object.values(CAR_MODELS).map(m=>m.credit).join(' · ')}</p></div>`;
 }
}
