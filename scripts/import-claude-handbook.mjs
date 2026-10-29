// Import an already-authored local article. Does not execute scripts or fetch URLs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=process.argv[2];
if(!source)throw Error('Supply the local claude-guide article folder.');
const assets=path.join(project,'src/BehindRose.Desktop/Assets/workbench');
const snapshot=path.join(project,'docs/claude-handbook');
fs.mkdirSync(path.join(snapshot,'scripts'),{recursive:true});
fs.mkdirSync(path.join(assets,'claude-handbook-images'),{recursive:true});
fs.mkdirSync(path.join(assets,'claude-handbook-scripts'),{recursive:true});
fs.copyFileSync(path.join(source,'manual-source.md'),path.join(snapshot,'handbook.md'));
const original=JSON.parse(fs.readFileSync(path.join(source,'article.json'),'utf8'));
delete original.page_url;
fs.writeFileSync(path.join(snapshot,'experience-summary.json'),JSON.stringify(original,null,2)+'\n');
const meta=JSON.parse(fs.readFileSync(path.join(source,'manual.json'),'utf8'));
const figures=meta.figures.map(({key,file,caption,note,source})=>({id:key,file,caption,note,source}));
fs.writeFileSync(path.join(snapshot,'figures.json'),JSON.stringify(figures,null,2)+'\n');
for(const f of figures)fs.copyFileSync(path.join(source,'images',f.file),path.join(assets,'claude-handbook-images',f.file));
const definitions=[
 {name:'Launch-Claude.ps1',label:'文章启动器',description:'第09节原脚本：手动执行时先检查本机端口，再以进程代理启动 Claude；退出后恢复环境。下载不会执行。',network:true},
 {name:'Backup-ClaudeLocal.ps1',label:'完整本地配置备份脚本',description:'第10节原脚本：手动执行时复制 .claude 及现有 .claude.json。可能含凭据；不备份项目源码或云端聊天。',network:false},
 {name:'Test-ClaudeNetwork.ps1',label:'连接检查脚本（会联网）',description:'第04/09节原脚本：手动执行会查询出口并访问 Claude。当前仅下载，不会运行或测试网络。',network:true}
];
const downloads=definitions.map(item=>{
 const code=fs.readFileSync(path.join(source,'scripts',item.name),'utf8');
 fs.writeFileSync(path.join(snapshot,'scripts',item.name),code);
 fs.writeFileSync(path.join(assets,'claude-handbook-scripts',item.name),'\ufeff'+code.replace(/^\ufeff/,''));
 return {...item,code};
});
fs.writeFileSync(path.join(project,'frontend/src/claude-handbook-downloads.ts'),
 '// Article scripts are data for explicit copy/download only; never evaluated by the app.\nexport const claudeHandbookDownloads = '+JSON.stringify(downloads,null,2)+' as const;\n');
let html=fs.readFileSync(path.join(source,'claude-guide.html'),'utf8');
const css=html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
const js=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if(!css||!js)throw Error('Expected self-contained source article.');
fs.writeFileSync(path.join(assets,'claude-handbook.css'),css);
fs.writeFileSync(path.join(assets,'claude-handbook-ui.js'),js+'\ndocument.getElementById("handbook-print")?.addEventListener("click",()=>window.print());\n');
html=html.replace(/<style>[\s\S]*?<\/style>/,'<link rel="stylesheet" href="/claude-handbook.css">')
 .replace(/<script>[\s\S]*?<\/script>/,'<script src="/claude-handbook-ui.js"></script>')
 .replace('onclick="window.print()"','id="handbook-print"');
fs.writeFileSync(path.join(assets,'claude-handbook.html'),html);
for(const name of ['claude-windows-handbook.zip','claude-guide.md'])fs.copyFileSync(path.join(source,name),path.join(assets,name));
console.log(JSON.stringify({sourceSections:13,figures:figures.length,scriptFiles:downloads.length,articleBytes:Buffer.byteLength(html)}));
