document.querySelectorAll('.copy').forEach(button=>button.addEventListener('click',async()=>{
 const content=button.closest('.codebox').querySelector('code').textContent;
 try{await navigator.clipboard.writeText(content);button.textContent='已复制';setTimeout(()=>button.textContent='复制',1600)}
 catch(e){const range=document.createRange();range.selectNodeContents(button.closest('.codebox').querySelector('code'));const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);button.textContent='已选中，请 Ctrl+C'}
}));
document.querySelectorAll('input[type=checkbox]').forEach((input,i)=>{
 input.disabled=false;input.setAttribute('aria-label',input.parentElement.textContent.trim());
 try{input.checked=localStorage.getItem('claude-handbook-check-'+i)==='1'}catch(e){}
 input.addEventListener('change',()=>{try{localStorage.setItem('claude-handbook-check-'+i,input.checked?'1':'0')}catch(e){}});
});
const links=[...document.querySelectorAll('nav a')];
if(location.protocol==='file:'){
 document.querySelectorAll('.download[href="claude-windows-handbook.zip"],.download[href="claude-guide.md"]').forEach(link=>link.hidden=true);
}
const observer=new IntersectionObserver(entries=>{entries.forEach(entry=>{if(entry.isIntersecting){links.forEach(a=>a.classList.toggle('active',a.hash==='#'+entry.target.id))}})},{rootMargin:'-10% 0px -65% 0px'});
document.querySelectorAll('main section').forEach(section=>observer.observe(section));


document.getElementById("handbook-print")?.addEventListener("click",()=>window.print());
