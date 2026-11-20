import { MAX_FORWARD_LIGHTS } from '../../config/GameConstants';

/**
 * GLSL ES 3.00 sources for every pass of the pipeline.
 *  1. Scene pass        – forward PBR-lite surface shading, normal/roughness/emissive maps, N dynamic point lights.
 *  2. Volumetric fog    – (reduced resolution) depth-reconstructed raymarch with height falloff, animated density and HG in-scattering.
 *  3. CRT/VHS composite – ACES tonemap, UI composite, barrel curvature, chromatic aberration, scanlines,
 *                         shadow mask, tracking jitter, tape noise, vignette, flash/fade.
 */

const SHARED_LIGHT_UNIFORMS: string = /* glsl */ `
#define MAX_LIGHTS ${MAX_FORWARD_LIGHTS}
uniform int uLightCount;
uniform vec3 uLightPositions[MAX_LIGHTS];
uniform vec3 uLightColors[MAX_LIGHTS];
uniform float uLightRanges[MAX_LIGHTS];

float computeLightWindow(float distanceToLight, float lightRange) {
  float ratio = distanceToLight / max(lightRange, 0.001);
  float ratio4 = ratio * ratio * ratio * ratio;
  float window = clamp(1.0 - ratio4, 0.0, 1.0);
  return window * window;
}

float computeLightAttenuation(float distanceSquared, float lightRange) {
  float inverseSquare = 1.0 / (1.0 + distanceSquared);
  return inverseSquare * computeLightWindow(sqrt(distanceSquared), lightRange);
}
`;

const SHARED_NOISE: string = /* glsl */ `
float hash13(vec3 point) {
  point = fract(point * 0.1031);
  point += dot(point, point.zyx + 31.32);
  return fract((point.x + point.y) * point.z);
}

float valueNoise3D(vec3 point) {
  vec3 cell = floor(point);
  vec3 fraction = fract(point);
  vec3 blend = fraction * fraction * (3.0 - 2.0 * fraction);
  float n000 = hash13(cell + vec3(0.0, 0.0, 0.0));
  float n100 = hash13(cell + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(cell + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(cell + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(cell + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(cell + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(cell + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(cell + vec3(1.0, 1.0, 1.0));
  float bottom = mix(mix(n000, n100, blend.x), mix(n010, n110, blend.x), blend.y);
  float top = mix(mix(n001, n101, blend.x), mix(n011, n111, blend.x), blend.y);
  return mix(bottom, top, blend.z);
}

float interleavedGradientNoise(vec2 pixel) {
  return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}
`;

export const FULLSCREEN_VERTEX_SHADER: string = /* glsl */ `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  // Single oversized triangle covering the viewport; no vertex buffer required.
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const SCENE_VERTEX_SHADER: string = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec4 aTangent;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;
uniform mat3 uNormalMatrix;
uniform float uUvScale;

out vec3 vWorldPosition;
out vec2 vUv;
out mat3 vTangentToWorld;

void main() {
  vec4 worldPosition = uModel * vec4(aPosition, 1.0);
  vec3 worldNormal = normalize(uNormalMatrix * aNormal);
  vec3 worldTangent = normalize(mat3(uModel) * aTangent.xyz);
  worldTangent = normalize(worldTangent - worldNormal * dot(worldNormal, worldTangent));
  vec3 worldBitangent = cross(worldNormal, worldTangent) * aTangent.w;
  vTangentToWorld = mat3(worldTangent, worldBitangent, worldNormal);
  vWorldPosition = worldPosition.xyz;
  vUv = aUv * uUvScale;
  gl_Position = uProjection * uView * worldPosition;
}
`;

