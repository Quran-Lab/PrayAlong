import bpy, sys, os, math, mathutils
path, out = sys.argv[-2], os.path.abspath(sys.argv[-1])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
mn = mathutils.Vector((1e9,)*3); mx = -mn
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(c); mn = mathutils.Vector(map(min, mn, w)); mx = mathutils.Vector(map(max, mx, w))
h = mx.z - mn.z; ctr = (mn + mx) / 2
sc = bpy.context.scene; sc.render.engine = 'BLENDER_EEVEE'; sc.render.resolution_x = 600; sc.render.resolution_y = 900
sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.32, 0.33, 0.34)
sc.view_settings.view_transform = 'Standard'
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam; cam.data.lens = 85
for loc, e in [((1.5, -3, 3), 420), ((-3, -2, 1.5), 160), ((0, 3, 3), 260)]:
    l = bpy.data.objects.new('l', bpy.data.lights.new('l', 'AREA')); l.data.energy = e*h*h; l.data.size = 3*h
    l.location = ctr + mathutils.Vector(loc)*h; l.rotation_euler = (ctr - l.location).to_track_quat('-Z','Y').to_euler(); sc.collection.objects.link(l)
views = [('front', 0, 0.5, 4.2), ('34', 35, 0.5, 4.2), ('side', 90, 0.5, 4.2), ('back', 180, 0.5, 4.2), ('face', 0, 0.86, 1.3), ('hand', 25, 0.5, 1.5)]
for name, yaw, zf, d in views:
    t = mathutils.Vector((ctr.x, ctr.y, mn.z + h*zf))
    if name == 'hand':
        # find the lowest-right extreme in x: hand region
        t = mathutils.Vector((mn.x + 0.12*(mx.x-mn.x), ctr.y, mn.z + h*0.47))
    a = math.radians(yaw); dist = d*h
    cam.location = t + mathutils.Vector((math.sin(a)*dist, -math.cos(a)*dist, 0.02*h))
    cam.rotation_euler = (t - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = out + f'_{name}.png'; bpy.ops.render.render(write_still=True)
tris = sum(len(o.data.polygons) for o in objs); print('H', h, 'faces', tris, 'meshes', len(objs))
