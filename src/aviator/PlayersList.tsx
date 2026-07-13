import type { AviatorPlayer } from '../lib/aviator';
import { useI18n } from '../i18n/LanguageContext';

// Live players on the current round: who bet, who cashed out at what. Winners
// (cashed) float to the top with their multiplier + payout; still-flying bets
// show as active; busted bets grey out. `meId` marks the viewer's own rows.
export default function PlayersList({ players, meId }: { players: AviatorPlayer[]; meId?: string }) {
  const { t } = useI18n();
  const sorted = [...players].sort((a, b) => rank(a) - rank(b) || (b.stake - a.stake));
  return (
    <div className="av-players">
      <div className="av-players-head">
        <span>{t('av2.players')}</span><span className="tnum">{players.length}</span>
      </div>
      {players.length === 0 ? (
        <div className="av-players-empty">{t('av2.noBets')}</div>
      ) : (
        <div className="av-players-list">
          {sorted.map((p) => (
            <div key={p.id} className={`av-prow st-${p.status} ${p.user_id === meId ? 'is-me' : ''}`}>
              <span className="av-pname">{p.user_id === meId ? t('av2.you') : p.username}{p.slot === 2 ? ' ·2' : ''}</span>
              <span className="av-pstake tnum">{p.stake}</span>
              {p.status === 'won' ? (
                <span className="av-pmult tnum">{p.cashout_multiplier?.toFixed(2)}x <b>+{p.payout}</b></span>
              ) : p.status === 'lost' ? (
                <span className="av-pmult av-pmult-lost">—</span>
              ) : (
                <span className="av-pmult av-pmult-live">oynuyor…</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// won first, then flying, then busted
function rank(p: AviatorPlayer): number {
  return p.status === 'won' ? 0 : p.status === 'placed' ? 1 : 2;
}