export const SCENE_FRAGMENT_SHADER: string = /* glsl */ `#version 300 es
precision highp float;
${SHARED_LIGHT_UNIFORMS}

in vec3 vWorldPosition;
in vec2 vUv;
in mat3 vTangentToWorld;

uniform sampler2D uDiffuseMap;
uniform sampler2D uNormalMap;
uniform sampler2D uRoughnessMap;
uniform sampler2D uEmissiveMap;

uniform vec3 uBaseTint;
uniform float uNormalStrength;
uniform float uRoughnessScale;
uniform float uMetallic;
uniform vec3 uEmissiveColor;
uniform float uEmissiveStrength;
uniform vec3 uAmbientColor;
uniform vec3 uCameraPosition;

out vec4 outColor;

const float PI = 3.14159265359;

float distributionGGX(float normalDotHalf, float roughness) {
  float alpha = roughness * roughness;
  float alphaSquared = alpha * alpha;
  float denominator = normalDotHalf * normalDotHalf * (alphaSquared - 1.0) + 1.0;
  return alphaSquared / (PI * denominator * denominator + 1e-5);
}

float geometrySchlickGGX(float normalDotDirection, float roughness) {
  float k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
  return normalDotDirection / (normalDotDirection * (1.0 - k) + k);
}

vec3 fresnelSchlick(float cosTheta, vec3 baseReflectance) {
  return baseReflectance + (1.0 - baseReflectance) * pow(1.0 - cosTheta, 5.0);
}

void main() {
  vec3 albedo = texture(uDiffuseMap, vUv).rgb * uBaseTint;
  vec3 tangentNormal = texture(uNormalMap, vUv).xyz * 2.0 - 1.0;
  tangentNormal.xy *= uNormalStrength;
  vec3 surfaceNormal = normalize(vTangentToWorld * normalize(tangentNormal));
  if (!gl_FrontFacing) {
    surfaceNormal = -surfaceNormal;
  }
  float roughness = clamp(texture(uRoughnessMap, vUv).r * uRoughnessScale, 0.04, 1.0);
  vec3 emissive = texture(uEmissiveMap, vUv).rgb * uEmissiveColor * uEmissiveStrength;

  vec3 viewDirection = normalize(uCameraPosition - vWorldPosition);
  float normalDotView = max(dot(surfaceNormal, viewDirection), 1e-4);
  vec3 baseReflectance = mix(vec3(0.04), albedo, uMetallic);

  vec3 radiance = vec3(0.0);
  for (int lightIndex = 0; lightIndex < MAX_LIGHTS; lightIndex++) {
    if (lightIndex >= uLightCount) {
      break;
    }
    vec3 toLight = uLightPositions[lightIndex] - vWorldPosition;
    float distanceSquared = dot(toLight, toLight);
    vec3 lightDirection = toLight * inversesqrt(max(distanceSquared, 1e-6));
    float attenuation = computeLightAttenuation(distanceSquared, uLightRanges[lightIndex]);
    if (attenuation <= 0.0) {
      continue;
    }
    vec3 halfVector = normalize(lightDirection + viewDirection);
    float normalDotLight = max(dot(surfaceNormal, lightDirection), 0.0);
    float normalDotHalf = max(dot(surfaceNormal, halfVector), 0.0);
    float viewDotHalf = max(dot(viewDirection, halfVector), 0.0);

    float distributionTerm = distributionGGX(normalDotHalf, roughness);
    float geometryTerm = geometrySchlickGGX(normalDotView, roughness) * geometrySchlickGGX(normalDotLight, roughness);
    vec3 fresnelTerm = fresnelSchlick(viewDotHalf, baseReflectance);
    vec3 specular = (distributionTerm * geometryTerm * fresnelTerm) / (4.0 * normalDotView * normalDotLight + 1e-4);
    vec3 diffuseWeight = (vec3(1.0) - fresnelTerm) * (1.0 - uMetallic);

    radiance += (diffuseWeight * albedo / PI + specular) * uLightColors[lightIndex] * attenuation * normalDotLight;
  }

  vec3 ambient = uAmbientColor * albedo * (0.75 + 0.25 * surfaceNormal.y);
  outColor = vec4(radiance + ambient + emissive, 1.0);
}
`;

