"use client";

import { useEffect, useRef, type RefObject } from "react";
import { cn } from "@/lib/utils";

/**
 * Glass, as a WebGL lens: the canvas "Glass" shader (pen.dev · wbNpq) ported
 * to the page. The maths is the original's: a squircle-profiled rim whose
 * slope bends the backdrop by Snell's law, per-channel indices for the
 * chromatic fringe, a specular highlight from a light that follows the
 * pointer, and fresnel at the edge.
 *
 * What changes is where the two inputs come from. pen.dev hands its shader
 * the pixels behind it and a signed-distance texture of the shape; a page
 * can read neither, so:
 *  - the shape is a rounded rectangle, its distance computed analytically;
 *  - the backdrop is either a <video>, found by ref or by selector (the
 *    hero's film lives in a server component), uploaded every frame and
 *    mapped the way `object-fit: cover` lays it out so the lens bends the
 *    real film; or two tones, the colour outside a device and the colour of its screen,
 *    which is what gives a bezel its fringe on a flat section.
 *
 * `ring` draws only the rim band (a bezel around live content); otherwise
 * the whole shape is glass, with an optional tint so text can sit on it.
 * Without WebGL the canvas never shows and the caller's own fill stands in.
 */

type Backdrop =
  | { kind: "video"; video: RefObject<HTMLVideoElement | null> | string; shade?: number }
  | { kind: "tones"; outer: string; inner: string; inset: number };

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 u_size;          // css px
uniform float u_dpr;
uniform float u_radius;
uniform float u_edge;
uniform float u_ior;
uniform float u_chromatic;
uniform float u_specPower;
uniform float u_specIntensity;
uniform float u_fresnel;
uniform float u_blur;
uniform vec2 u_light;         // css px, canvas space
uniform float u_mode;         // 0 video, 1 tones
uniform sampler2D u_tex;
uniform vec4 u_img;           // image top-left and size, css px
uniform float u_shade;
uniform vec3 u_outer;
uniform vec3 u_inner;
uniform float u_inset;
uniform float u_ring;
uniform vec4 u_tint;

// Signed distance to a rounded rect (negative inside) and its gradient.
vec3 sdRound(vec2 p, vec2 hs, float r) {
  vec2 s = sign(p);
  vec2 q = abs(p) - (hs - r);
  float outside = length(max(q, 0.0));
  float d = outside + min(max(q.x, q.y), 0.0) - r;
  vec2 g;
  if (q.x > 0.0 && q.y > 0.0) g = normalize(q) * s;
  else if (q.x > q.y) g = vec2(s.x, 0.0);
  else g = vec2(0.0, s.y);
  return vec3(d, g);
}

float surfaceHeight(float t) {
  float s = 1.0 - t;
  float s4 = s * s * s * s;
  return pow(1.0 - s4, 0.25);
}

float refractDisp(float sinI, float slope, float n) {
  float sinR = clamp(sinI / n, -0.9999, 0.9999);
  return sinR * inversesqrt(1.0 - sinR * sinR) - slope;
}

vec3 backdrop(vec2 p) {
  if (u_mode < 0.5) {
    vec2 uv = (p - u_img.xy) / u_img.zw;
    return texture2D(u_tex, clamp(uv, 0.001, 0.999)).rgb * u_shade;
  }
  vec3 inner = sdRound(p - u_size * 0.5, u_size * 0.5 - u_inset, max(u_radius - u_inset, 2.0));
  return mix(u_inner, u_outer, smoothstep(-1.0, 1.0, inner.x));
}

