// AppBacked 3D mark: a glossy app tile with a coin rising behind it (the logo, in the round).
// - setIcon(url) flips the tile and reveals the developer's real app icon (App Store artwork is CORS-enabled).
// - Renders only while something moves and the canvas is on screen; honours prefers-reduced-motion.
// - snapshot(w, h, opts) returns a PNG data URL (used by the brand studio to export backgrounds).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const INK = 0x0d0d12;
const BLUE = 0x2230e6;

function superellipseShape(w, n = 5, steps = 256) {
  const a = w / 2;
  const shape = new THREE.Shape();
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    const x = a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    const y = a * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  return shape;
}

function coinGeometry(R, half) {
  const rim = half * 0.32;
  const p = [];
  const V = (x, y) => p.push(new THREE.Vector2(x, y));
  V(0.0001, half - rim);
  V(R * 0.78, half - rim);
  V(R * 0.80, half);
  // rounded outer edge
  const er = half * 0.9, cx = R - er;
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI / 2 - (i / 12) * Math.PI;
    V(cx + Math.cos(a) * er, Math.sin(a) * half);
  }
  V(R * 0.80, -half);
  V(R * 0.78, -(half - rim));
  V(0.0001, -(half - rim));
  const g = new THREE.LatheGeometry(p.reverse(), 160);
  g.rotateX(Math.PI / 2);
  return g;
}

