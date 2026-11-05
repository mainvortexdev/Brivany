"""Compila el documento completo desde Markdown. Requiere reportlab."""
from pathlib import Path
import re
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                               Spacer, PageBreak, Table, TableStyle, KeepTogether)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Polygon

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT.parent / "entregables"
FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")
pdfmetrics.registerFont(TTFont("BrivanySans", str(FONT_DIR / "DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont("BrivanyBold", str(FONT_DIR / "DejaVuSans-Bold.ttf")))
pdfmetrics.registerFont(TTFont("BrivanyMono", str(FONT_DIR / "DejaVuSansMono.ttf")))
pdfmetrics.registerFontFamily("BrivanySans", normal="BrivanySans", bold="BrivanyBold", italic="BrivanySans", boldItalic="BrivanyBold")

styles = getSampleStyleSheet()
for name in ["Normal", "BodyText", "Title", "Heading1", "Heading2", "Heading3"]:
    styles[name].fontName = "BrivanySans"
    styles[name].textColor = colors.black
styles["BodyText"].fontSize = 10.4
styles["BodyText"].leading = 14.8
styles["BodyText"].spaceAfter = 7
styles["BodyText"].allowWidows = 0
styles["BodyText"].allowOrphans = 0
styles["Title"].fontName = "BrivanyBold"
styles["Title"].fontSize = 34
styles["Title"].leading = 40
styles["Title"].alignment = TA_LEFT
styles["Title"].spaceAfter = 18
styles["Heading1"].fontName = "BrivanyBold"
styles["Heading1"].fontSize = 20
styles["Heading1"].leading = 25
styles["Heading1"].spaceAfter = 14
styles["Heading1"].spaceBefore = 20
styles["Heading2"].fontName = "BrivanyBold"
styles["Heading2"].fontSize = 12.3
styles["Heading2"].leading = 17
styles["Heading2"].spaceBefore = 13
styles["Heading2"].spaceAfter = 6
styles.add(ParagraphStyle("SubTitleBrivany", parent=styles["BodyText"], fontSize=18, leading=24, spaceAfter=18))
styles.add(ParagraphStyle("MetaBrivany", parent=styles["BodyText"], fontSize=9.5, leading=14, textColor=colors.HexColor("#505050")))
styles.add(ParagraphStyle("Cell", parent=styles["BodyText"], fontSize=8.7, leading=12.1, spaceAfter=0))
styles.add(ParagraphStyle("CellHead", parent=styles["Cell"], fontName="BrivanyBold", textColor=colors.white))
styles.add(ParagraphStyle("BulletBrivany", parent=styles["BodyText"], leftIndent=13, firstLineIndent=0, bulletIndent=1, bulletFontName="BrivanySans", spaceAfter=5))
styles.add(ParagraphStyle("CaptionBrivany", parent=styles["BodyText"], fontSize=8.8, leading=12, textColor=colors.HexColor("#505050"), spaceBefore=5, spaceAfter=10))
styles.add(ParagraphStyle("TOCBrivany", parent=styles["BodyText"], fontSize=11, leading=18, spaceBefore=6))
styles.add(ParagraphStyle("CoverHead", parent=styles["Heading2"]))
styles.add(ParagraphStyle("TOCTitle", parent=styles["Heading1"]))


def inline(text):
    text = text.replace("\u2013", "-").replace("\u2014", "-").replace("\u2011", "-")
    links = []
    def link(match):
        links.append((match.group(1), match.group(2)))
        return f"LINKPLACEHOLDER{len(links)-1}TOKEN"
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", link, text)
    text = escape(text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"`([^`]+)`", r'<font name="BrivanyMono" size="8.6">\1</font>', text)
    for i, (label, url) in enumerate(links):
        formatted = f'<link href="{escape(url)}" color="#222222">{escape(label)}</link>' if "://" in url else escape(label)
        text = text.replace(f"LINKPLACEHOLDER{i}TOKEN", formatted)
    return text


def p(text, style="BodyText"):
    return Paragraph(inline(text), styles[style])


class Document(BaseDocTemplate):
    def __init__(self, path):
        super().__init__(str(path), pagesize=letter, leftMargin=48, rightMargin=48,
                         topMargin=43, bottomMargin=45, title="Brivany Idea del producto y arquitectura inicial",
                         author="Preparado para Daniel Luna", pageCompression=1)
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="normal", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates(PageTemplate(id="main", frames=frame, onPage=self.draw_page))
        self._heading_index = 0

    def beforeDocument(self):
        self._heading_index = 0

    def draw_page(self, canvas, doc):
        canvas.saveState()
        canvas.setFont("BrivanySans", 8)
        canvas.setFillColor(colors.HexColor("#666666"))
        canvas.drawString(48, 25, "Brivany  |  Melodi  |  Arquitectura 0.1.0")
        canvas.drawRightString(letter[0] - 48, 25, str(doc.page))
        canvas.restoreState()

    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph) and flowable.style.name in ("Heading1", "Heading2"):
            level = 0 if flowable.style.name == "Heading1" else 1
            title = flowable.getPlainText()
            key = f"section-{self._heading_index}"
            self._heading_index += 1
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(title, key, level=level, closed=False)
            if level == 0:
                self.notify("TOCEntry", (0, title, self.page, key))


def arrow(d, x1, y1, x2, y2):
    from math import atan2, sin, cos
    d.add(Line(x1, y1, x2, y2, strokeColor=colors.HexColor("#686868"), strokeWidth=0.8))
    a = atan2(y2-y1, x2-x1)
    size = 4
    d.add(Polygon([x2,y2, x2-size*cos(a)-2.2*sin(a),y2-size*sin(a)+2.2*cos(a),
                   x2-size*cos(a)+2.2*sin(a),y2-size*sin(a)-2.2*cos(a)],fillColor=colors.HexColor("#686868"),strokeColor=None))


def box(d, x, y, w, h, lines):
    d.add(Rect(x, y, w, h, rx=4, ry=4, fillColor=colors.HexColor("#F4F4F4"), strokeColor=colors.HexColor("#B0B0B0"), strokeWidth=0.7))
    for i, line in enumerate(lines):
        d.add(String(x+w/2, y+h/2+(len(lines)-1)*5-i*10-3, line, textAnchor="middle", fontName="BrivanySans", fontSize=8.8))


def system_diagram():
    d = Drawing(516, 327)
    nodes = {
        "people":(194,287,128,32,["Experto y alumno"]),
        "bridge":(194,235,128,32,["Puente local"]),
        "apps":(8,235,145,32,["Conectores de apps"]),
        "api":(194,181,128,32,["API de Brivany"]),
        "worker":(371,181,137,32,["Worker persistente"]),
        "core":(194,125,128,34,["Skills y motor", "de sesión"]),
        "melodi":(8,72,145,32,["Melodi"]),
        "verify":(194,72,128,32,["Verificación y políticas"]),
        "db":(371,72,137,32,["PostgreSQL"]),
        "meta":(8,16,145,32,["Adaptador Meta"]),
        "media":(371,16,137,32,["Medios privados"]),
    }
    arrow(d,258,287,258,267); arrow(d,194,251,153,251); arrow(d,258,235,258,213)
    arrow(d,322,197,371,197); arrow(d,258,181,258,159)
    arrow(d,194,142,80,104); arrow(d,258,125,258,104); arrow(d,322,142,439,104)
    arrow(d,80,72,80,48); arrow(d,322,88,371,88)
    # Rutas separadas para no atribuir al almacén una dependencia de PostgreSQL.
    d.add(Line(508,197,515,197,strokeColor=colors.HexColor("#999999"),strokeWidth=0.6))
    d.add(Line(515,197,515,32,strokeColor=colors.HexColor("#999999"),strokeWidth=0.6))
    arrow(d,515,32,508,32)
    d.add(Line(371,187,350,187,strokeColor=colors.HexColor("#999999"),strokeWidth=0.6))
    d.add(Line(350,187,350,5,strokeColor=colors.HexColor("#999999"),strokeWidth=0.6))
    d.add(Line(350,5,80,5,strokeColor=colors.HexColor("#999999"),strokeWidth=0.6))
    arrow(d,80,5,80,16)
    for values in nodes.values():
        box(d,*values)
    return d


def sequence_diagram(kind):
    if kind == "creation":
        actors = ["Experto", "Brivany", "Modelos Meta", "Registro"]
        steps = [(0,1,"Demostración y permiso"),(1,2,"Segmentos para extracción"),(2,1,"Borrador y fuentes"),
                 (1,0,"Preguntas y revisión"),(0,1,"Aprobación del contenido"),(1,3,"Versión y hash inmutables")]
    else:
        actors = ["Puente local", "Motor de sesión", "Melodi", "Verificación"]
        steps = [(0,1,"Contexto y capacidades"),(1,2,"Paso y contexto autorizado"),(2,1,"Propuesta pedagógica"),
                 (1,0,"Guía validada"),(0,1,"Nueva observación"),(1,3,"Rúbrica y evidencia"),(3,1,"Resultado verificable"),(1,0,"Siguiente paso o recuperación")]
    h = 58+len(steps)*30
    d = Drawing(516,h)
    xs = [65,194,323,452]
    for x,label in zip(xs,actors):
        box(d,x-58,h-30,116,27,[label])
        d.add(Line(x,12,x,h-33,strokeColor=colors.HexColor("#BBBBBB"),strokeWidth=0.6))
    for i,(a,b,label) in enumerate(steps):
        y=h-60-i*30
        arrow(d,xs[a],y,xs[b],y)
        # Fondo blanco alrededor de la etiqueta para que las líneas de vida no la crucen.
        width = pdfmetrics.stringWidth(label,"BrivanySans",8)
        cx=(xs[a]+xs[b])/2
        d.add(Rect(cx-width/2-2,y+3,width+4,11,fillColor=colors.white,strokeColor=None))
        d.add(String(cx,y+5,label,textAnchor="middle",fontName="BrivanySans",fontSize=8))
    return d


def lifecycle_diagram():
    d=Drawing(516,210)
    for coords in [(40,158,120,32,["Borrador"]),(207,158,120,32,["En revisión"]),
                   (207,91,120,32,["Publicada"]),(40,22,120,32,["Reemplazada"]),(374,22,120,32,["Retirada"])]:
        box(d,*coords)
    arrow(d,160,180,207,180); arrow(d,207,166,160,166)
    arrow(d,267,158,267,123); arrow(d,207,91,100,54); arrow(d,327,91,434,54); arrow(d,160,38,374,38)
    d.add(String(276,140,"Aprobar hash",fontName="BrivanySans",fontSize=8))
    return d


def relation_table():
    return make_table([
        ["Relación", "Responsabilidad"],
        ["Espacio → skill → versión", "Propiedad y contenido versionado"],
        ["Versión → revisión y sesión", "Contenido aprobado y fijado por intento"],
        ["Sesión → observación → evidencia", "Trazabilidad de hechos y recursos"],
        ["Sesión → verificación", "Resultado de una rúbrica sobre evidencia"],
        ["Sesión → comando → resultado", "Acciones autorizadas y ejecución observada"],
        ["Sesión → intento de aprendizaje", "Ayuda utilizada y ejercicio de transferencia"],
    ])


def make_table(rows):
    n=len(rows[0])
    if n==2:
        fractions=[0.31,0.69]
    elif n==3:
        fractions=[0.22,0.38,0.40]
    elif n==4:
        fractions=[0.105,0.295,0.30,0.30]
    else:
        fractions=[1/n]*n
    cellrows=[[p(cell,"CellHead" if index==0 else "Cell") for cell in row] for index,row in enumerate(rows)]
    table=Table(cellrows,colWidths=[516*f for f in fractions],repeatRows=1,hAlign="LEFT",splitByRow=1)
    table.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,0),colors.HexColor("#343434")),
        ("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,colors.HexColor("#F5F5F5")]),
        ("GRID",(0,0),(-1,-1),0.5,colors.HexColor("#D9D9D9")),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
        ("LEFTPADDING",(0,0),(-1,-1),6),("RIGHTPADDING",(0,0),(-1,-1),6),
        ("TOPPADDING",(0,0),(-1,-1),6),("BOTTOMPADDING",(0,0),(-1,-1),6),
    ]))
    return table


