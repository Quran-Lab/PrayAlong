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

Tested on three unrelated rigs (a Mixamo mannequin, a Ready Player Me avatar
and a stylised cartoon character) with no per-character changes.

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

## Getting the look from the mockup

The mockup's soft, rounded Pixar-like style is a modelling job, not a code
job. Two routes that land in the spec above:

1. **Commission** a character artist with this page as the brief.
2. **Image → 3D → auto-rig**: generate from the mockup render with an
   image-to-3D tool (Meshy, Tripo, Rodin), auto-rig it (Mixamo or AccuRIG),
   export GLB in T-pose. Clean up in Blender if needed.

Plan a small cast so people can pick a companion who feels like them — for
example a boy, a girl in hijab, a man, a woman in hijab, and an elder.

## Adding one

1. Drop the file in `public/avatars/`.
2. Add an entry to `src/components/stage/characters.ts`.
3. Check it in the Pose Lab: `/?lab&pose=sujud&character=/avatars/<file>.glb`
   (add `&az=1.57` for a side view).

Once there's more than one, a **Companion** picker appears in Settings.
