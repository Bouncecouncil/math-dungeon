/* =====================================================================
   MATH DUNGEON — REAL 3D MODELS
   ---------------------------------------------------------------------
   Replaces two fakes:

     1. The third-person "hero" was a 96px emoji baked to a texture and
        stretched across half the screen. Flat, no legs, no animation,
        and always facing the camera no matter which way you walked.

     2. The first-person weapon was vector shapes painted on the 2D
        canvas by drawGun(). No perspective, no lighting, no depth, so
        it read as a sticker rather than something being held.

   Both are now actual geometry built from boxes and cylinders, lit by
   the same torch the walls use, with real animation. Everything here is
   procedural: no external model files, so the game still runs offline
   from file:// with nothing to load.

   API
     MODELS.characters                 -> [{id,name,blurb}]
     MODELS.weapons                    -> [{id,name,blurb}]
     MODELS.buildCharacter(id, mkMat)  -> {group, update(t, moveAmt, o)}
     MODELS.buildWeapon(id, mkMat, c)  -> {group, update(t, moveAmt, o)}

   mkMat(hexColor) returns a Material. The game passes its N64 shader;
   the picker page passes a plain material. Same models either way.
   ===================================================================== */
const MODELS = (function () {
  "use strict";

  /* ---------- tiny geometry helpers ---------- */
  const geoCache = {};
  function boxGeo(w, h, d) {
    const k = "b" + w + "_" + h + "_" + d;
    return geoCache[k] || (geoCache[k] = new THREE.BoxGeometry(w, h, d));
  }
  function cylGeo(rt, rb, h, seg) {
    const k = "c" + rt + "_" + rb + "_" + h + "_" + seg;
    return geoCache[k] || (geoCache[k] = new THREE.CylinderGeometry(rt, rb, h, seg));
  }
  function coneGeo(r, h, seg) {
    const k = "n" + r + "_" + h + "_" + seg;
    return geoCache[k] || (geoCache[k] = new THREE.ConeGeometry(r, h, seg));
  }

  /* add a box to `parent`, centred at (x,y,z) */
  function box(parent, mk, color, w, h, d, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(boxGeo(w, h, d), mk(color));
    m.position.set(x || 0, y || 0, z || 0);
    if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
    parent.add(m);
    return m;
  }
  function cyl(parent, mk, color, rt, rb, h, seg, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(cylGeo(rt, rb, h, seg || 8), mk(color));
    m.position.set(x || 0, y || 0, z || 0);
    if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
    parent.add(m);
    return m;
  }
  function cone(parent, mk, color, r, h, seg, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(coneGeo(r, h, seg || 8), mk(color));
    m.position.set(x || 0, y || 0, z || 0);
    if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
    parent.add(m);
    return m;
  }
  function grp(parent, x, y, z) {
    const g = new THREE.Group();
    g.position.set(x || 0, y || 0, z || 0);
    if (parent) parent.add(g);
    return g;
  }

  /* =====================================================================
     CHARACTERS
     Shared humanoid frame, ~0.90 units tall with feet at y = 0, so the
     model stands on the dungeon floor and clears the 1.35 ceiling. Big
     head, short limbs: reads at a distance and looks right to a seven
     year old. Each character then dresses that frame differently.
     ===================================================================== */

  const HIP_Y = 0.30, SHOULDER_Y = 0.60, HEAD_Y = 0.66;

  /* builds legs/arms/torso/head and returns the animated handles */
  function humanoid(root, mk, C) {
    const rig = {};

    // ---- legs (pivot at the hip so they swing from the top) ----
    rig.legL = grp(root, -0.075, HIP_Y, 0);
    rig.legR = grp(root,  0.075, HIP_Y, 0);
    [[rig.legL, -1], [rig.legR, 1]].forEach(([g]) => {
      box(g, mk, C.leg, 0.10, 0.26, 0.12, 0, -0.13, 0);
      box(g, mk, C.boot, 0.12, 0.07, 0.16, 0, -0.245, 0.02);   // boot
    });

    // ---- body ----
    rig.body = grp(root, 0, 0, 0);
    box(rig.body, mk, C.belt,  0.24, 0.08, 0.17, 0, HIP_Y + 0.04, 0);
    rig.torso = box(rig.body, mk, C.torso, 0.29, 0.24, 0.18, 0, HIP_Y + 0.20, 0);

    // ---- arms (pivot at the shoulder) ----
    rig.armL = grp(rig.body, -0.185, SHOULDER_Y, 0);
    rig.armR = grp(rig.body,  0.185, SHOULDER_Y, 0);
    [rig.armL, rig.armR].forEach(g => {
      box(g, mk, C.arm,  0.085, 0.22, 0.095, 0, -0.11, 0);
      box(g, mk, C.glove, 0.095, 0.07, 0.105, 0, -0.245, 0);   // hand
    });

    // right-hand anchor: the equipped weapon is attached here in third person
    rig.handR = grp(rig.armR, 0, -0.26, 0);
    rig.props = [];            // decorative held items, hidden when a real weapon is equipped

    // ---- head ----
    rig.head = grp(rig.body, 0, HEAD_Y, 0);
    box(rig.head, mk, C.skin, 0.23, 0.21, 0.21, 0, 0.105, 0);
    // eyes sit on the FRONT face (-Z is forward for this rig)
    box(rig.head, mk, 0x101018, 0.045, 0.05, 0.02, -0.055, 0.115, -0.108);
    box(rig.head, mk, 0x101018, 0.045, 0.05, 0.02,  0.055, 0.115, -0.108);
    box(rig.head, mk, 0xffffff, 0.018, 0.02, 0.012, -0.048, 0.125, -0.114);
    box(rig.head, mk, 0xffffff, 0.018, 0.02, 0.012,  0.062, 0.125, -0.114);

    return rig;
  }

  function animateHumanoid(rig, t, moveAmt, o) {
    const m = Math.max(0, Math.min(1, moveAmt || 0));
    const sw = Math.sin(t * 9);
    rig.legL.rotation.x =  sw * 0.75 * m;
    rig.legR.rotation.x = -sw * 0.75 * m;
    rig.armL.rotation.x = -sw * 0.45 * m;
    rig.armR.rotation.x =  sw * 0.45 * m;
    // bob twice per stride, plus a slow idle breath when standing still
    rig.body.position.y = Math.abs(Math.sin(t * 9)) * 0.022 * m
                        + Math.sin(t * 1.8) * 0.006 * (1 - m);
    rig.body.rotation.z = Math.sin(t * 9) * 0.035 * m;
    rig.head.rotation.y = Math.sin(t * 0.7) * 0.18 * (1 - m);   // idle look-around
    if (rig.torso) rig.torso.scale.y = 1 + Math.sin(t * 2.2) * 0.02 * (1 - m);
    if (rig.extra) rig.extra(t, m, o);
  }

  const CHARS = {};

  /* ---- 1. KNIGHT ---- */
  CHARS.knight = {
    name: "The Knight", blurb: "Steel plate, horned helm, big sword",
    build(mk) {
      const root = grp(null, 0, 0, 0);
      const C = { leg: 0x8d96ad, boot: 0x4a5163, torso: 0x9aa4bd, belt: 0x6b4423,
                  arm: 0x8d96ad, glove: 0x4a5163, skin: 0xe8b98d };
      const rig = humanoid(root, mk, C);
      // tabard + helm
      box(rig.body, mk, 0x2f6fd0, 0.16, 0.22, 0.02, 0, HIP_Y + 0.19, -0.10);
      box(rig.head, mk, 0xb9c3da, 0.25, 0.16, 0.23, 0, 0.16, 0);        // helm dome
      box(rig.head, mk, 0x11151f, 0.19, 0.045, 0.02, 0, 0.115, -0.112); // visor slit
      cone(rig.head, mk, 0xe6ecf7, 0.035, 0.13, 6, -0.135, 0.25, 0, 0, 0, -0.5);
      cone(rig.head, mk, 0xe6ecf7, 0.035, 0.13, 6,  0.135, 0.25, 0, 0, 0,  0.5);
      // cape
      const cape = box(rig.body, mk, 0xc0392b, 0.28, 0.34, 0.02, 0, HIP_Y + 0.16, 0.105);
      // shield on the left arm, sword in the right
      box(rig.armL, mk, 0x3d7fd8, 0.03, 0.20, 0.17, -0.04, -0.20, 0);
      box(rig.armL, mk, 0xe6ecf7, 0.012, 0.10, 0.09, -0.058, -0.20, 0);
      const sword = grp(rig.armR, 0, -0.26, 0); rig.props.push(sword);
      box(sword, mk, 0x6b4423, 0.03, 0.09, 0.03, 0, 0, 0);
      box(sword, mk, 0xd9b310, 0.11, 0.025, 0.04, 0, 0.055, 0);
      box(sword, mk, 0xdfe7f5, 0.045, 0.36, 0.018, 0, 0.25, 0);
      rig.extra = (t, m) => { cape.rotation.x = -0.12 - Math.sin(t * 9) * 0.10 * m; };
      return { root, rig };
    }
  };

  /* ---- 2. WIZARD ---- */
  CHARS.wizard = {
    name: "The Mage", blurb: "Long robe, pointed hat, glowing staff",
    build(mk) {
      const root = grp(null, 0, 0, 0);
      const C = { leg: 0x3b2a6b, boot: 0x241a45, torso: 0x5a3fa8, belt: 0xd9b310,
                  arm: 0x5a3fa8, glove: 0xe8b98d, skin: 0xe8b98d };
      const rig = humanoid(root, mk, C);
      // robe skirt flaring over the legs
      cyl(rig.body, mk, 0x5a3fa8, 0.13, 0.24, 0.34, 8, 0, HIP_Y - 0.05, 0);
      box(rig.body, mk, 0xd9b310, 0.10, 0.18, 0.02, 0, HIP_Y + 0.18, -0.10);
      // pointed hat
      cyl(rig.head, mk, 0x3b2a6b, 0.20, 0.20, 0.03, 8, 0, 0.215, 0);
      cone(rig.head, mk, 0x4a3388, 0.155, 0.34, 8, 0, 0.40, 0, 0.10, 0, 0.06);
      box(rig.head, mk, 0xd9b310, 0.20, 0.035, 0.20, 0, 0.235, 0);
      // beard
      box(rig.head, mk, 0xe8eef8, 0.13, 0.11, 0.04, 0, 0.035, -0.10);
      // staff with a crystal
      const staff = grp(rig.armR, 0, -0.26, 0); rig.props.push(staff);
      cyl(staff, mk, 0x6b4423, 0.016, 0.016, 0.62, 6, 0, 0.20, 0);
      const crystal = cone(staff, mk, 0x3ce8b0, 0.055, 0.13, 6, 0, 0.55, 0);
      rig.extra = (t) => { crystal.rotation.y = t * 1.6; crystal.position.y = 0.55 + Math.sin(t * 2.4) * 0.012; };
      return { root, rig };
    }
  };

  /* ---- 3. NINJA ---- */
  CHARS.ninja = {
    name: "The Shadow", blurb: "Hooded, quick, twin daggers",
    build(mk) {
      const root = grp(null, 0, 0, 0);
      const C = { leg: 0x1e222e, boot: 0x0d0f16, torso: 0x272c3b, belt: 0xc0392b,
                  arm: 0x1e222e, glove: 0x0d0f16, skin: 0x3a4152 };
      const rig = humanoid(root, mk, C);
      box(rig.head, mk, 0x272c3b, 0.25, 0.19, 0.23, 0, 0.15, 0);         // hood
      box(rig.head, mk, 0x272c3b, 0.24, 0.11, 0.06, 0, 0.055, -0.095);   // mask
      const scarf = box(rig.body, mk, 0xc0392b, 0.09, 0.30, 0.02, 0.02, HIP_Y + 0.16, 0.10);
      box(rig.body, mk, 0xc0392b, 0.24, 0.05, 0.19, 0, HIP_Y + 0.30, 0);
      [rig.armL, rig.armR].forEach((g, i) => {
        const d = grp(g, 0, -0.26, 0); rig.props.push(d);
        box(d, mk, 0x0d0f16, 0.025, 0.07, 0.025, 0, 0, 0);
        box(d, mk, 0xcfd8e8, 0.03, 0.19, 0.012, 0, 0.13, 0);
        d.rotation.z = i ? -0.25 : 0.25;
      });
      rig.extra = (t, m) => { scarf.rotation.x = -0.18 - Math.sin(t * 7) * 0.35 * (0.3 + m); };
      return { root, rig };
    }
  };

  /* ---- 4. ROBOT ---- */
  CHARS.robot = {
    name: "BEEP-9", blurb: "Boxy chrome bot with a glowing visor",
    build(mk) {
      const root = grp(null, 0, 0, 0);
      const C = { leg: 0x7f8896, boot: 0x3d434f, torso: 0xa8b2c0, belt: 0x3d434f,
                  arm: 0x7f8896, glove: 0xf2b705, skin: 0x8f99a8 };
      const rig = humanoid(root, mk, C);
      box(rig.body, mk, 0x2b3038, 0.15, 0.09, 0.02, 0, HIP_Y + 0.24, -0.10); // chest panel
      box(rig.body, mk, 0x35e0ff, 0.045, 0.045, 0.012, 0, HIP_Y + 0.24, -0.112);
      box(rig.head, mk, 0x8f99a8, 0.25, 0.10, 0.22, 0, 0.20, 0);
      box(rig.head, mk, 0x35e0ff, 0.20, 0.06, 0.02, 0, 0.115, -0.108);      // visor bar
      cyl(rig.head, mk, 0x3d434f, 0.012, 0.012, 0.15, 6, 0, 0.30, 0);       // antenna
      const bulb = box(rig.head, mk, 0xff4d4d, 0.05, 0.05, 0.05, 0, 0.385, 0);
      // shoulder pauldrons
      box(rig.armL, mk, 0xa8b2c0, 0.11, 0.09, 0.13, -0.02, 0.01, 0);
      box(rig.armR, mk, 0xa8b2c0, 0.11, 0.09, 0.13,  0.02, 0.01, 0);
      rig.extra = (t) => { bulb.scale.setScalar(0.8 + Math.abs(Math.sin(t * 3)) * 0.5); };
      return { root, rig };
    }
  };

  /* ---- 5. EXPLORER ---- */
  CHARS.explorer = {
    name: "The Explorer", blurb: "Cap, backpack, torch in hand",
    build(mk) {
      const root = grp(null, 0, 0, 0);
      const C = { leg: 0x3f6b3a, boot: 0x5a3c1e, torso: 0x2e8b57, belt: 0x5a3c1e,
                  arm: 0xe8b98d, glove: 0x8a5a2b, skin: 0xe8b98d };
      const rig = humanoid(root, mk, C);
      box(rig.body, mk, 0xf2f2f2, 0.20, 0.16, 0.02, 0, HIP_Y + 0.22, -0.10);  // shirt
      box(rig.body, mk, 0x8a5a2b, 0.22, 0.24, 0.11, 0, HIP_Y + 0.20, 0.14);   // backpack
      box(rig.body, mk, 0x5a3c1e, 0.22, 0.05, 0.02, 0, HIP_Y + 0.26, 0.19);
      box(rig.head, mk, 0xd9482b, 0.24, 0.07, 0.23, 0, 0.225, 0);             // cap
      box(rig.head, mk, 0xd9482b, 0.20, 0.025, 0.10, 0, 0.20, -0.14);         // brim
      box(rig.head, mk, 0x6b3f1d, 0.235, 0.06, 0.10, 0, 0.175, 0.075);        // hair
      // a lit torch in the right hand
      const torch = grp(rig.armR, 0, -0.27, 0); rig.props.push(torch);
      cyl(torch, mk, 0x5a3c1e, 0.018, 0.022, 0.22, 6, 0, 0.09, 0);
      const flame = cone(torch, mk, 0xffa726, 0.048, 0.15, 6, 0, 0.25, 0);
      rig.extra = (t) => {
        flame.scale.set(1 + Math.sin(t * 13) * 0.16, 1 + Math.sin(t * 9) * 0.22, 1);
        flame.rotation.y = t * 3;
      };
      return { root, rig };
    }
  };

  /* ---- 6. DRAGON ---- */
  CHARS.dragon = {
    name: "Lil' Dragon", blurb: "Wings, tail, and a lot of attitude",
    build(mk) {
      const root = grp(null, 0, 0, 0);
      const C = { leg: 0x3fa34d, boot: 0xd9b310, torso: 0x46b858, belt: 0x2e7d3a,
                  arm: 0x3fa34d, glove: 0xd9b310, skin: 0x52c964 };
      const rig = humanoid(root, mk, C);
      box(rig.body, mk, 0xf7e08a, 0.18, 0.22, 0.02, 0, HIP_Y + 0.19, -0.10);  // belly
      // snout + horns
      box(rig.head, mk, 0x52c964, 0.14, 0.09, 0.10, 0, 0.075, -0.145);
      box(rig.head, mk, 0xf7e08a, 0.10, 0.02, 0.06, 0, 0.048, -0.165);
      cone(rig.head, mk, 0xf2f2f2, 0.028, 0.11, 6, -0.075, 0.235, 0.02, -0.2, 0, -0.25);
      cone(rig.head, mk, 0xf2f2f2, 0.028, 0.11, 6,  0.075, 0.235, 0.02, -0.2, 0,  0.25);
      // wings
      const wingL = grp(rig.body, -0.14, HIP_Y + 0.26, 0.08);
      const wingR = grp(rig.body,  0.14, HIP_Y + 0.26, 0.08);
      box(wingL, mk, 0x2e7d3a, 0.02, 0.20, 0.24, -0.06, 0.02, 0.10);
      box(wingR, mk, 0x2e7d3a, 0.02, 0.20, 0.24,  0.06, 0.02, 0.10);
      // tail: three tapering segments
      const tail = grp(rig.body, 0, HIP_Y - 0.02, 0.10);
      const t1 = box(tail, mk, 0x46b858, 0.10, 0.10, 0.16, 0, 0, 0.08);
      const t2 = grp(tail, 0, 0, 0.16); box(t2, mk, 0x3fa34d, 0.075, 0.075, 0.15, 0, 0, 0.075);
      const t3 = grp(t2, 0, 0, 0.15);   cone(t3, mk, 0xf7e08a, 0.05, 0.14, 6, 0, 0, 0.07, Math.PI / 2, 0, 0);
      rig.extra = (t, m) => {
        const f = Math.sin(t * 6);
        wingL.rotation.z =  0.35 + f * 0.45 * (0.4 + m);
        wingR.rotation.z = -0.35 - f * 0.45 * (0.4 + m);
        tail.rotation.y = Math.sin(t * 3.2) * 0.30;
        t2.rotation.y   = Math.sin(t * 3.2 - 0.6) * 0.35;
        t3.rotation.y   = Math.sin(t * 3.2 - 1.2) * 0.35;
      };
      return { root, rig };
    }
  };

  function buildCharacter(id, mk) {
    const def = CHARS[id] || CHARS.knight;
    const built = def.build(mk);
    return {
      group: built.root,
      handR: built.rig.handR,
      props: built.rig.props,
      update: (t, moveAmt, o) => animateHumanoid(built.rig, t, moveAmt, o)
    };
  }

  /* =====================================================================
     FIRST-PERSON WEAPON VIEWMODELS
     Built the way real shooters frame them: the weapon sits low-right,
     angled in toward the centre of the screen, with two gloved hands on
     it and a forearm running off the bottom-right corner. Camera space,
     so -Z is forward.
     ===================================================================== */

  /* a gloved hand + forearm, aimed back toward the bottom-right corner */
  function hand(parent, mk, x, y, z, rot) {
    const g = grp(parent, x, y, z);
    if (rot) g.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
    box(g, mk, 0x6d5a4a, 0.046, 0.044, 0.056, 0, 0, 0);            // glove
    box(g, mk, 0x3d3229, 0.050, 0.020, 0.030, 0, 0.030, -0.010);   // knuckles
    box(g, mk, 0x6b5646, 0.040, 0.038, 0.090, 0, -0.010, 0.066);   // forearm
    box(g, mk, 0x8a6f57, 0.050, 0.020, 0.030, 0, 0.006, 0.040);    // wrist cuff
    return g;
  }

  const WEAPS = {};

  /* ---- BLASTER: the projectile track ----
     Proportions matter more than detail here. A real rifle silhouette is
     a LONG thin barrel with a compact receiver behind it; the first pass
     had a stubby barrel on a fat receiver, which read as a grey brick.  */
  WEAPS.blaster = {
    name: "Blaster", blurb: "Sci-fi rifle, glowing energy cell",
    build(mk, accent) {
      // Framing. The near end (stock, forearms) must sit well behind the
      // 0.01 near-clip or perspective blows it up to fill the screen, and
      // the question bar owns the bottom ~27%, so this rides a little
      // higher and further out than a normal shooter would put it.
      const root = grp(null, 0.125, -0.058, -0.470);
      root.scale.setScalar(0.88);
      root.rotation.set(0.015, 0.245, 0.045);

      const body  = 0x464d5c;   // receiver: darkest
      const guard = 0x6e7789;   // handguard: mid
      const steel = 0x9aa4ba;   // barrel + rails: lightest
      const rub   = 0x2f343f;   // grips and stock pad

      // ---- receiver: compact, the anchor everything hangs off ----
      box(root, mk, body,  0.046, 0.056, 0.150, 0, 0, 0.020);
      box(root, mk, steel, 0.050, 0.010, 0.170, 0, 0.033, 0.015);     // top rail
      box(root, mk, rub,   0.040, 0.048, 0.070, 0, -0.006, 0.128);    // stock
      box(root, mk, rub,   0.044, 0.062, 0.016, 0, -0.008, 0.166);    // butt pad

      // ---- handguard, then a LONG thin barrel: this is the silhouette ----
      box(root, mk, guard, 0.040, 0.040, 0.175, 0, 0.002, -0.145);
      box(root, mk, body,  0.046, 0.008, 0.150, 0, 0.024, -0.140);    // vent slots
      box(root, mk, body,  0.046, 0.008, 0.150, 0, -0.020, -0.140);
      cyl(root, mk, steel, 0.014, 0.014, 0.300, 8, 0, 0.002, -0.390, Math.PI / 2, 0, 0);
      cyl(root, mk, body,  0.021, 0.021, 0.055, 8, 0, 0.002, -0.520, Math.PI / 2, 0, 0);
      box(root, mk, steel, 0.030, 0.012, 0.040, 0, 0.020, -0.300);    // front sight

      // ---- magazine, angled forward the way a real one sits ----
      box(root, mk, rub,   0.032, 0.100, 0.044, 0, -0.075, -0.028, 0.24, 0, 0);
      // ---- pistol grip ----
      box(root, mk, rub,   0.034, 0.082, 0.042, 0, -0.062, 0.078, -0.34, 0, 0);
      box(root, mk, body,  0.026, 0.009, 0.048, 0, -0.036, 0.036);    // trigger guard

      // ---- optic ----
      cyl(root, mk, body,  0.018, 0.018, 0.080, 8, 0, 0.058, -0.010, Math.PI / 2, 0, 0);
      box(root, mk, body,  0.016, 0.022, 0.016, 0, 0.044, 0.016);
      box(root, mk, body,  0.016, 0.022, 0.016, 0, 0.044, -0.036);
      const lens = cyl(root, mk, accent, 0.015, 0.015, 0.006, 8, 0, 0.058, -0.052, Math.PI / 2, 0, 0);

      // ---- the accent parts tie the gun to the level palette ----
      const cell = box(root, mk, accent, 0.022, 0.026, 0.062, 0, 0.004, 0.070);
      const vent = box(root, mk, accent, 0.036, 0.005, 0.110, 0, -0.022, -0.145);

      // ---- hands: right on the grip, left forward on the handguard ----
      const rHand = hand(root, mk, 0.004, -0.104, 0.100, [0.30, 0.10, 0.06]);
      const lHand = hand(root, mk, -0.002, -0.050, -0.170, [0.55, 0.55, 0.00]);

      // ---- muzzle flash, hidden until a shot fires ----
      const flash = grp(root, 0, 0.002, -0.560);
      const fa = cone(flash, mk, 0xfff2b0, 0.048, 0.115, 6, 0, 0, -0.05, -Math.PI / 2, 0, 0);
      const fb = cone(flash, mk, accent,   0.075, 0.080, 6, 0, 0, -0.02, -Math.PI / 2, 0, 0);
      flash.visible = false;

      return { root, parts: { flash, fa, fb, cell, vent, lens, rHand, lHand },
               rest: root.position.clone(), restRot: root.rotation.clone(), kick: 0 };
    }
  };

  /* ---- BLADE: the melee track ----
     Five sword designs share one upright viewmodel pose and one swing.
     Every blade runs down local -Z from the guard; the grip runs +Z toward
     the camera. The tip is a flat wedge: a 4-sided cone SCALED so its
     cross-section matches the blade (width in X, thickness in Y). The old
     tip used the cone's raw radius, which is wider than the blade is
     thick, so from the side it flared into a shovel.                   */
  /* An exact flat blade tip: a triangular prism whose base is the blade's
     own cross-section (width x thickness) and whose apex sits `len` further
     down -Z. Built from raw vertices so nothing is wider than the blade.
     The earlier version scaled a 4-sided cone and still overshot the blade
     width by 40%, which is the "shovel" that showed up in the screenshot. */
  const wedgeCache = {};
  function wedgeGeo(w, t, len) {
    const k = "w" + w + "_" + t + "_" + len;
    if (wedgeCache[k]) return wedgeCache[k];
    const hw = w / 2, ht = t / 2;
    // base rectangle at z=0, apex at z=-len (a thin edge line, not a point,
    // so the very tip keeps the blade's thickness feel)
    const A = [-hw, -ht, 0], B = [hw, -ht, 0], C = [hw, ht, 0], D = [-hw, ht, 0];
    const P = [0, -ht * 0.35, -len], Q = [0, ht * 0.35, -len];
    const tri = [];
    const push = (p1, p2, p3) => tri.push(...p1, ...p2, ...p3);
    push(A, B, C); push(A, C, D);          // base (faces back toward the guard)
    push(B, A, P); push(D, C, Q);          // bottom + top faces
    push(A, D, Q); push(A, Q, P);          // left face
    push(C, B, P); push(C, P, Q);          // right face
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(tri, 3));
    g.computeVertexNormals();
    wedgeCache[k] = g;
    return g;
  }
  function wedge(parent, mk, color, width, thick, len, z) {
    const m = new THREE.Mesh(wedgeGeo(width, thick, len), mk(color));
    m.position.set(0, 0, z);
    parent.add(m);
    return m;
  }
  /* a curved blade: n short boxes, each yawed a little more than the last */
  function curvedBlade(parent, mk, color, width, thick, len, segs, bend, zStart) {
    let x = 0, z = zStart, yaw = 0; const L = len / segs; const parts = [];
    for (let i = 0; i < segs; i++) {
      const seg = box(parent, mk, color, width, thick, L * 1.04, 0, 0, 0);
      seg.rotation.y = yaw;
      seg.position.set(x + Math.sin(yaw) * L * 0.5, 0, z - Math.cos(yaw) * L * 0.5);
      x += Math.sin(yaw) * L; z -= Math.cos(yaw) * L; yaw += bend;
      parts.push(seg);
    }
    return { end: { x, z, yaw }, parts };
  }

  const SWORDS = {};
  SWORDS.crystal = {
    name: "Crystal Longsword", blurb: "Straight blade, glowing fuller, gold cross-guard",
    build(root, mk, accent) {
      const steel = 0xd6e2f5, edge = 0xf4f9ff, gold = 0xe8c33c, wrap = 0x4a3324, dark = 0x3a3f4c;
      cyl(root, mk, wrap, 0.015, 0.017, 0.130, 8, 0, 0, 0.098, Math.PI / 2, 0, 0);
      box(root, mk, gold, 0.030, 0.030, 0.024, 0, 0, 0.172);
      box(root, mk, gold, 0.125, 0.024, 0.030, 0, 0, 0.020);
      box(root, mk, dark, 0.034, 0.030, 0.026, 0, 0, 0.020);
      box(root, mk, accent, 0.030, 0.014, 0.018, 0, 0.006, 0.020);
      box(root, mk, edge,  0.050, 0.017, 0.400, 0, 0, -0.205);
      box(root, mk, steel, 0.052, 0.006, 0.400, 0, -0.008, -0.205);
      box(root, mk, accent, 0.012, 0.019, 0.350, 0, 0.001, -0.200);
      wedge(root, mk, edge, 0.050, 0.017, 0.090, -0.405);
      return { grip: [0.088, 0.150] };
    }
  };
  SWORDS.cleaver = {
    name: "Bone Cleaver", blurb: "Wide single-edge chopper, notched, dark iron",
    build(root, mk, accent) {
      const iron = 0x6b7280, dark = 0x2b2f3a, bone = 0xe8dcc0, wrap = 0x3b2a1d;
      cyl(root, mk, wrap, 0.017, 0.019, 0.120, 8, 0, 0, 0.090, Math.PI / 2, 0, 0);
      box(root, mk, bone, 0.036, 0.036, 0.030, 0, 0, 0.160);          // bone pommel
      box(root, mk, dark, 0.060, 0.030, 0.026, 0, 0, 0.022);          // stubby guard
      box(root, mk, iron, 0.075, 0.020, 0.300, 0, 0, -0.160);         // broad body
      box(root, mk, dark, 0.075, 0.021, 0.060, 0, 0, -0.045);         // ricasso
      box(root, mk, accent, 0.008, 0.024, 0.240, -0.024, 0, -0.165);  // glowing edge line
      // notches bitten out of the back edge
      box(root, mk, 0x0b0d12, 0.012, 0.024, 0.020, 0.036, 0, -0.120);
      box(root, mk, 0x0b0d12, 0.012, 0.024, 0.020, 0.036, 0, -0.200);
      wedge(root, mk, iron, 0.075, 0.020, 0.070, -0.310);
      return { grip: [0.078, 0.135] };
    }
  };
  SWORDS.katana = {
    name: "Shadow Katana", blurb: "Slim curved blade, round tsuba, cord-wrapped grip",
    build(root, mk, accent) {
      const steel = 0xe4ecf7, dark = 0x1e222c, cord = 0x2a2f3c, brass = 0xcaa14a;
      cyl(root, mk, cord, 0.014, 0.015, 0.150, 8, 0, 0, 0.100, Math.PI / 2, 0, 0);
      for (let i = 0; i < 5; i++) box(root, mk, brass, 0.031, 0.031, 0.006, 0, 0, 0.040 + i * 0.026);
      cyl(root, mk, dark, 0.036, 0.036, 0.008, 12, 0, 0, 0.020, Math.PI / 2, 0, 0); // tsuba
      const c = curvedBlade(root, mk, steel, 0.028, 0.010, 0.400, 5, 0.05, -0.024);
      box(root, mk, accent, 0.007, 0.012, 0.380, 0.004, 0, -0.214);   // hamon glow
      const tip = wedge(root, mk, steel, 0.028, 0.010, 0.070, c.end.z);
      tip.position.x = c.end.x; tip.rotation.y = c.end.yaw;
      return { grip: [0.070, 0.150] };
    }
  };
  SWORDS.scimitar = {
    name: "Flame Scimitar", blurb: "Curved desert blade with an inner fire glow",
    build(root, mk, accent) {
      const steel = 0xf2e3b8, gold = 0xe8c33c, wrap = 0x5a2f16, ember = 0xff7a2a;
      cyl(root, mk, wrap, 0.015, 0.018, 0.120, 8, 0, 0, 0.090, Math.PI / 2, 0, 0);
      box(root, mk, gold, 0.034, 0.034, 0.026, 0, 0, 0.160);
      box(root, mk, gold, 0.090, 0.022, 0.028, 0, 0, 0.020, 0, 0, 0.35); // swept guard
      const c = curvedBlade(root, mk, steel, 0.046, 0.012, 0.380, 6, 0.09, -0.022);
      const g = curvedBlade(root, mk, ember, 0.014, 0.014, 0.330, 6, 0.09, -0.032);
      g.parts.forEach(p => { p.position.y = 0.001; });
      const tip = wedge(root, mk, steel, 0.046, 0.012, 0.080, c.end.z);
      tip.position.x = c.end.x; tip.rotation.y = c.end.yaw;
      return { grip: [0.076, 0.135] };
    }
  };
  SWORDS.rapier = {
    name: "Lightning Rapier", blurb: "Needle-thin blade, cup guard, crackling accent",
    build(root, mk, accent) {
      const steel = 0xeef3ff, silver = 0xb9c3da, wrap = 0x22262f;
      cyl(root, mk, wrap, 0.012, 0.014, 0.120, 8, 0, 0, 0.092, Math.PI / 2, 0, 0);
      box(root, mk, silver, 0.026, 0.026, 0.024, 0, 0, 0.160);
      cyl(root, mk, silver, 0.055, 0.020, 0.040, 12, 0, 0, 0.030, -Math.PI / 2, 0, 0); // cup
      box(root, mk, silver, 0.110, 0.010, 0.010, 0, 0, 0.012);                       // quillons
      box(root, mk, steel, 0.016, 0.016, 0.430, 0, 0, -0.215);
      box(root, mk, accent, 0.006, 0.020, 0.400, 0, 0, -0.210);
      wedge(root, mk, steel, 0.016, 0.016, 0.070, -0.430);
      return { grip: [0.076, 0.132] };
    }
  };

  /* which design the player chose; the picker writes this key */
  function swordChoice() {
    try { return localStorage.getItem("mathDungeonSword") || "crystal"; } catch (e) { return "crystal"; }
  }

  WEAPS.blade = {
    name: "Blade", blurb: "Two-handed sword, held ready",
    build(mk, accent, designId) {
      const root = grp(null, 0.115, -0.115, -0.450);
      root.scale.setScalar(0.62);
      root.rotation.set(1.15, 0.30, 0.22);
      const design = SWORDS[designId || swordChoice()] || SWORDS.crystal;
      const info = design.build(root, mk, accent) || { grip: [0.088, 0.150] };
      const rHand = hand(root, mk, 0.002, -0.020, info.grip[0], [0.20, 0.06, 0.00]);
      const lHand = hand(root, mk, 0.002, -0.020, info.grip[1], [0.20, 0.06, 0.00]);
      const flash = grp(root, 0, 0, -0.26);
      const fa = box(flash, mk, 0xffffff, 0.34, 0.006, 0.26, 0, 0.01, 0);
      const fb = box(flash, mk, accent,   0.28, 0.005, 0.34, 0, 0.02, 0);
      flash.visible = false;
      return { root, parts: { flash, fa, fb, rHand, lHand },
               rest: root.position.clone(), restRot: root.rotation.clone(), kick: 0 };
    }
  };

  function buildWeapon(id, mk, accent, designId) {
    const def = WEAPS[id] || WEAPS.blaster;
    const b = def.build(mk, accent == null ? 0x39d5ff : accent, designId);
    const st = { kick: 0, swing: 0 };

    return {
      group: b.root,
      muzzle: b.parts.flash,      // the barrel tip, projected for beam origin
      /* o = { firing: bool, swinging: bool } */
      fire()  { st.kick = 1; },
      swing() { st.swing = 1; },
      rebase() { b.rest.copy(b.root.position); b.restRot.copy(b.root.rotation); },
      update(t, moveAmt, o) {
        const m = Math.max(0, Math.min(1, moveAmt || 0));
        st.kick  = Math.max(0, st.kick  - 0.075);
        st.swing = Math.max(0, st.swing - 0.055);

        // walk sway: a lazy figure-eight, the classic viewmodel bob
        const bx = Math.sin(t * 9) * 0.008 * m;
        const by = Math.abs(Math.cos(t * 9)) * 0.007 * m;
        const idle = Math.sin(t * 1.4) * 0.003;

        if (id === "blade") {
          /* With the sword standing UP, the horizontal slash is a ROLL, not
             a yaw: rolling an upright blade sweeps its tip across the screen
             like a wiper. Yaw was correct for the old flat pose and is wrong
             for this one, so the arc now drives rotation.z, with a little
             yaw and pitch for follow-through. Right to left, then recover. */
          const s = st.swing;
          const ph = 1 - s;
          const STRIKE = 0.55;                 // fraction of the swing spent cutting
          let roll, yaw, dip, side;
          if (ph < STRIKE) {
            const k = ph / STRIKE;             // 0 -> 1 across the cut
            roll =  0.90 - k * 1.80;           // right ---> left, the actual slash
            yaw  =  0.30 - k * 0.34;           // edge leads through the arc
            dip  =  Math.sin(k * Math.PI) * 0.30;   // blade drops through the middle
            side =  0.055 - k * 0.115;
          } else {
            const k = (ph - STRIKE) / (1 - STRIKE); // 0 -> 1 recovering
            const e = 1 - k;
            roll = -0.90 * e;
            yaw  = -0.04 * e;
            dip  =  0;
            side = -0.060 * e;
          }
          b.root.position.set(b.rest.x + bx + side,
                              b.rest.y + by + idle - Math.sin(ph * Math.PI) * 0.030,
                              b.rest.z);
          b.root.rotation.set(b.restRot.x - dip,
                              b.restRot.y + yaw,
                              b.restRot.z + roll);
          // the trail only shows during the cutting phase
          b.parts.flash.visible = s > 0 && ph < STRIKE;
          if (b.parts.flash.visible) {
            const w = Math.sin((ph / STRIKE) * Math.PI);
            b.parts.fa.scale.set(0.7 + w * 0.6, 1, 0.9 + w * 0.15);
            b.parts.fb.scale.set(0.6 + w * 0.9, 1, 0.9 + w * 0.15);
          }
        } else {
          // recoil: the gun kicks back toward the camera and muzzle-rises
          /* Muzzle RISE. The barrel points down local -Z, and rotating a
             -Z vector by a POSITIVE angle about X sends its tip to +Y, so
             muzzle-up is +rotation.x. This was negative, which dipped the
             gun on every shot: the opposite of what a real one does.
             The whole weapon also kicks back toward the shooter (+Z) and
             lifts a little rather than sinking. */
          const k = st.kick;
          b.root.position.set(b.rest.x + bx,
                              b.rest.y + by + idle + k * 0.006,
                              b.rest.z + k * 0.032);
          b.root.rotation.set(b.restRot.x + k * 0.13, b.restRot.y, b.restRot.z - k * 0.02);
          b.parts.flash.visible = k > 0.55;
          if (b.parts.flash.visible) {
            const s = 0.7 + Math.random() * 0.7;
            b.parts.fa.scale.set(s, s, 0.8 + Math.random() * 0.9);
            b.parts.fb.scale.set(s * 1.2, s * 1.2, 0.7);
            b.parts.flash.rotation.z = Math.random() * 6.28;
          }
        }
      }
    };
  }

  return {
    characters: Object.keys(CHARS).map(id => ({ id: id, name: CHARS[id].name, blurb: CHARS[id].blurb })),
    weapons:    Object.keys(WEAPS).map(id => ({ id: id, name: WEAPS[id].name, blurb: WEAPS[id].blurb })),
    buildCharacter: buildCharacter,
    buildWeapon: buildWeapon,
    swords: Object.keys(SWORDS).map(id => ({ id: id, name: SWORDS[id].name, blurb: SWORDS[id].blurb })),
    swordChoice: swordChoice
  };
})();
if (typeof window !== "undefined") window.MODELS = MODELS;
