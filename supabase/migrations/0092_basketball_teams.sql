-- Sanal BASKETBOL — Faz BB-2a: takım havuzu.
-- vteams FK'si (matches.home/away_team_id -> vteams.id) korunsun diye basketbol
-- takımları da vteams'e ekleniyor; ayrım 'sport' kolonuyla. attack/defense
-- burada HÜCUM/SAVUNMA sayı çarpanı olarak yorumlanır (~1.0; futboldaki gol
-- çarpanıyla aynı ölçek, farklı anlam). Rating drift / standings finalize'da
-- sport'a göre dallanacak (sonraki migration). Futbol satırları etkilenmez.
alter table public.vteams add column if not exists sport text not null default 'football';

-- Basketbol takımları (gerçek kulüp adları; parantez oyuncu adı frontend'de
-- kozmetik eklenir, futbolla aynı). id 101+ → futbol 1..34 ile çakışmaz.
-- attack = hücum çarpanı (yüksek = çok sayı atar), defense = savunma çarpanı
-- (DÜŞÜK = az sayı yedirir, iyi savunma). base = mean-reversion tabanı.
insert into public.vteams (id, name, short_name, attack, defense, attack_base, defense_base, sport) values
  (101,'Boston Celtics','BOS',1.08,0.92,1.08,0.92,'basketball'),
  (102,'Denver Nuggets','DEN',1.07,0.94,1.07,0.94,'basketball'),
  (103,'Oklahoma City Thunder','OKC',1.06,0.93,1.06,0.93,'basketball'),
  (104,'Milwaukee Bucks','MIL',1.06,0.96,1.06,0.96,'basketball'),
  (105,'Minnesota Timberwolves','MIN',1.02,0.90,1.02,0.90,'basketball'),
  (106,'Los Angeles Clippers','LAC',1.04,0.96,1.04,0.96,'basketball'),
  (107,'Dallas Mavericks','DAL',1.05,0.98,1.05,0.98,'basketball'),
  (108,'Phoenix Suns','PHX',1.05,1.00,1.05,1.00,'basketball'),
  (109,'New York Knicks','NYK',1.02,0.95,1.02,0.95,'basketball'),
  (110,'Cleveland Cavaliers','CLE',1.01,0.94,1.01,0.94,'basketball'),
  (111,'New Orleans Pelicans','NOP',1.02,0.98,1.02,0.98,'basketball'),
  (112,'Los Angeles Lakers','LAL',1.03,1.00,1.03,1.00,'basketball'),
  (113,'Golden State Warriors','GSW',1.04,1.01,1.04,1.01,'basketball'),
  (114,'Philadelphia 76ers','PHI',1.02,0.99,1.02,0.99,'basketball'),
  (115,'Indiana Pacers','IND',1.06,1.04,1.06,1.04,'basketball'),
  (116,'Sacramento Kings','SAC',1.05,1.03,1.05,1.03,'basketball'),
  (117,'Miami Heat','MIA',0.99,0.97,0.99,0.97,'basketball'),
  (118,'Orlando Magic','ORL',0.97,0.93,0.97,0.93,'basketball'),
  (119,'Houston Rockets','HOU',0.99,0.98,0.99,0.98,'basketball'),
  (120,'Memphis Grizzlies','MEM',1.01,0.99,1.01,0.99,'basketball'),
  (121,'Chicago Bulls','CHI',0.99,1.02,0.99,1.02,'basketball'),
  (122,'Atlanta Hawks','ATL',1.03,1.05,1.03,1.05,'basketball'),
  (123,'Toronto Raptors','TOR',0.98,1.02,0.98,1.02,'basketball'),
  (124,'Brooklyn Nets','BKN',0.97,1.03,0.97,1.03,'basketball'),
  (125,'San Antonio Spurs','SAS',0.98,1.04,0.98,1.04,'basketball'),
  (126,'Utah Jazz','UTA',0.99,1.06,0.99,1.06,'basketball'),
  (127,'Portland Trail Blazers','POR',0.96,1.05,0.96,1.05,'basketball'),
  (128,'Charlotte Hornets','CHA',0.96,1.06,0.96,1.06,'basketball'),
  (129,'Washington Wizards','WAS',0.97,1.08,0.97,1.08,'basketball'),
  (130,'Detroit Pistons','DET',0.98,1.07,0.98,1.07,'basketball')
on conflict (id) do nothing;