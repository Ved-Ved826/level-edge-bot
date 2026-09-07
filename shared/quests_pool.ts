// Пул ежедневных квестов для инициализации базы данных
// Этот файл содержит шаблоны квестов, которые могут назначаться ежедневно

export interface QuestTemplate {
  id: string;
  title: string;
  description: string;
  quest_type: 'messages' | 'voice_minutes' | 'combo';
  target_value: number;
  reward_xp: number;
  is_active: boolean;
}

// Пул квестов (минимум 15 разнообразных)
// 5 текстовых квестов
// 5 голосовых квестов
// 5 комбо/особых квестов
export const QUESTS_POOL: QuestTemplate[] = [
  // === Текстовые квесты (messages) ===
  {
    id: 'messages_warmup_10_50xp',
    title: 'Разминка пальцев',
    description: 'Отправьте 10 сообщений в чат',
    quest_type: 'messages',
    target_value: 10,
    reward_xp: 50,
    is_active: true,
  },
  {
    id: 'messages_active_speaker_30_150xp',
    title: 'Активный спикер',
    description: 'Отправьте 30 сообщений в чат',
    quest_type: 'messages',
    target_value: 30,
    reward_xp: 150,
    is_active: true,
  },
  {
    id: 'messages_chat_god_60_300xp',
    title: 'Гроза чата',
    description: 'Отправьте 60 сообщений в чат',
    quest_type: 'messages',
    target_value: 60,
    reward_xp: 300,
    is_active: true,
  },
  {
    id: 'messages_wall_text_100_500xp',
    title: 'Стена текста',
    description: 'Отправьте 100 сообщений в чат',
    quest_type: 'messages',
    target_value: 100,
    reward_xp: 500,
    is_active: true,
  },
  {
    id: 'messages_long_text_20_100xp',
    title: 'Философ',
    description: 'Отправьте 20 сообщений длиннее 100 символов',
    quest_type: 'messages',
    target_value: 20,
    reward_xp: 100,
    is_active: true,
  },

  // === Голосовые квесты (voice_minutes) ===
  {
    id: 'voice_peep_15_100xp',
    title: 'Заглянул на огонек',
    description: 'Побудьте 15 минут в голосовом канале',
    quest_type: 'voice_minutes',
    target_value: 15,
    reward_xp: 100,
    is_active: true,
  },
  {
    id: 'voice_deep_chat_45_250xp',
    title: 'Душевный разговор',
    description: 'Побудьте 45 минут в голосовом канале',
    quest_type: 'voice_minutes',
    target_value: 45,
    reward_xp: 250,
    is_active: true,
  },
  {
    id: 'voice_marathon_90_450xp',
    title: 'Войс-марафон',
    description: 'Побудьте 90 минут в голосовом канале',
    quest_type: 'voice_minutes',
    target_value: 90,
    reward_xp: 450,
    is_active: true,
  },
  {
    id: 'voice_host_150_750xp',
    title: 'Хозяин эфира',
    description: 'Побудьте 150 минут в голосовом канале',
    quest_type: 'voice_minutes',
    target_value: 150,
    reward_xp: 750,
    is_active: true,
  },
  {
    id: 'voice_night_30_200xp',
    title: 'Ночной дозор',
    description: 'Побудьте 30 минут в голосовом канале после 00:00 UTC',
    quest_type: 'voice_minutes',
    target_value: 30,
    reward_xp: 200,
    is_active: true,
  },

  // === Комбо/Особые квесты ===
  {
    id: 'combo_double_hit_25msg_25min_300xp',
    title: 'Двойной удар',
    description: 'Отправьте 25 сообщений И проведите 25 минут в голосовом канале',
    quest_type: 'combo',
    target_value: 25,
    reward_xp: 300,
    is_active: true,
  },
  {
    id: 'combo_morning_coffee_15msg_100xp',
    title: 'Утренний кофе',
    description: 'Отправьте 15 сообщений с 06:00 до 12:00 UTC',
    quest_type: 'messages',
    target_value: 15,
    reward_xp: 100,
    is_active: true,
  },
  {
    id: 'combo_late_night_10msg_20min_150xp',
    title: 'Совместное усилие',
    description: 'Отправьте 10 сообщений И проведите 20 минут в голосовом канале',
    quest_type: 'combo',
    target_value: 10,
    reward_xp: 150,
    is_active: true,
  },
  {
    id: 'combo_vocalization_50msg_50min_400xp',
    title: 'Баланс',
    description: 'Отправьте 50 сообщений И проведите 50 минут в голосовом канале',
    quest_type: 'combo',
    target_value: 50,
    reward_xp: 400,
    is_active: true,
  },
  {
    id: 'combo_super_active_100msg_100min_800xp',
    title: 'Ирония судьбы',
    description: 'Отправьте 100 сообщений И проведите 100 минут в голосовом канале',
    quest_type: 'combo',
    target_value: 100,
    reward_xp: 800,
    is_active: true,
  },
] as const;

// Генерация SQL для вставки квестов
export function generateQuestsInsertSQL(): string {
  const values = QUESTS_POOL.map((q) => {
    return `('${q.id}', '${q.title.replace(/'/g, "''")}', '${q.description.replace(/'/g, "''")}', '${q.quest_type}', ${q.target_value}, ${q.reward_xp}, ${q.is_active ? 1 : 0})`;
  }).join(',\n  ');

  return `
-- Инициализация пула квестов
INSERT INTO quests_pool (id, title, description, quest_type, target_value, reward_xp, is_active)
VALUES
  ${values}
ON CONFLICT(id) DO NOTHING;
`;
}
