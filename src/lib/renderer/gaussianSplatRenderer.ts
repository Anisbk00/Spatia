/**
 * GaussianSplatRenderer — Production WebGL2 renderer for 3D Gaussian Splat data.
 *
 * Renders photogrammetric point clouds produced by Gaussian Splatting pipelines
 * (e.g. from real-estate capture sessions) with correct alpha-blended depth
 * ordering, soft elliptical splats, and adaptive quality.
 */

import type { SplatData, RenderQuality, CameraState } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Two triangles forming a full-screen quad in [-1,1]² */
const QUAD_VERTICES = new Float32Array([
  -1, -1,
   1, -1,
   1,  1,
  -1, -1,
   1,  1,
  -1,  1,
]);

const MAX_SPLATS_LOW  = 150_000;
const MAX_SPLATS_HIGH = 2_000_000;

const DEFAULT_FOV   = Math.PI / 3; // 60°
const NEAR_PLANE    = 0.1;
const FAR_PLANE     = 1000;

const MIN_PHI       = 0.05;
const MAX_PHI       = Math.PI - 0.05;
const MIN_DISTANCE  = 0.3;
const MAX_DISTANCE  = 200;

const MOUSE_ROTATE_SPEED = 0.005;
const TOUCH_ROTATE_SPEED = 0.006;
const TOUCH_PINCH_SPEED  = 0.005;

/** Number of floats per instance in the instance buffer */
const INSTANCE_FLOATS = 15;
const INSTANCE_BYTES  = INSTANCE_FLOATS * 4;

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const VERTEX_SHADER_SRC = `#version 300 es
precision highp float;

// Per-vertex attribute (quad corner)
layout(location = 0) in vec2 a_quad;

// Per-instance attributes
layout(location = 1) in vec3 a_center;   // world-space position
layout(location = 2) in vec3 a_scale;    // Gaussian scale (sigma)
layout(location = 3) in vec4 a_rot;      // quaternion (x,y,z,w)
layout(location = 4) in vec3 a_color;    // RGB [0-1]
layout(location = 5) in float a_opacity; // alpha [0-1]

uniform mat4 u_view;
uniform mat4 u_projection;
uniform vec2 u_viewport;
uniform float u_fov;          // vertical FOV in radians
uniform float u_scaleModifier;

out vec3  v_color;
out vec2  v_quadCoord;       // normalised quad coords [-1,1]
out float v_opacity;

// ------------------------------------------------------------------
// Quaternion → 3×3 rotation matrix (row-major in GLSL)
// ------------------------------------------------------------------
mat3 quatToMat3(vec4 q) {
  float x = q.x, y = q.y, z = q.z, w = q.w;
  return mat3(
    1.0 - 2.0*(y*y + z*z),  2.0*(x*y - w*z),       2.0*(x*z + w*y),
    2.0*(x*y + w*z),        1.0 - 2.0*(x*x + z*z),  2.0*(y*z - w*x),
    2.0*(x*z - w*y),        2.0*(y*z + w*x),        1.0 - 2.0*(x*x + y*y)
  );
}

void main() {
  // ---- 1. Build 3D covariance Σ_3D = R · S · Sᵀ · Rᵀ ----
  mat3 R = quatToMat3(a_rot);
  mat3 S = mat3(
    a_scale.x, 0.0,       0.0,
    0.0,       a_scale.y, 0.0,
    0.0,       0.0,       a_scale.z
  );
  mat3 RS    = R * S;
  mat3 cov3D = RS * transpose(RS);

  // ---- 2. Transform centre to camera space ----
  vec4 camPos = u_view * vec4(a_center, 1.0);
  float cx = camPos.x;
  float cy = camPos.y;
  float cz = camPos.z;

  // Discard splats behind the camera
  if (cz < 0.001) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }

  // ---- 3. Focal lengths from viewport & FOV ----
  float halfFovTan = tan(u_fov * 0.5);
  float focal_x = u_viewport.x * 0.5 / halfFovTan;
  float focal_y = u_viewport.y * 0.5 / halfFovTan;

  // ---- 4. Jacobian J of the perspective projection ----
  //   J = [ fx/cz    0     -fx·cx/cz² ]
  //       [  0     fy/cz   -fy·cy/cz² ]
  float j00 =  focal_x / cz;
  float j11 =  focal_y / cz;
  float j02 = -focal_x * cx / (cz * cz);
  float j12 = -focal_y * cy / (cz * cz);

  // ---- 5. Rotate 3D covariance into camera space ----
  //   W = upper-left 3×3 of view matrix (world → camera rotation)
  mat3 W = transpose(mat3(u_view));
  mat3 covCam = W * cov3D * transpose(W);

  // ---- 6. Project to 2D covariance  Σ_2D = J · covCam · Jᵀ ----
  float cov_xx = j00*j00*covCam[0][0] + j02*j02*covCam[2][2] + 2.0*j00*j02*covCam[0][2];
  float cov_yy = j11*j11*covCam[1][1] + j12*j12*covCam[2][2] + 2.0*j11*j12*covCam[1][2];
  float cov_xy = j00*j11*covCam[0][1] + j00*j12*covCam[0][2]
               + j02*j11*covCam[2][1] + j02*j12*covCam[2][2];

  // Low-pass filter (avoid degenerate splats)
  float det = cov_xx * cov_yy - cov_xy * cov_xy;
  if (det < 0.0001) {
    cov_xx += 0.0001;
    cov_yy += 0.0001;
    cov_xy  = 0.0;
  }

  // ---- 7. Eigen-decomposition of 2×2 symmetric matrix ----
  float a  = cov_xx;
  float b  = cov_xy;
  float d  = cov_yy;
  float tr = a + d;
  float disc = sqrt(max(0.0, tr * tr * 0.25 - (a * d - b * b)));
  float lambda1 = max(tr * 0.5 + disc, 0.0001);
  float lambda2 = max(tr * 0.5 - disc, 0.0001);

  // Rotation angle of the ellipse
  float angle = 0.5 * atan2(2.0 * b, a - d);

  // Semi-axes = 3σ (covers 99.7 % of the Gaussian)
  float radius1 = 3.0 * sqrt(lambda1) * u_scaleModifier;
  float radius2 = 3.0 * sqrt(lambda2) * u_scaleModifier;

  // ---- 8. Project centre to NDC ----
  vec4  proj        = u_projection * camPos;
  vec2  screenCentre = proj.xy / proj.w;

  // ---- 9. Rotate & scale the quad corner into pixel offset ----
  float cosA = cos(angle);
  float sinA = sin(angle);
  vec2 offset = vec2(
    a_quad.x * radius1 * cosA - a_quad.y * radius2 * sinA,
    a_quad.x * radius1 * sinA + a_quad.y * radius2 * cosA
  );

  // Pixels → NDC
  offset.x /= (u_viewport.x * 0.5);
  offset.y /= (u_viewport.y * 0.5);

  gl_Position = vec4(screenCentre + offset, proj.z / proj.w, 1.0);

  // Pass varyings to fragment
  v_color     = a_color;
  v_quadCoord = a_quad;   // [-1, 1]
  v_opacity   = a_opacity;
}
`;

