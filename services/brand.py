"""Canonical local Brivany typography for apps and portable media projects."""
from pathlib import Path
import shutil

FONT_FAMILY='Brivany Editorial'
FONT_ROOT=Path(__file__).resolve().parents[1]/'web/fonts'
FONT_FACES=(('Light',300),('Regular',400),('Medium',500))

def font_css(prefix='/fonts/',*,family=FONT_FAMILY,display='swap'):
    return ''.join('@font-face{font-family:"'+family+'";src:url("'+prefix+'BrivanyEditorial-'+style+'.woff2") format("woff2");font-style:normal;font-weight:'+('500 900' if weight==500 else str(weight))+';font-display:'+display+'}' for style,weight in FONT_FACES)

def copy_fonts(target):
    target=Path(target);target.mkdir(parents=True,exist_ok=True)
    for name in [*('BrivanyEditorial-'+style+'.woff2' for style,_ in FONT_FACES),'LICENSE-AND-ATTRIBUTION.txt']:
        shutil.copyfile(FONT_ROOT/name,target/name)

def pil_font(size,weight=400):
    from PIL import ImageFont
    style='Light' if weight<400 else 'Medium' if weight>=500 else 'Regular'
    return ImageFont.truetype(str(FONT_ROOT/('BrivanyEditorial-'+style+'.ttf')),size)
