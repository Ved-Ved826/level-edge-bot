import React from 'react';

// ============================================
// Палитра тем оформления (Этап 5 - Кастомизация)
// ============================================
export const THEMES = {
  default: {
    name: 'Классическая (Discord Blurple)',
    bg: '#18191c',
    accent: '#5865f2',
    barGradient: 'linear-gradient(90deg, #5865f2 0%, #23a55a 100%)',
    barGlow: 'rgba(35, 165, 90, 0.5)',
    borderColor: '#2b2d31',
  },
  cyberpunk: {
    name: 'Киберпанк (Неоновый роз / Бирюза)',
    bg: '#120d18',
    accent: '#ff007f',
    barGradient: 'linear-gradient(90deg, #ff007f 0%, #00f0ff 100%)',
    barGlow: 'rgba(0, 240, 255, 0.6)',
    borderColor: '#ff007f',
  },
  magma: {
    name: 'Магма (Вулканический огонь)',
    bg: '#180e0c',
    accent: '#ff3300',
    barGradient: 'linear-gradient(90deg, #ff3300 0%, #ff9900 100%)',
    barGlow: 'rgba(255, 153, 0, 0.6)',
    borderColor: '#ff3300',
  },
  midnight: {
    name: 'Полночь (Глубокий космос / Индиго)',
    bg: '#0b0c16',
    accent: '#9b59b6',
    barGradient: 'linear-gradient(90deg, #8e44ad 0%, #3498db 100%)',
    barGlow: 'rgba(155, 89, 182, 0.6)',
    borderColor: '#8e44ad',
  },
  emerald: {
    name: 'Изумруд (Зелёный нефрит / Золото)',
    bg: '#0b1610',
    accent: '#2ecc71',
    barGradient: 'linear-gradient(90deg, #27ae60 0%, #f1c40f 100%)',
    barGlow: 'rgba(241, 196, 15, 0.6)',
    borderColor: '#27ae60',
  },
};

export interface CardProps {
  username: string;
  avatarBase64: string;
  level: number;
  rank: number;
  totalUsers: number;
  xp: number;
  nextLevelXp: number;
  progress: number;
  messagesCount: number;
  voiceHours: number;
  streakDays?: number;
  prestigeCount?: number;
  statusColor?: string;
  themeId?: string;
  customTitle?: string;
}

