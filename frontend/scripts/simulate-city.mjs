// Balance harness for the current digital-city rules.
// All seats use the same situational evaluator as the browser bots: their
// buildings, rank, score gap and opponents' scandals determine their role.

const ROLE_IDS = ["capitalist", "politician", "journalist", "fraudster", "mafia", "military"];
const STRATEGIC_ROLES = ["capitalist", "politician", "fraudster", "mafia", "military"];
const DISTRICTS = ["residential", "business", "industrial", "tech", "government", "shadows"];
const CAPACITY_COST = { 3: 6, 4: 10, 5: 15 };
const ASSETS = [
  {id:"housing",d:"residential",cost:6,income:2,inf:0,tags:["legal"]},
  {id:"delivery",d:"residential",cost:5,income:2,inf:0,tags:["service"]},
  {id:"media",d:"residential",cost:7,income:1,inf:2,tags:["media"]},
  {id:"fund",d:"business",cost:8,income:3,inf:1,tags:["finance"]},
  {id:"bank",d:"business",cost:9,income:3,inf:1,tags:["finance"]},
  {id:"cowork",d:"business",cost:6,income:2,inf:1,tags:["office"]},
  {id:"robotics",d:"industrial",cost:9,income:4,inf:0,tags:["production"]},
  {id:"battery",d:"industrial",cost:8,income:3,inf:1,tags:["energy"]},
  {id:"logistics",d:"industrial",cost:7,income:3,inf:0,tags:["logistics"]},
  {id:"ai",d:"tech",cost:8,income:3,inf:1,tags:["ai"]},
  {id:"crypto",d:"tech",cost:6,income:2,inf:0,tags:["crypto","grey"]},
  {id:"data",d:"tech",cost:7,income:2,inf:2,tags:["data"]},
  {id:"contract",d:"government",cost:8,income:2,inf:2,tags:["contract"]},
  {id:"security",d:"government",cost:7,income:2,inf:1,tags:["security"]},
  {id:"lobby",d:"government",cost:6,income:1,inf:2,tags:["lobby"]},
  {id:"cash",d:"shadows",cost:4,income:2,inf:0,tags:["grey"]},
  {id:"market",d:"shadows",cost:5,income:2,inf:1,tags:["grey"]},
  {id:"datacenter",d:"shadows",cost:6,income:3,inf:0,tags:["grey","tech"]},
];
const EVENTS = [
  {id:"ai_boom",d:"tech",mult:2},{id:"housing",d:"residential",mult:2},{id:"orders",d:"industrial",mult:2},
  {id:"election",d:"government"},{id:"crypto_winter",d:"tech",discount:2},{id:"festival",d:"residential",discount:1},
  {id:"amnesty",d:"shadows",mult:2},{id:"rates",d:"business",discount:-1},
];

