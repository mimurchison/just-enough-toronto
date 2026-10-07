export type RenderQuality='low'|'balanced'|'high'|'cinematic';
export const QUALITY_LEVELS:RenderQuality[]=['low','balanced','high','cinematic'];
export const QUALITY_NAMES:Record<RenderQuality,string>={low:'Low',balanced:'Balanced',high:'High',cinematic:'Cinematic'};

// What each tier pays for. High is the authored look; the tiers below it drop
// the most expensive passes first (the SSAO normal re-render, then the post
// stack and the shadow pass) before shortening how far the street is drawn.
// Cinematic only adds resolution and distance, never a different look.
export type GraphicsProfile={
 /** Sun shadow map edge in texels; 0 turns the shadow pass off. */
 shadowMap:number;
 /** Short-range SSAO: a second full scene render each frame. */
 contactOcclusion:boolean;
 /** HDR target, bloom and output pass. Off renders straight to the canvas. */
 post:boolean;
 depthOfField:boolean;
 lod:LevelOfDetail;
};
/** Level of detail, in metres from Pip: where each layer of the street stops being drawn. */
export type LevelOfDetail={
 /** Fallen leaves and autumn ground cover. */
 foliage:number;
 /** Sills, mullions, signage and street furniture. */
 detail:number;
 /** Simplified far tiles stand in for detail tiles out to here. */
 far:number;
 /** The fog closes here; whole map tiles beyond it are skipped. */
 fog:number;
};
export const GRAPHICS:Record<RenderQuality,GraphicsProfile>={
 low:{shadowMap:0,contactOcclusion:false,post:false,depthOfField:false,lod:{foliage:110,detail:170,far:950,fog:1000}},
 balanced:{shadowMap:2048,contactOcclusion:false,post:true,depthOfField:true,lod:{foliage:150,detail:230,far:1200,fog:1500}},
 high:{shadowMap:4096,contactOcclusion:true,post:true,depthOfField:true,lod:{foliage:180,detail:280,far:1400,fog:1900}},
 cinematic:{shadowMap:4096,contactOcclusion:true,post:true,depthOfField:true,lod:{foliage:220,detail:360,far:1900,fog:1900}},
};
export function renderScale(quality:RenderQuality,dpr:number,width:number,height:number){
 const desired=quality==='low'?Math.min(dpr,1):quality==='balanced'?Math.min(dpr,1.25):quality==='cinematic'?Math.min(Math.max(dpr,2),2.5):Math.min(Math.max(dpr,1.5),2);
 const budget=quality==='low'?1600000:quality==='balanced'?2800000:quality==='cinematic'?10000000:6500000;
 return Math.min(desired,Math.sqrt(budget/Math.max(1,width*height)));
}
export const isRenderQuality=(q:unknown):q is RenderQuality=>QUALITY_LEVELS.includes(q as RenderQuality);
export function savedQuality():RenderQuality{
 try{const q=new URLSearchParams(location.search).get('quality')||localStorage.getItem('enough-graphics');if(isRenderQuality(q))return q;}catch{/* Rendering also works when browser storage is unavailable. */}
 return 'high';
}

// Laptops with two GPUs often run the browser on the weak integrated one: the game
// asks for 'high-performance', but Windows browsers ignore that. Naming the GPU lets
// the menu show what is actually rendering, and lets the game suggest the fix.
export type GpuKind='software'|'integrated'|'dedicated';
export function describeGpu(raw:string):{name:string;kind:GpuKind}{
 const angle=raw.match(/^ANGLE \([^,]*,\s*(.+?)(?:\s*\(0x[0-9a-f]+\))?\s*(?:Direct3D|OpenGL|Vulkan|,|\)$)/i);
 const name=(angle?.[1]??raw).replace(/^ANGLE Metal Renderer:\s*/i,'').trim();
 const kind:GpuKind=/swiftshader|llvmpipe|softpipe|basic render|software/i.test(raw)?'software'
  :/intel|uhd|iris|radeon\(tm\) graphics|radeon graphics|vega \d|mali|adreno/i.test(raw)&&!/\barc\b/i.test(raw)?'integrated':'dedicated';
 return {name,kind};
}
