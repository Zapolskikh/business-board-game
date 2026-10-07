import type { GreyTableLabels, RoleGuide, RulesChapter, RulesContext, TableLabels } from "../rulesDocument";

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
        cost: "1 akce",
        limit: "značka může být jen jedna: nová ruší starou",
        effect: "Označte podnik na trhu. Dokud značka platí, počítá se jako váš: přináší příjem, počítá se do synergie čtvrti a do podmínek projektů a otevírá šedé kšefty. Místo nezabírá a body nedává a jeho účinek „při koupi“ neplatí. Koupit ho pořád může kdokoli. Značka zmizí, když podnik někdo koupí, když odejde z trhu nebo když ztratíte roli.",
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
        name: "Veto",
        cost: "bez akce",
        limit: "jednou za tah; veto může být jen jedno",
        effect: "Vyberte projekt na desce. Dokud veto platí, můžete ho vzít jen vy — nikdo jiný ho nevezme akcí ani kartou. Veto vidí všichni. Nové veto nahrazuje staré. Veto zmizí, když projekt odejde z desky, když se deska znovu rozdá nebo když ztratíte roli.",
      },
    ],
  },
  journalist: {
    style: "Role skandálů: cizí skandály přinášejí peníze, vlastní vliv. <b>Synergie čtvrtí:</b> Obchodní čtvrť, Sídliště.",
    perks: [
      "Na konci kola dostanete 1$ za každý skandál soupeřů, pokud máte aspoň jeden podnik v Obchodní čtvrti.",
      "Na konci kola dostanete 1◆ za každý svůj skandál, pokud máte aspoň jeden podnik na Sídlišti.",
      "Vaše limity skandálů jsou o 1 vyšší: roli ztratíte při 6 skandálech a zatčení přijde při 7. Když roli ztratíte, platí pro vás zase běžné limity a vaše skandály klesnou na 5.",
    ],
    powers: [
      {
        name: "Nafouknout aféru",
        cost: "bez akce",
        limit: "jednou za tah",
        effect: "Vy i vybraný soupeř dostanete po 1 skandálu. Pokud úder zastaví Ochrana soupeře, nedostanete svůj skandál ani vy.",
      },
      { name: "Zveřejnit článek", cost: "1 akce a 3◆", limit: "jednou za tah", effect: "Vybraný soupeř dostane 2 skandály." },
    ],
  },
  fraudster: {
    style: "Riskantní role: víc akcí a spolehlivější šedé kšefty. <b>Synergie čtvrtí:</b> Tech klastr.",
    perks: [
      "<b>4 akce</b> za tah místo 3. Akce se počítají na začátku tahu: když roli vezmete uprostřed tahu, čtvrtou akci dostanete až v příštím.",
      "Podniky v Tech klastru dávají +1$.",
      "+1 ke každému hodu šedého kšeftu: jednička vám nepadne.",
    ],
    powers: [
      { name: "Zamést stopy", cost: "1 akce", limit: "lze opakovat", effect: "Smažte 1 svůj skandál." },
      {
        name: "Kryptopodvod",
        cost: "1 akce; potřebujete svou „Městskou kryptoburzu“",
        limit: "jednou za tah",
        effect: "Vezměte každému soupeři čtvrtinu jeho peněz (zaokrouhleno dolů) a dostanete 3 skandály. Ochrana soupeře úder na něj zastaví a spotřebuje se. Je to schopnost role, ne šedý kšeft: účinky, které snižují skandály ze šedých kšeftů, tyto nesnižují.",
      },
    ],
  },
  mafia: {
    style: "Role síly: výpalné a levná Ochrana. <b>Synergie čtvrtí:</b> Šedá zóna.",
    perks: [
      "Podniky v Šedé zóně dávají +1$.",
      "Ochrana vás stojí o 1$ méně a můžete mít 2 Ochrany místo jedné.",
      "Když roli převezmete, dostanete 1 Ochranu.",
      "+1 k hodu šedého kšeftu za každý váš podnik v Šedé zóně, nejvýš +2 — hlavní síla role.",
    ],
    powers: [
      {
        name: "Výpalné",
        cost: "1 akce",
        limit: "jednou za tah",
        effect: "Vyberte soupeře. Dá vám peníze: 3$ + 2$ za každý váš podnik v Šedé zóně + číslo kola ÷ 3; lídr dá ještě 5$. A vliv: 1◆ + číslo kola ÷ 5 + 1◆ za každý váš podnik ve Vládní čtvrti. Cíl nemůže dát víc, než má. Pokud nemáte podnik ve Vládní čtvrti, dostanete 1 skandál. Ochrana cíle Výpalné zastaví a spotřebuje se: pak nedostanete nic, ani skandál.",
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
        effect: "Označte podnik na trhu: do konce příštího kola ho můžete koupit jen vy. Šedá blokace může být jen jedna: nová nahrazuje starou. Blokace zmizí dřív, když podnik odejde z trhu nebo když ztratíte roli.",
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
        effect: "Čím víc skandálů cíl má, tím silnější úder: 2 skandály — cíl vám dá až (3 + číslo kola)$; 3 skandály — navíc až (2 + číslo kola ÷ 4)◆; 4 skandály a víc — přijde i o roli. Skandály cíli zůstávají. Ochrana cíle Sankce zastaví a spotřebuje se.",
      },
      {
        name: "Kontrola",
        cost: "1 akce",
        limit: "jednou za tah; potřebujete aspoň jednoho soupeře s podnikem v Šedé zóně",
        effect: "Každý soupeř s podnikem v Šedé zóně dostane 1 skandál. Ochrana úder na svého majitele zastaví a spotřebuje se.",
      },
      {
        name: "Sebrat Ochranu",
        cost: "1 akce a 2◆",
        limit: "cíl musí mít Ochranu",
        effect: "Vezměte soupeři 1 Ochranu. Pokud už máte svůj limit, Ochrana jen zmizí. Před touto schopností Ochrana nechrání.",
      },
    ],
  },
};

