/**
 * Prontu — Parser Tia Ju
 * Converte texto colado de laudos laboratoriais para o padrão "Tia Ju".
 * Cole o resultado do PDF (Ctrl+A → Ctrl+C → Ctrl+V) e obtenha output formatado.
 */
(function () {
  'use strict';

  // ── Normaliza string para lookup ─────────────────────────────────
  function norm(s) {
    return String(s).toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ── Formata data para (dd/mm/aa) ─────────────────────────────────
  function fmtDate(d, m, y) {
    const yy = String(y).length === 4 ? String(y).slice(2) : String(y).padStart(2, '0');
    return `(${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${yy})`;
  }

  // ── Converte número BR para float (3.800,5 → 3800.5) ────────────
  function parseBR(s) {
    s = String(s).trim().replace(/[<>≤≥]/g, '');
    if (/\.\d{3}/.test(s) && s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
    if (/\.\d{3}/.test(s)) return parseFloat(s.replace(/\./g, ''));
    if (s.includes(',')) return parseFloat(s.replace(',', '.'));
    return parseFloat(s);
  }

  // ════════════════════════════════════════════════════════════════
  // DICIONÁRIO DE EXAMES
  // Cada entrada: { abbr, grupo, min, max }
  // grupo: hemo | pcr | hep | prot | renal | eletro | outros |
  //        tir | glic | lip | vit | ferro | soro | eas | gaso
  // ════════════════════════════════════════════════════════════════
  const DICT = {};

  function def(aliases, abbr, grupo, min, max) {
    const entry = { abbr, grupo };
    if (min != null) entry.min = min;
    if (max != null) entry.max = max;
    aliases.forEach(a => { DICT[norm(a)] = entry; });
  }

  // ── HEMOGRAMA ────────────────────────────────────────────────────
  def(['hemoglobina','hgb','hb ','hb:'],                     'HB',    'hemo', 12,   16);
  def(['hematocrito','ht ','ht:','htc'],                      'HT',    'hemo', 36,   48);
  def(['eritrocitos','hemacias','rbc','eritrócitos','hemácias'], 'Hm', 'hemo', 4.0,  5.9);
  def(['leucocitos','leucocitos totais','leuco','wbc','gb'],  'Leuco', 'hemo', 4000, 11000);
  def(['neutrofilos','neutrófilos','segmentados','seg ','seg:'], 'Seg','hemo_dif', 45, 70);
  def(['bastonetes','basto ','bastoes','bastões'],             'Basto','hemo_dif', 0,  5);
  def(['linfocitos','linfócitos','linf ','linf:'],             'Linf', 'hemo_dif', 20, 45);
  def(['monocitos','monócitos','mono ','mono:'],               'Mono', 'hemo_dif', 2,  10);
  def(['eosinofilos','eosinófilos','eo ','eo:','eosino'],      'Eo',  'hemo_dif', 1,   5);
  def(['basofilos','basófilos','baso ','baso:'],               'Baso','hemo_dif', 0,   2);
  def(['plaquetas','pqt','plt','plaquetas '],                  'PQT', 'hemo', 150000, 400000);
  def(['vpm','volume plaquetario medio','volume plaquetário médio'], 'VPM', 'hemo', 7, 12);
  def(['rdw'],                                                 'RDW', 'hemo', 11, 15);
  def(['vcm','volume corpuscular medio'],                      'VCM', 'hemo', 80, 100);
  def(['hcm','hemoglobina corpuscular media'],                 'HCM', 'hemo', 27, 33);
  def(['chcm'],                                                'CHCM','hemo', 32, 36);
  def(['reticulocitos','reticulócitos','retic'],               'Retic','hemo', 0.5, 1.5);

  // ── PCR / INFLAMAÇÃO ──────────────────────────────────────────────
  def(['pcr','proteina c reativa','proteína c reativa','proteina c-reativa','pcr hs','pcr ultrassensivel'], 'PCR', 'pcr', 0, 0.5);
  def(['procalcitonina','pct ','pct:'],                        'PCT', 'pcr', 0, 0.05);

  // ── HEPATICO ─────────────────────────────────────────────────────
  def(['tgo','ast ','ast:','aspartato aminotransferase','transaminase oxalacetica','transaminase oxaloacética'], 'TGO', 'hep', 0, 40);
  def(['tgp','alt ','alt:','alanina aminotransferase','transaminase piruvica','transaminase pirúvica'],          'TGP', 'hep', 0, 41);
  def(['fosfatase alcalina','fa ','fa:','alkaline phosphatase'],  'FA',  'hep', 40,  130);
  def(['ggt','gamaglutamiltransferase','gama gt','gamma gt','gama-gt','ggtp','γgt'], 'GGT', 'hep', 0, 61);
  def(['bilirrubina total','bt ','bt:','bilirrubinas totais'],  'BT',  'hep', 0, 1.0);
  def(['bilirrubina direta','bd ','bd:','bilirrubina conjugada','bilirrubina d:'], 'BD', 'hep', 0, 0.3);
  def(['bilirrubina indireta','bi ','bi:','bilirrubina livre','bilirrubina i:'],    'BI', 'hep', 0, 0.8);
  def(['inr','rni','razao normalizada internacional','relacao normalizada internacional'], 'INR', 'hep', 0.8, 1.2);
  def(['ttpa','tempo de tromboplastina parcial ativado','aptt','ptt ','ptt:'], 'TTPA', 'hep', 25, 35);
  def(['tp ','tp:','tempo de protrombina'],                    'TP',  'hep', null, null);
  def(['fibrinogenio','fibrinogênio'],                         'Fibrinogênio', 'hep', 200, 400);

  // ── PROTEÍNAS ────────────────────────────────────────────────────
  def(['proteinas totais','proteínas totais','pt:','ptn totais','prot totais'], 'PT',   'prot', 6.0, 8.0);
  def(['albumina ','albumina:','alb ','alb:'],                 'ALB', 'prot', 3.5, 5.0);
  def(['globulinas','globulina ','glob ','glob:'],              'GLOB','prot', 2.0, 3.5);
  def(['relacao ag','relação a/g','relação ag','razao ag','a/g ratio'], 'A/G', 'prot', 1.0, 2.5);

  // ── RENAL ────────────────────────────────────────────────────────
  def(['ureia','uréia','ur ','ur:','nitrogenio ureico','bun'],  'Ur',  'renal', 10,  50);
  def(['creatinina ','creatinina:','cr ','cr:','crea'],         'Cr',  'renal', 0.5, 1.2);
  def(['tfg','taxa de filtracao glomerular','egfr','clearance estimado','tfg ckd'], 'TFG', 'renal', 60, 999);
  def(['depuracao de creatinina','clearance de creatinina','depuracao creatinina'], 'DepCr', 'renal', 80, 120);
  def(['acido urico','ácido úrico','uricemia','urato'],         'ÁcÚrico', 'renal', 2.4, 6.0);

  // ── ELETRÓLITOS ──────────────────────────────────────────────────
  def(['sodio','sódio','na ','na:'],                            'Na', 'eletro', 136, 145);
  def(['potassio','potássio','k ','k:'],                        'K',  'eletro', 3.5, 5.0);
  def(['cloro','cloreto','cl ','cl:'],                          'Cl', 'eletro', 98, 106);
  def(['calcio total','cálcio total','calcio serico','ca total','ca:','ca '], 'Ca', 'eletro', 8.5, 10.5);
  def(['fosforo','fósforo','fosfato','p ','p:'],                'P',  'eletro', 2.5, 4.5);
  def(['magnesio','magnésio','mg ','mg:'],                      'Mg', 'eletro', 1.5, 2.5);
  def(['bicarbonato','hco3','co2 total'],                       'HCO3','eletro', 22, 29);
  def(['lactato','acido lactico','ácido lático'],               'Lactato','eletro', 0.5, 2.0);

  // ── OUTROS LABORATORIAIS ─────────────────────────────────────────
  def(['dhl','ldh','desidrogenase latica','desidrogenase lática','lactato desidrogenase'], 'DHL', 'outros', 120, 246);
  def(['cpk','ck total','creatino quinase','creatinofosfoquinase','ck ','ck:'],            'CPK', 'outros', 24, 170);
  def(['vhs','velocidade de hemossedimentacao','velocidade hemossedimentacao','velocidade de eritrossedimentacao'], 'VHS', 'outros', 0, 20);
  def(['troponina i','troponina t','troponina hs','troponina ','trop '],                   'Troponina', 'outros', 0, 0.04);
  def(['bnp','nt-probnp','nt probnp','pro bnp'],                'BNP', 'outros', 0, 125);
  def(['amilase ','amilase:'],                                  'Amilase','outros', 25, 125);
  def(['lipase ','lipase:'],                                    'Lipase','outros', 0, 60);

  // ── TIREOIDE ─────────────────────────────────────────────────────
  def(['tsh','hormonio estimulante da tireoide','hormônio estimulante da tireoide','tsh basal'], 'TSH', 'tir', 0.27, 4.2);
  def(['t4 livre','t4l','tiroxina livre','t4 free','free t4'],  'T4L', 'tir', 0.9, 1.8);
  def(['t3 livre','t3l','triiodotironina livre'],               'T3L', 'tir', 2.0, 4.4);

  // ── GLICEMIA ─────────────────────────────────────────────────────
  def(['glicemia','glicose','gli ','gli:','glucose','glycemia','glicemia jejum'], 'GLI', 'glic', 70, 100);
  def(['hemoglobina glicada','hba1c','a1c ','a1c:','glico-hemoglobina','hemoglobina glicosilada'], 'HbA1c', 'glic', 0, 5.7);
  def(['insulina ','insulina:'],                                'Insulina','glic', 2, 25);
  def(['peptideo c','peptídeo c'],                              'PepC','glic', 0.5, 2.0);
  def(['frutosamina'],                                          'Frutosa','glic', 200, 285);

  // ── LIPÍDIOS ─────────────────────────────────────────────────────
  def(['colesterol total','ct ','ct:','colesterol '],           'CT',   'lip', 0, 190);
  def(['hdl','hdl-colesterol','hdl-c','hdl colesterol'],        'HDL',  'lip', 40, 999);
  def(['ldl','ldl-colesterol','ldl-c','ldl colesterol'],        'LDL',  'lip', 0, 130);
  def(['vldl','vldl-colesterol'],                               'VLDL', 'lip', 0, 30);
  def(['triglicerides','triglicerídeos','tgl','tg ','tg:','triglicérides','triglicerídeos'], 'TGL', 'lip', 0, 150);
  def(['nao hdl','não hdl','non hdl','colesterol nao hdl'],     'NãoHDL','lip', 0, 160);

  // ── VITAMINAS / ÓSSEO ────────────────────────────────────────────
  def(['vitamina d','vit d','25-oh','25ohd','25-hidroxivitamina','calcidiol','vit. d'], 'VitD', 'vit', 30, 100);
  def(['pth','paratormonio','paratormônio','hormonio paratireoide','pth intacto'],      'PTH',  'vit', 15, 65);

  // ── FERRO E HEMATOLOGIA ──────────────────────────────────────────
  def(['ferro serico','ferro sérico','ferro ','ferro:','iron'],  'Ferro',    'ferro', 50, 170);
  def(['ferritina ','ferritina:'],                               'Ferritina','ferro', 10, 291);
  def(['tibc','ctlf','capacidade de ligacao ao ferro','capacidade de ligação'],        'TIBC',      'ferro', 250, 370);
  def(['saturacao de transferrina','saturação de transferrina','ist ','ist:','isat'],  'IST',       'ferro', 20, 50);
  def(['vitamina b12','b12 ','b12:','cobalamina'],               'B12',       'ferro', 200, 900);
  def(['acido folico','ácido fólico','folato ','folato:'],        'AcFol',     'ferro', 2.7, 17);
  def(['coombs direto','teste de coombs direto','antiglobulina direta'], 'CoomDs', 'ferro', null, null);
  def(['haptoglobina ','haptoglobina:'],                         'Haptoglobina','ferro', 30, 200);

  // ── EAS / URINA ──────────────────────────────────────────────────
  def(['eas','exame de urina','urina tipo 1','urina tipo i','urinalise','urinálise','exame comum de urina','ecu','urina rotina'], 'EAS', 'eas', null, null);
  def(['urocultura','cultura de urina','cultura urina'],         'Urocultura','eas', null, null);
  def(['microalbuminuria','microalbuminúria','albumina urinaria'], 'Microalb','eas', 0, 30);

  // ── SOROLOGIAS ───────────────────────────────────────────────────
  def(['hbsag','hbs ag','antigenio de superficie hb','hbsAg'],   'HBsAg',     'soro', null, null);
  def(['anti-hbs','antihbs','anti hbs','anticorpo anti-hbs'],    'Anti-HBs',  'soro', null, null);
  def(['anti-hbc total','antihbc total','anti-hbc igg','anti hbc'], 'Anti-HBc','soro', null, null);
  def(['anti-hbc igm','antihbc igm'],                            'Anti-HBc IgM','soro', null, null);
  def(['anti-hcv','antihcv','anti hcv','anticorpo hepatite c'],  'Anti-HCV',  'soro', null, null);
  def(['hcv rna','hcv pcr','pcr hepatite c','carga viral hcv'],  'HCV-RNA',   'soro', null, null);
  def(['hbv dna','hbv pcr','pcr hepatite b','carga viral hbv'],  'HBV-DNA',   'soro', null, null);
  def(['hav igg','anti-hav igg','hepatite a igg'],               'Anti-HAV IgG','soro', null, null);
  def(['hiv','anti-hiv','hiv 1/2','anticorpo hiv'],              'HIV',       'soro', null, null);
  def(['vdrl ','vdrl:'],                                         'VDRL',      'soro', null, null);
  def(['fta-abs','ftaabs','treponema '],                         'FTA-Abs',   'soro', null, null);
  def(['toxoplasmose igg','toxoplasma igg','toxo igg'],          'Toxo IgG',  'soro', null, null);
  def(['toxoplasmose igm','toxoplasma igm','toxo igm'],          'Toxo IgM',  'soro', null, null);
  def(['cmv igg','citomegalovirus igg'],                         'CMV IgG',   'soro', null, null);
  def(['cmv igm','citomegalovirus igm'],                         'CMV IgM',   'soro', null, null);
  def(['ebv igg','epstein barr igg','mononucleose igg'],         'EBV IgG',   'soro', null, null);
  def(['ebv igm','epstein barr igm'],                            'EBV IgM',   'soro', null, null);
  def(['chagas ','chagas:','t cruzi','doenca de chagas'],        'Chagas',    'soro', null, null);
  def(['htlv ','htlv-1','htlv-2'],                               'HTLV',      'soro', null, null);
  def(['anti-ccp','anticcp','peptideo citrulinado','anti-ccp '], 'Anti-CCP',  'soro', null, null);
  def(['anca ','c-anca','p-anca','anticorpo anca'],              'ANCA',      'soro', null, null);
  def(['ana ','fan ','fator antinuclear','anticorpo antinuclear'], 'ANA',     'soro', null, null);
  def(['anti-dna','anticorpo anti-dna','anti dna'],              'Anti-DNA',  'soro', null, null);
  def(['fator reumatoide','fator reumatóide','fr ','fr:'],       'FR',        'soro', null, null);
  def(['complemento c3','c3 ','c3:'],                            'C3',        'soro', null, null);
  def(['complemento c4','c4 ','c4:'],                            'C4',        'soro', null, null);
  def(['anticardiolipina igg','anticardiolipina igm','acl'],      'AntiCL',   'soro', null, null);
  def(['beta 2 glicoproteina','beta2gp1','anti-b2gp1'],          'β2GP1',     'soro', null, null);
  def(['psa total','psa ','psa:','antigenio prostatico','antígeno prostático especifico'], 'PSA', 'soro', null, null);
  def(['cea ','cea:','antigenio carcinoembrionario'],             'CEA',       'soro', null, null);
  def(['afp ','afp:','alfa-fetoproteina','alfa-fetoproteína'],    'AFP',       'soro', null, null);
  def(['ca 19-9','ca19-9','ca 199'],                             'CA 19-9',   'soro', null, null);
  def(['ca 125','ca125'],                                        'CA 125',    'soro', null, null);
  def(['beta-hcg','beta hcg','hcg ','hcg:','gonadotrofina'],     'β-HCG',     'soro', null, null);
  def(['rubeola igg','rubéola igg'],                             'Rubéola IgG','soro', null, null);
  def(['rubeola igm','rubéola igm'],                             'Rubéola IgM','soro', null, null);
  def(['anti-gad','anticorpo anti-gad'],                         'Anti-GAD',  'soro', null, null);
  def(['anti-tpo','antitpo','anti tireoperoxidase'],              'Anti-TPO',  'soro', null, null);
  def(['anti-tireoglobulina','anti-tg','antitireoglobulina'],     'Anti-TG',   'soro', null, null);
  def(['imunoglobulina g','igg ','igg:'],                        'IgG',       'soro', null, null);
  def(['imunoglobulina a','iga ','iga:'],                        'IgA',       'soro', null, null);
  def(['imunoglobulina m','igm ','igm:'],                        'IgM',       'soro', null, null);
  def(['eletroforese de proteinas','eletroforese proteica'],      'Eletroforese','soro', null, null);
  def(['dengue ns1','dengue igg','dengue igm'],                  'Dengue',    'soro', null, null);
  def(['leptospirose igg','leptospirose igm','leptospira'],       'Leptospirose','soro', null, null);
  def(['brcucella','brucela'],                                   'Brucela',   'soro', null, null);

  // ── GASOMETRIA ───────────────────────────────────────────────────
  def(['ph arterial','ph ','ph:'],                               'pH',     'gaso', 7.35, 7.45);
  def(['pco2','pressao co2','pressão co2','pco2 arterial'],      'pCO2',   'gaso', 35, 45);
  def(['po2','pressao o2','pao2'],                               'pO2',    'gaso', 80, 100);
  def(['sato2','saturacao o2 arterial','spao2'],                 'SatO2',  'gaso', 95, 100);
  def(['excesso de base','base excess','be ','be:'],             'BE',     'gaso', -2, 2);

  // ════════════════════════════════════════════════════════════════
  // GRUPOS TIA JU — ordem e separador |
  // ════════════════════════════════════════════════════════════════
  const GRUPOS_ORDEM = [
    'hemo', 'pcr', 'hep', 'prot', 'renal',
    'eletro', 'outros', 'tir', 'glic', 'lip', 'vit', 'ferro'
  ];

  // Ordem dos exames dentro de cada grupo
  const GRUPO_ORDEM_INTERNA = {
    hemo:    ['HB','HT','Hm','Leuco','PQT','VPM','RDW','VCM','HCM','CHCM','Retic'],
    pcr:     ['PCR','PCT'],
    hep:     ['TGO','TGP','FA','GGT','BT','BD','BI','INR','TTPA','TP','Fibrinogênio'],
    prot:    ['PT','ALB','GLOB','A/G'],
    renal:   ['Ur','Cr','TFG','DepCr','ÁcÚrico'],
    eletro:  ['Na','K','Cl','Ca','P','Mg','HCO3','Lactato'],
    outros:  ['DHL','CPK','VHS','Troponina','BNP','Amilase','Lipase'],
    tir:     ['TSH','T4L','T3L'],
    glic:    ['GLI','HbA1c','Insulina','PepC','Frutosa'],
    lip:     ['CT','HDL','LDL','VLDL','TGL','NãoHDL'],
    vit:     ['VitD','PTH'],
    ferro:   ['Ferro','Ferritina','TIBC','IST','B12','AcFol','CoomDs','Haptoglobina'],
  };

  // ════════════════════════════════════════════════════════════════
  // FUNÇÕES DE PARSING
  // ════════════════════════════════════════════════════════════════

  function extractDates(text) {
    const re = /\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})\b/g;
    const dates = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      const d = parseInt(m[1]), mo = parseInt(m[2]);
      const y = m[3].length === 2 ? 2000 + parseInt(m[3]) : parseInt(m[3]);
      if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 2000 && y <= 2100) {
        dates.push({ d, m: mo, y, ts: new Date(y, mo-1, d).getTime(), fmt: fmtDate(d, mo, y) });
      }
    }
    // Unique + ordenadas (mais recente primeiro)
    const seen = new Set();
    return dates.filter(dt => {
      if (seen.has(dt.fmt)) return false;
      seen.add(dt.fmt);
      return true;
    }).sort((a, b) => b.ts - a.ts);
  }

  function lookupExam(raw) {
    const t = norm(raw);
    // Match exato
    if (DICT[t]) return DICT[t];
    // Match por contenção (maior chave que está contida no texto)
    let best = null, bestLen = 0;
    for (const [key, val] of Object.entries(DICT)) {
      if (key.length < 3) continue;
      if (t.includes(key) && key.length > bestLen) {
        best = val; bestLen = key.length;
      }
    }
    return best;
  }

  const QUALIS_NEG = /\b(negati|nao reagente|não reagente|nao detect|não detect|ausente|nr\b|nreag)/i;
  const QUALIS_POS = /\b(positiv|reagente|detect|presente|reativo|reagente)/i;
  const QUALIS_IND = /\b(indeterminado|inconclusivo)/i;

  function extractValue(line) {
    // Qualitativo
    if (QUALIS_NEG.test(line)) return { v: 'NR', qual: true, neg: true };
    if (QUALIS_IND.test(line)) return { v: 'indeterminado', qual: true };
    const qp = line.match(/\b(reagente|positivo|detectado|presente|reativo)\b/i);
    if (qp) return { v: qp[1] + '***', qual: true };

    // Numérico: tudo depois de : ou = ou espaço seguido de dígito
    const n = line.match(/[:=]\s*([<>≤≥]?\s*[\d][0-9.,\s]*)/);
    if (n) {
      const raw = n[1].trim().replace(/\s+/g, '');
      const prefix = raw.match(/^[<>≤≥]+/)?.[0] || '';
      const num = parseBR(raw.replace(/^[<>≤≥]+/, ''));
      return { v: prefix + (isNaN(num) ? raw : String(num).replace('.', ',')), qual: false, num };
    }
    return null;
  }

  function isAbnormal(val, entry) {
    if (!entry || entry.min == null || val.qual) return false;
    const v = typeof val.num === 'number' ? val.num : parseBR(String(val.v).replace(/[<>≤≥,]/g, x => x === ',' ? '.' : ''));
    if (isNaN(v)) return false;
    return v < entry.min || v > entry.max;
  }

  function fmtItem(entry, val) {
    const flag = isAbnormal(val, entry) ? '***' : '';
    const vStr = val.neg ? 'NR' : val.v;
    return `${entry.abbr} ${vStr}${flag}`.trim();
  }

  // ════════════════════════════════════════════════════════════════
  // PARSER PRINCIPAL
  // ════════════════════════════════════════════════════════════════
  function parse(text) {
    if (!text || !text.trim()) return '';

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const dates = extractDates(text);
    const dateFmt = dates.length > 0 ? dates[0].fmt : '(data)';

    // Armazena por grupo
    const grupos = {};           // grupo → Map<abbr, formatted>
    const sorologias = [];
    const easItems = [];
    const gasometria = [];
    const dif = {};              // abbr → formatted (diferencial)
    const semResultado = [];
    const pendentes = [];

    GRUPOS_ORDEM.forEach(g => { grupos[g] = new Map(); });

    const PEND_RE = /em\s+andamento|aguardando|pendente|sem\s+resultado|a\s+realizar|em\s+coleta|em\s+process/i;

    for (const line of lines) {
      if (line.length < 4) continue;
      // Pula linhas de cabeçalho / referência
      if (/valor\s+de\s+refer|vr:|referência:|valor\s+ref/i.test(line)) continue;
      if (/paciente:|prontuario:|data\s+de\s+nascimento|cid:|medico:|solicitante:/i.test(line)) continue;

      // Detecta exame pendente (sem resultado)
      if (PEND_RE.test(line)) {
        const entry = lookupExam(line.split(':')[0]);
        if (entry) pendentes.push(entry.abbr);
        continue;
      }

      const entry = lookupExam(line.split(':')[0] || line.split(/\s{2,}/)[0]);
      if (!entry) continue;

      const val = extractValue(line);
      if (!val) {
        semResultado.push(entry.abbr);
        continue;
      }

      const formatted = fmtItem(entry, val);

      if (entry.grupo === 'hemo_dif') {
        dif[entry.abbr] = formatted;
      } else if (entry.grupo === 'soro') {
        sorologias.push(formatted);
      } else if (entry.grupo === 'eas') {
        easItems.push(formatted);
      } else if (entry.grupo === 'gaso') {
        gasometria.push(formatted);
      } else if (grupos[entry.grupo] && !grupos[entry.grupo].has(entry.abbr)) {
        grupos[entry.grupo].set(entry.abbr, formatted);
      }
    }

    // Insere diferencial junto ao Leuco
    if (Object.keys(dif).length > 0 && grupos['hemo'] && grupos['hemo'].has('Leuco')) {
      const leucoVal = grupos['hemo'].get('Leuco');
      const difStr = Object.values(dif).join(', ');
      grupos['hemo'].set('Leuco', `${leucoVal} (${difStr})`);
    }

    // ── Ordena cada grupo conforme GRUPO_ORDEM_INTERNA ──────────
    function getGroupParts(g) {
      const map = grupos[g];
      if (!map || map.size === 0) return [];
      const order = GRUPO_ORDEM_INTERNA[g] || [];
      const parts = [];
      // Exames na ordem definida primeiro
      order.forEach(abbr => { if (map.has(abbr)) parts.push(map.get(abbr)); });
      // Exames não previstos na ordem (adicionais) ao final
      map.forEach((v, k) => { if (!order.includes(k)) parts.push(v); });
      return parts;
    }

    // ── Monta linha de laboratoriais ────────────────────────────
    const gruposParts = GRUPOS_ORDEM
      .map(g => getGroupParts(g))
      .filter(p => p.length > 0);

    // EAS: construído de forma concisa
    if (easItems.length > 0) gruposParts.push(easItems);
    // Sorologias copiadas no final da linha labs
    if (sorologias.length > 0) gruposParts.push(sorologias);

    const labLine = gruposParts.map(p => p.join(', ')).join(' | ');

    // Exames sem resultado ao final da linha
    const semRes = [...semResultado, ...pendentes];

    // ════════════════════════════════════════════════════════════
    // MONTA OUTPUT FINAL
    // ════════════════════════════════════════════════════════════
    let out = '';

    // Bloco Sorologias
    out += '# Sorologias / Rastreios\n';
    if (sorologias.length > 0) {
      out += `- ${dateFmt}: ${sorologias.join(', ')}\n`;
    }
    out += '\n';

    // Bloco Laboratoriais
    out += '# Laboratoriais\n';
    if (labLine) {
      out += `- ${dateFmt}: ${labLine}`;
      if (semRes.length > 0) out += `  [sem resultado: ${semRes.join(', ')}]`;
      out += '\n';
    }
    out += '\n';

    // Bloco Imagem
    out += '# Imagem\n\n';

    // Escopias
    out += '# Escopias\n\n';

    // Gasometria
    if (gasometria.length > 0) {
      out += '# Outros Exames\n';
      out += `- Gasometria ${dateFmt}: ${gasometria.join(', ')}\n\n`;
    } else {
      out += '# Outros Exames\n\n';
    }

    // Resultados AP
    out += '# Resultados Anatomopatológicos, Histopatológicos e Imunohistoquímicos\n\n';

    // Pareceres
    out += '# Pareceres\n\n';

    // Pendências
    out += '# Pendencias Exames\n';
    if (semRes.length > 0) {
      out += `- ${dateFmt}: ${semRes.join(', ')}\n`;
    }

    return out;
  }

  // Expõe a função globalmente
  window.parsearExamesTiaJu = parse;

})();
