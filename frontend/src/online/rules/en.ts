import type { GreyTableLabels, RoleGuide, RulesChapter, RulesContext, TableLabels } from "../rulesDocument";

/* The rule book in English — the same chapters and wording as the Russian printed rules, without
 * the screenshots (the interface on them is Russian). Numbers come from ctx; the icons next to
 * terms are added by rulesTerms.ts. Plain words, short sentences — readable at B1 level. */

const labels: TableLabels = {
  asset: "Business",
  price: "Price",
  income: "Income/round",
  influence: "◆ at once",
  effect: "Property",
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
  perk: "Bonus",
  roleHeads: { perks: "Always", powers: "Powers", cost: "Cost", limit: "Limit", effect: "Effect", tip: "Tip", warning: "Important" },
  onMarketFrom: round => `on the market from round ${round}`,
  and: " and ",
};

const roles: Record<string, RoleGuide> = {
  capitalist: {
    style: "The money role: more money from every business. <b>District synergy:</b> Business District, Industrial Zone.",
    perks: [
      "Each of your businesses gives +1$.",
      "Business District businesses give +1$ more.",
      "At the end of the round you get 1◆ for each of your Industrial Zone businesses.",
    ],
    powers: [
      {
        name: "🏷️ Place a claim",
        cost: "1 action",
        limit: "only one claim: a new one removes the old one",
        effect: "Mark a business on the market. While the claim stands, the business counts as yours: it brings income, counts for district synergy and project conditions, and unlocks shady deals. It takes no slot and gives no points, and its “when bought” effect does not work. Any player can still buy it. The claim is gone when the business is bought, leaves the market, or you lose the role.",
      },
    ],
  },
  politician: {
    style: "The control role: influence from homes all over the city and cheap scandal cleanup. <b>District synergy:</b> Government Quarter, Residential Area.",
    perks: [
      "Government Quarter businesses give +1$.",
      "At the end of the round you get 1◆ for each Residential Area business in a slot — yours and other players'.",
    ],
    powers: [
      { name: "Settle a scandal", cost: "1 action and 2◆", limit: "can be repeated", effect: "Remove 1 of your scandals." },
      {
        name: "Veto",
        cost: "no action",
        limit: "once per turn; only one veto",
        effect: "Pick a project on the board. While the veto stands, only you can take it — nobody else can, by an action or by a card. Everyone can see the veto. A new veto replaces the old one. The veto is removed when the project leaves the board, the board is re-dealt or you lose the role.",
      },
    ],
  },
  journalist: {
    style: "The scandal role: other players' scandals bring money, your own bring influence. <b>District synergy:</b> Business District, Residential Area.",
    perks: [
      "At the end of the round you get 1$ for each rival scandal if you have at least one Business District business.",
      "At the end of the round you get 1◆ for each of your scandals if you have at least one Residential Area business.",
      "Your scandal limits are 1 higher: you lose the role at 6 scandals and are arrested at 7. When you lose the role, the usual limits apply again, and your scandals drop to 5.",
    ],
    powers: [
      {
        name: "Blow up a story",
        cost: "no action",
        limit: "once per turn",
        effect: "You and the rival you pick each get 1 scandal. If the rival's Protection stops the hit, you do not get your scandal either.",
      },
      { name: "Publish an exposé", cost: "1 action and 3◆", limit: "once per turn", effect: "The rival you pick gets 2 scandals." },
    ],
  },
  fraudster: {
    style: "The risky role: more actions and safer shady deals. <b>District synergy:</b> Tech Cluster.",
    perks: [
      "<b>4 actions</b> per turn instead of 3. Actions are counted at the start of the turn: if you take the role in the middle of a turn, the fourth action comes from the next one.",
      "Tech Cluster businesses give +1$.",
      "+1 to every shady deal roll: you never roll a one.",
    ],
    powers: [
      { name: "Cover your tracks", cost: "1 action", limit: "can be repeated", effect: "Remove 1 of your scandals." },
      {
        name: "Crypto scam",
        cost: "1 action; you need your own “City Crypto Exchange”",
        limit: "once per turn",
        effect: "Take a quarter of each rival's money (rounded down) and get 3 scandals. A rival's Protection stops the hit on them and is used up. This is a role power, not a shady deal: effects that lower scandals from shady deals do not lower these.",
      },
    ],
  },
  mafia: {
    style: "The power role: a racket and cheap Protection. <b>District synergy:</b> Grey Sector.",
    perks: [
      "Grey Sector businesses give +1$.",
      "Protection costs you 1$ less, and you can hold 2 Protection instead of one.",
      "When you take the role, you get 1 Protection.",
      "+1 to the shady deal roll for each of your Grey Sector businesses, at most +2 — the main strength of the role.",
    ],
    powers: [
      {
        name: "Racket",
        cost: "1 action",
        limit: "once per turn",
        effect: "Pick a rival. They give you money: 3$ + 2$ for each of your Grey Sector businesses + round number ÷ 3; the leader gives 5$ more. And influence: 1◆ + round number ÷ 5 + 1◆ for each of your Government Quarter businesses. The target cannot give more than they have. If you have no Government Quarter business, you get 1 scandal. The target's Protection stops the Racket and is used up: then you get nothing, and no scandal either.",
      },
      {
        name: "Hush it up",
        cost: "1 action and 3$; you need a Government Quarter business",
        limit: "can be repeated",
        effect: "Remove up to 2 of your scandals.",
      },
      {
        name: "🔒 Grey hold",
        cost: "1 Protection, no action",
        limit: "once per turn",
        effect: "Mark a business on the market: until the end of the next round, only you can buy it. Only one grey hold: a new one replaces the old one. The hold is gone earlier if the business leaves the market or you lose the role.",
      },
    ],
  },
  military: {
    style: "The punishing role: hits players with many scandals. <b>District synergy:</b> Industrial Zone.",
    perks: ["Industrial Zone businesses give +1$."],
    powers: [
      {
        name: "Sanctions",
        cost: "1 action",
        limit: "once per turn; the target needs at least 2 scandals",
        effect: "The more scandals the target has, the harder the hit: 2 scandals — the target gives you up to (3 + round number)$; 3 scandals — also up to (2 + round number ÷ 4)◆; 4 scandals or more — they also lose their role. The target keeps their scandals. The target's Protection stops Sanctions and is used up.",
      },
      {
        name: "Inspection",
        cost: "1 action",
        limit: "once per turn; you need at least one rival with a Grey Sector business",
        effect: "Each rival with a Grey Sector business gets 1 scandal. Protection stops the hit on its owner and is used up.",
      },
      {
        name: "Take Protection",
        cost: "1 action and 2◆",
        limit: "the target must hold Protection",
        effect: "Take 1 Protection from a rival. If you already hold your limit, it is simply removed. Protection does not save from this power.",
      },
    ],
  },
};

