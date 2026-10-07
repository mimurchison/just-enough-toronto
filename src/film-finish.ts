import * as T from 'three';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {DepthOfField} from './depth-of-field';
import type {ContactOcclusion} from './contact-occlusion';

// Keep illumination in linear HDR until the final output. A small highlight
// diffusion softens sunlit edges; ACES and sRGB conversion happen only once.
export class FilmFinish {
 private target=new T.WebGLRenderTarget(1,1,{type:T.HalfFloatType,samples:4});
 private bloom=new UnrealBloomPass(new T.Vector2(1,1),.16,.55,1.08);
 private output=new OutputPass();
 private focus?:DepthOfField;
 private subject=new T.Vector3();
 /** Lower graphics tiers skip the 64-tap focus gather but keep bloom and tone mapping. */
 depthOfField=true;
 constructor(){if(new URLSearchParams(location.search).get('dof')!=='off'){this.focus=new DepthOfField();this.target.depthTexture=new T.DepthTexture(1,1,T.UnsignedIntType);}this.output.renderToScreen=true;this.bloom.renderToScreen=false;}
 resize(w:number,h:number,pixelRatio=1){this.target.setSize(w,h);this.focus?.resize(w,h,pixelRatio);this.bloom.setSize(Math.max(1,Math.round(w*.5)),Math.max(1,Math.round(h*.5)));}
 render(renderer:T.WebGLRenderer,scene:T.Scene,camera:T.PerspectiveCamera,ao?:ContactOcclusion,subject?:T.Vector3,overview=false){
  const autoReset=renderer.info.autoReset;renderer.info.autoReset=false;renderer.info.reset();
  let colorPass={calls:0,triangles:0};
  try{renderer.setRenderTarget(this.target);renderer.render(scene,camera);
   // Disable automatic resets before the beauty pass: Three resets its
   // counters after shadows otherwise, hiding their cost from our benchmark.
   colorPass={calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};
   ao?.render(renderer,this.target);this.bloom.render(renderer,this.target,this.target,0,false);const finished=this.focus&&this.depthOfField&&subject?this.focus.render(renderer,this.target,camera,this.subject.copy(subject).add(new T.Vector3(0,.58,0)),overview):this.target;this.output.render(renderer,finished,finished,0,false);}
  finally{renderer.info.autoReset=autoReset;renderer.setRenderTarget(null);}
  return colorPass;
 }
 diagnostics(){return this.depthOfField&&this.focus?.diagnostics()||null;}
 dispose(){this.focus?.dispose();this.target.dispose();this.bloom.dispose();this.output.dispose();}
}