export const VOLUMETRIC_FOG_FRAGMENT_SHADER: string = /* glsl */ `#version 300 es
precision highp float;
${SHARED_LIGHT_UNIFORMS}
${SHARED_NOISE}

#define FOG_STEPS 28

in vec2 vUv;

uniform sampler2D uSceneDepth;
uniform mat4 uInverseProjection;
uniform mat4 uInverseView;
uniform vec3 uCameraPosition;
uniform float uTime;
uniform float uFrameIndex;

uniform float uFogDensity;
uniform float uFogHeightFalloff;
uniform float uFogBaseHeight;
uniform float uFogNoiseScale;
uniform float uFogNoiseStrength;
uniform vec3 uFogWindVelocity;
uniform vec3 uFogAlbedo;
uniform vec3 uFogAmbientColor;
uniform float uScatteringAnisotropy;
uniform float uMaxRayDistance;
uniform float uLightScatteringBoost;

out vec4 outColor;

const float PI = 3.14159265359;

vec3 reconstructWorldPosition(vec2 uv, float depthSample) {
  vec4 clipPosition = vec4(uv * 2.0 - 1.0, depthSample * 2.0 - 1.0, 1.0);
  vec4 viewPosition = uInverseProjection * clipPosition;
  viewPosition /= viewPosition.w;
  return (uInverseView * viewPosition).xyz;
}

float henyeyGreensteinPhase(float cosTheta, float anisotropy) {
  float anisotropySquared = anisotropy * anisotropy;
  float denominator = 1.0 + anisotropySquared - 2.0 * anisotropy * cosTheta;
  return (1.0 - anisotropySquared) / (4.0 * PI * pow(max(denominator, 1e-4), 1.5));
}

float sampleFogDensity(vec3 worldPosition) {
  float heightTerm = exp(-max(worldPosition.y - uFogBaseHeight, 0.0) * uFogHeightFalloff);
  vec3 noiseCoordinate = worldPosition * uFogNoiseScale + uFogWindVelocity * uTime;
  float billow = valueNoise3D(noiseCoordinate) * 0.65 + valueNoise3D(noiseCoordinate * 2.7 + 11.3) * 0.35;
  float noiseTerm = mix(1.0, billow * 1.8, uFogNoiseStrength);
  return max(uFogDensity * heightTerm * noiseTerm, 0.0);
}

void main() {
  float depthSample = texture(uSceneDepth, vUv).r;
  vec3 worldPosition = reconstructWorldPosition(vUv, depthSample);
  vec3 rayVector = worldPosition - uCameraPosition;
  float sceneDistance = length(rayVector);
  vec3 rayDirection = rayVector / max(sceneDistance, 1e-4);
  float rayLength = depthSample >= 0.99999 ? uMaxRayDistance : min(sceneDistance, uMaxRayDistance);
  float stepLength = rayLength / float(FOG_STEPS);
  float jitter = interleavedGradientNoise(gl_FragCoord.xy + vec2(uFrameIndex * 5.588238, uFrameIndex * 3.1));

  vec3 transmittance = vec3(1.0);
  vec3 inScattered = vec3(0.0);
  for (int stepIndex = 0; stepIndex < FOG_STEPS; stepIndex++) {
    float travel = (float(stepIndex) + jitter) * stepLength;
    vec3 samplePosition = uCameraPosition + rayDirection * travel;
    float density = sampleFogDensity(samplePosition);
    if (density < 1e-5) {
      continue;
    }
    vec3 lighting = uFogAmbientColor;
    for (int lightIndex = 0; lightIndex < MAX_LIGHTS; lightIndex++) {
      if (lightIndex >= uLightCount) {
        break;
      }
      vec3 toLight = uLightPositions[lightIndex] - samplePosition;
      float distanceSquared = dot(toLight, toLight);
      float attenuation = computeLightAttenuation(distanceSquared, uLightRanges[lightIndex]);
      if (attenuation <= 0.0) {
        continue;
      }
      float cosTheta = dot(rayDirection, toLight * inversesqrt(max(distanceSquared, 1e-6)));
      float phase = henyeyGreensteinPhase(cosTheta, uScatteringAnisotropy);
      lighting += uLightColors[lightIndex] * attenuation * phase * 4.0 * PI * uLightScatteringBoost;
    }
    vec3 extinction = vec3(density);
    vec3 scattering = density * uFogAlbedo * lighting;
    vec3 sampleTransmittance = exp(-extinction * stepLength);
    // Energy-conserving analytic integration of scattering across the step (Hillaire 2015).
    inScattered += transmittance * (scattering - scattering * sampleTransmittance) / max(extinction, vec3(1e-5));
    transmittance *= sampleTransmittance;
  }

  // Output is resolution-independent: rgb = in-scattered radiance, a = mean transmittance.
  // The composite pass applies it as scene * a + rgb, which lets this pass run at reduced resolution.
  outColor = vec4(inScattered, dot(transmittance, vec3(1.0 / 3.0)));
}
`;

