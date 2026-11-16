"""Rebuild Brivany's supplied fonts without executing anything in the ZIP.

Development only: fonttools + brotli. Runtime uses the prepared local assets.
"""
from io import BytesIO
from pathlib import Path
import hashlib
import json
import zipfile

ROOT=Path(__file__).resolve().parents[1]

def main():
    from fontTools.ttLib import TTFont
    from fontTools.pens.svgPathPen import SVGPathPen
    target=ROOT/'web/fonts';target.mkdir(exist_ok=True)
    manifest={'family':'Brivany Editorial','source':'Brivany_Editorial_Fuentes.zip','license':'OFL-1.1','weights':[]}
    with zipfile.ZipFile(ROOT/manifest['source']) as archive:
        for style,weight in [('Light',300),('Regular',400),('Medium',500)]:
            name='BrivanyEditorial-'+style
            raw=archive.read(name+'.ttf');font=TTFont(BytesIO(raw),recalcTimestamp=False)
            assert font['name'].getDebugName(1)==manifest['family'] and font['OS/2'].usWeightClass==weight
            cmap=font.getBestCmap();assert all(ord(c) in cmap for c in 'ÁÉÍÓÚáéíóúÑñÜü¿¡')
            (target/(name+'.ttf')).write_bytes(raw)
            font.flavor='woff2';font.save(target/(name+'.woff2'))
            compact=TTFont(target/(name+'.woff2'));assert compact.getBestCmap()==cmap
            assert compact['hmtx'].metrics==font['hmtx'].metrics
            manifest['weights'].append({'style':style,'weight':weight,'glyphs':len(cmap),'ttf_bytes':len(raw),'woff2_bytes':(target/(name+'.woff2')).stat().st_size,'ttf_sha256':hashlib.sha256(raw).hexdigest(),'woff2_sha256':hashlib.sha256((target/(name+'.woff2')).read_bytes()).hexdigest()})
        for name in ['LICENSE-AND-ATTRIBUTION.txt','README.txt']:(target/name).write_bytes(archive.read(name))
    (target/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    # SVG <img> does not inherit the surrounding page's fonts. Freeze the actual
    # supplied Medium outlines so wordmarks stay identical offline and in video.
    font=TTFont(target/'BrivanyEditorial-Medium.ttf');glyphs=font.getGlyphSet();cmap=font.getBestCmap();x=0;paths=[]
    for char in 'brivany.':
        glyph=glyphs[cmap[ord(char)]];pen=SVGPathPen(glyphs);glyph.draw(pen)
        color=' fill="#0071e3"' if char=='.' else ''
        paths.append(f'<path d="{pen.getCommands()}" transform="translate({x} 0)"{color}/>')
        x+=glyph.width-50
    scale=48/font['head'].unitsPerEm;width=round(x*scale+4,2)
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} 62" role="img" aria-label="brivany."><g fill="#1d1d1f" transform="translate(2 46) scale({scale} {-scale})">'+''.join(paths)+'</g></svg>\n'
    (ROOT/'web/brand-wordmark.svg').write_text(svg,encoding='utf-8');(ROOT/'services/motion/assets/wordmark.svg').write_text(svg,encoding='utf-8')
    print(json.dumps(manifest,ensure_ascii=False))

if __name__=='__main__':main()
