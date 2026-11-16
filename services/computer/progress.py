"""Coarse milestone estimates. No clock-based progress or provider percentages."""
import re


def media_progress(job):
    if job.get('kind') not in {'image','motion'}:return None
    state=job.get('state');result=job.get('result') or {}
    if state in {'succeeded','awaiting_user'} and result.get('verified') is True and result.get('path'):
        return {'percent':100,'estimated':False,'source':'verified_artifact'}
    if state not in {'queued','planning','running','reviewing'}:return None
    phase=str(job.get('phase','')).lower()
    value=8 if state=='planning' else 92 if state=='reviewing' else 1
    if job.get('kind')=='image':
        count=re.search(r'creando la imagen (\d+) de (\d+)',phase)
        if count and int(count[2])>0:value=max(value,1+int(85*(int(count[1])-1)/int(count[2])))
    milestones=[(r'midiendo|detectando cambios|muestras|analizando|interpretando',18),
                (r'montaje.*definido|plan.*definido|obteniendo.*escenas|recursos',28),
                (r'preparando.*voz|preparando.*persona|sintetiz|cartesia',38),
                (r'ajustando.*audio|mezclando',52),(r'verificando.*composici[oó]n|comprobando dise[nñ]o',60),
                (r'renderizando|renderizo.*fotograma',70),
                (r'revisando.*fotogramas|guardando|exportando',92),(r'comprobando.*formato|archivo.*completo',98)]
    for pattern,percent in milestones:
        if re.search(pattern,phase):value=max(value,percent)
    return {'percent':min(99,value),'estimated':True,'source':'observed_milestone'}
