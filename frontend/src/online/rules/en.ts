import type { RoleGuide, RulesChapter, RulesContext, TableLabels } from "../rulesDocument";

/* The rule book in English. Plain words, short sentences — readable at B1 level. Numbers come from ctx. */

const labels: TableLabels = {
  asset: "Business",
  price: "Price",
  income: "Income/round",
  influence: "◆ at once",
  effect: "What it does",
  roleNote: role => `Role of this district: <b>${role}</b> (+1$ for each business here).`,
  card: "Card",
  type: "Type",
  target: "Target",
  onTarget: "a rival",
  onSelf: "yourself",
  tone: { deal: "Deal", attack: "Attack", defence: "Defence" },
  project: "Project",
  points: "Points",
  condition: "Condition",
  perk: "Lasting bonus",
  roleHeads: { perks: "Lasting bonuses", powers: "Powers", cost: "Cost", limit: "Limit", effect: "Effect", tip: "Tip", warning: "Important" },
  onMarketFrom: round => `on the market from round ${round}`,
  and: " and ",
};

const roles: Record<string, RoleGuide> = {
  capitalist: {
    style: "The money role: more money from every business and influence from factories.",
    perks: [
      "<b>Each of your businesses: +1$.</b> Any business, not only in the Business District.",
      "<b>Own district — Business District:</b> its businesses give +1$ more.",
      "<b>Influence from the Industrial Zone:</b> +1◆ at the end of the round for each of your Industrial Zone businesses. This is the role's only influence.",
    ],
    powers: [
      {
        name: "Place a claim",
        cost: "1 action and 1⚠",
        limit: "one claim: a new one removes the old one",
        effect: "A market card works for you as if it were yours: it gives income, counts for synergy and projects, and unlocks shady deals. But anyone can still buy it, it gives no points and takes no slot. The claim is gone when you lose the role.",
      },
    ],
  },
  politician: {
    style: "The control role: influence from homes all over the city and cheap scandal cleanup.",
    perks: [
      "<b>Own district — Government Quarter:</b> each of your businesses there gives +1$.",
      "<b>Influence from residents:</b> +1◆ at the end of the round for each residential business on the table — yours and other players'.",
    ],
    powers: [
      { name: "Settle a scandal", cost: "1 action and 2◆", limit: "as many as your actions allow", effect: "Removes 1 of your scandals." },
      {
        name: "Make a deal",
        cost: "3◆ and 1⚠; you need a Grey Sector business",
        limit: "once per turn, no action",
        effect: "Until the end of the round, any district you pick counts as yours: for projects, shady deals and synergy.",
      },
      {
        name: "Veto",
        cost: "1 action and 3◆",
        limit: "one veto, everyone can see it",
        effect: "Only you can take a project on the board. When the project leaves the board, the veto leaves with it. It is gone when you lose the role.",
      },
    ],
  },
  journalist: {
    style: "The scandal role: other players' scandals bring money, your own bring influence.",
    perks: [
      "<b>Money from other scandals:</b> at the end of the round, 1$ for each rival scandal, or 2$ if you have a Business District business. It counts what is left at payout time.",
      "<b>Influence from your own scandals:</b> at the end of the round, +1◆ for each of your scandals, with no cap. Only works if you have at least one Residential Area business.",
      "<b>Scandal limit — 6⚠.</b> You lose the role at 6⚠, not 5⚠. Arrest comes at 7⚠.",
      "The role has no district of its own.",
    ],
    powers: [
      {
        name: "Blow up a story",
        cost: "free, no action",
        limit: "once per turn",
        effect: "1⚠ to you and to the rival you pick. If the target has Protection, it stops the whole hit — then you get no scandal either.",
      },
      {
        name: "Publish an exposé",
        cost: "1 action and 3◆",
        limit: "once per turn",
        effect: "2⚠ to a rival, nothing to you. The target's Protection stops the whole thing, but your action and influence are spent.",
      },
    ],
    warning: "A rival's Protection stops both the story and the exposé. At 6⚠ you lose the role, at 7⚠ you are arrested. Without the role, your limit is 5⚠ again.",
  },
  fraudster: {
    style: "The risky role: more actions and strong shady deals.",
    perks: [
      "<b>Four actions per turn</b> instead of three.",
      "<b>Own district — Tech Cluster:</b> each of your businesses there gives +1$.",
      "<b>Shady deals:</b> +30% chance of success, but no more than 90%.",
    ],
    powers: [
      { name: "Cover your tracks", cost: "1 action", limit: "as many as your actions allow", effect: "Removes 1 of your scandals." },
      {
        name: "Crypto scam",
        cost: "1 action; you need your own City Crypto Exchange",
        limit: "once per turn",
        effect: "Takes 25% of every rival's money (Protection keeps its owner safe) and gives you 5⚠. Businesses and projects that lower scandals from shady deals lower these too.",
      },
    ],
  },
  mafia: {
    style: "The power role: income from the Grey Sector, a racket and cheap Protection.",
    perks: [
      "<b>Own district — Grey Sector:</b> each of your businesses there gives +1$.",
      "<b>Protection</b> costs 1$ less, and you can hold two, not one.",
    ],
    powers: [
      {
        name: "Racket",
        cost: "1 action; you need a Grey Sector business",
        limit: "once per turn",
        effect: "The target gives you money: 2$ + 2$ for each of your Grey Sector businesses + the round number divided by 3 (rounded down), and +5$ more if the target is the leader. And influence: 1◆ for each of your Government Quarter businesses. Never more than the target has. The target's Protection cancels the racket. If you have no Government business, you get 1⚠.",
      },
      { name: "Hush it up", cost: "1 action and 3$; you need a Government business", limit: "as many as your actions allow", effect: "Removes up to 2 of your scandals." },
      {
        name: "Grey hold",
        cost: "1 Protection",
        limit: "once per turn, no action",
        effect: "Until the end of the round, only you can buy a market slot. You have one hold: a new one moves the old one. It is removed by the end of the round or by a Market Maker re-deal.",
      },
    ],
  },
  military: {
    style: "The punishing role: hits players who have many scandals.",
    perks: [
      "<b>Own district — Industrial Zone:</b> each of your businesses there gives +1$.",
      "Sanctions look at the target's scandals, and Inspection creates those scandals.",
    ],
    powers: [
      {
        name: "Sanctions",
        cost: "1 action",
        limit: "once per turn; the target needs at least 2⚠",
        effect: "If the target has Protection, they lose it — and that's all. Without Protection: at 2⚠ the target gives you up to (3 + round number)$; at 3⚠ — also influence; at 4⚠ — they also lose their role. The target keeps their scandals.",
      },
      {
        name: "Inspection",
        cost: "1 action",
        limit: "as many as your actions allow; you need a rival with a Grey Sector business",
        effect: "A scandal to every rival who has a Grey Sector business. Protection keeps its owner safe and is used up.",
      },
      {
        name: "Take Protection",
        cost: "1 action and 3◆",
        limit: "you need a rival with Protection and room for it",
        effect: "One Protection of a rival becomes yours. Protection does not defend against this.",
      },
    ],
    warning: "The target's Protection stops sanctions completely. And the target may clean up scandals on their own turn.",
  },
};

