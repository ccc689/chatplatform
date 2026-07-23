/**
 * Galaxy WebGL Background — Star field with mouse interaction
 * Loaded as ES module via import map
 */
import { Renderer, Program, Mesh, Color, Triangle } from 'https://esm.sh/ogl@1.0.11';

const container = document.getElementById('galaxyBg');
if (!container) throw new Error('#galaxyBg not found');

let renderer, program, mesh, gl, animateId;
let targetMX = 0.5, targetMY = 0.5;
let smoothMX = 0.5, smoothMY = 0.5;
let targetActive = 0, smoothActive = 0;

// --- Shaders ---
const vert = /* glsl */`
attribute vec2 uv;
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0, 1);
}`;

const frag = /* glsl */`
precision highp float;
uniform float uTime;
uniform vec3 uResolution;
uniform vec2 uFocal;
uniform vec2 uRotation;
uniform float uStarSpeed;
uniform float uDensity;
uniform float uHueShift;
uniform float uSpeed;
uniform vec2 uMouse;
uniform float uGlowIntensity;
uniform float uSaturation;
uniform float uMouseRepulsion;
uniform float uTwinkleIntensity;
uniform float uRotationSpeed;
uniform float uRepulsionStrength;
uniform float uMouseActiveFactor;
varying vec2 vUv;

#define NUM_LAYER 4.0
#define MAT45 mat2(0.7071,-0.7071,0.7071,0.7071)
#define PERIOD 3.0

float Hash21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float tri(float x){return abs(fract(x)*2.0-1.0);}
float tris(float x){float t=fract(x);return 1.0-smoothstep(0.0,1.0,abs(2.0*t-1.0));}
float trisn(float x){float t=fract(x);return 2.0*(1.0-smoothstep(0.0,1.0,abs(2.0*t-1.0)))-1.0;}
vec3 hsv2rgb(vec3 c){vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0);vec3 p=abs(fract(c.xxx+K.xyz)*6.0-K.www);return c.z*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),c.y);}

float Star(vec2 uv,float flare){
  float d=length(uv);
  float m=(0.05*uGlowIntensity)/d;
  float rays=smoothstep(0.0,1.0,1.0-abs(uv.x*uv.y*1000.0));
  m+=rays*flare*uGlowIntensity;
  uv*=MAT45;
  rays=smoothstep(0.0,1.0,1.0-abs(uv.x*uv.y*1000.0));
  m+=rays*0.3*flare*uGlowIntensity;
  m*=smoothstep(1.0,0.2,d);
  return m;
}

vec3 StarLayer(vec2 uv){
  vec3 col=vec3(0.0);
  vec2 gv=fract(uv)-0.5;
  vec2 id=floor(uv);
  for(int y=-1;y<=1;y++){
    for(int x=-1;x<=1;x++){
      vec2 si=id+vec2(float(x),float(y));
      float seed=Hash21(si);
      float size=fract(seed*345.32);
      float glossLocal=tri(uStarSpeed/(PERIOD*seed+1.0));
      float flareSize=smoothstep(0.9,1.0,size)*glossLocal;
      float red=smoothstep(0.2,1.0,Hash21(si+1.0))+0.2;
      float blu=smoothstep(0.2,1.0,Hash21(si+3.0))+0.2;
      float grn=min(red,blu)*seed;
      vec3 base=vec3(red,grn,blu);
      float hue=atan(base.g-base.r,base.b-base.r)/(2.0*3.14159)+0.5;
      hue=fract(hue+uHueShift/360.0);
      float sat=length(base-vec3(dot(base,vec3(0.299,0.587,0.114))))*uSaturation;
      float val=max(max(base.r,base.g),base.b);
      base=hsv2rgb(vec3(hue,sat,val));
      vec2 pad=vec2(tris(seed*34.0+uTime*uSpeed/10.0),tris(seed*38.0+uTime*uSpeed/30.0))-0.5;
      float star=Star(gv-pad,flareSize);
      float twinkle=trisn(uTime*uSpeed+seed*6.2831)*0.5+1.0;
      twinkle=mix(1.0,twinkle,uTwinkleIntensity);
      star*=twinkle;
      col+=star*size*base;
    }
  }
  return col;
}

void main(){
  vec2 focalPx=uFocal*uResolution.xy;
  vec2 uv=(vUv*uResolution.xy-focalPx)/uResolution.y;
  vec2 mouseNorm=uMouse-vec2(0.5);
  if(uMouseRepulsion>0.0){
    vec2 mp=(uMouse*uResolution.xy-focalPx)/uResolution.y;
    float md=length(uv-mp);
    vec2 rp=normalize(uv-mp)*(uRepulsionStrength/(md+0.1));
    uv+=rp*0.05*uMouseActiveFactor;
  }else{
    uv+=mouseNorm*0.1*uMouseActiveFactor;
  }
  float ar=uTime*uRotationSpeed;
  mat2 autoRot=mat2(cos(ar),-sin(ar),sin(ar),cos(ar));
  uv=autoRot*uv;
  uv=mat2(uRotation.x,-uRotation.y,uRotation.y,uRotation.x)*uv;
  vec3 col=vec3(0.0);
  for(float i=0.0;i<1.0;i+=1.0/NUM_LAYER){
    float depth=fract(i+uStarSpeed*uSpeed);
    float scale=mix(20.0*uDensity,0.5*uDensity,depth);
    float fade=depth*smoothstep(1.0,0.9,depth);
    col+=StarLayer(uv*scale+i*453.32)*fade;
  }
  float alpha=length(col);
  alpha=smoothstep(0.0,0.3,alpha);
  alpha=min(alpha,1.0);
  gl_FragColor=vec4(col,alpha);
}`;

