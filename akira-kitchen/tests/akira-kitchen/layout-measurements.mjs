// Rasterize just the food SVG over transparency, not its transparent DOM box.
// Alpha > 16 agrees with scripts/measure-media-geometry.py. Values are CSS px.
export async function measureLayout(page) {
  return page.evaluate(async () => {
    const stage = document.querySelector('[data-screen]'), scale = stage.getBoundingClientRect().width / 1448;
    const rect = el => { const r = el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
    const dataURL = blob => new Promise(resolve => { const reader=new FileReader(); reader.onload=()=>resolve(reader.result); reader.readAsDataURL(blob); });
    async function paint(svg) {
      const r=rect(svg), clone=svg.cloneNode(true), dpr=2;
      clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
      clone.setAttribute('width',String(r.width*dpr)); clone.setAttribute('height',String(r.height*dpr));
      clone.removeAttribute('class'); clone.removeAttribute('style');
      for(const im of clone.querySelectorAll('image')) {
        const href=im.getAttribute('href') || im.getAttributeNS('http://www.w3.org/1999/xlink','href');
        if(href && !href.startsWith('data:')) im.setAttribute('href',await dataURL(await (await fetch(href)).blob()));
      }
      const img=new Image(); img.src=await dataURL(new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml'}));
      await img.decode();
      const canvas=document.createElement('canvas'); canvas.width=Math.ceil(r.width*dpr); canvas.height=Math.ceil(r.height*dpr);
      const ctx=canvas.getContext('2d',{willReadFrequently:true}); ctx.drawImage(img,0,0,r.width*dpr,r.height*dpr);
      const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
      let left=canvas.width,top=canvas.height,right=-1,bottom=-1;
      for(let y=0;y<canvas.height;y++) for(let x=0;x<canvas.width;x++) if(pixels[(y*canvas.width+x)*4+3]>16) {
        left=Math.min(left,x); top=Math.min(top,y); right=Math.max(right,x); bottom=Math.max(bottom,y);
      }
      if(right<left) throw Error('Empty painted food SVG');
      const p={x:r.x+left/dpr,y:r.y+top/dpr,width:(right-left+1)/dpr,height:(bottom-top+1)/dpr};
      const card=svg.closest('[class*="homeCard"]');
      return {source:svg.dataset.croppedArt || svg.dataset.dish || 'process',box:r,paint:p,
        stageWidthPercent:p.width/1024*100,stageHeightPercent:p.height/768*100,
        center:{x:p.x+p.width/2,y:p.y+p.height/2},centerOffset:{x:p.x+p.width/2-512,y:p.y+p.height/2-384},
        cardWidthPercent:card?p.width/rect(card).width*100:null};
    }
    const candidates=stage.querySelector('[data-process]')
      ? [stage.querySelector('[data-process] svg')]
      : stage.dataset.screen==='1' ? [...stage.querySelectorAll('[class*="homeCard"] [data-cropped-art]')]
      : [...stage.querySelectorAll('[data-dish]')].slice(0,1);
    const foods=[]; for(const svg of candidates.filter(Boolean)) foods.push(await paint(svg));
    const controls=[...stage.querySelectorAll('button')].filter(e=>rect(e).width>0).map(e=>({
      label:e.getAttribute('aria-label')||e.textContent,kind:e.dataset.process?'process':e.dataset.foodDrag?'shelf':e.dataset.piece?'piece':e.className,
      css:rect(e),stage:{width:rect(e).width/scale,height:rect(e).height/scale}
    }));
    const regions={}; for(const [key,selector] of Object.entries({mission:'[class*="missionBubble"]',steps:'[class*="steps"]',shelf:'[data-shelf]',flavors:'[class*="flavors"]',chef:'[class*="chefWindow"]'})) {
      const el=stage.querySelector(selector); if(el) regions[key]=rect(el);
    }
    return {scale,foods,controls,regions};
  });
}
