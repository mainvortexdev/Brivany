"""Actual Windows diagnostic compositions, no provider and no native input."""
from datetime import datetime,timezone
import json
from pathlib import Path
import tempfile
from uuid import uuid4
from services.computer.runtime import NativeRuntime,ROOT

QUERIES=[
 {'source':'processes','fields':['ProcessName','WorkingSet64'],'where':[],'sort':{'property':'WorkingSet64','descending':True},'limit':3,'aggregate':None},
 {'source':'services','fields':['Name','Status','StartType'],'where':[{'property':'StartType','op':'eq','value':'Automatic'},{'property':'Status','op':'eq','value':'Stopped'}],'sort':None,'limit':3,'aggregate':{'op':'count','property':None}},
 {'source':'volumes','fields':['Size','FreeSpace'],'where':[{'property':'Size','op':'gt','value':0}],'sort':{'property':'FreeSpace','descending':False},'limit':3,'aggregate':{'op':'sum','property':'FreeSpace'}}
]
def main():
    report={'passed':False,'time':datetime.now(timezone.utc).isoformat(),'scope':'actual Windows read-only commands composed with filters, sorting and aggregation','provider_requests':0,'native_input_sent':False,'queries':[]}
    with tempfile.TemporaryDirectory(prefix='brivany-diagnostics-') as folder:
        runtime=NativeRuntime(folder,proxy='http://127.0.0.1:1',token=uuid4().hex)
        try:
            for query in QUERIES:
                result=runtime.call('system_query',query=query,timeout=25);assert result['verified'] and len(result['rows'])<=query['limit']
                if query['source']=='processes':
                    values=[row['WorkingSet64'] for row in result['rows']];assert values==sorted(values,reverse=True) and len(values)==3
                if query['source']=='services':assert result['aggregate']['value']==result['matching_rows']
                report['queries'].append({'source':query['source'],'command':result['source_command'],'row_count':len(result['rows']),'matching_rows':result['matching_rows'],'aggregate':result['aggregate'],'verified':True})
            report['passed']=True
        except Exception as error:report['error']=str(error)[:250]
        finally:runtime.close()
    path=ROOT/'tmp/system-diagnostics-native.json';path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False));return 0 if report['passed'] else 1
if __name__=='__main__':raise SystemExit(main())
