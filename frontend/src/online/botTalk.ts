import i18next from "../i18n";
import type { ChatMessage, GameState } from "./types";

/* Реплики ботов в чате.
 *
 * Сервер решает только, что бот заговорил и по какому поводу (`line = { trigger, n }`), а слова
 * лежат здесь: за одним столом могут сидеть люди с разными языками, и шутку каждый читает на своём.
 * У повода есть общие фразы и — где есть что сказать в характере — фразы конкретного бота:
 * Казначей про деньги, Рейдер про силу, Застройщик про стройку, Oracle про прогнозы, Ledger про баланс.
 *
 * Поводы (см. `city_rooms/banter.py`): потерял роль, арестован, перекупил роль у человека, удар
 * погашен Защитой, обобрали, оклеветали, серая операция провалилась или удалась, купил
 * легендарный объект, взял крупный проект, победил, проиграл.
 */

type Lines = Record<string, string[]>;
interface Book {
  any: Lines;
  by: Record<string, Lines>;
}

const ru: Book = {
  any: {
    lost_role: ["Роль — дело наживное.", "Ничего. Я это запомнил.", "Кресло ещё тёплое, не привыкайте."],
    jailed: [
      "Это недоразумение. Мой адвокат уже едет.",
      "В камере хотя бы никто не раздувает истории.",
      "Вернусь через ход. Ничего не трогайте.",
    ],
    took_your_role: ["Ничего личного. Просто бизнес.", "Табличку с двери сниму сам.", "Кресло удобное. Спасибо, что нагрели."],
    blocked: [
      "Защита окупилась. Спасибо, что проверили.",
      "Мимо. Попробуйте ещё, если не жалко.",
      "Мои юристы передают привет.",
    ],
    robbed: ["Эй, это было моё!", "Считайте это беспроцентным займом.", "Запишу на ваш счёт. С процентами."],
    smeared: ["Это клевета. Почти вся.", "Без комментариев.", "Журналисты нынче совсем распоясались."],
    grey_fail: ["Этого не было. Вы ничего не видели.", "Кубик явно подкуплен.", "Пробный запуск. Так и задумано."],
    grey_full: ["Чисто сработано.", "Никто ничего не докажет.", "Учитесь, пока я здесь."],
    legendary: ["Такое в хозяйстве пригодится.", "Дорого? Зато красиво.", "Ещё одна скромная покупка."],
    big_project: ["Ленточку перережу сам.", "Город скажет спасибо. Мне.", "Хорошо смотрится в моём портфеле."],
    won: ["Спасибо всем. Было приятно выигрывать.", "Город мой. Расходимся.", "Хорошая партия. Особенно финал."],
    lost: ["Реванш?", "Мне просто не шла карта.", "Поздравляю. Я это запомню."],
  },
  by: {
    boris: {
      legendary: ["Это не трата. Это инвестиция.", "Окупится за три раунда.", "Деньги должны работать."],
      robbed: ["У меня каждый доллар на счету. Буквально.", "Верните. Я знаю, сколько там было."],
      lost: ["Зато у меня остались деньги. Много.", "По деньгам победил я.", "Меценатство раз в ход — вот кто меня обыграл."],
      won: ["Сложный процент не подводит.", "Я просто считал деньги. Дольше всех."],
    },
    raider: {
      took_your_role: ["Плохо лежало.", "Было ваше — стало наше.", "Слабых кресел нет. Есть слабые хозяева."],
      grey_full: ["Вот так это делается.", "Больно? Это только начало.", "Следующий."],
      lost_role: ["Верну. С процентами.", "Зря. Теперь я злой."],
      blocked: ["О, вы тоже пробуете? Мило.", "Меня так просто не возьмёшь."],
      won: ["Я предупреждал.", "Слабые строят. Сильные забирают."],
      lost: ["В следующий раз начну с вас.", "Вам повезло, что раундов всего пятнадцать."],
    },
    builder: {
      big_project: ["Строили, строили и наконец построили.", "Сдано в срок. Почти.", "Город растёт. И я вместе с ним."],
      smeared: ["Я же просто строю. За что?", "У меня стройка, мне некогда оправдываться."],
      lost_role: ["Без кресла, зато с проектами.", "Вето жалко. Остальное переживу."],
      won: ["Город построен. Можно жить.", "Проекты решают. Всегда решали."],
      lost: ["Я хотя бы что-то построил.", "Недострой. Бывает."],
    },
    oracle: {
      grey_fail: ["Я это предвидел. Просто не поверил.", "Вероятность была на моей стороне. Кубик — нет."],
      won: ["Я знал, чем всё кончится.", "Как и было предсказано."],
      lost: ["Этого в прогнозе не было.", "Статистическая погрешность."],
      took_your_role: ["Это был самый вероятный исход.", "Я просчитал: вам она нужна меньше."],
    },
    ledger: {
      robbed: ["Занёс в графу «убытки».", "Учтено. Взыщу позже."],
      legendary: ["Проведено по статье «необходимое».", "Цифры сошлись — беру."],
      won: ["Баланс сошёлся.", "Всё по смете."],
      lost: ["Дебет с кредитом не сошёлся.", "Спишем на прочие расходы."],
    },
  },
};

