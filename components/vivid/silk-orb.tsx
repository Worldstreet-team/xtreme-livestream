"use client"

/**
 * SilkOrb — Vivid's presence: a small glass sphere of liquid fire.
 *
 * Domain-warped noise flows across it in the heat colours (chili into
 * ember, amber at the hottest), bent round the sphere so it reads as
 * something turning in your hand, then lit like glass — a soft key light,
 * a sharp highlight up and to the left, an ember rim. (Owner, 2026-09-24:
 * a new, more creative shader; it replaced the old caustic "silk" field.)
 *
 * It moves. At rest it drifts; a live session hurries it, and the voice
 * level stirs the flow and brightens the core.
 */

import React, { useRef, useEffect, useCallback, useState } from "react"
import type { VividAgentState } from "@/lib/vivid/types"

interface SilkOrbProps {
  state: VividAgentState
  onClick?: () => void
  /** A named size, or a diameter in px (the top bar's 28 and 36). */
  size?: keyof typeof SIZE_PX | number
  getAudioLevels: () => Uint8Array
  className?: string
  label?: string
}

const SIZE_PX = { xs: 40, sm: 56, md: 72, lg: 96 } as const

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2  uResolution;
uniform float uPhase;   // loop phase, 0..1
uniform float uLevel;   // smoothed voice level, 0..1
uniform vec3  uTint;    // the hottest light: amber
uniform vec3  uDeep;    // the body of the flow: chili into ember
uniform vec3  uBase;    // the dark it swims in

const float TAU = 6.28318530718;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}

