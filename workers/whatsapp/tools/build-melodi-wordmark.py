"""Generate the document wordmark from font glyphs, without a personal signature."""
from pathlib import Path
from io import BytesIO
import base64,json
from PIL import Image,ImageDraw,ImageFont

root=Path(__file__).resolve().parents[1]
font_dir=Path('C:/Windows/Fonts')
name_font=ImageFont.truetype(str(font_dir/'segoeuib.ttf'),120)
brand_font=ImageFont.truetype(str(font_dir/'segoeui.ttf'),38)
canvas=Image.new('RGBA',(900,260),(255,255,255,0));draw=ImageDraw.Draw(canvas)
draw.text((16,8),'Melodi',font=name_font,fill='#1d1d1f')
draw.text((24,164),'BRIVANY',font=brand_font,fill='#63776f')
png=BytesIO();canvas.save(png,format='PNG',optimize=True)
white=Image.new('RGB',canvas.size,'white');white.paste(canvas,mask=canvas.getchannel('A'))
jpeg=BytesIO();white.save(jpeg,format='JPEG',quality=94,optimize=True)
asset={'width':canvas.width,'height':canvas.height,'pngBase64':base64.b64encode(png.getvalue()).decode(),'jpegBase64':base64.b64encode(jpeg.getvalue()).decode()}
(root/'melodi-signature-asset.js').write_text('// Brivany document wordmark; generated with tools/build-melodi-wordmark.py.\nexport const MELODI_SIGNATURE_IMAGE = Object.freeze('+json.dumps(asset,separators=(',',':'))+');\n',encoding='utf-8')
preview=root.parents[1]/'.local/whatsapp-migration/melodi-wordmark.png';preview.parent.mkdir(parents=True,exist_ok=True);canvas.save(preview)
print('Generated Melodi / Brivany document wordmark.')
