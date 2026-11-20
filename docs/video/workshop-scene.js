// Deterministic Three.js sequence. Call frame(timeInSeconds) before capturing.
const world = new THREE.Scene(), camera = new THREE.PerspectiveCamera(39, 16/9, .1, 90);
world.background = new THREE.Color(0x343448);
world.fog = new THREE.FogExp2(0x504558,.036);
const gl = new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
gl.setSize(960,540); document.body.style.margin='0'; document.body.append(gl.domElement);
const V=(x,y,z)=>new THREE.Vector3(x,y,z);
function group(parent=world){const g=new THREE.Group();parent.add(g);return g}
function mesh(geo,color,x,y,z,parent=world){const o=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color,flatShading:true}));o.position.set(x,y,z);parent.add(o);return o}
function box(x,y,z,w,h,l,c,p){return mesh(new THREE.BoxGeometry(w,h,l),c,x,y,z,p)}
function oval(x,y,z,w,h,l,c,p){const o=mesh(new THREE.SphereGeometry(1,12,10),c,x,y,z,p);o.scale.set(w,h,l);return o}
function panel(text,x,y,z,w,h,bg,fg,parent=world){const cv=document.createElement('canvas');cv.width=1024;cv.height=256;const ctx=cv.getContext('2d');ctx.fillStyle=bg;ctx.fillRect(0,0,1024,256);ctx.fillStyle=fg;ctx.font='bold 84px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,128,975);const tex=new THREE.CanvasTexture(cv);tex.colorSpace=THREE.SRGBColorSpace;const o=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:tex,side:THREE.DoubleSide}));o.position.set(x,y,z);parent.add(o);return o}
world.add(new THREE.HemisphereLight(0xffddd0,0x646789,2.2));const sun=new THREE.DirectionalLight(0xffbc77,3);sun.position.set(-6,9,5);world.add(sun);
box(0,-.18,0,80,.3,80,0x41404a);
for(let i=-5;i<7;i++){let x=i*4;box(x,2,-5,3.94,4,4,i%2?0x928378:0x667b80);box(x,1.3,-2.96,3.1,2.5,.05,0x38464b);for(let j=0;j<12;j++)box(x,.28+j*.18,-2.90,3.05,.034,.04,0x647074);box(x,3.1,-2.8,4,.13,1.4,0x805347);box(x+.8,4.8,-5,1.1,1.55,1.1,0x333a47);box(x,0,2.7,3.5,.02,.09,0xb39e84)}
panel('KOVAI  /  METAL WORKS',0,3.65,-2.90,3.8,.68,'#263c3d','#f4d396');
for(let x of [-1.45,1.45])for(let z of [-1.65,-.75])box(x,.49,z,.10,.97,.10,0x383a42);
box(0,1,-1.2,3.3,.15,1.2,0x887666);box(-.7,1.2,-1.4,.55,.25,.4,0x34616a);
const actor=group(),skin=0xa56142,shirt=0x14646a,denim=0x253447;
box(0,1.25,0,.57,.67,.36,shirt,actor);box(0,1.02,0,.54,.1,.38,0x483528,actor);
oval(0,1.83,0,.235,.30,.215,skin,actor);oval(0,2.02,-.035,.25,.18,.23,0x242029,actor);oval(0,1.82,.204,.064,.065,.07,skin,actor);
for(let side of [-1,1])oval(side*.09,1.89,.188,.03,.02,.021,0x28242a,actor);
const limbs=[];for(let s of [-1,1]){const hip=group(actor);hip.position.set(s*.155,.98,0);box(0,-.22,0,.22,.45,.24,denim,hip);const knee=group(hip);knee.position.y=-.43;box(0,-.21,0,.17,.42,.21,denim,knee);box(0,-.42,.065,.22,.13,.34,0x302826,knee);const shoulder=group(actor);shoulder.position.set(s*.36,1.51,0);box(0,-.14,0,.2,.30,.24,shirt,shoulder);const elbow=group(shoulder);elbow.position.y=-.28;elbow.rotation.x=-.24;box(0,-.16,0,.15,.34,.16,skin,elbow);oval(0,-.34,0,.085,.11,.085,skin,elbow);limbs.push({s,hip,knee,shoulder})}
const shadow=oval(0,.003,0,.68,.018,.28,0x30303a);
const paper=group();paper.position.set(.5,1.09,-.95);paper.rotation.x=-1.24;panel('TECHNICAL REVIEW',0,.14,0,.75,.23,'#f4ebcc','#332f34',paper);panel('CERTIFICATE EXPIRED',0,-.08,0,.75,.22,'#f4ebcc','#9b3c31',paper);
const title=document.createElement('div');title.style.cssText='position:absolute;left:5%;bottom:8%;color:#fff1d7;font:700 29px Georgia;text-shadow:0 2px 7px #000;border-left:4px solid #ebae62;padding-left:14px';document.body.append(title);
window.frame=t=>{const walk=Math.min(t,16),phase=walk*5.5,amp=Math.min(1,Math.max(0,16-t));actor.position.set(-6+walk*.40,.04+.035*Math.abs(Math.sin(phase))*amp, .32);actor.rotation.y=1.57+Math.max(0,Math.min(1,(t-16)/2))*1.47;shadow.position.x=actor.position.x;shadow.position.z=.32;
for(let l of limbs){let a=l.s*Math.sin(phase)*amp;l.hip.rotation.x=.56*a;l.knee.rotation.x=.62*Math.max(0,-a);l.shoulder.rotation.x=-.56*a}
let x=actor.position.x;if(t<7){camera.position.set(x+4,1.0+t*.12,5.8-t*.16);camera.lookAt(x,1.1,0)}else if(t<16){let a=(t-7)*.16;camera.position.set(x+3*Math.cos(a),1.52,2.8+2*Math.sin(a));camera.lookAt(x,1.15,0)}else if(t<21){camera.position.set(x+2.5-(t-16)*.2,2.6,3-(t-16)*.3);camera.lookAt(.25,1.25,-.6)}else{let k=Math.min(1,(t-21)/5);camera.position.set(.58,2.35-.49*k,-.10-.42*k);camera.lookAt(.50,1.12,-.95)}title.textContent=t<6?'Coimbatore  /  Arun’s first workshop':t<13?'His first government tender':t<21?'A price he could stand behind.':'One certificate had expired.';gl.render(world,camera)};