const FRAGMENT_SHADER_SRC = `#version 300 es
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

in vec3  v_color;
in vec2  v_quadCoord;   // [-1, 1]
in float v_opacity;

out vec4 fragColor;

void main() {
  // Gaussian falloff: exp(-½(x² + y²)) where x,y ∈ [-1,1] correspond to 3σ
  float power = -0.5 * (v_quadCoord.x * v_quadCoord.x + v_quadCoord.y * v_quadCoord.y);
  if (power > 0.0) discard;

  float alpha = min(0.99, v_opacity * exp(power));
  if (alpha < 1.0 / 255.0) discard;

  fragColor = vec4(v_color, alpha);
}
`;

// ---------------------------------------------------------------------------
// Device capability detection
// ---------------------------------------------------------------------------

interface DeviceCapabilities {
  isMobile: boolean;
  maxTextureSize: number;
  maxInstances: number;
  preferredQuality: RenderQuality;
}

function detectDeviceCapabilities(gl: WebGL2RenderingContext): DeviceCapabilities {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isMobile =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) ||
    (typeof window !== "undefined" && window.innerWidth < 768);

  const maxTexSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const maxRBSize  = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number;

  const debugExt = gl.getExtension("WEBGL_debug_renderer_info");
  let rendererStr = "";
  if (debugExt) {
    rendererStr = (gl.getParameter(debugExt.UNMASKED_RENDERER_WEBGL) as string).toLowerCase();
  }

  const isWeakGPU =
    rendererStr.includes("intel") ||
    rendererStr.includes("integrated") ||
    rendererStr.includes("mali") ||
    rendererStr.includes("adreno") ||
    rendererStr.includes("powervr") ||
    rendererStr.includes("apple gpu") ||
    rendererStr.includes("swiftshader");

  const maxInstances = isMobile
    ? Math.min(MAX_SPLATS_LOW, maxTexSize > 4096 ? 200_000 : 100_000)
    : isWeakGPU
      ? Math.min(MAX_SPLATS_HIGH, 500_000)
      : MAX_SPLATS_HIGH;

  return {
    isMobile,
    maxTextureSize: Math.min(maxTexSize, maxRBSize),
    maxInstances,
    preferredQuality: isMobile ? "low" : "high",
  };
}

// ---------------------------------------------------------------------------
// Orbit camera
// ---------------------------------------------------------------------------

class OrbitCamera {
  theta    = 0.0;
  phi      = Math.PI / 2;
  distance = 5.0;
  target: [number, number, number] = [0, 0, 0];
  fov      = DEFAULT_FOV;

  // Smooth-interpolation targets
  private tTheta    = 0.0;
  private tPhi      = Math.PI / 2;
  private tDistance  = 5.0;
  private tTarget: [number, number, number] = [0, 0, 0];
  private readonly DAMPING = 0.12;

