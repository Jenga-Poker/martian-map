export const MESES_DARIANOS: string[] = [
  "Sagittarius", "Dhanus", "Capricornus", "Makara", "Aquarius", "Kumbha",
  "Pisces", "Mina", "Aries", "Mesha", "Taurus", "Rishabha",
  "Gemini", "Mithuna", "Cancer", "Karka", "Leo", "Simha",
  "Virgo", "Kanya", "Libra", "Tula", "Scorpius", "Vrishika",
];

export const DIAS_SEMANA_DARIANOS: string[] = [
  "Sol Solis", "Sol Lunae", "Sol Martis", "Sol Mercurii",
  "Sol Jovis", "Sol Veneris", "Sol Saturni",
];

const pad = (n: number): string => String(n).padStart(2, "0");

function solesAcumulados(yd: number): number {
  return (
    668 * yd +
    Math.floor((yd + 1) / 2) +
    Math.floor((yd - 1) / 10) -
    Math.floor((yd - 1) / 100) +
    Math.floor((yd - 1) / 500)
  );
}

export interface FechaDariana {
  anio: number;
  mesNombre: string;
  solMes: number;
  diaSemana: string;
  horaMtc: string;
}

export function tierraADariano(fecha: Date): FechaDariana {
  let Y = fecha.getUTCFullYear();
  let M = fecha.getUTCMonth() + 1;
  const D = fecha.getUTCDate();
  const H = fecha.getUTCHours();
  const m = fecha.getUTCMinutes();
  const s = fecha.getUTCSeconds() + fecha.getUTCMilliseconds() / 1000;

  if (M <= 2) { Y -= 1; M += 12; }
  const A = Math.floor(Y / 100);
  const B = 2 - A + Math.floor(A / 4);
  const jd =
    Math.floor(365.25 * (Y + 4716)) +
    Math.floor(30.6001 * (M + 1)) +
    D + B - 1524.5 +
    H / 24 + m / 1440 + s / 86400;

  const sTotal = (jd - 2308804.278) / 1.0274912517;
  const sInt = Math.floor(sTotal);
  const fraccion = sTotal - sInt;

  const horasM = Math.floor(fraccion * 24);
  const minutosM = Math.floor((fraccion * 24 - horasM) * 60);
  const segundosM = Math.floor(((fraccion * 24 - horasM) * 60 - minutosM) * 60);

  let yd = Math.floor(sInt / 668.5907);
  let sAcum = solesAcumulados(yd);
  while (sAcum > sInt) { yd -= 1; sAcum = solesAcumulados(yd); }
  while (solesAcumulados(yd + 1) <= sInt) { yd += 1; sAcum = solesAcumulados(yd); }

  const sAnio = sInt - sAcum;
  const q = Math.min(3, Math.floor(sAnio / 167));
  const sTrim = sAnio - q * 167;
  const mTrim = Math.min(5, Math.floor(sTrim / 28));

  const mesNum = q * 6 + mTrim + 1;
  const solMes = sTrim - mTrim * 28 + 1;
  const diaSemanaNum = (solMes - 1) % 7;

  return {
    anio: yd,
    mesNombre: MESES_DARIANOS[mesNum - 1],
    solMes,
    diaSemana: DIAS_SEMANA_DARIANOS[diaSemanaNum],
    horaMtc: `${pad(horasM)}:${pad(minutosM)}:${pad(segundosM)}`,
  };
}
