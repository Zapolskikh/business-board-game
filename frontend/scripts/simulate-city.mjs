// Balance harness for the current digital-city rules.
// All seats use the same situational evaluator as the browser bots: their
// buildings, rank, score gap and opponents' scandals determine their role.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const ROLE_IDS = ["capitalist", "politician", "journalist", "fraudster", "mafia", "military"];
const STRATEGIC_ROLES = ["capitalist", "politician", "fraudster", "mafia", "military"];
const DISTRICTS = ["residential", "business", "industrial", "tech", "government", "shadows"];
const CAPACITY_COST = { 3: 6, 4: 10, 5: 15 };
const dataSource=readFileSync(new URL("../src/city/data.ts",import.meta.url),"utf8");
const assetSource=dataSource.match(/export const ASSETS: AssetCard\[\] = (\[[\s\S]*?\n\]);/)?.[1];
if(!assetSource)throw new Error("Cannot read ASSETS from src/city/data.ts");
const ASSETS=runInNewContext(assetSource).map(a=>({...a,d:a.district,inf:a.influence}));
const actionSource=dataSource.match(/export const ACTIONS: ActionCard\[\] = (\[[\s\S]*?\n\]);/)?.[1];
if(!actionSource)throw new Error("Cannot read ACTIONS from src/city/data.ts");
const ACTIONS=runInNewContext(actionSource);
const EVENTS = [
  {id:"ai_boom",d:"tech",mult:2},{id:"housing",d:"residential",mult:2},{id:"orders",d:"industrial",mult:2},
  {id:"election",d:"government"},{id:"crypto_winter",d:"tech",discount:2},{id:"festival",d:"residential",discount:1},
  {id:"amnesty",d:"shadows",mult:2},{id:"rates",d:"business",discount:-1},
];

function rng(seed){let x=seed|0;return()=>((x=Math.imul(1664525,x)+1013904223|0)>>>0)/4294967296}
function shuffle(items,R){const out=[...items];for(let i=out.length-1;i>0;i--){const j=Math.floor(R()*(i+1));[out[i],out[j]]=[out[j],out[i]]}return out}
function count(p,d){return p.assets.filter(a=>a.d===d).length+(p.zoning===d?1:0)}
function synergy(p,d){return count(p,d)>=4?2:count(p,d)>=2?1:0}
function hasRole(p,r){return p.role===r||p.tempRole===r}
function roleSupports(p,d){return (hasRole(p,"capitalist")&&d==="business")||(hasRole(p,"politician")&&d==="residential")||(hasRole(p,"mafia")&&d==="shadows")||(hasRole(p,"fraudster")&&d==="tech")||(hasRole(p,"military")&&d==="industrial")}
function hasDistrict(p,d){return count(p,d)>0||(d==="business"&&hasRole(p,"capitalist"))||(d==="government"&&hasRole(p,"politician"))}
function special(p,a,event){
  const e=a.effects;let value=0;if(e?.eventBonus?.eventId===event.id)value+=e.eventBonus.value;
  if(e?.districtBonus){const b=e.districtBonus;if(b.perObject)value+=Math.max(0,count(p,b.district)-(b.excludeSelf&&a.d===b.district?1:0)+(b.virtualRole&&p.role===b.virtualRole?1:0))*b.value;else if(hasDistrict(p,b.district))value+=b.value}
  if(e?.roleBonus&&hasRole(p,e.roleBonus.role))value+=e.roleBonus.value;return value;
}
function synergyIncome(p,a,event){return (synergy(p,a.d)+(roleSupports(p,a.d)?1:0)+special(p,a,event))*(a.auto?2:1)}
function passiveInfluence(p){
  const value=a=>a.auto?2:1, active=p.assets.filter(a=>!a.blocked);
  return (hasRole(p,"politician")?active.filter(a=>a.d==="government").reduce((s,a)=>s+value(a),0):0)
    +active.reduce((s,a)=>{const b=a.effects?.influenceBonus;return s+(b&&(!b.role||hasRole(p,b.role))&&(!b.district||hasDistrict(p,b.district))?b.value*value(a):0)},0);
}
function effectTotal(p,key){return p.assets.filter(a=>!a.blocked).reduce((s,a)=>s+(a.effects?.[key]??0),0)}
function roofLimit(p){return(p.role==="mafia"?2:1)+effectTotal(p,"roofCapacity")}
function assetValue(a){return Math.floor(a.cost/2)+(a.auto?2:0)+(a.scaled?2:0)}
function score(p){return p.money+p.inf+p.assets.reduce((s,a)=>s+assetValue(a),0)+p.projects*6+(p.role?3:0)-p.sc}
function addScandal(p,n){
  if(n>0&&p.scandalShield>0){p.scandalShield--;return}
  const next=p.sc+n;p.gained+=n;
  if(next>=6){p.sc=3;p.role=null;p.roofs=Math.max(0,p.roofs-1);p.jail=1;return}
  p.sc=next;if(next>=5)p.role=null;
}

