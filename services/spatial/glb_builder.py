"""Small deterministic, embedded-only glTF writer for authored local geometry.

Vertices are batched by material, with smooth normals and repeatable UVs. This is
an asset authoring helper, not an image reconstruction or physics estimator.
"""
from __future__ import annotations

from collections import defaultdict
import json
import math
import struct


def normalize(v):
    length = math.sqrt(sum(x*x for x in v)) or 1
    return tuple(x/length for x in v)


def quaternion_y(angle):
    return (0., math.sin(angle/2), 0., math.cos(angle/2))


def multiply(a,b):
    x,y,z,w=a;u,v,t,s=b
    return (w*u+x*s+y*t-z*v,w*v-x*t+y*s+z*u,w*t+x*v-y*u+z*s,w*s-x*u-y*v-z*t)


def rotate(v, q):
    x,y,z,w=q; a,b,c=v
    tx,ty,tz=2*(y*c-z*b),2*(z*a-x*c),2*(x*b-y*a)
    return (a+w*tx+y*tz-z*ty,b+w*ty+z*tx-x*tz,c+w*tz+x*ty-y*tx)


def between(a, b):
    """Quaternion rotating positive Y onto a segment; supports antiparallel Y."""
    direction=normalize(tuple(b[i]-a[i] for i in range(3)))
    if direction[1] < -.999999: return (1.,0.,0.,0.)
    return normalize((direction[2],0.,-direction[0],1+direction[1]))


def rounded_box(size, radius=.035):
    half=[x/2 for x in size];r=min(radius,min(half)*.95)
    vertices=[];normals=[];uv=[];indices=[]
    # Face grids resolve the quarter-circle bevel, preserving a flat middle.
    for axis, sign, uaxis, vaxis in ((0,1,2,1),(0,-1,1,2),(1,1,0,2),(1,-1,2,0),(2,1,1,0),(2,-1,0,1)):
        def coordinates(h):return [-h,-h+r*.293,-h+r,h-r,h-r*.293,h]
        us,vs=coordinates(half[uaxis]),coordinates(half[vaxis]);base=len(vertices)
        for v in vs:
            for u in us:
                p=[0.,0.,0.];p[axis]=sign*half[axis];p[uaxis]=u;p[vaxis]=v
                inner=[max(-half[i]+r,min(half[i]-r,p[i])) for i in range(3)]
                n=normalize(tuple(p[i]-inner[i] for i in range(3)))
                vertices.append(tuple(inner[i]+n[i]*r for i in range(3)));normals.append(n);uv.append((u,v))
        for j in range(5):
            for i in range(5):
                a=base+j*6+i;indices.extend((a,a+1,a+7,a,a+7,a+6))
    # All grid windings are oriented by the analytic outward normal.
    for i in range(0,len(indices),3):
        a,b,c=[vertices[indices[i+j]] for j in range(3)]
        ab=[b[k]-a[k] for k in range(3)];ac=[c[k]-a[k] for k in range(3)]
        cross=(ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0])
        if sum(cross[k]*normals[indices[i]][k] for k in range(3))<0:indices[i+1],indices[i+2]=indices[i+2],indices[i+1]
    return vertices,normals,uv,indices


def lathe(profile, segments=32, caps=True):
    """Profile of (height,radius), ascending height, with outward smooth normals."""
    positions=[];normals=[];uv=[];indices=[]
    for j,(y,r) in enumerate(profile):
        lo,hi=profile[max(0,j-1)],profile[min(len(profile)-1,j+1)]
        dy,dr=hi[0]-lo[0],hi[1]-lo[1]
        for i in range(segments+1):
            angle=i/segments*math.tau;c,s=math.cos(angle),math.sin(angle)
            positions.append((r*c,y,r*s));normals.append(normalize((dy*c,-dr,dy*s)));uv.append((i/segments*math.tau*r,y))
    for j in range(len(profile)-1):
        for i in range(segments):
            a=j*(segments+1)+i;indices.extend((a,a+segments+2,a+1,a,a+segments+1,a+segments+2))
    if caps:
        for j,sign in ((0,-1),(len(profile)-1,1)):
            y,r=profile[j];base=len(positions);positions.append((0,y,0));normals.append((0,sign,0));uv.append((.5,.5))
            for i in range(segments+1):
                angle=i/segments*math.tau;c,s=math.cos(angle),math.sin(angle)
                positions.append((r*c,y,r*s));normals.append((0,sign,0));uv.append((c*r,s*r))
            for i in range(segments):
                indices.extend((base,base+i+2,base+i+1) if sign>0 else (base,base+i+1,base+i+2))
    return positions,normals,uv,indices


def ellipsoid(size, segments=16, rings=8):
    positions=[];normals=[];uv=[];indices=[]
    for j in range(rings+1):
        phi=math.pi*j/rings
        for i in range(segments+1):
            theta=math.tau*i/segments;v=(math.sin(phi)*math.cos(theta),math.cos(phi),math.sin(phi)*math.sin(theta))
            positions.append(tuple(v[k]*size[k]/2 for k in range(3)));normals.append(normalize(tuple(v[k]/size[k] for k in range(3))));uv.append((i/segments,j/rings))
    for j in range(rings):
        for i in range(segments):
            a=j*(segments+1)+i;indices.extend((a,a+1,a+segments+2,a,a+segments+2,a+segments+1))
    return positions,normals,uv,indices


