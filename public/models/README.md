# Optional model overrides (GLB)

The game ships procedural characters. To replace one with your own licensed model, drop a binary glTF here
and list its id in `manifest.json` (only listed files are requested, so a default install never logs 404s):

```json
{ "probe": false, "models": ["spiderman", "hulk"] }
```
(`"probe": true` tries every id; missing files then show as harmless 404s in the browser console.)

## Filenames
`spiderman.glb`, `ironman.glb`, `hulk.glb`, `thor.glb`, `venom.glb`, `goon.glb`, `hunter.glb`

## Requirements
- Y up, metres, character faces **+Z**, feet at the origin (it is auto-scaled to the target height: Spider-Man 1.78, Iron Man 1.88, Hulk 2.7, Thor 1.95, Venom 2.6, goon 1.8, hunter 1.85).
- Skinned rig with a standard humanoid bone naming (Mixamo style: `RightHand`, `Head`, `Spine2`...) so hand/head/chest attach points are found.
- Animation clips are matched by fuzzy name: idle, run, sprint, jump, fall, land, swing, wallrun, glide, fly, hover, dash, dodge, punch, kick, uppercut, throw, shoot, smash, cast, stun, death. Missing clips fall back (e.g. sprint -> run).
- Symbiote variants, hammer, thrusters and muzzle are procedural-only; GLB models skip them.

## Where to get models and animation legitimately
- Rigging and animations: Mixamo (free with an Adobe account) - upload a T-pose mesh, download FBX/GLB with skin.
- Models: Sketchfab, CGTrader, TurboSquid - only with a licence that allows your use. Marvel characters are trademarked; most fan models are rips of copyrighted game assets. Use them for personal, non-commercial play only and do not redistribute them.