const en: Book = {
  any: {
    lost_role: ["Roles come and go.", "Fine. I'll remember this.", "The chair's still warm. Don't get comfortable."],
    jailed: [
      "A misunderstanding. My lawyer is on the way.",
      "At least nobody blows up stories in a cell.",
      "Back in a turn. Don't touch anything.",
    ],
    took_your_role: ["Nothing personal. Just business.", "I'll take the nameplate down myself.", "Comfy chair. Thanks for warming it."],
    blocked: ["Protection paid off. Thanks for testing it.", "Missed. Try again, if you can spare it.", "My lawyers send their regards."],
    robbed: ["Hey, that was mine!", "Call it an interest-free loan.", "I'm putting that on your tab. With interest."],
    smeared: ["That's slander. Most of it.", "No comment.", "Journalists these days have no shame."],
    grey_fail: ["That never happened. You saw nothing.", "The die was clearly bribed.", "A test run. All according to plan."],
    grey_full: ["Clean work.", "Nobody can prove a thing.", "Watch and learn."],
    legendary: ["That'll come in handy.", "Pricey? Sure. But pretty.", "Just another modest purchase."],
    big_project: ["I'll cut the ribbon myself.", "The city will thank me.", "Looks good in my portfolio."],
    won: ["Thank you all. Winning was a pleasure.", "The city is mine. We're done here.", "Good game. Especially the ending."],
    lost: ["Rematch?", "The cards just weren't with me.", "Congratulations. I'll remember this."],
  },
  by: {
    boris: {
      legendary: ["It's not spending. It's investing.", "Pays for itself in three rounds.", "Money has to work."],
      robbed: ["I count every dollar. Literally.", "Give it back. I know how much was there."],
      lost: ["At least I still have money. Lots.", "On money, I won.", "One donation a turn — that's what beat me."],
      won: ["Compound interest never fails.", "I just counted money. Longer than anyone."],
    },
    raider: {
      took_your_role: ["It was lying around.", "Was yours — now it's ours.", "No weak chairs. Only weak owners."],
      grey_full: ["That's how it's done.", "Hurts? That was the warm-up.", "Next."],
      lost_role: ["I'll take it back. With interest.", "Bad idea. Now I'm angry."],
      blocked: ["Oh, you're trying too? Cute.", "I don't go down that easy."],
      won: ["I did warn you.", "The weak build. The strong take."],
      lost: ["Next time I start with you.", "Lucky for you it's only fifteen rounds."],
    },
    builder: {
      big_project: ["Built it. Finally.", "Delivered on schedule. Almost.", "The city grows. So do I."],
      smeared: ["I just build things. Why me?", "I have a site to run. No time for this."],
      lost_role: ["No chair, but plenty of projects.", "I'll miss the veto. The rest I'll survive."],
      won: ["The city's built. Time to live in it.", "Projects decide. They always did."],
      lost: ["At least I built something.", "Unfinished. It happens."],
    },
    oracle: {
      grey_fail: ["I foresaw this. I just didn't believe it.", "The odds were with me. The die wasn't."],
      won: ["I knew how this would end.", "As predicted."],
      lost: ["That wasn't in the forecast.", "A statistical error."],
      took_your_role: ["It was the most likely outcome.", "I ran the numbers: you needed it less."],
    },
    ledger: {
      robbed: ["Filed under losses.", "Noted. I'll collect later."],
      legendary: ["Booked as a necessity.", "The numbers add up — I'll take it."],
      won: ["The books balance.", "All within budget."],
      lost: ["The books didn't balance.", "We'll write it off."],
    },
  },
};

