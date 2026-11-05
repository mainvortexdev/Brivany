"""Deterministic procedural GLB demonstration. No AI model, capture or GPU."""
from __future__ import annotations
import hashlib
import json
import math
from pathlib import Path
import struct
from uuid import UUID
from contracts.spatial import SceneManifest

DEMO_VERSION = "brivany-procedural-room-1"
DEMO_ID = "11111111-1111-4111-8111-111111111111"


def _cube():
    positions=[]; normals=[]; indices=[]
    faces=[((1,0,0),[(.5,-.5,-.5),(.5,.5,-.5),(.5,.5,.5),(.5,-.5,.5)]),
           ((-1,0,0),[(-.5,-.5,.5),(-.5,.5,.5),(-.5,.5,-.5),(-.5,-.5,-.5)]),
           ((0,1,0),[(-.5,.5,-.5),(-.5,.5,.5),(.5,.5,.5),(.5,.5,-.5)]),
           ((0,-1,0),[(-.5,-.5,.5),(-.5,-.5,-.5),(.5,-.5,-.5),(.5,-.5,.5)]),
           ((0,0,1),[(.5,-.5,.5),(.5,.5,.5),(-.5,.5,.5),(-.5,-.5,.5)]),
           ((0,0,-1),[(-.5,-.5,-.5),(-.5,.5,-.5),(.5,.5,-.5),(.5,-.5,-.5)])]
    for normal,vertices in faces:
        offset=len(positions)//3
        for vertex in vertices: positions.extend(vertex);normals.extend(normal)
        indices.extend([offset,offset+1,offset+2,offset,offset+2,offset+3])
    return positions,normals,indices


def _cylinder(segments=32):
    positions=[];normals=[];indices=[]
    for i in range(segments+1):
        angle=i/segments*math.tau;x,z=math.cos(angle),math.sin(angle)
        for y in (-.5,.5):positions.extend((x*.5,y,z*.5));normals.extend((x,0,z))
    for i in range(segments):
        j=i*2;indices.extend((j,j+1,j+3,j,j+3,j+2))
    for y,normal in ((-.5,-1),(.5,1)):
        center=len(positions)//3;positions.extend((0,y,0));normals.extend((0,normal,0))
        for i in range(segments+1):
            angle=i/segments*math.tau;positions.extend((math.cos(angle)*.5,y,math.sin(angle)*.5));normals.extend((0,normal,0))
        for i in range(segments):
            a,b=center+1+i,center+2+i
            indices.extend((center,b,a) if normal==1 else (center,a,b))
    return positions,normals,indices


MATERIALS=[("plaster",[.86,.85,.81,1],.93,0), ("oak",[.50,.34,.20,1],.75,0),
           ("fabric",[.60,.65,.61,1],.98,0),("cushion",[.79,.77,.69,1],1,0),
           ("metal",[.12,.13,.12,1],.4,.65),("shade",[.93,.90,.81,1],.9,0),
           ("floor",[.73,.67,.56,1],.85,0),("rug",[.80,.79,.75,1],1,0),
           ("window",[.54,.69,.75,1],.4,0),("trim",[.95,.94,.90,1],.75,0)]


