"""Isolated Vetsa content inside Brivany; never expose the computer bridge."""
from urllib.parse import urlsplit


def open_account_window(url,title,on_close=None):
    parsed=urlsplit(url)
    if (parsed.scheme!='https' or parsed.netloc!='cognira.vetsa.es'
            or parsed.path not in {'/auth','/account'}):
        raise ValueError('Servicio de identidad no permitido.')
    import webview
    view=webview.create_window(title,url,js_api=None,width=580,height=780,
        min_size=(420,560),text_select=True,confirm_close=False)
    if on_close:
        def closed():on_close()
        view.events.closed+=closed
    return view
