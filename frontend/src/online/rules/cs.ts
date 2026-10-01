import type { RoleGuide, RulesChapter, RulesContext, TableLabels } from "../rulesDocument";

/* Kniha pravidel česky — stejné kapitoly a formulace jako ruská tištěná pravidla, jen bez snímků
 * obrazovky (rozhraní na nich je rusky). Čísla bere z ctx, ikonky u pojmů přidává rulesTerms.ts.
 * Jednoduchá slova a krátké věty. */

const labels: TableLabels = {
  asset: "Podnik",
  price: "Cena",
  income: "Příjem/kolo",
  influence: "◆ hned",
  effect: "Vlastnost",
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
  perk: "Bonus",
  roleHeads: { perks: "Stále", powers: "Schopnosti", cost: "Cena", limit: "Limit", effect: "Účinek", tip: "Tip", warning: "Pozor" },
  onMarketFrom: round => `na trhu od ${round}. kola`,
  and: " a ",
};

const roles: Record<string, RoleGuide> = {
  capitalist: {
    style: "Peněžní role: víc peněz z každého podniku. <b>Synergie čtvrtí:</b> Obchodní čtvrť, Průmyslová zóna.",
    perks: [
      "Každý váš podnik dává +1$.",
      "Podniky v Obchodní čtvrti dávají ještě +1$.",
      "Na konci kola dostanete 1◆ za každý svůj podnik v Průmyslové zóně.",
    ],
    powers: [
      {
        name: "🏷️ Zabrat kartu",
        cost: "1 akce a 1 skandál",
        limit: "značka může být jen jedna: nová ruší starou",
        effect: "Označte podnik na trhu. Pracuje pro vás, jako by byl váš: přináší příjem, počítá se do synergie a do podmínek projektů a otevírá šedé kšefty. Body nedává a místo nezabírá. Koupit ho pořád může kdokoli. Značka zmizí, když ztratíte roli. Značka nemění koloběh trhu: starý označený podnik ze stolu stejně odejde.",
      },
    ],
  },
  politician: {
    style: "Role kontroly: vliv z bydlení v celém městě a levné čištění skandálů. <b>Synergie čtvrtí:</b> Vládní čtvrť, Sídliště.",
    perks: [
      "Podniky ve Vládní čtvrti dávají +1$.",
      "Na konci kola dostanete 1◆ za každý podnik na Sídlišti, který stojí na místě, — počítají se vaše i cizí.",
    ],
    powers: [
      { name: "Urovnat skandál", cost: "1 akce a 2◆", limit: "lze opakovat", effect: "Smažte 1 svůj skandál." },
      {
        name: "Domluvíme se",
        cost: "3◆ a 1 skandál, bez akce; potřebujete svůj podnik v Šedé zóně",
        limit: "jednou za tah",
        effect: "Získáte pronájem libovolné čtvrti (viz „Pronájem čtvrti“).",
      },
      {
        name: "Veto",
        cost: "1 akce a 3◆",
        limit: "veto může být jen jedno",
        effect: "Vyberte projekt na desce: vzít ho můžete jen vy, ostatní hráči ho získat nemohou. Veto vidí všichni. Zmizí, když projekt odejde z desky nebo když ztratíte roli.",
      },
    ],
  },
  journalist: {
    style: "Role skandálů: cizí skandály přinášejí peníze, vlastní vliv. <b>Synergie čtvrtí:</b> Obchodní čtvrť, Sídliště.",
    perks: [
      "Na konci kola dostanete 1$ za každý skandál soupeřů, nebo 2$, pokud máte aspoň jeden podnik v Obchodní čtvrti.",
      "Na konci kola dostanete 1◆ za každý svůj skandál, pokud máte aspoň jeden podnik na Sídlišti.",
      "Váš limit skandálů je o 1 vyšší: roli ztratíte při 6 skandálech a zatčení přijde při 7.",
    ],
    powers: [
      {
        name: "Nafouknout aféru",
        cost: "zdarma, bez akce",
        limit: "jednou za tah",
        effect: "Vy i vybraný soupeř dostanete po 1 skandálu. Pokud úder zastaví Ochrana soupeře, nedostanete svůj skandál ani vy.",
      },
      { name: "Zveřejnit článek", cost: "1 akce a 3◆", limit: "jednou za tah", effect: "Soupeř dostane 2 skandály." },
    ],
  },
  fraudster: {
    style: "Riskantní role: víc akcí a spolehlivější šedé kšefty. <b>Synergie čtvrtí:</b> Tech klastr.",
    perks: [
      "<b>4 akce</b> za tah místo 3.",
      "Podniky v Tech klastru dávají +1$.",
      "Vaše šedé kšefty mají o 30 % vyšší šanci na úspěch.",
    ],
    powers: [
      { name: "Zamést stopy", cost: "1 akce", limit: "lze opakovat", effect: "Smažte 1 svůj skandál." },
      {
        name: "Kryptopodvod",
        cost: "1 akce; potřebujete svou „Městskou kryptoburzu“",
        limit: "jednou za tah",
        effect: "Vezměte 25 % peněz každému soupeři. Dostanete 5 skandálů. Účinky, které snižují skandály ze šedých kšeftů, snižují i tyto.",
      },
    ],
  },
  mafia: {
    style: "Role síly: výpalné a levná Ochrana. <b>Synergie čtvrtí:</b> Šedá zóna.",
    perks: [
      "Podniky v Šedé zóně dávají +1$.",
      "Ochrana vás stojí o 1$ méně a můžete mít 2 Ochrany místo jedné.",
    ],
    powers: [
      {
        name: "Výpalné",
        cost: "1 akce; potřebujete svůj podnik v Šedé zóně",
        limit: "jednou za tah",
        effect: "Vyberte soupeře. Dá vám peníze: 2$, další 2$ za každý váš podnik v Šedé zóně a číslo kola děleno 3. Pokud je cíl lídr, přidejte ještě 5$. Cíl vám navíc dá 1◆ za každý váš podnik ve Vládní čtvrti. Cíl nemůže dát víc, než má. Pokud nemáte podnik ve Vládní čtvrti, dostanete 1 skandál.",
      },
      {
        name: "Ututlat",
        cost: "1 akce a 3$; potřebujete svůj podnik ve Vládní čtvrti",
        limit: "lze opakovat",
        effect: "Smažte až 2 své skandály.",
      },
      {
        name: "🔒 Šedá blokace",
        cost: "1 Ochrana, bez akce",
        limit: "jednou za tah",
        effect: "Označte podnik na trhu: do konce příštího kola ho můžete koupit jen vy. Šedá blokace může být jen jedna: nová nahrazuje starou. Blokace zmizí na konci příštího kola.",
      },
    ],
  },
  military: {
    style: "Trestající role: tvrdě zasáhne ty, kdo mají hodně skandálů. <b>Synergie čtvrtí:</b> Průmyslová zóna.",
    perks: ["Podniky v Průmyslové zóně dávají +1$."],
    powers: [
      {
        name: "Sankce",
        cost: "1 akce",
        limit: "jednou za tah; cíl musí mít aspoň 2 skandály",
        effect: "Čím víc skandálů cíl má, tím silnější úder: 2 skandály — cíl vám dá až (3 + číslo kola)$; 3 skandály — navíc až (2 + číslo kola ÷ 4)◆; 4 skandály a víc — přijde i o roli. Skandály cíli zůstávají.",
      },
      {
        name: "Kontrola",
        cost: "1 akce",
        limit: "jednou za tah; potřebujete aspoň jednoho soupeře s podnikem v Šedé zóně",
        effect: "Každý soupeř s podnikem v Šedé zóně dostane 1 skandál.",
      },
      {
        name: "Sebrat Ochranu",
        cost: "1 akce a 3◆",
        limit: "potřebujete volné místo na Ochranu",
        effect: "Vezměte soupeři 1 Ochranu.",
      },
    ],
  },
};

