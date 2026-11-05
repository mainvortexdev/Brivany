'use strict';
const fold=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
function chooseObserved(request,candidates){
 const aliases={'microsoft word':'word','microsoft excel':'excel','microsoft powerpoint':'powerpoint','bloc de notas':'notepad'};
 const text=fold(request),target=aliases[text]||text;
 const rows=candidates.filter(row=>text.endsWith('.exe')?fold(row.executableName)===text:[fold(row.name),aliases[fold(row.name)],fold(row.executableName).replace(/\.exe$/,'')].includes(target));
 return rows.length===1?rows[0]:null;
}
module.exports={chooseObserved};
