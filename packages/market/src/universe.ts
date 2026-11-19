import { mulberry32, type Rng } from "./random.js";

export type McapBucket = "large" | "mid" | "small";
export type AssetClass = "equity" | "etf";

export interface Instrument {
  symbol: string;
  isin: string;
  name: string;
  sector: string;
  mcapBucket: McapBucket;
  assetClass: AssetClass;
  lotSize: number;
  tickSize: number;
  basePrice: number;
  annualVol: number;
  circuitPct: 5 | 10 | 20 | null;
}

type Seed = [symbol: string, name: string, sector: string, price: number];

const LARGE_CAPS: Seed[] = [
  ["RELIANCE", "Reliance Industries", "Energy", 1420],
  ["TCS", "Tata Consultancy Services", "IT", 3950],
  ["HDFCBANK", "HDFC Bank", "Banking", 1720],
  ["ICICIBANK", "ICICI Bank", "Banking", 1290],
  ["INFY", "Infosys", "IT", 1850],
  ["BHARTIARTL", "Bharti Airtel", "Telecom", 1610],
  ["SBIN", "State Bank of India", "Banking", 810],
  ["ITC", "ITC", "FMCG", 470],
  ["LT", "Larsen & Toubro", "Infrastructure", 3600],
  ["HINDUNILVR", "Hindustan Unilever", "FMCG", 2400],
  ["KOTAKBANK", "Kotak Mahindra Bank", "Banking", 1790],
  ["AXISBANK", "Axis Bank", "Banking", 1150],
  ["BAJFINANCE", "Bajaj Finance", "Financial Services", 7100],
  ["MARUTI", "Maruti Suzuki India", "Automobile", 11800],
  ["SUNPHARMA", "Sun Pharmaceutical", "Pharma", 1780],
  ["HCLTECH", "HCL Technologies", "IT", 1740],
  ["ASIANPAINT", "Asian Paints", "Consumer Durables", 2900],
  ["TITAN", "Titan Company", "Consumer Durables", 3400],
  ["M&M", "Mahindra & Mahindra", "Automobile", 2950],
  ["ULTRACEMCO", "UltraTech Cement", "Cement", 11200],
  ["NTPC", "NTPC", "Power", 360],
  ["POWERGRID", "Power Grid Corporation", "Power", 320],
  ["ONGC", "Oil & Natural Gas Corporation", "Energy", 270],
  ["TATAMOTORS", "Tata Motors", "Automobile", 780],
  ["TATASTEEL", "Tata Steel", "Metals", 150],
  ["JSWSTEEL", "JSW Steel", "Metals", 940],
  ["ADANIENT", "Adani Enterprises", "Diversified", 2950],
  ["ADANIPORTS", "Adani Ports & SEZ", "Infrastructure", 1350],
  ["WIPRO", "Wipro", "IT", 300],
  ["TECHM", "Tech Mahindra", "IT", 1650],
  ["NESTLEIND", "Nestle India", "FMCG", 2300],
  ["BAJAJFINSV", "Bajaj Finserv", "Financial Services", 1700],
  ["COALINDIA", "Coal India", "Mining", 410],
  ["HINDALCO", "Hindalco Industries", "Metals", 650],
  ["GRASIM", "Grasim Industries", "Cement", 2600],
  ["DRREDDY", "Dr. Reddy's Laboratories", "Pharma", 1300],
  ["CIPLA", "Cipla", "Pharma", 1500],
  ["EICHERMOT", "Eicher Motors", "Automobile", 4900],
  ["HEROMOTOCO", "Hero MotoCorp", "Automobile", 4600],
  ["BRITANNIA", "Britannia Industries", "FMCG", 5200],
  ["APOLLOHOSP", "Apollo Hospitals", "Healthcare", 7000],
  ["DIVISLAB", "Divi's Laboratories", "Pharma", 5800],
  ["INDUSINDBK", "IndusInd Bank", "Banking", 1000],
  ["SBILIFE", "SBI Life Insurance", "Insurance", 1550],
  ["HDFCLIFE", "HDFC Life Insurance", "Insurance", 690],
  ["BPCL", "Bharat Petroleum", "Energy", 300],
  ["TATACONSUM", "Tata Consumer Products", "FMCG", 1050],
  ["ZOMATO", "Zomato", "Consumer Services", 240],
  ["TRENT", "Trent", "Retail", 6200],
  ["BEL", "Bharat Electronics", "Defence", 300],
];

const ETFS: Seed[] = [
  ["NIFTYBEES", "Nippon India ETF Nifty 50 BeES", "ETF", 270],
  ["BANKBEES", "Nippon India ETF Bank BeES", "ETF", 540],
  ["GOLDBEES", "Nippon India ETF Gold BeES", "ETF", 65],
  ["ITBEES", "Nippon India ETF Nifty IT", "ETF", 42],
  ["JUNIORBEES", "Nippon India ETF Nifty Next 50", "ETF", 720],
];

