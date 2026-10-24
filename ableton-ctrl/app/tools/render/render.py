"""Render the device straight down, orthographic, framed to the body.

  Blender -b --python render.py -- device.glb out.webp [samples] [scale]

Env overrides: BODY, PAD, GLASS (albedos), KEY "x,y,z,size,watts",
HDRI name (Blender's bundled ones), HDRI_STRENGTH, HDRI_ROT, BORDER.

The body (140 x 210 mm) fills the frame exactly: at scale 1 the image is
2048 x 3072 px, two pixels per device unit of the UI. Background is
transparent; the page supplies the gradient under it.
"""
import os
import sys
from math import radians

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
GLB, OUT = argv[0], argv[1]
SAMPLES = int(argv[2]) if len(argv) > 2 else 256
SCALE = float(argv[3]) if len(argv) > 3 else 1.0
# Look overrides for iterating: BODY (metal grey), KEY "x,y,z,size,watts".
BODY = float(os.environ.get("BODY", "0.018"))
KEY = [float(v) for v in os.environ.get("KEY", "0.07,0.42,0.22,0.5,3.5").split(",")]
PAD = float(os.environ.get("PAD", "0.02"))
GLASS = float(os.environ.get("GLASS", "0.006"))

BODY_W, BODY_H = 0.140, 0.210  # metres

# ── Scene ────────────────────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=GLB)
objs = [o for o in scene.objects if o.type == "MESH"]

# The mesh is in millimetres with Z up; the glTF importer turned Y up.
# Bring it back and into metres so lights and bumps use real sizes.
for o in objs:
    o.rotation_mode = "XYZ"  # the importer leaves objects in quaternion mode
    o.rotation_euler = (radians(-90), 0, 0)
    o.scale = (0.001, 0.001, 0.001)
