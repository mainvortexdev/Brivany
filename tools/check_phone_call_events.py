"""Read only the explicitly requested call's provider events; never dial.

Output is a field allowlist, excluding numbers, credentials, URLs, transcripts,
request bodies and raw provider messages.
"""
import json
import os
from pathlib import Path
import re
from urllib.parse import urlencode
from urllib.request import Request,urlopen
from urllib.error import HTTPError

ROOT=Path(__file__).resolve().parents[1]
values={}
for path in (ROOT/'.env',Path(os.environ['LOCALAPPDATA'])/'Brivany/User Data/.env'):
    if path.is_file():
        for line in path.read_text(encoding='utf-8-sig').splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                key,value=(v.strip() for v in line.split('=',1))
                if key in {'TELNYX_API_KEY','BRIVANY_TELNYX_API_KEY','TELNYX_CONNECTION_ID'}:values[key]=value.strip('\"\'')
params={'filter[connection_id]':values['TELNYX_CONNECTION_ID'],'filter[to]':'+18495205246','filter[occurred_at][gte]':'2026-11-14T16:18:35Z','page[limit]':100}
request=Request('https://api.telnyx.com/v2/call_events?'+urlencode(params),headers={'Authorization':'Bearer '+(values.get('TELNYX_API_KEY') or values['BRIVANY_TELNYX_API_KEY'])})
try:
    with urlopen(request,timeout=20) as response:data=json.load(response)
except HTTPError as error:raise SystemExit('Telnyx events HTTP '+str(error.code)) from None
allowed={'hangup_cause','hangup_source','sip_hangup_cause','event_type','status_code','response_code','error_code','streaming_error'}
def safe_fields(value,depth=0):
    result={}
    if depth>7:return result
    if isinstance(value,str) and value.startswith('{'):
        try:value=json.loads(value)
        except ValueError:return result
    if isinstance(value,dict):
        for key,item in value.items():
            if key in allowed and (isinstance(item,int) or isinstance(item,str) and re.fullmatch(r'[\w .:-]{1,100}',item)):
                result[key]=item
            elif isinstance(item,(dict,list)) or isinstance(item,str) and item.startswith('{'):result.update(safe_fields(item,depth+1))
    elif isinstance(value,list):
        for item in value[:20]:result.update(safe_fields(item,depth+1))
    return result
events=[{'name':row.get('name'),'type':row.get('type'),'at':row.get('event_timestamp') or row.get('occurred_at') or row.get('created_at'),'schemaKeys':list(row.keys()),'fields':safe_fields(row)} for row in data.get('data',[])]
report={'events':events,'telephoneDialed':False,'rawProviderDataSaved':False}
path=ROOT/'tmp/verification/phone-provider-events-20261114.json';path.write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
