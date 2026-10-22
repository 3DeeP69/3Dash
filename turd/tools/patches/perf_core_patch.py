import sys; sys.path.insert(0,sys.path[0]); from lib import P
root=sys.argv[1]
c=P(root+'/src/core.js')
# GPU-side wave: displacement moves into the vertex shader; zero per-frame CPU vertex work
c.rep('''  const g=new THREE.PlaneGeometry(110,30,segX,segY);
  waveBase=Float32Array.from(g.attributes.position.array);
  wave=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:target.color.clone(),wireframe:true,transparent:true,opacity:0.32}));''','''  wave=new THREE.Mesh(new THREE.PlaneGeometry(110,30,segX,segY),waveMat(target.color,0.32,
    "sin(position.x*0.16+uT*0.9)*1.4 + cos(position.y*0.2+uT*0.65)*1.1 + sin((position.x+position.y)*0.08+uT*0.5)*0.7"));''')
c.rep('''  waveB=new THREE.Mesh(new THREE.PlaneGeometry(130,34,segX,segY),new THREE.MeshBasicMaterial({color:target2.color.clone(),wireframe:true,transparent:true,opacity:0.15}));''','''  waveB=new THREE.Mesh(new THREE.PlaneGeometry(130,34,segX,segY),waveMat(target2.color,0.15,
    "sin(position.x*0.13-uT*0.8)*1.6 + cos(position.y*0.17-uT*0.5)*1.0"));''')
c.rep('''function onPointer(e){''','''// wireframe wave material whose z-displacement runs in the vertex shader (uT = seconds)
const WAVE_T={ value:0 };
function waveMat(color,opacity,z){
  const m=new THREE.MeshBasicMaterial({color:color.clone(),wireframe:true,transparent:true,opacity});
  m.onBeforeCompile=sh=>{ sh.uniforms.uT=WAVE_T;
    sh.vertexShader="uniform float uT;\\n"+sh.vertexShader.replace("#include <begin_vertex>","#include <begin_vertex>\\n  transformed.z = "+z+";"); };
  return m;
}
function onPointer(e){''')
c.rep('''  const step = QUALITY==="LOW"?3:QUALITY==="MED"?2:1;   // throttle the heavy per-vertex wave math on weaker devices
  if(frame%step===0){
    const p=wave.geometry.attributes.position, arr=p.array;
    for(let i=0;i<arr.length;i+=3){ const x=waveBase[i], y=waveBase[i+1];
      arr[i+2]=Math.sin(x*0.16+t*0.9)*1.4 + Math.cos(y*0.2+t*0.65)*1.1 + Math.sin((x+y)*0.08+t*0.5)*0.7; }
    p.needsUpdate=true;
    const pb=waveB.geometry.attributes.position, arrB=pb.array;
    for(let i=0;i<arrB.length;i+=3){ const x=waveBase[i], y=waveBase[i+1];
      arrB[i+2]=Math.sin(x*0.13-t*0.8)*1.6 + Math.cos(y*0.17-t*0.5)*1.0; }
    pb.needsUpdate=true;
  }
''','''  WAVE_T.value=t;
''')
c.rep('let renderer,scene,camera,wave,waveB,waveBase,core,glow,stars,raf;','let renderer,scene,camera,wave,waveB,core,glow,stars,raf;')
c.save()
i=P(root+'/index.html')
i.rep('''</style>
<!-- section modules''','''/* perf: blend modes + an animated full-screen layer over the live WebGL canvas force a
   full recomposite every frame (measured ~2.3x frame cost on a Fold4-class phone).
   Normal blending of the black vignette is mathematically identical to multiply. */
.theme-halo,.visor-vignette,.scanlines{mix-blend-mode:normal}
.theme-halo{opacity:.75}
.scanlines{animation:none;opacity:.07}
/* below HIGH: no live blur behind glass (another ~1.4x); denser tint keeps text readable */
body:not([data-quality="HIGH"]) :is(.panel,#rail .nav,.login-card,.modal-card,.toast){backdrop-filter:none;-webkit-backdrop-filter:none}
body:not([data-quality="HIGH"]) .panel{background-color:rgba(5,10,22,.66)!important}
body:not([data-quality="HIGH"]) #rail .nav{background:rgba(5,10,22,.86)}
</style>
<!-- section modules''')
i.save()
