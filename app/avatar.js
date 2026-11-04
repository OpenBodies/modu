// Modu 小手机: his VRM avatar inside the video call. The three.js + three-vrm code of ../face/index.html,
// made mountable: mount(host, url) draws him into `host` (transparent, so the call's wallpaper shows
// behind) and returns { setEmotion(label), setTalking(on), dispose() }. It rejects if the model or the
// libraries cannot load; the call then shows his picture instead. No logic about him lives here: the
// page tells it his mood (from core.js) and when his voice is playing.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// core.js mood labels → the VRM's standard expressions
const EMO = { joy:'happy', sadness:'sad', anger:'angry', surprise:'surprised', relief:'relaxed', neutral:'neutral' };

export function mount(host, url, opts = {}){
  return new Promise((resolve, reject) => {
    const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true, preserveDrawingBuffer:true });
    renderer.setClearColor(0x000000, 0);   // preserve: lets a screenshot read the canvas
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 20);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xfff4e6, 0.95));
    const key = new THREE.DirectionalLight(0xffe2bd, 1.15); key.position.set(-0.8, 1.6, 1.4); scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.45); rim.position.set(1, 1.2, -1); scene.add(rim);
    const lookTarget = new THREE.Object3D(); camera.add(lookTarget); scene.add(camera);
    let vrm = null, alive = true, raf = 0, headY = 1.4;
    function fit(){
      const w = host.clientWidth || 1, h = host.clientHeight || 1;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      // head and shoulders, the face in the upper third (a call), or the whole bust (a portrait card)
      const d = opts.portrait ? 1.45 : 2.2;
      camera.position.set(0, headY + 0.02, d); camera.lookAt(0, headY - (opts.portrait ? 0.08 : 0.08), 0);
    }
    const ro = new ResizeObserver(fit); ro.observe(host);

    const target = { happy:0, angry:0, sad:0, relaxed:0, surprised:0 };
    let talking = false, emoUntil = 0;
    const loader = new GLTFLoader(); loader.register(p => new VRMLoaderPlugin(p));
    loader.load(url, gltf => {
      if (!alive) return;
      vrm = gltf.userData.vrm;
      if (VRMUtils.combineSkeletons) VRMUtils.combineSkeletons(gltf.scene); else VRMUtils.removeUnnecessaryJoints(gltf.scene);
      scene.add(vrm.scene);
      const v1 = vrm.meta && vrm.meta.metaVersion === '1';
      vrm.scene.rotation.y = v1 ? 0 : Math.PI;
      if (vrm.lookAt) vrm.lookAt.target = lookTarget;
      // arms down at the sides; VRM 0.x models are turned around (above), so their arms turn the other way
      const k = v1 ? 1 : -1, arm = { leftUpperArm:-1.2, rightUpperArm:1.2, leftLowerArm:0, rightLowerArm:0 };
      for (const [b, rz] of Object.entries(arm)) { const n = vrm.humanoid && vrm.humanoid.getNormalizedBoneNode(b); if (n) n.rotation.z = rz * k; }
      vrm.update(0);
      const head = vrm.humanoid && vrm.humanoid.getNormalizedBoneNode('head');
      if (head) headY = head.getWorldPosition(new THREE.Vector3()).y;
      fit();
      resolve(api);
    }, undefined, e => { dispose(); reject(e); });

    let last = performance.now(), t = 0, nextBlink = 2, blinkT = -1;
    function frame(){
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      const now = performance.now(), dt = Math.min((now - last) / 1000, 0.05); last = now; t += dt;
      if (vrm){
        const em = vrm.expressionManager;
        if (em){
          if (performance.now() > emoUntil) for (const k in target) target[k] = 0;
          for (const k in target){ const cur = em.getValue(k) || 0; em.setValue(k, cur + (target[k] - cur) * Math.min(1, dt * 6)); }
          nextBlink -= dt; if (nextBlink <= 0){ blinkT = 0; nextBlink = 2 + Math.random() * 4; }
          if (blinkT >= 0){ blinkT += dt; em.setValue('blink', blinkT < 0.08 ? blinkT / 0.08 : Math.max(0, 1 - (blinkT - 0.08) / 0.1)); if (blinkT > 0.2) blinkT = -1; }
          em.setValue('aa', talking ? 0.2 + 0.3 * Math.abs(Math.sin(t * 9)) * (0.6 + 0.4 * Math.sin(t * 3.1)) : 0);
        }
        const h = vrm.humanoid;
        if (h){
          const spine = h.getNormalizedBoneNode('spine'), head = h.getNormalizedBoneNode('head');
          if (spine) spine.rotation.x = 0.015 * Math.sin(t * 1.2);
          if (head) { head.rotation.y = 0.06 * Math.sin(t * 0.35); head.rotation.x = 0.02 * Math.sin(t * 0.7); head.rotation.z = 0.02 * Math.sin(t * 0.5); }
        }
        lookTarget.position.set(0.12 * Math.sin(t * 0.23), 0.04 * Math.sin(t * 0.31), 0);
        vrm.update(dt);
      }
      renderer.render(scene, camera);
    }
    frame();

    function dispose(){
      alive = false; cancelAnimationFrame(raf); ro.disconnect();
      if (vrm) { scene.remove(vrm.scene); VRMUtils.deepDispose(vrm.scene); }
      renderer.dispose(); renderer.domElement.remove();
    }
    const api = {
      setEmotion(label){
        const e = EMO[label] || 'neutral';
        for (const k in target) target[k] = 0; if (e !== 'neutral') target[e] = 0.75;
        emoUntil = performance.now() + 8000;
      },
      setTalking(on){ talking = !!on; },
      dispose,
    };
  });
}
