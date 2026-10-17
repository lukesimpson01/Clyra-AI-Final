import { useEffect, useRef } from "react";
import { cn } from "../lib/utils";

type BrowserAgentAuraProps = {
  active: boolean;
  reducedMotion?: boolean;
  className?: string;
};

const VERTEX_SHADER = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// Adapted from the supplied blue edge-wave prototype. The original painted an
// opaque midnight background; Clyra keeps the page readable and emits only the
// wave/light energy into this transparent overlay.
const FRAGMENT_SHADER = `
precision highp float;
uniform vec2 u_size;
uniform float u_scale;
uniform float u_time;
uniform float u_age;
const float PI = 3.141592653589793;
float hash(vec2 p){p=fract(p*vec2(123.34,345.45));p+=dot(p,p+34.345);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<3;i++){v+=a*noise(p);p=p*2.04+vec2(11.7,8.3);a*=.5;}return v;}
float gauss(float x,float s){return exp(-.5*x*x/(s*s));}
float smooth01(float v){v=clamp(v,0.,1.);return v*v*(3.-2.*v);}
float ease(float v){v=clamp(v,0.,1.);return 1.-pow(1.-v,2.45);}
vec3 blue(float x){
  vec3 a=vec3(.015,.13,.70),b=vec3(.055,.40,1.),c=vec3(.28,.72,1.);
  return x<.5?mix(a,b,x*2.):mix(b,c,(x-.5)*2.);
}
void main(){
 vec2 p=vec2(gl_FragCoord.x,u_size.y*u_scale-gl_FragCoord.y)/u_scale;
 vec2 sz=u_size;float t=u_time,age=u_age;
 vec2 origin=sz*vec2(.5,.50);vec2 v=p-origin;float r=length(v);
 float far=length(sz*.5)+28.;float progress=ease((age-.07)/2.18);float radius=far*progress;
 float wobble=(fbm(p*.013+vec2(t*.21,-t*.16))-.47)*13.+sin(atan(v.y,v.x)*11.+t*1.8)*3.4+sin(p.x*.027+p.y*.018-t*1.3)*2.;
 float front=r-radius-wobble;float intro=(1.-smoothstep(1.75,2.9,age))*smooth01(age/.16);
 float edgeDist=min(min(p.x,sz.x-p.x),min(p.y,sz.y-p.y));
 float crest=gauss(front,4.2),shoulder=gauss(front+16.,12.),wake=gauss(front+49.,32.),outer=gauss(front-11.,16.);
 vec3 wave=blue(.77)*crest*.44+blue(.49)*shoulder*.14+blue(.22)*wake*.065+blue(.60)*outer*.08;
 float fringes=.5+.5*cos(front*.68+fbm(p*.035+t*.08)*2.2);wave+=blue(.91)*gauss(front+6.,13.)*fringes*.048;wave*=intro;
 float ready=smoothstep(17.,-10.,front);ready=max(ready,smooth01((age-2.35)/.35));
 float edgeMask=1.-smoothstep(0.,87.,edgeDist);vec3 light=vec3(0.);
 if(edgeMask>.0001){
   float sideCoord;
   if(edgeDist==p.y)sideCoord=p.x;else if(edgeDist==sz.x-p.x)sideCoord=sz.x+p.y;else if(edgeDist==sz.y-p.y)sideCoord=sz.x+sz.y+(sz.x-p.x);else sideCoord=2.*sz.x+sz.y+(sz.y-p.y);
   float perimeter=2.*(sz.x+sz.y),a=sideCoord/perimeter*2.*PI;
   float n=fbm(vec2(sideCoord*.007-t*.21,edgeDist*.028+t*.075));
   float flow=.5+.5*sin(a*3.-t*.68+sin(a*2.-t*.29)*.7),flow2=.5+.5*sin(a*5.+t*.39+1.7),flow3=.5+.5*cos(a*2.-t*.32+3.3);
   float energy=clamp(.23+.42*flow+.21*flow2+.15*flow3+.15*(n-.5),0.,1.);
   vec3 colour=blue(clamp(.23+.66*energy+.10*sin(a*4.-t*.34),0.,1.));
   float d=edgeDist+(n-.5)*2.+sin(sideCoord*.045-t*1.7)*.45;
   float filament=gauss(d-1.,1.65),core=gauss(d-2.2,4.),bloom=gauss(d-5.,12.),atmosphere=gauss(d-12.,31.);
   float shimmer=.90+.10*sin(t*1.9+a*8.+n*4.),flash=gauss(front,31.)*.68*intro,intensity=(.65+.74*energy)*shimmer+flash;
   light=colour*(filament*.90+core*.49+bloom*.20+atmosphere*.055)*intensity*ready;
   light+=vec3(.15,.39,1.)*filament*.16*intensity*ready;
 }
 vec3 rgb=wave*smoothstep(-2.,5.,edgeDist)+light;
 rgb=vec3(1.)-exp(-rgb*1.32);
 // Light pages: keep the hue at full luminance and let intensity drive
 // opacity, so the wave reads as blue light rather than a grey shadow.
 float m=max(max(rgb.r,rgb.g),rgb.b);
 vec3 hue=mix(vec3(.10,.46,1.),rgb/max(m,.001),.55);
 hue=mix(hue,vec3(.82,.93,1.),smoothstep(.55,1.,m)*.6);
 float alpha=clamp(pow(m,.85)*1.15,0.,.88);
 gl_FragColor=vec4(hue*alpha,alpha);
}
`;

