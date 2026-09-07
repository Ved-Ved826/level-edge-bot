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
  statusColor?: string;
}

export const Card = (props: CardProps) => {
  const { username, avatarBase64, level, rank, totalUsers, xp, nextLevelXp, progress, messagesCount, voiceHours, statusColor = '#43b581' } = props;
  const boundedProgress = Math.min(Math.max(progress, 0), 100);
  return React.createElement('div', { style: { display: 'flex', flexDirection: 'row', width: '800px', height: '280px', backgroundColor: '#1e1f22', borderRadius: '24px', padding: '30px', boxSizing: 'border-box', color: '#ffffff', fontFamily: 'Inter, sans-serif', alignItems: 'center', border: '1px solid #2b2d31' } }, 
    React.createElement('div', { style: { display: 'flex', position: 'relative', width: '160px', height: '160px', marginRight: '32px', flexShrink: 0 } },
      React.createElement('img', { src: avatarBase64, alt: username, style: { width: '160px', height: '160px', borderRadius: '80px', border: `4px solid ${statusColor}`, objectFit: 'cover' } }),
      React.createElement('div', { style: { display: 'flex', position: 'absolute', bottom: '4px', right: '4px', width: '32px', height: '32px', borderRadius: '16px', backgroundColor: statusColor, border: '4px solid #1e1f22' } })
    ),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', flexGrow: 1, justifyContent: 'center' } },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px' } },
        React.createElement('span', { style: { fontSize: '32px', fontWeight: 700, maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, username),
        React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: '16px' } },
          React.createElement('span', { style: { fontSize: '20px', color: '#949ba4' } }, 'RANK ', React.createElement('span', { style: { color: '#ffffff', fontWeight: 700, fontSize: '28px' } }, `#${rank}`), React.createElement('span', { style: { fontSize: '16px' } }, `/${totalUsers}`)),
          React.createElement('span', { style: { fontSize: '20px', color: '#5865f2', fontWeight: 700 } }, 'LEVEL ', React.createElement('span', { style: { fontSize: '28px' } }, level))
        )
      ),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column', marginBottom: '20px' } },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: '6px', fontSize: '14px', color: '#b5bac1' } }, `${xp.toLocaleString()} / ${nextLevelXp.toLocaleString()} XP`),
        React.createElement('div', { style: { display: 'flex', width: '100%', height: '18px', backgroundColor: '#2b2d31', borderRadius: '9px', overflow: 'hidden', padding: '2px', boxSizing: 'border-box' } },
          React.createElement('div', { style: { display: 'flex', width: `${boundedProgress}%`, height: '100%', borderRadius: '7px', background: 'linear-gradient(90deg, #5865f2 0%, #00d26a 100%)', boxShadow: '0 0 12px rgba(0, 210, 106, 0.6)' } })
        )
      ),
      React.createElement('div', { style: { display: 'flex', gap: '20px' } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', backgroundColor: '#2b2d31', padding: '8px 16px', borderRadius: '12px', gap: '10px' } },
          React.createElement('span', { style: { fontSize: '18px' } }, '💬'),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' } },
            React.createElement('span', { style: { fontSize: '12px', color: '#949ba4' } }, 'Messages'),
            React.createElement('span', { style: { fontSize: '16px', fontWeight: 600 } }, messagesCount.toLocaleString())
          )
        ),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', backgroundColor: '#2b2d31', padding: '8px 16px', borderRadius: '12px', gap: '10px' } },
          React.createElement('span', { style: { fontSize: '18px' } }, '🎙️'),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' } },
            React.createElement('span', { style: { fontSize: '12px', color: '#949ba4' } }, 'Voice'),
            React.createElement('span', { style: { fontSize: '16px', fontWeight: 600 } }, `${voiceHours} h`)
          )
        )
      )
    )
  );
};