// --- Init ---
function resize() {
  if (!renderer) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  if (program && gl) {
    program.uniforms.uResolution.value = new Color(
      gl.canvas.width, gl.canvas.height,
      gl.canvas.width / Math.max(gl.canvas.height, 1)
    );
  }
}

renderer = new Renderer({ alpha: true, premultipliedAlpha: false });
gl = renderer.gl;
gl.clearColor(0, 0, 0, 0);

const geometry = new Triangle(gl);
program = new Program(gl, {
  vertex: vert,
  fragment: frag,
  uniforms: {
    uTime: { value: 0 },
    uResolution: { value: new Color(1, 1, 1) },
    uFocal: { value: new Float32Array([0.5, 0.5]) },
    uRotation: { value: new Float32Array([1.0, 0.0]) },
    uStarSpeed: { value: 0.5 },
    uDensity: { value: 1.0 },
    uHueShift: { value: 140 },
    uSpeed: { value: 1.0 },
    uMouse: { value: new Float32Array([0.5, 0.5]) },
    uGlowIntensity: { value: 0.3 },
    uSaturation: { value: 0.0 },
    uMouseRepulsion: { value: 1.0 },
    uTwinkleIntensity: { value: 0.3 },
    uRotationSpeed: { value: 0.1 },
    uRepulsionStrength: { value: 2.0 },
    uMouseActiveFactor: { value: 0.0 }
  }
});

mesh = new Mesh(gl, { geometry, program });
resize();
window.addEventListener('resize', resize);

gl.canvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:0;pointer-events:none;';
container.appendChild(gl.canvas);
console.log('[Galaxy] WebGL star field initialized');

// --- Animation loop ---
function update(t) {
  animateId = requestAnimationFrame(update);
  program.uniforms.uTime.value = t * 0.001;
  program.uniforms.uStarSpeed.value = (t * 0.001 * 0.5) / 10.0;

  smoothMX += (targetMX - smoothMX) * 0.04;
  smoothMY += (targetMY - smoothMY) * 0.04;
  smoothActive += (targetActive - smoothActive) * 0.04;

  program.uniforms.uMouse.value[0] = smoothMX;
  program.uniforms.uMouse.value[1] = smoothMY;
  program.uniforms.uMouseActiveFactor.value = smoothActive;

  renderer.render({ scene: mesh });
}

// --- Mouse ---
document.addEventListener('mousemove', (e) => {
  targetMX = e.clientX / window.innerWidth;
  targetMY = 1.0 - e.clientY / window.innerHeight;
  targetActive = 1.0;
}, { passive: true });
document.addEventListener('mouseleave', () => { targetActive = 0.0; });

animateId = requestAnimationFrame(update);
