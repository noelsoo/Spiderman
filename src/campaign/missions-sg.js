// Campaign data: "Lion City Outbreak" (Singapore, Marina Bay). Pure data, same format as missions.js.
//
// STORY: a Hive spore culture escaped from a biotech lab and surfaced at the Merlion. It spreads along the bay: a stolen
// van runs the samples to the Helix Bridge, the Supertrees are used as a growth lattice, and the Hive's host climbs the
// Marina Bay Sands SkyPark to broadcast the spores over the whole city. Any of the heroes can win every mission.
//
// Place specs (see resolvePlace in objectives.js): { place: 'merlion' | 'helix' | 'helixN' | 'gardens' | 'mbsPlaza' | 'skypark' | ... },
// { xz: [x, z] } for raw Marina Bay coordinates. Every mission point is snapped out of buildings and the bay at run time.
// The SkyPark is reached by an F.R.I.D.A.Y. drone lift (cutscene teleport), so it works for heroes that cannot swing or fly.
//
// Dialogue is British English. Lines are { who, text }.

const L = (who, text) => ({ who, text });

export const SG_META = {
  title: 'Lion City Outbreak', key: 'sm-campaign-sg', city: 'Singapore',
  finale: 'The Hive is destroyed. Marina Bay is safe.',
  blurb: 'Lion City Outbreak: stop the symbiote outbreak across Marina Bay.',
};

// the SkyPark leash keeps heroes (and the fight) on the deck: a fall to the plaza is a lift back up
const CHASE_ROUTE = [{ place: 'vanStart' }, { place: 'vanCorner' }, { xz: [-100, -440] }, { xz: [140, -440] }, { place: 'helixN' }];
const SKY_LEASH = { at: { place: 'skypark' }, dy: 14, r: 95 };