def parse_markdown(text):
    flow=[]; lines=text.splitlines(); index=0; sequence_count=0
    while index<len(lines):
        line=lines[index].strip()
        if not line:
            index+=1; continue
        if line.startswith("```mermaid"):
            code=[]; index+=1
            while index<len(lines) and not lines[index].startswith("```"):
                code.append(lines[index]); index+=1
            body="\n".join(code)
            if "flowchart" in body:
                figure=system_diagram(); caption="Componentes propuestos y sus dependencias principales"
            elif "sequenceDiagram" in body:
                kind="creation" if "Experto" in body else "learning"
                figure=sequence_diagram(kind); caption="Secuencia de creación" if kind=="creation" else "Secuencia de acompañamiento y verificación"
            elif "stateDiagram" in body:
                figure=lifecycle_diagram(); caption="Ciclo de vida de una versión de skill"
            else:
                figure=relation_table(); caption="Relaciones principales del modelo de datos"
            flow.append(KeepTogether([figure,p(caption,"CaptionBrivany")]))
            index+=1; continue
        if line.startswith("```"):
            code=[]; index+=1
            while index<len(lines) and not lines[index].startswith("```"):
                code.append(lines[index]); index+=1
            for c in code:
                flow.append(p("`"+c+"`"))
            index+=1; continue
        if line.startswith("|"):
            rows=[]
            while index<len(lines) and lines[index].strip().startswith("|"):
                row=[c.strip() for c in lines[index].strip().strip("|").split("|")]
                if not all(re.fullmatch(r"[:\- ]+",c or "-") for c in row):
                    rows.append(row)
                index+=1
            flow.append(make_table(rows)); flow.append(Spacer(1,10)); continue
        if line.startswith("# "):
            flow.append(p(line[2:],"Heading1")); index+=1; continue
        if line.startswith("## "):
            flow.append(p(line[3:],"Heading2")); index+=1; continue
        if line.startswith("- "):
            flow.append(Paragraph(inline(line[2:]),styles["BulletBrivany"],bulletText="•")); index+=1; continue
        if re.match(r"^\d+\. ",line):
            number,body=line.split(". ",1)
            flow.append(Paragraph(inline(body),styles["BulletBrivany"],bulletText=number+".")); index+=1; continue
        paragraph=[line]; index+=1
        while index<len(lines) and lines[index].strip() and not re.match(r"^(#|\||```|- |\d+\. )",lines[index].strip()):
            paragraph.append(lines[index].strip()); index+=1
        flow.append(p(" ".join(paragraph)))
    return flow