function simulate(seed,{rounds=15,seats=4,rolePrice=5}={}){
  const R=rng(seed), players=Array.from({length:seats},(_,id)=>({id,money:10,inf:2,sc:0,roofs:0,role:null,tempRole:null,jail:0,assets:[],hand:[],cap:3,projects:0,gained:0,history:new Set(),cardHistory:new Set(),cardPlayedHistory:new Set(),switches:0,debt:0,roleShield:0,scandalShield:0,zoning:null,marketDiscount:0,upgradeDiscount:0,cardBuys:0,freeCards:0,cardPlays:0}));
  const levels=Object.fromEntries(DISTRICTS.map(d=>[d,0]));
  const firstTaken=Object.fromEntries(ROLE_IDS.map(r=>[r,null]));
  const gameStart=Math.floor(R()*players.length);
  let deck=shuffle(ASSETS,R), market=deck.splice(0,6), actionDeck=shuffle(ACTIONS,R), actionMarket=actionDeck.splice(0,3), eventDeck=shuffle(EVENTS,R), event=eventDeck.shift();
  const holder=r=>players.find(p=>p.role===r);
  const takeRole=(p,r,round)=>{
    const current=holder(r),cost=current?rolePrice*2:rolePrice;
    if(p.inf<cost||p.sc>=5||current?.id===p.id)return false;
    p.inf-=cost;if(current?.roleShield>0){current.roleShield--;return true}if(current){current.role=null;current.inf+=current.assets.reduce((s,a)=>s+(a.effects?.takeoverCompensation??0),0)}if(p.role&&p.role!==r)p.switches++;p.role=r;p.history.add(r);if(firstTaken[r]===null)firstTaken[r]=round;return true;
  };
  const price=(p,a)=>Math.max(1,a.cost-(event.d===a.d?(event.discount??0):0)-(hasRole(p,"capitalist")&&!p.assets.some(x=>x.d===a.d)?1:0)-(a.d==="industrial"&&p.assets.some(x=>x.id==="logistics")?1:0)-p.marketDiscount);
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
  const cardUtility=(p,card,target,comeback,d)=>{
    const leaderBonus=target?.id===rank()[0]?.id?2:0;
    if(card.kind==="clean")return Math.min(card.value,p.sc)*3;if(card.kind==="deep_clean")return p.inf>=2?Math.min(card.value,p.sc)*3-2:-10;
    if(card.kind==="roof")return p.roofs<roofLimit(p)?5:-10;if(card.kind==="grant")return card.value+(p.assets.some(a=>a.tags.includes("ai"))?2:0);
    if(card.kind==="bridge_loan")return card.value-4+(comeback?2:0);if(card.kind==="district_cash")return Math.min(10,count(p,d)*card.value);
    if(card.kind==="influence")return p.money>=2?4:-10;if(card.kind==="market_discount")return p.assets.length<p.cap&&market.some(a=>price(p,a)<=p.money+card.value)?5:-5;
    if(card.kind==="upgrade_discount")return p.assets.some(a=>!a.auto&&!a.scaled)?5:-10;if(card.kind==="zoning")return[1,3].includes(count(p,d))?6:2;
    if(card.kind==="develop")return count(p,d)>=2&&levels[d]<2?7:-10;if(card.kind==="copy_role")return 6;if(card.kind==="extra_action")return card.value*4;if(card.kind==="investment_action")return card.value*3;
    if(card.kind==="comeback")return comeback?8:3;if(card.kind==="influence_to_cash")return p.inf>=2?5:-10;if(card.kind==="project")return 6;
    if(card.kind==="role_shield")return p.role?5:2;if(card.kind==="scandal_shield")return p.sc>=3?6:4;if(card.kind==="unblock")return p.assets.some(a=>a.blocked)?7:-10;
    if(card.kind==="role_pressure")return target?.role?6+leaderBonus:-10;if(card.kind==="double_scandal")return target?5+target.sc*2+leaderBonus:-10;
    if(card.kind==="freeze"||card.kind==="remove_upgrade")return target?5+leaderBonus:-10;if(card.targeted)return target?card.value+2+leaderBonus:-10;return card.value;
  };
  const playCard=(p,card,target,comeback,d,strategic,turnState)=>{
    const hit=fn=>{if(!target)return;if(target.roofs>0)target.roofs--;else fn(target)};
    if(card.kind==="clean")p.sc=Math.max(0,p.sc-card.value);if(card.kind==="deep_clean"){p.sc=Math.max(0,p.sc-card.value);p.inf-=2}if(card.kind==="roof")p.roofs=Math.min(roofLimit(p),p.roofs+1);
    if(card.kind==="grant"){p.money+=card.value;if(p.assets.some(a=>a.tags.includes("ai")))p.inf++}if(card.kind==="bridge_loan"){p.money+=card.value;p.debt+=4}
    if(card.kind==="district_cash")p.money+=Math.min(10,count(p,d)*card.value);if(card.kind==="influence"){p.money-=2;p.inf+=card.value}if(card.kind==="market_discount")p.marketDiscount=card.value;if(card.kind==="upgrade_discount")p.upgradeDiscount=card.value;
    if(card.kind==="zoning")p.zoning=d;if(card.kind==="develop"){levels[d]=Math.min(2,levels[d]+1);p.inf+=card.value}if(card.kind==="copy_role")p.tempRole=strategic;if(card.kind==="extra_action")turnState.actions+=card.value;if(card.kind==="investment_action")turnState.investments+=card.value;
    if(card.kind==="comeback")p.money+=comeback?card.value:3;if(card.kind==="influence_to_cash"){p.inf-=2;p.money+=card.value}if(card.kind==="project")p.projects++;if(card.kind==="role_shield")p.roleShield++;if(card.kind==="scandal_shield")p.scandalShield++;
    if(card.kind==="unblock"){const a=[...p.assets].filter(a=>a.blocked).sort((a,b)=>b.income-a.income)[0];if(a)a.blocked=false}
    if(card.kind==="scandal")hit(q=>addScandal(q,1));if(card.kind==="fine")hit(q=>{if(q.money>=card.value)q.money-=card.value;else{q.money=0;addScandal(q,1)}});if(card.kind==="steal"){p.money+=2;hit(q=>q.money=Math.max(0,q.money-card.value))}
    if(card.kind==="role_pressure")hit(q=>{if(q.inf>=card.value)q.inf-=card.value;else{q.inf=0;q.role=null}});if(card.kind==="double_scandal"){addScandal(p,1);hit(q=>addScandal(q,card.value))}
    if(card.kind==="blackmail"){p.inf++;hit(q=>q.inf=Math.max(0,q.inf-card.value))}if(card.kind==="freeze")hit(q=>{const a=[...q.assets].sort((a,b)=>b.income-a.income)[0];if(a)a.blocked=true});if(card.kind==="expose"){hit(q=>addScandal(q,1));if(target?.id===rank()[0]?.id)p.inf+=card.value}
    if(card.kind==="remove_upgrade")hit(q=>{const a=[...q.assets].filter(a=>a.auto||a.scaled).sort((a,b)=>assetValue(b)-assetValue(a))[0];if(a){a.auto=false;a.scaled=false}});if(card.kind==="mixed_fine")hit(q=>{q.money=Math.max(0,q.money-2);q.inf=Math.max(0,q.inf-1)});
    p.hand.splice(p.hand.indexOf(card),1);p.cardPlays++;p.cardPlayedHistory.add(card.id);turnState.cardPlayed=true;
  };

  for(let round=1;round<=rounds;round++){
    const roundStart=(gameStart+round-1)%players.length;
    for(let offset=0;offset<players.length;offset++){
      const p=players[(roundStart+offset)%players.length];
      p.tempRole=null;p.marketDiscount=0;p.upgradeDiscount=0;
      if(!p.role&&p.sc>0)p.sc--;
      const jailed=p.jail>0;p.jail=Math.max(0,p.jail-1);p.sc=Math.max(0,p.sc-effectTotal(p,"scandalReduction"));p.roofs=Math.min(roofLimit(p),p.roofs+effectTotal(p,"turnRoof"));
      let actions=jailed?1:(p.role==="fraudster"?4:3)+Math.min(1,effectTotal(p,"extraActions"));let investments=Math.min(1,effectTotal(p,"extraInvestmentActions")),cardPlayed=false;
      const used={capital:false,tax:false,polClean:false,inflate:false,publish:false,racket:false,mafiaClean:false,sanction:new Set(),crypto:false};
      for(let guard=0;guard<20&&(actions>0||investments>0);guard++){
        const ranked=rank(),place=ranked.findIndex(x=>x.id===p.id)+1,gap=Math.max(0,score(ranked[0])-score(p));
        const maxEnemyScandals=Math.max(0,...players.filter(x=>x.id!==p.id).map(x=>x.sc));
        const comeback=place===players.length||(place>=3&&gap>=10);
        let strategic=[...STRATEGIC_ROLES].sort((a,b)=>roleUtility(p,b,comeback,maxEnemyScandals)-roleUtility(p,a,comeback,maxEnemyScandals))[0];
        if(comeback)strategic=maxEnemyScandals>0&&roleUtility(p,"military",true,maxEnemyScandals)>=roleUtility(p,"fraudster",true,maxEnemyScandals)?"military":"fraudster";
        const leader=ranked.find(x=>x.id!==p.id),strategicHolder=holder(strategic);
        const scandalTarget=players.filter(x=>x.id!==p.id).sort((a,b)=>b.sc-a.sc||score(b)-score(a))[0];
        const pendingTargetCard=p.hand.find(c=>c.targeted),cardTarget=pendingTargetCard?.kind==="role_pressure"?ranked.find(x=>x.id!==p.id&&x.role):pendingTargetCard?.kind==="remove_upgrade"?ranked.find(x=>x.id!==p.id&&x.assets.some(a=>a.auto||a.scaled)):leader;
        const target=pendingTargetCard&&!cardPlayed?cardTarget:p.role==="journalist"?(strategicHolder&&strategicHolder.id!==p.id?strategicHolder:leader):p.role==="military"?scandalTarget:leader;

        const cardDistrict=[...DISTRICTS].sort((a,b)=>count(p,b)-count(p,a))[0];
        if(!cardPlayed){const playable=[...p.hand].sort((a,b)=>cardUtility(p,b,target,comeback,cardDistrict)-cardUtility(p,a,target,comeback,cardDistrict))[0];if(playable&&cardUtility(p,playable,target,comeback,cardDistrict)>0){const state={actions,investments,cardPlayed};playCard(p,playable,target,comeback,cardDistrict,strategic,state);actions=state.actions;investments=state.investments;cardPlayed=true;continue}}

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
        if(actions>0&&p.role==="fraudster"&&!used.crypto&&p.assets.some(a=>a.id==="crypto"&&!a.blocked)&&p.sc<=3){const amount=Math.max(1,Math.min(comeback?2:1,4-p.sc));let gained=0;for(const x of players)if(x.id!==p.id){const paid=Math.min(amount,x.money);x.money-=paid;gained+=paid}p.money+=gained;addScandal(p,Math.max(0,amount-effectTotal(p,"greyScandalReduction")));used.crypto=true;actions--;continue}

        if(actions>0&&p.money>=3&&p.inf>=1&&p.hand.length<3){const purchaseValue=c=>(c.kind==="deep_clean"||c.kind==="influence_to_cash")&&p.inf<3?-10:c.kind==="influence"&&p.money<5?-10:cardUtility(p,c,target,comeback,cardDistrict),bestCard=[...actionMarket].sort((a,b)=>purchaseValue(b)-purchaseValue(a))[0];if(bestCard&&purchaseValue(bestCard)>=6){p.money-=3;p.inf--;p.hand.push(bestCard);p.cardBuys++;p.cardHistory.add(bestCard.id);actionMarket.splice(actionMarket.indexOf(bestCard),1);if(actionDeck.length)actionMarket.push(actionDeck.shift());actions--;continue}}

        const marketValue=a=>{const c=count(p,a.d),completion=c===1?5:c===3?7:c===2?2:0,roleMatch=({capitalist:"business",politician:"residential",fraudster:"tech",mafia:"shadows",military:"industrial"}[strategic]===a.d)?3:0,b=a.effects?.districtBonus,condition=b&&hasDistrict(p,b.district)?b.value*2:0,linked=a.effects?.roleBonus?.role===strategic?(a.effects.roleBonus.value*3):0,rarity=({common:0,uncommon:1,rare:2,epic:4,legendary:6}[a.rarity]??0),strong=(a.effects?.extraActions??0)*16+(a.effects?.extraInvestmentActions??0)*10+(a.effects?.scandalReduction??0)*7+(a.effects?.maintenanceReduction??0)*3+(a.effects?.roofCapacity??0)*3+(a.effects?.turnRoof??0)*4+(a.effects?.greyScandalReduction??0)*5,grey=a.tags.includes("grey")&&p.role!=="fraudster"&&p.role!=="mafia"?p.sc*2+2:0;return a.income*2.5-price(p,a)+a.inf+completion+roleMatch+condition+linked+rarity+strong-grey};
        const affordable=market.filter(a=>price(p,a)<=p.money).sort((a,b)=>marketValue(b)-marketValue(a)),best=affordable[0];
        const canInvest=actions>0||investments>0,spendInvest=()=>{if(investments>0)investments--;else actions--};
        if(canInvest&&best&&p.assets.length<p.cap){const cost=price(p,best),buy=best.effects?.purchase??{};p.money-=cost-(buy.money??0);p.inf+=best.inf+(buy.influence??0);p.assets.push({...best,auto:false,scaled:false,blocked:false});market.splice(market.indexOf(best),1);if(buy.roofs)p.roofs=Math.min(roofLimit(p),p.roofs+buy.roofs);if(buy.card&&p.hand.length<3&&(actionDeck.length||actionMarket.length)){const free=actionDeck.length?actionDeck.shift():actionMarket.shift();p.hand.push(free);p.cardHistory.add(free.id);p.freeCards++}const raw=buy.scandals??(best.tags.includes("grey")?1:0);addScandal(p,Math.max(0,raw-(best.tags.includes("grey")?effectTotal(p,"greyScandalReduction"):0)));p.marketDiscount=0;spendInvest();continue}
        const capCost=CAPACITY_COST[p.cap];if(canInvest&&best&&p.assets.length>=p.cap&&capCost&&p.money>=capCost&&marketValue(best)>=4){p.money-=capCost;p.cap++;spendInvest();continue}
        if(actions>0&&best&&p.assets.length>=p.cap){const weakest=[...p.assets].sort((a,b)=>(marketValue(a)+(a.auto||a.scaled?4:0))-(marketValue(b)+(b.auto||b.scaled?4:0)))[0],gain=marketValue(best)-marketValue(weakest)-(weakest.auto||weakest.scaled?4:0);if(gain>=5&&p.money+assetValue(weakest)>=price(p,best)){p.money+=assetValue(weakest);p.assets.splice(p.assets.indexOf(weakest),1);actions--;continue}}
        const developable=DISTRICTS.filter(d=>count(p,d)>=2&&levels[d]<2).sort((a,b)=>count(p,b)-count(p,a))[0];if(actions>0&&p.money>=2&&developable){p.money-=2;p.inf++;levels[developable]++;actions--;continue}
        const upgradeable=p.assets.filter(a=>!a.scaled&&!a.auto&&!a.blocked),automation=[...upgradeable].sort((a,b)=>synergyIncome(p,b,event)-synergyIncome(p,a,event))[0],autoCost=Math.max(1,5-p.upgradeDiscount);if(canInvest&&p.money>=autoCost&&automation&&synergyIncome(p,automation,event)>0){p.money-=autoCost;automation.auto=true;p.upgradeDiscount=0;spendInvest();continue}
        const scale=[...upgradeable].sort((a,b)=>b.income-a.income)[0],scaleCost=Math.max(1,4-p.upgradeDiscount);if(canInvest&&p.money>=scaleCost&&scale){p.money-=scaleCost;scale.scaled=true;p.upgradeDiscount=0;spendInvest();continue}
        if(actions>0&&p.inf<(holder(strategic)?rolePrice*2:rolePrice)&&p.money>=2){p.money-=2;p.inf+=2;actions--;continue}
        if(actions>0){p.money+=2;actions--;continue}
      }
      p.tempRole=null;p.marketDiscount=0;p.upgradeDiscount=0;
    }

    const incomes=new Map(players.map(p=>[p.id,-Math.max(0,p.assets.length-effectTotal(p,"maintenanceReduction"))+p.assets.reduce((s,a)=>s+(a.blocked?0:Math.floor((a.income+(a.scaled?2:0))*(1+levels[a.d]*.25)*(event.d===a.d?(event.mult??1):1))+synergyIncome(p,a,event)),0)]));
    for(const mafia of players.filter(p=>p.role==="mafia")){let tribute=0;for(const p of players){if(p.id===mafia.id)continue;let levy=0;for(const d of DISTRICTS){const max=Math.max(...players.map(x=>count(x,d)));if(count(p,d)<max)levy+=p.assets.filter(a=>a.d===d&&!a.blocked).length}const paid=Math.min(Math.max(0,incomes.get(p.id)),levy);incomes.set(p.id,incomes.get(p.id)-paid);tribute+=paid}incomes.set(mafia.id,incomes.get(mafia.id)+tribute)}
    for(const p of players){const newsLimit=p.assets.some(a=>a.id==="data")?3:2,news=p.role==="journalist"?Math.min(newsLimit,players.filter(x=>x.id!==p.id).reduce((s,x)=>s+x.gained,0)):0,rating=p.role==="journalist"?Math.min(4,p.sc):0;p.money=Math.max(0,p.money+incomes.get(p.id)-p.debt);p.inf+=passiveInfluence(p)+news+rating;p.debt=0;p.zoning=null;p.gained=0;for(const a of p.assets)a.blocked=false}
    if(round<rounds){while(market.length<6&&deck.length)market.push(deck.shift());if(!eventDeck.length)eventDeck=shuffle(EVENTS,R);event=eventDeck.shift()}
  }
  const ranked=rank();return {ranked,firstTaken,winner:ranked[0]};
}