const cs: Book = {
  any: {
    lost_role: ["Role přicházejí a odcházejí.", "Dobře. Tohle si zapamatuju.", "Křeslo je ještě teplé. Nezvykejte si."],
    jailed: ["To je nedorozumění. Můj advokát už jede.", "V cele aspoň nikdo nenafukuje aféry.", "Za tah jsem zpátky. Na nic nesahejte."],
    took_your_role: ["Nic osobního. Jen byznys.", "Jmenovku ze dveří sundám sám.", "Pohodlné křeslo. Díky za zahřátí."],
    blocked: ["Ochrana se vyplatila. Díky za vyzkoušení.", "Vedle. Zkuste to znovu, jestli vám to nevadí.", "Moji právníci pozdravují."],
    robbed: ["Hej, to bylo moje!", "Berte to jako bezúročnou půjčku.", "Píšu vám to na účet. I s úroky."],
    smeared: ["To je pomluva. Skoro celá.", "Bez komentáře.", "Novináři si dnes dovolí všechno."],
    grey_fail: ["To se nestalo. Nic jste neviděli.", "Ta kostka je podplacená.", "Zkušební pokus. Přesně podle plánu."],
    grey_full: ["Čistá práce.", "Nikdo nic nedokáže.", "Dívejte se a učte se."],
    legendary: ["To se bude hodit.", "Drahé? Ale krásné.", "Další skromný nákup."],
    big_project: ["Pásku přestřihnu sám.", "Město poděkuje. Mně.", "V mém portfoliu to vypadá dobře."],
    won: ["Díky všem. Vyhrávat bylo příjemné.", "Město je moje. Rozchod.", "Dobrá hra. Hlavně konec."],
    lost: ["Odveta?", "Prostě mi nešla karta.", "Gratuluju. Zapamatuju si to."],
  },
  by: {
    boris: {
      legendary: ["To není útrata. To je investice.", "Za tři kola se to vrátí.", "Peníze musí pracovat."],
      robbed: ["Mám spočítaný každý dolar. Doslova.", "Vraťte to. Vím, kolik tam bylo."],
      lost: ["Aspoň mi zbyly peníze. Hodně.", "Na peníze jsem vyhrál já.", "Jeden dar za tah — to mě porazilo."],
      won: ["Složené úročení nezklame.", "Jen jsem počítal peníze. Nejdéle ze všech."],
    },
    raider: {
      took_your_role: ["Leželo to ladem.", "Bylo vaše — teď je naše.", "Slabá křesla nejsou. Jen slabí majitelé."],
      grey_full: ["Takhle se to dělá.", "Bolí? To byl teprve začátek.", "Další."],
      lost_role: ["Vezmu si to zpátky. I s úroky.", "Chyba. Teď jsem naštvaný."],
      blocked: ["Vy to taky zkoušíte? Roztomilé.", "Tak snadno mě nedostanete."],
      won: ["Varoval jsem vás.", "Slabí stavějí. Silní berou."],
      lost: ["Příště začnu u vás.", "Máte štěstí, že kol je jen patnáct."],
    },
    builder: {
      big_project: ["Stavěli jsme, až jsme postavili.", "Odevzdáno v termínu. Skoro.", "Město roste. A já s ním."],
      smeared: ["Já jen stavím. Za co?", "Mám stavbu, na vysvětlování nemám čas."],
      lost_role: ["Bez křesla, ale s projekty.", "Veta je škoda. Zbytek přežiju."],
      won: ["Město stojí. Dá se v něm žít.", "Rozhodují projekty. Vždycky rozhodovaly."],
      lost: ["Aspoň jsem něco postavil.", "Nedostavěno. Stává se."],
    },
    oracle: {
      grey_fail: ["Tohle jsem předvídal. Jen jsem tomu nevěřil.", "Pravděpodobnost byla se mnou. Kostka ne."],
      won: ["Věděl jsem, jak to skončí.", "Jak bylo předpovězeno."],
      lost: ["Tohle v prognóze nebylo.", "Statistická odchylka."],
      took_your_role: ["Byl to nejpravděpodobnější výsledek.", "Spočítal jsem si to: vy ji potřebujete míň."],
    },
    ledger: {
      robbed: ["Zapsáno do ztrát.", "Evidováno. Vyberu později."],
      legendary: ["Zaúčtováno jako nezbytnost.", "Čísla sedí — beru."],
      won: ["Bilance sedí.", "Vše podle rozpočtu."],
      lost: ["Má dáti a dal se nesešly.", "Odepíšeme to."],
    },
  },
};

const BOOKS: Record<string, Book> = { ru, en, cs };

/** Текст реплики на языке читателя: у бота — фраза по поводу и характеру, у человека — как написал. */
export function chatText(message: ChatMessage, game: GameState | null | undefined): string {
  const line = message.line;
  if (!line) return message.text;
  const book = BOOKS[i18next.language?.slice(0, 2)] ?? en;
  const policy = game?.players.find(player => player.id === message.player_id)?.difficulty ?? "";
  const lines = book.by[policy]?.[line.trigger] ?? book.any[line.trigger] ?? en.any[line.trigger];
  return lines?.length ? lines[line.n % lines.length] : "…";
}
