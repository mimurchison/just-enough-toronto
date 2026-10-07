import * as T from 'three';
import {SSAOPass} from 'three/addons/postprocessing/SSAOPass.js';

// AO clips its depth range for precision, but must match the beauty lens in X/Y.
export function syncContactProjection(source:T.PerspectiveCamera,target:T.PerspectiveCamera){
 target.fov=source.fov;target.aspect=source.aspect;target.zoom=source.zoom;target.updateProjectionMatrix();
 target.projectionMatrix.elements[8]=source.projectionMatrix.elements[8];
 target.projectionMatrix.elements[9]=source.projectionMatrix.elements[9];
 target.projectionMatrixInverse.copy(target.projectionMatrix).invert();
}

// A short-range contact pass makes sills, cornices, tyres and wall bases read
// as geometry. It does not change source geometry or pretend to add scan data.
export class ContactOcclusion {
 private pass:SSAOPass;
 private normalCamera:T.PerspectiveCamera;
 private excluded:T.Mesh[]=[];
 constructor(private scene:T.Scene,private camera:T.PerspectiveCamera){
  this.normalCamera=camera.clone();this.normalCamera.far=90;this.normalCamera.updateProjectionMatrix();
  this.pass=new SSAOPass(scene,this.normalCamera,512,512,24);this.pass.renderToScreen=true;
  this.pass.kernelRadius=.75;this.pass.minDistance=.018/90;this.pass.maxDistance=1.15/90;
  this.pass.ssaoMaterial.fragmentShader=this.pass.ssaoMaterial.fragmentShader.replace('1.0 - occlusion','1.0 - occlusion * 0.64');
  // A normal override cannot sample each foliage card's alpha mask. Exclude
  // cutouts and glass from this pass instead of casting rectangular leaf AO.
  // Distant fog-exempt skyline meshes cannot create local contact shadows.
  this.scan(scene);
 }
 /** Apply the cutout/glass/skyline exclusion to meshes added after construction (streamed map tiles). */
 scan(root:T.Object3D){root.traverse(o=>{if(o instanceof T.Mesh&&!Array.isArray(o.material)&&(o.material.transparent||o.material.alphaTest>0||!o.material.fog)&&!this.excluded.includes(o))this.excluded.push(o);});}
 /** Later additions that should not darken their surroundings (glows, beacons). */
 exclude(o:T.Object3D){o.traverse(m=>{if(m instanceof T.Mesh&&!this.excluded.includes(m))this.excluded.push(m);});}
 resize(width:number,height:number){this.normalCamera.aspect=this.camera.aspect;this.normalCamera.updateProjectionMatrix();this.pass.setSize(Math.max(1,Math.round(width*.70)),Math.max(1,Math.round(height*.70)));}
 render(renderer:T.WebGLRenderer,target?:T.WebGLRenderTarget){
  this.normalCamera.position.copy(this.camera.position);this.normalCamera.quaternion.copy(this.camera.quaternion);
  syncContactProjection(this.camera,this.normalCamera);
  this.pass.ssaoMaterial.uniforms.cameraProjectionMatrix.value.copy(this.normalCamera.projectionMatrix);
  this.pass.ssaoMaterial.uniforms.cameraInverseProjectionMatrix.value.copy(this.normalCamera.projectionMatrixInverse);
  const hidden=this.excluded.filter(o=>o.visible);for(const o of hidden)o.visible=false;
  const autoShadow=renderer.shadowMap.autoUpdate,autoReset=renderer.info.autoReset;renderer.shadowMap.autoUpdate=false;renderer.info.autoReset=false;
  try{this.pass.renderToScreen=!target;this.pass.render(renderer,this.pass.ssaoRenderTarget,target||this.pass.ssaoRenderTarget,0,false);}
  finally{for(const o of hidden)o.visible=true;renderer.shadowMap.autoUpdate=autoShadow;renderer.info.autoReset=autoReset;renderer.setRenderTarget(null);}
 }
 dispose(){this.pass.dispose();}
}