void main() {
  // -1..1 across the disc; z is the height of a unit sphere at this pixel.
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y * 2.0;
  float r = length(uv);
  float z = sqrt(max(0.0, 1.0 - r * r));
  vec3 n = vec3(uv, z);

  // Liquid fire: domain-warped noise, projected onto the sphere so the
  // flow bends round its edge. The phase is a loop, so it never jumps.
  float t = uPhase * TAU;
  vec2 sp = uv / (1.0 + z * 0.65) * 2.2;
  vec2 drift = vec2(cos(t), sin(t));
  float warp = 1.5 + uLevel * 2.5;
  vec2 q = vec2(fbm(sp + drift * 0.6), fbm(sp + vec2(5.2, 1.3) - drift.yx * 0.6));
  vec2 w = vec2(fbm(sp + warp * q + vec2(1.7, 9.2) + 0.35 * drift),
                fbm(sp + warp * q + vec2(8.3, 2.8) - 0.35 * drift.yx));
  float f = fbm(sp + 2.0 * w);

  vec3 col = mix(uBase, uDeep, smoothstep(0.18, 0.58, f));
  col = mix(col, uTint, smoothstep(0.42, 0.85, f * f * 1.8 + length(w) * 0.26));
  col += uDeep * 0.18 * f;
  col += uTint * 0.2 * pow(z, 3.0) * (0.7 + uLevel * 1.4);

  // Lit like glass: a soft key light, a sharp highlight up and to the
  // left, and an ember rim where the sphere turns away.
  vec3 L = normalize(vec3(-0.45, 0.55, 0.7));
  col *= 0.74 + 0.42 * clamp(dot(n, L), 0.0, 1.0);
  float spec = pow(clamp(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 28.0);
  col += vec3(1.0, 0.92, 0.84) * spec * 0.6;
  col += mix(uDeep, uTint, 0.5) * pow(1.0 - z, 2.2) * 0.6;

  // A crisp, antialiased edge — it's an object now, not a haze.
  float a = 1.0 - smoothstep(1.0 - 3.0 / uResolution.y, 1.0, r);
  fragColor = vec4(col, a);
}
`

/** Afterglow's heat: amber-hot veins in a chili-ember body on warm black —
 *  the gradient's own three stops, so Vivid reads as part of Xtream. */
const TINT: [number, number, number] = [1.0, 0.72, 0.26]
const DEEP: [number, number, number] = [0.97, 0.15, 0.1]
const BASE: [number, number, number] = [0.22, 0.02, 0.04]

/** Milliseconds per revolution. Idle drifts; a live session hurries. */
const SPEED_IDLE = 22000
const SPEED_ACTIVE = 9000

const ACTIVE_STATES = new Set<VividAgentState>([
  "connecting",
  "ready",
  "listening",
  "processing",
  "speaking",
])

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error("[silk-orb] shader compile failed:", gl.getShaderInfoLog(sh))
    gl.deleteShader(sh)
    return null
  }
  return sh
}

export default function SilkOrb({
  state,
  onClick,
  size = "md",
  getAudioLevels,
  className = "",
  label,
}: SilkOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dimension = typeof size === "number" ? size : SIZE_PX[size]

  const isActive = ACTIVE_STATES.has(state)

  // Only shown if WebGL2 is genuinely unavailable — never underneath the
  // canvas, where its edge used to read as a border around the field.
  const [glFailed, setGlFailed] = useState(false)

  // The render loop reads through refs so a state change never tears down the
  // GL context — the field keeps its phase and never flickers.
  const activeRef = useRef(isActive)
  const levelRef = useRef(0)
  const getLevelsRef = useRef(getAudioLevels)

  activeRef.current = isActive
  getLevelsRef.current = getAudioLevels

  const sampleLevel = useCallback(() => {
    const data = getLevelsRef.current()
    if (!data || data.length === 0) return 0
    let sum = 0
    for (let i = 0; i < data.length; i++) sum += data[i]
    return sum / data.length / 255
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches

    const gl = canvas.getContext("webgl2", {
      antialias: false,
      alpha: true,
      premultipliedAlpha: false,
    })
    if (!gl) {
      setGlFailed(true)
      return
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERT)
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
    if (!vs || !fs) {
      setGlFailed(true)
      return
    }

    const prog = gl.createProgram()!
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("[silk-orb] link failed:", gl.getProgramInfoLog(prog))
      setGlFailed(true)
      return
    }
    gl.useProgram(prog)

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, "aPos")
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    const uRes = gl.getUniformLocation(prog, "uResolution")
    const uPhase = gl.getUniformLocation(prog, "uPhase")
    const uLevel = gl.getUniformLocation(prog, "uLevel")
    gl.uniform3fv(gl.getUniformLocation(prog, "uTint"), TINT)
    gl.uniform3fv(gl.getUniformLocation(prog, "uDeep"), DEEP)
    gl.uniform3fv(gl.getUniformLocation(prog, "uBase"), BASE)

    let raf = 0
    let disposed = false
    let last = 0
    // Phase accumulates, so a speed change bends the motion instead of jumping it.
    let phase = 0

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(1, Math.round(dimension * dpr))
      if (canvas!.width !== w || canvas!.height !== w) {
        canvas!.width = w
        canvas!.height = w
        gl!.viewport(0, 0, w, w)
      }
      gl!.uniform2f(uRes, canvas!.width, canvas!.height)
    }

    function frame(t: number) {
      if (disposed) return
      if (!last) last = t
      const dt = Math.min(t - last, 100) // a backgrounded tab must not lurch
      last = t

      resize()

      const speed = activeRef.current ? SPEED_ACTIVE : SPEED_IDLE
      phase = (phase + dt / speed) % 1
      gl!.uniform1f(uPhase, phase)

      // Ease toward the sampled level so the disc breathes instead of strobing.
      const target = activeRef.current ? sampleLevel() : 0
      levelRef.current += (target - levelRef.current) * 0.12
      gl!.uniform1f(uLevel, levelRef.current)

      gl!.drawArrays(gl!.TRIANGLES, 0, 3)
      raf = requestAnimationFrame(frame)
    }

    if (reduced) {
      resize()
      gl.uniform1f(uPhase, 0)
      gl.uniform1f(uLevel, 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    } else {
      raf = requestAnimationFrame(frame)
    }

    function onVisibility() {
      if (reduced) return
      if (document.hidden) {
        cancelAnimationFrame(raf)
        raf = 0
      } else if (!raf) {
        last = 0
        raf = requestAnimationFrame(frame)
      }
    }
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      document.removeEventListener("visibilitychange", onVisibility)
      gl.deleteProgram(prog)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      gl.deleteBuffer(buf)
    }
  }, [dimension, sampleLevel])

  const Tag = onClick ? "button" : "div"

  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      aria-label={label ?? (isActive ? "End Vivid session" : "Talk to Vivid")}
      className={`relative grid place-items-center ${onClick ? "cursor-pointer transition-transform duration-200 hover:scale-[1.06] active:scale-95" : ""} ${className}`}
      style={{ width: dimension, height: dimension }}
    >
      {glFailed && (
        // Static stand-in with the same dissolving edge — still no border.
        <span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(circle at 46% 40%, rgba(248,160,8,0.95) 0%, rgba(227,40,26,0.85) 46%, rgba(20,7,6,0.9) 72%, transparent 96%)",
          }}
        />
      )}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ width: dimension, height: dimension }}
      />
    </Tag>
  )
}
