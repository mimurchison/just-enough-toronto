import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {renderScale,GRAPHICS,QUALITY_LEVELS,describeGpu} from '../src/render-quality';
import {makeGoldenSun,followGoldenSun,SUN_DIRECTION} from '../src/golden-hour';
test('high quality preserves Retina detail; large screens obey a pixel budget',()=>{
 assert.equal(renderScale('high',2,1440,960),2);
 assert.equal(renderScale('cinematic',1,1440,960),2);
 assert.equal(renderScale('low',2,1440,960),1);
 for(const q of QUALITY_LEVELS){const s=renderScale(q,3,5120,2880);assert.ok(s>0&&s*s*5120*2880<=(q==='low'?1600000:q==='balanced'?2800000:q==='high'?6500000:10000000)+.01);}
});
test('the golden-hour shadow camera covers the street and maintains one sun direction',()=>{
 const sun=makeGoldenSun(0xffffff);assert.equal(sun.shadow.camera.projectionMatrix.elements[0],1/90);
 for(const p of [[-918,0,55],[302,0,-5.2],[0,0,-180]]){followGoldenSun(sun,new T.Vector3(...p));assert.ok(sun.position.clone().sub(sun.target.position).normalize().distanceTo(SUN_DIRECTION)<1e-10);}
});
test('each graphics tier costs no more than the one above it, and High keeps the authored look',()=>{
 assert.deepEqual(GRAPHICS.high,{shadowMap:4096,contactOcclusion:true,post:true,depthOfField:true,lod:{foliage:180,detail:280,far:1400,fog:1900}});
 for(let i=1;i<QUALITY_LEVELS.length;i++){const lo=GRAPHICS[QUALITY_LEVELS[i-1]],hi=GRAPHICS[QUALITY_LEVELS[i]];
  assert.ok(lo.shadowMap<=hi.shadowMap&&+lo.contactOcclusion<=+hi.contactOcclusion&&+lo.post<=+hi.post&&+lo.depthOfField<=+hi.depthOfField);
  for(const k of ['foliage','detail','far','fog'] as const)assert.ok(lo.lod[k]<=hi.lod[k],`${QUALITY_LEVELS[i-1]} ${k}`);}
 // Far tiles take over where detail ends, and the fog hides where they end.
 for(const q of QUALITY_LEVELS){const l=GRAPHICS[q].lod;assert.ok(l.foliage<=l.detail&&l.detail<l.far&&l.far<=l.fog,q);}
});
test('names the GPU the browser actually renders on, and spots integrated or software ones',()=>{
 assert.deepEqual(describeGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Laptop GPU (0x00002860) Direct3D11 vs_5_0 ps_5_0, D3D11)'),{name:'NVIDIA GeForce RTX 4070 Laptop GPU',kind:'dedicated'});
 assert.deepEqual(describeGpu('ANGLE (Intel, Intel(R) UHD Graphics (0x0000A788) Direct3D11 vs_5_0 ps_5_0, D3D11)'),{name:'Intel(R) UHD Graphics',kind:'integrated'});
 assert.equal(describeGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)').kind,'software');
 assert.equal(describeGpu('ANGLE (Apple, ANGLE Metal Renderer: Apple M5, Unspecified Version)').name,'Apple M5');
 assert.equal(describeGpu('ANGLE (Apple, ANGLE Metal Renderer: Apple M5, Unspecified Version)').kind,'dedicated');
 assert.equal(describeGpu('ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics (0x000056A0) Direct3D11 vs_5_0 ps_5_0, D3D11)').kind,'dedicated');
});