function rng(seed){let x=seed|0;return()=>((x=Math.imul(1664525,x)+1013904223|0)>>>0)/4294967296}
function shuffle(items,R){const out=[...items];for(let i=out.length-1;i>0;i--){const j=Math.floor(R()*(i+1));[out[i],out[j]]=[out[j],out[i]]}return out}
function count(p,d){return p.assets.filter(a=>a.d===d).length}
function synergy(p,d){return count(p,d)>=4?2:count(p,d)>=2?1:0}
function hasRole(p,r){return p.role===r}
function roleSupports(p,d){return (p.role==="capitalist"&&d==="business")||(p.role==="politician"&&d==="residential")||(p.role==="mafia"&&d==="shadows")||(p.role==="fraudster"&&d==="tech")||(p.role==="military"&&d==="industrial")}
function special(p,a,event){
  const has=d=>count(p,d)>0||(d==="business"&&p.role==="capitalist")||(d==="government"&&p.role==="politician");
  if(a.id==="delivery"&&event.id==="festival")return 1;
  if(a.id==="media"&&p.role==="journalist")return Math.min(2,p.sc);
  if(a.id==="fund")return count(p,"tech");
  if(a.id==="bank")return Math.max(0,count(p,"business")-1+(p.role==="capitalist"?1:0));
  if(a.id==="cowork"&&has("residential"))return 1;
  if(a.id==="battery"&&has("residential"))return 1;
  if(a.id==="ai"&&has("business"))return 1;
  return 0;
}
function synergyIncome(p,a,event){return (synergy(p,a.d)+(roleSupports(p,a.d)?1:0)+special(p,a,event))*(a.auto?2:1)}
function passiveInfluence(p){
  const value=a=>a.auto?2:1, active=p.assets.filter(a=>!a.blocked), hasGovernment=count(p,"government")>0||p.role==="politician";
  return (p.role==="politician"?active.filter(a=>a.d==="government").reduce((s,a)=>s+value(a),0):0)
    +(hasGovernment?active.filter(a=>a.id==="media"||a.id==="data").reduce((s,a)=>s+value(a),0):0)
    +(p.role==="politician"?active.filter(a=>a.id==="contract").reduce((s,a)=>s+value(a),0):0);
}
function assetValue(a){return Math.floor(a.cost/2)+(a.auto?2:0)+(a.scaled?2:0)}
function score(p){return p.money+p.inf+p.assets.reduce((s,a)=>s+assetValue(a),0)+p.projects*6+(p.role?3:0)-p.sc}
function addScandal(p,n){
  const next=p.sc+n;p.gained+=n;
  if(next>=6){p.sc=3;p.role=null;p.roofs=Math.max(0,p.roofs-1);p.jail=1;return}
  p.sc=next;if(next>=5)p.role=null;
}