  // Interaction
  private dragging   = false;
  private lastX      = 0;
  private lastY      = 0;
  private pinchDist  = 0;
  private canvas: HTMLCanvasElement | null = null;

  // Inertia
  private velX = 0;
  private velY = 0;
  private readonly FRICTION = 0.92;

  // Keyboard navigation
  private keysPressed: Set<string> = new Set();
  private readonly MOVE_SPEED = 0.05;

  // ---- public API ----

  getState(): CameraState {
    return {
      theta:    this.theta,
      phi:      this.phi,
      distance: this.distance,
      target:   [...this.target] as [number, number, number],
      fov:      this.fov,
    };
  }

  reset(): void {
    this.theta = 0;
    this.phi = Math.PI / 2;
    this.distance = 5.0;
    this.target = [0, 0, 0];
    this.tTheta = 0;
    this.tPhi = Math.PI / 2;
    this.tDistance = 5.0;
    this.tTarget = [0, 0, 0];
    this.velX = 0;
    this.velY = 0;
    this.keysPressed.clear();
  }

  setTargetTheta(v: number)    { this.tTheta = v; }
  setTargetPhi(v: number)      { this.tPhi = clamp(v, MIN_PHI, MAX_PHI); }
  setTargetDistance(v: number)  { this.tDistance = clamp(v, MIN_DISTANCE, MAX_DISTANCE); }
  setTargetTarget(v: [number, number, number]) { this.tTarget = v; }

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    canvas.tabIndex = 0;
    canvas.addEventListener("mousedown",    this._onMouseDown);
    canvas.addEventListener("mousemove",    this._onMouseMove);
    canvas.addEventListener("mouseup",      this._onMouseUp);
    canvas.addEventListener("mouseleave",   this._onMouseUp);
    canvas.addEventListener("wheel",        this._onWheel, { passive: false });
    canvas.addEventListener("touchstart",   this._onTouchStart, { passive: false });
    canvas.addEventListener("touchmove",    this._onTouchMove,  { passive: false });
    canvas.addEventListener("touchend",     this._onTouchEnd);
    canvas.addEventListener("touchcancel",  this._onTouchEnd);
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup",   this._onKeyUp);
  }

  detach(): void {
    if (!this.canvas) return;
    const c = this.canvas;
    c.removeEventListener("mousedown",   this._onMouseDown);
    c.removeEventListener("mousemove",   this._onMouseMove);
    c.removeEventListener("mouseup",     this._onMouseUp);
    c.removeEventListener("mouseleave",  this._onMouseUp);
    c.removeEventListener("wheel",       this._onWheel);
    c.removeEventListener("touchstart",  this._onTouchStart);
    c.removeEventListener("touchmove",   this._onTouchMove);
    c.removeEventListener("touchend",    this._onTouchEnd);
    c.removeEventListener("touchcancel", this._onTouchEnd);
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup",   this._onKeyUp);
    this.canvas = null;
  }

  /** Interpolate toward target values each frame */
  update(): void {
    this.tTheta   += this.velX;
    this.tPhi     += this.velY;
    this.velX     *= this.FRICTION;
    this.velY     *= this.FRICTION;
    if (Math.abs(this.velX) < 1e-5) this.velX = 0;
    if (Math.abs(this.velY) < 1e-5) this.velY = 0;

    this.tPhi     = clamp(this.tPhi, MIN_PHI, MAX_PHI);
    this.tDistance = clamp(this.tDistance, MIN_DISTANCE, MAX_DISTANCE);

    // WASD keyboard movement — translate target in camera-local frame
    if (this.keysPressed.size > 0) {
      const st = Math.sin(this.theta);
      const ct = Math.cos(this.theta);

      // Forward direction in XZ plane (camera look direction projected)
      const fwdX = -st;
      const fwdZ = -ct;

      // Right direction in XZ plane
      const rightX = ct;
      const rightZ = -st;

      let dx = 0, dy = 0, dz = 0;
      const speed = this.MOVE_SPEED;

      if (this.keysPressed.has('w') || this.keysPressed.has('W') || this.keysPressed.has('ArrowUp')) {
        dx += fwdX * speed;
        dz += fwdZ * speed;
      }
      if (this.keysPressed.has('s') || this.keysPressed.has('S') || this.keysPressed.has('ArrowDown')) {
        dx -= fwdX * speed;
        dz -= fwdZ * speed;
      }
      if (this.keysPressed.has('d') || this.keysPressed.has('D') || this.keysPressed.has('ArrowRight')) {
        dx += rightX * speed;
        dz += rightZ * speed;
      }
      if (this.keysPressed.has('a') || this.keysPressed.has('A') || this.keysPressed.has('ArrowLeft')) {
        dx -= rightX * speed;
        dz -= rightZ * speed;
      }
      if (this.keysPressed.has('q') || this.keysPressed.has('Q')) {
        dy += speed;
      }
      if (this.keysPressed.has('e') || this.keysPressed.has('E')) {
        dy -= speed;
      }

      this.tTarget[0] += dx;
      this.tTarget[1] += dy;
      this.tTarget[2] += dz;
    }

    this.theta   += (this.tTheta   - this.theta)   * this.DAMPING;
    this.phi     += (this.tPhi     - this.phi)     * this.DAMPING;
    this.distance += (this.tDistance - this.distance) * this.DAMPING;
    for (let i = 0; i < 3; i++) {
      this.target[i] += (this.tTarget[i] - this.target[i]) * this.DAMPING;
    }
  }

  /** Column-major 4×4 view matrix */
  getViewMatrix(): Float32Array {
    const cp = Math.cos(this.phi), sp = Math.sin(this.phi);
    const ct = Math.cos(this.theta), st = Math.sin(this.theta);

    const eyeX = this.target[0] + this.distance * cp * st;
    const eyeY = this.target[1] + this.distance * sp;
    const eyeZ = this.target[2] + this.distance * cp * ct;

    // forward = normalize(target - eye)
    const fx = this.target[0] - eyeX;
    const fy = this.target[1] - eyeY;
    const fz = this.target[2] - eyeZ;
    const fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
    const fxl = fx / fl, fyl = fy / fl, fzl = fz / fl;

    // right = normalize(cross(forward, worldUp=[0,1,0]))
    let rx = -fzl, ry = 0, rz = fxl;
    const rl = Math.sqrt(rx * rx + rz * rz);
    if (rl < 1e-6) { rx = 1; rz = 0; } else { rx /= rl; rz /= rl; }

    // up = cross(right, forward)
    const ux = ry * fzl - rz * fyl;
    const uy = rz * fxl - rx * fzl;
    const uz = rx * fyl - ry * fxl;

    return new Float32Array([
      rx,   ux,  -fxl, 0,
      ry,   uy,  -fyl, 0,
      rz,   uz,  -fzl, 0,
      -(rx * eyeX + ry * eyeY + rz * eyeZ),
      -(ux * eyeX + uy * eyeY + uz * eyeZ),
       (fxl * eyeX + fyl * eyeY + fzl * eyeZ),
      1,
    ]);
  }

  /** Column-major 4×4 perspective projection matrix */
  getProjectionMatrix(aspect: number): Float32Array {
    return perspectiveMatrix(this.fov, aspect, NEAR_PLANE, FAR_PLANE);
  }

  /** Camera position in world space */
  getEyePosition(): [number, number, number] {
    const cp = Math.cos(this.phi), sp = Math.sin(this.phi);
    const ct = Math.cos(this.theta), st = Math.sin(this.theta);
    return [
      this.target[0] + this.distance * cp * st,
      this.target[1] + this.distance * sp,
      this.target[2] + this.distance * cp * ct,
    ];
  }

  // ---- private event handlers ----

  private _onMouseDown = (e: MouseEvent) => {
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.velX = 0;
    this.velY = 0;
  };

  private _onMouseMove = (e: MouseEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this._applyRotate(dx, dy, MOUSE_ROTATE_SPEED);
  };

  private _onMouseUp = () => { this.dragging = false; };

  private _onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const factor = 1 + e.deltaY * 0.001;
    this.tDistance = clamp(this.tDistance * factor, MIN_DISTANCE, MAX_DISTANCE);
  };

  private _onTouchStart = (e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      this.dragging = true;
      this.lastX = e.touches[0].clientX;
      this.lastY = e.touches[0].clientY;
      this.velX = 0;
      this.velY = 0;
    } else if (e.touches.length === 2) {
      this.dragging = false;
      this.pinchDist = pinchDistance(e.touches);
    }
  };

  private _onTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1 && this.dragging) {
      const dx = e.touches[0].clientX - this.lastX;
      const dy = e.touches[0].clientY - this.lastY;
      this.lastX = e.touches[0].clientX;
      this.lastY = e.touches[0].clientY;
      this._applyRotate(dx, dy, TOUCH_ROTATE_SPEED);
    } else if (e.touches.length === 2) {
      const newDist = pinchDistance(e.touches);
      const delta = (newDist - this.pinchDist) * TOUCH_PINCH_SPEED;
      this.tDistance = clamp(this.tDistance * (1 - delta), MIN_DISTANCE, MAX_DISTANCE);
      this.pinchDist = newDist;
    }
  };

  private _onTouchEnd = (e: TouchEvent) => {
    if (e.touches.length === 0) this.dragging = false;
  };

  private _applyRotate(dx: number, dy: number, speed: number) {
    this.tTheta -= dx * speed;
    this.tPhi    = clamp(this.tPhi + dy * speed, MIN_PHI, MAX_PHI);
    this.velX = -dx * speed * 0.4;
    this.velY =  dy * speed * 0.4;
  }

  private _onKeyDown = (e: KeyboardEvent) => {
    this.keysPressed.add(e.key);
  };

  private _onKeyUp = (e: KeyboardEvent) => {
    this.keysPressed.delete(e.key);
  };
}

