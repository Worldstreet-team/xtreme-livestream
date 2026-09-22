"use client"

/**
 * SilkOrb — the page's silk field, cut into a circle. Vivid's presence.
 *
 * Same caustic interference maths as components/system/silk-backdrop.tsx, so
 * the orb is visibly made of the same material as the background it floats on —
 * the same dark ember, lifted just enough to read as an object. No ring, no
 * glow, no icon: only the field, dissolving at the rim exactly the way the
 * backdrop dissolves into the page.
 *
 * It moves. The backdrop turns once every 70s so it reads as still; the orb
 * turns fast enough to see, hurries while a session is live, and the whole
 * disc breathes on the voice level.
 */

import React, { useRef, useEffect, useCallback, useState } from "react"
import type { VividAgentState } from "@/lib/vivid/types"

interface SilkOrbProps {
  state: VividAgentState
  onClick?: () => void
  size?: "xs" | "sm" | "md" | "lg"
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
uniform vec3  uTint;    // hot core of a vein
uniform vec3  uDeep;    // the ember the field mostly sits in
uniform vec3  uBase;    // the black it all floats on

const float PI2 = 6.28318530718;

void main() {
  vec2 st = gl_FragCoord.xy / uResolution;

  // radial coordinate: 0 at the centre, 1 at the rim
  float r = length(st - 0.5) * 2.0;

  // ── identical field to the backdrop ──
  float spectrum = -15.0;
  float pi = PI2 * 1.6;
  vec2  p  = mod(st * pi, pi) - 96.0;
  vec2  i  = p;
  float c  = 0.5;
  float inten = 0.01;

  for (int n = 0; n < 4; n++) {
    float tt = PI2 * uPhase * float(n + 3);
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y),
                 sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten + spectrum),
                           p.y / (cos(i.y + tt) / inten)));
  }

  c /= 4.0;
  c = 0.05 - pow(c, 0.9);

  // Same percentile stretch as the backdrop.
  float v    = abs(c);
  float glow = pow(smoothstep(0.319, 0.790, v), 1.7);
  float hot  = pow(smoothstep(0.611, 0.790, v), 1.4);

  vec3 col = uBase + uDeep * glow;
  col = mix(col, uTint, hot);

  // A live session lifts the whole disc; the veins carry the movement.
  col *= 1.0 + uLevel * 0.9;

  // Gentle centre bias — a body, not a ring. No rim brightening anywhere.
  col *= mix(1.12, 0.82, smoothstep(0.0, 1.0, r));

  // Alpha IS the circle: a wide feather with no hard edge and no border.
  float a = 1.0 - smoothstep(0.68, 0.995, r);

  fragColor = vec4(col, a);
}
`

/** The backdrop's own family, one stop up: ember veins on near-black. */
const TINT: [number, number, number] = [0.566, 0.62, 0.084]
const DEEP: [number, number, number] = [0.156, 0.17, 0.028]
const BASE: [number, number, number] = [0.043, 0.045, 0.03]

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
  const dimension = SIZE_PX[size]

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
              "radial-gradient(circle at 46% 40%, rgba(158,97,23,0.9) 0%, rgba(66,42,10,0.85) 46%, rgba(12,10,8,0.9) 72%, transparent 96%)",
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