export function bookCs(ctx: RulesContext): RulesChapter[] {
  const { n, rolePrice, meta } = ctx;
  const [slot4, slot5, slot6] = n.capacityCosts;
  const lateRound = Math.max(...Object.values(meta.rarity_min_round ?? { legendary: 8 }));
  const campaign = n.campaign[0] ?? { spend: 5, gain: 3 };
  const selfCards = ctx.list(ctx.selfTargetCards, labels.and) || "některé karty skandálů";
  return [
    {
      id: "intro",
      icon: "🏙️",
      title: "O hře",
      html: `
      <div class="tip"><b>Vyhrává hráč, který má po posledním kole nejvíc bodů.</b> Body se dají získat mnoha způsoby, ale hlavní zdroje jsou trh s jeho podniky a městské projekty.</div>
      <p>Kupujete podniky v šesti čtvrtích města, vybíráte si roli se zvláštními schopnostmi a berete městské projekty dřív než soupeři. Trh podniků i deska projektů jsou společné: co vezmete vy, to ostatní nedostanou.</p>
      <p>Hrají 2–4 hráči. Běžná hra má 15 kol, role stojí ${rolePrice}◆ a každý začíná s 10$ a 2◆. (Tyto hodnoty si před každou hrou můžete změnit, ale hra pak může být trochu méně vyvážená.)</p>
      <h3>Značky</h3>
      <ul data-terms="off">
        <li>$ <b>Peníze</b> — na nákup podniků, míst, projektů, karet akcí a Ochrany.</li>
        <li>◆ <b>Vliv</b> — na role, projekty a schopnosti rolí.</li>
        <li>⚠ <b>Skandály</b> — každý, který zůstane na konci hry, vezme 1 bod. Nejvýš jich může být 6. Hlídejte si je: hodně skandálů přináší potíže (viz „Skandály a zatčení“).</li>
        <li>🛡 <b>Ochrana</b> — chrání vás před škodlivými účinky mířenými na vás (viz „Ochrana“).</li>
        <li>★ <b>Skóre</b> — vlastně jediné, na čem po posledním kole záleží: vyhrává hráč s nejvíc body.</li>
        <li>⚡ <b>Akce</b> — z nich se skládá váš tah (viz „Kolo a tah“).</li>
      </ul>
      <h3>Co je na stole</h3>
      <ul>
        <li><b>Trh</b> — 6 podniků na prodej. Ostatní leží v balíčku trhu. Celkem ${meta.assets.length} karet.</li>
        <li><b>Deska projektů</b> — ${n.projectBoardSize} městské projekty. Ostatní leží v balíčku projektů. Celkem ${meta.projects.length} karet.</li>
        <li><b>Balíček karet akcí</b> — ${meta.action_cards.length * 2} karet: ${meta.action_cards.length} různých karet, každá dvakrát.</li>
        <li><b>Vaše město</b> — podniky, které jste koupili. Každý podnik zabírá jedno <b>místo</b>.</li>
        <li><b>Ruka</b> — koupené karty, které můžete zahrát.</li>
      </ul>
      `,
    },
    {
      id: "market",
      icon: "🏪",
      title: "Podniky na trhu",
      html: `
      <h3>Nákup a prodej</h3>
      <p>Chcete-li koupit podnik, utraťte 1 akci, zaplaťte cenu a dejte podnik na volné místo ve městě. Podnik dává body, příjem a někdy i zvláštní bonusy.</p>
      <p>Uvolněné místo na trhu hned zaplní další podnik z balíčku.</p>
      <p>Prodat podnik můžete bez akce. Dostanete polovinu jeho ceny a místo se uvolní.</p>
      <h3>Moje město</h3>
      <p>Na začátku máte 3 místa. Čtvrté místo stojí ${slot4}$, páté ${slot5}$, šesté ${slot6}$. Nejvýš 6 míst. Otevření místa stojí 1 akci.</p>
      <h3>Příjem</h3>
      <p>Karta podniku na trhu ukazuje celkový příjem a bonusy, které při koupi dostanete, se všemi synergiemi a podmínkami, které teď plníte.</p>
      <p>Podrobnosti a ještě skryté bonusy uvidíte, když na kartu kliknete.</p>
      <p>Karta na vašem místě ukazuje příjem průběžně: když splníte další podmínku nebo o ni přijdete, karta se hned změní.</p>
      `,
    },
    {
      id: "districts",
      icon: "🗺",
      title: "Čtvrti a vzácnost",
      html: `
      <h3>Čtvrti a synergie</h3>
      <p>Město má šest čtvrtí: ${ctx.list(meta.districts.map(district => ctx.e(district.title)), labels.and)}. Čím víc podniků máte v jedné čtvrti, tím víc pasivního příjmu každý z nich přináší:</p>
      <ul>
        <li><b>2–3 podniky</b> ve čtvrti: každý dává +1$.</li>
        <li><b>4 podniky a víc</b>: každý dává +2$. Taková čtvrť je <b>plná</b>: epické a legendární podniky plné čtvrti dávají ještě +1◆ na konci každého kola.</li>
      </ul>
      <h3>Pronájem čtvrti</h3>
      <p>Některé účinky dávají <b>pronájem čtvrti</b>: do konce kola se vybraná čtvrť počítá, jako byste v ní měli o 1 podnik víc. Pronájem platí pro synergii, podmínky projektů, šedé kšefty a schopnosti rolí. Trvalé bonusy rolí ho nevidí — počítají jen skutečné podniky. Pronájem může být jen jeden: nový nahrazuje starý.</p>
      <h3>Štítky a vzácnost</h3>
      <p>Každá karta podniku má <b>štítky</b>: ${["finance", "data", "logistics", "production"].map(tag => `„${ctx.e(ctx.tag(tag))}“`).join(", ")} a další. Kontrolují je podmínky mnoha projektů.</p>
      <p><b>Vzácnost</b> určuje cenu podniku a kolo, od kterého se objevuje na trhu:</p>
      ${ctx.html.rarityLadder(labels)}
      <p>Vzácnější a dražší podniky dávají víc bodů (počet je na kartě) a silnější synergie. Legendární karty mohou dávat jedinečné bonusy, které mohou změnit průběh hry.</p>
      `,
    },
    {
      id: "projects",
      icon: "🏛",
      title: "Městské projekty",
      html: `
      <p>Projekt nepatří nikomu: dostane ho ten, kdo první splní podmínku a zaplatí cenu.</p>
      <p>Projekty jsou 4 druhů (poznáte je podle rubu karty):</p>
      <ul>
        <li><b>Obyčejný</b> — dává jen body.</li>
        <li>Projekt, který dává peníze každé kolo.</li>
        <li>Projekt, který dává vliv každé kolo.</li>
        <li>Projekt, který dává jedinečný bonus.</li>
      </ul>
      <p>Cena projektu záleží na tom, jak je těžký a jaký dává bonus.</p>
      ${ctx.html.projectExample({ heading: "Skutečná karta projektu", caption: "Ukázka je z katalogu hry.", title: "Název", points: "Body", condition: "Podmínka", price: "Cena", reward: "Trvalý bonus", action: "1 akce" })}
      <ul>
        <li><b>Body</b> — přičtou se k vašemu skóre na konci hry.</li>
        <li><b>Podmínka</b> — co už musíte mít: podniky v určité čtvrti, podniky se štítkem, počet podniků, málo skandálů nebo jakoukoli roli. Ukazatel pod podmínkou ukazuje, jak blízko jste.</li>
        <li><b>Cena</b> — vliv a peníze.</li>
        <li><b>Trvalý bonus</b> — projekt dává bonus, který zůstane do konce hry.</li>
      </ul>
      <h3>Jak vzít projekt</h3>
      <p>Splňte podmínku, utraťte 1 akci a zaplaťte cenu. Na uvolněné místo hned přijde nový projekt.</p>
      <h3>Znovu rozdat desku</h3>
      <p>Jednou za tah můžete utratit 1 akci a ${n.reroll}$: všechny ${n.projectBoardSize} projekty jdou zpět do balíčku, balíček se zamíchá a vyjdou ${n.projectBoardSize} nové projekty.</p>
      `,
    },
    {
      id: "flow",
      icon: "⏳",
      title: "Kolo a tah",
      html: `
      <h3>Pořadí tahů</h3>
      <p>V každém kole táhne každý hráč jednou. První táhne ten, kdo má nejméně bodů. Poslední táhne <b>lídr</b> — hráč s nejvíc body. Při stejném počtu bodů táhne dřív ten, kdo v minulém kole táhl později.</p>
      <p>Hru začíná náhodný hráč.</p>
      <h3>Akce</h3>
      <p>Ve svém tahu dostanete <b>3 akce</b>. Akcemi se platí skoro všechno: nákup podniku, místa, karet nebo Ochrany, vzetí projektu nebo role, šedý kšeft, většina schopností rolí. Zdarma je prodej podniků a hraní i odhazování karet. Celý seznam najdete v „Taháku“.</p>
      <p>Nevyužité akce na konci tahu propadnou.</p>
      <h3>Konec kola</h3>
      <p>Když všichni odehráli, kolo končí. Každý hráč dostane příjem svých podniků a pak platí všechny účinky „na konci kola“ a „každé kolo“ — rolí, projektů, podniků a karet.</p>
      <p>Pak začne nové kolo:</p>
      <ol>
        <li>Pořadí tahů se znovu určí podle bodů.</li>
        <li>${n.rotation} podniky, které jsou na trhu nejdéle (označené ⏳), odejdou ze stolu a jejich místa zaplní nové z balíčku. Staré podniky jdou do odhozu.</li>
        <li>Projekt úplně vlevo (označený ⏳) jde na spodek balíčku projektů. Ostatní projekty se posunou o místo doleva a jako poslední se přidá nový projekt z balíčku.</li>
      </ol>
      <p><b>Balíček trhu.</b> Do ${lateRound}. kola vycházejí podniky z balíčku popořadě — od obyčejných k legendárním, jak se otevírá jejich vzácnost. Od ${lateRound}. kola, kdy jsou otevřené všechny vzácnosti, vycházejí vzácné, epické a legendární karty z balíčku pořád první a ostatní místa zaplní náhodná karta z balíčku a odhozu. Čím vzácnější karta, tím větší šance, že padne: obyčejné a neobvyklé podniky jsou na konci hry jen výplň.</p>
      <div class="warn"><b>Po posledním kole se příjem nevyplácí.</b> Všechno, co byste vydělali na konci posledního kola, je nula, takže peníze a vliv utraťte během posledního kola.</div>
      `,
    },
    {
      id: "roles",
      icon: "🎭",
      title: "Role",
      html: `
      <p>Role dává trvalé bonusy a schopnosti. Můžete mít jen jednu roli. Pokud máte na konci hry roli, dostanete za ni 3 body.</p>
      <h3>Jak získat roli</h3>
      <p>Volná role stojí 1 akci a ${rolePrice}◆. Role jiného hráče stojí 1 akci a ${rolePrice * 3}◆: on o ni přijde. Když hráč roli ztratí, může ji znovu vzít kdokoli za ${rolePrice}◆.</p>
      <p><b>Pokud má držitel role Ochranu, jeho roli vzít nelze.</b></p>
      <p>S 5 a víc skandály roli vzít nemůžete.</p>
      <h3>Ztráta role</h3>
      <p>Roli ztratíte automaticky, když dosáhnete 5 a víc skandálů.</p>
      <p>Ostatní hráči vás mohou o roli připravit různými herními mechanikami, třeba šedými kšefty nebo schopnostmi Bezpečáka, nebo tlakem skandálů.</p>
      <h3>Schopnosti</h3>
      <p>Každá schopnost má svou cenu a svůj limit. „Bez akce“ znamená, že schopnost nespotřebuje akce vašeho tahu.</p>
      ${ctx.html.roleCards(roles, labels)}
      `,
    },
    {
      id: "grey",
      icon: "🕶",
      title: "Šedé kšefty",
      html: `
      <p>Šedý kšeft otevírá čtvrť: stačí mít aspoň jeden podnik ve správné čtvrti. Kšeft stojí 1 akci a za tah můžete udělat jen jeden.</p>
      <table>
        <thead><tr><th>Kšeft</th><th>Potřebný podnik</th><th>Šance</th><th>Účinek při úspěchu</th><th>★</th></tr></thead>
        <tbody>
          <tr><td class="name"><b>Pomluvy</b></td><td>Šedá zóna</td><td class="num">${n.greyChance("smear", 60)} %</td><td>Každý soupeř dostane 1⚠</td><td class="num">+${n.greyPoints("smear", 2)}</td></tr>
          <tr><td class="name"><b>Pump and dump</b></td><td>Tech klastr nebo Šedá zóna</td><td class="num">${n.greyChance("crypto", 45)} %</td><td>Vezměte každému soupeři až (${n.pumpBase} + číslo kola ÷ 2)$</td><td class="num">+${n.greyPoints("crypto", 2)}</td></tr>
          <tr><td class="name"><b>Prolomit Ochranu</b></td><td>Šedá zóna</td><td class="num">${n.greyChance("roof_break", 60)} %</td><td>Sundejte cíli všechnu Ochranu a za každou sundanou dostanete ${n.roofBreakPoint}★</td><td class="num">+${n.greyPoints("roof_break", 2)}</td></tr>
          <tr><td class="name"><b>Hack</b></td><td>Tech klastr nebo Šedá zóna</td><td class="num">${n.greyChance("datacenter", 40)} %</td><td>Vezměte cíli až (${n.hackBase} + číslo kola ÷ 3)◆</td><td class="num">+${n.greyPoints("datacenter", 3)}</td></tr>
          <tr><td class="name"><b>Únik špíny</b></td><td>Vládní čtvrť i Šedá zóna (obě)</td><td class="num">${n.greyChance("influence_broker", 60)} %</td><td>Cíl přijde o roli</td><td class="num">+${n.greyPoints("influence_broker", 3)}</td></tr>
        </tbody>
      </table>
      <p><b>Úspěch:</b> účinek nastane, dostanete body z tabulky a ${n.greySuccess} skandál. <b>Neúspěch:</b> účinek nenastane a dostanete ${n.greyFailure} skandály. Akce se utratí v každém případě. Dělení ve vzorcích se zaokrouhluje dolů.</p>
      <p>Ochrana cíle účinek zastaví, ale body za úspěch i svůj skandál dostanete stejně. Pomluvy a Pump and dump zasáhnou všechny soupeře najednou, takže Ochrana každého funguje zvlášť. Prolomení Ochrany Ochrana nezastaví: úder míří právě na ni.</p>
      `,
    },
    {
      id: "scandals",
      icon: "⚠",
      title: "Skandály a zatčení",
      html: `
      <p>Každý skandál, který zůstane na konci hry, vezme 1 bod. Dokud máte méně než 5 skandálů, nic jiného se neděje.</p>
      <ul>
        <li><b>5 skandálů:</b> hned ztratíte roli a novou vzít nemůžete.</li>
        <li><b>6 skandálů:</b> zatčení.</li>
      </ul>
      <h3>Zatčení</h3>
      <p>Při zatčení klesnou vaše skandály na 3 a přijdete o roli a o 1 Ochranu. V příštím tahu budete mít jen 1 akci. Pokud vás zatknou ve vašem tahu, tah hned skončí.</p>
      <h3>Jak se zbavit skandálů</h3>
      <p><b>Krizové PR</b> může použít každý: 1 akce a ${n.crisisPr}◆ smažou 1 skandál. Můžete ho opakovat, dokud máte akce a vliv. Další způsoby dávají role, karty akcí, podniky a projekty — je to na nich napsané. Ve hře najdete všechny své možnosti pod tlačítkem „Čištění“.</p>
      <p>Pokud nemáte roli, na začátku každého vašeho tahu sám zmizí 1 skandál.</p>
      `,
    },
    {
      id: "roofs",
      icon: "🛡",
      title: "Ochrana",
      html: `
      <p>Ochrana vás zachrání před jedním úderem soupeře: útočnou kartou, schopností role nebo šedým kšeftem. Když na vás někdo zaútočí, Ochrana zafunguje sama: přijdete o 1 Ochranu a celý úder se zruší, i se všemi skandály, které by vám přinesl.</p>
      <p><b>Dokud máte Ochranu, nikdo vám nemůže vzít roli.</b> Ochrana se přitom nespotřebuje.</p>
      <p>Útočník nedostane zpět, co za úder utratil, pokud popis úderu neříká jinak.</p>
      <p>Před vašimi vlastními činy Ochrana nechrání. Skandál za vlastní šedý kšeft nebo kryptopodvod dostanete vždycky.</p>
      <h3>Jak získat Ochranu</h3>
      <p>Kupte ji za 1 akci a <code>3$ + (číslo kola − 1) ÷ 2</code>. Mít můžete jen 1 Ochranu. Některé role, podniky a projekty tento limit zvyšují nebo dávají Ochranu zdarma.</p>
      `,
    },
    {
      id: "cards",
      icon: "🃏",
      title: "Karty akcí",
      html: `
      <p>Jednou za tah můžete utratit 1 akci, ${n.cardCost}$ a 1◆ a vzít z balíčku <b>2 náhodné karty</b>. V ruce můžete mít nejvýš 3 karty. Pokud už máte 2 karty, doberete jen do 3.</p>
      <p>Hrát a odhazovat karty můžete kolikrát chcete a bez akce. Za každou odhozenou kartu dostanete ${n.discard}$ nebo ${n.discard}◆ podle výběru.</p>
      <p>Každá karta je v balíčku dvakrát. „Číslo kola“ znamená číslo aktuálního kola: v 5. kole přičtěte 5.</p>
      <p>Útoky se hrají na soupeře. Na sebe můžete zahrát ${selfCards}.</p>
      ${ctx.html.cardTable(labels)}
      `,
    },
    {
      id: "end",
      icon: "🏆",
      title: "Konec hry",
      html: `
      <p>Hra končí po posledním kole. Příjem za něj se nevyplácí. Sečtěte body:</p>
      <ul>
        <li><b>Projekty</b> — body z karet, 1 až 9 za projekt.</li>
        <li><b>Podniky</b> — polovina ceny každého podniku. Číslo je vytištěné na kartě.</li>
        <li><b>Role</b> — 3 body, pokud ji máte.</li>
        <li><b>Body získané během hry</b> — za mecenášství, lobbing, karty akcí a šedé kšefty.</li>
        <li><b>Skandály</b> — mínus 1 bod za každý.</li>
      </ul>
      <p>Zbylé peníze a vliv body nedávají: jsou to zdroje, ne body. Utraťte je do konce hry, nebo je proměňte v body patronátem a lobbingem.</p>
      <div class="tip">Vyhrává hráč s nejvíc body. <b>Při stejném počtu bodů vyhrává hráč, který koupil víc městských projektů.</b></div>
      `,
    },
    {
      id: "memo",
      icon: "📋",
      title: "Tahák",
      html: `
      <p>Co můžete udělat ve svém tahu:</p>
      <table>
        <thead><tr><th>Tah</th><th>Cena</th><th>Omezení</th></tr></thead>
        <tbody>
          <tr><td class="name">Koupit podnik</td><td>1⚡ + cena</td><td>Potřebujete volné místo</td></tr>
          <tr><td class="name">Prodat podnik</td><td>Bez akce</td><td>Dostanete polovinu ceny</td></tr>
          <tr><td class="name">Koupit místo</td><td>1⚡ + ${n.capacityCosts.join(" / ")}$</td><td>Nejvýš 6 míst</td></tr>
          <tr><td class="name">Vzít projekt</td><td>1⚡ + cena projektu</td><td>Podmínka splněna</td></tr>
          <tr><td class="name">Znovu rozdat desku projektů</td><td>1⚡ + ${n.reroll}$</td><td>Jednou za tah</td></tr>
          <tr><td class="name">Vzít volnou roli</td><td>1⚡ + ${rolePrice}◆</td><td>Méně než 5⚠</td></tr>
          <tr><td class="name">Vzít roli jinému hráči</td><td>1⚡ + ${rolePrice * 3}◆</td><td>Méně než 5⚠, držitel nemá Ochranu🛡</td></tr>
          <tr><td class="name">Vzít 2 karty akcí</td><td>1⚡ + ${n.cardCost}$ + 1◆</td><td>Jednou za tah, v ruce nejvýš 3 karty</td></tr>
          <tr><td class="name">Zahrát nebo odhodit kartu</td><td>Bez akce</td><td>Odhození: ${n.discard}$ nebo ${n.discard}◆</td></tr>
          <tr><td class="name">Šedý kšeft</td><td>1⚡</td><td>Jeden za tah</td></tr>
          <tr><td class="name">Koupit Ochranu</td><td>1⚡ + 3$ + (kolo − 1) ÷ 2</td><td>Do limitu Ochrany🛡</td></tr>
          <tr><td class="name">Krizové PR</td><td>1⚡ + ${n.crisisPr}◆</td><td>Smaže 1⚠</td></tr>
          <tr><td class="name">Směna</td><td>1⚡ + ${campaign.spend}$</td><td>Dostanete ${campaign.gain}◆</td></tr>
          <tr><td class="name">Mecenášství</td><td>1⚡ + ${n.patronage.money}$</td><td>Dostanete ${n.patronage.points}★, jednou za tah</td></tr>
          <tr><td class="name">Lobbing</td><td>1⚡ + ${n.lobbying.influence}◆</td><td>Dostanete ${n.lobbying.points}★, jednou za tah</td></tr>
          <tr><td class="name">Schopnost role</td><td>Podle role</td><td>Podle role</td></tr>
        </tbody>
      </table>
      `,
    },
    {
      id: "project-catalog",
      icon: "📜",
      title: "Všechny projekty",
      html: `
      <p>Na desce leží zároveň ${n.projectBoardSize} projekty z balíčku.</p>
      ${ctx.html.projectTable(labels)}
      `,
    },
    {
      id: "catalog",
      icon: "📚",
      title: "Všechny podniky",
      html: `
      <p>Sloupec „◆ hned“ je vliv, který dostanete při koupi. Bonus plné čtvrti (+1◆ za kolo pro epické a legendární podniky) se v tabulkách neopakuje.</p>
      ${ctx.html.rarityLadder(labels)}
      ${ctx.html.assetTables(labels)}
      `,
    },
    {
      id: "strategy",
      icon: "🧭",
      title: "Tipy",
      html: `
      <ol>
        <li><b>Dívejte se na projekty dřív, než koupíte podniky.</b> Projekty přinášejí nejvíc bodů a jejich podmínky napoví, co kupovat.</li>
        <li><b>Příjem je lepší než úspory.</b> Dobrý podnik přináší peníze každé kolo a na konci hry peníze skoro nic nestojí.</li>
        <li><b>Stavte čtvrti.</b> 2 podniky ve čtvrti zapnou synergii, 4 ji zdvojnásobí.</li>
        <li><b>Vyberte roli podle své strategie</b>, ne tu, která vypadá nejsilněji.</li>
        <li><b>Hlídejte si skandály.</b> Nechoďte k limitu bez důvodu: Bezpečák udeří tím silněji, čím víc jich máte.</li>
        <li><b>Nejdřív sundejte Ochranu.</b> Ochrana zastaví jakýkoli úder, takže levný útok může soupeře „svléknout“ před tím vážným.</li>
        <li><b>Novináři se hodí vlastní skandály.</b> ${selfCards} může zahrát na sebe.</li>
        <li><b>Kdo prohrává, táhne první</b> a první vybírá na trhu i mezi projekty.</li>
        <li><b>V posledním kole utraťte všechno</b> za projekty, podniky a body: příjem už nepřijde.</li>
      </ol>
      `,
    },
    {
      id: "glossary",
      icon: "📖",
      title: "Slovník",
      html: `
      <table>
        <thead><tr><th>Pojem</th><th>Význam</th></tr></thead>
        <tbody>
          <tr><td class="name"><b>Číslo kola</b></td><td>Číslo aktuálního kola. V 5. kole je to 5.</td></tr>
          <tr><td class="name"><b>Lídr</b></td><td>Hráč s nejvíc body★. Táhne poslední.</td></tr>
          <tr><td class="name"><b>Místo</b></td><td>Místo pro jeden podnik. Na začátku 3, nejvýš 6.</td></tr>
          <tr><td class="name"><b>Ochrana</b></td><td>Ochrana🛡 před jedním úderem soupeře. Viz „Ochrana“.</td></tr>
          <tr><td class="name"><b>Plná čtvrť</b></td><td>Čtvrť, kde máte 4 podniky a víc.</td></tr>
          <tr><td class="name"><b>Pronájem čtvrti</b></td><td>Do konce kola se čtvrť počítá, jako byste v ní měli o 1 podnik víc. Viz „Pronájem čtvrti“.</td></tr>
          <tr><td class="name"><b>Synergie</b></td><td>Příplatek k příjmu za 2 a víc podniků v jedné čtvrti.</td></tr>
        </tbody>
      </table>
      `,
    },
  ];
}