class Builder:
    def __init__(self, materials, textures):
        self.materials,self.textures=materials,textures
        self.batches=defaultdict(lambda:[[],[],[],[]])

    def add(self, material, geometry, position=(0,0,0), rotation=(0,0,0,1), uv_scale=1):
        p,n,uv,indices=geometry;batch=self.batches[material];base=len(batch[0])
        batch[0].extend(tuple(rotate(v,rotation)[i]+position[i] for i in range(3)) for v in p)
        batch[1].extend(rotate(v,rotation) for v in n);batch[2].extend((u*uv_scale,v*uv_scale) for u,v in uv);batch[3].extend(i+base for i in indices)
        return self

    def box(self, material, position, size, radius=.025, angle=0, uv_scale=1):
        return self.add(material,rounded_box(size,radius),position,quaternion_y(angle),uv_scale)

    def cylinder(self, material, position, radius, height, segments=24, radius_top=None):
        return self.add(material,lathe([(-height/2,radius),(height/2,radius if radius_top is None else radius_top)],segments),position)

    def rod(self, material, a, b, radius=.02, segments=10):
        height=math.dist(a,b)
        return self.add(material,lathe([(-height/2,radius),(height/2,radius)],segments),tuple((a[i]+b[i])/2 for i in range(3)),between(a,b))

    def sphere(self, material, position, size, rotation=(0,0,0,1), segments=16,rings=8):
        return self.add(material,ellipsoid(size,segments,rings),position,rotation)

    def build(self, name):
        binary=bytearray();views=[];accessors=[]
        def raw(data,target=None):
            binary.extend(b'\0'*(-len(binary)%4));start=len(binary);binary.extend(data)
            item={'buffer':0,'byteOffset':start,'byteLength':len(data)}
            if target:item['target']=target
            views.append(item);return len(views)-1
        def accessor(values,components,kind,index=False):
            flat=[v for row in values for v in row] if components>1 else values
            component=5125 if index else 5126;fmt='I' if index else 'f'
            item={'bufferView':raw(struct.pack('<'+fmt*len(flat),*flat),34963 if index else 34962),'componentType':component,'count':len(values),'type':kind}
            if kind=='VEC3':item.update(min=[min(row[i] for row in values) for i in range(3)],max=[max(row[i] for row in values) for i in range(3)])
            accessors.append(item);return len(accessors)-1
        used=list(self.batches);images=[];textures=[];material_defs=[];texture_lookup={}
        def texture(key):
            if key not in texture_lookup:
                images.append({'bufferView':raw(self.textures[key]),'mimeType':'image/png','name':key})
                textures.append({'source':len(images)-1,'sampler':0});texture_lookup[key]=len(textures)-1
            return {'index':texture_lookup[key]}
        for key in used:
            source=self.materials[key];pbr={'baseColorFactor':source.get('color',[1,1,1,1]),'metallicFactor':source.get('metal',0),'roughnessFactor':source.get('roughness',.8)}
            if source.get('texture'):pbr['baseColorTexture']=texture(source['texture'])
            if source.get('roughness_texture'):pbr['metallicRoughnessTexture']=texture(source['roughness_texture'])
            mat={'name':key,'pbrMetallicRoughness':pbr}
            if source.get('normal'):mat['normalTexture']={**texture(source['normal']),'scale':source.get('normal_scale',.35)}
            if source.get('alpha'):mat.update(alphaMode='BLEND',doubleSided=True)
            if source.get('double'):mat['doubleSided']=True
            if source.get('emissive'):mat['emissiveFactor']=source['emissive']
            material_defs.append(mat)
        primitives=[]
        for material,(p,n,uv,indices) in self.batches.items():
            primitives.append({'attributes':{'POSITION':accessor(p,3,'VEC3'),'NORMAL':accessor(n,3,'VEC3'),'TEXCOORD_0':accessor(uv,2,'VEC2')},'indices':accessor(indices,1,'SCALAR',True),'material':used.index(material)})
        doc={'asset':{'version':'2.0','generator':'Brivany manual-reference-authoring-v1'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'name':name,'mesh':0}],'meshes':[{'name':name,'primitives':primitives}],'materials':material_defs,'buffers':[{'byteLength':len(binary)}],'bufferViews':views,'accessors':accessors}
        if images:doc.update(images=images,textures=textures,samplers=[{'magFilter':9729,'minFilter':9987,'wrapS':10497,'wrapT':10497}])
        js=json.dumps(doc,separators=(',',':'),allow_nan=False).encode();js+=b' '*(-len(js)%4);binary.extend(b'\0'*(-len(binary)%4))
        length=12+8+len(js)+8+len(binary)
        return struct.pack('<4sII',b'glTF',2,length)+struct.pack('<I4s',len(js),b'JSON')+js+struct.pack('<I4s',len(binary),b'BIN\0')+binary