def make_glb(parts):
    """Build embedded geometry only: no URI, scripts, textures or extension hooks."""
    binary=bytearray();views=[];accessors=[];meshes=[];nodes=[]
    def block(values,fmt,target,kind,components):
        while len(binary)%4:binary.append(0)
        start=len(binary);binary.extend(struct.pack("<"+fmt*len(values),*values))
        views.append({"buffer":0,"byteOffset":start,"byteLength":len(binary)-start,"target":target})
        item={"bufferView":len(views)-1,"componentType":5126 if fmt=="f" else 5123,"count":len(values)//components,"type":kind}
        if kind=="VEC3":
            item["min"]=[min(values[i::3]) for i in range(3)];item["max"]=[max(values[i::3]) for i in range(3)]
        accessors.append(item);return len(accessors)-1
    for geometry in (_cube(),_cylinder()):
        positions,normals,indices=geometry
        meshes.append({"primitives":[{"attributes":{"POSITION":block(positions,"f",34962,"VEC3",3),"NORMAL":block(normals,"f",34962,"VEC3",3)},"indices":block(indices,"H",34963,"SCALAR",1),"material":0}]})
    # Reuse buffers with a mesh per material/shape instead of duplicate vertices.
    base=list(meshes);meshes=[];lookup={}
    for material in range(len(MATERIALS)):
        for shape in range(2):
            primitive={**base[shape]["primitives"][0],"material":material}
            lookup[(shape,material)]=len(meshes);meshes.append({"primitives":[primitive]})
    for shape,material,position,scale in parts:
        nodes.append({"mesh":lookup[(shape,material)],"translation":position,"scale":scale})
    document={"asset":{"version":"2.0","generator":DEMO_VERSION},"scene":0,"scenes":[{"nodes":list(range(len(nodes)))}],
              "nodes":nodes,"meshes":meshes,"materials":[{"name":name,"pbrMetallicRoughness":{"baseColorFactor":color,"roughnessFactor":rough,"metallicFactor":metal}} for name,color,rough,metal in MATERIALS],
              "buffers":[{"byteLength":len(binary)}],"bufferViews":views,"accessors":accessors}
    js=json.dumps(document,separators=(",",":"),ensure_ascii=True).encode();js+=b" "*((-len(js))%4)
    binary+=b"\0"*((-len(binary))%4)
    length=12+8+len(js)+8+len(binary)
    return struct.pack("<4sII",b"glTF",2,length)+struct.pack("<I4s",len(js),b"JSON")+js+struct.pack("<I4s",len(binary),b"BIN\0")+binary


def demo_assets():
    box=lambda material,p,s:(0,material,p,s)
    cyl=lambda material,p,s:(1,material,p,s)
    room=[box(6,[0,-.08,0],[6.2,.16,5.0]),box(0,[0,1.5,-2.5],[6.2,3,.12]),box(0,[-3.05,1.5,0],[.12,3,5]),
          box(7,[0,.008,.25],[3.5,.016,2.5]),box(9,[0,.08,-2.4],[6.1,.16,.06]),box(9,[-2.96,.08,0],[.06,.16,4.9]),
          box(8,[.8,1.85,-2.42],[2.35,1.45,.025]),box(9,[.8,2.61,-2.37],[2.5,.08,.10]),box(9,[.8,1.09,-2.37],[2.5,.08,.10]),
          box(9,[-.42,1.85,-2.37],[.08,1.6,.10]),box(9,[2.02,1.85,-2.37],[.08,1.6,.10]),box(9,[.8,1.85,-2.37],[.04,1.45,.10])]
    chair=[box(2,[0,.32,0],[1.35,.35,1.25]),box(2,[0,.83,-.50],[1.35,.80,.25]),box(3,[0,.55,.05],[.98,.20,.92]),
           box(2,[-.62,.65,0],[.18,.55,1.2]),box(2,[.62,.65,0],[.18,.55,1.2])]
    for x in (-.48,.48):
        for z in (-.43,.43):chair.append(box(1,[x,.12,z],[.10,.24,.10]))
    table=[cyl(1,[0,.48,0],[1.30,.10,1.30]),cyl(4,[0,.23,0],[.12,.46,.12]),cyl(4,[0,.025,0],[.75,.05,.75])]
    lamp=[cyl(4,[0,.025,0],[.42,.05,.42]),cyl(4,[0,.81,0],[.035,1.62,.035]),cyl(5,[0,1.6,0],[.62,.44,.62])]
    return {name:make_glb(parts) for name,parts in (("room",room),("chair",chair),("table",table),("lamp",lamp))}


def scene_document(scene_id=DEMO_ID,title="Estudio de luz"):
    assets=demo_assets();positions={"room":[0.,0.,0.],"chair":[-1.2,0.,-.45],"table":[.35,0.,.55],"lamp":[1.85,0.,-1.35]}
    names={"room":"Espacio","chair":"Sillón","table":"Mesa","lamp":"Lámpara"}
    scene=SceneManifest(scene_id=UUID(scene_id),origin="generated_demo",capture_id=None,title=title,source_frame_ids=[],
        assets=[{"id":name,"kind":"mesh","relative_path":f"assets/{name}.glb","sha256":hashlib.sha256(data).hexdigest(),"provenance":"generated","source_frame_ids":[],"note":"Geometría procedural de demostración creada localmente; no procede de una captura."} for name,data in assets.items()],
        objects=[{"id":name,"label":names[name],"asset_id":name,"editable":name!="room","role":"environment" if name=="room" else "object","transform":{"position":positions[name]}} for name in assets],
        limitations=["Escena de demostración procedural; no es una habitación reconstruida.","Unidades relativas; dimensiones y propiedades físicas no verificadas.","Edición geométrica sin simulación física ni colisiones."])
    return scene,assets
