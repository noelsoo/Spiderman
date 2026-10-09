// Post-processing pipeline. Owned by the graphics agent; main.js only calls createPost / render / setSize.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export function createPost(game) {
  const { renderer, scene, camera, settings } = game;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  // MSAA on the composer's target: the canvas antialias flag does not apply once we render through passes.
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: settings.quality === 'low' ? 0 : 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.6, 0.85);
  bloom.enabled = settings.quality !== 'low';
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  return {
    composer, bloom,
    render(dt) { composer.render(dt); },
    setSize(w, h) { composer.setSize(w, h); },
  };
}
