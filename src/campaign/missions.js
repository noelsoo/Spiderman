// Campaign data: "Sinister Symbiosis". Pure data, no logic. Interpreted by src/campaign/objectives.js.
//
// STORY: the Venom symbiote's hive has splintered. Its shards are bonding with New York's villains and making them
// stronger. The heroes (any of the 8, switchable at any time) hunt each infected villain, then end it at the source.
//
// PLACE SPECS (resolved at run time by objectives.resolvePlace):
//   'plaza'                         named place (see PLACES in objectives.js)
//   { place:'park', dx, dz }        named place + offset
//   { node:[avenue, street] }       road intersection (avenue 0..9, street 0..17)
//   { rel:'player', dist, ang }     relative to the hero
//   { shop:true } / { van:true }    nearest gun shop / the chase van's last position
//
// STEP TYPES: cutscene talk tutorial goto defeat survive defend collect chase boss   (see objectives.js)
//
// Dialogue lines are { who, text }. who: FRIDAY | FURY | MJ | HERO | <villain key>.

export const SPEAKERS = {
  FRIDAY: { name: 'F.R.I.D.A.Y.', color: '#5fd6ff' },
  FURY: { name: 'Nick Fury', color: '#ffd23a' },
  MJ: { name: 'MJ', color: '#ff7ab8' },
  KRAVEN: { name: 'Kraven', color: '#d9a441' },
  LIZARD: { name: 'The Lizard', color: '#6bd36a' },
  OCTAVIUS: { name: 'Doctor Octopus', color: '#e08a3c' },
  GOBLIN: { name: 'Green Goblin', color: '#9be03c' },
  LOKI: { name: 'Loki', color: '#58d68d' },
  ULTRON: { name: 'Ultron', color: '#ff5a4d' },
  VENOM: { name: 'Venom', color: '#b58cff' },
  CARNAGE: { name: 'Carnage', color: '#ff2a3d' },
  HIVE: { name: 'The Hive', color: '#a070ff' },
};

const L = (who, text) => ({ who, text });

