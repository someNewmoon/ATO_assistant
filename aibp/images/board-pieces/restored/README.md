# Panel overhead image restorations

The selected `hekaton-v1.webp` is used for both the Hekaton logo and its board piece. It was encoded from the selected transparent PNG with a 1024px maximum edge. The artwork faces south at rest.

Generated with the built-in `image_gen` tool, not the CLI. One edit call per input: `hekaton-top.png`, `labyrinthauros-top.png`, `temenos-top.png`, `pursuer-top.png` from the existing hosted card-art pack. Originals are unchanged.

Outputs: `hekaton-hd.webp`, `labyrinthauros-hd.webp`, `temenos-hd.webp`, `pursuer-hd.webp`. The generated transparent PNGs were encoded as WebP at 1024px maximum edge, quality 0.94, preserving alpha. The runtime uses the complete restored illustration without the earlier hand-drawn clip path.

## Prompt set

The following prompt was used separately with `{name}` replaced by each of the four IDs above:

```text
Use case: precise image restoration. Edit target: the attached original board-game monster-panel overhead diagram ({name}). Restore THIS EXACT printed illustration at high resolution for a small board marker. Preserve its exact silhouette, pose, top-down projection, limb count, horns/head/robe/weapon shapes, proportions, orientation, brown/ochre or gray palette, original fine ink strokes and shading. Only remove print halftone/noise, reconstruct crisp edges and sharpen the existing illustration. Do NOT redesign, stylize, cartoonize, simplify into an icon, add details, anatomy, limbs, framing, logos, text or a direction arrow. No creative reinterpretation. Remove only the surrounding gray grid/card background, and any printed grid lines outside the figure. Transparent background. Keep all of the original figure, centered with a small transparent margin. This is faithful cleanup of an existing image, NOT a new character design.
```