function simulate(seed,{rounds=15,seats=4,rolePrice=5}={}){
  const R=rng(seed), players=Array.from({length:seats},(_,id)=>({id,money:10,inf:2,sc:0,roofs:0,role:null,jail:0,assets:[],cap:3,projects:0,gained:0,history:new Set(),switches:0}));
  const levels=Object.fromEntries(DISTRICTS.map(d=>[d,0]));
  const firstTaken=Object.fromEntries(ROLE_IDS.map(r=>[r,null]));
  let deck=shuffle(ASSETS,R), market=deck.splice(0,6), eventDeck=shuffle(EVENTS,R), event=eventDeck.shift();
  const holder=r=>players.find(p=>p.role===r);
  const takeRole=(p,r,round)=>{
    const current=holder(r),cost=current?rolePrice*2:rolePrice;
    if(p.inf<cost||p.sc>=5||current?.id===p.id)return false;
    p.inf-=cost;if(current){current.role=null;if(current.assets.some(a=>a.id==="lobby"))current.inf+=2}if(p.role&&p.role!==r)p.switches++;p.role=r;p.history.add(r);if(firstTaken[r]===null)firstTaken[r]=round;return true;
  };
  const price=(p,a)=>Math.max(1,a.cost-(event.d===a.d?(event.discount??0):0)-(p.role==="capitalist"&&!p.assets.some(x=>x.d===a.d)?1:0)-(a.d==="industrial"&&p.assets.some(x=>x.id==="logistics")?1:0));
  const rank=()=>[...players].sort((a,b)=>score(b)-score(a));
  const roleUtility=(p,r,isComeback,maxEnemyScandals)=>{
    const distinct=new Set(p.assets.map(a=>a.d)).size;
    if(r==="capitalist")return count(p,"business")*4+distinct*1.2+Math.min(3,p.money/6);
    if(r==="politician")return count(p,"residential")*3+count(p,"government")*4+passiveInfluence(p)*1.5;
    if(r==="fraudster")return count(p,"tech")*4+count(p,"shadows")*1.5+(isComeback?7:0);
    if(r==="mafia")return count(p,"shadows")*4+count(p,"government")*2+(isComeback?2:0);
    if(r==="military")return count(p,"industrial")*4+maxEnemyScandals*2.5+(isComeback?4:0);
    return maxEnemyScandals*2+players.filter(x=>x.id!==p.id&&x.role).length;
  };

  for(let round=1;round<=rounds;round++){
    for(const p of players){
      if(!p.role&&p.sc>0)p.sc--;
      let actions=p.jail>0?1:p.role==="fraudster"?4:3;p.jail=Math.max(0,p.jail-1);let investments=0;
      const used={capital:false,tax:false,polClean:false,inflate:false,publish:false,racket:false,mafiaClean:false,sanction:new Set(),crypto:false};
      for(let guard=0;guard<20&&(actions>0||investments>0);guard++){
        const ranked=rank(),place=ranked.findIndex(x=>x.id===p.id)+1,gap=Math.max(0,score(ranked[0])-score(p));
        const maxEnemyScandals=Math.max(0,...players.filter(x=>x.id!==p.id).map(x=>x.sc));
        const comeback=place===players.length||(place>=3&&gap>=10);
        let strategic=[...STRATEGIC_ROLES].sort((a,b)=>roleUtility(p,b,comeback,maxEnemyScandals)-roleUtility(p,a,comeback,maxEnemyScandals))[0];
        if(comeback)strategic=maxEnemyScandals>0&&roleUtility(p,"military",true,maxEnemyScandals)>=roleUtility(p,"fraudster",true,maxEnemyScandals)?"military":"fraudster";
        const leader=ranked.find(x=>x.id!==p.id),strategicHolder=holder(strategic);
        const scandalTarget=players.filter(x=>x.id!==p.id).sort((a,b)=>b.sc-a.sc||score(b)-score(a))[0];
        const target=p.role==="journalist"?(strategicHolder&&strategicHolder.id!==p.id?strategicHolder:leader):p.role==="military"?scandalTarget:leader;

        if(p.role==="politician"&&!used.polClean&&p.sc>0&&p.inf>=2){p.inf-=2;p.sc--;used.polClean=true;continue}
        if(p.role==="politician"&&!used.tax&&p.inf>=5){const revenue=Math.max(...DISTRICTS.map(d=>players.reduce((s,x)=>s+count(x,d),0)));if(revenue>=5){p.inf-=5;p.money+=revenue;used.tax=true;continue}}
        if(p.role==="capitalist"&&!used.capital&&p.inf>=3&&p.money>=4){p.inf-=3;investments++;used.capital=true;continue}
        if(p.role==="journalist"&&!used.inflate&&target&&p.sc<4){addScandal(p,1);addScandal(target,1);used.inflate=true;continue}
        if(p.role==="journalist"&&!used.publish&&target&&p.inf>=3){p.inf-=3;addScandal(target,1);used.publish=true;continue}
        if(p.role==="mafia"&&!used.mafiaClean&&p.sc>=2&&(p.roofs>0||(p.money>=3&&count(p,"government")>0))){if(p.roofs>0)p.roofs--;else p.money-=3;p.sc=Math.max(0,p.sc-2);used.mafiaClean=true;continue}
        if(actions>0&&p.role==="mafia"&&!used.racket&&target&&p.assets.some(a=>a.d==="shadows"&&!a.blocked)){const stolen=Math.min(target.money,2+(target.id===ranked[0].id?1:0)+Math.min(2,count(p,"government")));target.money-=stolen;p.money+=stolen;if(count(p,"government")===0)addScandal(p,1);used.racket=true;actions--;continue}
        if(actions>0&&p.role==="military"&&target&&target.sc>0&&!used.sanction.has(target.id)){
          const tier=target.sc;if(tier===1){const v=Math.min(1,target.inf);target.inf-=v;p.inf+=v}else if(tier===2){const v=Math.min(3,target.money);target.money-=v;p.money+=v}else if(tier===3){const a=[...target.assets].sort((a,b)=>b.income-a.income)[0];if(target.roofs>0)target.roofs--;else if(a)a.blocked=true}else{const a=[...target.assets].sort((a,b)=>assetValue(b)-assetValue(a))[0];if(target.roofs>0)target.roofs--;else if(a?.auto||a?.scaled){a.auto=false;a.scaled=false}}
          target.sc=Math.max(0,target.sc-1);used.sanction.add(target.id);actions--;continue;
        }
        if(actions>0&&p.role==="fraudster"&&p.sc>=4){p.sc--;actions--;continue}

        if(actions>0&&p.sc<5){
          const currentUtility=p.role?roleUtility(p,p.role,comeback,maxEnemyScandals):-2;
          if(p.role!==strategic&&(p.role===null||roleUtility(p,strategic,comeback,maxEnemyScandals)>=currentUtility+3||comeback)){
            const h=holder(strategic),cost=h?rolePrice*2:rolePrice;
            if(p.inf>=cost&&takeRole(p,strategic,round)){actions--;continue}
            if(h&&h.id!==p.id&&p.role!=="journalist"&&!holder("journalist")&&p.inf>=rolePrice&&takeRole(p,"journalist",round)){actions--;continue}
          }
        }
        if(actions>0&&p.role==="fraudster"&&!used.crypto&&p.assets.some(a=>a.id==="crypto"&&!a.blocked)&&p.sc<=3){const amount=Math.max(1,Math.min(comeback?2:1,4-p.sc));let gained=0;for(const x of players)if(x.id!==p.id){const paid=Math.min(amount,x.money);x.money-=paid;gained+=paid}p.money+=gained;addScandal(p,amount);used.crypto=true;actions--;continue}

        const marketValue=a=>{const c=count(p,a.d),completion=c===1?5:c===3?7:c===2?2:0,roleMatch=({capitalist:"business",politician:"residential",fraudster:"tech",mafia:"shadows",military:"industrial"}[strategic]===a.d)?3:0;const condition=((a.id==="cowork"||a.id==="battery")&&count(p,"residential")>0)||(a.id==="ai"&&count(p,"business")>0)||(a.id==="fund"&&count(p,"tech")>0)?2:0;const grey=a.tags.includes("grey")&&p.role!=="fraudster"&&p.role!=="mafia"?p.sc*2+2:0;return a.income*2.5-price(p,a)+a.inf+completion+roleMatch+condition-grey};
        const affordable=market.filter(a=>price(p,a)<=p.money).sort((a,b)=>marketValue(b)-marketValue(a)),best=affordable[0];
        const canInvest=actions>0||investments>0,spendInvest=()=>{if(investments>0)investments--;else actions--};
        if(canInvest&&best&&p.assets.length<p.cap){const cost=price(p,best);p.money-=cost+(0);p.inf+=best.inf;p.assets.push({...best,auto:false,scaled:false,blocked:false});market.splice(market.indexOf(best),1);if(best.id==="cash")p.money+=2;if(best.id==="crypto")p.inf+=2;if(best.id==="security")p.roofs++;if(best.id==="datacenter")addScandal(p,2);else if(best.tags.includes("grey"))addScandal(p,1);spendInvest();continue}
        const capCost=CAPACITY_COST[p.cap];if(canInvest&&best&&p.assets.length>=p.cap&&capCost&&p.money>=capCost&&marketValue(best)>=4){p.money-=capCost;p.cap++;spendInvest();continue}
        const developable=DISTRICTS.filter(d=>count(p,d)>=2&&levels[d]<2).sort((a,b)=>count(p,b)-count(p,a))[0];if(actions>0&&p.money>=2&&developable){p.money-=2;p.inf++;levels[developable]++;actions--;continue}
        const upgradeable=p.assets.filter(a=>!a.scaled&&!a.auto&&!a.blocked),automation=[...upgradeable].sort((a,b)=>synergyIncome(p,b,event)-synergyIncome(p,a,event))[0];if(canInvest&&p.money>=5&&automation&&synergyIncome(p,automation,event)>0){p.money-=5;automation.auto=true;spendInvest();continue}
        const scale=[...upgradeable].sort((a,b)=>b.income-a.income)[0];if(canInvest&&p.money>=4&&scale){p.money-=4;scale.scaled=true;spendInvest();continue}
        if(actions>0&&p.inf<(holder(strategic)?rolePrice*2:rolePrice)&&p.money>=2){p.money-=2;p.inf+=2;actions--;continue}
        if(actions>0){p.money+=2;actions--;continue}
      }
    }

    const incomes=new Map(players.map(p=>[p.id,-p.assets.length+p.assets.reduce((s,a)=>s+(a.blocked?0:Math.floor((a.income+(a.scaled?2:0))*(1+levels[a.d]*.25)*(event.d===a.d?(event.mult??1):1))+synergyIncome(p,a,event)),0)]));
    for(const mafia of players.filter(p=>p.role==="mafia")){let tribute=0;for(const p of players){if(p.id===mafia.id)continue;let levy=0;for(const d of DISTRICTS){const max=Math.max(...players.map(x=>count(x,d)));if(count(p,d)<max)levy+=p.assets.filter(a=>a.d===d&&!a.blocked).length}const paid=Math.min(Math.max(0,incomes.get(p.id)),levy);incomes.set(p.id,incomes.get(p.id)-paid);tribute+=paid}incomes.set(mafia.id,incomes.get(mafia.id)+tribute)}
    for(const p of players){const newsLimit=p.assets.some(a=>a.id==="data")?3:2,news=p.role==="journalist"?Math.min(newsLimit,players.filter(x=>x.id!==p.id).reduce((s,x)=>s+x.gained,0)):0,rating=p.role==="journalist"?Math.min(4,p.sc):0;p.money=Math.max(0,p.money+incomes.get(p.id));p.inf+=passiveInfluence(p)+news+rating;p.gained=0;for(const a of p.assets)a.blocked=false}
    if(round<rounds){while(market.length<6){if(!deck.length)deck=shuffle(ASSETS,R);market.push(deck.shift())}if(!eventDeck.length)eventDeck=shuffle(EVENTS,R);event=eventDeck.shift()}
  }
  const ranked=rank();return {ranked,firstTaken,winner:ranked[0]};
}

