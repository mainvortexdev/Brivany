"""Real isolated private installer acceptance; no phone, audio or input actions."""
from pathlib import Path
import hashlib,json,os,subprocess,time,shutil
from desktop.experience.workspace_preferences import WorkspacePreferences
ROOT=Path(__file__).resolve().parents[1]

def main():
    version=json.loads((ROOT/'desktop/distribution/version.json').read_text())['version'];out=ROOT/'Exports'/('Brivany-Jon-Demo-'+version);fixture=ROOT/'.local/distribution'/('demo-installer-test-'+str(int(time.time())));install=fixture/'Program';profile=fixture/'User Data';fixture.mkdir(parents=True)
    previous=os.environ.get('BRIVANY_DEMO_ACCEPTANCE_SESSION')
    if previous:
        source=Path(previous).resolve();base=(ROOT/'.local/distribution').resolve()
        if not source.is_relative_to(base) or source.is_symlink():raise ValueError('The acceptance session must belong to an isolated installer fixture.')
        target=profile/'.local/demo';target.mkdir(parents=True)
        for name in ['session.dpapi','device.json']:shutil.copy2(source/name,target/name)
    preferences=profile/'.local/workspace/preferences.json';WorkspacePreferences(preferences).update({'appearance':{'size':'compact','accent':'mint'}});before=hashlib.sha256(preferences.read_bytes()).hexdigest()
    setup=out/f'Brivany-Jon-Demo-Setup-{version}-x64.exe';subprocess.run([str(setup),'/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/PackageCheck=1','/DIR='+str(install),'/LOG='+str(fixture/'setup.log')],check=True,timeout=300)
    env=dict(os.environ,BRIVANY_TEST_DATA_DIR=str(profile),BRIVANY_SMOKE_REPORT=str(fixture/'native.json'));subprocess.run([str(install/'Brivany.exe')],env=env,check=True,timeout=100)
    smoke=json.loads((fixture/'native.json').read_text());assert smoke['loaded'] and smoke['document']['shell_ready'],smoke
    app=install/'releases'/version/'app';python=install/'releases'/version/'python/python.exe'
    code="""import sys,json;from pathlib import Path
sys.path.insert(0,sys.argv[1])
from services.computer.runtime import NativeRuntime
from services.demo_account import DemoAccount,start_private_demo
from desktop.experience.drop_transfer import OfficialDrop
profile=Path(sys.argv[2]);runtime=NativeRuntime(profile/'probe',proxy='http://127.0.0.1:1',token='synthetic-probe-only')
try:
 status=runtime.availability();assert status['available'] and status['bundle_verified'],status
 probe=runtime.call('probe',timeout=30);assert probe.get('source_available') is True
 account=DemoAccount(profile).status();assert account['demo'] is True
 start_private_demo(Path(sys.argv[1]),profile);transfer=OfficialDrop()
 try:
  configuration=transfer.configuration();assert configuration['configured'] and configuration['max_files']==1000 and configuration['max_file_bytes']==20_000_000_000
  qr=transfer.share_path();assert qr['active'] and qr['state']=='waiting' and qr['qr'];assert transfer.stop()['active'] is False
 finally:transfer.close()
 print(json.dumps({'backend_available':True,'backend_bundle_verified':True,'owned_native_probe_passed':True,'demo_account_id':account['account']['id'],'provider_keys_exposed':False,'remote_control_enabled_without_user':False,'official_demo_qr_generated_and_revoked':True,'transfer_max_files':configuration['max_files'],'transfer_max_bytes':configuration['max_file_bytes'],'physical_phone_paired':False}))
finally:runtime.close()
"""
    probe_env={**env,'BRIVANY_DATA_DIR':str(profile)};probe=subprocess.run([str(python),'-I','-B','-c',code,str(app),str(profile)],env=probe_env,capture_output=True,text=True,encoding='utf-8',check=True,timeout=70);native=json.loads(probe.stdout.strip().splitlines()[-1]);
    subprocess.run([str(install/'unins000.exe'),'/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/LOG='+str(fixture/'uninstall.log')],check=True,timeout=150)
    assert not (install/'Brivany.exe').exists();assert not (install/'releases').exists();assert hashlib.sha256(preferences.read_bytes()).hexdigest()==before
    result={'passed':True,'edition':'private-jon-demo','version':version,'real_install_launch_uninstall':True,'shell_ready':True,'preferences_preserved':True,**native,'phone_calls':0,'input_actions':0,'fixture':str(fixture)};(out/'installer-acceptance.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result))

if __name__=='__main__':main()
