// Would this pick be winning if the score froze right now? Mirrors the server's
// deterministic settlement rules, applied to the live score, for a live tick /
// cross on open coupons. Purely presentational — the server still settles.
export type LegLive = 'win' | 'lose' | 'level' | 'pending';

export function legLiveStatus(key: string, hs: number, as: number, htH: number, htA: number): LegLive {
  const total = hs + as;
  const w = (b: boolean): LegLive => (b ? 'win' : 'lose');
  switch (key) {
    case 'home': return hs > as ? 'win' : hs === as ? 'level' : 'lose';
    case 'away': return as > hs ? 'win' : as === hs ? 'level' : 'lose';
    case 'draw': return hs === as ? 'win' : 'lose';
    case 'dc_1x': return hs >= as ? 'win' : 'lose';
    case 'dc_12': return hs !== as ? 'win' : 'lose';
    case 'dc_x2': return hs <= as ? 'win' : 'lose';
    case 'ou15_over': return w(total > 1);
    case 'ou15_under': return w(total <= 1);
    case 'ou25_over': return w(total > 2);
    case 'ou25_under': return w(total <= 2);
    case 'ou35_over': return w(total > 3);
    case 'ou35_under': return w(total <= 3);
    case 'btts_yes': return w(hs >= 1 && as >= 1);
    case 'btts_no': return w(!(hs >= 1 && as >= 1));
    case 'oe_odd': return w(total % 2 === 1);
    case 'oe_even': return w(total % 2 === 0);
    case 'ht_home': return htH > htA ? 'win' : htH === htA ? 'level' : 'lose';
    case 'ht_away': return htA > htH ? 'win' : htA === htH ? 'level' : 'lose';
    case 'ht_draw': return htH === htA ? 'win' : 'lose';
    case 'htou05_over': return w((htH + htA) > 0);
    case 'htou05_under': return w((htH + htA) === 0);
    default: return 'pending';
  }
}
