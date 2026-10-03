// 二次元卡通渲染管线（three.js）。用法：
//   const toon = createToonPipeline(THREE, renderer, scene, camera, modelRoot, { head });
//   每帧：toon.render();   卸载：toon.dispose();
// 设计说明见 ./shaders.ts 顶部注释；调参入口为下方 DEFAULT_STYLES 与 lightDir。
import { TOON_VERT, TOON_FRAG, OUTLINE_VERT, OUTLINE_FRAG } from './shaders';

export type ToonKind = 'cloth' | 'skin' | 'face' | 'hair' | 'unlit';
const KIND_ID: Record<ToonKind, number> = { cloth: 0, skin: 1, face: 2, hair: 3, unlit: 4 };

export interface ToonStyle {
  shadowTint: string;   // 暗部相乘色（sRGB）
  outlineTint: string;  // 描边 = 固有色 × 此色
  outlineWidth: number; // 像素（1x DPR 下）
  spec: number;         // 天使环强度（仅当材质带 sph）
  rim: number;          // 边缘光强度
}

// 暗部色参考原神/星铁的做法：皮肤偏暖粉、头发与衣物偏冷紫，亮暗两档对比柔和
export const DEFAULT_STYLES: Record<ToonKind, ToonStyle> = {
  face:  { shadowTint: '#f3cfcc', outlineTint: '#a07070', outlineWidth: 0.5, spec: 0, rim: 0.25 },
  skin:  { shadowTint: '#f0c4c0', outlineTint: '#a07070', outlineWidth: 0.7, spec: 0, rim: 0.3 },
  hair:  { shadowTint: '#c2c0dc', outlineTint: '#6c6888', outlineWidth: 0.8, spec: 0.22, rim: 0.35 },
  cloth: { shadowTint: '#c9c3dc', outlineTint: '#5c5670', outlineWidth: 0.8, spec: 0, rim: 0.3 },
  unlit: { shadowTint: '#ffffff', outlineTint: '#000000', outlineWidth: 0, spec: 0, rim: 0 },
};

/** 按 PMX 材质名 + 贴图文件名归类。VRoid 导出的贴图名带 _SKIN/_EYE/_FACE/_HAIR/_CLOTH 后缀。 */
export function classifyMaterial(name: string, textureFile = ''): ToonKind {
  const n = `${name} ${textureFile}`;
  if (/眼白|瞳|眉|睫毛|口腔|舌|歯|牙|EYE|Eye|_FACE\b|FaceBrow|FaceEyeline|FaceEyelash|FaceMouth|Mouth|Highlight/i.test(n)) return 'unlit';
  if (/脸|顔|颜|Face_00_SKIN|face/i.test(n)) return 'face';
  if (/髪|发|髮|刘海|HAIR|hair/i.test(n)) return 'hair';
  if (/身体|肌|皮肤|Body_00_SKIN|_SKIN|skin|body/i.test(n)) return 'skin';
  return 'cloth';
}

export interface ToonOptions {
  head?: any;                       // 头部骨骼（面部阴影用）
  lightDir?: [number, number, number];
  lightColor?: string;
  styles?: Partial<Record<ToonKind, Partial<ToonStyle>>>;
  outline?: boolean;
  depthRim?: boolean;
  classify?: (name: string, textureFile: string) => ToonKind;
}

export interface ToonPipeline {
  render(): void;
  setSize(w: number, h: number): void;
  setLightDir(x: number, y: number, z: number): void;
  dispose(): void;
}

