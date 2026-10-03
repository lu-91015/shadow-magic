// 二次元卡通渲染管线着色器（思路参考米哈游《原神》《崩坏：星穹铁道》公开分享的 NPR 方案）：
//  - 主光 Ramp 二分色阶：半兰伯特 + 窄过渡带硬切，暗部用「色相偏移的暗部色」相乘而非变灰
//  - 面部阴影：不用模型法线（鼻子/嘴角会出现脏阴影），改用头部球面法线并向正前方压平，
//    阴影边界干净、只随光源左右方位变化（SDF 面部阴影的近似）
//  - 屏幕空间深度边缘光（星铁做法）：沿视空间法线偏移采样深度，深度差超过阈值处描亮边
//  - 头发天使环：用模型自带的头发 sph 贴图当高光形状，做阈值化而非叠加原始渐变
//  - 外描边：Inverted Hull（背面外扩），用平滑法线避免硬边断裂，宽度按屏幕像素恒定，
//    颜色取自固有色压暗（而不是统一纯黑）
//  - 不做 PBR / 不做色调映射，固有色在亮部 1:1 还原，避免「过于写实」的灰脏感

export const TOON_VERT = /* glsl */ `
#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>

varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vNormalV;
varying vec3 vPosW;
varying float vViewZ;

void main() {
  vUv = uv;
  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>

  vPosW = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vNormalW = normalize(mat3(modelMatrix) * objectNormal);
  vNormalV = normalize(transformedNormal);
  vViewZ = -mvPosition.z;
}
`;

export const TOON_FRAG = /* glsl */ `
#include <common>
#include <packing>

// 0 衣物 1 皮肤 2 面部 3 头发 4 无光照（眼睛/眉毛/睫毛/口腔）
uniform int uKind;
uniform sampler2D uMap;
uniform bool uHasMap;
uniform vec4 uDiffuse;
uniform float uAlphaTest;
uniform bool uOpaque;

uniform vec3 uLightDir;      // 世界空间，指向光源
uniform vec3 uLightColor;
uniform vec3 uShadowTint;    // 暗部色（与固有色相乘）
uniform float uShadowThreshold;
uniform float uShadowSoftness;

uniform vec3 uHeadCenter;
uniform vec3 uHeadForward;
uniform float uFaceFlatten;

uniform sampler2D uSph;
uniform bool uHasSph;
uniform float uSpecStrength;

uniform sampler2D uSceneDepth;
uniform bool uUseDepthRim;
uniform vec2 uResolution;
uniform float uCameraNear;
uniform float uCameraFar;
uniform float uRimWidth;
uniform float uRimThreshold;
uniform float uRimStrength;
uniform vec3 uRimColor;
uniform vec3 uViewLightDir;  // 视空间光源方向

varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vNormalV;
varying vec3 vPosW;
varying float vViewZ;

float linearDepth(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * uCameraNear * uCameraFar) / (uCameraFar + uCameraNear - z * (uCameraFar - uCameraNear));
}

void main() {
  vec4 base = uDiffuse;
  if (uHasMap) base *= texture2D(uMap, vUv);
  if (base.a < uAlphaTest) discard;

  vec3 col = base.rgb;

  if (uKind != 4) {
    float facing = gl_FrontFacing ? 1.0 : -1.0;
    vec3 N = normalize(vNormalW) * facing;
    vec3 L = normalize(uLightDir);

    if (uKind == 2) {
      // 面部：球面法线压平到正前方，近似 SDF 面部阴影
      vec3 Ns = normalize(vPosW - uHeadCenter);
      N = normalize(mix(Ns, normalize(uHeadForward), uFaceFlatten));
    }

    float halfLambert = dot(N, L) * 0.5 + 0.5;
    float lit = smoothstep(uShadowThreshold - uShadowSoftness, uShadowThreshold + uShadowSoftness, halfLambert);
    col = base.rgb * mix(uShadowTint, vec3(1.0), lit) * uLightColor;

    // 头发天使环：sph 贴图当形状，阈值化成硬边高光
    if (uHasSph && uSpecStrength > 0.0) {
      vec3 nV = normalize(vNormalV) * facing;
      vec2 suv = nV.xy * 0.5 + 0.5;
      float s = dot(texture2D(uSph, suv).rgb, vec3(0.3333));
      float band = smoothstep(0.30, 0.38, s);
      col += base.rgb * band * uSpecStrength * mix(0.35, 1.0, lit);
    }

    // 屏幕空间深度边缘光
    if (uUseDepthRim) {
      vec2 suv = gl_FragCoord.xy / uResolution;
      vec3 nV = normalize(vNormalV) * facing;
      vec2 dir = nV.xy;
      float len = length(dir);
      if (len > 1e-4) {
        dir /= len;
        // 远处变细：按视距缩放像素偏移
        vec2 offset = dir * uRimWidth / uResolution * clamp(3.0 / max(vViewZ, 0.1), 0.5, 1.5);
        float d0 = linearDepth(texture2D(uSceneDepth, suv).r);
        float d1 = linearDepth(texture2D(uSceneDepth, suv + offset).r);
        float rim = step(uRimThreshold, d1 - d0);
        // 朝光一侧更亮，背光一侧保留一点
        float side = smoothstep(-0.2, 0.6, dot(dir, normalize(uViewLightDir.xy)));
        rim *= mix(0.35, 1.0, side);
        col += base.rgb * uRimColor * rim * uRimStrength;
      }
    }
  }

  gl_FragColor = vec4(col, uOpaque ? 1.0 : base.a);
  #include <colorspace_fragment>
}
`;

export const OUTLINE_VERT = /* glsl */ `
#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>

attribute vec3 smoothNormal;
uniform float uOutlineWidth;   // 像素
uniform vec2 uResolution;
varying vec2 vUv;

void main() {
  vUv = uv;
  vec3 objectNormal = smoothNormal;
  #ifdef USE_MORPHNORMALS
    // 平滑法线不参与 morph，保持外扩方向稳定
  #endif
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>

  vec3 nV = normalize(normalMatrix * objectNormal);
  vec2 nClip = (projectionMatrix * vec4(nV, 0.0)).xy;
  float l = length(nClip);
  if (l > 1e-5) nClip /= l;
  // 恒定像素宽度；近处略加粗、远处略收细
  float w = uOutlineWidth * clamp(3.4 / max(-mvPosition.z, 0.1), 0.6, 1.4);
  gl_Position.xy += nClip * w * 2.0 / uResolution * gl_Position.w;
}
`;

export const OUTLINE_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform bool uHasMap;
uniform vec4 uDiffuse;
uniform vec3 uOutlineTint;
uniform float uAlphaTest;
varying vec2 vUv;

void main() {
  vec4 base = uDiffuse;
  if (uHasMap) base *= texture2D(uMap, vUv);
  if (base.a < max(uAlphaTest, 0.5)) discard;
  // 描边色 = 固有色压暗并略提饱和
  vec3 c = base.rgb * uOutlineTint;
  float g = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(g), c, 1.3);
  gl_FragColor = vec4(max(c, 0.0), 1.0);
  #include <colorspace_fragment>
}
`;
