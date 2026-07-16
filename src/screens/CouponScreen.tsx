import { useNavigate } from 'react-router-dom';
import CouponPanel from '../coupon/CouponPanel';

// /coupon — tam sayfa kupon fişi. Eskiden CouponPanel'in KOPYA slip mantığını
// taşıyordu: kapanan bacaklara kördü (bayat oranla toplam/potansiyel çarpıyor,
// oynatınca sunucudan market_closed yiyordu), hardcoded İngilizceydi ve canlı
// oran tazelemeden pay almıyordu. Tek slip mantığı = CouponPanel; bu sayfa
// artık onun tam sayfa kabuğu. (Kayıtlı taslak yükleme + sosyal kupon kopyalama
// buraya yönlendirir.)
export default function CouponScreen() {
  const navigate = useNavigate();
  return (
    <div className="app-shell coupon-page">
      <CouponPanel onClose={() => navigate(-1)} />
    </div>
  );
}
