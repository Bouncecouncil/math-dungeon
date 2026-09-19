/* =====================================================================
   MATH DUNGEON — N64-era 3D renderer  (v2)
   ---------------------------------------------------------------------
   Draws the world as real textured geometry in WebGL. The 2D canvas on
   top is now HUD-only (weapon, beams, particles, crosshair): every
   creature, door, ring and the hero avatar live in the 3D scene with a
   real depth buffer.

   WHAT CHANGED IN v2, AND WHY
   ---------------------------------------------------------------------
   1. SPRITES MOVED INTO THE 3D SCENE.
      v1 drew monsters on the 2D canvas and faked occlusion with a
      per-column test against the raycaster's depth[] array, comparing
      every column of a wide emoji against the sprite's CENTRE distance.
      A brute sweep of every walkable cell x 16 headings found positions
      where a monster with no line of sight was still painted on screen,
      and monsters standing near a wall always spilled over the stone
      because the drawn emoji is far wider than the 0.27 collision
      radius. Billboards with a real z-buffer cannot do either.

   2. DOORS ARE DYNAMIC AND ACTUALLY OPEN.
      v1 baked door slabs into the static level mesh at load time. When
      the player solved a lock the game called doors.delete(key), which
      flipped collision to walkable but never rebuilt the geometry, so
      the slab stayed on screen forever and the player walked through a
      door that visibly never opened. Doors are now their own meshes
      that grind upward into the ceiling over 0.9s and stay solid until
      the animation finishes.

   3. THIRD-PERSON CAMERA.
      setView("third") swings the camera onto a collision-aware boom
      behind the hero and spawns a hero billboard. project() reads the
      live camera matrix, so beams, rings and particles follow.

   The era look, unchanged from v1:
     1. affine (screen-linear) texture mapping  -> the PS1 "swimming" warp
     2. vertex snapping to a coarse grid        -> geometry wobble
     3. 480x300 internal resolution, upscaled   -> chunky pixels
     4. distance fog to black                   -> Tomb Raider corridors
     5. colour quantisation to 32 steps         -> 16-bit banding
   ===================================================================== */