function batch(games,rounds,seats=4,rolePrice=5){
  const roleWins=Object.fromEntries(ROLE_IDS.map(r=>[r,0])),firstSum=Object.fromEntries(ROLE_IDS.map(r=>[r,0])),firstCount=Object.fromEntries(ROLE_IDS.map(r=>[r,0])),seatWins=[0,0,0,0];
  let scoreSum=0,gapSum=0,winnerRoles=0,winnerSwitches=0,winnerAssets=0,winnerCapacity=0;
  seatWins.length=seats;seatWins.fill(0);
  for(let i=1;i<=games;i++){
    const result=simulate(i*7919+rounds*104729,{rounds,seats,rolePrice});const w=result.winner;seatWins[w.id]++;scoreSum+=score(w);gapSum+=score(result.ranked[0])-score(result.ranked[1]);winnerRoles+=w.history.size;winnerSwitches+=w.switches;winnerAssets+=w.assets.length;winnerCapacity+=w.cap;
    for(const r of w.history)roleWins[r]++;
    for(const r of ROLE_IDS)if(result.firstTaken[r]!==null){firstSum[r]+=result.firstTaken[r];firstCount[r]++}
  }
  const pct=n=>+(n/games*100).toFixed(1),avg=n=>+(n/games).toFixed(2);
  return {games,rounds,avgWinnerScore:avg(scoreSum),avgVictoryGap:avg(gapSum),avgWinnerRoles:avg(winnerRoles),avgWinnerSwitches:avg(winnerSwitches),avgWinnerAssets:avg(winnerAssets),avgWinnerCapacity:avg(winnerCapacity),seatWinPct:seatWins.map(pct),winnerRoleCreditPct:Object.fromEntries(ROLE_IDS.map(r=>[r,pct(roleWins[r])])),firstRoleRound:Object.fromEntries(ROLE_IDS.map(r=>[r,firstCount[r]?+(firstSum[r]/firstCount[r]).toFixed(2):null])),roleSeenPct:Object.fromEntries(ROLE_IDS.map(r=>[r,pct(firstCount[r])]))};
}

const games=Number(process.argv[2]??3000),durations=(process.argv[3]?process.argv[3].split(",").map(Number):[10,12,15,18,20]);
const seats=Number(process.argv[4]??4),rolePrice=Number(process.argv[5]??5);
console.log(JSON.stringify({model:"current universal browser-bot strategy",settings:{seats,rolePrice},results:durations.map(rounds=>batch(games,rounds,seats,rolePrice))},null,2));
