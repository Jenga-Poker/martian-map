import { useState, useEffect } from "react";
import "./Cabecera.css";
import { tierraADariano } from "../../utils/marte";
import tierraIcon from "../../assets/icons/Earth-1--Streamline-Ultimate.png";
import marteIcon from "../../assets/icons/mars.svg";

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
    <header className="trapecio-azul">
      <div className="trapecio-blanco">
        <span
          className="icono"
          role="img"
          aria-label="Tierra"
          style={{
            WebkitMaskImage: `url("${tierraIcon}")`,
            maskImage: `url("${tierraIcon}")`,
          }}
        />

        <div className="bloque">
          <span className="fecha">{formatoFecha.format(ahora)}</span>
          <span className="hora">{formatoHora.format(ahora)}</span>
        </div>

        <div className="bloque">
          <span className="fecha">
            {marte.diaSemana}, {marte.solMes} {marte.mesNombre} {marte.anio}
          </span>
          <span className="hora">{marte.horaMtc}</span>
        </div>

        <span
          className="icono icono-marte"
          role="img"
          aria-label="Marte"
          style={{
            WebkitMaskImage: `url("${marteIcon}")`,
            maskImage: `url("${marteIcon}")`,
          }}
        />
      </div>
    </header>
  );
}