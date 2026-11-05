"""Freeze verified local evidence and create the requested Spanish audit PDF.

Does not execute test suites, inspect secrets or collect private user content.
Report inputs are development reports and authored synthetic screenshots only.
"""
from datetime import datetime,timezone,timedelta
import hashlib
import json
from pathlib import Path
import re
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle,PageBreak,Image,KeepTogether

ROOT=Path(__file__).resolve().parents[1]
OUTPUT=ROOT/'Brivany_Auditoria_Casos_de_Uso_2026-10-29.pdf'
DIRECTORY=ROOT/'tmp/audit20261029'
SUITES=['python','spatial-ui','floorplan-ui','portable-floorplan','desktop-ui','portable-presentation',
    'sous-pipeline','sous-catalog','sous-voice-pipeline','live-ui','human-skills-ui','chat-requests-ui','social-ui',
    'dubbing-timing','spatial-physics','room-dispatch','additional-usecases','app-ui','spatial-assistant-ui']
TITLES={'python':'Suite Python general','spatial-ui':'Captura y edición espacial','floorplan-ui':'Plano 2D',
    'portable-floorplan':'Plano portátil','desktop-ui':'Proyecto de escritorio','portable-presentation':'Recorrido portátil',
    'sous-pipeline':'Inventario y cocina','sous-catalog':'Recetas y compras','sous-voice-pipeline':'Voz de Sous',
    'live-ui':'Voz y reunión silenciosa','human-skills-ui':'Skill desde video','chat-requests-ui':'Solicitudes del chat',
    'social-ui':'Redes y campañas pausadas','dubbing-timing':'Doblaje y medición','spatial-physics':'Física sintética',
    'room-dispatch':'Orquestación multivista','additional-usecases':'Usos adicionales','app-ui':'Interfaz y shell PWA',
    'spatial-assistant-ui':'Melodi en el espacio'}

FINDINGS=[
 {'id':'F01','kind':'Funcional / portabilidad','priority':'Alta','state':'Corregido y comprobado',
  'problem':'Los recorridos de presentación no se incluían en la carpeta portátil ni en el respaldo.',
  'fix':'Se conservaron configuración y revisión de escena en las versiones de proyecto; se añadieron lectura, guardado y validación del respaldo.',
  'proof':['desktop','portable-presentation','additional-usecases']},
 {'id':'F02','kind':'Funcional / integración','priority':'Alta','state':'Corregido y comprobado',
  'problem':'Los métodos nuevos de presentación no estaban en la lista permitida del cliente de escritorio.',
  'fix':'Se añadieron get_presentation/save_presentation y un error claro cuando una ventana antigua aún no ofrece el método.',
  'proof':['portable-presentation']},
 {'id':'F03','kind':'Funcional / secuencia de carga','priority':'Media','state':'Corregido y comprobado',
  'problem':'La carpeta se marcaba como lista antes de terminar la lectura del recorrido; una llamada inmediata podía encontrar el puente ocupado.',
  'fix':'El estado listo se publica tras finalizar esa lectura. El recorrido de prueba espera la condición correcta y acepta el aviso de escena modificada.',
  'proof':['portable-presentation','desktop-ui']},
 {'id':'F04','kind':'Funcional / recuperación','priority':'Alta','state':'Corregido y comprobado',
  'problem':'Un error al cargar el panel opcional de presentación podía propagarse y bloquear el visor 3D.',
  'fix':'Se aísla el fallo en su panel. Una ventana antigua conserva el visor y muestra la necesidad de reiniciar; probado expresamente.',
  'proof':['portable-presentation']},
 {'id':'T01','kind':'Herramienta de prueba','priority':'Media','state':'Corregido y comprobado',
  'problem':'El selector del panel de detalles dejó de ser único al añadir presentación y Melodi.',
  'fix':'Se añadió un identificador estable y se actualizaron las pruebas de Espacios/exportación. No se atribuye este fallo al usuario final.',
  'proof':['spatial-ui']},
 {'id':'T02','kind':'Observación / rendimiento de pruebas','priority':'Media','state':'Registrado; causa no concluida',
  'problem':'Al ejecutar varios navegadores con WebGL por software aparecieron agotamientos de espera al iniciar.',
  'fix':'Se repitieron los recorridos afectados de forma controlada y pasaron. No se amplió el timeout para ocultar el fallo. No prueba rendimiento en GPU física.',
  'proof':['spatial-ui','desktop-ui']},
]

