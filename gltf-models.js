/* =====================================================================
   MATH DUNGEON — glTF MODEL ADAPTER
   ---------------------------------------------------------------------
   Lets real downloaded 3D models (.glb) stand in for the procedural
   box-and-cylinder characters in models.js, without any other part of
   the game knowing the difference.

   FOUR PROBLEMS THIS SOLVES, because a .glb cannot just be dropped in:

   1. file:// AND CORS
      The game is opened straight off disk. Browsers block fetch/XHR on
      file://, so a plain GLTFLoader.load("knight.glb") fails silently
      there while working fine over the local server. Every model is
      therefore registered as a base64 data URI and parsed from an
      ArrayBuffer, which is the same trick tiles.js already uses for the
      wall textures. Cost is about 33% size inflation; the payoff is the
      folder stays one self-contained thing you can double-click.

   2. MATERIALS GO BLACK
      D3's scene has NO lights in it. Everything is drawn by hand-written
      shaders with a torch term. A .glb arrives wearing MeshStandardMaterial,
      which needs lights, so it would render pure black. Every material is
      swapped for the torch-lit model shader, keeping the glb's base colour
      map and colour factor.

   3. SCALE AND FACING ARE ARBITRARY
      Artists export at any size, on any axis, facing any direction. Each
      model is measured, uniformly scaled to a target height, dropped so
      its feet sit on y=0, and yawed so it faces -Z like the procedural rig.

   4. ANIMATION MAY OR MAY NOT EXIST
      If the glb ships clips, the walk/idle pair is found by name and
      cross-faded on movement. If it ships none, the model still renders,
      it just will not have legs that move, and getInfo() reports that
      honestly rather than pretending.

   If GLTFLoader is missing, a model fails to parse, or an id is not
   registered, build() falls back to the procedural model of the same
   name so the game never boots into an empty dungeon.

   API
     GLTFModels.available()          -> is GLTFLoader actually loaded?
     GLTFModels.register(def)        -> add a model
     GLTFModels.list()               -> [{id,name,blurb,source,license}]
     GLTFModels.build(id, mk, mkTex) -> Promise<{group, update, info}>
   ===================================================================== */
