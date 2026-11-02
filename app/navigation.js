export class Navigation {
  constructor(root){
    this.root=root;this.items=Array.from(root.querySelectorAll('a')).map(element=>({element,text:element.textContent,alpha:1,target:1}));this.last=0;
    for(const item of this.items){item.element.addEventListener('pointerenter',()=>this.hover(item,true));item.element.addEventListener('pointerleave',()=>this.hover(item,false));item.element.addEventListener('focus',()=>this.hover(item,true));item.element.addEventListener('blur',()=>this.hover(item,false));item.element.setAttribute('aria-label',item.text);}
  }
  hover(item,over){item.from=item.alpha;item.target=over?.7:1;item.started=performance.now();item.duration=over?200:400;}
  update(now,delta,contactOpen){
    for(const item of this.items){
      const progress=Math.min(1,Math.max(0,(now-(item.started??0))/(item.duration??1)));
      item.alpha=(item.from??1)+(item.target-(item.from??1))*Math.sin(progress*Math.PI/2);item.element.style.opacity=item.alpha;
      item.element.style.transform=`translateY(${4.5*delta}px)`;
    }
    if(now-this.last<1000/12)return;this.last=now;
    for(const item of this.items){
      const text=item.text==='Contact'&&contactOpen?'CLOSE-X':item.text,letters=text.split('');
      const t=Math.min(1,Math.max(0,(1-item.alpha)/.3)),replacements=Math.floor(.2*delta)+.1*t*t*(3-2*t);
      for(let i=0;i<replacements;i++){const index=Math.floor(Math.random()*letters.length);if(!' /?,.'.includes(letters[index]))letters[index]='1234567890'[Math.floor(Math.random()*10)];}
      item.element.textContent=letters.join('');
    }
  }
}