const D3 = (function () {
  if (typeof THREE === "undefined" || typeof TILES === "undefined") return null;

  const RES_W = 480, RES_H = 300;   // internal render size (CSS-upscaled, pixelated)
  const CEIL  = 1.35;               // room height in cells
  const EYE   = 0.38;               // first-person eye height
  const SNAP  = 110.0;              // vertex-snap grid (lower = more wobble)
  const VREP  = 1.1;                // world units per vertical texture repeat

  const aspect = RES_W / RES_H;
  const vFov   = 2 * Math.atan(0.66 / aspect) * 180 / Math.PI;
  let renderer = null, scene = null, camera = null, ready = false, failed = false;

  function ensure() {
    if (ready) return true;
    if (failed) return false;
    const cvs = document.getElementById("view3d");
    if (!cvs) return false;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: cvs, antialias: false, alpha: false, preserveDrawingBuffer: true });
    } catch (e) { failed = true; console.error("D3: WebGL unavailable", e); return false; }
    renderer.setPixelRatio(1);
    renderer.setSize(RES_W, RES_H, false);
    renderer.sortObjects = true;               // renderOrder puts world, rings, then sprites
    scene  = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(vFov, aspect, 0.02, 40);

    /* Lights, purely for imported glTF models.
       The dungeon itself is drawn by hand-written shaders that ignore
       lights entirely, so these cost nothing there. They exist because a
       rigged .glb arrives wearing MeshStandardMaterial: the first attempt
       swapped those out for the torch shader, which silently broke
       skinning (a custom ShaderMaterial has none of three's skinning
       chunks, so the mesh rendered in bind pose). Keeping the model's own
       materials and giving them something to be lit BY is both simpler
       and truer to how the model was authored. */
    heroLightAmb = new THREE.HemisphereLight(0x8899cc, 0x241d16, 1.05);
    scene.add(heroLightAmb);
    heroTorch = new THREE.PointLight(0xffd7a0, 3.2, 7.5, 1.6);
    scene.add(heroTorch);
    heroKey = new THREE.DirectionalLight(0xfff0d8, 0.85);
    heroKey.position.set(0.4, 1.0, 0.6);
    scene.add(heroKey);
    ready  = true;
    return true;
  }

  /* ---------- per-level art direction ----------
     Palettes pulled toward Cryo's Dune: narrow and warm rather than
     full-spectrum. Torch amber against a single cold shadow hue reads
     as one place; RGB-everywhere reads as a tech demo.                */
  const ART = [
    // L1 "The Crystal Cave" — cold blue stone lit by warm torchlight
    { w1: "stone", w2: "moss",  fl: "floor", ce: "ceil", fog: 0x04060d,
      torch: [1.00, 0.86, 0.62], tint: 0x9fb0d8, near: 1.0, far: 9.5 },
    // L2 overgrown ruin — damp green, colder torch
    { w1: "moss",  w2: "stone", fl: "floor", ce: "ceil", fog: 0x040d09,
      torch: [0.98, 0.94, 0.70], tint: 0xbcd2ae, near: 1.0, far: 9.0 },
    // L3 desert tomb — ochre and filtered light, the Dune register
    { w1: "sand",  w2: "gold",  fl: "lava",  ce: "ceil", fog: 0x120602,
      torch: [1.00, 0.72, 0.36], tint: 0xecc98e, near: 1.1, far: 10.5 }
  ];
  const art = () => ART[Math.max(0, Math.min(ART.length - 1, (typeof S !== "undefined" ? S.level : 0)))];

  /* ---------- textures ---------- */
  const texCache = {};
  function tex(key) {
    if (texCache[key]) return texCache[key];
    const t = new THREE.TextureLoader().load(TILES[key]);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    texCache[key] = t;
    return t;
  }

  /* ---------------------------------------------------------------
     EMOJI ATLAS
     Every glyph the game uses is baked into ONE texture on a grid, so
     all creatures draw in a single call and the buffer never has to be
     split into per-glyph runs. Cells are claimed on first sight and the
     atlas grows (16 -> 64 -> 256 cells) if a level needs more.
     --------------------------------------------------------------- */
  /* 1024 with 4x4 cells = 256px per glyph. Emoji were fine at 128, but the
     rendered creature sprites are 256px and would blur at the old size. */
  /* 2048 with 8x8 cells = 256px per glyph and 64 slots. With one creature
     per room there are 14 creatures plus the pickups, which overflows a
     4x4 grid; growing it in place would have halved every sprite to 128px. */
  const ATLAS = { cells: 8, size: 2048, map: {}, next: 0, canvas: null, ctx: null, tex: null };
  /* "img:<key>" glyphs come from sprites.js (SPRITES = { key: dataURI }).
     Images decode async, so a cell is claimed immediately and painted when
     the image lands; until then that cell is transparent for a frame or two. */
  const SPRITE_IMG = {};
  function spriteImage(key) {
    if (SPRITE_IMG[key]) return SPRITE_IMG[key];
    const src = (typeof SPRITES !== "undefined" && SPRITES) ? SPRITES[key.slice(4)] : null;
    if (!src) return null;
    const im = new Image();
    im.onload = () => { const c = ATLAS.map[key]; if (c) { atlasDraw(key, c.idx); } };
    im.src = src;
    SPRITE_IMG[key] = im;
    return im;
  }
  function atlasInit(cells) {
    ATLAS.cells = cells;
    ATLAS.canvas = ATLAS.canvas || document.createElement("canvas");
    ATLAS.canvas.width = ATLAS.canvas.height = ATLAS.size;
    ATLAS.ctx = ATLAS.canvas.getContext("2d");
    ATLAS.ctx.clearRect(0, 0, ATLAS.size, ATLAS.size);
    if (ATLAS.tex) ATLAS.tex.dispose();
    ATLAS.tex = new THREE.CanvasTexture(ATLAS.canvas);
    ATLAS.tex.magFilter = THREE.LinearFilter;
    ATLAS.tex.minFilter = THREE.LinearFilter;
    ATLAS.tex.generateMipmaps = false;
  }
  function atlasDraw(ch, idx) {
    const n = ATLAS.cells, cs = ATLAS.size / n;
    const cx = (idx % n) * cs, cy = Math.floor(idx / n) * cs;
    const g = ATLAS.ctx;
    g.save();
    g.clearRect(cx, cy, cs, cs);
    if (ch.indexOf("img:") === 0) {
      const im = spriteImage(ch);
      if (im && im.complete && im.naturalWidth) {
        // "contain" fit, centred, so the quad stays square and the art keeps
        // its aspect inside transparent padding
        const k = Math.min(cs / im.naturalWidth, cs / im.naturalHeight) * 0.96;
        const w = im.naturalWidth * k, h = im.naturalHeight * k;
        g.drawImage(im, cx + (cs - w) / 2, cy + (cs - h) / 2, w, h);
      }
    } else {
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = Math.round(cs * 0.74) + "px serif";
      g.fillText(ch, cx + cs / 2, cy + cs / 2 + cs * 0.03);
    }
    g.restore();
    ATLAS.tex.needsUpdate = true;
  }
  /* returns { u0, v0, s } — uv origin and cell size for this glyph */
  function atlasCell(ch) {
    if (!ATLAS.ctx) atlasInit(8);
    if (ATLAS.map[ch]) return ATLAS.map[ch];
    if (ATLAS.next >= ATLAS.cells * ATLAS.cells) {
      // grow and re-bake everything we had
      const old = Object.keys(ATLAS.map);
      atlasInit(Math.min(16, ATLAS.cells * 2));
      ATLAS.map = {}; ATLAS.next = 0;
      for (const o of old) { const i = ATLAS.next++; atlasDraw(o, i); ATLAS.map[o] = cellUV(i); }
    }
    const idx = ATLAS.next++;
    atlasDraw(ch, idx);
    ATLAS.map[ch] = cellUV(idx);
    return ATLAS.map[ch];
  }
  function cellUV(idx) {
    const n = ATLAS.cells, s = 1 / n;
    return { u0: (idx % n) * s, v0: 1 - (Math.floor(idx / n) + 1) * s, s: s, idx: idx };
  }

  /* ---------- shared uniforms ---------- */
  const U = {
    uFogColor: { value: new THREE.Color(0x080b14) },
    uFogNear:  { value: 1.2 },
    uFogFar:   { value: 11.0 },
    uTorch:    { value: new THREE.Vector3(1.0, 0.84, 0.58) },
    uTorchI:   { value: 1.0 },
    uSnap:     { value: new THREE.Vector2(SNAP, SNAP * 0.75) },
    uTime:     { value: 0 },
    uEye:      { value: new THREE.Vector3(0, EYE, 0) }
  };

  const VERT = `
    attribute float aLight;
    uniform vec2 uSnap;
    varying vec2  vUvW;
    varying float vW;
    varying float vLight;
    varying float vDepth;
    varying vec3  vWorld;
    void main(){
      vec4 mv  = modelViewMatrix * vec4(position, 1.0);
      vec4 pos = projectionMatrix * mv;

      // --- vertex snapping: quantise NDC position to a coarse grid (PS1 wobble)
      vec4 snapped = pos;
      snapped.xyz /= snapped.w;
      snapped.xy   = floor(uSnap * snapped.xy) / uSnap;
      snapped.xyz *= snapped.w;
      gl_Position  = snapped;

      // --- affine texture mapping: pre-multiply by w, undo it in the fragment.
      vUvW   = uv * pos.w;
      vW     = pos.w;
      vLight = aLight;
      vDepth = -mv.z;
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    }`;

  /* The player's torch is now anchored to the HERO (uEye), not to the
     camera. In third person a camera-anchored light would drag the pool
     of light behind the character and light the back of his head.     */
  const FRAG = `
    precision mediump float;
    uniform sampler2D uMap;
    uniform vec3  uFogColor;
    uniform float uFogNear;
    uniform float uFogFar;
    uniform vec3  uTorch;
    uniform float uTorchI;
    uniform vec3  uTint;
    uniform vec3  uEye;
    varying vec2  vUvW;
    varying float vW;
    varying float vLight;
    varying float vDepth;
    varying vec3  vWorld;
    void main(){
      vec2 uv = vUvW / vW;                       // affine result
      vec3 c  = texture2D(uMap, uv).rgb * uTint;

      float hd    = distance(vWorld, uEye);      // distance from the HERO
      float torch = uTorchI * 1.75 / (1.0 + hd * hd * 0.34);
      float lit   = clamp(vLight + torch, 0.0, 1.2);
      vec3  lamp  = mix(vec3(0.07, 0.085, 0.14), uTorch, clamp(lit, 0.0, 1.0));
      c *= lamp * (0.42 + lit * 0.95);

      float f = clamp((vDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
      c = mix(c, uFogColor, f * f * (1.6 - 0.6 * f));

      c = floor(c * 32.0) / 32.0;                // 16-bit-ish colour banding
      gl_FragColor = vec4(c, 1.0);
    }`;

  function mat(texKey, tintHex) {
    return new THREE.ShaderMaterial({
      uniforms: Object.assign({
        uMap:  { value: tex(texKey) },
        uTint: { value: new THREE.Color(tintHex) }
      }, U),
      vertexShader: VERT,
      fragmentShader: FRAG
    });
  }

  /* =====================================================================
     SPRITE SHADER — creatures, hero, pickups
     One camera-facing quad per creature, rebuilt each frame into a single
     buffer. Depth-TESTED against the world so a wall in front always wins,
     depth-WRITE off and drawn far-to-near so overlapping monsters blend.
     The aura, the rim light and the shield bubble are all computed here in
     the fragment, so nothing has to be faked on the 2D canvas any more.
     ===================================================================== */
  const SPR_VERT = `
    attribute vec3  aCenter;      // world-space anchor
    attribute vec2  aCorner;      // quad corner offset in world units
    attribute vec2  aQuad;        // same corner as -0.5..0.5, for the aura
    attribute vec4  aTintA;       // aura rgb + alpha
    attribute vec3  aFlags;       // x: shield 0/1, y: seed, z: hurt flash 0..1
    uniform float uTime;
    varying vec2  vUv;
    varying vec2  vQuad;
    varying vec4  vTintA;
    varying vec3  vFlags;
    varying float vDepth;
    varying vec3  vWorld;
    void main(){
      // billboard: build the quad on the camera's right/up axes
      vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      vec3 up    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      vec3 world = aCenter + right * aCorner.x + up * aCorner.y;
      vec4 mv    = viewMatrix * vec4(world, 1.0);
      gl_Position = projectionMatrix * mv;
      vUv    = uv;
      vQuad  = aQuad;
      vTintA = aTintA;
      vFlags = aFlags;
      vDepth = -mv.z;
      vWorld = world;
    }`;

  const SPR_FRAG = `
    precision mediump float;
    uniform sampler2D uMap;
    uniform vec3  uFogColor;
    uniform float uFogNear;
    uniform float uFogFar;
    uniform vec3  uTorch;
    uniform float uTorchI;
    uniform vec3  uEye;
    uniform float uTime;
    varying vec2  vUv;
    varying vec2  vQuad;
    varying vec4  vTintA;
    varying vec3  vFlags;
    varying float vDepth;
    varying vec3  vWorld;
    void main(){
      vec4 t = texture2D(uMap, vUv);
      float d = length(vQuad);

      // --- aura: a soft radial bloom in the creature's own colour
      float aura = smoothstep(0.5, 0.12, d) * 0.42;

      // --- shield bubble: a ring that pulses while the maths lock holds
      float ring = 0.0;
      if (vFlags.x > 0.5) {
        float pulse = 0.60 + 0.25 * sin(uTime * 5.0 + vFlags.y * 3.0);
        ring = smoothstep(0.022, 0.0, abs(d - 0.40)) * pulse * 0.75;
      }

      vec3  col = t.rgb;
      float a   = t.a;

      // torch falloff from the hero, same curve the walls use
      float hd    = max(distance(vWorld, uEye), 0.55);
      float torch = uTorchI * 1.55 / (1.0 + hd * hd * 0.30);
      float lit   = clamp(0.20 + torch, 0.0, 1.05);
      col *= mix(vec3(0.16, 0.18, 0.26), uTorch, clamp(lit, 0.0, 1.0)) * (0.55 + lit * 0.85);

      // hurt flash: blow the creature to white for a couple of frames
      col = mix(col, vec3(1.0), clamp(vFlags.z, 0.0, 1.0) * a);

      // composite aura + ring UNDER the glyph
      vec3 glow = vTintA.rgb * (aura + ring);
      col = col * a + glow * (1.0 - a);
      a   = clamp(a + (aura * 0.55 + ring) * (1.0 - a), 0.0, 1.0);

      float f = clamp((vDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
      col = mix(col, uFogColor, f * f * (1.6 - 0.6 * f));

      col = floor(col * 32.0) / 32.0;
      gl_FragColor = vec4(col, a * vTintA.a);
      if (gl_FragColor.a < 0.01) discard;
    }`;

  /* =====================================================================
     MODEL SHADER
     Characters and the held weapon are untextured geometry, so they get a
     flat-colour variant of the world shader: same vertex snapping, same
     torch falloff, same fog and 32-step quantisation, so a model sits in
     the dungeon instead of on top of it. Simple N-dot-L shading off a
     fixed key direction gives the faces enough separation to read.
     ===================================================================== */
  const MODEL_VERT = `
    uniform vec2 uSnap;
    varying vec3 vN;
    varying float vDepth;
    varying vec3 vWorld;
    void main(){
      vec4 mv  = modelViewMatrix * vec4(position, 1.0);
      vec4 pos = projectionMatrix * mv;
      vec4 sn  = pos;
      sn.xyz /= sn.w;
      sn.xy   = floor(uSnap * sn.xy) / uSnap;
      sn.xyz *= sn.w;
      gl_Position = sn;
      vN     = normalize(mat3(modelMatrix) * normal);
      vDepth = -mv.z;
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    }`;

  const MODEL_FRAG = `
    precision mediump float;
    uniform vec3  uColor;
    uniform vec3  uFogColor;
    uniform float uFogNear;
    uniform float uFogFar;
    uniform vec3  uTorch;
    uniform float uTorchI;
    uniform vec3  uEye;
    uniform float uVM;        // 1.0 = held viewmodel: lit up close, no fog
    uniform float uFlash;     // muzzle flash lighting the weapon and hands
    varying vec3  vN;
    varying float vDepth;
    varying vec3  vWorld;
    void main(){
      vec3 L = normalize(vec3(0.45, 0.85, 0.30));
      float nl = 0.42 + 0.58 * max(dot(normalize(vN), L), 0.0);

      float lit;
      if (uVM > 0.5) {
        lit = 1.45 + uFlash * 1.2;                 // held: lit by its own key, not the room
      } else {
        float hd = max(distance(vWorld, uEye), 0.55);
        lit = clamp(0.16 + uTorchI * 1.55 / (1.0 + hd * hd * 0.30), 0.0, 1.05);
      }
      vec3 lamp = mix(vec3(0.10, 0.12, 0.18), uTorch, clamp(lit, 0.0, 1.0));
      vec3 c = uColor * lamp * (0.40 + lit * 0.95) * nl;
      if (uVM > 0.5) c += uColor * 0.28;           // ambient lift so detail survives
      c += uColor * uFlash * 0.55;

      if (uVM < 0.5) {
        float f = clamp((vDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
        c = mix(c, uFogColor, f * f * (1.6 - 0.6 * f));
      }
      c = floor(c * 32.0) / 32.0;
      gl_FragColor = vec4(c, 1.0);
    }`;

  const UVM = { uVM: { value: 0 }, uFlash: { value: 0 } };
  const modelMatCache = {}, vmMatCache = {};
  function modelMat(hex) {
    if (modelMatCache[hex]) return modelMatCache[hex];
    return modelMatCache[hex] = new THREE.ShaderMaterial({
      uniforms: Object.assign({ uColor: { value: new THREE.Color(hex) } }, U,
                              { uVM: { value: 0 }, uFlash: UVM.uFlash }),
      vertexShader: MODEL_VERT, fragmentShader: MODEL_FRAG
    });
  }
  /* Same shader, but sampling the glb's own base-colour texture. A model
     that arrives with a map would otherwise lose it entirely. */
  const MODEL_TEX_FRAG = MODEL_FRAG
    .replace("uniform vec3  uColor;", "uniform vec3 uColor;\nuniform sampler2D uMap;\nvarying vec2 vUvT;")
    .replace("vec3 c = uColor * lamp", "vec3 c = uColor * texture2D(uMap, vUvT).rgb * lamp");
  const MODEL_TEX_VERT = MODEL_VERT
    .replace("varying vec3  vN;", "varying vec3 vN;\nvarying vec2 vUvT;")
    .replace("vN     = normalize", "vUvT = uv;\n      vN     = normalize");
  const modelTexCache = new Map();
  function modelTexMat(hex, map) {
    if (!map) return modelMat(hex);
    const key = hex + "|" + map.uuid;
    if (modelTexCache.has(key)) return modelTexCache.get(key);
    const m = new THREE.ShaderMaterial({
      uniforms: Object.assign({ uColor: { value: new THREE.Color(hex) },
                                uMap: { value: map } }, U,
                              { uVM: { value: 0 }, uFlash: UVM.uFlash }),
      vertexShader: MODEL_TEX_VERT, fragmentShader: MODEL_TEX_FRAG
    });
    modelTexCache.set(key, m);
    return m;
  }

  function vmMat(hex) {
    if (vmMatCache[hex]) return vmMatCache[hex];
    return vmMatCache[hex] = new THREE.ShaderMaterial({
      uniforms: Object.assign({ uColor: { value: new THREE.Color(hex) } }, U,
                              { uVM: { value: 1 }, uFlash: UVM.uFlash }),
      vertexShader: MODEL_VERT, fragmentShader: MODEL_FRAG
    });
  }

  /* floor decals: the equal-group rings, drawn flat on the ground so they
     stay correct when the camera swings round in third person            */
  const RING_VERT = `
    varying vec2 vUv; varying float vDepth;
    void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0);
      vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`;
  const RING_FRAG = `
    precision mediump float;
    uniform vec3 uColor; uniform float uTime; uniform float uLock;
    uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
    varying vec2 vUv; varying float vDepth;
    void main(){
      float d = distance(vUv, vec2(0.5)) * 2.0;
      float w = uLock > 0.5 ? 0.10 : 0.07;
      float ring = smoothstep(w, 0.0, abs(d - 0.86));
      if (uLock < 0.5) {                                   // dashed when idle
        float seg = sin(atan(vUv.y-0.5, vUv.x-0.5) * 14.0 - uTime * 1.4);
        ring *= step(0.0, seg);
      }
      float pulse = uLock > 0.5 ? 0.85 + 0.15*sin(uTime*9.0) : 0.62;
      float a = ring * pulse;
      if (a < 0.02) discard;
      vec3 c = uColor;
      float f = clamp((vDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
      c = mix(c, uFogColor, f * f * 0.7);
      gl_FragColor = vec4(c, a);
    }`;

  /* ---------- level geometry ---------- */
  let levelGroup = null, torches = [], flameGroup = null;
  let doorGroup = null, doorMeshes = {}, doorAnim = {};
  let spriteMesh = null, spriteMat = null, spriteCap = 0;
  let ringGroup = null, ringPool = [];
  let heroLightAmb = null, heroTorch = null, heroKey = null;
  let hero = null, heroId = null;                 // third-person character
  let vmScene = null, vmCam = null, vm = null, vmId = null, vmAccent = null;

  const walkable = (gx, gy) => {
    if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) return false;
    const ch = grid[gy][gx];
    return !(ch === "#" || ch === "%");           // doors are openings in the wall
  };
  const isDoor = (gx, gy) =>
    gx >= 0 && gy >= 0 && gx < GW && gy < GH && grid[gy][gx] === "D";

  function bakeLight(x, y, z) {
    let l = 0.09;
    for (const t of torches) {
      const dx = x - t.x, dy = y - t.y, dz = z - t.z;
      const d  = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const R = t.den ? 7.0 : 4.6;
      const K = t.den ? 1.05 : 0.85;
      if (d < R) l += K * (1 - d / R) * (1 - d / R);
    }
    return Math.min(1.35, l);
  }

  function pushQuad(B, a, b, c, d, uMax, vMax) {
    const tri = (p1, p2, p3, uv1, uv2, uv3) => {
      B.pos.push(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]);
      B.uv.push(uv1[0], uv1[1], uv2[0], uv2[1], uv3[0], uv3[1]);
      B.light.push(bakeLight(p1[0], p1[1], p1[2]),
                   bakeLight(p2[0], p2[1], p2[2]),
                   bakeLight(p3[0], p3[1], p3[2]));
    };
    tri(a, b, c, [0, 0], [uMax, 0], [uMax, vMax]);
    tri(a, c, d, [0, 0], [uMax, vMax], [0, vMax]);
  }

  function finish(B, material) {
    if (!B.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(B.pos, 3));
    g.setAttribute("uv",       new THREE.Float32BufferAttribute(B.uv, 2));
    g.setAttribute("aLight",   new THREE.Float32BufferAttribute(B.light, 1));
    return new THREE.Mesh(g, material);
  }

  /* =====================================================================
     buildLevel
     ===================================================================== */
  function buildLevel() {
    if (!ensure()) return;
    if (typeof grid === "undefined" || !grid.length) return;

    if (levelGroup) {
      levelGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      scene.remove(levelGroup);
    }
    levelGroup = new THREE.Group();
    scene.add(levelGroup);

    const A = art();
    U.uFogColor.value.setHex(A.fog);
    U.uFogNear.value = A.near;
    // three's own fog only touches materials that opt in (MeshStandardMaterial
    // on imported meshes); the hand-written wall/sprite shaders do their own.
    scene.fog = new THREE.Fog(A.fog, A.near, A.far);
    U.uFogFar.value  = A.far;
    U.uTorch.value.set(A.torch[0], A.torch[1], A.torch[2]);

    /* --- pass 1: torch placement (wall sconces + a bigger one per den) --- */
    torches = [];
    for (let gy = 0; gy < GH; gy++) {
      for (let gx = 0; gx < GW; gx++) {
        if (!walkable(gx, gy)) continue;
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [dx, dy] of dirs) {
          if (walkable(gx + dx, gy + dy)) continue;
          if (((gx * 7 + gy * 13 + dx * 3 + dy * 5) % 11) !== 0) continue;
          torches.push({ x: gx + 0.5 + dx * 0.42, y: CEIL * 0.62, z: gy + 0.5 + dy * 0.42, den: false });
          break;
        }
      }
    }
    if (typeof ents !== "undefined") {
      for (const e of ents) {
        if (e.kind === "pack" || e.kind === "boss")
          torches.push({ x: e.x, y: CEIL * 0.78, z: e.y, den: true });
      }
    }

    /* --- pass 2: walls, floors, ceilings --- */
    const mk = () => ({ pos: [], uv: [], light: [] });
    const B = { w1: mk(), w2: mk(), fl: mk(), ce: mk() };
    const vRep = CEIL / VREP;

    for (let gy = 0; gy < GH; gy++) {
      for (let gx = 0; gx < GW; gx++) {
        const ch = grid[gy][gx];
        const solid = (ch === "#" || ch === "%");
        if (solid) {
          const bucket = (ch === "%") ? B.w2 : B.w1;
          const x0 = gx, x1 = gx + 1, z0 = gy, z1 = gy + 1;
          if (walkable(gx, gy - 1))
            pushQuad(bucket, [x1, 0, z0], [x0, 0, z0], [x0, CEIL, z0], [x1, CEIL, z0], 1, vRep);
          if (walkable(gx, gy + 1))
            pushQuad(bucket, [x0, 0, z1], [x1, 0, z1], [x1, CEIL, z1], [x0, CEIL, z1], 1, vRep);
          if (walkable(gx - 1, gy))
            pushQuad(bucket, [x0, 0, z0], [x0, 0, z1], [x0, CEIL, z1], [x0, CEIL, z0], 1, vRep);
          if (walkable(gx + 1, gy))
            pushQuad(bucket, [x1, 0, z1], [x1, 0, z0], [x1, CEIL, z0], [x1, CEIL, z1], 1, vRep);
        } else {
          pushQuad(B.fl, [gx, 0, gy + 1], [gx + 1, 0, gy + 1], [gx + 1, 0, gy], [gx, 0, gy], 1, 1);
          pushQuad(B.ce, [gx, CEIL, gy], [gx + 1, CEIL, gy], [gx + 1, CEIL, gy + 1], [gx, CEIL, gy + 1], 1, 1);
        }
      }
    }

    const add = (b, m) => { const mesh = finish(b, m); if (mesh) levelGroup.add(mesh); };
    add(B.w1, mat(A.w1, A.tint));
    add(B.w2, mat(A.w2, A.tint));
    add(B.fl, mat(A.fl, A.tint));
    add(B.ce, mat(A.ce, A.tint));

    buildDoors();
    buildFlames();
    buildSpriteMesh();
    buildRingPool();
    /* The hero and the held weapon deliberately survive a level rebuild.
       buildLevel only removes the groups it owns (level, doors, flames,
       sprites, rings), so re-creating them here was never needed, and the
       old version set `hero = null` BEFORE setCharacter could remove it,
       which orphaned a hero in the scene and re-parsed the 464KB glb on
       every single level load. They pick up the new level's fog and torch
       colour automatically, because those live in shared uniforms. */
  }

  /* =====================================================================
     DOORS — one mesh each, so a solved door can grind open on its own
     ===================================================================== */
  function buildDoors() {
    if (doorGroup) {
      doorGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      scene.remove(doorGroup);
    }
    doorGroup = new THREE.Group();
    scene.add(doorGroup);
    doorMeshes = {};
    doorAnim = {};
    if (typeof doors === "undefined") return;

    const A = art();
    const vRep = CEIL / VREP;
    const dm = mat("door", 0xffffff);

    for (const key of doors) {
      const parts = key.split(",");
      const gx = parseInt(parts[0], 10), gy = parseInt(parts[1], 10);
      const B = { pos: [], uv: [], light: [] };
      // the slab spans the opening on whichever axis the corridor runs
      const openNS = walkable(gx, gy - 1) && walkable(gx, gy + 1);
      if (openNS) {
        const z = gy + 0.5;
        pushQuad(B, [gx, 0, z], [gx + 1, 0, z], [gx + 1, CEIL, z], [gx, CEIL, z], 1, vRep);
        pushQuad(B, [gx + 1, 0, z], [gx, 0, z], [gx, CEIL, z], [gx + 1, CEIL, z], 1, vRep);
      } else {
        const x = gx + 0.5;
        pushQuad(B, [x, 0, gy], [x, 0, gy + 1], [x, CEIL, gy + 1], [x, CEIL, gy], 1, vRep);
        pushQuad(B, [x, 0, gy + 1], [x, 0, gy], [x, CEIL, gy], [x, CEIL, gy + 1], 1, vRep);
      }
      const mesh = finish(B, dm);
      if (!mesh) continue;
      mesh.renderOrder = 1;
      doorMeshes[key] = mesh;
      doorGroup.add(mesh);
    }
  }

  /* Start the open animation. The GAME keeps the tile solid until
     isDoorBusy(key) goes false, so nobody walks through a moving slab. */
  const DOOR_OPEN_TIME = 0.95;
  function openDoor(key) {
    if (!doorMeshes[key] || doorAnim[key]) return false;
    doorAnim[key] = { t: 0 };
    return true;
  }
  const isDoorBusy = key => !!doorAnim[key];
  const isDoorGone = key => !doorMeshes[key];

  function stepDoors(dt) {
    for (const key in doorAnim) {
      const a = doorAnim[key];
      a.t += dt;
      const k = Math.min(1, a.t / DOOR_OPEN_TIME);
      const mesh = doorMeshes[key];
      if (mesh) {
        // ease-out rise, then a small settle: stone grinding up into the arch
        const e = 1 - Math.pow(1 - k, 2.4);
        mesh.position.y = e * (CEIL + 0.05);
        mesh.visible = k < 1;
      }
      if (k >= 1) {
        if (mesh) { doorGroup.remove(mesh); mesh.geometry.dispose(); }
        delete doorMeshes[key];
        delete doorAnim[key];
      }
    }
  }

  /* ---------- torch flames ---------- */
  function buildFlames() {
    if (flameGroup) scene.remove(flameGroup);
    flameGroup = new THREE.Group();
    scene.add(flameGroup);
    const fc = document.createElement("canvas");
    fc.width = fc.height = 32;
    const fx = fc.getContext("2d");
    const g = fx.createRadialGradient(16, 16, 1, 16, 16, 15);
    g.addColorStop(0, "rgba(255,240,200,1)");
    g.addColorStop(0.35, "rgba(255,170,60,0.85)");
    g.addColorStop(1, "rgba(255,80,0,0)");
    fx.fillStyle = g; fx.fillRect(0, 0, 32, 32);
    const flameTex = new THREE.CanvasTexture(fc);
    flameTex.magFilter = flameTex.minFilter = THREE.NearestFilter;
    for (const t of torches) {
      if (t.den) continue;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
      }));
      s.position.set(t.x, t.y, t.z);
      s.scale.set(0.42, 0.55, 1);
      s.userData.seed = Math.random() * 6.28;
      flameGroup.add(s);
    }
  }

  /* =====================================================================
     SPRITE BUFFER
     One geometry, rebuilt every frame from the list the game hands over.
     ===================================================================== */
  function buildSpriteMesh() {
    if (spriteMesh) { scene.remove(spriteMesh); spriteMesh.geometry.dispose(); spriteMesh = null; }
    spriteCap = 0;
  }

  function ensureSpriteCap(n) {
    if (spriteMesh && spriteCap >= n) return;
    const cap = Math.max(64, Math.ceil(n * 1.5));
    if (spriteMesh) { scene.remove(spriteMesh); spriteMesh.geometry.dispose(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(cap * 6 * 3), 3));
    g.setAttribute("aCenter",  new THREE.Float32BufferAttribute(new Float32Array(cap * 6 * 3), 3));
    g.setAttribute("aCorner",  new THREE.Float32BufferAttribute(new Float32Array(cap * 6 * 2), 2));
    g.setAttribute("aQuad",    new THREE.Float32BufferAttribute(new Float32Array(cap * 6 * 2), 2));
    g.setAttribute("uv",       new THREE.Float32BufferAttribute(new Float32Array(cap * 6 * 2), 2));
    g.setAttribute("aTintA",   new THREE.Float32BufferAttribute(new Float32Array(cap * 6 * 4), 4));
    g.setAttribute("aFlags",   new THREE.Float32BufferAttribute(new Float32Array(cap * 6 * 3), 3));
    if (!spriteMat) {
      spriteMat = new THREE.ShaderMaterial({
        uniforms: Object.assign({ uMap: { value: null } }, U),
        vertexShader: SPR_VERT,
        fragmentShader: SPR_FRAG,
        transparent: true,
        depthTest: true,      // <-- the whole point: real walls occlude creatures
        depthWrite: false,
        side: THREE.DoubleSide
      });
    }
    spriteMesh = new THREE.Mesh(g, spriteMat);
    spriteMesh.frustumCulled = false;
    spriteMesh.renderOrder = 5;
    scene.add(spriteMesh);
    spriteCap = cap;
  }

  /* The game hands over one flat list per frame. Every entry:
       { x, y, lift, emoji, w, h, tint:[r,g,b], alpha, shield, seed, flash }
     x/y are game grid coords, lift is height above the floor in cells.  */
  /* =====================================================================
     MESH CREATURES
     A creature with a GLB in CREATURE_GLB is drawn as real geometry instead
     of a billboard. The template is loaded once, normalised to height 1
     with its feet on y=0, then cloned per member (clones share geometry
     and material, so a 56-bat den is one mesh in memory). Every instance
     is yawed to face the camera each frame: single-image reconstructions
     have a good front and a rough back, and this way the back is never
     the side you look at.
     ===================================================================== */
  const meshTpl = {};   // key -> { status, tpl }
  const meshPool = {};  // key -> [Object3D]
  let meshGroup = null;

  function creatureMesh(key) {
    const t = meshTpl[key];
    if (t) return t.status === "ready" ? t.tpl : null;
    meshTpl[key] = { status: "loading", tpl: null };
    const src = (typeof CREATURE_GLB !== "undefined" && CREATURE_GLB) ? CREATURE_GLB[key] : null;
    if (!src || typeof THREE.GLTFLoader !== "function") { meshTpl[key].status = "failed"; return null; }
    try {
      new THREE.GLTFLoader().load(src, g => {
        try {
          const root = g.scene;
          root.updateWorldMatrix(true, true);
          const box = new THREE.Box3().setFromObject(root);
          const size = box.getSize(new THREE.Vector3());
          const ctr = box.getCenter(new THREE.Vector3());
          const h = size.y || 1;
          const holder = new THREE.Group();
          root.scale.setScalar(1 / h);
          root.position.set(-ctr.x / h, -box.min.y / h, -ctr.z / h);
          root.rotation.y = (typeof CREATURE_YAW !== "undefined" && CREATURE_YAW[key]) || 0;
          root.traverse(o => { if (o.isMesh) { o.frustumCulled = false; } });
          holder.add(root);
          meshTpl[key] = { status: "ready", tpl: holder };
        } catch (e) { meshTpl[key].status = "failed"; }
      }, undefined, () => { meshTpl[key].status = "failed"; });
    } catch (e) { meshTpl[key].status = "failed"; }
    return null;
  }

  function placeMeshes(items) {
    if (!meshGroup) { meshGroup = new THREE.Group(); scene.add(meshGroup); }
    const used = {};
    const cam = camera.position;
    for (const s of items) {
      const key = s.emoji.slice(4);
      const tpl = meshTpl[key].tpl;
      const pool = meshPool[key] || (meshPool[key] = []);
      const i = used[key] = (used[key] || 0) + 1;
      let inst = pool[i - 1];
      if (!inst) { inst = tpl.clone(); pool.push(inst); meshGroup.add(inst); }
      inst.visible = true;
      inst.position.set(s.x, s.lift, s.y);
      // scale is height in cells; a dying boss fades by shrinking instead
      const sc = Math.max(0.001, s.h * (s.alpha == null ? 1 : s.alpha));
      inst.scale.setScalar(sc);
      inst.rotation.y = Math.atan2(cam.x - s.x, cam.z - s.y);
    }
    for (const key in meshPool) {
      const n = used[key] || 0;
      const pool = meshPool[key];
      for (let j = n; j < pool.length; j++) pool[j].visible = false;
    }
  }

  function meshStatus() {
    const out = {};
    for (const k in meshTpl) out[k] = meshTpl[k].status;
    return out;
  }

  function setSprites(listIn) {
    // split: creatures with a loaded mesh go to placeMeshes, the rest billboard
    const list = [], meshed = [];
    for (const s of (listIn || [])) {
      const isImg = typeof s.emoji === "string" && s.emoji.indexOf("img:") === 0;
      if (isImg && creatureMesh(s.emoji.slice(4))) meshed.push(s); else list.push(s);
    }
    placeMeshes(meshed);
    if (!ready) return;
    if (!list || !list.length) { if (spriteMesh) spriteMesh.visible = false; return; }

    const cam = camera.position;
    for (const s of list) {
      const dx = s.x - cam.x, dz = s.y - cam.z;
      s._d2 = dx * dx + dz * dz;
    }
    list.sort((a, b) => b._d2 - a._d2);      // far to near for correct blending

    ensureSpriteCap(list.length);
    const g = spriteMesh.geometry;
    const pos = g.attributes.position.array, cen = g.attributes.aCenter.array;
    const cor = g.attributes.aCorner.array,  uv  = g.attributes.uv.array;
    const qd  = g.attributes.aQuad.array;
    const tin = g.attributes.aTintA.array,   flg = g.attributes.aFlags.array;

    const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
    const UVQ     = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];
    let v = 0;
    for (const s of list) {
      const cell = atlasCell(s.emoji);
      const hw = s.w * 0.5, hh = s.h * 0.5;
      const cy = s.lift + hh;                     // anchor: feet on the floor
      const a  = s.alpha == null ? 1 : s.alpha;
      for (let k = 0; k < 6; k++) {
        pos[v * 3] = s.x; pos[v * 3 + 1] = cy; pos[v * 3 + 2] = s.y;
        cen[v * 3] = s.x; cen[v * 3 + 1] = cy; cen[v * 3 + 2] = s.y;
        cor[v * 2] = CORNERS[k][0] * hw; cor[v * 2 + 1] = CORNERS[k][1] * hh;
        qd[v * 2]  = CORNERS[k][0] * 0.5; qd[v * 2 + 1] = CORNERS[k][1] * 0.5;
        uv[v * 2]  = cell.u0 + UVQ[k][0] * cell.s;
        uv[v * 2 + 1] = cell.v0 + UVQ[k][1] * cell.s;
        tin[v * 4] = s.tint[0]; tin[v * 4 + 1] = s.tint[1];
        tin[v * 4 + 2] = s.tint[2]; tin[v * 4 + 3] = a;
        flg[v * 3] = s.shield ? 1 : 0; flg[v * 3 + 1] = s.seed || 0; flg[v * 3 + 2] = s.flash || 0;
        v++;
      }
    }
    for (const at of ["position", "aCenter", "aCorner", "aQuad", "uv", "aTintA", "aFlags"]) g.attributes[at].needsUpdate = true;
    spriteMat.uniforms.uMap.value = ATLAS.tex;
    g.setDrawRange(0, v);
    spriteMesh.visible = true;
  }

  /* ---------- equal-group floor rings ---------- */
  function buildRingPool() {
    if (ringGroup) { ringGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); }); scene.remove(ringGroup); }
    ringGroup = new THREE.Group();
    scene.add(ringGroup);
    ringPool = [];
  }
  function ringMesh() {
    const g = new THREE.PlaneGeometry(1, 1);
    const m = new THREE.ShaderMaterial({
      uniforms: Object.assign({
        uColor: { value: new THREE.Color(0x39d5ff) },
        uLock:  { value: 0 }
      }, U),
      vertexShader: RING_VERT, fragmentShader: RING_FRAG,
      transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 3;
    ringGroup.add(mesh);
    ringPool.push(mesh);
    return mesh;
  }
  /* list: [{ x, y, r, color:[r,g,b], lock:bool }] */
  function setRings(list) {
    if (!ready || !ringGroup) return;
    while (ringPool.length < list.length) ringMesh();
    ringPool.forEach((m, i) => {
      const d = list[i];
      if (!d) { m.visible = false; return; }
      m.visible = true;
      m.position.set(d.x, 0.02, d.y);
      const s = d.r * 2;
      m.scale.set(s, s, 1);
      m.material.uniforms.uColor.value.setRGB(d.color[0], d.color[1], d.color[2]);
      m.material.uniforms.uLock.value = d.lock ? 1 : 0;
    });
  }

  /* =====================================================================
     THIRD-PERSON CHARACTER
     A real articulated model in the scene, facing the way the player is
     walking. Replaces the emoji billboard, which had no legs, no depth
     and always faced the camera.
     ===================================================================== */
  let heroSeq = 0;
  const heroCache = new Map();
  function setCharacter(id) {
    if (!ensure()) { heroId = id; return; }
    if (typeof MODELS === "undefined" || !MODELS) return;
    if (hero && heroId === id) return;
    if (hero) { scene.remove(hero.group); hero = null; }
    heroId = id;
    const seq = ++heroSeq;

    /* A real glTF model has to be parsed, so this is async. Put the
       procedural version in immediately so the dungeon is never empty,
       then swap it out when the real one is ready. If the player picks a
       different hero mid-parse, seq makes the stale result get dropped. */
    hero = MODELS.buildCharacter(id, modelMat);
    hero.group.visible = false;
    scene.add(hero.group);
    heroInfo = { kind: "procedural", animated: true };   // truthful until a glb lands

    if (heroCache.has(id)) {                       // already parsed once
      const m = heroCache.get(id);
      scene.remove(hero.group);
      hero = m; hero.group.visible = false; scene.add(hero.group);
      heroInfo = m.info;
      return;
    }
    if (typeof GLTFModels !== "undefined" && GLTFModels && GLTFModels.available()) {
      GLTFModels.build(id, modelMat, null).then(m => {
        if (!m || !m.info || m.info.kind !== "gltf") return;
        heroCache.set(id, m);
        if (seq !== heroSeq) return;               // player switched mid-parse
        if (hero) scene.remove(hero.group);
        hero = m;
        hero.group.visible = false;
        scene.add(hero.group);
        heroInfo = m.info;
      }).catch(() => { /* keep the procedural stand-in */ });
    }
  }
  let heroInfo = null;
  const getCharacter = () => heroId;

  /* =====================================================================
     FIRST-PERSON VIEWMODEL
     Rendered in its own scene with the depth buffer cleared first, which
     is how every shooter does it: the held weapon can never be clipped
     by a wall it is standing next to.
     ===================================================================== */
  function setWeapon(id, accentHex) {
    if (!ensure()) { vmId = id; vmAccent = accentHex; return; }
    if (typeof MODELS === "undefined" || !MODELS) return;
    if (vm && vmId === id && vmAccent === accentHex) return;
    vmId = id; vmAccent = accentHex;
    if (!vmScene) {
      vmScene = new THREE.Scene();
      vmCam = new THREE.PerspectiveCamera(vFov, aspect, 0.01, 5);
    }
    if (vm) vmScene.remove(vm.group);
    vm = MODELS.buildWeapon(id, vmMat, accentHex == null ? 0x39d5ff : accentHex);
    vmScene.add(vm.group);
  }
  /* live tuning hook: framing a viewmodel is a look-at-it job, not a
     calculate-it job, so this lets the pose be nudged from the console
     and the winning numbers baked back into models.js */
  function tuneVM(x, y, z, sc, ry) {
    if (!vm) return null;
    const g = vm.group;
    if (x != null) g.position.set(x, y, z);
    if (sc != null) g.scale.setScalar(sc);
    if (ry != null) g.rotation.y = ry;
    vm.rebase && vm.rebase();
    return { pos: g.position.toArray(), scale: g.scale.x, ry: g.rotation.y };
  }
  /* Where the barrel tip actually is on screen. The beam used to start
     from a hardcoded fraction of the canvas, so it left the gun at an
     angle that had nothing to do with where the muzzle was pointing,
     and the recoil made the mismatch obvious. */
  const _mv = (typeof THREE !== "undefined") ? new THREE.Vector3() : null;
  function muzzleScreen() {
    if (!vm || !vm.muzzle || !vmCam || viewMode === "third") return null;
    vm.muzzle.updateWorldMatrix(true, false);
    _mv.setFromMatrixPosition(vm.muzzle.matrixWorld);
    vmCam.updateMatrixWorld(true);
    const depth = -_mv.clone().applyMatrix4(vmCam.matrixWorldInverse).z;
    if (depth <= 0.005) return null;
    _mv.project(vmCam);
    return { sx: (_mv.x * 0.5 + 0.5) * RES_W, sy: (-_mv.y * 0.5 + 0.5) * RES_H };
  }
  /* =====================================================================
     HELD WEAPON (third person)
     The viewmodel only exists in first person; the character's hands were
     empty while the HUD said "Flurry Sword". This builds a second copy of
     the equipped weapon without the viewmodel's gloves/forearms and hangs
     it off the hero's right hand: the rig's handR anchor for the block
     heroes, the real HandR bone for a rigged glb. Bones carry scale (the
     robot's chain has a x100 node), so the copy is counter-scaled to a
     fixed world size after one world-matrix update.
     ===================================================================== */
  let held = null, heldKey = "", heldAnchor = null;
  const _hq = new THREE.Quaternion(), _dq = new THREE.Quaternion(), _lq = new THREE.Quaternion();
  const _hp = new THREE.Vector3(), _hs = new THREE.Vector3();
  const _wp = new THREE.Vector3(), _ap = new THREE.Vector3(), _off = new THREE.Vector3();
  /* Rest pose for each weapon, in the HERO's frame (his forward is local
     -Z, up is +Y): the sword stands upright with a small forward lean, the
     blaster points down his heading with a touch of droop. Expressed in the
     hero frame instead of the hand bone so a finger bone that points at the
     floor (the robot's idle pose) or a swinging block arm never drags the
     weapon along with it. */
  const HELD_POSE = {
    /* Upright but leaned out to his right and forward, so the blade clears
       the torso instead of hiding behind it when the camera is at his back. */
    blade:   new THREE.Euler(-0.30, 0, -0.55),
    /* From behind, a barrel that points dead ahead is a foreshortened dot
       hidden by the hero's own arm. Carried "at ready", tipped up and out
       to his right, it clears the silhouette and reads as a gun. */
    blaster: new THREE.Euler(0.40, -0.50, 0)
  };
  function orientHeld() {
    if (!held || !heldAnchor || !hero || !hero.group) return;
    // world orientation wanted = hero yaw * rest pose
    hero.group.getWorldQuaternion(_hq);
    _lq.setFromEuler(HELD_POSE[vmId] || HELD_POSE.blaster);
    _dq.copy(_hq).multiply(_lq);
    // holder is a child of the anchor: local = inverse(anchorWorld) * wanted
    heldAnchor.updateWorldMatrix(true, false);
    heldAnchor.matrixWorld.decompose(_hp, _hq, _hs);
    held.quaternion.copy(_hq.invert()).multiply(_dq);
    /* Grip height. A rig whose arms hang to the floor (the robot's idle
       pose puts the hand at ankle height) would carry the weapon in the
       dirt; lift it to at least hip height in the hero's frame. The offset
       is applied in world space then mapped back into the anchor's frame. */
    hero.group.getWorldPosition(_wp);
    const heroH = (hero.info && hero.info.height ? hero.info.height : 1.0) * hero.group.scale.y;
    const minY  = _wp.y + heroH * 0.30;
    _ap.setFromMatrixPosition(heldAnchor.matrixWorld);
    const lift = Math.max(0, minY - _ap.y);
    _off.set(0, lift, 0).applyQuaternion(_hq);          // _hq is already the inverse anchor rotation
    held.position.copy(_off).divideScalar(Math.max(1e-6, _hs.x));
    // keep the counter-scale honest if the rig's chain scale ever changes
    const target = (vmId === "blade") ? 0.62 : 0.55;
    held.scale.setScalar(target / Math.max(1e-6, _hs.x));
  }
  function findHandBone(root) {
    const rank = o => {
      const n = (o.name || "").toLowerCase();
      if (!/hand|wrist|palm/.test(n)) return 0;
      const right = /(^|[^a-z])r([^a-z]|$)|right|_r\b|\.r\b|r$|handr/.test(n);
      return right ? 3 : 1;
    };
    let best = null, bestRank = 0;
    root.traverse(o => {
      const r = rank(o);
      if (r > bestRank) { best = o; bestRank = r; }
    });
    return best;
  }
  function attachHeldWeapon() {
    if (!hero || !vmId) return;
    if (typeof MODELS === "undefined" || !MODELS) return;
    const key = vmId + "|" + (vmAccent == null ? "" : vmAccent) + "|" + (MODELS.swordChoice ? MODELS.swordChoice() : "");
    if (held && held.parent && heldKey === key && held.userData.heroGroup === hero.group) return;
    if (held && held.parent) held.parent.remove(held);
    held = null;

    // where to hang it
    let anchor = hero.handR || null;
    if (!anchor && hero.group) anchor = findHandBone(hero.group);
    if (!anchor) return;

    const w = MODELS.buildWeapon(vmId, modelMat, vmAccent == null ? 0x39d5ff : vmAccent);
    const g = w.group;
    // strip the viewmodel framing and its gloves
    g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); g.scale.setScalar(1);
    if (w.parts) { if (w.parts.rHand) w.parts.rHand.visible = false; if (w.parts.lHand) w.parts.lHand.visible = false; if (w.parts.flash) w.parts.flash.visible = false; }
    // orient: sword points up (-Z -> +Y), blaster points forward (-Z stays forward)
    const holder = new THREE.Group();
    if (vmId === "blade") { g.rotation.x = Math.PI / 2; g.position.set(0, 0.02, 0); }
    else { g.rotation.set(0, 0, 0); g.position.set(0, 0.03, -0.08); }
    holder.add(g);

    // counter the bone/rig scale so the weapon is a fixed size in the world
    anchor.updateWorldMatrix(true, false);
    const ws = new THREE.Vector3(); anchor.getWorldScale(ws);
    const target = (vmId === "blade") ? 0.62 : 0.55;   // world units of overall length
    holder.scale.setScalar(target / Math.max(1e-6, ws.x));
    anchor.add(holder);
    held = holder; heldKey = key; heldAnchor = anchor; held.userData.heroGroup = hero.group;
    orientHeld();

    // hide the block heroes' decorative props so he is not holding two things
    if (hero.props) hero.props.forEach(p => { p.visible = false; });
  }
  function weaponFire()  { if (vm) { vm.fire();  UVM.uFlash.value = 1; } }
  function weaponSwing() { if (vm) { vm.swing(); UVM.uFlash.value = 0.6; } }

  /* =====================================================================
     CAMERA
     ===================================================================== */
  let viewMode = "first";
  /* Framing note: the hero is only ~2 cells from the lens, so raising the
     camera does NOT lift him up the frame, it pushes him DOWN it (the
     angle to a near object changes fast). A low shoulder-height boom is
     what keeps his head and torso clear of the question bar.          */
  /* A 0.9-tall character on a 2.0 boom filled 58% of the frame. 2.8 puts
     him around a third of frame height, which is the normal third-person
     read, and a 1-cell corridor is still wide enough for the boom to run
     down it before the wall check shortens it. */
  /* These maps were authored for first person: 1-cell corridors, 7x6 rooms,
     a 1.35 ceiling. A boom that keeps hitting walls used to leave the hero
     filling the screen, so the camera now CLIMBS when it runs out of room
     behind him and looks down at a steeper angle, the way a third-person
     game handles a small chamber. The hero stays visible almost everywhere
     and the player keeps seeing the dungeon instead of a helmet. */
  const TP = { dist: 2.80, height: 0.26, side: 0.32,
               heroScale: 0.72,
               /* Pinned against a wall you can either see the hero (by
                  staring almost straight down at him) or see where you are
                  going. Seeing forward wins, so the hero drops out early
                  rather than the camera pointing at the floor. */
               hideBoom: 1.05,
               riseMax: 0.34,      // extra camera height when fully pinned
               dropAim: 0.75,      // how far the look-at point sinks when pinned
               aimFar: 6.0, aimNear: 3.0,
               ceilPad: 0.16,      // never put the lens inside the ceiling
               /* Hard stop on how far down the lens can ever tip. The first
                  version had no clamp and a fully collapsed boom drove it to
                  -43 degrees, which is the "why am I looking at the floor"
                  shot. */
               pitchMin: -0.50, pitchMax: 0.14,
               /* Asymmetric on purpose: raising the lens is useful and
                  wants real range, but dropping it much below shoulder
                  height just buries the view in the hero's back, so the
                  downward half is deliberately short. */
               userRiseUp: 0.52, userDropUp: 1.70,
               userRiseDn: 0.16, userDropDn: 0.30 };
  let tightNow = 0;                // 0 = open room, 1 = boom fully collapsed
  let camTilt = 0, camTiltNow = 0; // manual camera height, -1 (low) .. +1 (high)

  /* Manual camera height. The auto behaviour handles tight rooms, but the
     player still gets the final say, because "where do I want the lens"
     is taste, not geometry. */
  function setCamTilt(v) {
    camTilt = Math.max(-1, Math.min(1, v || 0));
    return camTilt;
  }
  const getCamTilt = () => camTilt;
  let boomNow = TP.dist;                        // smoothed so walls do not snap

  function setView(mode) { viewMode = (mode === "third") ? "third" : "first"; }
  const getView = () => viewMode;

  /* march the boom backwards and stop at the first wall, so the camera
     never ends up inside stone when the hero backs into a corner        */
  function boomLength(px, py, ang) {
    const want = TP.dist;
    const step = 0.09;
    const bx = -Math.cos(ang), by = -Math.sin(ang);
    const pad = 0.30;
    for (let d = step; d <= want; d += step) {
      const x = px + bx * d, y = py + by * d;
      if (typeof solidAt === "function" &&
         (solidAt(x - pad, y - pad) || solidAt(x + pad, y - pad) ||
          solidAt(x - pad, y + pad) || solidAt(x + pad, y + pad)))
        return Math.max(0.34, d - step);
    }
    return want;
  }

  /* =====================================================================
     PROJECTION — screen coords straight off the live camera matrix.
     Returns null behind the camera. sx/sy are in the 2D canvas pixel
     space (480x300); h is the on-screen height of one world unit at that
     point, which is what the HUD code uses for sizing.
     ===================================================================== */
  const _v = (typeof THREE !== "undefined") ? new THREE.Vector3() : null;
  function project(wx, wy, wLift) {
    if (!ready || !camera) return null;
    _v.set(wx, wLift == null ? EYE : wLift, wy);
    const depth = _v.clone().applyMatrix4(camera.matrixWorldInverse).z * -1;
    if (depth <= 0.05) return null;
    _v.project(camera);
    const fy = 1 / Math.tan(vFov * Math.PI / 360);
    return {
      sx: (_v.x * 0.5 + 0.5) * RES_W,
      sy: (-_v.y * 0.5 + 0.5) * RES_H,
      ty: depth,
      h: (fy / depth) * RES_H * 0.5
    };
  }

  /* ---------- per-frame ---------- */
  let bobT = 0;
  function render(dt, moveAmt) {
    if (!ensure()) return;
    if (!levelGroup) buildLevel();
    if (!levelGroup || typeof p === "undefined") return;
    const now = performance.now() / 1000;
    dt = dt || 0.016;

    U.uTime.value = now;
    stepDoors(dt);

    bobT += dt * (6.2 + (moveAmt || 0) * 4);
    const bob  = Math.sin(bobT) * 0.012 * (moveAmt || 0);
    const sway = Math.cos(bobT * 0.5) * 0.006 * (moveAmt || 0);

    // the torch always hangs off the HERO, in both camera modes
    U.uEye.value.set(p.x, EYE + bob, p.y);
    if (heroTorch) {
      heroTorch.position.set(p.x, EYE + 0.35, p.y);
      heroTorch.intensity = 3.2 * U.uTorchI.value;
    }

    camera.rotation.order = "YXZ";
    if (viewMode === "third") {
      const want = boomLength(p.x, p.y, p.a);
      boomNow += (want - boomNow) * Math.min(1, dt * 9);
      const bx = -Math.cos(p.a) * boomNow, by = -Math.sin(p.a) * boomNow;
      // slide sideways too, but only as far as the wall allows
      const rx = -Math.sin(p.a), ry = Math.cos(p.a);
      let side = TP.side;
      if (typeof solidAt === "function")
        while (side > 0.02 && solidAt(p.x + bx + rx * side, p.y + by + ry * side)) side -= 0.06;
      /* How boxed in are we? 0 = the boom got everything it wanted,
         1 = it collapsed onto the hero. Smoothed so walking past a doorway
         does not snap the camera. */
      const tightWant = Math.max(0, Math.min(1, (TP.dist - boomNow) / (TP.dist - 0.55)));
      tightNow += (tightWant - tightNow) * Math.min(1, dt * 4.5);
      camTiltNow += (camTilt - camTiltNow) * Math.min(1, dt * 6);

      // climb as it tightens plus whatever the player dialled in, but never
      // poke through the ceiling
      const camY = Math.min(CEIL - TP.ceilPad,
                            EYE + TP.height + tightNow * TP.riseMax
                            + camTiltNow * (camTiltNow > 0 ? TP.userRiseUp : TP.userRiseDn)
                            + bob * 0.5);
      camera.position.set(p.x + bx + rx * side, camY, p.y + by + ry * side);

      /* Aim at a point on the HERO'S forward ray rather than just copying
         his heading. With an over-the-shoulder offset the two are not the
         same line, and if the camera merely looked parallel, the crosshair
         at screen centre would no longer sit on what the hero is facing,
         so shots would drift wide of the group the player has lined up.
         As the camera climbs, that point is pulled in and dropped, which
         tips the lens down over the hero instead of past him. */
      const AIM = TP.aimFar + (TP.aimNear - TP.aimFar) * tightNow;
      const tx = p.x + Math.cos(p.a) * AIM, tz = p.y + Math.sin(p.a) * AIM;
      const ty = EYE - tightNow * TP.dropAim
                     - camTiltNow * (camTiltNow > 0 ? TP.userDropUp : TP.userDropDn);
      let dx = tx - camera.position.x, dy = ty - camera.position.y, dz = tz - camera.position.z;
      const flat = Math.hypot(dx, dz) || 1e-6;
      camera.rotation.y = Math.atan2(-dx, -dz);
      camera.rotation.x = Math.max(TP.pitchMin, Math.min(TP.pitchMax,
                            Math.atan2(dy, flat))) + sway * 0.4;
      camera.rotation.z = sway * 0.25;
    } else {
      camera.position.set(p.x, EYE + bob, p.y);
      camera.rotation.y = -p.a - Math.PI / 2;
      camera.rotation.x = sway;
      camera.rotation.z = sway * 0.5;
    }
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

    U.uTorchI.value = 0.92 + Math.sin(now * 11.3) * 0.05 + Math.sin(now * 27.7) * 0.03;
    UVM.uFlash.value = Math.max(0, UVM.uFlash.value - dt * 7);

    // third-person character: stand him on the floor, face him down p.a
    if (hero) {
      /* Back into a corner and the boom collapses toward the hero's own
         head; at that point he fills the screen and blinds the player, so
         drop him out the way every third-person game does. */
      const third = viewMode === "third" && boomNow > TP.hideBoom;
      hero.group.visible = third;
      if (third) {
        hero.group.position.set(p.x, 0, p.y);
        /* The rig's forward is its local -Z. Solving R_y(t)*(0,0,-1) for the
           heading (cos a, 0, sin a) gives t = -a - PI/2, the same yaw the
           first-person camera uses. The earlier +PI/2 was half a turn out,
           so the hero walked forwards while facing the camera. */
        hero.group.rotation.y = -p.a - Math.PI / 2;
        hero.group.scale.setScalar(TP.heroScale);
        hero.update(now, moveAmt || 0, {});
      }
    }
    if (vm) vm.update(now, moveAmt || 0, {});
    if (hero && viewMode === "third") { attachHeldWeapon(); orientHeld(); }

    for (const s of flameGroup.children) {
      const k = 1 + Math.sin(now * 9 + s.userData.seed) * 0.14;
      s.scale.set(0.42 * k, 0.55 * k, 1);
    }

    renderer.render(scene, camera);

    // held weapon last, on a cleared depth buffer, first person only
    if (vm && viewMode !== "third") {
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(vmScene, vmCam);
      renderer.autoClear = true;
    }
  }

  /* test hook: render one frame on demand and toggle the creature layer,
     so an automated occlusion test can diff the two framebuffers */
  function _debugRender(withSprites){
    if (!ready) return false;
    if (spriteMesh) spriteMesh.visible = withSprites && spriteMesh.userData.hadSprites !== false;
    renderer.render(scene, camera);
    return true;
  }

  return {
    buildLevel, buildDoors, render, project, setSprites, setRings, _debugRender,
    get renderer(){ return renderer; }, get spriteMesh(){ return spriteMesh; },
    setView, getView, openDoor, isDoorBusy, isDoorGone,
    setCharacter, getCharacter, setWeapon, weaponFire, weaponSwing, tuneVM, attachHeldWeapon,
    get heroInfo(){ return heroInfo; },
    get hero(){ return hero; },
    get vm(){ return vm; },
    setCamTilt, getCamTilt, muzzleScreen, meshStatus,
    /* 0..1: how much of the wanted boom the camera actually got. The game
       fades the hero out as this drops, so backing into a corner does not
       shove a giant wizard across the screen. */
    get boom(){ return Math.min(1, boomNow / TP.dist); },
    get boomDist(){ return boomNow; },
    CEIL, EYE, RES_W, RES_H, DOOR_OPEN_TIME,
    get camera(){ return camera; }, get scene(){ return scene; },
    get ready(){ return ready; }, get torches(){ return torches.length; }
  };
})();
