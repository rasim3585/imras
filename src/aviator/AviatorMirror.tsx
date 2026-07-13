import { useEffect, useState } from 'react';
import { fetchAviatorMirror, type MirrorProfile, type MirrorFlag } from '../lib/aviator';
import { CoinIcon } from '../components/icons';

// DAVRANIŞ AYNASI — Faz 1a yüzeyi. Kullanıcının KENDİ Aviator verisinden çıkan
// deterministik teşhisi gösterir (mirror_aviator RPC). Sayılar backend'de üretilir;
// buradaki metin sadece "ses" (şablonlu, LLM değil — o sonra). Teşhis = hook:
// kullanıcı kendi desenini bir aynada görür, para kaybetmeden.

const pct = (x: number) => `%${Math.round(x * 100)}`;
const gold = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString('tr-TR')}`;

// Her bayrak → aynada bir satır. Metin veriden türetilir; abartısız, dürüst.
function flagLine(f: MirrorFlag): { title: string; body: string } {
  const v = f.value;
  switch (f.code) {
    case 'greed_caught':
      return { title: 'Açgözlülük', body:
        `Turların ${pct(v.caught_rate)}'inde çekmeyi beklerken uçak uçtu. "Bir saniye daha" seni yakalıyor — çekişi erkene almak net kazancı artırır.` };
    case 'low_discipline':
      return { title: 'Disiplin düşük', body:
        `Bahislerinin sadece ${pct(v.auto_rate)}'i otomatik çekişli. Auto koymadan oynamak, canlıda anlık dürtüye teslim olmak demek.` };
    case 'win_illusion':
      return { title: 'Sık-kazanma yanılsaması', body:
        `Turların ${pct(v.win_rate)}'ini kazanıyorsun ama net ${gold(v.net)} gold. Sık kazanmak seni kârda sanıyor — değilsin. Küçük kazançlar büyük kaybı örtüyor.` };
    case 'chasing_losses':
      return { title: 'Kayıp kovalama', body:
        `Kayıptan sonra bahsini ortalama ${v.loss_ratio}x büyütüyorsun (kazançtan sonra ${v.win_ratio}x). Bu kaybı geri alma dürtüsü — en pahalı desen.` };
    case 'disciplined':
      return { title: 'Disiplinli', body:
        `Bahislerinin ${pct(v.auto_rate)}'i auto-cashout'lu ve nadiren yakalanıyorsun. Sağlam duruyorsun — böyle devam.` };
    case 'trend_worse':
      return { title: 'Trend kötüye', body:
        `Son turlarda daha sık yakalanıyorsun (${pct(v.recent_caught)} vs genel ${pct(v.overall_caught)}). Sıcak kafayla oynuyor olabilirsin — ara ver.` };
    case 'trend_better':
      return { title: 'Trend iyiye', body:
        `Son turlarda daha az yakalanıyorsun (${pct(v.recent_caught)} vs ${pct(v.overall_caught)}). Disiplinin artıyor.` };
  }
}

export default function AviatorMirror() {
  const [data, setData] = useState<MirrorProfile | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchAviatorMirror().then((d) => { if (alive) setData(d); }).catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, []);

  if (err || !data) return null;                    // sessiz: ayna asla ekranı bozmaz
  if (!data.ready) {
    const need = data.need ?? 10;
    const have = data.rounds ?? 0;
    return (
      <div className="av-mirror av-mirror-wait">
        <h3 className="av-mirror-h">🪞 Aynan</h3>
        <p className="av-mirror-sub">Deseni çıkarmak için biraz daha veri gerekiyor — {have}/{need} tur.
          Oynadıkça aynan netleşir.</p>
      </div>
    );
  }

  const warns = data.flags.filter((f) => f.level === 'warn');
  const goods = data.flags.filter((f) => f.level === 'good');
  const netCls = data.net >= 0 ? 'pos' : 'neg';

  return (
    <div className="av-mirror">
      <h3 className="av-mirror-h">🪞 Aynan <span className="av-mirror-n">{data.rounds} tur</span></h3>

      <div className="av-mirror-stats">
        <div><span className="k">Kazanma</span><b>{pct(data.win_rate)}</b></div>
        <div><span className="k">Net</span><b className={netCls}><CoinIcon size={12} /> {gold(data.net)}</b></div>
        <div><span className="k">Medyan çekiş</span><b>{data.median_cashout}x</b></div>
        <div><span className="k">Yakalanma</span><b>{pct(data.caught_rate)}</b></div>
      </div>

      {data.flags.length === 0 ? (
        <p className="av-mirror-sub">Belirgin bir zaaf deseni yok — dengeli oynuyorsun.</p>
      ) : (
        <ul className="av-mirror-flags">
          {[...warns, ...goods].map((f) => {
            const t = flagLine(f);
            return (
              <li key={f.code} className={`av-mirror-flag ${f.level}`}>
                <span className="av-mirror-dot" aria-hidden />
                <div><b>{t.title}</b><p>{t.body}</p></div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="av-mirror-foot">Bu bir yargı değil, bir ayna. Para yok — desenini zararsız gör.</p>
    </div>
  );
}