const greyLabels: GreyTableLabels = {
  operations: {
    smear: { name: "Dirty rumours", gate: "Grey Sector · every rival without Protection" },
    crypto: { name: "Pump and dump", gate: "Tech Cluster or Grey Sector · every rival without Protection" },
    datacenter: { name: "Hack", gate: "Tech Cluster or Grey Sector · one target" },
    influence_broker: { name: "Leak dirt", gate: "Government Quarter and Grey Sector (both) · one target with a role" },
    roof_break: { name: "Break Protection", gate: "Grey Sector · every rival" },
  },
  face: "Roll",
  effect: "Effect",
  scandals: "Your scandals",
  clean: "none",
  thirds: ["opening", "middle", "endgame"],
  effectText: (id, effect, tier) => {
    if (tier === "fail") return "—";
    const v = (key: string) => Number(effect[key] ?? 0);
    if (id === "smear") return v("influence_per_hit") ? `a scandal to each, +${v("influence_per_hit")}◆ per scandal` : "a scandal to each";
    if (id === "crypto") return `${v("money_each")}$ from each`;
    if (id === "datacenter") return `steal ${v("influence")}◆`;
    if (id === "influence_broker") return effect.strip_role ? `strip the role, you +${v("influence")}◆` : `target +${v("target_scandals")}⚠, you +${v("influence")}◆`;
    if (id === "roof_break") return v("influence_per_roof") ? `remove all Protection, +${v("influence_per_roof")}◆ each` : "remove all Protection from all";
    return "";
  },
};

