// "Mo the Mortar": an original blob character in a graduation cap. Colors come from theme CSS variables.
export type MascotMood = 'happy' | 'cheer' | 'think' | 'sleep';

const v = (name: string) => `var(--color-${name})`;
const BODY = 'M60 30 C88 30 104 52 104 76 C104 96 86 106 60 106 C34 106 16 96 16 76 C16 52 32 30 60 30 Z';
const LABEL: Record<MascotMood, string> = { happy: 'Mo the mascot, smiling', cheer: 'Mo the mascot, cheering', think: 'Mo the mascot, thinking', sleep: 'Mo the mascot, sleeping' };

export function Mascot({ mood = 'happy', size = 96 }: { mood?: MascotMood; size?: number }) {
  const stroke = { fill: 'none', stroke: v('on-fun'), strokeWidth: 3.5, strokeLinecap: 'round' as const };
  const look = mood === 'think' ? { x: 3, y: -3 } : { x: 0, y: 0 };
  const eyeL = 46 + look.x; const eyeR = 74 + look.x; const eyeY = 66 + look.y;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={LABEL[mood]} focusable="false" style={{ overflow: 'visible' }}>
      <ellipse cx="60" cy="110" rx="30" ry="5" style={{ fill: v('ink') }} opacity="0.12" />
      <g className={mood === 'sleep' ? 'mascot-breathe' : 'mascot-bounce'}>
        {/* arms */}
        {mood === 'cheer' ? (
          <>
            <path d="M20 74 L8 46" style={{ stroke: v('fun-green-dark') }} strokeWidth="11" strokeLinecap="round" />
            <path d="M100 74 L112 46" style={{ stroke: v('fun-green-dark') }} strokeWidth="11" strokeLinecap="round" />
            <path d="M20 74 L8 46" style={{ stroke: v('fun-green') }} strokeWidth="7" strokeLinecap="round" />
            <path d="M100 74 L112 46" style={{ stroke: v('fun-green') }} strokeWidth="7" strokeLinecap="round" />
          </>
        ) : (
          <>
            <ellipse cx="15" cy="82" rx="6" ry="10" transform="rotate(12 15 82)" style={{ fill: v('fun-green-dark') }} />
            {mood === 'think'
              ? <path d="M104 82 L86 84" style={{ stroke: v('fun-green-dark') }} strokeWidth="11" strokeLinecap="round" />
              : <ellipse cx="105" cy="82" rx="6" ry="10" transform="rotate(-12 105 82)" style={{ fill: v('fun-green-dark') }} />}
          </>
        )}
        {/* feet */}
        <ellipse cx="44" cy="106" rx="11" ry="5" style={{ fill: v('fun-green-dark') }} />
        <ellipse cx="76" cy="106" rx="11" ry="5" style={{ fill: v('fun-green-dark') }} />
        {/* body with 3D edge */}
        <path d={BODY} transform="translate(0 4)" style={{ fill: v('fun-green-dark') }} />
        <path d={BODY} style={{ fill: v('fun-green') }} />
        <ellipse cx="42" cy="50" rx="9" ry="5" transform="rotate(-25 42 50)" fill="#fff" opacity="0.28" />
        {/* cheeks */}
        <ellipse cx="35" cy="79" rx="7" ry="4.5" style={{ fill: v('fun-pink') }} opacity="0.85" />
        <ellipse cx="85" cy="79" rx="7" ry="4.5" style={{ fill: v('fun-pink') }} opacity="0.85" />
        {/* eyes */}
        {mood === 'cheer' && (<><path d={`M40 68 Q46 59 52 68`} {...stroke} /><path d={`M68 68 Q74 59 80 68`} {...stroke} /></>)}
        {mood === 'sleep' && (<><path d={`M40 65 Q46 72 52 65`} {...stroke} /><path d={`M68 65 Q74 72 80 65`} {...stroke} /></>)}
        {(mood === 'happy' || mood === 'think') && (
          <>
            <ellipse cx={eyeL} cy={eyeY} rx="5" ry="7" style={{ fill: v('on-fun') }} />
            <ellipse cx={eyeR} cy={eyeY} rx="5" ry="7" style={{ fill: v('on-fun') }} />
            <circle cx={eyeL + 1.6} cy={eyeY - 2.8} r="2" fill="#fff" />
            <circle cx={eyeR + 1.6} cy={eyeY - 2.8} r="2" fill="#fff" />
          </>
        )}
        {/* mouth */}
        {mood === 'happy' && <path d="M52 80 Q60 89 68 80" {...stroke} />}
        {mood === 'cheer' && (<><path d="M49 79 Q60 98 71 79 Z" style={{ fill: v('on-fun'), stroke: v('on-fun') }} strokeWidth="3" strokeLinejoin="round" /><ellipse cx="60" cy="88" rx="5" ry="3" style={{ fill: v('fun-pink') }} /></>)}
        {mood === 'think' && <path d="M54 85 Q61 82 68 86" {...stroke} />}
        {mood === 'sleep' && <ellipse cx="60" cy="84" rx="3.5" ry="3" style={{ fill: v('on-fun') }} />}
        {/* mortarboard */}
        <g transform={mood === 'sleep' ? 'rotate(-9 60 32)' : undefined}>
          <path d="M38 27 L38 40 Q60 50 82 40 L82 27 Z" style={{ fill: v('fun-purple-dark') }} />
          <polygon points="60,6 102,21 60,36 18,21" style={{ fill: v('fun-purple'), stroke: v('fun-purple-dark') }} strokeWidth="3" strokeLinejoin="round" />
          <circle cx="60" cy="21" r="3.2" style={{ fill: v('fun-yellow') }} />
          <path d="M60 21 L94 24 L95 42" fill="none" style={{ stroke: v('fun-yellow-dark') }} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          <ellipse cx="95" cy="46" rx="3.2" ry="5.5" style={{ fill: v('fun-yellow') }} />
        </g>
        {/* mood extras */}
        {mood === 'think' && (
          <g>
            <circle cx="104" cy="26" r="2.5" style={{ fill: v('fun-blue') }} />
            <circle cx="110" cy="16" r="3.5" style={{ fill: v('fun-blue') }} />
            <text x="107" y="9" fontSize="11" fontWeight="800" textAnchor="middle" style={{ fill: v('fun-blue-dark') }}>?</text>
          </g>
        )}
        {mood === 'sleep' && (
          <g fontWeight="800" style={{ fill: v('fun-blue-dark') }}>
            <text x="94" y="34" fontSize="12">z</text><text x="103" y="22" fontSize="9">z</text>
          </g>
        )}
        {mood === 'cheer' && (
          <g style={{ fill: v('fun-yellow') }}>
            <path d="M8 22 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" /><path d="M110 28 l1.5 4 4 1.5 -4 1.5 -1.5 4 -1.5 -4 -4 -1.5 4 -1.5z" />
          </g>
        )}
      </g>
    </svg>
  );
}
