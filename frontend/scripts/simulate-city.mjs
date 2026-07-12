// Lightweight balance harness for the digital-city prototype.
// It intentionally models strategy-level choices, not the React UI.
const ASSETS = [
  [6,2,0,"legal"],[5,2,0,"legal"],[7,1,2,"media"],[8,3,1,"finance"],[9,3,1,"finance"],[6,2,1,"office"],
  [9,4,0,"production"],[8,3,1,"energy"],[7,3,0,"logistics"],[8,3,1,"ai"],[6,2,0,"grey"],[7,2,2,"data"],
  [8,2,2,"contract"],[7,2,1,"security"],[6,1,2,"lobby"],[4,2,0,"grey"],[5,2,1,"grey"],[6,3,0,"grey"],
];
const STRATEGIES = ["investor","political","balanced","grey"];
function rng(seed){let x=seed|0;return()=>((x=Math.imul(1664525,x)+1013904223|0)>>>0)/4294967296}
function game(seed, cfg={}) {
  const R=rng(seed), ps=STRATEGIES.map(s=>({s,m:10,i:2,sc:0,role:false,a:[],projects:0}));
  for(let round=1;round<=10;round++) { for(const p of ps){
    for(let ap=0;ap<3;ap++){
      const affordable=ASSETS.filter(a=>a[0]<=p.m);
      const managed=p.a.filter(a=>!a.auto).length;
      const best=affordable.sort((a,b)=>(b[1]/b[0]+b[2]*.08)-(a[1]/a[0]+a[2]*.08))[0];
      const bestInfluence=affordable.filter(a=>a[2]>0).sort((a,b)=>(b[2]/b[0]+b[1]*.03)-(a[2]/a[0]+a[1]*.03))[0];
      if(p.s==="political" && !p.role && p.i>=3 && p.a.length>=2){p.i-=3;p.role=true;continue}
      if(p.s==="grey" && !p.role && p.i>=3 && p.a.some(a=>a[3]==="grey")){p.i-=3;p.role=true;continue}
      if(p.s==="grey" && p.a.some(a=>a[3]==="grey")){
        const ok=R()<Math.min(.9,.45+(p.role?.2:0)+Math.min(.1,p.a.filter(a=>a[3]==="grey").length*.05));if(ok)p.m+=(cfg.greyReward??6)+(p.role?1:0);else p.sc+=2;continue
      }
      if((p.s==="investor"||p.s==="balanced") && best && managed<3){p.m-=best[0];p.i+=best[2];p.a.push([...best]);continue}
      if(p.s==="political" && bestInfluence && managed<3){p.m-=bestInfluence[0];p.i+=bestInfluence[2];p.a.push([...bestInfluence]);continue}
      if(p.s==="grey" && best){const grey=affordable.filter(a=>a[3]==="grey").sort((a,b)=>b[1]/b[0]-a[1]/a[0])[0];const a=grey||best;p.m-=a[0];p.i+=a[2];p.a.push([...a]);continue}
      if(p.s==="investor" && p.a.length && p.m>=4){const a=p.a.find(a=>!a.auto);if(a){p.m-=4;a.auto=true;continue}}
      if(p.s==="political" && p.i>=3){p.i-=3;p.projects++;continue}
      if(p.s==="political" && p.m>=2){p.m-=2;p.i+=2;continue}
      if(p.s==="balanced" && !p.role && p.i>=3){p.i-=3;p.role=true;continue}
      p.m+=2;
    }
    if(p.sc>=3){if(p.role)p.role=false;else p.m=Math.max(0,p.m-3);p.sc=0}
  }
  for(const p of ps){let cap=3,income=0;for(const a of p.a){if(a.auto||cap-->0)income+=a[1]}p.m+=income}
  }
  const score=p=>p.m+p.i+p.a.reduce((s,a)=>s+Math.floor(a[0]/2)+(a.auto?2:0),0)+p.projects*(cfg.projectValue??4)+(p.role?3:0)-p.sc*2;
  const ranked=ps.map(p=>({...p,score:score(p)})).sort((a,b)=>b.score-a.score);
  return ranked;
}
function batch(n,cfg={}){const wins=Object.fromEntries(STRATEGIES.map(s=>[s,0])),sum=Object.fromEntries(STRATEGIES.map(s=>[s,0]));for(let k=1;k<=n;k++){const r=game(k*7919,cfg);wins[r[0].s]++;for(const p of r)sum[p.s]+=p.score}return {games:n,wins:Object.fromEntries(STRATEGIES.map(s=>[s,+(wins[s]/n*100).toFixed(1)])),avgScore:Object.fromEntries(STRATEGIES.map(s=>[s,+(sum[s]/n).toFixed(1)]))}}
console.log(JSON.stringify({tuned:batch(10000,{greyReward:7,projectValue:6}),projects4:batch(10000,{greyReward:7,projectValue:4}),projects8:batch(10000,{greyReward:7,projectValue:8}),greyTooHigh:batch(10000,{greyReward:8,projectValue:6})},null,2));
