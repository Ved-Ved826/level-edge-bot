import React from 'react';

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
  statusColor?: string;
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
  statusColor = '#23a55a',
}: CardProps) => {
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
        backgroundColor: '#18191c',
        borderRadius: '24px',
        padding: '28px',
        boxSizing: 'border-box',
        color: '#ffffff',
        fontFamily: 'Inter',
        alignItems: 'center',
        border: '1px solid #2b2d31',
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
            border: '4px solid #18191c',
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
                  alignItems: 'baseline',
                  gap: '4px',
                  backgroundColor: 'rgba(255, 136, 0, 0.15)',
                  padding: '4px 10px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 136, 0, 0.4)',
                }}
              >
                <span style={{ fontSize: '12px', color: '#ff8800', fontWeight: 600 }}>🔥</span>
                <span style={{ fontSize: '18px', color: '#ffaa44', fontWeight: 700 }}>{streakDays}</span>
                <span style={{ fontSize: '12px', color: '#ff9c2e' }}>дн.</span>
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
                background: 'linear-gradient(90deg, #5865f2 0%, #23a55a 100%)',
                boxShadow: '0 0 12px rgba(35, 165, 90, 0.5)',
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