const STEMS = [
  "AARAV", "ABHAY", "AGNI", "AKASH", "AMBER", "ANAND", "ARJUN", "ASHOK", "BHAVYA", "CHETAK",
  "DEVA", "DHRUV", "EKTA", "GAGAN", "GANGA", "GARUDA", "HIMAL", "INDRA", "JAYA", "JYOTI",
  "KALPA", "KAMAL", "KAVERI", "KESAR", "KIRAN", "KRISHNA", "LAKSH", "MAHA", "MANAS", "MEGH",
  "MITRA", "NARMADA", "NAVYA", "NEEL", "NIDHI", "OJAS", "PAVAN", "PRAGATI", "PRITHVI", "RAJ",
  "SAGAR", "SAMRAT", "SARAS", "SHAKTI", "SHIVA", "SHREE", "SIDDHI", "SURYA", "SWARNA", "TAPI",
  "TEJAS", "TRISHUL", "UDAY", "UJALA", "UTKAL", "VAYU", "VEDA", "VIJAY", "VIKRAM", "YAMUNA",
];

const SECTOR_SUFFIX: [sector: string, code: string, word: string][] = [
  ["Textiles", "TEX", "Textiles"],
  ["Pharma", "PHARM", "Pharmaceuticals"],
  ["IT", "TECH", "Technologies"],
  ["Chemicals", "CHEM", "Chemicals"],
  ["Financial Services", "FIN", "Finance"],
  ["Infrastructure", "INFRA", "Infra Projects"],
  ["Power", "POWER", "Power"],
  ["Automobile", "AUTO", "Auto Components"],
  ["FMCG", "FOODS", "Foods"],
  ["Metals", "STEEL", "Steel"],
  ["Cement", "CEM", "Cements"],
  ["Realty", "REALTY", "Realty"],
  ["Logistics", "LOGI", "Logistics"],
  ["Capital Goods", "ENGG", "Engineering"],
  ["Agri", "AGRO", "Agro Industries"],
  ["Healthcare", "HEAL", "Healthcare"],
  ["Media", "MEDIA", "Media"],
  ["Banking", "BANK", "Bank"],
];

const MIN_UNIVERSE = 2_100;

function isinFor(symbol: string, index: number): string {
  const body = `${symbol.replace(/[^A-Z]/g, "").slice(0, 4).padEnd(4, "X")}${String(index).padStart(5, "0")}`;
  return `INE${body}0`.slice(0, 12);
}

function roundToTick(price: number, tick: number): number {
  return Math.round(price / tick) * tick;
}

function fromSeed(seed: Seed, index: number, assetClass: AssetClass, rng: Rng): Instrument {
  const [symbol, name, sector, price] = seed;
  return {
    symbol,
    isin: isinFor(symbol, index),
    name,
    sector,
    mcapBucket: "large",
    assetClass,
    lotSize: 1,
    tickSize: price < 100 ? 0.01 : 0.05,
    basePrice: price,
    annualVol: assetClass === "etf" ? 0.12 + rng() * 0.04 : 0.18 + rng() * 0.12,
    circuitPct: assetClass === "etf" ? 20 : null,
  };
}

/** Deterministic instrument universe: real NSE large caps and ETFs at representative prices plus synthetic mid/small caps. */
export function buildUniverse(size = MIN_UNIVERSE, seed = 20261118): Instrument[] {
  const rng = mulberry32(seed);
  const out: Instrument[] = [];
  LARGE_CAPS.forEach((s) => out.push(fromSeed(s, out.length, "equity", rng)));
  ETFS.forEach((s) => out.push(fromSeed(s, out.length, "etf", rng)));

  const seen = new Set(out.map((i) => i.symbol));
  for (let round = 0; out.length < size; round++) {
    for (const stem of STEMS) {
      for (const [sector, code, word] of SECTOR_SUFFIX) {
        if (out.length >= size) break;
        const symbol = round === 0 ? `${stem}${code}` : `${stem}${code}${round + 1}`;
        if (seen.has(symbol) || symbol.length > 20) continue;
        seen.add(symbol);
        const small = rng() < 0.6;
        const price = roundToTick(Math.exp(Math.log(small ? 20 : 150) + rng() * (small ? 3.2 : 2.8)), 0.05);
        const titled = stem.charAt(0) + stem.slice(1).toLowerCase();
        out.push({
          symbol,
          isin: isinFor(symbol, out.length),
          name: round === 0 ? `${titled} ${word}` : `${titled} ${word} ${["II", "III", "IV", "V"][round - 1] ?? round + 1}`,
          sector,
          mcapBucket: small ? "small" : "mid",
          assetClass: "equity",
          lotSize: 1,
          tickSize: price < 100 ? 0.01 : 0.05,
          basePrice: Math.max(price, 1),
          annualVol: small ? 0.35 + rng() * 0.3 : 0.25 + rng() * 0.15,
          circuitPct: small ? (rng() < 0.5 ? 5 : 10) : 20,
        });
      }
    }
  }
  return out;
}
