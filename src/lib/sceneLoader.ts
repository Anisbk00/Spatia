import type { SplatData } from "@/lib/types";

/**
 * Parse a binary .splat file into SplatData
 * 
 * Binary .splat format (per Gaussian, 32 bytes):
 * - position: 3 × float32 (12 bytes) - x, y, z
 * - scale: 3 × float32 (12 bytes) - log(scale) sx, sy, sz
 * - rotation: 4 × uint8 (4 bytes) - normalized quaternion w, x, y, z
 * - color: 3 × uint8 (3 bytes) - RGB
 * - opacity: 1 × uint8 (1 byte) - alpha
 */
function parseBinarySplat(buffer: ArrayBuffer): SplatData {
  const bytesPerSplat = 32;
  const count = Math.floor(buffer.byteLength / bytesPerSplat);
  
  const data = new DataView(buffer);
  
  const positions = new Float32Array(count * 3);
  const scales = new Float32Array(count * 3);
  const rotations = new Float32Array(count * 4);
  const colors = new Float32Array(count * 3);
  const opacities = new Float32Array(count);
  
  for (let i = 0; i < count; i++) {
    const offset = i * bytesPerSplat;
    
    // Position (3 × float32)
    positions[i * 3] = data.getFloat32(offset, true);
    positions[i * 3 + 1] = data.getFloat32(offset + 4, true);
    positions[i * 3 + 2] = data.getFloat32(offset + 8, true);
    
    // Scale (3 × float32, stored as log scale)
    scales[i * 3] = data.getFloat32(offset + 12, true);
    scales[i * 3 + 1] = data.getFloat32(offset + 16, true);
    scales[i * 3 + 2] = data.getFloat32(offset + 20, true);
    
    // Rotation (4 × uint8, normalized quaternion)
    const rw = data.getUint8(offset + 24) / 255;
    const rx = data.getUint8(offset + 25) / 255;
    const ry = data.getUint8(offset + 26) / 255;
    const rz = data.getUint8(offset + 27) / 255;
    
    // Normalize quaternion
    const qLen = Math.sqrt(rw * rw + rx * rx + ry * ry + rz * rz) || 1;
    rotations[i * 4] = rw / qLen;
    rotations[i * 4 + 1] = rx / qLen;
    rotations[i * 4 + 2] = ry / qLen;
    rotations[i * 4 + 3] = rz / qLen;
    
    // Color (3 × uint8)
    colors[i * 3] = data.getUint8(offset + 28) / 255;
    colors[i * 3 + 1] = data.getUint8(offset + 29) / 255;
    colors[i * 3 + 2] = data.getUint8(offset + 30) / 255;
    
    // Opacity (1 × uint8)
    opacities[i] = data.getUint8(offset + 31) / 255;
  }
  
  return { positions, scales, rotations, colors, opacities, count };
}

/**
 * Parse a PLY file (ASCII or binary) containing Gaussian Splat data
 * Supports the format used by INRIA's 3D Gaussian Splatting
 */