def build():
    OUT.mkdir(exist_ok=True)
    markdowns=sorted((ROOT/"docs").glob("*.md"))
    master=("# Brivany\n\n## Idea del producto y arquitectura inicial\n\n"
            "Preparado para Daniel Luna. Actualizado el 27 de octubre de 2026. Versión 0.1.0.\n\n"
            "Este documento define el producto, el papel de Melodi y su arquitectura inicial. "
            "La implementación funcional, las integraciones y la interfaz pertenecen a fases posteriores.\n\n")
    master+="\n\n---\n\n".join(path.read_text() for path in markdowns)
    master+="\n\n---\n\n"+(ROOT/"VALIDACION.md").read_text()
    (OUT/"Brivany_Arquitectura_Inicial.md").write_text(master,encoding="utf-8")
    story=[Spacer(1,62),p("Brivany","Title"),p("Idea del producto y arquitectura inicial","SubTitleBrivany"),
           Paragraph("Preparado para Daniel Luna<br/>27 de octubre de 2026 · Versión 0.1.0",styles["MetaBrivany"]),Spacer(1,30),
           p("Brivany convierte métodos de trabajo de expertos en skills que otras personas pueden practicar en sus propios proyectos. Melodi es la agente integrada que interpreta el contexto, explica decisiones y acompaña el aprendizaje."),
           p("Este documento fija el objetivo del producto, sus capacidades, el funcionamiento del sistema y la expansión a edición de video, colorización, AutoCAD, arquitectura y modelado 3D."),
           p("La base propuesta combina skills revisadas, modelos Meta, conectores profesionales y verificaciones con evidencia. El aprendizaje independiente se evalúa por separado de completar una tarea con ayuda."),Spacer(1,14),
           p("Estado del proyecto","CoverHead"),
           p("Arquitectura y contratos preparados. La interfaz, los servicios operativos y las integraciones reales se desarrollarán y validarán en las siguientes fases."),
           PageBreak(),p("Contenido","TOCTitle")]
    toc=TableOfContents(); toc.levelStyles=[styles["TOCBrivany"]]
    story.extend([p("La primera parte explica la idea. Las secciones siguientes permiten convertirla en un sistema implementable, con límites y pruebas definidos."),Spacer(1,10),toc])
    for index,path in enumerate(markdowns):
        if index==0:
            story.append(PageBreak())
        story.extend(parse_markdown(path.read_text()))
    validation = parse_markdown((ROOT/"VALIDACION.md").read_text())
    for item in validation:
        if isinstance(item, Paragraph):
            name = item.style.name
            if name in ("BodyText", "BulletBrivany"):
                item.style = ParagraphStyle(name, parent=item.style, fontSize=9.6,
                                            leading=12.7, spaceAfter=4)
            elif name == "Heading1":
                item.style = ParagraphStyle(name, parent=item.style, spaceBefore=12,
                                            spaceAfter=10)
            elif name == "Heading2":
                item.style = ParagraphStyle(name, parent=item.style, spaceBefore=9)
    story.extend(validation)
    doc=Document(OUT/"Brivany_Idea_y_Arquitectura.pdf")
    doc.multiBuild(story)
    print(str(OUT/"Brivany_Idea_y_Arquitectura.pdf"))
    print(str(OUT/"Brivany_Arquitectura_Inicial.md"))


if __name__ == "__main__":
    build()
