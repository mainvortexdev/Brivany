"""Fresh, read-only hardware facts. No registry, serials, keys or account IDs."""
from datetime import datetime,timezone
import json
import os
from pathlib import Path
import sys
from .policy import TerminalError

WINDOWS_QUERY=r'''$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$os=Get-CimInstance Win32_OperatingSystem
$computer=Get-CimInstance Win32_ComputerSystem
$now=[DateTime]::UtcNow;$boot=$os.LastBootUpTime.ToUniversalTime()
$cpu=@(Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,VirtualizationFirmwareEnabled,VMMonitorModeExtensions,SecondLevelAddressTranslationExtensions)
$ram=@(Get-CimInstance Win32_PhysicalMemory | Select-Object Capacity,Speed)
$gpu=@(Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,CurrentHorizontalResolution,CurrentVerticalResolution)
$disks=@(Get-CimInstance Win32_DiskDrive | Select-Object Model,Size,MediaType)
$drives=@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,Size,FreeSpace)
[ordered]@{observed_at=$now.ToString('o');last_boot_utc=$boot.ToString('o');uptime_seconds=[math]::Floor(($now-$boot).TotalSeconds);os=@{name=$os.Caption;version=$os.Version;architecture=$os.OSArchitecture};computer=@{manufacturer=$computer.Manufacturer;model=$computer.Model;usable_memory_bytes=[long]$computer.TotalPhysicalMemory;logical_processors=[int]$computer.NumberOfLogicalProcessors;hypervisor_present=$computer.HypervisorPresent};cpu=$cpu;memory_modules=$ram;gpu=$gpu;disks=$disks;volumes=$drives} | ConvertTo-Json -Compress -Depth 5'''


def snapshot(executor,cancelled=None):
    if sys.platform!='win32':raise TerminalError('Esta consulta del hardware aún necesita su adaptador macOS; no se inventarán resultados.','terminal_platform_unavailable')
    host=Path(os.environ.get('SystemRoot','C:/Windows'))/'System32/WindowsPowerShell/v1.0/powershell.exe'
    receipt=executor.run('system.read_only_snapshot',str(host),['-NoLogo','-NoProfile','-NonInteractive','-Command',WINDOWS_QUERY],cwd=executor.root,cancelled=cancelled,timeout=40)
    executor.require_success(receipt);value=json.loads(receipt['output'])
    if type(value.get('uptime_seconds')) is not int or value['uptime_seconds']<0 or not isinstance(value.get('cpu'),list) or not value['cpu']:raise TerminalError('El sistema no devolvió datos suficientes para responder.')
    value.update(receipt_id=receipt['id'],verified=True,read_only=True,registry_access=False)
    value['uptime_basis']='Tiempo desde el último arranque del kernel comunicado por Windows; inicio rápido y suspensión pueden conservarlo.'
    return value


def answer(value,topic):
    if topic=='all':return {'title':'Estado del equipo','topic':'all','message':'\n'.join(answer(value,item)['message'] for item in ('uptime','virtualization','specifications')),'facts':value,'verified':True,'observed_at':value['observed_at']}
    if topic not in {'uptime','virtualization','specifications'}:raise TerminalError('Consulta del equipo inválida.')
    if topic=='uptime':
        seconds=value['uptime_seconds'];days,seconds=divmod(seconds,86400);hours,seconds=divmod(seconds,3600);minutes,seconds=divmod(seconds,60)
        duration=(str(days)+' días, ' if days else '')+f'{hours} h {minutes} min {seconds} s'
        message='Windows informa '+duration+' desde el último arranque del kernel. Inicio rápido o suspensión pueden conservar ese tiempo.'
    elif topic=='virtualization':
        cpus=value['cpu'];firmware=[r.get('VirtualizationFirmwareEnabled') for r in cpus];hypervisor=value['computer'].get('hypervisor_present')
        if all(r is True for r in firmware):message='La virtualización está habilitada en el firmware.'
        elif hypervisor is True:message='Hay un hipervisor activo. El sistema puede ocultar a la sesión las capacidades de virtualización del firmware.'
        elif all(r is False for r in firmware):message='Windows informa que la virtualización del firmware no está habilitada.'
        else:message='Windows no devolvió un estado concluyente de la virtualización del firmware.'
        message+=' Hipervisor activo: '+('sí.' if hypervisor is True else 'no.' if hypervisor is False else 'sin confirmar.')
    else:
        cpu=value['cpu'][0];ram=sum(int(r.get('Capacity') or 0) for r in value.get('memory_modules',[]))/1024**3
        memory=f'{ram:g} GiB' if ram>0 else 'sin confirmar'
        message=f"{value['computer']['manufacturer']} {value['computer']['model']}. {value['os']['name']} ({value['os']['architecture']}). {cpu['Name']}: {cpu['NumberOfCores']} núcleos y {cpu['NumberOfLogicalProcessors']} hilos. RAM instalada: {memory}."
        gpu=', '.join(r['Name'] for r in value.get('gpu',[]) if r.get('Name'))
        if gpu:message+=' Gráficos: '+gpu+'.'
        if value.get('disks'):message+=' Almacenamiento: '+', '.join(str(r.get('Model','Disco'))+' ('+str(round(int(r.get('Size') or 0)/10**9))+' GB)' for r in value['disks'])+'.'
    return {'title':{'uptime':'Tiempo encendido','virtualization':'Virtualización','specifications':'Especificaciones del equipo'}[topic],'topic':topic,'message':message,'facts':value,'verified':True,'observed_at':value['observed_at']}
