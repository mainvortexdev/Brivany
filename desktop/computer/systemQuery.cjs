'use strict';
// The model composes queries over current data; it cannot supply shell code.
const SOURCES={
 processes:{command:'Get-Process',fields:['Id','ProcessName','CPU','WorkingSet64','PrivateMemorySize64','HandleCount','Responding','StartTime']},
 services:{command:'Get-Service',fields:['Name','DisplayName','Status','StartType','CanStop','ServiceType']},
 connections:{command:'Get-NetTCPConnection',fields:['LocalAddress','LocalPort','RemoteAddress','RemotePort','State','OwningProcess']},
 udp:{command:'Get-NetUDPEndpoint',fields:['LocalAddress','LocalPort','OwningProcess']},
 adapters:{command:'Get-NetAdapter',fields:['Name','InterfaceDescription','Status','LinkSpeed','ifIndex']},
 volumes:{command:'Get-CimInstance',className:'Win32_LogicalDisk',fields:['DeviceID','VolumeName','Size','FreeSpace','DriveType','FileSystem']},
 processors:{command:'Get-CimInstance',className:'Win32_Processor',fields:['Name','NumberOfCores','NumberOfLogicalProcessors','MaxClockSpeed','LoadPercentage','VirtualizationFirmwareEnabled']},
 memory:{command:'Get-CimInstance',className:'Win32_PhysicalMemory',fields:['Capacity','Speed','Manufacturer','PartNumber']},
 printers:{command:'Get-CimInstance',className:'Win32_Printer',fields:['Name','Default','WorkOffline','PrinterStatus','Shared']},
 battery:{command:'Get-CimInstance',className:'Win32_Battery',fields:['Name','EstimatedChargeRemaining','BatteryStatus','EstimatedRunTime']},
 devices:{command:'Get-CimInstance',className:'Win32_PnPEntity',fields:['Name','PNPClass','Status','ConfigManagerErrorCode']},
 computer:{command:'Get-CimInstance',className:'Win32_ComputerSystem',fields:['Manufacturer','Model','TotalPhysicalMemory','NumberOfLogicalProcessors','HypervisorPresent']},
 operating_system:{command:'Get-CimInstance',className:'Win32_OperatingSystem',fields:['Caption','Version','OSArchitecture','LastBootUpTime','TotalVisibleMemorySize','FreePhysicalMemory']}
};
function validate(query){
 if(!query||typeof query!=='object'||Array.isArray(query)||Object.keys(query).some(k=>!['source','fields','where','sort','limit','aggregate'].includes(k)))throw Error('Consulta no admitida.');
 const source=SOURCES[query.source];if(!source)throw Error('Fuente no admitida.');
 if(!Array.isArray(query.fields)||!query.fields.length||query.fields.length>8||query.fields.some(f=>!source.fields.includes(f))||new Set(query.fields).size!==query.fields.length)throw Error('Campos no admitidos.');
 if(!Number.isInteger(query.limit)||query.limit<1||query.limit>40)throw Error('Límite no válido.');
 if(!Array.isArray(query.where)||query.where.length>5)throw Error('Filtros no válidos.');
 for(const f of query.where)if(!f||Object.keys(f).sort().join(',')!=='op,property,value'||!source.fields.includes(f.property)||!['eq','ne','gt','lt','ge','le','contains','starts_with'].includes(f.op)||!['string','number','boolean'].includes(typeof f.value)||typeof f.value==='number'&&!Number.isFinite(f.value)||typeof f.value==='string'&&f.value.length>200)throw Error('Filtro no admitido.');
 if(query.sort!==null&&(!query.sort||Object.keys(query.sort).sort().join(',')!=='descending,property'||!source.fields.includes(query.sort.property)||typeof query.sort.descending!=='boolean'))throw Error('Orden no admitido.');
 if(query.aggregate!==null&&(!query.aggregate||Object.keys(query.aggregate).sort().join(',')!=='op,property'||!['count','sum','average','min','max'].includes(query.aggregate.op)||(query.aggregate.op==='count'?query.aggregate.property!==null:!source.fields.includes(query.aggregate.property))))throw Error('Agregación no admitida.');
 return JSON.parse(JSON.stringify(query));
}
function queryScript(input){
 const query=validate(input),source=SOURCES[query.source];
 const encoded=Buffer.from(JSON.stringify({query,source}),'utf8').toString('base64');
 return `$spec=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json
$q=$spec.query;$source=$spec.source;$ErrorActionPreference='Stop'
$properties=@(@($q.fields)+@($q.where | ForEach-Object {$_.property})+@($q.sort.property)+@($q.aggregate.property) | Where-Object {$_} | Select-Object -Unique)
if($source.command -eq 'Get-CimInstance'){$all=@(Get-CimInstance -ClassName $source.className | Select-Object -First 5000 -Property $properties)}
else{$all=@(& $source.command -ErrorAction Stop | Select-Object -First 5000 -Property $properties)}
$rows=$all
foreach($filter in $q.where){$rows=@($rows | Where-Object {$value=$_.PSObject.Properties[$filter.property].Value;switch($filter.op){'eq' {$value -eq $filter.value};'ne' {$value -ne $filter.value};'gt' {$value -gt $filter.value};'lt' {$value -lt $filter.value};'ge' {$value -ge $filter.value};'le' {$value -le $filter.value};'contains' {([string]$value).IndexOf([string]$filter.value,[StringComparison]::OrdinalIgnoreCase) -ge 0};'starts_with' {([string]$value).StartsWith([string]$filter.value,[StringComparison]::OrdinalIgnoreCase)}}})}
$matching=$rows.Count
if($null -ne $q.sort){$rows=@($rows | Sort-Object -Property $q.sort.property -Descending:$q.sort.descending)}
$aggregate=$null
if($null -ne $q.aggregate){$aggregate=@{op=$q.aggregate.op;property=$q.aggregate.property};if($q.aggregate.op -eq 'count'){$aggregate.value=$matching}else{$measure=$rows | Measure-Object -Property $q.aggregate.property -Sum -Average -Minimum -Maximum;$field=@{sum='Sum';average='Average';min='Minimum';max='Maximum'}[$q.aggregate.op];$aggregate.value=$measure.$field}}
$output=@($rows | Select-Object -First $q.limit | ForEach-Object {$row=[ordered]@{};foreach($field in $q.fields){$v=$_.PSObject.Properties[$field].Value;if($v -is [Enum]){$v=$v.ToString()}elseif($v -is [DateTime]){$v=$v.ToUniversalTime().ToString('o')}elseif($null -ne $v -and $v -isnot [ValueType]){$v=[string]$v;if($v.Length -gt 240){$v=$v.Substring(0,240)}};$row[$field]=$v};$row})
@{verified=$true;source_command=$source.command;source=$q.source;observed_at=[DateTime]::UtcNow.ToString('o');matching_rows=$matching;truncated=($matching -gt $q.limit -or $all.Count -eq 5000);rows=$output;aggregate=$aggregate} | ConvertTo-Json -Depth 7 -Compress`;
}
module.exports={SOURCES,validate,queryScript};
