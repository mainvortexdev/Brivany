"""Native update acceptance check using a private installation and profile.

Network transport is substituted with the exact signed local release archive;
verification, extraction, selection, real EXE launch and health signal are real.
No call, provider request, or user's running Brivany session is used.
"""
from pathlib import Path
import json,os,shutil,sys,time
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from desktop.distribution import updater
from desktop.experience.workspace_preferences import WorkspacePreferences

def main():
 version=json.loads((ROOT/'desktop/distribution/version.json').read_text())['version']
 release=ROOT/'Exports'/('Brivany-Windows-'+version)
 fixture=ROOT/'.local/distribution'/('native-update-'+str(int(time.time())))
 install=fixture/'install';profile=fixture/'User Data';updates=profile/'.local/updates'
 (install/'releases/0.0.9').mkdir(parents=True)
 shutil.copy2(ROOT/'.local/distribution'/('build-'+version)/'payload/Brivany.exe',install/'Brivany.exe')
 updater.atomic_json(install/'current.json',{'version':'0.0.9'})
 preferences=profile/'.local/workspace/preferences.json'
 WorkspacePreferences(preferences).update({'appearance':{'size':'compact','accent':'mint'}});before=preferences.read_bytes()
 envelope=json.loads((release/'stable.json').read_text());archive=release/Path(envelope['payload']['url']).name
 report=fixture/'smoke.json'
 env={'BRIVANY_TEST_DATA_DIR':str(profile),'BRIVANY_DATA_DIR':str(profile),'BRIVANY_SMOKE_REPORT':str(report)}
 with patch.dict(os.environ,env),patch.object(updater,'VERSION','0.0.9'):
  service=updater.UpdateService(install,updates)
  with patch.object(updater,'fetch',return_value=json.dumps(envelope).encode()),patch.object(updater,'build_opener') as opener:
   opener.return_value.open.side_effect=lambda *a,**k:archive.open('rb')
   assert service.check()['state']=='available';assert service.stage()['state']=='ready',service.status()
  assert json.loads((install/'current.json').read_text())['version']=='0.0.9'
  assert updater.apply(install,updates,99999999,health_seconds=65),'Native health was not received'
  deadline=time.monotonic()+20
  while not report.exists() and time.monotonic()<deadline:time.sleep(.25)
 assert report.exists(),'Native window report missing'
 value=json.loads(report.read_text());assert value['document']['shell_ready'],value
 assert preferences.read_bytes()==before,'User preferences changed during update'
 assert WorkspacePreferences(preferences).snapshot()['appearance']['size']=='compact'
 assert json.loads((install/'current.json').read_text())['version']==version
 result={'signed_archive_verified':True,'real_executable_launched':True,'native_window_loaded':True,'settings_preserved':True,'selected_version':version,'previous_version':'0.0.9 (isolated test fixture)','public_network_test':False,'fixture':str(fixture)}
 (release/'update-acceptance.json').write_text(json.dumps(result,indent=2))
 print(json.dumps(result),flush=True)

if __name__=='__main__':main()