const GLTFModels = (function () {
  "use strict";

  const REG = {};
  let loader = null;

  const available = () =>
    typeof THREE !== "undefined" && typeof THREE.GLTFLoader === "function";

  /* def = {
       id, name, blurb,
       src,                     // "data:model/gltf-binary;base64,..." or a URL
       height,                  // target height in cells (default 0.90)
       yaw,                     // extra Y rotation, radians, if it faces wrong
       clips: {walk, idle},     // optional clip-name overrides
       source, license          // provenance, shown in the picker
     } */
  function register(def) {
    if (!def || !def.id) throw new Error("GLTFModels.register needs an id");
    REG[def.id] = Object.assign({ height: 0.90, yaw: 0 }, def);
    return def.id;
  }

  const list = () => Object.keys(REG).map(id => ({
    id: id, name: REG[id].name, blurb: REG[id].blurb,
    source: REG[id].source || "unknown", license: REG[id].license || "unverified"
  }));

  /* base64 data URI -> ArrayBuffer, so parse() can be used instead of
     load() and nothing ever touches the network or the file system */
  function dataURIToBuffer(uri) {
    const comma = uri.indexOf(",");
    const b64 = uri.slice(comma + 1);
    const bin = atob(b64);
    const buf = new ArrayBuffer(bin.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
    return buf;
  }

  function parse(src) {
    if (!loader) loader = new THREE.GLTFLoader();
    return new Promise((resolve, reject) => {
      try {
        if (/^data:/.test(src)) loader.parse(dataURIToBuffer(src), "", resolve, reject);
        else loader.load(src, resolve, undefined, reject);
      } catch (e) { reject(e); }
    });
  }

  /* Swap every PBR material for the torch-lit shader, carrying across the
     base colour map and colour factor so the model keeps its look. */
  function relight(root, mkTex) {
    if (!mkTex) return;
    root.traverse(o => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const swapped = mats.map(m => {
        const map = m.map || null;
        const col = m.color ? m.color.getHex() : 0xffffff;
        return mkTex(col, map);
      });
      o.material = Array.isArray(o.material) ? swapped : swapped[0];
      o.frustumCulled = false;
    });
  }

  /* Measure, then normalise: uniform scale to the target height, feet on
     the floor, centred on the origin in x/z. */
  /* Measure the model the way it will actually RENDER.
     Box3.setFromObject walks node transforms, but a skinned vertex is not
     placed by its node's matrix: it is placed by the skeleton. glTF rigs
     routinely carry a bone group with a large scale (RobotExpressive has
     one at scale 100), so setFromObject reported 149 units for a model
     that draws about 1.5, and the auto-fit then shrank it a hundredfold
     into a dot on the floor. For skinned meshes the geometry box is
     already in bind/root space, so use it directly; only static meshes
     get their node transform applied. */
  function measure(root) {
    root.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const box = new THREE.Box3();
    let any = false;
    root.traverse(o => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      if (!o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      if (!o.geometry.boundingBox) return;
      const b = o.geometry.boundingBox.clone();
      if (!o.isSkinnedMesh) b.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      box.union(b);
      any = true;
    });
    return any ? box : new THREE.Box3().setFromObject(root);
  }

  function normalise(root, def) {
    const box = measure(root);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const h = size.y || 1;
    const s = def.height / h;

    const holder = new THREE.Group();
    root.scale.setScalar(s);
    root.position.set(-centre.x * s, -box.min.y * s, -centre.z * s);
    root.rotation.y = def.yaw || 0;
    holder.add(root);
    return { holder: holder, fitScale: s, rawHeight: h };
  }

  /* Find a clip by a list of name fragments, case-insensitive. */
  function findClip(clips, wanted) {
    if (!clips || !clips.length) return null;
    for (const w of wanted) {
      const hit = clips.find(c => c.name.toLowerCase().indexOf(w) !== -1);
      if (hit) return hit;
    }
    return null;
  }

  async function build(id, mkProcedural, mkTex) {
    const def = REG[id];

    /* every failure path lands on the procedural model of the same name,
       so a missing loader or a bad file is a downgrade, never a crash */
    const fallback = (why) => {
      const m = (typeof MODELS !== "undefined" && MODELS)
        ? MODELS.buildCharacter(id, mkProcedural) : null;
      if (!m) throw new Error("no model available for " + id + " (" + why + ")");
      m.info = { kind: "procedural", animated: true, reason: why };
      return m;
    };

    if (!available()) return fallback("GLTFLoader not loaded");
    if (!def) return fallback("id not registered");

    let gltf;
    try { gltf = await parse(def.src); }
    catch (e) { return fallback("parse failed: " + (e && e.message ? e.message : e)); }

    const root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
    if (!root) return fallback("glb contained no scene");

    relight(root, mkTex);
    const n = normalise(root, def);

    // ---- animation ----
    const clips = gltf.animations || [];
    const names = (def.clips || {});
    const walkClip = findClip(clips, [names.walk, "walk", "run", "move"].filter(Boolean));
    const idleClip = findClip(clips, [names.idle, "idle", "stand", "breath"].filter(Boolean));
    let mixer = null, walk = null, idle = null;
    if (clips.length) {
      mixer = new THREE.AnimationMixer(root);
      if (walkClip) { walk = mixer.clipAction(walkClip); walk.play(); walk.setEffectiveWeight(0); }
      if (idleClip) { idle = mixer.clipAction(idleClip); idle.play(); idle.setEffectiveWeight(1); }
      if (!walk && !idle && clips[0]) { idle = mixer.clipAction(clips[0]); idle.play(); }
    }

    let last = 0;
    return {
      group: n.holder,
      info: {
        kind: "gltf", animated: !!clips.length,
        clips: clips.map(c => c.name),
        fitScale: +n.fitScale.toFixed(4), rawHeight: +n.rawHeight.toFixed(3),
        source: def.source || "unknown", license: def.license || "unverified"
      },
      update(t, moveAmt) {
        const m = Math.max(0, Math.min(1, moveAmt || 0));
        const dt = last ? Math.min(0.1, t - last) : 0.016;
        last = t;
        if (mixer) {
          if (walk) walk.setEffectiveWeight(m);
          if (idle) idle.setEffectiveWeight(1 - m);
          mixer.update(dt);
        }
      }
    };
  }

  return { available, register, list, build,
           get count() { return Object.keys(REG).length; } };
})();
if (typeof window !== "undefined") window.GLTFModels = GLTFModels;
