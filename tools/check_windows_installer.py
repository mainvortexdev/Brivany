"""Exercise the real setup/uninstaller in an isolated registration and directory."""
from pathlib import Path
import hashlib,json,os,subprocess,sys,time
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from desktop.experience.workspace_preferences import WorkspacePreferences

def main():
 version=json.loads((ROOT/'desktop/distribution/version.json').read_text())['version']
 out=ROOT/'Exports'/('Brivany-Windows-'+version);fixture=ROOT/'.local/distribution'/('installer-test-'+str(int(time.time())))
 install=fixture/'Program';profile=fixture/'User Data';fixture.mkdir(parents=True)
 preferences=profile/'.local/workspace/preferences.json';WorkspacePreferences(preferences).update({'appearance':{'size':'compact','accent':'mint'}})
 before=hashlib.sha256(preferences.read_bytes()).hexdigest()
 setup=out/f'Brivany-Setup-{version}-x64.exe'
 command=[str(setup),'/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/PackageCheck=1','/DIR='+str(install),'/LOG='+str(fixture/'setup.log')]
 subprocess.run(command,check=True,timeout=240)
 assert (install/'Brivany.exe').is_file(),'Executable missing after setup'
 assert (install/'unins000.exe').is_file(),'Windows uninstaller missing'
 env=dict(os.environ,BRIVANY_TEST_DATA_DIR=str(profile),BRIVANY_SMOKE_REPORT=str(fixture/'native.json'))
 subprocess.run([str(install/'Brivany.exe')],env=env,check=True,timeout=85)
 smoke=json.loads((fixture/'native.json').read_text());assert smoke['loaded'] and smoke['document']['shell_ready'],smoke
 assert WorkspacePreferences(preferences).snapshot()['appearance']['size']=='compact'
 subprocess.run([str(install/'unins000.exe'),'/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/LOG='+str(fixture/'uninstall.log')],check=True,timeout=120)
 assert not (install/'Brivany.exe').exists(),'Executable remained after uninstall'
 assert not (install/'releases').exists(),'Installed versions remained after uninstall'
 assert hashlib.sha256(preferences.read_bytes()).hexdigest()==before,'User data changed during install/uninstall'
 result={'installer_exit':0,'real_executable_launched':True,'uninstaller_exit':0,'application_removed':True,'preferences_preserved':True,'fixture':str(fixture)}
 (out/'installer-acceptance.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)

if __name__=='__main__':main()
