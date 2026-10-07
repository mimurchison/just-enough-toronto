import {QUALITY_LEVELS,QUALITY_NAMES,isRenderQuality} from './render-quality';
import {initPhysics} from './physics';
import {VISITS} from './geography';
import './style.css';
import { Neighbourhood } from './scene';
import { installRush } from './rush/install';
import type { SceneMode } from './scene';
import { StreetSound } from './sound';
import { BUDGET, MISSIONS, factsForDay, starterBrief, toggleFact, runDelivery } from './game';
import type { FactId, Fact, Brief, Journey } from './game';
import { parseSavedGame } from './persistence';
import type { Attempt, SavedGame } from './persistence';

const icons={
 arrow:'<path d="M4 12h15m-6-6 6 6-6 6"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',brief:'<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M9 5V3h6v2M8 10h8m-8 4h6"/>',
 pause:'<path d="M9 5v14m6-14v14"/>',play:'<path d="m8 4 12 8-12 8Z"/>',sound:'<path d="M3 9h4l5-4v14l-5-4H3Zm13-2c4 3 4 7 0 10m0-7c1 1 1 3 0 4"/>',mute:'<path d="M3 9h4l5-4v14l-5-4H3Zm13 0 5 6m-5 0 5-6"/>',
 full:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',map:'<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Zm6-2v16m6-14v16"/>',help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4.3 1.7c-1 .6-1.8 1.1-1.8 2.8m0 3v.1"/>',
 check:'<path d="m5 12 4 4L19 6"/>',works:'<path d="M4 8h16v6H4Zm2 6v6m12-6v6M8 8l4 6m2-6 4 6"/>',entrance:'<path d="M5 21V3h14v18M9 21V6h7v15M12 12h1"/>',gate:'<path d="M4 21V4h16v17M8 8l-3 3 3 3m8-6 3 3-3 3M5 11h14"/>',park:'<path d="m12 2-7 9h4l-5 6h6v5h4v-5h6l-5-6h4Z"/>',mural:'<path d="m4 4 5 3 3-1 3 1 5-3-1 11-7 6-7-6ZM8 12h1m6 0h1m-6 4h4"/>',bakery:'<path d="M3 10h18v11H3Zm-1 0 3-6h14l3 6M7 14h4v7m4-7h3v3h-3M8 1h8"/>',reset:'<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/>'
};
const svg=(name:keyof typeof icons)=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
const app=document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML=`<div id="world"></div><div class="screen-shade"></div><div class="hud"><header class="hud-top"><div class="identity"><span class="logo">Just Enough</span></div><div class="top-actions"><button class="icon-button help-button" data-action="help" aria-label="About Just Enough" title="About Just Enough"><span aria-hidden="true">?</span></button><button class="icon-button" data-action="sound" aria-label="Enable sound">${svg('mute')}</button><button class="icon-button" data-action="map" aria-label="Neighbourhood overview">${svg('map')}</button><button class="icon-button" data-action="fullscreen" aria-label="Full screen">${svg('full')}</button><button class="icon-button" data-action="menu" aria-label="Pause and settings">${svg('pause')}</button></div></header><div class="objective"></div><div class="chapter-dots" aria-label="Chapters"></div><div class="travel-status" role="status"></div><section class="result-zone" aria-live="polite"></section><div class="bottom-hud"><div class="actions"></div></div><section class="brief-drawer" aria-label="Pip’s brief" hidden></section><div class="toast" role="status" aria-live="polite"></div></div><dialog class="game-dialog" aria-labelledby="dialog-title"><button class="dialog-close icon-button" data-action="close-dialog" aria-label="Close dialog">${svg('close')}</button><div class="dialog-content"></div></dialog>`;
const ui={objective:app.querySelector<HTMLElement>('.objective')!,dots:app.querySelector<HTMLElement>('.chapter-dots')!,actions:app.querySelector<HTMLElement>('.actions')!,brief:app.querySelector<HTMLElement>('.brief-drawer')!,result:app.querySelector<HTMLElement>('.result-zone')!,travel:app.querySelector<HTMLElement>('.travel-status')!,dialog:app.querySelector<HTMLDialogElement>('dialog')!};
const STORAGE='enough-queen-east-v1';let saved:SavedGame|undefined;try{saved=parseSavedGame(localStorage.getItem(STORAGE));}catch{}
let chapter=0,unlocked=0,brief:Brief=starterBrief(),checks=new Set<FactId>(),attempts:Attempt[]=[],mode:SceneMode='title',briefOpen=false,selected:FactId|undefined,near:FactId|undefined,result:Journey|undefined,token=0,reduced=matchMedia('(prefers-reduced-motion: reduce)').matches,previousPause=false;
let toastTimer:ReturnType<typeof setTimeout>;const sound=new StreetSound();let town:Neighbourhood|undefined;
const factName:Record<FactId,string>={works:'Queen Street',entrance:'Side entrance',gate:'Garden passage',park:'Park path',mural:'Amber on Boulton',bakery:'Bonjour Brioche'};
const taskCopy=['Deliver the pastries','Deliver the 90 cm cart','Check today’s route'];
// Garnet's inscription anchors the story. This is a typographic homage, not a replica font.
const riverMark='<svg class="river-mark" viewBox="0 0 240 32" aria-hidden="true"><path d="M1 24C48 24 76 24 97 12S143 0 162 12S199 24 239 24"/><path d="M1 30C48 30 76 30 97 18S143 6 162 18S199 30 239 30"/></svg>';
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
app.querySelector('#world')!.innerHTML='<div class=world-loading role=status>Opening Queen East…</div>';
performance.mark('enough:code');
try{await initPhysics();performance.mark('enough:physics');app.querySelector('#world')!.innerHTML='';town=new Neighbourhood(app.querySelector('#world')!,id=>{near=id;},id=>openBrief(id),speed=>sound.update(speed),()=>sound.chime('bell'));}
catch(error){console.error('3D renderer unavailable',error);app.querySelector('#world')!.innerHTML='<div class="render-fallback"><h2>The 3D view could not start.</h2><p>You can still play the brief puzzle.</p><button data-action="reload">Try the view again</button></div>';}
// Rush (race car, mini-map) stays dormant until switched on in its hidden Garage.
const rush=town?installRush(town,app,kind=>sound.chime(kind)):undefined;
// One picker on the opening screen and in the pause menu, as in Huck. Lower tiers trade
// shadows, post-processing and draw distance (level of detail) for frame rate.
const graphicsPicker=()=>{const current=town?.getQuality()||'high',gpu=town?.gpu();return `<div class="settings-row"><label for="graphics-quality">Graphics${gpu?`<small class="gpu-name" title="${escape(gpu.name)}">${escape(gpu.name)}</small>`:''}</label><select id="graphics-quality" data-setting="quality" aria-label="Graphics quality">${QUALITY_LEVELS.map(q=>`<option value="${q}"${q===current?' selected':''}>${QUALITY_NAMES[q]}</option>`).join('')}</select></div>`;};
function save(){try{localStorage.setItem(STORAGE,JSON.stringify({chapter,unlocked,brief,checks:[...checks],attempts}));}catch{}}
function available():Fact[]{return factsForDay(0).map(f=>chapter===2&&checks.has(f.id)?factsForDay(2).find(v=>v.id===f.id)!:f);}
function stale(id:FactId){return chapter===2&&['works','park'].includes(id)&&!checks.has(id);}
function toast(text:string){const el=app.querySelector<HTMLElement>('.toast')!;el.textContent=text;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),4000);}
function focusWorld(){app.querySelector<HTMLCanvasElement>('canvas')?.focus({preventScroll:true});}
function openBrief(id?:FactId){if(mode==='title'||mode==='delivery'||mode==='complete')return;if(mode==='result'){mode='explore';town?.resetRobot();}briefOpen=true;selected=id;render();ui.brief.querySelector<HTMLButtonElement>(id?`[data-fact="${id}"]`:'button')?.focus();}
function closeBrief(){briefOpen=false;selected=undefined;render();focusWorld();}
function factSummary(f:Fact){if(f.id==='works')return f.value==='open'?'Sidewalk clear':'Sidewalk closed';if(f.id==='park')return f.value==='open'?'Wide, open path':'Blocked by snow';if(f.id==='gate')return '70 cm wide';if(f.id==='entrance')return 'Step-free arrival';if(f.id==='mural')return 'A lovely landmark';return 'Blue awning';}
function shortDetail(f:Fact){if(f.id==='works')return f.value==='open'?'Gate open today.':'Gate closed. Take another route.';if(f.id==='gate')return 'Pip: 45 cm. Gate: 70 cm. Cart: 90 cm.';if(f.id==='entrance')return 'Front locked. Use the side door.';if(f.id==='park')return f.value==='open'?'Wide, open and step-free.':'Blocked by snow.';if(f.id==='mural')return 'Orange sign at 4 Boulton.';return 'Pickup already known.';}
function renderBrief(){
  const count=Object.keys(brief).length;const f=selected?available().find(f=>f.id===selected):undefined;
  ui.brief.hidden=!briefOpen;if(!briefOpen){ui.brief.innerHTML='';return;}
  ui.brief.innerHTML=`<div class="drawer-heading"><div><h2>Pip’s brief</h2></div><span class="memory-meter" role="img" aria-label="${count} of 4 memories">${Array.from({length:4},(_,i)=>`<i class="${i<count?'filled':''}"></i>`).join('')}</span><button class="icon-button" data-action="close-brief" aria-label="Close brief">${svg('close')}</button></div><div class="brief-content"><div class="memory-grid">${available().map(f=>`<button class="memory-card ${brief[f.id]?'kept':''} ${selected===f.id?'selected':''}" data-action="select" data-fact="${f.id}" aria-pressed="${!!brief[f.id]}"><span class="memory-icon">${svg(f.id)}</span><span><strong>${factName[f.id]}</strong><small>${factSummary(f)}${stale(f.id)?' · Friday':''}</small></span><span class="memory-check">${brief[f.id]?svg('check'):'+'}</span></button>`).join('')}</div>${f?`<div class="memory-detail"><div><strong>${factName[f.id]}</strong><p>${shortDetail(f)}</p></div>${stale(f.id)?`<button class="check-today" data-action="refresh" data-fact="${f.id}">${svg('reset')} Check today</button>`:''}<button class="detail-toggle" data-action="toggle" data-fact="${f.id}">${brief[f.id]?'Forget':'Remember'} ${svg(brief[f.id]?'close':'check')}</button></div>`:''}</div><div class="drawer-footer"><span aria-label="${count} of 4 memories">${count} / 4</span><button class="primary" data-action="send">Send Pip ${svg('arrow')}</button></div>`;
}
function resultCopy(){
 if(!result)return {title:'',body:''};
 if(result.success)return {title:chapter===2&&brief.works?.version!==2?'Delivered. A lucky guess?':'Delivered.',body:''};
 if(result.route==='No route')return {title:'Update the brief.',body:'Every route in the brief is blocked.'};
 const failures:Record<string,{title:string;body:string}>={
  works:{title:'Path closed.',body:'Add the closure to the brief.'},
  gate:{title:'Cart too wide.',body:'70 cm gate · 90 cm cart.'},
  park:{title:'Path snowed in.',body:'Check today’s conditions.'},
  entrance:{title:'Wrong door.',body:'Use the side entrance.'}
 };
 return failures[result.fact||'works'];
}
function render(){
  app.dataset.mode=mode;app.classList.toggle('drawer-open',briefOpen);app.classList.toggle('reduced-motion',reduced);
  ui.objective.hidden=mode==='title'||mode==='result'||mode==='complete';ui.objective.innerHTML=`<strong>${taskCopy[chapter]}</strong>`;
  ui.dots.hidden=mode!=='explore';ui.dots.innerHTML=MISSIONS.map((m,i)=>`<button class="chapter-dot ${i===chapter?'active':''} ${i<unlocked?'done':''}" data-action="chapter" data-chapter="${i}" aria-label="Chapter ${i+1}: ${m.name}" ${i>Math.min(2,unlocked)||mode==='delivery'?'disabled':''}>${i<unlocked?svg('check'):i+1}</button>`).join('');
  app.querySelector<HTMLElement>('.bottom-hud')!.hidden=mode==='title'||mode==='complete'||mode==='result'||briefOpen;
  ui.actions.innerHTML=mode==='delivery'?`<button class="glass-button" data-action="cancel" aria-label="Return to the bakery" title="Return to the bakery">${svg('reset')}</button><button class="glass-button" data-action="skip">Skip travel</button><button class="primary" data-action="pause">${svg(town?.paused?'play':'pause')}${town?.paused?'Resume':'Pause'}</button>`:`<button class="glass-button brief-button" data-action="brief">${svg('brief')} Brief <span>${Object.keys(brief).length}/4</span></button><button class="primary" data-action="send">Send Pip ${svg('arrow')}</button>`;
  ui.travel.hidden=mode!=='delivery';if(mode==='delivery')ui.travel.innerHTML='<span class="travel-label visually-hidden">OUT FOR DELIVERY</span><div class="travel-track"><i></i></div><span class="travel-time">0.0 min</span>';
  ui.result.hidden=mode!=='result'&&mode!=='complete';
  if(mode==='result'&&result){const copy=resultCopy();ui.result.innerHTML=`<div class="result-card ${result.success?'success':'failure'}"><h2>${copy.title}</h2>${result.success?'':`<p>${copy.body}</p>`}<div class="result-actions"><button class="primary" data-action="${result.success?'next':'repair'}">${result.success?(chapter===2?'Finish':'Next delivery'):'Edit brief'} ${svg('arrow')}</button><button class="quiet-button" data-action="retry">${result.success?'Replay':'Try again'}</button></div></div>`;}
  if(mode==='complete')ui.result.innerHTML=`<div class="result-card ending">${riverMark}<h2>Enough, for now.</h2><div class="result-actions"><button class="primary" data-action="river">Return to the river ${svg('arrow')}</button></div></div>`;
  if(mode!=='result'&&mode!=='complete')ui.result.innerHTML='';
  app.querySelector<HTMLButtonElement>('[data-action=map]')!.disabled=mode==='delivery';
  renderBrief();town?.setState(chapter,mode,briefOpen||ui.dialog.open||mode==='title'||mode==='result'||mode==='complete');
  const audioButton=app.querySelector<HTMLButtonElement>('[data-action="sound"]')!;audioButton.innerHTML=svg(sound.isMuted?'mute':'sound');audioButton.setAttribute('aria-label',sound.isMuted?'Enable sound':'Mute sound');
}
// Once per GPU: on an integrated or software renderer, say why it may be slow and what helps.
function gpuTip(){const gpu=town?.gpu();if(!gpu||gpu.kind==='dedicated')return;try{if(localStorage.getItem('enough-gpu-tip')===gpu.name)return;localStorage.setItem('enough-gpu-tip',gpu.name);}catch{}
 toast(gpu.kind==='software'?'Your browser is drawing without the graphics card. Turn on hardware acceleration, or choose Low graphics in the menu.':`Running on ${gpu.name}. If this computer has a faster graphics card, set your browser to High performance in Windows graphics settings, or choose Low graphics.`);}
