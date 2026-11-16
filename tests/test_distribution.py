import base64,hashlib,json,os,tempfile,time,unittest,zipfile
from pathlib import Path
from unittest.mock import patch
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding,PublicFormat
from desktop.distribution import updater
from desktop.distribution.updater import canonical,verify_manifest,safe_extract,atomic_json,UpdateService

class UpdateTests(unittest.TestCase):
 def setUp(self):
  self.current=updater.VERSION
  major,minor,patch_number=map(int,self.current.split('.'));self.next=f'{major}.{minor}.{patch_number+1}'
  self.key=Ed25519PrivateKey.generate();self.trust={'public_key':base64.b64encode(self.key.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)).decode(),'manifest_url':'https://updates.brivany.vetsa.es/windows/stable.json'}
  self.p={'schema':1,'version':self.next,'channel':'stable','url':'https://updates.brivany.vetsa.es/windows/Brivany.zip','sha256':'a'*64,'size':100,'expanded_size':200,'published':1000,'expires':3000,'min_launcher':1}
 def envelope(self):return {'payload':self.p.copy(),'signature':base64.b64encode(self.key.sign(canonical(self.p))).decode()}
 def test_valid_signed_update(self):self.assertEqual(verify_manifest(self.envelope(),self.trust,now=2000)['version'],self.next)
 def test_modified_manifest_is_rejected(self):
  e=self.envelope();e['payload']['url']='https://updates.brivany.vetsa.es/windows/evil.zip'
  with self.assertRaises(ValueError):verify_manifest(e,self.trust,now=2000)
 def test_wrong_publisher_key_is_rejected(self):
  self.trust['public_key']=base64.b64encode(Ed25519PrivateKey.generate().public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)).decode()
  with self.assertRaises(ValueError):verify_manifest(self.envelope(),self.trust,now=2000)
 def test_expired_or_downgrade_rejected(self):
  with self.assertRaises(ValueError):verify_manifest(self.envelope(),self.trust,now=4000)
  self.p['version']='0.0.9'
  with self.assertRaises(ValueError):verify_manifest(self.envelope(),self.trust,now=2000)
 def test_off_origin_or_http_rejected(self):
  for url in ['https://example.org/windows/evil.zip','http://updates.brivany.vetsa.es/windows/a.zip','https://updates.brivany.vetsa.es/other/a.zip']:
   self.p['url']=url
   with self.assertRaises(ValueError):verify_manifest(self.envelope(),self.trust,now=2000)
 def test_size_limits(self):
  self.p['expanded_size']=4*1024**3
  with self.assertRaises(ValueError):verify_manifest(self.envelope(),self.trust,now=2000)
 def archive(self,root,entries):
  path=root/'release.zip'
  with zipfile.ZipFile(path,'w') as z:
   for name,raw in entries:z.writestr(name,raw)
  return path
 def test_extract_preserves_external_user_data(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);user=root/'User Data';user.mkdir();settings=user/'settings.json';settings.write_text('{"theme":"dark"}')
   z=self.archive(root,[('python/pythonw.exe',b'py'),('app/desktop/distribution/entry.py',b'app')]);safe_extract(z,root/'new',expected_size=5)
   self.assertEqual(settings.read_text(),'{"theme":"dark"}')
 def test_traversal_and_private_data_are_rejected(self):
  for name in ['../outside','app/../../outside','app/.env','app/.local/tokens','C:/outside','app\\outside','app/CON','app/a:stream']:
   with self.subTest(name=name),tempfile.TemporaryDirectory() as t:
    root=Path(t);z=self.archive(root,[(name,b'x')])
    with self.assertRaises(ValueError):safe_extract(z,root/'new',expected_size=1)
 def test_duplicate_case_and_symlinks_rejected(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);z=self.archive(root,[('app/a',b'a'),('app/A',b'b')])
   with self.assertRaises(ValueError):safe_extract(z,root/'new',expected_size=2)
 def test_expansion_limit_rejected(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);z=self.archive(root,[('app/a',b'123')])
   with self.assertRaises(ValueError):safe_extract(z,root/'new',expected_size=2)
 def test_atomic_selection(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t)/'current.json';atomic_json(p,{'version':self.current});atomic_json(p,{'version':self.next});self.assertEqual(json.loads(p.read_text())['version'],self.next);self.assertEqual(len(list(Path(t).iterdir())),1)
 def test_symlink_member_rejected(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);z=root/'release.zip'
   with zipfile.ZipFile(z,'w') as f:
    member=zipfile.ZipInfo('app/link');member.create_system=3;member.external_attr=0o120777<<16;f.writestr(member,'outside')
   with self.assertRaises(ValueError):safe_extract(z,root/'new',expected_size=7)
 def prepare_download(self,root):
  entries=[('python/pythonw.exe',b'py'),('app/desktop/distribution/entry.py',b'app'),('app/desktop/distribution/version.json',json.dumps({'version':self.next}).encode())]
  archive=self.archive(root,entries)
  self.p.update(size=archive.stat().st_size,expanded_size=sum(len(raw) for _,raw in entries),sha256=hashlib.sha256(archive.read_bytes()).hexdigest(),published=int(time.time())-5,expires=int(time.time())+3600)
  (root/'install/releases').mkdir(parents=True);atomic_json(root/'install/current.json',{'version':self.current})
  return archive,UpdateService(root/'install',root/'profile/updates',self.trust)
 def test_download_stage_and_pending_survive_restart(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);archive,service=self.prepare_download(root);envelope=self.envelope()
   with patch.object(updater,'fetch',return_value=json.dumps(envelope).encode()),patch.object(updater,'build_opener') as opener:
    opener.return_value.open.side_effect=lambda *a,**k:archive.open('rb')
    self.assertEqual(service.check()['state'],'available');self.assertEqual(service.stage()['state'],'ready')
   self.assertEqual(json.loads((root/'install/current.json').read_text())['version'],self.current)
   restored=UpdateService(root/'install',root/'profile/updates',self.trust)
   self.assertEqual(restored.status()['state'],'ready')
   with patch.object(updater,'fetch',side_effect=AssertionError('Must not discard a staged update')):self.assertEqual(restored.check()['state'],'ready')
   self.assertFalse(list((root/'profile/updates').glob('*.zip')))
 def test_tampered_download_leaves_current_and_profile_untouched(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);archive,service=self.prepare_download(root);self.p['sha256']='0'*64;service.manifest=self.envelope()
   preferences=root/'profile/settings.json';preferences.write_text('{"language":"es"}')
   with patch.object(updater,'build_opener') as opener:
    opener.return_value.open.side_effect=lambda *a,**k:archive.open('rb');self.assertEqual(service.stage()['state'],'error')
   self.assertEqual(json.loads((root/'install/current.json').read_text())['version'],self.current);self.assertEqual(preferences.read_text(),'{"language":"es"}')
   self.assertFalse(list((root/'profile/updates').glob('*.zip')));self.assertFalse(list((root/'install/releases').iterdir()))
 def test_invalid_package_cleans_partial_staging(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);archive,service=self.prepare_download(root)
   with zipfile.ZipFile(archive,'a') as z:z.writestr('app/../../escape',b'x')
   self.p.update(size=archive.stat().st_size,sha256=hashlib.sha256(archive.read_bytes()).hexdigest());service.manifest=self.envelope()
   with patch.object(updater,'build_opener') as opener:
    opener.return_value.open.side_effect=lambda *a,**k:archive.open('rb');self.assertEqual(service.stage()['state'],'error')
   self.assertFalse(list((root/'install/releases').iterdir()));self.assertFalse((root/'escape').exists())
 @unittest.skipUnless(os.name=='nt','Windows update helper')
 def test_restart_health_and_failure_restore_selection(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);archive,service=self.prepare_download(root);service.manifest=self.envelope()
   with patch.object(updater,'build_opener') as opener:
    opener.return_value.open.side_effect=lambda *a,**k:archive.open('rb');self.assertEqual(service.stage()['state'],'ready')
   trustfile=root/'trust.json';atomic_json(trustfile,self.trust)
   def start(*a,**k):
    self.assertEqual(json.loads((root/'install/current.json').read_text())['version'],self.next)
    atomic_json(service.root/'healthy.json',{'version':self.next,'token':k['env']['BRIVANY_UPDATE_HEALTH_TOKEN']})
   with patch.object(updater,'TRUST',trustfile),patch.object(updater.subprocess,'Popen',side_effect=start):
    self.assertTrue(updater.apply(service.install,service.root,99999999,health_seconds=2))
   self.assertEqual(json.loads((service.root/'last-update.json').read_text())['outcome'],'updated');self.assertFalse((service.root/'pending.json').exists())
   atomic_json(service.install/'current.json',{'version':self.current});atomic_json(service.root/'pending.json',{'envelope':self.envelope(),'previous':self.current})
   with patch.object(updater,'TRUST',trustfile),patch.object(updater.subprocess,'Popen',side_effect=OSError('simulated failed executable')):
    self.assertFalse(updater.apply(service.install,service.root,99999999,health_seconds=0))
   self.assertEqual(json.loads((service.install/'current.json').read_text())['version'],self.current);self.assertFalse((service.root/'pending.json').exists())
   self.assertEqual(UpdateService(service.install,service.root,self.trust).status()['state'],'recovered')
 @unittest.skipUnless(os.name=='nt','Windows update helper')
 def test_unhealthy_new_version_rolls_back(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);archive,service=self.prepare_download(root);trustfile=root/'trust.json';atomic_json(trustfile,self.trust)
   atomic_json(service.root/'pending.json',{'envelope':self.envelope(),'previous':self.current})
   with patch.object(updater,'TRUST',trustfile),patch.object(updater.subprocess,'Popen'):
    self.assertFalse(updater.apply(service.install,service.root,99999999,health_seconds=0))
   self.assertEqual(json.loads((service.install/'current.json').read_text())['version'],self.current);self.assertFalse((service.root/'pending.json').exists())

if __name__=='__main__':unittest.main()
