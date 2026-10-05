# Companion characters

PrayAlong never hand-animates a character. Postures are authored once in a
normalized humanoid space (`src/components/stage/rig/prayer-poses.ts`) and
applied to whichever character is loaded:

- **Spine, head and legs**: forward kinematics on standard humanoid bones.
- **Hands**: IK to landmarks on *that* character — its chest, knees, thighs,
  ears, the mat beside its head — with an explicit palm orientation.
- **Grounding**: knees, feet and toes are kept on the mat and the toes stay
  on one spot, as a real worshipper's do.
- **Sujud**: the torso pitches until the character's own forehead rests on
  the mat, whatever its proportions.

- **Raising the hands** (Sifat Salat an-Nabi; al-Bukhari 735, 739): besides the opening takbir,
  the hands go up to the ears before bowing, while rising from it ("sami‘allāhu liman ḥamidah")
  and when standing up from the first tashahhud, then come down. These are waypoints with a short
  hold (`waypoints()` in `prayer-poses.ts`, tested in `prayer-poses.test.ts`); hands-free counts
  raised hands as standing when the learner rises.
- **Ruku**: the back level, about 90° at the hips, the head in line with it and the legs straight.

Tested on three unrelated third-party rigs (a Mixamo mannequin, a Ready
Player Me avatar and a stylised cartoon character) with no per-character
changes, and on the four PrayAlong companions below.

## The cast

| | File | Look |
| --- | --- | --- |
| Yusuf | `public/avatars/yusuf.glb` | Swoopy brown hair, cream kurta, olive trousers |
| Maryam | `public/avatars/maryam.glb` | Dusty-rose hijab over a cream under-scarf, periwinkle dress |
| Ahmad | `public/avatars/ahmad.glb` | White kufi, short beard, stone thobe over sirwal |
| Aisha | `public/avatars/aisha.glb` | Sand hijab with a long cape, plum abaya |

Each is ~1 MB and ~30k triangles, T-pose, Mixamo skeleton with finger roots,
eyes modelled closed. They're built by Blender scripts — reproducible and
editable:

```bash
pip install bpy==5.0.1 scikit-image
python3 tools/characters/build_yusuf.py        # ~3–5 min; also maryam, ahmad, aisha
python3 tools/characters/validate_glb.py public/avatars/*.glb
```

`common.py` holds the modelling, rig, weighting and export helpers; `kit.py`
the shared head/face, hands, feet, skeletons, hijab builder and weight
rules. Options: `NO_RENDER=1` (export only), `POSES=1` (render the postures
in Blender), `CHAR_CACHE=<dir>`, `PREVIEW_DIR=<dir>`.

Known rough edges: a small dark sliver at the hijab cape edge beside the
right arm when sitting; long skirts read slightly boxy on the lap and the
hem trim stretches in sujud; Ahmad has a tiny notch at the collar opening.

Portraits for the picker (`public/avatars/<id>.webp`) are cropped from
Pose Lab renders so they match the app's lighting.

## Asset spec

| | |
| --- | --- |
| Format | **GLB** (glTF 2.0 binary) or **VRM** 0.x/1.0 |
| Skeleton | Humanoid. GLB: Mixamo bone names, with or without the `mixamorig:` prefix (Mixamo, AccuRIG, Meshy, Tripo and Avaturn all export these). VRM: standard humanoid mapping. |
| Rest pose | T-pose or A-pose, facing +Z, Y up. Any scale. |
| Required bones | Hips, Spine, Head, both arms (upper/lower/hand), both legs (upper/lower/foot). Recommended: Spine1/2, Neck, ToeBase, finger roots (Index1/Middle1/Pinky1) for accurate palms. |
| Face | Eyes close during prayer if the asset has `eyeBlinkLeft`/`eyeBlinkRight` (ARKit) morph targets or a VRM `blink` expression. A gentle smile uses `mouthSmile*` / VRM `happy`. |
| Budget | ≤ 30k triangles, ≤ 2 × 2048² textures, ≤ 6 MB. |
| Clothing | Modest prayer clothing. Long garments (thobe, abaya, jilbab) work best skinned to the legs with a little extra hip/thigh weight so the hem follows when kneeling. |

## The cast

| Id | Look | Build |
| --- | --- | --- |
| `brother` | Adult, faceless (cream face and ears, short black hair at the temples): black kufi, long black thobe with a mandarin collar, three buttons, cuffs and the Quran Lab mark on the chest, bare feet | `tools/characters/build_brother.py` |
| `sister` | Adult, faceless: black khimar falling like a bell to the waist, headband and niqab with a cream eye strip, slim black abaya to the floor, black socks | `tools/characters/build_sister.py` |

Both follow the brief's pose sheet (`prayer_app_assets/images`, 32 steps): a slim, stylised adult
of about seven heads, long arms, hands with fingers. They share the tall body in
`tools/characters/kit.py` (`tall_body`, `tall_head`, `adult_hand`, `tall_field`, `mark_sdf`), and the
khimar uses `hijab_weights` and the abaya `skirt_weights` from `main`. Brother 29.5k triangles,
sister 31.7k (the khimar's thin hem needs the extra faces). Both pass `validate_glb.py`.
Rebuild a GLB with `NO_RENDER=1 python3 tools/characters/build_sister.py`, and
its picker thumbnail with `THUMB_ONLY=1` (needs `avifenc`).

The companion is picked in Settings. Picking it from the camera is a placeholder for now; see
[FEATURE-GAPS.md](FEATURE-GAPS.md#companion-matching-from-the-camera-a-placeholder-for-now).

## Getting the look from the mockup

The mockup's soft, rounded Pixar-like style is a modelling job, not a code
job. Two routes that land in the spec above:

1. **Commission** a character artist with this page as the brief.
2. **Image → 3D → auto-rig**: generate from the mockup render with an
   image-to-3D tool (Meshy, Tripo, Rodin), auto-rig it (Mixamo or AccuRIG),
   export GLB in T-pose. Clean up in Blender if needed.

Ideas for more: an elder, a younger child, more skin tones and clothing
styles, so everyone can pick a companion who feels like them.

## Adding one

1. Drop the file in `public/avatars/`.
2. Add an entry (with a `thumbnail`) to `src/components/stage/characters.ts`.
3. Check it in the Pose Lab: `/?lab&pose=sujud&character=/avatars/<file>.glb`
   (add `&az=1.57` for a side view).

The **Companion** picker in Settings lists every entry.
