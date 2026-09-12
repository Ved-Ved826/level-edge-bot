// Справочник боевых классов и их скиллов (Этап 12).

export interface ClassInfo {
  displayName: string;
  skill1Name: string;
  skill2Name: string;
}

export function getClassDisplayName(classId: string): string {
  const classes: Record<string, string> = {
    warrior: "🛡️ Паладин",
    berserker: "🪓 Берсерк",
    mage: "🔮 Архимаг",
    necromancer: "💀 Некромант",
    ranger: "🏹 Следопыт",
    assassin: "🗡️ Ассасин",
    artificer: "⚡ Техномаг",
    bard: "🎵 Бард",
  };
  return classes[classId] || classId;
}

export function getClassSkills(classId: string): { skill1Name: string; skill2Name: string } {
  const skills: Record<string, ClassInfo> = {
    warrior: {
      displayName: "🛡️ Паладин",
      skill1Name: "Удар щитом",
      skill2Name: "Божественный бастион",
    },
    berserker: {
      displayName: "🪓 Берсерк",
      skill1Name: "Рассекающий взмах",
      skill2Name: "Казнь",
    },
    mage: {
      displayName: "🔮 Архимаг",
      skill1Name: "Огненная стрела",
      skill2Name: "Звёздный метеор",
    },
    necromancer: {
      displayName: "💀 Некромант",
      skill1Name: "Костяное копьё",
      skill2Name: "Призыв орды",
    },
    ranger: {
      displayName: "🏹 Следопыт",
      skill1Name: "Прицельный выстрел",
      skill2Name: "Охотничий капкан",
    },
    assassin: {
      displayName: "🗡️ Ассасин",
      skill1Name: "Ядовитый клинок",
      skill2Name: "Танец теней",
    },
    artificer: {
      displayName: "⚡ Техномаг",
      skill1Name: "Шоковая турель",
      skill2Name: "Орбитальный лазер",
    },
    bard: {
      displayName: "🎵 Бард",
      skill1Name: "Боевой мотив",
      skill2Name: "Гимн победы",
    },
  };
  const info = skills[classId];
  return info
    ? { skill1Name: info.skill1Name, skill2Name: info.skill2Name }
    : { skill1Name: "Навык", skill2Name: "Ульта" };
}