// ---------------------------------------------------------------------------
// Small math helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function perspectiveMatrix(fov: number, aspect: number, near: number, far: number): Float32Array {
  const f  = 1.0 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function pinchDistance(touches: TouchList): number {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

// ---------------------------------------------------------------------------
// Radix sort (depth ordering — back-to-front for painter's algorithm)
// ---------------------------------------------------------------------------

/**
 * In-place 4-pass LSB radix sort (8 bits per pass) over `indices`,
 * keyed by `depthKeys` (Float32).  After the call `indices` is sorted
 * in *ascending* key order (near → far).
 */
function radixSortAsc(
  indices: Uint32Array,
  depthKeys: Float32Array,
  count: number,
): void {
  // Convert IEEE-754 floats to monotonic uint32 so ascending sort works.
  const uintKeys = new Uint32Array(count);
  const dv = new DataView(depthKeys.buffer, depthKeys.byteOffset, count * 4);
  for (let i = 0; i < count; i++) {
    let k = dv.getUint32(i * 4, true); // little-endian
    // Flip sign bit: positive floats already sort correctly with the bit flipped;
    // negative floats need all bits inverted.
    if (k & 0x80000000) { k = ~k; } else { k ^= 0x80000000; }
    uintKeys[i] = k;
  }

  const tmpIdx = new Uint32Array(count);
  const tmpKey = new Uint32Array(count);

  for (let shift = 0; shift < 32; shift += 8) {
    const bins = new Uint32Array(256);

    for (let i = 0; i < count; i++) bins[(uintKeys[i] >>> shift) & 0xff]++;

    let total = 0;
    for (let i = 0; i < 256; i++) { const c = bins[i]; bins[i] = total; total += c; }

    for (let i = 0; i < count; i++) {
      const b = (uintKeys[i] >>> shift) & 0xff;
      const dst = bins[b]++;
      tmpIdx[dst] = indices[i];
      tmpKey[dst] = uintKeys[i];
    }

    indices.set(tmpIdx.subarray(0, count));
    uintKeys.set(tmpKey.subarray(0, count));
  }
}

// ---------------------------------------------------------------------------
// Main renderer class
// ---------------------------------------------------------------------------

export class GaussianSplatRenderer {
  // ---- public camera mirror ----
  public camera: {
    theta: number;
    phi: number;
    distance: number;
    target: [number, number, number];
  };

  // ---- private state ----
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private orbitCam: OrbitCamera;
  private caps: DeviceCapabilities | null = null;

  // GPU objects
  private quadVBO: WebGLBuffer | null     = null;
  private instanceVBO: WebGLBuffer | null = null;
  private vao: WebGLVertexArrayObject | null = null;

  // CPU-side data
  private splatData: SplatData | null       = null;
  private sortedIndices: Uint32Array | null = null;
  private depthKeys: Float32Array | null    = null;
  private instanceBuf: Float32Array | null  = null;

  // Pre-allocated sort buffers (reused every frame — avoids ~48MB/frame GC)
  private _sortKeys: Uint32Array | null   = null;
  private _sortTmpIdx: Uint32Array | null = null;
  private _sortTmpKey: Uint32Array | null = null;
  private _sortDv: DataView | null        = null;
  private _sortBins: Uint32Array          = new Uint32Array(256);

  // Context loss handling
  private _contextLost = false;
  private _contextLostHandler: ((e: Event) => void) | null = null;
  private _contextRestoredHandler: (() => void) | null = null;

  // Quality
  private quality: RenderQuality = "high";
  private maxSplatCount = MAX_SPLATS_HIGH;
  private renderedCount = 0;
  private scaleModifier = 1.0;

  // Animation loop
  private rafId        = 0;
  private running      = false;
  private fpsCallback: ((fps: number) => void) | null = null;
  private lastFrameTs  = 0;
  private frameCount   = 0;
  private fpsAccum     = 0;
  private currentFps   = 0;

  // Progressive rendering
  private progressivePhase     = 0;
  private progressiveChunkSize = 50_000;

  // Resize
  private resizeObs: ResizeObserver | null = null;

  // Uniform locations (cached after link)
  private uView: WebGLUniformLocation | null          = null;
  private uProjection: WebGLUniformLocation | null     = null;
  private uViewport: WebGLUniformLocation | null       = null;
  private uFov: WebGLUniformLocation | null            = null;
  private uScaleModifier: WebGLUniformLocation | null  = null;

  private initialized = false;

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.orbitCam = new OrbitCamera();

    // The public `camera` object delegates reads/writes to the OrbitCamera.
    // We capture orbitCam in a local to avoid aliasing `this`.
    const cam = this.orbitCam;
    this.camera = {
      get theta()    { return cam.theta; },
      set theta(v)   { cam.setTargetTheta(v); },
      get phi()      { return cam.phi; },
      set phi(v)     { cam.setTargetPhi(v); },
      get distance() { return cam.distance; },
      set distance(v){ cam.setTargetDistance(v); },
      get target()   { return cam.target; },
      set target(v)  { cam.setTargetTarget(v); },
    };
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  init(): void {
    if (this.initialized) {
      console.warn("[GaussianSplatRenderer] Already initialized. Call dispose() first.");
      return;
    }

    const gl = this.canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL2 is not supported by this browser.");

    this.gl = gl;

    // Device capabilities
    this.caps = detectDeviceCapabilities(gl);
    this.quality       = this.caps.preferredQuality;
    this.maxSplatCount = this.quality === "low" ? MAX_SPLATS_LOW : this.caps.maxInstances;
    this.scaleModifier = this.caps.isMobile ? 1.2 : 1.0;

    // Compile & link shaders
    const vs = this._compile(gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
    const fs = this._compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);
    if (!vs || !fs) throw new Error("Failed to compile Gaussian Splat shaders.");

    const prog = gl.createProgram();
    if (!prog) throw new Error("Failed to create WebGL program — GPU may be out of memory.");
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new Error(`Shader link failed: ${log}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.program = prog;

    // Cache uniform locations
    this.uView          = gl.getUniformLocation(prog, "u_view");
    this.uProjection    = gl.getUniformLocation(prog, "u_projection");
    this.uViewport      = gl.getUniformLocation(prog, "u_viewport");
    this.uFov           = gl.getUniformLocation(prog, "u_fov");
    this.uScaleModifier = gl.getUniformLocation(prog, "u_scaleModifier");

    // Quad VBO
    this.quadVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTICES, gl.STATIC_DRAW);

    // Instance VBO (populated later)
    this.instanceVBO = gl.createBuffer();

    // VAO
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    // location 0 — quad vertex (not instanced)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Instance attributes: layout = [center(3), scale(3), rot(4), color(3), opacity(1), pad(1)]
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVBO);

    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, INSTANCE_BYTES, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, INSTANCE_BYTES, 12);
    gl.vertexAttribDivisor(2, 1);

    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, INSTANCE_BYTES, 24);
    gl.vertexAttribDivisor(3, 1);

    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 3, gl.FLOAT, false, INSTANCE_BYTES, 40);
    gl.vertexAttribDivisor(4, 1);

    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 1, gl.FLOAT, false, INSTANCE_BYTES, 52);
    gl.vertexAttribDivisor(5, 1);

    gl.bindVertexArray(null);

    // Global GL state
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // WebGL context loss handling
    this._contextLostHandler = (e: Event) => {
      e.preventDefault();
      this.running = false;
      this._contextLost = true;
    };
    this._contextRestoredHandler = () => {
      this._contextLost = false;
      this.dispose();
      this.init();
      this._startRenderLoop();
    };
    this.canvas.addEventListener("webglcontextlost", this._contextLostHandler);
    this.canvas.addEventListener("webglcontextrestored", this._contextRestoredHandler);

    // Attach orbit camera controls
    this.orbitCam.attach(this.canvas);

    // Responsive resize
    this.resizeObs = new ResizeObserver(() => this._handleResize());
    this.resizeObs.observe(this.canvas);
    this._handleResize();

    this.initialized = true;
  }

  // -----------------------------------------------------------------------
  // Data loading
  // -----------------------------------------------------------------------

  loadSplatData(data: SplatData): void {
    if (!this.gl || !this.initialized) {
      throw new Error("Renderer not initialised — call init() first.");
    }
    this.splatData = data;

    const count = Math.min(data.count, this.maxSplatCount);
    this.renderedCount = count;

    // Allocate index / depth buffers
    this.sortedIndices = new Uint32Array(count);
    this.depthKeys     = new Float32Array(count);
    for (let i = 0; i < count; i++) this.sortedIndices[i] = i;

    // Pre-allocate sort temporary buffers (reused every frame)
    this._sortKeys   = new Uint32Array(count);
    this._sortTmpIdx = new Uint32Array(count);
    this._sortTmpKey = new Uint32Array(count);
    this._sortDv     = null; // created lazily with correct byteOffset

    // Initial sort + upload
    this._sortAndRebuild();

    // Reset progressive phase
    this.progressivePhase = 0;
  }

  // -----------------------------------------------------------------------
  // Quality
  // -----------------------------------------------------------------------

  setQuality(quality: RenderQuality): void {
    this.quality = quality;
    if (this.caps) {
      this.maxSplatCount =
        quality === "low"
          ? Math.min(MAX_SPLATS_LOW, this.caps.maxInstances)
          : this.caps.maxInstances;
    }
    this.scaleModifier = quality === "low" ? 1.3 : (this.caps?.isMobile ? 1.2 : 1.0);

    if (this.splatData) {
      const newCount = Math.min(this.splatData.count, this.maxSplatCount);
      if (newCount !== this.renderedCount) {
        this.renderedCount = newCount;
        this.sortedIndices = new Uint32Array(newCount);
        this.depthKeys     = new Float32Array(newCount);
        for (let i = 0; i < newCount; i++) this.sortedIndices[i] = i;

        // Re-allocate sort temporary buffers for new count
        this._sortKeys   = new Uint32Array(newCount);
        this._sortTmpIdx = new Uint32Array(newCount);
        this._sortTmpKey = new Uint32Array(newCount);
        this._sortDv     = null;

        this._sortAndRebuild();
      }
    }
  }

  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  render(): void {
    if (this._contextLost || !this.gl || !this.initialized || !this.program) return;
    const gl = this.gl;

    // Camera interpolation
    this.orbitCam.update();

    // Depth-sort splats (every frame so camera movement is reflected)
    this._sortAndRebuild();

    // Clear
    gl.clearColor(0.06, 0.06, 0.08, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (!this.splatData || this.renderedCount === 0) return;

    // Progressive: reveal splats in chunks over the first few frames
    const drawCount = Math.min(
      this.renderedCount,
      (this.progressivePhase + 1) * this.progressiveChunkSize,
    );
    this.progressivePhase++;

    // Upload uniforms
    gl.useProgram(this.program);
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    gl.uniformMatrix4fv(this.uView, false, this.orbitCam.getViewMatrix());
    gl.uniformMatrix4fv(this.uProjection, false, this.orbitCam.getProjectionMatrix(aspect));
    gl.uniform2f(this.uViewport, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uFov, this.orbitCam.fov);
    gl.uniform1f(this.uScaleModifier, this.scaleModifier);

    // Draw instanced quads
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, drawCount);
    gl.bindVertexArray(null);
  }

  // -----------------------------------------------------------------------
  // Animation loop
  // -----------------------------------------------------------------------

  /** Start continuous rendering (call once after init + loadSplatData) */
  startLoop(): void {
    if (this.running) return;
    this.running      = true;
    this.lastFrameTs  = performance.now();
    this.frameCount   = 0;
    this.fpsAccum     = 0;
    this.rafId = requestAnimationFrame(this._loop);
  }

  /** Stop continuous rendering */
  stopLoop(): void {
    this.running = false;
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = 0; }
  }

  /** Register a callback invoked every ~500 ms with the current FPS */
  onFrame(callback: (fps: number) => void): void {
    this.fpsCallback = callback;
  }

  // -----------------------------------------------------------------------
  // Camera helpers
  // -----------------------------------------------------------------------

  resetCamera(): void {
    this.orbitCam.reset();
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  dispose(): void {
    this.stopLoop();

    // Remove context loss listeners
    if (this._contextLostHandler) {
      this.canvas.removeEventListener("webglcontextlost", this._contextLostHandler);
      this._contextLostHandler = null;
    }
    if (this._contextRestoredHandler) {
      this.canvas.removeEventListener("webglcontextrestored", this._contextRestoredHandler);
      this._contextRestoredHandler = null;
    }

    if (this.resizeObs) { this.resizeObs.disconnect(); this.resizeObs = null; }
    this.orbitCam.detach();

    const gl = this.gl;
    if (gl) {
      if (this.vao)         { gl.deleteVertexArray(this.vao);         this.vao = null; }
      if (this.quadVBO)     { gl.deleteBuffer(this.quadVBO);         this.quadVBO = null; }
      if (this.instanceVBO) { gl.deleteBuffer(this.instanceVBO);     this.instanceVBO = null; }
      if (this.program)     { gl.deleteProgram(this.program);         this.program = null; }
    }

    this.gl             = null;
    this.initialized    = false;
    this.splatData      = null;
    this.sortedIndices  = null;
    this.depthKeys      = null;
    this.instanceBuf    = null;
    this.renderedCount  = 0;

    // Release sort buffers
    this._sortKeys   = null;
    this._sortTmpIdx = null;
    this._sortTmpKey = null;
    this._sortDv     = null;
  }

  // =======================================================================
  // Private helpers
  // =======================================================================

  /**
   * Depth-sort all splats back-to-front (painter's algorithm) and
   * rebuild + upload the instance buffer.
   */
  private _sortAndRebuild(): void {
    if (!this.splatData || !this.sortedIndices || !this.depthKeys || !this.gl) return;

    const data  = this.splatData;
    const count = this.renderedCount;

    // Compute camera-space Z for every splat using the view matrix.
    // This is cheaper than squared-distance and sorts identically.
    const vm = this.orbitCam.getViewMatrix();
    // View matrix row 2 (column-major): [vm[2], vm[6], vm[10]] = forward axis
    // Translation component for Z: vm[14]
    const r20 = vm[2],  r21 = vm[6],  r22 = vm[10], tz = vm[14];

    for (let i = 0; i < count; i++) {
      const px = data.positions[i * 3];
      const py = data.positions[i * 3 + 1];
      const pz = data.positions[i * 3 + 2];
      this.depthKeys[i]     = r20 * px + r21 * py + r22 * pz + tz;
      this.sortedIndices[i] = i;
    }

    // In-place radix sort using pre-allocated buffers
    this._radixSortInPlace(count);

    // Reverse for painter's algorithm (draw far splats first)
    this.sortedIndices.reverse();

    // Build the instance buffer in the sorted order
    this._fillInstanceBuffer(count);
  }

  /**
   * In-place 4-pass LSB radix sort using pre-allocated class buffers.
   * Avoids allocating ~48MB of temporary typed arrays every frame.
   */
  private _radixSortInPlace(count: number): void {
    const uintKeys  = this._sortKeys!;
    const tmpIdx    = this._sortTmpIdx!;
    const tmpKey    = this._sortTmpKey!;
    const indices   = this.sortedIndices!;
    const depthKeys = this.depthKeys!;
    const bins      = this._sortBins;

    // Lazily create DataView with correct byteOffset
    if (!this._sortDv) {
      this._sortDv = new DataView(
        depthKeys.buffer,
        depthKeys.byteOffset,
        count * 4,
      );
    }
    const dv = this._sortDv;

    // Convert IEEE-754 floats to monotonic uint32 for ascending sort
    for (let i = 0; i < count; i++) {
      let k = dv.getUint32(i * 4, true); // little-endian
      if (k & 0x80000000) { k = ~k; } else { k ^= 0x80000000; }
      uintKeys[i] = k;
    }

    // 4-pass radix sort (8 bits per pass)
    for (let shift = 0; shift < 32; shift += 8) {
      bins.fill(0);

      for (let i = 0; i < count; i++) bins[(uintKeys[i] >>> shift) & 0xff]++;

      let total = 0;
      for (let i = 0; i < 256; i++) { const c = bins[i]; bins[i] = total; total += c; }

      for (let i = 0; i < count; i++) {
        const b = (uintKeys[i] >>> shift) & 0xff;
        const dst = bins[b]++;
        tmpIdx[dst] = indices[i];
        tmpKey[dst] = uintKeys[i];
      }

      indices.set(tmpIdx.subarray(0, count));
      uintKeys.set(tmpKey.subarray(0, count));
    }
  }

  /**
   * Fill `instanceBuf` from `splatData` in `sortedIndices` order
   * and upload to the GPU.
   */
  private _fillInstanceBuffer(count: number): void {
    if (!this.splatData || !this.sortedIndices || !this.gl) return;

    const data = this.splatData;
    const gl   = this.gl;

    const needed = count * INSTANCE_FLOATS;
    if (!this.instanceBuf || this.instanceBuf.length < needed) {
      this.instanceBuf = new Float32Array(needed);
    }
    const buf = this.instanceBuf;

    for (let i = 0; i < count; i++) {
      const src = this.sortedIndices[i];
      const o   = i * INSTANCE_FLOATS;

      buf[o]      = data.positions[src * 3];
      buf[o + 1]  = data.positions[src * 3 + 1];
      buf[o + 2]  = data.positions[src * 3 + 2];

      buf[o + 3]  = data.scales[src * 3];
      buf[o + 4]  = data.scales[src * 3 + 1];
      buf[o + 5]  = data.scales[src * 3 + 2];

      buf[o + 6]  = data.rotations[src * 4];
      buf[o + 7]  = data.rotations[src * 4 + 1];
      buf[o + 8]  = data.rotations[src * 4 + 2];
      buf[o + 9]  = data.rotations[src * 4 + 3];

      buf[o + 10] = data.colors[src * 3];
      buf[o + 11] = data.colors[src * 3 + 1];
      buf[o + 12] = data.colors[src * 3 + 2];

      buf[o + 13] = data.opacities[src];
      buf[o + 14] = 0; // padding
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVBO);
    gl.bufferData(gl.ARRAY_BUFFER, buf.subarray(0, needed), gl.DYNAMIC_DRAW);
  }

  /** Resize the canvas backing store to match its CSS layout size at the current DPR. */
  private _handleResize(): void {
    if (!this.gl) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w   = Math.floor(this.canvas.clientWidth * dpr);
    const h   = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width  = w;
      this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
    }
  }

  /** Compile a single GLSL shader, returning null on failure. */
  private _compile(type: number, src: string): WebGLShader | null {
    const gl = this.gl!;
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error(
        `Shader compile error (${type === gl.VERTEX_SHADER ? "vertex" : "fragment"}):`,
        gl.getShaderInfoLog(sh),
      );
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  /** Restart the render loop (used after context restore) */
  private _startRenderLoop(): void {
    if (this.running) return;
    this.running      = true;
    this.lastFrameTs  = performance.now();
    this.frameCount   = 0;
    this.fpsAccum     = 0;
    this.rafId = requestAnimationFrame(this._loop);
  }

  /** requestAnimationFrame callback */
  private _loop = (now: number): void => {
    if (!this.running) return;
    if (this._contextLost) {
      this.rafId = requestAnimationFrame(this._loop);
      return;
    }

    const dt = now - this.lastFrameTs;
    this.lastFrameTs = now;
    this.frameCount++;
    this.fpsAccum += dt;

    if (this.fpsAccum >= 500) {
      this.currentFps = Math.round((this.frameCount / this.fpsAccum) * 1000);
      this.frameCount = 0;
      this.fpsAccum   = 0;
      if (this.fpsCallback) this.fpsCallback(this.currentFps);
    }

    this.render();
    this.rafId = requestAnimationFrame(this._loop);
  };
}