export const CRT_VHS_FRAGMENT_SHADER: string = /* glsl */ `#version 300 es
precision highp float;
${SHARED_NOISE}

in vec2 vUv;

uniform sampler2D uSceneColor;
uniform sampler2D uFogVolume;
uniform sampler2D uInterfaceColor;
uniform vec2 uResolution;
uniform float uTime;

uniform float uExposure;
uniform float uBrightness;
uniform float uCurvature;
uniform float uChromaticAberration;
uniform float uScanlineIntensity;
uniform float uShadowMaskIntensity;
uniform float uNoiseIntensity;
uniform float uTrackingJitter;
uniform float uVignetteIntensity;
uniform float uColorBleed;
uniform vec3 uFlashColor;
uniform float uFlashIntensity;
uniform float uFadeToBlack;
uniform vec2 uScreenShake;

out vec4 outColor;

const float PI = 3.14159265359;

vec2 applyBarrelDistortion(vec2 uv) {
  vec2 centered = uv - 0.5;
  float radiusSquared = dot(centered, centered);
  return uv + centered * radiusSquared * uCurvature;
}

vec3 tonemapAces(vec3 color) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((color * (a * color + b)) / (color * (c * color + d) + e), 0.0, 1.0);
}

vec3 sampleSceneDisplay(vec2 uv) {
  vec4 fogSample = texture(uFogVolume, uv);
  vec3 hdr = (texture(uSceneColor, uv).rgb * fogSample.a + fogSample.rgb) * uExposure;
  vec3 display = pow(tonemapAces(hdr), vec3(1.0 / 2.2)) * uBrightness;
  vec4 interfaceSample = texture(uInterfaceColor, uv);
  return display * (1.0 - interfaceSample.a) + interfaceSample.rgb;
}

void main() {
  vec2 uv = applyBarrelDistortion(vUv) + uScreenShake;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // VHS tracking: a slow rolling distortion band plus sporadic horizontal line tears.
  float rollingBandCenter = fract(uTime * 0.071);
  float bandDistance = abs(uv.y - rollingBandCenter);
  float rollingBand = smoothstep(0.06, 0.0, bandDistance);
  float lineSeed = floor(uv.y * 160.0) + floor(uTime * 14.0) * 7.0;
  float tearGate = step(0.985, hash13(vec3(floor(uTime * 6.0), 3.7, 1.1)));
  float tearOffset = (hash13(vec3(lineSeed, 1.3, 7.7)) - 0.5) * tearGate;
  float wobble = sin(uv.y * 380.0 + uTime * 42.0) * rollingBand * 0.0035;
  uv.x += (wobble + tearOffset * 0.02) * uTrackingJitter;

  // Radial chromatic aberration: separation grows toward the tube edges.
  vec2 fromCenter = uv - 0.5;
  float aberrationAmount = uChromaticAberration * (0.0015 + dot(fromCenter, fromCenter) * 0.018);
  vec2 aberrationOffset = fromCenter * aberrationAmount + vec2(aberrationAmount * 0.35, 0.0);
  vec3 color;
  color.r = sampleSceneDisplay(uv + aberrationOffset).r;
  color.g = sampleSceneDisplay(uv).g;
  color.b = sampleSceneDisplay(uv - aberrationOffset).b;

  // Composite-video colour bleed: smear chroma horizontally.
  vec2 texel = 1.0 / uResolution;
  vec3 bleedSample = sampleSceneDisplay(uv - vec2(texel.x * 3.0, 0.0));
  float luminance = dot(color, vec3(0.299, 0.587, 0.114));
  vec3 chroma = color - luminance;
  vec3 bleedChroma = bleedSample - dot(bleedSample, vec3(0.299, 0.587, 0.114));
  color = luminance + mix(chroma, bleedChroma, uColorBleed);

  // Scanlines tied to output pixel rows; slot shadow mask on columns.
  float scanline = 0.5 + 0.5 * sin(uv.y * uResolution.y * PI * 0.5);
  color *= mix(1.0, 0.55 + 0.45 * scanline, uScanlineIntensity);
  float maskColumn = mod(gl_FragCoord.x, 3.0);
  vec3 shadowMask = vec3(maskColumn < 1.0 ? 1.0 : 0.82, maskColumn >= 1.0 && maskColumn < 2.0 ? 1.0 : 0.82, maskColumn >= 2.0 ? 1.0 : 0.82);
  color *= mix(vec3(1.0), shadowMask, uShadowMaskIntensity);

  // Tape grain + rolling-band brightening.
  float grain = hash13(vec3(gl_FragCoord.xy, floor(uTime * 60.0))) - 0.5;
  color += grain * uNoiseIntensity;
  color += rollingBand * 0.025 * uTrackingJitter;

  // Tube vignette with a soft bezel falloff.
  vec2 vignetteCoordinate = vUv * (1.0 - vUv.yx);
  float vignette = pow(clamp(vignetteCoordinate.x * vignetteCoordinate.y * 18.0, 0.0, 1.0), 0.32);
  color *= mix(1.0, vignette, uVignetteIntensity);

  color = mix(color, uFlashColor, clamp(uFlashIntensity, 0.0, 1.0));
  color *= 1.0 - clamp(uFadeToBlack, 0.0, 1.0);
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
