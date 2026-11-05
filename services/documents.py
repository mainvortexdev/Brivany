"""Text-only document exports. Never read arbitrary files, fetch URLs or overwrite."""
from io import BytesIO
import re
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal


class DocumentContent(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    title: str=Field(min_length=1,max_length=160)
    markdown: str=Field(min_length=1,max_length=12000)


class DocumentExport(DocumentContent):
    format: Literal['docx','md']='docx'


def export_document(value):
    if not value.title.strip() or not value.markdown.strip():raise ValueError('Documento vacío.')
    stem=re.sub(r'[<>:"/\\|?*\x00-\x1f]',' ',value.title).strip('. ')[:100] or 'Documento'
    if stem.upper().split('.')[0] in {'CON','PRN','AUX','NUL',*(f'COM{i}' for i in range(1,10)),*(f'LPT{i}' for i in range(1,10))}:stem='Brivany '+stem
    filename=stem+'.'+value.format
    if value.format=='md':return value.markdown.encode('utf-8'),'text/markdown; charset=utf-8',filename
    from docx import Document
    from docx.shared import Inches,Pt,RGBColor
    document=Document();section=document.sections[0]
    section.page_width=Inches(8.5);section.page_height=Inches(11)
    section.top_margin=section.bottom_margin=section.left_margin=section.right_margin=Inches(1)
    for name in ('Normal','Title','Heading 1','Heading 2','Heading 3'):
        style=document.styles[name];style.font.name='Calibri';style.font.color.rgb=RGBColor(0,0,0)
    normal=document.styles['Normal'];normal.font.size=Pt(11)
    normal.paragraph_format.line_spacing=1.15;normal.paragraph_format.space_after=Pt(7)
    document.add_paragraph(value.title,style='Title')
    lines=value.markdown.splitlines()
    if lines and lines[0].lstrip('# ').strip()==value.title.strip():lines=lines[1:]
    def add_runs(paragraph,text):
        for i,part in enumerate(re.split(r'\*\*(.*?)\*\*',text)):
            paragraph.add_run(part).bold=bool(i%2)
    paragraph=[]
    def flush():
        if paragraph:add_runs(document.add_paragraph(),' '.join(paragraph));paragraph.clear()
    for line in lines:
        line=line.strip()
        if not line:flush();continue
        heading=re.match(r'^(#{1,3})\s+(.+)',line)
        bullet=re.match(r'^[-*]\s+(.+)',line)
        numbered=re.match(r'^\d+[.)]\s+(.+)',line)
        if heading:flush();document.add_heading(heading[2],level=len(heading[1]))
        elif bullet or numbered:
            flush();add_runs(document.add_paragraph(style='List Bullet' if bullet else 'List Number'),(bullet or numbered)[1])
        else:paragraph.append(line)
    flush();document.core_properties.author='Melodi';document.core_properties.title=value.title
    output=BytesIO();document.save(output)
    return output.getvalue(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document',filename
