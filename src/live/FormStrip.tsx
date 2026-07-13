import { useEffect, useState } from 'react';
import { matchProvider } from '../lib/matchProvider';
import { useI18n } from '../i18n/LanguageContext';
import type { MatchStats } from '../lib/types';

// Nesine-style "recent form" strip (W/D/L badges per team, most recent first).
// Data comes from the virtual-league stats RPC — truthful, not fabricated.
export default function FormStrip({ matchId, home, away }: { matchId: string; home: string; away: string }) {
  const { t } = useI18n();
  const [stats, setStats] = useState<MatchStats | null>(null);

  useEffect(() => {
    let alive = true;
    matchProvider.getMatchStats(matchId).then((s) => { if (alive) setStats(s); }).catch(() => { /* optional */ });
    return () => { alive = false; };
  }, [matchId]);

  const hForm = stats?.home.form ?? [];
  const aForm = stats?.away.form ?? [];
  if (hForm.length === 0 && aForm.length === 0) return null;

  const Row = ({ name, form }: { name: string; form: ('W' | 'D' | 'L')[] }) => (
    <div className="fs-row">
      <span className="fs-name">{name}</span>
      <span className="fs-badges">
        {form.slice(0, 5).map((r, i) => <span key={i} className={`fs-b fs-${r}`}>{t(`form.${r}`)}</span>)}
        {form.length === 0 && <span className="fs-none">–</span>}
      </span>
    </div>
  );

  return (
    <div className="card fs">
      <div className="fs-title">{t('live.form')}</div>
      <Row name={home} form={hForm} />
      <Row name={away} form={aForm} />
    </div>
  );
}
