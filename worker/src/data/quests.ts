// Пул ежедневных квестов.

export const DEFAULT_QUESTS = [
  { id: "msg_1", title: "Разминка пальцев", desc: "Отправьте 10 сообщений в чат", type: "messages", target: 10, xp: 50 },
  { id: "msg_2", title: "Активный спикер", desc: "Отправьте 30 сообщений в чат", type: "messages", target: 30, xp: 150 },
  { id: "msg_3", title: "Гроза чата", desc: "Отправьте 60 сообщений в чат", type: "messages", target: 60, xp: 300 },
  { id: "msg_4", title: "Стена текста", desc: "Отправьте 100 сообщений в чат", type: "messages", target: 100, xp: 500 },
  { id: "vc_1", title: "Заглянул на огонёк", desc: "Проведите 15 минут в голосовом канале", type: "voice", target: 15, xp: 100 },
  { id: "vc_2", title: "Душевный разговор", desc: "Проведите 45 минут в голосовом канале", type: "voice", target: 45, xp: 250 },
  { id: "vc_3", title: "Войс-марафон", desc: "Проведите 90 минут в голосовом канале", type: "voice", target: 90, xp: 450 },
  { id: "sp_1", title: "Двойной удар", desc: "Отправьте 25 сообщений в чат", type: "messages", target: 25, xp: 120 },
  { id: "sp_2", title: "Ночной дозор", desc: "Проведите 30 минут в войсе", type: "voice", target: 30, xp: 200 },
];