vec3 frosted(vec2 p) {
  if (u_blur <= 0.0) return backdrop(p);
  vec3 sum = backdrop(p);
  for (int i = 0; i < 8; i++) {
    float fi = float(i) + 0.5;
    float a = fi * 2.39996323;
    float r = sqrt(fi / 8.0) * u_blur;
    sum += backdrop(p + vec2(cos(a), sin(a)) * r);
  }
  return sum / 9.0;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, u_size.y * u_dpr - gl_FragCoord.y) / u_dpr;
  vec3 s = sdRound(p - u_size * 0.5, u_size * 0.5, u_radius);
  float sd = -s.x;                       // positive inside
  vec2 outward = s.yz;

  float cover = smoothstep(-1.0, 1.0, sd);
  float ew = max(u_edge, 1.0);
  float t = clamp(sd / ew, 0.0, 1.0);

  float h1 = surfaceHeight(clamp(t - 0.001, 0.0, 1.0));
  float h2 = surfaceHeight(clamp(t + 0.001, 0.0, 1.0));
  float slope = (h2 - h1) * 500.0;
  float sinI = slope * inversesqrt(1.0 + slope * slope);

  float dG = refractDisp(sinI, slope, u_ior) * ew;
  float dR = refractDisp(sinI, slope, u_ior - u_chromatic) * ew;
  float dB = refractDisp(sinI, slope, u_ior + u_chromatic) * ew;
  vec3 col = vec3(
    frosted(p + outward * dR).r,
    frosted(p + outward * dG).g,
    frosted(p + outward * dB).b
  );

  vec2 toLight = u_size * 0.5 - u_light;
  toLight = normalize(toLight + 1e-4) * max(length(toLight), 1.0);
  vec3 L = normalize(vec3(toLight, length(toLight)));
  vec3 N = normalize(vec3(-slope * outward, 1.0));
  vec3 R = reflect(-L, N);
  float spec = pow(max(R.z, 0.0), u_specPower);
  float fres = pow(1.0 - N.z, 3.0);

  // The flat middle takes the tint, so words can sit on the glass.
  col = mix(col, u_tint.rgb, u_tint.a * smoothstep(0.6, 1.0, t));
  col += vec3(spec * u_specIntensity + fres * u_fresnel);

  float alpha = cover;
  if (u_ring > 0.5) alpha *= 1.0 - smoothstep(u_inset - 1.0, u_inset + 1.0, sd);
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h.slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function GlassLens({
  backdrop,
  radius = 28,
  edge = 36,
  ior = 1.6,
  chromatic = 0.12,
  specPower = 56,
  specIntensity = 0.9,
  fresnel = 0.9,
  blur = 0,
  tint = "#0b0708",
  tintAlpha = 0,
  ring = false,
  className,
}: {
  backdrop: Backdrop;
  radius?: number;
  edge?: number;
  ior?: number;
  chromatic?: number;
  specPower?: number;
  specIntensity?: number;
  fresnel?: number;
  blur?: number;
  tint?: string;
  tintAlpha?: number;
  ring?: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Props are read inside the render loop; keep the latest without restarting it.
  const opts = useRef({ backdrop, radius, edge, ior, chromatic, specPower, specIntensity, fresnel, blur, tint, tintAlpha, ring });
  useEffect(() => {
    opts.current = { backdrop, radius, edge, ior, chromatic, specPower, specIntensity, fresnel, blur, tint, tintAlpha, ring };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
    if (!gl) return;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const U = (name: string) => gl.getUniformLocation(prog, name);
    const u = {
      size: U("u_size"), dpr: U("u_dpr"), radius: U("u_radius"), edge: U("u_edge"), ior: U("u_ior"),
      chromatic: U("u_chromatic"), specPower: U("u_specPower"), specIntensity: U("u_specIntensity"),
      fresnel: U("u_fresnel"), blur: U("u_blur"), light: U("u_light"), mode: U("u_mode"), tex: U("u_tex"),
      img: U("u_img"), shade: U("u_shade"), outer: U("u_outer"), inner: U("u_inner"), inset: U("u_inset"),
      ring: U("u_ring"), tint: U("u_tint"),
    };

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([11, 7, 8, 255]));
    gl.uniform1i(u.tex, 0);

    // The light drifts on its own and leans toward the pointer when it's near.
    const pointer = { x: -1, y: -1, at: 0 };
    const onMove = (e: PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.at = performance.now();
      schedule();
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let visible = false;

    const draw = (now: number) => {
      raf = 0;
      const o = opts.current;
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);

      const t = now / 1000;
      const fresh = now - pointer.at < 4000 && pointer.x >= 0;
      const lx = fresh ? pointer.x - rect.left : rect.width * (0.25 + 0.2 * Math.sin(t * 0.35));
      const ly = fresh ? pointer.y - rect.top : -rect.height * 0.4;

      gl.uniform2f(u.size, rect.width, rect.height);
      gl.uniform1f(u.dpr, dpr);
      gl.uniform1f(u.radius, o.radius);
      gl.uniform1f(u.edge, o.edge);
      gl.uniform1f(u.ior, o.ior);
      gl.uniform1f(u.chromatic, o.chromatic);
      gl.uniform1f(u.specPower, o.specPower);
      gl.uniform1f(u.specIntensity, o.specIntensity);
      gl.uniform1f(u.fresnel, o.fresnel);
      gl.uniform1f(u.blur, o.blur);
      gl.uniform2f(u.light, lx, ly);
      gl.uniform1f(u.ring, o.ring ? 1 : 0);
      const [tr, tg, tb] = hexToRgb(o.tint);
      gl.uniform4f(u.tint, tr, tg, tb, o.tintAlpha);

      const b = o.backdrop;
      let animate = false;
      if (b.kind === "video") {
        gl.uniform1f(u.mode, 0);
        gl.uniform1f(u.shade, b.shade ?? 1);
        const v = typeof b.video === "string" ? document.querySelector<HTMLVideoElement>(b.video) : b.video.current;
        if (v && v.readyState >= 2 && v.videoWidth) {
          gl.bindTexture(gl.TEXTURE_2D, tex);
          try {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
          } catch {
            // A tainted or not-yet-decodable frame: keep the last one.
          }
          const vr = v.getBoundingClientRect();
          const scale = Math.max(vr.width / v.videoWidth, vr.height / v.videoHeight);
          const iw = v.videoWidth * scale;
          const ih = v.videoHeight * scale;
          gl.uniform4f(u.img, vr.left - rect.left + (vr.width - iw) / 2, vr.top - rect.top + (vr.height - ih) / 2, iw, ih);
          animate = !v.paused;
        } else {
          gl.uniform4f(u.img, 0, 0, rect.width, rect.height);
          animate = true;
        }
      } else {
        gl.uniform1f(u.mode, 1);
        gl.uniform3f(u.outer, ...hexToRgb(b.outer));
        gl.uniform3f(u.inner, ...hexToRgb(b.inner));
        gl.uniform1f(u.inset, b.inset);
      }

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // Keep going while the film plays or the light is drifting; otherwise
      // wait for the pointer.
      if (visible && !reduce && (animate || !fresh)) schedule();
    };

    const schedule = () => {
      if (!raf && visible) raf = requestAnimationFrame(draw);
    };

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) schedule();
    });
    io.observe(canvas);
    const ro = new ResizeObserver(() => schedule());
    ro.observe(canvas);
    canvas.dataset.ready = "true";

    return () => {
      io.disconnect();
      ro.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 size-full opacity-0 transition-opacity duration-700 data-[ready=true]:opacity-100", className)}
    />
  );
}
