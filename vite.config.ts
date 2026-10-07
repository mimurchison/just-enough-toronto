import { defineConfig } from 'vite';
export default defineConfig({
 base:'./',
 plugins:[{
  name:'private-reference-metadata',
  enforce:'pre',
  apply:'build',
  transform(code,id){
   if(!id.includes('/src/')||!id.endsWith('.ts'))return;
   return code
    .replace(/User video, reference collection; references\/video\/manifest\.json/g,'Photo and video references — Mike Murchison (@mimurchison)')
    .replace(/IMG_\d+(?:\.(?:mov|mp4))?(?:[ :,]+\d+(?:[–-]\d+)?s?)?/gi,'Video reference')
    .replace(/reference collection video-informed/g,'Video-informed');
  },
 }],
 server:{port:5178,strictPort:true},
 // The car loader stays with the lazily loaded Rush chunk, out of the shared three.js chunk.
 build:{target:'esnext',rollupOptions:{output:{manualChunks(id){if(id.includes('/node_modules/three/')&&!/GLTFLoader|meshopt_decoder/.test(id))return 'three';}}}},
});
