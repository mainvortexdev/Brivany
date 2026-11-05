"""Inspect a device IPA or a downloaded artifact ZIP without extracting it.

Checks packaging, Mach-O arm64, absence of signatures, required privacy usage
strings and common credential markers. This cannot certify runtime behavior,
all possible secrets, an Apple signature, or installation on a physical device.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import plistlib
import re
import struct
import zipfile

MAX_ARCHIVE_BYTES=512*1024*1024
APP_ROOT='Payload/Brivany.app/'
PERMISSIONS=('NSMicrophoneUsageDescription','NSSpeechRecognitionUsageDescription','NSCameraUsageDescription')
SECRET_MARKERS=(
    re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    re.compile(rb'\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}'),
    re.compile(rb'\bAIza[A-Za-z0-9_-]{30,}'),
    re.compile(rb'\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}'),
    re.compile(rb'\bsk_live_[A-Za-z0-9]{16,}'),
    re.compile(rb'BRIVANY_(?:META|MUSE|CARTESIA|OPENAI)_API_KEY'),
)


class VerificationError(ValueError):pass


def check_archive(archive):
    entries=archive.infolist()
    if len({item.filename for item in entries})!=len(entries):raise VerificationError('El paquete contiene rutas duplicadas.')
    if sum(item.file_size for item in entries)>MAX_ARCHIVE_BYTES:raise VerificationError('El paquete supera el límite de inspección.')
    for item in entries:
        name=item.filename;path=PurePosixPath(name)
        if '\\' in name or name.startswith('/') or '..' in path.parts or item.flag_bits&1:raise VerificationError('El paquete contiene una ruta o entrada no admitida.')
        # IPA resources may not escape verification through a Unix symbolic link.
        if (item.external_attr>>16)&0o170000==0o120000:raise VerificationError('El paquete contiene un enlace simbólico no admitido.')
    if archive.testzip() is not None:raise VerificationError('La integridad ZIP del paquete falló.')
    return entries


def macho_arm64_unsigned(raw):
    if len(raw)<32 or raw[:4]!=bytes.fromhex('cffaedfe'):raise VerificationError('El ejecutable no es Mach-O de 64 bits little-endian.')
    _,cpu,_,kind,ncmds,command_bytes,_,_=struct.unpack_from('<8I',raw)
    if cpu!=0x0100000C or kind!=2:raise VerificationError('Se esperaba un ejecutable arm64 para iPhone.')
    if command_bytes>len(raw)-32 or ncmds>command_bytes//8:raise VerificationError('Las órdenes Mach-O no son válidas.')
    offset=32
    for _ in range(ncmds):
        if offset+8>32+command_bytes:raise VerificationError('Las órdenes Mach-O están truncadas.')
        command,size=struct.unpack_from('<II',raw,offset)
        if size<8 or offset+size>32+command_bytes:raise VerificationError('Las órdenes Mach-O están truncadas.')
        if command==0x1D:raise VerificationError('El ejecutable contiene LC_CODE_SIGNATURE; no es el artefacto sin firmar esperado.')
        offset+=size
    if offset!=32+command_bytes:raise VerificationError('El tamaño de órdenes Mach-O no coincide.')


def verify(artifact,expected_version=None):
    if artifact.stat().st_size>MAX_ARCHIVE_BYTES:raise VerificationError('El archivo supera el límite de inspección.')
    data=artifact.read_bytes()
    with zipfile.ZipFile(io.BytesIO(data)) as outer:
        entries=check_archive(outer)
        if APP_ROOT+'Info.plist' not in outer.namelist():
            candidates=[item for item in entries if PurePosixPath(item.filename).name=='Brivany-unsigned.ipa']
            if len(candidates)!=1:raise VerificationError('Se esperaba un único Brivany-unsigned.ipa.')
            data=outer.read(candidates[0])
    with zipfile.ZipFile(io.BytesIO(data)) as package:
        entries=check_archive(package);names={item.filename for item in entries}
        if APP_ROOT+'Info.plist' not in names:raise VerificationError('Falta Payload/Brivany.app/Info.plist.')
        roots={PurePosixPath(name).parts[1] for name in names if name.startswith('Payload/') and len(PurePosixPath(name).parts)>1}
        if roots!={'Brivany.app'}:raise VerificationError('El IPA incluye una aplicación distinta o adicional.')
        info=plistlib.loads(package.read(APP_ROOT+'Info.plist'))
        if not isinstance(info,dict) or info.get('CFBundleIdentifier')!='es.ProjectFixture.brivany' or info.get('CFBundlePackageType')!='APPL':raise VerificationError('Identidad de aplicación incorrecta.')
        version=info.get('CFBundleShortVersionString');build=info.get('CFBundleVersion')
        if not isinstance(version,str) or not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',version) or not isinstance(build,str) or not build:raise VerificationError('Versión o compilación no válida.')
        if expected_version is not None and version!=expected_version:raise VerificationError('La versión no coincide con la entrega solicitada.')
        if info.get('DTPlatformName')!='iphoneos' or 'iPhoneOS' not in info.get('CFBundleSupportedPlatforms',[]):raise VerificationError('El paquete no corresponde al SDK de dispositivo iPhone.')
        if 1 not in info.get('UIDeviceFamily',[]):raise VerificationError('El paquete no admite iPhone.')
        minimum=info.get('MinimumOSVersion','')
        if not isinstance(minimum,str) or not re.fullmatch(r'[0-9]+(?:\.[0-9]+){0,2}',minimum) or int(minimum.split('.')[0])<17:raise VerificationError('La versión mínima debe ser iOS 17 o posterior.')
        for key in PERMISSIONS:
            value=info.get(key)
            if not isinstance(value,str) or len(value.strip())<12 or any(marker in value.lower() for marker in ('todo','placeholder','replace me')):raise VerificationError('Falta una descripción concreta de privacidad: '+key)
        if info.get('NSAppTransportSecurity',{}).get('NSAllowsArbitraryLoads') is True:raise VerificationError('No se admite desactivar globalmente la seguridad HTTPS.')
        executable=info.get('CFBundleExecutable')
        if not isinstance(executable,str) or not re.fullmatch(r'[A-Za-z0-9_.-]+',executable) or executable in {'.','..'}:raise VerificationError('Nombre de ejecutable no válido.')
        macho_arm64_unsigned(package.read(APP_ROOT+executable))
        inspected=0
        for entry in entries:
            if entry.is_dir():continue
            path=PurePosixPath(entry.filename)
            if '_CodeSignature' in path.parts or path.name=='embedded.mobileprovision':raise VerificationError('El IPA incluye firma o perfil de aprovisionamiento.')
            if path.name.startswith('.env'):raise VerificationError('El IPA incluye un archivo de entorno.')
            raw=package.read(entry);inspected+=len(raw)
            if any(pattern.search(raw) for pattern in SECRET_MARKERS):raise VerificationError('Se detectó un marcador de credencial; no se publica su contenido.')
    return {'passed':True,'bundle_id':'es.ProjectFixture.brivany','version':version,'build':build,'minimum_ios':minimum,
        'architecture':'arm64','platform':'iphoneos','unsigned':True,'permissions_verified':list(PERMISSIONS),
        'common_secret_marker_scan':'passed','inspected_bytes':inspected,'ipa_bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),
        'requires_signing':True,'physical_installation_verified':False,'runtime_functionality_verified':False}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('artifact',type=Path)
    parser.add_argument('--expected-version');parser.add_argument('--report',type=Path);args=parser.parse_args()
    try:
        report=verify(args.artifact.resolve(),args.expected_version)
        if args.report:
            args.report.parent.mkdir(parents=True,exist_ok=True);args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(report,ensure_ascii=False));return 0
    except (VerificationError,OSError,ValueError,KeyError,TypeError,AttributeError,OverflowError,
            zipfile.BadZipFile,zipfile.LargeZipFile,plistlib.InvalidFileException,struct.error):
        # All diagnostics are fixed and cannot copy credential matches, private
        # archive data or untrusted paths into CI logs.
        print(json.dumps({'passed':False,'error':'El paquete iPhone no superó la verificación de estructura, arquitectura, privacidad o credenciales.'},ensure_ascii=False));return 1


if __name__=='__main__':raise SystemExit(main())