function batch(games,rounds,seats=4,rolePrice=5){
  const roleWins=Object.fromEntries(ROLE_IDS.map(r=>[r,0])),firstSum=Object.fromEntries(ROLE_IDS.map(r=>[r,0])),firstCount=Object.fromEntries(ROLE_IDS.map(r=>[r,0])),seatWins=[0,0,0,0];
  const rarityTotals={common:0,uncommon:0,rare:0,epic:0,legendary:0},assetWinCredits=Object.fromEntries(ASSETS.map(a=>[a.id,0])),cardWinCredits=Object.fromEntries(ACTIONS.map(c=>[c.id,0]));
  let scoreSum=0,gapSum=0,winnerRoles=0,winnerSwitches=0,winnerAssets=0,winnerCapacity=0,winnersWithLegendary=0,totalCardBuys=0,totalFreeCards=0,totalCardPlays=0,winnerCardBuys=0,winnerCardPlays=0;
  seatWins.length=seats;seatWins.fill(0);
  for(let i=1;i<=games;i++){
    const result=simulate(i*7919+rounds*104729,{rounds,seats,rolePrice});const w=result.winner;seatWins[w.id]++;scoreSum+=score(w);gapSum+=score(result.ranked[0])-score(result.ranked[1]);winnerRoles+=w.history.size;winnerSwitches+=w.switches;winnerAssets+=w.assets.length;winnerCapacity+=w.cap;
    if(w.assets.some(a=>a.rarity==="legendary"))winnersWithLegendary++;for(const a of w.assets){rarityTotals[a.rarity]++;assetWinCredits[a.id]++}
    for(const p of result.ranked){totalCardBuys+=p.cardBuys;totalFreeCards+=p.freeCards;totalCardPlays+=p.cardPlays}winnerCardBuys+=w.cardBuys;winnerCardPlays+=w.cardPlays;for(const id of w.cardPlayedHistory)cardWinCredits[id]++;
    for(const r of w.history)roleWins[r]++;
    for(const r of ROLE_IDS)if(result.firstTaken[r]!==null){firstSum[r]+=result.firstTaken[r];firstCount[r]++}
  }
  const pct=n=>+(n/games*100).toFixed(1),avg=n=>+(n/games).toFixed(2);
  const topWinnerObjects=Object.entries(assetWinCredits).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([id,n])=>({id,winCreditPct:pct(n)}));
  const topWinnerCards=Object.entries(cardWinCredits).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([id,n])=>({id,winCreditPct:pct(n)}));
  return {games,rounds,avgWinnerScore:avg(scoreSum),avgVictoryGap:avg(gapSum),avgWinnerRoles:avg(winnerRoles),avgWinnerSwitches:avg(winnerSwitches),avgWinnerAssets:avg(winnerAssets),avgWinnerCapacity:avg(winnerCapacity),cards:{avgPaidBuysPerPlayer:+(totalCardBuys/(games*seats)).toFixed(2),avgFreeCardsPerPlayer:+(totalFreeCards/(games*seats)).toFixed(2),avgPlaysPerPlayer:+(totalCardPlays/(games*seats)).toFixed(2),playRatePct:+(totalCardPlays/Math.max(1,totalCardBuys+totalFreeCards)*100).toFixed(1),avgWinnerPaidBuys:avg(winnerCardBuys),avgWinnerPlays:avg(winnerCardPlays),topWinnerCards},winnerLegendaryPct:pct(winnersWithLegendary),avgWinnerRarities:Object.fromEntries(Object.entries(rarityTotals).map(([r,n])=>[r,avg(n)])),topWinnerObjects,seatWinPct:seatWins.map(pct),winnerRoleCreditPct:Object.fromEntries(ROLE_IDS.map(r=>[r,pct(roleWins[r])])),firstRoleRound:Object.fromEntries(ROLE_IDS.map(r=>[r,firstCount[r]?+(firstSum[r]/firstCount[r]).toFixed(2):null])),roleSeenPct:Object.fromEntries(ROLE_IDS.map(r=>[r,pct(firstCount[r])]))};
}

const games=Number(process.argv[2]??3000),durations=(process.argv[3]?process.argv[3].split(",").map(Number):[10,12,15,18,20]);
const seats=Number(process.argv[4]??4),rolePrice=Number(process.argv[5]??5);
console.log(JSON.stringify({model:"current universal browser-bot strategy",settings:{seats,rolePrice},results:durations.map(rounds=>batch(games,rounds,seats,rolePrice))},null,2));