/** 平滑法线：同一位置的顶点法线取平均，供描边外扩用（避免 UV 接缝/硬边处描边断开） */
function computeSmoothNormals(THREE: any, geometry: any) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  const n = pos.count;
  const map = new Map<string, number[]>();
  const keyOf = (i: number) =>
    `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const keys: string[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const k = keyOf(i);
    keys[i] = k;
    let acc = map.get(k);
    if (!acc) map.set(k, (acc = [0, 0, 0]));
    acc[0] += nor.getX(i);
    acc[1] += nor.getY(i);
    acc[2] += nor.getZ(i);
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = map.get(keys[i])!;
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    out[i * 3] = a[0] / l;
    out[i * 3 + 1] = a[1] / l;
    out[i * 3 + 2] = a[2] / l;
  }
  geometry.setAttribute('smoothNormal', new THREE.BufferAttribute(out, 3));
}

const OUTLINE_LAYER = 1;

export function createToonPipeline(
  THREE: any,
  renderer: any,
  scene: any,
  camera: any,
  modelRoot: any,
  opts: ToonOptions = {},
): ToonPipeline {
  const classify = opts.classify ?? classifyMaterial;
  const styles: Record<ToonKind, ToonStyle> = { ...DEFAULT_STYLES };
  for (const k of Object.keys(opts.styles ?? {}) as ToonKind[]) {
    styles[k] = { ...styles[k], ...(opts.styles![k] as ToonStyle) };
  }
  const useOutline = opts.outline !== false;
  const useDepthRim = opts.depthRim !== false;

  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // ---------- 共享 uniforms ----------
  const size = new THREE.Vector2();
  renderer.getDrawingBufferSize(size);
  const shared = {
    uLightDir: { value: new THREE.Vector3(...(opts.lightDir ?? [-0.45, 0.65, 0.75])).normalize() },
    uViewLightDir: { value: new THREE.Vector3() },
    uLightColor: { value: new THREE.Color(opts.lightColor ?? '#ffffff') },
    uHeadCenter: { value: new THREE.Vector3() },
    uHeadForward: { value: new THREE.Vector3(0, 0, 1) },
    uResolution: { value: size.clone() },
    uSceneDepth: { value: null as any },
    uCameraNear: { value: camera.near },
    uCameraFar: { value: camera.far },
  };

  // ---------- 深度预渲染目标（屏幕空间边缘光用） ----------
  let depthRT: any = null;
  const makeDepthRT = (w: number, h: number) => {
    if (depthRT) depthRT.dispose();
    const dt = new THREE.DepthTexture(w, h);
    dt.type = THREE.UnsignedIntType;
    depthRT = new THREE.WebGLRenderTarget(w, h, { depthTexture: dt, depthBuffer: true });
    shared.uSceneDepth.value = dt;
  };
  if (useDepthRim) makeDepthRT(size.x, size.y);
  const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false });

  // ---------- 材质替换 ----------
  const created: any[] = [];
  const outlines: any[] = [];
  const meshes: any[] = [];
  modelRoot.traverse((o: any) => {
    if (o.isMesh) meshes.push(o);
  });

  for (const mesh of meshes) {
    const srcMats: any[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const toonMats: any[] = [];
    const outlineMats: any[] = [];
    srcMats.forEach((m: any) => {
      const mmd = m.userData?.MMD ?? {};
      const kind = classify(m.name ?? '', mmd.mapFileName ?? '');
      const st = styles[kind];
      const hasSph = kind === 'hair' && !!m.matcap && st.spec > 0;
      // MMDLoader 的透明度检测要等贴图加载完才回写 m.transparent，这里不能依赖它：
      //  - 五官贴花（眉毛/睫毛/口腔等 unlit）用 alpha 混合，边缘柔和
      //  - 其余一律 alpha 0.5 硬裁切 + 输出不透明（发梢/毛边硬切更符合赛璐璐风格，也免去排序问题）
      const blend = kind === 'unlit';
      const alphaTest = blend ? 0.01 : 0.5;
      const mat = new THREE.ShaderMaterial({
        name: `toon:${m.name}`,
        vertexShader: TOON_VERT,
        fragmentShader: TOON_FRAG,
        uniforms: {
          ...shared,
          uKind: { value: KIND_ID[kind] },
          uMap: { value: m.map ?? null },
          uHasMap: { value: !!m.map },
          uDiffuse: { value: new THREE.Vector4(m.color?.r ?? 1, m.color?.g ?? 1, m.color?.b ?? 1, m.opacity ?? 1) },
          uAlphaTest: { value: alphaTest },
          uOpaque: { value: !blend },
          uShadowTint: { value: new THREE.Color(st.shadowTint) },
          uShadowThreshold: { value: kind === 'face' ? 0.42 : 0.5 },
          uShadowSoftness: { value: kind === 'face' ? 0.02 : 0.035 },
          uFaceFlatten: { value: 0.45 },
          uSph: { value: hasSph ? m.matcap : null },
          uHasSph: { value: hasSph },
          uSpecStrength: { value: st.spec },
          uUseDepthRim: { value: useDepthRim && st.rim > 0 },
          uRimWidth: { value: 2.0 * renderer.getPixelRatio() },
          uRimThreshold: { value: 0.08 },
          uRimStrength: { value: st.rim },
          uRimColor: { value: new THREE.Color('#ffffff') },
        },
        transparent: blend,
        side: m.side,
        depthWrite: true,
      });
      // 告诉 three 这里用了 uv（ShaderMaterial 默认就声明 uv 属性）
      created.push(mat);
      toonMats.push(mat);

      if (useOutline && st.outlineWidth > 0) {
        const om = new THREE.ShaderMaterial({
          name: `outline:${m.name}`,
          vertexShader: OUTLINE_VERT,
          fragmentShader: OUTLINE_FRAG,
          uniforms: {
            uResolution: shared.uResolution,
            uOutlineWidth: { value: st.outlineWidth * renderer.getPixelRatio() },
            uMap: { value: m.map ?? null },
            uHasMap: { value: !!m.map },
            uDiffuse: { value: new THREE.Vector4(m.color?.r ?? 1, m.color?.g ?? 1, m.color?.b ?? 1, m.opacity ?? 1) },
            uOutlineTint: { value: new THREE.Color(st.outlineTint) },
            uAlphaTest: { value: alphaTest },
          },
          side: THREE.BackSide,
        });
        created.push(om);
        outlineMats.push(om);
      } else {
        // 占位：不画（visible=false 的材质在多材质 group 中会被跳过）
        const hidden = new THREE.MeshBasicMaterial({ visible: false });
        created.push(hidden);
        outlineMats.push(hidden);
      }
    });
    mesh.material = Array.isArray(mesh.material) ? toonMats : toonMats[0];

    if (useOutline && mesh.isSkinnedMesh) {
      const geo = mesh.geometry;
      if (!geo.attributes.smoothNormal) computeSmoothNormals(THREE, geo);
      const ol = new THREE.SkinnedMesh(geo, Array.isArray(mesh.material) ? outlineMats : outlineMats[0]);
      ol.name = `${mesh.name}__outline`;
      ol.bind(mesh.skeleton, mesh.bindMatrix);
      ol.bindMode = mesh.bindMode;
      ol.morphTargetInfluences = mesh.morphTargetInfluences; // 共享表情权重
      ol.morphTargetDictionary = mesh.morphTargetDictionary;
      ol.frustumCulled = false;
      ol.layers.set(OUTLINE_LAYER);
      ol.renderOrder = -1;
      mesh.parent.add(ol);
      ol.position.copy(mesh.position);
      ol.quaternion.copy(mesh.quaternion);
      ol.scale.copy(mesh.scale);
      outlines.push(ol);
    }
  }
  camera.layers.enable(OUTLINE_LAYER);

  // ---------- 每帧 ----------
  const tmpQ = new THREE.Quaternion();
  const tmpV = new THREE.Vector3();
  const modelQ = new THREE.Quaternion();
  const viewL = shared.uViewLightDir.value;

  const updateUniforms = () => {
    const head = opts.head;
    if (head) {
      head.getWorldPosition(shared.uHeadCenter.value);
      // 头骨原点在脖子根部，面部中心大约在其上方一点
      modelRoot.getWorldQuaternion(modelQ);
      const scale = modelRoot.scale?.y ?? 1;
      head.getWorldQuaternion(tmpQ);
      tmpV.set(0, 1.2 * scale, 0).applyQuaternion(tmpQ);
      shared.uHeadCenter.value.add(tmpV);
      // 头部前向：PMX 模型正面朝 -Z（MMD 约定），经 MMDLoader 转换后通常朝 +Z
      shared.uHeadForward.value.set(0, 0, 1).applyQuaternion(tmpQ).normalize();
    } else {
      modelRoot.getWorldPosition(shared.uHeadCenter.value);
      shared.uHeadCenter.value.y += 1.4;
    }
    viewL.copy(shared.uLightDir.value).transformDirection(camera.matrixWorldInverse);
    shared.uCameraNear.value = camera.near;
    shared.uCameraFar.value = camera.far;
  };

  const render = () => {
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    updateUniforms();
    if (useDepthRim && depthRT) {
      const prevOverride = scene.overrideMaterial;
      const prevMask = camera.layers.mask;
      const prevClear = renderer.getClearAlpha();
      camera.layers.set(0);
      scene.overrideMaterial = depthMat;
      renderer.setRenderTarget(depthRT);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      scene.overrideMaterial = prevOverride;
      camera.layers.mask = prevMask;
      renderer.setClearAlpha(prevClear);
    }
    renderer.render(scene, camera);
  };

  const setSize = (w: number, h: number) => {
    renderer.getDrawingBufferSize(size);
    shared.uResolution.value.copy(size);
    if (useDepthRim) makeDepthRT(size.x, size.y);
    void w;
    void h;
  };

  const setLightDir = (x: number, y: number, z: number) => {
    shared.uLightDir.value.set(x, y, z).normalize();
  };

  const dispose = () => {
    for (const ol of outlines) ol.parent?.remove(ol);
    for (const m of created) m.dispose();
    depthMat.dispose();
    depthRT?.dispose();
  };

  return { render, setSize, setLightDir, dispose };
}
