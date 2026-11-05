"""Authored 3D interpretation of the supplied interior reference images.

This is manual, deterministic modelling with procedural materials. It does not
estimate cameras, measure the room, reconstruct geometry, or execute AI models.
The photographs remain private evidence in ReferenceSetService, never textures.
"""
from __future__ import annotations

from functools import lru_cache
import hashlib
from io import BytesIO
import math
import random
from uuid import UUID

from PIL import Image
from .glb_builder import Builder, lathe, multiply, quaternion_y


VERSION = 'brivany-reference-interior-1'


def _png(image):
    output=BytesIO();image.save(output,format='PNG',optimize=False,compress_level=8);return output.getvalue()


@lru_cache(maxsize=1)
def _surface_library():
    """Tileable color/normal/roughness maps from analytic patterns, not photos."""
    textures={}
    colors={'linen':(229,220,201),'wood':(155,112,68),'floor':(207,194,171),
            'jute':(170,139,94),'plaster':(219,210,192),'stone':(194,181,158),'rattan':(155,116,64)}
    for name,color in colors.items():
        size=256 if name=='floor' else 128;rng=random.Random(name);height=[];pixels=[];rough=[]
        for y in range(size):
            for x in range(size):
                noise=rng.uniform(-1,1)
                if name in ('wood','floor'):
                    grain=math.sin(math.tau*x/size*18+1.8*math.sin(math.tau*y/size))*2+math.sin(math.tau*x/size*53+math.sin(math.tau*y/size*3))*1.7
                    plank=(int(x/(size/5))+int(y/(size/2)))%5
                    seam= -24 if name=='floor' and (x%(size//5)<1 or (y+(int(x/(size/5))%2)*size//2)%size<1) else 0
                    value=grain+noise*2+seam+(plank-2)*1.2;h=.5+grain*.008+noise*.008
                elif name in ('linen','jute','rattan'):
                    # Warp and weft crossings, periodic at texture boundaries.
                    wave=math.sin(math.tau*x/8)*math.cos(math.tau*y/8);fine=math.cos(math.tau*x/4)+math.sin(math.tau*y/4)
                    value=wave*7+fine*2+noise*2;h=.5+wave*.11+fine*.03
                elif name=='stone':
                    value=noise*9+math.sin(x*1.73+y*2.91)*3;h=.5+noise*.035
                else:value=noise*2;h=.5+noise*.015
                pixels.append(tuple(max(0,min(255,round(c+value))) for c in color));height.append(h)
                rough.append((0,235 if name!='wood' else 190,0))
        image=Image.new('RGB',(size,size));image.putdata(pixels);textures[name]=_png(image)
        normal=[]
        for y in range(size):
            for x in range(size):
                dx=height[y*size+(x+1)%size]-height[y*size+(x-1)%size]
                dy=height[((y+1)%size)*size+x]-height[((y-1)%size)*size+x]
                n=(-dx,-dy,1);length=math.sqrt(sum(v*v for v in n));normal.append(tuple(round((v/length*.5+.5)*255) for v in n))
        image=Image.new('RGB',(size,size));image.putdata(normal);textures[name+'-normal']=_png(image)
        image=Image.new('RGB',(size,size));image.putdata(rough);textures[name+'-rough']=_png(image)
    materials={}
    for name in colors:
        materials[name]={'texture':name,'normal':name+'-normal','roughness_texture':name+'-rough','normal_scale':.32,'roughness':1.}
    # Linen hue variants share texture maps rather than extra texture families.
    materials.update({
        'ivory':{'texture':'linen','normal':'linen-normal','normal_scale':.28,'roughness':.96},
        'teal':{'color':[.18,.32,.29,1.],'texture':'linen','normal':'linen-normal','roughness':.98},
        'rust':{'color':[.66,.29,.10,1.],'texture':'linen','normal':'linen-normal','roughness':.96},
        'white':{'color':[.94,.92,.86,1.],'roughness':.82},
        'black':{'color':[.035,.038,.035,1.],'metal':.62,'roughness':.36},
        'bronze':{'color':[.39,.21,.075,1.],'metal':.7,'roughness':.3},
        'leaf':{'color':[.09,.19,.055,1.],'roughness':.65,'double':True},
        'leaf-light':{'color':[.16,.28,.075,1.],'roughness':.7,'double':True},
        'soil':{'color':[.11,.065,.03,1.],'roughness':1.},
        'paper':{'color':[.77,.73,.63,1.],'roughness':.94},
        'glass':{'color':[.78,.86,.88,.13],'roughness':.14,'alpha':True},
        'bulb':{'color':[1.,.85,.57,1.],'emissive':[1.,.66,.22],'roughness':.3},
        'outdoor':{'color':[.72,.77,.72,1.],'roughness':1.},
    })
    return materials,textures


def _builder():return Builder(*_surface_library())


def _legs(b, x, z, top, radius=.028, material='wood', spread=.08):
    for sx in (-1,1):
        for sz in (-1,1):b.rod(material,(sx*(x+spread),0,sz*(z+spread)),(sx*x,top,sz*z),radius)


def _chair():
    b=_builder();_legs(b,.22,.205,.47,.026,spread=.04)
    b.box('jute',(0,.465,0),(.53,.07,.49),.06,uv_scale=6)
    for x in (-.25,.25):
        b.rod('wood',(x,.4,-.215),(x,.91,-.25),.024)
        b.rod('wood',(x,.57,.16),(x,.74,-.24),.022)
    b.box('wood',(0,.84,-.25),(.59,.17,.065),.055)
    for z in (-.2,.2):b.rod('wood',(-.23,.19,z),(.23,.19,z),.014)
    for x in (-.22,.22):b.rod('wood',(x,.2,-.23),(x,.2,.23),.014)
    return b.build('Silla de comedor de roble y cuerda')


def _sofa():
    b=_builder();_legs(b,1.46,.36,.16,.032,material='black',spread=0)
    b.box('ivory',(0,.29,0),(3.45,.37,1.02),.12,uv_scale=3)
    b.box('ivory',(0,.79,-.40),(3.43,.83,.29),.13,uv_scale=3)
    for x in (-1.68,1.68):b.box('ivory',(x,.61,.03),(.25,.78,1.06),.11,uv_scale=3)
    for x in (-1.08,0,1.08):
        b.box('ivory',(x,.55,.11),(1.04,.25,.83),.12,uv_scale=4)
        b.box('ivory',(x,.91,-.25),(1.04,.70,.24),.11,uv_scale=4)
    # Distinct removable-looking cushions are real rounded 3D surfaces.
    for material,x,size,angle in [('rust',-1.27,.58,-.17),('teal',-.92,.52,.15),('ivory',1.0,.53,-.12),('rust',1.35,.60,.22)]:
        b.box(material,(x,.97,-.02),(size,size,.19),.085,angle,uv_scale=6)
    b.box('rust',(-1.48,.57,.28),(.30,.06,.91),.035,uv_scale=6)
    return b.build('Sofá beige de tres plazas con cojines')


def _coffee():
    b=_builder()
    b.add('black',lathe([( .43,.68),(.445,.75),(.48,.75),(.495,.72)],48))
    for x in (-.51,.51):
        for z in (-.43,.43):b.box('black',(x,.225,z),(.027,.43,.027),.006)
        b.box('black',(x,.025,0),(.027,.025,.89),.005)
    b.rod('black',(-.5,.025,-.48),(.5,.025,.48),.012);b.rod('black',(-.5,.025,.48),(.5,.025,-.48),.012)
    # Books and two small bronze cups, batched into the table asset.
    b.box('paper',(.21,.518,.17),(.39,.042,.27),.006,angle=-.12)
    b.box('black',(.23,.548,.17),(.40,.018,.28),.004,angle=-.12)
    b.box('paper',(-.21,.515,.21),(.34,.025,.23),.004,angle=.2)
    for x,z in ((-.22,-.16),(.03,-.24)):
        b.add('bronze',lathe([(0,.045),(.012,.049),(.11,.043),(.115,.04)],20),(x,.495,z))
    return b.build('Mesa de centro circular negra y libros')


def _dining():
    b=_builder();b.box('wood',(0,.78,0),(2.28,.085,1.03),.10,uv_scale=2)
    _legs(b,.88,.32,.745,.045,spread=.10)
    b.box('wood',(0,.69,0),(1.9,.12,.66),.02)
    b.add('bronze',lathe([(0,.09),(.03,.11),(.21,.10),(.28,.055),(.32,.05)],24),(-.2,.825,0))
    for k in range(5):
        a=k*1.7;b.rod('wood',(-.2,.98,0),(-.2+math.cos(a)*.23,1.44+.04*k,math.sin(a)*.19),.005,6)
    b.add('glass',lathe([(0,.065),(.23,.06),(.25,.045)],20),(.1,.825,.04))
    return b.build('Mesa de comedor de roble con jarrones')


def _armchair():
    b=_builder();_legs(b,.38,.35,.41,.035,spread=.10)
    b.box('jute',(0,.41,0),(.85,.095,.85),.08,uv_scale=7)
    b.box('jute',(0,.76,-.30),(.85,.70,.09),.05,uv_scale=7)
    for x in (-.46,.46):
        b.rod('wood',(x,.26,-.4),(x,1.03,-.35),.035)
        b.rod('wood',(x,.48,.38),(x,.73,.38),.032)
        b.rod('wood',(x,.73,.43),(x,.79,-.45),.045)
    b.box('ivory',(0,.73,-.17),(.63,.49,.17),.095,uv_scale=4)
    # Visible tensioned cords across the seat and back, with restrained counts.
    for i in range(12):
        x=-.38+i*.069
        b.rod('rattan',(x,.45,-.35),(x,.45,.35),.007,6)
        b.rod('rattan',(x,.48,-.35),(x,1.02,-.35),.007,6)
    return b.build('Butaca de madera y cuerda')


def _pouf():
    b=_builder();b.add('jute',lathe([(0,.26),(.025,.36),(.11,.43),(.27,.44),(.38,.37),(.43,.22),(.44,.02)],40))
    # Raised concentric knitted rings make the silhouette and light tactile.
    for j in range(6):
        y=.08+j*.053;r=.42-.025*abs(j-2)
        for i in range(24):
            a=math.tau*i/24;b.sphere('jute',(math.cos(a)*r,y,math.sin(a)*r),(.075,.032,.075),segments=8,rings=4)
    return b.build('Puf redondo de yute tejido')


def _plant(height=1.85):
    b=_builder();b.add('rattan',lathe([(0,.16),(.025,.22),(.35,.27),(.39,.28)],28));b.cylinder('soil',(0,.365,0),.245,.018,24)
    rng=random.Random(43)
    for stem in range(3):
        sx=(stem-1)*.065;top=height-stem*.13;b.rod('wood',(sx,.32,0),(sx+.025,top,0),.013,8)
        for j in range(7):
            y=.60+j*(top-.65)/7;angle=j*2.38+stem*1.2;reach=.22+.08*rng.random()
            end=(sx+math.cos(angle)*reach,y+.13,math.sin(angle)*reach)
            b.rod('wood',(sx,y,0),end,.006,6)
            tilt=.35+rng.random()*.5
            rotation=multiply(quaternion_y(-angle),(0.,0.,math.sin(tilt/2),math.cos(tilt/2)))
            b.sphere('leaf' if j%2 else 'leaf-light',(end[0]*1.15,end[1]+.035,end[2]*1.15),(.37,.035,.17),rotation,segments=10,rings=5)
    return b.build('Ficus de hojas anchas en maceta')


def _pendant():
    b=_builder();b.cylinder('black',(0,2.98,0),.075,.045,20);b.rod('black',(0,2.96,0),(0,2.23,0),.009,8)
    # Open underside: no solid cap. Slats make the rattan shade dimensional.
    profile=[(1.80,.38),(1.83,.39),(2.04,.34),(2.20,.24),(2.29,.09)]
    b.add('rattan',lathe(profile,36,caps=False))
    for i in range(28):
        a=i/28*math.tau
        for (y,r),(ny,nr) in zip(profile,profile[1:]):b.rod('wood',(math.cos(a)*r,y,math.sin(a)*r),(math.cos(a)*nr,ny,math.sin(a)*nr),.006,5)
    b.sphere('bulb',(0,1.97,0),(.07,.10,.07),segments=12,rings=6)
    return b.build('Lámpara colgante de ratán')


def _bed():
    b=_builder();b.box('wood',(0,.23,0),(1.9,.34,2.18),.04)
    b.box('wood',(0,.76,-1.06),(2.18,1.35,.12),.03,uv_scale=2)
    b.box('ivory',(0,.49,0),(1.87,.25,2.1),.12,uv_scale=3)
    b.box('ivory',(0,.64,.24),(1.90,.10,1.5),.05,uv_scale=4)
    for x in (-.47,.47):b.box('ivory',(x,.72,-.66),(.84,.19,.49),.10,uv_scale=4)
    for x in (-.77,.77):
        for z in (-.9,.9):b.cylinder('wood',(x,.065,z),.04,.13,10)
    return b.build('Cama de roble y ropa de lino')


def _kitchen():
    b=_builder()
    # Left-wall run at rear; peninsula extends toward camera, like the references.
    b.box('white',(0,.45,-1.45),(1.0,.9,2.5),.015)
    b.box('stone',(0,.93,-1.45),(1.10,.07,2.60),.025,uv_scale=3)
    b.box('stone',(-.45,1.28,-1.45),(.035,.62,2.5),.008,uv_scale=3)
    for z in (-2.25,-1.45,-.65):
        b.box('plaster',(-.13,2.18,z),(.76,1.05,.77),.008,uv_scale=2)
        b.box('black',(.266,2.18,z+.37),(.009,.99,.006),.002)
        b.box('white',(.51,.47,z),(.018,.81,.77),.006)
    # Counter/bar is a true 3D solid, with the free-side overhang and panel seams.
    b.box('white',(.9,.45,.35),(2.65,.90,.81),.016)
    b.box('stone',(.95,.94,.35),(2.92,.09,1.03),.035,uv_scale=2)
    for x in (-.15,.55,1.25,1.95):b.box('plaster',(x,.46,.764),(.008,.79,.009),.002)
    b.cylinder('black',(1.26,1.01,.28),.19,.05,28)
    for x,z in ((1.20,.27),(1.31,.24),(1.35,.34)):
        b.sphere('rust',(x,1.08,z),(.09,.09,.09),segments=10,rings=5)
    b.box('wood',(.2,1.12,-2.1),(.03,.34,.22),.025)
    b.add('bronze',lathe([(0,.09),(.17,.10),(.20,.07)],20),(.16,.98,-1.75))
    return b.build('Cocina y barra de piedra clara')


def _stool():
    b=_builder();_legs(b,.17,.17,.63,.025,spread=.08)
    b.box('wood',(0,.67,0),(.48,.09,.39),.11,uv_scale=3)
    for x in (-.2,.2):b.rod('wood',(x,.24,-.2),(x,.24,.2),.016)
    b.rod('wood',(-.2,.23,.2),(.2,.23,.2),.016)
    return b.build('Taburete de roble')


def _room():
    b=_builder();b.box('floor',(-.35,-.075,.4),(9.0,.15,8.0),.012,uv_scale=.65)
    # Back wall has a real doorway, open to the separately modelled bedroom.
    b.box('plaster',(-2.59,1.55,-3.55),(4.52,3.1,.16),.01,uv_scale=1.7)
    b.box('plaster',(2.62,1.55,-3.55),(3.07,3.1,.16),.01,uv_scale=1.7)
    b.box('plaster',(.48,2.88,-3.55),(1.65,.44,.16),.01,uv_scale=1.7)
    for x in (-.36,1.32):b.box('white',(x,1.33,-3.43),(.10,2.66,.12),.01)
    b.box('white',(.48,2.66,-3.43),(1.78,.10,.12),.01)
    b.box('white',(-2.6,.075,-3.43),(4.3,.15,.035),.005)
    b.box('white',(2.7,.075,-3.43),(2.8,.15,.035),.005)
    # Right side is mostly open glazing; light can enter through actual openings.
    b.box('plaster',(4.13,.38,.25),(.14,.76,7.6),.01,uv_scale=1.7)
    b.box('plaster',(4.13,3.05,.25),(.14,.22,7.6),.01,uv_scale=1.7)
    for z in (-3.45,-1.6,.25,2.10,3.95):
        b.box('white',(4.04,1.9,z),(.14,2.3,.09),.01)
    for y in (.84,2.23,2.94):b.box('white',(4.035,y,.25),(.17,.075,7.48),.01)
    b.box('stone',(3.97,.79,.25),(.42,.075,7.7),.02,uv_scale=2)
    for z in (-2.53,-.68,1.18,3.02):
        b.box('glass',(4.10,1.9,z),(.018,2.04,1.74),.003)
    # One inward-open casement conveys the photographed windows without a wall.
    for y in (.88,2.94):b.box('white',(3.62,y,-2.95),(.075,.065,1.45),.008,angle=-.58)
    for z,x in ((-3.55,4.0),(-2.35,3.23)):b.box('white',(x,1.91,z),(.07,2.08,.07),.008)
    # Left side is a section, intentionally open toward the primary camera.
    b.box('plaster',(-4.84,1.55,-1.95),(.15,3.1,3.2),.01,uv_scale=1.7)
    b.box('white',(-4.73,.075,-1.95),(.035,.15,3.2),.005)
    # Bedroom alcove, visible through the doorway, never treated as observed depth.
    b.box('floor',(.48,-.07,-5.05),(3.4,.14,3.0),.01,uv_scale=.65)
    b.box('plaster',(.48,1.5,-6.5),(3.5,3.,.14),.01,uv_scale=1.7)
    for x in (-1.25,2.2):b.box('plaster',(x,1.5,-5.05),(.12,3.,3.),.01,uv_scale=1.7)
    # Small framed artwork on the back wall; not a copied photograph.
    b.box('wood',(-1.55,1.95,-3.425),(.77,1.12,.035),.008)
    b.box('paper',(-1.55,1.95,-3.40),(.70,1.05,.012),.003)
    b.box('plaster',(-1.55,2.03,-3.39),(.43,.57,.008),.002)
    b.box('black',(-1.67,1.80,-3.38),(.22,.29,.006),.002)
    # Limited sill styling (real meshes), leaving the glass and daylight readable.
    for i in range(3):b.box('paper',(3.76,.86+i*.035,.68),(.28,.032,.48),.005,angle=.05*i)
    b.add('glass',lathe([(0,.085),(.10,.13),(.34,.10),(.40,.06)],24),(3.78,.835,1.45))
    return b.build('Arquitectura seccionada con ventanales y dormitorio')


@lru_cache(maxsize=1)
def _assets():
    builders={'room':_room,'kitchen':_kitchen,'sofa':_sofa,'coffee-table':_coffee,'dining-table':_dining,
              'dining-chair':_chair,'armchair':_armchair,'pouf':_pouf,'ficus':_plant,'pendant':_pendant,'bed':_bed,'stool':_stool}
    assets={key:fn() for key,fn in builders.items()}
    rug=_builder();rug.box('jute',(0,.018,0),(4.8,.036,3.7),.014,uv_scale=3)
    for i in range(72):
        x=-2.36+i*(4.72/71)
        for sign in (-1,1):rug.rod('jute',(x,.018,sign*1.82),(x+.012,.012,sign*1.91),.007,5)
    assets['rug']=rug.build('Alfombra de yute tejido')
    side=_builder();side.cylinder('stone',(0,.25,0),.30,.50,32);side.add('rattan',lathe([(0,.08),(.11,.10),(.15,.075)],20),(0,.5,0));assets['side-table']=side.build('Mesa auxiliar de piedra')
    return assets


def scene_document(scene_id, title, reference_set_id):
    """Return a raw manifest, {asset_id: GLB bytes}, and renderer suggestions.

    Coordinate choices are authored estimates in source-relative units. The
    separate reference_set_id ties the interpretation to private evidence;
    source_frame_ids stays empty because these are not reconstructed capture GLBs.
    """
    scene_id=str(UUID(str(scene_id)));reference_set_id=str(UUID(str(reference_set_id)))
    if not isinstance(title,str) or not title.strip() or len(title)>180:raise ValueError('Invalid scene title')
    assets=dict(_assets());objects=[]
    def put(id,label,asset,position,angle=0,editable=True):
        objects.append({'id':id,'label':label,'asset_id':asset,'editable':editable,'role':'object' if editable else 'environment',
                        'transform':{'position':[float(v) for v in position],'rotation_xyzw':list(quaternion_y(angle)),'scale':[1.,1.,1.]},
                        'physics':{'body_type':'static','collider':'none','collider_provenance':'not_set','mass_kg':None,'mass_provenance':'unknown'}})
    put('room','Arquitectura · interpretación manual','room',(0,0,0),editable=False)
    put('kitchen','Cocina y barra','kitchen',(-4.26,0,.7),editable=False)
    put('sofa','Sofá de lino beige','sofa',(3.0,0,.23),-math.pi/2)
    put('coffee-table','Mesa de centro negra','coffee-table',(1.24,0,.67))
    put('dining-table','Mesa de comedor de roble','dining-table',(-2.05,0,-1.38))
    for i,(x,z,a) in enumerate([(-2.75,-.50,math.pi),(-1.40,-.50,math.pi),(-2.75,-2.25,0),(-1.40,-2.25,0),(-3.48,-1.38,math.pi/2),(-.62,-1.38,-math.pi/2)],1):
        put(f'chair-{i}',f'Silla de comedor {i}','dining-chair',(x,0,z),a)
    put('armchair','Butaca de madera y cuerda','armchair',(2.0,0,3.1),math.pi*1.15)
    put('pouf','Puf de yute','pouf',(1.02,0,2.65))
    put('plant-door','Ficus junto al dormitorio','ficus',(1.65,0,-2.88))
    put('plant-window','Ficus junto al ventanal','ficus',(3.55,0,2.88),.7)
    put('pendant-dining','Colgante de ratán · comedor','pendant',(-2.05,0,-1.38),editable=False)
    put('pendant-bedroom','Colgante de ratán · dormitorio','pendant',(.48,0,-5.0),editable=False)
    put('rug','Alfombra de fibras naturales','rug',(1.12,0,1.13))
    put('bed','Cama de roble','bed',(.48,0,-5.25))
    put('side-table','Mesa auxiliar de piedra','side-table',(3.05,0,2.48))
    put('stool-1','Taburete de barra 1','stool',(-3.75,0,2.27))
    put('stool-2','Taburete de barra 2','stool',(-2.62,0,2.27))
    note='Modelo 3D creado manualmente con geometría y texturas procedurales; interpretación visual de referencias, sin reconstrucción automática ni dimensiones verificadas.'
    document={'schema_version':'0.1.0','scene_id':scene_id,'capture_id':None,'reference_set_id':reference_set_id,
              'origin':'reference_interpretation','title':title.strip(),'status':'preview_unverified','coordinate_system':'right_handed_y_up',
              'units':'source_relative','metric_verification':None,'source_frame_ids':[],
              'assets':[{'id':key,'kind':'mesh','relative_path':f'assets/{key}.glb','sha256':hashlib.sha256(raw).hexdigest(),'provenance':'generated','source_frame_ids':[],'note':note} for key,raw in assets.items()],
              'objects':objects,'limitations':[
                  'Interpretación manual de las vistas de referencia; no es una reconstrucción geométrica obtenida por IA.',
                  'Distribución basada principalmente en las vistas 3 y 5; orientación y coherencia entre vistas no verificadas.',
                  'Unidades relativas: tamaño, perspectiva, cámaras, profundidad y áreas ocultas son estimaciones del autor.',
                  'Superficies y materiales procedurales: no son texturas fotográficas ni una medición de materiales reales.',
                  'Masa, fricción y colisiones no medidas; los objetos no tienen física verificada.']}
    config={'version':VERSION,'background':'#e8e3da','exposure':.92,
            'camera_presets':[
                {'id':'living','label':'Salón','position':[.35,1.83,5.7],'target':[.55,1.14,-.75],'fov':53},
                {'id':'dining','label':'Comedor','position':[-.65,1.68,3.9],'target':[-1.55,1.05,-1.65],'fov':55},
                {'id':'bedroom','label':'Dormitorio','position':[.45,1.55,-2.35],'target':[.45,.85,-5.4],'fov':57},
                {'id':'overview','label':'Vista general','position':[-8.4,7.9,10.4],'target':[0,.7,-.6],'fov':48}],
            'sun':{'position':[7.,5.7,1.5],'target':[-2.,0.,-1.5],'intensity':3.2,'color':'#fff1d6'},
            'environmentBoxes':[
                {'id':'floor','position':[-.35,-.075,.4],'halfExtents':[4.5,.075,4.]},
                {'id':'back-left','position':[-2.59,1.55,-3.55],'halfExtents':[2.26,1.55,.08]},
                {'id':'back-right','position':[2.62,1.55,-3.55],'halfExtents':[1.535,1.55,.08]},
                {'id':'right-base','position':[4.13,.38,.25],'halfExtents':[.07,.38,3.8]}],
            'layout':{'source':'manual_interpretation','anchors':['Vista 3','Vista 5'],'window_wall':'positive_x',
                      'bedroom_direction':'negative_z','kitchen_direction':'negative_x',
                      'metric_scale_verified':False,'camera_calibration':'not_estimated','model_executed':False}}
    return document,assets,config
