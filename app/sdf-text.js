export function sdfText(font,text,size,{lineHeight=1.4,width=Infinity,align='left',letterSpacing=0}={}){
  const glyphs=new Map(font.chars.map(glyph=>[glyph.char,glyph])),kerning=new Map(font.kernings.map(item=>[item.first+':'+item.second,item.amount])),scale=size/font.common.base;
  const advance=text=>Array.from(text).reduce((value,char)=>value+glyphs.get(char).xadvance*scale+(char===' '?0:letterSpacing*size),0);
  const lines=[];for(const paragraph of text.split('\n')){let line='';for(const word of paragraph.split(' ')){const candidate=line+(line?' ':'')+word;if(line&&advance(candidate)>width){lines.push(line);line=word}else line=candidate}lines.push(line);}
  const position=[],uv=[],index=[];let letters=0,min=[Infinity,Infinity,0],max=[-Infinity,-Infinity,0];
  lines.forEach((line,lineIndex)=>{let cursor=-advance(line)*(align==='center'?.5:align==='right'?1:0),previous=null;
    for(const char of line){const glyph=glyphs.get(char);if(!glyph)throw Error('Missing original glyph '+char);if(previous!==null)cursor+=(kerning.get(previous.codePointAt(0)+':'+char.codePointAt(0))??0)*scale;previous=char;if(/\s/.test(char)){cursor+=glyph.xadvance*scale;continue;}
      const x=cursor+glyph.xoffset*scale,y=.07*size-lineIndex*size*lineHeight-glyph.yoffset*scale,w=glyph.width*scale,h=glyph.height*scale,u=glyph.x/font.common.scaleW,v=1-glyph.y/font.common.scaleH,uw=glyph.width/font.common.scaleW,vh=glyph.height/font.common.scaleH;
      position.push(x,y-h,0,x,y,0,x+w,y-h,0,x+w,y,0);uv.push(u,v-vh,u,v,u+uw,v-vh,u+uw,v);const i=letters++*4;index.push(i,i+2,i+1,i+1,i+2,i+3);cursor+=glyph.xadvance*scale+letterSpacing*size;
      min[0]=Math.min(min[0],x);min[1]=Math.min(min[1],y-h);max[0]=Math.max(max[0],x+w);max[1]=Math.max(max[1],y);
    }
  });
  return{position:new Float32Array(position),uv:new Float32Array(uv),index:new Uint16Array(index),min,max,height:max[1]-min[1],lines:lines.length};
}
