/* =====================================================================
   MATH DUNGEON — BEYOND MATH
   ---------------------------------------------------------------------
   Four more subjects, pitched at a sharp 7-year-old (2nd grade), that
   plug into the same question bank the math lives in. Every family
   returns { q, a, choices, hint }: a WORD answer plus its own four
   options, because "correct spelling of 'because'" cannot be faked by
   nudging a number the way the math distractors are.

     reading   - short dungeon scenes with a comprehension question
     spelling  - pick the correctly spelled word
     vocab     - match a meaning to its word
     science   - animals, space, weather, the body, plants
     logic     - odd one out, riddles, pattern-what-comes-next

   Reading scenes are templates with slots (hero name, creature, item,
   place, count), so 40 scenes become several hundred distinct questions
   and the anti-repeat bag in math-bank.js still applies. Numeric "how
   many" reading questions return a number and ride the normal path.

   Tier placement: reading and logic sit at every tier (they scale by
   sentence length), spelling/vocab word lists are split easy/hard,
   science is one pool. Nothing here is short enough for the door plate
   except spelling and odd-one-out, which are flagged `short`.
   ===================================================================== */
(function () {
  "use strict";
  if (typeof MathBank === "undefined" || !MathBank || !MathBank.addFamily) return;

  const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pk = a => a[Math.floor(Math.random() * a.length)];
  const A  = s => "<span class='accent'>" + s + "</span>";
  const shuf = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  /* three wrong options drawn from a pool, never the answer, never a dup */
  const wrongs = (pool, answer, n) => {
    const out = [], seen = new Set([answer]);
    const p = shuf(pool.slice());
    for (const w of p) { if (!seen.has(w)) { out.push(w); seen.add(w); } if (out.length === (n || 3)) break; }
    return out;
  };
  const opts4 = (answer, pool) => shuf([answer].concat(wrongs(pool, answer, 3)));

  /* ---------- shared slot vocab for the reading scenes ---------- */
  const HEROES   = ["Milo", "Ava", "Kai", "Zara", "Leo", "Nia", "Finn", "Ruby"];
  const CREATURE = [["bat", "bats"], ["goblin", "goblins"], ["scarab", "scarabs"], ["slime", "slimes"], ["ghost", "ghosts"], ["spider", "spiders"]];
  const ITEMS    = [["gem", "gems"], ["key", "keys"], ["torch", "torches"], ["coin", "coins"], ["potion", "potions"], ["scroll", "scrolls"]];
  const PLACES   = ["the Crystal Cave", "the Dark Dungeon", "the Golden Pyramid", "the Bone Bridge", "the Frozen Hall", "the Lava Pit"];
  const COLORS   = ["red", "blue", "green", "gold", "purple", "silver"];
  const FEEL     = ["brave", "scared", "excited", "tired", "proud", "curious"];

  /* =====================================================================
     READING — story scenes
     Each scene is fn(slots) -> { text, q, a, choices } or { text, q, a }
     (numeric). Slots are drawn fresh every time.
     ===================================================================== */
  const SCENES = [
    s => ({ text: `${s.hero} crept into ${s.place} holding a ${s.color} torch. Three ${s.crP} were sleeping on the ceiling. ${s.hero} tiptoed past them and found a ${s.item} under a rock.`,
            q: "Where were the " + s.crP + "?", a: "on the ceiling", choices: ["on the ceiling", "under a rock", "in the torch", "behind " + s.hero] }),
    s => ({ text: `${s.hero} crept into ${s.place} holding a ${s.color} torch. Three ${s.crP} were sleeping on the ceiling. ${s.hero} tiptoed past them and found a ${s.item} under a rock.`,
            q: "Why did " + s.hero + " tiptoe?", a: "so the " + s.crP + " would not wake up", choices: ["so the " + s.crP + " would not wake up", "because the floor was hot", "to find the torch", "because " + s.hero + " was lost"] }),
    s => ({ text: `The door to ${s.place} was locked. ${s.hero} looked left, then right, then up. There, hanging from a hook, was a ${s.color} ${s.item}. ${s.hero} jumped, grabbed it, and the door swung open.`,
            q: "What did " + s.hero + " use to open the door?", a: "the " + s.item, choices: ["the " + s.item, "a torch", "a magic word", "the hook"] }),
    s => ({ text: `The door to ${s.place} was locked. ${s.hero} looked left, then right, then up. There, hanging from a hook, was a ${s.color} ${s.item}. ${s.hero} jumped, grabbed it, and the door swung open.`,
            q: "Where was the " + s.item + "?", a: "hanging from a hook", choices: ["hanging from a hook", "under the door", "in " + s.hero + "'s pocket", "on the floor"] }),
    s => ({ text: `${s.hero} counted ${s.n} ${s.itemP} in the chest. A sneaky ${s.cr} grabbed ${s.m} of them and ran away laughing.`,
            q: "How many " + s.itemP + " were left in the chest?", a: s.n - s.m }),
    s => ({ text: `${s.hero} counted ${s.n} ${s.itemP} in the chest. A sneaky ${s.cr} grabbed ${s.m} of them and ran away laughing.`,
            q: "Who took the " + s.itemP + "?", a: "a " + s.cr, choices: ["a " + s.cr, s.hero, "a dragon", "nobody"] }),
    s => ({ text: `A ${s.cr} blocked the bridge. "Answer my riddle or go back!" it said. ${s.hero} felt ${s.feel}, took a deep breath, and answered. The ${s.cr} bowed and stepped aside.`,
            q: "How did " + s.hero + " feel at first?", a: s.feel, choices: opts4(s.feel, FEEL) }),
    s => ({ text: `A ${s.cr} blocked the bridge. "Answer my riddle or go back!" it said. ${s.hero} felt ${s.feel}, took a deep breath, and answered. The ${s.cr} bowed and stepped aside.`,
            q: "What happened after " + s.hero + " answered?", a: "the " + s.cr + " stepped aside", choices: ["the " + s.cr + " stepped aside", "the bridge fell down", s.hero + " went back", "the " + s.cr + " ran away"] }),
    s => ({ text: `Deep in ${s.place}, ${s.hero} heard a drip, drip, drip. It was water falling from the roof into a little pool. In the pool, something ${s.color} was shining.`,
            q: "What made the dripping sound?", a: "water from the roof", choices: ["water from the roof", "a " + s.cr, s.hero + "'s boots", "the shining thing"] }),
    s => ({ text: `Deep in ${s.place}, ${s.hero} heard a drip, drip, drip. It was water falling from the roof into a little pool. In the pool, something ${s.color} was shining.`,
            q: "What do you think " + s.hero + " will do next?", a: "look in the pool", choices: ["look in the pool", "go to sleep", "climb the roof", "run away"] }),
    s => ({ text: `${s.hero} had ${s.n} ${s.itemP}. At the market a friendly ${s.cr} traded ${s.m} more ${s.itemP} for ${s.hero}'s old boots.`,
            q: "How many " + s.itemP + " does " + s.hero + " have now?", a: s.n + s.m }),
    s => ({ text: `${s.hero} had ${s.n} ${s.itemP}. At the market a friendly ${s.cr} traded ${s.m} more ${s.itemP} for ${s.hero}'s old boots.`,
            q: "What did " + s.hero + " give the " + s.cr + "?", a: "old boots", choices: ["old boots", s.itemP, "a torch", "nothing"] }),
    s => ({ text: `The ${s.crP} of ${s.place} love shiny things. ${s.hero} left a ${s.color} ${s.item} on the floor, hid behind a pillar, and waited. Soon the ${s.crP} came out to look.`,
            q: "Why did " + s.hero + " leave the " + s.item + " on the floor?", a: "to make the " + s.crP + " come out", choices: ["to make the " + s.crP + " come out", "because it was heavy", "to throw it away", "because it was broken"] }),
    s => ({ text: `The ${s.crP} of ${s.place} love shiny things. ${s.hero} left a ${s.color} ${s.item} on the floor, hid behind a pillar, and waited. Soon the ${s.crP} came out to look.`,
            q: "Where did " + s.hero + " hide?", a: "behind a pillar", choices: ["behind a pillar", "under the floor", "in a chest", "behind the " + s.crP] }),
    s => ({ text: `It was very dark. ${s.hero}'s torch went out! ${s.hero} stood still and listened. Far away, a tiny ${s.color} light was glowing. ${s.hero} walked slowly toward it.`,
            q: "Why did " + s.hero + " stand still?", a: "the torch went out", choices: ["the torch went out", "a " + s.cr + " said stop", "the floor was wet", s.hero + " was tired"] }),
    s => ({ text: `It was very dark. ${s.hero}'s torch went out! ${s.hero} stood still and listened. Far away, a tiny ${s.color} light was glowing. ${s.hero} walked slowly toward it.`,
            q: "What did " + s.hero + " walk toward?", a: "a " + s.color + " light", choices: ["a " + s.color + " light", "the torch", "a " + s.cr, "the way out"] }),
    s => ({ text: `${s.hero} found ${s.n} ${s.itemP} in the first room and ${s.m} more in the second room.`,
            q: "How many " + s.itemP + " did " + s.hero + " find in all?", a: s.n + s.m }),
    s => ({ text: `${s.hero} met a ${s.cr} who was crying. "I lost my ${s.item}," it said. ${s.hero} looked around and spotted it stuck in a crack in the wall. ${s.hero} pulled it out and handed it back. The ${s.cr} smiled.`,
            q: "Why was the " + s.cr + " crying?", a: "it lost its " + s.item, choices: ["it lost its " + s.item, "it was hurt", s.hero + " scared it", "it was hungry"] }),
    s => ({ text: `${s.hero} met a ${s.cr} who was crying. "I lost my ${s.item}," it said. ${s.hero} looked around and spotted it stuck in a crack in the wall. ${s.hero} pulled it out and handed it back. The ${s.cr} smiled.`,
            q: "What kind of person is " + s.hero + " in this story?", a: "kind and helpful", choices: ["kind and helpful", "mean and grumpy", "sleepy", "greedy"] }),
    s => ({ text: `There were two paths. The left path was ${s.color} and warm. The right path was icy and smelled like ${s.crP}. ${s.hero} chose the warm path.`,
            q: "Which path did " + s.hero + " take?", a: "the warm one", choices: ["the warm one", "the icy one", "both", "neither"] }),
    s => ({ text: `There were two paths. The left path was ${s.color} and warm. The right path was icy and smelled like ${s.crP}. ${s.hero} chose the warm path.`,
            q: "What was the right path like?", a: "icy and smelly", choices: ["icy and smelly", "warm and " + s.color, "dark and quiet", "full of " + s.itemP] }),
    s => ({ text: `${s.hero} lined up ${s.n} ${s.crP} for a race. ${s.m} of them fell asleep before the race even started!`,
            q: "How many " + s.crP + " were still awake?", a: s.n - s.m }),
    s => ({ text: `The old map said: "Walk to the ${s.color} door. Turn around three times. Say the magic word." ${s.hero} did it all, but forgot the magic word. The door stayed shut.`,
            q: "Why did the door stay shut?", a: s.hero + " forgot the magic word", choices: [s.hero + " forgot the magic word", "it was the wrong door", s.hero + " only turned twice", "the map was wrong"] }),
    s => ({ text: `The old map said: "Walk to the ${s.color} door. Turn around three times. Say the magic word." ${s.hero} did it all, but forgot the magic word. The door stayed shut.`,
            q: "How many times did the map say to turn around?", a: 3 }),
    s => ({ text: `A tiny ${s.cr} rode on ${s.hero}'s shoulder all through ${s.place}. It squeaked when danger was near. Twice it squeaked, and twice ${s.hero} stopped just in time.`,
            q: "What did the " + s.cr + " do when danger was near?", a: "squeaked", choices: ["squeaked", "jumped off", "went to sleep", "bit " + s.hero] }),
    s => ({ text: `A tiny ${s.cr} rode on ${s.hero}'s shoulder all through ${s.place}. It squeaked when danger was near. Twice it squeaked, and twice ${s.hero} stopped just in time.`,
            q: "How many times did the " + s.cr + " squeak?", a: 2 }),
    s => ({ text: `${s.hero} was ${s.feel} because the big boss was behind the next door. ${s.hero} checked the ${s.item}, took three deep breaths, and pushed the door open.`,
            q: "What was behind the next door?", a: "the big boss", choices: ["the big boss", "a treasure chest", "a friendly " + s.cr, "the way out"] }),
    s => ({ text: `${s.hero} was ${s.feel} because the big boss was behind the next door. ${s.hero} checked the ${s.item}, took three deep breaths, and pushed the door open.`,
            q: "What did " + s.hero + " do right before opening the door?", a: "took three deep breaths", choices: ["took three deep breaths", "ran away", "called for help", "ate a snack"] }),
    s => ({ text: `Every ${s.cr} in ${s.place} has ${s.m} eyes. ${s.hero} counted ${s.n} ${s.crP} peeking out of the dark.`,
            q: "How many eyes were peeking at " + s.hero + "?", a: s.n * s.m }),
    s => ({ text: `${s.hero} was hungry. The only food in ${s.place} was a bowl of glowing ${s.color} berries. A sign next to it said DO NOT EAT. ${s.hero} sighed and walked on.`,
            q: "Why didn't " + s.hero + " eat the berries?", a: "the sign said not to", choices: ["the sign said not to", s.hero + " was not hungry", "a " + s.cr + " ate them first", "they were too high up"] }),
    s => ({ text: `${s.hero} was hungry. The only food in ${s.place} was a bowl of glowing ${s.color} berries. A sign next to it said DO NOT EAT. ${s.hero} sighed and walked on.`,
            q: "How do you think " + s.hero + " felt walking on?", a: "still hungry", choices: ["still hungry", "full", "angry at the " + s.cr, "sleepy"] })
  ];

  function readingSlots(t) {
    const cr = pk(CREATURE), it = pk(ITEMS);
    const hi = [6, 9, 12, 20, 30, 50][t - 1];
    const n = ri(4, hi), m = ri(2, Math.max(2, Math.min(n - 1, t >= 4 ? 9 : 4)));
    return { hero: pk(HEROES), cr: cr[0], crP: cr[1], item: it[0], itemP: it[1],
             place: pk(PLACES), color: pk(COLORS), feel: pk(FEEL), n: n, m: m };
  }
  MathBank.addFamily("reading", t => {
    const s = readingSlots(t);
    const sc = pk(SCENES)(s);
    const q = "📖 <i>" + sc.text + "</i><br>" + A(sc.q);
    if (typeof sc.a === "number") return { q: q, a: sc.a, hint: "Read the story again and find the numbers." };
    return { q: q, a: sc.a, choices: sc.choices, hint: "The answer is in the story. Read it once more, slowly." };
  }, [1, 2, 3, 4, 5, 6]);

  /* =====================================================================
     SPELLING — pick the word that is spelled right
     Each entry: [correct, wrong1, wrong2, wrong3]
     ===================================================================== */
  const SPELL_EASY = [
    ["because", "becuase", "becase", "beacuse"], ["friend", "freind", "frend", "friand"],
    ["said", "sed", "sayd", "siad"], ["they", "thay", "thier", "tehy"],
    ["where", "wher", "wear", "whare"], ["little", "litle", "littel", "lital"],
    ["people", "peaple", "pepole", "peple"], ["would", "wood", "wuld", "wold"],
    ["again", "agen", "agian", "agane"], ["night", "nite", "nihgt", "nigt"],
    ["water", "watter", "wader", "wotter"], ["their", "thier", "there", "ther"],
    ["house", "hous", "howse", "huose"], ["animal", "aminal", "animel", "anamal"],
    ["school", "scool", "shcool", "skool"], ["monster", "monstor", "moster", "monsterr"],
    ["dragon", "dragun", "dragen", "dargon"], ["castle", "casle", "castel", "cassle"],
    ["treasure", "tresure", "treasur", "treshure"], ["magic", "majic", "magik", "maigc"],
    ["shield", "sheild", "shild", "sheeld"], ["knight", "nite", "knigt", "kniht"],
    ["bridge", "brige", "bridg", "bridje"], ["torch", "torsh", "tourch", "torhc"],
    ["door", "dor", "doar", "dooor"], ["light", "lite", "lihgt", "ligt"],
    ["jump", "jmup", "jumpp", "jup"], ["brave", "brav", "braev", "bravee"],
    ["happy", "hapy", "happi", "hapyy"], ["every", "evry", "evrey", "everry"]
  ];
  const SPELL_HARD = [
    ["beautiful", "beautifull", "butiful", "beutiful"], ["different", "diffrent", "diferent", "differant"],
    ["believe", "beleive", "belive", "beleave"], ["surprise", "suprise", "surprize", "serprise"],
    ["enough", "enuff", "enogh", "enougf"], ["favorite", "favrite", "favorit", "faverite"],
    ["together", "togather", "togeather", "togehter"], ["tomorrow", "tomorow", "tommorow", "tomorro"],
    ["through", "threw", "thru", "throught"], ["thought", "thougt", "thaught", "thort"],
    ["remember", "rember", "remeber", "rememer"], ["sometimes", "somtimes", "sometims", "sumtimes"],
    ["question", "qestion", "queston", "questoin"], ["answer", "anser", "ansewr", "awnser"],
    ["dungeon", "dungon", "dunjeon", "dungeun"], ["crystal", "cristal", "crystel", "chrystal"],
    ["pyramid", "piramid", "pyrimid", "pyramyd"], ["potion", "poshun", "potian", "potoin"],
    ["riddle", "ridle", "riddel", "riddl"], ["scared", "scarred", "scaird", "skared"],
    ["heavy", "hevy", "heavey", "havey"], ["quiet", "quite", "qiet", "quiett"],
    ["whisper", "wisper", "whispir", "whissper"], ["adventure", "advenchure", "adventur", "advanture"],
    ["explore", "explor", "exsplore", "explore "].map(x => x.trim()).filter((x, i, a) => a.indexOf(x) === i).concat(["explorr"]).slice(0, 4)
  ].filter(e => e.length === 4 && new Set(e).size === 4);

  const spellFam = list => t => {
    const e = pk(list);
    return { q: "✏️ Which word is spelled " + A("correctly") + "?", a: e[0], choices: shuf(e.slice()),
             hint: "Say it slowly and listen for every sound." };
  };
  MathBank.addFamily("spellEasy", spellFam(SPELL_EASY), [1, 2, 3], { short: true });
  MathBank.addFamily("spellHard", spellFam(SPELL_HARD), [3, 4, 5, 6], { short: true });

  /* =====================================================================
     VOCABULARY — match the meaning to the word
     ===================================================================== */
  const VOCAB_EASY = [
    ["brave", "not afraid to do something scary"], ["gigantic", "very, very big"], ["tiny", "very small"],
    ["ancient", "very, very old"], ["sneaky", "quiet and tricky, trying not to be seen"],
    ["glow", "to give off a soft light"], ["curious", "wanting to find out about things"],
    ["gloomy", "dark and a little sad"], ["swift", "very fast"], ["shiver", "to shake because you are cold or scared"],
    ["clever", "smart and good at solving things"], ["greedy", "wanting more than you need"],
    ["silent", "making no sound at all"], ["fierce", "wild and a little scary"], ["gentle", "soft and careful"],
    ["exhausted", "extremely tired"], ["furious", "very, very angry"], ["delighted", "very happy"],
    ["enormous", "huge"], ["peek", "to take a quick, secret look"]
  ];
  const VOCAB_HARD = [
    ["cautious", "careful to avoid danger"], ["hesitate", "to pause because you are not sure"],
    ["ferocious", "very fierce and violent"], ["luminous", "giving off light, glowing"],
    ["labyrinth", "a maze of twisting paths"], ["vanish", "to disappear suddenly"],
    ["summon", "to call something to come"], ["treacherous", "dangerous and not to be trusted"],
    ["mysterious", "hard to explain or understand"], ["eerie", "strange and a little frightening"],
    ["barrier", "something that blocks the way"], ["companion", "a friend who goes with you"],
    ["conquer", "to beat or take over"], ["fragile", "easy to break"], ["abandon", "to leave behind and not come back"],
    ["perilous", "full of danger"], ["shimmer", "to shine with a soft, moving light"], ["dwell", "to live in a place"],
    ["cunning", "clever in a tricky way"], ["reluctant", "not really wanting to do something"]
  ];
  const vocabFam = list => t => {
    const e = pk(list);
    const pool = list.map(x => x[0]);
    return { q: "📚 Which word means " + A("“" + e[1] + "”") + "?", a: e[0], choices: opts4(e[0], pool),
             hint: "Think about where you have heard each word before." };
  };
  MathBank.addFamily("vocabEasy", vocabFam(VOCAB_EASY), [1, 2, 3]);
  MathBank.addFamily("vocabHard", vocabFam(VOCAB_HARD), [3, 4, 5, 6]);

  /* =====================================================================
     SCIENCE AND NATURE
     [question, answer, wrong, wrong, wrong]
     ===================================================================== */
  const SCIENCE = [
    ["Which animal is awake at night and sleeps in the day?", "owl", "chicken", "cow", "butterfly"],
    ["What do bees make?", "honey", "milk", "silk", "wax candles"],
    ["Which of these is a planet?", "Mars", "the Moon", "the Sun", "a comet"],
    ["What do plants need to grow?", "sunlight and water", "meat", "darkness", "salt"],
    ["How many legs does a spider have?", "8", "6", "4", "10"],
    ["How many legs does an insect have?", "6", "8", "4", "2"],
    ["What is frozen water called?", "ice", "steam", "snowflake juice", "fog"],
    ["What do we call water that turns into a gas?", "steam", "ice", "mud", "rain"],
    ["Which animal lays eggs?", "turtle", "dog", "whale", "horse"],
    ["What is the biggest planet in our solar system?", "Jupiter", "Earth", "Mars", "Mercury"],
    ["What does a caterpillar turn into?", "a butterfly", "a bee", "a beetle", "a worm"],
    ["Which of these is a mammal?", "dolphin", "shark", "salmon", "octopus"],
    ["What do you call an animal that only eats plants?", "herbivore", "carnivore", "omnivore", "predator"],
    ["What do you call an animal that only eats meat?", "carnivore", "herbivore", "vegetarian", "insect"],
    ["Which part of a plant takes in water from the soil?", "roots", "leaves", "flowers", "petals"],
    ["What makes a rainbow appear?", "sunlight shining through rain", "wind", "thunder", "the Moon"],
    ["Where does the Sun rise?", "in the east", "in the west", "in the north", "in the south"],
    ["How many bones are in your body when you grow up? (about)", "206", "20", "1,000", "50"],
    ["What pumps blood around your body?", "the heart", "the lungs", "the brain", "the stomach"],
    ["What do your lungs help you do?", "breathe", "think", "run", "see"],
    ["Which is the fastest land animal?", "cheetah", "horse", "elephant", "rabbit"],
    ["Which animal is the largest ever to live?", "blue whale", "elephant", "T. rex", "giraffe"],
    ["What do we call the hard covering of a turtle?", "a shell", "a scale", "a coat", "a shield"],
    ["How many days are in a year?", "365", "100", "52", "12"],
    ["How many months are in a year?", "12", "10", "24", "7"],
    ["What season comes after winter?", "spring", "summer", "fall", "another winter"],
    ["Which of these is NOT a state of water?", "wood", "ice", "liquid", "steam"],
    ["What is the closest star to Earth?", "the Sun", "the North Star", "the Moon", "Mars"],
    ["Which of these animals can fly?", "bat", "penguin", "ostrich", "kangaroo"],
    ["What do frogs start life as?", "tadpoles", "eggs on land", "tiny frogs", "fish"],
    ["Which of these is a reptile?", "snake", "frog", "mouse", "goldfish"],
    ["What is a baby kangaroo called?", "a joey", "a cub", "a kit", "a pup"],
    ["What gas do we breathe in to stay alive?", "oxygen", "helium", "smoke", "steam"],
    ["What do trees give us that we breathe?", "oxygen", "water", "sand", "sugar"],
    ["What tool tells you which way is north?", "a compass", "a ruler", "a clock", "a magnet only"],
    ["Which is heavier: a kilogram of feathers or a kilogram of rocks?", "they weigh the same", "the rocks", "the feathers", "it depends on the day"],
    ["What do we call melted rock that comes out of a volcano?", "lava", "ice", "mud", "steam"],
    ["Which of these is the hottest?", "the Sun", "a campfire", "boiling water", "a desert"],
    ["What do fish use to breathe under water?", "gills", "lungs", "fins", "scales"],
    ["What is the Earth's shape?", "round like a ball", "flat like a plate", "a cube", "a triangle"],
    ["What causes day and night?", "the Earth spinning", "the Sun turning off", "clouds", "the Moon"],
    ["Which magnet ends pull together?", "a north and a south", "two norths", "two souths", "none of them"],
    ["What do we call a scientist who studies dinosaurs?", "a paleontologist", "a dentist", "an astronaut", "a chef"],
    ["What do we call a scientist who studies space?", "an astronomer", "a farmer", "a vet", "a pilot"],
    ["Which of these animals hibernates in winter?", "bear", "dog", "parrot", "goldfish"],
    ["Which of these is a vegetable?", "carrot", "apple", "banana", "grape"],
    ["Which of these is a fruit?", "strawberry", "potato", "broccoli", "onion"],
    ["What do you call the top layer of the Earth we walk on?", "the crust", "the core", "the peel", "the shell"],
    ["What is the center of the Earth called?", "the core", "the crust", "the middle", "the bottom"],
    ["How many hours are in a day?", "24", "12", "60", "100"],
    ["Which body part helps you smell?", "nose", "ears", "elbows", "knees"],
    ["What do we call animals with feathers?", "birds", "mammals", "fish", "insects"],
    ["Which of these has no bones?", "jellyfish", "cat", "eagle", "lizard"],
    ["What kind of animal is a shark?", "a fish", "a mammal", "a reptile", "a bird"],
    ["What does a thermometer measure?", "how hot or cold", "how heavy", "how loud", "how fast"],
    ["Which planet is known as the Red Planet?", "Mars", "Venus", "Jupiter", "Saturn"],
    ["Which planet has big rings around it?", "Saturn", "Earth", "Mars", "Mercury"],
    ["How many planets are in our solar system?", "8", "5", "12", "20"],
    ["What do we call a baby cat?", "a kitten", "a puppy", "a calf", "a cub"],
    ["What do we call a baby dog?", "a puppy", "a kitten", "a foal", "a chick"]
  ];
  MathBank.addFamily("science", t => {
    const e = pk(SCIENCE);
    return { q: "🔬 " + e[0], a: e[1], choices: shuf(e.slice(1)), hint: "Picture it in real life, then pick." };
  }, [1, 2, 3, 4, 5, 6]);

  /* =====================================================================
     LOGIC — odd one out, riddles, patterns
     ===================================================================== */
  const ODD = [
    [["apple", "banana", "carrot", "grape"], "carrot", "the others are fruits"],
    [["dog", "cat", "hamster", "shark"], "shark", "the others are furry pets"],
    [["red", "blue", "circle", "green"], "circle", "the others are colors"],
    [["square", "triangle", "purple", "circle"], "purple", "the others are shapes"],
    [["car", "bus", "truck", "boat"], "boat", "the others drive on roads"],
    [["sun", "moon", "star", "tree"], "tree", "the others are in the sky"],
    [["pencil", "crayon", "marker", "eraser"], "eraser", "the others draw"],
    [["two", "four", "five", "six"], "five", "the others are even"],
    [["one", "three", "eight", "seven"], "eight", "the others are odd"],
    [["Monday", "Friday", "March", "Sunday"], "March", "the others are days"],
    [["June", "Tuesday", "April", "October"], "Tuesday", "the others are months"],
    [["shirt", "hat", "spoon", "sock"], "spoon", "the others are clothes"],
    [["milk", "juice", "water", "bread"], "bread", "the others are drinks"],
    [["eagle", "robin", "bat", "sparrow"], "bat", "the others are birds"],
    [["hammer", "saw", "nail", "book"], "book", "the others are for building"],
    [["cold", "icy", "frozen", "hot"], "hot", "the others mean cold"],
    [["big", "huge", "giant", "tiny"], "tiny", "the others mean big"],
    [["run", "jump", "skip", "sleep"], "sleep", "the others are moving"],
    [["piano", "drum", "guitar", "paintbrush"], "paintbrush", "the others make music"],
    [["rose", "daisy", "tulip", "oak"], "oak", "the others are flowers"],
    [["sword", "shield", "helmet", "potion"], "potion", "the others are armor and weapons"],
    [["bat", "goblin", "scarab", "hero"], "hero", "the others are monsters"],
    [["ice", "snow", "frost", "lava"], "lava", "the others are cold"],
    [["whisper", "shout", "yell", "scream"], "whisper", "the others are loud"],
    [["circle", "ball", "wheel", "box"], "box", "the others are round"]
  ];
  MathBank.addFamily("oddOneOut", t => {
    const e = pk(ODD);
    return { q: "🧩 Which one " + A("does NOT belong") + "?", a: e[1], choices: shuf(e[0].slice()),
             hint: "Find what three of them have in common: " + e[2] + "." };
  }, [1, 2, 3, 4, 5, 6], { short: true });

  const RIDDLES = [
    ["I have keys but no locks. I have space but no room. You can enter but not go in. What am I?", "a keyboard", "a house", "a piano", "a car"],
    ["What has hands but cannot clap?", "a clock", "a monkey", "a glove", "a robot"],
    ["What gets wetter the more it dries?", "a towel", "a river", "a sponge that is broken", "the rain"],
    ["What has a neck but no head?", "a bottle", "a giraffe", "a shirt", "a snake"],
    ["What has teeth but cannot bite?", "a comb", "a shark", "a dog", "a mouth"],
    ["I go up but never come down. What am I?", "your age", "a ball", "a kite", "rain"],
    ["What has one eye but cannot see?", "a needle", "a pirate", "a cyclops", "a cat"],
    ["What has legs but does not walk?", "a table", "a dog", "a spider", "a runner"],
    ["What can you catch but not throw?", "a cold", "a ball", "a fish", "a frisbee"],
    ["What has a face and two hands but no arms or legs?", "a clock", "a puppet", "a doll", "a person"],
    ["What kind of room has no doors or windows?", "a mushroom", "a bedroom", "a bathroom", "a dungeon"],
    ["What gets bigger the more you take away from it?", "a hole", "a cake", "a pile", "a balloon"],
    ["What is full of holes but still holds water?", "a sponge", "a bucket", "a net", "a cup"],
    ["What runs all around a yard but never moves?", "a fence", "a dog", "a lawn mower", "a river"],
    ["What has a thumb and four fingers but is not alive?", "a glove", "a hand", "a monkey", "a statue"],
    ["The more you take, the more you leave behind. What are they?", "footsteps", "cookies", "coins", "breaths"],
    ["What building has the most stories?", "a library", "a tower", "a castle", "a house"],
    ["What word is spelled wrong in every dictionary?", "wrong", "dictionary", "spelled", "every"],
    ["What has a bottom at the top?", "your legs", "a boat", "a hat", "a cup"],
    ["What can travel around the world while staying in a corner?", "a stamp", "a bird", "a plane", "a coin"],
    ["I am tall when I am young and short when I am old. What am I?", "a candle", "a tree", "a giraffe", "a mountain"],
    ["What has many keys but opens no doors?", "a piano", "a jailer", "a locksmith", "a keychain"],
    ["What goes up when rain comes down?", "an umbrella", "a river", "a plant", "the ground"],
    ["What has a head and a tail but no body?", "a coin", "a snake", "a dog", "a comet"],
    ["What can you break without touching it?", "a promise", "a glass", "a stick", "an egg"]
  ];
  MathBank.addFamily("riddle", t => {
    const e = pk(RIDDLES);
    return { q: "🤔 " + A("Riddle:") + " " + e[0], a: e[1], choices: shuf(e.slice(1)),
             hint: "Riddles are tricky on purpose. Think about the words in a silly way." };
  }, [2, 3, 4, 5, 6]);

  /* pattern: what comes next, built on the fly so it never repeats */
  const SHAPES = ["🔴", "🔵", "🟢", "🟡", "⭐", "🔺", "⬛", "💎"];
  MathBank.addFamily("pattern", t => {
    const kind = t <= 2 ? pk(["AB", "AB", "AAB"]) : t <= 4 ? pk(["AB", "AAB", "ABB", "ABC"]) : pk(["AAB", "ABB", "ABC", "AABB", "ABCC"]);
    const sym = shuf(SHAPES.slice()).slice(0, 3);
    const map = { A: sym[0], B: sym[1], C: sym[2] };
    const unit = kind.split("");
    const reps = kind.length <= 2 ? 3 : 2;
    let seq = [];
    for (let r = 0; r < reps; r++) seq = seq.concat(unit);
    seq.push(unit[0]);                                  // start the next unit
    const answer = map[unit[1 % unit.length]];          // the second element completes it
    const shown = seq.map(k => map[k]).join(" ");
    const pool = sym.concat(shuf(SHAPES.filter(x => sym.indexOf(x) === -1)).slice(0, 1));
    return { q: "🔁 What comes " + A("next") + "?<br><span style='font-size:26px;letter-spacing:6px'>" + shown + " ?</span>",
             a: answer, choices: opts4(answer, pool),
             hint: "Find the part that repeats, then keep it going." };
  }, [1, 2, 3, 4, 5, 6], { short: true });

  /* letters: what comes next in the alphabet run */
  MathBank.addFamily("letterSeq", t => {
    const step = t <= 2 ? 1 : pk([1, 2, 2, 3]);
    const start = ri(0, 25 - step * 4);
    const L = i => String.fromCharCode(65 + start + i * step);
    const shown = [L(0), L(1), L(2), L(3)].join(", ");
    const answer = L(4);
    const pool = [answer, L(5), String.fromCharCode(65 + Math.max(0, start + 4 * step - 1)), String.fromCharCode(65 + Math.min(25, start + 4 * step + 1))];
    return { q: "🔤 " + shown + ", ? What letter comes " + A("next") + "?", a: answer,
             choices: shuf(pool.filter((x, i, a) => a.indexOf(x) === i)).slice(0, 4).length === 4 ? shuf(pool.filter((x, i, a) => a.indexOf(x) === i)) : opts4(answer, "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")),
             hint: step === 1 ? "Say the alphabet." : "The letters skip by " + step + "." };
  }, [1, 2, 3, 4, 5, 6], { short: true });

  if (typeof window !== "undefined") window.STORY_BANK_LOADED = true;
})();