export function bookEn(ctx: RulesContext): RulesChapter[] {
  const { n, rolePrice, meta } = ctx;
  const [slot4, slot5, slot6] = n.capacityCosts;
  const lateRound = Math.max(...Object.values(meta.rarity_min_round ?? { legendary: 8 }));
  const campaign = n.campaign[0] ?? { spend: 5, gain: 3 };
  const selfCards = ctx.list(ctx.selfTargetCards, labels.and) || "some scandal cards";
  return [
    {
      id: "intro",
      icon: "🏙️",
      title: "About the game",
      html: `
      <div class="tip"><b>The player with the most points after the last round wins.</b> There are many ways to score, but the main sources are the market with its businesses and the city projects.</div>
      <p>You buy businesses in six districts of the city, pick a role with special powers and take city projects before your rivals. The business market and the project board are shared: what you take, others will not get.</p>
      <p>2–4 players take part. The standard game has 15 rounds, a role costs ${rolePrice}◆, and everyone starts with 10$ and 2◆. (You can change these values before each game, but then the game may be a little less balanced.)</p>
      <h3>Symbols</h3>
      <ul data-terms="off">
        <li>$ <b>Money</b> — to buy businesses, slots, projects, action cards and Protection.</li>
        <li>◆ <b>Influence</b> — for roles, projects and role powers.</li>
        <li>⚠ <b>Scandals</b> — each one left at the end of the game costs 1 point. At 5 scandals you lose your role, at 6 you are arrested (see “Scandals and arrest”).</li>
        <li>🛡 <b>Protection</b> — stops rivals' hits on you (see “Protection”).</li>
        <li>★ <b>Score</b> — the sum of your points. The player with the highest score after the last round wins.</li>
        <li>⚡ <b>Actions</b> — they pay for almost everything you do on your turn (see “Round and turn”).</li>
      </ul>
      <h3>What is on the table</h3>
      <ul>
        <li><b>Market</b> — 6 businesses you can buy. The rest lie in the market deck; the game has ${meta.assets.length} businesses in total.</li>
        <li><b>Project board</b> — ${n.projectBoardSize} city projects. The rest lie in the project deck; the game has ${meta.projects.length} projects in total.</li>
        <li><b>Action card deck</b> — ${meta.action_cards.length} different cards; most are in the deck twice, some three or four times.</li>
        <li><b>Your city</b> — the businesses you bought. Each business takes one <b>slot</b>.</li>
        <li><b>Hand</b> — the cards you bought and can play.</li>
      </ul>
      `,
    },
    {
      id: "market",
      icon: "🏪",
      title: "Market businesses",
      html: `
      <h3>Buying and selling</h3>
      <p>To buy a business, spend 1 action, pay the price and put the business into a free slot of your city. A business brings income at the end of every round and points at the end of the game; some businesses also have special effects.</p>
      <p>An empty place on the market is filled at once by the next business from the deck.</p>
      <p>You can sell a business with no action. You get as much money as the points printed on the card — half of its price, rounded down. The slot is free again; a sold business no longer brings income and no longer counts for conditions and bonuses.</p>
      <h3>My city</h3>
      <p>You start with 3 slots. The fourth slot costs ${slot4}$, the fifth ${slot5}$ and ${n.capacityInfluence[1]}◆, the sixth ${slot6}$ and ${n.capacityInfluence[2]}◆. 6 slots at most. Opening a slot takes 1 action.</p>
      <h3>Income</h3>
      <p>A business card on the market shows the total income and the bonuses you will get when you buy it, with all the synergies and conditions you have right now.</p>
      <p>To see the details and the bonuses that are not shown yet, click the card.</p>
      <p>A card in your slot shows its income live: if you meet an extra condition or lose it, the card changes at once.</p>
      `,
    },
    {
      id: "districts",
      icon: "🗺",
      title: "Districts and rarity",
      html: `
      <h3>Districts and synergy</h3>
      <p>The city has six districts: ${ctx.list(meta.districts.map(district => ctx.e(district.title)), labels.and)}. The more businesses you have in one district, the more money each of them brings:</p>
      <ul>
        <li><b>2–3 businesses</b> in a district: each gives +1$.</li>
        <li><b>4 businesses or more</b>: each gives +2$. Such a district is <b>full</b>: epic and legendary businesses of a full district also give +1◆ at the end of each round.</li>
      </ul>
      <h3>Tags and rarity</h3>
      <p>Every business card has <b>tags</b>: ${["finance", "data", "logistics", "production"].map(tag => `“${ctx.e(ctx.tag(tag))}”`).join(", ")} and others. Many project conditions check them. A district and a tag are different things on a card.</p>
      <p><b>Rarity</b> sets the price of a business and the round when it comes to the market:</p>
      ${ctx.html.rarityLadder(labels)}
      <p>The rarer and more expensive a business is, the more points it gives (the number is on the card) and the stronger its effects. Legendary businesses have unique effects: no other card has them.</p>
      `,
    },
    {
      id: "projects",
      icon: "🏛",
      title: "City projects",
      html: `
      <p>A project belongs to nobody: it goes to whoever first meets the condition and pays the price.</p>
      <p>There are 4 kinds of projects (you can tell them by the card back):</p>
      <ul>
        <li><b>Plain</b> — points only.</li>
        <li><b>With income</b> — points and money every round.</li>
        <li><b>With influence</b> — points and influence every round.</li>
        <li><b>With a special bonus</b> — points and a unique lasting effect.</li>
      </ul>
      <p>The harder the condition and the stronger the bonus, the more a project costs.</p>
      <p>The condition is checked only at the moment you take the project. The project and its bonus stay with you until the end of the game, even if you later sell the business that helped you take it.</p>
      ${ctx.html.projectExample({ heading: "A real project card", caption: "The example comes from the game catalogue.", title: "Name", points: "Points", condition: "Condition", price: "Price", reward: "Lasting bonus", action: "1 action" })}
      <ul>
        <li><b>Points</b> — added to your score at the end of the game.</li>
        <li><b>Condition</b> — what you must already have: businesses in a certain district, businesses with a tag, a number of businesses, few scandals or any role. The bar under the condition shows how close you are.</li>
        <li><b>Price</b> — influence and money.</li>
        <li><b>Lasting bonus</b> — the project gives a bonus that stays until the end of the game.</li>
      </ul>
      <h3>How to take a project</h3>
      <p>Meet the condition, spend 1 action and pay the price. A new project comes to the empty place at once.</p>
      <h3>Re-deal the board</h3>
      <p>Once per turn you can spend 1 action and ${n.reroll}$: all ${n.projectBoardSize} projects go back to the deck, the deck is shuffled, and ${n.projectBoardSize} new projects come out.</p>
      `,
    },
    {
      id: "flow",
      icon: "⏳",
      title: "Round and turn",
      html: `
      <h3>Turn order</h3>
      <p>In each round every player takes one turn. The player with the fewest points goes first. The <b>leader</b> — the player with the most points — goes last. With equal points, whoever went later in the last round goes earlier. The order is set at the start of the round and does not change until it ends.</p>
      <p>In the first round the first player is random, and the others follow in seat order.</p>
      <p><b>Support for the trailing player.</b> At the start of every round except the first, the player with the lowest score gets +${n.underdog}◆. If several players share the last place, each of them gets it; if all scores are equal, nobody does.</p>
      <h3>Actions</h3>
      <p>At the start of your turn you get <b>3 actions</b>. Almost everything is paid with actions: buying a business, a slot, cards or Protection, taking a project or a role, a shady deal, most role powers. Selling businesses, playing and discarding cards are free. The full list is in the “Cheat sheet”.</p>
      <p>Unused actions are lost at the end of the turn.</p>
      <h3>End of the round</h3>
      <p>When everyone has had a turn, the round ends. First, everyone at the same time gets the income of their businesses and everything marked “at the end of the round” and “every round” — on roles, projects, businesses and cards. Then scandals are removed and Protection arrives (see “Scandals and arrest” and “Protection”).</p>
      <p>Then a new round starts:</p>
      <ol>
        <li>The turn order is set again by points.</li>
        <li>The ${n.rotation} businesses that have been on the market the longest (marked ⏳) leave the table, and new ones from the deck take their place. The old businesses go to the discard.</li>
        <li>The leftmost project (marked ⏳) goes to the bottom of the project deck. The other projects move one place left, and a new project from the deck is added last.</li>
      </ol>
      <p><b>The market deck.</b> Until round ${lateRound}, businesses come out of the deck in order — from common to legendary, as each rarity opens. From round ${lateRound}, when every rarity is open, the rare, epic and legendary cards of the deck still come first, and the other places are filled with a random card from the deck and the discard. The rarer the card, the better its chance: late in the game, common and uncommon businesses are only fillers. There are never more than two legendary businesses on the market at once: a third comes out only after one of them is bought or leaves.</p>
      <div class="warn"><b>Nothing is paid after the last round:</b> no income, no influence, no scandals are removed, no Protection arrives. Spend your money and influence during the last round. The only exception is the debt of the «Bridge Loan» card: it is collected at the end of the last round too.</div>
      `,
    },
    {
      id: "roles",
      icon: "🎭",
      title: "Roles",
      html: `
      <p>A role gives lasting bonuses and powers. You can have only one role. If you have a role at the end of the game, it gives 3 points.</p>
      <h3>How to take a role</h3>
      <p>A free role costs 1 action and ${rolePrice}◆. Another player's role costs 1 action and ${rolePrice * 3}◆: they lose it. When a player loses a role, anyone can take it again for ${rolePrice}◆.</p>
      <p><b>If the holder of a role has Protection, their role cannot be taken.</b></p>
      <p>With 5 scandals or more you cannot take a role.</p>
      <h3>Losing a role</h3>
      <p>You lose your role as soon as you have 5 scandals (the Journalist — 6).</p>
      <p>Rivals can take your role away too: with a shady deal, an Enforcer power, a card, or simply by pushing you to the scandal limit.</p>
      <h3>Changing a role</h3>
      <p>To change your role, take another one at the usual price: the old one is free at once. You cannot simply give a role up.</p>
      <h3>Powers</h3>
      <p>Each power has its own cost and its own limit. “No action” means the power does not use up the actions of your turn.</p>
      ${ctx.html.roleCards(roles, labels)}
      `,
    },
    {
      id: "grey",
      icon: "🕶",
      title: "Shady deals",
      html: `
      <p>A shady deal is unlocked by a district: it is enough to have one business in the right district. A deal costs 1 action, and you can make only one per turn.</p>
      <p><b>Roll the die.</b> Faces 1–2 fail and nothing happens. Faces 3–4 give the weak effect, 5–6 the full one. You get scandals only for a miss: 2 on a one, 1 on a two, none from three up. The exception is «Break Protection»: on a three it also costs 1 scandal. Shady deals score no points — everything they give is written in the effect.</p>
      <p><b>Modifiers</b> are added to the roll, anything above 6 counts as a six: the Hustler +${n.fraudsterRoll}, the Mobster +1 for each own Grey Sector business (at most +${n.mafiaRollMax}), the «Bribe the Guards» card +2 to one roll. Together never more than +${n.rollCap}. In the game the shady deals window shows the table already recomputed for you.</p>
      <p><b>Protection</b> on the target blocks any shady deal in full and is not used up. Only «Break Protection» removes it — it opens the table before a strike. Deals that hit everyone only reach rivals without Protection.</p>
      ${ctx.html.greyTables(greyLabels)}
      <p>Pump and dump and Hack grow towards the end of the game: every third has its own numbers (with 15 rounds the thirds are rounds 1–5, 6–10 and 11–15). You never take more than the target holds.</p>
      `,
    },
    {
      id: "scandals",
      icon: "⚠",
      title: "Scandals and arrest",
      html: `
      <p>Each scandal left at the end of the game costs 1 point. While you have fewer than 5 scandals, nothing else happens.</p>
      <ul>
        <li><b>5 scandals:</b> you lose your role at once and cannot take a new one.</li>
        <li><b>6 scandals:</b> arrest.</li>
      </ul>
      <p>If one hit takes you over both limits at once — for example, you had 4 scandals and got 2 more — you are arrested. Both limits are 1 higher for the Journalist.</p>
      <h3>Arrest</h3>
      <p>When you are arrested, you lose your role and 1 Protection, and your scandals reset to 0. If you are arrested on your own turn, the turn ends at once. On your next turn you have only 1 action: bonuses to the number of actions do not work in it, but a card can still add an action.</p>
      <h3>How to get rid of scandals</h3>
      <p><b>Crisis PR</b> is open to everyone: 1 action and ${n.crisisPr}◆ remove 1 scandal. You can repeat it while you have actions and influence. Roles, action cards, businesses and projects give other ways — it is written on them. In the game all your ways are under the “Clean up” button.</p>
      <p>If you have no role, 1 scandal goes away by itself at the end of every round, together with the income. The “+1 Protection” and “−1 scandal” of businesses and projects also work at the end of the round, so your defence is ready for the first hit of the new round wherever you sit in the turn order.</p>
      `,
    },
    {
      id: "roofs",
      icon: "🛡",
      title: "Protection",
      html: `
      <p>Protection works by itself. What happens to it depends on the hit.</p>
      <ul>
        <li><b>An attack card or a role power</b> is cancelled in full, and you lose 1 Protection.</li>
        <li><b>A shady deal</b> against you is cancelled in full, and the Protection is not used up.</li>
        <li><b>Your role cannot be bought out</b> while you have Protection. It is not used up by this either.</li>
      </ul>
      <p>Some hits go at Protection itself, and it does not save from them: the «Break Protection» deal removes all of a rival's Protection at once; the «Slip Past the Guards» and «Poach the Guards» cards and the Enforcer's «Take Protection» remove one.</p>
      <p>If Protection stopped a hit, the attacker gets nothing the hit promised — no resources, and no scandal of their own.</p>
      <p>What the attacker paid for the hit — the action, the influence, the card itself — does not come back.</p>
      <p>Protection does not save you from your own actions. You always get the scandal for a failed shady deal of your own or for a crypto scam.</p>
      <h3>How to get Protection</h3>
      <p>Buy it for 1 action and <code>3$ + (round number − 1) ÷ 2</code>, rounded down: 3$ in rounds 1–2, 4$ in rounds 3–4, and so on. You can hold only 1 Protection. Some roles, businesses and projects raise this limit or give Protection for free.</p>
      <p>At your limit you can neither buy new Protection nor get it from a card, and free Protection simply does not arrive.</p>
      `,
    },
    {
      id: "cards",
      icon: "🃏",
      title: "Action cards",
      html: `
      <p>Once per turn you can spend 1 action, ${n.cardCost}$ and 1◆ and take <b>2 random cards</b> from the deck. You can hold no more than 3 cards. If you already have 2 cards, you pay the full price and get one. With a full hand you cannot buy cards.</p>
      <p>You can play and discard cards as much as you like, with no action. For each discarded card you get ${n.discardMoney}$ or ${n.discardInfluence}◆, your choice.</p>
      <p>Played and discarded cards do not go back into the deck. “Round number” means the number of the current round: in round 5, add 5.</p>
      <p>Attacks are played on a rival. You can play ${selfCards} on yourself.</p>
      ${ctx.html.cardTable(labels)}
      `,
    },
    {
      id: "end",
      icon: "🏆",
      title: "End of the game",
      html: `
      <p>The game ends after the last round. There is no income for it. Count the points:</p>
      <ul>
        <li><b>Projects</b> — points from the cards, ${Math.min(...meta.projects.map(project => project.points))} to ${Math.max(...meta.projects.map(project => project.points))} per project.</li>
        <li><b>Businesses</b> — half the price of each business. The number is printed on the card.</li>
        <li><b>Role</b> — 3 points if you have one.</li>
        <li><b>Points earned during the game</b> — for patronage, lobbying and action cards.</li>
        <li><b>Scandals</b> — minus 1 point for each.</li>
      </ul>
      <p>Leftover money and influence give no points: they are resources, not score. Spend them before the game ends, or turn them into points with patronage and lobbying.</p>
      <div class="tip">The player with the most points wins. <b>With equal points, the player who bought more city projects wins.</b></div>
      `,
    },
    {
      id: "memo",
      icon: "📋",
      title: "Cheat sheet",
      html: `
      <p>What you can do on your turn:</p>
      <table>
        <thead><tr><th>Move</th><th>Cost</th><th>Limits</th></tr></thead>
        <tbody>
          <tr><td class="name">Buy a business</td><td>1⚡ + price</td><td>A free slot is needed</td></tr>
          <tr><td class="name">Sell a business</td><td>No action</td><td>Get half the price (rounded down)</td></tr>
          <tr><td class="name">Buy a slot</td><td>1⚡ + ${slot4}$ / ${slot5}$ + ${n.capacityInfluence[1]}◆ / ${slot6}$ + ${n.capacityInfluence[2]}◆</td><td>6 slots at most</td></tr>
          <tr><td class="name">Take a project</td><td>1⚡ + project price</td><td>Condition met</td></tr>
          <tr><td class="name">Re-deal the project board</td><td>1⚡ + ${n.reroll}$</td><td>Once per turn</td></tr>
          <tr><td class="name">Take a free role</td><td>1⚡ + ${rolePrice}◆</td><td>Fewer than 5⚠</td></tr>
          <tr><td class="name">Take another player's role</td><td>1⚡ + ${rolePrice * 3}◆</td><td>Fewer than 5⚠, the holder has no Protection🛡</td></tr>
          <tr><td class="name">Take 2 action cards</td><td>1⚡ + ${n.cardCost}$ + 1◆</td><td>Once per turn, up to 3 cards in hand</td></tr>
          <tr><td class="name">Play or discard a card</td><td>No action</td><td>Discard: ${n.discardMoney}$ or ${n.discardInfluence}◆</td></tr>
          <tr><td class="name">Shady deal</td><td>1⚡</td><td>One per turn</td></tr>
          <tr><td class="name">Buy Protection</td><td>1⚡ + 3$ + (round − 1) ÷ 2</td><td>Up to your Protection🛡 limit; rounded down</td></tr>
          <tr><td class="name">City job</td><td>1⚡</td><td>Get 2$</td></tr>
          <tr><td class="name">Crisis PR</td><td>1⚡ + ${n.crisisPr}◆</td><td>Removes 1⚠</td></tr>
          <tr><td class="name">Exchange</td><td>1⚡ + ${campaign.spend}$</td><td>Get ${campaign.gain}◆</td></tr>
          <tr><td class="name">Patronage</td><td>1⚡ + ${n.patronage.money}$</td><td>Get ${n.patronage.points}★, once per turn</td></tr>
          <tr><td class="name">Lobbying</td><td>1⚡ + ${n.lobbying.influence}◆</td><td>Get ${n.lobbying.points}★, once per turn</td></tr>
          <tr><td class="name">Role power</td><td>See the role</td><td>See the role</td></tr>
        </tbody>
      </table>
      `,
    },
    {
      id: "project-catalog",
      icon: "📜",
      title: "All projects",
      html: `
      <p>${n.projectBoardSize} projects from the deck lie on the board at the same time.</p>
      ${ctx.html.projectTable(labels)}
      `,
    },
    {
      id: "catalog",
      icon: "📚",
      title: "All businesses",
      html: `
      <p>The “◆ at once” column is the influence you get when you buy. The full-district bonus (+1◆ per round for epic and legendary businesses) is not repeated in the tables.</p>
      ${ctx.html.rarityLadder(labels)}
      ${ctx.html.assetTables(labels)}
      `,
    },
    {
      id: "strategy",
      icon: "🧭",
      title: "Tips",
      html: `
      <ol>
        <li><b>Look at the projects before you buy businesses.</b> Projects bring the most points, and their conditions tell you what to buy.</li>
        <li><b>Income beats savings.</b> A good business brings money every round, and at the end money is worth almost nothing.</li>
        <li><b>Build districts.</b> 2 businesses in a district turn on synergy, 4 double it.</li>
        <li><b>Pick a role for your strategy</b>, not the one that looks strongest.</li>
        <li><b>Watch your scandals.</b> Do not go near the limit without a reason: the Enforcer hits harder the more you have.</li>
        <li><b>Remove Protection first.</b> Shady deals stop at Protection, so remove it before the strike: «Break Protection», a card, the Racket or the Enforcer.</li>
        <li><b>The Journalist likes their own scandals.</b> ${selfCards} can be played on yourself.</li>
        <li><b>The player who is behind goes first</b>, picks first on the market and among the projects, and gets +${n.underdog}◆ at the start of the round.</li>
        <li><b>In the last round, spend everything</b> on projects, businesses and points: there is no income after it.</li>
      </ol>
      `,
    },
    {
      id: "glossary",
      icon: "📖",
      title: "Glossary",
      html: `
      <table>
        <thead><tr><th>Term</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td class="name"><b>Full district</b></td><td>A district where you have 4 businesses or more.</td></tr>
          <tr><td class="name"><b>Leader</b></td><td>The player with the most points★; with equal points, the one with more projects. Goes last.</td></tr>
          <tr><td class="name"><b>Patronage</b></td><td>An action: ${n.patronage.money}$ → ${n.patronage.points}★, once per turn.</td></tr>
          <tr><td class="name"><b>Protection</b></td><td>Stops a rival's hit on you🛡. See “Protection”.</td></tr>
          <tr><td class="name"><b>Round number</b></td><td>The number of the current round. In round 5 it is 5.</td></tr>
          <tr><td class="name"><b>Rounding</b></td><td>Always down: half of 7 is 3.</td></tr>
          <tr><td class="name"><b>Slot</b></td><td>A place for one business. 3 at the start, 6 at most.</td></tr>
          <tr><td class="name"><b>Synergy</b></td><td>Extra income for 2 or more businesses in one district.</td></tr>
        </tbody>
      </table>
      `,
    },
  ];
}