const ease = {
  outCubic: t => 1 - Math.pow(1 - t, 3),
  outBack: t => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  inOut: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

export function createBacked(container, opts = {}) {
  const o = Object.assign({
    coin: 'ceramic',          // ceramic | blue | chrome
    tile: 'ink',              // ink | white
    background: null,         // null = transparent canvas
    shadowOpacity: 0.26,
    interactive: true,
    intro: true,
    float: true,
    maxPixelRatio: 1.75,
    pose: { ry: -0.32, rx: 0.14 },
    fov: 26,
    distance: 10.5,
  }, opts);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: !o.background, powerPreference: 'high-performance' });
  } catch (e) {
    return null;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, o.maxPixelRatio));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  if (o.background) renderer.setClearColor(o.background, 1); else renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(o.fov, 1, 0.1, 100);
  camera.position.set(0, 0, o.distance);

  // lights
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(-3.2, 4.2, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 14;
  key.shadow.blurSamples = 20;
  key.shadow.bias = -0.0004;
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 25 });
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xdfe4ff, 1.4);
  rim.position.set(3.5, 3, -5);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6);
  fill.position.set(5, -2, 4);
  scene.add(fill);

  // backdrop that only shows shadows
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: o.shadowOpacity, color: 0x000000 }));
  backdrop.position.z = -1.35;
  backdrop.receiveShadow = true;
  scene.add(backdrop);

  // ---- the mark ----
  // design box: app W=60.2 at (40,60), coin R=30 at (66,34) -> 1 unit = 1.8/60.2
  const U = 1.8 / 60.2;
  const group = new THREE.Group();
  scene.add(group);

  const appW = 60.2 * U;
  const depth = 0.24, bevelT = 0.07, bevelS = 0.05;
  const shape = superellipseShape(appW - bevelS * 2);
  const tileGeo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevelT, bevelSize: bevelS, bevelSegments: 10, curveSegments: 1, steps: 1 });
  tileGeo.translate(0, 0, -depth / 2);
  tileGeo.computeVertexNormals();
  const TILE = o.tile === 'white' ? 0xf4f3ef : INK;
  const tileMat = new THREE.MeshPhysicalMaterial({ color: TILE, roughness: 0.42, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 0.22 });
  const tile = new THREE.Mesh(tileGeo, tileMat);
  tile.castShadow = true;

  const faceGeo = new THREE.ShapeGeometry(shape, 1);
  faceGeo.computeBoundingBox();
  {
    const bb = faceGeo.boundingBox, pos = faceGeo.attributes.position, uv = faceGeo.attributes.uv;
    const w = bb.max.x - bb.min.x, h = bb.max.y - bb.min.y;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - bb.min.x) / w, (pos.getY(i) - bb.min.y) / h);
    uv.needsUpdate = true;
  }
  const faceMat = new THREE.MeshPhysicalMaterial({ color: TILE, roughness: 0.38, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: o.tile === 'white' ? 0.6 : 0.22 });
  if (o.tile === 'white') tileMat.envMapIntensity = 0.6;
  const face = new THREE.Mesh(faceGeo, faceMat);
  face.position.z = depth / 2 + bevelT + 0.002;
  const back = face.clone();
  back.material = tileMat;
  back.rotation.y = Math.PI;
  back.position.z = -(depth / 2 + bevelT + 0.002);

  const app = new THREE.Group();
  app.add(tile, face, back);
  const appHome = new THREE.Vector3((40 - 53) * U, -(60 - 47) * U, 0.0);
  app.position.copy(appHome);

  const R = 30 * U;
  const coinMat = {
    ceramic: new THREE.MeshPhysicalMaterial({ color: 0xf3f2ee, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 0.7 }),
    blue: new THREE.MeshPhysicalMaterial({ color: BLUE, roughness: 0.38, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 0.35 }),
    chrome: new THREE.MeshPhysicalMaterial({ color: 0xe9ebf2, roughness: 0.16, metalness: 1, clearcoat: 0.6 }),
  }[o.coin] || null;
  const coin = new THREE.Mesh(coinGeometry(R, 0.12), coinMat);
  coin.castShadow = true;
  const coinHome = new THREE.Vector3((66 - 53) * U, -(34 - 47) * U, -0.42);
  coin.position.copy(coinHome);

  group.add(coin, app);
  group.rotation.set(o.pose.rx, o.pose.ry, 0);

  // ---- state & loop ----
  let W = 1, H = 1, visible = true, raf = 0, last = 0;
  let clock = 0;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const anims = [];
  const introOn = o.intro && !reduce;
  let introT = introOn ? 0 : 1;
  let swapTo = null, swapped = true;

  function resize() {
    const r = container.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    // keep the object filling ~70% of the shorter side
    const fit = Math.min(1, camera.aspect / 0.95);
    camera.position.z = o.distance / Math.max(0.62, fit);
    camera.updateProjectionMatrix();
    kick();
  }

  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now;
    clock += dt;
    let moving = false;

    if (introT < 1) {
      introT = Math.min(1, introT + dt / 1.5);
      const k = ease.outBack(Math.min(1, introT * 1.05));
      coin.position.lerpVectors(appHome.clone().setZ(-0.42), coinHome, k);
      coin.scale.setScalar(0.55 + 0.45 * ease.outCubic(introT));
      app.scale.setScalar(0.94 + 0.06 * ease.outCubic(introT));
      moving = true;
    }

    for (let i = anims.length - 1; i >= 0; i--) {
      const a = anims[i];
      a.t = Math.min(1, a.t + dt / a.dur);
      a.step(a.t);
      if (a.t >= 1) { anims.splice(i, 1); a.done && a.done(); } else moving = true;
    }

    pointer.x += (pointer.tx - pointer.x) * 0.06;
    pointer.y += (pointer.ty - pointer.y) * 0.06;
    if (Math.abs(pointer.tx - pointer.x) > 0.001 || Math.abs(pointer.ty - pointer.y) > 0.001) moving = true;
    group.rotation.y = o.pose.ry + pointer.x * 0.28;
    group.rotation.x = o.pose.rx + pointer.y * 0.16;

    if (o.float && !reduce) {
      group.position.y = Math.sin(clock * 0.9) * 0.06;
      coin.rotation.z = Math.sin(clock * 0.6) * 0.08;
      moving = true;
    }

    renderer.render(scene, camera);
    if (moving && visible) raf = requestAnimationFrame(frame);
  }

  function kick() {
    if (!raf && visible) { last = 0; raf = requestAnimationFrame(frame); }
  }

  const ro = new ResizeObserver(resize);
  ro.observe(container);
  const io = new IntersectionObserver(es => { visible = es[0].isIntersecting && !document.hidden; if (visible) kick(); }, { threshold: 0.01 });
  io.observe(container);
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; if (visible) kick(); });
  if (o.interactive && matchMedia('(pointer: fine)').matches) {
    addEventListener('pointermove', e => {
      pointer.tx = (e.clientX / innerWidth - 0.5) * 2;
      pointer.ty = (e.clientY / innerHeight - 0.5) * 2;
      kick();
    }, { passive: true });
  }
  resize();

  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');

  function applyFace(tex) {
    if (tex) {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      faceMat.map = tex;
      faceMat.emissiveMap = tex;
      faceMat.emissive.set(0xffffff);
      faceMat.emissiveIntensity = 0.55;
      faceMat.color.set(0xffffff);
      faceMat.roughness = 0.45; faceMat.envMapIntensity = 0.35;
    } else {
      faceMat.map = null;
      faceMat.emissiveMap = null;
      faceMat.emissive.set(0x000000);
      faceMat.color.set(TILE);
      faceMat.roughness = 0.38; faceMat.envMapIntensity = 0.22;
    }
    faceMat.needsUpdate = true;
  }

  function flipTo(tex) {
    const start = app.rotation.y;
    swapped = false;
    anims.push({
      t: 0, dur: reduce ? 0.01 : 1.1,
      step: t => {
        const k = ease.inOut(t);
        app.rotation.y = start + k * Math.PI * 2;
        app.position.z = appHome.z + Math.sin(k * Math.PI) * 1.1;
        if (!swapped && k >= 0.25) { applyFace(tex); swapped = true; }
        coin.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.08);
      },
      done: () => { app.rotation.y = 0; app.position.z = appHome.z; },
    });
    kick();
  }

  return {
    renderer, scene, camera,
    setIcon(url) {
      if (!url) { flipTo(null); return Promise.resolve(true); }
      return new Promise(res => {
        loader.load(url, tex => { flipTo(tex); res(true); }, undefined, () => res(false));
      });
    },
    settle() {
      introT = 1; coin.position.copy(coinHome); coin.scale.setScalar(1); app.scale.setScalar(1);
      while (anims.length) { const a = anims.pop(); a.step(1); a.done && a.done(); }
      renderer.render(scene, camera);
    },
    setPose(p) { Object.assign(o.pose, p); kick(); },
    snapshot(w, h, s = {}) {
      const prev = { w: W, h: H, pr: renderer.getPixelRatio() };
      this.settle();
      group.position.y = 0; coin.rotation.z = 0;
      if (s.pose) { group.rotation.x = s.pose.rx; group.rotation.y = s.pose.ry; }
      if (s.offset) { group.position.x = s.offset.x || 0; group.position.y = s.offset.y || 0; }
      const fovPrev = camera.fov;
      if (s.zoom) { camera.fov = fovPrev / s.zoom; }
      if (s.background) renderer.setClearColor(s.background, 1);
      renderer.setPixelRatio(1);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      const url = renderer.domElement.toDataURL('image/png');
      // restore
      camera.fov = fovPrev;
      group.position.set(0, 0, 0);
      if (s.background) { if (o.background) renderer.setClearColor(o.background, 1); else renderer.setClearColor(0, 0); }
      renderer.setPixelRatio(prev.pr);
      resize();
      return url;
    },
    dispose() { ro.disconnect(); io.disconnect(); cancelAnimationFrame(raf); renderer.dispose(); container.removeChild(renderer.domElement); },
  };
}
