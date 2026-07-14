# React-клиент «Города влияния»

React + TypeScript + Vite. Клиент показывает список комнат, lobby, конфигурацию людей и ботов,
игровое состояние и только те команды, которые вернул авторитетный backend.

В React нет RNG, расчёта дохода и мутации игровых правил. Контент приходит через `/api/city/meta`,
состояние — через адаптивный REST polling, действия отправляются в `/api/city/rooms/{id}/commands`.

Из корня проекта:

```powershell
npm.cmd --prefix frontend install
npm.cmd --prefix frontend run dev
npm.cmd --prefix frontend run build
```

Dev-server проксирует `/api` на `http://127.0.0.1:8000`. Production использует same-origin routing
Vercel Services из корневого `vercel.json`.
