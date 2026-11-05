const test=require('node:test'),assert=require('node:assert/strict');
const {chooseObserved}=require('../desktop/computer/applicationChoice.cjs');
const {packageMetadataScript,packageLaunchScript}=require('../desktop/computer/installedApplications.cjs');
test('choose actual installation by display name, alias or executable basename',()=>{
 const word={id:'observed.word',name:'Word',executableName:'WINWORD.EXE'};
 assert.equal(chooseObserved('Word',[word]),word);assert.equal(chooseObserved('Microsoft Word',[word]),word);assert.equal(chooseObserved('winword.exe',[word]),word);
 assert.equal(chooseObserved('word.exe',[word]),null);assert.equal(chooseObserved('Word',[word,{...word,id:'different'}]),null);
 assert.equal(chooseObserved('chatgpt.exe',[{id:'OpenAI.Codex_x!App',name:'ChatGPT',executableName:'Codex.exe'}]),null);
});
test('package identifiers and launch code are fixed rather than model commands',()=>{
 const entry={id:'Fixture.App_publisher!App',name:'Fixture'};
 assert(packageMetadataScript(entry).includes('Get-AppxPackageManifest'));assert(packageLaunchScript(entry).includes('ActivateApplication(id,null,2'));
 for(const id of ['x; evil','..\\cmd.exe','https://x/','x!app\ncmd'])assert.throws(()=>packageLaunchScript({id,name:'Fixture'}));
});
