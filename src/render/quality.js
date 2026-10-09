// Shared quality resolution so the world and the post pipeline agree on the tier.
export const TIERS = ['low', 'medium', 'high', 'ultra'];
export const tierIndex = (q) => Math.max(0, TIERS.indexOf(q));

let _soft = null;
/** true on software rasterisers (SwiftShader / llvmpipe), where we force the low tier. */
export function isSoftwareRenderer(renderer) {
  if (_soft !== null) return _soft;
  _soft = false;
  try {
    const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    _soft = /swiftshader|llvmpipe|software/i.test(name);
  } catch { /* ignore */ }
  return _soft;
}

/** Effective tier: requested setting, forced to 'low' on software GL, overridable with window.__FORCE_WORLD_QUALITY. */
export function resolveQuality(renderer, requested = 'high') {
  let q = TIERS.includes(requested) ? requested : 'high';
  if (isSoftwareRenderer(renderer)) q = 'low';
  if (globalThis.__FORCE_WORLD_QUALITY) q = globalThis.__FORCE_WORLD_QUALITY;
  return q;
}
