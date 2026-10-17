/*
 * In-page agent chrome for the native Chromium browser view.
 *
 * A WebContentsView paints above Clyra's React tree, so anything that must
 * appear *over* the live page while the agent works (the blue edge wave and
 * the floating status pill) is injected into the page itself. The script is
 * idempotent: every agent event re-runs it, and it only updates what changed,
 * so the WebGL wave is never restarted mid-animation.
 *
 * The wave is a port of the Siri-inspired blue edge activation: a circular,
 * noise-perturbed wavefront expands from the centre and lights each border
 * pixel only when it reaches it, then settles into a living edge glow. The
 * page stays fully readable; the canvas never receives pointer events.
 *
 * Pill buttons report back through a console token that the main process
 * listens for. A page could forge that token, but the only commands it can
 * reach are "take control" and "stop" — both hand control *to the person*.
 */

function clyraAgentChrome(data) {
  const ROOT_ID = "__clyra_agent_chrome__";
  const STATE_KEY = "__clyraAgentChrome";
  const existing = document.getElementById(ROOT_ID);
  const state = window[STATE_KEY];

  if (!data || (!data.aura && !data.pill)) {
    if (state) {
      state.disposed = true;
      cancelAnimationFrame(state.frame);
      state.observer?.disconnect();
      try { state.gl?.getExtension("WEBGL_lose_context")?.loseContext(); } catch {}
    }
    window[STATE_KEY] = undefined;
    if (existing) {
      existing.style.opacity = "0";
      setTimeout(() => existing.remove(), 420);
    }
    return;
  }

  let root = existing;
  if (!root || !state || state.disposed) {
    existing?.remove();
    root = document.createElement("div");
    root.id = ROOT_ID;
    root.setAttribute("aria-hidden", "false");
    root.style.cssText = "position:fixed;inset:0;z-index:2147483646;pointer-events:none;contain:layout style paint;opacity:0;transition:opacity .45s cubic-bezier(.22,1,.36,1);";

    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
    const fallback = document.createElement("canvas");
    fallback.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:none;";

    const pill = document.createElement("div");
    pill.setAttribute("role", "status");
    pill.style.cssText = [
      "position:fixed;left:50%;bottom:20px;transform:translate(-50%,16px);opacity:0",
      "display:flex;align-items:center;gap:10px;height:46px;max-width:min(470px,calc(100vw - 32px));padding:0 6px 0 14px",
      "border-radius:13px;background:rgba(255,255,255,.96);border:1px solid #dce8fa;color:#334458",
      "box-shadow:0 12px 36px rgba(39,73,126,.13),0 2px 5px rgba(39,73,126,.04)",
      "-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);pointer-events:auto",
      "font:500 12px/1.2 -apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Arial,sans-serif;letter-spacing:-.005em",
      "transition:opacity .3s ease,transform .35s cubic-bezier(.22,1,.36,1)",
    ].join(";");
    const star = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    star.setAttribute("viewBox", "0 0 24 24");
    star.setAttribute("fill", "none");
    star.setAttribute("stroke", "#1677ff");
    star.setAttribute("stroke-width", "1.7");
    star.style.cssText = "width:15px;height:15px;flex:none;";
    const starPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    starPath.setAttribute("d", "m12 2 1.7 7 7.3 3-7.3 2.8L12 22l-2-7.2L3 12l7-3z");
    star.append(starPath);
    const label = document.createElement("span");
    label.style.cssText = "flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#526176;";
    const makeButton = (text, stop) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      const base = stop
        ? "background:#fbe9e9;color:#c83d3d;"
        : "background:#eef3fa;color:#41607d;";
      button.style.cssText = "all:unset;box-sizing:border-box;" + base + "padding:9px 11px;border-radius:9px;font:600 11px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;cursor:pointer;white-space:nowrap;transition:background .18s ease;";
      button.addEventListener("mouseenter", () => { button.style.background = stop ? "#f8dddd" : "#e2ebf9"; });
      button.addEventListener("mouseleave", () => { button.style.background = stop ? "#fbe9e9" : "#eef3fa"; });
      return button;
    };
    const control = makeButton("Take control", false);
    const stop = makeButton("Stop", true);
    pill.append(star, label, control, stop);
    root.append(canvas, fallback, pill);
    document.documentElement.appendChild(root);

    const next = {
      disposed: false,
      frame: 0,
      startedAt: data.startedAt || Date.now(),
      aura: false,
      reducedMotion: false,
      root,
      canvas,
      fallback,
      pill,
      label,
      control,
      stop,
      gl: null,
      program: null,
      uniforms: {},
      ctx: null,
      usingFallback: false,
      width: 1,
      height: 1,
      scale: 1,
      clock: 0,
      previous: performance.now(),
      token: data.token,
      command: "take_control",
    };
    control.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      console.info(`${next.token}:${next.command}`);
    });
    stop.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      console.info(`${next.token}:stop`);
    });
    window[STATE_KEY] = next;
    requestAnimationFrame(() => { root.style.opacity = "1"; });
  }

  const chrome = window[STATE_KEY];
  chrome.token = data.token;
  chrome.startedAt = data.startedAt || chrome.startedAt;
  chrome.reducedMotion = Boolean(data.reducedMotion);

  /* ---------- floating status pill ---------- */
  chrome.label.textContent = data.label || "Working on your request";
  chrome.command = data.manualControl ? "return_control" : data.paused ? "resume" : "take_control";
  chrome.control.textContent = data.manualControl ? "Return control" : data.paused ? "Resume" : "Take control";
  chrome.pill.style.display = data.pill ? "flex" : "none";
  requestAnimationFrame(() => {
    chrome.pill.style.opacity = data.pill ? "1" : "0";
    chrome.pill.style.transform = data.pill ? "translate(-50%,0)" : "translate(-50%,16px)";
  });

  /* ---------- blue edge wave ---------- */
  const wantAura = Boolean(data.aura) && !chrome.reducedMotion;
  chrome.canvas.style.opacity = wantAura ? "1" : "0";
  chrome.fallback.style.opacity = wantAura ? "1" : "0";
  chrome.canvas.style.transition = chrome.fallback.style.transition = "opacity .5s ease";
  if (wantAura === chrome.aura) return;
  chrome.aura = wantAura;
  if (!wantAura) {
    cancelAnimationFrame(chrome.frame);
    chrome.frame = 0;
    return;
  }

  const VERTEX = "attribute vec2 a_pos;void main(){gl_Position=vec4(a_pos,0.,1.);}";
  const FRAGMENT = `precision highp float;
uniform vec2 u_size;uniform float u_scale,u_time,u_age;
const float PI=3.141592653589793;
float hash(vec2 p){p=fract(p*vec2(123.34,345.45));p+=dot(p,p+34.345);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<3;i++){v+=a*noise(p);p=p*2.04+vec2(11.7,8.3);a*=.5;}return v;}
float gauss(float x,float s){return exp(-.5*x*x/(s*s));}
float smooth01(float v){v=clamp(v,0.,1.);return v*v*(3.-2.*v);}
float ease(float v){v=clamp(v,0.,1.);return 1.-pow(1.-v,2.45);}
vec3 blue(float x){vec3 a=vec3(.015,.13,.70),b=vec3(.055,.40,1.),c=vec3(.28,.72,1.);return x<.5?mix(a,b,x*2.):mix(b,c,(x-.5)*2.);}
void main(){
 vec2 p=vec2(gl_FragCoord.x,u_size.y*u_scale-gl_FragCoord.y)/u_scale;
 vec2 sz=u_size;float t=u_time,age=u_age;
 vec2 v=p-sz*.5;float r=length(v);
 float far=length(sz*.5)+28.;float radius=far*ease((age-.07)/2.18);
 float wobble=(fbm(p*.013+vec2(t*.21,-t*.16))-.47)*13.+sin(atan(v.y,v.x)*11.+t*1.8)*3.4+sin(p.x*.027+p.y*.018-t*1.3)*2.;
 float front=r-radius-wobble;
 float intro=(1.-smoothstep(1.75,2.9,age))*smooth01(age/.16);
 float edgeDist=min(min(p.x,sz.x-p.x),min(p.y,sz.y-p.y));
 vec3 wave=blue(.77)*gauss(front,4.2)*.44+blue(.49)*gauss(front+16.,12.)*.14+blue(.22)*gauss(front+49.,32.)*.065+blue(.60)*gauss(front-11.,16.)*.08;
 float fringes=.5+.5*cos(front*.68+fbm(p*.035+t*.08)*2.2);
 wave+=blue(.91)*gauss(front+6.,13.)*fringes*.048;wave*=intro;
 float ready=max(smoothstep(17.,-10.,front),smooth01((age-2.35)/.35));
 vec3 light=vec3(0.);
 if(edgeDist<90.){
  float sc;
  if(edgeDist==p.y)sc=p.x;else if(edgeDist==sz.x-p.x)sc=sz.x+p.y;else if(edgeDist==sz.y-p.y)sc=sz.x+sz.y+(sz.x-p.x);else sc=2.*sz.x+sz.y+(sz.y-p.y);
  float a=sc/(2.*(sz.x+sz.y))*2.*PI;
  float n=fbm(vec2(sc*.007-t*.21,edgeDist*.028+t*.075));
  float flow=.5+.5*sin(a*3.-t*.68+sin(a*2.-t*.29)*.7),flow2=.5+.5*sin(a*5.+t*.39+1.7),flow3=.5+.5*cos(a*2.-t*.32+3.3);
  float energy=clamp(.23+.42*flow+.21*flow2+.15*flow3+.15*(n-.5),0.,1.);
  vec3 colour=blue(clamp(.23+.66*energy+.10*sin(a*4.-t*.34),0.,1.));
  float d=edgeDist+(n-.5)*2.+sin(sc*.045-t*1.7)*.45;
  float intensity=(.65+.74*energy)*(.90+.10*sin(t*1.9+a*8.+n*4.))+gauss(front,31.)*.68*intro;
  light=colour*(gauss(d-1.,1.65)*.90+gauss(d-2.2,4.)*.49+gauss(d-5.,12.)*.20+gauss(d-12.,31.)*.055)*intensity*ready;
  light+=vec3(.15,.39,1.)*gauss(d-1.,1.65)*.16*intensity*ready;
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
}`;

  const resize = () => {
    chrome.width = Math.max(1, window.innerWidth);
    chrome.height = Math.max(1, window.innerHeight);
    const budget = 1_600_000;
    chrome.scale = Math.max(0.6, Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(budget / (chrome.width * chrome.height))));
    chrome.canvas.width = chrome.fallback.width = Math.max(1, Math.round(chrome.width * chrome.scale));
    chrome.canvas.height = chrome.fallback.height = Math.max(1, Math.round(chrome.height * chrome.scale));
    if (chrome.gl) chrome.gl.viewport(0, 0, chrome.canvas.width, chrome.canvas.height);
    if (chrome.ctx) chrome.ctx.setTransform(chrome.scale, 0, 0, chrome.scale, 0, 0);
  };

  const activateFallback = () => {
    chrome.usingFallback = true;
    chrome.canvas.style.display = "none";
    chrome.fallback.style.display = "block";
    chrome.ctx = chrome.fallback.getContext("2d");
    chrome.ctx?.setTransform(chrome.scale, 0, 0, chrome.scale, 0, 0);
  };

  if (!chrome.gl && !chrome.usingFallback) {
    try {
      const gl = chrome.canvas.getContext("webgl", { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: "low-power" });
      if (!gl) throw new Error("WebGL unavailable");
      const compile = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "shader");
        return shader;
      };
      const program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link");
      gl.useProgram(program);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, "a_pos");
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      chrome.uniforms = {
        size: gl.getUniformLocation(program, "u_size"),
        scale: gl.getUniformLocation(program, "u_scale"),
        time: gl.getUniformLocation(program, "u_time"),
        age: gl.getUniformLocation(program, "u_age"),
      };
      chrome.gl = gl;
      chrome.program = program;
      chrome.canvas.addEventListener("webglcontextlost", (event) => { event.preventDefault(); chrome.gl = null; activateFallback(); });
    } catch {
      activateFallback();
    }
    resize();
    chrome.observer = new ResizeObserver(resize);
    chrome.observer.observe(document.documentElement);
  }

  const drawFallback = (time, age) => {
    const ctx = chrome.ctx;
    if (!ctx) return;
    const w = chrome.width, h = chrome.height;
    ctx.clearRect(0, 0, w, h);
    const perimeter = 2 * (w + h), ox = w / 2, oy = h / 2, far = Math.hypot(ox, oy) + 28;
    const raw = Math.max(0, Math.min(1, (age - 0.07) / 2.18));
    const radius = far * (1 - Math.pow(1 - raw, 2.45));
    const locate = (s) => {
      s = ((s % perimeter) + perimeter) % perimeter;
      if (s < w) return [s, 0];
      s -= w; if (s < h) return [w, s];
      s -= h; if (s < w) return [w - s, h];
      return [0, h - (s - w)];
    };
    ctx.globalCompositeOperation = "lighter";
    const segments = Math.max(100, Math.min(360, Math.round(perimeter / 8)));
    for (const [width, opacity, blur, step] of [[22, 0.04, 16, 4], [9, 0.12, 9, 3], [3.5, 0.3, 3, 2], [1.6, 0.72, 0, 1]]) {
      ctx.lineWidth = width;
      ctx.shadowBlur = blur;
      for (let index = 0; index < segments; index += step) {
        const from = index / segments * perimeter, to = (index + step) / segments * perimeter;
        const mid = locate((from + to) / 2);
        const reveal = Math.max(0, Math.min(1, (radius - Math.hypot(mid[0] - ox, mid[1] - oy) + 12) / 27));
        const ready = Math.max(reveal, Math.max(0, Math.min(1, (age - 2.35) / 0.35)));
        if (!ready) continue;
        const angle = (index + step / 2) / segments * Math.PI * 2;
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

  let last = 0;
  const render = (now) => {
    if (chrome.disposed || !chrome.aura) return;
    chrome.frame = requestAnimationFrame(render);
    if (document.hidden || now - last < 16) return;
    last = now;
    chrome.clock += Math.min(0.08, (now - chrome.previous) / 1000);
    chrome.previous = now;
    const age = Math.max(0, (Date.now() - chrome.startedAt) / 1000);
    if (chrome.usingFallback || !chrome.gl) {
      drawFallback(chrome.clock, age);
      return;
    }
    const gl = chrome.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(chrome.program);
    gl.uniform2f(chrome.uniforms.size, chrome.width, chrome.height);
    gl.uniform1f(chrome.uniforms.scale, chrome.scale);
    gl.uniform1f(chrome.uniforms.time, chrome.clock);
    gl.uniform1f(chrome.uniforms.age, age);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  chrome.previous = performance.now();
  cancelAnimationFrame(chrome.frame);
  chrome.frame = requestAnimationFrame(render);
}

/** Builds the script for one `executeJavaScript` call. `null` removes it. */
export function agentChromeScript(data) {
  return `(${clyraAgentChrome.toString()})(${JSON.stringify(data)})`;
}
