/* Math Dungeon: which creatures have a real 3D mesh.
   key -> GLB path relative to the game. Loaded lazily over http the first
   time a creature is drawn; if the file is missing, or the game is opened
   straight off disk (file:// blocks fetch, so GLTFLoader cannot read a
   sibling file), that creature silently keeps its 2D cutout sprite. */
const CREATURE_GLB = {
  bat:"models3d/bat.glb",           gloop:"models3d/gloop.glb",
  goblin:"models3d/goblin.glb",     dragon:"models3d/dragon.glb",
  scarab:"models3d/scarab.glb",     sphinx:"models3d/sphinx.glb",
  crystalgolem:"models3d/crystalgolem.glb", glowjelly:"models3d/glowjelly.glb",
  bonerattler:"models3d/bonerattler.glb",   shadowwisp:"models3d/shadowwisp.glb",
  dungeonrat:"models3d/dungeonrat.glb",     sandcobra:"models3d/sandcobra.glb",
  mummy:"models3d/mummy.glb",               jackalguard:"models3d/jackalguard.glb"
};
/* Which way each mesh's face points, as a yaw offset. Image-to-3D output
   faces +Z in every model checked so far; override per key if one comes
   out turned. */
const CREATURE_YAW = {};