export const MISSIONS = [
  // ------------------------------------------------------------------------------------------------ 0
  {
    key: 'night-shift', title: 'Night Shift', chapter: 'Prologue',
    villain: { name: 'The Hive', color: '#7a2bd0' },
    briefing: 'Purple veins, glowing eyes: symbiote goons are tearing up Midtown. Learn the ropes, take them down, and meet the Hive\'s first enforcer.',
    recommended: { hero: 'spiderman', why: 'Swinging makes Midtown a playground, but anyone can do this one.' },
    start: { node: [5, 6] }, face: 'plaza',
    reward: 500, par: 540, dmgLimit: 220,
    steps: [
      { type: 'cutscene', cam: { look: 'plaza', from: { place: 'plaza', dx: -40, dz: 60, y: 30 }, to: { place: 'plaza', dx: 36, dz: 40, y: 18 }, dur: 7 },
        lines: [L('FURY', 'Midtown, 2 a.m. Something is wrong with the people downtown.'), L('FRIDAY', 'Scanning. Alien biomass in every one of them. Venom\'s symbiote has splintered, and the pieces are spreading.'), L('MJ', 'Police scanners are going nuts. Please be careful out there.')] },
      { type: 'tutorial', text: 'Learn the controls', tasks: [
        { check: 'move', n: 20, prompt: [null, 'MOVE: W A S D / left stick   -   CAMERA: mouse / right stick'], text: 'Move around' },
        { check: 'jump', n: 2, prompt: ['jump', 'JUMP (hold in the air for your hero\'s special movement)'], text: 'Jump twice' },
        { check: 'attack', n: 4, prompt: ['attack', 'ATTACK: your melee combo. Tap it a few times'], text: 'Throw a few punches' },
        { check: 'dodge', n: 1, prompt: ['dodge', 'DODGE to roll out of attacks'], text: 'Dodge once' }],
        lines: [L('FRIDAY', 'Let\'s make sure everything works. Run, jump, swing a fist.')] },
      { type: 'defeat', text: 'Take down the symbiote goons', hint: ['attack', 'Combos build Focus. A full bar unlocks your ultimate'],
        groups: [{ kind: 'goon', n: 3, at: 'plaza', r: [10, 18] }, { kind: 'goon', n: 3, at: 'plaza', r: [14, 24], delay: 7 }],
        lines: [L('FRIDAY', 'Six hostiles in the plaza. Goons are weak alone, but they swarm.'), L('MJ', 'Dodge the glowing ones, they hit harder.')] },
      { type: 'tutorial', text: 'Switch heroes and grab a car', tasks: [
        { check: 'wheel', prompt: ['wheel', 'HOLD the character wheel, aim with a stick or mouse, release to switch hero'], text: 'Switch to another hero' },
        { check: 'car', near: 'car', prompt: ['interact', 'Walk up to any car and press INTERACT to steal it'], text: 'Steal a car' }],
        lines: [L('FRIDAY', 'All eight of you are on call, and you can swap at any time. Try it.'), L('FURY', 'Then grab a set of wheels. The city is bigger than it looks.')] },
      { type: 'tutorial', text: 'Buy a gun at the shop', at: { shop: true }, giveCash: 150, tasks: [
        { check: 'gun', prompt: ['interact', 'Go to the marked shop and press INTERACT to open it. Buy any gun'], text: 'Buy a gun' }],
        lines: [L('FRIDAY', 'There is a gun shop on the marker. I have wired you some cash. Guns work for every hero.')] },
      { type: 'boss', kind: 'hunter', name: 'SYMBIOTE BRUTE', at: 'plaza', r: [18, 24], hpScale: 6, assist: true,
        minions: { kind: 'goon', every: 14, max: 2, r: [14, 22] },
        intro: [L('HIVE', 'Join us...'), L('FRIDAY', 'A bonded enforcer! Hit it hard, stay mobile.')],
        text: 'Defeat the Symbiote Brute' },
    ],
    outro: [L('FURY', 'Good work. That was only the first piece. Kraven is hunting what is left of the hive.')],
  },

  // ------------------------------------------------------------------------------------------------ 1
  {
    key: 'hunting-season', title: 'Hunting Season', chapter: 'Chapter 1',
    villain: { name: 'Kraven the Hunter', color: '#d9a441', kind: 'kraven' },
    briefing: 'Kraven\'s hunters have taken the rooftops around Central Park. The symbiote has made the old hunter faster than any man alive. Find the trophies he left, then face him.',
    recommended: { hero: 'hawkeye', why: 'Ranged heroes pick off the rooftop hunters. Melee heroes: they will come down to you.' },
    start: { node: [3, 8] }, face: { node: [4, 8] },
    reward: 800, par: 480, dmgLimit: 260,
    steps: [
      { type: 'goto', text: 'Head to Central Park', at: { node: [4, 8] }, radius: 22,
        lines: [L('FURY', 'Kraven has a hunting camp at Central Park. Local PD found nobody alive on the roofs.'), L('FRIDAY', 'Tracking symbiote signatures. Marker set.'), L('MJ', 'He is hunting people for sport. Hurry.')] },
      { type: 'defeat', text: 'Clear the rooftop hunters', rooftopTimeout: 38,
        groups: [{ kind: ['kraven_hunter', 'hunter'], n: 4, at: 'parkC', rooftop: true, rooftopR: 130 }, { kind: 'goon', n: 3, at: { node: [4, 8] }, r: [8, 16], delay: 4 }],
        lines: [L('FRIDAY', 'Snipers on the rooftops. Use cover, or take the high ground yourself.'), L('FRIDAY', 'A flyer would help. Or steal a car, or just take the stairs of the fight to them.')] },
      { type: 'collect', text: 'Find the symbiote trophies', n: 4, at: 'parkC', r: [25, 75], color: 0xb070ff,
        guards: { kind: ['kraven_hunter', 'hunter'], every: 16, max: 2, r: [24, 36] },
        lines: [L('FRIDAY', 'Kraven\'s trophies are saturated with symbiote. Collect them and the hive loses its anchor here.')] },
      { type: 'boss', kind: 'kraven', name: 'KRAVEN THE HUNTER', at: 'parkC', r: [28, 34], fallback: 'hunter', fallbackHp: 9,
        minions: { kind: ['kraven_hunter', 'hunter'], every: 24, max: 2, r: [24, 34] },
        intro: [L('KRAVEN', 'The finest prey the city has to offer. Come.'), L('FRIDAY', 'He is fast and he hits hard. Watch for his telegraphs.')],
        phases: [{ below: 0.5, say: [L('KRAVEN', 'The hive has made me perfect!')] }],
        text: 'Defeat Kraven' },
    ],
    outro: [L('KRAVEN', 'You... are the better hunter.'), L('FURY', 'Next lead: something is stirring by the river. Lizard sightings.')],
  },

  // ------------------------------------------------------------------------------------------------ 2
  {
    key: 'cold-blood', title: 'Cold Blood', chapter: 'Chapter 2',
    villain: { name: 'The Lizard', color: '#6bd36a', kind: 'lizard' },
    briefing: 'Lizard-men are swarming out of the river by the bridge. Hold the antidote supply, then put down The Lizard before the infection reaches the bridge.',
    recommended: { hero: 'hulk', why: 'Strength to match Lizard. Everyone else: use the open quay to keep your distance.' },
    start: { node: [2, 9] }, face: { node: [0, 7] },
    reward: 1000, par: 540, dmgLimit: 300,
    steps: [
      { type: 'goto', text: 'Reach the river quay', at: { node: [0, 7] }, radius: 22,
        lines: [L('FURY', 'Reports of reptilian people crawling out of the East River.'), L('FRIDAY', 'Dr. Connors\' lab ran a symbiote cure trial. The hive found his old formula.'), L('MJ', 'He was a good man once. Try not to hurt him more than you have to.')] },
      { type: 'defeat', text: 'Defeat the lizard-men',
        groups: [{ kind: 'lizardman', n: 4, at: { node: [0, 7] }, r: [10, 20] }, { kind: 'lizardman', n: 4, at: { node: [0, 7] }, r: [12, 24], delay: 9 }],
        lines: [L('FRIDAY', 'They are quick and they climb. Fight on open ground.')] },
      { type: 'defend', text: 'Protect the antidote crates', at: { node: [0, 8] }, label: 'ANTIDOTE CRATES', hp: 170, seconds: 45, color: 0x55ffcc,
        spawn: { kind: 'lizardman', every: 6, max: 4, r: [16, 26] },
        lines: [L('FRIDAY', 'The antidote crates are our only hope of helping Connors. Do not let them reach it!')] },
      { type: 'boss', kind: 'lizard', name: 'THE LIZARD', at: { node: [0, 7] }, r: [24, 30], fallback: 'hunter', fallbackHp: 9,
        minions: { kind: 'lizardman', every: 26, max: 2, r: [16, 26] },
        intro: [L('LIZARD', 'We do not... want to hurt. But the hive is hungry.'), L('FRIDAY', 'Subdue him. It is the only way to reach the man inside.')],
        phases: [{ below: 0.5, say: [L('LIZARD', 'Rrraaagh!')] }],
        text: 'Defeat The Lizard' },
    ],
    outro: [L('MJ', 'He is waking up. Connors is back. Thank you.'), L('FURY', 'Oscorp just reported a stolen shipment. Symbiote sample. Move.')],
  },

  // ------------------------------------------------------------------------------------------------ 3
  {
    key: 'hot-pursuit', title: 'Hot Pursuit', chapter: 'Chapter 3',
    villain: { name: 'Oscorp Enforcer', color: '#6f8bff' },
    briefing: 'An armoured Oscorp van carrying a symbiote sample is running through traffic. Catch it by any means, wreck it, and deal with the guards.',
    recommended: { hero: 'ironman', why: 'Flyers keep up easily. Everyone else: steal a car, and stay close to jam the van.' },
    start: { node: [2, 12] }, face: { node: [4, 12] },
    reward: 1200, par: 420, dmgLimit: 260,
    steps: [
      { type: 'goto', text: 'Get to the Oscorp depot', at: { node: [4, 12] }, radius: 26,
        lines: [L('FURY', 'An Oscorp van is carrying a live symbiote sample. It is about to leave the depot.'), L('FRIDAY', 'Intercept it. Steal a car, swing, or fly. Your call.')] },
      { type: 'cutscene', reveal: 'van', cam: { look: { place: 'depot' }, from: { place: 'depot', dx: 30, dz: 24, y: 8 }, to: { place: 'depot', dx: 20, dz: -10, y: 4 }, dur: 5 },
        lines: [L('MJ', 'There it is, the black van!'), L('FRIDAY', 'It is fleeing. Stay close to it and I can jam the engine.')] },
      { type: 'chase', text: 'Stop the Oscorp van', at: 'depot', hpFrac: 0.3, time: 200,
        lines: [L('FRIDAY', 'Stay within range and I will cook its engine. Ramming, gunfire and explosions work too.'), L('FRIDAY', 'No wheels? Steal one: walk up to any car and press interact.')] },
      { type: 'defeat', text: 'Take out the Oscorp guards', rooftopTimeout: 0,
        groups: [{ kind: 'goon', n: 4, at: { van: true }, r: [6, 12] }, { kind: 'hunter', n: 2, at: { van: true }, r: [10, 16], delay: 3 }],
        lines: [L('FRIDAY', 'The guards are bonded. Take them out.')] },
      { type: 'boss', kind: 'hunter', name: 'OSCORP ENFORCER', at: { van: true }, r: [10, 16], hpScale: 7, assist: true,
        minions: { kind: 'goon', every: 16, max: 2, r: [14, 22] },
        intro: [L('HIVE', 'Contain... the sample...')], text: 'Defeat the Oscorp Enforcer' },
    ],
    outro: [L('FRIDAY', 'Sample secured. Oscorp has a lab block where they were growing more of it.'), L('FURY', 'Go and shut it down.')],
  },

  // ------------------------------------------------------------------------------------------------ 4
  {
    key: 'eight-arms', title: 'Eight Arms', chapter: 'Chapter 4',
    villain: { name: 'Doctor Octopus', color: '#e08a3c', kind: 'docock' },
    briefing: 'Doctor Octavius has fused his tentacles with a symbiote shard in an Oscorp lab block. His octobots swarm every corridor. Destroy the cores, then the Doctor.',
    recommended: { hero: 'scarlet', why: 'Reality warping handles crowds of octobots. Anyone can win with patience.' },
    start: { node: [3, 9] }, face: { node: [2, 12] },
    reward: 1400, par: 540, dmgLimit: 300,
    steps: [
      { type: 'goto', text: 'Reach the Oscorp lab block', at: { node: [2, 12] }, radius: 24,
        lines: [L('FURY', 'Octavius took over a lab block near the depot. Power has been cut to half the district.'), L('FRIDAY', 'I am picking up eight mechanical limbs and one angry scientist.')] },
      { type: 'collect', text: 'Destroy the symbiote cores', n: 4, at: { node: [2, 12] }, r: [18, 60], color: 0xff9a40,
        guards: { kind: 'octobot', every: 10, max: 3, r: [16, 28] },
        lines: [L('FRIDAY', 'The cores feed his tentacles. Touch each one to burn it out.')] },
      { type: 'defeat', text: 'Destroy the octobot swarm',
        groups: [{ kind: 'octobot', n: 4, at: { node: [2, 12] }, r: [10, 20] }, { kind: 'octobot', n: 4, at: { node: [2, 12] }, r: [12, 24], delay: 7 }, { kind: 'goon', n: 2, at: { node: [2, 12] }, r: [8, 14], delay: 12 }],
        lines: [L('FRIDAY', 'Octobots incoming. They explode when they get close!')] },
      { type: 'boss', kind: 'docock', name: 'DOCTOR OCTOPUS', at: { node: [2, 12] }, r: [24, 30], fallback: 'hunter', fallbackHp: 10,
        minions: { kind: 'octobot', every: 20, max: 3, r: [16, 26] },
        intro: [L('OCTAVIUS', 'Eight arms, one mind. The hive gave me what I was always meant to have.'), L('FRIDAY', 'His tentacles will tire. Wait for the opening.')],
        phases: [{ below: 0.5, say: [L('OCTAVIUS', 'I will tear this block apart!')] }],
        text: 'Defeat Doctor Octopus' },
    ],
    outro: [L('OCTAVIUS', 'The quiet... at last. Thank you.'), L('MJ', 'Someone is throwing bombs from the rooftops downtown.')],
  },

  // ------------------------------------------------------------------------------------------------ 5
  {
    key: 'pumpkin-season', title: 'Pumpkin Season', chapter: 'Chapter 5',
    villain: { name: 'Green Goblin', color: '#9be03c', kind: 'goblin' },
    briefing: 'The Goblin glider is back, with a swarm of pumpkin drones. Keep the plaza from going up in flames, then bring him down to earth.',
    recommended: { hero: 'captain', why: 'Shield throws knock drones out of the air. All heroes can pull him down.' },
    start: { node: [4, 3] }, face: 'plaza',
    reward: 1600, par: 480, dmgLimit: 300,
    steps: [
      { type: 'goto', text: 'Get to the plaza', at: 'plaza', radius: 24,
        lines: [L('MJ', 'The Goblin is bombing Midtown! People are running everywhere.'), L('FRIDAY', 'The plaza is the center of his flight path. Go.')] },
      { type: 'survive', text: 'Survive the pumpkin swarm', seconds: 45,
        spawn: { kind: ['goblin_drone', 'goon'], every: 5, max: 5, r: [18, 30] },
        lines: [L('GOBLIN', 'Boom, boom, boom! Happy Halloween!'), L('FRIDAY', 'Drones everywhere. Keep moving, he cannot hit what he cannot catch.')] },
      { type: 'defeat', text: 'Clear the pumpkin drones',
        groups: [{ kind: ['goblin_drone', 'goon'], n: 4, at: 'plaza', r: [10, 20] }, { kind: 'goon', n: 4, at: 'plaza', r: [14, 24], delay: 5 }],
        lines: [L('FRIDAY', 'One last wave. After that, he will have to come down.')] },
      { type: 'boss', kind: 'goblin', name: 'GREEN GOBLIN', at: 'plaza', r: [22, 28], fallback: 'hunter', fallbackHp: 9,
        minions: { kind: ['goblin_drone', 'goon'], every: 22, max: 2, r: [16, 26] },
        intro: [L('GOBLIN', 'The hive made me wonderful! Now catch me if you can!'), L('FRIDAY', 'When he drops, hit him with everything.')],
        phases: [{ below: 0.5, say: [L('GOBLIN', 'More pumpkins!')] }],
        text: 'Defeat the Green Goblin' },
    ],
    outro: [L('FURY', 'Osborn is down. The hive jumped to another host: someone with a new god complex.')],
  },

  // ------------------------------------------------------------------------------------------------ 6
  {
    key: 'mischief', title: 'Mischief', chapter: 'Chapter 6',
    villain: { name: 'Loki', color: '#58d68d', kind: 'loki' },
    briefing: 'Loki has bonded with a symbiote shard and filled Times Square with illusions. Break the illusions by collecting the scepter shards, then catch the real Loki.',
    recommended: { hero: 'thor', why: 'Family business. Anyone can unmask the trickster.' },
    start: { node: [6, 6] }, face: 'plaza',
    reward: 1800, par: 480, dmgLimit: 300,
    steps: [
      { type: 'goto', text: 'Cross Times Square', at: 'plaza', radius: 22,
        lines: [L('FURY', 'Loki is walking down Times Square like he owns it.'), L('FRIDAY', 'Billboards are showing his face. He has been feeding the hive.'), L('MJ', 'That is not the real Loki. Do not trust your eyes.')] },
      { type: 'defeat', text: 'Dispel the illusions',
        groups: [{ kind: ['loki_illusion', 'goon'], n: 3, at: 'plaza', r: [8, 16] }, { kind: ['loki_illusion', 'goon'], n: 3, at: 'plaza', r: [12, 22], delay: 5 }, { kind: ['loki_illusion', 'goon'], n: 2, at: 'plaza', r: [14, 24], delay: 10 }],
        lines: [L('LOKI', 'Which of us is real? Guess, little heroes.')] },
      { type: 'collect', text: 'Collect the scepter shards', n: 3, at: 'plaza', r: [25, 70], color: 0x58f0a0,
        guards: { kind: ['loki_illusion', 'goon'], every: 12, max: 3, r: [18, 30] },
        lines: [L('FRIDAY', 'Scepter shards are anchoring the illusions. Gather them and he is exposed.')] },
      { type: 'boss', kind: 'loki', name: 'LOKI', at: 'plaza', r: [20, 28], fallback: 'hunter', fallbackHp: 9,
        minions: { kind: ['loki_illusion', 'goon'], every: 20, max: 3, r: [16, 26] },
        intro: [L('LOKI', 'Burdened with glorious purpose, and now with a little symbiote. Entertain me!'), L('FRIDAY', 'He keeps vanishing. The real one is the one that hits back.')],
        phases: [{ below: 0.5, say: [L('LOKI', 'Enough games!')] }],
        text: 'Defeat Loki' },
    ],
    outro: [L('LOKI', 'Hm. Well fought. The hive is... louder than I expected.'), L('FURY', 'There is a signal on Stark\'s servers. Avengers Tower.')],
  },

  // ------------------------------------------------------------------------------------------------ 7
  {
    key: 'no-strings', title: 'No Strings', chapter: 'Chapter 7',
    villain: { name: 'Ultron', color: '#ff5a4d', kind: 'ultron' },
    briefing: 'Ultron has uploaded himself into the tower network and hijacked the hive. Defend the tower uplink from his drones, then destroy the body he built.',
    recommended: { hero: 'ironman', why: 'It\'s his tower, after all. Every hero can get the job done.' },
    start: { node: [2, 4] }, face: { node: [4, 5] },
    reward: 2000, par: 540, dmgLimit: 320,
    steps: [
      { type: 'goto', text: 'Get to Avengers Tower', at: 'towerBase', radius: 22,
        lines: [L('FRIDAY', 'Ultron has locked me out of the tower. I am running on backup power.'), L('FURY', 'If he finishes uploading, he owns every drone in the city.')] },
      { type: 'defend', text: 'Defend the tower uplink', at: 'towerBase', label: 'TOWER UPLINK', hp: 200, seconds: 50, color: 0x66d0ff,
        spawn: { kind: ['ultron_drone', 'goon'], every: 5, max: 5, r: [16, 28] },
        lines: [L('ULTRON', 'There are no strings on me.'), L('FRIDAY', 'Keep them off the uplink, it needs 50 seconds to finish the countermeasure.')] },
      { type: 'defeat', text: 'Destroy the Ultron drones',
        groups: [{ kind: ['ultron_drone', 'goon'], n: 5, at: 'towerBase', r: [10, 20] }, { kind: ['ultron_drone', 'goon'], n: 4, at: 'towerBase', r: [14, 24], delay: 6 }],
        lines: [L('FRIDAY', 'That is the last of the drones. His main body is on its way down.')] },
      { type: 'boss', kind: 'ultron', name: 'ULTRON', at: 'towerBase', r: [26, 34], fallback: 'hunter', fallbackHp: 10,
        minions: { kind: ['ultron_drone', 'goon'], every: 22, max: 3, r: [18, 28] },
        intro: [L('ULTRON', 'Humanity is a design flaw. The hive just proves it.'), L('FRIDAY', 'Ultron\'s body is made of vibranium plate. Hit the joints. He will have to land to repair.')],
        phases: [{ below: 0.5, say: [L('ULTRON', 'Upgrade complete.')] }],
        text: 'Destroy Ultron' },
    ],
    outro: [L('FRIDAY', 'Network purged. The hive signal is concentrating on one point: the Brooklyn Bridge.'), L('FURY', 'Venom himself. This is it.')],
  },

  // ------------------------------------------------------------------------------------------------ 8
  {
    key: 'we-are-venom', title: 'We Are Venom', chapter: 'Chapter 8',
    villain: { name: 'Venom', color: '#b58cff', kind: 'venom' },
    briefing: 'The hive is nesting on the bridge deck. A Quinjet will drop you right on it. Hold the line against the symbiote tide, then take on Venom himself.',
    recommended: { hero: 'wolverine', why: 'Healing factor helps against the tide. Every hero can win this.' },
    start: { node: [1, 9] }, face: { node: [0, 9] },
    reward: 2600, par: 600, dmgLimit: 340,
    steps: [
      { type: 'goto', text: 'Go to the bridge approach', at: { node: [0, 9] }, radius: 20,
        lines: [L('FURY', 'The signal is coming from the bridge deck.'), L('FRIDAY', 'The deck is 24 meters up. A Quinjet will drop you on it.')] },
      { type: 'cutscene', teleport: 'deckStart', teleportYaw: -1.5708, cam: { look: 'deckC', from: { place: 'deckC', dx: 40, dz: 30, y: 38 }, to: { place: 'deckC', dx: 10, dz: -8, y: 30 }, dur: 6 },
        lines: [L('MJ', 'Be careful. Whatever is up there is massive.'), L('VENOM', 'We have been waiting for you.')] },
      { type: 'survive', text: 'Hold the line against the tide', seconds: 40,
        spawn: { kind: 'goon', every: 4, max: 6, r: [14, 24] },
        lines: [L('FRIDAY', 'Goons all over the deck. Do not fall off, I will just pull you back up.')] },
      { type: 'defeat', text: 'Break the hive guard',
        groups: [{ kind: 'hunter', n: 3, at: 'deckC', r: [8, 18] }, { kind: 'goon', n: 4, at: 'deckC', r: [10, 20], delay: 5 }],
        lines: [L('FRIDAY', 'These are the best of the hive. Then it is just Venom.')] },
      { type: 'boss', kind: 'venom', name: 'VENOM', at: 'deckC', r: [18, 24], arena: 'deck', fallback: 'hunter', fallbackHp: 12,
        minions: { kind: 'goon', every: 26, max: 2, r: [12, 22] },
        intro: [L('VENOM', 'We are Venom. We are the end of you.'), L('FRIDAY', 'Do not stand still. He will go for your weak side.')],
        text: 'Defeat Venom' },
    ],
    outro: [L('VENOM', '...we are... not alone...'), L('FRIDAY', 'Warning. The hive has a new host. A strand is fusing with Cletus Kasady.')],
  },

  // ------------------------------------------------------------------------------------------------ 9
  {
    key: 'maximum-carnage', title: 'Maximum Carnage', chapter: 'Finale',
    villain: { name: 'Carnage', color: '#ff2a3d', kind: 'carnage' },
    briefing: 'The last shard has found Cletus Kasady. The city burns. Waves of Carnage spawn flood the streets. End it at the source, once and for all.',
    recommended: { hero: 'hulk', why: 'Soak up the damage and smash. Or pick whoever you love most. Any hero wins.' },
    start: { node: [3, 6] }, face: 'plaza', burn: true,
    reward: 4000, par: 720, dmgLimit: 400,
    steps: [
      { type: 'goto', text: 'Go to the heart of the city', at: 'plaza', radius: 26,
        lines: [L('FURY', 'All of Manhattan is on fire. Every symbiote left is converging on Times Square.'), L('MJ', 'I believe in you. All of you.'), L('FRIDAY', 'Marker set. Good luck.')] },
      { type: 'survive', text: 'Survive the Carnage spawn', seconds: 60,
        spawn: { kind: ['carnage_spawn', 'goon'], every: 4, max: 7, r: [16, 28] },
        lines: [L('CARNAGE', 'Carnage! CARNAGE!'), L('FRIDAY', 'They are endless until he falls. Survive the first push.')] },
      { type: 'defeat', text: 'Break the Carnage vanguard',
        groups: [{ kind: ['carnage_spawn', 'goon'], n: 5, at: 'plaza', r: [10, 20] }, { kind: ['carnage_spawn', 'goon'], n: 5, at: 'plaza', r: [14, 26], delay: 6 }, { kind: 'hunter', n: 2, at: 'plaza', r: [12, 20], delay: 10 }],
        lines: [L('FRIDAY', 'He is coming. Heal up if you can.')] },
      { type: 'boss', kind: 'carnage', name: 'CARNAGE', at: 'plaza', r: [24, 32], fallback: 'hunter', fallbackHp: 13,
        minions: { kind: ['carnage_spawn', 'goon'], every: 18, max: 3, r: [16, 28] },
        intro: [L('CARNAGE', 'Let\'s paint this town red!'), L('FRIDAY', 'Cletus has bonded with the whole hive. Take him down.')],
        phases: [{ below: 0.5, say: [L('CARNAGE', 'You want a second round? Bring friends!'), L('FRIDAY', 'Phase two: Venom-spawn are joining him!')],
          spawn: [{ kind: 'venom', n: 1, hpScale: 0.12, r: [14, 22] }] }],
        text: 'End Carnage' },
    ],
    outro: [L('FURY', 'The hive is gone. New York is still standing.'), L('MJ', 'You did it.'), L('FRIDAY', 'Hero, mission complete. The city thanks you.')],
  },
];

MISSIONS.forEach((m, i) => { m.id = i; m.num = i; });