PENDING=[
 ('P0','Captura → vivienda reconstruida','Pesos/licencias, build CUDA, Modal, presupuesto y captura real. El worker y el coordinador multivista están preparados/probados con sustitutos; falta su recorrido integrado con resultado real.'),
 ('P0','Plano y física profesionales','Comparar geometría con medidas independientes, cobertura y orientación; calibrar parámetros físicos. La referencia declarada o una simulación de cajas no bastan.'),
 ('P0','Cuentas y chat operativo','Autorizar Google/Meta/WhatsApp, publicar receptor HTTPS, comprobar permisos/renovación/entrega. Las solicitudes actuales necesitan revisión local; control remoto del equipo pendiente.'),
 ('P0','Live Traductor ≤500 ms','Las mediciones históricas reales exceden el objetivo. Este ensayo nuevo comprueba la cadena y el medidor con upstream sustituido; no acredita calidad o latencia real.'),
 ('P1','Cocina cotidiana completa','Catálogo ampliado con fuentes/localidad, reconocimiento real, voz física, pedidos y envío efectivo al chat. Los tres presets no prueban comida típica ni demanda de usuarios.'),
 ('P1','Distribución y dispositivos','Instaladores/firma/macOS/iPhone/Android/Meta Glasses, cámaras/micrófonos/altavoces físicos, uso prolongado y GPU modestos. Viewports emulados no prueban esos dispositivos.'),
 ('P1','Compartir y operar','Autenticación multiusuario, enlaces de visita revocables, permisos, sincronización, retención y recuperación en interfaz. El shell PWA offline no equivale a tener todas las funciones offline.'),
]


def report_data():
    DIRECTORY.mkdir(parents=True,exist_ok=True);results=[]
    for suite in SUITES:
        candidates=[]
        for path in (ROOT/'tmp/verification').glob(suite+'-*.json'):
            value=json.loads(path.read_text(encoding='utf-8'))
            if value.get('suite')==suite:candidates.append((value['started_at'],path,value))
        if not candidates:raise RuntimeError('Falta suite: '+suite)
        _,path,value=max(candidates)
        if value['exit_code']!=0:raise RuntimeError('La última comprobación no pasó: '+suite)
        count=re.search(r'Ran (\d+) tests',value['output'])
        results.append({'suite':suite,'title':TITLES[suite],'status':'passed','path':path.relative_to(ROOT).as_posix(),
            'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'started_at':value['started_at'],'duration_seconds':value['duration_seconds'],
            'python_test_count':int(count.group(1)) if count else None,'external_calls':value['external_calls'],'gpu_seconds':value['gpu_seconds']})
    extra=json.loads((DIRECTORY/'additional-usecases.json').read_text(encoding='utf-8'))
    now=datetime.now(timezone(timedelta(hours=-4)))
    value={'title':'Brivany · Auditoría de casos de uso','generated_at_la_paz':now.isoformat(),
        'scope':'Pruebas locales, recorridos con datos sintéticos y transportes externos sustituidos; evidencia histórica real identificada por separado.',
        'results':results,'findings':FINDINGS,'new_cases':extra['cases'],'pending':PENDING,
        'new_paid_inferences':0,'new_external_calls':0,'goal_complete':False,
        'disclaimer':'Los resultados no certifican reconstrucción, precisión arquitectónica, realismo físico, 500 ms audibles ni compatibilidad con dispositivos reales.'}
    (DIRECTORY/'audit-summary.json').write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
    return value


