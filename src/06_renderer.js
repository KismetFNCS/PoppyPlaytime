// =====================================================================================
// RENDERER (WebGL2 deferred pipeline). Consumes RenderQueue + level batches; never
// mutates simulation state.
//   1 shadow (flashlight spot, depth texture w/ hardware compare)
//   2 G-buffer MRT: albedo(sqrt)+rough | normal+metal | emissive/8
//   3 SSAO (hemisphere, world-space reconstruction) + 4x4 blur
//   4 light accumulation: ambient + flashlight GGX + height fog + volumetric cone march
//   5 point lights: one scissored fullscreen draw per light, GGX + analytic in-scatter
//   6 forward: particles, halos (depth-tested against the G-buffer depth)
//   7 bloom (bright pass, separable gaussian)  8 composite: ACES, CA, VHS, vignette, grain
// =====================================================================================

const SHADER_COMMON = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
precision highp sampler2DShadow;
`;

const VS_GBUF = SHADER_COMMON + `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
layout(location=2) in float aMat;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform float uMatOverride;
uniform int uObjSpace;
out vec3 vWorld;
out vec3 vTexPos;
out vec3 vObjNormal;
flat out int vMat;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vec3 sc = vec3(length(uModel[0].xyz), length(uModel[1].xyz), length(uModel[2].xyz));
  vTexPos = uObjSpace == 1 ? aPos * sc : w.xyz;
  vObjNormal = aNor;
  vMat = aMat < -0.5 ? int(uMatOverride + 0.5) : int(aMat + 0.5);
  gl_Position = uViewProj * w;
}`;

const FS_GBUF = SHADER_COMMON + `
uniform sampler2DArray uAlbedoTex;
uniform sampler2DArray uNormalTex;
uniform vec4 uMatA[24];
uniform vec4 uMatB[24];
uniform vec3 uMatE[24];
uniform mat3 uNormalMat;
uniform vec4 uTint;
uniform vec3 uEmisAdd;
uniform vec4 uFracture;   // xyz = center, w = radius
uniform float uFractureAmt;
uniform float uTime;
in vec3 vWorld;
in vec3 vTexPos;
in vec3 vObjNormal;
flat in int vMat;
layout(location=0) out vec4 oAlbedo;
layout(location=1) out vec4 oNormal;
layout(location=2) out vec4 oEmis;
void main() {
  int m = vMat;
  vec4 A = uMatA[m];
  vec4 B = uMatB[m];
  vec3 n = normalize(vObjNormal);
  vec3 bw = pow(abs(n), vec3(4.0));
  bw /= (bw.x + bw.y + bw.z + 1e-5);
  vec3 p = vTexPos * B.y;
  float L = float(m);
  vec2 uvX = p.zy, uvY = p.xz, uvZ = p.xy;
  vec4 ax = texture(uAlbedoTex, vec3(uvX, L));
  vec4 ay = texture(uAlbedoTex, vec3(uvY, L));
  vec4 az = texture(uAlbedoTex, vec3(uvZ, L));
  vec4 alb = ax * bw.x + ay * bw.y + az * bw.z;
  vec4 nx = texture(uNormalTex, vec3(uvX, L));
  vec4 ny = texture(uNormalTex, vec3(uvY, L));
  vec4 nz = texture(uNormalTex, vec3(uvZ, L));
  vec3 tnx = nx.xyz * 2.0 - 1.0, tny = ny.xyz * 2.0 - 1.0, tnz = nz.xyz * 2.0 - 1.0;
  // detail layer: the same material at 4.37x frequency adds fine grain to albedo and normals
  const float DF = 4.37;
  vec3 dax = texture(uAlbedoTex, vec3(uvX * DF, L)).rgb, day = texture(uAlbedoTex, vec3(uvY * DF, L)).rgb, daz = texture(uAlbedoTex, vec3(uvZ * DF, L)).rgb;
  float dl = dot(dax * bw.x + day * bw.y + daz * bw.z, vec3(0.3333));
  alb.rgb *= mix(1.0, 0.55 + 0.9 * dl, 0.4);
  tnx.xy += (texture(uNormalTex, vec3(uvX * DF, L)).xy * 2.0 - 1.0) * 0.6;
  tny.xy += (texture(uNormalTex, vec3(uvY * DF, L)).xy * 2.0 - 1.0) * 0.6;
  tnz.xy += (texture(uNormalTex, vec3(uvZ * DF, L)).xy * 2.0 - 1.0) * 0.6;
  // whiteout triplanar normal blend
  tnx = vec3(tnx.xy + n.zy, abs(tnx.z) * n.x);
  tny = vec3(tny.xy + n.xz, abs(tny.z) * n.y);
  tnz = vec3(tnz.xy + n.xy, abs(tnz.z) * n.z);
  vec3 pn = normalize(tnx.zyx * bw.x + tny.xzy * bw.y + tnz.xyz * bw.z);
  float roughMul = (nx.a * bw.x + ny.a * bw.y + nz.a * bw.z) * 2.0;
  vec3 albedo = A.rgb * alb.rgb * uTint.rgb;
  float rough = clamp(A.a * roughMul, 0.05, 1.0);
  float metal = B.x;
  vec3 emis = uEmisAdd + albedo * uTint.a;
  if (B.w > 0.5 && B.w < 1.5) {
    // concrete fracture: crack distance field widens near an impact point
    float local = uFracture.w > 0.0 ? 1.0 - smoothstep(uFracture.w * 0.4, uFracture.w, distance(vWorld, uFracture.xyz)) : 0.0;
    float width = 0.035 + 0.22 * clamp(uFractureAmt * local, 0.0, 1.0);
    float crack = 1.0 - smoothstep(width * 0.55, width, alb.a);
    albedo *= mix(1.0, 0.12, crack);
    rough = mix(rough, 1.0, crack);
    pn = normalize(pn - n * crack * 0.6 + vec3(alb.a - 0.5) * crack);
  } else if (B.w > 1.5) {
    float pulse = B.w > 2.5 ? 1.0 : 0.82 + 0.18 * sin(uTime * 2.4 + vWorld.x * 0.7);
    emis += uMatE[m] * B.z * alb.a * pulse;
  }
  vec3 wn = normalize(uNormalMat * pn);
  oAlbedo = vec4(sqrt(clamp(albedo, 0.0, 1.0)), rough);
  oNormal = vec4(wn * 0.5 + 0.5, metal);
  oEmis = vec4(min(emis * 0.125, vec3(1.0)), 1.0);
}`;

// Imported glTF meshes: UV-mapped base color (sRGB texture) + PBR factors into the same G-buffer.
const VS_GBUF_TEX = SHADER_COMMON + `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
layout(location=2) in vec2 aUv;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat3 uNormalMat;
out vec3 vNormal;
out vec2 vUv;
void main() {
  vNormal = uNormalMat * aNor;
  vUv = aUv;
  gl_Position = uViewProj * uModel * vec4(aPos, 1.0);
}`;
const FS_GBUF_TEX = SHADER_COMMON + `
uniform sampler2D uBaseTex;
uniform int uHasTex;
uniform vec4 uBaseColor;
uniform vec2 uRoughMetal;
uniform vec3 uEmissive;
uniform float uCutoff;
uniform float uTexEmissive;
uniform vec4 uTint;
uniform vec3 uEmisAdd;
in vec3 vNormal;
in vec2 vUv;
layout(location=0) out vec4 oAlbedo;
layout(location=1) out vec4 oNormal;
layout(location=2) out vec4 oEmis;
void main() {
  vec4 c = uBaseColor;
  if (uHasTex == 1) c *= texture(uBaseTex, vUv);
  if (c.a < uCutoff) discard;
  vec3 n = normalize(gl_FrontFacing ? vNormal : -vNormal);
  vec3 albedo = c.rgb * uTint.rgb;
  vec3 emis = uEmissive + uEmisAdd + albedo * uTint.a + c.rgb * uTexEmissive;
  oAlbedo = vec4(sqrt(clamp(albedo, 0.0, 1.0)), clamp(uRoughMetal.x, 0.05, 1.0));
  oNormal = vec4(n * 0.5 + 0.5, clamp(uRoughMetal.y, 0.0, 1.0));
  oEmis = vec4(min(emis * 0.125, vec3(1.0)), 1.0);
}`;

const VS_SHADOW = SHADER_COMMON + `
layout(location=0) in vec3 aPos;
uniform mat4 uViewProj;
uniform mat4 uModel;
void main() { gl_Position = uViewProj * uModel * vec4(aPos, 1.0); }`;
const FS_SHADOW = SHADER_COMMON + `
void main() {}`;

const VS_FULL = SHADER_COMMON + `
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const GLSL_DECODE = `
uniform sampler2D uGAlbedo;
uniform sampler2D uGNormal;
uniform sampler2D uGEmis;
uniform sampler2D uDepth;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
vec3 worldFromDepth(vec2 uv, float d) {
  vec4 c = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 w = uInvViewProj * c;
  return w.xyz / w.w;
}
vec3 brdf(vec3 N, vec3 V, vec3 L, vec3 albedo, float rough, float metal) {
  vec3 H = normalize(V + L);
  float NdL = max(dot(N, L), 0.0), NdV = max(dot(N, V), 1e-3), NdH = max(dot(N, H), 0.0), VdH = max(dot(V, H), 0.0);
  float a = rough * rough, a2 = a * a;
  float dn = NdH * NdH * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159265 * dn * dn);
  float k = (rough + 1.0) * (rough + 1.0) / 8.0;
  float G = (NdL / (NdL * (1.0 - k) + k)) * (NdV / (NdV * (1.0 - k) + k));
  vec3 F0 = mix(vec3(0.04), albedo, metal);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - VdH, 5.0);
  vec3 spec = D * G * F / (4.0 * NdL * NdV + 1e-4);
  vec3 kd = (1.0 - F) * (1.0 - metal);
  return (kd * albedo + spec * 3.14159265) * NdL;
}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

const FS_SSAO = SHADER_COMMON + GLSL_DECODE + `
uniform mat4 uViewProj;
uniform int uSamples;
uniform float uRadius;
uniform vec2 uNearFar;
in vec2 vUv;
out vec4 oAO;
float linDepth(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - z * (uNearFar.y - uNearFar.x)); }
vec3 hash3(float n) { return fract(sin(vec3(n, n + 1.7, n + 3.1)) * vec3(43758.5453, 22578.1459, 19642.3490)); }
void main() {
  float d = texture(uDepth, vUv).r;
  if (d >= 1.0) { oAO = vec4(1.0); return; }
  vec3 P = worldFromDepth(vUv, d);
  vec3 N = normalize(texture(uGNormal, vUv).xyz * 2.0 - 1.0);
  float rot = ign(gl_FragCoord.xy) * 6.2831853;
  vec3 T = normalize(abs(N.y) < 0.99 ? cross(N, vec3(0, 1, 0)) : cross(N, vec3(1, 0, 0)));
  vec3 Bt = cross(N, T);
  float occ = 0.0;
  for (int i = 0; i < 16; i++) {
    if (i >= uSamples) break;
    vec3 h = hash3(float(i) * 7.13);
    float a = h.x * 6.2831853 + rot;
    float r = sqrt(h.y);
    vec3 dir = T * cos(a) * r + Bt * sin(a) * r + N * sqrt(max(0.0, 1.0 - r * r));
    float scale = mix(0.15, 1.0, float(i) / float(uSamples));
    vec3 S = P + dir * uRadius * scale;
    vec4 c = uViewProj * vec4(S, 1.0);
    if (c.w <= 0.0) continue;
    vec2 suv = c.xy / c.w * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0) continue;
    float sceneZ = linDepth(texture(uDepth, suv).r);
    float sampleZ = c.w;
    float rangeOk = smoothstep(0.0, 1.0, uRadius / max(abs(sampleZ - sceneZ), 1e-3));
    occ += (sceneZ < sampleZ - 0.03 ? 1.0 : 0.0) * rangeOk;
  }
  float ao = 1.0 - occ / float(max(uSamples, 1));
  oAO = vec4(pow(clamp(ao, 0.0, 1.0), 1.6), 0.0, 0.0, 1.0);
}`;

const FS_BLUR4 = SHADER_COMMON + `
uniform sampler2D uSrc;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 oColor;
void main() {
  float s = 0.0;
  for (int y = -2; y < 2; y++) for (int x = -2; x < 2; x++) s += texture(uSrc, vUv + (vec2(x, y) + 0.5) * uTexel).r;
  oColor = vec4(s / 16.0, 0.0, 0.0, 1.0);
}`;

const FS_AMBIENT = SHADER_COMMON + GLSL_DECODE + `
uniform sampler2D uAO;
uniform sampler2DShadow uShadow;
uniform mat4 uShadowMat;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform vec3 uFogColor;
uniform vec2 uFog;            // density, height falloff
uniform vec3 uFlashPos;
uniform vec3 uFlashDir;
uniform vec3 uFlashColor;     // color * intensity (0 when off)
uniform vec3 uFlashCone;      // cos outer, cos inner, range
uniform int uVolSteps;
uniform int uPcf;
uniform float uShadowTexel;
uniform float uHdrEncode;
uniform float uTime;
in vec2 vUv;
out vec4 oColor;
float shadowAt(vec3 P, int taps) {
  vec4 s = uShadowMat * vec4(P, 1.0);
  if (s.w <= 0.0) return 1.0;
  vec3 c = s.xyz / s.w * 0.5 + 0.5;
  if (c.x < 0.0 || c.y < 0.0 || c.x > 1.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
  c.z -= 0.0015;
  if (taps <= 1) return texture(uShadow, c);
  float sum = 0.0, wsum = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    sum += texture(uShadow, vec3(c.xy + vec2(x, y) * uShadowTexel * float(taps - 1), c.z));
    wsum += 1.0;
  }
  return sum / wsum;
}
float spotFactor(vec3 P, out vec3 L, out float atten) {
  vec3 Lv = uFlashPos - P;
  float d = length(Lv);
  L = Lv / max(d, 1e-4);
  float cone = smoothstep(uFlashCone.x, uFlashCone.y, dot(-L, uFlashDir));
  float win = clamp(1.0 - pow(d / uFlashCone.z, 4.0), 0.0, 1.0);
  atten = win * win / (d * d + 1.0);
  return cone;
}
float fogTransmit(vec3 P, float dist) {
  // exponential height fog: density decays with altitude above y = 0
  float h0 = uCamPos.y, h1 = P.y;
  float k = uFog.y;
  float dh = h1 - h0;
  float avg = abs(dh) > 1e-3 ? (exp(-k * h0) - exp(-k * h1)) / (k * dh) : exp(-k * h0);
  return exp(-uFog.x * dist * avg * 1.6);
}
void main() {
  float d = texture(uDepth, vUv).r;
  vec3 P = worldFromDepth(vUv, d);
  vec3 ray = P - uCamPos;
  float dist = length(ray);
  vec3 rd = ray / max(dist, 1e-4);
  vec3 color = vec3(0.0);
  float marchLen = min(dist, 30.0);
  if (d < 1.0) {
    vec4 ga = texture(uGAlbedo, vUv);
    vec4 gn = texture(uGNormal, vUv);
    vec3 albedo = ga.rgb * ga.rgb;
    float rough = ga.a;
    float metal = gn.a;
    vec3 N = normalize(gn.xyz * 2.0 - 1.0);
    vec3 V = -rd;
    float ao = texture(uAO, vUv).r;
    float hemi = N.y * 0.5 + 0.5;
    vec3 amb = mix(uAmbGround, uAmbSky, hemi) * ao;
    vec3 F0 = mix(vec3(0.04), albedo, metal);
    color = amb * albedo * (1.0 - metal) + amb * F0 * (1.0 - rough * 0.7);
    vec3 L; float atten;
    float cone = spotFactor(P, L, atten);
    if (cone > 0.0 && atten > 0.0) {
      float sh = shadowAt(P + N * 0.02, uPcf);
      color += brdf(N, V, L, albedo, rough, metal) * uFlashColor * cone * atten * sh;
    }
    color += texture(uGEmis, vUv).rgb * 8.0;
    float T = fogTransmit(P, dist);
    color = color * T + uFogColor * (1.0 - T);
  } else {
    color = uFogColor;
  }
  // volumetric flashlight cone (ray march through the shadow map)
  if (uVolSteps > 0 && dot(uFlashColor, uFlashColor) > 0.0) {
    float stepLen = marchLen / float(uVolSteps);
    float t = stepLen * ign(gl_FragCoord.xy + fract(uTime) * 61.0);
    vec3 scat = vec3(0.0);
    for (int i = 0; i < 32; i++) {
      if (i >= uVolSteps) break;
      vec3 S = uCamPos + rd * t;
      vec3 L; float atten;
      float cone = spotFactor(S, L, atten);
      if (cone > 0.0) scat += cone * atten * shadowAt(S, 1) * exp(-uFog.x * t);
      t += stepLen;
    }
    color += uFlashColor * scat * stepLen * uFog.x * 0.06;
  }
  oColor = vec4(color * uHdrEncode, 1.0);
}`;

const FS_POINT = SHADER_COMMON + GLSL_DECODE + `
uniform vec3 uLightPos;
uniform vec3 uLightColor;   // color * intensity
uniform float uLightRadius;
uniform vec2 uFog;
uniform float uScatter;
uniform float uHdrEncode;
in vec2 vUv;
out vec4 oColor;
void main() {
  float d = texture(uDepth, vUv).r;
  vec3 P = worldFromDepth(vUv, d);
  vec3 ray = P - uCamPos;
  float dist = d < 1.0 ? length(ray) : 45.0;
  vec3 rd = normalize(ray);
  vec3 color = vec3(0.0);
  if (d < 1.0) {
    vec3 Lv = uLightPos - P;
    float ld = length(Lv);
    if (ld < uLightRadius) {
      vec4 ga = texture(uGAlbedo, vUv);
      vec4 gn = texture(uGNormal, vUv);
      vec3 albedo = ga.rgb * ga.rgb;
      vec3 N = normalize(gn.xyz * 2.0 - 1.0);
      vec3 L = Lv / ld;
      float win = clamp(1.0 - pow(ld / uLightRadius, 4.0), 0.0, 1.0);
      float atten = win * win / (ld * ld + 1.0);
      color = brdf(N, -rd, L, albedo, ga.a, gn.a) * uLightColor * atten;
      color *= exp(-uFog.x * dist);
    }
  }
  // analytic in-scattering of an inverse-square point light along the view ray
  vec3 oc = uLightPos - uCamPos;
  float t0 = dot(oc, rd);
  float h = max(length(oc - rd * t0), 0.08);
  float integ = (atan((dist - t0) / h) - atan(-t0 / h)) / h;
  float fade = 1.0 - smoothstep(uLightRadius * 0.45, uLightRadius * 0.95, h);
  color += uLightColor * integ * uFog.x * uScatter * fade * exp(-uFog.x * max(t0, 0.0));
  oColor = vec4(color * uHdrEncode, 1.0);
}`;

const VS_PARTICLE = SHADER_COMMON + `
layout(location=0) in vec3 aCenter;
layout(location=1) in vec3 aCorner;   // xy corner, z rotation
layout(location=2) in vec4 aColor;    // rgb * intensity, a alpha
layout(location=3) in float aSize;
uniform mat4 uViewProj;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamPos;
out vec4 vColor;
out vec2 vCorner;
out float vDist;
void main() {
  float c = cos(aCorner.z), s = sin(aCorner.z);
  vec2 k = vec2(aCorner.x * c - aCorner.y * s, aCorner.x * s + aCorner.y * c);
  vec3 w = aCenter + (uCamRight * k.x + uCamUp * k.y) * aSize;
  vColor = aColor;
  vCorner = aCorner.xy;
  vDist = distance(w, uCamPos);
  gl_Position = uViewProj * vec4(w, 1.0);
}`;
const FS_PARTICLE = SHADER_COMMON + `
uniform vec2 uFog;
uniform float uHdrEncode;
uniform sampler2D uDepth;
uniform vec2 uNearFar;
in vec4 vColor;
in vec2 vCorner;
in float vDist;
out vec4 oColor;
float linDepth(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - z * (uNearFar.y - uNearFar.x)); }
void main() {
  // manual depth test against the G-buffer + soft fade near intersecting geometry
  float scene = linDepth(texelFetch(uDepth, ivec2(gl_FragCoord.xy), 0).r);
  float self = linDepth(gl_FragCoord.z);
  float soft = clamp((scene - self) / 0.35, 0.0, 1.0);
  if (soft <= 0.0) discard;
  float r = length(vCorner);
  float a = smoothstep(1.0, 0.0, r) * soft;
  a *= a;
  float T = exp(-uFog.x * vDist);
  float al = abs(vColor.a);
  // negative alpha marks additive sprites: they add light without occluding
  oColor = vec4(vColor.rgb * a * al * T * uHdrEncode, vColor.a < 0.0 ? 0.0 : a * al);
}`;

const FS_BRIGHT = SHADER_COMMON + `
uniform sampler2D uSrc;
uniform float uThreshold;
uniform float uHdrDecode;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 oColor;
void main() {
  vec3 c = vec3(0.0);
  c += texture(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture(uSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture(uSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture(uSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c *= 0.25 * uHdrDecode;
  float l = max(c.r, max(c.g, c.b));
  float k = max(l - uThreshold, 0.0) / max(l, 1e-4);
  oColor = vec4(c * k / uHdrDecode, 1.0);
}`;

const FS_GAUSS = SHADER_COMMON + `
uniform sampler2D uSrc;
uniform vec2 uDir;
in vec2 vUv;
out vec4 oColor;
void main() {
  vec3 c = texture(uSrc, vUv).rgb * 0.227027;
  c += texture(uSrc, vUv + uDir * 1.3846153).rgb * 0.3162162;
  c += texture(uSrc, vUv - uDir * 1.3846153).rgb * 0.3162162;
  c += texture(uSrc, vUv + uDir * 3.2307692).rgb * 0.0702703;
  c += texture(uSrc, vUv - uDir * 3.2307692).rgb * 0.0702703;
  oColor = vec4(c, 1.0);
}`;

const FS_COMPOSITE = SHADER_COMMON + `
uniform sampler2D uHdr;
uniform sampler2D uBloom;
uniform float uHdrDecode;
uniform float uBloomStrength;
uniform float uExposure;
uniform float uTime;
uniform float uVhs;
uniform float uCA;
uniform float uFear;
uniform float uRedWave;
uniform float uVignette;
uniform float uFade;
uniform float uGrain;
uniform float uFlash;
uniform float uSlats;
uniform vec3 uFlashTint;
uniform vec2 uRes;
in vec2 vUv;
out vec4 oColor;
float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 sampleHdr(vec2 uv) { return (texture(uHdr, uv).rgb + texture(uBloom, uv).rgb * uBloomStrength) * uHdrDecode; }
void main() {
  vec2 uv = vUv;
  // VHS tracking: per-line jitter, a rolling distortion band and head-switching noise at the bottom
  float line = floor(uv.y * 240.0);
  float jitter = (hash(line + floor(uTime * 30.0) * 13.0) - 0.5) * 0.0025 * uVhs;
  float bandY = fract(uTime * 0.07);
  float band = exp(-pow((uv.y - bandY) * 38.0, 2.0)) * uVhs;
  float headSwitch = smoothstep(0.035, 0.0, uv.y) * uVhs;
  uv.x += jitter + band * 0.012 * sin(uv.y * 400.0 + uTime * 20.0) + headSwitch * (hash(line + uTime) - 0.5) * 0.06;
  // jumpscare shock wave: radial refraction ring travelling outward
  vec2 dc = uv - 0.5;
  float r = length(dc);
  float wave = uRedWave * sin(r * 34.0 - uTime * 26.0) * exp(-r * 2.0);
  uv += normalize(dc + 1e-5) * wave * 0.018;
  // radial chromatic aberration responsive to fear
  float ca = uCA + uFear * 0.0065 + uRedWave * 0.03;
  vec3 col;
  col.r = sampleHdr(uv + dc * ca).r;
  col.g = sampleHdr(uv).g;
  col.b = sampleHdr(uv - dc * ca).b;
  // VHS chroma bleed: horizontally smeared color difference
  vec3 smear = (sampleHdr(uv + vec2(0.004, 0.0)) + sampleHdr(uv + vec2(0.008, 0.0))) * 0.5;
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  float smearLuma = dot(smear, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(luma) + (smear - vec3(smearLuma)), 0.45 * uVhs);
  col *= uExposure;
  col = aces(col);
  // red jumpscare grade
  col = mix(col, col * vec3(1.6, 0.35, 0.3) + vec3(0.08, 0.0, 0.0), clamp(uRedWave, 0.0, 1.0) * 0.85);
  // scanlines and tape noise
  float scan = 1.0 - uVhs * 0.16 * (0.5 + 0.5 * cos(vUv.y * uRes.y * 3.14159265));
  col *= scan;
  float tapeNoise = hash2(vec2(floor(vUv.x * 320.0), line) + floor(uTime * 24.0)) - 0.5;
  col += tapeNoise * (0.01 * uVhs + band * 0.08);
  col += (hash2(vUv * uRes + fract(uTime) * 91.0) - 0.5) * uGrain;
  col += headSwitch * 0.25 * (hash(line * 3.1 + uTime) - 0.3);
  // vignette
  float vig = 1.0 - uVignette * smoothstep(0.25, 0.95, r * 1.45) - uFear * 0.25 * smoothstep(0.15, 0.8, r);
  col *= clamp(vig, 0.0, 1.0);
  // locker view: looking out through the door slats
  if (uSlats > 0.0) {
    float bar = smoothstep(0.42, 0.5, fract(vUv.y * 9.0 + 0.25)) * smoothstep(0.98, 0.9, fract(vUv.y * 9.0 + 0.25));
    float edge = smoothstep(0.18, 0.62, length((vUv - 0.5) * vec2(1.6, 1.0)));
    col *= mix(1.0, 0.04, uSlats * max(1.0 - bar, edge));
  }
  col = mix(col, uFlashTint, uFlash);
  col *= 1.0 - uFade;
  oColor = vec4(pow(max(col, vec3(0.0)), vec3(1.0 / 2.2)), 1.0);
}`;

// ------------------------------------------------------------------------------------
const Renderer = {
  gl: null, canvas: null, ok: false, lost: false,
  progs: {}, loc: {}, meshes: {}, targets: null, hdrFloat: false,
  width: 0, height: 0, rw: 0, rh: 0, quality: QUALITY.HIGH, qualityName: 'HIGH',
  albedoArray: null, normalArray: null, albedoData: null, normalData: null,
  white: null, shadowTex: null, shadowFbo: null, shadowSize: 0,
  view: M4.create(), proj: M4.create(), viewProj: M4.create(), invViewProj: M4.create(),
  shadowView: M4.create(), shadowProj: M4.create(), shadowVP: M4.create(),
  camPos: V3.create(), camRight: V3.create(), camUp: V3.create(), camFwd: V3.create(),
  fovDeg: 95, frustum: new Float32Array(24),
  normalMat: new Float32Array(9), identity: M4.create(), identity3: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
  stats: { draws: 0, lights: 0, tris: 0, assetDraws: 0 },
  post: { slats: 0, fear: 0, redWave: 0, fade: 0, flash: 0, flashTint: new Float32Array([1, 0.1, 0.05]), calibrate: false, vhsBoost: 0 },
  fogUpload: new Float32Array(3), ambSkyUpload: new Float32Array(3), ambGroundUpload: new Float32Array(3),
  flashColorUpload: new Float32Array(3), flashOn: true,
  particleData: null, particleCount: 0, particleVbo: null, particleVao: null,
  cableVbo: null, cableIbo: null, cableVao: null,

  init(canvas) {
    this.canvas = canvas;
    const opts = { antialias: false, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false };
    const gl = canvas.getContext('webgl2', opts);
    if (!gl) {
      const legacy = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
      throw new Error(legacy ? 'This browser only exposes WebGL1. The deferred pipeline (MRT G-buffer, depth textures, texture arrays) needs WebGL2 - please update the browser or enable hardware acceleration.'
        : 'WebGL is unavailable. Enable hardware acceleration in the browser settings and reload.');
    }
    this.gl = gl;
    this.hdrFloat = !!gl.getExtension('EXT_color_buffer_float');
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; this.ok = false; }, false);
    canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.rebuild(); }, false);
    this.createResources();
  },

  createResources() {
    const gl = this.gl;
    this.progs.gbuf = this.program(VS_GBUF, FS_GBUF, 'gbuf');
    this.progs.gbufTex = this.program(VS_GBUF_TEX, FS_GBUF_TEX, 'gbufTex');
    this.progs.shadow = this.program(VS_SHADOW, FS_SHADOW, 'shadow');
    this.progs.ssao = this.program(VS_FULL, FS_SSAO, 'ssao');
    this.progs.blur4 = this.program(VS_FULL, FS_BLUR4, 'blur4');
    this.progs.ambient = this.program(VS_FULL, FS_AMBIENT, 'ambient');
    this.progs.point = this.program(VS_FULL, FS_POINT, 'point');
    this.progs.particle = this.program(VS_PARTICLE, FS_PARTICLE, 'particle');
    this.progs.bright = this.program(VS_FULL, FS_BRIGHT, 'bright');
    this.progs.gauss = this.program(VS_FULL, FS_GAUSS, 'gauss');
    this.progs.composite = this.program(VS_FULL, FS_COMPOSITE, 'composite');
    this.emptyVao = gl.createVertexArray();
    this.white = this.makeTex(1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]), gl.NEAREST);
    for (const k in PRIM) this.meshes[k] = this.uploadMesh(PRIM[k]);
    // particle stream: 6 vertices per particle, 11 floats per vertex
    this.particleData = new Float32Array(PARTICLE_MAX * 6 * 11);
    this.particleVao = gl.createVertexArray();
    gl.bindVertexArray(this.particleVao);
    this.particleVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.particleData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 44, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 44, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 44, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 44, 40);
    // cable tube stream
    this.cableVao = gl.createVertexArray();
    gl.bindVertexArray(this.cableVao);
    this.cableVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cableVbo);
    gl.bufferData(gl.ARRAY_BUFFER, CableMesh.vertexData.byteLength, gl.DYNAMIC_DRAW);
    this.bindStdAttribs();
    this.cableIbo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.cableIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, CableMesh.indexData, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    if (this.albedoData) this.uploadMaterialArrays();
    if (Level.batches.length) Level.uploadBatches();
    if (typeof Assets !== 'undefined') Assets.reupload();
    if (typeof Cast !== 'undefined' && Cast.screen) Cast.reupload();
    this.uploadMaterialUniforms();
    this.allocTargets();
    this.ok = true;
  },

  rebuild() {
    this.progs = {}; this.loc = {}; this.meshes = {}; this.targets = null; this.shadowSize = 0;
    try { this.createResources(); } catch (err) { fatal(err); }
  },

  bindStdAttribs() {
    const gl = this.gl;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
  },

  program(vsSrc, fsSrc, name) {
    const gl = this.gl;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        throw new Error('Shader compile failed (' + name + '): ' + gl.getShaderInfoLog(s));
      }
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('Program link failed (' + name + '): ' + gl.getProgramInfoLog(p));
    // cache every active uniform location once
    const locs = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const nm = info.name.replace(/\[0\]$/, '');
      locs[nm] = gl.getUniformLocation(p, info.name);
    }
    this.loc[name] = locs;
    return p;
  },
  u(prog, name) {
    const l = this.loc[prog][name];
    return l === undefined ? null : l;
  },

  makeTex(w, h, internal, format, type, data, filter) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data || null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter || gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter || gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  },
  makeFbo(colors, depth) {
    const gl = this.gl;
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    const bufs = [];
    for (let i = 0; i < colors.length; i++) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, colors[i], 0);
      bufs.push(gl.COLOR_ATTACHMENT0 + i);
    }
    if (depth) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
    gl.drawBuffers(bufs.length ? bufs : [gl.NONE]);
    if (!colors.length) gl.readBuffer(gl.NONE);
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE && !gl.isContextLost()) throw new Error('Framebuffer incomplete: 0x' + st.toString(16));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return f;
  },

  setQuality(name) {
    if (!QUALITY[name]) return;
    this.quality = QUALITY[name];
    this.qualityName = name;
    if (this.gl) this.allocTargets();
  },

  resize(cssW, cssH, dpr) {
    const w = Math.max(1, Math.floor(cssW * dpr)), h = Math.max(1, Math.floor(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.width = w; this.height = h;
    if (this.gl) this.allocTargets();
  },

  allocTargets() {
    const gl = this.gl;
    if (!gl || !this.width) return;
    const q = this.quality;
    const rw = Math.max(16, Math.floor(this.width * q.scale)), rh = Math.max(16, Math.floor(this.height * q.scale));
    if (this.targets && this.rw === rw && this.rh === rh && this.shadowSize === q.shadow) return;
    if (this.targets) for (const k in this.targets.tex) gl.deleteTexture(this.targets.tex[k]);
    if (this.targets) for (const k in this.targets.fbo) gl.deleteFramebuffer(this.targets.fbo[k]);
    this.rw = rw; this.rh = rh;
    const hdrInternal = this.hdrFloat ? gl.RGBA16F : gl.RGBA8;
    const hdrType = this.hdrFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    const T = {}, F = {};
    T.albedo = this.makeTex(rw, rh, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, null, gl.NEAREST);
    T.normal = this.makeTex(rw, rh, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, null, gl.NEAREST);
    T.emis = this.makeTex(rw, rh, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, null, gl.NEAREST);
    T.depth = this.makeTex(rw, rh, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null, gl.NEAREST);
    T.hdr = this.makeTex(rw, rh, hdrInternal, gl.RGBA, hdrType, null, gl.LINEAR);
    const aw = Math.max(8, rw >> 1), ah = Math.max(8, rh >> 1);
    T.ao0 = this.makeTex(aw, ah, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, null, gl.LINEAR);
    T.ao1 = this.makeTex(aw, ah, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, null, gl.LINEAR);
    const bw = Math.max(8, rw >> 2), bh = Math.max(8, rh >> 2);
    T.bloom0 = this.makeTex(bw, bh, hdrInternal, gl.RGBA, hdrType, null, gl.LINEAR);
    T.bloom1 = this.makeTex(bw, bh, hdrInternal, gl.RGBA, hdrType, null, gl.LINEAR);
    F.gbuf = this.makeFbo([T.albedo, T.normal, T.emis], T.depth);
    F.light = this.makeFbo([T.hdr], null);
    F.ao0 = this.makeFbo([T.ao0], null);
    F.ao1 = this.makeFbo([T.ao1], null);
    F.bloom0 = this.makeFbo([T.bloom0], null);
    F.bloom1 = this.makeFbo([T.bloom1], null);
    this.targets = { tex: T, fbo: F, aw, ah, bw, bh };
    if (this.shadowSize !== q.shadow) {
      if (this.shadowTex) { gl.deleteTexture(this.shadowTex); gl.deleteFramebuffer(this.shadowFbo); }
      this.shadowSize = q.shadow;
      this.shadowTex = this.makeTex(q.shadow, q.shadow, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
      this.shadowFbo = this.makeFbo([], this.shadowTex);
    }
  },

  uploadMesh(data) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data.vertices, gl.STATIC_DRAW);
    this.bindStdAttribs();
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, vbo, ibo, count: data.indices.length, type: data.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
  },

  // Texture synthesis runs in slices so the loading bar can advance between frames.
  allocMaterialData() {
    const n = MATERIALS.length * TEX_SIZE * TEX_SIZE * 4;
    this.albedoData = new Uint8Array(n);
    this.normalData = new Uint8Array(n);
  },
  uploadMaterialArrays() {
    const gl = this.gl;
    const mk = data => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
      gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, TEX_SIZE, TEX_SIZE, MATERIALS.length, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
      const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
      if (aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
      return t;
    };
    this.albedoArray = mk(this.albedoData);
    this.normalArray = mk(this.normalData);
  },
  uploadMaterialUniforms() {
    const gl = this.gl, p = this.progs.gbuf;
    const A = new Float32Array(96), B = new Float32Array(96), E = new Float32Array(72);
    for (let i = 0; i < MATERIALS.length; i++) {
      const m = MATERIALS[i], base = hexToLinear(m.base), em = hexToLinear(m.emis);
      A[i * 4] = base[0]; A[i * 4 + 1] = base[1]; A[i * 4 + 2] = base[2]; A[i * 4 + 3] = m.rough;
      const flag = m.name === 'concrete' ? 1 : m.name === 'hazard' ? 2 : m.name === 'lens' ? 3 : 0;
      B[i * 4] = m.metal; B[i * 4 + 1] = m.tile; B[i * 4 + 2] = m.emisStr; B[i * 4 + 3] = flag;
      E[i * 3] = em[0]; E[i * 3 + 1] = em[1]; E[i * 3 + 2] = em[2];
    }
    gl.useProgram(p);
    gl.uniform4fv(this.u('gbuf', 'uMatA'), A);
    gl.uniform4fv(this.u('gbuf', 'uMatB'), B);
    gl.uniform3fv(this.u('gbuf', 'uMatE'), E);
    gl.uniform1i(this.u('gbuf', 'uAlbedoTex'), 0);
    gl.uniform1i(this.u('gbuf', 'uNormalTex'), 1);
  },

  // ---------- camera ----------
  // Settings FOV is the horizontal FOV of a 16:9 frame (Hor+): vertical FOV stays fixed across
  // aspect ratios, wider screens see more. Portrait screens keep at least 60 deg horizontally.
  setCamera(eye, yaw, pitch, roll, fovDeg) {
    this.fovDeg = fovDeg;
    const aspect = this.width / Math.max(1, this.height);
    let vfov = 2 * Math.atan(Math.tan(fovDeg * DEG / 2) / (16 / 9));
    vfov = Math.max(vfov, 2 * Math.atan(Math.tan(30 * DEG) / Math.max(aspect, 0.1)));
    M4.perspective(this.proj, Math.min(vfov, 2.6), aspect, SCALE.near, SCALE.far);
    M4.compose(_r.m, eye[0], eye[1], eye[2], yaw, pitch, roll, 1, 1, 1);
    M4.invert(this.view, _r.m);
    M4.multiply(this.viewProj, this.proj, this.view);
    M4.invert(this.invViewProj, this.viewProj);
    V3.copy(this.camPos, eye);
    V3.set(this.camRight, _r.m[0], _r.m[1], _r.m[2]);
    V3.set(this.camUp, _r.m[4], _r.m[5], _r.m[6]);
    V3.set(this.camFwd, -_r.m[8], -_r.m[9], -_r.m[10]);
    this.extractFrustum();
  },
  saveCamera() {
    const s = this._saved || (this._saved = { view: M4.create(), proj: M4.create(), vp: M4.create(), ivp: M4.create(), pos: V3.create(), r: V3.create(), u: V3.create(), f: V3.create(), frus: new Float32Array(24) });
    s.view.set(this.view); s.proj.set(this.proj); s.vp.set(this.viewProj); s.ivp.set(this.invViewProj);
    V3.copy(s.pos, this.camPos); V3.copy(s.r, this.camRight); V3.copy(s.u, this.camUp); V3.copy(s.f, this.camFwd); s.frus.set(this.frustum);
  },
  restoreCamera() {
    const s = this._saved;
    if (!s) return;
    this.view.set(s.view); this.proj.set(s.proj); this.viewProj.set(s.vp); this.invViewProj.set(s.ivp);
    V3.copy(this.camPos, s.pos); V3.copy(this.camRight, s.r); V3.copy(this.camUp, s.u); V3.copy(this.camFwd, s.f); this.frustum.set(s.frus);
  },
  // 16:9-equivalent horizontal FOV produced by the current projection (FOV anchor).
  horizontalFovDeg() {
    const tanHalfV = 1 / this.proj[5];
    return 2 * Math.atan(tanHalfV * 16 / 9) / DEG;
  },
  extractFrustum() {
    const m = this.viewProj, f = this.frustum;
    const planes = [[3, 0, 1], [3, 0, -1], [3, 1, 1], [3, 1, -1], [3, 2, 1], [3, 2, -1]];
    for (let i = 0; i < 6; i++) {
      const s = planes[i][2], r = planes[i][1];
      const a = m[3] + s * m[r], b = m[7] + s * m[4 + r], c = m[11] + s * m[8 + r], d = m[15] + s * m[12 + r];
      const l = Math.hypot(a, b, c) || 1;
      f[i * 4] = a / l; f[i * 4 + 1] = b / l; f[i * 4 + 2] = c / l; f[i * 4 + 3] = d / l;
    }
  },
  boxVisible(mn, mx) {
    const f = this.frustum;
    for (let i = 0; i < 6; i++) {
      const a = f[i * 4], b = f[i * 4 + 1], c = f[i * 4 + 2], d = f[i * 4 + 3];
      const x = a >= 0 ? mx[0] : mn[0], y = b >= 0 ? mx[1] : mn[1], z = c >= 0 ? mx[2] : mn[2];
      if (a * x + b * y + c * z + d < 0) return false;
    }
    return true;
  },
  sphereVisible(p, r) {
    const f = this.frustum;
    for (let i = 0; i < 6; i++) if (f[i * 4] * p[0] + f[i * 4 + 1] * p[1] + f[i * 4 + 2] * p[2] + f[i * 4 + 3] < -r) return false;
    return true;
  },

  computeNormalMat(m) {
    // inverse-transpose of the upper 3x3
    const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
    const A = e * i - f * h, B = -(d * i - f * g), Cc = d * h - e * g;
    let det = a * A + b * B + c * Cc;
    if (Math.abs(det) < 1e-12) det = 1e-12;
    const inv = 1 / det, o = this.normalMat;
    o[0] = A * inv; o[1] = -(b * i - c * h) * inv; o[2] = (b * f - c * e) * inv;
    o[3] = B * inv; o[4] = (a * i - c * g) * inv; o[5] = -(a * f - c * d) * inv;
    o[6] = Cc * inv; o[7] = -(a * h - b * g) * inv; o[8] = (a * e - b * d) * inv;
    // transpose of inverse
    let t = o[1]; o[1] = o[3]; o[3] = t; t = o[2]; o[2] = o[6]; o[6] = t; t = o[5]; o[5] = o[7]; o[7] = t;
    return o;
  },

  fullscreen() { this.gl.bindVertexArray(this.emptyVao); this.gl.drawArrays(this.gl.TRIANGLES, 0, 3); this.stats.draws++; },

  bindGBufferInputs(prog) {
    const gl = this.gl, T = this.targets.tex;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.albedo); gl.uniform1i(this.u(prog, 'uGAlbedo'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, T.normal); gl.uniform1i(this.u(prog, 'uGNormal'), 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, T.emis); gl.uniform1i(this.u(prog, 'uGEmis'), 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, T.depth); gl.uniform1i(this.u(prog, 'uDepth'), 3);
    gl.uniformMatrix4fv(this.u(prog, 'uInvViewProj'), false, this.invViewProj);
    gl.uniform3fv(this.u(prog, 'uCamPos'), this.camPos);
  },

  // ---------- frame ----------
  render(scene, time) {
    if (!this.ok || this.lost) return;
    const gl = this.gl, T = this.targets.tex, F = this.targets.fbo, q = this.quality;
    this.stats.draws = 0; this.stats.lights = 0; this.stats.tris = 0;
    const hdrEncode = this.hdrFloat ? 1 : 0.125;

    // fog / ambient uploads (fog is inverse-tonemapped so the void renders exactly the contract hex)
    inverseToneMapHex(LIGHTING.fogColor, LIGHTING.exposure, this.fogUpload);
    const sky = hexToLinear(LIGHTING.ambientSky, LIGHTING.ambientIntensity), gr = hexToLinear(LIGHTING.ambientGround, LIGHTING.ambientIntensity);
    V3.copy(this.ambSkyUpload, sky); V3.copy(this.ambGroundUpload, gr);

    // 1. shadow map from the flashlight
    const flash = scene.flash;
    const flashActive = flash.on && flash.intensity > 0.01;
    if (flashActive) {
      V3.addScaled(_r.a, flash.pos, flash.dir, 1);
      M4.lookAt(this.shadowView, flash.pos, _r.a, Math.abs(flash.dir[1]) > 0.95 ? _r.zUp : _r.yUp);
      M4.perspective(this.shadowProj, LIGHTING.flashOuterDeg * 2.2 * DEG, 1, 0.1, LIGHTING.flashRange);
      M4.multiply(this.shadowVP, this.shadowProj, this.shadowView);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
      gl.viewport(0, 0, this.shadowSize, this.shadowSize);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      if (scene.shadows) {
        gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
        gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 3.0);
        gl.useProgram(this.progs.shadow);
        gl.uniformMatrix4fv(this.u('shadow', 'uViewProj'), false, this.shadowVP);
        gl.uniformMatrix4fv(this.u('shadow', 'uModel'), false, this.identity);
        for (let i = 0; i < Level.batches.length; i++) {
          const bt = Level.batches[i];
          if (!scene.sectorVisible[bt.sector] || !bt.mesh) continue;
          gl.bindVertexArray(bt.mesh.vao);
          gl.drawElements(gl.TRIANGLES, bt.mesh.count, bt.mesh.type, 0);
          this.stats.draws++;
        }
        const Q = RenderQueue;
        for (let i = 0; i < Q.count; i++) {
          const it = Q.items[i];
          if (!it.castShadow) continue;
          gl.uniformMatrix4fv(this.u('shadow', 'uModel'), false, it.model);
          const mesh = this.meshes[it.mesh];
          gl.bindVertexArray(mesh.vao);
          gl.drawElements(gl.TRIANGLES, mesh.count, mesh.type, 0);
          this.stats.draws++;
        }
        // imported glTF meshes
        const AQ = AssetQueue;
        for (let i = 0; i < AQ.count; i++) {
          const it = AQ.items[i];
          if (!it.shadow) continue;
          const prims = it.asset.prims;
          for (let k = 0; k < prims.length; k++) {
            const pr = prims[k];
            if (!pr.gpu) continue;
            M4.multiply(_r.am, it.matrix, pr.node);
            gl.uniformMatrix4fv(this.u('shadow', 'uModel'), false, _r.am);
            gl.bindVertexArray(pr.gpu.vao);
            gl.drawElements(gl.TRIANGLES, pr.gpu.count, pr.gpu.type, 0);
            this.stats.draws++;
          }
        }
        gl.disable(gl.POLYGON_OFFSET_FILL);
      }
    }

    // 2. G-buffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, F.gbuf);
    gl.viewport(0, 0, this.rw, this.rh);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const gp = this.progs.gbuf;
    gl.useProgram(gp);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.albedoArray);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.normalArray);
    gl.uniformMatrix4fv(this.u('gbuf', 'uViewProj'), false, this.viewProj);
    gl.uniform1f(this.u('gbuf', 'uTime'), time);
    gl.uniform4f(this.u('gbuf', 'uFracture'), scene.fracture[0], scene.fracture[1], scene.fracture[2], scene.fracture[3]);
    gl.uniform1f(this.u('gbuf', 'uFractureAmt'), scene.fractureAmt);
    // static sector batches
    gl.uniformMatrix4fv(this.u('gbuf', 'uModel'), false, this.identity);
    gl.uniformMatrix3fv(this.u('gbuf', 'uNormalMat'), false, this.identity3);
    gl.uniform1i(this.u('gbuf', 'uObjSpace'), 0);
    gl.uniform4f(this.u('gbuf', 'uTint'), 1, 1, 1, 0);
    gl.uniform3f(this.u('gbuf', 'uEmisAdd'), 0, 0, 0);
    gl.uniform1f(this.u('gbuf', 'uMatOverride'), 0);
    for (let i = 0; i < Level.batches.length; i++) {
      const bt = Level.batches[i];
      if (!scene.sectorVisible[bt.sector] || !bt.mesh || !this.boxVisible(bt.min, bt.max)) continue;
      gl.bindVertexArray(bt.mesh.vao);
      gl.drawElements(gl.TRIANGLES, bt.mesh.count, bt.mesh.type, 0);
      this.stats.draws++; this.stats.tris += bt.mesh.count / 3;
    }
    // dynamic objects
    const Q = RenderQueue;
    for (let i = 0; i < Q.count; i++) {
      const it = Q.items[i];
      const mesh = this.meshes[it.mesh];
      if (!mesh) continue;
      gl.uniformMatrix4fv(this.u('gbuf', 'uModel'), false, it.model);
      gl.uniformMatrix3fv(this.u('gbuf', 'uNormalMat'), false, this.computeNormalMat(it.model));
      gl.uniform1f(this.u('gbuf', 'uMatOverride'), it.mat);
      gl.uniform1i(this.u('gbuf', 'uObjSpace'), 1);
      gl.uniform4f(this.u('gbuf', 'uTint'), it.tint[0], it.tint[1], it.tint[2], it.tint[3]);
      gl.uniform3f(this.u('gbuf', 'uEmisAdd'), it.emis[0], it.emis[1], it.emis[2]);
      gl.bindVertexArray(mesh.vao);
      gl.drawElements(gl.TRIANGLES, mesh.count, mesh.type, 0);
      this.stats.draws++; this.stats.tris += mesh.count / 3;
    }
    // cables (dynamic tube stream)
    if (CableMesh.indexCount > 0) {
      gl.bindVertexArray(this.cableVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cableVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, CableMesh.vertexData, 0, CableMesh.vertexCount * VERT_FLOATS);
      gl.uniformMatrix4fv(this.u('gbuf', 'uModel'), false, this.identity);
      gl.uniformMatrix3fv(this.u('gbuf', 'uNormalMat'), false, this.identity3);
      gl.uniform1i(this.u('gbuf', 'uObjSpace'), 0);
      gl.uniform4f(this.u('gbuf', 'uTint'), 1, 1, 1, 0);
      for (let c = 0; c < CableMesh.ranges.length; c++) {
        const rg = CableMesh.ranges[c];
        if (rg.count === 0) continue;
        gl.uniform3f(this.u('gbuf', 'uEmisAdd'), rg.emis[0], rg.emis[1], rg.emis[2]);
        gl.drawElements(gl.TRIANGLES, rg.count, gl.UNSIGNED_SHORT, rg.offset * 2);
        this.stats.draws++;
      }
    }
    // imported glTF meshes
    this.stats.assetDraws = 0;
    if (AssetQueue.count > 0) {
      gl.useProgram(this.progs.gbufTex);
      gl.uniformMatrix4fv(this.u('gbufTex', 'uViewProj'), false, this.viewProj);
      gl.uniform1i(this.u('gbufTex', 'uBaseTex'), 4);
      gl.activeTexture(gl.TEXTURE4);
      const AQ = AssetQueue;
      for (let i = 0; i < AQ.count; i++) {
        const it = AQ.items[i];
        gl.uniform4f(this.u('gbufTex', 'uTint'), it.tint[0], it.tint[1], it.tint[2], it.tint[3]);
        gl.uniform3f(this.u('gbufTex', 'uEmisAdd'), it.emis[0], it.emis[1], it.emis[2]);
        const prims = it.asset.prims;
        for (let k = 0; k < prims.length; k++) {
          const pr = prims[k], m = pr.material;
          if (!pr.gpu) continue;
          M4.multiply(_r.am, it.matrix, pr.node);
          gl.uniformMatrix4fv(this.u('gbufTex', 'uModel'), false, _r.am);
          gl.uniformMatrix3fv(this.u('gbufTex', 'uNormalMat'), false, this.computeNormalMat(_r.am));
          gl.uniform4fv(this.u('gbufTex', 'uBaseColor'), m.baseColor);
          gl.uniform2f(this.u('gbufTex', 'uRoughMetal'), m.rough, m.metal);
          gl.uniform3fv(this.u('gbufTex', 'uEmissive'), m.emissive);
          gl.uniform1f(this.u('gbufTex', 'uCutoff'), m.cutoff);
          gl.uniform1f(this.u('gbufTex', 'uTexEmissive'), m.texEmissive || 0);
          gl.uniform1i(this.u('gbufTex', 'uHasTex'), m.tex ? 1 : 0);
          gl.bindTexture(gl.TEXTURE_2D, m.tex || this.white);
          if (m.doubleSided) gl.disable(gl.CULL_FACE); else gl.enable(gl.CULL_FACE);
          gl.bindVertexArray(pr.gpu.vao);
          gl.drawElements(gl.TRIANGLES, pr.gpu.count, pr.gpu.type, 0);
          this.stats.draws++; this.stats.assetDraws++; this.stats.tris += pr.gpu.count / 3;
        }
      }
      gl.enable(gl.CULL_FACE);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);

    // 3. SSAO
    let aoTex = this.white;
    if (q.ssao) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, F.ao0);
      gl.viewport(0, 0, this.targets.aw, this.targets.ah);
      gl.useProgram(this.progs.ssao);
      this.bindGBufferInputs('ssao');
      gl.uniformMatrix4fv(this.u('ssao', 'uViewProj'), false, this.viewProj);
      gl.uniform1i(this.u('ssao', 'uSamples'), q.aoSamples);
      gl.uniform1f(this.u('ssao', 'uRadius'), 0.55);
      gl.uniform2f(this.u('ssao', 'uNearFar'), SCALE.near, SCALE.far);
      this.fullscreen();
      gl.bindFramebuffer(gl.FRAMEBUFFER, F.ao1);
      gl.useProgram(this.progs.blur4);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.ao0);
      gl.uniform1i(this.u('blur4', 'uSrc'), 0);
      gl.uniform2f(this.u('blur4', 'uTexel'), 1 / this.targets.aw, 1 / this.targets.ah);
      this.fullscreen();
      aoTex = T.ao1;
    }

    // 4. ambient + flashlight + fog + volumetrics
    gl.bindFramebuffer(gl.FRAMEBUFFER, F.light);
    gl.viewport(0, 0, this.rw, this.rh);
    const ap = this.progs.ambient;
    gl.useProgram(ap);
    this.bindGBufferInputs('ambient');
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, aoTex); gl.uniform1i(this.u('ambient', 'uAO'), 4);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex); gl.uniform1i(this.u('ambient', 'uShadow'), 5);
    gl.uniformMatrix4fv(this.u('ambient', 'uShadowMat'), false, this.shadowVP);
    gl.uniform3fv(this.u('ambient', 'uAmbSky'), this.ambSkyUpload);
    gl.uniform3fv(this.u('ambient', 'uAmbGround'), this.ambGroundUpload);
    gl.uniform3fv(this.u('ambient', 'uFogColor'), this.fogUpload);
    gl.uniform2f(this.u('ambient', 'uFog'), scene.fogDensity, LIGHTING.fogHeightFalloff);
    gl.uniform3fv(this.u('ambient', 'uFlashPos'), flash.pos);
    gl.uniform3fv(this.u('ambient', 'uFlashDir'), flash.dir);
    const fc = hexToLinear(LIGHTING.flashColor, flashActive ? flash.intensity : 0);
    V3.copy(this.flashColorUpload, fc);
    gl.uniform3fv(this.u('ambient', 'uFlashColor'), this.flashColorUpload);
    gl.uniform3f(this.u('ambient', 'uFlashCone'), Math.cos(LIGHTING.flashOuterDeg * DEG), Math.cos(LIGHTING.flashInnerDeg * DEG), LIGHTING.flashRange);
    gl.uniform1i(this.u('ambient', 'uVolSteps'), flashActive ? q.volSteps : 0);
    gl.uniform1i(this.u('ambient', 'uPcf'), scene.shadows ? q.pcf : 0);
    gl.uniform1f(this.u('ambient', 'uShadowTexel'), 1 / this.shadowSize);
    gl.uniform1f(this.u('ambient', 'uHdrEncode'), hdrEncode);
    gl.uniform1f(this.u('ambient', 'uTime'), time);
    this.fullscreen();

    // 5. point lights (scissored, additive)
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.enable(gl.SCISSOR_TEST);
    const pp = this.progs.point;
    gl.useProgram(pp);
    this.bindGBufferInputs('point');
    gl.uniform2f(this.u('point', 'uFog'), scene.fogDensity, LIGHTING.fogHeightFalloff);
    gl.uniform1f(this.u('point', 'uHdrEncode'), hdrEncode);
    const lights = scene.lights;
    let drawn = 0;
    for (let i = 0; i < lights.count && drawn < q.maxLights; i++) {
      const L = lights.items[i];
      if (L.current <= 0.01 || !this.sphereVisible(L.pos, L.radius)) continue;
      if (!this.scissorFor(L.pos, L.radius)) continue;
      gl.uniform3fv(this.u('point', 'uLightPos'), L.pos);
      gl.uniform3f(this.u('point', 'uLightColor'), L.color[0] * L.current, L.color[1] * L.current, L.color[2] * L.current);
      gl.uniform1f(this.u('point', 'uLightRadius'), L.radius);
      gl.uniform1f(this.u('point', 'uScatter'), L.scatter);
      this.fullscreen();
      drawn++;
    }
    this.stats.lights = drawn;
    gl.disable(gl.SCISSOR_TEST);

    // 6. forward particles / halos
    if (Particles.count > 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, F.light);
      gl.useProgram(this.progs.particle);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, T.depth);
      gl.uniform1i(this.u('particle', 'uDepth'), 3);
      gl.uniform2f(this.u('particle', 'uNearFar'), SCALE.near, SCALE.far);
      gl.uniformMatrix4fv(this.u('particle', 'uViewProj'), false, this.viewProj);
      gl.uniform3fv(this.u('particle', 'uCamRight'), this.camRight);
      gl.uniform3fv(this.u('particle', 'uCamUp'), this.camUp);
      gl.uniform3fv(this.u('particle', 'uCamPos'), this.camPos);
      gl.uniform2f(this.u('particle', 'uFog'), scene.fogDensity, 0);
      gl.uniform1f(this.u('particle', 'uHdrEncode'), hdrEncode);
      const n = Particles.writeStream(this.particleData);
      gl.bindVertexArray(this.particleVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.particleVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.particleData, 0, n * 6 * 11);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied: additive glows have alpha 0
      gl.drawArrays(gl.TRIANGLES, 0, n * 6);
      this.stats.draws++;
      gl.bindVertexArray(null);
    }
    gl.disable(gl.BLEND);

    // 7. bloom
    gl.bindFramebuffer(gl.FRAMEBUFFER, F.bloom0);
    gl.viewport(0, 0, this.targets.bw, this.targets.bh);
    gl.useProgram(this.progs.bright);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.hdr);
    gl.uniform1i(this.u('bright', 'uSrc'), 0);
    gl.uniform1f(this.u('bright', 'uThreshold'), LIGHTING.bloomThreshold);
    gl.uniform1f(this.u('bright', 'uHdrDecode'), 1 / hdrEncode);
    gl.uniform2f(this.u('bright', 'uTexel'), 1 / this.rw, 1 / this.rh);
    this.fullscreen();
    gl.useProgram(this.progs.gauss);
    gl.uniform1i(this.u('gauss', 'uSrc'), 0);
    for (let k = 0; k < q.bloomPasses; k++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, F.bloom1);
      gl.bindTexture(gl.TEXTURE_2D, T.bloom0);
      gl.uniform2f(this.u('gauss', 'uDir'), (1 + k) / this.targets.bw, 0);
      this.fullscreen();
      gl.bindFramebuffer(gl.FRAMEBUFFER, F.bloom0);
      gl.bindTexture(gl.TEXTURE_2D, T.bloom1);
      gl.uniform2f(this.u('gauss', 'uDir'), 0, (1 + k) / this.targets.bh);
      this.fullscreen();
    }

    // 8. composite to the canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.progs.composite);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.hdr); gl.uniform1i(this.u('composite', 'uHdr'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, T.bloom0); gl.uniform1i(this.u('composite', 'uBloom'), 1);
    const P = this.post, cal = P.calibrate;
    gl.uniform1f(this.u('composite', 'uHdrDecode'), 1 / hdrEncode);
    gl.uniform1f(this.u('composite', 'uBloomStrength'), cal ? 0 : LIGHTING.bloomStrength);
    gl.uniform1f(this.u('composite', 'uExposure'), LIGHTING.exposure);
    gl.uniform1f(this.u('composite', 'uTime'), time);
    gl.uniform1f(this.u('composite', 'uVhs'), cal ? 0 : clamp(LIGHTING.vhs * Settings.values.vhs + P.vhsBoost, 0, 1.5));
    gl.uniform1f(this.u('composite', 'uCA'), cal ? 0 : LIGHTING.caBase);
    gl.uniform1f(this.u('composite', 'uFear'), cal ? 0 : P.fear);
    gl.uniform1f(this.u('composite', 'uRedWave'), cal ? 0 : P.redWave);
    gl.uniform1f(this.u('composite', 'uVignette'), cal ? 0 : LIGHTING.vignette);
    gl.uniform1f(this.u('composite', 'uFade'), cal ? 0 : P.fade);
    gl.uniform1f(this.u('composite', 'uGrain'), cal ? 0 : 0.018);
    gl.uniform1f(this.u('composite', 'uFlash'), cal ? 0 : P.flash);
    gl.uniform1f(this.u('composite', 'uSlats'), cal ? 0 : P.slats);
    gl.uniform3fv(this.u('composite', 'uFlashTint'), P.flashTint);
    gl.uniform2f(this.u('composite', 'uRes'), this.width, this.height);
    this.fullscreen();
  },

  // Screen-space scissor rectangle around a light sphere. Returns false if fully off-screen.
  scissorFor(p, r) {
    const gl = this.gl, m = this.viewProj;
    let x0 = 1, y0 = 1, x1 = -1, y1 = -1;
    for (let i = 0; i < 8; i++) {
      const x = p[0] + (i & 1 ? r : -r), y = p[1] + (i & 2 ? r : -r), z = p[2] + (i & 4 ? r : -r);
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (w <= SCALE.near) { gl.scissor(0, 0, this.rw, this.rh); return true; }
      const cx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w, cy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
      if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
    }
    x0 = clamp(x0, -1, 1); x1 = clamp(x1, -1, 1); y0 = clamp(y0, -1, 1); y1 = clamp(y1, -1, 1);
    if (x1 <= x0 || y1 <= y0) return false;
    const sx = Math.floor((x0 * 0.5 + 0.5) * this.rw), sy = Math.floor((y0 * 0.5 + 0.5) * this.rh);
    const sw = Math.ceil((x1 * 0.5 + 0.5) * this.rw) - sx + 1, sh = Math.ceil((y1 * 0.5 + 0.5) * this.rh) - sy + 1;
    gl.scissor(sx, sy, sw, sh);
    return true;
  }
};
const _r = { am: M4.create(), m: M4.create(), a: V3.create(), yUp: V3.create(0, 1, 0), zUp: V3.create(0, 0, 1) };

// Inverse of the ACES fit used in the composite (solves the rational quadratic for x).
function inverseAces(y) {
  y = clamp(y, 0, 0.999);
  const a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  const A = a - c * y, B = b - d * y, Cq = -e * y;
  if (Math.abs(A) < 1e-6) return -Cq / B;
  const disc = Math.max(0, B * B - 4 * A * Cq);
  return (-B + Math.sqrt(disc)) / (2 * A);
}
function inverseToneMapHex(hex, exposure, out) {
  const c = hexToRgb(hex);
  for (let i = 0; i < 3; i++) out[i] = inverseAces(Math.pow(c[i] / 255, 2.2)) / exposure;
  return out;
}

// ---------- render queue: logic pushes draw items, the renderer consumes them ----------
const RenderQueue = {
  items: [], count: 0, cap: 1100,
  init() {
    for (let i = 0; i < this.cap; i++) this.items.push({ mesh: 'box', model: M4.create(), mat: 0, tint: new Float32Array([1, 1, 1, 0]), emis: new Float32Array(3), castShadow: true });
  },
  begin() { this.count = 0; },
  push(mesh, mat, castShadow) {
    if (this.count >= this.cap) return null;
    const it = this.items[this.count++];
    it.mesh = mesh; it.mat = mat; it.castShadow = castShadow !== false;
    it.tint[0] = 1; it.tint[1] = 1; it.tint[2] = 1; it.tint[3] = 0;
    it.emis[0] = 0; it.emis[1] = 0; it.emis[2] = 0;
    return it;
  },
  // Convenience: TRS draw
  trs(mesh, mat, x, y, z, yaw, pitch, roll, sx, sy, sz, castShadow) {
    const it = this.push(mesh, mat, castShadow);
    if (it) M4.compose(it.model, x, y, z, yaw, pitch, roll, sx, sy, sz);
    return it;
  },
  // Convenience: cylinder/cone between two points
  seg(mesh, mat, a, b, r, castShadow) {
    const it = this.push(mesh, mat, castShadow);
    if (it) M4.segment(it.model, a, b, r);
    return it;
  }
};
