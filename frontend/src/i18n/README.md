# Переводы / Translations / Překlady

Языки: русский (исходный), English, čeština. Язык по умолчанию: выбор игрока → `?lang=` в ссылке → язык браузера → English.

## Где что лежит

| Файл | Что внутри |
|---|---|
| `locales/<lang>/common.json` | общее: ошибки, загрузка, уровни ботов, язык |
| `locales/<lang>/home.json` | главная, лобби, «О проекте», обратная связь |
| `locales/<lang>/game.json` | вся игра: подписи, хроника, эффекты карт, окна |
| `locales/<lang>/catalog.json` | названия и описания карт, ролей, районов, проектов (по id из каталога сервера) |
| `../online/rules/<lang>.ts` | книга правил — связный текст, по файлу на язык |

## Правила

- **Пишем просто.** Короткие фразы, без канцелярита и идиом — чтобы понимал игрок без уровня C1.
- **Новая строка** сначала появляется в `ru`, потом в `en` и `cs`. Тест `i18n.test.ts` проверит, что ключи совпадают, и что у множественных форм есть все варианты (в русском и чешском их больше, чем в английском).
- **Новая карта** в каталоге сервера должна появиться во всех `catalog.json` — это проверяет `catalog.test.ts`.
- **Числа не пишем в текст руками**, если они приходят из движка: цены, шансы, лимиты подставляются через `{{…}}`.

## Словарь терминов

Один термин — один перевод во всех местах.

| Русский | English | Čeština |
|---|---|---|
| Объект | Business | Podnik |
| Район | District | Čtvrť |
| Влияние ◆ | Influence | Vliv |
| Скандал ⚠ | Scandal | Skandál |
| Крыша 🛡 | Protection | Ochrana |
| Городской проект | City project | Městský projekt |
| Серая операция | Shady deal | Šedý kšeft |
| Действие | Action | Akce |
| Раунд / ход | Round / turn | Kolo / tah |
| Слот | Slot | Místo |
| Рынок | Market | Trh |
| Рука | Hand | Ruka |
| Хроника | Log | Kronika |
| Арест | Arrest | Zatčení |
| Синергия | Synergy | Synergie |
| Метка (Капиталиста) | Claim | Zábor |
| Серая метка (Мафиози) | Grey hold | Šedá blokace |
| Рэкет | Racket | Výpalné |
| Вето | Veto | Veto |
| Обмен (деньги → влияние) | Exchange | Výměna |
| Меценатство | Patronage | Mecenášství |
| Лоббирование | Lobbying | Lobbing |
| Капиталист | Capitalist | Kapitalista |
| Политик | Politician | Politik |
| Журналист | Journalist | Novinář |
| Аферист | Hustler | Podvodník |
| Мафиози | Mobster | Mafián |
| Силовик | Enforcer | Bezpečák |
| Спальный район | Residential Area | Sídliště |
| Деловой центр | Business District | Obchodní čtvrť |
| Промзона | Industrial Zone | Průmyslová zóna |
| Технокластер | Tech Cluster | Tech klastr |
| Административный квартал | Government Quarter | Vládní čtvrť |
| Серый сектор | Grey Sector | Šedá zóna |
