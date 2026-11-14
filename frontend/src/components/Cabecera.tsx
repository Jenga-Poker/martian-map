import { useState, useEffect } from "react";
import "./Cabecera.css";
import { tierraADariano } from "../utils/marte";

const formatoFecha = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const formatoHora = new Intl.DateTimeFormat("es-ES", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

export default function Cabecera() {
  const [ahora, setAhora] = useState<Date>(new Date());

  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), 250);
    return () => clearInterval(id);
  }, []);

  const marte = tierraADariano(ahora);

  return (
    <header className="cabecera-hud" aria-label="Panel temporal Tierra y Marte">
      <div className="cabecera-hud__frame">
        <div className="cabecera-hud__panel">
          <section className="hud-reloj" aria-label="Hora terrestre">
            <div className="hud-reloj__datos">
              <span className="hud-reloj__etiqueta">Tierra · UTC</span>
              <span className="hud-reloj__fecha">{formatoFecha.format(ahora)}</span>
              <span className="hud-reloj__hora">{formatoHora.format(ahora)}</span>
            </div>
          </section>

          <div className="cabecera-hud__divisor" aria-hidden="true">
            <span />
          </div>

          <section className="hud-reloj hud-reloj--marte" aria-label="Hora marciana">
            <div className="hud-reloj__datos hud-reloj__datos--der">
              <span className="hud-reloj__etiqueta">Marte · MTC</span>
              <span className="hud-reloj__fecha">
                {marte.diaSemana}, {marte.solMes} {marte.mesNombre} {marte.anio}
              </span>
              <span className="hud-reloj__hora">{marte.horaMtc}</span>
            </div>
          </section>
        </div>
      </div>
    </header>
  );
}