function parsePlyFile(buffer: ArrayBuffer): SplatData {
  const decoder = new TextDecoder();
  const headerEnd = findPlyHeaderEnd(buffer);
  const headerText = decoder.decode(new Uint8Array(buffer, 0, headerEnd));
  
  // Parse header to find property names and data format
  const isBinary = headerText.includes("binary_little_endian");
  if (!isBinary) {
    throw new Error("ASCII PLY format is not supported. Only binary_little_endian PLY is supported.");
  }
  const properties = headerText
    .split("\n")
    .filter((line) => line.startsWith("property "))
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      return { type: parts[1], name: parts[2] };
    });
  
  const vertexCountMatch = headerText.match(/element vertex (\d+)/);
  if (!vertexCountMatch) {
    throw new Error("Invalid PLY: missing vertex count");
  }
  const count = parseInt(vertexCountMatch[1]);
  
  // Build byte layout for binary PLY
  const byteSizePerVertex = properties.reduce((sum, p) => {
    switch (p.type) {
      case "float": case "float32": return sum + 4;
      case "uchar": case "uint8": return sum + 1;
      case "short": case "int16": return sum + 2;
      case "int": case "int32": return sum + 4;
      default: return sum + 4;
    }
  }, 0);
  
  // Find property indices (computed once before the vertex loop — O(n) instead of O(n²))
  const propIndex = (name: string) => properties.findIndex((p) => p.name === name);

  const xIdx  = propIndex("x");
  const yIdx  = propIndex("y");
  const zIdx  = propIndex("z");
  const sxIdx = propIndex("scale_0") ?? propIndex("sx");
  const syIdx = propIndex("scale_1") ?? propIndex("sy");
  const szIdx = propIndex("scale_2") ?? propIndex("sz");
  const rwIdx = propIndex("rot_0") ?? propIndex("qw");
  const rxIdx = propIndex("rot_1") ?? propIndex("qx");
  const ryIdx = propIndex("rot_2") ?? propIndex("qy");
  const rzIdx = propIndex("rot_3") ?? propIndex("qz");
  const rColIdx = propIndex("f_dc_0") ?? propIndex("red") ?? propIndex("r");
  const gColIdx = propIndex("f_dc_1") ?? propIndex("green") ?? propIndex("g");
  const bColIdx = propIndex("f_dc_2") ?? propIndex("blue") ?? propIndex("b");
  const opIdx  = propIndex("opacity") ?? propIndex("alpha") ?? propIndex("a");
  const isSHColor = rColIdx >= 0 && properties[rColIdx].name === "f_dc_0";
  const isLogOpacity = opIdx >= 0 && properties[opIdx].name === "opacity";

  const positions = new Float32Array(count * 3);
  const scales = new Float32Array(count * 3);
  const rotations = new Float32Array(count * 4);
  const colors = new Float32Array(count * 3);
  const opacities = new Float32Array(count);

  if (isBinary) {
    const data = new DataView(buffer, headerEnd);

    // Bounds check to prevent buffer overread
    const dataViewSize = buffer.byteLength - headerEnd;
    if (count * byteSizePerVertex > dataViewSize) {
      throw new Error(`PLY data truncated: expected ${count * byteSizePerVertex} bytes, got ${dataViewSize}`);
    }

    for (let i = 0; i < count; i++) {
      const baseOffset = i * byteSizePerVertex;
      let propOffset = 0;

      const values: Record<string, number> = {};

      for (const prop of properties) {
        let value: number;
        switch (prop.type) {
          case "float": case "float32":
            value = data.getFloat32(baseOffset + propOffset, true);
            propOffset += 4;
            break;
          case "uchar": case "uint8":
            value = data.getUint8(baseOffset + propOffset);
            propOffset += 1;
            break;
          case "short": case "int16":
            value = data.getInt16(baseOffset + propOffset, true);
            propOffset += 2;
            break;
          default:
            value = data.getFloat32(baseOffset + propOffset, true);
            propOffset += 4;
        }
        values[prop.name] = value;
      }

      // Position
      if (xIdx >= 0) positions[i * 3]     = values[properties[xIdx].name];
      if (yIdx >= 0) positions[i * 3 + 1] = values[properties[yIdx].name];
      if (zIdx >= 0) positions[i * 3 + 2] = values[properties[zIdx].name];

      // Scale (log scale in PLY)
      if (sxIdx >= 0) scales[i * 3]     = values[properties[sxIdx].name];
      if (syIdx >= 0) scales[i * 3 + 1] = values[properties[syIdx].name];
      if (szIdx >= 0) scales[i * 3 + 2] = values[properties[szIdx].name];

      // Rotation (quaternion)
      if (rwIdx >= 0) rotations[i * 4]     = values[properties[rwIdx].name];
      if (rxIdx >= 0) rotations[i * 4 + 1] = values[properties[rxIdx].name];
      if (ryIdx >= 0) rotations[i * 4 + 2] = values[properties[ryIdx].name];
      if (rzIdx >= 0) rotations[i * 4 + 3] = values[properties[rzIdx].name];

      // Color from SH DC coefficients or direct
      if (rColIdx >= 0) {
        let r = values[properties[rColIdx].name];
        let g = values[properties[gColIdx >= 0 ? gColIdx : rColIdx].name];
        let b = values[properties[bColIdx >= 0 ? bColIdx : rColIdx].name];
        // SH DC to color: C = 0.5 + SH_C * sh2rgb
        const SH_C = 0.28209479177387814;
        if (isSHColor) {
          r = Math.max(0, Math.min(1, 0.5 + r * SH_C));
          g = Math.max(0, Math.min(1, 0.5 + g * SH_C));
          b = Math.max(0, Math.min(1, 0.5 + b * SH_C));
        } else {
          r = r / 255;
          g = g / 255;
          b = b / 255;
        }
        colors[i * 3]     = r;
        colors[i * 3 + 1] = g;
        colors[i * 3 + 2] = b;
      }

      // Opacity
      if (opIdx >= 0) {
        let op = values[properties[opIdx].name];
        // PLY stores log opacity, apply sigmoid
        if (isLogOpacity) {
          op = 1 / (1 + Math.exp(-op));
        } else {
          op = op / 255;
        }
        opacities[i] = op;
      } else {
        opacities[i] = 1.0;
      }
    }
  }
  
  return { positions, scales, rotations, colors, opacities, count };
}

