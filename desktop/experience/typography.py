"""Per-process GDI+ font collections; no system-wide font installation."""
import threading
from services.brand import FONT_ROOT

_collections={}
_lock=threading.Lock()

def brand_font(size,weight=400):
    import clr
    clr.AddReference('System.Drawing')
    from System.Drawing import Font,FontStyle
    from System.Drawing.Text import PrivateFontCollection
    style='Light' if weight<400 else 'Medium' if weight>=500 else 'Regular'
    with _lock:
        if style not in _collections:
            collection=PrivateFontCollection()
            collection.AddFontFile(str(FONT_ROOT/('BrivanyEditorial-'+style+'.ttf')))
            _collections[style]=collection
        return Font(_collections[style].Families[0],size,FontStyle.Regular)
