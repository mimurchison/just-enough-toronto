import type {Neighbourhood} from '../scene';
import type {Rush,Chime} from './rush';
import {Garage} from './garage';
import {loadRushSettings,saveRushSettings,secretTracker} from './settings';
import './rush.css';

/**
 * Wires the hidden Garage into the game. Only the Garage and its secret word load
 * up front; the race car, pads and map are fetched the first time a switch turns
 * them on, so the default game pays nothing for Rush.
 */
export function installRush(town:Neighbourhood,host:HTMLElement,chime:Chime){
 let settings=loadRushSettings(),rush:Rush|undefined,loading:Promise<void>|undefined,pausedBefore=false;
 const wanted=()=>settings.rush||settings.minimap;
 const sync=async()=>{
  if(wanted()&&!rush){
   loading??=import('./rush').then(({Rush})=>{rush=new Rush(town,host,chime);town.attach(rush);}).catch(error=>{console.error('Rush failed to load',error);}).finally(()=>{loading=undefined;});
   await loading;
  }
  if(rush)rush.apply(settings);
  if(rush&&!wanted()){rush.dispose();town.attach(undefined);rush=undefined;}
 };
 const garage=new Garage(host,()=>settings,next=>{settings=next;saveRushSettings(next);void sync();},open=>{
  if(open){pausedBefore=town.paused;town.paused=true;}else town.paused=pausedBefore;
 });
 const secret=secretTracker();
 window.addEventListener('keydown',e=>{
  if(garage.isOpen){if(e.code==='Escape'){e.preventDefault();e.stopImmediatePropagation();garage.close();}return;}
  const target=e.target as HTMLElement;if(target?.matches?.('input,textarea,select')||document.querySelector('dialog[open]'))return;
  if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&secret(e.key))garage.open();
 },{capture:true});
 if(new URLSearchParams(location.search).has('garage'))queueMicrotask(()=>garage.open());
 void sync();
 return {garage,settings:()=>settings,rush:()=>rush};
}