function findPlyHeaderEnd(buffer: ArrayBuffer): number {
  const decoder = new TextDecoder();
  const bytes = new Uint8Array(buffer);
  const endMarker = [101, 110, 100, 95, 104, 101, 97, 100, 101, 114]; // "end_header"
  
  for (let i = 0; i < Math.min(buffer.byteLength, 10000); i++) {
    let match = true;
    for (let j = 0; j < endMarker.length; j++) {
      if (bytes[i + j] !== endMarker[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      // Find the newline after "end_header"
      let end = i + endMarker.length;
      while (end < buffer.byteLength && bytes[end] !== 10) end++;
      return end + 1; // skip the newline
    }
  }
  throw new Error("Invalid PLY file: 'end_header' marker not found within first 10000 bytes");
}

/**
 * Load a Gaussian Splat scene from a URL
 * Supports .splat (binary), .ply (binary_little_endian), and .json formats
 */
export async function loadScene(modelUrl: string, signal?: AbortSignal): Promise<SplatData> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);
  const effectiveSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;

  try {
    const response = await fetch(modelUrl, { signal: effectiveSignal });
    if (!response.ok) {
      throw new Error(`Failed to load scene: ${response.status} ${response.statusText}`);
    }
  
  const url = modelUrl.toLowerCase();
  
  if (url.endsWith(".ply") || url.includes(".ply?")) {
    const buffer = await response.arrayBuffer();
    return parsePlyFile(buffer);
  }
  
  if (url.endsWith(".splat") || url.includes(".splat?")) {
    const buffer = await response.arrayBuffer();
    return parseBinarySplat(buffer);
  }
  
  // Default: try binary .splat format
  const buffer = await response.arrayBuffer();
  return parseBinarySplat(buffer);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Load scene with progressive loading callback
 */
export async function loadSceneProgressive(
  modelUrl: string,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<SplatData> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);
  const effectiveSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;

  try {
    const response = await fetch(modelUrl, { signal: effectiveSignal });
    if (!response.ok) {
      throw new Error(`Failed to load scene: ${response.status} ${response.statusText}`);
    }

    if (effectiveSignal.aborted) throw new DOMException("Aborted", "AbortError");

    const contentLength = parseInt(response.headers.get("content-length") || "0");

    if (!response.body || !contentLength) {
      // No streaming support — use the already-fetched response instead of re-fetching
      onProgress?.(1, 1);
      const buffer = await response.arrayBuffer();
      const url = modelUrl.toLowerCase();
      if (url.endsWith(".ply") || url.includes(".ply?")) {
        return parsePlyFile(buffer);
      }
      return parseBinarySplat(buffer);
    }
  
  // Stream the response
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loadedBytes += value.length;
    onProgress?.(loadedBytes, contentLength);
  }
  
  // Combine chunks
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const buffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }

  if (effectiveSignal.aborted) throw new DOMException("Aborted", "AbortError");

  const url = modelUrl.toLowerCase();
  if (url.endsWith(".ply") || url.includes(".ply?")) {
    return parsePlyFile(buffer.buffer);
  }

  return parseBinarySplat(buffer.buffer);
  } finally {
    clearTimeout(timeoutId);
  }
}


