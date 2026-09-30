import type { RoleGuide, RulesChapter, RulesContext, TableLabels } from "../rulesDocument";

/* Kniha pravidel česky. Jednoduchá slova a krátké věty. Všechna čísla bere z ctx. */

const labels: TableLabels = {
  asset: "Podnik",
  price: "Cena",
  income: "Příjem/kolo",
  influence: "◆ hned",
  effect: "Co dělá",
  roleNote: role => `Role této čtvrti: <b>${role}</b> (+1$ za každý podnik čtvrti).`,
  card: "Karta",
  type: "Typ",
  target: "Na koho",
  onTarget: "na soupeře",
  onSelf: "na sebe",
  tone: { deal: "Obchod", attack: "Útok", defence: "Obrana" },
  project: "Projekt",
  points: "Body",
  condition: "Podmínka",
  perk: "Trvalý bonus",
  roleHeads: { perks: "Trvalé bonusy", powers: "Schopnosti", cost: "Cena", limit: "Limit", effect: "Účinek", tip: "Tip", warning: "Pozor" },
  onMarketFrom: round => `na trhu od ${round}. kola`,
  and: " a ",
};

const roles: Record<string, RoleGuide> = {
  capitalist: {
    style: "Peněžní role: víc peněz z každého podniku a vliv z továren.",
    perks: [
      "<b>Každý váš podnik: +1$.</b> Jakýkoli, nejen v Obchodní čtvrti.",
      "<b>Vlastní čtvrť — Obchodní čtvrť:</b> její podniky dávají ještě +1$.",
      "<b>Vliv z Průmyslové zóny:</b> +1◆ na konci kola za každý váš podnik v Průmyslové zóně. Je to jediný vliv role.",
    ],
    powers: [
      {
        name: "Zabrat kartu",
        cost: "1 akce a 1⚠",
        limit: "jeden zábor: nový ruší starý",
        effect: "Karta z trhu pracuje pro vás, jako by byla vaše: dává příjem, počítá se do synergie a projektů a otevírá šedé kšefty. Kdokoli ji ale pořád může koupit, body nedává a místo nezabírá. Se ztrátou role zábor zmizí.",
      },
    ],
  },
  politician: {
    style: "Role kontroly: vliv z bydlení v celém městě a levné čištění skandálů.",
    perks: [
      "<b>Vlastní čtvrť — Vládní čtvrť:</b> každý váš podnik v ní dává +1$.",
      "<b>Vliv od obyvatel:</b> na konci kola +1◆ za každý podnik na Sídlišti na stole — váš i cizí.",
    ],
    powers: [
      { name: "Urovnat skandál", cost: "1 akce a 2◆", limit: "kolik vám dovolí akce", effect: "Smaže 1 váš skandál." },
      {
        name: "Domluvíme se",
        cost: "3◆ a 1⚠; potřebujete podnik v Šedé zóně",
        limit: "jednou za tah, bez akce",
        effect: "Do konce kola se jakákoli čtvrť, kterou vyberete, počítá jako vaše: pro projekty, šedé kšefty i synergii.",
      },
      {
        name: "Veto",
        cost: "1 akce a 3◆",
        limit: "jedno veto, všichni ho vidí",
        effect: "Projekt na desce můžete vzít jen vy. Když projekt z desky odejde, veto odejde s ním. Se ztrátou role zmizí.",
      },
    ],
  },
  journalist: {
    style: "Role skandálů: cizí skandály přinášejí peníze, vlastní vliv.",
    perks: [
      "<b>Peníze z cizích skandálů:</b> na konci kola 1$ za každý skandál soupeřů, nebo 2$, pokud máte podnik v Obchodní čtvrti. Počítá se, kolik jich zbývá při výplatě.",
      "<b>Vliv z vlastních skandálů:</b> na konci kola +1◆ za každý váš skandál, bez stropu. Funguje jen tehdy, když máte aspoň jeden podnik na Sídlišti.",
      "<b>Limit skandálů — 6.</b> Roli ztrácíte při 6. skandálu, ne při 5. Zatčení přijde při 7.",
      "Role nemá vlastní čtvrť.",
    ],
    powers: [
      {
        name: "Nafouknout aféru",
        cost: "zdarma, bez akce",
        limit: "jednou za tah",
        effect: "1⚠ vám i soupeři, kterého vyberete. Pokud má cíl Ochranu, zastaví celý úder — a pak nedostanete skandál ani vy.",
      },
      {
        name: "Zveřejnit článek",
        cost: "1 akce a 3◆",
        limit: "jednou za tah",
        effect: "Soupeři 2⚠, vám nic. Ochrana cíle zastaví celý článek, ale akce a vliv jsou utracené.",
      },
    ],
    warning: "Ochrana soupeře zastaví aféru i článek. Při 6⚠ ztratíte roli, při 7⚠ vás zatknou. Bez role máte zase limit 5⚠.",
  },
  fraudster: {
    style: "Riskantní role: víc akcí a silné šedé kšefty.",
    perks: [
      "<b>Čtyři akce za tah</b> místo tří.",
      "<b>Vlastní čtvrť — Tech klastr:</b> každý váš podnik v něm dává +1$.",
      "<b>Šedé kšefty:</b> šance na úspěch +30 %, ale nejvýš 90 %.",
    ],
    powers: [
      { name: "Zamést stopy", cost: "1 akce", limit: "kolik vám dovolí akce", effect: "Smaže 1 váš skandál." },
      {
        name: "Kryptopodvod",
        cost: "1 akce; potřebujete vlastní Městskou kryptoburzu",
        limit: "jednou za tah",
        effect: "Vezme 25 % peněz každému soupeři (Ochrana chrání svého majitele) a dá vám 5⚠. Podniky a projekty, které snižují skandály ze šedých kšeftů, snižují i tyto.",
      },
    ],
  },
  mafia: {
    style: "Role síly: příjem ze Šedé zóny, výpalné a levná Ochrana.",
    perks: [
      "<b>Vlastní čtvrť — Šedá zóna:</b> každý váš podnik v ní dává +1$.",
      "<b>Ochrana</b> stojí o 1$ méně a můžete mít dvě, ne jednu.",
    ],
    powers: [
      {
        name: "Výpalné",
        cost: "1 akce; potřebujete podnik v Šedé zóně",
        limit: "jednou za tah",
        effect: "Cíl vám dá peníze: 2$ + 2$ za každý váš podnik v Šedé zóně + číslo kola děleno 3 (zaokrouhleno dolů), a ještě +5$, pokud je cíl lídr. A vliv: 1◆ za každý váš podnik ve Vládní čtvrti. Nikdy víc, než cíl má. Ochrana cíle výpalné zruší. Když nemáte vládní podnik, dostanete 1⚠.",
      },
      { name: "Ututlat", cost: "1 akce a 3$; potřebujete vládní podnik", limit: "kolik vám dovolí akce", effect: "Smaže až 2 vaše skandály." },
      {
        name: "Šedá blokace",
        cost: "1 Ochrana",
        limit: "jednou za tah, bez akce",
        effect: "Do konce kola může místo na trhu koupit jen vy. Blokaci máte jen jednu: nová přesune starou. Zruší ji konec kola nebo nové rozdání místa Tvůrcem trhu.",
      },
    ],
  },
  military: {
    style: "Trestající role: tvrdě zasáhne ty, kdo mají hodně skandálů.",
    perks: [
      "<b>Vlastní čtvrť — Průmyslová zóna:</b> každý váš podnik v ní dává +1$.",
      "Sankce se dívají na počet skandálů cíle a Kontrola ty skandály vytváří.",
    ],
    powers: [
      {
        name: "Sankce",
        cost: "1 akce",
        limit: "jednou za tah; cíl musí mít aspoň 2⚠",
        effect: "Pokud má cíl Ochranu, ztratí ji — a to je vše. Bez Ochrany: při 2⚠ vám cíl dá až (3 + číslo kola)$; při 3⚠ — i vliv; při 4⚠ — přijde i o roli. Skandály cíli zůstávají.",
      },
      {
        name: "Kontrola",
        cost: "1 akce",
        limit: "kolik vám dovolí akce; potřebujete soupeře s podnikem v Šedé zóně",
        effect: "Skandál každému soupeři, který má podnik v Šedé zóně. Ochrana chrání svého majitele a spotřebuje se.",
      },
      {
        name: "Sebrat Ochranu",
        cost: "1 akce a 3◆",
        limit: "potřebujete soupeře s Ochranou a místo pro ni",
        effect: "Jedna Ochrana soupeře přejde k vám. Ochrana proti tomu nechrání.",
      },
    ],
    warning: "Ochrana cíle sankce úplně zastaví. A cíl si může ve svém tahu skandály smazat.",
  },
};