function start(resume=false){previousPause=false;token++;town?.cancel();if(resume&&saved){chapter=saved.chapter;unlocked=saved.unlocked;brief=saved.brief;checks=new Set(saved.checks);attempts=saved.attempts;}else{chapter=0;unlocked=0;brief=starterBrief();checks.clear();attempts=[];}mode='explore';briefOpen=false;selected=undefined;result=undefined;render();if(resume)town?.resetRobot();else town?.visit('king-river');save();focusWorld();gpuTip();}
async function send(){
  if(mode!=='explore')return;const run=++token;result=runDelivery(brief,MISSIONS[chapter]);const journey=result;mode='delivery';briefOpen=false;selected=undefined;render();sound.chime('send');
  const progress=(p:number)=>{const bar=ui.travel.querySelector<HTMLElement>('.travel-track i');if(bar)bar.style.width=`${p*100}%`;const time=ui.travel.querySelector('.travel-time');if(time)time.textContent=`${(p*journey.minutes).toFixed(1)} min`;};
  if(town)await town.animateJourney(journey,progress);else progress(1);if(run!==token)return;
  attempts.push({chapter,success:journey.success,cards:Object.keys(brief).length,minutes:journey.minutes,route:journey.route,checks:checks.size});if(journey.success)unlocked=Math.max(unlocked,chapter+1);mode='result';sound.chime(journey.success?'success':'stop');render();save();
}
function openDialog(contents:string){if(!ui.dialog.open)previousPause=town?.paused??false;if(town){town.paused=true;town.setLocked(true);}app.querySelector('.dialog-content')!.innerHTML=contents;if(!ui.dialog.open)ui.dialog.showModal();}
function about(){
 const opening=mode==='title';
 openDialog(`<div class="overview-content">
  <header><h2 id="dialog-title">Just Enough</h2><p class="game-subtitle">A Game About Context Engineering.</p></header>
  <div class="overview-body">
   <div class="overview-copy"><p>Help Pip, a friendly delivery robot, discover how much information is enough.</p><p>Too little leaves gaps. Too much can bury what matters. Compression keeps what is useful for the task.</p><p>The game explores intelligence as knowing what to keep, what to leave out, and when to update it.</p></div>
   <details><summary>How to play</summary><p>Explore. Keep up to four facts in <b>Brief</b>. <b>Send Pip</b>. Revise and retry.</p><div class="control-guide"><span><kbd>WASD / arrows</kbd> Move</span><span><kbd>Drag / scroll</kbd> Look / zoom</span><span><kbd>E</kbd> Inspect</span><span><kbd>Tab / B</kbd> Brief</span></div><p>Three deliveries · about 8–12 minutes.</p></details>
   ${opening&&town?graphicsPicker():''}
   <a class="overview-credits" href="/sources.html#river-story" target="_blank" rel="noopener">Story &amp; credits ↗</a>
  </div>
  <footer class="overview-footer"><button class="primary" ${opening?'autofocus':''} data-action="${opening?(saved?'resume':'start'):'close-dialog'}">${opening?(saved?'Continue':'Start'):'Back to game'} ${svg('arrow')}</button>${opening&&saved?'<button class="quiet-button" data-action="reset">Start over</button>':''}</footer>
 </div>`);
}
function menu(){openDialog(`<h2 id="dialog-title">Paused</h2><button class="primary" data-action="close-dialog">Resume ${svg('play')}</button><div class="settings-row"><span>Reduced motion</span><button data-action="motion" aria-pressed="${reduced}">${reduced?'On':'Off'}</button></div>${town?graphicsPicker():''}<button class="text-link" data-action="about">About Just Enough</button><button class="text-link" data-action="reset">Start again</button>`);}
app.addEventListener('click',async e=>{
  if(e.detail>1)return;const button=(e.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');if(!button||button.disabled)return;const action=button.dataset.action,id=button.dataset.fact as FactId;
  if(action==='start'){ui.dialog.close();start();return;}if(action==='resume'){ui.dialog.close();start(true);return;}if(action==='reload'){location.reload();return;}
  if(action==='sound'){if(sound.isMuted)await sound.enable();else sound.mute();const b=app.querySelector('[data-action="sound"]')!;b.innerHTML=svg(sound.isMuted?'mute':'sound');b.setAttribute('aria-label',sound.isMuted?'Enable sound':'Mute sound');sound.chime('tap');return;}
  if(action==='fullscreen'){try{if(document.fullscreenElement)await document.exitFullscreen();else await app.requestFullscreen();}catch{toast('Use your browser’s full-screen control.');}return;}
  if(action==='map'){openDialog(`<h2 id="dialog-title">Queen East</h2><div class="landmark-list">${VISITS.map(p=>`<button class="landmark-link" data-action="visit" data-place="${p.id}">${p.label}<span aria-hidden="true">↗</span></button>`).join('')}</div><p class="fine-print"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> · <a href="https://open.toronto.ca/open-data-license/" target="_blank" rel="noopener">City of Toronto Open Data</a>.</p>`);return;}
  if(action==='visit'){ui.dialog.close();town?.visit(button.dataset.place!);restoreDialogState();return;}
  if(action==='menu'){menu();return;}if(action==='about'||action==='help'){about();return;}if(action==='close-dialog'){ui.dialog.close();return;}
  if(action==='motion'){reduced=!reduced;town?.setReducedMotion(reduced);button.setAttribute('aria-pressed',String(reduced));button.textContent=reduced?'On':'Off';app.classList.toggle('reduced-motion',reduced);return;}
  if(action==='reset'){ui.dialog.querySelector('.dialog-content')!.innerHTML=`<span class="eyebrow">A FRESH START</span><h2 id="dialog-title">Back to King & River?</h2><p>This resets your brief and chapter progress.</p><button class="primary" data-action="confirm-reset">Start again ${svg('reset')}</button><button class="quiet-button" data-action="close-dialog">Keep exploring</button>`;return;}
  if(action==='confirm-reset'){ui.dialog.close();start();return;}
  if(action==='pause'){if(town){town.paused=!town.paused;button.innerHTML=`${svg(town.paused?'play':'pause')}${town.paused?'Resume':'Pause'}`;ui.travel.querySelector('.travel-label')!.textContent=town.paused?'DELIVERY PAUSED':'OUT FOR DELIVERY';}return;}
  if(action==='skip'){town?.skipTravel();if(town)town.paused=false;return;}
  if(action==='cancel'){token++;town?.resetRobot();mode='explore';render();focusWorld();return;}
  if(action==='brief'){openBrief();return;}if(action==='close-brief'){closeBrief();return;}
  if(mode==='delivery')return;
  if(action==='select'){selected=id;sound.chime('tap');renderBrief();ui.brief.querySelector<HTMLButtonElement>(`[data-action="select"][data-fact="${id}"]`)?.focus({preventScroll:true});ui.brief.querySelector('.memory-detail')?.scrollIntoView({block:'nearest'});return;}
  if(action==='toggle'){const f=available().find(f=>f.id===id)!;if(!brief[id]&&Object.keys(brief).length===BUDGET){toast('Brief full. Forget one.');return;}brief=toggleFact(brief,f);sound.chime('tap');renderBrief();save();ui.brief.querySelector<HTMLButtonElement>('[data-action="toggle"]')?.focus();return;}
  if(action==='refresh'){checks.add(id);if(brief[id])brief={...brief,[id]:factsForDay(2).find(f=>f.id===id)!};renderBrief();save();sound.chime('tap');toast(brief[id]?'Brief updated.':'Checked. Remember if useful.');return;}
  if(action==='send'){void send();return;}
  if(action==='retry'||action==='repair'){mode='explore';town?.resetRobot();briefOpen=action==='repair';selected=action==='repair'?result?.fact:undefined;render();focusWorld();return;}
  if(action==='next'){if(chapter<2){chapter++;checks.clear();mode='explore';town?.resetRobot();result=undefined;render();save();focusWorld();}else{mode='complete';render();save();}return;}
  if(action==='river'){mode='explore';render();town?.visit('bridge');focusWorld();return;}
  if(action==='chapter'){const next=Number(button.dataset.chapter);if(next>unlocked)return;chapter=next;checks.clear();brief=next===0?starterBrief():Object.fromEntries(factsForDay(0).filter(f=>['works','entrance','gate'].includes(f.id)).map(f=>[f.id,f]));mode='explore';briefOpen=false;selected=undefined;town?.resetRobot();render();save();focusWorld();return;}
});
function restoreDialogState(){if(mode==='title'){start(!!saved);return;}if(town){town.paused=previousPause;town.setLocked(briefOpen||mode==='result'||mode==='complete');}focusWorld();}
// Native dialog close events are queued. A landmark visit restores controls
// synchronously so the first held direction after selecting it is not lost.
ui.dialog.addEventListener('close',restoreDialogState);
app.addEventListener('change',e=>{const select=e.target as HTMLSelectElement;if(select.dataset.setting==='quality'&&isRenderQuality(select.value))town?.setQuality(select.value);});
window.addEventListener('keydown',e=>{
  if(e.repeat&&['Space','Enter','Tab','KeyE','KeyB'].includes(e.code)){e.preventDefault();return;}
  if(ui.dialog.open)return;
  const target=e.target as HTMLElement;if(target.matches('input,textarea,select'))return;
  if(e.code==='Escape'){e.preventDefault();if(briefOpen)closeBrief();else if(mode!=='title')menu();return;}
  if(e.code==='KeyB'||e.code==='Tab'&&(target===document.body||target.tagName==='CANVAS')){if(mode==='explore'){e.preventDefault();briefOpen?closeBrief():openBrief();}return;}
  if(e.code==='KeyE'&&mode==='explore'&&!briefOpen){e.preventDefault();if(near)openBrief(near);else toast('Roll closer to a shop, path, or passage.');return;}
  if(e.code==='KeyR'&&!briefOpen){town?.resetCamera();return;}
  if(e.code==='Space'&&mode==='delivery'&&(target===document.body||target.tagName==='CANVAS')){e.preventDefault();app.querySelector<HTMLButtonElement>('[data-action="pause"]')?.click();}
});
document.addEventListener('visibilitychange',()=>{void sound.visibility(document.hidden);});
if(new URLSearchParams(location.search).has('debug'))(window as any).__ENOUGH__={getState:()=>({chapter,mode,brief,checks:[...checks],attempts,unlocked,result,briefOpen,near}),scene:()=>town?.diagnostics(),bounds:()=>town?.collisionBounds(),skyline:()=>town?.skylineReference(),sound:()=>sound.diagnostics(),rush:()=>rush?.rush()};
render();
about();
if(import.meta.env.DEV&&new URLSearchParams(location.search).has('capture')){(window as any).__ENOUGH_CAPTURE__=(shot:Parameters<Neighbourhood['captureFrame']>[0])=>town?.captureFrame(shot);(window as any).__ENOUGH_CAPTURE_STEP__=(dt:number,lens?:Parameters<Neighbourhood['captureStep']>[1])=>town?.captureStep(dt,lens);}
