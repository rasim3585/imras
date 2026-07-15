import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { matchProvider } from '../lib/matchProvider';
import { simLines } from '../live/commentary';
import { isPenaltyGoal } from '../live/liveModel';
import PitchTV, { type GoalPulse } from '../live/PitchTV';
import CourtTV from '../live/CourtTV';
import TennisTV from '../live/TennisTV';
import { playerName } from '../lib/playerNames';
import type { LiveState } from '../lib/types';

// Kuponun son eklenen SANAL maçının kompakt canlı izlemesi. 0715: el yapımı
// mini saha yerine Watch Live'daki GERÇEK TV bileşenleri gömülür
// (futbol→PitchTV, basket→CourtTV, tenis/voleybol→TennisTV) — aynı motor,
// aynı saat, aynı görsel; iki görünüm asla farklı hikâye anlatamaz.
export type MiniSport = 'football' | 'basketball' | 'tennis' | 'volleyball';

export default function MiniWatch({ matchId, sport }: { matchId: string; sport: MiniSport }) {
  const [st, setSt] = useState<LiveState | null>(null);
  const [pulse, setPulse] = useState<GoalPulse | null>(null);
  const anchor = useRef<{ sim: number; at: number; rate: number } | null>(null);
  const evCount = useRef(0);
  const pulseId = useRef(0);
  // sim saat ölçeği: futbol 0..5400, basket 0..2880 (maç dakikası × 60)
  const simTotal = sport === 'basketball' ? 2880 : 5400;

  const clock = () => {
    const a = anchor.current;
    return a ? Math.max(0, Math.min(simTotal, a.sim + ((Date.now() - a.at) / 1000) * a.rate)) : 0;
  };

  useEffect(() => {
    let alive = true;
    anchor.current = null;
    evCount.current = 0;
    setSt(null); setPulse(null);
    const poll = async () => {
      try {
        const [s] = await matchProvider.getLiveStates([matchId]);
        if (!alive || !s) return;
        setSt(s);
        // monotonik sim saati (useLiveMatch ile aynı şema): bir kez çapa,
        // yalnız büyük sapmada düzelt — poll başına testere dişi yok
        if (s.phase === 'live') {
          const now = Date.now();
          const rate = simTotal / s.duration_secs;
          const serverSim = s.minute * 60;
          const a = anchor.current;
          const cur = a ? a.sim + ((now - a.at) / 1000) * a.rate : -1;
          if (!a || Math.abs(serverSim - cur) > 90) anchor.current = { sim: serverSim, at: now, rate };
        }
        // gol darbesi (futbol): yeni sunucu golü → PitchTV'nin kendi gol
        // draması (ağ sahnesi/penaltı) büyük ekrandakiyle birebir çalışsın
        if (sport === 'football') {
          const evs = s.events ?? [];
          if (evs.length > evCount.current) {
            const g = evs[evs.length - 1];
            setPulse({ id: ++pulseId.current, team: g.team, penalty: isPenaltyGoal(matchId, g.minute) });
          }
          evCount.current = evs.length;
        }
      } catch { /* transient */ }
    };
    void poll();
    const id = setInterval(poll, 2500);
    return () => { alive = false; clearInterval(id); };
  }, [matchId, sport, simTotal]);

  // futbol akışı: /live ekranıyla AYNI sim satırları + sunucu golleri
  const evs = useMemo(() => {
    if (!st || sport !== 'football') return [] as { m: number; t: string; g: boolean }[];
    let h = 0, a = 0;
    const goals = (st.events ?? []).map((e) => { if (e.team === 'home') h++; else a++; return { m: e.minute, t: `GOAL — ${e.team === 'home' ? st.home_team : st.away_team} ${h}-${a}`, g: true }; });
    const upto = st.phase === 'finished' ? 5400 : clock();
    const atmo = simLines(matchId, st.home_team, st.away_team, st.duration_secs)
      .filter((l) => (l.sec ?? l.minute * 60) <= upto)
      .map((l) => ({ m: l.minute, t: l.text, g: false }));
    return [...goals, ...atmo].sort((a1, b1) => b1.m - a1.m).slice(0, 4);
  }, [matchId, sport, st?.home_team, st?.minute, st?.events?.length, st?.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!st) return null;
  const phase = st.phase === 'live' ? 'live' : st.phase === 'finished' ? 'finished' : 'upcoming';
  const watchTo = sport === 'football' ? `/live/${matchId}` : `/court/${matchId}`;

  return (
    <div className="minitv">
      <Link className="mtv-lg" to={watchTo}>Watch · {st.home_team} - {st.away_team} ›</Link>
      <div className="mtv-embed">
        {sport === 'football' ? (
          <PitchTV
            home={st.home_team} away={st.away_team}
            hs={phase === 'upcoming' ? 0 : st.home_score} as={phase === 'upcoming' ? 0 : st.away_score}
            minute={st.minute} phase={phase} redHome={st.red_home} redAway={st.red_away}
            matchId={matchId} dur={st.duration_secs} getClock={clock} goalPulse={pulse}
            homePlayer={playerName(matchId + 'h')} awayPlayer={playerName(matchId + 'a')}
          />
        ) : sport === 'basketball' ? (
          <CourtTV
            home={st.home_team} away={st.away_team} hs={st.home_score} as={st.away_score}
            period={st.period ?? null} minute={st.minute} phase={phase}
            matchId={matchId} dur={st.duration_secs} getClock={clock}
          />
        ) : (
          <TennisTV
            home={st.home_team} away={st.away_team} hs={st.home_score} as={st.away_score}
            period={st.period ?? null} phase={phase} matchId={matchId} sport={sport}
          />
        )}
      </div>
      {sport === 'football' && (
        <div className="mtv-feed">
          <div className="mtv-fh">Key attacks</div>
          {evs.length === 0 ? <div className="mtv-row"><span className="dim">No big moments yet.</span></div>
            : evs.map((e, i) => <div key={i} className={`mtv-row ${e.g ? 'g' : ''}`}><span className="mn">{e.m}&apos;</span><span>{e.t}</span></div>)}
        </div>
      )}
    </div>
  );
}
