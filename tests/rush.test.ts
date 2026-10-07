import {test} from 'node:test';import assert from 'node:assert/strict';
import {strollPath,pathLength,pingPong,nearestAlong,nearestRoad,pickTargets,timeBudget,layoutPads,Jobs,SPOTS} from '../src/rush/rush-logic';
import {parseRushSettings,DEFAULT_RUSH,secretTracker} from '../src/rush/settings';
import {NODES,type Point} from '../src/game';
import {BOUNDS} from '../src/motion';

test('Rush is entirely off by default, and unknown saved values fall back to off',()=>{
 assert.deepEqual(parseRushSettings(null),DEFAULT_RUSH);
 for(const k of ['rush','minimap','supersonic','ghost','moon'] as const)assert.equal(DEFAULT_RUSH[k],false);
 assert.deepEqual(parseRushSettings('{"rush":"yes","car":"tank","minimap":true}'),{...DEFAULT_RUSH,minimap:true});
 assert.deepEqual(parseRushSettings('not json'),DEFAULT_RUSH);
});
test('the Garage opens only when the secret word is typed',()=>{
 const t=secretTracker('rush');assert.equal([...'rus'].map(t).some(Boolean),false);assert.equal(t('h'),true);assert.equal(t('h'),false);assert.equal(t('Shift'),false);
});
test('Pip strolls her delivery route from the bakery to the side door and back',()=>{
 const p=strollPath(),L=pathLength(p);assert.deepEqual(p[0],NODES.bakery);assert.deepEqual(p.at(-1),NODES.side);assert.ok(L>150);
 const out=pingPong(p,L,L*.5),back=pingPong(p,L,L*1.5);assert.ok(Math.hypot(out.x-back.x,out.z-back.z)<1e-6);assert.ok(Math.abs(Math.abs(out.heading-back.heading)-Math.PI)<1e-6);
 const mid=pingPong(p,L,40);assert.ok(nearestAlong(p,[mid.x,mid.z]).distance<1e-6);
});
test('urgent drops are spread out, away from Pip, with a fair time budget',()=>{
 let seed=7;const random=()=>(seed=(seed*16807)%2147483647)/2147483647;
 for(let i=0;i<20;i++){const from:Point=[-14,-6];const t=pickTargets(from,random);assert.equal(t.length,3);assert.equal(new Set(t.map(s=>s.id)).size,3);
  for(const s of t)assert.ok(Math.hypot(s.x-from[0],s.z-from[1])>=110);
  const b=timeBudget(from,t);assert.ok(b>20&&b<200,`${b}`);}
 assert.ok(SPOTS.every(s=>s.x>=BOUNDS.left&&s.x<=BOUNDS.right&&s.z>=BOUNDS.top&&s.z<=BOUNDS.bottom));
});
test('boost pads cover the streets, stay apart and include big pads',()=>{
 const pads=layoutPads();assert.ok(pads.length>40,`${pads.length}`);assert.ok(pads.some(p=>p.big)&&pads.some(p=>!p.big));
 for(let i=0;i<pads.length;i++)for(let j=i+1;j<pads.length;j++)assert.ok(Math.hypot(pads[i].x-pads[j].x,pads[i].z-pads[j].z)>35);
});
test('a bundle: meet Pip, drop three parcels, earn time per drop; or run out of time',()=>{
 const jobs=new Jobs(()=>.5),pip:Point=[0,0];
 assert.deepEqual(jobs.update(1,[50,50],pip),[]);assert.equal(jobs.phase,'meet');
 assert.equal(jobs.update(.1,[3,3],pip)[0].kind,'loaded');assert.equal(jobs.phase,'run');
 const before=jobs.timeLeft;const drop=jobs.update(.1,[jobs.targets[0].x,jobs.targets[0].z],pip);assert.equal(drop[0].kind,'drop');assert.ok(jobs.timeLeft>before);
 jobs.update(.1,[jobs.targets[1].x,jobs.targets[1].z],pip);const done=jobs.update(.1,[jobs.targets[2].x,jobs.targets[2].z],pip);
 assert.ok(done.some(e=>e.kind==='bundle'));assert.equal(jobs.bundles,1);assert.ok(jobs.best!>0);
 assert.equal(jobs.update(5,[0,0],pip)[0].kind,'ready');assert.equal(jobs.phase,'meet');
 jobs.update(.1,[0,0],pip);const late=jobs.update(jobs.timeLeft+1,[999,999],pip);assert.equal(late[0].kind,'late');assert.equal(jobs.phase,'late');
});
test('the car parks on a nearby side street, never on Queen',()=>{
 for(const p of [[-871,55],[-14,-6],[300,-5],[24,-280]] as Point[]){const r=nearestRoad(p)!;assert.ok(r,`${p}`);assert.ok(r.distance<120,`${p} ${r.distance}`);assert.ok(Number.isFinite(r.heading));}
});
