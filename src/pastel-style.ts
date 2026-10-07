import * as T from 'three';
import {installWindowDepth} from './window-depth';
import {installStreetSurface} from './street-materials';
//The selected concept is a palette and lighting treatment. It never changes
//a mapped footprint or replaces documented signage with concept-art guesses.
export const PASTEL={fog:0xe6b1a0,sky:0x9dafe4,sun:0xffc88a,hemi:0xd6c5f0,ground:0xcb987f,exposure:1.04};
export function makePastelSky(){
 const mat=new T.ShaderMaterial({side:T.BackSide,depthWrite:false,depthTest:true,fog:false,uniforms:{top:{value:new T.Color(PASTEL.sky)},cloudMap:{value:null},cloudReady:{value:0}},vertexShader:`varying vec3 vDirection;void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`
 varying vec3 vDirection;uniform vec3 top;uniform sampler2D cloudMap;uniform float cloudReady;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
 float cloud(vec2 p){float n=0.,a=.54;for(int i=0;i<4;i++){n+=noise(p)*a;p=p*2.07+vec2(11.7,4.3);a*=.49;}return n;}
 void main(){vec3 d=normalize(vDirection),sun=normalize(vec3(-64.,19.,4.));float h=d.y;float glow=pow(max(dot(d,sun),0.),7.);vec3 horizon=mix(vec3(.92,.40,.35),vec3(1.18,.69,.35),glow);vec3 c=mix(horizon,top,smoothstep(-.02,.48,h));
 if(h>.015){
 float body;float lit;
 if(cloudReady>.5){
  // A CC0 sky supplies natural cloud structure. Palette is authored for the
  // chosen animation treatment; no photographed geography is introduced.
  vec2 uv=vec2(fract(atan(d.z,d.x)/6.2831853+.5+.2865),asin(clamp(d.y,-1.,1.))/3.14159265+.5);
  vec3 sampleSky=texture2D(cloudMap,uv).rgb;
  float neutral=(sampleSky.r+sampleSky.g)*.5/max(sampleSky.b,.001);
  body=smoothstep(.56,.85,neutral)*smoothstep(.01,.06,h);
  float energy=dot(sampleSky,vec3(.2126,.7152,.0722));
  lit=clamp(pow(energy/(energy+4.5),.8),0.,1.);
 }else{
  float n=cloud(d.xz/(h+.28)*3.2);body=smoothstep(.455,.615,n);lit=clamp((n-.42)*3.,0.,1.);
 }
 vec3 shade=mix(vec3(.30,.14,.27),vec3(1.75,.84,.39),lit);
 shade+=vec3(.35,.18,.055)*glow*pow(lit,3.);
 c=mix(c,shade,body);
 }
 c+=vec3(1.,.58,.22)*pow(max(dot(d,sun),0.),900.)*.55;gl_FragColor=vec4(c,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`});
 //At8.8km the dome remains behind the real-position CN Tower and city roofs.
 const mesh=new T.Mesh(new T.SphereGeometry(8800,32,20),mat);mesh.position.set(-180,0,-100);mesh.renderOrder=-100;mesh.frustumCulled=false;return {mesh,top:mat.uniforms.top};
}
// Each material is styled once, even when streamed map tiles bring it in later.
const seen=new WeakSet<T.Material>();
export function applyPastelMaterials(root:T.Object3D){
root.traverse(o=>{if(!(o instanceof T.Mesh))return;for(const mat of Array.isArray(o.material)?o.material:[o.material]){
  if(seen.has(mat)||!(mat instanceof T.MeshStandardMaterial))continue;seen.add(mat);
  if(mat.userData.streetSurface)installStreetSurface(mat,mat.userData.streetSurface);
  if(mat.userData.roomColumns)installWindowDepth(mat,mat.userData.roomColumns);
  //A slight soft fill lifts deep corners into lavender while retaining the
  //albedo of stone, graffiti, painted timber and brick. No extra render pass.
  const foliage=mat.alphaTest>.3&&mat.side===T.DoubleSide;if(foliage)mat.alphaToCoverage=true;const previous=mat.onBeforeCompile,previousKey=mat.customProgramCacheKey();mat.onBeforeCompile=(shader,renderer)=>{previous.call(mat,shader,renderer);shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`${foliage?'outgoingLight += diffuseColor.rgb * vec3(.095,.055,.025);':''}\noutgoingLight += diffuseColor.rgb * vec3(0.017,0.009,0.039) * (1.0-metalnessFactor);\n#include <opaque_fragment>`);};
  mat.customProgramCacheKey=()=> `queen-pastel-v3-${previousKey}`;mat.needsUpdate=true;
  if(mat.normalMap)mat.normalScale.multiplyScalar(.95);
 }});
}
