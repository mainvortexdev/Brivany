"""Offline, seek-safe two-speaker neon visualization, driven by measured PCM."""
from html import escape
import json
import math
from pathlib import Path
from statistics import median


def measure_layout(frames):
    from PIL import Image
    pairs=[]
    for frame in frames[:6]:
        with Image.open(frame['path']) as source:
            image=source.convert('RGB');image.thumbnail((360,640));w,h=image.size;pixels=image.load()
            found=[]
            for side in range(2):
                points=[(x,y) for y in range(round(h*.18),round(h*.5)) for x in range(side*w//2,(side+1)*w//2)
                        if max(pixels[x,y])>55 and (pixels[x,y][0]>pixels[x,y][2]*1.08 if side==0 else pixels[x,y][2]>pixels[x,y][0]*1.15) and max(pixels[x,y])-min(pixels[x,y])>18]
                if len(points)<60:break
                xs,ys=zip(*points);width=max(xs)-min(xs);height=max(ys)-min(ys)
                if not .8<width/max(1,height)<1.2:break
                found.append({'x':(min(xs)+max(xs))/2/w,'y':(min(ys)+max(ys))/2/h,'diameter':(width+height)/2/w})
            if len(found)==2:pairs.append(found)
    if not pairs:return None
    return {'centers':[median(p[i]['x'] for p in pairs) for i in range(2)],'center_y':median(p[i]['y'] for p in pairs for i in range(2)),
            'diameter':median(p[i]['diameter'] for p in pairs for i in range(2)),'method':'sampled_colored_limb_bounds','samples':len(pairs)}


def pcm_energy(path,step=.1):
    import wave
    from array import array
    with wave.open(str(path),'rb') as source:
        if source.getsampwidth()!=2 or source.getnchannels()!=1:raise ValueError('La actividad de voz necesita PCM16 mono.')
        count=max(1,round(source.getframerate()*step));values=[]
        while raw:=source.readframes(count):
            data=array('h',raw);values.append(min(1,(math.sqrt(sum(n*n for n in data)/len(data))/32768)*5))
    return {'step':step,'values':[round(v,4) for v in values]}


def fit_timing(plan,segments):
    """Keep the requested duration, placing real speech with short equal gaps."""
    if plan.get('timing')=='reference':
        clock=0;by_scene={s['scene_id']:s for s in segments}
        for scene in plan['scenes']:
            if scene['narration'].strip():
                segment=by_scene.get(scene['id'])
                if not segment or abs(segment['duration']-scene['speech_duration'])>1/24000+1e-6:
                    raise ValueError('El audio debe ajustarse completo al turno medido antes del montaje.')
                segment['start']=round(clock+scene.get('speech_offset',0),9)
            clock+=scene['duration']
        return None
    voiced=[s for s in plan['scenes'] if s['narration'].strip()]
    if not segments or len(segments)!=len(voiced):raise ValueError('Cada turno necesita una voz completa.')
    silence=sum(s['duration'] for s in plan['scenes'] if not s['narration'].strip())
    gap=(plan['duration']-plan['credits_duration']-silence-sum(s['duration'] for s in segments))/len(segments)
    if not .16<=gap<=(.65 if plan.get('timing')=='dialogue' else 1.2):raise ValueError('La duración solicitada necesita ajustar el contenido: no se estiran voces ni se rellenan turnos con pausas largas.')
    clock=0
    source=iter(segments)
    for scene in plan['scenes']:
        if not scene['narration'].strip():clock+=scene['duration'];continue
        segment=next(source)
        scene['duration']=round(segment['duration']+gap,6)
        if plan.get('timing')=='dialogue':scene.update(speech_duration=segment['duration'],speech_offset=.08)
        if scene['duration']>30:raise ValueError('Divide los turnos de más de treinta segundos.')
        segment['start']=round(clock+.08,6);clock+=scene['duration']
    plan['scenes'][-1]['duration']+=plan['duration']-plan['credits_duration']-clock
    return gap


def _filaments(color):
    paths=[]
    for layer in range(12):
        points=[]
        for n in range(129):
            angle=n/128*math.tau
            radius=168+(layer-5.5)*.65+1.7*math.sin(angle*7+layer*.71)+1.3*math.cos(angle*13-layer*.45)
            points.append(f'{210+radius*math.cos(angle):.3f} {210+radius*math.sin(angle):.3f}')
        paths.append('<path d="M '+' L '.join(points)+' Z" fill="none" stroke="'+color+'" stroke-width=".55" opacity=".18"/>')
    return ''.join(paths)


def _spark():
    # Small reflected highlights, not a copied logo or a text glyph.
    return ''.join(f'<circle cx="{210+math.sin(i*2.4)*math.sqrt(i)*1.6:.3f}" cy="{126+math.cos(i*1.7)*math.sqrt(i)*1.4:.3f}" r="{.5+(i%4)*.35:g}" fill="#fff" opacity="{.16+(i%5)*.12:g}"/>' for i in range(30))


def _activity_at(at,role,segments):
    """A short symmetric envelope keeps the highlight continuous at turn cuts."""
    value=0
    for segment in segments:
        if segment.get('speaker')!=role:continue
        local=at-segment['start'];duration=segment['duration']
        if not -.18<=local<=duration+.18:continue
        energy=segment.get('energy',{});step=energy.get('step',.1);values=energy.get('values',[])
        if not values:continue
        sample=max(0,min(len(values)-1,local/step));index=int(sample)
        rms=values[index]*(1-(sample-index))+values[min(index+1,len(values)-1)]*(sample-index)
        envelope=max(0,min(1,(local+.18)/.22,(duration+.18-local)/.22))
        value=max(value,(.25+.75*rms)*envelope)
    return value


def _orb_pose(at,role,segments):
    # Integrate spoken time rather than restarting rotation on each scene.
    def ramp(value):return 0 if value<=0 else value*value/.36 if value<.18 else value-.09
    spoken=sum(ramp(at-s['start'])-ramp(at-s['start']-s['duration']) for s in segments if s.get('speaker')==role)
    phase=at*.48+spoken*.42+(0 if role=='melodi' else 1.4)
    energy=_activity_at(at,role,segments)
    tilt=math.sin(phase*.82)*.44+.12
    roll=math.sin(phase*.61)*27
    a=math.radians(roll);ca,sa=math.cos(a),math.sin(a)
    def path(front):
        points=[]
        for i in range(37):
            theta=(i/36*math.pi)+(0 if front else math.pi)
            x=168*math.cos(theta);y=168*math.sin(theta)*tilt
            # Low amplitude ripples follow actual PCM, not an unrelated music beat.
            y+=energy*1.9*math.sin(theta*9+phase*3)
            points.append((210+x*ca-y*sa,210+x*sa+y*ca))
        return 'M '+' L '.join(f'{x:.3f} {y:.3f}' for x,y in points)
    return path(True),path(False),energy,phase


def scene_visuals(identifier,plan,scene,width,height,activity=None,layout=None,*,credits=False,timeline_start=0,voice_activity=None):
    layout=layout or {};centers=layout.get('centers',[.26,.74]);cy=layout.get('center_y',.38)
    diameter=layout.get('diameter',.34)*width
    if not isinstance(centers,list) or len(centers)!=2 or not all(.12<=x<=.88 for x in centers) or not .2<=cy<=.5 or not .2*width<=diameter<=.4*width:
        centers=[.26,.74];cy=.38;diameter=.34*width
    box=diameter*420/336;top=cy*height-box/2;labels={p['id']:p['name'] for p in plan['participants']};markup=[];animations=[]
    segments=list(voice_activity or ([{**activity,'start':timeline_start+scene.get('speech_offset',.08),'speaker':scene.get('speaker')}] if activity else []))
    duration=scene.get('duration',plan['credits_duration'])
    for i,role in enumerate(['melodi','counterpart']):
        prefix=identifier+'-'+role;color='#fa5ec2' if i==0 else '#5996ff';active=not credits and scene.get('speaker')==role
        front,back,energy,phase=_orb_pose(timeline_start,role,segments)
        left=centers[i]*width-box/2
        svg=f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 420" aria-hidden="true"><defs>
<radialGradient id="{prefix}-body"><stop offset="0" stop-color="{color}" stop-opacity=".025"/><stop offset=".78" stop-color="{color}" stop-opacity=".025"/><stop offset=".97" stop-color="{color}" stop-opacity=".2"/><stop offset="1" stop-color="{color}" stop-opacity=".6"/></radialGradient>
<radialGradient id="{prefix}-halo"><stop offset=".76" stop-color="{color}" stop-opacity="0"/><stop offset=".81" stop-color="{color}" stop-opacity=".22"/><stop offset="1" stop-color="{color}" stop-opacity="0"/></radialGradient>
<filter id="{prefix}-blur" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="6"/></filter>
<filter id="{prefix}-band-blur" x="-30%" y="-40%" width="160%" height="180%"><feGaussianBlur stdDeviation="2.8"/></filter>
<clipPath id="{prefix}-clip"><circle cx="210" cy="210" r="168"/></clipPath></defs>
<g id="{prefix}-glow" opacity="{.14+energy*.7:.4f}"><circle cx="210" cy="210" r="207" fill="url(#{prefix}-halo)"/><circle cx="210" cy="210" r="168" fill="none" stroke="{color}" stroke-width="3" filter="url(#{prefix}-blur)"/></g>
<circle cx="210" cy="210" r="168" fill="url(#{prefix}-body)" stroke="{color}" stroke-opacity=".2" stroke-width="1"/>
<g id="{prefix}-filaments" data-layout-allow-overflow transform="rotate({phase*57.2957795:.5f} 210 210)" opacity="{.35+energy*.65:.4f}">{_filaments(color)}</g>
<g clip-path="url(#{prefix}-clip)"><path id="{prefix}-back" d="{back}" fill="none" stroke="{color}" stroke-width="1.2" opacity=".14"/><path id="{prefix}-wave-glow" d="{front}" fill="none" stroke="{color}" stroke-width="11" opacity=".3" filter="url(#{prefix}-band-blur)"/><path id="{prefix}-wave" d="{front}" fill="none" stroke="{color}" stroke-width="3" opacity=".25"/></g>
<g id="{prefix}-spark" transform="rotate({math.sin(phase)*28:.4f} 210 126)" opacity=".6">{_spark()}</g></svg>'''
        label_top=cy*height+diameter/2+height*.02
        markup.append(f'<div style="position:absolute;left:{left:g}px;top:{top:g}px;width:{box:g}px;height:{box:g}px">{svg}</div><p style="position:absolute;left:{(centers[i]-.2)*100:g}%;top:{label_top:g}px;width:40%;margin:0;text-align:center;color:{"#eceaef" if active else "#777780"};font-size:{width*.041:g}px;line-height:1.2;font-weight:600">{escape(labels[role])}</p>')
        # GSAP reads SVG matrices modulo 360. Seed the unwrapped rotation so a
        # scene beginning after a full revolution does not spin through it again.
        animations.append('tl.set('+json.dumps('#'+prefix+'-filaments')+',{rotation:'+str(round(phase*57.2957795,5))+',svgOrigin:"210 210"},0);')
        animations.append('tl.set('+json.dumps('#'+prefix+'-spark')+',{rotation:'+str(round(math.sin(phase)*28,4))+',svgOrigin:"210 126"},0);')
        for n in range(math.ceil(duration/.1)):
            at=n*.1;end=min(duration,at+.1);front,back,energy,phase=_orb_pose(timeline_start+end,role,segments)
            selector='#'+prefix;length=round(end-at,9)
            animations.append('tl.to('+json.dumps(selector+'-wave, '+selector+'-wave-glow')+',{attr:{d:'+json.dumps(front)+'},duration:'+str(length)+',ease:"none"},'+str(round(at,9))+');')
            animations.append('tl.to('+json.dumps(selector+'-back')+',{attr:{d:'+json.dumps(back)+'},duration:'+str(length)+',ease:"none"},'+str(round(at,9))+');')
            animations.append('tl.to('+json.dumps(selector+'-glow')+',{opacity:'+str(round(.14+energy*.7,4))+',duration:'+str(length)+',ease:"none"},'+str(round(at,9))+');')
            animations.append('tl.to('+json.dumps(selector+'-spark')+',{rotation:'+str(round(math.sin(phase)*28,4))+',svgOrigin:"210 126",duration:'+str(length)+',ease:"none"},'+str(round(at,9))+');')
            animations.append('tl.to('+json.dumps(selector+'-filaments')+',{rotation:'+str(round(phase*57.2957795,5))+',svgOrigin:"210 210",opacity:'+str(round(.35+energy*.65,4))+',duration:'+str(length)+',ease:"none"},'+str(round(at,9))+');')
    if plan.get('disclosure')=='demonstration':
        markup.append(f'<p style="position:absolute;bottom:6%;left:10%;width:80%;text-align:center;color:#85818c;font-size:{max(28,width*.026):g}px;letter-spacing:.12em">Demostración</p>')
    return ''.join(markup),''.join(animations)