export function BrowserAgentAura({ active, reducedMotion = false, className }: BrowserAgentAuraProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fallbackRef = useRef<HTMLCanvasElement | null>(null);
  const startRef = useRef(0);

  useEffect(() => {
    if (!active || reducedMotion) return;
    const canvas = canvasRef.current;
    const fallback = fallbackRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !fallback || !host) return;

    let frame = 0;
    let disposed = false;
    let usingFallback = false;
    let gl: WebGLRenderingContext | null = null;
    let program: WebGLProgram | null = null;
    let ctx: CanvasRenderingContext2D | null = null;
    let width = 1;
    let height = 1;
    let scale = 1;
    let clock = 0;
    let previous = performance.now();
    startRef.current = performance.now();

    const compile = (type: number, source: string) => {
      const shader = gl!.createShader(type);
      if (!shader) throw new Error("Unable to create browser aura shader");
      gl!.shaderSource(shader, source);
      gl!.compileShader(shader);
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
        const message = gl!.getShaderInfoLog(shader) || "Browser aura shader failed";
        gl!.deleteShader(shader);
        throw new Error(message);
      }
      return shader;
    };

    const activateFallback = () => {
      usingFallback = true;
      canvas.hidden = true;
      fallback.hidden = false;
      ctx = fallback.getContext("2d");
      ctx?.setTransform(scale, 0, 0, scale, 0, 0);
    };

    const setupGl = () => {
      gl = canvas.getContext("webgl", { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true });
      if (!gl) throw new Error("WebGL is unavailable");
      const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
      const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
      program = gl.createProgram();
      if (!program) throw new Error("Unable to create browser aura program");
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "Browser aura link failed");
      gl.useProgram(program);
      const position = gl.getAttribLocation(program, "a_pos");
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      // The shader writes premultiplied colour over a cleared canvas.
      gl.disable(gl.BLEND);
    };

    const resize = () => {
      const rect = host.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      const budget = matchMedia("(pointer: coarse)").matches ? 1_100_000 : 1_900_000;
      scale = Math.max(0.65, Math.min(devicePixelRatio || 1, 1.65, Math.sqrt(budget / (width * height))));
      canvas.width = fallback.width = Math.max(1, Math.round(width * scale));
      canvas.height = fallback.height = Math.max(1, Math.round(height * scale));
      gl?.viewport(0, 0, canvas.width, canvas.height);
      ctx?.setTransform(scale, 0, 0, scale, 0, 0);
    };

    const drawFallback = (time: number, age: number) => {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      const perimeter = 2 * (width + height);
      const originX = width * 0.5;
      const originY = height * 0.5;
      const far = Math.hypot(originX, originY) + 28;
      const raw = Math.max(0, Math.min(1, (age - 0.07) / 2.18));
      const radius = far * (1 - Math.pow(1 - raw, 2.45));
      const locate = (distance: number): [number, number] => {
        let value = ((distance % perimeter) + perimeter) % perimeter;
        if (value < width) return [value, 0];
        value -= width;
        if (value < height) return [width, value];
        value -= height;
        if (value < width) return [width - value, height];
        return [0, height - (value - width)];
      };
      ctx.globalCompositeOperation = "lighter";
      const segments = Math.max(100, Math.min(400, Math.round(perimeter / 7)));
      for (const [strokeWidth, opacity, blur, step] of [[25, 0.038, 17, 4], [11, 0.12, 10, 3], [4, 0.28, 3, 2], [1.65, 0.72, 0, 1]] as const) {
        ctx.lineWidth = strokeWidth;
        ctx.shadowBlur = blur;
        ctx.lineCap = "butt";
        for (let index = 0; index < segments; index += step) {
          const from = index / segments * perimeter;
          const to = (index + step) / segments * perimeter;
          const middle = locate((from + to) * 0.5);
          const distance = Math.hypot(middle[0] - originX, middle[1] - originY);
          const reveal = Math.max(0, Math.min(1, (radius - distance + 12) / 27));
          const ready = Math.max(reveal, Math.max(0, Math.min(1, (age - 2.35) / 0.35)));
          if (!ready) continue;
          const angle = (index + step * 0.5) / segments * Math.PI * 2;
          const energy = 0.22 + 0.43 * (0.5 + 0.5 * Math.sin(angle * 3 - time * 0.68)) + 0.24 * (0.5 + 0.5 * Math.sin(angle * 5 + time * 0.39 + 1.7));
          const alpha = opacity * (0.58 + 0.8 * energy) * ready;
          ctx.strokeStyle = `rgba(${Math.round(16 + 42 * energy)},${Math.round(72 + 105 * energy)},255,${alpha})`;
          ctx.shadowColor = `rgba(32,105,255,${alpha * 0.75})`;
          ctx.beginPath();
          ctx.moveTo(...locate(from));
          ctx.lineTo(...locate(to));
          ctx.stroke();
        }
      }
      ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = "source-over";
    };

    const render = (now: number) => {
      if (disposed) return;
      frame = requestAnimationFrame(render);
      const elapsed = Math.min(0.08, (now - previous) / 1000);
      previous = now;
      clock += elapsed;
      const age = Math.max(0, (now - startRef.current) / 1000);
      if (usingFallback) {
        drawFallback(clock, age);
        return;
      }
      if (!gl || !program) return;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform2f(gl.getUniformLocation(program, "u_size"), width, height);
      gl.uniform1f(gl.getUniformLocation(program, "u_scale"), scale);
      gl.uniform1f(gl.getUniformLocation(program, "u_time"), clock);
      gl.uniform1f(gl.getUniformLocation(program, "u_age"), age);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    try {
      setupGl();
    } catch (error) {
      console.warn("Browser agent aura switched to Canvas fallback:", error);
      activateFallback();
    }
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    frame = requestAnimationFrame(render);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [active, reducedMotion]);

  if (!active || reducedMotion) return null;
  return (
    <div className={cn("clyra-browser-blue-aura pointer-events-none absolute inset-0 z-[19] overflow-hidden", className)} aria-hidden>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <canvas ref={fallbackRef} className="absolute inset-0 h-full w-full" hidden />
    </div>
  );
}

export default BrowserAgentAura;