export function bookEn(ctx: RulesContext): RulesChapter[] {
  const { n, rolePrice } = ctx;
  const campaign = n.campaign.map(tier => `<b>${tier.spend}$ → ${tier.gain}◆</b>`).join(", ");
  const selfCards = ctx.list(ctx.selfTargetCards, labels.and) || "Some scandal cards";
  const capacity = n.capacityCosts.map(cost => `${cost}$`).join(" → ");
  const tags = ["finance", "data", "logistics", "production", "security", "government"].map(tag => `“${ctx.e(ctx.tag(tag))}”`).join(", ");
  return [
    {
      id: "intro",
      icon: "🏙️",
      title: "Welcome to the city",
      html: `
      <p><i>City of Influence</i> is a game about building a strong network across the city and outscoring your rivals. Buy businesses, build up districts, use roles and powers, then claim city projects.</p>
      <div class="tip"><b>Your goal:</b> finish the last round with more points than anyone else. Projects, businesses, a role, some actions, and leftover money and influence score points; scandals take points away.</div>
      <p><b>The city and market are shared.</b> Everyone sees the same six market offers and ${n.projectBoardSize} projects. Buying a business or taking a project changes the table for all players. A project belongs to the first player who pays its price and meets its condition.</p>
      <p><b>How a game flows:</b> spend actions on choices during your turn; at round end, the city pays income and some offers change. Plan your growth a few rounds ahead, but do not wait too long on a project a rival can take.</p>
      <div class="box"><h4>Resource symbols in this book</h4><p><b>$ means money</b>, <b>◆ means influence</b>, and <b>⚠ means scandal</b>. The same symbols are used for prices, effects, and scoring.</p></div>
      `,
    },
    {
      id: "goal",
      icon: "🏆",
      title: "Goal and points",
      html: `
      <p>The player with the most points at the end wins. You get points from:</p>
      <ul>
        <li><b>City projects</b> — 1 to 9 points, usually 6–7. The biggest source of points.</li>
        <li><b>Businesses</b> — half the business price, rounded down. The number is on the card (<b>★ N points</b>).</li>
        <li><b>Role</b> — +3 points if you have a role at the end.</li>
        <li><b>Other points</b> — patronage (<b>${n.patronage.money}$ → ${n.patronage.points}</b>), lobbying (<b>${n.lobbying.influence}◆ → ${n.lobbying.points}</b>) and cards that buy points. Patronage and lobbying — once per turn each.</li>
        <li><b>💵 Money ($)</b> — 1 point for every <b>${n.moneyPerPoint}$</b>.</li>
        <li><b>◆ Influence</b> — 1 point for every <b>${n.influencePerPoint}◆</b>.</li>
        <li><b>⚠ Scandals</b> — minus 1 point for each.</li>
      </ul>
      <div class="tip"><b>Where to look:</b> your score in parts and your next income open with the “Score and income” button at the top.</div>
      `,
    },
    {
      id: "flow",
      icon: "⏳",
      title: "Turns and rounds",
      html: `
      <p>In every round, all players take turns. <b>The player with the fewest points goes first</b>, the leader goes last. The order is set again every round. If points are equal, the player who went later last round goes earlier. The player panel shows whose turn it is.</p>
      <div class="kpi">
        <div><b>3</b><span>actions per turn for everyone</span></div>
        <div><b>4</b><span>actions for the Hustler</span></div>
        <div><b>1</b><span>action in the turn after an arrest</span></div>
      </div>
      <p>Actions are spent on buying, roles, projects, cards, shady deals and defence. <b>No action needed</b> to sell a business, play or discard cards. Unused actions are lost at the end of the turn.</p>
      <p><b>End of the round.</b> Businesses pay income, influence is added, role bonuses work, and the bridge loan is paid back. When the next round opens, turn order is set again, the action deck is shuffled, part of the market changes and one project on the board is replaced.</p>
      <p><b>There is no payout after the last round.</b> During the whole last round, “Score and income” shows a zero payout: spend your money and influence right away. The bridge loan is still paid back.</p>
      <div class="tip"><b>The market has six slots and a deck of ${ctx.meta.assets.length} business cards.</b> The deck is shuffled, so offers appear in random order. When a business is bought, the next available card from the shuffled deck immediately fills its slot. At the start of each new round, the <b>${n.rotation} oldest slots</b> marked ⏳ go to the bottom of the deck and are replaced. There is no other market rotation during a round (except the Market Maker power).</div>
      `,
    },
    {
      id: "projects",
      icon: "🏛",
      title: "City projects",
      html: `
      <p>The board of ${n.projectBoardSize} projects is shared by all players. A project is not reserved for whoever saw it first or met its condition first: the first player to spend the action and resources to take it gets it. After that, it belongs only to them.</p>
      ${ctx.html.projectExample({ heading: "Read a real project card", caption: "The example uses a card from the game catalogue.", title: "Name", points: "Points", condition: "Condition", price: "Price", reward: "Lasting reward", action: "1 action" })}
      <ul>
        <li><b>Price</b> — the influence and money on the card, plus 1 action.</li>
        <li><b>Condition</b> — something you must already have: businesses in a district, businesses with a tag, a number of businesses, few scandals or any role.</li>
        <li><b>Reward</b> — points at the end and a lasting bonus, for example +2$ or +2◆ every round. Nobody can take the bonus away.</li>
        <li><b>Project rotation</b> — at the start of each new round, the <b>oldest project on the left</b>, marked ⏳, goes to the bottom of the deck. The others shift left, and the next card from the shuffled deck enters at the right.</li>
        <li><b>Re-deal the board</b> — ${n.reroll}$ and 1 action, once per turn: all projects go back to the deck and a new board is dealt.</li>
      </ul>
      <p>When someone takes a project, a new one appears immediately in the rightmost position. If you have enough actions and resources, you can take several available projects in one turn. The project deck is shuffled when the whole board is re-dealt; normal rotation draws the next card from the deck.</p>
      `,
    },
    {
      id: "resources",
      icon: "💰",
      title: "Resources",
      html: `
      <div class="cols">
        <div class="box"><h4>💵 Money ($)</h4><p>For buying, slots, projects, cards and defence. At the end, ${n.moneyPerPoint}$ = 1 point. Patronage: ${n.patronage.money}$ → ${n.patronage.points} points, once per turn.</p></div>
        <div class="box"><h4>◆ Influence</h4><p>For roles, projects and powers. At the end, ${n.influencePerPoint}◆ = 1 point. Lobbying: ${n.lobbying.influence}◆ → ${n.lobbying.points} points, once per turn. You get influence from businesses with “+◆ per round”, project bonuses and some roles. You can also buy it — that is “Exchange”.</p></div>
        <div class="box"><h4>🔁 Exchange</h4><p>1 action: ${campaign}.</p></div>
        <div class="box"><h4>⚠ Scandals</h4><p>Minus a point for each. At 5⚠ you lose your role; at 6⚠ you are arrested. The Journalist has one more: role at 6⚠, arrest at 7⚠. Remove 1⚠: <b>${n.crisisPr}◆ and 1 action</b> (crisis PR). If you have no role, 1⚠ goes away by itself at the start of your turn.</p></div>
        <div class="box"><h4>🛡️ Protection</h4><p>Defence <b>against other players</b>: stops a card, a racket, sanctions, a hack and an attempt to take your role. It does not save you from your own choices, like a failed shady deal.</p></div>
        <div class="box"><h4>🏢 Slots</h4><p>You start with 3 slots, 6 at most. A new slot costs ${capacity}.</p></div>
        <div class="box"><h4>🃏 Action cards</h4><p>Buying: 1 action, ${n.cardCost}$ and 1◆ — you take <b>two random</b> cards. Once per turn, 3 cards in hand at most. You can play and discard as many as you like. A discard gives ${n.discard}$ or ${n.discard}◆.</p></div>
        <div class="box"><h4>🏷️ Selling a business</h4><p><b>No action.</b> You get half the business price — the same number of points it was giving. The slot is free at once.</p></div>
      </div>
      `,
    },
    {
      id: "economy",
      icon: "🏢",
      title: "Business income",
      html: `
      <p>At the end of the round, each business pays <b>the income on its card + synergy</b>.</p>
      <ul>
        <li><b>The income on the card</b> does not grow. To earn more, buy a stronger business or build up a district.</li>
        <li><b>District synergy</b>: with 2 businesses in a district, each gives +1$; with 4, each gives +2$.</li>
        <li><b>District role</b>: five districts have their own role, which gives +1$ for each business in that district.</li>
        <li><b>Full district</b>: with 4 businesses in a district, the epic and legendary businesses there give +1◆ more per round.</li>
        <li><b>Card effects</b>: bonuses written on the card itself.</li>
      </ul>
      <p>The influence ◆ on a card is <b>one-time</b>: you get it when you buy. On a market card, the income is shown as how much your whole income grows — including the synergy this purchase turns on.</p>
      <p><b>Tags</b> (${tags}…) are written on the cards. Many project conditions check them.</p>
      `,
    },
    {
      id: "districts",
      icon: "🗺",
      title: "Districts and synergy",
      html: `
      <p>The city has six districts. The more of your businesses are in a district, the more <b>each</b> business there gives:</p>
      <div class="kpi">
        <div><b>2 businesses</b><span>+1$ each</span></div>
        <div><b>4 businesses</b><span>+2$ each</span></div>
        <div><b>District role</b><span>+1$ each</span></div>
      </div>
      <p>District roles:</p>
      ${ctx.html.districtRoles()}
      <p>The Residential Area has no role of its own.</p>
      <div class="box"><h4>🏙 Renting a district</h4><p>The Rezoning card and the Politician's “Make a deal” power make the chosen district count as if you had 1 more business there, until the end of the round. This works for project conditions, shady deals, role powers and synergy. It does not work for lasting role bonuses: they only count what you built. You can rent only one district: a new one replaces the old one.</p></div>
      `,
    },
    {
      id: "roles",
      icon: "🎭",
      title: "Roles",
      html: `
      <p>A role gives lasting bonuses and powers. You can have only one role. A role at the end of the game gives <b>+3 points</b>.</p>
      <div class="cols">
        <div class="box"><h4>How to get one</h4><p>A free role: <b>${rolePrice}◆</b> and 1 action. Another player's role: <b>${rolePrice * 3}◆</b> and 1 action. They lose the role, and your old role becomes free.</p></div>
        <div class="box"><h4>Defence</h4><p>The holder's Protection stops a takeover and is used up. You get your influence back, but not the action. The Lobbying Bureau gives the old holder 2◆ if their role is taken after all.</p></div>
        <div class="box"><h4>Powers</h4><p>Each power has its own cost and limit. “No action” means your action counter does not go down.</p></div>
      </div>
      ${ctx.html.roleCards(roles, labels)}
      <div class="warn"><b>Losing a role:</b> with 5⚠ you can't take a role (even as the Journalist). When you reach your scandal limit, you lose the role at once. One more 1⚠ — arrest.</div>
      `,
    },
    {
      id: "grey",
      icon: "🕶",
      title: "Shady deals",
      html: `
      <p>A <b>district</b> unlocks a shady deal: you need any of your businesses in the right district, no role needed. A deal costs 1 action, <b>only one per turn</b>. The Grey Sector unlocks all five, the Tech Cluster — Pump and dump and Hack, the Government Quarter — Leak dirt.</p>
      <table>
        <thead><tr><th>Deal</th><th>District</th><th>Chance</th><th>What it does on success</th><th>Points</th></tr></thead>
        <tbody>
          <tr><td class="name"><b>Dirty rumours</b></td><td>Grey Sector</td><td class="num">${n.greyChance("smear", 60)}%</td><td><b>1⚠ to every rival</b></td><td class="num">+${n.greyPoints("smear", 2)}</td></tr>
          <tr><td class="name"><b>Pump and dump</b></td><td>Tech Cluster, Grey Sector</td><td class="num">${n.greyChance("crypto", 45)}%</td><td>take up to (${n.pumpBase} + round/2)$ <b>from every rival</b></td><td class="num">+${n.greyPoints("crypto", 2)}</td></tr>
          <tr><td class="name"><b>Break Protection</b></td><td>Grey Sector</td><td class="num">${n.greyChance("roof_break", 60)}%</td><td>remove <b>all</b> the target's Protection, +${n.roofBreakPoint} point for each</td><td class="num">+${n.greyPoints("roof_break", 2)}</td></tr>
          <tr><td class="name"><b>Hack</b></td><td>Tech Cluster, Grey Sector</td><td class="num">${n.greyChance("datacenter", 40)}%</td><td>steal up to (${n.hackBase} + round/3)◆ from the target</td><td class="num">+${n.greyPoints("datacenter", 3)}</td></tr>
          <tr><td class="name"><b>Leak dirt</b></td><td>Grey Sector, Government</td><td class="num">${n.greyChance("influence_broker", 60)}%</td><td>the target <b>loses their role</b></td><td class="num">+${n.greyPoints("influence_broker", 3)}</td></tr>
        </tbody>
      </table>
      <p><b>One rule for all deals.</b> Success: the effect happens, you get the points and <b>${n.greySuccess} scandal</b>. Failure: nothing happens, but you get <b>${n.greyFailure} scandals</b>. The action is spent either way. Divisions in the formulas are rounded down.</p>
      <p>The Hustler gets +30% chance (no more than 90%). Some businesses and projects lower scandals from deals by 1 — on success and on failure.</p>
      <div class="box"><h4>The target's Protection</h4><p>The target's Protection stops the deal and is used up, even on success. You still get the points and your own scandal. Dirty rumours and Pump hit all rivals, and each one's Protection counts separately. <b>Protection does not stop “Break Protection”</b> — that deal is aimed at Protection itself.</p></div>
      <div class="box"><h4>Protection does not stop your own scandals</h4><p>The scandal for your shady deal or crypto scam always comes, even if you have Protection.</p></div>
      `,
    },
    {
      id: "scandals",
      icon: "⚠",
      title: "Scandals and arrest",
      html: `
      <div class="kpi">
        <div><b>0–4⚠</b><span>minus a point for each, you play as normal</span></div>
        <div><b>5⚠</b><span>you lose your role at once</span></div>
        <div><b>6⚠</b><span>arrest: scandals drop to 3⚠, you lose your role and 1 Protection</span></div>
      </div>
      <p><b>Arrest:</b> you have only 1 action in your next turn. If the arrest happens during your turn, the turn ends at once and your remaining actions are lost. If you have no role, 1⚠ goes away by itself at the start of your turn.</p>
      <p>You can remove scandals with one “Clean up” button — it shows the price for your role. Each option costs 1 action, and you can repeat it:</p>
      <div class="kpi">
        <div><b>${n.crisisPr}◆</b><span>−1⚠ · crisis PR, for everyone</span></div>
        <div><b>2◆</b><span>−1⚠ · Politician</span></div>
        <div><b>—</b><span>−1⚠ · Hustler, just the action</span></div>
        <div><b>3$</b><span>−2⚠ · Mobster, needs a Government business</span></div>
      </div>
      <p>Defence cards also remove scandals. Protection stops <b>all</b> scandals from one hit by another player at once.</p>
      `,
    },
    {
      id: "roofs",
      icon: "🛡",
      title: "Protection and defence",
      html: `
      <ul>
        <li>Protection stops any hit on you from a rival <b>by itself</b>: a card, a racket, sanctions, a shady deal, a role takeover, scandals. 1 Protection is used up, and the whole hit is cancelled.</li>
        <li>Protection does not save you from your own choices: the scandal for your shady deal and for the crypto scam always comes.</li>
        <li>With Controlled Leak and Smear Campaign you only get your own scandal if the hit lands. If the target's Protection stopped it, nothing happens to you.</li>
        <li>Any hit uses up Protection, so you can first strip a rival with a cheap attack and then hit hard.</li>
        <li>Buying Protection: 1 action and <code>3$ + (round − 1)/2</code>, rounded down. The Mobster pays 1$ less. You can hold 1 Protection, the Mobster 2. Some businesses and projects raise the limit.</li>
        <li>All three defence cards give the same Protection.</li>
      </ul>
      `,
    },
    {
      id: "cards",
      icon: "🃏",
      title: "Action cards",
      html: `
      <p>Buying: <b>1 action</b>, ${n.cardCost}$ and 1◆ — you take <b>two</b> random cards. Only <b>once per turn</b>. The deck has two copies of each card. You can hold 3 cards at most.</p>
      <p><b>You can play and discard as many as you like</b>, without an action. A discard gives ${n.discard}$ or ${n.discard}◆.</p>
      <p><b>Some cards can target yourself:</b> ${selfCards}. This is a move for the Journalist, who needs their own scandals. Your Protection does not stop a hit on yourself, and you get no attacker bonuses for it.</p>
      ${ctx.html.cardTable(labels)}
      `,
    },
    {
      id: "project-catalog",
      icon: "📜",
      title: "All projects",
      html: `
      <p>The whole deck is in the game, but only four projects are on the board at a time, in random order.</p>
      ${ctx.html.projectTable(labels)}
      `,
    },
    {
      id: "catalog",
      icon: "📚",
      title: "All businesses",
      html: `
      <p>Rarity is a price level and the round when the card can appear on the market. More expensive does not mean more income: the income on the card is similar for all rarities. The difference is in points (half the price) and in the card's effects. Epic and legendary businesses in a full district give +1◆ more per round.</p>
      ${ctx.html.rarityLadder(labels)}
      <p>Below are all businesses by district.</p>
      ${ctx.html.assetTables(labels)}
      `,
    },
    {
      id: "strategy",
      icon: "🧭",
      title: "Tips",
      html: `
      <ol>
        <li><b>Look at the projects before you buy.</b> Projects give the most points, and their conditions tell you which businesses you need.</li>
        <li><b>Income beats savings.</b> A good business pays every round, and money is worth very little at the end.</li>
        <li><b>Build up districts.</b> 2 businesses in a district turn on synergy, 4 give double synergy and +1◆ on epic and legendary ones.</li>
        <li><b>Pick a role that fits your plan</b>, not “the strongest one”.</li>
        <li><b>Keep scandals under control</b> and don't get close to the limit without a reason.</li>
        <li><b>The last player goes first</b> and picks first on the market and among the projects.</li>
        <li><b>At the end, spend everything</b> on projects, businesses and points: there is no payout after the last round.</li>
      </ol>
      `,
    },
  ];
}