export const Card = ({
  username,
  avatarBase64,
  level,
  rank,
  totalUsers,
  xp,
  nextLevelXp,
  progress,
  messagesCount,
  voiceHours,
  streakDays,
  prestigeCount,
  statusColor = '#23a55a',
  themeId = 'default',
  customTitle,
}: CardProps) => {
  const theme = THEMES[themeId as keyof typeof THEMES] || THEMES.default;
  const boundedProgress = Math.min(Math.max(progress, 0), 100);
  const remainingXp = Math.max(0, nextLevelXp - xp);
  const percent = Math.round(boundedProgress);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        width: '800px',
        height: '260px',
        backgroundColor: theme.bg,
        borderRadius: '24px',
        padding: '28px',
        boxSizing: 'border-box',
        color: '#ffffff',
        fontFamily: 'Inter',
        alignItems: 'center',
        border: `1px solid ${theme.borderColor}`,
      }}
    >
      {/* Левая колонка: Аватарка (140px + отступ 25px) */}
      <div
        style={{
          display: 'flex',
          position: 'relative',
          width: '140px',
          height: '140px',
          marginRight: '25px',
          flexShrink: 0,
        }}
      >
        <img
          src={avatarBase64}
          alt={username}
          style={{
            width: '140px',
            height: '140px',
            borderRadius: '70px',
            border: `4px solid ${statusColor}`,
            objectFit: 'cover',
          }}
        />
        {/* Индикатор статуса */}
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            bottom: '2px',
            right: '2px',
            width: '28px',
            height: '28px',
            borderRadius: '14px',
            backgroundColor: statusColor,
            border: '4px solid ' + theme.bg,
          }}
        />
      </div>

      {/* Правая колонка: четкая фиксированная ширина 575px (чтобы не вылезать за 800px) */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '575px',
          justifyContent: 'center',
        }}
      >
        {/* Верхняя строка: Имя + Ранг и Уровень */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '14px',
            width: '575px',
          }}
        >
          {/* Имя пользователя */}
          <span
            style={{
              display: 'flex',
              fontSize: '28px',
              fontWeight: 700,
              color: '#ffffff',
              maxWidth: '260px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {username}
            {/* Титул пользователя (если задан) */}
            {customTitle && customTitle !== 'Новичок' && (
              <span
                style={{
                  display: 'inline-flex',
                  marginLeft: '8px',
                  fontSize: '13px',
                  color: theme.accent,
                  fontWeight: 600,
                }}
              >
                [{customTitle}]
              </span>
            )}
          </span>

          {/* Плашки Ранг, Уровень и Стрик */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Ранг */}
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '4px',
                backgroundColor: '#232428',
                padding: '4px 10px',
                borderRadius: '8px',
                border: '1px solid #313338',
              }}
            >
              <span style={{ fontSize: '12px', color: '#949ba4', fontWeight: 600 }}>РАНГ</span>
              <span style={{ fontSize: '18px', color: '#ffffff', fontWeight: 700 }}>#{rank}</span>
              <span style={{ fontSize: '12px', color: '#6d6f78' }}>/{totalUsers}</span>
            </div>

            {/* Уровень */}
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '4px',
                backgroundColor: 'rgba(88, 101, 242, 0.15)',
                padding: '4px 10px',
                borderRadius: '8px',
                border: '1px solid rgba(88, 101, 242, 0.4)',
              }}
            >
              <span style={{ fontSize: '12px', color: '#808bf5', fontWeight: 600 }}>УРОВЕНЬ</span>
              <span style={{ fontSize: '18px', color: '#ffffff', fontWeight: 700 }}>{level}</span>
            </div>

            {/* Бейдж Стрика (Огоньки 🔥) */}
            {streakDays && streakDays > 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  backgroundColor: 'rgba(255, 136, 0, 0.15)',
                  padding: '4px 10px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 136, 0, 0.4)',
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="#ff8800">
                  <path d="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z"/>
                </svg>
                <span style={{ fontSize: '18px', color: '#ffaa44', fontWeight: 700 }}>{streakDays}</span>
                <span style={{ fontSize: '12px', color: '#ff9c2e' }}>дн.</span>
              </div>
            )}

            {/* Бейдж Престижа (Звёзды ⭐) */}
            {prestigeCount && prestigeCount > 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  backgroundColor: 'rgba(255, 215, 0, 0.15)',
                  padding: '4px 10px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 215, 0, 0.4)',
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="#ffd700">
                  <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                </svg>
                <span style={{ fontSize: '18px', color: '#ffd700', fontWeight: 700 }}>★ {prestigeCount}</span>
              </div>
            )}
          </div>
        </div>

        {/* Секция прогресс-бара */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            marginBottom: '16px',
            width: '575px',
          }}
        >
          {/* Текстовая инфо-строка над баром */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '6px',
              width: '575px',
            }}
          >
            {/* Сколько осталось до след уровня */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
              <span style={{ color: '#949ba4' }}>До ур. {level + 1}:</span>
              <span style={{ color: '#23a55a', fontWeight: 700 }}>{remainingXp.toLocaleString()} XP</span>
            </div>

            {/* Текущий опыт и процент */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
              <span style={{ color: '#ffffff', fontWeight: 700 }}>{xp.toLocaleString()}</span>
              <span style={{ color: '#6d6f78' }}>/ {nextLevelXp.toLocaleString()} XP</span>
              <span style={{ color: '#5865f2', fontWeight: 700, marginLeft: '2px' }}>({percent}%)</span>
            </div>
          </div>

          {/* Полоса прогресса */}
          <div
            style={{
              display: 'flex',
              width: '575px',
              height: '14px',
              backgroundColor: '#2b2d31',
              borderRadius: '7px',
              overflow: 'hidden',
              boxSizing: 'border-box',
              padding: '2px',
            }}
          >
            <div
              style={{
                display: 'flex',
                width: `${boundedProgress}%`,
                height: '100%',
                borderRadius: '5px',
                background: theme.barGradient,
                boxShadow: `0 0 12px ${theme.barGlow}`,
              }}
            />
          </div>
        </div>

        {/* Нижние плашки: Сообщения и Войс */}
        <div style={{ display: 'flex', gap: '14px', width: '575px' }}>
          {/* Сообщения */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: '#232428',
              padding: '8px 14px',
              borderRadius: '10px',
              gap: '10px',
              border: '1px solid #2b2d31',
              flex: 1,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#5865f2">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
            </svg>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '11px', color: '#949ba4', textTransform: 'uppercase', fontWeight: 600 }}>Сообщений</span>
              <span style={{ fontSize: '15px', fontWeight: 700, color: '#ffffff' }}>{messagesCount.toLocaleString()}</span>
            </div>
          </div>

          {/* Войс */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: '#232428',
              padding: '8px 14px',
              borderRadius: '10px',
              gap: '10px',
              border: '1px solid #2b2d31',
              flex: 1,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#23a55a">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
            </svg>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '11px', color: '#949ba4', textTransform: 'uppercase', fontWeight: 600 }}>В войсе</span>
              <span style={{ fontSize: '15px', fontWeight: 700, color: '#ffffff' }}>{voiceHours} ч.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};