def build():
    data=report_data()
    pdfmetrics.registerFont(TTFont('Segoe',r'C:\Windows\Fonts\segoeui.ttf'))
    pdfmetrics.registerFont(TTFont('SegoeBold',r'C:\Windows\Fonts\segoeuib.ttf'))
    pdfmetrics.registerFontFamily('Segoe',normal='Segoe',bold='SegoeBold',italic='Segoe',boldItalic='SegoeBold')
    ink=colors.HexColor('#1d1d1f');quiet=colors.HexColor('#6e6e73');blue=colors.HexColor('#0071e3');line=colors.HexColor('#e8e8ed');pale=colors.HexColor('#f5f5f7')
    width=A4[0]-88
    styles={
      'title':ParagraphStyle('title',fontName='SegoeBold',fontSize=32,leading=37,textColor=ink,spaceAfter=18),
      'h1':ParagraphStyle('h1',fontName='SegoeBold',fontSize=23,leading=29,textColor=ink,spaceAfter=13),
      'h2':ParagraphStyle('h2',fontName='SegoeBold',fontSize=12,leading=17,textColor=ink,spaceBefore=13,spaceAfter=6),
      'body':ParagraphStyle('body',fontName='Segoe',fontSize=10,leading=15,textColor=ink,spaceAfter=9),
      'small':ParagraphStyle('small',fontName='Segoe',fontSize=8.5,leading=12,textColor=quiet,spaceAfter=7),
      'cell':ParagraphStyle('cell',fontName='Segoe',fontSize=9,leading=13,textColor=ink),
      'tag':ParagraphStyle('tag',fontName='SegoeBold',fontSize=9,leading=13,textColor=blue,spaceAfter=12),
    }
    def p(text,style='body'):return Paragraph(text,styles[style])
    def table(rows,colWidths,header=True):
        cells=[[p(escape(str(cell)),'cell') for cell in row] for row in rows]
        result=Table(cells,colWidths=colWidths,repeatRows=1 if header else 0,hAlign='LEFT')
        result.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),('BACKGROUND',(0,0),(-1,0),pale),('LINEBELOW',(0,0),(-1,0),.6,line),('LINEBELOW',(0,1),(-1,-1),.4,line)]))
        return result
    def section(number,title,subtitle=None):
        flow=[p(number,'tag'),p(title,'h1')]
        if subtitle:flow.append(p(subtitle,'small'))
        return flow
    story=[]
    story+=[p('BRIVANY · INFORME DE CONSTRUCCIÓN','tag'),Spacer(1,28),p('Recorridos probados.<br/>Fallos y nuevos usos.','title'),p('Auditoría funcional · 29 de octubre de 2026<br/>Corte: '+escape(data['generated_at_la_paz'][:16].replace('T',' '))+' · America/La_Paz','small'),Spacer(1,14)]
    python=next(item for item in data['results'] if item['suite']=='python')
    story.append(table([['Comprobación','Resultado'],['Suite Python única',str(python['python_test_count'])+' pruebas aprobadas'],['Recorridos y suites revisados',str(len(data['results']))+' suites; contienen controles solapados'],['Usos adicionales explorados',str(len(data['new_cases']))+' escenarios locales con datos sintéticos'],['Coste de inferencia nuevo','0 llamadas externas / 0 inferencias pagadas']], [width*.53,width*.47]))
    story+=[Spacer(1,22),p('Qué significa el resultado','h2'),p('La base local permite explorar, editar, guardar, presentar y organizar solicitudes. Se encontraron fallos de integración y recuperación, se aplicaron correcciones y se volvieron a probar sus recorridos.'),p('<b>El objetivo integral todavía no está terminado.</b> No se ha validado una vivienda reconstruida con Meta/Modal, un plano profesional, la física de objetos reales, cuentas conectadas de producción ni traducción de voz con 500 ms de retraso audible.'),p('Este informe separa archivos/HTTP/navegador reales de datos sintéticos y servicios sustituidos. No se gastaron créditos para repetir pruebas de proveedores ya medidas.','small'),PageBreak()]

    story+=section('01 · MÉTODO','Hasta dónde se probó.')
    story+=[p('Se utilizaron carpetas temporales, SQLite, archivos GLB/ZIP/SVG y Microsoft Edge headless. Las capturas de pantalla muestran datos de prueba. Se verificaron guardados, recarga, conflictos, cancelación y estados de error; no se modificaron claves ni cuentas reales.'),table([
      ['Clase de prueba','Qué demuestra','Qué no demuestra'],
      ['Local real','Archivos, transacciones, HTTP, WebGL, interfaz y WASM se ejecutan.','Calidad de un modelo, dispositivo físico o permiso de una cuenta.'],
      ['Transporte sustituido','La aplicación envía/recibe el contrato y maneja errores con un upstream controlado.','Latencia, exactitud, entrega o disponibilidad del proveedor real.'],
      ['Histórica real','Ensayos existentes de Muse/Meta/Cloudflare/Palabra/Gemini con fecha y límites.','Estado actual en todos los casos, percentiles o garantía al oído.'],
      ['Pendiente','Identifica una puerta de acceso, implementación o validación que falta.','No se contabiliza como aprobada por existir código o una demo.'],
    ],[width*.22,width*.38,width*.40]),Spacer(1,13),p('Reglas del ensayo','h2'),p('Una prueba fallida se conserva. Una corrección añade evidencia nueva. Repetir tras un fallo o cambio resuelve una duda concreta; las suites ya aprobadas no se vuelven a ejecutar por rutina. No se suman sus conteos como si todos fueran pruebas distintas.'),p('Se observaron timeouts al iniciar varios renderizadores WebGL por software a la vez. Los recorridos afectados pasaron al repetirse de forma controlada. La causa exacta no se atribuye a una GPU física ni se oculta como éxito inicial.','small'),PageBreak()]

    story+=section('02 · ESPACIOS','De la captura a la presentación.')
    story.append(table([
      ['Caso y recorrido','Resultado comprobado','Parte pendiente'],
      ['U01 · Capturar un hogar\nMP4/cámara → fotogramas → revisión → imagen/máscara','24 controles de Espacios: preparación, hashes, selección, límites, HUD y cancelación. Cámara sustituida.','Reconstruir la vivienda real; cobertura y calibración; cámara/Meta Glasses físicos.'],
      ['U02 · Editar y organizar\nGLB → selección → mover → variantes → Deshacer → ZIP','GLB y edición persistentes, historial, recuperación de contexto y exportación firmada.','Fidelidad de geometría capturada, memoria GPU y rendimiento físico.'],
      ['U03 · Plano\nGLB → proyección → referencias → guardar → SVG','8 controles de plano y 8 de plano portátil; escala declarada y residuales visibles.','Error de medidas profesional, paredes/aperturas inferidas y cobertura completa.'],
      ['U04 · Proyecto en ordenador\nCrear carpeta → editar → exportar → reabrir','8 controles con puente/archivos reales y selector nativo sustituido; conflictos 409.','Controles nativos completos, instaladores/firma y macOS/iOS/Android.'],
      ['U05 · Visita inmobiliaria\nPuntos → cámaras → guardar → presentar → portable','Recorrido local y 4 controles portátiles; respaldo/restauración con datos de prueba.','Enlace público revocable, permisos de cliente y visita de reconstrucción real.'],
    ],[width*.31,width*.35,width*.34]))
    story+=[Spacer(1,12),p('Reconstrucción multivista: avance y límite','h2'),p('El runner VGGT y el coordinador durable tienen pruebas numéricas y 16 pruebas de dispatch con SDK sustituido. Reserva, no repetición y consumo desconocido se ejercitaron localmente. Pesos/licencias/build/despliegue y entrada de su resultado al recorrido final siguen pendientes; no se generó una habitación real en este ensayo.','small'),PageBreak()]

    story+=section('03 · MELODI','Cocina, chat, voz y redes.')
    story.append(table([
      ['Caso y recorrido','Resultado comprobado','Parte pendiente'],
      ['U06 · Sous\nImagen → inventario → receta → paso → compras','5 controles de visión sustituida y 6 de catálogo. Confirmación humana, preferencias y compras persistentes.','Calidad visual real, recetas locales respaldadas, pedidos y seguridad/temperatura comprobadas.'],
      ['U07 · Chat propio\nFirma → comando → revisar → aprobar → guardar/consultar','7 controles de solicitudes, HMAC/SQLite reales, nota y recordatorio con doble acción; Drive y OAuth sustituidos.','WhatsApp/Google reales, entrega, autorización remota y control del equipo.'],
      ['U08 · Conversación y reunión\nConsentimiento → transcribir → texto/voz → interrumpir','15 controles live, 6 de Sous; contexto espacial y movimientos revisados. Proveedores/micrófono sustituidos.','Conversación física, semántica de destinatario y fuentes externas verificadas.'],
      ['U09 · Video → human-skill\nConsentir → trabajo → borrador → evidencias → progreso','11 controles de UI con servicio sustituido, fuente/timestamp, recarga, exportación y borrado.','Calidad/transferencia del aprendizaje con videos reales variados.'],
      ['U10 · Traducción live\nVideo → audio → relay → subtítulos/PCM → cierre','Video/AudioWorklet/relay reales y upstream simulado. El medidor evita aprobar 500 ms desde una sola salida.','Calidad bilingüe y ≤500 ms audibles reales; pruebas físicas y proveedores elegidos.'],
      ['U11 · Redes\nBorrador → revisión → contenedor/publicar → recibo','9 controles; Instagram requiere dos revisiones. Campaña sólo PAUSED. Graph sustituido.','Cuenta/permisos reales, JPEG verificado, visibilidad y anuncios activos.'],
    ],[width*.31,width*.35,width*.34]));story.append(PageBreak())

    story+=section('04 · HALLAZGOS','Qué falló y qué se corrigió.')
    for finding in FINDINGS:
        story.append(KeepTogether([p(finding['id']+' · '+escape(finding['kind'])+' · '+finding['priority'],'h2'),p(escape(finding['problem']),'body'),p('<b>'+escape(finding['state'])+'.</b> '+escape(finding['fix']),'small')]))
    story+=[p('Los informes fallidos y aprobados se conservan en tmp/verification. Los fallos del harness y los límites de producto se presentan separados: aprobar el harness no convierte una integración pendiente en completa.','small'),PageBreak()]

    story+=section('05 · EXPLORACIÓN','Otras formas de ser útil.')
    for case in data['new_cases']:
        story.append(KeepTogether([p(case['id']+' · '+escape(case['use']),'h2'),p(escape(case['observation'])),p('Límite: '+escape(case['limits']),'small')]))
    story+=[Spacer(1,7),p('Estas seis exploraciones usaron servicios locales reales y datos sintéticos. Demuestran piezas funcionales reutilizables; no son entrevistas, demanda de mercado, evaluación de accesibilidad o prueba de utilidad con clientes.','small'),PageBreak()]

    story+=section('06 · PRIORIDADES','Lo que debe resolverse para cerrar.')
    for priority,title,detail in PENDING:
        story.append(KeepTogether([p(priority+' · '+escape(title),'h2'),p(escape(detail),'body')]))
    story+=[p('Primera validación externa propuesta: una captura real, un objeto o pequeña escena, presupuesto explícito y un único trabajo; comparar geometría/escala antes de ampliar. Para cuentas, una operación por conector con consentimiento y comprobación del resultado. El límite temporal de 72 horas no sustituye estas evidencias.','small'),PageBreak()]

    story+=section('07 · EVIDENCIA','Cómo revisar y reproducir.')
    story+=[p('Manifiesto: <b>tmp/audit20261029/audit-summary.json</b>. Contiene fecha, rutas y SHA-256 de los informes seleccionados. Los hashes preservan identidad del archivo; no certifican su significado.'),p('Ejecutar desde la raíz: .venv/Scripts/python.exe -X utf8 -B -m tools.verify &lt;suite&gt;. Las suites de navegador requieren Playwright/Edge y las variables descritas en VALIDACION.md. No ejecutar proveedores reales desde tools.verify.','small')]
    rows=[['Suite','Estado / evidencia relativa']]
    for item in data['results']:
        name=Path(item['path']).name
        rows.append([item['suite'],name])
    evidence_table=table(rows,[width*.30,width*.70])
    evidence_table.setStyle(TableStyle([('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
    story.append(evidence_table)
    story+=[Spacer(1,9),p('No hay claves, .env, conversaciones del usuario, audio, videos ni fotografías originales en este PDF. La bitácora local conserva los informes y las correcciones como registros añadidos.','small')]

    def footer(canvas,doc):
        canvas.saveState();canvas.setStrokeColor(line);canvas.line(44,43,A4[0]-44,43);canvas.setFont('Segoe',8);canvas.setFillColor(quiet)
        canvas.drawString(44,28,'BRIVANY  /  Auditoría local  /  29.10.2026');canvas.drawRightString(A4[0]-44,28,str(doc.page));canvas.restoreState()
    document=SimpleDocTemplate(str(OUTPUT),pagesize=A4,rightMargin=44,leftMargin=44,topMargin=42,bottomMargin=58,
        title='Brivany · Auditoría de casos de uso y nuevos usos',author='Brivany · Bitácora de construcción',subject='Resultados locales, fallos corregidos, límites y usos adicionales',pageCompression=1)
    document.build(story,onFirstPage=footer,onLaterPages=footer)
    md=['# Auditoría de casos de uso · 29 de octubre de 2026','',
        'Informe PDF: [Brivany_Auditoria_Casos_de_Uso_2026-10-29.pdf](../Brivany_Auditoria_Casos_de_Uso_2026-10-29.pdf).','',
        'Suite general: '+str(python['python_test_count'])+' pruebas Python aprobadas. '+str(len(data['results']))+' suites seleccionadas con controles solapados. Seis escenarios adicionales locales. Cero llamadas externas e inferencias pagadas nuevas.','',
        'La plataforma integral sigue pendiente: el PDF no acredita reconstrucción real, precisión profesional, realismo físico, 500 ms audibles o dispositivos físicos.','', '## Hallazgos y correcciones','']
    for item in FINDINGS:md+=['- **'+item['id']+' · '+item['state']+'**: '+item['problem']+' '+item['fix']]
    md+=['','## Evidencias','']+[ '- `'+item['path']+'` · '+item['title'] for item in data['results']]
    md+=['','## Usos adicionales','']+['- **'+case['use']+'**: '+case['observation']+' Límite: '+case['limits'] for case in data['new_cases']]
    md+=['','## Pendientes','']+['- **'+priority+' · '+title+'**: '+detail for priority,title,detail in PENDING]
    (ROOT/'docs/40-auditoria-casos-de-uso.md').write_text('\n'.join(md)+'\n',encoding='utf-8')
    print(json.dumps({'pdf':str(OUTPUT),'size_bytes':OUTPUT.stat().st_size,'suites':len(data['results']),'python_tests':python['python_test_count'],'new_cases':len(data['new_cases'])},ensure_ascii=False))


if __name__=='__main__':build()