bpy.ops.object.select_all(action="DESELECT")
for o in objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def dims(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


lo_all = Vector((1e9, 1e9, 1e9))
hi_all = Vector((-1e9, -1e9, -1e9))
for o in objs:
    lo, hi = dims(o)
    lo_all = Vector(map(min, lo_all, lo))
    hi_all = Vector(map(max, hi_all, hi))
size = hi_all - lo_all
print("bbox mm", [round(v * 1000, 2) for v in lo_all], [round(v * 1000, 2) for v in hi_all])
assert abs(size.x - BODY_W) < 1e-3 and abs(size.y - BODY_H) < 1e-3, "unexpected orientation"

# ── Classify parts by size ───────────────────────────────────────────────
body, screen, pads, circles = [], [], [], []
for o in objs:
    lo, hi = dims(o)
    d = hi - lo
    if d.x > 0.1 and d.y > 0.2:
        body.append(o)
    elif abs(d.x - 0.128) < 1e-3:
        screen.append(o)
    elif abs(d.x - 0.030) < 1e-3:
        pads.append(o)
    elif abs(d.x - 0.017) < 1e-3:
        circles.append(o)
    else:
        print("unclassified", o.name, d)
print("body", len(body), "screen", len(screen), "pads", len(pads), "circles", len(circles))
assert len(body) == 1 and len(screen) == 1 and len(pads) == 8 and len(circles) == 8

for o in objs:
    for p in o.data.polygons:
        p.use_smooth = True
    o.data.shade_smooth()


# ── Materials ────────────────────────────────────────────────────────────
def new_material(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    links = m.node_tree.links
    bsdf = nodes["Principled BSDF"]
    return m, nodes, links, bsdf


def noise_bump(nodes, links, bsdf, scale, detail, strength, distance, roughness=0.6, layers=()):
    """A noise bump on the BSDF; `layers` adds finer (scale, strength) grains chained on top."""
    coord = nodes.new("ShaderNodeTexCoord")
    prev = None
    for sc, st in [(scale, strength), *layers]:
        noise = nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = sc
        noise.inputs["Detail"].default_value = detail
        noise.inputs["Roughness"].default_value = roughness
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = st
        bump.inputs["Distance"].default_value = distance
        links.new(coord.outputs["Object"], noise.inputs["Vector"])
        links.new(noise.outputs["Fac"], bump.inputs["Height"])
        if prev is not None:
            links.new(prev.outputs["Normal"], bump.inputs["Normal"])
        prev = bump
    links.new(prev.outputs["Normal"], bsdf.inputs["Normal"])
    return prev


# Body: black metal with a stele-like micro texture — a fine, hard grain
# that only shows where the raking light catches it, plus a slow drift in
# roughness so the surface is not one even sheen.
m, nodes, links, bsdf = new_material("BodyMetal")
bsdf.inputs["Base Color"].default_value = (BODY, BODY, BODY * 1.04, 1)
bsdf.inputs["Metallic"].default_value = 0.9
bsdf.inputs["Roughness"].default_value = 0.55
bsdf.inputs["Coat Weight"].default_value = 0.1
bsdf.inputs["Coat Roughness"].default_value = 0.35
noise_bump(nodes, links, bsdf, scale=12000, detail=6, strength=0.06, distance=0.00002, roughness=0.6,
           layers=[(45000, 0.09)])
drift = nodes.new("ShaderNodeTexNoise")
drift.inputs["Scale"].default_value = 400
drift.inputs["Detail"].default_value = 4
ramp = nodes.new("ShaderNodeMapRange")
ramp.inputs["From Min"].default_value = 0.35
ramp.inputs["From Max"].default_value = 0.65
ramp.inputs["To Min"].default_value = 0.52
ramp.inputs["To Max"].default_value = 0.58
links.new(drift.outputs["Fac"], ramp.inputs["Value"])
links.new(ramp.outputs["Result"], bsdf.inputs["Roughness"])
for o in body:
    o.data.materials.clear()
    o.data.materials.append(m)

# Pads: dark grey silicone — matte, a little soft under the light, with a
# finer, gentler grain than the metal.
m, nodes, links, bsdf = new_material("PadSilicone")
bsdf.inputs["Base Color"].default_value = (PAD, PAD, PAD * 1.03, 1)
bsdf.inputs["Metallic"].default_value = 0.0
bsdf.inputs["Roughness"].default_value = 0.85
bsdf.inputs["Specular IOR Level"].default_value = 0.35
bsdf.inputs["Subsurface Weight"].default_value = 0.0
bsdf.inputs["Subsurface Radius"].default_value = (0.0008, 0.0008, 0.0008)
noise_bump(nodes, links, bsdf, scale=4000, detail=6, strength=0.12, distance=0.00002)
for o in pads:
    o.data.materials.clear()
    o.data.materials.append(m)

# Screens: dark glass set into the metal — one broad, soft reflection and
# nothing else, so they read as the same object with its lights off.
m, nodes, links, bsdf = new_material("ScreenGlass")
bsdf.inputs["Base Color"].default_value = (GLASS, GLASS, GLASS * 1.06, 1)
bsdf.inputs["Metallic"].default_value = 0.0
bsdf.inputs["Roughness"].default_value = 0.2
bsdf.inputs["Specular IOR Level"].default_value = 0.6
bsdf.inputs["Coat Weight"].default_value = 0.8
bsdf.inputs["Coat Roughness"].default_value = 0.06
for o in screen + circles:
    o.data.materials.clear()
    o.data.materials.append(m)

# ── Camera: straight down, orthographic, the body edge on the frame edge ──
cam_data = bpy.data.cameras.new("Cam")
cam_data.type = "ORTHO"
cam_data.sensor_fit = "VERTICAL"
cam_data.ortho_scale = BODY_H
cam = bpy.data.objects.new("Cam", cam_data)
scene.collection.objects.link(cam)
cam.location = (BODY_W / 2, BODY_H / 2, 1.0)
cam.rotation_euler = (0, 0, 0)
scene.camera = cam


# ── Light: one large soft source from the upper left, raking across the
# body so the grain and the pad edges carry the volume; a whisper of fill
# from the lower right so the far edges do not vanish into the background.
def area(name, loc, size, energy, aim):
    d = bpy.data.lights.new(name, "AREA")
    d.shape = "SQUARE"
    d.size = size
    d.energy = energy
    o = bpy.data.objects.new(name, d)
    scene.collection.objects.link(o)
    o.location = loc
    tgt = bpy.data.objects.new(name + "Aim", None)
    scene.collection.objects.link(tgt)
    tgt.location = aim
    c = o.constraints.new("TRACK_TO")
    c.target = tgt
    c.track_axis = "TRACK_NEGATIVE_Z"
    c.up_axis = "UP_Y"
    return o


centre = (BODY_W / 2, BODY_H / 2, 0.006)
area("Key", tuple(KEY[:3]), KEY[3], KEY[4], centre)
area("Fill", (0.7, -0.5, 0.9), 1.0, 1.0, centre)

# World: not black — a faint, even dark grey, so the glass and the metal
# have something to reflect and the shadow side keeps a trace of form.
HDRI = os.environ.get("HDRI", "interior")
HDRI_STRENGTH = float(os.environ.get("HDRI_STRENGTH", "0.3"))
HDRI_ROT = float(os.environ.get("HDRI_ROT", "95"))
world = bpy.data.worlds.new("World")
scene.world = world
world.use_nodes = True
wn, wl = world.node_tree.nodes, world.node_tree.links
bg = wn["Background"]
bg.inputs["Strength"].default_value = HDRI_STRENGTH
env = wn.new("ShaderNodeTexEnvironment")
env.image = bpy.data.images.load(
    os.path.join(bpy.utils.resource_path("LOCAL"), "datafiles", "studiolights", "world", f"{HDRI}.exr")
)
mapping = wn.new("ShaderNodeMapping")
mapping.inputs["Rotation"].default_value = (0, 0, radians(HDRI_ROT))
coord = wn.new("ShaderNodeTexCoord")
wl.new(coord.outputs["Generated"], mapping.inputs["Vector"])
wl.new(mapping.outputs["Vector"], env.inputs["Vector"])
desat = wn.new("ShaderNodeHueSaturation")
desat.inputs["Saturation"].default_value = 0.0
wl.new(env.outputs["Color"], desat.inputs["Color"])
wl.new(desat.outputs["Color"], bg.inputs["Color"])

# ── Render ───────────────────────────────────────────────────────────────
scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "METAL"
prefs.get_devices()
for dev in prefs.devices:
    dev.use = dev.type == "METAL"
scene.cycles.device = "GPU"
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.cycles.denoiser = "OPENIMAGEDENOISE"
scene.render.resolution_x = int(2048 * SCALE)
scene.render.resolution_y = int(3072 * SCALE)
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
if OUT.lower().endswith(".webp"):
    # The app ships the WebP: a sixth of the PNG, with the alpha kept.
    scene.render.image_settings.file_format = "WEBP"
    scene.render.image_settings.quality = 92
else:
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_depth = "8"
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
border = os.environ.get("BORDER")
if border:
    x0, y0, x1, y1 = [float(v) for v in border.split(",")]
    scene.render.use_border = True
    scene.render.use_crop_to_border = True
    scene.render.border_min_x, scene.render.border_max_x = x0, x1
    scene.render.border_min_y, scene.render.border_max_y = y0, y1
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print("wrote", OUT)
