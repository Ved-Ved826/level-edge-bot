import React from 'react';

interface CardProps {
  username: string;
  avatarUrl: string;
  level: number;
  rank: number;
  totalUsers: number;
  xp: number;
  nextLevelXp: number;
  progress: number;
  messagesCount: number;
  voiceHours: number;
  statusColor: string;
}

export const Card = ({
  username,
  avatarUrl,
  level,
  rank,
  totalUsers,
  xp,
  nextLevelXp,
  progress,
  messagesCount,
  voiceHours,
  statusColor,
}: CardProps) => {
  return (
    <div
      style={{
        display: 'flex',
        width: '800px',
        height: '280px',
        background: 'linear-gradient(135deg, #2c2f33 0%, #23272a 100%)',
        borderRadius: '16px',
        padding: '32px',
        fontFamily: 'Inter, sans-serif',
        color: '#ffffff',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Decorative background elements */}
      <div
        style={{
          position: 'absolute',
          top: '-50px',
          right: '-50px',
          width: '200px',
          height: '200px',
          background: 'rgba(88, 101, 242, 0.1)',
          borderRadius: '50%',
          filter: 'blur(40px)',
        }}
      />

      {/* Left side - Avatar with status ring */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          marginRight: '32px',
        }}
      >
        {/* Avatar container with status ring */}
        <div
          style={{
            position: 'relative',
            width: '120px',
            height: '120px',
          }}
        >
          {/* Status ring */}
          <div
            style={{
              position: 'absolute',
              top: '-4px',
              left: '-4px',
              width: '128px',
              height: '128px',
              borderRadius: '50%',
              background: `conic-gradient(${statusColor} 0deg 360deg, transparent 360deg)`,
            }}
          />

          {/* Avatar */}
          <img
            src={avatarUrl}
            style={{
              position: 'absolute',
              top: '4px',
              left: '4px',
              width: '112px',
              height: '112px',
              borderRadius: '50%',
              objectFit: 'cover',
              border: '4px solid #2c2f33',
            }}
          />
        </div>

        {/* Username */}
        <div
          style={{
            marginTop: '16px',
            fontSize: '20px',
            fontWeight: '700',
            textAlign: 'center',
            maxWidth: '140px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {username}
        </div>
      </div>

      {/* Right side - Stats */}
      <div
        style={{
          display: 'flex',
          flex: '1',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        {/* Top stats row */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: '16px',
          }}
        >
          {/* Level */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                fontSize: '14px',
                color: '#99aab5',
                marginBottom: '4px',
              }}
            >
              Уровень
            </div>
            <div
              style={{
                fontSize: '32px',
                fontWeight: '700',
                color: '#5865f2',
              }}
            >
              {level}
            </div>
          </div>

          {/* Rank */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
            }}
          >
            <div
              style={{
                fontSize: '14px',
                color: '#99aab5',
                marginBottom: '4px',
              }}
            >
              Позиция
            </div>
            <div
              style={{
                fontSize: '28px',
                fontWeight: '700',
              }}
            >
              #{rank} <span style={{ fontSize: '18px', color: '#99aab5' }}>из {totalUsers}</span>
            </div>
          </div>
        </div>

        {/* XP Progress */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            marginBottom: '20px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '8px',
            }}
          >
            <div
              style={{
                fontSize: '14px',
                color: '#99aab5',
              }}
            >
              Опыт
            </div>
            <div
              style={{
                fontSize: '14px',
                fontWeight: '600',
              }}
            >
              {xp.toLocaleString()} / {nextLevelXp.toLocaleString()} XP
            </div>
          </div>

          {/* Progress bar background */}
          <div
            style={{
              width: '100%',
              height: '24px',
              background: '#1e2124',
              borderRadius: '12px',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            {/* Progress bar fill with neon glow */}
            <div
              style={{
                width: `${progress}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #5865f2 0%, #7289da 100%)',
                boxShadow: '0 0 20px rgba(88, 101, 242, 0.5)',
                borderRadius: '12px',
              }}
            />

            {/* Progress percentage text */}
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                fontSize: '12px',
                fontWeight: '700',
                color: '#ffffff',
                textShadow: '0 1px 4px rgba(0, 0, 0, 0.5)',
              }}
            >
              {Math.round(progress)}%
            </div>
          </div>
        </div>

        {/* Bottom stats row */}
        <div
          style={{
            display: 'flex',
            gap: '24px',
          }}
        >
          {/* Messages stat */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: 'rgba(32, 34, 37, 0.6)',
              padding: '12px 20px',
              borderRadius: '12px',
              flex: '1',
            }}
          >
            <div
              style={{
                fontSize: '24px',
                marginRight: '12px',
              }}
            >
              💬
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div
                style={{
                  fontSize: '12px',
                  color: '#99aab5',
                }}
              >
                Сообщений
              </div>
              <div
                style={{
                  fontSize: '20px',
                  fontWeight: '700',
                }}
              >
                {messagesCount.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Voice stat */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              background: 'rgba(32, 34, 37, 0.6)',
              padding: '12px 20px',
              borderRadius: '12px',
              flex: '1',
            }}
          >
            <div
              style={{
                fontSize: '24px',
                marginRight: '12px',
              }}
            >
              🎙️
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div
                style={{
                  fontSize: '12px',
                  color: '#99aab5',
                }}
              >
                В войсе
              </div>
              <div
                style={{
                  fontSize: '20px',
                  fontWeight: '700',
                }}
              >
                {voiceHours}ч
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