const greyLabels: GreyTableLabels = {
  operations: {
    smear: { name: "Pomluvy", gate: "Šedá zóna · všichni soupeři bez Ochrany" },
    crypto: { name: "Pump and dump", gate: "Tech klastr nebo Šedá zóna · všichni soupeři bez Ochrany" },
    datacenter: { name: "Hack", gate: "Tech klastr nebo Šedá zóna · jeden cíl" },
    influence_broker: { name: "Únik špíny", gate: "Vládní čtvrť i Šedá zóna (obě) · jeden cíl s rolí" },
    roof_break: { name: "Prolomit Ochranu", gate: "Šedá zóna · všichni soupeři" },
  },
  face: "Hod",
  effect: "Účinek",
  scandals: "Vaše skandály",
  clean: "žádné",
  thirds: ["začátek hry", "střed", "konec"],
  effectText: (id, effect, tier) => {
    if (tier === "fail") return "—";
    const v = (key: string) => Number(effect[key] ?? 0);
    if (id === "smear") return v("influence_per_hit") ? `skandál každému, +${v("influence_per_hit")}◆ za každý` : "skandál každému";
    if (id === "crypto") return `${v("money_each")}$ od každého`;
    if (id === "datacenter") return `ukrást ${v("influence")}◆`;
    if (id === "influence_broker") return effect.strip_role ? `odebrat roli, vy +${v("influence")}◆` : `cíl +${v("target_scandals")}⚠, vy +${v("influence")}◆`;
    if (id === "roof_break") return v("influence_per_roof") ? `sundat všechnu Ochranu, +${v("influence_per_roof")}◆ za každou` : "sundat všem všechnu Ochranu";
    return "";
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
        <li>⚠ <b>Skandály</b> — každý, který zůstane na konci hry, vezme 1 bod. Při 5 skandálech ztratíte roli, při 6 vás zatknou (viz „Skandály a zatčení“).</li>
        <li>🛡 <b>Ochrana</b> — zastaví údery soupeřů na vás (viz „Ochrana“).</li>
        <li>★ <b>Skóre</b> — součet vašich bodů. Vyhrává hráč, který má po posledním kole nejvyšší skóre.</li>
        <li>⚡ <b>Akce</b> — platí se jimi skoro všechno, co ve svém tahu děláte (viz „Kolo a tah“).</li>
      </ul>
      <h3>Co je na stole</h3>
      <ul>
        <li><b>Trh</b> — 6 podniků na prodej. Ostatní leží v balíčku trhu; ve hře je celkem ${meta.assets.length} podniků.</li>
        <li><b>Deska projektů</b> — ${n.projectBoardSize} městské projekty. Ostatní leží v balíčku projektů; ve hře je celkem ${meta.projects.length} projektů.</li>
        <li><b>Balíček karet akcí</b> — ${meta.action_cards.length} různých karet; většina je v balíčku dvakrát, některé třikrát nebo čtyřikrát.</li>
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
      <p>Chcete-li koupit podnik, utraťte 1 akci, zaplaťte cenu a dejte podnik na volné místo ve městě. Podnik přináší příjem na konci každého kola a body na konci hry; některé podniky mají i zvláštní účinky.</p>
      <p>Uvolněné místo na trhu hned zaplní další podnik z balíčku.</p>
      <p>Prodat podnik můžete bez akce. Dostanete tolik peněz, kolik bodů je na kartě — polovinu ceny podniku, zaokrouhleno dolů. Místo se uvolní; prodaný podnik už nepřináší příjem a nepočítá se do podmínek ani bonusů.</p>
      <h3>Moje město</h3>
      <p>Na začátku máte 3 místa. Čtvrté místo stojí ${slot4}$, páté ${slot5}$ a ${n.capacityInfluence[1]}◆, šesté ${slot6}$ a ${n.capacityInfluence[2]}◆. Nejvýš 6 míst. Otevření místa stojí 1 akci.</p>
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
      <p>Město má šest čtvrtí: ${ctx.list(meta.districts.map(district => ctx.e(district.title)), labels.and)}. Čím víc podniků máte v jedné čtvrti, tím víc peněz každý z nich přináší:</p>
      <ul>
        <li><b>2–3 podniky</b> ve čtvrti: každý dává +1$.</li>
        <li><b>4 podniky a víc</b>: každý dává +2$. Taková čtvrť je <b>plná</b>: epické a legendární podniky plné čtvrti dávají ještě +1◆ na konci každého kola.</li>
      </ul>
      <h3>Štítky a vzácnost</h3>
      <p>Každá karta podniku má <b>štítky</b>: ${["finance", "data", "logistics", "production"].map(tag => `„${ctx.e(ctx.tag(tag))}“`).join(", ")} a další. Kontrolují je podmínky mnoha projektů. Čtvrť a štítek jsou dvě různé věci na kartě.</p>
      <p><b>Vzácnost</b> určuje cenu podniku a kolo, od kterého se objevuje na trhu:</p>
      ${ctx.html.rarityLadder(labels)}
      <p>Čím vzácnější a dražší podnik, tím víc bodů dává (počet je na kartě) a tím silnější má účinky. Legendární podniky mají jedinečné účinky: žádná jiná karta je nemá.</p>
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
        <li><b>Obyčejný</b> — jen body.</li>
        <li><b>S příjmem</b> — body a peníze každé kolo.</li>
        <li><b>S vlivem</b> — body a vliv každé kolo.</li>
        <li><b>Se zvláštním bonusem</b> — body a jedinečný trvalý účinek.</li>
      </ul>
      <p>Čím těžší podmínka a čím silnější bonus, tím je projekt dražší.</p>
      <p>Podmínka se kontroluje jen ve chvíli, kdy projekt berete. Projekt i jeho bonus vám zůstanou do konce hry, i když později prodáte podnik, který vám ho pomohl získat.</p>
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
      <p>V každém kole táhne každý hráč jednou. První táhne ten, kdo má nejméně bodů. Poslední táhne <b>lídr</b> — hráč s nejvíc body. Při stejném počtu bodů táhne dřív ten, kdo v minulém kole táhl později. Pořadí se určí na začátku kola a do jeho konce se nemění.</p>
      <p>V prvním kole je první hráč náhodný a ostatní táhnou po něm podle míst u stolu.</p>
      <p><b>Podpora poslednímu.</b> Na začátku každého kola kromě prvního dostane hráč s nejnižším skóre +${n.underdog}◆. Když se o poslední místo dělí víc hráčů, dostane každý z nich; když mají všichni stejně, nikdo.</p>
      <h3>Akce</h3>
      <p>Na začátku svého tahu dostanete <b>3 akce</b>. Akcemi se platí skoro všechno: nákup podniku, místa, karet nebo Ochrany, vzetí projektu nebo role, šedý kšeft, většina schopností rolí. Zdarma je prodej podniků a hraní i odhazování karet. Celý seznam najdete v „Taháku“.</p>
      <p>Nevyužité akce na konci tahu propadnou.</p>
      <h3>Konec kola</h3>
      <p>Když všichni odehráli, kolo končí. Nejdřív všichni zároveň dostanou příjem svých podniků a všechno, co je označené „na konci kola“ a „každé kolo“ — u rolí, projektů, podniků a karet. Pak se mažou skandály a přichází Ochrana (viz „Skandály a zatčení“ a „Ochrana“).</p>
      <p>Pak začne nové kolo:</p>
      <ol>
        <li>Pořadí tahů se znovu určí podle bodů.</li>
        <li>${n.rotation} podniky, které jsou na trhu nejdéle (označené ⏳), odejdou ze stolu a jejich místa zaplní nové z balíčku. Staré podniky jdou do odhozu.</li>
        <li>Projekt úplně vlevo (označený ⏳) jde na spodek balíčku projektů. Ostatní projekty se posunou o místo doleva a jako poslední se přidá nový projekt z balíčku.</li>
      </ol>
      <p><b>Balíček trhu.</b> Do ${lateRound}. kola vycházejí podniky z balíčku popořadě — od obyčejných k legendárním, jak se otevírá jejich vzácnost. Od ${lateRound}. kola, kdy jsou otevřené všechny vzácnosti, vycházejí vzácné, epické a legendární karty z balíčku pořád první a ostatní místa zaplní náhodná karta z balíčku a odhozu. Čím vzácnější karta, tím větší šance, že padne: obyčejné a neobvyklé podniky jsou na konci hry jen výplň. Na trhu leží současně nejvýš dva legendární podniky: třetí vyjde, až když se jeden z nich koupí nebo odejde.</p>
      <div class="warn"><b>Po posledním kole se nevyplácí nic:</b> ani příjem, ani vliv, skandály se nemažou a Ochrana nepřichází. Peníze a vliv utraťte během posledního kola. Jediná výjimka je dluh z karty «Překlenovací úvěr»: ten se strhne i na konci posledního kola.</div>
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
      <p>Roli ztratíte hned, jakmile máte 5 skandálů (Novinář — 6).</p>
      <p>O roli vás mohou připravit i soupeři: šedým kšeftem, schopností Bezpečáka, kartou, nebo prostě tím, že vás dotlačí k limitu skandálů.</p>
      <h3>Změna role</h3>
      <p>Chcete-li roli změnit, vezměte si jinou za běžnou cenu: ta původní je hned volná. Jen tak se role vzdát nelze.</p>
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
      <p><b>Hoďte kostkou.</b> Stěny 1–2 jsou neúspěch, nic se nestane. Stěny 3–4 dají slabý účinek, 5–6 plný. Skandály dostanete jen za neúspěch: na jedničce 2, na dvojce 1, od trojky výš žádný. Výjimkou je «Prolomit Ochranu»: na trojce stojí také 1 skandál. Šedé kšefty nedávají body — vše, co přinesou, je napsáno v účinku.</p>
      <p><b>Modifikátory</b> se přičítají k hodu, cokoli nad 6 se počítá jako šestka: Podvodník +${n.fraudsterRoll}, Mafián +1 za každý vlastní podnik v Šedé zóně (nejvýš +${n.mafiaRollMax}), karta «Podplatit ochranku» +2 k jednomu hodu. Dohromady nikdy víc než +${n.rollCap}. Ve hře okno šedých kšeftů ukazuje tabulku už přepočtenou pro vás.</p>
      <p><b>Ochrana</b> cíle zablokuje jakýkoli šedý kšeft celý a nespotřebuje se. Ochranu sundá jen «Prolomit Ochranu» — tím se stůl otevře před úderem. Kšefty proti všem zasáhnou jen soupeře bez Ochrany.</p>
      ${ctx.html.greyTables(greyLabels)}
      <p>Pump and dump a Hack rostou ke konci hry: každá třetina má svá čísla (při 15 kolech jsou třetiny kola 1–5, 6–10 a 11–15). Nikdy nevezmete víc, než cíl má.</p>
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
      <p>Když vás jeden úder přenese přes oba limity najednou — třeba jste měli 4 skandály a přišly 2 další —, přijde zatčení. Novinář má oba limity o 1 vyšší.</p>
      <h3>Zatčení</h3>
      <p>Při zatčení přijdete o roli a o 1 Ochranu a vaše skandály klesnou na 0. Pokud vás zatknou ve vašem tahu, tah hned skončí. V příštím tahu budete mít jen 1 akci: bonusy k počtu akcí v něm neplatí, ale kartou si akci přidat můžete.</p>
      <h3>Jak se zbavit skandálů</h3>
      <p><b>Krizové PR</b> může použít každý: 1 akce a ${n.crisisPr}◆ smažou 1 skandál. Můžete ho opakovat, dokud máte akce a vliv. Další způsoby dávají role, karty akcí, podniky a projekty — je to na nich napsané. Ve hře najdete všechny své možnosti pod tlačítkem „Čištění“.</p>
      <p>Pokud nemáte roli, na konci každého kola sám zmizí 1 skandál — spolu s příjmem. Na konci kola působí i „+1 Ochrana“ a „−1 skandál“ z podniků a projektů: ochrana je připravená na první útok nového kola, ať v pořadí tahů sedíte kdekoli.</p>
      `,
    },
    {
      id: "roofs",
      icon: "🛡",
      title: "Ochrana",
      html: `
      <p>Ochrana zafunguje sama. Co se s ní přitom stane, záleží na úderu.</p>
      <ul>
        <li><b>Útočná karta nebo schopnost role</b> se zruší celá a vy přijdete o 1 Ochranu.</li>
        <li><b>Šedý kšeft</b> proti vám se zruší celý a Ochrana se přitom nespotřebuje.</li>
        <li><b>Vaši roli nelze přeplatit</b>, dokud máte Ochranu. Ani tím se nespotřebuje.</li>
      </ul>
      <p>Některé údery míří přímo na Ochranu a před těmi nechrání: kšeft «Prolomit Ochranu» sundá soupeři všechny Ochrany najednou; karty «Obejít ochranku» a «Přetáhnout ochranku» a schopnost Bezpečáka «Sebrat Ochranu» po jedné.</p>
      <p>Když Ochrana úder zastaví, útočník nedostane nic z toho, co úder sliboval — žádné zdroje a ani svůj skandál.</p>
      <p>Co útočník za úder zaplatil — akci, vliv, samotnou kartu —, se mu nevrací.</p>
      <p>Před vašimi vlastními činy Ochrana nechrání. Skandál za neúspěšný vlastní šedý kšeft nebo za kryptopodvod dostanete vždycky.</p>
      <h3>Jak získat Ochranu</h3>
      <p>Kupte ji za 1 akci a <code>3$ + (číslo kola − 1) ÷ 2</code>, zaokrouhleno dolů: v 1.–2. kole to jsou 3$, ve 3.–4. kole 4$ a tak dál. Mít můžete jen 1 Ochranu. Některé role, podniky a projekty tento limit zvyšují nebo dávají Ochranu zdarma.</p>
      <p>Na limitu novou Ochranu nekoupíte ani nedostanete kartou a Ochrana zdarma prostě nepřijde.</p>
      `,
    },
    {
      id: "cards",
      icon: "🃏",
      title: "Karty akcí",
      html: `
      <p>Jednou za tah můžete utratit 1 akci, ${n.cardCost}$ a 1◆ a vzít z balíčku <b>2 náhodné karty</b>. V ruce můžete mít nejvýš 3 karty. Pokud už máte 2 karty, zaplatíte plnou cenu a dostanete jednu. S plnou rukou karty koupit nemůžete.</p>
      <p>Hrát a odhazovat karty můžete kolikrát chcete a bez akce. Za každou odhozenou kartu dostanete ${n.discardMoney}$ nebo ${n.discardInfluence}◆ podle výběru.</p>
      <p>Zahrané a odhozené karty se do balíčku nevracejí. „Číslo kola“ znamená číslo aktuálního kola: v 5. kole přičtěte 5.</p>
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
        <li><b>Projekty</b> — body z karet, ${Math.min(...meta.projects.map(project => project.points))} až ${Math.max(...meta.projects.map(project => project.points))} za projekt.</li>
        <li><b>Podniky</b> — polovina ceny každého podniku. Číslo je vytištěné na kartě.</li>
        <li><b>Role</b> — 3 body, pokud ji máte.</li>
        <li><b>Body získané během hry</b> — za mecenášství, lobbing a karty akcí.</li>
        <li><b>Skandály</b> — mínus 1 bod za každý.</li>
      </ul>
      <p>Zbylé peníze a vliv body nedávají: jsou to zdroje, ne body. Utraťte je do konce hry, nebo je proměňte v body mecenášstvím a lobbingem.</p>
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
          <tr><td class="name">Prodat podnik</td><td>Bez akce</td><td>Dostanete polovinu ceny (zaokrouhleno dolů)</td></tr>
          <tr><td class="name">Koupit místo</td><td>1⚡ + ${slot4}$ / ${slot5}$ + ${n.capacityInfluence[1]}◆ / ${slot6}$ + ${n.capacityInfluence[2]}◆</td><td>Nejvýš 6 míst</td></tr>
          <tr><td class="name">Vzít projekt</td><td>1⚡ + cena projektu</td><td>Podmínka splněna</td></tr>
          <tr><td class="name">Znovu rozdat desku projektů</td><td>1⚡ + ${n.reroll}$</td><td>Jednou za tah</td></tr>
          <tr><td class="name">Vzít volnou roli</td><td>1⚡ + ${rolePrice}◆</td><td>Méně než 5⚠</td></tr>
          <tr><td class="name">Vzít roli jinému hráči</td><td>1⚡ + ${rolePrice * 3}◆</td><td>Méně než 5⚠, držitel nemá Ochranu🛡</td></tr>
          <tr><td class="name">Vzít 2 karty akcí</td><td>1⚡ + ${n.cardCost}$ + 1◆</td><td>Jednou za tah, v ruce nejvýš 3 karty</td></tr>
          <tr><td class="name">Zahrát nebo odhodit kartu</td><td>Bez akce</td><td>Odhození: ${n.discardMoney}$ nebo ${n.discardInfluence}◆</td></tr>
          <tr><td class="name">Šedý kšeft</td><td>1⚡</td><td>Jeden za tah</td></tr>
          <tr><td class="name">Koupit Ochranu</td><td>1⚡ + 3$ + (kolo − 1) ÷ 2</td><td>Do limitu Ochrany🛡; zaokrouhleno dolů</td></tr>
          <tr><td class="name">Zakázka</td><td>1⚡</td><td>Dostanete 2$</td></tr>
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
        <li><b>Nejdřív sundejte Ochranu.</b> Šedé kšefty se o Ochranu zastaví, takže ji před úderem sundejte: «Prolomit Ochranu», kartou, Výpalným nebo Bezpečákem.</li>
        <li><b>Novináři se hodí vlastní skandály.</b> ${selfCards} může zahrát na sebe.</li>
        <li><b>Kdo prohrává, táhne první</b>, první vybírá na trhu i mezi projekty a na začátku kola dostane +${n.underdog}◆.</li>
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
          <tr><td class="name"><b>Lídr</b></td><td>Hráč s nejvíc body★; při shodě ten, kdo má víc projektů. Táhne poslední.</td></tr>
          <tr><td class="name"><b>Mecenášství</b></td><td>Akce: ${n.patronage.money}$ → ${n.patronage.points}★, jednou za tah.</td></tr>
          <tr><td class="name"><b>Místo</b></td><td>Místo pro jeden podnik. Na začátku 3, nejvýš 6.</td></tr>
          <tr><td class="name"><b>Ochrana</b></td><td>Zastaví úder soupeře na vás🛡. Viz „Ochrana“.</td></tr>
          <tr><td class="name"><b>Plná čtvrť</b></td><td>Čtvrť, kde máte 4 podniky a víc.</td></tr>
          <tr><td class="name"><b>Synergie</b></td><td>Příplatek k příjmu za 2 a víc podniků v jedné čtvrti.</td></tr>
          <tr><td class="name"><b>Zaokrouhlení</b></td><td>Vždy dolů: polovina ze 7 je 3.</td></tr>
        </tbody>
      </table>
      `,
    },
  ];
}