export function bookCs(ctx: RulesContext): RulesChapter[] {
  const { n, rolePrice } = ctx;
  const campaign = n.campaign.map(tier => `<b>${tier.spend}$ → ${tier.gain}◆</b>`).join(", ");
  const selfCards = ctx.list(ctx.selfTargetCards, labels.and) || "Některé karty se skandálem";
  const capacity = n.capacityCosts.map(cost => `${cost}$`).join(" → ");
  const tags = ["finance", "data", "logistics", "production", "security", "government"].map(tag => `„${ctx.e(ctx.tag(tag))}“`).join(", ");
  return [
    {
      id: "intro",
      icon: "🏙️",
      title: "Vítejte ve městě",
      html: `
      <p><i>Město vlivu</i> je hra o budování silné městské sítě a překonání soupeřů. Kupujte podniky, rozvíjejte čtvrti, využívejte role a schopnosti a získávejte městské projekty.</p>
      <div class="tip"><b>Váš cíl:</b> na konci posledního kola mít více bodů než ostatní. Body přinášejí projekty, podniky, role, některé akce a zbývající peníze a vliv; skandály body ubírají.</div>
      <p><b>Město i trh jsou společné.</b> Všichni vidí stejných šest nabídek trhu a ${n.projectBoardSize} projektů. Nákup podniku nebo získání projektu změní společnou nabídku pro všechny. Projekt získá hráč, který jako první zaplatí jeho cenu a splní podmínku.</p>
      <p><b>Průběh hry:</b> během svého tahu utrácejte akce za rozhodnutí; na konci kola město vyplatí příjem a část nabídek se změní. Plánujte rozvoj na několik kol dopředu, ale s projektem nečekejte příliš dlouho — může ho získat soupeř.</p>
      <div class="box"><h4>Symboly zdrojů v této knize</h4><p><b>$ jsou peníze</b>, <b>◆ je vliv</b> a <b>⚠ je skandál</b>. Stejné symboly používáme u cen, účinků i bodování.</p></div>
      `,
    },
    {
      id: "goal",
      icon: "🏆",
      title: "Cíl a body",
      html: `
      <p>Vyhraje hráč, který má na konci nejvíc bodů. Body dostanete za:</p>
      <ul>
        <li><b>Městské projekty</b> — 1 až 9 bodů, nejčastěji 6–7. Největší zdroj bodů.</li>
        <li><b>Podniky</b> — polovina ceny podniku, zaokrouhleno dolů. Číslo je na kartě (<b>★ N bodů</b>).</li>
        <li><b>Roli</b> — +3 body, pokud máte na konci roli.</li>
        <li><b>Další body</b> — mecenášství (<b>${n.patronage.money}$ → ${n.patronage.points}</b>), lobbing (<b>${n.lobbying.influence}◆ → ${n.lobbying.points}</b>) a karty, které kupují body. Mecenášství i lobbing — každé jednou za tah.</li>
        <li><b>💵 Peníze ($)</b> — 1 bod za každých <b>${n.moneyPerPoint}$</b>.</li>
        <li><b>◆ Vliv</b> — 1 bod za každé <b>${n.influencePerPoint}◆</b>.</li>
        <li><b>⚠ Skandály</b> — mínus 1 bod za každý.</li>
      </ul>
      <div class="tip"><b>Kde to vidět:</b> vaše skóre po částech a nejbližší příjem otevřete tlačítkem „Skóre a příjem“ nahoře.</div>
      `,
    },
    {
      id: "flow",
      icon: "⏳",
      title: "Tahy a kola",
      html: `
      <p>V každém kole se všichni vystřídají. <b>Jako první hraje ten, kdo má nejméně bodů</b>, lídr hraje poslední. Pořadí se určuje znovu každé kolo. Při stejných bodech jde dřív ten, kdo minulé kolo hrál později. Kdo je na tahu, ukazuje panel hráčů.</p>
      <div class="kpi">
        <div><b>3</b><span>akce za tah pro všechny</span></div>
        <div><b>4</b><span>akce pro Podvodníka</span></div>
        <div><b>1</b><span>akce v tahu po zatčení</span></div>
      </div>
      <p>Akce se utrácejí za nákupy, role, projekty, karty, šedé kšefty a obranu. <b>Akci nestojí</b> prodej podniku, hraní a zahazování karet. Nevyužité akce na konci tahu propadají.</p>
      <p><b>Konec kola.</b> Podniky vyplatí příjem, přičte se vliv, zafungují bonusy rolí a splatí se překlenovací úvěr. Při začátku dalšího kola se znovu určí pořadí, zamíchá balíček karet akcí, změní část trhu a jeden projekt na desce.</p>
      <p><b>Po posledním kole výplata není.</b> Celé poslední kolo ukazuje okno „Skóre a příjem“ nulovou výplatu: utraťte peníze a vliv hned. Překlenovací úvěr se ale splatí.</p>
      <div class="tip"><b>Trh má šest míst a balíček ${ctx.meta.assets.length} karet podniků.</b> Balíček se zamíchá, takže nabídky přicházejí v náhodném pořadí. Když někdo podnik koupí, jeho místo hned zaplní další dostupná karta ze zamíchaného balíčku. Na začátku každého nového kola jdou <b>${n.rotation} nejstarší místa</b> označená ⏳ na spodek balíčku a nahradí je nové karty. Během kola se trh jinak nemění (výjimkou je schopnost Tvůrce trhu).</div>
      `,
    },
    {
      id: "projects",
      icon: "🏛",
      title: "Městské projekty",
      html: `
      <p>Deska s ${n.projectBoardSize} projekty je společná pro všechny hráče. Projekt není rezervovaný pro toho, kdo ho viděl jako první nebo jako první splnil podmínku: získá ho hráč, který jako první utratí akci a zdroje. Potom patří jen jemu.</p>
      ${ctx.html.projectExample({ heading: "Jak číst skutečnou kartu projektu", caption: "Ukázka je sestavená z karty v katalogu hry.", title: "Název", points: "Body", condition: "Podmínka", price: "Cena", reward: "Trvalá odměna", action: "1 akce" })}
      <ul>
        <li><b>Cena</b> — vliv a peníze z karty a 1 akce.</li>
        <li><b>Podmínka</b> — něco, co už musíte mít: podniky ve čtvrti, podniky se štítkem, počet podniků, málo skandálů nebo jakoukoli roli.</li>
        <li><b>Odměna</b> — body na konci a trvalý bonus, třeba +2$ nebo +2◆ každé kolo. Bonus vám nikdo nevezme.</li>
        <li><b>Rotace projektů</b> — na začátku každého nového kola jde <b>nejstarší projekt úplně vlevo</b> označený ⏳ na spodek balíčku. Ostatní se posunou doleva a další karta ze zamíchaného balíčku přijde na pravý kraj.</li>
        <li><b>Znovu rozdat desku</b> — ${n.reroll}$ a 1 akce, jednou za tah: všechny projekty jdou zpět do balíčku a rozdá se nová deska.</li>
      </ul>
      <p>Když někdo projekt získá, nový se okamžitě objeví na pravém okraji. Pokud máte dost akcí a zdrojů, můžete během tahu získat více dostupných projektů. Balíček projektů se zamíchá při novém rozdání celé desky; běžná rotace bere další kartu z balíčku.</p>
      `,
    },
    {
      id: "resources",
      icon: "💰",
      title: "Zdroje",
      html: `
      <div class="cols">
        <div class="box"><h4>💵 Peníze ($)</h4><p>Na nákupy, místa, projekty, karty a obranu. Na konci ${n.moneyPerPoint}$ = 1 bod. Mecenášství: ${n.patronage.money}$ → ${n.patronage.points} bodů, jednou za tah.</p></div>
        <div class="box"><h4>◆ Vliv</h4><p>Na role, projekty a schopnosti. Na konci ${n.influencePerPoint}◆ = 1 bod. Lobbing: ${n.lobbying.influence}◆ → ${n.lobbying.points} bodů, jednou za tah. Vliv dávají podniky s „+◆ za kolo“, bonusy projektů a některé role. Dá se i koupit — to je „Výměna“.</p></div>
        <div class="box"><h4>🔁 Výměna</h4><p>1 akce: ${campaign}.</p></div>
        <div class="box"><h4>⚠ Skandály</h4><p>Mínus bod za každý. Při 5⚠ ztratíte roli, při 6⚠ vás zatknou. Novinář má o jeden víc: roli ztratí při 6⚠, zatčení přijde při 7⚠. Smazat 1⚠: <b>${n.crisisPr}◆ a 1 akce</b> (krizové PR). Když nemáte roli, 1⚠ sám zmizí na začátku tahu.</p></div>
        <div class="box"><h4>🛡️ Ochrana</h4><p>Obrana <b>proti ostatním hráčům</b>: zastaví kartu, výpalné, sankce, hack i pokus vzít vám roli. Před vašimi vlastními rozhodnutími, třeba neúspěšným šedým kšeftem, nechrání.</p></div>
        <div class="box"><h4>🏢 Místa</h4><p>Na začátku máte 3 místa, nejvýš 6. Nové místo stojí ${capacity}.</p></div>
        <div class="box"><h4>🃏 Karty akcí</h4><p>Nákup: 1 akce, ${n.cardCost}$ a 1◆ — vezmete si <b>dvě náhodné</b> karty. Jednou za tah, v ruce nejvýš 3. Hrát a zahazovat můžete, kolik chcete. Zahození dá ${n.discard}$ nebo ${n.discard}◆.</p></div>
        <div class="box"><h4>🏷️ Prodej podniku</h4><p><b>Bez akce.</b> Dostanete polovinu ceny podniku — tolik bodů taky dával. Místo je hned volné.</p></div>
      </div>
      `,
    },
    {
      id: "economy",
      icon: "🏢",
      title: "Příjem podniků",
      html: `
      <p>Na konci kola každý podnik vyplatí <b>příjem z karty + synergii</b>.</p>
      <ul>
        <li><b>Příjem z karty</b> neroste. Chcete-li víc, kupte silnější podnik nebo si postavte čtvrť.</li>
        <li><b>Synergie čtvrti</b>: se 2 podniky ve čtvrti dává každý +1$, se 4 dává každý +2$.</li>
        <li><b>Role čtvrti</b>: pět čtvrtí má svou roli, ta dává +1$ za každý podnik čtvrti.</li>
        <li><b>Celá čtvrť</b>: se 4 podniky ve čtvrti dávají epické a legendární podniky té čtvrti ještě +1◆ za kolo.</li>
        <li><b>Vlastnosti karty</b>: bonusy napsané přímo na kartě.</li>
      </ul>
      <p>Vliv ◆ na kartě je <b>jednorázový</b>: dostanete ho při koupi. Na kartě z trhu je příjem ukázán jako to, o kolik vzroste celý váš příjem — včetně synergie, kterou tato koupě zapne.</p>
      <p><b>Štítky</b> (${tags}…) jsou napsané na kartách. Hodně podmínek projektů je kontroluje.</p>
      `,
    },
    {
      id: "districts",
      icon: "🗺",
      title: "Čtvrti a synergie",
      html: `
      <p>Město má šest čtvrtí. Čím víc vašich podniků je ve čtvrti, tím víc dává <b>každý</b> podnik v ní:</p>
      <div class="kpi">
        <div><b>2 podniky</b><span>+1$ každý</span></div>
        <div><b>4 podniky</b><span>+2$ každý</span></div>
        <div><b>Role čtvrti</b><span>+1$ každý</span></div>
      </div>
      <p>Role čtvrtí:</p>
      ${ctx.html.districtRoles()}
      <p>Sídliště vlastní roli nemá.</p>
      <div class="box"><h4>🏙 Pronájem čtvrti</h4><p>Karta Změna územního plánu a schopnost Politika „Domluvíme se“ počítají vybranou čtvrť do konce kola tak, jako byste v ní měli o 1 podnik víc. Platí to pro podmínky projektů, šedé kšefty, schopnosti role a synergii. Pro trvalé bonusy role ne: ty počítají jen to, co jste postavili. Pronájem je jen jeden: nový nahradí starý.</p></div>
      `,
    },
    {
      id: "roles",
      icon: "🎭",
      title: "Role",
      html: `
      <p>Role dává trvalé bonusy a schopnosti. Mít můžete jen jednu roli. Role na konci hry dává <b>+3 body</b>.</p>
      <div class="cols">
        <div class="box"><h4>Jak ji získat</h4><p>Volná role: <b>${rolePrice}◆</b> a 1 akce. Role jiného hráče: <b>${rolePrice * 3}◆</b> a 1 akce. Ten roli ztratí a vaše dřívější role se uvolní.</p></div>
        <div class="box"><h4>Obrana</h4><p>Ochrana držitele převzetí zastaví a spotřebuje se. Vliv se vám vrátí, akce ne. Lobbistická kancelář dá bývalému držiteli 2◆, pokud mu roli nakonec vezmou.</p></div>
        <div class="box"><h4>Schopnosti</h4><p>Každá schopnost má svou cenu a svůj limit. „Bez akce“ znamená, že se počet akcí nesníží.</p></div>
      </div>
      ${ctx.html.roleCards(roles, labels)}
      <div class="warn"><b>Ztráta role:</b> s 5⚠ roli vzít nemůžete (ani jako Novinář). Když dosáhnete svého limitu skandálů, roli hned ztratíte. Ještě 1⚠ — zatčení.</div>
      `,
    },
    {
      id: "grey",
      icon: "🕶",
      title: "Šedé kšefty",
      html: `
      <p>Šedý kšeft otevírá <b>čtvrť</b>: potřebujete jakýkoli svůj podnik ve správné čtvrti, role není potřeba. Kšeft stojí 1 akci, <b>za tah jen jeden</b>. Šedá zóna otevírá všech pět, Tech klastr — Pump and dump a Hack, Vládní čtvrť — Únik špíny.</p>
      <table>
        <thead><tr><th>Kšeft</th><th>Čtvrť</th><th>Šance</th><th>Co udělá při úspěchu</th><th>Body</th></tr></thead>
        <tbody>
          <tr><td class="name"><b>Pomluvy</b></td><td>Šedá zóna</td><td class="num">${n.greyChance("smear", 60)} %</td><td><b>1⚠ každému soupeři</b></td><td class="num">+${n.greyPoints("smear", 2)}</td></tr>
          <tr><td class="name"><b>Pump and dump</b></td><td>Tech klastr, Šedá zóna</td><td class="num">${n.greyChance("crypto", 45)} %</td><td>vzít až (${n.pumpBase} + kolo/2)$ <b>každému soupeři</b></td><td class="num">+${n.greyPoints("crypto", 2)}</td></tr>
          <tr><td class="name"><b>Prolomit Ochranu</b></td><td>Šedá zóna</td><td class="num">${n.greyChance("roof_break", 60)} %</td><td>sundat cíli <b>všechny</b> Ochrany, +${n.roofBreakPoint} bod za každou</td><td class="num">+${n.greyPoints("roof_break", 2)}</td></tr>
          <tr><td class="name"><b>Hack</b></td><td>Tech klastr, Šedá zóna</td><td class="num">${n.greyChance("datacenter", 40)} %</td><td>ukrást cíli až (${n.hackBase} + kolo/3)◆</td><td class="num">+${n.greyPoints("datacenter", 3)}</td></tr>
          <tr><td class="name"><b>Únik špíny</b></td><td>Šedá zóna, Vládní čtvrť</td><td class="num">${n.greyChance("influence_broker", 60)} %</td><td>cíl <b>ztratí roli</b></td><td class="num">+${n.greyPoints("influence_broker", 3)}</td></tr>
        </tbody>
      </table>
      <p><b>Jedno pravidlo pro všechny kšefty.</b> Úspěch: účinek nastane, dostanete body a <b>${n.greySuccess} skandál</b>. Neúspěch: nestane se nic, ale dostanete <b>${n.greyFailure} skandály</b>. Akce se spotřebuje v obou případech. Dělení ve vzorcích se zaokrouhluje dolů.</p>
      <p>Podvodník má šanci o 30 % vyšší (nejvýš 90 %). Některé podniky a projekty snižují skandály z kšeftů o 1 — při úspěchu i neúspěchu.</p>
      <div class="box"><h4>Ochrana cíle</h4><p>Ochrana cíle kšeft zastaví a spotřebuje se, i při úspěchu. Body a svůj skandál dostanete stejně. Pomluvy a Pump zasáhnou všechny soupeře a Ochrana každého se počítá zvlášť. <b>„Prolomit Ochranu“ Ochrana nezastaví</b> — ten kšeft míří přímo na ni.</p></div>
      <div class="box"><h4>Vlastní skandály Ochrana nezastaví</h4><p>Skandál za váš šedý kšeft nebo kryptopodvod přijde vždycky, i když máte Ochranu.</p></div>
      `,
    },
    {
      id: "scandals",
      icon: "⚠",
      title: "Skandály a zatčení",
      html: `
      <div class="kpi">
        <div><b>0–4⚠</b><span>mínus bod za každý, hrajete normálně</span></div>
        <div><b>5⚠</b><span>hned ztratíte roli</span></div>
        <div><b>6⚠</b><span>zatčení: skandály klesnou na 3⚠, ztratíte roli a 1 Ochranu</span></div>
      </div>
      <p><b>Zatčení:</b> v příštím tahu máte jen 1 akci. Pokud vás zatknou během vašeho tahu, tah hned skončí a zbylé akce propadnou. Když nemáte roli, 1⚠ sám zmizí na začátku tahu.</p>
      <p>Skandály mažete jedním tlačítkem „Čištění“ — ukáže cenu pro vaši roli. Každá možnost stojí 1 akci a jde opakovat:</p>
      <div class="kpi">
        <div><b>${n.crisisPr}◆</b><span>−1⚠ · krizové PR, pro všechny</span></div>
        <div><b>2◆</b><span>−1⚠ · Politik</span></div>
        <div><b>—</b><span>−1⚠ · Podvodník, jen akce</span></div>
        <div><b>3$</b><span>−2⚠ · Mafián, potřebuje vládní podnik</span></div>
      </div>
      <p>Skandály mažou i karty obrany. Ochrana zastaví <b>všechny</b> skandály z jednoho cizího úderu najednou.</p>
      `,
    },
    {
      id: "roofs",
      icon: "🛡",
      title: "Ochrana a obrana",
      html: `
      <ul>
        <li>Ochrana <b>sama</b> zastaví jakýkoli úder soupeře na vás: kartu, výpalné, sankce, šedý kšeft, převzetí role, skandály. Spotřebuje se 1 Ochrana a celý úder je zrušen.</li>
        <li>Před vašimi vlastními rozhodnutími Ochrana nechrání: skandál za váš šedý kšeft a za kryptopodvod přijde vždycky.</li>
        <li>U Řízeného úniku a Očerňující kampaně dostanete svůj skandál jen tehdy, když úder projde. Pokud ho Ochrana cíle zastavila, nic se vám nestane.</li>
        <li>Ochranu spotřebuje jakýkoli úder, takže soupeře můžete nejdřív „odkrýt“ levným útokem a pak udeřit naplno.</li>
        <li>Koupě Ochrany: 1 akce a <code>3$ + (kolo − 1)/2</code>, zaokrouhleno dolů. Mafián platí o 1$ méně. Mít můžete 1 Ochranu, Mafián 2. Některé podniky a projekty limit zvyšují.</li>
        <li>Všechny tři karty obrany dávají stejnou Ochranu.</li>
      </ul>
      `,
    },
    {
      id: "cards",
      icon: "🃏",
      title: "Karty akcí",
      html: `
      <p>Nákup: <b>1 akce</b>, ${n.cardCost}$ a 1◆ — vezmete si <b>dvě</b> náhodné karty. Jen <b>jednou za tah</b>. V balíčku jsou od každé karty dvě kopie. V ruce můžete mít nejvýš 3 karty.</p>
      <p><b>Hrát a zahazovat můžete, kolik chcete</b>, bez akce. Zahození dá ${n.discard}$ nebo ${n.discard}◆.</p>
      <p><b>Některé karty můžete zahrát na sebe:</b> ${selfCards}. To je tah pro Novináře, který potřebuje vlastní skandály. Úder na sebe vaše Ochrana nezastaví a bonusy útočníka za něj nejsou.</p>
      ${ctx.html.cardTable(labels)}
      `,
    },
    {
      id: "project-catalog",
      icon: "📜",
      title: "Všechny projekty",
      html: `
      <p>Ve hře je celý balíček, ale na desce jsou najednou jen čtyři projekty, v náhodném pořadí.</p>
      ${ctx.html.projectTable(labels)}
      `,
    },
    {
      id: "catalog",
      icon: "📚",
      title: "Všechny podniky",
      html: `
      <p>Vzácnost je cenová úroveň a kolo, od kterého se karta může objevit na trhu. Dražší neznamená výnosnější: příjem z karty je u všech vzácností podobný. Rozdíl je v bodech (polovina ceny) a ve vlastnostech karty. Epické a legendární podniky v celé čtvrti dávají ještě +1◆ za kolo.</p>
      ${ctx.html.rarityLadder(labels)}
      <p>Níže jsou všechny podniky podle čtvrtí.</p>
      ${ctx.html.assetTables(labels)}
      `,
    },
    {
      id: "strategy",
      icon: "🧭",
      title: "Tipy",
      html: `
      <ol>
        <li><b>Než začnete kupovat, podívejte se na projekty.</b> Projekty dávají nejvíc bodů a jejich podmínky napoví, jaké podniky potřebujete.</li>
        <li><b>Příjem je lepší než úspory.</b> Dobrý podnik platí každé kolo a peníze mají na konci malou cenu.</li>
        <li><b>Stavte čtvrti.</b> 2 podniky ve čtvrti zapnou synergii, 4 dají dvojitou synergii a +1◆ u epických a legendárních.</li>
        <li><b>Vyberte roli, která sedí k vašemu plánu</b>, ne „tu nejsilnější“.</li>
        <li><b>Hlídejte si skandály</b> a bez důvodu se nepřibližujte k limitu.</li>
        <li><b>Poslední hráč jde první</b> a první vybírá na trhu i mezi projekty.</li>
        <li><b>Na konci utraťte všechno</b> za projekty, podniky a body: po posledním kole výplata není.</li>
      </ol>
      `,
    },
  ];
}