export const MISSIONS_SG = [
  // ------------------------------------------------------------------------------------------------ 0
  {
    key: 'merlion-breach', num: 1, title: 'Merlion Breach', chapter: 'Part 1',
    villain: { name: 'The Lizard', color: '#6bd36a', kind: 'lizard' },
    briefing: 'A Hive culture has surfaced beside the Merlion and the bay is boiling. Clear the infected, gather the spore samples before the tide takes them, then stop what is left of Dr. Connors, who was visiting the city.',
    recommended: { hero: 'spiderman', why: 'The promenade is wide open and full of lamp posts to swing from. Everyone else: keep to the pier and fight in the open.' },
    start: { xz: [-338, -255] }, face: 'merlion', time: 0.7,
    reward: 700, par: 540, dmgLimit: 240,
    steps: [
      { type: 'cutscene', cam: { look: 'merlionStatue', from: { place: 'merlion', dx: -40, dz: 38, y: 22 }, to: { place: 'merlion', dx: 22, dz: 30, y: 12 }, dur: 7 },
        lines: [L('FURY', 'Marina Bay, one in the morning. The harbour police have lost contact with a patrol boat.'), L('MEI', 'Dr. Mei Tan, Biopolis. One of our cultures got out and it is not ours any more. It is alive, and it is hungry.'), L('FRIDAY', 'Scanning. Alien biomass confirmed along the whole waterfront. Marker set at the Merlion.')] },
      { type: 'goto', text: 'Head to the Merlion', at: 'merlion', radius: 22,
        lines: [L('MEI', 'It started at the Merlion. Someone dropped a sample into the spout.'), L('FRIDAY', 'Keep to the promenade. The quay edge is slippery.')] },
      { type: 'defeat', text: 'Clear the infected',
        groups: [{ kind: 'goon', n: 3, at: 'merlion', r: [10, 20] }, { kind: 'goon', n: 3, at: 'merlion', r: [14, 26], delay: 7 }, { kind: 'hunter', n: 1, at: 'merlion', r: [14, 24], delay: 12 }],
        lines: [L('FRIDAY', 'Hostiles on the pier. Goons are weak alone, but they come in numbers.'), L('MEI', 'They used to be tourists. Please be gentle where you can.')] },
      { type: 'collect', text: 'Gather the spore samples', n: 3, at: 'merlion', r: [24, 62], color: 0x4fffd0,
        guards: { kind: 'goon', every: 14, max: 2, r: [24, 36] },
        lines: [L('MEI', 'The spores are glowing. Collect them before the tide pulls them into the bay.')] },
      { type: 'boss', kind: 'lizard', name: 'THE LIZARD', at: 'merlion', r: [24, 30], fallback: 'hunter', fallbackHp: 9,
        minions: { kind: 'lizardman', every: 26, max: 2, r: [16, 26] },
        floorY: 0, leash: { at: 'merlion', dy: 12, r: 150 },
        intro: [L('LIZARD', 'We... did not mean to come here. The water called to us.'), L('FRIDAY', 'Dr. Connors, infected by the culture. Subdue him and the antidote will have something to work on.')],
        phases: [{ below: 0.66, say: [L('LIZARD', 'It hurts! Make it stop!')] }, { below: 0.33, say: [L('FRIDAY', 'He is flagging. Finish this gently.')] }],
        text: 'Subdue the Lizard' },
    ],
    outro: [L('MEI', 'He is breathing. Thank you. But the culture was only a part of the plan.'), L('FRIDAY', 'A dark van has just left the quay with the rest of the samples. It is heading for the Helix Bridge.')],
  },

  // ------------------------------------------------------------------------------------------------ 1
  {
    key: 'helix-run', num: 2, title: 'Helix Run', chapter: 'Part 2',
    villain: { name: 'The Brute', color: '#7a2bd0', kind: 'hunter' },
    briefing: 'The Hive\'s couriers have loaded the samples into a van. Chase it along the bay to the Helix Bridge, jam its engine, then take down the brute guarding the cargo on the bridge deck.',
    recommended: { hero: 'ironman', why: 'Fast flight keeps up with the van. Everyone else: the van waits for you if you fall behind, so just keep going.' },
    start: { place: 'vanStart', dz: 10 }, face: { place: 'vanCorner' }, time: 0.72,
    reward: 900, par: 600, dmgLimit: 280,
    steps: [
      { type: 'cutscene', reveal: 'van', at: 'vanStart', route: CHASE_ROUTE,
        cam: { look: 'vanStart', from: { place: 'vanStart', dx: 30, dz: 40, y: 14 }, to: { place: 'vanStart', dx: -16, dz: 14, y: 7 }, dur: 5 },
        lines: [L('FRIDAY', 'There. Black van, no plates, and it is carrying the spores.'), L('FURY', 'Do not let it reach the Helix Bridge.'), L('MEI', 'Jam the engine. The van is fitted with a tracker I can use to help.')] },
      { type: 'chase', text: 'Stop the van', label: 'HIVE VAN', time: 220, hpFrac: 0.3, jam: 16,
        route: CHASE_ROUTE,
        lines: [L('FRIDAY', 'Stay within seventeen metres and I will jam its engine.'), L('MEI', 'It is heading north then east, straight for the Helix.')] },
      { type: 'goto', text: 'Cross onto the Helix Bridge', at: 'helix', radius: 14,
        lines: [L('FRIDAY', 'The van is disabled. The cargo is being carried across the Helix by hand.'), L('MEI', 'The bridge is the way out of the bay. If it gets across, the spores reach the city.')] },
      { type: 'defeat', text: 'Clear the bridge deck', floorY: 6, leash: { at: 'helix', dy: 7, r: 130 },
        groups: [{ kind: 'goon', n: 3, at: 'helix', r: [6, 16] }, { kind: 'hunter', n: 2, at: 'helix', r: [6, 16], delay: 5 }, { kind: 'goon', n: 3, at: 'helix', r: [6, 16], delay: 11 }],
        lines: [L('FRIDAY', 'The deck is narrow. Use the steel ribs for cover.')] },
      { type: 'boss', kind: 'hunter', name: 'HIVE BRUTE', at: 'helix', r: [8, 15], hpScale: 7, assist: true, floorY: 6, leash: { at: 'helix', dy: 7, r: 130 },
        minions: { kind: 'goon', every: 16, max: 2, r: [6, 16] },
        intro: [L('HIVE', 'The bridge is ours...'), L('FRIDAY', 'A bonded brute. Hit hard, and keep clear of the railings.')],
        phases: [{ below: 0.66, say: [L('FRIDAY', 'He is slowing. Keep it up.')] }, { below: 0.33, say: [L('HIVE', 'More... more...')] }],
        text: 'Defeat the Hive Brute' },
    ],
    outro: [L('MEI', 'The cargo is safe. One sample is missing, though. It was taken to the Gardens by the Bay.'), L('FURY', 'Then that is where you are going.')],
  },

  // ------------------------------------------------------------------------------------------------ 2
  {
    key: 'supertree-siege', num: 3, title: 'Supertree Siege', chapter: 'Part 3',
    villain: { name: 'Green Goblin', color: '#9be03c', kind: 'goblin' },
    briefing: 'The Hive is using the Supertree Grove as a growth lattice. Defend the power grid that keeps the trees cool, hold the grove against the swarm, and bring down the Goblin who is feeding the spores to the canopy.',
    recommended: { hero: 'hawkeye', why: 'Drones and the Goblin hover over the trees. Melee heroes: the Goblin will land to fight, so be patient.' },
    start: { xz: [430, 300] }, face: 'gardens', time: 0.76,
    reward: 1100, par: 600, dmgLimit: 300,
    steps: [
      { type: 'goto', text: 'Reach the Supertree Grove', at: 'gardens', radius: 24,
        lines: [L('FURY', 'The last sample was taken into the Gardens by the Bay. Power across the grove is failing.'), L('MEI', 'The trees are covered in glowing veins. They are using the Supertrees as a lattice.'), L('FRIDAY', 'Marker set. Mind the walkways.')] },
      { type: 'defend', text: 'Protect the grove power grid', at: { place: 'gardens', dx: -20, dz: -10 }, label: 'GROVE POWER GRID', hp: 170, seconds: 45, color: 0x55ffcc,
        spawn: { kind: ['goblin_drone', 'goon'], every: 5, max: 5, r: [16, 30] },
        lines: [L('MEI', 'If the grid dies, the cooling fails and the spores bloom. Please hold it.'), L('FRIDAY', 'Drones and infected inbound. Do not let them near the grid.')] },
      { type: 'defeat', text: 'Clear the Supertree Grove',
        groups: [{ kind: ['goblin_drone', 'goon'], n: 4, at: 'gardens', r: [10, 24] }, { kind: 'goon', n: 4, at: 'gardens', r: [14, 28], delay: 6 }],
        lines: [L('FRIDAY', 'More of them. Keep moving between the trunks.')] },
      { type: 'boss', kind: 'goblin', name: 'GREEN GOBLIN', at: 'gardens', r: [24, 30], fallback: 'hunter', fallbackHp: 9,
        minions: { kind: ['goblin_drone', 'goon'], every: 22, max: 2, r: [16, 26] },
        intro: [L('GOBLIN', 'Look at it! A garden of the future, and I am its gardener!'), L('FRIDAY', 'Pumpkin bombs and drones. Watch his telegraphs, and strike when he lands.')],
        phases: [{ below: 0.66, say: [L('GOBLIN', 'You are spoiling my harvest!')] }, { below: 0.33, say: [L('GOBLIN', 'Then I shall burn the whole grove!')] }],
        text: 'Defeat the Green Goblin' },
    ],
    outro: [L('GOBLIN', 'The Hive... promised... me...'), L('MEI', 'The grove is clear. The spore signal is now strongest at Marina Bay Sands.'), L('FRIDAY', 'Something is climbing the SkyPark. A strong host.')],
  },

  // ------------------------------------------------------------------------------------------------ 3
  {
    key: 'skypark-ascent', num: 4, title: 'Sky High', chapter: 'Part 4',
    villain: { name: 'Kraven the Hunter', color: '#d9a441', kind: 'kraven' },
    briefing: 'The spore signal is being broadcast from the Marina Bay Sands SkyPark, two hundred metres up. A drone lift will carry you to the deck. Fight through the Hive\'s hunters, then face the hunter who commands them.',
    recommended: { hero: 'thor', why: 'Lightning clears the deck quickly. Everyone else: the SkyPark is wide, so use the open ground and the garden trees for cover.' },
    start: { xz: [200, 215] }, face: 'mbsPlaza', time: 0.77,
    reward: 1400, par: 600, dmgLimit: 320,
    steps: [
      { type: 'goto', text: 'Go to the foot of Marina Bay Sands', at: 'mbsPlaza', radius: 20,
        lines: [L('FURY', 'Whatever is on top of that tower is feeding off the signal.'), L('FRIDAY', 'The lifts are blocked, but I have a drone that can take you to the deck.'), L('MEI', 'Be careful. It is a very long way down.')] },
      { type: 'cutscene', teleport: 'skypark', teleportYaw: 0,
        cam: { look: { place: 'skypark' }, from: { place: 'skypark', dx: 34, dz: -6, y: 223 }, to: { place: 'skypark', dx: -16, dz: 8, y: 212 }, dur: 5 },
        lines: [L('FRIDAY', 'Drone lift engaged. Hold tight.'), L('FRIDAY', 'You are on the SkyPark. Hostiles on the deck.')] },
      { type: 'defeat', text: 'Clear the SkyPark', floorY: 205, leash: SKY_LEASH,
        groups: [{ kind: 'goon', n: 3, at: { place: 'skypark' }, r: [10, 22] }, { kind: 'hunter', n: 2, at: { place: 'skypark' }, r: [12, 24], delay: 5 }, { kind: ['kraven_hunter', 'hunter'], n: 3, at: { place: 'skypark' }, r: [14, 26], delay: 10 }],
        lines: [L('FRIDAY', 'The garden deck is open ground. Take cover behind the trees if you need to.')] },
      { type: 'boss', kind: 'kraven', name: 'KRAVEN THE HUNTER', at: { place: 'skypark' }, r: [20, 28], fallback: 'hunter', fallbackHp: 9, floorY: 205, leash: SKY_LEASH,
        minions: { kind: ['kraven_hunter', 'hunter'], every: 24, max: 2, r: [16, 28] },
        intro: [L('KRAVEN', 'The tallest hunting ground in the East. Fitting, for the finest quarry.'), L('FRIDAY', 'He is fast and he hits hard. Watch for the wind-up before each lunge.')],
        phases: [{ below: 0.66, say: [L('KRAVEN', 'Good! You make me work for it!')] }, { below: 0.33, say: [L('KRAVEN', 'The hive makes me perfect!')] }],
        text: 'Defeat Kraven' },
    ],
    outro: [L('KRAVEN', 'You... are the better hunter.'), L('FRIDAY', 'The signal is not coming from Kraven. The source is still on the deck, and it is awake.')],
  },

  // ------------------------------------------------------------------------------------------------ 4
  {
    key: 'hive-over-the-bay', num: 5, title: 'Hive Over the Bay', chapter: 'Finale',
    villain: { name: 'Venom', color: '#b58cff', kind: 'venom' },
    briefing: 'Night has fallen over Marina Bay. The Hive\'s host stands on the SkyPark and is about to broadcast the spores across the city. Hold the deck, break the host\'s guard and end it at the source.',
    recommended: { hero: 'hulk', why: 'Soak up the damage and smash. Or pick whoever you love most. Any hero wins.' },
    start: { xz: [200, 215] }, face: 'mbsPlaza', time: 0.01,
    reward: 2500, par: 660, dmgLimit: 380,
    steps: [
      { type: 'cutscene', teleport: 'skypark', teleportYaw: 0,
        cam: { look: { place: 'skypark' }, from: { place: 'skypark', dx: -34, dz: -6, y: 224 }, to: { place: 'skypark', dx: 18, dz: 10, y: 213 }, dur: 6 },
        lines: [L('FURY', 'Midnight over Marina Bay. Every light on the skyline is pulsing in time with the signal.'), L('MEI', 'The host is on the deck. If it speaks, the spores go out across the whole city.'), L('FRIDAY', 'Drone lift engaged. This is the last one.')] },
      { type: 'survive', text: 'Hold the SkyPark', seconds: 55, floorY: 205, leash: SKY_LEASH,
        spawn: { kind: ['carnage_spawn', 'goon'], every: 4, max: 6, r: [14, 26] },
        lines: [L('HIVE', 'Join us...'), L('FRIDAY', 'They are coming up from the tower. Hold until the host shows itself.')] },
      { type: 'defeat', text: 'Break the Hive\'s guard', floorY: 205, leash: SKY_LEASH,
        groups: [{ kind: ['carnage_spawn', 'goon'], n: 4, at: { place: 'skypark' }, r: [10, 22] }, { kind: 'hunter', n: 2, at: { place: 'skypark' }, r: [12, 24], delay: 6 }, { kind: 'goon', n: 3, at: { place: 'skypark' }, r: [14, 26], delay: 10 }],
        lines: [L('FRIDAY', 'Almost there. Heal up if you can.')] },
      { type: 'boss', kind: 'venom', name: 'VENOM', at: { place: 'skypark' }, r: [18, 24], fallback: 'hunter', fallbackHp: 12, floorY: 205, leash: SKY_LEASH,
        minions: { kind: 'goon', every: 26, max: 2, r: [12, 22] },
        intro: [L('VENOM', 'We are Venom. And this city will be ours.'), L('FRIDAY', 'He will go for your weak side. Do not stand still.')],
        phases: [{ below: 0.66, say: [L('VENOM', 'We will not be stopped!'), L('FRIDAY', 'He is angry. Stay mobile.')] }, { below: 0.33, say: [L('VENOM', 'The Hive hungers!'), L('FRIDAY', 'One last push. Take him down.')] }],
        text: 'End the Hive' },
    ],
    outro: [L('VENOM', '...we are... not... alone...'), L('MEI', 'The signal has stopped. The bay is calm again.'), L('FURY', 'Well done. Singapore is safe.'), L('FRIDAY', 'Hero, mission complete. The Lion City thanks you.')],
  },
];

MISSIONS_SG.forEach((m, i) => { m.id = i; m.num = i; });
